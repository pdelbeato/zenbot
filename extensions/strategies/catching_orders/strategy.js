var debug = require('../../../lib/debug')
, { formatPercent } = require('../../../lib/format')
, z = require('zero-fill')
//, n = require('numbro')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector()


//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['catching_orders'] = {
//name: 'catching_orders',
//opts: {								//****** To store options
//order_type: 'taker', 			//****** Order type
//catching_orders_enable_pct: 2,	//****** Enable Catching Orders when reaching this % profit
//catching_orders_pct: 0.5,			//****** Maintain a Catching Orders this % below the high-water mark of profit
//},
//data: {								//****** To store calculated data
//max_trail_profit_position: {	//****** Positions with max trailing profit
//buy: null,
//sell: null,
//}
//},	
//calc_lookback: [],					//****** Old periods for calculation
//calc_close_time: 0,					//****** Close time for strategy period
//lib: {}								//****** To store all the functions of the strategy
//}
//---------------------------------------------


//position.strategy_parameters.catching_orders: {
//	catching_orders_limit: null,				//**** Maximum price (long position) / minimum price (short position) reached
//	catching_orders: null,					//**** Lower price (long position) / higher price (short position) to close the position
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

	getOptions: function () {
		this.option('catching_orders', 'period_calc', 'Execute Catching Orders every period_calc time', String, '15m')
		this.option('catching_orders', 'order_type', 'Order type (maker/taker)', String, 'maker')
		this.option('catching_orders', 'catching_orders_enable_pct', 'Enable Catching Orders when reaching this % profit', Number, 2)
		this.option('catching_orders', 'trailingt_stop_pct', 'Maintain a Catching Orders this % below the high-water mark of profit', Number, 0.5)
	},

	getCommands: function (s, opts = {}) {
		let strat_opts = s.options.strategy.catching_orders.opts
		let strat_data = s.options.strategy.catching_orders.data

		this.command('o', {desc: ('Catching Orders - List options'.grey), action: function() { listOptions ()}})
		this.command('u', {desc: ('Catching Orders - Enabling pct'.grey + ' INCREASE'.green), action: function() {
			strat_opts.catching_orders_enable_pct = Number((strat_opts.catching_orders_enable_pct + 0.05).toFixed(2))
			console.log('\n' + 'Catching Orders - Enabling pct' + ' INCREASE'.green + ' -> ' + strat_opts.catching_orders_enable_pct)
		}})
		this.command('j', {desc: ('Catching Orders - Enabling pct'.grey + ' DECREASE'.green), action: function() {
			strat_opts.catching_orders_enable_pct = Number((strat_opts.catching_orders_enable_pct - 0.05).toFixed(2))
			console.log('\n' + 'Catching Orders - Enabling pct' + ' DECREASE'.red + ' -> ' + strat_opts.catching_orders_enable_pct)
		}})
		this.command('i', {desc: ('Catching Orders - Catching Orders pct'.grey + ' INCREASE'.green), action: function() {
			strat_opts.catching_orders_pct = Number((strat_opts.catching_orders_pct + 0.05).toFixed(2))
			console.log('\n' + 'Catching Orders - Catching Orders pct' + ' INCREASE'.green + ' -> ' + strat_opts.catching_orders_pct)
		}})
		this.command('k', {desc: ('Catching Orders - Catching Orders pct'.grey + ' DECREASE'.red), action: function() {
			strat_opts.catching_orders_pct = Number((strat_opts.catching_orders_pct - 0.05).toFixed(2))
			console.log('\n' + 'Catching Orders - Catching Orders pct' + ' DECREASE'.red + ' -> ' + strat_opts.catching_orders_pct)
		}})
	},

	onTrade: function (s, opts= {}, cb= function() {}) {
		let strat_opts = s.options.strategy.catching_orders.opts
		let strat_data = s.options.strategy.catching_orders.data
		let strat = s.options.strategy.catching_orders
		
		if (!strat_opts.period_calc) {
			if (opts.trade) {
				let max_trail_profit = -100
				s.positions.forEach(function (position, index) {
					if (position.profit_net_pct >= strat_opts.profit_stop_enable_pct) {
						position.strategy_parameters.catching_orders.catching_orders_limit = (position.side === 'buy' ? (Math.max(position.strategy_parameters.catching_orders.catching_orders_limit || opts.trade.price, opts.trade.price)) : (Math.min(position.strategy_parameters.catching_orders.catching_orders_limit || opts.trade.price, opts.trade.price)))
						position.strategy_parameters.catching_orders.catching_orders = position.strategy_parameters.catching_orders.catching_orders_limit + (position.side === 'buy' ? -1 : +1) * (position.strategy_parameters.catching_orders.catching_orders_limit * (strat_opts.catching_orders_pct / 100))
						position.locked = s.tools.positionFlags(position, 'locked', 'Set', 'catching_orders')
						if (position.profit_net_pct >= max_trail_profit) {
							max_trail_profit = position.profit_net_pct
							strat_data.max_trail_profit_position[position.side] = position
							debug.msg('Strategy Catching Orders - onTrade - max_profit_position_id.trail.' + position.side + ' = ' + position.id, false)
						}
					} 
				})
			}

			s.positions.forEach(function (position, index) {
				position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
				position_stop = position[position_opposite_signal + '_stop']
				position_locking = (position.locked & ~s.strategyFlag['catching_orders'])
				if (position.strategy_parameters.catching_orders.profit_stop && !position_locking && !s.tools.positionFlags(position, 'status', 'Check', 'trailstop') && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position.strategy_parameters.catching_orders.profit_stop) < 0)) { // && position.profit_net_pct > 0) {
					console.log(('\nStrategy catching_orders - Profit stop triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').green)
					s.tools.pushMessage('Strategy catching_orders', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
					s.signal = 'Catching Orders';
					s.eventBus.emit('stoploss', position_opposite_signal, position.id, undefined, undefined, false, false)
					position.strategy_parameters.catching_orders.profit_stop = null
					position.strategy_parameters.catching_orders.profit_stop_limit = null
					strat_data.max_trail_profit_position[position.side] = null
					return
				}
				else {
					s.signal = null
				}
			})
			cb()
		}
	},


	onTradePeriod: function (s, opts= {}, cb= function() {}) {
	cb()
	},

	onStrategyPeriod: function (s, opts= {}, cb= function() {}) {
		let strat_opts = s.options.strategy.catching_orders.opts
		let strat_data = s.options.strategy.catching_orders.data
		let strat = s.options.strategy.catching_orders
		
		if (strat_opts.period_calc) {
			debug.msg('catching_orders strategy - onStrategyPeriod')

			if (strat.calc_lookback[0]) {
				let max_trail_profit = -100
				s.positions.forEach(function (position, index) {
					if (position.profit_net_pct >= strat_opts.profit_stop_enable_pct) {
						position.strategy_parameters.catching_orders.catching_orders_limit = (position.side === 'buy' ? (Math.max(position.strategy_parameters.catching_orders.catching_orders_limit || strat.calc_lookback[0].close, strat.calc_lookback[0].close)) : (Math.min(position.strategy_parameters.catching_orders.catching_orders_limit || strat.calc_lookback[0].close, strat.calc_lookback[0].close)))
						position.strategy_parameters.catching_orders.catching_orders = position.strategy_parameters.catching_orders.catching_orders_limit + (position.side === 'buy' ? -1 : +1) * (position.strategy_parameters.catching_orders.catching_orders_limit * (strat_opts.catching_orders_pct / 100))
						position.locked = s.tools.positionFlags(position, 'locked', 'Set', 'catching_orders')
						if (position.profit_net_pct >= max_trail_profit) {
							max_trail_profit = position.profit_net_pct
							strat_data.max_trail_profit_position[position.side] = position
							debug.msg('Strategy Catching Orders - onStrategyPeriod - max_profit_position_id.trail.' + position.side + ' = ' + position.id, false)
						}
					} 
				})
			}

			s.positions.forEach(function (position, index) {
				position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
				position_stop = position[position_opposite_signal + '_stop']
				position_locking = (position.locked & ~s.strategyFlag['catching_orders'])
				if (position.strategy_parameters.catching_orders.profit_stop && !position_locking && !s.tools.positionFlags(position, 'status', 'Check', 'trailstop') && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position.strategy_parameters.catching_orders.profit_stop) < 0)) { // && position.profit_net_pct > 0) {
					console.log(('\nStrategy catching_orders - Profit stop triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').green)
					s.tools.pushMessage('Strategy catching_orders', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
					s.signal = 'Catching Orders';
					s.eventBus.emit('stoploss', position_opposite_signal, position.id, undefined, undefined, false, false)
					position.strategy_parameters.catching_orders.profit_stop = null
					position.strategy_parameters.catching_orders.profit_stop_limit = null
					strat_data.max_trail_profit_position[position.side] = null
					return
				}
				else {
					s.signal = null
				}
			})
			cb()
		}
	},

	onReport: function (s) {
		let strat_opts = s.options.strategy.catching_orders.opts
		let strat_data = s.options.strategy.catching_orders.data

		var cols = []

		if (strat_data.max_trail_profit_position.buy != null || strat_data.max_trail_profit_position.sell != null) {
			position_buy_profit = -1
			position_sell_profit = -1

			if (strat_data.max_trail_profit_position.buy != null)
				position_buy_profit = strat_data.max_trail_profit_position.buy.profit_net_pct/100;

			if (strat_data.max_trail_profit_position.buy != null)	
				position_sell_profit = strat_data.max_trail_profit_position.sell.profit_net_pct/100;

			buysell = (position_buy_profit > position_sell_profit ? 'B' : 'S')
			buysell_profit = (position_buy_profit > position_sell_profit ? formatPercent(position_buy_profit) : formatPercent(position_sell_profit))

			cols.push(z(8, buysell + buysell_profit, ' ')['yellow'])
		}
		else {
			cols.push(z(8, '', ' '))
		}

		cols.forEach(function (col) {
			process.stdout.write(col)
		})
	},

	onUpdateMessage: function (s) {
		let strat_opts = s.options.strategy.catching_orders.opts
		let strat_data = s.options.strategy.catching_orders.data

		let max_profit_positions = s.options.strategy.catching_orders.data.max_profit_position
		let side_max_profit = null
		let pct_max_profit = null
		if (max_profit_positions.buy != null || max_profit_positions.sell != null) {
			side_max_profit =  ((max_profit_positions.buy ? max_profit_positions.buy.profit_net_pct : -100) > (max_profit_positions.sell ? max_profit_positions.sell.profit_net_pct : -100) ? 'buy' : 'sell')
			pct_max_profit = max_profit_positions[side_max_profit].profit_net_pct
		}

		return (side_max_profit ? ('\nTrailing position: ' + (side_max_profit[0].toUpperCase() + formatPercent(pct_max_profit/100))) : '') 
	},

	onPositionOpened: function (s, opts= {}) {
		var position = s.positions.find(x => x.id === opts.position_id)
		position.strategy_parameters.catching_orders = {
			catching_orders_limit: null,
			catching_orders: null,
		}

	},

	onPositionUpdated: function (s, opts= {}) {
	},

	onPositionClosed: function (s, opts= {}) {
	},

	onOrderExecuted: function (s, signal, position_id) {
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
