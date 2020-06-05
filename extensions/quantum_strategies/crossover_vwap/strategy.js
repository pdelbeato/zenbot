var n = require('numbro')
	, Phenotypes = require('../../../lib/phenotype')
	, inspect = require('eyes').inspector({ maxLength: 4096 })
	, debug = require('../../../lib/debug')
	, tb = require('timebucket')
	, vwap = require('../../../lib/vwap')
	, { formatPercent } = require('../../../lib/format')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['crossover_vwap'] = {
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate VWAP every period_calc time
//		size: 10,					//****** Min period_calc for vwap to start
//		vwap_max: 96,				//****** Max history for vwap. Increasing this makes it more sensitive to short-term changes
//		upper_threshold_pct: 0.2,		//****** Upper threshold percentage (buy if price goes higher)
//		lower_threshold_pct: 0.2,		//****** Lower threshold percentage (sell if price goes lower)
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
			vwap_upper: null,
			vwap_lower: null,
		}

		s.positions.forEach(function (position, index) {
			if (!position.strategy_parameters[strat_name]) {
				position.strategy_parameters[strat_name] = {}
			}
			
			//Se la posizione è stata aperta da crossover_vwap, la rendo esclusiva di questa strategia.
			if (!(position.opened_by & ~s.strategyFlag[strat_name])) {
				s.tools.positionFlags(position, 'locked', 'Set', strat_name)
			}
		})

		callback(null, null)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, 'period_calc', 'Calculate VWAP every period_calc time', String, '15m')
	    this.option(strategy_name, 'vwap_length', 'Min periods for vwap to start', Number, 10 )
		this.option(strategy_name, 'vwap_max', 'Max history for vwap, afterwards it will be reset (default 1d)', Number, 92)
		this.option(strategy_name, 'upper_threshold_pct', 'Upper threshold percentage (buy if price goes higher)', Number, 0.1)
		this.option(strategy_name, 'lower_threshold_pct', 'Lower threshold percentage (sell if price goes lower)', Number, 0.1)
	    this.option(strategy_name, 'order_type', 'Order type [\'taker\', \'maker\'] (if null, order_type as conf_file)', String, null)
	    this.option(strategy_name, 'on_trade_period', 'If true, signal will be shot on trade period, not on strategy pariod', Boolean, false)
	},

	getCommands: function (s, strategy_name) {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {
			desc: ('Crossover VWAP - List options'.grey), action: function () {
				s.tools.listStrategyOptions(strategy_name, false)
			}
		})
		this.command('+', {
			desc: ('Crossover VWAP - Upper threshold pct '.grey + 'INCREASE'.green), action: function () {
				strat.opts.upper_threshold_pct = Number((strat.opts.upper_threshold_pct + 0.1).toFixed(2))
				console.log('\n' + 'Crossover VWAP - Upper threshold pct ' + 'INCREASE'.green + ' -> ' + strat.opts.upper_threshold_pct)
			}
		})
		this.command('-', {
			desc: ('Crossover VWAP - Upper threshold pct (min 0.0%) '.grey + 'DECREASE'.red), action: function () {
				strat.opts.upper_threshold_pct = Number((strat.opts.upper_threshold_pct - 0.1).toFixed(2))
				if (strat.opts.upper_threshold_pct < 0) {
					strat.opts.upper_threshold_pct = 0
				}
				console.log('\n' + 'Crossover VWAP - Upper threshold pct (min 0.0%) ' + 'DECREASE'.red + ' -> ' + strat.opts.upper_threshold_pct)
			}
		})
		this.command('*', {
			desc: ('Crossover VWAP - Lower threshold pct '.grey + 'INCREASE'.green), action: function () {
				strat.opts.lower_threshold_pct = Number((strat.opts.lower_threshold_pct + 0.1).toFixed(2))
				console.log('\n' + 'Crossover VWAP - Lower threshold pct ' + 'INCREASE'.green + ' -> ' + strat.opts.lower_threshold_pct)
			}
		})
		this.command('_', {
			desc: ('Crossover VWAP - Lower threshold pct (min 0.0%) '.grey + 'DECREASE'.red), action: function () {
				strat.opts.lower_threshold_pct = Number((strat.opts.lower_threshold_pct - 0.1).toFixed(2))
				if (strat.opts.lower_threshold_pct < 0) {
					strat.opts.lower_threshold_pct = 0
				}
				console.log('\n' + 'Crossover VWAP - Lower threshold pct (min 0.0%) ' + 'DECREASE'.red + ' -> ' + strat.opts.lower_threshold_pct)
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
			if (!s.in_preroll && strat.opts.on_trade_period && strat.period.vwap) {
				let position_tmp = null
				var position_protectionFree

				//vwap(s, strat_name, strat.opts.vwap_length, strat.opts.vwap_max, 'close')

				s.positions.some(function (position, index) {
					//Verifico l'esistenza di una posizione aperta (e non bloccata da altri) da crossover_vwap
					let position_locking = (position.locked & ~s.strategyFlag[strat_name])
					let position_opened_by = (position.opened_by & ~s.strategyFlag[strat_name])
					position_protectionFree = s.protectionFlag['calmdown'] + s.protectionFlag['max_slippage'] + s.protectionFlag['min_profit']
					if (!position_locking && !position_opened_by) {
						position_tmp = position
						return true
					}
				})
 
				if (s.period.open > strat.data.vwap_upper) {
					strat.period.trend = 'up'
				}

				if (s.period.open < strat.data.vwap_lower) {
					strat.period.trend = 'down'
				}

				if (strat.calc_lookback[0].trend != strat.period.trend) {
					let side = (strat.period.trend == 'up' ? 'buy' : 'sell')
					if (position_tmp && position_tmp.side != side) {
							//s.eventBus.on(strat_name, side, position_tmp_id, fixedSize, fixdPrice,          protectionFree,    locking,   reorder, maker_taker)
							s.eventBus.emit(strat_name, side, position_tmp.id, undefined, undefined, position_protectionFree, strat_name, undefined, strat.opts.order_type)
						}
						else {
							//s.eventBus.on(strat_name, side,  posit_id, fixedSize, fixdPrice,          protectionFree,    locking,   reorder, maker_taker)
							s.eventBus.emit(strat_name, side, undefined, undefined, undefined, position_protectionFree, strat_name, undefined, strat.opts.order_type)
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
			if (!s.in_preroll) {
				let position_tmp = null
				var position_protectionFree

				strat.period.vwap = vwap(s, strat_name, strat.opts.vwap_length, strat.opts.vwap_max, 'close')
				strat.data.vwap_upper = strat.period.vwap * (1 + strat.opts.upper_threshold_pct/100)
				strat.data.vwap_lower = strat.period.vwap * (1 - strat.opts.lower_threshold_pct/100)

				if (strat.period.vwap && !strat.opts.on_trade_period) {
					s.positions.some(function (position, index) {
						//Verifico l'esistenza di una posizione aperta (e non bloccata da altri) da crossover_vwap
						let position_locking = (position.locked & ~s.strategyFlag[strat_name])
						let position_opened_by = (position.opened_by & ~s.strategyFlag[strat_name])
						position_protectionFree = s.protectionFlag['calmdown'] + s.protectionFlag['max_slippage'] + s.protectionFlag['min_profit']
						if (!position_locking && !position_opened_by) {
							position_tmp = position
							return true
						}
					})

					if (s.period.open > strat.data.vwap_upper) {
						strat.period.trend = 'up'
					}
	
					if (s.period.open < strat.data.vwap_lower) {
						strat.period.trend = 'down'
					}

					if (strat.calc_lookback[0].trend && (strat.calc_lookback[0].trend != strat.period.trend)) {
						let side = (strat.period.trend == 'up' ? 'buy' : 'sell')
						if (position_tmp && position_tmp.side != side) {
							//s.eventBus.on(strat_name, side, position_tmp_id, fixedSize, fixdPrice,          protectionFree,    locking,   reorder, maker_taker)
							s.eventBus.emit(strat_name, side, position_tmp.id, undefined, undefined, position_protectionFree, strat_name, undefined, strat.opts.order_type)
						}
						else {
							//s.eventBus.on(strat_name, side,  posit_id, fixedSize, fixdPrice,          protectionFree,    locking,   reorder, maker_taker)
							s.eventBus.emit(strat_name, side, undefined, undefined, undefined, position_protectionFree, strat_name, undefined, strat.opts.order_type)
						}
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
				cols.push(s.tools.zeroFill(9, n(strat.data.vwap.vwap).format(s.product.increment ? s.product.increment : '0.00000000').substring(0, 9), ' ')[color_vwap])

				s.positions.some(function (position, index) {
					//Verifico l'esistenza di una posizione aperta (e non bloccata da altri) da crossover_vwap
					let position_locking = (position.locked & ~s.strategyFlag[strat_name])
					let position_opened_by = (position.opened_by & ~s.strategyFlag[strat_name])
					if (!position_locking && !position_opened_by && position.profit_net_pct) {
						cols.push(s.tools.zeroFill(8, formatPercent(position.profit_net_pct/100), ' ')[n(position.profit_net_pct) > 0 ? 'green' : 'red'])
						return true
					}
				})
			}
			else {
				cols.push(s.tools.zeroFill(17, '', ' '))
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
			let result = null
			
			if (strat.data.vwap.vwap) {
				s.positions.some(function (position, index) {
					//Verifico l'esistenza di una posizione aperta (e non bloccata da altri) da crossover_vwap
					let position_locking = (position.locked & ~s.strategyFlag[strat_name])
					let position_opened_by = (position.opened_by & ~s.strategyFlag[strat_name])
					if (!position_locking && !position_opened_by && position.profit_net_pct) {
						result = ('Crossover VWAP position: ' + formatPercent(position.profit_net_pct/100))
						return true
					}
				})
			}			
			
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
