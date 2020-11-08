var tulind = require('tulind')


module.exports = function ti_rsi(s, key = 'close', strategy_name, rsi_periods = 14) {
	return new Promise(function (resolve, reject) {
		if (strategy_name) {
			var tmpMarket = s.options.strategy[strategy_name].calc_lookback.slice(0, rsi_periods).map(x => x[key]).reverse()
		}
		else {
			var tmpMarket = s.lookback.slice(0, rsi_periods).map(x => x[key]).reverse()
			tmpMarket.push(s.period[key])
		}

		if (tmpMarket.length >= rsi_periods) {
			tulind.indicators.rsi.indicator(
				[tmpMarket],
				[rsi_periods]
				, function (err, result) {
					if (err) {
//						console.log(err)
						reject(err, result)
						return
					}

					if (strategy_name) {
						s.options.strategy[strategy_name].data.rsi = result
					}
					resolve(result)
				})
		}
		else {
//			console.log('ti_rsi - Market length not populated enough')
			reject('ti_rsi - (nice error) - Market Length not populated enough')
		}
	})
}


