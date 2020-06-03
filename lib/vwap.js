//Modificato per lavorare con Quantumbot

//Calcola la VWAP
//Se è presente il parametro "strategy_name", allora calcola la VWAP con i valori presi da calc_lookback della strategia
//Se non è presente il parametro "strategy_name", allora calcola la VWAP con i valori presi da s.lookback
module.exports = function vwap (s, strategy_name, length, max_period, source_key) {
	if (!source_key) {
		source_key = 'close'
	}

	if (strategy_name) {
		var VWAP_LOOKBACK = s.options.strategy[strategy_name].calc_lookback
		var VWAP_DATA = s.options.strategy[strategy_name].data
		// var VWAP_PERIOD = s.options.strategy[strategy_name].period
	}
	else {
		var VWAP_LOOKBACK = s.lookback
		var VWAP_DATA = s
		// var VWAP_PERIOD = s.period
	}

	//VWAP_LOOKBACK serve solo a far partire il sistema dopo un numero di periodi definito da length. 
	if (VWAP_LOOKBACK.length >= length) {
		if(!VWAP_DATA.vwap){
			VWAP_DATA.vwap = {
				vwap: 0, 
				vwapMultiplier: 0, 
				vwapDivider: 0,
				vwapCount: 0
			}
		}

		if(max_period && VWAP_DATA.vwap.vwapCount > max_period) {
			VWAP_DATA.vwap = {
				vwap: 0, 
				vwapMultiplier: 0, 
				vwapDivider: 0,
				vwapCount: 0
			}
		}

		VWAP_DATA.vwap.vwapMultiplier = VWAP_DATA.vwap.vwapMultiplier + parseFloat(VWAP_LOOKBACK[0][source_key]) * parseFloat(VWAP_LOOKBACK[0]['volume'])
		VWAP_DATA.vwap.vwapDivider = VWAP_DATA.vwap.vwapDivider + parseFloat(VWAP_LOOKBACK[0]['volume'])

		VWAP_DATA.vwap.vwap = (VWAP_DATA.vwap.vwapMultiplier / VWAP_DATA.vwap.vwapDivider)

		VWAP_DATA.vwap.vwapCount++

		return VWAP_DATA.vwap.vwap
	}
}

