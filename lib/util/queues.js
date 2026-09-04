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

    // The two option shapes are kept separate on purpose. Bull passes opts.redis
    // straight through to its Redis client, so adding an always-present password key
    // would change what the client is handed rather than leaving it absent. The
    // shapes differ by the presence of that key, never by its value.
    if (queuePassword) {
      opts.redis = {
        host: queueConfig.host,
        port: queueConfig.port,
        password: queuePassword
      };
    } else {
      opts.redis = {
        host: queueConfig.host,
        port: queueConfig.port
      };
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
