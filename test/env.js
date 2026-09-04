// Mocha preload (`--require ./test/env.js` in test/mocha.opts): establishes the
// test environment before any other module can observe the wrong value. The
// `config` package snapshots NODE_ENV on its first require, so setting it here
// -- rather than from a collected spec file -- is what makes config/test.yaml
// apply at all.
//
// This file registers NO hooks, by necessity rather than by preference: Mocha
// loads `--require` modules before it installs the BDD globals, so `before` and
// `after` genuinely do not exist yet at this point. Server readiness therefore
// lives in test/lib/00-ready.js, the first collected spec. Do not move hooks,
// fixtures or application loading into this file -- its only value is that it
// runs first.
process.env.NODE_ENV = 'test';
process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';
process.env.NODE_CONFIG_DISABLE_FILE_WATCH = 'Y';

// Fail loudly rather than silently regress the ordering above.
if (typeof before !== 'undefined') {
  throw new Error('test/env.js must be preloaded, not collected as a spec.');
}

// The two assignments above are only two thirds of the rule. `config` 0.4.37
// writes '{}' into its runtime JSON whenever that file is missing or empty --
// to give fs.watch something to watch -- and skips the write only when
// PERSIST_ON_CHANGE is 'N' AND DISABLE_FILE_WATCH is 'Y'
// [node_modules/config/lib/config.js:867-880]. Persistence alone, which is what
// this file previously set, therefore still created config/runtime.json inside
// the checkout: gitignored, so invisible to `git status`, and layered OVER
// every other configuration source [config/lib/config.js:780], so one run's
// leftovers would feed the next. Disabling the watch changes nothing the
// application observes -- nothing in the bootstrap, in lib/ or in config/
// subscribes with `config.watch(...)`.
//
// The third part is where the runtime JSON points, and that is delegated to
// test/parity/mongo.js rather than reimplemented here. The check and the
// allocation have to agree EXACTLY with the launcher's: `npm test` runs through
// that wrapper, which allocates the path, publishes it to this child and
// removes it afterwards, and a second reading of the rule that drifted would
// either trust a stale path or refuse a good one. Requiring it costs nothing
// and starts nothing -- at module scope it requires only Node core, resolves no
// application module, provisions no database, creates no global, and its `main`
// runs solely under direct execution.
//
// An inherited path is honoured ONLY when this process's own parent allocated
// it for this run: `PARITY_CONFIG_RUNTIME_OWNER` must name the very path in the
// environment and must have been issued by this process's parent pid. Presence
// alone is not sufficient, and assuming it was the defect here -- this file is
// the preload named in test/mocha.opts and therefore also runs standalone,
// where an inherited NODE_CONFIG_RUNTIME_JSON is ambient state, very possibly a
// previous run's file, from which the suite would silently start. Anything that
// fails the handshake is REPLACED with a private path outside every checkout,
// whose removal `isolateRuntimeConfig` registers on `exit` -- deliberately an
// `exit` listener, because Mocha's BDD globals do not exist during a `--require`
// preload, so an `after` hook is not available here and the no-hooks property
// above is what makes this file work at all.
var mongo = require('./parity/mongo');

if (!mongo.inheritedRuntimeConfigIsOwned()) {
  mongo.isolateRuntimeConfig();
}

// Required for its side effects, immediately after the assignments above: the
// `config` package builds its singleton as `global.NODE_CONFIG`, so the first
// require of it anywhere creates that global. Doing it here locks the layer set
// to the NODE_ENV just set, and puts the global in place before Mocha snapshots
// globals for `--check-leaks` -- otherwise a lazy first require from inside a
// hook or a test body is reported as a leaked global and fails the run.
require('config');

// Installs the `should` getter that the existing assertions read through.
var chai = require('chai');

chai.should();

var sinon     = require('sinon'),
    redis     = require('redis'),
    redismock = require('redis-mock');

// Keeps the suite off a live Redis. `.callsFake` is used because the current
// sinon removed the three-argument stub form this line previously took: a
// stub-syntax change only, with no assertion changes.
sinon.stub(redis, 'createClient').callsFake(redismock.createClient);
