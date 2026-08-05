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

// The values below are forced through `$NODE_CONFIG` because `config/*.yaml` is frozen and because none of
// them may be sourced from developer configuration. `config` is held at 0.4.37 and applies
// `$NODE_CONFIG` AFTER every file layer (node_modules/config/lib/config.js:746-757, measured), so this is
// the only layer that outranks the gitignored `config/local.yaml`.
//
// 1. THE WHOLE MONGO CONNECTION IDENTITY - not merely the database name (review finding F-01, CWE-20 /
//    CWE-706). `test/helpers/db.js` drops the database it is connected to, twice, and the endpoint it drops
//    it on is whatever `config/db.js:L7-L33` assembled. That connection string is built from ELEVEN keys:
//    `db.mongo.{user,pass,host,port,database}` and `db.mongoread.{user,pass,host,port,database,opts}` - and
//    a non-empty `db.mongoread.host` appends a SECOND SEED to the same string (`config/db.js:L20-L30`), so
//    it is part of the cluster identity, not a separate read-only concern.
//
//    An earlier revision of this file forced only `database`, which left the other ten keys to be supplied
//    by arbitrary configuration. `config/test.yaml:8-11` does declare `host: localhost, port: 27017,
//    database: test`, but `local.yaml` loads AFTER it and `config/local.example.yaml:42-44` - the template
//    the setup documentation tells developers to copy - selects `host: mongodb` and `database: trinket`,
//    which is also `config/default.yaml:365-367`'s value. So a developer following the documented flow
//    aimed the drops at a remote host, under whatever credentials that host carried, and only the *name*
//    was checked before the drop.
//
//    All eleven keys are therefore REPLACED, not merged, with the loopback identity `config/test.yaml`
//    already declares: `localhost:27017/test`, no credentials, and no second seed. Anything the incoming
//    `$NODE_CONFIG` carried under `db.mongo` or `db.mongoread` is DISCARDED - measured on config 0.4.37, a
//    `null` in `$NODE_CONFIG` genuinely overrides a file-layer value rather than falling through, so
//    nulling `user`/`pass`/`mongoread.host` is effective. A parallel clone still gets its own database
//    through CLONE_INDEX below, which is the one sanctioned channel for changing this identity, and
//    `test/helpers/db.js` independently re-validates the LIVE connection - every seed host, the absence of
//    credentials, and the absence of an SRV/replica-set/TLS cluster - immediately before every drop.
// 2. THE SESSION PASSWORD. `app.js:47-62` calls `process.exit(1)` when
//    `app.plugins.session.cookieOptions.password` is shorter than 32 characters. `config/default.yaml`
//    ships it empty and `config/test.yaml` sets no override, so on a clean checkout - where
//    `git clean -xfd` has removed the gitignored `local.yaml` - requiring `../app.js` below killed the
//    process before a single test ran. The literal below is a tracked, non-secret, test-only value: it
//    seals cookies that live for the duration of one `npm test`, and it is what makes AAP goal G6
//    ("fresh clone on Node 22: npm ci, asset build and npm test all exit 0") reproducible without any
//    ignored file.
var TEST_DATABASE         = 'test';
var TEST_MONGO_HOST       = 'localhost';
var TEST_MONGO_PORT       = 27017;
var TEST_SESSION_PASSWORD = 'trinket-oss-test-only-session-cookie-password';

// MongoDB refuses a database name of 64 characters or more, so 63 is the maximum a namespaced test
// database may reach. Bounded here rather than left to the server, because the server's refusal would
// arrive as a connection failure during module load instead of as a named bootstrap error.
var MONGO_DATABASE_NAME_LIMIT = 63;

// The raw shape a CLONE_INDEX must ALREADY have. It is deliberately the suffix half of
// test/helpers/db.js's `DISPOSABLE_DATABASE` pattern, so a value accepted here always yields a database
// that helper is willing to clear.
var CLONE_SUFFIX = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

var forcedConfig = process.env.NODE_CONFIG ? JSON.parse(process.env.NODE_CONFIG) : {};

forcedConfig.db = forcedConfig.db || {};

// ASSIGNED, NOT MERGED. Every key `config/db.js` reads is listed, so nothing from the incoming
// `$NODE_CONFIG` and nothing from a file layer can contribute a host, a port or a credential to the
// endpoint the suite is about to drop. `mongoread.host` is nulled because a non-empty value there appends a
// second seed to the same connection string.
forcedConfig.db.mongo = {
  host     : TEST_MONGO_HOST,
  port     : TEST_MONGO_PORT,
  database : TEST_DATABASE,
  user     : null,
  pass     : null
};

forcedConfig.db.mongoread = {
  host     : null,
  port     : TEST_MONGO_PORT,
  database : TEST_DATABASE,
  user     : null,
  pass     : null,
  opts     : null
};

// A parallel clone gets its own namespace so that ten checkouts sharing one mongod cannot drop each
// other's database mid-run; `test/helpers/db.js`'s allow-list admits exactly this `test_<suffix>` shape.
//
// THE RAW VALUE IS VALIDATED, AND NOTHING IS NORMALISED (review finding F-03, CWE-20). An earlier revision
// sanitised first - `String(CLONE_INDEX).replace(/[^A-Za-z0-9_-]/g, '')` - and then validated only what
// survived, which made the mapping from CLONE_INDEX to database name NON-INJECTIVE: `a/b` and `ab` both
// reduced to `ab` and therefore both selected `test_ab`, so two clones that had each been given a distinct
// CLONE_INDEX would silently share one database and drop it under each other. Rejecting any value that is
// not ALREADY a legal suffix makes the mapping the identity plus a fixed prefix, so two distinct accepted
// values can never collide.
//
// The refusal happens here, at the point the value is read, rather than being left to the db helper.
// `test/helpers/db.js:34`'s `/^test([_-][A-Za-z0-9][A-Za-z0-9_-]*)?$/` would also refuse a bad name, and
// that refusal is correct and fail-closed, but it arrives much later, from a timer during that module's
// load, and it advises the reader to "Set CLONE_INDEX" - which they did. Silently falling back to the
// shared `test` database would be worse still: it would hand two parallel clones the same database to drop,
// which is the exact hazard this namespace exists to prevent. So a bad value fails the bootstrap loudly and
// by name - the same treatment the malformed `$NODE_CONFIG` below gets.
if (process.env.CLONE_INDEX) {
  var cloneSuffix       = String(process.env.CLONE_INDEX);
  var cloneDatabaseName = TEST_DATABASE + '_' + cloneSuffix;

  if (!CLONE_SUFFIX.test(cloneSuffix)) {
    throw new Error('test/setup.js: CLONE_INDEX=' + JSON.stringify(process.env.CLONE_INDEX) + ' is not a ' +
      'legal database-name suffix, and it is deliberately NOT sanitised into one: stripping the illegal ' +
      'characters would let two different CLONE_INDEX values select the same database and drop it under ' +
      'each other. Use a value that starts with a letter or a digit and contains only letters, digits, ' +
      '"_" or "-", or leave CLONE_INDEX unset to run against ' + JSON.stringify(TEST_DATABASE) + '.');
  }

  if (cloneDatabaseName.length > MONGO_DATABASE_NAME_LIMIT) {
    throw new Error('test/setup.js: CLONE_INDEX=' + JSON.stringify(process.env.CLONE_INDEX) + ' would ' +
      'select the ' + cloneDatabaseName.length + '-character database name ' +
      JSON.stringify(cloneDatabaseName) + ', and MongoDB refuses any name of ' +
      (MONGO_DATABASE_NAME_LIMIT + 1) + ' characters or more. Use a suffix of at most ' +
      (MONGO_DATABASE_NAME_LIMIT - TEST_DATABASE.length - 1) + ' characters.');
  }

  forcedConfig.db.mongo.database = cloneDatabaseName;
}

forcedConfig.app                                        = forcedConfig.app || {};
forcedConfig.app.plugins                                = forcedConfig.app.plugins || {};
forcedConfig.app.plugins.session                        = forcedConfig.app.plugins.session || {};
forcedConfig.app.plugins.session.cookieOptions          = forcedConfig.app.plugins.session.cookieOptions || {};
forcedConfig.app.plugins.session.cookieOptions.password = TEST_SESSION_PASSWORD;

// Any pre-existing `$NODE_CONFIG` is merged rather than discarded - the setup notes use it to give parallel
// clones their own port - and a malformed one is left to throw at the `JSON.parse` above rather than being
// swallowed, so a broken override fails the bootstrap loudly instead of silently reverting to the file
// layers. The two EXCEPTIONS to that merge are `db.mongo` and `db.mongoread`, which are assigned outright
// for the reason given at the top of this file: no incoming field may contribute to the endpoint the suite
// drops.
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

// The number of arguments each mapped command cannot do without, so that a call which is short of one is
// REJECTED rather than left unanswered. The adapter below appends its own callback as the next positional
// argument, which is how a callback-shaped double is driven from a promise - but it also means that a short
// call has that callback consumed AS the missing argument, so redis-mock never calls it and the promise
// never settles. Measured on the installed 0.56.3: `get()`, `expire('k')`, `lRange('l', 0)` and
// `sIsMember('s')` all hang forever, and inside a spec that surfaces as a 2000 ms Mocha timeout naming the
// test rather than the call - a future call-site typo would be diagnosed as a slow test.
//
// A prompt `TypeError` is the faithful answer, not an invention: measured against the REAL redis 4.7.1
// client on the live redis 7.4 server, `client.get()` rejects with `TypeError: Invalid argument type` and
// `client.expire('k')` with `TypeError: Cannot read properties of undefined (reading 'toString')`, because
// v4 fails while encoding the command and never reaches the server's own
// `ERR wrong number of arguments` reply. The counts below are the minimums node-redis v4 declares, and
// every call site in the tree already satisfies them - `lib/util/store.js:201-213` and the five modules
// under `lib/util/store/` - so this guard cannot reject a call the application actually makes.
var REDIS_V4_MINIMUM_ARGUMENTS = {
  del       : 1,
  exists    : 1,
  expire    : 2,
  get       : 1,
  incr      : 1,
  lIndex    : 2,
  lPush     : 2,
  lRange    : 3,
  lRem      : 3,
  rPush     : 2,
  sIsMember : 2,
  set       : 2
};

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
    var mockCommand      = REDIS_V4_TO_MOCK_COMMAND[v4Command];
    var coerceBoolean    = REDIS_V4_BOOLEAN_REPLIES.indexOf(v4Command) >= 0;
    var minimumArguments = REDIS_V4_MINIMUM_ARGUMENTS[v4Command];

    client[v4Command] = function() {
      var args = Array.prototype.slice.call(arguments);

      if (args.length < minimumArguments) {
        return Promise.reject(new TypeError('redis double: ' + v4Command + ' needs at least ' +
          minimumArguments + ' argument(s) and received ' + args.length + '. The real redis 4 client rejects ' +
          'the same call with a TypeError while encoding it; redis-mock would consume the callback this ' +
          'adapter appends as the missing argument and never answer.'));
      }

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

// The nine model globals `app.js:285-293` assigns, and a snapshot of what each name held BEFORE `app.js`
// was ever required. Both live above that require on purpose, because "before" has to be a structural fact
// here rather than a claim about microtask timing.
//
// The snapshot exists because `typeof global[name] === 'undefined'` is not a usable test for "app.js
// assigned this" (review finding F3). Eight of the nine names are genuinely absent from a fresh Node 22
// global, but `File` is NOT: Node 22 defines it as a non-enumerable built-in class, so it is already a
// function before this file runs. A drift check phrased as `typeof === 'undefined'` therefore passes for
// `File` whether or not `app.js:289` still assigns it - and the failure that would slip through is the
// nastiest kind, because Node's `File` is a real constructor that a spec would happily call. It has no
// `getName`, no `schema` and no `findById`, so the first symptom would be an unrelated `TypeError` from
// deep inside whichever model call the spec made, pointing at the model layer rather than at the missing
// assignment. Measured on the installed node v22.23.2: pre-require, `typeof global.File === 'function'`
// with `global.File.name === 'File'`; post-boot it is the model, and `Object.getOwnPropertyDescriptor`
// reports `enumerable: false` in both states, which is why `Object.keys(global)` never reported it and why
// the leak failure described further down named eight keys rather than nine.
//
// Comparing against the captured value by IDENTITY covers both cases with one predicate: for the eight
// absent names the captured value is `undefined`, which is exactly what the reservation below writes, so
// identity-with-pre still means "never assigned"; for `File` it means "still Node's built-in".
var MODEL_GLOBALS = ['User', 'Course', 'Lesson', 'Material', 'File', 'Trinket', 'Interaction', 'Folder',
  'CourseInvitation'];

var PRE_BOOTSTRAP_GLOBALS = {};

MODEL_GLOBALS.forEach(function(name) {
  PRE_BOOTSTRAP_GLOBALS[name] = { present : (name in global), value : global[name] };
});

var app = require('../app.js'),
    db  = require('./helpers/db');

// EAGER GLOBAL-KEY RESERVATION, and the reason `check-leaks` can stay on.
//
// `app.js:282-290` assigns the nine model globals as bare sloppy-mode assignments - `User = require(...)`,
// with no `var` - and it does so INSIDE its async `init()`, after `await server.register([...])` at
// `app.js:87`. The require above therefore returns while `init()` is still suspended, so those keys come
// into existence in a microtask continuation rather than during the require. Mocha snapshots
// `Object.keys(global)` exactly once, when it constructs the Runner - that is, after every file has been
// loaded - and `check-leaks` compares every later state against that one array. Whether `init()` had
// resumed by then depended purely on how much work Mocha happened to do in between, which is a RACE:
// measured on the installed mocha 11.7.6 by instrumenting `Runner.prototype.globals`, a full run snapshots
// 42 keys WITH the eight enumerable model names, while
// `mocha --file ./test/setup.js test/lib/models/plugins/paginate.js` snapshots 34 WITHOUT them. In that
// second shape the root barrier at the bottom of this file is itself what lets `init()` resume, so eight
// brand-new enumerable globals appear DURING a hook and the run fails with
// `global leak(s) detected: 'User', 'Course', ...` even though every test passed - which made five of the
// six model and plugin specs impossible to run on their own, and `npm test -- <one file>` is the ordinary
// way to run one.
//
// Reserving the KEYS here removes the dependency on that timing: the snapshot contains them whatever the
// file count. Only the keys are reserved - the VALUES stay `app.js`'s to assign, so this file never becomes
// a second source of truth for what a model is - and `undefined` is written rather than a stand-in object
// so that nothing can mistake a reserved key for a booted model. `File` is the one name the `in` test
// skips, because Node 22 already defines it: reserving it would mean REPLACING a non-enumerable built-in
// with `undefined`, and the key it would add to the leak snapshot is one `Object.keys(global)` never
// reported anyway (which is why the failure above names eight keys, not nine). `app.js`'s assignment
// overwrites it in place and it stays non-enumerable, measured. That skip is exactly why the drift check
// at the bottom of this file compares against `PRE_BOOTSTRAP_GLOBALS` instead of testing for `undefined`.
//
// Nothing is relaxed to achieve this. `.mocharc.json` keeps `check-leaks: true` and exactly the four keys
// the Technical Specification enumerates - no `--global` allowance list, which is the alternative this
// rejects because it needs a fifth key - and a genuinely new global still fails the run, measured with a
// throwaway spec that assigned one.
MODEL_GLOBALS.forEach(function(name) {
  if (!(name in global)) {
    global[name] = undefined;
  }
});

// THE BOOTED SERVER, PUBLISHED SYNCHRONOUSLY FOR LATE CONSUMERS.
//
// `app.js` exports a promise, so the only way to reach the server is a continuation - and a continuation is
// a MICROTASK, which is a trap for any consumer that is required after the promise has already settled and
// issues a request in the same synchronous turn: its own `app.then(...)` has not run yet, so it sees no
// server and raises the "has not resolved yet" error even though the server has been up for seconds.
// Measured: `await app` in a probe, then `require('./helpers/flow')` and `flow.get('/about')` in the same
// turn threw; one `setImmediate` later the identical call answered 200. No spec does that today, but a
// future spec that required the harness from inside a test body rather than at file scope would, and it
// would fail with a message describing a state that is not the one it is in.
//
// This capture is registered at bootstrap, which is the earliest point in the run and therefore before any
// such consumer can exist, so by the time a late require happens `bootstrap.server` is already populated and
// readable WITHOUT awaiting anything. It is published on this module's exports rather than on a global,
// because the nine model globals are the only globals this tree is allowed to add. Registered before the
// root barrier below `await`s the same promise, so its continuation runs first and the handle is set for
// every hook and test that follows.
var bootstrap = { server : null };

app.then(function(server) {
  bootstrap.server = server;
});

// DEPENDENCY-SWAP ADAPTATION, centralized here rather than inside test/helpers/db.js. The reason is LOAD
// ORDER, not immutability: this file is the bootstrap and `mocha --file ./test/setup.js` loads it ahead of
// every spec file, so the adaptation is in place BEFORE the hook registrations that name `db.reset` and
// `db.ensureConnection` by bare reference are evaluated - and a bare reference captures the function object
// itself, so an adaptation applied any later would never reach those hooks. Doing it here also leaves
// test/helpers/db.js - the one module in the tree that deletes a whole database - carrying no third-party
// adaptation of its own, which is why every existing call site there behaves as the base commit wrote it.
// (That file is NOT byte-identical to the base commit, and an earlier revision of this comment claimed the
// adaptation lived here to keep it so; it carries the fail-closed database gate of review finding M1.)
//
// `DB()` binds its two hook methods with `_.bindAll`, and underscore 1.13.8 - the version the
// base commit's `^1.8.3` range also resolves to - dropped `_.bind`'s native-bind fast path: `_.bind` now
// returns a `restArguments` wrapper whose `length` is 0, where underscore 1.8.3 delegated to
// `Function.prototype.bind` and preserved the declared arity. Mocha decides whether a hook is
// asynchronous from `fn.length` (mocha/lib/runnable.js), so the arity-0 wrapper is invoked with no
// callback and both hooks throw `TypeError: done is not a function` - measured, and it silently skips the
// whole API suite. Re-declaring the two methods with their arity intact restores every existing call
// site exactly as the base commit wrote it: the bare-reference hooks at test/lib/api/index.js:27,29 and
// test/lib/models/user.js:7, and the explicit `db.reset(done)` at test/lib/api/index.js:37. This runs
// before any spec file is loaded, so the hook registrations see the adapted methods.
//
// The wrapper also raises the hook timeout (review finding M12). `db.reset` performs a real
// `dropDatabase()`, which on a mongod shared by several checkouts was measured to exceed Mocha's 2000 ms
// default and abort the whole run in `test/lib/api/index.js`'s very first hook. Mocha binds `this` to the
// hook's Context, so the limit is raised for the hook that actually needs it rather than globally in
// `.mocharc.json` - which carries exactly the four keys the Technical Specification enumerates and gains
// no fifth. The guard keeps this file usable outside a Mocha run, where there is no Context.
['ensureConnection', 'reset'].forEach(function(hook) {
  var bound = db[hook];

  db[hook] = function(done) {
    if (this && typeof this.timeout === 'function') {
      this.timeout(60000);
    }

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
// `check-leaks` stays enabled rather than being relaxed, and this barrier is NOT what allows that - the
// eager key reservation above is. An earlier revision of this comment claimed the barrier was unnecessary
// for the snapshot because `init()` always resumed during Mocha's file loading; re-measured on mocha 11.7.6
// by instrumenting `Runner.prototype.globals`, that holds for a full run (42 keys, model names present) and
// FAILS for a single spec file (34 keys, model names absent), so it was a race rather than an invariant.
// The reservation is what makes the snapshot unconditional. This hook still runs after that snapshot, and
// it has two jobs: the barrier, and the drift check below - if `app.js` ever stops assigning one of the
// reserved names, the reserved `undefined` would otherwise reach a spec as a bare
// `Cannot read properties of undefined` from whichever line dereferenced it first, and in `File`'s case as
// something even less legible, since Node's own `File` would answer in the model's place.
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

// THE DRIFT CHECK, and why it asks two questions rather than one.
//
// (1) DID `app.js` ASSIGN THIS NAME? Answered by identity against the pre-require snapshot, never by
//     `typeof === 'undefined'`, for the `File` reason recorded next to that snapshot.
// (2) IS WHAT IT ASSIGNED STILL A MODEL? Answered by the surface `lib/models/model.js:180-202` gives every
//     public model - a callable factory carrying `getName()`, `schema`, `isInstance()` and `extend()`. This
//     second question is what makes the check survive a future edit that keeps the assignment but points it
//     at something else, and it is the only description of a model this file states, deliberately: it
//     asserts the shape the model factory publishes, not the contents of any one schema, so it does not
//     become a second source of truth for what any individual model is.
//
// What it pointedly does NOT assert is `getName() === name`. Measured: `Trinket.getName()` returns
// `'Snippet'` - the global and the mongoose model name genuinely differ for that one - so equality there
// would be a false failure on a correct tree.
var MODEL_SURFACE = ['getName', 'isInstance', 'extend'];

function describeGlobalDrift() {
  var problems = [];

  MODEL_GLOBALS.forEach(function(name) {
    var value = global[name];
    var pre   = PRE_BOOTSTRAP_GLOBALS[name];

    if (value === pre.value) {
      problems.push(name + ': still holds the value it held before app.js was required (' +
        (pre.present ? 'Node\'s own built-in ' + name : 'the reserved `undefined`') + '), so app.js never ' +
        'assigned it');
      return;
    }

    if (typeof value !== 'function') {
      problems.push(name + ': assigned a ' + typeof value + ' rather than a model factory');
      return;
    }

    var missing = MODEL_SURFACE.filter(function(method) {
      return typeof value[method] !== 'function';
    });

    if (!value.schema) missing.push('schema');

    if (missing.length) {
      problems.push(name + ': assigned a function that is not a model - no ' + missing.join(', '));
    }
  });

  return problems;
}

if (typeof before === 'function') {
  before(async function() {
    await app;

    var problems = describeGlobalDrift();

    if (problems.length) {
      throw new Error('test/setup.js reserved global keys that app.js did not fill with models:\n  ' +
        problems.join('\n  ') + '\nThe reservation list in this file must match the model globals at ' +
        'app.js:285-293, and each must still be a public model from lib/models/model.js. `File` is the ' +
        'name to check first: Node 22 ships its own non-enumerable `global.File`, so a missing assignment ' +
        'there leaves a real constructor behind rather than `undefined` and every later symptom points ' +
        'somewhere else.');
    }

    // THE DATABASE BARRIER (review finding M12), registered on the ROOT suite for the same reason the
    // app barrier above is: it has to hold for every spec file, not only for the ones that happen to
    // declare a `before(db.reset)` of their own.
    //
    // test/helpers/db.js opens its connection from a timer during module load and drops the database
    // once the connection is announced, setting `_isConnected` only after that drop RESOLVES. Nothing
    // waited for it. A spec file that touches a model in its own `before` - test/lib/models/*.js and
    // test/lib/models/plugins/*.js all do, and `npx mocha test/lib/models/course.js` runs them without
    // the API suite's `before(db.reset)` ahead of them - could therefore create a fixture that the
    // initialization drop then deleted underneath it. Awaiting readiness here removes the race for
    // every entry point, including a single-file run.
    //
    // `db.ensureConnection` is the existing poll and is used rather than a second mechanism; the
    // arity-restoring wrapper installed above is already in place at this point, so this call reaches
    // the same function every hook does. The generous timeout below is for the DROP, not for the
    // connection: dropping a database that the previous run filled was measured at over Mocha's 2000 ms
    // default on a shared mongod, and a flake there aborts the whole run in its first hook.
    this.timeout(60000);

    await new Promise(function(resolve, reject) {
      db.ensureConnection(function(err) {
        return err ? reject(err) : resolve();
      });
    });
  });
}

// The exports were `{}` at the base commit and stay a plain object with no behaviour, so this file remains a
// valid no-op "spec" for Mocha's default glob and the benign require cycles with test/helpers/db.js and
// test/helpers/catbox-redis.js - each of which requires this module for its side effects and never reads its
// exports - are unaffected. The single property is the booted server described above.
module.exports = bootstrap;
