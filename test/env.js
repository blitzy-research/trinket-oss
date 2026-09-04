// Mocha preload, named by `--require ./test/env.js` in test/mocha.opts. The
// `config` package fixes its layer set from NODE_ENV on its first require, so
// NODE_ENV has to be set before any module reads configuration; from a
// collected spec file it would already be too late for config/test.yaml to
// apply.
//
// This file registers no hooks: Mocha loads `--require` modules before it
// installs the BDD globals, so `before` and `after` do not exist here yet.
// Server readiness lives in test/lib/00-ready.js, the first collected spec.
// Running first is the only thing this file offers, so hooks, fixtures and
// application loading belong there rather than here.
process.env.NODE_ENV = 'test';
process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';
process.env.NODE_CONFIG_DISABLE_FILE_WATCH = 'Y';

// Fail loudly rather than silently regress the ordering above.
if (typeof before !== 'undefined') {
  throw new Error('test/env.js must be preloaded, not collected as a spec.');
}

// `config` writes its runtime JSON unless persistence and the file watch are
// both off, and that file lands inside the checkout, gitignored and layered
// over every other configuration source, so with the watch left on one run's
// leftovers feed the next. Nothing here subscribes with `config.watch(...)`.
//
// The path that JSON points at is test/parity/mongo.js's to allocate: `npm
// test` runs through that launcher, which publishes the path to this child and
// removes it again, so the check and the allocation cannot drift apart. A path
// inherited from anywhere else is replaced with a private one outside every
// checkout, because this preload also runs standalone. That replacement's
// cleanup is an `exit` listener, since a `--require` preload has no `after`
// hook to register.
var mongo = require('./parity/mongo');

if (!mongo.inheritedRuntimeConfigIsOwned()) {
  mongo.isolateRuntimeConfig();
}

// Required for its side effect: `config` builds its singleton as
// `global.NODE_CONFIG`, so the first require of it anywhere creates that
// global. Doing it here locks the layer set to the NODE_ENV just set, and puts
// the global in place before Mocha snapshots globals for `--check-leaks`, which
// otherwise reports a lazy first require from inside a hook or a test body as a
// leaked global and fails the run.
require('config');

// Installs the `should` getter that the existing assertions read through.
var chai = require('chai');

chai.should();

var sinon     = require('sinon'),
    redis     = require('redis'),
    redismock = require('redis-mock');

// Keeps the suite off a live Redis: every `redis.createClient` in the
// application resolves to the in-memory mock for the whole run.
sinon.stub(redis, 'createClient').callsFake(redismock.createClient);
