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
, z = require('zero-fill')
, cliff = require('cliff')
, output = require('../lib/output')
, objectifySelector = require('../lib/objectify-selector')
, engineFactory = require('../lib/quantum-engine')
, collectionService = require('../lib/services/collection-service')
// , { formatAsset, formatPercent, formatCurrency } = require('../lib/format')
, { formatAsset, formatPercent, formatCurrency } = require('../lib/format')
, debug = require('../lib/debug')
, sizeof = require('object-sizeof')
, async = require('async')

//Per eseguire comandi da bash
//var sys = require('util')
var exec = require('child_process').exec
//function execs(cmd, puts, cb) {
//exec(cmd, puts)
//return cb()
//}
//function puts(error, stdout, stderr) { console.log(stdout) }
function puts(error, stdout) { console.log(stdout) }

module.exports = function (program, conf) {
	program
	.command('quantum-trade [selector]')
	.allowUnknownOption()
	.description('run trading bot against live market data with Quantum feature')
	.option('--conf <path>', 'path to optional conf overrides file')
	.option('--strategy <name>', 'strategy to use', String, conf.strategy)
	.option('--order_type <type>', 'order type to use (maker/taker)', /^(maker|taker)$/i, conf.order_type)
	.option('--paper', 'use paper trading mode (no real trades will take place)', Boolean, false)
	.option('--manual', 'watch price and account balance, but do not perform trades automatically', Boolean, false)
	.option('--non_interactive', 'disable keyboard inputs to the bot', Boolean, false)
	.option('--filename <filename>', 'filename for the result output (ex: result.html). "none" to disable', String, conf.filename)
    .option('--currency_capital <amount>', 'for paper trading, amount of start capital in currency. For live trading, amount of new starting capital in currency.', Number, conf.currency_capital)
	.option('--asset_capital <amount>', 'for paper trading, amount of start capital in asset', Number, conf.asset_capital)
	.option('--avg_slippage_pct <pct>', 'avg. amount of slippage to apply to paper trades', Number, conf.avg_slippage_pct)
	.option('--quantum_value <amount>', 'buy up to this amount of currency every time', Number, conf.quantum_value)
	.option('--best_bid', 'mark up as little as possible the buy price to be the best bid', Boolean, false)
	.option('--best_ask', 'mark down as little as possible the sell price to be the best ask', Boolean, false)
	.option('--dump_watchdog', 'check for dumps. Strategy is in charge', Boolean, false)
	.option('--pump_watchdog', 'check for pumps. Strategy is in charge', Boolean, false)
	.option('--buy_calmdown <amount>', 'Minutes to wait before next buy', Number, conf.buy_calmdown)
	.option('--sell_calmdown <amount>', 'Minutes to wait before next sell', Number, conf.sell_calmdown)
	.option('--markdown_buy_pct <pct>', '% to mark down buy price', Number, conf.markdown_buy_pct)
	.option('--markup_sell_pct <pct>', '% to mark up sell price', Number, conf.markup_sell_pct)
	.option('--buy_price_limit <amount>', 'Limit buy to be under <amount>', Number, conf.buy_price_limit)
	.option('--sell_price_limit <amount>', 'Limit sell to be above <amount>', Number, conf.sell_price_limit)
	.option('--catch_order_pct <pct>', '% for catch orders', Number, conf.catch_order_pct)
	.option('--catch_manual_pct <pct>', '% for manual catch orders', Number, conf.catch_manual_pct)
	.option('--catch_fixed_value <amount>', 'value for manual catch orders', Number, conf.catch_fixed_value)
	.option('--order_adjust_time <ms>', 'adjust bid/ask on this interval to keep orders competitive', Number, conf.order_adjust_time)
	.option('--order_poll_time <ms>', 'poll order status on this interval', Number, conf.order_poll_time)
	.option('--sell_stop_pct <pct>', 'sell if price drops below this % of bought price', Number, conf.sell_stop_pct)
	.option('--buy_stop_pct <pct>', 'buy if price surges above this % of sold price', Number, conf.buy_stop_pct)
	.option('--sell_gain_pct <pct>', 'sell with this gain (min profit in long positions))', conf.sell_gain_pct)
	.option('--buy_gain_pct <pct>', 'buy with this gain (min profit in short positions)', conf.buy_gain_pct)
	.option('--profit_stop_enable_pct <pct>', 'enable trailing sell stop when reaching this % profit', Number, conf.profit_stop_enable_pct)
	.option('--profit_stop_pct <pct>', 'maintain a trailing stop this % below the high-water mark of profit', Number, conf.profit_stop_pct)
	.option('--max_slippage_pct <pct>', 'avoid selling at a slippage pct above this float', conf.max_slippage_pct)
	.option('--rsi_periods <periods>', 'number of periods to calculate RSI at', Number, conf.rsi_periods)
	.option('--poll_trades <ms>', 'poll new trades at this interval in ms', Number, conf.poll_trades)
	.option('--currency_increment <amount>', 'Currency increment, if different than the asset increment', String, null)
	.option('--keep_lookback_periods <amount>', 'Keep this many lookback periods max. ', Number, conf.keep_lookback_periods)
	.option('--use_prev_trades', 'load and use previous trades for stop-order triggers and loss protection') //da togliere
	.option('--min_prev_trades <number>', 'minimum number of previous trades to load if use_prev_trades is enabled, set to 0 to disable and use trade time instead', Number, conf.min_prev_trades) //da togliere
	.option('--disable_stats', 'disable printing order stats')
	.option('--reset', 'reset previous positions and start new profit calculation from 0')
	.option('--use_fee_asset', 'Using separated asset to pay for fees. Such as binance\'s BNB or Huobi\'s HT', Boolean, false)
	.option('--run_for <minutes>', 'Execute for a period of minutes then exit with status 0', String, conf.run_for)
	.option('--update_msg <hours>', 'Send an update message every <hours>', String, conf.update_msg)
	.option('--debug', 'output detailed debug info')
	.option('--no_first_message', 'no first update message', Boolean, false)
	.action(function (selector, cmd) {
		var raw_opts = minimist(process.argv)
		var s = {options: JSON.parse(JSON.stringify(raw_opts))}
		var so = s.options

		//Se è stata impostata la funzione per il tempo di esecuzione, fissa il tempo di partenza
		if (so.run_for) {
			debug.msg('Run_for option = ', so.run_for)
			var botStartTime = moment().add(so.run_for, 'm')
		}

		//Dovrebbe cancellare tutte le opzioni passate a riga di comando senza denominazione
		// (minimist mette queste opzioni dentro un array chiamato _) 
		delete so._

		//Punto controverso. Le opzioni dovrebbero essere già sovrascritte dal file --conf (vedi boot.js)
		// Perchè questa nuova sovrascrittura? cmd.conf dovrebbe essere il file passato con --conf
		if (cmd.conf) {
			var overrides = require(path.resolve(process.cwd(), cmd.conf))
			Object.keys(overrides).forEach(function (k) {
				//console.log('overrides k=' + k + ' - ' + overrides[k])
				so[k] = overrides[k]
			})
		}

		//Da capire bene a cosa serve. conf sono le opzioni passate a quantum-trade, quindi zenbot.conf, quindi l'unione
		// delle opzioni conf_file, conf.js e conf-sample.js
		Object.keys(conf).forEach(function (k) {
			if (typeof cmd[k] !== 'undefined') {
				//console.log('cmd k=' + k + ' - ' + cmd[k])
				so[k] = cmd[k]
			}
		})

		//Punto controverso. A quanto sembra, tutte le opzioni passate in command line sono messe in so=s.options (riga 83-85).
		// Dopodiché, vengono sovrascritte dal file --conf (riga 99-104).
		//Quindi vengono prese tutte le opzioni passate a quantum-trade (quindi zenbot.conf da zenbot.js, quindi l'unione di 
		// conf_file, conf.js e conf-sample.js) e vengono reinserite in so.
		// Infine, con le righe seguenti, alcune opzioni di so vengono nuovamente riscritte dalle opzioni passate in riga di comando.
		so.currency_increment = cmd.currency_increment
		so.keep_lookback_periods = cmd.keep_lookback_periods
		so.use_prev_trades = (cmd.use_prev_trades||conf.use_prev_trades)
		so.min_prev_trades = cmd.min_prev_trades
		so.debug = cmd.debug
		so.stats = !cmd.disable_stats
		so.mode = so.paper ? 'paper' : 'live'
		
		//debug.msg('updateMsg=' + so.update_msg)
		if (so.update_msg) {
//			var nextUpdateMsg = moment().add(so.update_msg, 'h')
			var nextUpdateMsg = moment().startOf('day').add(8, 'h')
			
			while (nextUpdateMsg < moment()) {
				nextUpdateMsg = nextUpdateMsg.add(so.update_msg, 'h')
//				debug.msg('nextUpdateMsg=' + nextUpdateMsg)
			}
			
			if (!so.no_first_message) {
				nextUpdateMsg = nextUpdateMsg.subtract(so.update_msg, 'h')
//				debug.msg('First message on. nextUpdateMsg=' + nextUpdateMsg)
			}
		}

		if (!so.min_periods) so.min_periods = 301

		so.selector = objectifySelector(selector || conf.selector)

		//Quindi engine è quantum-engine(s, conf), dove conf è zenbot.conf da zenbot.js, quindi l'unione 
		// di conf_file, conf.js e conf-sample.js e NON s.options
		var engine = engineFactory(s, conf)
		var collectionServiceInstance = collectionService(conf)

		var modeCommand = 0
		const modeMap = new Map()
		modeMap.set(0, 'NULL')
		modeMap.set(1, 'MARKET')
		modeMap.set(2, 'CATCH')
		modeMap.set(3, 'EXCHANGE')
		modeMap.set(4, 'POSITIONS')
		modeMap.set(5, 'LIMITS')
		modeMap.set(6, 'OPTIONS')
		
		const keyMap = new Map()
		s.exchange_orders_index = null
		s.positions_index = null
		
		function changeModeCommand(mode = 0) {
//			debug.msg('changeModeCommand')
			modeCommand = mode
			
			keyMap.clear()

			keyMap.set('0', {desc: ('Modo '.grey + 'NULL'.yellow),		action: function() { changeModeCommand(0)}})
			keyMap.set('1', {desc: ('Modo '.grey + 'MARKET'.yellow),	action: function() { changeModeCommand(1)}})
			keyMap.set('2', {desc: ('Modo '.grey + 'CATCH'.yellow), 	action: function() { changeModeCommand(2)}})
			keyMap.set('3', {desc: ('Modo '.grey + 'EXCHANGE'.yellow), 	action:	function() { changeModeCommand(3)}})
			keyMap.set('4', {desc: ('Modo '.grey + 'POSITIONS'.yellow),	action:	function() { changeModeCommand(4)}})
			keyMap.set('5', {desc: ('Modo '.grey + 'LIMITS'.yellow), 	action: function() { changeModeCommand(5)}})
			keyMap.set('6', {desc: ('Modo '.grey + 'OPTIONS'.yellow), 	action: function() { changeModeCommand(6)}})

			keyMap.set('l', {desc: ('list available commands'.grey), 	action: function() { listKeys()}})

			keyMap.set('m', {desc: ('toggle MANUAL trade in LIVE mode ON / OFF'.grey), action: function() {
				if (so.mode === 'live') {
					so.manual = !so.manual
					console.log('\nMANUAL trade in LIVE mode: ' + (so.manual ? 'ON'.green.inverse : 'OFF'.red.inverse))
				}
			}})
			keyMap.set('x', {desc: ('print statistical output'.grey), action: function() { printTrade(false)}})
			keyMap.set('P', {desc: ('list positions opened'.grey), action: function() {
				console.log('\nListing positions opened...'.grey)
				debug.printPosition(s.positions, true)
			}})
			keyMap.set('O', {desc: ('list orders opened'.grey), action: function() {
				console.log('\nListing orders opened...'.grey)
				debug.printPosition(s.orders, true)
			}})
			keyMap.set('Q', {desc: ('exit program with statistical output'.grey), action: function() {
				console.log('\nExiting... ' + '\nCanceling ALL orders...'.grey)
				so.manual = true
				engine.orderStatus(undefined, undefined, undefined, undefined, 'Free')								
				setTimeout(function() { 
					console.log('\nExiting... ' + '\nWriting statistics...'.grey)
					printTrade(true)
				}, so.order_poll_time*5)		
			}})
			keyMap.set('R', {desc: ('try to recover MongoDB connection'.grey), 	action: function() { 
				console.log('\nTrying to recover MongoDB connection...'.grey)
				recoverMongoDB()
			}})
			keyMap.set('K', {desc: ('clean MongoDB databases (delete data older than 30 days)'.grey), action: function() { 
				console.log('\nCleaning MongoDB databases...'.grey)
				cleanMongoDB()
			}})

			switch (mode) {
			case 0: {
				break
			}
			case 1: {
				//Modo MARKET		
				keyMap.set('b', {desc: ('limit'.grey + ' BUY'.green), action: function() {
					console.log('\nmanual'.grey + ' limit ' + 'BUY'.green + ' command inserted'.grey)
					engine.emitSignal('manual', 'buy')						
				}})
				keyMap.set('B', {desc: ('market'.grey + ' BUY'.green), action: function() {
					console.log('\nmanual'.grey + ' market ' + 'BUY'.green + ' command inserted'.grey)
					engine.emitSignal('manual', 'buy', null, null, null, false, true)
				}})
				keyMap.set('s', {desc: ('limit'.grey + ' SELL'.red), action: function() {
					console.log('\nmanual'.grey + ' limit ' + 'SELL'.red + ' command inserted'.grey)
					engine.emitSignal('manual', 'sell')												 
				}})
				keyMap.set('S', {desc: ('market'.grey + ' SELL'.red), action: function() {
					console.log('\nmanual'.grey + ' market ' + 'SELL'.red + ' command inserted'.grey)
					engine.emitSignal('manual', 'sell', null, null, null, false, true)		
				}})
				keyMap.set('c', {desc: ('cancel manual orders'.grey), action: function() {
					engine.orderStatus(undefined, undefined, 'manual', undefined, 'Unset', 'manual')
					console.log('\nmanual'.grey + ' orders cancel' + ' command executed'.grey)
				}})
				keyMap.set('C', {desc: ('cancel ALL order'.grey), action: function() {
					console.log('\nmanual'.grey + ' canceling ALL orders')
					engine.orderStatus(undefined, undefined, undefined, undefined, 'Free')
				}})
				keyMap.set('M', {desc: ('switch between \'Maker\' and \'Taker\' order type'.grey), action: function() {
					(so.order_type === 'maker' ? so.order_type = 'taker' : so.order_type = 'maker')
					console.log('\n' + so.order_type.toUpperCase() + ' fees activated'.black.bgGreen)
				}})
				break
			}
			case 2: {
				//Modo CATCH
				keyMap.set('b', {desc: ('manual catch order'.grey + ' BUY'.green), action: function() {
					console.log('\nmanual'.grey + ' catch ' + 'BUY'.green + ' command inserted'.grey)
					var target_price = n(s.quote.bid).multiply(1 - so.catch_manual_pct/100).format(s.product.increment, Math.floor)
					var target_size = n(so.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					engine.emitSignal('manual', 'buy', null, target_size, target_price)
				}})
				keyMap.set('s', {desc: ('manual catch order'.grey + ' SELL'.red), action: function() {
					console.log('\nmanual'.grey + ' catch ' + 'SELL'.red + ' command inserted'.grey)
					var target_price = n(s.quote.ask).multiply(1 + so.catch_manual_pct/100).format(s.product.increment, Math.floor)
					var target_size = n(so.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					engine.emitSignal('manual', 'sell', null, target_size, target_price)	
				}})
				keyMap.set('+', {desc: ('manual catch pct'.grey + ' INCREASE'.green), action: function() {
					so.catch_manual_pct++
					console.log('\n' + 'Manual catch order pct ' + 'INCREASE'.green + ' -> ' + so.catch_manual_pct)	
				}})
				keyMap.set('-', {desc: ('manual catch pct'.grey + ' DECREASE'.red), action: function() {
					so.catch_manual_pct--
					console.log('\n' + 'Manual catch order pct ' + 'DECREASE'.red + ' -> ' + so.catch_manual_pct)
				}})
				keyMap.set('*', {desc: ('manual catch value'.grey + ' INCREASE'.green), action: function() {
					so.catch_fixed_value += so.quantum_value
					console.log('\n' + 'Manual catch order value ' + 'INCREASE'.green + ' -> ' + so.catch_fixed_value)	
				}})
				keyMap.set('_', {desc: ('manual catch value'.grey + ' DECREASE'.red), action: function() {
					so.catch_fixed_value -= so.quantum_value
					if (so.catch_fixed_value < so.quantum_value) {
						so.catch_fixed_value = so.quantum_value
					}
					console.log('\n' + 'Manual catch order value ' + 'DECREASE'.red + ' -> ' + so.catch_fixed_value)
				}})
				keyMap.set('q', {desc: ('catch order pct'.grey + ' INCREASE'.green), action: function() {
					so.catch_order_pct++
					console.log('\n' + 'Catch order pct ' + 'INCREASE'.green + ' -> ' + so.catch_order_pct)	
				}})
				keyMap.set('a', {desc: ('catch order pct'.grey + ' DECREASE'.red), action: function() {
					so.catch_order_pct--
					console.log('\n' + 'Catch order pct ' + 'DECREASE'.red + ' -> ' + so.catch_order_pct)
				}})
				keyMap.set('C', {desc: ('cancel all manual catch orders'.grey), action: function() {
					console.log('\nmanual'.grey + ' canceling ALL catch orders')
					engine.orderStatus(undefined, undefined, 'manual', undefined, 'Unset', 'manual')
				}})
				keyMap.set('A', {desc: ('insert catch order for all free position'.grey), action: function() {
					console.log('\n' + 'Insert catch order for all free positions'.grey)
					s.positions.forEach(function (position, index) {
						engine.emitSignal('orderExecuted', position.side, 'manual', position.id)
					})	
				}})
				break
			}
			case 3: {
				//Modo EXCHANGE
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
					console.log('No position opened.')
					break
				}
				
				keyMap.set('+', {desc: ('set position'.grey + ' NEXT'.yellow), action: function() {
					if (s.positions.length) {
						s.positions_index++
						if (s.positions_index > (s.positions.length - 1)) {
							s.positions_index = 0
						}
						console.log('\nPosition in control:'.yellow)
						console.log(s.positions[s.positions_index].id)
					}
					else {
						console.log('No position opened.')
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
						console.log('No position opened.')
					}
				}})
				keyMap.set('i', {desc: ('get information on the position'.grey), action: function() {
					if (s.positions_index != null) {
						console.log('\nInformation on position: '.yellow + s.positions[s.positions_index].id)
						console.log(s.positions[s.positions_index])
					}
					else {
						console.log('No position in control.')
					}
				}})
				keyMap.set('K', {desc: ('set a manual close catch order on the position'.grey), action: function() {
					if (s.positions_index != null) {
						if (s.positions[s.positions_index].side === 'buy') {
							console.log('\nSet a manual close catch SELL order on the position: '.yellow + s.positions[s.positions_index].id)
							var target_price = n(s.quote.ask).multiply(1 + so.catch_manual_pct/100).format(s.product.increment, Math.floor)
							engine.emitSignal('manual', 'sell', s.positions[s.positions_index].id, null, target_price)
						}
						else {
							console.log('\nSet a manual close catch BUY order on the position: '.yellow + s.positions[s.positions_index].id)
							var target_price = n(s.quote.bid).multiply(1 - so.catch_manual_pct/100).format(s.product.increment, Math.floor)
							engine.emitSignal('manual', 'buy', s.positions[s.positions_index].id, null, target_price)
						}
					}
					else {
						console.log('No position in control.')
					}
				}})
				keyMap.set('F', {desc: ('Free the position (cancel ALL orders connected to the position and let it be used)'.grey), action: function() {
					if (s.positions_index != null) {
						console.log('\nFreeing the position (cancelling all orders connected with the position) '.yellow + s.positions[s.positions_index].id)
						engine.positionStatus(s.positions[s.positions_index], 'Free')
						s.positions[s.positions_index].locked = false
					}
					else {
						console.log('No position in control.')
					}
				}})
				keyMap.set('L', {desc: ('Lock the position (does not cancel orders connected to the position)'.grey), action: function() {
					if (s.positions_index != null) {
						console.log('\nLocking the position '.yellow + s.positions[s.positions_index].id)
						s.positions[s.positions_index].locked = true
					}
					else {
						console.log('No position in control.')
					}
				}})
				keyMap.set('U', {desc: ('Unlock the position (does not cancel orders connected to the position)'.grey), action: function() {
					if (s.positions_index != null) {
						console.log('\nUnlocking the position '.yellow + s.positions[s.positions_index].id)
						s.positions[s.positions_index].locked = false
					}
					else {
						console.log('No position in control.')
					}
				}})
				keyMap.set('c', {desc: ('cancel ALL orders connected to the position, without let it free'.grey), action: function() {
					if (s.positions_index != null) {
						console.log('\nCanceling all orders connected with the position '.yellow + s.positions[s.positions_index].id)
//						status_tmp = ~(s.positions[s.positions_index].status & engine.orderFlag.locked)
//						engine.positionStatus(s.positions[s.positions_index], 'Unset', status_tmp)
						engine.positionStatus(s.positions[s.positions_index], 'Free')
					}
					else {
						console.log('No position in control.')
					}
				}})
				keyMap.set('C', {desc: ('cancel the position'.grey), action: function() {
					if (s.positions_index != null) {
						console.log('\nCanceling the position '.yellow + s.positions[s.positions_index].id)

						engine.positionStatus(s.positions[s.positions_index], 'Free')
						setTimeout(function() {
							s.positionProcessingQueue.push({mode: 'delete', id: s.positions[s.positions_index].id})
							s.positions_index = null
							s.positions.splice(s.positions_index,1)
						}, so.order_poll_time)
					}
					else {
						console.log('No position in control.')
					}
				}})
				break
			}
			case 5: {
				//Modo LIMITS
				keyMap.set('q', {desc: ('Buy price limit'.grey + ' INCREASE'.green), action: function() {
					if (!so.buy_price_limit) {
						so.buy_price_limit = Number(s.quote.bid)
					}
					so.buy_price_limit += 25
					console.log('\n' + 'Buy price limit' + ' INCREASE'.green + ' -> ' + so.buy_price_limit)	
				}})
				keyMap.set('a', {desc: ('Buy price limit'.grey + ' DECREASE'.red), action: function() {
					if (!so.buy_price_limit) {
						so.buy_price_limit = Number(s.quote.bid)
					}
					so.buy_price_limit -= 25
					console.log('\n' + 'Buy price limit' + ' DECREASE'.red + ' -> ' + so.buy_price_limit)	
				}})
				keyMap.set('w', {desc: ('Sell price limit'.grey + ' INCREASE'.green), action: function() {
					if (!so.sell_price_limit) {
						so.sell_price_limit = Number(s.quote.ask)
					}
					so.sell_price_limit += 25
					console.log('\n' + 'Sell price limit' + ' INCREASE'.green + ' -> ' + so.sell_price_limit)	
				}})
				keyMap.set('s', {desc: ('Sell price limit'.grey + ' DECREASE'.red), action: function() {
					if (!so.sell_price_limit) {
						so.sell_price_limit = Number(s.quote.ask)
					}
					so.sell_price_limit -= 25
					console.log('\n' + 'Sell price limit' + ' DECREASE'.red + ' -> ' + so.sell_price_limit)	
				}})
//				keyMap.set('e', {desc: ('Buy stop pct (buy if price go over)'.grey + ' INCREASE'.green), action: function() {
//					so.buy_stop_pct++
//					console.log('\n' + 'Buy stop pct' + 'INCREASE'.green + ' -> ' + so.buy_stop_pct)	
//				}})
//				keyMap.set('d', {desc: ('Buy stop pct (buy if price go over)'.grey + ' DECREASE'.red), action: function() {
//					so.buy_stop_pct--
//					console.log('\n' + 'Buy stop pct ' + 'DECREASE'.red + ' -> ' + so.buy_stop_pct)	
//				}})
//				keyMap.set('r', {desc: ('Sell stop pct (sell is price go under)'.grey + ' INCREASE'.green), action: function() {
//					so.sell_stop_pct++
//					console.log('\n' + 'Sell stop pct ' + 'INCREASE'.green + ' -> ' + so.sell_price_limit)	
//				}})
//				keyMap.set('f', {desc: ('Sell stop pct (sell if price go under)'.grey + ' DECREASE'.red), action: function() {
//					so.sell_stop_pct--
//					console.log('\n' + 'Sell stop pct ' + 'DECREASE'.red + ' -> ' + so.sell_price_limit)	
//				}})
				keyMap.set('t', {desc: ('Profit stop enable pct'.grey + ' INCREASE'.green), action: function() {
					so.profit_stop_enable_pct = Number((so.profit_stop_enable_pct + 0.1).toFixed(2))
					console.log('\n' + 'Profit stop enable pct' + ' INCREASE'.green + ' -> ' + so.profit_stop_enable_pct)	
				}})
				keyMap.set('g', {desc: ('Profit stop enable pct'.grey + ' DECREASE'.red), action: function() {
					so.profit_stop_enable_pct = Number((so.profit_stop_enable_pct - 0.1).toFixed(2))
					if (so.profit_stop_enable_pct <= 0) {
						so.profit_stop_enable_pct= null
					}
					console.log('\n' + 'Profit stop enable pct' + ' DECREASE'.red + ' -> ' + so.profit_stop_enable_pct)	
				}})
				keyMap.set('y', {desc: ('Profit stop pct'.grey + ' INCREASE'.green), action: function() {
					so.profit_stop_pct = Number((so.profit_stop_pct + 0.05).toFixed(2))
					console.log('\n' + 'Profit stop pct' + ' INCREASE'.green + ' -> ' + so.profit_stop_pct)	
				}})
				keyMap.set('h', {desc: ('Profit stop pct'.grey + ' DECREASE'.red), action: function() {
					so.profit_stop_pct = Number((so.profit_stop_pct - 0.05).toFixed(2))
					if (so.profit_stop_pct <= 0) {
						so.profit_stop_pct= 0
					}
					console.log('\n' + 'Profit stop pct' + ' DECREASE'.red + ' -> ' + so.profit_stop_pct)	
				}})
				keyMap.set('u', {desc: ('Sell gain pct (min profit in long position)'.grey + ' INCREASE'.green), action: function() {
					so.sell_gain_pct = Number((so.sell_gain_pct + 0.05).toFixed(2))
					console.log('\n' + 'Sell gain pct' + ' INCREASE'.green + ' -> ' + so.sell_gain_pct)	
				}})
				keyMap.set('j', {desc: ('Sell gain pct (min profit in long position)'.grey + ' DECREASE'.red), action: function() {
					so.sell_gain_pct = Number((so.sell_gain_pct - 0.05).toFixed(2))
					console.log('\n' + 'Max sell loss pct' + ' DECREASE'.red + ' -> ' + so.sell_gain_pct)	
				}})
				keyMap.set('i', {desc: ('Buy gain pct (min profit in short position)'.grey + ' INCREASE'.green), action: function() {
					so.buy_gain_pct = Number((so.buy_gain_pct + 0.05).toFixed(2))
					console.log('\n' + 'Buy gain pct' + ' INCREASE'.green + ' -> ' + so.buy_gain_pct)	
				}})
				keyMap.set('k', {desc: ('Buy gain pct (min profit in short position)'.grey + ' DECREASE'.red), action: function() {
					so.buy_gain_pct = Number((so.buy_gain_pct - 0.05).toFixed(2))
					console.log('\n' + 'Buy gain pct' + ' DECREASE'.red + ' -> ' + so.buy_gain_pct)	
				}})	
				keyMap.set('o', {desc: ('Actual values for limits'.grey), action: function() {
					actual_values = '\nActual values for limits:'
					actual_values += '\n-------------------------' 
					actual_values += '\nBuy price limit= ' + so.buy_price_limit
					actual_values += '\nSell price limit= ' + so.sell_price_limit
					actual_values += '\nProfit stop enable pct= ' + so.profit_stop_enable_pct
					actual_values += '\nProfit stop pct= ' + so.profit_stop_pct
					actual_values += '\nSell gain pct= ' + so.sell_gain_pct
					actual_values += '\nBuy gain pct= ' + so.buy_gain_pct
					
					console.log(actual_values)	
				}})
				break
			}
			case 6: {
				//Modo OPTIONS
				keyMap.set('o', {desc: ('show current trade options'.grey), action: function() { listOptions ()}})
				keyMap.set('a', {desc: ('show current trade options in a dirty view (full list)'.grey), action: function() {
					let so_tmp = JSON.parse(JSON.stringify(so))
					delete so_tmp.strategy
					console.log('\n' + cliff.inspect(so_tmp))

					Object.keys(so.strategy).forEach(function (strategy_name, index) {
						console.log('\n' + strategy_name + '\n' + cliff.inspect(so.strategy[strategy_name].opts))
					})					
				}})
				keyMap.set('D', {desc: ('toggle DEBUG'.grey), action: function() {
					debug.flip()
					console.log('\nDEBUG mode: ' + (debug.on ? 'ON'.green.inverse : 'OFF'.red.inverse))
				}})
				keyMap.set('w', {desc: ('toggle Dump Watchdog'.grey), action: function() {
					so.dump_watchdog = !so.dump_watchdog
					s.is_dump_watchdog = so.dump_watchdog
					console.log('\nToggle Dump Watchdog: ' + (so.dump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
				}})
				keyMap.set('W', {desc: ('toggle Pump Watchdog'.grey), action: function() {
					so.pump_watchdog = !so.pump_watchdog
					s.is_pump_watchdog = so.pump_watchdog
					console.log('\nToggle Pump Watchdog: ' + (so.pump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
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
				keyMap.set('H', {desc: ('toggle automatic HTML dump to file'.grey), action: function() {
					console.log('\nDumping statistics...'.grey)
					toggleStats()
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

		/* Trying to recover MongoDB connection */
		function recoverMongoDB() {
			s.db_valid = false
			exec('sudo rm /var/lib/mongodb/mongod.lock', puts)
			exec('sudo mongod --repair', puts)
			exec('sudo service mongodb start', puts)
			exec('sudo service mongodb status', puts)

			setTimeout(function() {
				debug.msg('Recupero la connessione...')
				var authStr = '', authMechanism, connectionString

				if(so.mongo.username){
					authStr = encodeURIComponent(so.mongo.username)

					if(so.mongo.password) authStr += ':' + encodeURIComponent(so.mongo.password)

					authStr += '@'

					// authMechanism could be a conf.js parameter to support more mongodb authentication methods
					authMechanism = so.mongo.authMechanism || 'DEFAULT'
				}

				if (so.mongo.connectionString) {
					connectionString = so.mongo.connectionString
				} else {
					connectionString = 'mongodb://' + authStr + so.mongo.host + ':' + so.mongo.port + '/' + so.mongo.db + '?' +
					(so.mongo.replicaSet ? '&replicaSet=' + so.mongo.replicaSet : '' ) +
					(authMechanism ? '&authMechanism=' + authMechanism : '' )
				}

				//Corretto per il Deprecation Warning
				require('mongodb').MongoClient.connect(connectionString, { useNewUrlParser: true }, function (err, client) {
					if (err) {
						console.error('WARNING: MongoDB Connection Error: ', err)
						console.error('WARNING: without MongoDB some features (such as backfilling/simulation) may be disabled.')
						console.error('Attempted authentication string: ' + connectionString)
						//	      		cb(null)
						//      		return
					}
					var db = client.db(so.mongo.db)
					//conf.db = {mongo: db}
					conf.db.mongo = db
					//console.log('\n' + cliff.inspect(so))
					//    		cb(null)

					//Recupera tutti i vecchi database
					collectionServiceInstance = collectionService(conf)
					my_trades = collectionServiceInstance.getMyTrades()
					my_positions = collectionServiceInstance.getMyPositions()
					periods = collectionServiceInstance.getPeriods()
					sessions = collectionServiceInstance.getSessions()
					balances = collectionServiceInstance.getBalances()
					trades = collectionServiceInstance.getTrades()
					resume_markers = collectionServiceInstance.getResumeMarkers()
					debug.msg(' fatto! Ricreo my_positions...', false)

					//Corretto il Deprecation Warning
					my_positions.drop()
					s.positions.forEach(function (position) {
						//Corretto il Deprecation Warning
						my_positions.insertOne(position, function (err) {
							if (err) {
								console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving my_position')
								console.error(err)
							}
						})
					})
					debug.msg(' fatto!', false)
				})
			}, 10000)
			s.db_valid = true
		}

		
		/* To clean MongoDB databases */
		function cleanMongoDB() {
//			periods = collectionServiceInstance.getPeriods()
//			trades = collectionServiceInstance.getTrades()
			
			fromTime = n(moment().subtract(so.mongo.tot_days, 'd')).value()
			
			debug.msg('cleanMongoBD - Pulisco i db più vecchi di ' + fromTime + ' (ora è ' + moment() + ')... ')
			
			periods.deleteMany({"time" : { $lt : fromTime }}, function (err, obj) {
				if (err) {
					console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - cleanMongoDB - error cleaning db.periods')
					console.error(err)
				}
				debug.msg('cleanMongoDB - ' + obj.result.n + " period(s) deleted")
			})
			
			trades.deleteMany({"time" : { $lt : fromTime }}, function (err, obj) {
				if (err) {
					console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - cleanMongoDB - error cleaning db.trades')
					console.error(err)
				}
				debug.msg('cleanMongoDB - ' + obj.result.n + " trade(s) deleted");
			})
		}
		
		/* Funzioni per le operazioni sul databse Mongo DB delle posizioni */
		s.positionProcessingQueue = async.queue(function(task, callback) {
			managePositionCollection(task.mode, task.id, callback)
		})
		
		// Assegna una funzione di uscita
		s.positionProcessingQueue.drain = function() {
			debug.msg('s.positionProcessingQueue - All items have been processed')
		};
		
		function managePositionCollection (mode, position_id, cb = function () {}) {
			switch (mode) {
			case 'update': {
				position = s.positions.find(x => x.id === position_id)
				position._id = position.id

				if (s.db_valid) {
					my_positions.updateOne({"_id" : position_id}, {$set: position}, {upsert: true}, function (err) {
//						s.update_position_id = null
						if (err) {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - quantum-trade - MongoDB - error saving in my_positions')
							console.error(err)
							return cb(err)
						}
					})
				}
				break
			}
			case 'delete': {
				if (s.db_valid) {
					my_positions.deleteOne({"_id" : position_id}, function (err) {
//						s.delete_position_id = null
						if (err) {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - quantum-trade - MongoDB - error deleting in my_positions')
							console.error(err)
							return cb(err)
						}
					})
				}
				break
			}
			}
			return cb(null)
		}
		/* End funzioni per le operazioni sul database Mongo DB delle posizioni */ 
		
		/* To list options*/
		function listOptions () {
			console.log('\n' + s.exchange.name.toUpperCase() + ' exchange active trading options:'.grey + '\n')
			
			Object.keys(so.strategy).forEach(function (strategy_name, index) {
				process.stdout.write(z(22, 'STRATEGY'.grey, ' ') + '\t' + strategy_name + '\t' + (require(`../extensions/strategies/${strategy_name}/strategy`).description).grey)
				
				let opts_name = ''
				let opts_value = ''
				Object.keys(so.strategy[strategy_name].opts).forEach(function (key, index) {
					opts_name += z((key.length + 3), key, ' ')
					opts_value += z((key.length + 3), so.strategy[strategy_name].opts[key], ' ')
				})
				process.stdout.write('\n' + opts_name.grey)
				process.stdout.write('\n' + opts_value + '\n\n')
			})
			
			process.stdout.write([
				z(25, so.mode.toUpperCase() + ' MODE'.grey, ' '),
				z(25, 'PERIOD LENGTH'.grey, ' '),
				z(25, 'ORDER TYPE'.grey, ' '),
				z(25, 'SLIPPAGE'.grey, ' '),
				z(30, 'EXCHANGE FEES'.grey, ' ')
				].join('') + '\n');

			process.stdout.write([
				z(15, (so.mode === 'paper' ? '      ' : (so.mode === 'live' && (so.manual === false || typeof so.manual === 'undefined')) ? '        ' + 'AUTO'.black.bgRed + '   ' : '       ' + 'MANUAL'.black.bgGreen + '  '), ' '),
				z(10, so.period_length, ' '),
				z(26, (so.order_type === 'maker' ? so.order_type.toUpperCase().green : so.order_type.toUpperCase().red), ' '),
				z(28, (so.mode === 'paper' ? 'avg. '.grey + so.avg_slippage_pct + '%' : 'max '.grey + so.max_slippage_pct + '%'), ' '),
				z(17, (so.order_type === 'maker' ? so.order_type + ' ' + n(s.exchange.makerFee).format('0.0000%')  : so.order_type + ' ' + s.exchange.takerFee), ' ')
				].join('') + '\n\n');

			process.stdout.write('')
			
			process.stdout.write([
			z(30, 'TRAILING STOP %'.grey, ' '),
			z(34, 'TRAILING DISTANCE %'.grey, ' '),
			z(35, 'DUMP / PUMP WATCHDOG'.grey, ' '),
			z(36, 'LONG / SHORT POSITION'.grey, ' ')
			].join('') + '\n')
			
			process.stdout.write([
				z(12, so.profit_stop_enable_pct + '%', ' '),
				z(24, so.profit_stop_pct + '%', ' '),
				z(20, so.dump_watchdog, ' '),
				z(8, so.pump_watchdog, ' '),
				z(16, so.active_long_position, ' '),
				z(8, so.active_short_position, ' ')
				].join('') + '\n\n')
			process.stdout.write('')
			process.stdout.write([
			z(37, 'BUY / SELL STOP LOSS %'.grey, ' '),
			z(35, 'CATCH ORDER DEFAULT %'.grey, ' '),
			z(33, 'CATCH ORDER MANUAL %'.grey, ' '),
			z(30, 'CATCH FIXED VALUE'.grey, ' '),
			].join('') + '\n')
			process.stdout.write([
				z(9, (so.buy_stop_pct || '--') + '%', ' '),
				z(6, (so.sell_stop_pct || '--') + '%', ' '),
				z(25, so.catch_order_pct + '%', ' '),
				z(23, so.catch_manual_pct + '%', ' '),
				z(25, formatCurrency(so.catch_fixed_value, s.currency), ' '),
				].join('') + '\n\n')
			process.stdout.write('')
		}
		/* End listOptions() */

		/* Implementing statistical Exit */
		function printTrade (quit, dump, statsonly = false) {
			var tmp_balance = n(s.balance.currency).add(n(s.period.close).multiply(s.balance.asset)).format('0.00')
			if (quit) {
				if (s.my_trades.length) {
					s.my_trades.push({
						price: s.period.close,
						size: s.balance.asset,
						side: 'sell',
						time: s.period.time
					})
				}
				s.balance.currency = tmp_balance
				s.balance.asset = 0
				s.lookback.unshift(s.period)
			}
			//        var profit = s.start_capital ? n(tmp_balance).subtract(s.start_capital).divide(s.start_capital) : n(0)
			//        var buy_hold = s.start_price ? n(s.period.close).multiply(n(s.start_capital).divide(s.start_price)) : n(tmp_balance)
			//        var buy_hold_profit = s.start_capital ? n(buy_hold).subtract(s.start_capital).divide(s.start_capital) : n(0)
			var profit = n(tmp_balance).subtract(s.orig_capital).divide(s.orig_capital)
			var buy_hold = n(s.period.close).multiply(n(s.orig_capital).divide(s.orig_price))
			var buy_hold_profit = n(buy_hold).subtract(s.orig_capital).divide(s.orig_capital)
			if (!statsonly) {
				console.log()
				var output_lines = []
				output_lines.push('Starting capital: ' + formatCurrency(s.start_capital, s.currency).yellow)
				output_lines.push('Original capital: ' + formatCurrency(s.orig_capital, s.currency).yellow)
				output_lines.push('Original price: ' + formatCurrency(s.orig_price, s.currency).yellow)
				output_lines.push('Last balance: ' + n(tmp_balance).format('0.00').yellow + ' (' + profit.format('0.00%') + ')')
				output_lines.push('Balance: ' + formatCurrency(s.balance.currency, s.currency).yellow + ' ; ' +  formatAsset(s.balance.asset, s.asset).yellow)
				output_lines.push('BuyHold: ' + buy_hold.format('0.00').yellow + ' (' + n(buy_hold_profit).format('0.00%') + ')')
				output_lines.push('vs. BuyHold: ' + n(tmp_balance).subtract(buy_hold).divide(buy_hold).format('0.00%').yellow)
				//output_lines.push((s.my_prev_trades.length ? s.my_trades.length + s.my_prev_trades.length : s.my_trades.length) + ' trades over ' + s.day_count + ' days (avg ' + n(s.my_trades.length / s.day_count).format('0.00') + ' trades/day)')
				output_lines.push(s.my_trades.length + ' trades over ' + s.day_count + ' days (avg ' + n(s.my_trades.length / s.day_count).format('0.00') + ' trades/day)')
				output_lines.push(s.positions.length + ' positions opened.')
				output_lines.push(s.orders.length + ' orders opened.')
				output_lines.push(sizeof(s) + ' size of s')
				output_lines.push(sizeof(s.trades) + ' size of s.trades')
				output_lines.push(sizeof(s.period) + ' size of s.period')
				output_lines.push(sizeof(s.lookback) + ' size of s.lookback')
				Object.keys(so.strategy).forEach(function (strategy_name, index) {
					output_lines.push(sizeof(s.options.strategy[strategy_name].calc_lookback) + ' size of ' + strategy_name + ' calc_lookback')
				})				
				output_lines.push(s.exchange.getMemory() + ' size of websocket_cache in exchange')
			}
			// Build stats for UI
			s.stats = {
				profit: profit.format('0.00%'),
				tmp_balance: n(tmp_balance).format('0.00'),
				buy_hold: buy_hold.format('0.00'),
				buy_hold_profit: n(buy_hold_profit).format('0.00%'),
				day_count: s.day_count,
				trade_per_day: n(s.my_trades.length / s.day_count).format('0.00')
			}

			var losses = 0, gains = 0
			s.my_trades.forEach(function (trade) {
				if (trade.profit) {
					if (trade.profit > 0)
						gains++
					else
						losses++
				}
			})

			if (s.my_prev_trades.length) {
				s.my_prev_trades.forEach(function (trade) {
					if (trade.profit) {
						if (trade.profit > 0)
							gains++
						else
							losses++
					}
				})
			}

			if (s.my_trades.length && gains > 0) {
				if (!statsonly) {
					output_lines.push('win/loss: ' + gains + '/' + losses)
					output_lines.push('error rate: ' + (n(losses).divide(gains + losses).format('0.00%')).yellow)
				}

				//for API
				s.stats.win = gains
				s.stats.losses = losses
				s.stats.error_rate = n(losses).divide(gains + losses).format('0.00%')
			}

			if (!statsonly) {
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
				var tpl = fs.readFileSync(path.resolve(__dirname, '..', 'templates', 'sim_result.html.tpl'), {encoding: 'utf8'})
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


		/* Implementing statistical status dump every 10 secs */
		var shouldSaveStats = false
		function toggleStats() {
			shouldSaveStats = !shouldSaveStats
			if(shouldSaveStats)
				console.log('Auto stats dump enabled')
			else
				console.log('Auto stats dump disabled')
		}

		function saveStatsLoop() {
			saveStats()
			setTimeout(function () {
				saveStatsLoop()
			}, 10000)
		}
		saveStatsLoop()

		function saveStats() {
			if(!shouldSaveStats) return

			var output_lines = []
			var tmp_balance = n(s.balance.currency).add(n(s.period.close).multiply(s.balance.asset)).format('0.00')

			//        var profit = s.start_capital ? n(tmp_balance).subtract(s.start_capital).divide(s.start_capital) : n(0)
			var profit = n(tmp_balance).subtract(s.orig_capital).divide(s.orig_capital)
			output_lines.push('Last balance: ' + formatCurrency(tmp_balance, s.currency).yellow + ' (' + profit.format('0.00%') + ')')
			//        var buy_hold = s.start_price ? n(s.period.close).multiply(n(s.start_capital).divide(s.start_price)) : n(tmp_balance)
			var buy_hold = n(s.period.close).multiply(n(s.orig_capital).divide(s.orig_price))
			//        var buy_hold_profit = s.start_capital ? n(buy_hold).subtract(s.start_capital).divide(s.start_capital) : n(0)
			var buy_hold_profit = n(buy_hold).subtract(s.orig_capital).divide(s.orig_capital)
			output_lines.push('BuyHold: ' + formatCurrency(buy_hold, s.currency).yellow + ' (' + n(buy_hold_profit).format('0.00%') + ')')
			output_lines.push('vs. BuyHold: ' + n(tmp_balance).subtract(buy_hold).divide(buy_hold).format('0.00%').yellow)
			output_lines.push(s.my_trades.length + ' trades over ' + s.day_count + ' days (avg ' + n(s.my_trades.length / s.day_count).format('0.00') + ' trades/day)')
			// Build stats for UI
			s.stats = {
				profit: profit.format('0.00%'),
				tmp_balance: n(tmp_balance).format('0.00000000'),
				buy_hold: buy_hold.format('0.00000000'),
				buy_hold_profit: n(buy_hold_profit).format('0.00%'),
				day_count: s.day_count,
				trade_per_day: n(s.my_trades.length / s.day_count).format('0.00')
			}

			var losses = 0, gains = 0
			s.my_trades.forEach(function (trade) {
				if (trade.profit) {
					if (trade.profit > 0)
						gains++
					else
						losses++
				}
			})

			if (s.my_trades.length && gains > 0) {
				output_lines.push('win/loss: ' + gains + '/' + losses)
				output_lines.push('error rate: ' + (n(losses).divide(gains + losses).format('0.00%')).yellow)

				//for API
				s.stats.win = gains
				s.stats.losses = losses
				s.stats.error_rate = n(losses).divide(gains + losses).format('0.00%')
			}

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
			var tpl = fs.readFileSync(path.resolve(__dirname, '..', 'templates', 'sim_result.html.tpl'), {encoding: 'utf8'})
			var out = tpl
			.replace('{{code}}', code)
			.replace('{{trend_ema_period}}', so.trend_ema || 36)
			.replace('{{output}}', html_output)
			.replace(/\{\{symbol\}\}/g,  so.selector.normalized + ' - zenbot ' + require('../package.json').version)
			if (so.filename !== 'none') {
				var out_target
				var dt = new Date().toISOString()

				//ymd
				var today = dt.slice(2, 4) + dt.slice(5, 7) + dt.slice(8, 10)
				let out_target_prefix = so.paper ? 'simulations/paper_result_' : 'stats/trade_result_'
				out_target = so.filename || out_target_prefix + so.selector.normalized +'_' + today + '_UTC.html'

				fs.writeFileSync(out_target, out)
				//console.log('\nwrote'.grey, out_target)
			}
		}
		/* End of implementing statistical status */


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
		var my_trades = collectionServiceInstance.getMyTrades()
		var my_positions = collectionServiceInstance.getMyPositions()
		var periods = collectionServiceInstance.getPeriods()
		var sessions = collectionServiceInstance.getSessions()
		var balances = collectionServiceInstance.getBalances()
		var trades = collectionServiceInstance.getTrades()
		var resume_markers = collectionServiceInstance.getResumeMarkers()
		s.db_valid = true

		var marker = {
			id: crypto.randomBytes(4).toString('hex'),
			selector: so.selector.normalized,
			from: null,
			to: null,
			oldest_time: null
		}
		marker._id = marker.id
		
		//Se richiesto nel comando, esegue il reset dei database
		if (cmd.reset) {
			//Corretto il Deprecation Warning
			console.log('\nDeleting my_positions collection...')
			my_positions.drop()
			console.log('\nDeleting my_trades collection...')
			my_trades.drop()
			console.log('\nDeleting sessions collection...')
			sessions.drop()
			console.log('\nDeleting balances collection...')
			balances.drop()
		}

		//Recupera tutte le vecchie posizioni aperte e le copia in s.positions
		my_positions.find({selector: so.selector.normalized}).toArray(function (err, my_prev_positions) {
			if (err) throw err
			if (my_prev_positions.length) {
				my_prev_positions.forEach(function (position) {
					position.status = 0
				})
				s.positions = my_prev_positions.slice(0)
			}
		})

		//Per caricare i dati dei trades, chiama zenbot.js backfill (so.selector.normalized) --days __ --conf __
		console.log('fetching pre-roll data:')
		var zenbot_cmd = process.platform === 'win32' ? 'zenbot.bat' : 'zenbot.sh' // Use 'win32' for 64 bit windows too
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
				trades.find(opts.query).limit(opts.limit).sort(opts.sort).toArray(function (err, trades) {
					if (err) throw err
					if (trades.length && so.use_prev_trades) {
						let prevOpts = {
							query: {
								selector: so.selector.normalized
							},
							limit: so.min_prev_trades
						}
						if (!so.min_prev_trades) {
							prevOpts.query.time = {$gte : trades[0].time}
						}
						//Recupera i vecchi my_trades e li mette in s.my_prev_trades
						my_trades.find(prevOpts.query).sort({$natural:-1}).limit(prevOpts.limit).toArray(function (err, my_prev_trades) {
							if (err) throw err
							if (my_prev_trades.length) {
								//console.log('My_prev_trades')
								s.my_prev_trades = my_prev_trades.reverse().slice(0) // simple copy, less recent executed first
							}
						})
					}

					//Una volta stampati i trade vecchi, trades è vuoto, quindi esegue questo blocco
					if (!trades.length) {
						var head = '------------------------------------------ INITIALIZE  OUTPUT ------------------------------------------'
						console.log(head)
						
						//A che diavolo serve?
						output(conf).initializeOutput(s)
						
						var minuses = Math.floor((head.length - so.mode.length - 19) / 2)
						console.log('-'.repeat(minuses) + ' STARTING ' + so.mode.toUpperCase() + ' TRADING ' + '-'.repeat(minuses + (minuses % 2 == 0 ? 0 : 1)))
						if (so.mode === 'paper') {
							console.log('!!! Paper mode enabled. No real trades are performed until you remove --paper from the startup command.')
						}
//						console.log('Press ' + ' l '.inverse + ' to list available commands.')
						
						//Inizializzo i comandi dell'interfaccia
						changeModeCommand()
						
						engine.syncBalance(function (err) {
							if (err) {
								if (err.desc) console.error(err.desc)
								if (err.body) console.error(err.body)
								throw err
							}
							session = {
								id: crypto.randomBytes(4).toString('hex'),
								selector: so.selector.normalized,
								started: new Date().getTime(),
								mode: so.mode,
								options: so,
								//Spostati qui da forwardScan()
								start_capital: s.start_capital,
								start_price: s.start_price,
								orig_capital: s.start_capital,
								orig_price: s.start_price,
								day_count: s.day_count,
								num_trades: s.my_trades.length
							}
							session._id = session.id
							sessions.find({selector: so.selector.normalized}).limit(1).sort({started: -1}).toArray(function (err, prev_sessions) {
								if (err) throw err
								var prev_session = prev_sessions[0]
			//                  if (prev_session && !cmd.reset) {
								if (prev_session && !cmd.reset && ((so.mode === 'paper' && !raw_opts.currency_capital && !raw_opts.asset_capital) || (so.mode === 'live' && prev_session.balance.asset == s.balance.asset && prev_session.balance.currency == s.balance.currency && !raw_opts.currency_capital && !raw_opts.asset_capital))) {
//									debug.msg('getNext() - prev_session')
//                    if (prev_session.orig_capital && prev_session.orig_price && prev_session.deposit === so.deposit && ((so.mode === 'paper' && !raw_opts.currency_capital && !raw_opts.asset_capital) || (so.mode === 'live' && prev_session.balance.asset == s.balance.asset && prev_session.balance.currency == s.balance.currency))) {                	  
//                      s.orig_capital = session.orig_capital = so.currency_capital || prev_session.orig_capital
									s.orig_currency = session.orig_currency = prev_session.orig_currency
									s.orig_asset = session.orig_asset = prev_session.orig_asset
									s.orig_price = session.orig_price = prev_session.orig_price
									s.orig_capital = session.orig_capital = prev_session.orig_capital
									s.day_count = session.day_count = prev_session.day_count ? prev_session.day_count : 1
									s.my_trades.length = session.num_trades = prev_session.num_trades
									debug.obj('getNext() - prev_session', session)
									if (so.mode === 'paper') {
										debug.obj('getNext() - paper: ', prev_session.balance)
										s.balance = prev_session.balance
									}
								}
								else {
									debug.msg('getNext() - no prev_session')
									s.orig_currency = s.start_currency = raw_opts.currency_capital | 0
									s.orig_asset = s.start_asset = raw_opts.asset_capital | 0
									s.orig_price = s.start_price
									s.orig_capital = s.orig_currency + (s.orig_asset * s.orig_price)
									debug.msg('getNext() - s.orig_currency = ' + s.orig_currency + ' ; s.orig_asset = ' + s.orig_asset + ' ; s.orig_capital = ' + s.orig_capital + ' ; s.orig_price = ' + s.orig_price)
								} 
								//                  }
								if (s.lookback.length > so.keep_lookback_periods) {
									s.lookback.splice(-1,1) //Toglie l'ultimo elemento
								}
								
								//Chiamata alla funzione forwardScan() ogni so.poll_trades
								//forwardScan()
								setInterval(forwardScan, so.poll_trades)

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
							})
						})
						return
					}
					db_cursor = trades[trades.length - 1].time
					trade_cursor = s.exchange.getCursor(trades[trades.length - 1])
					engine.update(trades, true, function (err) {
						if (err) throw err
						setImmediate(getNext)
					})
				})
			}
			/* End of getNext() */

			engine.writeHeader()
			getNext()
		})
		/* End of backfiller.on(exit) */

		var prev_timeout = null
		function forwardScan () {
			function saveSession () {
//				engine.syncBalance(function (err) {
//					if (!err && s.balance.asset === undefined) {
//						// TODO not the nicest place to verify the state, but did not found a better one
//						throw new Error('Error during syncing balance. Please check your API-Key')
//					}
//					if (err) {
//						console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error syncing balance')
//						if (err.desc) console.error(err.desc)
//						if (err.body) console.error(err.body)
//						console.error(err)
//					}

					//Check sul run_for
					if (botStartTime && botStartTime - moment() < 0 ) {
						// Not sure if I should just handle exit code directly or thru printTrade.  Decided on printTrade being if code is added there for clean exits this can just take advantage of it.
						engine.exit(() => {
							printTrade(true)
						})
					}

					//Check per invio messaggi di status
					if (nextUpdateMsg && nextUpdateMsg - moment() < 0) {
//						nextUpdateMsg = moment().add(so.update_msg, 'h')
						nextUpdateMsg = nextUpdateMsg.add(so.update_msg, 'h')
						//debug.msg('nextUpdateMsg=' + nextUpdateMsg)
						engine.updateMessage()
					}

					//Se esiste s.period, aggiorno il database balances
					if (s.period) {
						session.price = s.period.close
						var d = tb().resize(conf.balance_snapshot_period)
						var b = {
							id: so.selector.normalized + '-' + d.toString(),
							selector: so.selector.normalized,
							time: d.toMilliseconds(),
							currency: s.balance.currency,
							asset: s.balance.asset,
							price: s.period.close,
							//Questi due seguenti a cosa serve memorizzarli nel db dei balances?
							start_capital: session.orig_capital,
							start_price: session.orig_price,
						}
						b._id = b.id
						b.consolidated = n(s.balance.asset).multiply(s.period.close).add(s.balance.currency).value()
						b.profit = (b.consolidated - session.orig_capital) / session.orig_capital
						b.buy_hold = s.period.close * (session.orig_asset + session.orig_currency / session.orig_price)
						b.buy_hold_profit = (b.buy_hold - session.orig_capital) / session.orig_capital
						b.vs_buy_hold = (b.consolidated - b.buy_hold) / b.buy_hold
						conf.output.api.on && printTrade(false, false, true)
						if (so.mode === 'live' && s.db_valid) {
							//Corretto il deprecation warning
//							balances.save(b, function (err) {
							balances.updateOne({"_id": b._id}, {$set: b}, {upsert: true}, function (err) {
								if (err) {
									console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving balance')
									console.error(err)
								}
							})
						}
						//Con questo, memorizzo valori inutili dentro session.balance.
						//              session.balance = b
					}

					session.updated = new Date().getTime()
					session.balance = s.balance
					session.num_trades = s.my_trades.length
					session.day_count = s.day_count
					//Corretto il Deprecation Warning
//					if (s.db_valid) sessions.save(session, function (err) {
					if (s.db_valid) sessions.updateOne({"_id" : session._id}, {$set : session}, {upsert : true}, function (err) {
						if (err) {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving session')
							console.error(err)
						}
						if (s.period) {
							Object.keys(so.strategy).forEach(function (strategy_name, index, array) {
								engine.writeReport(strategy_name, true)
							})
						} else {
							readline.clearLine(process.stdout)
							readline.cursorTo(process.stdout, 0)
							process.stdout.write('Waiting on first live trade to display reports, could be a few minutes ...')
						}
					})
//				})
			}
			/* End of saveSession()  */

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
						console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - getTrades request failed. retrying...')
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
						saveTrade(trade)
					})
					engine.update(trades, function (err) {
						if (err) {
							console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving session')
							console.error(err)
						}
						//Corretto il Deprecation Warning
						if (s.db_valid) resume_markers.updateOne({"_id" : marker._id}, {$set : marker}, {upsert : true}, function (err) {
							if (err) {
								console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving marker')
								console.error(err)
							}
						})
						if (s.my_trades.length > my_trades_size) {
							s.my_trades.slice(my_trades_size).forEach(function (my_trade) {
//								my_trade.id = crypto.randomBytes(4).toString('hex')
								my_trade._id = my_trade.id
								my_trade.selector = so.selector.normalized
								my_trade.session_id = session.id
								my_trade.mode = so.mode
								//Corretto il Deprecation Warning
								if (s.db_valid) my_trades.updateOne({"_id" : my_trade._id}, {$set: my_trade}, {upsert: true}, function (err) {
									if (err) {
										console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving my_trade')
										console.error(err)
									}
								})
								
//								if (s.update_position_id != null) {
//									managePositionCollection('update', s.update_position_id)
//								}
//								
//								if (s.delete_position_id != null) {
//									managePositionCollection('delete', s.delete_position_id)
//								}
							})
							my_trades_size = s.my_trades.length
						}
						
						function savePeriod (period) {
							if (!period.id) {
								period.id = crypto.randomBytes(4).toString('hex')
								period.selector = so.selector.normalized
								period.session_id = session.id
							}
							period._id = period.id
							//Corretto il Deprecation Warning
							if (s.db_valid) periods.updateOne({"_id": period._id}, {$set: period}, {upsert: true}, function (err) {
								if (err) {
									console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving periods')
									console.error(err)
								}
							})
						}
						if (s.lookback.length > lookback_size) {
							savePeriod(s.lookback[0])
							lookback_size = s.lookback.length
						}
						if (s.period) {
							savePeriod(s.period)
						}
						saveSession()
					})
				}
				else {
					saveSession()
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
				marker.to = marker.to ? Math.max(marker.to, trade_cursor) : trade_cursor
				marker.newest_time = Math.max(marker.newest_time, trade.time)
				//Corretto il Deprecation Warning
				if (s.db_valid) trades.updateOne({"_id" : trade._id}, {$set : trade}, {upsert : true}, function (err) {
					// ignore duplicate key errors
					if (err && err.code !== 11000) {
						console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - error saving trade')
						console.error(err)
					}
				})
			}
			/* End of saveTrade() */
		}
		/* End of forwardScan() */
	})
}
