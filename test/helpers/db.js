// This helper is the only module in the tree that DELETES A WHOLE DATABASE, so it takes responsibility
// for its own preconditions rather than trusting the order Mocha happened to load files in. Requiring
// the bootstrap first is what guarantees `NODE_ENV=test` (and, for a parallel clone, the CLONE_INDEX
// database namespace) is in place before `../../config/db` below resolves node-config and opens the
// connection. Measured on mocha 11.7.6 by calling its own `mocha/lib/cli/collect-files` with this
// project's options: `collect-files` does not sort, this helper is collected FOURTH of the 45 `.js` files
// under test/ and test/setup.js is collected LAST (45th), so without this line the connection would be
// opened against whatever environment the shell happened to carry - which for a developer running
// `npx mocha` in a working checkout is the DEVELOPMENT database. The two ordinals are what the argument
// rests on and both are re-verified above; the total is `git ls-files | grep -cE '^test/.*\.js$'` and
// moves with every suite added.
//
// The cycle this creates is benign and deliberate: test/setup.js also requires this file, so when this
// file is entered first, setup.js's own `db` binding resolves to the partially initialized module
// (`{}`). setup.js never reads that binding - it requires this module only to start the connection - and
// by the time any test runs `module.exports` below has been assigned, so every other consumer receives
// the real instance. Entering setup.js first is equally safe: this file's `require('../setup')` returns
// setup.js's partial exports, which this file likewise never reads.
require('../setup');

var _            = require('underscore'),
    db           = require('../../config/db'),
    mongoose     = require('mongoose'),
    // The ENDPOINT half of this gate used to be declared here. It now lives in one side-effect-free
    // module that test/baseline/capture.js requires too, because that second destructive caller had no
    // endpoint check at all (review finding SV-04) and two copies of a security gate drift.
    endpointGate = require('./disposable-endpoint'),
    initializing = true,
    instance;

// SECURITY GATE (review finding M1, CWE-20). `dropDatabase()` deletes everything, and the name it acts
// on is whatever node-config finally resolved - not necessarily what config/test.yaml says. `local.yaml`
// is loaded after `test.yaml`, `NODE_CONFIG` is layered above both, and every parallel clone of this
// repository reads the same files, so the effective target can be a development database, a colleague's
// database, or another clone's. The name is therefore validated against this pattern IMMEDIATELY before
// every destructive call, and anything that does not match fails the suite instead of being deleted.
//
// `test` is the name config/test.yaml declares. `test_<suffix>` / `test-<suffix>` admit the per-clone
// namespace test/setup.js derives from CLONE_INDEX. Nothing else is disposable: a name like
// `trinket`, `trinket_test`, `production` or `test.backup` fails closed.
var DISPOSABLE_DATABASE = /^test([_-][A-Za-z0-9][A-Za-z0-9_-]*)?$/;

// THE ENDPOINT half of the gate (review finding F-01). The name alone is not enough, and this helper's own
// documentation said so: a production deployment can legitimately own a database called `test`. So the
// HOST the driver is actually talking to is validated too, against a loopback-only allow-list.
//
// The implementation moved to ./disposable-endpoint (review finding SV-04). It was declared here and
// nowhere else, which meant the tree's OTHER destructive caller - test/baseline/capture.js - had no
// endpoint check at all while claiming in its own docblock to be this function applied to a second
// caller. It is now one module both files require, so neither can be hardened without the other.
var nonDisposableIdentityReasons = endpointGate.nonDisposableIdentityReasons;

/**
 * Fails closed unless the process is running as a test AND the live connection is pointed at a disposable
 * database on a disposable endpoint.
 *
 * All three halves are required. `NODE_ENV` alone is not enough, because NODE_CONFIG can repoint the
 * database without touching NODE_ENV - a read-only probe confirmed exactly that. The database name alone is
 * not enough either, because a production deployment could legitimately own a database called `test`. And
 * the name plus the environment is still not enough, because the endpoint that name resolves on is assembled
 * from ten further configuration keys (`config/db.js:L7-L33`) that a `local.yaml` can supply - which is why
 * the complete connection identity is validated here, immediately before every destructive call.
 *
 * @param {string} operation A short label naming the caller, used in the thrown message.
 * @returns {string} The validated database name.
 * @throws {Error} When the environment is not `test`, the connection is not open, the resolved database
 *   name is not disposable, or the live endpoint is not a credential-free loopback server.
 */
function assertDisposableDatabase(operation) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('db helper refused to ' + operation + ': NODE_ENV is ' +
      JSON.stringify(process.env.NODE_ENV) + ', not "test". Run the suite through `npm test`.');
  }

  var connection = mongoose.connection;

  if (!connection || !connection.db) {
    throw new Error('db helper refused to ' + operation + ': there is no open mongoose connection to ' +
      'validate, so the target database cannot be identified.');
  }

  // `connection.name` is what mongoose recorded for the live connection; `connection.db.databaseName`
  // is what the driver is actually addressing. They agree in every normal case, and the stricter of the
  // two is used so that a mismatch cannot slip a non-disposable name past this gate.
  var name       = connection.name,
      driverName = connection.db.databaseName;

  if (!name || !driverName || name !== driverName) {
    throw new Error('db helper refused to ' + operation + ': mongoose reports database ' +
      JSON.stringify(name) + ' while the driver is addressing ' + JSON.stringify(driverName) + '.');
  }

  if (!DISPOSABLE_DATABASE.test(name)) {
    throw new Error('db helper refused to ' + operation + ' the database ' + JSON.stringify(name) +
      ': only "test" and "test_<suffix>" are treated as disposable. Set CLONE_INDEX, or point ' +
      'db.mongo.database at a disposable name, before running the suite.');
  }

  var reasons = nonDisposableIdentityReasons(connection);

  if (reasons.length) {
    throw new Error('db helper refused to ' + operation + ' the database ' + JSON.stringify(name) +
      ': ' + endpointGate.refusalTail(reasons) + ' test/setup.js forces that identity through ' +
      '$NODE_CONFIG; a run that reaches here has had it overridden.');
  }

  return name;
}

function DB() {
  this._isConnected = false;
  // Set when the initial drop below fails. Every hook consults it, so a failed initialization aborts the
  // suite with the original error instead of polling for a connection that will never be announced.
  this._initError   = null;

  // `_.bindAll` is kept exactly as the base commit wrote it. Underscore 1.13.8 - the version the base
  // lockfile already resolved `^1.8.3` to - dropped `_.bind`'s native-bind fast path, so the bound wrappers
  // report `length === 0` and Mocha, which reads `fn.length` to decide whether a hook is asynchronous
  // (`mocha/lib/runnable.js:42`), invoked both hooks with no callback. The arity is restored in
  // test/setup.js, the single surface authorised to adapt this integration, so this destructive helper
  // carries no adaptation of its own and every existing call site behaves as the base commit wrote it.
  _.bindAll(this, 'ensureConnection', 'reset');
}

_.extend(DB.prototype, {
  ensureConnection : function(done) {
    var self = this;

    if (self._initError) return done(self._initError);
    if (self.isConnected()) return done();

    (function wait() {
      if (self._initError) {
        return done(self._initError);
      }
      if (self.isConnected()) {
        return done();
      }
      setTimeout(wait, 0);
    })();
  },

  /**
   * Empties the test database, WAITING for the connection and the initialization drop first.
   *
   * Review finding M12. The earlier form opened with `if (!this.isConnected()) return done();` - it
   * reported SUCCESS while the database was untouched. Two distinct failures followed from that. A suite
   * whose `before(db.reset)` ran before `checkState()` had announced the connection started over
   * whatever the previous run left behind, which is the shared-state race that made the API suites
   * order-dependent in a way their own comments say they must not be; and the initialization drop could
   * still be in flight, so a reset that "succeeded" could be immediately followed by the initialization
   * drop deleting fixtures the first test had already created.
   *
   * `ensureConnection` is the existing barrier for exactly that condition - it polls `_isConnected`,
   * which `checkState()` sets ONLY after the initialization drop has resolved - so reset now goes
   * through it rather than past it. There is no new mechanism and no new state: a connection that never
   * arrives still surfaces as the Mocha hook's own timeout, and `_initError` still short-circuits with
   * the original error.
   *
   * @param {Function} done Mocha's callback; called with an error, or with nothing on success.
   * @returns {void}
   */
  reset : function(done) {
    var self = this;

    if (self._initError) return done(self._initError);

    self.ensureConnection(function(connectionError) {
      if (connectionError) {
        return done(connectionError);
      }

      try {
        assertDisposableDatabase('reset');
      }
      catch (err) {
        return done(err);
      }

      // Async idiom, and review finding M2 (CWE-252). The base commit passed a callback that discarded
      // its `err` argument and reported success unconditionally, so a failed drop left every following
      // test running over stale users, sessions, bcrypt hashes, reset tokens and fixtures while the
      // suite still looked healthy. The promise form has no argument to discard: a rejection is handed
      // straight to the Mocha hook, which fails the run at the point of failure.
      mongoose.connection.db.dropDatabase().then(
        function() { done(); },
        done
      );
    });
  },

  isConnected : function() {
    return this._isConnected;
  }
});

instance = new DB();

function checkState() {
  switch(mongoose.connection.readyState) {
    case 0:
      console.log('mongoose connection died, reconnecting...');
      db.connect();
    case 1:
      // if initializing, clear the db
      if (initializing) {
        initializing = false;

        try {
          assertDisposableDatabase('initialize');
        }
        catch (err) {
          // There is no hook to reject from here - this runs from a timer during module load - so the
          // error is parked where every hook looks for it, and `_isConnected` is deliberately left
          // false. `console.error` as well, because a suite that aborts on the first hook should say why
          // even if the reporter output scrolls past.
          instance._initError = err;
          console.error(err.message);
          break;
        }

        // Review finding M2. `_isConnected` is set ONLY after the drop has actually succeeded; a
        // rejection is parked in `_initError` instead, so no test can run against a database that was
        // supposed to be empty and is not.
        mongoose.connection.db.dropDatabase().then(
          function() {
            instance._isConnected = true;
          },
          function(err) {
            instance._initError = err;
            console.error('db helper failed to clear the test database: ' + err.message);
          }
        );
      }
      else {
        instance._isConnected = true;
      }
      
      break;
    default:
      setTimeout(checkState, 0);
  }
}

checkState();

module.exports = instance;
