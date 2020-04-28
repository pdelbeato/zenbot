var talib = require('talib')

module.exports = function ta_bollinger(s, key = 'close', strategy_name, d_ma_periods = 14, DevUp = 2, DevDn = 2, d_ma_type = 'SMA') {
  return new Promise(function (resolve, reject) {
    if (strategy_name) {
      var tmpMarket = s.options.strategy[strategy_name].calc_lookback.slice(0, d_ma_periods).map(x => x[key]).reverse()
    }
    else {
      var tmpMarket = s.lookback.slice(0, d_ma_periods).map(x => x[key]).reverse()
      tmpMarket.push(s.period[key])
    }

    if (tmpMarket.length >= d_ma_periods) {
      // extract int from string input for ma_type
      let optInMAType = getMaTypeFromString(d_ma_type)

      talib.execute({
        name: 'BBANDS',
        startIdx: tmpMarket.length - 1,
        endIdx: tmpMarket.length - 1,
        inReal: tmpMarket,
        optInTimePeriod: d_ma_periods,  //RSI 14 default
        optInNbDevUp: DevUp, // "Deviation multiplier for upper band" Real Default 2
        optInNbDevDn: DevDn, //"Deviation multiplier for lower band" Real Default 2
        optInMAType: optInMAType // "Type of Moving Average" default 0 

      }, function (err, result) {
        if (err) {
          console.log(err)
          reject(err, result)
          return
        }

        result_bollinger = {
          upperBound: result.result.outRealUpperBand[result.result.outRealUpperBand.length - 1],
          midBound: result.result.outRealMiddleBand[result.result.outRealMiddleBand.length - 1],
          lowerBound: result.result.outRealLowerBand[result.result.outRealLowerBand.length - 1]
        }

        if (strategy_name) {
          s.options.strategy[strategy_name].data.bollinger = result_bollinger
        }

        resolve(result_bollinger)
      })
    }
    else {
      reject('ta_bollinger - MarketLength not populated enough')
    }
  })
}

/**
     * Extract int from string input eg (SMA = 0)
     *
     * @see https://github.com/oransel/node-talib
     * @see https://github.com/markcheno/go-talib/blob/master/talib.go#L20
     */
function getMaTypeFromString(maType) {
  // no constant in lib?

  switch (maType.toUpperCase()) {
    case 'SMA':
      return 0
    case 'EMA':
      return 1
    case 'WMA':
      return 2
    case 'DEMA':
      return 3
    case 'TEMA':
      return 4
    case 'TRIMA':
      return 5
    case 'KAMA':
      return 6
    case 'MAMA':
      return 7
    case 'T3':
      return 8
    default:
      return 0
  }
}
