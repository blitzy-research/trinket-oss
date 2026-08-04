// THE TEST BOOTSTRAP. This module must run before ANY other module reads `config` or requires `app.js`,
// because node-config resolves its whole layered configuration on the first `require('config')` in the
// process and never re-reads it, and because `config/app.config.js` freezes a require order in which
// `./routes` and `./api_routes` load before `./db` (`mongoose-schema-extend` conflicts with Joi otherwise).
// Letting Mocha's default recursive glob decide costs the whole run: measured on the installed mocha
// 11.7.6 with `collect-files`, the glob does not sort, this file lands LAST, and the process dies during
// file loading with `AssertError: Schema can only contain plain objects` at joi/lib/compile.js:88 via
// config/api_routes.js:39 - zero tests run.
//
// Three mechanisms put this file first, and `.mocharc.json` still carries exactly the four options the
// Technical Specification enumerates (reporter, recursive, check-leaks, exit) - no fifth key:
//   1. `package.json`'s `test` script passes `--file ./test/setup.js`. `--file` rather than `--require`
//      deliberately: `--file` loads the module through the ordinary spec path, so Mocha's BDD globals are
//      already installed and the root-suite `before()` at the bottom of this file attaches, whereas
//      `--require` runs ahead of the interface and would make that impossible.
//   2. The same script exports NODE_ENV and NODE_CONFIG_PERSIST_ON_CHANGE on the command line, so the
//      environment is right even for a direct `npx mocha`.
//   3. `test/helpers/db.js`, `test/helpers/defaults.js` and `test/helpers/flow.js` - the first modules to
//      reach `config` and `app.js` - each `require('../setup')` as their first statement, which makes the
//      ordering a require-cache fact rather than a filename fact. Node's module cache makes this
//      idempotent.
// Anything that still slipped through would be caught by the fail-closed database guard in
// test/helpers/db.js rather than by luck.
//
// The assignments below are the base commit's first two lines and stay first. Full account in
// docs/PRESERVED-QUIRKS.md section 13.1.
process.env.NODE_ENV = 'test';
process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';

// The two values below are forced through `$NODE_CONFIG` because `config/*.yaml` is frozen and because
// neither value may be sourced from developer configuration. `config` is held at 0.4.37 and applies
// `$NODE_CONFIG` AFTER every file layer (node_modules/config/lib/config.js:746-757, measured), so this is
// the only layer that outranks the gitignored `config/local.yaml`.
//
// 1. THE DATABASE. `test/helpers/db.js` drops the database it is connected to, twice. `config/test.yaml:11`
//    selects `test`, but `local.yaml` loads after it, and `config/local.example.yaml:31` - the template the
//    setup documentation tells developers to copy - selects `database: trinket`, which is also
//    `config/default.yaml:367`'s value. A developer following the documented flow therefore aimed the drops
//    at their own working database. Forcing the name here makes the selection explicit and unconditional,
//    and `test/helpers/db.js` additionally refuses to drop anything else.
// 2. THE SESSION PASSWORD. `app.js:47-62` calls `process.exit(1)` when
//    `app.plugins.session.cookieOptions.password` is shorter than 32 characters. `config/default.yaml`
//    ships it empty and `config/test.yaml` sets no override, so on a clean checkout - where
//    `git clean -xfd` has removed the gitignored `local.yaml` - requiring `../app.js` below killed the
//    process before a single test ran. The literal below is a tracked, non-secret, test-only value: it
//    seals cookies that live for the duration of one `npm test`, and it is what makes AAP goal G6
//    ("fresh clone on Node 22: npm ci, asset build and npm test all exit 0") reproducible without any
//    ignored file.
var TEST_DATABASE         = 'test';
var TEST_SESSION_PASSWORD = 'trinket-oss-test-only-session-cookie-password';

var forcedConfig = process.env.NODE_CONFIG ? JSON.parse(process.env.NODE_CONFIG) : {};

forcedConfig.db                = forcedConfig.db || {};
forcedConfig.db.mongo          = forcedConfig.db.mongo || {};
// A parallel clone gets its own namespace so that ten checkouts sharing one mongod cannot drop each
// other's database mid-run; `test/helpers/db.js`'s allow-list admits exactly this `test_<suffix>` shape.
forcedConfig.db.mongo.database = process.env.CLONE_INDEX ?
  TEST_DATABASE + '_' + String(process.env.CLONE_INDEX).replace(/[^A-Za-z0-9_-]/g, '') :
  TEST_DATABASE;

forcedConfig.app                                        = forcedConfig.app || {};
forcedConfig.app.plugins                                = forcedConfig.app.plugins || {};
forcedConfig.app.plugins.session                        = forcedConfig.app.plugins.session || {};
forcedConfig.app.plugins.session.cookieOptions          = forcedConfig.app.plugins.session.cookieOptions || {};
forcedConfig.app.plugins.session.cookieOptions.password = TEST_SESSION_PASSWORD;

// Any pre-existing `$NODE_CONFIG` is merged rather than discarded - the setup notes use it to give parallel
// clones their own port - and a malformed one is left to throw here rather than being swallowed, so a
// broken override fails the bootstrap loudly instead of silently reverting to the file layers.
process.env.NODE_CONFIG = JSON.stringify(forcedConfig);
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
// callback-style, lower-case commands (`get(key, cb)`, `sismember(key, member, cb)`, ...) and has neither
// `connect` nor `isOpen`, while `redis` 4.7.1 - the version this application uses - exposes
// promise-returning camelCase commands behind an explicit `connect()`. The two call sites that create a
// client, `lib/util/store.js:167` and `config/redis.js:38`, both `await client.connect()` and then call
// camelCase commands, so handing them a bare redis-mock client makes every store operation reject with
// `TypeError: redisClient.connect is not a function`. `config/redis.js:51` swallows that, but
// `lib/util/store.js` caches the rejected promise forever, which is why POST /users answered its `fail`
// redirect instead of creating the account. The adapter below therefore keeps redis-mock as the double -
// it still holds all the data - and presents it through the v4 surface the application actually calls.
//
// The surface is exactly the one the application consumes and nothing more. A census of every
// `client.<method>` and `redisClient.<method>` reference in app.js, config/ and lib/ yields fifteen
// members: the property `isOpen` (config/redis.js:16,63 and lib/util/store.js:144), the two non-command
// methods `connect` and `on`, and the twelve commands mapped below. `quit`, `hGet`, `hGetAll`, `hSet`,
// `keys`, `sAdd`, `sMembers` and `sRem` have no call site anywhere in the tree and are therefore NOT
// exposed - a double wider than the contract it stands in for hides a genuine gap rather than covering
// one.
var REDIS_V4_TO_MOCK_COMMAND = {
  del       : 'del',
  exists    : 'exists',
  expire    : 'expire',
  get       : 'get',
  incr      : 'incr',
  lIndex    : 'lindex',
  lPush     : 'lpush',
  lRange    : 'lrange',
  lRem      : 'lrem',
  rPush     : 'rpush',
  sIsMember : 'sismember',
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

// DEPENDENCY-SWAP ADAPTATION, hosted here so that test/helpers/db.js stays byte-identical to the base
// commit. `DB()` binds its two hook methods with `_.bindAll`, and underscore 1.13.8 - the version the
// base commit's `^1.8.3` range also resolves to - dropped `_.bind`'s native-bind fast path: `_.bind` now
// returns a `restArguments` wrapper whose `length` is 0, where underscore 1.8.3 delegated to
// `Function.prototype.bind` and preserved the declared arity. Mocha decides whether a hook is
// asynchronous from `fn.length` (mocha/lib/runnable.js), so the arity-0 wrapper is invoked with no
// callback and both hooks throw `TypeError: done is not a function` - measured, and it silently skips the
// whole API suite. Re-declaring the two methods with their arity intact restores every existing call
// site exactly as the base commit wrote it: the bare-reference hooks at test/lib/api/index.js:27,29 and
// test/lib/models/user.js:7, and the explicit `db.reset(done)` at test/lib/api/index.js:37. This runs
// before any spec file is loaded, so the hook registrations see the adapted methods.
['ensureConnection', 'reset'].forEach(function(hook) {
  var bound = db[hook];

  db[hook] = function(done) {
    return bound(done);
  };
});
// ROOT-SUITE BARRIER. `app.js` exports a PROMISE - a direct consequence of its awaited plugin registration
// and awaited start - so nothing that depends on the booted server may run until it resolves. Two concrete
// dependencies exist today:
//   1. test/helpers/flow.js captures the server in an `app.then(...)` and builds its supertest agent from
//      `server.listener` lazily; `agentFor` throws if the promise has not settled, so that file depends on
//      this barrier;
//   2. test/lib/models/trinket.js stubs `global.Interaction`, one of the nine implicit model globals
//      assigned inside app.js's async `init()`, and Sinon 3+ refuses to stub a non-existent property.
// `check-leaks` stays enabled rather than being relaxed, and this barrier is NOT what allows that.
// Measured on mocha 11.7.6 by instrumenting `Runner.prototype.globals`: all nine globals are already
// present when the leak snapshot is taken, and `User` is already inside the snapshot array, because
// requiring `../app.js` above starts `init()` while Mocha is still awaiting its own file loading and
// nothing in `init()` awaits real I/O under `app.start : false`. This runs after that snapshot; its job is
// the barrier only.
//
// It is registered as a bare top-level `before()` rather than as an exported `mochaHooks` root-hook
// plugin, because `.mocharc.json` carries exactly the four options the plan specifies - reporter,
// recursive, check-leaks and exit - and root-hook plugins are collected ONLY from files loaded through
// `--require`. A `before()` called at file scope registers on the ROOT suite, so it runs ahead of every
// test in every file regardless of where this file lands in the load order. Mocha's bdd interface installs
// the globals on its first `pre-require` event, which precedes the first spec file being required, so
// `before` exists both when this file is loaded as a spec itself and when it is pulled in early by
// test/helpers/db.js. The `typeof` guard covers the remaining case - being required outside a Mocha run
// at all, which test/baseline/capture.js and the ad-hoc probes do - where there is no suite to attach to
// and the caller awaits `app` itself.
//
// No timeout override accompanies it. Mocha's default 2000 ms is the measured baseline and is ample:
// requiring `../app.js` above starts `init()` during Mocha's file-loading phase and, with
// `app.start : false`, `init()` awaits no real I/O, so the barrier awaits an already-settled promise.
// Raising the limit would only hide a stuck initialisation for a minute.
if (typeof before === 'function') {
  before(async function() {
    await app;
  });
}

module.exports = {};
