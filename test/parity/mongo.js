#!/usr/bin/env node
'use strict';

// The MongoDB lifecycle wrapper - what makes `npm test` able to exit 0 at all.
//
// AAP §0.9.2: "Nothing in the repository starts MongoDB today; the suite simply
// connects to localhost:27017 [config/test.yaml:db.mongo]." So the suite cannot
// pass on a clean host however well the migration goes, which is why R-b ("the
// application must genuinely run on Node 22, in full") puts this file in scope.
// It starts an isolated in-memory MongoDB, publishes its address to a CHILD
// process through NODE_CONFIG, runs the command it was given, and stops the
// server on every exit path - propagating the child's exit code verbatim.
//
// The root package.json declares `"test": "node test/parity/mongo.js -- mocha"`,
// so the user's stated command (`git clean -xfd && npm ci && npm test`) is
// unchanged and self-provisions its database.
//
// ===========================================================================
// RULES
// ===========================================================================
// `review_rules` returns exactly "No user rules provided." for this project,
// which AAP §0.7 and §0.10.1 independently record. No rules are invented here
// and their absence is not read as licence to lower the bar: enterprise
// practice governs. Two commitments of test/parity/ land squarely on this file:
//
//   Every parity claim is backed by an inspectable artifact. This wrapper is
//   never the reason a claim looks true - it MUST NOT mask a failure. The
//   child's exit code is propagated verbatim, a signal death exits non-zero,
//   and a teardown failure RAISES a zero exit rather than being swallowed. It
//   never lowers a non-zero code, because that would let a failing suite
//   report success - the single worst thing this file could do.
//
//   The baseline is captured before anything changes. One tool drives BOTH
//   worktrees, so this file may not depend on anything that exists only on the
//   target tree: it requires no application module, and the tree the CHILD
//   runs in is selected by `--app`. Only `mongodb-memory-server` is resolved
//   from this file's own tree, which is correct - the harness is the target's,
//   the application under test is whichever tree `--app` names.
//
// The request's own RULES block is binding and is not that document:
//   R-a  The diff must read as migration work only, so this file adds no
//        capability beyond provisioning: it seeds nothing, drops nothing and
//        asserts nothing. test/parity/seed.js owns fixtures and
//        test/helpers/db.js `reset` stays an empty-database operation.
//   R-d  Behaviour improvements are prohibited. This wrapper reports and
//        propagates; it never repairs, retries or smooths over.
//
// ===========================================================================
// ORDERING - the one detail that decides whether this works
// ===========================================================================
// The npm `config` package (0.4.37 here) resolves and freezes its values on
// first require, and config/db.js calls `connect()` at MODULE SCOPE (:35) using
// `config.db.mongo.{host,port,database}` (:14-18). The address must therefore
// be in the environment BEFORE the first application require - not after.
//
// That is why this file requires NO application module: not `config`, not
// config/db, not app.js, nothing under lib/. config/app.config.js:6 requires
// ./config/db, whose module-scope connect() would dial a database that does not
// exist yet and terminate non-zero. There is nothing to mutate in this process
// and there must not be; the server is started FIRST and the address reaches
// the application through the child's environment.
//
// ===========================================================================
// INVOCATION
// ===========================================================================
//   node test/parity/mongo.js -- mocha
//   node test/parity/mongo.js --overlay -- node test/parity/server.js
//   node test/parity/mongo.js --app /path/to/baseline-2f8712a -- mocha
//
// Everything after the FIRST bare `--` is the command and its arguments. The
// separator is a fixed interface, not a suggestion: the `test` script depends
// on it. Every human-readable byte this file produces goes to STDERR, because
// `npm test`'s stdout is the Mocha report and test/parity/manifest.js and the
// route-table gate capture stdout as an artifact.
//
// As a module it starts nothing - `start`, `stop`, `uri` and `withMongo` are
// exported for test/parity/{storage,worker,server,seed}.js so none of them
// re-implements any of this, and the CLI runs only under direct execution.
//
// ===========================================================================
// THE BINARY - no fallback, by decision
// ===========================================================================
// AAP §0.9.2 selects `mongodb-memory-server` because it is the only option that
// works under `git clean -xfd && npm ci && npm test` on a host with NO Docker.
// There is deliberately no fallback to `docker` and none to a system `mongod`:
// a silent fallback would make the gate untrustworthy, so a clear failure is
// the correct behaviour and an undeclared package is a hard error naming where
// the declaration belongs.
//
// MONGOMS_* variables are HONOURED, never overridden - only `instance.dbName`
// is passed to the package, so the binary, its version, the download directory
// and the bind address all remain the operator's to choose. That matters on a
// cold binary cache, where the package downloads mongod and prints progress
// through stdout (mongodb-memory-server-core/lib/util/MongoBinaryDownload.js:
// 442-460): a host that wants neither the network nor that output points it at
// a binary it already has, with `MONGOMS_SYSTEM_BINARY=/usr/local/bin/mongod`.
// Whatever notice the package emits about that choice - a version mismatch
// against the version it would have fetched, for instance - is the package's
// own and is deliberately left visible rather than filtered.

var childProcess = require('child_process');
var crypto       = require('crypto');
var fs           = require('fs');
var os           = require('os');
var path         = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Exit codes. EXIT_ERROR is this file's own failure - the harness could not
// run - and is deliberately distinct from a propagated child code, which is
// passed through untouched whatever its value. Mocha exits with its failure
// count, so a 2 can mean either "two tests failed" or "the harness failed";
// the two are told apart by the `harness ERROR:` line, never by the number.
var EXIT_OK    = 0;
var EXIT_ERROR = 2;

// The package that provides the server, and where its declaration belongs.
// Named in full in every failure message so a reader never has to guess.
var PACKAGE_NAME  = 'mongodb-memory-server';
var PACKAGE_FIELD = 'devDependencies';

// This file's own worktree root, two levels above test/parity/. Used for the
// declaration check and as the default working directory for the child.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

// The default overlay, resolved against this file so it is the same path no
// matter which directory the wrapper was invoked from and no matter which tree
// `--app` selects. The overlay belongs to the tool's worktree; only the tree
// the child runs in moves.
var DEFAULT_OVERLAY = path.join(__dirname, 'server-overlay.json');

// Matches what test/env.js sets, so `config` never writes config/runtime.json
// (which .gitignore lists) during a parity run.
var PERSIST_ON_CHANGE = 'N';

// How long a forwarded SIGINT/SIGTERM is given to bring the child down before
// it is killed outright. Bounded, because an unresponsive child must not leave
// a mongod and a data directory behind - and generous, because killing the
// database from under a running Mocha produces a cascade of connection errors
// instead of the real reason for the interrupt.
var SHUTDOWN_GRACE_MS = 10000;

// Everything this file prints carries this prefix, so its lines are
// unmistakably harness output inside a stream that also carries the child's.
var LOG_PREFIX = '[parity:mongo] ';

// Characters MongoDB forbids in a database name, plus its length ceiling.
var INVALID_DB_CHARS = /[\/\\. "$*<>:|?\u0000]/;
var MAX_DB_NAME      = 63;

var USAGE = [
  'Usage: node test/parity/mongo.js [harness options] -- <command> [args...]',
  '',
  'Starts an isolated in-memory MongoDB, publishes its address to <command>',
  'through NODE_CONFIG, runs it, and stops the server on every exit path.',
  "The child's exit code becomes this process's exit code.",
  '',
  'Harness options, all of which must precede the first bare `--`:',
  '  --overlay [path]  Deep-merge a NODE_CONFIG overlay UNDER the runtime',
  '                    database address. With no path, defaults to',
  '                    test/parity/server-overlay.json. Also --overlay=<path>.',
  '  --app <dir>       Run the child with <dir> as its working directory and',
  '                    <dir>/node_modules/.bin on its PATH, so one wrapper',
  '                    drives the target tree and a baseline worktree alike.',
  '  -h, --help        Print this on stderr and exit 0.',
  '',
  'Examples:',
  '  node test/parity/mongo.js -- mocha',
  '  node test/parity/mongo.js --overlay -- node test/parity/server.js',
  '  node test/parity/mongo.js --app /path/to/baseline-2f8712a -- mocha',
  '',
  'Every diagnostic goes to stderr; stdout carries only the child\'s output.'
].join('\n');

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

// One server per process. The parity harnesses are single-purpose scripts, and
// a second concurrent instance inside one process would be a caller mistake
// rather than a case to support - `start` returns the running instance instead
// of quietly starting a second mongod nobody would ever stop.
var state = {
  server         : null,   // MongoMemoryServer instance, once started.
  info           : null,   // The published address, as returned by start().
  dataPath       : null,   // The instance's dbPath, captured for the sweep.
  tmpDir         : null,   // Set only when the PACKAGE created the directory.
  startPromise   : null,   // In-flight start, so concurrent callers share one.
  stopPromise    : null,   // In-flight stop, which is what makes stop idempotent.
  stopped        : false,  // True once the server is down and cleaned up.
  child          : null,   // The spawned command.
  childResult    : null,   // {code, signal} once it has exited.
  interrupted    : null,   // The signal name, if one arrived.
  shuttingDown   : false,  // True once a signal path has begun.
  failed         : false,  // A failure of the HARNESS: raises a zero exit code,
                           // and never lowers a non-zero one.
  sweepInstalled : false,  // The synchronous last-resort `exit` listener.
  listeners      : []      // [event, handler] pairs installed by the CLI.
};

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/**
 * Writes one diagnostic line to stderr.
 *
 * Stdout is never written to, by any path in this file: `npm test`'s stdout is
 * the Mocha report, and the sibling gates capture stdout as their artifact. A
 * wrapper that printed there would corrupt both.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  process.stderr.write(LOG_PREFIX + String(message) + '\n');
}

/**
 * An operational failure of the harness itself.
 *
 * Thrown for a usage error, a missing declaration, or any condition that means
 * the database cannot be provisioned trustworthily. It exits EXIT_ERROR, and
 * its message alone is printed - the message is written to be actionable, and a
 * stack trace would bury it. Anything that is NOT a ToolError is a defect in
 * this file and its stack IS the evidence, so that case prints the trace.
 *
 * @param {string} message
 * @constructor
 */
function ToolError(message) {
  Error.call(this, message);
  this.name    = 'ToolError';
  this.message = message;
  this.stack   = (new Error(message)).stack;
}
ToolError.prototype             = Object.create(Error.prototype);
ToolError.prototype.constructor = ToolError;

/**
 * True for an object that can be merged key by key.
 *
 * Arrays and class instances are values, not merge targets: an overlay that
 * supplies an array replaces it wholesale, which is the only sane reading of
 * "the overlay wins" for a list.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * Deep-merges `overlay` over `base`, returning a new plain object.
 *
 * DEEP, not `Object.assign`. The reason is concrete and measured:
 * test/parity/server-overlay.json declares both `db.mongo.database` and
 * `db.redis.enabled`, and this file must replace the first while preserving the
 * second. A shallow merge of `db` would discard `db.redis.enabled`, the in-memory
 * queue branch in lib/util/queues.js would not be selected, and every parity run
 * would dial a Redis that the gate deliberately does not provide.
 *
 * @param {Object} base The layer that loses.
 * @param {Object} overlay The layer that wins.
 * @returns {Object} A new object; neither argument is mutated.
 */
function deepMerge(base, overlay) {
  var out  = {};
  var keys = Object.keys(isPlainObject(base) ? base : {});
  var i;
  var key;

  for (i = 0; i < keys.length; i++) {
    out[keys[i]] = base[keys[i]];
  }

  keys = Object.keys(isPlainObject(overlay) ? overlay : {});
  for (i = 0; i < keys.length; i++) {
    key = keys[i];
    if (isPlainObject(out[key]) && isPlainObject(overlay[key])) {
      out[key] = deepMerge(out[key], overlay[key]);
    }
    else {
      out[key] = overlay[key];
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// The server package
// ---------------------------------------------------------------------------

/**
 * Confirms `mongodb-memory-server` is declared as an exact devDependency.
 *
 * The contract is precise about this: the package is declared in the root
 * package.json at an EXACT pinned version, this file does not add it, and if it
 * is absent the failure must name the package and the field the declaration
 * belongs in rather than silently skipping the database. An undeclared package
 * is a hard error even when node_modules happens to contain it, because
 * `npm ci` would not install it on the next clean host and the gate would then
 * be unreproducible - which is the whole point of the exact pin.
 *
 * A range is reported and allowed to proceed: the run is still valid, but the
 * pin AAP §0.9.2 asks for is not in force, and that is worth saying out loud
 * rather than failing a suite over.
 *
 * A package.json this file cannot read is reported too, and the require below
 * remains the authoritative gate - a missing manifest must not be the reason a
 * database silently fails to appear.
 *
 * @param {string} [manifestPath] Defaults to this tree's package.json.
 * @returns {(string|null)} The declared specifier, or null when unreadable.
 * @throws {ToolError} If the manifest is readable and does not declare it.
 */
function assertDeclaredDependency(manifestPath) {
  var target = manifestPath || path.join(TOOL_ROOT, 'package.json');
  var manifest;
  var declared;

  try {
    manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
  }
  catch (err) {
    note('WARNING: could not read ' + target + ' to check the ' +
      PACKAGE_NAME + ' declaration (' + err.message + '); the require below ' +
      'remains the gate.');
    return null;
  }

  declared = (manifest[PACKAGE_FIELD] || {})[PACKAGE_NAME];

  if (declared === undefined) {
    throw new ToolError(
      PACKAGE_NAME + ' is not declared in ' + target + '. Add it under "' +
      PACKAGE_FIELD + '" at an exact pinned version (AAP §0.9.2), for example ' +
      '"' + PACKAGE_NAME + '": "11.2.0". It is not added from here, and the ' +
      'database is not skipped: without it there is no MongoDB for the suite ' +
      'to connect to, and no fallback to Docker or to a system mongod exists ' +
      'by decision.'
    );
  }

  if (!/^\d/.test(String(declared).trim())) {
    note('WARNING: ' + PACKAGE_NAME + ' is declared as "' + declared +
      '" in ' + target + '. AAP §0.9.2 asks for an exact pinned version so ' +
      'this gate resolves the same server everywhere. Proceeding.');
  }

  return String(declared);
}

/**
 * Resolves the MongoMemoryServer constructor.
 *
 * Resolution is relative to THIS file, which is deliberate: the harness belongs
 * to the target worktree and the application under test may be a baseline
 * worktree installed from the baseline lockfile, where this devDependency does
 * not exist. Only the child runs in that tree.
 *
 * A MODULE_NOT_FOUND naming the package itself becomes the actionable message.
 * Any other failure - a broken install, a native load error - is re-thrown
 * untouched, because pretending it is a missing declaration would send a reader
 * to the wrong place.
 *
 * @returns {Function} The MongoMemoryServer constructor.
 * @throws {ToolError} If the package is absent or exports nothing usable.
 */
function loadServerClass() {
  var loaded;

  try {
    loaded = require(PACKAGE_NAME);
  }
  catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' &&
        String(err.message).indexOf(PACKAGE_NAME) !== -1) {
      throw new ToolError(
        'cannot load ' + PACKAGE_NAME + ' from ' + TOOL_ROOT + '. Install it - ' +
        'it belongs in package.json under "' + PACKAGE_FIELD + '" at an exact ' +
        'pinned version - and run `npm ci`. There is no fallback to Docker or ' +
        'to a system mongod: a silent fallback would make the parity gate ' +
        'untrustworthy, so this is a hard failure. Underlying error: ' +
        err.message
      );
    }
    throw err;
  }

  if (!loaded || typeof loaded.MongoMemoryServer !== 'function') {
    throw new ToolError(
      PACKAGE_NAME + ' loaded but does not export MongoMemoryServer as a ' +
      'constructor. The installed version is incompatible with this harness.'
    );
  }

  return loaded.MongoMemoryServer;
}

// ---------------------------------------------------------------------------
// Identity and the published configuration
// ---------------------------------------------------------------------------

/**
 * Generates the per-run database name.
 *
 * Isolation is the requirement, in two directions: two concurrent runs must not
 * collide, and a crashed run must not leave state a later run reads. The pid
 * separates concurrent processes, the base-36 timestamp separates sequential
 * runs within one pid, and the random tail covers the case of two processes
 * that briefly share a pid across a namespace boundary. Nothing here is ever
 * reused, so no run inherits another's documents.
 *
 * @returns {string} A name MongoDB accepts.
 */
function generateDatabaseName() {
  return 'parity_' + process.pid + '_' + Date.now().toString(36) + '_' +
    crypto.randomBytes(3).toString('hex');
}

/**
 * Validates a database name a caller supplied.
 *
 * Only the programmatic API can supply one - the CLI always generates - and a
 * caller that pins a name owns the isolation question itself. What is checked
 * is what MongoDB itself rejects, so the failure arrives here with a readable
 * message instead of mid-connection.
 *
 * @param {string} name
 * @returns {string} The same name.
 * @throws {ToolError} If MongoDB would reject it.
 */
function assertDatabaseName(name) {
  if (typeof name !== 'string' || name === '') {
    throw new ToolError('database name must be a non-empty string');
  }
  if (INVALID_DB_CHARS.test(name)) {
    throw new ToolError(
      'database name ' + JSON.stringify(name) + ' contains a character ' +
      'MongoDB forbids (/ \\ . " $ * < > : | ? space or NUL)'
    );
  }
  if (Buffer.byteLength(name, 'utf8') > MAX_DB_NAME) {
    throw new ToolError(
      'database name ' + JSON.stringify(name) + ' exceeds MongoDB\'s ' +
      MAX_DB_NAME + '-byte limit'
    );
  }
  return name;
}

/**
 * Parses an inherited NODE_CONFIG.
 *
 * An inherited value is honoured UNDERNEATH the overlay and the runtime
 * address, and the fact that it was honoured is stated on stderr - a caller's
 * configuration is never silently dropped, because a baseline run and a target
 * run that differed for a reason absent from the provenance would be worse than
 * a failure. An inherited value that is not a JSON object is a hard failure for
 * the same reason: node-config would reject it anyway, and discarding it
 * quietly would hide the divergence.
 *
 * @param {(string|undefined)} inherited process.env.NODE_CONFIG
 * @returns {Object}
 * @throws {ToolError} If present and not a JSON object.
 */
function parseInheritedNodeConfig(inherited) {
  var parsed;

  if (inherited === undefined || String(inherited).trim() === '') {
    return {};
  }

  try {
    parsed = JSON.parse(inherited);
  }
  catch (err) {
    throw new ToolError(
      'inherited NODE_CONFIG is not valid JSON, refusing to discard it: ' +
      err.message
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ToolError('inherited NODE_CONFIG is not a JSON object');
  }

  note('merging over the inherited NODE_CONFIG (' +
    Object.keys(parsed).length + ' top-level key(s)); it is honoured beneath ' +
    'the overlay and the database address.');

  return parsed;
}

/**
 * Reads a NODE_CONFIG overlay from disk.
 *
 * A missing or malformed overlay is a hard failure naming the path. The overlay
 * carries `db.redis.enabled: false`, `app.start: true`, the fixed non-production
 * session secret and the `aws.buckets.exports` entry committed configuration
 * lacks (AAP §0.9.3, §0.6.7); a run that continued without it would be a
 * different run wearing the same name.
 *
 * @param {string} overlayPath Absolute or process-relative.
 * @returns {Object}
 * @throws {ToolError} If it cannot be read or is not a JSON object.
 */
function readOverlay(overlayPath) {
  var resolved = path.resolve(overlayPath);
  var parsed;

  try {
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  }
  catch (err) {
    throw new ToolError(
      'cannot read the NODE_CONFIG overlay at ' + resolved + ': ' + err.message
    );
  }

  if (!isPlainObject(parsed)) {
    throw new ToolError(
      'the NODE_CONFIG overlay at ' + resolved + ' is not a JSON object'
    );
  }

  return parsed;
}

/**
 * Builds the runtime configuration layer - the address, and nothing else.
 *
 * `db.mongo.{host,port,database}` is what config/db.js:14-18 interpolates, so
 * publishing those three is what points the application at this server.
 *
 * Four sibling keys are pinned to null with them, and the reason is that
 * config/db.js reads them too. `mongo.user`/`mongo.pass` produce a credential
 * prefix when both are truthy (:7-8) and the in-memory server runs without
 * authentication, so an inherited credential would break every connection.
 * `mongoread.host` appends a SECOND host to the connection string when it is
 * truthy (:20-30), and there is no second node. Committed configuration leaves
 * all four empty - measured - so this layer normally changes nothing; it exists
 * so that the published address is authoritative even under an inherited
 * NODE_CONFIG or a config/local.yaml, which is precisely the claim the
 * connectivity gate makes.
 *
 * @param {{host: string, port: number, database: string}} address
 * @returns {Object} The top layer of NODE_CONFIG.
 */
function buildRuntimeConfig(address) {
  return {
    db : {
      mongo : {
        host     : address.host,
        port     : address.port,
        database : address.database,
        user     : null,
        pass     : null
      },
      mongoread : {
        host : null
      }
    }
  };
}

/**
 * Composes the NODE_CONFIG the child receives.
 *
 * Three layers, lowest first: whatever the caller inherited, the `--overlay`
 * file if one was named, and the runtime address, which wins. The result is a
 * JSON string because that is the only form the `config` package reads it in.
 *
 * @param {(string|undefined)} inherited process.env.NODE_CONFIG
 * @param {(Object|null)} overlay Parsed overlay, or null when none was named.
 * @param {Object} runtime From buildRuntimeConfig.
 * @returns {string} A JSON string.
 * @throws {ToolError} If the inherited value is present and unusable.
 */
function composeNodeConfig(inherited, overlay, runtime) {
  var merged = parseInheritedNodeConfig(inherited);

  if (overlay) {
    merged = deepMerge(merged, overlay);
  }

  return JSON.stringify(deepMerge(merged, runtime));
}


// ---------------------------------------------------------------------------
// The last-resort sweep
// ---------------------------------------------------------------------------

/**
 * Kills the server's processes and removes its data directory, synchronously.
 *
 * Registered on `process.on('exit')` from `start`, and reached only when an
 * asynchronous teardown did not complete - a `process.exit()` in a caller, a
 * fatal error inside the teardown itself. An `exit` listener cannot await, so
 * this uses the synchronous calls only, and it exists because the alternative
 * is a leaked mongod holding a port and a temporary directory that outlives the
 * run. It is loud: a sweep means an exit path was missed, which is worth
 * knowing even though the sweep repaired it.
 *
 * Only processes this file started are signalled - the package's own mongod and
 * its watchdog, read off the instance - and only a directory the PACKAGE
 * created is removed. A dbPath a caller supplied is left alone; it is not ours.
 *
 * @returns {undefined}
 */
function sweepSynchronously() {
  var instance = state.info && state.server && state.server.instanceInfo
    ? state.server.instanceInfo.instance
    : null;
  var killed = 0;

  if (state.stopped || !state.server) {
    return;
  }

  note('WARNING: the asynchronous teardown did not complete; sweeping ' +
    'synchronously from the exit handler.');

  [instance && instance.mongodProcess, instance && instance.killerProcess]
    .forEach(function (proc) {
      if (proc && typeof proc.pid === 'number' && !proc.killed) {
        try {
          process.kill(proc.pid, 'SIGKILL');
          killed++;
        }
        catch (err) {
          // ESRCH means it is already gone, which is the outcome we wanted.
          if (!err || err.code !== 'ESRCH') {
            note('WARNING: could not kill pid ' + proc.pid + ': ' +
              err.message);
          }
        }
      }
    });

  if (state.tmpDir) {
    try {
      fs.rmSync(state.tmpDir, { recursive: true, force: true });
    }
    catch (err) {
      note('WARNING: could not remove the data directory ' + state.tmpDir +
        ': ' + err.message);
    }
  }
  else if (state.dataPath) {
    note('the data directory ' + state.dataPath + ' was not created by ' +
      PACKAGE_NAME + ' and is left as it is.');
  }

  note('swept: ' + killed + ' process(es) killed' +
    (state.tmpDir ? ', data directory ' + state.tmpDir + ' removed' : ''));
}

/**
 * Installs the synchronous sweep exactly once.
 *
 * An `exit` listener does not hold the event loop open, so this is safe in
 * library mode - unlike the signal handlers, which the CLI installs and a
 * required module must not, because hijacking a host process's SIGINT is not
 * this file's business.
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

// ---------------------------------------------------------------------------
// Lifecycle - the programmatic API
// ---------------------------------------------------------------------------

/**
 * Starts the in-memory server and returns its published address.
 *
 * Concurrent callers share one in-flight start, and a caller that starts an
 * already-running server gets the running one back rather than a second mongod
 * nobody would stop. The address is reported once, on stderr.
 *
 * @param {Object} [options]
 * @param {string} [options.database] A pinned database name. Defaults to a
 *   generated per-run name; a caller that pins one owns the isolation question.
 * @param {(Object|null)} [options.overlay] A parsed NODE_CONFIG overlay to
 *   place under the address.
 * @param {(string|undefined)} [options.inheritedNodeConfig] Defaults to
 *   process.env.NODE_CONFIG.
 * @returns {Promise<{uri: string, host: string, port: number, database: string,
 *   nodeConfig: string, env: Object, dataPath: (string|undefined)}>}
 * @throws {ToolError} If the package is absent, undeclared, or cannot start.
 */
function start(options) {
  var opts = options || {};

  if (state.info) {
    return Promise.resolve(state.info);
  }
  if (state.startPromise) {
    return state.startPromise;
  }

  state.startPromise = startInstance(opts);

  return state.startPromise;
}

/**
 * The body of `start`, separated so `start` stays a guard.
 *
 * MONGOMS_* variables are read by the package itself and are neither set nor
 * cleared here, which is what lets a host point it at a binary it already has
 * instead of downloading one at gate time.
 *
 * @param {Object} opts As documented on `start`.
 * @returns {Promise<Object>} The published address.
 */
async function startInstance(opts) {
  var database = opts.database === undefined
    ? generateDatabaseName()
    : assertDatabaseName(opts.database);
  var ServerClass;
  var server;
  var instanceInfo;
  var address;
  var nodeConfig;

  assertDeclaredDependency();
  ServerClass = loadServerClass();
  installSweep();

  try {
    server = await ServerClass.create({ instance: { dbName: database } });
  }
  catch (err) {
    state.startPromise = null;
    throw new ToolError(
      'could not start ' + PACKAGE_NAME + ': ' + ((err && err.message) || err) +
      '. On a host without a cached mongod the package downloads one, so ' +
      'either allow that or point it at an existing binary with ' +
      'MONGOMS_SYSTEM_BINARY. There is no fallback to Docker or to a system ' +
      'mongod from here, by decision.'
    );
  }

  instanceInfo = server.instanceInfo;

  if (!instanceInfo || typeof instanceInfo.port !== 'number') {
    // Refuse to publish an address that is not known to be real. Stop what did
    // start, so the failure does not also leak a process.
    state.server   = server;
    state.dataPath = instanceInfo && instanceInfo.dbPath;
    state.tmpDir   = instanceInfo && instanceInfo.tmpDir;
    await stop();
    state.startPromise = null;
    throw new ToolError(
      PACKAGE_NAME + ' started without reporting an instance port, so the ' +
      'address cannot be published. Refusing to continue with an unknown ' +
      'database address.'
    );
  }

  state.server   = server;
  state.dataPath = instanceInfo.dbPath;
  state.tmpDir   = instanceInfo.tmpDir;
  state.stopped  = false;

  address    = describeAddress(server, database, instanceInfo);
  nodeConfig = composeNodeConfig(
    opts.inheritedNodeConfig === undefined
      ? process.env.NODE_CONFIG
      : opts.inheritedNodeConfig,
    opts.overlay || null,
    buildRuntimeConfig(address)
  );

  state.info = {
    uri        : address.uri,
    host       : address.host,
    port       : address.port,
    database   : address.database,
    nodeConfig : nodeConfig,
    env        : {
      NODE_CONFIG                   : nodeConfig,
      NODE_CONFIG_PERSIST_ON_CHANGE : PERSIST_ON_CHANGE,
      PARITY_MONGO_URI              : address.uri,
      PARITY_MONGO_DATABASE         : address.database
    },
    dataPath   : instanceInfo.dbPath
  };

  // Once, on stderr, prefixed. Never on stdout: the sibling gates capture
  // stdout as their artifact and `npm test`'s stdout is the Mocha report.
  note('mongodb ready at ' + address.uri + ' (database ' + address.database +
    ', data ' + (instanceInfo.dbPath || 'unknown') + ')');

  return state.info;
}

/**
 * Derives the address in exactly the shape config/db.js composes.
 *
 * The host comes from parsing the package's own URI with `new URL` - never
 * `url.parse`, which emits DEP0169 under --pending-deprecation and would put a
 * deprecation notice from the harness itself into the stream AAP §0.9.3's
 * zero-warning gate inspects. Parsing rather than reading `instanceInfo.ip`
 * keeps an IPv6 address in its bracketed URI form, which is the form a
 * connection string needs.
 *
 * The URI is then composed by concatenation rather than taken from the package,
 * so that what is reported is character for character what config/db.js:14-18
 * will build from the three published values - the claim the connectivity gate
 * checks.
 *
 * @param {Object} server The started MongoMemoryServer.
 * @param {string} database
 * @param {Object} instanceInfo server.instanceInfo, already validated.
 * @returns {{uri: string, host: string, port: number, database: string}}
 * @throws {ToolError} If the package's URI cannot be parsed.
 */
function describeAddress(server, database, instanceInfo) {
  var raw = server.getUri(database);
  var parsed;
  var host;

  try {
    parsed = new URL(raw);
  }
  catch (err) {
    throw new ToolError(
      PACKAGE_NAME + ' reported an unparseable URI (' + raw + '): ' +
      err.message
    );
  }

  host = parsed.hostname || instanceInfo.ip;

  if (!host) {
    throw new ToolError(
      PACKAGE_NAME + ' reported no host for its instance (' + raw + ')'
    );
  }

  return {
    uri      : 'mongodb://' + host + ':' + instanceInfo.port + '/' + database,
    host     : host,
    port     : instanceInfo.port,
    database : database
  };
}

/**
 * Stops the server and removes its data directory.
 *
 * Idempotent in both directions that matter: a second call returns the first
 * call's promise, and a call before any start resolves immediately. Signals can
 * arrive while an exit path is already running, so this is the only place the
 * server is brought down and every path goes through it.
 *
 * A failure to stop is REPORTED and recorded, not thrown: the caller's own
 * result - a suite's exit code - must still reach the shell. It is recorded on
 * `state.failed`, which raises a zero exit code, because a leaked
 * mongod or a surviving data directory is a real failure that must be visible.
 *
 * @returns {Promise<boolean>} True if the server is down and cleaned up.
 */
function stop() {
  if (state.stopped || !state.server) {
    state.stopped = true;
    return Promise.resolve(true);
  }
  if (state.stopPromise) {
    return state.stopPromise;
  }

  state.stopPromise = stopInstance();

  return state.stopPromise;
}

/**
 * The body of `stop`, separated so `stop` stays a guard.
 *
 * `stop({doCleanup: true})` is the package's own removal of the data directory.
 * The directory is then checked, and removed here if it survived - only when
 * the PACKAGE created it, which `instanceInfo.tmpDir` is what records.
 *
 * @returns {Promise<boolean>}
 */
async function stopInstance() {
  var server = state.server;
  var tmpDir = state.tmpDir;
  var ok     = true;

  try {
    await server.stop({ doCleanup: true, force: false });
  }
  catch (err) {
    ok = false;
    state.failed = true;
    note('ERROR: stopping ' + PACKAGE_NAME + ' failed: ' +
      ((err && err.message) || err));
  }

  if (tmpDir) {
    try {
      if (fs.existsSync(tmpDir)) {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      }
    }
    catch (err) {
      ok = false;
      state.failed = true;
      note('ERROR: could not remove the data directory ' + tmpDir + ': ' +
        ((err && err.message) || err));
    }
  }

  state.stopped      = true;
  state.server       = null;
  state.info         = null;
  state.startPromise = null;
  state.stopPromise  = null;

  return ok;
}

/**
 * The current connection URI.
 *
 * Throws rather than returning undefined when nothing is running: a caller that
 * used an undefined URI would connect to `mongodb://undefined` and report a
 * confusing connection error instead of the ordering mistake it actually made.
 *
 * @param {string} [database] Compose the URI for a different database on the
 *   same instance; defaults to the one that was published.
 * @returns {string}
 * @throws {ToolError} If the server has not been started.
 */
function uri(database) {
  if (!state.info) {
    throw new ToolError(
      'no in-memory MongoDB is running; await start() before reading uri()'
    );
  }

  if (database === undefined) {
    return state.info.uri;
  }

  return 'mongodb://' + state.info.host + ':' + state.info.port + '/' +
    assertDatabaseName(database);
}

/**
 * Runs `fn` against a started server and stops it afterwards.
 *
 * The stop is in a `finally`, so it happens whether `fn` returns or throws, and
 * `fn`'s outcome is propagated untouched - a rejection stays a rejection. This
 * is the form test/parity/{storage,worker,seed}.js use so that none of them
 * re-implements the lifecycle.
 *
 * @param {function(Object): *} fn Receives the published address.
 * @param {Object} [options] As documented on `start`.
 * @returns {Promise<*>} Whatever `fn` resolves to.
 * @throws {ToolError} If `fn` is not a function.
 */
async function withMongo(fn, options) {
  var info;

  if (typeof fn !== 'function') {
    throw new ToolError('withMongo requires a function');
  }

  info = await start(options);

  try {
    return await fn(info);
  }
  finally {
    await stop();
  }
}


// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parses the command line.
 *
 * Everything after the FIRST bare `--` is the command and its arguments, and
 * nothing before it may be a bare token: the separator is the interface the
 * `test` script depends on, so a command smuggled in without one is a usage
 * error rather than something to guess at.
 *
 * @param {string[]} args process.argv.slice(2)
 * @returns {{mode: string, overlayPath: (string|null), appRoot: string,
 *   command: (string|null), commandArgs: string[]}}
 * @throws {ToolError} On any usage error; `showUsage` is set on it.
 */
function parseArguments(args) {
  var separator = args.indexOf('--');
  var head      = separator === -1 ? args.slice(0) : args.slice(0, separator);
  var tail      = separator === -1 ? []            : args.slice(separator + 1);
  var options   = {
    mode        : 'run',
    overlayPath : null,
    appRoot     : TOOL_ROOT,
    command     : null,
    commandArgs : []
  };
  var i;
  var arg;
  var next;

  for (i = 0; i < head.length; i++) {
    arg = head[i];

    if (arg === '-h' || arg === '--help') {
      options.mode = 'help';
      return options;
    }

    if (arg === '--overlay') {
      // A bare `--overlay` selects the default. The following token is taken as
      // its path only when it cannot be another option; a path that genuinely
      // begins with a dash must be written as ./-name or given with `=`.
      next = head[i + 1];
      if (next === undefined || next.charAt(0) === '-') {
        options.overlayPath = DEFAULT_OVERLAY;
      }
      else {
        options.overlayPath = next;
        i++;
      }
      continue;
    }

    if (arg.indexOf('--overlay=') === 0) {
      options.overlayPath = valueOf(arg, '--overlay=') || DEFAULT_OVERLAY;
      continue;
    }

    if (arg === '--app') {
      next = head[i + 1];
      if (next === undefined || next.charAt(0) === '-') {
        throw usageError('--app requires a directory');
      }
      options.appRoot = path.resolve(next);
      i++;
      continue;
    }

    if (arg.indexOf('--app=') === 0) {
      options.appRoot = path.resolve(requireValue(arg, '--app='));
      continue;
    }

    if (arg.charAt(0) === '-') {
      throw usageError('unknown harness option ' + arg);
    }

    throw usageError(
      'unexpected argument ' + JSON.stringify(arg) + '. The command must ' +
      'follow a bare `--`, as in `node test/parity/mongo.js -- mocha`.'
    );
  }

  if (separator === -1) {
    throw usageError(
      'no `--` separator found. Everything after the first bare `--` is the ' +
      'command to run, and there is nothing to run without it.'
    );
  }

  if (tail.length === 0) {
    throw usageError('no command follows the `--` separator');
  }

  options.command     = tail[0];
  options.commandArgs = tail.slice(1);

  assertDirectory(options.appRoot);

  return options;
}

/**
 * A usage error, tagged so the caller prints the usage text with it.
 *
 * @param {string} message
 * @returns {ToolError}
 */
function usageError(message) {
  var err = new ToolError(message);

  err.showUsage = true;

  return err;
}

/**
 * The value of a `--flag=value` token, or the empty string.
 *
 * @param {string} arg
 * @param {string} prefix
 * @returns {string}
 */
function valueOf(arg, prefix) {
  return arg.slice(prefix.length);
}

/**
 * The value of a `--flag=value` token, which must not be empty.
 *
 * @param {string} arg
 * @param {string} prefix
 * @returns {string}
 * @throws {ToolError}
 */
function requireValue(arg, prefix) {
  var value = valueOf(arg, prefix);

  if (value === '') {
    throw usageError(prefix.replace(/=$/, '') + ' requires a value');
  }

  return value;
}

/**
 * Confirms `--app` names a directory that exists.
 *
 * Checked before the server starts, so a mistyped baseline worktree path costs
 * nothing and fails with the path in the message rather than as a spawn error
 * after a mongod has been started for nothing.
 *
 * @param {string} dir Absolute path.
 * @returns {string} The same path.
 * @throws {ToolError} If it is missing or not a directory.
 */
function assertDirectory(dir) {
  var stats;

  try {
    stats = fs.statSync(dir);
  }
  catch (err) {
    throw usageError('--app directory ' + dir + ' cannot be read: ' +
      err.message);
  }

  if (!stats.isDirectory()) {
    throw usageError('--app path ' + dir + ' is not a directory');
  }

  return dir;
}

// ---------------------------------------------------------------------------
// The child process
// ---------------------------------------------------------------------------

/**
 * Builds the child's environment.
 *
 * Four things are added to an inherited copy:
 *
 *   NODE_CONFIG                    the composed address, which is the whole
 *                                  point of this file.
 *   NODE_CONFIG_PERSIST_ON_CHANGE  'N', matching test/env.js, so `config` never
 *                                  writes config/runtime.json - a gitignored
 *                                  path this harness must not create.
 *   NODE_CONFIG_DIR                only when the child runs in a DIFFERENT tree
 *                                  and the caller has not set it. The `config`
 *                                  package resolves its directory from the
 *                                  working directory, and a baseline run that
 *                                  read the target tree's YAML would compare two
 *                                  trees while configured as one.
 *   PATH                           the child tree's node_modules/.bin, prepended
 *                                  exactly as npm does, so `-- mocha` resolves
 *                                  when the wrapper is invoked directly and not
 *                                  only through `npm test`.
 *
 * PARITY_MONGO_URI and PARITY_MONGO_DATABASE come with them as a convenience
 * for a child that wants the address without parsing NODE_CONFIG. They are
 * informational: NODE_CONFIG is the channel the application reads.
 *
 * @param {Object} info The published address from `start`.
 * @param {string} appRoot The child's working directory.
 * @returns {Object} A complete environment for spawn.
 */
function buildChildEnv(info, appRoot) {
  var env     = {};
  var binDir  = path.join(appRoot, 'node_modules', '.bin');
  var pathKey = 'PATH';
  var keys    = Object.keys(process.env);
  var i;
  var key;

  for (i = 0; i < keys.length; i++) {
    env[keys[i]] = process.env[keys[i]];
    if (keys[i].toUpperCase() === 'PATH') {
      pathKey = keys[i];
    }
  }

  keys = Object.keys(info.env);
  for (i = 0; i < keys.length; i++) {
    key      = keys[i];
    env[key] = info.env[key];
  }

  env[pathKey] = env[pathKey]
    ? binDir + path.delimiter + env[pathKey]
    : binDir;

  if (appRoot !== process.cwd() && !process.env.NODE_CONFIG_DIR) {
    env.NODE_CONFIG_DIR = path.join(appRoot, 'config');
    note('the command runs in ' + appRoot + '; NODE_CONFIG_DIR points at ' +
      env.NODE_CONFIG_DIR + ' so its own configuration is the one that loads.');
  }

  return env;
}

/**
 * Spawns the command and resolves when it exits.
 *
 * `stdio: 'inherit'` hands the child this process's own descriptors, so its
 * output is neither buffered nor reordered - a Mocha report must reach the
 * terminal as it is produced, and it must reach stdout without passing through
 * anything here.
 *
 * @param {Object} options From parseArguments.
 * @param {Object} info The published address.
 * @returns {Promise<{code: (number|null), signal: (string|null)}>}
 * @throws {ToolError} If the command cannot be started.
 */
function spawnCommand(options, info) {
  return new Promise(function (resolve, reject) {
    var child;

    try {
      child = childProcess.spawn(options.command, options.commandArgs, {
        cwd   : options.appRoot,
        env   : buildChildEnv(info, options.appRoot),
        stdio : 'inherit'
      });
    }
    catch (err) {
      reject(new ToolError('could not start `' + describeCommand(options) +
        '`: ' + err.message));
      return;
    }

    state.child = child;

    note('running `' + describeCommand(options) + '` in ' + options.appRoot +
      ' (pid ' + child.pid + ')');

    child.once('error', function (err) {
      var hint = err && err.code === 'ENOENT'
        ? ' The executable was not found; ' +
          path.join(options.appRoot, 'node_modules', '.bin') +
          ' is on its PATH, so check the name and that dependencies are ' +
          'installed in that tree.'
        : '';

      state.child = null;
      reject(new ToolError('could not run `' + describeCommand(options) +
        '`: ' + err.message + hint));
    });

    child.once('exit', function (code, signal) {
      state.childResult = { code: code, signal: signal };
      resolve(state.childResult);
    });
  });
}

/**
 * The command as a reader would type it, for messages.
 *
 * @param {Object} options From parseArguments.
 * @returns {string}
 */
function describeCommand(options) {
  return [options.command].concat(options.commandArgs).join(' ');
}

/**
 * Waits for the child to exit, for at most `timeoutMs`.
 *
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} True if it exited, false if the wait expired.
 */
function waitForChildExit(timeoutMs) {
  return new Promise(function (resolve) {
    var timer;

    if (!state.child || state.childResult) {
      resolve(true);
      return;
    }

    timer = setTimeout(function () {
      resolve(false);
    }, timeoutMs);

    state.child.once('exit', function () {
      clearTimeout(timer);
      resolve(true);
    });
  });
}


// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

/**
 * The exit code for a process killed by a signal.
 *
 * 128 + the signal number, the shell convention, so `echo $?` after an
 * interrupted run reads 130 for SIGINT and 143 for SIGTERM. An unrecognised
 * signal falls back to EXIT_ERROR, never to 0: the requirement is that a
 * signal death exits non-zero, and every branch here does.
 *
 * @param {string} signal
 * @returns {number} A non-zero code.
 */
function signalExitCode(signal) {
  var number = os.constants.signals[signal];

  return typeof number === 'number' ? 128 + number : EXIT_ERROR;
}

/**
 * The child's outcome as an exit code.
 *
 * @param {{code: (number|null), signal: (string|null)}} result
 * @returns {number}
 */
function childExitCode(result) {
  if (result.signal) {
    note('the command was terminated by ' + result.signal + '.');
    return signalExitCode(result.signal);
  }

  if (typeof result.code === 'number') {
    return result.code;
  }

  // Neither a code nor a signal is not a documented outcome of an `exit`
  // event. Reporting a failure is the only safe reading.
  note('ERROR: the command exited without reporting a code or a signal.');
  return EXIT_ERROR;
}

/**
 * Reconciles the child's code with any failure of this harness.
 *
 * The rule, and the reason for it: a non-zero child code is NEVER lowered,
 * because a failing suite must not report success and that is the single worst
 * thing this file could do. A zero IS raised when the harness itself failed - a
 * server that would not stop, a data directory that survived, a fatal error in
 * a handler - because a leak is a real failure and a silent one is worse than a
 * visible one. Teardown succeeding is never itself a reason to exit 0.
 *
 * @param {number} code From childExitCode, or EXIT_ERROR for a harness failure.
 * @returns {number}
 */
function finalExitCode(code) {
  if (code !== EXIT_OK) {
    return code;
  }

  if (state.failed) {
    note('the command succeeded but this harness did not; exiting ' +
      EXIT_ERROR + ' so the failure is not hidden by a passing run.');
    return EXIT_ERROR;
  }

  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Signals, fatal errors, and the listeners that carry them
// ---------------------------------------------------------------------------

/**
 * Handles SIGINT and SIGTERM.
 *
 * The child is signalled FIRST and given a bounded interval to exit, then
 * killed if it did not. That order is the whole point: killing the database
 * from under a running Mocha produces a cascade of connection errors instead of
 * the real reason for the interrupt. The server is stopped afterwards by the
 * ordinary exit path, which the child's exit releases, so there is exactly one
 * teardown no matter how the run ended.
 *
 * A second signal escalates. With a child running it is killed outright; with
 * no child yet - an interrupt during the server's own startup, which on a cold
 * binary cache can be a download - the process exits immediately and the
 * synchronous sweep on `exit` takes the mongod and its data directory with it.
 * Without that escape hatch a caller could not interrupt a stuck start.
 *
 * @param {string} signal 'SIGINT' or 'SIGTERM'.
 * @returns {undefined}
 */
function onSignal(signal) {
  state.interrupted = signal;

  if (state.shuttingDown) {
    if (state.child && !state.childResult) {
      note('a second ' + signal + ' arrived during shutdown; killing the ' +
        'command outright.');
      killChild('SIGKILL');
      return;
    }

    note('a second ' + signal + ' arrived before the server finished ' +
      'starting; exiting now and sweeping synchronously.');
    process.exit(signalExitCode(signal));
    return;
  }

  state.shuttingDown = true;

  if (!state.child || state.childResult) {
    note('received ' + signal + ' with no command running; stopping mongodb.');
    return;
  }

  note('received ' + signal + '; forwarding it to the command before ' +
    'stopping mongodb.');
  killChild(signal);

  waitForChildExit(SHUTDOWN_GRACE_MS).then(function (exited) {
    if (!exited) {
      note('the command did not exit within ' + SHUTDOWN_GRACE_MS + 'ms of ' +
        signal + '; killing it so the database is not left running.');
      killChild('SIGKILL');
    }
  });
}

/**
 * Signals the child, tolerating a race with its own exit.
 *
 * @param {string} signal
 * @returns {undefined}
 */
function killChild(signal) {
  if (!state.child) {
    return;
  }

  try {
    state.child.kill(signal);
  }
  catch (err) {
    // ESRCH means it exited between the check and the signal, which is the
    // outcome that was wanted anyway.
    if (!err || err.code !== 'ESRCH') {
      note('WARNING: could not send ' + signal + ' to the command: ' +
        err.message);
    }
  }
}

/**
 * Handles an uncaught exception or an unhandled rejection in THIS process.
 *
 * Both are defects in the harness, so both are reported with their stack, both
 * bring the child down, and both stop the server - the requirement is that the
 * data directory does not survive a fatal error either. `state.failed` is what
 * makes the exit non-zero even if the child had already succeeded.
 *
 * @param {string} label What happened, for the message.
 * @param {*} err
 * @returns {Promise<undefined>}
 */
async function onFatal(label, err) {
  state.failed = true;

  note('ERROR: ' + label + ': ' + ((err && err.stack) || String(err)));

  if (state.child && !state.childResult) {
    note('bringing the command down before stopping mongodb.');
    killChild('SIGTERM');
    await waitForChildExit(SHUTDOWN_GRACE_MS);
    killChild('SIGKILL');
  }

  await stop();
  removeProcessListeners();
  process.exitCode = EXIT_ERROR;
}

/**
 * Installs the process-level listeners, and only from the CLI.
 *
 * A required module must NOT take over its host's signals - `withMongo`'s
 * `finally` covers the library path, and the synchronous sweep covers a host
 * that exits abruptly. These four belong to a process this file owns.
 *
 * @returns {undefined}
 */
function installProcessListeners() {
  addListener('SIGINT', function () {
    onSignal('SIGINT');
  });
  addListener('SIGTERM', function () {
    onSignal('SIGTERM');
  });
  addListener('uncaughtException', function (err) {
    onFatal('uncaught exception in the harness', err);
  });
  addListener('unhandledRejection', function (reason) {
    onFatal('unhandled rejection in the harness', reason);
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
 * This is not tidiness - it is how the process exits. A registered signal
 * listener holds a libuv handle that keeps the event loop alive, so a run that
 * left its SIGINT listener in place would finish its work and then hang. They
 * are removed once teardown is complete, `process.exitCode` carries the result,
 * and the loop drains on its own - which also lets a pending stderr write on a
 * pipe flush, where `process.exit()` would truncate it.
 *
 * @returns {undefined}
 */
function removeProcessListeners() {
  var i;

  for (i = 0; i < state.listeners.length; i++) {
    process.removeListener(state.listeners[i][0], state.listeners[i][1]);
  }

  state.listeners = [];
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Starts the server, runs the command, and reports the command's outcome.
 *
 * The overlay is read BEFORE the server starts, so a missing or malformed
 * overlay costs no mongod. An interrupt that arrives during startup is honoured
 * here rather than being allowed to spawn a command the caller has already
 * cancelled.
 *
 * @param {Object} options From parseArguments.
 * @returns {Promise<number>} The exit code the child earned.
 */
async function runCommand(options) {
  var overlay = options.overlayPath ? readOverlay(options.overlayPath) : null;
  var info;

  if (overlay) {
    note('overlaying ' + path.resolve(options.overlayPath) + ' under the ' +
      'database address.');
  }

  info = await start({ overlay: overlay });

  if (state.interrupted) {
    note('interrupted before the command started; not running it.');
    return signalExitCode(state.interrupted);
  }

  return childExitCode(await spawnCommand(options, info));
}

/**
 * Prints a failure in the form its kind deserves.
 *
 * A ToolError describes a mistake a reader can act on, so its message stands
 * alone and a stack trace would bury it. Anything else is a defect in this
 * file, and the trace IS the evidence.
 *
 * @param {*} err
 * @returns {undefined}
 */
function reportFailure(err) {
  if (err instanceof ToolError) {
    note('ERROR: ' + err.message);
    if (err.showUsage) {
      writeUsage();
    }
    return;
  }

  note('UNEXPECTED FAILURE: ' + ((err && err.stack) || String(err)));
}

/**
 * Writes the usage text to stderr, unprefixed so it reads as a block.
 *
 * @returns {undefined}
 */
function writeUsage() {
  process.stderr.write(USAGE + '\n');
}

/**
 * The CLI.
 *
 * Sets `process.exitCode` rather than calling `process.exit`, so that a stderr
 * write on a pipe is not truncated and the child's inherited output is already
 * flushed by the time the loop drains.
 *
 * @returns {Promise<undefined>}
 */
async function main() {
  var options;
  var code;

  try {
    options = parseArguments(process.argv.slice(2));
  }
  catch (err) {
    reportFailure(err);
    process.exitCode = EXIT_ERROR;
    return;
  }

  if (options.mode === 'help') {
    writeUsage();
    process.exitCode = EXIT_OK;
    return;
  }

  installProcessListeners();

  try {
    code = await runCommand(options);
  }
  catch (err) {
    reportFailure(err);
    code = EXIT_ERROR;
  }

  await stop();
  removeProcessListeners();

  process.exitCode = finalExitCode(code);
}

// Exported for the sibling harnesses - test/parity/{server,worker,storage,
// seed}.js - and for the ad-hoc validation of this file. Requiring this module
// starts NOTHING: `main` runs only under direct execution, so no server is
// created, no command is spawned and no signal listener is installed.
module.exports = {
  // The lifecycle.
  start      : start,
  stop       : stop,
  uri        : uri,
  withMongo  : withMongo,

  // Building blocks, exported because each has a failure mode worth testing
  // directly rather than through a spawned process.
  parseArguments          : parseArguments,
  deepMerge               : deepMerge,
  isPlainObject           : isPlainObject,
  composeNodeConfig       : composeNodeConfig,
  buildRuntimeConfig      : buildRuntimeConfig,
  parseInheritedNodeConfig: parseInheritedNodeConfig,
  readOverlay             : readOverlay,
  buildChildEnv           : buildChildEnv,
  generateDatabaseName    : generateDatabaseName,
  assertDatabaseName      : assertDatabaseName,
  assertDeclaredDependency: assertDeclaredDependency,
  signalExitCode          : signalExitCode,
  childExitCode           : childExitCode,
  finalExitCode           : finalExitCode,

  // Reference values, so a harness asserts against the same constants this
  // file uses rather than a second copy of them.
  DEFAULT_OVERLAY   : DEFAULT_OVERLAY,
  PERSIST_ON_CHANGE : PERSIST_ON_CHANGE,
  SHUTDOWN_GRACE_MS : SHUTDOWN_GRACE_MS,
  PACKAGE_NAME      : PACKAGE_NAME,
  EXIT_OK           : EXIT_OK,
  EXIT_ERROR        : EXIT_ERROR,
  ToolError         : ToolError,
  USAGE             : USAGE,
  main              : main
};

if (require.main === module) {
  main();
}

