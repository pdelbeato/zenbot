//Bollinger Bands
var bollingerbands = require('bollinger-bands')
module.exports = function bollinger (s, strategy_name, length, source_key) {
	if (!source_key) source_key = 'close'
		//if (!period_calc) period_calc = 1

		// if (s.lookback.length > length) {
		//   let data = []
		//   for (var i=length-1; i>=0; i--) {
		//     data.push(s.lookback[i][source_key])
		//   }
		//   let result = bollingerbands(data, length, s.options.bollinger_time)
		//   s.period[key] = result

		if (s.options.strategy[strategy_name].calc_lookback.length > length) {

			//Voglio capire bene a cosa serve questa riga di codice prima di attivarla
			// skip calculation if result already presented as we use historical data only,
			// no need to recalculate for each individual trade
//			if (key in s.period) return
			
			let data = []
			for (var i = (s.options.strategy.bollinger.calc_lookback.length-1); i >= 0; i--) {
				// for (var i=length-1; i>=0; i--) {
				data.push(s.options.strategy[strategy_name].calc_lookback[i][source_key])
			}
			const result = bollingerbands(data, length, s.options.strategy[strategy_name].opts.time)
			//s.period[key] = result		    
			const upperBound = result.upper[result.upper.length-1]
			const lowerBound = result.lower[result.lower.length-1]
			const midBound = result.mid[result.mid.length-1]
			const simple_result = {
				upperBound : upperBound,
				midBound: midBound,
				lowerBound : lowerBound
			}
			s.options.strategy[strategy_name].data = simple_result
			// let result = bollingerbands(data, length, s.options.bollinger_time)
			// s.period[key] = result
		}
}