var mongoose = require('mongoose'),
    // mongoose-schema-extend is deprecated but still used by lib/models/model.js
    // TODO: Migrate to native mongoose discriminators
    extend   = require('mongoose-schema-extend'),
    dbconfig = require('config').db;

// `strictQuery` is set explicitly: query filters keep dropping fields the schema does not declare, and connect() warns whenever the option is left undefined.
mongoose.set('strictQuery', true);

var mongo_creds = dbconfig.mongo.user && dbconfig.mongo.pass
  ? dbconfig.mongo.user + ':' + dbconfig.mongo.pass + '@' : '';

var read_creds = dbconfig.mongoread.user && dbconfig.mongoread.pass
  ? dbconfig.mongoread.user + ':' + dbconfig.mongoread.pass + '@' : '';

// ---------------------------------------------------------------------------
// Connection pool sizing
// ---------------------------------------------------------------------------
// `connect()` was called with no options at all, which left the driver's own
// defaults in force: `maxIdleTimeMS` 0 (never retire an idle connection),
// `minPoolSize` 0 and `maxPoolSize` 100. Under load the pool therefore grew to
// demand - measured 8 -> 22 -> 100 - and then held every socket it had opened,
// still 22 of 22 through a 30 s idle period. Nothing leaked, but the process
// never came back to its resting footprint.
//
// `maxIdleTimeMS` 15000. An idle socket is retired after 15 s, so a quiet
// period of the length that is actually measured against this application (a
// 30 s cooldown) brings the pool back down well inside itself. It is
// deliberately not shorter: every request here reads its session out of
// MongoDB, so the gaps that matter are the sub-second ones inside a page load
// and the few seconds between navigations, and a 15 s horizon keeps a hot
// connection across all of them. It is deliberately not longer: at 30 s or
// 60 s the pool would still be holding its peak through exactly the cooldown
// this is meant to fix. The cost of erring short is one TCP connect plus one
// handshake on the first request after a genuine lull - single-digit
// milliseconds against a database on localhost or inside the same VPC.
//
// `minPoolSize` 1, and this one is load-bearing rather than cosmetic. In the
// driver this repository resolves (mongodb 4.17.2, under mongoose 6) the only
// background pruner is `ConnectionPool.ensureMinPoolSize`, and it returns
// immediately when `minPoolSize` is 0
// [node_modules/mongoose/node_modules/mongodb/lib/cmap/connection_pool.js:436].
// At the driver's default of 0, `maxIdleTimeMS` would retire nothing until the
// next checkout came along and pruned the perished sockets one at a time - so
// an idle process would still be showing its whole peak, which is the
// measurement being answered. A floor of 1 starts the 100 ms maintenance timer
// that does the pruning, and it doubles as the answer to the trade-off above:
// one connection stays warm, so the request arriving after a lull pays nothing.
// That floor is held by replacement, so a completely idle process reopens that
// single socket once per `maxIdleTimeMS` - four handshakes a minute at these
// numbers, measured, against a pool that otherwise kept its entire peak open
// indefinitely.
//
// `maxPoolSize` is left to the driver (100) unless configuration names a value.
// The ceiling was never the problem, and lowering it would convert a burst into
// wait-queue time.
//
// All three are overridable through `config.db.mongo`, read defensively because
// the committed configuration declares none of them, and validated because a
// non-integer or out-of-range value must not reach the driver: MongoClient
// rejects those by throwing, which would take the process down at boot rather
// than being quietly ignored.
var POOL_DEFAULTS = {
  maxIdleTimeMS : 15000,
  minPoolSize   : 1
};

// Reports a rejected setting through the global winston logger the entry point
// installs, falling back to the console because this module is also required
// directly by the test harness, where that global does not exist.
function warnPoolSetting(message) {
  if (typeof log !== 'undefined' && log && typeof log.warn === 'function') {
    log.warn(message);
  }
  else {
    console.warn(message);
  }
}

// The single rejection message, so a value of the wrong type and a number out
// of range are reported identically: to an operator reading the log they mean
// the same thing, and the setting that was refused plus the value that took its
// place are what make the line actionable.
function poolSettingRejected(name, minimum, raw, fallback) {
  return 'db.mongo.' + name + ' must be an integer >= ' + minimum
    + '; got ' + JSON.stringify(raw) + ', '
    + (fallback === null ? 'leaving the driver default in force' : 'using ' + fallback + ' instead');
}

// Reads one pool setting out of `config.db.mongo`, returning `fallback` when it
// is absent or unusable. A usable value is a number, or a string holding one,
// that resolves to an integer at or above `minimum`; quoted numbers are
// accepted because YAML happily quotes them.
//
// The type guard ahead of the conversion is load-bearing rather than defensive
// tidiness. `Number()` turns several values a configuration file can plausibly
// carry into perfectly valid integers: `Number(false)` is 0, `Number([250])` is
// 250, and `Number('   ')` is 0. Converting first would therefore have accepted
// a YAML `maxIdleTimeMS: false` as zero without a word, which is exactly the
// pool that never retires a connection that this module exists to prevent, and
// would have honoured a one-element list as its own contents. So only a real
// number or a non-blank string is offered to `Number()`, and every other type
// is reported and falls back to the documented default.
function poolSetting(name, minimum, fallback) {
  var raw = dbconfig.mongo ? dbconfig.mongo[name] : undefined;

  // Absent, or blanked out the way the committed configuration blanks an unset
  // credential, means "not configured" and is not worth a warning.
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  var numeric = typeof raw === 'number';
  var parseable = typeof raw === 'string' && raw.trim() !== '';

  if (!numeric && !parseable) {
    warnPoolSetting(poolSettingRejected(name, minimum, raw, fallback));
    return fallback;
  }

  var value = numeric ? raw : Number(raw.trim());

  if (!isFinite(value) || Math.floor(value) !== value || value < minimum) {
    warnPoolSetting(poolSettingRejected(name, minimum, raw, fallback));
    return fallback;
  }

  return value;
}

// Builds the validated options object handed to `mongoose.connect`. Only keys
// that resolved to a usable value are included, so an unconfigured
// `maxPoolSize` keeps the driver's own default instead of being pinned here.
function poolOptions() {
  var options = {
    maxIdleTimeMS : poolSetting('maxIdleTimeMS', 0, POOL_DEFAULTS.maxIdleTimeMS),
    minPoolSize   : poolSetting('minPoolSize', 0, POOL_DEFAULTS.minPoolSize)
  };

  var maxPoolSize = poolSetting('maxPoolSize', 1, null);

  if (maxPoolSize !== null) {
    options.maxPoolSize = maxPoolSize;

    // The driver refuses a pool whose floor is above its ceiling, so a ceiling
    // configured below the floor clamps the floor rather than throwing at boot.
    if (options.minPoolSize > maxPoolSize) {
      warnPoolSetting('db.mongo.minPoolSize (' + options.minPoolSize + ') exceeds'
        + ' db.mongo.maxPoolSize (' + maxPoolSize + '); using ' + maxPoolSize + ' for both');
      options.minPoolSize = maxPoolSize;
    }
  }

  return options;
}

// Resolved once, at require time, so a rejected value is reported once and the
// reconnect path in test/helpers/db.js reuses the same settings.
var pool_options = poolOptions();

function connect() {
  var connectStr = 'mongodb://'
    + mongo_creds
    + dbconfig.mongo.host + ':'
    + dbconfig.mongo.port + '/'
    + dbconfig.mongo.database;

  if (dbconfig.mongoread.host) {
    connectStr += ','
    + read_creds
    + dbconfig.mongoread.host + ':'
    + dbconfig.mongoread.port + '/'
    + dbconfig.mongoread.database;

    if (dbconfig.mongoread.opts) {
      connectStr += '?' + dbconfig.mongoread.opts;
    }
  }

  mongoose.connect(connectStr, pool_options);
}

connect();

module.exports = {
  connect : connect
};
