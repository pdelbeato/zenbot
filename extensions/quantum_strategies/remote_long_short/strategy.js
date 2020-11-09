var n = require('numbro')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector({ maxLength: 4096 })
, debug = require('../../../lib/debug')
, tb = require('timebucket')
, fs = require('fs')
, request = require('request')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['remote_long_short'] = {
//opts: {
//period_calc: '1h',
//active: false,
//}
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
	name: 'remote_long_short',
	description: 'Retrieve long/short mode from an url',
	noHoldCheck: false,

	init: function (s, callback = function() {}) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		if (strat.opts.size == undefined) {
			strat.opts.size = 0
		}
		
		if (strat.opts.period_calc == undefined) {
			strat.opts.period_calc = '1m'
		}
		
//		if (strat.opts.size && strat.opts.period_calc) {
			strat.opts.min_periods = tb(strat.opts.size, strat.opts.period_calc).resize(s.options.period_length).value
//		}
//		else {
//			strat.opts.min_periods = 0
//		}

		strat.data = {
		}

//		s.positions.forEach(function (position, index) {
//		if (!position.strategy_parameters[strat_name]) {
//		position.strategy_parameters[strat_name] = {}
//		}
//		})

//		callback(null, null)

		strat.lib.onStrategyPeriod(s, callback)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, 'period_calc', 'Retrieve every period_calc time', String, '15m')
		this.option(strategy_name, 'url', 'URL where to retrieve remote mode commands', String, 'https://neuralbuck.000webhostapp.com/signal.json')

	},

	getCommands: function (s, strategy_name) {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {
			desc: ('Remote long/short - List options'.grey), action: function () {
				s.tools.listStrategyOptions(strategy_name, false)
			}
		})

		this.command('k', {
			desc: ('Remote long/short - '.grey + 'Retrieve now!'.white), action: function () {
				if (strat.opts.active) {
					strat.lib.onStrategyPeriod(s)
				}
				else {
					console.log('\nRemote long/short - '.grey + 'Strategy not active!'.red)
				}
			}
		})

		this.command('i', {
			desc: ('Remote long/short - '.grey + 'Toggle'.white), action: function () {
				strat.opts.active = !strat.opts.active
				console.log('\nToggle Remote long/short: ' + (strat.opts.active ? 'ON'.green.inverse : 'OFF'.red.inverse))
			}
		})
	},

//	onTrade: function (s, opts = {}, callback = function () { }) {
//	// var opts = {
//	// 		trade: trade,
//	// 		is_preroll: is_preroll
//	// }
//	let strat_name = this.name
//	let strat = s.options.strategy[strat_name]

//	_onTrade(callback)

//	///////////////////////////////////////////
//	// _onTrade
//	///////////////////////////////////////////

//	function _onTrade(cb) {
//	//User defined

//	cb()
//	}
//	},

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
				strat.calc_close_time = tb(opts.trade.time).resize(strat.opts.period_calc).add(1).toMilliseconds() - 1

				// Ripulisce so.strategy[strategy_name].calc_lookback a un max di valori
				if (strat.calc_lookback.length > strat.opts.size) {
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
			var url = strat.opts.url //'https://neuralbuck.000webhostapp.com/signal.json'

			if (strat.opts.active) {
				request.get({ url: url, json: true }, (err, res, data) => {
					if (err) {
						// handle error
						console.error('URL not found or network error')
					}
					else if (res.statusCode === 200) {
						console.log('\nRemote long/short - '.grey + 'Retrieved mode: ' + data.cyan)

						if (data == 'only_short') {
							s.options.active_long_position = false
							s.options.active_short_position = true
						} else if (data == 'only_long') {
							s.options.active_long_position = true
							s.options.active_short_position = false
						} else if (data == 'long_short') {
							s.options.active_long_position = true
							s.options.active_short_position = true
						}
					}
					else {
						// response other than 200 OK
					}
				})
			}

			cb(null, null)
		}
	},


//	onReport: function (s, opts = {}, callback = function () { }) {
//	let strat_name = this.name
//	let strat = s.options.strategy[strat_name]

//	var cols = []

//	_onReport(function() {
//	cols.forEach(function (col) {
//	process.stdout.write(col)
//	})
//	callback(null, null)
//	})

//	/////////////////////////////////////////////////////
//	// _onReport() deve inserire in cols[] le informazioni da stampare a video
//	/////////////////////////////////////////////////////

//	function _onReport(cb) {
//	//User defined

//	//cols.push('_something_')

//	cb()
//	}
//	},

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

			if (strat.opts.active) {
				result = 'Remote long/short: ' + strat.opts.active
			}

			cb(null, result)
		}
	},

//	onPositionOpened: function (s, opts = {}, callback = function () { }) {
//	//var opts = {
//	//	position_id: position_id,
//	//	position: position
//	//};

//	let strat_name = this.name
//	let strat = s.options.strategy[strat_name]

//	opts.position.strategy_parameters[strat_name] = {}

//	_onPositionOpened(callback)

//	///////////////////////////////////////////
//	// _onPositionOpened
//	///////////////////////////////////////////

//	function _onPositionOpened(cb) {
//	//User defined

//	cb(null, null)
//	}
//	},

//	onPositionUpdated: function (s, opts = {}, callback = function () { }) {
//	//var opts = {
//	//	position_id: position_id,
//	//	position: position
//	//};

//	let strat_name = this.name
//	let strat = s.options.strategy[strat_name]

//	_onPositionUpdated(callback)

//	///////////////////////////////////////////
//	// _onPositionUpdated
//	///////////////////////////////////////////

//	function _onPositionUpdated(cb) {
//	//User defined

//	cb(null, null)
//	}
//	},

//	onPositionClosed: function (s, opts = {}, callback = function () { }) {
//	//var opts = {
//	//	position_id: position_id,
//	//	position: position
//	//};

//	let strat_name = this.name
//	let strat = s.options.strategy[strat_name]

//	_onPositionClosed(callback)

//	///////////////////////////////////////////
//	// _onPositionClosed
//	///////////////////////////////////////////

//	function _onPositionClosed(cb) {
//	//User defined
//	//e.g. strat.lib.onPositionOpened()
//	cb(null, null)
//	}
//	},

//	onOrderExecuted: function (s, opts = {}, callback = function () { }) {
//	let strat_name = this.name
//	let strat = s.options.strategy[strat_name]

//	_onOrderExecuted(callback)

//	///////////////////////////////////////////
//	// _onOrderExecuted
//	///////////////////////////////////////////

//	function _onOrderExecuted(cb) {
//	//User defined

//	cb(null, null)
//	}
//	},

	deactivate: function(s, opts = {}, callback = function() {}) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_deactivate(callback)

		///////////////////////////////////////////
		// _deactivate
		///////////////////////////////////////////

		function _deactivate(cb) {
			strat.opts.active = false

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
