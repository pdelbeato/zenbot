const boot = require('../boot')
const moment = require('moment')

let debug = boot.debug
module.exports = {
  flip: function() {
    module.exports.on = debug = !debug
  },
  msg: function(str) {
    if (debug) {
      console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - ' + str)
    }
  },
  printPosition: function(position) {
    if (debug) {
      console.error(JSON.parse(JSON.stringify(position)))
    }
  },
  on: debug
}
