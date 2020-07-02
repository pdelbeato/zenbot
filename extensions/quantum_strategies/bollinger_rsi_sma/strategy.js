var n = require('numbro')
, tb = require('timebucket')
, ta_rsi = require('../../../lib/ta_rsi')
, ta_bollinger = require('../../../lib/ta_bollinger')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector({maxLength: 4096 })
, { formatPercent } = require('../../../lib/format')
, debug = require('../../../lib/debug')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy[bollinger_rsi_sma] = {
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate Bollinger Bands every period_calc time
//		size: 20,					//****** Size of period_calc for bollinger
//		time: 2,					//****** times of standard deviation between the upper/lower band and the moving averages
//		rsi_size: 15,				//****** Size of period_calc for rsi
//		min_bandwidth_pct: 0.50,	//****** minimum pct bandwidth to emit a signal
//		upper_bound_pct: 0,			//****** pct the current price should be near the bollinger upper bound before we sell
//		lower_bound_pct: 0,			//****** pct the current price should be near the bollinger lower bound before we buy
//		pump_watchdog: false,		//****** Pump Watchdog switch
//		dump_watchdog: false,		//****** Dump Watchdog switch
//		upper_watchdog_pct: 200,	//****** pct the current price should be over the bollinger upper bound to activate watchdog
//		lower_watchdog_pct: 200,	//****** pct the current price should be under the bollinger lower bound to activate watchdog
//		calmdown_watchdog_pct: 0,	//****** pct the current price should be in the bollinger bands to calmdown the watchdog
//		rsi_buy_threshold: 30,		//****** minimum rsi to buy
//		rsi_sell_threshold: 100,	//****** maximum rsi to sell
//		sell_min_pct: 5,			//****** avoid selling at a profit below this pct (for long positions)
//		buy_min_pct: 5,				//****** avoid buying at a profit below this pct (for short positions)
//		no_same_price: true,		//****** Avoid to open a position with an open price not below delta_pct from the minimum open price
//		delta_pct: 1,				//****** Delta % from minimum open price
//		over_and_back: false,		//****** Emit signal when price comes back inside the band
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
	name: 'bollinger_rsi_sma',
	description: 'Buy when [(Price ≤ Lower Bollinger Band) && (rsi > rsi_buy_threshold)] and sell when touching sma after [(Price ≥ Upper Bollinger Band) && (rsi < rsi_sell_threshold)].',
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

		strat.data = {							//****** To store calculated data
			bollinger: {
				upperBound: null,
				midBound: null,
				lowerBound: null,
			},
			rsi: null,
			watchdog: {
				pump: false,
				dump: false,
				calmdown: false,
			},
			is_over: {
				up: false,
				down: false,
			},
			max_profit_position: {		//****** Positions with max profit
				buy: null,
				sell: null,
			},
			limit_open_price: {			//****** Limit open price
				buy: 1000000,
				sell: 0,
			},
		}

		 s.positions.forEach(function (position, index) {
		 	if (!position.strategy_parameters[strat_name]) {
		 		position.strategy_parameters[strat_name] = {
		 			to_be_closed = false
		 		}
		 	}
		 })

		strat.lib.onPositionClosed(s, callback)
	},

	getOptions: function (strategy_name) {
		this.option(strategy_name, 'period_calc', 'calculate Bollinger Bands every period_calc time', String, '15m')
		this.option(strategy_name, 'size', 'period size', Number, 20)
		this.option(strategy_name, 'time', 'times of standard deviation between the upper/lower band and the moving averages', Number, 1.5)
		this.option(strategy_name, 'rsi_size', 'period size rsi', Number, 15)
		this.option(strategy_name, 'min_bandwidth_pct', 'minimum pct bandwidth to emit a signal', Number, null)
		this.option(strategy_name, 'upper_bound_pct', 'pct the current price should be near the bollinger upper bound before we sell', Number, 0)
		this.option(strategy_name, 'lower_bound_pct', 'pct the current price should be near the bollinger lower bound before we buy', Number, 0)
		this.option(strategy_name, 'pump_watchdog', 'Pump Watchdog switch', Boolean, false)
		this.option(strategy_name, 'dump_watchdog', 'Dump Watchdog switch', Boolean, false)
		this.option(strategy_name, 'upper_watchdog_pct', 'pct the current price should be over the bollinger upper bound to activate watchdog', Number, 50)
		this.option(strategy_name, 'lower_watchdog_pct', 'pct the current price should be under the bollinger lower bound to activate watchdog', Number, 50)
		this.option(strategy_name, 'calmdown_watchdog_pct', 'pct the current price should be in the bollinger bands to calmdown the watchdog', Number, 50)
		this.option(strategy_name, 'rsi_buy_threshold', 'minimum rsi to buy', Number, 30)
		this.option(strategy_name, 'rsi_sell_threshold', 'maximum rsi to sell', Number, 70)
		this.option(strategy_name, 'sell_min_pct', 'avoid selling at a profit below this pct (for long positions)', Number, 1)
		this.option(strategy_name, 'buy_min_pct', 'avoid buying at a profit below this pct (for short positions)', Number, 1)
		this.option(strategy_name, 'no_same_price', 'Avoid to open a position with an open price not below delta_pct from the minimum open price', Boolean, true)
		this.option(strategy_name, 'delta_pct', 'Delta % from minimum open price', Number, 1)
		this.option(strategy_name, 'over_and_back', 'Emit signal when price comes back inside the band', Boolean, false)
	},

	getCommands: function (s, strategy_name) {
		let strat = s.options.strategy[strategy_name]

		this.command('o', {desc: ('Bollinger - List options'.grey), action: function() {
			s.tools.listStrategyOptions(strategy_name, false)
		}})
		this.command('i', {desc: 'Bollinger - Toggle No same price'.grey, action: function() {
			strat.opts.no_same_price = !strat.opts.no_same_price
			console.log('\nToggle No same price: ' + (strat.opts.no_same_price ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('I', {desc: 'Bollinger - Toggle Over&Back'.grey, action: function() {
			strat.opts.over_and_back = !strat.opts.over_and_back
			console.log('\nToggle Over&Back: ' + (strat.opts.over_and_back ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('k', {desc: 'Bollinger - Toggle Dump Watchdog'.grey, action: function() {
			strat.opts.dump_watchdog = !strat.opts.dump_watchdog
			strat.data.watchdog.dump = strat.opts.dump_watchdog
			console.log('\nToggle Dump Watchdog: ' + (strat.opts.dump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('K', {desc: 'Bollinger - Toggle Pump Watchdog'.grey, action: function() {
			strat.opts.pump_watchdog = !strat.opts.pump_watchdog
			strat.data.watchdog.pump = strat.opts.pump_watchdog
			console.log('\nToggle Pump Watchdog: ' + (strat.opts.pump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('u', {desc: ('Bollinger - Avoid selling at a profit below this pct (for long positions)'.grey + ' INCREASE'.green), action: function() {
			strat.opts.sell_min_pct = Number((strat.opts.sell_min_pct + 0.05).toFixed(2))
			console.log('\n' + 'Bollinger - Sell min pct' + ' INCREASE'.green + ' -> ' + strat.opts.sell_min_pct)
		}})
		this.command('j', {desc: ('Bollinger - Avoid selling at a profit below this pct (for long positions)'.grey + ' DECREASE'.red), action: function() {
			strat.opts.sell_min_pct = Number((strat.opts.sell_min_pct - 0.05).toFixed(2))
			if (strat.opts.sell_min_pct <= 0) {
				strat.opts.sell_min_pct = 0
			}
			console.log('\n' + 'Bollinger - Sell min pct' + ' DECREASE'.red + ' -> ' + strat.opts.sell_min_pct)
		}})
		this.command('y', {desc: ('Bollinger - Avoid buying at a profit below this pct (for short positions)'.grey + ' INCREASE'.green), action: function() {
			strat.opts.buy_min_pct = Number((strat.opts.buy_min_pct + 0.05).toFixed(2))
			console.log('\n' + 'Bollinger- Buy min pct' + ' INCREASE'.green + ' -> ' + strat.opts.buy_min_pct)
		}})
		this.command('h', {desc: ('Bollinger - Avoid buying at a profit below this pct (for short positions)'.grey + ' DECREASE'.red), action: function() {
			strat.opts.buy_min_pct = Number((strat.opts.buy_min_pct - 0.05).toFixed(2))
			if (strat.opts.buy_min_pct <= 0) {
				strat.opts.buy_min_pct = 0
			}
			console.log('\n' + 'Bollinger - Buy min pct' + ' DECREASE'.red + ' -> ' + strat.opts.buy_min_pct)
		}})
		this.command('t', {desc: ('Bollinger - No same price delta %'.grey + ' INCREASE'.green), action: function() {
			strat.opts.delta_pct = Number((strat.opts.delta_pct + 0.05).toFixed(2))
			console.log('\n' + 'Bollinger- No same price delta %' + ' INCREASE'.green + ' -> ' + strat.opts.delta_pct)
		}})
		this.command('g', {desc: ('Bollinger - No same price delta %'.grey + ' DECREASE'.red), action: function() {
			strat.opts.delta_pct = Number((strat.opts.delta_pct - 0.05).toFixed(2))
			if (strat.opts.delta_pct <= 0) {
				strat.opts.delta_pct = 0
			}
			console.log('\n' + 'Bollinger - No same price delta %' + ' DECREASE'.red + ' -> ' + strat.opts.delta_pct)
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
			if (!s.in_preroll) {
				let max_profit = -100

				strat.data.max_profit_position = {
					buy: null,
					sell: null,
				}

				s.positions.forEach(function (position, index) {
					//Aggiorno le posizioni con massimo profitto, tranne che per le posizioni locked
					let position_locking = (position.locked & ~s.strategyFlag[strat_name])
					if (!position_locking && position.profit_net_pct >= max_profit) {
						max_profit = position.profit_net_pct
						strat.data.max_profit_position[position.side] = position
						//					debug.msg('Bollinger - onTradePeriod - position_max_profit_index= ' + index, false)
					}
					
					//Verifico se la posizione è da chiudere
					if (position.strategy_parameters[strat_name].to_be_closed) {
						//s.eventBus.on(strat_name, side, 			position_tmp_id						  , fixedSize, fixdPrice, protectionFree, locking, reorder, maker_taker)
						s.eventBus.emit(strat_name, side, strat.data.max_profit_position[opposite_side].id)
					}
				})

				if (strat.data.bollinger && strat.data.bollinger.midBound) {
					let upperBound = strat.data.bollinger.upperBound
					let lowerBound = strat.data.bollinger.lowerBound
					let midBound = strat.data.bollinger.midBound
					let upperBandwidth = (strat.data.bollinger.upperBound - strat.data.bollinger.midBound)
					let lowerBandwidth = (strat.data.bollinger.midBound - strat.data.bollinger.lowerBound)
					let bandwidth_pct = (upperBound - lowerBound) / midBound * 100
					let min_bandwidth_pct = strat.opts.min_bandwidth_pct
					let upperWatchdogBound = upperBound + (upperBandwidth * strat.opts.upper_watchdog_pct / 100)
					let lowerWatchdogBound = lowerBound - (lowerBandwidth * strat.opts.lower_watchdog_pct / 100)
					let upperCalmdownWatchdogBound = upperBound - (upperBandwidth * strat.opts.calmdown_watchdog_pct / 100)
					let lowerCalmdownWatchdogBound = lowerBound + (lowerBandwidth * strat.opts.calmdown_watchdog_pct / 100)

					//Controllo la minimum_bandwidth
					if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
						//					console.log('bollinger strategy - min_bandwidth_pct= ' + min_bandwidth_pct + ' ; bandwidth_pct= ' + bandwidth_pct)
						upperBound = midBound * (1 + (min_bandwidth_pct / 100) / 2)
						lowerBound = midBound * (1 - (min_bandwidth_pct / 100) / 2)
						//					console.log('bollinger strategy - nuovi limiti. upperBound ' + upperBound + ' ; lowerBound= ' + lowerBound)
					}

					strat.data.watchdog.pump = false
					strat.data.watchdog.dump = false

					//Se sono attive le opzioni watchdog, controllo se dobbiamo attivare il watchdog
					if (strat.opts.pump_watchdog && strat.period.close > upperWatchdogBound) {
						s.signal = 'Pump Bollinger';
						strat.data.watchdog.pump = true
						strat.data.watchdog.dump = false
						strat.data.watchdog.calmdown = true
					}
					else if (strat.opts.dump_watchdog && strat.period.close < lowerWatchdogBound) {
						s.signal = 'Dump Bollinger';
						strat.data.watchdog.pump = false
						strat.data.watchdog.dump = true
						strat.data.watchdog.calmdown = true
					}
					//Non siamo in watchdog, controlliamo se il calmdown è passato
					else if (strat.data.watchdog.calmdown) {
						if (s.period.close > lowerCalmdownWatchdogBound && strat.period.close < upperCalmdownWatchdogBound) {
							strat.data.watchdog.calmdown = false
						}
						else {
							s.signal = 'Boll Calm';
						}
					}

					//Utilizzo la normale strategia
					if (!strat.data.watchdog.pump && !strat.data.watchdog.dump && !strat.data.watchdog.calmdown) {
						var condition = {
							buy: [
								(s.period.close < (lowerBound + (lowerBandwidth * strat.opts.lower_bound_pct / 100))),
								(strat.data.rsi > strat.opts.rsi_buy_threshold),
								(strat.opts.no_same_price ? ((s.period.close < (strat.data.limit_open_price.buy * (1 - strat.opts.delta_pct / 100))) ? true : false) : true),
							],
							sell: [
								(s.period.close > (upperBound - (upperBandwidth * strat.opts.upper_bound_pct / 100))),
								(strat.data.rsi < strat.opts.rsi_sell_threshold),
								(strat.opts.no_same_price ? ((s.period.close > (strat.data.limit_open_price.sell * (1 + strat.opts.delta_pct / 100))) ? true : false) : true),
							]
						}

						if (condition.sell[0]) {
							if (strat.opts.over_and_back) {
								strat.data.is_over.up = true;
								return cb(null, null)
							}
							else {
								return controlConditions('sell', cb)
							}
						}
						else if (strat.data.is_over.up) {
							strat.data.is_over.up = false
							return controlConditions('sell', cb)
						}
						else if (condition.buy[0]) {
							if (strat.opts.over_and_back) {
								strat.data.is_over.down = true;
								return cb(null, null)
							}
							else {
								return controlConditions('buy', cb)
							}
						}
						else if (strat.data.is_over.down) {
							strat.data.is_over.down = false
							return controlConditions('buy', cb)
						}
						return cb(null, null)
					}
					else {
						return cb(null, null)
					}
				}
				else {
					return cb(null, null)
				}

				function controlConditions(side, cb_cc) {
					var opposite_side = (side === 'buy' ? 'sell' : 'buy')
					var min_pct = {
						buy: strat.opts.buy_min_pct,
						sell: strat.opts.sell_min_pct,
					}

					if (condition[side][1]) {
						s.signal = side[0].toUpperCase() + ' Boll.';

						// if (!s.in_preroll) {
						if (strat.data.max_profit_position[opposite_side] && strat.data.max_profit_position[opposite_side].profit_net_pct >= min_pct[side]) {
							strat.data.max_profit_position[opposite_side].strategy_parameters[strat_name].to_be_closed = true
						}
						else if (condition[side][2]) {
							s.eventBus.emit(strat_name, side)
						}
						else {
							debug.msg('Strategy Bollinger - No same price protection: strat.period.close= ' + strat.period.close + '; limit_open_price ' + strat.data.limit_open_price[side] + '; delta limit_open_price ' + (strat.data.limit_open_price[side] * strat.opts.delta_pct / 100))
						}
						// }
					}

					cb_cc(null, null)
				}
			}
			else {
				return cb(null, null)
			}
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
			let promise_bollinger = ta_bollinger(s, 'close', strat_name, strat.opts.size, strat.opts.time, strat.opts.time)
			let promise_rsi = ta_rsi(s, 'close', strat_name, strat.opts.rsi_size)

			Promise.all([promise_bollinger, promise_rsi])
				.then(function (result) {
					cb(null, result)
				})
				.catch(function (err) {
					cb(err, null)
				})
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
			if (strat.data.bollinger.upperBound && strat.data.bollinger.lowerBound) {
				let upperBound = strat.data.bollinger.upperBound
				let lowerBound = strat.data.bollinger.lowerBound
				let midBound = strat.data.bollinger.midBound
				let upperBandwidth = (strat.data.bollinger.upperBound - strat.data.bollinger.midBound)
				let lowerBandwidth = (strat.data.bollinger.midBound - strat.data.bollinger.lowerBound)
				let bandwidth_pct = (upperBound - lowerBound) / midBound * 100
				let min_bandwidth_pct = strat.opts.min_bandwidth_pct
				// let upperWatchdogBound = strat.data.bollinger.upperBound + (upperBandwidth * strat.opts.upper_watchdog_pct / 100)
				// let lowerWatchdogBound = strat.data.bollinger.lowerBound - (lowerBandwidth * strat.opts.lower_watchdog_pct / 100)

				var color_up = 'cyan';
				var color_down = 'cyan';
				var color_rsi = 'cyan';

				//Se il prezzo supera un limite del canale, allora il colore del limite è bianco
				if (s.period.close > (upperBound - (upperBandwidth * strat.opts.upper_bound_pct / 100))) {
					color_up = 'white'
				}
				else if (s.period.close < (lowerBound + (lowerBandwidth * strat.opts.lower_bound_pct / 100))) {
					color_down = 'white'
				}

				//Ma se siamo in dump/pump, allora il colore del limite è rosso
				if (strat.data.watchdog.pump) {
					color_up = 'red'
				}
				if (strat.data.watchdog.dump) {
					color_down = 'red'
				}

				//Se siamo oversold, il colore di rsi è rosso.
				//Se siamo in overbought il colore di rsi è verde
				if (strat.data.rsi < strat.opts.rsi_buy_threshold) {
					color_rsi = 'red'
				}
				if (strat.data.rsi > strat.opts.rsi_sell_threshold) {
					color_rsi = 'green'
				}

				//Controllo la minimum_bandwidth
				if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
					cols.push('*')
				}
				else {
					cols.push(' ')
				}

				cols.push(s.tools.zeroFill(9, n(lowerBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0, 9), ' ')[color_down])
				cols.push('<->'.grey)
				cols.push(s.tools.zeroFill(9, n(upperBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0, 9), ' ')[color_up])
				cols.push('(' + s.tools.zeroFill(2, n(strat.data.rsi).format('0'), ' ')[color_rsi] + ')')
			}
			else {
				cols.push(s.tools.zeroFill(26, '', ' '))
			}

			if (!s.in_preroll && (strat.data.max_profit_position.buy != null || strat.data.max_profit_position.sell != null)) {
				let position_buy_profit = -1
				let position_sell_profit = -1

				if (strat.data.max_profit_position.buy != null) {
					position_buy_profit = strat.data.max_profit_position.buy.profit_net_pct/100
				}

				if (strat.data.max_profit_position.sell != null) {
					position_sell_profit = strat.data.max_profit_position.sell.profit_net_pct/100
				}

				buysell = (position_buy_profit > position_sell_profit ? 'B' : 'S')
				buysell_profit = (position_buy_profit > position_sell_profit ? formatPercent(position_buy_profit) : formatPercent(position_sell_profit))

				cols.push(s.tools.zeroFill(8, buysell + buysell_profit, ' ')[n(buysell_profit) > 0 ? 'green' : 'red'])
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
			let side_max_profit = null
			let pct_max_profit = null
			let result = null
			
			if (strat.data.max_profit_position.buy != null || strat.data.max_profit_position.sell != null) {
				side_max_profit =  ((strat.data.max_profit_position.buy ? strat.data.max_profit_position.buy.profit_net_pct : -100) > (strat.data.max_profit_position.sell ? strat.data.max_profit_position.sell.profit_net_pct : -100) ? 'buy' : 'sell')
				pct_max_profit = strat.data.max_profit_position[side_max_profit].profit_net_pct
				result = ('Bollinger position: ' + side_max_profit[0].toUpperCase() + formatPercent(pct_max_profit/100))
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

		// opts.position.strategy_parameters[strat_name] = {}

		_onPositionOpened(callback)

		///////////////////////////////////////////
		// _onPositionOpened
		///////////////////////////////////////////

		function _onPositionOpened(cb) {
			strat.lib.onPositionClosed(s, opts, cb)
		}
	},

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
			if (strat.opts.no_same_price) {
				strat.data.limit_open_price.buy = 1000000
				strat.data.limit_open_price.sell = 0

				s.positions.forEach(function (position, index, array) {
					// if (position.id === opts.position_id) {
					// 	return cb(null, null)
					// }

					if (position.side === 'buy') {
						strat.data.limit_open_price.buy = Math.min(Number(position.price_open), strat.data.limit_open_price.buy)
					}
					else {
						strat.data.limit_open_price.sell = Math.max(Number(position.price_open), strat.data.limit_open_price.sell)
					}
				})
			}
	
			cb(null, null)
		}
	},

	// onOrderExecuted: function (s, opts = {}, callback = function () { }) {
	// 	// let strat_name = this.name
	// 	// let strat = s.options.strategy[strat_name]

	// 	_onOrderExecuted(callback)
		
	// 	///////////////////////////////////////////
	// 	// _onOrderExecuted
	// 	///////////////////////////////////////////
		
	// 	function _onOrderExecuted(cb) {
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
