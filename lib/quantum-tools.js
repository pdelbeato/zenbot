var debug = require('./debug')
	, notify = require('./notify')
	, _ = require('lodash')


// pushMessage: function (title, message, level = 0)
// orderExist: function (signal, sig_kind, position_id)
// orderDelete: function (signal, sig_kind, position_id, cb = function() {})
// orderStatus: function (order, signal, sig_kind, position_id, mode, status, cb = function() {})
// positionFlags: function(position, flags, mode, value, cb = function() {})
// listStrategyOptions: function(strategy_name)
// functionStrategies: function (strategy_function, opts = {}, callbackStrategy = function() {}, callbackFinal = function() {})
// zeroFill: function (width, number, pad)

module.exports = function (s, conf) {
	var notifier = notify(conf)

	s.tools = {
		//Funzione per inviare i messaggi
		pushMessage: function (title, message, level = 0) {
			if (s.options.mode === 'live' || s.options.mode === 'paper')
				notifier.pushMessage(title, message, level)
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

			if (!_.isFunction(callbackStrategy)) {
				callbackStrategy = function (result, strategy_name, strategy_function, cb_resolve_reject) {
					cb_resolve_reject()
				}
			}

			if (!_.isFunction(callbackFinal)) {
				callbackFinal = function (result, strategy_function) {
				}
			}

			Object.keys(s.options.strategy).forEach(function (strategy_name, index, array) {
				if (s.options.strategy[strategy_name].lib[strategy_function]) {
					let tmpPromise = new Promise(function (resolve, reject) {
						s.options.strategy[strategy_name].lib[strategy_function](s, opts, function (err, result) {
							if (err) {
								callbackStrategy(result, strategy_name, strategy_function, function() {
									reject(err)
								})
							}
							else {
								callbackStrategy(result, strategy_name, strategy_function, function() {
									resolve(result)
								})
							}
						})
					})
					strategy_promises.push(tmpPromise)
				}
			})

			Promise.all(strategy_promises)
				.then(function () {
					callbackFinal(null, strategy_function)
				})
				.catch(function (err) {
					callbackFinal(err, strategy_function)
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
		}
	}
}