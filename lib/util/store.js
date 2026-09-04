var config = require('config');
var _ = require('underscore');

// Check if Redis is enabled
var redisEnabled = config.db && config.db.redis && config.db.redis.enabled !== false;

// In-memory cache implementation
var memoryCache = {};
var memorySets = {};
var memoryLists = {};

var InMemoryClient = {
  get: async function(key) {
    return memoryCache[key] || null;
  },
  set: async function(key, value) {
    memoryCache[key] = value;
    return 'OK';
  },
  del: async function(key) {
    // Presence-faithful, exactly as Redis DEL is: 1 when a key was removed, 0
    // when there was none to remove. The distinction is load-bearing rather
    // than cosmetic - lib/controllers/users.js savePassword uses this verdict
    // as its compare-and-delete authorization for a single-use reset token, so
    // an unconditional 1 would let every concurrent caller believe it had won
    // the claim on this backend while the Redis backend correctly picked one.
    if (!Object.prototype.hasOwnProperty.call(memoryCache, key)) {
      return 0;
    }

    delete memoryCache[key];
    return 1;
  },
  expire: async function(key, seconds) {
    // Simple expiration - delete after timeout
    //
    // .unref() is load-bearing, not tidiness. Mocha 3.5.3 waits for the event
    // loop to drain before exiting, so a referenced timer with an hour-long
    // delay - which the throttle windows below create the moment a suite
    // exercises a rate-limited route without stubbing Store.expire - holds the
    // whole test run open until it fires. Measured. Unreferencing it keeps the
    // expiry semantics for any process that outlives the delay while letting a
    // process with no other work exit immediately.
    var timer = setTimeout(function() {
      delete memoryCache[key];
    }, seconds * 1000);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
    return 1;
  },
  incr: async function(key) {
    var val = parseInt(memoryCache[key] || '0', 10);
    memoryCache[key] = String(val + 1);
    return val + 1;
  },
  // Set operations
  sIsMember: async function(setKey, member) {
    var set = memorySets[setKey] || [];
    return set.indexOf(member) >= 0;
  },
  sAdd: async function(setKey, members) {
    if (!memorySets[setKey]) {
      memorySets[setKey] = [];
    }
    var arr = Array.isArray(members) ? members : [members];
    var added = 0;
    arr.forEach(function(member) {
      if (memorySets[setKey].indexOf(member) < 0) {
        memorySets[setKey].push(member);
        added++;
      }
    });
    return added;
  },
  sRem: async function(setKey, member) {
    if (!memorySets[setKey]) return 0;
    var idx = memorySets[setKey].indexOf(member);
    if (idx >= 0) {
      memorySets[setKey].splice(idx, 1);
      return 1;
    }
    return 0;
  },
  // List operations
  lIndex: async function(listKey, index) {
    var list = memoryLists[listKey] || [];
    return list[index] || null;
  },
  lPush: async function(listKey, value) {
    if (!memoryLists[listKey]) {
      memoryLists[listKey] = [];
    }
    memoryLists[listKey].unshift(value);
    return memoryLists[listKey].length;
  },
  lRem: async function(listKey, count, value) {
    if (!memoryLists[listKey]) return 0;
    var removed = 0;
    memoryLists[listKey] = memoryLists[listKey].filter(function(item) {
      if (item === value && (count === 0 || removed < Math.abs(count))) {
        removed++;
        return false;
      }
      return true;
    });
    return removed;
  },
  // Additional list operations
  lRange: async function(listKey, start, stop) {
    var list = memoryLists[listKey] || [];
    if (stop === -1) stop = list.length - 1;
    return list.slice(start, stop + 1);
  },
  rPush: async function(listKey, value) {
    if (!memoryLists[listKey]) {
      memoryLists[listKey] = [];
    }
    memoryLists[listKey].push(value);
    return memoryLists[listKey].length;
  },
  // Key operations
  exists: async function(key) {
    return memoryCache.hasOwnProperty(key) || memorySets.hasOwnProperty(key) || memoryLists.hasOwnProperty(key) ? 1 : 0;
  },
  keys: async function(pattern) {
    var allKeys = Object.keys(memoryCache).concat(Object.keys(memorySets)).concat(Object.keys(memoryLists));
    if (pattern === '*') return allKeys;
    var regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return allKeys.filter(function(key) {
      return regex.test(key);
    });
  },
  // Set members
  sMembers: async function(setKey) {
    return memorySets[setKey] || [];
  },
  // Hash operations (if needed)
  hGet: async function(hashKey, field) {
    var hash = memoryCache[hashKey];
    if (!hash || typeof hash !== 'object') return null;
    return hash[field] || null;
  },
  hSet: async function(hashKey, field, value) {
    if (!memoryCache[hashKey] || typeof memoryCache[hashKey] !== 'object') {
      memoryCache[hashKey] = {};
    }
    memoryCache[hashKey][field] = value;
    return 1;
  },
  hGetAll: async function(hashKey) {
    return memoryCache[hashKey] || null;
  }
};

// Redis client (lazy loaded)
var redisClient = null;
var redisClientPromise = null;

async function getRedisClient() {
  if (!redisEnabled) {
    return InMemoryClient;
  }

  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (redisClientPromise) {
    return redisClientPromise;
  }

  redisClientPromise = (async function() {
    var redis = require('redis');
    var redisConfig = config.db.redis.app;

    var options = {
      socket: {
        host: redisConfig.host,
        port: redisConfig.port
      }
    };

    if (redisConfig.pass) {
      options.password = redisConfig.pass;
    }

    redisClient = redis.createClient(options);

    redisClient.on('error', function(err) {
      console.log('Redis client error:', err.message);
    });

    await redisClient.connect();
    console.log('Redis client connected to', redisConfig.host + ':' + redisConfig.port);
    return redisClient;
  })();

  return redisClientPromise;
}

// Store implementations
var TrinketStore = require('./store/trinketStore');
var CourseStore = require('./store/courseStore');
var FeaturedStore = require('./store/featuredStore');
var EmailStore = require('./store/emailStore');
var UserStore = require('./store/userStore');

var trinketInterface;
var courseInterface;
var featuredInterface;
var emailInterface;
var userInterface;

// ---------------------------------------------------------------------------
// Throttle counters - the shared mechanism behind SEC-F26 and SEC-F39.
//
// Both findings ask for the same thing from two directions: SEC-F26 wants rate
// limits on password-reset issuance and token presentation, SEC-F39 wants
// "rate-limit by account/IP/token prefix" for login. Building it once here,
// beside the get/set/del/expire the controllers already use, is what makes it
// centralized rather than per-handler - and it keeps the counters in the same
// backend as the tokens they protect, so the same Redis-or-in-memory selection
// (:5) applies with no second configuration surface.
//
// The keys are TIME-BUCKETED rather than sliding: `<prefix>:<scope>:<id>:<n>`
// where n = floor(now / window). That costs a little precision at a bucket
// boundary - a caller can spend its allowance twice across the seam - and buys
// two properties worth more here: the counter needs no read-modify-write (a
// single INCR is atomic in both backends, so concurrent requests cannot lose
// increments), and an abandoned key expires on its own instead of needing a
// sweeper.
// ---------------------------------------------------------------------------
var THROTTLE_KEY_PREFIX = 'throttle';

// An identifier is caller-supplied - a submitted email address, a remote
// address, the prefix of a presented token - so its length is not bounded by
// anything upstream. Long values are folded to a fixed-width digest rather than
// truncated so two distinct identifiers sharing a prefix cannot collapse into
// one another's bucket, which would let one caller consume another's allowance.
var THROTTLE_IDENTIFIER_MAX_LENGTH = 64;

function normalizeThrottleIdentifier(identifier) {
  var value = (identifier === null || identifier === undefined) ? '' : String(identifier);

  value = value.trim().toLowerCase();

  if (value.length > THROTTLE_IDENTIFIER_MAX_LENGTH) {
    value = require('crypto').createHash('sha1').update(value).digest('hex');
  }

  return value;
}

function throttleKey(scope, identifier, windowSeconds) {
  var bucket = Math.floor(Date.now() / 1000 / windowSeconds);
  return [
    THROTTLE_KEY_PREFIX,
    String(scope),
    normalizeThrottleIdentifier(identifier),
    bucket
  ].join(':');
}

// ---------------------------------------------------------------------------
// The degraded mode for the counters above.
//
// rateLimit cannot fail closed - see the reasoning at its catch - but "fail
// open" must not mean "the control disappears". When the backing store is
// unreachable, counting moves to this per-process map, which applies the SAME
// limits with the SAME time buckets. What is lost is only the sharing between
// processes: a limit of 10 becomes 10 per process rather than 10 per cluster,
// which is a bounded weakening instead of an absence.
//
// It is pruned rather than grown without limit: every entry is bucketed, so any
// key whose bucket is not the current one is already spent, and a single pass
// over the map drops them once it exceeds the soft cap below. The map is only
// ever populated during an outage, so the pass is not on the healthy path.
// ---------------------------------------------------------------------------
var fallbackCounters = {};
var FALLBACK_COUNTER_SOFT_CAP = 4096;

function pruneFallbackCounters(windowSeconds) {
  var currentSuffix = ':' + Math.floor(Date.now() / 1000 / windowSeconds);

  Object.keys(fallbackCounters).forEach(function(key) {
    if (!key.endsWith(currentSuffix)) {
      delete fallbackCounters[key];
    }
  });
}

function fallbackRateLimit(scope, identifier, limit, windowSeconds) {
  var key = throttleKey(scope, identifier, windowSeconds)
    , count;

  if (Object.keys(fallbackCounters).length > FALLBACK_COUNTER_SOFT_CAP) {
    pruneFallbackCounters(windowSeconds);
  }

  count = (fallbackCounters[key] || 0) + 1;
  fallbackCounters[key] = count;

  return count <= limit;
}

function Store() {}

_.extend(Store.prototype, {
  _getClient: getRedisClient,

  get: async function(key) {
    var client = await this._getClient();
    return await client.get(key);
  },
  /**
   * Writes a value, optionally with its lifetime in the SAME operation.
   *
   * The third argument is new and optional, and the reason it exists is a race
   * rather than convenience: a credential written by `set` and given its TTL by
   * a following `expire` is un-expiring for the window between the two calls,
   * so a crash, a rejection or a lost connection in between leaves a bearer
   * token in the store forever. Passing the TTL here closes that window on the
   * Redis path, where `SET key value EX seconds` is one command.
   *
   * Two-argument callers are unaffected, which is every existing caller.
   *
   * @param {string} key
   * @param {string} val
   * @param {number} [ttlSeconds] lifetime in seconds; ignored when absent
   * @returns {Promise<string>} the backend's reply
   */
  set: async function(key, val, ttlSeconds) {
    var client = await this._getClient()
      , reply;

    if (typeof ttlSeconds === 'number' && ttlSeconds > 0) {
      // node-redis 4.x takes the lifetime as an option on SET itself. The
      // in-memory client has no equivalent single operation, so it falls back to
      // the two-step form below - which is safe there, because its store cannot
      // outlive the process that would have crashed between them.
      if (client !== InMemoryClient) {
        return await client.set(key, val, { EX : ttlSeconds });
      }

      reply = await client.set(key, val);
      await client.expire(key, ttlSeconds);
      return reply;
    }

    return await client.set(key, val);
  },
  del: async function(key) {
    var client = await this._getClient();
    return await client.del(key);
  },
  expire: async function(key, s) {
    var client = await this._getClient();
    return await client.expire(key, s);
  },
  incr: async function(key) {
    var client = await this._getClient();
    return await client.incr(key);
  },

  /**
   * Counts one attempt against a throttle bucket and reports whether the caller
   * is still within its allowance.
   *
   * @param {string} scope           counter family; the callers in
   *   lib/controllers/users.js use 'login-account', 'login-address',
   *   'pass-reset-email', 'pass-reset-address', 'reset-token-address' and
   *   'reset-token-prefix'
   * @param {string} identifier      who or what is being counted - normalized here
   * @param {number} limit           attempts permitted per window
   * @param {number} windowSeconds   window length; also the key's TTL
   * @returns {Promise<boolean>} true when the call is ALLOWED, false when it
   *   must be rejected. Never throws.
   *
   * @example
   *   if (!await Store.rateLimit('login-account', email, 10, 900)) return uniformFailure();
   */
  rateLimit: async function(scope, identifier, limit, windowSeconds) {
    var key, count;

    try {
      key   = throttleKey(scope, identifier, windowSeconds);
      count = Number(await this.incr(key));

      if (count === 1) {
        // First attempt in this window, so this is where the key acquires its
        // lifetime. Its own failure must not decide the request: a counter
        // without a TTL still counts correctly for this window, and the bucket
        // rolls on its own at the next boundary.
        try {
          await this.expire(key, windowSeconds);
        }
        catch (expireErr) {
          console.log('Store.rateLimit could not set a TTL on', key + ':', expireErr && expireErr.message);
        }
      }

      return count <= limit;
    }
    catch (err) {
      // DEGRADE, do not fail closed, and do not simply allow. The trade-off is
      // worth stating because it is the opposite of what a throttle usually
      // wants. These counters guard login and password reset. If the store is
      // unreachable, failing CLOSED would deny EVERY login attempt for as long
      // as the outage lasts - a self-inflicted denial of service on the whole
      // site, triggered by an availability problem rather than by an attack.
      // Failing OPEN would drop the control entirely at exactly the moment an
      // attacker could induce the outage.
      //
      // So the count moves to the per-process fallback above, which applies the
      // same limit over the same window. The degraded mode is bounded and
      // stated: the limit becomes per process rather than per cluster. The
      // event is logged so the degradation is visible in operations rather than
      // silent.
      console.log('Store.rateLimit degraded to the in-process counter:', err && err.message);
      return fallbackRateLimit(scope, identifier, limit, windowSeconds);
    }
  },

  /**
   * Drops the current bucket for one throttle counter, so a caller that has
   * proved itself - a successful login, say - does not stay penalized for the
   * failures that preceded it.
   *
   * @param {string} scope
   * @param {string} identifier
   * @param {number} windowSeconds  MUST be the window rateLimit was called with:
   *   the key is bucketed on it, so a different value addresses a different key.
   * @returns {Promise<boolean>} true when the key was dropped (or was already
   *   absent), false when the store could not be reached. Never throws.
   */
  rateLimitClear: async function(scope, identifier, windowSeconds) {
    try {
      await this.del(throttleKey(scope, identifier, windowSeconds));
      return true;
    }
    catch (err) {
      // Same reasoning as rateLimit's fail-open: the worst outcome of a failed
      // clear is that a legitimate caller keeps a count it had earned back, and
      // that must not turn into a thrown error on a successful login path.
      console.log('Store.rateLimitClear failed:', err && err.message);
      return false;
    }
  },
  trinkets: function() {
    if (!trinketInterface) {
      trinketInterface = TrinketStore(this._getClient);
    }
    return trinketInterface;
  },
  courses: function() {
    if (!courseInterface) {
      courseInterface = CourseStore(this._getClient);
    }
    return courseInterface;
  },
  featured: function() {
    if (!featuredInterface) {
      featuredInterface = FeaturedStore();
    }
    return featuredInterface;
  },
  email: function() {
    if (!emailInterface) {
      emailInterface = EmailStore(this._getClient);
    }
    return emailInterface;
  },
  user: {
    reset_password_key: function(key) {
      return ['user', key, 'reset'].join(':');
    },
    change_email_key: function(key) {
      return ['user', key, 'email'].join(':');
    },
    verify_email_key: function(key) {
      return ['user', key, 'verifyemail'].join(':');
    },
    activate_account_key: function(key) {
      return ['user', key, 'activate'].join(':');
    }
  },
  users: function() {
    if (!userInterface) {
      userInterface = UserStore(this._getClient);
    }
    return userInterface;
  }
});

// Export singleton
var store = new Store();

// Export utilities
store.isRedisEnabled = function() {
  return redisEnabled;
};

store.getClient = getRedisClient;

module.exports = store;
