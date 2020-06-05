var n = require('numbro')
	, Phenotypes = require('../../../lib/phenotype')
	, inspect = require('eyes').inspector({ maxLength: 4096 })
	, debug = require('../../../lib/debug')
	, tb = require('timebucket')
	, { formatPercent } = require('../../../lib/format')


//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['stoploss'] = {
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Execute profitstop every period_calc time
//		order_type: 'maker', 		//****** Order type
//		buy_stop_pct: 10,			//****** For a SELL position, buy if price rise above this % of bought price
//		sell_stop_pct: 10,			//****** For a BUY position, sell if price drops below this % of bought price
//	},
//---------------------------------------------


//position.strategy_parameters.stoploss: {
//		buy_stop: null,				**** Buy stop price (short position)
//		sell_stop: null,			**** Sell stop price (long position)
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
	name: 'stoploss',
	description: 'Stoploss strategy',
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
		}

		s.positions.forEach(function (position, index) {
			if (!position.strategy_parameters[strat_name]) {
				position.strategy_parameters[strat_name] = {}
			}
		})

		callback(null, null)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, 'period_calc', 'calculate closing price every period_calc time', String, '15m')
		this.option(strategy_name, 'order_type', 'Order type (maker/taker)', String, 'maker')
		this.option(strategy_name, 'buy_stop_pct', 'For a SELL position, buy if price rise above this % of bought price', Number, 10)
		this.option(strategy_name, 'sell_stop_pct', 'For a BUY position, sell if price drops below this % of bought price', Number, 10)
	},

	getCommands: function (s, strategy_name) {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {desc: ('Stoploss - List options'.grey), action: function() {
			s.tools.listStrategyOptions(strategy_name, false)
		}})
		this.command('u', {desc: ('Stoploss - Buy stop price (short position)'.grey + ' INCREASE'.green), action: function() {
			strat.opts.buy_stop_pct = Number((strat.opts.buy_stop_pct + 0.05).toFixed(2))
			console.log('\n' + 'Stoploss - Buy stop price' + ' INCREASE'.green + ' -> ' + strat.opts.buy_stop_pct)
		}})
		this.command('j', {desc: ('Stoploss - Buy stop price (short position)'.grey + ' DECREASE'.red), action: function() {
			strat.opts.buy_stop_pct = Number((strat.opts.buy_stop_pct - 0.05).toFixed(2))
			console.log('\n' + 'Stoploss - Buy stop price' + ' DECREASE'.red + ' -> ' + strat.opts.buy_stop_pct)
		}})
		this.command('i', {desc: ('Stoploss - Sell stop price (long position)'.grey + ' INCREASE'.green), action: function() {
			strat.opts.sell_stop_pct = Number((strat.opts.sell_stop_pct + 0.05).toFixed(2))
			console.log('\n' + 'Stoploss - Sell stop price' + ' INCREASE'.green + ' -> ' + strat.opts.sell_stop_pct)
		}})
		this.command('k', {desc: ('Stoploss - Sell stop price (long position)'.grey + ' DECREASE'.red), action: function() {
			strat.opts.sell_stop_pct = Number((strat.opts.sell_stop_pct - 0.05).toFixed(2))
			console.log('\n' + 'Stoploss - Sell stop price' + ' DECREASE'.green + ' -> ' + strat.opts.sell_stop_pct)
		}})
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
				strat.calc_close_time = tb(opts.trade.time).resize(strat.opts.period_calc).add(1).toMilliseconds() - 1

				// Ripulisce so.strategy[strategy_name].calc_lookback a un max di valori
				if (strat.calc_lookback.length > strat.opts.min_periods) {
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
//			debug.msg('stoploss strategy - onStrategyPeriod')
			if (!s.in_preroll && s.options.strategy.stoploss.calc_lookback[0].close) {
				s.positions.forEach( function (position, index) {
					position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
					position_stop = position.strategy_parameters.stoploss[position_opposite_signal + '_stop']				

					if (position_stop && !position.locked && !s.tools.positionFlags(position, 'status', 'Check', strat_name) && ((position.side == 'buy' ? +1 : -1) * (s.options.strategy.stoploss.calc_lookback[0].close - position_stop) < 0)) {
						console.log(('\n' + position_opposite_signal.toUpperCase() + ' stop loss triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').red)
						s.tools.pushMessage('Stop Loss Protection', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
						s.signal = position_opposite_signal[0].toUpperCase() + ' Stoploss';
						let protectionFree = s.protectionFlag['calmdown'] + s.protectionFlag['max_slippage'] + s.protectionFlag['min_profit']
						if (s.options.mode != 'sim') {
							s.options.active_long_position = false
							s.options.active_short_position = false
						}
						//s.eventBus.on('manual', (signal, position_id, fixed_size, fixed_price, protectionFree, locking = 'manual', is_reorder = false, maker_taker = undefined) => {
						s.eventBus.emit(strat_name, position_opposite_signal, position.id, undefined, undefined, protectionFree, 'free', false, strat.opts.order_type)
					}
					else {
						s.signal = null
					}
				})
			}
			
			cb(null, null)
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
	// 		//User defined
			
	// 		cb(null, result)
	// 	}
	// },

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
			strat.lib.onPositionUpdated(s, opts, cb)
		}
	},

	onPositionUpdated: function (s, opts = {}, callback = function () { }) {
		//var opts = {
		//	position_id: position_id,
		//	position: position,
		//};
		
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		_onPositionUpdated(callback)
		
		///////////////////////////////////////////
		// _onPositionUpdated
		///////////////////////////////////////////
		
		function _onPositionUpdated(cb) {
			// var position = s.positions.find(x => x.id === opts.position_id)
			var position = opts.position

			position.strategy_parameters[strat_name].buy_stop = (position.side == 'sell' ? n(position.price_open).multiply(1 + strat.opts.buy_stop_pct/100).format(s.product.increment) : null)
			position.strategy_parameters[strat_name].sell_stop = (position.side == 'buy' ? n(position.price_open).multiply(1 - strat.opts.sell_stop_pct/100).format(s.product.increment) : null)
			
			cb(null, null)
		}
	},

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

	// onOrderExecuted: function (s, opts = {}, callback= function () { }) {
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
