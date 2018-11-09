// Bollinger Bands
var bollingerbands = require('bollinger-bands')
module.exports = function bollinger (s, key, length, source_key, time) {
  if (!source_key) source_key = 'close'
  //if (!period_calc) period_calc = 1

  // if (s.lookback.length > length) {
  //   let data = []
  //   for (var i=length-1; i>=0; i--) {
  //     data.push(s.lookback[i][source_key])
  //   }
  //   let result = bollingerbands(data, length, s.options.bollinger_time)
  //   s.period[key] = result
  
  if (s.calc_lookback.length > length) {
    let data = []
    for (var i=s.calc_lookback.length-1; i>=0; i--) {
    // for (var i=length-1; i>=0; i--) {
      data.push(s.calc_lookback[i][source_key])
    }
    let result = bollingerbands(data, length, time)
    s.period[key] = result
  }
}
