var z = require('zero-fill')
, n = require('numbro')
, bollinger = require('../../../lib/bollinger')
, rsi = require('../../../lib/rsi')
, Phenotypes = require('../../../lib/phenotype')
, cliff = require('cliff')
, crypto = require('crypto')
, debug = require('../../../lib/debug')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['bollinger'] = {
//	name: 'bollinger',
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate Bollinger Bands every period_calc time
//		min_periods: 301, 			//****** Minimum number of history periods (timeframe period_length)
//		size: 20,					//period size
//		time: 2,					//times of standard deviation between the upper/lower band and the moving averages
//		rsi_size: 15,				//period size rsi
//		min_bandwidth_pct: 0.50,	//minimum pct bandwidth to emit a signal
//		upper_bound_pct: 0,			//pct the current price should be near the bollinger upper bound before we sell
//		lower_bound_pct: 0,			//pct the current price should be near the bollinger lower bound before we buy
//		upper_watchdog_pct: 200,	//pct the current price should be over the bollinger upper bound to activate watchdog
//		lower_watchdog_pct: 200,	//pct the current price should be under the bollinger lower bound to activate watchdog
//		calmdown_watchdog_pct: 0,	//pct the current price should be far from the bollinger bands to calmdown the watchdog
//		rsi_buy_threshold: 30,		//minimum rsi to buy
//		rsi_sell_threshold: 100,	//maximum rsi to sell
//	},
//	data: {							//****** To store calculated data
//		upperBound: null,
//		midBound: null,
//		lowerBound: null,
//		rsi: null,
//		rsi_avg_gain: null,
//		rsi_avg_loss: null,
//	},	
//	calc_lookback: [],				//****** Old periods for calculation
//	calc_close_time: 0				//****** Close time for strategy period
//	lib: {}							//****** To store all the functions of the strategy
//}

module.exports = {
	name: 'bollinger',
	description: 'Buy when [(Signal ≤ Lower Bollinger Band) && (rsi > rsi_buy_threshold)] and sell when [(Signal ≥ Upper Bollinger Band) && (rsi < rsi_sell_threshold)].',

	getOptions: function () {
		this.option('bollinger', 'period_calc', 'calculate Bollinger Bands every period_calc time', String, '15m')
		this.option('bollinger', 'min_periods', 'min. number of history periods', Number, 301)
		this.option('bollinger', 'size', 'period size', Number, 20)
		this.option('bollinger', 'time', 'times of standard deviation between the upper/lower band and the moving averages', Number, 1.5)
		this.option('bollinger', 'rsi_size', 'period size rsi', Number, 15)
		this.option('bollinger', 'min_bandwidth_pct', 'minimum pct bandwidth to emit a signal', Number, null)
		this.option('bollinger', 'upper_bound_pct', 'pct the current price should be near the bollinger upper bound before we sell', Number, 0)
		this.option('bollinger', 'lower_bound_pct', 'pct the current price should be near the bollinger lower bound before we buy', Number, 0)
		this.option('bollinger', 'upper_watchdog_pct', 'pct the current price should be over the bollinger upper bound to activate watchdog', Number, 50)
		this.option('bollinger', 'lower_watchdog_pct', 'pct the current price should be under the bollinger lower bound to activate watchdog', Number, 50)
		this.option('bollinger', 'calmdown_watchdog_pct', 'pct the current price should be far from the bollinger bands to calmdown the watchdog', Number, 50)
		this.option('bollinger', 'rsi_buy_threshold', 'minimum rsi to buy', Number, 30)
		this.option('bollinger', 'rsi_sell_threshold', 'maximum rsi to sell', Number, 70)
	},

	calculate: function () {
	},
	
	calculateCloseTime: function (s) {
		bollinger(s, 'bollinger', s.options.strategy.bollinger.opts.size, 'close')
		rsi(s, 'rsi', s.options.strategy.bollinger.opts.rsi_size, 'bollinger')
	},

	onPeriod: function (s, cb) {
		if (s.options.strategy.bollinger.data) {
//			if (s.options.strategy.bollinger.data.upperBound && s.options.strategy.bollinger.data.lowerBound) {
			let upperBound = s.options.strategy.bollinger.data.upperBound
			let lowerBound = s.options.strategy.bollinger.data.lowerBound
			let midBound = s.options.strategy.bollinger.data.midBound
			let upperBandwidth = (s.options.strategy.bollinger.data.upperBound - s.options.strategy.bollinger.data.midBound)
			let lowerBandwidth = (s.options.strategy.bollinger.data.midBound - s.options.strategy.bollinger.data.lowerBound)
			let bandwidth_pct = (upperBound - lowerBound) / midBound * 100
			let min_bandwidth_pct = s.options.strategy.bollinger.opts.min_bandwidth_pct
			let upperWatchdogBound = upperBound + (upperBandwidth * s.options.strategy.bollinger.opts.upper_watchdog_pct/100)
			let lowerWatchdogBound = lowerBound - (lowerBandwidth * s.options.strategy.bollinger.opts.lower_watchdog_pct/100)
			let upperCalmdownWatchdogBound = upperBound - (upperBandwidth * s.options.strategy.bollinger.opts.calmdown_watchdog_pct/100)
			let lowerCalmdownWatchdogBound = lowerBound + (lowerBandwidth * s.options.strategy.bollinger.opts.calmdown_watchdog_pct/100)
			let rsi = s.options.strategy.bollinger.data.rsi

			//Controllo la minimum_bandwidth
			if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
//				console.log('bollinger strategy - min_bandwidth_pct= ' + min_bandwidth_pct + ' ; bandwidth_pct= ' + bandwidth_pct)
				upperBound = midBound * (1 + (min_bandwidth_pct/100)/2)
				lowerBound = midBound * (1 - (min_bandwidth_pct/100)/2)
//				console.log('bollinger strategy - nuovi limiti. upperBound ' + upperBound + ' ; lowerBound= ' + lowerBound)
			}

			//Se sono attive le opzioni watchdog, controllo se dobbiamo attivare il watchdog
			if (s.options.pump_watchdog && s.period.close > upperWatchdogBound) {
				s.signal = 'pump'
					s.is_pump_watchdog = true
					s.is_dump_watchdog = false
			}
			else if (s.options.dump_watchdog && s.period.close < lowerWatchdogBound) {
				s.signal = 'dump'
					s.is_pump_watchdog = false
					s.is_dump_watchdog = true
			}

			//Se non siamo in watchdog, utilizza la normale strategia
			if (!s.is_dump_watchdog && !s.is_pump_watchdog) {
				let buy_condition_1 = (s.period.close < (lowerBound + (lowerBandwidth * s.options.strategy.bollinger.opts.lower_bound_pct/100)))
				let buy_condition_2 = (rsi > s.options.strategy.bollinger.opts.rsi_buy_threshold)
				
				let sell_condition_1 = (s.period.close > (upperBound - (upperBandwidth * s.options.strategy.bollinger.opts.upper_bound_pct/100)))
				let sell_condition_2 = (rsi < s.options.strategy.bollinger.opts.rsi_sell_threshold)
				
				if (sell_condition_1 && sell_condition_2) {
					s.eventBus.emit('bollinger', 'sell')
				}
				else if (buy_condition_1 && buy_condition_2) {
					s.eventBus.emit('bollinger', 'buy')
				}
				else {
					s.signal = null // hold
				}
			}
			else { //Siamo in watchdog, controlla se ci siamo ancora
				if (s.period.close > lowerCalmdownWatchdogBound && s.period.close < upperCalmdownWatchdogBound) {
					s.signal = null
					s.is_pump_watchdog = false
					s.is_dump_watchdog = false
				}
			}
		}
//		}
		cb()
	},

	onReport: function (s) {
		var cols = []
		if (s.options.strategy.bollinger.data) {
			if (s.options.strategy.bollinger.data.upperBound && s.options.strategy.bollinger.data.lowerBound) {
				let upperBound = s.options.strategy.bollinger.data.upperBound
				let lowerBound = s.options.strategy.bollinger.data.lowerBound
				let midBound = s.options.strategy.bollinger.data.midBound
				let upperBandwidth = (s.options.strategy.bollinger.data.upperBound - s.options.strategy.bollinger.data.midBound)
				let lowerBandwidth = (s.options.strategy.bollinger.data.midBound - s.options.strategy.bollinger.data.lowerBound)
				let bandwidth_pct = (upperBound - lowerBound) / midBound * 100
				let min_bandwidth_pct = s.options.strategy.bollinger.opts.min_bandwidth_pct
				let upperWatchdogBound = s.options.strategy.bollinger.data.upperBound + (upperBandwidth * s.options.strategy.bollinger.opts.upper_watchdog_pct/100)
				let lowerWatchdogBound = s.options.strategy.bollinger.data.lowerBound - (lowerBandwidth * s.options.strategy.bollinger.opts.lower_watchdog_pct/100)
				let rsi = s.options.strategy.bollinger.data.rsi
				
				var color_up = 'cyan';
				var color_down = 'cyan';
				var color_rsi = 'cyan'
				//Se il prezzo supera un limite del canale, allora il colore del limite è bianco
				if (s.period.close > (s.options.strategy.bollinger.data.upperBound - (upperBandwidth * s.options.strategy.bollinger.opts.upper_bound_pct/100))) {
					color_up = 'white'
				}
				else if (s.period.close < (s.options.strategy.bollinger.data.lowerBound + (lowerBandwidth * s.options.strategy.bollinger.opts.lower_bound_pct/100))) {
					color_down = 'white'
				}

				//Ma se siamo in dump/pump, allora il colore del limite è rosso
				if (s.period.close > upperWatchdogBound) {
					color_up = 'red'
				}
				if (s.period.close < lowerWatchdogBound) {
					color_down = 'red'
				}
				
				//Se siamo oversold, il colore di rsi è rosso.
				//Se siamo in overbought il colore di rsi è verde
				if (rsi < s.options.strategy.bollinger.opts.rsi_buy_threshold) {
					color_rsi = 'red'
				}
				if (rsi > s.options.strategy.bollinger.opts.rsi_sell_threshold) {
					color_rsi = 'green'
				}
				

				//Controllo la minimum_bandwidth
				if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
					cols.push('*')
				}

				cols.push(z(8, n(s.options.strategy.bollinger.data.lowerBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0,7), ' ')[color_down])
				cols.push(' <->')
				cols.push(z(8, n(s.options.strategy.bollinger.data.upperBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0,7), ' ')[color_up])
				cols.push('(' + z(2, n(s.options.strategy.bollinger.data.rsi).format('0'), ' ')[color_rsi] + ')')
			}
		}
		else {
			cols.push('         ')
		}
		return cols
	},
	
	printOptions: function(s) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.bollinger))
		delete so_tmp.calc_lookback
		delete so_tmp.calc_close_time
		delete so_tmp.lib
		
		console.log('\n' + cliff.inspect(so_tmp))
	},
	
	orderExecuted: function (s, type, executeSignal) {

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
