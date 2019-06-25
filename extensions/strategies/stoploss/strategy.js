var debug = require('../../../lib/debug')
, { formatPercent } = require('../../../lib/format')
, z = require('zero-fill')
//, n = require('numbro')
, Phenotypes = require('../../../lib/phenotype')
, cliff = require('cliff')


//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['stoploss'] = {
//	name: 'stoploss',
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Execute profitstop every period_calc time
//		order_type: 'maker', 		//****** Order type
//		buy_stop_pct: 10,			//****** For a SELL position, buy if price rise above this % of bought price
//		sell_stop_pct: 10,			//****** For a BUY position, sell if price drops below this % of bought price
//	},
//	data: {							//****** To store calculated data
//	},	
//	calc_lookback: [],				//****** Old periods for calculation
//	calc_close_time: 0,				//****** Close time for strategy period
//	lib: {}							//****** To store all the functions of the strategy
//}
//---------------------------------------------


//position.strategy_parameter.stoploss: {
//		buy_stop: null,				**** Buy stop price (short position)
//		sell_stop: null,			**** Sell stop price (long position)
//}

module.exports = {
	name: 'stoploss',
	description: 'Stoploss strategy',

	getOptions: function () {
		this.option('stoploss', 'period_calc', 'calculate closing price every period_calc time', String, '15m')
		this.option('stoploss', 'order_type', 'Order type (maker/taker)', String, 'maker')
		this.option('stoploss', 'buy_stop_pct', 'For a SELL position, buy if price rise above this % of bought price', Number, 10)
		this.option('stoploss', 'sell_stop_pct', 'For a BUY position, sell if price drops below this % of bought price', Number, 10)
	},

	getCommands: function (s, opts = {}) {
		
		this.command('w', {desc: 'provo'.grey, action: function() {
			
			console.log('\nprovo: ' )
		}})
		this.command('W', {desc: 'prova'.grey, action: function() {
			
			console.log('\nprova: ' )
		}})
	},
	
//	onTrade: function (s, opts= {}, cb= function() {}) {
//		cb()
//	},
	

//	onTradePeriod: function (s, opts= {}, cb= function() {}) {
//		cb()
//	},
	
	onStrategyPeriod: function (s, opts= {}, cb= function() {}) {
		let strat_opts = s.options.strategy.stoploss.opts
		
		debug.msg('stoploss strategy - onStrategyPeriod')
		if (s.options.strategy.stoploss.calc_lookback[0].close) {
			s.positions.forEach( function (position, index) {
				position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
				position_stop = position.strategy_parameters.stoploss[position_opposite_signal + '_stop']				

				if (position_stop && !position.locked && !(position.status & s.strategyFlag.stoploss) && ((position.side == 'buy' ? +1 : -1) * (s.options.strategy.stoploss.calc_lookback[0].close - position_stop) < 0)) {
					console.log(('\n' + position_opposite_signal.toUpperCase() + ' stop loss triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').red)
//					pushMessage('Stop Loss Protection', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
//					executeSignal(position_opposite_signal, 'stoploss', position.id, undefined, undefined, false, true)
					s.signal = 'stoploss'
					s.eventBus.emit('stoploss', position_opposite_signal, position.id, undefined, undefined, false, strat_opts.order_type)
				}
				else {
					s.signal = null
				}
			})
		}
		cb()
	},

//	onReport: function (s) {
//	},
	
//	onUpdateMessage: function (s) {
//	},
	
	onPositionOpened: function (s, opts= {}) {
		let strat_opts = s.options.strategy.stoploss.opts
		
		var position = s.positions.find(x => x.id === opts.position_id)
		position.strategy_parameters.stoploss = {}
		position.strategy_parameters.stoploss.buy_stop = (position.side == 'sell' ? n(position.price_open).multiply(1 + strat_opts.buy_stop_pct/100).format(s.product.increment) : null)
		position.strategy_parameters.stoploss.sell_stop = (position.side == 'buy' ? n(position.price_open).multiply(1 - strat_opts.sell_stop_pct/100).format(s.product.increment) : null)
	},
	
	onPositionUpdated: function (s, opts= {}) {
		let strat_opts = s.options.strategy.stoploss.opts

		var position = s.positions.find(x => x.id === opts.position_id)
		
		position.strategy_parameters.stoploss.buy_stop = (position.side == 'sell' ? n(position.price_open).multiply(1 + strat_opts.buy_stop_pct/100).format(s.product.increment) : null)
		position.strategy_parameters.stoploss.sell_stop = (position.side == 'buy' ? n(position.price_open).multiply(1 - strat_opts.sell_stop_pct/100).format(s.product.increment) : null)
	},
//	
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
