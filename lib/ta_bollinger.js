var talib = require('talib')

module.exports = function ta_bollinger(s, key = 'close', strategy_name, rsi_periods = 14, DevUp = 2, DevDn = 2, d_ma_type = 'SMA') {
  return new Promise(function (resolve, reject) {
    let tmpMarket = s.options.strategy[strategy_name].calc_lookback

    if (!tmpMarket) {
      tmpMarket = s.lookback.slice(0, 1000)
    }

    //dont calculate until we have enough data
    if (tmpMarket.length >= rsi_periods) {
      tmpMarket = tmpMarket.map(x => x[key])
      tmpMarket.reverse()
      //The current period is added in quantum-engine
//      tmpMarket.push(s.period.close)

      // extract int from string input for ma_type
      let optInMAType = getMaTypeFromString(d_ma_type)
      talib.execute({
        name: 'BBANDS',
        startIdx: tmpMarket.length - 1,
        endIdx: tmpMarket.length - 1,
        inReal: tmpMarket,
        optInTimePeriod: rsi_periods,  //RSI 14 default
        optInNbDevUp: DevUp, // "Deviation multiplier for upper band" Real Default 2
        optInNbDevDn: DevDn, //"Deviation multiplier for lower band" Real Default 2
        optInMAType: optInMAType // "Type of Moving Average" default 0 

      }, function (err, result) {
        if (err) {
          console.log(err)
          reject(err, result)
          return
        }

        s.options.strategy[strategy_name].data.bollinger = {
          upperBound: result.result.outRealUpperBand[result.result.outRealUpperBand.length - 1],
          midBound: result.result.outRealMiddleBand[result.result.outRealMiddleBand.length - 1],
          lowerBound: result.result.outRealLowerBand[result.result.outRealLowerBand.length - 1]
        }

        resolve()
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
