var _ = require('lodash')
var path = require('path')
var minimist = require('minimist')
var version = require('./package.json').version
var EventEmitter = require('events')

module.exports = function (cb) {
	var zenbot = { version }
	var args = minimist(process.argv.slice(3))
	var conf = {}
	var config = {}
	var overrides = {}

	console.log('\n' + 'Zenbot - Quantum Feature version')

	module.exports.debug = args.debug

	// 1. load conf overrides file if present
	if(!_.isUndefined(args.conf)){
		try {
			overrides = require(path.resolve(process.cwd(), args.conf))
		} catch (err) {
			console.error(err + ', failed to load conf overrides file!')
		}
	}

	// 2. load conf.js if present
	try {
		conf = require('./conf')
	} catch (err) {
		console.error(err + ', falling back to conf-default')
	}

	// 3. Load conf-default.js and merge
	var defaults = require('./conf-default')
	_.defaultsDeep(config, overrides, conf, defaults)
	zenbot.conf = config

	var eventBus = new EventEmitter()
	zenbot.conf.eventBus = eventBus

	var Datastore = require('nestdb')
	var db = {}
	var promises = []
	var db_names = ['trades', 'resume_markers', 'balances', 'sessions', 'periods', 'my_trades', 'sim_results', 'my_positions', 'my_closed_positions']

	db_names.forEach(function (db_name, index) {
		promises.push(new Promise(function (resolve, reject) {
			db[db_name] = new Datastore ({
				filename: ('./' + zenbot.conf.mongo.db + '/' + db_name + '.db'),
				autoload: true,
				onload: function (err) {
					if (err) {
						reject(err);
					}
					else {
						console.log(db_name + ' database loaded...');
						resolve()
					}
				}
			})
		})
		)
	})
	console.log('Boot - promises')
	console.log(promises)

//	db.trades = new Datastore ({filename: ('./' + zenbot.conf.mongo.db + '/trades.db'), autoload: true})
//	db.resume_markers = new Datastore ({filename: ('./' + zenbot.conf.mongo.db + '/resume_markers.db'), autoload: true})
//	db.balances = new Datastore ({filename: ('./' + zenbot.conf.mongo.db + '/balances.db'), autoload: true})
//	db.sessions = new Datastore ({filename: ('./' + zenbot.conf.mongo.db + '/sessions.db'), autoload: true})
//	db.periods = new Datastore ({filename: ('./' + zenbot.conf.mongo.db + '/periods.db'), autoload: true})
//	db.my_trades = new Datastore ({filename: ('./' + zenbot.conf.mongo.db + '/my_trades.db'), autoload: true})
//	db.sim_results = new Datastore ({filename: ('./' + zenbot.conf.mongo.db + '/sim_results.db'), autoload: true})
//	db.my_positions = new Datastore ({filename: ('./' + zenbot.conf.mongo.db + '/my_positions.db'), autoload: true})
//	db.my_closed_positions = new Datastore ({filename: ('./' + zenbot.conf.mongo.db + '/my_closed_positions.db'), autoload: true})

	Promise.all(promises)
	.then(function() {
		console.log('Created/loaded databases...')
		cosnole.log(db)

		db.trades.ensureIndex({fieldname: 'time'})
		db.resume_markers.ensureIndex({fieldname: 'to'})
		console.log('Sorted databases...')

		_.set(zenbot, 'conf.db.mongo', db)

		console.log(zenbot.conf.db)
		cb(null, zenbot)
	})
	.catch(function(error) {
		console.log(error)
	})
}
