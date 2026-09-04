// Root readiness hooks for the Mocha suite.
//
// app.js exports a PROMISE, not a server: `init()` is async and app.js ends with
// `module.exports = serverPromise`. Anything that reads `app.listener` at
// require time therefore reads `undefined`. This file resolves that promise
// once, in a root `before`, and publishes the resolved server through
// test/lib/ready.js, which test/helpers/flow.js reads lazily when it builds its
// first Supertest request.
//
// This file also settles a second, independent problem: app.js assigns the nine
// legacy global model bindings (User, Course, Lesson, Material, File, Trinket,
// Interaction, Folder, CourseInvitation) inside `init()`, so none of them exists
// until that promise resolves -- yet the model suites read them and
// test/helpers/flow.js calls User.findByLogin and `new User(...)`. The root
// `before` orders every TEST after those assignments, and the load-time bindings
// below cover the reads that happen earlier still, while a spec file is itself
// being required.
//
// THE FILENAME IS AN INTERFACE -- do not rename this file and do not move it
// into a subdirectory. test/mocha.opts narrows the spec glob to
// `test/lib/**/*.js`; Mocha resolves that pattern through glob, which returns
// its matches sorted, so the `00-` prefix ('0' is 0x30, 'a' is 0x61) is the
// whole reason this is the FIRST collected spec and therefore the reason these
// root hooks run before every suite. No other ordering mechanism is in play.
//
// This work cannot move into the test/env.js preload, for two independent
// reasons: Mocha 3.5.3 loads `--require` modules BEFORE it installs the BDD
// globals, so `before` genuinely does not exist there yet, and CommonJS -- which
// this project keeps by decision -- has no top-level `await`. Hence a collected
// spec, and hence the first one.

// THE ORDER OF THE REQUIRES BELOW IS LOAD-BEARING -- do not tidy it.
//
// test/helpers/db.js requires config/db directly, bypassing config/app.config,
// and config/db.js requires mongoose-schema-extend, whose transitive Proxy
// polyfill REPLACES the global Object.getPrototypeOf. Once that has happened,
// `require('@hapi/hapi')` throws `AssertError: Schema can only contain plain
// objects`. Measured, in both directions, on @hapi/hapi 21.4.10 -- which fails
// identically to 20.3.0, so the version bump does not rescue a wrong order.
// Requiring app.js first loads hapi (through config/app.config, which orders its
// own requires for exactly this reason) before the prototype is patched. This is
// the order the previous test/setup.js had, and it was never incidental.
//
// Because this is the first collected spec, requiring app.js here is also what
// protects every LATER spec that requires test/helpers/db.
var appPromise = require('../../app.js');

// The nine legacy model bindings, bound here at LOAD time in app.js's own order
// and from app.js's own module paths. Two separate things require this, and
// neither is satisfiable from a hook:
//
// 1. Specs read them while their own file is being required, not while a test is
//    running: test/lib/models/user.js takes
//    `User.hooks.pre.save.encryptPassword` in a `describe` body. Mocha requires
//    every collected spec synchronously, so no `await` inside a root `before`
//    can have run by then -- without the assignment below that read throws
//    `TypeError: Cannot read properties of undefined (reading 'hooks')` during
//    file collection and takes the whole run down. Measured.
//
// 2. --check-leaks is retained in test/mocha.opts. app.js assigns these same
//    names inside `init()`, whose first `await` is `server.register([...])`, so
//    they would otherwise first appear in a LATER TICK -- after Mocha has
//    required every spec and, synchronously, constructed the Runner that
//    snapshots the global object. Mocha re-checks after every test AND every
//    hook, so they would be reported as leaked globals and fail the run.
//    Measured: 1 of the 9 exists straight after `require('../../app.js')` and
//    9 of 9 once the promise resolves.
//
// This is safe rather than a second source of truth for the same state, because
// `require` is cached: app.js's later assignment inside `init()` re-binds the
// IDENTICAL objects. Verified for all nine -- nothing diverges and no model is
// registered twice. Note `File`, which is a native global on Node 20+ and which
// the application itself overwrites; that is reproduced here rather than guarded
// against, so the suite sees exactly what the running application sees.
//
// They sit AFTER the app.js require above so that the application's own load
// order is preserved: lib/models/model.js exposes `Model.extend` in terms of
// `schema.extend`, which mongoose-schema-extend installs when config/db is
// required, and app.js reaches config/db (through config/app.config) before it
// touches any model.
//
// These are the APPLICATION's own legacy bindings. The resolved server is
// deliberately NOT published on `global`: test/lib/ready.js is its only home.
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
// and drops the test database. Doing that here, rather than from the test/env.js
// preload, is what keeps it after that preload has established the test
// environment and after the Mongo connection string has been published by
// whatever runs `mocha`.
var db = require('../helpers/db');

// ---------------------------------------------------------------------------
// Arity adapter for the two bare-reference db hooks. This belongs HERE, and not
// in test/helpers/db.js, because that file is a read-only authority for this
// migration: AAP 0.2.1 lists it as "reference only for `reset`", AAP 0.3.1's
// target tree marks it "unchanged", and AAP 0.9.2 fixes `reset` as an
// empty-database operation. The defect below is also not one of AAP 0.6.5's
// seven harness defects -- it is pre-existing and was simply unreachable while
// the suite still died during file collection -- so repairing it inside db.js
// would be an unrelated edit to an unchanged file, which R-a forbids. Adapting
// the arity from an authorized harness file keeps db.js at its baseline.
//
// The defect: Mocha decides whether a hook is asynchronous from its ARITY.
// mocha 3.5.3 sets `this.async = fn && fn.length`
// (node_modules/mocha/lib/runnable.js:52). db.js binds its two methods with
// `_.bindAll`, and underscore <= 1.8.x delegated that to native bind, which
// reports the target's arity -- so `db.reset.length` was 1 when db.js was
// written. underscore 1.9+ builds bound copies through `restArguments`, whose
// length is 0. Measured on the installed 1.13.8: `_.bindAll` yields 0, native
// bind yields 1. At 0, the bare-reference hooks `before(db.reset)`
// (test/lib/api/index.js, test/lib/models/user.js) and
// `beforeEach(db.ensureConnection)` (test/lib/api/index.js) run as SYNCHRONOUS
// hooks, are called with no `done`, and throw `TypeError: done is not a
// function` inside `reset`.
//
// This runs at LOAD time rather than from a hook because those `before(...)`
// calls sit in `describe` bodies, which Mocha executes while it REQUIRES each
// spec file. The reference is therefore captured at require time, and the only
// way to be earlier is to be an earlier file -- which this one is, by the `00-`
// prefix documented above. Restoring the arity from a hook would be too late.
//
// Each wrapper forwards to the already-bound method, so `this` binding,
// behaviour and the empty-database contract are untouched; the single observable
// difference is `length === 1`, which is the contract the hooks were written
// against.
var boundEnsureConnection = db.ensureConnection;
var boundReset            = db.reset;

db.ensureConnection = function (done) {
  return boundEnsureConnection(done);
};

db.reset = function (done) {
  return boundReset(done);
};
// ---------------------------------------------------------------------------

// The mutable holder the lazy Supertest agent reads from. No requires of its
// own, so its position carries no ordering constraint.
var ready = require('./ready');

before(function () {
  // Boot registers Inert, Vision and Yar, constructs the Mongo-backed
  // `sessions` catbox cache, connects Mongoose and parses the full route table,
  // which comfortably exceeds Mocha's 2000 ms default. Without an explicit
  // timeout a slow boot would surface as an opaque hook timeout instead of as
  // whatever actually went wrong.
  this.timeout(60000);

  return appPromise.then(function (server) {
    // app.js turns a boot failure into `log.error(...)` followed by
    // `process.exit(1)`, so this promise does not reject: a broken boot kills
    // the process, and only a hang reaches the timeout above. If that catch
    // branch ever did run, the promise would resolve to `undefined`, so publish
    // whatever resolved without asserting on it. Nothing is masked by that --
    // the first request then fails loudly in flow.js's createRequest, which is
    // the correct and diagnosable outcome, and an assertion here would only
    // move the failure earlier while adding a second thing to keep in step with
    // the app's own contract.
    ready.server = server;

    // Start the server's caches WITHOUT listening.
    //
    // config/test.yaml sets `app.start: false`, so app.js:330-331 never reaches
    // `server.start()` and hapi stays in its 'stopped' phase. In hapi 17+ it is
    // that phase transition -- not the listener -- which starts catbox clients:
    // @hapi/hapi/lib/core.js:345-370 `_initialize()` awaits `client.start()` for
    // every provisioned cache and then runs `onPreStart`, and `_start()` merely
    // calls it before binding a port. The session store here IS such a cache:
    // the Mongo-backed `sessions` policy at app.js:38,105-106.
    //
    // Left unstarted, every request that commits a session fails inside
    // @hapi/yar's own onPreResponse (@hapi/yar/lib/index.js:297,311 ->
    // @hapi/catbox/lib/client.js:85,104) with `Error: Disconnected`, which hapi
    // maps to a 500. Measured through `server.inject` -- so with no Supertest or
    // flow.js involvement at all -- POST /users returns 500 without this call
    // and 302 to /welcome with it, the latter being what
    // test/lib/api/registration.js:67-70 asserts. This defect was unreachable
    // until test/helpers/flow.js's lazy agent made API requests possible, which
    // is why it is not in AAP 0.6.5's list of seven.
    //
    // `initialize()` does not listen, so Supertest still wraps the non-listening
    // `server.listener` and starts its own ephemeral listener via listen(0) --
    // the arrangement the harness is written against is unchanged. The guard is
    // required rather than defensive: `_initialize()` THROWS unless the phase is
    // 'stopped' (core.js:355-357), so a server that app.js did start (any
    // configuration with `app.start: true`) must be left alone, and for that
    // question `info.started` IS the right discriminator -- it is non-zero
    // exactly when `server.start()` ran.
    //
    // It is not the right discriminator for teardown, which is why the `after`
    // hook below does not reuse it: `initialize()` starts the caches without
    // ever touching `info.started`. Record what this harness actually did, so
    // teardown rests on observed ownership rather than on a listener timestamp.
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
  // branch ran, so guard before touching it. That guard is the ONLY condition on
  // teardown: there is deliberately no test on `info.started` here.
  //
  // Why, measured on @hapi/hapi 21.4.10 rather than inferred from the API:
  //
  //   * `info.started` is set by `server.start()` alone. `server.initialize()`
  //     -- which the `before` hook above calls, because config/test.yaml sets
  //     `app.start: false` -- takes the server to the 'initialized' phase,
  //     starts EVERY provisioned catbox client and calls `heavy.start()`, and
  //     leaves `info.started` at 0 (core.js:345-379). Probed directly: after
  //     `initialize()` the cache client reports started while `info.started` is
  //     0. So gating teardown on `info.started` skipped `stop()` on the only
  //     path this suite takes, and the Mongo-backed `sessions` cache
  //     (app.js:38,105-106) was left running for the whole run.
  //
  //   * `stop()` is safe to call unconditionally. `_stop()` accepts the
  //     'stopped', 'initialized', 'started' and 'invalid' phases and throws only
  //     while a transition is in flight (core.js:397). Probed: a second
  //     `stop()` on an already-stopped server resolves. So this is idempotent,
  //     and it is not suppressing an error to call it when there is little to do.
  //
  // There is no `try`/`catch`: a genuine `stop()` rejection must fail this hook.
  if (!ready.server) {
    return;
  }

  await ready.server.stop({ timeout: 5000 });
  ready.initialized = false;

  // Close the listener Supertest bound, which `stop()` above provably cannot.
  //
  // `_stop()` runs `await this._unlisten(...)` only `if (this.started)`
  // (core.js:406-411), and an initialize-only server has `started === false`.
  // Meanwhile supertest 0.8.3 does `var addr = app.address(); if (!addr)
  // app.listen(0);` (lib/test.js:56-58) against hapi's own `server.listener` --
  // and it never stores or closes that listener. Probed end to end: after
  // `stop()` the listener is still bound to its ephemeral port. Nothing else
  // reaches it, so it is closed here; until now the run depended on Mocha's
  // forced exit to release the socket.
  //
  // `address()` is the state to test rather than a flag we keep, because it
  // answers for every path at once: null when app.js started the server (hapi
  // already unlistened) and when no request was ever made, non-null exactly when
  // Supertest's listener is still open.
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

  // Nothing else is torn down here by design: the MongoDB lifecycle belongs to
  // the runner that wraps `mocha`, and the API suite's final `db.reset` belongs
  // to test/lib/api/index.js. app.js's 60-second leak-detection interval holds
  // the event loop open, and Mocha 3.5.3 force-exits after the run, so no
  // `--exit` flag or `process.exit()` call is needed or wanted -- but that
  // forced exit is now a convenience rather than the thing that releases this
  // server's resources.
});
