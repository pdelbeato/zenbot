var z = require('zero-fill')
, n = require('numbro')
, bollinger = require('../../../lib/bollinger')
, rsi = require('../../../lib/rsi')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector({maxLength: 4096 })
, crypto = require('crypto')
, { formatPercent } = require('../../../lib/format')
, debug = require('../../../lib/debug')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['bollinger'] = {
//	name: 'bollinger',
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate Bollinger Bands every period_calc time
//		min_periods: 301, 			//****** Minimum number of history periods (timeframe period_length)
//		size: 20,					//****** period size
//		time: 2,					//****** times of standard deviation between the upper/lower band and the moving averages
//		rsi_size: 15,				//****** period size rsi
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
//	},
//	data: {							//****** To store calculated data
//		bollinger: {
//			upperBound: null,
//			midBound: null,
//			lowerBound: null,
//		}
//		rsi: {
//			rsi: null,
//			rsi_avg_gain: null,
//			rsi_avg_loss: null,
//		}
//		is_pump_watchdog: false,
//		is_dump_watchdog: false,
//		is_calmdown: false,
//		max_profit_position: {		//****** Positions with max profit
//			buy: null,
//			sell: null,
//		}
//	},	
//	calc_lookback: [],				//****** Old periods for calculation
//	calc_close_time: 0				//****** Close time for strategy period
//	lib: {}							//****** To store all the functions of the strategy
//}
//---------------------------------------------
//
//
//position.strategy_parameters.bollinger: {
//}
//
//---------------------------------------------
// Cambia i colori di cliff
//styles: {                 // Styles applied to stdout
//    all:     'cyan',      // Overall style applied to everything
//    label:   'underline', // Inspection labels, like 'array' in `array: [1, 2, 3]`
//    other:   'inverted',  // Objects which don't have a literal representation, such as functions
//    key:     'bold',      // The keys in object literals, like 'a' in `{a: 1}`
//    special: 'grey',      // null, undefined...
//    string:  'green',
//    number:  'magenta',
//    bool:    'blue',      // true false
//    regexp:  'green',     // /\d+/
//},
//
//pretty: true,             // Indent object literals
//hideFunctions: false,     // Don't output functions at all
//stream: process.stdout,   // Stream to write to, or null
//maxLength: 2048           // Truncate output if longer

module.exports = {
	name: 'bollinger',
	description: 'Buy when [(Price ≤ Lower Bollinger Band) && (rsi > rsi_buy_threshold)] and sell when [(Price ≥ Upper Bollinger Band) && (rsi < rsi_sell_threshold)].',
	noHoldCheck: false,
	
	getOptions: function () {
		this.option('bollinger', 'period_calc', 'calculate Bollinger Bands every period_calc time', String, '15m')
		this.option('bollinger', 'min_periods', 'Min. number of history periods', Number, 301)
		this.option('bollinger', 'size', 'period size', Number, 20)
		this.option('bollinger', 'time', 'times of standard deviation between the upper/lower band and the moving averages', Number, 1.5)
		this.option('bollinger', 'rsi_size', 'period size rsi', Number, 15)
		this.option('bollinger', 'min_bandwidth_pct', 'minimum pct bandwidth to emit a signal', Number, null)
		this.option('bollinger', 'upper_bound_pct', 'pct the current price should be near the bollinger upper bound before we sell', Number, 0)
		this.option('bollinger', 'lower_bound_pct', 'pct the current price should be near the bollinger lower bound before we buy', Number, 0)
		this.option('bollinger', 'pump_watchdog', 'Pump Watchdog switch', Boolean, false)
		this.option('bollinger', 'dump_watchdog', 'Dump Watchdog switch', Boolean, false)
		this.option('bollinger', 'upper_watchdog_pct', 'pct the current price should be over the bollinger upper bound to activate watchdog', Number, 50)
		this.option('bollinger', 'lower_watchdog_pct', 'pct the current price should be under the bollinger lower bound to activate watchdog', Number, 50)
		this.option('bollinger', 'calmdown_watchdog_pct', 'pct the current price should be in the bollinger bands to calmdown the watchdog', Number, 50)
		this.option('bollinger', 'rsi_buy_threshold', 'minimum rsi to buy', Number, 30)
		this.option('bollinger', 'rsi_sell_threshold', 'maximum rsi to sell', Number, 70)
		this.option('bollinger', 'sell_min_pct', 'avoid selling at a profit below this pct (for long positions)', Number, 1)
		this.option('bollinger', 'buy_min_pct', 'avoid buying at a profit below this pct (for short positions)', Number, 1)
	},
	
	getCommands: function (s, opts = {}, cb = function() {}) {
		let strat_opts = s.options.strategy.bollinger.opts
		let strat_data = s.options.strategy.bollinger.data
		
		this.command('o', {desc: ('Bollinger - List options'.grey), action: function() { s.tools.listStrategyOptions('bollinger')}})
		this.command('k', {desc: 'Bollinger - Toggle Dump Watchdog'.grey, action: function() {
			strat_opts.dump_watchdog = !strat_opts.dump_watchdog
			strat_data.is_dump_watchdog = strat_opts.dump_watchdog
			console.log('\nToggle Dump Watchdog: ' + (strat_opts.dump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('K', {desc: 'Bollinger - Toggle Pump Watchdog'.grey, action: function() {
			strat_opts.pump_watchdog = !strat_opts.pump_watchdog
			strat_data.is_pump_watchdog = strat_opts.pump_watchdog
			console.log('\nToggle Pump Watchdog: ' + (strat_opts.pump_watchdog ? 'ON'.green.inverse : 'OFF'.red.inverse))
		}})
		this.command('u', {desc: ('Bollinger - Avoid selling at a profit below this pct (for long positions)'.grey + ' INCREASE'.green), action: function() {
			strat_opts.sell_min_pct = Number((strat_opts.sell_min_pct + 0.05).toFixed(2))
			console.log('\n' + 'Bollinger - Sell min pct' + ' INCREASE'.green + ' -> ' + strat_opts.sell_min_pct)
		}})
		this.command('j', {desc: ('Bollinger - Avoid selling at a profit below this pct (for long positions)'.grey + ' DECREASE'.red), action: function() {
			strat_opts.sell_min_pct = Number((strat_opts.sell_min_pct - 0.05).toFixed(2))
			console.log('\n' + 'Bollinger - Sell min pct' + ' DECREASE'.red + ' -> ' + strat_opts.sell_min_pct)
		}})
		this.command('y', {desc: ('Bollinger - Avoid buying at a profit below this pct (for short positions)'.grey + ' INCREASE'.green), action: function() {
			strat_opts.buy_min_pct = Number((strat_opts.buy_min_pct + 0.05).toFixed(2))
			console.log('\n' + 'Bollinger- Buy min pct' + ' INCREASE'.green + ' -> ' + strat_opts.buy_min_pct)
		}})
		this.command('h', {desc: ('Bollinger - Avoid buying at a profit below this pct (for short positions)'.grey + ' DECREASE'.red), action: function() {
			strat_opts.buy_min_pct = Number((strat_opts.buy_min_pct - 0.05).toFixed(2))
			console.log('\n' + 'Bollinger - Buy min pct' + ' DECREASE'.red + ' -> ' + strat_opts.buy_min_pct)
		}})
		
		cb()
	},

	onTrade: function (s, opts= {}, cb = function() {}) {
		if (opts.trade) {
		}
		cb()
	},
	
	onTradePeriod: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.bollinger.opts
		let strat_data = s.options.strategy.bollinger.data
		let strat_data_boll = s.options.strategy.bollinger.data.bollinger
		let strat_data_rsi = s.options.strategy.bollinger.data.rsi
		let max_profit = -100
		
		strat_data.max_profit_position = {
			buy: null,
			sell: null,
		}

		s.positions.forEach(function (position, index) {
			//Aggiorno le posizioni con massimo profitto, tranne che per le posizioni locked
			position_locking = (position.locked & ~s.strategyFlag['bollinger'])
			if (!position_locking && position.profit_net_pct >= max_profit) {
				max_profit = position.profit_net_pct
				strat_data.max_profit_position[position.side] = position
//				debug.msg('Bollinger - onTradePeriod - position_max_profit_index= ' + index, false)
			}						
		})

		if (strat_data_boll && strat_data_boll.midBound) {
//			if (strat_data.upperBound && strat_data.lowerBound) {
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
			let rsi = strat_data_rsi.rsi

			//Controllo la minimum_bandwidth
			if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
//				console.log('bollinger strategy - min_bandwidth_pct= ' + min_bandwidth_pct + ' ; bandwidth_pct= ' + bandwidth_pct)
				upperBound = midBound * (1 + (min_bandwidth_pct/100)/2)
				lowerBound = midBound * (1 - (min_bandwidth_pct/100)/2)
//				console.log('bollinger strategy - nuovi limiti. upperBound ' + upperBound + ' ; lowerBound= ' + lowerBound)
			}

			strat_data.is_pump_watchdog = false
			strat_data.is_dump_watchdog = false

			//Se sono attive le opzioni watchdog, controllo se dobbiamo attivare il watchdog
			if (strat_opts.pump_watchdog && s.period.close > upperWatchdogBound) {
				s.signal = 'Pump Bollinger';
				strat_data.is_pump_watchdog = true
				strat_data.is_dump_watchdog = false
				strat_data.is_calmdown = true
			}
			else if (strat_opts.dump_watchdog && s.period.close < lowerWatchdogBound) {
				s.signal = 'Dump Bollinger';
				strat_data.is_pump_watchdog = false
				strat_data.is_dump_watchdog = true
				strat_data.is_calmdown = true
			}
			//Non siamo in watchdog, controlliamo se il calmdown è passato
			else if (strat_data.is_calmdown && s.period.close > lowerCalmdownWatchdogBound && s.period.close < upperCalmdownWatchdogBound) {
				strat_data.is_calmdown = false
			}
			else {
				s.signal = 'Boll Calm';
			} 

			//Utilizzo la normale strategia
			if (!strat_data.is_pump_watchdog && !strat_data.is_dump_watchdog && !strat_data.is_calmdown) {
				let buy_condition_1 = (s.period.close < (lowerBound + (lowerBandwidth * strat_opts.lower_bound_pct/100)))
				let buy_condition_2 = (rsi > strat_opts.rsi_buy_threshold)

				let sell_condition_1 = (s.period.close > (upperBound - (upperBandwidth * strat_opts.upper_bound_pct/100)))
				let sell_condition_2 = (rsi < strat_opts.rsi_sell_threshold)

//				s.eventBus.emit(sig_kind, signal, position_id, fixed_size, fixed_price, is_reorder, is_taker)

				if (sell_condition_1 && sell_condition_2) {
					s.signal = 'S Bollinger';
					if (!s.in_preroll) {
						if (strat_data.max_profit_position.buy && strat_data.max_profit_position.buy.profit_net_pct >= strat_opts.sell_min_pct) {
							s.eventBus.emit('bollinger', 'sell', strat_data.max_profit_position.buy.id)
						}
						else {
							s.eventBus.emit('bollinger', 'sell')
						}
					}
				}
				else if (buy_condition_1 && buy_condition_2) {
					s.signal = 'B Bollinger';
					if (!s.in_preroll) {
						if (strat_data.max_profit_position.sell && strat_data.max_profit_position.sell.profit_net_pct >= strat_opts.buy_min_pct) {
							s.eventBus.emit('bollinger', 'buy', strat_data.max_profit_position.sell.id)
						}
						else {
							s.eventBus.emit('bollinger', 'buy')
						}
					}
				}
			}
		}
		cb()
	},

	onStrategyPeriod: function (s, opts= {}, cb = function() {}) {
		let strat_data = s.options.strategy.bollinger.data
		
		strat_data.bollinger = bollinger(s, 'bollinger', s.options.strategy.bollinger.opts.size, 'close')
		strat_data.rsi = rsi(s, 'rsi', s.options.strategy.bollinger.opts.rsi_size, 'bollinger')
		cb()
	},


	onReport: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.bollinger.opts
		let strat_data = s.options.strategy.bollinger.data
		
		var cols = []
		if (strat_data.bollinger && strat_data.rsi) {
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
				let rsi = strat_data.rsi.rsi
				
				var color_up = 'cyan';
				var color_down = 'cyan';
				var color_rsi = 'cyan'
				//Se il prezzo supera un limite del canale, allora il colore del limite è bianco
				if (s.period.close > (upperBound - (upperBandwidth * strat_opts.upper_bound_pct/100))) {
					color_up = 'white'
				}
				else if (s.period.close < (lowerBound + (lowerBandwidth * strat_opts.lower_bound_pct/100))) {
					color_down = 'white'
				}

				//Ma se siamo in dump/pump, allora il colore del limite è rosso
				if (strat_data.is_pump_watchdog || strat_data.is_dump_watchdog) {
					color_down = 'red'
				}
				
				//Se siamo oversold, il colore di rsi è rosso.
				//Se siamo in overbought il colore di rsi è verde
				if (rsi < strat_opts.rsi_buy_threshold) {
					color_rsi = 'red'
				}
				if (rsi > strat_opts.rsi_sell_threshold) {
					color_rsi = 'green'
				}
				
				//Controllo la minimum_bandwidth
				if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
					cols.push('*')
				}

				cols.push(z(8, n(lowerBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0,7), ' ')[color_down])
				cols.push(' <->')
				cols.push(z(8, n(upperBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0,7), ' ')[color_up])
				cols.push('(' + z(2, n(rsi).format('0'), ' ')[color_rsi] + ')')
			}
		}
		else {
			cols.push(z(8, '', ' '))
		}
		
		if (!s.in_preroll && (strat_data.max_profit_position.buy != null || strat_data.max_profit_position.sell != null)) {
			let position_buy_profit = -1
			let position_sell_profit = -1

			if (strat_data.max_profit_position.buy != null)
				position_buy_profit = strat_data.max_profit_position.buy.profit_net_pct/100

			if (strat_data.max_profit_position.sell != null)	
				position_sell_profit = strat_data.max_profit_position.sell.profit_net_pct/100

			buysell = (position_buy_profit > position_sell_profit ? 'B' : 'S')
			buysell_profit = (position_buy_profit > position_sell_profit ? formatPercent(position_buy_profit) : formatPercent(position_sell_profit))
			
			cols.push(z(8, buysell + buysell_profit, ' ')[n(buysell_profit) > 0 ? 'green' : 'red'])
		}
		else {
			cols.push(z(8, '', ' '))
		}
		
		cols.forEach(function (col) {
			process.stdout.write(col)
		})
		
		cb()
	},
	
	onUpdateMessage: function (s, opts= {}, cb = function() {}) {
		let max_profit_position = s.options.strategy.bollinger.data.max_profit_position
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
		cb()
	},
	
	onPositionUpdated: function (s, opts= {}, cb = function() {}) {
		cb()
	},
	
	onPositionClosed: function (s, opts= {}, cb = function() {}) {
		cb()
	},
	
	onOrderExecuted: function (s, opts= {}, cb = function() {}) {
		cb()
	},
	
	printOptions: function(s, opts= {}, cb = function() {}) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.bollinger))
		delete so_tmp.calc_lookback
		delete so_tmp.calc_close_time
		delete so_tmp.lib
		
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
