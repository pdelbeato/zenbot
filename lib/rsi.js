var precisionRound = function(number, precision) {
  var factor = Math.pow(10, precision)
  return Math.round(number * factor) / factor
}
module.exports = function rsi (s, key, length, strategy_name = undefined) {
	if(strategy_name == undefined) {
		if (s.lookback.length >= length) {
			var avg_gain = s.lookback[0][key + '_avg_gain']
			var avg_loss = s.lookback[0][key + '_avg_loss']
			if (typeof avg_gain === 'undefined') {
				var gain_sum = 0
				var loss_sum = 0
				var last_close
				//ATTENZIONE!!! I valori sono richiamati inordine inverso, quindi anche la formula andava ragionata in modo inverso
				// Il gioco torna solo perché dal primo valore rsi in poi, i calcoli vengono effettuati strada facendo
				s.lookback.slice(0, length).forEach(function (period) {
					if (last_close) {
//						if (period.close > last_close) {
						if (period.close < last_close) {
//							gain_sum += period.close - last_close
							gain_sum += last_close - period.close
						}
						else {
//							loss_sum += last_close - period.close
							loss_sum += period.close - last_close
						}
					}
					last_close = period.close
				})
				s.period[key + '_avg_gain'] = gain_sum / length
				s.period[key + '_avg_loss'] = loss_sum / length
			}
			else {
				var current_gain = s.period.close - s.lookback[0].close
				s.period[key + '_avg_gain'] = ((avg_gain * (length - 1)) + (current_gain > 0 ? current_gain : 0)) / length
				var current_loss = s.lookback[0].close - s.period.close
				s.period[key + '_avg_loss'] = ((avg_loss * (length - 1)) + (current_loss > 0 ? current_loss : 0)) / length
			}

			if(s.period[key + '_avg_loss'] == 0) {
				s.period[key] = 100
			} else {
				var rs = s.period[key + '_avg_gain'] / s.period[key + '_avg_loss']
				s.period[key] = precisionRound(100 - (100 / (1 + rs)), 2)
			}
		}
	}
	else {
		if (s.options.strategy[strategy_name].calc_lookback.length >= length) {
			var avg_gain = s.options.strategy[strategy_name].calc_lookback[0][key + '_avg_gain']
			var avg_loss = s.options.strategy[strategy_name].calc_lookback[0][key + '_avg_loss']
			if (typeof avg_gain === 'undefined') {
				var gain_sum = 0
				var loss_sum = 0
				var last_close
				s.options.strategy[strategy_name].calc_lookback.slice(0, length).forEach(function (period) {
					if (last_close) {
						if (period.close < last_close) {
							gain_sum += last_close - period.close
						}
						else {
							loss_sum += period.close - last_close
						}
					}
					last_close = period.close
				})
				s.options.strategy[strategy_name].data[key + '_avg_gain'] = gain_sum / length
				s.options.strategy[strategy_name].data[key + '_avg_loss'] = loss_sum / length
			}
			else {
				var current_gain = s.period.close - s.options.strategy[strategy_name].calc_lookback[0].close
				s.options.strategy[strategy_name].data[key + '_avg_gain'] = ((avg_gain * (length - 1)) + (current_gain > 0 ? current_gain : 0)) / length
				var current_loss = s.options.strategy[strategy_name].calc_lookback[0].close - s.period.close
				s.options.strategy[strategy_name].data[key + '_avg_loss'] = ((avg_loss * (length - 1)) + (current_loss > 0 ? current_loss : 0)) / length
			}

			if(s.options.strategy[strategy_name].data[key + '_avg_loss'] == 0) {
				s.options.strategy[strategy_name].data[key] = 100
			} else {
				var rs = s.options.strategy[strategy_name].data[key + '_avg_gain'] / s.options.strategy[strategy_name].data[key + '_avg_loss']
				s.options.strategy[strategy_name].data[key] = precisionRound(100 - (100 / (1 + rs)), 2)
			}
		}
	}
}

