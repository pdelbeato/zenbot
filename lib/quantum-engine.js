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
let nice_errors = new RegExp(/(protection|watchdog|calmdown|funds|size)/)

module.exports = function (s, conf) {
	let so = s.options
	var notifier = notify(conf)
	
//	var max_requests_per_second = 5
	
	s.eventBus = conf.eventBus
	s.product_id = so.selector.product_id
	s.asset = so.selector.asset
	s.currency = so.selector.currency
	s.is_dump_watchdog = false
	s.is_pump_watchdog = false
//	s.next_order = 0
//	s.next_check = 0
	s.hold_signal = false
	
	s.lookback = []
	s.day_count = 1
	s.my_trades = []
	s.my_prev_trades = []
	s.vol_since_last_blink = 0
	s.orders = []
	s.positions = []
		
	//Inizializza i flag per gli ordini
	var orderFlag = {
		free: 0,
		manual: 1,
		catching: 2,
		trailstop: 4,
		stoploss: 8,
	}
	
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

	s.eventBus.on('trade', queueTrade)
	s.eventBus.on('trades', onTrades)
	
	//Attiva il listener per gli ordini di tipo manual
	s.eventBus.on('manual', (signal, position_id, fixed_size, fixed_price, is_reorder, is_taker= false) => {
		debug.msg('Listener -> manual ' + signal + (fixed_size ? (' ' + formatAsset(fixed_size, s.asset)) : '') + (fixed_price ? (' at ' + formatCurrency(fixed_price, s.currency)) : ''))
		executeSignal (signal, 'manual', position_id, fixed_size, fixed_price, false, is_taker)
	})
	
	//Attiva il listener per gli ordini di tipo catch per le posizioni appena aperte, se l'opzione è attiva
	if (so.catch_order_pct > 0) {
		s.eventBus.on('orderExecuted', (signal, sig_kind, position_id) => {
			position = s.positions.find(x => x.id === position_id)
	
			if (position && !position.locked && !positionStatus(position, 'Check', 'catching')) {
				signal_opposite = (signal === 'buy' ? 'sell' : 'buy')
				target_price = n(position.price).multiply((signal === 'buy' ? (1 + so.catch_order_pct/100) : (1 - so.catch_order_pct/100))).format(s.product.increment, Math.floor)
				debug.msg('Listener -> catching position ' + signal_opposite + ' ' + sig_kind + ' ' + position_id + ' at ' + target_price)
				executeSignal(signal_opposite, 'catching', position_id, null, target_price)  
			}
		})
	}
	
	//Funzione per assegnare a so.strategy[strategia_in_esame].opts[nome_opzione] il valore definito nel file della strategia
	s.ctx = {
		option: function (strategy_name, option_name, desc, type, def) {
			if (typeof so.strategy[strategy_name].opts[option_name] === 'undefined') {
				so.strategy[strategy_name].opts[option_name] = def
			}
		}
	}
	
	//Inizializzo le strategie
	debug.msg('Inizializzo le strategie')
	Object.keys(so.strategy).forEach(function (strategy_name, index) {
		so.strategy[strategy_name].lib = require(path.resolve(__dirname, `../extensions/strategies/${strategy_name}/strategy`))
		
		//Aggiunge la strategia alla lista degli orderFlag
		orderFlag[strategy_name] = Math.pow(2, (index + 4))
		debug.msg('Inizializzazione strategia - orderFlag[' + strategy_name + ']= ' + orderFlag[strategy_name])
		console.log(orderFlag)
			
		so.strategy[strategy_name].calc_lookback = []
		
		if (so.strategy[strategy_name].lib.getOptions) {
			//Applica a s.ctx il metodo getOptions preso da so.strategy[strategy_name] 
			// e quindi chiama la funzione option() di s.ctx per ogni option di getOptions
			// Alla fine avremo 
			so.strategy[strategy_name].lib.getOptions.call(s.ctx, s)
		}
		
		//Attiva il listener per gli ordini della strategia
		s.eventBus.on(strategy_name, (signal, position_id= null, fixed_size= null, fixed_price= null, is_reorder= false, is_taker= false) => {
			debug.msg('Listener -> ' + strategy_name + ' ' + signal + (position_id? (' ' + position_id) : '') + (fixed_size? (' size= ' + fixed_size) : '') + (fixed_price? (' price= ' + fixed_price) : '') + (is_reorder? ' reorder' : '') + (is_taker? ' taker' : ''))
			executeSignal (signal, strategy_name, position_id, fixed_size, fixed_price, is_reorder, is_taker)
		})
		
		if (so.strategy[strategy_name].lib.orderExecuted) {
			s.eventBus.on((strategy_name + '_orderExecuted'), function(signal, position_id) {
				so.strategy[strategy_name].lib.orderExecuted(signal, position_id, conf)
			})
		}
	})
	// Fine assegnazione opzioni per la strategia
		
	
//	//Funzione per attivare il listener once per gli ordini di tipo standard
//	function switchOnListener() {
//		s.eventBus.once('standard', (signal, position_id, fixed_size, fixed_price, is_reorder, is_taker) => {
//			debug.msg('Listener -> standard ' + signal)
////			syncBalance(function (err) {
////				if (err) {
////					debug.msg('Listener - syncBalance - Error getting balance')
////					err.desc = 'Listener - syncBalance - could not execute ' + signal_id + ': error fetching quote'
////					setTimeout(switchOnListener, 100)
////					return
////				}
//				executeSignal (signal, 'standard', position_id, fixed_size, fixed_price, is_reorder, is_taker)
//				setTimeout(switchOnListener, 100)
////			})
//		})
//	}
	
//	switchOnListener()
	
	//Funzione per emettere un segnale sul bus
	function emitSignal (sig_kind, signal, position_id, fixed_size, fixed_price, is_reorder, is_taker) {
		s.eventBus.emit(sig_kind, signal, position_id, fixed_size, fixed_price, is_reorder, is_taker)
	}
	
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
		s.balance = {asset: so.asset_capital, currency: so.currency_capital}
	}
	else {
		s.balance = {asset: 0, currency: 0}
	}

	//Funzione per la stampa a schermo di tutti i dati del programma, esclusi i dati storici e quelli di MongoDB
	function memDump () {
		if (!debug.on) return
		let s_copy = JSON.parse(JSON.stringify(s))
		delete s_copy.options.mongo
		delete s_copy.lookback
		Object.keys(s_copy.options.strategy).forEach(function (strategy_name, index) {
			delete s_copy.options.strategy[strategy_name].calc_lookback
		})
		console.error(s_copy)
	}
	
	if (conf.output.api.on) {
		s.boot_time = (new Date).getTime()
		s.tz_offset = new Date().getTimezoneOffset()
		s.last_trade_id = 0
		s.trades = []
	}
	
	function pushMessage(title, message, level = 0) {
		if (so.mode === 'live' || so.mode === 'paper')
			notifier.pushMessage(title, message, level)
	}

	function isFiat() {
		return !s.currency.match(/^BTC|ETH|XMR|USDT$/)
	}

	//Inizializza un period
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
		}
		Object.keys(so.strategy).forEach(function (strategy_name, index) {
			so.strategy[strategy_name].calc_close_time = tb(trade.time).resize(so.strategy[strategy_name].opts.period_calc).add(1).toMilliseconds() - 1
		})
	}
	
	//Inizializza una posizione position_id, ma non la inserisce nell'array delle posizioni
	function initPosition (position_id = null) {
		position = {
				id: position_id,
				selector: so.selector.normalized,
				status: orderFlag.free,
				locked: false,
				side: null,
				price: null, //Prezzo medio della posizione
				size: 0, //Valore asset attuale della posizione
				value: 0, //Valore currency attuale della posizione
				time: null, //Time apertura della posizione
				sell_stop: null,
				buy_stop: null,
				profit_pct: null,
				profit_stop_limit: null,
				profit_stop: null				
		}		
		return position
	}
	
	//Inizializza un ordine e lo inserisce nell'array degli ordini
	function initOrder (orderSignal, orderKind = 'manual', position_id = null, is_taker = null, cb) {			
		order = {
			id: position_id,
			signal: orderSignal,
			kind: orderKind,
			time: null,
			orig_time: null, //Tempo di chiusura dell'ultimo trade della posizione
			local_time: null, //Tempo locale di chiusura dell'ultimo trade della posizione
			initial_price: null, //Prezzo iniziale dell'ultimo trade della posizione
			price: null, //Prezzo finale dell'ultimo trade della posizione
			fixed_price: null,
			fee: 0,
			size: null, //Size attuale del trade (variabile di servizio)
//			orig_size: null, //Size inizio trade (serve per i riordini)
			remaining_size: null, //Rimanenza del trade (serve per i riordini)
			filled_size: 0, //Size commerciato del trade (variabile di servizio)
			executed_value: 0, //Value commerciato del trade (variabile di servizio)
			order_type: is_taker ? 'taker' : so.order_type,
			order_id: null,
			order_status: null,
			product_id: s.product_id,
			post_only: conf.post_only,
			cancel_after: (orderKind === 'standard' ? so.cancel_after : null), // s.cancel_after || 'day'
			position: {}
		}
		
		let position = s.positions.find(x => x.id === position_id)
		if (position) {
			debug.msg('initOrder - Esiste una posizione ' + position_id + '. Associo s.orders ' + orderSignal + ' ' + orderKind + ' alla posizione')
			order.position = position
		}
		else {
			debug.msg('initOrder - Non esiste una posizione ' + position_id + '. Creo una posizione senza id.')
			order.position = initPosition()
			order.position.side = orderSignal //Side della posizione
		}
		
		s.orders.push(order)
		
		if (orderKind === 'manual')
			order.position.locked = true;
		
		//Lo status deve essere fissato una volta inserito l'ordine sull'exchange, quindi in placeOrder
//		orderStatus(order, undefined, undefined, undefined, 'Set', orderFlag[orderKind])
		
//		debug.msg('initOrder - ordine associato/creato:')
//		debug.printPosition(order)
		
		return order
	}
	
	//Funzione per ricavare il prezzo partendo da s.quote, considerando il markdown_buy/sell_pct e l'opzione best_bid/ask
	function nextPriceForQuote(signal) {
		switch (signal) {
			case 'buy': {
				//Da controllare Math.floor in quel punto, perchè credo che non faccia nulla
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
		s.vol_since_last_blink += trade.size

		Object.keys(so.strategy).forEach(function (strategy_name, index) {
			so.strategy[strategy_name].lib.calculate(s)
		})
		
		//Se c'è stato un nuovo trade, aggiungilo a s.trades
		if (s.trades && s.last_trade_id !== trade.trade_id) {
			s.trades.push(trade)
			s.last_trade_id = trade.trade_id
		}
		
		//Ripulisci s.trades a un max di valori
		let max_length = 1000
		if (s.trades.length > max_length) {
			s.trades.splice(max_length, (s.trades.length - max_length))
		}
	}

	//Controlla se è scattato uno stop e nel caso eseguilo
	function executeStop () {
		//Esegue questa funzione solo dopo 100 millisecondi
		if (now() > s.next_check) {
			s.next_check = now() + 100

			//Esegue il controllo per ogni posizione aperta
			s.positions.forEach( function (position, index) {
				position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
				position_stop = position[position_opposite_signal + '_stop']

				if (position_stop && !position.locked && !positionStatus(position, 'Check', 'stoploss') && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position_stop) < 0)) {
					console.log(('\n' + position_opposite_signal.toUpperCase() + ' stop loss triggered at ' + formatPercent(position.profit_pct/100) + ' trade profit for position ' + position.id + '\n').red)
					pushMessage('Stop Loss Protection', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_pct/100) + ')', 0)
					executeSignal(position_opposite_signal, 'stoploss', position.id, undefined, undefined, false, true)
					return
				}

				if (position.profit_stop && !position.locked && !positionStatus(position, 'Check', 'trailstop') && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position.profit_stop) < 0) && position.profit_pct > 0) {
					console.log(('\nProfit stop triggered at ' + formatPercent(position.profit_pct/100) + ' trade profit for position ' + position.id + '\n').green)
					pushMessage('Trailing stop', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_pct/100) + ')', 0)
					executeSignal(position_opposite_signal, 'trailstop', position.id, undefined, undefined, false, false)
					return
				}
			})
		}
	}

	//Funzione per aggiornare i valori balance:
	// balance.currency
	// balance.currency_hold
	// balance.asset
	// balance.asset_hold
	// available_balance.currency (currency disponibile al netto delle posizioni aperte in currency)
	// available_balance.asset (asset disponibile al netto delle posizioni aperte in asset)
	// available_balance.currency_hold (currency in hold al netto degli ordini buy aperti)
	// available_balance.asset_hold (asset in hold al netto degli ordini sell aperti)
	function syncBalance (cb = function() {}) {
		s.exchange.getBalance({currency: s.currency, asset: s.asset}, function (err, balance) {
			if (err) return cb(err)
			s.balance = balance
			s.available_balance = {
					currency: balance.currency,
					asset: balance.asset,
					currency_hold: balance.currency_hold,
					asset_hold: balance.asset_hold
			}

			getQuote(function (err) {
				if (err)
					return cb(err)

					s.asset_in_currency = n(s.balance.asset).multiply(s.quote.ask).value()
					s.real_capital = n(s.balance.currency).add(s.asset_in_currency).value()
					s.asset_capital = n(s.balance.currency).divide(s.quote.bid).add(s.balance.asset).value()

					s.positions.forEach(function (position) {
						if (position.side === 'buy') {
							s.available_balance.asset = n(s.available_balance.asset).subtract(position.size).format('0.00000000')
						}
						else {
							s.available_balance.currency = n(s.available_balance.currency).subtract(position.value).format(s.product.increment)
						}
					})

					s.orders.forEach(function (order) {
//						if (order.kind === 'manual') {
						//Se l'ordine è buy, allora ho impegnato currency nell'ordine, quindi devo sottrarla dal balance
						//Se l'ordine è sell, allora ho impegnato asset nell'ordine, quindi devo sottrarla dal balance
						if (order.signal === 'buy') {
							order_value = n(order.size).multiply(order.price)
							if (order.kind === 'manual') {
								s.available_balance.currency = n(s.available_balance.currency).subtract(order_value).format(s.product.increment)
							}
							s.available_balance.currency_hold = n(s.available_balance.currency_hold).subtract(order_value).format(s.product.increment)
						}
						else {
							if (order.kind === 'manual') {
								s.available_balance.asset = n(s.available_balance.asset).subtract(order.size).format('0.00000000')
							}
							s.available_balance.asset_hold = n(s.available_balance.asset_hold).subtract(order.size).format('0.00000000')
						}
//						}
					})

//					s.orders.forEach(function (order) {
//					if (order.signal === 'buy') {
//					let value_tmp = n(order.price).multiply(order.size).format(s.product.increment)
//					s.available_balance.currency_hold = n(s.available_balance.currency_hold).subtract(value_tmp).format(s.product.increment)
//					}
//					else {
//					s.available_balance.asset_hold = n(s.available_balance.asset_hold).subtract(order.size).format('0.00000000')
//					}
//					})

					if (!s.start_capital) {
						s.start_price = n(s.quote.ask).value()
						s.start_capital = n(s.balance.currency).add(s.asset_in_currency).value()
					}

//				debug.msg('syncBalance - balance= ' + JSON.stringify(s.balance) + ' ; available_balance= ' + JSON.stringify(s.available_balance))

				//Posso non avere output, tanto aggiorno s.quote e s.balance
				cb(null)
			})
		})
	}

	function getQuote (cb, forced = false) {
		s.exchange.getQuote({product_id: s.product_id}, function (err, quote) {
			if (err)
				return cb(err);

			s.quote = quote
			cb(null)
		}, forced)
	}


	function isOrderTooSmall(product, quantity, price) {
		if (product.min_size && Number(quantity) < Number(product.min_size))
			return true
			if (product.min_total && n(quantity).multiply(price).value() < Number(product.min_total))
				return true
				return false
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
	function executeSignal (signal, sig_kind = 'manual', position_id = null, fixed_size = null, fixed_price = null, is_reorder, is_taker, _cb) {
		if (s.in_preroll) return
		
		let expected_fee = 0
		let order_tmp
		var signal_opposite = (signal === 'buy' ? 'sell' : 'buy')
				
		let cb = function (err, order) {
			if (!order) {
				debug.msg('executeSignal - cb - cancello s.orders ' + signal + ' ' + sig_kind + ' ' + position_id)
				position = s.positions.find(x => x.id === position_id)
				if (position) {
					position.profit_stop = null
					position.profit_stop_limit = null
				}
//				s.acted_on_trail_stop = null
				s.acted_on_trend = null
				orderDelete(signal, sig_kind, position_id)
			}
			if (_cb) {
				_cb(err, order)
			}
			else if (err) {
				if (err.message.match(nice_errors)) {
					console.error('\n')
					console.error((err.message + ': ' + err.desc).red)
					console.error('\n')
				} else {
					memDump()
					console.error('\n')
					console.error(err)
					console.error('\n')
				}
			}
		}
		
//			if (err) {
//				if (_cb) {
//					_cb(err)
//				}
//				else if (err.message.match(nice_errors)) {
//					console.error('\n')
//					console.error((err.message + ': ' + err.desc).red)
//					console.error('\n')
//				}
//				else {
//					memDump()
//					console.error('\n')
//					console.error(err)
//					console.error('\n')
//				}
//			}
//			else if (_cb) {
//				_cb(null, order)
//			}
//		}
		
		//Eseguo il segnale solo se è di tipo buy o sell (no pump o dump o altri)
		if (!signal.includes('buy') && !signal.includes('sell')) {
			debug.msg('executeSignal - signal non contiene buy/sell. Esco')
			_cb && _cb(null, null)
			return
		}	
		
		//Se è un riordine...
		if (is_reorder) {
			//..ed esiste s.orders, allora lascio tutto così e vado avanti...
			order_tmp = orderExist(signal, sig_kind, position_id)
			if (order_tmp) {
				debug.msg('executeSignal - Riordine ' + signal + ' ' + sig_kind + ' ' + position_id)
			}
			//...altrimenti esco, perchè non può essere un riordine senza s.orders associato
			else {
				debug.msg('executeSignal - Riordine ma non esiste s.orders.' + signal + '.' + sig_kind + '.' + position_id + ' -> esco.')
				_cb && _cb(null, null)
				return
			}
		}
		//Se non è un riordine...
		else {
			//...ed esiste l'ordine associato, allora esco, perchè l'ordine è già in piedi
			if (orderExist(signal, sig_kind, position_id)) {
				debug.msg('executeSignal - Annullo perchè esiste già s.orders(' + signal + ', ' + sig_kind + ', ' + position_id + ')')
				_cb && _cb(null, null)
				return
			}
			//...altrimenti continuo con i controlli
			else {
				//Controlli timing (da sostituire con funzione?)
				//Questi controlli solo se sono ordini non a prezzo fisso, non trailing stop e non stop loss 
				if (!fixed_price && sig_kind != 'trailstop' && sig_kind != 'stoploss') {
					//Controllo se il watchdog è attivo
					if (s.is_dump_watchdog || s.is_pump_watchdog) {
						let err = new Error('\nPumpDump watchdog')
						err.desc = 'refusing to buy/sell. ' + (s.is_dump_watchdog ? 'Dump ' : 'Pump ') + ' Watchdog is active! Positions opened: ' + s.positions.length + '\n'
						return cb(err)
					}

					//Controllo se è passato il buy/sell_calmdown
					if (so.buy_calmdown && signal == 'buy') {
						if ((now() - (so.buy_calmdown*60*1000)) < s.last_buy_time) {
							let err = new Error('\nBuySell calmdown')
							err.desc = moment().format('YYYY-MM-DD HH:mm:ss') + ' - refusing to buy. Buy Calmdown is active! Last buy ' + moment(s.last_buy_time).format('YYYY-MM-DD HH:mm:ss') + ' Positions opened: ' + s.positions.length + '\n'
							return cb(err)
						}
					} else if (so.sell_calmdown && signal == 'sell') {
						if ((now() - (so.sell_calmdown*60*1000)) < s.last_sell_time) {
							let err = new Error('\nBuySell calmdown')
							err.desc = moment().format('YYYY-MM-DD HH:mm:ss') + ' - refusing to sell. Sell Calmdown is active! Last sell ' + moment(s.last_sell_time).format('YYYY-MM-DD HH:mm:ss') + ' Positions opened: ' + s.positions.length + '\n'
							return cb(err)
						}
					}
				}
				
				//Se esiste position_id, allora è un ordine specifico
				if (position_id) {
					//Se contemporaneamente c'è un ordine dello stesso tipo aperto su questa posizione, annullo questo executeSignal
					if (orderExist(signal, sig_kind, position_id)) {
						debug.msg('executeSignal - con position_id. Annullo, perchè esiste ordine ' + sig_kind + ' aperto su ' + position_id)
						_cb && _cb(null, null)
						return
					}
					
					//Se esiste una posizione position_id, allora creo l'ordine partendo da quella posizione
					position = s.positions.find(x => x.id === position_id)
					if (position) {
						//Controllo coerenza signal con eventuale posizione position_id
						if (position.side === signal) {
							debug.msg('executeSignal - con position_id. Annullo, perchè signal ' + signal + ' non coerente con la posizione (side = ' + position.side + ')')
							_cb && _cb(null, null)
							return
						}
						//Creo l'ordine a partire dai valori della posizione position_id
						else {
							debug.msg('executeSignal - con position_id. Inizializzo una posizione ' + signal + ' ' + sig_kind + ' ' + position_id)
							order_tmp = initOrder(signal, sig_kind, position_id, is_taker)
						}
					}
					//Non esiste una posizione position_id, quindi esco.
					else {
						debug.msg('executeSignal - con position_id. Annullo, perchè non esiste una posizione aperta ' + position_id)
						_cb && _cb(null, null)
						return
					}
				}
				//Se position_id non esiste, allora è un ordine non specifico
				else {
					//Se è un ordine di strategia... 
					if (so.strategy[sig_kind]) {			
						//...creo un ordine di strategia...
						
						//Se ce ne sono altri in piedi, non creo questo
						if (orderExist(signal, sig_kind, undefined)) {
							debug.msg('executeSignal - Annullo perchè esiste già s.orders ' + signal + ' ' + sig_kind)
							_cb && _cb(null, null)
							return
						}
						
						//Cerco una eventuale posizione aperta con il massimo profitto
						// (che sia superiore al limite imposto dalla configurazione)
						if (s.max_profit_position.trend[signal_opposite]) {
							position = s.max_profit_position.trend[signal_opposite]
							
							//La posizione individuata non ha profitto sufficiente, quindi esco
							if (so[signal + '_gain_pct'] != null && (position.profit_pct - so[signal + '_gain_pct'] < 0)) {
								debug.msg('executeSignal - ' + sig_kind + ' senza position_id - Non ci sono posizioni in profitto (max ' + n(position.profit_pct/100).format('0.00%') + ')')
								
								//Controllo se posso eseguire ordini long/short
								if ((signal == 'buy' && !so.active_long_position) || (signal == 'sell' && !so.active_short_position)) {
									debug.msg('executeSignal - Non posso operare ' + signal + ': so.active_position false')
									_cb && _cb(null, null)
									return //orderDelete(signal, sig_kind, position_id)
								}	
								
								//Creo un position_id da associare all'ordine
								position_id = crypto.randomBytes(4).toString('hex')
						
								//Creo l'ordine associato
								debug.msg('executeSignal - Creo nuovo ordine ' + signal + ' ' + sig_kind + ' ' + position_id)
								order_tmp = initOrder(signal, sig_kind, position_id, is_taker)
							}
							//La posizione individuata ha profitto sufficiente, quindi cancello l'ordine creato e
							// associo un ordine standard a quella posizione
							else {
								debug.msg('executeSignal - ' + sig_kind + ' senza position_id - Prendo max_profit_position.trend.' + signal_opposite + '.id ' + position.id + ' con profitto (' + n(position.profit_pct/100).format('0.00%') + ')')
								//orderDelete(signal, sig_kind, position_id)
								
								position_id = position.id
								debug.printPosition(position)

								order_tmp = initOrder(signal, sig_kind, position_id, is_taker)
							}
						}
						//Non ci sono posizioni da considerare. L'ordine di strategia è già in piedi.
						else {
							//Controllo se posso eseguire ordini long/short
							if ((signal == 'buy' && !so.active_long_position) || (signal == 'sell' && !so.active_short_position)) {
								debug.msg('executeSignal - Non posso operare ' + signal + ': so.active_position false')
								_cb && _cb(null, null)
								return //orderDelete(signal, sig_kind, position_id)
							}
							
							//Creo un position_id da associare all'ordine
							position_id = crypto.randomBytes(4).toString('hex')
					
							//Creo l'ordine associato
							debug.msg('executeSignal - senza position_id - Creo nuovo ordine ' + signal + ' ' + sig_kind + ' ' + position_id)
							order_tmp = initOrder(signal, sig_kind, position_id, is_taker)
						}

						//E' un ordine di strategia senza position_id 
						// Cancello TUTTI gli ordini di strategia di senso opposto ancora in essere
						debug.msg('executeSignal - Ordine ' + sig_kind + '. Cancello TUTTI gli ordini di senso opposto ancora in essere.')
						orderStatus(undefined, signal_opposite, sig_kind, undefined, 'Unset', sig_kind)
					}
					//Altrimenti creo un ordine sig_kind nuovo
					else {
						//Creo un position_id da associare all'ordine
						position_id = crypto.randomBytes(4).toString('hex')
				
						//Creo l'ordine associato
						debug.msg('executeSignal - senza position_id - Creo nuovo ordine ' + signal + ' ' + sig_kind + ' ' + position_id)
						order_tmp = initOrder(signal, sig_kind, position_id, is_taker)
					}
				}
			}
		}

		s.last_signal = signal

//		//Potrebbe servire in alcune strategie
//		if (!position_id)
//		s.acted_on_trend = true
//		else
//		s.acted_on_trend = false

		let fee, trade_balance, tradeable_balance

		//Sincronizzo balance e quote, che serviranno nel prosieguo
		syncBalance(function (err) {
			if (err) {
				if (err.desc) console.error(err.desc)
				if (err.body) console.error(err.body)
				throw err
			}

			//Prepara il PREZZO per l'ordine
			//Ha priorità il fized_price, altrimenti prende il price derivato dal quote coerente con il segnale.
			// Se è un ordine di mercato, allora prendo il price derivato dal quote coerente con il segnale opposto
			order_tmp.price = fixed_price || nextPriceForQuote((is_taker ? signal_opposite : signal))
			if (!order_tmp.initial_price)
				order_tmp.initial_price = order_tmp.price;

			if (fixed_price) 
				order_tmp.fixed_price = fixed_price;

			//Controlli sul prezzo (da sostituire con funzione?)

			//Controllo Limit Price Protection
			if (signal === 'buy' && so.buy_price_limit != null && order_tmp.price > so.buy_price_limit) {
				let err = new Error('\nPrice limit protection')
				err.desc = 'refusing to buy at ' + formatCurrency(order_tmp.price, s.currency) + ', buy price limit -> ' + formatCurrency(so.buy_price_limit, s.currency) + '\n'
				return cb(err)
			}
			if (signal === 'sell' && so.sell_price_limit != null && order_tmp.price < so.sell_price_limit) {
				let err = new Error('\nPrice limit protection')
				err.desc = 'refusing to sell at ' + formatCurrency(order_tmp.price, s.currency) + ', sell price limit -> ' + formatCurrency(so.sell_price_limit, s.currency) + '\n'
				return cb(err)
			}

			//Controllo slippage solo sugli ordini non fixed price
			if (!fixed_price && (sig_kind != 'stoploss') && so.max_slippage_pct != null) {
				slippage = Math.abs(n(order_tmp.initial_price).subtract(order_tmp.price).divide(order_tmp.initial_price).multiply(100).value())
				if (slippage > so.max_slippage_pct) {
					let err = new Error('\nSlippage protection')
					err.desc = position_id + ' refusing to buy at ' + formatCurrency(order_tmp.price, s.currency) + ', slippage of ' + formatPercent(slippage / 100)
					pushMessage('Slippage protection', ('aborting ' + signal + ' ' + sig_kind + ' ' + position_id), 9)
					return cb(err)
				}
			}

			//Controllo profitto della posizione, solo se non sto eseguendo uno stop loss, non è un riordine e non è fixed_price
			if (!is_reorder && (sig_kind != 'stoploss') && !fixed_price && order_tmp.position.profit_pct && so[signal + '_gain_pct'] != null && (order_tmp.position.profit_pct - so[signal + '_gain_pct'] < 0)) {
				let err = new Error('\nPosition ' + position_id + ' Profit protection')
				err.desc = 'refusing to ' + signal + ' at ' + formatCurrency(order_tmp.price, s.currency) + ', PROFIT of ' + formatPercent(order_tmp.position.profit_pct/100) + ' (limit ' + formatPercent(so[signal + '_gain_pct'] / 100) + ')\n'

				if (err.message.match(nice_errors)) {
					console.error((err.message + ': ' + err.desc).red)
				}
				return cb(err)
			}


			//Prepara la QUANTITA' per l'ordine
			order_tmp.size = n(fixed_size || order_tmp.remaining_size || order_tmp.position.size || n(so.quantum_value).divide(order_tmp.price)).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')

			if (order_tmp.remaining_size === null) {
				order_tmp.remaining_size = order_tmp.size
			}

			debug.msg('executeSignal - ' + position_id + ' Size: ' + formatAsset(order_tmp.size, s.asset))

			//Controlli sulle quantità di asset e currency (da sostituire con funzione?)

			//Controllo su min e max accettati dall'exchange
			if (isOrderTooSmall(s.product, order_tmp.size, order_tmp.price)) {
				let err = new Error('\nMinimum size')
				err.desc = 'refusing to ' + signal + ' ' + order_tmp.size + ' ' + s.asset + '. Minimum size not reached'
				return cb(null, null)
			}

			if (s.product.max_size && Number(order_tmp.size) > Number(s.product.max_size)) {
				debug.msg('executeSignal - size = s.product.max_size')
				order_tmp.size = s.product.max_size
			}

			//Calcolo fee
			if (so.use_fee_asset) {
				fee = 0
			} else if (so.order_type === 'maker') {
				fee = s.exchange.makerFee
			} else {
				fee = s.exchange.takerFee
			}		

			//Controllo fondi disponibili
			trade_balance = n(order_tmp.size).multiply(order_tmp.price)
			tradeable_balance = n(trade_balance).multiply(100).divide(100 + fee)
			expected_fee = n(trade_balance).subtract(tradeable_balance).format('0.00000000', Math.ceil) // round up as the exchange will too
			//Se è un ordine standard/catching/trailstop/stoploss, allora controllo di quanto balance effettivo posso disporre
			//  (balance reale meno le quantità bloccate dalle posizioni e dagli ordini manual più la quantità della posizione in esame, se esiste)
			//Se è un ordine manual, allora il controllo deve essere fatto su balance reale meno le quantità bloccate dalle posizioni e dagli ordini manual
//			Secondo me, è possibile togliere il controllo su manual. Verificare.		
//			available_balance_currency = (sig_kind === 'manual' ? s.available_balance.currency : (n(s.available_balance.currency).add(order_tmp.position.value)))
//			available_balance_asset = (sig_kind === 'manual' ? s.available_balance.asset : (n(s.available_balance.asset).add(order_tmp.position.size)))

			available_balance_currency = n(s.available_balance.currency).add(order_tmp.position.value)
			available_balance_asset = n(s.available_balance.asset).add(order_tmp.position.size)

			let order_tmp_catch = orderExist(undefined, 'catching', position_id)
			let order_tmp_catch_size = 0
			let order_tmp_catch_value = 0
			if (order_tmp_catch) {
				order_tmp_catch_size = order_tmp_catch.size
				order_tmp_catch_value = n(order_tmp_catch.size).multiply(order_tmp_catch.price).value()
			}

			debug.msg('executeSignal - preparing ' + signal + ' ' + sig_kind + ' ' + position_id + ' order over ' + formatAsset(order_tmp.size, s.asset) + ' of ' + formatCurrency(tradeable_balance, s.currency) + ' tradeable balance with a expected fee of ' + formatCurrency(expected_fee, s.currency) + ' (' + fee + '%)')

			//Controllo currency in hold
//			Da capire come modificare per intercettare anche gli hold di un id order
//			Cosa succede se tutti i fondi sono hold? In qualche modo me ne devo accorgere e liberarli o considerarli prima di fare questo controllo.
			// s.balance.asset e s.balance.currency restituiscono i fondi totali. s.balance.asset_hold e s.balance.currency_hold sono quelli on hold.
			switch (signal) {
			case 'buy': {
				if (Number(tradeable_balance) > Number(available_balance_currency)) {
					let err = new Error('\nInsufficient funds')
					err.desc = 'refusing to buy ' + formatCurrency(tradeable_balance, s.currency) + '. Insufficient funds (' + formatCurrency(available_balance_currency, s.currency) + ')'
					return cb(err)
				}
				else if (s.balance.currency_hold > 0 && n(s.balance.currency).subtract(s.balance.currency_hold).add(order_tmp_catch_value).value() < n(order_tmp.price).multiply(order_tmp.size).value()) {
					debug.msg('executeSignal - buy delayed: ' + s.available_balance.currency_hold + ' of funds on hold')
					debug.msg('executeSignal - s.available_balance.currency ' + s.available_balance.currency + '; s.balance.currency ' + s.balance.currency + ' - s.balance.currency_hold ' + s.balance.currency_hold + ' + order_tmp_catch_value ' + order_tmp_catch_value)
					return setTimeout(function () {
						if (s.last_signal === signal) {
							s.hold_signal = true
							executeSignal(signal, sig_kind, position_id, undefined, undefined, true)
						}
					}, conf.wait_for_settlement)
				}
				else {
					s.hold_signal = false
					pushMessage('Buying (' + sig_kind + ') ' + formatAsset(order_tmp.size, s.asset) + ' on ' + s.exchange.name.toUpperCase(), 'placing ' + signal + ' order at ' + formatCurrency(order_tmp.price, s.currency) + ', ' + formatCurrency(n(s.quote.bid - order_tmp.price).format('0.00'), s.currency) + ' under best bid\n', 9)

					doOrder()
				}
				break
			}
			case 'sell': {
				if (Number(order_tmp.size) > Number(available_balance_asset)) {
					let err = new Error('\nInsufficient funds')
					err.desc = 'refusing to sell ' + formatAsset(order_tmp.size, s.asset) + '. Insufficient funds (' + formatAsset(available_balance_asset, s.asset) + ')'
					return cb(err)
				}
				else if (s.balance.asset_hold > 0 && n(s.balance.asset).subtract(s.balance.asset_hold).add(order_tmp_catch_size).value() < n(order_tmp.size).value()) {
					debug.msg('executeSignal - sell delayed: ' + s.available_balance.asset_hold + ' of funds on hold')
					debug.msg('executeSignal - s.balance.asset ' + s.balance.asset + ' - s.balance.asset_hold ' + s.balance.asset_hold + ' + order_tmp_catch_size ' + order_tmp_catch_size)
					return setTimeout(function () {
						if (s.last_signal === signal) {
							s.hold_signal = true
							executeSignal(signal, sig_kind, position_id, undefined, undefined, true)
						}
					}, conf.wait_for_settlement)
				}
				else {
					s.hold_signal = false
					pushMessage('Selling (' + sig_kind + ') ' + formatAsset(order_tmp.size, s.asset) + ' on ' + s.exchange.name.toUpperCase(), 'placing sell order at ' + formatCurrency(order_tmp.price, s.currency) + ', ' + formatCurrency(n(order_tmp.price - s.quote.ask).format('0.00'), s.currency) + ' over best ask\n', 9)

					doOrder()
				}
				break
			}
			}
		})
//		debug.msg('executeSignal - exiting ' + signal + ' ' + sig_kind + ' ' + position_id)

		function doOrder () {
			//debug.msg('doOrder')

			//Cancello tutti gli eventuali ordini associati alla posizione prima di creare il nuovo ordine
			debug.msg('executeSignal - doOrder - Ordine ' + signal + ' ' + sig_kind + ' ' + position_id + '. Cancello TUTTI gli ordini connessi con la posizione ancora in essere.')
			positionStatus(order_tmp.position,'Free', undefined, function() {
				//Una volta inviato il segnale di cancellazione degli ordini, attendo so.order_poll_time prima di inviare il nuovo
				// ordine sull'exchange
				setTimeout(function() {
					placeOrder(function (err, order) {
						if (err) {
							err.desc = 'executeSignal - doOrder - Could not execute ' + signal + ' ' + sig_kind + ' ' + position_id + ': error placing order'
							return cb(err)
						}

						//Gestione eccezioni ed errori
						if (!order) {
							if (order === false) {
								// not enough balance, or signal switched.
								debug.msg('executeSignal - doOrder - not enough balance, or signal switched, cancel ' + signal + ' ' + sig_kind + ' ' + position_id)
								return cb(null, null)
							}
							if (s.last_signal !== signal) {
								// order timed out but a new signal is taking its place
								debug.msg('executeSignal - doOrder - signal switched, cancel ' + signal + ' ' + sig_kind + ' ' + position_id)
								return cb(null, null)
							}
							// order timed out and needs adjusting
							debug.msg('executeSignal - doOrder - ' + signal + ' ' + sig_kind + ' ' + position_id + ' order timed out, adjusting price')
//							let remaining_size = s.orders[signal_id] ? s.orders[signal_id].remaining_size : size
							if (order_tmp.remaining_size != order_tmp.size) {
								debug.msg('executeSignal - doOrder - remaining size: ' + order_tmp.remaining_size + ' of ' + order_tmp.size)
							}
							return executeSignal(signal, sig_kind, position_id, null, null, true, is_taker, _cb)
						}
						cb(null, order)
					})
				}, so.order_poll_time)
			})
		}

		function placeOrder (cb) {
			let order_copy = JSON.parse(JSON.stringify(order_tmp))

			delete order_copy.position

			// Gli ordini su exchange sono gli unici che devono essere semaforizzati. Le altre richieste dovrebbero lavorare tramite websocket
//			if (now() > s.next_order) {
//			debug.msg('placeOrder - ' + signal + ' ' + sig_kind + ' ' + position_id + ' - now() ' + now() + ' ; s.next_order ' + s.next_order)
//			s.next_order = now() + 1000/max_requests_per_second
			//Piazza l'ordine sull'exchange
			s.exchange[signal](order_copy, function (err, api_order) {					
				if (err)
					return cb(err);

				s.api_order = api_order

				//Nel caso di rifiuto dell'ordine...
				if (api_order.status === 'rejected') {
					debug.msg('executeSignal - placeOrder - s.exchange rejected: ' + api_order.reject_reason)
					if (api_order.reject_reason === 'post only') {
						// trigger immediate price adjustment and re-order
						debug.msg('executeSignal - placeOrder - post-only ' + signal + ' ' + sig_kind + ' ' + position_id + ' failed, re-ordering')
						getQuote(function (err) {
							debug.msg('placeOrder - Forzato il getQuote!!!')
							pushMessage('DEBUG', 'placeOrder - Forzato il getQuote!!!', 9)
							if (err) {
								debug.msg('placeOrder - Forzato il getQuote - getQuote -> err: ' + err)
							}
						}, true)
						return cb(null, null)
					}
					else if (api_order.reject_reason === 'balance') {
						// treat as a no-op.
						debug.msg('executeSignal - placeOrder - not enough balance for ' + signal + ' ' + sig_kind + ' ' + position_id + ', aborting')
						return cb(null, false)
					}
					else if (api_order.reject_reason === 'price') {
						// treat as a no-op.
						debug.msg('executeSignal - placeOrder - invalid price for ' + signal + ' ' + sig_kind + ' ' + position_id + ', aborting')
						return cb(null, false)
					}
					err = new Error('\norder rejected')
					err.order = api_order
					return cb(err)
				}

				debug.msg('placeOrder - ' + signal + ' ' + sig_kind + ' ' + position_id + ' order (id ' + api_order.id + ') placed at ' + formatCurrency(order_tmp.price, s.currency))
				order_tmp.order_id = api_order.id

				positionStatus(order_tmp.position, 'Set', sig_kind)

				//Con ordine piazzato, lo marca temporalmente
				if (!order_tmp.orig_time) {
					order_tmp.orig_time = new Date(api_order.created_at).getTime()
				}
				order_tmp.time = new Date(api_order.created_at).getTime()
				order_tmp.local_time = now()
				order_tmp.order_status = api_order.status

				debug.msg('placeOrder - order:')
				debug.printPosition(order_tmp)

				//Ripete il controllo dopo so.order_poll_time.
				setTimeout(function() { checkOrder(signal, sig_kind, position_id, cb) }, so.order_poll_time)
			})
//			}
//			else {
////			debug.msg('placeOrder - ' + signal + ' ' + sig_kind + ' ' + position_id + '. Attendo... (now()=' + now() + ' ; s.next_order ' + s.next_order + ')')
//			setTimeout(function() { placeOrder(cb) }, (s.next_order - now() + 1))
//			}
		}
	}

	function checkOrder (signal, sig_kind, position_id, cb) {
//		debug.msg('checkOrder')
		var order_tmp = s.orders.find(x => (x.signal === signal && x.kind === sig_kind && x.id === position_id))

		if (order_tmp.id != position_id) {
			debug.msg('checkOrder - order_tmp.id <> position_id !!!!')
			debug.printPosition(s.orders)
		}

		if (!positionStatus(order_tmp.position, 'Check', sig_kind)) {
			// signal switched, stop checking order
			debug.msg('checkOrder - signal switched during ' + signal + ' ' + sig_kind + ' ' + position_id + ', aborting')
			pushMessage('Signal switched during ' + signal + ' ' + sig_kind + ' ' + position_id, ' aborting', 9)
			return cancelOrder(signal, sig_kind, position_id, false, cb)
		}

		s.exchange.getOrder({order_id: order_tmp.order_id, product_id: s.product_id}, function (err, api_order) {
			if (err) {
				return cb(err)
			}

			if (api_order) {
				s.api_order = api_order
				order_tmp.order_status = api_order.status

				if (api_order.reject_reason) {
					order_tmp.reject_reason = api_order.reject_reason
				}

				//Ordine eseguito!!
				if (api_order.status === 'done') {
					order_tmp.time = new Date(api_order.done_at).getTime()
					order_tmp.price = api_order.price || order_tmp.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
					order_tmp.filled_size = api_order.filled_size
					order_tmp.executed_value = n(order_tmp.filled_size).multiply(order_tmp.price).format(s.product.increment)
//					order_tmp.executed_value = n(order_tmp.executed_value).add(api_order.executed_value)
					order_tmp.remaining_size = n(order_tmp.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					if (order_tmp.position.side == signal) {
						debug.msg('checkOrder - getOrder - ' + position_id + ' side == signal')
						order_tmp.position.value = n(order_tmp.position.value).add(order_tmp.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
						order_tmp.position.size = n(order_tmp.position.size).add(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					}
					else {
						debug.msg('checkOrder - getOrder - ' + position_id + ' side != signal')
						order_tmp.position.value = n(order_tmp.position.value).subtract(order_tmp.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
						order_tmp.position.size = n(order_tmp.position.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					}
					debug.msg('checkOrder - getOrder - ' + position_id + ' (id ' + order_tmp.id + ' ; order_id ' + order_tmp.order_id + ') done')
					debug.msg('api_order.filled_size= ' + api_order.filled_size)
					debug.msg('order_tmp.filled_size= ' + order_tmp.filled_size + ' ; order_tmp.executed_value= ' + order_tmp.executed_value + ' ; order_tmp.remaining_size= ' + order_tmp.remaining_size + ' (' + typeof order_tmp.remaining_size + ')')
					debug.msg('order_tmp.position.value= ' + order_tmp.position.value + ' ; order_tmp.position.size= ' + order_tmp.position.size)
					debug.printPosition(order_tmp)
					executeOrder(signal, sig_kind, position_id)

					//Esco dalla funzione, restituendo syncBalance
					return syncBalance(function () {
						cb(null, true)
					})
//					return cb(null, true)
				}

				//Ordine rifiutato
				if (order_tmp.order_status === 'rejected' && order_tmp.reject_reason === 'post only') {
					debug.msg('checkOrder - post-only (' + signal + ' ' + sig_kind + ' ' + position_id + ') failed, aborting')
					return cb(null, false)
				}
				if (order_tmp.order_status === 'rejected' && order_tmp.reject_reason === 'balance') {
					debug.msg('checkOrder - not enough balance for ' + signal + ' ' + sig_kind + ' ' + position_id + ', aborting')
					return cb(null, false)
				}
			}				

			//Controllo se è trascorso so.order_adjust_time senza che l'ordine sia stato eseguito.
			if (!order_tmp.fixed_price && (now() - order_tmp.local_time >= so.order_adjust_time)) {
				getQuote(function (err) {
					if (err) {
						err.desc = 'could not execute ' + signal + ': error fetching quote'
						return cb(err)
					}

					if (signal === 'buy') {
						if (Number(order_tmp.price) < Number(s.quote.bid)) {
							debug.msg('checkOrder - ' + position_id + ' - ' + Number(s.quote.bid) + ' > our ' + Number(order_tmp.price))
							cancelOrder(signal, sig_kind, position_id, true, cb)
						}
						else {
							order_tmp.local_time = now()
							//Ripete il controllo dopo so.order_poll_time.
							setTimeout(function() { checkOrder(signal, sig_kind, position_id, cb) }, so.order_poll_time)
						}
					}

					if (signal === 'sell') {
						if (Number(order_tmp.price) > Number(s.quote.ask)) {
							debug.msg('checkOrder - ' + position_id + ' - ' + Number(s.quote.ask) + ' < our ' + Number(order_tmp.price))
							cancelOrder(signal, sig_kind, position_id, true, cb)
						}
						else {
							order_tmp.local_time = now()
							//Ripete il controllo dopo so.order_poll_time.
							setTimeout(function() { checkOrder(signal, sig_kind, position_id, cb) }, so.order_poll_time)
						}
					}
				})
			}
			else {
				//Ripete il controllo dopo so.order_poll_time.
				setTimeout(function() { checkOrder(signal, sig_kind, position_id, cb) }, so.order_poll_time)
			}
		})
	}
	
	function cancelOrder (signal, sig_kind, position_id, do_reorder, cb) {
//		debug.msg('cancelOrder')
		var order_tmp = s.orders.find(x => (x.signal === signal && x.kind === sig_kind && x.id === position_id))

		if (order_tmp.id != position_id) {
			debug.msg('cancelOrder - order_tmp.id <> position_id !!!!')
			debug.printPosition(s.orders)
		}

//		if (now() > s.next_order) {
			debug.msg('cancelOrder - ' + signal + ' ' + sig_kind + ' ' + position_id + ' - now() ' + now() + ' ; s.next_order ' + s.next_order)
//			s.next_order = now() + 1000/max_requests_per_second
			s.exchange.cancelOrder({order_id: order_tmp.order_id, product_id: s.product_id}, function () {
				function checkHold (do_reorder, cb) {
					s.exchange.getOrder({order_id: order_tmp.order_id, product_id: s.product_id}, function (err, api_order) {
//						s.next_order = now() + 1000/max_requests_per_second
						//Esiste l'ordine sull'exchange
						if (api_order) {
							s.api_order = api_order
							order_tmp.order_status = api_order.status

							if (api_order.status === 'done' || api_order.filled_size) {
								order_tmp.time = new Date(api_order.done_at).getTime()
								order_tmp.price = api_order.price || order_tmp.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
								order_tmp.filled_size = api_order.filled_size
								order_tmp.executed_value = n(order_tmp.filled_size).multiply(order_tmp.price).format(s.product.increment)
//								order_tmp.executed_value = n(order_tmp.executed_value).add(api_order.executed_value)
								order_tmp.remaining_size = n(order_tmp.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
								if (order_tmp.position.side == signal) {
									debug.msg('cancelOrder - getOrder - ' + position_id + ' side == signal')
									order_tmp.position.value = n(order_tmp.position.value).add(order_tmp.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
									order_tmp.position.size = n(order_tmp.position.size).add(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
								}
								else {
									debug.msg('cancelOrder - getOrder - ' + position_id + ' side != signal')
									order_tmp.position.value = n(order_tmp.position.value).subtract(order_tmp.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
									order_tmp.position.size = n(order_tmp.position.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
								}
								debug.msg('cancelOrder - getOrder - ' + position_id + ' (id ' + order_tmp.id + ' ; order_id ' + order_tmp.order_id + ') cancel failed - order done or partially done')
								debug.msg('api_order.filled_size= ' + api_order.filled_size)
								debug.msg('order_tmp.filled_size= ' + order_tmp.filled_size + ' ; order_tmp.executed_value= ' + order_tmp.executed_value + ' ; order_tmp.remaining_size= ' + order_tmp.remaining_size)
								debug.msg('order_tmp.position.value= ' + order_tmp.position.value + ' ; order_tmp.position.size= ' + order_tmp.position.size)
								debug.printPosition(order_tmp)
								if (!do_reorder || !((s.product.min_size && (Number(order_tmp.remaining_size) >= Number(s.product.min_size))) || (s.product.min_total && n(order_tmp.remaining_size).multiply(order_tmp.price).value() >= Number(s.product.min_total)))) {
									debug.msg('cancelOrder - getOrder - ' + position_id + ' - not do_reorder || order done || remaining_size < minimo ordine possibile')
									executeOrder(signal, sig_kind, position_id)
									return syncBalance(function () {
										cb(null, true)
									})
//									return cb(null, true)
								}
								else {
									debug.msg('cancelOrder - getOrder ' + position_id + ' -> executeOrder parziale')
									executeOrder(signal, sig_kind, position_id, true)
								}
							}
							else {
								debug.msg('cancelOrder - Ordine esistente su exchange, ma status= ' + api_order.status + ' e filled_size = ' + api_order.filled_size)
								if (!do_reorder) {
									debug.msg('cancelOrder - Non è un reorder, quindi unset flag della posizione')
									positionStatus(order_tmp.position, 'Unset', sig_kind)
//									orderDelete(signal, sig_kind, position_id)
								}
							}
						}
						//L'ordine non esiste sull'exchange, quindi lo cancelliamo anche in locale
						else {
							debug.msg('cancelOrder - Ordine non esistente su exchange, questo if serve a qualcosa!!')
							orderDelete(signal, sig_kind, position_id)
						}

						syncBalance(function () {
							let on_hold
//							if (type === 'buy') on_hold = n(s.balance.deposit).subtract(s.balance.currency_hold || 0).value() < n(order.price).multiply(order.remaining_size).value()
//							************** Da controllare questo punto.		
//							available_balance_currency = s.available_balance.currency + order_tmp.position.value
//							available_balance_asset = s.available_balance.asset + order_tmp.position.size
//
//							available_balance_currency = (sig_kind === 'manual' ? s.available_balance.currency : (n(s.available_balance.currency).add(order_tmp.position.value)))
//							available_balance_asset = (sig_kind === 'manual' ? s.available_balance.asset : (n(s.available_balance.asset).add(order_tmp.position.size)))
//
//							if (signal === 'buy')
//								on_hold = n(available_balance_currency).subtract(s.balance.currency_hold || 0).value() < n(order_tmp.price).multiply(order_tmp.remaining_size).value()
//							else
//								on_hold = n(available_balance_asset).subtract(s.balance.asset_hold || 0).value() < n(order_tmp.remaining_size).value()

//							if (on_hold && (s.balance.currency_hold > 0 || s.balance.asset_hold > 0)) {
							let order_value = n(order_tmp.size).multiply(order_tmp.price)
//							if (n(s.available_balance.currency_hold).add(order_value).value() > 0 || s.available_balance.asset_hold > 0) {
							if (s.available_balance.currency_hold > 0 || s.available_balance.asset_hold > 0) {
								// wait a bit for settlement
								debug.msg('cancelOrder - Funds on hold after cancel, waiting 5s')
								debug.msg('s.balance.currency_hold= ' + s.balance.currency_hold + '; s.available_balance.currency_hold= ' + s.available_balance.currency_hold + '; order_value= ' + order_value, false)
								debug.msg('s.balance.asset_hold= ' + s.balance.asset_hold + '; s.available_balance.asset_hold= ' + s.available_balance.asset_hold, false)
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
//		}
//		else {
////			debug.msg('cancelOrder - ' + signal + ' ' + sig_kind + ' ' + position_id + '. Attendo... (now()=' + now() + ' ; s.next_order ' + s.next_order + ')')
//			setTimeout(function() { cancelOrder(signal, sig_kind, position_id, do_reorder, cb) }, (s.next_order - now() + 1))
//		}
	}

	function executeOrder(signal, sig_kind, position_id, is_partial = false) {
		order_tmp = s.orders.find(x => (x.signal === signal && x.kind === sig_kind && x.id === position_id))
		
		let fee = 0
		if (!so.order_type) {
			so.order_type = 'maker'
		}
			
		if (so.order_type === 'maker') {
			if (s.exchange.makerFee)
				fee = n(order_tmp.size).multiply(s.exchange.makerFee / 100).value()
		}
		if (so.order_type === 'taker') {
			if (s.exchange.takerFee)
				fee = n(order_tmp.size).multiply(s.exchange.takerFee / 100).value()
		}		
		
		//Archivio il trade in s.my_trades
		let my_trade = {
			id: position_id,
			order_id: order_tmp.order_id,
			time: order_tmp.time,
			execution_time: order_tmp.time - order_tmp.orig_time,
			slippage: (signal == 'buy' ? 1 : -1) * n(order_tmp.price).subtract(order_tmp.initial_price).divide(order_tmp.initial_price).value(),
			side: signal,
			size: order_tmp.filled_size,
			fee: fee,
			price: n(order_tmp.price).format('0.00'),
			initial_price: n(order_tmp.initial_price).format('0.00'),
			//Al cost manca il fee... da aggiungere una volta capito come calcolarlo
			value: n(order_tmp.filled_size).multiply(order_tmp.price).format('0.00'),
			position_value: n(order_tmp.position.value).format(s.product.increment), //Valore totale della posizione
			position_size: order_tmp.position.size, //Size totale della posizione
			position_initial_price: order_tmp.position.price,
			order_type: so.order_type || 'taker',
			profit: order_tmp.position.profit_pct,
			position_span: (order_tmp.position.time != null ? (moment.duration(order_tmp.time - order_tmp.position.time).humanize()) : null),
			cancel_after: so.cancel_after // || null //'day'
		}
		s.my_trades.push(my_trade)
		
		//La posizione esisteva già, quindi devo aggiornarla
		if (order_tmp.position.id != null) {
			var position_index = s.positions.findIndex(x => x.id === position_id)
			
			if (order_tmp.position.size != 0 && (s.product.min_size ? (Number(order_tmp.position.size) > Number(s.product.min_size)) : true) && (s.product.min_total ? (n(order_tmp.position.size).multiply(order_tmp.price).value() > Number(s.product.min_total)) : true)) {
//			if (order_tmp.position.size != 0 && (s.product.min_size ? (n(order_tmp.position.size).value() > s.product.min_size) : true)) {
				debug.msg('executeOrder - Posizione ' + position_id + ' parzialmente modificata. Size attuale ' + formatAsset(order_tmp.position.size, s.asset))
				order_tmp.position.price = n(order_tmp.position.value).divide(order_tmp.position.size).format(s.product.increment)
				order_tmp.position.time = order_tmp.time //Time apertura della posizione		
				order_tmp.position.buy_stop = ((order_tmp.position.side == 'sell' && so.buy_stop_pct) ? n(order_tmp.position.price).multiply(1 + so.buy_stop_pct/100).format(s.product.increment) : null)
				order_tmp.position.sell_stop = ((order_tmp.position.side == 'buy' && so.sell_stop_pct) ? n(order_tmp.position.price).multiply(1 - so.sell_stop_pct/100).format(s.product.increment) : null)
				
				debug.printPosition(order_tmp.position)
				
//				s.update_position_id = position_id
//				s.delete_position_id = null
				if (so.mode != 'sim')
					s.positionProcessingQueue.push({mode: 'update', id: position_id});
			} 
			else {
//				s.update_position_id = null
//				s.delete_position_id = position_id
				if (so.mode != 'sim')
					s.positionProcessingQueue.push({mode: 'delete', id: position_id});
				
				//Elimino la posizione da s.positions
				s.positions.splice(position_index,1)
								
				debug.msg('executeOrder - Posizione ' + position_id + ' chiusa. Posizioni attuali: ' + s.positions.length)

				//Cancella anche tutti gli ordini connessi con la posizione, 
				//  quindi l'oggetto, non essendo più puntato da nulla, viene cancellato dalla memoria
				orderStatus(undefined, undefined, undefined, position_id, 'Free')
				
//				debug.msg('executeOrder - Lista posizioni rimaste')
//				debug.printPosition(s.positions)
			}
		}
		//La posizione non esisteva, quindi va inserita nell'array delle posizioni
		else {
			//Preparo la posizione e la archivio in s.positions
			position = order_tmp.position
			position.id = position_id
//			position._id = position_id
			position.price = n(order_tmp.position.value).divide(order_tmp.position.size).format(s.product.increment)
			position.time = order_tmp.time //Time apertura della posizione		
			position.buy_stop = (position.side == 'sell' ? so.buy_stop_pct && n(position.price).multiply(1 + so.buy_stop_pct/100).format(s.product.increment) : null)
			position.sell_stop = (position.side == 'buy' ? so.sell_stop_pct && n(position.price).multiply(1 - so.sell_stop_pct/100).format(s.product.increment) : null)
			
			//Tolgo il flag corretto dallo status della posizione
//			positionStatus(position, 'Unset', sig_kind)
			//Perchè lo faccio dentro orderDelete più avanti
			
			s.positions.push(position)
			
			debug.msg('executeOrder - posizione ' + position_id + ' aperta.')
			debug.printPosition(s.positions[s.positions.length-1])
			
//			s.update_position_id = position_id
//			s.delete_position_id = null
			if (so.mode != 'sim') 
				s.positionProcessingQueue.push({mode: 'update', id: position_id});
		}
				
		updatePositions(order_tmp)

		//Messaggio di ordine eseguito
		if (so.stats) {
			let order_complete = '\n**** ' + signal.toUpperCase() + (is_partial ? ' partial' : '') + ' (' + sig_kind + ') order completed at ' + moment(my_trade.time).format('YYYY-MM-DD HH:mm:ss') + ':\n\n'
			order_complete += formatAsset(my_trade.size, s.asset) + ' at ' + formatCurrency(my_trade.price, s.currency) + '\n'
			order_complete += 'Total ' + formatCurrency(my_trade.value, s.currency) + '\n'
			order_complete += n(my_trade.slippage).format('0.0000%') + ' slippage (orig. price ' + formatCurrency(my_trade.initial_price, s.currency) + ')\n'
			order_complete += 'Execution: ' + moment.duration(my_trade.execution_time).humanize() + '\n'
			order_complete += 'Positions: ' + s.positions.length
			if (position_index != null) {
				order_complete += '\n\nPosition Id: ' + my_trade.id + (is_partial ? ' (partial)' : '')
				order_complete += '\nOriginal price: ' + formatCurrency(my_trade.position_initial_price, s.currency)
				order_complete += '\nPosition Size: ' + formatAsset(my_trade.position_size, s.asset)
				order_complete += '\nPosition value: ' + formatCurrency(my_trade.position_value, s.currency)
				order_complete += '\nProfit: ' + n(my_trade.profit/100).format('0.0000%')
				order_complete += '\nExecution: ' + moment.duration(my_trade.execution_time).humanize()
				order_complete += '\nPosition span: ' + my_trade.position_span
			}
			console.log((order_complete).cyan)
			pushMessage(s.exchange.name.toUpperCase(), order_complete, 5)
		}
		
		s['last_' + signal + '_price'] = my_trade.price
		s['last_' + signal + '_time'] = my_trade.time
		
		if (!is_partial) {
			s.action = (signal == 'buy' ? 'bought' : 'sold')
			
			//Cancello l'ordine che è stato eseguito
			orderDelete(signal, sig_kind, position_id)
			
			emitSignal('orderExecuted', signal, sig_kind, position_id)
		}
		else {
			s.action = (signal == 'buy' ? 'part buy' : 'part sell')
		}
		
		debug.msg('executeOrder - Lista posizioni aperte:')
		debug.printPosition(s.positions)
	}

	function now() {
		return new Date().getTime()
	}

	function writeReport (strategy_name, is_progress, blink_off) {
//		debug.msg('writeReport ' + strategy_name)
		if ((so.mode === 'sim' || so.mode === 'train') && !so.verbose) {
			if (so.silent) return
			is_progress = true
		}
		else if (is_progress && typeof blink_off === 'undefined' && s.vol_since_last_blink) {
			s.vol_since_last_blink = 0
			setTimeout(function () {
				writeReport(strategy_name, true, true)
			}, 200)
			setTimeout(function () {
				writeReport(strategy_name, true, false)
			}, 400)
			setTimeout(function () {
				writeReport(strategy_name, true, true)
			}, 600)
			setTimeout(function () {
				writeReport(strategy_name, true, false)
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
		volume_display = z(5, volume_display, ' ')
		if (volume_display.indexOf('.') === -1) {
			volume_display = ' ' + volume_display
		}
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
		
		if (strategy_name && so.strategy[strategy_name].lib.onReport) {
			let cols = so.strategy[strategy_name].lib.onReport.call(s.ctx, s)
			cols.forEach(function (col) {
				process.stdout.write(col)
			})
		}
		if (orderExist('buy', strategy_name)) {
			process.stdout.write(z(12, 'B ' + strategy_name, ' ').green)
		}
		else if (orderExist('sell', strategy_name)) {
			process.stdout.write(z(12, 'S ' + strategy_name, ' ').red)
		}
		else if (s.action) {
			process.stdout.write(z(12, s.action, ' ')[(s.action === 'bought' || s.action === 'part buy') ? 'green' : 'red'])
		}
		else if (s.signal) {
			process.stdout.write(z(12, s.signal, ' ')[s.signal === ('pump' || 'dump') ? 'white' : s.signal === 'buy' ? 'green' : 'red'])
		}
		else if (s.is_dump_watchdog || s.is_pump_watchdog) {
			process.stdout.write(z(12, 'P/D Calm', ' ').white)
		}
		else {
			process.stdout.write(z(12, '', ' '))
		}
		
		if (s.max_profit_position.trend.buy != null || s.max_profit_position.trend.sell != null) {
			position_buy_profit = -1
			position_sell_profit = -1

			if (s.max_profit_position.trend.buy != null)
				position_buy_profit = s.max_profit_position.trend.buy.profit_pct/100

			if (s.max_profit_position.trend.sell != null)	
				position_sell_profit = s.max_profit_position.trend.sell.profit_pct/100

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
				position_buy_profit = s.max_profit_position.trail.buy.profit_pct/100

			if (s.max_profit_position.trail.sell != null)	
				position_sell_profit = s.max_profit_position.trail.sell.profit_pct/100
				
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
//			process.stdout.write(z((asset_col.length + 1), asset_col, ' ').white)
			process.stdout.write(' ' + asset_col.white)
						
			let currency_col = n(s.balance.currency).format(isFiat() ? '0.00' : '0.00000000')
			if (s.available_balance && s.balance.currency != s.available_balance.currency) {
				currency_col += '(' + n(s.available_balance.currency).format(isFiat() ? '0.00' : '0.00000000') + ')'
			}
			currency_col += ' ' + s.currency
//			process.stdout.write(z((currency_col.length + 1), currency_col, ' ').green)
			process.stdout.write(' ' + currency_col.green)
			
//			//Profitto sul capitale iniziale
//			let consolidated = n(s.balance.currency).add(n(s.balance.asset).multiply(s.period.close))
//			let profit = n(consolidated).divide(s.orig_capital).subtract(1).value()
//			process.stdout.write(z(7, formatPercent(profit), ' ')[profit >= 0 ? 'green' : 'red'])
//			
//			//Profitto sul buy&hold
//			let buy_hold = n(s.orig_capital).divide(s.orig_price).multiply(s.period.close)
//			let over_buy_hold_pct = n(consolidated).divide(buy_hold).subtract(1).value()
//			process.stdout.write(z(7, formatPercent(over_buy_hold_pct), ' ')[over_buy_hold_pct >= 0 ? 'green' : 'red'])
		}		
		
		if (!is_progress) {
			process.stdout.write('\n')
		}
	}

	function withOnPeriod (trade, period_id, cb) {
//		debug.msg('withOnPeriod')
		if (!clock && so.mode !== 'live' && so.mode !== 'paper') clock = lolex.install({ shouldAdvanceTime: false, now: trade.time })

		//Aggiorna il period e fa eseguire i calcoli alla strategia (senza inviare segnali di trade) 
		updatePeriod(trade)
		
		if (!s.in_preroll) {
			
			//Aggiorna i valori variabili di tutte le posizioni aperte (compresi i valori dei trailing stop)
			updatePositions(trade)
			
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

//				if (s.signal) {
//					debug.msg('withOnPeriod - emetto il segnale ' + s.signal)
//					emitSignal('standard', s.signal)
//					
//					s.signal = null
//				}
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

//		//Aggiorna i valori variabili di tutte le posizioni aperte (compresi i valori dei trailing stop)
//		updatePositions(trade)

		//Non ho capito a cosa serve. s.period.time è il tempo di inizio del periodo, dovrebbe
		// essere per forza inferiore a trade.time (da cui deriva), quindi questo if non sarà mai
		// soddisfatto. Boh. Metto un debug per capire se qualche volta entra.
		if (s.period && trade.time < s.period.time) {
			debug.msg('*************************** onTrade. Sono dentro if misterioso *****************************')
			debug.msg('trade.time= ' + trade.time + ' ; s.period.time= ' + s.period.time)
			pushMessage('onTrade', 'Sono dentro if misterioso', 9)
			//s.exchange.resetPublicClient(s.product_id)
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

			withOnPeriod(trade, period_id, cb)

			//Numero massimo di valori per lookback e calc_lookback 
			let max_length = 100

			var strategyProcessed = 0

//			debug.msg('onTrade - prima di Object')
			Object.keys(so.strategy).forEach(function (strategy_name, index, array) {
//				debug.msg('onTrade - so.strategy.' + strategy_name)
				so.strategy[strategy_name].lib.onPeriod.call(s.ctx, s, function () {
					strategyProcessed++

					writeReport(strategy_name)
//					s.acted_on_stop = false
//					s.acted_on_trail_stop = false
					s.action = null

					//Aggiungi il periodo a so.strategy[strategy_name].calc_lookback e
					//  ripulisci so.strategy[strategy_name].calc_lookback a un max di valori

					if (trade.time > so.strategy[strategy_name].calc_close_time) {
						so.strategy[strategy_name].calc_lookback.unshift(s.period)
					}

					if (so.strategy[strategy_name].calc_lookback.length > max_length) {
						so.strategy[strategy_name].calc_lookback.splice(max_length, (so.strategy[strategy_name].calc_lookback.length - max_length))
						debug.msg('onTrade - so.strategy[strategy_name].calc_lookback ridotto a ' + so.strategy[strategy_name].calc_lookback.length)
					}

					if (strategyProcessed === array.length) {
						//Aggiungi il periodo a s.lookback e 
						//  ripulisci s.lookback a un max di valori
						s.lookback.unshift(s.period)

						if (s.lookback.length > max_length) {
							s.lookback.splice(max_length, (s.lookback.length - max_length))
//							debug.msg('onTrade - s.lookback ridotto a ' + s.lookback.length)
						}

						initBuffer(trade)
//						debug.msg('onTrade: chiamo withOnPeriod oltre period ' + s.signal + ' Time= ' + moment() + ' trade.time= ' + trade.time + ' s.period.close_time= ' + s.period.close_time)
					}
				})
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
		let max_profit = -100
		let max_trail_profit = -100
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
		
		s.positions.forEach(function (position, index) {
			//Controllo minima quantità
			if (s.product.min_size && (Number(position.size) < Number(s.product.min_size))) {
				let err = new Error('\nMinimum size')
				err.desc = 'Position ' + position.id + ' size= ' + position.size + ' < minimum size (' + s.product.min_size + '). Position cleared'
				orderDelete(undefined, undefined, position.id, function() {
//					s.delete_position_id = position.id
					if (so.mode != 'sim')
						s.positionProcessingQueue.push({mode: 'delete', id: position_id});
					
					s.positions.splice(index,1)
				})				
			}		
			
			//Aggiorno il profitto della posizione
			position.profit_pct = (position.side == 'buy' ? +100 : -100) * n(trade.price).subtract(position.price).divide(position.price).value()

			//Aggiorno i profit trailing stop e aggiorno le posizioni con massimo profitto trail e trend, tranne che per le posizioni 'manual'
			if (!position.locked) {
				if (so.profit_stop_enable_pct && position.profit_pct >= so.profit_stop_enable_pct) {
					position.profit_stop_limit = (position.side === 'buy' ? (Math.max(position.profit_stop_limit || trade.price, trade.price)) : (Math.min(position.profit_stop_limit || trade.price, trade.price)))
					position.profit_stop = position.profit_stop_limit + (position.side === 'buy' ? -1 : +1) * (position.profit_stop_limit * (so.profit_stop_pct / 100))
					if (position.profit_pct >= max_trail_profit) {
						max_trail_profit = position.profit_pct
						s.max_profit_position.trail[position.side] = position
//						debug.msg('updatePositions - max_profit_position_id.trail.' + position.side + ' = ' + position.id, false)
					}
				} 
				else if (position.profit_pct >= max_profit) {
					max_profit = position.profit_pct
					s.max_profit_position.trend[position.side] = position
//					debug.msg('updatePositions - position_max_profit_index= ' + position_max_profit_index, false)
				}
			}
		})
	}

	function updateMessage() {
		side_trend_max_profit = null
		pct_trend_max_profit = null
		side_trail_max_profit = null
		pct_trail_max_profit = null
		
		if (s.max_profit_position.trend.buy != null || s.max_profit_position.trend.sell != null) {
			side_trend_max_profit = ((s.max_profit_position.trend.buy ? s.max_profit_position.trend.buy.profit_pct : -100) > (s.max_profit_position.trend.sell ? s.max_profit_position.trend.sell.profit_pct : -100) ? 'buy' : 'sell')
			pct_trend_max_profit = s.max_profit_position.trend[side_trend_max_profit].profit_pct
		}
		
		if (s.max_profit_position.trail.buy != null || s.max_profit_position.trail.sell != null) {
			side_trail_max_profit = ((s.max_profit_position.trail.buy ? s.max_profit_position.trail.buy.profit_pct : -100) > (s.max_profit_position.trail.sell ? s.max_profit_position.trail.sell.profit_pct : -100) ? 'buy' : 'sell')
			pct_trail_max_profit = s.max_profit_position.trail[side_trail_max_profit].profit_pct
		}
		
		var output_lines = ''
		output_lines += '\nBalance ' + formatCurrency(s.balance.currency, s.currency) + ' - ' + formatAsset(s.balance.asset, s.asset)
		output_lines += '\nBalance in currency ' + formatCurrency(s.real_capital, s.currency)
		output_lines += '\nBalance in asset ' + formatCurrency(s.asset_capital, s.asset)
		output_lines += '\n' + s.my_trades.length + ' trades over ' + s.day_count + ' days (' + n(s.my_trades.length / s.day_count).format('0.00') + ' trades/day)'
		output_lines += '\n' + s.positions.length + ' positions opened' + (side_trend_max_profit ? (' (' + side_trend_max_profit[0].toUpperCase() + formatPercent(pct_trend_max_profit/100) + ').') : '.')
		output_lines += (side_trail_max_profit ? ('\nTrailing position: ' + (side_trail_max_profit[0].toUpperCase() + formatPercent(pct_trail_max_profit/100))) : '')
		pushMessage('Status', output_lines, 0)
	}
	
	//Funzione per controllare l'esistenza di un ordine specifico (se si immette un solo parametro, gli altri non entrano nel confronto)
	function orderExist(signal, sig_kind, position_id) {
		return s.orders.find(x => ((signal != undefined ? (x.signal === signal) : true) && (sig_kind != undefined ? (x.kind === sig_kind) : true) && (position_id != undefined ? (x.id === position_id) : true)))
	}
	
	//Funzione per cancellare un ordine da s.orders
	function orderDelete(signal, sig_kind, position_id, cb = function() {}) {
		s.orders.forEach(function (order, index) {
			if ((signal ? order.signal === signal : true) && (sig_kind ? order.kind === sig_kind : true) && (position_id ? order.id === position_id : true)) {
				debug.msg('orderDelete - delete s.orders ' + order.signal + ' ' + order.kind + ' ' + order.id)
				if (sig_kind) {
					positionStatus(order.position, 'Unset', sig_kind)
				}
				else {
					positionStatus(order.position, 'Free')
				}
				s.exchange.cancelOrderCache({order_id: order.order_id, product_id: s.product_id})
				s.orders.splice(index, 1)
				//debug.printPosition(s.positions)
			}
		})
		return cb()
	}
	
// Da controllare se con le modifiche fatte, il problema seguente è risolto.
	// Setta a canceled lo status della posizione, quindi con canceled dovrebbe cancellare il catch, ma fa prima l'ordine standard ad andare
	// a fallimento, quindi cancella l'ordine standard, settando la posizione a free, quindi il checkorder dell'ordine catch trova free
	// e non canceled, quindi non cancella una mazza e l'ordine rimane in piedi.
	
	//Funzioni per configurare lo status di uno o più posizioni connesse agli ordini (Set, Unset, Free, Check)
	function orderStatus(order, signal, sig_kind, position_id, mode, status, cb = function() {}) {
		if (order) {
			debug.msg('orderStatus - s.orders(' + order.signal + ', ' + order.kind + ', ' + order.id + ') ' + mode + ' ' + status)
			positionStatus(order.position, mode, status)
		}
		else {
			s.orders.forEach(function (order, index) {
				if ((signal ? order.signal === signal : true) && (sig_kind ? order.kind === sig_kind : true) && (position_id ? order.id === position_id : true)) {
					debug.msg('orderStatus - s.orders(' + order.signal + ', ' + order.kind + ', ' + order.id + ').status = ' + mode + ' ' + status)
					positionStatus(order.position, mode, status)
				}
			})
		}
		return cb()
	}
	
	function positionStatus(position, mode, status, cb = function() {}) {
		switch (mode) {
		case 'Set': {
			debug.msg('positionStatus - position ' + position.id + ' Status= ' + position.status + ' -> (Set ' + status + ') -> ' + (position.status | orderFlag[status]))
			position.status = (position.status | orderFlag[status])
			return cb()
			break
		}
		case 'Unset': {
			debug.msg('positionStatus - position ' + position.id + ' Status= ' + position.status + ' -> (Unset ' + status + ') -> ' + (position.status & ~orderFlag[status]))
			position.status = (position.status & ~orderFlag[status])
			return cb()
			break
		}
		case 'Free': {
			debug.msg('positionStatus - position ' + position.id + ' Status= ' + position.status + ' -> (Free) -> ' + orderFlag.free)
			position.status = orderFlag.free
			return cb()
			break
		}
		case 'Check': {
//			debug.msg('positionStatus - position ' + position.id + ' Check ' + status + ' (position.status= ' + position.status + ')')
			return (position.status & orderFlag[status])
		}
		}
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
				z(25, 'BAL', ' ').grey,
				z(22, 'PROFIT', ' ').grey
				].join('') + '\n')
		},
		update: onTrades,
		exit: function (cb) {
			if(tradeProcessingQueue.length()){
				tradeProcessingQueue.drain = () => {
					if(so.strategy.onExit) {
						so.strategy.onExit.call( s.ctx, s )
					}
					cb()
				}
			} else {
				if(so.strategy.onExit) {
					so.strategy.onExit.call( s.ctx, s )
				}
				cb()
			}
		},

		executeSignal: executeSignal,
		writeReport: writeReport,
		syncBalance: syncBalance,
		updateMessage: updateMessage,
		emitSignal: emitSignal,
		orderDelete: orderDelete,
		orderExist: orderExist,
		orderStatus: orderStatus,
		positionStatus: positionStatus,
		orderFlag: orderFlag
	}
}
