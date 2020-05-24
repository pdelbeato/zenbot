var talib = require('talib')

module.exports = function ta_rsi(s, key = 'close', strategy_name, rsi_periods = 14) {
  return new Promise(function (resolve, reject) {
    var min_length = rsi_periods + 1

    if (strategy_name) {
			var tmpMarket = s.options.strategy[strategy_name].calc_lookback.slice(0, min_length).map(x => x[key]).reverse()
		}
		else {
			var tmpMarket = s.lookback.slice(0, min_length).map(x => x[key]).reverse()
			tmpMarket.push(s.period[key])
		}

    if (tmpMarket.length >= min_length) {
      talib.execute({
        name: 'RSI',
        startIdx: 0,
        endIdx: tmpMarket.length - 1,
        inReal: tmpMarket,
        optInTimePeriod: rsi_periods,  //RSI 14 default
      }, function (err, result) {
        if (err) {
          console.log(err)
          return reject(err, result)
        }

        result_rsi = result.result.outReal[result.result.outReal.length - 1]
          
        if (strategy_name) {
          s.options.strategy[strategy_name].data.rsi = result_rsi
        }

        return resolve(result_rsi)
      })
    }
    else {
      return reject('ta_rsi - (nice error) - MarketLength not populated enough')
    }
  })
}
