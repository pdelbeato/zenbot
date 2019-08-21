var z = require('zero-fill')
, n = require('numbro')
, linearRegSlope = require('../../../lib/ta_linearreg_slope')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector({maxLength: 4096 })
, { formatPercent } = require('../../../lib/format')
, debug = require('../../../lib/debug')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['linear_reg_trend'] = {
//	name: 'linear_reg_trend',
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate linear regression every period_calc time
//		min_periods: 1501, 			//****** Minimum number of history periods (timeframe period_length)
//		size: 100,					//****** Use 'size' period to calculate linear regression
//		upper_threshold: 2,			//****** Upper threshold (long if price is higher)
//		lower_threshold: -2,			//****** Lower threshold (short if price is lower)
//		activated: false,			//****** Activate this strategy
//	},
//	data: {							//****** To store calculated data
//		slope: null,
//	},	
//	calc_lookback: [],				//****** Old periods for calculation
//	calc_close_time: 0,				//****** Close time for strategy period
//	lib: {}							//****** To store all the functions of the strategy
//}
//---------------------------------------------

//position.strategy_parameters.linear_reg_trend: {
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
	description: 'Change long/short mode depending on linear regression of prices.',
	noHoldCheck: false,

	init: function (s) {
	},
	
	getOptions: function () {
		this.option('linear_reg_trend', 'period_calc', 'Calculate Linear Regression Trend every period_calc time', String, '15m')
		this.option('linear_reg_trend', 'min_periods', 'Min. number of history periods', Number, 1501)
		this.option('linear_reg_trend', 'size', 'Use \'size\' period to calculate linear regression', Number, 20)
		this.option('linear_reg_trend', 'upper_threshold', 'Upper threshold (long if price is higher)', Number, 2)
		this.option('linear_reg_trend', 'lower_threshold', 'Lower threshold (short if price is lower)', Number, 2)
	},

	getCommands: function (s, opts = {}, cb = function() {}) {
		let strat_opts = s.options.strategy.linear_reg_trend.opts
		let strat_data = s.options.strategy.linear_reg_trend.data

		this.command('o', {desc: ('Linear Regression Trend - List options'.grey), action: function() {
			s.tools.listStrategyOptions('linear_reg_trend', false)
		}})
		this.command('i', {desc: 'Linear Regression Trend - Toggle activation'.grey, action: function() {
			strat_opts.activated = !strat_opts.activated
			console.log('\nToggle activation: ' + (strat_opts.activated ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		
		cb()
	},

	onTrade: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	onTradePeriod: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	onStrategyPeriod: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.linear_reg_trend.opts
		let strat_data = s.options.strategy.linear_reg_trend.data

		linearRegSlope(s, 'linear_reg_trend', strat_opts.size, 'close').then(result => {
			if(result && result.outReal) {
				strat_data.slope = result.outReal
			}
		}).catch(function(error) {
			console.log(error)
		})
		cb()		
	},


	onReport: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.linear_reg_trend.opts
		let strat_data = s.options.strategy.linear_reg_trend.data

		var cols = []
		var color = null
		if (strat_data.slope) {			
			if (strat_data.slope > strat_opts.upper_threshold) {
				color = 'green'
			}
			else if (strat_data.slope > strat_opts.lower_threshold) {
				color = 'white'
			}
			else {
				color = 'red'
			}

			cols.push(z(6, ('[' + n(strat_data.slope).format('0.00') + '‰]'), ' ')[color])
		}
		else {
			cols.push(z(6, '', ' '))
		}

		cols.forEach(function (col) {
			process.stdout.write(col)
		})

		cb()
	},

	onUpdateMessage: function (s, opts= {}, cb = function() {}) {
		let slope = s.options.strategy.linear_reg_trend.data.slope

		let result = ('Linear Regression Trend: ' + slope)
//		debug.msg('Strategy Bollinger - onUpdateMessage: ' + result)
		cb(result)		
	},

	onPositionOpened: function (s, opts= {}, cb = function() {}) {
//		var opts = {
//		position_id: position_id,
//		};
		
		cb()
	},

	onPositionUpdated: function (s, opts= {}, cb = function() {}) {
//		var opts = {
//		position_id: position_id,
//		};

		cb()
	},

	onPositionClosed: function (s, opts= {}, cb = function() {}) {
//		s.closed_positions
//		var opts = {
//		position_id: position_id,
//		}; 
		
		cb()
	},

	onOrderExecuted: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	printOptions: function(s, opts= { only_opts: false }, cb = function() {}) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.bollinger))
		delete so_tmp.calc_lookback
		delete so_tmp.calc_close_time
		delete so_tmp.lib

		if (opts.only_opts) {
			delete so_tmp.data
		}
		console.log('\nSTRATEGY'.grey + '\t' + this.name + '\t' + this.description.grey + '\n')
		console.log('\n' + inspect(so_tmp))
		cb()
	},

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
		time: Phenotypes.RangeFloat(1,6),
		upper_bound_pct: Phenotypes.RangeFloat(-1, 30),
		lower_bound_pct: Phenotypes.RangeFloat(-1, 30),
		upper_watchdog_pct: Phenotypes.RangeFloat(50, 300),
		lower_watchdog_pct: Phenotypes.RangeFloat(50, 300),
		calmdown_watchdog_pct: Phenotypes.RangeFloat(-50, 80)
	}
}
