var z = require('zero-fill')
  , n = require('numbro')
  , bollinger = require('../../../lib/bollinger')
  , Phenotypes = require('../../../lib/phenotype')
  , debug = require('../../../lib/debug')
  , crypto = require('crypto')

module.exports = {
  name: 'bollinger',
  description: 'Buy when (Signal ≤ Lower Bollinger Band) and sell when (Signal ≥ Upper Bollinger Band).',

  getOptions: function () {
    this.option('period', 'period length, same as --period_length', String, '15m')
    this.option('period_length', 'period length, same as --period', String, '15m')
    //this.option('period_calc', 'calculate Bollinger Bands every periode_calc time period_length (or period)', Number, 1)
    this.option('min_periods', 'min. number of history periods', Number, 301)
    this.option('bollinger_size', 'period size', Number, 20)
    this.option('bollinger_time', 'times of standard deviation between the upper/lower band and the moving averages', Number, 1.5)
    this.option('bollinger_upper_bound_pct', 'pct the current price should be near the bollinger upper bound before we sell', Number, 0)
    this.option('bollinger_lower_bound_pct', 'pct the current price should be near the bollinger lower bound before we buy', Number, 0)
    this.option('bollinger_upper_watchdog_pct', 'pct the current price should be over the bollinger upper bound to activate watchdog', Number, 50)
    this.option('bollinger_lower_watchdog_pct', 'pct the current price should be under the bollinger lower bound to activate watchdog', Number, 50)
    this.option('bollinger_calmdown_watchdog_pct', 'pct the current price should be far from the bollinger bands to calmdown the watchdog', Number, 50)
  },

  calculate: function (s) {
    // calculate Bollinger Bands
    bollinger(s, 'bollinger', s.options.bollinger_size, 'close')
  },

  onPeriod: function (s, cb) {
    if (s.period.bollinger) {
      if (s.period.bollinger.upperBound && s.period.bollinger.lowerBound) {
//        let upperBound = s.period.bollinger.upper[s.period.bollinger.upper.length-1]
//        let lowerBound = s.period.bollinger.lower[s.period.bollinger.lower.length-1]
//        let upperBandWidth = (s.period.bollinger.upper[s.period.bollinger.upper.length-1] - s.period.bollinger.mid[s.period.bollinger.mid.length-1])
//        let lowerBandWidth = (s.period.bollinger.mid[s.period.bollinger.mid.length-1] - s.period.bollinger.lower[s.period.bollinger.lower.length-1])
		let upperBound = s.period.bollinger.upperBound
		let lowerBound = s.period.bollinger.lowerBound
		let upperBandWidth = (s.period.bollinger.upperBound - s.period.bollinger.midBound)
		let lowerBandWidth = (s.period.bollinger.midBound - s.period.bollinger.lowerBound)
		let upperWatchdogBound = upperBound + (upperBandWidth * s.options.bollinger_upper_watchdog_pct/100)
        let lowerWatchdogBound = lowerBound - (lowerBandWidth * s.options.bollinger_lower_watchdog_pct/100)
        let upperCalmdownWatchdogBound = upperBound - (upperBandWidth * s.options.bollinger_calmdown_watchdog_pct/100)
        let lowerCalmdownWatchdogBound = lowerBound + (lowerBandWidth * s.options.bollinger_calmdown_watchdog_pct/100)

        //Se sono attive le opzioni watchdog, controllo se dobbiamo attivare il watchdog
        if (s.options.pump_watchdog && s.period.close > upperWatchdogBound) {
          s.signal = 'pump'
          s.is_pump_watchdog = true
          s.is_dump_watchdog = false
        } else if (s.options.dump_watchdog && s.period.close < lowerWatchdogBound) {
          s.signal = 'dump'
          s.is_pump_watchdog = false
          s.is_dump_watchdog = true
        }

        //Se non siamo in watchdog, utilizza la normale strategia
        if (!s.is_dump_watchdog && !s.is_pump_watchdog) {
          if (s.period.close > (upperBound - (upperBandWidth * s.options.bollinger_upper_bound_pct/100))) {
            s.signal = 'sell'
          } else if (s.period.close < (lowerBound + (lowerBandWidth * s.options.bollinger_lower_bound_pct/100))) {
            s.signal = 'buy'
          } else {
            s.signal = null // hold
          }
        } else { //Siamo in watchdog, controlla se ci siamo ancora
          if (s.period.close > lowerCalmdownWatchdogBound && s.period.close < upperCalmdownWatchdogBound) {
            s.signal = null
            s.is_pump_watchdog = false
            s.is_dump_watchdog = false
          }
        }
      }
    }
    cb()
  },

  onReport: function (s) {
    var cols = []
    if (s.period.bollinger) {
      if (s.period.bollinger.upperBound && s.period.bollinger.lowerBound) {
//        let upperBound = s.period.bollinger.upper[s.period.bollinger.upper.length-1]
//        let lowerBound = s.period.bollinger.lower[s.period.bollinger.lower.length-1]
//        let upperBandWidth = (s.period.bollinger.upper[s.period.bollinger.upper.length-1] - s.period.bollinger.mid[s.period.bollinger.mid.length-1])
//        let lowerBandWidth = (s.period.bollinger.mid[s.period.bollinger.mid.length-1] - s.period.bollinger.lower[s.period.bollinger.lower.length-1])
        let upperBandWidth = (s.period.bollinger.upperBound - s.period.bollinger.midBound)
        let lowerBandWidth = (s.period.bollinger.midBound - s.period.bollinger.lowerBound)
        let upperWatchdogBound = upperBound + (upperBandWidth * s.options.bollinger_upper_watchdog_pct/100)
        let lowerWatchdogBound = lowerBound - (lowerBandWidth * s.options.bollinger_lower_watchdog_pct/100)

        var color = 'grey'
        if (s.period.close > (s.period.bollinger.upperBound - (upperBandWidth * s.options.bollinger_upper_bound_pct/100))) {
          color = 'green'
        } else if (s.period.close < (s.period.bollinger.lowerBound + (lowerBandWidth * s.options.bollinger_lower_bound_pct/100))) {
          color = 'red'
        }

        //Ma se siamo in dump/pump, allora il colore è bianco
        if (s.period.close > upperWatchdogBound || s.period.close < lowerWatchdogBound) {
          color = 'white'
        }

        cols.push(z(8, n(s.period.close).format('0.00'), ' ')[color])
        cols.push(z(8, n(s.period.bollinger.lowerBound).format('0.00').substring(0,7), ' ').cyan)
        cols.push(z(8, n(s.period.bollinger.upperBound).format('0.00').substring(0,7), ' ').cyan)
      }
    }
    else {
      cols.push('         ')
    }
    return cols
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
    bollinger_size: Phenotypes.Range(1, 40),
    bollinger_time: Phenotypes.RangeFloat(1,6),
    bollinger_upper_bound_pct: Phenotypes.RangeFloat(-1, 30),
    bollinger_lower_bound_pct: Phenotypes.RangeFloat(-1, 30),
    bollinger_upper_watchdog_pct: Phenotypes.RangeFloat(50, 300),
    bollinger_lower_watchdog_pct: Phenotypes.RangeFloat(50, 300),
    bollinger_calmdown_watchdog_pct: Phenotypes.RangeFloat(-50, 80)
  }
}
