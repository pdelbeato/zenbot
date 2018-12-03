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
let nice_errors = new RegExp(/(protection|watchdog|calmdown|funds|size)/)

module.exports = function (s, conf) {
	let eventBus = conf.eventBus
	eventBus.on('trade', queueTrade)
	eventBus.on('trades', onTrades)
	
	function switchOnListener() {
		eventBus.once('standard', (signal, position_id, fixed_size, fixed_price, is_reorder, is_taker) => {
			debug.msg('Listener -> standard ' + signal)
			syncBalance(function (err) {
				if (err) {
					debug.msg('Listener - syncBalance - Error getting balance')
					err.desc = 'Listener - syncBalance - could not execute ' + signal_id + ': error fetching quote'
					setTimeout(switchOnListener, 100)
					return
				}
				executeSignal (signal, 'standard', position_id, fixed_size, fixed_price, is_reorder, is_taker)
				setTimeout(switchOnListener, 100)
			})
		})
		console.log('listeners ' + eventBus.listeners('standard'))
	}
	
	switchOnListener()
	
	function emitSignal (sig_type, signal, position_id, fixed_size, fixed_price, is_reorder, is_taker) {
		eventBus.emit(sig_type, signal, position_id, fixed_size, fixed_price, is_reorder, is_taker)
	}
	
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
	s.my_prev_trades = []
	s.vol_since_last_blink = 0
	s.orders = []
	s.positions = []
	
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
	
	//Inizializza una posizione position_id, ma non la inserisce nell'array delle posizioni
	function initPosition (position_id = null) {
		position = {
				_id: position_id,
				id: position_id,
				selector: so.selector.normalized,
				status: 'free',
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
	function initOrder (orderSignal, orderType = 'standard', position_id = null, is_taker = null, cb) {			
		order = {
			id: position_id,
			signal: orderSignal,
			type: orderType,
			time: null,
			orig_time: null, //Tempo di chiusura dell'ultimo trade della posizione
			local_time: null, //Tempo locale di chiusura dell'ultimo trade della posizione
			initial_price: null, //Prezzo iniziale dell'ultimo trade della posizione
			price: null, //Prezzo finale dell'ultimo trade della posizione
			fixed_price: null,
			fee: 0,
			size: null, //Size attuale del trade (variabile di servizio)
			orig_size: null, //Size inizio trade (serve per i riordini)
			remaining_size: null, //Rimanenza del trade (serve per i riordini)
			filled_size: 0, //Size commerciato del trade (variabile di servizio)
			executed_value: 0, //Value commerciato del trade (variabile di servizio)
			order_type: is_taker ? 'taker' : so.order_type,
			order_id: null,
			order_status: null,
			product_id: s.product_id,
			post_only: conf.post_only,
			cancel_after: s.cancel_after, // s.cancel_after || 'day'
			position: {}
		}
		
		let position = s.positions.find(x => x.id === position_id)
		if (position) {
			debug.msg('initOrder - Esiste una posizione ' + position_id + '. Associo s.orders ' + orderSignal + ' ' + orderType + ' alla posizione')
			order.position = position
			order.position.status = 'linked'
		}
		else {
			debug.msg('initOrder - Non esiste una posizione ' + position_id + '. Creo una posizione senza id.')
			order.position = initPosition()
			order.position.side = orderSignal, //Side della posizione
			order.position.status = 'created'
		}
		
		
			
		s.orders.push(order)
		
		debug.msg('initOrder - ordine associato/creato:')
		debug.printPosition(order)
		
		return order
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
		s.positions.forEach( function (position, index) {
			position_stop = position[position.position_side + '_stop']
			if (!s.acted_on_stop && position_stop && ((position.position_side == 'buy' ? +1 : -1) * (s.period.close - position_stop) < 0)) {
				s.acted_on_stop = true
				position_opposite_signal = (position.position_side === 'buy' ? 'sell' : 'buy')
				console.log(('\n' + position.position_side.toUpperCase() + ' stop triggered at ' + formatPercent(position.profit_pct/100) + ' trade profit for position ' + position.id + '\n').red)
				pushMessage('Stop Loss Protection', position.position_side + ' position ' + position.id + ' (' + formatPercent(position.profit_pct/100) + ')', 0)
				//Se non esiste un ordine già in piedi, eseguo executeSignal su questa posizione, con modalità taker
				if (!orderExist(position_opposite_signal, 'StopLoss', position.id))
					executeSignal(position_opposite_signal, 'StopLoss', position.id, undefined, undefined, false, true)
				else
					debug.msg('executeStop - Ordine s.orders.' + position_opposite_signal + '.StopLoss.' + position.id + ' già in piedi.')
					
				return
			}

			if (!s.acted_on_trail_stop && position.profit_stop && ((position.position_side == 'buy' ? +1 : -1) * (s.period.close - position.profit_stop) < 0) && position.profit_pct > 0) {
				s.acted_on_trail_stop = true
				position_opposite_signal = (position.position_side === 'buy' ? 'sell' : 'buy')
				console.log(('\nProfit stop triggered at ' + formatPercent(position.profit_pct/100) + ' trade profit for position ' + position.id + '\n').green)
				pushMessage('Trailing stop', position.position_side + ' position ' + position.id + ' (' + formatPercent(position.profit_pct/100) + ')', 0)
				//Se non esiste un ordine già in piedi, eseguo executeSignal su questa posizione
				if (!orderExist(position_opposite_signal, 'TrailStop', position.id))
					executeSignal(position_opposite_signal, 'TrailStop', position.id, undefined, undefined, false, false)
				else
					debug.msg('executeStop - Ordine s.orders.' + position_opposite_signal + '.TrailStop.' + position.id + ' già in piedi.')
			
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

				s.positions.forEach(function (position, index) {
					if (position.side == 'buy')
						s.available_balance.asset -= position.size
					else
						s.available_balance.currency -= position.value	
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
	function executeSignal (signal, sig_type = 'standard', position_id = null, fixed_size = null, fixed_price = null, is_reorder, is_taker, _cb) {
		let expected_fee = 0
		let order_tmp
		var signal_opposite = (signal === 'buy' ? 'sell' : 'buy')
		
		//Inutile, una volta che gestirò tutto con eventi
		if (!signal.includes('buy') && !signal.includes('sell')) {
			debug.msg('executeSignal - signal non contiene buy/sell. Esco')
			_cb && _cb(null, null)
//			eventBus.once(signal, () => executeSignal(signal))
//			console.log('listeners ' + eventBus.listeners(signal))
			return
		}	
		
		//Se è un riordine...
		if (is_reorder) {
			//..ed esiste s.orders, allora lascio tutto così e vado avanti...
			order_tmp = orderExist(signal, sig_type, position_id)
			if (order_tmp) {
				debug.msg('executeSignal - Riordine ' + signal + ' ' + sig_type + ' ' + position_id)
			}
			//...altrimenti esco, perchè non può essere un riordine senza s.orders associato
			else {
				debug.msg('executeSignal - Riordine ma non esiste s.orders.' + signal + '.' + sig_type + '.' + position_id + ' -> esco.')
				_cb && _cb(null, null)
				return
			}
		}
		//Se non è un riordine...
		else {
			//...ed esiste l'ordine associato, allora esco, perchè l'ordine è già in piedi
			if (orderExist(signal, sig_type, position_id)) {
				debug.msg('executeSignal - Annullo perchè esiste già s.orders(' + signal + ', ' + sig_type + ', ' + position_id + ')')
				_cb && _cb(null, null)
				return
			}
			//...altrimenti continuo con i controlli
			else {			
				//Se esiste position_id, allora è un ordine specifico
				if (position_id) {
					//Se contemporaneamente c'è un ordine standard aperto su questa posizione, annullo questo executeSignal
					if (orderExist(signal, 'standard', position_id)) {
						debug.msg('executeSignal - con position_id. Annullo, perchè esiste ordine standard aperto su ' + position_id)
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
							//Cancello tutti gli ordini su questa posizione prima di attivare l'ordine
							orderSetStatus(undefined, undefined, position_id, 'canceled', function() {
								order_tmp = initOrder(signal, sig_type, position_id, is_taker)
							})
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
					//Se è un ordine standard... 
					if (sig_type === 'standard') {			
						//...creo un ordine standard...
						
						//Se ce ne sono altri in piedi, non creo questo
						if (orderExist(signal, 'standard', undefined)) {
							debug.msg('executeSignal - Annullo perchè esiste già s.orders(' + signal + ', standard)')
							_cb && _cb(null, null)
							return
						}
						//Creo un position_id da associare all'ordine
						position_id = crypto.randomBytes(4).toString('hex')
				
						//Creo l'ordine associato
						debug.msg('executeSignal - senza position_id - Creo nuovo ordine ' + signal + ' standard ' + position_id)
						order_tmp = initOrder(signal, 'standard', position_id, is_taker)
						
						//...e cerco una eventuale posizione aperta con il massimo profitto
						// (che sia superiore al limite imposto dalla configurazione)
						if (s.max_profit_position.trend[signal_opposite]) {
							position = s.max_profit_position.trend[signal_opposite]
							
							//La posizione individuata non ha profitto sufficiente, quindi esco
							if (so['max_' + signal + '_loss_pct'] != null && (position.profit_pct + so['max_' + signal + '_loss_pct'] < 0)) {
								debug.msg('executeSignal - standard senza position_id - Non ci sono posizioni in profitto (max ' + n(position.profit_pct/100).format('0.00%') + ')')
								
								//Controllo se posso eseguire ordini long/short
								if ((signal == 'buy' && !so.active_long_position) || (signal == 'sell' && !so.active_short_position)) {
									debug.msg('executeSignal - Non posso operare ' + signal + ': so.active_position false')
									_cb && _cb(null, null)
									return orderDelete(signal, sig_type, position_id)
								}	
							}
							//La posizione individuata ha profitto sufficiente, quindi cancello l'ordine creato e
							// associo un ordine standard a quella posizione
							else {
								debug.msg('executeSignal - standard senza position_id - Prendo max_profit_position.trend.' + signal_opposite + '.id ' + position.id + ' con profitto (' + n(position.profit_pct/100).format('0.00%') + ')')
								orderDelete(signal, sig_type, position_id)
								
								position_id = position.id
								debug.printPosition(position)

								//Cancello tutti gli eventuali ordini associati a questa posizione prima di creare il nuovo ordine
								orderSetStatus(undefined, undefined, position_id, 'canceled', function() {
									order_tmp = initOrder(signal, 'standard', position_id, is_taker)
								})
							}
						}
						//Non ci sono posizioni da considerare. L'ordine standard è già in piedi.
						else {
							//Controllo se posso eseguire ordini long/short
							if ((signal == 'buy' && !so.active_long_position) || (signal == 'sell' && !so.active_short_position)) {
								debug.msg('executeSignal - Non posso operare ' + signal + ': so.active_position false')
								_cb && _cb(null, null)
								return orderDelete(signal, sig_type, position_id)
							}	
						}
						
						//E' un ordine standard senza position_id, quindi dettato dalla strategia. Cancello TUTTI gli ordini di senso opposto ancora in essere
						debug.msg('executeSignal - Ordine standard senza position_id. Cancello TUTTI gli ordini standard di senso opposto ancora in essere.')
						orderSetStatus(signal_opposite, 'standard', undefined, 'canceled')
					}
					//Altrimenti creo un ordine sig_type nuovo
					else {
						//Creo un position_id da associare all'ordine
						position_id = crypto.randomBytes(4).toString('hex')
				
						//Creo l'ordine associato
						debug.msg('executeSignal - senza position_id - Creo nuovo ordine ' + signal + ' ' + sig_type + ' ' + position_id)
						order_tmp = initOrder(signal, sig_type, position_id, is_taker)
					}
				}
			}
		}
			
		let cb = function (err, order) {
			if (!order) {
				debug.msg('executeSignal - cb - cancello s.orders.' + signal + '.' + sig_type + '.' + position_id)
				position = s.positions.find(x => x.id = position_id)
				if (position) {
					position.profit_stop = null
					position.profit_stop_limit = null
				}
				s.acted_on_trail_stop = null
				s.acted_on_trend = null
				orderDelete(signal, sig_type, position_id)
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
		
//		//Potrebbe servire in alcune strategie
//		if (!position_id)
//			s.acted_on_trend = true
//		else
//			s.acted_on_trend = false
		
		//Controlli timing (da sostituire con funzione)
		//Questi controlli solo se sono ordini non a prezzo fisso
		if (!fixed_price) {
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
		
		syncBalance(function (err) {
			let fee, trade_balance, tradeable_balance

			if (err) {
				debug.msg('executeSignal - syncBalance - Error getting balance')
				err.desc = 'executeSignal - syncBalance - could not execute ' + position_id + ': error fetching quote'
				return cb(err)
			}

			//Prepara il PREZZO per l'ordine
			order_tmp.price = fixed_price || nextPriceForQuote(signal)
			if (!order_tmp.initial_price)
				order_tmp.initial_price = order_tmp.price
				
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
			if (!order_tmp.fixed_price && so.max_slippage_pct != null) {
				slippage = Math.abs(n(order_tmp.initial_price).subtract(order_tmp.price).divide(order_tmp.initial_price).multiply(100).value())
				if (slippage > so.max_slippage_pct) {
					let err = new Error('\nslippage protection')
					err.desc = 'refusing to buy at ' + formatCurrency(order_tmp.price, s.currency) + ', slippage of ' + formatPercent(slippage / 100)
					pushMessage('Slippage protection', 'aborting', 9)
					return cb(err)
				}
			}
			
			//Prepara la QUANTITA' per l'ordine
			order_tmp.size = n(fixed_size || order_tmp.remaining_size || order_tmp.position.size || n(so.quantum_size).divide(order_tmp.price)).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')

			if (order_tmp.remaining_size === null)
				order_tmp.remaining_size = order_tmp.size
							
			debug.msg('executeSignal - ' + position_id + ' Size: ' + formatAsset(order_tmp.size, s.asset))
			
			//Controlli sulle quantità di asset e currency (da sostituire con funzione?)
			//Cosa succede se tutti i fondi sono hold? In qualche modo me ne devo accorgere e liberarli o considerarli prima di fare questo controllo.
			// s.balance.asset restituisce i fondi liberi da hold. s.balance.asset_hold sono quelli on hold.
			
			//Calcolo fee
			if (so.use_fee_asset) {
				fee = 0
			} else if (so.order_type === 'maker') {
				fee = s.exchange.makerFee
			} else {
				fee = s.exchange.takerFee
			}		
			
			trade_balance = (order_tmp.size * order_tmp.price)
			tradeable_balance = trade_balance * 100 / (100 + fee)
			expected_fee = n(trade_balance).subtract(tradeable_balance).format('0.00000000', Math.ceil) // round up as the exchange will too

			if (signal === 'buy' && tradeable_balance >= s.available_balance.currency) {
				let err = new Error('\nInsufficient funds')
				err.desc = 'refusing to buy ' + formatCurrency(tradeable_balance, s.currency) + '. Insufficient funds (' + formatCurrency(s.available_balance.currency, s.currency) + ')'
				return cb(err)
			}
			if (signal === 'sell' && order_tmp.size >= s.available_balance.asset) {
				let err = new Error('\nInsufficient funds')
				err.desc = 'refusing to sell ' + formatAsset(order_tmp.size, s.asset) + '. Insufficient funds (' + formatAsset(s.available_balance.asset, s.asset) + ')'
				return cb(err)
			}
			
			if (s.product.min_size && ((order_tmp.size) < Number(s.product.min_size) || ('min_total' in s.product && s.product.min_total && n(order_tmp.size).multiply(order_tmp.price).value() < Number(s.product.min_total)))) {
				let err = new Error('\nMinimum size')
				err.desc = 'refusing to ' + signal + formatAsset(order_tmp.size, s.asset) + '. Minimum size not reached'
				return cb(err)
			}
			
			if (s.product.max_size && order_tmp.size > Number(s.product.max_size)) {
				debug.msg('executeSignal - size = s.product.max_size')
				order_tmp.size = s.product.max_size
			}

//			//Controllo profitto della posizione, solo se non sto eseguendo uno stop loss
//			if (s.orders[signal][sig_type][position_id].profit_pct && !s.acted_on_stop && so['max_' + signal + '_loss_pct'] != null && (s.orders[signal][sig_type][position_id].profit_pct*100 + so['max_' + signal + '_loss_pct'] < 0)) {
//				let err = new Error('\nPosition ' + position_id + ' ProfitLoss protection')
//				err.desc = 'refusing to ' + signal + ' at ' + formatCurrency(s.orders[signal][sig_type][position_id].price, s.currency) + ', ' + (so['max_' + signal + '_loss_pct'] > 0 ? 'LOSS of ' : 'PROFIT of ') + formatPercent(s.orders[signal][sig_type][position_id].profit_pct) + ' (limit ' + formatPercent(-so['max_' + signal + '_loss_pct'] / 100) + ')\n'
//
//				delete s.orders[signal][sig_type][position_id]
//				
//				if (err.message.match(nice_errors)) {
//					console.error((err.message + ': ' + err.desc).red)
//				}
//			}
			
			debug.msg('executeSignal - preparing ' + signal + ' ' + sig_type + ' ' + position_id + ' order over ' + formatAsset(order_tmp.size, s.asset) + ' of ' + formatCurrency(tradeable_balance, s.currency) + ' tradeable balance with a expected fee of ' + formatCurrency(expected_fee, s.currency) + ' (' + fee + '%)')

			//Deprecated
//				//Controllo se ho raggiunto il numero massimo di quantum acquistabili
//				if (s.positions.length >= so.max_nr_quantum) {
//				let err = new Error('\nmax quantum reached')
//				err.desc = 'refusing to buy. Max nr of quantum (' + so.max_nr_quantum + ') reached. Positions opened: ' + s.positions.length
//				return cb(err)
//				}

			//Controllo currency in hold
			//if (n(s.balance.deposit).subtract(s.balance.currency_hold || 0).value() < n(price).multiply(size).value() && s.balance.currency_hold > 0) {
			// Da capire come modificare per intercettare anche gli hold di un id order
			switch (signal) {
				case 'buy': {
					if (n(s.balance.currency).subtract(s.balance.currency_hold || 0).value() < n(order_tmp.price).multiply(order_tmp.size).value() && s.balance.currency_hold > 0) {
						debug.msg('executeSignal - buy delayed: ' + formatPercent(n(s.balance.currency_hold || 0).divide(s.balance.currency).value()) + ' of funds (' + formatCurrency(s.balance.currency_hold, s.currency) + ') on hold')
						return setTimeout(function () {
							if (s.last_signal === signal) {
								s.hold_signal = true
								executeSignal(signal, sig_type, position_id)
							}
						}, conf.wait_for_settlement)
					}
					else {
						s.hold_signal = false
						pushMessage('Buying ' + formatAsset(order_tmp.size, s.asset) + ' on ' + s.exchange.name.toUpperCase(), 'placing ' + signal + ' order at ' + formatCurrency(order_tmp.price, s.currency) + ', ' + formatCurrency(n(s.quote.bid - order_tmp.price).format('0.00'), s.currency) + ' under best bid\n', 9)

//						//Controllo se l'ordine è già stato piazzato
//						//Effettuo un altro controllo in questo punto, prima di chiamare doOrder()
//						// per cercare di risolvere il problema dovuto alla sovrapposizione di ordini.
//						if (!is_reorder && s.orders[signal_id]) {
//							debug.msg('executeSignal - prima di doOrder(): !is_reorder && esiste s.orders[' + signal_id + ']. Ordine già piazzato!!')
//							pushMessage('executeSignal - prima di doOrder(buy)', 'Ordine già piazzato. Hai fatto bene a mettere questo if', 0)
//							if (is_taker)
//								s.orders[signal_id].order_type = 'taker'
//							// order already placed
//							_cb && _cb(null, null)
//							return
//						}

						doOrder()
					}
					break
				}
				case 'sell': {
					//Controllo asset in hold
					// Da trovare il modo per intercettare anche gli id order
					if (n(s.balance.asset).subtract(s.balance.asset_hold || 0).value() < n(order_tmp.size).value()) {
						debug.msg('executeSignal - sell delayed: ' + formatPercent(n(s.balance.asset_hold || 0).divide(s.balance.asset).value()) + ' of funds (' + formatAsset(s.balance.asset_hold, s.asset) + ') on hold')
						debug.msg('executeSignal - s.balance.asset ' + s.balance.asset + ' s.balance.asset_hold ' + s.balance.asset_hold + ' size ' + order_tmp.size)
						return setTimeout(function () {
							if (s.last_signal === signal) {
								s.hold_signal = true
								executeSignal(signal, sig_type, position_id)
							}
						}, conf.wait_for_settlement)
					}
					else {
						s.hold_signal = false
						pushMessage('Selling ' + formatAsset(order_tmp.size, s.asset) + ' on ' + s.exchange.name.toUpperCase(), 'placing sell order at ' + formatCurrency(order_tmp.price, s.currency) + ', ' + formatCurrency(n(order_tmp.price - s.quote.ask).format('0.00'), s.currency) + ' over best ask\n', 9)
						//debug.msg('Selling -> doOrder')

//						//Controllo se l'ordine è già stato piazzato
//						//Effettuo un altro controllo in questo punto, prima di chiamare doOrder()
//						// per cercare di risolvere il problema dovuto alla sovrapposizione di ordini.
//						if (!is_reorder && s.orders[signal_id]) {
//							debug.msg('executeSignal - prima di doOrder(): !is_reorder && esiste s.orders[' + signal_id + ']. Ordine già piazzato!!')
//							pushMessage('executeSignal - prima di doOrder(sell)', 'Ordine già piazzato. Hai fatto bene a mettere questo if', 0)
//							if (is_taker)
//								s.orders[signal_id].order_type = 'taker'
//							// order already placed
//							_cb && _cb(null, null)
//							return
//						}
						
						doOrder()
					}
					break
				}
			}				
		})

		function doOrder () {
			//debug.msg('doOrder')
			placeOrder(function (err, order) {
				if (err) {
					err.desc = 'executeSignal - doOrder - Could not execute ' + signal + ' ' + sig_type + ' ' + position_id + ': error placing order'
					return cb(err)
				}

				//Gestione eccezioni ed errori
				if (!order) {
					if (order === false) {
						// not enough balance, or signal switched.
						debug.msg('executeSignal - doOrder - not enough balance, or signal switched, cancel ' + signal + ' ' + sig_type + ' ' + position_id)
						return cb(null, null)
					}
					if (s.last_signal !== signal) {
						// order timed out but a new signal is taking its place
						debug.msg('executeSignal - doOrder - signal switched, cancel ' + signal + ' ' + sig_type + ' ' + position_id)
						return cb(null, null)
					}
					// order timed out and needs adjusting
					debug.msg('executeSignal - doOrder - ' + signal + ' ' + sig_type + ' ' + position_id + ' order timed out, adjusting price')
//					let remaining_size = s.orders[signal_id] ? s.orders[signal_id].remaining_size : size
					if (order_tmp.remaining_size != order_tmp.size) {
						debug.msg('executeSignal - doOrder - remaining size: ' + order_tmp.remaining_size + ' of ' + order_tmp.size)
					}
					return executeSignal(signal, sig_type, position_id, null, null, true, is_taker, _cb)
				}
				cb(null, order)
			})
		}
		
		function placeOrder (cb) {
			let order_copy = JSON.parse(JSON.stringify(order_tmp))

			//Piazza l'ordine sull'exchange
			s.exchange[signal](order_copy, function (err, api_order) {
				if (err)
					return cb(err)
				
				s.api_order = api_order

				//Nel caso di rifiuto dell'ordine...
				if (api_order.status === 'rejected') {
					debug.msg('executeSignal - placeOrder - s.exchange rejected: ' + api_order.reject_reason)
					if (api_order.reject_reason === 'post only') {
						// trigger immediate price adjustment and re-order
						debug.msg('executeSignal - placeOrder - post-only ' + signal + ' ' + sig_type + ' ' + position_id + ' failed, re-ordering')
						return cb(null, null)
					}
					else if (api_order.reject_reason === 'balance') {
						// treat as a no-op.
						debug.msg('executeSignal - placeOrder - not enough balance for ' + signal + ' ' + sig_type + ' ' + position_id + ', aborting')
						return cb(null, false)
					}
					else if (api_order.reject_reason === 'price') {
						// treat as a no-op.
						debug.msg('executeSignal - placeOrder - invalid price for ' + signal + ' ' + sig_type + ' ' + position_id + ', aborting')
						return cb(null, false)
					}
					err = new Error('\norder rejected')
					err.order = api_order
					return cb(err)
				}
				debug.msg('placeOrder - ' + signal + ' ' + sig_type + ' ' + position_id + ' order placed at ' + formatCurrency(order_tmp.price, s.currency))
				order_tmp.order_id = api_order.id

				//Con ordine piazzato, lo marca temporalmente
				if (!order_tmp.orig_time) {
					order_tmp.orig_time = new Date(api_order.created_at).getTime()
				}
				order_tmp.time = new Date(api_order.created_at).getTime()
				order_tmp.local_time = now()
				order_tmp.order_status = api_order.status
				
				setTimeout(function() { checkOrder(signal, sig_type, position_id, cb) }, so.order_poll_time)
			})
		}
	}

	function checkOrder (signal, sig_type, position_id, cb) {
		//debug.msg('checkOrder')
		order_tmp = s.orders.find(x => (x.signal === signal && x.type === sig_type && x.id === position_id))
		
		if (order_tmp.position.status === 'canceled') {
			// signal switched, stop checking order
			debug.msg('checkOrder - signal switched during ' + signal + ' ' + sig_type + ' ' + position_id + ', aborting')
			pushMessage('Signal switched during ' + signal + ' ' + sig_type + ' ' + position_id, ' aborting', 9)
			return cancelOrder(signal, sig_type, position_id, false, cb)
		}
		s.exchange.getOrder({order_id: order_tmp.order_id, product_id: s.product_id}, function (err, api_order) {
			if (err)
				return cb(err)
				
			if (api_order) {
				s.api_order = api_order
				order_tmp.order_status = api_order.status
			
				if (api_order.reject_reason)
					order_tmp.reject_reason = api_order.reject_reason

				//Ordine eseguito!!
				if (api_order.status === 'done') {
					order_tmp.time = new Date(api_order.done_at).getTime()
					order_tmp.price = api_order.price || order_tmp.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
					order_tmp.filled_size = api_order.filled_size
					order_tmp.executed_value += api_order.executed_value
					order_tmp.remaining_size = n(order_tmp.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					if (order_tmp.position.side == signal) {
						debug.msg('checkOrder - getOrder - side == signal')
						order_tmp.position.value += api_order.executed_value
						order_tmp.position.size += api_order.filled_size
					}
					else {
						debug.msg('checkOrder - getOrder - side != signal')
						order_tmp.position.value -= api_order.executed_value
						order_tmp.position.size -= api_order.filled_size
					}
					debug.msg('checkOrder - getOrder - done - api_order.executed_value= ' + api_order.executed_value + ' ; api_order.filled_size= ' + api_order.filled_size + ' ; remaining_size= ' + order_tmp.remaining_size + ' ; surplus= ' + order_tmp.position.value)
					executeOrder(signal, sig_type, position_id)
	
					//Esco dalla funzione, restituendo syncBalance
					return syncBalance(function () {
						cb(null, true)
					})
				}

				//Ordine rifiutato
				if (order_tmp.status === 'rejected' && (order_tmp.reject_reason === 'post only' || api_order.reject_reason === 'post only')) {
					debug.msg('checkOrder - post-only ' + signal + ' ' + sig_type + ' ' + position_id + ' failed, re-ordering')
					return cb(null, null)
				}
				if (order_tmp.status === 'rejected' && order_tmp.reject_reason === 'balance') {
					debug.msg('checkOrder - not enough balance for ' + signal + ' ' + sig_type + ' ' + position_id + ', aborting')
					return cb(null, null)
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
						if (order_tmp.price < s.quote.bid) {
							debug.msg('checkOrder - ' + s.quote.bid + ' > our ' + order_tmp.price)
							cancelOrder(signal, sig_type, position_id, true, cb)
						}
						else {
							order_tmp.local_time = now()
							setTimeout(function() { checkOrder(signal, sig_type, position_id, cb) }, so.order_poll_time)
						}
					}
					
					if (signal === 'sell') {
						if (order_tmp.price > s.quote.ask) {
							debug.msg('checkOrder - ' + s.quote.ask + ' < our ' + order_tmp.price)
							cancelOrder(signal, sig_type, position_id, true, cb)
						}
						else {
							order_tmp.local_time = now()
							setTimeout(function() { checkOrder(signal, sig_type, position_id, cb) }, so.order_poll_time)
						}
					}
				})
			}
			else {
				setTimeout(function() { checkOrder(signal, sig_type, position_id, cb) }, so.order_poll_time)
			}
		})
	}
	
	function cancelOrder (signal, sig_type, position_id, do_reorder, cb) {
		order_tmp = s.orders.find(x => (x.signal === signal && x.type === sig_type && x.id === position_id))
//		debug.msg('cancelOrder - Position:')
//		debug.printPosition(order_tmp)
		
		s.exchange.cancelOrder({order_id: order_tmp.order_id, product_id: s.product_id}, function () {
			function checkHold (do_reorder, cb) {
				s.exchange.getOrder({order_id: order_tmp.order_id, product_id: s.product_id}, function (err, api_order) {
					if (api_order) {
						s.api_order = api_order
						order_tmp.order_status = api_order.status
						
						if (api_order.status === 'done' || api_order.filled_size) {
							order_tmp.time = new Date(api_order.done_at).getTime()
							order_tmp.price = api_order.price || order_tmp.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
							order_tmp.filled_size = api_order.filled_size
							order_tmp.executed_value += api_order.executed_value
							order_tmp.remaining_size = n(order_tmp.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
							if (order_tmp.position.side == signal) {
								debug.msg('cancelOrder - getOrder - side == signal')
								order_tmp.position.value += api_order.executed_value
								order_tmp.position.size += api_order.filled_size
							}
							else {
								debug.msg('cancelOrder - getOrder - side != signal')
								order_tmp.position.value -= api_order.executed_value
								order_tmp.position.size -= api_order.filled_size
							}
							debug.msg('cancelOrder - getOrder - cancel failed - order done or partially done')
							debug.msg('api_order.executed_value= ' + api_order.executed_value + ' ; api_order.filled_size= ' + api_order.filled_size + ' ; remaining_size= ' + order_tmp.remaining_size + ' ; surplus= ' + order_tmp.position.value, false)
							
							if (!do_reorder || !((s.product.min_size && order_tmp.remaining_size >= Number(s.product.min_size)) || (s.product.min_total && n(order_tmp.remaining_size).multiply(order_tmp.price).value() >= Number(s.product.min_total)))) {
								debug.msg('cancelOrder - not do_reorder || order done || remaining_size < minimo ordine possibile')
								executeOrder(signal, sig_type, position_id)
								return syncBalance(function () {
									cb(null, true)
								})
							}
						}
					}
					else {
						orderDelete(signal, sig_type, position_id)
					}
					
					syncBalance(function () {
						let on_hold
//						if (type === 'buy') on_hold = n(s.balance.deposit).subtract(s.balance.currency_hold || 0).value() < n(order.price).multiply(order.remaining_size).value()
//************** Da controllare questo punto.						
						if (signal === 'buy')
							on_hold = n(s.available_balance.currency).subtract(s.balance.currency_hold || 0).value() < n(order_tmp.price).multiply(order_tmp.remaining_size).value()
						else
							on_hold = n(s.available_balance.asset).subtract(s.balance.asset_hold || 0).value() < n(order_tmp.remaining_size).value()

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

	function executeOrder (signal, sig_type, position_id) {
		debug.msg('executeOrder - inizio')
		order_tmp = s.orders.find(x => (x.signal === signal && x.type === sig_type && x.id === position_id))
		
		let fee = 0
		if (!so.order_type) {
			so.order_type = 'maker'
		}

//		// If order is cancelled, but on the exchange it completed, we need to recover it here
//		if (!s.orders[signal][sig_type][position_id])
//			s.orders[signal_id] = trade
			
		if (so.order_type === 'maker') {
			if (s.exchange.makerFee)
				fee = n(order_tmp.size).multiply(s.exchange.makerFee / 100).value()
		}
		if (so.order_type === 'taker') {
			if (s.exchange.takerFee)
				fee = n(order_tmp.size).multiply(s.exchange.takerFee / 100).value()
		}

		s.action = (signal == 'buy' ? 'bought' : 'sold')
		
		//Archivio il trade in s.my_trades
		let my_trade = {
			id: position_id,
			_id: position_id,
			order_id: order_tmp.order_id,
			time: order_tmp.time,
			execution_time: order_tmp.time - order_tmp.orig_time,
			slippage: (signal == 'buy' ? 1 : -1) * n(order_tmp.price).subtract(order_tmp.initial_price).divide(order_tmp.initial_price).value(),
			side: signal,
			size: order_tmp.filled_size,
			fee: fee,
			price: n(order_tmp.executed_value).divide(order_tmp.filled_size).format('0.00'),
			initial_price: order_tmp.initial_price,
			//Al cost manca il fee... da aggiungere una volta capito come calcolarlo
			value: order_tmp.position.value,
			position_initial_price: order_tmp.position.price,
			order_type: so.order_type || 'taker',
			profit: order_tmp.position.profit_pct,
			position_span: (order_tmp.position.time != null ? (moment.duration(order_tmp.time - order_tmp.position.time).humanize()) : null),
			cancel_after: so.cancel_after || null //'day'
		}
		s.my_trades.push(my_trade)
		
		//La posizione esisteva già, quindi devo aggiornarla
		if (order_tmp.position.id != null) {
			position_index = s.positions.findIndex(x => x.id === position_id)
			
			if (order_tmp.position.size != 0) {
				debug.msg('executeOrder - posizione ' + position_id + ' non chiusa completamente. Rimangono ' + formatAsset(order_tmp.position.size, s.asset))
				debug.printPosition(order_tmp.position)
				
				s.update_position_id = position_id
				s.delete_position_id = null
			} 
			else {
				//Elimino la posizione da s.positions
				debug.msg('executeOrder - delete position ' + position_id + ' (lenght attuale ' + s.positions.length +')')
				
				s.update_position_id = null
				s.delete_position_id = position_id
				
				debug.msg('executeOrder - delete s.position ' + position_id + '(index ' + position_index + ')')
				s.positions.splice(position_index,1)

				updatePositions(order_tmp)

				//Cancella anche tutti gli ordini connessi con la posizione
				orderSetStatus(undefined, undefined, position_id, 'canceled')
				
//				debug.msg('executeOrder - Lista posizioni rimaste')
//				debug.printPosition(s.positions)
			}
		}
		//La posizione non esisteva, quindi va inserita nell'array delle posizioni
		else {
			//Preparo la posizione e la archivio in s.positions
			position = order_tmp.position
			position.id = order_tmp.id
			position._id = order_tmp.id
			position.status = 'free'
			position.price = n(order_tmp.position.value).divide(order_tmp.position.size).format('0.00')
			position.time = order_tmp.time //Time apertura della posizione		
			position.buy_stop = (position.side == 'buy' ? so.buy_stop_pct && n(position.price).multiply(1 + so.buy_stop_pct/100).value() : null)
			position.sell_stop = (position.side == 'sell' ? so.sell_stop_pct && n(position.price).multiply(1 - so.sell_stop_pct/100).value() : null)
								
			s.positions.push(position)
						
			debug.printPosition(s.positions[s.positions.length-1])
			
			s.update_position_id = position_id
			s.delete_position_id = null
			updatePositions(order_tmp)
			
			orderDelete(signal, sig_type, position_id)
		}

		//Messaggio di ordine eseguito
		if (so.stats) {
			let order_complete = '\n**** ' + signal.toUpperCase() + ' order completed at ' + moment(my_trade.time).format('YYYY-MM-DD HH:mm:ss') + ':\n\n' + formatAsset(my_trade.size, s.asset) + ' at ' + formatCurrency(my_trade.price, s.currency) + '\nTotal ' + formatCurrency(my_trade.value, s.currency) + '\n'
			order_complete += n(my_trade.slippage).format('0.0000%') + ' slippage (orig. price ' + formatCurrency(my_trade.initial_price, s.currency) + ')\nexecution: ' + moment.duration(my_trade.execution_time).humanize() + '\n'
			order_complete += 'Positions: ' + s.positions.length
			if (position_index != null) {
				order_complete += '\nOriginal price: ' + formatCurrency(my_trade.position_initial_price, s.currency)
				order_complete += '\nProfit: ' + n(my_trade.profit).format('0.0000%')
				order_complete += '\nExecution: ' + moment.duration(my_trade.execution_time).humanize()
				order_complete += '\nPosition span: ' + my_trade.position_span
			}
			console.log((order_complete).cyan)
			pushMessage(s.exchange.name.toUpperCase(), order_complete, 5)
		}
		
		s['last_' + signal + '_price'] = my_trade.price
		s['last_' + signal + '_time'] = my_trade.time
		
		emitSignal('orderExecuted', signal)
		
		debug.msg('executeOrder - Fine')
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
		if (orderExist('buy')) {
			process.stdout.write(z(9, 'buying', ' ').green)
		}
		else if (orderExist('sell')) {
			process.stdout.write(z(9, 'selling', ' ').red)
		}
		else if (s.action) {
			process.stdout.write(z(9, s.action, ' ')[s.action === 'bought' ? 'green' : 'red'])
		}
		else if (s.signal) {
			process.stdout.write(z(9, s.signal, ' ')[s.signal === ('pump' || 'dump') ? 'white' : s.signal === 'buy' ? 'green' : 'red'])
		}
		else if (s.is_dump_watchdog || s.is_pump_watchdog) {
			process.stdout.write(z(9, 'P/D Calm', ' ').white)
		}
		else if (s.max_profit_position.trend.buy != null || s.max_profit_position.trend.sell != null) {
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
			process.stdout.write(z((asset_col.length + 1), asset_col, ' ').white)
						
			let currency_col = n(s.balance.currency).format(isFiat() ? '0.00' : '0.00000000')
			if (s.available_balance && s.balance.currency != s.available_balance.currency) {
				currency_col += '(' + n(s.available_balance.currency).format(isFiat() ? '0.00' : '0.00000000') + ')'
			}
			currency_col += ' ' + s.currency
			process.stdout.write(z((currency_col.length + 1), currency_col, ' ').green)
			
			//Profitto sul capitale iniziale
			let consolidated = n(s.balance.currency).add(n(s.balance.asset).multiply(s.period.close))
			let profit = n(consolidated).divide(s.orig_capital).subtract(1).value()
			process.stdout.write(z(8, formatPercent(profit), ' ')[profit >= 0 ? 'green' : 'red'])
			
			//Profitto sul buy&hold
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
					emitSignal('standard', s.signal)
					
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
		
		s.positions.forEach(function (position, index) {
			position.profit_pct = (position.side == 'buy' ? +100 : -100) * (trade.price - position.price) / position.price
//			debug.msg('updatePositions - max_profit= ' + max_profit, false)
			if (so.profit_stop_enable_pct && position.profit_pct >= (so.profit_stop_enable_pct)) {
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
		output_lines.push('\n' + s.positions.length + ' positions opened' + (side_trend_max_profit ? (' (' + side_trend_max_profit[0] + formatPercent(pct_trend_max_profit/100) + ').') : '.'))
		output_lines.push(side_trail_max_profit ? ('\n Trailing position: ' + (side_trail_max_profit[0] + formatPercent(pct_trail_max_profit/100))) : '')
		pushMessage('Status', output_lines, 0)
	}
	
	//Funzione per controllare l'esistenza di un ordine specifico (se si immette un solo parametro, gli altri non entrano nel confronto)
	function orderExist(signal, sig_type, position_id) {
		return s.orders.find(x => ((signal != undefined ? (x.signal === signal) : true) && (sig_type != undefined ? (x.type === sig_type) : true) && (position_id != undefined ? (x.id === position_id) : true)))
	}
	
	//Funzione per cancellare un ordine da s.orders
	function orderDelete(signal, sig_type, position_id) {
		s.orders.forEach(function (order, index) {
			if ((signal ? order.signal === signal : true) && (sig_type ? order.type === sig_type : true) && (position_id ? order.id === position_id : true)) {
				debug.msg('orderDelete - delete s.orders ' + order.signal + ' ' + order.type + ' ' + order.id)
				order.position.status = 'free'
				s.orders.splice(index, 1)
				//debug.printPosition(s.positions)
			}
		})
		return
	}
	
	//Funzione per configurare lo status di uno o più ordini
	function orderSetStatus(signal, sig_type, position_id, status, cb = function() {}) {
		s.orders.forEach(function (order, index) {
			if ((signal ? order.signal === signal : true) && (sig_type ? order.type === sig_type : true) && (position_id ? order.id === position_id : true)) {
				debug.msg('orderSetStatus - s.orders(' + order.signal + ', ' + order.type + ', ' + order.id + ').status = ' + status)
				order.position.status = status
			}
		})
		return cb()
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
		updateMessage: updateMessage,
		emitSignal: emitSignal,
		orderDelete: orderDelete,
		orderExist: orderExist,
		orderSetStatus: orderSetStatus
	}
}
