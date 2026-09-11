var _            = require('underscore'),
    db           = require('../../config/db'),
    mongoose     = require('mongoose'),
    initializing = true,
    instance;

/**
 * Rebuilds the indexes every registered model declares.
 *
 * WHY THIS EXISTS. Mongoose builds a schema's indexes exactly once, at model
 * registration, and `dropDatabase` takes them away with the collections. Both
 * drops in this file used to end there, so from the first drop onwards every
 * declared index was gone and DB-level uniqueness was silently unenforced:
 * measured on this tree, `snippets` went from 14 indexes including
 * `shortCode_1` to 1 with no `shortCode_1`, and
 * `insertMany([{shortCode:'dupdupdup1'},{shortCode:'dupdupdup1'}])` then
 * SUCCEEDED with `insertedCount: 2` instead of raising E11000. Every drop here
 * is now followed by this sweep, so the index set after a drop is authoritative
 * rather than whatever survived it.
 *
 * `createIndexes()` and NOT `init()`. `init()` memoises its work on the model's
 * `$init` promise, so a second call resolves immediately having built nothing -
 * which, after a drop, is exactly the wrong answer.
 *
 * The live registry, not a list kept here. `mongoose.modelNames()` is read on
 * every call, so a model added to `lib/models/**` is covered without this file
 * being edited, and a model that is not registered in a given run contributes
 * no work. Models are addressed as `mongoose.model(name)` because
 * `lib/models/*.js` export the `publicModel` WRAPPER built by
 * `lib/models/model.js`, which carries no `createIndexes`.
 *
 * THE EMPTY-DATABASE CONTRACT IS NOT WEAKENED, and this is the reasoning a
 * later reader must not simplify away. AAP 0.9.2 requires `reset` to stay an
 * empty-database operation, because the serial suite depends on the emptiness:
 * `test/lib/api/registration.js` asserts the default user is absent and then
 * creates it. What that assertion reads is a DOCUMENT COUNT, and creating an
 * index creates only an EMPTY collection - zero documents - so the contract
 * holds. It is also the only shape a rebuild can take, since an index cannot
 * exist without a collection. No fixture, no document and no seeding belongs
 * here; `test/parity/seed.js` owns fixtures, and it owns them precisely so this
 * function never has to.
 *
 * A FAILED BUILD IS REPORTED AND CONTINUED PAST, never propagated. `reset` is
 * installed directly as a Mocha hook - `before(db.reset)` at
 * test/lib/api/index.js:16 and test/lib/models/user.js:7, `db.reset(done)` at
 * test/lib/api/index.js:26 - and a hook handed an error aborts its whole suite,
 * which would turn one fixture problem into dozens of unrun cases and break the
 * suite-total gate in test/lib/api/index.js. Reporting rather than throwing also
 * keeps the failure mode bounded: the callback is invoked exactly once on every
 * path, including a synchronous fault reading the registry, so no hook can hang
 * waiting for it. The message states what a missing index MEANS rather than
 * merely naming it, and the mechanical gate is elsewhere:
 * `test/parity/seed.js`'s `verify()` asserts that the declared unique indexes
 * are actually present, so this condition is caught by a gate and not only by a
 * reader of stderr.
 *
 * @param {function()} next invoked exactly once, with no argument, whatever
 *   the sweep found
 */
function rebuildIndexes(next) {
  var pending;

  try {
    pending = Promise.all(mongoose.modelNames().map(function(name) {
      return mongoose.model(name).createIndexes().catch(function(err) {
        reportIndexFailure(name, err);
      });
    }));
  }
  catch (err) {
    // Reading the registry or resolving a model threw synchronously, so there
    // is no promise to wait on and the callback must still fire.
    reportIndexFailure('(model registry)', err);
    return next();
  }

  // Both handlers on one `then`, so exactly one of them runs. The rejection
  // handler is unreachable while every element above catches its own failure,
  // and it is here so that it stays unreachable rather than depending on that
  // remaining true.
  pending.then(function() { next(); }, function(err) {
    reportIndexFailure('(index sweep)', err);
    next();
  });
}

/**
 * Reports an index that could not be rebuilt, in terms of the consequence.
 *
 * @param {string} name the model, or a bracketed phase for a sweep-level fault
 * @param {Error} err
 */
function reportIndexFailure(name, err) {
  console.error(
    'test/helpers/db: could not rebuild the indexes for ' + name +
    ' after clearing the test database: ' + ((err && err.message) || err) +
    '. Any unique index that model declares is now UNENFORCED at the database ' +
    'level for the remainder of this run, so a duplicate will be accepted ' +
    'instead of rejected with E11000.'
  );
}

function DB() {
  this._isConnected = false;
  _.bindAll(this, 'ensureConnection', 'reset');
}

_.extend(DB.prototype, {
  ensureConnection : function(done) {
    var self = this;

    if (self.isConnected()) return done();

    (function wait() {
      if (self.isConnected()) {
        return done();
      }
      setTimeout(wait, 0);
    })();
  },

  reset : function(done) {
    if (!this.isConnected()) return done();

    // The drop's own error stays ignored, as it always has been: this callback
    // takes no `err` and `done` is called with no argument, which is what the
    // hooks above are written against. The indexes are rebuilt either way -
    // after a drop that failed the collections are still there and the sweep is
    // a no-op, and after one that succeeded it is the whole point.
    mongoose.connection.db.dropDatabase(function() {
      rebuildIndexes(done);
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
        // The same rebuild as `reset`, and needed here for the same reason plus
        // one more: every model is already registered when this runs -
        // test/lib/00-ready.js requires app.js and the nine legacy model
        // bindings at :98-127 and this file only at :134 - so this drop lands
        // among the `autoIndex` builds that registration started. Whatever
        // those builds managed (one was observed on this tree failing with
        // "Index build failed ... operation was interrupted"), the sweep
        // afterwards is what decides the index set, so the very first spec runs
        // against a fully indexed database instead of a racing one.
        mongoose.connection.db.dropDatabase(function() {
          rebuildIndexes(function() {
            instance._isConnected = true;
          });
        });
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
