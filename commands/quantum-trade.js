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
	.option('--profit_stop_enable_pct <pct>', 'enable trailing sell stop when reaching this % profit', Number, conf.profit_stop_enable_pct)
	.option('--profit_stop_pct <pct>', 'maintain a trailing stop this % below the high-water mark of profit', Number, conf.profit_stop_pct)
	.option('--max_sell_loss_pct <pct>', 'avoid selling at a loss pct under this float (could be used for min profit in long positions))', conf.max_sell_loss_pct)
	.option('--max_buy_loss_pct <pct>', 'avoid buying at a loss pct over this float (could be used for min profit in short positions)', conf.max_buy_loss_pct) //da togliere
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
				debug.msg('nextUpdateMsg=' + nextUpdateMsg)
			}
			
			if (!so.no_first_message) {
				nextUpdateMsg = nextUpdateMsg.subtract(so.update_msg, 'h')
				debug.msg('First message on. nextUpdateMsg=' + nextUpdateMsg)
			}
		}

		if (!so.min_periods) so.min_periods = 301

		so.selector = objectifySelector(selector || conf.selector)

		//Quindi engine è quantum-engine(s, conf), dove conf è zenbot.conf da zenbot.js, quindi l'unione 
		// di conf_file, conf.js e conf-sample.js e NON s.options
		var engine = engineFactory(s, conf)
		var collectionServiceInstance = collectionService(conf)

		const keyMap = new Map()
		keyMap.set('I', 'toggle interactive buy/sell'.grey)
		keyMap.set('b', 'limit'.grey + ' BUY'.green)
		keyMap.set('B', 'market'.grey + ' BUY'.green)
		keyMap.set('s', 'limit'.grey + ' SELL'.red)
		keyMap.set('S', 'market'.grey + ' SELL'.red)
		keyMap.set('t', 'manual catch order'.grey + ' BUY'.green)
		keyMap.set('T', 'manual catch order'.grey + ' SELL'.red)
		keyMap.set('+', 'manual catch pct'.grey + ' INCREASE'.green)
		keyMap.set('-', 'manual catch pct'.grey + ' DECREASE'.red)
		keyMap.set('*', 'manual catch value'.grey + ' INCREASE'.green)
		keyMap.set('_', 'manual catch value'.grey + ' DECREASE'.red)
		keyMap.set('0', 'cancel all manual catch orders'.grey)
		keyMap.set('A', 'insert catch order for all free position'.grey)
		keyMap.set('c', 'cancel order'.grey)
		keyMap.set('C', 'cancel ALL order'.grey)
		keyMap.set('m', 'toggle MANUAL trade in LIVE mode ON / OFF'.grey)
		keyMap.set('M', 'switch between \'Maker\' and \'Taker\' order type'.grey)
		keyMap.set('o', 'show current trade options'.grey)
		keyMap.set('d', 'show current trade options in a dirty view (full list)'.grey)
		keyMap.set('D', 'toggle DEBUG'.grey)
		keyMap.set('p', 'print statistical output'.grey)
		keyMap.set('P', 'list positions opened'.grey)
		keyMap.set('O', 'list orders opened'.grey)
		keyMap.set('X', 'exit program with statistical output'.grey)
		keyMap.set('h', 'dump statistical output to HTML file'.grey)
		keyMap.set('H', 'toggle automatic HTML dump to file'.grey)
		keyMap.set('R', 'try to recover MongoDB connection'.grey)
		keyMap.set('K', 'clean MongoDB databases (delete data older than 30 days)'.grey)
		keyMap.set('w', 'toggle Dump Watchdog'.grey)
		keyMap.set('W', 'toggle Pump Watchdog'.grey)
		keyMap.set('z', 'toggle Long Position'.grey)
		keyMap.set('Z', 'toggle Short Position'.grey)
		
		function listKeys() {
			console.log('\nAvailable command keys:')
			keyMap.forEach((value, key) => {
				console.log(' ' + key + ' - ' + value)
			})
		}

		/* Toggle for interactive buy/sell */
		var interactiveBuySell = false
		function toggleInteractiveBuySell() {
			interactiveBuySell = !interactiveBuySell
			if(interactiveBuySell)
				console.log('Interactive Buy/Sell enabled')
			else
				console.log('Interactive Buy/Sell disabled')
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
				
		/* To list options*/
		function listOptions () {
			console.log()
			console.log(s.exchange.name.toUpperCase() + ' exchange active trading options:'.grey)
			console.log()
			process.stdout.write(z(22, 'STRATEGY'.grey, ' ') + '\t' + so.strategy + '\t' + (require(`../extensions/strategies/${so.strategy}/strategy`).description).grey)
			console.log('\n')
			process.stdout.write([
				z(25, (so.mode === 'paper' ? so.mode.toUpperCase() : so.mode.toUpperCase()) + ' MODE'.grey, ' '),
				z(25, 'PERIOD LENGTH'.grey, ' '),
				z(25, 'PERIOD CALC'.grey, ' '),
				z(25, 'ORDER TYPE'.grey, ' '),
				z(25, 'SLIPPAGE'.grey, ' '),
				z(30, 'EXCHANGE FEES'.grey, ' ')
				].join('') + '\n')
			process.stdout.write([
				z(15, (so.mode === 'paper' ? '      ' : (so.mode === 'live' && (so.manual === false || typeof so.manual === 'undefined')) ? '        ' + 'AUTO'.black.bgRed + '   ' : '       ' + 'MANUAL'.black.bgGreen + '  '), ' '),
				z(10, so.period_length, ' '),
				z(17, so.period_calc, ' '),
				z(26, (so.order_type === 'maker' ? so.order_type.toUpperCase().green : so.order_type.toUpperCase().red), ' '),
				z(28, (so.mode === 'paper' ? 'avg. '.grey + so.avg_slippage_pct + '%' : 'max '.grey + so.max_slippage_pct + '%'), ' '),
				z(17, (so.order_type === 'maker' ? so.order_type + ' ' + n(s.exchange.makerFee).format('0.0000%')  : so.order_type + ' ' + s.exchange.takerFee), ' ')
				].join('') + '\n\n')
			process.stdout.write('')
			process.stdout.write([
			//z(19, 'BUY %'.grey, ' '),
			//z(20, 'SELL %'.grey, ' '),
			z(30, 'TRAILING STOP %'.grey, ' '),
			z(34, 'TRAILING DISTANCE %'.grey, ' '),
			z(35, 'DUMP / PUMP WATCHDOG'.grey, ' '),
			z(36, 'LONG / SHORT POSITION'.grey, ' ')
			].join('') + '\n')
			process.stdout.write([
				//z(9, so.buy_pct + '%', ' '),
				//z(9, so.sell_pct + '%', ' '),
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
//			z(36, 'LONG / SHORT POSITION'.grey, ' ')
			].join('') + '\n')
			process.stdout.write([
				z(9, (so.buy_stop_pct || '--') + '%', ' '),
				z(6, (so.sell_stop_pct || '--') + '%', ' '),
				z(25, so.catch_order_pct + '%', ' '),
				z(23, so.catch_manual_pct + '%', ' '),
				z(25, formatCurrency(so.catch_fixed_value, s.currency), ' '),
//				z(8, so.active_short_position, ' ')
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
				output_lines.push(sizeof(s.calc_lookback) + ' size of s.calc_lookback')
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

//Da sistemare tutta questa sezione in relazione alle novità introdotte con la versione quantum_parallel			
			//var last_buy
			var losses = 0, sells = 0
			s.my_trades.forEach(function (trade) {
				// if (trade.type === 'buy') {
				// last_buy = trade.price
				// }
				// else {
				// if (last_buy && trade.price < last_buy) {
				// losses++
				// }
				// sells++
				// }
				if (trade.side === 'sell') {
					if (trade.profit > 0)
						sells++
					else
						losses++
				}
			})

			if (s.my_prev_trades.length) {
				s.my_prev_trades.forEach(function (trade) {
					if (trade.side === 'sell') {
						if (trade.profit > 0)
							sells++
						else
							losses++
					}
				})
			}

			if (s.my_trades.length && sells > 0) {
				if (!statsonly) {
					output_lines.push('win/loss: ' + (sells - losses) + '/' + losses)
					output_lines.push('error rate: ' + (sells ? n(losses).divide(sells).format('0.00%') : '0.00%').yellow)
				}

				//for API
				s.stats.win = (sells - losses)
				s.stats.losses = losses
				s.stats.error_rate = (sells ? n(losses).divide(sells).format('0.00%') : '0.00%')
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

			// var last_buy
			var losses = 0, sells = 0
			s.my_trades.forEach(function (trade) {
				//		if (trade.type === 'buy') {
				//			last_buy = trade.price
				//		}
				//		else {
				//			if (last_buy && trade.price < last_buy) {
				//			losses++
				//			}
				//			sells++
				//		}

				if (trade.side === 'sell') {
					if (trade.profit > 0)
						sells++
					else
						losses++
				}
			})

			if (s.my_trades.length && sells > 0) {
				output_lines.push('win/loss: ' + (sells - losses) + '/' + losses)
				output_lines.push('error rate: ' + (sells ? n(losses).divide(sells).format('0.00%') : '0.00%').yellow)

				//for API
				s.stats.win = (sells - losses)
				s.stats.losses = losses
				s.stats.error_rate = (sells ? n(losses).divide(sells).format('0.00%') : '0.00%')
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
			
			function getNext () {
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
					if (!trades.length) {
						var head = '------------------------------------------ INITIALIZE  OUTPUT ------------------------------------------'
						console.log(head)
						output(conf).initializeOutput(s)
						var minuses = Math.floor((head.length - so.mode.length - 19) / 2)
						console.log('-'.repeat(minuses) + ' STARTING ' + so.mode.toUpperCase() + ' TRADING ' + '-'.repeat(minuses + (minuses % 2 == 0 ? 0 : 1)))
						if (so.mode === 'paper') {
							console.log('!!! Paper mode enabled. No real trades are performed until you remove --paper from the startup command.')
						}
						console.log('Press ' + ' l '.inverse + ' to list available commands.')
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
								if(s.lookback.length > so.keep_lookback_periods) {
									s.lookback.splice(-1,1) //Toglie l'ultimo elemento
								}

								//Chiamata alla funzione forwardScan() ogni so.poll_trades
								forwardScan()
								setInterval(forwardScan, so.poll_trades)
								
								//Chiamata alla funzione syncBalance ogni so.poll_balance
								setInterval(engine.syncBalance, so.poll_balance)

								readline.emitKeypressEvents(process.stdin)
								if (!so.non_interactive && process.stdin.setRawMode) {
									process.stdin.setRawMode(true)
									process.stdin.on('keypress', function (key, info) {
										if (key === 'l') {
											listKeys()
										} else if (key === 'I' && !info.ctrl) {
											console.log('\nInteractive Buy/Sell...'.grey)
											toggleInteractiveBuySell()
										} else if (key === 'b' && !info.ctrl && interactiveBuySell) {
											console.log('\nmanual'.grey + ' limit ' + 'BUY'.green + ' command inserted'.grey)
											engine.emitSignal('standard', 'buy')											
										} else if (key === 'B' && !info.ctrl && interactiveBuySell) {
											console.log('\nmanual'.grey + ' market ' + 'BUY'.green + ' command inserted'.grey)
											engine.emitSignal('standard', 'buy', null, null, null, false, true)
										} else if (key === 's' && !info.ctrl && interactiveBuySell) {
											console.log('\nmanual'.grey + ' limit ' + 'SELL'.red + ' command inserted'.grey)
											engine.emitSignal('standard', 'sell')											
										} else if (key === 'S' && !info.ctrl && interactiveBuySell) {
											console.log('\nmanual'.grey + ' market ' + 'SELL'.red + ' command inserted'.grey)
											engine.emitSignal('standard', 'sell', null, null, null, false, true)											
										} else if (key === 't' && !info.ctrl && interactiveBuySell) {
											console.log('\nmanual'.grey + ' catch ' + 'BUY'.green + ' command inserted'.grey)
											var target_price = n(s.quote.bid).multiply(1 - so.catch_manual_pct/100).format(s.product.increment, Math.floor)
											var target_size = n(so.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
											engine.emitSignal('manualcatch', 'buy', null, target_size, target_price)											
										} else if (key === 'T' && !info.ctrl && interactiveBuySell) {
											console.log('\nmanual'.grey + ' catch ' + 'SELL'.red + ' command inserted'.grey)
											var target_price = n(s.quote.ask).multiply(1 + so.catch_manual_pct/100).format(s.product.increment, Math.floor)
											var target_size = n(so.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
											engine.emitSignal('manualcatch', 'sell', null, target_size, target_price)	
										} else if (key === '+' && !info.ctrl && interactiveBuySell) {
											so.catch_manual_pct++
											console.log('\n' + 'Manual catch order pct ' + 'INCREASE'.green + ' -> ' + so.catch_manual_pct)	
										} else if (key === '-' && !info.ctrl && interactiveBuySell) {
											so.catch_manual_pct--
											console.log('\n' + 'Manual catch order pct ' + 'DECREASE'.red + ' -> ' + so.catch_manual_pct)
										} else if (key === '*' && !info.ctrl && interactiveBuySell) {
											so.catch_fixed_value += so.quantum_value
											console.log('\n' + 'Manual catch order value ' + 'INCREASE'.green + ' -> ' + so.catch_fixed_value)	
										} else if (key === '_' && !info.ctrl && interactiveBuySell) {
											so.catch_fixed_value -= so.quantum_value
											if (so.catch_fixed_value < so.quantum_value) {
												so.catch_fixed_value = so.quantum_value
											}
											console.log('\n' + 'Manual catch order value ' + 'DECREASE'.red + ' -> ' + so.catch_fixed_value)
										} else if (key === '0' && !info.ctrl && interactiveBuySell) {
											console.log('\nmanual'.grey + ' canceling ALL catch orders')
											engine.orderStatus(undefined, undefined, 'manualcatch', undefined, 'Unset', 'manualcatch')
										} else if (key === 'A' && !info.ctrl && interactiveBuySell) {
											console.log('\n' + 'Insert catch order for all free positions'.grey)
											s.positions.forEach(function (position, index) {
												engine.emitSignal('orderExecuted', position.side, position.id)
											})
										} else if ((key === 'c') && !info.ctrl && interactiveBuySell) {
											engine.orderStatus(undefined, undefined, 'standard', undefined, 'Unset', 'standard')
											console.log('\nmanual'.grey + ' standard orders cancel' + ' command executed'.grey)
										} else if ((key === 'C') && !info.ctrl && interactiveBuySell) {
											console.log('\nmanual'.grey + ' canceling ALL orders')
											// cancelAllOrders non registrerebbe ordini eseguiti parzialmente.
											// Quindi meglio cancellarli uno ad uno tramite la funzione engine.positionStatus
											engine.orderStatus(undefined, undefined, undefined, undefined, 'Free')
										} else if (key === 'm' && !info.ctrl && so.mode === 'live') {
											so.manual = !so.manual
											console.log('\nMANUAL trade in LIVE mode: ' + (so.manual ? 'ON'.green.inverse : 'OFF'.red.inverse))
										} else if (key === 'M' && !info.ctrl) {
											(so.order_type === 'maker' ? so.order_type = 'taker' : so.order_type = 'maker')
											console.log('\n' + so.order_type.toUpperCase() + ' fees activated'.black.bgGreen)
										} else if (key === 'o' && !info.ctrl) {
											listOptions()
										} else if (key === 'd' && !info.ctrl) {
											console.log('\n' + cliff.inspect(so))
										} else if (key === 'p' && !info.ctrl) {
											console.log('\nWriting statistics...'.grey)
											printTrade(false)
										} else if (key === 'P' && !info.ctrl) {
											console.log('\nListing positions opened...'.grey)
											debug.printPosition(s.positions, true)
										} else if (key === 'O' && !info.ctrl) {
											console.log('\nListing orders opened...'.grey)
											debug.printPosition(s.orders, true)
										} else if (key === 'X' && !info.ctrl) {
											console.log('\nExiting... ' + '\nCanceling ALL orders...'.grey)
											// cancelAllOrders non registrerebbe ordini eseguiti parzialmente.
											// Quindi meglio cancellarli uno ad uno tramite la funzione engine.positionStatus	
											engine.orderStatus(undefined, undefined, undefined, undefined, 'Free')								
											setTimeout(function() { 
												console.log('\nExiting... ' + '\nWriting statistics...'.grey)
												printTrade(true)
											}, so.order_poll_time*5)								
										} else if (key === 'h' && !info.ctrl) {
											console.log('\nDumping statistics...'.grey)
											printTrade(false, true)
										} else if (key === 'H' && !info.ctrl) {
											console.log('\nDumping statistics...'.grey)
											toggleStats()
										} else if (key === 'D' && !info.ctrl) {
											debug.flip()
											console.log('\nDEBUG mode: ' + (debug.on ? 'ON'.green.inverse : 'OFF'.red.inverse))
										} else if (info.name === 'c' && info.ctrl) {
											// @todo: cancel open orders before exit
											console.log()
											process.exit()
										} else if (key === 'R' && !info.ctrl) {
											console.log('\nTrying to recover MongoDB connection...'.grey)
											recoverMongoDB()
										} else if (key === 'K' && !info.ctrl) {
											console.log('\nCleaning MongoDB databases...'.grey)
											cleanMongoDB()
										} else if (key === 'w' && !info.ctrl) {
											so.dump_watchdog = !so.dump_watchdog
											s.is_dump_watchdog = so.dump_watchdog
											console.log('\nToggle Dump Watchdog: ' + (so.dump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
										} else if (key === 'W' && !info.ctrl) {
											so.pump_watchdog = !so.pump_watchdog
											s.is_pump_watchdog = so.pump_watchdog
											console.log('\nToggle Pump Watchdog: ' + (so.pump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
										} else if (key === 'z' && !info.ctrl) {
											so.active_long_position = !so.active_long_position
											console.log('\nToggle Long position: ' + (so.active_long_position ? 'ON'.green.inverse : 'OFF'.red.inverse))
										} else if (key === 'Z' && !info.ctrl) {
											so.active_short_position = !so.active_short_position
											console.log('\nToggle Short position: ' + (so.active_short_position ? 'ON'.green.inverse : 'OFF'.red.inverse))
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
							engine.writeReport(true)
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
			// millisecond to it, in order to avoid fetching a second time the last.
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
								
								if (s.update_position_id != null) {
									managePositionCollection('update', s.update_position_id)
								}
								
								if (s.delete_position_id != null) {
									managePositionCollection('delete', s.delete_position_id)
								}
							})
							my_trades_size = s.my_trades.length
						}

						function managePositionCollection (mode, position_id, cb = function () {}) {
							switch (mode) {
							case 'update': {
								position = s.positions.find(x => x.id === position_id)
								position._id = position.id

								if (s.db_valid) {
									my_positions.updateOne({"_id" : position_id}, {$set: position}, {upsert: true}, function (err) {
										s.update_position_id = null
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
										s.delete_position_id = null
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
