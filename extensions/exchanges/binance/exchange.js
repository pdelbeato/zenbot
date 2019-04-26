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

	//Da sistemare bene
	function retry (method, args, waiting_time = 10000, err) {
		if (method !== 'getTrades' && waiting_time === 10000) {
			console.error(('\nretry - Binance API is down! unable to call ' + method + ', retrying in ' + (waiting_time/1000) + 's').red)
			if (err) console.error('retry - err= \n\n' + err)
			console.error('\nretry - args.slice')
			console.error(args.slice(0, -1)) //slice prende l'ultimo valore di args
		}
		setTimeout(function () {
			exchange[method].apply(exchange, args)
		}, waiting_time)
	}

	var orders = {}

	var exchange = {
			name: 'binance',
			historyScan: 'forward',
			historyScanUsesTime: true,
			takerFee: 0.075,
		    makerFee: 0.075,			
			websocket: false,
			
			debug_exchange: false,

			getProducts: function () {
				return require('./products.json')
			},

			getTrades: function (opts, cb) {
				if (exchange.debug_exchange) {
					debug.msg('exchange.getTrades')
				}
				
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
					if (exchange.debug_exchange) {
						debug.obj('exchange.getTrades - trades:', result)
					}
					cb(null, trades)
				}).catch(function (error) {
					console.error('An error occurred', error)
					return retry('getTrades', func_args)
				})

			},

			getBalance: function (opts, cb) {
				var func_args = [].slice.call(arguments)
				if (exchange.debug_exchange) {
					debug.msg('exchange.getBalance')
				}
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

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
						if (exchange.debug_exchange) {
							debug.obj('exchange.getBalance - balance:', result)
						}
						cb(null, balance)
					})
					.catch(function (error) {
						console.error('An error occurred', error)
						return retry('getBalance', func_args)
					})
				}
				else {
					debug.msg('exchange.getBalance - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
//					setTimeout(function() { this.getBalance(opts, cb) }, (next_request - now() + 1))
					retry('getBalance', func_args, (next_request - now() + 1))
				}
			},

			getQuote: function (opts, cb) {
				var func_args = [].slice.call(arguments)
				if (exchange.debug_exchange) {
					debug.msg('exchange.getQuote')
				}
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var client = publicClient()
					client.fetchTicker(joinProduct(opts.product_id)).then(result => {
						if (exchange.debug_exchange) {
							debug.obj('exchange.getQuote - quote:', result)
						}
						cb(null, { bid: result.bid, ask: result.ask })
					})
					.catch(function (error) {
						console.error('An error occurred', error)
						return retry('getQuote', func_args)
					})
				}
				else {
					debug.msg('exchange.getQuote - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
//					setTimeout(function() { this.getQuote(opts, cb) }, (next_request - now() + 1))
					retry('getQuote', func_args, (next_request - now() + 1))
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
				var func_args = [].slice.call(arguments)
				
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var client = authedClient()
					client.cancelOrder(opts.order_id, joinProduct(opts.product_id)).then(function (body) {
						if (body) {
							debug.obj('exchange.cancelOrder - body:', body)
							if (body.id && exchange_cache && exchange_cache.openOrders['~' + body.id]) {
								exchange_cache.openOrders['~' + body.id] = body
							}
						}
						if (body && (body.message === 'Order already done' || body.message === 'order not found')) {
							return cb()
						}
						cb(null)
					}, function(err){
						// match error against string:
						// "binance {"code":-2011,"msg":"UNKNOWN_ORDER"}"

						if (err) {
							// decide if this error is allowed for a retry

							if (err.message && err.message.match(new RegExp(/-2011|UNKNOWN_ORDER/))) {
								console.error(('\ncancelOrder retry - unknown Order: ' + JSON.stringify(opts) + ' - ' + err).cyan)
//								return retry('cancelOrder', func_args, undefined, err)
							} else {
								// retry is allowed for this error
								return retry('cancelOrder', func_args, undefined, err)
							}
						}

						cb()
					})
				}
				else {
					debug.msg('exchange.cancelOrder - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
//					setTimeout(function() { this.cancelOrder(opts, cb) }, (next_request - now() + 1))
					retry('cancelOrder', func_args, (next_request - now() + 1))
				}
			},
			
			//Cancella tutti gli ordini dall'exchange
			cancelAllOrders: function (opts, cb) {
				var func_args = [].slice.call(arguments)

				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var client = authedClient()
					client.fetchOpenOrders(joinProduct(opts.product_id)).then(function (body) {
						console.log('exchange.cancelAllOrders - body:')

						//Azzero la cache
						exchange_cache.openOrders = {}
						body.forEach(function(order, index) {
							client.cancelOrder(order.id, joinProduct(opts.product_id)).then(function (body) {
								if (body) {
									console.log('exchange.cancelAllOrders - cancelOrder - body:')
									console.log(body)
								}
								if (body && (body.message === 'Order already done' || body.message === 'order not found')) {
									console.log('exchange.cancelAllOrders - Qualcosa non quadra. Body:')
									console.log(body)
								}
							}, function(err) {
								// match error against string:
								// "binance {"code":-2011,"msg":"UNKNOWN_ORDER"}"

								if (err) {
									// decide if this error is allowed for a retry

									if (err.message && err.message.match(new RegExp(/-2011|UNKNOWN_ORDER/))) {
										console.error(('\ncancelAllOrder retry - unknown Order: ' + JSON.stringify(opts) + ' - ' + err).cyan)
//										retry('cancelAllOrder', func_args, undefined, err)
									} else {
										// retry is allowed for this error
										retry('cancelAllOrder', func_args, undefined, err)
									}
								}
							})
						})
						cb(null, body)
					}, function(err) {
						return retry('cancelAllOrders', func_args, err)
					})		
				}
				else {
					debug.msg('exchange.cancelAllOrder - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					retry('cancelAllOrder', func_args, (next_request - now() + 1))
				}
			},
			
			//Cancella l'ordine dalla websocket_cache, in modo da non aumentarla a dismisura
			cancelOrderCache: function (opts) {
				if(exchange_cache) {
					delete exchange_cache.openOrders['~' + opts.order_id]
				}
			},

			buy: function (opts, cb) {
				var func_args = [].slice.call(arguments)
				
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var client = authedClient()
					if (typeof opts.post_only === 'undefined') {
						opts.post_only = true
					}
					opts.type = 'limit';
					var args = {}
					if (opts.order_type === 'taker') {
						delete opts.price
						delete opts.post_only
						opts.type = 'market'
					} else {
						args.timeInForce = 'GTC'
					}
					opts.side = 'buy';
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
						
						//Debug. Da togliere se funziona
						if (result) {
							debug.obj('exchange.buy - result:', result)
						}
						
						order = {
							id: result ? result.id : null,
							status: 'open',
							price: opts.price,
							size: this.roundToNearest(opts.size, opts),
							post_only: !!opts.post_only,
							created_at: result.timestamp, //new Date().getTime(),
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
//					setTimeout(function() { this.buy(opts, cb) }, (next_request - now() + 1))
					retry('buy', func_args, (next_request - now() + 1))
				}
			},

			sell: function (opts, cb) {
				var func_args = [].slice.call(arguments)
				
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

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
						
						//Debug. Da togliere se funziona
						if (result) {
							debug.obj('exchange.sell - result:', result)
						}
					
//						Dall'exchange:
//						{ info:
//						   { symbol: 'WAVESUSDT',
//						     orderId: 6186416,
//						     clientOrderId: 'WeKLBHrUQNPG7KmFHSsXnR',
//						     transactTime: 1554365500879,
//						     price: '2.60290000',
//						     origQty: '96.04000000',
//						     executedQty: '0.00000000',
//						     cummulativeQuoteQty: '0.00000000',
//						     status: 'NEW',
//						     timeInForce: 'GTC',
//						     type: 'LIMIT',
//						     side: 'BUY' },
//						  id: '6186416',
//						  timestamp: 1554365500879,
//						  datetime: '2019-04-04T08:11:40.879Z',
//						  symbol: 'WAVES/USDT',
//						  type: 'limit',
//						  side: 'buy',
//						  price: 2.6029,
//						  amount: 96.04,
//						  cost: 0,
//						  filled: 0,
//						  remaining: 96.04,
//						  status: 'open' }

						order = {
							id: result ? result.id : null,
							status: 'open',
							price: opts.price,
							size: this.roundToNearest(opts.size, opts),
							post_only: !!opts.post_only,
							created_at: result.timestamp, //new Date().getTime(),
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
//					setTimeout(function() { this.sell(opts, cb) }, (next_request - now() + 1))
					retry('sell', func_args, (next_request - now() + 1))
				}
			},

			roundToNearest: function(numToRound, opts) {
				var numToRoundTo = _.find(this.getProducts(), { 'asset': opts.product_id.split('-')[0], 'currency': opts.product_id.split('-')[1] }).min_size
				numToRoundTo = 1 / (numToRoundTo)

				return Math.floor(numToRound * numToRoundTo) / numToRoundTo
			},
			
			getOrder: function (opts, forced = false, cb) {
				var func_args = [].slice.call(arguments)
				if (exchange.debug_exchange) {
					debug.msg('exchange.getOrder')
				}
				
				if (typeof forced == 'function') {
					cb = forced
					forced = false
				}

				if (!forced && exchange_cache && exchange_cache.openOrders['~' + opts.order_id]) {
					let order_tmp = exchange_cache.openOrders['~' + opts.order_id]
//					debug.obj('exchange.getOrder - exchange_cache.openOrders:', order_tmp)
					
					let order_cache = {
							id: order_tmp.id,
							created_at: order_tmp.timestamp,
							done_at: order_tmp.info.updateTime,
							price: order_tmp.price,
							size: order_tmp.amount,
							product_id: order_tmp.symbol,
							side: order_tmp.side,
							status: order_tmp.status,
//							settled: false,
							filled_size: order_tmp.filled,
							executed_value: order_tmp.cost,
							fill_fees: order_tmp.fee ? order_tmp.fee.cost : 0,
							currency_fees: order_tmp.fee ? order_tmp.fee.currency : 0
					}
					
					if (exchange.debug_exchange) {
						debug.obj('exchange.getOrder - exchange_cache:', order_cache)
					}

					cb(null, order_cache)
					return
				}				
				else if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var client = authedClient()
					client.fetchOrder(opts.order_id, joinProduct(opts.product_id)).then(function (body) {
//						{
//						'id':                '12345-67890:09876/54321', // string
//						'datetime':          '2017-08-17 12:42:48.000', // ISO8601 datetime of 'timestamp' with milliseconds
//						'timestamp':          1502962946216, // order placing/opening Unix timestamp in milliseconds
//						'lastTradeTimestamp': 1502962956216, // Unix timestamp of the most recent trade on this order
//						'status':     'open',         // 'open', 'closed', 'canceled'
//						'symbol':     'ETH/BTC',      // symbol
//						'type':       'limit',        // 'market', 'limit'
//						'side':       'buy',          // 'buy', 'sell'
//						'price':       0.06917684,    // float price in quote currency
//						'amount':      1.5,           // ordered amount of base currency
//						'filled':      1.1,           // filled amount of base currency
//						'remaining':   0.4,           // remaining amount to fill
//						'cost':        0.076094524,   // 'filled' * 'price' (filling price used where available)
//						'trades':    [ ... ],         // a list of order trades/executions
//						'fee': {                      // fee info, if available
//							'currency': 'BTC',        // which currency the fee is (usually quote)
//							'cost': 0.0009,           // the fee amount in that currency
//							'rate': 0.002,            // the fee rate (if available)
//						},
//						'info': { ... },              // the original unparsed order structure as is
//						}
						
						debug.obj('exchange.getOrder - fetchOrder:', body)
						
						let order_tmp = {
								id: body.id,
								created_at: body.timestamp,
								done_at: body.info.updateTime,
								price: body.price,
								size: body.amount,
								product_id: body.symbol,
								side: body.side,
								status: body.status,
//								settled: false,
								filled_size: body.filled,
								executed_value: body.cost,
								fill_fees: body.fee ? body.fee.cost : 0,
								currency_fees: body.fee ? body.fee.currency : 0,
								rate_fees: body.fee ? body.fee.rate : 0
						}

						if (order_tmp.status !== 'open' && order_tmp.status !== 'canceled') {
//							console.log('getOrder - fetchOrder: order done!')
							order_tmp.status = 'done'
						}
						cb(null, order_tmp)
					}, function(err) {
						return retry('getOrder', func_args, undefined, err)
					})
				}
				else {
					debug.msg('exchange.getOrder - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
//					setTimeout(function() { this.getOrders(opts, cb) }, (next_request - now() + 1))
					retry('getOrder', func_args, (next_request - now() + 1))
				}
			},

			getAllOrders: function (opts, cb = function() {}) {
				var func_args = [].slice.call(arguments)
				if (exchange.debug_exchange) {
					debug.msg('exchange.getAllOrder - order ')
				}

				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var client = authedClient()
					client.fetchOpenOrders(joinProduct(opts.product_id)).then(function (body) {
//						console.log('exchange.getAllOrders - body:')
//						console.log(body)
						//Azzero la cache e la riscrivo con i valori ricevuti
						exchange_cache.openOrders = {}
						body.forEach(function(order, index) {
//							delete order.info
							if (exchange.debug_exchange) {
								debug.obj('exchange.getAllOrder - order ' + order.id, order)
							}
							exchange_cache.openOrders['~' + order.id] = order
						})
						cb(null, body)
					}, function(err) {
						return retry('getAllOrders', func_args, undefined, err)
					})
				}
				else {
					debug.msg('exchange.getAllOrder - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
//					setTimeout(function() { this.getAllOrders(opts, cb) }, (next_request - now() + 1))
					retry('getAllOrders', func_args, (next_request - now() + 1))
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
