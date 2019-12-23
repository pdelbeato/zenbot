var _ = require('lodash')
//var Datastore = require('nestdb')
var Datastore = require('tingodb')().Db
//assert = require('assert');


//Fetch a collection to insert document into
//var collection = db.collection("batch_document_insert_collection_safe");
//Insert a single document
//collection.insert([{hello:'world_safe1'}
//, {hello:'world_safe2'}], {w:1}, function(err, result) {
//assert.equal(null, err);
//
//// Fetch the document
//collection.findOne({hello:'world_safe2'}, function(err, item) {
//assert.equal(null, err);
//assert.equal('world_safe2', item.hello);
//})
//});

module.exports = function (conf, cb = function () {}) {
	var db = {}
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
	db.datastore = new Datastore(conf.nestdb.dir, {})
	
//Da sistemare: non c'è bisogno di promesse.
	db_names.forEach(function (db_name, index) {
		promises.push(new Promise(function (resolve, reject) {
//			db[db_name] = new Datastore (db_name, {}
////				filename: ('./' + conf.nestdb.dir + '/' + db_name + '.db'),
////				autoload: true,
//				onload: function (err) {
//					if (err) {
//						reject(err);
//					}
//					else {
//						console.log('Boot - ' + db_name + ' database loaded...');
//						resolve()
//					}
//				}
//			})
			db[db_name] = db.datastore.collection(db_name);
			resolve();
		})
		)
	})

	Promise.all(promises)
	.then(function() {
		console.log('Databases created/loaded. Sorting...')
		db.trades.createIndex({selector: 1, time: 1})
		db.resume_markers.createIndex({selector: 1, to: -1})

		_.set(conf, 'nestdb', db)

		cb()
	})
	.catch(function(error) {
		console.log(error)
	})
}

