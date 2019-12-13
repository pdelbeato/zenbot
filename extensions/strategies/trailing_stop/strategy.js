var debug = require('../../../lib/debug')
, { formatPercent } = require('../../../lib/format')
//, z = require('zero-fill')
//, n = require('numbro')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector()


//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['trailing_stop'] = {
//name: 'trailing_stop',
//opts: {							//****** To store options
//	period_calc: '15m',				//****** Execute trailing stop every period_calc time ('null' -> execute every trade)
//	min_periods: 2,		 			//****** Minimum number of history periods (timeframe period_length)
//	order_type: 'taker', 			//****** Order type
//	trailing_stop_enable_pct: 2,	//****** Enable trailing stop when reaching this % profit
//	trailing_stop_pct: 0.5,			//****** Maintain a trailing stop this % below the high-water mark of profit
//},
//data: {							//****** To store calculated data
//	max_trail_profit_position_id: {	//****** Position ids with max trailing profit
//		buy: null,
//		sell: null,
//	}
//},	
//calc_lookback: [],				//****** Old periods for calculation
//calc_close_time: 0,				//****** Close time for strategy period
//lib: {}							//****** To store all the functions of the strategy
//}
//---------------------------------------------
//
//
//position.strategy_parameters.trailing_stop: {
//trailing_stop_limit: null,		//****** Maximum price (long position) / minimum price (short position) reached
//trailing_stop: null,				//****** Lower price (long position) / higher price (short position) to close the position
//}
//---------------------------------------------
//Cambia i colori di cliff
//styles: {                 // Styles applied to stdout
//all:     'cyan',      // Overall style applied to everything
//label:   'underline', // Inspection labels, like 'array' in `array: [1, 2, 3]`
//other:   'inverted',  // Objects which don't have a literal representation, such as functions
//key:     'bold',      // The keys in object literals, like 'a' in `{a: 1}`
//special: 'grey',      // null, undefined...
//string:  'green',
//number:  'magenta',
//bool:    'blue',      // true false
//regexp:  'green',     // /\d+/
//},

//pretty: true,             // Indent object literals
//hideFunctions: false,     // Don't output functions at all
//stream: process.stdout,   // Stream to write to, or null
//maxLength: 2048           // Truncate output if longer

module.exports = {
	name: 'trailing_stop',
	description: 'Trailing Stop strategy',
	noHoldCheck: false,
	
	init: function (s) {
	},
	
	getOptions: function () {
		this.option('trailing_stop', 'period_calc', 'Execute trailing stop every period_calc time', String, '15m')
		this.option('trailing_stop', 'min_periods', 'Min. number of history periods', Number, 2)
		this.option('trailing_stop', 'order_type', 'Order type (maker/taker)', String, 'maker')
		this.option('trailing_stop', 'trailing_stop_enable_pct', 'Enable trailing stop when reaching this % profit', Number, 2)
		this.option('trailing_stop', 'trailing_stop_pct', 'Maintain a trailing stop this % below the high-water mark of profit', Number, 0.5)
	},

	getCommands: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.trailing_stop.opts
		let strat_data = s.options.strategy.trailing_stop.data

		this.command('o', {desc: ('Trailing Stop - List options'.grey), action: function() {
			s.tools.listStrategyOptions('trailing_stop', false)
		}})
		this.command('u', {desc: ('Trailing Stop - Enabling pct'.grey + ' INCREASE'.green), action: function() {
			strat_opts.trailing_stop_enable_pct = Number((strat_opts.trailing_stop_enable_pct + 0.05).toFixed(2))
			console.log('\n' + 'Trailing Stop - Enabling pct' + ' INCREASE'.green + ' -> ' + strat_opts.trailing_stop_enable_pct)
		}})
		this.command('j', {desc: ('Trailing Stop - Enabling pct'.grey + ' DECREASE'.green), action: function() {
			strat_opts.trailing_stop_enable_pct = Number((strat_opts.trailing_stop_enable_pct - 0.05).toFixed(2))
			console.log('\n' + 'Trailing Stop - Enabling pct' + ' DECREASE'.red + ' -> ' + strat_opts.trailing_stop_enable_pct)
		}})
		this.command('i', {desc: ('Trailing Stop - Trailing stop pct'.grey + ' INCREASE'.green), action: function() {
			strat_opts.trailing_stop_pct = Number((strat_opts.trailing_stop_pct + 0.05).toFixed(2))
			console.log('\n' + 'Trailing Stop - Trailing stop pct' + ' INCREASE'.green + ' -> ' + strat_opts.trailing_stop_pct)
		}})
		this.command('k', {desc: ('Trailing Stop - Trailing stop pct'.grey + ' DECREASE'.red), action: function() {
			strat_opts.trailing_stop_pct = Number((strat_opts.trailing_stop_pct - 0.05).toFixed(2))
			console.log('\n' + 'Trailing Stop - Trailing stop pct' + ' DECREASE'.red + ' -> ' + strat_opts.trailing_stop_pct)
		}})
		
		cb()
	},

	onTrade: function (s, opts= {}, cb= function() {}) {
		if (!s.in_preroll) {
			let strat_opts = s.options.strategy.trailing_stop.opts

			let strat_data = s.options.strategy.trailing_stop.data
			let strat = s.options.strategy.trailing_stop

			//Eseguo il controllo su ogni trade solo se non ho specificato period_calc
			if (!strat_opts.period_calc) {
				strat_data.max_trail_profit_position_id = {
					buy: null,
					sell: null,
				}
			
				if (opts.trade) {
					let max_trail_profit = -100
					s.positions.forEach(function (position, index) {
						//Se la posizione non ha ordini aperti in trailing_stop, non è locked in trailing_stop, controllo se il suo profitto ha superato il limite per attivare il trailin stop
						if (!s.tools.positionFlags(position, 'status', 'Check', 'trailing_stop') && !s.tools.positionFlags(position, 'locked', 'Check', 'trailing_stop') && position.profit_net_pct >= strat_opts.trailing_stop_enable_pct) {
							s.tools.positionFlags(position, 'locked', 'Set', 'trailing_stop')
						}

						//Se la posizione ha il flag trailing_stop, aggiorno i valori del trailing stop
						// (E' un nuovo if, e non un else al precedente, perchè così esegue i calcoli anche se la posizione è appena entrata in trailing stop)
						if (s.tools.positionFlags(position, 'locked', 'Check', 'trailing_stop')) {
							if (position.side === 'buy') {
								position.strategy_parameters.trailing_stop.trailing_stop_limit = Math.max(position.strategy_parameters.trailing_stop.trailing_stop_limit || opts.trade.price, opts.trade.price)
								position.strategy_parameters.trailing_stop.trailing_stop = position.strategy_parameters.trailing_stop.trailing_stop_limit - (position.strategy_parameters.trailing_stop.trailing_stop_limit * (strat_opts.trailing_stop_pct / 100))
							}
							else {
								position.strategy_parameters.trailing_stop.trailing_stop_limit = Math.min(position.strategy_parameters.trailing_stop.trailing_stop_limit || opts.trade.price, opts.trade.price)
								position.strategy_parameters.trailing_stop.trailing_stop = position.strategy_parameters.trailing_stop.trailing_stop_limit + (position.strategy_parameters.trailing_stop.trailing_stop_limit * (strat_opts.trailing_stop_pct / 100))
							}
							//Controllo se la posizione sia quella con il maggiore profitto
							if (position.profit_net_pct >= max_trail_profit) {
								max_trail_profit = position.profit_net_pct
								strat_data.max_trail_profit_position_id[position.side] = position.id
//								debug.msg('Strategy Trailing Stop - onTrade - max_trail_profit_position_id.' + position.side + ' = ' + position.id, false)
							}
						} 
					})
				}

				s.positions.forEach(function (position, index) {
					position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
					position_stop = position[position_opposite_signal + '_stop']
					position_locking = (position.locked & ~s.strategyFlag['trailing_stop'])
					if (position.strategy_parameters.trailing_stop.trailing_stop && !position_locking && !s.tools.positionFlags(position, 'status', 'Check', 'trailing_stop') && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position.strategy_parameters.trailing_stop.trailing_stop) < 0)) {
						console.log(('\nStrategy trailing_stop - Profit stop triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').green)
						s.tools.pushMessage('Strategy trailing_stop', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
						s.signal = position.side[0].toUpperCase() + ' Trailing stop';
						let protectionFree = s.protectionFlag['calmdown']
						s.eventBus.emit('trailing_stop', position_opposite_signal, position.id, undefined, undefined, protectionFree, false, (strat_opts.order_type === 'taker' ? true : false))
						position.strategy_parameters.trailing_stop.trailing_stop = null
						position.strategy_parameters.trailing_stop.trailing_stop_limit = null
//						strat_data.max_trail_profit_position_id[position.side] = null
						s.tools.positionFlags(position, 'locked', 'Unset', 'trailing_stop')
						return
					}
//					else {
//						s.signal = null
//					}
				})
			}
		}
		cb()
	},


	onTradePeriod: function (s, opts= {}, cb= function() {}) {
		cb()
	},

	onStrategyPeriod: function (s, opts= {}, cb= function() {}) {
		if (!s.in_preroll) {
			let strat_opts = s.options.strategy.trailing_stop.opts
			let strat_data = s.options.strategy.trailing_stop.data
			let strat = s.options.strategy.trailing_stop

			//Eseguo il controllo ad ogni period_calc solo se è stato specificato, altrimenti il controllo è su ogni trade
			if (strat_opts.period_calc) {
//				debug.msg('trailing_stop strategy - onStrategyPeriod')
				strat_data.max_trail_profit_position_id = {
					buy: null,
					sell: null,
				}
			
				if (strat.calc_lookback[0]) {
					let max_trail_profit = -100
					s.positions.forEach(function (position, index) {
						//Se la posizione non ha ordini aperti in trailing_stop, non è locked in trailing_stop, controllo se il suo profitto ha superato il limite per attivare il trailin stop
						if (!s.tools.positionFlags(position, 'status', 'Check', 'trailing_stop') && !s.tools.positionFlags(position, 'locked', 'Check', 'trailing_stop') && position.profit_net_pct >= strat_opts.trailing_stop_enable_pct) {
							s.tools.positionFlags(position, 'locked', 'Set', 'trailing_stop')
						}

						//Se la posizione ha il flag trailing_stop, aggiorno i valori del trailing stop
						// (E' un nuovo if, e non un else al precedente, perchè così esegue i calcoli anche se la posizione è appena entrata in trailing stop)
						if (s.tools.positionFlags(position, 'locked', 'Check', 'trailing_stop')) {
							if (position.side === 'buy') {
								position.strategy_parameters.trailing_stop.trailing_stop_limit = Math.max(position.strategy_parameters.trailing_stop.trailing_stop_limit || strat.calc_lookback[0].close, strat.calc_lookback[0].close)
								position.strategy_parameters.trailing_stop.trailing_stop = position.strategy_parameters.trailing_stop.trailing_stop_limit - (position.strategy_parameters.trailing_stop.trailing_stop_limit * (strat_opts.trailing_stop_pct / 100))
							}
							else {
								position.strategy_parameters.trailing_stop.trailing_stop_limit = Math.min(position.strategy_parameters.trailing_stop.trailing_stop_limit || strat.calc_lookback[0].close, strat.calc_lookback[0].close)
								position.strategy_parameters.trailing_stop.trailing_stop = position.strategy_parameters.trailing_stop.trailing_stop_limit + (position.strategy_parameters.trailing_stop.trailing_stop_limit * (strat_opts.trailing_stop_pct / 100))
							}
							//Controllo se la posizione sia quella con il maggiore profitto
							if (position.profit_net_pct >= max_trail_profit) {
								max_trail_profit = position.profit_net_pct
								strat_data.max_trail_profit_position_id[position.side] = position.id
//								debug.msg('Strategy Trailing Stop - onStrategyPeriod - max_trail_profit_position_id.' + position.side + ' = ' + position.id, false)
							}
						} 
					})
				}

				s.positions.forEach(function (position, index) {
					position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
					position_stop = position[position_opposite_signal + '_stop']
					position_locking = (position.locked & ~s.strategyFlag['trailing_stop'])
					if (position.strategy_parameters.trailing_stop.trailing_stop && !position_locking && !s.tools.positionFlags(position, 'status', 'Check', 'trailing_stop') && ((position.side == 'buy' ? +1 : -1) * (s.period.close - position.strategy_parameters.trailing_stop.trailing_stop) < 0)) { // && position.profit_net_pct > 0) {
						console.log(('\nStrategy trailing_stop - Profit stop triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').green)
						s.tools.pushMessage('Strategy trailing_stop', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
						s.signal = position.side[0].toUpperCase() + ' Trailing stop';
						let protectionFree = s.protectionFlag['calmdown']
						s.eventBus.emit('trailing_stop', position_opposite_signal, position.id, undefined, undefined, protectionFree, false, (strat_opts.order_type === 'taker' ? true : false))
						position.strategy_parameters.trailing_stop.trailing_stop = null
						position.strategy_parameters.trailing_stop.trailing_stop_limit = null
//						strat_data.max_trail_profit_position_id[position.side] = null
						s.tools.positionFlags(position, 'locked', 'Unset', 'trailing_stop')
						return
					}
//					else {
//						s.signal = null
//					}
				})
			}
		}
		cb()
	},

	onReport: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.trailing_stop.opts
		let strat_data = s.options.strategy.trailing_stop.data

		var cols = []

		if (strat_data.max_trail_profit_position_id.buy != null || strat_data.max_trail_profit_position_id.sell != null) {
			position_buy_profit = -1
			position_sell_profit = -1
			
			if (strat_data.max_trail_profit_position_id.buy != null) {
				let position_buy = s.positions.find(x => x.id === strat_data.max_trail_profit_position_id.buy)
				//Se per qualche arcano motivo (capita ad esempio se mentre vendo, la posizione viene scelta per essere la max_trail_profit_position)
				// la posizione non esiste, è meglio azzerare questa variabile
				if (position_buy) {
					position_buy_profit = position_buy.profit_net_pct/100
				}
				else {
					strat_data.max_trail_profit_position_id.buy = null
				}
			}

			if (strat_data.max_trail_profit_position_id.sell != null) {
				let position_sell = s.positions.find(x => x.id === strat_data.max_trail_profit_position_id.sell)
				//Se per qualche arcano motivo (capita ad esempio se mentre vendo, la posizione viene scelta per essere la max_trail_profit_position)
				// la posizione non esiste, è meglio azzerare questa variabile
				if (position_sell) {
					position_sell_profit = position_sell.profit_net_pct/100
				}
				else {
					strat_data.max_trail_profit_position_id.sell = null
				}
			}

			buysell = (position_buy_profit > position_sell_profit ? 'B' : 'S')
			buysell_profit = (position_buy_profit > position_sell_profit ? formatPercent(position_buy_profit) : formatPercent(position_sell_profit))

			cols.push(s.tools.zeroFill(8, buysell + buysell_profit, ' ')['yellow'])
		}
		else {
			cols.push(s.tools.zeroFill(8, '', ' '))
		}

		cols.forEach(function (col) {
			process.stdout.write(col)
		})
		
		cb()
	},

	onUpdateMessage: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.trailing_stop.opts
		let strat_data = s.options.strategy.trailing_stop.data

		let max_trail_profit_position_id = s.options.strategy.trailing_stop.data.max_trail_profit_position_id
		let side_max_trail_profit = null
		let pct_max_trail_profit = null
		if (max_trail_profit_position_id && max_trail_profit_position_id.buy != null || max_trail_profit_position_id.sell != null) {
			let position = {
				buy: s.positions.find(x => x.id === strat_data.max_trail_profit_position_id.buy),
				sell: s.positions.find(x => x.id === strat_data.max_trail_profit_position_id.sell),
			}
			
			side_max_trail_profit =  ((position.buy ? position.buy.profit_net_pct : -100) > (position.sell ? position.sell.profit_net_pct : -100) ? 'buy' : 'sell')
			pct_max_trail_profit = position[side_max_trail_profit].profit_net_pct
		}
		let result = (side_max_trail_profit ? ('Trailing position: ' + (side_max_trail_profit[0].toUpperCase() + formatPercent(pct_max_trail_profit/100))) : '')
		cb(result)
	},

	onPositionOpened: function (s, opts= {}, cb = function() {}) {
		var position = s.positions.find(x => x.id === opts.position_id)
		position.strategy_parameters.trailing_stop = {
			trailing_stop_limit: null,
			trailing_stop: null,
		}

		cb()
	},

	onPositionUpdated: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	onPositionClosed: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	onOrderExecuted: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	printOptions: function(s, opts= {}, cb = function() {}) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.trailing_stop))
		delete so_tmp.calc_lookback
		delete so_tmp.calc_close_time
		delete so_tmp.lib

		console.log('\n' + inspect(so_tmp))
		cb()
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
		trailing_stop_enable_pct: Phenotypes.Range0(1, 20),
		trailing_stop_pct: Phenotypes.Range(1,20),

		// -- strategy
		size: Phenotypes.Range(1, 40),
	}
}
