var _ = require('lodash')
var Datastore = require('tingodb')({cacheSize: 10}).Db
var fs = require('fs')
//assert = require('assert');

module.exports = function (conf, cb = function () {}) {
	var db = {}
	var promises = []
	var db_names = [
		'trades',
		'resume_markers',
		'sessions',
		'periods',
		'my_trades',
		'sim_results',
		'my_positions',
		'my_closed_positions'
		]

	checkDirectory(conf.db.dir, function(err) {
		db.datastore = new Datastore(conf.db.dir, {})

		db_names.forEach(function (db_name, index) {
			db[db_name] = db.datastore.collection(db_name + '.db');
		})

		console.log('Databases created/loaded. Sorting...')
		db.trades.createIndex({selector: 1, time: 1})
		db.resume_markers.createIndex({selector: 1, to: -1})

		_.set(conf, 'db', db)

		cb()
	})

	function checkDirectory(directory, callback) {  
		fs.access(directory, function(err) {
			//Check if error defined and the error code is "not exists"
			if (err) {
				console.log('collection-service - db directory does not exist. Creating...')
				//Create the directory, call the callback.
				fs.mkdir(directory, callback);
			} else {
				callback()
			}
		});
	}
}

