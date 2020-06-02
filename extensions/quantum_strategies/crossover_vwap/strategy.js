var n = require('numbro')
	, Phenotypes = require('../../../lib/phenotype')
	, inspect = require('eyes').inspector({ maxLength: 4096 })
	, debug = require('../../../lib/debug')
	, tb = require('timebucket')
	, vwap = require('../../../lib/vwap')
	, ema = require('../../../lib/ema')
	, sma = require('../../../lib/sma')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy[_name_] = {
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate VWAP every period_calc time
//		size: 10,					//****** Min period_calc for vwap to start
//		vwap_max: 8000,				//****** Max history for vwap. Increasing this makes it more sensitive to short-term changes
//		order_type: 'taker',		//****** Order type ['taker', 'maker'] (if null, order_type as conf_file)
//		on_trade_period: false		//****** If true, signal will be shot on trade period, not on strategy pariod
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
	name: 'crossover_vwap',
	description: 'Estimate trends by comparing period close with Volume Weighted Average Price (VWAP).',
	noHoldCheck: false,

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
			vwap: {
	    		  vwap: 0, 
	    		  vwapMultiplier: 0, 
	    		  vwapDivider: 0,
	    		  vwapCount: 0
	      },
		}

		s.positions.forEach(function (position, index) {
			if (!position.strategy_parameters[strat_name]) {
				position.strategy_parameters[strat_name] = {}
			}
		})

		callback(null, null)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, 'period_calc', 'Calculate VWAP every period_calc time', String, '15m')
	    this.option(strategy_name, 'vwap_length', 'Min periods for vwap to start', Number, 10 )
	    this.option(strategy_name, 'vwap_max', 'Max history for vwap. Increasing this makes it more sensitive to short-term changes', Number, 8000)
	    this.option(strategy_name, 'order_type', 'Order type [taker, maker] (if null, order_type as conf_file)', String, null)
	},

	getCommands: function (s, strategy_name) {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {
			desc: ('Crossover VWAP - List options'.grey), action: function () {
				s.tools.listStrategyOptions(strategy_name, false)
			}
		})
		
//		this.command('g', {
//			desc: ('_name_ - Description'), action: function () {
//				//User defined
//			}
//		})
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

		if (strat.opts.period_calc && (opts.trade.time > strat.calc_close_time)) {
			strat.calc_lookback.unshift(strat.period)
			strat.period = {}
			s.tools.initPeriod(strat.period, opts.trade, strat.opts.period_calc)
			strat.lib.onStrategyPeriod(s, opts, function (err, result) {
				strat.calc_close_time = tb(opts.trade.time).resize(strat.opts.period_calc).add(1).toMilliseconds() - 1

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
			if (!s.in_preroll && strat.opts.on_trade_period) {
				let position_tmp = null

				//vwap(s, strat_name, strat.opts.vwap_length, strat.opts.vwap_max, 'close')

				s.positions.forEach(function (position, index) {
					//Verifico l'esistenza di una posizione aperta (e non bloccata da altri) da crossover_vwap
					let position_locking = (position.locked & ~s.strategyFlag[strat_name])
					let position_opened_by = (position.opened_by & ~s.strategyFlag[strat_name])
					if (!position_locking && !position_opened_by) {
						position_tmp = position
						break
					}
				})
 
				if (s.period.open > strat.period.vwap) {
					strat.period.trend = 'up'
				}
				else {
					strat.period.trend = 'down'
				}

				if (strat.calc_lookback[0].trend != strat.period.trend) {
					let side = (strat.period.trend == 'up' ? 'buy' : 'sell')
					if (position_tmp && position_tmp.side != side) {
						//s.eventBus.on(strat_name, side,  posit_id, fixedSize, fixdPrice,   protect,   locking,   reorder, maker_taker)
						s.eventBus.emit(strat_name, side, position_tmp.id, undefined, undefined, undefined, undefined, undefined, strat.opts.order_type)
					}
					else {
						//s.eventBus.on(strat_name, side,  posit_id, fixedSize, fixdPrice,   protect,   locking,   reorder, maker_taker)
						s.eventBus.emit(strat_name, side, undefined, undefined, undefined, undefined, undefined, undefined, strat.opts.order_type)
					}
				}
			}
			
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
			if (!s.in_preroll && !strat.opts.on_trade_period) {
				let position_tmp = null

				vwap(s, strat_name, strat.opts.vwap_length, strat.opts.vwap_max, 'close')

				s.positions.forEach(function (position, index) {
					//Verifico l'esistenza di una posizione aperta (e non bloccata da altri) da crossover_vwap
					let position_locking = (position.locked & ~s.strategyFlag[strat_name])
					let position_opened_by = (position.opened_by & ~s.strategyFlag[strat_name])
					if (!position_locking && !position_opened_by) {
						position_tmp = position
						break
					}
				})

				if (strat.period.open > strat.period.vwap) {
					strat.period.trend = 'up'
				}
				else {
					strat.period.trend = 'down'
				}

				if (strat.calc_lookback[0].trend != strat.period.trend) {
					let side = (strat.period.trend == 'up' ? 'buy' : 'sell')
					if (position_tmp && position_tmp.side != side) {
						//s.eventBus.on(strat_name, side,  posit_id, fixedSize, fixdPrice,   protect,   locking,   reorder, maker_taker)
						s.eventBus.emit(strat_name, side, position_tmp.id, undefined, undefined, undefined, undefined, undefined, strat.opts.order_type)
					}
					else {
						//s.eventBus.on(strat_name, side,  posit_id, fixedSize, fixdPrice,   protect,   locking,   reorder, maker_taker)
						s.eventBus.emit(strat_name, side, undefined, undefined, undefined, undefined, undefined, undefined, strat.opts.order_type)
					}
				}
			}
			
			cb(null, null)
		}
	},


	onReport: function (s, opts = {}, callback = function () { }) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

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
			if (strat.data.vwap.vwap) {
			color_vwap = (strat.period.trend == 'up' ? 'green' : 'red')
//			cols.push('(' + s.tools.zeroFill(2, n(strat.data.rsi).format('0'), ' ')[color_rsi] + ')')
			cols.push(s.tools.zeroFill(10, n(strat.data.vwap.vwap).format(s.product.increment ? s.product.increment : '0.00000000').substring(0, 9), ' ')[color_vwap])
			}
			else {
				cols.push(s.tools.zeroFill(10, '', ' '))
			}

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
		//	position: position
		//};

		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		opts.position.strategy_parameters[strat_name] = {}

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
		//	position: position
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
		//var opts = {
		//	position_id: position_id,
		//	position: position
		//};

		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onPositionClosed(callback)
		
		///////////////////////////////////////////
		// _onPositionClosed
		///////////////////////////////////////////
		
		function _onPositionClosed(cb) {
			//User defined
			//e.g. strat.lib.onPositionOpened()
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
