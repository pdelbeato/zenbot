let path = require('path')
, n = require('numbro')
, _ = require('lodash')

module.exports = function sim (conf, s) {

	let latency = 100 // In milliseconds, enough to be realistic without being disruptive
	let so = s.options
	let exchange_id = so.selector.exchange_id
	let real_exchange = require(path.resolve(__dirname, `../${exchange_id}/exchange`))(conf)

	var balance = {
		asset: so.asset_capital,
		currency: so.currency_capital,
		asset_hold: 0,
		currency_hold: 0
	}

	var last_order_id = 1001
	var orders = {}
	var openOrders = {}
	let debug = false // debug output specific to the sim exchange
	var now = 0

	s.wait_processTrade = false
	
//	function now() {
//	return new Date().getTime()
//	}

	// When orders change in any way, it's likely our "_hold" values have changed. Recalculate them
	function recalcHold(cb = function() {}) {
		balance.currency_hold = 0
		balance.asset_hold = 0
		_.each(openOrders, function(order) {
			if (order.tradetype === 'buy') {
				balance.currency_hold += n(order.remaining_size).multiply(n(order.price)).value()
			}
			else {
				balance.asset_hold += n(order.remaining_size).value()
			}
		})
		cb()
	}

	var exchange = {
			name: 'sim',
			historyScan: real_exchange.historyScan,
			historyScanUsesTime: real_exchange.historyScanUsesTime,
			makerFee: real_exchange.makerFee,
			takerFee: real_exchange.takerFee,
			dynamicFees: real_exchange.dynamicFees,
			
			getProducts: real_exchange.getProducts,

			getTrades: function (opts, cb) {
				if (so.mode === 'paper') {
					return real_exchange.getTrades(opts, cb)
				}
				else {
					return cb(null, [])
				}
			},

			getBalance: function (opts, cb) {
				setTimeout(function() {
					s.sim_asset = balance.asset
					return cb(null, balance)
				}, latency)
			},

			getQuote: function (opts, cb) {
				if (so.mode === 'paper') {
					return real_exchange.getQuote(opts, cb)
				}
				else {
					setTimeout(function() {
						return cb(null, {
							bid: s.period.close,
							ask: s.period.close
						})
					}, latency)
				}
			},

			cancelOrder: function (opts, cb) {
				setTimeout(function() {
					var order_id = '~' + opts.order_id
					var order = orders[order_id]

					if (order.status === 'open') {
						order.status = 'cancelled';
						delete openOrders[order_id]
						recalcHold(function() {
							cb(null)
						})
					}
					else {
						cb(null)
					}
				}, latency)
			},

			cancelAllOrders: function (opts, cb) {
				setTimeout(function() {
					_.each(orders, function(order) {
						if (order.status === 'open') {
							order.status = 'cancelled';
							delete openOrders[order.order_id]
							recalcHold()
						}
					})

					cb(null)
				}, latency)
			},

			cancelOrderCache: function (opts) {
				return
			},

			buy: function (opts, cb) {
				setTimeout(function() {
					if (debug) console.log(`buying ${opts.size * opts.price} vs on hold: ${balance.currency} - ${balance.currency_hold} = ${balance.currency - balance.currency_hold}`)
					if (opts.size * opts.price > (balance.currency - balance.currency_hold)) {
						if (debug) console.log('nope')
						return cb(null, { status: 'rejected', reject_reason: 'balance'})
					}

					var result = {
							id: last_order_id++
					}

					var order = {
							id: result.id,
							status: 'open',
							price: opts.price,
							size: opts.size,
							orig_size: opts.size,
							remaining_size: opts.size,
							post_only: !!opts.post_only,
							filled_size: 0,
							executed_value: 0,
							ordertype: opts.order_type,
							tradetype: 'buy',
							orig_time: now,
							time: now,
							created_at: now,
							done_at: null,
							fill_fees: 0,
							currency_fees: null
					}

					orders['~' + result.id] = order
					openOrders['~' + result.id] = order
					recalcHold(function() {
						cb(null, order)
					})
				}, latency)
			},

			sell: function (opts, cb) {
				setTimeout(function() {
					if (debug) console.log(`selling ${opts.size} vs on hold: ${balance.asset} - ${balance.asset_hold} = ${balance.asset - balance.asset_hold}`)
					if (opts.size > (balance.asset - balance.asset_hold)) {
						if (debug) console.log('nope')
						return cb(null, { status: 'rejected', reject_reason: 'balance'})
					}

					var result = {
							id: last_order_id++
					}

					var order = {
							id: result.id,
							status: 'open',
							price: opts.price,
							size: opts.size,
							orig_size: opts.size,
							remaining_size: opts.size,
							post_only: !!opts.post_only,
							filled_size: 0,
							executed_value: 0,
							ordertype: opts.order_type,
							tradetype: 'sell',
							orig_time: now,
							time: now,
							created_at: now,
							done_at: null,
							fill_fees: 0,
							currency_fees: null
					}
					
					orders['~' + result.id] = order
					openOrders['~' + result.id] = order
					recalcHold(function() {
						cb(null, order)
					})
				}, latency)
			},

			getOrder: function (opts, forced= false, cb) {
				//Per accettare cb come secondo argomento
				if (typeof forced === 'function') {
					cb = forced
					forced = false
				}
				
				setTimeout(function() {
					var order = orders['~' + opts.order_id]
					cb(null, order)
				}, latency)
			},

			getAllOrders: function (opts, cb = function() {}) {
				setTimeout(function() {
					cb(null, orders)
				}, latency)
			},

			setFees: function(opts) {
				if (so.mode === 'paper') {
					return real_exchange.setFees(opts)
				}
			},

			getCursor: real_exchange.getCursor,

			getTime: function() {
				return now
			},

			getMemory: function() {
				return 'sim'
			},
			
			cancelConnection: function() {
				if (exchange.debug_exchange) {
					debug.msg('exchange.cancelConnection')
				}
				real_exchange = require(path.resolve(__dirname, `../${exchange_id}/exchange`))(conf)
				return
			}

			processTrade: function(trade) {
				if (!s.wait_processTrade) {
					s.wait_processTrade = true
					var orders_changed = false

					now = trade.time

					_.each(openOrders, function(order) {
						if (trade.time - order.time < so.order_poll_time) {
							return // Not time yet
						}
						if (!orders_changed && order.tradetype === 'buy' && trade.price <= order.price) {
							orders_changed = true
							processBuy(order, trade)
						}
						else if (!orders_changed && order.tradetype === 'sell' && trade.price >= order.price) {
							orders_changed = true
							processSell(order, trade)
						}
					})
					s.wait_processTrade = false
				}
				else {
					console.log('processTrade - Attendo... ')
					waitCondition('wait_processTrade', 10, cb)
				}
			}
	}

	function waitCondition (condition, interval, cb) {
		if (s[condition]) {
			console.log('waitCondition - condition= ' + s[condition] + '. Waiting...')
			setTimeout (function() { waitCondition(condition, interval, cb) }, interval)
		}
		else {
			console.log('waitCondition - condition= ' + s[condition] + '. Continuing...')
			cb()
		}
	}
	
	function processBuy (buy_order, trade) {
		let fee = 0
		let size = Math.min(buy_order.remaining_size, trade.size)
		let price = buy_order.price

		// Add estimated slippage to price
		if (so.order_type === 'maker') {
			price = n(price).add(n(price).multiply(so.avg_slippage_pct / 100)).format('0.00000000')
		}

		let total = n(price).multiply(size)

		// Compute fees
		if (so.order_type === 'maker' && exchange.makerFee) {
			fee = n(size).multiply(exchange.makerFee / 100).value()
		}
		else if (so.order_type === 'taker' && exchange.takerFee) {
			fee = n(size).multiply(exchange.takerFee / 100).value()
		}

		// Update balance
		balance.asset = n(balance.asset).add(size).subtract(so.use_fee_asset ? 0 : fee).format('0.00000000')
		balance.currency = n(balance.currency).subtract(total).format('0.00000000')
		 
		// Process existing order size changes
		buy_order.filled_size = n(buy_order.filled_size).add(size).format('0.00000000')
		buy_order.remaining_size = n(buy_order.size).subtract(buy_order.filled_size).format('0.00000000')
		buy_order.executed_value = n(size).multiply(price).add(buy_order.executed_value).format(s.product.increment)
		buy_order.done_at = new Date(trade.done_at).getTime()
		buy_order.fill_fees = n(buy_order.fill_fees).add(fee).format(s.product.increment)

		if (buy_order.remaining_size <= s.product.min_size) {
			if (debug) {
				console.log('full fill bought')
			}
			buy_order.status = 'done';
			buy_order.done_at = trade.time
			delete openOrders['~' + buy_order.id]
		}
		else {
			if (debug) {
				console.log('partial fill buy')
			}
		}
		recalcHold()
	}

	function processSell (sell_order, trade) {
		let fee = 0
		let size = Math.min(sell_order.remaining_size, trade.size)
		let price = sell_order.price

		// Add estimated slippage to price
		if (so.order_type === 'maker') {
			price = n(price).subtract(n(price).multiply(so.avg_slippage_pct / 100)).format('0.00000000')
		}

		let total = n(price).multiply(size)

		// Compute fees
		if (so.order_type === 'maker' && exchange.makerFee) {
			fee = n(total).multiply(exchange.makerFee / 100).value()
		}
		else if (so.order_type === 'taker' && exchange.takerFee) {
			fee = n(total).multiply(exchange.takerFee / 100).value()
		}

		// Update balance
		balance.asset = n(balance.asset).subtract(size).format('0.00000000')
		balance.currency = n(balance.currency).add(total).subtract(so.use_fee_asset ? 0 : fee).format('0.00000000')

		// Process existing order size changes
		sell_order.filled_size = n(sell_order.filled_size).add(size).format('0.00000000')
		sell_order.remaining_size = n(sell_order.size).subtract(sell_order.filled_size).format('0.00000000')
		sell_order.executed_value = n(size).multiply(price).add(sell_order.executed_value).format(s.product.increment)
		sell_order.done_at = new Date(trade.done_at).getTime()
		sell_order.fill_fees = n(sell_order.fill_fees).add(fee).format(s.product.increment)

		if (sell_order.remaining_size <= s.product.min_size) {
			if (debug) {
				console.log('full fill sold')
			}
			sell_order.status = 'done';
			sell_order.done_at = trade.time
			delete openOrders['~' + sell_order.id]
		}
		else {
			if (debug) {
				console.log('partial fill sell')
			}
		}
		recalcHold()
	}

	return exchange
}
