var z = require('zero-fill')
, n = require('numbro')
, sma = require('../../../lib/sma')
, inspect = require('eyes').inspector()
, debug = require('../../../lib/debug')

//Parte da includere nel file di configurazione
//---------------------------------------------
//Per questa strategia, attivare catching_orders e disattivare virtual_stoploss e stoploss
//c.strategy['static_grid'] = {
//	name: 'static_grid',
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate actual lane every period_calc time
//		min_periods: 1000, 			//****** Minimum number of history periods (timeframe period_length). It is the number of values to calculate Pivot price (SMA) too.
//		grid_delta_pct: 4, 				//% delta between grid lines
//		lanes_per_side: 10,			//Number of lanes per side
//	},
//	data: {							//****** To store calculated data
//		pivot_price: 0,				//Actual Pivot price
//		boundary: {					//Boundary between lanes
//			pair: [],
//			odd: [],
//		},
//		actual_lane: 0,				//Lane of actual price
//		old_lane: 0,				//Former lane
//		trend: 1,					//Trend (1 rising, 0 not moving, -1 falling)
////		trade_in_lane: false,		//Trade in lane done or not
//		pair: true,					//In what lanes are actual price
//	},
//	calc_lookback: [],				//****** Old periods for calculation
//	calc_close_time: 0,				//****** Close time for strategy period
//	lib: {}							//****** To store all the functions of the strategy
//}
//---------------------------------------------
//
//
//position.strategy_parameters.static_grid: {
//}
//
//---------------------------------------------

module.exports = {
		name: 'static_grid',
		description: 'Static Grid Strategy',
		
		getOptions: function (s) {
			this.option('static_grid', 'period_calc', 'Calculate actual lane every period_calc time', String, '15m')
			this.option('static_grid', 'min_periods', 'Min. number of history periods (and the number of values to calculate Pivot price (SMA)', Number, 500)
			this.option('static_grid', 'grid_delta_pct','% difference between grid lines', Number, 1)
			this.option('static_grid', 'lanes_per_side','Number of lanes per side', Number, 5)
//			this.option('static_grid', 'gain_pct','% of gain for catching position', Number, 3)
		},

		getCommands: function (s, opts= {}, cb = function() {}) {
			let strat_opts = s.options.strategy.static_grid.opts
			let strat_data = s.options.strategy.static_grid.data

			this.command('o', {desc: ('Static Grid - List options'.grey), action: function() { 
				s.tools.listStrategyOptions('static_grid')
				console.log(inspect(strat_data))
			}})
			this.command('+', {desc: ('Static Grid - Grid pct '.grey + 'INCREASE'.green), action: function() {
				strat_opts.grid_delta_pct = Number((strat_opts.grid_delta_pct + 0.5).toFixed(2))
				this.onTradePeriod(s, opts)
				console.log('\n' + 'Static Grid - Grid pct ' + 'INCREASE'.green + ' -> ' + strat_opts.grid_delta_pct)
			}})
			this.command('-', {desc: ('Static Grid - Grid pct '.grey + 'DECREASE'.red), action: function() {
				strat_opts.grid_delta_pct = Number((strat_opts.grid_delta_pct - 0.5).toFixed(2))
				if (strat_opts.grid_delta_pct <= 0.5) {
					strat_opts.grid_delta_pct = 0.5
				}
				this.onTradePeriod(s, opts)
				console.log('\n' + 'Static Grid - Grid pct ' + 'DECREASE'.red + ' -> ' + strat_opts.grid_delta_pct)
			}})
			this.command('*', {desc: ('Static Grid - Lanes per side value '.grey + 'INCREASE'.green), action: function() {
				strat_opts.lane_per_side++
				this.onTradePeriod(s, opts)
				console.log('\n' + 'Static Grid - Lane per side value ' + 'INCREASE'.green + ' -> ' + strat_opts.lane_per_side)
			}})
			this.command('_', {desc: ('Static Grid - Lane per side value '.grey + 'DECREASE'.red), action: function() {
				strat_opts.lane_per_side--
				if (strat_opts.lane_per_side < 1) {
					strat_opts.lane_per_side = 1
				}
				this.onTradePeriod(s, opts)
				console.log('\n' + 'Static Grid - Lane per side value ' + 'DECREASE'.green + ' -> ' + strat_opts.lane_per_side)
			}})
//			this.command('i', {desc: ('Static Grid - Gain pct '.grey + 'INCREASE'.green), action: function() {
//				strat_opts.gain_pct = Number((strat_opts.gain_pct + 0.5).toFixed(2))
//				console.log('\n' + 'Static Grid - Gain pct ' + 'INCREASE'.green + ' -> ' + strat_opts.gain_pct)
//			}})
//			this.command('k', {desc: ('Static Grid - Gain pct '.grey + 'DECREASE'.green), action: function() {
//				strat_opts.gain_pct = Number((strat_opts.gain_pct - 0.5).toFixed(2))
//				if (strat_opts.gain_pct <= 0) {
//					strat_opts.gain_pct = 0
//				}
//				console.log('\n' + 'Static Grid - Gain pct ' + 'DECREASE'.green + ' -> ' + strat_opts.gain_pct)
//			}})
			
			cb()
		},

		onTrade: function (s, opts= {}, cb= function() {}) {
			cb()
		},

		onTradePeriod: function (s, opts= {}, cb= function() {}) {
//			var opts = {
//				trade: trade,
//			};
						
			let strat_opts = s.options.strategy.static_grid.opts
			let strat_data = s.options.strategy.static_grid.data
			
			//Calcolo il pivot price (strat_data.sma)
			strat_data.pivot_price = roundToNearest(sma(s, 'static_grid', strat_opts.min_periods, 'close')) 

			//Calcola la griglia
			var pivot_price = strat_data.pivot_price
			var lane_width = pivot_price * strat_opts.grid_delta_pct / 100
			var central_lane = strat_opts.lanes_per_side
			
			for (var i = 0; i <= (2 * central_lane); i++) {
				strat_data.boundary.pair[i] = roundToNearest(n(pivot_price).add((i - central_lane) * lane_width).value())
				strat_data.boundary.odd[i] = roundToNearest(n(strat_data.boundary.pair[i]).add(lane_width / 2).value())
			}
			
//			console.log('Static Grid:')
//			console.log(strat_data.boundary.pair)
//			console.log(strat_data.boundary.odd)
			
			//Se il prezzo è sotto il minimo fra tutte le odd lanes, allora entra nella pair lanes più bassa.
			if (s.period.close < strat_data.boundary.odd[0]) {
				strat_data.pair = true
			}

			var pair_odd = (strat_data.pair ? 'pair' : 'odd');
			strat_data.actual_lane = 0

			for (var i = 0; i <= (2 * central_lane); i++) {
				if (s.period.close > strat_data.boundary[pair_odd][i]) {
					strat_data.actual_lane = i
				}
				else {
					break
				}
			}
			
			if (!s.in_preroll) {
				strat_data.trend = (strat_data.actual_lane - strat_data.old_lane)
			}
			else {
				strat_data.old_lane = strat_data.actual_lane
			}

			cb()
			
			function roundToNearest(numToRound) {
				var numToRoundTo = (s.product.increment ? s.product.increment : 0.00000001)
				numToRoundTo = 1 / (numToRoundTo)

				return Math.floor(numToRound * numToRoundTo) / numToRoundTo
			}
		},

		onStrategyPeriod: function (s, opts= {}, cb= function() {}) {
			let strat_opts = s.options.strategy.static_grid.opts
			let strat_data = s.options.strategy.static_grid.data
			
			var central_lane = strat_opts.lanes_per_side
			var side = (s.period.close > strat_data.pivot_price)
			
			if (strat_data.trend != 0) {
//				strat_data.trade_in_lane = false
				strat_data.pair = !strat_data.pair
				s.options.active_long_position = !side
				s.options.active_short_position = side

				//Ricalcola la posizione precisa nelle corsie, perché ha cambiato pair/odd.
				// Dopodiché emette il segnale
				this.onTradePeriod(s, opts, function() {
					if (strat_data.trend < 0) {
						s.eventBus.emit('static_grid', 'sell')
					}
					else if (strat_data.trend > 0) {
						s.eventBus.emit('static_grid', 'buy')
					}
					strat_data.old_lane = strat_data.actual_lane
				})
			}
			cb()
		},

		onReport: function (s, opts= {}, cb = function() {}) {
			let strat_opts = s.options.strategy.static_grid.opts
			let strat_data = s.options.strategy.static_grid.data

			var cols = []

			var color = (strat_data.trend === 0 ? 'white' : (strat_data.trend > 0 ? 'green' : 'red'))
//			cols.push('Pvt')
			cols.push(z(8, strat_data.pivot_price, ' ')[(s.options.active_long_position ? 'green' : 'red')])
//			cols.push('|Lane')
			cols.push('|')
			cols.push(z(3, strat_data.actual_lane, ' ')[color])
			cols.push(z(2, (strat_data.pair ? 'P' : 'O'), ' ')[color])
//			cols.push('|Catch') 
//			cols.push(z(6, n(strat_opts.gain_pct).divide(100).format('0.00%'), ' ').yellow)	

			cols.forEach(function (col) {
				process.stdout.write(col)
			})
			cb()
		},

		onUpdateMessage: function (s, opts= {}, cb = function() {}) {
			cb()
		},

		onPositionOpened: function (s, opts= {}, cb = function() {}) {
//			var opts = {
//				position_id: position_id,
//			};
			cb()
		},

		onPositionUpdated: function (s, opts= {}, cb = function() {}) {
			cb()
		},

		onPositionClosed: function (s, opts= {}, cb = function() {}) {
			cb()
		},

		onOrderExecuted: function (s, opts= {}, cb = function() {}) {
//			//		var opts = {
//			signal: signal,
//			sig_kind: sig_kind,
//			position_id: position_id,
//			is_closed: is_closed,
//			};
//			if (!opts.is_closed) {
//				let strat_opts = s.options.strategy.static_grid.opts
//				let strat_data = s.options.strategy.static_grid.data
//
//				if (strat_opts.gain_pct > 0) {
//					let position = s.positions.find(x => x.id === opts.position_id)
//					if (position) {
//						let position_locking = (position.locked & ~s.strategyFlag['static_grid'])
//						let target_price = null
//
//						if (!position_locking && !s.tools.positionFlags(position, 'status', 'Check', 'static_grid')) {
//							let position_opposite_signal = (position.side === 'buy' ? 'sell' : 'buy')
//							if (position.side === 'buy') {
//								target_price = n(position.price_open).multiply(1 + strat_opts.gain_pct/100).format(s.product.increment, Math.floor)
//							}
//							else {
//								target_price = n(position.price_open).multiply(1 - strat_opts.gain_pct/100).format(s.product.increment, Math.floor)
//							}
//							debug.msg('Strategy Static grid - Position (' + position.side + ' ' + position.id + ') -> ' + position_opposite_signal.toUpperCase() + ' at ' + target_price + ' (price open= ' + position.price_open + ')')
//							let protectionFlag = s.protectionFlag['calmdown'] + s.protectionFlag['min_profit']
//							s.signal = position_opposite_signal[0].toUpperCase() + ' Static grid'
//							s.eventBus.emit('static_grid', position_opposite_signal, position.id, undefined, target_price, protectionFlag)  
//						}
//					}
//				}
//			}
			cb()
		},
			
		printOptions: function(s) {
			let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.static_grid))
			delete so_tmp.calc_lookback
			delete so_tmp.calc_close_time
			delete so_tmp.lib
			
			console.log('\n' + inspect(so_tmp))
		},
}