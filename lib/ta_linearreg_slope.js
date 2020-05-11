var talib = require('talib')

//Il risultato è in ‰ (per mille)
module.exports = function ta_linearreg_slope(s, key = 'close', strategy_name, length) {
	return new Promise(function (resolve, reject) {
		// create object for talib. only close is used for now but rest might come in handy
		//		if (!s.marketData) {
		//		s.marketData = { open: [], close: [], high: [], low: [], volume: [] }
		//		}
		if (strategy_name) {
			var tmpMarket = s.options.strategy[strategy_name].calc_lookback.slice(0, length).map(x => x[key]).reverse()
		}
		else {
			var tmpMarket = s.lookback.slice(0, length).map(x => x[key]).reverse()
			tmpMarket.push(s.period[key])
		}

		if (tmpMarket.length >= length) {
			talib.execute({
				name: 'LINEARREG_SLOPE',
				startIdx: 0,
				endIdx: tmpMarket.length - 1,
				inReal: tmpMarket,
				optInTimePeriod: length
			}, function (err, result) {
				//Result format: (note: outReal can have multiple items in the array)
				// {
				//   begIndex: 8,
				//   nbElement: 1,
				//   result: { outReal: [ 1820.8621111111108 ] }
				// }
				resultOut = result.result.outReal[(result.nbElement - 1)]
				resultOut = resultOut / s.period[key] * 1000
				if (err) {
					console.log(err)
					reject(err, result)
					return
				}

				if (strategy_name) {
					s.options.strategy[strategy_name].data.slope = resultOut
				}

				resolve(resultOut)
			})
		} else {
			reject('ta_linearreg_slope - (nice error) - MarketLength not populated enough')
		}
	})
}
