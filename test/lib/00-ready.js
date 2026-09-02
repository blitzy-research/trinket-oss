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

// Required for its side effect and intentionally left unbound: test/helpers/db.js
// runs its connection check at require time, which connects and drops the test
// database. Doing that here, rather than from the test/env.js preload, is what
// keeps it after that preload has established the test environment and after the
// Mongo connection string has been published by whatever runs `mocha`.
require('../helpers/db');

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
    // the Mongo-backed `sessions` policy at app.js:39,82-83.
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
    // configuration with `app.start: true`) must be left alone. `info.started`
    // is 0 for a never-started server, the same discriminator the `after` hook
    // below uses.
    if (!server || server.info.started) {
      return;
    }

    return server.initialize();
  });
});

after(function () {
  this.timeout(30000);

  // The resolved value is legitimately absent when app.js's `process.exit(1)`
  // branch ran, so guard before touching it.
  //
  // config/test.yaml sets `app.start: false`, so app.js never calls
  // `server.start()` and the server never listens -- Supertest wraps the
  // non-listening `server.listener` and starts its own ephemeral listener. hapi
  // reports exactly that distinction: `info.started` is 0 for a server that was
  // never started and an epoch timestamp for one that was, so it is the precise
  // discriminator for "is there anything to stop".
  //
  // Measured on @hapi/hapi 21.4.10: `stop()` on a never-started server resolves
  // rather than throwing, so this guard skips a no-op instead of suppressing an
  // error -- and because there is no `try`/`catch` here, a genuine `stop()`
  // rejection still fails this hook, which is what should happen.
  if (ready.server && ready.server.info && ready.server.info.started) {
    return ready.server.stop({ timeout: 5000 });
  }

  // Nothing else is torn down here by design: the MongoDB lifecycle belongs to
  // the runner that wraps `mocha`, and the API suite's final `db.reset` belongs
  // to test/lib/api/index.js. app.js's 60-second leak-detection interval holds
  // the event loop open, and Mocha 3.5.3 force-exits after the run, so no
  // `--exit` flag or `process.exit()` call is needed or wanted.
});
