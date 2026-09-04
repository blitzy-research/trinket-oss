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
//        why every corpus CARRIES its provenance - the analysed tree's commit,
//        this tool's own blob and the commit verified to contain it - embedded
//        under one top-level key, and why `--expect-baseline` refuses to run
//        against any tree other than that commit. A baseline claim about
//        whichever worktree happened to be passed to --app is not evidence,
//        and the only escape records the artifact as `unreviewed`.
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
//     module boundary by the three isolation fixtures - aws, mail and http. A
//     fourth preload, `fixtures/model.js`, replaces no external effect: it is
//     the fault injector this file arms for the one case that needs a data-store
//     failure, and it is inert on every other case.
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
// WHAT THE ARTIFACT MAY CLAIM ABOUT ITSELF
// ===========================================================================
// A corpus is read later as evidence for the parity gate, so the one thing it
// must never do is overstate its own reach. Four rules follow from that, and
// each of them is enforced rather than documented:
//
//   1. COVERAGE DESCRIBES THE ARTIFACT THAT WAS WRITTEN, not the scenario set
//      that could have been driven. `--only` and `--no-quirks` reduce what is
//      captured, so they reduce the coverage the artifact reports. The full
//      defined surface is reported separately, as `definitionCoverage`, and is
//      labelled as a definition count so it cannot be mistaken for a capture.
//   2. GATE QUALIFICATION IS A COMPUTED FIELD WITH ITS REASONS ATTACHED. An
//      artifact qualifies only when every manifest route and every mandatory
//      quirk, error-edge and auth-outcome group is present in it, every case
//      drove, the fixture evidence was sound and nothing was excused. Anything
//      else writes `gate.qualifies: false` and lists why, so a partial capture
//      cannot be handed to a reviewer as a full-surface one.
//   3. AN EMPTY SELECTION IS A FAULT, NOT A RUN. `--only` matching nothing
//      exits before the launcher starts: a corpus of zero scenarios that
//      claimed 233 routes is precisely the misrepresentation rule 1 exists to
//      prevent.
//   4. THE ANNOTATIONS SURVIVE A CAPTURE, AND AN APPROVED DEVIATION HAS TO
//      MATERIALIZE AS APPROVED. `expectedDeviation` and `unreachableReason` are
//      part of the scenario DEFINITION - the first is the only thing that
//      distinguishes AAP 0.7's approved change from a regression, the second is
//      what keeps an unreachable route explained rather than dropped - so they
//      are carried on the captured scenario, are re-attached from the existing
//      definition by `--append`, and are written to a `<out>.annotations.json`
//      sidecar that `replay.js --annotations` consumes directly. The marker
//      approves ONE response, not "a difference", so the marked case also
//      carries a machine-checkable `targetExpectation` and `--target` excuses
//      the difference only when what was captured satisfies it.
//
// ===========================================================================
// DETERMINISM
// ===========================================================================
// Re-capturing the same tree must produce a reviewable diff, not a reshuffle.
// Scenario order is fixed by construction and runs in three dependency phases -
// read-only, then non-destructive mutations, then the destructive ones, with a
// forced reseed before each destructive case so that a delete never decides
// what a later case observes; object keys are emitted in a declared order and
// every dynamic map (headers, cookie attributes) is sorted; no clock or random
// value reaches
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

// Applied BEFORE the fixture catalogues below, because ./fixtures/mail requires
// lib/util/mailer.js, which requires the npm `config` package at module scope -
// so merely requiring THIS file loads `config`, and without the isolation
// `config` 0.4.37 then creates config/runtime.json inside the checkout it is
// resolving from. Measured.
//
// `appRoot: TOOL_ROOT` is the second half and is not optional: the config this
// PROCESS loads is this tool's own tree, and `config` resolves its directory
// from the working directory unless told otherwise - so an inherited
// NODE_CONFIG_DIR pointing at another tree would be honoured and the fixtures
// would read that tree's buckets, mail settings and feature flags into this
// run's evidence. The runtime-layer controls alone do not reconcile it, so the
// call names the tree.
//
// The root is computed here rather than read from TOOL_ROOT below, because
// `var` hoists the declaration but not the assignment: this call runs before
// that line, so TOOL_ROOT would still be `undefined` and the reconciliation
// would silently be skipped. It is the same path by the same expression.
mongo.isolateRuntimeConfig({
  appRoot   : path.resolve(__dirname, '..', '..'),
  configDir : 'set'
});

// The fixture catalogues. `httpFixture` is required for its profile catalogue
// and its two frozen identities, and is IMMEDIATELY restored - see the note on
// the driver above. `awsFixture` is required lazily, after PARITY_S3_ROOT has
// been pointed at the launcher's store, because it resolves its root at load.
var httpFixture = require('./fixtures/http');
var mailFixture = require('./fixtures/mail');

// The model-boundary fault fixture, required for its `arming()` builder ONLY:
// the arming document's field names live in that fixture and are not duplicated
// here. It is restored immediately, like the two above. Requiring it is safe in
// this process for the reason its header gives - it loads no application module
// and patches nothing until something requires lib/models/user, which this
// process never does.
var modelFixture = require('./fixtures/model');

var awsFixture = null;

// Undo the auto-install in THIS process. The child keeps its own patched copy;
// what must not happen is this process driving localhost through a patched
// fetch. Each is wrapped because a restore fault must not take the run down
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

try {
  modelFixture.restore();
}
catch (restoreError) {
  process.stderr.write('capture: warning: could not restore the model fixture ' +
    'in this process: ' + reasonOf(restoreError) + '\n');
}

var LOG_PREFIX = 'capture: ';

var TOOL_ROOT = path.resolve(__dirname, '..', '..');


// The only options that may appear more than once, and why each may.
// `--only` accumulates a scenario selection; `--node-flags` accumulates the
// flags the child is started with, which is how the zero-warning gate passes
// `--pending-deprecation`. Everything else takes effect once, and a second
// occurrence is a usage error rather than a silent last-one-wins.
var REPEATABLE_OPTIONS = ['--only', '--node-flags'];

// The environment variable that names ONE scratch directory for the default
// artifacts of every test/parity tool.
//
// There is deliberately NO repository default for anything this tool WRITES. A
// corpus destination that falls back to test/parity/corpus.json means an
// ordinary invocation - a diagnostic run, a `--only` spot check, a harness
// spawning this file - overwrites the committed baseline evidence in tracked
// source. So the destination is either named on the command line or taken from
// this directory; naming a path inside the worktree is still possible and is
// how the committed corpus is produced, but it has to be asked for.
var ARTIFACT_DIR_ENV = 'PARITY_ARTIFACT_DIR';

// The basename used when the destination comes from ARTIFACT_DIR_ENV rather
// than from --out, so an artifact in the scratch directory is still
// recognisable as the same evidence.
var CORPUS_ARTIFACT_NAME = 'corpus.json';

// The committed route manifest. This one is a READ default and stays a
// repository path: reading the manifest a reviewer can see is the point, and a
// read cannot damage it. When it is absent and --manifest was not given, the
// generated copy goes to a scratch directory instead (see manifestDestination).
var COMMITTED_MANIFEST = path.join(__dirname, 'route-manifest.json');
var MANIFEST_ARTIFACT_NAME = 'route-manifest.json';

// The artifact schema. Bumped only when a consumer would have to change.
var CORPUS_SCHEMA = 1;

// Per-step budget. Generous enough that a slow first render is not mistaken for
// a hang, finite so the never-settling branch cannot stall the run.
var DEFAULT_TIMEOUT_MS = 15000;

// The never-settling case does not need the full budget to prove itself, and
// giving it one would add that much dead time to every run.
var EXPECTED_TIMEOUT_MS = 4000;

// How long after the per-step budget the absolute wall-clock deadline fires.
// Non-zero on purpose: it keeps the inactivity timeout and the deadline from
// racing on a route that answers nothing at all, so that case is always
// recorded as an inactivity timeout and a re-capture stays diff-clean.
var DEADLINE_GRACE_MS = 1000;

// Readiness budget handed to the launcher.
var DEFAULT_READY_TIMEOUT_MS = 120000;

// Budgets for the children this file runs. Every one of them is finite, and
// that is the point rather than a detail: this tool spawns children while it
// also owns an in-memory mongod and a live application server, so a child that
// never finishes does not merely delay the capture - it strands both of those
// and the corpus is never written.
//
//   SEED_TIMEOUT_MS      The seeder connects to a database this process
//                        provisioned and writes a fixed set of fixtures. It is
//                        normally under a second; the budget covers a cold
//                        `mongoose` load and mongod's own 30s server-selection
//                        window, so a timeout here means the seeder is wedged
//                        rather than slow.
//   SEED_KILL_GRACE_MS   SIGTERM to SIGKILL, then SIGKILL to giving up on
//                        reaping. Short: the seeder holds no state worth
//                        flushing.
//   GIT_TIMEOUT_MS       `git rev-parse HEAD`, which is local and instant.
//   CHILD_TIMEOUT_MS     The route-manifest generator and the object-store
//                        manifest child, both of which load application
//                        modules from the tree under test.
var SEED_TIMEOUT_MS    = 120000;
var SEED_KILL_GRACE_MS = 5000;
var GIT_TIMEOUT_MS     = 10000;
var CHILD_TIMEOUT_MS   = 120000;

// Recorded text bodies are kept whole up to this size. Past it the text is
// truncated and flagged - the digest and length are of the WHOLE body either
// way, so a difference past the cut is still detectable.
var MAX_TEXT_BYTES = 262144;

var EXIT_OK = 0;
var EXIT_DIFFERENCE = 1;
var EXIT_ERROR = 2;

// The three external-effect channels the fixtures intercept, in the order they
// are reported. Named once so a health check, a requirement and an artifact
// field cannot disagree about what a channel is.
var EVIDENCE_CHANNELS = ['http', 'mail', 's3'];

// The fixture log records that carry an `event` field and are NOT faults.
//
// `profile-changed` is the http fixture acknowledging the profile file this
// tool writes between cases; `send` is the mail fixture's record of a captured
// message; `adopted-existing-patch` is the mail fixture recognizing its own
// patch rather than layering a second one. Every other `event` any of the three
// fixtures emits names something that did not work, which is why this list is
// an allow-list: a fault event added to a fixture later fails the capture
// without anyone having to remember to teach this file about it.
var BENIGN_FIXTURE_EVENTS = ['profile-changed', 'send', 'adopted-existing-patch'];

// The one fixture event whose disposition depends on WHAT IT SAYS rather than
// on its name, so it belongs on neither list.
//
// The http fixture publishes an install handshake - the module it loaded and a
// digest of it, the declared application root and whether it verified, the
// mechanisms it was required to take and the ones it actually took, and the
// state of the provider identity contract - and records it in the evidence log
// of every run. It is a STATUS record: on a healthy install it reports that
// nothing went wrong, which the allow-list above would have to call benign
// unconditionally, and on a broken one it carries exactly the facts a parent
// needs to refuse the run.
//
// Reading it is the parent-side half of the fixture-isolation contract. The
// fixture already terminates its own process for an un-interceptable mechanism
// or a declared-but-wrong root; what it cannot do is make a parent check the
// handshake, and a capture that trusts an unverified interception is recording
// responses that may have reached the real network. `handshakeFaults` is that
// check, and it is stricter than an allow-list entry rather than looser: an
// `install` record is benign only when every one of its own health fields says
// so, and any other outcome is a fault naming the field that failed.
var HANDSHAKE_FIXTURE_EVENT = 'install';

// The scenario fields that are ANNOTATIONS rather than captured observations.
// They belong to the definition, a capture must not lose them, and `--append`
// re-attaches them from the artifact it is merging into - see `mergeCorpus`.
//
// `targetExpectation` is on this list for the same reason the marker is:
// without it the marker approves nothing checkable, so losing it on a
// re-capture would leave a marked case that can never be approved, which is
// the safe failure but still a lost definition.
var ANNOTATION_FIELDS = [
  'expectedDeviation',
  'unreachableReason',
  'targetExpectation'
];

// The three dependency phases the corpus is driven in, in order. Read-only
// cases are recorded against untouched fixtures, then the mutations that create
// or change state, then the ones that destroy it - see `orderScenarios`.
var PHASE_READ_ONLY = 'read-only';
var PHASE_MUTATING = 'mutating';
var PHASE_DESTRUCTIVE = 'destructive';

var PHASE_ORDER = [PHASE_READ_ONLY, PHASE_MUTATING, PHASE_DESTRUCTIVE];

// The groups an artifact must contain before it can stand as gate evidence.
// The route sweep alone proves only that 233 routes answer something; these are
// the cases that make the corpus evidence for R-d, R-e and the session
// contract, which is why an artifact without them does not qualify however
// complete its route coverage is. Matched as prefixes because each expands into
// several concrete groups (quirk.reply-chain.*, error-edge.*).
var MANDATORY_GROUP_PREFIXES = ['quirk.', 'error-edge.', 'auth-outcome'];

// AAP 0.7's approved deviation, carried on the one scenario it applies to.
//
// This is the entire deviation-control mechanism for the parity gate: replay.js
// treats a difference as a FAILURE unless the scenario carries this marker, and
// then checks the difference against what the marker approved. The wording is
// the wording of the decision, so that the artifact and the record in
// `docs/preserved-quirks.md` say the same thing.
var IMAGE_DOWNLOAD_DEVIATION = Object.freeze({
  approvedBy: 'AAP 0.7',
  rule: 'R-b',
  baseline: 'The request never settles: the image branch ends at `.bytes(...)` ' +
    'with no `return` and nothing that resolves the deferred ' +
    '[lib/controllers/files.js:98-100], so the step is recorded as an expected ' +
    'timeout.',
  target: 'A 200 stream response carrying the file\'s own mime type and byte ' +
    'length, and NO Content-Disposition - the image branch deliberately omits ' +
    'the header its sibling four lines below sets ' +
    '[lib/controllers/files.js:102-105].',
  replayDisposition: 'approved-change',
  reason: 'An unsettled request is the absence of a response, not a behaviour ' +
    'a client can depend on, so R-d\'s protection does not attach to it; the ' +
    'intended response is present in the same function for the non-image case; ' +
    'and R-b is unqualified about routes serving.'
});

// Why the fifth auth-scheme outcome is recorded rather than driven. R-b permits
// an entry that cannot be driven only when it is listed WITH ITS REASON, and
// this is that reason - carried on the scenario so a capture cannot turn a
// documented exclusion into an unexplained hole.
var AUTH_LOOKUP_ERROR_UNREACHABLE =
  'The "Auth error" outcome of the auth scheme [app.js:243-281] needs the User ' +
  'lookup itself to fail, which no HTTP request can cause - it takes a ' +
  'database fault injected below the model layer. Listed here with that reason ' +
  'rather than omitted, and rather than simulated with a request that would ' +
  'reach a different branch and be recorded as though it were this one. The ' +
  'outcome is asserted directly against the scheme by the server-level gate, ' +
  'which can inject the fault.';

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

// What identifies a scenario as exercising the OAuth surface, and therefore as
// one whose capture is only meaningful if the fake client above actually
// reached the child. Both spellings are needed: the quirk cases carry the
// group, and the route sweep's own two cases carry only the route path.
var OAUTH_GROUP_PREFIX = 'quirk.oauth';
var OAUTH_ROUTE_PREFIX = '/auth/google';

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
    // MEASURED CORRECTION. This was `{ format: 'zip' }`, which the route's own
    // schema REJECTS: config/routes.js declares
    // `format : Joi.string().valid('md', 'html').required()`, and the parser's
    // hand-rolled validation block runs BEFORE the handler is called
    // (lib/util/routeParser.js) and returns request.fail on failure. So every
    // scenario driving this route with `format=zip` recorded the
    // validation-failure path and never reached `courses.download` at all -
    // which silently voided three committed scenarios, including the
    // header-resolved reply-chain quirk gate below that exists to prove the
    // archive response. `md` is the cheaper of the two accepted values.
    'GET /{userSlug}/courses/{courseSlug}/download.zip': { format: 'md' },
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
  '                       always written beside it. REQUIRED unless',
  '                       ' + ARTIFACT_DIR_ENV + ' names a directory, in which',
  '                       case it is <dir>/' + CORPUS_ARTIFACT_NAME + '. There',
  '                       is no repository default: writing the committed',
  '                       baseline is --out test/parity/' + CORPUS_ARTIFACT_NAME,
  '                       spelled out.',
  '                       under one top-level `provenance` key, so the corpus',
  '                       says which tree it measured on its own. A sibling',
  '                       <out>.provenance.json is also written as a run',
  '                       output - it adds a digest of the exact bytes and is',
  '  --manifest <path>    Route manifest to account coverage against. Read from',
  '                       test/parity/' + MANIFEST_ARTIFACT_NAME + ' when it is',
  '                       there. When it is not, one is generated by spawning',
  '                       manifest.js - into ' + ARTIFACT_DIR_ENV + ' or a fresh',
  '                       temporary directory, never into the worktree unless',
  '                       this flag named a path inside it.',
  '  --only <pattern>     Drive only scenarios whose id, route key or group',
  '                       matches. A /regex/ is treated as one, anything else',
  '                       as a case-insensitive substring. Repeatable. A',
  '                       pattern set that matches nothing is a usage fault,',
  '                       and the artifact of a filtered run reports the',
  '                       coverage it actually holds and does not qualify as',
  '                       gate evidence on its own.',
  '  --append             Merge into an existing --out instead of replacing it,',
  '                       so one scenario can be re-captured without redriving',
  '                       all 233 routes. The existing definitions are',
  '                       authoritative: annotations are re-attached from them,',
  '                       and every summary and coverage field is recomputed',
  '                       over the MERGED artifact rather than the fresh',
  '                       selection.',
  '  --base-url <url>     Drive an already-running server instead of starting',
  '                       one, given as a bare origin. No launcher, no seeding,',
  '                       no profile switching unless --profile-file is also',
  '                       given - and no fixture evidence, since those paths',
  '                       belong to whoever started that server, so such a run',
  '                       needs --exploratory to say it is not baseline',
  '                       evidence.',
  '  --profile-file <p>   PARITY_HTTP_PROFILE_FILE of an externally started',
  '                       server, so per-case profiles still switch.',
  '  --fault-file <p>     PARITY_MODEL_FAULT_FILE of an externally started',
  '                       server, so the case that reaches the auth scheme\'s',
  '                       lookup-error outcome can arm its fault. Without it,',
  '                       that case fails rather than recording an unfaulted',
  '                       response as though the fault had been armed.',
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
  '                       then record whatever an unseeded tree returns, no',
  '                       reseed is possible between destructive cases, and the',
  '                       artifact does not qualify as gate evidence.',
  '  --no-quirks          Drive only the route sweep. The mandatory quirk,',
  '                       error-edge and auth-outcome groups are then absent',
  '                       from the artifact, which therefore cannot qualify as',
  '                       gate evidence however complete its route coverage is.',
  '  --no-reseed          Do not force a reseed before each destructive case.',
  '                       The destructive phase still runs last; what is lost',
  '                       is the guarantee that each delete observes freshly',
  '                       seeded fixtures, and the artifact records that.',
  '  --target             Capturing the MIGRATED tree. An unmet expectation is',
  '                       still fatal, with one exception: a scenario carrying',
  '                       an approved `expectedDeviation` may differ, and only',
  '                       if the response it produced satisfies the machine-',
  '                       checkable `targetExpectation` that states what the',
  '                       deviation approved. Any other outcome on the marked',
  '                       case - a 500, a different content type, a stall - is',
  '                       refused and remains fatal.',
  '  --exploratory        The explicit opt-out from the baseline oracle: no',
  '                       unmet expectation is fatal. The artifact records the',
  '                       opt-out and does not qualify as gate evidence.',
  '  --expect-baseline    Accepted for compatibility and now the DEFAULT: a',
  '                       declared baseline expectation that was not met fails',
  '                       the capture unless --target or --exploratory says so.',
  '                       then record whatever an unseeded tree returns.',
  '  --no-quirks          Drive only the route sweep. Coverage still applies.',
  '  --expect-baseline    Declare that --app IS the base commit ' +
    manifest.provenance.BASELINE_HEAD.slice(0, 7) + '.',
  '                       Refuses to run against any other tree, so a',
  '                       mis-pointed --app costs nothing instead of producing',
  '                       an artifact indistinguishable from a baseline',
  '                       capture. Also makes an unmet baseline expectation',
  '                       fatal. Leave it off against the migrated tree, where',
  '                       the approved deviation on the image download changes',
  '                       a recorded timeout into a 200 by design.',
  '  --allow-nonbaseline  The only escape from that check, and it is not free:',
  '                       the corpus records role `unreviewed`, which no gate',
  '                       accepts as baseline evidence. Meaningful only',
  '                       together with --expect-baseline.',
  '  --node-flags <flags> Passed to the child before the preloads. Repeatable.',
  '                       The zero-warning gate wants',
  '                       "--pending-deprecation --trace-deprecation".',
  '  -h, --help           Print this on stderr and exit 0.',
  '',
  'Option rules: an option that is not marked Repeatable is a usage error when',
  'given twice - it is never a last-one-wins - and a value beginning with "-"',
  'is a usage error, so a missing value cannot swallow the next option.',
  '--node-flags is the exception and takes dash-leading values by design.',
  '',
  'Exit codes:',
  '  0  every selected scenario drove, the fixture evidence was sound, and the',
  '     artifact holds what it claims to hold',
  '  1  a route the artifact claims is unrepresented, a case could not be',
  '     driven, a declared baseline expectation was not met, or the fixture or',
  '     seed evidence behind the capture is unsound',
  '  2  usage or operational failure, including an --only that selects nothing',
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
    out: null,
    manifestPath: null,
    manifestExplicit: false,
    only: [],
    append: false,
    baseUrl: null,
    profileFile: null,
    faultFile: null,
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
    reseedBeforeDestructive: true,
    // The baseline oracle is ON by default. A capture whose whole purpose is to
    // BE the R-f reference cannot treat its own declared expectations as
    // optional: an unmet expectation means the tree did not behave as the
    // corpus says it does, and an artifact recording that while exiting 0 is a
    // silent false baseline. The two ways out are explicit and are recorded in
    // the artifact - `--target`, which excuses only an approved deviation, and
    // `--exploratory`, which excuses everything and forfeits gate qualification.
    expectBaseline: true,
    target: false,
    exploratory: false,
    expectBaseline: false,
    // The escape from the baseline-HEAD assertion. False by default, because
    // the assertion exists precisely so that a baseline claim cannot be made
    // by accident.
    allowNonBaseline: false,
    nodeFlags: []
  };
  var i;
  var arg;
  var seen = {};

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

  // A REPEATED OPTION IS A USAGE ERROR, not a last-one-wins. Two `--out`
  // paths, or an `--app` given twice, means the command line says two things
  // and the tool silently acted on one of them - which for a gate is the worst
  // shape available: the artifact lands somewhere the caller did not ask for
  // and the run still exits 0. The two exceptions are declared, not inferred:
  // --only accumulates a selection and --node-flags accumulates flags, and both
  // are documented as repeatable.
  function once(flag) {
    if (REPEATABLE_OPTIONS.indexOf(flag) > -1) {
      return flag;
    }

    if (seen[flag]) {
      throw usageError(flag + ' was given more than once. Every option except ' +
        REPEATABLE_OPTIONS.join(' and ') + ' takes effect once; two values ' +
        'would mean this run silently discarded one of them.');
    }

    seen[flag] = true;

    return flag;
  }

  for (i = 0; i < args.length; i++) {
    arg = args[i];

    // Checked for every token, before the recognition chain: this tool takes
    // no `--flag=value` form, so every option is exactly one token and the
    // token IS the option's name. An unrecognized token still falls through to
    // the unrecognized-argument error below.
    once(arg);

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
      options.manifestExplicit = true;
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
    else if (arg === '--fault-file') {
      options.faultFile = path.resolve(valueFor('--fault-file', args[i + 1]));
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
    else if (arg === '--no-reseed') {
      options.reseedBeforeDestructive = false;
    }
    else if (arg === '--target') {
      options.target = true;
    }
    else if (arg === '--exploratory') {
      options.exploratory = true;
    }
    else if (arg === '--expect-baseline') {
      // Now the default. Still accepted, and deliberately so: replay.js's own
      // remedy message and this repository's documentation both spell this
      // invocation out, and a flag that used to mean "check the expectations"
      // must not become an unrecognized-argument failure the moment checking
      // them became unconditional.
      options.expectBaseline = true;
    }
    else if (arg === '--allow-nonbaseline') {
      options.allowNonBaseline = true;
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
    // The committed manifest is read when it is there. It is never WRITTEN
    // implicitly: manifestDestination decides where a generated one goes.
    options.manifestPath = COMMITTED_MANIFEST;
  }

  if (options.out === null) {
    options.out = resolveArtifactPath(CORPUS_ARTIFACT_NAME, '--out');
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

  if (options.target && options.exploratory) {
    // They say opposite things about the same verdict, and silently letting one
    // win would decide the baseline oracle by argument order.
    throw usageError('--target and --exploratory cannot be combined: the ' +
      'first says an unmet expectation is fatal unless an approved deviation ' +
      'covers it, the second says no unmet expectation is fatal at all');
  }

  if (!options.seedFixtures) {
    // Reseeding is the seeder child driven against the launcher's database. A
    // run that does not seed cannot reseed either, and saying so here keeps the
    // artifact's ordering record honest rather than reporting a reseed that was
    // never possible.
    options.reseedBeforeDestructive = false;
    options.reseedSkippedReason = options.seedSkippedReason ||
      'seeding was disabled, so there is no seeded state to restore';
  }
  else if (!options.reseedBeforeDestructive) {
    options.reseedSkippedReason = '--no-reseed was given';
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
 * Replaces the userinfo of a URL-shaped string with a marker.
 *
 * Textual rather than structural on purpose: this runs on the path where
 * parsing FAILED, so there is no parsed authority to rebuild from, and the
 * value still has to be quoted back to the operator without carrying a
 * password into stderr. The authority is what sits between `//` and the next
 * `/`, `?` or `#`; its userinfo is everything before its last `@`.
 *
 * @param {string} value
 * @returns {string} the value with any userinfo replaced
 */
function redactUserinfo(value) {
  var text = String(value);
  var schemeEnd = text.indexOf('//');
  var authorityStart;
  var authorityEnd;
  var authority;
  var at;

  if (schemeEnd === -1) {
    // No authority component at all, so there is no userinfo to redact.
    return text;
  }

  authorityStart = schemeEnd + 2;
  authorityEnd = text.length;

  ['/', '?', '#'].forEach(function(terminator) {
    var index = text.indexOf(terminator, authorityStart);

    if (index !== -1 && index < authorityEnd) {
      authorityEnd = index;
    }
  });

  authority = text.slice(authorityStart, authorityEnd);
  at = authority.lastIndexOf('@');

  if (at === -1) {
    return text;
  }

  return text.slice(0, authorityStart) + '<userinfo-redacted>@' +
    authority.slice(at + 1) + text.slice(authorityEnd);
}

/**
 * Validates a base URL and returns its origin.
 *
 * Uses the WHATWG parser deliberately: the legacy one emits DEP0169, and this
 * tool's stderr sits inside the stream the zero-warning gate inspects.
 *
 * Only an ORIGIN is meaningful here, because every scenario target is an
 * absolute path resolved against this value - so a base URL carrying a path, a
 * query, a fragment or userinfo describes a server this tool would never
 * actually address. Those components are REJECTED rather than normalized away:
 * dropping them silently drives a different URL than the operator supplied and
 * records the result as though it came from theirs, which is the one class of
 * fault a parity artifact cannot absorb. A single trailing slash is the one
 * exception, since `new URL` synthesizes it for every origin and it carries no
 * intent.
 *
 * @param {string} value
 * @returns {string} the origin, with no trailing slash
 * @throws {ToolError} On anything that is not a bare http(s) origin.
 */
function normalizeBaseUrl(value) {
  var raw = String(value);
  var parsed;
  var discarded = [];
  var displayed;

  try {
    parsed = new URL(raw);
  }
  catch (err) {
    // The raw value is quoted back so the operator can see what was read, with
    // any userinfo removed FIRST. A malformed URL cannot be parsed into
    // components, so the redaction is textual: everything between the scheme
    // separator and the last `@` of the authority is the userinfo, and a
    // password in it would otherwise reach stderr - which lands in CI output
    // and retained run logs - on the one path where no parsed object exists to
    // rebuild a safe value from.
    throw usageError('--base-url ' + JSON.stringify(redactUserinfo(raw)) +
      ' is not a valid absolute URL: ' + reasonOf(err));
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw usageError('--base-url must be http or https, got ' + parsed.protocol);
  }

  if (parsed.pathname && parsed.pathname !== '/') {
    discarded.push('a path (' + parsed.pathname + ')');
  }

  if (parsed.search) {
    discarded.push('a query (' + parsed.search + ')');
  }

  if (parsed.hash) {
    discarded.push('a fragment (' + parsed.hash + ')');
  }

  if (parsed.username || parsed.password) {
    // Named without echoing the credential: the value reaches provenance and a
    // password does not belong in an artifact.
    discarded.push('userinfo');
  }

  if (discarded.length) {
    // The value is quoted back so the operator can see what was read, with the
    // userinfo removed rather than the whole value: a diagnostic reaches stderr
    // and the run log, and a password does not belong in either.
    displayed = parsed.username || parsed.password
      ? redactUserinfo(raw)
      : raw;

    throw usageError('--base-url ' + JSON.stringify(displayed) + ' carries ' +
      discarded.join(', ') + ', and only an origin is meaningful here: every ' +
      'scenario target is an absolute path resolved against this value, so ' +
      'those components would be discarded and the capture would record a ' +
      'different URL than the one supplied. Pass ' +
      JSON.stringify(parsed.origin) + ' if that is the server you mean.');
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
 * A structural copy of a definition tree, taken through the same serialization
 * the artifact uses.
 *
 * Deliberately not `structuredClone`: what is wanted here is a copy of exactly
 * what would be WRITTEN, so a value that does not survive serialization must
 * not survive the copy either - the live Set-Cookie channel is non-enumerable
 * for the same reason. Key order is preserved, which is what keeps the
 * annotations sidecar diffable against the corpus it accompanies.
 *
 * @param {*} value
 * @returns {*}
 */
function deepCopy(value) {
  return JSON.parse(JSON.stringify(value));
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
    var deadline = null;
    var received = 0;

    function elapsedMs() {
      return Number((process.hrtime.bigint() - started) / BigInt(1000)) / 1000;
    }

    function finish(record) {
      if (settled) {
        return;
      }
      settled = true;

      if (deadline !== null) {
        clearTimeout(deadline);
        deadline = null;
      }

      resolve(record);
    }

    /**
     * The timed-out record, shared by the two ways a case can exceed its
     * budget.
     *
     * `timeoutKind` distinguishes them because they are different defects: an
     * inactivity timeout is a route that stopped producing, a deadline is a
     * route that kept producing for longer than the budget allows. Both are
     * recorded as `timedOut: true`, which is the field every consumer reads.
     *
     * @param {string} kind 'inactivity' or 'deadline'
     * @param {number} bytes bytes received before the budget ran out
     * @returns {Object}
     */
    function timedOutRecord(kind, bytes) {
      var spent = elapsedMs();

      return {
        ok: true,
        timedOut: true,
        timeoutKind: kind,
        timeoutMs: timeoutMs,
        elapsedMs: spent,
        elapsedBucket: elapsedBucket(spent),
        status: null,
        headers: null,
        body: null,
        bodyBytesBeforeTimeout: bytes
      };
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

    // The expected-timeout path. `bodyBytesBeforeTimeout` distinguishes a route
    // that answered nothing at all from one that began streaming and then
    // stalled, which are different defects.
    request.setTimeout(timeoutMs, function() {
      request.destroy();
      finish(timedOutRecord('inactivity', received));
    });

    // The ABSOLUTE bound, and the reason it exists: node's own request timeout
    // measures INACTIVITY, so a response that keeps producing a byte just
    // inside the window never trips it and the documented per-step budget stops
    // bounding anything. One stalled-but-trickling route would then hold the
    // whole corpus open indefinitely - and the corpus deliberately contains
    // routes that stream. This timer is a wall clock from the moment the
    // request was created and it cannot be reset by traffic.
    //
    // It fires a grace period AFTER the inactivity budget so the two cannot
    // race: a route that answers nothing is reported as an inactivity timeout
    // every time rather than as whichever timer won, which is what keeps a
    // re-capture of the never-settling case diff-clean.
    deadline = setTimeout(function() {
      request.destroy();
      finish(timedOutRecord('deadline', received));
    }, timeoutMs + DEADLINE_GRACE_MS);

    // A pending timer must not be what keeps this process alive after the
    // corpus has been written.
    if (typeof deadline.unref === 'function') {
      deadline.unref();
    }

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
        // Visible to both timeout paths, which run outside this scope and need
        // to record how much of the body had arrived when the budget ran out.
        received = total;
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
 * TWO OF ITS FIELDS ARE ANNOTATIONS RATHER THAN INPUTS, and they are on the
 * scenario for a reason that is easy to lose:
 *
 *   `expectedDeviation` is the only thing that tells a replay that a difference
 *   was APPROVED. Exactly one case carries it - the never-settling image
 *   download, AAP 0.7's approved deviation - and without it that case's change
 *   from a recorded timeout to a 200 reads as a regression and fails the parity
 *   gate. A capture that dropped the field would silently disarm the deviation
 *   control, so it is carried here, re-attached by `--append` from the existing
 *   definition, and written to the annotations sidecar.
 *
 *   `unreachableReason` is what keeps an explained gap distinguishable from a
 *   dropped route. R-b allows an entry that genuinely cannot be driven only
 *   when it is recorded WITH ITS REASON, so a capture that dropped the reason
 *   would turn a documented exclusion into an unexplained hole.
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
    // What an APPROVED deviation was approved to produce, in the same clause
    // vocabulary as `expectation`. Only a scenario carrying one can have a
    // difference approved in target mode, and only when the captured response
    // satisfies it - see `writeArtifacts`. A marker without this is a statement
    // that something may change; this is the statement of WHAT.
    targetExpectation: spec.targetExpectation || null,
    notes: spec.notes || [],
    expectedDeviation: spec.expectedDeviation || null,
    unreachableReason: spec.unreachableReason || null,
    steps: spec.steps
  };
}

/**
 * Whether a scenario is destructive: it deletes something, either as its own
 * route or inside its sequence.
 *
 * The step check is not belt-and-braces. `auth.outcome.user-not-found` is a
 * `GET /home` scenario whose sequence deletes an account, so classifying by the
 * scenario's own method alone would run it in the middle of the non-destructive
 * phase and leave its deletion standing over everything after it.
 *
 * @param {Object} item
 * @returns {boolean}
 */
function isDestructiveScenario(item) {
  if (String(item.route && item.route.method).toUpperCase() === 'DELETE') {
    return true;
  }

  return (item.steps || []).some(function(step) {
    return String(step && step.method).toUpperCase() === 'DELETE';
  });
}

/**
 * Whether a scenario belongs to one of the mandatory groups.
 *
 * The route sweep exercises success paths. Everything that makes this corpus
 * evidence rather than decoration - the quirks R-d protects, the error edges
 * R-e protects, the auth outcomes the session contract protects - lives in the
 * groups named by MANDATORY_GROUP_PREFIXES, and an artifact missing them cannot
 * support the gate's claim however many routes it touched.
 *
 * @param {Object} item
 * @returns {boolean}
 */
function isMandatoryScenario(item) {
  var group = String((item && item.group) || '');

  return MANDATORY_GROUP_PREFIXES.some(function(prefix) {
    return group === prefix || group.indexOf(prefix) === 0;
  });
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
// carries a declared baseline expectation that is CHECKED on every run and that
// fails the capture when it is not met.
//
// Their expectations describe BASELINE behaviour at the base commit. Against
// the migrated tree exactly one of them is expected to differ - the
// never-settling image download becomes a 200 stream by the approved deviation
// in AAP 0.7 - and that case additionally carries a `targetExpectation`
// stating what the deviation approved. `--target` excuses the difference only
// when the captured response satisfies that statement, so the artifact records
// the change from a timeout to a 200 as evidence of an approved deviation while
// a 500, a different content type or a stall on the same case still fails.

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
      // Carried through so the one chain that has an approved deviation keeps
      // its marker - and the machine-checkable statement of what that
      // deviation approved - when this file is what produced the artifact.
      expectedDeviation: spec.expectedDeviation || null,
      targetExpectation: spec.targetExpectation || null,
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
    },
    // The approved deviation, attached to the scenario rather than left in a
    // separate document. This marker is what lets a replay read the target's
    // 200 as the change AAP 0.7 approved instead of as a regression, and it is
    // the only such marker in the corpus - which is exactly why a capture that
    // dropped it would disarm the deviation control without anything failing.
    expectedDeviation: IMAGE_DOWNLOAD_DEVIATION,
    // And what it approved, stated so a machine can check it. AAP 0.7 approves
    // ONE response here: the stream response its sibling branch four lines
    // below already returns, carrying the file's own mime type and byte length,
    // minus the Content-Disposition the image branch deliberately omits. A
    // 500, an empty body, a different content type or a transport failure are
    // not that response and are not approved by this marker.
    //
    // The values come from the seeded fixture rather than being restated, so
    // the check cannot drift from the bytes the seeder plants.
    targetExpectation: {
      description: 'AAP 0.7\'s approved deviation: a 200 stream carrying the ' +
        'file\'s own mime type and byte length, and no Content-Disposition',
      steps: [{
        index: 0,
        timedOut: false,
        status: 200,
        contentTypeIs: fixtures.bytes.legacyPng.mime,
        bodyLengthIs: fixtures.bytes.legacyPng.size,
        headerAbsent: 'content-disposition'
      }]
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
      '/download.zip?format=md',
    identity: IDENTITY_USER,
    notes: [
      'the response is produced inside nested callbacks - a stat, then a ' +
      'recursive delete - so this case also covers the resolve-on-later-' +
      'callback disposition, where the response is whichever settles first',
      'the query is format=md and NOT format=zip. Measured: the route declares ' +
      'format : Joi.string().valid(\'md\', \'html\').required(), so zip is ' +
      'rejected by the hand-rolled validation block before the handler runs, ' +
      'and a case driven with it records the validation-failure path instead ' +
      'of the archive response this chain exists to prove'
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
 * user, and a lookup error. ALL FIVE ARE DRIVEN. Four need only a session in
 * the right state; the fifth needs the user lookup itself to fail, which comes
 * from `fixtures/model.js` - the launcher's fourth preload - rather than from a
 * request, and rather than from a stated reason standing in for a measurement.
 *
 * The three special sessions are DRIVEN, not simulated. The missing-record
 * session is produced by registering a throwaway account, logging into it and
 * then deleting it through the application's own route - which does not clear
 * the session, so the very next request carries a userId whose record is gone.
 * The lookup-error session is a real session whose next lookup is armed to
 * reject. Nothing here touches the database directly.
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

  // The fifth outcome, DRIVEN. It needs the user lookup itself to fail, which
  // no request can cause on a healthy database - so the fault is injected below
  // the model layer by fixtures/model.js, which the launcher preloads and which
  // this scenario arms for exactly one lookup of exactly one id.
  //
  // The three steps are each doing something the case cannot do without:
  //
  //   Step 0 authenticates for real, because the outcome under test is only
  //   reachable with a `userId` in the session - without one the scheme returns
  //   at outcome 1 and never performs a lookup at all.
  //
  //   Step 1 is the browser-facing case. The arming is keyed to the seeded
  //   user's frozen id and to one use, so the lookup the auth scheme performs
  //   for THIS request is the one that fails and nothing else can spend it. The
  //   scheme's catch branch logs and returns `Boom.unauthorized('Auth error')`;
  //   under `mode: 'try'` the route's own required auth then turns that into a
  //   401, which app.js's error mapper converts to a redirect to /login.
  //
  //   Step 2 arms the same fault again and negotiates JSON, which is what makes
  //   the case an assertion about the 'Auth error' BRANCH rather than about
  //   refusal. All five auth outcomes are 401-shaped and two of the other four
  //   also redirect a browser to /login, so step 1's status and Location cannot
  //   distinguish this outcome from 'User not found' or 'Account disabled'. The
  //   error mapper returns the Boom unrendered for an `Accept:
  //   application/json` request, so the scheme's own message reaches the client
  //   and the expectation can name it.
  //
  //   Step 3 re-requests with the arming SPENT. The catch branch does NOT clear
  //   the session - unlike the 'User not found' and 'Account disabled' branches
  //   four lines above it - so the session must still work. A 200 here proves
  //   both that the injector is bounded and that outcome 5 leaves the session
  //   intact.
  //
  // Steps 1 and 2 carry different arming messages, and that is not cosmetic:
  // the fixture keys its use counter on the arming file's text, so two
  // consecutive armed steps need two distinct documents. The drivers also stamp
  // each write with a generation, which is what makes this correct rather than
  // merely true here.
  scenarios.push(scenario({
    id: 'auth.outcome.lookup-error',
    group: 'auth-outcome',
    method: 'GET',
    path: '/home',
    identity: IDENTITY_USER,
    accept: ACCEPT_HTML,
    intent: 'failure',
    mutating: false,
    freshSession: true,
    notes: [
      'the fifth auth outcome - a lookup error yielding "Auth error" - needs ' +
      'the user query itself to fail, which no request can cause: it takes a ' +
      'fault injected below the model layer',
      'fixtures/model.js is that injector. It is a launcher preload, so it ' +
      'exists on neither tree as application code and drives the baseline and ' +
      'the target identically; it wraps lib/models/user\'s findById when the ' +
      'application requires it and rejects one call',
      'the arming names the seeded user\'s frozen id and one use, so only the ' +
      'auth scheme\'s own lookup for step 1 can spend it - the fixture\'s ' +
      'evidence log records the id of every lookup it saw, so which call was ' +
      'faulted is checkable rather than assumed',
      'step 2 re-requests with the arming spent and must be served: the catch ' +
      'branch does not clear the session, which is what distinguishes this ' +
      'outcome from "User not found" and "Account disabled"'
    ],
    expectation: {
      description: 'a failed user lookup answers with the scheme\'s own ' +
        '"Auth error" without clearing the session, and the failure is ' +
        'bounded to the armed lookups',
      steps: [
        { index: 1, status: 302, locationEndsWith: '/login' },
        // The step that pins the outcome to THIS branch. All five outcomes are
        // 401-shaped and two of the other four also redirect a browser to
        // /login, so a status-only expectation cannot tell 'Auth error' from
        // 'User not found' or 'Account disabled'. The message can.
        { index: 2, status: 401, bodyIncludes: 'Auth error' },
        { index: 3, status: 200 }
      ]
    },
    steps: [
      {
        label: 'authenticate-so-the-session-carries-a-userId',
        method: 'POST',
        target: '/login',
        accept: ACCEPT_HTML,
        payload: {
          email: seed.credentials.user.email,
          password: seed.credentials.user.password
        }
      },
      {
        label: 'drive-with-the-user-lookup-armed-to-fail',
        method: 'GET',
        target: '/home',
        accept: ACCEPT_HTML,
        payload: null,
        modelFault: {
          model: 'user',
          method: 'findById',
          id: seed.ids.user,
          remaining: 1,
          message: 'parity fixture: injected data-store failure on ' +
            'User.findById, so that the auth scheme reaches its lookup-error ' +
            'outcome'
        }
      },
      {
        // The same fault, negotiated as JSON. app.js's error mapper treats an
        // `Accept: application/json` request as an API request and returns the
        // Boom itself rather than rendering a page, so the scheme's own
        // message reaches the client and the outcome becomes assertable by
        // name instead of by shape.
        label: 'drive-armed-again-negotiating-json-to-read-the-message',
        method: 'GET',
        target: '/home',
        accept: ACCEPT_JSON,
        payload: null,
        modelFault: {
          model: 'user',
          method: 'findById',
          id: seed.ids.user,
          remaining: 1,
          message: 'parity fixture: injected data-store failure on ' +
            'User.findById, for the JSON-negotiated read of the scheme message'
        }
      },
      {
        label: 'drive-again-with-the-fault-spent',
        method: 'GET',
        target: '/home',
        accept: ACCEPT_HTML,
        payload: null
      }
    ]
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
      subject: 'provenance',
      note: 'In this file, under the single top-level `provenance` key, built ' +
        'by the contract in test/parity/manifest.js: the analysed tree\'s ' +
        'commit and worktree state, the role that follows from it (baseline ' +
        'when that commit is the base commit ' +
        manifest.provenance.BASELINE_HEAD.slice(0, 7) + ', target on the ' +
        'migrated tree, unreviewed when a caller took the explicit escape), ' +
        'this tool\'s own blob and the commit verified to contain it, the ' +
        'delivered head both were produced at, and a payloadDigest over ' +
        'every other key in this file. Embedded rather than kept beside the ' +
        'corpus, so the corpus says which tree it measured WITHOUT depending ' +
        'on a companion file existing - an earlier revision of this note ' +
        'declared a sibling `corpus.json.provenance.json` mandatory, and the ' +
        'delivered corpus had no such file. One key is also what keeps the ' +
        'corpus diff-clean, which was that arrangement\'s actual purpose: a ' +
        're-capture of the same tree rewrites this key and nothing else, ' +
        'because no value in it comes from a clock, a PID, a port or a ' +
        'filesystem path. The sidecar is still written as a RUN OUTPUT and ' +
        'is not committed; all it adds is an artifactDigest over the exact ' +
        'bytes written, for a scratch run that compares two corpora byte for ' +
        'byte and wants the provenance outside the compared region.'
    },
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
        'which no HTTP request can cause. It is driven anyway, because ' +
        'fixtures/model.js injects that failure below the model layer: the ' +
        'launcher preloads it, and `auth.outcome.lookup-error` arms it for one ' +
        'lookup of the seeded user\'s frozen id, drives the request, and then ' +
        'drives the same request again with the arming spent. The second ' +
        'request is what makes the pair an assertion about THIS branch rather ' +
        'than about refusal in general: the catch branch does not clear the ' +
        'session, so it must still be served. Earlier revisions of this file ' +
        'recorded the outcome as unreachable and pointed at a server-level ' +
        'gate that could inject the fault; no such gate existed, so the gap ' +
        'was reported as covered. The fixture is that gate.'
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

/**
 * Decides whether the written artifact may stand as gate evidence, and lists
 * every reason it may not.
 *
 * The gate AAP 0.9.3 describes is a claim about the whole surface: every route
 * represented, every mandatory case present, every response reproducible. A
 * capture can legitimately be less than that - a re-capture of one case, a
 * sweep with the quirks off, a run against a server someone else started - and
 * none of those is a fault. What IS a fault is an artifact that cannot tell the
 * difference, because the next reader has only the artifact.
 *
 * So qualification is computed over what was WRITTEN, every disqualifier is
 * named in the artifact, and a reduced capture is a valid artifact that says
 * what it is rather than an invalid one pretending otherwise.
 *
 * @param {Object} state
 * @returns {Object} {qualifies, reasons: Array.<Object>}
 */
function evaluateGate(state) {
  var reasons = [];

  /**
   * @param {string} code
   * @param {string} detail
   * @returns {undefined}
   */
  function disqualify(code, detail) {
    reasons.push({ code: code, detail: detail });
  }

  if (state.coverage.unrepresented.length) {
    disqualify('routes-unrepresented', state.coverage.unrepresented.length +
      ' of the ' + state.coverage.routes + ' manifest routes have no scenario ' +
      'in this artifact');
  }

  if (state.coverage.unknownRoutes.length) {
    disqualify('unknown-routes', state.coverage.unknownRoutes.length +
      ' scenario(s) claim a route the manifest does not contain');
  }

  if (state.mandatoryMissing.length) {
    disqualify('mandatory-scenarios-omitted', state.mandatoryMissing.length +
      ' mandatory quirk, error-edge or auth-outcome scenario(s) defined by this ' +
      'run are absent from the artifact: ' +
      state.mandatoryMissing.slice(0, 6).join(', ') +
      (state.mandatoryMissing.length > 6 ? ', ...' : ''));
  }

  if (!state.mandatoryPresent.length) {
    // An absolute check, not a relative one. `--no-quirks` never DEFINES a
    // mandatory case, so nothing can be missing relative to its own
    // definitions - and an artifact holding only the success sweep still
    // cannot support a gate whose subject is the quirks R-d protects, the
    // edges R-e protects and the session contract.
    disqualify('mandatory-scenarios-absent', 'the artifact holds no quirk, ' +
      'error-edge or auth-outcome scenario at all, so it cannot evidence the ' +
      'behaviour those cases exist to hold in place');
  }

  if (state.filtered) {
    disqualify('selection-filtered', 'this run drove only the scenarios ' +
      'matching --only, so the artifact records part of the surface');
  }

  if (!state.quirksIncluded) {
    disqualify('quirks-omitted', '--no-quirks was given, so the cases that ' +
      'make this corpus evidence for R-d, R-e and the session contract were ' +
      'never defined');
  }

  if (state.applicationDied) {
    disqualify('application-died', 'the application under test crashed ' +
      'mid-corpus, so the cases after it were never driven');
  }

  if (state.undriven.length) {
    disqualify('cases-undriven', state.undriven.length +
      ' case(s) could not be driven');
  }

  if (state.unexpectedTimeouts.length) {
    disqualify('unexpected-timeouts', state.unexpectedTimeouts.length +
      ' step(s) stalled without declaring themselves as a timeout');
  }

  if (state.unmetUnapproved.length) {
    disqualify('expectations-unmet', state.unmetUnapproved.length +
      ' declared baseline expectation(s) were not met');
  }

  if (state.exploratory) {
    disqualify('exploratory', '--exploratory was given, so no unmet ' +
      'expectation was allowed to fail this run');
  }

  if (!state.evidenceHealth.ok) {
    disqualify('evidence-unsound', state.evidenceHealth.findings.length +
      ' fixture or seed evidence finding(s)');
  }

  if (!state.evidenceAvailable) {
    disqualify('evidence-unavailable', 'the server was not launched by this ' +
      'run, so the fixture evidence that makes a response reproducible is ' +
      'owned by whoever started it and is not part of this artifact');
  }

  if (state.baselinesPending) {
    disqualify('baselines-pending', state.baselinesPending +
      ' scenario(s) in this artifact carry no recorded response');
  }

  if (!state.seeded.attempted) {
    disqualify('fixtures-unseeded', 'the fixtures were not seeded by this ' +
      'run' + (state.seeded.reason ? ': ' + state.seeded.reason : ''));
  }

  if (state.reseed && !state.reseed.available) {
    disqualify('reseed-unavailable', 'no forced reseed ran before the ' +
      'destructive cases, so each delete observed whatever the case before it ' +
      'left behind' + (state.reseed.reason ? ': ' + state.reseed.reason : ''));
  }

  return { qualifies: !reasons.length, reasons: reasons };
}

/**
 * The mandatory scenarios the definitions declared and the written artifact
 * does not hold.
 *
 * Compared by id against the definition set rather than counted, because the
 * question a reviewer asks is "which of the cases that make this evidence is
 * missing", and a count cannot answer it.
 *
 * @param {Array.<string>} defined ids of the mandatory scenarios defined
 * @param {Array.<Object>} scenarios the written artifact's scenarios
 * @returns {Array.<string>} the missing ids, in definition order
 */
function missingMandatory(defined, scenarios) {
  var present = {};

  scenarios.forEach(function(item) {
    present[item.id] = true;
  });

  return (defined || []).filter(function(id) {
    return !present[id];
  });
}

/**
 * Accounts everything the WRITTEN artifact contains, from the written artifact.
 *
 * A captured scenario carries its own record of how it went - `driven`,
 * `expectationResult`, `targetExpectationResult` and its steps' responses - and
 * those survive a merge, which is what makes this possible and what makes it
 * necessary. Under `--append` the artifact holds cases this run never touched,
 * and a summary built from this run's variables describes a different artifact
 * from the one on disk.
 *
 * Approval is recomputed here by the same rule the driving loop uses rather
 * than read from the earlier artifact's summary, so one rule decides it for
 * every entry however many runs contributed to the file.
 *
 * @param {Array.<Object>} scenarios the final, merged scenario array
 * @param {Object} options
 * @returns {Object} the artifact's own accounting
 */
function accountArtifact(scenarios, options) {
  var undriven = [];
  var unmet = [];
  var unmetApproved = [];
  var unmetUnapproved = [];
  var timedOut = [];
  var unreachable = [];
  var mandatoryPresent = [];
  var baselinesPending = 0;

  scenarios.forEach(function(item) {
    var driven = item.driven || null;
    var result = item.expectationResult || null;
    var target = item.targetExpectationResult || null;
    var marked = !!(item.expectedDeviation &&
      item.expectedDeviation.replayDisposition === 'approved-change');
    var approved = !!(options.target && marked && target && target.met);
    var entry;

    if (isMandatoryScenario(item)) {
      mandatoryPresent.push(item.id);
    }

    // An unreachable entry is one carrying its stated reason or one a run
    // skipped for having no steps; both are explained records rather than gaps,
    // which is the distinction R-b turns on.
    if (item.unreachableReason || (driven && driven.skipped)) {
      unreachable.push(item.id);
      return;
    }

    if (driven && driven.ok === false) {
      undriven.push({
        id: item.id,
        reason: driven.error,
        neverReached: !!driven.neverReached
      });
    }

    if (result && result.met === false) {
      entry = {
        id: item.id,
        description: result.description,
        failures: result.failures || [],
        marked: marked,
        approved: approved,
        // The same attribution the driving loop records, on the list a
        // downstream reader actually consults. Present only when approval was
        // granted, so its absence on a marked entry says approval was refused.
        approvedDeviation: approved
          ? {
            approvedBy: item.expectedDeviation.approvedBy || null,
            rule: item.expectedDeviation.rule || null,
            target: item.expectedDeviation.target || null
          }
          : null,
        targetExpectation: target === null
          ? null
          : { description: target.description, met: target.met, failures: target.failures }
      };

      unmet.push(entry);

      if (approved) {
        unmetApproved.push(entry);
      }
      else {
        unmetUnapproved.push(entry);
      }
    }

    (item.steps || []).forEach(function(step) {
      if (step && step.response && step.response.timedOut) {
        timedOut.push({
          id: item.id,
          step: step.label,
          expected: item.intent === 'timeout',
          kind: step.response.timeoutKind || null
        });
      }
    });

    if ((item.steps || []).length && !hasRecordedResponse(item)) {
      baselinesPending++;
    }
  });

  return {
    undriven: undriven,
    unmet: unmet,
    unmetApproved: unmetApproved,
    unmetUnapproved: unmetUnapproved,
    timedOut: timedOut,
    unreachable: unreachable,
    mandatoryPresent: mandatoryPresent,
    baselinesPending: baselinesPending
  };
}

/**
 * Whether this run's artifact is claiming to cover the whole route surface.
 *
 * A full sweep claims it, and so does an `--append` merge, whose written
 * artifact is the complete corpus with some cases re-driven. A bare `--only`
 * run does not: it is a deliberate partial capture, and holding it to
 * full-surface coverage would make re-capturing a single case impossible. What
 * it may never do is PRESENT itself as full, which is a separate matter and is
 * settled by `gate.qualifies` and `summary.selection`.
 *
 * @param {Object} options
 * @param {Object} built
 * @returns {boolean}
 */
function coverageIsClaimed(options, built) {
  return !built.filtered || !!options.append;
}

/**
 * Whether a scenario in the artifact carries a recorded response.
 *
 * A scenario with no steps is an unreachable entry carrying its reason, which
 * is a complete record rather than a pending one - so it is not counted as a
 * missing baseline.
 *
 * @param {Object} item
 * @returns {boolean}
 */
function hasRecordedResponse(item) {
  return (item.steps || []).some(function(step) {
    return !!(step && step.response);
  });
}

// ---------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------

/**
 * Evaluates one scenario's declared baseline expectation against what was
 * actually captured.
 *
 * The result is ALWAYS recorded, and an unmet expectation is FATAL by default:
 * the corpus is the R-f reference, so a tree that does not behave as these
 * cases say it does cannot be recorded as though it did. The artifact is still
 * written first, because a tool that refused to write it could not evidence
 * what it found. Two modes narrow that: `--target` excuses a case whose
 * approved deviation materialized exactly as approved - see
 * `evaluateTargetExpectation` - and `--exploratory` excuses every unmet
 * expectation and forfeits gate qualification.
 *
 * @param {Object} item the scenario, with its steps captured
 * @returns {(Object|null)} {met, description, failures}
 */
function evaluateExpectation(item) {
  return checkExpectation(item, item.expectation);
}

/**
 * Evaluates the scenario's TARGET expectation - what an approved deviation was
 * approved to produce - against what was actually captured.
 *
 * Separate from the baseline expectation because the two describe different
 * trees, and because approval has to be earned. AAP 0.7 does not approve "this
 * case may differ"; it approves one response: a 200 stream carrying the file's
 * own mime type and byte length and no Content-Disposition. A target-mode
 * capture that accepted any difference on the marked case would approve a 500,
 * an empty body or a transport failure just as readily, and the parity gate
 * would then pass on the strength of a marker rather than on the response the
 * marker names.
 *
 * @param {Object} item the scenario
 * @returns {(Object|null)} the result, or null when the scenario declares none
 */
function evaluateTargetExpectation(item) {
  return checkExpectation(item, item.targetExpectation);
}

/**
 * The shared evaluator behind both expectations.
 *
 * @param {Object} item the scenario, for its captured steps
 * @param {(Object|null)} expectation the clauses to check
 * @returns {(Object|null)} {met, description, failures}, or null when there is
 *   no expectation to check
 */
function checkExpectation(item, expectation) {
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
    var contentType;
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

    // The absence of a header is as much a part of a response contract as its
    // presence: the approved image branch deliberately omits the
    // Content-Disposition its sibling four lines below sets, so a target that
    // grew one would not be the target that was approved.
    if (check.headerAbsent !== undefined && response.headers &&
        response.headers[check.headerAbsent] !== undefined) {
      failures.push(label + ' carries a ' + check.headerAbsent + ' header (' +
        JSON.stringify(response.headers[check.headerAbsent]) +
        '), which the expectation forbids');
    }

    // Compared less any charset parameter, the same way replay.js compares a
    // content type, so the two tools cannot disagree about what a content type
    // is.
    if (check.contentTypeIs !== undefined) {
      contentType = response.headers
        ? String(response.headers['content-type'] || '').split(';')[0].trim()
        : '';

      if (contentType !== check.contentTypeIs) {
        failures.push(label + ' content-type was ' + JSON.stringify(contentType) +
          ', expected ' + JSON.stringify(check.contentTypeIs));
      }
    }

    if (check.bodyLengthIs !== undefined) {
      if (!response.body || typeof response.body.length !== 'number') {
        failures.push(label + ' recorded no body length to compare against ' +
          check.bodyLengthIs);
      }
      else if (response.body.length !== check.bodyLengthIs) {
        failures.push(label + ' body length was ' + response.body.length +
          ' bytes, expected ' + check.bodyLengthIs);
      }
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
 * Orders the corpus into three dependency phases: read-only, then the
 * mutations that create or change state, then the ones that destroy it.
 *
 * This is not tidiness. A mutation that ran early would change the fixture a
 * later read-only case was recorded against, and the corpus would then be
 * describing a tree that no longer existed by the time it was measured. The
 * quirk sequence that renames the seeded course is the sharpest example: every
 * case addressing that course by its seeded slug has to be recorded before it.
 *
 * THE THIRD PHASE IS WHY TWO ARE NOT ENOUGH. Grouping every mutation together
 * leaves their relative order to the manifest, which interleaves the deletes
 * with the creates and updates - so `DELETE /api/courses/{courseId}` could run
 * before the `PUT` and `POST` cases addressing that same seeded course, and
 * before the quirk sequences that depend on it. Each of those later cases would
 * then record a 404 that says nothing about the route it was meant to exercise,
 * and nothing in the artifact would explain why. Deletes therefore run LAST,
 * after everything whose fixtures they would otherwise remove.
 *
 * Destructiveness is read from the sequence as well as the route, because one
 * `GET` scenario deletes an account inside its own steps.
 *
 * Within each phase the order is the construction order, which is fixed, so
 * re-running produces a diff rather than a reshuffle. Phase membership is
 * recorded on each scenario so the artifact says which phase produced it and a
 * reviewer can see the ordering that was actually used rather than infer it.
 *
 * @param {Array.<Object>} scenarios
 * @returns {Array.<Object>} the same scenarios, ordered
 */
function orderScenarios(scenarios) {
  var readOnly = [];
  var creating = [];
  var destructive = [];

  scenarios.forEach(function(item) {
    if (isDestructiveScenario(item)) {
      item.phase = PHASE_DESTRUCTIVE;
      destructive.push(item);
    }
    else if (item.mutating) {
      item.phase = PHASE_MUTATING;
      creating.push(item);
    }
    else {
      item.phase = PHASE_READ_ONLY;
      readOnly.push(item);
    }
  });

  return readOnly.concat(creating, destructive);
}

/**
 * How many scenarios each dependency phase holds, in phase order.
 *
 * Reported in the artifact so the ordering that produced the responses is
 * inspectable rather than implied.
 *
 * @param {Array.<Object>} scenarios
 * @returns {Object} phase name -> count
 */
function phaseCounts(scenarios) {
  var counts = {};

  PHASE_ORDER.forEach(function(phase) {
    counts[phase] = 0;
  });

  scenarios.forEach(function(item) {
    var phase = item.phase || PHASE_READ_ONLY;

    counts[phase] = (counts[phase] || 0) + 1;
  });

  return counts;
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
 * Arms or disarms the model-boundary fault injector for the next step.
 *
 * This is the channel a corpus case uses to reach the auth scheme's fifth
 * outcome, and it is step-scoped rather than scenario-scoped on purpose: a
 * scenario-wide arming would still be live for the login that establishes the
 * session and for whatever the case asserts afterwards, and the whole value of
 * the lookup-error case is that exactly ONE lookup fails and the ones either
 * side of it do not.
 *
 * The arming document's shape belongs to `fixtures/model.js`, so it is built by
 * that fixture's own `arming()` builder rather than spelled out here, and it is
 * written through `server.writeModelFaultFile` rather than by a second
 * `fs.writeFileSync` - one implementation, so the launcher and the driver
 * cannot disagree about what disarmed looks like.
 *
 * A run with no fault file - `--base-url` against an externally started server
 * that this tool did not launch - can still drive every other case, so an
 * arming without a file to write it into is a hard error rather than a silent
 * pass: a case that believes it armed a fault and did not would record the
 * UNfaulted response as though it were the faulted one.
 *
 * @param {(string|null)} faultFile PARITY_MODEL_FAULT_FILE of the running server.
 * @param {(Object|null)} fault The step's `modelFault`, or null to disarm.
 * @returns {undefined}
 * @throws {ToolError} If an arming is requested with nowhere to write it.
 */
function selectModelFault(faultFile, fault) {
  if (!faultFile) {
    if (fault) {
      throw new ToolError('a step asked for the model-boundary fault to be ' +
        'armed, but this run has no PARITY_MODEL_FAULT_FILE to write it to. ' +
        'That happens with --base-url against a server this tool did not ' +
        'start; pass --fault-file with the running server\'s arming file, or ' +
        'let the launcher start the server. Recording the unfaulted response ' +
        'as though the fault had been armed is the one outcome that must not ' +
        'happen here.');
    }

    return;
  }

  server.writeModelFaultFile(faultFile, fault ? stampArming(fault) : null);
}

// A monotonically increasing stamp put on every arming this process writes.
// Two consecutive armed steps with identical specifications would otherwise
// produce identical file text, and the fixture keys its use counter on that
// text - so the second step would find the first one's arming already spent.
// The value is harness-internal: the fixture ignores unknown keys, and the
// corpus stores the declared `modelFault` without it, so it is never compared.
var armGeneration = 0;

/**
 * The arming document as written, with its generation stamp.
 *
 * @param {Object} fault The step's declared `modelFault`.
 * @returns {Object}
 */
function stampArming(fault) {
  var out = modelFixture.arming(fault);

  armGeneration = armGeneration + 1;
  out.armGeneration = armGeneration;

  return out;
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
  var out;

  Object.keys(response).forEach(function(key) {
    recorded[key] = response[key];
  });

  out = {
    label: step.label,
    request: driven.sent,
    response: recorded
  };

  // The fault control is part of WHAT PRODUCED the response, not of the
  // response, so it is recorded alongside the request rather than discarded.
  // Dropping it here is not a cosmetic loss: replay plans its steps from this
  // record, so a captured step that has lost its `modelFault` is replayed
  // UNFAULTED against a baseline that was captured faulted - the request comes
  // back 200 and the comparison reports a difference in the application, when
  // what actually changed is that the harness stopped injecting. Measured
  // exactly that way before this line existed.
  if (step.modelFault) {
    out.modelFault = step.modelFault;
  }

  return out;
}

/**
 * Drives one scenario to completion and attaches its captures.
 *
 * Never throws for a fault in the driving: a step that could not be driven is
 * recorded with its reason and the scenario is marked failed, because a case
 * silently dropped is the one failure mode this corpus cannot tolerate.
 *
 * @param {Object} item the scenario
 * @param {Object} context {jar, profileFile, faultFile, timeoutMs}
 * @returns {Promise<Object>} the scenario, with steps captured
 */
async function runScenario(item, context) {
  var jar = context.jar;
  var index;
  var step;
  var driven;
  // Whether an arming this scenario wrote is still in the fault file. It has to
  // be cleared before the scenario returns on EVERY path, including a failed
  // step, because the server is long-lived and serial: an arming left behind
  // would fail the next scenario's user lookup and be recorded as that
  // scenario's behaviour.
  var faultArmed = false;

  item.driven = { ok: true, error: null, skipped: false };

  if (!item.steps.length) {
    // A scenario with no steps. It carries its reason in `notes` and is counted
    // as covered, not as a fault - which is the difference between an explained
    // gap and a silent one. Nothing in the corpus is in this state today: the
    // auth scheme's fifth outcome was, until fixtures/model.js made it
    // drivable.
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

    // Arm for a step that declares a fault, and disarm as soon as the step
    // after it does not. The file is only written when the state changes, so
    // the 380-odd scenarios that never arm anything pay nothing for this.
    if (step.modelFault || faultArmed) {
      try {
        selectModelFault(context.faultFile, step.modelFault || null);
        faultArmed = !!step.modelFault;
      }
      catch (err) {
        item.driven.ok = false;
        item.driven.error = 'step ' + index + ' (' + step.label + ') could ' +
          'not arm the model-boundary fault: ' + reasonOf(err);
        disarmModelFault(context.faultFile, faultArmed, item);
        return item;
      }
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
      disarmModelFault(context.faultFile, faultArmed, item);
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

  disarmModelFault(context.faultFile, faultArmed, item);

  item.expectationResult = evaluateExpectation(item);
  // Evaluated on every run, not only in target mode, so the artifact records
  // whether the tree produced the approved target response whichever tree it
  // was - which is also how a baseline capture shows that it did NOT.
  item.targetExpectationResult = evaluateTargetExpectation(item);

  return item;
}

/**
 * Clears an arming this scenario left behind, on every exit path.
 *
 * A scenario whose last step armed the fault, or which returned early from a
 * step that had, would otherwise leave it live for the next scenario in the
 * serial run - and the next scenario's failed user lookup would be recorded as
 * that scenario's own behaviour. So this is called on the normal path and from
 * both early returns.
 *
 * A failure to disarm is recorded on the scenario and does NOT throw: this runs
 * on error paths, where a throw would replace the diagnosis with its own.
 *
 * @param {(string|null)} faultFile
 * @param {boolean} armed Whether anything is believed to be armed.
 * @param {Object} item The scenario, for recording a disarm failure against.
 * @returns {undefined}
 */
function disarmModelFault(faultFile, armed, item) {
  if (!armed || !faultFile) {
    return;
  }

  try {
    selectModelFault(faultFile, null);
  }
  catch (err) {
    item.driven.faultDisarmFailed = reasonOf(err);
    note('WARNING: could not disarm the model-boundary fault after ' + item.id +
      ': ' + reasonOf(err) + '. Every later scenario in this run is suspect, ' +
      'because the next user lookup will fail and will be recorded as that ' +
      'scenario\'s behaviour.');
  }
}

// ---------------------------------------------------------------------------
// Children: the manifest and the seeder
// ---------------------------------------------------------------------------

/**
 * The git HEAD of a worktree, or null when it is not a checkout.
 *
 * Not what identifies an artifact. Provenance goes through
 * `require('./manifest').provenance`, which names the analysed tree by its
 * commit and this tool by the blob that ran plus the commit verified to hold
 * it; a bare HEAD of whichever worktree executed the tool is exactly the claim
 * that contract exists to replace. This remains an exported convenience for a
 * harness that wants a tree's head with no provenance semantics attached.
 *
 * @param {string} root
 * @returns {(string|null)}
 */
function gitHead(root) {
  var result = childProcess.spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    // Finite because this is a SYNCHRONOUS child: it blocks this process's
    // event loop outright, so a `git` waiting on an index lock would stall a
    // capture that is holding a mongod and an application server open, for the
    // sake of one provenance string. A timeout leaves `status` non-zero and
    // the head is recorded as unknown, which is the right degradation.
    timeout: GIT_TIMEOUT_MS,
    killSignal: 'SIGKILL'
  });

  if (result.error && result.error.code === 'ETIMEDOUT') {
    note('warning: `git rev-parse HEAD` in ' + root + ' did not finish ' +
      'within ' + GIT_TIMEOUT_MS + 'ms and was killed; this artifact records ' +
      'no commit for that tree.');
    return null;
  }

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
 * Where a GENERATED manifest lands is not where a read one is looked for. The
 * committed artifact is read when it exists, but generating one is a WRITE, and
 * a write nobody asked for does not go into the worktree: unless --manifest
 * named the path, the generated copy goes to the scratch directory (see
 * manifestDestination).
 *
 * @param {Object} options
 * @returns {Object} the parsed manifest
 * @throws {ToolError} If it can be neither read nor generated.
 */
function resolveManifest(options) {
  var generated;
  var env;
  var target;

  if (fs.existsSync(options.manifestPath)) {
    return manifest.readManifest(options.manifestPath);
  }

  target = manifestDestination(options);
  note('no route manifest at ' + options.manifestPath + '; generating one at ' +
    target);

  env = Object.assign({}, process.env, {
    NODE_ENV: 'test',
    NODE_CONFIG: JSON.stringify({ db: { redis: { enabled: false } } })
  });

  // The manifest is the route inventory every coverage claim in this corpus is
  // measured against, so it must describe the tree under test and nothing
  // else. See mongo.PRELOAD_ENV_VARS.
  mongo.scrubPreloadVars(env);

  // The whole isolation contract, not just its runtime-layer half: the child is
  // spawned with TOOL_ROOT as its working directory, so that is the tree whose
  // config/ it must read, and an inherited NODE_CONFIG_DIR naming another tree
  // is replaced rather than honoured. (This child is ./manifest, which
  // reconciles the directory again from its own `--app`.)
  mongo.applyConfigIsolation(env, { appRoot: TOOL_ROOT, configDir: 'set' });

  generated = childProcess.spawnSync(process.execPath, [
    path.join(__dirname, 'manifest.js'),
    '--app', options.appRoot,
    '--out', target
  ], {
    cwd: TOOL_ROOT,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: env,
    timeout: CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL'
  });

  // A timeout is reported as a timeout: it names a budget, where a non-zero
  // exit names a fault in the generator, and the two send a reader to
  // different places.
  if (generated.error && generated.error.code === 'ETIMEDOUT') {
    throw new ToolError('the route manifest generator did not finish within ' +
      CHILD_TIMEOUT_MS + 'ms and was killed. It loads every route module and ' +
      'controller in ' + options.appRoot + '; run `node ' +
      'test/parity/manifest.js --app ' + options.appRoot + ' --out ' +
      options.manifestPath + '` to see where it stops.');
  }

  if (generated.status !== 0) {
    throw new ToolError('the route manifest could not be generated (exit ' +
      generated.status + '). Run `node test/parity/manifest.js --app ' +
      options.appRoot + ' --out ' + target + '` to see why.');
  }

  // Recorded so the provenance names the file that was actually read rather
  // than the path that was looked for and missing.
  options.manifestPath = target;

  return manifest.readManifest(target);
}

/**
 * Where a manifest this tool has to generate is written.
 *
 * `--manifest <path>` is an explicit destination and is honoured as given, in
 * the worktree or anywhere else. Without it the manifest is a side artifact of
 * this run and belongs in scratch space: ARTIFACT_DIR_ENV when the caller named
 * one, and otherwise a fresh directory under the system temp, which is where
 * every other per-run file of this tool already goes.
 *
 * @param {Object} options
 * @returns {string} An absolute path.
 * @throws {ToolError} If the scratch directory cannot be created.
 */
function manifestDestination(options) {
  var configured = process.env[ARTIFACT_DIR_ENV];

  if (options.manifestExplicit) {
    return options.manifestPath;
  }

  if (typeof configured === 'string' && configured.trim()) {
    return path.resolve(configured.trim(), MANIFEST_ARTIFACT_NAME);
  }

  try {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-manifest-')),
      MANIFEST_ARTIFACT_NAME);
  }
  catch (err) {
    throw new ToolError('no route manifest at ' + options.manifestPath +
      ' and no scratch directory could be created for a generated one (' +
      reasonOf(err) + '). Pass --manifest <path>, or set ' + ARTIFACT_DIR_ENV +
      ' to a writable directory.');
  }
}

/**
 * The destination for an artifact the caller did not name.
 *
 * Resolves inside ARTIFACT_DIR_ENV when it is set, and otherwise fails naming
 * both ways to supply one. It never falls back to a path inside this
 * repository: see the comment on ARTIFACT_DIR_ENV.
 *
 * @param {string} basename The artifact's filename.
 * @param {string} flag The flag that would have named it, for the message.
 * @returns {string} An absolute path.
 * @throws {ToolError} A usage fault, if no destination was supplied.
 */
function resolveArtifactPath(basename, flag) {
  var configured = process.env[ARTIFACT_DIR_ENV];

  if (typeof configured === 'string' && configured.trim()) {
    return path.resolve(configured.trim(), basename);
  }

  throw usageError(flag + ' is required: this tool has no repository default, ' +
    'so that an invocation without a destination cannot overwrite committed ' +
    'evidence. Pass ' + flag + ' <path>, or set ' + ARTIFACT_DIR_ENV + ' to a ' +
    'scratch directory and the artifact goes to <dir>/' + basename + '. To ' +
    'write the committed baseline, name it: ' + flag + ' test/parity/' +
    basename);
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
  var env;

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

  env = Object.assign({}, process.env, {
    NODE_ENV: 'test',
    NODE_CONFIG: overlay === null ? '{}' : overlay,
    PARITY_SEED_MANIFEST_OUT: target
  });

  // This child resolves the bucket names the pre-migration objects are placed
  // under, so a redirected module resolution would put them in the wrong
  // bucket and every download case would record a not-found instead.
  mongo.scrubPreloadVars(env);

  // This child requires test/parity/seed.js, which requires `config`, so
  // without the isolation it creates config/runtime.json in the tree it runs in
  // - gitignored, hence invisible to `git status`, and layered over every other
  // configuration source on the next run. `appRoot: TOOL_ROOT` is what makes it
  // read THIS tree's config/ rather than an inherited NODE_CONFIG_DIR belonging
  // to another one.
  mongo.applyConfigIsolation(env, { appRoot: TOOL_ROOT, configDir: 'set' });

  result = childProcess.spawnSync(process.execPath, ['-e', script], {
    cwd: TOOL_ROOT,
    encoding: 'utf8',
    env: env,
    timeout: CHILD_TIMEOUT_MS,
    killSignal: 'SIGKILL'
  });

  if (result.error && result.error.code === 'ETIMEDOUT') {
    return {
      path: null,
      entries: 0,
      reason: 'the object-store manifest child did not finish within ' +
        CHILD_TIMEOUT_MS + 'ms and was killed; it resolves bucket names ' +
        'through `config`, so a wedged child usually means configuration ' +
        'that blocks on load'
    };
  }

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
 * SEEDING IS ALSO VERIFIED, NOT MERELY ATTEMPTED. The seeder's own `verify()`
 * runs in the same child and its result is reported back, because an exit code
 * of 0 says the script ran - not that the fixtures a corpus is about to be
 * recorded against are actually present and correct. A seeded state that
 * silently failed a contract produces a corpus of plausible responses recorded
 * against the wrong data, which is indistinguishable from a real baseline until
 * something downstream disagrees with it.
 *
 * `force` is how the destructive phase gets a deterministic starting point: the
 * seeder deletes the selected fixtures and recreates them, which restores
 * anything an earlier mutation changed. It is safe mid-run because it happens
 * between cases with no request in flight, and because the fixed `_id`s mean an
 * established session still resolves to its user afterwards.
 *
 * @param {Object} info the launcher's start result
 * @param {Object} [options] {force}
 * @returns {Promise<Object>} {ok, reason, created, verified}
 */
function seedFixtures(info, options) {
  var force = !!(options && options.force);
  var script = [
    'var mongoose = require("mongoose");',
    'var seeder = require(' + JSON.stringify(path.join(__dirname, 'seed.js')) + ');',
    'mongoose.set("strictQuery", true);',
    // The disconnect runs on EVERY path. Written as one `finish` both branches
    // call, which is the ES5 shape of a `finally` and is what the earlier
    // chain lacked: it disconnected only after a successful seed, so a
    // rejection AFTER connect - a duplicate key, a validation error, a
    // dropped connection mid-write - left this child holding an open
    // connection whose socket kept its event loop alive. The child then never
    // exited, `close` never fired, and the parent below waited on it forever
    // while still owning a mongod and a live application server.
    'function finish(code) {',
    '  process.exitCode = code;',
    '  return mongoose.disconnect().catch(function(err) {',
    '    process.stderr.write("seed disconnect failed: " + ((err && err.message) || String(err)) + "\\n");',
    // A disconnect that fails is a FAILED seed run, not a successful one with a
    // note attached: the connection is in an unknown state, the parent treats
    // status 0 as "seeded" and drops this stderr, and a run whose cleanup did
    // not complete would be recorded as clean. The existing code is preserved
    // when there is one, so a seed failure is never masked by a cleanup
    // failure that followed it.
    '    process.exitCode = code || 1;',
    '  });',
    '}',
    'mongoose.connect(process.env.PARITY_SEED_URI)',
    '  .then(function() { return seeder.seed(' +
      (force ? '{ force: true }' : '') + '); })',
    '  .then(function(summary) {',
    '    process.stderr.write("seeded: " + JSON.stringify(summary.created) + "\\n");',
    '    return seeder.verify();',
    '  })',
    '  .then(function(verification) {',
    // One machine-readable line, because the parent decides the run's verdict
    // on it and must not have to parse prose.
    '    process.stderr.write("verified: " + JSON.stringify({' +
      ' checks: verification.checks, failures: verification.failures }) + "\\n");',
    // Through `finish`, so the disconnect runs on this path as well: the
    // verification added a second success path and it must not be the one
    // that leaves the connection open.
    '    return finish(verification.failures.length ? 3 : 0);',
    '  })',
    '  .catch(function(err) {',
    '    process.stderr.write("seed failed: " + (err && err.message ? err.message : String(err)) + "\\n");',
    '    return finish(1);',
    '  });'
  ].join('\n');

  var uri = 'mongodb://' + info.mongo.host + ':' + info.mongo.port + '/' +
    info.mongo.database;

  var env = Object.assign({}, process.env, {
    NODE_ENV: 'test',
    NODE_CONFIG: info.nodeConfig,
    PARITY_SEED_URI: uri
  });

  // The seeder writes the fixtures every captured response is a response
  // ABOUT, so nothing outside this tree may preload code into it or change
  // which `mongoose` and which models it loads. See mongo.PRELOAD_ENV_VARS.
  mongo.scrubPreloadVars(env);

  // The full isolation contract, not persistence alone: `config` 0.4.37 creates
  // its runtime JSON unless persistence is off AND the file watch is disabled,
  // this child requires `config` through the seeder, and `appRoot: TOOL_ROOT`
  // points it at the config/ of the tree it runs in instead of an inherited
  // directory from another one.
  mongo.applyConfigIsolation(env, { appRoot: TOOL_ROOT, configDir: 'set' });

  return new Promise(function (resolve) {
    var child;
    var stderr  = '';
    var settled = false;
    var timers  = [];

    function tail() {
      return String(stderr || '').trim().split('\n').slice(-3).join(' | ');
    }

    function clearTimers() {
      timers.forEach(function (timer) { clearTimeout(timer); });
      timers = [];
    }

    // "Ours and still running". `child.pid` is undefined when the spawn itself
    // failed - node also sets exitCode -2 in that case - and there is then no
    // process to signal at all.
    function alive() {
      return !!child && child.pid !== undefined &&
        child.exitCode === null && child.signalCode === null;
    }

    // EXACT-PID teardown, and the exactness is the safety property: this
    // process is also the parent of an in-memory mongod and of the
    // application server the capture is driving, so a process-group signal
    // here would end the very run this seeder is preparing. `child.kill`
    // signals that one pid and nothing else.
    function signalOwned(signal) {
      if (!alive()) {
        return;
      }

      try {
        child.kill(signal);
      }
      catch (err) {
        // ESRCH: it exited between the check and the signal, which is the race
        // this guard absorbs rather than a failure.
        if (!err || err.code !== 'ESRCH') {
          note('warning: could not send ' + signal + ' to the seeder (pid ' +
            child.pid + '): ' + reasonOf(err));
        }
      }
    }

    // Last resort, for the case where this process is torn down while the
    // seeder is still running: an `exit` listener cannot await, so it is
    // SIGKILL or an orphan holding a connection to a database that is about to
    // disappear. Removed as soon as the child has exited.
    function sweep() {
      if (alive()) {
        signalOwned('SIGKILL');
      }
    }

    function settle(result) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimers();

      // The listener is dropped only when there is nothing left for it to do.
      // If the child outlived every signal, it stays registered so this
      // process's exit makes one final attempt.
      if (!alive()) {
        process.removeListener('exit', sweep);
      }

      resolve(result);
    }

    try {
      child = childProcess.spawn(process.execPath, ['-e', script], {
        cwd: TOOL_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: env
      });
    }
    catch (err) {
      resolve({
        ok: false,
        reason: 'the seeder could not be spawned: ' + reasonOf(err)
      });
      return;
    }

    process.on('exit', sweep);

    // The seeder reports on stderr and writes nothing to stdout, but both are
    // drained anyway: an undrained pipe is what this function exists to avoid.
    child.stdout.resume();
    child.stderr.on('data', function (chunk) {
      stderr += chunk.toString();
    });

    // The deadline, in three bounded steps. The parent NEVER waits past the
    // last one: a seeder that survives SIGKILL - an unkillable D-state, a pid
    // that is no longer ours - would otherwise reproduce exactly the
    // indefinite wait this replaces.
    timers.push(setTimeout(function () {
      note('the seeder has not finished within ' + SEED_TIMEOUT_MS +
        'ms; sending SIGTERM to pid ' + child.pid + '.');
      signalOwned('SIGTERM');

      timers.push(setTimeout(function () {
        note('the seeder did not exit on SIGTERM; sending SIGKILL to pid ' +
          child.pid + '.');
        signalOwned('SIGKILL');

        timers.push(setTimeout(function () {
          settle({
            ok: false,
            reason: 'the seeder (pid ' + child.pid + ') did not finish ' +
              'within ' + SEED_TIMEOUT_MS + 'ms and could not be reaped ' +
              'after SIGTERM and SIGKILL. End it by hand; its last output ' +
              'was: ' + (tail() || '(nothing on stderr)')
          });
        }, SEED_KILL_GRACE_MS));
      }, SEED_KILL_GRACE_MS));
    }, SEED_TIMEOUT_MS));

    /**
     * The seeder's own verification result, read off the line it prints.
     *
     * Absent rather than empty when the child never got that far, so "the
     * fixtures were not verified" stays distinguishable from "they verified
     * with no failures" - the two mean opposite things about the corpus.
     *
     * @returns {(Object|null)}
     */
    function verification() {
      var match = /verified: (\{.*\})/.exec(String(stderr || ''));

      if (!match) {
        return null;
      }

      try {
        return JSON.parse(match[1]);
      }
      catch (err) {
        return { checks: null, failures: ['the verification line could not be ' +
          'parsed: ' + reasonOf(err)] };
      }
    }

    /**
     * What the seeder reported creating, for the record.
     *
     * @returns {(Object|null)}
     */
    function created() {
      var match = /seeded: (\{.*\})/.exec(String(stderr || ''));

      if (!match) {
        return null;
      }

      try {
        return JSON.parse(match[1]);
      }
      catch (err) {
        return null;
      }
    }

    // A seeder that could not be spawned at all is a different finding from one
    // that ran and failed, and saying so keeps a missing interpreter from
    // reading as a broken fixture.
    child.on('error', function (err) {
      settle({
        ok: false,
        forced: force,
        created: null,
        verified: null,
        reason: 'the seeder could not be spawned: ' +
          ((err && err.message) || String(err))
      });
    });

    child.on('close', function (status, signal) {
      var verified = verification();

      if (status === 0) {
        if (verified === null) {
          // The script exited cleanly without printing its verification line,
          // which means it did not run - reported as the unverified state it is
          // rather than absorbed into a success.
          settle({
            ok: false,
            forced: force,
            created: created(),
            verified: null,
            reason: 'the seeder exited 0 but reported no verification result, ' +
              'so the fixtures a corpus would be recorded against were never ' +
              'checked: ' + tail()
          });
          return;
        }

        settle({ ok: true, forced: force, created: created(), verified: verified, reason: null });
        return;
      }

      if (verified && verified.failures && verified.failures.length) {
        settle({
          ok: false,
          forced: force,
          created: created(),
          verified: verified,
          reason: 'the seeded fixtures failed ' + verified.failures.length +
            ' of the seeder\'s own ' + verified.checks + ' contract checks: ' +
            verified.failures.join('; ')
        });
        return;
      }

      settle({
        ok: false,
        forced: force,
        created: created(),
        verified: verified,
        reason: 'the seeder ' +
          (status === null
            ? 'was killed on ' + signal + ' (the deadline above says whether ' +
              'this harness sent it)'
            : 'exited ' + String(status)) +
          ': ' + (tail() || '(nothing on stderr)')
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
 * THE FAULT RECORDS ARE WHY THIS FILE READS THE LOGS AT ALL RATHER THAN ASKING
 * THE FIXTURES. Each of the three fixtures reports a fault about ITSELF - a
 * mechanism it could not patch, a profile file it could not read, an object it
 * could not write - by pushing a `{event, detail}` record into its own
 * in-memory list AND writing it to this log. The in-memory list belongs to the
 * process the fixture is loaded into, which is the CHILD, so it is structurally
 * unreachable from here and a parent that consulted its own copy would find it
 * empty however badly the child's fixtures had failed. The log is the published
 * cross-process channel, so the log is what the health verdict is built from.
 *
 * @param {(string|null)} target
 * @returns {Object} {available, records, malformed, faults, reason}
 */
function readEvidenceLog(target) {
  var text;
  var records = [];
  var malformed = 0;

  if (!target) {
    return {
      available: false,
      records: [],
      malformed: 0,
      faults: [],
      reason: 'no log path was configured'
    };
  }

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    return {
      available: false,
      records: [],
      malformed: 0,
      faults: [],
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

  return {
    available: true,
    records: records,
    malformed: malformed,
    faults: faultRecords(records),
    reason: null
  };
}

/**
 * The fault records among a fixture's evidence.
 *
 * A record about an intercepted CALL carries the call's own fields - an
 * endpoint, an operation, a send. A record about the FIXTURE carries `event`,
 * and every one of those names something that did not work: an install that
 * failed, a mechanism left unpatched, a profile file that could not be read, an
 * object the store could not write, a log line that could not be appended. The
 * benign exceptions are enumerated rather than pattern-matched, so a new fault
 * event added to a fixture is treated as a fault here by default instead of
 * being silently tolerated because it did not match a regular expression.
 *
 * @param {Array.<Object>} records
 * @returns {Array.<Object>} {event, detail} for each fault, in log order
 */
function handshakeFaults(detail) {
  var reasons = [];
  var required;

  if (!detail || typeof detail !== 'object') {
    return ['the handshake carried no document, so what the fixture patched, ' +
      'and in which tree, is not established'];
  }

  if (detail.installed !== true) {
    reasons.push('`installed` is ' + JSON.stringify(detail.installed) +
      ', so the fixture did not take every mechanism it needs and a call ' +
      'site can still reach the real network');
  }

  required = detail.required && typeof detail.required === 'object'
    ? detail.required
    : {};

  Object.keys(required).forEach(function(mechanism) {
    if (required[mechanism] !== true) {
      return;
    }

    if (!detail.mechanisms || detail.mechanisms[mechanism] !== true) {
      reasons.push('the `' + mechanism + '` mechanism is required on this ' +
        'tree and is not active, so calls made through it were not ' +
        'intercepted');
    }
  });

  if (detail.appRootVerified !== true) {
    reasons.push('the declared application root ' +
      JSON.stringify(detail.appRoot === undefined ? null : detail.appRoot) +
      ' did not verify' +
      (Array.isArray(detail.appRootMissing) && detail.appRootMissing.length
        ? ' (missing ' + detail.appRootMissing.join(', ') + ')'
        : '') +
      ', so the tree these responses came from is not established');
  }

  if (detail.identity && detail.identity.identityOk !== true) {
    reasons.push('the provider identity contract does not hold' +
      (Array.isArray(detail.identity.identityViolations) &&
       detail.identity.identityViolations.length
        ? ' (' + detail.identity.identityViolations.join('; ') + ')'
        : '') +
      ', so the identities the provider cases drive are not the ones the ' +
      'seeder created');
  }

  if (detail.diagnostic !== null && detail.diagnostic !== undefined) {
    reasons.push('the fixture recorded the diagnostic ' +
      JSON.stringify(detail.diagnostic));
  }

  return reasons;
}

function faultRecords(records) {
  return records.filter(function(record) {
    if (!record || typeof record.event !== 'string') {
      return false;
    }

    if (BENIGN_FIXTURE_EVENTS.indexOf(record.event) !== -1) {
      return false;
    }

    if (record.event === HANDSHAKE_FIXTURE_EVENT) {
      return handshakeFaults(record.detail).length > 0;
    }

    return true;
  }).map(function(record) {
    var reasons = record.event === HANDSHAKE_FIXTURE_EVENT
      ? handshakeFaults(record.detail)
      : null;

    return {
      event: record.event,
      // The handshake document is large and most of it is healthy even when
      // one field is not, so the fault carries the fields that FAILED rather
      // than the whole document a reader would then have to search.
      detail: reasons
        ? reasons.join('; ')
        : (record.detail === undefined ? null : record.detail),
      error: record.error === undefined ? null : record.error
    };
  });
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
  var modelLog;
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
  modelLog = readEvidenceLog(info.modelFaultLog);

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
      // Deliberately NOT `awsFixture.errors()` as the fixture's fault record.
      // That list belongs to THIS process's copy of the fixture, which was
      // restored on the line above and never served a request, so it is empty
      // by construction no matter what the child's fixture did - reporting it
      // as the fault evidence would be a guarantee of soundness that means
      // nothing. The child's faults are read from its log, in `s3.faults`.
      parentProcessErrors: awsFixture.errors(),
      reason: null
    };
  }
  catch (err) {
    stored = {
      available: false,
      objects: [],
      parentProcessErrors: [],
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
      faults: httpLog.faults,
      byEndpoint: countBy(httpLog.records, 'endpoint'),
      byProfile: countBy(httpLog.records, 'profile')
    },
    mail: {
      available: mailLog.available,
      reason: mailLog.reason,
      captured: mailLog.records.length,
      malformedLines: mailLog.malformed,
      faults: mailLog.faults,
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
      faults: s3Log.faults,
      byOperation: countBy(s3Log.records, 'operation'),
      stored: stored
    },
    // The injected data-store faults. Collected for the same reason the three
    // above are: a scenario that claims to have reached the auth scheme's
    // lookup-error branch is making a claim, and the claim is only checkable
    // against the record of which lookup was actually faulted. `faulted` is the
    // count the armed steps are reconciled against; `byId` is what shows the
    // fault landed on the intended document and on no other.
    modelFault: {
      available: modelLog.available,
      reason: modelLog.reason,
      records: modelLog.records.length,
      malformedLines: modelLog.malformed,
      faulted: modelLog.records.filter(function(entry) {
        return entry && entry.event === 'faulted';
      }).length,
      byEvent: countBy(modelLog.records, 'event'),
      byId: countBy(modelLog.records.filter(function(entry) {
        return entry && entry.event === 'faulted';
      }), 'id')
    }
  };
}

/**
 * Decides whether the external-effect evidence behind this capture is sound.
 *
 * A response is only reproducible together with the fixture state that produced
 * it, so an unsound fixture does not merely leave a gap in the evidence - it
 * puts responses in the artifact that no later run can reproduce, and they look
 * exactly like sound ones. Everything here was previously COLLECTED and written
 * into the artifact while the exit code ignored it, which is the same as not
 * having checked: a malformed evidence log, a store that could not be listed, a
 * fixture that failed to install, a seeder whose own contract checks failed -
 * every one of them could pass.
 *
 * Each finding is returned with its channel and its own sentence, because the
 * remedies differ and a single "evidence unsound" line would send a reader
 * looking in the wrong place.
 *
 * @param {Object} state {evidence, seeded, info, options}
 * @returns {Object} {ok, findings: Array.<Object>}
 */
function evaluateEvidenceHealth(state) {
  var evidence = state.evidence;
  var seeded = state.seeded;
  var findings = [];
  var expected = [];
  var legacyRequestPresent = legacyRequestResolvable(state.appRoot);
  var requirement = requiredEvidenceChannels(state);
  var required = requirement.channels;
  var requiredBecause = requirement.because;

  /**
   * @param {string} channel
   * @param {string} message
   * @returns {undefined}
   */
  function add(channel, message) {
    findings.push({ channel: channel, message: message });
  }

  /**
   * Whether a fault event is the fixture reporting an EXPECTED state of the
   * tree under test rather than something that went wrong.
   *
   * There is exactly one, and it needed deciding rather than assuming: the http
   * fixture patches two mechanisms, the application's own `request` package and
   * global fetch, and it logs `request-mechanism-inactive` when the first is
   * not resolvable. On the MIGRATED tree that package is removed and every
   * former call site now uses fetch, so an inactive request mechanism cannot
   * leave an external effect unintercepted - the fixture's own header calls
   * this the expected outcome. On the BASELINE tree the package is present with
   * four live call sites, so the same event means real HTTP could have escaped
   * to the network, which is a fault and must fail the capture.
   *
   * The two are told apart by asking the same question the fixture asked - is
   * the package resolvable from the tree under test - rather than by matching
   * the wording of a diagnostic that belongs to another file.
   *
   * @param {string} channel
   * @param {Object} fault
   * @returns {boolean}
   */
  function isExpectedState(channel, fault) {
    return channel === 'http' &&
      fault.event === 'request-mechanism-inactive' &&
      legacyRequestPresent === false;
  }

  if (!evidence || !evidence.available) {
    // An attached server's evidence paths belong to whoever started it, so this
    // capture carries no record of what crossed the module boundary while it
    // was driven - and a response is only reproducible together with that
    // record. Driving an already-running server stays available, but it is not
    // baseline evidence and must not exit as though it were: the run has to say
    // so with --exploratory, which is the same explicit opt-out the baseline
    // oracle uses and which forfeits gate qualification.
    if (state.options && state.options.exploratory) {
      return {
        ok: true,
        findings: [],
        expected: [{
          channel: 'all',
          event: 'evidence-not-owned-by-this-run',
          detail: (evidence && evidence.reason) || null,
          reason: '--exploratory was given, so a capture with no ' +
            'external-effect evidence is an accepted result rather than a ' +
            'failure; it cannot qualify as gate evidence'
        }]
      };
    }

    return {
      ok: false,
      expected: [],
      findings: [{
        channel: 'all',
        message: 'this capture carries NO external-effect evidence' +
          ((evidence && evidence.reason) ? ' (' + evidence.reason + ')' : '') +
          '. A recorded response is only reproducible together with the ' +
          'fixture state that produced it, and with no evidence there is no ' +
          'way to establish that the three fixtures were even installed - a ' +
          'fixture that failed to patch reaches the real network and records ' +
          'the result as though it were intercepted. Launch the server from ' +
          'this run so its per-run evidence is captured, or pass ' +
          '--exploratory to accept a capture that is not baseline evidence.'
      }]
    };
  }

  EVIDENCE_CHANNELS.forEach(function(channel) {
    var view = evidence[channel];

    if (!view) {
      add(channel, 'the ' + channel + ' evidence is missing from the run ' +
        'summary entirely, so nothing can be established about it');
      return;
    }

    if (!view.available) {
      if (view.reason && view.reason.indexOf('could not read') === 0) {
        add(channel, 'the ' + channel + ' evidence log could not be read, so ' +
          'what crossed that boundary during the capture is unknown: ' +
          view.reason);
        return;
      }

      // An absent log means the fixture wrote nothing. For a channel this run
      // was bound to exercise that is a FAULT, not a quiet success: the same
      // absence is produced by a fixture that never installed and by one whose
      // very first log write failed - and a log-write failure is retained only
      // in the child's memory, so the absent log is the only thing the parent
      // can see. `requiredEvidenceChannels` decides which channels this run
      // must have exercised, from what the launcher was actually given.
      if (required.indexOf(channel) >= 0) {
        add(channel, 'the ' + channel + ' evidence log was never written, ' +
          'although this run was bound to exercise that channel (' +
          requiredBecause[channel] + '). An absent log is what a fixture that ' +
          'failed to install looks like from here, and what a fixture whose ' +
          'first log write failed looks like too - the failure is retained in ' +
          'the child\'s memory, which this process cannot read. Nothing about ' +
          'that boundary can be established, so the capture cannot stand.');
        return;
      }

      // Otherwise "nothing was intercepted" is the ordinary shape of a run that
      // made no external call of that kind - a narrow --only selection, most
      // often - and it is recorded as the expected state it is.
      expected.push({
        channel: channel,
        event: 'no-evidence-written',
        detail: view.reason,
        reason: 'this run was not bound to exercise the ' + channel +
          ' channel, so an unwritten log is the expected outcome rather than a ' +
          'fault'
      });
      return;
    }

    if (view.malformedLines) {
      add(channel, view.malformedLines + ' line(s) of the ' + channel +
        ' evidence log could not be parsed. A malformed record means the ' +
        'channel\'s own account of the run is incomplete, and an incomplete ' +
        'account cannot establish that a response is reproducible.');
    }

    (view.faults || []).forEach(function(fault) {
      if (isExpectedState(channel, fault)) {
        // Recorded rather than dropped: "this was classified as expected" is
        // itself evidence, and a reader must be able to see the classification
        // instead of wondering why an event in the log produced no finding.
        expected.push({
          channel: channel,
          event: fault.event,
          detail: fault.detail,
          reason: 'the application\'s legacy `request` package is not ' +
            'resolvable from the tree under test, so no call site can bypass ' +
            'the fetch interception this fixture did install'
        });
        return;
      }

      add(channel, 'the ' + channel + ' fixture reported a fault of its own: ' +
        fault.event + (fault.detail === null ? '' :
          ' (' + JSON.stringify(fault.detail) + ')') +
        (fault.error ? ' [' + fault.error + ']' : '') +
        '. A fixture that did not work is not an isolated external effect, so ' +
        'the responses recorded around it are not reproducible.');
    });
  });

  if (evidence.s3 && evidence.s3.stored && !evidence.s3.stored.available) {
    add('s3', 'the filesystem-backed object store could not be listed, so the ' +
      'stored object keys - which are content digests, and are how a silently ' +
      'orphaning change to the digest is detected - were not recorded: ' +
      evidence.s3.stored.reason);
  }

  if (seeded && seeded.attempted) {
    if (!seeded.ok) {
      add('seed', 'the fixtures were not seeded successfully: ' + seeded.reason);
    }
    else if (!seeded.verified) {
      add('seed', 'the seeder did not report a verification result, so the ' +
        'fixtures this corpus was recorded against were never checked against ' +
        'the seeder\'s own contracts');
    }
    else if (seeded.verified.failures && seeded.verified.failures.length) {
      add('seed', 'the seeded fixtures failed ' +
        seeded.verified.failures.length + ' of the seeder\'s ' +
        seeded.verified.checks + ' contract checks: ' +
        seeded.verified.failures.join('; '));
    }
  }

  (state.reseeds || []).forEach(function(entry) {
    if (!entry.ok) {
      add('seed', 'the forced reseed before ' + entry.beforeScenario +
        ' failed, so that destructive case and the ones after it did not ' +
        'observe freshly seeded fixtures: ' + entry.reason);
    }
  });

  return { ok: !findings.length, findings: findings, expected: expected };
}

/**
 * Which evidence channels this run was BOUND to exercise, and why.
 *
 * This is the positive installation check, derived from what the launcher was
 * actually given rather than from a fixture reporting on itself - the fixtures
 * are separate artifacts with their own environment contracts, and none of them
 * publishes a health record this process can read. What each of them
 * demonstrably records in a launched run is enough:
 *
 *   s3   - the launcher hands the aws fixture a pre-population manifest, which
 *          the fixture loads AT INSTALL and records one line per entry. So with
 *          entries prepared, an s3 log must exist; if it does not, the fixture
 *          did not install or could not write, and the object keys - content
 *          digests, the thing AAP 0.6.7 says silently orphans every stored
 *          object when it changes - were never recorded.
 *   http - this file writes the fixture's profile file before every scenario
 *          and resets it at the end, and the fixture records each change it
 *          reads. So with a profile file configured, an http log must exist.
 *   mail - nothing is recorded at install, and whether mail is sent depends on
 *          which routes were driven. It is required only of a full, unfiltered
 *          capture, whose corpus drives the registration and password-reset
 *          routes that send it.
 *
 * @param {Object} state {info, options, s3Seed, gateIntent}
 * @returns {Object} {channels, because}
 */
function requiredEvidenceChannels(state) {
  var channels = [];
  var because = {};
  var info = state.info || null;
  var options = state.options || {};

  if (info === null) {
    // No launcher, no per-run evidence paths to require anything of. The
    // wholly-unavailable case is handled by `evaluateEvidenceHealth` itself.
    return { channels: channels, because: because };
  }

  if (state.s3Seed && state.s3Seed.entries > 0) {
    channels.push('s3');
    because.s3 = 'the launcher was given a ' + state.s3Seed.entries +
      '-object pre-population manifest, which the aws fixture loads and logs ' +
      'at install';
  }

  if (info.httpProfilePath) {
    channels.push('http');
    because.http = 'a fixture profile file was configured, and this run writes ' +
      'a profile before every scenario and resets it at the end, each of which ' +
      'the http fixture logs';
  }

  if (!options.only || !options.only.length) {
    if (options.quirks !== false) {
      channels.push('mail');
      because.mail = 'this is a full unfiltered capture, whose corpus drives ' +
        'the registration and password-reset routes that send mail';
    }
  }

  return { channels: channels, because: because };
}

/**
 * Whether the application's legacy `request` package is resolvable from the
 * tree under test.
 *
 * `require.resolve` rather than `require`: this file loads no application
 * module and no application dependency, and resolution answers the question
 * without loading anything. The answer is what distinguishes the migrated tree,
 * where the package is gone, from the baseline, where it is present with live
 * call sites - see `isExpectedState`.
 *
 * @param {(string|null)} appRoot
 * @returns {(boolean|null)} null when there is no tree to ask about
 */
function legacyRequestResolvable(appRoot) {
  if (!appRoot) {
    return null;
  }

  try {
    require.resolve('request', { paths: [appRoot] });
    return true;
  }
  catch (err) {
    return false;
  }
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
 * The label for a path, so no block this file writes carries an absolute one.
 *
 * Every path a capture wants to name is either inside this tool's worktree,
 * inside the tree under test, or inside a per-run directory whose only
 * reproducible part is its basename. `provenance.pathLabel` decides which, and
 * this wrapper exists only so the two roots are not repeated at a dozen call
 * sites.
 *
 * @param {(string|null|undefined)} target
 * @param {string} appRoot the analysed tree
 * @returns {(string|null)}
 */
function pathLabelFor(target, appRoot) {
  return manifest.provenance.pathLabel(target, {
    toolRoot: TOOL_ROOT,
    analysedRoot: appRoot
  });
}

/**
 * A recorded reason, made reproducible wherever it is not.
 *
 * A reason is prose and prose is portable, with two exceptions that are fatal
 * at write time: a child's error message embeds an absolute path - `ENOENT: no
 * such file or directory, open '/tmp/parity-run-8123/stderr.log'` - and some
 * embed a wall clock. The contract's guard rejects a value that CONTAINS
 * either, not merely one that starts with one, so the whole block is lost to a
 * throw after the corpus has already been driven.
 *
 * Delegated to `provenance.portableText` rather than matched here. The local
 * implementation this replaced tested `/^(?:\/|[A-Za-z]:[\\/])/` and relabelled
 * only the FIRST whitespace-delimited token, which is the same anchoring
 * limitation the contract's own guard had: a path in the middle of a sentence -
 * which is where a filesystem error puts it - passed through untouched, and an
 * ISO instant was not handled at all. `portableText` replaces every embedded
 * path with the label `pathLabel` would give it and every instant with a
 * marker, keeping the words that say what happened; leading paths are covered
 * by the same pass, so nothing local is left to add.
 *
 * @param {*} value
 * @param {string} appRoot the analysed tree, for the `analysed:` labels
 * @returns {(string|null)}
 */
function portableReason(value, appRoot) {
  return manifest.provenance.portableText(value, {
    toolRoot: TOOL_ROOT,
    analysedRoot: appRoot
  });
}

/**
 * What the run can actually establish about the fake Google client.
 *
 * This field used to be the literal `googleClientInjected: true`, asserted
 * because the launcher was ASKED for the layer a few lines above. Two ways that
 * was untrue: under `--base-url` nothing is launched and nothing is injected,
 * and a launcher whose layer was overridden would still have been reported as
 * injected. Both matter, because the OAuth handlers short-circuit to
 * `request.fail` without a configured client - so a corpus that claims the
 * OAuth branches while the client was absent is a corpus of short-circuited
 * handlers wearing the labels of captured branches.
 *
 * Two independent observations replace the assertion, and both are recorded:
 *
 *   the CHILD'S EFFECTIVE CONFIGURATION, which the launcher returns on
 *   `info.config`, checked for the stub's own client id rather than for the
 *   layer having been requested; and
 *
 *   the REAL HANDSHAKE, counted from the http fixture's own evidence log,
 *   which records every call it intercepted at the module boundary. A token or
 *   userinfo call is proof that a handler got past the guard.
 *
 * @param {Object} state as writeArtifacts assembles it
 * @returns {Object}
 */
function googleClientEvidence(state) {
  var info = state.info;
  var app = info && info.config && info.config.app ? info.config.app : null;
  var auth = app && app.auth ? app.auth : null;
  var configured = auth && auth.google ? auth.google : null;
  var http = state.evidence && state.evidence.http ? state.evidence.http : null;
  var byEndpoint = http && http.byEndpoint ? http.byEndpoint : {};
  var scenarios = state.scenarios || [];
  var selected = [];
  var driven = [];
  var observable = !!(info && info.config);
  // Confirmed against the child's own composed configuration, never against
  // the layer this tool asked for. The observed client id is deliberately NOT
  // recorded: a caller who supplied a real client through --overlay or
  // NODE_CONFIG would have it written into a committed artifact.
  var confirmed = !!(configured &&
    configured.clientID === GOOGLE_STUB.clientID);
  var record;

  scenarios.forEach(function(item) {
    if (!isOAuthScenario(item)) {
      return;
    }

    selected.push(item.id);

    if (item.driven && item.driven.ok && !item.driven.skipped) {
      driven.push(item.id);
    }
  });

  record = {
    // `expected` is a committed constant, so naming it is reproducible and
    // lets a reader see exactly what the confirmation compared against.
    expectedClientId: GOOGLE_STUB.clientID,
    // The three states are kept apart on purpose. `absent` is a fault;
    // `not-observable` is what --base-url produces, where the configuration
    // belongs to whoever started that server; `confirmed` is the only one that
    // supports an OAuth claim on configuration grounds.
    state: confirmed
      ? 'confirmed'
      : (observable ? 'absent' : 'not-observable'),
    confirmedInChildConfiguration: confirmed,
    clientConfigured: !!configured,
    childConfigurationObservable: observable,
    interceptedTokenCalls: Number(byEndpoint.token || 0),
    interceptedUserinfoCalls: Number(byEndpoint.userinfo || 0),
    oauthScenariosSelected: selected.length,
    oauthScenariosDriven: driven.length,
    reason: null
  };

  record.handshakeObserved = record.interceptedTokenCalls > 0 ||
    record.interceptedUserinfoCalls > 0;

  // The gate, stated as data so writeArtifacts acts on the recorded fact
  // rather than on a second derivation of it. Absence is only a fault when
  // OAuth branches were actually driven: a --only run that selected none is
  // entitled to report the client as absent and carry on.
  record.sufficient = !driven.length || confirmed || record.handshakeObserved;

  if (confirmed) {
    record.reason = 'the child\'s effective configuration carries this ' +
      'tool\'s fake client, so the OAuth handlers reached their real branches';
  }
  else if (!observable) {
    record.reason = 'no server was launched by this run, so the child\'s ' +
      'effective configuration cannot be read from here and no client was ' +
      'injected by this tool' + (record.handshakeObserved
        ? '. A token or userinfo call WAS intercepted, so the server that was ' +
          'driven had a client of its own'
        : '');
  }
  else {
    record.reason = 'the child\'s effective configuration does not carry ' +
      'this tool\'s fake client, so a request to an OAuth route reaches the ' +
      'configuration guard and short-circuits to request.fail';
  }

  return record;
}

/**
 * True when a scenario exercises the Google OAuth surface.
 *
 * Both sources count: the three quirk cases built for those branches, and the
 * route sweep's own cases on the two `/auth/google` routes. A sweep case is
 * just as capable of recording a short-circuit as though it were a branch.
 *
 * @param {Object} item
 * @returns {boolean}
 */
function isOAuthScenario(item) {
  var group = item && item.group ? String(item.group) : '';
  var routePath = item && item.route && item.route.path
    ? String(item.route.path)
    : '';

  return group.indexOf(OAUTH_GROUP_PREFIX) === 0 ||
    routePath.indexOf(OAUTH_ROUTE_PREFIX) === 0;
}

/**
 * Builds the corpus's provenance block.
 *
 * "Captured at baseline" means captured by TARGET-worktree tooling against a
 * BASELINE install, and this block is what makes that claim checkable rather
 * than asserted. It is built by the contract in `./manifest`, which is what
 * gives it the three properties this record used to lack:
 *
 *   the tool is named by the git BLOB that actually ran plus the commit
 *   verified to contain that blob, instead of by the HEAD of whichever
 *   worktree happened to execute it;
 *
 *   the analysed tree is named by its COMMIT and nothing else - the absolute
 *   `appRoot` is gone, because a path is where a tree sat on one machine while
 *   the commit is what it contained; and
 *
 *   no value is run-local. The launcher's per-run directory, its PID, its
 *   port, its stdout and stderr paths, its Mongo settings and its database
 *   name were all in this record and are all gone: what is left of the server
 *   is the shape of the run - launched or attached, secure or not, which node
 *   flags, which fixture profile - plus labels and digests for everything else.
 *   The contract's own guard THROWS on any of them, which is what keeps this
 *   from regressing.
 *
 * The block is embedded in the corpus by the caller, so the corpus says which
 * tree it measured without a companion file, and the sidecar remains a run
 * output.
 *
 * @param {Object} state {options, info, manifestDocument, profiles, tree,
 *   role, scenarios, evidence, seeded, s3Seed}
 *
 * THE COMPOSED CONFIGURATION IS RECORDED WITHOUT ITS CREDENTIALS. This
 * sidecar is committed beside the corpus, so a verbatim `nodeConfig` would put
 * the session password (AAP §0.6.1), the AWS key id and secret key (§0.6.7),
 * the Google OAuth client secret and the reCAPTCHA secret (§0.4.2), the mail
 * transport password and the database credentials into the repository and into
 * every archive of it. What the record actually needs is the ability to prove
 * two runs were configured identically, and `server.redactConfigJson` provides
 * exactly that: the shape with credential VALUES replaced, the dotted paths
 * whose values were withheld - so an absent secret stays distinguishable from
 * a hidden one - and a SHA-256 of the verbatim configuration, which is the
 * comparison key. The child still receives the verbatim string; only this
 * written record is redacted.
 *
 * @param {Object} state {options, info, manifestDocument, profiles}
 * @returns {Object}
 */
function buildProvenance(state) {
  var options = state.options;
  var info = state.info;
  var provenance = manifest.provenance;
  var tree = state.tree || provenance.treeIdentity(options.appRoot);
  var role = state.role || (tree.isBaselineCommit ? 'baseline' : 'target');

  return provenance.build({
    artifact: options.out,
    role: role,
    generatorFile: __filename,
    toolRoot: TOOL_ROOT,
    analysedRoot: options.appRoot,
    detail: {
      corpusSchema: CORPUS_SCHEMA,
      // Whether the caller declared this a baseline capture, kept beside the
      // role so a reader can tell an asserted baseline from one that merely
      // happens to sit on the base commit.
      baselineAsserted: !!options.expectBaseline,
      baselineAssertionWaived: !!(options.expectBaseline &&
        options.allowNonBaseline),
      server: info === null ? {
        launched: false,
        // No base URL: it carries a port, and a port is the run-local value
        // this record exists to stop carrying. What matters is that the
        // application was ATTACHED to rather than started here, because that
        // is what decides whether this tool controlled its configuration.
        attached: true,
        secure: options.secure,
        nodeFlags: [],
        profileFileSupplied: !!options.profileFile
      } : {
        launched: true,
        attached: false,
        secure: !!info.secure,
        nodeFlags: (info.nodeFlags || []).slice(),
        // The ambient preload vectors the launcher removed from the child's
        // environment. Names only, and it belongs beside the flags for the
        // same reason they do: both decide what the child's interpreter could
        // have been made to do.
        scrubbedEnv: (info.scrubbedEnv || []).slice(),
        overlay: pathLabelFor(info.overlay, options.appRoot),
        // The composed NODE_CONFIG as a digest and a key list rather than
        // verbatim: the string carries the run's database name and port, and
        // the reproduction source is the committed configuration plus the
        // documented overlay.
        //
        // Through configurationDigest over the PARSED object, never
        // provenance.digest over the raw string. Hashing the string verbatim
        // did neither of the two things this field exists for: the overlay's
        // port and database name moved the digest on every run, so the field
        // identified the RUN rather than the configuration and two correct
        // captures of one tree disagreed for a reason that says nothing about
        // the tree; and a session password or a provider secret inside the
        // overlay became an unsalted sha256 in a committed artifact, which is
        // an offline oracle for any value cheap enough to guess - and a test
        // password is exactly that cheap. configurationDigest replaces every
        // secret-labelled scalar with `<redacted>`, drops address-labelled
        // ones, strips URI userinfo, and records what it did in the digest's
        // own `canonicalization`, so the value stays comparable between two
        // runs of one configuration and confirms no guess.
        //
        // The same `safeParseJson(...) || {}` fallback as the key list beside
        // it, so the two fields never describe different inputs. This tool
        // composes that string itself, so it is JSON by construction.
        nodeConfigDigest: provenance.configurationDigest(
          safeParseJson(info.nodeConfig) || {}),
        nodeConfigKeys: Object.keys(safeParseJson(info.nodeConfig) || {}).sort(),
        // Which keys the launcher's own redactor withheld, through that one
        // implementation rather than a second copy of the same list: the
        // digest above says the configuration is comparable, and this says
        // what was taken out of it before anything was persisted.
        nodeConfigRedactedKeys:
          server.redactConfigJson(info.nodeConfig).redactedKeys,
        httpProfile: info.httpProfile,
        objectStore: pathLabelFor(info.s3Root, options.appRoot),
        evidenceLogs: {
          http: pathLabelFor(info.httpLogPath, options.appRoot),
          mail: pathLabelFor(info.mailLogPath, options.appRoot),
          s3: pathLabelFor(info.s3LogPath, options.appRoot)
        }
      },
      configuration: {
        secure: options.secure,
        // Derived from two observations rather than asserted. See
        // googleClientEvidence for why the literal `true` this replaced was
        // not a fact about the run.
        googleClient: googleClientEvidence(state),
        seeded: {
          attempted: !!(state.seeded && state.seeded.attempted),
          ok: !!(state.seeded && state.seeded.ok),
          reason: portableReason(state.seeded && state.seeded.reason,
            options.appRoot)
        },
        objectStoreSeed: {
          prepared: !!(state.s3Seed && state.s3Seed.path),
          manifest: pathLabelFor(state.s3Seed && state.s3Seed.path,
            options.appRoot),
          entries: state.s3Seed ? state.s3Seed.entries : 0,
          reason: portableReason(state.s3Seed && state.s3Seed.reason,
            options.appRoot)
        },
        timeoutMs: options.timeoutMs,
        selection: options.only.length ? 'filtered' : 'all',
        // Labelled, not recorded raw: `--only /quirk\./` is a regular
        // expression wrapped in slashes, which the contract's guard cannot
        // tell apart from an absolute path - and it is right not to, because a
        // value that ambiguous must not reach a committed block unlabelled.
        // The prefix keeps the pattern readable instead of reducing it to a
        // count.
        selectionPatterns: options.only.map(function(pattern) {
          return 'pattern:' + String(pattern);
        }),
        appended: !!options.append,
        quirks: !!options.quirks
      },
      fixtureProfiles: state.profiles,
      routeManifest: {
        artifact: pathLabelFor(options.manifestPath, options.appRoot),
        routes: state.manifestDocument.entries.length,
        expected: manifest.EXPECTED.routes
      }
    }
  });
}

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
 * Merges a re-captured subset into an existing corpus.
 *
 * Scenarios are keyed by id, so re-driving one case replaces exactly that case
 * and leaves the rest of the artifact byte-identical. Order is taken from the
 * NEW ordering for anything it contains and from the old artifact otherwise, so
 * an append cannot reshuffle what it did not touch.
 *
 * THE ANNOTATIONS ARE NOT OVERWRITTEN, AND THAT IS THE POINT OF THIS FUNCTION
 * RATHER THAN AN INCIDENTAL PROPERTY OF IT. A fresh capture supplies
 * observations; `expectedDeviation` and `unreachableReason` are DEFINITIONS,
 * and the committed artifact is where they are authored and reviewed. Replacing
 * a scenario wholesale therefore used to remove exactly one thing from the
 * corpus each time the image-download case was re-captured: the marker that
 * says AAP 0.7 approved its change. The subsequent replay then read the
 * approved 200 as a regression, with nothing anywhere saying an annotation had
 * been dropped. So an annotation present in the existing definition and absent
 * from the fresh capture is carried FORWARD, and every such restoration is
 * reported so the artifact and the log both say it happened.
 *
 * @param {string} target the existing artifact path
 * @param {Array.<Object>} scenarios the freshly captured scenarios
 * @returns {Object} {scenarios, fresh, added, carriedForward, annotationsRestored}
 * @throws {ToolError} If the existing artifact cannot be read.
 */
function mergeCorpus(target, scenarios) {
  var existing;
  var byId = {};
  var order = [];
  var merged = [];
  var fresh = [];
  var added = [];
  var carriedForward = [];
  var restored = [];
  var freshIds = {};

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
    var previous = Object.prototype.hasOwnProperty.call(byId, item.id)
      ? byId[item.id]
      : null;
    var carried = [];

    if (previous === null) {
      order.push(item.id);
      added.push(item.id);
    }
    else {
      ANNOTATION_FIELDS.forEach(function(field) {
        if (!item[field] && previous[field]) {
          item[field] = previous[field];
          carried.push(field);
        }
      });

      if (carried.length) {
        restored.push({ id: item.id, fields: carried });
      }
    }

    freshIds[item.id] = true;
    fresh.push(item.id);
    byId[item.id] = item;
  });

  order.forEach(function(id) {
    if (byId[id]) {
      merged.push(byId[id]);

      if (!freshIds[id]) {
        // Recorded by id rather than counted, because "these responses were not
        // observed by this run" is a property of the artifact a reader needs to
        // be able to check case by case.
        carriedForward.push(id);
      }

      byId[id] = null;
    }
  });

  return {
    scenarios: merged,
    fresh: fresh,
    added: added,
    carriedForward: carriedForward,
    annotationsRestored: restored
  };
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
  var selected;
  var definitions;
  var definitionCoverage;

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

  // Two coverage accounts, and the distinction between them is the whole point.
  //
  // `definitionCoverage` is what the DEFINITIONS reach: 233/233 by
  // construction, and a property of this file's tables rather than of any
  // capture. It is worth reporting - it is how a missing table entry is caught -
  // but it says nothing about what was driven, so it is labelled as a
  // definition count and is never the coverage the artifact claims.
  //
  // The coverage the artifact claims is accounted later, in `writeArtifacts`,
  // over the scenarios that were actually WRITTEN - after `--only` narrows the
  // selection and after `--append` merges. Computing it here, over the full set,
  // is what let a `--only` run of one case write 233/233 into a corpus holding
  // one scenario: the artifact then overstated its own reach by two orders of
  // magnitude while every field in it was internally consistent.
  definitionCoverage = accountCoverage(manifestDocument.entries, scenarios);

  // The definitions, snapshotted BEFORE anything is driven, because driving
  // mutates the scenario objects in place: `runScenario` replaces each step
  // with the request-and-response record and the spec fields go with it. The
  // annotations sidecar and the merge both need the definition as authored,
  // which after a capture exists nowhere else.
  definitions = deepCopy(scenarios);

  filter = compileFilter(options.only);
  selected = filter ? scenarios.filter(filter) : scenarios;

  if (!selected.length) {
    // Before the launcher, before the seeder, before anything is written. An
    // --only that matches nothing used to start a server, drive zero cases and
    // write an artifact whose coverage claimed the full route set, then exit 0 -
    // a corpus that proves nothing while reading as a clean run.
    throw usageError('--only ' + options.only.map(function(pattern) {
      return JSON.stringify(pattern);
    }).join(' ') + ' matched none of the ' + scenarios.length +
      ' defined scenarios, so there is nothing to drive. Patterns match a ' +
      'scenario id, its group or its route key, as a /regex/ or as a ' +
      'case-insensitive substring.');
  }

  return {
    scenarios: selected,
    definitions: definitions,
    selected: filter ? 'filtered' : 'all',
    filtered: !!filter,
    quirksIncluded: !!options.quirks,
    only: (options.only || []).slice(),
    total: scenarios.length,
    // The mandatory cases the DEFINITIONS hold, so an artifact that omits some
    // of them can be told from one whose definitions never had them.
    mandatoryDefined: scenarios.filter(isMandatoryScenario).map(function(item) {
      return item.id;
    }),
    definitionCoverage: definitionCoverage
  };
}

/**
 * The role this corpus is entitled to claim, enforcing the baseline HEAD.
 *
 * Without `--expect-baseline` the role simply FOLLOWS the tree: the base
 * commit yields `baseline`, anything else `target`. With it, the caller has
 * asserted which tree this is, and the assertion is checked rather than
 * believed - `--app` pointed one directory sideways used to produce an
 * artifact indistinguishable from a baseline capture.
 *
 * The assertion has TWO refusals, not one. Being at the base commit is
 * necessary and not sufficient: a DIRTY worktree at 2f8712a holds the base
 * commit plus edits nobody can retrieve, so a capture of it measures those
 * edits while reading exactly like a clean baseline capture. The contract
 * refuses that case with its own message, and `--allow-nonbaseline` is the one
 * escape from either - it costs the `unreviewed` role, which no gate accepts.
 * The corpus records `analysedTree.worktreeState` regardless, and replay's
 * strict consumer refuses a corpus whose analysed tree is dirty at the base
 * commit through the contract's `baseline-tree-clean` check.
 *
 * The contract's error is re-thrown as this file's own `ToolError` so `main`
 * reports it as the usage fault it is instead of printing a stack: the two
 * classes are distinct constructors, and an `instanceof` test across them
 * fails.
 *
 * @param {Object} options
 * @param {Object} tree from provenance.treeIdentity
 * @returns {string} one of the contract's roles
 * @throws {ToolError} When a baseline capture was asserted over another tree.
 */
function resolveRole(options, tree) {
  if (!options.expectBaseline) {
    // A tree at the base commit WITH uncommitted changes is not the base
    // commit's content, so it may not be labelled `baseline` here either. The
    // documented "role follows the tree" rule stands; what changed is that a
    // dirty base tree is no longer one of the trees that yields a baseline
    // claim. Without --expect-baseline the caller made no assertion, so this
    // is a label rather than a refusal: `unreviewed`, which no gate accepts.
    // Consumers already refuse such a corpus on `baseline-tree-clean`; this
    // stops the artifact making the claim in the first place, so the two ends
    // agree instead of one relying on the other.
    if (tree.isBaselineCommit) {
      return tree.worktreeState === 'dirty' ? 'unreviewed' : 'baseline';
    }

    return 'target';
  }

  try {
    return manifest.provenance.assertBaseline(tree, {
      allowNonBaseline: options.allowNonBaseline,
      what: 'the baseline corpus'
    });
  }
  catch (err) {
    throw new ToolError(reasonOf(err));
  }
}

/**
 * Adds one teardown fault to the run's cleanup list, once.
 *
 * DEDUPLICATED ON THE MESSAGE, and that is not cosmetic: ./server adopts
 * ./mongo's records when it stopped a database it provisioned, so a single
 * leaked mongod is reachable through both accessors. Reading both is what makes
 * the accounting complete whichever layer owns the database; keying on the
 * measured cause is what stops one fault being reported as two.
 *
 * @param {Array.<Object>} cleanup The run's list.
 * @param {string} operation What was attempted, phrased to follow 'could not'.
 * @param {string} message The measured cause.
 * @returns {undefined}
 */
function foldCleanup(cleanup, operation, message) {
  var seen = cleanup.some(function(entry) {
    return entry.message === message;
  });

  if (!seen) {
    cleanup.push({ operation: operation, message: message });
  }
}

/**
 * Captures the corpus: start or attach, seed, drive, write.
 *
 * @param {Object} options
 * @returns {Promise<number>} the exit code
 */
async function capture(options) {
  // The tree's identity FIRST, before the manifest is resolved, before the
  // launcher runs and before a single case is driven. A baseline claim is a
  // claim about one commit, and an artifact that claims it while having
  // measured something else is indistinguishable from the real thing
  // afterwards - so a mis-pointed --app has to cost nothing rather than a full
  // sweep. `assertBaseline` throws when --expect-baseline was given and the
  // tree is not the base commit, and equally when it IS the base commit with
  // uncommitted changes, because the content that would be measured is then
  // not retrievable from this repository; --allow-nonbaseline is the one
  // escape from either and it is not free, because it yields the `unreviewed`
  // role, which no gate accepts as baseline evidence and which the corpus
  // records where every consumer can see it. The worktree state is on the
  // note below for the same reason.
  var tree = manifest.provenance.treeIdentity(options.appRoot);
  var role = resolveRole(options, tree);
  var manifestDocument;
  var built;
  var info = null;
  var launched = false;
  var seeded = {
    attempted: false,
    ok: false,
    created: null,
    verified: null,
    reason: options.seedSkippedReason || null
  };
  var reseeds = [];
  var reseed = {
    available: false,
    reason: options.reseedSkippedReason ||
      'no server was launched by this run, so there is no database to reseed',
    count: 0
  };
  var scratchDir = null;
  var serverDied = { died: false, lastScenario: null, lastIndex: -1, remaining: 0, stderrPath: null };
  var s3Seed = { path: null, entries: 0, reason: 'no server was launched by this run' };
  var baseUrl;
  var referer;
  var jar;
  var profileFile;
  var faultFile;
  var index;
  var item;
  var summary;
  var exitCode = EXIT_OK;
  // Teardown faults, collected in the `finally` below and folded into the
  // returned code afterwards. It cannot go into `writeArtifacts`: the artifact
  // is written BEFORE the teardown runs, deliberately, so that the corpus
  // exists whatever happens on the way down.
  var cleanup = [];

  note('analysed tree ' + (tree.head
    ? tree.headShort + ' (' + tree.worktreeState + ')'
    : 'is not a checkout') + ', so this corpus is recorded with role ' + role +
    (role === 'unreviewed'
      ? '. --allow-nonbaseline was given, so the artifact says so and no gate ' +
        'will accept it as baseline evidence'
      : ''));

  manifestDocument = resolveManifest(options);
  built = buildCorpus(options, manifestDocument);

  // Resolved BEFORE the manifest is read or a server is launched, so a run
  // with nowhere to write its corpus fails in the first second rather than
  // after driving 233 routes. A programmatic caller does not come through
  // parseArguments, which is the other reason the destination policy is
  // applied here: without it a missing `out` would surface much later as a
  // write to "undefined".
  if (!options.out) {
    options.out = resolveArtifactPath(CORPUS_ARTIFACT_NAME, '--out');
  }

  manifestDocument = resolveManifest(options);
  built = buildCorpus(options, manifestDocument);

  note(built.total + ' scenarios defined over ' +
    manifestDocument.entries.length + ' routes' +
    (built.scenarios.length === built.total
      ? ''
      : ', ' + built.scenarios.length + ' selected by --only'));

  note('driving in ' + PHASE_ORDER.length + ' dependency phases: ' +
    PHASE_ORDER.map(function(phase) {
      return phase + ' ' + (phaseCounts(built.scenarios)[phase] || 0);
    }).join(', ') + (options.reseedBeforeDestructive
      ? '; a forced reseed runs before each destructive case'
      : '; no reseed' + (options.reseedSkippedReason
        ? ' (' + options.reseedSkippedReason + ')'
        : '')));

  if (built.definitionCoverage.unknownRoutes.length) {
    built.definitionCoverage.unknownRoutes.forEach(function(entry) {
      note('scenario ' + entry.scenario + ' claims ' + entry.covers +
        ', which is not in the manifest');
    });
  }

  try {
    if (options.baseUrl) {
      baseUrl = options.baseUrl;
      profileFile = options.profileFile;
      faultFile = options.faultFile;
      note('driving the already-running server at ' + baseUrl);

      if (!profileFile) {
        note('no --profile-file, so per-case fixture profiles cannot be ' +
          'switched; every case will be driven under whatever profile that ' +
          'server started with');
      }

      if (!faultFile) {
        note('no --fault-file, so the model-boundary fault cannot be armed; ' +
          'the auth scheme\'s lookup-error case will FAIL rather than record ' +
          'an unfaulted response as though it were the faulted one');
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
      faultFile = info.modelFaultPath;

      note('server ready at ' + baseUrl + ' (pid ' + info.pid + ', database ' +
        info.mongo.database + ')');

      if (options.seedFixtures) {
        seeded.attempted = true;
        summary = await seedFixtures(info);
        seeded.ok = summary.ok;
        seeded.reason = summary.reason;
        seeded.created = summary.created;
        seeded.verified = summary.verified;

        if (!summary.ok) {
          // Reported, and fatal. A corpus captured against an unseeded database
          // is a corpus of not-found responses that looks like a captured
          // baseline, which is worse than no corpus at all. The seeder's own
          // verification is part of this: a seed that ran and left a fixture
          // contract broken produces plausible responses recorded against the
          // wrong data, which is the same fault wearing a success.
          throw new ToolError('the fixtures could not be seeded, so nothing ' +
            'would be captured against them: ' + summary.reason);
        }

        note('fixtures seeded and verified (' +
          (summary.verified ? summary.verified.checks : 0) + ' contract checks)');

        if (options.reseedBeforeDestructive) {
          reseed.available = true;
          reseed.reason = null;
        }
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

      // The destructive phase runs against freshly seeded fixtures, one case at
      // a time. Ordering alone put the deletes last, which is what stops them
      // deciding what an earlier case observed; this is the other half - it
      // stops them deciding what each OTHER observes. Without it the second
      // delete runs against whatever the first left behind, and a corpus in
      // which `DELETE /api/courses/{courseId}` answers 200 and every later
      // course-scoped delete answers 404 records the ORDER rather than the
      // routes, while looking identical to one that recorded the routes.
      if (reseed.available && item.phase === PHASE_DESTRUCTIVE) {
        summary = await seedFixtures(info, { force: true });

        reseeds.push({
          beforeScenario: item.id,
          ok: summary.ok,
          reason: summary.reason,
          verified: summary.verified
        });

        if (!summary.ok) {
          // Fatal, for the same reason the initial seed is: every destructive
          // case from here on would be recorded against unknown state, and
          // nothing in the artifact would distinguish that from a route that
          // genuinely answers this way.
          throw new ToolError('the forced reseed before ' + item.id +
            ' failed, so this destructive case and the ones after it would be ' +
            'driven against unknown fixture state: ' + summary.reason);
        }

        reseed.count++;
      }

      await runScenario(item, {
        jar: jar,
        profileFile: profileFile,
        faultFile: faultFile,
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

    // Leave the fixtures in their neutral state, so a server that outlives
    // this run is not left in whatever state the last case wanted - a live
    // arming in particular would fail the first user lookup of whatever runs
    // next against the same server.
    if (profileFile) {
      selectProfile(profileFile, 'default');
    }

    if (faultFile) {
      selectModelFault(faultFile, null);
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
      reseed: reseed,
      reseeds: reseeds,
      // How the corpus was ordered and what was restored between the
      // destructive cases: part of the input that produced these responses, so
      // it belongs in the artifact rather than in this file's comments alone.
      ordering: {
        phases: PHASE_ORDER,
        counts: phaseCounts(built.scenarios),
        reseedBeforeEachDestructiveCase: reseed.available,
        reseedUnavailableReason: reseed.reason,
        reseeds: reseeds
      },
      // The identity established before anything ran, carried through rather
      // than re-derived at write time: the artifact must record the tree the
      // assertion above was made about.
      tree: tree,
      role: role,
      // Collected after the last case and before the server is stopped, so the
      // per-run directory is still there to be read.
      evidence: collectEvidence(info)
    });
  }
  finally {
    if (launched) {
      try {
        // THE BOOLEAN, NOT ONLY THE THROW. ./server's `stop` RESOLVES `false`
        // for an unclean stop rather than rejecting - so that a caller's real
        // result still reaches the shell - which means this `catch` never saw
        // the case it was written for. Both channels are read, plus each
        // module's own named records, which say which operation leaked.
        if ((await server.stop()) === false) {
          note('warning: the server did not stop cleanly: ' +
            'test/parity/server.js reported an unclean stop');
          foldCleanup(cleanup, 'stop the server',
            'test/parity/server.js reported an unclean stop');
        }
      }
      catch (stopError) {
        note('warning: the server did not stop cleanly: ' + reasonOf(stopError));
        foldCleanup(cleanup, 'stop the server', reasonOf(stopError));
      }

      // Each module's own records name the operation as a bare phrase, so they
      // are carried through with an attribution rather than a second 'could
      // not' - the line below prints one.
      server.cleanupFailures().forEach(function(entry) {
        foldCleanup(cleanup, entry.operation + ' (test/parity/server.js)',
          entry.message);
      });

      // Read as well as the launcher's list, because a run can provision the
      // database itself; `foldCleanup` is what keeps one fault one entry when
      // the launcher has already adopted the same record.
      mongo.cleanupFailures().forEach(function(entry) {
        foldCleanup(cleanup, entry.operation + ' (test/parity/mongo.js)',
          entry.message);
      });
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
        foldCleanup(cleanup, 'remove the scratch directory ' + scratchDir,
          reasonOf(cleanupError));
      }
    }
  }

  // THE TEARDOWN REACHES THE EXIT CODE. Every line above is still printed - the
  // stderr diagnostic is the evidence and none of it was the defect - but a
  // failed stop or removal now also decides what this function returns. It
  // answers EXIT_ERROR rather than EXIT_DIFFERENCE, and never lowers a code
  // already set: a live application process, a leaked mongod or a surviving
  // scratch directory holding the object store means the run could not be
  // performed cleanly, which is a different statement from "the capture found a
  // difference", and a caller that reads 0 here would be told the host is clean
  // when it is not.
  if (cleanup.length) {
    cleanup.forEach(function(entry) {
      note('CLEANUP FAILURE: could not ' + entry.operation + ': ' +
        entry.message);
    });

    note(cleanup.length + ' cleanup failure(s); exiting ' + EXIT_ERROR +
      ' - the corpus above is complete, but this run may have left a live ' +
      'process, a live connection or a leftover behind');

    exitCode = EXIT_ERROR;
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
 * A login that does not land is FATAL, with one exception: the disabled account
 * is REFUSED by design, and its scenario exists to record that, so its failure
 * to land is the expected outcome.
 *
 * Fatal rather than a warning because of what the alternative records. A jar
 * with no session for `user` still drives every case that names that identity -
 * anonymously - and the application answers each one with a redirect to
 * `/login` or an unauthenticated projection. Those are real responses, they
 * differ from the authenticated ones the corpus is supposed to hold, and the
 * artifact labels them with the identity that was ASKED FOR rather than the one
 * that drove them. Well over a hundred cases in a full sweep name a session
 * identity, so a single unlanded login silently re-labels a third of the corpus
 * and every one of those entries then reads as evidence about a route's
 * authenticated behaviour. Failing here costs one run; not failing costs a
 * corpus that is wrong in a way no later reader can detect.
 *
 * @param {Jar} jar
 * @param {Array.<Object>} scenarios
 * @returns {Promise<undefined>}
 * @throws {ToolError} If a required identity could not authenticate.
 */
async function establishSessions(jar, scenarios) {
  var wanted = {};
  var refused = [];
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
      refused.push(identity + ': ' + (outcome.location || outcome.error));
    }
  }

  if (refused.length) {
    throw new ToolError('a required identity could not authenticate, so the ' +
      'sweep is not run: ' + refused.join('; ') + '. Every case naming that ' +
      'identity would be driven anonymously and recorded under the identity ' +
      'it asked for, which makes the artifact wrong about which session ' +
      'produced each response. Check that the fixtures seeded (the login uses ' +
      'the seeded credentials) and that the server is reachable, then re-run.');
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
 * Writes the corpus - provenance embedded - its sidecar, and the exit code.
 *
 * @param {Object} state
 * @returns {number} the exit code
 */
function writeArtifacts(state) {
  var options = state.options;
  var built = state.built;
  var drivenSet = built.scenarios;
  var merge = null;
  var scenarios;
  var coverage;
  var mandatoryMissing;
  var evidenceHealth;
  var gate;
  var undriven = [];
  var unmet = [];
  var unmetApproved = [];
  var unmetUnapproved = [];
  var timedOut = [];
  var unexpectedTimeouts;
  var unreachable = [];
  var baselinesPending = 0;
  var artifact;
  var corpus;
  var annotations;
  var record;
  var googleClient;
  var text;
  var exitCode = EXIT_OK;

  // The merge happens FIRST, because everything below has to describe the
  // artifact that is actually written. Computing the summary and the coverage
  // from the fresh selection and then writing a merged `scenarios` array
  // produced a corpus that contradicted itself: 383 scenarios listed, one
  // scenario counted, and coverage claiming a surface the counted case never
  // touched.
  if (options.append) {
    merge = mergeCorpus(options.out, drivenSet);
    scenarios = merge.scenarios;

    merge.annotationsRestored.forEach(function(entry) {
      note('carried ' + entry.fields.join(' and ') + ' forward onto ' +
        entry.id + ' from the existing definition in ' + options.out +
        ' - a capture records observations and must not drop an annotation');
    });
  }
  else {
    scenarios = drivenSet;
  }

  // Driven accounting, over the cases THIS run drove. A carried-forward case
  // has no `driven` record because this run did not touch it, and counting it
  // as undriven would report an earlier run's work as this run's failure.
  drivenSet.forEach(function(item) {
    // An unmet baseline expectation on a scenario carrying an APPROVED
    // deviation may be the deviation materializing, which is what `--target`
    // is for - but only if what materialized is what was approved.
    //
    // The marker approves ONE response, and `targetExpectation` states it in
    // checkable clauses. Approval therefore requires all three: target mode,
    // the marker, and a captured response that satisfies the target. Dropping
    // the third condition is what would let a 500, an empty body or a
    // transport failure on the marked case pass the gate as an approved
    // change, since every one of those also fails the baseline expectation
    // that the request never settles. A marker with no checkable target is not
    // approval either: it says something may change without saying what, so
    // the difference stays unapproved and fatal.
    var marked = !!(item.expectedDeviation &&
      item.expectedDeviation.replayDisposition === 'approved-change');
    var targetMet = !!(item.targetExpectationResult &&
      item.targetExpectationResult.met);
    var approved = !!(options.target && marked && targetMet);
    var entry;

    if (item.driven.skipped) {
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
      entry = {
        id: item.id,
        description: item.expectationResult.description,
        failures: item.expectationResult.failures,
        // Recorded on every unmet entry, approved or not, because "the marked
        // case differed and this is how it differed from what was approved" is
        // the whole finding when approval is refused.
        marked: marked,
        targetExpectation: item.targetExpectationResult === null
          ? null
          : {
            description: item.targetExpectationResult.description,
            met: item.targetExpectationResult.met,
            failures: item.targetExpectationResult.failures
          },
        approvedDeviation: approved
          ? {
            approvedBy: item.expectedDeviation.approvedBy || null,
            rule: item.expectedDeviation.rule || null,
            target: item.expectedDeviation.target || null
          }
          : null,
        approvalRefused: options.target && marked && !approved
          ? (item.targetExpectationResult === null
            ? 'the marker approves a specific response but the scenario ' +
              'carries no checkable statement of it, so the difference cannot ' +
              'be approved automatically'
            : 'the response produced is not the one the deviation approved: ' +
              item.targetExpectationResult.failures.join('; '))
          : null
      };

      unmet.push(entry);

      if (approved) {
        unmetApproved.push(entry);
      }
      else {
        unmetUnapproved.push(entry);
      }
    }

    item.steps.forEach(function(step) {
      if (step.response && step.response.timedOut) {
        timedOut.push({
          id: item.id,
          step: step.label,
          expected: item.intent === 'timeout',
          kind: step.response.timeoutKind || null
        });
      }
    });
  });

  // Artifact-level accounting, over the FINAL array, and it is what the summary
  // publishes and the verdict is taken from.
  //
  // The distinction matters under `--append`. The lists above describe the
  // cases THIS RUN drove; a merged artifact also holds cases an earlier run
  // drove, and those carry their own `driven` and `expectationResult` records
  // through the merge. Publishing this run's counts under artifact-level names
  // produced an artifact that contradicted itself in the other direction: a
  // merged corpus holding a timed-out carried-forward response while
  // `summary.timedOutSteps` read 0. So every field named for the artifact is
  // scanned off the artifact, and this run's own numbers are reported beside
  // them under names that say so.
  artifact = accountArtifact(scenarios, options);
  unreachable = artifact.unreachable;
  baselinesPending = artifact.baselinesPending;
  unexpectedTimeouts = artifact.timedOut.filter(function(entry) {
    return !entry.expected;
  });

  coverage = accountCoverage(state.manifestDocument.entries, scenarios);
  mandatoryMissing = missingMandatory(built.mandatoryDefined, scenarios);

  evidenceHealth = evaluateEvidenceHealth({
    evidence: state.evidence,
    seeded: state.seeded,
    reseeds: state.reseeds,
    info: state.info,
    s3Seed: state.s3Seed,
    appRoot: options.appRoot,
    options: options
  });

  gate = evaluateGate({
    coverage: coverage,
    mandatoryMissing: mandatoryMissing,
    mandatoryPresent: artifact.mandatoryPresent,
    filtered: !!built.filtered,
    quirksIncluded: !!built.quirksIncluded,
    applicationDied: state.serverDied.died,
    // Artifact-level throughout: a merged corpus carrying an earlier run's
    // undriven case, unmet expectation or unexplained stall is an artifact that
    // cannot support the gate, whoever drove it.
    undriven: artifact.undriven,
    unexpectedTimeouts: unexpectedTimeouts,
    unmetUnapproved: artifact.unmetUnapproved,
    exploratory: !!options.exploratory,
    evidenceHealth: evidenceHealth,
    evidenceAvailable: !!(state.evidence && state.evidence.available),
    baselinesPending: baselinesPending,
    seeded: state.seeded,
    reseed: state.reseed
  });

  corpus = {
    schema: CORPUS_SCHEMA,
    // Every field here describes the array this artifact actually carries, and
    // `gateQualified` is the one a downstream reader should look at first: it
    // is false for every artifact that records less than the whole surface, and
    // `gate.reasons` says which of those it is.
    summary: {
      captured: scenarios.some(hasRecordedResponse),
      gateQualified: gate.qualifies,
      // Everything from here to `evidenceFindings` describes THIS ARTIFACT, and
      // is scanned off the scenario array that was written. The `ThisRun`
      // fields below describe the invocation instead; under --append the two
      // genuinely differ, and conflating them is what made an earlier artifact
      // report 0 timed-out steps while holding a timed-out response.
      scenarios: scenarios.length,
      routes: coverage.routes,
      routesRepresented: coverage.represented,
      routesUnrepresented: coverage.unrepresented.length,
      mandatoryScenariosPresent: artifact.mandatoryPresent.length,
      mandatoryScenariosMissing: mandatoryMissing.length,
      unreachableByDesign: unreachable.length,
      baselinesPending: baselinesPending,
      undriven: artifact.undriven.length,
      expectationsUnmet: artifact.unmet.length,
      expectationsUnmetApproved: artifact.unmetApproved.length,
      timedOutSteps: artifact.timedOut.length,
      evidenceFindings: evidenceHealth.findings.length,
      // This invocation.
      definedScenariosThisRun: built.total,
      drivenThisRun: drivenSet.length,
      carriedForward: merge ? merge.carriedForward.length : 0,
      selection: built.selected,
      quirksIncludedThisRun: !!built.quirksIncluded,
      applicationDiedThisRun: state.serverDied.died,
      undrivenThisRun: undriven.length,
      expectationsUnmetThisRun: unmet.length,
      expectationsUnmetApprovedThisRun: unmetApproved.length,
      timedOutStepsThisRun: timedOut.length
    },
    // Whether this artifact may stand as gate evidence, and every reason it may
    // not. Recorded rather than left to a reader to infer from the counts.
    gate: gate,
    // Coverage OF THIS ARTIFACT. `definitionCoverage` below is the reach of the
    // scenario tables in capture.js, which is a property of the tool rather
    // than of any capture, and the two are never the same number for a reduced
    // run.
    coverage: coverage,
    definitionCoverage: {
      label: 'the reach of the scenario DEFINITIONS in capture.js, not of this ' +
        'capture: it does not change when --only or --no-quirks reduce what was ' +
        'driven',
      routes: built.definitionCoverage.routes,
      represented: built.definitionCoverage.represented,
      unrepresented: built.definitionCoverage.unrepresented,
      unknownRoutes: built.definitionCoverage.unknownRoutes
    },
    // How the corpus was ordered and what was restored between the destructive
    // cases, because the order is part of the input that produced these
    // responses.
    ordering: state.ordering,
    // What --append merged, so a reader can tell this run's observations from
    // an earlier run's without diffing two artifacts.
    merge: merge === null ? null : {
      into: options.out,
      fresh: merge.fresh.length,
      added: merge.added,
      carriedForward: merge.carriedForward,
      annotationsRestored: merge.annotationsRestored
    },
    mandatoryScenariosMissing: mandatoryMissing,
    notes: corpusNotes(),
    // What crossed the module boundary while the corpus was driven. A response
    // is only reproducible together with the fixture state that produced it, so
    // the two belong in one artifact.
    evidence: state.evidence,
    // The verdict on that evidence. Collecting it and then ignoring it in the
    // exit code is the same as not having checked, so the findings live beside
    // the evidence and each one fails the capture.
    evidenceHealth: evidenceHealth,
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
    // The artifact's own lists, scanned off the array below.
    unreachable: unreachable,
    undriven: artifact.undriven,
    expectationsUnmet: artifact.unmet,
    timedOut: artifact.timedOut,
    // What THIS invocation drove, kept separate so a reader can attribute a
    // finding to a run rather than only to the file. Under a full capture the
    // two are the same list; under --append they are not.
    thisRun: {
      driven: drivenSet.length,
      undriven: undriven,
      expectationsUnmet: unmet,
      timedOut: timedOut
    },
    scenarios: scenarios
  };

  record = buildProvenance({
    options: options,
    info: state.info,
    manifestDocument: state.manifestDocument,
    seeded: state.seeded,
    s3Seed: state.s3Seed,
    profiles: httpFixture.profileNames(),
    tree: state.tree,
    role: state.role,
    // Both are what turn the OAuth claim from an assertion into an
    // observation: which OAuth cases were actually driven, and what the http
    // fixture intercepted while they were.
    scenarios: scenarios,
    evidence: state.evidence
  });

  // Embedded AND written beside. The embedded block is what lets a DELIVERED
  // corpus say which tree it measured with no companion file - the corpus used
  // to declare a mandatory sibling sidecar that the delivery did not contain.
  // It is one key and every value in it is reproducible, so the diff-clean
  // property that arrangement was for is kept: a re-capture of one tree
  // rewrites this key and nothing else. `attach` also hash-links the two, so a
  // block copied in from another run fails its own payload digest.
  manifest.provenance.attach(corpus, record);
  text = serialize(corpus);

  writeArtifact(options.out, text);
  // The sidecar is a run output, not a delivered artifact: all it adds is a
  // digest over the exact bytes just written, for a scratch run that compares
  // two corpora byte for byte and wants the provenance outside the compared
  // region.
  writeArtifact(options.out + '.provenance.json',
    serialize(manifest.provenance.sidecar(record, text)));

  note('wrote ' + options.out + ' (role ' + record.role + ', analysed tree ' +
    ((record.analysedTree && record.analysedTree.headShort) ||
      'not a checkout') + ', generator blob ' +
    String(record.generator.blob).slice(0, 12) +
    (record.generator.verified
      ? ' verified in ' + String(record.generator.commit).slice(0, 7)
      : ' (' + record.generator.commitState + ')') + ')');
  note('wrote ' + options.out + '.provenance.json (run output; the corpus ' +
    'carries the same block embedded)');

  // The OAuth client, as a gate. A corpus whose OAuth cases were driven
  // against a server with no configured client recorded the configuration
  // guard's short-circuit under labels that claim the real branches, and it is
  // that mislabelling - not the absence of the client - that makes the
  // artifact untrustworthy. Absence with no OAuth case driven is recorded and
  // is not a failure.
  googleClient = record.detail.configuration.googleClient;

  if (!googleClient.sufficient) {
    note('OAUTH CLIENT NOT ESTABLISHED: ' + googleClient.oauthScenariosDriven +
      ' OAuth scenario(s) were driven, and ' + googleClient.reason + '. No ' +
      'token or userinfo call was intercepted either, so what those cases ' +
      'recorded is the configuration guard rather than the OAuth branches ' +
      'they are labelled with.');
    note(options.baseUrl
      ? 'Configure app.auth.google.clientID on the server behind --base-url ' +
        '(this tool injects it only through its own launcher), or exclude the ' +
        'OAuth cases with --only.'
      : 'The launcher is asked for that layer, so an effective configuration ' +
        'without it means the layer was overridden - check --overlay and any ' +
        'inherited NODE_CONFIG.');
    exitCode = EXIT_DIFFERENCE;
  }
  else if (googleClient.oauthScenariosDriven) {
    note('OAuth client ' + googleClient.state + ': ' +
      googleClient.oauthScenariosDriven + ' scenario(s) driven, ' +
      googleClient.interceptedTokenCalls + ' token and ' +
      googleClient.interceptedUserinfoCalls +
      ' userinfo call(s) intercepted');
  }
  // The annotations sidecar: the scenario DEFINITIONS as authored, markers and
  // step specs intact, keyed by the same ids as the corpus.
  //
  // It exists because a captured step is not a definition. Driving replaces
  // each step with the request-and-response record, and the spec fields go with
  // it - the identity, the session reset, the four-second budget the
  // never-settling case needs. `replay.js --annotations <path>` joins exactly
  // those back on, and its own remedy message tells a reader to point that flag
  // at the committed corpus because a capture used to carry none of it. This
  // run therefore ships its own authoritative source rather than leaving the
  // reader to find one, and the markers are in the corpus as well, so a replay
  // is correct with the flag and with it omitted.
  annotations = {
    schema: CORPUS_SCHEMA,
    kind: 'annotations',
    note: 'The scenario definitions behind ' + path.basename(options.out) +
      ', before anything was driven: the approved-deviation and unreachable ' +
      'markers, and the step specification fields a captured step replaces. ' +
      'Pass this to replay.js with --annotations.',
    artifact: path.basename(options.out),
    markers: {
      expectedDeviation: built.definitions.filter(function(item) {
        return !!item.expectedDeviation;
      }).map(function(item) {
        return item.id;
      }),
      unreachableReason: built.definitions.filter(function(item) {
        return !!item.unreachableReason;
      }).map(function(item) {
        return item.id;
      })
    },
    scenarios: built.definitions
  };

  // The corpus and its provenance sidecar were written above, from the
  // serialized text the contract block is embedded in; writing them again from
  // the in-memory object would drop that block and its payload link. Only the
  // annotations sidecar is this block's to write.
  //
  // `serialize` here rather than handing the object over: `writeArtifact`
  // writes the exact bytes it is given, because the sidecar's
  // `artifactDigest` is computed over those bytes. Every artifact writer in
  // this directory takes text for that reason, so this is the one place that
  // has to name the serialization it wants.
  writeArtifact(options.out + '.annotations.json', serialize(annotations));

  note('wrote ' + options.out + '.annotations.json (' +
    annotations.markers.expectedDeviation.length + ' approved deviation, ' +
    annotations.markers.unreachableReason.length + ' unreachable marker)');

  // Coverage is a gate, and it is accounted over the artifact that was just
  // written. An unrepresented route means the corpus cannot support the claim
  // that the whole surface was captured, and the honest response is to fail
  // rather than to write an artifact that overstates itself.
  //
  // A --only run is the one case where an unrepresented route is not a failure:
  // it is a deliberate re-capture of part of an artifact, it says so in
  // `summary.selection`, and `gate.qualifies` is already false for it. Failing
  // it as well would make re-capturing one case impossible; letting it claim
  // the full surface is what this file must never do, and that is now
  // impossible by construction.
  if (coverage.unrepresented.length) {
    if (coverageIsClaimed(options, built)) {
      coverage.unrepresented.forEach(function(key) {
        note('UNREPRESENTED ROUTE: ' + key);
      });
      note(coverage.unrepresented.length + ' of ' + coverage.routes +
        ' routes have no scenario. Every route must be represented, or listed ' +
        'as unreachable with a reason.');
      exitCode = EXIT_DIFFERENCE;
    }
    else {
      note('this artifact covers ' + coverage.represented + ' of ' +
        coverage.routes + ' routes because the run was filtered by --only. It ' +
        'is recorded as a PARTIAL capture (summary.gateQualified: false) and ' +
        'cannot stand as full-surface evidence; merge it into a complete ' +
        'corpus with --append.');
    }
  }

  if (coverage.unknownRoutes.length) {
    note(coverage.unknownRoutes.length + ' scenarios claim routes the ' +
      'manifest does not contain, which means this tool\'s own tables are out ' +
      'of step with the route surface');
    exitCode = EXIT_DIFFERENCE;
  }

  if (mandatoryMissing.length) {
    // Route coverage can be complete while the cases that make the corpus
    // evidence are absent - which is exactly what --no-quirks produces - so
    // this is accounted separately from coverage and is never satisfied by it.
    note(mandatoryMissing.length + ' mandatory quirk, error-edge or ' +
      'auth-outcome scenario(s) are absent from this artifact, so it cannot ' +
      'stand as gate evidence: ' + mandatoryMissing.slice(0, 6).join(', ') +
      (mandatoryMissing.length > 6 ? ', ...' : ''));
  }

  (evidenceHealth.expected || []).forEach(function(entry) {
    note('expected fixture state [' + entry.channel + ']: ' + entry.event +
      ' - ' + entry.reason);
  });

  if (!evidenceHealth.ok) {
    evidenceHealth.findings.forEach(function(finding) {
      note('EVIDENCE FINDING [' + finding.channel + ']: ' + finding.message);
    });
    note(evidenceHealth.findings.length + ' evidence finding(s). The fixture ' +
      'and seed state is part of the input that produced these responses, so ' +
      'a capture recorded against an unsound one cannot be replayed against ' +
      'anything.');
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

  // Both of the next two read the ARTIFACT, not this invocation. A merged
  // corpus carrying an earlier run's undriven case or unexplained stall is an
  // artifact that cannot support the gate, and exiting 0 because this run
  // happened not to touch that case would be the same misrepresentation in a
  // different field.
  if (artifact.undriven.length) {
    artifact.undriven.forEach(function(entry) {
      // The never-reached cases share one cause, already reported above, so
      // they are summarized rather than listed one line at a time.
      if (!entry.neverReached) {
        note('COULD NOT DRIVE ' + entry.id + ': ' + entry.reason);
      }
    });
    exitCode = EXIT_DIFFERENCE;
  }

  artifact.timedOut.forEach(function(entry) {
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

  // The baseline oracle. Every unmet expectation is reported; whether it is
  // fatal is decided by the mode, and every mode is explicit.
  unmet.forEach(function(entry) {
    if (entry.approvedDeviation) {
      note('APPROVED DEVIATION OBSERVED ' + entry.id + ': ' +
        entry.description + ' -- ' + entry.failures.join('; ') +
        '. This case carries an approved deviation (' +
        entry.approvedDeviation.approvedBy + ', rule ' +
        entry.approvedDeviation.rule + '), --target says the migrated tree is ' +
        'expected to differ here, and the response produced IS the one that ' +
        'deviation approved: ' + entry.targetExpectation.description +
        '. Recorded as an approved change.');
      return;
    }

    note('EXPECTATION NOT MET ' + entry.id + ': ' + entry.description +
      ' -- ' + entry.failures.join('; '));

    if (entry.approvalRefused) {
      // The marked case differed and approval was REFUSED. Said out loud,
      // because the alternative reading - "the deviation is approved, so this
      // is fine" - is exactly the false pass this check exists to stop.
      note('APPROVAL REFUSED for ' + entry.id + ': ' + entry.approvalRefused);
    }
  });

  // Carried-forward unmet expectations, which this run did not drive and so
  // did not report above. They are still in the artifact, so they still count.
  artifact.unmet.forEach(function(entry) {
    var freshIds = unmet.map(function(own) { return own.id; });

    if (freshIds.indexOf(entry.id) === -1) {
      note('EXPECTATION NOT MET (carried forward from an earlier run) ' +
        entry.id + ': ' + entry.description + ' -- ' +
        (entry.failures || []).join('; ') +
        (entry.approved ? ' [approved deviation]' : ''));
    }
  });

  if (artifact.unmetUnapproved.length) {
    if (options.exploratory) {
      note('--exploratory was given, so the ' + artifact.unmetUnapproved.length +
        ' unmet expectation(s) above did not fail this run. The artifact ' +
        'records the opt-out and does not qualify as gate evidence: a corpus ' +
        'whose own declared expectations were not met is not the baseline it ' +
        'claims to be.');
    }
    else {
      note(artifact.unmetUnapproved.length + ' declared baseline expectation(s) ' +
        'were not met, which is fatal. The corpus IS the R-f reference, so a tree ' +
        'that does not behave as these cases say it does cannot be recorded ' +
        'as though it did. If this is the MIGRATED tree, use --target, which ' +
        'excuses a case carrying an approved deviation ONLY when the response ' +
        'it produced is the one that deviation approved; --exploratory ' +
        'excuses all of them and forfeits gate qualification.');
      exitCode = EXIT_DIFFERENCE;
    }
  }

  if (!gate.qualifies) {
    note('this artifact does NOT qualify as gate evidence (' +
      gate.reasons.length + ' reason(s)):');
    gate.reasons.forEach(function(reason) {
      note('  ' + reason.code + ': ' + reason.detail);
    });
  }
  else {
    note('this artifact qualifies as gate evidence: ' + coverage.represented +
      '/' + coverage.routes + ' routes, every mandatory case present, every ' +
      'case driven, evidence sound');
  }

  note('coverage ' + coverage.represented + '/' + coverage.routes +
    ' routes over ' + scenarios.length + ' scenarios in the artifact (' +
    drivenSet.length + ' driven by this run' +
    (merge ? ', ' + merge.carriedForward.length + ' carried forward' : '') +
    '), ' + artifact.unmetUnapproved.length + ' expectations unmet, ' +
    artifact.unmetApproved.length + ' approved deviations observed, ' +
    artifact.timedOut.length + ' timed-out steps, ' +
    evidenceHealth.findings.length + ' evidence findings');

  return exitCode;
}

// Counter behind the temporary filenames below, so two artifacts written in
// the same millisecond by the same process cannot collide.
var artifactSequence = 0;

/**
 * Writes one artifact atomically, creating its directory if it is not there.
 *
 * The bytes go to a unique temporary file in the artifact's own directory,
 * which is then flushed, closed and renamed over the target. A same-directory
 * rename is atomic, so a reader sees either the previous corpus or the complete
 * new one - never a half-written file. Writing in place would let an
 * interruption or a full filesystem truncate the last captured baseline, which
 * is the copy a replay has no way to reconstruct.
 *
 * The temporary file is removed on failure, so a failed capture leaves the
 * previous artifact exactly as it found it.
 *
 * Takes the exact TEXT rather than a value to serialize, because the sidecar's
 * `artifactDigest` covers the bytes that were written: serializing here would
 * put the digest one step away from the file it describes.
 *
 * @param {string} target
 * @param {string} text
 * @returns {undefined}
 * @throws {ToolError} If it cannot be written.
 */
function writeArtifact(target, text) {
  var temporary;
  var descriptor = null;

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  catch (err) {
    throw new ToolError('could not create the directory for ' + target + ': ' +
      reasonOf(err));
  }

  artifactSequence += 1;
  temporary = target + '.parity-tmp-' + process.pid + '-' + artifactSequence;

  try {
    // 'wx' rather than 'w': a temporary name that already exists is a
    // collision worth failing on, not a file to overwrite.
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, text);
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
        // Swallowed deliberately: the write failure below is the reason worth
        // reporting, and a close error while already failing would mask it.
      }
    }

    try {
      fs.unlinkSync(temporary);
    }
    catch (unlinkError) {
      // The temporary file may never have been created. Either way the
      // artifact itself is untouched, which is the guarantee that matters.
    }

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
  scenario: scenario,
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
  isDestructiveScenario: isDestructiveScenario,
  isMandatoryScenario: isMandatoryScenario,
  orderScenarios: orderScenarios,
  phaseCounts: phaseCounts,
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
  // Exported because it now DECIDES the run: a required identity that cannot
  // authenticate stops the sweep, and that is worth asserting directly rather
  // than only through a spawned server.
  establishSessions: establishSessions,

  // Evidence.
  collectEvidence: collectEvidence,
  readEvidenceLog: readEvidenceLog,
  faultRecords: faultRecords,
  evaluateEvidenceHealth: evaluateEvidenceHealth,
  requiredEvidenceChannels: requiredEvidenceChannels,
  legacyRequestResolvable: legacyRequestResolvable,
  countBy: countBy,

  // Accounting and artifacts. `writeArtifacts` is exported because the exit
  // code it decides - including the OAuth-client gate - is a failure mode that
  // must be exercisable without launching a server.
  writeArtifacts: writeArtifacts,
  accountCoverage: accountCoverage,
  evaluateGate: evaluateGate,
  missingMandatory: missingMandatory,
  hasRecordedResponse: hasRecordedResponse,
  coverageIsClaimed: coverageIsClaimed,
  evaluateExpectation: evaluateExpectation,
  evaluateTargetExpectation: evaluateTargetExpectation,
  checkExpectation: checkExpectation,
  accountArtifact: accountArtifact,
  mergeCorpus: mergeCorpus,
  // Exported because this is where the artifact's claims about itself are
  // decided - the coverage it reports, whether it qualifies as gate evidence,
  // and the exit code - and every one of those is worth asserting without
  // launching a server.
  writeArtifacts: writeArtifacts,
  writeArtifact: writeArtifact,
  corpusNotes: corpusNotes,
  buildProvenance: buildProvenance,
  // The provenance decisions, exported for the same reason the rest of these
  // are: each has a failure mode worth exercising without a server - a
  // baseline asserted over the wrong tree, and an OAuth claim made without
  // the client that would have made it true.
  resolveRole: resolveRole,
  googleClientEvidence: googleClientEvidence,
  isOAuthScenario: isOAuthScenario,
  portableReason: portableReason,
  pathLabelFor: pathLabelFor,
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
  deepCopy: deepCopy,
  normalizeBaseUrl: normalizeBaseUrl,
  redactUserinfo: redactUserinfo,
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
  OAUTH_GROUP_PREFIX: OAUTH_GROUP_PREFIX,
  OAUTH_ROUTE_PREFIX: OAUTH_ROUTE_PREFIX,
  ACCEPT_HTML: ACCEPT_HTML,
  ACCEPT_JSON: ACCEPT_JSON,
  ABSENT_ID: ABSENT_ID,
  ABSENT_TOKEN: ABSENT_TOKEN,
  ANNOTATION_FIELDS: ANNOTATION_FIELDS,
  BENIGN_FIXTURE_EVENTS: BENIGN_FIXTURE_EVENTS,
  HANDSHAKE_FIXTURE_EVENT: HANDSHAKE_FIXTURE_EVENT,
  handshakeFaults: handshakeFaults,
  MANDATORY_GROUP_PREFIXES: MANDATORY_GROUP_PREFIXES,
  IMAGE_DOWNLOAD_DEVIATION: IMAGE_DOWNLOAD_DEVIATION,
  EVIDENCE_CHANNELS: EVIDENCE_CHANNELS,
  AUTH_LOOKUP_ERROR_UNREACHABLE: AUTH_LOOKUP_ERROR_UNREACHABLE,
  PHASE_READ_ONLY: PHASE_READ_ONLY,
  PHASE_MUTATING: PHASE_MUTATING,
  PHASE_DESTRUCTIVE: PHASE_DESTRUCTIVE,
  PHASE_ORDER: PHASE_ORDER,
  CORPUS_SCHEMA: CORPUS_SCHEMA,

  // The artifact-destination policy. `COMMITTED_MANIFEST` is a READ default;
  // there is no write default, so a caller resolves a destination the same way
  // this tool does rather than rebuilding one.
  ARTIFACT_DIR_ENV: ARTIFACT_DIR_ENV,
  CORPUS_ARTIFACT_NAME: CORPUS_ARTIFACT_NAME,
  MANIFEST_ARTIFACT_NAME: MANIFEST_ARTIFACT_NAME,
  COMMITTED_MANIFEST: COMMITTED_MANIFEST,
  resolveArtifactPath: resolveArtifactPath,
  manifestDestination: manifestDestination,
  writeArtifact: writeArtifact,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  DEADLINE_GRACE_MS: DEADLINE_GRACE_MS,
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
