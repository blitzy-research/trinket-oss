process.env.NODE_ENV = 'test';
process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';

var chai           = require('chai'),
    chaiAsPromised = require('chai-as-promised'),
    sinonChai      = require('sinon-chai');

chai.should();
chai.use(chaiAsPromised);
chai.use(sinonChai);

var sinon      = require('sinon'),
    config     = require('config'),
    redis      = require('redis'),
    redismock  = require('redis-mock'),
    catboxmock = require('./helpers/catbox-redis');

// `redis-mock` is a node_redis v3 double: measured on the installed 0.56.3, its client exposes only
// callback-style, lower/upper-case commands (`get(key, cb)`, `sismember(key, member, cb)`, ...) and has
// neither `connect` nor `isOpen`, while `redis` 4.7.1 - the version this application uses - exposes
// promise-returning camelCase commands behind an explicit `connect()`. The two call sites that create a
// client, `lib/util/store.js:167` and `config/redis.js:38`, both `await client.connect()` and then call
// camelCase commands, so handing them a bare redis-mock client makes every store operation reject with
// `TypeError: redisClient.connect is not a function`. `config/redis.js:51` swallows that, but
// `lib/util/store.js` caches the rejected promise forever, which is why POST /users answered its `fail`
// redirect instead of creating the account. The adapter below therefore keeps redis-mock as the double -
// it still holds all the data - and presents it through the v4 surface the application actually calls.
// A census of every `client.<method>` and `redisClient.<method>` reference in app.js, config/ and lib/
// yields exactly fifteen members - connect, isOpen, on, get, set, del, expire, exists, incr, lIndex,
// lPush, lRange, lRem, rPush and sIsMember - and the adapter covers all fifteen. The map below is a
// superset: hGet, hGetAll, hSet, keys, sAdd, sMembers and sRem have no call site anywhere in the tree
// today, but every one of them is implemented by redis-mock under its lower-case spelling, so they are
// inert rather than broken and are cheaper to leave in place than to churn out.
var REDIS_V4_TO_MOCK_COMMAND = {
  del       : 'del',
  exists    : 'exists',
  expire    : 'expire',
  get       : 'get',
  hGet      : 'hget',
  hGetAll   : 'hgetall',
  hSet      : 'hset',
  incr      : 'incr',
  keys      : 'keys',
  lIndex    : 'lindex',
  lPush     : 'lpush',
  lRange    : 'lrange',
  lRem      : 'lrem',
  rPush     : 'rpush',
  sAdd      : 'sadd',
  sIsMember : 'sismember',
  sMembers  : 'smembers',
  sRem      : 'srem',
  set       : 'set'
};

// node_redis v3 answers SISMEMBER with 0/1 while v4 answers with a boolean - `@redis/client`'s
// SISMEMBER command binds `transformBooleanReply` - so this one reply is coerced to match the real v4
// client. `lib/util/store.js:37`, the in-memory twin of this double, likewise answers with a boolean, and
// the reply reaches a caller unwrapped: `lib/util/store/emailStore.js:20-22` returns it straight out of
// `blockListLookup`, which `lib/controllers/users.js:100` reads as `isBlocked`. Every other reply shape is
// identical between the two versions.
var REDIS_V4_BOOLEAN_REPLIES = ['sIsMember'];

function createRedisMockV4Client() {
  var mock = redismock.createClient.apply(redismock, arguments);
  var client = {
    isOpen  : false,
    connect : async function() {
      client.isOpen = true;
      return client;
    },
    quit : async function() {
      client.isOpen = false;
      return mock.quit();
    },
    on : function() {
      mock.on.apply(mock, arguments);
      return client;
    }
  };

  Object.keys(REDIS_V4_TO_MOCK_COMMAND).forEach(function(v4Command) {
    var mockCommand   = REDIS_V4_TO_MOCK_COMMAND[v4Command];
    var coerceBoolean = REDIS_V4_BOOLEAN_REPLIES.indexOf(v4Command) >= 0;

    client[v4Command] = function() {
      var args = Array.prototype.slice.call(arguments);

      return new Promise(function(resolve, reject) {
        args.push(function(err, reply) {
          if (err) return reject(err);
          resolve(coerceBoolean ? !!reply : reply);
        });
        mock[mockCommand].apply(mock, args);
      });
    };
  });

  return client;
}

// Sinon removed the three-argument `stub(obj, 'method', fn)` form in version 3, so the behaviour moves to
// `.callsFake`. The stub still resolves to redis-mock, now through the v4 adapter above.
sinon.stub(redis, 'createClient').callsFake(createRedisMockV4Client);

var app = require('../app.js'),
    db  = require('./helpers/db');

// Mocha ROOT HOOK PLUGIN. `app.js` exports a PROMISE - a direct consequence of its awaited plugin
// registration and awaited start - so nothing that depends on the booted server may run until it resolves.
// Two concrete dependencies exist today:
//   1. test/helpers/flow.js captures the server in an `app.then(...)` and builds its supertest agent from
//      `server.listener` lazily; its `agentFor` throws `'app.js exports a promise that has not resolved
//      yet; test/setup.js registers a root hook which awaits it before any test runs'` if it has not, so
//      that file depends on this barrier by name;
//   2. test/lib/models/trinket.js stubs `global.Interaction`, one of the nine implicit model globals
//      assigned inside app.js's async `init()`, and Sinon 3+ refuses to stub a non-existent property.
// `check-leaks` stays enabled rather than being relaxed, but this hook is NOT what allows that. Measured on
// mocha 11.7.6 by instrumenting `Runner.prototype.globals`: all nine globals are already present when the
// leak snapshot is taken, and `User` is already inside the snapshot array, because requiring `../app.js`
// above starts `init()` while Mocha is still awaiting its own file loading and nothing in `init()` awaits
// real I/O under `app.start : false`. This hook runs after that snapshot; its job is the barrier only.
// It must be a root hook rather than a bare top-level `before()`: this file is loaded through Mocha's
// `require` option (see .mocharc.json), which runs before the BDD globals exist.
module.exports = {
  mochaHooks : {
    beforeAll : async function() {
      this.timeout(60000);

      await app;
    }
  }
};
