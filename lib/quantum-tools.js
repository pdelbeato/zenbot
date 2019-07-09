var debug = require('./debug')
, notify = require('./notify')
, z = require('zero-fill')


// pushMessage: function (title, message, level = 0)
// orderExist: function (signal, sig_kind, position_id)
// orderDelete: function (signal, sig_kind, position_id, cb = function() {})
// orderStatus: function (order, signal, sig_kind, position_id, mode, status, cb = function() {})
// positionFlags: function(position, flags, mode, value, cb = function() {})
// listStrategyOptions: function(strategy_name)


module.exports = function(s, conf) {
	//Funzione per inviare i messaggi
	var notifier = notify(conf)

	s.tools = {	
		pushMessage: function (title, message, level = 0) {
			if (s.options.mode === 'live' || s.options.mode === 'paper')
				notifier.pushMessage(title, message, level)
		},

		//Funzione per controllare l'esistenza di un ordine specifico (se si immette un solo parametro, gli altri non entrano nel confronto)
		orderExist: function (signal, sig_kind, position_id) {
			return s.orders.find(x => ((signal != undefined ? (x.signal === signal) : true) && (sig_kind != undefined ? (x.kind === sig_kind) : true) && (position_id != undefined ? (x.id === position_id) : true)))
		},

		//Funzione per cancellare un ordine da s.orders
		orderDelete: function (signal, sig_kind, position_id, cb = function() {}) {
			s.orders.forEach(function (order, index) {
				if ((signal ? order.signal === signal : true) && (sig_kind ? order.kind === sig_kind : true) && (position_id ? order.id === position_id : true)) {
					debug.msg('Quantum-Tools - orderDelete - delete s.orders ' + order.signal + ' ' + order.kind + ' ' + order.id)
					if (sig_kind) {
						s.tools.positionFlags(order.position, 'status', 'Unset', sig_kind)
					}
					else {
						s.tools.positionFlags(order.position, 'status', 'Free')
					}
					s.exchange.cancelOrderCache({order_id: order.order_id, product_id: s.product_id})
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
		orderStatus: function (order, signal, sig_kind, position_id, mode, status, cb = function() {}) {
			if (order) {
				debug.msg('Quantum-Tools - orderStatus - s.orders(' + order.signal + ', ' + order.kind + ', ' + order.id + ') ' + mode + ' ' + status)
				this.positionFlags(order.position, 'status', mode, status)
			}
			else {
				s.orders.forEach(function (order, index) {
					if ((signal ? order.signal === signal : true) && (sig_kind ? order.kind === sig_kind : true) && (position_id ? order.id === position_id : true)) {
						debug.msg('Quantum-Tools - orderStatus - s.orders(' + order.signal + ', ' + order.kind + ', ' + order.id + ').status = ' + mode + ' ' + status)
						s.tools.positionFlags(order.position, 'status', mode, status)
					}
				})
			}
			return cb()
		},

		positionFlags: function(position, flags, mode, value, cb = function() {}) {
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
		
		listStrategyOptions: function(strategy_name) {
			process.stdout.write('\nSTRATEGY'.grey + '\t' + strategy_name + '\t' + (require(`../extensions/strategies/${strategy_name}/strategy`).description).grey + '\n')

			let opts_rows = [];
			Object.keys(s.options.strategy[strategy_name].opts).forEach(function (key, index) {
				opts_rows.push(z(40, key.grey, ' ') + '\t' + s.options.strategy[strategy_name].opts[key])
			})

			opts_rows.forEach(function (row) {
				process.stdout.write(row + '\n')
			})
		},
	}
}