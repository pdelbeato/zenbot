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
	
	let so = s.options

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

	s.product_id = so.selector.product_id
	s.asset = so.selector.asset
	s.currency = so.selector.currency
	s.is_dump_watchdog = false
	s.is_pump_watchdog = false
	s.last_executeSignal = 0
	s.hold_signal = false //Potrei usare s.action, se studio bene la cosa

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

	let asset_col_width = 0
	let currency_col_width = 0
	s.lookback = []
	s.calc_lookback = []
	s.day_count = 1
	s.my_trades = []
	s.my_positions = []
	s.my_prev_trades = []
	s.vol_since_last_blink = 0
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

	var notifier = notify(conf)

	function pushMessage(title, message, level = 0) {
		if (so.mode === 'live' || so.mode === 'paper') {
			notifier.pushMessage(title, message, level)
		}
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

	//Crea una posizione vuota, la inserisce in s.my_position e restituisce il suo id
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
				profit_stop_high: null,
				profit_stop: null
		}
		return position
	}
	
	//Funzione per ricavare il prezzo di acquisto partendo da quote.bid, considerando il markdown_buy_pct e l'opzione best_bid
	function nextBuyForQuote(s, quote) {
		var nbfq = n(quote.bid).subtract(n(quote.bid).multiply(s.options.markdown_buy_pct / 100)).add(so.best_bid ? s.product.increment : 0).format(s.product.increment, Math.floor)
		debug.msg('nextBuyForQuote - bid=' + quote.bid + ' return=' + nbfq)
		return nbfq
		// }
	}

	//Funzione per ricavare il prezzo di vendita partendo da quote.ask, considerando il markup_sell_pct e l'opzione best_ask
	function nextSellForQuote(s, quote) {
		var nsfq = n(quote.ask).add(n(quote.ask).multiply(s.options.markup_sell_pct / 100)).subtract(so.best_ask ? s.product.increment : 0).format(s.product.increment, Math.ceil)
		debug.msg('nextSellForQuote - bid=' + quote.ask + ' return=' + nsfq)
		return nsfq
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
			if (!s.acted_on_stop && position_stop && s.period.close < position_stop) {
//				s.signal = 'sell'
				s.acted_on_stop = true
				position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
				console.log(('\n' + position.side + ' stop triggered at ' + formatPercent(position.profit_pct) + ' trade profit for position ' + position.id + '\n').red)
				pushMessage('Stop Loss Protection', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_pct) + ')', 0)
				//Eseguo executeSignal su questa posizione, con modalità taker
				executeSignal(position_opposite_signal, position.id, undefined, undefined, false, true)
				return
			}

			if (!s.acted_on_trail_stop && position.profit_stop && s.period.close < position.profit_stop && position.profit_pct > 0) {
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
		//		let pre_asset = so.mode === 'sim' ? s.sim_asset : s.balance.asset
		s.exchange.getBalance({currency: s.currency, asset: s.asset}, function (err, balance) {
			if (err) return cb(err)
			//			let diff_asset = n(pre_asset).subtract(balance.asset)
			s.balance = balance
			getQuote(function (err, quote) {
				if (err) return cb(err)

				//post_currency praticamente è la differenza in asset dall'ultima chiamata resa in currency al prezzo quote.ask
				// A che serve????
				//				let post_currency = n(diff_asset).multiply(quote.ask)
				s.asset_capital = n(s.balance.asset).multiply(quote.ask).value()
				//Quantità ancora spendibile (aggiornato), ma calcolata sulla base dell'attuale valore dell'asset.
				// Quindi se l'asset aumenta di valore, posso spendere meno currency. Boh, mi sembra stupido.
				//				let deposit = so.deposit ? Math.max(0, n(so.deposit).subtract(s.asset_capital)) : s.balance.currency // zero on negative
				//				s.balance.deposit = n(deposit < s.balance.currency ? deposit : s.balance.currency).value()

				//Spostato s.real_capital fuori dall'if, così viene sempre aggiornato
				s.real_capital = n(s.balance.currency).add(s.asset_capital).value()

				if (!s.start_capital) {
					s.start_price = n(quote.ask).value()
					//					s.start_capital = n(s.balance.deposit).add(s.asset_capital).value()
					s.start_capital = n(s.balance.currency).add(s.asset_capital).value()
					//							s.real_capital = n(s.balance.currency).add(s.asset_capital).value()
					//					s.net_currency = s.balance.deposit

					if (so.mode !== 'sim') {
						//Se non esiste s.start_capital (quindi siamo all'inizio), manda un messaggio di update
						updateMessage()
					}
				}
				//Se s.start_capital esiste, quindi non siamo all'inizio, assegna a s.net_currency
				// il valore precedente (deposit?) più il valore in currency della differenza di asset
				// Ma a che serve?!?!?!?!
				//				else {
				//					s.net_currency = n(s.net_currency).add(post_currency).value()
				//				}

				//Posso non avere output, tanto aggiorno s.quote e s.balance
				cb(null, { balance, quote })
			})
		})
	}

	function placeOrder (signal, sig_id, opts, cb) {
		signal_id = signal + (sig_id || "")

		if (!s[signal_id + '_order']) {
			s[signal_id + '_order'] = {
				id: ('_' + crypto.randomBytes(4).toString('hex')),
				signal: signal,
				position_index: opts.position_index,
				price: opts.price,
				fixed_price: opts.fixed_price,
				size: opts.size,
				fee: opts.fee,
				orig_size: opts.size,
				remaining_size: opts.size,
				orig_price: opts.price,
				order_type: opts.is_taker ? 'taker' : so.order_type,
				product_id: s.product_id,
				post_only: conf.post_only,
				cancel_after: opts.cancel_after // s.cancel_after || 'day'
			}
		}
		debug.msg('placeOrder - order ' + signal_id)
		//debug.msg('s[_order] creato? ' + (s[type + '_order']? 'Creato' : 'Non creato'))
		let order = s[signal_id + '_order']
		order.price = opts.price
		order.size = opts.size
		order.fee = opts.fee
		order.remaining_size = opts.size

		let order_copy = JSON.parse(JSON.stringify(order))

		//Piazza l'ordine sull'exchange
		s.exchange[signal](order_copy, function (err, api_order) {
			if (err) return cb(err)
			s.api_order = api_order

			//Nel caso di rifiuto dell'ordine...
			if (api_order.status === 'rejected') {
				debug.msg('placeOrder - s.exchange rejected: ' + api_order.reject_reason)
				if (api_order.reject_reason === 'post only') {
					// trigger immediate price adjustment and re-order
					debug.msg('placeOrder - post-only ' + signal_id + ' failed, re-ordering')
					return cb(null, null)
				}
				else if (api_order.reject_reason === 'balance') {
					// treat as a no-op.
					debug.msg('placeOrder - not enough balance for ' + signal_id + ', aborting')
					return cb(null, false)
				}
				else if (api_order.reject_reason === 'price') {
					// treat as a no-op.
					debug.msg('placeOrder - invalid price for ' + signal_id + ', aborting')
					return cb(null, false)
				}
				err = new Error('\norder rejected')
				err.order = api_order
				return cb(err)
			}
			debug.msg('placeOrder - ' + signal_id + ' order placed at ' + formatCurrency(order.price, s.currency))
			order.order_id = api_order.id

			//Con ordine piazzato, lo marca temporalmente
			if (!order.time) {
				order.orig_time = new Date(api_order.created_at).getTime()
			}
			order.time = new Date(api_order.created_at).getTime()
			order.local_time = now()
			order.status = api_order.status
			//console.log('\ncreated ' + order.status + ' ' + type + ' order: ' + formatAsset(order.size) + ' at ' + formatCurrency(order.price) + ' (total ' + formatCurrency(n(order.price).multiply(order.size)) + ')\n')

			setTimeout(function() { checkOrder(order, signal, sig_id, cb) }, so.order_poll_time)
		})
	}

	function getQuote (cb) {
		s.exchange.getQuote({product_id: s.product_id}, function (err, quote) {
			if (err) return cb(err)
			s.quote = quote
			cb(null, quote)
		})
	}

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
	function executeSignal (signal, sig_id, size, price, is_reorder, is_taker, _cb) {
		let expected_fee = 0
		let fixed_price
		
		signal_id = signal + (sig_id || "")
		
		let working_position_index = (s[signal_id + '_order'] ? s[signal_id + '_order'].position_index : null)
		let working_position = null
		
		if (!signal.includes('buy') && !signal.includes('sell')) {
			debug.msg('executeSignal - signal non contiene buy/sell. Esco')
			_cb && _cb(null, null)
			return
		}		
		
		//Se non specifico il sig_id, allora è un ordine dettato dalla strategia
		if (!sig_id) {
			signal_opposite = (signal === 'buy' ? 'sell' : 'buy')
			//Cancello gli ordini di senso opposto ancora in essere
			if (s[signal_opposite + '_order'])
				delete s[signal_opposite + '_order']
		}
		
		//Il blocco seguente qui non ha senso. Lo sposto dentro syncBalance
//		//Se non specifico il sig_id e non è un riordine, allora è un ordine dettato dalla strategia
//		if (!is_reorder) {
//			if (!sig_id) {
//				signal_opposite = (signal === 'buy' ? 'sell' : 'buy')
//				//Cancello gli ordini di senso opposto ancora in essere
//				if (s[signal_opposite + '_order'])
//					delete s[signal_opposite + '_order']
//				if (s.max_profit_position_id.trend[signal_opposite])
////******************Però se non è profittevole, allora annullo l'ordine e non va bene
//					working_position_index = s.my_positions.findIndex(x => x.id == s.max_profit_position_id.trend[signal_opposite])
//			}
//			else {
//				working_position_index = s.my_positions.findIndex(x => x.id == sig_id)
//
//				//Controllo coerenza signal con posizione
//				if (signal == working_position.side) {
//					debug.msg('executeSignal - signal ' + signal + ' non coerente con la posizione (' + working_position-side + ') '+ working_position_index)
//					_cb && _cb(null, null)
//					return
//				}
//			}
//		}
//
//		//Assegno la working_position, se esiste working_position_index
//		if (working_position_index != null)
//			working_position = s.my_positions[working_position_index]
//		else
//			working_position = null
					
		debug.msg('executeSignal - ' + signal_id + ' - riordine ' + is_reorder)
		debug.msg('executeSignal - ' + (s[signal_id + '_order']? ('s[' + signal_id + '_order] esiste') : ('s[' + signal_id + '_order] non esiste')))

		let cb = function (err, order) {
			if (!order) {
				debug.msg('executeSignal - cb: cancello s[' + signal_id + '_order]')
				delete s[signal_id + '_order']
				if (working_position) {
					working_position.profit_stop = null
					working_position.profit_stop_high = null
				}
				s.acted_on_trail_stop = null
				s.acted_on_trend = null
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
		}

		s.last_signal = signal
		
		//Controllo se l'ordine è già stato piazzato
		//Anticipo qui la chiamata a questo controllo perchè mi sembra inutile
		// fargli fare altri controlli nel frattempo.
		if (!is_reorder && s[signal_id + '_order']) {
			debug.msg('executeSignal - not is_reorder && esiste s[' + signal_id + '_order]. Ordine già piazzato!!')
			
			//Mi sembra inutile, dovrebbe già essere così
			if (is_taker) s[signal_id + '_order'].order_type = 'taker'
			
			// order already placed
			_cb && _cb(null, null)
			return
		}
		
		//Potrebbe servire in alcune strategie
		if (!sig_id)
			s.acted_on_trend = true
		else
			s.acted_on_trend = false
		
		//Questi controlli solo se sono ordini dettati dalla strategia e non a prezzo fisso
		if (!price) {
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
		
		syncBalance(function (err, {balance, quote}) {
			let fee, trade_balance, tradeable_balance

			if (err) {
				debug.msg('executeSignal - syncBalance - Error getting balance')
				err.desc = 'executeSignal - syncBalance - could not execute ' + signal_id + ': error fetching quote'
				return cb(err)
			}

			//Prepara il prezzo per l'ordine
			fixed_price = false
			if (price) {
				fixed_price = true
			} else {
				switch (signal) {
					case 'buy': { 
						price = nextBuyForQuote(s, s.quote)	//Si può eliminare s.quote
						break
					}
					case 'sell': { 
						price = nextSellForQuote(s, s.quote)
						break
					}
				}
			}
			
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
			
			//Se è un riordine assegno a size il valore del riordine preso da s[_order] (se esiste)
			// oppure dal valore passato alla funzione executeSignal (se s[_order] non esiste)
			if (is_reorder) {
				if (s[signal_id + '_order']) {
					size = n(s[signal_id + '_order'].remaining_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					debug.msg('executeSignal - is_reorder && s[' + signal_id + '_order]: Remaining size: ' + formatAsset(size, s.asset))
				} else {
					//Ma questo caso a che serve?
					debug.msg('executeSignal - is_reorder && not s[' + signal_id + '_order]: Remaining size: ' + formatAsset(size, s.asset))
				}
			} 
			//Se è un nuovo ordine, il valore a size è deciso da so.quantum_size o dalla posizione in utilizzo
			//Se è un ordine generale (no sig_id), cerco una posizione adatta all'esecuzione dell'ordine 
			// (la posizione con il massimo profitto), altrimenti proseguo con l'ordine standard
			else {
				if (!sig_id) {
					if (s.max_profit_position_id.trend[signal_opposite]) {
						//******************Però se non è profittevole, allora annullo l'ordine e non va bene
						working_position_index = s.my_positions.findIndex(x => x.id == s.max_profit_position_id.trend[signal_opposite])
						working_position = s.my_positions[working_position_index]
					}
				}
				else {
					working_position_index = s.my_positions.findIndex(x => x.id == sig_id)
					working_position = s.my_positions[working_position_index]

					//Controllo coerenza signal con posizione
					if (signal == working_position.side) {
						debug.msg('executeSignal - signal ' + signal + ' non coerente con la posizione (' + working_position-side + ') '+ working_position_index)
						_cb && _cb(null, null)
						return
					}
				}
					
				//Controllo profitto della posizione, solo se non sto eseguendo uno stop loss
				if (working_position && !s.acted_on_stop && so['max_' + signal + '_loss_pct'] != null && (working_position.profit_pct + so['max_' + signal + '_loss_pct'] > 0)) {
					let err = new Error('\nPosition ' + working_position.id + ' ProfitLoss protection')
					err.desc = 'refusing to ' + signal + ' at ' + formatCurrency(price, s.currency) + ', ' + (so['max_' + signal + '_loss_pct'] > 0 ? ' LOSS of ' : ' PROFIT of ') + formatPercent(working_position.profit_pct) + ' (limit ' + formatPercent(-so['max_' + signal + '_loss_pct'] / 100) + ')\n'

					working_position_index = null
					working_position = null

					//Esco solo se era un ordine sig_id, altrimenti proseguo con l'ordine standard long/short
					if (sig_id)
						return cb(err)
				}

				if (working_position) {
					//Cosa succede se tutti i fondi sono hold? In qualche modo me ne devo accorgere e liberarli o considerarli prima di fare questo controllo.
					// s.balance.asset restituisce i fondi liberi da hold. s.balance.asset_hold sono quelli on hold.
					size = (working_position.size < s.balance.asset) ? n(working_position.size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000') : s.balance.asset
							debug.msg('executeSignal - not is_reorder: Position: ' + working_position.id + ' Size: ' + formatAsset(size, s.asset) + ' (' + formatCurrency(so.quantum_size, s.currency) + ' su ' + formatCurrency(s.balance.currency, s.currency) + ')')
							debug.printPosition(working_position)
				} else {
					size = n(so.quantum_size).divide(price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					debug.msg('executeSignal - not is_reorder: Size: ' + formatAsset(size, s.asset) + ' (' + formatCurrency(so.quantum_size, s.currency) + ' su ' + formatCurrency(s.balance.currency, s.currency) + ')')
				}

			}

			if (so.use_fee_asset) {
				fee = 0
			} else if (so.order_type === 'maker') {
				fee = s.exchange.makerFee
			} else {
				fee = s.exchange.takerFee
			}				

			//Controllo sui fondi (currency se buy, asset se sell). Da eliminare una volta che capisco come mi risponde l'exchange
			// in caso di fondi insufficienti (potrei verificarlo con il sandbox).
			trade_balance = (size * price)
			tradeable_balance = trade_balance * 100 / (100 + fee)
			expected_fee = n(trade_balance).subtract(tradeable_balance).format('0.00000000', Math.ceil) // round up as the exchange will too

			if (signal === 'buy' && tradeable_balance >= s.balance.currency) {
				let err = new Error('\nInsufficient funds')
				err.desc = 'refusing to buy ' + formatCurrency(tradeable_balance, s.currency) + '. Insufficient funds (' + formatCurrency(s.balance.currency, s.currency) + ')'
				return cb(err)
			}
			if (signal === 'sell' && size >= s.balance.asset) {
				let err = new Error('\nInsufficient funds')
				err.desc = 'refusing to sell ' + formatAsset(size, s.asset) + '. Insufficient funds (' + formatAsset(s.balance.asset, s.asset) + ')'
				return cb(err)
			}

			if ((s.product.min_size && Number(size) >= Number(s.product.min_size)) || ('min_total' in s.product && s.product.min_total && n(size).multiply(price).value() >= Number(s.product.min_total))) {
				if (s.product.max_size && Number(size) > Number(s.product.max_size)) {
					debug.msg('executeSignal - size = s.product.max_size')
					size = s.product.max_size
				}

				debug.msg('executeSignal - preparing ' + signal_id + ' order over ' + formatAsset(size, s.asset) + ' of ' + formatCurrency(tradeable_balance, s.currency) + ' tradeable balance with a expected fee of ' + formatCurrency(expected_fee, s.currency) + ' (' + fee + '%)')

//				//Controllo se ho raggiunto il numero massimo di quantum acquistabili
//				if (s.my_positions.length >= so.max_nr_quantum) {
//				let err = new Error('\nmax quantum reached')
//				err.desc = 'refusing to buy. Max nr of quantum (' + so.max_nr_quantum + ') reached. Positions opened: ' + s.my_positions.length
//				return cb(err)
//				}

				//Controllo slippage solo sugli ordini non fixed price
				if (s[signal_id + '_order'] && s[signal_id + '_order'].fixed_price && so.max_slippage_pct != null) {
					slippage = Math.abs(n(s[signal_id + '_order'].orig_price).subtract(price).divide(s[signal_id + '_order'].orig_price).multiply(100).value())
					if (so.max_slippage_pct != null && slippage > so.max_slippage_pct) {
						let err = new Error('\nslippage protection')
						err.desc = 'refusing to buy at ' + formatCurrency(price, s.currency) + ', slippage of ' + formatPercent(slippage / 100)
						pushMessage('Slippage protection', 'aborting', 9)
						return cb(err)
					}
				}

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
							pushMessage('Buying ' + s.exchange.name.toUpperCase(), 'placing ' + signal + ' order at ' + formatCurrency(price, s.currency) + ', ' + formatCurrency(n(quote.bid - Number(price)).format('0.00'), s.currency) + ' under best bid\n', 9)
	
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
							pushMessage('Selling ' + formatAsset(size, s.asset) + ' on ' + s.exchange.name.toUpperCase(), 'placing sell order at ' + formatCurrency(price, s.currency) + ', ' + formatCurrency(n(Number(price) - quote.bid).format('0.00'), s.currency) + ' over best ask\n', 9)
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
					working_position.profit_stop_high = null
				}
				s.acted_on_trail_stop = null
				working_position = null
				working_position_index = null
				cb(null, null)
			}
		})

		function doOrder () {
			//debug.msg('doOrder')
			placeOrder(signal, sig_id, {
				position_index: working_position_index,
				size: size,
				price: price,
				fixed_price: fixed_price,
				fee: expected_fee || null,
				is_taker: is_taker,
				cancel_after: so.cancel_after || null //'day'
			}, function (err, order) {
				if (err) {
					err.desc = 'could not execute ' + signal_id + ': error placing order'
					return cb(err)
				}

				//Gestione eccezioni ed errori
				if (!order) {
					if (order === false) {
						// not enough balance, or signal switched.
						debug.msg('doOrder - not enough balance, or signal switched, cancel ' + signal_id)
						return cb(null, null)
					}
					if (s.last_signal !== signal) {
						// order timed out but a new signal is taking its place
						debug.msg('doOrder - signal switched, cancel ' + signal_id)
						return cb(null, null)
					}
					// order timed out and needs adjusting
					debug.msg('doOrder - ' + signal_id + ' order timed out, adjusting price')
					let remaining_size = s[signal_id + '_order'] ? s[signal_id + '_order'].remaining_size : size
							if (remaining_size !== size) {
								debug.msg('doOrder - remaining size: ' + remaining_size + ' of ' + s[signal_id + '_order'].size)
							}
					return executeSignal(signal, sig_id, remaining_size, undefined, true)
				}
				cb(null, order)
			})
		}
	}

	function executeOrder (trade, signal, sig_id) {
		signal_id = signal + (sig_id || "")
		position_index = s[signal_id + '_order'].position_index

		let price, fee = 0
		if (!so.order_type) {
			so.order_type = 'maker'
		}

		// If order is cancelled, but on the exchange it completed, we need to recover it here
		if (!s[signal_id + '_order'])
			s[signal_id + '_order'] = trade

		price = s[signal_id + '_order'].price
		
		if (so.order_type === 'maker') {
			if (s.exchange.makerFee) {
				fee = n(s[signal_id + '_order'].size).multiply(s.exchange.makerFee / 100).value()
			}
		}
		if (so.order_type === 'taker') {
			if (s.exchange.takerFee) {
				fee = n(s[signal_id + '_order'].size).multiply(s.exchange.takerFee / 100).value()
			}
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
			size: s[signal_id + '_order'].orig_size,
			fee: fee,
			price: price,
			order_type: so.order_type || 'taker',
			// profit: s.last_sell_price && (s.last_sell_price - price) / s.last_sell_price, //Da togliere/modificare
			profit: (position_index != null ? (s.my_positions[position_index].profit_pct : null),
			position_span: (position_index != null ? (moment.duration(trade.time - s.my_positions[position_index].time).humanize()) : null),
			cancel_after: so.cancel_after || null //'day'
		}
		s.my_trades.push(my_trade)

		if (so.stats) {
			let order_complete = '\n**** ' + signal.toUpperCase() + ' order completed at ' + moment(trade.time).format('YYYY-MM-DD HH:mm:ss') + ':\n\n' + formatAsset(my_trade.size, s.asset) + ' at ' + formatCurrency(my_trade.price, s.currency) + '\nTotal ' + formatCurrency(my_trade.size * my_trade.price, s.currency) + '\n'
			order_complete += n(my_trade.slippage).format('0.0000%') + ' slippage (orig. price ' + formatCurrency(s[signal_id + '_order'].orig_price, s.currency) + ')\nexecution: ' + moment.duration(my_trade.execution_time).humanize() + '\n'
			order_complete += 'Positions: ' + (s.my_positions.length+1) + '\n'
			if (position_index != null) {
				order_complete += '\n' + signal + ' price: ' + formatCurrency(s.my_positions[position_index].price, s.currency)
				order_complete += '\nProfit: ' + n(my_trade.profit).format('0.0000%')
				order_complete += '\nExecution: ' + moment.duration(my_trade.execution_time).humanize()
				order_complete += '\nPosition span: ' + my_trade.position_span
			}
			order_complete += (sig_id != null ? 'Catch position\n' : '')
			console.log((order_complete).cyan)
			pushMessage(s.exchange.name.toUpperCase(), order_complete, 5)
		}

		//E se stavo aprendo una posizione e la esegue solo parzialmente? Non ho position_index, ma qualcosa è stato comprato...
		if (position_index != null) {
			if (s.my_positions[position_index].size != my_trade.size) {
				s.my_positions[position_index].size -= my_trade.size
				debug.msg('executeOrder - posizione ' + position_index + ' non chiusa completamente. Rimangono ' + formatAsset(s.my_position[position_index].size, s.asset))
				//Da sistemare bene, perchè così facendo non si aggiorna il database MongoDB
			} else {
				//Elimino la posizione da s.my_positions
				debug.msg('executeOrder - delete position ' + position_index + ' (lenght attuale ' + s.my_positions.length +')')
				//Per poter cancellare la posizione dalla collection my_positions in quantum-trade
				s.working_position_id = s.my_positions[position_index].id
				s.my_positions.splice(position_index, 1)
				updatePositions(trade)

				debug.msg('executeOrder - Lista posizioni rimaste')
				debug.printPosition(s.my_positions)
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
					size: s[signal_id + '_order'].orig_size,
					fee: fee,
					price: price,
					buy_stop: (signal == 'buy' ? so.buy_stop_pct && n(price).add(n(price).multiply(so.buy_stop_pct/100)).value() : null),
					sell_stop: (signal == 'sell' ? so.sell_stop_pct && n(price).subtract(n(price).multiply(so.sell_stop_pct/100)).value() : null),
					profit_pct: null,
					profit_stop_high: null,
					profit_stop: null
			}
			debug.printPosition(my_position)
			s.my_positions.push(my_position)
			updatePositions(trade)
		}

		s['last_' + signal + '_price'] = my_trade.price
		s['last_' + signal + '_time'] = trade.time

		delete s[signal + '_order']
		debug.msg('executeOrder - delete s[' + signal + '_order]')
		//Cancella anche tutti gli ordini connessi con la posizione
		if (s[signal_id + '_order']) {
			delete s[signal_id + '_order']
			debug.msg('executeOrder - delete s[' + signal_id + '_order]')
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
		process.stdout.write('  ' + formatCurrency(s.period.close, s.currency, true, true, true) + ' ' + s.product_id.grey)
		if (s.lookback[0]) {
			let diff = (s.period.close - s.lookback[0].close) / s.lookback[0].close
			process.stdout.write(z(8, formatPercent(diff), ' ')[diff >= 0 ? 'green' : 'red'])
		}
		else {
			process.stdout.write(z(9, '', ' '))
		}
		let volume_display = s.period.volume > 99999 ? abbreviate(s.period.volume, 2) : n(s.period.volume).format('0.00')
		volume_display = z(8, volume_display, ' ')
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
//			process.stdout.write(z(9, s.signal || '', ' ')[s.signal ? s.signal === ('pump' || 'dump') ? 'white' : s.signal === 'buy' ? 'green' : 'red' : 'grey'])
			process.stdout.write(z(9, s.signal, ' ')[s.signal === ('pump' || 'dump') ? 'white' : s.signal === 'buy' ? 'green' : 'red'])
		}
		else if (s.is_dump_watchdog || s.is_pump_watchdog) {
			process.stdout.write(z(9, 'P/D Calm', ' ').grey)
		}
		// else if (s.last_trade_worth && !s.buy_order && !s.sell_order) {
		// process.stdout.write(z(8, formatPercent(s.last_trade_worth), ' ')[s.last_trade_worth > 0 ? 'green' : 'red'])
		// }
		else if (s.max_profit_position_id.trend.buy != undefined) {			
			position = s.my_positions.find(x => x.id == s.max_profit_position_id.trend.buy)
			process.stdout.write(z(8, ('B' + formatPercent(position.profit_pct)), ' ')[position.profit_pct > 0 ? 'green' : 'red'])
		}
		else if (s.max_profit_position_id.trend.sell != undefined) {			
			position = s.my_positions.find(x => x.id == s.max_profit_position_id.trend.sell)
			process.stdout.write(z(8, ('S' + formatPercent(position.profit_pct)), ' ')[position.profit_pct > 0 ? 'green' : 'red'])
		}
		else {
			process.stdout.write(z(8, '', ' '))
		}
		
		if (s.max_profit_position_id.trail.buy != undefined) {			
			position = s.my_positions.find(x => x.id == s.max_profit_position_id.trail.buy)
			process.stdout.write(z(8, ('B' + formatPercent(position.profit_pct)), ' ')['yellow'])
		}
		else if (s.max_profit_position_id.trail.sell != undefined) {			
			position = s.my_positions.find(x => x.id == s.max_profit_position_id.trail.sell)
			process.stdout.write(z(8, ('S' + formatPercent(position.profit_pct)), ' ')['yellow'])
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
			let asset_col = n(s.balance.asset).format(s.asset === 'BTC' ? '0.00000' : '0.00000000') + ' ' + s.asset
			asset_col_width = Math.max(asset_col.length + 1, asset_col_width)
			process.stdout.write(z(asset_col_width, asset_col, ' ').white)
			//			let deposit_col = n(s.balance.deposit).format(isFiat() ? '0.00' : '0.00000000') + ' ' + s.currency
			//			deposit_col_width = Math.max(deposit_col.length + 1, deposit_col_width)
			//			process.stdout.write(z(deposit_col_width, deposit_col, ' ').yellow)

			//Se esiste so.deposit, allora mostro anche la currency rimasta
			//			if (so.deposit) {
			let currency_col = n(s.balance.currency).format(isFiat() ? '0.00' : '0.00000000') + ' ' + s.currency
			currency_col_width = Math.max(currency_col.length + 1, currency_col_width)
			process.stdout.write(z(currency_col_width, currency_col, ' ').green)
			//				let circulating = s.balance.currency > 0 ? n(s.balance.deposit).divide(s.balance.currency) : n(0)
			//						process.stdout.write(z(8, n(circulating).format('0.00%'), ' ').grey)
			//			}
			//			let consolidated = n(s.net_currency).add(n(s.balance.asset).multiply(s.period.close))
			let consolidated = n(s.balance.currency).add(n(s.balance.asset).multiply(s.period.close))
			//			let profit = n(consolidated).divide(orig_capital).subtract(1).value()
			let profit = n(consolidated).divide(s.orig_capital).subtract(1).value()
			process.stdout.write(z(8, formatPercent(profit), ' ')[profit >= 0 ? 'green' : 'red'])
			//			let buy_hold = n(orig_capital).divide(orig_price).multiply(s.period.close)
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
					//Per evitare il doppio ordine  
					var ora = moment()
					if (ora > (s.last_executeSignal + 1000) && !s.hold_signal) {
						debug.msg('withOnPeriod - chiamo executeSignal ' + s.signal + ' Time= ' + ora)
						s.last_executeSignal = ora
						executeSignal(s.signal)
					} else {
						debug.msg('withOnPeriod - non chiamo executeSignal: ' + ora + ' < ' + (s.last_executeSignal + 1000) + ' - hold=' + s.hold_signal)
//						pushMessage('withOnPeriod', 'non chiamo executeSignal. Controlla perchè', 0)
					}
					
					s.signal = null
				}
			}
		}
		//A quanto sembra, s.last_period_id non serve a nulla
//		s.last_period_id = period_id
		cb()
	}

	function cancelOrder (order, signal, sig_id, do_reorder, cb) {
		signal_id = signal + (sig_id || "")
		
		s.exchange.cancelOrder({order_id: order.order_id, product_id: s.product_id}, function () {
			function checkHold (do_reorder, cb) {
				s.exchange.getOrder({order_id: order.order_id, product_id: s.product_id}, function (err, api_order) {
					if (api_order) {
						if (api_order.status === 'done') {
							order.time = new Date(api_order.done_at).getTime()
							order.price = api_order.price || order.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
							debug.msg('cancel failed, order done, executing')
							executeOrder(order, signal, sig_id)
							return syncBalance(function () {
								cb(null, order)
							})
						}

						s.api_order = api_order
						if (api_order.filled_size) {
							order.remaining_size = n(order.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
							debug.msg('cancelOrder: order.remaining_size= ' + order.remaining_size)
							if (!((s.product.min_size && Number(order.remaining_size) >= Number(s.product.min_size)) || (s.product.min_total && n(order.remaining_size).multiply(order.price).value() >= Number(s.product.min_total)))) {
								debug.msg('cancelOrder: order.remaining_size < minimo ordine possibile (o errore equivalente)')
								order.time = new Date(api_order.done_at).getTime()
								debug.msg('cancelOrder: order.time= ' + order.time)
								order.orig_size = order.orig_size - order.remaining_size
//************** Da sistemare questo punto. Se rimane un residuo, cancella lo stesso la posizione, invece deve lasciarla aperta con il rimanente
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
						if (signal === 'buy') on_hold = n(s.balance.currency).subtract(s.balance.currency_hold || 0).value() < n(order.price).multiply(order.remaining_size).value()
						else on_hold = n(s.balance.asset).subtract(s.balance.asset_hold || 0).value() < n(order.remaining_size).value()

						if (on_hold && s.balance.currency_hold > 0) {
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
			s.api_order = api_order
			order.status = api_order.status
			if (api_order.reject_reason) order.reject_reason = api_order.reject_reason

			//Ordine eseguito!!
			if (api_order.status === 'done') {
				order.time = new Date(api_order.done_at).getTime()
				order.price = api_order.price || order.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
				executeOrder(order, signal, sig_id)

				//Esco dalla funzione, restituendo syncBalance
				return syncBalance(function () {
					cb(null, order)
				})
			}
			if (order.status === 'rejected' && (order.reject_reason === 'post only' || api_order.reject_reason === 'post only')) {
				debug.msg('checkOrder - post-only ' + signal_id + ' failed, re-ordering')
				return cb(null, null)
			}
			if (order.status === 'rejected' && order.reject_reason === 'balance') {
				debug.msg('checkOrder - not enough balance for ' + signal_id + ', aborting')
				return cb(null, null)
			}

			//Controllo se è trascorso so.order_adjust_time senza che l'ordine sia stato eseguito.
			if (!order.fixed_price && (now() - order.local_time >= so.order_adjust_time)) {
				getQuote(function (err, quote) {
					if (err) {
						err.desc = 'could not execute ' + signal + ': error fetching quote'
						return cb(err)
					}
					let marked_price
					if (signal === 'buy') {
						//marked_price = nextBuyForQuote(s, quote) Non ha senso, perchè mi restituisce un valore corretto con il markdown/markup, quindi la verifica successiva fallisce sicuramente
//						marked_price = quote.bid
//						if (so.exact_buy_orders && n(order.price).value() != marked_price) {
//							debug.msg('checkOrder - ' + marked_price + ' vs! our ' + order.price)
//							cancelOrder(order, signal, sig_id, true, cb)
//						}
//						else
						if (n(order.price).value() < quote.bid) {
							debug.msg('checkOrder - ' + quote.bid + ' > our ' + order.price)
							cancelOrder(order, signal, sig_id, true, cb)
						}
						else {
							order.local_time = now()
							setTimeout(function() { checkOrder(order, signal, sig_id, cb) }, so.order_poll_time)
						}
					}
					
					if (signal === 'sell') {
						// marked_price = nextSellForQuote(s, quote) Non ha senso, perchè mi restituisce un valore corretto con il markdown/markup, quindi la verifica successiva fallisce sicuramente
//						marked_price = quote.ask
//						if (so.exact_sell_orders && n(order.price).value() != marked_price) {
//							debug.msg('checkOrder - ' + marked_price + ' vs! our ' + order.price)
//							cancelOrder(order, signal, sig_id, true, cb)
//						}
//						else
						if (n(order.price).value() > quote.ask) {
							debug.msg('checkOrder - ' + quote.ask + ' < our ' + order.price)
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
				
				//E' incluso tutto in withOnPeriod, quindi provo a farlo fare solo lì dentro
//				if (!s.in_preroll && !so.manual) {
//					executeStop()
//					if (s.signal) {
//						//Tentativo per evitare il doppio ordine  
//						//						debug.msg('onTrade: chiamo executeSignal ' + s.signal + ' Time= ' + moment())
//						//						executeSignal(s.signal)
//						var ora = moment()
//						if (ora > (s.last_executeSignal + 1000) && !s.hold_signal) {
//							debug.msg('onTrade - chiamo executeSignal ' + s.signal + ' Time= ' + ora)
//							s.last_executeSignal = ora
//							executeSignal(s.signal)
//						} else {
//							debug.msg('onTrade - non chiamo executeSignal: ' + ora + ' < ' + (s.last_executeSignal + 100) + ' - hold=' +  s.hold_signal)
//						}
//						//Fine tentativo
//					}
//				}

				withOnPeriod(trade, period_id, cb)

				s.action = null
				
				//E' incluso in withOnPeriod
//				s.signal = null
				
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
				//Anticipo per fargli fare le azioni che ho commentato
//				withOnPeriod(trade, period_id, cb)
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
		s.max_profit_position_id = {
			trail: {
				buy: undefined,
				sell: undefined,
			},
			trend: {
				buy: undefined,
				sell: undefined,
			}
		}
		
		s.my_positions.forEach(function (position, index) {
//			position.profit_pct = position.type === 'buy' ? (trade.price - position.price) / position.price : (position.price - trade.price) / position.price
			position.profit_pct = (position.side == 'buy' ? +1 : -1) * (trade.price - position.price) / position.price
//			max_profit = (max_profit ? max_profit : position.profit_pct)
//			debug.msg('updatePositions - max_profit= ' + max_profit, false)
			if (so.profit_stop_enable_pct && position.profit_pct >= (so.profit_stop_enable_pct / 100)) {
				position.profit_stop_high = Math.max(position.profit_stop_high || trade.price, trade.price)
				position.profit_stop = position.profit_stop_high - (position.profit_stop_high * (so.profit_stop_pct / 100))
				if (position.profit_pct >= max_trail_profit) {
					max_trail_profit = position.profit_pct
					s.max_profit_position_id.trail[position.side] = position.id
//					debug.msg('updatePositions - max_profit_position_id.trail.' + position.side + ' = ' + position.id, false)
				}
			} 
			else if (position.profit_pct >= max_profit) {
				max_profit = position.profit_pct
				s.max_profit_position_id.trend[position.side] = position.id
//				debug.msg('updatePositions - position_max_profit_index= ' + position_max_profit_index, false)
			}
		})
	}

	function updateMessage() {
		side_trend_max_profit = null
		pct_trend_max_profit = null
		side_trail_max_profit = null
		pct_trail_max_profit = null
		
		if (s.max_profit_position_id.trend.buy != undefined || s.max_profit_position_id.trend.sell != undefined) {
			side_trend_max_profit = (s.max_profit_position_id.trend.buy > s.max_profit_position_id.trend.sell ? 'buy' : 'sell')
			pct_trend_max_profit = s.max_profit_position_id.trend[side_trend_max_profit]
		}
		
		if (s.max_profit_position_id.trail.buy != undefined || s.max_profit_position_id.trail.sell != undefined) {
			side_trail_max_profit = (s.max_profit_position_id.trail.buy > s.max_profit_position_id.trail.sell ? 'buy' : 'sell')
			pct_trail_max_profit = s.max_profit_position_id.trail[side_trail_max_profit]
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
