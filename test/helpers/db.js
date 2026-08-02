var _            = require('underscore'),
    db           = require('../../config/db'),
    mongoose     = require('mongoose'),
    initializing = true,
    instance;

function DB() {
  this._isConnected = false;

  // Async idiom. `_.bindAll` is replaced by `Function.prototype.bind` because underscore dropped its
  // native-bind fast path: `_.bind` now returns a `restArguments` wrapper whose `length` is 0. Measured on
  // the installed underscore 1.13.8 - which is also the version the base commit resolved `^1.8.3` to, so
  // this is a latent defect the base suite never reached rather than a migration regression - a bound
  // `reset` reports `length === 0` while the unbound method and a natively-bound method both report 1.
  // Mocha decides whether a hook is asynchronous from `fn.length` (`mocha/lib/runnable.js:42`), so the
  // arity-0 wrapper was invoked with no callback and threw `TypeError: done is not a function` inside the
  // `before(db.reset)` hooks at test/lib/api/index.js:15 and test/lib/models/user.js:7. Native `bind`
  // preserves the declared arity, which keeps every existing call site - the bare-reference hooks and the
  // explicit `db.reset(done)` at test/lib/api/index.js:25 - working exactly as written at the base commit.
  this.ensureConnection = DB.prototype.ensureConnection.bind(this);
  this.reset = DB.prototype.reset.bind(this);
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

    mongoose.connection.db.dropDatabase(function() {
      done();
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
        mongoose.connection.db.dropDatabase(function() {
          instance._isConnected = true;
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
