process.env['NTBA_FIX_319'] = 1

var TelegramBot = require('node-telegram-bot-api')

module.exports = function telegram (config) {
	var bot = new TelegramBot(config.bot_token, { polling: true })

	var wrapper = function(cb) {
		return function(message) {
			if (message.chat.id != config.chat_id) {
				console.log('\nNotifier - Telegram - Chat ID error: command coming from wrong chat: ' + message.chat.id)
				return
			}
			cb(message.text)
		}
	}

	var telegram = {
		pushMessage: function(title, message) {
			bot.sendMessage(config.chat_id, title + ': ' + message).catch(function (error) {
				console.error('\nNotifiers - Telegram - error: ')
//				console.log(error.response.body) // => { ok: false, error_code: 400, description: 'Bad Request: chat not found' }
				console.log(error)
			})
		},

 		pushMessageMaster: function(title, message) {
 			var bot = new TelegramBot(config.bot_token)

 			if (config.chat_id_master) {
 				bot.sendMessage(config.chat_id_master, title + ': ' + message).catch(function (error) {
 					console.error('\nNotifiers - Telegram - error: ')
 //					console.log(error.response.body) // => { ok: false, error_code: 400, description: 'Bad Request: chat not found' }
 					console.log(error)
 				})
 			}
 		},
 		
		onMessage: function (callback) {
			bot.on('message', wrapper(callback))
			bot.on('webhook_error', (error) => {
				console.log('\nNotifier - Telegram - Webhook error: ' + error.code)
			})
			bot.on('polling_error', (error) => {
				console.log('\nNotifier - Telegram - Polling error: ' + error.code)
			})
			bot.on('error', (error) => {
				console.log('\nNotifier - Telegram - Error: ' + error.code)
			})
		}
	}
	return telegram
}
