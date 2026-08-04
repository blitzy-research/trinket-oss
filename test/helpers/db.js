// This helper is the only module in the tree that DELETES A WHOLE DATABASE, so it takes responsibility
// for its own preconditions rather than trusting the order Mocha happened to load files in. Requiring
// the bootstrap first is what guarantees `NODE_ENV=test` (and, for a parallel clone, the CLONE_INDEX
// database namespace) is in place before `../../config/db` below resolves node-config and opens the
// connection. Measured on mocha 11.7.6: `collect-files` does not sort, this helper is loaded FOURTH of
// the 32 files under test/ and test/setup.js is loaded LAST, so without this line the connection would
// be opened against whatever environment the shell happened to carry - which for a developer running
// `npx mocha` in a working checkout is the DEVELOPMENT database.
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

/**
 * Fails closed unless the process is running as a test AND the live connection is pointed at a database
 * whose name is explicitly disposable.
 *
 * Both halves are required. `NODE_ENV` alone is not enough, because NODE_CONFIG can repoint the database
 * without touching NODE_ENV - a read-only probe confirmed exactly that. The database name alone is not
 * enough either, because a production deployment could legitimately own a database called `test`.
 *
 * @param {string} operation A short label naming the caller, used in the thrown message.
 * @returns {string} The validated database name.
 * @throws {Error} When the environment is not `test`, the connection is not open, or the resolved
 *   database name is not disposable.
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

  reset : function(done) {
    if (this._initError) return done(this._initError);
    if (!this.isConnected()) return done();

    try {
      assertDisposableDatabase('reset');
    }
    catch (err) {
      return done(err);
    }

    // Async idiom, and review finding M2 (CWE-252). The base commit passed a callback that discarded its
    // `err` argument and reported success unconditionally, so a failed drop left every following test
    // running over stale users, sessions, bcrypt hashes, reset tokens and fixtures while the suite still
    // looked healthy. The promise form has no argument to discard: a rejection is handed straight to the
    // Mocha hook, which fails the run at the point of failure.
    mongoose.connection.db.dropDatabase().then(
      function() { done(); },
      done
    );
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
