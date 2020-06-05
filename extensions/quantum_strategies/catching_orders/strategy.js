var n = require('numbro')
	, Phenotypes = require('../../../lib/phenotype')
	, inspect = require('eyes').inspector({ maxLength: 4096 })
	, debug = require('../../../lib/debug')
	, tb = require('timebucket')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['catching_orders'] = {
//	opts: {								//****** To store options
//		catch_order_pct: 3,					//****** pct for position catch order
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
	name: 'catching_orders',
	description: 'Catching Orders strategy',
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

		// strat.data = {
		// }

		// s.positions.forEach(function (position, index) {
		// 	if (!position.strategy_parameters[strat_name]) {
		// 		position.strategy_parameters[strat_name] = {}
		// 	}
		// })

		callback(null, null)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, 'catch_order_pct', '% for position-catch orders', Number, 3)
	},

	getCommands: function (s, strategy_name) {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {
			desc: ('Catching orders - List options'.grey), action: function () {
				s.tools.listStrategyOptions(strategy_name, false)
			}
		})		
		this.command('+', {
			desc: ('Catching Orders - Position-catch order pct '.grey + 'INCREASE'.green), action: function () {
				strat.opts.catch_order_pct = Number((strat.opts.catch_order_pct + 0.5).toFixed(2))
				console.log('\n' + 'Catching Orders - Position-catch order pct ' + 'INCREASE'.green + ' -> ' + strat.opts.catch_order_pct)
			}
		})
		this.command('-', {
			desc: ('Catching Orders - Position-catch order pct '.grey + 'DECREASE'.green), action: function () {
				strat.opts.catch_order_pct = Number((strat.opts.catch_order_pct - 0.5).toFixed(2))
				if (strat.opts.catch_order_pct < 1) {
					strat.opts.catch_order_pct = 1
				}
				console.log('\n' + 'Catching Orders - Position-catch order pct ' + 'DECREASE'.green + ' -> ' + strat.opts.catch_order_pct)
			}
		})
		this.command('C', {
			desc: ('Catching Orders - Cancel all catch orders'.grey), action: function () {
				console.log('\nCancel'.grey + ' ALL catch orders')
				s.orders.forEach(function (order, index) {
					if (order.kind == strategy_name && !order.position.id) {
						s.tools.orderStatus(order, undefined, strategy_name, undefined, 'Unset', strategy_name)
					}
				})
			}
		})
		this.command('A', {
			desc: ('Catching Orders - Insert catch order for ALL free position'.grey), action: function () {
				console.log('\n' + 'Catching Orders - Insert catch order for ALL free positions'.grey)
				s.positions.forEach(function (position, index) {
					let position_locking = (position.locked & ~s.strategyFlag[strategy_name])
					let target_price = null

					if (!position_locking && !s.tools.positionFlags(position, 'status', 'Check', strategy_name)) {
						let position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
						let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
						if (position.side === 'buy') {
							target_price = n(position.price_open).multiply(1 + strat.opts.catch_order_pct / 100).format(s.product.increment, Math.floor)
						}
						else {
							target_price = n(position.price_open).multiply(1 - strat.opts.catch_order_pct / 100).format(s.product.increment, Math.floor)
						}
						debug.msg('Strategy catching_orders - Position (' + position.side + ' ' + position.id + ') -> ' + position_opposite_signal.toUpperCase() + ' at ' + target_price + ' (price open= ' + position.price_open + ')')
						s.signal = position_opposite_signal[0].toUpperCase() + ' Catching order'
						s.eventBus.emit(strategy_name, position_opposite_signal, position.id, undefined, target_price, protectionFlag, 'free', false, 'maker')
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

	// onTradePeriod: function (s, opts = {}, callback = function () { }) {
	// 	// var opts = {
	// 	// 		trade: trade,
	// 	// 		is_preroll: is_preroll
	// 	// }

	// 	let strat_name = this.name
	// 	let strat = s.options.strategy[strat_name]

	// 	if (strat.opts.period_calc && (opts.trade.time > strat.calc_close_time)) {
	// 		strat.calc_lookback.unshift(strat.period)
	// 		strat.period = {}
	// 		s.tools.initPeriod(strat.period, opts.trade, strat.opts.period_calc)
	// 		strat.lib.onStrategyPeriod(s, opts, function (err, result) {
	// 			strat.calc_close_time = tb(opts.trade.time).resize(strat.opts.period_calc).add(1).toMilliseconds() - 1

				// // Ripulisce so.strategy[strategy_name].calc_lookback a un max di valori
				// if (strat.calc_lookback.length > strat.opts.min_periods) {
				// 	strat.calc_lookback.pop()
				// }

	// 			if (err) {
	// 				callback(err, null)
	// 			}
	// 			else {
	// 				_onTradePeriod(callback)
	// 			}
	// 		})
	// 	}
	// 	else {
	// 		_onTradePeriod(callback)
	// 	}

	// 	///////////////////////////////////////////
	// 	// _onTradePeriod
	// 	///////////////////////////////////////////

	// 	function _onTradePeriod(cb) {
	// 		//User defined
	// 		cb()
	// 	}
	// },

	// onStrategyPeriod: function (s, opts = {}, callback = function () { }) {
	// 	let strat_name = this.name
	// 	let strat = s.options.strategy[strat_name]

	// 	_onStrategyPeriod(callback)

	// 	///////////////////////////////////////////
	// 	// _onStrategyPeriod
	// 	///////////////////////////////////////////

	// 	function _onStrategyPeriod(cb) {
	// 		cb(null, null)
	// 	}
	// },


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

	// onUpdateMessage: function (s, opts = {}, callback) {
	// 	let strat_name = this.name
	// 	let strat = s.options.strategy[strat_name]

	// 	_onUpdateMessage(callback)

	// 	///////////////////////////////////////////
	// 	// _onUpdateMessage
	// 	// output: cb(null, result)
	// 	//		result: text to be sent
	// 	///////////////////////////////////////////

	// 	function _onUpdateMessage(cb) {
						
	// 		cb(null, result)
	// 	}
	// },

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
					let target_price = null

					if (!position_locking && !position_status && !s.tools.positionFlags(position, 'status', 'Check', strat_name)) {
						let position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
						if (position.side === 'buy') {
							target_price = n(position.price_open).multiply(1 + strat.opts.catch_order_pct / 100).format(s.product.increment, Math.floor)
						}
						else {
							target_price = n(position.price_open).multiply(1 - strat.opts.catch_order_pct / 100).format(s.product.increment, Math.floor)
						}
						debug.msg('Strategy catching_orders - Position (' + position.side + ' ' + position.id + ') -> ' + position_opposite_signal.toUpperCase() + ' at ' + target_price + ' (price open= ' + position.price_open + ')')
						let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
						s.signal = position_opposite_signal[0].toUpperCase() + ' Catching order'
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
