var n = require('numbro')
	, Phenotypes = require('../../../lib/phenotype')
	, inspect = require('eyes').inspector({ maxLength: 4096 })
	, debug = require('../../../lib/debug')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy[_name_] = {
//	opts: {							//****** To store options
//		option_1: null,
//		option_2: null,
//	}
//}
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
	name: '_name_',
	description: '_Description_',
	noHoldCheck: false,

	init: function (s, callback = function() {}) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]
		

		strat.data = {
			//	data_1: {
			//		data_1_1: null,
			//		data_1_2: null,
			//	},
			//	data_2: {
			//		data_2_1: null,
			//		data_2_2: null,
			//	}
		}

		callback(null, null)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, '_opts_1', 'Description', String, '_default_')
		this.option(strategy_name, '_opts_2', 'Description', Number, 30)
		this.option(strategy_name, '_opts_3', 'Description', Boolean, true)
	},

	getCommands: function (s, opts = {}, callback = function () {}) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		this.command('o', {
			desc: ('_name_ - List options'.grey), action: function () {
				s.tools.listStrategyOptions(strat_name, false)
			}
		})
		
		this.command('g', {
			desc: ('_name_ - Description'), action: function () {
				//User defined
			}
		})

		callback(null, null)
	},

	onTrade: function (s, opts = {}, callback = function () { }) {
		// var opts = {
		// 		trade: trade,
		// 		is_preroll: is_preroll
		// }
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]
				
		_onTrade(callback)
		
		///////////////////////////////////////////
		// _onTrade
		///////////////////////////////////////////
		
		function _onTrade(cb) {
			//User defined

			cb()
		}
	},

	onTradePeriod: function (s, opts = {}, callback = function () { }) {
		// var opts = {
		// 		trade: trade,
		// 		is_preroll: is_preroll
		// }

		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onTradePeriod(function () {
			if (strat.opts.period_calc && (opts.trade.time > strat.calc_close_time)) {
				strat.calc_lookback.unshift(s.period)
				strat.lib.onStrategyPeriod(s, opts, callback)
			}
			else {
				callback()
			}
		})

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
			//User defined
			
			cb(null, null)
		}
	},


	onReport: function (s, opts = {}, callback = function () { }) {
		let strat_name = this.name
		let strat = JSON.parse(JSON.stringify(s.options.strategy[strat_name]))

		if (!opts.actual) {
			strat.data = s.lookback[0].strategy[strat_name].data
		}

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
			//User defined
			
			//cols.push('_something_')

			cb()
		}
	},

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
			//User defined
			
			cb(null, result)
		}
	},

	onPositionOpened: function (s, opts = {}, callback = function () { }) {
		//var opts = {
		//	position_id: position_id,
		//};

		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onPositionOpened(callback)

		///////////////////////////////////////////
		// _onPositionOpened
		///////////////////////////////////////////

		function _onPositionOpened(cb) {
			//User defined
			
			cb(null, null)
		}
	},

	onPositionUpdated: function (s, opts = {}, callback = function () { }) {
		//var opts = {
		//	position_id: position_id,
		//};
		
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onPositionUpdated(callback)
		
		///////////////////////////////////////////
		// _onPositionUpdated
		///////////////////////////////////////////
		
		function _onPositionUpdated(cb) {
			//User defined
			
			cb(null, null)
		}
	},

	onPositionClosed: function (s, opts = {}, callback = function () { }) {
		//		s.closed_positions
		//		var opts = {
		//		position_id: position_id,
		//		};

		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onPositionClosed(callback)
		
		///////////////////////////////////////////
		// _onPositionClosed
		///////////////////////////////////////////
		
		function _onPositionClosed(cb) {
			//User defined
			
			cb(null, null)
		}
	},

	onOrderExecuted: function (s, opts = {}, callback = function () { }) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onOrderExecuted(callback)
		
		///////////////////////////////////////////
		// _onOrderExecuted
		///////////////////////////////////////////
		
		function _onOrderExecuted(cb) {
			//User defined
			
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
