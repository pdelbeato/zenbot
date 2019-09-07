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

	Promise.all(promises)
	.then(function() {
		console.log('Databases created/loaded.')

		db.trades.ensureIndex({fieldname: 'time'})
		db.resume_markers.ensureIndex({fieldname: 'to'})
		console.log('Sorting databases...')

		_.set(conf, 'nestdb', db)

		cb()
	})
	.catch(function(error) {
		console.log(error)
	})
}

