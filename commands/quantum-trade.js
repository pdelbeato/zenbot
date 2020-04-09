var tb = require('timebucket')
, minimist = require('minimist')
, n = require('numbro')
, fs = require('fs')
, path = require('path')
, spawn = require('child_process').spawn
, moment = require('moment')
, crypto = require('crypto')
, readline = require('readline')
, colors = require('colors')
, output = require('../lib/output')
, objectifySelector = require('../lib/objectify-selector')
, engineFactory = require('../lib/quantum-engine')
//, collectionService = require('../lib/services/collection-service')
, { formatAsset, formatPercent, formatCurrency } = require('../lib/format')
, debug = require('../lib/debug')
, sizeof = require('object-sizeof')
, async = require('async')
, quantumTools = require ('../lib/quantum-tools')

//Per eseguire comandi da bash
//var exec = require('child_process').exec

//function puts(error, stdout, stderr) { console.log(stdout) }
//function puts(error, stdout) { console.log(stdout) }

//Cambia i colori di cliff
//styles: {                 // Styles applied to stdout
//all:     'cyan',      // Overall style applied to everything
//label:   'underline', // Inspection labels, like 'array' in `array: [1, 2, 3]`
//other:   'inverted',  // Objects which don't have a literal representation, such as functions
//key:     'bold',      // The keys in object literals, like 'a' in `{a: 1}`
//special: 'grey',      // null, undefined...
//string:  'green',
//number:  'magenta',
//bool:    'blue',      // true false
//regexp:  'green',     // /\d+/
//},

//pretty: true,             // Indent object literals
//hideFunctions: false,     // Don't output functions at all
//stream: process.stdout,   // Stream to write to, or null
//maxLength: 2048           // Truncate output if longer

module.exports = function (program, conf) {
	program
	.command('quantum-trade [selector]')
	.allowUnknownOption()
	.description('run trading bot against live market data with Quantum feature')
	.option('--conf <path>', 'path to optional conf overrides file')
	.option('--order_type <type>', 'order type to use (maker/taker)', /^(maker|taker)$/i, conf.order_type)
	.option('--paper', 'use paper trading mode (no real trades will take place)', Boolean, false)
	.option('--manual', 'watch price and account balance, but do not perform trades automatically', Boolean, false)
	.option('--non_interactive', 'disable keyboard inputs to the bot', Boolean, false)
	.option('--filename <filename>', 'filename for the result output (ex: result.html). "none" to disable', String, conf.filename)
	.option('--currency_capital <amount>', 'for paper trading, amount of start capital in currency. For live trading, amount of new starting capital in currency.', Number, conf.currency_capital)
	.option('--asset_capital <amount>', 'for paper trading, amount of start capital in asset', Number, conf.asset_capital)
	.option('--avg_slippage_pct <pct>', 'avg. amount of slippage to apply to paper trades', Number, conf.avg_slippage_pct)
//	.option('--quantum_value <amount>', 'buy up to this amount of currency every time', Number, conf.quantum_value)
//	.option('--max_positions <amount>', 'maximum number of opened positions', Number, conf.max_positions)
	.option('--best_bid', 'mark up as little as possible the buy price to be the best bid', Boolean, false)
	.option('--best_ask', 'mark down as little as possible the sell price to be the best ask', Boolean, false)
//	.option('--markdown_buy_pct <pct>', '% to mark down buy price', Number, conf.markdown_buy_pct)
//	.option('--markup_sell_pct <pct>', '% to mark up sell price', Number, conf.markup_sell_pct)
//	.option('--order_adjust_time <ms>', 'adjust bid/ask on this interval to keep orders competitive', Number, conf.order_adjust_time)
//	.option('--order_poll_time <ms>', 'poll order status on this interval', Number, conf.order_poll_time)
//	.option('--sell_gain_pct <pct>', 'sell with this gain (min profit in long positions))', conf.sell_gain_pct)
//	.option('--buy_gain_pct <pct>', 'buy with this gain (min profit in short positions)', conf.buy_gain_pct)
//	.option('--accumulate', 'accumulate asset (buy/sell_gain_pct)', Boolean, false)
//	.option('--max_slippage_pct <pct>', 'avoid selling at a slippage pct above this float', conf.max_slippage_pct)
//	.option('--rsi_periods <periods>', 'number of periods to calculate RSI at', Number, conf.rsi_periods)
//	.option('--poll_trades <ms>', 'poll new trades at this interval in ms', Number, conf.poll_trades)
	.option('--currency_increment <amount>', 'Currency increment, if different than the asset increment', String, null)
//	.option('--keep_lookback_periods <amount>', 'Keep this many lookback periods max. ', Number, conf.keep_lookback_periods)
	.option('--disable_stats', 'disable printing order stats')
	.option('--reset', 'reset previous positions and start new profit calculation from 0')
//	.option('--use_fee_asset', 'Using separated asset to pay for fees. Such as binance\'s BNB or Huobi\'s HT', Boolean)
//	.option('--run_for <minutes>', 'Execute for a period of minutes then exit with status 0', String, conf.run_for)
//	.option('--update_msg <hours>', 'Send an update message every <hours>', String, conf.update_msg)
	.option('--debug', 'output detailed debug info')
	.option('--minimal_db', 'do not create trades and periods databases', Boolean, false)
	.option('--no_first_message', 'no first update message', Boolean, false)
//	.option('--no_check_hold', 'no check for funds on hold', Boolean)
	.action(function (selector, cmd) {
		//Con le righe seguenti, dovrei mettere in s.options tutte le opzioni passate da riga di comando, niente di più.
		var raw_opts = minimist(process.argv)
		var s = {options: JSON.parse(JSON.stringify(raw_opts))}
		var so = s.options

		s.positions = []
//		s.closed_positions = []
		s.my_trades = []
//		s.trades = []
		s.lookback = []
		s.orders = []
		
		s.wait_updatePositions = false

		//Carico le funzioni di utilità
		quantumTools(s, conf)

		var engine = null

//		//Se è stata impostata la funzione per il tempo di esecuzione, fissa il tempo di partenza
//		if (so.run_for) {
//		debug.msg('Run_for option = ', so.run_for)
//		var botStartTime = moment().add(so.run_for, 'm')
//		}

		//Dovrebbe cancellare tutte le opzioni passate a riga di comando senza denominazione
		// (minimist mette queste opzioni dentro un array chiamato _)
		delete so._

		//Prendo il file puntato da --conf e registro tutte le opzioni in esso contenute dentro so.
		// cmd.conf dovrebbe essere il file passato con --conf
		if (cmd.conf) {
			var overrides = require(path.resolve(process.cwd(), cmd.conf))
			Object.keys(overrides).forEach(function (k) {
				//console.log('overrides k=' + k + ' - ' + overrides[k])
				so[k] = overrides[k]
			})
		}

		// Registra in s.options tutte le opzioni passate a riga di comando, sovrascrivendo conf (ovvero le opzioni passate a quantum-trade da zenbot.js
		//   durante la chiamata, quindi zenbot.conf, ovvero l'unione delle opzioni del conf_file, conf.js e conf-sample.js)
		Object.keys(conf).forEach(function (k) {
			if (typeof cmd[k] !== 'undefined') {
				//console.log('cmd k=' + k + ' - ' + cmd[k])
				so[k] = cmd[k]
			}
		})

		//Provare a togliere queste righe///
		//Punto controverso. A quanto sembra, tutte le opzioni passate in command line sono messe in so=s.options (riga 83-85).
		// Dopodiché, vengono sovrascritte dal file --conf (riga 99-104).
		//Quindi vengono prese tutte le opzioni passate a quantum-trade (quindi zenbot.conf da zenbot.js, quindi l'unione di
		// conf_file, conf.js e conf-sample.js) e vengono reinserite in so.
		// Infine, con le righe seguenti, alcune opzioni di so vengono nuovamente riscritte dalle opzioni passate in riga di comando.
//		so.currency_increment = cmd.currency_increment
//		so.keep_lookback_periods = cmd.keep_lookback_periods
		//so.use_prev_trades = (cmd.use_prev_trades||conf.use_prev_trades)
		//so.min_prev_trades = cmd.min_prev_trades
//		so.debug = cmd.debug
		so.stats = !cmd.disable_stats
		so.mode = so.paper ? 'paper' : 'live';

		if (so.update_msg) {
			var nextUpdateMsg = moment().startOf('day').add(8, 'h')

			while (nextUpdateMsg < moment()) {
				nextUpdateMsg = nextUpdateMsg.add(so.update_msg, 'h')
			}

			if (!so.no_first_message) {
				nextUpdateMsg = nextUpdateMsg.subtract(so.update_msg, 'h')
			}
		}

		var nextSessionSave = moment().startOf('day')
		
		var nextCompactDatabase = moment().startOf('day').add(2, 'd')
		
//		E' sbagliato!!! 
//		if (!so.min_periods) {
//		so.min_periods = 1
//		Object.keys(s.options.strategy).forEach(function (strategy_name, index, array) {			
//		if (so.strategy[strategy_name].opts.min_periods) {
//		so.min_periods = Math.max(so.strategy[strategy_name].opts.min_periods, so.min_periods)
//		}
//		})
////		debug.msg('quantum-trade - so.min_periods= ' + so.min_periods)
//		}

		so.selector = objectifySelector(selector || conf.selector)

		var order_types = ['maker', 'taker']
		if (!order_types.includes(so.order_type)) {
			so.order_type = 'maker'
		}

		var db_cursor, trade_cursor
		var query_start = tb().resize(so.period_length).subtract(so.min_periods * 2).toMilliseconds()
		var days = Math.ceil((new Date().getTime() - query_start) / 86400000)
		var session = null

		var lookback_size = 0
		var my_trades_size = 0

		//Recupera tutti i vecchi database
		var db_my_trades = conf.db.my_trades
		var db_my_positions = conf.db.my_positions
		var db_my_closed_positions = conf.db.my_closed_positions
		s.db_periods = conf.db.periods
		var db_sessions = conf.db.sessions
		var db_resume_markers = conf.db.resume_markers
		var db_trades = conf.db.trades

//		s.db_valid = true

		var marker = {
			id: crypto.randomBytes(4).toString('hex'),
			selector: so.selector.normalized,
			from: null,
			to: null,
			oldest_time: null
		}
		marker._id = marker.id

		var promises = []
		//Se richiesto nel comando, esegue il reset dei database
		if (cmd.reset) {
			console.log('\nDeleting my_positions, my_closed_positions, my_trades and sessions collections...')
			let reset_db_my_positions = new Promise(function (resolve, reject) {
				db_my_positions.drop(function(err, results) {
					if (err) {
						reject(err)
					}
					console.log('\tCollection my_positions deleted!')
					db_my_positions = conf.db.datastore.collection('my_positions')
					resolve()
				})
			})
			let reset_db_my_closed_positions = new Promise(function (resolve, reject) {
				db_my_closed_positions.drop(function(err, results) {
					if (err) {
						reject(err)
					}
					console.log('\tCollection my_closed_positions deleted!')
					db_my_closed_positions = conf.db.datastore.collection('my_closed_positions')
					resolve()
				})
			})
			let reset_db_my_trades = new Promise(function (resolve, reject) {
				db_my_trades.drop(function(err, results) {
					if (err) {
						reject(err)
					}
					console.log('\tCollection my_trades deleted!')
					db_my_trades = conf.db.datastore.collection('my_trades')
					resolve()
				})
			})
			let reset_db_sessions = new Promise(function (resolve, reject) {
				db_sessions.drop(function(err, results) {
					if (err) {
						reject(err)
					}
					console.log('\tCollection sessions deleted!')
					db_sessions = conf.db.datastore.collection('sessions')
					resolve()
				})
			})
			promises = [reset_db_my_positions, reset_db_my_closed_positions, reset_db_my_trades, reset_db_sessions]
		}
//		Da sistemare: non ha senso usare s. per memorizzare queste informazioni. Le posso recuperare direttamente dal db
		//Altrimenti, recupera tutte le vecchie posizioni (aperte e chiuse) e le copia in s.positions e s.closed_positions
		else {		
			let recover_my_positions = new Promise(function (resolve, reject) {
				db_my_positions.find({selector: so.selector.normalized}).toArray(function (err, my_prev_positions) {
					if (err) {
						reject(err)
					}
					if (my_prev_positions && my_prev_positions.length) {
						my_prev_positions.forEach(function (position) {
							position.status = 0
						})
						s.positions = my_prev_positions.slice(0)
						console.log('Recuperate le vecchie posizioni aperte: ' + s.positions.length)
					}
					resolve()
				})
			})

			//Recupera tutte le vecchie posizioni chiuse e le copia in s.closed_positions
//			let recover_my_closed_positions = new Promise(function (resolve, reject) {
//				db_my_closed_positions.find({selector: so.selector.normalized}).toArray(function (err, my_closed_positions) {
//					if (err) {
//						reject(err)
//					}
//					if (my_closed_positions.length) {
//						s.closed_positions = my_closed_positions.slice(0)
//						console.log('Recuperate le vecchie posizioni chiuse: ' + s.closed_positions.length)
//					}
//					resolve()
//				})
//			})
			
			//Conta le vecchie posizioni chiuse
			let count_my_closed_positions = new Promise(function (resolve, reject) {
				db_my_closed_positions.count({}, function (err, count) {
					if (err) {
						reject(err)
					}
					console.log('Numero di posizioni chiuse: ' + count)
					resolve()
				})
			})
			
			//Recupera tutti i vecchi trade e li copia in s.my_trades
			let recover_my_trades = new Promise(function (resolve, reject) {
				db_my_trades.find({selector: so.selector.normalized}).toArray(function (err, my_prev_trades) {
					if (err) {
						reject(err)
					}
					if (my_prev_trades && my_prev_trades.length) {
						s.my_trades = my_prev_trades.slice(0)
						my_trades_size = s.my_trades.length
						console.log('Recuperati i vecchi trade: ' + s.my_trades.length)
					}
					resolve()
				})
			})
			promises = [recover_my_positions, count_my_closed_positions, recover_my_trades]
		}

		//Una volta effettuate le operazioni sui db, proseguo con il resto
		Promise.all(promises)
		.then(function() {
			//Quindi engine è quantum-engine(s, conf), dove conf è zenbot.conf da zenbot.js, quindi l'unione
			// di conf_file, conf.js e conf-sample.js e NON s.options
			engine = engineFactory(s, conf)

			var modeCommand = 0
			const modeMap = new Map()
			modeMap.set(0, 'NULL')
			modeMap.set(1, 'MARKET')
//			modeMap.set(2, 'CATCH')
			modeMap.set(3, 'EXCHANGE')
			modeMap.set(4, 'POSITIONS')
			modeMap.set(5, 'STRATEGIES')
			modeMap.set(6, 'OPTIONS')
			modeMap.set(7, 'DEBUG TOOLS')

			const keyMap = new Map()
			s.exchange_orders = []
			s.exchange_orders_index = null
			s.positions_index = null

			function changeModeCommand(mode = 0) {
//				debug.msg('changeModeCommand')
				modeCommand = mode

				keyMap.clear()

				keyMap.set('0', {desc: ('Modo '.grey + 'NULL'.yellow),			action: function() { changeModeCommand(0)}})
				keyMap.set('1', {desc: ('Modo '.grey + 'MARKET'.yellow),		action: function() { changeModeCommand(1)}})
//				keyMap.set('2', {desc: ('Modo '.grey + 'CATCH'.yellow), 		action: function() { changeModeCommand(2)}})
				keyMap.set('3', {desc: ('Modo '.grey + 'EXCHANGE'.yellow), 		action:	function() { changeModeCommand(3)}})
				keyMap.set('4', {desc: ('Modo '.grey + 'POSITIONS'.yellow),		action:	function() { changeModeCommand(4)}})
				keyMap.set('5', {desc: ('Modo '.grey + 'STRATEGIES'.yellow),	action: function() { changeModeCommand(5)}})
				keyMap.set('6', {desc: ('Modo '.grey + 'OPTIONS'.yellow), 		action: function() { changeModeCommand(6)}})
				keyMap.set('7', {desc: ('Modo '.grey + 'DEBUG TOOLS'.yellow), 	action: function() { changeModeCommand(7)}})

				keyMap.set('l', {desc: ('list available commands'.grey), 	action: function() { listKeys()}})

				keyMap.set('m', {desc: ('toggle MANUAL trade in LIVE mode ON / OFF'.grey), action: function() {
					if (so.mode === 'live') {
						so.manual = !so.manual
						console.log('\nMANUAL trade in LIVE mode: ' + (so.manual ? 'ON'.green.inverse : 'OFF'.red.inverse))
					}
				}})
				keyMap.set('x', {desc: ('print statistical output'.grey), action: function() { printTrade(false)}})
				keyMap.set('P', {desc: ('list positions opened'.grey), action: function() {
					debug.obj('\nListing positions opened...'.grey, s.positions, false, true)
				}})
				keyMap.set('O', {desc: ('list orders opened'.grey), action: function() {
					debug.obj('\nListing orders opened...'.grey, s.orders, false, true)
				}})
				keyMap.set('Q', {desc: ('exit program with statistical output'.grey), action: function() {
					console.log('\nExiting... ' + '\nCanceling ALL orders...'.grey)
					so.manual = true
					s.tools.orderStatus(undefined, undefined, undefined, undefined, 'Free')
					exit()
				}})

				switch (mode) {
				case 0: {
					break
				}
				case 1: {
					//Modo MARKET
					keyMap.set('b', {desc: ('limit'.grey + ' BUY'.green), action: function() {
						console.log('\nmanual'.grey + ' limit ' + 'BUY'.green + ' command inserted'.grey)
						let protectionFree = s.protectionFlag['calmdown'] + s.protectionFlag['long_short']
						s.eventBus.emit('manual', 'buy', null, null, null, protectionFree)
					}})
					keyMap.set('B', {desc: ('market'.grey + ' BUY'.green), action: function() {
						console.log('\nmanual'.grey + ' market ' + 'BUY'.green + ' command inserted'.grey)
						let protectionFree = s.protectionFlag['calmdown'] + s.protectionFlag['long_short']
						s.eventBus.emit('manual', 'buy', null, null, null, protectionFree, 'manual', false, true)
					}})
					keyMap.set('s', {desc: ('limit'.grey + ' SELL'.red), action: function() {
						console.log('\nmanual'.grey + ' limit ' + 'SELL'.red + ' command inserted'.grey)
						let protectionFree = s.protectionFlag['calmdown'] + s.protectionFlag['long_short']
						s.eventBus.emit('manual', 'sell', null, null, null, protectionFree)
					}})
					keyMap.set('S', {desc: ('market'.grey + ' SELL'.red), action: function() {
						console.log('\nmanual'.grey + ' market ' + 'SELL'.red + ' command inserted'.grey)
						let protectionFree = s.protectionFlag['calmdown'] + s.protectionFlag['long_short']
						s.eventBus.emit('manual', 'sell', null, null, null, protectionFree, 'manual', false, true)
					}})
					keyMap.set('+', {desc: ('Buy gain pct (short position)'.grey + ' INCREASE'.green), action: function() {
						so.buy_gain_pct = Number((so.buy_gain_pct + 0.5).toFixed(2))
						console.log('\n' + 'Buy gain pct ' + 'INCREASE'.green + ' -> ' + so.buy_gain_pct)
					}})
					keyMap.set('-', {desc: ('Buy gain pct (short position)'.grey + ' DECREASE'.red), action: function() {
						so.buy_gain_pct = Number((so.buy_gain_pct - 0.5).toFixed(2))
						console.log('\n' + 'Buy gain pct ' + 'DECREASE'.red + ' -> ' + so.buy_gain_pct)
					}})
					keyMap.set('*', {desc: ('Sell gain pct (long position)'.grey + ' INCREASE'.green), action: function() {
						so.sell_gain_pct = Number((so.sell_gain_pct + 0.5).toFixed(2))
						console.log('\n' + 'Sell gain pct ' + 'INCREASE'.green + ' -> ' + so.sell_gain_pct)
					}})
					keyMap.set('_', {desc: ('Sell gain pct (long position)'.grey + ' DECREASE'.red), action: function() {
						so.sell_gain_pct = Number((so.sell_gain_pct - 0.5).toFixed(2))
						console.log('\n' + 'Sell gain pct ' + 'DECREASE'.red + ' -> ' + so.sell_gain_pct)
					}})
					keyMap.set('c', {desc: ('cancel manual orders'.grey), action: function() {
						s.tools.orderStatus(undefined, undefined, 'manual', undefined, 'Unset', 'manual')
						console.log('\nmanual'.grey + ' orders cancel' + ' command executed'.grey)
					}})
					keyMap.set('C', {desc: ('cancel ALL order'.grey), action: function() {
						console.log('\nmanual'.grey + ' canceling ALL orders')
						s.tools.orderStatus(undefined, undefined, undefined, undefined, 'Free')
					}})
					keyMap.set('M', {desc: ('switch between \'Maker\' and \'Taker\' order type'.grey), action: function() {
						(so.order_type === 'maker' ? so.order_type = 'taker' : so.order_type = 'maker')
						console.log('\n' + so.order_type.toUpperCase() + ' ' + 'fees activated'.black.bgYellow)
					}})
					break
				}
				case 2: {

					break
				}
				case 3: {
					//Modo EXCHANGE
					keyMap.set('B', {desc: ('Balance on Exchange'.grey), action: function() {
						console.log('\nGetting balance from Exchange'.yellow)
						engine.syncBalance( function() {
							console.log('s.balance:')
							console.log(s.balance)
							console.log('s.available_balance:')
							console.log(s.available_balance)
						})
					}})
					keyMap.set('o', {desc: ('list orders on exchange'.grey), action: function() {
						s.exchange_orders_index = null
						s.exchange_orders = []
						let opts_tmp = {
								product_id: so.selector.product_id
						}

						s.exchange.getAllOrders(opts_tmp, function (err, orders) {
							s.exchange_orders = orders
							if (orders && orders.length) {
								s.exchange_orders_index = 0
							}
							console.log('\nOrders on Exchange: '.yellow + orders.length + '\n')
							console.log(s.exchange_orders)
						})
					}})
					keyMap.set('+', {desc: ('set order'.grey + ' NEXT'.yellow), action: function() {
						if (s.exchange_orders.length) {
							s.exchange_orders_index++
							if (s.exchange_orders_index > (s.exchange_orders.length - 1)) {
								s.exchange_orders_index = 0
							}
							console.log('\nOrder on Exchange in control:'.yellow)
							console.log(s.exchange_orders[s.exchange_orders_index].id)
						}
						else {
							console.log('No exchange_orders in memory. Try to get the list by pressing "o".')
						}
					}})
					keyMap.set('-', {desc: ('set order'.grey + ' PREVIOUS'.yellow), action: function() {
						if (s.exchange_orders.length) {
							s.exchange_orders_index--
							if (s.exchange_orders_index < 0) {
								s.exchange_orders_index = (s.exchange_orders.length - 1)
							}
							console.log('\nOrder on Exchange in control:'.yellow)
							console.log(s.exchange_orders[s.exchange_orders_index].id)
						}
						else {
							console.log('No exchange_orders in memory. Try to get the list by pressing "o".')
						}
					}})
					keyMap.set('i', {desc: ('get information on order'.grey), action: function() {
						if (s.exchange_orders.length) {
							console.log('\nInformation on order on Exchange in control:'.yellow)
							console.log(s.exchange_orders[s.exchange_orders_index])
						}
						else {
							console.log('No exchange_orders in memory. Try to get the list by pressing "o".')
						}
					}})
					keyMap.set('K', {desc: ('renew the connection with exchange'.grey), action: function() {
						console.log('\nCancelling connection to exchange for creating a new one'.yellow)
						s.exchange.cancelConnection()
					}})
					keyMap.set('c', {desc: ('cancel order'.grey), action: function() {
						if (s.exchange_orders.length) {
							let opts_tmp = {
									order_id: s.exchange_orders[s.exchange_orders_index].id,
									product_id: so.selector.product_id
							}
							console.log('\nCancelling order on Exchange in control:'.yellow)
							s.exchange.cancelOrder(opts_tmp, function() {
								debug.msg('Order ' + s.exchange_orders[s.exchange_orders_index].id + ' canceled')

								s.exchange.getAllOrders(opts_tmp, function (err, orders) {
									s.exchange_orders = orders
									if (orders && orders.length) {
										s.exchange_orders_index = 0
									}
								})
							})
						}
						else {
							console.log('No exchange_orders in memory. Try to get the list by pressing "o".')
						}
					}})
					keyMap.set('C', {desc: ('cancel ALL order'.grey), action: function() {
						console.log('\nCancelling ALL orders on Exchange:'.yellow)
						let opts_tmp = {
							product_id: so.selector.product_id
						}
						s.exchange.cancelAllOrders(opts_tmp, function() {
							debug.msg('Orders canceled')

							s.exchange.getAllOrders(opts_tmp, function (err, orders) {
								s.exchange_orders = orders
								if (orders && orders.length) {
									s.exchange_orders_index = 0
								}
							})
						})
					}})
					break
				}
				case 4: {
					//Modo POSITIONS
					if (s.positions.length) {
						s.positions_index = 0
					}
					else {
						s.positions_index = null
						console.log('\nNo position opened.')
						break
					}

					keyMap.set('+', {desc: ('set position'.grey + ' NEXT'.yellow), action: function() {
						if (s.positions.length) {
							s.positions_index++
							if (s.positions_index > (s.positions.length - 1)) {
								s.positions_index = 0
							}
							console.log('\nPosition in control: '.yellow + s.positions[s.positions_index].id)
						}
						else {
							console.log('\nNo position opened.')
						}
					}})
					keyMap.set('-', {desc: ('set position'.grey + ' PREVIOUS'.yellow), action: function() {
						if (s.positions.length) {
							s.positions_index--
							if (s.positions_index < 0) {
								s.positions_index = (s.positions.length - 1)
							}
							console.log('\nPosition in control: '.yellow + s.positions[s.positions_index].id)
						}
						else {
							console.log('\nNo position opened.')
						}
					}})
					keyMap.set('i', {desc: ('get information on the position'.grey), action: function() {
						if (s.positions_index != null) {
							debug.obj('\nInformation on position: '.yellow + s.positions[s.positions_index].id, s.positions[s.positions_index], false, true)
						}
						else {
							console.log('\nNo position in control.')
						}
					}})
					keyMap.set('K', {desc: ('set a manual close order (with fixed actual price) on the position'.grey), action: function() {
						if (s.positions_index != null) {
							if (s.positions[s.positions_index].side === 'buy') {
								let protectionFree = s.protectionFlag['calmdown'] + s.protectionFlag['long_short']
								let target_price = n(s.quote.ask).format(s.product.increment, Math.floor)
								console.log('\nSet a manual close ' + 'SELL'.yellow + ' order on the position: ' + s.positions[s.positions_index].id + ' at ' + formatCurrency(target_price, s.currency).yellow)
								s.eventBus.emit('manual', 'sell', s.positions[s.positions_index].id, null, target_price, protectionFree)
							}
							else {
								let protectionFree = s.protectionFlag['calmdown'] + s.protectionFlag['long_short']
								let target_price = n(s.quote.bid).format(s.product.increment, Math.floor)
								console.log('\nSet a manual close ' + 'BUY'.yellow + ' order on the position: ' + s.positions[s.positions_index].id + ' at ' + formatCurrency(target_price, s.currency).yellow)
								s.eventBus.emit('manual', 'buy', s.positions[s.positions_index].id, null, target_price, protectionFree)
							}
						}
						else {
							console.log('\nNo position in control.')
						}
					}})
					keyMap.set('F', {desc: ('Free completely the position (cancel ALL orders connected to the position and let it be used)'.grey), action: function() {
						if (s.positions_index != null) {
							console.log('\nFreeing completely the position (cancelling all orders connected with the position) '.yellow + s.positions[s.positions_index].id)
							s.tools.positionFlags(s.positions[s.positions_index], 'status', 'Free')
							s.tools.positionFlags(s.positions[s.positions_index], 'locked', 'Free')
							s.positionProcessingQueue.push({mode: 'update', position_id: s.positions[s.positions_index].id})
						}
						else {
							console.log('\nNo position in control.')
						}
					}})
					keyMap.set('L', {desc: ('Lock (Manual) the position (does not cancel orders connected to the position)'.grey), action: function() {
						if (s.positions_index != null) {
							console.log('\nLocking (Manual) the position '.yellow + s.positions[s.positions_index].id)
							s.tools.positionFlags(s.positions[s.positions_index], 'locked', 'Set', 'manual')
							s.positionProcessingQueue.push({mode: 'update', position_id: s.positions[s.positions_index].id})
						}
						else {
							console.log('\nNo position in control.')
						}
					}})
					keyMap.set('U', {desc: ('Unlock (Manual) the position (does not cancel orders connected to the position)'.grey), action: function() {
						if (s.positions_index != null) {
							console.log('\nUnlocking (Manual) the position '.yellow + s.positions[s.positions_index].id)
							s.tools.positionFlags(s.positions[s.positions_index], 'locked', 'Unset', 'manual')
							s.positionProcessingQueue.push({mode: 'update', position_id: s.positions[s.positions_index].id})
						}
						else {
							console.log('\nNo position in control.')
						}
					}})
					keyMap.set('c', {desc: ('cancel ALL orders connected to the position, leaving it locked/unlocked'.grey), action: function() {
						if (s.positions_index != null) {
							console.log('\nCanceling all orders connected with the position '.yellow + s.positions[s.positions_index].id)
							s.tools.positionFlags(s.positions[s.positions_index], 'status', 'Free')
						}
						else {
							console.log('\nNo position in control.')
						}
					}})
					keyMap.set('C', {desc: ('cancel the position'.grey), action: function() {
						if (s.positions_index != null) {
//							Da sistemare: Attenzione!! Se ordino più cancellazioni in breve lasso di tempo, s.position_index diventa null prima che 
							// s.positionProcessingQueue possa eseguire le operazioni, quindi non troverà il .id e il programma andrà
							// in errore.
							console.log('\nCanceling the position '.yellow + s.positions[s.positions_index].id)

							s.tools.positionFlags(s.positions[s.positions_index], 'status', 'Free')
							setTimeout(function() {
								s.positionProcessingQueue.push({mode: 'delete', position_id: s.positions[s.positions_index].id})
								s.positions_index = null
							}, so.order_poll_time)
						}
						else {
							console.log('\nNo position in control.')
						}
					}})
					break
				}
				case 5: {
					//Modo STRATEGIES
					let actual_code = 97; //'a'

					key_assign = {
							command: function (key, desc_action) {
								keyMap.set(key, desc_action)
							}
					};

					Object.keys(s.options.strategy).forEach(function (strategy_name, index, array) {			
						if (so.strategy[strategy_name].lib.getCommands) {
							let actual_key = String.fromCharCode(actual_code)
							keyMap.set(actual_key, {desc: ('Strategia\t'.grey + strategy_name.white), action: function() {
								clearStrategyKeys()
								so.strategy[strategy_name].lib.getCommands.call(key_assign, s)
								listKeys()
							}})
							actual_code++
						}
					})


//					Tutta questa roba deve entrare nei comandi per le strategie!!!
//					//Modo LIMITS
//					keyMap.set('q', {desc: ('Buy price limit'.grey + ' INCREASE'.green), action: function() {
//					if (!so.buy_price_limit) {
//					so.buy_price_limit = Number(s.quote.bid)
//					}
//					so.buy_price_limit += 10
//					console.log('\n' + 'Buy price limit' + ' INCREASE'.green + ' -> ' + so.buy_price_limit)
//					}})
//					keyMap.set('a', {desc: ('Buy price limit'.grey + ' DECREASE'.red), action: function() {
//					if (!so.buy_price_limit) {
//					so.buy_price_limit = Number(s.quote.bid)
//					}
//					so.buy_price_limit -= 10
//					console.log('\n' + 'Buy price limit' + ' DECREASE'.red + ' -> ' + so.buy_price_limit)
//					}})
//					keyMap.set('w', {desc: ('Sell price limit'.grey + ' INCREASE'.green), action: function() {
//					if (!so.sell_price_limit) {
//					so.sell_price_limit = Number(s.quote.ask)
//					}
//					so.sell_price_limit += 10
//					console.log('\n' + 'Sell price limit' + ' INCREASE'.green + ' -> ' + so.sell_price_limit)
//					}})
//					keyMap.set('s', {desc: ('Sell price limit'.grey + ' DECREASE'.red), action: function() {
//					if (!so.sell_price_limit) {
//					so.sell_price_limit = Number(s.quote.ask)
//					}
//					so.sell_price_limit -= 10
//					console.log('\n' + 'Sell price limit' + ' DECREASE'.red + ' -> ' + so.sell_price_limit)
//					}})
//					keyMap.set('z', {desc: ('Buy/Sell price limit'.grey + ' CANCEL'.yellow), action: function() {
//					so.buy_price_limit = null
//					so.sell_price_limit = null
//					console.log('\n' + 'Buy/Sell price limit' + ' CANCELED'.yellow)
//					}})




//					keyMap.set('o', {desc: ('Actual values for limits'.grey), action: function() {
//					actual_values = '\nActual values for limits:'
//					actual_values += '\n-------------------------'
//					actual_values += '\nBuy price limit= ' + so.buy_price_limit
//					actual_values += '\nSell price limit= ' + so.sell_price_limit
//					actual_values += '\nSell gain pct= ' + so.sell_gain_pct
//					actual_values += '\nBuy gain pct= ' + so.buy_gain_pct

//					console.log(actual_values)
//					}})
					break
				}
				case 6: {
					//Modo OPTIONS
					keyMap.set('o', {desc: ('show current trade options'.grey), action: function() { listOptions ()}})
					keyMap.set('a', {desc: ('show current trade options in a dirty view (full list)'.grey), action: function() {
						let so_tmp = JSON.parse(JSON.stringify(so))
						delete so_tmp.strategy
						debug.obj('\n', so_tmp, false, true)

						Object.keys(so.strategy).forEach(function (strategy_name, index) {
							debug.obj('\n' + strategy_name, so.strategy[strategy_name].opts, false, true)
						})
					}})
					keyMap.set('O', {desc: ('show current strategies options/data'.grey), action: function() {
						Object.keys(so.strategy).forEach(function (strategy_name, index) {
							s.tools.listStrategyOptions(strategy_name, false)
						})
					}})
					keyMap.set('z', {desc: ('toggle Long Position'.grey), action: function() {
						so.active_long_position = !so.active_long_position
						console.log('\nToggle Long position: ' + (so.active_long_position ? 'ON'.green.inverse : 'OFF'.red.inverse))
					}})
					keyMap.set('Z', {desc: ('toggle Short Position'.grey), action: function() {
						so.active_short_position = !so.active_short_position
						console.log('\nToggle Short position: ' + (so.active_short_position ? 'ON'.green.inverse : 'OFF'.red.inverse))
					}})
					keyMap.set('h', {desc: ('dump statistical output to HTML file'.grey), action: function() {
						console.log('\nDumping statistics...'.grey)
						printTrade(false, true)
					}})
//					keyMap.set('H', {desc: ('toggle automatic HTML dump to file'.grey), action: function() {
//					console.log('\nDumping statistics...'.grey)
//					toggleStats()
//					}})
					break
				}
				case 7: {
					//Modo DEBUG TOOLS
					keyMap.set('D', {desc: ('toggle DEBUG'.grey), action: function() {
						debug.flip()
						console.log('\nDEBUG mode: ' + (debug.on ? 'ON'.green.inverse : 'OFF'.red.inverse))
					}})
					keyMap.set('X', {desc: ('toggle DEBUG EXCHANGE'.grey), action: function() {
						s.exchange.debug_exchange = !s.exchange.debug_exchange
						console.log('\nDEBUG EXCHANGE mode: ' + (s.exchange.debug_exchange ? 'ON'.green.inverse : 'OFF'.red.inverse))
					}})
					keyMap.set('R', {desc: ('compact databases'.grey), 	action: function() {
						console.log('\nCompacting databases...'.grey)
						compactDatabases()
					}})
					keyMap.set('K', {desc: ('clean databases (delete data older than '.grey + so.db.tot_days + ' days)'.grey), action: function() {
						console.log('\nCleaning databases...'.grey)
						cleanDB()
					}})
					break
				}
				}
				listKeys()
			}
			/* End of changeModeCommand() */

			/* List of available commands */
			function listKeys() {
				console.log('\n------------------------------\nCommand Menu ' + modeMap.get(modeCommand).yellow)
				console.log('\nAvailable command keys:')
				keyMap.forEach((value, key) => {
					console.log(' ' + key + ' - ' + value.desc)
				})
			}

			/* Clear keys normally used by strategy menu */
			function clearStrategyKeys() {
				let group = ['+', '-', '*', '_', 'i', 'I', 'k', 'K', 'u', 'U', 'j', 'J', 'y', 'Y', 'h', 'H', 't', 'T', 'g', 'G']
				group.forEach((key) => {
					keyMap.delete(key)
				})
			}

			/* To clean databases */
			function cleanDB() {
				if(so.minimal_db) {
					console.log('Function cleanDB not available! minimal_db option is active.')
				}
				else {
					fromTime = n(moment().subtract(so.db.tot_days, 'd')).value()

					debug.msg('cleanDB - Pulisco il db dei record più vecchi di ' + fromTime + ' (ora è ' + moment() + ')... ')

					s.db_periods.deleteMany({'time' : { $lt : fromTime }}, function (err, numRemoved) {
						if (err) {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - cleanDB - error cleaning db.periods')
							console.error(err)
						}
						debug.msg('cleanDB - ' + numRemoved + ' period(s) deleted')
					})

					db_trades.deleteMany({'time' : { $lt : fromTime }}, function (err, numRemoved) {
						if (err) {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - cleanDB - error cleaning db.trades')
							console.error(err)
						}
						debug.msg('cleanDB - ' + numRemoved + ' trade(s) deleted')
					})
				}
			}
			
			/* To compact databases */
			function compactDatabases(cb = function () {}) {
				//db_my_trades
				db_my_positions.compactCollection(cb)
				//db_my_closed_positions
				//db_periods
				db_sessions.compactCollection(cb)
				db_resume_markers.compactCollection(cb)
				//db_trades
			}

			/* Funzioni per le operazioni sul database delle posizioni */
			s.positionProcessingQueue = async.queue(function(task, callback = function () {}) {
				s.wait_updatePositions = true
				switch (task.mode) {
				case 'update': {
					var position = s.positions.find(x => x.id === task.position_id)
					position._id = position.id

					db_my_positions.updateOne({'_id' : task.position_id}, {$set: position}, {multi: false, upsert: true}, function (err) {
						if (err) {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - quantum-trade - error saving in db_my_positions')
							console.error(err)

							return callback(err)
						}
					})
					break
				}
				case 'delete': {
					var position_index = s.positions.findIndex(x => x.id === task.position_id)
					var position = s.positions.find(x => x.id === task.position_id)

					db_my_positions.deleteOne({'_id' : task.position_id}, function (err) {
						//In ogni caso, elimino la posizione da s.positions
						s.positions.splice(position_index,1)

						if (err) {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - quantum-trade - error deleting in db_my_positions')
							console.error(err)
							return callback(err)
						}

						//... e inserisco la posizione chiusa del db delle posizioni chiuse
						if (position) {
							position._id = position.id
							db_my_closed_positions.updateOne({'_id' : task.position_id}, {$set: position}, {multi: false, upsert: true}, function (err) {
								if (err) {
									console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - quantum-trade - error saving in db_my_closed_positions')
									console.error(err)
									return callback(err)
								}

								s.tools.functionStrategies('onPositionClosed', task)
							})
						}
					})
					break
				}
				}
				s.wait_updatePositions = false
				callback(null)
			})

			// Assegna una funzione di uscita
			s.positionProcessingQueue.drain(function() {
				debug.msg('s.positionProcessingQueue - All items have been processed')
			})
			/* End funzioni per le operazioni sul database delle posizioni */

			/* To list options*/
			function listOptions () {
				process.stdout.write('\n' + s.exchange.name.toUpperCase() + ' exchange active trading options:'.grey + '\n')

				Object.keys(so.strategy).forEach(function (strategy_name, index) {
					s.tools.listStrategyOptions(strategy_name, true)
				})

				process.stdout.write('\n')

				process.stdout.write([
					s.tools.zeroFill(25, so.mode.toUpperCase() + ' MODE'.grey, ' '),
					s.tools.zeroFill(25, 'PERIOD LENGTH'.grey, ' '),
					s.tools.zeroFill(25, 'ORDER TYPE'.grey, ' '),
					s.tools.zeroFill(25, 'SLIPPAGE'.grey, ' '),
					s.tools.zeroFill(30, 'EXCHANGE FEES'.grey, ' ')
					].join('') + '\n');

				process.stdout.write([
					s.tools.zeroFill(15, (so.mode === 'paper' ? '      ' : (so.mode === 'live' && (so.manual === false || typeof so.manual === 'undefined')) ? '        ' + 'AUTO'.black.bgRed + '   ' : '       ' + 'MANUAL'.black.bgGreen + '  '), ' '),
					s.tools.zeroFill(12, so.period_length, ' '),
					s.tools.zeroFill(26, (so.order_type === 'maker' ? so.order_type.toUpperCase().green : so.order_type.toUpperCase().red), ' '),
					s.tools.zeroFill(28, (so.mode === 'paper' ? 'avg. '.grey + so.avg_slippage_pct + '%' : 'max '.grey + so.max_slippage_pct + '%'), ' '),
					s.tools.zeroFill(17, (so.order_type + ' ' + n((so.order_type === 'maker' ?  s.exchange.makerFee : s.exchange.takerFee)).divide(100).format('0.000%')), ' ')
					].join('') + '\n\n');

				process.stdout.write('');

				process.stdout.write([
					s.tools.zeroFill(36, 'LONG / SHORT POSITION'.grey, ' ')
					].join('') + '\n');

				process.stdout.write([
					s.tools.zeroFill(10, so.active_long_position, ' '),
					s.tools.zeroFill(8, so.active_short_position, ' ')
					].join('') + '\n\n');

				process.stdout.write('');
			}
			/* End listOptions() */

			//Exit function
			function exit() {
				s.exchange.getAllOrders(so.selector, function (err, orders) {
					if ((orders && orders.length === 0) || so.mode === 'paper') {
						console.log('\nExiting... ' + '\nWriting statistics...'.grey)
						//Salvo la sessione
						saveSession()
						//Attendo ulteriori 5s per chiudere le statistiche
						setTimeout(function() { printTrade(true) }, 5000)
					}
					else {
						console.log('\nOrders on Exchange: '.yellow + orders.length + '\n')
						setTimeout(function() { exit() }, so.order_poll_time)
					} 
				})
			}

			/* Implementing statistical Exit */
			function printTrade (quit, dump, statsOnly = false) {
				var tmp_capital_currency = n(s.balance.currency).add(n(s.period.close).multiply(s.balance.asset)).format('0.00')
				var tmp_capital_asset = n(s.balance.asset).add(n(s.balance.currency).divide(s.period.close)).format('0.00000000')
				if (quit) {
					s.lookback.unshift(s.period)
				}
				var profit_currency = n(tmp_capital_currency).subtract(s.orig_capital_currency).divide(s.orig_capital_currency)
				var profit_asset = n(tmp_capital_asset).subtract(s.orig_capital_asset).divide(s.orig_capital_asset)
				var buy_hold = n(s.orig_capital_currency).divide(s.orig_price).multiply(s.period.close)
				var buy_hold_profit = n(buy_hold).subtract(s.orig_capital_currency).divide(s.orig_capital_currency)
				var sell_hold = n(s.orig_capital_asset).multiply(s.orig_price).divide(s.period.close)
				var sell_hold_profit = n(sell_hold).subtract(s.orig_capital_asset).divide(s.orig_capital_asset)
				if (!statsOnly) {
					console.log()
					var output_lines = []
					output_lines.push('Starting currency: ' + formatCurrency(s.start_currency, s.currency).yellow)
					output_lines.push('Starting asset: ' + formatAsset(s.start_asset, s.asset).yellow)
					output_lines.push('Starting capital in currency: ' + formatCurrency(s.start_capital_currency, s.currency).yellow)
					output_lines.push('Starting capital in asset: ' + formatAsset(s.start_capital_asset, s.asset).yellow)
					output_lines.push('Starting price: ' + formatCurrency(s.start_price, s.currency).yellow)
					output_lines.push('Original currency: ' + formatCurrency(s.orig_currency, s.currency).yellow)
					output_lines.push('Original asset: ' + formatAsset(s.orig_asset, s.asset).yellow)				
					output_lines.push('Original capital in currency: ' + formatCurrency(s.orig_capital_currency, s.currency).yellow)
					output_lines.push('Original capital in asset: ' + formatAsset(s.orig_capital_asset, s.asset).yellow)
					output_lines.push('Original price: ' + formatCurrency(s.orig_price, s.currency).yellow)
					output_lines.push('Balance: ' + formatCurrency(s.balance.currency, s.currency).yellow + ' ; ' +  formatAsset(s.balance.asset, s.asset).yellow)
					output_lines.push('Last capital in currency: ' + n(tmp_capital_currency).format('0.00').yellow + ' (' + profit_currency.format('0.00%') + ')')
					output_lines.push('BuyHold: ' + buy_hold.format('0.00').yellow + ' (' + n(buy_hold_profit).format('0.00%') + ')')
					output_lines.push('vs. BuyHold: ' + n(tmp_capital_currency).subtract(buy_hold).divide(buy_hold).format('0.00%').yellow)
					output_lines.push('Last capital in asset: ' + n(tmp_capital_asset).format('0.00000000').yellow + ' (' + profit_asset.format('0.00%') + ')')
					output_lines.push('SellHold: ' + sell_hold.format('0.00000000').yellow + ' (' + n(sell_hold_profit).format('0.00%') + ')')
					output_lines.push('vs. SellHold: ' + n(tmp_capital_asset).subtract(sell_hold).divide(sell_hold).format('0.00%').yellow)
					output_lines.push(s.my_trades.length + ' trades over ' + s.day_count + ' days (avg ' + n(s.my_trades.length / s.day_count).format('0.00') + ' trades/day)')
					output_lines.push('Total fees: ' + formatCurrency(s.total_fees, s.currency).yellow)
					output_lines.push('Total profit: ' + formatCurrency(s.total_profit, s.currency).yellow)
					output_lines.push(s.positions.length + ' positions opened.')
					output_lines.push(s.orders.length + ' orders opened.')
					output_lines.push(sizeof(s) + ' size of s')
					output_lines.push(sizeof(s.period) + ' size of s.period')
					output_lines.push(sizeof(s.lookback) + ' size of s.lookback')
					Object.keys(so.strategy).forEach(function (strategy_name, index) {
						output_lines.push(sizeof(s.options.strategy[strategy_name].calc_lookback) + ' size of ' + strategy_name + ' calc_lookback')
					})
					output_lines.push(s.exchange.getMemory() + ' size of cache in exchange')
				}
				// Build stats for UI
				s.stats = {
						profit_currency: profit_currency.format('0.00%'),
						tmp_capital_currency: n(tmp_capital_currency).format('0.00'),
						buy_hold: buy_hold.format('0.00'),
						buy_hold_profit: n(buy_hold_profit).format('0.00%'),
						day_count: s.day_count,
						total_fees: s.total_fees,
						total_profit: s.total_profit,
						trade_per_day: n(s.my_trades.length / s.day_count).format('0.00')
				}

				var losses = 0, gains = 0
				db_my_closed_positions.find({selector: so.selector.normalized}).toArray(function (err, position) {
					if (position.profit) {
						if (position.profit > 0) {
							gains++
						}
						else {
							losses++
						}
					}
				})

				if (gains > 0) {
					if (!statsOnly) {
						output_lines.push('win/loss: ' + gains + '/' + losses)
						output_lines.push('error rate: ' + (n(losses).divide(gains + losses).format('0.00%')).yellow)
					}

					//for API
					s.stats.win = gains
					s.stats.losses = losses
					s.stats.error_rate = n(losses).divide(gains + losses).format('0.00%')
				}

				if (!statsOnly) {
					output_lines.forEach(function (line) {
						console.log(line)
					})
				}

				if (quit || dump) {
					var html_output = output_lines.map(function (line) {
						return colors.stripColors(line)
					}).join('\n')
					var data = s.lookback.slice(0, s.lookback.length - so.min_periods).map(function (period) {
						var data = {}
						var keys = Object.keys(period)
						for(var i = 0; i < keys.length; i++){
							data[keys[i]] = period[keys[i]]
						}
						return data
					})
					var code = 'var data = ' + JSON.stringify(data) + ';\n'
					code += 'var trades = ' + JSON.stringify(s.my_trades) + ';\n'
					var tpl = fs.readFileSync(path.resolve(__dirname, '..', 'templates', '9sim_result.html.tpl'), {encoding: 'utf8'})
					var out = tpl
					.replace('{{code}}', code)
					.replace('{{trend_ema_period}}', so.trend_ema || 36)
					.replace('{{output}}', html_output)
					.replace(/\{\{symbol\}\}/g,  so.selector.normalized + ' - zenbot ' + require('../package.json').version)
					if (so.filename !== 'none') {
						var out_target
						var out_target_prefix = so.paper ? 'simulations/paper_result_' : 'stats/trade_result_'
							if (dump) {
								var dt = new Date().toISOString()

								//ymd
								var today = dt.slice(2, 4) + dt.slice(5, 7) + dt.slice(8, 10)
								out_target = so.filename || out_target_prefix + so.selector.normalized +'_' + today + '_UTC.html'
								fs.writeFileSync(out_target, out)
							} else
								out_target = so.filename || out_target_prefix + so.selector.normalized +'_' + new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/-/g, '').replace(/:/g, '').replace(/20/, '') + '_UTC.html'

								fs.writeFileSync(out_target, out)
								console.log('\nwrote'.grey, out_target)
					}
					if (quit) process.exit(0)
				}
			}
			/* The end of printTrade */


//			/* Implementing statistical status dump every 10 secs */
//			var shouldSaveStats = false
//			function toggleStats() {
//			shouldSaveStats = !shouldSaveStats
//			if (shouldSaveStats) {
//			console.log('Auto stats dump enabled')
//			}
//			else {
//			console.log('Auto stats dump disabled')
//			}
//			}

//			function saveStatsLoop() {
//			saveStats()
//			setTimeout(function () {
//			saveStatsLoop()
//			}, 10000)
//			}
//			saveStatsLoop()

//			function saveStats() {
//			if(!shouldSaveStats) return

//			var output_lines = []
//			var tmp_capital_currency = n(s.balance.currency).add(n(s.period.close).multiply(s.balance.asset)).format('0.00')
//			var tmp_capital_asset = n(s.balance.asset).add(n(s.balance.currency).divide(.close)).format('0.00000000')

//			//        var profit = s.start_capital_currency ? n(tmp_capital_currency).subtract(s.start_capital_currency).divide(s.start_capital_currency) : n(0)
//			var profit_currency = n(tmp_capital_currency).subtract(s.orig_capital_currency).divide(s.orig_capital_currency)
//			var profit_asset = n(tmp_capital_asset).subtract(s.orig_capital_asset).divide(s.orig_capital_asset)
//			output_lines.push('Last balance in currency: ' + formatCurrency(tmp_capital_currency, s.currency).yellow + ' (' + profit_currency.format('0.00%') + ')')
//			output_lines.push('Last balance in asset: ' + formatAsset(tmp_capital_asset, s.asset).yellow + ' (' + profit_asset.format('0.00%') + ')')
//			var buy_hold = n(s.orig_capital_currency).divide(s.orig_price).multiply(s.period.close)
//			var buy_hold_profit = n(buy_hold).subtract(s.orig_capital_currency).divide(s.orig_capital_currency)
//			var sell_hold = n(s.orig_capital_asset).multiply(s.orig_price).divide(s.period.close)
//			var sell_hold_profit = n(sell_hold).subtract(s.orig_capital_asset).divide(s.orig_capital_asset)

//			output_lines.push('BuyHold: ' + formatCurrency(buy_hold, s.currency).yellow + ' (' + n(buy_hold_profit).format('0.00%') + ')')
//			output_lines.push('vs. BuyHold: ' + n(tmp_capital_currency).subtract(buy_hold).divide(buy_hold).format('0.00%').yellow)
//			output_lines.push('SellHold: ' + formatAsset(sell_hold, s.asset).yellow + ' (' + n(sell_hold_profit).format('0.00%') + ')')
//			output_lines.push('vs. SellHold: ' + n(tmp_capital_asset).subtract(sell_hold).divide(sell_hold).format('0.00%').yellow)
//			output_lines.push(s.my_trades.length + ' trades over ' + s.day_count + ' days (avg ' + n(s.my_trades.length / s.day_count).format('0.00') + ' trades/day)')
//			// Build stats for UI
//			s.stats = {
//			profit_currency: profit_currency.format('0.00%'),
//			tmp_capital_currency: n(tmp_capital_currency).format('0.00000000'),
//			buy_hold: buy_hold.format('0.00000000'),
//			buy_hold_profit: n(buy_hold_profit).format('0.00%'),
//			day_count: s.day_count,
//			total_fees: s.total_fees,
//			trade_per_day: n(s.my_trades.length / s.day_count).format('0.00')
//			}

//			var losses = 0, gains = 0
//			s.my_trades.forEach(function (trade) {
//			if (trade.profit) {
//			if (trade.profit > 0) {
//			gains++
//			}
//			else {
//			losses++
//			}
//			}
//			})

//			if (s.my_trades.length && gains > 0) {
//			output_lines.push('win/loss: ' + gains + '/' + losses)
//			output_lines.push('error rate: ' + (n(losses).divide(gains + losses).format('0.00%')).yellow)

//			//for API
//			s.stats.win = gains
//			s.stats.losses = losses
//			s.stats.error_rate = n(losses).divide(gains + losses).format('0.00%')
//			}

//			var html_output = output_lines.map(function (line) {
//			return colors.stripColors(line)
//			}).join('\n')
//			var data = s.lookback.slice(0, s.lookback.length - so.min_periods).map(function (period) {
//			var data = {}
//			var keys = Object.keys(period)
//			for(var i = 0; i < keys.length; i++){
//			data[keys[i]] = period[keys[i]]
//			}
//			return data
//			})
//			var code = 'var data = ' + JSON.stringify(data) + ';\n'
//			code += 'var trades = ' + JSON.stringify(s.my_trades) + ';\n'
//			var tpl = fs.readFileSync(path.resolve(__dirname, '..', 'templates', 'sim_result.html.tpl'), {encoding: 'utf8'})
//			var out = tpl
//			.replace('{{code}}', code)
//			.replace('{{trend_ema_period}}', so.trend_ema || 36)
//			.replace('{{output}}', html_output)
//			.replace(/\{\{symbol\}\}/g,  so.selector.normalized + ' - zenbot ' + require('../package.json').version)
//			if (so.filename !== 'none') {
//			var out_target
//			var dt = new Date().toISOString()

//			//ymd
//			var today = dt.slice(2, 4) + dt.slice(5, 7) + dt.slice(8, 10)
//			let out_target_prefix = so.paper ? 'simulations/paper_result_' : 'stats/trade_result_'
//			out_target = so.filename || out_target_prefix + so.selector.normalized +'_' + today + '_UTC.html'

//			fs.writeFileSync(out_target, out)
//			//console.log('\nwrote'.grey, out_target)
//			}
//			}
//			/* End of implementing statistical status */

			//Per caricare i dati dei trades, chiama zenbot.js backfill (so.selector.normalized) --days __ --conf __
			var zenbot_cmd = process.platform === 'win32' ? 'zenbot.bat' : 'zenbot.sh'; // Use 'win32' for 64 bit windows too
			var command_args = ['backfill', so.selector.normalized, '--days', days || 1]
			if (cmd.conf) {
				command_args.push('--conf', cmd.conf)
			}
			var backfiller = spawn(path.resolve(__dirname, '..', zenbot_cmd), command_args)
			backfiller.stdout.pipe(process.stdout)
			backfiller.stderr.pipe(process.stderr)
			backfiller.on('exit', function (code) {
				if (code) {
					process.exit(code)
				}
				
				console.log('------------------------------------------ PREROLL PHASE ------------------------------------------'.white)
				
				getNext()
				
				function getNext() {
					var opts = {
						query: {
							selector: so.selector.normalized
						},
						sort: {
							time: 1
						},
						limit: 1000
					}
					if (db_cursor) {
						opts.query.time = {$gt: db_cursor}
					}
					else {
						trade_cursor = s.exchange.getCursor(query_start)
						opts.query.time = {$gte: query_start}
					}
					//Il download dei dati ha impiegato molto tempo, e altro tempo lo impiega db_trades.find
					//Alla fine, quindi, i trades del preroll non saranno tutti, perchè il db scaricato sarà 
					//completo solo fino al tempo di fine download. 
					db_trades.find(opts.query).limit(opts.limit).sort(opts.sort).toArray(function (err, filtered_trades) {
						if (err) {
							throw err
						}
						
						//Se ci sono filtered_trades, allora non esegue questo blocco ma esegue engine.update che c'è dopo
						//Una volta stampati i trade vecchi, trades è vuoto, quindi esegue questo blocco e non esegue engine.update (perché c'è un return in questo blocco)
						if (!filtered_trades.length) {
//							if (!engine.tradeProcessing()) {
//								console.log('Pre-roll in progress...')
//								setTimeout(getNext, 1000)
//							}
							var head = '------------------------------------------ INITIALIZE  OUTPUT ------------------------------------------';
							console.log(head)

							//A che diavolo serve?
							output(conf).initializeOutput(s)

							var minuses = Math.floor((head.length - so.mode.length - 19) / 2)
							console.log('-'.repeat(minuses) + ' STARTING ' + so.mode.toUpperCase() + ' TRADING ' + '-'.repeat(minuses + (minuses % 2 == 0 ? 0 : 1)))
							if (so.mode === 'paper') {
								console.log('!!! Paper mode enabled. No real trades are performed until you remove --paper from the startup command.')
							}

							//Se è attiva l'opzione minimal_db, cancello i db trades e periods
							if(so.minimal_db) {
								console.log('Option minimal_db is active! Delete db_periods and db_trades')
								s.db_periods = conf.db.periods = null
								db_trades = conf.db.trades = null
							}
							
							//Inizializzo i comandi dell'interfaccia
							changeModeCommand()

							engine.syncBalance(function (err) {
								if (err) {
									if (err.desc) console.error(err.desc)
									if (err.body) console.error(err.body)
									throw err
								}
								let so_tmp = JSON.parse(JSON.stringify(so))
								delete so_tmp.strategy
								session = {
									id: crypto.randomBytes(4).toString('hex'),
									selector: so.selector.normalized,
									started: new Date().getTime(),
									mode: so.mode,
									options: so_tmp,
//									start_currency: s.start_currency,
//									start_asset: s.start_asset,
//									start_capital_currency: s.start_capital_currency,
//									start_capital_asset: s.start_capital_asset,
//									start_price: s.start_price,
//									orig_currency: s.orig_currency,
//									orig_asset: s.orig_asset,
//									orig_capital_currency: s.start_capital_currency,
//									orig_capital_asset: s.start_capital_asset,
//									orig_price: s.start_price,
//									day_count: s.day_count,
//									total_fees: s.total_fees,
//									total_profit: s.total_profit,
//									num_trades: s.my_trades.length
								}

								session._id = session.id
								db_sessions.find({selector: so.selector.normalized}).limit(1).sort({started: -1}).toArray(function (err, prev_sessions) {
									if (err) throw err
									var prev_session = prev_sessions[0]

									if (prev_session && !cmd.reset && !raw_opts.currency_capital && !raw_opts.asset_capital && (so.mode === 'paper' || so.mode === 'live')) {
										s.orig_currency = session.orig_currency = Number(prev_session.orig_currency)
										s.orig_asset = session.orig_asset = Number(prev_session.orig_asset)
										s.orig_price = session.orig_price = Number(prev_session.orig_price)
										s.orig_capital_currency = session.orig_capital_currency = Number(prev_session.orig_capital_currency)
										s.orig_capital_asset = session.orig_capital_asset = Number(prev_session.orig_capital_asset)
										s.day_count = session.day_count = Number(prev_session.day_count) 
										s.total_fees = session.total_fees = Number(prev_session.total_fees)
										s.total_profit = session.total_profit = Number(prev_session.total_profit)
										session.num_trades = Number(prev_session.num_trades)
										debug.obj('getNext() - prev_session', session)
										if (so.mode === 'paper') {
											debug.obj('getNext() - paper: ', prev_session.balance)
											s.balance = Number(prev_session.balance)
										}
									}
									//Non esiste una precedente sessione
									else {
										debug.msg('getNext() - no prev_session')
										s.orig_currency = session.orig_currency = Number(s.balance.currency) //raw_opts.currency_capital | s.balance.currency | 0
										s.orig_asset = session.orig_asset = Number(s.balance.asset) //raw_opts.asset_capital | s.balance.asset | 0
										s.orig_price = session.orig_price = Number(s.start_price)
										s.orig_capital_currency = session.orig_capital_currency = Number(s.start_capital_currency)
										s.orig_capital_asset = session.orig_capital_asset = Number(s.start_capital_asset)
										debug.msg('getNext() - s.orig_currency = ' + s.orig_currency + ' ; s.orig_asset = ' + s.orig_asset + ' ; s.orig_capital_currency = ' + s.orig_capital_currency + ' ; s.orig_capital_asset = ' + s.orig_capital_asset + ' ; s.orig_price = ' + s.orig_price)
									}

									s.start_currency = session.start_currency = Number(s.balance.currency)
									s.start_asset = session.start_asset = Number(s.balance.asset)
									session.start_capital_currency = Number(s.start_capital_currency)
									session.start_capital_asset = Number(s.start_capital_asset)
									session.start_price = Number(s.start_price)

									if (s.lookback.length > so.keep_lookback_periods) {
										s.lookback.splice(-1,1) //Toglie l'ultimo elemento
									}

									//Chiamata alla funzione forwardScan() ogni so.poll_trades
									setInterval(forwardScan, so.poll_trades)

									//Se l'exchange non ha websocket, chiamata alla funzione getAllOrders() ogni so.order_poll_time
									if (!s.exchange.websocket) { // && typeof s.exchange.getAllOrders === 'function') {
										console.log('Attivo chiamata a s.exchange.getAllOrders')
										setInterval(function() {
											s.exchange.getAllOrders(so.selector)
										}, so.order_poll_time)
									}

									readline.emitKeypressEvents(process.stdin)
									if (!so.non_interactive && process.stdin.setRawMode) {
										process.stdin.setRawMode(true)
										process.stdin.on('keypress', function (key, info) {
											if (!info.ctrl) {
												//debug.msg('Pressed ' + key)
												if (keyMap.has(key)) {
													//debug.msg('keyMap esiste')
													keyMap.get(key).action()
												}
											}
											else if (info.name === 'c') {
												// @todo: cancel open orders before exit
												console.log()
												process.exit()
											}
										})
									}

									//Attivazione del bot di Telegram
									if (so.telegramBot && so.telegramBot.on) {
										const Telegram = require('node-telegram-bot-api')
										const options = {
											polling: true,
										};
										const telegramBot = new Telegram(so.telegramBot.bot_token, options);

										telegramBot.onText(/\/long/, function(msg) {
											debug.msg('TelegramBot - ' + msg.text.toString())
											so.active_long_position = !so.active_long_position
											telegramBot.sendMessage(so.telegramBot.chat_id, (so.active_long_position? 'Long' : 'No long'))
										})

										telegramBot.onText(/\/short/, function(msg) {
											debug.msg('TelegramBot - ' + msg.text.toString())
											so.active_short_position = !so.active_short_position
											telegramBot.sendMessage(so.telegramBot.chat_id, (so.active_short_position? 'Short' : 'No short'))
										})

										telegramBot.onText(/\/status/, function(msg) {
											debug.msg('TelegramBot - ' + msg.text.toString())
											engine.updateMessage()
										})
									}
								})
							})
							return
						}
						
						db_cursor = filtered_trades[filtered_trades.length - 1].time
						trade_cursor = s.exchange.getCursor(filtered_trades[filtered_trades.length - 1])
						engine.update(filtered_trades, true, function (err) {
							if (err) throw err
							setImmediate(getNext)
						})
						
					})
				}
				/* End of getNext() */
			})
			/* End of backfiller.on(exit) */

			var prev_timeout = null
			
			//forwardScan() viene chiamata ogni so.poll_trades
			function forwardScan() {
				//To avoid fetching last trade twice on exchange.getTrades() call.
				// exchange.getTrades()'s "from" argument is inclusive. This modification add a
				// millisecond to it, in order to avoid fetching a second time the last
				// trade of the previous batch.
				var opts = {
						product_id: so.selector.product_id,
						from: trade_cursor + 1
				}

				s.exchange.getTrades(opts, function (err, trades) {
					if (err) {
						if (err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET') {
							if (prev_timeout) {
								console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - getTrades request timed out. retrying...')
							}
							prev_timeout = true
						}
						else if (err.code === 'HTTP_STATUS') {
							if (prev_timeout) {
								console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - getTrades request failed: ' + err.message + '. retrying...')
							}
							prev_timeout = true
						}
						else {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - getTrades request failed. Not retrying.')
							console.error(err)
						}
						return
					}
					prev_timeout = null
					if (trades.length) {
						trades.sort(function (a, b) {
							if (a.time > b.time) return -1
							if (a.time < b.time) return 1
							return 0
						})
						trades.forEach(function (trade) {
							var this_cursor = s.exchange.getCursor(trade)
							trade_cursor = Math.max(this_cursor, trade_cursor)
							if (!so.minimal_db) {
								saveTrade(trade)
							}
						})
						engine.update(trades, function (err) {
							if (err) {
								console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving session')
								console.error(err)
							}
							if (!so.minimal_db) {
								db_resume_markers.updateOne({'_id' : marker._id}, {$set : marker}, {multi: false, upsert : true}, function (err) {
									if (err) {
										console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving marker')
										console.error(err)
									}
								})
							}
							if (s.my_trades.length > my_trades_size) {
								s.my_trades.slice(my_trades_size).forEach(function (my_trade) {
									my_trade._id = my_trade.id
									my_trade.session_id = session.id
									db_my_trades.updateOne({'_id' : my_trade._id}, {$set: my_trade}, {multi: false, upsert: true}, function (err) {
										if (err) {
											console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving my_trade')
											console.error(err)
										}
										//Se c'è stato un my_trade, allora è il caso di aggiornare la sessione
										saveSession()
									})
								})
								my_trades_size = s.my_trades.length
							}

							if (s.lookback.length > lookback_size) {
//								if (!so.minimal_db) {
//									savePeriod(s.lookback[0])
//								}
//								lookback_size = s.lookback.length
//							}
//							if (s.period) {
//								if (!so.minimal_db) {
//									savePeriod(s.period)
//								}
							} 
							else {
								readline.clearLine(process.stdout)
								readline.cursorTo(process.stdout, 0)
								process.stdout.write('Waiting on first live trade to display reports, could be a few minutes ...')
							}
						})
					}

					//Check per invio messaggi di status
					if (nextUpdateMsg && nextUpdateMsg - moment() < 0) {
						nextUpdateMsg = nextUpdateMsg.add(so.update_msg, 'h')
						engine.updateMessage()
					}
					
					//Check per salvataggio sessione (una volta al giorno)
					if (nextSessionSave && nextSessionSave - moment() < 0) {
						nextSessionSave = nextSessionSave.add(1, 'd')
						saveSession()
					}
					
					//Check per compattazione database (una volta ogni 2 giorni)
					if (nextCompactDatabase && nextCompactDatabase - moment() < 0) {
						nextCompactDatabase = nextCompactDatabase.add(2, 'd')
						compactDatabase()
					}
				})

				function saveTrade (trade) {
					trade.id = so.selector.normalized + '-' + String(trade.trade_id)
					trade._id = trade.id
					trade.selector = so.selector.normalized
					if (!marker.from) {
						marker.from = trade_cursor
						marker.oldest_time = trade.time
						marker.newest_time = trade.time
					}
					marker.to = (marker.to ? Math.max(marker.to, trade_cursor) : trade_cursor)
					marker.newest_time = Math.max(marker.newest_time, trade.time)
					db_trades.updateOne({'_id' : trade._id}, {$set : trade}, {multi: false, upsert : true}, function (err) {
						// ignore duplicate key errors
						if (err && err.code !== 11000) {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving trade')
							console.error(err)
						}
					})
				}
				/* End of saveTrade() */
				
//				function savePeriod (period) {
//					s.db_periods.updateOne({'_id': period._id}, {$set: period}, {multi: false, upsert: true}, function (err) {
//						if (err) {
//							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving db_periods')
//							console.error(err)
//						}
//					})
//				}
				/* End of savePeriod() */
			}
			/* End of forwardScan() */

			function saveSession() {
//				//Check sul run_for
//				if (botStartTime && botStartTime - moment() < 0 ) {
//				// Not sure if I should just handle exit code directly or thru printTrade.  Decided on printTrade being if code is added there for clean exits this can just take advantage of it.
//				engine.exit(() => {
//				printTrade(true)
//				})
//				}

//				//Se esiste s.period, aggiorno il database balances
//				if (s.period) {
//				session.price = s.period.close
//				var d = tb().resize(conf.balance_snapshot_period)
//				var b = {
//				id: so.selector.normalized + '-' + d.toString(),
//				selector: so.selector.normalized,
//				time: d.toMilliseconds(),
//				currency: s.balance.currency,
//				asset: s.balance.asset,
//				price: s.period.close,
//				//Questi due seguenti a cosa serve memorizzarli nel db dei balances?
//				start_capital_currency: session.orig_capital_currency,
//				start_price: session.orig_price,
//				}
//				b._id = b.id
//				b.consolidated = n(s.balance.asset).multiply(s.period.close).add(s.balance.currency).value()
//				b.profit_currency = (b.consolidated - session.orig_capital_currency) / session.orig_capital_currency
//				b.buy_hold = s.period.close * (session.orig_asset + session.orig_currency / session.orig_price)
//				b.buy_hold_profit = (b.buy_hold - session.orig_capital_currency) / session.orig_capital_currency
//				b.vs_buy_hold = (b.consolidated - b.buy_hold) / b.buy_hold
//				conf.output.api.on && printTrade(false, false, true)
//				if (so.mode === 'live' && s.db_valid) {
//				db_balances.update({'_id': b._id}, {$set: b}, {multi: false, upsert: true}, function (err) {
//				if (err) {
//				console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving balance')
//				console.error(err)
//				}
//				})
//				}
//				//Con questo, memorizzo valori inutili dentro session.balance.
//				//              session.balance = b
//				}

				session.updated = new Date().getTime()
				session.balance = s.balance
				session.num_trades = s.my_trades.length
				session.day_count = s.day_count
				session.total_fees = s.total_fees
				session.total_profit = s.total_profit

				db_sessions.updateOne({'_id' : session._id}, {$set : session}, {multi: false, upsert : true}, function (err) {
					if (err) {
						console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving session')
						console.error(err)
					}
					else {
						debug.msg('quantum-trade - Session saved.')
					}
				})
			}
			/* End of saveSession()  */
		})
		.catch(function(error) {
			console.log('Errore nella gestione db!')
			console.log(error)
		})
	})
}
