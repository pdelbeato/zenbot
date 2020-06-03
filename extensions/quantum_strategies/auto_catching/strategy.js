var n = require('numbro')
	, Phenotypes = require('../../../lib/phenotype')
	, inspect = require('eyes').inspector({ maxLength: 4096 })
	, debug = require('../../../lib/debug')
	, tb = require('timebucket')
	, sma = require('../../../lib/sma')
	

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['auto_catching'] = {
//	opts: {								//****** To store options
//		period_calc: '1h',					//****** After how much time the auto-catch orders must be tuned 
//		size: 60,							//****** SMA size in period_length
//		catch_gain_pct: 3,					//****** gain pct for closing position catch order
//		catch_auto_pct: 5,					//****** pct for auto catch order
//		catch_fixed_value: 500,				//****** Currency value for auto catch order
//		catch_auto_long: false,				//****** Option for auto-long catch orders (buy on low) based on SMA
//		catch_auto_short: false,			//****** Option for auto-short catch orders (sell on high) based on SMA
//	},
//---------------------------------------------


//position.strategy_parameters[this.name]: {
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
	name: 'auto_catching',
	description: 'Auto-Auto-catching Orders strategy',
	noHoldCheck: true,

	init: function (s, callback = function() {}) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		if (strat.opts.size && strat.opts.period_calc) {
			strat.opts.min_periods = tb(strat.opts.size, strat.opts.period_calc).resize(s.options.period_length).value
		}
		else {
			strat.opts.min_periods = 0
		}

		strat.data = {
			sma: null,
		}

		// s.positions.forEach(function (position, index) {
		// 	if (!position.strategy_parameters[strat_name]) {
		// 		position.strategy_parameters[strat_name] = {}
		// 	}
		// })

		callback(null, null)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, 'period_calc', 'After how many periods the auto-catch orders must be tuned', String, '1h')
		this.option(strategy_name, 'size', 'SMA size in period_length for auto-catch orders', Number, 60)
		this.option(strategy_name, 'catch_gain_pct', '% gain for closing position-catch orders', Number, 3)
		this.option(strategy_name, 'catch_auto_pct', '% for auto-catch order', Number, 5)
		this.option(strategy_name, 'catch_fixed_value', 'Amount of currency for auto-catch order', Number, 500)
		this.option(strategy_name, 'catch_auto_long', 'Option for auto-long catch orders (buy on low) based on SMA', Boolean, false)
		this.option(strategy_name, 'catch_auto_short', 'Option for auto-short catch orders (sell on high) based on SMA', Boolean, false)
	},

	getCommands: function (s, strategy_name) {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {
			desc: ('Auto-catching orders - List options'.grey), action: function () {
				s.tools.listStrategyOptions(strategy_name, false)
			}
		})
		//		this.command('Y', {desc: ('Auto-catching Orders - Manual catch order '.grey + 'BUY'.green), action: function() {
		//		console.log('\nAuto-catching Orders - Manual catch '.grey + 'BUY'.green + ' command inserted'.grey)
		//		let target_price = n(s.quote.bid).multiply(1 - strat.opts.catch_auto_pct/100).format(s.product.increment, Math.floor)
		//		let target_size = n(strat.opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
		//		let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
		//		s.eventBus.emit(this.name, 'buy', null, target_size, target_price, protectionFlag)
		//		}})
		//		this.command('H', {desc: ('Auto-catching Orders - Manual catch order '.grey + 'SELL'.red), action: function() {
		//		console.log('\nAuto-catching Orders - Manual catch '.grey + 'SELL'.red + ' command inserted'.grey)
		//		let target_price = n(s.quote.bid).multiply(1 + strat.opts.catch_auto_pct/100).format(s.product.increment, Math.floor)
		//		let target_size = n(strat.opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
		//		let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
		//		s.eventBus.emit(this.name, 'sell', null, target_size, target_price, protectionFlag)
		//		}})
		this.command('+', {
			desc: ('Auto-catching Orders - Auto-catch order pct '.grey + 'INCREASE'.green), action: function () {
				strat.opts.catch_auto_pct = Number((strat.opts.catch_auto_pct + 0.5).toFixed(2))
				console.log('\n' + 'Auto-catching Orders - Auto-catch order pct ' + 'INCREASE'.green + ' -> ' + strat.opts.catch_auto_pct)
			}
		})
		this.command('-', {
			desc: ('Auto-catching Orders - Auto-catch order pct (min 1.0%) '.grey + 'DECREASE'.red), action: function () {
				strat.opts.catch_auto_pct = Number((strat.opts.catch_auto_pct - 0.5).toFixed(2))
				if (strat.opts.catch_auto_pct <= 1) {
					strat.opts.catch_auto_pct = 1
				}
				console.log('\n' + 'Auto-catching Orders - Auto-catch order pct (min 1.0%) ' + 'DECREASE'.red + ' -> ' + strat.opts.catch_auto_pct)
			}
		})
		this.command('*', {
			desc: ('Auto-catching Orders - Auto-catch order value '.grey + 'INCREASE'.green), action: function () {
				strat.opts.catch_fixed_value += s.options.quantum_value
				console.log('\n' + 'Auto-catching Orders - Auto-catch order value ' + 'INCREASE'.green + ' -> ' + strat.opts.catch_fixed_value)
			}
		})
		this.command('_', {
			desc: ('Auto-catching Orders - Auto-catch order value '.grey + 'DECREASE'.red), action: function () {
				strat.opts.catch_fixed_value -= s.options.quantum_value
				if (strat.opts.catch_fixed_value < s.options.quantum_value) {
					strat.opts.catch_fixed_value = s.options.quantum_value
				}
				console.log('\n' + 'Auto-catching Orders - Auto-catch order value ' + 'DECREASE'.green + ' -> ' + strat.opts.catch_fixed_value)
			}
		})
		this.command('u', {
			desc: ('Auto-catching Orders - Toggle '.grey + 'Auto-long'.green + ' (buy on low) catch order'.grey), action: function () {
				strat.opts.catch_auto_long = !strat.opts.catch_auto_long
				console.log('\nToggle Auto-long catch order: ' + (strat.opts.catch_auto_long ? 'ON'.green.inverse : 'OFF'.red.inverse))
			}
		})
		this.command('j', {
			desc: ('Auto-catching Orders - Toggle '.grey + 'Auto-short'.red + ' (sell on high) catch order'.grey), action: function () {
				strat.opts.catch_auto_short = !strat.opts.catch_auto_short
				console.log('\nToggle Auto-short catch order: ' + (strat.opts.catch_auto_short ? 'ON'.green.inverse : 'OFF'.red.inverse))
			}
		})
		this.command('i', {
			desc: ('Auto-catching Orders - Closing position gain pct '.grey + 'INCREASE'.green), action: function () {
				strat.opts.catch_gain_pct = Number((strat.opts.catch_gain_pct + 0.5).toFixed(2))
				console.log('\n' + 'Auto-catching Orders - Position-catch order pct ' + 'INCREASE'.green + ' -> ' + strat.opts.catch_gain_pct)
			}
		})
		this.command('k', {
			desc: ('Auto-catching Orders - Closing position gain pct '.grey + 'DECREASE'.red), action: function () {
				strat.opts.catch_gain_pct = Number((strat.opts.catch_gain_pct - 0.5).toFixed(2))
				if (strat.opts.catch_gain_pct < 1) {
					strat.opts.catch_gain_pct = 1
				}
				console.log('\n' + 'Auto-catching Orders - Closing position gain pct ' + 'DECREASE'.red + ' -> ' + strat.opts.catch_gain_pct)
			}
		})
		this.command('A', {
			desc: ('Auto-catching Orders - Insert auto-catch order now'.grey), action: function () {
				strat.lib.onStrategyPeriod(s)
				console.log('\n' + 'Auto-catching Orders - Auto-catch order inserted')
			}
		})
		this.command('C', {
			desc: ('Auto-catching Orders - Cancel all auto-catch orders'.grey), action: function () {
				console.log('\nCancel'.grey + ' ALL auto-catch orders')
				s.orders.forEach(function (order, index) {
					if (order.kind == strategy_name && !order.position.id) {
						s.tools.orderStatus(order, undefined, strategy_name, undefined, 'Unset', strategy_name)
					}
				})
			}
		})
	},

	// onTrade: function (s, opts = {}, callback = function () { }) {
	// 	// var opts = {
	// 	// 		trade: trade,
	// 	// 		is_preroll: is_preroll
	// 	// }
	// 	let strat_name = this.name
	// 	let strat = s.options.strategy[strat_name]
		
	// 	_onTrade(callback)
		
	// 	///////////////////////////////////////////
	// 	// _onTrade
	// 	///////////////////////////////////////////
		
	// 	function _onTrade(cb) {
	// 		//User defined

	// 		cb()
	// 	}
	// },

	onTradePeriod: function (s, opts = {}, callback = function () { }) {
		// var opts = {
		// 		trade: trade,
		// 		is_preroll: is_preroll
		// }

		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		if (strat.opts.period_calc && (opts.trade.time > strat.calc_close_time)) {
			strat.calc_lookback.unshift(strat.period)
			strat.period = {}
			s.tools.initPeriod(strat.period, opts.trade, strat.opts.period_calc)
			strat.lib.onStrategyPeriod(s, opts, function (err, result) {
				if (strat.opts.period_calc) {
					strat.calc_close_time = tb(opts.trade.time).resize(strat.opts.period_calc).add(1).toMilliseconds() - 1
				}

				// Ripulisce so.strategy[strategy_name].calc_lookback a un max di valori
				if (strat.opts.size && (strat.calc_lookback.length > strat.opts.size)) {
					strat.calc_lookback.pop()
				}

				if (err) {
					callback(err, null)
				}
				else {
					_onTradePeriod(callback)
				}
			})
		}
		else {
			_onTradePeriod(callback)
		}

		///////////////////////////////////////////
		// _onTradePeriod
		///////////////////////////////////////////

		function _onTradePeriod(cb) {
			//User defined
			cb()
		}
	},

	onStrategyPeriod: function (s, opts = {}, callback = function () { }) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onStrategyPeriod(callback)

		///////////////////////////////////////////
		// _onStrategyPeriod
		///////////////////////////////////////////

		function _onStrategyPeriod(cb) {
			if (!s.in_preroll && (strat.opts.catch_auto_long || strat.opts.catch_auto_short)) {
				//Calcolo il pivot price (strat.data.sma). Uso period_length e non period_calc, quindi usi min_periods, e non size.
				strat.data.sma = roundToNearest(sma(s, null, strat.opts.min_periods, 'close'))

				if (strat.data.sma) {
					//Cancello gli ordini vecchi
					console.log('\nAuto-catching Orders - '.grey + 'Cancel ALL Auto-catch orders')
//Da sistemare. Volendo si può evitare il forEach, visto che orderStatus dovrebbe già trattare anche ordini non specifici.
					s.orders.forEach(function (order, index) {
						if (order.kind == strat_name && !order.position.id) {
							s.tools.orderStatus(order, undefined, strat_name, undefined, 'Unset', strat_name)
						}
					})

					//Immetto gli ordini nuovi dopo aver atteso wait_for_settlement
					setTimeout(function () {
						let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['long_short'] + s.protectionFlag['only_one_side']
						if (strat.opts.catch_auto_long) {
							console.log('\nAuto-catching Orders - Auto catch '.grey + 'BUY'.green + ' command inserted'.grey)
							let target_price = n(strat.data.sma).multiply(1 - strat.opts.catch_auto_pct / 100).format(s.product.increment, Math.floor)
							let target_size = n(strat.opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
							s.eventBus.emit(strat_name, 'buy', null, target_size, target_price, protectionFlag, strat_name, false, 'maker')
						}

						if (strat.opts.catch_auto_short) {
							console.log('\nAuto-catching Orders - Auto catch '.grey + 'SELL'.red + ' command inserted'.grey)
							let target_price = n(strat.data.sma).multiply(1 + strat.opts.catch_auto_pct / 100).format(s.product.increment, Math.floor)
							let target_size = n(strat.opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
							s.eventBus.emit(strat_name, 'sell', null, target_size, target_price, protectionFlag, strat_name, false, 'maker')
						}
					}, 10 * s.options.wait_for_settlement)
					cb(null, null)
				}
				else {
					cb(null, null)
				}

				function roundToNearest(numToRound) {
					var numToRoundTo = (s.product.increment ? s.product.increment : 0.00000001)
					numToRoundTo = 1 / (numToRoundTo)

					return Math.floor(numToRound * numToRoundTo) / numToRoundTo
				}
			}
			else {
				return cb(null, null)
			}
		}
	},


	// onReport: function (s, opts = {}, callback = function () { }) {
	// 	let strat_name = this.name
	// 	let strat = s.options.strategy[strat_name]

	// 	var cols = []

	// 	_onReport(function() {
	// 		cols.forEach(function (col) {
	// 			process.stdout.write(col)
	// 		})
	// 		callback(null, null)
	// 	})
		
	// 	/////////////////////////////////////////////////////
	// 	// _onReport() deve inserire in cols[] le informazioni da stampare a video
	// 	/////////////////////////////////////////////////////

	// 	function _onReport(cb) {
	// 		//User defined
	// 		//cols.push('_something_')

	// 		cb()
	// 	}
	// },

	onUpdateMessage: function (s, opts = {}, callback) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onUpdateMessage(callback)

		///////////////////////////////////////////
		// _onUpdateMessage
		// output: cb(null, result)
		//		result: text to be sent
		///////////////////////////////////////////

		function _onUpdateMessage(cb) {
			let result = null
			
			if (strat.opts.catch_auto_long || strat.opts.catch_auto_short) {
				result = 'Auto-catching (Long/Short): ' + strat.opts.catch_auto_long + ' ; ' + strat.opts.catch_auto_short
			}
			
			cb(null, result)
		}
	},

	// onPositionOpened: function (s, opts = {}, callback = function () { }) {
	// 	//var opts = {
	// 	//	position_id: position_id,
	// 	//	position: position
	// 	//};

	// 	// let strat_name = this.name
	// 	// let strat = s.options.strategy[strat_name]

	// 	// opts.position.strategy_parameters[strat_name] = {}

	// 	_onPositionOpened(callback)

	// 	///////////////////////////////////////////
	// 	// _onPositionOpened
	// 	///////////////////////////////////////////

	// 	function _onPositionOpened(cb) {
	// 		//User defined
			
	// 		cb(null, null)
	// 	}
	// },

	// onPositionUpdated: function (s, opts = {}, callback = function () { }) {
	// 	//var opts = {
	// 	//	position_id: position_id,
	// 	//	position: position
	// 	//};
		
	// 	// let strat_name = this.name
	// 	// let strat = s.options.strategy[strat_name]

	// 	_onPositionUpdated(callback)
		
	// 	///////////////////////////////////////////
	// 	// _onPositionUpdated
	// 	///////////////////////////////////////////
		
	// 	function _onPositionUpdated(cb) {
	// 		cb(null, null)
	// 	}
	// },

	// onPositionClosed: function (s, opts = {}, callback = function () { }) {
	// 	//var opts = {
	// 	//	position_id: position_id,
	// 	//	position: position
	// 	//};

	// 	// let strat_name = this.name
	// 	// let strat = s.options.strategy[strat_name]

	// 	_onPositionClosed(callback)
		
	// 	///////////////////////////////////////////
	// 	// _onPositionClosed
	// 	///////////////////////////////////////////
		
	// 	function _onPositionClosed(cb) {
	// 		//User defined
			
	// 		cb(null, null)
	// 	}
	// },

	onOrderExecuted: function (s, opts = {}, callback = function () { }) {
		// var opts = {
		// 	signal: signal,
		// 	sig_kind: sig_kind,
		// 	position_id: position_id,
		// 	is_closed: is_closed,
		// }
		
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]
		
		_onOrderExecuted(callback)
		
		///////////////////////////////////////////
		// _onOrderExecuted
		///////////////////////////////////////////
		
		function _onOrderExecuted(cb) {
			if (!opts.is_closed) {
				let position = s.positions.find(x => x.id === opts.position_id)
				if (position) {
					let position_locking = (position.locked & ~s.strategyFlag[strat_name])
					let position_status = (position.status & ~s.strategyFlag[strat_name])
					let position_opened_by = (position.opened_by & ~s.strategyFlag[strat_name])
					let target_price = null

					if (!position_locking && !position_status && !position.opened_by && !s.tools.positionFlags(position, 'status', 'Check', strat_name)) {
						let position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
						if (position.side === 'buy') {
							target_price = n(position.price_open).multiply(1 + strat.opts.catch_gain_pct / 100).format(s.product.increment, Math.floor)
						}
						else {
							target_price = n(position.price_open).multiply(1 - strat.opts.catch_gain_pct / 100).format(s.product.increment, Math.floor)
						}
						debug.msg('Strategy auto-catching - Position (' + position.side + ' ' + position.id + ') -> ' + position_opposite_signal.toUpperCase() + ' at ' + target_price + ' (price open= ' + position.price_open + ')')
						let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
						s.signal = position_opposite_signal[0].toUpperCase() + ' Auto-catching order'
						s.eventBus.emit(strat_name, position_opposite_signal, position.id, undefined, target_price, protectionFlag, 'free', false, 'maker')
					}
				}
			}
			
			cb(null, null)
		}
	},

	printOptions: function (s, opts = { only_opts: false }, callback) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy[this.name]))
		delete so_tmp.calc_lookback
		delete so_tmp.calc_close_time
		delete so_tmp.lib

		if (opts.only_opts) {
			delete so_tmp.data
		}
		console.log('\nSTRATEGY'.grey + '\t' + this.name + '\t' + this.description.grey + '\n')
		console.log('\n' + inspect(so_tmp))
		callback(null, null)
	},

	phenotypes: {
		// -- common
		option_1: Phenotypes.RangePeriod(1, 120, 'm'),
		option_2: Phenotypes.RangeFloat(-1, 5),
		option_3: Phenotypes.ListOption(['maker', 'taker']),
		
		// -- strategy
		option_4: Phenotypes.Range(1, 40),
	}
}
