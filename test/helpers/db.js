var _            = require('underscore'),
    db           = require('../../config/db'),
    mongoose     = require('mongoose'),
    initializing = true,
    instance;

function DB() {
  this._isConnected = false;

  // Bind through the native Function.prototype.bind rather than `_.bindAll`,
  // because Mocha decides whether a hook is asynchronous from its ARITY and
  // `_.bindAll` no longer preserves it.
  //
  // underscore <= 1.8.x delegated `_.bind` to native bind, which reports
  // `length` as the target's arity, so `instance.reset.length` was 1 when this
  // file was written. 1.9+ builds bound copies through `restArguments`, whose
  // length is 0. Mocha 3.5.3 sets `this.async = fn && fn.length`
  // (node_modules/mocha/lib/runnable.js:52), so the bare-reference hooks
  // `before(db.reset)` (test/lib/api/index.js:15, test/lib/models/user.js:7)
  // and `beforeEach(db.ensureConnection)` (test/lib/api/index.js:17) ran as
  // SYNCHRONOUS hooks, were called with no `done`, and threw
  // `TypeError: done is not a function` at `reset` below -- failing the API
  // suite's root `before` and skipping all 69 of its cases.
  //
  // Measured: `node_modules/underscore` resolves to 1.13.8 from BOTH the
  // baseline lockfile at 2f8712a and the regenerated one, so this is
  // pre-existing rather than a consequence of the dependency changes. It was
  // simply unreachable while the suite still died during file collection, which
  // is why it is not among AAP 0.6.5's seven defects.
  //
  // Native bind restores the arity contract the hooks were written against and
  // changes nothing else: the same two methods are bound to the same instance,
  // and `reset` remains an empty-database operation with no seeding.
  this.ensureConnection = DB.prototype.ensureConnection.bind(this);
  this.reset            = DB.prototype.reset.bind(this);
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
