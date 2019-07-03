var debug = require('../../../lib/debug')
, { formatPercent } = require('../../../lib/format')
, z = require('zero-fill')
, n = require('numbro')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector()


//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['catching_orders'] = {
//name: 'catching_orders',
//opts: {								//****** To store options
//	catch_order_pct = 0					//****** pct for catch order
//	catch_manual_pct = 10				//****** pct for manual catch order
//	catch_fixed_value = 1000			//****** Currency value for manual catching order
//},
//data: {								//****** To store calculated data
//},	
//calc_lookback: [],					//****** Old periods for calculation
//calc_close_time: 0,					//****** Close time for strategy period
//lib: {}								//****** To store all the functions of the strategy
//}
//---------------------------------------------


//position.strategy_parameters.catching_orders: {
//}

// Cambia i colori di cliff
//styles: {                 // Styles applied to stdout
//    all:     'cyan',      // Overall style applied to everything
//    label:   'underline', // Inspection labels, like 'array' in `array: [1, 2, 3]`
//    other:   'inverted',  // Objects which don't have a literal representation, such as functions
//    key:     'bold',      // The keys in object literals, like 'a' in `{a: 1}`
//    special: 'grey',      // null, undefined...
//    string:  'green',
//    number:  'magenta',
//    bool:    'blue',      // true false
//    regexp:  'green',     // /\d+/
//},
//
//pretty: true,             // Indent object literals
//hideFunctions: false,     // Don't output functions at all
//stream: process.stdout,   // Stream to write to, or null
//maxLength: 2048           // Truncate output if longer

module.exports = {
	name: 'catching_orders',
	description: 'Catching Orders strategy',
	noHoldCheck: true,

	getOptions: function () {
		this.option('catching_orders', 'catch_order_pct', '% for automatic catching orders', Number, 2)
		this.option('catching_orders', 'catch_manual_pct', '% for manual catching order', Number, 10)
		this.option('catching_orders', 'catch_fixed_value', 'Amount of currency for a manual catching order', Number, 0)
	},

	getCommands: function (s, opts = {}) {
		let strat_opts = s.options.strategy.catching_orders.opts
		let strat_data = s.options.strategy.catching_orders.data

		this.command('o', {desc: ('Catching Orders - List options'.grey), action: function() { s.tools.listStrategyOptions('catching_orders')}})
		this.command('b', {desc: ('Catching Orders - Manual catch order '.grey + 'BUY'.green), action: function() {
			console.log('\nCatching Orders - Manual catch '.grey + 'BUY'.green + ' command inserted'.grey)
			let target_price = n(s.quote.bid).multiply(1 - strat_opts.catch_manual_pct/100).format(s.product.increment, Math.floor)
			let target_size = n(strat_opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
			let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
			s.eventBus.emit('catching_orders', 'buy', null, target_size, target_price, protectionFlag)
		}})
		this.command('s', {desc: ('Catching Orders - Manual catch order '.grey + 'SELL'.red), action: function() {
			console.log('\nCatching Orders - Manual catch '.grey + 'SELL'.red + ' command inserted'.grey)
			let target_price = n(s.quote.bid).multiply(1 + strat_opts.catch_manual_pct/100).format(s.product.increment, Math.floor)
			let target_size = n(strat_opts.catch_fixed_value).divide(target_price).format(s.product.asset_increment ? s.product.asset_increment : '0.00000000')
			let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
			s.eventBus.emit('catching_orders', 'sell', null, target_size, target_price, protectionFlag)
		}})
		this.command('+', {desc: ('Catching Orders - Manual catch pct '.grey + 'INCREASE'.green), action: function() {
			strat_opts.catch_manual_pct = Number((strat_opts.catch_manual_pct + 0.5).toFixed(2))
			console.log('\n' + 'Catching Orders - Manual catch order pct ' + 'INCREASE'.green + ' -> ' + strat_opts.catch_manual_pct)
		}})
		this.command('-', {desc: ('Catching Orders - Manual catch pct '.grey + 'DECREASE'.red), action: function() {
			strat_opts.catch_manual_pct = Number((strat_opts.catch_manual_pct - 0.5).toFixed(2))
			if (strat_opts.catch_manual_pctt <= 0) {
				strat_opts.catch_manual_pct = 0
			}
			console.log('\n' + 'Catching Orders - Manual catch order pct ' + 'DECREASE'.red + ' -> ' + strat_opts.catch_manual_pct)
		}})
		this.command('*', {desc: ('Catching Orders - Manual catch value '.grey + 'INCREASE'.green), action: function() {
			strat_opts.catch_fixed_value += s.options.quantum_value
			console.log('\n' + 'Catching Orders - Manual catch order value ' + 'INCREASE'.green + ' -> ' + strat_opts.catch_fixed_value)
		}})
		this.command('_', {desc: ('Catching Orders - Manual catch value '.grey + 'DECREASE'.red), action: function() {
			strat_opts.catch_fixed_value -= s.options.quantum_value
			if (strat_opts.catch_fixed_value < s.options.quantum_value) {
				strat_opts.catch_fixed_value = s.options.quantum_value
			}
			console.log('\n' + 'Catching Orders - Manual catch order value ' + 'DECREASE'.green + ' -> ' + strat_opts.catch_fixed_value)
		}})
		this.command('i', {desc: ('Catching Orders - Catch order pct '.grey + 'INCREASE'.green), action: function() {
			strat_opts.catch_order_pct = Number((strat_opts.catch_order_pct + 0.5).toFixed(2))
			console.log('\n' + 'Catching Orders - Catch order pct ' + 'INCREASE'.green + ' -> ' + strat_opts.catch_order_pct)
		}})
		this.command('k', {desc: ('Catching Orders - Catch order pct '.grey + 'DECREASE'.green), action: function() {
			strat_opts.catch_order_pct = Number((strat_opts.catch_order_pct - 0.5).toFixed(2))
			if (strat_opts.catch_order_pct <= 0) {
				strat_opts.catch_order_pct = 0
			}
			console.log('\n' + 'Catching Orders - Catch order pct ' + 'DECREASE'.green + ' -> ' + strat_opts.catch_order_pct)
		}})
		this.command('C', {desc: ('Catching Orders - Cancel all manual catch orders'.grey), action: function() {
			console.log('\nmCancel'.grey + ' ALL manual catch orders')
			s.tools.orderStatus(undefined, undefined, 'catching_orders', undefined, 'Unset', 'catching_orders')
		}})	
		this.command('A', {desc: ('Catching Orders - Insert catch order for ALL free position'.grey), action: function() {
			if (strat_opts.catch_order_pct > 0) {
				console.log('\n' + 'Catching Orders - Insert catch order for ALL free positions'.grey)
				s.positions.forEach(function (position, index) {
					let position_locking = (position.locked & ~s.strategyFlag['catching_orders'])
					let target_price = null
					
					if (!position_locking && !s.tools.positionFlags(position, 'status', 'Check', 'catching_orders')) {
						let position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
						let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
						if (position.side === 'buy') {
							target_price = n(position.price_open).multiply(1 + strat_opts.catch_order_pct/100).format(s.product.increment, Math.floor)
						}
						else {
							target_price = n(position.price_open).multiply(1 - strat_opts.catch_order_pct/100).format(s.product.increment, Math.floor)
						}
						debug.msg('Strategy catching_orders - Position (' + position.side + ' ' + position.id + ') -> ' + position_opposite_signal.toUpperCase() + ' at ' + target_price + ' (price open= ' + position.price_open + ')')
						s.signal = position_opposite_signal[0].toUpperCase() + ' Catching order'
						s.eventBus.emit('catching_orders', position_opposite_signal, position.id, undefined, target_price, protectionFlag)  
					}
				})
			}
			else {
				console.log('\n' + 'Catching Orders - Catch order pct =< 0!'.red)
			}
		}})
	},

	onTrade: function (s, opts= {}, cb= function() {}) {
		cb()
	},


	onTradePeriod: function (s, opts= {}, cb= function() {}) {
		cb()
	},

	onStrategyPeriod: function (s, opts= {}, cb= function() {}) {
		cb()
	},

	onReport: function (s) {
	},

	onUpdateMessage: function (s) {
	},

	onPositionOpened: function (s, opts= {}) {
//		var opts = {
//			position_id: position_id,
//		};
		
	},

	onPositionUpdated: function (s, opts= {}) {
	},

	onPositionClosed: function (s, opts= {}) {
	},

	onOrderExecuted: function (s, opts= {}) {
//		var opts = {
//		signal: signal,
//		sig_kind: sig_kind,
//		position_id: position_id,
//		};

		let strat_opts = s.options.strategy.catching_orders.opts
		let strat_data = s.options.strategy.catching_orders.data

		if (strat_opts.catch_order_pct > 0) {
			let position = s.positions.find(x => x.id === opts.position_id)
			if (position) {
				let position_locking = (position.locked & ~s.strategyFlag['catching_orders'])
				let target_price = null

				if (!position_locking && !s.tools.positionFlags(position, 'status', 'Check', 'catching_orders')) {
					let position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
					if (position.side === 'buy') {
						target_price = n(position.price_open).multiply(1 + strat_opts.catch_order_pct/100).format(s.product.increment, Math.floor)
					}
					else {
						target_price = n(position.price_open).multiply(1 - strat_opts.catch_order_pct/100).format(s.product.increment, Math.floor)
					}
					debug.msg('Strategy catching_orders - Position (' + position.side + ' ' + position.id + ') -> ' + position_opposite_signal.toUpperCase() + ' at ' + target_price + ' (price open= ' + position.price_open + ')')
					let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
					s.signal = position_opposite_signal[0].toUpperCase() + ' Catching order'
					s.eventBus.emit('catching_orders', position_opposite_signal, position_id, undefined, target_price, protectionFlag)  
				}
			}
		}
	},

	printOptions: function(s) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.stoploss))
		delete so_tmp.calc_lookback
		delete so_tmp.calc_close_time
		delete so_tmp.lib

		console.log('\n' + inspect(so_tmp))
	},

	//TOTALMENTE da sistemare, se dovessero servire
	phenotypes: {
		// -- common
		period_length: Phenotypes.RangePeriod(1, 120, 'm'),
		markdown_buy_pct: Phenotypes.RangeFloat(-1, 5),
		markup_sell_pct: Phenotypes.RangeFloat(-1, 5),
		order_type: Phenotypes.ListOption(['maker', 'taker']),
		sell_stop_pct: Phenotypes.Range0(1, 50),
		buy_stop_pct: Phenotypes.Range0(1, 50),
		profit_stop_enable_pct: Phenotypes.Range0(1, 20),
		profit_stop_pct: Phenotypes.Range(1,20),

		// -- strategy
		size: Phenotypes.Range(1, 40),
	}
}
