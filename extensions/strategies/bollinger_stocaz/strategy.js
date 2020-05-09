var n = require('numbro')
, bollinger = require('../../../lib/bollinger')
, rsi = require('../../../lib/rsi')
, ti_rsi = require('../../../lib/ti_rsi')
, ta_stoch = require('../../../lib/ta_stoch')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector({maxLength: 4096 })
, crypto = require('crypto')
, { formatPercent } = require('../../../lib/format')
, debug = require('../../../lib/debug')
//, z = require('zero-fill')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['bollinger_stocaz'] = {
//	name: 'bollinger_stocaz',
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate Bollinger Bands every period_calc time
//		min_periods: 21, 			//****** Minimum number of calc_lookback to maintain (timeframe is "period_calc")
//		size: 20,					//****** period size
//		time: 2,					//****** times of standard deviation between the upper/lower band and the moving averages
//		min_bandwidth_pct: 0.50,	//****** minimum pct bandwidth to emit a signal
//		upper_bound_pct: 0,			//****** pct the current price should be near the bollinger upper bound before we sell
//		lower_bound_pct: 0,			//****** pct the current price should be near the bollinger lower bound before we buy
//		pump_watchdog: false,		//****** Pump Watchdog switch
//		dump_watchdog: false,		//****** Dump Watchdog switch
//		upper_watchdog_pct: 200,	//****** pct the current price should be over the bollinger upper bound to activate watchdog
//		lower_watchdog_pct: 200,	//****** pct the current price should be under the bollinger lower bound to activate watchdog
//		calmdown_watchdog_pct: 0,	//****** pct the current price should be in the bollinger bands to calmdown the watchdog
//		sell_min_pct: 5,			//****** avoid selling at a profit below this pct (for long positions)
//		buy_min_pct: 5,				//****** avoid buying at a profit below this pct (for short positions)
//		no_same_price: true,		//****** Avoid to open a position with an open price not below delta_pct from the minimum open price
//		delta_pct: 1,				//****** Delta % from minimum open price
//		over_and_back: false,		//****** Emit signal when price comes back inside the band
//		stoch_periods:14,			//******* Time period for building the Fast-K line
//		stoch_k: 3,					//******* Smoothing for making the Slow-K line. Usually set to 3
//		stoch_k_ma_type: 'SMA',		//******* Type of Moving Average for Slow-K : SMA,EMA,WMA,DEMA,TEMA,TRIMA,KAMA,MAMA,T3
//		stoch_k_sell_threshold: 70,	//******* K must be above this before selling
//		stoch_k_buy_threshold: 30,	//******* K must be below this before buying
//	},
//	data: {							//****** To store calculated data
//		bollinger: {
//			upperBound: null,
//			midBound: null,
//			lowerBound: null,
//		},
//		stoch: {
//			stoch_K: null,
//		},
//		watchdog: {
//			pump: false,
//			dump: false,
//			calmdown: false,
//		},
//		is_over: {
//			up: false,
//			down: false,
//		},
//		is_over_stoch: {
//			buy: false,
//			sell: false,
//		},
//		will_trade: {
//			buy: false,
//			sell: false,
//		},
//		max_profit_position: {		//****** Positions with max profit
//			buy: null,
//			sell: null,
//		},
//		limit_open_price: {			//****** Limit open price
//			buy: 1000000,
//			sell: 0,
//		},
//	},
//	calc_lookback: [],				//****** Old periods for calculation
//	calc_close_time: 0,				//****** Close time for strategy period
//	lib: {}							//****** To store all the functions of the strategy
//}
//---------------------------------------------


//position.strategy_parameters.bollinger: {
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
	name: 'bollinger_stocaz',
	description: 'Buy when [(Price ≤ Lower Bollinger Band) && (rsi > rsi_buy_threshold)] and sell when [(Price ≥ Upper Bollinger Band) && (rsi < rsi_sell_threshold)].',
	noHoldCheck: false,

	init: function (s) {
		this.onPositionClosed(s)
	},

	getOptions: function () {
		this.option('bollinger_stocaz', 'period_calc', 'calculate Bollinger Bands every period_calc time', String, '15m')
		this.option('bollinger_stocaz', 'min_periods', 'Min. number of history periods', Number, 301)
		this.option('bollinger_stocaz', 'size', 'period size', Number, 20)
		this.option('bollinger_stocaz', 'time', 'times of standard deviation between the upper/lower band and the moving averages', Number, 1.5)
		this.option('bollinger_stocaz', 'rsi_size', 'period size rsi', Number, 15)
		this.option('bollinger_stocaz', 'min_bandwidth_pct', 'minimum pct bandwidth to emit a signal', Number, null)
		this.option('bollinger_stocaz', 'upper_bound_pct', 'pct the current price should be near the bollinger upper bound before we sell', Number, 0)
		this.option('bollinger_stocaz', 'lower_bound_pct', 'pct the current price should be near the bollinger lower bound before we buy', Number, 0)
		this.option('bollinger_stocaz', 'pump_watchdog', 'Pump Watchdog switch', Boolean, false)
		this.option('bollinger_stocaz', 'dump_watchdog', 'Dump Watchdog switch', Boolean, false)
		this.option('bollinger_stocaz', 'upper_watchdog_pct', 'pct the current price should be over the bollinger upper bound to activate watchdog', Number, 50)
		this.option('bollinger_stocaz', 'lower_watchdog_pct', 'pct the current price should be under the bollinger lower bound to activate watchdog', Number, 50)
		this.option('bollinger_stocaz', 'calmdown_watchdog_pct', 'pct the current price should be in the bollinger bands to calmdown the watchdog', Number, 50)
		this.option('bollinger_stocaz', 'sell_min_pct', 'avoid selling at a profit below this pct (for long positions)', Number, 1)
		this.option('bollinger_stocaz', 'buy_min_pct', 'avoid buying at a profit below this pct (for short positions)', Number, 1)
		this.option('bollinger_stocaz', 'no_same_price', 'Avoid to open a position with an open price not below delta_pct from the minimum open price', Boolean, true)
		this.option('bollinger_stocaz', 'delta_pct', 'Delta % from minimum open price', Number, 1)
		this.option('bollinger_stocaz', 'over_and_back', 'Emit signal when price comes back inside the band', Boolean, false)
		this.option('bollinger_stocaz', 'over_and_back_stoch', 'Emit signal when price comes back inside the Stochastic band', Boolean, false)
		this.option('bollinger_stocaz', 'stoch_periods', 'Time period for building the Fast-K line', Number, 14)
		this.option('bollinger_stocaz', 'stoch_k', 'Smoothing for making the Slow-K line. Usually set to 3', Number, 3)
		this.option('bollinger_stocaz', 'stoch_k_ma_type','Type of Moving Average for Slow-K : SMA,EMA,WMA,DEMA,TEMA,TRIMA,KAMA,MAMA,T3', String, 'SMA'),
		this.option('bollinger_stocaz', 'stoch_k_sell_threshold', 'K must be above this before selling', Number, 70)
		this.option('bollinger_stocaz', 'stoch_k_buy_threshold', 'K must be below this before buying', Number, 30)
	},

	getCommands: function (s, opts = {}, cb = function() {}) {
		let strat_opts = s.options.strategy.bollinger_stocaz.opts
		let strat_data = s.options.strategy.bollinger_stocaz.data

		this.command('o', {desc: ('Bollinger - List options'.grey), action: function() {
			s.tools.listStrategyOptions('bollinger_stocaz', false)
		}})
		this.command('i', {desc: 'Bollinger - Toggle No same price'.grey, action: function() {
			strat_opts.no_same_price = !strat_opts.no_same_price
			console.log('\nToggle No same price: ' + (strat_opts.no_same_price ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('I', {desc: 'Bollinger - Toggle Over&Back'.grey, action: function() {
			strat_opts.over_and_back = !strat_opts.over_and_back
			console.log('\nToggle Over&Back: ' + (strat_opts.over_and_back ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('k', {desc: 'Bollinger - Toggle Dump Watchdog'.grey, action: function() {
			strat_opts.dump_watchdog = !strat_opts.dump_watchdog
			strat_data.watchdog.dump = strat_opts.dump_watchdog
			console.log('\nToggle Dump Watchdog: ' + (strat_opts.dump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('K', {desc: 'Bollinger - Toggle Pump Watchdog'.grey, action: function() {
			strat_opts.pump_watchdog = !strat_opts.pump_watchdog
			strat_data.watchdog.pump = strat_opts.pump_watchdog
			console.log('\nToggle Pump Watchdog: ' + (strat_opts.pump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('u', {desc: ('Bollinger - Avoid selling at a profit below this pct (for long positions)'.grey + ' INCREASE'.green), action: function() {
			strat_opts.sell_min_pct = Number((strat_opts.sell_min_pct + 0.05).toFixed(2))
			console.log('\n' + 'Bollinger - Sell min pct' + ' INCREASE'.green + ' -> ' + strat_opts.sell_min_pct)
		}})
		this.command('j', {desc: ('Bollinger - Avoid selling at a profit below this pct (for long positions)'.grey + ' DECREASE'.red), action: function() {
			strat_opts.sell_min_pct = Number((strat_opts.sell_min_pct - 0.05).toFixed(2))
			if (strat_opts.sell_min_pct <= 0) {
				strat_opts.sell_min_pct = 0
			}
			console.log('\n' + 'Bollinger - Sell min pct' + ' DECREASE'.red + ' -> ' + strat_opts.sell_min_pct)
		}})
		this.command('y', {desc: ('Bollinger - Avoid buying at a profit below this pct (for short positions)'.grey + ' INCREASE'.green), action: function() {
			strat_opts.buy_min_pct = Number((strat_opts.buy_min_pct + 0.05).toFixed(2))
			console.log('\n' + 'Bollinger- Buy min pct' + ' INCREASE'.green + ' -> ' + strat_opts.buy_min_pct)
		}})
		this.command('h', {desc: ('Bollinger - Avoid buying at a profit below this pct (for short positions)'.grey + ' DECREASE'.red), action: function() {
			strat_opts.buy_min_pct = Number((strat_opts.buy_min_pct - 0.05).toFixed(2))
			if (strat_opts.buy_min_pct <= 0) {
				strat_opts.buy_min_pct = 0
			}
			console.log('\n' + 'Bollinger - Buy min pct' + ' DECREASE'.red + ' -> ' + strat_opts.buy_min_pct)
		}})
		this.command('t', {desc: ('Bollinger - No same price delta %'.grey + ' INCREASE'.green), action: function() {
			strat_opts.delta_pct = Number((strat_opts.delta_pct + 0.05).toFixed(2))
			console.log('\n' + 'Bollinger- No same price delta %' + ' INCREASE'.green + ' -> ' + strat_opts.delta_pct)
		}})
		this.command('g', {desc: ('Bollinger - No same price delta %'.grey + ' DECREASE'.red), action: function() {
			strat_opts.delta_pct = Number((strat_opts.delta_pct - 0.05).toFixed(2))
			if (strat_opts.delta_pct <= 0) {
				strat_opts.delta_pct = 0
			}
			console.log('\n' + 'Bollinger - No same price delta %' + ' DECREASE'.red + ' -> ' + strat_opts.delta_pct)
		}})

		cb()
	},

	onTrade: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.bollinger_stocaz.opts
		let strat_data = s.options.strategy.bollinger_stocaz.data
//		if (opts.trade) {
//		}
		//Fa schifo!!! Da modificare quando mi viene in mente come fare per far fare init dopo aver recuperato i vecchi db
//		if (s.options.strategy.bollinger_stocaz.data.limit_open_price.buy == 1000000 && s.options.strategy.bollinger_stocaz.data.limit_open_price.sell == 0) {
//		this.onPositionClosed(s)
//		}
		cb()
	},

	onTradePeriod: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	onStrategyPeriod: function (s, opts= {}, cb = function() {}) {
		let strat_data = s.options.strategy.bollinger_stocaz.data
		let strat_opts = s.options.strategy.bollinger_stocaz.opts
		let strat_data_boll = s.options.strategy.bollinger_stocaz.data.bollinger
		let strat_data_lookback = s.options.strategy.bollinger_stocaz.calc_lookback
		let max_profit = -100

		strat_data.bollinger = bollinger(s, 'bollinger_stocaz', s.options.strategy.bollinger_stocaz.opts.size, 'close')

		ta_stoch(s, 'stoch',  s.options.strategy.bollinger_stocaz.opts.stoch_periods, s.options.strategy.bollinger_stocaz.opts.stoch_k, s.options.strategy.bollinger_stocaz.opts.stoch_k_ma_type, undefined, undefined, strat_data_lookback)
		.then(function(inres) {
			if (!inres) {
				return cb()
			}
			strat_data.stoch.stoch_K = inres.k[inres.k.length-1];

			//Aggiorno le posizioni con massimo profitto, tranne che per le posizioni locked
			strat_data.max_profit_position = {
					buy: null,
					sell: null,
			}

			s.positions.forEach(function (position, index) {
				position_locking = (position.locked & ~s.strategyFlag['bollinger_stocaz'])
				if (!position_locking && position.profit_net_pct >= max_profit) {
					max_profit = position.profit_net_pct
					strat_data.max_profit_position[position.side] = position
				}
			})

			//Controllo se sono fuori dalle bande
			if (strat_data_boll && strat_data_boll.midBound) {
				let upperBound = strat_data_boll.upperBound
				let lowerBound = strat_data_boll.lowerBound
				let midBound = strat_data_boll.midBound
				let upperBandwidth = (strat_data_boll.upperBound - strat_data_boll.midBound)
				let lowerBandwidth = (strat_data_boll.midBound - strat_data_boll.lowerBound)
				let bandwidth_pct = (upperBound - lowerBound) / midBound * 100
				let min_bandwidth_pct = strat_opts.min_bandwidth_pct
				let upperWatchdogBound = upperBound + (upperBandwidth * strat_opts.upper_watchdog_pct/100)
				let lowerWatchdogBound = lowerBound - (lowerBandwidth * strat_opts.lower_watchdog_pct/100)
				let upperCalmdownWatchdogBound = upperBound - (upperBandwidth * strat_opts.calmdown_watchdog_pct/100)
				let lowerCalmdownWatchdogBound = lowerBound + (lowerBandwidth * strat_opts.calmdown_watchdog_pct/100)

				//Controllo la minimum_bandwidth
				if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
//					console.log('bollinger strategy - min_bandwidth_pct= ' + min_bandwidth_pct + ' ; bandwidth_pct= ' + bandwidth_pct)
					upperBound = midBound * (1 + (min_bandwidth_pct/100)/2)
					lowerBound = midBound * (1 - (min_bandwidth_pct/100)/2)
//					console.log('bollinger strategy - nuovi limiti. upperBound ' + upperBound + ' ; lowerBound= ' + lowerBound)
				}

				strat_data.watchdog.pump = false
				strat_data.watchdog.dump = false

				//Se sono attive le opzioni watchdog, controllo se dobbiamo attivare il watchdog
				if (strat_opts.pump_watchdog && s.period.close > upperWatchdogBound) {
					s.signal = 'Pump Bollinger';
					strat_data.watchdog.pump = true
					strat_data.watchdog.dump = false
					strat_data.watchdog.calmdown = true
				}
				else if (strat_opts.dump_watchdog && s.period.close < lowerWatchdogBound) {
					s.signal = 'Dump Bollinger';
					strat_data.watchdog.pump = false
					strat_data.watchdog.dump = true
					strat_data.watchdog.calmdown = true
				}
				//Non siamo in watchdog, controlliamo se il calmdown è passato
				else if (strat_data.watchdog.calmdown) {
					if (s.period.close > lowerCalmdownWatchdogBound && s.period.close < upperCalmdownWatchdogBound) {
						strat_data.watchdog.calmdown = false
					}
					else {
						s.signal = 'Boll Calm';
					}
				}

				//Utilizzo la normale strategia
				if (!strat_data.watchdog.pump && !strat_data.watchdog.dump && !strat_data.watchdog.calmdown) {
					var condition = {
						buy: [
							(s.period.close < (lowerBound + (lowerBandwidth * strat_opts.lower_bound_pct/100))),
							(strat_data.stoch.stoch_K > strat_opts.stoch_k_buy_threshold),
							(strat_opts.no_same_price ? ((s.period.close < (strat_data.limit_open_price.buy * (1 - strat_opts.delta_pct/100))) ? true : false) : true),
						],
						sell: [
							(s.period.close > (upperBound - (upperBandwidth * strat_opts.upper_bound_pct/100))),
							(strat_data.stoch.stoch_K < strat_opts.stoch_K_sell_threshold),
							(strat_opts.no_same_price ? ((s.period.close > (strat_data.limit_open_price.sell * (1 + strat_opts.delta_pct/100))) ? true : false) : true),
						]
					};

					//Se sono dentro le soglie stocastiche e il flag "will_trade" era attivo, allora vado a verificare le altre condizioni per un trade
					if (strat_data.will_trade.buy) {
						strat_data.will_trade.buy = false;
						controlConditions('buy');
					}

					if (strat_data.will_trade.sell) {
						strat_data.will_trade.sell = false;
						controlConditions('sell');
					}

					if (condition.sell[0]) {
						if (strat_opts.over_and_back) {
							strat_data.is_over.up = true;
						}
						else {
							controlConditions('sell')
						}
					}
					else if (strat_data.is_over.up) {
						strat_data.is_over.up = false
						controlConditions('sell')
					}
					else if (condition.buy[0]) {
						if (strat_opts.over_and_back) {
							strat_data.is_over.down = true;
						}
						else {
							controlConditions('buy')
						}
					}
					else if (strat_data.is_over.down) {
						strat_data.is_over.down = false
						controlConditions('buy')
					}
				}
			}
			cb()

			function controlConditions(side) {
				var opposite_side = (side === 'buy' ? 'sell' : 'buy')
				var min_pct = {
					buy: strat_opts.buy_min_pct,
					sell: strat_opts.sell_min_pct,
				}

				if (condition[side][1]) {
					strat_data.is_over_stoch[side] = false;
					s.signal = side[0].toUpperCase() + ' Boll.';

					if (!s.in_preroll) {
						if (strat_data.max_profit_position[opposite_side] && strat_data.max_profit_position[opposite_side].profit_net_pct >= min_pct[side]) {
							s.eventBus.emit('bollinger_stocaz', side, strat_data.max_profit_position[opposite_side].id)
						}
						else if (condition[side][2]) {
							s.eventBus.emit('bollinger_stocaz', side)
						}
						else {
							debug.msg('Strategy Bollinger - No same price protection: s.period.close= ' + s.period.close + '; limit_open_price ' + strat_data.limit_open_price[side] + '; delta limit_open_price ' + (strat_data.limit_open_price[side] * strat_opts.delta_pct/100))
						}
					}
				}
				else {
					strat_data.is_over_stoch[side] = true;
					strat_data.will_trade[side] = true;
				}
			}
		}).catch(function(){
			cb()
		})
	},


	onReport: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.bollinger_stocaz.opts
		let strat_data = s.options.strategy.bollinger_stocaz.data

		var cols = []
		if (strat_data.bollinger && strat_data.stoch) {
			if (strat_data.bollinger.upperBound && strat_data.bollinger.lowerBound) {
				let upperBound = strat_data.bollinger.upperBound
				let lowerBound = strat_data.bollinger.lowerBound
				let midBound = strat_data.bollinger.midBound
				let upperBandwidth = (strat_data.bollinger.upperBound - strat_data.bollinger.midBound)
				let lowerBandwidth = (strat_data.bollinger.midBound - strat_data.bollinger.lowerBound)
				let bandwidth_pct = (upperBound - lowerBound) / midBound * 100
				let min_bandwidth_pct = strat_opts.min_bandwidth_pct
				let upperWatchdogBound = strat_data.bollinger.upperBound + (upperBandwidth * strat_opts.upper_watchdog_pct/100)
				let lowerWatchdogBound = strat_data.bollinger.lowerBound - (lowerBandwidth * strat_opts.lower_watchdog_pct/100)

				var color_up = 'cyan';
				var color_down = 'cyan';
				var color_stoch = 'cyan';

				//Se il prezzo supera un limite del canale, allora il colore del limite è bianco
				if (s.period.close > (upperBound - (upperBandwidth * strat_opts.upper_bound_pct/100))) {
					color_up = 'white'
				}
				else if (s.period.close < (lowerBound + (lowerBandwidth * strat_opts.lower_bound_pct/100))) {
					color_down = 'white'
				}

				//Ma se siamo in dump/pump, allora il colore del limite è rosso
				if (strat_data.watchdog.pump) {
					color_up = 'red'
				}
				if (strat_data.watchdog.dump) {
					color_down = 'red'
				}

				//Codice colori per i fuori soglia stochastic
				if (strat_data.stoch.stoch_K > strat_opts.stoch_k_sell_threshold || strat_data.stoch.stoch_K < strat_opts.stoch_k_buy_threshold) {
					color_stoch = 'red';
				}

				//Controllo la minimum_bandwidth
				if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
					cols.push('*')
				}
				else {
					cols.push(' ')
				}

				cols.push(s.tools.zeroFill(9, n(lowerBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0,9), ' ')[color_down])
				cols.push('<->'.grey)
				cols.push(s.tools.zeroFill(9, n(upperBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0,9), ' ')[color_up])
				cols.push('(' + s.tools.zeroFill(2, n(strat_data.stoch.stoch_K).format('0'), ' ')[color_stoch] + ')')
			}
		}
		else {
			cols.push(s.tools.zeroFill(26, '', ' '))
		}

		if (!s.in_preroll && (strat_data.max_profit_position.buy != null || strat_data.max_profit_position.sell != null)) {
			let position_buy_profit = -1
			let position_sell_profit = -1

			if (strat_data.max_profit_position.buy != null) {
				position_buy_profit = strat_data.max_profit_position.buy.profit_net_pct/100
			}

			if (strat_data.max_profit_position.sell != null) {
				position_sell_profit = strat_data.max_profit_position.sell.profit_net_pct/100
			}

			buysell = (position_buy_profit > position_sell_profit ? 'B' : 'S')
			buysell_profit = (position_buy_profit > position_sell_profit ? formatPercent(position_buy_profit) : formatPercent(position_sell_profit))

			cols.push(s.tools.zeroFill(8, buysell + buysell_profit, ' ')[n(buysell_profit) > 0 ? 'green' : 'red'])
		}
		else {
			cols.push(s.tools.zeroFill(8, '', ' '))
		}

		cols.forEach(function (col) {
			process.stdout.write(col)
		})

		cb()
	},

	onUpdateMessage: function (s, opts= {}, cb = function() {}) {
		let max_profit_position = s.options.strategy.bollinger_stocaz.data.max_profit_position
		let side_max_profit = null
		let pct_max_profit = null
		if (max_profit_position.buy != null || max_profit_position.sell != null) {
			side_max_profit =  ((max_profit_position.buy ? max_profit_position.buy.profit_net_pct : -100) > (max_profit_position.sell ? max_profit_position.sell.profit_net_pct : -100) ? 'buy' : 'sell')
			pct_max_profit = max_profit_position[side_max_profit].profit_net_pct
		}
		let result = (side_max_profit ? ('Bollinger position: ' + side_max_profit[0].toUpperCase() + formatPercent(pct_max_profit/100)) : '')
//		debug.msg('Strategy Bollinger - onUpdateMessage: ' + result)
		cb(result)
	},

	onPositionOpened: function (s, opts= {}, cb = function() {}) {
//		var opts = {
//		position_id: position_id,
//		};

		this.onPositionClosed(s, opts, cb)
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

//		debug.msg('Strategy - Bollinger - onPositionClosed')

		let strat_opts = s.options.strategy.bollinger_stocaz.opts

		if(strat_opts.no_same_price) {
			s.options.strategy.bollinger_stocaz.data.limit_open_price.buy = 1000000
			s.options.strategy.bollinger_stocaz.data.limit_open_price.sell = 0

			s.positions.forEach(function (position, index, array) {
				if (position.side === 'buy') {
					s.options.strategy.bollinger_stocaz.data.limit_open_price.buy = Math.min(position.price_open, s.options.strategy.bollinger_stocaz.data.limit_open_price.buy)
				}
				else {
					s.options.strategy.bollinger_stocaz.data.limit_open_price.sell = Math.max(position.price_open, s.options.strategy.bollinger_stocaz.data.limit_open_price.sell)
				}
			})
		}
		cb()
	},

	onOrderExecuted: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	printOptions: function(s, opts= { only_opts: false }, cb = function() {}) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.bollinger_stocaz))
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
