// Root readiness hooks for the Mocha suite.
//
// app.js exports a promise, not a server, so `app.listener` read at require
// time is `undefined`. This file resolves that promise once in a root `before`
// and publishes the server through test/lib/ready.js, which is what lets
// test/helpers/flow.js build its first Supertest request without knowing
// anything about the boot.
//
// The `00-` prefix in the filename is what makes this the first collected spec,
// and therefore what makes these root hooks run before every suite:
// test/mocha.opts narrows the glob to `test/lib/**/*.js` and Mocha sorts the
// matches. Renaming the file or moving it into a subdirectory would let other
// suites run first; no other ordering mechanism is in play.
//
// The work cannot live in the test/env.js preload: `--require` modules load
// before Mocha installs the BDD globals, so `before` does not exist there, and
// CommonJS has no top-level `await`.

// The require order here is load-bearing. test/helpers/db.js requires config/db
// directly, and config/db requires mongoose-schema-extend, whose transitive
// Proxy polyfill replaces the global `Object.getPrototypeOf`; once that has
// happened, `require('@hapi/hapi')` throws `AssertError: Schema can only
// contain plain objects`. Requiring app.js first loads hapi -- through
// config/app.config, which orders its own requires for the same reason -- while
// the prototype is still intact. Being the first collected spec, this file's
// app.js require is also what protects every later spec that requires
// test/helpers/db.
var appPromise = require('../../app.js');

// The nine legacy model bindings the application uses, bound here at load time
// in app.js's own order and from its own module paths. app.js assigns the same
// names inside `init()`, and two things need them before that promise resolves:
// specs read them while their own file is still being required
// (test/lib/models/user.js takes `User.hooks.pre.save.encryptPassword` in a
// `describe` body, and Mocha requires every collected spec synchronously), and
// `--check-leaks` snapshots the global object at the end of collection, so a
// name that first appears in a later tick is reported as a leaked global.
//
// This is not a second source of truth: `require` is cached, so app.js's own
// assignment inside `init()` re-binds the identical objects. `File` is a native
// global on Node 20+ that the application overwrites, reproduced here rather
// than guarded against so the suite sees what the running application sees.
//
// They follow the app.js require so the application's load order stands:
// lib/models/model.js expresses `Model.extend` in terms of `schema.extend`,
// which mongoose-schema-extend installs when config/db is required, and app.js
// reaches config/db before it touches any model. Only these legacy model names
// go on `global`; the resolved server's only home is test/lib/ready.js.
global.User             = require('../../lib/models/user');
global.Course           = require('../../lib/models/course');
global.Lesson           = require('../../lib/models/lesson');
global.Material         = require('../../lib/models/material');
global.File             = require('../../lib/models/file');
global.Trinket          = require('../../lib/models/trinket');
global.Interaction      = require('../../lib/models/interaction');
global.Folder           = require('../../lib/models/folder');
global.CourseInvitation = require('../../lib/models/courseInvitation');

// test/helpers/db.js runs its connection check at require time, which connects
// and drops the test database. Doing that here rather than from the test/env.js
// preload keeps it after that preload has established the test environment and
// after the Mongo connection string has been published by whatever runs
// `mocha`.
var db = require('../helpers/db');

// Arity adapter for the two db hooks other specs pass by bare reference. Mocha
// decides whether a hook is asynchronous from its arity, and `_.bindAll` on the
// current underscore returns bound copies of length 0, so `before(db.reset)`
// and `beforeEach(db.ensureConnection)` in test/lib/api/index.js and
// test/lib/models/user.js would run as synchronous hooks, be called with no
// `done`, and throw inside `reset`. Each wrapper forwards to the already-bound
// method, so behaviour and the empty-database contract are untouched and only
// `length` changes; test/helpers/db.js itself stays as it is.
//
// This runs at load time because those `before(...)` calls sit in `describe`
// bodies, which Mocha executes while it requires each spec file: the reference
// is captured then, so only an earlier file can get ahead of it.
var boundEnsureConnection = db.ensureConnection;
var boundReset            = db.reset;

db.ensureConnection = function (done) {
  return boundEnsureConnection(done);
};

db.reset = function (done) {
  return boundReset(done);
};

// The holder the lazy Supertest agent reads from. It requires nothing itself,
// so its position carries no ordering constraint.
var ready = require('./ready');

before(function () {
  // Boot registers Inert, Vision and Yar, constructs the Mongo-backed
  // `sessions` catbox cache, connects Mongoose and parses the full route table,
  // which comfortably exceeds Mocha's 2000 ms default. Without an explicit
  // timeout a slow boot surfaces as an opaque hook timeout instead of as
  // whatever actually went wrong.
  this.timeout(60000);

  return appPromise.then(function (server) {
    // app.js logs a boot failure and calls `process.exit(1)`, so this promise
    // does not reject and only a hang reaches the timeout above. Publish
    // whatever resolved without asserting on it: if that branch ever stopped
    // exiting, the first request fails loudly in flow.js's createRequest.
    ready.server = server;

    // Start the server's caches without listening.
    //
    // config/test.yaml sets `app.start: false`, so app.js never calls
    // `server.start()` and hapi stays in its 'stopped' phase -- and in hapi it
    // is that phase transition, not the listener, that starts catbox clients.
    // The Mongo-backed `sessions` policy app.js provisions is such a cache, so
    // without this call every request that commits a session fails inside
    // @hapi/yar with `Error: Disconnected` and hapi maps it to a 500: POST
    // /users answers 500 instead of redirecting to /welcome. `initialize()`
    // does not listen, so Supertest still wraps the non-listening
    // `server.listener` and starts its own ephemeral one.
    //
    // The guard is required rather than defensive: `initialize()` throws unless
    // the phase is 'stopped', so a server app.js did start -- any configuration
    // with `app.start: true` -- must be left alone, and `info.started` answers
    // that question exactly, being non-zero when `server.start()` ran.
    if (!server || server.info.started) {
      return;
    }

    return server.initialize().then(function () {
      ready.initialized = true;
    });
  });
});

after(async function () {
  this.timeout(30000);

  // The resolved value is legitimately absent when app.js's `process.exit(1)`
  // branch ran, so guard on it. That guard is the only condition on teardown:
  // `stop()` is safe to call on a server that is merely initialized or already
  // stopped, and `info.started` cannot stand in for the guard because
  // `initialize()` starts the caches without setting it, so gating on it would
  // leave the Mongo-backed `sessions` cache running for the whole run.
  //
  // There is no `try`/`catch`: a genuine `stop()` rejection must fail this hook.
  if (!ready.server) {
    return;
  }

  await ready.server.stop({ timeout: 5000 });
  ready.initialized = false;

  // Close the listener Supertest bound, which `stop()` above cannot: hapi
  // unlistens only a server it started, and this one was merely initialized.
  // Supertest calls `listen(0)` on hapi's own `server.listener` when it finds
  // no address there, and never stores or closes that listener, so nothing else
  // reaches it and it stays bound to its ephemeral port after `stop()`.
  //
  // `address()` is the state to test rather than a flag to keep, because it
  // answers for every path at once: null when app.js started the server (hapi
  // has already unlistened) and when no request was ever made, non-null exactly
  // when Supertest's listener is still open.
  var listener = ready.server.listener;

  if (listener && listener.address()) {
    // Sockets kept alive by the agent would otherwise hold `close()` open until
    // they time out; Node's default agent sets `keepAlive: true`. Available
    // since Node 18.2, and this project is pinned to Node 22.
    if (typeof listener.closeAllConnections === 'function') {
      listener.closeAllConnections();
    }

    await new Promise(function (resolve, reject) {
      listener.close(function (err) {
        // ERR_SERVER_NOT_RUNNING is the benign race: the listener closed between
        // the `address()` check and here. Any other error is real and propagates.
        if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
          return reject(err);
        }

        return resolve();
      });
    });
  }

  // Nothing else is torn down here: the MongoDB lifecycle belongs to the runner
  // that wraps `mocha`, and the API suite's final `db.reset` belongs to
  // test/lib/api/index.js. app.js's 60-second leak-detection interval holds the
  // event loop open and Mocha force-exits after the run, so no `--exit` flag or
  // `process.exit()` call is needed or wanted here.
});
