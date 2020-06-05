var debug = require('./debug')
	, notify = require('./notify')
	, _ = require('lodash')
	, crypto = require('crypto')
	, tb = require('timebucket')
	, moment = require('moment')


// pushMessage: function (title, message, level = 0)
// orderExist: function (signal, sig_kind, position_id)
// orderDelete: function (signal, sig_kind, position_id, cb = function() {})
// orderStatus: function (order, signal, sig_kind, position_id, mode, status, cb = function() {})
// positionFlags: function (position, flags, mode, value, cb = function() {})
// listStrategyOptions: function (strategy_name)
// functionStrategies: function (strategy_function, opts = {}, callbackStrategy = function() {}, callbackFinal = function() {})
// zeroFill: function (width, number, pad)
// initPeriod: function (period, trade, period_length, callback = function() {})
// updatePeriod: function (period, trade, callback = function() {})


module.exports = function (s, conf) {
	var notifier = notify(conf)

	s.tools = {
		//Funzione per inviare i messaggi
		pushMessage: function (title, message, level = 0) {
			if (s.options.mode === 'live' || s.options.mode === 'paper')
				notifier.pushMessage(title, message, level)
		},

		//Attivazione del polling dei messaggi
		onMessage: function (callback) {
			notifier.onMessage(callback)
		},

		//Funzione per controllare l'esistenza di un ordine specifico (se si immette un solo parametro, gli altri non entrano nel confronto)
		orderExist: function (signal, sig_kind, position_id) {
			return s.orders.find(x => ((signal != undefined ? (x.signal === signal) : true) && (sig_kind != undefined ? (x.kind === sig_kind) : true) && (position_id != undefined ? (x.id === position_id) : true)))
		},

		//Funzione per cancellare un ordine da s.orders
		orderDelete: function (signal, sig_kind, position_id, cb = function () { }) {
			s.orders.forEach(function (order, index) {
				if ((signal ? order.signal === signal : true) && (sig_kind ? order.kind === sig_kind : true) && (position_id ? order.id === position_id : true)) {
					debug.msg('Quantum-Tools - orderDelete - delete s.orders ' + order.signal + ' ' + order.kind + ' ' + order.id)
					if (sig_kind) {
						s.tools.positionFlags(order.position, 'status', 'Unset', sig_kind)
					}
					else {
						s.tools.positionFlags(order.position, 'status', 'Free')
					}
					s.exchange.cancelOrderCache({ order_id: order.order_id, product_id: s.product_id })
					s.orders.splice(index, 1)
					//debug.printObject(s.positions)
				}
			})
			return cb()
		},

		// Da controllare se con le modifiche fatte, il problema seguente è risolto.
		// Setta a canceled lo status della posizione, quindi con canceled dovrebbe cancellare il catch, ma fa prima l'ordine standard ad andare
		// a fallimento, quindi cancella l'ordine standard, settando la posizione a free, quindi il checkorder dell'ordine catch trova free
		// e non canceled, quindi non cancella una mazza e l'ordine rimane in piedi.

		//Funzioni per configurare lo status di uno o più posizioni connesse agli ordini (Set, Unset, Free, Check)
		orderStatus: function (order, signal, sig_kind, position_id, mode, status, cb = function () { }) {
			if (order) {
				debug.msg('Quantum-Tools - orderStatus - s.orders(' + order.signal + ', ' + order.kind + ', ' + order.id + ') ' + mode + ' ' + status)
				this.positionFlags(order.position, 'status', mode, status)
			}
			else {
				s.orders.forEach(function (order_tmp, index) {
					if ((signal ? order_tmp.signal === signal : true) && (sig_kind ? order_tmp.kind === sig_kind : true) && (position_id ? order_tmp.id === position_id : true)) {
						debug.msg('Quantum-Tools - orderStatus - s.orders(' + order_tmp.signal + ', ' + order_tmp.kind + ', ' + order_tmp.id + ').status = ' + mode + ' ' + status)
						s.tools.positionFlags(order_tmp.position, 'status', mode, status)
					}
				})
			}
			return cb()
		},

		positionFlags: function (position, flags, mode, value, cb = function () { }) {
			switch (mode) {
				case 'Set': {
					debug.msg('Quantum-Tools - positionFlags - position ' + position.id + ' ' + flags + '= ' + position[flags] + ' -> (Set ' + value + ') -> ' + (position[flags] | s.strategyFlag[value]))
					position[flags] = (position[flags] | s.strategyFlag[value])
					return cb()
					break
				}
				case 'Unset': {
					debug.msg('Quantum-Tools - positionFlags - position ' + position.id + ' ' + flags + '= ' + position[flags] + ' -> (Unset ' + value + ') -> ' + (position[flags] & ~s.strategyFlag[value]))
					position[flags] = (position[flags] & ~s.strategyFlag[value])
					return cb()
					break
				}
				case 'Free': {
					debug.msg('Quantum-Tools - positionFlags - position ' + position.id + ' ' + flags + '= ' + position[flags] + ' -> (Free) -> ' + s.strategyFlag.free)
					position[flags] = s.strategyFlag.free
					return cb()
					break
				}
				case 'Check': {
					//				debug.msg('positionFlags - position ' + position.id + ' ' + flags + ' Check ' + value + ' (position[flags]= ' + position[flags] + ')')
					return (position[flags] & s.strategyFlag[value])
				}
			}
		},

		listStrategyOptions: function (strategy_name, only_opts = false) {
			let so_tmp = JSON.parse(JSON.stringify(s.options.strategy[strategy_name]))
			delete so_tmp.calc_lookback
			delete so_tmp.calc_close_time
			delete so_tmp.lib

			if (only_opts) {
				delete so_tmp.data
			}

			let title_tmp = ('\nSTRATEGY'.grey + '\t' + strategy_name + '\t' + s.options.strategy[strategy_name].lib.description.grey + '\n') //(require(`../extensions/quantum_strategies/${strategy_name}/strategy`).description).grey + '\n')
			debug.obj(title_tmp, so_tmp, false, true)
		},

		//Funzione per eseguire un metodo di ogni strategia, con i callback per strategia e finale
		functionStrategies: function (strategy_function, opts = {}, callbackStrategy, callbackFinal) {
			let strategy_promises = []
			let nice_errors = new RegExp(/(nice|good)/)

			if (!_.isFunction(callbackStrategy)) {
				callbackStrategy = function (result, strategy_name, strategy_function, cb_resolve_reject) {
					cb_resolve_reject()
				}
			}

			if (!_.isFunction(callbackFinal)) {
				callbackFinal = function (err) {
					if (err) {
						console.error('\ns.tools.functionStrategies - callbackFinal - Error: ' + err)
					}
				}
			}

			Object.keys(s.options.strategy).forEach(function (strategy_name, index, array) {
				if (s.options.strategy[strategy_name].lib[strategy_function]) {
					let tmpPromise = new Promise(function (resolve, reject) {
						s.options.strategy[strategy_name].lib[strategy_function](s, opts, function (err, result) {
							if (err) {
								if (err.match(nice_errors)) {
									// callbackStrategy(result, strategy_name, strategy_function, function () {
										console.error('\nquantum-tools - ' + strategy_name + ' ' + strategy_function + ': error= ' + err)
										resolve(err)
									// })
								}
								else {
									// callbackStrategy(result, strategy_name, strategy_function, function () {
										console.error('\nquantum-tools - ' + strategy_name + ' ' + strategy_function + ': error= ' + err)
										reject(err)
									// })
								}
							}
							else {
								callbackStrategy(result, strategy_name, strategy_function, function () {
									resolve()
								})
							}
						})
					})
					strategy_promises.push(tmpPromise)
				}
			})

			Promise.all(strategy_promises)
				.then(function () {
					callbackFinal(null)
				})
				.catch(function (err) {
					callbackFinal(err)
				})
		},

		//Funzione per fare zero-padding
		zeroFill: function (width, number, pad) {
			if (pad === undefined) {
				pad = '0'
			}
			width -= number.toString().length
			if (width > 0) {
				return (new Array(width + 1).join(pad) + number)
			}
			return (number + '')
		},

		//Inizializza period con i dati di trade
		initPeriod: function (period, trade, period_length, callback = function() {}) {
			let d = tb(trade.time).resize(period_length)
			let de = tb(trade.time).resize(period_length).add(1)

			period.id = period._id = crypto.randomBytes(4).toString('hex')
			period.selector = s.options.selector.normalized
			period.period_id = d.toString()
			period.size = period_length
			period.time = d.toMilliseconds()
			period.human_time = moment(d.toMilliseconds()).format('YYYY-MM-DD HH:mm')
			period.open = trade.price
			period.high = trade.price
			period.low = trade.price
			period.close = trade.price
			period.volume = 0
			period.close_time = (de.toMilliseconds() - 1)
			period.latest_trade_time = trade.time

			callback()
		},

		//Aggiorna i dati di period con quelli di trade
		updatePeriod: function (period, trade, callback = function() {}) {
			//debug.msg('updatePeriod')
			period.high = Math.max(trade.price, period.high)
			period.low = Math.min(trade.price, period.low)
			period.close = trade.price
			period.volume += trade.size
			period.latest_trade_time = trade.time

			callback()
		}
	}
}