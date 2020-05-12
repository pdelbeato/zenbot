var n = require('numbro')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector({ maxLength: 4096 })
, debug = require('../../../lib/debug')
, tb = require('timebucket')
, ta_linearRegSlope = require('../../../lib/ta_linearreg_slope')
, { formatPercent } = require('../../../lib/format')


//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['linear_reg_trend'] = {
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate linear regression every period_calc time
//		size: 96,					//****** Use 'size' period to calculate linear regression
//		upper_threshold: 0.2,		//****** Upper threshold (long if price is higher)
//		lower_threshold: -0.2,		//****** Lower threshold (short if price is lower)
//		activated: false,			//****** Activate this strategy
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
	name: 'linear_reg_trend',
	description: 'Set active long/short based on linear regression trend',
	noHoldCheck: false,

	init: function (s, callback = function () { }) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		try {
			if (strat.opts.size && strat.opts.period_calc) {
				strat.opts.min_periods = tb(strat.opts.size, strat.opts.period_calc).resize(s.options.period_length).value
			}
			else {
				strat.opts.min_periods = 0
			}

			strat.data = {
				slope: null,
			}

			//		s.positions.forEach(function (position, index) {
			//			if (!position.strategy_parameters[strat_name]) {
			//				position.strategy_parameters[strat_name] = {}
			//			}
			//		})
		}
		catch (err) {
			console.log(strat_name + ' init err= ' + err)
		}

		callback(null, null)
	},

	getOptions: function (strategy_name) {
		try {
		this.option(strategy_name, 'period_calc', 'Calculate Linear Regression Trend every period_calc time', String, '15m')
		this.option(strategy_name, 'size', 'Use \'size\' period to calculate linear regression', Number, 20)
		this.option(strategy_name, 'upper_threshold', 'Upper threshold (long if price is higher)', Number, 0.5)
		this.option(strategy_name, 'lower_threshold', 'Lower threshold (short if price is lower)', Number, -0.5)
		}
		catch (err) {
			console.log(strat_name + ' getOptions err= ' + err)
		}
	},

	getCommands: function (s, strategy_name) {
		try {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {
			desc: ('Linear Regression Trend - List options'.grey),
			action: function() {
				s.tools.listStrategyOptions('linear_reg_trend', false)
			}
		})
		this.command('+', {desc: ('Linear Regression Trend - Upper threshold'.grey + ' INCREASE'.green), action: function() {
			strat.opts.upper_threshold = Number((strat.opts.upper_threshold + 0.01).toFixed(2))
			console.log('\n' + 'Linear Regression Trend - Upper threshold' + ' INCREASE'.green + ' -> ' + strat.opts.upper_threshold)
		}})
		this.command('-', {desc: ('Linear Regression Trend - Upper threshold'.grey + ' DECREASE'.red), action: function() {
			strat.opts.upper_threshold = Number((strat.opts.upper_threshold - 0.01).toFixed(2))
			console.log('\n' + 'Linear Regression Trend - Upper threshold' + ' DECREASE'.red + ' -> ' + strat.opts.upper_threshold)
		}})
		this.command('*', {desc: ('Linear Regression Trend - Lower threshold'.grey + ' INCREASE'.green), action: function() {
			strat.opts.lower_threshold = Number((strat.opts.lower_threshold + 0.01).toFixed(2))
			console.log('\n' + 'Linear Regression Trend - Lower threshold' + ' INCREASE'.green + ' -> ' + strat.opts.lower_threshold)
		}})
		this.command('_', {desc: ('Linear Regression Trend - Lower threshold'.grey + ' DECREASE'.red), action: function() {
			strat.opts.lower_threshold = Number((strat.opts.lower_threshold - 0.01).toFixed(2))
			console.log('\n' + 'Linear Regression Trend - Lower threshold' + ' DECREASE'.red + ' -> ' + strat.opts.lower_threshold)
		}})
		this.command('i', {
			desc: ('Linear Regression Trend - Toggle activation'.grey),
			action: function() {
				strat.opts.activated = !strat.opts.activated
				console.log('\nToggle activation: ' + (strat.opts.activated ? 'ON'.green.inverse : 'OFF'.red.inverse))
			}
		})
	}
	catch (err) {
		console.log(strat_name + ' getCommands err= ' + err)
	}
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

		try {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		if (strat.opts.period_calc && (opts.trade.time > strat.calc_close_time)) {
			strat.calc_lookback.unshift(s.period)
			strat.lib.onStrategyPeriod(s, opts, function (err, result) {
				if (strat.opts.period_calc) {
					strat.calc_close_time = tb(opts.trade.time).resize(strat.opts.period_calc).add(1).toMilliseconds() - 1
				}

				if (strat.opts.min_periods && (strat.calc_lookback.length > strat.opts.min_periods)) {
					strat.calc_lookback.splice(strat.opts.min_periods, (strat.calc_lookback.length - strat.opts.min_periods))
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
	}
	catch (err) {
		console.log(strat_name + ' onTrade err= ' + err)
	}
	},

	onStrategyPeriod: function (s, opts = {}, callback = function () { }) {
		try {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onStrategyPeriod(callback)

		///////////////////////////////////////////
		// _onStrategyPeriod
		///////////////////////////////////////////

		function _onStrategyPeriod(cb) {
			ta_linearRegSlope(s, 'close', 'linear_reg_trend', strat.opts.size)
			.then(function (result) {
				if (strat.opts.activated) {
					if (strat.data.slope > strat.opts.upper_threshold) {
						s.options.active_long_position = true
						s.options.active_short_position = false
					}
					else if (strat.data.slope < strat.opts.lower_threshold) {
						s.options.active_long_position = false
						s.options.active_short_position = true
					}
				}
				cb(null, result)
			})
			.catch(function (err) {
				cb(err, null)
			})
		}
	}
	catch (err) {
		console.log(strat_name + ' onStrategyPeriod err= ' + err)
	}
	},


	onReport: function (s, opts = {}, callback = function () { }) {
		try {
		let strat_name = this.name
		let strat = JSON.parse(JSON.stringify(s.options.strategy[strat_name]))

		// if (!opts.actual && s.lookback[0]) {
		// 	strat.data = s.lookback[0].strategy[strat_name].data
		// }

		var cols = []

		_onReport(function() {
			cols.forEach(function (col) {
				process.stdout.write(col)
			})
			callback(null, null)
		})
		
		/////////////////////////////////////////////////////
		// _onReport() deve inserire in cols[] le informazioni da stampare a video
		/////////////////////////////////////////////////////

		function _onReport(cb) {
			var color = null
			
			if (strat.data.slope) {			
				if (strat.data.slope > strat.opts.upper_threshold) {
					color = 'green'
				}
				else if (strat.data.slope > strat.opts.lower_threshold) {
					color = 'white'
				}
				else {
					color = 'red'
				}

				cols.push(s.tools.zeroFill(8, ('[' + n(strat.data.slope).format('0.00') + '‰]'), ' ')[color])
			}
			else {
				cols.push(s.tools.zeroFill(8, '', ' '))
			}

			cb()
		}
	}
	catch (err) {
		console.log(strat_name + ' onReport err= ' + err)
	}
	},

	onUpdateMessage: function (s, opts = {}, callback) {
		try {
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

			if (strat.data.slope) {
				result = ('Linear Regression slope: ' + n(strat.data.slope).format('0.00') + '‰]')
			}
			
			cb(null, result)
		}
	}
	catch (err) {
		console.log(strat_name + ' onUpdateMessage err= ' + err)
	}
	},

	// onPositionOpened: function (s, opts = {}, callback = function () { }) {
	// 	//var opts = {
	// 	//	position_id: position_id,
	// 	//	position: position
	// 	//};

	// 	let strat_name = this.name
	// 	let strat = s.options.strategy[strat_name]

	// 	opts.position.strategy_parameters[strat_name] = {}

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
		
	// 	let strat_name = this.name
	// 	let strat = s.options.strategy[strat_name]

	// 	_onPositionUpdated(callback)
		
	// 	///////////////////////////////////////////
	// 	// _onPositionUpdated
	// 	///////////////////////////////////////////
		
	// 	function _onPositionUpdated(cb) {
	// 		//User defined
			
	// 		cb(null, null)
	// 	}
	// },

	// onPositionClosed: function (s, opts = {}, callback = function () { }) {
	// 	//var opts = {
	// 	//	position_id: position_id,
	// 	//	position: position
	// 	//};

	// 	let strat_name = this.name
	// 	let strat = s.options.strategy[strat_name]

	// 	_onPositionClosed(callback)
		
	// 	///////////////////////////////////////////
	// 	// _onPositionClosed
	// 	///////////////////////////////////////////
		
	// 	function _onPositionClosed(cb) {
	// 		//User defined
			
	// 		cb(null, null)
	// 	}
	// },

	// onOrderExecuted: function (s, opts = {}, callback = function () { }) {
	// 	let strat_name = this.name
	// 	let strat = s.options.strategy[strat_name]

	// 	_onOrderExecuted(callback)
		
	// 	///////////////////////////////////////////
	// 	// _onOrderExecuted
	// 	///////////////////////////////////////////
		
	// 	function _onOrderExecuted(cb) {
	// 		//User defined
			
	// 		cb(null, null)
	// 	}
	// },

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
