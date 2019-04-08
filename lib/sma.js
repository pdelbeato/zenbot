//Modificato per lavorare con Quantumbot
module.exports = function sma (s, strategy_name, length, source_key) { 
	if (!source_key) {
		source_key = 'close'
	}
	if (s.options.strategy[strategy_name].calc_lookback.length >= length) {
		let SMA = s.options.strategy[strategy_name].calc_lookback
		.slice(0, length)
		.reduce((sum, cur) => {
			return sum + cur[source_key]
		}, 0)

		s.options.strategy[strategy_name].data.sma = SMA / length
	}
}

