var n = require('numbro')
	, Phenotypes = require('../../../lib/phenotype')
	, inspect = require('eyes').inspector({ maxLength: 4096 })
	, debug = require('../../../lib/debug')
	, tb = require('timebucket')
	, { formatPercent } = require('../../../lib/format')


//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['trailing_stop'] = {
//	opts: {							//****** To store options
//		period_calc: '15m',				//****** Execute trailing stop every period_calc time ('null' -> execute every trade)
//		order_type: 'taker', 			//****** Order type
//		trailing_stop_enable_pct: 2,	//****** Enable trailing stop when reaching this % profit
//		trailing_stop_pct: 0.5,			//****** Maintain a trailing stop this % below the high-water mark of profit
//	},
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
	name: 'trailing_stop',
	description: 'Trailing Stop strategy',
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
				max_trail_profit_position_id: {	//****** Position ids with max trailing profit
					buy: null,
					sell: null,
				}
		}

		s.positions.forEach(function (position) {
			if (!position.strategy_parameters[strat_name]) {
				position.strategy_parameters[strat_name] = {}
			}
		})

		callback(null, null)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, 'period_calc', 'Execute trailing stop every period_calc time', String, '15m')
		this.option(strategy_name, 'order_type', 'Order type (maker/taker)', String, 'maker')
		this.option(strategy_name, 'trailing_stop_enable_pct', 'Enable trailing stop when reaching this % profit', Number, 2)
		this.option(strategy_name, 'trailing_stop_pct', 'Maintain a trailing stop this % below the high-water mark of profit', Number, 0.5)
	},

	getCommands: function (s, strategy_name) {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {desc: ('Trailing Stop - List options'.grey), action: function() {
			s.tools.listStrategyOptions(strategy_name, false)
		}})
		this.command('u', {desc: ('Trailing Stop - Enabling pct'.grey + ' INCREASE'.green), action: function() {
			strat.opts.trailing_stop_enable_pct = Number((strat.opts.trailing_stop_enable_pct + 0.05).toFixed(2))
			console.log('\n' + 'Trailing Stop - Enabling pct' + ' INCREASE'.green + ' -> ' + strat.opts.trailing_stop_enable_pct)
		}})
		this.command('j', {desc: ('Trailing Stop - Enabling pct'.grey + ' DECREASE'.green), action: function() {
			strat.opts.trailing_stop_enable_pct = Number((strat.opts.trailing_stop_enable_pct - 0.05).toFixed(2))
			console.log('\n' + 'Trailing Stop - Enabling pct' + ' DECREASE'.red + ' -> ' + strat.opts.trailing_stop_enable_pct)
		}})
		this.command('i', {desc: ('Trailing Stop - Trailing stop pct'.grey + ' INCREASE'.green), action: function() {
			strat.opts.trailing_stop_pct = Number((strat.opts.trailing_stop_pct + 0.05).toFixed(2))
			console.log('\n' + 'Trailing Stop - Trailing stop pct' + ' INCREASE'.green + ' -> ' + strat.opts.trailing_stop_pct)
		}})
		this.command('k', {desc: ('Trailing Stop - Trailing stop pct'.grey + ' DECREASE'.red), action: function() {
			strat.opts.trailing_stop_pct = Number((strat.opts.trailing_stop_pct - 0.05).toFixed(2))
			console.log('\n' + 'Trailing Stop - Trailing stop pct' + ' DECREASE'.red + ' -> ' + strat.opts.trailing_stop_pct)
		}})
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
			if (!s.in_preroll) {
				//Eseguo il controllo su ogni trade solo se non ho specificato period_calc
				if (!strat.opts.period_calc) {
					strat.data.max_trail_profit_position_id = {
						buy: null,
						sell: null,
					}
				
					if (opts.trade) {
						let max_trail_profit = -100
						s.positions.forEach(function (position, index) {
							//Se la posizione non ha ordini aperti in trailing_stop, non è locked in trailing_stop, controllo se il suo profitto ha superato il limite per attivare il trailin stop
//							if (!s.tools.positionFlags(position, 'status', 'Check', strat_name) && !s.tools.positionFlags(position, 'locked', 'Check', strat_name) && position.profit_net_pct >= strat.opts.trailing_stop_enable_pct) {
							if (!s.tools.positionFlags(position, 'status', 'Check', strat_name) && !position.locked && position.profit_net_pct >= strat.opts.trailing_stop_enable_pct) {
								s.tools.positionFlags(position, 'locked', 'Set', strat_name)
							}

							//Se la posizione ha il flag trailing_stop, aggiorno i valori del trailing stop
							// (E' un nuovo if, e non un else al precedente, perchè così esegue i calcoli anche se la posizione è appena entrata in trailing stop)
							if (s.tools.positionFlags(position, 'locked', 'Check', strat_name)) {
								if (position.side === 'buy') {
									position.strategy_parameters.trailing_stop.trailing_stop_limit = Math.max(position.strategy_parameters.trailing_stop.trailing_stop_limit || opts.trade.price, opts.trade.price)
									position.strategy_parameters.trailing_stop.trailing_stop = position.strategy_parameters.trailing_stop.trailing_stop_limit - (position.strategy_parameters.trailing_stop.trailing_stop_limit * (strat.opts.trailing_stop_pct / 100))
								}
								else {
									position.strategy_parameters.trailing_stop.trailing_stop_limit = Math.min(position.strategy_parameters.trailing_stop.trailing_stop_limit || opts.trade.price, opts.trade.price)
									position.strategy_parameters.trailing_stop.trailing_stop = position.strategy_parameters.trailing_stop.trailing_stop_limit + (position.strategy_parameters.trailing_stop.trailing_stop_limit * (strat.opts.trailing_stop_pct / 100))
								}
								//Controllo se la posizione sia quella con il maggiore profitto
								if (position.profit_net_pct >= max_trail_profit) {
									max_trail_profit = position.profit_net_pct
									strat.data.max_trail_profit_position_id[position.side] = position.id
//									debug.msg('Strategy Trailing Stop - onTrade - max_trail_profit_position_id.' + position.side + ' = ' + position.id, false)
								}
							} 
						})
					}

					s.positions.forEach(function (position, index) {
						position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
						position_stop = position[position_opposite_signal + '_stop']
						position_locking = (position.locked & ~s.strategyFlag[strat_name])
						if (position.strategy_parameters.trailing_stop.trailing_stop && !position_locking && !s.tools.positionFlags(position, 'status', 'Check', strat_name) && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position.strategy_parameters.trailing_stop.trailing_stop) < 0)) {
							console.log(('\nStrategy trailing_stop - Profit stop triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').green)
							s.tools.pushMessage('Strategy trailing_stop', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
							s.signal = position.side[0].toUpperCase() + ' Trailing stop';
							let protectionFree = s.protectionFlag['calmdown']

							s.eventBus.emit(strat_name, position_opposite_signal, position.id, undefined, undefined, protectionFree, 'free', false, strat.opts.order_type)
							
							position.strategy_parameters.trailing_stop.trailing_stop = null
							position.strategy_parameters.trailing_stop.trailing_stop_limit = null
//							strat.data.max_trail_profit_position_id[position.side] = null
							s.tools.positionFlags(position, 'locked', 'Unset', strat_name)
							return
						}
//						else {
//							s.signal = null
//						}
					})
				}
			}

			cb(null, null)
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
			
			cb(null, null)
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
				//Eseguo il controllo ad ogni period_calc solo se è stato specificato, altrimenti il controllo è su ogni trade
				if (strat.opts.period_calc) {
//					debug.msg('trailing_stop strategy - onStrategyPeriod')
					strat.data.max_trail_profit_position_id = {
						buy: null,
						sell: null,
					}
				
					if (strat.calc_lookback[0]) {
						let max_trail_profit = -100
						s.positions.forEach(function (position, index) {
							//Se la posizione non ha ordini aperti in trailing_stop, non è locked, controllo se il suo profitto ha superato il limite per attivare il trailin stop
//							if (!s.tools.positionFlags(position, 'status', 'Check', strat_name) && !s.tools.positionFlags(position, 'locked', 'Check', strat_name) && position.profit_net_pct >= strat.opts.trailing_stop_enable_pct) {
							if (!s.tools.positionFlags(position, 'status', 'Check', strat_name) && !position.locked && position.profit_net_pct >= strat.opts.trailing_stop_enable_pct) {
								s.tools.positionFlags(position, 'locked', 'Set', strat_name)
							}

							//Se la posizione ha il flag trailing_stop, aggiorno i valori del trailing stop
							// (E' un nuovo if, e non un else al precedente, perchè così esegue i calcoli anche se la posizione è appena entrata in trailing stop)
							if (s.tools.positionFlags(position, 'locked', 'Check', strat_name)) {
								if (position.side === 'buy') {
									position.strategy_parameters.trailing_stop.trailing_stop_limit = Math.max(position.strategy_parameters.trailing_stop.trailing_stop_limit || strat.calc_lookback[0].close, strat.calc_lookback[0].close)
									position.strategy_parameters.trailing_stop.trailing_stop = position.strategy_parameters.trailing_stop.trailing_stop_limit - (position.strategy_parameters.trailing_stop.trailing_stop_limit * (strat.opts.trailing_stop_pct / 100))
								}
								else {
									position.strategy_parameters.trailing_stop.trailing_stop_limit = Math.min(position.strategy_parameters.trailing_stop.trailing_stop_limit || strat.calc_lookback[0].close, strat.calc_lookback[0].close)
									position.strategy_parameters.trailing_stop.trailing_stop = position.strategy_parameters.trailing_stop.trailing_stop_limit + (position.strategy_parameters.trailing_stop.trailing_stop_limit * (strat.opts.trailing_stop_pct / 100))
								}
								//Controllo se la posizione sia quella con il maggiore profitto
								if (position.profit_net_pct >= max_trail_profit) {
									max_trail_profit = position.profit_net_pct
									strat.data.max_trail_profit_position_id[position.side] = position.id
//									debug.msg('Strategy Trailing Stop - onStrategyPeriod - max_trail_profit_position_id.' + position.side + ' = ' + position.id, false)
								}
							} 
						})
					}

					s.positions.forEach(function (position, index) {
						position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
						position_stop = position[position_opposite_signal + '_stop']
						position_locking = (position.locked & ~s.strategyFlag[strat_name])
						if (position.strategy_parameters.trailing_stop.trailing_stop && !position_locking && !s.tools.positionFlags(position, 'status', 'Check', strat_name) && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position.strategy_parameters.trailing_stop.trailing_stop) < 0)) { // && position.profit_net_pct > 0) {
							console.log(('\nStrategy trailing_stop - Profit stop triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').green)
							s.tools.pushMessage('Strategy trailing_stop', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
							s.signal = position.side[0].toUpperCase() + ' Trailing stop';
							let protectionFree = s.protectionFlag['calmdown']
							s.eventBus.emit(strat_name, position_opposite_signal, position.id, undefined, undefined, protectionFree, 'free', false, strat.opts.order_type)
							position.strategy_parameters.trailing_stop.trailing_stop = null
							position.strategy_parameters.trailing_stop.trailing_stop_limit = null
//							strat.data.max_trail_profit_position_id[position.side] = null
							s.tools.positionFlags(position, 'locked', 'Unset', strat_name)
							return
						}
//						else {
//							s.signal = null
//						}
					})
				}
			}
			
			cb(null, null)
		}
	},


	onReport: function (s, opts = {}, callback = function () { }) {
		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		var cols = []

		_onReport(function () {
			if (cols.length != 0) {
				cols.forEach(function (col) {
					process.stdout.write(col)
				})
			}
			callback(null, null)
		})
		
		/////////////////////////////////////////////////////
		// _onReport() deve inserire in cols[] le informazioni da stampare a video
		/////////////////////////////////////////////////////

		function _onReport(cb) {
			if (strat.data.max_trail_profit_position_id.buy != null || strat.data.max_trail_profit_position_id.sell != null) {
				position_buy_profit = -1
				position_sell_profit = -1
				
				if (strat.data.max_trail_profit_position_id.buy != null) {
					let position_buy = s.positions.find(x => x.id === strat.data.max_trail_profit_position_id.buy)
					//Se per qualche arcano motivo (capita ad esempio se mentre vendo, la posizione viene scelta per essere la max_trail_profit_position)
					// la posizione non esiste, è meglio azzerare questa variabile
					if (position_buy) {
						position_buy_profit = position_buy.profit_net_pct/100
					}
					else {
						strat.data.max_trail_profit_position_id.buy = null
					}
				}

				if (strat.data.max_trail_profit_position_id.sell != null) {
					let position_sell = s.positions.find(x => x.id === strat.data.max_trail_profit_position_id.sell)
					//Se per qualche arcano motivo (capita ad esempio se mentre vendo, la posizione viene scelta per essere la max_trail_profit_position)
					// la posizione non esiste, è meglio azzerare questa variabile
					if (position_sell) {
						position_sell_profit = position_sell.profit_net_pct/100
					}
					else {
						strat.data.max_trail_profit_position_id.sell = null
					}
				}

				buysell = (position_buy_profit > position_sell_profit ? 'B' : 'S')
				buysell_profit = (position_buy_profit > position_sell_profit ? formatPercent(position_buy_profit) : formatPercent(position_sell_profit))

				cols.push(s.tools.zeroFill(8, buysell + buysell_profit, ' ')['yellow'])
			}
			else {
				cols.push(s.tools.zeroFill(8, '', ' '))
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
			let side_max_trail_profit = null
			let pct_max_trail_profit = null
			let result = null
			
			if (strat.data.max_trail_profit_position_id.buy != null || strat.data.max_trail_profit_position_id.sell != null) {
				let position = {
					buy: s.positions.find(x => x.id === strat.data.max_trail_profit_position_id.buy),
					sell: s.positions.find(x => x.id === strat.data.max_trail_profit_position_id.sell),
				}
				
				side_max_trail_profit =  ((position.buy ? position.buy.profit_net_pct : -100) > (position.sell ? position.sell.profit_net_pct : -100) ? 'buy' : 'sell')
				pct_max_trail_profit = position[side_max_trail_profit].profit_net_pct
				result = ('Trailing position: ' + (side_max_trail_profit[0].toUpperCase() + formatPercent(pct_max_trail_profit/100)))
			}
			
			cb(null, result)
		}
	},

	onPositionOpened: function (s, opts = {}, callback = function () { }) {
		//var opts = {
		//	position_id: position_id,
		//	position: position,
		//};

		let strat_name = this.name
		let strat = s.options.strategy[strat_name]

		opts.position.strategy_parameters[strat_name] = {
			trailing_stop_limit: null,
			trailing_stop: null,
		}

		_onPositionOpened(callback)

		///////////////////////////////////////////
		// _onPositionOpened
		///////////////////////////////////////////

		function _onPositionOpened(cb) {
			//User defined
			
			cb(null, null)
		}
	},

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
	// 	//	var opts = {
	// 	//		position_id: position_id,
	// 	//		position: position
	// 	//	};

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

//	deactivate: function(s, opts = {}, callback = function() {}) {
//		let strat_name = this.name
//		let strat = s.options.strategy[strat_name]
//		
//		_deactivate(callback)
//		
//		///////////////////////////////////////////
//		// _deactivate
//		///////////////////////////////////////////
//		
//		function _deactivate(cb) {
//			//User defined
//			
//			cb(null, null)
//		}
//	},
	
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
