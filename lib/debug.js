var boot = require('../boot')
, moment = require('moment')
, inspect = require('eyes').inspector()

let debug = boot.debug
module.exports = {
	flip: function() {
		module.exports.on = debug = !debug
	},

	msg: function(str, timestamp = true) {
		if (debug) {
			if (timestamp)
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
			try {
				console.error(JSON.parse(JSON.stringify(obj)))
			}
			catch (err) {
				console.error('Error in JSON.parse/stringify: ' + err)
				console.error('obj= ' + obj)
			}
		}
	},

	printObject: function(object, force = false) {
		if (debug || force) {
//			console.error(JSON.parse(JSON.stringify(position)))
			console.log(inspect(object))
		}
	},

	on: debug
}
