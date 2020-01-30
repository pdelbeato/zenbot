var tulind = require('tulind')


module.exports = function ti_rsi(s, rsi_period,  optMarket) 
{

	return new Promise(function(resolve, reject) {

		//dont calculate until we have enough data

		let tmpMarket = optMarket
		if (!tmpMarket)
		{
//			tmpMarket = s.lookback.slice(0, 1000).map(x=>x.close)
			tmpMarket = s.lookback.slice(0, rsi_period).map(x=>x.close)
			tmpMarket.reverse()
			//add current period
			tmpMarket.push(s.period.close)
		}
		else
		{
			tmpMarket = tmpMarket.map(x=>x.close)
			tmpMarket.reverse()
			tmpMarket.push(s.period.close)
		}

//		if (tmpMarket.length >= rsi_period) {
//			//doublecheck length.
			if (tmpMarket.length >= rsi_period) {
				// extract int from string input for ma_type

				tulind.indicators.rsi.indicator(
						[tmpMarket],
						[rsi_period]
						, function (err, result) {
							if (err) {
//								console.log(err)
								reject(err, result)
								return
							}
							resolve({
								rsi: result[0][0]
							})
						})
			}
			else {
//				console.log('ti_rsi - Market length not populated enough')
				reject('Market Length not populated enough')
			}

//		} else {
//			reject('MarketLength not populated enough')}
	})
}


