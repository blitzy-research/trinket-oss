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
// The command list is exhaustive against a census of every `client.<method>` and `redisClient.<method>`
// reference in app.js, config/ and lib/: connect, isOpen, on, get, set, del, expire, exists, incr,
// lIndex, lPush, lRange, lRem, rPush and sIsMember.
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

// node_redis v3 answers SISMEMBER with 0/1 while v4 answers with a boolean, and
// lib/controllers/users.js:62 consumes the reply directly, so this one reply is coerced to match the real
// v4 client. Every other reply shape is identical between the two versions.
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
//   1. test/helpers/flow.js builds its supertest agent from `server.listener`;
//   2. test/lib/models/trinket.js stubs `global.Interaction`, one of the nine implicit model globals
//      assigned inside app.js's async `init()`, and Sinon 3+ refuses to stub a non-existent property.
// Awaiting the promise here also puts those nine globals in place before Mocha takes its `check-leaks`
// snapshot, which is why `check-leaks` stays enabled rather than being relaxed.
// This must be a root hook rather than a bare top-level `before()`: this file is loaded through Mocha's
// `require` option (see .mocharc.json), which runs before the BDD globals exist.
module.exports = {
  mochaHooks : {
    beforeAll : async function() {
      this.timeout(60000);

      await app;
    }
  }
};
