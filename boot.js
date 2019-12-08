var _ = require('lodash')
var path = require('path')
var minimist = require('minimist')
var version = require('./package.json').version
var EventEmitter = require('events')
var collectionService = require('./lib/services/collection-service')

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

	collectionService(zenbot.conf, function() {
		cb(null, zenbot)
	})
}
