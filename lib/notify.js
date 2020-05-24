const debug = require('./debug')

module.exports = function notifier (conf) {
	var active_notifiers = []
	
	for (var notifier in conf.notifiers) {
		if (conf.notifiers[notifier].on) {
			var notif = require('../extensions/notifiers/${notifier}')(conf.notifiers[notifier])
			notif.notifier_name = notifier

			active_notifiers.push(notif)
			if (conf.notifiers[notifier].interactive) {
				interactive_notifiers.push(notif)
			}
		}
	}

	return {
		pushMessage: function (title, message, level) {
			active_notifiers.forEach((notifier) => {
				if (level <= conf.notifier_lvl) {
					debug.msg('Notify - pushMessage - Sending push message via ${notifier.notifier_name}')
					notifier.pushMessage(conf.name + ': ' + title, message)
				}

//				debug.msg('pushMessage - Sending push Master message via ${notifier}')
				notifier.pushMessageMaster(conf.name + ' Master: ' + title, message)
			})
		},
		onMessage: function (callback) {
			interactive_notifiers.forEach((notifier) => {
				if (conf.debug) {
					console.log('notify - onMessage - Receiving message from ${notifier.notifier_name}')
				}
				notifier.onMessage(callback)
			})
		}
	}
}
