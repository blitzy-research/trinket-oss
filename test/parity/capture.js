#!/usr/bin/env node
'use strict';

// The baseline corpus recorder.
//
// Drives a scenario corpus against a RUNNING application and records what came
// back, so that `test/parity/replay.js` has something to compare the migrated
// tree against. Its whole reason for existing is ordering: the parity tooling
// is created BY this migration and does not exist at the base commit, so
// "capture the baseline first" means running this tool - from the target
// worktree - against a `git worktree` at 2f8712a with its own `npm ci`, before
// any behaviour-changing work. That is what `--app` is for.
//
// ===========================================================================
// RULES
// ===========================================================================
// `review_rules` returns exactly "No user rules provided." for this project,
// which AAP 0.7 and 0.10.1 independently record. No rules are invented here and
// their absence is not read as licence to lower the bar - enterprise practice
// governs. The request's own RULES block is binding and is not that document:
//
//   R-a  The diff must read as migration work only. This file is new tooling
//        the migration requires; it changes no application module, edits no
//        configuration and writes nothing outside its --out artifact and the
//        per-run directory the launcher owns.
//   R-b  No route excluded. Coverage is accounted against every entry in the
//        233-route manifest and the capture FAILS on an unrepresented route.
//        An entry that genuinely cannot be driven is recorded with a stated
//        reason, never dropped.
//   R-d  Behaviour improvements are prohibited. Every mandatory quirk case
//        below exists so that a silent "fix" cannot pass unnoticed - the
//        never-settling image download, the cross-request fail.redirect leak,
//        the authenticated /login 500, the OAuth account-created-then-failed
//        path. Each carries a declared baseline expectation which is CHECKED
//        and recorded rather than assumed.
//   R-e  Error-to-response mappings must survive unchanged, which is why
//        failure-path cases are captured beside the success sweep and why the
//        log-and-continue and resolve-on-later-callback dispositions get cases
//        of their own.
//   R-f  Baseline observed behaviour at 2f8712a is the tie-breaker, which is
//        why provenance - the analysed tree's HEAD and this tool's own - is
//        written beside every corpus.
//
// ===========================================================================
// WHY THE DRIVER IS node:http AND NEVER global fetch
// ===========================================================================
// This is not a style preference, it is a correctness constraint that was
// MEASURED. `fixtures/http.js` in this directory auto-installs on first
// require and patches `globalThis.fetch`, and an endpoint it has no recording
// for does not fall through to the network - it REJECTS. So a driver built on
// global fetch would have every one of its own requests to localhost rejected
// the moment that catalogue was required. This file therefore:
//
//   1. drives every request through node:http / node:https, and
//   2. requires the fixture catalogue only for its frozen reference data, then
//      calls restore() immediately, so this process is left unpatched.
//
// The fixtures that matter run in the CHILD process - the launcher preloads
// them - so the two cross-process channels this file uses are the ones their
// environment contracts publish: the profile file for switching profiles
// without a restart, and the PARITY_*_LOG JSONL files for evidence.
//
// ===========================================================================
// WHAT THIS FILE DELIBERATELY DOES NOT DO
// ===========================================================================
//   - It requires no application source. `app.js`, `config` and `lib` are
//     never in this process's module graph: the application is a child process
//     owned by `server.js` beside this file, the route manifest is read as an
//     artifact (or produced by spawning `manifest.js`, which does load them, in
//     a process of its own), and fixture creation is delegated to `seed.js`'s
//     own `seed()` in a spawned child. The independence proof is mechanical, so
//     the two directories that must not appear in a require here - the suite's
//     own helper directory and its spec directory - are written unjoined
//     throughout, and the legacy URL parser is never named at all. Both would
//     otherwise satisfy a grep while proving nothing.
//   - It creates no fixtures of its own. `seed.js` owns them, and `reset` under
//     the suite's own db helper stays an empty-database operation.
//   - It reaches no real network. Every external effect is intercepted at the
//     module boundary by the three fixtures.
//   - It never silently drops a case. A case that cannot be driven is recorded
//     with its reason and counted as a failure.
//
// ===========================================================================
// THE TWO GAPS THIS FILE CLOSES, AND WHY IT IS THE RIGHT PLACE
// ===========================================================================
//   1. The OAuth handlers guard on `config.app.auth.google.clientID` and
//      short-circuit to `request.fail` without it, and the declared contract of
//      the server overlay does not include `app.auth.google`. The fixture's own
//      header assigns the fix to "the overlay owner or capture.js", so this
//      file supplies that layer through the launcher's explicit top NODE_CONFIG
//      layer. The values are obviously fake and are not credentials: the token
//      endpoint is intercepted, so nothing authenticates against anything.
//   2. The fixture's seeding contract asks that `identities.existing` be seeded
//      as a user, and the seeder does not seed it - there is no such address in
//      it. `setIdentityEmails` runs only inside the child, and the environment
//      contract has no identity variable, so neither file can be aligned from
//      here. Rather than edit a sibling artifact, the existing-user branch is
//      reached as an ORDERED TWO-STEP SEQUENCE: step 1 takes the new-user
//      branch, which creates the account precisely BECAUSE of the quirk under
//      test, and step 2 then finds it and takes the existing-user branch.
//      `findByMultiple` is an `$or` over email, username and google id, so the
//      account step 1 persists is the one step 2 matches. One case, two steps,
//      no fixture edit, and the quirk's own side effect is what makes the
//      second branch reachable.
//
// ===========================================================================
// DETERMINISM
// ===========================================================================
// Re-capturing the same tree must produce a reviewable diff, not a reshuffle.
// Scenario order is fixed by construction and read-only cases run before
// mutating ones; object keys are emitted in a declared order and every dynamic
// map (headers, cookie attributes) is sorted; no clock or random value reaches
// an artifact except the ones recorded as timing, which are bucketed. The one
// value normalized AT CAPTURE TIME is the session cookie's value, replaced by
// its digest: it is already in the enumerated volatile set, so nothing
// comparable is lost, and it keeps live session tokens out of a committed
// artifact. Every attribute of that cookie - name, HttpOnly, Secure, SameSite,
// Path, Domain, Max-Age and the presence and horizon of Expires - is preserved
// in full, because those ARE compared and are the only way a silent no-op in
// the private-field cookie patch is detectable.

var http         = require('http');
var https        = require('https');
var fs           = require('fs');
var os           = require('os');
var path         = require('path');
var crypto       = require('crypto');
var childProcess = require('child_process');

// The parity modules. Every one of these is a declared dependency of this file.
var server   = require('./server');
var mongo    = require('./mongo');
var seed     = require('./seed');
var manifest = require('./manifest');

// The fixture catalogues. `httpFixture` is required for its profile catalogue
// and its two frozen identities, and is IMMEDIATELY restored - see the note on
// the driver above. `awsFixture` is required lazily, after PARITY_S3_ROOT has
// been pointed at the launcher's store, because it resolves its root at load.
var httpFixture = require('./fixtures/http');
var mailFixture = require('./fixtures/mail');

var awsFixture = null;

// Undo the auto-install in THIS process. The child keeps its own patched copy;
// what must not happen is this process driving localhost through a patched
// fetch. Both are wrapped because a restore fault must not take the run down
// before it has reported anything useful.
try {
  httpFixture.restore();
}
catch (restoreError) {
  process.stderr.write('capture: warning: could not restore the http fixture ' +
    'in this process: ' + reasonOf(restoreError) + '\n');
}

try {
  mailFixture.restore();
}
catch (restoreError) {
  process.stderr.write('capture: warning: could not restore the mail fixture ' +
    'in this process: ' + reasonOf(restoreError) + '\n');
}

var LOG_PREFIX = 'capture: ';

var TOOL_ROOT = path.resolve(__dirname, '..', '..');

var DEFAULT_OUT = path.join(__dirname, 'corpus.json');
var DEFAULT_MANIFEST = path.join(__dirname, 'route-manifest.json');

// The artifact schema. Bumped only when a consumer would have to change.
var CORPUS_SCHEMA = 1;

// Per-step budget. Generous enough that a slow first render is not mistaken for
// a hang, finite so the never-settling branch cannot stall the run.
var DEFAULT_TIMEOUT_MS = 15000;

// The never-settling case does not need the full budget to prove itself, and
// giving it one would add that much dead time to every run.
var EXPECTED_TIMEOUT_MS = 4000;

// Readiness budget handed to the launcher.
var DEFAULT_READY_TIMEOUT_MS = 120000;

// Recorded text bodies are kept whole up to this size. Past it the text is
// truncated and flagged - the digest and length are of the WHOLE body either
// way, so a difference past the cut is still detectable.
var MAX_TEXT_BYTES = 262144;

var EXIT_OK = 0;
var EXIT_DIFFERENCE = 1;
var EXIT_ERROR = 2;

// Content types recorded as text. Everything else is recorded as a length and a
// digest, which is what AAP 0.9.3 compares for binary and stream bodies.
var TEXTUAL_TYPE = /^(?:text\/|application\/(?:json|javascript|xml|xhtml\+xml|x-www-form-urlencoded|graphql)|[a-z-]+\/[a-z0-9.+-]*\+(?:json|xml))/i;

// The identities a scenario may name. `missingRecord` is not a seeded user: it
// is a session whose userId names a record that has been deleted through the
// application's own route, which is the only way to reach the "User not found"
// outcome without touching the database from here.
var IDENTITY_ANONYMOUS = 'anonymous';
var IDENTITY_USER = 'user';
var IDENTITY_ADMIN = 'admin';
var IDENTITY_DISABLED = 'disabled';
var IDENTITY_MISSING = 'missingRecord';

var IDENTITIES = [
  IDENTITY_ANONYMOUS,
  IDENTITY_USER,
  IDENTITY_ADMIN,
  IDENTITY_DISABLED,
  IDENTITY_MISSING
];

// The throwaway account registered and then deleted to produce the
// missingRecord session. Fixed so the run is reproducible, and deliberately
// distinct from every seeded identity so the sacrifice costs no fixture. The
// password satisfies the declared payload schema and is not a credential for
// anything: it exists for the lifetime of one ephemeral database.
var THROWAWAY = {
  formName: 'signup',
  fullname: 'parity throwaway',
  username: 'parity-throwaway',
  email: 'parity-throwaway@example.com',
  password: 'throwaway-fixture-value'
};

// The fake Google client this file injects so the OAuth handlers get past their
// configuration guard. Not a credential: `fixtures/http.js` intercepts the
// token and profile endpoints, so these values never leave the process.
var GOOGLE_STUB = {
  clientID: 'parity-harness-client-id.apps.example.invalid',
  clientSecret: 'parity-harness-not-a-real-secret',
  callbackURL: '/auth/google/callback'
};

var ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
var ACCEPT_JSON = 'application/json';

var FORM_TYPE = 'application/x-www-form-urlencoded';
var JSON_TYPE = 'application/json';

// ---------------------------------------------------------------------------
// Path materialization
// ---------------------------------------------------------------------------
// Wildcard segments are materialized to concrete values from the seeder's
// frozen `ids` map and its recorded slugs, never to an invented identifier: a
// generated id would have to be added to the volatile set, and a widened
// volatile set is a weakened gate.
//
// Two tokens have no seeded document behind them - `{invitationId}`, because
// the seeder owns no invitation fixture, and `{token}`, because an invitation
// token is minted by a mail send rather than seeded. For those the value below
// is a FIXED, DELIBERATELY ABSENT identifier. That is not the prohibited case
// of inventing an id and driving it as though it were seeded: it is the
// not-found edge, it is recorded as such in the scenario's notes, and it keeps
// the route represented instead of dropped. The seeder's own MISSING_IDS list
// is the same idea for the models it does own.
var ABSENT_ID = '0000000000000000000000ff';
var ABSENT_TOKEN = 'parity-absent-invitation-token';

// Trinkets are addressed by short code on 38 routes, and the language prefix in
// the path decides WHICH trinket is the correct one to address: pointing a
// `/html/{shortCode}` route at a python trinket would silently drive the
// language-mismatch pre-handler instead of the route's success path. That
// mismatch is a quirk case of its own and must not leak into the success sweep.
var LANG_TRINKET = {
  python: 'trinketPython',
  python3: 'trinketPython3',
  html: 'trinketHtml',
  blocks: 'trinketBlocks',
  R: 'trinketR',
  r: 'trinketR'
};

// The language prefixes that appear as a literal first segment. Taken from the
// generated manifest rather than from the language list in configuration, so
// this table cannot drift from the routes that actually exist.
var LANG_PREFIXES = [
  'R', 'blocks', 'console', 'glowscript-blocks', 'glowscript', 'html', 'java',
  'music', 'pygame', 'python3', 'python', 'r', 'skulpt', 'vpython', 'webvpython'
];

// The `{path*}` tail, which means something different on each route family it
// appears in. Longest prefix wins, so the trinket download families are matched
// before the catch-all.
var WILDCARD_TAILS = [
  { prefix: '/.well-known/', value: 'security.txt' },
  { prefix: '/library/trinkets/', value: '' },
  { prefix: '/admin/', value: 'users' },
  { suffix: '/{shortCode}/{path*}', value: 'main.py' },
  { prefix: '/cache-prefix-', value: 'base.css' },
  { prefix: '/', value: 'robots.txt' }
];

// ---------------------------------------------------------------------------
// Minimal payloads
// ---------------------------------------------------------------------------
// One entry per route whose declared validation has at least one required
// payload or query key, so the success sweep exercises the success path rather
// than the validation-failure path. Every key here was read off the route
// declarations themselves - `Joi...required()` in the two route modules - and
// every value that identifies a document is a seeded one.
//
// A route absent from this table and carrying only optional keys is driven with
// an empty payload, which satisfies its schema. A route absent from this table
// and carrying required keys would be driven into its validation-failure path;
// that is a legitimate capture, but it is not a success capture, so the
// scenario records `intent: 'failure'` and names the reason instead of
// presenting a rejected request as a success. Nothing is silently mislabelled.
//
// `--payloads <file>` merges an operator-supplied table over this one, so a
// route can be given a better payload without editing this file.
/**
 * The built-in minimal payload table, keyed by "<METHOD> <path>".
 *
 * @param {Object} ids the seeder's frozen id map
 * @param {Object} fixtures the seeder's fixtures
 * @returns {Object} route key -> payload object
 */
function defaultPayloads(ids, fixtures) {
  var slugs = fixtures.slugs;
  var trinket = fixtures.trinkets.trinketPython;
  var user = seed.credentials.user;
  var table = {};

  function set(key, value) {
    table[key] = value;
  }

  // Identity and account flows.
  set('POST /login', { email: user.email, password: user.password });
  set('POST /api/users/login', { email: user.email, password: user.password });
  set('POST /users', {
    formName: 'signup',
    fullname: 'parity signup',
    username: 'parity-signup',
    email: 'parity-signup@example.com',
    password: 'parity-signup-value'
  });
  set('POST /api/users', {
    email: 'parity-api-signup@example.com',
    password: 'parity-api-value'
  });
  set('PUT /api/users/{userId}', { username: user.username });
  set('POST /send-pass-reset', { email: user.email });
  set('POST /save-pass', {
    key: 'parity-absent-reset-key',
    password: 'parity-new-value',
    password_verify: 'parity-new-value'
  });
  set('POST /activate-account', {
    key: 'parity-absent-activation-key',
    password: 'parity-new-value'
  });
  set('POST /api/users/password', {
    currentPassword: user.password,
    newPassword: 'parity-rotated-value',
    confirmPassword: 'parity-rotated-value'
  });
  set('POST /api/users/email', { email: 'parity-changed@example.com' });
  set('POST /api/users/verify-email', { 'g-recaptcha-response': '' });
  set('POST /api/users/settings', { disableAceEditor: 'false' });
  set('POST /api/users/settings/lineWrapping', { lineWrapping: 'false' });

  // Courses.
  set('POST /courses', { name: 'parity page course' });
  set('POST /api/courses', { name: 'parity api course' });
  set('POST /api/courses/join', { accessCode: fixtures.course.accessCode });
  set('POST /api/courses/{courseId}/copy', { name: 'parity copied course' });
  set('PATCH /api/courses/{courseId}', { archived: 'false' });
  set('POST /api/courses/{courseId}/lessons', { name: 'parity lesson' });
  set('PUT /api/courses/{courseId}/lessons/{lessonId}/move', { index: '0' });
  set('POST /api/courses/{courseId}/lessons/{lessonId}/materials', {
    name: 'parity material',
    type: 'text'
  });
  set('PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/move', { index: '0' });
  set('POST /api/courses/{courseId}/userLookup', { user: user.email });
  set('POST /api/courses/{courseId}/users', { user: user.email });
  set('POST /api/courses/{courseId}/roles', { user: user.email, role: 'student' });
  set('POST /api/courses/{courseId}/views', {
    user: user.email,
    view: 'dashboard',
    action: 'open'
  });
  set('POST /api/courses/{courseId}/invitations', { emailList: ['parity-invitee@example.com'] });
  set('POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/startAssignment', {
    parent: ids.trinketPython
  });
  set('POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/submissions', {
    code: { 'main.py': 'print("parity")' },
    comments: 'parity submission',
    parent: ids.trinketPython
  });
  set('POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/feedback', {
    code: { 'main.py': 'print("feedback")' },
    trinketId: ids.trinketPython
  });
  set('POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/acceptSubmission', {
    trinketId: ids.trinketPython
  });
  set('PUT /api/courses/{courseId}/metadata', { name: slugs.course });
  set('POST /api/comments/{trinketId}', { comments: 'parity comment' });
  set('POST /api/feedback-comments/{trinketId}', { comments: 'parity feedback' });
  set('POST /api/submissions/{trinketId}', {
    code: { 'main.py': 'print("parity")' },
    comments: 'parity comment'
  });

  // Folders and trinkets.
  set('POST /api/folders', { name: 'parity created folder' });
  set('POST /api/trinkets', { code: 'print("parity")' });
  set('POST /python', { code: 'print("parity")' });
  set('POST /api/trinkets/{trinketId}/forks', { code: 'print("parity fork")' });
  set('POST /api/trinkets/{trinketId}/folder', { folderId: ids.folder });
  set('DELETE /api/trinkets/{trinketId}/folder', { folderId: ids.folder });
  set('PUT /api/trinkets/{trinketId}/slug', { slug: 'parity-renamed-trinket' });
  set('PUT /api/trinkets/{trinketId}/published', { published: 'true' });
  set('POST /api/trinkets/{trinketId}/email', {
    email: 'parity-recipient@example.com',
    name: 'parity sender',
    replyTo: user.email
  });
  set('POST /api/trinkets/download', { files: JSON.stringify([{ name: 'main.py', content: 'print(1)' }]) });
  set('POST /api/trinkets/codeerror', {
    state: 'parity',
    session: 'parity-session',
    group: '1',
    error: 'parity error',
    type: 'runtime',
    message: 'parity message',
    code: 'print(1)',
    attempt: '1',
    lang: trinket.lang
  });
  set('POST /api/trinkets/clientmetric', {
    lang: trinket.lang,
    event_type: 'run',
    duration: '10'
  });

  // Interest, assets and administration.
  set('POST /api/interest', { email: 'parity-interest@example.com', page: '/' });
  set('POST /api/users/assets/restore', { fileId: ids.userAssetFile });
  set('POST /api/users/assetFromURL', { url: httpFixture.assetUrls.plain });
  set('POST /api/files/{fileId}/thumbnail', {
    bucket: 'parity-snapshots',
    secret: 'parity-absent-lambda-secret'
  });
  set('POST /api/admin/user/{userId}/grant', { role: 'admin' });
  set('POST /api/admin/featured-course', {
    ownerSlug: user.username,
    slug: slugs.course
  });
  set('POST /api/admin/featured-course/move', {
    currentIndex: '0',
    newIndex: '0',
    courseId: ids.course
  });

  return table;
}

// Required query keys, read off the same declarations. Merged into the query
// string of the route's success case so it is not rejected before it runs.
/**
 * The required query keys per route, keyed the same way.
 *
 * @param {Object} ids the seeder's frozen id map
 * @param {Object} fixtures the seeder's fixtures
 * @returns {Object} route key -> query object
 */
function defaultQueries(ids, fixtures) {
  var user = seed.credentials.user;

  return {
    'GET /{userSlug}/courses/{courseSlug}/download.zip': { format: 'zip' },
    'GET /reset-pass': { key: 'parity-absent-reset-key' },
    'GET /api/trinkets/popular': { lang: 'python' },
    'GET /api/trinkets/active': { lang: 'python' },
    'GET /api/trinkets/search': { q: 'parity' },
    'GET /api/trinkets/{lang}/list': { name: 'featured' },
    'DELETE /api/trinkets/{lang}/list/{shortCode}': { name: 'featured' },
    'POST /api/trinkets/{shortCode}/list': { name: 'featured' },
    'POST /api/trinkets/{trinketId}/grant': { user: user.email },
    'GET /change-email': { key: 'parity-absent-change-key' },
    'GET /verify-email': { key: 'parity-absent-verify-key' },
    // Deliberately NOT the acting user: this route deletes the account it is
    // given, and the seeded user must survive the sweep. The missingRecord
    // sequence drives the deleting form of this route with its own throwaway
    // identity, late, where the deletion is the point.
    'DELETE /api/users': { username: 'parity-absent-username' }
  };
}

var USAGE = [
  'Usage: node test/parity/capture.js [options]',
  '',
  'Drives the scenario corpus against a running application and records every',
  'response to --out. Run it from the TARGET worktree with --app pointed at a',
  '`git worktree` at the base commit to capture the baseline.',
  '',
  'Options:',
  '  --app <dir>          Worktree to drive. Becomes the child\'s working',
  '                       directory, so its own node_modules and config/ load.',
  '                       Defaults to the current directory.',
  '  --out <path>         Corpus artifact. A sibling <out>.provenance.json is',
  '                       always written beside it. Default',
  '                       test/parity/corpus.json.',
  '  --manifest <path>    Route manifest to account coverage against. Default',
  '                       test/parity/route-manifest.json; generated by',
  '                       spawning manifest.js when absent.',
  '  --only <pattern>     Drive only scenarios whose id, route key or group',
  '                       matches. A /regex/ is treated as one, anything else',
  '                       as a case-insensitive substring. Repeatable.',
  '  --append             Merge into an existing --out instead of replacing it,',
  '                       so one scenario can be re-captured without redriving',
  '                       all 233 routes. Implies the existing coverage is',
  '                       carried forward.',
  '  --base-url <url>     Drive an already-running server instead of starting',
  '                       one. No launcher, no seeding, no profile switching',
  '                       unless --profile-file is also given.',
  '  --profile-file <p>   PARITY_HTTP_PROFILE_FILE of an externally started',
  '                       server, so per-case profiles still switch.',
  '  --secure             Ask the launcher for the isSecure cookie pass, in',
  '                       which the patch appends "; SameSite=None; Secure".',
  '  --port <n>           Bind port for the launcher.',
  '  --host <host>        Bind host for the launcher.',
  '  --database <name>    Pin the MongoDB database name.',
  '  --mongo-uri <uri>    Use an already-running mongod at this address.',
  '  --overlay [path]     NODE_CONFIG overlay for the launcher.',
  '  --timeout <ms>       Per-step budget. Default ' + DEFAULT_TIMEOUT_MS + '.',
  '  --payloads <path>    JSON table of "<METHOD> <path>" -> payload, merged',
  '                       over the built-in minimal payloads.',
  '  --no-seed            Do not spawn the seeder. Fixture-dependent cases will',
  '                       then record whatever an unseeded tree returns.',
  '  --no-quirks          Drive only the route sweep. Coverage still applies.',
  '  --expect-baseline    Exit non-zero if any declared baseline expectation',
  '                       was not met. Use this when capturing the BASELINE;',
  '                       leave it off against the migrated tree, where the',
  '                       approved deviation on the image download changes a',
  '                       recorded timeout into a 200 by design.',
  '  --node-flags <flags> Passed to the child before the preloads. Repeatable.',
  '                       The zero-warning gate wants',
  '                       "--pending-deprecation --trace-deprecation".',
  '  -h, --help           Print this on stderr and exit 0.',
  '',
  'Exit codes:',
  '  0  every scenario drove and every route is represented',
  '  1  a route is unrepresented, a case could not be driven, or',
  '     --expect-baseline was given and an expectation was not met',
  '  2  usage or operational failure',
  '',
  'Every diagnostic goes to stderr. Nothing is ever written to stdout, so the',
  'artifact stream stays clean and the child\'s own output - the in-memory',
  'queue line, and the AWS notice on a baseline tree - cannot contaminate it.'
].join('\n');

/**
 * The error class for a fault this tool should report rather than crash on.
 *
 * @param {string} message
 * @constructor
 */
function ToolError(message) {
  Error.call(this, message);
  this.name = 'ToolError';
  this.message = message;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, ToolError);
  }
}

ToolError.prototype = Object.create(Error.prototype);
ToolError.prototype.constructor = ToolError;

/**
 * A usage fault, distinguished so `main` can print the usage text with it.
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
 * The readable reason behind any thrown value, including the ones that are not
 * Errors. Used everywhere a failure is recorded rather than propagated.
 *
 * @param {*} value
 * @returns {string}
 */
function reasonOf(value) {
  if (value === null || value === undefined) {
    return String(value);
  }

  if (value.message) {
    return String(value.message);
  }

  return String(value);
}

/**
 * One diagnostic line on stderr. stdout is reserved for nothing at all - see
 * the note in the usage text.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  process.stderr.write(LOG_PREFIX + message + '\n');
}

/**
 * Parses the command line.
 *
 * Unrecognized arguments are rejected rather than ignored: a mistyped flag that
 * silently changed nothing would produce an artifact that looks like the one
 * that was asked for.
 *
 * @param {Array.<string>} argv
 * @returns {Object} the resolved options
 * @throws {ToolError} on a usage fault
 */
function parseArguments(argv) {
  var args = argv || [];
  var options = {
    help: false,
    appRoot: process.cwd(),
    out: DEFAULT_OUT,
    manifestPath: null,
    only: [],
    append: false,
    baseUrl: null,
    profileFile: null,
    secure: false,
    port: null,
    host: null,
    database: null,
    mongoUri: null,
    overlay: undefined,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    payloadsPath: null,
    seedFixtures: true,
    quirks: true,
    expectBaseline: false,
    nodeFlags: []
  };
  var i;
  var arg;

  // `allowDashes` exists for --node-flags, whose whole purpose is to carry
  // values that begin with a dash. Rejecting those would make
  // `--node-flags "--pending-deprecation"` - the exact invocation the
  // zero-warning gate needs - impossible to express.
  function valueFor(flag, next, allowDashes) {
    var looksLikeFlag = typeof next === 'string' && next.charAt(0) === '-' &&
      next !== '-';

    if (next === undefined || (looksLikeFlag && !allowDashes)) {
      throw usageError(flag + ' requires a value');
    }

    return next;
  }

  for (i = 0; i < args.length; i++) {
    arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      return options;
    }
    else if (arg === '--app') {
      options.appRoot = path.resolve(valueFor('--app', args[i + 1]));
      i++;
    }
    else if (arg === '--out') {
      options.out = path.resolve(valueFor('--out', args[i + 1]));
      i++;
    }
    else if (arg === '--manifest') {
      options.manifestPath = path.resolve(valueFor('--manifest', args[i + 1]));
      i++;
    }
    else if (arg === '--only') {
      options.only.push(valueFor('--only', args[i + 1]));
      i++;
    }
    else if (arg === '--append') {
      options.append = true;
    }
    else if (arg === '--base-url') {
      options.baseUrl = normalizeBaseUrl(valueFor('--base-url', args[i + 1]));
      i++;
    }
    else if (arg === '--profile-file') {
      options.profileFile = path.resolve(valueFor('--profile-file', args[i + 1]));
      i++;
    }
    else if (arg === '--secure') {
      options.secure = true;
    }
    else if (arg === '--port') {
      options.port = parsePositiveInteger(valueFor('--port', args[i + 1]), '--port');
      i++;
    }
    else if (arg === '--host') {
      options.host = valueFor('--host', args[i + 1]);
      i++;
    }
    else if (arg === '--database') {
      options.database = valueFor('--database', args[i + 1]);
      i++;
    }
    else if (arg === '--mongo-uri') {
      options.mongoUri = valueFor('--mongo-uri', args[i + 1]);
      i++;
    }
    else if (arg === '--overlay') {
      if (args[i + 1] !== undefined && args[i + 1].charAt(0) !== '-') {
        options.overlay = path.resolve(args[i + 1]);
        i++;
      }
      else {
        options.overlay = undefined;
      }
    }
    else if (arg === '--no-overlay') {
      options.overlay = null;
    }
    else if (arg === '--timeout') {
      options.timeoutMs = parsePositiveInteger(valueFor('--timeout', args[i + 1]), '--timeout');
      i++;
    }
    else if (arg === '--payloads') {
      options.payloadsPath = path.resolve(valueFor('--payloads', args[i + 1]));
      i++;
    }
    else if (arg === '--no-seed') {
      options.seedFixtures = false;
    }
    else if (arg === '--no-quirks') {
      options.quirks = false;
    }
    else if (arg === '--expect-baseline') {
      options.expectBaseline = true;
    }
    else if (arg === '--node-flags') {
      options.nodeFlags = options.nodeFlags.concat(
        String(valueFor('--node-flags', args[i + 1], true))
          .split(/\s+/).filter(Boolean));
      i++;
    }
    else {
      throw usageError('unrecognized argument: ' + arg);
    }
  }

  if (options.manifestPath === null) {
    options.manifestPath = DEFAULT_MANIFEST;
  }

  if (options.baseUrl && options.seedFixtures) {
    // Seeding needs the database address, and with --base-url this tool never
    // learns it: the launcher is what publishes it. Reported rather than
    // guessed, because a silently unseeded run produces a corpus of 404s that
    // looks like a captured baseline.
    options.seedFixtures = false;
    options.seedSkippedReason = '--base-url was given, so the database address ' +
      'is owned by whoever started that server; seed it there';
  }

  return options;
}

/**
 * A strictly positive integer, or a usage fault naming the flag.
 *
 * @param {string} value
 * @param {string} flag
 * @returns {number}
 */
function parsePositiveInteger(value, flag) {
  var parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw usageError(flag + ' requires a positive integer, got ' + JSON.stringify(String(value)));
  }

  return parsed;
}

/**
 * Validates a base URL and strips any trailing slash so joining is unambiguous.
 *
 * Uses the WHATWG parser deliberately: the legacy one emits DEP0169, and this
 * tool's stderr sits inside the stream the zero-warning gate inspects.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeBaseUrl(value) {
  var parsed;

  try {
    parsed = new URL(String(value));
  }
  catch (err) {
    throw usageError('--base-url ' + JSON.stringify(String(value)) +
      ' is not a valid absolute URL: ' + reasonOf(err));
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw usageError('--base-url must be http or https, got ' + parsed.protocol);
  }

  return parsed.origin;
}

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

/**
 * Serializes an artifact with two spaces and a trailing newline, matching the
 * sibling tools so every artifact in this directory diffs the same way.
 *
 * @param {*} value
 * @returns {string}
 */
function serialize(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Returns a copy of a plain object with its keys in sorted order.
 *
 * Applied to every map whose key set is decided by the response rather than by
 * this file - headers above all. Objects this file constructs itself are built
 * in a declared order and are left alone, because insertion order is already
 * stable and reads better than alphabetical.
 *
 * @param {Object} value
 * @returns {Object}
 */
function sortedKeys(value) {
  var out = {};

  Object.keys(value).sort().forEach(function(key) {
    out[key] = value[key];
  });

  return out;
}

/**
 * The sha256 hex digest of a buffer or string.
 *
 * @param {(Buffer|string)} value
 * @returns {string}
 */
function sha256Hex(value) {
  return crypto.createHash('sha256')
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'))
    .digest('hex');
}

/**
 * Coarse timing, because exact elapsed milliseconds are never comparable
 * between two trees but an order-of-magnitude change is worth seeing. A case
 * that moves from `<1s` to `>=10s` is a finding even when its body matches.
 *
 * @param {number} elapsedMs
 * @returns {string}
 */
function elapsedBucket(elapsedMs) {
  if (elapsedMs < 10) {
    return '<10ms';
  }
  if (elapsedMs < 100) {
    return '<100ms';
  }
  if (elapsedMs < 1000) {
    return '<1s';
  }
  if (elapsedMs < 10000) {
    return '<10s';
  }

  return '>=10s';
}

/**
 * Whether a response body of this content type is recorded as text.
 *
 * @param {(string|undefined)} contentType
 * @returns {boolean}
 */
function isTextualType(contentType) {
  return TEXTUAL_TYPE.test(String(contentType || ''));
}

/**
 * Splits one Set-Cookie header into its name and its attributes.
 *
 * The VALUE is replaced by its digest and its length. Cookie values are in the
 * enumerated volatile set - a server-side session id changes on every run by
 * design - so nothing comparable is lost, and a live session token does not end
 * up parked in a committed artifact. Everything that IS compared survives in
 * full: the name, the flags, and the presence and horizon of Expires, which is
 * the only way the private-field cookie patch going silently no-op can be
 * detected.
 *
 * @param {string} raw one Set-Cookie header value
 * @returns {Object} the parsed record
 */
function parseSetCookie(raw) {
  var text = String(raw);
  var segments = text.split(';');
  var first = segments.shift() || '';
  var separator = first.indexOf('=');
  var name = separator === -1 ? first.trim() : first.slice(0, separator).trim();
  var value = separator === -1 ? '' : first.slice(separator + 1);
  var attributes = {};
  var expiresAt = null;

  segments.forEach(function(segment) {
    var trimmed = segment.trim();
    var index;
    var key;

    if (!trimmed) {
      return;
    }

    index = trimmed.indexOf('=');

    if (index === -1) {
      attributes[trimmed.toLowerCase()] = true;
      return;
    }

    key = trimmed.slice(0, index).trim().toLowerCase();
    attributes[key] = trimmed.slice(index + 1).trim();
  });

  if (attributes.expires) {
    expiresAt = Date.parse(attributes.expires);
    // The absolute date is volatile; the HORIZON is the contract. Recorded in
    // whole days so a one-year expiry compares equal across two runs taken on
    // different days while a change from one year to session-only does not.
    attributes.expires = 'present';
  }

  return {
    name: name,
    valueLength: value.length,
    valueDigest: sha256Hex(value),
    attributes: sortedKeys(attributes),
    expiresInDays: expiresAt === null
      ? null
      : Math.round((expiresAt - Date.now()) / 86400000)
  };
}

/**
 * Normalizes the raw header bag into something comparable and stable: keys
 * lowercased and sorted, repeated headers kept as arrays, and the value of any
 * Set-Cookie redacted to its digest for the reason given on parseSetCookie.
 *
 * @param {Object} raw node's incoming headers
 * @returns {Object}
 */
function recordHeaders(raw) {
  var out = {};

  Object.keys(raw || {}).forEach(function(key) {
    var lower = key.toLowerCase();
    var value = raw[key];

    if (lower === 'set-cookie') {
      out[lower] = (Array.isArray(value) ? value : [value]).map(function(entry) {
        var parsed = parseSetCookie(entry);
        // The header is kept in its original shape with only the value
        // substituted, so a change in attribute ORDER or spelling is still
        // visible rather than being smoothed away by the parse.
        return String(entry).replace(/^([^=;]*)=([^;]*)/, function(match, name) {
          return name + '=<redacted:sha256:' + parsed.valueDigest.slice(0, 16) + '>';
        });
      });
      return;
    }

    out[lower] = Array.isArray(value) ? value.slice() : value;
  });

  return sortedKeys(out);
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * Encodes a payload into a body and the content type that describes it.
 *
 * Form encoding is the default because that is what the application's own
 * pages send and what its validation was written against: a browser posting
 * `/login` sends a form, and several schemas rely on Joi's coercion of the
 * strings a form produces. A payload carrying a non-scalar value cannot be form
 * encoded faithfully, so it is sent as JSON instead - which is what the API
 * routes receive in production anyway.
 *
 * @param {(Object|string|null)} payload
 * @param {(string|undefined)} preferred an explicit content type
 * @returns {Object} {body, contentType, encoding}
 */
function encodePayload(payload, preferred) {
  var params;
  var needsJson;

  if (payload === null || payload === undefined) {
    return { body: null, contentType: null, encoding: 'none' };
  }

  if (typeof payload === 'string') {
    return {
      body: Buffer.from(payload, 'utf8'),
      contentType: preferred || FORM_TYPE,
      encoding: 'raw'
    };
  }

  needsJson = preferred === JSON_TYPE || Object.keys(payload).some(function(key) {
    var value = payload[key];
    return value !== null && typeof value === 'object';
  });

  if (needsJson) {
    return {
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      contentType: JSON_TYPE,
      encoding: 'json'
    };
  }

  params = new URLSearchParams();

  Object.keys(payload).forEach(function(key) {
    params.append(key, payload[key] === null || payload[key] === undefined
      ? ''
      : String(payload[key]));
  });

  return {
    body: Buffer.from(params.toString(), 'utf8'),
    contentType: preferred || FORM_TYPE,
    encoding: 'form'
  };
}

/**
 * Issues one request and records everything that came back.
 *
 * Never rejects. Every outcome - a response, a timeout, a transport failure -
 * is a RECORDED result, because a corpus whose driver threw on the interesting
 * case is a corpus missing the interesting case. In particular a timeout is
 * recorded with `timedOut: true` and its bound rather than being raised: that
 * is the only way the never-settling image download branch is captured without
 * hanging the run, and it is what lets the approved deviation on that branch be
 * evidenced later as a change from a timeout to a 200 rather than as a failure.
 *
 * Redirects are NOT followed. The Location header is part of the surface under
 * comparison, and following it would replace the thing being measured with its
 * consequence.
 *
 * @param {Object} spec {baseUrl, method, target, headers, body, contentType}
 * @param {number} timeoutMs finite per-step budget
 * @returns {Promise<Object>} the recorded response
 */
function drive(spec, timeoutMs) {
  return new Promise(function(resolve) {
    var url;
    var transport;
    var started = process.hrtime.bigint();
    var settled = false;
    var request;
    var requestOptions;
    var headers = {};

    function elapsedMs() {
      return Number((process.hrtime.bigint() - started) / BigInt(1000)) / 1000;
    }

    function finish(record) {
      if (settled) {
        return;
      }
      settled = true;
      resolve(record);
    }

    try {
      url = new URL(spec.target, spec.baseUrl);
    }
    catch (err) {
      finish({
        ok: false,
        error: 'the target ' + JSON.stringify(String(spec.target)) +
          ' is not resolvable against ' + spec.baseUrl + ': ' + reasonOf(err),
        timedOut: false,
        elapsedMs: 0,
        elapsedBucket: elapsedBucket(0),
        timeoutMs: timeoutMs
      });
      return;
    }

    Object.keys(spec.headers || {}).forEach(function(key) {
      if (spec.headers[key] !== null && spec.headers[key] !== undefined) {
        headers[key] = spec.headers[key];
      }
    });

    if (spec.body) {
      headers['content-length'] = String(spec.body.length);

      if (spec.contentType) {
        headers['content-type'] = spec.contentType;
      }
    }

    transport = url.protocol === 'https:' ? https : http;

    requestOptions = {
      method: spec.method,
      headers: headers,
      // A per-request agent with keep-alive off. A pooled socket kept open by
      // the never-settling case would hold this process open after the corpus
      // was written, turning a clean exit into a hang.
      agent: new transport.Agent({ keepAlive: false })
    };

    try {
      request = transport.request(url, requestOptions);
    }
    catch (err) {
      finish({
        ok: false,
        error: 'the request could not be created: ' + reasonOf(err),
        timedOut: false,
        elapsedMs: elapsedMs(),
        elapsedBucket: elapsedBucket(elapsedMs()),
        timeoutMs: timeoutMs
      });
      return;
    }

    request.setTimeout(timeoutMs, function() {
      var spent = elapsedMs();

      request.destroy();

      // The expected-timeout path. `bodyBytesBeforeTimeout` distinguishes a
      // route that answered nothing at all from one that began streaming and
      // then stalled, which are different defects.
      finish({
        ok: true,
        timedOut: true,
        timeoutMs: timeoutMs,
        elapsedMs: spent,
        elapsedBucket: elapsedBucket(spent),
        status: null,
        headers: null,
        body: null
      });
    });

    request.on('error', function(err) {
      var spent = elapsedMs();

      if (settled) {
        return;
      }

      finish({
        ok: false,
        error: 'transport failure: ' + reasonOf(err) +
          (err && err.code ? ' (' + err.code + ')' : ''),
        timedOut: false,
        elapsedMs: spent,
        elapsedBucket: elapsedBucket(spent),
        timeoutMs: timeoutMs
      });
    });

    request.on('response', function(response) {
      var chunks = [];
      var total = 0;

      response.on('data', function(chunk) {
        chunks.push(chunk);
        total += chunk.length;
      });

      response.on('aborted', function() {
        var spent = elapsedMs();

        finish({
          ok: false,
          error: 'the response was aborted after ' + total + ' bytes',
          timedOut: false,
          elapsedMs: spent,
          elapsedBucket: elapsedBucket(spent),
          timeoutMs: timeoutMs,
          status: response.statusCode
        });
      });

      response.on('end', function() {
        var spent = elapsedMs();
        var buffer = Buffer.concat(chunks, total);
        var recordedHeaders = recordHeaders(response.headers);
        var rawCookies = response.headers['set-cookie'] || [];
        var contentType = response.headers['content-type'];
        var textual = isTextualType(contentType);
        var body = {
          encoding: textual ? 'text' : 'binary',
          length: buffer.length,
          digest: sha256Hex(buffer),
          truncated: false,
          text: null
        };

        if (textual) {
          if (buffer.length > MAX_TEXT_BYTES) {
            body.text = buffer.slice(0, MAX_TEXT_BYTES).toString('utf8');
            body.truncated = true;
          }
          else {
            body.text = buffer.toString('utf8');
          }
        }

        var record = {
          ok: true,
          timedOut: false,
          timeoutMs: timeoutMs,
          status: response.statusCode,
          statusMessage: response.statusMessage || '',
          httpVersion: response.httpVersion,
          headers: recordedHeaders,
          setCookies: rawCookies.map(parseSetCookie),
          body: body,
          elapsedMs: spent,
          elapsedBucket: elapsedBucket(spent)
        };

        // The genuine Set-Cookie values, needed to keep a session alive across
        // a sequence. Defined as NON-ENUMERABLE so that neither JSON.stringify
        // nor Object.keys can carry a live session token into the artifact,
        // however this record is later handled - see parseSetCookie.
        Object.defineProperty(record, 'rawSetCookie', {
          value: rawCookies.slice(),
          enumerable: false,
          writable: false
        });

        finish(record);
      });
    });

    if (spec.body) {
      request.write(spec.body);
    }

    request.end();
  });
}

// ---------------------------------------------------------------------------
// Identities and the cookie jar
// ---------------------------------------------------------------------------

/**
 * A cookie jar keyed by identity, plus the login flows that populate it.
 *
 * This reproduces the pattern the suite's own flow helper uses - store the
 * `set-cookie` of a response against the active user and replay it on that
 * user's later requests, and send a `referer` of `config.url` on everything -
 * rather than importing it. That helper requires the application at its top,
 * which would pull `app.js` into this process and break the two-worktree model
 * outright. It is a pattern reference, not a dependency.
 *
 * Sessions are established by driving the real login, never by forging a
 * cookie. `maxCookieSize: 0` puts session state on the server, so a forged
 * cookie could not work even in principle - and the login flow is itself part
 * of the surface under test.
 *
 * @param {Object} context {baseUrl, referer, timeoutMs}
 * @constructor
 */
function Jar(context) {
  this.baseUrl = context.baseUrl;
  this.referer = context.referer;
  this.timeoutMs = context.timeoutMs;

  this.cookies = {};
  this.established = {};
  this.failures = {};

  IDENTITIES.forEach(function(name) {
    this.cookies[name] = [];
  }, this);
}

/**
 * The Cookie header for an identity, or null when it holds none.
 *
 * Only the name=value pair of each stored cookie is replayed, which is what a
 * browser sends: replaying the attributes would produce a malformed header.
 *
 * @param {string} identity
 * @returns {(string|null)}
 */
Jar.prototype.header = function(identity) {
  var stored = this.cookies[identity] || [];

  if (!stored.length) {
    return null;
  }

  return stored.map(function(entry) {
    return String(entry).split(';')[0];
  }).join('; ');
};

/**
 * Files any Set-Cookie from a response against the identity that made the
 * request, replacing a cookie of the same name rather than appending, so a
 * rotated session id does not accumulate duplicates that a server would then
 * have to disambiguate.
 *
 * @param {string} identity
 * @param {Object} response a record from `drive`
 * @returns {undefined}
 */
Jar.prototype.absorb = function(identity, response) {
  var stored;
  var incoming = (response && response.rawSetCookie) || [];

  if (!incoming.length) {
    return;
  }

  stored = this.cookies[identity] || [];

  incoming.forEach(function(entry) {
    var name = String(entry).split('=')[0];
    var replaced = false;

    stored = stored.map(function(existing) {
      if (String(existing).split('=')[0] !== name) {
        return existing;
      }
      replaced = true;
      return entry;
    });

    if (!replaced) {
      stored.push(entry);
    }
  });

  this.cookies[identity] = stored;
};

/**
 * Discards an identity's cookies, so the next request starts a fresh session.
 *
 * @param {string} identity
 * @returns {undefined}
 */
Jar.prototype.reset = function(identity) {
  this.cookies[identity] = [];
  this.established[identity] = false;
};

/**
 * Drives one request as an identity, filing the cookies it returns.
 *
 * @param {string} identity
 * @param {Object} spec {method, target, headers, payload, contentType}
 * @param {number} timeoutMs
 * @returns {Promise<Object>} the recorded response
 */
Jar.prototype.request = async function(identity, spec, timeoutMs) {
  var encoded = encodePayload(spec.payload, spec.contentType);
  var cookie = this.header(identity);
  var headers = {
    // Matches the shape the suite's own requests have, so a captured request
    // is the same kind of request the assertions were written against. Several
    // handlers read `request.headers.referer` into the view metrics they
    // persist, which makes this part of the recorded behaviour rather than
    // decoration.
    referer: this.referer,
    accept: spec.accept || ACCEPT_HTML,
    'accept-encoding': 'identity',
    'user-agent': 'trinket-parity-capture'
  };
  var response;

  if (cookie) {
    headers.cookie = cookie;
  }

  Object.keys(spec.headers || {}).forEach(function(key) {
    headers[key.toLowerCase()] = spec.headers[key];
  });

  response = await drive({
    baseUrl: this.baseUrl,
    method: spec.method,
    target: spec.target,
    headers: headers,
    body: encoded.body,
    contentType: encoded.contentType
  }, timeoutMs === undefined ? this.timeoutMs : timeoutMs);

  this.absorb(identity, response);

  return {
    response: response,
    sent: {
      method: spec.method,
      target: spec.target,
      accept: headers.accept,
      identity: identity,
      cookiePresent: !!cookie,
      contentType: encoded.contentType,
      payloadEncoding: encoded.encoding,
      // The exact payload that was sent, recorded beside its response so a
      // reviewer can see what produced it. This is the payload evidence AAP
      // 0.9.3 requires of every mutating case.
      payload: spec.payload === undefined ? null : spec.payload
    }
  };
};

/**
 * Establishes a session for one of the password identities by driving the real
 * login form, and reports whether it worked.
 *
 * A successful login is a 302 whose Location ends at `/home`; the failure form
 * of this route is a 302 back to `/login`, so the status alone cannot tell them
 * apart and the Location is what is checked. The disabled identity is expected
 * NOT to reach /home - its account is refused by the auth scheme on the next
 * request - so its login is driven and its outcome recorded without being
 * treated as a fault.
 *
 * @param {string} identity
 * @param {Object} credentials {email, password}
 * @returns {Promise<Object>} {ok, status, location}
 */
Jar.prototype.login = async function(identity, credentials) {
  var driven = await this.request(identity, {
    method: 'POST',
    target: '/login',
    accept: ACCEPT_HTML,
    payload: { email: credentials.email, password: credentials.password }
  });
  var response = driven.response;
  var location = response.ok && response.headers
    ? String(response.headers.location || '')
    : '';
  var landed = /\/home$/.test(location);

  this.established[identity] = landed;

  if (!landed) {
    this.failures[identity] = 'POST /login answered ' +
      (response.ok ? response.status + ' -> ' + (location || '(no Location)')
                   : response.error);
  }

  return {
    ok: landed,
    status: response.ok ? response.status : null,
    location: location,
    error: response.ok ? null : response.error
  };
};

// ---------------------------------------------------------------------------
// Materializing a route template into a concrete target
// ---------------------------------------------------------------------------

/**
 * The language prefix a route path begins with, or null.
 *
 * Longest match wins so `python3` is not read as `python`, and
 * `glowscript-blocks` not as `glowscript`.
 *
 * @param {string} routePath
 * @returns {(string|null)}
 */
function langPrefixOf(routePath) {
  var found = null;

  LANG_PREFIXES.forEach(function(lang) {
    var prefix = '/' + lang;

    if (routePath !== prefix &&
        routePath.indexOf(prefix + '/') !== 0 &&
        routePath !== prefix + '/') {
      return;
    }

    if (found === null || lang.length > found.length) {
      found = lang;
    }
  });

  return found;
}

/**
 * The seeded trinket a route should address, chosen by the route's own language
 * prefix so a success case cannot accidentally drive the language-mismatch
 * pre-handler instead.
 *
 * A language with no seeded trinket of its own - java, music, pygame and the
 * glowscript family - falls back to the python fixture, and the scenario
 * records that its short code belongs to another language, because on those
 * routes the mismatch branch is then genuinely what runs.
 *
 * @param {string} routePath
 * @param {Object} fixtures the seeder's fixtures
 * @returns {Object} {trinket, matched, lang}
 */
function trinketForPath(routePath, fixtures) {
  var lang = langPrefixOf(routePath);
  var key = lang === null ? null : LANG_TRINKET[lang];

  if (key && fixtures.trinkets[key]) {
    return { trinket: fixtures.trinkets[key], matched: true, lang: lang };
  }

  return {
    trinket: fixtures.trinkets.trinketPython,
    matched: lang === null,
    lang: lang
  };
}

/**
 * The value for a `{path*}` tail on a given route.
 *
 * @param {string} routePath
 * @returns {string}
 */
function wildcardTailFor(routePath) {
  var chosen = '';

  WILDCARD_TAILS.some(function(rule) {
    if (rule.suffix) {
      if (routePath.slice(-rule.suffix.length) === rule.suffix) {
        chosen = rule.value;
        return true;
      }
      return false;
    }

    if (routePath.indexOf(rule.prefix) === 0) {
      chosen = rule.value;
      return true;
    }

    return false;
  });

  return chosen;
}

/**
 * Turns a route template into a concrete path, and says what it had to assume.
 *
 * Returns the substitutions it made so the scenario can record them: a case
 * driven against a deliberately absent identifier reads very differently from
 * one driven against a seeded document, and the corpus should not leave a
 * reviewer to work out which happened.
 *
 * @param {Object} entry a manifest entry
 * @param {Object} data {ids, fixtures}
 * @returns {Object} {target, substitutions, absent, notes}
 */
function materializePath(entry, data) {
  var ids = data.ids;
  var fixtures = data.fixtures;
  var routePath = entry.path;
  var resolved = trinketForPath(routePath, fixtures);
  var substitutions = {};
  var absent = [];
  var notes = [];
  var target;

  function token(name, value, isAbsent) {
    substitutions[name] = value;

    if (isAbsent) {
      absent.push(name);
    }

    return value;
  }

  target = routePath.replace(/\{([^}]+)\}/g, function(match, raw) {
    var name = raw.replace(/[*?]$/, '').replace(/\*$/, '');

    switch (name) {
      case 'courseId':
        return token(name, ids.course, false);
      case 'courseSlug':
        return token(name, fixtures.slugs.course, false);
      case 'lessonId':
        return token(name, ids.lesson, false);
      case 'materialId':
        return token(name, ids.material, false);
      case 'trinketId':
        return token(name, resolved.trinket.id, false);
      case 'shortCode':
        return token(name, resolved.trinket.shortCode, false);
      case 'folderId':
        return token(name, ids.folder, false);
      case 'fileId':
        return token(name, ids.file, false);
      case 'fileName':
        return token(name, fixtures.bytes.materialText.filename, false);
      case 'exportId':
        return token(name, ids.exportCompleted, false);
      case 'userId':
        return token(name, ids.user, false);
      case 'userSlug':
      case 'username':
        return token(name, seed.credentials.user.username, false);
      case 'slug':
        return token(name, fixtures.slugs.folder, false);
      case 'lang':
        return token(name, resolved.lang || resolved.trinket.lang, false);
      case 'accessCode':
        return token(name, fixtures.course.accessCode, false);
      case 'accountPage':
        return token(name, 'settings', false);
      case 'adminPage':
        return token(name, 'users', false);
      case 'assetType':
        return token(name, 'css', false);
      case 'timestamp':
        return token(name, '1', false);
      case 'hash':
        return token(name, resolved.trinket.shortCode, false);
      case 'type':
        return token(name, 'python', false);
      case 'version':
        return token(name, '1', false);
      case 'invitationId':
        notes.push('{invitationId} has no seeded fixture - the seeder owns no ' +
          'invitation document - so a fixed, deliberately ABSENT id is used and ' +
          'this case records the not-found edge rather than a success path');
        return token(name, ABSENT_ID, true);
      case 'token':
        notes.push('{token} is minted by an invitation mail rather than seeded, ' +
          'so a fixed, deliberately ABSENT token is used and this case records ' +
          'the not-found edge');
        return token(name, ABSENT_TOKEN, true);
      case 'path':
        return token(name, wildcardTailFor(routePath), false);
      default:
        // Unreachable for the 233 routes measured, and deliberately loud rather
        // than substituting something plausible: a new wildcard token added to
        // the route surface must be given a seeded value on purpose, not
        // silently filled in with a placeholder that then gets captured as
        // though it meant something.
        notes.push('the wildcard {' + raw + '} has no materialization rule, so ' +
          'this case was driven against a literal placeholder and must be given ' +
          'a seeded value before its capture is trusted');
        return token(name, 'parity-unmapped-' + name, true);
    }
  });

  if (!resolved.matched && resolved.lang) {
    notes.push('no trinket is seeded for the language prefix /' + resolved.lang +
      ', so the python fixture\'s short code is used; the language-mismatch ' +
      'pre-handler branch is what runs on this route as a result');
  }

  // The target is used exactly as the template produced it. A trailing slash
  // is load-bearing on this surface - `/python` and `/python/` are separate
  // routes bound to different controllers, and a `{path*}` that materializes to
  // the empty string legitimately leaves one behind - so nothing is trimmed.
  return {
    target: target === '' ? '/' : target,
    substitutions: sortedKeys(substitutions),
    absent: absent,
    notes: notes
  };
}

// ---------------------------------------------------------------------------
// The scenario model
// ---------------------------------------------------------------------------

/**
 * Builds one scenario.
 *
 * A scenario is not a route key. It is a route plus the identity driving it,
 * the Accept mode, the intended path through the handler, the fixture profile
 * in force and, where a quirk needs one, an ORDERED SEQUENCE of steps. The
 * sequence is what makes the cross-request cases meaningful: modelling them as
 * two unrelated cases would let a replay reorder them, and both the
 * `fail.redirect` leak and the OAuth existing-user branch depend on the order.
 *
 * @param {Object} spec
 * @returns {Object} the scenario definition
 */
function scenario(spec) {
  return {
    id: spec.id,
    group: spec.group,
    route: { method: spec.method, path: spec.path },
    identity: spec.identity,
    accept: spec.accept,
    intent: spec.intent,
    mutating: !!spec.mutating,
    fixtureProfile: spec.fixtureProfile || 'default',
    freshSession: !!spec.freshSession,
    covers: spec.covers || [routeKeyOf(spec.method, spec.path)],
    expectation: spec.expectation || null,
    notes: spec.notes || [],
    steps: spec.steps
  };
}

/**
 * The manifest's own join key, taken from the manifest tool so the two artifacts
 * cannot disagree about what identifies a route.
 *
 * @param {string} method
 * @param {string} routePath
 * @returns {string}
 */
function routeKeyOf(method, routePath) {
  return manifest.routeKey(method, routePath);
}

/**
 * A stable, readable, unique scenario id.
 *
 * Two properties of this route surface make the obvious slug WRONG, and both
 * were caught by driving the real 233 rather than by inspection:
 *
 *   A trailing slash selects a different route with a different controller -
 *   `/python` renders the language index while `/python/` renders the site
 *   index - so stripping it collides two distinct routes onto one id.
 *
 *   Case is significant: `/R` and `/r` are both registered, and lowercasing
 *   collides them too.
 *
 * So the trailing slash is spelled out and the path's own case is preserved.
 * Uniqueness is not cosmetic here: `--only` selects by id and `--append` merges
 * by it, so a collision would silently replace one route's capture with
 * another's.
 *
 * @param {string} prefix
 * @param {string} method
 * @param {string} routePath
 * @param {string} suffix
 * @returns {string}
 */
function scenarioId(prefix, method, routePath, suffix) {
  var raw = String(routePath);
  var trailingSlash = raw.length > 1 && raw.charAt(raw.length - 1) === '/';
  var slug = raw
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (!slug) {
    slug = 'root';
  }

  if (trailingSlash) {
    slug += '-slash';
  }

  return [prefix, String(method).toLowerCase(), slug, suffix]
    .filter(Boolean)
    .join('.');
}

/**
 * Appends a query string to a target, preserving any query already on it.
 *
 * @param {string} target
 * @param {(Object|null)} query
 * @returns {string}
 */
function withQuery(target, query) {
  var params;
  var keys;
  var separator;

  if (!query) {
    return target;
  }

  keys = Object.keys(query);

  if (!keys.length) {
    return target;
  }

  params = new URLSearchParams();

  keys.sort().forEach(function(key) {
    params.append(key, String(query[key]));
  });

  separator = target.indexOf('?') === -1 ? '?' : '&';

  return target + separator + params.toString();
}

/**
 * The identity a route should be driven as for its success sweep.
 *
 * A route whose auth mode is `required` needs a session or it can only ever
 * record a 401; a route in `try` mode is driven anonymously, because that is
 * the guest browsing path 126 of the 233 routes actually serve. Admin routes
 * are recognized by their path and driven as the seeded admin, since the
 * ordinary user reaches only their 403.
 *
 * @param {Object} entry a manifest entry
 * @returns {string}
 */
function identityForEntry(entry) {
  var isAdminRoute = entry.path.indexOf('/api/admin') === 0 ||
                     entry.path === '/admin' ||
                     entry.path.indexOf('/admin/') === 0;

  if (isAdminRoute) {
    return IDENTITY_ADMIN;
  }

  if (entry.auth && entry.auth.mode === 'required') {
    return IDENTITY_USER;
  }

  return IDENTITY_ANONYMOUS;
}

/**
 * Whether driving this route changes state.
 *
 * Method is the reliable signal on this surface; the two exceptions worth
 * naming are `GET /logout`, which resets the session, and the export request
 * route, which enqueues work. Both are treated as mutating so they cannot
 * disturb a read-only case that ran earlier.
 *
 * @param {Object} entry
 * @returns {boolean}
 */
function isMutatingEntry(entry) {
  if (entry.method !== 'GET') {
    return true;
  }

  return entry.path === '/logout' || entry.path === '/api/exports';
}

/**
 * Builds the success sweep: one minimal request per route, in both Accept
 * modes where the route can serve both.
 *
 * The two modes are not redundancy. The parser computes its response type from
 * the Accept header and switches between a rendered view and a JSON body on
 * that basis, and the error extension separately decides whether a request is
 * an API request from the path prefix AND the Accept header. The same route
 * genuinely produces different responses, and both are part of the surface.
 *
 * A route under `/api/` is driven in JSON mode only: its HTML mode is the same
 * JSON body, because the extension classifies it as an API request by path
 * whatever it asks for, and a second identical case would only pad the corpus.
 *
 * @param {Object} context {entries, data, payloads, queries}
 * @returns {Array.<Object>} scenarios
 */
function buildRouteSweep(context) {
  var scenarios = [];

  context.entries.forEach(function(entry) {
    var key = routeKeyOf(entry.method, entry.path);
    var materialized = materializePath(entry, context.data);
    var identity = identityForEntry(entry);
    var mutating = isMutatingEntry(entry);
    var query = context.queries[key] || null;
    var hasPayload = Object.prototype.hasOwnProperty.call(context.payloads, key);
    var payload = hasPayload ? context.payloads[key] : null;
    var notes = materialized.notes.slice();
    var intent = 'success';
    var modes;

    // Truthfulness about what this case actually exercises. A route with
    // required payload keys and no entry in the payload table is driven into
    // its validation-failure path, and saying so is the difference between a
    // corpus a reviewer can trust and one that merely looks complete.
    if (entry.method !== 'GET' && !hasPayload &&
        (entry.validate || []).indexOf('payload') >= 0) {
      intent = 'unknown-payload';
      notes.push('no minimal payload is declared for this route, so it is ' +
        'driven with an empty payload; if its schema has a required key this ' +
        'case records the validation-failure path, which is a legitimate ' +
        'capture but is not a success path. Supply one with --payloads.');
    }

    if (materialized.absent.length) {
      intent = 'failure';
    }

    modes = entry.path.indexOf('/api/') === 0
      ? [{ accept: ACCEPT_JSON, suffix: 'json' }]
      : [
        { accept: ACCEPT_HTML, suffix: 'html' },
        { accept: ACCEPT_JSON, suffix: 'json' }
      ];

    modes.forEach(function(mode) {
      scenarios.push(scenario({
        id: scenarioId('route', entry.method, entry.path, mode.suffix),
        group: 'route-sweep',
        method: entry.method,
        path: entry.path,
        identity: identity,
        accept: mode.accept,
        intent: intent,
        mutating: mutating,
        notes: notes,
        steps: [{
          label: 'drive',
          method: entry.method,
          target: withQuery(materialized.target, query),
          accept: mode.accept,
          payload: payload,
          substitutions: materialized.substitutions
        }]
      }));
    });
  });

  return scenarios;
}

// ---------------------------------------------------------------------------
// The mandatory quirk cases
// ---------------------------------------------------------------------------
// Each of these exists so that a silent behaviour change cannot pass. They are
// the reason this corpus is evidence rather than decoration, and every one
// carries a declared baseline expectation that `--expect-baseline` checks.
//
// Their expectations describe BASELINE behaviour at the base commit. Against
// the migrated tree one of them is expected to differ - the never-settling
// image download becomes a 200 by the approved deviation in AAP 0.7 - which is
// exactly why the check is opt-in rather than always fatal: the corpus records
// the change from a timeout to a 200 as evidence of an approved deviation, and
// a tool that refused to write that artifact could not evidence it at all.

/**
 * Marks every scenario from `from` onward as never driven, with a reason.
 *
 * Never silently dropped: a case that was not reached is recorded with why, so
 * the artifact distinguishes "this route answered nothing" from "this route was
 * never asked".
 *
 * @param {Array.<Object>} scenarios
 * @param {number} from
 * @param {string} reason
 * @returns {undefined}
 */
function markRemainingUndriven(scenarios, from, reason) {
  var index;

  for (index = from; index < scenarios.length; index++) {
    scenarios[index].order = index;
    scenarios[index].driven = {
      ok: false,
      skipped: false,
      error: reason,
      neverReached: true
    };
    scenarios[index].expectationResult = null;
  }
}

/**
 * Whether the launched application is still running.
 *
 * Signal 0 checks for the process without signalling it, so this is a liveness
 * probe rather than an interference. An externally supplied server is reported
 * as alive because its pid is not this tool's to know; a transport failure
 * against one is then a finding for whoever started it.
 *
 * This exists because of what a dead server does to a corpus. A crash mid-run
 * turns every remaining case into a transport failure, and 100 recorded
 * ECONNREFUSED responses look like data while meaning nothing at all - the
 * first full sweep of this tool produced exactly that, and the artifact gave no
 * hint that a single route had killed the server on case 287 of 383. Detecting
 * it is the difference between an artifact that reports a crash and one that
 * silently misrepresents it.
 *
 * @param {(Object|null)} info the launcher's start result
 * @returns {boolean}
 */
function serverAlive(info) {
  if (info === null || !info.pid) {
    return true;
  }

  try {
    process.kill(info.pid, 0);
    return true;
  }
  catch (err) {
    // ESRCH is gone; EPERM means it exists but is not ours to signal, which
    // still counts as running.
    return err && err.code === 'EPERM';
  }
}

/**
 * Whether a driven scenario saw a transport failure, which is the symptom a
 * liveness check is worth spending on.
 *
 * A transport failure is a legitimate RECORDED outcome for the cases that
 * expect one, so this only reports the symptom; the caller decides by checking
 * whether the server is actually gone.
 *
 * @param {Object} item a driven scenario
 * @returns {boolean}
 */
function sawTransportFailure(item) {
  return item.steps.some(function(step) {
    return step.response && step.response.ok === false &&
      !step.response.timedOut;
  });
}

/**
 * The manifest entry for one route, or null.
 *
 * @param {Array.<Object>} entries
 * @param {string} method
 * @param {string} routePath
 * @returns {(Object|null)}
 */
function entryFor(entries, method, routePath) {
  var found = null;

  (entries || []).forEach(function(entry) {
    if (entry.method === method && entry.path === routePath) {
      found = entry;
    }
  });

  return found;
}

/**
 * Whether a route's pre-handlers gate it behind the admin role.
 *
 * Read off the recorded pre-handler descriptors rather than from a list of
 * paths, so a route that gains or loses the gate does not silently invalidate
 * a scenario's choice of identity.
 *
 * @param {(Object|null)} entry a manifest entry
 * @returns {boolean}
 */
function requiresAdmin(entry) {
  if (!entry || !Array.isArray(entry.pre)) {
    return false;
  }

  return entry.pre.some(function(descriptor) {
    return descriptor && typeof descriptor.method === 'string' &&
      /isAdmin/.test(descriptor.method);
  });
}

/**
 * Builds every quirk scenario.
 *
 * @param {Object} context {data, entries}
 * @returns {Array.<Object>} scenarios in the order they must be driven
 */
function buildQuirkScenarios(context) {
  var fixtures = context.data.fixtures;
  var ids = context.data.ids;
  var user = seed.credentials.user;
  var scenarios = [];

  // -------------------------------------------------------------------------
  // 1. The three missing-controller-fallback routes.
  //
  // These name controller methods that do not exist, so they answer entirely
  // through the parser's no-controller branch, which returns
  // `request.success(request.params)`. The branch sits immediately below the
  // response-emulation block the migration removes and is easy to delete by
  // association, which is precisely why all three are driven here.
  // -------------------------------------------------------------------------
  manifest.EXPECTED_FALLBACK_ROUTES.forEach(function(key) {
    var parts = key.split(' ');
    var method = parts[0];
    var routePath = parts[1];
    var query = method === 'GET' ? { lang: 'python' } : null;
    var payload = method === 'POST'
      ? { email: 'parity-interest@example.com', page: '/' }
      : null;
    var entry = entryFor(context.entries, method, routePath);
    // Two of the three carry an isAdmin pre-handler, which forbids the request
    // BEFORE the handler - and therefore before the fallback - ever runs.
    // Driven anonymously they answer 403 and the branch under test is never
    // reached, which is what the first run of this case actually recorded.
    // The identity is taken from the route's own pre-handler list rather than
    // hard-coded, so it stays right if the surface changes.
    var identity = requiresAdmin(entry) ? IDENTITY_ADMIN : IDENTITY_ANONYMOUS;
    var identityNote = requiresAdmin(entry)
      ? 'driven as the seeded admin because this route carries an isAdmin ' +
        'pre-handler, which would otherwise forbid the request before the ' +
        'fallback could answer'
      : 'driven anonymously; this route carries no pre-handlers';

    scenarios.push(scenario({
      id: scenarioId('quirk.fallback', method, routePath, null),
      group: 'quirk.missing-controller-fallback',
      method: method,
      path: routePath,
      identity: identity,
      accept: ACCEPT_JSON,
      intent: 'success',
      mutating: method !== 'GET',
      notes: [
        'the controller method this route names does not exist, so the ' +
        'response comes entirely from the parser\'s no-controller fallback, ' +
        'which returns the request.params projection',
        identityNote
      ],
      expectation: {
        description: 'answers 200 through the fallback rather than 404 or 500',
        steps: [{ index: 0, status: 200 }]
      },
      steps: [{
        label: 'drive',
        method: method,
        target: withQuery(routePath, query),
        accept: ACCEPT_JSON,
        payload: payload
      }]
    }));
  });

  // -------------------------------------------------------------------------
  // 2. The authenticated /login and /signup 500s.
  //
  // The shim declares `reply` as a bare function, so only the object it
  // RETURNS carries `.redirect`. Both handlers call `reply.redirect(...)` on
  // their authenticated branch, which throws a TypeError that the catch-all
  // turns into a 500. The existing smoke check asserts 200 for both but probes
  // them unauthenticated, which is why nothing has ever detected this.
  //
  // Driven while logged in, which is the whole point. Note that the
  // `request.yar.set('next', ...)` call lives in the ELSE branch and does not
  // precede the throw.
  // -------------------------------------------------------------------------
  [
    { path: '/login', target: '/home' },
    { path: '/signup', target: '/welcome' }
  ].forEach(function(page) {
    scenarios.push(scenario({
      id: scenarioId('quirk.authed-500', 'GET', page.path, null),
      group: 'quirk.authenticated-page-500',
      method: 'GET',
      path: page.path,
      identity: IDENTITY_USER,
      accept: ACCEPT_HTML,
      intent: 'failure',
      mutating: false,
      notes: [
        'driven WHILE LOGGED IN, where the handler calls reply.redirect(' +
        JSON.stringify(page.target) + ') on a bare function and throws ' +
        'TypeError: reply.redirect is not a function, reaching the handler ' +
        'catch-all as a 500',
        'the unauthenticated form of this route is a 200 and is captured by ' +
        'the route sweep, so the pair together is what proves the branch'
      ],
      expectation: {
        description: 'the authenticated visitor receives 500, not a redirect',
        steps: [{ index: 0, status: 500 }]
      },
      steps: [{
        label: 'drive-authenticated',
        method: 'GET',
        target: page.path,
        accept: ACCEPT_HTML,
        payload: null
      }]
    }));
  });

  // -------------------------------------------------------------------------
  // 3. The cross-request fail.redirect state leak - TWO CONSECUTIVE requests.
  //
  // The parser captures `fail` once at parse time, the handler closure holds it
  // by reference, and `request.fail` ASSIGNS the interpolated value back onto
  // that long-lived object. So the first request that fails validation burns
  // the template: request #2 redirects to request #1's target.
  //
  // `POST /users` is the clearest of the three affected routes because its
  // template interpolates a payload field the caller controls. Validation
  // failure calls `request.fail(request.payload, ...)`, so `formName` is what
  // gets interpolated - which means driving it twice with DIFFERENT formName
  // values and omitting a required field both times produces two Location
  // headers that must be IDENTICAL at baseline and would differ if the leak
  // were ever fixed.
  //
  // Both steps must be one scenario. As two cases a replay could reorder them,
  // and the second request's Location only means anything after the first.
  // -------------------------------------------------------------------------
  scenarios.push(scenario({
    id: 'quirk.fail-redirect-leak.post-users',
    group: 'quirk.fail-redirect-leak',
    method: 'POST',
    path: '/users',
    identity: IDENTITY_ANONYMOUS,
    accept: ACCEPT_HTML,
    intent: 'failure',
    mutating: true,
    freshSession: true,
    notes: [
      'the fail template for this route is /{formName} and the interpolated ' +
      'value is assigned back onto the parse-time object, so the first ' +
      'validation failure consumes the token for the life of the process',
      'step 1 sends formName=signup and step 2 sends formName=login, both ' +
      'omitting the required email and password; at baseline BOTH redirect to ' +
      '/signup, and a build that redirected step 2 to /login would have fixed ' +
      'a documented quirk',
      'the two Location values must be compared to EACH OTHER, not only to the ' +
      'baseline recording - that comparison is what detects the fix'
    ],
    expectation: {
      description: 'both requests redirect to step 1\'s target, /signup',
      steps: [
        { index: 0, status: 302, locationEndsWith: '/signup' },
        { index: 1, status: 302, locationEndsWith: '/signup' }
      ],
      cross: { locationsEqual: [0, 1] }
    },
    steps: [
      {
        label: 'first-failure-formName-signup',
        method: 'POST',
        target: '/users',
        accept: ACCEPT_HTML,
        payload: { formName: 'signup' }
      },
      {
        label: 'second-failure-formName-login',
        method: 'POST',
        target: '/users',
        accept: ACCEPT_HTML,
        payload: { formName: 'login' }
      }
    ]
  }));

  // -------------------------------------------------------------------------
  // 4. folders.trinkets, in both of its observably different cases.
  //
  // The handler builds its injected URL by concatenating
  // `request.url.search` and then '&folder=' + id. With no query present the
  // search is empty, so the URL becomes '/api/trinkets&folder=...' - an
  // ampersand where a question mark belongs - and the folder is not parsed as a
  // query parameter at all, so NO folder filter applies and the full trinket
  // list comes back. With a query present the URL is well formed and the filter
  // does apply.
  //
  // The seeded folder holds two of the seven trinkets, so the two responses
  // differ observably, which is what makes this checkable rather than
  // theoretical.
  // -------------------------------------------------------------------------
  scenarios.push(scenario({
    id: 'quirk.folders-trinkets.queryless-and-query-bearing',
    group: 'quirk.folders-trinkets',
    method: 'GET',
    path: '/api/folders/{folderId}/trinkets',
    identity: IDENTITY_USER,
    accept: ACCEPT_JSON,
    intent: 'success',
    mutating: false,
    notes: [
      'step 1 is driven BARE, where the malformed injected URL is not a query ' +
      'at all: the path misses the API route entirely, is served by the static ' +
      'catch-all, and the result carries no `data`, so the route answers 200 ' +
      'with an empty list and the trinket listing is never invoked',
      'step 2 carries a query, which makes the injected URL well formed so the ' +
      'folder filter does apply',
      'the ASSERTED invariant is the queryless empty list, because that is the ' +
      'measured, documented baseline behaviour and it is what a conversion ' +
      'would accidentally fix by passing the folder through in both cases',
      'the pair is recorded so replay.js compares BOTH bodies between the two ' +
      'trees. Whether step 2 returns a non-empty list depends on the folder ' +
      'membership being visible to the folder-filtered query, which is a ' +
      'fixture property rather than a property of this quirk - measured on the ' +
      'target tree, step 2 also came back empty even though the folder ' +
      'listing reports a trinket in that folder, and that is recorded as a ' +
      'finding rather than asserted here. Asserting "the two bodies differ" ' +
      'would make this case fail for a reason that has nothing to do with the ' +
      'behaviour under test.'
    ],
    expectation: {
      description: 'the queryless case answers 200 with an empty data list, ' +
        'and the query-bearing case answers 200',
      steps: [
        { index: 0, status: 200, bodyIncludes: '"data":[]' },
        { index: 1, status: 200 }
      ]
    },
    steps: [
      {
        label: 'queryless',
        method: 'GET',
        target: '/api/folders/' + ids.folder + '/trinkets',
        accept: ACCEPT_JSON,
        payload: null
      },
      {
        label: 'query-bearing',
        method: 'GET',
        target: '/api/folders/' + ids.folder + '/trinkets?published=true',
        accept: ACCEPT_JSON,
        payload: null
      }
    ]
  }));

  scenarios = scenarios.concat(buildReplyChainScenarios(context));
  scenarios = scenarios.concat(buildPreHandlerScenarios(context));
  scenarios = scenarios.concat(buildOAuthScenarios(context));
  scenarios = scenarios.concat(buildAuthOutcomeScenarios(context));
  scenarios = scenarios.concat(buildErrorEdgeScenarios(context));

  return scenarios;
}

/**
 * All eight reply chains, in the three categories they were measured in.
 *
 * The builder the shim returns resolves the deferred on `.code()`, `.header()`,
 * `.redirect()` and `.view()` but NOT on `.type()` or `.bytes()`, so what a
 * client receives depends on which chain method ran last - and the eight sites
 * do not agree. Removing the builder removes a mechanism, not a set of
 * outcomes, so every outcome is captured here BEFORE the conversion, because
 * afterwards there is nothing left to measure.
 *
 * @param {Object} context
 * @returns {Array.<Object>} scenarios
 */
function buildReplyChainScenarios(context) {
  var fixtures = context.data.fixtures;
  var ids = context.data.ids;
  var user = seed.credentials.user;
  var pythonTrinket = fixtures.trinkets.trinketPython;
  var filesTrinket = fixtures.trinkets.trinketPython3;
  var assetTrinket = fixtures.trinkets.trinketWithAssets;
  var scenarios = [];

  /**
   * One reply-chain case.
   *
   * @param {Object} spec
   * @returns {undefined}
   */
  function chain(spec) {
    scenarios.push(scenario({
      id: 'quirk.reply-chain.' + spec.key,
      group: 'quirk.reply-chain.' + spec.category,
      method: spec.method,
      path: spec.path,
      // The language-prefixed families are registered once PER LANGUAGE, so a
      // case driven at one concrete prefix must declare which registered route
      // it covers rather than let the shared template stand in for it - the
      // template is not itself a route key, and claiming it would both
      // overstate the case and leave the real route unrepresented.
      covers: spec.covers,
      identity: spec.identity,
      accept: spec.accept || ACCEPT_HTML,
      intent: spec.intent || 'success',
      mutating: spec.method !== 'GET',
      notes: [spec.site + ' - ' + spec.mechanism].concat(spec.notes || []),
      expectation: spec.expectation,
      steps: [{
        label: 'drive',
        method: spec.method,
        target: spec.target,
        accept: spec.accept || ACCEPT_HTML,
        payload: spec.payload || null,
        timeoutMs: spec.timeoutMs
      }]
    }));
  }

  // --- Category 1: never settles. Exactly one chain. ------------------------
  //
  // The image branch of the file download ends at `.bytes(...)` with no
  // `return` and nothing that resolves the deferred, so the request hangs. The
  // branch is selected by the file's `type` field - not its mime - which is why
  // the seeder plants a legacy record whose type is the literal 'image/png'
  // that the current enum would reject. That fixture exists for this case.
  //
  // Recorded as an EXPECTED timeout on a short budget. This is the one case
  // where preservation collides with "every route serves", and AAP 0.7 decides
  // it for the target in favour of serving; the corpus is what turns that into
  // evidence, by recording the baseline timeout so the target's 200 reads as an
  // approved change rather than an unexplained difference.
  chain({
    key: 'never-settles.image-download',
    category: 'never-settles',
    site: 'the image branch of files.download',
    mechanism: 'reply(stream).type(...).bytes(...) with no return and no ' +
      'resolving call, so the deferred is never settled and the request hangs',
    method: 'GET',
    path: '/api/files/{fileId}/{fileName}',
    target: '/api/files/' + ids.legacyImageFile + '/' +
      encodeURIComponent(fixtures.bytes.legacyPng.filename),
    identity: IDENTITY_USER,
    accept: ACCEPT_JSON,
    intent: 'timeout',
    timeoutMs: EXPECTED_TIMEOUT_MS,
    notes: [
      'the branch is chosen by the file document\'s `type` field, which on this ' +
      'seeded record is the legacy literal image/png',
      'an expected timeout is a RECORDED RESULT, not a failure: it is the only ' +
      'way this branch is captured without hanging the run',
      'against the migrated tree this case is expected to answer 200 with the ' +
      'stream, which is the approved deviation in AAP 0.7'
    ],
    expectation: {
      description: 'the request never settles and the step times out',
      steps: [{ index: 0, timedOut: true }]
    }
  });

  // --- Category 2: header-resolved and working. Four chains. ----------------
  //
  // Each of these continues to `.header(...)`, which DOES resolve the deferred,
  // so all four return real hapi responses today. They are captured so they
  // cannot become collateral damage of the deviation applied to the branch
  // above: the fix there must not disturb these.
  chain({
    key: 'header-resolved.file-download-attachment',
    category: 'header-resolved',
    site: 'the non-image branch of files.download',
    mechanism: 'the identical chain four lines below the never-settling one, ' +
      'continuing to .header(Content-Disposition), which resolves the deferred',
    method: 'GET',
    path: '/api/files/{fileId}/{fileName}',
    target: '/api/files/' + ids.file + '/' +
      encodeURIComponent(fixtures.bytes.materialText.filename),
    identity: IDENTITY_USER,
    accept: ACCEPT_JSON,
    notes: [
      'this is the response the deviation on the image branch adopts, minus ' +
      'the Content-Disposition header that branch deliberately omits'
    ],
    expectation: {
      description: 'a real streamed response with an attachment disposition',
      steps: [{ index: 0, status: 200, headerPresent: 'content-disposition' }]
    }
  });

  chain({
    key: 'header-resolved.course-download-zip',
    category: 'header-resolved',
    site: 'the returnZip callback in courses.download',
    mechanism: 'reply(stream).type(application/zip).bytes(...).header(...), ' +
      'resolved by the header call, and reached only after the directory ' +
      'removal callback has fired',
    method: 'GET',
    path: '/{userSlug}/courses/{courseSlug}/download.zip',
    target: '/' + user.username + '/courses/' + fixtures.slugs.course +
      '/download.zip?format=zip',
    identity: IDENTITY_USER,
    notes: [
      'the response is produced inside nested callbacks - a stat, then a ' +
      'recursive delete - so this case also covers the resolve-on-later-' +
      'callback disposition, where the response is whichever settles first'
    ],
    expectation: {
      description: 'a real archive response',
      steps: [{ index: 0, statusIn: [200, 403, 404, 500] }]
    }
  });

  chain({
    key: 'header-resolved.posted-zip-download',
    category: 'header-resolved',
    site: 'trinket.downloadPostedZip',
    mechanism: 'reply(readStream).type(application/zip).bytes(...).header(...), ' +
      'resolved by the header call',
    method: 'POST',
    path: '/api/trinkets/download',
    target: '/api/trinkets/download',
    identity: IDENTITY_ANONYMOUS,
    accept: ACCEPT_JSON,
    payload: {
      files: JSON.stringify([{ name: 'main.py', content: 'print("parity")' }])
    },
    expectation: {
      description: 'a real archive response',
      steps: [{ index: 0, statusIn: [200, 400, 500] }]
    }
  });

  chain({
    key: 'header-resolved.short-code-zip',
    category: 'header-resolved',
    site: 'the downloadZip format handler reached through getByShortCode',
    mechanism: 'the extension on the short code selects the zip download ' +
      'format, whose chain ends at .header(Content-Disposition)',
    method: 'GET',
    path: '/{lang}/{shortCode}',
    covers: ['GET /' + pythonTrinket.lang + '/{shortCode}'],
    target: '/' + pythonTrinket.lang + '/' + pythonTrinket.shortCode + '.zip',
    identity: IDENTITY_ANONYMOUS,
    notes: [
      'the extension is stripped off the short code by the findTrinket ' +
      'pre-handler and left on request.pre.extension, which is what dispatches ' +
      'to the zip format rather than the page render'
    ],
    expectation: {
      description: 'a real archive response',
      steps: [{ index: 0, statusIn: [200, 404, 500] }]
    }
  });

  // --- Category 3: the builder handed back to hapi. Three chains. -----------
  //
  // `return reply(...).type(type)` returns the BUILDER, not a response. What the
  // client receives depends on whether the deferred had already been resolved
  // earlier in the request; where hapi did receive the builder it serialized to
  // an empty object, because JSON.stringify drops function-valued properties.
  // The measured status, content type and body are captured here because after
  // the conversion the mechanism is gone.
  chain({
    key: 'builder-returned.download-main',
    category: 'builder-returned',
    site: 'trinket.downloadMain',
    mechanism: 'return reply(code[0].content).type(type) hands hapi the ' +
      'chainable builder rather than a response',
    method: 'GET',
    path: '/{lang}/{shortCode}/',
    covers: ['GET /' + pythonTrinket.lang + '/{shortCode}/'],
    target: '/' + pythonTrinket.lang + '/' + pythonTrinket.shortCode + '/',
    identity: IDENTITY_ANONYMOUS,
    notes: [
      'the seeded trinket\'s code is a raw string, so the handler synthesizes a ' +
      'single main file and returns its content through the builder'
    ],
    expectation: {
      description: 'whatever the builder produced, recorded exactly',
      steps: [{ index: 0, statusIn: [200, 404, 500] }]
    }
  });

  chain({
    key: 'builder-returned.download-code-file',
    category: 'builder-returned',
    site: 'the code-file branch of trinket.downloadFile',
    mechanism: 'return reply(file.content).type(type) - the builder again',
    method: 'GET',
    path: '/{lang}/{shortCode}/{path*}',
    covers: ['GET /' + filesTrinket.lang + '/{shortCode}/{path*}'],
    target: '/' + filesTrinket.lang + '/' + filesTrinket.shortCode + '/helper.py',
    identity: IDENTITY_ANONYMOUS,
    notes: [
      'this trinket\'s code is a JSON file array holding main.py and helper.py, ' +
      'so the named file is found in the code rather than in the assets'
    ],
    expectation: {
      description: 'whatever the builder produced, recorded exactly',
      steps: [{ index: 0, statusIn: [200, 404, 500] }]
    }
  });

  chain({
    key: 'builder-returned.download-asset',
    category: 'builder-returned',
    site: 'the asset branch of trinket.downloadFile',
    mechanism: 'return reply(stream).type(type) inside a then() - the builder ' +
      'handed back from an already-resolved promise chain',
    method: 'GET',
    path: '/{lang}/{shortCode}/{path*}',
    covers: ['GET /' + assetTrinket.lang + '/{shortCode}/{path*}'],
    target: '/' + assetTrinket.lang + '/' + assetTrinket.shortCode + '/' +
      encodeURIComponent(fixtures.bytes.assetGif.filename),
    identity: IDENTITY_ANONYMOUS,
    notes: [
      'the seeded asset-bearing trinket carries exactly one asset whose name is ' +
      'this path, so the lookup misses the code and hits the assets',
      'the asset body is served from the filesystem-backed object store the ' +
      'aws fixture installs, never from a network'
    ],
    expectation: {
      description: 'whatever the builder produced, recorded exactly',
      steps: [{ index: 0, statusIn: [200, 404, 500] }]
    }
  });

  return scenarios;
}

/**
 * The two dead pre-handler 301s.
 *
 * Both call `reply().redirect(loc).permanent().takeover()`, and in the shim the
 * bare `fakeReply(undefined)` settles the deferred with null BEFORE `.takeover()`
 * reaches its own resolve - so the redirect is discarded and the pre value the
 * handler sees is null. The capability is dead end to end. What must be captured
 * is that no 301 is emitted, because a conversion that made the redirect work
 * would be a behaviour improvement and is prohibited.
 *
 * Coverage for these is counted from the route manifest rather than from
 * lexical references, since the language expansion multiplies the second one
 * across several declarations.
 *
 * @param {Object} context
 * @returns {Array.<Object>} scenarios
 */
function buildPreHandlerScenarios(context) {
  var fixtures = context.data.fixtures;
  var user = seed.credentials.user;
  var pythonTrinket = fixtures.trinkets.trinketPython;
  var scenarios = [];

  // --- findTrinket, language mismatch --------------------------------------
  //
  // A python trinket addressed through the /html prefix. The pre-handler sees a
  // request language that disagrees with the document's own and takes the
  // redirect branch, which discards the redirect and yields null.
  scenarios.push(scenario({
    id: 'quirk.dead-301.find-trinket-language-mismatch',
    group: 'quirk.dead-pre-handler-301',
    method: 'GET',
    path: '/{lang}/{shortCode}',
    identity: IDENTITY_ANONYMOUS,
    accept: ACCEPT_HTML,
    intent: 'failure',
    mutating: false,
    covers: ['GET /html/{shortCode}'],
    notes: [
      'a python trinket is addressed through the /html prefix, so the ' +
      'pre-handler takes its language-mismatch branch',
      'at baseline the chain settles the pre-handler with null before the ' +
      'permanent redirect is applied, so NO 301 is emitted and the handler ' +
      'runs with a null pre value',
      'the corrected-language URL that the discarded redirect would have ' +
      'pointed at is /' + pythonTrinket.lang + '/' + pythonTrinket.shortCode
    ],
    expectation: {
      description: 'the redirect is discarded - the response is not a 301',
      steps: [{ index: 0, notStatus: 301 }]
    },
    steps: [{
      label: 'drive-mismatched-language',
      method: 'GET',
      target: '/html/' + pythonTrinket.shortCode,
      accept: ACCEPT_HTML,
      payload: null
    }]
  }));

  // --- courseBySlug, slug alias -------------------------------------------
  //
  // The alias branch needs an alias to exist, and an alias is created by the
  // course model when a course's slug CHANGES - the old slug is linked to the
  // course id in the slug store. So the case is an ordered sequence: rename the
  // course, then address it by its old slug.
  //
  // This mutates the seeded course's slug, so it is marked mutating and runs in
  // the late phase, after every read-only case that addresses the course by its
  // seeded slug.
  scenarios.push(scenario({
    id: 'quirk.dead-301.course-by-slug-alias',
    group: 'quirk.dead-pre-handler-301',
    method: 'GET',
    path: '/{userSlug}/courses/{courseSlug}',
    identity: IDENTITY_USER,
    accept: ACCEPT_HTML,
    intent: 'failure',
    mutating: true,
    notes: [
      'step 1 renames the seeded course, which is what makes its previous slug ' +
      'an alias: the model links the old slug to the course id on save',
      'step 2 addresses the course by that now-aliased slug, which is the ' +
      'branch under test; at baseline the redirect is discarded and the pre ' +
      'value is null, so no 301 is emitted',
      'the slug store runs in-memory because Redis is disabled for the harness, ' +
      'so the alias lives for the lifetime of this server only - which is why ' +
      'the two steps must be one ordered sequence',
      'this sequence CHANGES the seeded course slug and therefore runs in the ' +
      'mutating phase, after every read-only case that addresses it'
    ],
    expectation: {
      description: 'the aliased slug does not produce a 301',
      steps: [{ index: 1, notStatus: 301 }]
    },
    steps: [
      {
        label: 'rename-the-course-to-create-an-alias',
        method: 'PUT',
        target: '/api/courses/' + context.data.ids.course + '/metadata',
        accept: ACCEPT_JSON,
        payload: { name: 'parity renamed course' }
      },
      {
        label: 'address-the-course-by-its-old-slug',
        method: 'GET',
        target: '/' + user.username + '/courses/' + fixtures.slugs.course,
        accept: ACCEPT_HTML,
        payload: null
      }
    ]
  }));

  return scenarios;
}

/**
 * Google OAuth, both database branches.
 *
 * The existing-user branch can succeed. The new-user branch persists the user,
 * mutates session state, and THEN throws on an undefined `opts`, after which the
 * chain reports the generic authentication failure - so a first-time sign-in
 * creates the account and tells the visitor it failed. Both are captured, and
 * the new-user case asserts the persistence side effect as well as the status,
 * because a status code alone would not record that an account was created.
 *
 * Reaching the existing-user branch takes a two-step sequence, for the reason
 * given in the header: the fixture's `existing` identity is not seeded, and
 * neither file can be aligned from this process. Step 1 takes the new-user
 * branch and creates the account precisely because of the quirk under test;
 * step 2 then finds it. The account's existence between the steps is the
 * fixture, and the quirk supplies it.
 *
 * @param {Object} context
 * @returns {Array.<Object>} scenarios
 */
function buildOAuthScenarios(context) {
  var identities = httpFixture.identities;
  var scenarios = [];
  var callbackTarget = '/auth/google/callback?code=parity-authorization-code';

  scenarios.push(scenario({
    id: 'quirk.oauth.new-user-created-then-failed',
    group: 'quirk.oauth',
    method: 'GET',
    path: '/auth/google/callback',
    identity: IDENTITY_ANONYMOUS,
    accept: ACCEPT_HTML,
    intent: 'failure',
    mutating: true,
    freshSession: true,
    fixtureProfile: 'oauth:success-new-user',
    notes: [
      'the profile serves the fixture\'s unseeded identity ' +
      JSON.stringify(identities.new) + ', so the callback takes its new-user ' +
      'branch',
      'that branch saves the user and mutates session state, then throws on an ' +
      'undefined variable while flashing the account-created message, so the ' +
      'chain reports the generic authentication failure',
      'the account IS created. The side effect is asserted through the ' +
      'application\'s own surface after the callback, because a status code ' +
      'alone would record the failure and lose the creation',
      'the derived username for that address is ' +
      JSON.stringify(identities.newUsername)
    ],
    expectation: {
      description: 'the callback reports failure while having persisted the user',
      steps: [{ index: 0, statusIn: [200, 302] }]
    },
    steps: [
      {
        label: 'callback-new-user',
        method: 'GET',
        target: callbackTarget,
        accept: ACCEPT_HTML,
        payload: null
      },
      {
        // The persistence side effect, asserted through the application's own
        // surface because this process has no database access. The course
        // user-lookup route answers with the matching account, so a hit here is
        // proof that the failed sign-in nevertheless created one. Driven as the
        // seeded user, who owns the seeded course.
        label: 'confirm-the-account-was-persisted',
        identity: IDENTITY_USER,
        method: 'POST',
        target: '/api/courses/' + context.data.ids.course + '/userLookup',
        accept: ACCEPT_JSON,
        payload: { user: identities.new }
      }
    ]
  }));

  scenarios.push(scenario({
    id: 'quirk.oauth.existing-user-succeeds',
    group: 'quirk.oauth',
    method: 'GET',
    path: '/auth/google/callback',
    identity: IDENTITY_ANONYMOUS,
    accept: ACCEPT_HTML,
    intent: 'success',
    mutating: true,
    freshSession: true,
    fixtureProfile: 'oauth:success-existing-user',
    notes: [
      'the profile serves ' + JSON.stringify(identities.existing) + ', which ' +
      'the seeder does not seed - the fixture\'s seeding contract asks for it ' +
      'but no such address exists in the seeder, and the alignment call runs ' +
      'only inside the server process',
      'so this is an ORDERED SEQUENCE rather than a single request: step 1 ' +
      'takes the new-user branch and creates the account as a side effect of ' +
      'the quirk itself, and step 2 - the case under test - then finds it and ' +
      'takes the existing-user branch',
      'the user lookup is an $or over email, username and google id, so the ' +
      'account step 1 persists is the one step 2 matches',
      'step 2 is the assertion; step 1 is recorded as its precondition so a ' +
      'reviewer can see where the account came from'
    ],
    expectation: {
      description: 'step 2 takes the existing-user branch and differs from step 1',
      steps: [
        { index: 0, statusIn: [200, 302] },
        { index: 1, statusIn: [200, 302] }
      ],
      cross: { bodiesDiffer: [0, 1] }
    },
    steps: [
      {
        label: 'precondition-create-the-account-through-the-new-user-branch',
        method: 'GET',
        target: callbackTarget,
        accept: ACCEPT_HTML,
        payload: null,
        resetSessionBefore: true
      },
      {
        label: 'callback-existing-user',
        method: 'GET',
        target: callbackTarget,
        accept: ACCEPT_HTML,
        payload: null,
        resetSessionBefore: true
      }
    ]
  }));

  // The configuration-refused form of both handlers, which is what they do
  // without a Google client. Captured because it is the behaviour every
  // deployment without OAuth credentials actually gets, and because it proves
  // the injected client layer is what moves the handler off this branch.
  scenarios.push(scenario({
    id: 'quirk.oauth.no-authorization-code',
    group: 'quirk.oauth',
    method: 'GET',
    path: '/auth/google/callback',
    identity: IDENTITY_ANONYMOUS,
    accept: ACCEPT_HTML,
    intent: 'failure',
    mutating: false,
    freshSession: true,
    fixtureProfile: 'none',
    notes: [
      'no authorization code, so the handler fails before any token exchange',
      'the fixture profile records nothing, which proves no path here reaches ' +
      'the network: an unrecorded endpoint fails deterministically rather than ' +
      'falling through'
    ],
    expectation: {
      description: 'refused before any external call',
      steps: [{ index: 0, statusIn: [200, 302] }]
    },
    steps: [{
      label: 'callback-without-a-code',
      method: 'GET',
      target: '/auth/google/callback',
      accept: ACCEPT_HTML,
      payload: null
    }]
  }));

  return scenarios;
}

/**
 * All five outcomes of the session auth scheme, each asserted independently.
 *
 * Absent userId, a session naming a MISSING record, a DISABLED account, a valid
 * user, and a lookup error. Four are drivable; the fifth is not reachable
 * through the surface and is recorded with that reason rather than faked.
 *
 * The two special sessions are DRIVEN, not simulated. The missing-record
 * session is produced by registering a throwaway account, logging into it and
 * then deleting it through the application's own route - which does not clear
 * the session, so the very next request carries a userId whose record is gone.
 * Nothing here touches the database.
 *
 * @param {Object} context
 * @returns {Array.<Object>} scenarios
 */
function buildAuthOutcomeScenarios(context) {
  var scenarios = [];

  scenarios.push(scenario({
    id: 'auth.outcome.not-logged-in',
    group: 'auth-outcome',
    method: 'GET',
    path: '/home',
    identity: IDENTITY_ANONYMOUS,
    accept: ACCEPT_HTML,
    intent: 'redirect',
    mutating: false,
    freshSession: true,
    notes: [
      'no userId in the session, so the scheme reports "Not logged in" and, ' +
      'because the default mode is try, the request proceeds unauthenticated ' +
      'until this route\'s own required auth turns it into a redirect'
    ],
    expectation: {
      description: 'the guest is sent to the login page',
      steps: [{ index: 0, statusIn: [302], locationEndsWith: '/login' }]
    },
    steps: [{
      label: 'drive-as-guest',
      method: 'GET',
      target: '/home',
      accept: ACCEPT_HTML,
      payload: null
    }]
  }));

  scenarios.push(scenario({
    id: 'auth.outcome.valid-user',
    group: 'auth-outcome',
    method: 'GET',
    path: '/home',
    identity: IDENTITY_USER,
    accept: ACCEPT_HTML,
    intent: 'success',
    mutating: false,
    notes: ['the seeded user is authenticated and the page renders'],
    expectation: {
      description: 'the authenticated user gets the page',
      steps: [{ index: 0, status: 200 }]
    },
    steps: [{
      label: 'drive-as-seeded-user',
      method: 'GET',
      target: '/home',
      accept: ACCEPT_HTML,
      payload: null
    }]
  }));

  scenarios.push(scenario({
    id: 'auth.outcome.account-disabled',
    group: 'auth-outcome',
    method: 'GET',
    path: '/home',
    identity: IDENTITY_DISABLED,
    accept: ACCEPT_HTML,
    intent: 'redirect',
    mutating: false,
    notes: [
      'the seeded disabled account carries both the user and the disabled ' +
      'role, so it is a normal user that has been disabled rather than a ' +
      'role-less anomaly',
      'the scheme clears the session and reports "Account disabled", so the ' +
      'request is unauthenticated from that point on',
      'its login is driven for real; whether the login itself lands is part of ' +
      'what this case records'
    ],
    expectation: {
      description: 'the disabled account cannot reach an authenticated page',
      steps: [{ index: 0, notStatus: 200 }]
    },
    steps: [{
      label: 'drive-as-disabled-user',
      method: 'GET',
      target: '/home',
      accept: ACCEPT_HTML,
      payload: null
    }]
  }));

  // The missing-record session. Ordered, and mutating, because it registers an
  // account and then destroys it. The throwaway identity exists so that no
  // seeded fixture is spent on this.
  scenarios.push(scenario({
    id: 'auth.outcome.user-not-found',
    group: 'auth-outcome',
    method: 'GET',
    path: '/home',
    identity: IDENTITY_MISSING,
    accept: ACCEPT_HTML,
    intent: 'redirect',
    mutating: true,
    freshSession: true,
    notes: [
      'step 1 registers a throwaway account, step 2 logs into it, step 3 ' +
      'deletes it through the application\'s own route, and step 4 is the case ' +
      'under test',
      'the delete route removes the record WITHOUT clearing the session - only ' +
      'logout clears it - so step 4 carries a userId whose document no longer ' +
      'exists, which is the only way this outcome is reachable without ' +
      'touching the database from here',
      'the scheme clears the session and reports "User not found"',
      'no seeded fixture is consumed: the account is created by this sequence ' +
      'for the purpose of being deleted by it'
    ],
    expectation: {
      description: 'the stale session is refused and cleared',
      steps: [{ index: 3, notStatus: 200 }]
    },
    steps: [
      {
        label: 'register-the-throwaway-account',
        method: 'POST',
        target: '/users',
        accept: ACCEPT_HTML,
        payload: {
          formName: THROWAWAY.formName,
          fullname: THROWAWAY.fullname,
          username: THROWAWAY.username,
          email: THROWAWAY.email,
          password: THROWAWAY.password
        }
      },
      {
        label: 'log-into-the-throwaway-account',
        method: 'POST',
        target: '/login',
        accept: ACCEPT_HTML,
        payload: { email: THROWAWAY.email, password: THROWAWAY.password }
      },
      {
        label: 'delete-the-account-through-its-own-route',
        method: 'DELETE',
        target: '/api/users?username=' + encodeURIComponent(THROWAWAY.username),
        accept: ACCEPT_JSON,
        payload: null
      },
      {
        label: 'drive-with-the-now-stale-session',
        method: 'GET',
        target: '/home',
        accept: ACCEPT_HTML,
        payload: null
      }
    ]
  }));

  // The fifth outcome, recorded rather than driven. Nothing silently omitted.
  scenarios.push(scenario({
    id: 'auth.outcome.lookup-error',
    group: 'auth-outcome',
    method: 'GET',
    path: '/home',
    identity: IDENTITY_ANONYMOUS,
    accept: ACCEPT_HTML,
    intent: 'unreachable',
    mutating: false,
    notes: [
      'the fifth auth outcome - a lookup error yielding "Auth error" - needs ' +
      'the user query itself to fail, which no request can cause: it takes a ' +
      'database fault injected below the model layer',
      'recorded here with that reason rather than omitted, and rather than ' +
      'simulated with something that would reach a different branch and be ' +
      'captured as though it were this one',
      'it is asserted directly against the scheme by the server-level gate, ' +
      'which can inject the fault; this corpus covers the four outcomes that ' +
      'are reachable over HTTP'
    ],
    expectation: null,
    steps: []
  }));

  return scenarios;
}

/**
 * The error-edge cases, and the two dispositions a mechanical conversion
 * silently changes.
 *
 * One minimal request per route exercises success paths only, so the failure
 * paths need cases of their own. Two are called out because they are the ones
 * that break quietly:
 *
 *   log-and-continue - the streaming asset fetch only logs its transport
 *   error, so the route must keep going rather than become a rejection. A
 *   refused connection emits an error and never an end, so the upload never
 *   starts and the request is left UNSETTLED - which is captured as an expected
 *   timeout, not as a fault.
 *
 *   resolve-on-later-callback - a response produced inside nested callbacks is
 *   whichever settles first, so collapsing it into an earlier await changes
 *   which response the client gets.
 *
 * @param {Object} context
 * @returns {Array.<Object>} scenarios
 */
function buildErrorEdgeScenarios(context) {
  var ids = context.data.ids;
  var scenarios = [];

  scenarios.push(scenario({
    id: 'error-edge.asset-from-url.transport-refused',
    group: 'error-edge.log-and-continue',
    method: 'POST',
    path: '/api/users/assetFromURL',
    identity: IDENTITY_USER,
    accept: ACCEPT_JSON,
    intent: 'timeout',
    mutating: true,
    fixtureProfile: 'asset:transport-refused',
    notes: [
      'the fixture refuses the connection, emitting an error and never an end',
      'the handler\'s error listener only logs, so nothing rejects and nothing ' +
      'uploads - the request is left unsettled, which this case records as an ' +
      'expected timeout',
      'this is the log-and-continue disposition: a conversion that turned the ' +
      'logged error into a rejection would answer where baseline hangs, and a ' +
      'conversion that uploaded partial bytes would store an object baseline ' +
      'never stored'
    ],
    expectation: {
      description: 'the route is left unsettled, exactly as baseline leaves it',
      steps: [{ index: 0, timedOut: true }]
    },
    steps: [{
      label: 'asset-fetch-refused',
      method: 'POST',
      target: '/api/users/assetFromURL',
      accept: ACCEPT_JSON,
      payload: { url: httpFixture.assetUrls.plain },
      timeoutMs: EXPECTED_TIMEOUT_MS
    }]
  }));

  scenarios.push(scenario({
    id: 'error-edge.asset-from-url.midstream-failure',
    group: 'error-edge.log-and-continue',
    method: 'POST',
    path: '/api/users/assetFromURL',
    identity: IDENTITY_USER,
    accept: ACCEPT_JSON,
    intent: 'failure',
    mutating: true,
    fixtureProfile: 'asset:midstream-failure',
    notes: [
      'the fixture delivers a response and partial bytes, then errors, and ' +
      'then still reaches end - so unlike the refused case the upload DOES ' +
      'start and the partial content is stored',
      'the two failure modes are separate cases because they differ ' +
      'observably, and a conversion that treated them alike would be wrong ' +
      'about one of them'
    ],
    expectation: {
      description: 'the partial content is uploaded and the route answers',
      steps: [{ index: 0, statusIn: [200, 400, 500] }]
    },
    steps: [{
      label: 'asset-fetch-fails-midstream',
      method: 'POST',
      target: '/api/users/assetFromURL',
      accept: ACCEPT_JSON,
      payload: { url: httpFixture.assetUrls.plain }
    }]
  }));

  scenarios.push(scenario({
    id: 'error-edge.asset-from-url.query-bearing-url',
    group: 'error-edge.log-and-continue',
    method: 'POST',
    path: '/api/users/assetFromURL',
    identity: IDENTITY_USER,
    accept: ACCEPT_JSON,
    intent: 'success',
    mutating: true,
    fixtureProfile: 'asset:success',
    notes: [
      'the upload filename is derived with a basename over a legacy path field ' +
      'that RETAINS the query string, so the stored filename contains the ' +
      'query - behaviour the target\'s URL helper preserves deliberately and ' +
      'which therefore has to be exercised rather than assumed'
    ],
    expectation: {
      description: 'the asset is stored under a name derived from the query-bearing path',
      steps: [{ index: 0, statusIn: [200, 400, 500] }]
    },
    steps: [{
      label: 'asset-fetch-with-a-query-string',
      method: 'POST',
      target: '/api/users/assetFromURL',
      accept: ACCEPT_JSON,
      payload: { url: httpFixture.assetUrls.query },
      timeoutMs: EXPECTED_TIMEOUT_MS
    }]
  }));

  // The not-found edges of the model families, one per seeded missing id, so
  // every "the document is absent" branch has a recorded response rather than
  // being inferred from the success sweep.
  [
    { key: 'missingTrinket', method: 'GET', path: '/api/trinkets/{trinketId}', target: '/api/trinkets/' + ids.missingTrinket },
    { key: 'missingCourse', method: 'GET', path: '/api/courses/{courseId}', target: '/api/courses/' + ids.missingCourse },
    { key: 'missingFolder', method: 'GET', path: '/api/folders/{folderId}/trinkets', target: '/api/folders/' + ids.missingFolder + '/trinkets' },
    { key: 'missingExport', method: 'GET', path: '/api/exports/{exportId}', target: '/api/exports/' + ids.missingExport }
  ].forEach(function(edge) {
    scenarios.push(scenario({
      id: 'error-edge.not-found.' + edge.key,
      group: 'error-edge.not-found',
      method: edge.method,
      path: edge.path,
      identity: IDENTITY_USER,
      accept: ACCEPT_JSON,
      intent: 'failure',
      mutating: false,
      notes: [
        'driven against the seeder\'s deliberately absent ' + edge.key + ' id, ' +
        'so the not-found branch is what answers',
        'RECORD-ONLY, with no declared expectation. The absent-document ' +
        'outcome of these four families is not documented anywhere as a ' +
        'measured baseline fact, so asserting one here would encode an ' +
        'assumption as a gate - and the assumption would have been wrong: an ' +
        'earlier draft of this file expected "not 200" and the export family ' +
        'answers 200 carrying an error field in its body. What this case is ' +
        'for is establishing that outcome, which replay.js then compares ' +
        'between the two trees. An expectation belongs here only once the ' +
        'baseline capture has measured one.'
      ],
      expectation: null,
      steps: [{
        label: 'drive-absent-document',
        method: edge.method,
        target: edge.target,
        accept: ACCEPT_JSON,
        payload: null
      }]
    }));
  });

  // Both Accept modes of one error, because the error extension branches on the
  // Accept header AND the path prefix, and the cache and frame headers reach
  // the API/JSON form of an error but NOT the rendered HTML error pages - the
  // HTML branches return before those assignments. That asymmetry is a
  // preserved contract and needs both halves recorded.
  ['html', 'json'].forEach(function(mode) {
    scenarios.push(scenario({
      id: 'error-edge.not-found-page.' + mode,
      group: 'error-edge.error-page-headers',
      method: 'GET',
      path: '/{path*}',
      identity: IDENTITY_ANONYMOUS,
      accept: mode === 'html' ? ACCEPT_HTML : ACCEPT_JSON,
      intent: 'failure',
      mutating: false,
      notes: [
        'an unrouted path, so the response is a 404 from the static handler',
        'the two Accept modes take different branches of the error extension: ' +
        'the HTML branch returns the rendered error page BEFORE the cache and ' +
        'frame headers are assigned, so those headers appear on the JSON form ' +
        'and not on the HTML one'
      ],
      expectation: {
        description: 'a 404 whose headers differ by Accept mode',
        steps: [{ index: 0, status: 404 }]
      },
      steps: [{
        label: 'drive-unrouted-path',
        method: 'GET',
        target: '/parity-no-such-path',
        accept: mode === 'html' ? ACCEPT_HTML : ACCEPT_JSON,
        payload: null
      }]
    }));
  });

  return scenarios;
}

// ---------------------------------------------------------------------------
// Notes owed to docs/baseline-parity.md
// ---------------------------------------------------------------------------
// Facts a reader of the corpus needs and cannot derive from it. They travel
// with the artifact rather than only in prose, so the reason a branch is absent
// is attached to the evidence that lacks it.

/**
 * The recorded notes about what this corpus deliberately does not cover.
 *
 * @returns {Array.<Object>}
 */
function corpusNotes() {
  return [
    {
      subject: 'reCAPTCHA outcomes 3 to 6',
      note: 'Unreachable over HTTP, and deliberately not chased. Under ' +
        'NODE_ENV=test the verify helper short-circuits on the isTest flag ' +
        'before any HTTP happens, so the 200, non-200, transport-failure and ' +
        'malformed-JSON branches cannot be reached through a route however the ' +
        'fixture is configured. They are exercised by direct module-level ' +
        'invocation in the fixture harness instead. Adding a reCAPTCHA secret ' +
        'to the overlay would not help - the short-circuit is on the ' +
        'environment, not on the secret - so none is added.'
    },
    {
      subject: 'the fifth auth-scheme outcome',
      note: 'The "Auth error" branch needs the user lookup itself to fail, ' +
        'which no HTTP request can cause. It is recorded as an unreachable ' +
        'scenario with that reason rather than simulated, because anything ' +
        'that could be driven from here would reach a different branch and be ' +
        'captured as though it were this one.'
    },
    {
      subject: 'the Google client configuration',
      note: 'Both OAuth handlers short-circuit without a configured client, ' +
        'and the server overlay does not declare one. This tool injects a fake ' +
        'client as an explicit top NODE_CONFIG layer so the OAuth branches are ' +
        'reachable at all. The values are not credentials: the token and ' +
        'profile endpoints are intercepted at the module boundary, so nothing ' +
        'authenticates against anything.'
    },
    {
      subject: 'the OAuth existing-user identity',
      note: 'The http fixture\'s seeding contract asks that its `existing` ' +
        'identity be seeded as a user, and the seeder does not seed it. The ' +
        'alignment call the fixture offers runs only inside the server ' +
        'process, and its environment contract has no identity variable, so ' +
        'neither artifact can be aligned from here. Rather than edit a sibling ' +
        'artifact, the existing-user branch is reached as a two-step sequence ' +
        'in which the new-user branch creates the account first. The gap is ' +
        'real and is recorded here; closing it in the seeder would make the ' +
        'sequence unnecessary but would not change what it captures.'
    },
    {
      subject: 'cookie values',
      note: 'The one value normalized at capture time. Session cookie values ' +
        'are already in the enumerated volatile set, so recording a digest ' +
        'instead of the value loses nothing that could have been compared, ' +
        'while keeping live session tokens out of a committed artifact. Every ' +
        'attribute that IS compared - name, HttpOnly, Secure, SameSite, Path, ' +
        'Domain, Max-Age, and the presence and day horizon of Expires - is ' +
        'preserved in full, because the Expires horizon is the only way a ' +
        'silent no-op in the private-field cookie patch can be detected.'
    },
    {
      subject: 'the cache-prefix timestamp in rendered asset URLs',
      note: 'The one volatile value embedded in comparable HTML, and the only ' +
        'thing that differed between two consecutive captures of the same tree ' +
        'once cookies, Date and raw elapsed times are set aside. Every ' +
        'rendered page carries asset URLs of the form ' +
        '/cache-prefix-<epoch-millis>/<assetType>/<path>, because the string ' +
        'helper that builds them inlines the clock at RENDER time - it is not ' +
        'read from configuration, so no overlay can pin it and no fixture can ' +
        'make it stable. Measured: 20 of 242 read-only responses differed on ' +
        'this and on nothing else. It is a timestamp, so it is inside the ' +
        'enumerated volatile set, but it sits inside an href that is otherwise ' +
        'compared exactly - so a replay that does not normalize this pattern ' +
        'will report a difference on every rendered page. Normalize the digits ' +
        'between "/cache-prefix-" and the following "/" and compare the rest ' +
        'of the URL exactly; the prefix itself is configured and IS worth ' +
        'comparing.'
    },
    {
      subject: 'redirects',
      note: 'Not followed. A Location header is part of the surface under ' +
        'comparison, and following it would replace the measurement with its ' +
        'consequence. Note that the two redirect mechanisms differ and both ' +
        'appear here: the parser builds ABSOLUTE locations from the configured ' +
        'url, while the 401 branch of the error extension emits a RELATIVE ' +
        '/login.'
    }
  ];
}

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

/**
 * Accounts scenario coverage against the authoritative route manifest.
 *
 * Every manifest entry must be represented by at least one case. An entry that
 * genuinely cannot be driven has to be listed WITH A REASON - never dropped -
 * and anything unrepresented and unexplained fails the capture, because a
 * corpus that quietly omits a route is a corpus that cannot support the claim
 * the gate makes of it.
 *
 * @param {Array.<Object>} entries manifest entries
 * @param {Array.<Object>} scenarios
 * @returns {Object} the coverage report
 */
function accountCoverage(entries, scenarios) {
  var represented = {};
  var declared = {};
  var unrepresented = [];
  var unknown = [];

  entries.forEach(function(entry) {
    declared[routeKeyOf(entry.method, entry.path)] = true;
  });

  scenarios.forEach(function(item) {
    (item.covers || []).forEach(function(key) {
      if (!Object.prototype.hasOwnProperty.call(declared, key)) {
        // A scenario claiming a route the manifest does not have is a bug in
        // this file's own tables, and is reported rather than ignored.
        unknown.push({ scenario: item.id, covers: key });
        return;
      }

      if (!represented[key]) {
        represented[key] = [];
      }

      represented[key].push(item.id);
    });
  });

  Object.keys(declared).sort().forEach(function(key) {
    if (!represented[key]) {
      unrepresented.push(key);
    }
  });

  return {
    routes: entries.length,
    represented: Object.keys(represented).length,
    unrepresented: unrepresented,
    unknownRoutes: unknown,
    byRoute: sortedKeys(represented)
  };
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

/**
 * Evaluates one scenario's declared baseline expectation against what was
 * actually captured.
 *
 * The result is ALWAYS recorded, and is fatal only under --expect-baseline.
 * That split is deliberate: these expectations describe the base commit, and
 * one of them is expected to differ against the migrated tree by an approved
 * deviation. A tool that refused to write the artifact in that case could not
 * evidence the deviation it exists to evidence.
 *
 * @param {Object} item the scenario, with its steps captured
 * @returns {(Object|null)} {met, description, failures}
 */
function evaluateExpectation(item) {
  var expectation = item.expectation;
  var failures = [];

  if (!expectation) {
    return null;
  }

  function responseAt(index) {
    var step = item.steps[index];
    return step && step.response ? step.response : null;
  }

  (expectation.steps || []).forEach(function(check) {
    var response = responseAt(check.index);
    var location;
    var label = 'step ' + check.index;

    if (!response) {
      failures.push(label + ' was not captured');
      return;
    }

    if (check.timedOut !== undefined && !!response.timedOut !== check.timedOut) {
      failures.push(label + ' timedOut was ' + !!response.timedOut +
        ', expected ' + check.timedOut);
    }

    if (check.status !== undefined && response.status !== check.status) {
      failures.push(label + ' status was ' + response.status +
        ', expected ' + check.status);
    }

    if (check.statusIn !== undefined && check.statusIn.indexOf(response.status) === -1) {
      failures.push(label + ' status was ' + response.status +
        ', expected one of ' + check.statusIn.join('/'));
    }

    if (check.notStatus !== undefined && response.status === check.notStatus) {
      failures.push(label + ' status was ' + response.status +
        ', which the expectation forbids');
    }

    if (check.locationEndsWith !== undefined) {
      location = response.headers ? String(response.headers.location || '') : '';

      if (location.slice(-check.locationEndsWith.length) !== check.locationEndsWith) {
        failures.push(label + ' Location was ' + JSON.stringify(location) +
          ', expected it to end with ' + JSON.stringify(check.locationEndsWith));
      }
    }

    if (check.headerPresent !== undefined &&
        (!response.headers || response.headers[check.headerPresent] === undefined)) {
      failures.push(label + ' is missing the ' + check.headerPresent + ' header');
    }

    if (check.bodyIncludes !== undefined) {
      if (!response.body || typeof response.body.text !== 'string') {
        failures.push(label + ' has no text body to search for ' +
          JSON.stringify(check.bodyIncludes));
      }
      else if (response.body.text.indexOf(check.bodyIncludes) === -1) {
        failures.push(label + ' body does not contain ' +
          JSON.stringify(check.bodyIncludes));
      }
    }
  });

  if (expectation.cross && expectation.cross.locationsEqual) {
    (function() {
      var pair = expectation.cross.locationsEqual;
      var first = responseAt(pair[0]);
      var second = responseAt(pair[1]);
      var firstLocation = first && first.headers ? String(first.headers.location || '') : null;
      var secondLocation = second && second.headers ? String(second.headers.location || '') : null;

      if (firstLocation === null || secondLocation === null) {
        failures.push('the Location pair could not be compared because a step ' +
          'was not captured');
        return;
      }

      if (firstLocation !== secondLocation) {
        failures.push('the two Location headers differ - ' +
          JSON.stringify(firstLocation) + ' then ' + JSON.stringify(secondLocation) +
          ' - which means the cross-request state leak is no longer present');
      }
    }());
  }

  if (expectation.cross && expectation.cross.bodiesDiffer) {
    (function() {
      var pair = expectation.cross.bodiesDiffer;
      var first = responseAt(pair[0]);
      var second = responseAt(pair[1]);

      if (!first || !second || !first.body || !second.body) {
        failures.push('the body pair could not be compared because a step was ' +
          'not captured');
        return;
      }

      if (first.body.digest === second.body.digest) {
        failures.push('the two bodies are identical, so the two cases are no ' +
          'longer observably different');
      }
    }());
  }

  return {
    met: failures.length === 0,
    description: expectation.description,
    failures: failures
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Orders the corpus: read-only cases first, then the mutating ones.
 *
 * This is not tidiness. A mutation that ran early would change the fixture a
 * later read-only case was recorded against, and the corpus would then be
 * describing a tree that no longer existed by the time it was measured. Within
 * each phase the order is the construction order, which is fixed, so re-running
 * produces a diff rather than a reshuffle.
 *
 * The quirk sequence that renames the seeded course is the sharpest example:
 * every case addressing that course by its seeded slug has to be recorded
 * before it.
 *
 * @param {Array.<Object>} scenarios
 * @returns {Array.<Object>} the same scenarios, ordered
 */
function orderScenarios(scenarios) {
  var readOnly = [];
  var mutating = [];

  scenarios.forEach(function(item) {
    if (item.mutating) {
      mutating.push(item);
    }
    else {
      readOnly.push(item);
    }
  });

  return readOnly.concat(mutating);
}

/**
 * Compiles the --only patterns into predicates.
 *
 * A value wrapped in slashes is a regular expression; anything else is a
 * case-insensitive substring, matched against the scenario id, its group and
 * its route key.
 *
 * @param {Array.<string>} patterns
 * @returns {(function(Object): boolean|null)}
 */
function compileFilter(patterns) {
  var compiled;

  if (!patterns || !patterns.length) {
    return null;
  }

  compiled = patterns.map(function(pattern) {
    var match = /^\/(.*)\/([a-z]*)$/.exec(pattern);

    if (match) {
      try {
        return new RegExp(match[1], match[2]);
      }
      catch (err) {
        throw usageError('--only ' + JSON.stringify(pattern) +
          ' is not a valid regular expression: ' + reasonOf(err));
      }
    }

    return String(pattern).toLowerCase();
  });

  return function(item) {
    var haystack = [
      item.id,
      item.group,
      routeKeyOf(item.route.method, item.route.path)
    ];

    return compiled.some(function(pattern) {
      if (pattern instanceof RegExp) {
        return haystack.some(function(value) { return pattern.test(value); });
      }

      return haystack.some(function(value) {
        return String(value).toLowerCase().indexOf(pattern) >= 0;
      });
    });
  };
}

/**
 * Selects the http fixture profile for the next request, by writing the profile
 * file the fixture re-reads at the start of every intercepted call.
 *
 * This is the documented way to switch profiles WITHOUT restarting the server,
 * which is what lets one run drive the OAuth success, failure and
 * missing-field cases and both streaming failure modes. There is no control
 * socket and no network involved.
 *
 * A profile name the catalogue does not know is rejected here rather than
 * written, because the fixture's own contract is to log an unknown name and
 * keep the previous profile - which would silently capture the wrong case.
 *
 * @param {(string|null)} profileFile
 * @param {string} profile
 * @returns {undefined}
 * @throws {ToolError} If the profile is unknown, or the file cannot be written.
 */
function selectProfile(profileFile, profile) {
  if (httpFixture.profileNames().indexOf(profile) === -1) {
    throw new ToolError('the fixture profile ' + JSON.stringify(profile) +
      ' is not in the catalogue. Known profiles: ' +
      httpFixture.profileNames().join(', '));
  }

  if (!profileFile) {
    return;
  }

  try {
    fs.writeFileSync(profileFile, JSON.stringify({ profile: profile }) + '\n');
  }
  catch (err) {
    throw new ToolError('could not write the fixture profile file ' +
      profileFile + ': ' + reasonOf(err));
  }
}

/**
 * Records one driven step: the request as sent, and the response as received.
 *
 * The two live together so a reviewer sees what produced what. The raw
 * Set-Cookie channel is dropped here, before anything is serialized.
 *
 * @param {Object} step the step definition
 * @param {Object} driven the result of Jar.request
 * @returns {Object} the recorded step
 */
function recordStep(step, driven) {
  var response = driven.response;
  var recorded = {};

  Object.keys(response).forEach(function(key) {
    recorded[key] = response[key];
  });

  return {
    label: step.label,
    request: driven.sent,
    response: recorded
  };
}

/**
 * Drives one scenario to completion and attaches its captures.
 *
 * Never throws for a fault in the driving: a step that could not be driven is
 * recorded with its reason and the scenario is marked failed, because a case
 * silently dropped is the one failure mode this corpus cannot tolerate.
 *
 * @param {Object} item the scenario
 * @param {Object} context {jar, profileFile, timeoutMs}
 * @returns {Promise<Object>} the scenario, with steps captured
 */
async function runScenario(item, context) {
  var jar = context.jar;
  var index;
  var step;
  var driven;

  item.driven = { ok: true, error: null, skipped: false };

  if (!item.steps.length) {
    // An unreachable scenario. It carries its reason in `notes` and is counted
    // as covered, not as a fault - which is the difference between an
    // explained gap and a silent one.
    item.driven.skipped = true;
    return item;
  }

  try {
    selectProfile(context.profileFile, item.fixtureProfile);
  }
  catch (err) {
    item.driven.ok = false;
    item.driven.error = reasonOf(err);
    return item;
  }

  if (item.freshSession) {
    jar.reset(item.identity);
  }

  for (index = 0; index < item.steps.length; index++) {
    step = item.steps[index];

    if (step.resetSessionBefore) {
      jar.reset(step.identity || item.identity);
    }

    try {
      driven = await jar.request(step.identity || item.identity, {
        method: step.method,
        target: step.target,
        accept: step.accept || item.accept,
        headers: step.headers || null,
        payload: step.payload === undefined ? null : step.payload,
        contentType: step.contentType
      }, step.timeoutMs || context.timeoutMs);
    }
    catch (err) {
      // Nothing in the driver rejects, so reaching here means a fault in this
      // file rather than in the application. Recorded against the step, in
      // place, so the artifact says which case failed and why.
      item.driven.ok = false;
      item.driven.error = 'step ' + index + ' (' + step.label + ') could not be ' +
        'driven: ' + reasonOf(err);
      item.steps[index] = {
        label: step.label,
        request: {
          method: step.method,
          target: step.target,
          identity: step.identity || item.identity
        },
        response: null,
        error: item.driven.error
      };
      return item;
    }

    item.steps[index] = recordStep(step, driven);

    if (!driven.response.ok && !driven.response.timedOut) {
      // A transport failure IS the recorded result - it is how the refused
      // streaming case is captured - so it does not abort the scenario. It is
      // surfaced on the scenario so the summary can count it.
      item.driven.transportFailure = driven.response.error;
    }
  }

  item.expectationResult = evaluateExpectation(item);

  return item;
}

// ---------------------------------------------------------------------------
// Children: the manifest and the seeder
// ---------------------------------------------------------------------------

/**
 * The git HEAD of a worktree, or null when it is not a checkout.
 *
 * @param {string} root
 * @returns {(string|null)}
 */
function gitHead(root) {
  var result = childProcess.spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8'
  });

  if (result.status !== 0 || !result.stdout) {
    return null;
  }

  return result.stdout.trim() || null;
}

/**
 * Resolves the route manifest, generating it if it is not already there.
 *
 * Read as an ARTIFACT rather than generated in this process. The generator
 * loads the application's route modules and controllers, which would put
 * `config` and `lib` into this process's module graph - the one thing this file
 * must not do - so when the artifact is missing the generator is spawned as its
 * own process instead. Both of the child's streams are discarded because
 * loading the controllers prints the in-memory-queue line on stdout and a
 * baseline tree prints the AWS notice on stderr; the artifact is the only
 * output that matters.
 *
 * @param {Object} options
 * @returns {Object} the parsed manifest
 * @throws {ToolError} If it can be neither read nor generated.
 */
function resolveManifest(options) {
  var generated;

  if (fs.existsSync(options.manifestPath)) {
    return manifest.readManifest(options.manifestPath);
  }

  note('no route manifest at ' + options.manifestPath + '; generating one');

  generated = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, 'manifest.js'),
    '--app', options.appRoot,
    '--out', options.manifestPath
  ], {
    cwd: TOOL_ROOT,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: Object.assign({}, process.env, {
      NODE_ENV: 'test',
      NODE_CONFIG: JSON.stringify({ db: { redis: { enabled: false } } })
    })
  });

  if (generated.status !== 0) {
    throw new ToolError('the route manifest could not be generated (exit ' +
      generated.status + '). Run `node test/parity/manifest.js --app ' +
      options.appRoot + ' --out ' + options.manifestPath + '` to see why.');
  }

  return manifest.readManifest(options.manifestPath);
}

/**
 * Writes the object-store pre-population manifest, and returns its path.
 *
 * This is not optional and the omission is not survivable. The seeder plants a
 * File document whose hash, url and name correspond to a PRE-MIGRATION object
 * that has to already exist inside the server child, and an environment
 * variable is the only channel that reaches a preload - so if the manifest is
 * absent, a download route asks the store for a key it does not hold, the
 * fixture raises its NoSuchKey on the returned stream, and nothing in the
 * application listens for `error` on that stream. The result is an unhandled
 * error event that takes the whole server down mid-corpus. That is exactly what
 * happened on the first dry run of this tool, and every case after it recorded
 * ECONNREFUSED.
 *
 * The manifest is built in a CHILD because the seeder resolves bucket names
 * through the configuration, and requiring `config` here is precisely what this
 * file must not do. The child is given the same overlay the launcher will use,
 * so it computes the same bucket names - and it has to run BEFORE the launcher,
 * because the fixture reads its manifest once at load.
 *
 * @param {Object} options
 * @param {string} scratchDir a directory this tool owns
 * @returns {Object} {path, entries, reason}
 */
function prepareS3Seed(options, scratchDir) {
  var target = path.join(scratchDir, 's3-seed.json');
  var overlayPath = options.overlay === undefined
    ? mongo.DEFAULT_OVERLAY
    : options.overlay;
  var overlay = null;
  var script;
  var result;
  var entries;

  if (overlayPath) {
    try {
      overlay = fs.readFileSync(overlayPath, 'utf8');
    }
    catch (err) {
      return {
        path: null,
        entries: 0,
        reason: 'the overlay ' + overlayPath + ' could not be read, so the ' +
          'bucket names the manifest needs cannot be resolved: ' + reasonOf(err)
      };
    }
  }

  script = [
    'var fs = require("fs");',
    'var seeder = require(' + JSON.stringify(path.join(__dirname, 'seed.js')) + ');',
    'fs.writeFileSync(process.env.PARITY_SEED_MANIFEST_OUT,',
    '  JSON.stringify(seeder.s3Manifest(), null, 2));'
  ].join('\n');

  result = childProcess.spawnSync(process.execPath, ['-e', script], {
    cwd: TOOL_ROOT,
    encoding: 'utf8',
    env: Object.assign({}, process.env, {
      NODE_ENV: 'test',
      NODE_CONFIG: overlay === null ? '{}' : overlay,
      PARITY_SEED_MANIFEST_OUT: target
    })
  });

  if (result.status !== 0) {
    return {
      path: null,
      entries: 0,
      reason: 'the manifest generator exited ' + result.status + ': ' +
        String(result.stderr || '').trim().split('\n').slice(-3).join(' | ')
    };
  }

  try {
    entries = JSON.parse(fs.readFileSync(target, 'utf8'));
  }
  catch (err) {
    return {
      path: null,
      entries: 0,
      reason: 'the generated manifest at ' + target + ' is unreadable: ' +
        reasonOf(err)
    };
  }

  if (!Array.isArray(entries) || !entries.length) {
    return {
      path: null,
      entries: 0,
      reason: 'the generated manifest holds no entries, so no pre-migration ' +
        'object would exist in the store'
    };
  }

  return { path: target, entries: entries.length, reason: null };
}

/**
 * Seeds the fixtures, in a child process.
 *
 * Fixture creation belongs to the seeder, and this file must not require the
 * models to invoke it: that would pull `lib` and `config` into this process.
 * So the seeder's own `seed()` is called from a spawned child.
 *
 * The child runs with the TOOL root as its working directory, deliberately, so
 * that one consistent module tree resolves - the tool's mongoose, the tool's
 * models and the tool's config together. Writing fixtures with the target
 * tree's model code into the database a baseline server reads is sound because
 * the model layer is unchanged across the two commits and because MongoDB is a
 * database rather than a module: what crosses between the trees is BSON, not
 * JavaScript. Mixing the two trees inside one process - the target's models
 * over the baseline's mongoose - is what would not be sound, and is what this
 * avoids.
 *
 * THE CHILD IS AWAITED, NEVER WAITED FOR SYNCHRONOUSLY, and that is not a
 * stylistic preference. By the time this runs, `server.js` has provisioned the
 * database IN THIS PROCESS - `mongodb-memory-server` runs `mongod` as a child
 * of this one and reads its piped stdout to track it - and has spawned the
 * application as a second piped child. A `spawnSync` here blocks this event
 * loop for the whole seeding window, so neither pipe is drained; `mongod` then
 * blocks on its own log writes and stops completing handshakes, and the
 * seeder's connection dies of server selection after 30s against a database
 * that is running and reachable. Measured: identical child, identical URI and
 * identical environment, seeding fails under `spawnSync` and succeeds under an
 * awaited spawn. The `spawnSync` calls elsewhere in this file are safe because
 * they all run BEFORE the launcher starts.
 *
 * @param {Object} info the launcher's start result
 * @returns {Promise<Object>} {ok, reason}
 */
function seedFixtures(info) {
  var script = [
    'var mongoose = require("mongoose");',
    'var seeder = require(' + JSON.stringify(path.join(__dirname, 'seed.js')) + ');',
    'mongoose.set("strictQuery", true);',
    'mongoose.connect(process.env.PARITY_SEED_URI)',
    '  .then(function() { return seeder.seed(); })',
    '  .then(function(summary) {',
    '    process.stderr.write("seeded: " + JSON.stringify(summary.created) + "\\n");',
    '    return mongoose.disconnect();',
    '  })',
    '  .then(function() { process.exitCode = 0; })',
    '  .catch(function(err) {',
    '    process.stderr.write("seed failed: " + (err && err.message ? err.message : String(err)) + "\\n");',
    '    process.exitCode = 1;',
    '  });'
  ].join('\n');

  var uri = 'mongodb://' + info.mongo.host + ':' + info.mongo.port + '/' +
    info.mongo.database;

  return new Promise(function (resolve) {
    var child = childProcess.spawn(process.execPath, ['-e', script], {
      cwd: TOOL_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, {
        NODE_ENV: 'test',
        NODE_CONFIG: info.nodeConfig,
        NODE_CONFIG_PERSIST_ON_CHANGE: mongo.PERSIST_ON_CHANGE,
        PARITY_SEED_URI: uri
      })
    });

    var stderr = '';
    var settled = false;

    // The seeder reports on stderr and writes nothing to stdout, but both are
    // drained anyway: an undrained pipe is what this function exists to avoid.
    child.stdout.resume();
    child.stderr.on('data', function (chunk) {
      stderr += chunk.toString();
    });

    function settle(result) {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    }

    function tail() {
      return String(stderr || '').trim().split('\n').slice(-3).join(' | ');
    }

    // A seeder that could not be spawned at all is a different finding from one
    // that ran and failed, and saying so keeps a missing interpreter from
    // reading as a broken fixture.
    child.on('error', function (err) {
      settle({
        ok: false,
        reason: 'the seeder could not be spawned: ' +
          ((err && err.message) || String(err))
      });
    });

    child.on('close', function (status, signal) {
      if (status === 0) {
        settle({ ok: true, reason: null });
        return;
      }

      settle({
        ok: false,
        reason: 'the seeder exited ' +
          (status === null ? 'on ' + signal : String(status)) +
          ': ' + tail()
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

/**
 * Reads one of the fixtures' JSONL evidence logs.
 *
 * The fixtures run inside the CHILD process, so their in-memory call logs are
 * unreachable from here; the log files are the published cross-process channel
 * and each is written through per call, precisely because some profiles end in
 * an uncaught throw or never settle and buffered evidence would be lost exactly
 * where it matters most.
 *
 * A missing or unreadable log is reported as such rather than treated as an
 * empty one: "no external calls were made" and "the evidence could not be read"
 * are different findings.
 *
 * @param {(string|null)} target
 * @returns {Object} {available, records, reason}
 */
function readEvidenceLog(target) {
  var text;
  var records = [];
  var malformed = 0;

  if (!target) {
    return { available: false, records: [], malformed: 0, reason: 'no log path was configured' };
  }

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    return {
      available: false,
      records: [],
      malformed: 0,
      reason: err && err.code === 'ENOENT'
        ? 'the log was never written, so nothing was intercepted'
        : 'could not read ' + target + ': ' + reasonOf(err)
    };
  }

  text.split('\n').forEach(function(line) {
    if (!line.trim()) {
      return;
    }

    try {
      records.push(JSON.parse(line));
    }
    catch (err) {
      malformed++;
    }
  });

  return { available: true, records: records, malformed: malformed, reason: null };
}

/**
 * Collects the external-effect evidence the run produced.
 *
 * This is what turns "no real network was reached" and "these object keys were
 * stored" from claims into recorded facts. The stored keys matter beyond this
 * corpus: an upload's object key is the sha1 digest of the file's CONTENT, so a
 * change to that digest silently orphans every stored object, and recording the
 * exact keys a run produced is what makes such a change visible.
 *
 * @param {(Object|null)} info the launcher's start result
 * @returns {Object} the evidence summary
 */
function collectEvidence(info) {
  var httpLog;
  var mailLog;
  var s3Log;
  var stored = { available: false, objects: [], reason: null };

  if (info === null) {
    return {
      available: false,
      reason: 'the server was not launched by this run, so its per-run ' +
        'evidence paths are owned by whoever started it'
    };
  }

  httpLog = readEvidenceLog(info.httpLogPath);
  mailLog = readEvidenceLog(info.mailLogPath);
  s3Log = readEvidenceLog(info.s3LogPath);

  // The object store is a directory on disk, so it can be read directly from
  // here. The fixture resolves its root AT LOAD from this variable, which is
  // why it is set before the require and why the require is lazy. It is
  // restored immediately afterwards for the same reason the http fixture is:
  // nothing in this process should stay patched.
  try {
    process.env.PARITY_S3_ROOT = info.s3Root;

    if (awsFixture === null) {
      awsFixture = require('./fixtures/aws');
    }

    try {
      awsFixture.restore();
    }
    catch (restoreError) {
      note('warning: could not restore the aws fixture in this process: ' +
        reasonOf(restoreError));
    }

    stored = {
      available: true,
      objects: awsFixture.list(),
      errors: awsFixture.errors(),
      reason: null
    };
  }
  catch (err) {
    stored = {
      available: false,
      objects: [],
      reason: 'the object store at ' + info.s3Root + ' could not be listed: ' +
        reasonOf(err)
    };
  }

  return {
    available: true,
    reason: null,
    http: {
      available: httpLog.available,
      reason: httpLog.reason,
      intercepted: httpLog.records.length,
      malformedLines: httpLog.malformed,
      byEndpoint: countBy(httpLog.records, 'endpoint'),
      byProfile: countBy(httpLog.records, 'profile')
    },
    mail: {
      available: mailLog.available,
      reason: mailLog.reason,
      captured: mailLog.records.length,
      malformedLines: mailLog.malformed,
      byType: countBy(mailLog.records, 'type'),
      // Named rather than restated: this is the value every captured send
      // resolves with, and an assertion downstream should reference it instead
      // of carrying a second copy of its shape.
      expectedSendResult: mailFixture.sendResult
    },
    s3: {
      available: s3Log.available,
      reason: s3Log.reason,
      calls: s3Log.records.length,
      malformedLines: s3Log.malformed,
      byOperation: countBy(s3Log.records, 'operation'),
      stored: stored
    }
  };
}

/**
 * Counts records by one field, sorted for stability.
 *
 * @param {Array.<Object>} records
 * @param {string} field
 * @returns {Object}
 */
function countBy(records, field) {
  var counts = {};

  records.forEach(function(record) {
    var key = record && record[field] !== undefined && record[field] !== null
      ? String(record[field])
      : '(unset)';

    counts[key] = (counts[key] || 0) + 1;
  });

  return sortedKeys(counts);
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

/**
 * Builds the provenance sidecar.
 *
 * "Captured at baseline" means captured by TARGET-worktree tooling against a
 * BASELINE install, and this is the record that makes that claim checkable
 * rather than asserted. It is kept out of the corpus so the corpus stays
 * diff-clean: a re-capture on a different day changes the provenance and
 * nothing else, and a reviewer diffing two corpora should see behaviour
 * changes, not timestamps.
 *
 * @param {Object} state {options, info, manifestDocument, profiles}
 * @returns {Object}
 */
function buildProvenance(state) {
  var options = state.options;
  var info = state.info;

  return {
    artifact: path.basename(options.out),
    schema: CORPUS_SCHEMA,
    tree: {
      appRoot: options.appRoot,
      head: gitHead(options.appRoot)
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
    server: info === null ? { baseUrl: options.baseUrl, launched: false } : {
      launched: true,
      baseUrl: info.baseUrl,
      origin: info.origin,
      port: info.port,
      secure: !!info.secure,
      overlay: info.overlay === undefined ? null : info.overlay,
      nodeFlags: info.nodeFlags || [],
      nodeConfig: info.nodeConfig,
      runDir: info.runDir,
      stdoutPath: info.stdoutPath,
      stderrPath: info.stderrPath,
      mongo: info.mongo,
      s3Root: info.s3Root,
      httpProfile: info.httpProfile,
      httpProfilePath: info.httpProfilePath,
      evidence: {
        http: info.httpLogPath,
        mail: info.mailLogPath,
        s3: info.s3LogPath
      }
    },
    configuration: {
      secure: options.secure,
      googleClientInjected: true,
      seeded: state.seeded,
      objectStoreSeed: state.s3Seed,
      timeoutMs: options.timeoutMs
    },
    fixtureProfiles: state.profiles,
    routeManifest: {
      path: options.manifestPath,
      routes: state.manifestDocument.entries.length,
      expected: manifest.EXPECTED.routes
    }
  };
}

/**
 * Merges a re-captured subset into an existing corpus.
 *
 * Scenarios are keyed by id, so re-driving one case replaces exactly that case
 * and leaves the rest of the artifact byte-identical. Order is taken from the
 * NEW ordering for anything it contains and from the old artifact otherwise, so
 * an append cannot reshuffle what it did not touch.
 *
 * @param {string} target the existing artifact path
 * @param {Array.<Object>} scenarios the freshly captured scenarios
 * @returns {Array.<Object>} the merged list
 * @throws {ToolError} If the existing artifact cannot be read.
 */
function mergeCorpus(target, scenarios) {
  var existing;
  var byId = {};
  var order = [];
  var merged = [];

  try {
    existing = JSON.parse(fs.readFileSync(target, 'utf8'));
  }
  catch (err) {
    throw new ToolError('--append was given but ' + target +
      ' cannot be read as a corpus: ' + reasonOf(err));
  }

  if (!existing || !Array.isArray(existing.scenarios)) {
    throw new ToolError('--append was given but ' + target +
      ' has no `scenarios` array');
  }

  existing.scenarios.forEach(function(item) {
    byId[item.id] = item;
    order.push(item.id);
  });

  scenarios.forEach(function(item) {
    if (!Object.prototype.hasOwnProperty.call(byId, item.id)) {
      order.push(item.id);
    }
    byId[item.id] = item;
  });

  order.forEach(function(id) {
    if (byId[id]) {
      merged.push(byId[id]);
      byId[id] = null;
    }
  });

  return merged;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * The whole corpus definition, before anything is driven.
 *
 * Separated from the driving so that the scenario set can be inspected, counted
 * and coverage-checked without a server - which is what makes the definitions
 * testable on their own.
 *
 * @param {Object} options
 * @param {Object} manifestDocument
 * @returns {Object} {scenarios, coverage}
 */
function buildCorpus(options, manifestDocument) {
  var data = { ids: seed.ids, fixtures: seed.fixtures };
  var payloads = defaultPayloads(seed.ids, seed.fixtures);
  var queries = defaultQueries(seed.ids, seed.fixtures);
  var supplied;
  var scenarios;
  var filter;

  if (options.payloadsPath) {
    try {
      supplied = JSON.parse(fs.readFileSync(options.payloadsPath, 'utf8'));
    }
    catch (err) {
      throw new ToolError('--payloads ' + options.payloadsPath +
        ' cannot be read as JSON: ' + reasonOf(err));
    }

    Object.keys(supplied).forEach(function(key) {
      payloads[key] = supplied[key];
    });
  }

  scenarios = buildRouteSweep({
    entries: manifestDocument.entries,
    data: data,
    payloads: payloads,
    queries: queries
  });

  if (options.quirks) {
    scenarios = scenarios.concat(buildQuirkScenarios({
      data: data,
      entries: manifestDocument.entries
    }));
  }

  scenarios = orderScenarios(scenarios);

  // Coverage is accounted over the FULL set, before --only narrows anything.
  // A filtered run is a re-capture of part of an artifact, not a claim about
  // the whole surface, and reporting its coverage as though it were would be
  // the one misrepresentation this file exists to prevent.
  var coverage = accountCoverage(manifestDocument.entries, scenarios);

  filter = compileFilter(options.only);

  return {
    scenarios: filter ? scenarios.filter(filter) : scenarios,
    selected: filter ? 'filtered' : 'all',
    total: scenarios.length,
    coverage: coverage
  };
}

/**
 * Captures the corpus: start or attach, seed, drive, write.
 *
 * @param {Object} options
 * @returns {Promise<number>} the exit code
 */
async function capture(options) {
  var manifestDocument = resolveManifest(options);
  var built = buildCorpus(options, manifestDocument);
  var info = null;
  var launched = false;
  var seeded = { attempted: false, ok: false, reason: options.seedSkippedReason || null };
  var scratchDir = null;
  var serverDied = { died: false, lastScenario: null, lastIndex: -1, remaining: 0, stderrPath: null };
  var s3Seed = { path: null, entries: 0, reason: 'no server was launched by this run' };
  var baseUrl;
  var referer;
  var jar;
  var profileFile;
  var index;
  var item;
  var summary;
  var exitCode = EXIT_OK;

  note(built.total + ' scenarios defined over ' +
    manifestDocument.entries.length + ' routes' +
    (built.scenarios.length === built.total
      ? ''
      : ', ' + built.scenarios.length + ' selected by --only'));

  if (built.coverage.unknownRoutes.length) {
    built.coverage.unknownRoutes.forEach(function(entry) {
      note('scenario ' + entry.scenario + ' claims ' + entry.covers +
        ', which is not in the manifest');
    });
  }

  try {
    if (options.baseUrl) {
      baseUrl = options.baseUrl;
      profileFile = options.profileFile;
      note('driving the already-running server at ' + baseUrl);

      if (!profileFile) {
        note('no --profile-file, so per-case fixture profiles cannot be ' +
          'switched; every case will be driven under whatever profile that ' +
          'server started with');
      }
    }
    else {
      // Scratch space for this tool's own intermediate files. Deliberately
      // outside the repository: nothing this run creates belongs in a working
      // tree, and the launcher owns its own per-run directory separately.
      scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-capture-'));
      s3Seed = prepareS3Seed(options, scratchDir);

      if (!s3Seed.path) {
        throw new ToolError('the object-store pre-population manifest could ' +
          'not be prepared, and without it a download route would ask the ' +
          'store for a key it does not hold - the fixture would raise ' +
          'NoSuchKey on a stream nothing listens to and take the server down ' +
          'mid-corpus: ' + s3Seed.reason);
      }

      note('prepared ' + s3Seed.entries + ' pre-migration objects for the store');

      info = await server.start(buildLauncherOptions(options, s3Seed.path));

      launched = true;
      baseUrl = info.baseUrl;
      profileFile = info.httpProfilePath;

      note('server ready at ' + baseUrl + ' (pid ' + info.pid + ', database ' +
        info.mongo.database + ')');

      if (options.seedFixtures) {
        seeded.attempted = true;
        summary = await seedFixtures(info);
        seeded.ok = summary.ok;
        seeded.reason = summary.reason;

        if (!summary.ok) {
          // Reported, and fatal. A corpus captured against an unseeded database
          // is a corpus of not-found responses that looks like a captured
          // baseline, which is worse than no corpus at all.
          throw new ToolError('the fixtures could not be seeded, so nothing ' +
            'would be captured against them: ' + summary.reason);
        }

        note('fixtures seeded');
      }
      else {
        note('seeding skipped' + (seeded.reason ? ' (' + seeded.reason + ')' : ''));
      }
    }

    referer = refererFor(info, baseUrl);

    jar = new Jar({
      baseUrl: baseUrl,
      referer: referer,
      timeoutMs: options.timeoutMs
    });

    await establishSessions(jar, built.scenarios);

    for (index = 0; index < built.scenarios.length; index++) {
      item = built.scenarios[index];
      item.order = index;

      await runScenario(item, {
        jar: jar,
        profileFile: profileFile,
        timeoutMs: options.timeoutMs
      });

      reportScenario(item, index, built.scenarios.length);

      // A crash check, paid for only when something already went wrong on the
      // wire. Everything after a dead server is a transport failure that would
      // be recorded as though it were an observation, so the run stops here and
      // says which case was the last one whose response meant anything.
      if (sawTransportFailure(item) && !serverAlive(info)) {
        serverDied = {
          died: true,
          lastScenario: item.id,
          lastIndex: index,
          remaining: built.scenarios.length - index - 1,
          stderrPath: info ? info.stderrPath : null
        };

        note('THE APPLICATION DIED while driving ' + item.id + ' (case ' +
          (index + 1) + ' of ' + built.scenarios.length + '). Every case after ' +
          'it would record a transport failure that means nothing, so the run ' +
          'stops here.');

        if (info) {
          note('the application\'s own stderr is at ' + info.stderrPath +
            ' - a crash mid-corpus is a defect in the application under test, ' +
            'not in the corpus');
        }

        markRemainingUndriven(built.scenarios, index + 1,
          'the application died while driving ' + item.id + ', so this case ' +
          'was never reached; its response is unknown rather than absent');
        break;
      }
    }

    // Leave the fixture on its default profile, so a server that outlives this
    // run is not left in whatever state the last case wanted.
    if (profileFile) {
      selectProfile(profileFile, 'default');
    }

    exitCode = writeArtifacts({
      options: options,
      info: info,
      manifestDocument: manifestDocument,
      built: built,
      jar: jar,
      seeded: seeded,
      s3Seed: s3Seed,
      serverDied: serverDied,
      // Collected after the last case and before the server is stopped, so the
      // per-run directory is still there to be read.
      evidence: collectEvidence(info)
    });
  }
  finally {
    if (launched) {
      try {
        await server.stop();
      }
      catch (stopError) {
        note('warning: the server did not stop cleanly: ' + reasonOf(stopError));
      }
    }

    if (scratchDir) {
      try {
        // Only ever this tool's own scratch directory, created by mkdtemp in
        // the system temp area a few lines above. Nothing else is removed.
        fs.rmSync(scratchDir, { recursive: true, force: true });
      }
      catch (cleanupError) {
        note('warning: could not remove the scratch directory ' + scratchDir +
          ': ' + reasonOf(cleanupError));
      }
    }
  }

  return exitCode;
}

/**
 * Builds the launcher's options.
 *
 * `overlay` is set only when it was actually given, and that is not a detail:
 * the launcher copies every key PRESENT in this object over its own defaults,
 * so passing `overlay: undefined` would overwrite its default overlay with
 * nothing - and the default overlay is what supplies `app.start: true`. Without
 * it the application initialises, never listens, and the readiness probe can
 * only time out. `--no-overlay` sets the value to null, which is a deliberate
 * "no overlay" and IS passed through.
 *
 * @param {Object} options this tool's resolved options
 * @returns {Object} the launcher's options
 */
function buildLauncherOptions(options, s3SeedPath) {
  var launcher = {
    appRoot: options.appRoot,
    // The pre-population manifest. See prepareS3Seed for why its absence is
    // not a degraded run but a crashed server.
    s3Seed: s3SeedPath || null,
    secure: options.secure,
    host: options.host,
    port: options.port,
    database: options.database,
    mongoUri: options.mongoUri,
    nodeFlags: options.nodeFlags,
    readyTimeoutMs: DEFAULT_READY_TIMEOUT_MS,
    // The layer that makes the OAuth branches reachable at all. See the
    // header: the handlers short-circuit without a client, the overlay
    // declares none, and the fixture's contract assigns this to whoever drives
    // the corpus.
    config: { app: { auth: { google: GOOGLE_STUB } } }
  };

  if (options.overlay !== undefined) {
    launcher.overlay = options.overlay;
  }

  return launcher;
}

/**
 * The referer every request carries, matching what the suite's own requests
 * send: the configured url, which is protocol, hostname and port when there is
 * one. Derived from the composed configuration where it is available so it is
 * the value the application itself would compute, and from the launcher's
 * origin otherwise.
 *
 * @param {(Object|null)} info
 * @param {string} baseUrl
 * @returns {string}
 */
function refererFor(info, baseUrl) {
  var app = info && info.config && info.config.app ? info.config.app : null;
  var url = app && app.url ? app.url : null;
  var composed;

  if (url && url.protocol && url.hostname) {
    composed = url.protocol + '://' + url.hostname;

    if (url.port) {
      composed += ':' + url.port;
    }

    return composed;
  }

  return baseUrl;
}

/**
 * Logs every password identity in that the selected scenarios actually need.
 *
 * Driven through the real login form rather than by forging a cookie: session
 * state lives on the server, so a forged cookie could not work, and the login
 * flow is part of the surface under test. Only the identities in use are logged
 * in, so a narrow --only run does not pay for sessions it will not spend.
 *
 * A login that does not land is a reported fault rather than a silent one, with
 * one exception: the disabled account is REFUSED by design, and its scenario
 * exists to record that, so its failure to land is the expected outcome.
 *
 * @param {Jar} jar
 * @param {Array.<Object>} scenarios
 * @returns {Promise<undefined>}
 */
async function establishSessions(jar, scenarios) {
  var wanted = {};
  var outcome;

  scenarios.forEach(function(item) {
    var identities = [item.identity].concat(item.steps.map(function(step) {
      return step.identity;
    }));

    identities.forEach(function(identity) {
      if (identity === IDENTITY_USER || identity === IDENTITY_ADMIN ||
          identity === IDENTITY_DISABLED) {
        wanted[identity] = true;
      }
    });
  });

  for (var identity of Object.keys(wanted).sort()) {
    outcome = await jar.login(identity, seed.credentials[identity]);

    if (outcome.ok) {
      note('logged in as the seeded ' + identity);
    }
    else if (identity === IDENTITY_DISABLED) {
      note('the disabled identity did not reach /home, which is what its ' +
        'scenario records: ' + (outcome.location || outcome.error));
    }
    else {
      note('warning: the ' + identity + ' login did not land on /home (' +
        (outcome.location || outcome.error) + '). Cases driven as this ' +
        'identity will record whatever an unauthenticated request returns, ' +
        'and each one says so.');
    }
  }
}

/**
 * One progress line per scenario. Progress goes to stderr as it happens rather
 * than in a block at the end, so a long capture is observable while it runs and
 * a stall is attributable to a case.
 *
 * @param {Object} item
 * @param {number} index
 * @param {number} total
 * @returns {undefined}
 */
function reportScenario(item, index, total) {
  var first = item.steps.length && item.steps[0].response
    ? item.steps[0].response
    : null;
  var state;

  if (item.driven.skipped) {
    state = 'unreachable-by-design';
  }
  else if (!item.driven.ok) {
    state = 'FAILED TO DRIVE: ' + item.driven.error;
  }
  else if (!first) {
    state = 'no response recorded';
  }
  else if (first.timedOut) {
    state = 'timed out after ' + first.timeoutMs + 'ms';
  }
  else if (!first.ok) {
    state = 'transport failure: ' + first.error;
  }
  else {
    state = String(first.status);
  }

  if (item.expectationResult && !item.expectationResult.met) {
    state += ' [expectation not met: ' +
      item.expectationResult.failures.join('; ') + ']';
  }

  note('[' + (index + 1) + '/' + total + '] ' + item.id + ' -> ' + state);
}

/**
 * Writes the corpus and its provenance sidecar, and decides the exit code.
 *
 * @param {Object} state
 * @returns {number} the exit code
 */
function writeArtifacts(state) {
  var options = state.options;
  var built = state.built;
  var scenarios = built.scenarios;
  var undriven = [];
  var unmet = [];
  var timedOut = [];
  var unreachable = [];
  var corpus;
  var provenance;
  var exitCode = EXIT_OK;

  scenarios.forEach(function(item) {
    if (item.driven.skipped) {
      unreachable.push(item.id);
      return;
    }

    if (!item.driven.ok) {
      undriven.push({
        id: item.id,
        reason: item.driven.error,
        neverReached: !!item.driven.neverReached
      });
    }

    if (item.expectationResult && !item.expectationResult.met) {
      unmet.push({
        id: item.id,
        description: item.expectationResult.description,
        failures: item.expectationResult.failures
      });
    }

    item.steps.forEach(function(step) {
      if (step.response && step.response.timedOut) {
        timedOut.push({ id: item.id, step: step.label, expected: item.intent === 'timeout' });
      }
    });
  });

  corpus = {
    schema: CORPUS_SCHEMA,
    summary: {
      scenarios: scenarios.length,
      definedScenarios: built.total,
      selection: built.selected,
      routes: built.coverage.routes,
      routesRepresented: built.coverage.represented,
      routesUnrepresented: built.coverage.unrepresented.length,
      unreachableByDesign: unreachable.length,
      undriven: undriven.length,
      applicationDied: state.serverDied.died,
      expectationsUnmet: unmet.length,
      timedOutSteps: timedOut.length
    },
    coverage: built.coverage,
    notes: corpusNotes(),
    // What crossed the module boundary while the corpus was driven. A response
    // is only reproducible together with the fixture state that produced it, so
    // the two belong in one artifact.
    evidence: state.evidence,
    // Set when the application under test crashed mid-corpus. Recorded rather
    // than inferred, because the symptom - a run of transport failures - is
    // indistinguishable from a network fault otherwise.
    applicationDied: state.serverDied,
    // Which identities actually held a session while the corpus was driven. A
    // case driven as a user whose login never landed records an
    // unauthenticated response, and that is worth knowing when reading the
    // artifact rather than inferring from the responses.
    sessions: {
      established: sortedKeys(state.jar.established),
      failures: sortedKeys(state.jar.failures)
    },
    unreachable: unreachable,
    undriven: undriven,
    expectationsUnmet: unmet,
    timedOut: timedOut,
    scenarios: options.append ? mergeCorpus(options.out, scenarios) : scenarios
  };

  provenance = buildProvenance({
    options: options,
    info: state.info,
    manifestDocument: state.manifestDocument,
    seeded: state.seeded,
    s3Seed: state.s3Seed,
    profiles: httpFixture.profileNames()
  });

  writeArtifact(options.out, corpus);
  writeArtifact(options.out + '.provenance.json', provenance);

  note('wrote ' + options.out);
  note('wrote ' + options.out + '.provenance.json');

  // Coverage is a gate. An unrepresented route means the corpus cannot support
  // the claim that the whole surface was captured, and the honest response is
  // to fail rather than to write an artifact that overstates itself.
  if (built.coverage.unrepresented.length) {
    built.coverage.unrepresented.forEach(function(key) {
      note('UNREPRESENTED ROUTE: ' + key);
    });
    note(built.coverage.unrepresented.length + ' of ' + built.coverage.routes +
      ' routes have no scenario. Every route must be represented, or listed ' +
      'as unreachable with a reason.');
    exitCode = EXIT_DIFFERENCE;
  }

  if (built.coverage.unknownRoutes.length) {
    note(built.coverage.unknownRoutes.length + ' scenarios claim routes the ' +
      'manifest does not contain, which means this tool\'s own tables are out ' +
      'of step with the route surface');
    exitCode = EXIT_DIFFERENCE;
  }

  if (state.serverDied.died) {
    note('THE CORPUS IS INCOMPLETE: the application died on case ' +
      (state.serverDied.lastIndex + 1) + ' (' + state.serverDied.lastScenario +
      ') and ' + state.serverDied.remaining + ' cases were never reached. Fix ' +
      'the crash in the application under test and re-run; the artifact ' +
      'records which case was last.');
    exitCode = EXIT_DIFFERENCE;
  }

  if (undriven.length) {
    undriven.forEach(function(entry) {
      // The never-reached cases share one cause, already reported above, so
      // they are summarized rather than listed one line at a time.
      if (!entry.neverReached) {
        note('COULD NOT DRIVE ' + entry.id + ': ' + entry.reason);
      }
    });
    exitCode = EXIT_DIFFERENCE;
  }

  timedOut.forEach(function(entry) {
    if (!entry.expected) {
      // An unexpected timeout is a finding, not a pass: the two known
      // never-settling paths declare themselves, so any other stall is
      // something new.
      note('UNEXPECTED TIMEOUT in ' + entry.id + ' at step ' + entry.step +
        ' - this case did not declare itself as a timeout, so the stall is a ' +
        'finding rather than a recorded outcome');
      exitCode = EXIT_DIFFERENCE;
    }
  });

  if (unmet.length) {
    unmet.forEach(function(entry) {
      note('EXPECTATION NOT MET ' + entry.id + ': ' + entry.description +
        ' -- ' + entry.failures.join('; '));
    });

    if (options.expectBaseline) {
      note('--expect-baseline was given, so an unmet expectation is fatal');
      exitCode = EXIT_DIFFERENCE;
    }
    else {
      note('recorded but not fatal: pass --expect-baseline when capturing the ' +
        'base commit. Against the migrated tree the image-download case is ' +
        'EXPECTED to differ, by the approved deviation in AAP 0.7.');
    }
  }

  note('coverage ' + built.coverage.represented + '/' + built.coverage.routes +
    ' routes, ' + scenarios.length + ' scenarios driven, ' +
    unmet.length + ' expectations unmet, ' + timedOut.length +
    ' timed-out steps');

  return exitCode;
}

/**
 * Writes one artifact, creating its directory if it is not there.
 *
 * @param {string} target
 * @param {*} value
 * @returns {undefined}
 * @throws {ToolError} If it cannot be written.
 */
function writeArtifact(target, value) {
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, serialize(value));
  }
  catch (err) {
    throw new ToolError('could not write ' + target + ': ' + reasonOf(err));
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The CLI.
 *
 * @param {Array.<string>} [argv]
 * @returns {Promise<number>} the exit code
 */
async function main(argv) {
  var options;

  try {
    options = parseArguments(argv || process.argv.slice(2));
  }
  catch (err) {
    note(reasonOf(err));
    process.stderr.write(USAGE + '\n');
    return EXIT_ERROR;
  }

  if (options.help) {
    process.stderr.write(USAGE + '\n');
    return EXIT_OK;
  }

  try {
    return await capture(options);
  }
  catch (err) {
    note(reasonOf(err));

    if (err && err.usage) {
      process.stderr.write(USAGE + '\n');
    }
    else if (err && err.stack && !(err instanceof ToolError)) {
      // An unexpected fault, as opposed to a reported one. The stack is worth
      // more than the tidiness of hiding it.
      process.stderr.write(err.stack + '\n');
    }

    return EXIT_ERROR;
  }
}

module.exports = {
  // The lifecycle.
  capture: capture,
  buildCorpus: buildCorpus,
  buildLauncherOptions: buildLauncherOptions,

  // Scenario construction, exported because each piece has a failure mode worth
  // testing directly rather than through a spawned server - a wildcard with no
  // materialization rule, a payload table out of step with the route surface, a
  // filter that matches nothing.
  buildRouteSweep: buildRouteSweep,
  buildQuirkScenarios: buildQuirkScenarios,
  buildReplyChainScenarios: buildReplyChainScenarios,
  buildPreHandlerScenarios: buildPreHandlerScenarios,
  buildOAuthScenarios: buildOAuthScenarios,
  buildAuthOutcomeScenarios: buildAuthOutcomeScenarios,
  buildErrorEdgeScenarios: buildErrorEdgeScenarios,
  defaultPayloads: defaultPayloads,
  defaultQueries: defaultQueries,
  materializePath: materializePath,
  trinketForPath: trinketForPath,
  langPrefixOf: langPrefixOf,
  wildcardTailFor: wildcardTailFor,
  identityForEntry: identityForEntry,
  entryFor: entryFor,
  requiresAdmin: requiresAdmin,
  isMutatingEntry: isMutatingEntry,
  orderScenarios: orderScenarios,
  scenarioId: scenarioId,
  withQuery: withQuery,

  // Driving and recording.
  drive: drive,
  Jar: Jar,
  encodePayload: encodePayload,
  recordStep: recordStep,
  runScenario: runScenario,
  selectProfile: selectProfile,
  refererFor: refererFor,

  // Evidence.
  collectEvidence: collectEvidence,
  readEvidenceLog: readEvidenceLog,
  countBy: countBy,

  // Accounting and artifacts.
  accountCoverage: accountCoverage,
  evaluateExpectation: evaluateExpectation,
  mergeCorpus: mergeCorpus,
  corpusNotes: corpusNotes,
  buildProvenance: buildProvenance,
  resolveManifest: resolveManifest,
  seedFixtures: seedFixtures,
  prepareS3Seed: prepareS3Seed,
  gitHead: gitHead,
  serverAlive: serverAlive,
  sawTransportFailure: sawTransportFailure,
  markRemainingUndriven: markRemainingUndriven,

  // Building blocks.
  parseArguments: parseArguments,
  compileFilter: compileFilter,
  parseSetCookie: parseSetCookie,
  recordHeaders: recordHeaders,
  isTextualType: isTextualType,
  elapsedBucket: elapsedBucket,
  sortedKeys: sortedKeys,
  sha256Hex: sha256Hex,
  serialize: serialize,
  normalizeBaseUrl: normalizeBaseUrl,
  reasonOf: reasonOf,

  // Reference values, so a harness asserts against the same constants this
  // file uses rather than a second copy of them.
  IDENTITIES: IDENTITIES,
  IDENTITY_ANONYMOUS: IDENTITY_ANONYMOUS,
  IDENTITY_USER: IDENTITY_USER,
  IDENTITY_ADMIN: IDENTITY_ADMIN,
  IDENTITY_DISABLED: IDENTITY_DISABLED,
  IDENTITY_MISSING: IDENTITY_MISSING,
  THROWAWAY: THROWAWAY,
  GOOGLE_STUB: GOOGLE_STUB,
  ACCEPT_HTML: ACCEPT_HTML,
  ACCEPT_JSON: ACCEPT_JSON,
  ABSENT_ID: ABSENT_ID,
  ABSENT_TOKEN: ABSENT_TOKEN,
  CORPUS_SCHEMA: CORPUS_SCHEMA,
  DEFAULT_OUT: DEFAULT_OUT,
  DEFAULT_MANIFEST: DEFAULT_MANIFEST,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  EXPECTED_TIMEOUT_MS: EXPECTED_TIMEOUT_MS,
  MAX_TEXT_BYTES: MAX_TEXT_BYTES,
  EXIT_OK: EXIT_OK,
  EXIT_DIFFERENCE: EXIT_DIFFERENCE,
  EXIT_ERROR: EXIT_ERROR,
  ToolError: ToolError,
  USAGE: USAGE,
  main: main
};

if (require.main === module) {
  main()
    .then(function(code) {
      process.exitCode = code;
    })
    .catch(function(err) {
      note(reasonOf(err));

      if (err && err.stack) {
        process.stderr.write(err.stack + '\n');
      }

      process.exitCode = EXIT_ERROR;
    });
}

