var z = require('zero-fill')
, n = require('numbro')
, bollinger = require('../../../lib/bollinger')
, Phenotypes = require('../../../lib/phenotype')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['bollingerAB'] = {
//	name: 'bollingerAB',
//	opts: {
//		period_calc: '15m',			//calculate Bollinger Bands every period_calc time
//		min_periods: 301, 			//min. number of history periods (timeframe period_length)
//		size: 20,					//period size
//		time: 2,					//times of standard deviation between the upper/lower band and the moving averages
//		min_bandwidth_pct: 0.50,	//minimum pct bandwidth to emit a signal
//		upper_bound_pct: 0,			//pct the current price should be near the bollinger upper bound before we sell
//		lower_bound_pct: 0,			//pct the current price should be near the bollinger lower bound before we buy
//		upper_watchdog_pct: 200,	//pct the current price should be over the bollinger upper bound to activate watchdog
//		lower_watchdog_pct: 200,	//pct the current price should be under the bollinger lower bound to activate watchdog
//		calmdown_watchdog_pct: 0,	//pct the current price should be far from the bollinger bands to calmdown the watchdog
//		bb_band : 0.004,			//minimum bollinger bandwith
//		upper_BB_percB : 1.5,		//maximum %B
//		lower_BB_percB : -0.5		//minimum %B
//	},
//	data: {							//to storage calculated data
//		upperBound: null,
//		midBound: null,
//		lowerBound : null
//	},
//}


module.exports = {
	name: 'bollingerAB',
	description: 'Buy when (Signal ≤ Lower Bollinger Band) and sell when (Signal ≥ Upper Bollinger Band).', //____Aggiornare descrizione____

	getOptions: function () {
		this.option('bollingerAB', 'period_calc', 'calculate Bollinger Bands every period_calc time', String, '15m')
		this.option('bollingerAB', 'min_periods', 'min. number of history periods', Number, 301)
		this.option('bollingerAB', 'size', 'period size', Number, 20)
		this.option('bollingerAB', 'time', 'times of standard deviation between the upper/lower band and the moving averages', Number, 1.5)
		this.option('bollingerAB', 'min_bandwidth_pct', 'minimum pct bandwidth to emit a signal', Number, null)
		this.option('bollingerAB', 'upper_bound_pct', 'pct the current price should be near the bollinger upper bound before we sell', Number, 0)
		this.option('bollingerAB', 'lower_bound_pct', 'pct the current price should be near the bollinger lower bound before we buy', Number, 0)
		this.option('bollingerAB', 'upper_watchdog_pct', 'pct the current price should be over the bollinger upper bound to activate watchdog', Number, 50)
		this.option('bollingerAB', 'lower_watchdog_pct', 'pct the current price should be under the bollinger lower bound to activate watchdog', Number, 50)
		this.option('bollingerAB', 'calmdown_watchdog_pct', 'pct the current price should be far from the bollinger bands to calmdown the watchdog', Number, 50)
		this.option('bollingerAB', 'BB_band', 'Bollinger Bandwith', Number, 0.000)
		this.option('bollingerAB', 'upper_BB_pct', 'Bollinger %B', Number, 2)
		this.option('bollingerAB', 'lower_BB_pct', 'Bollinger %B', Number, -2)

	},

	calculate: function (s) {
		// calculate Bollinger Bands
		bollinger(s, 'bollingerAB', s.options.strategy.bollingerAB.opts.size, 'close')

	},

	onPeriod: function (s, cb) {
		if (s.options.strategy.bollingerAB.data) {
			let upperBound = s.options.strategy.bollingerAB.data.upperBound
			let lowerBound = s.options.strategy.bollingerAB.data.lowerBound
			let midBound = s.options.strategy.bollingerAB.data.midBound
			let upperBandwidth = (s.options.strategy.bollingerAB.data.upperBound - s.options.strategy.bollingerAB.data.midBound)
			let lowerBandwidth = (s.options.strategy.bollingerAB.data.midBound - s.options.strategy.bollingerAB.data.lowerBound)

			let BB_bandwidth = (upperBound - lowerBound)/ midBound
			let BB_pct = (s.period.close - lowerBound)/ ( upperBound - lowerBound)
			let BB_band = s.options.strategy.bollingerAB.opts.BB_band
			let upper_BB_pct = s.options.strategy.bollingerAB.opts.upper_BB_pct
			let lower_BB_pct = s.options.strategy.bollingerAB.opts.lower_BB_pct

			let bandwidth_pct = (upperBound - lowerBound) / midBound * 100
			let min_bandwidth_pct = s.options.strategy.bollingerAB.opts.min_bandwidth_pct
			let upperWatchdogBound = upperBound + (upperBandwidth * s.options.strategy.bollingerAB.opts.upper_watchdog_pct/100)
			let lowerWatchdogBound = lowerBound - (lowerBandwidth * s.options.strategy.bollingerAB.opts.lower_watchdog_pct/100)
			let upperCalmdownWatchdogBound = upperBound - (upperBandwidth * s.options.strategy.bollingerAB.opts.calmdown_watchdog_pct/100)
			let lowerCalmdownWatchdogBound = lowerBound + (lowerBandwidth * s.options.strategy.bollingerAB.opts.calmdown_watchdog_pct/100)
			let flag_up = s.flag_up
			let flag_down = s.flag_down

			//Controllo la minimum_bandwidth
			if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
				upperBound = midBound * (1 + (min_bandwidth_pct/100)/2)
				lowerBound = midBound * (1 - (min_bandwidth_pct/100)/2)
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
				if (s.period.close > (upperBound - (upperBandwidth * s.options.strategy.bollingerAB.opts.upper_bound_pct/100)) && BB_bandwidth > BB_band && BB_pct < upper_BB_pct) {
					if (flag_up === undefined  || flag_up === false) {
						s.flag_up = true
					}
				}
				else if (s.period.close < (upperBound - (upperBandwidth * s.options.strategy.bollingerAB.opts.upper_bound_pct/100)) && s.flag_up === true ){
					s.flag_up = false
					console.log ('upper back')
					s.eventBus.emit('bollingerAB', 'sell')
				}
				else if (s.period.close < (lowerBound + (lowerBandwidth * s.options.strategy.bollingerAB.opts.lower_bound_pct/100)) && BB_bandwidth > BB_band && BB_pct > lower_BB_pct) {
					if (flag_down  === undefined  || flag_down === false) {
						s.flag_down = true
					}
				}
				else if (s.period.close > (lowerBound + (lowerBandwidth * s.options.strategy.bollingerAB.opts.lower_bound_pct/100)) && s.flag_down === true) {
					s.flag_down = false
					console.log ('lower back')
					s.eventBus.emit('bollingerAB', 'buy')
				}
				else {
					s.signal = null // hold
				}

			}
			else { 
				//Siamo in watchdog, controlla se ci siamo ancora
				if (s.period.close > lowerCalmdownWatchdogBound && s.period.close < upperCalmdownWatchdogBound) {
					s.signal = null
					s.is_pump_watchdog = false
					s.is_dump_watchdog = false
				}
			}
		}
		cb()
	},

	onReport: function (s) {
		var cols = []
		if (s.options.strategy.bollingerAB.data) {
			if (s.options.strategy.bollingerAB.data.upperBound && s.options.strategy.bollingerAB.data.lowerBound) {
				let upperBound = s.options.strategy.bollingerAB.data.upperBound
				let lowerBound = s.options.strategy.bollingerAB.data.lowerBound
				let midBound = s.options.strategy.bollingerAB.data.midBound
				let upperBandwidth = (s.options.strategy.bollingerAB.data.upperBound - s.options.strategy.bollingerAB.data.midBound)
				let lowerBandwidth = (s.options.strategy.bollingerAB.data.midBound - s.options.strategy.bollingerAB.data.lowerBound)
				let bandwidth_pct = (upperBound - lowerBound) / midBound * 100
				let min_bandwidth_pct = s.options.strategy.bollingerAB.opts.min_bandwidth_pct
				let upperWatchdogBound = s.options.strategy.bollingerAB.data.upperBound + (upperBandwidth * s.options.strategy.bollingerAB.opts.upper_watchdog_pct/100)
				let lowerWatchdogBound = s.options.strategy.bollingerAB.data.lowerBound - (lowerBandwidth * s.options.strategy.bollingerAB.opts.lower_watchdog_pct/100)
				//let bandwidth = upperBound - lowerBound
				//let BB_pct = s.options.strategy.bollingerAB.data.BB_pct

				var color_up = 'cyan';
				var color_down = 'cyan';
				//Se il prezzo supera un limite del canale, allora il colore del limite è bianco
				if (s.period.close > (s.options.strategy.bollingerAB.data.upperBound - (upperBandwidth * s.options.strategy.bollingerAB.opts.upper_bound_pct/100))) {
					color_up = 'white'
				}
				else if (s.period.close < (s.options.strategy.bollingerAB.data.lowerBound + (lowerBandwidth * s.options.strategy.bollingerAB.opts.lower_bound_pct/100))) {
					color_down = 'white'
				}

				//Ma se siamo in dump/pump, allora il colore del limite è rosso
				if (s.period.close > upperWatchdogBound) {
					color_up = 'red'
				}
				if (s.period.close < lowerWatchdogBound) {
					color_down = 'red'
				}

				//Controllo la minimum_bandwidth
				if (min_bandwidth_pct && (bandwidth_pct < min_bandwidth_pct)) {
					cols.push('*')
				}

				cols.push(z(8, n(s.options.strategy.bollingerAB.data.lowerBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0,7), ' ')[color_down])
				cols.push(' <->')
				cols.push(z(8, n(s.options.strategy.bollingerAB.data.upperBound).format(s.product.increment ? s.product.increment : '0.00000000').substring(0,7), ' ')[color_up])
			}
		}
		else {
			cols.push('         ')
		}
		return cols
	},

//	orderExecuted: function (s, type, executeSignal) {
//		console.log('exec')
//	},

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
