const ccxt = require('ccxt')
, path = require('path')
// eslint-disable-next-line no-unused-vars
, colors = require('colors')
, _ = require('lodash')
, debug = require('../../../lib/debug')
//Se funziona la gestione della memoria, si può cancellare insieme alla funzione getMemory()
, sizeof = require('object-sizeof')


module.exports = function binance (conf) {
	var public_client, authed_client
	var max_requests_per_second = 5
	var next_request = 0

	// initialize a cache for the echange connection (if it does not exist)
	exchange_cache = {
		openOrders: {},
	}
	
	function now() {
		return new Date().getTime()
	}

	function publicClient () {
		if (!public_client) public_client = new ccxt.binance({ 'apiKey': '', 'secret': '', 'options': { 'adjustForTimeDifference': true } })
		return public_client
	}

	function authedClient () {
		if (!authed_client) {
			if (!conf.binance || !conf.binance.key || conf.binance.key === 'YOUR-API-KEY') {
				throw new Error('please configure your Binance credentials in ' + path.resolve(__dirname, 'conf.js'))
			}
			authed_client = new ccxt.binance({ 'apiKey': conf.binance.key, 'secret': conf.binance.secret, 'options': { 'adjustForTimeDifference': true }, enableRateLimit: true })
		}
		return authed_client
	}

	/**
	 * Convert BNB-BTC to BNB/BTC
	 *
	 * @param product_id BNB-BTC
	 * @returns {string}
	 */
	function joinProduct(product_id) {
		let split = product_id.split('-')
		return split[0] + '/' + split[1]
	}

	function retry (method, args, err) {
		if (method !== 'getTrades') {
			console.error(('\nBinance API is down! unable to call ' + method + ', retrying in 10s').red)
			if (err) console.error(err)
			console.error(args.slice(0, -1))
		}
		setTimeout(function () {
			exchange[method].apply(exchange, args)
		}, 10000)
	}

	var orders = {}

	var exchange = {
			name: 'binance',
			historyScan: 'forward',
			historyScanUsesTime: true,
			makerFee: 0.1,
			takerFee: 0.1,
			websocket: false,

			getProducts: function () {
				return require('./products.json')
			},

			getTrades: function (opts, cb) {
				var func_args = [].slice.call(arguments)
				var client = publicClient()
				var startTime = null
				var args = {}
				if (opts.from) {
					startTime = opts.from
				} else {
					startTime = parseInt(opts.to, 10) - 3600000
					args['endTime'] = opts.to
				}

				const symbol = joinProduct(opts.product_id)
				client.fetchTrades(symbol, startTime, undefined, args).then(result => {

					if (result.length === 0 && opts.from) {
						// client.fetchTrades() only returns trades in an 1 hour interval.
						// So we use fetchOHLCV() to detect trade apart from more than 1h.
						// Note: it's done only in forward mode.
						const time_diff = client.options['timeDifference']
						if (startTime + time_diff < (new Date()).getTime() - 3600000) {
							// startTime is older than 1 hour ago.
							return client.fetchOHLCV(symbol, undefined, startTime)
							.then(ohlcv => {
								return ohlcv.length ? client.fetchTrades(symbol, ohlcv[0][0]) : []
							})
						}
					}
					return result
				}).then(result => {
					var trades = result.map(trade => ({
						trade_id: trade.id,
						time: trade.timestamp,
						size: parseFloat(trade.amount),
						price: parseFloat(trade.price),
						side: trade.side
					}))
					cb(null, trades)
				}).catch(function (error) {
					console.error('An error occurred', error)
					return retry('getTrades', func_args)
				})

			},

			getBalance: function (opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()
					client.fetchBalance().then(result => {
						var balance = {asset: 0, currency: 0}
						Object.keys(result).forEach(function (key) {
							if (key === opts.currency) {
								balance.currency = result[key].free + result[key].used
								balance.currency_hold = result[key].used
							}
							if (key === opts.asset) {
								balance.asset = result[key].free + result[key].used
								balance.asset_hold = result[key].used
							}
						})
						cb(null, balance)
					})
					.catch(function (error) {
						console.error('An error occurred', error)
						return retry('getBalance', func_args)
					})
				}
				else {
					debug.msg('exchange.getBalance - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { getBalance(opts, cb) }, (next_request - now() + 1))
				}
			},

			getQuote: function (opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = publicClient()
					client.fetchTicker(joinProduct(opts.product_id)).then(result => {
						cb(null, { bid: result.bid, ask: result.ask })
					})
					.catch(function (error) {
						console.error('An error occurred', error)
						return retry('getQuote', func_args)
					})
				}
				else {
					debug.msg('exchange.getQuote - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { getQuote(opts, cb) }, (next_request - now() + 1))
				}
			},

			getDepth: function (opts, cb) {
				var func_args = [].slice.call(arguments)
				var client = publicClient()
				client.fetchOrderBook(joinProduct(opts.product_id), {limit: opts.limit}).then(result => {
					cb(null, result)
				})
				.catch(function(error) {
					console.error('An error ocurred', error)
					return retry('getDepth', func_args)
				})
			},

			cancelOrder: function (opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()
					client.cancelOrder(opts.order_id, joinProduct(opts.product_id)).then(function (body) {
						if (body) {
							console.log('exchange.cancelOrder - body:')
							console.log(body)
						}
						if (body && (body.message === 'Order already done' || body.message === 'order not found')) return cb()
						cb(null)
					}, function(err){
						// match error against string:
						// "binance {"code":-2011,"msg":"UNKNOWN_ORDER"}"

						if (err) {
							// decide if this error is allowed for a retry

							if (err.message && err.message.match(new RegExp(/-2011|UNKNOWN_ORDER/))) {
								console.error(('\ncancelOrder retry - unknown Order: ' + JSON.stringify(opts) + ' - ' + err).cyan)
							} else {
								// retry is allowed for this error

								return retry('cancelOrder', func_args, err)
							}
						}

						cb()
					})
				}
				else {
					debug.msg('exchange.cancelOrder - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { cancelOrder(opts, cb) }, (next_request - now() + 1))
				}
			},
			
			//Cancella l'ordine dalla websocket_cache, in modo da non aumentarla a dismisura
			cancelOrderCache: function (opts) {
				if(exchange_cache) {
					delete exchange_cache.openOrders['~' + opts.order_id]
				}
			},

			buy: function (opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()
					if (typeof opts.post_only === 'undefined') {
						opts.post_only = true
					}
					opts.type = 'limit'
						var args = {}
					if (opts.order_type === 'taker') {
						delete opts.price
						delete opts.post_only
						opts.type = 'market'
					} else {
						args.timeInForce = 'GTC'
					}
					opts.side = 'buy'
						delete opts.order_type
						var order = {}
					client.createOrder(joinProduct(opts.product_id), opts.type, opts.side, this.roundToNearest(opts.size, opts), opts.price, args).then(result => {
						if (result && result.message === 'Insufficient funds') {
							order = {
								status: 'rejected',
								reject_reason: 'balance'
							}
							return cb(null, order)
						}
						order = {
							id: result ? result.id : null,
							status: 'open',
							price: opts.price,
							size: this.roundToNearest(opts.size, opts),
							post_only: !!opts.post_only,
							created_at: new Date().getTime(),
							filled_size: '0',
							ordertype: opts.order_type
						}
						orders['~' + result.id] = order
						cb(null, order)
					}).catch(function (error) {
						console.error('An error occurred', error)

						// decide if this error is allowed for a retry:
						// {"code":-1013,"msg":"Filter failure: MIN_NOTIONAL"}
						// {"code":-2010,"msg":"Account has insufficient balance for requested action"}

						if (error.message.match(new RegExp(/-1013|MIN_NOTIONAL|-2010/))) {
							return cb(null, {
								status: 'rejected',
								reject_reason: 'balance'
							})
						}

						return retry('buy', func_args)
					})
				}
				else {
					debug.msg('exchange.buy - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { buy(opts, cb) }, (next_request - now() + 1))
				}
			},

			sell: function (opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()
					if (typeof opts.post_only === 'undefined') {
						opts.post_only = true
					}
					opts.type = 'limit'
						var args = {}
					if (opts.order_type === 'taker') {
						delete opts.price
						delete opts.post_only
						opts.type = 'market'
					} else {
						args.timeInForce = 'GTC'
					}
					opts.side = 'sell'
						delete opts.order_type
						var order = {}
					client.createOrder(joinProduct(opts.product_id), opts.type, opts.side, this.roundToNearest(opts.size, opts), opts.price, args).then(result => {
						if (result && result.message === 'Insufficient funds') {
							order = {
								status: 'rejected',
								reject_reason: 'balance'
							}
							return cb(null, order)
						}
						order = {
							id: result ? result.id : null,
							status: 'open',
							price: opts.price,
							size: this.roundToNearest(opts.size, opts),
							post_only: !!opts.post_only,
							created_at: new Date().getTime(),
							filled_size: '0',
							ordertype: opts.order_type
						}
						orders['~' + result.id] = order
						cb(null, order)
					}).catch(function (error) {
						console.error('An error occurred', error)

						// decide if this error is allowed for a retry:
						// {"code":-1013,"msg":"Filter failure: MIN_NOTIONAL"}
						// {"code":-2010,"msg":"Account has insufficient balance for requested action"}

						if (error.message.match(new RegExp(/-1013|MIN_NOTIONAL|-2010/))) {
							return cb(null, {
								status: 'rejected',
								reject_reason: 'balance'
							})
						}

						return retry('sell', func_args)
					})
				}
				else {
					debug.msg('exchange.sell - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { sell(opts, cb) }, (next_request - now() + 1))
				}
			},

			roundToNearest: function(numToRound, opts) {
				var numToRoundTo = _.find(this.getProducts(), { 'asset': opts.product_id.split('-')[0], 'currency': opts.product_id.split('-')[1] }).min_size
				numToRoundTo = 1 / (numToRoundTo)

				return Math.floor(numToRound * numToRoundTo) / numToRoundTo
			},
			
			getOrder: function (opts, forced = false, cb) {
				if (typeof forced == 'function') {
					cb = forced
					forced = false
				}

				if (!forced && exchange_cache && exchange_cache.openOrders['~' + opts.order_id]) {
					let order_tmp = exchange_cache.openOrders['~' + opts.order_id]
					let order_cache = {
							id: order_tmp.id,
							created_at: order_tmp.timestamp,
							done_at: order_tmp.lastTradeTimestamp,
							price: order_tmp.price,
							size: order_tmp.amount,
							product_id: order_tmp.symbol,
							side: order_tmp.side,
							status: order_tmp.status,
//							settled: false,
							filled_size: order_tmp.filled,
							executed_value: order_tmp.cost,
							fill_fees: order_tmp.fee.cost,
							currency_fees: order_tmp.fee.currency
					}
					
					debug.msg('exchange.getOrder - exchange_cache:')
					debug.msg(order_cache, false)

					cb(null, order_cache)
					return
				}				
				else {
					if (now() > next_request) {
						next_request = now() + 1000/max_requests_per_second

						var func_args = [].slice.call(arguments)
						var client = authedClient()
						client.fetchOrder(opts.order_id, joinProduct(opts.product_id)).then(function (body) {
//							{
//						    'id':                '12345-67890:09876/54321', // string
//						    'datetime':          '2017-08-17 12:42:48.000', // ISO8601 datetime of 'timestamp' with milliseconds
//						    'timestamp':          1502962946216, // order placing/opening Unix timestamp in milliseconds
//						    'lastTradeTimestamp': 1502962956216, // Unix timestamp of the most recent trade on this order
//						    'status':     'open',         // 'open', 'closed', 'canceled'
//						    'symbol':     'ETH/BTC',      // symbol
//						    'type':       'limit',        // 'market', 'limit'
//						    'side':       'buy',          // 'buy', 'sell'
//						    'price':       0.06917684,    // float price in quote currency
//						    'amount':      1.5,           // ordered amount of base currency
//						    'filled':      1.1,           // filled amount of base currency
//						    'remaining':   0.4,           // remaining amount to fill
//						    'cost':        0.076094524,   // 'filled' * 'price' (filling price used where available)
//						    'trades':    [ ... ],         // a list of order trades/executions
//						    'fee': {                      // fee info, if available
//						        'currency': 'BTC',        // which currency the fee is (usually quote)
//						        'cost': 0.0009,           // the fee amount in that currency
//						        'rate': 0.002,            // the fee rate (if available)
//						    },
//						    'info': { ... },              // the original unparsed order structure as is
//						}
							let order_tmp = {
									id: body.id,
									created_at: body.timestamp,
									done_at: body.lastTradeTimestamp,
									price: body.price,
									size: body.amount,
									product_id: body.symbol,
									side: body.side,
									status: body.status,
//									settled: false,
									filled_size: body.filled,
									executed_value: body.cost,
									fill_fees: body.fee.cost,
									currency_fees: body.fee.currency,
									rate_fees: body.fee.rate
							}
							
							if (order_tmp.status !== 'open' && order_tmp.status !== 'canceled') {
								order_tmp.status = 'done'
							}
							cb(null, order)
						}, function(err) {
							return retry('getOrder', func_args, err)
						})
					}
					else {
						debug.msg('exchange.getOrder - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
						setTimeout(function() { getOrders(opts, cb) }, (next_request - now() + 1))
					}
				}
			},

			getAllOrders: function (opts, cb = function() {}) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()
					client.fetchOpenOrders(joinProduct(opts.product_id)).then(function (body) {
//						console.log('exchange.getAllOrders - body:')
//						console.log(body)
						//Azzero la cache e la riscrivo con i valori ricevuti
						exchange_cache.openOrders = {}
						body.forEach(function(order, index) {
//							delete order.info
							exchange_cache.openOrders['~' + order.id] = order
						})
						cb(null)
					}, function(err) {
						return retry('getAllOrders', func_args, err)
					})
				}
				else {
					debug.msg('exchange.getAllOrder - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { getAllOrders(opts, cb) }, (next_request - now() + 1))
				}
			},

			getCursor: function (trade) {
				return (trade.time || trade)
			},
			
			getMemory: function() {
				return sizeof(exchange_cache)
			}
	}
	return exchange
}
