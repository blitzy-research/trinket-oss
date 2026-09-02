#!/usr/bin/env node
'use strict';

// The parity server launcher - the one way the application is started for a
// parity comparison, by every gate that needs a listening socket.
//
// AAP §0.9.3 asks for a launcher that "starts the process, polls until a known
// route answers, records the PID and shuts down gracefully on exit and
// failure", against EITHER of two worktrees. Everything in this file follows
// from that last clause.
//
// ===========================================================================
// RULES
// ===========================================================================
// `review_rules` returns exactly "No user rules provided." for this project,
// which AAP §0.7 and §0.10.1 independently record. No rule is invented here and
// their absence is not read as licence to lower the bar: enterprise practice
// governs. Two commitments of test/parity/ land on this file in particular.
//
//   The baseline is captured before anything changes. One launcher, two
//   worktrees, selected by `--app`. That is only possible if the application is
//   a CHILD PROCESS whose working directory is the tree under test, because the
//   two trees are independently `npm ci`'d and their dependency graphs differ -
//   they cannot share `node_modules`. So this file requires no application
//   module, and the tree the child runs in is an argument rather than a
//   compile-time fact.
//
//   Every parity claim is backed by an inspectable artifact. The child's stdout
//   and stderr are captured to SEPARATE files whose paths are returned, because
//   AAP §0.9.3's zero-warning pass condition is an assertion about that stderr -
//   over the listening server, a full 233-route replay and the standalone
//   worker. A launcher that inherited the child's descriptors would interleave
//   the two streams into a terminal and leave nothing to assert against.
//
// The request's own RULES block is binding and is not that document:
//   R-a  The diff must read as migration work only. This file provisions and
//        observes; it asserts nothing, seeds nothing and repairs nothing.
//   R-b  The application must genuinely run. A launcher that reported readiness
//        without one would make every gate above it vacuous, which is why
//        readiness is an HTTP round trip and not a sleep.
//   R-d  Behaviour improvements are prohibited, so nothing here alters the
//        application: every deviation the harness needs is an EXTERNAL overlay.
//   R-f  Baseline observed behaviour at 2f8712a is the tie-breaker. Nothing may
//        be installed into, written into, or required from the tree under test.
//        The baseline tree has no test/parity/ at all.
// The BOUNDARIES & PRESERVATION clauses on session/auth behaviour and on
// client-visible page behaviour are bound to the two cookie configurations this
// launcher produces - see COOKIE PASSES below.
//
// ===========================================================================
// WHY A CHILD PROCESS, AND WHAT THAT FORBIDS
// ===========================================================================
// The application is spawned, never required. Consequences, each load-bearing:
//
//   * Requiring the application entry point from here would resolve
//     `@hapi/hapi`, `mongoose` and everything else out of THIS tree's
//     node_modules whatever `--app` said, so a "baseline" run would exercise
//     the target's dependency graph while reporting the baseline's. The
//     comparison would be between one tree and itself.
//     (The prohibition is checkable mechanically: every require call in this
//     file names either a Node core module or ./mongo, and no line anywhere in
//     it - code or comment - pairs a require call with an application path.)
//   * config/app.config.js requires ./db, whose module scope calls
//     `mongoose.connect` (config/db.js), so merely requiring the configuration
//     dials a database. In a launcher that is a side effect; in the child it is
//     the intended startup.
//   * `mongoose-schema-extend` replaces the global `Object.getPrototypeOf` and
//     makes `@hapi/hapi` unloadable if it loads first (AAP §0.6.5). Reaching it
//     from this process would poison the launcher itself.
//   * test/helpers/** and test/lib/** are equally out of bounds: flow.js
//     requires app.js and db.js requires config/db, so either pulls the
//     application in through the side door.
//
// The only internal module required here is ./mongo, which is Node core plus
// `mongodb-memory-server` and touches no application module. Its header names
// this file as a consumer of `start`, `stop`, `uri` and `withMongo`
// "so none of them re-implements any of this", and this file honours that: the
// deep merge, the overlay reader and the address layer are ITS implementations,
// used here rather than copied.
//
// The application does not exit on its own. app.js:371 installs
// `setInterval(detectLeaks, 60*1000)`, which holds the event loop open for the
// life of the process, so shutdown is by signal and a polite wait alone would
// hang. See SHUTDOWN.
//
// ===========================================================================
// THE CONFIGURATION OVERLAY - external, layered, and deep-merged
// ===========================================================================
// config/test.yaml:3 sets `app.start: false`. Measured: `NODE_ENV=test node
// app.js` therefore starts nothing at all - it initialises, returns the server
// and sits there with no listening socket. The overlay's `app.start: true` is
// the single line that produces one, which is why this file cannot be skipped
// in favour of "just run the app".
//
// Five layers, lowest first. Each higher layer wins key by key:
//
//   1. The inherited NODE_CONFIG. Honoured rather than discarded, so
//      `node test/parity/mongo.js --overlay -- node test/parity/server.js`
//      works: the wrapper has already composed the overlay and the database
//      address into the environment, and re-composing them here is idempotent.
//   2. test/parity/server-overlay.json. Carries `app.start: true`, the bind
//      host and port, `app.url`, the fixed NON-PRODUCTION session secret,
//      `db.redis.enabled: false` and the `aws.buckets.exports` entry committed
//      configuration lacks (AAP §0.6.7).
//   3. The per-run MongoDB address, from ./mongo's own `buildRuntimeConfig` -
//      `db.mongo.{host,port,database}` as config/db.js interpolates them, with
//      `mongo.user`, `mongo.pass` and `mongoread.host` pinned null so an
//      inherited credential or a config/local.yaml cannot redirect the child.
//      The address is ADOPTED when layer 1 already published a complete one -
//      which is what makes ./mongo's documented
//      `node test/parity/mongo.js --overlay -- node test/parity/server.js` start
//      one database rather than two - and provisioned otherwise. See
//      `resolveMongo` for the measurement behind that default.
//   4. This launcher's host/port layer, applied only when `--host`/`--port` are
//      given. It sets `app.hostname` AND `app.url.{protocol,hostname,port}`
//      together, and that pairing is not cosmetic: config/app.config.js:16-17
//      composes `config.url` from `app.url.*`, and lib/util/routeParser.js's
//      `redirect()` builds every absolute `Location` from `config.url`. Moving
//      the bound port without moving `app.url.port` would leave every redirect
//      pointing at a port nothing is listening on - and the corpus compares
//      `Location` exactly.
//   5. `--config <json>` / `options.config`, an explicit top layer for a caller
//      that needs one. This is also the escape hatch for the one value the
//      launcher deliberately does NOT rewrite: the overlay's
//      `aws.buckets.exports.host` embeds the overlay's own port, and a run that
//      moves the port leaves it as it is rather than guessing at the operator's
//      intent. It is a string persisted onto an Export document, never fetched
//      by the application, so a stale port there is inert for this gate.
//
// DEEP merge throughout, never `Object.assign`, and ./mongo's `deepMerge` is
// the implementation. The reason is measured: the overlay declares both
// `db.mongo.database` and `db.redis.enabled`, and layer 3 replaces the first. A
// shallow merge of `db` would discard the second, `lib/util/queues.js` would
// construct Bull against a Redis the gate deliberately does not provide, and a
// shallow merge of `app` would discard `app.start` and produce no server at all.
//
// The composed value is passed as NODE_CONFIG in the child's environment, with
// NODE_ENV=test and NODE_CONFIG_PERSIST_ON_CHANGE=N, matching test/env.js.
// NODE_CONFIG_DIR is deliberately NOT set: the child's working directory IS
// `appRoot`, so the `config` package finds that tree's own config/ directory -
// which is the whole point of selecting the tree by path.
//
// NODE_CONFIG_RUNTIME_JSON is set, at a per-run path inside the run directory,
// and that one is not tidiness. R-f says nothing may be written into the tree
// under test, and PERSIST_ON_CHANGE=N alone does not achieve it - MEASURED, and
// measured after this file first claimed otherwise. config 0.4.37 writes `{}`
// into `<NODE_CONFIG_DIR>/runtime.json` whenever that file is missing or empty,
// to give `fs.watch` something to watch, and it skips the write only when
// PERSIST_ON_CHANGE is 'N' AND DISABLE_FILE_WATCH is 'Y'
// [node_modules/config/lib/config.js:867-880]. A first run against a clean
// baseline worktree therefore created a file inside it.
//
// That is not merely untidy. runtime.json is layered OVER every other
// configuration source, so a tree that accumulated one would feed run N+1
// whatever run N happened to persist, and two runs of "the identical command"
// would no longer be identical. Redirecting the path fixes it for both trees at
// once, keeps the file watch behaving exactly as the application expects -
// disabling it would be a behaviour change R-d does not permit - and makes the
// top configuration layer a fresh, empty, deterministic `{}` on every run.
//
// With that, nothing under appRoot is written to and no configuration file is
// edited, on either tree. Every deviation is external, so the identical command
// runs against both.
//
// ===========================================================================
// COOKIE PASSES - two runs, and why both are required
// ===========================================================================
// config/default.yaml:41 sets `isSecure: false`, so app.js:124 and :229 both
// evaluate `isSecure !== false` to false. The default pass therefore produces
// Yar's `SameSite=Lax` with no `Secure`, and the private-field patch at
// app.js:229-265 appends only `; Expires=<one year out>`.
//
// `--secure` adds `app.plugins.session.cookieOptions.isSecure: true`, which
// flips `cookieIsSecure` at app.js:229 and appends `; SameSite=None; Secure` at
// :254.
//
// AAP §0.9.3 requires BOTH passes, and AAP §0.9.6 lists that patch as an open
// item precisely because its failure mode is silence: it only runs while
// `request.response._header` is a function (app.js:232), so if hapi 21 stopped
// populating that private field the patch would become a no-op, cookie expiry
// would change, and nothing would error. Asserting the `Expires` horizon in the
// non-secure pass is the only way that is detectable - so `secure` is a
// first-class option and is echoed back on the start result.
//
// ===========================================================================
// FIXTURE INJECTION - the mechanism, and the environment contract
// ===========================================================================
// External effects are intercepted at the MODULE BOUNDARY, not over the
// network, so the corpus is reproducible without a proxy. All three fixtures
// must therefore be in place before the application loads, which `--require`
// guarantees: Node runs every preload before the entry point.
//
//   node <flags> --require <target>/test/parity/fixtures/aws.js \
//                --require <target>/test/parity/fixtures/mail.js \
//                --require <target>/test/parity/fixtures/http.js \
//                <appRoot>/app.js
//
// The fixture paths are ABSOLUTE and rooted at THIS file's directory, so they
// load from the TARGET worktree while the application loads from `appRoot`.
// That asymmetry is the design: the fixtures are the harness's, the application
// is whichever tree `--app` names.
//
// A preload cannot take command-line arguments, so every per-run path reaches
// the fixtures through the environment. This is the authoritative list, and it
// is reproduced from the three fixtures' own ENVIRONMENT CONTRACT headers so
// that they and this launcher cannot drift:
//
//   PARITY_APP_ROOT           All three. Absolute path of the worktree under
//                             test. Each fixture resolves the application
//                             module it patches - config/aws, lib/util/mailer,
//                             the `request` package - relative to this, never
//                             relative to its own __dirname, which on a
//                             baseline run would patch a module instance no
//                             controller holds. Their fallback is
//                             `process.cwd()`, and it is correct because the
//                             child's cwd IS appRoot; the variable is set
//                             explicitly anyway, so the contract is visible
//                             rather than implied.
//   PARITY_S3_ROOT            fixtures/aws.js. Root of the filesystem-backed
//                             object store. Per-run, under the run directory.
//   PARITY_S3_SEED            fixtures/aws.js, optional. A JSON pre-population
//                             manifest, read ONCE at load - the only channel
//                             that reaches a preload, and what lets
//                             test/parity/seed.js place a pre-migration object
//                             INSIDE the server child. Passed through from
//                             `--s3-seed` / `options.s3Seed`.
//   PARITY_S3_LOG             fixtures/aws.js, optional evidence file.
//   PARITY_MAIL_LOG           fixtures/mail.js. Captured mail evidence.
//   PARITY_HTTP_PROFILE       fixtures/http.js. Initial profile name; unset
//                             selects 'default'.
//   PARITY_HTTP_PROFILE_FILE  fixtures/http.js, optional. A JSON file shaped
//                             {"profile": "<name>"}, RE-READ synchronously at
//                             the start of every intercepted call. This is how
//                             corpus cases switch OAuth and streaming profiles
//                             without restarting the server, so the launcher
//                             creates it with the initial profile already in it
//                             and returns its path for capture.js to rewrite.
//   PARITY_HTTP_LOG           fixtures/http.js, optional evidence file.
//
// The three evidence logs are set by default rather than left unset: the
// commitment above is that a parity claim is backed by an artifact, and "the
// fixture intercepted this call" is a claim. Every one is a strict no-op in the
// fixture when unset, so a caller who wants them silent can clear them through
// `options.env`.
//
// TMPDIR, TMP and TEMP are also set, at the per-run uploads directory. The
// application exposes no configuration key for either the uploads directory or
// the object-store root - app.js:96-101 hard-codes hapi's `routes` options, so
// the payload `uploads` directory is hapi's default, `os.tmpdir()`. On POSIX
// `os.tmpdir()` reads TMPDIR, then TMP, then TEMP, and `tmp.tmpName`
// (lib/controllers/users.js:693) resolves the same way. Setting the three
// variables is therefore the only non-invasive way to give a run its own
// upload scratch space, and it is honestly described as an environment
// mechanism rather than dressed up as configuration.
//
// Fixtures are never injected by editing application code, by writing into
// appRoot, or through an NODE_OPTIONS string: NODE_OPTIONS is one shell-quoted
// scalar, and a path containing a space would silently split into two broken
// flags. `spawn` with an argv array has no quoting layer at all.
//
// ===========================================================================
// READINESS, EVIDENCE AND THE PORT
// ===========================================================================
// Readiness is `GET /.well-known/<random token>`. lib/util/routeParser.js:
// 563-569 registers `/.well-known/{path*}` with a FUNCTION handler that returns
// `h.response().code(404)`, so it answers without touching MongoDB and a 404
// proves the ROUTE TABLE is registered rather than merely that a socket is
// open. A 404 is therefore success, and the poller distinguishes it from
// ECONNREFUSED, which only means "not listening yet". The token is randomised
// so a stale answer from something else cannot be mistaken for ours.
//
// Parsing the log for the port is not an option and was not left as one:
// app.js:332 logs the port at INFO level, and config/test.yaml:5 sets
// `app.log.level: error`, so under NODE_ENV=test that line is never printed.
//
// The bind port is asserted FREE before the child is spawned. This is the
// single most important guard in the file. A server left listening by an
// earlier run would answer the readiness probe, every subsequent request would
// be served by the wrong process, and the run would report a clean pass for a
// build it never exercised. Polling also aborts the instant the child exits,
// so a boot failure is reported as one - with the tail of the captured stderr,
// where an unreachable database or a session-password refusal is legible.
//
// ===========================================================================
// SHUTDOWN
// ===========================================================================
// `stop()` sends SIGTERM, waits a bounded interval, then SIGKILL, and is
// idempotent. app.js installs no signal handler, so SIGTERM's default
// disposition ends it; the SIGKILL exists for a child wedged in a syscall,
// because the 60-second interval timer means a polite wait alone can hang
// forever.
//
// It is wired to normal completion, a thrown error, SIGINT, SIGTERM and an
// unhandled rejection in the launcher, plus a synchronous `process.on('exit')`
// sweep for the paths none of those catch. ./mongo declines to install signal
// listeners in library mode, on the sound principle that hijacking a host's
// SIGINT is not its business; this file installs them by default anyway, and
// the reason is a difference in what leaks. A missed mongod teardown leaves a
// temporary directory; a missed teardown here leaves an APPLICATION SERVER
// HOLDING A PORT, which is exactly the failure the free-port assertion exists
// to catch and which would silently corrupt the next run. The listeners are
// removed by `stop()`, so a host process gets its own signal disposition back,
// and `options.installSignalHandlers: false` declines them outright.
//
// The PID file is removed on clean shutdown. The captured logs are NOT: they are
// the evidence, and a run that deleted them would have nothing to show.
//
// ===========================================================================
// INVOCATION
// ===========================================================================
//   node test/parity/mongo.js --overlay -- node test/parity/server.js --app .
//   node test/parity/server.js --app . --port 3010
//   node test/parity/server.js --app /path/to/baseline-2f8712a --secure
//   node test/parity/server.js --app . --node-flags "--pending-deprecation --trace-deprecation"
//
// As a module: `start(options)` and `stop()`. The CLI runs only under
// `require.main === module`, so capture.js, replay.js and joi-matrix.js reuse
// one implementation instead of three. Every human-readable byte this file
// produces goes to STDERR; stdout is left clean for a caller that captures it.
//
// ===========================================================================
// PROHIBITIONS - each with the reason, and where it is honoured
// ===========================================================================
//   No require of app.js, config/**, lib/**, test/helpers/** or test/lib/**.
//     Any of them breaks the two-worktree model, and the last two pull the
//     application in through the side door. Honoured at the require block
//     below: seven Node core modules and ./mongo, which is itself Node core
//     plus mongodb-memory-server.
//   No `url.parse`, anywhere. It emits DEP0169, and this process's stderr sits
//     inside the very stream AAP §0.9.3's zero-warning gate inspects - a
//     harness that failed its own gate would be worse than no harness.
//     Honoured by `new URL(...)` in `parseMongoUri` and `readyUrl`, the only
//     two places a URL is parsed or built. Measured: under
//     `--pending-deprecation --trace-deprecation` this process emits nothing
//     but prefixed `[parity:*]` notes.
//   No edit to any configuration file and no write into the tree under test,
//     on either tree. Honoured by the external overlay, and by
//     NODE_CONFIG_RUNTIME_JSON - see THE CONFIGURATION OVERLAY, where the one
//     write that did reach a clean baseline worktree is recorded along with
//     what stops it.
//   No committed production secret. This file contains no credential of any
//     kind; the fixed session secret lives in
//     test/parity/server-overlay.json, is explicitly non-production, and is
//     fixed precisely so that session cookie values are reproducible across a
//     baseline-capture / target-replay pair.
//   No network access beyond localhost. This process connects to exactly one
//     address - the readiness probe, at the loopback origin it derived from the
//     composed configuration. The child reaches no external service either:
//     S3, mail and outbound HTTP are intercepted at the module boundary by the
//     three preloads, which is what makes the corpus reproducible with no
//     network at all.

var childProcess = require('child_process');
var crypto       = require('crypto');
var fs           = require('fs');
var http         = require('http');
var net          = require('net');
var os           = require('os');
var path         = require('path');

// The one internal require, and the only one permitted: Node core plus
// mongodb-memory-server, no application module. `deepMerge`, `readOverlay`,
// `buildRuntimeConfig`, `isPlainObject`, `ToolError` and the lifecycle come
// from here rather than being reimplemented, so the two files cannot disagree
// about what an overlay is or how a layer wins.
var mongo = require('./mongo');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Exit codes. EXIT_ERROR is this file's own failure - the server could not be
// launched or could not be shut down cleanly - and is deliberately distinct
// from anything the application itself reports.
var EXIT_OK    = 0;
var EXIT_ERROR = 2;

var LOG_PREFIX = '[parity:server] ';

// The application's entry point, relative to the worktree under test. Named
// once so a reader never has to grep for what is spawned.
var APP_ENTRY = 'app.js';

// The preloads, in load order, resolved against THIS file's directory so they
// always come from the target worktree. Order matters only in that all three
// must precede the entry point; between themselves they are independent, and
// each patches a different module.
var FIXTURE_FILES = ['aws.js', 'mail.js', 'http.js'];

// Where the fixtures live. A run whose fixtures are missing is a broken
// checkout, not a condition to work around, so their absence is a hard error.
var FIXTURE_DIR = path.join(__dirname, 'fixtures');

// The readiness route. lib/util/routeParser.js:563-569 answers it with a
// function handler and a 404, without touching the database.
var READY_PATH_PREFIX = '/.well-known/parity-ready-';

// Readiness budget. 60s is generous for a local boot and is bounded so a wedged
// child fails the gate rather than hanging it. The poll interval is short
// because the interesting case - a child that exits during boot - is detected
// by the exit listener rather than by polling, so a tight interval costs
// nothing but shortens the happy path.
var READY_TIMEOUT_MS  = 60000;
var READY_INTERVAL_MS = 150;

// Per-probe budget. A socket that connects and then says nothing is a distinct
// failure from one that refuses, and without this it would consume the whole
// readiness budget in a single request.
var PROBE_TIMEOUT_MS = 5000;

// How long SIGTERM is given before SIGKILL. Deliberately this file's own value
// rather than ./mongo's SHUTDOWN_GRACE_MS: that budget covers a mongod flushing
// a data directory, while this one covers a hapi server closing sockets, which
// is fast, and every second of it is a second a gate script waits.
var STOP_GRACE_MS = 5000;

// How much captured stderr accompanies a failure message. Enough for a stack
// and the lines around it, small enough that the actionable first line of the
// message is still the first thing a reader sees.
var STDERR_TAIL_BYTES = 4000;

// The environment the child is given beyond the composed configuration.
var NODE_ENV_VALUE    = 'test';
var PERSIST_ON_CHANGE = mongo.PERSIST_ON_CHANGE;

// The default profile name fixtures/http.js selects when PARITY_HTTP_PROFILE is
// unset. Written into the profile file so the file is valid from the start and
// the fixture never has to log a malformed read.
var DEFAULT_HTTP_PROFILE = 'default';

// The `provisionMongo` default: adopt an inherited database address if one was
// published into this process's environment, and provision one otherwise.
var PROVISION_AUTO = 'auto';

var USAGE = [
  'Usage: node test/parity/server.js [options]',
  '',
  'Starts the application as a child process in the worktree given by --app,',
  'with the parity fixtures preloaded and an external NODE_CONFIG overlay,',
  'polls until its route table answers, and shuts it down on every exit path.',
  '',
  'Options:',
  '  --app <dir>          Worktree under test; the child\'s working directory,',
  '                       so its own node_modules and config/ are the ones that',
  '                       load. Defaults to the current directory.',
  '  --overlay [path]     NODE_CONFIG overlay, deep-merged under the database',
  '                       address. Defaults to test/parity/server-overlay.json.',
  '                       Also --overlay=<path>.',
  '  --no-overlay         Start with no overlay file at all. Note that',
  '                       config/test.yaml sets app.start: false, so this',
  '                       normally produces no listening socket.',
  '  --secure             Set session isSecure: true, the pass in which the',
  '                       cookie patch appends "; SameSite=None; Secure".',
  '  --host <host>        Bind host, and app.url.hostname with it.',
  '  --port <n>           Bind port, and app.url.port with it, so absolute',
  '                       Location headers match the port actually served.',
  '  --database <name>    Pin the MongoDB database name.',
  '  --mongo-uri <uri>    Use an already-running mongod at this address instead',
  '                       of provisioning one.',
  '  --no-mongo           Provision nothing and adopt nothing; the inherited',
  '                       NODE_CONFIG or --config must carry the address.',
  '  --provision-mongo    Always provision, even when an address was inherited.',
  '                       By default an inherited address is adopted, so',
  '                       `node test/parity/mongo.js --overlay -- node',
  '                       test/parity/server.js` starts ONE database, not two.',
  '  --node-flags <flags> Passed to the child node process before the preloads.',
  '                       Repeatable, and a single value may be space-separated:',
  '                       --node-flags "--pending-deprecation --trace-deprecation".',
  '  --run-dir <dir>      Per-run directory for the PID file, the captured logs,',
  '                       the object store and the upload scratch space.',
  '                       Defaults to a fresh directory under the system temp.',
  '  --config <json>      An explicit top NODE_CONFIG layer, applied last.',
  '  --s3-seed <path>     PARITY_S3_SEED for fixtures/aws.js.',
  '  --http-profile <n>   PARITY_HTTP_PROFILE for fixtures/http.js.',
  '  --ready-timeout <ms> Readiness budget; default ' + READY_TIMEOUT_MS + '.',
  '  --print-config       Also write the composed NODE_CONFIG to stderr.',
  '  -h, --help           Print this on stderr and exit 0.',
  '',
  'Runs until interrupted. SIGINT and SIGTERM bring the child down and exit.',
  '',
  'Examples:',
  '  node test/parity/mongo.js --overlay -- node test/parity/server.js --app .',
  '  node test/parity/server.js --app . --port 3010 --secure',
  '  node test/parity/server.js --app ../baseline-2f8712a --no-mongo',
  '',
  'Every diagnostic goes to stderr. Nothing is ever written to stdout.'
].join('\n');

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

// One server per process, for the same reason ./mongo keeps one database per
// process: the parity harnesses are single-purpose scripts, and a second
// concurrent application in one launcher would be a caller mistake rather than
// a case to support. `start` returns the running one instead of quietly
// spawning a second child nobody would stop.
var state = {
  child             : null,   // The spawned application, once started.
  info              : null,   // The start result, as returned to the caller.
  startPromise      : null,   // In-flight start, so concurrent callers share one.
  stopPromise       : null,   // In-flight stop, which is what makes stop idempotent.
  stopping          : false,  // True while a deliberate teardown is in flight.
  exit              : null,   // {code, signal} once the child has exited.
  runDir            : null,   // The per-run directory, for the sweep message.
  pidPath           : null,   // The PID file, removed on clean shutdown.
  stdoutPath        : null,   // Captured stdout - kept, always.
  stderrPath        : null,   // Captured stderr - kept, always. The gate reads it.
  stdoutFd          : null,   // Open descriptor handed to the child.
  stderrFd          : null,
  ownsMongo         : false,  // True when this file started the database.
  listeners         : [],     // Process listeners, for removal.
  sweepInstalled    : false,
  handlersInstalled : false,
  failed            : false   // Raises a zero exit code on a teardown fault.
};

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Writes one diagnostic line to stderr.
 *
 * Stdout is never written to by any path in this file. A caller such as
 * test/parity/manifest.js captures stdout as its artifact, and the route-table
 * gate compares it byte for byte, so a launcher that printed there would
 * corrupt the very comparison it exists to enable.
 *
 * Every line is prefixed, and that matters more here than it looks: this
 * process's stderr sits inside the stream AAP §0.9.3's zero-warning gate
 * inspects, and the gate's pass condition is "no warning attributable to the
 * application's own source or to any retained dependency". A prefixed harness
 * line is neither, and the prefix is what makes that decidable by eye.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  process.stderr.write(LOG_PREFIX + String(message) + '\n');
}

/**
 * An operational failure of the launcher itself.
 *
 * Reused from ./mongo rather than redeclared, so a caller that catches one kind
 * of harness error catches both. Its message alone is printed - the messages
 * here are written to be actionable and a stack trace would bury them. Anything
 * that is NOT a ToolError is a defect in this file, and its stack IS the
 * evidence, so that case prints the trace.
 */
var ToolError = mongo.ToolError;

/**
 * A ToolError that additionally means "you invoked this wrongly".
 *
 * Separated only so `main` can print the usage text alongside it. A usage
 * mistake is the one failure where the remedy is a different command line, and
 * showing the options is more use than repeating the message.
 *
 * @param {string} message
 * @returns {ToolError}
 */
function usageError(message) {
  var err = new ToolError(message);

  err.usage = true;

  return err;
}

/**
 * The trailing bytes of the child's captured stderr, for a failure message.
 *
 * A boot failure is nearly always legible there - an unreachable database
 * surfaces as a MongooseServerSelectionError, a refused session password as the
 * banner app.js:55-67 prints - and a launcher that reported only "the server
 * did not become ready" would send a reader looking for a file they do not know
 * the name of. Reading is guarded: a missing or unreadable log must never
 * replace the real failure with a second one about logging.
 *
 * @param {(string|null)} target Path of the captured stderr.
 * @param {number} [limit] Maximum bytes to return.
 * @returns {string} The tail, or '' when there is nothing to show.
 */
function stderrTail(target, limit) {
  var max = limit === undefined ? STDERR_TAIL_BYTES : limit;
  var text;

  if (!target) {
    return '';
  }

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    return '';
  }

  if (text.length > max) {
    text = '...' + text.slice(text.length - max);
  }

  return text.replace(/\s+$/, '');
}

/**
 * Formats a failure with whatever the child managed to say first.
 *
 * @param {string} message The launcher's own account of what went wrong.
 * @returns {ToolError}
 */
function launchError(message) {
  var tail = stderrTail(state.stderrPath);
  var full = message;

  if (state.stdoutPath && state.stderrPath) {
    full += ' Captured output: ' + state.stdoutPath + ' (stdout), ' +
      state.stderrPath + ' (stderr).';
  }

  if (tail) {
    full += '\n--- tail of ' + state.stderrPath + ' ---\n' + tail;
  }

  return new ToolError(full);
}

// ---------------------------------------------------------------------------
// Small shared predicates
// ---------------------------------------------------------------------------

/**
 * True for an object that can be merged key by key.
 *
 * ./mongo's implementation, not a second copy: the two files must agree about
 * what an overlay is, and an array must be a value rather than a merge target
 * in both.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return mongo.isPlainObject(value);
}

/**
 * Deep-merges `overlay` over `base`, returning a new plain object.
 *
 * ./mongo's implementation. See THE CONFIGURATION OVERLAY in the header for why
 * the depth is load-bearing rather than stylistic.
 *
 * @param {Object} base The layer that loses.
 * @param {Object} overlay The layer that wins.
 * @returns {Object} A new object; neither argument is mutated.
 */
function deepMerge(base, overlay) {
  return mongo.deepMerge(base, overlay);
}

/**
 * Reads a value out of a nested object without throwing on a missing branch.
 *
 * Used only to read the composed configuration back - the bind host, the port,
 * the URL parts - which is a read of data this file just built, so a missing
 * key means a layer did not supply one and the caller substitutes a default
 * rather than failing.
 *
 * @param {Object} source
 * @param {Array.<string>} keys The path, outermost first.
 * @returns {*} The value, or undefined.
 */
function pick(source, keys) {
  var cursor = source;
  var i;

  for (i = 0; i < keys.length; i++) {
    if (!isPlainObject(cursor)) {
      return undefined;
    }
    cursor = cursor[keys[i]];
  }

  return cursor;
}

/**
 * Builds a one-key-deep nested object, for a configuration layer.
 *
 * `nest(['app','port'], 3010)` is `{app: {port: 3010}}`. Written out rather
 * than assembled by hand at each site because a layer built with a typo in a
 * path silently does nothing, and one function is one place to be right.
 *
 * @param {Array.<string>} keys The path, outermost first.
 * @param {*} value
 * @returns {Object}
 */
function nest(keys, value) {
  var out = {};
  var cursor = out;
  var i;

  for (i = 0; i < keys.length - 1; i++) {
    cursor[keys[i]] = {};
    cursor = cursor[keys[i]];
  }

  cursor[keys[keys.length - 1]] = value;

  return out;
}

/**
 * Parses a port, rejecting everything that is not one.
 *
 * A port that arrived as the string '3010abc' would become NaN, `Hapi.server`
 * would fall back to a default, and the launcher would then poll a port nothing
 * was ever bound to. Port 0 is rejected for a related reason: hapi would bind
 * an ephemeral port, and with app.js's info-level start line suppressed under
 * NODE_ENV=test there is no way to learn which one - so the readiness probe
 * would have nowhere to go.
 *
 * @param {*} value
 * @param {string} label What to call it in the message.
 * @returns {number}
 * @throws {ToolError} If it is not an integer in 1..65535.
 */
function parsePort(value, label) {
  var port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw usageError(label + ' must be an integer between 1 and 65535, not ' +
      JSON.stringify(value) + '. Port 0 is rejected too: hapi would bind an ' +
      'ephemeral port and config/test.yaml suppresses the line app.js:332 ' +
      'logs it on, so the readiness probe would have no address.');
  }

  return port;
}

/**
 * Splits a --node-flags value into individual arguments.
 *
 * Accepted both repeated and space-separated, because both are natural to type
 * and a gate script assembling the flags from a variable will produce the
 * second. Splitting on whitespace is sufficient and is deliberately not a shell
 * parser: node flags do not contain spaces, and pretending to handle quoting
 * would invite exactly the NODE_OPTIONS-style breakage the header rejects.
 *
 * @param {(string|Array.<string>)} value
 * @returns {Array.<string>}
 */
function splitFlags(value) {
  var parts = Array.isArray(value) ? value : [value];
  var out   = [];
  var i;
  var j;
  var pieces;

  for (i = 0; i < parts.length; i++) {
    pieces = String(parts[i]).split(/\s+/);
    for (j = 0; j < pieces.length; j++) {
      if (pieces[j] !== '') {
        out.push(pieces[j]);
      }
    }
  }

  return out;
}


// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * The option defaults, as a fresh object.
 *
 * Returned rather than shared, because `start` merges a caller's options over
 * it and a shared default object would accumulate one caller's choices into the
 * next caller's baseline.
 *
 * @returns {Object}
 */
function defaultOptions() {
  return {
    appRoot              : process.cwd(),
    overlay              : mongo.DEFAULT_OVERLAY,
    secure               : false,
    host                 : null,
    port                 : null,
    database             : null,
    mongoUri             : null,
    // 'auto' adopts an inherited address and otherwise provisions one; true
    // always provisions; false never does. See resolveMongo for why the
    // default is not an unconditional true.
    provisionMongo       : PROVISION_AUTO,
    nodeFlags            : [],
    runDir               : null,
    config               : null,
    s3Seed               : null,
    httpProfile          : null,
    env                  : null,
    readyTimeoutMs       : READY_TIMEOUT_MS,
    installSignalHandlers: true,
    printConfig          : false,
    help                 : false
  };
}

/**
 * Parses the command line into the same shape `start` accepts.
 *
 * Exported so its failure modes are testable without spawning anything. Only
 * the CLI calls it; a programmatic caller passes the object directly, which is
 * why the two shapes are deliberately identical.
 *
 * `--flag value` and `--flag=value` are both accepted for every option that
 * takes one, and `--overlay` additionally accepts no value at all, meaning the
 * default overlay path - matching ./mongo's own `--overlay`, so the two tools
 * read the same way on a command line.
 *
 * @param {Array.<string>} argv Arguments after `node script`.
 * @returns {Object} Options for `start`.
 * @throws {ToolError} On an unknown flag, a missing value, or a bad number.
 */
function parseArguments(argv) {
  var options = defaultOptions();
  var args    = argv || [];
  var i       = 0;
  var token;
  var eq;
  var name;
  var inlineValue;
  var hasInline;

  // Reads the value for `name`, from `--name=value` when one was attached and
  // from the next argument otherwise. A flag whose value is missing is a usage
  // error and not an empty string: `--port --secure` must not silently bind
  // nothing.
  function value() {
    if (hasInline) {
      return inlineValue;
    }
    i++;
    if (i >= args.length) {
      throw usageError(name + ' requires a value');
    }
    return args[i];
  }

  while (i < args.length) {
    token       = args[i];
    eq          = token.indexOf('=');
    hasInline   = token.slice(0, 2) === '--' && eq > 2;
    name        = hasInline ? token.slice(0, eq) : token;
    inlineValue = hasInline ? token.slice(eq + 1) : null;

    switch (name) {
      case '-h':
      case '--help':
        options.help = true;
        break;

      case '--app':
        options.appRoot = value();
        break;

      case '--overlay':
        // The one flag with an optional value. A following token that starts
        // with '-' is the next flag, not this flag's value.
        if (hasInline) {
          options.overlay = inlineValue;
        }
        else if (i + 1 < args.length && args[i + 1].charAt(0) !== '-') {
          i++;
          options.overlay = args[i];
        }
        else {
          options.overlay = mongo.DEFAULT_OVERLAY;
        }
        break;

      case '--no-overlay':
        options.overlay = null;
        break;

      case '--secure':
        options.secure = true;
        break;

      case '--host':
        options.host = value();
        break;

      case '--port':
        options.port = parsePort(value(), '--port');
        break;

      case '--database':
        options.database = value();
        break;

      case '--mongo-uri':
        options.mongoUri = value();
        break;

      case '--no-mongo':
        options.provisionMongo = false;
        break;

      case '--provision-mongo':
        options.provisionMongo = true;
        break;

      case '--node-flags':
        options.nodeFlags = options.nodeFlags.concat(splitFlags(value()));
        break;

      case '--run-dir':
        options.runDir = value();
        break;

      case '--config':
        options.config = parseConfigArgument(value());
        break;

      case '--s3-seed':
        options.s3Seed = value();
        break;

      case '--http-profile':
        options.httpProfile = value();
        break;

      case '--ready-timeout':
        options.readyTimeoutMs = parsePositiveInteger(value(),
          '--ready-timeout');
        break;

      case '--print-config':
        options.printConfig = true;
        break;

      default:
        throw usageError('unknown option ' + token);
    }

    i++;
  }

  return options;
}

/**
 * Parses `--config` as a JSON object.
 *
 * A hard failure rather than a warning: a caller who passed a layer meant it to
 * apply, and a run that silently dropped the top layer would be a different run
 * wearing the same name.
 *
 * @param {string} raw
 * @returns {Object}
 * @throws {ToolError} If it is not JSON, or is JSON but not an object.
 */
function parseConfigArgument(raw) {
  var parsed;

  try {
    parsed = JSON.parse(raw);
  }
  catch (err) {
    throw usageError('--config is not valid JSON: ' + err.message);
  }

  if (!isPlainObject(parsed)) {
    throw usageError('--config must be a JSON object, not ' +
      (Array.isArray(parsed) ? 'an array' : typeof parsed));
  }

  return parsed;
}

/**
 * Parses a positive integer argument.
 *
 * @param {*} raw
 * @param {string} label
 * @returns {number}
 * @throws {ToolError} If it is not a positive integer.
 */
function parsePositiveInteger(raw, label) {
  var parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw usageError(label + ' must be a positive integer, not ' +
      JSON.stringify(raw));
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// The worktree under test
// ---------------------------------------------------------------------------

/**
 * Resolves and validates the worktree named by `--app`.
 *
 * Checked before anything is started, so a mistyped baseline path costs a
 * message rather than a spawned mongod and a confusing ENOENT from a child
 * that never got as far as printing anything.
 *
 * Three things are asserted, and each has produced a real, confusing failure
 * when it was absent: the directory exists; it contains app.js, so the path
 * names a worktree rather than its parent; and it contains node_modules,
 * because a tree that was never installed produces a MODULE_NOT_FOUND from
 * inside the child that reads like a code fault rather than a missing `npm ci`.
 * AAP §0.9.3 is explicit that the baseline worktree gets its OWN install from
 * the baseline lockfile, and this is where that requirement becomes checkable.
 *
 * @param {string} dir As given.
 * @returns {string} The absolute path.
 * @throws {ToolError} If it is not a usable worktree.
 */
function resolveAppRoot(dir) {
  var resolved = path.resolve(dir);
  var stats;

  try {
    stats = fs.statSync(resolved);
  }
  catch (err) {
    throw usageError('--app directory ' + resolved + ' cannot be read: ' +
      err.message);
  }

  if (!stats.isDirectory()) {
    throw usageError('--app path ' + resolved + ' is not a directory');
  }

  if (!fs.existsSync(path.join(resolved, APP_ENTRY))) {
    throw usageError('--app directory ' + resolved + ' does not contain ' +
      APP_ENTRY + ', so it is not a worktree of this application. Pass the ' +
      'repository root.');
  }

  if (!fs.existsSync(path.join(resolved, 'node_modules'))) {
    throw usageError(resolved + ' has no node_modules. Each worktree is ' +
      'installed independently from its own lockfile - the two dependency ' +
      'graphs differ and cannot be shared - so run `npm ci` there first.');
  }

  return resolved;
}

/**
 * The absolute paths of the three fixture preloads, in load order.
 *
 * Resolved against this file's directory, never against `appRoot`: the
 * fixtures belong to the TARGET worktree and the application to whichever tree
 * `--app` names, and that asymmetry is the design. A baseline run loads the
 * target's fixtures - which is correct, because each fixture resolves the
 * application module it patches through PARITY_APP_ROOT.
 *
 * @returns {Array.<string>}
 * @throws {ToolError} If any is missing.
 */
function fixturePaths() {
  var out = [];
  var i;
  var full;

  for (i = 0; i < FIXTURE_FILES.length; i++) {
    full = path.join(FIXTURE_DIR, FIXTURE_FILES[i]);

    if (!fs.existsSync(full)) {
      throw new ToolError('the parity fixture ' + full + ' is missing. All ' +
        'three of ' + FIXTURE_FILES.join(', ') + ' are required: they ' +
        'intercept S3, mail and outbound HTTP at the module boundary, and a ' +
        'run without one of them would reach a real external service or fail ' +
        'in a way that looks like an application fault.');
    }

    out.push(full);
  }

  return out;
}


// ---------------------------------------------------------------------------
// The per-run directory
// ---------------------------------------------------------------------------

/**
 * Creates the per-run directory and everything inside it.
 *
 * One directory per run, holding the PID file, the two captured logs, the
 * object store, the upload scratch space, the three fixture evidence logs and
 * the HTTP profile file. Grouping them is not tidiness: a gate script that has
 * to clean up after an abnormal exit, or a reviewer reading the evidence for a
 * failed comparison, needs one path rather than seven.
 *
 * A caller-supplied `--run-dir` is created if absent and reused if present, and
 * is never removed by this file - it is the caller's. A generated directory is
 * unique per process and per invocation, so two launchers on one host cannot
 * overwrite each other's evidence.
 *
 * @param {(string|null)} requested From `--run-dir`, or null.
 * @returns {Object} The resolved layout.
 * @throws {ToolError} If any directory cannot be created.
 */
function createRunDirectory(requested) {
  var owned = requested === null || requested === undefined;
  var base  = owned
    ? path.join(os.tmpdir(), 'parity-server-' + process.pid + '-' +
        crypto.randomBytes(4).toString('hex'))
    : path.resolve(requested);
  var layout = {
    runDir          : base,
    owned           : owned,
    pidPath         : path.join(base, 'server.pid'),
    stdoutPath      : path.join(base, 'stdout.log'),
    stderrPath      : path.join(base, 'stderr.log'),
    s3Root          : path.join(base, 's3'),
    uploadsDir      : path.join(base, 'uploads'),
    mailLogPath     : path.join(base, 'mail.log'),
    s3LogPath       : path.join(base, 's3.log'),
    httpLogPath     : path.join(base, 'http.log'),
    httpProfilePath : path.join(base, 'http-profile.json'),
    // Where the `config` package's runtime.json goes, so that it does not go
    // into the tree under test. See THE CONFIGURATION OVERLAY in the header.
    runtimeJsonPath : path.join(base, 'runtime.json')
  };

  makeDirectory(base);
  makeDirectory(layout.s3Root);
  makeDirectory(layout.uploadsDir);

  return layout;
}

/**
 * Creates one directory, parents included, tolerating an existing one.
 *
 * @param {string} dir
 * @returns {undefined}
 * @throws {ToolError} If it cannot be created.
 */
function makeDirectory(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  }
  catch (err) {
    throw new ToolError('could not create ' + dir + ': ' + err.message);
  }
}

/**
 * Writes the initial HTTP profile file.
 *
 * fixtures/http.js re-reads this file synchronously at the start of every
 * intercepted call, which is how a single capture.js run drives the successful,
 * non-2xx, malformed-body, transport-failure and missing-field OAuth cases and
 * both streaming failure modes without restarting the server. It is written
 * here, already valid, for two reasons: the fixture logs a malformed or missing
 * read rather than throwing, so an absent file would put a line in the
 * evidence for every single call; and capture.js needs a path that already
 * exists to rewrite.
 *
 * @param {string} target The profile file.
 * @param {string} profile The initial profile name.
 * @returns {undefined}
 * @throws {ToolError} If it cannot be written.
 */
function writeProfileFile(target, profile) {
  try {
    fs.writeFileSync(target, JSON.stringify({ profile: profile }) + '\n',
      'utf8');
  }
  catch (err) {
    throw new ToolError('could not write the HTTP fixture profile file ' +
      target + ': ' + err.message);
  }
}

/**
 * Writes the child's PID where a supervising script can find it.
 *
 * AAP §0.9.3 asks for the PID to be recorded, and the reason is abnormal exit:
 * if this launcher is killed outright - SIGKILL, an OOM, a CI timeout - none of
 * its handlers run, and the file is then the only remaining way to find and end
 * the child. It is removed on clean shutdown, so its presence is itself the
 * signal that something did not shut down.
 *
 * @param {string} target The PID file.
 * @param {number} pid
 * @returns {undefined}
 * @throws {ToolError} If it cannot be written.
 */
function writePidFile(target, pid) {
  try {
    fs.writeFileSync(target, String(pid) + '\n', 'utf8');
  }
  catch (err) {
    throw new ToolError('could not write the PID file ' + target + ': ' +
      err.message);
  }
}

/**
 * Removes the PID file, tolerating its absence.
 *
 * Guarded and never fatal: this runs during teardown, where the caller's real
 * result is already determined and a failure to unlink must not replace it.
 * A fault is noted and raises the launcher's own exit code through
 * `state.failed`, because a stale PID file misleads the next run.
 *
 * @param {(string|null)} target
 * @returns {undefined}
 */
function removePidFile(target) {
  if (!target) {
    return;
  }

  try {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
  catch (err) {
    state.failed = true;
    note('ERROR: could not remove the PID file ' + target + ': ' +
      err.message);
  }
}

// ---------------------------------------------------------------------------
// The database address
// ---------------------------------------------------------------------------

/**
 * Settles which MongoDB the child will use, in four mutually exclusive ways.
 *
 *   `--mongo-uri <uri>`  An address the operator already has. Parsed with
 *                        `new URL` - never `url.parse`, which emits DEP0169 -
 *                        and turned into the three values config/db.js:14-18
 *                        interpolates.
 *   `--no-mongo`         Provision nothing and adopt nothing. The inherited
 *                        NODE_CONFIG or `--config` must then carry the address.
 *   `provisionMongo:true` Always start one, even if an address was inherited.
 *   'auto' (the default) Adopt an inherited address when there is one, and
 *                        otherwise start an isolated in-memory server through
 *                        ./mongo, recording that this process owns it so `stop`
 *                        stops it.
 *
 * The 'auto' default exists because of a measured mistake. ./mongo documents
 * `node test/parity/mongo.js --overlay -- node test/parity/server.js`, and under
 * an unconditional default that command started TWO in-memory servers: the
 * wrapper's, which then went unused, and this launcher's. Both ran, both had to
 * be torn down, and the address the wrapper published - the one a sibling
 * harness in the same pipeline would seed and assert against - was silently not
 * the one the application connected to. Adopting an inherited address is
 * therefore the correct default, and it is announced so the choice is never
 * invisible.
 *
 * "Adopt an inherited address" is deliberately not "reuse whatever is listening
 * on 27017". Only an address explicitly published into this process's
 * environment is adopted; a shared host database would let two concurrent runs
 * interfere and let one run's fixtures satisfy another's assertions, and the
 * isolation AAP §0.9.2 requires is per run, not per host.
 *
 * @param {Object} options Resolved options.
 * @param {Object} inherited The parsed inherited NODE_CONFIG.
 * @returns {Promise<{layer: Object, address: (Object|null), owned: boolean}>}
 * @throws {ToolError} If a supplied URI is unusable or the server cannot start.
 */
async function resolveMongo(options, inherited) {
  var address;
  var info;

  if (options.mongoUri) {
    address = parseMongoUri(options.mongoUri, options.database);

    note('using the MongoDB at ' + address.host + ':' + address.port +
      ' (database ' + address.database + ') as given by --mongo-uri; nothing ' +
      'is provisioned and nothing is torn down.');

    return {
      layer   : mongo.buildRuntimeConfig(address),
      address : address,
      owned   : false
    };
  }

  if (options.provisionMongo === false) {
    note('--no-mongo: no database is provisioned, so the inherited ' +
      'NODE_CONFIG must already carry db.mongo.{host,port,database}.');

    return { layer: {}, address: null, owned: false };
  }

  if (options.provisionMongo !== true) {
    address = inheritedMongoAddress(inherited, options.database);

    if (address) {
      note('adopting the inherited MongoDB address ' + address.host + ':' +
        address.port + ' (database ' + address.database + '); nothing is ' +
        'provisioned here, so the wrapper that published it owns its ' +
        'lifecycle. Pass provisionMongo: true to start a second one anyway.');

      return {
        layer   : mongo.buildRuntimeConfig(address),
        address : address,
        owned   : false
      };
    }
  }

  info = options.database === null
    ? await mongo.start()
    : await mongo.start({ database: options.database });

  address = {
    host     : info.host,
    port     : info.port,
    database : info.database
  };

  return {
    layer   : mongo.buildRuntimeConfig(address),
    address : address,
    owned   : true
  };
}

/**
 * Reads a complete database address out of the inherited NODE_CONFIG.
 *
 * All three of host, port and database must be present, because config/db.js
 * interpolates all three and a partial address would produce a connection
 * string with an `undefined` in it rather than a clear failure. Anything less
 * than complete is treated as "no inherited address", which sends 'auto' down
 * the provisioning branch - the safe direction, since provisioning too much
 * wastes a mongod while adopting too little breaks every query.
 *
 * @param {Object} inherited The parsed inherited NODE_CONFIG.
 * @param {(string|null)} override A database name that wins over the inherited.
 * @returns {({host: string, port: number, database: string}|null)}
 */
function inheritedMongoAddress(inherited, override) {
  var host     = pick(inherited, ['db', 'mongo', 'host']);
  var port     = pick(inherited, ['db', 'mongo', 'port']);
  var database = override === null || override === undefined
    ? pick(inherited, ['db', 'mongo', 'database'])
    : override;

  if (!host || !port || !database) {
    return null;
  }

  return {
    host     : String(host),
    port     : parsePort(port, 'the inherited db.mongo.port'),
    database : String(database)
  };
}

/**
 * Turns a MongoDB connection string into the three values config/db.js reads.
 *
 * `new URL` handles `mongodb://` because the scheme is not special-cased - the
 * host and port land on `hostname` and `port` exactly as they would for http.
 * Measured on Node 22: `new URL('mongodb://[::1]:27017/parity').hostname` is
 * '[::1]', brackets INCLUDED, which is already the form a connection string
 * needs, so nothing is added or stripped here. ./mongo's own address publisher
 * reads the same property for the same reason, and the two agree by
 * construction rather than by coincidence.
 *
 * An absent port defaults to 27017, mongod's own default, rather than being
 * left empty for config/db.js to interpolate as `host:undefined`.
 *
 * @param {string} raw The URI.
 * @param {(string|null)} override A database name that wins over the path.
 * @returns {{host: string, port: number, database: string}}
 * @throws {ToolError} If the URI is unusable or names no database.
 */
function parseMongoUri(raw, override) {
  var parsed;
  var database;

  try {
    parsed = new URL(raw);
  }
  catch (err) {
    throw usageError('--mongo-uri ' + JSON.stringify(raw) +
      ' is not a URL: ' + err.message);
  }

  if (!parsed.hostname) {
    throw usageError('--mongo-uri ' + JSON.stringify(raw) + ' has no host');
  }

  database = override === null || override === undefined
    ? decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    : override;

  if (!database) {
    throw usageError('--mongo-uri ' + JSON.stringify(raw) + ' names no ' +
      'database and --database was not given. config/db.js interpolates the ' +
      'name into the connection string, so it cannot be left to a default.');
  }

  return {
    host     : parsed.hostname,
    port     : parsed.port === ''
      ? 27017
      : parsePort(parsed.port, 'the port in --mongo-uri'),
    database : database
  };
}


// ---------------------------------------------------------------------------
// The composed configuration
// ---------------------------------------------------------------------------

/**
 * Composes the NODE_CONFIG the child receives, in five layers.
 *
 * The layer order and the reason for each is in THE CONFIGURATION OVERLAY in
 * the header. It is repeated here only as the code that implements it:
 *
 *   1. the inherited NODE_CONFIG - honoured, not discarded
 *   2. the overlay file
 *   3. the database address
 *   4. this launcher's host/port/url layer
 *   5. the caller's `--config`
 *
 * Then, if `--secure` was given, the session `isSecure` layer, which is applied
 * above `--config` for one reason: `--secure` names a whole cookie pass rather
 * than a value, and a caller who asked for the secure pass must get it even if
 * their own layer happens to mention the session block.
 *
 * @param {Object} options Resolved options.
 * @param {Object} mongoLayer From resolveMongo.
 * @param {Object} [inherited] The already-parsed inherited NODE_CONFIG. Passed
 *   in by `buildContext` so the environment is parsed - and its one diagnostic
 *   line emitted - exactly once per run rather than once per consumer.
 * @returns {Object} The composed configuration, as an object.
 * @throws {ToolError} If the inherited NODE_CONFIG or the overlay is unusable.
 */
function composeConfiguration(options, mongoLayer, inherited) {
  var merged = inherited === undefined
    ? mongo.parseInheritedNodeConfig(process.env.NODE_CONFIG)
    : inherited;
  var overlay;

  if (options.overlay) {
    overlay = mongo.readOverlay(options.overlay);
    merged  = deepMerge(merged, overlay);
  }
  else {
    note('WARNING: no overlay. config/test.yaml sets app.start: false, so ' +
      'unless the inherited NODE_CONFIG or --config supplies app.start: true ' +
      'the application will initialise and never listen.');
  }

  merged = deepMerge(merged, mongoLayer);
  merged = deepMerge(merged, addressLayer(options));

  if (options.config) {
    merged = deepMerge(merged, options.config);
  }

  if (options.secure) {
    merged = deepMerge(merged, nest(
      ['app', 'plugins', 'session', 'cookieOptions', 'isSecure'], true));
  }

  return merged;
}

/**
 * Builds layer 4 - the bind address and the client-facing URL, together.
 *
 * `app.hostname` and `app.port` are what app.js:94-95 hands `Hapi.server`.
 * `app.url.{protocol,hostname,port}` are what config/app.config.js:16-17
 * composes `config.url` from, and `config.url` is what
 * lib/util/routeParser.js's `redirect()` prefixes onto every relative target.
 *
 * They are set as one layer, never separately, and that is the whole point of
 * the function existing: a run that moved the bound port without moving
 * `app.url.port` would serve on one port and redirect to another, and since the
 * corpus compares `Location` exactly, every redirect case would diff. The
 * protocol is left to the overlay unless the caller states one - `--secure`
 * concerns the cookie attribute, not the scheme, and this launcher terminates
 * plain HTTP either way.
 *
 * When neither `--host` nor `--port` is given this returns an empty layer, so
 * the overlay's own coherent pair stands untouched.
 *
 * @param {Object} options Resolved options.
 * @returns {Object} A configuration layer, possibly empty.
 */
function addressLayer(options) {
  var layer = {};

  if (options.host !== null) {
    layer = deepMerge(layer, nest(['app', 'hostname'], options.host));
    layer = deepMerge(layer, nest(['app', 'url', 'hostname'], options.host));
  }

  if (options.port !== null) {
    layer = deepMerge(layer, nest(['app', 'port'], options.port));
    layer = deepMerge(layer, nest(['app', 'url', 'port'], options.port));
  }

  return layer;
}

/**
 * Reads the effective address back out of the composed configuration.
 *
 * Read back rather than tracked forward, because the value that matters is
 * whatever won across five layers - the overlay's port when no `--port` was
 * given, the caller's when `--config` set one. Anything else would be this
 * file's opinion of the address rather than the address the child will use.
 *
 * `bindHost` is what the child binds; `probeHost` is what the readiness probe
 * connects to, which differs for a wildcard bind - 0.0.0.0 and :: are not
 * connectable addresses, and dialling them is a portability trap rather than a
 * shortcut. `baseUrl` reproduces config/app.config.js:16-17 exactly, including
 * its rule that the port is appended only when truthy, so a caller comparing a
 * `Location` header against `baseUrl` is comparing against the same string the
 * application built.
 *
 * @param {Object} composed The composed configuration.
 * @returns {{bindHost: string, probeHost: string, port: number,
 *   baseUrl: string, urlPort: *}}
 * @throws {ToolError} If the composed port is not a usable port.
 */
function describeEffectiveAddress(composed) {
  var bindHost = pick(composed, ['app', 'hostname']);
  var port     = pick(composed, ['app', 'port']);
  var protocol = pick(composed, ['app', 'url', 'protocol']);
  var urlHost  = pick(composed, ['app', 'url', 'hostname']);
  var urlPort  = pick(composed, ['app', 'url', 'port']);
  var baseUrl;

  // The same fallbacks app.js:94-95 applies, so what is reported is what the
  // child will actually do rather than what the configuration happened to say.
  bindHost = bindHost === undefined || bindHost === null || bindHost === ''
    ? 'localhost'
    : String(bindHost);
  port = port === undefined || port === null || port === ''
    ? 3000
    : parsePort(port, 'the composed app.port');

  protocol = protocol ? String(protocol) : 'http';
  urlHost  = urlHost ? String(urlHost) : bindHost;

  baseUrl = protocol + '://' + urlHost;
  if (urlPort) {
    baseUrl += ':' + urlPort;
  }

  return {
    bindHost  : bindHost,
    probeHost : connectableHost(bindHost),
    port      : port,
    urlPort   : urlPort,
    baseUrl   : baseUrl
  };
}

/**
 * Maps a wildcard bind address to the loopback address that reaches it.
 *
 * A server bound to 0.0.0.0 is reachable at 127.0.0.1 and a server bound to ::
 * at ::1, but neither wildcard is itself a valid destination on every platform.
 * Anything else is returned unchanged, including a hostname, which is resolved
 * by the HTTP client as usual.
 *
 * @param {string} host
 * @returns {string}
 */
function connectableHost(host) {
  if (host === '0.0.0.0') {
    return '127.0.0.1';
  }
  if (host === '::' || host === '[::]') {
    return '::1';
  }

  return host;
}

/**
 * Warns once when the bound port and the advertised port disagree.
 *
 * A legitimate configuration behind a proxy, and a mistake in a parity run:
 * every absolute `Location` would name the advertised port while the harness
 * drove the bound one, and every redirect case in the corpus would diff for a
 * reason that has nothing to do with the migration. Noted rather than rejected,
 * because it IS legitimate and the launcher does not get to overrule the
 * operator - but noted loudly, because the resulting diff is baffling without
 * this line.
 *
 * @param {Object} address From describeEffectiveAddress.
 * @returns {undefined}
 */
function warnOnPortMismatch(address) {
  if (address.urlPort && Number(address.urlPort) !== address.port) {
    note('WARNING: app.port is ' + address.port + ' but app.url.port is ' +
      address.urlPort + ', so absolute Location headers will name ' +
      address.urlPort + ' while this launcher drives ' + address.port +
      '. Pass --port to move both together.');
  }
}

// ---------------------------------------------------------------------------
// The port
// ---------------------------------------------------------------------------

/**
 * Refuses to start when something is already listening on the bind address.
 *
 * The single most important guard in this file, and the reason is a failure
 * that is silent rather than loud. A server left behind by an earlier run -
 * a launcher killed with SIGKILL, a CI job cancelled mid-gate - would answer
 * the readiness probe, serve every request in the corpus, and produce a clean
 * comparison for a build that was never exercised. There is no assertion
 * anywhere above this file that would catch it, so it is caught here.
 *
 * The check is a real bind, not a connect: a connect probe cannot distinguish
 * "nothing there" from "something there that is not answering yet", while a
 * bind that succeeds proves the port is free at that instant. The listener is
 * closed immediately, which leaves the usual small race between the check and
 * the child's own bind - unavoidable without handing the child a socket, and
 * harmless, because the child would then fail to bind and exit, which the
 * readiness poller reports as the boot failure it is.
 *
 * @param {string} host The bind host, as configured.
 * @param {number} port
 * @returns {Promise<undefined>}
 * @throws {ToolError} If the port is in use or cannot be bound.
 */
function assertPortFree(host, port) {
  return new Promise(function (resolve, reject) {
    var probe = net.createServer();
    var settled = false;

    function finish(err) {
      if (settled) {
        return;
      }
      settled = true;

      if (err) {
        reject(err);
      }
      else {
        resolve();
      }
    }

    probe.once('error', function (err) {
      if (err && err.code === 'EADDRINUSE') {
        finish(new ToolError('something is already listening on ' + host +
          ':' + port + '. Refusing to start: it would answer the readiness ' +
          'probe and serve the whole corpus, and the run would report a pass ' +
          'for a build it never exercised. If an earlier launcher was killed, ' +
          'its PID file is under its run directory; otherwise choose another ' +
          'port with --port.'));
        return;
      }

      finish(new ToolError('could not test whether ' + host + ':' + port +
        ' is free: ' + ((err && err.message) || err)));
    });

    probe.once('listening', function () {
      probe.close(function () {
        finish(null);
      });
    });

    try {
      probe.listen({ host: host, port: port, exclusive: true });
    }
    catch (err) {
      finish(new ToolError('could not test whether ' + host + ':' + port +
        ' is free: ' + err.message));
    }
  });
}


// ---------------------------------------------------------------------------
// The child's environment
// ---------------------------------------------------------------------------

/**
 * Builds the environment the application child receives.
 *
 * An inherited copy plus four groups, and nothing else. Every variable is
 * listed in the FIXTURE INJECTION section of the header, which is the
 * authoritative contract; this function is its implementation.
 *
 *   The configuration    NODE_ENV, NODE_CONFIG, NODE_CONFIG_PERSIST_ON_CHANGE.
 *   The fixture contract The eight PARITY_* variables the three preloads read.
 *   The scratch space    TMPDIR, TMP and TEMP, at the per-run uploads
 *                        directory, because hapi's payload `uploads` default is
 *                        `os.tmpdir()` and app.js hard-codes its `routes`
 *                        options, so there is no configuration key to set.
 *   The caller's own     `options.env`, applied last, so a caller can override
 *                        or clear anything above - a null value deletes.
 *
 * NODE_CONFIG_DIR is not set, deliberately: the child's working directory IS
 * `appRoot`, so the `config` package resolves that tree's own config/ directory
 * without being told, which is the point of selecting a tree by path. An
 * INHERITED value is a different matter and is removed when it points somewhere
 * else - ./mongo sets it when it spawns a command into another tree, so a
 * nested invocation can arrive here pointing at the baseline's config/ while
 * `--app` names the target's. Honouring it would load one tree's YAML into the
 * other tree's code and compare two trees while configured as one. Removing a
 * contaminant is not the same as setting a value, and the removal is announced.
 *
 * @param {Object} context The assembled run context.
 * @returns {Object} A complete environment for spawn.
 */
function buildChildEnv(context) {
  var env  = {};
  var keys = Object.keys(process.env);
  var i;
  var extra;
  var key;
  var expected;
  var inherited;

  for (i = 0; i < keys.length; i++) {
    env[keys[i]] = process.env[keys[i]];
  }

  env.NODE_ENV                      = NODE_ENV_VALUE;
  env.NODE_CONFIG                   = context.nodeConfig;
  env.NODE_CONFIG_PERSIST_ON_CHANGE = PERSIST_ON_CHANGE;
  // The one variable here that exists purely to protect the tree under test.
  // Measured: PERSIST_ON_CHANGE=N alone does NOT stop config 0.4.37 creating
  // runtime.json, and a first baseline run created the file inside a clean
  // worktree. The header carries the mechanism and why it matters.
  env.NODE_CONFIG_RUNTIME_JSON      = context.layout.runtimeJsonPath;

  inherited = env.NODE_CONFIG_DIR;
  if (inherited) {
    expected = path.join(context.appRoot, 'config');
    if (path.resolve(inherited) !== expected) {
      delete env.NODE_CONFIG_DIR;
      note('removed an inherited NODE_CONFIG_DIR of ' + inherited +
        ', which does not belong to ' + context.appRoot + '. The child runs ' +
        'in that tree, so `config` must read ' + expected + '.');
    }
  }

  env.PARITY_APP_ROOT          = context.appRoot;
  env.PARITY_S3_ROOT           = context.layout.s3Root;
  env.PARITY_S3_LOG            = context.layout.s3LogPath;
  env.PARITY_MAIL_LOG          = context.layout.mailLogPath;
  env.PARITY_HTTP_LOG          = context.layout.httpLogPath;
  env.PARITY_HTTP_PROFILE      = context.httpProfile;
  env.PARITY_HTTP_PROFILE_FILE = context.layout.httpProfilePath;

  if (context.s3Seed) {
    env.PARITY_S3_SEED = context.s3Seed;
  }
  else {
    // An inherited seed manifest from an unrelated run would be read ONCE at
    // fixture load and would silently place objects this run never asked for.
    delete env.PARITY_S3_SEED;
  }

  env.TMPDIR = context.layout.uploadsDir;
  env.TMP    = context.layout.uploadsDir;
  env.TEMP   = context.layout.uploadsDir;

  extra = context.env;
  if (isPlainObject(extra)) {
    keys = Object.keys(extra);
    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      if (extra[key] === null || extra[key] === undefined) {
        delete env[key];
      }
      else {
        env[key] = String(extra[key]);
      }
    }
  }

  return env;
}

/**
 * Builds the child's argument vector.
 *
 * `[...callerFlags, --require aws, --require mail, --require http, app.js]`.
 * All three preloads precede the entry point, which is what guarantees the
 * fixtures are installed before the application loads - `--require` modules run
 * before the main module, so this is an ordering property of node itself rather
 * than something the fixtures have to arrange between themselves.
 *
 * The paths are absolute and come from the target worktree; the entry point is
 * absolute and comes from `appRoot`. Passed as an argv ARRAY, so there is no
 * shell and no quoting layer: a run directory containing a space is simply
 * another string, where an NODE_OPTIONS approach would split it into two
 * broken flags.
 *
 * @param {Object} context The assembled run context.
 * @returns {Array.<string>}
 */
function buildChildArgs(context) {
  var args = context.nodeFlags.slice();
  var i;

  for (i = 0; i < context.fixtures.length; i++) {
    args.push('--require', context.fixtures[i]);
  }

  args.push(path.join(context.appRoot, APP_ENTRY));

  return args;
}

// ---------------------------------------------------------------------------
// The child process
// ---------------------------------------------------------------------------

/**
 * Spawns the application and records it on `state`.
 *
 * Two descriptors are opened and handed to the child directly rather than
 * piped through this process. That is what makes the captured logs trustworthy:
 * the child writes to the files itself, so nothing here can reorder, truncate
 * or lose a line, and there is no pipe to apply backpressure if the launcher is
 * busy polling. Stdin is `ignore` - the application never reads it, and an open
 * pipe would be one more handle to close.
 *
 * `process.execPath` is used rather than a bare `node`, so the child runs on
 * the same interpreter as the launcher whatever the PATH says. On a two-tree
 * comparison that is a requirement, not a convenience: the runtime must be the
 * constant while the tree is the variable.
 *
 * The files are opened with 'w', so a reused `--run-dir` starts from empty
 * evidence rather than appending this run's output to the last one's.
 *
 * @param {Object} context The assembled run context.
 * @returns {Object} The spawned child.
 * @throws {ToolError} If the logs cannot be opened or the child cannot start.
 */
function spawnApplication(context) {
  var args = buildChildArgs(context);
  var child;

  state.stdoutPath = context.layout.stdoutPath;
  state.stderrPath = context.layout.stderrPath;

  try {
    state.stdoutFd = fs.openSync(context.layout.stdoutPath, 'w');
    state.stderrFd = fs.openSync(context.layout.stderrPath, 'w');
  }
  catch (err) {
    closeLogDescriptors();
    throw new ToolError('could not open the capture logs in ' +
      context.layout.runDir + ': ' + err.message);
  }

  try {
    child = childProcess.spawn(process.execPath, args, {
      cwd      : context.appRoot,
      env      : context.childEnv,
      stdio    : ['ignore', state.stdoutFd, state.stderrFd],
      detached : false
    });
  }
  catch (err) {
    closeLogDescriptors();
    throw new ToolError('could not spawn the application in ' +
      context.appRoot + ': ' + err.message);
  }

  state.child = child;
  state.exit  = null;

  child.once('error', function (err) {
    // A spawn that fails asynchronously. Recorded as an exit so the readiness
    // poller stops immediately rather than waiting out its whole budget for a
    // process that was never running.
    state.exit = { code: null, signal: null, error: err };
    note('ERROR: the application process reported ' +
      ((err && err.message) || err));
  });

  child.once('exit', function (code, signal) {
    state.exit = { code: code, signal: signal, error: null };
    closeLogDescriptors();
  });

  return child;
}

/**
 * Closes the two capture descriptors, tolerating a double close.
 *
 * Called from the child's `exit` listener and from every failure path. Leaking
 * a descriptor per run would eventually exhaust the process's limit in a gate
 * that starts the server once per scenario.
 *
 * @returns {undefined}
 */
function closeLogDescriptors() {
  var fds = [state.stdoutFd, state.stderrFd];
  var i;

  state.stdoutFd = null;
  state.stderrFd = null;

  for (i = 0; i < fds.length; i++) {
    if (fds[i] === null || fds[i] === undefined) {
      continue;
    }
    try {
      fs.closeSync(fds[i]);
    }
    catch (err) {
      // A descriptor that is already closed is the normal case on the second
      // call. Nothing here can act on the failure and reporting it would put
      // noise in the stream the zero-warning gate reads.
    }
  }
}

/**
 * Describes how the child ended, for a message.
 *
 * @param {(Object|null)} exit From `state.exit`.
 * @returns {string}
 */
function describeExit(exit) {
  if (!exit) {
    return 'still running';
  }
  if (exit.error) {
    return 'failed to start: ' + ((exit.error && exit.error.message) ||
      exit.error);
  }
  if (exit.signal) {
    return 'was killed by ' + exit.signal;
  }

  return 'exited with code ' + exit.code;
}


// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

/**
 * Builds the origin to dial, bracketing an IPv6 literal.
 *
 * `new URL` needs `http://[::1]:3010`, not `http://::1:3010`, and a host that
 * already arrived bracketed - which is how both `new URL().hostname` and
 * ./mongo's published address report one - must not be bracketed twice.
 *
 * @param {string} host A connectable host.
 * @param {number} port
 * @returns {string} An origin, with no trailing slash.
 */
function originFor(host, port) {
  var bracketed = host.indexOf(':') >= 0 && host.charAt(0) !== '['
    ? '[' + host + ']'
    : host;

  return 'http://' + bracketed + ':' + port;
}

/**
 * The readiness URL, with a fresh random token.
 *
 * The token is randomised per run so that a cached, proxied or otherwise stale
 * answer cannot be mistaken for this server's. It is also why the path is safe
 * to hit repeatedly: lib/util/routeParser.js:563-569 answers anything under
 * /.well-known/ with a function handler and a bare 404, so the probe touches
 * no database, no session and no template.
 *
 * @param {string} origin From originFor.
 * @returns {URL}
 */
function readyUrl(origin) {
  return new URL(READY_PATH_PREFIX + crypto.randomBytes(6).toString('hex'),
    origin);
}

/**
 * Sends one readiness probe.
 *
 * Resolves with the HTTP status on ANY response - a 404 is the expected one and
 * is success, because it proves the route table is registered rather than
 * merely that a socket accepted a connection. Resolves with null for the
 * connection-level conditions that mean "not listening yet", which is the
 * distinction the whole poller rests on: treating ECONNREFUSED as a failure
 * would abort during the two or three seconds the application spends
 * connecting to MongoDB and registering 233 routes.
 *
 * Rejects only for a condition retrying cannot fix, so a genuinely wrong
 * address fails fast with its own reason instead of consuming the budget.
 *
 * The body is drained with `resume()`. Without it the socket would stay open
 * until the agent timed it out, and a run that probed thirty times would hold
 * thirty sockets against a server it is about to measure.
 *
 * @param {URL} url The probe target.
 * @returns {Promise<(number|null)>} The status, or null for "not yet".
 */
function probeOnce(url) {
  return new Promise(function (resolve, reject) {
    var settled = false;
    var request;

    function finish(err, status) {
      if (settled) {
        return;
      }
      settled = true;

      if (err) {
        reject(err);
      }
      else {
        resolve(status);
      }
    }

    try {
      request = http.request(url, {
        method  : 'GET',
        headers : {
          // Closed per probe rather than kept alive: a pooled connection would
          // outlive the probe and be one more handle holding the launcher's
          // event loop open at shutdown.
          Connection : 'close',
          Accept     : '*/*'
        }
      }, function (response) {
        response.resume();
        response.once('end', function () {
          finish(null, response.statusCode);
        });
        // A truncated response still proves the server answered, which is all
        // this probe asks.
        response.once('error', function () {
          finish(null, response.statusCode);
        });
      });
    }
    catch (err) {
      finish(err, null);
      return;
    }

    request.setTimeout(PROBE_TIMEOUT_MS, function () {
      // Connected and then silent. Destroying produces an 'error' below, which
      // the classifier treats as retryable - the server may simply not have
      // finished registering its routes.
      request.destroy();
    });

    request.once('error', function (err) {
      if (isRetryableProbeError(err)) {
        finish(null, null);
        return;
      }

      finish(new ToolError('the readiness probe to ' + url.href +
        ' failed for a reason retrying cannot fix: ' +
        ((err && err.message) || err)), null);
    });

    request.end();
  });
}

/**
 * True for a probe error that only means "not listening yet".
 *
 * Enumerated rather than blanket-retried, so a real misconfiguration - an
 * unresolvable host, an address the machine does not own - is reported at once
 * instead of after the full readiness budget. ECONNRESET and EPIPE are in the
 * list because a server whose listener has been created but whose accept loop
 * is not yet running can accept and immediately drop a connection.
 *
 * @param {*} err
 * @returns {boolean}
 */
function isRetryableProbeError(err) {
  var code = err && err.code;

  return code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ECONNABORTED' ||
    code === 'ERR_SOCKET_CONNECTION_TIMEOUT' ||
    // What request.destroy() produces from the setTimeout above.
    code === 'ECANCELED' ||
    (err && err.name === 'AbortError');
}

/**
 * Sleeps, without holding the event loop open longer than the sleep.
 *
 * @param {number} ms
 * @returns {Promise<undefined>}
 */
function delay(ms) {
  return new Promise(function (resolve) {
    var timer = setTimeout(resolve, ms);

    // A pending sleep must never be the reason the launcher outlives its work.
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  });
}

/**
 * Polls until the route table answers, the child exits, or the budget runs out.
 *
 * Three exits, and each is reported as itself:
 *
 *   ready    Any HTTP status came back. Returned to the caller.
 *   exited   The child is gone. Reported immediately with how it ended and the
 *            tail of its captured stderr, because that is where the two common
 *            boot failures are legible - a MongooseServerSelectionError from
 *            config/db.js when the database is unreachable, and the banner
 *            app.js:55-67 prints when a production process has no session
 *            password. Waiting out the budget for a process that has already
 *            exited would turn a specific failure into a vague one.
 *   timeout   The budget expired while the child was still running, which means
 *            it is wedged rather than broken. Also reported with the tail.
 *
 * @param {URL} url The probe target.
 * @param {number} timeoutMs The overall budget.
 * @returns {Promise<number>} The status the server answered with.
 * @throws {ToolError} On either failing exit.
 */
async function waitForReady(url, timeoutMs) {
  var deadline = Date.now() + timeoutMs;
  var attempts = 0;
  var status;

  for (;;) {
    if (state.exit) {
      throw launchError('the application ' + describeExit(state.exit) +
        ' before it became ready.');
    }

    attempts++;
    status = await probeOnce(url);

    if (status !== null) {
      note('ready after ' + attempts + ' probe(s): ' + url.pathname +
        ' answered ' + status + '.');
      return status;
    }

    if (Date.now() >= deadline) {
      throw launchError('the application did not answer ' + url.href +
        ' within ' + timeoutMs + 'ms (' + attempts + ' probes). It is still ' +
        'running, so it is wedged rather than crashed.');
    }

    await delay(READY_INTERVAL_MS);
  }
}


// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

/**
 * Brings the application down and releases everything this run created.
 *
 * Idempotent by construction: an in-flight stop is shared, and a stop with
 * nothing left to do walks the same path and finds each step already done.
 * Calling it twice, or calling it before `start`, is not an error.
 *
 * SIGTERM first, then SIGKILL after a bounded wait. Both are needed.
 * app.js installs no signal handler, so SIGTERM's default disposition ends the
 * process promptly - but app.js:371's `setInterval(detectLeaks, 60*1000)` keeps
 * the event loop alive indefinitely, so a child that has somehow trapped or
 * deferred the signal would never exit on its own and a polite wait alone would
 * hang the gate that is waiting on this promise.
 *
 * The captured logs are deliberately NOT removed. They are the evidence AAP
 * §0.9.3 asserts against, and a teardown that deleted them would leave a failed
 * comparison with nothing to explain it. The PID file IS removed, so that a
 * PID file which still exists is by itself the signal that something did not
 * shut down.
 *
 * A teardown fault is reported and recorded on `state.failed`, which raises the
 * CLI's exit code, because a leaked application server holding a port is a real
 * failure even when the work it was started for succeeded.
 *
 * @returns {Promise<boolean>} True when everything came down cleanly.
 */
function stop() {
  if (state.stopPromise) {
    return state.stopPromise;
  }

  // Raised before the teardown begins, so anything watching the child - the
  // CLI's `runUntilSignalled`, for one - can tell an exit we caused from an
  // exit that means the application died on its own. Without the distinction a
  // clean Ctrl-C reports the shutdown it just performed as a crash.
  state.stopping    = true;
  state.stopPromise = stopInternal();

  return state.stopPromise;
}

/**
 * The body of `stop`, separated so `stop` stays a guard.
 *
 * The order is not interchangeable. The child goes first, because the run
 * directory it is writing into and the database it is connected to must outlive
 * it - stopping MongoDB from under a live application would produce a burst of
 * connection errors in the captured stderr that a reader would then have to
 * recognise as the harness's own doing.
 *
 * @returns {Promise<boolean>}
 */
async function stopInternal() {
  var child = state.child;
  var ok    = true;
  var exited;

  if (child && !state.exit) {
    note('stopping the application (pid ' + child.pid + ').');

    killChild('SIGTERM');
    exited = await waitForChildExit(STOP_GRACE_MS);

    if (!exited) {
      note('WARNING: the application did not exit within ' + STOP_GRACE_MS +
        'ms of SIGTERM; sending SIGKILL. Its event loop is held open by ' +
        'app.js:371, so a longer wait would not have helped.');
      killChild('SIGKILL');
      exited = await waitForChildExit(STOP_GRACE_MS);

      if (!exited) {
        ok           = false;
        state.failed = true;
        note('ERROR: the application process ' + child.pid + ' survived ' +
          'SIGKILL. It is still holding its port; end it by hand before the ' +
          'next run, which will otherwise refuse to start.');
      }
    }
  }

  closeLogDescriptors();
  removePidFile(state.pidPath);

  if (state.ownsMongo) {
    state.ownsMongo = false;
    try {
      if (!(await mongo.stop())) {
        ok           = false;
        state.failed = true;
      }
    }
    catch (err) {
      ok           = false;
      state.failed = true;
      note('ERROR: stopping the provisioned MongoDB failed: ' +
        ((err && err.message) || err));
    }
  }

  removeProcessListeners();

  state.child        = null;
  state.info         = null;
  state.pidPath      = null;
  state.startPromise = null;
  state.stopPromise  = null;
  state.stopping     = false;

  return ok;
}

/**
 * Signals the child, tolerating a process that has already gone.
 *
 * ESRCH means it exited between the check and the signal, which is a race this
 * function exists to absorb rather than a failure. EPERM would mean the child
 * is not ours to signal, which is worth reporting because it can only happen if
 * the recorded PID has been reused.
 *
 * @param {string} signal
 * @returns {undefined}
 */
function killChild(signal) {
  var child = state.child;

  if (!child || state.exit) {
    return;
  }

  try {
    child.kill(signal);
  }
  catch (err) {
    if (err && err.code === 'ESRCH') {
      return;
    }
    note('WARNING: could not send ' + signal + ' to pid ' + child.pid + ': ' +
      ((err && err.message) || err));
  }
}

/**
 * Waits for the child to exit, up to `ms`.
 *
 * Resolves rather than rejecting on the timeout: the caller's next move is to
 * escalate to SIGKILL, and an exception would make that read as an error path
 * when it is the documented one.
 *
 * @param {number} ms
 * @returns {Promise<boolean>} True if it exited within the budget.
 */
function waitForChildExit(ms) {
  var child = state.child;

  if (!child || state.exit) {
    return Promise.resolve(true);
  }

  return new Promise(function (resolve) {
    var timer = setTimeout(function () {
      child.removeListener('exit', onExit);
      resolve(Boolean(state.exit));
    }, ms);

    function onExit() {
      clearTimeout(timer);
      resolve(true);
    }

    if (typeof timer.unref === 'function') {
      timer.unref();
    }

    child.once('exit', onExit);
  });
}

/**
 * Kills the child synchronously, from `process.on('exit')`.
 *
 * The last line of defence, and it is reached only when an asynchronous
 * teardown did not run: a `process.exit()` in a caller, a fatal error inside
 * the teardown itself. An `exit` listener cannot await, so this is SIGKILL and
 * nothing else - there is no opportunity to wait for a graceful stop, and the
 * alternative is an orphaned server holding a port, which is the failure the
 * whole free-port assertion exists to make loud.
 *
 * It is loud on purpose. A sweep means an exit path was missed, which is worth
 * knowing even though the sweep repaired it.
 *
 * @returns {undefined}
 */
function sweepSynchronously() {
  var child = state.child;

  if (!child || state.exit) {
    return;
  }

  note('WARNING: the asynchronous teardown did not run; killing the ' +
    'application (pid ' + child.pid + ') synchronously. The PID file and the ' +
    'captured logs are left in ' + state.runDir + '.');

  try {
    child.kill('SIGKILL');
  }
  catch (err) {
    note('ERROR: the synchronous sweep could not kill pid ' + child.pid +
      ': ' + ((err && err.message) || err));
  }
}

/**
 * Installs the synchronous sweep exactly once.
 *
 * An `exit` listener does not hold the event loop open, so this is safe even in
 * library mode - unlike the signal listeners, which a caller can decline.
 *
 * @returns {undefined}
 */
function installSweep() {
  if (state.sweepInstalled) {
    return;
  }
  state.sweepInstalled = true;
  process.on('exit', sweepSynchronously);
}

/**
 * The exit code a shell expects for a signalled process.
 *
 * 130 for SIGINT and 143 for SIGTERM, by the usual 128+n convention, so a
 * gate script's `if !` reads the interruption correctly.
 *
 * @param {string} signal
 * @returns {number}
 */
function signalExitCode(signal) {
  if (signal === 'SIGINT') {
    return 130;
  }
  if (signal === 'SIGTERM') {
    return 143;
  }

  return EXIT_ERROR;
}

/**
 * Handles SIGINT and SIGTERM delivered to the launcher.
 *
 * @param {string} signal
 * @returns {Promise<undefined>}
 */
async function onSignal(signal) {
  note('received ' + signal + '; bringing the application down.');

  await stop();

  process.exitCode = signalExitCode(signal);
}

/**
 * Handles an uncaught exception or an unhandled rejection in THIS process.
 *
 * Both are defects in the launcher, so both are reported with their stack and
 * both bring the child down. Node would otherwise terminate on an uncaught
 * exception and leave the server running, which is precisely the orphan case.
 *
 * @param {string} label What happened, for the message.
 * @param {*} err
 * @returns {Promise<undefined>}
 */
async function onFatal(label, err) {
  state.failed = true;

  note('ERROR: ' + label + ': ' + ((err && err.stack) || String(err)));

  await stop();

  process.exitCode = EXIT_ERROR;
}

/**
 * Installs the four process listeners, once.
 *
 * ./mongo deliberately declines to do this in library mode, on the sound
 * principle that hijacking a host process's SIGINT is not a required module's
 * business. This file installs them by default anyway, and the difference is
 * what leaks: a missed mongod teardown leaves a temporary directory, while a
 * missed teardown here leaves an APPLICATION SERVER HOLDING A PORT, which
 * silently corrupts the next run rather than merely wasting disk. The listeners
 * are removed again by `stop()`, so a host regains its own signal disposition
 * as soon as the server is down, and `installSignalHandlers: false` declines
 * them outright for a caller that manages its own.
 *
 * @param {boolean} wanted Whether the caller wants them.
 * @returns {undefined}
 */
function installProcessListeners(wanted) {
  if (!wanted || state.handlersInstalled) {
    return;
  }

  state.handlersInstalled = true;

  addListener('SIGINT', function () {
    onSignal('SIGINT');
  });
  addListener('SIGTERM', function () {
    onSignal('SIGTERM');
  });
  addListener('uncaughtException', function (err) {
    onFatal('uncaught exception in the launcher', err);
  });
  addListener('unhandledRejection', function (reason) {
    onFatal('unhandled rejection in the launcher', reason);
  });
}

/**
 * Registers one listener and records it for removal.
 *
 * @param {string} event
 * @param {Function} handler
 * @returns {undefined}
 */
function addListener(event, handler) {
  state.listeners.push([event, handler]);
  process.on(event, handler);
}

/**
 * Removes the listeners installed above.
 *
 * This is not tidiness - it is how the launcher exits. A registered signal
 * listener holds a libuv handle that keeps the event loop alive, so a run that
 * left its SIGINT listener in place would finish its work and then hang. The
 * `exit` sweep is left installed, because it holds nothing open.
 *
 * @returns {undefined}
 */
function removeProcessListeners() {
  var i;

  for (i = 0; i < state.listeners.length; i++) {
    process.removeListener(state.listeners[i][0], state.listeners[i][1]);
  }

  state.listeners         = [];
  state.handlersInstalled = false;
}


// ---------------------------------------------------------------------------
// The lifecycle - the programmatic API
// ---------------------------------------------------------------------------

/**
 * Merges a caller's options over the defaults, key by key.
 *
 * A shallow, whitelisted merge on purpose. `nodeFlags` is an array and `config`
 * is an arbitrary configuration layer, and a deep merge would splice a caller's
 * flags into the defaults' and merge a caller's configuration into a previous
 * caller's - both wrong. An unknown key is a hard error rather than being
 * ignored, because a misspelled option that silently does nothing is the worst
 * possible outcome for a harness: the run appears to honour it.
 *
 * @param {(Object|undefined)} supplied
 * @returns {Object} A complete, validated option set.
 * @throws {ToolError} On an unknown key or an unusable value.
 */
function resolveOptions(supplied) {
  var options = defaultOptions();
  var given   = supplied === undefined || supplied === null ? {} : supplied;
  var keys    = Object.keys(given);
  var i;
  var key;

  if (!isPlainObject(given)) {
    throw usageError('start() takes an options object, not ' + typeof given);
  }

  for (i = 0; i < keys.length; i++) {
    key = keys[i];

    if (!Object.prototype.hasOwnProperty.call(options, key)) {
      throw usageError('unknown start() option ' + JSON.stringify(key) +
        '. Known options: ' + Object.keys(options).sort().join(', ') + '.');
    }

    options[key] = given[key];
  }

  options.appRoot = resolveAppRoot(options.appRoot);

  if (options.port !== null && options.port !== undefined) {
    options.port = parsePort(options.port, 'the port option');
  }
  else {
    options.port = null;
  }

  if (options.host === undefined) {
    options.host = null;
  }

  if (typeof options.nodeFlags === 'string') {
    options.nodeFlags = splitFlags(options.nodeFlags);
  }
  else if (!Array.isArray(options.nodeFlags)) {
    throw usageError('the nodeFlags option must be a string or an array of ' +
      'strings');
  }
  else {
    options.nodeFlags = splitFlags(options.nodeFlags);
  }

  if (options.config !== null && options.config !== undefined &&
      !isPlainObject(options.config)) {
    throw usageError('the config option must be a plain object');
  }

  if (options.env !== null && options.env !== undefined &&
      !isPlainObject(options.env)) {
    throw usageError('the env option must be a plain object');
  }

  options.readyTimeoutMs = parsePositiveInteger(options.readyTimeoutMs,
    'the readyTimeoutMs option');

  if (options.provisionMongo !== true && options.provisionMongo !== false &&
      options.provisionMongo !== PROVISION_AUTO) {
    throw usageError('the provisionMongo option must be true, false or ' +
      JSON.stringify(PROVISION_AUTO) + ', not ' +
      JSON.stringify(options.provisionMongo) + '. It is deliberately not a ' +
      'loose boolean: the three values select provisioning, no database at ' +
      'all, and adopting an inherited address, and coercing them would make ' +
      'the last two indistinguishable.');
  }

  options.secure                = Boolean(options.secure);
  options.printConfig           = Boolean(options.printConfig);
  options.installSignalHandlers = Boolean(options.installSignalHandlers);

  if (options.s3Seed) {
    options.s3Seed = assertReadableFile(options.s3Seed, 'the s3Seed option');
  }
  else {
    options.s3Seed = null;
  }

  options.httpProfile = options.httpProfile
    ? String(options.httpProfile)
    : DEFAULT_HTTP_PROFILE;

  return options;
}

/**
 * Resolves a path that must exist and be readable.
 *
 * The S3 seed manifest is read ONCE at fixture load, and fixtures/aws.js
 * records a bad manifest on `errors()` rather than throwing - correctly, since
 * a preload that throws kills the server before app.js loads. That means a
 * mistyped seed path would produce a server that starts, serves, and quietly
 * lacks the pre-migration objects a storage assertion is about to look for. It
 * is checked here instead, where it can still be a clear failure.
 *
 * @param {string} target
 * @param {string} label
 * @returns {string} The absolute path.
 * @throws {ToolError} If it cannot be read.
 */
function assertReadableFile(target, label) {
  var resolved = path.resolve(target);

  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  }
  catch (err) {
    throw usageError(label + ' names ' + resolved + ', which cannot be read: ' +
      err.message);
  }

  return resolved;
}

/**
 * Starts the application and resolves once its route table answers.
 *
 * Concurrent callers share one in-flight start, and a caller that starts an
 * already-running server gets the running one back rather than a second child
 * nobody would stop. After `stop()` the launcher is reusable, which is what
 * lets one script drive both cookie passes in sequence.
 *
 * Every failure path tears down what had already been started, so a run that
 * cannot reach readiness does not also leak a child process or a mongod.
 *
 * @param {Object} [options]
 * @param {string} [options.appRoot] The worktree under test. Default cwd.
 * @param {(string|null)} [options.overlay] Overlay path, or null for none.
 * @param {boolean} [options.secure] The `SameSite=None; Secure` cookie pass.
 * @param {(string|null)} [options.host] Bind host and app.url.hostname.
 * @param {(number|null)} [options.port] Bind port and app.url.port.
 * @param {(string|null)} [options.database] Pin the MongoDB database name.
 * @param {(string|null)} [options.mongoUri] Use this address, provision nothing.
 * @param {boolean} [options.provisionMongo] Default true.
 * @param {(Array.<string>|string)} [options.nodeFlags] Flags for the child.
 * @param {(string|null)} [options.runDir] Per-run directory.
 * @param {(Object|null)} [options.config] An explicit top NODE_CONFIG layer.
 * @param {(string|null)} [options.s3Seed] PARITY_S3_SEED.
 * @param {(string|null)} [options.httpProfile] PARITY_HTTP_PROFILE.
 * @param {(Object|null)} [options.env] Extra child environment; null deletes.
 * @param {number} [options.readyTimeoutMs] Readiness budget.
 * @param {boolean} [options.installSignalHandlers] Default true.
 * @param {boolean} [options.printConfig] Echo the composed NODE_CONFIG.
 * @returns {Promise<Object>} The start result; see `buildResult`.
 * @throws {ToolError} If anything prevents a ready server.
 */
function start(options) {
  if (state.info) {
    return Promise.resolve(state.info);
  }
  if (state.startPromise) {
    return state.startPromise;
  }

  state.startPromise = startInternal(options);

  return state.startPromise;
}

/**
 * The body of `start`, separated so `start` stays a guard.
 *
 * The order of operations is the order in which each step can still fail
 * cheaply: arguments and paths first, then the run directory, then the
 * database, then the composed configuration, then the port, and only then a
 * child process. Nothing is spawned until everything that could have been
 * caught by reading has been.
 *
 * @param {(Object|undefined)} supplied
 * @returns {Promise<Object>} The start result.
 */
async function startInternal(supplied) {
  var options = resolveOptions(supplied);
  var context;

  state.failed = false;

  try {
    context = await buildContext(options);

    installSweep();
    installProcessListeners(options.installSignalHandlers);

    spawnApplication(context);
    state.pidPath = context.layout.pidPath;
    writePidFile(context.layout.pidPath, state.child.pid);

    note('started ' + context.appRoot + '/' + APP_ENTRY + ' as pid ' +
      state.child.pid + ' on ' + context.address.bindHost + ':' +
      context.address.port + ' (' +
      (options.secure ? 'secure cookie pass' : 'non-secure cookie pass') +
      '); logs in ' + context.layout.runDir + '.');

    await waitForReady(
      readyUrl(originFor(context.address.probeHost, context.address.port)),
      options.readyTimeoutMs
    );

    state.info = buildResult(options, context);

    return state.info;
  }
  catch (err) {
    // Tear down whatever did start. Without this a failed readiness poll would
    // leave a child holding the port and the next run would refuse to start,
    // reporting the leak rather than the original failure.
    state.startPromise = null;
    await stop();
    throw err;
  }
}

/**
 * Assembles everything the child needs, before anything is started.
 *
 * @param {Object} options Resolved options.
 * @returns {Promise<Object>} The run context.
 * @throws {ToolError} If any input is unusable.
 */
async function buildContext(options) {
  var fixtures = fixturePaths();
  var layout   = createRunDirectory(options.runDir);
  // Parsed once, here, and handed to both consumers: `resolveMongo` needs it to
  // decide whether an address was already published, and
  // `composeConfiguration` needs it as its lowest layer.
  var inherited = mongo.parseInheritedNodeConfig(process.env.NODE_CONFIG);
  var mongoResult;
  var composed;
  var context;

  state.runDir = layout.runDir;

  writeProfileFile(layout.httpProfilePath, options.httpProfile);

  mongoResult     = await resolveMongo(options, inherited);
  state.ownsMongo = mongoResult.owned;

  composed = composeConfiguration(options, mongoResult.layer, inherited);

  context = {
    appRoot     : options.appRoot,
    fixtures    : fixtures,
    layout      : layout,
    nodeFlags   : options.nodeFlags,
    httpProfile : options.httpProfile,
    s3Seed      : options.s3Seed,
    env         : options.env,
    secure      : options.secure,
    composed    : composed,
    nodeConfig  : JSON.stringify(composed),
    mongo       : mongoResult.address,
    address     : describeEffectiveAddress(composed)
  };

  context.childEnv = buildChildEnv(context);

  warnOnPortMismatch(context.address);
  assertReadinessRouteIsReachable(context);

  await assertPortFree(context.address.bindHost, context.address.port);

  if (options.printConfig) {
    note('NODE_CONFIG: ' + context.nodeConfig);
  }

  return context;
}

/**
 * Refuses to start a configuration that cannot become ready.
 *
 * `app.start` is the one value whose absence produces a server that initialises
 * perfectly and never listens - measured: `NODE_ENV=test node app.js` does
 * exactly that, because config/test.yaml:3 sets it false. Without this check
 * the symptom would be a full readiness timeout with a completely healthy child
 * and an empty stderr, which is the least informative failure this launcher
 * could produce. Checked against the COMPOSED configuration, so an overlay, an
 * inherited NODE_CONFIG or `--config` may each satisfy it.
 *
 * @param {Object} context The run context.
 * @returns {undefined}
 * @throws {ToolError} If app.start is not enabled.
 */
function assertReadinessRouteIsReachable(context) {
  var start = pick(context.composed, ['app', 'start']);

  if (start !== true) {
    throw new ToolError('the composed configuration leaves app.start as ' +
      JSON.stringify(start) + ', so app.js:330 would initialise the server ' +
      'and never call server.start() - it would listen on nothing and the ' +
      'readiness probe could only time out. config/test.yaml:3 sets it false, ' +
      'and test/parity/server-overlay.json is what sets it true; pass ' +
      '--overlay, or supply app.start yourself through --config.');
  }
}

/**
 * Builds the object `start` resolves with.
 *
 * The seven keys AAP §0.9.3 and this file's contract require - `baseUrl`,
 * `pid`, `port`, `stdoutPath`, `stderrPath`, `nodeConfig`, `secure` - plus the
 * per-run paths a caller needs and would otherwise have to reconstruct.
 * `nodeConfig` is the JSON STRING the child received, matching ./mongo's key of
 * the same name; `config` is the same value parsed, for a caller that wants to
 * assert on it.
 *
 * The fixture paths are returned because the fixture-interception assertions
 * read them: an upload that succeeded with no network is only evidence once the
 * S3 log shows the call it intercepted.
 *
 * @param {Object} options Resolved options.
 * @param {Object} context The run context.
 * @returns {Object} The start result.
 */
function buildResult(options, context) {
  return {
    // The contract.
    baseUrl    : context.address.baseUrl,
    pid        : state.child.pid,
    port       : context.address.port,
    stdoutPath : context.layout.stdoutPath,
    stderrPath : context.layout.stderrPath,
    nodeConfig : context.nodeConfig,
    secure     : context.secure,

    // The address, in the two forms a caller needs: what to dial, and what the
    // application will put in a Location header.
    host      : context.address.bindHost,
    probeHost : context.address.probeHost,
    origin    : originFor(context.address.probeHost, context.address.port),

    // Provenance, so a captured artifact can record which tree produced it.
    appRoot   : context.appRoot,
    nodeFlags : context.nodeFlags.slice(),
    execPath  : process.execPath,
    overlay   : options.overlay,
    config    : context.composed,
    mongo     : context.mongo,

    // The run directory and everything in it.
    runDir          : context.layout.runDir,
    pidPath         : context.layout.pidPath,
    s3Root          : context.layout.s3Root,
    uploadsDir      : context.layout.uploadsDir,
    mailLogPath     : context.layout.mailLogPath,
    s3LogPath       : context.layout.s3LogPath,
    httpLogPath     : context.layout.httpLogPath,
    httpProfilePath : context.layout.httpProfilePath,
    runtimeJsonPath : context.layout.runtimeJsonPath,
    httpProfile     : context.httpProfile,
    s3Seed          : context.s3Seed
  };
}

/**
 * The running server's start result.
 *
 * Throws rather than returning undefined when nothing is running, for the
 * reason ./mongo's `uri` does: a caller that read `undefined.baseUrl` would get
 * a TypeError about a property rather than the ordering mistake it actually
 * made.
 *
 * @returns {Object} The start result.
 * @throws {ToolError} If the server has not been started.
 */
function info() {
  if (!state.info) {
    throw new ToolError('no parity server is running in this process; call ' +
      'start() first.');
  }

  return state.info;
}

/**
 * Runs `fn` with a started server and stops it afterwards, whatever happens.
 *
 * The shape ./mongo's `withMongo` has, for the same reason: the `finally` is
 * the library-mode guarantee that a caller who declines the signal listeners
 * still cannot leak a child on an exception path.
 *
 * @param {function(Object): *} fn Receives the start result.
 * @param {Object} [options] As `start`.
 * @returns {Promise<*>} Whatever `fn` returned.
 */
async function withServer(fn, options) {
  var started = await start(options);

  try {
    return await fn(started);
  }
  finally {
    await stop();
  }
}


// ---------------------------------------------------------------------------
// The CLI
// ---------------------------------------------------------------------------

/**
 * Reports the started server on stderr, in the shape a reader needs.
 *
 * Stderr, not stdout, for the reason `note` gives: stdout belongs to a caller
 * that captures it. A gate script that wants these values programmatically
 * requires this module instead of parsing them out.
 *
 * @param {Object} result The start result.
 * @returns {undefined}
 */
function reportStarted(result) {
  note('listening      ' + result.origin);
  note('client baseUrl ' + result.baseUrl);
  note('pid            ' + result.pid + '  (' + result.pidPath + ')');
  note('stdout         ' + result.stdoutPath);
  note('stderr         ' + result.stderrPath);
  note('run directory  ' + result.runDir);
  note('cookie pass    ' + (result.secure
    ? 'secure - the patch appends "; SameSite=None; Secure"'
    : 'non-secure - SameSite=Lax, no Secure, Expires one year out'));

  if (result.mongo) {
    note('mongodb        ' + result.mongo.host + ':' + result.mongo.port +
      '/' + result.mongo.database);
  }

  if (result.nodeFlags.length) {
    note('node flags     ' + result.nodeFlags.join(' '));
  }
}

/**
 * Keeps the process alive until a signal arrives.
 *
 * The CLI's job is to hold a server up for something else to drive - a curl
 * loop, a browser, a sibling gate script - so it must not exit when `start`
 * resolves. The promise it returns is settled by nothing: the signal listeners
 * installed by `start` set `process.exitCode` and, once `stop` has removed
 * them, there is no handle left holding the loop open and the process exits on
 * its own. An interval would have to be cleared from somewhere, and a wrong
 * guess about where is a hang.
 *
 * The child itself is also watched: if the application dies on its own, there
 * is nothing left to hold up, and reporting that immediately is far better than
 * leaving a launcher parked in front of a dead server.
 *
 * `state.stopping` is what tells the two apart. A signal handler stops the
 * child deliberately, and the same `exit` event fires - so without the flag a
 * clean Ctrl-C would report "the application exited on its own", set
 * `state.failed`, and replace the 130 a shell expects with EXIT_ERROR. That was
 * measured, not imagined.
 *
 * @returns {Promise<undefined>}
 */
function runUntilSignalled() {
  return new Promise(function (resolve) {
    var child = state.child;

    if (!child) {
      resolve();
      return;
    }

    note('running; press Ctrl-C or send SIGTERM to stop.');

    child.once('exit', function () {
      if (state.stopping) {
        // Our own teardown. Nothing to report and nothing to fail.
        resolve();
        return;
      }

      note('ERROR: the application exited on its own (' +
        describeExit(state.exit) + '). See ' + state.stderrPath + '.');
      state.failed = true;
      resolve();
    });
  });
}

/**
 * The command line entry point.
 *
 * Exported so it can be driven directly, and invoked below only under
 * `require.main === module` - so requiring this file from capture.js, replay.js
 * or joi-matrix.js starts nothing.
 *
 * Exit codes: 0 when the server ran and came down cleanly, and EXIT_ERROR when
 * the launcher failed, when the application exited on its own, or when the
 * teardown left something behind. A signal produces 130 or 143 through
 * `onSignal`, which has already set `process.exitCode` by the time this
 * returns - so it is not overwritten here unless something also failed.
 *
 * @returns {Promise<undefined>}
 */
async function main() {
  var options;

  try {
    options = parseArguments(process.argv.slice(2));
  }
  catch (err) {
    note('ERROR: ' + err.message);
    process.stderr.write('\n' + USAGE + '\n');
    process.exitCode = EXIT_ERROR;
    return;
  }

  if (options.help) {
    process.stderr.write(USAGE + '\n');
    process.exitCode = EXIT_OK;
    return;
  }

  try {
    reportStarted(await start(options));
    await runUntilSignalled();
  }
  catch (err) {
    if (err instanceof ToolError) {
      note('ERROR: ' + err.message);
      if (err.usage) {
        process.stderr.write('\n' + USAGE + '\n');
      }
    }
    else {
      // Not a ToolError, so it is a defect in this file and the stack is the
      // evidence. Printing only the message would discard it.
      note('ERROR: unexpected failure in the launcher: ' +
        ((err && err.stack) || String(err)));
    }
    state.failed = true;
  }

  await stop();

  if (state.failed) {
    process.exitCode = EXIT_ERROR;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // The lifecycle. `start` and `stop` are the contract; `info` and `withServer`
  // exist so a caller never has to reach into module state or write its own
  // `finally`.
  start      : start,
  stop       : stop,
  info       : info,
  withServer : withServer,

  // Building blocks, exported because each has a failure mode worth testing
  // directly rather than through a spawned process - a wrong layer order, a
  // port that is not free, a mis-parsed connection string.
  parseArguments                : parseArguments,
  defaultOptions                : defaultOptions,
  resolveOptions                : resolveOptions,
  resolveAppRoot                : resolveAppRoot,
  fixturePaths                  : fixturePaths,
  createRunDirectory            : createRunDirectory,
  composeConfiguration          : composeConfiguration,
  addressLayer                  : addressLayer,
  describeEffectiveAddress      : describeEffectiveAddress,
  assertReadinessRouteIsReachable: assertReadinessRouteIsReachable,
  connectableHost               : connectableHost,
  originFor                     : originFor,
  readyUrl                      : readyUrl,
  probeOnce                     : probeOnce,
  isRetryableProbeError         : isRetryableProbeError,
  assertPortFree                : assertPortFree,
  buildChildEnv                 : buildChildEnv,
  buildChildArgs                : buildChildArgs,
  parseMongoUri                 : parseMongoUri,
  inheritedMongoAddress         : inheritedMongoAddress,
  parsePort                     : parsePort,
  splitFlags                    : splitFlags,
  nest                          : nest,
  pick                          : pick,
  deepMerge                     : deepMerge,
  isPlainObject                 : isPlainObject,
  signalExitCode                : signalExitCode,
  stderrTail                    : stderrTail,

  // Reference values, so a harness asserts against the same constants this
  // file uses rather than a second copy of them.
  APP_ENTRY            : APP_ENTRY,
  FIXTURE_FILES        : FIXTURE_FILES,
  FIXTURE_DIR          : FIXTURE_DIR,
  READY_PATH_PREFIX    : READY_PATH_PREFIX,
  READY_TIMEOUT_MS     : READY_TIMEOUT_MS,
  READY_INTERVAL_MS    : READY_INTERVAL_MS,
  PROBE_TIMEOUT_MS     : PROBE_TIMEOUT_MS,
  STOP_GRACE_MS        : STOP_GRACE_MS,
  DEFAULT_OVERLAY      : mongo.DEFAULT_OVERLAY,
  DEFAULT_HTTP_PROFILE : DEFAULT_HTTP_PROFILE,
  PROVISION_AUTO       : PROVISION_AUTO,
  PERSIST_ON_CHANGE    : PERSIST_ON_CHANGE,
  NODE_ENV_VALUE       : NODE_ENV_VALUE,
  EXIT_OK              : EXIT_OK,
  EXIT_ERROR           : EXIT_ERROR,
  ToolError            : ToolError,
  USAGE                : USAGE,
  main                 : main
};

if (require.main === module) {
  main();
}

