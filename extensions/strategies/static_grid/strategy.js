var z = require('zero-fill')
, n = require('numbro')
, debug = require('../../../lib/debug')

//Parte da includere nel file di configurazione
//---------------------------------------------
//c.strategy['static_grid'] = {
//name: 'static_grid',
//opts: {
//	period_calc: '1m',				//calculate Bollinger Bands every period_calc time
//	min_periods: 2, 				//min. number of history periods (timeframe period_length)
//	pivot: 2.70,					//Pivot price
//	grid_pct: 1, 					//% delta between grid lines
//	lanes_per_side: 5,				//Number of lanes per side
//	},
//	data: {							//to storage calculated data
//		boundary: [],				//Boundary between lanes
//		actual_lane: 0,				//Lane of actual price
//		old_lane: 0,				//Former lane
//		trend: 1,					//Trend (1 rising, 0 not moving, -1 falling)
//		trade_in_lane: false,		//Trade in lane done or not
//	},	
//}


module.exports = {
		name: 'static_grid',
		description: 'Static Grid Strategy',

		getOptions: function (s) {
			this.option('static_grid', 'period_calc', 'Calculate actual lane every period_calc time', String, '1m')
			this.option('static_grid', 'min_periods', 'Min. number of history periods', Number, 2)
			this.option('static_grid', 'pivot','Pivot price', Number, 0)
			this.option('static_grid', 'grid_pct','% grid lines', Number, 1)
			this.option('static_grid', 'lanes_per_side','Number of lanes per side', Number, 5)

			//Calcola la griglia e l'attuale posizione
			var lane_width = s.options.strategy.static_grid.opts.pivot * s.options.strategy.static_grid.opts.grid_pct / 100
			var central_lane = s.options.strategy.static_grid.opts.lanes_per_side
			for (var i = 0; i <= (2 * central_lane); i++) {
				s.options.strategy.static_grid.data.boundary[i] = n(s.options.strategy.static_grid.opts.pivot).add((i - central_lane) * lane_width).format(s.product.increment ? s.product.increment : '0.00000000')
//				if (s.period.close > s.options.strategy.static_grid.data.boundary[i]) {
//					s.options.strategy.static_grid.data.actual_lane = s.options.strategy.static_grid.data.old_lane = i + 1
//				}
			}
			console.log('Static Grid:')
			console.log(s.options.strategy.static_grid.data.boundary)
		},

		calculate: function (s) {
			var central_lane = s.options.strategy.static_grid.opts.lanes_per_side
			for (var i = 0; i <= (2 * central_lane); i++) {
				if (s.period.close > s.options.strategy.static_grid.data.boundary[i]) {
					s.options.strategy.static_grid.data.actual_lane = i + 1
				}
			}
			s.options.strategy.static_grid.data.trend = s.options.strategy.static_grid.data.actual_lane - s.options.strategy.static_grid.data.old_lane
			
			if (s.options.strategy.static_grid.data.trend != 0) {
				s.options.strategy.static_grid.data.trade_in_lane = false
			}
		},

		onPeriod: function (s, cb) {
			var central_lane = s.options.strategy.static_grid.opts.lanes_per_side

			if (!s.options.strategy.static_grid.data.trade_in_lane) {
				var side = (s.options.strategy.static_grid.data.actual_lane > central_lane)

				s.options.so.active_long_position = !side
				s.options.so.active_short_position = side

				if (s.options.strategy.static_grid.data.trend < 0) {
					s.eventBus.emit('static_grid', 'sell')
				}
				else if (s.options.strategy.static_grid.data.trend > 0) {
					s.eventBus.emit('static_grid', 'buy')
				}
				s.options.strategy.static_grid.data.old_lane = s.options.strategy.static_grid.data.actual_lane
				cb()
			}
		},

		onReport: function (s) {
			var cols = []
			cols.push('Lane ') 
			cols.push(z(3, s.options.strategy.static_grid.data.old_lane, ' '))
			cols.push(('-> ')[(s.options.strategy.static_grid.data.trend > 0 ? 'green' : 'red')])
			cols.push(z(3, s.options.strategy.static_grid.data.actual_lane, ' '))
			cols.push(z(6, (s.options.so.active_long_position ? 'Long' : 'Short'), ' '))
			return cols
		},
		
		orderExecuted: function (s, type, executeSignal) {
			s.options.strategy.static_grid.data.trade_in_lane = true
		},
}