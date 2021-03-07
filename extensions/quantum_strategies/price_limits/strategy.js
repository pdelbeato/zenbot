var n = require('numbro')
	, Phenotypes = require('../../../lib/phenotype')
	, inspect = require('eyes').inspector({ maxLength: 4096 })
	, debug = require('../../../lib/debug')
	, tb = require('timebucket')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['price_limits'] = {
//	opts: {							//****** To store options
//		limit_buy: null,				//Switch off/on long mode if price is above/below this limit
//		limit_sell: null,				//Switch off/on short mode if price is below/above this limit
//		is_active_buy: false,				//Protection on buy (long) active
//		is_active_sell: false,			//Protecion on sell (short) active
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
	name: 'price_limits',
	description: 'Avoid to buy above certain prices. Avoid to sell below certain prices.',
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

		s.positions.forEach(function (position, index) {
			if (!position.strategy_parameters[strat_name]) {
				position.strategy_parameters[strat_name] = {}
			}
		})

		callback(null, null)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, 'limit_buy', 'Switch off/on long mode if price is above/below this limit', Number, 100000)
		this.option(strategy_name, 'limit_sell', 'Switch off/on short mode if price is below/above this limit', Number, 0)
		this.option(strategy_name, 'is_active_buy', 'Protection on buy (long) active', Boolean, false)
		this.option(strategy_name, 'is_active_sell', 'Protection on sell (short) active', Boolean, false)
	},

	getCommands: function (s, strategy_name) {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {
			desc: ('Price limits - List options'.grey), action: function () {
				s.tools.listStrategyOptions(strategy_name, false)
			}
		})
		
		this.command('+', {
			desc: ('Price limits - Buy price limit '.grey + 'INCREASE'.green + ' (if not active, set bid price as limit)'.grey), action: function () {
				if (!strat.opts.is_active_buy) {
					strat.opts.is_active_buy = true
					strat.opts.limit_buy = Number(s.quote.bid)
				}
				strat.opts.limit_buy = (strat.opts.limit_buy + 100 * s.product.increment)
				console.log('\n' + 'Price limits - Buy price limit ' + 'INCREASE'.green + ' -> ' + strat.opts.limit_buy)
			}
		})
		this.command('-', {
			desc: ('Price limits - Buy price limit '.grey + 'DECREASE'.red + ' (if not active, set bid price as limit)'.grey), action: function () {
				if (!strat.opts.is_active_buy) {
					strat.opts.is_active_buy = true
					strat.opts.limit_buy = Number(s.quote.bid)
				}
				strat.opts.limit_buy = (strat.opts.limit_buy - 100 * s.product.increment)
				console.log('\n' + 'Price limits - Buy price limit ' + 'DECREASE'.red + ' -> ' + strat.opts.limit_buy)
			}
		})
		this.command('*', {
			desc: ('Price limits - Sell price limit '.grey + 'INCREASE'.green + ' (if not active, set ask price as limit)'.grey), action: function () {
				if (!strat.opts.is_active_sell) {
					strat.opts.is_active_sell = true
					strat.opts.limit_sell = Number(s.quote.ask)
				}
				strat.opts.limit_sell = (strat.opts.limit_sell + 100 * s.product.increment)
				console.log('\n' + 'Price limits - Sell price limit ' + 'INCREASE'.green + ' -> ' + strat.opts.limit_sell)
			}
		})
		this.command('_', {
			desc: ('Price limits - Sell price limit '.grey + 'DECREASE'.red + ' (if not active, set ask price as limit)'.grey), action: function () {
				if (!strat.opts.is_active_sell) {
					strat.opts.is_active_sell = true
					strat.opts.limit_sell = Number(s.quote.ask)
				}
				strat.opts.limit_sell = (strat.opts.limit_sell - 100 * s.product.increment)
				console.log('\n' + 'Price limits - Sell price limit ' + 'DECREASE'.red + ' -> ' + strat.opts.limit_sell)
			}
		})		
		this.command('u', {
			desc: ('Price limits - Toggle '.grey + 'BUY limit'.green + ' (if no price limit is set, set bid price as limit)'.grey), action: function () {
				strat.opts.is_active_buy = !strat.opts.is_active_buy
				if (strat.opts.is_active_buy && !strat.opts.limit_buy) {
					strat.opts.limit_buy = Number(s.quote.bid)
				}
				console.log('\nToggle BUY Limit: ' + (strat.opts.is_active_buy ? 'ON'.green.inverse : 'OFF'.red.inverse))
			}
		})
		this.command('j', {
			desc: ('Price limits - Toggle '.grey + 'SELL limit'.red + ' (if no price limit is set, set ask price as limit)'.grey), action: function () {
				strat.opts.is_active_sell = !strat.opts.is_active_sell
				if (strat.opts.is_active_sell && !strat.opts.limit_sell) {
					strat.opts.limit_sell = Number(s.quote.ask)
				}
				console.log('\nToggle SELL Limit: ' + (strat.opts.is_active_sell ? 'ON'.green.inverse : 'OFF'.red.inverse))
			}
		})
		this.command('H', {
			desc: ('Price limits - '.grey + 'ZEROIZE'.white + ' (cancel all the limits)'.grey), action: function () {
				strat.lib.deactivate(s, null, function () {
					console.log('\nPrice limits zeroized!'.white)
				})
			}
		})
	},

//	onTrade: function (s, opts = {}, callback = function () { }) {
//		// var opts = {
//		// 		trade: trade,
//		// 		is_preroll: is_preroll
//		// }
//		let strat_name = this.name
//		let strat = s.options.strategy[strat_name]
//				
//		_onTrade(callback)
//		
//		///////////////////////////////////////////
//		// _onTrade
//		///////////////////////////////////////////
//		
//		function _onTrade(cb) {
//			//User defined
//
//			cb()
//		}
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
			s.options.manual = false
			
			if(strat.opts.is_active_buy && (opts.trade.price > strat.opts.limit_buy)) {
				s.options.manual = true
			}
			
			if(strat.opts.is_active_sell && (opts.trade.price < strat.opts.limit_sell)) {
				s.options.manual = true
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
			//User defined
			
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
			if (strat.opts.is_active_buy || strat.opts.is_active_sell) {
				if (s.options.manual) {
					cols.push('Price Limits!!')
				}
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
			
			if ((strat.opts.is_active_buy || strat.opts.is_active_sell) && s.options.manual) {
				result = 'Price Limits!!';
			}
			
			cb(null, result)
		}
	},

//	onPositionOpened: function (s, opts = {}, callback = function () { }) {
//		//var opts = {
//		//	position_id: position_id,
//		//	position: position
//		//};
//
//		let strat_name = this.name
//		let strat = s.options.strategy[strat_name]
//
//		opts.position.strategy_parameters[strat_name] = {}
//
//		_onPositionOpened(callback)
//
//		///////////////////////////////////////////
//		// _onPositionOpened
//		///////////////////////////////////////////
//
//		function _onPositionOpened(cb) {
//			//User defined
//			
//			cb(null, null)
//		}
//	},

//	onPositionUpdated: function (s, opts = {}, callback = function () { }) {
//		//var opts = {
//		//	position_id: position_id,
//		//	position: position
//		//};
//		
//		let strat_name = this.name
//		let strat = s.options.strategy[strat_name]
//
//		_onPositionUpdated(callback)
//		
//		///////////////////////////////////////////
//		// _onPositionUpdated
//		///////////////////////////////////////////
//		
//		function _onPositionUpdated(cb) {
//			//User defined
//			
//			cb(null, null)
//		}
//	},

//	onPositionClosed: function (s, opts = {}, callback = function () { }) {
//		//var opts = {
//		//	position_id: position_id,
//		//	position: position
//		//};
//
//		let strat_name = this.name
//		let strat = s.options.strategy[strat_name]
//
//		_onPositionClosed(callback)
//		
//		///////////////////////////////////////////
//		// _onPositionClosed
//		///////////////////////////////////////////
//		
//		function _onPositionClosed(cb) {
//			//User defined
//			//e.g. strat.lib.onPositionOpened()
//			cb(null, null)
//		}
//	},

//	onOrderExecuted: function (s, opts = {}, callback = function () { }) {
//		let strat_name = this.name
//		let strat = s.options.strategy[strat_name]
//
//		_onOrderExecuted(callback)
//		
//		///////////////////////////////////////////
//		// _onOrderExecuted
//		///////////////////////////////////////////
//		
//		function _onOrderExecuted(cb) {
//			//User defined
//			
//			cb(null, null)
//		}
//	},
	
	deactivate: function(s, opts = {}, callback = function() {}) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]
		
		_deactivate(callback)
		
		///////////////////////////////////////////
		// _deactivate
		///////////////////////////////////////////
		
		function _deactivate(cb) {
			strat.opts.is_active_buy = false
			strat.opts.is_active_sell = false
			strat.opts.limit_buy = null
			strat.opts.limit_sell = null
			s.options.manual = false
			
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
