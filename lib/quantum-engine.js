let tb = require('timebucket')
, moment = require('moment')
//, z = require('zero-fill')
, n = require('numbro')
, crypto = require('crypto')
// eslint-disable-next-line no-unused-vars
, colors = require('colors')
, abbreviate = require('number-abbreviate')
, readline = require('readline')
, path = require('path')
, _ = require('lodash')
, rsi = require('./rsi')
, async = require('async')
, lolex = require('lolex')
, { formatAsset, formatPercent, formatCurrency } = require('./format')
, debug = require('./debug')
//, quantumTools = require ('./quantum-tools')
//, collectionService = require('../lib/services/collection-service')

let clock
let nice_errors = new RegExp(/(protection|watchdog|calmdown|funds|size)/)

module.exports = function (s, conf) {
	let so = s.options
//	var tools = quantumTools(s, conf)
	
//	//Carico le funzioni di utilità
//	quantumTools(s, conf)
	
	s.eventBus = conf.eventBus
	s.product_id = so.selector.product_id
	s.asset = so.selector.asset
	s.currency = so.selector.currency
	s.hold_signal = false
	s.next_check = 0
	s.check_too_small = true
	s.day_count = 1
	s.total_fees = 0
	s.vol_since_last_blink = 0

	//Inizializza i flag per le strategie
	s.strategyFlag = {
		free: 0,
		manual: 1,
	}
	
	//Inizializza i flag per le eccezioni alle protezioni
	s.protectionFlag = {
		all: 0,
		calmdown: 1,
		max_slippage: 2,
		min_profit: 4,
		long_short: 8,
		max_position: 16,
		only_one_side: 32,
	}
	
	//Inizializza l'array per le strategie "no hold check"
	s.noHoldCheckStrategy = []

	//Inizializzazione delle code asincrone
	var tradeProcessingQueue = async.queue(function({trade, is_preroll}, callback) {
		if (s.exchange.debug_exchange) {
			debug.obj('tradeProcessingQueue:', trade)
		}
		onTrade(trade, is_preroll, callback)
	})
	
//	s.eventBus.on('trade', queueTrade)
	s.eventBus.on('trade', (trade) => {
		tradeProcessingQueue.push({trade, is_preroll = false})
	})
//	s.eventBus.on('trades', onTrades)
	
	//Assegna l'exchange tra live, sim o paper
	if(_.isUndefined(s.exchange)) {
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
			if (!s.product.increment) {
				s.product.increment = undefined
			}
			if (!s.product.asset_increment) {
				s.product.asset_increment = undefined
			}
			debug.obj('s.product:', s.product)
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

	//Attiva il listener per gli ordini di tipo manual
	s.eventBus.on('manual', (signal, position_id, fixed_size, fixed_price, protectionFree, locking = 'manual', is_reorder, is_taker = false) => {
		debug.msg('Listener -> manual ' + signal + (fixed_size? (' ' + formatAsset(fixed_size, s.asset)) : '') + (fixed_price? (' at ' + formatCurrency(fixed_price, s.currency)) : '') + (is_taker? ' taker' : ''))
		executeSignal (signal, 'manual', position_id, fixed_size, fixed_price, protectionFree, locking, false, is_taker)
	})
	
	//Funzione per assegnare a so.strategy[strategia_in_esame].opts[nome_opzione] il valore di default definito nel file della strategia
	s.ctx = {
		option: function (strategy_name, option_name, desc, type, default_value) {
			if (typeof so.strategy[strategy_name].opts[option_name] === 'undefined') {
				so.strategy[strategy_name].opts[option_name] = default_value
			}
		}
	}
	
	//Inizializzo le strategie
	debug.msg('Inizializzo le strategie')
	Object.keys(so.strategy).forEach(function (strategy_name, index) {
		so.strategy[strategy_name].lib = require(path.resolve(__dirname, `../extensions/strategies/${strategy_name}/strategy`))
		
		//Aggiunge la strategia alla lista degli strategyFlag
		s.strategyFlag[strategy_name] = Math.pow(2, (index + 1))
			
		so.strategy[strategy_name].calc_lookback = []
		
		if (so.strategy[strategy_name].lib.init) {
			so.strategy[strategy_name].lib.init(s)
		}
		
		if (so.strategy[strategy_name].lib.getOptions) {
			//Applica a s.ctx il metodo getOptions preso da so.strategy[strategy_name] 
			// e quindi chiama la funzione option() di s.ctx per ogni option di getOptions
			// Alla fine avremo 
			so.strategy[strategy_name].lib.getOptions.call(s.ctx, s)
		}
		
		//Attiva il listener per gli ordini della strategia
		s.eventBus.on(strategy_name, (signal, position_id= null, fixed_size= null, fixed_price= null, protectionFree = 0, locking = 'free', is_reorder= false, is_taker= false) => {
			debug.msg('Listener -> ' + strategy_name + ' ' + signal + (position_id? (' ' + position_id) : '') + (fixed_size? (' size= ' + fixed_size) : '') + (fixed_price? (' price= ' + fixed_price) : '') + (protectionFree? (' protectionFree= ' + protectionFree) : '') + (is_reorder? ' reorder' : '') + (is_taker? ' taker' : ''))
			executeSignal (signal, strategy_name, position_id, fixed_size, fixed_price, protectionFree, locking, is_reorder, is_taker)
		})
		
//		//Attiva il listener per la procedura post-ordine (se esiste) 
//		if (so.strategy[strategy_name].lib.onOrderExecuted) {
//			s.eventBus.on('orderExecuted', (signal, sig_kind, position_id) => {
//				if (sig_kind === strategy_name) {
//					so.strategy[strategy_name].lib.onOrderExecuted(s, signal, position_id)
//				}
//			})
//		}
		
		//Inserisce la strategia nell'array delle strategie "No hold check"
		if (so.strategy[strategy_name].lib.noHoldCheck) {
			s.noHoldCheckStrategy.push(strategy_name)
		}
	})
	console.log('Fine inizializzazioni strategie - s.strategyFlag:')
	debug.printObject(s.strategyFlag, true)
	console.log('s.noHoldCheckStrategy:')
	debug.printObject(s.noHoldCheckStrategy, true)
	// Fine assegnazione opzioni per la strategia
		
//	//Funzione per emettere un segnale sul bus
//	function emitSignal (sig_kind, signal, position_id, fixed_size, fixed_price, is_reorder, is_taker) {
//		s.eventBus.emit(sig_kind, signal, position_id, fixed_size, fixed_price, protectionFree, is_reorder, is_taker)
//	}

	//Funzione per la stampa a schermo di tutti i dati del programma, esclusi i dati storici e quelli dei database
	function memDump () {
		if (!debug.on) return
		let s_copy = JSON.parse(JSON.stringify(s))
		delete s_copy.options.db
		delete s_copy.lookback
		Object.keys(s_copy.options.strategy).forEach(function (strategy_name, index) {
			delete s_copy.options.strategy[strategy_name].calc_lookback
		})
		console.error(s_copy)
	}
	
	if (conf.output.api.on) {
		s.boot_time = (new Date).getTime()
		s.tz_offset = new Date().getTimezoneOffset()
//		s.last_trade_id = 0
//		s.trades = []
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
			latest_trade_time: trade.time,
			rsi: null, //Ci sono anche altri valori di rsi che vengono salvati qui dentro
//Da sistemare: rsi dentro questa struttura va organizzato meglio (o forse tolto completamente)
		}
				
		Object.keys(so.strategy).forEach(function (strategy_name, index) {
			if (so.strategy[strategy_name].opts.period_calc) {
				so.strategy[strategy_name].calc_close_time = tb(trade.time).resize(so.strategy[strategy_name].opts.period_calc).add(1).toMilliseconds() - 1
			}
		})
	}
	
	//Inizializza una posizione position_id, ma non la inserisce nell'array delle posizioni
	function initPosition (position_id = null) {
		position = {
				id: position_id,
				selector: so.selector.normalized,
				status: s.strategyFlag.free,
				opened_by: s.strategyFlag.free,
				closed_by: s.strategyFlag.free,
				locked: s.strategyFlag.free,
				side: null,
				price_open: null, //Prezzo medio apertura posizione
				price_close: null, //Prezzo medio chiusura posizione
				size: 0, //Valore asset attuale della posizione
				initial_size: 0, //Valore asset della posizione aperta
				accumulated_asset: 0, //Valore asset accumulato
				value: 0, //Valore currency attuale della posizione
				value_open: 0, //Valore currency della posizione aperta
				value_close: 0, //Ricavo currency dalla posizione chiusa
				fee_open: 0, //Fee di apertura
				fee_close: 0, //Fee di chiusura
				fee_asset: false, //Fee asset
				time_open: null, //Time apertura della posizione
				time_close: null, //Time chiusura della posizione
				human_time_open: null, //Time apertura posizione in formato leggibile
				human_time_close: null, //Time chiusura posizione in formato leggibile
				profit_gross_pct: null,
				profit_net_pct: null,
				strategy_parameters: {},
//				sell_stop: null,
//				buy_stop: null,
//				profit_stop_limit: null,
//				profit_stop: null				
		}		
		return position
	}
	
	//Inizializza un ordine e lo inserisce nell'array degli ordini
	function initOrder (orderSignal, orderKind = 'manual', position_id = null, locking = 'free', is_taker = false, cb) {			
		order = {
			id: position_id,
			signal: orderSignal,
			kind: orderKind,
			time: null,
			orig_time: null, //Tempo iniziale dell'ultimo trade della posizione
			local_time: null, //Tempo locale iniziale dell'ultimo trade della posizione
			initial_price: null, //Prezzo iniziale dell'ultimo trade della posizione
			price: null, //Prezzo finale dell'ultimo trade della posizione
			fixed_price: null,
			fill_fees: 0,
			fill_fees_pct: 0,
			fee_asset: false,
			expected_fee: 0, //Fee stimate
			size: null, //Size attuale del trade (variabile di servizio)
//			orig_size: null, //Size inizio trade (serve per i riordini)
			remaining_size: null, //Rimanenza del trade (serve per i riordini)
			filled_size: 0, //Size commerciato del trade (variabile di servizio)
			executed_value: 0, //Value commerciato del trade (variabile di servizio)
			funds: 0,
			order_type: is_taker ? 'taker' : so.order_type,
			order_id: null,
			order_status: null,
			product_id: s.product_id,
			post_only: conf.post_only,
			cancel_after: (orderKind === 'standard' ? so.cancel_after : null), // s.cancel_after || 'day'
			position: {}
		}
		
		// La posizione nuova non ha id. Questo perchè a ordine eseguito, la funzione executeOrder esegue un controllo sull'id per vedere
		//    se la posizione esisteva (e quindi va aggiornata) o no (e quindi va creata)
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
		
//		if (orderKind === 'manual')
//			s.tools.positionFlags(order.position, 'locked', 'Set', 'manual');

		if (locking != 'free')
			s.tools.positionFlags(order.position, 'locked', 'Set', locking);
			
		//Lo status deve essere fissato una volta inserito l'ordine sull'exchange, quindi in placeOrder
//		orderStatus(order, undefined, undefined, undefined, 'Set', s.strategyFlag[orderKind])
		
//		debug.msg('initOrder - ordine associato/creato:')
//		debug.printObject(order)
		
		return order
	}
	
	//Funzione per ricavare il prezzo partendo da s.quote, considerando l'opzione best_bid/ask
	function nextPriceForQuote(signal) {
		switch (signal) {
			case 'buy': {
				//Da controllare Math.floor in quel punto, perchè credo che non faccia nulla
				var npfq = n(s.quote.bid).add(so.best_bid ? s.product.increment : 0).format(s.product.increment) //, Math.floor)
				debug.msg('nextPriceForQuote - npfq= ' + npfq + ' ; s.quote.bid= ' + s.quote.bid + ' ; s.product.increment= ' + s.product.increment)
				if (n(npfq).subtract(s.quote.ask).value() > 0) {
					debug.msg('nextPriceForQuote - npfq (' + npfq + ') > ask (' + s.quote.ask + '). Correcting...')
					npfq = n(s.quote.ask).subtract(s.product.increment).format(s.product.increment, Math.floor)
				}
				debug.msg('nextPriceForQuote - buy bid=' + s.quote.bid + ' return=' + npfq)
				return npfq
				break
			}
			case 'sell': {
				var npfq = n(s.quote.ask).subtract(so.best_ask ? s.product.increment : 0).format(s.product.increment) //, Math.ceil)
				debug.msg('nextPriceForQuote - npfq= ' + npfq + ' ; s.quote.ask= ' + s.quote.ask + ' ; s.product.increment= ' + s.product.increment)
				if (n(npfq).subtract(s.quote.bid).value() < 0) {
					debug.msg('nextPriceForQuote - npfq (' + npfq + ') < bid (' + s.quote.bid + '). Correcting...')
					npfq = n(s.quote.bid).add(s.product.increment).format(s.product.increment, Math.floor)
				}
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
		
//		//Se c'è stato un nuovo trade, aggiungilo a s.trades
//		if (s.trades && s.last_trade_id !== trade.trade_id) {
//			s.trades.push(trade)
//			s.last_trade_id = trade.trade_id
//		}
//		
//		//Ripulisci s.trades a un max di valori
//		if (s.trades.length > so.keep_trades) {
//			s.trades.splice(so.keep_trades, (s.trades.length - so.keep_trades))
//		}
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
	s.wait_syncBalance = false
	
	function waitCondition (condition, interval, cb) {
		if (s[condition]) {
			debug.msg('waitCondition - ' + condition + '= ' + s[condition] + '. Waiting...')
			setTimeout (function() { waitCondition(condition, interval, cb) }, interval)
		}
		else {
			debug.msg('waitCondition - ' + condition + '= ' + s[condition] + '. Continuing...')
			cb()
		}
	}
	
	function syncBalance (cb = function() {}) {
		if (!s.wait_syncBalance) {
			s.wait_syncBalance = true

			s.exchange.getBalance({currency: s.currency, asset: s.asset}, function (err, balance) {
				if (err) {
					return cb(err)
				}
				s.balance = balance
				s.available_balance = {
					currency: balance.currency,
					asset: balance.asset,
					currency_hold: balance.currency_hold,
					asset_hold: balance.asset_hold
				}

				getQuote(function (err) {
					if (err) {
						return cb(err)
					}

					s.asset_in_currency = n(s.balance.asset).multiply(s.quote.ask).value()
					s.currency_in_asset = n(s.balance.currency).divide(s.quote.bid).value()
					s.currency_capital = n(s.balance.currency).add(s.asset_in_currency).value()
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
						//Se l'ordine è buy, allora ho impegnato currency nell'ordine, quindi devo sottrarla dal balance
						//Se l'ordine è sell, allora ho impegnato asset nell'ordine, quindi devo sottrarla dal balance
						if (order.signal === 'buy') {
							let order_value = n(order.size).multiply(order.price).add(order.expected_fee)
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
					})

					if (!s.start_capital_currency) {
						s.start_price = n(s.quote.ask).value()
						s.start_capital_currency = n(s.balance.currency).add(s.asset_in_currency).value()
					}

					if (!s.start_capital_asset) {
						//E' il caso di differenziare gli start_price?
						s.start_price = n(s.quote.ask).value()
						s.start_capital_asset = n(s.balance.asset).add(s.currency_in_asset).value()
					}

//					debug.msg('syncBalance - balance= ' + JSON.stringify(s.balance) + ' ; available_balance= ' + JSON.stringify(s.available_balance))
					s.wait_syncBalance = false
					//Posso non avere output, tanto aggiorno s.quote e s.balance
					cb()
				})
			})

		}
		else {
			//Attendo 500ms e poi proseguo con la funzione di callback
			debug.msg('syncBalance - Attendo... ')
			waitCondition('wait_syncBalance', 500, cb)
		}
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
		if (product.min_size && Number(quantity) < Number(product.min_size)) {
			return true
		}
		if (product.min_total && Number(quantity * price) < Number(product.min_total)) {
			return true
		}
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
	function executeSignal (signal, sig_kind = 'manual', position_id = null, fixed_size = null, fixed_price = null, protectionFree = 0, locking = 'free', is_reorder, is_taker, _cb) {
		if (s.in_preroll) return
		
		let trade_balance, tradeable_balance
		let order_tmp
		var signal_opposite = (signal === 'buy' ? 'sell' : 'buy')
				
		let cb = function (err, order) {
			if (!order) {
				debug.msg('executeSignal - cb - cancello s.orders ' + signal + ' ' + sig_kind + ' ' + position_id)
				position = s.positions.find(x => x.id === position_id)
//				if (position) {
//					position.profit_stop = null
//					position.profit_stop_limit = null
//				}
//				s.acted_on_trail_stop = null
//				s.acted_on_trend = null
				s.tools.orderDelete(signal, sig_kind, position_id, function () { 
					syncBalance()
				})
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
		
//		//Eseguo il segnale solo se è di tipo buy o sell (no pump o dump o altri)
//		if (!signal.includes('buy') && !signal.includes('sell')) {
//			debug.msg('executeSignal - signal non contiene buy/sell. Esco')
//			_cb && _cb(null, null)
//			return
//		}	
		
		//Se è un riordine...
		if (is_reorder) {
			//..ed esiste s.orders, allora lascio tutto così e vado avanti...
			order_tmp = s.tools.orderExist(signal, sig_kind, position_id)
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
			if (s.tools.orderExist(signal, sig_kind, position_id)) {
				debug.msg('executeSignal - Annullo perchè esiste già s.orders(' + signal + ', ' + sig_kind + ', ' + position_id + ')')
				_cb && _cb(null, null)
				return
			}
			//...altrimenti continuo con i controlli
			else {
				//Controllo calmdown 
				if (!(protectionFree & s.protectionFlag['calmdown'])) {
					debug.msg('executeSignal - Controllo calmdown')
					if (so.buy_calmdown && signal == 'buy') {
						if ((now() - (so.buy_calmdown*60*1000)) < s.last_buy_time) {
							let err = new Error('\nBuySell calmdown')
							err.desc = moment().format('YYYY-MM-DD HH:mm:ss') + ' - refusing to buy. Buy Calmdown is active! Last buy ' + moment(s.last_buy_time).format('YYYY-MM-DD HH:mm:ss') + ' Positions opened: ' + s.positions.length + '\n'
							return cb(err)
						}
					} 
					else if (so.sell_calmdown && signal == 'sell') {
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
					if (s.tools.orderExist(signal, sig_kind, position_id)) {
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
						//Controllo se la posizione ha profitto sufficiente
						if (!(protectionFree & s.protectionFlag['min_profit']) && (so[signal + '_gain_pct'] != null && (position.profit_net_pct - so[signal + '_gain_pct'] < 0))) {
							let err = new Error('\nPosition ' + position_id + ' Profit protection')
							err.desc = 'refusing to ' + signal + ', profit of ' + formatPercent(position.profit_net_pct/100) + ' (limit ' + formatPercent(so[signal + '_gain_pct'] / 100) + ')\n'

							if (err.message.match(nice_errors)) {
								console.error((err.message + ': ' + err.desc).red)
							}
							_cb && _cb(null, null)
							return
						}
						// La posizione ha profitto sufficiente, quindi creo l'ordine a partire dai valori della posizione position_id
						else {
							debug.msg('executeSignal - con position_id. Inizializzo un ordine ' + signal + ' ' + sig_kind + ' su posizione ' + position_id)
							debug.printObject(position)
							order_tmp = initOrder(signal, sig_kind, position_id, locking, is_taker)
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
					//Controllo se ho raggiunto il numero massimo di posizioni
					if (!(protectionFree & s.protectionFlag['max_positions']) && so.max_positions && s.positions.length >= so.max_positions) {
						debug.msg('executeSignal - Non posso operare ' + signal + ': raggiunto il massimo numero di posizioni aperte (' + s.positions.length + ')')
						_cb && _cb(null, null)
						return
					}

//					//Se è un ordine di strategia... 
//					if (so.strategy[sig_kind]) {			
						//...creo un ordine di strategia...

						//Se ce ne sono altri in piedi, non creo questo
						if (s.tools.orderExist(signal, sig_kind, undefined)) {
							debug.msg('executeSignal - Annullo perchè esiste già s.orders ' + signal + ' ' + sig_kind)
							_cb && _cb(null, null)
							return
						}

						//Controllo se posso eseguire ordini long/short
						if (!(protectionFree & s.protectionFlag['long_short'])) {
							debug.msg('executeSignal - Controllo long_short')
							if ((signal == 'buy' && !so.active_long_position) || (signal == 'sell' && !so.active_short_position)) {
								debug.msg('executeSignal - Non posso operare ' + signal + ': so.active_position false')
								_cb && _cb(null, null)
								return //orderDelete(signal, sig_kind, position_id)
							}
						}						

						//Creo un position_id da associare all'ordine
						position_id = crypto.randomBytes(4).toString('hex')

						//Creo l'ordine associato
						debug.msg('executeSignal - senza position_id - Creo nuovo ordine ' + signal + ' ' + sig_kind + ' ' + position_id)
						order_tmp = initOrder(signal, sig_kind, position_id, locking, is_taker)

						//E' un ordine di strategia senza position_id 
						// Cancello TUTTI gli ordini di strategia di senso opposto ancora in essere
						if (!(protectionFree & s.protectionFlag['only_one_side'])) {
							debug.msg('executeSignal - Controllo only_one_side. Ordine ' + sig_kind + '. Cancello TUTTI gli ordini di senso opposto ancora in essere.')
							s.tools.orderStatus(undefined, signal_opposite, sig_kind, undefined, 'Unset', sig_kind)
						}
//					}
//					//Altrimenti creo un ordine sig_kind nuovo
//					else {						
//						//Creo un position_id da associare all'ordine
//						position_id = crypto.randomBytes(4).toString('hex')
//
//						//Creo l'ordine associato
//						debug.msg('executeSignal - senza position_id - Creo nuovo ordine ' + signal + ' ' + sig_kind + ' ' + position_id)
//						order_tmp = initOrder(signal, sig_kind, position_id, is_taker)
//					}
				}
			}
		}

		s.last_signal = signal

//		//Potrebbe servire in alcune strategie
//		if (!position_id)
//		s.acted_on_trend = true
//		else
//		s.acted_on_trend = false

		//Sincronizzo balance e quote, che serviranno nel prosieguo
		syncBalance(function (err) {
//		//Sincronizzo quote che servirà nel prosieguo
//		getQuote(function (err) {
			if (err) {
				if (err.desc) console.error(err.desc)
				if (err.body) console.error(err.body)
				throw err
			}

			//Prepara il PREZZO per l'ordine
			//Ha priorità il fixed_price, altrimenti prende il price derivato dal quote coerente con il segnale.
			// Se è un ordine di mercato, allora il price non è determinante
			order_tmp.price = fixed_price || nextPriceForQuote(signal)
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
			if (!(protectionFree & s.protectionFlag['max_slippage']) && so.max_slippage_pct != null) {
				debug.msg('executeSignal - Controllo max_slippage')
				slippage = Math.abs(n(order_tmp.initial_price).subtract(order_tmp.price).divide(order_tmp.initial_price).multiply(100).value())
				if (slippage > so.max_slippage_pct) {
					let err = new Error('\nSlippage protection')
					err.desc = position_id + ' refusing to ' + signal + ' at ' + formatCurrency(order_tmp.price, s.currency) + ', slippage of ' + formatPercent(slippage / 100)
					s.tools.pushMessage('Slippage protection', ('aborting ' + signal + ' ' + sig_kind + ' ' + position_id), 9)
					return cb(err)
				}
			}

//Ma il controllo sul profitto non lo faccio già sopra?
//			//Controllo profitto della posizione, solo se non sto eseguendo uno stop loss, non è un riordine e non è fixed_price
//			if (!is_reorder && (sig_kind != 'stoploss') && !fixed_price && order_tmp.position.profit_net_pct && so[signal + '_gain_pct'] != null && (order_tmp.position.profit_net_pct - so[signal + '_gain_pct'] < 0)) {
//				let err = new Error('\nPosition ' + position_id + ' Profit protection')
//				err.desc = 'refusing to ' + signal + ' at ' + formatCurrency(order_tmp.price, s.currency) + ', PROFIT of ' + formatPercent(order_tmp.position.profit_net_pct/100) + ' (limit ' + formatPercent(so[signal + '_gain_pct'] / 100) + ')\n'
//
//				if (err.message.match(nice_errors)) {
//					console.error((err.message + ': ' + err.desc).red)
//				}
//				return cb(err)
//			}

			//Prepara la QUANTITA' per l'ordine
			order_tmp.size = n(fixed_size || order_tmp.remaining_size || order_tmp.position.size || n(so.quantum_value).divide(order_tmp.price)).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
			order_tmp.funds = n(so.quantum_value).format(s.product.increment ? s.product.increment : '0.00000000')
			
			if (order_tmp.remaining_size === null) {
				order_tmp.remaining_size = order_tmp.size
			}

			debug.msg('executeSignal - ' + position_id + ' Size: ' + formatAsset(order_tmp.size, s.asset))

			//Controlli sulle quantità di asset e currency (da sostituire con funzione?)

			//Controllo su min e max accettati dall'exchange
			if (isOrderTooSmall(s.product, order_tmp.size, order_tmp.price)) {
				let err = new Error('\nMinimum size')
				err.desc = 'refusing to ' + signal + ' ' + order_tmp.size + ' ' + s.asset + ' < minimum size (' + s.product.min_size + ') (or min total). Position ' + position_id;
				return cb(err, null)
			}

			if (s.product.max_size && Number(order_tmp.size) > Number(s.product.max_size)) {
				debug.msg('executeSignal - size = s.product.max_size')
				order_tmp.size = s.product.max_size
			}

			//Calcolo fee
			if (order_tmp.order_type === 'maker') {
				order_tmp.fill_fees_pct = s.exchange.makerFee
			} else {
				order_tmp.fill_fees_pct = s.exchange.takerFee
			}		

			//Controllo fondi disponibili
			trade_balance = n(order_tmp.size).multiply(order_tmp.price)
			tradeable_balance = n(trade_balance).multiply(100).divide(100 + order_tmp.fill_fees_pct)
			order_tmp.expected_fee = n(trade_balance).subtract(tradeable_balance).format('0.00000000', Math.ceil) // round up as the exchange will too
			if (so.use_fee_asset) {
				tradeable_balance = trade_balance
				order_tmp.fee_asset = true
				order_tmp.position.fee_asset = true
			}
			
			//Se è un ordine standard/catching/trailstop/stoploss, allora controllo di quanto balance effettivo posso disporre
			//  (balance reale meno le quantità bloccate dalle posizioni e dagli ordini manual più la quantità della posizione in esame, se esiste)
			//Se è un ordine manual, allora il controllo deve essere fatto su balance reale meno le quantità bloccate dalle posizioni e dagli ordini manual
//			Secondo me, è possibile togliere il controllo su manual. Verificare.		
//			available_balance_currency = (sig_kind === 'manual' ? s.available_balance.currency : (n(s.available_balance.currency).add(order_tmp.position.value)))
//			available_balance_asset = (sig_kind === 'manual' ? s.available_balance.asset : (n(s.available_balance.asset).add(order_tmp.position.size)))

			
			available_balance_currency = n(s.available_balance.currency).add(order_tmp.position.value)
			available_balance_asset = n(s.available_balance.asset).add(order_tmp.position.size)

			//Dai fondi disponibili, devo aggiungere i fondi degli ordini delle strategie noHoldCheck connessi con la posizione in essere
			let order_tmp_catch_size = 0
			let order_tmp_catch_value = 0
			s.noHoldCheckStrategy.forEach(function (strategy, index) {
				let order_tmp_catch = s.tools.orderExist(undefined, strategy, position_id)

				if (order_tmp_catch) {
					debug.msg('executeSignal - checkHold - Esiste ordine ' + strategy + ' sulla posizione ' + position_id)
					order_tmp_catch_size += Number(order_tmp_catch.size)
					order_tmp_catch_value += n(order_tmp_catch.size).multiply(order_tmp_catch.price).value()
					debug.msg('executeSignal - checkHold - order_tmp_catch_size= ' + order_tmp_catch_size + ' ; order_tmp_catch_value= ' + order_tmp_catch_value)
				}
			})

			debug.msg('executeSignal - preparing ' + signal + ' ' + sig_kind + ' ' + position_id + ' order over ' + formatAsset(order_tmp.size, s.asset) + ' of ' + formatCurrency(tradeable_balance, s.currency) + ' tradeable balance. Expected fee ' + (so.use_fee_asset ? '(FEE ASSET) ' : '') + 'of ' + formatCurrency(order_tmp.expected_fee, s.currency) + ' (' + order_tmp.fill_fees_pct + '%)')

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
				else if (!so.no_check_hold && s.balance.currency_hold > 0 && n(s.balance.currency).subtract(s.balance.currency_hold).add(order_tmp_catch_value).value() < n(order_tmp.price).multiply(order_tmp.size).value()) {
					debug.msg('executeSignal - buy delayed: ' + s.available_balance.currency_hold + ' of funds on hold')
					debug.msg('executeSignal - s.available_balance.currency ' + s.available_balance.currency + '; s.balance.currency ' + s.balance.currency + ' - s.balance.currency_hold ' + s.balance.currency_hold + ' + order_tmp_catch_value ' + order_tmp_catch_value)
					return setTimeout(function () {
						if (s.last_signal === signal) {
							s.hold_signal = true
							executeSignal(signal, sig_kind, position_id, undefined, undefined, protectionFree, locking, true)
						}
					}, conf.wait_for_settlement)
				}
				else {
					s.hold_signal = false
					let title = 'Buying (' + sig_kind + ') ' + formatAsset(order_tmp.size, s.asset, s.product.asset_increment) + ' on ' + s.exchange.name.toUpperCase()
					let message = 'placing BUY order ' + (is_taker ? 'TAKER\n' : 'at ' + formatCurrency(order_tmp.price, s.currency) + ', ' + formatCurrency(n(s.quote.bid).subtract(order_tmp.price).format('0.00'), s.currency) + ' under best bid\n')
					s.tools.pushMessage(title, message, 9)

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
				else if (!so.no_check_hold && s.balance.asset_hold > 0 && n(s.balance.asset).subtract(s.balance.asset_hold).add(order_tmp_catch_size).value() < n(order_tmp.size).value()) {
					debug.msg('executeSignal - sell delayed: ' + s.available_balance.asset_hold + ' of funds on hold')
					debug.msg('executeSignal - s.balance.asset ' + s.balance.asset + ' - s.balance.asset_hold ' + s.balance.asset_hold + ' + order_tmp_catch_size ' + order_tmp_catch_size)
					return setTimeout(function () {
						if (s.last_signal === signal) {
							s.hold_signal = true
							executeSignal(signal, sig_kind, position_id, undefined, undefined, protectionFree, locking, true)
						}
					}, conf.wait_for_settlement)
				}
				else {
					s.hold_signal = false
					let title = 'Selling (' + sig_kind + ') ' + formatAsset(order_tmp.size, s.asset, s.product.asset_increment) + ' on ' + s.exchange.name.toUpperCase()
					let message = 'placing SELL order ' + (is_taker ? 'TAKER\n' : 'at ' + formatCurrency(order_tmp.price, s.currency) + ', ' + formatCurrency(n(order_tmp.price).subtract(s.quote.ask).format(s.product.increment ? s.product.increment : '0.00000000'), s.currency) + ' over best ask\n')
					s.tools.pushMessage(title, message, 9)

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
			s.tools.positionFlags(order_tmp.position, 'status', 'Free', undefined, function() {
				//Una volta inviato il segnale di cancellazione degli ordini, attendo so.order_poll_time prima di 
				// inviare il nuovo ordine sull'exchange
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
// Dopo il primo riordine, order.size diventa l'attuale (ovvero il remaining_size), quindi se viene cancellato, il seguente if non viene eseguito 							
							if (order_tmp.remaining_size != order_tmp.size) {
								debug.msg('executeSignal - doOrder - remaining size: ' + order_tmp.remaining_size + ' of ' + order_tmp.size)
							}
							return executeSignal(signal, sig_kind, position_id, null, null, protectionFree, locking, true, is_taker, _cb)
						}
						cb(null, order)
					})
				}, so.order_poll_time)
			})
		}

		function placeOrder (cb) {
			let order_copy = JSON.parse(JSON.stringify(order_tmp))

			delete order_copy.position
			
			//Se è un ordine maker (limit), allora funds non serve
			//Se è un ordine taker (market), allora size non serve
			if (order_copy.order_type === 'maker') {
				delete order_copy.funds
			}
			else {
				//Binance vuole questo parametro. Per CoinbasePro è opzionale (size e/o funds deve essere specificato, ma 
				// non si è capito quale ha la precedenza) 
//				delete order_copy.size
			}

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
							s.tools.pushMessage('DEBUG', 'placeOrder - Forzato il getQuote!!!', 9)
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

				s.tools.positionFlags(order_tmp.position, 'status', 'Set', sig_kind)

				//Con ordine piazzato, lo marca temporalmente
				if (!order_tmp.orig_time) {
					order_tmp.orig_time = new Date(api_order.created_at).getTime()
				}
				order_tmp.time = new Date(api_order.created_at).getTime()
				order_tmp.local_time = now()
				order_tmp.order_status = api_order.status

				debug.msg('placeOrder - order:')
				debug.printObject(order_tmp)
				
				//Sincronizzo il balance dopo aver piazzato l'ordine
				syncBalance()

				//Ripete il controllo dopo so.order_poll_time.
				setTimeout(function() { checkOrder(signal, sig_kind, position_id, cb) }, so.order_poll_time)
			})
		}
	}

	function checkOrder (signal, sig_kind, position_id, cb) {
//		debug.msg('checkOrder')
		var order_tmp = s.orders.find(x => (x.signal === signal && x.kind === sig_kind && x.id === position_id))
		
//		if (order_tmp.id != position_id) {
//			debug.msg('checkOrder - order_tmp.id <> position_id !!!!')
//			debug.printObject(s.orders)
//		}

		if (!s.tools.positionFlags(order_tmp.position, 'status', 'Check', sig_kind)) {
			// signal switched, stop checking order
			debug.msg('checkOrder - signal switched during ' + signal + ' ' + sig_kind + ' ' + position_id + ', aborting')
			s.tools.pushMessage('Signal switched during ' + signal + ' ' + sig_kind + ' ' + position_id, ' aborting', 9)
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
					s.exchange.getOrder({order_id: order_tmp.order_id, product_id: s.product_id}, true, function (err, api_order) {
						order_tmp.time = new Date(api_order.done_at).getTime()
						order_tmp.price = api_order.price || order_tmp.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
						order_tmp.filled_size = api_order.filled_size
						order_tmp.executed_value = n(api_order.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
						if (!so.use_fee_asset || api_order.fill_fees) {
							order_tmp.fill_fees = n(api_order.fill_fees).format(s.product.increment ? s.product.increment : '0.00000000')
						}
						else {
							order_tmp.fill_fees = n(api_order.executed_value).multiply(order_tmp.fill_fees_pct/100).format(s.product.increment ? s.product.increment : '0.00000000')
						}
						if (api_order.currency_fees) {
							order_tmp.fee_asset = api_order.currency_fees
							order_tmp.position.fee_asset = api_order.currency_fees
						}
						order_tmp.remaining_size = n(order_tmp.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
						if (order_tmp.position.side == signal) {
							debug.msg('checkOrder - getOrder - ' + position_id + ' side == signal')
							order_tmp.position.value = n(order_tmp.position.value).add(api_order.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
							order_tmp.position.fee_open = n(order_tmp.position.fee_open).add(order_tmp.fill_fees).format(s.product.increment ? s.product.increment : '0.00000000')
//							order_tmp.position.value_open = n(order_tmp.position.value).subtract(so.use_fee_asset ? 0 : order_tmp.position.fee_open).format(s.product.increment ? s.product.increment : '0.00000000')
							order_tmp.position.value_open = order_tmp.position.value
							order_tmp.position.size = n(order_tmp.position.size).add(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
							order_tmp.position.initial_size = order_tmp.position.size
							//Il segnale è lo stesso della posizione: sto aprendo, quindi devo aggiornare il prezzo
							// Se il segnale fosse opposto, allora sto chiudendo la posizione, quindi il prezzo non cambia
							order_tmp.position.price_open = n(order_tmp.position.value).divide(order_tmp.position.size).format(s.product.increment)
						}
						else {
							debug.msg('checkOrder - getOrder - ' + position_id + ' side != signal')
							order_tmp.position.value = n(order_tmp.position.value).subtract(order_tmp.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
							order_tmp.position.fee_close = n(order_tmp.position.fee_close).add(order_tmp.fill_fees).format(s.product.increment ? s.product.increment : '0.00000000')
//							order_tmp.position.value_close = n(order_tmp.position.value_close).add(order_tmp.executed_value).subtract(so.use_fee_asset ? 0 : order_tmp.position.fee_close).format(s.product.increment ? s.product.increment : '0.00000000')
							order_tmp.position.value_close = n(order_tmp.position.value_close).add(order_tmp.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
							order_tmp.position.size = n(order_tmp.position.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
						}
						//Aggiorno il totale delle fee pagate
						s.total_fees = n(s.total_fees).add(order_tmp.fill_fees).format(s.product.increment ? s.product.increment : '0.00000000')
						
						debug.msg('checkOrder - getOrder - ' + position_id + ' (id ' + order_tmp.id + ' ; order_id ' + order_tmp.order_id + ') done')
						debug.msg('api_order.filled_size= ' + api_order.filled_size)
						debug.msg('order_tmp.filled_size= ' + order_tmp.filled_size + ' ; order_tmp.executed_value= ' + order_tmp.executed_value + ' ; order_tmp.remaining_size= ' + order_tmp.remaining_size + ' (' + typeof order_tmp.remaining_size + ')')
						debug.msg('order_tmp.position.value= ' + order_tmp.position.value + ' ; order_tmp.position.size= ' + order_tmp.position.size + ' ; order_tmp.fill_fees= ' + order_tmp.fill_fees)
						debug.printObject(order_tmp)				

						executeOrder(signal, sig_kind, position_id)

						return cb(null, true)
					})
				}
				//Ordine non eseguito
				else {
					//Ordine rifiutato
					if (order_tmp.order_status === 'rejected' && order_tmp.reject_reason === 'post only') {
						debug.msg('checkOrder - post-only (' + signal + ' ' + sig_kind + ' ' + position_id + ') failed, aborting')
						return cb(null, false)
					}
					if (order_tmp.order_status === 'rejected' && order_tmp.reject_reason === 'balance') {
						debug.msg('checkOrder - not enough balance for ' + signal + ' ' + sig_kind + ' ' + position_id + ', aborting')
						return cb(null, false)
					}
//					}			

					//Se non è un ordine fixed_price, eseguo il controllo sul prezzo
					if (!order_tmp.fixed_price) {
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
//									order_tmp.local_time = now()
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
//									order_tmp.local_time = now()
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
				}
			}
		})
	}

	function cancelOrder (signal, sig_kind, position_id, do_reorder, cb) {
//		debug.msg('cancelOrder')
		var order_tmp = s.orders.find(x => (x.signal === signal && x.kind === sig_kind && x.id === position_id))

		if (order_tmp.id != position_id) {
			debug.msg('cancelOrder - order_tmp.id <> position_id !!!!')
			debug.printObject(s.orders)
		}
		
		//websocket not filled
//		{ type: 'done',
//			  side: 'buy',
//			  order_id: 'a6276516-13ad-4a41-b6f5-017efa32760e',
//			  reason: 'canceled',
//			  product_id: 'BTC-USD',
//			  price: '3125.00000000',
//			  remaining_size: '0.08000000',
//			  sequence: 43174476,
//			  user_id: '5a2e34f7fa974100e2fd205a',
//			  profile_id: 'b82ca7f8-83b9-4687-ad68-d4e9d15e7b98',
//			  time: '2019-03-20T10:59:59.949000Z' }
		
		//websocket Partial fill
//		{ type: 'done',
//			  side: 'buy',
//			  order_id: '5b496f4e-96e3-424b-b8fe-aa5b4848d308',
//			  reason: 'canceled',
//			  product_id: 'BTC-USD',
//			  price: '3125.63000000',
//			  remaining_size: '0.07700000',
//			  sequence: 43174527,
//			  user_id: '5a2e34f7fa974100e2fd205a',
//			  profile_id: 'b82ca7f8-83b9-4687-ad68-d4e9d15e7b98',
//			  time: '2019-03-20T11:00:37.427000Z' }
		
		//getOrder dopo cancel e partial filled
//		{ id: '5b496f4e-96e3-424b-b8fe-aa5b4848d308',
//			  price: '3125.63000000',
//			  size: '0.08000000',
//			  product_id: 'BTC-USD',
//			  side: 'buy',
//			  type: 'limit',
//			  time_in_force: 'GTC',
//			  post_only: true,
//			  created_at: '2019-03-20T11:00:06.614431Z',
//			  done_at: '2019-03-20T11:00:37.427Z',
//			  done_reason: 'canceled',
//			  fill_fees: '0.0000000000000000',
//			  filled_size: '0.00300000',
//			  executed_value: '9.3768900000000000',
//			  status: 'done',
//			  settled: true }
		

		debug.msg('cancelOrder - ' + signal + ' ' + sig_kind + ' ' + position_id + ' - now() ' + now() + ' ; s.next_order ' + s.next_order)
		s.exchange.cancelOrder({order_id: order_tmp.order_id, product_id: s.product_id}, function () {
			function checkHold (do_reorder, cb) {
				s.exchange.getOrder({order_id: order_tmp.order_id, product_id: s.product_id}, true, function (err, api_order) {
					//Esiste l'ordine sull'exchange
					if (api_order) {
						s.api_order = api_order
						order_tmp.order_status = api_order.status

						if (api_order.status === 'done' || api_order.filled_size) {
//Perchè eseguo nuovamene getOrder? Non basta quello fatto sopra?							
							s.exchange.getOrder({order_id: order_tmp.order_id, product_id: s.product_id}, true, function (err, api_order) {
								order_tmp.time = new Date(api_order.done_at).getTime()
								order_tmp.price = api_order.price || order_tmp.price // Use actual price if possible. In market order the actual price (api_order.price) could be very different from trade price
								order_tmp.filled_size = api_order.filled_size
								order_tmp.executed_value = api_order.executed_value
								if (!so.use_fee_asset || api_order.fill_fees) {
									order_tmp.fill_fees = n(api_order.fill_fees).format(s.product.increment ? s.product.increment : '0.00000000')
								}
								else {
									order_tmp.fill_fees = n(api_order.executed_value).multiply(order_tmp.fill_fees_pct/100).format(s.product.increment ? s.product.increment : '0.00000000')
								}
								if (api_order.currency_fees) {
									order_tmp.fee_asset = api_order.currency_fees
									order_tmp.position.fee_asset = api_order.currency_fees
								}
								order_tmp.remaining_size = n(order_tmp.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
								if (order_tmp.position.side == signal) {
									debug.msg('cancelOrder - getOrder - ' + position_id + ' side == signal')
									order_tmp.position.value = n(order_tmp.position.value).add(order_tmp.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
									order_tmp.position.fee_open = n(order_tmp.position.fee_open).add(order_tmp.fill_fees).format(s.product.increment ? s.product.increment : '0.00000000')
//									order_tmp.position.value_open = n(order_tmp.position.value).subtract(so.use_fee_asset ? 0 : order_tmp.position.fee_open).format(s.product.increment ? s.product.increment : '0.00000000')
									order_tmp.position.value_open = order_tmp.position.value
									order_tmp.position.size = n(order_tmp.position.size).add(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
									order_tmp.position.initial_size = order_tmp.position.size
									//Il segnale è lo stesso della posizione: sto aprendo, quindi devo aggiornare il prezzo di apertura
									// Se il segnale fosse opposto, allora sto chiudendo la posizione, quindi il prezzo di apertura non cambia
									order_tmp.position.price_open = n(order_tmp.position.value).divide(order_tmp.position.size).format(s.product.increment)
								}
								else {
									debug.msg('cancelOrder - getOrder - ' + position_id + ' side != signal')
									order_tmp.position.value = n(order_tmp.position.value).subtract(order_tmp.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
									order_tmp.position.fee_close = n(order_tmp.position.fee_close).add(order_tmp.fill_fees).format(s.product.increment ? s.product.increment : '0.00000000')
//									order_tmp.position.value_close = n(order_tmp.position.value_close).add(order_tmp.executed_value).subtract(so.use_fee_asset ? 0 : order_tmp.position.fee_close).format(s.product.increment ? s.product.increment : '0.00000000')
									order_tmp.position.value_close = n(order_tmp.position.value_close).add(order_tmp.executed_value).format(s.product.increment ? s.product.increment : '0.00000000')
									order_tmp.position.size = n(order_tmp.position.size).subtract(api_order.filled_size).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
								}
								//Aggiorno il totale delle fee pagate
								s.total_fees = n(s.total_fees).add(order_tmp.fill_fees).format(s.product.increment ? s.product.increment : '0.00000000')
								
								debug.msg('cancelOrder - getOrder - ' + position_id + ' (id ' + order_tmp.id + ' ; order_id ' + order_tmp.order_id + ') cancel failed - order done or partially done')
								debug.msg('api_order.filled_size= ' + api_order.filled_size)
								debug.msg('order_tmp.filled_size= ' + order_tmp.filled_size + ' ; order_tmp.executed_value= ' + order_tmp.executed_value + ' ; order_tmp.remaining_size= ' + order_tmp.remaining_size)
								debug.msg('order_tmp.position.value= ' + order_tmp.position.value + ' ; order_tmp.position.size= ' + order_tmp.position.size + ' ; order_tmp.fill_fees= ' + order_tmp.fill_fees)
								debug.printObject(order_tmp)

								if (!do_reorder || isOrderTooSmall(s.product, order_tmp.remaining_size, order_tmp.price)) {
									debug.msg('cancelOrder - getOrder - ' + position_id + ' - not do_reorder || order done || remaining_size < minimo ordine possibile')							
									executeOrder(signal, sig_kind, position_id)
								}
								else {
									debug.msg('cancelOrder - getOrder ' + position_id + ' -> executeOrder parziale')
									executeOrder(signal, sig_kind, position_id, true)
								}
							})
						}
						else {
							debug.msg('cancelOrder - Ordine esistente su exchange, ma api_order.status= ' + api_order.status + ' e api_order.filled_size = ' + api_order.filled_size)
							if (!do_reorder) {
								debug.msg('cancelOrder - Non è un reorder, quindi unset flag della posizione')
								s.tools.positionFlags(order_tmp.position, 'status', 'Unset', sig_kind)
//								orderDelete(signal, sig_kind, position_id)
							}
						}
					}
					//L'ordine non esiste sull'exchange, quindi lo cancelliamo anche in locale
					else {
						debug.msg('cancelOrder - Ordine non esistente su exchange, questo if serve a qualcosa!!')
						s.tools.orderDelete(signal, sig_kind, position_id, function() {
							//Il syncBalance lo faccio appena fuori dall'else
//							syncBalance()
						})
					}

					//syncBalance serve per poter calcolare gli hold, non posso toglierlo
					syncBalance(function () {
						let order_value = n(order.size).multiply(order.price).add(order.expected_fee)
						if (!so.no_check_hold && (s.available_balance.currency_hold > 0 || s.available_balance.asset_hold > 0)) {
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
	}

	function executeOrder(signal, sig_kind, position_id, is_partial = false) {
		let order_tmp = s.orders.find(x => (x.signal === signal && x.kind === sig_kind && x.id === position_id))
		let is_closed = false
		s.check_too_small = false
		
//		let fee = 0
//		if (!so.order_type) {
//			so.order_type = 'maker'
//		}
//			
//		if (so.order_type === 'maker') {
//			if (s.exchange.makerFee)
//				fee = n(order_tmp.size).multiply(s.exchange.makerFee / 100).value()
//		}
//		if (so.order_type === 'taker') {
//			if (s.exchange.takerFee)
//				fee = n(order_tmp.size).multiply(s.exchange.takerFee / 100).value()
//		}		
		
		//Archivio il trade in s.my_trades
		let my_trade = JSON.parse(JSON.stringify(order_tmp))

		delete my_trade.position
		my_trade.position_id= my_trade.id
		my_trade.id = crypto.randomBytes(4).toString('hex')
		my_trade.execution_time= order_tmp.time - order_tmp.orig_time
		my_trade.slippage= (signal == 'buy' ? 1 : -1) * n(order_tmp.price).subtract(order_tmp.initial_price).divide(order_tmp.initial_price).value()
		my_trade.selector = so.selector.normalized
		my_trade.mode = so.mode
		
//		{
//		id: crypto.randomBytes(4).toString('hex'),
//		signal: orderSignal,
//		kind: orderKind,
//		time: null,
//		orig_time: null, //Tempo iniziale dell'ultimo trade della posizione
//		local_time: null, //Tempo locale iniziale dell'ultimo trade della posizione
//		initial_price: null, //Prezzo iniziale dell'ultimo trade della posizione
//		price: null, //Prezzo finale dell'ultimo trade della posizione
//		fixed_price: null,
//		fill_fees: 0,
//		fill_fees_pct: 0,
//		fee_asset: ___, //Fee asset
//		size: null, //Size iniziale dell'ordine
//		remaining_size: null, //Rimanenza del trade (serve per i riordini)
//		filled_size: 0, //Size commerciato del trade (variabile di servizio)
//		executed_value: 0, //Value commerciato del trade (variabile di servizio)
//		funds: 0,
//		order_type: is_taker ? 'taker' : so.order_type,
//		order_id: null,
//		order_status: null,
//		product_id: s.product_id,
//		post_only: conf.post_only,
//		cancel_after: (orderKind === 'standard' ? so.cancel_after : null), // s.cancel_after || 'day'
//		position_id: position_id,
//		execution_time: order_tmp.time - order_tmp.orig_time,
//		slippage: (signal == 'buy' ? 1 : -1) * n(order_tmp.price).subtract(order_tmp.initial_price).divide(order_tmp.initial_price).value()
//		selector: so.selector.normalized,
//		session_id: session.id, //Verrà aggiunto in fase di save nel db my_trades
//		mode: so.mode
//		}
				
		s.my_trades.push(my_trade)
		//Ho finito di archiviare il trade in my_trades
		
		updatePositions(order_tmp, function() {
			//La posizione esisteva già, quindi devo aggiornarla
			if (order_tmp.position.id != null) {
				var position_index = s.positions.findIndex(x => x.id === position_id)		

				if (order_tmp.position.size != 0 && !isOrderTooSmall(s.product, order_tmp.position.size, order_tmp.price)) {
					debug.msg('executeOrder - Posizione ' + position_id + ' parzialmente modificata. Size attuale ' + formatAsset(order_tmp.position.size, s.asset))
					order_tmp.position.time = order_tmp.time //Time ultima modifica della posizione		

//					var opts = {
//						position_id: position_id,
//					};

					//La funzione onPositionUpdated viene già chiamata all'interno di updatePositions
//					functionStrategies (s, 'onPositionUpdated', opts)
					
//					order_tmp.position.buy_stop = ((order_tmp.position.side == 'sell' && so.buy_stop_pct) ? n(order_tmp.position.price_open).multiply(1 + so.buy_stop_pct/100).format(s.product.increment) : null)
//					order_tmp.position.sell_stop = ((order_tmp.position.side == 'buy' && so.sell_stop_pct) ? n(order_tmp.position.price_open).multiply(1 - so.sell_stop_pct/100).format(s.product.increment) : null)

					debug.printObject(order_tmp.position)

					if (so.mode != 'sim')
						s.positionProcessingQueue.push({mode: 'update', position_id: position_id});
				} 
				//Se la posizione ha size nullo o comunque inferiore al minimo commerciabile
				else {
					is_closed = true

					//Preparo i dati della posizione chiusa da inserire nel db_my_closed_positions
					s.positions[position_index] = {
							id: order_tmp.position.id,
							selector: order_tmp.position.selector,
//							status: s.strategyFlag.free,
							opened_by: order_tmp.position.opened_by,
							closed_by: sig_kind,
							locked: order_tmp.locked,
							side: order_tmp.position.side,
							price_open: order_tmp.position.price_open, //Prezzo medio apertura posizione
//							price_close: n(order_tmp.position.value_open).subtract(order_tmp.position.value).divide(order_tmp.position.initial_size).format(s.product.increment), //Prezzo medio chiusura posizione
							price_close: n(order_tmp.position.value_close).divide(order_tmp.position.initial_size).format(s.product.increment), //Prezzo medio chiusura posizione
//							size: 0, //Valore asset attuale della posizione
							initial_size: order_tmp.position.initial_size, //Valore asset della posizione aperta
							accumulated_asset: order_tmp.position.accumulated_asset, //Valore asset accumulato
//							value: 0, //Valore currency attuale della posizione
							value_open: order_tmp.position.value_open, //Valore currency della posizione aperta
							value_close: order_tmp.position.value_close, 
							fee_open: order_tmp.position.fee_open, //Fee di apertura
							fee_close: order_tmp.position.fee_close, //Fee di chiusura
							fee_asset: order_tmp.position.fee_asset, //Fee asset
							time_open: order_tmp.position.time_open, //Time apertura della posizione
							time_close: order_tmp.time, //Time chiusura della posizione
							human_time_open: moment(order_tmp.position.time_open).format('YYYY-MM-DD HH:mm:ss'),
							human_time_close: moment(order_tmp.time).format('YYYY-MM-DD HH:mm:ss'),
//							sell_stop: null,
//							buy_stop: null,
							profit_gross_pct: order_tmp.position.profit_gross_pct,
							profit_net_pct: order_tmp.position.profit_net_pct,
//							profit_stop_limit: null,
//							profit_stop: null				
					}		

					//Inserisco la posizione chiusa del db delle posizioni chiuse
//					s.closed_positions.push(position)
					debug.printObject(s.positions[position_index])

					let position = s.positions[position_index]
					//Se non siamo in sim, cancello la posizione dal db delle posizioni aperte e la inserisco nel db delle posizioni chiuse (stessa funzione)
					if (so.mode != 'sim') {
						var opts = {
								mode: 'delete',
								position_id: position_id,
						};
						s.positionProcessingQueue.push(opts) //, function() {
//							s.tools.functionStrategies ('onPositionClosed', opts)
//						})
					}
					else {
						//Elimino la posizione da s.positions
						s.positions.splice(position_index,1)
						var opts = {
							position_id: position_id,
						};
						s.tools.functionStrategies ('onPositionClosed', opts)
					}
	
					debug.msg('executeOrder - Posizione ' + position_id + ' chiusa. Posizioni attuali: ' + s.positions.length)

					//Cancella anche tutti gli ordini connessi con la posizione, 
					//  quindi l'oggetto, non essendo più puntato da nulla, viene cancellato dalla memoria
					s.tools.orderStatus(undefined, undefined, undefined, position_id, 'Free')
				}
			}
			//La posizione non esisteva, quindi va inserita nell'array delle posizioni
			else {
				//Preparo la posizione e la archivio in s.positions
				let position = order_tmp.position
				position.id = position_id
				position.opened_by = sig_kind
//				position._id = position_id	
				position.time_open = order_tmp.time //Time apertura della posizione
				position.human_time_open = moment(order_tmp.time).format('YYYY-MM-DD HH:mm:ss')
				
				//Se la posizione aperta non è parziale e se è attivo il flag --accumulate, modifica di conseguenza il size della posizione aperta
				if (!is_partial && so.accumulate) {
					switch (position.side) {
					case 'buy': {
						position.accumulated_asset = n(position.size).multiply(so.buy_gain_pct/100).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
						position.size = n(position.size).subtract(position.accumulated_asset).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
						position.value = n(position.value).multiply(1 - so.buy_gain_pct/100).format(s.product.increment ? s.product.increment : '0.00000000')
						break
					}
					case 'sell': {
						position.accumulated_asset = n(position.size).multiply(so.sell_gain_pct/100).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
						position.size = n(position.size).add(position.accumulated_asset).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
						position.value = n(position.value).multiply(1 + so.sell_gain_pct/100).format(s.product.increment ? s.product.increment : '0.00000000')
						break
					}
					}
					position.initial_size = position.size
					position.value_open = position.value					
				}

				s.positions.push(position)

				var opts = {
					position_id: position_id,
				};
				s.tools.functionStrategies ('onPositionOpened', opts)
				
				debug.msg('executeOrder - posizione ' + position_id + ' aperta.')
				debug.printObject(s.positions[s.positions.length-1])

				if (so.mode != 'sim') 
					s.positionProcessingQueue.push({mode: 'update', position_id: position_id});
			}

			//Messaggio di ordine eseguito
			if (so.stats) {
				let order_complete = '\n**** ' + signal.toUpperCase() + (is_partial ? ' partial' : '') + ' (' + sig_kind + ') order completed at ' + moment(my_trade.time).format('YYYY-MM-DD HH:mm:ss') + ':\n\n'
				order_complete += formatAsset(my_trade.filled_size, s.asset, s.product.asset_increment) + ' at ' + formatCurrency(my_trade.price, s.currency) + '\n'
				order_complete += 'Total ' + formatCurrency(n(my_trade.executed_value).subtract(my_trade.fill_fees), s.currency) + '\n'
				order_complete += 'Fee ' + formatCurrency(my_trade.fill_fees, s.currency) + (order_tmp.position.fee_asset ? ' (fee asset)\n' : '\n')
				order_complete += n(my_trade.slippage).format('0.0000%') + ' slippage (orig. price ' + formatCurrency(my_trade.initial_price, s.currency) + ')\n'
				order_complete += 'Execution: ' + moment.duration(my_trade.execution_time).humanize() + '\n'
				order_complete += 'Positions: ' + s.positions.length
				order_complete += '\n\nPosition Id: ' + position.id //+ (is_partial ? ' (partial)' : '')
				if (is_closed) {					
					order_complete += '\nOriginal price: ' + formatCurrency(position.price_open, s.currency)
					order_complete += '\nPosition Size: ' + formatAsset(position.initial_size, s.asset, s.product.asset_increment)
					order_complete += '\nPosition initial value: ' + formatCurrency(position.value_open, s.currency)
					order_complete += '\nPosition close value: ' + formatCurrency(position.value_close, s.currency)
					order_complete += '\nPosition opening fee: ' + formatCurrency(position.fee_open, s.currency) + (so.use_fee_asset ? ' (fee asset)' : '')
					order_complete += '\nPosition closing fee: ' + formatCurrency(position.fee_close, s.currency) + (so.use_fee_asset ? ' (fee asset)' : '')
					order_complete += '\nGross profit: ' + n(position.profit_gross_pct/100).format('0.0000%')
					order_complete += '\nNet profit: ' + n(position.profit_net_pct/100).format('0.0000%')
					order_complete += (so.accumulate ? ('\nAccumulated asset: ' + formatAsset(position.accumulated_asset, s.asset, s.product.asset_increment)) : '')
					order_complete += '\nPosition span: ' + moment.duration(position.time_close - position.time_open).humanize()
				}
				console.log((order_complete).cyan)
				s.tools.pushMessage(s.exchange.name.toUpperCase(), order_complete, 5)
			}

			s['last_' + signal + '_price'] = my_trade.price;
			s['last_' + signal + '_time'] = my_trade.time;

			if (!is_partial) {
				s.action = (signal == 'buy' ? 'bought' : 'sold')

				//Cancello l'ordine che è stato eseguito
				s.tools.orderDelete(signal, sig_kind, position_id, function() {
					syncBalance()
				})

				s.eventBus.emit('orderExecuted', signal, sig_kind, position_id)
				var opts = {
					signal: signal,
					sig_kind: sig_kind,
					position_id: position_id,
					is_closed: is_closed,
				};
				s.tools.functionStrategies ('onOrderExecuted', opts)
			}
			else {
				s.action = (signal == 'buy' ? 'part buy' : 'part sell')
				syncBalance()
			}
		
			s.check_too_small = true
		})
	}

	function now() {
		return new Date().getTime()
	}

	function writeReport (is_progress, blink_off) {
//		debug.msg('writeReport')
		if ((so.mode === 'sim' || so.mode === 'train') && !so.verbose) {
			if (so.silent) return
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
		if (s.lookback[1]) {
			let diff = (s.period.close - s.lookback[1].close) / s.lookback[1].close
			process.stdout.write(s.tools.zeroFill(7, formatPercent(diff), ' ')[diff >= 0 ? 'green' : 'red'])
		}
		else {
			process.stdout.write(s.tools.zeroFill(7, '', ' '))
		}
		
		let volume_display = s.period.volume > 999 ? abbreviate(s.period.volume, 1) : n(s.period.volume).format('0.00')
		volume_display = s.tools.zeroFill(7, volume_display, ' ')
//		if (volume_display.indexOf('.') === -1) {
//			volume_display = ' ' + volume_display
//		}
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
//			process.stdout.write(' ' + bar)
			process.stdout.write(bar)
		}
		else {
			process.stdout.write(' '.repeat(11))
		}
		
		s.tools.functionStrategies ('onReport')
			
//		if (order_tmp = s.tools.orderExist('buy')) {
//			process.stdout.write(s.tools.zeroFill(12, 'B ' + order_tmp.kind, ' ').green)
//		}
//		else if (order_tmp = s.tools.orderExist('sell')) {
//			process.stdout.write(s.tools.zeroFill(12, 'S ' + order_tmp.kind, ' ').red)
//		}
//		else 
		
		if (s.action) {
			process.stdout.write(s.tools.zeroFill(12, s.action, ' ')[(s.action === 'bought' || s.action === 'part buy') ? 'green' : 'red'])
		}
		else if (s.signal) {
			process.stdout.write(s.tools.zeroFill(12, s.signal, ' ')['white'])
			s.signal = null
		}
		else {
			process.stdout.write(s.tools.zeroFill(12, '', ' '))
		}

		//Ho inzializzato i valori dentro getNext() di quantum-trade.js
		//		let orig_capital_currency = s.orig_capital_currency || s.start_capital_currency
		//		let orig_price = s.orig_price || s.start_price

		//Ma esiste sicuro!!! A che serve l'if??? A meno che a questo punto non sia ancora stato chiamato syncBalance
		// che serve a creare il primo s.start_capital_currency
		//		if (orig_capital_currency) {
		if (s.orig_capital_currency) {
			let asset_col = n(s.balance.asset).format(s.product.asset_increment ? s.product.asset_increment : (s.asset === 'BTC' ? '0.00000' : '0.00000000'))
			if (s.available_balance && s.balance.asset != s.available_balance.asset) {
				asset_col += '(' + n(s.available_balance.asset).format(s.product.asset_increment ? s.product.asset_increment : (s.asset === 'BTC' ? '0.00000' : '0.00000000')) + ')'
			}
			asset_col += ' ' + s.asset
//			process.stdout.write(s.tools.zeroFill((asset_col.length + 1), asset_col, ' ').white)
			process.stdout.write(' ' + asset_col.white)
						
			let currency_col = n(s.balance.currency).format(s.product.increment ? s.product.increment : '0.00000000')
			if (s.available_balance && s.balance.currency != s.available_balance.currency) {
				currency_col += '(' + n(s.available_balance.currency).format(s.product.increment ? s.product.increment : '0.00000000') + ')'
			}
			currency_col += ' ' + s.currency
//			process.stdout.write(s.tools.zeroFill((currency_col.length + 1), currency_col, ' ').green)
			process.stdout.write(' ' + currency_col.green)
			
//			//Profitto sul capitale iniziale
//			let consolidated = n(s.balance.currency).add(n(s.balance.asset).multiply(s.period.close))
//			let profit = n(consolidated).divide(s.orig_capital_currency).subtract(1).value()
//			process.stdout.write(s.tools.zeroFill(7, formatPercent(profit), ' ')[profit >= 0 ? 'green' : 'red'])
//			
//			//Profitto sul buy&hold
//			let buy_hold = n(s.orig_capital_currency).divide(s.orig_price).multiply(s.period.close)
//			let over_buy_hold_pct = n(consolidated).divide(buy_hold).subtract(1).value()
//			process.stdout.write(s.tools.zeroFill(7, formatPercent(over_buy_hold_pct), ' ')[over_buy_hold_pct >= 0 ? 'green' : 'red'])
		}		
		
		if (!is_progress) {
			process.stdout.write('\n')
		}
	}

	//withOnPeriod viene chiamato per ogni trade. I trade vengono scaricati ogni period_length minuti.
	function withOnPeriod (trade) {
//		debug.msg('withOnPeriod')
		if (!clock && so.mode !== 'live' && so.mode !== 'paper') {
			clock = lolex.install({ shouldAdvanceTime: false, now: trade.time })
		}

		//Aggiorna il period 
		updatePeriod(trade)

		if (!s.in_preroll) {
			//Fa eseguire i calcoli alle strategie (chiamata a onTrade) 
			var opts= {
					trade: trade,
			}
			s.tools.functionStrategies ('onTrade', opts)

			//Aggiorna i valori variabili di tutte le posizioni aperte (compresi i valori dei trailing stop)
			updatePositions(trade, function() {

				if (so.mode !== 'live') {
					s.exchange.processTrade(trade)
				}

				if (!so.manual) {
					if (clock) {
						var diff = trade.time - now()

						// Allow some catch-up if trades are too far apart. Don't want all calls happening at the same time
						while (diff > 5000) {
							clock.tick(5000)
							diff -= 5000
						}
						clock.tick(diff)
					}
				}
			})
		}
	}

//	function queueTrade(trade, is_preroll) {
//		if (s.exchange.debug_exchange) {
//			debug.obj('queueTrade:', trade)
//		}
//		tradeProcessingQueue.push({trade, is_preroll})
//		if (s.exchange.debug_exchange) {
//			let tmp = tradeProcessingQueue.workersList()
//			let tmp2 = tradeProcessingQueue.running()
//			let tmp3 = tradeProcessingQueue.length()
//			debug.obj('queueTrade - tradeProcessingQueue.length: ', tmp3)
//			debug.msg('queueTrade - tradeProcessingQueue.running: ', tmp2)
//			debug.obj('queueTrade - tradeProcessingQueue.workersList: ', tmp)
//		}
//	}

	//onTrade viene eseguito per ogni trade. I trade vengono scaricati ogni period_length minuti.
	function onTrade(trade, is_preroll, cb) {
		if (s.exchange.debug_exchange) {
			debug.obj('onTrade', trade)
		}

//		//Aggiorna i valori variabili di tutte le posizioni aperte (compresi i valori dei trailing stop)
//		updatePositions(trade)

		// Se ci dovessero essere problemi di sincronia con gli ordini scaricati dall'exchange, il codice seguente li fa scorrere fino all'ordine giusto.
		if (s.period && trade.time < s.period.time) {
			debug.msg('onTrade - Faccio scorrere gli ordini')
			debug.obj('trade.time= ' + trade.time + ' ; s.period.time= ' + s.period.time, trade, false)
			s.tools.pushMessage('onTrade', 'Faccio scorrere gli ordini', 9)
			s.exchange.debug_exchange = true
			//s.exchange.resetPublicClient(s.product_id)
			return cb()
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

//		withOnPeriod(trade)
		
		//Se il trade è fuori dal period, allora faccio eseguire onTradePeriod alle strategie
		if (trade.time > s.period.close_time) {
			//Aggiungi il periodo a s.lookback
			s.lookback.unshift(s.period)
			s.lookback[0].strategy = {}

			var opts = {
				trade: trade,
			};
			s.tools.functionStrategies ('onTradePeriod', opts, function(result, strategy_name) {
				s.action = null

				//Se abbiamo superato calc_close_time, aggiungi il periodo a so.strategy[strategy_name].calc_lookback
				// e, se esiste nella strategia, esegui onStrategyPeriod.
				if (so.strategy[strategy_name].opts.period_calc && (trade.time > so.strategy[strategy_name].calc_close_time)) {
					so.strategy[strategy_name].calc_lookback.unshift(s.period)
					if (typeof so.strategy[strategy_name].lib.onStrategyPeriod === 'function') {
						so.strategy[strategy_name].lib['onStrategyPeriod'](s)
					}
				}
				
				// Se non siamo in sim, ripulisce so.strategy[strategy_name].calc_lookback a un max di valori
				if (so.mode !== 'sim' && so.strategy[strategy_name].opts.min_periods && (so.strategy[strategy_name].calc_lookback.length > so.strategy[strategy_name].opts.min_periods)) {
					so.strategy[strategy_name].calc_lookback.splice(so.strategy[strategy_name].opts.min_periods, (so.strategy[strategy_name].calc_lookback.length - so.strategy[strategy_name].opts.min_periods))
//					debug.msg('onTrade - so.strategy[strategy_name].calc_lookback ridotto a ' + so.strategy[strategy_name].calc_lookback.length)
				}

				//Completa il periodo in s.lookback con i valori calcolati dalla strategia 
				//  e, se non siamo in sim, ripulisce s.lookback a un max di valori
				s.lookback[0].strategy[strategy_name] = {
					data: so.strategy[strategy_name].data
				}
			}, function() {	
				//Stampa a schermo i dati
				writeReport()
			
				if (so.mode !== 'sim' && s.lookback.length > so.min_periods) {
					s.lookback.splice(so.min_periods, (s.lookback.length - so.min_periods))
//					debug.msg('onTrade - s.lookback ridotto a ' + s.lookback.length)
				}

				initBuffer(trade)
			}) 
		}
		
		withOnPeriod(trade)
		
		cb()
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
//			queueTrade(trade, is_preroll)
			tradeProcessingQueue.push({trade, is_preroll})
		}
		if(_.isFunction(cb)) {
			cb()
		}
	}

	s.wait_updatePositions = false
	
	function updatePositions(trade, cb) {
		if (!s.wait_updatePositions) {
			s.wait_updatePositions = true

			s.positions.forEach(function (position, index, array) {
				//Controllo minima quantità
				if (s.check_too_small && isOrderTooSmall(s.product, position.size, position.price_open)) {
					console.log(('\nMinimum size not reached - Position ' + position.id + ' size= ' + position.size + ' < minimum size (' + s.product.min_size + '). Position cleared').red)
//					orderDelete(undefined, undefined, position.id, function() {
					s.tools.positionFlags(position, 'status', 'Free', undefined, function() {
						//Se siamo in sim, non dobbiamo operare sui database
						//Cancello la posizione dal db delle posizioni aperte e inserisco la posizione chiusa del db delle posizioni chiuse
						if (so.mode != 'sim') {
							s.positionProcessingQueue.push({mode: 'delete', position_id: position.id})
						}
						else {
							//Elimino la posizione da s.positions
							s.positions.splice(index,1)
						}
					})				
				}		

				//Aggiorno il profitto della posizione
				position.profit_gross_pct = (position.side == 'buy' ? +100 : -100) * n(trade.price).subtract(position.price_open).divide(position.price_open).value()

				let price_close_tmp = n(trade.price).divide(100).multiply(position.side == 'buy' ? (100 - s.exchange.makerFee) : (100 + s.exchange.makerFee))
//				let price_open_tmp = n(position.value_open).divide(position.initial_size)
				position.profit_net_pct = (position.side == 'buy' ? +100 : -100) * n(price_close_tmp).subtract(position.price_open).divide(position.price_open).value()

				//Chiamata alla funzione onPositionUpdated per tutte le strategie
				var opts = {
					position_id: position.id,
					trade: trade,
				};
				s.tools.functionStrategies ('onPositionUpdated', opts) //, callbackStrategy = function() {}, callbackFinal = function() {})
			})
					
			s.wait_updatePositions = false
			cb()
		}
		else {
			debug.msg('updatePositions - Attendo... ')
			setTimeout (function() { updatePositions(trade, cb) }, 100)
//			waitCondition('wait_updatePositions', 100, cb)
		}
	}

	function updateMessage() {
		syncBalance(function(err) {
			if (err) {
				debug.msg('updateMessage - syncBalance err: ' + err)
			}
			
			var output_lines = '';
			output_lines += '\nPosition mode: ' + (so.active_long_position? 'Long ' : '') + (so.active_short_position ? 'Short ' : '')
			output_lines += '\nBalance ' + formatCurrency(s.balance.currency, s.currency) + ' - ' + formatAsset(s.balance.asset, s.asset, s.product.asset_increment)
			output_lines += '\nCapital in currency ' + formatCurrency(s.currency_capital, s.currency)
			output_lines += '\nCapital in asset ' + formatCurrency(s.asset_capital, s.asset)
			output_lines += '\n' + s.my_trades.length + ' trades over ' + s.day_count + ' days (' + n(s.my_trades.length / s.day_count).format('0.00') + ' trades/day)'
			output_lines += '\n' + s.positions.length + ' positions opened'
			s.tools.functionStrategies ('onUpdateMessage', null, function(result) {
				if (!result) {
					return
				}
//				debug.msg('updateMessage - strategy result: ' + result)
				output_lines += '\n' + result
			}, function() {
				s.tools.pushMessage('Status', output_lines, 0)
			})			
		})
	}
	
	return {
		writeHeader: function () {
			process.stdout.write([
				s.tools.zeroFill(19, 'DATE', ' ').grey,
				s.tools.zeroFill(17, 'PRICE', ' ').grey,
				s.tools.zeroFill(9, 'DIFF', ' ').grey,
				s.tools.zeroFill(10, 'VOL', ' ').grey,
				s.tools.zeroFill(8, 'RSI', ' ').grey,
				s.tools.zeroFill(32, 'ACTIONS', ' ').grey,
				s.tools.zeroFill(25, 'BAL', ' ').grey,
				s.tools.zeroFill(22, 'PROFIT', ' ').grey
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
//		emitSignal: emitSignal,
	}
}
