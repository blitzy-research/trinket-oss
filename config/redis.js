var config = require('config');

// Check if Redis is enabled
var redisEnabled = config.db && config.db.redis && config.db.redis.enabled !== false;

var client = null;
var clientPromise = null;

// Create Redis client with v4 API
async function createClientAsync() {
  if (!redisEnabled) {
    console.log('Redis is disabled, skipping connection');
    return null;
  }

  if (client && client.isOpen) {
    return client;
  }

  var redisConfig = config.db.redis.app;
  if (!redisConfig) {
    console.log('Redis app config not found, skipping connection');
    return null;
  }

  var redis = require('redis');
  var options = {
    socket: {
      host: redisConfig.host,
      port: redisConfig.port
    }
  };

  if (redisConfig.pass) {
    options.password = redisConfig.pass;
  }

  client = redis.createClient(options);

  // A client-level 'error' is logged and nothing more, and the listener itself
  // matters: node-redis throws an 'error' event that has no listener, so
  // without this handler a connection blip would end the process.
  //
  // What is bounded here is the REPETITION, not the reporting. node-redis v4
  // reconnects on a fixed ~500ms schedule and never gives up, and it emits one
  // 'error' per failed attempt, so an unreachable Redis writes this line
  // forever at a constant rate - measured on this tree as 126 lines in 60
  // seconds (2.1 a second, 406 in 200 seconds), which is roughly 180,000 lines
  // a day, every one of them the same text. That is the disk-exhaustion shape
  // this bound exists to remove, and it is removed the same way and with the
  // same constants as the queue-level bound in lib/workers/exports.js, so the
  // two logs behave alike during one outage that affects both.
  //
  // The first occurrence of each distinct error is written immediately and in
  // full, and no repeat is discarded - each summary carries how many arrived
  // and over what interval - so an outage stays visible at both ends and the
  // only thing lost is the repetition. The interval doubles from one minute up
  // to one hour, giving 7 lines in the first hour and about 30 in a day.
  //
  // This is the only respect in which this file departs from the base commit.
  // It changes no HTTP response, no persisted value and no test or parity
  // field - the parity contract covers responses, stored data and file formats,
  // and nothing in test/ or test/parity/ reads this stream - so it is a
  // remediation of the unbounded-log finding rather than a behaviour change.
  var REDIS_ERROR_SUMMARY_FIRST_MS = 60000;
  var REDIS_ERROR_SUMMARY_CAP_MS   = 3600000;

  // The collapsing state. Deliberately not a timer: this module's client is
  // closed on shutdown and a setInterval here would be one more handle to
  // clear, so the interval is measured against the arriving event's own clock.
  //
  //   key         the message of the run's error, which is what makes two
  //               errors "the same" here.
  //   count       repeats seen since the last line was written for this run.
  //   reportedAt  when that line was written.
  //   intervalMs  how long to wait before the next summary of this run.
  var errorRepeat = {
    key        : null,
    count      : 0,
    reportedAt : 0,
    intervalMs : REDIS_ERROR_SUMMARY_FIRST_MS
  };

  // Writes the summary line for the repeats accumulated so far and resets them.
  // The `redis client error event:` prefix is kept, because it is what any
  // consumer of this log filters on. `grow` is false when the run is ending - a
  // different error has arrived - since there is no next summary to space out.
  var flushErrorRepeats = function(now, grow) {
    if (errorRepeat.count === 0) {
      return;
    }

    // Widened before the line is written, so the interval the line quotes is
    // the one that will apply next rather than the one that has just elapsed.
    if (grow) {
      errorRepeat.intervalMs = Math.min(errorRepeat.intervalMs * 2,
        REDIS_ERROR_SUMMARY_CAP_MS);
    }

    console.log(new Date().toString(),
      'redis client error event: same error repeated ' + errorRepeat.count +
      ' more time(s) in the last ' +
      Math.round((now - errorRepeat.reportedAt) / 1000) + 's' +
      (grow ? ', reported again in at most ' +
        Math.round(errorRepeat.intervalMs / 1000) + 's while it lasts' : '') +
      ': ' + errorRepeat.key);

    errorRepeat.count      = 0;
    errorRepeat.reportedAt = now;
  };

  client.on('error', function(err) {
    var key = (err && err.message) || String(err);
    var now = Date.now();

    if (key !== errorRepeat.key) {
      // A different error ends the previous run: report what it accumulated
      // first, or the count would be silently lost. The interval resets with
      // the new run, so a fresh problem is never reported at the previous
      // one's stretched cadence.
      flushErrorRepeats(now, false);

      errorRepeat.key        = key;
      errorRepeat.count      = 0;
      errorRepeat.reportedAt = now;
      errorRepeat.intervalMs = REDIS_ERROR_SUMMARY_FIRST_MS;

      console.log(new Date().toString(), 'redis client error event:', err.message);

      return;
    }

    errorRepeat.count++;

    if (now - errorRepeat.reportedAt >= errorRepeat.intervalMs) {
      flushErrorRepeats(now, true);
    }
  });

  await client.connect();
  console.log('Redis client connected to', redisConfig.host + ':' + redisConfig.port);
  return client;
}

// Only initialize if Redis is enabled
if (redisEnabled) {
  clientPromise = createClientAsync().catch(function(err) {
    console.log('Failed to initialize redis client:', err.message);
  });
} else {
  clientPromise = Promise.resolve(null);
}

// Synchronous getter for backwards compatibility
function createClient() {
  if (!redisEnabled) {
    return null;
  }
  if (!client || !client.isOpen) {
    throw new Error('Redis client not connected. Use getClient() or await clientPromise first.');
  }
  return client;
}

// Async getter - waits for connection
async function getClient() {
  await clientPromise;
  return client;
}

module.exports = {
  createClient: createClient,
  getClient: getClient,
  clientPromise: clientPromise,
  isEnabled: function() { return redisEnabled; }
};
