var boot = require('../boot')
, moment = require('moment')
, inspect = require('eyes').inspector({maxLength: 10000 })

let debug = boot.debug
module.exports = {
	flip: function() {
		module.exports.on = debug = !debug
	},

	msg: function(str, timestamp = true) {
		if (debug) {
			if (timestamp) {
				process.stdout.write('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - ')
			}			
			console.error (str)
		}
	},

	obj: function(title, object, timestamp = true, forced = false) {
		if (debug || forced) {
			if (timestamp) {
				process.stdout.write('\n' + moment().format('YYYY-MM-DD HH:mm:ss') + ' - ')
			}
			console.log(title)
			try {
//				console.error(JSON.parse(JSON.stringify(obj)))
				console.log(inspect(object))
			}
			catch (err) {
				console.error('debug.obj - Error in inspect: ' + err)
				console.error('object= ' + obj)
			}
		}
	},
	
	on: debug
}
