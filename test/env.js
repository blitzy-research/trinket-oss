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

// TEST-ONLY PROVISIONING: the asset feature flag.
//
// `config/default.yaml:3` ships `features.assets: false` and `config/test.yaml`
// carries no `features` key, so `lib/controllers/files.js:254,277` and
// `lib/controllers/users.js:728,744,823` answer `Boom.notImplemented` before any
// upload runs. Four cases in test/lib/api/files.js drive `POST /file` and
// `GET /api/files/{id}/{name}` THROUGH those handlers, so with the flag off they
// measure a 501 and a cascading 404 instead of the behaviour they assert.
//
// Verified identical at the base commit - `git show 2f8712a:config/default.yaml`
// carries the same `assets: false` and `git show 2f8712a:config/test.yaml`
// carries no `features` key either - so this is MISSING TEST PROVISIONING, not a
// migration regression, and it is the same class as the `app.mail` and `cloud`
// blocks config/test.yaml already carries with a written justification. It is not
// a behaviour change: no assertion anywhere reads the "not enabled" payload, and
// only NODE_ENV=test reaches this file.
//
// It is published through NODE_CONFIG rather than through config/test.yaml
// because the file layers are fixed by the time a `--require` preload runs -
// `config` resolves NODE_ENV's layer set on its first require, below - and
// because that file is not this suite's to edit.
//
// MERGED, never replaced, and in this order for two reasons.
//   * test/parity/mongo.js has ALREADY published the isolated database address
//     into NODE_CONFIG for this child (`buildRuntimeConfig`), and `config` reads
//     the variable as one JSON document. A replacement, or a shallow assign over
//     a `features` key, would discard that address and point the suite at
//     whatever `db.mongo` the committed files name.
//   * The provisioning is the LOSING layer, so anything a caller inherited wins
//     over it. That mirrors the layer order it stands in for: NODE_CONFIG beats
//     config/test.yaml, so a run launched with an explicit
//     NODE_CONFIG features block still gets the value it asked for.
// `mongo.deepMerge` is the one merge implementation every parity tool shares,
// used here rather than a second copy of it.
process.env.NODE_CONFIG = JSON.stringify(mongo.deepMerge(
  { features : { assets : true } },
  parseNodeConfig(process.env.NODE_CONFIG)
));

/**
 * Parses the NODE_CONFIG this process inherited, so it can be merged rather
 * than overwritten.
 *
 * An absent or blank value is the ordinary standalone case and yields an empty
 * base layer. A value that is present but unusable is a hard failure naming the
 * variable: `config` would reject it moments later with a message that does not
 * say where it came from, and silently discarding a caller's configuration would
 * leave the suite measuring a tree nobody asked for.
 *
 * @param {(string|undefined)} inherited process.env.NODE_CONFIG.
 * @returns {Object} The parsed object, or {} when there was nothing to parse.
 * @throws {Error} If the value is present and is not a JSON object.
 */
function parseNodeConfig(inherited) {
  var parsed;

  if (inherited === undefined || String(inherited).trim() === '') {
    return {};
  }

  try {
    parsed = JSON.parse(inherited);
  }
  catch (err) {
    throw new Error(
      'test/env.js: inherited NODE_CONFIG is not valid JSON, refusing to ' +
      'discard it: ' + err.message
    );
  }

  if (!mongo.isPlainObject(parsed)) {
    throw new Error(
      'test/env.js: inherited NODE_CONFIG is not a JSON object, so the test ' +
      'feature provisioning cannot be merged under it.'
    );
  }

  return parsed;
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

// The object store the four files.js cases write to and read back is NOT
// installed here, and deliberately not: test/lib/00-ready.js already requires
// test/parity/fixtures/aws.js, pins PARITY_APP_ROOT to this checkout and clears
// an inherited PARITY_S3_ROOT, PARITY_S3_SEED and PARITY_S3_LOG before doing so.
// Requiring the fixture from this preload as well would be worse than redundant:
// this file runs FIRST, so the fixture would load while those three inherited
// variables were still in force - and PARITY_S3_SEED is read once at load, while
// a root arriving through PARITY_S3_ROOT is treated as the caller's artifact and
// never cleaned up. The storage backend belongs where it already is; the feature
// flag above belongs here, because only a preload runs before `config`.
