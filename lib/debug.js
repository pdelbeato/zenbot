const boot = require('../boot')
const moment = require('moment')

let debug = boot.debug
module.exports = {
  flip: function() {
    module.exports.on = debug = !debug
  },
  msg: function(str, data = true) {
    if (debug) {
      if (data)
    	  //console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - ')
    	  process.stdout.write('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - ')
      console.error (str)
    }
  },
  printPosition: function(position, force = false) {
    if (debug || force) {
      console.error(JSON.parse(JSON.stringify(position)))
    }
  },
  on: debug
}
