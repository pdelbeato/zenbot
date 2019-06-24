var debug = require('../../../lib/debug')
, { formatPercent } = require('../../../lib/format')
, z = require('zero-fill')
//, n = require('numbro')
, Phenotypes = require('../../../lib/phenotype')
, cliff = require('cliff')


//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['trailing_stop'] = {
//	name: 'trailing_stop',
//	opts: {								//****** To store options
//		period_calc: '15m',				//****** Execute trailing stop every period_calc time
//		order_type: 'taker', 			//****** Order type
//		trailing_stop_enable_pct: 2,	//****** Enable trailing stop when reaching this % profit
//		trailing_stop_pct: 0.5,			//****** Maintain a trailing stop this % below the high-water mark of profit
//	},
//	data: {								//****** To store calculated data
//		max_trail_profit_position: {	//****** Positions with max trailing profit
//			buy: null,
//			sell: null,
//		}
//	},	
//	calc_lookback: [],					//****** Old periods for calculation
//	calc_close_time: 0,					//****** Close time for strategy period
//	lib: {}								//****** To store all the functions of the strategy
//}
//---------------------------------------------


//position.strategy_parameter.trailing_stop: {
//		trailing_stop_limit: null,		**** Maximum price (long position) / minimum price (short position) reached
//		trailing_stop: null,			**** Lower price (long position) / higher price (short position) to close the position
//}

module.exports = {
	name: 'trailing_stop',
	description: 'Trailing Stop strategy',

	getOptions: function () {
		this.option('trailing_stop', 'period_calc', 'Execute trailing stop every period_calc time', String, '15m')
		this.option('trailing_stop', 'order_type', 'Order type (maker/taker)', String, 'maker')
		this.option('trailing_stop', 'trailing_stop_enable_pct', 'Enable trailing stop when reaching this % profit', Number, 2)
		this.option('trailing_stop', 'trailingt_stop_pct', 'Maintain a trailing stop this % below the high-water mark of profit', Number, 0.5)
	},

//	onTrade: function (s, opts= {}, cb= function() {}) {
//		cb()
//	},


	onTradePeriod: function (s, opts= {}, cb= function() {}) {
		let strat_opts = s.options.strategy.trailing_stop.opts
		let strat_data = s.options.strategy.trailing_stop.data
		
		if (opts.trade) {
			let max_trail_profit = -100
			s.positions.forEach( function (position, index) {
				if (position.profit_net_pct >= strat_opts.profit_stop_enable_pct) {
					position.strategy_parameters.trailing_stop.trailing_stop_limit = (position.side === 'buy' ? (Math.max(position.strategy_parameters.trailing_stop.trailing_stop_limit || opts.trade.price, opts.trade.price)) : (Math.min(position.strategy_parameters.trailing_stop.trailing_stop_limit || opts.trade.price, opts.trade.price)))
					position.strategy_parameters.trailing_stop.trailing_stop = position.strategy_parameters.trailing_stop.trailing_stop_limit + (position.side === 'buy' ? -1 : +1) * (position.strategy_parameters.trailing_stop.trailing_stop_limit * (strat_opts.trailing_stop_pct / 100))
					if (position.profit_net_pct >= max_trail_profit) {
						max_trail_profit = position.profit_net_pct
						strat_data.max_trail_profit_position[position.side] = position
//						debug.msg('updatePositions - max_profit_position_id.trail.' + position.side + ' = ' + position.id, false)
					}
				} 
			}
		}
		cb()
	},
	
	onStrategyPeriod: function (s, opts= {}, cb= function() {}) {
		let strat_opts = s.options.strategy.trailing_stop.opts
		let strat_data = s.options.strategy.trailing_stop.data
		
		debug.msg('trailing_stop strategy - onStrategyPeriod')
//		if (s.options.strategy.trailing_stop.calc_lookback[0].close) {
//		s.positions.forEach( function (position, index) {
//		position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
//		position_stop = position[position_opposite_signal + '_stop']				

//		if (position_stop && !position.locked && !(position.status & s.orderFlag.stoploss) && ((position.side == 'buy' ? +1 : -1) * (s.options.strategy.stoploss.calc_lookback[0].close - position_stop) < 0)) {
//		console.log(('\n' + position_opposite_signal.toUpperCase() + ' stop loss triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').red)
////		pushMessage('Stop Loss Protection', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
////		executeSignal(position_opposite_signal, 'stoploss', position.id, undefined, undefined, false, true)
//			s.eventBus.emit('stoploss', position_opposite_signal, position.id, undefined, undefined, false, s.options.strategy.stoploss.opts.order_type)
//		}
//		})
//		}
		s.positions.forEach( function (position, index) {
			position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
			position_stop = position[position_opposite_signal + '_stop']
			if (position.strategy_parameters.trailing_stop.profit_stop && !position.locked && !positionFlags(position, 'status', 'Check', 'trailstop') && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position.strategy_parameters.trailing_stop.profit_stop) < 0)) { // && position.profit_net_pct > 0) {
				console.log(('\nStrategy trailing_stop - Profit stop triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').green)
				pushMessage('Strategy trailing_stop', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
				s.signal = 'trailing stop'
				executeSignal(position_opposite_signal, 'trailstop', position.id, undefined, undefined, false, false)
				position.strategy_parameters.trailing_stop.profit_stop = null
				position.strategy_parameters.trailing_stop.profit_stop_limit = null
				return
			}
			else {
				s.signal = null
			}
		}
		cb()
	},

	onReport: function (s) {
		let strat_opts = s.options.strategy.trailing_stop.opts
		let strat_data = s.options.strategy.trailing_stop.data
		
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
		let strat_opts = s.options.strategy.trailing_stop.opts
		let strat_data = s.options.strategy.trailing_stop.data
		
		let max_profit_positions = s.options.strategy.trailing_stop.data.max_profit_position
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
		position.strategy_parameters.trailing_stop = {
			trailing_stop_limit: null,
			trailing_stop: null,
		}
		
	},
	
	onPositionUpdated: function (s, opts= {}) {
	},
	
//	onPositionClosed: function (s, opts= {}) {
//	},
//	
//	onOrderExecuted: function (s, signal, position_id) {
//	},
	
	printOptions: function(s) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.stoploss))
		delete so_tmp.calc_lookback
		delete so_tmp.calc_close_time
		delete so_tmp.lib
		
		console.log('\n' + cliff.inspect(so_tmp))
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
