var tb = require('timebucket')
, crypto = require('crypto')
, objectifySelector = require('../lib/objectify-selector')

module.exports = function (program, conf) {
	program
	.command('backfill [selector]')
	.description('download historical trades for analysis')
	.option('--conf <path>', 'path to optional conf overrides file')
	.option('--debug', 'output detailed debug info')
	.option('-d, --days <days>', 'number of days to acquire (default: ' + conf.days + ')', Number, conf.days)
	.option('--start <unix_in_ms>', 'lower bound as unix time in ms', Number, -1)
	.option('--end <unix_in_ms>', 'upper bound as unix time in ms', Number, -1)
	.action(function (selector, cmd) {
		console.log('Backfill - downloading data...')
		selector = objectifySelector(selector || conf.selector)
		var exchange = require(`../extensions/exchanges/${selector.exchange_id}/exchange`)(conf)
		if (!exchange) {
			console.error('cannot backfill ' + selector.normalized + ': exchange not implemented')
			process.exit(1)
		}

		var db_trades = conf.nestdb.trades
		var db_resume_markers = conf.nestdb.resume_markers

		var marker = {
				id: crypto.randomBytes(4).toString('hex'),
				selector: selector.normalized,
				from: null,
				to: null,
				oldest_time: null,
				newest_time: null
		}
		
		marker._id = marker.id
		var trade_counter = 0
		var day_trade_counter = 0
		var get_trade_retry_count = 0
		var days_left = cmd.days + 1
		var target_time, start_time
		var mode = exchange.historyScan
		var last_batch_id, last_batch_opts
		var offset = exchange.offset
		var markers, trades
		
		if (!mode) {
			console.error('cannot backfill ' + selector.normalized + ': exchange does not offer historical data')
			process.exit(0)
		}
		
		if (mode === 'backward') {
			target_time = new Date().getTime() - (86400000 * cmd.days)
		}
		else {
			if(cmd.start >= 0 && cmd.end >= 0){
				start_time = cmd.start
				target_time = cmd.end
			} else {
				target_time = new Date().getTime()
				start_time = new Date().getTime() - (86400000 * cmd.days)
			}
		}
		
		db_resume_markers.find({selector: selector.normalized}, function(err, results) {
//			console.log('Backfill - db_resume_markers')
			markers = results.sort(function (a, b) {
				if (mode === 'backward') {
					if (a.to > b.to) return -1
					if (a.to < b.to) return 1
				}
				else {
					if (a.from < b.from) return -1
					if (a.from > b.from) return 1
				}
				return 0
			})
			getNext()
		})

		function getNext () {
			var opts = {product_id: selector.product_id}
			if (mode === 'backward') {
				opts.to = marker.from
			}
			else {
				if (marker.to) opts.from = marker.to + 1
				else opts.from = exchange.getCursor(start_time)
			}
			if (offset) {
				opts.offset = offset
			}
			last_batch_opts = opts
			exchange.getTrades(opts, function (err, results) {
//				console.log('Backfill - exchange.getTrades')
				trades = results
				if (err) {
					console.error('err backfilling selector: ' + selector.normalized)
					console.error(err)
					if (err.code === 'ETIMEDOUT' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET') {
						console.error('retrying...')
						setImmediate(getNext)
						return
					}
					console.error('aborting!')
					process.exit(1)
				}
				if (mode !== 'backward' && !trades.length) {
					if (trade_counter) {
						console.log('\ndownload complete!\n')
						process.exit(0)
					}
					else {
						if (get_trade_retry_count < 5) {
							console.error('\ngetTrades() returned no trades, retrying with smaller interval.')
							get_trade_retry_count++
							start_time += (target_time - start_time)*0.4
							setImmediate(getNext)
							return
						}
						else {
							console.error('\ngetTrades() returned no trades, --start may be too remotely in the past.')
							process.exit(1)
						}
					}
				}
				else if (!trades.length) {
					console.log('\ngetTrades() returned no trades, we may have exhausted the historical data range.')
					process.exit(0)
				}
				trades.sort(function (a, b) {
					if (mode === 'backward') {
						if (a.time > b.time) return -1
						if (a.time < b.time) return 1
					}
					else {
						if (a.time < b.time) return -1
						if (a.time > b.time) return 1
					}
					return 0
				})
				if (last_batch_id && last_batch_id === trades[0].trade_id) {
					console.error('\nerror: getTrades() returned duplicate results')
					console.error(opts)
					console.error(last_batch_opts)
					process.exit(0)
				}
				last_batch_id = trades[0].trade_id
				runTasks(trades)
			})
		}

		function runTasks (trades) {
			Promise.all(trades.map((trade)=>saveTrade(trade))).then(function(/*results*/){
				var oldest_time = marker.oldest_time
				var newest_time = marker.newest_time
				markers.each(function (other_marker) {
					// for backward scan, if the oldest_time is within another marker's range, skip to the other marker's start point.
					// for forward scan, if the newest_time is within another marker's range, skip to the other marker's end point.
					if (mode === 'backward' && marker.id !== other_marker.id && marker.from <= other_marker.to && marker.from > other_marker.from) {
						marker.from = other_marker.from
						marker.oldest_time = other_marker.oldest_time
					}
					else if (mode !== 'backward' && marker.id !== other_marker.id && marker.to >= other_marker.from && marker.to < other_marker.to) {
						marker.to = other_marker.to
						marker.newest_time = other_marker.newest_time
					}
				})
				var diff
				if (oldest_time !== marker.oldest_time) {
					diff = tb(oldest_time - marker.oldest_time).resize('1h').value
					console.log('\nskipping ' + diff + ' hrs of previously collected data')
				}
				else if (newest_time !== marker.newest_time) {
					diff = tb(marker.newest_time - newest_time).resize('1h').value
					console.log('\nskipping ' + diff + ' hrs of previously collected data')
				}
				db_resume_markers.update({"_id" : marker._id}, {$set : marker}, {multi: false, upsert : true}, function() {
					setupNext()
				})
			}).catch(function(err){
				if (err) {
					console.error(err)
					console.error('retrying...')
					return setTimeout(runTasks, 10000, trades)
				}
			})
		}

		function setupNext() {
			trade_counter += trades.length
			day_trade_counter += trades.length
			var current_days_left = 1 + (mode === 'backward' ? tb(marker.oldest_time - target_time).resize('1d').value : tb(target_time - marker.newest_time).resize('1d').value)
			if (current_days_left >= 0 && current_days_left != days_left) {
				console.log('\n' + selector.normalized, 'saved', day_trade_counter, 'trades', current_days_left, 'days left')
				day_trade_counter = 0
				days_left = current_days_left
			} else {
				process.stdout.write('.')
			}

			if (mode === 'backward' && marker.oldest_time <= target_time) {
				console.log('\ndownload complete!\n')
				process.exit(0)
			} else if(cmd.start >= 0 && cmd.end >= 0 && target_time <= marker.newest_time){
				console.log('\ndownload of span ('+cmd.start+' - '+cmd.end+') complete!\n')
				process.exit(0)
			}

			if (exchange.backfillRateLimit) {
				setTimeout(getNext, exchange.backfillRateLimit)
			} else {
				setImmediate(getNext)
			}
		}

		function saveTrade (trade) {
			trade.id = selector.normalized + '-' + String(trade.trade_id)
			trade._id = trade.id
			trade.selector = selector.normalized
			var cursor = exchange.getCursor(trade)
			if (mode === 'backward') {
				if (!marker.to) {
					marker.to = cursor
					marker.oldest_time = trade.time
					marker.newest_time = trade.time
				}
				marker.from = marker.from ? Math.min(marker.from, cursor) : cursor
						marker.oldest_time = Math.min(marker.oldest_time, trade.time)
			}
			else {
				if (!marker.from) {
					marker.from = cursor
					marker.oldest_time = trade.time
					marker.newest_time = trade.time
				}
				marker.to = marker.to ? Math.max(marker.to, cursor) : cursor
						marker.newest_time = Math.max(marker.newest_time, trade.time)
			}
//			console.log('Backfill - saveTrade - before db_trades.update')
			return db_trades.update({"_id" : trade._id}, {$set : trade}, {multi: false, upsert : true})
		}
	})
}
