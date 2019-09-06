var _ = require('lodash')
var Datastore = require('nestdb')

module.exports = function (conf, cb = function () {}) {
	var db = {}
	var promises = []
	var db_names = [
		'trades',
		'resume_markers',
		'balances',
		'sessions',
		'periods',
		'my_trades',
		'sim_results',
		'my_positions',
		'my_closed_positions'
		]

//	console.log('collection-service - conf:')
//	console.log(conf)
	
	db_names.forEach(function (db_name, index) {
		promises.push(new Promise(function (resolve, reject) {
			db[db_name] = new Datastore ({
				filename: ('./' + conf.mongo.db + '/' + db_name + '.db'),
				autoload: true,
				onload: function (err) {
					if (err) {
						reject(err);
					}
					else {
						console.log('Boot - ' + db_name + ' database loaded...');
						resolve()
					}
				}
			})
		})
		)
	})

	Promise.all(promises)
	.then(function() {
		console.log('Databases created/loaded.')
//		console.log(db)

		db.trades.ensureIndex({fieldname: 'time'})
		db.resume_markers.ensureIndex({fieldname: 'to'})
		console.log('Sorting databases...')

		_.set(conf, 'db.mongo', db)

//		console.log(zenbot.conf.db)
//		cb(null, conf)
		cb()
	})
	.catch(function(error) {
		console.log(error)
	})
//	return {
//		getTrades: () => {
//			conf.db.mongo.collection('trades').createIndex({selector: 1, time: 1})
//			return conf.db.mongo.collection('trades')
//		},	
//
//		getResumeMarkers: () => {
//			conf.db.mongo.collection('resume_markers').createIndex({selector: 1, to: -1})
//			return conf.db.mongo.collection('resume_markers')
//		},
//
//		getBalances: () => {
//			return conf.db.mongo.collection('balances')
//		},
//
//		getSessions: () => {
//			return conf.db.mongo.collection('sessions')
//		},
//
//		getPeriods: () => {
//			return conf.db.mongo.collection('periods')
//		},
//
//		getMyTrades: () => {
//			return conf.db.mongo.collection('my_trades')
//		},
//
//		getSimResults: () => {
//			return conf.db.mongo.collection('sim_results')
//		},
//
//		getMyPositions: () => {
//			return conf.db.mongo.collection('my_positions')
//		},
//		
//		getMyClosedPositions: () => {
//			return conf.db.mongo.collection('my_closed_positions')
//		}
//	}
}

