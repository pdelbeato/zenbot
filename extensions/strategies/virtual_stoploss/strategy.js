var debug = require('../../../lib/debug')
, { formatPercent, formatCurrency } = require('../../../lib/format')
, z = require('zero-fill')
, n = require('numbro')
, Phenotypes = require('../../../lib/phenotype')
, inspect = require('eyes').inspector()



//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['virtual_stoploss'] = {
//	name: 'virtual_stoploss',
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Execute profitstop every period_calc time
//		min_periods: 2, 			//****** Minimum number of history periods (timeframe period_length)
//		virtual_buy_stop_pct: 10,	//****** For a SELL position, buy if price rise above this % of bought price
//		virtual_sell_stop_pct: 10,	//****** For a BUY position, sell if price drops below this % of bought price
//	},
//	data: {							//****** To store calculated data
//	},	
//	calc_lookback: [],				//****** Old periods for calculation
//	calc_close_time: 0,				//****** Close time for strategy period
//	lib: {}							//****** To store all the functions of the strategy
//}
//---------------------------------------------


//position.strategy_parameters.virtual_stoploss: {
//		virtual_buy_stop: null,							**** Buy stop price (short position)
//		virtual_sell_stop: null,						**** Sell stop price (long position)
//		original_price_open: null,				**** Original open price
//		original_profit_gross_pct: null,		**** Gross profit calculated with open price
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
	name: 'virtual_stoploss',
	description: 'Virtual Stoploss strategy',
	noHoldCheck: false,
	
	getOptions: function () {
		this.option('virtual_stoploss', 'period_calc', 'calculate closing price every period_calc time', String, '15m')
		this.option('virtual_stoploss', 'min_periods', 'Min. number of history periods', Number, 2)
		this.option('virtual_stoploss', 'buy_virtual_stop_pct', 'For a SELL position, adjust open price if price rise above this % of bought price', Number, 10)
		this.option('virtual_stoploss', 'sell_virtual_stop_pct', 'For a BUY position, adjust open price if price drops below this % of bought price', Number, 10)
	},

	getCommands: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.virtual_stoploss.opts
		let strat_data = s.options.strategy.virtual_stoploss.data
		
		this.command('o', {desc: ('Virtual Stoploss - List options'.grey), action: function() { s.tools.listStrategyOptions('virtual_stoploss')}})
		this.command('i', {desc: ('Virtual Stoploss - Get information on the position '.grey + s.positions_index), action: function() {
			if (s.positions_index != null) {
				console.log('\nVirtual Stoploss - Information on position: '.yellow + s.positions[s.positions_index].id)
				console.log(inspect(s.positions[s.positions_index]))
			}
			else {
				console.log('No position in control.')
			}
		}})
		this.command('u', {desc: ('Virtual Stoploss - Virtual buy stop price (short position)'.grey + ' INCREASE'.green), action: function() {
			strat_opts.virtual_buy_stop_pct = Number((strat_opts.virtual_buy_stop_pct + 0.05).toFixed(2))
			console.log('\nVirtual Stoploss - Virtual buy stop price'.yellow + ' INCREASE'.green + ' -> ' + strat_opts.virtual_buy_stop_pct)
		}})
		this.command('j', {desc: ('Virtual Stoploss - Virtual buy stop price (short position)'.grey + ' DECREASE'.red), action: function() {
			strat_opts.virtual_buy_stop_pct = Number((strat_opts.virtual_buy_stop_pct - 0.05).toFixed(2))
			console.log('\nVirtual Stoploss - Virtual buy stop price'.yellow + ' DECREASE'.red + ' -> ' + strat_opts.virtual_buy_stop_pct)
		}})
		this.command('U', {desc: ('Virtual Stoploss - Virtual sell stop price (long position)'.grey + ' INCREASE'.green), action: function() {
			strat_opts.virtual_sell_stop_pct = Number((strat_opts.virtual_sell_stop_pct + 0.05).toFixed(2))
			console.log('\nVirtual Stoploss - Virtual sell stop price'.yellow + ' INCREASE'.green + ' -> ' + strat_opts.virtual_sell_stop_pct)
		}})
		this.command('J', {desc: ('Virtual Stoploss - Virtual sell stop price (long position)'.grey + ' DECREASE'.red), action: function() {
			strat_opts.virtual_sell_stop_pct = Number((strat_opts.virtual_sell_stop_pct - 0.05).toFixed(2))
			console.log('\nVirtual Stoploss - Virtual sell stop price'.yellow + ' DECREASE'.green + ' -> ' + strat_opts.virtual_sell_stop_pct)
		}})
		this.command('y', {desc: ('Virtual Stoploss - Manual activate Virtual stop on position '.grey + s.positions_index), action: function() {
			if (s.positions_index != null) {
				console.log('\nVirtual Stoploss - Manual activate Virtual stop on position: '.yellow + s.positions[s.positions_index].id + '. New open price: '.yellow + formatCurrency(s.period.close, s.currency) + '\n')
				//Il prezzo di apertura originale deve essere registrato solo la prima volta
				if (!s.positions[s.positions_index].strategy_parameters.virtual_stoploss.original_price_open) {
					s.positions[s.positions_index].strategy_parameters.virtual_stoploss.original_price_open = s.positions[s.positions_index].price_open
					s.positions[s.positions_index].strategy_parameters.virtual_stoploss.original_profit_gross_pct = s.positions[s.positions_index].profit_gross_pct
				}	
				s.positions[s.positions_index].price_open = s.period.close
				console.log(inspect(s.positions[s.positions_index]))
			}
			else {
				console.log('No position in control.')
			}
		}})
		this.command('Y', {desc: ('Virtual Stoploss - Manual deactivate Virtual stop on position '.grey + s.positions_index), action: function() {
			if (s.positions_index != null) {
				console.log('\nVirtual Stoploss - Manual dectivate Virtual stop on position: '.yellow + s.positions[s.positions_index].id + '. New open price: ' + formatCurrency(s.positions[s.positions_index].strategy_parameters.virtual_stoploss.original_price_open, s.currency) + '\n')
				s.positions[s.positions_index].price_open = s.positions[s.positions_index].strategy_parameters.virtual_stoploss.original_price_open
				s.positions[s.positions_index].profit_gross_pct = s.positions[s.positions_index].strategy_parameters.virtual_stoploss.original_profit_gross_pct
				console.log(inspect(s.positions[s.positions_index]))
			}
			else {
				console.log('No position in control.')
			}
		}})
		
		cb()
	},
	
	onTrade: function (s, opts= {}, cb= function() {}) {
		cb()
	},
	

	onTradePeriod: function (s, opts= {}, cb= function() {}) {
//		var opts = {
//			trade: trade,
//		};
		
		s.positions.forEach( function (position, index) {
			let pos_strat_param = position.strategy_parameters.virtual_stoploss
			if (pos_strat_param.original_price_open) {
				let original_price_open = pos_strat_param.original_price_open
				pos_strat_param.original_profit_gross_pct = (position.side == 'buy' ? +100 : -100) * n(opts.trade.price).subtract(original_price_open).divide(original_price_open).value()
			}
		})
		cb()
	},
	
	onStrategyPeriod: function (s, opts= {}, cb= function() {}) {
		let strat_opts = s.options.strategy.virtual_stoploss.opts
		
//		debug.msg('Virtual Stoploss strategy - onStrategyPeriod')
		if (!s.in_preroll && s.options.strategy.virtual_stoploss.calc_lookback[0].close) {
			s.positions.forEach( function (position, index) {
				position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
				position_stop = position.strategy_parameters.virtual_stoploss['virtual_' + position_opposite_signal + '_stop']				

				if (position_stop && !position.locked && ((position.side == 'buy' ? +1 : -1) * (s.options.strategy.virtual_stoploss.calc_lookback[0].close - position_stop) < 0)) {
					console.log(('\n Virtual stop loss triggered at ' + formatPercent(position.profit_net_pct/100) + ' trade profit for position ' + position.id + '. New open price ' + formatCurrency(s.options.strategy.virtual_stoploss.calc_lookback[0].close, s.currency) + '\n').red)
					s.tools.pushMessage('Virtual Stop Loss Protection', position.side + ' position ' + position.id + ' (' + formatPercent(position.profit_net_pct/100) + '). New open price ' + formatCurrency(s.options.strategy.virtual_stoploss.calc_lookback[0].close, s.currency), 0)
					s.signal = 'Virtual Stoploss';
					
					//Il prezzo di apertura originale deve essere registrato solo la prima volta
					if (!position.strategy_parameters.virtual_stoploss.original_price_open) {
						position.strategy_parameters.virtual_stoploss = {
							original_price_open: position.price_open,
							original_profit_gross_pct: position.profit_gross_pct,
						}
					}
					
					position.price_open = s.options.strategy.virtual_stoploss.calc_lookback[0].close
					position.strategy_parameters.virtual_stoploss.virtual_buy_stop = (position.side == 'sell' ? n(position.price_open).multiply(1 + strat_opts.virtual_buy_stop_pct/100).format(s.product.increment) : null)
					position.strategy_parameters.virtual_stoploss.virtual_sell_stop = (position.side == 'buy' ? n(position.price_open).multiply(1 - strat_opts.virtual_sell_stop_pct/100).format(s.product.increment) : null)
				}
				else {
					s.signal = null
				}
			})
		}
		cb()
	},

	onReport: function (s, opts= {}, cb = function() {}) {
		cb()
	},
	
	onUpdateMessage: function (s, opts= {}, cb = function() {}) {
		cb()
	},
	
	onPositionOpened: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.virtual_stoploss.opts
		
		var position = s.positions.find(x => x.id === opts.position_id)
		position.strategy_parameters.virtual_stoploss = {
			virtual_buy_stop: (position.side == 'sell' ? n(position.price_open).multiply(1 + strat_opts.virtual_buy_stop_pct/100).format(s.product.increment) : null),
			virtual_sell_stop: (position.side == 'buy' ? n(position.price_open).multiply(1 - strat_opts.virtual_sell_stop_pct/100).format(s.product.increment) : null),
			original_price_open: null,
			original_profit_gross_pct: null,
		}
		
		cb()
	},
	
	onPositionUpdated: function (s, opts= {}, cb = function() {}) {
		let strat_opts = s.options.strategy.virtual_stoploss.opts

		var position = s.positions.find(x => x.id === opts.position_id)
		
		position.strategy_parameters.virtual_stoploss.virtual_buy_stop = (position.side == 'sell' ? n(position.price_open).multiply(1 + strat_opts.virtual_buy_stop_pct/100).format(s.product.increment) : null)
		position.strategy_parameters.virtual_stoploss.virtual_sell_stop = (position.side == 'buy' ? n(position.price_open).multiply(1 - strat_opts.virtual_sell_stop_pct/100).format(s.product.increment) : null)
		
		cb()
	},
	
	onPositionClosed: function (s, opts= {}, cb = function() {}) {
		cb()
	},
	
	onOrderExecuted: function (s, opts= {}, cb = function() {}) {
		cb()
	},

	printOptions: function(s, opts= {}, cb = function() {}) {
		let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.virtual_stoploss))
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
		profit_stop_enable_pct: Phenotypes.Range0(1, 20),
		profit_stop_pct: Phenotypes.Range(1,20),

		// -- strategy
		size: Phenotypes.Range(1, 40),
	}
}
