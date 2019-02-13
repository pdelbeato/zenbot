let debug = require('../../../lib/debug')
var Gdax = require('gdax')
, minimist = require('minimist')
//Se funziona la gestione della memoria, si può cancellare insieme alla funzione getMemory()
, sizeof = require('object-sizeof')

module.exports = function gdax (conf) {
	var so = minimist(process.argv)
	var public_client = {}, authed_client, websocket_client = {}, websocket_cache = {}
	var max_requests_per_second = 5
	var next_request = 0
	var last_heartbeat_time = 0

	function now() {
		return new Date().getTime()
	}

	function publicClient (product_id, forced = false) {
		if (!public_client[product_id] || forced) {
			websocketClient(product_id)
			public_client[product_id] = new Gdax.PublicClient(conf.gdax.apiURI)
		}
		return public_client[product_id]
	}
	
//	//Se ho risolto diversamente, togliere questo obbrobrio da qui e da trade e engine
//	function resetPublicClient (product_id) {
//		debug.msg('resetPublicClient')
//		publicClient (product_id, true)
//	}

	function websocketClient (product_id) {
		//Se non esiste il websocket_client
		if (!websocket_client[product_id]) {
			var auth = null
			var client_state = {}
			if (conf.gdax.key && conf.gdax.key !== 'YOUR-API-KEY') {
				auth = {
						key: conf.gdax.key, 
						secret: conf.gdax.b64secret, 
						passphrase: conf.gdax.passphrase
				}
			}

			//'heartbeat' è aggiunto in automatico, ma lo indico per tenerne traccia
			var channels = ['matches', 'ticker', 'heartbeat']

			// subscribe to user channels which need fully auth data
			if (auth) {
				channels.push('user')
			}

			// Apro un websocket autenticato, quindi riceverò anche tutti i messaggi che riguardano il mio user_id
			websocket_client[product_id] = new Gdax.WebsocketClient([product_id], conf.gdax.websocketURI, auth, {channels})

			// initialize a cache for the websocket connection (if it does not exist)
			if (!websocket_cache[product_id]) {
				websocket_cache[product_id] = {
						trades: [],
						trade_ids: [],
						orders: {},
						ticker: {},
						heartbeat: {}
				}
			}

			websocket_client[product_id].on('open', () => {
				debug.msg('websocket connection to ' + product_id + ' opened')
				//Attendo 10s e poi attivo un controllo ogni 10s sulla connessione
				setTimeout(() => {
					setInterval(() => {
						heartbeat_time = Date.parse(websocket_cache[product_id].heartbeat.time)
						if (heartbeat_time > last_heartbeat_time) {
//							console.log('websocket_client - Aggiorno last_heartbeat_time')
							last_heartbeat_time = heartbeat_time
						}
						else {
							console.log('websocket_client - Non ricevo heartbeat da 10s. heartbeat.time= ' +  heartbeat_time + ' ; last_heartbeat_time= ' + last_heartbeat_time)
							console.log('websocket client - Riconnetto websocket')
							websocket_client[product_id].disconnect()
//							websocket_client[product_id] = null
//							websocketClient(product_id)
						}
					}, 10000)
				}, 10000)
			})

			websocket_client[product_id].on('message', (message) => {
				// all messages with user_id are related to trades for current authenticated user
				if(message.user_id){
					debug.msg('websocket USER channel income: \n')
					debug.msg(message, false)

					switch (message.type) {
					case 'open':
						handleOrderOpen(message, product_id)
						break
					case 'received':
						handleOrderReceived(message, product_id)
						break
					case 'done':
						handleOrderDone(message, product_id)
						break
					case 'change':
						handleOrderChange(message, product_id)
						break
					case 'match':
						handleOrderMatch(message, product_id)
						break
					default:
						break
					}
				}

				//Non sono messaggi relativi al mio user_id
				switch (message.type) {
				case 'open':
					break
				case 'done':
					break
				case 'change':
					break
				case 'match':
					handleTrade(message, product_id)
					break
				case 'ticker':
					handleTicker(message, product_id)
					break
				case 'heartbeat':
					handleHeartbeat(message, product_id)
					break
				default:
					break
				}
			})

			websocket_client[product_id].on('error', (err) => {
				client_state.errored = true

				debug.msg('Websocket error: \n')
				debug.msg(err, false)
				debug.msg('\nRestarting websocket connection', false)

				websocket_client[product_id].disconnect()
				websocket_client[product_id] = null
				//Non azzero la cache. Verrà inizializzata dalla chiamata a websocketClient se non dovesse esistere 
//				websocket_cache[product_id] = null
				websocketClient(product_id)
			})

			websocket_client[product_id].on('close', () => {
				if (client_state.errored){
					client_state.errored = false
					return
				}

				debug.msg('websocket connection to ' + product_id + ' closed, attempting reconnect')

				websocket_client[product_id] = null
				websocket_client[product_id] = websocketClient(product_id)
				
				let count = 1;
			    // attempt to re-connect every 30 seconds.
			    // TODO: maybe use an exponential backoff instead
			    const interval = setInterval(() => {
			        if (!websocket_client[product_id]) {
			            count++;

			            // error if it keeps failing every 10/2 = 5 minutes
			            if (count % 10 === 0) {
			                const time_since = 30 * count;
			                console.log('Websocket Error - Attempting to re-connect for the ${count} time. It has been ${time_since} seconds since we lost connection.');
			            }
			            websocket_client[product_id] = websocketClient(product_id)
			        }
			        else {
			            clearInterval(interval);
			        }
			    }, 30000);
			})
		}
		
		return websocket_client[product_id]
	}

	function authedClient () {
		if (!authed_client) {
			if (!conf.gdax || !conf.gdax.key || conf.gdax.key === 'YOUR-API-KEY') {
				throw new Error('please configure your GDAX credentials in conf.js')
			}
			authed_client = new Gdax.AuthenticatedClient(conf.gdax.key, conf.gdax.b64secret, conf.gdax.passphrase, conf.gdax.apiURI)
		}
		return authed_client
	}

	function statusErr (resp, body) {
		if (resp.statusCode !== 200) {
			var err = new Error('non-200 status: ' + resp.statusCode)
			err.code = 'HTTP_STATUS'
				err.body = body
				return err
		}
	}

	function retry (method, args, err) {
		if (method !== 'getTrades') {
			console.error(('\nretry - GDAX API is down! unable to call ' + method + ', retrying in 10s').red)
			if (err) console.error('retry - err= \n\n' + err)
			console.error('\nretry - args.slice')
			console.error(args.slice(0, -1)) //slice prende l'ultimo valore di args
		}
		setTimeout(function () {
			exchange[method].apply(exchange, args)
		}, 10000)
	}

	function handleOrderOpen(update, product_id) {
		websocket_cache[product_id].orders['~'+update.order_id] = {
				id: update.order_id,
				price: update.price,
				size: update.remaining_size,
				product_id: update.product_id,
				side: update.side,
				status: 'open',
				settled: false,
				filled_size: 0
		}
	}

	function handleOrderReceived(update, product_id) {

		/*	{ type: 'received',
			  order_id: 'bb0b6f2f-ad10-44d9-b915-0c32eaa74573',
			  order_type: 'market',
			  size: '0.00833138',
			  side: 'buy',
			  funds: '26.3167465750000000',
		  	  client_oid: '',
			  product_id: 'BTC-EUR',
			  sequence: 5040297451,
			  user_id: '59ec8252f3a4f2013b610919',
			  profile_id: 'cc709acd-c35b-492b-92f9-0a77ba16eeed',
			  time: '2019-02-08T16:48:52.983000Z' }
		 */

		if (!websocket_cache[product_id].orders['~'+update.order_id]) {
			websocket_cache[product_id].orders['~'+update.order_id] = {
					id: update.order_id,
					size: update.size,
					product_id: update.product_id,
					side: update.side,
					status: 'received',
					settled: false,
					filled_size: 0
			}
		}
	}

	function handleOrderDone(update, product_id) {
		let cached_order = websocket_cache[product_id].orders['~'+update.order_id]
		if (cached_order) {
			/*
	      	order canceled by user or on platform: which must be retried see "reason":
			  { type: 'done',
			    side: 'sell',
			    order_id: 'xxxx',
			    reason: 'canceled',
			    product_id: 'LTC-EUR',
			    price: '142.33000000',
			    remaining_size: '1.24390150',
			    sequence: 1337,
			    user_id: '5a2aeXXX',
			    profile_id: 'xxx',
			    time: '2018-03-09T16:28:49.293000Z'
			  }

			  complete order response; no further action:
			  { type: 'done',
			    side: 'sell',
			    order_id: 'xxxx',
			    reason: 'filled',
			    product_id: 'LTC-EUR',
			    price: '142.81000000',
			    remaining_size: '0.00000000',
			    sequence: 1337,
			    user_id: '5a2aeXXX',
			    profile_id: 'xxx',
			    time: '2018-03-09T16:56:39.352000Z'
			  }

			 */

			// get order "reason":
			//  - "canceled" by user or platform
			//  - "filled" order successfully placed and filled
			let reason = update.reason

			cached_order.status = 'done'

				// "canceled" is not a success order instead it must be retried
				// force zenbot a order retry; see "engine.js" for possible retry conditions
				if (reason && reason == 'canceled') {
					cached_order.status = 'rejected'
						cached_order.reject_reason = 'post only'
				}

			cached_order.done_at = update.time
			cached_order.done_reason = reason
			cached_order.settled = true
		}
		//Non è presente nella cache, ma dovrebbe, visto che se siamo in questa funzione allora lo user_id corrispondeva al mio
		else {
			debug.msg('**** handleOrderDone - Creo ordine e lo inserisco in websocket_cache')

			//Da sistemare bene nei casi filled e canceled
			cached_order = websocket_cache[product_id].orders['~'+update.order_id] = {
				id: update.order_id,
				price: update.price,
				size: update.remaining_size,
				product_id: update.product_id,
				side: update.side,
				status: 'rejected',
				settled: true,
				filled_size: 0
			}

			// get order "reason":
			//  - "canceled" by user or platform
			//  - "filled" order successfully placed and filled
			let reason = update.reason

			cached_order.status = 'done'

				// "canceled" is not a success order instead it must be retried
				// force zenbot a order retry; see "engine.js" for possible retry conditions
				if (reason && reason == 'canceled') {
					cached_order.status = 'rejected'
						cached_order.reject_reason = 'post only'
				}

			cached_order.done_at = update.time
			cached_order.done_reason = reason
			cached_order.settled = true			
		}
	}

	function handleOrderChange(update, product_id) {
		var cached_order = websocket_cache[product_id].orders['~'+update.order_id]
		if(cached_order && update.new_size){
			cached_order.size = update.new_size
		}
	}

	function handleOrderMatch(update, product_id) {
		var cached_order = websocket_cache[product_id].orders['~'+update.maker_order_id] || websocket_cache[product_id].orders['~'+update.taker_order_id]
		if (cached_order) {
			cached_order.price = update.price
			//cached_order.filled_size = (parseFloat(cached_order.filled_size) + update.size).toString()
			cached_order.filled_size = (parseFloat(cached_order.filled_size) + parseFloat(update.size)).toString()
			debug.msg('handleOrderMatch: cached_order.filled_size= ' + cached_order.filled_size)

			//Aggiunto per risolvere il problema dell'invalid date in caso di partial filled
			cached_order.done_at = update.time
			debug.msg('handleOrderMatch: cached_order.done_at= ' + cached_order.done_at)
		}
		else {
			debug.msg('**** handleOrderMatch - Non posso creare ordine che succede un macello')
			/*
			  {
				    "type": "match",
				    "trade_id": 10,
				    "sequence": 50,
				    "maker_order_id": "ac928c66-ca53-498f-9c13-a110027a60e8",
				    "taker_order_id": "132fb6ae-456b-4654-b4e0-d681ac05cea1",
				    "time": "2014-11-07T08:19:27.028459Z",
				    "product_id": "BTC-USD",
				    "size": "5.23512",
				    "price": "400.23",
				    "side": "sell"
				}
			 */
//			order_id = 
//			cached_order = websocket_cache[product_id].orders['~'+update.order_id] = {
//			id: update.order_id,
//			price: update.price,
//			size: update.size,
//			product_id: update.product_id,
//			side: update.side,
//			status: 'match',
//			settled: true,
//			filled_size: update.size,
//			}		
		}
	}

	function handleTrade(trade, product_id) {
		var cache = websocket_cache[product_id]
		cache.trades.push(trade)
		cache.trade_ids.push(trade.trade_id)
	}

	function handleTicker(ticker, product_id) {
		/*
		  	{
			    "type": "ticker",
			    "trade_id": 20153558,
			    "sequence": 3262786978,
			    "time": "2017-09-02T17:05:49.250000Z",
			    "product_id": "BTC-USD",
			    "price": "4388.01000000",
			    "side": "buy", // Taker side
			    "last_size": "0.03000000",
			    "best_bid": "4388",
			    "best_ask": "4388.01"
			}
		 */

		websocket_cache[product_id].ticker = ticker
	}
	
	function handleHeartbeat(heartbeat, product_id) {
		/*
		  	// Heartbeat message
			{
			    "type": "heartbeat",
			    "sequence": 90,
			    "last_trade_id": 20,
			    "product_id": "BTC-USD",
			    "time": "2014-11-07T08:19:28.464459Z"
			}
		 */
		websocket_cache[product_id].heartbeat = heartbeat
		//console.log(heartbeat)
	}

	var orders = {}

	var exchange = {
			name: 'gdax',
			historyScan: 'backward',
			makerFee: 0,
			takerFee: 0.3,
			backfillRateLimit: 335,

			getProducts: function () {
				return require('./products.json')
			},

			getTrades: function getTrades (opts, cb) {
				var func_args = [].slice.call(arguments)
				var client = publicClient(opts.product_id)
				var args = {}
				if (opts.from) {
					// move cursor into the future
					args.before = opts.from
				}
				else if (opts.to) {
					// move cursor into the past
					args.after = opts.to
				}
				// check for locally cached trades from the websocket feed
				var cache = websocket_cache[opts.product_id]
				var max_trade_id = cache.trade_ids.reduce(function(a, b) {
					return Math.max(a, b)
				}, -1)
				if (opts.from && max_trade_id >= opts.from) {
					var fromIndex = cache.trades.findIndex((value) => {
						return value.trade_id == opts.from
					})
					var newTrades = cache.trades.slice(fromIndex + 1)
					newTrades = newTrades.map(function (trade) {
						return {
							trade_id: trade.trade_id,
							time: new Date(trade.time).getTime(),
							size: Number(trade.size),
							price: Number(trade.price),
							side: trade.side
						}
					})
					newTrades.reverse()
					cb(null, newTrades)
					// trim cache
					cache.trades = cache.trades.slice(fromIndex)
					cache.trade_ids = cache.trade_ids.slice(fromIndex)
					return
				}

				debug.msg('getTrades - getproducttrades call')
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					/*
					 * [{
						    "time": "2014-11-07T22:19:28.578544Z",
						    "trade_id": 74,
						    "price": "10.00000000",
						    "size": "0.01000000",
						    "side": "buy"
						}, {
						    "time": "2014-11-07T01:08:43.642366Z",
						    "trade_id": 73,
						    "price": "100.00000000",
						    "size": "0.01000000",
						    "side": "sell"
						}]
					 */
					client.getProductTrades(opts.product_id, args, function (err, resp, body) {
						if (!err) {
							err = statusErr(resp, body)
						}
						if (err) {
							return retry('getTrades', func_args, err)
						}
						var trades = body.map(function (trade) {
							return {
								trade_id: trade.trade_id,
								time: new Date(trade.time).getTime(),
								size: Number(trade.size),
								price: Number(trade.price),
								side: trade.side
							}
						})
						trades.reverse()
						
						debug.msg('getTrades - Lista trades (se vuota, allora in so.poll_trades non sono avvenuti trades. Se non vuota, allora esiste un problema con il websocket):')
						console.log(trades)
						
						cb(null, trades)
					})
				}
				else {
					debug.msg('getTrades - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { getTrades(opts, cb) }, (next_request - now() + 1))
				}
			},

			getBalance: function getBalance(opts, cb) {
				var func_args = [].slice.call(arguments)
				var client = authedClient()

//				debug.msg('getBalance - getaccounts call')
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					client.getAccounts(function (err, resp, body) {
						if (!err) err = statusErr(resp, body)
						if (err) return retry('getBalance', func_args, err)
						var balance = {asset: 0, currency: 0}
						body.forEach(function (account) {
							if (account.currency === opts.currency) {
								balance.currency = account.balance
								balance.currency_hold = account.hold
							}
							else if (account.currency === opts.asset) {
								balance.asset = account.balance
								balance.asset_hold = account.hold
							}
						})
						cb(null, balance)
					})}
				else {
					debug.msg('getBalance - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { getBalance(opts, cb) }, (next_request - now() + 1))
				}
			},

			getQuote: function getQuote(opts, cb, forced = false) {
				// check websocket cache first, if it is not forced
				if (!forced && websocket_cache[opts.product_id]) {
					var ticker = websocket_cache[opts.product_id].ticker
					if (ticker.best_ask && ticker.best_bid) {
						cb(null, {bid: ticker.best_bid, ask: ticker.best_ask})
						return
					}
				}
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = publicClient(opts.product_id)
					debug.msg('getQuote - forced getProductTicker call')
					client.getProductTicker(opts.product_id, function (err, resp, body) {
						if (!err) err = statusErr(resp, body)
						if (err) return retry('getQuote', func_args, err)
						if (body.bid || body.ask) {
							debug.msg('getQuote - bid= ' + body.bid + '; ask= ' + body.ask)
							websocket_cache[opts.product_id].ticker = {
								best_ask: body.ask,
								best_bid: body.bid
							}
							cb(null, {bid: body.bid, ask: body.ask})
						}
						else
							cb({code: 'ENOTFOUND', body: opts.product_id + ' has no liquidity to quote'})
					})
				}
				else {
					debug.msg('getQuote forced - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { getQuote(opts, cb, forced) }, (next_request - now() + 1))
				}
			},

			//Cancella l'ordine dalla websocket_cache, in modo da non aumentarla a dismisura
			cancelOrderCache: function (opts) {
				if(websocket_cache[opts.product_id]) {
					delete websocket_cache[opts.product_id].orders['~' + opts.order_id]
				}
			},

			cancelOrder: function cancelOrder(opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()

					debug.msg('cancelOrder - cancelorder call')

					client.cancelOrder(opts.order_id, function (err, resp, body) {
						if (err) {
							debug.msg('cancelOrder: err= ')
							debug.obj('err', err, false)
						}

//						if (resp) {
//						debug.msg('cancelOrder: Response= ')
//						debug.msg(resp, false)
//						}

						if (body) {
							debug.msg('cancelOrder: Body= ')
							debug.obj('body', body, false)
						}

						if (resp && !body) {
							body = response.body
						}

//						if (body && (body.message === 'Order already done' || body.message === 'order not found')) {
//						debug.msg('cancelOrder -  Hai fatto bene a correggere!!! resp.body.message = body.message: ' + body.message)
//						return cb()
//						}

						if (err && err.data && (err.data.message == 'Order already done' || err.data.message === 'order not found')) {
							debug.msg('cancelOrder -  Hai fatto male a correggere!!! err.data.message: ' + err.data.message)
							return cb()
						}

						if (!err) {
							err = statusErr(resp, body)
						}

						if (err) {
							return retry('cancelOrder', func_args, err)
						}

						cb()
					})
				}
				else {
					debug.msg('cancelOrder - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { cancelOrder(opts, cb) }, (next_request - now() + 1))
				}
			},

			cancelAllOrders: function cancelAllOrders(opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()

					debug.msg('cancelAllOrders - cancelAllOrders call')

					client.cancelAllOrders(opts, function (err, resp, body) {
						if (err) {
							debug.msg('cancelAllOrders: err= ')
							debug.obj('err', err, false)
						}

//						if (body) {
//						debug.msg('cancelAllOrders - body: ')
//						console.log(body)
//						}

//						if (resp) {
//						debug.msg('cancelAllOrders - resp: ')
//						console.log(resp)
//						}

						if (err) {
							debug.msg('cancelAllOrders -  err: ')
							console.log(err)
							return cb(err)
						}			

						cb(null, body)
					})
				}
				else {
					debug.msg('cancelAllOrders - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { cancelAllOrders(opts, cb) }, (next_request - now() + 1))
				}
			},

			buy: function buy(opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()
					if (typeof opts.post_only === 'undefined') {
						opts.post_only = true
					}
					if (opts.order_type === 'taker') {
						delete opts.price
						delete opts.post_only
						delete opts.cancel_after
						opts.type = 'market'
					}
					else {
						if (opts.cancel_after) {
							opts.time_in_force = 'GTT'
						}
						else {
							opts.time_in_force = 'GTC'
						}
					}
					delete opts.order_type

					debug.msg('buy - buy call')

					client.buy(opts, function (err, resp, body) {

						if (err) {
							debug.msg('buy: err= ')
							debug.obj('err', err, false)
						}

//						if (resp) {
//						debug.msg('buy: Response= ')
//						debug.msg(resp, false)
//						}

						if (body) {
							debug.msg('buy: Body= ')
							debug.obj('body', body, false)
						}

						if (resp && !body) {
							body = response.body
						}

						if (body && (body.message === 'Insufficient funds')) {
							debug.msg('buy -  Hai fatto bene a correggere!!! resp.body.message = body.message: ' + body.message)
							return cb()
						}

//						if (body && body.message === 'Insufficient funds') {
						//Verificato con sandbox. La risposta è in err.data.message
						if (err && err.data && err.data.message === 'Insufficient funds') {
							debug.msg('buy -  Hai fatto male a correggere!!! err.data.message: ' + err.data.message)
							return cb(null, {
								status: 'rejected',
								reject_reason: 'balance'
							})
						}

						if (!err) {
							err = statusErr(resp, body)
						}

						if (err) {
							return retry('buy', func_args, err)
						}

						orders['~' + body.id] = body
						cb(null, body)
					})
				}
				else {
					debug.msg('buy - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { buy(opts, cb) }, (next_request - now() + 1))
				}
			},

			sell: function sell(opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()

					if (typeof opts.post_only === 'undefined') {
						opts.post_only = true
					}

					if (opts.order_type === 'taker') {
						delete opts.price
						delete opts.post_only
						delete opts.cancel_after
						opts.type = 'market'
					}
					else {
						if (opts.cancel_after) {
							opts.time_in_force = 'GTT'
						}
						else {
							opts.time_in_force = 'GTC'
						}
					}
					delete opts.order_type

					debug.msg('sell - sell call')

					client.sell(opts, function (err, resp, body) {

						if (err) {
							debug.msg('sell err= ')
							debug.obj('err', err, false)
						}

						if (body) {
							debug.msg('sell: Body= ')
							debug.obj('body', body, false)
						}

						if (resp && !body) {
							body = response.body
						}

						if (body && (body.message === 'Insufficient funds')) {
							debug.msg('sell -  Hai fatto bene a correggere!!! resp.body.message = body.message: ' + body.message)
							return cb()
						}

//						if (body && body.message === 'Insufficient funds') {
						if (err && err.data && err.data.message === 'Insufficient funds') {
							debug.msg('sell -  Hai fatto male a correggere!!! err.data.message: ' + err.data.message)
							return cb(null, {
								status: 'rejected',
								reject_reason: 'balance'
							})
						}

						if (!err) {
							err = statusErr(resp, body)
						}

						if (err) {
							return retry('sell', func_args, err)
						}

						orders['~' + body.id] = body
						cb(null, body)
					})
				}
				else {
					debug.msg('sell - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { sell(opts, cb) }, (next_request - now() + 1))
				}
			},

			getOrder: function getOrder(opts, cb) {
				if(websocket_cache[opts.product_id] && websocket_cache[opts.product_id].orders['~' + opts.order_id]) {
					let order_cache = websocket_cache[opts.product_id].orders['~' + opts.order_id]

//					debug.msg('getOrder - websocket cache:')
//					debug.msg(order_cache, false)

					cb(null, order_cache)
					return
				}

				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()

					debug.msg('getOrder - getOrder call')

					/*
			 	getOrder
			    { id: '92a24124-067b-4d3c-b79f-afdc1a13eaea',
			    price: '5571.79000000',
			    size: '0.04487500',
			    product_id: 'BTC-EUR',
			    side: 'buy',
			    type: 'limit',
			    time_in_force: 'GTT',
			    expire_time: '2018-10-24T12:03:57',
			    post_only: true,
			    created_at: '2018-10-23T12:03:58.612863Z',
			    reject_reason: 'post only',
			    fill_fees: '0.0000000000000000',
			    filled_size: '0.00000000',
			    executed_value: '0.0000000000000000',
			    status: 'rejected',
			    settled: false }

			    websocket
			    { 	id: update.order_id,
					price: update.price,
					size: update.remaining_size,
					product_id: update.product_id,
					side: update.side,
					status: 'open',
					settled: false,
					filled_size: 0 }

					 */

					client.getOrder(opts.order_id, function (err, resp, body) {
						if (!err && resp.statusCode === 200) {
							debug.msg('**** getOrder - Ordine trovato. Lo inserisco in websocket_cache.')
							websocket_cache[opts.product_id].orders['~' + opts.order_id] = {
								id: body.id,
								price: body.price,
								size: body.size, //Dovrebbe essere remaining_size, ma non ce l'ho tramite getOrder e calcolarlo senza Numbro è pericoloso
								product_id: body.product_id,
								side: body.side,
								status: body.status,
								settled: body.settled,
								filled_size: Number(body.filled_size)
							}
						}

						if (!err && resp.statusCode !== 404) {
							err = statusErr(resp, body)
							debug.msg('getOrder - !404 (' + resp.statusCode + '):')
							if (err)
								debug.obj('err', err, false)
						}

//						if (resp) {
//						debug.msg('getOrder - resp: ')
//						debug.obj(resp, false)
//						}

						if (body) {
							debug.msg('getOrder - body: ')
							debug.obj('body', body, false)
						}

						if (resp && !body) {
							body = response.body
						}

						if (body && (body.message === 'Order already done' || body.message === 'order not found')) {
							debug.msg('getOrder -  Hai fatto bene a correggere!!! resp.body.message = body.message: ' + body.message)
							return cb()
						}

						if (err && err.data && (err.data.message == 'Order already done' || err.data.message === 'order not found')) {
							debug.msg('getOrder -  Hai fatto male a correggere!!! err.data.message: ' + err.data.message)
							return cb()
						}				

						if (resp && resp.statusCode === 404) {
							// order was cancelled. recall from cache
							body = orders['~' + opts.order_id]
							body.status = 'done'
								body.done_reason = 'canceled'
						}

						if (err) {
							return retry('getOrder', func_args, err)
						}

						cb(null, body)
					})
				}
				else {
					debug.msg('getOrder - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { getOrder(opts, cb) }, (next_request - now() + 1))
				}
			},

			getAllOrders: function getAllOrders(opts, cb) {
				if (now() > next_request) {
					next_request = now() + 1000/max_requests_per_second

					var func_args = [].slice.call(arguments)
					var client = authedClient()

					debug.msg('getAllOrders - getAllOrders call')

					client.getOrders(opts, function (err, resp, body) {
						if (!err && resp.statusCode !== 404) {
							err = statusErr(resp, body)
							debug.msg('getOrder - !404 (' + resp.statusCode + '):')
							if (err)
								debug.obj('err', err, false)
						}

//						if (body) {
//						debug.msg('getAllOrders - body: ')
//						console.log(body)
//						}

//						if (resp) {
//						debug.msg('getAllOrders - resp: ')
//						console.log(resp)
//						}

						if (err) {
							debug.msg('getAllOrders -  err: ')
							console.log(err)
							return cb(err)
						}			

						cb(null, body)
					})
				}
				else {
					debug.msg('getAllOrders - Attendo... (now()=' + now() + ' ; next_request ' + next_request + ')')
					setTimeout(function() { getAllOrders(opts, cb) }, (next_request - now() + 1))
				}
			},

			// return the property used for range querying.
			getCursor: function (trade) {
				return trade.trade_id
			},

			getMemory: function() {
				return sizeof(websocket_cache)
			}
	}
	return exchange
}
