let tb = require('timebucket')
, moment = require('moment')
, z = require('zero-fill')
, n = require('numbro')
, crypto = require('crypto')
// eslint-disable-next-line no-unused-vars
, colors = require('colors')
, abbreviate = require('number-abbreviate')
, readline = require('readline')
, path = require('path')
, _ = require('lodash')
, notify = require('./notify')
, rsi = require('./rsi')
, async = require('async')
, lolex = require('lolex')
, { formatAsset, formatPercent, formatCurrency } = require('./format')
, debug = require('./debug')
//, collectionService = require('../lib/services/collection-service')

let clock
//let nice_errors = new RegExp(/(slippage protection|ProfitLoss protection|max quantum reached|pumpdump watchdog|BuySell calmdown|Price limit protection|Insufficient funds)/)
let nice_errors = new RegExp(/(protection|max quantum reached|pumpdump watchdog|BuySell calmdown|Insufficient funds)/)

module.exports = function (s, conf) {
	let eventBus = conf.eventBus
	eventBus.on('trade', queueTrade)
	eventBus.on('trades', onTrades)
	eventBus.once('buy', () => executeSignal('buy'))
	eventBus.once('sell', () => executeSignal('sell'))
	
	let so = s.options
	
	var notifier = notify(conf)

	s.product_id = so.selector.product_id
	s.asset = so.selector.asset
	s.currency = so.selector.currency
	s.is_dump_watchdog = false
	s.is_pump_watchdog = false
	s.last_executeSignal = 0
	s.hold_signal = false
	
	s.lookback = []
	s.calc_lookback = []
	s.day_count = 1
	s.my_trades = []
	s.my_positions = []
	s.my_prev_trades = []
	s.vol_since_last_blink = 0
	
	//Assegna l'exchange tra live, sim o paper
	if(_.isUndefined(s.exchange)){
		if (so.mode !== 'live') {
			s.exchange = require(path.resolve(__dirname, '../extensions/exchanges/sim/exchange'))(conf, s)
		}
		else {
			s.exchange = require(path.resolve(__dirname, `../extensions/exchanges/${so.selector.exchange_id}/exchange`))(conf)
		}
	}
	else if (so.mode === 'paper') {
		s.exchange = require(path.resolve(__dirname, '../extensions/exchanges/sim/exchange'))(conf, s)
	}
	if (!s.exchange) {
		console.error('cannot trade ' + so.selector.normalized + ': exchange not implemented')
		process.exit(1)
	}

	//Per la compatibilità tra le opzioni period e period_length
	if (typeof so.period_length == 'undefined')
		so.period_length = so.period
	else
		so.period = so.period_length

	//Assegno il giusto product tra quelli a disposizione dell'exchange
	let products = s.exchange.getProducts()
	products.forEach(function (product) {
		if (product.asset === s.asset && product.currency === s.currency) {
			s.product = product
		}
	})
	if (!s.product) {
		console.error('error: could not find product "' + s.product_id + '"')
		process.exit(1)
	}
	if (s.exchange.dynamicFees) {
		s.exchange.setFees({asset: s.asset, currency: s.currency})
	}
	if (so.mode === 'sim' || so.mode === 'paper') {
		//		s.balance = {asset: so.asset_capital, currency: so.currency_capital, deposit: 0}
		s.balance = {asset: so.asset_capital, currency: so.currency_capital}
	}
	else {
		//		s.balance = {asset: 0, currency: 0, deposit: 0}
		s.balance = {asset: 0, currency: 0}
	}

	//Funzione per la stampa a schermo di tutti i dati del programma, esclusi i dati storici e quelli di MongoDB
	function memDump () {
		if (!debug.on) return
		let s_copy = JSON.parse(JSON.stringify(s))
		delete s_copy.options.mongo
		delete s_copy.lookback
		delete s_copy.calc_lookback
		console.error(s_copy)
	}

	//Funzione per assegnare alle opzioni i valori di default qualora non avessero valori
	s.ctx = {
		option: function (name, desc, type, def) {
			if (typeof so[name] === 'undefined') {
				so[name] = def
			}
		}
	}

	if (conf.output.api.on) {
		s.boot_time = (new Date).getTime()
		s.tz_offset = new Date().getTimezoneOffset()
		s.last_trade_id = 0
		s.trades = []
	}
	
	if (so.strategy) {
		s.strategy = require(path.resolve(__dirname, `../extensions/strategies/${so.strategy}/strategy`))
		if (s.strategy.getOptions) {
			s.strategy.getOptions.call(s.ctx, s)
		}
		if (s.strategy.orderExecuted) {
			eventBus.on('orderExecuted', function(type) {
				s.strategy.orderExecuted(s, type, executeSignal)
			})
		}
	}

	function pushMessage(title, message, level = 0) {
		if (so.mode === 'live' || so.mode === 'paper')
			notifier.pushMessage(title, message, level)
	}

	function isFiat() {
		return !s.currency.match(/^BTC|ETH|XMR|USDT$/)
	}

	function initBuffer (trade) {
		let d = tb(trade.time).resize(so.period_length)
		let de = tb(trade.time).resize(so.period_length).add(1)
		s.period = {
			period_id: d.toString(),
			size: so.period_length,
			time: d.toMilliseconds(),
			open: trade.price,
			high: trade.price,
			low: trade.price,
			close: trade.price,
			volume: 0,
			close_time: de.toMilliseconds() - 1,
			calc_close_time: tb(trade.time).resize(so.period_calc).add(1).toMilliseconds() - 1
		}
	}

	//Forse non serve...Crea una posizione vuota, la inserisce in s.my_position e restituisce il suo id
	function initPosition () {
		position = {
				id: crypto.randomBytes(4).toString('hex'),
				order_id: null,
				side: null,
				status: 'opening',
				selector: so.selector.normalized,
				time: null,
				order_type: null,
				size: so.quantum_size || null,
				fee: null,
				price: null,
				sell_stop: null,
				buy_stop: null,
				profit_pct: null,
				profit_stop_limit: null,
				profit_stop: null
		}
		return position
	}
	
	//Funzione per ricavare il prezzo partendo da s.quote, considerando il markdown_buy/sell_pct e l'opzione best_bid/ask
	function nextPriceForQuote(signal) {
		switch (signal) {
			case 'buy': {
				var npfq = n(s.quote.bid).subtract(n(s.quote.bid).multiply(s.options.markdown_buy_pct / 100)).add(so.best_bid ? s.product.increment : 0).format(s.product.increment, Math.floor)
				debug.msg('nextPriceForQuote - buy bid=' + s.quote.bid + ' return=' + npfq)
				return npfq
				break
			}
			case 'sell': {
				var npfq = n(s.quote.ask).add(n(s.quote.ask).multiply(s.options.markup_sell_pct / 100)).subtract(so.best_ask ? s.product.increment : 0).format(s.product.increment, Math.ceil)
				debug.msg('nextPriceForQuote - sell ask=' + s.quote.ask + ' return=' + npfq)
				return npfq
				break
			}
		}
	}
	
	//Aggiorna i dati di s.period con quelli di trade
	function updatePeriod(trade) {
		//debug.msg('updatePeriod')
		s.period.high = Math.max(trade.price, s.period.high)
		s.period.low = Math.min(trade.price, s.period.low)
		s.period.close = trade.price
		s.period.volume += trade.size
		s.period.latest_trade_time = trade.time
		s.strategy.calculate(s)
		s.vol_since_last_blink += trade.size

		//Se c'è stato un nuovo trade, aggiungilo a s.trades
		if (s.trades && s.last_trade_id !== trade.trade_id) {
			s.trades.push(trade)
			s.last_trade_id = trade.trade_id
		}
		
		//Ripulisci s.trades a un max di valori
		let max_length = 100
		if (s.trades.length > max_length) {
			s.trades.splice(max_length, (s.trades.length - max_length))
		}
	}

	//Controlla se è scattato uno stop e nel caso eseguilo
	function executeStop () {
		//Esegue il controllo per ogni posizione aperta
		s.my_positions.forEach( function (position, index) {
			//s.trade_worth = position.type === 'buy' ? (s.period.close - position.price) / position.price : (position.price - s.period.close) / position.price
			position_stop = position[position.side + '_stop']
			if (!s.acted_on_stop && position_stop && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position_stop) < 0)) {
//				s.signal = 'sell'
				s.acted_on_stop = true
				position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
				console.log(('\n' + position.side + ' stop triggered at ' + formatPercent(position.profit_pct) + ' trade profit for position ' + position.id + '\n').red)
				pushMessage('Stop Loss Protection', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_pct) + ')', 0)
				//Eseguo executeSignal su questa posizione, con modalità taker
				executeSignal(position_opposite_signal, position.id, undefined, undefined, false, true)
				return
			}

			if (!s.acted_on_trail_stop && position.profit_stop && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position.profit_stop) < 0) && position.profit_pct > 0) {
//				s.signal = 'sell'
				s.acted_on_trail_stop = true
				position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
				console.log(('\nProfit stop triggered at ' + formatPercent(position.profit_pct) + ' trade profit for position ' + position.id + '\n').green)
				pushMessage('Trailing stop', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_pct) + ')', 0)
				executeSignal(position_opposite_signal, position.id)
				return
			}
		})
	}

	function syncBalance (cb) {
		s.exchange.getBalance({currency: s.currency, asset: s.asset}, function (err, balance) {
			if (err) return cb(err)
			s.balance = balance
			s.available_balance = {
					currency: balance.currency,
					asset: balance.asset
			}
			
			getQuote(function (err) {
				if (err)
					return cb(err)

				s.asset_capital = n(s.balance.asset).multiply(s.quote.ask).value()
				s.real_capital = n(s.balance.currency).add(s.asset_capital).value()

				s.my_positions.forEach(function (position, index) {
					if (position.side == 'buy')
						s.available_balance.asset -= position.size
					else
						s.available_balance.currency -= position.cost	
				})
				
				if (!s.start_capital) {
					s.start_price = n(s.quote.ask).value()
					s.start_capital = n(s.balance.currency).add(s.asset_capital).value()
					
					if (so.mode !== 'sim') {
						//Se non esiste s.start_capital (quindi siamo all'inizio), manda un messaggio di update
						updateMessage()
					}
				}
				
//				debug.msg('syncBalance - balance= ' + JSON.stringify(s.balance) + ' ; available_balance= ' + JSON.stringify(s.available_balance))

				//Posso non avere output, tanto aggiorno s.quote e s.balance
				cb(null)
			})
		})
	}

	function getQuote (cb) {
		s.exchange.getQuote({product_id: s.product_id}, function (err, quote) {
			if (err)
				return cb(err)
			
			s.quote = quote
			cb(null)
		})
	}

	//***************************************************************************************************
	// if s.signal
	// 1. sync balance
	// 2. get quote
	// 3. calculate size/price
	// 4. validate size against min/max sizes
	// 5. cancel old orders
	// 6. place new order
	// 7. record order ID and start poll timer
	// 8. if not filled after timer, repeat process
	// 9. if filled, record order stats
	function executeSignal (signal, sig_id = null, fixed_size = null, fixed_price = null, is_reorder, is_taker, _cb) {
		let expected_fee = 0
		var signal_id = signal + (sig_id || "")
		var signal_opposite = (signal === 'buy' ? 'sell' : 'buy')
		
		if (!signal.includes('buy') && !signal.includes('sell')) {
			debug.msg('executeSignal - signal non contiene buy/sell. Esco')
			_cb && _cb(null, null)
			eventBus.once(signal, () => executeSignal(signal))
			console.log('listeners ' + eventBus.listeners(signal))
			return
		}	
		
		//Se è un riordine, non capisce più nulla, perchè non prende i dati dal vecchio ordine. Controllare bene tutto il procedimento.
		
		//Assegno la working_position
		var working_position = null
		var working_position_index = null
		if (is_reorder) {
			debug.msg('executeSignal - is_reorder: assegno a working_position i valori di s[' + signal_id + '_order]')
			working_position = s[signal_id + '_order']
		}
		else if (sig_id) {
			working_position_index = s.my_positions.findIndex(x => x.id == sig_id)
			working_position = s.my_positions[working_position_index]
			debug.msg('executeSignal - sig_id - working_position_id = ' + working_position.id)
			
			//Se contemporaneamente c'è un ordine standard aperto su questa posizione, annullo executeSignal
			if (s[signal + '_order'] && s[signal + '_order'].id == sig_id) {
				debug.msg('executeSignal - Annullo. Esiste ordine standard aperto su ' + sig_id)
				_cb && _cb(null, null)
				eventBus.once(signal, () => executeSignal(signal))
				console.log('listeners ' + eventBus.listeners(signal))
				return
			}
			
			//Controllo coerenza signal con posizione
			if (signal == working_position.side) {
				debug.msg('executeSignal - signal ' + signal + ' non coerente con la posizione (' + working_position-side + ') '+ working_position_index)
				_cb && _cb(null, null)
				eventBus.once(signal, () => executeSignal(signal))
				console.log('listeners ' + eventBus.listeners(signal))
				return
			}
		} else {
			//E' un ordine senza sig_id, quindi dettato dalla strategia. Cancello gli ordini di senso opposto ancora in essere
			if (s[signal_opposite + '_order'])
				delete s[signal_opposite + '_order']
			
			//Prendo la posizione aperta con il massimo profitto (non è detto sia superiore al limite imposto dalla configurazione)
			if (s.max_profit_position.trend[signal_opposite]) {
				working_position_index = s.my_positions.findIndex(x => x.id == s.max_profit_position.trend[signal_opposite].id)
//				working_position = s.my_positions[working_position_index]
				working_position = s.max_profit_position.trend[signal_opposite]
			}
			
			debug.msg('executeSignal - not sig_id - working_position.id = ' + (working_position ? working_position.id : 'null'))
		}
								
		debug.msg('executeSignal - ' + signal_id + ' - riordine ' + is_reorder)
		debug.msg('executeSignal - ' + (s[signal_id + '_order']? ('s[' + signal_id + '_order] esiste') : ('s[' + signal_id + '_order] non esiste')))
		
		let cb = function (err, order) {
			if (!order) {
				debug.msg('executeSignal - cb: cancello s[' + signal_id + '_order]')
				if (working_position) {
					working_position.profit_stop = null
					working_position.profit_stop_limit = null
				}
				s.acted_on_trail_stop = null
				s.acted_on_trend = null
				delete s[signal_id + '_order']
			}
			if (err) {
				if (_cb) {
					_cb(err)
				}
				else if (err.message.match(nice_errors)) {
					console.error((err.message + ': ' + err.desc).red)
				} else {
					memDump()
					console.error('\n')
					console.error(err)
					console.error('\n')
				}
			}
			else if (_cb) {
				_cb(null, order)
			}
			eventBus.once(signal, () => executeSignal(signal))
			console.log('function cb listeners ' + eventBus.listeners(signal))
		}

		s.last_signal = signal
		
		//Da implementare con il controllo degli eventi
		
		//Controllo se l'ordine è già stato piazzato
		//Anticipo qui la chiamata a questo controllo perchè mi sembra inutile
		// fargli fare altri controlli nel frattempo.
//		if (!is_reorder && s[signal_id + '_order']) {
//			debug.msg('executeSignal - not is_reorder && esiste s[' + signal_id + '_order]. Ordine già piazzato!!')
//			
//			//Mi sembra inutile, dovrebbe già essere così
//			if (is_taker) s[signal_id + '_order'].order_type = 'taker'
//			
//			// order already placed
//			_cb && _cb(null, null)
//			return
//		}
		
		//Potrebbe servire in alcune strategie
		if (!sig_id)
			s.acted_on_trend = true
		else
			s.acted_on_trend = false
		
		//Controlli timing (da sostituire con funzione)
		//Questi controlli solo se sono ordini dettati dalla strategia e non a prezzo fisso
		if (!fixed_price) {
			//Controllo se il watchdog è attivo
			if (s.is_dump_watchdog || s.is_pump_watchdog) {
				let err = new Error('\npumpdump watchdog')
				err.desc = 'refusing to buy/sell. ' + (s.is_dump_watchdog ? 'Dump ' : 'Pump ') + ' Watchdog is active! Positions opened: ' + s.my_positions.length + '\n'
				return cb(err)
			}

			//Controllo se è passato il buy/sell_calmdown
			if (so.buy_calmdown && signal == 'buy') {
				if ((now() - (so.buy_calmdown*60*1000)) < s.last_buy_time) {
					let err = new Error('\nBuySell calmdown')
					err.desc = moment().format('YYYY-MM-DD HH:mm:ss') + ' - refusing to buy. Buy Calmdown is active! Last buy ' + moment(s.last_buy_time).format('YYYY-MM-DD HH:mm:ss') + ' Positions opened: ' + s.my_positions.length + '\n'
					return cb(err)
				}
			} else if (so.sell_calmdown && signal == 'sell') {
				if ((now() - (so.sell_calmdown*60*1000)) < s.last_sell_time) {
					let err = new Error('\nBuySell calmdown')
					err.desc = moment().format('YYYY-MM-DD HH:mm:ss') + ' - refusing to sell. Sell Calmdown is active! Last sell ' + moment(s.last_sell_time).format('YYYY-MM-DD HH:mm:ss') + ' Positions opened: ' + s.my_positions.length + '\n'
					return cb(err)
				}
			}
		}
		
		syncBalance(function (err) {
			let fee, trade_balance, tradeable_balance

			if (err) {
				debug.msg('executeSignal - syncBalance - Error getting balance')
				err.desc = 'executeSignal - syncBalance - could not execute ' + signal_id + ': error fetching quote'
				return cb(err)
			}

			//Prepara il prezzo per l'ordine
			price = fixed_price || nextPriceForQuote(signal)
			
			//Prepara la quantità
			size = (n(fixed_size) || (working_position ? n(working_position.remaining_size) : n(so.quantum_size).divide(price))).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
			
			
			//Controlli sul prezzo (da sostituire con funzione)
			//Controllo Limit Price Protection
			if (signal === 'buy' && so.buy_price_limit != null && price > so.buy_price_limit) {
				let err = new Error('\nPrice limit protection')
				err.desc = 'refusing to buy at ' + formatCurrency(price, s.currency) + ', buy price limit -> ' + formatCurrency(so.buy_price_limit, s.currency) + '\n'
				return cb(err)
			}
			if (signal === 'sell' && so.sell_price_limit != null && price < so.sell_price_limit) {
				let err = new Error('\nPrice limit protection')
				err.desc = 'refusing to sell at ' + formatCurrency(price, s.currency) + ', sell price limit -> ' + formatCurrency(so.sell_price_limit, s.currency) + '\n'
				return cb(err)
			}
				
			//Controllo profitto della posizione, solo se non sto eseguendo uno stop loss
			if (working_position && !s.acted_on_stop && so['max_' + signal + '_loss_pct'] != null && (working_position.profit_pct*100 + so['max_' + signal + '_loss_pct'] < 0)) {
				let err = new Error('\nPosition ' + working_position.id + ' ProfitLoss protection')
				err.desc = 'refusing to ' + signal + ' at ' + formatCurrency(price, s.currency) + ', ' + (so['max_' + signal + '_loss_pct'] > 0 ? 'LOSS of ' : 'PROFIT of ') + formatPercent(working_position.profit_pct) + ' (limit ' + formatPercent(-so['max_' + signal + '_loss_pct'] / 100) + ')\n'

				working_position_index = null
				working_position = null

				//Esco solo se era un ordine sig_id, altrimenti proseguo con l'ordine standard long/short
				if (sig_id)
					return cb(err, false)
				
				if (err.message.match(nice_errors)) {
					console.error((err.message + ': ' + err.desc).red)
				
				debug.msg('executeSignal - Proseguo con ordine standard')
				}
			}
			
			//Controllo se posso eseguire ordini long/short
			if (working_position == null && ((signal == 'buy' && !so.active_long_position) || (signal == 'sell' && !so.active_short_position))) {
				debug.msg('executeSignal - Non posso operare ' + signal + ': so.active_position false')
				return cb(err)
			}
			
			//Controllo slippage solo sugli ordini non fixed price
			if (s[signal_id + '_order'] && !s[signal_id + '_order'].fixed_price && so.max_slippage_pct != null) {
				slippage = Math.abs(n(s[signal_id + '_order'].orig_price).subtract(price).divide(s[signal_id + '_order'].orig_price).multiply(100).value())
				if (so.max_slippage_pct != null && slippage > so.max_slippage_pct) {
					let err = new Error('\nslippage protection')
					err.desc = 'refusing to buy at ' + formatCurrency(price, s.currency) + ', slippage of ' + formatPercent(slippage / 100)
					pushMessage('Slippage protection', 'aborting', 9)
					return cb(err)
				}
			}
			
			//Controlli sulla quantità (da sostituire con funzione)
			if (working_position) {
				//Cosa succede se tutti i fondi sono hold? In qualche modo me ne devo accorgere e liberarli o considerarli prima di fare questo controllo.
				// s.balance.asset restituisce i fondi liberi da hold. s.balance.asset_hold sono quelli on hold.
				size = (working_position.size < s.available_balance.asset) ? n(working_position.size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000') : s.available_balance.asset
				debug.msg('executeSignal - Position: ' + working_position.id + ' Size: ' + formatAsset(size, s.asset) + ' (' + formatCurrency(so.quantum_size, s.currency) + ' su ' + formatCurrency(s.balance.currency, s.currency) + ')')
				debug.printPosition(working_position)
			} else {
				size = n(so.quantum_size).divide(price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
				debug.msg('executeSignal - No position , size: ' + formatAsset(size, s.asset) + ' (' + formatCurrency(so.quantum_size, s.currency) + ' su ' + formatCurrency(s.balance.currency, s.currency) + ')')
			}		

			//Controllo sui fondi (currency se buy, asset se sell). Da eliminare una volta che capisco come mi risponde l'exchange
			// in caso di fondi insufficienti (potrei verificarlo con il sandbox).
			
			//Calcolo fee
			if (so.use_fee_asset) {
				fee = 0
			} else if (so.order_type === 'maker') {
				fee = s.exchange.makerFee
			} else {
				fee = s.exchange.takerFee
			}		
			
			trade_balance = (size * price)
			tradeable_balance = trade_balance * 100 / (100 + fee)
			expected_fee = n(trade_balance).subtract(tradeable_balance).format('0.00000000', Math.ceil) // round up as the exchange will too

			if (signal === 'buy' && tradeable_balance >= s.available_balance.currency) {
				let err = new Error('\nInsufficient funds')
				err.desc = 'refusing to buy ' + formatCurrency(tradeable_balance, s.currency) + '. Insufficient funds (' + formatCurrency(s.available_balance.currency, s.currency) + ')'
				return cb(err)
			}
			if (signal === 'sell' && size >= s.available_balance.asset) {
				let err = new Error('\nInsufficient funds')
				err.desc = 'refusing to sell ' + formatAsset(size, s.asset) + '. Insufficient funds (' + formatAsset(s.available_balance.asset, s.asset) + ')'
				return cb(err)
			}

			if ((s.product.min_size && Number(size) >= Number(s.product.min_size)) || ('min_total' in s.product && s.product.min_total && n(size).multiply(price).value() >= Number(s.product.min_total))) {
				if (s.product.max_size && Number(size) > Number(s.product.max_size)) {
					debug.msg('executeSignal - size = s.product.max_size')
					size = s.product.max_size
				}

				debug.msg('executeSignal - preparing ' + signal_id + ' order over ' + formatAsset(size, s.asset) + ' of ' + formatCurrency(tradeable_balance, s.currency) + ' tradeable balance with a expected fee of ' + formatCurrency(expected_fee, s.currency) + ' (' + fee + '%)')

				//Deprecated
//				//Controllo se ho raggiunto il numero massimo di quantum acquistabili
//				if (s.my_positions.length >= so.max_nr_quantum) {
//				let err = new Error('\nmax quantum reached')
//				err.desc = 'refusing to buy. Max nr of quantum (' + so.max_nr_quantum + ') reached. Positions opened: ' + s.my_positions.length
//				return cb(err)
//				}

				//Controllo currency in hold
				//if (n(s.balance.deposit).subtract(s.balance.currency_hold || 0).value() < n(price).multiply(size).value() && s.balance.currency_hold > 0) {
				// Da capire come modificare per intercettare anche gli hold di un id order
				switch (signal) {
					case 'buy': {
						if (n(s.balance.currency).subtract(s.balance.currency_hold || 0).value() < n(price).multiply(size).value() && s.balance.currency_hold > 0) {
							debug.msg('executeSignal - buy delayed: ' + formatPercent(n(s.balance.currency_hold || 0).divide(s.balance.currency).value()) + ' of funds (' + formatCurrency(s.balance.currency_hold, s.currency) + ') on hold')
							return setTimeout(function () {
								if (s.last_signal === signal) {
									s.hold_signal = true
									executeSignal(signal, sig_id, size, undefined, true, undefined, cb)
								}
							}, conf.wait_for_settlement)
						}
						else {
							s.hold_signal = false
							pushMessage('Buying ' + s.exchange.name.toUpperCase(), 'placing ' + signal + ' order at ' + formatCurrency(price, s.currency) + ', ' + formatCurrency(n(s.quote.bid - Number(price)).format('0.00'), s.currency) + ' under best bid\n', 9)
	
							//Controllo se l'ordine è già stato piazzato
							//Effettuo un altro controllo in questo punto, prima di chiamare doOrder()
							// per cercare di risolvere il problema dovuto alla sovrapposizione di ordini.
							if (!is_reorder && s[signal_id + '_order']) {
								debug.msg('executeSignal - prima di doOrder(): !is_reorder && esiste s[' + signal_id + '_order]. Ordine già piazzato!!')
								pushMessage('executeSignal - prima di doOrder(buy)', 'Ordine già piazzato. Hai fatto bene a mettere questo if', 0)
								if (is_taker)
									s[signal_id + '_order'].order_type = 'taker'
								// order already placed
								_cb && _cb(null, null)
								return
							}
	
							doOrder()
						}
						break
					}
					case 'sell': {
						//Controllo asset in hold
						// Da trovare il modo per intercettare anche gli id order
						if (n(s.balance.asset).subtract(s.balance.asset_hold || 0).value() < n(size).value()) {
							debug.msg('executeSignal - sell delayed: ' + formatPercent(n(s.balance.asset_hold || 0).divide(s.balance.asset).value()) + ' of funds (' + formatAsset(s.balance.asset_hold, s.asset) + ') on hold')
							debug.msg('executeSignal - s.balance.asset ' + s.balance.asset + ' s.balance.asset_hold ' + s.balance.asset_hold + ' size ' + size)
							return setTimeout(function () {
								if (s.last_signal === signal) {
									s.hold_signal = true
									executeSignal(signal, sig_id, size, undefined, true, undefined, cb)
								}
							}, conf.wait_for_settlement)
						}
						else {
							s.hold_signal = false
							pushMessage('Selling ' + formatAsset(size, s.asset) + ' on ' + s.exchange.name.toUpperCase(), 'placing sell order at ' + formatCurrency(price, s.currency) + ', ' + formatCurrency(n(Number(price) - s.quote.ask).format('0.00'), s.currency) + ' over best ask\n', 9)
							//debug.msg('Selling -> doOrder')
	
							//Controllo se l'ordine è già stato piazzato
							//Effettuo un altro controllo in questo punto, prima di chiamare doOrder()
							// per cercare di risolvere il problema dovuto alla sovrapposizione di ordini.
							if (!is_reorder && s[signal_id + '_order']) {
								debug.msg('executeSignal - prima di doOrder(): !is_reorder && esiste s[' + signal_id + '_order]. Ordine già piazzato!!')
								pushMessage('executeSignal - prima di doOrder(sell)', 'Ordine già piazzato. Hai fatto bene a mettere questo if', 0)
								if (is_taker)
									s[signal_id + '_order'].order_type = 'taker'
								// order already placed
								_cb && _cb(null, null)
								return
							}
							doOrder()
						}
						break
					}
				}
			}
			else {
				debug.msg('executeSignal - size < s.product.min_size.')
				if (working_position) {
					working_position.profit_stop = null
					working_position.profit_stop_limit = null
				}
				s.acted_on_trail_stop = null
				working_position = null
				working_position_index = null
				cb(null, null)
			}
		})

		function doOrder () {
			//debug.msg('doOrder')
			placeOrder(function (err, order) {
				if (err) {
					err.desc = 'executeSignal - doOrder - Could not execute ' + signal_id + ': error placing order'
					return cb(err)
				}

				//Gestione eccezioni ed errori
				if (!order) {
					if (order === false) {
						// not enough balance, or signal switched.
						debug.msg('executeSignal - doOrder - not enough balance, or signal switched, cancel ' + signal_id)
						return cb(null, null)
					}
					if (s.last_signal !== signal) {
						// order timed out but a new signal is taking its place
						debug.msg('executeSignal - doOrder - signal switched, cancel ' + signal_id)
						return cb(null, null)
					}
					// order timed out and needs adjusting
					debug.msg('executeSignal - doOrder - ' + signal_id + ' order timed out, adjusting price')
					let remaining_size = s[signal_id + '_order'] ? s[signal_id + '_order'].remaining_size : size
						if (remaining_size != size) {
							debug.msg('executeSignal - doOrder - remaining size: ' + remaining_size + ' of ' + s[signal_id + '_order'].size)
						}
					return executeSignal(signal, sig_id, remaining_size, undefined, true)
				}
				cb(null, order)
			})
		}
		
		function placeOrder (cb) {
			if (!s[signal_id + '_order']) {
				s[signal_id + '_order'] = {
					id: ('_' + crypto.randomBytes(4).toString('hex')),
					time: null,
					orig_time: null,
					local_time: null,
					signal: signal,
					position_index: working_position_index,
					price: price,
					cost: 0,
					fixed_price: fixed_price,
					size: size,
					fee: expected_fee || null,
					orig_size: size,
					remaining_size: size,
					filled_size: 0,
					orig_price: price,
					order_type: is_taker ? 'taker' : so.order_type,
					order_id: null,
					order_status: null,
					product_id: s.product_id,
					post_only: conf.post_only,
					cancel_after: s.cancel_after // s.cancel_after || 'day'
				}
			}
			debug.msg('executeSignal - placeOrder - creato ' + signal_id + '_order')
			let order = s[signal_id + '_order']
			order.price = price
			order.size = size
			order.fee = expected_fee
//			order.remaining_size = opts.size

			let order_copy = JSON.parse(JSON.stringify(order))

			//Piazza l'ordine sull'exchange
			s.exchange[signal](order_copy, function (err, api_order) {
				if (err) return cb(err)
				s.api_order = api_order

				//Nel caso di rifiuto dell'ordine...
				if (api_order.status === 'rejected') {
					debug.msg('executeSignal - placeOrder - s.exchange rejected: ' + api_order.reject_reason)
					if (api_order.reject_reason === 'post only') {
						// trigger immediate price adjustment and re-order
						debug.msg('executeSignal - placeOrder - post-only ' + signal_id + ' failed, re-ordering')
						return cb(null, null)
					}
					else if (api_order.reject_reason === 'balance') {
						// treat as a no-op.
						debug.msg('executeSignal - placeOrder - not enough balance for ' + signal_id + ', aborting')
						return cb(null, false)
					}
					else if (api_order.reject_reason === 'price') {
						// treat as a no-op.
						debug.msg('executeSignal - placeOrder - invalid price for ' + signal_id + ', aborting')
						return cb(null, false)
					}
					err = new Error('\norder rejected')
					err.order = api_order
					return cb(err)
				}
				debug.msg('placeOrder - ' + signal_id + ' order placed at ' + formatCurrency(order.price, s.currency))
				order.order_id = api_order.id

				//Con ordine piazzato, lo marca temporalmente
				if (!order.orig_time) {
					order.orig_time = new Date(api_order.created_at).getTime()
				}
				order.time = new Date(api_order.created_at).getTime()
				order.local_time = now()
				order.order_status = api_order.status
				
				setTimeout(function() { checkOrder(order, signal, sig_id, cb) }, so.order_poll_time)
			})
		}
	}

	function checkOrder (order, signal, sig_id, cb) {
		//debug.msg('checkOrder')
		signal_id = signal + (sig_id || "")
		
		if (!s[signal_id + '_order']) {
			// signal switched, stop checking order
			debug.msg('checkOrder - signal switched during ' + signal_id + ', aborting')
			pushMessage('Signal switched during ' + signal_id, ' aborting', 9)
			return cancelOrder(order, signal, sig_id, false, cb)
		}
		s.exchange.getOrder({order_id: order.order_id, product_id: s.product_id}, function (err, api_order) {
			if (err)
				return cb(err)
				
			if (api_order) {
				s.api_order = api_order
				order.order_status = api_order.status
			
				if (api_order.reject_reason)
					order.reject_reason = api_order.reject_reason

				//Ordine eseguito!!
				if (api_order.status === 'done') {
					order.time = new Date(api_order.done_at).getTime()
					order.price = api_order.price || order.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
					order.filled_size = api_order.filled_size
					order.remaining_size = api_order.remaining_size
					order.cost += n(order.filled_size).multiply(order.price)
					debug.msg('checkOrder - getOrder - done - order.cost= ' + order.cost)
					executeOrder(order, signal, sig_id)
	
					//Esco dalla funzione, restituendo syncBalance
					return syncBalance(function () {
						cb(null, order)
					})
				}

				//Ordine rifiutato
				if (order.status === 'rejected' && (order.reject_reason === 'post only' || api_order.reject_reason === 'post only')) {
					debug.msg('checkOrder - post-only ' + signal_id + ' failed, re-ordering')
					return cb(null, null)
				}
				if (order.status === 'rejected' && order.reject_reason === 'balance') {
					debug.msg('checkOrder - not enough balance for ' + signal_id + ', aborting')
					return cb(null, null)
				}
			}				
				
			//Controllo se è trascorso so.order_adjust_time senza che l'ordine sia stato eseguito.
			if (!order.fixed_price && (now() - order.local_time >= so.order_adjust_time)) {
				getQuote(function (err) {
					if (err) {
						err.desc = 'could not execute ' + signal + ': error fetching quote'
						return cb(err)
					}
					
					if (signal === 'buy') {
						if (n(order.price).value() < s.quote.bid) {
							debug.msg('checkOrder - ' + s.quote.bid + ' > our ' + order.price)
							cancelOrder(order, signal, sig_id, true, cb)
						}
						else {
							order.local_time = now()
							setTimeout(function() { checkOrder(order, signal, sig_id, cb) }, so.order_poll_time)
						}
					}
					
					if (signal === 'sell') {
						if (n(order.price).value() > s.quote.ask) {
							debug.msg('checkOrder - ' + s.quote.ask + ' < our ' + order.price)
							cancelOrder(order, signal, sig_id, true, cb)
						}
						else {
							order.local_time = now()
							setTimeout(function() { checkOrder(order, signal, sig_id, cb) }, so.order_poll_time)
						}
					}
				})
			}
			else {
				setTimeout(function() { checkOrder(order, signal, sig_id, cb) }, so.order_poll_time)
			}
		})
	}
	
	function cancelOrder (order, signal, sig_id, do_reorder, cb) {
		signal_id = signal + (sig_id || "")
		
		s.exchange.cancelOrder({order_id: order.order_id, product_id: s.product_id}, function () {
			function checkHold (do_reorder, cb) {
				s.exchange.getOrder({order_id: order.order_id, product_id: s.product_id}, function (err, api_order) {
					if (api_order) {
						s.api_order = api_order
						order.order_status = api_order.status
						
						if (api_order.status === 'done') {
							order.time = new Date(api_order.done_at).getTime()
							order.price = api_order.price || order.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
							order.filled_size = api_order.filled_size
							order.remaining_size = api_order.remaining_size
							order.cost += n(order.filled_size).multiply(order.price)
							debug.msg('cancelOrder - cancel failed, order done, executing - order.cost= ' + order.cost)
							executeOrder(order, signal, sig_id)
							return syncBalance(function () {
								cb(null, order)
							})
						}

						if (api_order.filled_size) {
							order.filled_size = api_order.filled_size
							order.remaining_size = n(order.orig_size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
							order.cost += n(order.filled_size).multiply(api_order.price)
							debug.msg('cancelOrder - api_order.filled_size= ' + api_order.filled_size + ' ; order.remaining_size= ' + order.remaining_size + ' ; order.cost= ' + order.cost)
							if (!((s.product.min_size && Number(order.remaining_size) >= Number(s.product.min_size)) || (s.product.min_total && n(order.remaining_size).multiply(order.price).value() >= Number(s.product.min_total)))) {
								debug.msg('cancelOrder - order.remaining_size < minimo ordine possibile (o errore equivalente)')
								order.time = new Date(api_order.done_at).getTime()
//								order.size = order.orig_size - order.remaining_size
//								order.size = order.filled_size
								executeOrder(order, signal, sig_id)
								return syncBalance(function () {
									cb(null, order)
								})
							}
							//Ha eseguito parzialmente l'ordine e non è stato chiamato un riordine, quindi deve aprire/aggiornare la
							// posizione con i dati attuali
							if (!do_reorder) {
								debug.msg('cancelOrder - do_reorder = false')
								order.time = new Date(api_order.done_at).getTime()
//								order.size = order.orig_size - order.remaining_size
//								order.size = order.filled_size
								executeOrder(order, signal, sig_id)
								return syncBalance(function () {
									cb(null, order)
								})
							}
						}
					}
					
					syncBalance(function () {
						let on_hold
//						if (type === 'buy') on_hold = n(s.balance.deposit).subtract(s.balance.currency_hold || 0).value() < n(order.price).multiply(order.remaining_size).value()
//************** Da controllare questo punto.						
						if (signal === 'buy')
							on_hold = n(s.available_balance.currency).subtract(s.balance.currency_hold || 0).value() < n(order.price).multiply(order.remaining_size).value()
						else
							on_hold = n(s.available_balance.asset).subtract(s.balance.asset_hold || 0).value() < n(order.remaining_size).value()

						if (on_hold && (s.balance.currency_hold > 0 || s.balance.asset_hold > 0)) {
							// wait a bit for settlement
							debug.msg('funds on hold after cancel, waiting 5s')
							setTimeout(function() { checkHold(do_reorder, cb) }, conf.wait_for_settlement)
						}
						else {
							cb(null, do_reorder ? null : false)
						}
					})
				})
			}
			checkHold(do_reorder, cb)
		})
	}

	function executeOrder (trade, signal, sig_id) {
		signal_id = signal + (sig_id || "")

		let price, fee = 0
		if (!so.order_type) {
			so.order_type = 'maker'
		}

		// If order is cancelled, but on the exchange it completed, we need to recover it here
		if (!s[signal_id + '_order'])
			s[signal_id + '_order'] = trade
		
		position_index = s[signal_id + '_order'].position_index

		price = s[signal_id + '_order'].price
		
		if (so.order_type === 'maker') {
			if (s.exchange.makerFee)
				fee = n(s[signal_id + '_order'].size).multiply(s.exchange.makerFee / 100).value()
		}
		if (so.order_type === 'taker') {
			if (s.exchange.takerFee)
				fee = n(s[signal_id + '_order'].size).multiply(s.exchange.takerFee / 100).value()
		}

		s.action = (signal == 'buy' ? 'bought' : 'sold')

		//Archivio il trade in s.my_trades
		let my_trade = {
			id: s[signal_id + '_order'].id,
			_id: s[signal_id + '_order'].id,
			order_id: trade.order_id,
			time: trade.time,
			execution_time: trade.time - s[signal_id + '_order'].orig_time,
			slippage: (signal == 'buy' ? 1 : -1) * n(price).subtract(s[signal_id + '_order'].orig_price).divide(s[signal_id + '_order'].orig_price).value(),
			side: signal,
			size: s[signal_id + '_order'].filled_size,
			fee: fee,
			price: price,
			//Al cost manca il fee... da aggiungere una volta capito come calcolarlo
			cost: s[signal_id + '_order'].cost,
			order_type: so.order_type || 'taker',
			// profit: s.last_sell_price && (s.last_sell_price - price) / s.last_sell_price, //Da togliere/modificare
			profit: (position_index != null ? s.my_positions[position_index].profit_pct : null),
			position_span: (position_index != null ? (moment.duration(trade.time - s.my_positions[position_index].time).humanize()) : null),
			cancel_after: so.cancel_after || null //'day'
		}
		s.my_trades.push(my_trade)

		//Messaggio di ordine eseguito
		if (so.stats) {
			let order_complete = '\n**** ' + signal.toUpperCase() + ' order completed at ' + moment(trade.time).format('YYYY-MM-DD HH:mm:ss') + ':\n\n' + formatAsset(my_trade.size, s.asset) + ' at ' + formatCurrency(my_trade.price, s.currency) + '\nTotal ' + formatCurrency(my_trade.size * my_trade.price, s.currency) + '\n'
			order_complete += n(my_trade.slippage).format('0.0000%') + ' slippage (orig. price ' + formatCurrency(s[signal_id + '_order'].orig_price, s.currency) + ')\nexecution: ' + moment.duration(my_trade.execution_time).humanize() + '\n'
			order_complete += 'Positions: ' + (s.my_positions.length+1)
			if (position_index != null) {
				order_complete += '\nOriginal price: ' + formatCurrency(s.my_positions[position_index].price, s.currency)
				order_complete += '\nProfit: ' + n(my_trade.profit).format('0.0000%')
				order_complete += '\nExecution: ' + moment.duration(my_trade.execution_time).humanize()
				order_complete += '\nPosition span: ' + my_trade.position_span
			}
//			order_complete += (s[signal_id + '_order'].status != null ? s[signal_id + '_order'].status : '')
			console.log((order_complete).cyan)
			pushMessage(s.exchange.name.toUpperCase(), order_complete, 5)
		}

		if (position_index != null) {
			if (s.my_positions[position_index].size != my_trade.size) {
				s.my_positions[position_index].size -= my_trade.size
				debug.msg('executeOrder - posizione ' + position_index + ' non chiusa completamente. Rimangono ' + formatAsset(s.my_positions[position_index].size, s.asset))
				
				s.update_position_id = s.my_positions[position_index].id
				s.delete_position_id = null
			} else {
				//Elimino la posizione da s.my_positions
				debug.msg('executeOrder - delete position ' + position_index + ' (lenght attuale ' + s.my_positions.length +')')
				
				s.update_position_id = null
				s.delete_position_id = s.my_positions[position_index].id
				s.my_positions.splice(position_index, 1)
				updatePositions(trade)

//				debug.msg('executeOrder - Lista posizioni rimaste')
//				debug.printPosition(s.my_positions)
			}
		} else {
			//Archivio la posizione in s.my_positions
			let my_position = {
					id: s[signal_id + '_order'].id,
					order_id: trade.order_id,
					side: signal,
					status: 'stand-by',
					selector: so.selector.normalized,
					time: trade.time,
					order_type: so.order_type || 'taker',
					size: s[signal_id + '_order'].filled_size,
					fee: fee,
					price: price,
					//Al cost manca il fee... da aggiungere una volta capito come calcolarlo
					cost: s[signal_id + '_order'].cost,
					buy_stop: (signal == 'buy' ? so.buy_stop_pct && n(price).add(n(price).multiply(so.buy_stop_pct/100)).value() : null),
					sell_stop: (signal == 'sell' ? so.sell_stop_pct && n(price).subtract(n(price).multiply(so.sell_stop_pct/100)).value() : null),
					profit_pct: null,
					profit_stop_limit: null,
					profit_stop: null
			}
			debug.printPosition(my_position)
			s.my_positions.push(my_position)
			s.update_position_id = my_position.id
			s.delete_position_id = null
			updatePositions(trade)
		}

		s['last_' + signal + '_price'] = my_trade.price
		s['last_' + signal + '_time'] = trade.time

		delete s[signal_id + '_order']
		debug.msg('executeOrder - delete s[' + signal_id + '_order]')
		
		//Cancella anche tutti gli ordini connessi con la posizione
		if (s[signal + my_trade.id + '_order']) {
			delete s[signal + my_trade.id + '_order']
			debug.msg('executeOrder - delete s[' + signal + my_trade.id + '_order]')
		}

		eventBus.emit('orderExecuted', signal)

//		executeSignal('sell', undefined, undefined, undefined, undefined, my_position.id)
	}

	function now () {
		return new Date().getTime()
	}

	function writeReport (is_progress, blink_off) {
		if ((so.mode === 'sim' || so.mode === 'train') && !so.verbose) {
			if(so.silent) return
			is_progress = true
		}
		else if (is_progress && typeof blink_off === 'undefined' && s.vol_since_last_blink) {
			s.vol_since_last_blink = 0
			setTimeout(function () {
				writeReport(true, true)
			}, 200)
			setTimeout(function () {
				writeReport(true, false)
			}, 400)
			setTimeout(function () {
				writeReport(true, true)
			}, 600)
			setTimeout(function () {
				writeReport(true, false)
			}, 800)
		}
		readline.clearLine(process.stdout)
		readline.cursorTo(process.stdout, 0)
		process.stdout.write(moment(is_progress ? s.period.latest_trade_time : tb(s.period.time).resize(so.period_length).add(1).toMilliseconds()).format('YYYY-MM-DD HH:mm:ss')[is_progress && !blink_off ? 'bgBlue' : 'grey'])
		process.stdout.write(' ' + formatCurrency(s.period.close, s.currency, true, true, true) + ' ' + s.product_id.grey)
		if (s.lookback[0]) {
			let diff = (s.period.close - s.lookback[0].close) / s.lookback[0].close
			process.stdout.write(z(7, formatPercent(diff), ' ')[diff >= 0 ? 'green' : 'red'])
		}
		else {
			process.stdout.write(z(7, '', ' '))
		}
		let volume_display = s.period.volume > 99999 ? abbreviate(s.period.volume, 2) : n(s.period.volume).format('0.00')
		volume_display = z(6, volume_display, ' ')
		if (volume_display.indexOf('.') === -1) volume_display = ' ' + volume_display
		process.stdout.write(volume_display[is_progress && blink_off ? 'cyan' : 'grey'])
		rsi(s, 'rsi', so.rsi_periods)
		if (typeof s.period.rsi === 'number') {
			let half = 5
			let bar = ''
				let stars = 0
				let rsi = n(s.period.rsi).format('00.00')
				if (s.period.rsi >= 50) {
					stars = Math.min(Math.round(((s.period.rsi - 50) / 50) * half) + 1, half)
					bar += ' '.repeat(half - (rsi < 100 ? 3 : 4))
					bar += rsi.green + ' '
					bar += '+'.repeat(stars).green.bgGreen
					bar += ' '.repeat(half - stars)
				}
				else {
					stars = Math.min(Math.round(((50 - s.period.rsi) / 50) * half) + 1, half)
					bar += ' '.repeat(half - stars)
					bar += '-'.repeat(stars).red.bgRed
					bar += rsi.length > 1 ? ' ' : '  '
						bar += rsi.red
						bar += ' '.repeat(half - 3)
				}
			process.stdout.write(' ' + bar)
		}
		else {
			process.stdout.write(' '.repeat(11))
		}
		if (s.strategy.onReport) {
			let cols = s.strategy.onReport.call(s.ctx, s)
			cols.forEach(function (col) {
				process.stdout.write(col)
			})
		}
		if (s.buy_order) {
			process.stdout.write(z(9, 'buying', ' ').green)
		}
		else if (s.sell_order) {
			process.stdout.write(z(9, 'selling', ' ').red)
		}
		else if (s.action) {
			process.stdout.write(z(9, s.action, ' ')[s.action === 'bought' ? 'green' : 'red'])
		}
		else if (s.signal) {
			process.stdout.write(z(9, s.signal, ' ')[s.signal === ('pump' || 'dump') ? 'white' : s.signal === 'buy' ? 'green' : 'red'])
		}
		else if (s.is_dump_watchdog || s.is_pump_watchdog) {
			process.stdout.write(z(9, 'P/D Calm', ' ').grey)
		}
		else if (s.max_profit_position.trend.buy != null || s.max_profit_position.trend.sell != null) {
			position_buy_profit = -1
			position_sell_profit = -1

			if (s.max_profit_position.trend.buy != null)
				position_buy_profit = s.max_profit_position.trend.buy.profit_pct

			if (s.max_profit_position.trend.sell != null)	
				position_sell_profit = s.max_profit_position.trend.sell.profit_pct

			buysell = (position_buy_profit > position_sell_profit ? 'B' : 'S')
			buysell_profit = (position_buy_profit > position_sell_profit ? formatPercent(position_buy_profit) : formatPercent(position_sell_profit))
			
			process.stdout.write(z(8, buysell + buysell_profit, ' ')[n(buysell_profit) > 0 ? 'green' : 'red'])
		}
		else {
			process.stdout.write(z(8, '', ' '))
		}

		if (s.max_profit_position.trail.buy != null || s.max_profit_position.trail.sell != null) {
			position_buy_profit = -1
			position_sell_profit = -1

			if (s.max_profit_position.trail.buy != null)
				position_buy_profit = s.max_profit_position.trail.buy.profit_pct

			if (s.max_profit_position.trail.sell != null)	
				position_sell_profit = s.max_profit_position.trail.sell.profit_pct
				
			buysell = (position_buy_profit > position_sell_profit ? 'B' : 'S')
			buysell_profit = (position_buy_profit > position_sell_profit ? formatPercent(position_buy_profit) : formatPercent(position_sell_profit))

			process.stdout.write(z(8, buysell + buysell_profit, ' ')['yellow'])
		}
		else {
			process.stdout.write(z(8, '', ' '))
		}

		//Ho inzializzato i valori dentro getNext() di quantum-trade.js
		//		let orig_capital = s.orig_capital || s.start_capital
		//		let orig_price = s.orig_price || s.start_price

		//Ma esiste sicuro!!! A che serve l'if??? A meno che a questo punto non sia ancora stato chiamato syncBalance
		// che serve a creare il primo s.start_capital
		//		if (orig_capital) {
		if (s.orig_capital) {
			let asset_col = n(s.balance.asset).format(s.asset === 'BTC' ? '0.00000' : '0.00000000')
			if (s.available_balance && s.balance.asset != s.available_balance.asset) {
				asset_col += '(' + n(s.available_balance.asset).format(s.asset === 'BTC' ? '0.00000' : '0.00000000') + ')'
			}
			asset_col += ' ' + s.asset
			process.stdout.write(z((asset_col.length + 1), asset_col, ' ').white)
						
			let currency_col = n(s.balance.currency).format(isFiat() ? '0.00' : '0.00000000')
			if (s.available_balance && s.balance.currency != s.available_balance.currency) {
				currency_col += '(' + n(s.available_balance.currency).format(isFiat() ? '0.00' : '0.00000000') + ')'
			}
			currency_col += ' ' + s.currency
			process.stdout.write(z((currency_col.length + 1), currency_col, ' ').green)
			
			let consolidated = n(s.balance.currency).add(n(s.balance.asset).multiply(s.period.close))
			let profit = n(consolidated).divide(s.orig_capital).subtract(1).value()
			process.stdout.write(z(8, formatPercent(profit), ' ')[profit >= 0 ? 'green' : 'red'])
			
			let buy_hold = n(s.orig_capital).divide(s.orig_price).multiply(s.period.close)
			let over_buy_hold_pct = n(consolidated).divide(buy_hold).subtract(1).value()
			process.stdout.write(z(8, formatPercent(over_buy_hold_pct), ' ')[over_buy_hold_pct >= 0 ? 'green' : 'red'])
		}		
		
		if (!is_progress) {
			process.stdout.write('\n')
		}
	}

	function withOnPeriod (trade, period_id, cb) {
		//debug.msg('withOnPeriod')
		if (!clock && so.mode !== 'live' && so.mode !== 'paper') clock = lolex.install({ shouldAdvanceTime: false, now: trade.time })

		//Aggiorna il period e fa eseguire i calcoli alla strategia (senza inviare segnali di trade) 
		updatePeriod(trade)
		
		if (!s.in_preroll) {
			if (so.mode !== 'live')
				s.exchange.processTrade(trade)

			if (!so.manual) {
				executeStop()

				if (clock) {
					var diff = trade.time - now()

					// Allow some catch-up if trades are too far apart. Don't want all calls happening at the same time
					while (diff > 5000) {
						clock.tick(5000)
						diff -= 5000
					}
					clock.tick(diff)
				}

				if (s.signal) {
//					//Per evitare il doppio ordine  
//					var ora = moment()
//					if (ora > (s.last_executeSignal + 1000) && !s.hold_signal) {
//						debug.msg('withOnPeriod - chiamo executeSignal ' + s.signal + ' Time= ' + ora)
//						s.last_executeSignal = ora
//						executeSignal(s.signal)
//					} else {
//						debug.msg('withOnPeriod - non chiamo executeSignal: ' + ora + ' < ' + (s.last_executeSignal + 1000) + ' - hold=' + s.hold_signal)
////						pushMessage('withOnPeriod', 'non chiamo executeSignal. Controlla perchè', 0)
//					}
					debug.msg('withOnPeriod - emetto il segnale ' + s.signal)
					eventBus.emit(s.signal)
					
					s.signal = null
				}
			}
		}
		//A quanto sembra, s.last_period_id non serve a nulla
//		s.last_period_id = period_id
		cb()
	}

	
	

	var tradeProcessingQueue = async.queue(function({trade, is_preroll}, callback){
		onTrade(trade, is_preroll, callback)
	})

	function queueTrade(trade, is_preroll){
		tradeProcessingQueue.push({trade, is_preroll})
	}

	function onTrade(trade, is_preroll, cb) {
		//debug.msg ('onTrade')

		//Aggiorna i valori variabili di tutte le posizioni aperte (compresi i valori dei trailing stop)
		updatePositions(trade)

		//Non ho capito a cosa serve. s.period.time è il tempo di inizio del periodo, dovrebbe
		// essere per forza inferiore a trade.time (da cui deriva), quindi questo if non sarà mai
		// soddisfatto. Boh. Metto un debug per capire se qualche volta entra.
		if (s.period && trade.time < s.period.time) {
			debug.msg('*************************** onTrade. Sono dentro if misterioso *****************************')
			pushMessage('onTrade', 'Sono dentro if misterioso',0)
			return
		}

		var day = (new Date(trade.time)).getDate()
		if (s.last_day && day !== s.last_day) {
			s.day_count++
		}
		s.last_day = day

		//Se non esiste un period, ne inizializza uno con tutti i valori aggiornati al momento dal trade in esame
		if (!s.period) {
			initBuffer(trade)
		}

		s.in_preroll = is_preroll || (so.start && trade.time < so.start)

		//Se il trade è fuori dal period, allora controllo la strategia ed eseguo i trade signal
		if (trade.time > s.period.close_time) {
			//Sembra che non serva a nulla
			var period_id = tb(trade.time).resize(so.period_length).toString()

			s.strategy.onPeriod.call(s.ctx, s, function () {
				writeReport()
				s.acted_on_stop = false
				s.acted_on_trail_stop = false

				withOnPeriod(trade, period_id, cb)

				s.action = null
				
				//Aggiungi il periodo a s.lookback e a s.calc_lookback
				s.lookback.unshift(s.period)
				if (trade.time > s.period.calc_close_time) {
					s.calc_lookback.unshift(s.period)
				}
				
				//Ripulisci s.lookback e s.calc_lookback a un max di valori
				let max_length = 100
				if (s.lookback.length > max_length) {
					s.lookback.splice(max_length, (s.lookback.length - max_length))
//					debug.msg('onTrade - s.lookback ridotto a ' + s.lookback.length)
				}
				
				if (s.calc_lookback.length > max_length) {
					s.calc_lookback.splice(max_length, (s.calc_lookback.length - max_length))
//					debug.msg('onTrade - s.calc_lookback ridotto a ' + s.calc_lookback.length)
				}

				initBuffer(trade)
//				debug.msg('onTrade: chiamo withOnPeriod oltre period ' + s.signal + ' Time= ' + moment() + ' trade.time= ' + trade.time + ' s.period.close_time= ' + s.period.close_time)
			})
		}
		else {
//			debug.msg('onTrade: chiamo withOnPeriod dentro period ' + s.signal + ' Time= ' + moment())
			withOnPeriod(trade, period_id, cb)
		}
	}

	function onTrades(trades, is_preroll, cb) {
		if (_.isFunction(is_preroll)) {
			cb = is_preroll
			is_preroll = false
		}
		trades.sort(function (a, b) {
			if (a.time < b.time) return -1
			if (a.time > b.time) return 1
			return 0
		})
		var local_trades = trades.slice(0)
		var trade
		while( (trade = local_trades.shift()) !== undefined ) {
			queueTrade(trade, is_preroll)
		}
		if(_.isFunction(cb)) cb()
	}

	function updatePositions(trade) {
//		debug.msg('updatePositions')
		let max_profit = -1
		let max_trail_profit = -1
		s.max_profit_position = {
			trail: {
				buy: null,
				sell: null,
			},
			trend: {
				buy: null,
				sell: null,
			}
		}
		
		s.my_positions.forEach(function (position, index) {
			position.profit_pct = (position.side == 'buy' ? +1 : -1) * (trade.price - position.price) / position.price
//			debug.msg('updatePositions - max_profit= ' + max_profit, false)
			if (so.profit_stop_enable_pct && position.profit_pct >= (so.profit_stop_enable_pct / 100)) {
				position.profit_stop_limit = (position.side == 'buy' ? (Math.max(position.profit_stop_limit || trade.price, trade.price)) : (Math.min(position.profit_stop_limit || trade.price, trade.price)))
				position.profit_stop = position.profit_stop_limit + (position.side == 'buy' ? -1 : +1) * (position.profit_stop_limit * (so.profit_stop_pct / 100))
				if (position.profit_pct >= max_trail_profit) {
					max_trail_profit = position.profit_pct
					s.max_profit_position.trail[position.side] = position
//					debug.msg('updatePositions - max_profit_position_id.trail.' + position.side + ' = ' + position.id, false)
				}
			} 
			else if (position.profit_pct >= max_profit) {
				max_profit = position.profit_pct
				s.max_profit_position.trend[position.side] = position
//				debug.msg('updatePositions - position_max_profit_index= ' + position_max_profit_index, false)
			}
		})
	}

	function updateMessage() {
		side_trend_max_profit = null
		pct_trend_max_profit = null
		side_trail_max_profit = null
		pct_trail_max_profit = null
		
		if (s.max_profit_position.trend.buy != null || s.max_profit_position.trend.sell != null) {
			side_trend_max_profit = ((s.max_profit_position.trend.buy ? s.max_profit_position.trend.buy.profit_pct : -1) > (s.max_profit_position.trend.sell ? s.max_profit_position.trend.sell.profit_pct : -1) ? 'buy' : 'sell')
			pct_trend_max_profit = s.max_profit_position.trend[side_trend_max_profit].profit_pct
		}
		
		if (s.max_profit_position.trail.buy != null || s.max_profit_position.trail.sell != null) {
			side_trail_max_profit = ((s.max_profit_position.trail.buy ? s.max_profit_position.trail.buy.profit_pct : -1) > (s.max_profit_position.trail.sell ? s.max_profit_position.trail.sell.profit_pct : -1) ? 'buy' : 'sell')
			pct_trail_max_profit = s.max_profit_position.trail[side_trail_max_profit].profit_pct
		}
		
		var output_lines = []
		output_lines.push('Virtual balance ' + formatCurrency(s.real_capital, s.currency) + ' (' + formatCurrency(s.balance.currency, s.currency) + ' - ' + formatAsset(s.balance.asset, s.asset) + ')')
		output_lines.push('\n' + s.my_trades.length + ' trades over ' + s.day_count + ' days (' + n(s.my_trades.length / s.day_count).format('0.00') + ' trades/day)')
		output_lines.push('\n' + s.my_positions.length + ' positions opened' + (side_trend_max_profit ? (' (' + side_trend_max_profit[0] + formatPercent(pct_trend_max_profit) + ').') : '.'))
		output_lines.push(side_trail_max_profit ? ('\n Trailing position: ' + (side_trail_max_profit[0] + formatPercent(pct_trail_max_profit))) : '')
		pushMessage('Status', output_lines, 0)
	}

	return {
		writeHeader: function () {
			process.stdout.write([
				z(19, 'DATE', ' ').grey,
				z(17, 'PRICE', ' ').grey,
				z(9, 'DIFF', ' ').grey,
				z(10, 'VOL', ' ').grey,
				z(8, 'RSI', ' ').grey,
				z(32, 'ACTIONS', ' ').grey,
				//				z(so.deposit ? 38 : 25, 'BAL', ' ').grey,
				z(25, 'BAL', ' ').grey,
				z(22, 'PROFIT', ' ').grey
				].join('') + '\n')
		},
		update: onTrades,
		exit: function (cb) {
			if(tradeProcessingQueue.length()){
				tradeProcessingQueue.drain = () => {
					if(s.strategy.onExit) {
						s.strategy.onExit.call( s.ctx, s )
					}
					cb()
				}
			} else {
				if(s.strategy.onExit) {
					s.strategy.onExit.call( s.ctx, s )
				}
				cb()
			}
		},

		executeSignal: executeSignal,
		writeReport: writeReport,
		syncBalance: syncBalance,
		updateMessage: updateMessage
	}
}
