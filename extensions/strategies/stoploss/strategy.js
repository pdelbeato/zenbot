var debug = require('../../../lib/debug')
, { formatPercent } = require('../../../lib/format')
, z = require('zero-fill')
, n = require('numbro')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector()



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


//position.strategy_parameters.stoploss: {
//		buy_stop: null,				**** Buy stop price (short position)
//		sell_stop: null,			**** Sell stop price (long position)
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
	name: 'stoploss',
	description: 'Stoploss strategy',

	getOptions: function () {
		this.option('stoploss', 'period_calc', 'calculate closing price every period_calc time', String, '15m')
		this.option('stoploss', 'order_type', 'Order type (maker/taker)', String, 'maker')
		this.option('stoploss', 'buy_stop_pct', 'For a SELL position, buy if price rise above this % of bought price', Number, 10)
		this.option('stoploss', 'sell_stop_pct', 'For a BUY position, sell if price drops below this % of bought price', Number, 10)
	},

	getCommands: function (s, opts = {}) {
		let strat_opts = s.options.strategy.stoploss.opts
		let strat_data = s.options.strategy.stoploss.data
		
		this.command('u', {desc: ('Stoploss - Buy stop price (short position)'.grey + ' INCREASE'.green), action: function() {
			strat_opts.buy_stop_pct = Number((strat_opts.buy_stop_pct + 0.05).toFixed(2))
			console.log('\n' + 'Stoploss - Buy stop price' + ' INCREASE'.green + ' -> ' + strat_opts.buy_stop_pct)
		}})
		this.command('j', {desc: ('Stoploss - Buy stop price (short position)'.grey + ' DECREASE'.red), action: function() {
			strat_opts.buy_stop_pct = Number((strat_opts.buy_stop_pct - 0.05).toFixed(2))
			console.log('\n' + 'Stoploss - Buy stop price' + ' DECREASE'.red + ' -> ' + strat_opts.buy_stop_pct)
		}})
		this.command('i', {desc: ('Stoploss - Sell stop price (long position)'.grey + ' INCREASE'.green), action: function() {
			strat_opts.sell_stop_pct = Number((strat_opts.sell_stop_pct + 0.05).toFixed(2))
			console.log('\n' + 'Stoploss - Sell stop price' + ' INCREASE'.green + ' -> ' + strat_opts.sell_stop_pct)
		}})
		this.command('k', {desc: ('Stoploss - Sell stop price (long position)'.grey + ' DECREASE'.red), action: function() {
			strat_opts.sell_stop_pct = Number((strat_opts.sell_stop_pct - 0.05).toFixed(2))
			console.log('\n' + 'Stoploss - Sell stop price' + ' DECREASE'.green + ' -> ' + strat_opts.sell_stop_pct)
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

				if (position_stop && !position.locked && !s.tools.positionFlags(position, 'status', 'Check', 'stoploss') && ((position.side == 'buy' ? +1 : -1) * (s.options.strategy.stoploss.calc_lookback[0].close - position_stop) < 0)) {
					console.log(('\n' + position_opposite_signal.toUpperCase() + ' stop loss triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '\n').red)
					s.tools.pushMessage('Stop Loss Protection', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + ')', 0)
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
