var debug = require('../../../lib/debug')
, { formatPercent } = require('../../../lib/format')
, z = require('zero-fill')
, n = require('numbro')
, sma = require('../../../lib/sma')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector()


//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['catching_orders'] = {
//name: 'catching_orders',
//opts: {								//****** To store options
//period_calc: '1h',					//****** After how much time the auto-catch orders must be tuned 
//min_periods: 2, 						//****** Minimum number of calc_lookback to maintain (timeframe is "period_calc")
//catch_order_pct: 3,					//****** pct for position catch order
//catch_auto_pct: 5,					//****** pct for auto catch order
//catch_fixed_value: 500,				//****** Currency value for auto catch order
//catch_SMA: 60,						//****** SMA size in period_length
//catch_auto_long: false,				//****** Option for auto-long catch orders (buy on low) based on SMA
//catch_auto_short: false,			//****** Option for auto-short catch orders (sell on high) based on SMA
//},
//data: {								//****** To store calculated data
//sma: null,
//},
//},	
//calc_lookback: [],					//****** Old periods for calculation
//calc_close_time: 0,					//****** Close time for strategy period
//lib: {}								//****** To store all the functions of the strategy
//}
//---------------------------------------------


//position.strategy_parameters.catching_orders: {
//}

//---------------------------------------------

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

module.exports = {
	name: 'catching_orders',
	description: 'Catching Orders strategy',
	noHoldCheck: true,

	init: function (s) {
	},

	getOptions: function () {
		this.option('catching_orders', 'period_calc', 'After how many periods the auto-catch orders must be tuned', String, '1h')
		this.option('catching_orders', 'min_periods', 'Min. number of history periods', Number, 61)
		this.option('catching_orders', 'catch_order_pct', '% for position-catch orders', Number, 3)
		this.option('catching_orders', 'catch_auto_pct', '% for auto-catch order', Number, 5)
		this.option('catching_orders', 'catch_fixed_value', 'Amount of currency for auto-catch order', Number, 500)
		this.option('catching_orders', 'catch_SMA', 'SMA size in period_length for auto-catch orders', Number, 60)
		this.option('catching_orders', 'catch_auto_long', 'Option for auto-long catch orders (buy on low) based on SMA', Boolean, false)
		this.option('catching_orders', 'catch_auto_short', 'Option for auto-short catch orders (sell on high) based on SMA', Boolean, false)
	},

	getCommands: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.catching_orders.opts
		let strat_data = s.options.strategy.catching_orders.data

		this.command('o', {desc: ('Catching orders - List options'.grey), action: function() {
			s.tools.listStrategyOptions('catching_orders', false)
		}})
//		this.command('Y', {desc: ('Catching Orders - Manual catch order '.grey + 'BUY'.green), action: function() {
//		console.log('\nCatching Orders - Manual catch '.grey + 'BUY'.green + ' command inserted'.grey)
//		let target_price = n(s.quote.bid).multiply(1 - strat_opts.catch_auto_pct/100).format(s.product.increment, Math.floor)
//		let target_size = n(strat_opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
//		let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
//		s.eventBus.emit('catching_orders', 'buy', null, target_size, target_price, protectionFlag)
//		}})
//		this.command('H', {desc: ('Catching Orders - Manual catch order '.grey + 'SELL'.red), action: function() {
//		console.log('\nCatching Orders - Manual catch '.grey + 'SELL'.red + ' command inserted'.grey)
//		let target_price = n(s.quote.bid).multiply(1 + strat_opts.catch_auto_pct/100).format(s.product.increment, Math.floor)
//		let target_size = n(strat_opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
//		let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
//		s.eventBus.emit('catching_orders', 'sell', null, target_size, target_price, protectionFlag)
//		}})
		this.command('+', {desc: ('Catching Orders - Auto-catch order pct '.grey + 'INCREASE'.green), action: function() {
			strat_opts.catch_auto_pct = Number((strat_opts.catch_auto_pct + 0.5).toFixed(2))
			console.log('\n' + 'Catching Orders - Auto-catch order pct ' + 'INCREASE'.green + ' -> ' + strat_opts.catch_auto_pct)
		}})
		this.command('-', {desc: ('Catching Orders - Auto-catch order pct (min 1.0%) '.grey + 'DECREASE'.red), action: function() {
			strat_opts.catch_auto_pct = Number((strat_opts.catch_auto_pct - 0.5).toFixed(2))
			if (strat_opts.catch_auto_pct <= 1) {
				strat_opts.catch_auto_pct = 1
			}
			console.log('\n' + 'Catching Orders - Auto-catch order pct (min 1.0%) ' + 'DECREASE'.red + ' -> ' + strat_opts.catch_auto_pct)
		}})
		this.command('*', {desc: ('Catching Orders - Auto-catch order value '.grey + 'INCREASE'.green), action: function() {
			strat_opts.catch_fixed_value += s.options.quantum_value
			console.log('\n' + 'Catching Orders - Auto-catch order value ' + 'INCREASE'.green + ' -> ' + strat_opts.catch_fixed_value)
		}})
		this.command('_', {desc: ('Catching Orders - Auto-catch order value '.grey + 'DECREASE'.red), action: function() {
			strat_opts.catch_fixed_value -= s.options.quantum_value
			if (strat_opts.catch_fixed_value < s.options.quantum_value) {
				strat_opts.catch_fixed_value = s.options.quantum_value
			}
			console.log('\n' + 'Catching Orders - Auto-catch order value ' + 'DECREASE'.green + ' -> ' + strat_opts.catch_fixed_value)
		}})
		this.command('u', {desc: ('Catching Orders - Toggle '.grey + 'Auto-long'.green + ' (buy on low) catch order'.grey), action: function() {
			strat_opts.catch_auto_long = !strat_opts.catch_auto_long
			console.log('\nToggle Auto-long catch order: ' + (strat_opts.catch_auto_long ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('j', {desc: ('Catching Orders - Toggle '.grey + 'Auto-short'.red + ' (sell on high) catch order'.grey), action: function() {
			strat_opts.catch_auto_short = !strat_opts.catch_auto_short
			console.log('\nToggle Auto-short catch order: ' + (strat_opts.catch_auto_short ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('i', {desc: ('Catching Orders - Position-catch order pct '.grey + 'INCREASE'.green), action: function() {
			strat_opts.catch_order_pct = Number((strat_opts.catch_order_pct + 0.5).toFixed(2))
			console.log('\n' + 'Catching Orders - Position-catch order pct ' + 'INCREASE'.green + ' -> ' + strat_opts.catch_order_pct)
		}})
		this.command('k', {desc: ('Catching Orders - Position-catch order pct '.grey + 'DECREASE'.green), action: function() {
			strat_opts.catch_order_pct = Number((strat_opts.catch_order_pct - 0.5).toFixed(2))
			if (strat_opts.catch_order_pct <= 0) {
				strat_opts.catch_order_pct = 0
			}
			console.log('\n' + 'Catching Orders - Position-catch order pct ' + 'DECREASE'.green + ' -> ' + strat_opts.catch_order_pct)
		}})
		this.command('C', {desc: ('Catching Orders - Cancel all auto-catch orders'.grey), action: function() {
			console.log('\nCancel'.grey + ' ALL auto-catch orders')
			s.orders.forEach(function (order, index) {
				if (order.kind == 'catching_orders' && !order.position.id) {
					s.tools.orderStatus(order, undefined, 'catching_orders', undefined, 'Unset', 'catching_orders')
				}
			})
		}})	
		this.command('A', {desc: ('Catching Orders - Insert position-catch order for ALL free position'.grey), action: function() {
			if (strat_opts.catch_order_pct > 0) {
				console.log('\n' + 'Catching Orders - Insert position-catch order for ALL free positions'.grey)
				s.positions.forEach(function (position, index) {
					let position_locking = (position.locked & ~s.strategyFlag['catching_orders'])
					let target_price = null

					if (!position_locking && !s.tools.positionFlags(position, 'status', 'Check', 'catching_orders')) {
						let position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
						let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
						if (position.side === 'buy') {
							target_price = n(position.price_open).multiply(1 + strat_opts.catch_order_pct/100).format(s.product.increment, Math.floor)
						}
						else {
							target_price = n(position.price_open).multiply(1 - strat_opts.catch_order_pct/100).format(s.product.increment, Math.floor)
						}
						debug.msg('Strategy catching_orders - Position (' + position.side + ' ' + position.id + ') -> ' + position_opposite_signal.toUpperCase() + ' at ' + target_price + ' (price open= ' + position.price_open + ')')
						s.signal = position_opposite_signal[0].toUpperCase() + ' Catching order'
						s.eventBus.emit('catching_orders', position_opposite_signal, position.id, undefined, target_price, protectionFlag, 'free', false, false)  
					}
				})
			}
			else {
				console.log('\n' + 'Catching Orders - Catch order pct =< 0!'.red)
			}
		}})

		cb()
	},

	onTrade: function (s, opts= {}, cb= function() {}) {
		cb()
	},


	onTradePeriod: function (s, opts= {}, cb= function() {}) {
		cb()
	},

	onStrategyPeriod: function (s, opts= {}, cb= function() {}) {		
		let strat_opts = s.options.strategy.catching_orders.opts
		let strat_data = s.options.strategy.catching_orders.data

		//Calcolo il pivot price (strat_data.sma)
		strat_data.sma = roundToNearest(sma(s, null, strat_opts.min_periods, 'close'))

		if (strat_data.sma && (strat_opts.catch_auto_long || strat_opts.catch_auto_short)) {
			//Cancello gli ordini vecchi
			console.log('\nCatching Orders - '.grey + 'Cancel ALL Auto-catch orders')
			s.orders.forEach(function (order, index) {
				if (order.kind == 'catching_orders' && !order.position.id) {
					s.tools.orderStatus(order, undefined, 'catching_orders', undefined, 'Unset', 'catching_orders')
				}
			})

			//Immetto gli ordini nuovi dopo aver atteso wait_for_settlement
			setTimeout (function() {
				let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['long_short'] + s.protectionFlag['only_one_side']
				if (strat_opts.catch_auto_long) {
					console.log('\nCatching Orders - Auto catch '.grey + 'BUY'.green + ' command inserted'.grey)
					let target_price = n(strat_data.sma).multiply(1 - strat_opts.catch_auto_pct/100).format(s.product.increment, Math.floor)
					let target_size = n(strat_opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					s.eventBus.emit('catching_orders', 'buy', null, target_size, target_price, protectionFlag, 'catching_orders', false, false)
				}

				if (strat_opts.catch_auto_short) {
					console.log('\nCatching Orders - Auto catch '.grey + 'SELL'.red + ' command inserted'.grey)
					let target_price = n(strat_data.sma).multiply(1 + strat_opts.catch_auto_pct/100).format(s.product.increment, Math.floor)
					let target_size = n(strat_opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
					s.eventBus.emit('catching_orders', 'sell', null, target_size, target_price, protectionFlag, 'catching_orders', false, false)
				}
				cb()
			}, 10*s.options.wait_for_settlement)
		}

		function roundToNearest(numToRound) {
			var numToRoundTo = (s.product.increment ? s.product.increment : 0.00000001)
			numToRoundTo = 1 / (numToRoundTo)

			return Math.floor(numToRound * numToRoundTo) / numToRoundTo
		}
	},

	onReport: function (s, opts= {}, cb = function() {}) {
//		let strat_opts = s.options.strategy.catching_orders.opts
//		let strat_data = s.options.strategy.catching_orders.data
//
//		var cols = []
//		if (strat_data.sma) {
//			cols.push(s.tools.zeroFill(8, strat_data.sma, ' '))
//		}
//		cols.forEach(function (col) {
//			process.stdout.write(col)
//		})
		cb()
	},

	onUpdateMessage: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.catching_orders.opts
		let result = null
		if (strat_opts.catch_auto_long || strat_opts.catch_auto_short) {
			result = 'Auto-catch (Long/Short): ' + strat_opts.catch_auto_long + ' ; ' + strat_opts.catch_auto_short
		}
		cb(result)
	},

	onPositionOpened: function (s, opts= {}, cb = function() {}) {
//		var opts = {
//		position_id: position_id,
//		};
		cb()
	},

	onPositionUpdated: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	onPositionClosed: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	onOrderExecuted: function (s, opts= {}, cb = function() {}) {
//		var opts = {
//		signal: signal,
//		sig_kind: sig_kind,
//		position_id: position_id,
//		is_closed: is_closed,
//		};
		if (!opts.is_closed) {
			let strat_opts = s.options.strategy.catching_orders.opts
			let strat_data = s.options.strategy.catching_orders.data

			if (strat_opts.catch_order_pct > 0) {
				let position = s.positions.find(x => x.id === opts.position_id)
				if (position) {
					let position_locking = (position.locked & ~s.strategyFlag['catching_orders'])
					let position_status = (position.status & ~s.strategyFlag['catching_orders'])
					let target_price = null

					if (!position_locking && !position_status && !s.tools.positionFlags(position, 'status', 'Check', 'catching_orders')) {
						let position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
						if (position.side === 'buy') {
							target_price = n(position.price_open).multiply(1 + strat_opts.catch_order_pct/100).format(s.product.increment, Math.floor)
						}
						else {
							target_price = n(position.price_open).multiply(1 - strat_opts.catch_order_pct/100).format(s.product.increment, Math.floor)
						}
						debug.msg('Strategy catching_orders - Position (' + position.side + ' ' + position.id + ') -> ' + position_opposite_signal.toUpperCase() + ' at ' + target_price + ' (price open= ' + position.price_open + ')')
						let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
						s.signal = position_opposite_signal[0].toUpperCase() + ' Catching order'
						s.eventBus.emit('catching_orders', position_opposite_signal, position.id, undefined, target_price, protectionFlag, 'free', false, false)  
					}
				}
			}
		}
		cb()
	},

	printOptions: function(s, opts= {}, cb = function() {}) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.stoploss))
		delete so_tmp.calc_lookback
		delete so_tmp.calc_close_time
		delete so_tmp.lib

		console.log('\n' + inspect(so_tmp))
		cb()
	},

	//TOTALMENTE da sistemare, se dovessero servire
	phenotypes: {
		// -- common
		period_length: Phenotypes.RangePeriod(1, 120, 'm'),
		markdown_buy_pct: Phenotypes.RangeFloat(-1, 5),
		markup_sell_pct: Phenotypes.RangeFloat(-1, 5),
		order_type: Phenotypes.ListOption(['maker', 'taker']),
		sell_stop_pct: Phenotypes.Range0(1, 50),
		buy_stop_pct: Phenotypes.Range0(1, 50),
		profit_stop_enable_pct: Phenotypes.Range0(1, 20),
		profit_stop_pct: Phenotypes.Range(1,20),

		// -- strategy
		size: Phenotypes.Range(1, 40),
	}
}
