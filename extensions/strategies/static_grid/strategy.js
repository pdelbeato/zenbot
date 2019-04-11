var z = require('zero-fill')
, n = require('numbro')
, sma = require('../../../lib/sma')
, cliff = require('cliff')
, debug = require('../../../lib/debug')

//Parte da includere nel file di configurazione
//---------------------------------------------
//Per questa strategia, attivare catching order e disattivare profit_stop e buy/sell_gain_pct
//c.strategy['static_grid'] = {
//	name: 'static_grid',
//	opts: {							//****** To store options
//		period_calc: '15m',			//****** Calculate actual lane every period_calc time
//		min_periods: 1000, 			//****** Minimum number of history periods (timeframe period_length). It is the number of values to calculate Pivot price (SMA) too.
//		grid_pct: 4, 				//% delta between grid lines
//		lanes_per_side: 10,			//Number of lanes per side
//		gain_distance_pct: 50,		//% of distance between open price and pivot price to be considered as gain for the position
//		minimum_gain_pct: 3,		//Minimum % of gain for catching position
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
//		trade_in_lane: false,		//Trade in lane done or not
//	},
//	calc_lookback: [],				//****** Old periods for calculation
//	calc_close_time: 0,				//****** Close time for strategy period
//	lib: {}							//****** To store all the functions of the strategy
//}

module.exports = {
		name: 'static_grid',
		description: 'Static Grid Strategy',
		
		getOptions: function (s) {
			this.option('static_grid', 'period_calc', 'Calculate actual lane every period_calc time', String, '15m')
			this.option('static_grid', 'min_periods', 'Min. number of history periods (and the number of values to calculate Pivot price (SMA)', Number, 500)
			this.option('static_grid', 'grid_pct','% grid lines', Number, 1)
			this.option('static_grid', 'lanes_per_side','Number of lanes per side', Number, 5)
			this.option('static_grid', 'gain_distance_pct','% of distance between open price and pivot price to be considered as gain for the positions', Number, 50)
			this.option('static_grid', 'minimum_gain_pct','Minimum % of gain for catching position', Number, 3)
		},

		calculate: function (s, cb = function() {}) {
			//Calcolo il pivot price (s.options.strategy.static_grid.data.sma)
			s.options.strategy.static_grid.data.pivot_price = roundToNearest(sma(s, 'static_grid', s.options.strategy.static_grid.opts.min_periods, 'close')) 

			//Calcola la griglia
			var pivot_price = s.options.strategy.static_grid.data.pivot_price
			var lane_width = pivot_price * s.options.strategy.static_grid.opts.grid_pct / 100
			var central_lane = s.options.strategy.static_grid.opts.lanes_per_side
			
			for (var i = 0; i <= (2 * central_lane); i++) {
				s.options.strategy.static_grid.data.boundary.pair[i] = roundToNearest(n(pivot_price).add((i - central_lane) * lane_width).value())
				s.options.strategy.static_grid.data.boundary.odd[i] = roundToNearest(n(s.options.strategy.static_grid.data.boundary.pair[i]).add(lane_width / 2).value())
			}
			
//			console.log('Static Grid:')
//			console.log(s.options.strategy.static_grid.data.boundary.pair)
//			console.log(s.options.strategy.static_grid.data.boundary.odd)
			
			//Se il prezzo è sotto il minimo fra tutte le odd lanes, allora entra nella pair lanes più bassa.
			if (s.period.close < s.options.strategy.static_grid.data.boundary.odd[0]) {
				s.options.strategy.static_grid.data.pair = true
			}

			var pair_odd = (s.options.strategy.static_grid.data.pair ? 'pair' : 'odd')
			s.options.strategy.static_grid.data.actual_lane = 0

			for (var i = 0; i <= (2 * central_lane); i++) {
				if (s.period.close > s.options.strategy.static_grid.data.boundary[pair_odd][i]) {
					s.options.strategy.static_grid.data.actual_lane = i
				}
			}
			s.options.catch_order_pct = roundToNearest(Math.max(Math.abs(((s.period.close - pivot_price) / pivot_price) * s.options.strategy.static_grid.opts.gain_distance_pct), s.options.strategy.static_grid.opts.minimum_gain_pct))
			
			cb()
			
			function roundToNearest(numToRound) {
				var numToRoundTo = (s.product.increment ? s.product.increment : 0.00000001)
				numToRoundTo = 1 / (numToRoundTo)

				return Math.floor(numToRound * numToRoundTo) / numToRoundTo
			}
		},

		onPeriod: function (s, cb) {
			var central_lane = s.options.strategy.static_grid.opts.lanes_per_side

			s.options.strategy.static_grid.data.trend = s.options.strategy.static_grid.data.actual_lane - s.options.strategy.static_grid.data.old_lane
			
			if (s.options.strategy.static_grid.data.trend != 0) {
				var side = (s.period.close > s.options.strategy.static_grid.data.pivot_price)

				s.options.strategy.static_grid.data.trade_in_lane = false
				s.options.strategy.static_grid.data.pair = !s.options.strategy.static_grid.data.pair
				s.options.active_long_position = !side
				s.options.active_short_position = side

				//Ricalcola la posizione precisa nelle corsie, perché ha cambiato pair/odd.
				// Dopodiché emette il segnale
				this.calculate(s, function() {
					if (s.options.strategy.static_grid.data.trend < 0) {
						s.eventBus.emit('static_grid', 'sell')
					}
					else if (s.options.strategy.static_grid.data.trend > 0) {
						s.eventBus.emit('static_grid', 'buy')
					}
					s.options.strategy.static_grid.data.old_lane = s.options.strategy.static_grid.data.actual_lane
				})
			}
			cb()
		},

		onReport: function (s) {
			var cols = []
			var color = (s.options.strategy.static_grid.data.trend = 0 ? 'white': (s.options.strategy.static_grid.data.trend > 0 ? 'green' : 'red'))
			cols.push('Pvt')
			cols.push(z(7, s.options.strategy.static_grid.data.pivot_price, ' ')[(s.options.active_long_position ? 'green' : 'red')])
			cols.push('|Lane') 
			cols.push(z(3, s.options.strategy.static_grid.data.actual_lane, ' ')[color])
//			cols.push(z(6, (s.options.active_long_position ? 'Long' : 'Short'), ' '))
			cols.push(z(2, (s.options.strategy.static_grid.data.pair ? 'P' : 'O'), ' ')[color])
			cols.push('|Catch') 
			cols.push(z(6, n(s.options.catch_order_pct).divide(100).format('0.00%'), ' ').yellow)
			return cols
		},
		
		printOptions: function(s) {
			let so_tmp = JSON.parse(JSON.stringify(s.options.strategy.static_grid))
			delete so_tmp.calc_lookback
			delete so_tmp.calc_close_time
			delete so_tmp.lib
			
			console.log('\n' + cliff.inspect(so_tmp))
		},
		
		orderExecuted: function (s, signal, position_id) {
			s.options.strategy.static_grid.data.trade_in_lane = true
			debug.msg('static_grid strategy - orderExecuted - trade_in_lane= ' + s.options.strategy.static_grid.data.trade_in_lane)
		},
}