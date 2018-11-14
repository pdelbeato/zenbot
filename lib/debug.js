const boot = require('../boot')
const moment = require('moment')

let debug = boot.debug
module.exports = {
  flip: function() {
    module.exports.on = debug = !debug
  },
  
  msg: function(str, timestamp = true) {
    if (debug) {
      if (timestamp)
    	  //console.error('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - ')
    	  process.stdout.write('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - ')
      console.error (str)
    }
  },
  
  obj: function(str, obj, timestamp = true) {
    if (debug) {
      if (timestamp) {
	    	  process.stdout.write('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - ')
      }
      console.error(str)
      try:
    	  console.error(JSON.parse(JSON.stringify(obj)))
      catch:
    	  console.error('Error in JSON.parse/stringify')
    }
  },

  printPosition: function(position, force = false) {
    if (debug || force) {
      console.error(JSON.parse(JSON.stringify(position)))
    }
  },

  on: debug
}
