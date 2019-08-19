var talib = require('talib')

module.exports = function ta_linearreg_slope (s, strategy_name, length, source_key) {
	if (!source_key) source_key = 'close';
	
  return new Promise(function(resolve, reject) {
    // create object for talib. only close is used for now but rest might come in handy
//    if (!s.marketData) {
//      s.marketData = { open: [], close: [], high: [], low: [], volume: [] }
//    }
	  let marketData = { open: [], close: [], high: [], low: [], volume: [] }

	  if (s.options.strategy[strategy_name].calc_lookback.length > marketData[source_key].length) {
      for (var i = (s.options.strategy[strategy_name].calc_lookback.length - marketData[source_key].length) - 1; i >= 0; i--) {
        marketData[source_key].push(s.options.strategy[strategy_name].calc_lookback[i].close)
      }

      //dont calculate until we have enough data
      if (marketData[source_key].length >= length) {
        //fillup marketData for talib.
        //this might need improvment for performance.
        //for (var i = 0; i < length; i++) {
        //  s.marketData.close.push(s.lookback[i].close);
        //}
        //fillup marketData for talib.
//        let tmpMarket = s.marketData.close.slice()

        //add current period
        marketData[source_key].push(s.period.close)

        //doublecheck length.
        if (marketData[source_key].length >= length) {
          talib.execute({
            name: 'LINEARREG_SLOPE',
            startIdx: 0,
            endIdx: marketData[source_key].length -1,
            inReal: marketData[source_key],
            optInTimePeriod: length
          }, function (err, result) {
            if (err) {
              console.log(err)
              reject(err, result)
              return
            }

            //Result format: (note: outReal can have multiple items in the array)
            // {
            //   begIndex: 8,
            //   nbElement: 1,
            //   result: { outReal: [ 1820.8621111111108 ] }
            // }
            resolve({
              'outReal': result.result.outReal[(result.nbElement - 1)],
            })
          })
        }
      } else {
        resolve()
      }
    }
  })
}
