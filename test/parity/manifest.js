#!/usr/bin/env node
'use strict';

// The route manifest generator and comparator - the PRIMARY PARITY GATE.
//
// AAP §0.9.1 binds the BOUNDARIES & PRESERVATION clause on the HTTP surface to
// this one artifact. If this file is wrong, the migration has no evidence that
// the HTTP surface survived. Node core only, CommonJS, no network.
//
// ===========================================================================
// RULES
// ===========================================================================
// `review_rules` returns exactly "No user rules provided." for this project,
// which AAP §0.7 and §0.10.1 independently record. NO rules are invented here
// and their absence is not read as licence to lower the bar: enterprise
// practice governs, and the three commitments of test/parity/ all land on this
// file. The baseline is captured BEFORE anything changes - one tool, two
// worktrees, selected by `--app`. Every parity claim is backed by an
// inspectable artifact - the emitted manifest IS the claim. Nothing is
// normalized away that could be compared exactly - the pre-parse bindings and
// specs are recorded, not just method and path.
//
// The request's own RULES block is binding and is not that document:
//   R-f  Baseline behaviour at 2f8712a is the tie-breaker, which is exactly why
//        this tool must run UNMODIFIED against a tree that does not contain it.
//        That is what `--app` is for, and why every application require is
//        resolved absolutely inside the tree under test.
//   R-d  Behaviour improvements are prohibited, so this tool REPORTS a
//        difference and never smooths one over. It also never reimplements the
//        route table: the FAIL column's width is derived from the SUCCESS
//        strings (lib/util/routeParser.js:615 computes `sizes.fail` from
//        `successStr`), a quirk that is preserved by CAPTURING what `tab`
//        emits rather than by reproducing it.
//
// ===========================================================================
// INVOCATION - the artifact goes to --out, BOTH STREAMS ARE DISCARDED
// ===========================================================================
// "No infrastructure" does not mean no side effects. Parsing the routes
// dynamically requires every controller (lib/util/routeParser.js:266), and
// lib/controllers/users.js executes `require('../util/queues').exports()` at
// module load, which prints the in-memory-queue line on STDOUT. On a baseline
// tree the AWS SDK v2 end-of-support notice also prints on STDERR (only the
// target's config/aws.js suppresses it). Neither is suppressible from here, so
// the gate discards both streams EXPLICITLY and reads the artifact from disk:
//
//   # generate, target tree
//   node test/parity/manifest.js --out /tmp/target-manifest.json \
//     >/dev/null 2>/dev/null
//
//   # generate, baseline worktree (its own `npm ci`, from the baseline lockfile)
//   node test/parity/manifest.js --app /path/to/baseline-2f8712a \
//     --out /tmp/baseline-manifest.json >/dev/null 2>/dev/null
//
//   # THE GATE: per-entry comparison, non-zero exit on any difference
//   node test/parity/manifest.js --compare /tmp/baseline-manifest.json \
//     /tmp/target-manifest.json 2>&1 >/dev/null
//
//   # supporting check: the route-table CLI, all three invocation forms
//   node test/parity/manifest.js --cli-table --out /tmp/cli-table.json \
//     >/dev/null 2>/dev/null
//
// Provenance is written to a SIBLING file, `<out>.provenance.json`, never
// inside the manifest. That is what lets the manifest itself be compared
// byte-for-byte while still satisfying AAP §0.9.3's requirement that tool
// provenance be recorded alongside every artifact: "captured at baseline"
// means captured by TARGET-worktree tooling against a BASELINE install, and
// the sidecar is what makes that checkable.
//
// ===========================================================================
// THE THREE FACTS THAT MAKE A NAIVE IMPLEMENTATION FAIL
// ===========================================================================
// 1. `parseRoutes` MUTATES ITS INPUT, EXHAUSTIVELY. Measured deletions, at the
//    baseline line numbers: `delete route.enable` (:250),
//    `delete validation.language` (:270), `delete route.route` (:273),
//    `delete route.success` (:274), `delete route.fail` (:275),
//    `delete route.ext` (:276), `delete route.reply` (:277), `route.config` ->
//    `route.options` (:280-283), `delete route.options.validate` (:285),
//    `route.options.cors` forced false (:288-290), `delete route.html` (:295),
//    `delete route.redirect` (:299), `delete route.cookie` (:303). The obvious
//    JSON.stringify-the-parsed-routes shortcut reports ZERO MATCHES FOR EVERY
//    DECLARED PATH, and after parsing `options.validate` survives on 0 of 233
//    routes. `route.reply` - the replySpec captured at :260 and deleted at :277
//    - is the projection contract `request.success` applies at :422-424, and
//    this manifest needs it.
// 2. THEREFORE: the declaration modules are required directly, a PRISTINE deep
//    copy is taken BEFORE any parse, and a SECOND throwaway copy is handed to
//    `parse`. The pristine copy supplies every binding and spec; the parsed
//    copy supplies method, path, handler and options.
// 3. `structuredClone` WILL NOT WORK. Route objects hold pre-handler FUNCTIONS
//    (config/routes.js imports them from lib/util/helpers.js) and JOI SCHEMA
//    OBJECTS, and structuredClone throws DataCloneError on a function. The
//    deep copy below recurses into PLAIN OBJECTS AND ARRAYS ONLY and passes
//    everything else - functions, Joi schemas, RegExp - through BY REFERENCE.
//    Nothing in `parseRoutes` mutates a schema or a function, so sharing them
//    is safe; what matters is that each copy owns its own plain-object
//    containers, so a `delete` on one is invisible to the other.
//
// Two further facts govern the require set:
//   - THE LANGUAGE EXPANSION HAS ALREADY HAPPENED. config/routes.js's loop runs
//     at MODULE LOAD, pushing 5 routes for each of the 11
//     config.constants.trinketLangs. The required array already contains all
//     55; it is not re-expanded here.
//   - config/app.config IS NEVER REQUIRED, directly or transitively. It
//     requires ./db, and config/db.js calls connect() at MODULE SCOPE via
//     mongoose.connect, exiting non-zero with no database. The require set is
//     exactly config/constants, config/routes, config/api_routes and
//     lib/util/routeParser. config/constants.js does
//     `module.exports = config.constants = constants`, which is what makes
//     config.constants.trinketLangs available to config/routes.js, so it is
//     required FIRST.
//
// ===========================================================================
// THE 233 RECONCILIATION
// ===========================================================================
//   config/routes.js       57 static declarations + 55 language routes (11 x 5)
//                        = 112 exported objects
//   config/api_routes.js  116 exported objects
//                        --------------------------------------------------
//   173 static declarations + 55 language routes = 228 exported objects
//   + 2  addStaticPages PREPENDS /about and /help (lib/views/static/*.html)
//   + 3  addStaticRoutes APPENDS the cache-prefix directory route,
//        /.well-known/{path*} and the /{path*} catch-all
//   = 233 registered routes
//
// addStaticRoutes contributes only 3 because ALL EIGHT config/default.yaml
// `app.prefixes` keys are empty, so its prefix loop pushes zero. No `.json`
// duplicate contributes either: `ext : true` appears nowhere at this commit,
// so the extension path produces 0 - the extension branch is still handled
// below, and an extension-derived entry is marked, because a manifest that
// silently mis-attributed one would be worse than one that reported it.
//
// ===========================================================================
// WHY THE PASS CONDITION IS PER ENTRY
// ===========================================================================
// Swapping auth between two routes leaves EVERY aggregate unchanged. The
// summary block and the sidecar figures are a SUMMARY, NOT THE GATE; the gate
// is `--compare`, which joins on method + path and compares every recorded
// field of every entry, with auth compared per entry.

var fs           = require('fs');
var path         = require('path');
var childProcess = require('child_process');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Exit codes. EXIT_DIFFERENCE is what makes this a gate: a comparison that
// found a difference must fail a shell pipeline, and a comparator that cannot
// fail is not a gate.
var EXIT_OK         = 0;
var EXIT_DIFFERENCE = 1;
var EXIT_ERROR      = 2;

// The tool's own worktree root, used for the --out default and for recording
// this tool's provenance. Two levels above test/parity/.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

// The default artifact path, resolved against this file so it is the same path
// no matter which directory the tool was invoked from and no matter which tree
// `--app` selects. The artifact always belongs to the tool's worktree; only
// the ANALYSED tree moves.
var DEFAULT_OUT = path.join(__dirname, 'route-manifest.json');

// The server's default authentication, used for routes that declare none.
// `app.js` is read as TEXT to recover it per tree (see readServerAuthDefault)
// rather than being required, because requiring app.js boots the application
// and pulls in config/app.config. These are the fallback values, and they are
// what both trees actually declare: `server.auth.default({ strategy:
// 'session', mode: 'try' })` at app.js:287 on the baseline and app.js:310 on
// the target.
var FALLBACK_DEFAULT_AUTH = { strategy: 'session', mode: 'try' };

// Effective auth modes for a declared strategy and for `auth: false`. A route
// naming a strategy is REQUIRED - hapi's own default when a strategy is given
// without a mode - and `auth: false` disables authentication outright.
var MODE_REQUIRED = 'required';
var MODE_NONE     = 'none';

// The four handler kinds, and no others. An entry that matches none of them is
// a break in this tool's model of the parser, not a route to record silently,
// so HANDLER_UNCLASSIFIED is treated as an operational failure.
var HANDLER_FUNCTION        = 'function';
var HANDLER_INERT_DIRECTORY = 'inert-directory';
var HANDLER_OPTIONS         = 'options.handler';
var HANDLER_FALLBACK        = 'missing-controller-fallback';
var HANDLER_UNCLASSIFIED    = 'unclassified';

// The validation section named in a route's `config.validate` that is NOT a
// schema: `language` is the custom-message map, and lib/util/routeParser.js:270
// deletes it before validating. It is excluded from the recorded key list, and
// excluding it is what makes the total come to 102.
var VALIDATE_LANGUAGE_KEY = 'language';

// The fixed serialization order of an entry's keys. Insertion order is what
// JSON.stringify emits, so building every entry through this list is what
// makes two manifests byte-comparable before the structured comparison runs.
var ENTRY_KEY_ORDER = [
  'method',
  'path',
  'controller',
  'handlerKind',
  'auth',
  'pre',
  'validate',
  'success',
  'fail',
  'reply',
  'cookie',
  'ext',
  'options'
];

// The per-entry fields `--compare` checks. `method` and `path` are the join
// key and are therefore equal by construction; every other recorded field is
// compared, auth included.
var COMPARED_FIELDS = [
  'controller',
  'handlerKind',
  'auth',
  'pre',
  'validate',
  'success',
  'fail',
  'reply',
  'cookie',
  'ext',
  'options'
];

// The keys of a parsed route's `options` that this manifest records. `validate`
// is deliberately absent - it is deleted for every route, and the recorded
// pre-parse `validate` key list is where that evidence lives. `pre`, `auth` and
// `handler` have fields of their own. What is left is the JSON-safe remainder
// that hapi actually applies to the request: `cors`, forced false for every
// route that carries options, and `payload`, which sets maxBytes and the output
// mode on the 11 upload routes. Both are HTTP surface.
var RECORDED_OPTION_KEYS = ['cors', 'payload'];

// A controller name is a bare module name under lib/controllers/. Anything else
// is rejected rather than passed to require, so a malformed declaration can
// never turn into a path traversal.
var CONTROLLER_NAME = /^[A-Za-z0-9_-]+$/;

// The baseline figures this manifest must reproduce, verified independently at
// 2f8712a and re-measured on the target tree. They are emitted into the
// summary for a reviewer, and a mismatch is REPORTED - never corrected -
// because a run that disagrees means the tool is wrong, not that the numbers
// are.
var EXPECTED = {
  routes: 233,
  byMethod: { GET: 137, POST: 63, PUT: 19, DELETE: 13, PATCH: 1 },
  authInherited: 126,
  authSession: 105,
  authDisabled: 2,
  routesWithPre: 161,
  retainedValidate: 0,
  nonFunctionHandlers: 2,
  missingControllerFallback: 3,
  validationKeys: 102,
  declaredRoutes: 228,
  synthesizedRoutes: 5,
  cliTableDataRows: 112
};

// The three routes that answer entirely through the parser's no-controller
// fallback, which returns `request.success(request.params)`. AAP §0.6.6
// preserves that branch verbatim precisely so these three keep answering, and
// recording them by name is what makes their disposition visible in the
// artifact instead of inferred from a count.
var EXPECTED_FALLBACK_ROUTES = [
  'GET /api/trinkets/active',
  'GET /api/trinkets/popular',
  'POST /api/interest'
];

var USAGE = [
  'test/parity/manifest.js - route manifest generator and comparator',
  '',
  'The primary parity gate for the HTTP surface. Writes artifacts to --out and',
  'never to stdout; diagnostics go to stderr.',
  '',
  'MODES',
  '  (default)                        Generate a route manifest.',
  '  --compare <base.json> <tgt.json> Compare two manifests entry by entry.',
  '  --cli-table                      Capture the route-table CLI, all three',
  '                                   invocation forms.',
  '  --help                           This text.',
  '',
  'OPTIONS',
  '  --app <path>   Root of the worktree to analyse. Defaults to this tool\'s',
  '                 own repository root, two levels above test/parity/. Point',
  '                 it at a `git worktree` to capture a baseline with tooling',
  '                 that does not exist at that commit.',
  '  --out <path>   Artifact path. Generation also writes the sibling',
  '                 <out>.provenance.json. In --compare mode the report is',
  '                 written here in addition to stderr. Defaults to',
  '                 test/parity/route-manifest.json inside this tool\'s tree.',
  '',
  'EXIT CODES',
  '  0  success, or a comparison that found no difference',
  '  1  a comparison found a difference, or the three CLI forms diverged',
  '  2  usage or operational failure',
  '',
  'NOTE Both output streams of the analysed application must be discarded by',
  '     the caller: loading the controllers prints the in-memory-queue line on',
  '     stdout, and a baseline tree prints the AWS SDK v2 notice on stderr.',
  ''
].join('\n');

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * Writes a diagnostic line to stderr.
 *
 * Every human-readable byte this tool produces goes to stderr, so that stdout
 * carries nothing at all and the caller's `>/dev/null` is a statement about
 * the application's own output rather than about ours.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  process.stderr.write(String(message) + '\n');
}

/**
 * An operational failure, distinguished from a parity difference.
 *
 * Thrown for a usage error or for a condition that means the tool cannot
 * produce a trustworthy artifact. It exits 2, never 1, so a caller can tell
 * "the gate ran and found a difference" from "the gate could not run".
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
ToolError.prototype = Object.create(Error.prototype);
ToolError.prototype.constructor = ToolError;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parses the command line.
 *
 * NO FLAG HERE MAY BE NAMED `-R` OR `--routes`, and none is. On a baseline tree
 * lib/util/routeParser.js builds its own `argv` through `optimist` from OUR
 * process.argv and aliases `R` to `routes`; on the target tree it reads the
 * same two spellings straight off process.argv. Either way a colliding flag
 * would make the parser emit its route table into our stdout the moment it is
 * required. `--app`, `--out`, `--compare` and `--cli-table` are safe, and that
 * is verified by running with each and confirming no table appears.
 *
 * Output paths are resolved against the ORIGINAL working directory, captured
 * before generation chdirs into the tree under test. Resolving them afterwards
 * would silently retarget a relative `--out` into the analysed worktree.
 *
 * @param {string[]} args process.argv.slice(2)
 * @param {string} originalCwd The working directory at process start.
 * @returns {{mode: string, appRoot: string, out: (string|null),
 *            compare: string[]}}
 * @throws {ToolError} On an unknown flag or a missing/duplicated value.
 */
function parseArguments(args, originalCwd) {
  var options = {
    mode: 'generate',
    appRoot: TOOL_ROOT,
    out: null,
    compare: []
  };
  var sawApp = false;
  var sawOut = false;
  var i;

  function value(flag, index) {
    var next = args[index + 1];

    if (next === undefined || next.indexOf('--') === 0) {
      throw new ToolError(flag + ' requires a value');
    }

    return next;
  }

  for (i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        options.mode = 'help';
        return options;

      case '--app':
        if (sawApp) {
          throw new ToolError('--app given more than once');
        }
        options.appRoot = path.resolve(originalCwd, value('--app', i));
        sawApp = true;
        i += 1;
        break;

      case '--out':
        if (sawOut) {
          throw new ToolError('--out given more than once');
        }
        options.out = path.resolve(originalCwd, value('--out', i));
        sawOut = true;
        i += 1;
        break;

      case '--compare':
        if (options.mode === 'cli-table') {
          throw new ToolError('--compare and --cli-table are mutually exclusive');
        }
        // Two positional values, and exactly two. Reading them here rather
        // than as loose positionals keeps the baseline-then-target order
        // explicit, which is what makes the report's "only in baseline" and
        // "only in target" sections mean what they say.
        options.compare = [
          path.resolve(originalCwd, value('--compare', i)),
          path.resolve(originalCwd, value('--compare', i + 1))
        ];
        options.mode = 'compare';
        i += 2;
        break;

      case '--cli-table':
        if (options.mode === 'compare') {
          throw new ToolError('--compare and --cli-table are mutually exclusive');
        }
        options.mode = 'cli-table';
        break;

      default:
        throw new ToolError('unknown argument: ' + args[i]);
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Deep copy
// ---------------------------------------------------------------------------

/**
 * True for an object literal - the only container this copy recurses into,
 * alongside arrays.
 *
 * A Joi schema, a RegExp, a Date and a Buffer all fail this test and are
 * therefore shared by reference, which is both correct and required: `parse`
 * never mutates one, and cloning a Joi schema by walking its own properties
 * would produce an object that is no longer a schema.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  var prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Deep-copies plain objects and arrays, sharing everything else by reference.
 *
 * This is the mechanism that survives `parseRoutes`. `structuredClone` cannot
 * be used: route declarations hold pre-handler FUNCTIONS and Joi SCHEMA
 * OBJECTS, and structuredClone throws DataCloneError on a function. What
 * matters for correctness is only that each copy owns its own plain-object and
 * array containers, so that the parser's thirteen `delete` statements land on
 * the throwaway copy and are invisible to the pristine one.
 *
 * Own enumerable string keys are copied in their own order, so a copy
 * serializes identically to its original.
 *
 * @param {*} value
 * @returns {*}
 */
function deepCopy(value) {
  var copy;
  var keys;
  var i;

  if (Array.isArray(value)) {
    copy = new Array(value.length);
    for (i = 0; i < value.length; i++) {
      copy[i] = deepCopy(value[i]);
    }
    return copy;
  }

  if (isPlainObject(value)) {
    copy = {};
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i++) {
      copy[keys[i]] = deepCopy(value[keys[i]]);
    }
    return copy;
  }

  return value;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Reduces a captured declaration fragment to a JSON-safe value.
 *
 * Measured over both trees, every fragment this manifest captures - `success`,
 * `fail`, `reply`, `html`, `redirect`, `cookie`, `cors` and `payload` - is
 * already JSON-safe, with zero exceptions across all 228 declarations. This
 * guard exists so that a declaration which later grows a function or a schema
 * in one of those positions is RECORDED AS SUCH rather than silently dropped
 * by JSON.stringify, which would turn a real HTTP-surface change into an
 * invisible one.
 *
 * Key order is preserved verbatim and deliberately NOT sorted. For a `reply`
 * spec the key order IS the projection order that ObjectUtils.pull applies at
 * lib/util/routeParser.js:422-424, so it reaches the client; sorting it would
 * normalize away something that can be compared exactly.
 *
 * @param {*} value
 * @returns {*} A JSON-safe mirror of `value`, with non-serializable leaves
 *   replaced by a stable type token such as '<function>'.
 */
function jsonSafe(value) {
  var out;
  var keys;
  var i;

  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'function') {
    return '<function>';
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    // A non-finite number serializes as null, which would read as "absent".
    // Recording it as a token keeps the distinction.
    return isFinite(value) ? value : '<number:' + String(value) + '>';
  }

  if (typeof value !== 'object') {
    // Symbol, bigint. Neither occurs in a route declaration; recorded rather
    // than dropped.
    return '<' + typeof value + '>';
  }

  if (Array.isArray(value)) {
    out = [];
    for (i = 0; i < value.length; i++) {
      out.push(jsonSafe(value[i]));
    }
    return out;
  }

  if (!isPlainObject(value)) {
    // A Joi schema, a RegExp, a Date. Identified by constructor name so the
    // token is stable and a change of kind still shows up as a difference.
    return '<' + ((value.constructor && value.constructor.name) || 'object') + '>';
  }

  out  = {};
  keys = Object.keys(value);
  for (i = 0; i < keys.length; i++) {
    out[keys[i]] = jsonSafe(value[keys[i]]);
  }

  return out;
}

/**
 * Serializes an artifact deterministically.
 *
 * JSON.stringify emits own enumerable string keys in insertion order, and
 * every object in an artifact is built through a fixed key list, so a fixed
 * two-space indent is all that is needed to make a byte diff of two manifests
 * meaningful before the structured comparison runs. A trailing newline is
 * added so the file is a well-formed text file and `diff` reports no missing
 * newline at EOF.
 *
 * @param {*} value
 * @returns {string}
 */
function serialize(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Canonical form of one field's value, for equality testing.
 *
 * Comparison is order-sensitive, which is the faithful choice: the recorded
 * fragments preserve declaration order, and for a `reply` spec that order is
 * observable in the response.
 *
 * @param {*} value
 * @returns {string}
 */
function canonical(value) {
  return JSON.stringify(value === undefined ? null : value);
}


// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/**
 * Writes a text artifact, creating its directory if needed.
 *
 * @param {string} target Absolute path.
 * @param {string} text
 * @returns {undefined}
 * @throws {ToolError} If the directory cannot be created or the file written.
 */
function writeArtifact(target, text) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  catch (err) {
    throw new ToolError('cannot create directory for ' + target + ': ' + err.message);
  }

  try {
    fs.writeFileSync(target, text, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot write ' + target + ': ' + err.message);
  }
}

/**
 * Reads and parses a manifest written by this tool.
 *
 * @param {string} target Absolute path.
 * @returns {Object}
 * @throws {ToolError} If the file is missing, unreadable, not JSON, or not a
 *   manifest of the expected shape.
 */
function readManifest(target) {
  var text;
  var parsedManifest;

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot read manifest ' + target + ': ' + err.message);
  }

  try {
    parsedManifest = JSON.parse(text);
  }
  catch (err) {
    throw new ToolError('manifest ' + target + ' is not valid JSON: ' + err.message);
  }

  if (!parsedManifest || !Array.isArray(parsedManifest.entries)) {
    throw new ToolError('manifest ' + target + ' has no `entries` array');
  }

  return parsedManifest;
}

/**
 * The HEAD commit of the git worktree containing `directory`, or null.
 *
 * A missing git, a directory outside a repository or any non-zero exit yields
 * null rather than a throw: provenance is evidence about a run, and a run that
 * produced a correct manifest must not be failed for being unable to name its
 * own commit. `execFileSync` is used with an argument array, so nothing here
 * goes through a shell.
 *
 * @param {string} directory
 * @returns {(string|null)}
 */
function gitHead(directory) {
  var output;

  try {
    output = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
  }
  catch (err) {
    return null;
  }

  output = String(output).trim();

  return output || null;
}

// ---------------------------------------------------------------------------
// The tree under test
// ---------------------------------------------------------------------------

/**
 * Verifies that `appRoot` looks like a checkout of this application.
 *
 * Checked before anything is required, because a wrong `--app` otherwise
 * surfaces as a bare MODULE_NOT_FOUND from deep inside a require chain, and on
 * the two-worktree gate the most likely mistake is exactly a mistyped path.
 *
 * @param {string} appRoot Absolute path.
 * @returns {undefined}
 * @throws {ToolError} If a required file is absent.
 */
function assertAppRoot(appRoot) {
  var required = [
    'app.js',
    'config/constants.js',
    'config/routes.js',
    'config/api_routes.js',
    'lib/util/routeParser.js'
  ];
  var i;
  var candidate;

  if (!fs.existsSync(appRoot) || !fs.statSync(appRoot).isDirectory()) {
    throw new ToolError('--app is not a directory: ' + appRoot);
  }

  for (i = 0; i < required.length; i++) {
    candidate = path.join(appRoot, required[i]);
    if (!fs.existsSync(candidate)) {
      throw new ToolError(
        '--app does not look like a trinket checkout: missing ' + required[i] +
        ' under ' + appRoot
      );
    }
  }
}

/**
 * Deep-merges `overlay` over `base`, returning a new plain object.
 *
 * Used only for NODE_CONFIG composition, where the overlay must win: the point
 * of the overlay is to force a value the caller must not be able to defeat.
 *
 * @param {Object} base
 * @param {Object} overlay
 * @returns {Object}
 */
function deepMerge(base, overlay) {
  var out = {};
  var keys;
  var i;
  var key;

  keys = Object.keys(isPlainObject(base) ? base : {});
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

/**
 * The NODE_CONFIG overlay every mode applies, as a JSON string.
 *
 * `db.redis.enabled: false` IS NOT OPTIONAL. lib/util/routeParser.js
 * dynamically requires EVERY controller, and lib/controllers/users.js executes
 * `require('../util/queues').exports()` at module load. With `db.redis.enabled`
 * undefined - which is the case on BOTH trees' committed configuration, since
 * no committed YAML declares the key - lib/util/queues.js takes the Bull branch
 * and dials localhost:6379, risking a hang or an unhandled ECONNREFUSED.
 * Setting it false selects the in-memory branch. AAP §0.9.1 specifies exactly
 * this overlay, and it is passed identically to both trees so no configuration
 * file is edited to achieve it.
 *
 * An inherited NODE_CONFIG is honoured underneath the overlay. An inherited
 * value that is not valid JSON is a hard failure rather than something to
 * discard silently: node-config would reject it anyway, and quietly dropping a
 * caller's configuration would make a baseline and a target run differ for a
 * reason absent from the provenance.
 *
 * @param {(string|undefined)} inherited process.env.NODE_CONFIG
 * @returns {string} A JSON string.
 * @throws {ToolError} If `inherited` is present but not valid JSON.
 */
function composeNodeConfig(inherited) {
  var base = {};
  var overlay = { db: { redis: { enabled: false } } };

  if (inherited !== undefined && String(inherited).trim() !== '') {
    try {
      base = JSON.parse(inherited);
    }
    catch (err) {
      throw new ToolError(
        'inherited NODE_CONFIG is not valid JSON, refusing to discard it: ' +
        err.message
      );
    }

    if (!isPlainObject(base)) {
      throw new ToolError('inherited NODE_CONFIG is not a JSON object');
    }
  }

  return JSON.stringify(deepMerge(base, overlay));
}

/**
 * Prepares the process for the FIRST application require.
 *
 * Three settings, all of which must precede it:
 *   NODE_CONFIG_DIR  The npm `config` package resolves its directory from
 *                    process.cwd(), so without this a baseline run would read
 *                    the TARGET tree's YAML and every value derived from
 *                    configuration - the cache prefix in a static route path,
 *                    the static-pages directory - would come from the wrong
 *                    tree.
 *   process.chdir    Same reason, and it additionally makes the analysed tree
 *                    the resolution root for anything the application reads
 *                    relative to the working directory.
 *   NODE_CONFIG      The redis overlay described in composeNodeConfig.
 * NODE_ENV is set to 'test' unless the caller overrode it, matching AAP
 * §0.9.1's gate command, and whatever value results is recorded in the
 * provenance sidecar and passed identically to both trees.
 *
 * @param {string} appRoot Absolute path, already validated.
 * @returns {{nodeEnv: string, nodeConfig: string, nodeConfigDir: string}}
 * @throws {ToolError} If the working directory cannot be changed.
 */
function prepareEnvironment(appRoot) {
  var nodeConfig = composeNodeConfig(process.env.NODE_CONFIG);
  var nodeConfigDir = path.join(appRoot, 'config');

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  process.env.NODE_CONFIG_DIR = nodeConfigDir;
  process.env.NODE_CONFIG     = nodeConfig;

  try {
    process.chdir(appRoot);
  }
  catch (err) {
    throw new ToolError('cannot chdir to ' + appRoot + ': ' + err.message);
  }

  return {
    nodeEnv: process.env.NODE_ENV,
    nodeConfig: nodeConfig,
    nodeConfigDir: nodeConfigDir
  };
}

/**
 * Requires one module from the tree under test.
 *
 * EVERY application require goes through here, resolved ABSOLUTELY inside
 * `appRoot`. Node resolves `require` relative to the requiring FILE, so a
 * relative '../../config/routes' would always load the TARGET tree even while
 * analysing the baseline - the single bug that would make the whole two-worktree
 * model meaningless, because both manifests would then describe the same tree
 * and the gate would pass unconditionally. Resolving inside `appRoot` also
 * means `joi`, `config`, `tab` and `underscore` resolve from
 * <appRoot>/node_modules, which is required: the two worktrees have different
 * dependency graphs and are independently installed.
 *
 * @param {string} appRoot Absolute path.
 * @param {string} relative Repository-relative module path.
 * @returns {*} The module's exports.
 * @throws {ToolError} If the module cannot be loaded.
 */
function requireFromApp(appRoot, relative) {
  var target = path.resolve(appRoot, relative);

  try {
    return require(target);
  }
  catch (err) {
    throw new ToolError('cannot load ' + relative + ' from ' + appRoot + ': ' +
      (err && err.message ? err.message : String(err)));
  }
}

/**
 * Recovers the server's default authentication by READING app.js AS TEXT.
 *
 * app.js declares `server.auth.default({ strategy: 'session', mode: 'try' })`,
 * and that single call is what 126 of the 233 routes inherit. It is read
 * rather than required because requiring app.js boots the application and
 * pulls in config/app.config, which connects to MongoDB at module scope.
 *
 * Reading it per tree is deliberate rather than convenient: if a tree changes
 * the default, every inherited entry's effective auth changes with it, and
 * `--compare` then reports 126 differences - which is the correct outcome for
 * a change of that size, and is exactly what a hard-coded constant would have
 * concealed.
 *
 * @param {string} appRoot Absolute path.
 * @returns {{strategy: (string|null), mode: string, source: string}}
 */
function readServerAuthDefault(appRoot) {
  var target = path.join(appRoot, 'app.js');
  var text;
  var call;
  var strategy;
  var mode;

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    note('WARNING: cannot read ' + target + ' (' + err.message + '); using the ' +
      'documented default auth ' + JSON.stringify(FALLBACK_DEFAULT_AUTH));
    return {
      strategy: FALLBACK_DEFAULT_AUTH.strategy,
      mode: FALLBACK_DEFAULT_AUTH.mode,
      source: 'fallback-constant'
    };
  }

  call = /server\.auth\.default\s*\(\s*\{([^}]*)\}\s*\)/.exec(text);

  if (call) {
    strategy = /strategy\s*:\s*(?:'([^']*)'|"([^"]*)")/.exec(call[1]);
    mode     = /mode\s*:\s*(?:'([^']*)'|"([^"]*)")/.exec(call[1]);
  }

  if (!call || !strategy || !mode) {
    note('WARNING: could not read server.auth.default from ' + target +
      '; using the documented default auth ' +
      JSON.stringify(FALLBACK_DEFAULT_AUTH));
    return {
      strategy: FALLBACK_DEFAULT_AUTH.strategy,
      mode: FALLBACK_DEFAULT_AUTH.mode,
      source: 'fallback-constant'
    };
  }

  return {
    strategy: strategy[1] !== undefined ? strategy[1] : strategy[2],
    mode: mode[1] !== undefined ? mode[1] : mode[2],
    source: 'app.js'
  };
}

/**
 * Loads the declaration modules and the parser, and parses a THROWAWAY copy.
 *
 * The require order is fixed and load-bearing. config/constants.js does
 * `module.exports = config.constants = constants`, which is what makes
 * `config.constants.trinketLangs` available to config/routes.js, whose
 * language-expansion loop runs at MODULE LOAD and pushes 5 routes for each of
 * the 11 languages. Requiring routes first would therefore fail or expand
 * nothing. config/app.config is never required, directly or transitively.
 *
 * @param {string} appRoot Absolute path.
 * @returns {{pristine: Object[], parsed: Object[], declaredCount: number,
 *            routesCount: number, apiRoutesCount: number}}
 * @throws {ToolError} If a module cannot be loaded or the parse fails.
 */
function loadRoutes(appRoot) {
  var pageRoutes;
  var apiRoutes;
  var routeParser;
  var declared;
  var pristine;
  var throwaway;
  var parsed;

  // FIRST. See above.
  requireFromApp(appRoot, 'config/constants');

  pageRoutes  = requireFromApp(appRoot, 'config/routes');
  apiRoutes   = requireFromApp(appRoot, 'config/api_routes');
  routeParser = requireFromApp(appRoot, 'lib/util/routeParser');

  if (!Array.isArray(pageRoutes) || !Array.isArray(apiRoutes)) {
    throw new ToolError('config/routes and config/api_routes must both export arrays');
  }

  if (!routeParser || typeof routeParser.parse !== 'function') {
    throw new ToolError('lib/util/routeParser does not export parse()');
  }

  // The EXACT concatenation config/app.config.js:23 applies -
  // `routeParser.parse(api_routes.concat(routes))` - reproduced here without
  // requiring that module. app.config.js:1-6 requires config, constants,
  // routes, api_routes and routeParser in that order and then db at :7; this
  // tool takes the first five and stops, which is precisely why no database is
  // needed. The order of the two halves decides only the order of entries
  // inside the parsed array, and every entry is re-sorted by method and path
  // before serialization, but it is matched anyway so that anything
  // order-sensitive in the parser is exercised the way the application
  // exercises it.
  declared  = apiRoutes.concat(pageRoutes);
  pristine  = deepCopy(declared);
  throwaway = deepCopy(declared);

  try {
    parsed = routeParser.parse(throwaway);
  }
  catch (err) {
    throw new ToolError('routeParser.parse failed: ' +
      (err && err.message ? err.message : String(err)));
  }

  if (!Array.isArray(parsed)) {
    throw new ToolError('routeParser.parse did not return an array');
  }

  return {
    pristine: pristine,
    parsed: parsed,
    declaredCount: declared.length,
    routesCount: pageRoutes.length,
    apiRoutesCount: apiRoutes.length
  };
}


// ---------------------------------------------------------------------------
// Per-entry extraction
// ---------------------------------------------------------------------------

/**
 * The join key. Method and path together identify a route uniquely - measured
 * over both trees, 0 of the 233 registered routes collide.
 *
 * @param {string} method
 * @param {string} routePath
 * @returns {string}
 */
function routeKey(method, routePath) {
  return String(method) + ' ' + String(routePath);
}

/**
 * Indexes the pristine declarations by method + path.
 *
 * The key is derived the same way the parser derives it: `route.route` split on
 * whitespace, with token 0 the method and token 1 the path
 * (lib/util/routeParser.js:252 and :306-307). Splitting it any other way would
 * produce a key that cannot join.
 *
 * @param {Object[]} pristine
 * @returns {{index: Object, duplicates: string[]}}
 */
function indexDeclarations(pristine) {
  var index = {};
  var duplicates = [];
  var i;
  var info;
  var key;

  for (i = 0; i < pristine.length; i++) {
    if (typeof pristine[i].route !== 'string') {
      // Every one of the 228 declarations carries a `route` string; a
      // declaration without one could never have been parsed, since :252
      // dereferences it unconditionally.
      continue;
    }

    info = pristine[i].route.split(/\s+/);
    key  = routeKey(info[0], info[1]);

    if (Object.prototype.hasOwnProperty.call(index, key)) {
      duplicates.push(key);
      continue;
    }

    index[key] = pristine[i];
  }

  return { index: index, duplicates: duplicates };
}

/**
 * The controller binding string, e.g. 'trinket.getById'.
 *
 * The third whitespace-separated token of `route.route`, split with the same
 * `split(/\s+/)` the parser uses at lib/util/routeParser.js:252. Null for the
 * 5 synthesized routes, which have no declaration at all.
 *
 * @param {(Object|null)} declaration A pristine declaration, or null.
 * @returns {(string|null)}
 */
function controllerBinding(declaration) {
  var info;

  if (!declaration || typeof declaration.route !== 'string') {
    return null;
  }

  info = declaration.route.split(/\s+/);

  return info[2] === undefined || info[2] === '' ? null : info[2];
}

/**
 * The success spec AFTER the parser's own hoists.
 *
 * The parser starts from `route.success || {}` (:259) and then moves
 * `route.html` onto `success.html` (:293-295) and `route.redirect` onto
 * `success.redirect` (:297-299). Applying the same hoists here is what makes
 * the recorded value reflect WHAT THE HANDLER WILL ACTUALLY USE rather than
 * what the declaration happened to spell, and it is why a route declaring
 * `html` and a route declaring `success.html` compare equal - which they
 * should, because they behave identically.
 *
 * `success.html` is normally a template string but is an object carrying a
 * `redirect` on one route, and both forms are recorded verbatim because the
 * handler branches on exactly that difference at :449-466.
 *
 * @param {(Object|null)} declaration
 * @returns {Object} A JSON-safe spec, `{}` when the declaration has none.
 */
function successSpec(declaration) {
  var success;

  if (!declaration) {
    return {};
  }

  success = isPlainObject(declaration.success) ? deepCopy(declaration.success) : {};

  if (declaration.html !== undefined) {
    success.html = declaration.html;
  }

  if (declaration.redirect !== undefined) {
    success.redirect = declaration.redirect;
  }

  return jsonSafe(success);
}

/**
 * The fail spec, `route.fail || {}` (lib/util/routeParser.js:261).
 *
 * No hoist applies to it. Measured keys across both trees: `redirect` and
 * `html`, and nothing else.
 *
 * @param {(Object|null)} declaration
 * @returns {Object}
 */
function failSpec(declaration) {
  if (!declaration || !isPlainObject(declaration.fail)) {
    return {};
  }

  return jsonSafe(declaration.fail);
}

/**
 * The replySpec, recorded verbatim.
 *
 * `route.reply` is captured at lib/util/routeParser.js:260 and DELETED at :277
 * - a mutation the AAP's own list omits - and it is the projection contract
 * `request.success` applies at :422-424 through ObjectUtils.pull. Its VALUES
 * are semantic there, not decorative: `1` or `true` copies the source key, a
 * STRING renames it, an ARRAY projects each element through its `[0]` spec and
 * an OBJECT nests. Reducing it to key names would therefore discard the
 * renames and the nesting, so the whole spec is recorded, with its key order
 * intact because that order is the order of the keys in the response.
 *
 * @param {(Object|null)} declaration
 * @returns {(Object|null)} Null when the declaration carries no reply spec,
 *   which is 223 of the 228.
 */
function replySpec(declaration) {
  if (!declaration || declaration.reply === undefined) {
    return null;
  }

  return jsonSafe(declaration.reply);
}

/**
 * Whether the declaration armed the cookie patch.
 *
 * `route.cookie` sets a local flag and is DELETED at lib/util/routeParser.js:303;
 * the flag makes the handler set `request.cookie = true`, which is the single
 * condition app.js tests before reaching into hapi's private response state to
 * append the `Expires` horizon and, in secure mode, `SameSite=None; Secure`.
 * A route silently losing this is a cookie-lifetime change with no error, so
 * it is recorded per route. Measured: 6 declarations, all boolean true.
 *
 * @param {(Object|null)} declaration
 * @returns {boolean}
 */
function cookieFlag(declaration) {
  return !!(declaration && declaration.cookie);
}

/**
 * Whether the declaration requested the `.json` duplicate.
 *
 * `route.ext` is captured at lib/util/routeParser.js:258 and deleted at :276.
 * When truthy the parser pushes a SECOND route whose path gains '.json'
 * (:598-605). It appears nowhere at this commit, so the count is 0 on both
 * trees - recorded because it determines route MULTIPLICITY, which is the one
 * thing a route manifest exists to pin down, and because a declaration that
 * gained it would otherwise show up only as a mysterious extra entry.
 *
 * @param {(Object|null)} declaration
 * @returns {boolean}
 */
function extFlag(declaration) {
  return !!(declaration && declaration.ext);
}

/**
 * The pre-parse validation section names, `language` excluded.
 *
 * `config.validate` is moved onto `options` (:280-283) and then DELETED
 * outright (:285) for every route, so the parsed route cannot answer this
 * question at all - the pristine copy is the only source. Sorted, so the value
 * is order-independent: a reordered declaration is not an HTTP-surface change.
 *
 * `language` is excluded because it is the custom-message map, not a schema,
 * and the parser deletes it separately at :270. Excluding it is what makes the
 * total across all routes come to exactly 102 - 75 payload, 26 query, 1 params.
 *
 * The SCHEMAS themselves are deliberately not described here. One of the 102
 * sections is a Joi schema object rather than a plain object, so any field
 * enumeration would be structurally heterogeneous, and schema-for-schema
 * accept/reject parity is owned by test/parity/joi-matrix.js (AAP §0.6.2),
 * which compares real responses rather than descriptions.
 *
 * @param {(Object|null)} declaration
 * @returns {string[]}
 */
function validationKeys(declaration) {
  var validate;

  if (!declaration || !isPlainObject(declaration.config)) {
    return [];
  }

  validate = declaration.config.validate;

  if (!isPlainObject(validate)) {
    return [];
  }

  return Object.keys(validate)
    .filter(function (key) { return key !== VALIDATE_LANGUAGE_KEY; })
    .sort();
}

/**
 * Descriptors for a route's pre-handlers - descriptors, NOT the functions.
 *
 * Read from the PRISTINE copy, because `convertPreHandlers` rewrites every
 * entry into `{ method: <function>, assign }`: after the parse, a string form
 * and a function form are indistinguishable.
 *
 * Four kinds, exactly as declared:
 *   'string'               'course(params.courseId)' - dispatched through
 *                          server.methods by the parser's string dispatcher,
 *                          with `assign` inferred from the leading word.
 *   'object-with-string'   { method: 'isAdmin(user)', assign: 'admin' }
 *   'object-with-function' { method: helpers.lowerUserFields, assign: '...' }
 *   'function'             a bare helper reference, which carries no `assign`.
 * Measured over both trees: 148 object-with-function, 139 string, 1 function,
 * 0 object-with-string. The last is still classified, because a declaration
 * may use it and a manifest that could not describe it would be silently
 * incomplete.
 *
 * A FUNCTION'S IDENTITY IS DELIBERATELY NOT RECORDED. Every pre-handler
 * function in this repository reports an empty or property-inferred `.name`,
 * so a name carries no information; and a source digest would differ between
 * the two trees for all 149 function-form entries, because the conversion of
 * lib/util/helpers.js to the hapi lifecycle contract is the very change this
 * gate is supposed to see THROUGH. What is stable and what actually belongs to
 * the HTTP surface is the BINDING SHAPE - how many pre-handlers, in what order,
 * of what kind, assigning to which names - and that is what is recorded. The
 * order of the list is the declaration order, which is the execution order.
 *
 * @param {(Object|null)} declaration
 * @returns {Array<{kind: string, method: (string|null), assign: (string|null)}>}
 */
function preDescriptors(declaration) {
  var pre;

  if (!declaration || !isPlainObject(declaration.config)) {
    return [];
  }

  pre = declaration.config.pre;

  if (!Array.isArray(pre)) {
    return [];
  }

  return pre.map(function (entry) {
    var match;

    if (typeof entry === 'string') {
      // The parser infers the assign name from the leading word of the string
      // (:134-135); reproduced here so the recorded `assign` is the one hapi
      // will actually use rather than a null that reads as "none".
      match = entry.match(/^(\w+)/);
      return {
        kind: 'string',
        method: entry,
        assign: match ? match[1] : null
      };
    }

    if (typeof entry === 'function') {
      return { kind: 'function', method: null, assign: null };
    }

    if (isPlainObject(entry) && typeof entry.method === 'function') {
      return {
        kind: 'object-with-function',
        method: null,
        assign: entry.assign === undefined ? null : String(entry.assign)
      };
    }

    if (isPlainObject(entry) && typeof entry.method === 'string') {
      return {
        kind: 'object-with-string',
        method: entry.method,
        assign: entry.assign === undefined ? null : String(entry.assign)
      };
    }

    // Anything else is a shape the parser would pass through untouched
    // (:179-181). Recorded with its type so it is visible rather than dropped.
    return {
      kind: 'unrecognized:' + (entry === null ? 'null' : typeof entry),
      method: null,
      assign: null
    };
  });
}

/**
 * The recorded, JSON-safe remainder of a parsed route's `options`.
 *
 * `validate` is excluded - it is deleted for every route, and the pre-parse key
 * list carries that evidence - as are `pre`, `auth` and `handler`, which have
 * fields of their own. What remains is what hapi applies to the request:
 * `cors`, which the parser forces to false for every route that carries
 * options (:288-290), and `payload`, which sets maxBytes and the output mode on
 * the 11 upload routes. Both are HTTP surface: a lost `payload.maxBytes` turns
 * a 10MB upload route into hapi's 1MB default and starts rejecting requests
 * that used to succeed.
 *
 * @param {Object} route A parsed route.
 * @returns {Object} `{}` for the 20 routes that carry no options at all.
 */
function recordedOptions(route) {
  var out = {};
  var i;
  var key;

  if (!route.options) {
    return out;
  }

  for (i = 0; i < RECORDED_OPTION_KEYS.length; i++) {
    key = RECORDED_OPTION_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(route.options, key)) {
      out[key] = jsonSafe(route.options[key]);
    }
  }

  return out;
}

/**
 * The EFFECTIVE authentication for a route, not the literal declaration.
 *
 * `options.auth` survives the parse, so it is read from the parsed route, which
 * is what hapi itself sees:
 *   absent      -> the server default, read out of app.js per tree. 126 routes.
 *   false       -> { strategy: null, mode: 'none' }. 2 routes.
 *   a string    -> { strategy: <it>, mode: 'required' }, hapi's default mode
 *                  when a strategy is named without one. 105 routes, all
 *                  'session'.
 *   an object   -> its own strategy/strategies and mode, defaulting the mode to
 *                  'required'. 0 routes at this commit, handled so a route that
 *                  adopts the object form is described rather than mislabelled.
 *
 * `declared` records the raw value and `inherited` says whether the effective
 * value came from the server default, which is what lets a reviewer see at a
 * glance which routes are carrying an explicit decision. The two together are
 * unambiguous where `declared` alone would not be: `auth: false` and no `auth`
 * at all would otherwise both have to be written as a falsy `declared`.
 *
 * @param {Object} route A parsed route.
 * @param {{strategy: (string|null), mode: string}} defaultAuth
 * @returns {{declared: *, inherited: boolean, strategy: (string|null),
 *            mode: string}}
 */
function effectiveAuth(route, defaultAuth) {
  var declared;
  var strategy;

  if (!route.options || !Object.prototype.hasOwnProperty.call(route.options, 'auth')) {
    return {
      declared: null,
      inherited: true,
      strategy: defaultAuth.strategy,
      mode: defaultAuth.mode
    };
  }

  declared = route.options.auth;

  if (declared === false) {
    return { declared: false, inherited: false, strategy: null, mode: MODE_NONE };
  }

  if (typeof declared === 'string') {
    return {
      declared: declared,
      inherited: false,
      strategy: declared,
      mode: MODE_REQUIRED
    };
  }

  if (isPlainObject(declared)) {
    if (typeof declared.strategy === 'string') {
      strategy = declared.strategy;
    }
    else if (Array.isArray(declared.strategies)) {
      // Recorded as a joined list so the value is a comparable scalar while
      // still naming every strategy.
      strategy = declared.strategies.join(',');
    }
    else {
      strategy = null;
    }

    return {
      declared: jsonSafe(declared),
      inherited: false,
      strategy: strategy,
      mode: typeof declared.mode === 'string' ? declared.mode : MODE_REQUIRED
    };
  }

  // `auth: true` and any other scalar. hapi would take the default strategy in
  // required mode; recorded with the raw declaration so the oddity is visible.
  return {
    declared: jsonSafe(declared),
    inherited: false,
    strategy: defaultAuth.strategy,
    mode: MODE_REQUIRED
  };
}


/**
 * Whether `controller.method` names a function that does not exist.
 *
 * The parser does `require('../controllers/' + controller)[handlerName]` at
 * lib/util/routeParser.js:266 and leaves `handler` undefined when the module
 * has no such export, which sends the route down the `else` branch at
 * :574-576 - `return request.success(request.params)`.
 *
 * The controller module is resolved ABSOLUTELY inside the tree under test, so
 * it is the same module instance the parser already required and the lookup
 * costs a cache hit. The name is validated against a bare-identifier pattern
 * first, so a malformed declaration can never become a path traversal.
 *
 * @param {string} appRoot Absolute path.
 * @param {(string|null)} binding e.g. 'trinket.mostActive'.
 * @returns {boolean} True when the binding names a method that is not a
 *   function on its controller.
 */
function bindsMissingController(appRoot, binding) {
  var parts;
  var controllerModule;

  if (!binding) {
    return false;
  }

  parts = binding.split('.');

  if (parts.length < 2 || !CONTROLLER_NAME.test(parts[0]) || !parts[1]) {
    // Not a `controller.method` binding at all. The parser would treat a
    // single token as a controller with an undefined handler name and take the
    // fallback branch, so this reports true - the fallback IS what answers.
    return !!parts[0];
  }

  try {
    controllerModule = require(path.resolve(appRoot, 'lib/controllers', parts[0]));
  }
  catch (err) {
    // The parser dereferences the same require unconditionally, so a module
    // that cannot load would already have failed the parse. Reaching here
    // means something changed underneath us: reported, never swallowed.
    throw new ToolError('cannot load controller ' + parts[0] + ' from ' +
      appRoot + ': ' + (err && err.message ? err.message : String(err)));
  }

  return typeof controllerModule[parts[1]] !== 'function';
}

/**
 * Classifies a route's handler into one of exactly four kinds.
 *
 * THE ORDER OF THESE TESTS IS LOAD-BEARING. The parser assigns its wrapper to
 * `route.handler` for EVERY declared route including the three whose controller
 * method does not exist, so `typeof route.handler === 'function'` is true for
 * them too; testing for the plain function kind first would label all three
 * 'function' and erase the very disposition this field exists to publish.
 *
 *   'inert-directory'             `route.handler` is an OBJECT carrying a
 *                                 `directory` key - the cache-prefix route and
 *                                 the /{path*} catch-all, and precisely the 2
 *                                 non-function handlers. Note that
 *                                 /.well-known/{path*} is a FUNCTION handler,
 *                                 not a directory, and lands under 'function'.
 *   'options.handler'             `route.options` carries a function handler -
 *                                 the 2 synthesized static pages /about and
 *                                 /help from addStaticPages, which have no
 *                                 top-level `handler` at all.
 *   'missing-controller-fallback' the binding names a `controller.method` that
 *                                 is not a function on the controller module.
 *                                 Exactly 3 routes, answering entirely through
 *                                 :574-576.
 *   'function'                    everything else: 226 routes.
 *
 * An entry matching none of them returns 'unclassified', which the caller
 * treats as an operational failure. That is deliberate: an unclassified route
 * means this tool's model of the parser has broken, and a gate that recorded a
 * fifth kind quietly would report PASS on a manifest nobody could interpret.
 *
 * @param {string} appRoot Absolute path.
 * @param {Object} route A parsed route.
 * @param {(string|null)} binding The pre-parse controller binding.
 * @returns {string} One of the HANDLER_* values.
 */
function classifyHandler(appRoot, route, binding) {
  if (route.handler !== null &&
      typeof route.handler === 'object' &&
      Object.prototype.hasOwnProperty.call(route.handler, 'directory')) {
    return HANDLER_INERT_DIRECTORY;
  }

  if (route.options && typeof route.options.handler === 'function') {
    return HANDLER_OPTIONS;
  }

  if (bindsMissingController(appRoot, binding)) {
    return HANDLER_FALLBACK;
  }

  if (typeof route.handler === 'function') {
    return HANDLER_FUNCTION;
  }

  return HANDLER_UNCLASSIFIED;
}

/**
 * Builds one manifest entry, joining a parsed route to its declaration.
 *
 * @param {string} appRoot Absolute path.
 * @param {Object} route A parsed route.
 * @param {(Object|null)} declaration The pristine declaration, or null for a
 *   synthesized route.
 * @param {{strategy: (string|null), mode: string}} defaultAuth
 * @param {boolean} extDerived True when this entry is the `.json` duplicate
 *   the extension branch pushes, and therefore shares its declaration with the
 *   base path.
 * @returns {Object} An entry whose keys are in ENTRY_KEY_ORDER.
 */
function buildEntry(appRoot, route, declaration, defaultAuth, extDerived) {
  var binding = controllerBinding(declaration);
  var entry = {
    method: String(route.method),
    path: String(route.path),
    controller: binding,
    handlerKind: classifyHandler(appRoot, route, binding),
    auth: effectiveAuth(route, defaultAuth),
    pre: preDescriptors(declaration),
    validate: validationKeys(declaration),
    success: successSpec(declaration),
    fail: failSpec(declaration),
    reply: replySpec(declaration),
    cookie: cookieFlag(declaration),
    ext: extDerived ? 'derived' : extFlag(declaration),
    options: recordedOptions(route)
  };
  var ordered = {};
  var i;

  // Rebuilt through the fixed key list rather than trusted to the literal
  // above, so that the serialized key order is guaranteed by data and cannot
  // drift if the literal is ever reordered.
  for (i = 0; i < ENTRY_KEY_ORDER.length; i++) {
    ordered[ENTRY_KEY_ORDER[i]] = entry[ENTRY_KEY_ORDER[i]];
  }

  return ordered;
}

/**
 * Sorts entries deterministically by method, then path.
 *
 * Plain lexicographic comparison on the two join-key components. Deterministic
 * ordering is what lets two manifests be diffed byte-for-byte before the
 * structured comparison runs, and since method + path is unique across the 233
 * routes the order is total - no tie can be broken arbitrarily.
 *
 * @param {Object[]} entries
 * @returns {Object[]} The same array, sorted in place.
 */
function sortEntries(entries) {
  return entries.sort(function (a, b) {
    if (a.method < b.method) { return -1; }
    if (a.method > b.method) { return 1; }
    if (a.path < b.path) { return -1; }
    if (a.path > b.path) { return 1; }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Summary - a SUMMARY, NOT THE GATE
// ---------------------------------------------------------------------------

/**
 * Aggregates the entries and compares each figure against the verified
 * baseline.
 *
 * EVERY FIGURE HERE IS A SUMMARY, NOT THE GATE, and the emitted block says so
 * in its own `note` field. Swapping auth between two routes leaves every
 * aggregate below unchanged, which is exactly why the pass condition is the
 * per-entry comparison in `--compare`.
 *
 * A figure that disagrees with the verified baseline is REPORTED on stderr and
 * recorded in `unexpected` - never corrected, and never a reason to alter the
 * artifact. A run that disagrees means the tool is wrong, or the tree is, and
 * both are findings.
 *
 * @param {Object[]} entries
 * @param {Object} loaded The result of loadRoutes.
 * @returns {Object}
 */
function buildSummary(entries, loaded) {
  var summary = {
    note: 'SUMMARY, NOT THE GATE. Swapping auth between two routes leaves ' +
      'every figure here unchanged; the pass condition is the per-entry ' +
      'comparison performed by --compare.',
    routes: entries.length,
    declaredRoutes: loaded.declaredCount,
    declarationSources: {
      'config/routes.js': loaded.routesCount,
      'config/api_routes.js': loaded.apiRoutesCount
    },
    synthesized: 0,
    byMethod: {},
    auth: { inherited: 0, session: 0, disabled: 0, other: 0 },
    routesWithPre: 0,
    preEntries: 0,
    validationKeys: 0,
    validationKeysBySection: {},
    handlerKinds: {},
    nonFunctionHandlers: 0,
    missingControllerFallbackRoutes: [],
    routesWithReplySpec: 0,
    routesWithCookie: 0,
    routesWithExt: 0,
    expected: EXPECTED,
    unexpected: []
  };
  var methods = Object.keys(EXPECTED.byMethod);
  var i;

  // Seed the declared methods so a method dropping to zero shows as 0 rather
  // than vanishing from the object - a disappearing key is easy to miss in a
  // diff, a 0 is not.
  for (i = 0; i < methods.length; i++) {
    summary.byMethod[methods[i]] = 0;
  }

  entries.forEach(function (entry) {
    summary.byMethod[entry.method] = (summary.byMethod[entry.method] || 0) + 1;

    if (entry.auth.inherited) { summary.auth.inherited += 1; }
    else if (entry.auth.declared === false) { summary.auth.disabled += 1; }
    else if (entry.auth.declared === 'session') { summary.auth.session += 1; }
    else { summary.auth.other += 1; }

    if (entry.pre.length > 0) {
      summary.routesWithPre += 1;
      summary.preEntries += entry.pre.length;
    }

    summary.validationKeys += entry.validate.length;
    entry.validate.forEach(function (key) {
      summary.validationKeysBySection[key] =
        (summary.validationKeysBySection[key] || 0) + 1;
    });

    summary.handlerKinds[entry.handlerKind] =
      (summary.handlerKinds[entry.handlerKind] || 0) + 1;

    if (entry.handlerKind === HANDLER_INERT_DIRECTORY) {
      summary.nonFunctionHandlers += 1;
    }

    if (entry.handlerKind === HANDLER_FALLBACK) {
      summary.missingControllerFallbackRoutes.push(
        routeKey(entry.method, entry.path) + ' -> ' + entry.controller
      );
    }

    if (entry.controller === null) { summary.synthesized += 1; }
    if (entry.reply !== null) { summary.routesWithReplySpec += 1; }
    if (entry.cookie) { summary.routesWithCookie += 1; }
    if (entry.ext) { summary.routesWithExt += 1; }
  });

  summary.missingControllerFallbackRoutes.sort();

  // `options.validate` surviving the parse. The pre-parse key total and this
  // figure are the PAIR of facts that prove lib/util/routeParser.js:285
  // executes for every route with a validate block: 102 declared, 0 retained.
  summary.retainedParsedValidate = loaded.parsed.filter(function (route) {
    return !!(route.options && route.options.validate !== undefined);
  }).length;

  function expect(label, actual, wanted) {
    if (actual !== wanted) {
      summary.unexpected.push(label + ': got ' + JSON.stringify(actual) +
        ', verified baseline is ' + JSON.stringify(wanted));
    }
  }

  expect('routes', summary.routes, EXPECTED.routes);
  expect('declaredRoutes', summary.declaredRoutes, EXPECTED.declaredRoutes);
  Object.keys(EXPECTED.byMethod).forEach(function (method) {
    expect('byMethod.' + method, summary.byMethod[method] || 0,
      EXPECTED.byMethod[method]);
  });
  expect('auth.inherited', summary.auth.inherited, EXPECTED.authInherited);
  expect('auth.session', summary.auth.session, EXPECTED.authSession);
  expect('auth.disabled', summary.auth.disabled, EXPECTED.authDisabled);
  expect('auth.other', summary.auth.other, 0);
  expect('synthesized', summary.synthesized, EXPECTED.synthesizedRoutes);
  expect('routesWithPre', summary.routesWithPre, EXPECTED.routesWithPre);
  expect('validationKeys', summary.validationKeys, EXPECTED.validationKeys);
  expect('retainedParsedValidate', summary.retainedParsedValidate,
    EXPECTED.retainedValidate);
  expect('nonFunctionHandlers', summary.nonFunctionHandlers,
    EXPECTED.nonFunctionHandlers);
  expect('handlerKinds.' + HANDLER_FALLBACK,
    summary.handlerKinds[HANDLER_FALLBACK] || 0,
    EXPECTED.missingControllerFallback);
  expect('handlerKinds.' + HANDLER_UNCLASSIFIED,
    summary.handlerKinds[HANDLER_UNCLASSIFIED] || 0, 0);
  expect('missingControllerFallbackRoutes',
    summary.missingControllerFallbackRoutes
      .map(function (row) { return row.split(' -> ')[0]; })
      .join(', '),
    EXPECTED_FALLBACK_ROUTES.join(', '));

  return summary;
}


// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Proves the join between the parsed routes and the pristine declarations did
 * not lose anything.
 *
 * This is the guard against the failure mode the whole pristine-copy mechanism
 * exists to avoid. If the copy were handed to `parse` by mistake, or the key
 * were derived differently from the way the parser derives it, EVERY
 * declaration would fail to join and the manifest would come out with a null
 * `controller` and an empty `validate` on all 233 entries - reporting PASS
 * against another manifest built the same broken way. That is the exact
 * failure that produced "zero matches for every declared path", and it is
 * silent unless something asserts against it.
 *
 * Two structural facts settle it, and neither hard-codes a path - the
 * cache-prefix route's path comes from configuration, so a path list would be
 * wrong on a tree with a different cache prefix:
 *
 *   COUNT     A route legitimately has no declaration only if the parser
 *             synthesized it. addStaticPages prepends 2 (one per .html file in
 *             the static-pages directory) and addStaticRoutes appends 3, so
 *             registered = declared + extDuplicates + synthesized.
 *   POSITION  addStaticPages runs BEFORE the declaration loop and
 *             addStaticRoutes AFTER it, so every synthesized route is in a
 *             leading or trailing block. A declaration that failed to join
 *             would leave an unmatched index BETWEEN two matched ones, which
 *             no synthesized route can ever do.
 *
 * @param {Object} loaded The result of loadRoutes.
 * @param {number[]} matchedIndices Parsed indices that joined, ascending.
 * @param {number[]} unmatchedIndices Parsed indices that did not, ascending.
 * @param {number} extDerivedCount Entries recovered through the `.json`
 *   extension branch, which join to a declaration already counted.
 * @returns {undefined}
 * @throws {ToolError} If the join is unsound.
 */
function assertJoinIsSound(loaded, matchedIndices, unmatchedIndices, extDerivedCount) {
  var firstMatched;
  var lastMatched;
  var interior;
  var expectedSynthesized;

  if (matchedIndices.length === 0) {
    throw new ToolError('NO parsed route joined to a declaration. The pristine ' +
      'copy did not survive the parse - every binding and spec would be null. ' +
      'This is the failure the deep copy exists to prevent; the artifact was ' +
      'not written.');
  }

  firstMatched = matchedIndices[0];
  lastMatched  = matchedIndices[matchedIndices.length - 1];

  interior = unmatchedIndices.filter(function (index) {
    return index > firstMatched && index < lastMatched;
  });

  if (interior.length) {
    throw new ToolError('parsed route(s) inside the declaration block failed ' +
      'to join, so a declaration has been lost: parsed index/indices ' +
      interior.join(', ') + ' at ' +
      interior.map(function (index) {
        return routeKey(loaded.parsed[index].method, loaded.parsed[index].path);
      }).join(', '));
  }

  // extDerived entries joined to a declaration that was already counted once,
  // so they must not be charged against the declared total a second time.
  expectedSynthesized =
    loaded.parsed.length - loaded.declaredCount - extDerivedCount;

  if (unmatchedIndices.length !== expectedSynthesized) {
    throw new ToolError('the join does not reconcile: ' + loaded.parsed.length +
      ' registered, ' + loaded.declaredCount + ' declared, ' + extDerivedCount +
      ' extension-derived, so ' + expectedSynthesized + ' route(s) should be ' +
      'synthesized, but ' + unmatchedIndices.length + ' failed to join');
  }
}

/**
 * Builds the manifest for the tree at `appRoot`.
 *
 * @param {string} appRoot Absolute path, already validated.
 * @returns {{manifest: Object, environment: Object, defaultAuth: Object,
 *            loaded: Object}}
 * @throws {ToolError}
 */
function generateManifest(appRoot) {
  var environment = prepareEnvironment(appRoot);
  var defaultAuth = readServerAuthDefault(appRoot);
  var loaded      = loadRoutes(appRoot);
  var declarations = indexDeclarations(loaded.pristine);
  var entries = [];
  var matchedIndices = [];
  var unmatchedIndices = [];
  var extDerivedCount = 0;

  if (declarations.duplicates.length) {
    // Two declarations claiming one method + path would make the join
    // ambiguous and silently give one of them the other's specs. Reported
    // rather than resolved by picking one.
    throw new ToolError('duplicate method + path in the declarations, so the ' +
      'join is ambiguous: ' + declarations.duplicates.join(', '));
  }

  loaded.parsed.forEach(function (route, index) {
    var key = routeKey(route.method, route.path);
    var declaration = Object.prototype.hasOwnProperty.call(declarations.index, key)
      ? declarations.index[key]
      : null;
    var extDerived = false;
    var baseKey;

    if (!declaration && typeof route.path === 'string' &&
        /\.json$/.test(route.path)) {
      // The extension branch (lib/util/routeParser.js:598-605) pushes a shallow
      // copy of the route whose path gains '.json'. It shares the ORIGINAL
      // declaration, so the specs are recovered from the base path and the
      // entry is MARKED as derived rather than presented as a declaration of
      // its own. `ext : true` appears nowhere at this commit so this branch is
      // dead on both trees; it exists because the alternative - reporting the
      // duplicate with a null controller - would misattribute a real route.
      baseKey = routeKey(route.method, route.path.replace(/\.json$/, ''));
      if (Object.prototype.hasOwnProperty.call(declarations.index, baseKey)) {
        declaration = declarations.index[baseKey];
        extDerived  = true;
        extDerivedCount += 1;
      }
    }

    if (declaration) {
      matchedIndices.push(index);
    }
    else {
      unmatchedIndices.push(index);
    }

    entries.push(buildEntry(appRoot, route, declaration, defaultAuth, extDerived));
  });

  assertJoinIsSound(loaded, matchedIndices, unmatchedIndices, extDerivedCount);

  sortEntries(entries);

  return {
    manifest: {
      // `schema` is a plain integer rather than a version string so a
      // comparator can refuse two manifests of different shapes without
      // parsing a version. Bump it whenever a recorded field changes meaning.
      schema: 1,
      summary: buildSummary(entries, loaded),
      entries: entries
    },
    environment: environment,
    defaultAuth: defaultAuth,
    loaded: loaded
  };
}

/**
 * Builds the provenance record written to `<out>.provenance.json`.
 *
 * Kept OUT of the manifest deliberately. The manifest must be comparable
 * byte-for-byte between two trees, and every field here differs between them by
 * construction - the app path, the commit, the dependency graph that produced
 * the parse. AAP §0.9.3 requires tool provenance alongside every artifact
 * because "captured at baseline" means captured by TARGET-worktree tooling
 * against a BASELINE install, and this sidecar is what makes that claim
 * checkable rather than asserted.
 *
 * There is no timestamp, on purpose: the sidecar is then reproducible too, and
 * a re-run that produces a byte-identical pair is itself evidence that nothing
 * in the capture depends on when it ran.
 *
 * @param {Object} generated The result of generateManifest.
 * @param {string} appRoot Absolute path.
 * @param {string} out Absolute path of the manifest.
 * @returns {Object}
 */
function buildProvenance(generated, appRoot, out) {
  return {
    artifact: path.basename(out),
    schema: generated.manifest.schema,
    tree: {
      appRoot: appRoot,
      head: gitHead(appRoot)
    },
    tool: {
      path: path.relative(TOOL_ROOT, __filename) || path.basename(__filename),
      worktree: TOOL_ROOT,
      head: gitHead(TOOL_ROOT)
    },
    runtime: {
      node: process.version,
      platform: process.platform
    },
    configuration: {
      NODE_ENV: generated.environment.nodeEnv,
      NODE_CONFIG: generated.environment.nodeConfig,
      NODE_CONFIG_DIR: generated.environment.nodeConfigDir
    },
    serverAuthDefault: generated.defaultAuth,
    declarationCounts: {
      'config/routes.js': generated.loaded.routesCount,
      'config/api_routes.js': generated.loaded.apiRoutesCount,
      declared: generated.loaded.declaredCount,
      registered: generated.manifest.entries.length
    }
  };
}

/**
 * The generate mode.
 *
 * @param {Object} options The parsed command line.
 * @returns {number} An exit code.
 * @throws {ToolError}
 */
function runGenerate(options) {
  var out = options.out || DEFAULT_OUT;
  var generated;
  var provenance;
  var summary;

  assertAppRoot(options.appRoot);

  generated  = generateManifest(options.appRoot);
  summary    = generated.manifest.summary;
  provenance = buildProvenance(generated, options.appRoot, out);

  writeArtifact(out, serialize(generated.manifest));
  writeArtifact(out + '.provenance.json', serialize(provenance));

  note('manifest: ' + summary.routes + ' routes from ' + options.appRoot);
  note('  artifact   ' + out);
  note('  provenance ' + out + '.provenance.json');

  if (summary.unexpected.length) {
    // Reported, never corrected. A figure that disagrees with the verified
    // baseline means the tool is wrong or the tree is; both are findings, and
    // neither is a reason to change the artifact.
    note('WARNING: ' + summary.unexpected.length + ' summary figure(s) differ ' +
      'from the verified baseline. The artifact is unchanged; this is a ' +
      'finding to record, not to correct:');
    summary.unexpected.forEach(function (row) { note('  - ' + row); });
  }

  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// --compare - THE GATE
// ---------------------------------------------------------------------------

/**
 * Indexes a manifest's entries by their join key.
 *
 * @param {Object} manifest
 * @param {string} label For diagnostics.
 * @returns {Object}
 * @throws {ToolError} On a duplicated key, which would make the join ambiguous.
 */
function indexEntries(manifest, label) {
  var index = {};

  manifest.entries.forEach(function (entry) {
    var key = routeKey(entry.method, entry.path);

    if (Object.prototype.hasOwnProperty.call(index, key)) {
      throw new ToolError('duplicate entry in ' + label + ': ' + key);
    }

    index[key] = entry;
  });

  return index;
}

/**
 * Compares two manifests entry by entry, field by field.
 *
 * The join is on method + ' ' + path, and EVERY recorded field is compared,
 * auth included and compared PER ENTRY. Aggregates are never compared in place
 * of entries: swapping auth between two routes leaves every aggregate equal
 * while changing the surface for both routes.
 *
 * Nothing is normalized away. Comparison is order-sensitive on arrays and on
 * object keys, because the recorded fragments preserve declaration order and a
 * `reply` spec's key order is the order of the keys in the response. If this
 * comparator ever needs a field ignored in order to pass, that is a finding for
 * docs/baseline-parity.md, not a change to this code.
 *
 * @param {Object} baseline
 * @param {Object} target
 * @returns {{lines: string[], differences: number, onlyInBaseline: string[],
 *            onlyInTarget: string[], changed: number, compared: number}}
 */
function compareManifests(baseline, target) {
  var baseIndex   = indexEntries(baseline, 'baseline');
  var targetIndex = indexEntries(target, 'target');
  var baseKeys    = Object.keys(baseIndex).sort();
  var targetKeys  = Object.keys(targetIndex).sort();
  var onlyInBaseline = [];
  var onlyInTarget   = [];
  var fieldDiffs     = [];
  var lines = [];
  var changed = 0;

  if (baseline.schema !== target.schema) {
    throw new ToolError('manifest schema mismatch: baseline ' +
      JSON.stringify(baseline.schema) + ' vs target ' +
      JSON.stringify(target.schema) + '. The two were produced by different ' +
      'versions of this tool and are not comparable.');
  }

  baseKeys.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(targetIndex, key)) {
      onlyInBaseline.push(key);
    }
  });

  targetKeys.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(baseIndex, key)) {
      onlyInTarget.push(key);
    }
  });

  baseKeys.forEach(function (key) {
    var a = baseIndex[key];
    var b = targetIndex[key];
    var rows = [];

    if (!b) {
      return;
    }

    COMPARED_FIELDS.forEach(function (field) {
      var left  = canonical(a[field]);
      var right = canonical(b[field]);

      if (left !== right) {
        rows.push({ field: field, baseline: left, target: right });
      }
    });

    if (rows.length) {
      changed += 1;
      fieldDiffs.push({ key: key, rows: rows });
    }
  });

  lines.push('ROUTE MANIFEST COMPARISON');
  lines.push('  baseline entries : ' + baseKeys.length);
  lines.push('  target entries   : ' + targetKeys.length);
  lines.push('  joined on        : method + path');
  lines.push('  fields compared  : ' + COMPARED_FIELDS.join(', '));
  lines.push('');

  lines.push('ENTRIES ONLY IN BASELINE (' + onlyInBaseline.length + ')');
  if (onlyInBaseline.length === 0) {
    lines.push('  none');
  }
  else {
    onlyInBaseline.forEach(function (key) { lines.push('  - ' + key); });
  }
  lines.push('');

  lines.push('ENTRIES ONLY IN TARGET (' + onlyInTarget.length + ')');
  if (onlyInTarget.length === 0) {
    lines.push('  none');
  }
  else {
    onlyInTarget.forEach(function (key) { lines.push('  + ' + key); });
  }
  lines.push('');

  lines.push('ENTRIES WITH DIFFERING FIELDS (' + fieldDiffs.length + ')');
  if (fieldDiffs.length === 0) {
    lines.push('  none');
  }
  else {
    fieldDiffs.forEach(function (diff) {
      lines.push('  ' + diff.key);
      diff.rows.forEach(function (row) {
        lines.push('    ' + row.field);
        lines.push('      baseline: ' + row.baseline);
        lines.push('      target  : ' + row.target);
      });
    });
  }
  lines.push('');

  // The summary blocks are reported for context only and are NEVER the pass
  // condition. A figure that differs while every entry matches is impossible
  // for the derived aggregates and would mean the summaries were built from
  // different tool versions.
  lines.push('SUMMARY FIGURES (context only, not the pass condition)');
  lines.push('  baseline routes : ' +
    ((baseline.summary && baseline.summary.routes) || baseKeys.length));
  lines.push('  target routes   : ' +
    ((target.summary && target.summary.routes) || targetKeys.length));
  lines.push('');

  return {
    lines: lines,
    differences: onlyInBaseline.length + onlyInTarget.length + changed,
    onlyInBaseline: onlyInBaseline,
    onlyInTarget: onlyInTarget,
    changed: changed,
    compared: baseKeys.length
  };
}

/**
 * The --compare mode.
 *
 * @param {Object} options The parsed command line.
 * @returns {number} EXIT_OK on no difference, EXIT_DIFFERENCE otherwise.
 * @throws {ToolError}
 */
function runCompare(options) {
  var baseline = readManifest(options.compare[0]);
  var target   = readManifest(options.compare[1]);
  var result   = compareManifests(baseline, target);
  var verdict  = result.differences === 0
    ? 'PASS - the HTTP surface is identical across all ' + result.compared +
      ' entries'
    : 'FAIL - ' + result.differences + ' difference(s): ' +
      result.onlyInBaseline.length + ' only in baseline, ' +
      result.onlyInTarget.length + ' only in target, ' + result.changed +
      ' with differing fields';
  var report = result.lines.concat([verdict, '']).join('\n');

  // Written to stderr so stdout stays empty, and additionally to --out when
  // one is given, so the evidence can be pasted into docs/baseline-parity.md
  // verbatim.
  process.stderr.write(report);

  if (options.out) {
    writeArtifact(options.out, report);
  }

  return result.differences === 0 ? EXIT_OK : EXIT_DIFFERENCE;
}


// ---------------------------------------------------------------------------
// --cli-table - a SUPPORTING check
// ---------------------------------------------------------------------------

// The three invocation forms of the route-table CLI, all of which must produce
// byte-identical output. lib/util/routeParser.js sets `executable` from
// process.argv[1] and then does `argv.R = argv.R || executable`, so BARE
// EXECUTION WITH NO ARGUMENT ALSO EMITS THE TABLE, and `--routes` is an
// accepted alias of `-R` (via optimist's `.alias('R','routes')` on the
// baseline, and via the same two spellings read off argv on the target). All
// three are gated: an argv replacement that tested only for `-R` would
// silently change the other two, and nothing else in the repository would
// notice.
//
// These strings are SPAWN ARGUMENTS for a child process, never flag
// definitions of this tool - which has no `-R` and no `--routes`, precisely so
// that requiring the parser in generate mode cannot make it print a table into
// our stdout.
var CLI_FORMS = [
  { label: 'dash-R', args: ['-R'] },
  { label: 'long-routes', args: ['--routes'] },
  { label: 'bare', args: [] }
];

/**
 * Runs the route-table CLI once and captures its stdout.
 *
 * STDOUT ONLY; stderr is discarded, because on a baseline tree it carries the
 * AWS SDK v2 end-of-support notice and capturing it would make the two trees
 * differ for a reason that is not the table.
 *
 * The environment is the one AAP §0.9.1 specifies and is identical on both
 * trees:
 *   NODE_CONFIG='{"db":{"redis":{"enabled":false}}}' NODE_ENV=test \
 *     node lib/util/routeParser.js -R 2>/dev/null
 * The overlay is not optional here either. The baseline's committed
 * config/test.yaml does not disable Redis, so without it Bull would dial
 * localhost, emit queue output INTO THE CAPTURED STREAM and risk exiting on an
 * unhandled ECONNREFUSED. Passing it externally is also what keeps the gate
 * honest: no configuration file in either worktree is edited to make this run.
 *
 * NODE_CONFIG_DIR is removed from the child environment rather than set,
 * because the child's working directory is the tree under test and the npm
 * `config` package resolves its directory from the working directory - which
 * is exactly what the §0.9.1 command relies on. An inherited value pointing at
 * the other tree would silently override it.
 *
 * @param {string} appRoot Absolute path.
 * @param {string[]} args The invocation form's arguments.
 * @returns {{stdout: string, status: (number|null), signal: (string|null)}}
 * @throws {ToolError} If the child cannot be spawned.
 */
function captureCliTable(appRoot, args) {
  var env = {};
  var result;

  Object.keys(process.env).forEach(function (key) { env[key] = process.env[key]; });
  delete env.NODE_CONFIG_DIR;
  env.NODE_CONFIG = composeNodeConfig(undefined);
  env.NODE_ENV    = process.env.NODE_ENV || 'test';

  result = childProcess.spawnSync(
    process.execPath,
    [path.join(appRoot, 'lib', 'util', 'routeParser.js')].concat(args),
    {
      cwd: appRoot,
      env: env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 32 * 1024 * 1024
    }
  );

  if (result.error) {
    throw new ToolError('cannot run the route-table CLI: ' + result.error.message);
  }

  return {
    stdout: result.stdout === null || result.stdout === undefined ? '' : result.stdout,
    status: result.status,
    signal: result.signal
  };
}

/**
 * Splits a capture into its stdout preamble and the table itself.
 *
 * The capture is NOT one clean table. Requiring the controllers prints the
 * in-memory-queue line from lib/util/queues.js on STDOUT, so the captured
 * stream is that preamble, then `tab`'s header row, then the data rows. The
 * measured baseline shape is 114 lines: 1 preamble + 1 header + 112 DATA ROWS.
 *
 * Both parts are recorded. The raw bytes are what make the table recoverable
 * exactly, which is the whole point of capturing rather than reimplementing;
 * the isolated table region is what makes a cross-tree comparison meaningful
 * without discarding anything, since the preamble belongs to the application's
 * output rather than to the table.
 *
 * @param {string} stdout
 * @returns {{preamble: string[], header: (string|null), dataRows: number,
 *            table: string}}
 */
function splitCliTable(stdout) {
  var lines = stdout.split('\n');
  var trailingNewline = lines.length > 0 && lines[lines.length - 1] === '';
  var body = trailingNewline ? lines.slice(0, -1) : lines.slice(0);
  var headerIndex = -1;
  var i;

  for (i = 0; i < body.length; i++) {
    if (/^METHOD(\s|$)/.test(body[i])) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return { preamble: body.slice(0), header: null, dataRows: 0, table: '' };
  }

  return {
    preamble: body.slice(0, headerIndex),
    header: body[headerIndex],
    dataRows: body.length - headerIndex - 1,
    table: body.slice(headerIndex).join('\n') + (trailingNewline ? '\n' : '')
  };
}

/**
 * The --cli-table mode.
 *
 * The table is NEVER reimplemented. Byte-identical output is only achievable by
 * capturing what `tab`'s `emitTable` actually produces, and two details make a
 * reimplementation wrong in ways that are easy to miss: the columns are METHOD
 * at width 8 with PATH, CONTROLLER, SUCCESS and FAIL at `size + 4`, and
 * lib/util/routeParser.js:615 computes `sizes.fail` FROM `successStr`, NOT from
 * `failStr` - so the FAIL column's width is derived from the SUCCESS strings.
 * That is a quirk to preserve, not a bug to fix (R-d), and capturing is what
 * preserves it without anyone having to remember it.
 *
 * The expected baseline shape is 112 DATA ROWS, because the parser's
 * self-execution passes `require('../../config/routes')` ONLY: the 116 API
 * routes and the 5 synthesized routes are absent from the table and its columns
 * carry no auth. That is why this is a SUPPORTING CHECK and the route manifest
 * is the primary gate.
 *
 * Failing on a cross-form byte difference is deliberate: that invariant is the
 * one the replacement of the argv parser directly threatens. The data-row count
 * is reported rather than enforced, because a legitimate change to
 * config/routes.js would move it and `--compare` is the instrument that judges
 * whether such a change is acceptable.
 *
 * @param {Object} options The parsed command line.
 * @returns {number} EXIT_OK, or EXIT_DIFFERENCE if the forms diverged.
 * @throws {ToolError}
 */
function runCliTable(options) {
  var out = options.out || path.join(__dirname, 'route-table.json');
  var captures = [];
  var reference = null;
  var divergent = [];
  var artifact;

  assertAppRoot(options.appRoot);

  CLI_FORMS.forEach(function (form) {
    var captured = captureCliTable(options.appRoot, form.args);
    var split    = splitCliTable(captured.stdout);

    if (captured.status !== 0) {
      throw new ToolError('the route-table CLI exited ' +
        JSON.stringify(captured.status) +
        (captured.signal ? ' on signal ' + captured.signal : '') +
        ' for the ' + form.label + ' form');
    }

    if (reference === null) {
      reference = captured.stdout;
    }
    else if (captured.stdout !== reference) {
      divergent.push(form.label);
    }

    captures.push({
      label: form.label,
      // Recorded verbatim so the bytes of each table are recoverable exactly.
      argv: form.args,
      bytes: Buffer.byteLength(captured.stdout, 'utf8'),
      lines: captured.stdout.split('\n').length,
      dataRows: split.dataRows,
      preamble: split.preamble,
      header: split.header,
      // The complete captured stream, and the table region on its own. Neither
      // replaces the other: the first is the byte-exact record, the second is
      // what a cross-tree comparison should look at, since the preamble is
      // application output rather than table output.
      stdout: captured.stdout,
      table: split.table
    });
  });

  artifact = {
    schema: 1,
    note: 'SUPPORTING CHECK, not the primary gate. The route-table CLI parses ' +
      'config/routes.js only, so the 116 API routes and the 5 synthesized ' +
      'routes are absent and the columns carry no auth. The primary gate is ' +
      'the route manifest compared per entry.',
    appRoot: options.appRoot,
    head: gitHead(options.appRoot),
    node: process.version,
    environment: {
      NODE_ENV: process.env.NODE_ENV || 'test',
      NODE_CONFIG: composeNodeConfig(undefined)
    },
    expectedDataRows: EXPECTED.cliTableDataRows,
    formsByteIdentical: divergent.length === 0,
    divergentForms: divergent,
    captures: captures
  };

  writeArtifact(out, serialize(artifact));

  note('route-table CLI: ' + captures.length + ' invocation form(s) captured ' +
    'from ' + options.appRoot);
  captures.forEach(function (capture) {
    note('  ' + capture.label + ': ' + capture.bytes + ' bytes, ' +
      capture.dataRows + ' data row(s)' +
      (capture.preamble.length
        ? ', ' + capture.preamble.length + ' preamble line(s)'
        : ''));
  });
  note('  artifact ' + out);

  if (divergent.length) {
    note('FAIL: these invocation forms did not match the ' + CLI_FORMS[0].label +
      ' capture byte for byte: ' + divergent.join(', '));
    return EXIT_DIFFERENCE;
  }

  note('  all forms byte-identical');

  if (captures[0].dataRows !== EXPECTED.cliTableDataRows) {
    note('WARNING: ' + captures[0].dataRows + ' data row(s), verified baseline ' +
      'is ' + EXPECTED.cliTableDataRows + '. Reported, not corrected; judge it ' +
      'with the route manifest comparison.');
  }

  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Dispatches one invocation.
 *
 * @param {string[]} args process.argv.slice(2)
 * @param {string} originalCwd The working directory at process start, captured
 *   before generate mode chdirs into the tree under test.
 * @returns {number} An exit code.
 * @throws {ToolError}
 */
function run(args, originalCwd) {
  var options = parseArguments(args, originalCwd);

  switch (options.mode) {
    case 'help':
      note(USAGE);
      return EXIT_OK;

    case 'compare':
      return runCompare(options);

    case 'cli-table':
      return runCliTable(options);

    default:
      return runGenerate(options);
  }
}

/**
 * The CLI wrapper.
 *
 * A ToolError exits 2 with its message alone, because it describes a mistake a
 * reader can act on and a stack trace would bury it. Anything else exits 2 WITH
 * its stack, because an unexpected throw is a defect in this tool and the trace
 * is the evidence.
 *
 * @returns {undefined}
 */
function main() {
  var originalCwd = process.cwd();
  var code;

  try {
    code = run(process.argv.slice(2), originalCwd);
  }
  catch (err) {
    if (err instanceof ToolError) {
      note('ERROR: ' + err.message);
      note('');
      note(USAGE);
    }
    else {
      note('UNEXPECTED FAILURE: ' + ((err && err.stack) || String(err)));
    }
    process.exitCode = EXIT_ERROR;
    return;
  }

  process.exitCode = code;
}

// Exported for the ad-hoc validation harness and for any sibling parity tool
// that wants the manifest in memory rather than from disk. `main` runs only
// under direct execution, so a require never generates anything, never chdirs
// and never spawns.
module.exports = {
  // Generation.
  generateManifest : generateManifest,
  buildProvenance  : buildProvenance,
  buildSummary     : buildSummary,

  // Comparison - the gate.
  compareManifests : compareManifests,
  readManifest     : readManifest,

  // The route-table CLI capture.
  captureCliTable  : captureCliTable,
  splitCliTable    : splitCliTable,

  // Building blocks, exported because each one has a failure mode worth
  // testing directly.
  parseArguments   : parseArguments,
  deepCopy         : deepCopy,
  isPlainObject    : isPlainObject,
  jsonSafe         : jsonSafe,
  serialize        : serialize,
  composeNodeConfig: composeNodeConfig,
  deepMerge        : deepMerge,
  routeKey         : routeKey,
  effectiveAuth    : effectiveAuth,
  preDescriptors   : preDescriptors,
  successSpec      : successSpec,
  failSpec         : failSpec,
  replySpec        : replySpec,
  validationKeys   : validationKeys,
  controllerBinding: controllerBinding,
  classifyHandler  : classifyHandler,
  sortEntries      : sortEntries,
  readServerAuthDefault: readServerAuthDefault,

  // Reference values, so a harness asserts against the same numbers the tool
  // reports rather than a second copy of them.
  EXPECTED         : EXPECTED,
  EXPECTED_FALLBACK_ROUTES: EXPECTED_FALLBACK_ROUTES,
  ENTRY_KEY_ORDER  : ENTRY_KEY_ORDER,
  COMPARED_FIELDS  : COMPARED_FIELDS,
  EXIT_OK          : EXIT_OK,
  EXIT_DIFFERENCE  : EXIT_DIFFERENCE,
  EXIT_ERROR       : EXIT_ERROR,
  ToolError        : ToolError,
  main             : main
};

if (require.main === module) {
  main();
}

