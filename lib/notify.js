const debug = require('./debug')

module.exports = function notifier (conf) {
	var active_notifiers = []
	for (var notifier in conf.notifiers) {
		if (conf.notifiers[notifier].on) {
			active_notifiers.push(require(`../extensions/notifiers/${notifier}`)(conf.notifiers[notifier]))
		}
	}

	return {
		pushMessage: function (title, message, level) {
			active_notifiers.forEach((notifier) => {
				if (level <= conf.notifier_lvl) {
					debug.msg('pushMessage - Sending push message via ${notifier}')
					notifier.pushMessage(conf.name + ': ' + title, message)
				}

				debug.msg('pushMessage - Sending push Master message via ${notifier}')
				notifier.pushMessageMaster(conf.name + ' Master: ' + title, message
			})
		}
	}
}
