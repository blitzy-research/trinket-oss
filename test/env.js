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

// Fail loudly rather than silently regress the ordering above.
if (typeof before !== 'undefined') {
  throw new Error('test/env.js must be preloaded, not collected as a spec.');
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
