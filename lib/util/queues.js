var config = require('config');

// Absent configuration reads as enabled, so only an explicit `false` selects the
// in-memory queue.
var redisEnabled = config.db && config.db.redis && config.db.redis.enabled !== false;

// In-memory queue implementation for when Redis is not available
function InMemoryQueue(name) {
  this.name = name;
  this.handlers = [];
  this.processing = false;
  this.jobs = [];
}

InMemoryQueue.prototype.process = function(handler) {
  this.handlers.push(handler);
};

InMemoryQueue.prototype.add = function(data, opts) {
  var self = this;
  var job = {
    id: Date.now() + '-' + Math.random().toString(36).substr(2, 9),
    data: data,
    opts: opts || {},
    attempts: 0
  };

  // Process immediately in next tick (simulates async queue behavior)
  setImmediate(function() {
    self._processJob(job);
  });

  return Promise.resolve(job);
};

InMemoryQueue.prototype._processJob = function(job) {
  var self = this;

  if (this.handlers.length === 0) {
    // No handlers registered, job is essentially dropped
    // This is fine for optional features like analytics/events
    return;
  }

  this.handlers.forEach(function(handler) {
    try {
      var result = handler(job, function done(err) {
        if (err) {
          console.log('InMemoryQueue [' + self.name + '] job failed:', err.message);
        }
      });

      // Handle promise-based handlers
      if (result && typeof result.catch === 'function') {
        result.catch(function(err) {
          console.log('InMemoryQueue [' + self.name + '] job failed:', err.message);
        });
      }
    } catch (err) {
      console.log('InMemoryQueue [' + self.name + '] job error:', err.message);
    }
  });
};

InMemoryQueue.prototype.on = function(event, handler) {
  // No-op for compatibility - in-memory queue doesn't emit events
  return this;
};

InMemoryQueue.prototype.close = function() {
  return Promise.resolve();
};

// No-op queue for features that are disabled
function NoOpQueue(name) {
  this.name = name;
}

NoOpQueue.prototype.process = function() {};
NoOpQueue.prototype.add = function() { return Promise.resolve({ id: 'noop' }); };
NoOpQueue.prototype.on = function() { return this; };
NoOpQueue.prototype.close = function() { return Promise.resolve(); };

var cache = {};

// List of queues that should be completely disabled (no-op)
var disabledQueues = ['receipts', 'reports', 'containers', 'notifier', 'events', 'snapshots', 'courses', 'trinkets', 'folders'];

// The two ioredis behaviours a Redis outage is decided by, and the values they
// have when configuration is silent about them.
//
// These are NOT new behaviour. They are the values that were already in force,
// arrived at by accident: Bull 4 hands opts.redis straight to ioredis 5, and
// this file used to forward host, port and sometimes password and nothing else,
// so ioredis's own defaults applied to everything that matters when Redis is
// gone. Measured on the delivered tree before this change: the live command
// client reported maxRetriesPerRequest 20 and enableOfflineQueue true. Setting
// them here to those same two values therefore changes nothing on a healthy
// Redis - what it buys is that the outage behaviour is a DECISION recorded in
// source and reachable from configuration, rather than a property of whichever
// ioredis a future lockfile resolves.
//
// What each one does when the server is unreachable:
//
//   maxRetriesPerRequest  ioredis holds commands issued while the connection is
//                         down, and every reconnect attempt increments a
//                         counter; when that counter passes this limit the held
//                         commands are REJECTED with MaxRetriesPerRequestError.
//                         So this is what makes a failed enqueue DELIVERABLE.
//                         `null` is a meaningful value and is forwarded as
//                         such: it means retry forever, and an enqueue then
//                         never settles at all.
//   enableOfflineQueue    whether commands are held at all. `false` rejects an
//                         enqueue immediately instead of after the retries -
//                         faster degradation, at the cost of losing jobs
//                         issued during a blip a reconnect would have covered.
//
// Only ONE of Bull's three clients is affected by the first of them, and that
// is what makes forwarding it safe. Bull's own createClient
// (node_modules/bull/lib/queue.js:290-297) overrides maxRetriesPerRequest to
// `null` for the `bclient` and `subscriber` types and passes the configuration
// through unchanged only for `client` - the command client, and the one
// `add()` uses. Bull's MISSING_REDIS_OPTS guard (:316-319) fires only on a
// TRUTHY maxRetriesPerRequest on those two client types, and the value it sees
// there is the forced `null`, so a bounded limit set here cannot trip it.
var DEFAULT_MAX_RETRIES_PER_REQUEST = 20;
var DEFAULT_ENABLE_OFFLINE_QUEUE    = true;

// THE THIRD OUTAGE BEHAVIOUR - for how long reconnection is attempted AT ALL -
// is left to Bull's own strategy, and this is the measurement that decided it,
// recorded here because "we did not set it" and "we set it to Bull's value"
// look identical in a diff and are not the same decision.
//
// WHAT WAS MEASURED, on both trees, with `db.redis` pointed at a loopback port
// measured to refuse connections and the same queue-level `error` listener
// lib/workers/exports.js registers:
//
//   this tree (bull 4.16.5 / ioredis 5.11.1)
//       30 error events in 120s, in pairs 20010ms apart, still arriving at that
//       rate when the window closed. Bull fills in
//       `retryStrategy: times => Math.min(Math.exp(times), 20000)`
//       [node_modules/bull/lib/queue.js:133] and ioredis calls it on every
//       close with no cap [ioredis/built/redis/event_handler.js:187], so the
//       reconnect loop never ends.
//   base commit 2f8712a (bull 0.7.2 / node_redis 2.8.0)
//       36 events in 150s with the gap already 40345ms and growing - node_redis
//       backs off by 1.7x from 200ms [redis/index.js:330-331,567] - and it
//       STOPS once the cumulative retry time reaches `connect_timeout`,
//       3600000ms by default [redis/index.js:132,635-640]: about nineteen
//       attempts, then the client is ended for good.
//
// SO A TERMINAL BUDGET WAS THE OBVIOUS FIX, AND IT WAS TRIED AND MEASURED HERE
// BEFORE BEING REJECTED. A `retryStrategy` that returns a non-number once a
// cumulative budget elapses does end the reconnect loop - ioredis sets the
// client to `end` and flushes what it held - but it also makes TWO promises
// reject with the connect error: the one `exportsQueue.process()` returns,
// which the worker could contain, and a second one inside Bull that no
// application handler reaches. With no process-level handler installed, the
// worker DIED on it - `node test/parity/mongo.js -- node -e
// 'require("./lib/workers/exports")'` against a dead Redis exited 1 out of
// `node:internal/process/promises` triggerUncaughtException - and with the
// reachable one handled the process merely survived as a worker that would
// never process another job until restarted. An export worker that stops on an
// outage is a worse outcome than a repeated log line, and QA already recorded
// process death by unhandled rejection as a defect in its own right.
//
// Bull's curve is also what times the DELIVERABLE failure
// lib/controllers/users.js reports: at the documented limit of 20, ioredis
// flushes held commands on attempt 21, measured at about four minutes, whereas
// the base commit delivered that same failure only when node_redis's one-hour
// `connect_timeout` ended the client. On the one behaviour here that reaches a
// user, the delivered curve is better than the baseline's, and R-d's
// prohibition on improvements is not a licence to make it worse.
//
// The finding this decision answers - repeated ECONNREFUSED logging without
// end - is therefore bounded where the log is WRITTEN rather than where the
// socket is retried: lib/workers/exports.js collapses an unbroken run of
// identical queue-level errors into a first line plus counted summaries at a
// doubling interval, which reproduces the base commit's decaying report shape
// without touching this transport's semantics at all.

/**
 * Reads one Redis option for a queue, across both entries that can carry it.
 *
 * Presence, not truthiness. `0`, `false` and `null` are all values an operator
 * can legitimately mean here, so the lookup asks whether the key IS THERE
 * rather than whether it reads as true - which is the same discipline the
 * credential lookup above follows for the opposite reason.
 *
 * The order is the one the rest of this function uses: the queue's own entry
 * first, then the shared db.redis.app entry. A named queue entry carries host
 * and port only in committed configuration, so a value set once on `app`
 * applies to every queue, and a queue that needs its own can still say so.
 * Both are read defensively, because a configuration that names a queue need
 * not declare `app` at all and vice versa.
 *
 * @param {string} name  Queue name, which is also the configuration key.
 * @param {string} key   The ioredis option to read.
 * @returns {*} The configured value, or undefined when neither entry has it.
 */
function readRedisOption(name, key) {
  var entries = [config.db.redis[name], config.db.redis.app];
  var i;

  for (i = 0; i < entries.length; i++) {
    if (entries[i] && Object.prototype.hasOwnProperty.call(entries[i], key)) {
      return entries[i][key];
    }
  }

  return undefined;
}

/**
 * Resolves maxRetriesPerRequest for one queue.
 *
 * Validated rather than forwarded blind: this value is handed to ioredis, and
 * a string or an object arriving there would not fail loudly - ioredis tests
 * `typeof maxRetriesPerRequest === 'number'` and silently ignores anything
 * else, which would put the queue back on an unbounded retry with nothing said
 * about it. A rejected value is logged with the value that was rejected and the
 * default that replaced it, so a typo in a deployment's YAML is visible in the
 * boot log rather than inferred later from a hung export.
 *
 * `null` passes through untouched: it is ioredis's own way of saying "retry
 * forever" and it is the value Bull itself forces on its blocking clients.
 * A negative number is refused instead, even though ioredis treats it as
 * another spelling of the same thing, because `null` already says it clearly
 * and a negative limit is far more likely to be a mistake.
 *
 * @param {string} name Queue name.
 * @returns {?number} A non-negative integer, or null for retry-forever.
 */
function resolveMaxRetriesPerRequest(name) {
  var configured = readRedisOption(name, 'maxRetriesPerRequest');

  if (configured === undefined) {
    return DEFAULT_MAX_RETRIES_PER_REQUEST;
  }

  if (configured === null) {
    return null;
  }

  if (typeof configured === 'number' && isFinite(configured) &&
      configured >= 0 && Math.floor(configured) === configured) {
    return configured;
  }

  console.log('Queue [' + name + '] ignoring maxRetriesPerRequest ' +
    JSON.stringify(configured) + ': it must be a non-negative integer, or ' +
    'null to retry forever. Using ' + DEFAULT_MAX_RETRIES_PER_REQUEST + '.');

  return DEFAULT_MAX_RETRIES_PER_REQUEST;
}

/**
 * Resolves enableOfflineQueue for one queue.
 *
 * Booleans only, and for a sharper reason than tidiness: ioredis reads this one
 * for truthiness, so the string `'false'` out of a YAML file or an environment
 * overlay would ENABLE the offline queue while reading as if it disabled it.
 * That is the one mistake here that inverts a behaviour silently, so a
 * non-boolean is refused and logged.
 *
 * @param {string} name Queue name.
 * @returns {boolean}
 */
function resolveEnableOfflineQueue(name) {
  var configured = readRedisOption(name, 'enableOfflineQueue');

  if (configured === undefined) {
    return DEFAULT_ENABLE_OFFLINE_QUEUE;
  }

  if (typeof configured === 'boolean') {
    return configured;
  }

  console.log('Queue [' + name + '] ignoring enableOfflineQueue ' +
    JSON.stringify(configured) + ': it must be a boolean, and a non-boolean ' +
    'would be read for truthiness by ioredis - so "false" would enable it. ' +
    'Using ' + DEFAULT_ENABLE_OFFLINE_QUEUE + '.');

  return DEFAULT_ENABLE_OFFLINE_QUEUE;
}

function createQueue(name) {
  if (cache[name]) {
    return cache[name];
  }

  if (disabledQueues.indexOf(name) >= 0) {
    console.log('Queue [' + name + '] is disabled, using no-op queue');
    cache[name] = new NoOpQueue(name);
    return cache[name];
  }

  if (redisEnabled) {
    // Bull 4.x. The require stays inside this branch deliberately: when Redis is
    // disabled (config/test.yaml sets db.redis.enabled to false) Bull is never loaded
    // at all, so nothing in the test or route-parsing path reaches for localhost:6379.
    // Hoisting this to the top of the file would undo that.
    var Queue = require('bull');
    // Per-queue Redis settings, falling back to the shared app connection when the
    // queue has no entry of its own.
    var queueConfig = config.db.redis[name] || config.db.redis.app;
    // The Redis credential lives under `pass`: that is the key configuration
    // declares (db.redis.app.pass) and the key config/redis.js reads. A `password`
    // spelling on the same entry is accepted as an alias. A named queue entry
    // carries host and port only, so the credential for it comes from the shared
    // db.redis.app entry, which is read defensively because a configuration that
    // names a queue need not declare `app` at all.
    var sharedRedisConfig = config.db.redis.app || {};
    var queuePassword = queueConfig.pass || queueConfig.password ||
      sharedRedisConfig.pass || sharedRedisConfig.password;
    var opts = {};

    // Bull passes opts.redis straight through to its Redis client, so what is
    // built here is literally the ioredis constructor's options object.
    //
    // The retry and offline-queue options are set EXPLICITLY, at their
    // documented defaults, so that the way this application behaves when Redis
    // is unreachable is decided here and not inherited from whichever ioredis
    // the lockfile happens to resolve. See the two constants above for what
    // each one does and why forwarding maxRetriesPerRequest is safe against
    // Bull's own blocking clients. Both are always present, because both always
    // have a value - the resolvers return the documented default rather than
    // undefined, and an `undefined` key would leave ioredis back on its own
    // default while looking as though a decision had been made.
    //
    // The password is the one key whose PRESENCE varies, and that discipline is
    // unchanged: adding an always-present `password: undefined` would change
    // what the client is handed rather than leaving the key absent, so the two
    // shapes still differ by the presence of that key and never by its value.
    // It is now a conditional assignment onto one object rather than two object
    // literals, which is the same rule expressed once instead of twice - the
    // duplication was what made the earlier shape easy to extend on one branch
    // and forget on the other.
    //
    // `retryStrategy` is deliberately NOT among them, and the measurement that
    // decided that is recorded with the two constants above.
    opts.redis = {
      host: queueConfig.host,
      port: queueConfig.port,
      maxRetriesPerRequest: resolveMaxRetriesPerRequest(name),
      enableOfflineQueue: resolveEnableOfflineQueue(name)
    };

    if (queuePassword) {
      opts.redis.password = queuePassword;
    }

    // new Queue(name, opts) is Bull's (queueName, opts) form: the second parameter is
    // only read as a connection URL when it is a string, otherwise it is the options
    // object. The name must stay the first argument - it is the Redis key namespace
    // (bull:<name>:<type>) and the identity lib/workers/exports.js registers against.
    cache[name] = new Queue(name, opts);
    console.log('Queue [' + name + '] using Bull with Redis');
  } else {
    cache[name] = new InMemoryQueue(name);
    console.log('Queue [' + name + '] using in-memory queue (Redis not configured)');
  }

  return cache[name];
}

// Export queue getters for each queue type. Only the names in this list get a getter,
// so the export surface follows configuration and nothing is exported speculatively.
var bullqueues = config.db && config.db.redis && config.db.redis.bullqueues
  ? config.db.redis.bullqueues
  : ['exports'];

// Each getter is a function, and callers invoke it at require time
// (lib/workers/exports.js and lib/controllers/users.js both do), so the call form is
// part of the contract - it cannot become a plain property or a lazy accessor.
bullqueues.forEach(function(queueName) {
  module.exports[queueName] = function() {
    return createQueue(queueName);
  };
});

module.exports.isRedisEnabled = function() {
  return redisEnabled;
};

// Close every queue built so far. Bull's close() returns a promise that settles whether
// or not the queue ever reached its Redis server, and the in-memory and no-op queues
// return an already-resolved promise, so one Promise.all covers all three kinds and
// teardown cannot be left waiting on a connection that never came up.
module.exports.closeAll = function() {
  var promises = Object.keys(cache).map(function(name) {
    return cache[name].close();
  });
  return Promise.all(promises);
};
