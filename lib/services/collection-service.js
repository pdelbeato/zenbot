var _ = require('lodash')
var Datastore = require('nestdb')
var Logger = require('nedb-logger')

module.exports = function (conf, cb = function () {}) {
	var db = {}
	var db_log = {}
	var promises = []
	var db_names = [
		'trades',
		'resume_markers',
//		'balances',
		'sessions',
		'periods',
		'my_trades',
		'sim_results',
		'my_positions',
		'my_closed_positions'
		]
	
//Da sistemare: anche periods deve essere log	
	
	var db_log_names = [
		'trades',
		'resume_markers',
//		'balances',
//		'sessions',
//		'periods', 
//		'my_trades',
//		'sim_results',
//		'my_positions',
//		'my_closed_positions'
	]
	
	db_names.forEach(function (db_name, index) {
		promises.push(new Promise(function (resolve, reject) {
			db[db_name] = new Datastore ({
				filename: ('./' + conf.nestdb.dir + '/' + db_name + '.db'),
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

	db_log_names.forEach(function (db_log_name, index) {
		promises.push(new Promise(function (resolve, reject) {
			db_log[db_log_name] = new Logger ({	filename: ('./' + conf.nestdb.dir + '/' + db_log_name + '.db') })
			console.log('Boot - ' + db_log_name + ' logger initialized...');
			resolve()
		})
		)
	})
	
	Promise.all(promises)
	.then(function() {
		console.log('Databases and logger created/loaded.')

		db.trades.ensureIndex({fieldname: 'time'})
		db.resume_markers.ensureIndex({fieldname: 'to'})
		console.log('Sorting databases...')

		_.set(conf, 'nestdb', db)
		conf.nestdb.log = {}
		_.set(conf, 'nestdb.log', db_log)

		cb()
	})
	.catch(function(error) {
		console.log(error)
	})
}

