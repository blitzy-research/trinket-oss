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
//   # supporting check, per tree: the route-table CLI, all three invocation
//   # forms, byte-compared against each other and against the verified row count
//   node test/parity/manifest.js --cli-table --out /tmp/cli-table-target.json \
//     >/dev/null 2>/dev/null
//   node test/parity/manifest.js --cli-table --app /path/to/baseline-2f8712a \
//     --out /tmp/cli-table-baseline.json >/dev/null 2>/dev/null
//
//   # and the CROSS-TREE half of that check, which is the half a single tree
//   # cannot make: all three forms drift together, so they stay identical to
//   # each other while no longer describing the same routes
//   node test/parity/manifest.js --compare-cli /tmp/cli-table-baseline.json \
//     /tmp/cli-table-target.json 2>&1 >/dev/null
//
// Provenance is written to a SIBLING file, `<out>.provenance.json`, never
// inside the manifest. That is what lets the manifest itself be compared
// byte-for-byte while still satisfying AAP §0.9.3's requirement that tool
// provenance be recorded alongside every artifact: "captured at baseline"
// means captured by TARGET-worktree tooling against a BASELINE install, and
// the sidecar is what makes that checkable.
//
// The sidecar carries a SHA-256 `digest` of the manifest's exact bytes, which
// is what makes the pair a BINDING rather than a description, and
// `verifyManifestProvenance(manifestPath, appRoot)` /
// `readManifestForApp(manifestPath, appRoot)` are what a consumer uses in place
// of `readManifest` when it did not generate the file itself. That matters
// because THE DEFAULT ARTIFACT PATH IS SHARED: test/parity/capture.js and
// test/parity/replay.js both default to test/parity/route-manifest.json and
// consume it whenever it exists, so a baseline manifest left there would
// otherwise be read by a target replay and the target judged by the baseline's
// HTTP surface. Note that two manifests of DIFFERENT trees can be
// byte-identical - at this commit they are, which is the gate passing - so the
// digest alone cannot tell them apart; the tree path and commit recorded in the
// sidecar are what do.
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
// THE 233 RECONCILIATION - AND ITS TWO EQUALLY TRUE DECOMPOSITIONS
// ===========================================================================
//   config/routes.js      112 exported objects
//   config/api_routes.js  116 exported objects
//                        --------------------------------------------------
//                       = 228 exported objects
//   + 2  addStaticPages PREPENDS /about and /help (lib/views/static/*.html)
//   + 3  addStaticRoutes APPENDS the cache-prefix directory route,
//        /.well-known/{path*} and the /{path*} catch-all
//   = 233 registered routes
//
// THE 112 DECOMPOSES TWO WAYS, BOTH ARITHMETICALLY TRUE, AND NEITHER IS
// ASSERTED HERE. config/routes.js contains 62 `route :` declaration lines, 5 of
// which are written INSIDE the per-language expansion loop body, and the loop
// runs once for each of the 11 config.constants.trinketLangs:
//
//   (A) 57 top-level + 55 expansion  = 112   the 5 in-loop lines counted as
//                                            EXPANSION (11 x 5), so the
//                                            literal count excludes them
//   (B) 62 literal   + 50 expansion  = 112   the 5 in-loop lines counted as
//                                            LITERAL, so the expansion adds
//                                            only the further (11 - 1) x 5
//
// THE ONLY DIFFERENCE BETWEEN THEM IS THAT ATTRIBUTION. Reading (A) is what
// earlier revisions of this comment stated; reading (B) is what
// docs/baseline-parity.md states; each read as an error against the other, and
// a delivery carrying both looked self-contradictory when in fact nothing
// disagreed. So this comment asserts neither, and the figures are no longer
// carried in prose at all: measureDeclarations reads them from the analysed
// tree's own source - the declaration lines, the loop located BY CONTENT rather
// than by a line number that differs between the two trees, the language count
// from config.constants - records BOTH readings with the attribution named in
// each, and appends a self-check failure to the summary's unexpected figures if
// either stops closing, which fails generation. The numbers above are the
// measured values at both trees' current commits, quoted so a reader has a
// reference point; the sidecar's declarationCounts.decomposition is the source
// of truth, and it is per-tree by design.
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
// summary block and the sidecar figures are a SUMMARY, NOT THE PARITY GATE; the
// parity gate is `--compare`, which joins on method + path and compares every
// recorded field of every entry, with auth compared per entry.
//
// That does not make the summary advisory. Its `unexpected` list is a check on
// the CAPTURE - do these 233 entries still reconcile the way the verified
// baseline says a manifest of this application does - and generation exits
// non-zero when it does not, because a capture nobody can trust is not evidence
// to compare. The two are different questions and both are mechanical: the
// summary asks whether THIS manifest is sound, `--compare` asks whether TWO
// manifests agree, and neither answer is substituted for the other.

var fs           = require('fs');
var path         = require('path');
var childProcess = require('child_process');
var crypto       = require('crypto');

// The ONE implementation of the `config` runtime-layer isolation every parity
// tool uses, for `prepareEnvironment` below and for the CLI-table child. It is
// the only thing taken from ./mongo: requiring it starts nothing, resolves no
// application module and provisions no database - `main` there runs solely
// under direct execution - so this tool still loads without a MongoDB.
var mongo        = require('./mongo');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Exit codes. EXIT_DIFFERENCE is what makes this a gate: a comparison that
// found a difference must fail a shell pipeline, and a comparator that cannot
// fail is not a gate.
var EXIT_OK         = 0;
var EXIT_DIFFERENCE = 1;
var EXIT_ERROR      = 2;

// The tool's own worktree root, used for recording this tool's provenance.
// Two levels above test/parity/.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

// The environment variable that names ONE scratch directory for the default
// artifacts of every test/parity tool.
//
// There is deliberately NO repository default. A tool that writes into
// test/parity/ when no destination is given makes an ordinary invocation - a
// `--help`-less first run, a diagnostic re-run, a sibling harness spawning it -
// modify tracked source, which is how an evidence artifact gets overwritten by
// a run nobody meant to publish. So a destination is always either named on the
// command line or taken from this directory, and naming a path inside the
// worktree stays possible but has to be asked for: writing the committed
// evidence is `--out test/parity/route-manifest.json`, spelled out.
var ARTIFACT_DIR_ENV = 'PARITY_ARTIFACT_DIR';

// The artifact basenames this tool produces, used when the destination comes
// from ARTIFACT_DIR_ENV rather than from a flag. The names are the ones AAP
// §0.9.1 refers to, so an artifact written into the scratch directory is still
// recognisable as the same evidence.
var ARTIFACT_NAMES = {
  manifest : 'route-manifest.json',
  cliTable : 'route-table.json'
};

// The committed manifest, and it is a READ default only: --verify reads the
// delivered artifact a reviewer can see, and a read cannot damage it. There is
// deliberately no WRITE default - generation and --cli-table require --out or
// ARTIFACT_DIR_ENV - so no ordinary run leaves an artifact in tracked source.
var COMMITTED_MANIFEST = path.join(__dirname, ARTIFACT_NAMES.manifest);

// The provenance sidecar's suffix. One constant, because the writer and the
// verifier must agree on the path byte for byte - a sidecar the verifier cannot
// find reads as "no provenance", which is precisely the permitted case and
// would therefore hide a real mismatch.
var PROVENANCE_SUFFIX = '.provenance.json';

// Environment variables that let an ambient setting preload code into a child
// or redirect where it resolves modules from, removed from every child this
// file spawns. The canonical list and the reasoning for each entry are in
// test/parity/mongo.js's PRELOAD_ENV_VARS; they are restated here rather than
// required because this file is deliberately standalone - it declares its own
// ToolError and its own composeNodeConfig so that generating a manifest needs
// nothing but Node core and the tree under test.
//
// It matters here for one specific reason: the route-table capture below is
// compared BYTE FOR BYTE across two worktrees (AAP §0.9.1), and a preloaded
// module that wrote a single line to the child's stdout, or that resolved a
// different `tab` or `lib/util/routeParser.js`, would make the two captures
// differ for a reason that has nothing to do with either tree.
var PRELOAD_ENV_VARS = Object.freeze([
  'NODE_OPTIONS',
  'NODE_PATH',
  'NODE_REPL_EXTERNAL_MODULE'
]);

// Budgets for the two synchronous children this file runs. Both are generous
// for the work and finite because a synchronous child blocks this process's
// event loop entirely: a hung `git` or a wedged route-table CLI would take the
// gate with it and report nothing at all.
//
// `git rev-parse` is local and instant, so 10s only covers a loaded host. The
// CLI has to load every controller in the tree under test, which on a cold page
// cache is seconds rather than milliseconds, so it gets 120s.
var GIT_TIMEOUT_MS = 10000;
var CLI_TIMEOUT_MS = 120000;

// The server's default authentication, used for routes that declare none.
// `app.js` is read as TEXT to recover it per tree (see readServerAuthDefault)
// rather than being required, because requiring app.js boots the application
// and pulls in config/app.config. This is the DOCUMENTED EXPECTED VALUE, not a
// fallback: it is what both trees actually declare - `server.auth.default({
// strategy: 'session', mode: 'try' })` at app.js:287 on the baseline and
// app.js:310 on the target - and the recovered pair is ASSERTED against it in
// buildSummary. It is never substituted for a value that could not be
// recovered, because 126 of the 233 entries inherit it and substituting it
// would hide up to 126 auth differences behind a PASS.
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
// are. It is also FAILED: generation exits EXIT_DIFFERENCE when any figure
// below is not reproduced, so drift cannot pass through a shell pipeline as
// success while the artifact and the listed rows record exactly what moved.
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
  cliTableDataRows: 112,
  // Function-form pre-handler identity, measured on both trees: 148
  // object-with-function plus 1 bare function, of which 148 are exports of
  // lib/util/helpers.js and 1 is the inline pre-handler declared in place on
  // POST /api/users/login (see EXPECTED_UNRESOLVED_PRE_ENTRIES).
  preFunctionFormEntries: 149,
  preFunctionIdentitiesRecovered: 148,
  preFunctionIdentitiesUnresolved: 1
};

// The function-form pre-handlers whose declared export name cannot be recovered
// because there is none. Measured, one on each tree: the SECOND pre-handler of
// `POST /api/users/login`, which is declared INLINE - `{ method: function
// (request, h) { return true; }, assign: 'encryptRoles' }` - beside a first
// entry that is the export `helpers.lowerUserFields`. Named with its index
// rather than merely counted, so that a DIFFERENT entry losing its identity is
// a failure even though the count would still be 1.
var EXPECTED_UNRESOLVED_PRE_ENTRIES = [
  'POST /api/users/login pre[1]'
];

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
  '  --verify-provenance <path...>    Verify that every named artifact or',
  '                                   generated document carries a provenance',
  '                                   block whose generator blob and commit',
  '                                   resolve in THIS repository, that each',
  '                                   artifact hashes to its own recorded',
  '                                   digest - a JSON payload, a Markdown body,',
  '                                   and a sidecar\'s bytes where one sits',
  '                                   beside it - and that the whole set',
  '                                   describes ONE target state. Exits 1 on',
  '                                   any failure.',
  '  --allow-unverified               In --verify-provenance mode, do not fail',
  '                                   an artifact whose generator source is not',
  '                                   yet committed. A delivery must verify',
  '                                   without it.',
  '  --compare-cli <base.json>        Compare two --cli-table artifacts across',
  '                <tgt.json>         trees, byte for byte, form by form.',
  '  --verify                         Regenerate and check that the manifest',
  '                                   already at --out is byte-identical to',
  '                                   what the tree emits now. This is how a',
  '                                   COMMITTED artifact is shown to still',
  '                                   describe its tree: its provenance can',
  '                                   only ever record the commit BEFORE the',
  '                                   one containing it, so a HEAD comparison',
  '                                   cannot answer the question and this does.',
  '  --help                           This text.',
  '',
  '  The five modes are mutually exclusive.',
  '',
  'OPTIONS',
  '  --app <path>   Root of the worktree to analyse. Defaults to this tool\'s',
  '                 own repository root, two levels above test/parity/. Point',
  '                 it at a `git worktree` to capture a baseline with tooling',
  '                 that does not exist at that commit.',
  '  --out <path>   Artifact path. Generation also writes the sibling',
  '                 <out>.provenance.json. In --compare mode the report is',
  '                 written here in addition to stderr. REQUIRED for generation',
  '                 and for --cli-table unless ' + ARTIFACT_DIR_ENV + ' names a',
  '                 directory to put the default filenames in - there is no',
  '                 repository default, so no run writes into tracked source',
  '                 unless it was asked to. The committed evidence is written',
  '                 with --out test/parity/' + ARTIFACT_NAMES.manifest + '.',
  '',
  'OPTION RULES',
  '  No option here is repeatable: a second --app, --out, --compare or',
  '  --cli-table is a usage error, never a last-one-wins. A value beginning',
  '  with "-" is a usage error as well, so a missing value cannot swallow the',
  '  following option; a lone "-" is accepted.',
  '',
  'ENVIRONMENT',
  '  ' + ARTIFACT_DIR_ENV + '   Directory for default artifact paths:',
  '                         <dir>/' + ARTIFACT_NAMES.manifest + ' for generation,',
  '                         <dir>/' + ARTIFACT_NAMES.cliTable + ' for --cli-table.',
  '',
  'EXIT CODES',
  '  0  success, or a comparison that found no difference',
  '  1  a difference that fails the gate:',
  '       - --compare        any entry differs, or is present on one side only',
  '       - --compare-cli    any invocation form differs across the two trees,',
  '                          or a captured data-row count differs from the',
  '                          verified baseline',
  '       - --cli-table      the three forms diverged within one tree, or a',
  '                          form\'s data-row count differs from the verified',
  '                          baseline',
  '       - generation       a summary figure differs from the verified',
  '                          baseline; the artifact is still written in full',
  '       - --verify         the manifest at --out is not byte-identical to',
  '                          what the tree emits now',
  '  2  usage or operational failure, including a provenance sidecar that is',
  '     present but inconsistent with the manifest or the tree it names',
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
 * NO OPTION HERE IS REPEATABLE, so a second occurrence of any of the four is a
 * usage error rather than a last-one-wins, and a value beginning with a dash is
 * a usage error rather than a consumed option token. Both rules exist because
 * this tool WRITES A FILE: a mis-parsed `--out` produces an artifact somewhere
 * the caller did not ask for and a gate that compares the one it expected.
 *
 * @param {string[]} args process.argv.slice(2)
 * @param {string} originalCwd The working directory at process start.
 * @returns {{mode: string, appRoot: string, out: (string|null),
 *            compare: string[], compareCli: string[]}}
 * @throws {ToolError} On an unknown flag or a missing/duplicated value.
 */
function parseArguments(args, originalCwd) {
  var options = {
    mode: 'generate',
    appRoot: TOOL_ROOT,
    out: null,
    compare: [],
    compareCli: [],
    // --verify-provenance: the whole set of delivered evidence in one
    // invocation, so one command establishes that it describes one target
    // state.
    verify: [],
    allowUnverified: false
  };
  var sawApp = false;
  var sawOut = false;
  var sawCompare = false;
  var sawCliTable = false;
  var i;

  // ANY leading dash disqualifies a token from being a value, not just a `--`
  // prefix. The narrower test let a single-dash token through, so
  // `--out -o` recorded a manifest path of "-o"; this tool writes files, and a
  // path it was not asked for is the one mistake it must not make quietly. The
  // one accepted dash-leading value is a bare `-`, which no option here means
  // as a flag.
  function value(flag, index) {
    var next = args[index + 1];

    if (next === undefined ||
        (next.charAt(0) === '-' && next !== '-')) {
      throw new ToolError(flag + ' requires a value, and ' +
        (next === undefined ? 'none follows it' : JSON.stringify(next) +
        ' is an option'));
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
        if (options.mode === 'compare-cli') {
          throw new ToolError('--compare and --compare-cli are mutually exclusive');
        }
        if (options.mode === 'verify') {
          throw new ToolError('--compare and --verify are mutually exclusive');
        }
        if (sawCompare) {
          throw new ToolError('--compare given more than once');
        }
        sawCompare = true;
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
        if (options.mode === 'compare-cli') {
          throw new ToolError('--cli-table and --compare-cli are mutually exclusive');
        }
        if (options.mode === 'verify') {
          throw new ToolError('--cli-table and --verify are mutually exclusive');
        }
        if (sawCliTable) {
          throw new ToolError('--cli-table given more than once');
        }
        sawCliTable = true;
        options.mode = 'cli-table';
        break;

      case '--verify':
        if (options.mode === 'compare') {
          throw new ToolError('--compare and --verify are mutually exclusive');
        }
        if (options.mode === 'cli-table') {
          throw new ToolError('--cli-table and --verify are mutually exclusive');
        }
        if (options.mode === 'compare-cli') {
          throw new ToolError('--compare-cli and --verify are mutually exclusive');
        }
        options.mode = 'verify';
        break;

      case '--verify-provenance':
        if (options.mode !== 'generate') {
          throw new ToolError('--verify-provenance cannot be combined with ' +
            'another mode');
        }
        // Every following non-flag token is an artifact to verify. The list is
        // open-ended on purpose: the point of the mode is to take the WHOLE
        // set of delivered evidence in one invocation and answer whether it
        // describes one target state, and a fixed arity could not express it.
        while (args[i + 1] !== undefined && args[i + 1].indexOf('--') !== 0) {
          options.verify.push(path.resolve(originalCwd, args[i + 1]));
          i += 1;
        }
        if (!options.verify.length) {
          throw new ToolError('--verify-provenance requires at least one ' +
            'artifact or generated document');
        }
        options.mode = 'verify-provenance';
        break;

      case '--allow-unverified':
        options.allowUnverified = true;
        break;

      case '--compare-cli':
        if (options.mode === 'compare') {
          throw new ToolError('--compare and --compare-cli are mutually exclusive');
        }
        if (options.mode === 'cli-table') {
          throw new ToolError('--cli-table and --compare-cli are mutually exclusive');
        }
        if (options.mode === 'verify') {
          throw new ToolError('--compare-cli and --verify are mutually exclusive');
        }
        // Baseline first, target second, exactly as --compare reads them, so
        // that one habit covers both gates and a transposed pair reads as such
        // in the report rather than passing silently.
        options.compareCli = [
          path.resolve(originalCwd, value('--compare-cli', i)),
          path.resolve(originalCwd, value('--compare-cli', i + 1))
        ];
        options.mode = 'compare-cli';
        i += 2;
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

/**
 * The SHA-256 digest of an artifact's exact bytes, as 'sha256:<hex>'.
 *
 * Recorded in the provenance sidecar and recomputed by
 * verifyManifestProvenance. The algorithm is named in the value rather than
 * assumed, so a sidecar written by a later version of this tool that changed
 * algorithm is recognisably different rather than silently mismatched.
 *
 * The digest is taken over the SAME STRING that is handed to writeArtifact, not
 * over a re-read of the file, so the recorded value always corresponds to what
 * was written even if the write itself failed - a truncated artifact then fails
 * verification instead of passing it.
 *
 * @param {string} text The exact artifact text, utf8.
 * @returns {string}
 */
function digestOf(text) {
  return 'sha256:' + crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The digest of a file's bytes, or null when it cannot be read.
 *
 * Null rather than a throw, because the only caller records the digests of the
 * two manifests a comparison was reached over, and a comparison that has
 * already succeeded must not be turned into a failure by a file that became
 * unreadable while its result was being written. A null in the artifact says
 * "not established" where a missing field would say nothing at all.
 *
 * @param {string} target Absolute path.
 * @returns {(string|null)}
 */
function digestOfFile(target) {
  try {
    return digestOf(fs.readFileSync(target, 'utf8'));
  }
  catch (err) {
    return null;
  }
}

/**
 * Every input that determines the manifest, as repository-relative paths and
 * glob-free directory expansions.
 *
 * This list is the answer to a question a commit hash cannot answer. A
 * provenance sidecar records the analysed tree's HEAD, and for a COMMITTED
 * artifact that HEAD is necessarily the commit BEFORE the one containing it -
 * the hash does not exist until the commit does, and the artifact has to be in
 * it. So the recorded commit can never be the delivered commit, and a reader
 * asking "was this evidence produced from the source I am looking at?" gets no
 * answer from it.
 *
 * Content answers it. Digesting the files that actually decide every field of
 * the manifest gives an identity that is knowable at generation time, stable
 * across the commit that adds the artifact, and falsified the moment any of
 * those files changes - which is exactly the property the commit hash lacks in
 * one direction and over-supplies in the other. It also catches what a HEAD
 * comparison misses entirely: a dirty working tree matches its own HEAD.
 *
 * The set is derived from what the generator reads, not from convenience:
 *   - this tool itself, since it decides which fields exist and how
 *   - the two declaration modules and `config/constants`, which supply the
 *     routes and the language expansion
 *   - `lib/util/routeParser.js`, which parses them and adds the static routes
 *     and static pages
 *   - `lib/util/helpers.js`, whose exports give the pre-handler identities
 *   - `app.js`, from which the server default auth is read
 *   - every controller, because `handlerKind` distinguishes a real handler from
 *     `missing-controller-fallback` by whether the named method EXISTS on the
 *     controller module
 *   - the two configuration files that decide the static-page directory, the
 *     cache prefix and the (all-empty) prefix list
 *   - the static page templates, which `addStaticPages` reads by directory
 *     listing, so ADDING one adds a route
 *
 * A file absent from the analysed tree is recorded as absent rather than
 * skipped: its absence is part of the tree's identity, and a silently omitted
 * entry would let two different trees produce one digest.
 */
var MANIFEST_SOURCE_FILES = [
  'test/parity/manifest.js',
  'app.js',
  'config/constants.js',
  'config/routes.js',
  'config/api_routes.js',
  'config/default.yaml',
  'config/test.yaml',
  'lib/util/routeParser.js',
  'lib/util/helpers.js'
];

// Expanded by directory listing rather than named one by one, because the
// CONTENTS of these directories are themselves inputs: a new controller or a
// new static page changes the manifest.
var MANIFEST_SOURCE_DIRECTORIES = [
  { directory: 'lib/controllers', extension: '.js' },
  { directory: 'lib/views/static', extension: '.html' }
];

/**
 * Digests every input that determines the manifest, for the provenance sidecar.
 *
 * @param {string} appRoot Absolute path of the analysed tree.
 * @returns {{files: Object, combined: string, absent: string[]}}
 */
function measureManifestSources(appRoot) {
  var relatives = MANIFEST_SOURCE_FILES.slice(0);
  var files = {};
  var absent = [];
  var combined;

  MANIFEST_SOURCE_DIRECTORIES.forEach(function (spec) {
    var entries;

    try {
      entries = fs.readdirSync(path.join(appRoot, spec.directory));
    }
    catch (err) {
      absent.push(spec.directory + '/ (' + err.code + ')');
      return;
    }

    entries.filter(function (name) {
      return name.slice(-spec.extension.length) === spec.extension;
    }).sort().forEach(function (name) {
      relatives.push(spec.directory + '/' + name);
    });
  });

  relatives.sort().forEach(function (relative) {
    var digest = digestOfFile(path.join(appRoot, relative));

    if (digest === null) {
      absent.push(relative);
    }

    // Recorded either way, null included: an absent input is part of what this
    // tree is, and dropping the key would let a tree missing a controller
    // digest identically to one that has it.
    files[relative] = digest;
  });

  // One value over the per-file map, so a consumer can compare trees with a
  // single string while still being able to see WHICH file moved.
  combined = digestOf(Object.keys(files).map(function (relative) {
    return relative + ' ' + files[relative];
  }).join('\n'));

  return { files: files, combined: combined, absent: absent };
}

/**
 * How a path is named inside a committed comparison result.
 *
 * Repository-relative when the path is inside this tool's worktree, absolute
 * otherwise. The comparison results are committed evidence, and the paths they
 * name are almost always the artifacts committed beside them - so recording
 * `test/parity/route-manifest.json` rather than the absolute path of whichever
 * ephemeral clone happened to generate it is the difference between an
 * identifier a later reader can act on and one that names a directory that no
 * longer exists. A path genuinely outside the worktree, such as a baseline
 * `git worktree`, has no repository-relative form and is recorded in full.
 *
 * This does NOT apply to the provenance sidecar's `tree.appRoot` or
 * `tool.worktree`: those are resolved with `fs.realpathSync` and compared
 * against a live directory by verifyManifestProvenance, so they have to stay
 * absolute to mean anything.
 *
 * @param {string} target Absolute path.
 * @returns {string}
 */
function artifactPathLabel(target) {
  var relative = path.relative(TOOL_ROOT, target);

  if (!relative || relative.indexOf('..') === 0 || path.isAbsolute(relative)) {
    return target;
  }

  return relative;
}


// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/**
 * The destination for an artifact the caller did not name.
 *
 * Resolves inside ARTIFACT_DIR_ENV when it is set, and otherwise fails naming
 * both ways to supply one. It never falls back to a path inside this
 * repository: see the comment on ARTIFACT_DIR_ENV.
 *
 * @param {string} basename One of ARTIFACT_NAMES.
 * @param {string} flag The flag that would have named it, for the message.
 * @returns {string} An absolute path.
 * @throws {ToolError} If no destination was supplied.
 */
function resolveArtifactPath(basename, flag) {
  var configured = process.env[ARTIFACT_DIR_ENV];

  if (typeof configured === 'string' && configured.trim()) {
    return path.resolve(configured.trim(), basename);
  }

  throw new ToolError(flag + ' is required: this tool has no repository ' +
    'default, so that an invocation without a destination cannot write into ' +
    'tracked source. Pass ' + flag + ' <path>, or set ' + ARTIFACT_DIR_ENV +
    ' to a scratch directory and the artifact goes to <dir>/' + basename + '. ' +
    'To write the committed evidence, name it: ' + flag + ' test/parity/' +
    basename);
}

// Counter behind the temporary filenames below, so two artifacts written in
// the same millisecond by the same process cannot collide.
var artifactSequence = 0;

/**
 * Writes a text artifact atomically, creating its directory if needed.
 *
 * The artifact is written to a unique temporary file in its own directory,
 * flushed, closed and then renamed over the target. A same-directory rename is
 * atomic, so a reader sees either the previous artifact or the complete new
 * one - never a half-written file. Writing in place instead would let an
 * interruption or a full filesystem truncate the last known-good evidence,
 * which for a gate artifact is the one copy that mattered.
 *
 * The temporary file is removed on failure, so a failed run leaves the
 * directory as it found it.
 *
 * @param {string} target Absolute path.
 * @param {string} text
 * @returns {undefined}
 * @throws {ToolError} If the directory cannot be created or the file written.
 */
function writeArtifact(target, text) {
  var temporary;
  var descriptor = null;

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  catch (err) {
    throw new ToolError('cannot create directory for ' + target + ': ' + err.message);
  }

  artifactSequence += 1;
  temporary = target + '.parity-tmp-' + process.pid + '-' + artifactSequence;

  try {
    // 'wx' rather than 'w': a temporary name that already exists is a
    // collision worth failing on, not a file to overwrite.
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, text, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, target);
  }
  catch (err) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      }
      catch (closeError) {
        // Reported through the original failure below; a close error while
        // already failing must not replace the reason the write failed.
      }
    }

    try {
      fs.unlinkSync(temporary);
    }
    catch (unlinkError) {
      // The temporary file may never have been created. Either way the
      // artifact itself is untouched, which is the guarantee that matters.
    }

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
 * Verifies that a manifest's provenance sidecar describes THAT manifest AND
 * THAT tree - the check that makes a shared default artifact un-poisonable.
 *
 * test/parity/capture.js and test/parity/replay.js both default their manifest
 * to the SAME path, test/parity/route-manifest.json, and consume it whenever it
 * happens to exist. A baseline manifest left at that path is therefore silently
 * consumed by a target replay, and every route it names is then judged against
 * the wrong tree's HTTP surface - a false PASS with nothing to notice it, since
 * a manifest of the wrong tree is still a structurally valid manifest.
 * `readManifest` cannot detect that: it validates JSON shape, and shape is
 * exactly what the two trees share. Identity is what differs, and identity
 * lives in the sidecar.
 *
 * This function is the FILE-INTEGRITY half, and it needs nothing but the two
 * files. Four conditions, each fatal and each named in the message:
 *   1. the sidecar is missing or unparseable          - no identity to check
 *   2. `artifact` is not the manifest's own basename  - sidecar of another file
 *   3. `schema` differs from the manifest's           - different tool version
 *   4. `digest` differs from the manifest's bytes     - edited or truncated
 *
 * `verifyManifestProvenance` below adds the TREE-BINDING half - `tree.appRoot`
 * and `tree.head` against a tree the caller supplies - which is what actually
 * closes the poisoning case and which only a caller holding that tree can ask.
 *
 * Paths are compared through `fs.realpathSync` ON BOTH SIDES, so a symlinked
 * worktree, a trailing separator or a differently spelled but identical path is
 * not reported as a mismatch - only a genuinely different tree is.
 *
 * A null HEAD on either side is treated as UNVERIFIABLE AND FATAL, not as
 * permission to continue. `gitHead` returns null for a directory outside a
 * repository, and that is the one situation in which nothing distinguishes a
 * baseline artifact from a target one: passing it silently would readmit the
 * whole failure this function exists to close. A caller that legitimately has
 * no git tree must compare manifests it generated itself rather than trust a
 * sidecar it cannot check.
 *
 * @param {string} manifestPath Absolute path of the manifest.
 * @param {string} appRoot Absolute path of the tree the caller intends to use
 *   the manifest for.
 * @returns {Object} The parsed, verified sidecar.
 * @throws {ToolError} On any of the six conditions above.
 */
function verifyManifestIntegrity(manifestPath) {
  var sidecarPath = manifestPath + PROVENANCE_SUFFIX;
  var sidecarText;
  var sidecar;
  var manifestText;
  var parsedManifest;
  var recomputed;

  try {
    sidecarText = fs.readFileSync(sidecarPath, 'utf8');
  }
  catch (err) {
    throw new ToolError('no usable provenance for manifest ' + manifestPath +
      ': cannot read its sidecar ' + sidecarPath + ' (' + err.message + '). ' +
      'Regenerate the manifest so the sidecar is written beside it.');
  }

  try {
    sidecar = JSON.parse(sidecarText);
  }
  catch (err) {
    throw new ToolError('provenance sidecar ' + sidecarPath +
      ' is not valid JSON: ' + err.message);
  }

  if (!isPlainObject(sidecar)) {
    throw new ToolError('provenance sidecar ' + sidecarPath +
      ' is not a JSON object');
  }

  if (sidecar.artifact !== path.basename(manifestPath)) {
    throw new ToolError('provenance sidecar ' + sidecarPath + ' describes ' +
      JSON.stringify(sidecar.artifact) + ', not ' +
      JSON.stringify(path.basename(manifestPath)) +
      ': it belongs to a different artifact');
  }

  try {
    manifestText = fs.readFileSync(manifestPath, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot read manifest ' + manifestPath +
      ' to verify its provenance: ' + err.message);
  }

  try {
    parsedManifest = JSON.parse(manifestText);
  }
  catch (err) {
    throw new ToolError('manifest ' + manifestPath +
      ' is not valid JSON, so its provenance cannot be verified: ' +
      err.message);
  }

  if (sidecar.schema !== parsedManifest.schema) {
    throw new ToolError('provenance sidecar ' + sidecarPath + ' records schema ' +
      JSON.stringify(sidecar.schema) + ' but manifest ' + manifestPath +
      ' declares schema ' + JSON.stringify(parsedManifest.schema) +
      ': the two were not produced by one run of this tool');
  }

  recomputed = digestOf(manifestText);

  if (sidecar.digest !== recomputed) {
    throw new ToolError('manifest ' + manifestPath + ' does not match the ' +
      'digest its provenance records: sidecar ' + sidecarPath + ' has ' +
      JSON.stringify(sidecar.digest === undefined ? null : sidecar.digest) +
      ', the file on disk hashes to ' + JSON.stringify(recomputed) +
      '. The manifest has been edited, truncated or replaced since it was ' +
      'generated.');
  }

  return { sidecar: sidecar, manifest: parsedManifest, digest: recomputed };
}

/**
 * Verifies a manifest's INTEGRITY and then binds it to a specific tree.
 *
 * Integrity is `verifyManifestIntegrity` above. The binding is the other two
 * conditions - `tree.appRoot` and `tree.head` - and it is what closes the
 * poisoning case, because a baseline manifest and a target manifest are
 * structurally identical and differ only in which tree produced them.
 *
 * The split matters because the two halves answer different questions and are
 * needed in different places. Integrity asks "is this file the one its sidecar
 * describes", and the two files answer it between them, anywhere, forever. The
 * binding asks "does it describe the tree I am about to drive", which only a
 * caller holding that tree can ask - so `--compare`, which is handed two
 * recorded artifacts and no tree, verifies integrity and reports the recorded
 * tree rather than failing on it, while `readManifestForApp`, which exists to
 * refuse a manifest of the wrong tree, requires both.
 *
 * @param {string} manifestPath Absolute path of the manifest.
 * @param {string} appRoot The tree the caller intends the manifest to describe.
 * @returns {Object} The parsed sidecar.
 * @throws {ToolError} Naming the first condition that failed.
 */
function verifyManifestProvenance(manifestPath, appRoot) {
  var sidecar = verifyManifestIntegrity(manifestPath).sidecar;

  verifyTreeBinding(manifestPath, sidecar, appRoot);

  return sidecar;
}

/**
 * The tree-binding half, applied to a sidecar ALREADY read.
 *
 * Separate from the read so that a caller which has verified a manifest can
 * bind THAT snapshot rather than re-opening the path. `readManifestForApp` used
 * to verify one read of the file and then return a second, independent read of
 * it - a check/use gap in which the bytes that passed verification are not
 * necessarily the bytes the caller gets. The window is small and the failure is
 * silent, which is the worst combination for a function whose entire purpose is
 * to refuse a manifest that does not belong to the tree.
 *
 * @param {string} manifestPath Absolute path, for diagnostics.
 * @param {Object} sidecar The parsed provenance sidecar.
 * @param {string} appRoot The tree the caller intends the manifest to describe.
 * @returns {undefined}
 * @throws {ToolError} Naming the first condition that failed.
 */
function verifyTreeBinding(manifestPath, sidecar, appRoot) {
  var sidecarPath = manifestPath + PROVENANCE_SUFFIX;
  var recordedRoot;
  var suppliedRoot;
  var currentHead;
  var recordedSources;
  var currentSources;
  var moved;

  if (!sidecar.tree || typeof sidecar.tree.appRoot !== 'string') {
    throw new ToolError('provenance sidecar ' + sidecarPath +
      ' records no tree.appRoot, so the manifest cannot be attributed to a tree');
  }

  try {
    recordedRoot = fs.realpathSync(sidecar.tree.appRoot);
  }
  catch (err) {
    throw new ToolError('provenance sidecar ' + sidecarPath + ' attributes ' +
      manifestPath + ' to ' + sidecar.tree.appRoot +
      ', which cannot be resolved on this host (' + err.message +
      '), so the manifest cannot be shown to describe ' + appRoot);
  }

  try {
    suppliedRoot = fs.realpathSync(appRoot);
  }
  catch (err) {
    throw new ToolError('cannot resolve the supplied app root ' + appRoot +
      ' while verifying ' + manifestPath + ': ' + err.message);
  }

  if (recordedRoot !== suppliedRoot) {
    throw new ToolError('manifest ' + manifestPath + ' describes the tree at ' +
      recordedRoot + ', not ' + suppliedRoot +
      '. Using it here would judge one tree by the other tree\'s HTTP ' +
      'surface; generate a manifest for ' + suppliedRoot + ' instead.');
  }

  // CONTENT IDENTITY, checked before the commit identity, because it is the
  // stronger of the two and because it is the one that can succeed for a
  // committed artifact. `sources.combined` digests every input that determines
  // the manifest; if it still matches, this manifest provably describes THIS
  // tree's HTTP surface, whatever commit the tree is now on and whether or not
  // the tree is dirty.
  recordedSources = sidecar.tree && sidecar.tree.sources &&
    typeof sidecar.tree.sources.combined === 'string'
    ? sidecar.tree.sources.combined
    : null;

  if (recordedSources !== null) {
    currentSources = measureManifestSources(suppliedRoot);

    if (recordedSources === currentSources.combined) {
      // Bound by content. Nothing the commit hash could add.
      return;
    }

    moved = Object.keys(currentSources.files).filter(function (relative) {
      return sidecar.tree.sources.files[relative] !== currentSources.files[relative];
    });

    throw new ToolError('manifest ' + manifestPath + ' was generated from ' +
      recordedRoot + ' when its manifest-determining sources hashed to ' +
      recordedSources + ', and they now hash to ' + currentSources.combined +
      '. ' + moved.length + ' input(s) changed: ' +
      moved.slice(0, 8).join(', ') +
      (moved.length > 8 ? ', and ' + (moved.length - 8) + ' more' : '') +
      '. The manifest may no longer describe this tree; regenerate it, or ' +
      'establish that it still reproduces with `node ' +
      path.relative(TOOL_ROOT, __filename) + ' --verify --out ' + manifestPath +
      '`.');
  }

  // No sources block: an older sidecar. Fall back to the commit identity, which
  // is all such a sidecar carries.
  currentHead = gitHead(suppliedRoot);

  if (sidecar.tree.head === null || sidecar.tree.head === undefined) {
    throw new ToolError('provenance sidecar ' + sidecarPath + ' records ' +
      'neither a sources digest nor a HEAD for ' + recordedRoot +
      ', so the manifest is UNVERIFIABLE: nothing distinguishes it from a ' +
      'manifest of another commit. Regenerate it inside a git worktree.');
  }

  if (currentHead === null) {
    throw new ToolError(appRoot + ' has no readable git HEAD and the sidecar ' +
      'records no sources digest, so manifest ' + manifestPath +
      ' is UNVERIFIABLE against it: the sidecar records HEAD ' +
      sidecar.tree.head + ' and there is nothing to compare it with.');
  }

  if (sidecar.tree.head !== currentHead) {
    // Strict, because a manifest from another commit may describe another HTTP
    // surface and a sidecar without a sources block gives no way to tell.
    throw new ToolError('manifest ' + manifestPath + ' was generated from ' +
      recordedRoot + ' at HEAD ' + sidecar.tree.head + ', but that tree is now ' +
      'at HEAD ' + currentHead + ', and the sidecar records no sources digest ' +
      'to fall back on. Regenerate the manifest, or establish that it still ' +
      'describes the tree with `node ' +
      path.relative(TOOL_ROOT, __filename) + ' --verify --out ' + manifestPath +
      '`, which compares the bytes rather than the commit.');
  }
}

/**
 * Reads a manifest ONLY IF its provenance proves it describes `appRoot`.
 *
 * The consumer-facing form of verifyManifestProvenance, so that a caller which
 * today does `if (fs.existsSync(p)) return readManifest(p)` against a SHARED
 * default path replaces one call with one call and gets the identity check for
 * free. `readManifest` is deliberately left exactly as it was and still
 * exported: it is the right function for a manifest the caller has just
 * generated itself, and the wrong one for a manifest it merely found.
 *
 * @param {string} manifestPath Absolute path of the manifest.
 * @param {string} appRoot Absolute path of the tree it must describe.
 * @returns {Object} The parsed manifest.
 * @throws {ToolError} If provenance verification fails, or the manifest is not
 *   readable, not JSON or not of the expected shape.
 */
function readManifestForApp(manifestPath, appRoot) {
  // ONE read, verified and then returned. Calling verifyManifestProvenance and
  // then readManifest would read the file twice and hand back the second read,
  // so the bytes the caller consumes would not be the bytes the digest check
  // passed. verifyManifestIntegrity already parses the manifest to check it, so
  // the verified value is in hand; returning it is both correct and cheaper.
  var verified = verifyManifestIntegrity(manifestPath);

  verifyTreeBinding(manifestPath, verified.sidecar, appRoot);

  if (!verified.manifest || !Array.isArray(verified.manifest.entries)) {
    throw new ToolError('manifest ' + manifestPath + ' has no `entries` array');
  }

  return verified.manifest;
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
 * That tolerance belongs to RECORDING and not to VERIFYING, and the two must not
 * be confused. verifyManifestProvenance treats a null HEAD on either side as
 * fatal, because a commit that cannot be named also cannot be checked, and an
 * unverifiable manifest consumed for the wrong tree is the exact failure it
 * exists to prevent.
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
      stdio: ['ignore', 'pipe', 'ignore'],
      // Finite, because this call is synchronous: a `git` that blocked - on a
      // lock held by another process, on a filesystem that stopped answering -
      // would hang the whole generator on a step whose only product is a
      // provenance string. The timeout lands in the catch below and the
      // manifest is still produced, unnamed.
      timeout: GIT_TIMEOUT_MS,
      killSignal: 'SIGKILL'
    });
  }
  catch (err) {
    // A timeout is said out loud, unlike the ordinary failures this catch
    // absorbs: "this is not a checkout" and "git took longer than ten seconds
    // and was killed" are different facts, and only the second is worth a
    // reader's attention. Either way the manifest is still produced, with the
    // commit recorded as unknown.
    if (err && err.code === 'ETIMEDOUT') {
      note('WARNING: `git rev-parse HEAD` in ' + directory + ' did not ' +
        'finish within ' + GIT_TIMEOUT_MS + 'ms and was killed; this ' +
        'artifact records no commit for that tree.');
    }

    return null;
  }

  output = String(output).trim();

  return output || null;
}

// ===========================================================================
// THE PROVENANCE CONTRACT
//
// Shared by every tool in test/parity/ and by the two generated inventories in
// docs/. It lives here because this file is the only one of the nine that is
// Node-core-only at module scope, is already required by capture.js and
// replay.js, and adds no path to the delivery.
//
// WHY IT EXISTS. Each tool used to identify its own generator by the git HEAD
// of whatever worktree happened to run it, and nothing checked that the
// recorded SHA resolved in the repository the artifact was delivered into. An
// artifact produced in one clone therefore named a commit that existed only
// there. Three delivered artifacts did exactly that: two inventories named
// `d65ad861...` and `7feda413...`, neither of which is an object in this
// repository, and a joi sidecar named `6da0a28...`, which IS a commit here but
// predates the creation of test/parity/joi-matrix.js and so cannot have
// produced the artifact that cited it. The same blocks carried run-local data -
// absolute worktree roots, a live PID, a wall clock, ports, a database name -
// which made two correct runs of one tool differ for reasons that say nothing
// about the tree, and leaked a sibling clone's identity into the delivery.
//
// THE FIX, AND WHY IT IS THE BLOB. A generator is identified by its git BLOB
// id - the hash of its exact bytes - and not by a commit id. A blob is
// worktree-independent: `git hash-object` computes the same 40 hex characters
// in every clone, and `git cat-file blob <id>` returns the exact generator in
// any clone that contains the file, so the identity survives being delivered
// from a different worktree than the one that ran the tool. The commit is
// recorded too, but only after it has been RESOLVED - the newest commit whose
// tree holds that exact blob at that path - and `verified` says whether that
// resolution succeeded. When no commit holds the running source, `commit` is
// null and `commitState` says `uncommitted-source` rather than naming a commit
// that cannot reproduce the artifact.
//
// FOUR RULES, ENFORCED RATHER THAN DOCUMENTED
//   1. A provenance block names a commit only when that commit is verified to
//      contain the exact source that ran. assertProvenance() below is what
//      makes an unverified claim impossible to emit silently.
//   2. A provenance block carries NO run-local data. assertPortable() throws on
//      an absolute path, an ISO timestamp, or any of the field names the review
//      named - pid, port, runDir, execPath, appRoot, database. A tool that
//      needs to name a path uses pathLabel(), which yields a symbolic label.
//   3. Every artifact is hash-linked to its own provenance: attach() embeds the
//      block together with a digest of the artifact WITHOUT it, so a consumer
//      recomputes the digest and detects an artifact whose provenance was
//      swapped in from elsewhere.
//   4. Every block records the DELIVERED head - the HEAD of the tool's own
//      worktree - which is the field that lets one command establish that a set
//      of artifacts describes one target state.
// ===========================================================================

// The provenance schema. Bumped from the implicit 1 because the field set is
// different in kind, not merely in content: `generator.blob` and
// `generator.verified` did not exist, and a consumer that accepted a v1 block
// would be accepting exactly the unverifiable claim this contract removes.
var PROVENANCE_SCHEMA = 2;

// AAP §0.10.3's base commit, in full. Every baseline claim in this delivery is
// a claim about this tree, so the tools assert it rather than trusting a
// caller's `--app` to be pointed at the right worktree.
var BASELINE_HEAD = '2f8712a112db46f923918c4507c75abc732d83d0';

// What an artifact IS, recorded rather than inferred from which flags ran.
//   baseline    measured on a worktree at BASELINE_HEAD
//   target      measured on the migrated tree
//   analysis    derived by reading a tree, with no application executed
//   unreviewed  measured on neither - a caller passed the explicit escape
//               hatch, and the artifact does not qualify as gate evidence
var PROVENANCE_ROLES = ['baseline', 'target', 'analysis', 'unreviewed'];

// Field names that carry run-local state. Rule 2 is enforced against this list
// because each one is a field the review found in a committed artifact, and a
// name-based check catches the value before it is written rather than after a
// reviewer notices it.
var PROVENANCE_PROHIBITED_KEYS = [
  'pid', 'ppid', 'port', 'ports', 'rundir', 'execpath', 'approot', 'root',
  'worktree', 'toolroot', 'database', 'capturedat', 'generatedat', 'timestamp',
  'startedat', 'finishedat', 'now', 'wallclock', 'hostname', 'homedir', 'cwd'
];

// An ISO-8601 instant. A wall clock is what makes two runs over one tree
// differ, so a committed block may not contain one.
var ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// An absolute filesystem path, POSIX or Windows. `pathLabel` exists so a tool
// never needs one.
var ABSOLUTE_PATH = /^(?:\/|[A-Za-z]:[\\/])/;

// The same two, unanchored, and they are the ones the guard actually uses.
//
// An earlier revision of this file tested only the anchored forms, which meant
// a value was rejected when it WAS a path and accepted when it merely
// CONTAINED one. That is backwards for the values most likely to carry one: a
// Node error message is `ENOENT: no such file or directory, open
// '/tmp/run/x'`, and a caption is `captured at 2026-09-04T01:02:03Z`. Both
// passed, and both put exactly the host state this guard exists to keep out of
// a committed artifact.
//
// The path form requires a separator and one path-ish character after the
// root, so a bare `/` or a fraction like `3/4` is not an offence, and it
// accepts a leading quote, `=`, `(`, `[` or whitespace as the lead-in that a
// message puts before a path.
var EMBEDDED_PATH = /(?:^|[\s'"`=(\[<:,])(?:\/[A-Za-z0-9_.@+-]+(?:\/[A-Za-z0-9_.@+-]*)*|[A-Za-z]:[\\/][A-Za-z0-9_.@+\\/-]+)/;
var EMBEDDED_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/;

// URI userinfo - `scheme://user:secret@host`. Digesting a connection string
// verbatim turns a committed artifact into an offline oracle for whatever is
// in front of the `@`, so it is removed before any digest is taken.
var URI_USERINFO = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@]*@/;

// Key names whose VALUE is a secret rather than a description of one. Matched
// case-insensitively as a substring, because the shapes in this repository's
// configuration are `secretkey`, `clientSecret`, `keyId`, `password` and
// `sessionPassword`, and an exact list would miss the next one.
var SECRET_KEY_HINTS = [
  'secret', 'password', 'passwd', 'token', 'apikey', 'api_key', 'keyid',
  'key_id', 'clientid', 'client_id', 'accesskey', 'privatekey', 'credential',
  'salt', 'signature'
];

// Key names whose value is run-local addressing: it varies per run without
// describing anything about the tree, so a digest over it is neither stable
// nor meaningful. Dropped rather than hashed.
var ADDRESS_KEY_HINTS = [
  'port', 'ports', 'host', 'hostname', 'database', 'db', 'uri', 'url',
  'connectionstring', 'address', 'socket', 'path', 'dir', 'directory'
];

// A full or abbreviated git object id.
var OBJECT_ID = /^[0-9a-f]{7,40}$/;

/**
 * Runs git in a directory and returns its trimmed stdout, or null.
 *
 * Both streams are piped and stderr is discarded: git writes "not a git
 * repository" there, and this tool's stderr sits inside the stream the
 * zero-warning gate inspects. A directory with no git metadata is a legitimate
 * input - `--app` may be an exported tree - so failure is a null, never a
 * throw. The timeout is finite because a git that blocks would hang a gate.
 *
 * @param {string} directory
 * @param {string[]} args
 * @returns {(string|null)}
 */
function gitCapture(directory, args) {
  var output;

  try {
    output = childProcess.execFileSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 15000
    });
  }
  catch (err) {
    return null;
  }

  output = String(output).trim();

  return output || null;
}

/**
 * True when a git object id resolves to an object in `directory`'s repository.
 *
 * This is the check whose absence let three artifacts name commits that do not
 * exist. `^{object}` is what makes it a real existence test rather than a
 * syntax test: `git cat-file -e` on a well-formed but absent id fails, which is
 * exactly the answer wanted.
 *
 * @param {string} directory
 * @param {(string|null)} id
 * @returns {boolean}
 */
function gitObjectExists(directory, id) {
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) {
    return false;
  }

  // The EXIT STATUS is the answer here, not the output: `cat-file -e` succeeds
  // with empty stdout, which gitCapture cannot tell apart from a failure.
  return gitCaptureStatus(directory, ['cat-file', '-e', id + '^{object}']);
}

/**
 * Whether `id` resolves to a COMMIT in this repository.
 *
 * Distinct from gitObjectExists because a 40-hex string that happens to be a
 * blob or a tree satisfies `cat-file -e <id>^{object}` while naming nothing a
 * head could mean. A recorded head is a commit or it is wrong.
 *
 * @param {string} directory
 * @param {string} id
 * @returns {boolean}
 */
function gitCommitExists(directory, id) {
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) {
    return false;
  }

  return gitCaptureStatus(directory, ['cat-file', '-e', id + '^{commit}']);
}

/**
 * Whether `id` is an ancestor of `descendant`, or the same commit.
 *
 * Needed by the chain verifier for a fact that is otherwise unprovable: a
 * COMMITTED artifact cannot record the hash of the commit that introduces it,
 * so every artifact in a delivery records a head at or before the delivered
 * one. "They all describe one target state" therefore cannot mean "they all
 * record the same string" - it means each recorded head is on the delivered
 * history, and each generator is still the blob that ran.
 *
 * @param {string} directory
 * @param {string} id
 * @param {string} descendant
 * @returns {boolean}
 */
function gitIsAncestor(directory, id, descendant) {
  if (typeof id !== 'string' || !OBJECT_ID.test(id)) {
    return false;
  }

  return gitCaptureStatus(directory,
    ['merge-base', '--is-ancestor', id, descendant]);
}

/**
 * The exit status of a git invocation, as a boolean.
 *
 * Needed alongside gitCapture because `cat-file -e` succeeds with EMPTY
 * stdout, which gitCapture cannot distinguish from a failure.
 *
 * @param {string} directory
 * @param {string[]} args
 * @returns {boolean}
 */
function gitCaptureStatus(directory, args) {
  var result;

  try {
    result = childProcess.spawnSync('git', args, {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 15000
    });
  }
  catch (err) {
    return false;
  }

  return !!result && result.status === 0;
}

/**
 * The git blob id of a file's exact current bytes, or null.
 *
 * `hash-object` hashes the FILE, not the index and not HEAD, so this identifies
 * the source that actually ran even when it is uncommitted or differs from
 * HEAD. That is the property the whole contract rests on.
 *
 * @param {string} directory A directory inside the repository.
 * @param {string} absolutePath The file to hash.
 * @returns {(string|null)}
 */
function gitBlobId(directory, absolutePath) {
  return gitCapture(directory, ['hash-object', '--', absolutePath]);
}

/**
 * The blob id recorded at `path` in `commit`'s tree, or null.
 *
 * @param {string} directory
 * @param {string} commit
 * @param {string} relativePath POSIX-separated, repository-relative.
 * @returns {(string|null)}
 */
function gitBlobAt(directory, commit, relativePath) {
  return gitCapture(directory, ['rev-parse', commit + ':' + relativePath]);
}

/**
 * The subject line of a commit, or null.
 *
 * @param {string} directory
 * @param {string} commit
 * @returns {(string|null)}
 */
function gitSubject(directory, commit) {
  return gitCapture(directory, ['log', '-1', '--format=%s', commit]);
}

/**
 * Whether a worktree has uncommitted changes.
 *
 * Recorded because a manifest generated from a dirty tree is evidence about
 * something no commit contains, and a reader must be able to see that.
 *
 * @param {string} directory
 * @returns {string} `clean`, `dirty` or `not-a-checkout`
 */
function gitWorktreeState(directory) {
  var status;

  if (gitCapture(directory, ['rev-parse', '--git-dir']) === null) {
    return 'not-a-checkout';
  }

  status = gitCapture(directory, ['status', '--porcelain']);

  return status === null ? 'clean' : 'dirty';
}

/**
 * The identity of a tree, WITHOUT its path.
 *
 * A path is where a tree sat on one machine; the HEAD is what it contained. The
 * review found `/tmp/blitzy-c5/baseline-2f8712a`, `/tmp/blitzy-c8/...` and
 * `/tmp/blitzy-c1/...` in delivered artifacts, all three naming the same
 * commit, which is the whole argument for recording the commit and dropping the
 * path.
 *
 * @param {string} root Absolute path of the tree. Used, not recorded.
 * @returns {{head: (string|null), headShort: (string|null),
 *            subject: (string|null), isBaselineCommit: boolean,
 *            worktreeState: string}}
 */
function treeIdentity(root) {
  var head = gitHead(root);

  return {
    head            : head,
    headShort       : head ? head.slice(0, 7) : null,
    subject         : head ? gitSubject(root, head) : null,
    isBaselineCommit: isBaselineHead(head),
    worktreeState   : gitWorktreeState(root)
  };
}

/**
 * True when a head is AAP §0.10.3's base commit.
 *
 * Accepts an abbreviation of at least seven characters so a caller may compare
 * against `2f8712a`, which is how the AAP writes it.
 *
 * @param {(string|null)} head
 * @returns {boolean}
 */
function isBaselineHead(head) {
  if (typeof head !== 'string' || !OBJECT_ID.test(head)) {
    return false;
  }

  return BASELINE_HEAD.indexOf(head) === 0 || head.indexOf(BASELINE_HEAD) === 0;
}

/**
 * The identity of the generator that produced an artifact.
 *
 * The commit is RESOLVED rather than reported: the candidates are the commits
 * that touched this path, newest first, plus HEAD, and the answer is the first
 * whose tree holds the blob that actually ran. So a commit appears here only
 * when `git cat-file blob` at that commit returns the exact source, and
 * `verified` is the field a consumer gates on.
 *
 * The candidate list is bounded. A generator with a long history would
 * otherwise cost one git invocation per commit, and the answer is always in the
 * first few: a blob is reachable from the commit that introduced it onward, and
 * the newest match is the one a reviewer wants.
 *
 * @param {string} absolutePath The generator file, absolute.
 * @param {string} toolRoot The generator's repository root, absolute.
 * @returns {Object}
 */
function generatorIdentity(absolutePath, toolRoot) {
  var relative = path.relative(toolRoot, absolutePath).split(path.sep).join('/');
  var blob     = gitBlobId(toolRoot, absolutePath);
  var head     = gitHead(toolRoot);
  var log      = gitCapture(toolRoot, ['log', '--format=%H', '-n', '40', '--', relative]);
  var candidates = [];
  var resolved = null;
  var i;

  if (head) {
    candidates.push(head);
  }
  if (log) {
    log.split('\n').forEach(function (line) {
      var commit = line.trim();
      if (commit && candidates.indexOf(commit) === -1) {
        candidates.push(commit);
      }
    });
  }

  if (blob) {
    for (i = 0; i < candidates.length; i++) {
      if (gitBlobAt(toolRoot, candidates[i], relative) === blob) {
        resolved = candidates[i];
        break;
      }
    }
  }

  return {
    path                : relative,
    blob                : blob,
    commit              : resolved,
    commitState         : blob === null
      ? 'not-a-checkout'
      : (resolved === null ? 'uncommitted-source' : 'contains-this-exact-source'),
    // True only when the recorded commit exists AND its tree holds the exact
    // bytes that ran. Both halves are checked: the review's joi sidecar named a
    // commit that existed, and that was not enough.
    verified            : resolved !== null &&
      gitObjectExists(toolRoot, resolved) &&
      gitBlobAt(toolRoot, resolved, relative) === blob,
    deliveredHead       : head,
    deliveredHeadShort  : head ? head.slice(0, 7) : null,
    // Whether the generator that ran is the one committed at the delivered
    // head. False is legitimate mid-change and is why it is recorded rather
    // than asserted.
    matchesDeliveredHead: !!(blob && head && gitBlobAt(toolRoot, head, relative) === blob)
  };
}

/**
 * The runtime, reduced to what is reproducible.
 *
 * `process.execPath` and the machine's architecture are deliberately absent:
 * neither can be reproduced from the repository, and both were among the
 * run-local values the review found in committed blocks.
 *
 * @returns {{node: string, platform: string}}
 */
function provenanceRuntime() {
  return { node: process.version, platform: process.platform };
}

/**
 * Canonical JSON: object keys sorted, no whitespace.
 *
 * Sorting is what makes the digest independent of the order a tool happened to
 * build its object in, so two runs that recorded the same facts produce the
 * same hash. Arrays keep their order, because in every artifact here order is
 * meaningful.
 *
 * @param {*} value
 * @returns {string}
 */
function canonicalJson(value) {
  var keys;
  var parts;

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }

  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }

  keys  = Object.keys(value).filter(function (key) {
    return value[key] !== undefined;
  }).sort();
  parts = keys.map(function (key) {
    return JSON.stringify(key) + ':' + canonicalJson(value[key]);
  });

  return '{' + parts.join(',') + '}';
}

/**
 * A digest record for a value or a string of bytes.
 *
 * The algorithm and the canonicalization travel with the hash, because a hash
 * whose derivation is not written down cannot be recomputed by a reviewer.
 *
 * @param {*} value An object to canonicalize, or a string taken verbatim.
 * @returns {{algorithm: string, canonicalization: string, value: string}}
 */
function provenanceDigest(value) {
  var verbatim = typeof value === 'string';
  var text     = verbatim ? value : canonicalJson(value);

  return {
    algorithm       : 'sha256',
    canonicalization: verbatim
      ? 'the artifact bytes as written, verbatim'
      : 'JSON with object keys sorted lexicographically and no whitespace',
    value           : crypto.createHash('sha256').update(text, 'utf8').digest('hex')
  };
}

/**
 * The digest a sidecar declares over the artifact beside it, resolved across
 * the two spellings the delivered writers use.
 *
 * `provenance.sidecar` records an `artifactDigest` OBJECT carrying
 * `{algorithm, canonicalization, value}`; this file's own `buildProvenance`
 * records a `digest` STRING with its algorithm prefixed (`sha256:<hex>`), and
 * that is the sidecar the delivered route manifest actually carries. Reading
 * only the first found nothing in the manifest's own sidecar, so a pair that
 * agrees byte for byte was reported as describing two different files - and
 * the check exists to catch a stale sidecar, which that failure mode hides.
 *
 * Returns null rather than a placeholder when nothing is declared, because an
 * unbound sidecar is the defect the caller is testing for.
 *
 * @param {Object} sidecar
 * @returns {(string|null)} the bare hex digest, or null when none is declared
 */
function sidecarArtifactDigest(sidecar) {
  var declared;

  if (!sidecar || typeof sidecar !== 'object') {
    return null;
  }

  declared = sidecar.artifactDigest === undefined
    ? sidecar.digest
    : sidecar.artifactDigest;

  if (declared && typeof declared === 'object') {
    declared = declared.value;
  }

  if (typeof declared !== 'string' || !declared) {
    return null;
  }

  return declared.replace(/^[A-Za-z0-9_-]+:/, '');
}

/**
 * A symbolic label for a path, so a block never has to carry an absolute one.
 *
 * Every path a parity tool wants to name is one of four things, and three of
 * them are reproducible as a label: a file in the tool's own repository, a file
 * in the tree under test, or a per-run scratch location whose only reproducible
 * part is its basename. The fourth - something outside all of them - is
 * recorded as its basename alone, because its directory is machine state.
 *
 * @param {(string|null)} target
 * @param {{toolRoot: (string|undefined), analysedRoot: (string|undefined)}} roots
 * @returns {(string|null)}
 */
function pathLabel(target, roots) {
  var bounds = roots || {};
  var relative;

  if (typeof target !== 'string' || !target) {
    return null;
  }

  // A path absolute under the OTHER platform's rules is outside every root by
  // construction, and it has to be caught before `isInside` sees it: that
  // helper calls path.relative, which resolves a string it does not recognize
  // as absolute against the process's cwd, so on Linux `C:\Users\ci\x.json`
  // came back as `tool:C:\Users\ci\x.json` - a label that both misattributes
  // the file and still carries the host path, so the guard then refuses to
  // write the artifact at all. Reduced to a basename taken with that
  // platform's separator.
  if (isForeignAbsolute(target)) {
    return 'ephemeral:' + foreignBasename(target);
  }

  if (bounds.toolRoot && isInside(bounds.toolRoot, target)) {
    relative = path.relative(bounds.toolRoot, target);
    return 'tool:' + relative.split(path.sep).join('/');
  }

  if (bounds.analysedRoot && isInside(bounds.analysedRoot, target)) {
    relative = path.relative(bounds.analysedRoot, target);
    return 'analysed:' + relative.split(path.sep).join('/');
  }

  return 'ephemeral:' + path.basename(target);
}

/**
 * True when `target` is absolute under the platform this process is NOT on.
 *
 * @param {string} target
 * @returns {boolean}
 */
function isForeignAbsolute(target) {
  var foreign = path.sep === '\\' ? path.posix : path.win32;

  return !path.isAbsolute(target) && foreign.isAbsolute(target);
}

/**
 * The basename of a foreign-absolute path, taken with its own separator.
 *
 * @param {string} target
 * @returns {string}
 */
function foreignBasename(target) {
  var foreign = path.sep === '\\' ? path.posix : path.win32;

  return foreign.basename(target);
}

/**
 * True when `target` is `root` or sits under it.
 *
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
function isInside(root, target) {
  var relative = path.relative(root, target);

  return relative === '' ||
    (relative.indexOf('..') !== 0 && !path.isAbsolute(relative));
}

/**
 * Throws unless every value in a provenance block is reproducible.
 *
 * This is rule 2, and it is a throw rather than a warning on purpose: the
 * failure it prevents - a machine path or a live PID reaching a committed
 * artifact - is invisible until a reviewer reads the file, by which time it is
 * delivered. A tool that trips this cannot produce a trustworthy artifact,
 * which is precisely what EXIT_ERROR means.
 *
 * @param {Object} block
 * @param {string} where A label for the message.
 * @returns {Object} the block
 * @throws {ToolError}
 */
function assertPortable(block, where) {
  var offences = [];

  function walk(value, trail) {
    var keys;

    if (typeof value === 'string') {
      // Unanchored, and deliberately so: see EMBEDDED_PATH. A value that
      // merely contains a host path or an instant carries the same run-local
      // state as one that is nothing but that path, and a free-form `reason`
      // built from an error message is the likeliest place for it.
      if (EMBEDDED_PATH.test(value)) {
        offences.push(trail + ' contains an absolute path (' +
          truncateForMessage(value) + '); use provenance.pathLabel(), or ' +
          'provenance.portableText() for a message that may embed one');
      }
      else if (EMBEDDED_INSTANT.test(value)) {
        offences.push(trail + ' contains a wall-clock instant (' +
          truncateForMessage(value) + '); two runs over one tree must not ' +
          'differ');
      }
      return;
    }

    if (value === null || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(function (item, index) {
        walk(item, trail + '[' + index + ']');
      });
      return;
    }

    keys = Object.keys(value);
    keys.forEach(function (key) {
      if (PROVENANCE_PROHIBITED_KEYS.indexOf(key.toLowerCase()) !== -1) {
        offences.push(trail + '.' + key + ' names run-local state; a ' +
          'provenance block records what is reproducible from the repository');
        return;
      }
      walk(value[key], trail + '.' + key);
    });
  }

  walk(block, where || 'provenance');

  if (offences.length) {
    throw new ToolError(
      'the provenance block is not reproducible and was not written:\n  ' +
      offences.join('\n  ')
    );
  }

  return block;
}

/**
 * Shortens a value for an error message.
 *
 * @param {string} value
 * @returns {string}
 */
function truncateForMessage(value) {
  return value.length > 120 ? value.slice(0, 117) + '...' : value;
}

/**
 * A file's contents, or null when it is not there.
 *
 * Absence is an answer here rather than an error: a sidecar is a run output,
 * so most artifacts have none, and the checks that need one are skipped
 * without it. What is NOT permitted is a sidecar that exists and disagrees.
 *
 * @param {string} file
 * @returns {(string|null)}
 */
function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  }
  catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }

    throw new ToolError('cannot read ' + file + ': ' + err.message);
  }
}

/**
 * Makes a free-form message safe to record.
 *
 * The guard above is a prohibition, and a prohibition alone is not enough for
 * the one field that legitimately carries prose: a failure `reason` is most
 * useful when it is the underlying error's own words, and those words contain
 * a path. So the words are kept and the run-local parts are replaced - every
 * absolute path with its pathLabel, every instant with a marker - which leaves
 * a message that says what happened and is identical on the next run.
 *
 * @param {string} value
 * @param {{toolRoot: (string|undefined), analysedRoot: (string|undefined)}} bounds
 * @returns {(string|null)}
 */
function portableText(value, bounds) {
  var limits = bounds || {};
  var paths  = new RegExp(EMBEDDED_PATH.source, 'g');
  var stamps = new RegExp(EMBEDDED_INSTANT.source, 'g');

  if (typeof value !== 'string') {
    return value === undefined || value === null ? null : String(value);
  }

  return value
    .replace(paths, function (match) {
      var lead = /^[\s'"`=(\[<:,]/.test(match) ? match.charAt(0) : '';
      var body = lead ? match.slice(1) : match;

      return lead + pathLabel(body, limits);
    })
    .replace(stamps, '<instant>');
}

/**
 * Strips what may not be digested, then returns the value to digest.
 *
 * Two separate problems, both of which a raw digest of a composed
 * configuration or a connection string has:
 *
 *   A SECRET, digested verbatim with a fast unsalted hash, gives anyone
 *   holding the artifact an offline oracle: guess the value, hash it, compare.
 *   Low-entropy secrets - a test password, a client id - fall to that
 *   immediately, and a committed artifact is exactly where such a digest ends
 *   up. Every value under a secret-labelled key becomes the constant
 *   '<redacted>', so the digest cannot confirm a guess.
 *
 *   RUN-LOCAL ADDRESSING - a port, an ephemeral database name, a temporary
 *   directory - is not normalized by hashing it. The digest simply changes on
 *   the next run, and a field meant to identify a configuration then
 *   identifies a run. Every value under an address-labelled key is dropped, so
 *   what remains is the part of the configuration that describes the tree.
 *
 * @param {*} value
 * @returns {*} a copy safe to digest
 */
function digestSafe(value) {
  function hinted(key, hints) {
    var lower = String(key).toLowerCase();

    return hints.some(function (hint) {
      return lower.indexOf(hint) !== -1;
    });
  }

  function scalar(node) {
    return node === null || typeof node !== 'object';
  }

  function walk(node) {
    var out;

    if (typeof node === 'string') {
      return node.replace(URI_USERINFO, '$1<redacted>@');
    }

    if (scalar(node)) {
      return node;
    }

    if (Array.isArray(node)) {
      return node.map(walk);
    }

    out = {};
    Object.keys(node).sort().forEach(function (key) {
      // Both rules apply to a SCALAR LEAF and not to a subtree, which is the
      // difference between a fingerprint and a blank. Keying on the subtree
      // dropped `db` whole - taking `db.redis.enabled`, a setting that changes
      // what the application does, out of the digest along with the port it
      // was reached on. Recursing means each leaf is judged on its own name:
      // `db.mongo.port` goes, `db.redis.enabled` stays.
      if (!scalar(node[key])) {
        out[key] = walk(node[key]);
        return;
      }

      if (hinted(key, SECRET_KEY_HINTS)) {
        out[key] = '<redacted>';
        return;
      }

      if (hinted(key, ADDRESS_KEY_HINTS)) {
        return;
      }

      out[key] = walk(node[key]);
    });

    return out;
  }

  return walk(value);
}

/**
 * A digest of a configuration, safe to commit.
 *
 * The only correct way to digest composed configuration: redact first, then
 * hash. Callers that hashed a raw `NODE_CONFIG` string or a raw Mongo URI got
 * a value that both leaked and drifted.
 *
 * @param {*} value
 * @returns {Object} a digest record, with the redaction named in it
 */
function configurationDigest(value) {
  var digest = provenanceDigest(digestSafe(value));

  digest.canonicalization = 'secret-labelled values replaced with ' +
    '<redacted>, address-labelled values dropped, URI userinfo removed, then ' +
    digest.canonicalization;

  return digest;
}

/**
 * The digest of a generated Markdown document's BODY.
 *
 * Needed because a Markdown artifact has no `payloadDigest`: its payload is
 * prose, so nothing bound the recorded provenance to the text it describes,
 * and a document whose rows had been edited by hand verified clean.
 *
 * The canonicalization has to be non-circular, since the digest is recorded
 * INSIDE the document it covers. Two rules give that: the provenance comment
 * line is removed before hashing, and trailing whitespace on each line is
 * stripped so an editor cannot change the digest without changing a word.
 *
 * @param {string} text The document, with or without its provenance line.
 * @returns {Object} a digest record
 */
function markdownBodyDigest(text) {
  var body = String(text)
    .split('\n')
    .filter(function (line) {
      return line.indexOf('<!-- provenance-json:') === -1;
    })
    .map(function (line) {
      return line.replace(/[ \t]+$/, '');
    })
    .join('\n');
  var digest = provenanceDigest(body);

  digest.canonicalization = 'the document with its provenance-json line ' +
    'removed and trailing whitespace stripped per line, hashed as utf8';

  return digest;
}

/**
 * Builds a provenance block.
 *
 * @param {Object} spec
 * @param {string} spec.artifact Basename of the artifact this describes.
 * @param {string} spec.role One of PROVENANCE_ROLES.
 * @param {string} spec.generatorFile The generator, absolute - normally
 *   `__filename`.
 * @param {string} spec.toolRoot The generator's repository root.
 * @param {(string|null|undefined)} spec.analysedRoot The tree measured, if any.
 * @param {(Object|undefined)} spec.detail Tool-specific portable fields.
 * @returns {Object}
 * @throws {ToolError} On an unknown role or an unreproducible value.
 */
function buildProvenanceBlock(spec) {
  var block;

  if (PROVENANCE_ROLES.indexOf(spec.role) === -1) {
    throw new ToolError('unknown provenance role: ' + spec.role +
      ' (expected one of ' + PROVENANCE_ROLES.join(', ') + ')');
  }

  block = {
    provenanceSchema: PROVENANCE_SCHEMA,
    artifact        : path.basename(spec.artifact),
    role            : spec.role,
    generator       : generatorIdentity(spec.generatorFile, spec.toolRoot),
    analysedTree    : spec.analysedRoot ? treeIdentity(spec.analysedRoot) : null,
    // The delivered head - the tool's own worktree - is what lets one command
    // establish that a set of artifacts describes ONE target state. It is
    // recorded on every block for exactly that reason.
    delivered       : treeIdentity(spec.toolRoot),
    baselineCommit  : BASELINE_HEAD,
    runtime         : provenanceRuntime()
  };

  if (spec.detail !== undefined && spec.detail !== null) {
    block.detail = spec.detail;
  }

  return assertPortable(block, 'provenance');
}

/**
 * Embeds a block in the artifact it describes, hash-linked.
 *
 * `payloadDigest` covers the artifact WITHOUT its provenance, which is what
 * makes the link non-circular and what a consumer recomputes. An artifact whose
 * provenance was copied in from another run fails that recomputation.
 *
 * Embedding is what removes the last reason for a committed sidecar file: a
 * delivered artifact says which tree it measured all by itself, so nothing
 * declares a companion file that may not exist.
 *
 * @param {Object} artifact The artifact object, mutated.
 * @param {Object} block From buildProvenanceBlock.
 * @returns {Object} the attached block
 */
function attachProvenance(artifact, block) {
  var payload = {};

  Object.keys(artifact).forEach(function (key) {
    if (key !== 'provenance') {
      payload[key] = artifact[key];
    }
  });

  block.payloadDigest = provenanceDigest(payload);
  artifact.provenance = block;

  return block;
}

/**
 * The sidecar form of a block: the same record plus a digest of the bytes.
 *
 * The sidecar remains a RUN OUTPUT and is never committed - the delivered
 * artifact carries the embedded block instead. It is still written, because a
 * scratch run of a tool whose artifact is compared byte-for-byte between two
 * trees wants the provenance out of the compared bytes.
 *
 * @param {Object} block
 * @param {string} artifactText The exact bytes written.
 * @returns {Object}
 */
function sidecarProvenance(block, artifactText) {
  var copy = {};

  Object.keys(block).forEach(function (key) {
    copy[key] = block[key];
  });

  copy.artifactDigest = provenanceDigest(artifactText);

  // The file says what it is, because the last time one of these reached a
  // delivery nothing in it did: a committed `joi-baseline.json.provenance.json`
  // read as an evidence artifact, was reviewed as one, and named a worktree
  // that was not the repository it sat in. A reader who finds one of these in
  // a diff now has the answer in the file.
  copy.note = 'RUN OUTPUT - not a delivery artifact, and not to be committed. ' +
    'Every field above except artifactDigest is also embedded in ' +
    (block.artifact || 'the artifact') + ' under its own `provenance` key, ' +
    'which is the committed record; this file adds only a digest of the exact ' +
    'bytes written, for a scratch run that compares two artifacts byte for ' +
    'byte and needs the provenance outside the compared region.';

  return copy;
}

/**
 * Decides an artifact's role from the tree it measured, and refuses to
 * mislabel one.
 *
 * A baseline claim is a claim about BASELINE_HEAD. Before this existed a
 * capture pointed at any tree at all produced an artifact indistinguishable
 * from a baseline capture. The escape hatch is explicit and is not free: it
 * yields the `unreviewed` role, which every gate treats as non-qualifying.
 *
 * @param {Object} tree From treeIdentity.
 * @param {{allowNonBaseline: (boolean|undefined), what: (string|undefined)}} options
 * @returns {string} the role
 * @throws {ToolError} When the tree is not the baseline and no escape was given.
 */
function assertBaselineTree(tree, options) {
  var settings = options || {};
  var what     = settings.what || 'this baseline artifact';

  if (tree && tree.isBaselineCommit) {
    // At the right commit is necessary and not sufficient. A DIRTY worktree at
    // 2f8712a holds the base commit plus edits nobody can retrieve, and a
    // measurement of it is a measurement of those edits - while the block it
    // produces is indistinguishable from a clean baseline capture except for
    // one field nothing was reading. The escape is the same one a wrong commit
    // gets, and it costs the same: role `unreviewed`.
    if (tree.worktreeState === 'dirty') {
      if (settings.allowNonBaseline) {
        return 'unreviewed';
      }

      throw new ToolError(
        what + ' must be measured on a CLEAN worktree at the base commit ' +
        BASELINE_HEAD + ' (AAP §0.10.3). The tree at --app is at that commit ' +
        'but has uncommitted changes, so what it would measure is not ' +
        'retrievable from this repository and the artifact could not be ' +
        'reproduced from it. Commit, stash or discard them - `git -C <path> ' +
        'status --porcelain` lists them - or pass --allow-nonbaseline to ' +
        'record the artifact as `unreviewed`, which does not qualify as gate ' +
        'evidence.'
      );
    }

    return 'baseline';
  }

  if (settings.allowNonBaseline) {
    return 'unreviewed';
  }

  throw new ToolError(
    what + ' must be measured on a worktree at the base commit ' +
    BASELINE_HEAD + ' (AAP §0.10.3), and the tree at --app is ' +
    ((tree && tree.head) || 'not a checkout') + '. Create one with ' +
    '`git worktree add --detach <path> 2f8712a`, or pass ' +
    '--allow-nonbaseline to record the artifact as `unreviewed`, which does ' +
    'not qualify as gate evidence.'
  );
}

/**
 * The machine-readable provenance line for a generated Markdown document.
 *
 * A document's human-readable provenance table is for a reader; this comment is
 * for the verifier. One line, so it survives being regenerated, and inside an
 * HTML comment so it does not render.
 *
 * @param {Object} block
 * @returns {string}
 */
function markdownProvenance(block) {
  return '<!-- provenance-json: ' + canonicalJson(block) + ' -->';
}

/** Matches the line markdownProvenance writes. */
var MARKDOWN_PROVENANCE = /^<!--\s*provenance-json:\s*(\{[\s\S]*\})\s*-->$/m;

/**
 * Extracts a provenance block from an artifact's text.
 *
 * Handles the three delivered shapes: a JSON artifact with an embedded
 * `provenance` key, a JSON file that IS a block, and a Markdown document
 * carrying the machine-readable comment.
 *
 * @param {string} text
 * @returns {(Object|null)}
 */
function extractProvenance(text) {
  var match;
  var parsed;

  match = MARKDOWN_PROVENANCE.exec(text);
  if (match) {
    try {
      return JSON.parse(match[1]);
    }
    catch (err) {
      return null;
    }
  }

  try {
    parsed = JSON.parse(text);
  }
  catch (err) {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  if (parsed.provenance && typeof parsed.provenance === 'object') {
    return parsed.provenance;
  }

  return parsed.provenanceSchema === undefined ? null : parsed;
}

/**
 * Validates a provenance block against what a consumer requires.
 *
 * Returns a verdict rather than throwing, so a caller decides whether an
 * unverified generator is fatal for its purpose. Every check is named in the
 * result, so a failure says which requirement it failed and a pass is
 * inspectable rather than implicit.
 *
 * @param {(Object|null)} block
 * @param {Object} expect
 * @param {(string|undefined)} expect.artifact Required basename.
 * @param {(string[]|undefined)} expect.roles Acceptable roles.
 * @param {(boolean|undefined)} expect.requireGeneratorVerified
 * @param {(boolean|undefined)} expect.requireBaselineTree
 * @param {(string|undefined)} expect.deliveredHead Required delivered head.
 * @param {(Object|undefined)} expect.payload The artifact without its
 *   provenance, for recomputing payloadDigest.
 * @param {(string|undefined)} expect.repositoryRoot Where to resolve the
 *   recorded generator objects.
 * @param {(boolean|undefined)} expect.allowUncommitted Record the
 *   repository-resolution checks as WAIVED, with their reason, when the block
 *   itself says the generator source is not committed. For use while the
 *   generators are still changing; a delivery must validate without it.
 * @returns {{ok: boolean, failures: string[], checks: Object[]}}
 */
function validateProvenance(block, expect) {
  var wanted   = expect || {};
  var checks   = [];
  var failures = [];

  // A check whose subject does not exist yet is WAIVED, not passed: it is
  // recorded with its reason so a reader sees what was not established, while
  // not counting as a failure. That distinction is what lets the mode be used
  // mid-change without it quietly reporting a clean chain.
  var waiveUncommitted = !!wanted.allowUncommitted &&
    !!block && !!block.generator &&
    block.generator.commitState === 'uncommitted-source';

  function check(name, ok, detail) {
    checks.push({ name: name, ok: !!ok, detail: detail === undefined ? null : detail });
    if (!ok) {
      failures.push(name + ': ' + detail);
    }
  }

  function waivable(name, ok, detail, reason) {
    if (!ok && waiveUncommitted) {
      checks.push({ name: name, ok: false, waived: true, detail: reason });
      return;
    }
    check(name, ok, detail);
  }

  if (!block || typeof block !== 'object') {
    return {
      ok: false,
      failures: ['present: no provenance block was found, so the artifact does ' +
        'not say which tree it measured and is not parity evidence'],
      checks: []
    };
  }

  check('schema', block.provenanceSchema === PROVENANCE_SCHEMA,
    'expected schema ' + PROVENANCE_SCHEMA + ', found ' + block.provenanceSchema);

  if (wanted.artifact) {
    check('artifact', block.artifact === path.basename(wanted.artifact),
      'the block describes ' + block.artifact + ', not ' +
      path.basename(wanted.artifact));
  }

  if (wanted.roles) {
    check('role', wanted.roles.indexOf(block.role) !== -1,
      'role is ' + block.role + ', and this consumer accepts ' +
      wanted.roles.join(', '));
  }

  check('generator-recorded',
    !!(block.generator && block.generator.path && block.generator.blob),
    'the block names no generator source');

  // REQUIRED, not conditional. A block with `analysedTree` and `delivered`
  // deleted used to pass every check and be counted into "one target state",
  // because each was only examined when a caller asked for it - so the one
  // shape that says nothing at all about any tree was the one shape nothing
  // rejected. `unreviewed` is the single exception: it is the label for an
  // artifact taken off an unknown tree, and demanding a tree identity from it
  // would leave no way to record that honestly.
  if (block.role !== 'unreviewed') {
    check('analysed-tree-recorded',
      !!(block.analysedTree && block.analysedTree.head),
      'the block names no analysed tree, so it does not say what it measured');
    check('delivered-recorded',
      !!(block.delivered && block.delivered.head),
      'the block names no delivered head, so it does not say which target ' +
      'state it belongs to');
  }

  if (wanted.requireGeneratorVerified) {
    check('generator-verified', !!(block.generator && block.generator.verified),
      'the recorded generator commit ' +
      ((block.generator && block.generator.commit) || 'is absent') +
      ' is not verified to contain ' +
      ((block.generator && block.generator.path) || 'the generator') +
      ' as it ran (commitState ' +
      ((block.generator && block.generator.commitState) || 'unknown') + ')');
  }

  if (wanted.repositoryRoot && block.generator) {
    waivable('generator-blob-resolves',
      gitObjectExists(wanted.repositoryRoot, block.generator.blob),
      'the recorded generator blob ' + block.generator.blob +
      ' is not an object in this repository, so the generator cannot be ' +
      'retrieved from it',
      'waived: the generator source is not committed yet, so its blob is ' +
      'not an object in any repository');

    if (block.generator.commit) {
      check('generator-commit-resolves',
        gitCommitExists(wanted.repositoryRoot, block.generator.commit),
        'the recorded generator commit ' + block.generator.commit +
        ' is not a commit in this repository');
      check('generator-commit-contains-source',
        gitBlobAt(wanted.repositoryRoot, block.generator.commit,
          block.generator.path) === block.generator.blob,
        'commit ' + block.generator.commit + ' does not hold ' +
        block.generator.path + ' as the blob that produced this artifact');
    }
  }

  if (wanted.requireBaselineTree) {
    check('baseline-tree',
      !!(block.analysedTree && block.analysedTree.isBaselineCommit),
      'the analysed tree is ' +
      ((block.analysedTree && block.analysedTree.head) || 'not recorded') +
      ', not the base commit ' + BASELINE_HEAD);
    // A baseline claim is a claim about the base commit's CONTENT, and a dirty
    // worktree at that commit is not that content. The measurement then
    // describes an edit nobody can retrieve, while the block reads exactly
    // like a clean one.
    check('baseline-tree-clean',
      !(block.analysedTree && block.analysedTree.worktreeState === 'dirty'),
      'the analysed tree is at the base commit but has uncommitted changes, ' +
      'so what was measured is not retrievable from this repository');
  }

  // The analysed tree has to resolve here too, for the same reason the
  // delivered head does: a head from a clone that never reached this
  // repository makes the claim unfalsifiable.
  if (wanted.repositoryRoot && block.analysedTree && block.analysedTree.head) {
    check('analysed-head-resolves',
      gitCommitExists(wanted.repositoryRoot, block.analysedTree.head),
      'the recorded analysed head ' + block.analysedTree.head +
      ' is not a commit in this repository, so the tree it names cannot be ' +
      'retrieved');
  }

  if (wanted.deliveredHead) {
    check('delivered-head',
      !!(block.delivered && block.delivered.head === wanted.deliveredHead),
      'the block was produced at delivered head ' +
      ((block.delivered && block.delivered.head) || 'unknown') +
      ', and this set is anchored at ' + wanted.deliveredHead);
  }

  // The delivered head is the other half of "which target state is this?", and
  // it is exactly the half that failed before: an artifact produced in a clone
  // whose HEAD never reached this repository names a commit nobody can resolve,
  // and the claim it makes about the target tree is unfalsifiable. So it is
  // resolved as an object here rather than trusted as a string.
  if (wanted.repositoryRoot && block.delivered && block.delivered.head) {
    waivable('delivered-head-resolves',
      gitCommitExists(wanted.repositoryRoot, block.delivered.head),
      'the recorded delivered head ' + block.delivered.head +
      ' is not a commit in this repository, so the target state this ' +
      'artifact claims to describe cannot be retrieved from it',
      'waived: the run that produced this artifact was not committed, so the ' +
      'head it recorded is not an object in any repository');
  }

  // Reproducibility has a second requirement beyond "the generator can be
  // retrieved": the generator that ships must still be that generator. An
  // artifact whose generator was edited after it was written is stale, and the
  // symptom - a rerun that differs - looks like a parity failure rather than an
  // artifact that was never refreshed.
  if (wanted.repositoryRoot && block.generator && block.generator.blob &&
      block.generator.path) {
    waivable('generator-current',
      gitBlobAt(wanted.repositoryRoot, 'HEAD', block.generator.path) ===
        block.generator.blob,
      'the delivered ' + block.generator.path + ' is no longer the blob that ' +
      'produced this artifact (' + block.generator.blob.slice(0, 12) +
      '), so rerunning the delivered generator need not reproduce it',
      'waived: the generator source is not committed yet, so HEAD holds no ' +
      'blob to compare against');
  }

  if (wanted.payload !== undefined) {
    check('payload-digest',
      !!(block.payloadDigest &&
        block.payloadDigest.value === provenanceDigest(wanted.payload).value),
      'the artifact does not hash to the digest its own provenance records, ' +
      'so the two do not belong together');
  }

  // A generated Markdown document has no JSON payload, so before this existed
  // nothing bound its provenance to its prose: appending a row to a delivered
  // inventory left the block valid and the document verifying clean. When the
  // block records a bodyDigest it is recomputed here; when the caller supplies
  // the text and the block records no bodyDigest, that absence is the failure,
  // because an unbound document is the defect itself.
  if (wanted.documentText !== undefined) {
    if (block.bodyDigest && block.bodyDigest.value) {
      check('body-digest',
        block.bodyDigest.value === markdownBodyDigest(wanted.documentText).value,
        'the document body does not hash to the digest its own provenance ' +
        'records, so the text has changed since it was generated');
    }
    else {
      check('body-digest-recorded', false,
        'the block records no bodyDigest, so nothing binds this provenance ' +
        'to the document text and an edited row would verify clean');
    }
  }

  // The sidecar's whole contribution is a digest of the exact bytes written,
  // and it was written and never checked. A sidecar whose digest does not
  // match the artifact beside it is either stale or describing a different
  // file, and both mean the pair cannot be read together.
  if (wanted.sidecar !== undefined && wanted.artifactText !== undefined) {
    check('sidecar-artifact-digest',
      sidecarArtifactDigest(wanted.sidecar) ===
        provenanceDigest(wanted.artifactText).value,
      'the sidecar beside this artifact records artifactDigest ' +
      ((sidecarArtifactDigest(wanted.sidecar) || 'nothing').slice(0, 16)) +
      ', and the artifact\'s own bytes hash to ' +
      provenanceDigest(wanted.artifactText).value.slice(0, 16) +
      ', so the two do not describe the same file');
    check('sidecar-agrees-with-embedded',
      wanted.sidecar.payloadDigest === undefined ||
        block.payloadDigest === undefined ||
        wanted.sidecar.payloadDigest.value === block.payloadDigest.value,
      'the sidecar and the embedded block disagree about the payload digest, ' +
      'so one of them was not written by the run that produced the artifact');
  }

  return { ok: failures.length === 0, failures: failures, checks: checks };
}

// The contract, as one exported namespace. Every tool calls these rather than
// re-deriving provenance, so the guarantees hold across the whole of
// test/parity/ and cannot drift file by file.
var provenance = {
  SCHEMA          : PROVENANCE_SCHEMA,
  ROLES           : PROVENANCE_ROLES,
  BASELINE_HEAD   : BASELINE_HEAD,
  PROHIBITED_KEYS : PROVENANCE_PROHIBITED_KEYS,
  isBaselineHead  : isBaselineHead,
  treeIdentity    : treeIdentity,
  generator       : generatorIdentity,
  runtime         : provenanceRuntime,
  canonicalJson   : canonicalJson,
  digest          : provenanceDigest,
  pathLabel       : pathLabel,
  assertPortable  : assertPortable,
  build           : buildProvenanceBlock,
  attach          : attachProvenance,
  sidecar         : sidecarProvenance,
  assertBaseline  : assertBaselineTree,
  markdown        : markdownProvenance,
  extract         : extractProvenance,
  validate        : validateProvenance,
  objectExists    : gitObjectExists,
  commitExists    : gitCommitExists,
  blobAt          : gitBlobAt,
  // Sanitizers. A tool records a free-form message through `portableText` and
  // a composed configuration through `configurationDigest`; recording either
  // one raw is what the guard now rejects, and these are the routes that make
  // the guard satisfiable rather than merely restrictive.
  portableText    : portableText,
  digestSafe      : digestSafe,
  configurationDigest: configurationDigest,
  bodyDigest      : markdownBodyDigest
};

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
 * Refuses to generate a manifest in a process that may already be contaminated.
 *
 * The route-table child below has its environment scrubbed, but generation is
 * different in kind: it requires `config/routes`, `config/api_routes` and
 * `lib/util/routeParser` from the tree under test INTO THIS PROCESS. By the
 * time this function could delete NODE_OPTIONS, a module it named has already
 * executed, and by the time it could delete NODE_PATH, resolution has already
 * been redirected - so deleting either would remove the evidence of the
 * contamination and none of its effects. `test/parity/worker.js` refuses for
 * exactly the same reason.
 *
 * What is at stake is the primary parity gate. The manifest is compared entry
 * by entry between two worktrees (AAP §0.9.1), and a preload that patched the
 * parser, or a NODE_PATH that resolved a different `tab` or `joi`, would
 * produce a manifest describing neither tree while looking entirely normal.
 * A gate that can be quietly wrong is worse than one that refuses.
 *
 * The variable names are those of test/parity/mongo.js's PRELOAD_ENV_VARS,
 * restated locally because this file is deliberately standalone - see
 * PRELOAD_ENV_VARS above.
 *
 * @returns {undefined}
 * @throws {ToolError} If any preload vector is set in this process.
 */
function assertUncontaminatedProcess() {
  var offenders = PRELOAD_ENV_VARS.filter(function (name) {
    return process.env[name] !== undefined && process.env[name] !== '';
  });

  if (!offenders.length) {
    return;
  }

  throw new ToolError(offenders.join(' and ') + ' ' +
    (offenders.length === 1 ? 'is' : 'are') + ' set in this process. ' +
    'Generation requires the route modules and the parser from the tree ' +
    'under test into THIS process, so a preload has already run and a ' +
    'redirected module path has already taken effect - the manifest would ' +
    'describe neither tree and the comparison against the other worktree ' +
    'would be meaningless. Unset ' + offenders.join(' and ') + ' and run ' +
    'again; interpreter flags belong on the command line, where this run ' +
    'records them in its provenance sidecar.');
}

/**
 * Prepares the process for the FIRST application require.
 *
 * Everything here must precede it, because `config` freezes its values when it
 * is first required and this tool loads the route modules straight afterwards:
 *   NODE_CONFIG_DIR  The npm `config` package resolves its directory from
 *                    process.cwd(), so without this a baseline run would read
 *                    the TARGET tree's YAML and every value derived from
 *                    configuration - the cache prefix in a static route path,
 *                    the static-pages directory - would come from the wrong
 *                    tree. `mongo.isolateRuntimeConfig` sets it and reports a
 *                    replaced inherited value, which a nested invocation can
 *                    carry in pointing at the other tree.
 *   process.chdir    Same reason, and it additionally makes the analysed tree
 *                    the resolution root for anything the application reads
 *                    relative to the working directory.
 *   NODE_CONFIG      The redis overlay described in composeNodeConfig.
 *   the isolation    NODE_CONFIG_PERSIST_ON_CHANGE, NODE_CONFIG_DISABLE_FILE_WATCH
 *                    and NODE_CONFIG_RUNTIME_JSON, from ./mongo. All three, not
 *                    just persistence: `config` 0.4.37 creates its runtime JSON
 *                    unless persistence is off AND the file watch is disabled,
 *                    so this tool previously wrote config/runtime.json into the
 *                    worktree it was analysing - measured, and gitignored, so
 *                    `git status` on the "untouched" baseline stayed clean while
 *                    the file sat in it and its contents layered over every
 *                    other configuration source on the next run.
 * NODE_ENV is set to 'test' unless the caller overrode it, matching AAP
 * §0.9.1's gate command, and whatever value results is recorded in the
 * provenance sidecar and passed identically to both trees.
 *
 * @param {string} appRoot Absolute path, already validated.
 * @returns {{nodeEnv: string, nodeConfig: string, nodeConfigDir: string,
 *   runtimeJsonPath: string}}
 * @throws {ToolError} If the working directory cannot be changed.
 */
function prepareEnvironment(appRoot) {
  var nodeConfig = composeNodeConfig(process.env.NODE_CONFIG);
  var isolation;

  // Refused before the first application require, for the reason that function
  // gives: this manifest is the primary parity gate, and it is produced IN
  // THIS PROCESS.
  assertUncontaminatedProcess();

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  // Sets NODE_CONFIG_DIR to <appRoot>/config, pins persistence to 'N', disables
  // the file watch, redirects the runtime JSON to a private path outside every
  // worktree, and registers its removal.
  isolation = mongo.isolateRuntimeConfig({
    appRoot   : appRoot,
    configDir : 'set'
  });

  process.env.NODE_CONFIG = nodeConfig;

  try {
    process.chdir(appRoot);
  }
  catch (err) {
    throw new ToolError('cannot chdir to ' + appRoot + ': ' + err.message);
  }

  return {
    nodeEnv: process.env.NODE_ENV,
    nodeConfig: nodeConfig,
    nodeConfigDir: isolation.configDir,
    runtimeJsonPath: isolation.runtimeJsonPath
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
 * WHICH IS WHY EVERY FAILURE HERE IS FATAL. This function previously fell back
 * to FALLBACK_DEFAULT_AUTH with a stderr note when app.js could not be read or
 * the call could not be found, and that fallback defeated the very purpose of
 * reading per tree: a tree whose default this tool cannot recover gets the
 * documented pair anyway, all 126 inherited entries are then labelled with it,
 * and the comparison reports PASS while up to 126 per-entry auth differences
 * are masked - the exact concealment the paragraph above rules out, reached by a
 * different road. There is no trustworthy manifest to produce in that state, so
 * a ToolError is thrown naming the file and the precise reason, and the caller
 * exits 2: "the gate could not run" rather than "the gate ran and passed".
 *
 * FALLBACK_DEFAULT_AUTH survives as the DOCUMENTED EXPECTED VALUE rather than a
 * substitute. The recovered pair is compared against it in buildSummary, and a
 * difference is recorded in the summary's unexpected figures, which makes
 * generation exit non-zero - reported, never concealed, and never silently
 * adopted.
 *
 * @param {string} appRoot Absolute path.
 * @returns {{strategy: string, mode: string, source: string}} `source` is
 *   always 'app.js': there is no other source.
 * @throws {ToolError} If app.js cannot be read, carries no
 *   `server.auth.default({...})` call, or carries one whose `strategy` or
 *   `mode` cannot be extracted.
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
    throw new ToolError('cannot read ' + target + ' (' + err.message +
      '), so the server default authentication cannot be recovered. 126 of ' +
      'the 233 routes inherit it, and labelling them with the documented ' +
      'default ' + JSON.stringify(FALLBACK_DEFAULT_AUTH) + ' would mask up ' +
      'to 126 per-entry auth differences behind a PASS.');
  }

  call = /server\.auth\.default\s*\(\s*\{([^}]*)\}\s*\)/.exec(text);

  if (!call) {
    throw new ToolError('no `server.auth.default({ ... })` call found in ' +
      target + ', so the server default authentication cannot be recovered. ' +
      'It is what 126 of the 233 routes inherit; a manifest that guessed it ' +
      'would report PASS over up to 126 masked auth differences.');
  }

  strategy = /strategy\s*:\s*(?:'([^']*)'|"([^"]*)")/.exec(call[1]);
  mode     = /mode\s*:\s*(?:'([^']*)'|"([^"]*)")/.exec(call[1]);

  if (!strategy || !mode) {
    throw new ToolError('the `server.auth.default({ ... })` call in ' + target +
      ' was found but its ' + (!strategy ? 'strategy' : 'mode') +
      ' could not be extracted from ' + JSON.stringify(call[1].trim()) +
      '. 126 of the 233 routes inherit this value, so it is recovered exactly ' +
      'or not at all.');
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
 *            routesCount: number, apiRoutesCount: number,
 *            languageCount: (number|null)}}
 * @throws {ToolError} If a module cannot be loaded or the parse fails.
 */
function loadRoutes(appRoot) {
  var constants;
  var pageRoutes;
  var apiRoutes;
  var routeParser;
  var declared;
  var pristine;
  var throwaway;
  var parsed;

  // FIRST. See above. Its `trinketLangs` is kept rather than discarded because
  // it is the multiplier in the declaration decomposition, and reading it from
  // the tree under test is what keeps that decomposition measured rather than
  // asserted.
  constants = requireFromApp(appRoot, 'config/constants');

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
    apiRoutesCount: apiRoutes.length,
    languageCount: Array.isArray(constants.trinketLangs)
      ? constants.trinketLangs.length
      : null
  };
}


// ---------------------------------------------------------------------------
// Declaration decomposition - MEASURED, and stated BOTH WAYS
// ---------------------------------------------------------------------------

// The line-oriented equivalent of the shell grep this decomposition was
// originally established with, `grep -c '^[[:space:]]*route[[:space:]]*:'`.
// Constructed fresh at each use because it carries /g and therefore lastIndex.
var DECLARATION_LINE_SOURCE = '^[ \\t]*route[ \\t]*:';

// The per-language expansion loop, located BY CONTENT and never by line number:
// the two trees differ by one line here (config/routes.js:551 on the target,
// :550 on the baseline), so a hard-coded line would measure the wrong region on
// one of them - which is precisely the class of mistake this measurement exists
// to remove.
var EXPANSION_LOOP_CALL = /((?:[A-Za-z_$][\w$]*\s*\.\s*)*trinketLangs)\s*\.\s*forEach\s*\(/;

// The callback forms accepted between `forEach(` and the body's opening brace.
// Validated rather than assumed: if the argument were an arrow function
// returning an object literal, the first brace after `forEach(` would be that
// literal and brace-matching it would measure a region that is not the loop
// body. A shape not on this list is reported as unrecognised instead of
// measured wrongly.
var EXPANSION_CALLBACK_FORM =
  /^\s*(?:function\s*[A-Za-z_$][\w$]*\s*\([^)]*\)\s*|function\s*\([^)]*\)\s*|\([^)]*\)\s*=>\s*|[A-Za-z_$][\w$]*\s*=>\s*)$/;

// A `.push(` call, counted inside the expansion loop body as a cross-check on
// the declaration lines found there: 5 declarations pushed by 5 calls.
var PUSH_CALL = /\.push\s*\(/g;

/**
 * The index of the first `{` at or after `from` that is real code.
 *
 * Strings, template literals, line comments and block comments are skipped,
 * because config/routes.js is full of braces inside string literals - every
 * language route's path carries `{shortCode}` or `{path*}` - and a naive scan
 * would treat them as structure.
 *
 * A REGEX LITERAL containing an unbalanced brace would still be misread; there
 * is none in either declaration module, and the arithmetic self-check below is
 * what would report the consequence rather than leaving it to be believed.
 *
 * @param {string} text
 * @param {number} from
 * @returns {number} -1 when there is none.
 */
function firstCodeBraceIndex(text, from) {
  var state = 'code';
  var quote = '';
  var i;
  var ch;
  var next;

  for (i = from; i < text.length; i++) {
    ch   = text.charAt(i);
    next = text.charAt(i + 1);

    if (state === 'line-comment') {
      if (ch === '\n') { state = 'code'; }
      continue;
    }

    if (state === 'block-comment') {
      if (ch === '*' && next === '/') { state = 'code'; i += 1; }
      continue;
    }

    if (state === 'string') {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) { state = 'code'; }
      continue;
    }

    if (ch === '/' && next === '/') { state = 'line-comment'; i += 1; continue; }
    if (ch === '/' && next === '*') { state = 'block-comment'; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { state = 'string'; quote = ch; continue; }
    if (ch === '{') { return i; }
  }

  return -1;
}

/**
 * The index of the `}` that closes the `{` at `openIndex`.
 *
 * Same scanner and the same caveat as firstCodeBraceIndex.
 *
 * @param {string} text
 * @param {number} openIndex Index of an opening brace in code.
 * @returns {number} -1 when it is unbalanced.
 */
function matchingBraceIndex(text, openIndex) {
  var state = 'code';
  var quote = '';
  var depth = 0;
  var i;
  var ch;
  var next;

  for (i = openIndex; i < text.length; i++) {
    ch   = text.charAt(i);
    next = text.charAt(i + 1);

    if (state === 'line-comment') {
      if (ch === '\n') { state = 'code'; }
      continue;
    }

    if (state === 'block-comment') {
      if (ch === '*' && next === '/') { state = 'code'; i += 1; }
      continue;
    }

    if (state === 'string') {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) { state = 'code'; }
      continue;
    }

    if (ch === '/' && next === '/') { state = 'line-comment'; i += 1; continue; }
    if (ch === '/' && next === '*') { state = 'block-comment'; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { state = 'string'; quote = ch; continue; }
    if (ch === '{') { depth += 1; continue; }
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) { return i; }
    }
  }

  return -1;
}

/**
 * Locates the per-language expansion loop's body in a declaration module.
 *
 * @param {string} text The module's source.
 * @returns {(Object|null)} `{iterable, callbackForm, bodyStart, bodyEnd, line}`
 *   for a recognised loop, `{recognised: false, reason}` for a loop call whose
 *   shape could not be measured, or null when the module has no such loop.
 */
function findExpansionLoop(text) {
  var call = EXPANSION_LOOP_CALL.exec(text);
  var afterCall;
  var brace;
  var between;
  var end;

  if (!call) {
    return null;
  }

  afterCall = call.index + call[0].length;
  brace     = firstCodeBraceIndex(text, afterCall);

  if (brace === -1) {
    return { recognised: false, reason: 'no callback body brace after ' + call[0] };
  }

  between = text.slice(afterCall, brace);

  if (!EXPANSION_CALLBACK_FORM.test(between)) {
    return {
      recognised: false,
      reason: 'unrecognised callback form ' + JSON.stringify(between.trim()) +
        ' after ' + call[0]
    };
  }

  end = matchingBraceIndex(text, brace);

  if (end === -1) {
    return { recognised: false, reason: 'unbalanced callback body after ' + call[0] };
  }

  return {
    recognised: true,
    iterable: call[1],
    callbackForm: between.trim(),
    bodyStart: brace,
    bodyEnd: end,
    line: text.slice(0, call.index).split('\n').length
  };
}

/**
 * Measures one declaration module's decomposition, and states it BOTH WAYS.
 *
 * This exists because two documents asserted two different decompositions of
 * the same 112 exported objects - 57 static + 55 language here, 62 literal + 50
 * expansion in docs/baseline-parity.md - and BOTH ARE ARITHMETICALLY TRUE. The
 * difference is one attribution and nothing else: the 5 `route :` lines that sit
 * INSIDE the expansion loop body are literal declarations if you count lines,
 * and part of the expansion if you count what the loop contributes. Asserting
 * either as the decomposition makes the other read as an error, which is how two
 * correct figures came to contradict each other in the delivery. So neither is
 * asserted: both readings are recorded, measured from the tree being analysed,
 * with the attribution named, and both are checked to close.
 *
 * Every figure comes from the module's own text and its own exports. Nothing is
 * hard-coded - not the line of the loop, which differs between the two trees,
 * and not the language count, which comes from config.constants.trinketLangs.
 *
 * @param {string} appRoot Absolute path.
 * @param {string} relative Repository-relative module path.
 * @param {number} exported The length of the array the module exports.
 * @param {(number|null)} languages config.constants.trinketLangs.length.
 * @returns {Object} The measurement, including a `failures` array which is
 *   EMPTY when both readings close.
 * @throws {ToolError} If the module's text cannot be read.
 */
function measureDeclarationModule(appRoot, relative, exported, languages) {
  var target = path.join(appRoot, relative);
  var text;
  var loop;
  var pattern = new RegExp(DECLARATION_LINE_SOURCE, 'gm');
  var match;
  var declarationLines = 0;
  var inExpansionLoop = 0;
  var pushCalls = 0;
  var topLevel;
  var perLanguage;
  var expansionEntries;
  var addedExpansionEntries;
  var failures = [];
  var measurement;

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot read ' + target +
      ' to measure its declaration decomposition: ' + err.message);
  }

  loop = findExpansionLoop(text);

  while ((match = pattern.exec(text)) !== null) {
    declarationLines += 1;

    if (loop && loop.recognised &&
        match.index > loop.bodyStart && match.index < loop.bodyEnd) {
      inExpansionLoop += 1;
    }
  }

  if (loop && loop.recognised) {
    PUSH_CALL.lastIndex = 0;
    while ((match = PUSH_CALL.exec(text)) !== null) {
      if (match.index > loop.bodyStart && match.index < loop.bodyEnd) {
        pushCalls += 1;
      }
    }
  }

  topLevel    = declarationLines - inExpansionLoop;
  perLanguage = inExpansionLoop;

  // A recognised loop runs once per language, so it contributes
  // languages x perLanguage entries in total, of which
  // (languages - 1) x perLanguage are ADDED to the literal lines already
  // counted once - which is the whole of the difference between the two
  // readings.
  expansionEntries      = loop && loop.recognised && languages !== null
    ? languages * perLanguage
    : 0;
  addedExpansionEntries = loop && loop.recognised && languages !== null
    ? (languages - 1) * perLanguage
    : 0;

  measurement = {
    module: relative,
    exported: exported,
    declarationLines: declarationLines,
    declarationLinePattern: DECLARATION_LINE_SOURCE,
    expansionLoop: loop === null
      ? null
      : {
        recognised: !!loop.recognised,
        iterable: loop.recognised ? loop.iterable : null,
        callbackForm: loop.recognised ? loop.callbackForm : null,
        line: loop.recognised ? loop.line : null,
        reason: loop.recognised ? null : loop.reason
      },
    declarationLinesInExpansionLoop: inExpansionLoop,
    pushCallsInExpansionLoop: pushCalls,
    topLevelDeclarationLines: topLevel,
    languages: loop && loop.recognised ? languages : null,
    routesPushedPerLanguage: loop && loop.recognised ? perLanguage : 0,
    expansionEntries: expansionEntries,
    readings: {
      // The decomposition this file states: the loop-body lines belong to the
      // expansion, so the literal count excludes them.
      topLevelPlusExpansion: {
        attribution: 'the ' + inExpansionLoop + ' route declaration(s) inside ' +
          'the expansion loop body count as EXPANSION, not as literal',
        literal: topLevel,
        expansion: expansionEntries,
        total: topLevel + expansionEntries,
        closes: topLevel + expansionEntries === exported
      },
      // The decomposition docs/baseline-parity.md states: every `route :` line
      // is a literal declaration, so the expansion adds only the further
      // (languages - 1) copies.
      literalPlusAddedExpansion: {
        attribution: 'the ' + inExpansionLoop + ' route declaration(s) inside ' +
          'the expansion loop body count as LITERAL, so the expansion adds ' +
          'only the further (languages - 1) copies',
        literal: declarationLines,
        expansion: addedExpansionEntries,
        total: declarationLines + addedExpansionEntries,
        closes: declarationLines + addedExpansionEntries === exported
      }
    },
    failures: failures
  };

  if (topLevel + inExpansionLoop !== declarationLines) {
    failures.push(relative + ' decomposition: ' + topLevel + ' top-level + ' +
      inExpansionLoop + ' in-loop declaration line(s) do not partition the ' +
      declarationLines + ' found');
  }

  if (loop && !loop.recognised) {
    failures.push(relative + ' decomposition: an expansion loop is present but ' +
      'could not be measured (' + loop.reason + '), so the decomposition is ' +
      'not trustworthy');
  }

  if (loop && loop.recognised && languages === null) {
    failures.push(relative + ' decomposition: config.constants.trinketLangs is ' +
      'not an array, so the expansion cannot be counted');
  }

  if (loop && loop.recognised && pushCalls !== inExpansionLoop) {
    failures.push(relative + ' decomposition: the expansion loop body holds ' +
      inExpansionLoop + ' route declaration line(s) but ' + pushCalls +
      ' push call(s), so it does not push one route per declaration');
  }

  if (!measurement.readings.topLevelPlusExpansion.closes) {
    failures.push(relative + ' decomposition: ' + topLevel + ' top-level + ' +
      expansionEntries + ' expansion = ' +
      (topLevel + expansionEntries) + ', but the module exports ' + exported);
  }

  if (!measurement.readings.literalPlusAddedExpansion.closes) {
    failures.push(relative + ' decomposition: ' + declarationLines +
      ' literal + ' + addedExpansionEntries + ' added expansion = ' +
      (declarationLines + addedExpansionEntries) + ', but the module exports ' +
      exported);
  }

  return measurement;
}

/**
 * Measures both declaration modules and collects every self-check failure.
 *
 * The failures are handed to buildSummary, which appends them to the summary's
 * unexpected figures - so a decomposition that does not close FAILS GENERATION
 * rather than being recorded as a curiosity. That is the point: a figure nobody
 * can reproduce is worse than no figure, and two figures that disagree are how
 * this finding arose.
 *
 * The measurement itself goes into the PROVENANCE SIDECAR and never into the
 * manifest. The manifest must stay byte-comparable between the two trees, and
 * these figures are per-tree by construction - the loop sits on a different
 * line in each - while the sidecar is per-tree by design and already carries
 * `declarationCounts`.
 *
 * @param {string} appRoot Absolute path.
 * @param {Object} loaded The result of loadRoutes.
 * @returns {{languages: (number|null), languagesSource: string,
 *            modules: Object[], failures: string[]}}
 * @throws {ToolError} If a declaration module's text cannot be read.
 */
function measureDeclarations(appRoot, loaded) {
  var modules = [
    measureDeclarationModule(appRoot, 'config/routes.js', loaded.routesCount,
      loaded.languageCount),
    measureDeclarationModule(appRoot, 'config/api_routes.js',
      loaded.apiRoutesCount, loaded.languageCount)
  ];
  var failures = [];

  modules.forEach(function (measurement) {
    measurement.failures.forEach(function (row) { failures.push(row); });
  });

  return {
    note: 'BOTH READINGS of the same totals are recorded and neither is ' +
      'asserted as the decomposition. They differ in ONE attribution: whether ' +
      'the route declarations written inside the per-language expansion loop ' +
      'body count as literal declarations or as part of the expansion. Both ' +
      'close, and a reading that stops closing is reported as an unexpected ' +
      'figure, which fails generation.',
    languages: loaded.languageCount,
    languagesSource: 'config.constants.trinketLangs',
    modules: modules,
    failures: failures
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
 * The pre-handler identity map for the tree under test.
 *
 * A map from FUNCTION VALUE to the name that function is EXPORTED UNDER by
 * lib/util/helpers.js, which is what lets a function-form pre-handler be named
 * in the manifest instead of recorded as an anonymous `null`.
 *
 * Reference identity is the whole mechanism, and it is exact: config/routes.js
 * and config/api_routes.js obtain their pre-handlers by requiring
 * lib/util/helpers.js, and this function requires THE SAME MODULE PATH inside
 * THE SAME appRoot, so Node's module cache returns the same instance and the
 * functions in the declarations are the very objects in this map. Nothing is
 * matched by name, by source or by shape, so nothing can be matched wrongly.
 *
 * The walk goes ONE LEVEL into an object export, because four of the fourteen
 * exports are `{ assign, method }` pre-handler objects - `findTrinket`,
 * `validLang`, `trinketTypeEnabled` and `coursesEnabled` - and it is the nested
 * `method` function that a route's `object-with-function` entry carries. Those
 * are recorded as `helpers.<export>.<key>`, which names them unambiguously; a
 * top-level function export is `helpers.<export>`. Without the nested level 110
 * of the 149 function-form entries would be unmatched, which is most of them.
 *
 * Two names for one function value keep the FIRST in export order, so the
 * result does not depend on which alias was reached first. Object.keys order is
 * the declaration order of the exports object, which is identical on both trees.
 *
 * @param {string} appRoot Absolute path.
 * @returns {{module: string, names: Map, exportCount: number,
 *            nameOf: function(*): (string|null)}}
 * @throws {ToolError} If lib/util/helpers.js cannot be loaded from `appRoot`.
 */
function buildPreHandlerIdentity(appRoot) {
  var helpers = requireFromApp(appRoot, 'lib/util/helpers');
  var names = new Map();
  var exportCount = 0;

  function record(value, name) {
    if (!names.has(value)) {
      names.set(value, name);
    }
  }

  Object.keys(helpers).forEach(function (key) {
    var value = helpers[key];

    exportCount += 1;

    if (typeof value === 'function') {
      record(value, 'helpers.' + key);
      return;
    }

    if (isPlainObject(value)) {
      // The exported object itself, so a declaration that uses it directly as a
      // pre entry is still identifiable, and then its function members.
      record(value, 'helpers.' + key);
      Object.keys(value).forEach(function (inner) {
        if (typeof value[inner] === 'function') {
          record(value[inner], 'helpers.' + key + '.' + inner);
        }
      });
    }
  });

  return {
    module: 'lib/util/helpers.js',
    names: names,
    exportCount: exportCount,
    nameOf: function (value) {
      return names.has(value) ? names.get(value) : null;
    }
  };
}

/**
 * The exported name of a pre-handler function, or null.
 *
 * @param {Object} identity The result of buildPreHandlerIdentity.
 * @param {*} value The function a declaration carries.
 * @returns {(string|null)}
 * @throws {ToolError} If no identity map was supplied, which would otherwise
 *   degrade every function-form entry to a silent null - the defect this
 *   mechanism exists to remove.
 */
function preHandlerName(identity, value) {
  if (!identity || typeof identity.nameOf !== 'function') {
    throw new ToolError('preDescriptors was called without the pre-handler ' +
      'identity map from buildPreHandlerIdentity; every function-form ' +
      'pre-handler would be recorded as an unidentified null');
  }

  return identity.nameOf(value);
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
 * A FUNCTION-FORM ENTRY IS NAMED BY ITS DECLARED EXPORT, RECOVERED BY REFERENCE
 * IDENTITY. Two things are true about a pre-handler function and only one of
 * them was previously acted on. A SOURCE DIGEST would indeed differ between the
 * two trees for all 149 function-form entries, because converting
 * lib/util/helpers.js to the hapi lifecycle contract is the very change this
 * gate must see THROUGH, and `.name` is indeed useless here - every one of these
 * functions reports an empty or property-inferred name. But the NAME THE
 * DECLARATION IMPORTS IT UNDER is neither of those things: the conversion
 * changed helper BODIES and SIGNATURES, not the export names that
 * config/routes.js and config/api_routes.js bind to, and measured over both
 * trees the recovered names are identical - 62 `helpers.trinketTypeEnabled.
 * method`, 23 `helpers.findFeaturedTrinkets`, 20 `helpers.validLang.method`, 18
 * `helpers.findTrinket.method`, 10 `helpers.coursesEnabled.method`, 6
 * `helpers.lowerUserFields`, 5 `helpers.courseBySlug`, 2
 * `helpers.userByUsername`, 1 `helpers.verifyEmailToken`, 1
 * `helpers.getDefaultTrinket`. Recording null for all 149 discarded WHICH
 * pre-handler runs on a route while keeping how many, so a route that swapped
 * `findTrinket` for `courseBySlug` compared equal - a change of behaviour on the
 * request path that the primary HTTP-surface gate could not see.
 *
 * A `null` method on a function-form entry now means one specific thing: the
 * function is not an export of lib/util/helpers.js. Exactly ONE entry is in
 * that position on both trees, and it is not a gap - it is the INLINE
 * pre-handler declared in place beside `helpers.lowerUserFields` on
 * `POST /api/users/login` (config/api_routes.js:1105 on the target,
 * config/api_routes.js:1104 on the baseline), which has no exported name to
 * recover because it has no export. The summary counts recovered and unresolved
 * separately and NAMES the unresolved ones with their index, so the distinction
 * is in the artifact rather than in this comment alone, and so a different
 * entry losing its identity fails the check even though the count would match.
 *
 * The order of the list is the declaration order, which is the execution order.
 *
 * @param {(Object|null)} declaration
 * @param {Object} preIdentity The result of buildPreHandlerIdentity, for the
 *   SAME tree the declaration came from.
 * @returns {Array<{kind: string, method: (string|null), assign: (string|null)}>}
 * @throws {ToolError} If `preIdentity` is absent.
 */
function preDescriptors(declaration, preIdentity) {
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
      return {
        kind: 'function',
        method: preHandlerName(preIdentity, entry),
        assign: null
      };
    }

    if (isPlainObject(entry) && typeof entry.method === 'function') {
      return {
        kind: 'object-with-function',
        method: preHandlerName(preIdentity, entry.method),
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
 * @param {Object} preIdentity The result of buildPreHandlerIdentity, used to
 *   name function-form pre-handlers.
 * @returns {Object} An entry whose keys are in ENTRY_KEY_ORDER.
 */
function buildEntry(appRoot, route, declaration, defaultAuth, extDerived, preIdentity) {
  var binding = controllerBinding(declaration);
  var entry = {
    method: String(route.method),
    path: String(route.path),
    controller: binding,
    handlerKind: classifyHandler(appRoot, route, binding),
    auth: effectiveAuth(route, defaultAuth),
    pre: preDescriptors(declaration, preIdentity),
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
 * both are findings. `unexpected` is also what runGenerate exits non-zero on,
 * so anything appended to it is a GATE FAILURE and not a note: that is where
 * the recovered server auth default and the declaration-decomposition
 * self-check report, since a wrong default auth silently rewrites 126 entries
 * and a decomposition that does not add up means the figures cannot be trusted.
 *
 * @param {Object[]} entries
 * @param {Object} loaded The result of loadRoutes.
 * @param {{strategy: string, mode: string, source: string}} defaultAuth The
 *   value readServerAuthDefault recovered from the analysed tree's app.js.
 * @param {{failures: string[]}} decomposition The result of
 *   measureDeclarations. Only its self-check failures are used here: the
 *   figures themselves belong to the provenance sidecar, because they are
 *   per-tree and the manifest must stay byte-comparable.
 * @returns {Object}
 */
function buildSummary(entries, loaded, defaultAuth, decomposition) {
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
    // The value recovered from the analysed tree's app.js, recorded here so the
    // artifact says what the 126 inherited entries inherited rather than
    // leaving a reader to infer it from them.
    serverAuthDefault: {
      strategy: defaultAuth.strategy,
      mode: defaultAuth.mode,
      source: defaultAuth.source
    },
    auth: { inherited: 0, session: 0, disabled: 0, other: 0 },
    routesWithPre: 0,
    preEntries: 0,
    // Function-form pre-handler identity, counted so the recovery is evidenced
    // in the artifact rather than asserted in a comment. `unresolved` is not a
    // gap to be tolerated: it is the one INLINE pre-handler on
    // POST /api/users/login, which has no exported name, and the verified
    // figures below fail generation if that stops being true - which is how a
    // helpers refactor that quietly broke the naming would be caught instead
    // of silently returning every entry to null.
    preFunctionForms: { entries: 0, recovered: 0, unresolved: 0, unresolvedEntries: [] },
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

    entry.pre.forEach(function (descriptor, index) {
      if (descriptor.kind !== 'function' &&
          descriptor.kind !== 'object-with-function') {
        return;
      }

      summary.preFunctionForms.entries += 1;

      if (descriptor.method === null) {
        summary.preFunctionForms.unresolved += 1;
        summary.preFunctionForms.unresolvedEntries.push(
          routeKey(entry.method, entry.path) + ' pre[' + index + ']');
      }
      else {
        summary.preFunctionForms.recovered += 1;
      }
    });

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
  // Sorted so the list is a set rather than a traversal order, which keeps two
  // manifests byte-comparable even if the parse order ever changes.
  summary.preFunctionForms.unresolvedEntries.sort();

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
  // The recovered default auth against the documented one. It is recovered per
  // tree and never substituted (see readServerAuthDefault), so a difference
  // here is a real change to what 126 entries inherit: reported as an
  // unexpected figure, which fails generation, while the per-entry comparison
  // reports the 126 differences themselves.
  expect('serverAuthDefault.strategy', summary.serverAuthDefault.strategy,
    FALLBACK_DEFAULT_AUTH.strategy);
  expect('serverAuthDefault.mode', summary.serverAuthDefault.mode,
    FALLBACK_DEFAULT_AUTH.mode);
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
  expect('preFunctionForms.entries', summary.preFunctionForms.entries,
    EXPECTED.preFunctionFormEntries);
  expect('preFunctionForms.recovered', summary.preFunctionForms.recovered,
    EXPECTED.preFunctionIdentitiesRecovered);
  expect('preFunctionForms.unresolved', summary.preFunctionForms.unresolved,
    EXPECTED.preFunctionIdentitiesUnresolved);
  expect('preFunctionForms.unresolvedEntries',
    summary.preFunctionForms.unresolvedEntries.join(', '),
    EXPECTED_UNRESOLVED_PRE_ENTRIES.join(', '));
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

  // The declaration decomposition's self-checks. Each reading must close
  // against the module's own exports; a reading that does not means the
  // measurement cannot be trusted, and an untrustworthy figure in a delivered
  // artifact is exactly how two documents came to state two different
  // decompositions of the same total. Reported here so generation fails.
  decomposition.failures.forEach(function (row) {
    summary.unexpected.push(row);
  });

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
  var decomposition = measureDeclarations(appRoot, loaded);
  // Built AFTER loadRoutes, so the require is a cache hit on the instance the
  // declarations already hold - reference identity depends on it being the same
  // module object, and resolving the same absolute path guarantees that either
  // way.
  var preIdentity = buildPreHandlerIdentity(appRoot);
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

    entries.push(buildEntry(appRoot, route, declaration, defaultAuth, extDerived,
      preIdentity));
  });

  assertJoinIsSound(loaded, matchedIndices, unmatchedIndices, extDerivedCount);

  sortEntries(entries);

  return {
    manifest: {
      // `schema` is a plain integer rather than a version string so a
      // comparator can refuse two manifests of different shapes without
      // parsing a version. Bump it whenever a recorded field changes meaning.
      //
      // 2: `pre[].method` now carries the recovered declared export name for a
      //    function-form pre-handler where schema 1 recorded null, and the
      //    summary gained `serverAuthDefault` and `preFunctionForms`. A schema-1
      //    manifest compared against a schema-2 one is REFUSED by
      //    compareManifests rather than reported as 149 spurious `pre`
      //    differences, which is exactly what this field is for.
      schema: 2,
      summary: buildSummary(entries, loaded, defaultAuth, decomposition),
      entries: entries
    },
    environment: environment,
    defaultAuth: defaultAuth,
    loaded: loaded,
    decomposition: decomposition
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
 * `digest` is what turns the sidecar from a description into a BINDING. Without
 * it the sidecar names a tree and a commit but nothing ties those to the bytes
 * beside it, so a manifest of one tree carrying the sidecar of another - or a
 * hand-edited entry - reads as authentic. With it, verifyManifestProvenance can
 * refuse both. It is computed over the exact serialized manifest text that is
 * written to disk, which is why runGenerate serializes BEFORE building this
 * record rather than after.
 *
 * @param {Object} generated The result of generateManifest.
 * @param {string} appRoot Absolute path.
 * @param {string} out Absolute path of the manifest.
 * @param {string} manifestText The exact text written to `out`.
 * @returns {Object}
 */
/**
 * Builds the shared-contract provenance block EMBEDDED in the manifest.
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
function buildContractProvenance(generated, appRoot, out) {
  var tree = provenance.treeIdentity(appRoot);

  return provenance.build({
    artifact     : out,
    // An analysis: this mode reads a tree and parses its route declarations
    // without executing the application, and it is run against both trees, so
    // the role follows the tree rather than the mode.
    role         : tree.isBaselineCommit ? 'baseline' : 'target',
    generatorFile: __filename,
    toolRoot     : TOOL_ROOT,
    analysedRoot : appRoot,
    detail       : {
      manifestSchema   : generated.manifest.schema,
      configuration    : {
        // The composed NODE_CONFIG is recorded as a DIGEST and a key list
        // rather than verbatim: the overlay a caller passes carries a database
        // name and a port, and both are run-local. The reproduction source is
        // the committed configuration plus the documented overlay, which is
        // where a reviewer gets the values from.
        NODE_ENV       : generated.environment.nodeEnv,
        nodeConfigKeys : Object.keys(safeParseJson(generated.environment.nodeConfig) || {}).sort(),
        // Through configurationDigest, never over the raw string. Hashing the
        // string verbatim did neither of the two things this field exists for:
        // an overlay's port and database name moved the digest on every run,
        // so it identified the run rather than the configuration, and a
        // session password or provider secret inside the overlay became an
        // unsalted digest in a committed artifact - an offline oracle for any
        // value cheap enough to guess.
        nodeConfigDigest: provenance.configurationDigest(
          safeParseJson(generated.environment.nodeConfig) || {}),
        nodeConfigDir  : provenance.pathLabel(generated.environment.nodeConfigDir, {
          toolRoot: TOOL_ROOT, analysedRoot: appRoot
        })
      },
      serverAuthDefault: generated.defaultAuth,
      declarationCounts: {
        'config/routes.js'    : generated.loaded.routesCount,
        'config/api_routes.js': generated.loaded.apiRoutesCount,
        declared              : generated.loaded.declaredCount,
        registered            : generated.manifest.entries.length
      }
    }
  });
}

function buildProvenance(generated, appRoot, out, manifestText) {
  return {
    artifact: path.basename(out),
    schema: generated.manifest.schema,
    digest: digestOf(manifestText),
    tree: {
      appRoot: appRoot,
      head: gitHead(appRoot),
      // The content identity of the analysed tree's manifest-determining
      // inputs. This is what lets a COMMITTED artifact be bound to the source
      // that produced it: `head` can only ever name the commit before the one
      // containing the artifact, while `sources.combined` is knowable at
      // generation time, survives that commit unchanged, and is falsified by
      // any edit to any input - including an uncommitted one, which `head`
      // cannot see at all.
      sources: measureManifestSources(appRoot)
    },
    tool: {
      path: path.relative(TOOL_ROOT, __filename) || path.basename(__filename),
      worktree: TOOL_ROOT,
      head: gitHead(TOOL_ROOT)
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      // What could have influenced this process's own interpreter, recorded
      // because generation happens IN this process. `execArgv` is the flags it
      // actually ran with, and `preloadVectorsPresent` is empty by
      // construction - `assertUncontaminatedProcess` refuses to generate
      // otherwise - which is what makes the empty list evidence rather than an
      // assumption. A reader comparing two sidecars can see that both trees
      // were parsed by an interpreter given the same instructions.
      execArgv: process.execArgv.slice(),
      preloadVectorsChecked: PRELOAD_ENV_VARS.slice(),
      preloadVectorsPresent: PRELOAD_ENV_VARS.filter(function (name) {
        return process.env[name] !== undefined && process.env[name] !== '';
      })
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
      registered: generated.manifest.entries.length,
      // The measured decomposition of those exported counts, stated BOTH WAYS.
      // It lives here rather than in the manifest because every figure in it is
      // read from the analysed tree's own source - down to the line the
      // expansion loop sits on, which differs between the two trees - and the
      // manifest has to stay byte-comparable.
      decomposition: generated.decomposition
    }
  };
}

/**
 * The generate mode.
 *
 * Writes the manifest and its provenance sidecar, and DECIDES AN EXIT CODE from
 * the summary's verified-baseline check. Two things are true at once and
 * neither is negotiable: the artifact is always written in full, with every
 * unexpected figure listed, because the artifact is the evidence of what the
 * tree actually declares and correcting or withholding it would destroy the
 * only record of the drift; and the mode exits EXIT_DIFFERENCE when any figure
 * disagrees, because a generator that always exits 0 cannot be used as a gate
 * and its warnings are read by nobody. A caller that wants the artifact
 * regardless of the verdict already has it - on disk, complete - and can ignore
 * the status deliberately rather than by accident.
 *
 * @param {Object} options The parsed command line.
 * @returns {number} EXIT_OK when every summary figure matches the verified
 *   baseline, EXIT_DIFFERENCE when any does not.
 * @throws {ToolError}
 */
function runGenerate(options) {
  var out = options.out ||
    resolveArtifactPath(ARTIFACT_NAMES.manifest, '--out');
  var generated;
  var sidecar;
  var summary;
  var manifestText;
  var record;

  assertAppRoot(options.appRoot);

  generated  = generateManifest(options.appRoot);
  summary    = generated.manifest.summary;

  // The shared-contract block is EMBEDDED, which is what makes a delivered
  // manifest say which tree it measured without a companion file, and
  // attach() hash-links it to the payload so a block copied in from another
  // run is detectable. The per-entry `--compare` gate never reads it, and
  // `--verify` compares payloads rather than raw bytes for the same reason, so
  // embedding costs neither gate its byte-exactness.
  record = buildContractProvenance(generated, options.appRoot, out);
  provenance.attach(generated.manifest, record);

  // Serialized AFTER the block is attached and BEFORE the sidecar is built,
  // because the sidecar's digest is taken over exactly the bytes written.
  manifestText = serialize(generated.manifest);
  sidecar      = buildProvenance(generated, options.appRoot, out, manifestText);

  writeArtifact(out, manifestText);
  writeArtifact(out + PROVENANCE_SUFFIX, serialize(sidecar));

  note('manifest: ' + summary.routes + ' routes from ' + options.appRoot);
  note('  artifact   ' + out);
  note('  provenance ' + out + PROVENANCE_SUFFIX);
  note('  digest     ' + sidecar.digest);
  note('  generator  ' + record.generator.path + ' blob ' +
    String(record.generator.blob).slice(0, 12) +
    (record.generator.verified
      ? ', verified in commit ' + String(record.generator.commit).slice(0, 7)
      : ', NOT YET COMMITTED (' + record.generator.commitState + ')'));

  if (summary.unexpected.length) {
    // Reported, never corrected, and now FAILED. A figure that disagrees with
    // the verified baseline means the tool is wrong or the tree is; both are
    // findings, and neither is a reason to change the artifact - so the
    // artifact is written in full and every row is listed, and the mode exits
    // EXIT_DIFFERENCE so that a shell pipeline cannot mistake drift for
    // success. A generator that could not fail would be a generator whose
    // output nobody had to read.
    note('FAIL: ' + summary.unexpected.length + ' summary figure(s) differ ' +
      'from the verified baseline. The artifact is unchanged; this is a ' +
      'finding to record, not to correct:');
    summary.unexpected.forEach(function (row) { note('  - ' + row); });
    return EXIT_DIFFERENCE;
  }

  return EXIT_OK;
}

/**
 * The verify mode: does the COMMITTED manifest still describe THIS tree?
 *
 * This mode exists because of a property of committed evidence that no
 * identifier can escape. `buildProvenance` records the analysed tree's
 * `git rev-parse HEAD`, and `verifyManifestProvenance` refuses a manifest whose
 * recorded HEAD is not the tree's current HEAD - which is the right rule for a
 * consumer, since a manifest generated at another commit may describe another
 * HTTP surface. But an artifact that is COMMITTED can only ever record the
 * commit that came BEFORE the commit containing it: the hash of a commit is not
 * known until the commit exists, and the artifact has to exist first to be in
 * it. So the committed manifest's sidecar names its parent, permanently, and no
 * amount of care at generation time changes that.
 *
 * The answer is to stop asking the question with an identifier and ask it with
 * the artifact. This mode regenerates the manifest from the tree in front of it
 * and compares it to the one on disk BYTE FOR BYTE, which settles the real
 * question - "is this evidence still true of this tree?" - without reference to
 * any commit at all. It is strictly stronger than the HEAD equality it stands
 * in for: a HEAD string matches while the working tree is dirty, and this does
 * not.
 *
 * It is deliberately NOT folded into `verifyManifestProvenance`. That function
 * is the cheap per-run check a CONSUMER makes to decide whether a manifest
 * handed to it belongs to the tree it is driving; it reads two files and hashes
 * one. Regenerating inside it would make every consumer pay for loading the
 * analysed tree's whole controller graph, and would turn a pure check into one
 * that needs the application to be loadable. The two mechanisms compose: the
 * cheap one guards consumption, this one proves freshness, and the
 * HEAD-mismatch error names this mode as the way to establish it.
 *
 * NOTE ON THE CONSUMERS, stated as it is rather than as it should be:
 * `test/parity/capture.js` and `test/parity/replay.js` both default their
 * manifest to `test/parity/route-manifest.json` and, at the time of writing,
 * both call the UNVERIFIED `readManifest` at their `resolveManifest` - so the
 * strict path exists, is exported and is proven, but they do not yet take it.
 * Each is a one-call change, `readManifest(options.manifestPath)` becoming
 * `readManifestForApp(options.manifestPath, options.appRoot)` with `appRoot`
 * already in scope at both sites. Those two files belong to other work units,
 * so the change is recorded here rather than made here.
 *
 * The manifest's own summary figures are checked too, by the same `expect()`
 * path generation uses, so a tree that has drifted from the verified baseline
 * fails here as well rather than only at generation.
 *
 * @param {Object} options The parsed command line.
 * @returns {number} EXIT_OK when the artifact reproduces exactly,
 *   EXIT_DIFFERENCE when it does not.
 * @throws {ToolError} When the artifact cannot be read at all.
 */
/**
 * A manifest's comparable payload: its own content with the embedded
 * provenance block removed.
 *
 * The block is deliberately excluded from the freshness comparison. It records
 * the analysed and delivered HEADs, which advance on every commit - including
 * the commit that stores this very artifact - so a raw byte comparison would
 * fail for a reason that says nothing about the routes. The payload is what
 * `attach()` hash-links through `payloadDigest`, so this is the same boundary
 * the provenance contract itself draws, and `--verify-provenance` checks the
 * block on its own terms.
 *
 * @param {string} text A serialized manifest.
 * @returns {string} the canonical payload, or the input when it will not parse.
 */
function payloadText(text) {
  var parsed = safeParseJson(text);
  var payload = {};

  if (!isPlainObject(parsed)) {
    return text;
  }

  Object.keys(parsed).forEach(function (key) {
    if (key !== 'provenance') {
      payload[key] = parsed[key];
    }
  });

  return serialize(payload);
}

function runVerify(options) {
  var out = options.out || COMMITTED_MANIFEST;
  var recorded;
  var recordedManifest;
  var generated;
  var regeneratedText;
  var difference;
  var comparison;

  assertAppRoot(options.appRoot);

  try {
    recorded = fs.readFileSync(out, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot read the manifest to verify at ' + out + ': ' +
      err.message + '. Generate it first with `node ' +
      path.relative(TOOL_ROOT, __filename) + ' --out ' + out + '`.');
  }

  try {
    recordedManifest = JSON.parse(recorded);
  }
  catch (err) {
    throw new ToolError('the manifest at ' + out + ' is not valid JSON, so it ' +
      'cannot be verified: ' + err.message);
  }

  // INTEGRITY FIRST, and fatal. A sidecar that is present but does not
  // describe this artifact means the pair on disk was not produced by one run,
  // and the byte comparison below would then report on a file whose own
  // provenance disowns it. The USAGE text promises exit 2 for exactly this, so
  // skipping it would make the documented contract false. A MISSING sidecar is
  // permitted, as everywhere else in this file: an artifact generated by hand
  // or by an older tool has no sidecar to contradict it.
  if (fs.existsSync(out + PROVENANCE_SUFFIX)) {
    verifyManifestIntegrity(out);
    note('verify: sidecar integrity verified for ' + path.basename(out));
  }
  else {
    note('verify: no sidecar beside ' + path.basename(out) +
      ' - integrity UNVERIFIED (permitted)');
  }

  generated       = generateManifest(options.appRoot);
  regeneratedText = serialize(generated.manifest);

  note('verify: ' + out);
  note('  tree            ' + options.appRoot);
  note('  recorded digest ' + digestOf(recorded));
  note('  this tree emits ' + digestOf(regeneratedText));

  if (payloadText(regeneratedText) === payloadText(recorded)) {
    note('  the committed manifest describes this tree: its payload - every ' +
      'entry and the summary - is identical to what this tree emits');

    if (generated.manifest.summary.unexpected.length) {
      note('FAIL: the artifact reproduces, but ' +
        generated.manifest.summary.unexpected.length + ' summary figure(s) ' +
        'differ from the verified baseline:');
      generated.manifest.summary.unexpected.forEach(function (row) {
        note('  - ' + row);
      });
      return EXIT_DIFFERENCE;
    }

    note('PASS - the committed manifest describes this tree, at ' +
      generated.manifest.summary.routes + ' routes');
    return EXIT_OK;
  }

  // Not identical. Say where, in both registers: the first differing byte for
  // whoever has to look at the file, and the per-entry comparison for whoever
  // has to judge whether the HTTP surface moved. A digest mismatch alone tells
  // a reader nothing about which route changed.
  difference = firstTextDifference(recorded, regeneratedText);

  note('FAIL - the committed manifest is NOT what this tree emits.');

  if (difference) {
    // `firstTextDifference` names its two sides `baselineLine` and
    // `targetLine`, after the comparison it was written for. Here the
    // "baseline" side is the committed artifact and the "target" side is what
    // the tree emits now, so the labels are re-worded and the FIELD NAMES are
    // the ones the function actually returns.
    note('  first difference at line ' + difference.line + ' column ' +
      difference.column);
    note('    committed : ' + abbreviate(difference.baselineLine));
    note('    this tree : ' + abbreviate(difference.targetLine));
  }

  if (Array.isArray(recordedManifest.entries) &&
      recordedManifest.schema === generated.manifest.schema) {
    comparison = compareManifests(recordedManifest, generated.manifest);
    note('');
    note(comparison.lines.join('\n'));
    note('  ' + comparison.differences + ' entry difference(s) between the ' +
      'committed artifact and this tree');
  }
  else if (recordedManifest.schema !== generated.manifest.schema) {
    note('  the committed artifact declares schema ' +
      JSON.stringify(recordedManifest.schema) + ' and this tool emits schema ' +
      JSON.stringify(generated.manifest.schema) + ', so the two are not ' +
      'entry-comparable; regenerate the artifact.');
  }

  note('');
  note('Regenerate the evidence with: node ' +
    path.relative(TOOL_ROOT, __filename) + ' --out ' + out);

  return EXIT_DIFFERENCE;
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
 * Verifies one side of a comparison against its own provenance sidecar.
 *
 * `--compare` is handed two manifests and NO `--app`, so the tree each manifest
 * must describe is the tree ITS OWN SIDECAR names. That is not circular: the
 * sidecar's digest binds it to these exact bytes, and its `tree.head` binds it
 * to that tree's current commit, so a manifest that has been edited, or whose
 * tree has moved on since it was generated, is caught here rather than compared.
 *
 * A MISSING sidecar is permitted and reported. The mode must keep working on a
 * hand-made or hand-reduced manifest - that is a legitimate way to interrogate
 * a difference - and refusing one would remove a capability without closing a
 * hole, since the hole is a sidecar that is present and wrong. A sidecar that
 * IS present is therefore verified in full and any inconsistency is fatal.
 *
 * @param {string} manifestPath Absolute path.
 * @param {string} label 'baseline' or 'target', for the diagnostic line.
 * @returns {(Object|null)} The verified sidecar, or null when there is none.
 * @throws {ToolError} If a present sidecar is inconsistent with the manifest or
 *   the tree it names.
 */
function verifySuppliedManifest(manifestPath, label) {
  var sidecarPath = manifestPath + PROVENANCE_SUFFIX;
  var sidecar;

  if (!fs.existsSync(sidecarPath)) {
    note('  ' + label + ' provenance: none beside ' + manifestPath +
      ' - UNVERIFIED (permitted: a hand-made manifest has no sidecar)');
    return null;
  }

  try {
    sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
  }
  catch (err) {
    throw new ToolError('provenance sidecar ' + sidecarPath +
      ' cannot be read as JSON: ' + err.message);
  }

  if (!isPlainObject(sidecar) || !sidecar.tree ||
      typeof sidecar.tree.appRoot !== 'string') {
    throw new ToolError('provenance sidecar ' + sidecarPath +
      ' records no tree.appRoot, so the ' + label +
      ' manifest cannot be attributed to a tree');
  }

  // INTEGRITY is fatal: an artifact that is not the one its sidecar describes
  // has been edited, truncated or swapped, and comparing it would produce a
  // verdict about a file nobody generated. This is the check that matters here,
  // and it is answerable from the two files alone.
  verifyManifestIntegrity(manifestPath);

  // The TREE BINDING is reported, not enforced, and the reason is structural
  // rather than lenient: `--compare` is handed two recorded artifacts and no
  // tree, so there is no tree to bind them to. Enforcing it here would fail the
  // gate for two things that are both expected and both unrelated to what it
  // compares.
  //
  // The BASELINE side names a `git worktree` that AAP 0.9.3 creates
  // TRANSIENTLY, so on any host but the one that captured it - and on that host
  // once the worktree is removed - the recorded directory is simply gone. The
  // TARGET side names the commit the artifact was generated at, which for a
  // COMMITTED artifact is necessarily the commit BEFORE the one containing it.
  // Under enforcement the committed evidence's own comparison command would
  // exit 2 forever, for reasons that say nothing about the two manifests.
  //
  // So the recorded identity is printed - which tree, at which commit, and
  // whether either is still resolvable here - and the reader gets the facts.
  // The enforcing path still exists and is unweakened: readManifestForApp
  // requires the full binding, because a caller about to DRIVE a tree can
  // supply it, and refusing a manifest of the wrong tree is that function's
  // whole purpose.
  noteRecordedTree(label, sidecar);

  return sidecar;
}

/**
 * Reports which tree and commit a sidecar records, and whether they still
 * resolve on this host.
 *
 * @param {string} label 'baseline' or 'target'.
 * @param {Object} sidecar
 * @returns {undefined}
 */
function noteRecordedTree(label, sidecar) {
  var recordedHead = sidecar.tree.head || null;
  var resolvable = fs.existsSync(sidecar.tree.appRoot);
  var currentHead = resolvable ? gitHead(sidecar.tree.appRoot) : null;
  var state;

  if (!resolvable) {
    // Expected for a baseline worktree, which is created for the capture and
    // removed after it.
    state = 'tree no longer present on this host';
  }
  else if (recordedHead === null) {
    state = 'no HEAD recorded';
  }
  else if (currentHead === null) {
    state = 'tree present but its HEAD is unreadable';
  }
  else if (currentHead === recordedHead) {
    state = 'tree present and still at that commit';
  }
  else {
    state = 'tree now at ' + currentHead + ' - expected for a committed ' +
      'artifact, whose provenance names its parent commit; `--verify` settles ' +
      'whether it still describes the tree';
  }

  note('  ' + label + ' provenance: integrity verified; records ' +
    sidecar.tree.appRoot + ' at HEAD ' +
    (recordedHead === null ? '(none)' : recordedHead));
  note('    ' + state);
}

/**
 * The --compare mode.
 *
 * @param {Object} options The parsed command line.
 * @returns {number} EXIT_OK on no difference, EXIT_DIFFERENCE otherwise.
 * @throws {ToolError}
 */
function runCompare(options) {
  var baseline;
  var target;
  var result;

  note('provenance checks before comparison:');
  verifySuppliedManifest(options.compare[0], 'baseline');
  verifySuppliedManifest(options.compare[1], 'target');

  baseline = readManifest(options.compare[0]);
  target   = readManifest(options.compare[1]);
  result   = compareManifests(baseline, target);
  var verdict  = result.differences === 0
    ? 'PASS - the HTTP surface is identical across all ' + result.compared +
      ' entries'
    : 'FAIL - ' + result.differences + ' difference(s): ' +
      result.onlyInBaseline.length + ' only in baseline, ' +
      result.onlyInTarget.length + ' only in target, ' + result.changed +
      ' with differing fields';
  var report = result.lines.concat([verdict, '']).join('\n');

  // Written to stderr so stdout stays empty.
  process.stderr.write(report);

  if (options.out) {
    // A STRUCTURED result, with the human report carried inside it. The gate's
    // outcome has two audiences and one artifact has to serve both: something
    // downstream has to be able to read the verdict without parsing prose, and
    // a reviewer has to be able to read the prose without reconstructing it. So
    // the top-level fields are the machine's - `pass`, the counts, the exit
    // code this run returned, the two manifests and the digest of each, and the
    // per-entry differences - and `report` is the same text that went to
    // stderr, retained verbatim so it can still be quoted as evidence.
    //
    // The digests are what tie the result to the inputs: a compare result
    // naming two manifests is worth nothing if either has since been edited,
    // and these let a reader confirm the pair this verdict was reached over.
    writeArtifact(options.out, serialize({
      schema: 1,
      artifact: path.basename(options.out),
      gate: 'route-manifest per-entry comparison',
      note: 'The primary parity gate for the HTTP surface (AAP 0.9.1). Entries ' +
        'are joined on method + path and every recorded field is compared, ' +
        'auth per entry. The summary figures inside each manifest are context ' +
        'only and are not the pass condition.',
      pass: result.differences === 0,
      exitCode: result.differences === 0 ? EXIT_OK : EXIT_DIFFERENCE,
      verdict: verdict,
      compared: result.compared,
      differences: result.differences,
      changed: result.changed,
      onlyInBaseline: result.onlyInBaseline,
      onlyInTarget: result.onlyInTarget,
      inputs: {
        baseline: {
          path: artifactPathLabel(options.compare[0]),
          artifact: path.basename(options.compare[0]),
          digest: digestOfFile(options.compare[0]),
          schema: baseline.schema === undefined ? null : baseline.schema,
          routes: (baseline.summary && baseline.summary.routes) || null
        },
        target: {
          path: artifactPathLabel(options.compare[1]),
          artifact: path.basename(options.compare[1]),
          digest: digestOfFile(options.compare[1]),
          schema: target.schema === undefined ? null : target.schema,
          routes: (target.summary && target.summary.routes) || null
        }
      },
      report: report
    }));
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
 * the other tree would silently override it, so `mongo.applyConfigIsolation`
 * removes one in its 'clean' mode.
 *
 * The same call supplies the three runtime-layer controls, and here they matter
 * more than anywhere else in this file: this child requires the application,
 * and therefore `config`, with its working directory set to the tree under
 * test - so without them `config` creates config/runtime.json INSIDE that tree.
 * A gate whose evidence-gathering writes into the "untouched" baseline is not
 * evidence, and .gitignore listing the path is what let it go unnoticed.
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
  // Removed for the reason PRELOAD_ENV_VARS gives: this capture is compared
  // byte for byte across two trees, so nothing outside the tree under test may
  // be able to add a line to its stdout or change which modules it loads.
  PRELOAD_ENV_VARS.forEach(function (name) { delete env[name]; });
  mongo.applyConfigIsolation(env, { appRoot: appRoot, configDir: 'clean' });
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
      maxBuffer: 32 * 1024 * 1024,
      // The CLI self-executes and emits its table; it does not wait for
      // anything. A child that has not finished within the budget is wedged -
      // most plausibly a controller reaching a network resource - and because
      // this is a SYNCHRONOUS spawn there is no timer that could rescue this
      // process from it, so the budget is enforced by node itself.
      timeout: CLI_TIMEOUT_MS,
      killSignal: 'SIGKILL'
    }
  );

  // A timeout is reported as a timeout. It is a different finding from a child
  // that ran and failed - one names a budget and the other names an exit code -
  // and conflating them sends a reader to the wrong place.
  if (result.error && result.error.code === 'ETIMEDOUT') {
    throw new ToolError('the route-table CLI did not finish within ' +
      CLI_TIMEOUT_MS + 'ms and was killed. It loads every controller in ' +
      appRoot + '; run `NODE_CONFIG=\'{"db":{"redis":{"enabled":false}}}\' ' +
      'NODE_ENV=test node ' +
      path.join(appRoot, 'lib', 'util', 'routeParser.js') + ' ' +
      args.join(' ') + '` there to see where it stops.');
  }

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
 * one the replacement of the argv parser directly threatens.
 *
 * THE DATA-ROW COUNT IS ENFORCED, FOR EVERY FORM, not reported. Within-tree
 * byte equality cannot see a drift that all three forms share - lose twenty
 * rows from config/routes.js and all three forms lose the same twenty, so they
 * still match each other and the capture would otherwise exit 0 with a table
 * that no longer describes the route surface. Checking only `captures[0]` had
 * the same blind spot from the other direction: a form whose own count moved
 * while the reference form's did not is a divergence, and it is caught by the
 * byte comparison, but a count check that looks at one form is not the check
 * this artifact needs. Both halves are therefore mechanical here, and
 * `--compare-cli` adds the third: the same three forms compared ACROSS the two
 * trees, which is the only thing that can see a drift consistent in both
 * directions.
 *
 * @param {Object} options The parsed command line.
 * @returns {number} EXIT_OK, or EXIT_DIFFERENCE if the forms diverged within
 *   the tree or any form's data-row count differs from the verified baseline.
 * @throws {ToolError}
 */
function runCliTable(options) {
  var out = options.out ||
    resolveArtifactPath(ARTIFACT_NAMES.cliTable, '--out');
  var captures = [];
  var reference = null;
  var divergent = [];
  var unexpectedRows = [];
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

    if (split.dataRows !== EXPECTED.cliTableDataRows) {
      unexpectedRows.push(form.label + ': ' + split.dataRows + ' data row(s), ' +
        'verified baseline is ' + EXPECTED.cliTableDataRows);
    }
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
    // Recorded in the artifact as well as reported, so the artifact carries its
    // own verdict and a reader who has only the file can tell whether the
    // capture passed.
    formsWithUnexpectedDataRows: unexpectedRows,
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

  if (unexpectedRows.length) {
    // Enforced, not warned. The artifact is written in full either way - it is
    // the evidence of what the tree actually emitted, and suppressing it would
    // destroy the only record of the drift - but the mode fails, because a
    // capture that cannot fail on a wrong row count is not a check.
    note('FAIL: ' + unexpectedRows.length + ' invocation form(s) emitted an ' +
      'unexpected number of data rows. The artifact is unchanged; judge the ' +
      'change with the route manifest comparison:');
    unexpectedRows.forEach(function (row) { note('  - ' + row); });
    return EXIT_DIFFERENCE;
  }

  note('  all forms at the verified baseline of ' + EXPECTED.cliTableDataRows +
    ' data row(s)');

  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// --compare-cli - the CROSS-TREE half of the route-table check
// ---------------------------------------------------------------------------

// The fields of one captured invocation form that are compared across the two
// trees. `table` and `stdout` are compared BYTE FOR BYTE and are what the gate
// is really about; `bytes`, `dataRows` and `header` are compared as well
// because they localize a difference to a shape a reader can act on - a lost
// column shows up in `header`, a lost route in `dataRows` - and because a
// difference in one of them with equal bytes would mean this tool's own split
// had changed and nothing else would report that.
//
// `stdout` includes the application's preamble line, which is not table output.
// A difference in `stdout` with `table` equal therefore says the preamble
// changed, not the table; both are reported separately so the two cannot be
// confused, and neither is normalized away.
var CLI_COMPARED_FIELDS = ['bytes', 'dataRows', 'header', 'table', 'stdout'];

// The schema a --cli-table artifact must declare. An artifact of another schema
// records different fields, and comparing it would compare absences.
var CLI_TABLE_SCHEMA = 1;

// The type each compared field must have, checked BEFORE any comparison. This
// is not defensive tidiness: `undefined === undefined` is true, so two
// artifacts that both lack `table` would compare EQUAL and the gate would
// report the forms byte-identical having compared nothing at all. A gate whose
// pass condition is satisfiable by absence is not a gate.
var CLI_FIELD_TYPES = {
  bytes: 'number',
  dataRows: 'number',
  header: 'string',
  table: 'string',
  stdout: 'string'
};

// Above this length a differing field is reported by its byte length and first
// difference rather than in full: a captured table is 22 KB and pasting two of
// them into a report would bury the difference it is supposed to show. Header
// rows and every scalar are far below it and are reported verbatim.
var CLI_VALUE_ABBREVIATE_OVER = 400;

/**
 * Locates the first difference between two strings, in line and column terms.
 *
 * Reported instead of a full diff because the interesting fact about two
 * captured tables that should be identical is WHERE they stop being identical:
 * a difference in the header row means a column changed, one at line 40 means a
 * route did. Line and column are 1-based, as an editor counts them.
 *
 * @param {string} left
 * @param {string} right
 * @returns {(Object|null)} Null when the strings are equal.
 */
function firstTextDifference(left, right) {
  var limit = Math.min(left.length, right.length);
  var offset = 0;
  var line = 1;
  var column = 1;
  var i;

  while (offset < limit && left.charAt(offset) === right.charAt(offset)) {
    if (left.charAt(offset) === '\n') {
      line += 1;
      column = 1;
    }
    else {
      column += 1;
    }
    offset += 1;
  }

  if (offset === left.length && offset === right.length) {
    return null;
  }

  function lineAt(text) {
    var start = text.lastIndexOf('\n', offset === 0 ? 0 : offset - 1);
    var end = text.indexOf('\n', offset);

    // lastIndexOf returns the newline itself when offset sits on one, so the
    // line starts one character later either way.
    start = start === -1 ? 0 : start + 1;
    if (start > offset) { start = offset; }

    return text.slice(start, end === -1 ? text.length : end);
  }

  i = {
    offset: offset,
    line: line,
    column: column,
    baselineLine: lineAt(left),
    targetLine: lineAt(right)
  };

  return i;
}

/**
 * Shortens a value for a report, marking that it was shortened.
 *
 * @param {*} value
 * @returns {string}
 */
function abbreviate(value) {
  var text = typeof value === 'string' ? value : JSON.stringify(value);

  if (text === undefined) {
    return 'undefined';
  }

  if (text.length <= CLI_VALUE_ABBREVIATE_OVER) {
    return text;
  }

  return text.slice(0, CLI_VALUE_ABBREVIATE_OVER) + '... (' + text.length +
    ' characters in total)';
}

/**
 * Reads and indexes a --cli-table artifact.
 *
 * @param {string} target Absolute path.
 * @param {string} label 'baseline' or 'target', for diagnostics.
 * @returns {{path: string, artifact: Object, index: Object, labels: string[]}}
 * @throws {ToolError} If the file is missing, not JSON, not a --cli-table
 *   artifact, or names one invocation form twice.
 */
function readCliTableArtifact(target, label) {
  var text;
  var artifact;
  var index = {};
  var labels = [];

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot read the ' + label + ' route-table artifact ' +
      target + ': ' + err.message);
  }

  try {
    artifact = JSON.parse(text);
  }
  catch (err) {
    throw new ToolError('the ' + label + ' route-table artifact ' + target +
      ' is not valid JSON: ' + err.message);
  }

  if (!isPlainObject(artifact) || !Array.isArray(artifact.captures)) {
    throw new ToolError('the ' + label + ' route-table artifact ' + target +
      ' has no `captures` array; it was not produced by --cli-table');
  }

  artifact.captures.forEach(function (capture) {
    if (!isPlainObject(capture) || typeof capture.label !== 'string') {
      throw new ToolError('a capture in the ' + label + ' route-table artifact ' +
        target + ' has no string `label`, so the two artifacts cannot be joined');
    }

    if (Object.prototype.hasOwnProperty.call(index, capture.label)) {
      throw new ToolError('the ' + label + ' route-table artifact ' + target +
        ' records the invocation form ' + JSON.stringify(capture.label) +
        ' twice, so the join is ambiguous');
    }

    index[capture.label] = capture;
    labels.push(capture.label);
  });

  assertCliTableContract(target, label, artifact, index);

  return { path: target, artifact: artifact, index: index, labels: labels };
}

/**
 * Asserts that a --cli-table artifact carries EXACTLY the contracted forms,
 * each with the fields the comparison reads.
 *
 * This exists because of a false pass that the cross-tree comparison alone
 * cannot close. The comparison joins the two artifacts on form label and walks
 * the union of the labels it finds, so a form absent from BOTH artifacts is not
 * "different" - it is not there at all, and it drops out of the walk silently.
 * Measured on the artifacts before this check: two artifacts each missing
 * `bare` exited 0 reporting "PASS - all 2 invocation form(s)", and two with
 * empty `captures` arrays exited 0 reporting "PASS - all 0". Capture and
 * comparison could regress together and the gate would applaud.
 *
 * The contract is not this tool's preference, it is AAP 0.3.1 / 0.4.2: the
 * route-table CLI has three invocation forms - no argument, `-R` and the
 * `--routes` alias - and byte-identical output across ALL THREE is what
 * constrains the replacement of the argv parser. A comparison that covered two
 * of them would leave the third unguarded, which is the exact failure the AAP
 * calls out: "an argv check that tested only for `-R` would silently change the
 * other two, and nothing else in the repository would notice."
 *
 * So: every contracted form must be present, no form outside the contract may
 * be, and each capture must carry each compared field with the right type.
 * Duplicates are already fatal in the caller.
 *
 * @param {string} target Absolute path, for diagnostics.
 * @param {string} label 'baseline' or 'target'.
 * @param {Object} artifact The parsed artifact.
 * @param {Object} index Its captures, by form label.
 * @returns {undefined}
 * @throws {ToolError} Naming every form or field at fault.
 */
function assertCliTableContract(target, label, artifact, index) {
  var expected = CLI_FORMS.map(function (form) { return form.label; });
  var absent = [];
  var unexpected = [];
  var malformed = [];

  if (artifact.schema !== CLI_TABLE_SCHEMA) {
    throw new ToolError('the ' + label + ' route-table artifact ' + target +
      ' declares schema ' + JSON.stringify(artifact.schema) + ', not ' +
      CLI_TABLE_SCHEMA + '; it records different fields and cannot be compared');
  }

  expected.forEach(function (formLabel) {
    if (!Object.prototype.hasOwnProperty.call(index, formLabel)) {
      absent.push(formLabel);
    }
  });

  Object.keys(index).forEach(function (formLabel) {
    if (expected.indexOf(formLabel) === -1) {
      unexpected.push(formLabel);
    }
  });

  if (absent.length) {
    throw new ToolError('the ' + label + ' route-table artifact ' + target +
      ' is missing ' + absent.length + ' of the ' + expected.length +
      ' contracted invocation form(s): ' + absent.join(', ') +
      '. AAP 0.3.1/0.4.2 require all of ' + expected.join(', ') +
      ' to be captured and compared, and a form missing from BOTH artifacts ' +
      'would otherwise drop out of the comparison and pass. Recapture with ' +
      '--cli-table.');
  }

  if (unexpected.length) {
    throw new ToolError('the ' + label + ' route-table artifact ' + target +
      ' records invocation form(s) this tool does not capture: ' +
      unexpected.join(', ') + '. The contracted forms are ' +
      expected.join(', ') + '; the artifact was not produced by --cli-table.');
  }

  expected.forEach(function (formLabel) {
    var capture = index[formLabel];

    Object.keys(CLI_FIELD_TYPES).forEach(function (field) {
      if (typeof capture[field] !== CLI_FIELD_TYPES[field]) {
        malformed.push(formLabel + '.' + field + ' is ' +
          (Object.prototype.hasOwnProperty.call(capture, field)
            ? typeof capture[field]
            : 'absent') +
          ', expected ' + CLI_FIELD_TYPES[field]);
      }
    });
  });

  if (malformed.length) {
    throw new ToolError('the ' + label + ' route-table artifact ' + target +
      ' has ' + malformed.length + ' capture field(s) the comparison cannot ' +
      'read, and comparing an absent field against an absent field would ' +
      'report them equal: ' + malformed.join('; ') + '. Recapture with ' +
      '--cli-table.');
  }
}

/**
 * The ordered union of the two artifacts' form labels.
 *
 * CLI_FORMS order first, so the report reads in the order the forms are
 * captured, then anything else in sorted order - a label this tool does not
 * define is still compared and still reported, because an artifact carrying an
 * extra form is evidence about the CLI and not something to discard.
 *
 * @param {string[]} baselineLabels
 * @param {string[]} targetLabels
 * @returns {string[]}
 */
function orderedFormLabels(baselineLabels, targetLabels) {
  var seen = {};
  var ordered = [];
  var extra = [];

  CLI_FORMS.forEach(function (form) { seen[form.label] = false; });

  baselineLabels.concat(targetLabels).forEach(function (label) {
    if (Object.prototype.hasOwnProperty.call(seen, label)) {
      seen[label] = true;
      return;
    }
    if (extra.indexOf(label) === -1) { extra.push(label); }
  });

  CLI_FORMS.forEach(function (form) {
    if (seen[form.label]) { ordered.push(form.label); }
  });

  return ordered.concat(extra.sort());
}

/**
 * Compares two --cli-table artifacts captured from DIFFERENT TREES.
 *
 * This is the check the within-tree comparison in `runCliTable` structurally
 * cannot make. All three invocation forms read the same `config/routes.js`
 * through the same parser, so any change to the route surface moves all three
 * together: they stay byte-identical to each other while no longer describing
 * the same routes. A 112-row table dropping to 92 rows on both trees' terms
 * therefore passed the within-tree check with nothing but a warning. Comparing
 * baseline against target, form by form, is what sees it - and comparing every
 * form rather than one is what sees a drift that a single form escaped.
 *
 * Two independent verdicts are folded in, and both count as differences:
 *   CROSS-TREE   every compared field of every form, byte for byte.
 *   ROW COUNT    each side's `dataRows` against EXPECTED.cliTableDataRows, so
 *                that two artifacts which agree with each other but not with
 *                the verified baseline still fail.
 *
 * A form present in one artifact and not the other is reported as such rather
 * than skipped: an invocation form that stopped being captured is exactly the
 * regression the three-form gate exists to catch.
 *
 * @param {Object} baseline The result of readCliTableArtifact.
 * @param {Object} target The result of readCliTableArtifact.
 * @returns {{lines: string[], differences: number, forms: Object[],
 *            onlyInBaseline: string[], onlyInTarget: string[], changed: number,
 *            compared: number, rowCountMismatches: string[]}}
 */
function compareCliTables(baseline, target) {
  var labels = orderedFormLabels(baseline.labels, target.labels);
  var onlyInBaseline = [];
  var onlyInTarget = [];
  var rowCountMismatches = [];
  var forms = [];
  var matched = [];
  var changed = 0;
  var compared = 0;
  var lines = [];

  function sideRecord(source) {
    return {
      artifact: source.path,
      appRoot: typeof source.artifact.appRoot === 'string'
        ? source.artifact.appRoot
        : null,
      head: source.artifact.head === undefined ? null : source.artifact.head,
      expectedDataRows: source.artifact.expectedDataRows === undefined
        ? null
        : source.artifact.expectedDataRows
    };
  }

  function checkRowCount(side, label, capture) {
    if (!capture) { return; }

    if (capture.dataRows !== EXPECTED.cliTableDataRows) {
      rowCountMismatches.push(side + ' ' + label + ': ' +
        JSON.stringify(capture.dataRows) + ' data row(s), verified baseline is ' +
        EXPECTED.cliTableDataRows);
    }
  }

  labels.forEach(function (label) {
    var a = Object.prototype.hasOwnProperty.call(baseline.index, label)
      ? baseline.index[label]
      : null;
    var b = Object.prototype.hasOwnProperty.call(target.index, label)
      ? target.index[label]
      : null;
    var differingFields = [];

    checkRowCount('baseline', label, a);
    checkRowCount('target', label, b);

    if (!a) { onlyInTarget.push(label); }
    if (!b) { onlyInBaseline.push(label); }

    if (!a || !b) {
      forms.push({
        label: label,
        presentInBaseline: !!a,
        presentInTarget: !!b,
        equal: false,
        differingFields: []
      });
      return;
    }

    compared += 1;

    CLI_COMPARED_FIELDS.forEach(function (field) {
      var left  = a[field];
      var right = b[field];
      var row;

      if (canonical(left) === canonical(right)) {
        return;
      }

      row = { field: field };

      if (typeof left === 'string' && typeof right === 'string' &&
          (left.length > CLI_VALUE_ABBREVIATE_OVER ||
           right.length > CLI_VALUE_ABBREVIATE_OVER)) {
        row.baselineLength = left.length;
        row.targetLength   = right.length;
        row.firstDifference = firstTextDifference(left, right);
      }
      else {
        row.baseline = left === undefined ? null : left;
        row.target   = right === undefined ? null : right;
        if (typeof left === 'string' && typeof right === 'string') {
          row.firstDifference = firstTextDifference(left, right);
        }
      }

      differingFields.push(row);
    });

    if (differingFields.length) {
      changed += 1;
    }
    else {
      matched.push(label + ': ' + a.bytes + ' bytes, ' + a.dataRows +
        ' data row(s)');
    }

    forms.push({
      label: label,
      presentInBaseline: true,
      presentInTarget: true,
      equal: differingFields.length === 0,
      differingFields: differingFields
    });
  });

  lines.push('ROUTE-TABLE CLI CROSS-TREE COMPARISON');
  lines.push('  baseline artifact  : ' + baseline.path);
  lines.push('  baseline tree      : ' + sideRecord(baseline).appRoot +
    ' at HEAD ' + sideRecord(baseline).head);
  lines.push('  target artifact    : ' + target.path);
  lines.push('  target tree        : ' + sideRecord(target).appRoot +
    ' at HEAD ' + sideRecord(target).head);
  lines.push('  joined on          : invocation form label');
  lines.push('  fields compared    : ' + CLI_COMPARED_FIELDS.join(', ') +
    ' (table and stdout byte for byte)');
  lines.push('  expected data rows : ' + EXPECTED.cliTableDataRows +
    ' (verified baseline)');
  lines.push('');

  lines.push('FORMS ONLY IN BASELINE (' + onlyInBaseline.length + ')');
  if (onlyInBaseline.length === 0) { lines.push('  none'); }
  else { onlyInBaseline.forEach(function (label) { lines.push('  - ' + label); }); }
  lines.push('');

  lines.push('FORMS ONLY IN TARGET (' + onlyInTarget.length + ')');
  if (onlyInTarget.length === 0) { lines.push('  none'); }
  else { onlyInTarget.forEach(function (label) { lines.push('  + ' + label); }); }
  lines.push('');

  lines.push('FORMS WITH DIFFERING FIELDS (' + changed + ')');
  if (changed === 0) { lines.push('  none'); }
  else {
    forms.forEach(function (form) {
      if (!form.differingFields.length) { return; }

      lines.push('  ' + form.label);
      form.differingFields.forEach(function (row) {
        lines.push('    ' + row.field);
        if (row.baselineLength !== undefined) {
          lines.push('      baseline: ' + row.baselineLength + ' character(s)');
          lines.push('      target  : ' + row.targetLength + ' character(s)');
        }
        else {
          lines.push('      baseline: ' + abbreviate(row.baseline));
          lines.push('      target  : ' + abbreviate(row.target));
        }
        if (row.firstDifference) {
          lines.push('      first difference at line ' +
            row.firstDifference.line + ', column ' +
            row.firstDifference.column);
          lines.push('        baseline: ' +
            abbreviate(row.firstDifference.baselineLine));
          lines.push('        target  : ' +
            abbreviate(row.firstDifference.targetLine));
        }
      });
    });
  }
  lines.push('');

  lines.push('DATA-ROW COUNTS AGAINST THE VERIFIED BASELINE (' +
    rowCountMismatches.length + ' differing)');
  if (rowCountMismatches.length === 0) {
    lines.push('  none - every captured form has ' + EXPECTED.cliTableDataRows +
      ' data row(s) on both trees');
  }
  else {
    rowCountMismatches.forEach(function (row) { lines.push('  - ' + row); });
  }
  lines.push('');

  lines.push('FORMS IDENTICAL ACROSS BOTH TREES (' + matched.length + ')');
  if (matched.length === 0) { lines.push('  none'); }
  else { matched.forEach(function (row) { lines.push('  ' + row); }); }
  lines.push('');

  return {
    lines: lines,
    differences: onlyInBaseline.length + onlyInTarget.length + changed +
      rowCountMismatches.length,
    forms: forms,
    onlyInBaseline: onlyInBaseline,
    onlyInTarget: onlyInTarget,
    changed: changed,
    compared: compared,
    rowCountMismatches: rowCountMismatches,
    baselineSide: sideRecord(baseline),
    targetSide: sideRecord(target)
  };
}

/**
 * The --compare-cli mode.
 *
 * Structured to read like `--compare`, because the two are the same kind of
 * thing: a join, a per-item field comparison, a human report on stderr, an
 * optional artifact at --out, and a non-zero exit on any difference. What
 * differs is only the item - an invocation form rather than a route - and that
 * this one additionally judges each side against the verified baseline row
 * count, since two artifacts can agree with each other and both be wrong.
 *
 * The result written to --out is JSON rather than the human report, so a caller
 * can consume the verdict without parsing prose. The report still goes to
 * stderr in full, and stdout stays empty.
 *
 * @param {Object} options The parsed command line.
 * @returns {number} EXIT_OK when every form matches across both trees and every
 *   count is the verified baseline, EXIT_DIFFERENCE otherwise.
 * @throws {ToolError}
 */
function runCompareCli(options) {
  var baseline = readCliTableArtifact(options.compareCli[0], 'baseline');
  var target   = readCliTableArtifact(options.compareCli[1], 'target');
  var result   = compareCliTables(baseline, target);
  var verdict  = result.differences === 0
    ? 'PASS - all ' + result.compared + ' invocation form(s) are byte-identical ' +
      'across both trees at ' + EXPECTED.cliTableDataRows + ' data row(s)'
    : 'FAIL - ' + result.differences + ' difference(s): ' +
      result.onlyInBaseline.length + ' form(s) only in baseline, ' +
      result.onlyInTarget.length + ' only in target, ' + result.changed +
      ' with differing fields, ' + result.rowCountMismatches.length +
      ' data-row count(s) away from the verified baseline';
  var report = result.lines.concat([verdict, '']).join('\n');

  process.stderr.write(report);

  if (options.out) {
    writeArtifact(options.out, serialize({
      schema: 1,
      artifact: path.basename(options.out),
      gate: 'route-table CLI cross-tree byte comparison',
      note: 'SUPPORTING CHECK, not the primary gate. The route-table CLI ' +
        'parses config/routes.js only, so the 116 API routes and the 5 ' +
        'synthesized routes are absent and the columns carry no auth. The ' +
        'primary gate is the route manifest compared per entry. This result ' +
        'covers the cross-tree half of the CLI check: the three invocation ' +
        'forms compared BETWEEN the two trees, which is what a drift shared ' +
        'by all three forms escapes within one tree.',
      // `pass` and `exitCode` first among the outcome fields, and spelled the
      // same way the manifest comparison spells them, so one reader can consume
      // either gate's result without learning two vocabularies. `verdict` keeps
      // its PASS/FAIL string for a human skimming the file.
      pass: result.differences === 0,
      exitCode: result.differences === 0 ? EXIT_OK : EXIT_DIFFERENCE,
      compared: result.compared,
      inputs: {
        baseline: {
          path: artifactPathLabel(options.compareCli[0]),
          artifact: path.basename(options.compareCli[0]),
          digest: digestOfFile(options.compareCli[0])
        },
        target: {
          path: artifactPathLabel(options.compareCli[1]),
          artifact: path.basename(options.compareCli[1]),
          digest: digestOfFile(options.compareCli[1])
        }
      },
      baseline: result.baselineSide,
      target: result.targetSide,
      fieldsCompared: CLI_COMPARED_FIELDS,
      expectedDataRows: EXPECTED.cliTableDataRows,
      forms: result.forms,
      onlyInBaseline: result.onlyInBaseline,
      onlyInTarget: result.onlyInTarget,
      rowCountMismatches: result.rowCountMismatches,
      differences: result.differences,
      changed: result.changed,
      verdict: result.differences === 0 ? 'PASS' : 'FAIL',
      report: report
    }));
    note('  result ' + options.out);
  }

  return result.differences === 0 ? EXIT_OK : EXIT_DIFFERENCE;
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

    case 'compare-cli':
      return runCompareCli(options);

    case 'verify':
      return runVerify(options);

    case 'verify-provenance':
      return runVerifyProvenance(options);

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
/**
 * JSON.parse that yields null instead of throwing.
 *
 * @param {*} text
 * @returns {(Object|null)}
 */
function safeParseJson(text) {
  try {
    return JSON.parse(String(text));
  }
  catch (err) {
    return null;
  }
}

/**
 * A file's contents, or null when it is not there.
 *
 * Absence is an answer here rather than an error: a sidecar is a run output,
 * so most artifacts have none, and the checks that need one are skipped
 * without it. What is NOT permitted is a sidecar that exists and disagrees.
 *
 * @param {string} file
 * @returns {(string|null)}
 */
/**
 * The `--verify-provenance` mode: does this whole set of evidence describe ONE
 * target state, and does every claim in it resolve in THIS repository?
 *
 * This is the check whose absence let the delivery accumulate artifacts naming
 * four different origins - three absolute worktree paths from three sibling
 * clones and three generator revisions, two of which are not objects here at
 * all. Each artifact was internally plausible; nothing joined them.
 *
 * It reads each path, extracts its provenance however that artifact carries it
 * - embedded in JSON, a JSON sidecar, or the machine-readable comment in a
 * generated Markdown document - and then checks three things per artifact and
 * one thing across them:
 *
 *   per artifact  the recorded generator blob is an object in this repository;
 *                 the recorded generator commit, if any, is an object here and
 *                 holds that blob at that path; the artifact hashes to its own
 *                 payload digest.
 *   across all    every artifact was produced at the same delivered head, so
 *                 the set describes one tree and not several.
 *
 * A baseline artifact legitimately records a DIFFERENT analysed tree from a
 * target artifact - that is the point of a baseline - so the analysed head is
 * reported per artifact and only the DELIVERED head is required to agree.
 *
 * @param {Object} options
 * @returns {number} An exit code.
 * @throws {ToolError} If an artifact cannot be read.
 */
function runVerifyProvenance(options) {
  var rows       = [];
  var heads      = {};
  var failures   = 0;
  var report;
  var setFailures = 0;
  var recorded;
  var offHistory;
  var stale;

  options.verify.forEach(function (target) {
    var text;
    var documentText;
    var sidecar;
    var block;
    var payload;
    var parsed;
    var verdict;

    try {
      text = fs.readFileSync(target, 'utf8');
    }
    catch (err) {
      throw new ToolError('cannot read ' + target + ': ' + err.message);
    }

    block = provenance.extract(text);

    // The payload digest is only recomputable for a JSON artifact carrying an
    // embedded block: for a Markdown document the payload is the prose, and for
    // a sidecar the artifact is a different file.
    parsed = safeParseJson(text);
    if (parsed && parsed.provenance) {
      payload = {};
      Object.keys(parsed).forEach(function (key) {
        if (key !== 'provenance') {
          payload[key] = parsed[key];
        }
      });
    }

    // A Markdown document is bound to its provenance by the body digest, a
    // JSON artifact by the payload digest, and either may also have a sidecar
    // beside it whose own digest covers the exact bytes. All three are fed in
    // here, because a check the verifier does not supply an input for is a
    // check that silently does not run - which is how a tampered document body
    // and a zeroed sidecar digest both verified clean.
    if (!parsed) {
      documentText = text;
    }

    sidecar = safeParseJson(readIfPresent(target + '.provenance.json'));

    verdict = provenance.validate(block, {
      repositoryRoot          : TOOL_ROOT,
      requireGeneratorVerified: !options.allowUnverified,
      allowUncommitted        : options.allowUnverified,
      payload                 : payload,
      documentText            : documentText,
      sidecar                 : sidecar === null ? undefined : sidecar,
      artifactText            : sidecar === null ? undefined : text
    });

    if (block && block.delivered && block.delivered.head) {
      heads[block.delivered.head] = (heads[block.delivered.head] || 0) + 1;
    }

    rows.push({
      artifact    : path.relative(TOOL_ROOT, target).split(path.sep).join('/'),
      role        : block ? block.role : null,
      generator   : block && block.generator ? block.generator.path : null,
      generatorBlob: block && block.generator ? block.generator.blob : null,
      generatorCommit: block && block.generator ? block.generator.commit : null,
      analysedHead: block && block.analysedTree ? block.analysedTree.head : null,
      deliveredHead: block && block.delivered ? block.delivered.head : null,
      payloadChecked: payload !== undefined,
      // Which digests actually covered this artifact's content, from the
      // checks that ran rather than from the artifact's shape.
      bindings    : verdict.checks.filter(function (entry) {
        return ['payload-digest', 'body-digest', 'sidecar-artifact-digest']
          .indexOf(entry.name) !== -1 && entry.ok;
      }).map(function (entry) {
        return entry.name;
      }),
      ok          : verdict.ok,
      failures    : verdict.failures,
      // A waived check is not a passed check, and the difference is the whole
      // value of the mode: it is reported so a reader sees what was not
      // established rather than reading a clean verdict as a complete one.
      waived      : verdict.checks.filter(function (entry) {
        return entry.waived;
      }).map(function (entry) {
        return entry.name + ': ' + entry.detail;
      }),
      // Carried separately from the failure list because it changes what the
      // SET means, not just what this artifact means: a stale generator is why
      // a recorded head can be on the delivered history and still not describe
      // the delivered tree.
      staleGenerator: verdict.checks.some(function (entry) {
        return entry.name === 'generator-current' && !entry.ok && !entry.waived;
      })
    });

    if (!verdict.ok) {
      failures += 1;
    }
  });

  report = ['PROVENANCE CHAIN', '================', ''];

  rows.forEach(function (row) {
    report.push((row.ok ? 'OK   ' : 'FAIL ') + row.artifact);
    report.push('       role          ' + (row.role || '(none recorded)'));
    report.push('       generator     ' + (row.generator || '(none recorded)') +
      (row.generatorBlob ? ' blob ' + row.generatorBlob.slice(0, 12) : '') +
      (row.generatorCommit ? ' in ' + row.generatorCommit.slice(0, 7) : ''));
    report.push('       analysed tree ' + (row.analysedHead
      ? row.analysedHead.slice(0, 7) +
        (provenance.isBaselineHead(row.analysedHead) ? ' (the base commit)' : '')
      : '(none - derived without reading a tree)'));
    report.push('       delivered at  ' + (row.deliveredHead
      ? row.deliveredHead.slice(0, 7) : '(none recorded)'));
    // Named per binding rather than as one "payload" line, because the three
    // artifact shapes are bound by three different digests and a reader of
    // this transcript has to be able to tell which one actually ran. The line
    // said "not applicable to this artifact shape" for a Markdown document
    // even after bodyDigest bound it, which read as an unchecked artifact.
    report.push('       content bound ' + (row.bindings.length
      ? row.bindings.join(', ') + ' recomputed'
      : 'NOTHING - no digest covers this artifact'));
    row.failures.forEach(function (failure) {
      report.push('       - ' + failure);
    });
    row.waived.forEach(function (entry) {
      report.push('       ~ WAIVED ' + entry);
    });
    report.push('');
  });

  // "One target state" over a real delivery cannot mean "one recorded string".
  // A committed artifact records the head its generator was READ AT, which is
  // necessarily before the commit that introduces the artifact, so a set built
  // over several commits records several heads and is still one target state.
  // What actually has to hold is that every recorded head is on the delivered
  // history, and that every generator is still the blob that produced its
  // artifact - the second is the per-artifact `generator-current` check above,
  // and without it a set of ancestors would prove nothing.
  recorded = Object.keys(heads).sort();
  offHistory = recorded.filter(function (head) {
    return !gitIsAncestor(TOOL_ROOT, head, 'HEAD');
  });
  stale = rows.filter(function (row) {
    return row.staleGenerator;
  });

  if (recorded.length <= 1 && !offHistory.length && !stale.length) {
    report.push('One target state: YES - every artifact was produced at ' +
      (recorded[0] || 'no recorded head').slice(0, 7));
  }
  else if (!offHistory.length && !stale.length) {
    report.push('One target state: YES - ' + rows.length + ' artifact(s) ' +
      'written at ' + recorded.length + ' commit(s), every one on the ' +
      'delivered history, and every generator still the blob that ran: ' +
      recorded.map(function (head) {
        return head.slice(0, 7) + ' (' + heads[head] + ')';
      }).join(', '));
  }
  else {
    report.push('One target state: NO');
    offHistory.forEach(function (head) {
      report.push('       - ' + head.slice(0, 7) + ' is not on the history of ' +
        'HEAD, so it names a tree this repository cannot produce');
      setFailures += 1;
    });
    stale.forEach(function (row) {
      report.push('       - ' + row.artifact + ' names a generator that is no ' +
        'longer the delivered one, so its recorded head no longer describes ' +
        'the delivered tree');
    });
  }

  // Counted apart from the set-level findings, because an artifact is verified
  // or not on its own terms: folding a bad head in the set into this figure
  // once made it read as a negative count.
  report.push('Artifacts verified: ' + (rows.length - failures) + ' of ' + rows.length);

  report.push('VERDICT: ' + ((failures + setFailures) ? 'FAIL' : 'PASS'));

  note(report.join('\n'));

  if (options.out) {
    writeArtifact(options.out, serialize({
      schema  : 1,
      artifacts: rows,
      deliveredHeads: Object.keys(heads).sort(),
      verdict : (failures + setFailures) ? 'FAIL' : 'PASS'
    }));
    note('wrote ' + options.out);
  }

  return (failures + setFailures) ? EXIT_DIFFERENCE : EXIT_OK;
}

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
  // THE PROVENANCE CONTRACT, shared by every tool in test/parity/ and by the
  // two generated inventories in docs/. Exported from here because this is the
  // only tool that is Node-core-only at module scope, so requiring it costs a
  // sibling nothing, and because a second copy of these guarantees would drift
  // from the first.
  provenance       : provenance,
  runVerifyProvenance: runVerifyProvenance,
  // Generation.
  generateManifest : generateManifest,
  buildProvenance  : buildProvenance,
  buildSummary     : buildSummary,

  // Comparison - the gate.
  compareManifests : compareManifests,
  readManifest     : readManifest,

  // Freshness of a committed artifact, which a HEAD comparison cannot decide.
  runVerify        : runVerify,

  // Provenance integrity. `readManifestForApp` is the call a consumer of the
  // SHARED default artifact wants in place of `readManifest`: it refuses a
  // manifest that describes another tree, which is the only thing standing
  // between a leftover baseline manifest and a target replay that judges the
  // target by the baseline's HTTP surface.
  verifyManifestProvenance: verifyManifestProvenance,
  verifyManifestIntegrity : verifyManifestIntegrity,
  verifyTreeBinding       : verifyTreeBinding,
  readManifestForApp      : readManifestForApp,
  digestOf                : digestOf,
  digestOfFile            : digestOfFile,
  measureManifestSources  : measureManifestSources,
  MANIFEST_SOURCE_FILES   : MANIFEST_SOURCE_FILES,
  artifactPathLabel       : artifactPathLabel,

  // The route-table CLI capture, and its cross-tree comparison - the half a
  // within-tree byte comparison structurally cannot make, because all three
  // invocation forms drift together.
  captureCliTable  : captureCliTable,
  splitCliTable    : splitCliTable,
  readCliTableArtifact: readCliTableArtifact,
  assertCliTableContract: assertCliTableContract,
  compareCliTables : compareCliTables,
  firstTextDifference: firstTextDifference,

  // Building blocks, exported because each one has a failure mode worth
  // testing directly.
  parseArguments   : parseArguments,
  assertUncontaminatedProcess : assertUncontaminatedProcess,
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

  // The delivered artifact paths and the sidecar suffix, exported so that a
  // consumer names the artifact contract rather than re-spelling the literal:
  // a second copy of a path is how a consumer ends up reading one file while
  // the generator writes another.
  COMMITTED_MANIFEST    : COMMITTED_MANIFEST,
  PROVENANCE_SUFFIX     : PROVENANCE_SUFFIX,

  // Reference values, so a harness asserts against the same numbers the tool
  // reports rather than a second copy of them.
  EXPECTED         : EXPECTED,
  EXPECTED_FALLBACK_ROUTES: EXPECTED_FALLBACK_ROUTES,
  EXPECTED_UNRESOLVED_PRE_ENTRIES: EXPECTED_UNRESOLVED_PRE_ENTRIES,
  FALLBACK_DEFAULT_AUTH: FALLBACK_DEFAULT_AUTH,
  buildPreHandlerIdentity: buildPreHandlerIdentity,
  ENTRY_KEY_ORDER  : ENTRY_KEY_ORDER,

  // The artifact-destination policy, exported so a caller resolves the same
  // path this tool would rather than rebuilding it.
  ARTIFACT_DIR_ENV : ARTIFACT_DIR_ENV,
  ARTIFACT_NAMES   : ARTIFACT_NAMES,
  resolveArtifactPath: resolveArtifactPath,
  writeArtifact    : writeArtifact,
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
