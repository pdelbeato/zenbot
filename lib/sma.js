//Modificato per lavorare con Quantumbot

//Calcola la SMA
//Se è presente il parametro "strategy_name", allora calcola la SMA con i valori presi da calc_lookback della strategia
//Se non è presente il parametro "strategy_name", allora calcola la SMA con i valori presi da s.lookback
module.exports = function sma(s, strategy_name, length, source_key) {
	if (!source_key) {
		source_key = 'close'
	}

	if (strategy_name) {
		var SMA = s.options.strategy[strategy_name].calc_lookback
	}
	else {
		var SMA = s.lookback
	}

	if (SMA.length >= length) {
		SMA = SMA.slice(0, length).reduce((sum, cur) => {
			return sum + cur[source_key]
		}, 0)

		return (SMA / length)
	}
	else {
		return console.error('\nSimple Moving Average (sma.js) - Error: Market not populated enough')
	}
}

