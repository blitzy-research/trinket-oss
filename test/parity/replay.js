#!/usr/bin/env node
'use strict';

// The parity gate: replay, diff and coverage accounting.
//
// Drives the committed baseline corpus against a RUNNING application and
// compares what came back with what was recorded, entry by entry and field by
// field. This is the gate AAP §0.9.3 names: "a request corpus captured from the
// baseline server (full route inventory) replayed against the migrated server
// yields identical normalized responses - status, content-type, cookies, body
// shape". It is binary. It either exits 0 having compared every scenario in the
// corpus against every route in the manifest, or it exits non-zero and names
// what differed.
//
// ===========================================================================
// RULES
// ===========================================================================
// `review_rules` returns exactly "No user rules provided." for this project,
// which AAP §0.7 and §0.10.1 independently record. No rule is invented here and
// their absence is not read as licence to lower the bar: enterprise practice
// governs. The commitment of test/parity/ that lands hardest on THIS file is
// the third one, and it is the whole design of the comparator:
//
//   NOTHING IS NORMALIZED AWAY THAT COULD BE COMPARED EXACTLY.
//
// Every field normalized is a field the migration is no longer checked on. So
// the volatile set is a CLOSED list of six categories, written once, in one
// place, as a named and enumerable value (see THE VOLATILE SET below), and
// every act of normalization in this file goes through it. There is no inline
// regex scattered through the comparators, because a reviewer must be able to
// read the whole weakening in one screen and because an addition to it has to
// show up as a visible diff.
//
// The request's own RULES block is binding and is not that document:
//   R-a  The diff must read as migration work only. This file is new tooling
//        the migration requires. It changes no application module, edits no
//        configuration, writes nothing into the tree under test, and never
//        rewrites the corpus.
//   R-b  No route excluded. Coverage is accounted against every entry in the
//        233-route manifest and an unrepresented route FAILS the run. An entry
//        that genuinely cannot be driven is listed with its stated reason.
//   R-d  Behaviour improvements are PROHIBITED, so a difference is a FAILURE
//        even when the new behaviour looks better. The sole exception is a
//        scenario carrying an `expectedDeviation` marker, and that marker is
//        checked against what the deviation was approved to be - a deviation
//        that did not materialize, or materialized differently, fails.
//   R-e  Error-to-response mappings must survive unchanged, which is why the
//        failure-path scenarios are replayed with exactly the same rigour as
//        the success sweep and are accounted separately in the coverage table.
//   R-f  Baseline observed behaviour at 2f8712a is the tie-breaker. The corpus
//        IS that record. This file never records one and never updates one -
//        that is capture.js's job, deliberately in a separate file.
// The BOUNDARIES & PRESERVATION clauses on client-visible page behaviour, asset
// URLs and session/auth behaviour are bound to the comparison rules below:
// rendered text, form values, ids, classes, data-/ARIA attributes and href/src
// are compared, not stripped; every cookie attribute is compared; and all five
// auth-scheme outcomes are asserted independently.
//
// ===========================================================================
// WHAT IS COMPARED EXACTLY
// ===========================================================================
// Status and status message. Content-type less its charset parameter. Location.
// Content-Disposition. Every remaining response header, including the four
// error-page headers, which are compared PER BRANCH as measured rather than as
// the code's shape suggests - app.js's first onPreResponse extension RETURNS
// EARLY on 401/404/403/>=500 for a browser HTML request, before the
// Cache-Control / Pragma / Expires / X-Frame-Options assignments, so those four
// reach API-or-JSON error responses and non-Boom responses only, and a 400 Boom
// falls through and does receive them. Every Set-Cookie attribute: name,
// HttpOnly, Secure, SameSite, Path, Domain, Max-Age, and the presence and
// approximate one-year horizon of Expires. For HTML: the rendered text, form
// and input names and values, id and class attributes, data- and ARIA
// attributes, inline-script presence, and href/src values - asset URLs are part
// of the preserved surface, so they are compared rather than stripped. For
// JSON: structurally, so key order cannot create a false difference, with every
// scalar compared exactly and by type, and a missing key reported as one. For
// binary or stream bodies: length always, and content digest for every type
// except the six enumerated ARCHIVE CONTAINER types, whose headers embed each
// entry's modification time - measured, two captures of the identical tree
// produced two digests for the same 182-byte zip. For those six the digest is
// recorded as an observation and the length is compared exactly, the exemption
// is declared in the timestamps category of the volatile set and nowhere else,
// and the archive's internal layout is asserted by ./storage and ./worker,
// which open it rather than hashing it. That is the whole contract, both halves
// of it, and `describeBinaryBodyContract` emits it into every artifact so a
// document quoting it cannot state only the first half.
//
// The Expires horizon is the single most valuable assertion in the file. AAP
// §0.9.6 lists the private-field cookie patch (app.js, the second onPreResponse)
// as an open item precisely because its failure mode is SILENCE: it runs only
// while `request.response._header` is a function, so if hapi 21 stopped
// populating that private field the patch would become a no-op, cookie expiry
// would quietly change, and nothing would error. Comparing the horizon in whole
// days - the timestamp is volatile, the horizon is not - is the only way that
// is detectable.
//
// ===========================================================================
// THE THREE CORPUS FACTS THIS FILE HAD TO BE BUILT AROUND
// ===========================================================================
//   1. A CORPUS WITH NO BASELINES IS NOT REPLAYABLE, AND IS NOT PRETENDED TO
//      BE. The committed corpus.json ships as DEFINITIONS: every scenario
//      carries `baseline: null`, every step carries `response: null`, and
//      `summary.captured` is false. Its own first note says why - "an invented
//      status would make the parity gate pass against a fiction". So this file
//      validates the corpus BEFORE it launches anything, and a corpus with no
//      recorded response exits non-zero naming capture.js as the remedy. It
//      does not drive a server it has nothing to compare against.
//   2. A CAPTURE DROPS THE DEVIATION MARKER. capture.js's scenario builder
//      emits neither `expectedDeviation` nor `unreachableReason` - both live in
//      the committed definition file - and a capture replaces the scenario
//      array wholesale. A captured corpus therefore arrives WITHOUT the one
//      marker that distinguishes an approved change from a regression. Rather
//      than silently defaulting to a marker source, which would make the
//      deviation control vacuous, `--annotations <path>` joins the markers back
//      on by scenario id and the report says which source supplied each one.
//      With no --annotations, a missing marker means the difference FAILS, and
//      the failure message names the flag.
//   3. A CORPUS DOES NOT SAY WHICH TREE IT RECORDED, so its provenance sidecar
//      is REQUIRED and is validated before anything is driven. Being an array
//      of scenarios leaves three failure modes indistinguishable from a clean
//      gate: a corpus captured from the MIGRATED tree replayed against the
//      migrated tree, which is a self-comparison that cannot fail; a corpus
//      captured from some intermediate commit, which records behaviour nobody
//      approved; and a corpus edited after capture, which is a baseline
//      adjusted to match the target. `<corpus>.provenance.json` - what
//      capture.js writes, and the convention ./manifest and ./joi-matrix
//      follow - is checked for the captured tree's commit against the R-f
//      baseline reference, the generator's own commit and path, agreement with
//      the corpus schema, and any artifact digest it declares. The digest of
//      the file this run actually read is recorded either way. `--annotations`
//      needs no sidecar: it supplies markers, not responses.
//
// ===========================================================================
// THE TWO COOKIE PASSES, AND THE HONEST LIMIT OF THE SECOND
// ===========================================================================
// AAP §0.9.3 requires both: the non-secure overlay (Yar SameSite=Lax, no
// Secure) and `--secure` (the patch appending "; SameSite=None; Secure"). Both
// run here by default, each against its own freshly provisioned database and
// its own server, and each is reported separately.
//
// The limit, stated rather than papered over: the committed corpus was captured
// through the launcher's NON-SECURE default, so there is no recorded baseline
// for the secure pass. The secure pass therefore replays the SAME scenarios in
// the SAME order - a subset would change the cross-request session state some
// responses embed, which was measured - and asserts the DOCUMENTED DIFFERENTIAL
// on the cookie attributes: `secure` becomes true on every session cookie,
// `samesite` moves Lax -> None on the cookies the private-field patch touched,
// and the Expires horizon is unchanged. Every other field is compared exactly,
// because `isSecure` moves nothing else. Both artifacts say that this is a
// derived contract rather than a measurement. Capture a secure-pass corpus and
// pass `--secure-corpus <path>` and the pass compares exactly instead, with no
// derivation at all.
//
// A DERIVED SECURE PASS IS NOT GATE-QUALIFYING, and that is what makes the
// limit above a stated limit rather than a quiet substitution. AAP §0.9.3 asks
// for the secure configuration to be MEASURED; a differential computed from the
// non-secure recording is this tool's own arithmetic about what the secure pass
// ought to produce, and arithmetic cannot detect the case where it is wrong.
// So the derived pass still runs, still compares every other field exactly and
// still fails on a difference - and `measured-secure-pass` is reported as an
// unmet gate requirement until a secure corpus is supplied.
//
// ===========================================================================
// PROHIBITIONS - each with its reason, and where it is honoured
// ===========================================================================
//   No require of the application: not app.js, not the configuration
//     directory, not the library directory, and not the suite's own helper or
//     spec directories - the last two pull the application in through the side
//     door, since the suite's flow helper requires app.js at its top. The
//     application is a CHILD PROCESS owned by ./server. Honoured at the require
//     block below: six Node core modules and four sibling parity modules, all
//     four declared dependencies of this file. The two forbidden test
//     directories are never named as a path here, in code or in comment, so the
//     prohibition is checkable with a grep rather than by reading.
//   No legacy URL parsing. The Node core function that emits DEP0169 is not
//     used and is not named; `new URL(...)` is used throughout. This process's
//     stderr sits inside the very stream the zero-warning gate inspects, so a
//     deprecation emitted by the gate itself would corrupt the gate.
//   No broadening of the volatile set. Six categories, one list, and an
//     addition is a weakening that has to be justified in docs/baseline-parity.md
//     naming the field, why seeding could not make it deterministic instead,
//     and what coverage is lost.
//   No re-capture. Nothing in this file writes to the corpus path, and the
//     comparison never falls back to "record what we saw".
//   No pass-with-warnings mode, no --force, no threshold that lets N
//     differences through. There is no option in the parser that can turn a
//     difference into a pass. A narrowed run (--only, a single pass, or
//     --allow-unreviewed-corpus) is labelled `gateQualifying: false` in both
//     artifacts and in the closing line, because a diagnostic must never be
//     mistaken for the gate.
//   No unverified input. The corpus every comparison is made against, and the
//     route manifest the coverage gate counts against, are checked through
//     `require('./manifest').provenance` BEFORE they are consumed: schema, the
//     artifact they claim to be, a role that qualifies for the use, a
//     generator named by the blob that ran and a commit VERIFIED to contain
//     it, every recorded object - generator blob, generator commit, analysed
//     head, delivered head - resolved in this repository, an analysed tree at
//     the base commit, the payload digest recomputed over the artifact's own
//     bytes, and any sidecar sitting beside the artifact reconciled with those
//     bytes. A corpus with a `scenarios` array used to be enough, which is how
//     a capture from another tree could have become the reference for a whole
//     replay.
//   No waived identity on a gate path. Identity resolution is exactly what a
//     payload digest cannot establish - a fabricated artifact hashes to
//     whatever it claims - so the mode that records those checks as waived is
//     reachable only from --allow-unreviewed-corpus, which already labels the
//     run gateQualifying: false. It was a default at the one call site while
//     the generators were uncommitted; they are committed, and the default is
//     gone.
//     difference into a pass. And `gateQualifying` is decided by the TEN
//     requirements AAP §0.9.3 puts on the gate, each reported by name in both
//     artifacts and in the closing line: the whole corpus, both cookie passes,
//     a secure baseline whose provenance ATTESTS a secure capture rather than a
//     derived differential, the two deprecation flags actually reaching the
//     child, warning evidence from every pass, a manifest that IS the
//     registered surface key for key in both directions, a real baseline
//     rather than --self-check, a corpus authenticated by digest as
//     capture.js's recording of the frozen R-f baseline, a known commit for
//     the tree under test, and all five auth-scheme outcomes DRIVEN rather
//     than explained by a stated reason. A run missing any of them is a
//     diagnostic, and a diagnostic must never be mistaken for the gate.
//   No clause left unevaluated. The declared-expectation grammar is a CLOSED
//     list (EXPECTATION_STEP_KEYS and EXPECTATION_CROSS_KEYS), every key in it
//     is implemented by `evaluateExpectation`, and `assertExpectationSchema`
//     refuses the run on anything outside it. A clause that reads as a check
//     and asserts nothing is worse than an absent check, because the corpus
//     tells its reader the check exists.
//   Nothing is written to stdout except by explicit request. Both artifacts go
//     to files, and the human report is written to a file as well as being
//     echoed, because "never write the report to stdout as the only copy" is
//     what makes it citable from docs/baseline-parity.md.
//
// ===========================================================================
// INVOCATION
// ===========================================================================
//   node test/parity/replay.js --app . --port 3010
//   node test/parity/replay.js --app . --corpus test/parity/corpus.json \
//     --annotations test/parity/corpus.json --out /tmp/replay.json
//   node test/parity/replay.js --app ../baseline-2f8712a --pass non-secure
//   node test/parity/replay.js --app . --only /quirk\./ --pass non-secure
//
// As a module: `replay(options)` returns the result document and never throws
// for a difference. The CLI runs only under `require.main === module`.

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

// The zero-warning gate, stated once for all four parity gates. Nothing about
// the bar is decided in this file: what counts as a notice, which flags the
// measurement requires, and the fact that there are no allowances all live in
// test/parity/warning-policy.js, and this file supplies the evidence and the
// breadth requirements that only a full replay can know about.
var warningPolicy = require('./warning-policy');

// The fixture catalogues, required for their frozen reference data only.
//
// Both auto-install on first require, and the http one patches this process's
// global fetch so that an endpoint it holds no recording for REJECTS rather
// than reaching the network. A driver built on global fetch would therefore
// have every one of its own requests to localhost refused the moment the
// catalogue loaded. This file drives through node:http and restores both
// fixtures immediately, so nothing in this process stays patched; the copies
// that matter run in the CHILD, where ./server preloads them.
var httpFixture = require('./fixtures/http');
var mailFixture = require('./fixtures/mail');

// The model-boundary fault fixture, required for its `arming()` builder only,
// so the arming document's field names live in one place. Safe to require here
// for the reason its header gives: it loads no application module and patches
// nothing until something requires lib/models/user, which this process never
// does.
var modelFixture = require('./fixtures/model');

// Required lazily, after PARITY_S3_ROOT has been pointed at the launcher's
// store, because it resolves its root at load.
var awsFixture = null;

// The restores are wrapped because a restore fault must not take the run down
// before it has reported anything useful.
try {
  httpFixture.restore();
}
catch (httpRestoreError) {
  process.stderr.write('replay: warning: could not restore the http fixture ' +
    'in this process: ' +
    (httpRestoreError && httpRestoreError.message
      ? httpRestoreError.message
      : String(httpRestoreError)) + '\n');
}

try {
  mailFixture.restore();
}
catch (mailRestoreError) {
  process.stderr.write('replay: warning: could not restore the mail fixture ' +
    'in this process: ' +
    (mailRestoreError && mailRestoreError.message
      ? mailRestoreError.message
      : String(mailRestoreError)) + '\n');
}

try {
  modelFixture.restore();
}
catch (modelRestoreError) {
  process.stderr.write('replay: warning: could not restore the model fixture ' +
    'in this process: ' +
    (modelRestoreError && modelRestoreError.message
      ? modelRestoreError.message
      : String(modelRestoreError)) + '\n');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var LOG_PREFIX = 'replay: ';

// The repository root. Used as the working directory of every child this file
// spawns, so one consistent module tree resolves for the tooling regardless of
// which worktree `--app` names.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

// The two committed inputs. These are READ defaults and stay repository paths:
// reading the corpus and the manifest a reviewer can see is the point, and a
// read cannot damage either.
var DEFAULT_CORPUS   = path.join(__dirname, 'corpus.json');
var COMMITTED_MANIFEST = path.join(__dirname, 'route-manifest.json');

// The environment variable that names ONE scratch directory for the default
// artifacts of every test/parity tool.
//
// There is deliberately NO repository default for anything this tool WRITES.
// Result, provenance and report destinations that fall back to test/parity/
// mean every ordinary invocation - a diagnostic run, an `--only` subset, a
// harness spawning this file - drops three untracked files into source. So a
// destination is either named on the command line or taken from this
// directory; a path inside the worktree is still allowed but has to be asked
// for.
var ARTIFACT_DIR_ENV = 'PARITY_ARTIFACT_DIR';

// The basenames used when a destination comes from ARTIFACT_DIR_ENV rather
// than from a flag.
var ARTIFACT_NAMES = {
  result   : 'replay-result.json',
  report   : 'replay-report.txt',
  manifest : 'route-manifest.json'
};

// Matches capture.js. A step that recorded its own timeout carries it, and this
// is the fallback for one that does not.
var DEFAULT_TIMEOUT_MS = 15000;

// The readiness budget. Generous because the child provisions a database, loads
// every controller and compiles the view engine before it answers.
var DEFAULT_READY_TIMEOUT_MS = 120000;

// Budgets for the children this file runs, all finite. This tool holds an
// in-memory mongod and one or two application servers open while it works, so a
// child that never finishes does not just delay the comparison - it strands
// those and the result artifact is never written.
//
//   SEED_TIMEOUT_MS      The seeder writes a fixed set of fixtures into a
//                        database this process provisioned. Normally under a
//                        second; the budget covers a cold `mongoose` load and
//                        mongod's own 30s server-selection window.
//   SEED_KILL_GRACE_MS   SIGTERM to SIGKILL, and SIGKILL to giving up on
//                        reaping. Short: the seeder holds nothing worth
//                        flushing.
//   GIT_TIMEOUT_MS       `git rev-parse HEAD`, local and instant.
//   CHILD_TIMEOUT_MS     The route-manifest generator and the object-store
//                        manifest child, which load application modules.
var SEED_TIMEOUT_MS    = 120000;
var SEED_KILL_GRACE_MS = 5000;
var GIT_TIMEOUT_MS     = 10000;
var CHILD_TIMEOUT_MS   = 120000;

// The only options that may appear more than once. `--only` accumulates a
// scenario selection and `--node-flags` accumulates the flags the child is
// started with; every other option takes effect once, and a second occurrence
// is a usage error rather than a silent last-one-wins.
var REPEATABLE_OPTIONS = ['--only', '--node-flags'];

// The text cut-off capture.js applies. Reproduced so that a body the corpus
// truncated is compared against an equally truncated observation rather than
// reported as a length difference on every large page.
var MAX_TEXT_BYTES = 262144;

var EXIT_OK         = 0;
var EXIT_DIFFERENCE = 1;
var EXIT_ERROR      = 2;

// Which content types are recorded as text. Identical to capture.js's rule,
// because the corpus's `body.encoding` was decided by it and a divergence here
// would compare a text body against a binary record.
var TEXTUAL_TYPE = /^(?:text\/|application\/(?:json|javascript|xml|xhtml\+xml|x-www-form-urlencoded|graphql)|[a-z-]+\/[a-z0-9.+-]*\+(?:json|xml))/i;

var IDENTITY_ANONYMOUS = 'anonymous';
var IDENTITY_USER      = 'user';
var IDENTITY_ADMIN     = 'admin';
var IDENTITY_DISABLED  = 'disabled';
var IDENTITY_MISSING   = 'missingRecord';

var IDENTITIES = Object.freeze([
  IDENTITY_ANONYMOUS,
  IDENTITY_USER,
  IDENTITY_ADMIN,
  IDENTITY_DISABLED,
  IDENTITY_MISSING
]);

// The three identities that hold a session by logging in. `anonymous` holds
// none by definition and `missingRecord` is built by a scenario's own steps.
var PASSWORD_IDENTITIES = Object.freeze([
  IDENTITY_USER,
  IDENTITY_ADMIN,
  IDENTITY_DISABLED
]);

var ACCEPT_HTML = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
var ACCEPT_JSON = 'application/json';

var FORM_TYPE = 'application/x-www-form-urlencoded';
var JSON_TYPE = 'application/json';

// The user agent every replayed request carries. Deliberately distinct from
// capture.js's, because nothing in the application varies on it and a reader of
// a server log should be able to tell which tool produced a request.
var USER_AGENT = 'trinket-parity-replay';

// The fake Google client, byte-identical to the one capture.js injects.
//
// Both OAuth handlers short-circuit to request.fail without a configured
// client, so without this layer the OAuth scenarios would take a different
// branch than the one the corpus recorded - and the values reach the rendered
// login page, so they have to be the SAME fake, not merely a fake. Nothing
// authenticates against anything: the token and profile endpoints are
// intercepted at the module boundary by fixtures/http.js.
var GOOGLE_STUB = Object.freeze({
  clientID: 'parity-harness-client-id.apps.example.invalid',
  clientSecret: 'parity-harness-not-a-real-secret',
  callbackURL: '/auth/google/callback'
});

// The tolerance on the cookie Expires horizon, in whole days.
//
// The absolute timestamp is volatile - it is "one year from whenever the
// response was produced" - but the HORIZON is the contract. Two days absorbs a
// baseline captured on one date and replayed on another, plus the leap-year
// step, while still failing outright on the change this assertion exists to
// catch: a horizon that collapses to session-only, or to hapi's or Yar's own
// default, is hundreds of days away from a year.
var EXPIRES_HORIZON_TOLERANCE_DAYS = 2;

// The scenario groups and ids this file asserts on by name. Each is a decision
// recorded in the corpus, and naming them here is what keeps a rename from
// silently disabling an assertion: a name that no longer resolves is reported.
var DEVIATION_SCENARIO_ID = 'quirk.reply-chain.never-settles.image-download';
var HEADER_RESOLVED_GROUP = 'quirk.reply-chain.header-resolved';
var AUTH_OUTCOME_GROUP    = 'auth-outcome';
// The one scenario that cannot assert its outcome without an injected fault.
// Named here so `assertFaultControls` and `accountAuthOutcomes` refer to the
// same string rather than each spelling it out.
var LOOKUP_ERROR_SCENARIO = 'auth.outcome.lookup-error';

// The five outcomes of the session auth scheme [app.js:243-281], as the corpus
// ids that drive them. THE LIST IS THE ASSERTION: AAP §0.9.3 requires all five
// independently, and a group that arrived with four scenarios would otherwise
// report "4 asserted, ok" - which is the exact shape of a gate that passes by
// not looking. A missing id is a failure under a complete selection, and a
// renamed one shows up as missing rather than as silence.
var AUTH_OUTCOME_IDS = Object.freeze([
  'auth.outcome.not-logged-in',
  'auth.outcome.valid-user',
  'auth.outcome.user-not-found',
  'auth.outcome.account-disabled',
  'auth.outcome.lookup-error'
]);

// Four of those five are reachable over HTTP. The fifth needs `User.findById`
// itself to reject, which no request can cause, so it carries a stated reason
// and is asserted by the server-level gate that can inject the fault. This
// minimum is what stops "one outcome was driven" from counting as coverage.
var MIN_AUTH_OUTCOMES_DRIVEN = 4;

// The four header-resolved reply chains AAP §0.6.6 enumerates - files.js:102-105,
// courses.js:269-272, trinket.js:1383-1386 and trinket.js:1548-1551. They are
// the collateral-damage guard on the §0.7 decision, so the COUNT is part of the
// assertion: three of them checked is one chain nobody looked at.
var HEADER_RESOLVED_CHAIN_COUNT = 4;

// The node flags AAP §0.9.3 requires of the gate run, verbatim. The whole
// exercise - the listening server, the full pass over all 233 routes, and the
// worker - runs under both, because §0.6.4's finding is that two internal
// re-entrant injections put a deprecation on the LIVE REQUEST PATH and a boot
// that never serves a request never reveals them. A run without them still
// scans stderr, and still reports what it finds; what it cannot be is the gate.
var REQUIRED_NODE_FLAGS = Object.freeze([
  '--pending-deprecation',
  '--trace-deprecation'
]);

// The R-f baseline reference, AAP §0.10.3. A corpus is a baseline recording, so
// its provenance sidecar has to name this commit: a corpus captured anywhere
// else is a recording of some other tree's behaviour, and comparing against it
// proves nothing about the migration. `--baseline-head` relaxes it explicitly
// and --self-check turns it off by declaration, because there the corpus comes
// from the tree under test on purpose.
var BASELINE_COMMIT = '2f8712a112db46f923918c4507c75abc732d83d0';

// The sidecar every captured artifact in this folder carries, by convention -
// capture.js writes `<out>.provenance.json` and joi-matrix.js and manifest.js
// do the same. Replay REQUIRES it for a corpus it compares against, because a
// corpus without one does not say which tree it recorded.
var PROVENANCE_SUFFIX = '.provenance.json';

// The only generator whose output is a baseline recording. A corpus is
// capture.js's artifact - it is what drives the requests and records the
// responses - so a sidecar naming anything else describes a file that was
// produced some other way, and a run comparing against it may not be cited as
// the gate. Matched on the basename, because the sidecar records the path
// relative to whichever worktree produced it.
var CAPTURE_GENERATOR = 'capture.js';

// ---------------------------------------------------------------------------
// The declared expectation grammar
// ---------------------------------------------------------------------------
//
// The complete set of keys an expectation may carry, and the reason it is a
// closed list: an operator this file does not implement is a check that reads
// as declared and asserts nothing. Four of these - `statusIn`, `headerPresent`,
// `bodyIncludes` and `cross.bodiesDiffer` - were authored in the corpus and
// silently ignored here, which made sixteen clauses and eleven whole scenarios
// inert, including the OAuth existing-user differentiator. Every key below is
// implemented by `evaluateExpectation`, and anything outside the list is
// rejected by `assertExpectationSchema` before a single request is driven.
// ---------------------------------------------------------------------------

var EXPECTATION_KEYS = Object.freeze(['description', 'steps', 'cross']);

var EXPECTATION_STEP_KEYS = Object.freeze([
  'index',
  'timedOut',
  'status',
  'statusIn',
  'notStatus',
  'locationEndsWith',
  'headerPresent',
  'bodyIncludes'
]);

var EXPECTATION_CROSS_KEYS = Object.freeze(['locationsEqual', 'bodiesDiffer']);

// Every step key except `index`, which addresses a step rather than asserting
// anything about it. A clause carrying only an index is a clause that checks
// nothing, and it is rejected as such.
var EXPECTATION_STEP_OPERATORS = Object.freeze(
  EXPECTATION_STEP_KEYS.filter(function(key) { return key !== 'index'; }));

// The four error-page headers. Named as a group because they are compared per
// branch and because the report explains them together.
var ERROR_PAGE_HEADERS = Object.freeze([
  'cache-control',
  'pragma',
  'expires',
  'x-frame-options'
]);

// The headers the agent prompt enumerates for exact comparison, in the order it
// gives them. Every OTHER header is compared exactly too - this list exists so
// the report can lead with the ones the contract names.
var NAMED_HEADERS = Object.freeze([
  'content-type',
  'location'
].concat(ERROR_PAGE_HEADERS).concat(['content-disposition']));

// The cookie attributes compared one by one. `expires` is compared as presence
// plus horizon rather than as a value, which is why it is not in this list and
// has an assertion of its own.
var COOKIE_ATTRIBUTES = Object.freeze([
  'httponly',
  'secure',
  'samesite',
  'path',
  'domain',
  'max-age'
]);

// A response body larger than this is excerpted rather than quoted whole in a
// difference record, so one divergent page cannot produce a megabyte of report.
var EXCERPT_BYTES = 400;

// How many differences one scenario contributes before the rest are summarized.
// This is a REPORT bound, never a gate bound: the count is always complete and
// the run always fails, only the enumeration is capped. A single rendered page
// that changed layout would otherwise emit one record per class attribute.
var MAX_DIFFERENCES_PER_STEP = 25;

// ---------------------------------------------------------------------------
// Frozen reference values the volatile set guards against
// ---------------------------------------------------------------------------

/**
 * Every identifier the seeder pins, as a lookup.
 *
 * This is what makes the generated-id category NARROW rather than a blanket
 * scrub of anything that looks like an object id. A 24-hex token that IS a
 * seeded id is compared exactly - a response that returned the wrong seeded
 * document is precisely the kind of difference this gate exists to catch - and
 * only a token outside this set is treated as generated.
 *
 * @returns {Object} a null-prototype map used as a set
 */
function seededIdentifiers() {
  var known = Object.create(null);

  Object.keys(seed.ids).forEach(function(key) {
    known[String(seed.ids[key]).toLowerCase()] = true;
  });

  (seed.MISSING_IDS || []).forEach(function(entry) {
    if (entry && entry.id) {
      known[String(entry.id).toLowerCase()] = true;
    }
  });

  return known;
}

/**
 * Every timestamp the seeder pins, as a lookup.
 *
 * The seeder writes fixed dates - `created`, `lastUpdated`, `dueOn` and the
 * rest are literals, not clock reads - so a timestamp that appears in a
 * response because a SEEDED document carries it is deterministic and is
 * compared exactly. Only a timestamp this run produced is volatile, and the
 * recency guard below is what separates the two.
 *
 * @returns {Object} a null-prototype map used as a set
 */
function seededTimestamps() {
  var known = Object.create(null);
  var dates = (seed.fixtures && seed.fixtures.dates) || {};

  Object.keys(dates).forEach(function(key) {
    var value = String(dates[key]);
    var parsed = Date.parse(value);

    known[value] = true;

    if (!isNaN(parsed)) {
      // The same instant in the two other spellings a response can carry it
      // in: the model layer renders Dates through JSON as ISO-8601, and a
      // handler that serialized one numerically emits epoch milliseconds.
      known[new Date(parsed).toISOString()] = true;
      known[String(parsed)] = true;
    }
  });

  return known;
}

var SEEDED_IDS   = Object.freeze(seededIdentifiers());
var SEEDED_DATES = Object.freeze(seededTimestamps());

// How close to "now" a timestamp has to be before it is treated as one this
// run produced.
//
// 400 days, and the number is chosen from the fixtures rather than picked: the
// seeder's own dates sit in 2024, 2020 and 2099, all of them further from any
// plausible run date than this window, so every pinned timestamp is compared
// EXACTLY and only a clock read taken during the capture or the replay is
// normalized. The window is wide enough that a corpus captured a year before it
// is replayed still compares.
var RECENT_TIMESTAMP_WINDOW_MS = 400 * 24 * 60 * 60 * 1000;

/**
 * Whether an instant is close enough to now to have been produced by a run.
 *
 * @param {number} instant milliseconds since the epoch
 * @returns {boolean}
 */
function isRunEraInstant(instant) {
  return !isNaN(instant) &&
    Math.abs(Date.now() - instant) <= RECENT_TIMESTAMP_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// THE VOLATILE SET
// ---------------------------------------------------------------------------
//
// Six categories. This list is the ONLY place in this file where a value is
// normalized away, and it appears exactly once. Every comparator below reaches
// its normalization through `normalizeText`, `volatileHeaders`,
// `presenceOnlyHeaders`, `volatileCookieFields` and `volatileResponseFields`,
// all of which are DERIVED from this list - so adding a category here changes
// the comparator everywhere at once, and nothing can be normalized without
// appearing here.
//
// Each entry carries the justification a reviewer needs, in the terms the
// agent prompt sets: what the field is, why seeding could not make it
// deterministic instead, and what coverage is lost. The whole list is emitted
// into the result document under `volatileSet`, so docs/baseline-parity.md can
// cite these justifications verbatim rather than paraphrasing them.
//
// AN ADDITION TO THIS LIST IS A WEAKENING. Prefer fixing the seed:
// test/parity/seed.js exists precisely so ids are comparable rather than
// scrubbed, and its pinned dates are why the timestamp category below is
// guarded by a recency window instead of matching every date it sees.
// ---------------------------------------------------------------------------

var VOLATILE_SET = Object.freeze([
  Object.freeze({
    id: 'generated-ids',
    title: 'Generated identifiers not covered by fixed seeds',
    why: 'A document created DURING the run gets a real MongoDB ObjectId, and ' +
      'a share or invitation token gets a fresh signature. Neither can be ' +
      'pinned by seeding, because the value is minted by the code under test ' +
      'as the mutating scenario runs.',
    seedingAlternative: 'Not available for created documents. Every id a ' +
      'scenario READS is already pinned by test/parity/seed.js and is ' +
      'therefore compared exactly - only an id this run minted is normalized.',
    coverageLost: 'That two runs minted the same id, which is not behaviour. ' +
      'The SHAPE is still compared: a 24-hex id that stopped being emitted, ' +
      'or was emitted where none was before, still shows as a difference. For ' +
      'the encrypted roles token, what is lost is the ciphertext - its ' +
      'plaintext is the seeded user\'s roles, which are fixed by the seeder ' +
      'and asserted through every other projection that exposes them - while ' +
      'the element carrying it, its id, its type and its position are all ' +
      'still compared.',
    headers: [],
    presenceOnlyHeaders: [],
    cookieFields: [],
    responseFields: [],
    textPatterns: Object.freeze([
      Object.freeze({
        name: 'non-seeded ObjectId hex',
        expression: /\b[0-9a-f]{24}\b/g,
        replace: function(match) {
          return SEEDED_IDS[match.toLowerCase()] ? match : '<generated-objectid>';
        }
      }),
      Object.freeze({
        name: 'JWT-shaped token',
        expression: /\b[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g,
        replace: function() {
          return '<generated-token>';
        }
      }),
      Object.freeze({
        // lib/util/roles.js's `encrypt` mints `crypto.randomBytes(16)` as the
        // key on EVERY call and returns `<32 hex>+<AES ciphertext>`, where the
        // ciphertext always begins with the base64 of the OpenSSL salt marker.
        // It is rendered into a hidden input on the home page and into one
        // user projection, so it appears in both HTML and JSON. MEASURED
        // across two captures of the identical tree: it is the only rendered
        // value besides the cache prefix that differs, and it differs in full.
        name: 'per-render encrypted roles token',
        expression: /\b[0-9a-f]{32}\+U2FsdGVkX1[A-Za-z0-9+/=]+/g,
        replace: function() {
          return '<generated-encrypted-roles>';
        }
      })
    ])
  }),

  Object.freeze({
    id: 'timestamps',
    title: 'Timestamps, including the rendered cache-prefix and recorded timing',
    why: 'Three distinct sources, all of them clock reads. (1) A document ' +
      'created or touched during the run carries the instant it was written. ' +
      '(2) lib/util/stringUtils.js\'s addPrefix inlines Date.now() into every ' +
      'asset URL as /cache-prefix-<epoch-millis>/ when the prefix is ' +
      'unconfigured, and all eight config/default.yaml prefixes ARE ' +
      'unconfigured - measured, 20 of 242 read-only responses differed on ' +
      'this and on nothing else. (3) The recorded elapsed time of a request, ' +
      'and the Last-Modified of a file served by the static handler, which is ' +
      'the checkout mtime of the file rather than anything the application ' +
      'decides.',
    seedingAlternative: 'Applied where it exists and preferred over ' +
      'normalizing: the seeder pins every fixture date as a literal, so a ' +
      'seeded document\'s timestamps are compared EXACTLY and only an instant ' +
      'inside the run-era window is normalized. The cache-prefix is not ' +
      'reachable that way - it is read from the clock at RENDER time, not ' +
      'from configuration, so no overlay and no fixture can pin it. ' +
      'Last-Modified is set from the file\'s mtime, which git assigns at ' +
      'checkout, so two worktrees of the same content cannot agree on it.',
    coverageLost: 'The exact instant a value was produced. The cache-prefix ' +
      'literal itself is still compared, and so is the rest of every asset ' +
      'URL, so a changed asset path or a prefix that became configured is ' +
      'still a difference. Last-Modified is compared for PRESENCE, so a ' +
      'static route that stopped sending it still fails. For an archive body, ' +
      'the byte length is compared exactly and the entry-level contract - the ' +
      'archive\'s internal layout, its object key and its download url - is ' +
      'asserted by test/parity/storage.js and test/parity/worker.js, which ' +
      'open the archive instead of hashing it.',
    // `date` is NOT listed here: it has a category of its own below, and one
    // header removed by two rules would make the report ambiguous about which
    // weakening covers it.
    headers: [],
    presenceOnlyHeaders: ['last-modified'],
    cookieFields: [],
    responseFields: ['elapsedMs', 'elapsedBucket'],
    // A generated archive embeds each entry's modification time in its own
    // headers, so its content digest changes on every build while its LENGTH
    // does not - the timestamp fields are fixed-width. MEASURED: two captures
    // of the identical tree produced two digests for the same 182-byte zip and
    // the same length both times. The corpus records a binary body as a length
    // and a digest and never as bytes, so there is no archive to open here and
    // no way to compare entry names or CRCs from a recording; the length is
    // therefore compared exactly and the digest is demoted to an observation
    // for these content types only.
    binaryDigestExemptTypes: [
      'application/zip',
      'application/x-zip-compressed',
      'application/gzip',
      'application/x-gzip',
      'application/x-tar',
      'application/x-compressed'
    ],
    textPatterns: Object.freeze([
      Object.freeze({
        name: 'rendered cache-prefix epoch',
        expression: /(\/cache-prefix-)\d+/g,
        replace: function(match, literal) {
          return literal + '<timestamp>';
        }
      }),
      Object.freeze({
        name: 'run-era ISO-8601 instant',
        expression: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})/g,
        replace: function(match) {
          if (SEEDED_DATES[match]) {
            return match;
          }

          return isRunEraInstant(Date.parse(match)) ? '<timestamp>' : match;
        }
      }),
      Object.freeze({
        // The absolute date the cookie patch appends. It is "one year from
        // whenever the response was produced", so two runs minutes apart
        // differ - MEASURED across two captures of the identical tree, where
        // this was 8 of the 10 differences. Anchored on the attribute name so
        // it can only fire inside a Set-Cookie: the HORIZON is still compared
        // in whole days by the cookie comparator, which is the assertion that
        // detects the patch going silently no-op, and every other attribute of
        // the header string - including its order and spelling - is still
        // compared exactly.
        name: 'Set-Cookie Expires attribute date',
        expression: /(;\s*Expires=)[A-Za-z]{3},\s*\d{1,2}[ -][A-Za-z]{3}[ -]\d{2,4}\s+\d{2}:\d{2}:\d{2}\s*(?:GMT|UTC)/gi,
        replace: function(match, literal) {
          return literal + '<timestamp>';
        }
      }),
      Object.freeze({
        name: 'run-era epoch milliseconds',
        expression: /\b1[6-9]\d{11}\b|\b2[0-9]\d{11}\b/g,
        replace: function(match) {
          if (SEEDED_DATES[match]) {
            return match;
          }

          return isRunEraInstant(Number(match)) ? '<timestamp>' : match;
        }
      })
    ])
  }),

  Object.freeze({
    id: 'date-header',
    title: 'The Date response header',
    why: 'Node writes the current instant into every response.',
    seedingAlternative: 'None. It is generated by the HTTP layer below the ' +
      'application and is not reachable from configuration or a fixture.',
    coverageLost: 'Nothing the application decides. NOTE THE TRAP: this ' +
      'category covers `Date` ONLY. The `Expires` HEADER is a different ' +
      'thing entirely - app.js sets it to the literal "0" as one of the four ' +
      'cache headers - and it is compared EXACTLY. So is the cookie `Expires` ' +
      'attribute, through its own presence-and-horizon assertion.',
    headers: ['date'],
    presenceOnlyHeaders: [],
    cookieFields: [],
    responseFields: [],
    textPatterns: Object.freeze([])
  }),

  Object.freeze({
    id: 'etag',
    title: 'The ETag response header',
    why: 'A validator over a representation rather than part of it.',
    seedingAlternative: 'None that is worth having. The static handler derives ' +
      'it from the file it served, so it is a property of a build artifact ' +
      'across two independently installed worktrees rather than of behaviour.',
    coverageLost: 'The validator value. The body it validates is compared in ' +
      'full - length and digest for a binary response, and the normalized ' +
      'text for a textual one - so a changed representation still fails.',
    headers: ['etag'],
    presenceOnlyHeaders: [],
    cookieFields: [],
    responseFields: [],
    textPatterns: Object.freeze([])
  }),

  Object.freeze({
    id: 'request-ids',
    title: 'Per-request correlation identifiers',
    why: 'A value minted per request for tracing, unique by construction.',
    seedingAlternative: 'None; a correlation id that repeated would not be one.',
    coverageLost: 'Nothing measured. This application emits no such header at ' +
      'baseline, so the category is a declared guard rather than an active ' +
      'weakening - and it is enumerated anyway, because a header that ' +
      'appeared silently under the new framework should be normalized by a ' +
      'named rule rather than reported as a difference nobody can act on.',
    headers: [
      'x-request-id',
      'request-id',
      'x-correlation-id',
      'x-amzn-requestid',
      'x-amz-request-id',
      'x-amz-id-2'
    ],
    presenceOnlyHeaders: [],
    cookieFields: [],
    responseFields: [],
    textPatterns: Object.freeze([])
  }),

  Object.freeze({
    id: 'cookie-values',
    title: 'Cookie values, and only the values',
    why: 'A session cookie\'s value is a server-side session id, minted per ' +
      'session by design. capture.js already replaces it with its digest ' +
      'before the corpus is written, so the committed artifact carries no live ' +
      'token; the digest that replaced it is just as volatile as the value.',
    seedingAlternative: 'None, and none is wanted: maxCookieSize is 0, so ' +
      'session state lives on the server and a pinned cookie value would be a ' +
      'forged session rather than a fixture.',
    coverageLost: 'Nothing that could be compared. EVERY ATTRIBUTE IS STILL ' +
      'COMPARED EXACTLY - name, HttpOnly, Secure, SameSite, Path, Domain, ' +
      'Max-Age - and the Expires attribute is asserted for presence and for ' +
      'its one-year horizon, which is the only way a silent no-op in the ' +
      'private-field cookie patch is detectable.',
    headers: [],
    presenceOnlyHeaders: [],
    cookieFields: ['valueDigest', 'valueLength'],
    responseFields: [],
    textPatterns: Object.freeze([
      Object.freeze({
        name: 'redacted cookie value inside a Set-Cookie header',
        expression: /<redacted:sha256:[0-9a-f]+>/g,
        replace: function() {
          return '<cookie-value>';
        }
      })
    ])
  })
]);

// The number of categories is asserted rather than assumed: the agent prompt
// fixes it at six, and a seventh added without the justification the entries
// above carry would be a silent weakening. `assertVolatileSetIntegrity` runs at
// startup so the failure is loud and immediate.
var VOLATILE_CATEGORY_COUNT = 6;

// ---------------------------------------------------------------------------
// NORMALIZATION PROBES - the declared rules, exercised at startup
// ---------------------------------------------------------------------------
//
// A rule that is declared and does not fire is indistinguishable, from outside
// this file, from a rule that was never declared: both produce a difference on
// every rendered page, and a reviewer reading the artifact cannot tell which
// happened. The cache-prefix rule is the case that matters most - `addPrefix`
// [lib/util/stringUtils.js:23-33] inlines `Date.now()` into every asset URL as
// `/cache-prefix-<epoch>/` because all eight config/default.yaml:142-150
// prefixes are empty, and capture.js measured 20 of 242 read-only responses
// differing on that and on nothing else.
//
// So each probe below states an input and the exact output the declared rules
// must produce, they are RUN at startup beside the set's own integrity check,
// and their results are emitted into the artifact. Two properties are asserted
// per rule and both matter: that the volatile part IS normalized, and that
// everything around it is NOT - a rule that swallowed the rest of the URL would
// stop comparing asset paths altogether, which is the failure the narrow
// pattern exists to avoid.
// ---------------------------------------------------------------------------

var NORMALIZATION_PROBES = Object.freeze([
  Object.freeze({
    id: 'cache-prefix-epoch-normalized',
    category: 'timestamps',
    rule: 'rendered cache-prefix epoch',
    what: 'the epoch digits inside a rendered asset URL are replaced',
    input: '<script src="/cache-prefix-1735689600000/js/app.js"></script>',
    expected: '<script src="/cache-prefix-<timestamp>/js/app.js"></script>',
    mustNormalize: true
  }),
  Object.freeze({
    id: 'cache-prefix-two-renders-agree',
    category: 'timestamps',
    rule: 'rendered cache-prefix epoch',
    what: 'two renders of the same page taken at different instants compare equal',
    input: '/cache-prefix-1735689600000/css/base.css',
    expected: '/cache-prefix-<timestamp>/css/base.css',
    mustNormalize: true
  }),
  Object.freeze({
    id: 'cache-prefix-path-still-compared',
    category: 'timestamps',
    rule: 'rendered cache-prefix epoch',
    what: 'the asset path around the epoch is still compared, so a changed ' +
      'asset URL is still a difference',
    input: '/cache-prefix-1735689600000/js/moved.js',
    expected: '/cache-prefix-<timestamp>/js/moved.js',
    mustNormalize: true,
    // Normalizes to something DIFFERENT from the probe above it, which is what
    // proves the rule did not swallow the path.
    mustDifferFrom: 'cache-prefix-two-renders-agree'
  }),
  Object.freeze({
    id: 'cache-prefix-literal-still-compared',
    category: 'timestamps',
    rule: 'rendered cache-prefix epoch',
    what: 'a CONFIGURED prefix is left alone, so a prefix that became ' +
      'configured is still a difference',
    input: '/v1.2.3/js/app.js',
    expected: '/v1.2.3/js/app.js',
    mustNormalize: false
  }),
  Object.freeze({
    id: 'seeded-objectid-compared-exactly',
    category: 'generated-ids',
    rule: 'non-seeded ObjectId hex',
    what: 'an id the seeder pins is compared exactly rather than scrubbed',
    input: String((seed.ids && seed.ids.user) || ''),
    expected: String((seed.ids && seed.ids.user) || ''),
    mustNormalize: false
  }),
  Object.freeze({
    id: 'run-minted-objectid-normalized',
    category: 'generated-ids',
    rule: 'non-seeded ObjectId hex',
    what: 'an id minted during the run is normalized',
    input: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    expected: '<generated-objectid>',
    mustNormalize: true
  })
]);

// ---------------------------------------------------------------------------
// Errors and diagnostics
// ---------------------------------------------------------------------------

/**
 * A reported fault, as opposed to a programming error.
 *
 * Carried as its own type so `main` can print the message alone for one and the
 * stack for the other: a missing corpus is a message, an undefined property is
 * a stack.
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
 * A fault whose remedy is a different command line, so `main` prints the usage.
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
 * The readable reason of anything that can be thrown.
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
 * Writes one diagnostic line to stderr.
 *
 * Stderr, never stdout: a caller may capture this tool's stdout, and the human
 * report is written to a FILE so that it can be cited. Progress goes out as it
 * happens rather than in a block at the end, so a long replay is observable
 * while it runs and a stall is attributable to a case.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  process.stderr.write(LOG_PREFIX + message + '\n');
}

// ---------------------------------------------------------------------------
// Determinism helpers
// ---------------------------------------------------------------------------

/**
 * Serializes an artifact with two spaces and a trailing newline, matching every
 * sibling tool so all the artifacts in this directory diff the same way.
 *
 * @param {*} value
 * @returns {string}
 */
function serialize(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * A copy of a plain object with its keys sorted.
 *
 * Applied to every map whose key set is decided by a response rather than by
 * this file. Objects this file builds itself are left in their declared order,
 * which reads better than alphabetical and is already stable.
 *
 * @param {Object} value
 * @returns {Object}
 */
function sortedKeys(value) {
  var out = {};

  Object.keys(value || {}).sort().forEach(function(key) {
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
 * Coarse timing, in the buckets capture.js records.
 *
 * Reproduced so the observed record has the same shape as the recorded one.
 * The value is inside the timestamp category of the volatile set and is
 * therefore NOT a gate field - it is reported as a timing observation, because
 * a case that moved from under a second to over ten is worth seeing even when
 * its body matches.
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
 * A bounded excerpt of a value, for a difference record.
 *
 * @param {*} value
 * @returns {*} the value, or a truncated string form of it
 */
function excerpt(value) {
  var text;

  if (value === null || value === undefined || typeof value === 'number' ||
      typeof value === 'boolean') {
    return value === undefined ? null : value;
  }

  text = typeof value === 'string' ? value : JSON.stringify(value);

  if (text === undefined) {
    return String(value);
  }

  if (text.length <= EXCERPT_BYTES) {
    return text;
  }

  return text.slice(0, EXCERPT_BYTES) + '... [' + text.length + ' chars]';
}

/**
 * The index of the first character at which two strings diverge, or -1.
 *
 * Reported alongside a body difference so a reviewer lands on the divergence
 * instead of reading two pages side by side.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function firstDivergence(left, right) {
  var a = String(left === undefined || left === null ? '' : left);
  var b = String(right === undefined || right === null ? '' : right);
  var limit = Math.min(a.length, b.length);
  var i;

  for (i = 0; i < limit; i++) {
    if (a.charCodeAt(i) !== b.charCodeAt(i)) {
      return i;
    }
  }

  return a.length === b.length ? -1 : limit;
}

/**
 * A window of a string around an offset, for the same reason.
 *
 * @param {string} value
 * @param {number} offset
 * @returns {string}
 */
function windowAround(value, offset) {
  var text = String(value === undefined || value === null ? '' : value);
  var from = Math.max(0, offset - 60);

  return (from > 0 ? '...' : '') + text.slice(from, offset + 120) +
    (offset + 120 < text.length ? '...' : '');
}

// ---------------------------------------------------------------------------
// The normalization engine - every rule in it comes from THE VOLATILE SET
// ---------------------------------------------------------------------------

/**
 * Fails loudly if the volatile set has been changed without its contract.
 *
 * Called once at startup. The count is fixed at six by the agent prompt, and
 * each entry must carry the three justification fields, because an entry
 * without them is a weakening nobody can review.
 *
 * @returns {undefined}
 * @throws {ToolError} If the set no longer satisfies its own contract.
 */
function assertVolatileSetIntegrity() {
  var seen = Object.create(null);

  if (VOLATILE_SET.length !== VOLATILE_CATEGORY_COUNT) {
    throw new ToolError('the volatile set holds ' + VOLATILE_SET.length +
      ' categories; it is fixed at ' + VOLATILE_CATEGORY_COUNT + '. Adding ' +
      'one is a WEAKENING of the parity gate and has to be justified in ' +
      'docs/baseline-parity.md - naming the field, why seeding could not make ' +
      'it deterministic instead, and what coverage is lost - and this ' +
      'constant raised deliberately with that justification recorded.');
  }

  VOLATILE_SET.forEach(function(category) {
    if (seen[category.id]) {
      throw new ToolError('the volatile set declares the category ' +
        JSON.stringify(category.id) + ' twice');
    }

    seen[category.id] = true;

    ['title', 'why', 'seedingAlternative', 'coverageLost'].forEach(function(field) {
      if (!category[field] || typeof category[field] !== 'string') {
        throw new ToolError('the volatile set category ' +
          JSON.stringify(category.id) + ' has no ' + field + '. Every ' +
          'category carries its own justification, because the list is what a ' +
          'reviewer reads instead of the comparators.');
      }
    });
  });
}

/**
 * Runs every declared normalization probe and returns their results.
 *
 * Called once at startup, beside the set's own integrity check, and it THROWS
 * on a probe that does not hold. The reason it throws rather than reports: a
 * normalization rule that stopped firing turns every rendered page into a
 * difference and every asset-URL comparison into noise, and a rule that fires
 * too widely stops comparing the thing it sits inside. Neither is a finding
 * about the application, so neither may be reported as one - the tool is broken
 * and says so before it drives a request.
 *
 * The results are returned so `describeVolatileSet` can emit them: a reviewer
 * reading the artifact should be able to see that the cache-prefix rule fires,
 * rather than having to read this file to find out whether it exists.
 *
 * @returns {Array.<Object>} one record per probe, each with its measured output
 * @throws {ToolError} If any declared rule does not behave as declared.
 */
function assertNormalizationRules() {
  var results = [];
  var byId = Object.create(null);
  var failures = [];

  NORMALIZATION_PROBES.forEach(function(probe) {
    var outcome = normalizeText(probe.input);
    var record = {
      id: probe.id,
      category: probe.category,
      rule: probe.rule,
      what: probe.what,
      input: probe.input,
      expected: probe.expected,
      observed: outcome.value,
      rulesApplied: outcome.applied.slice(),
      normalized: outcome.value !== probe.input,
      ok: true
    };

    results.push(record);
    byId[probe.id] = record;

    if (!probe.input) {
      record.ok = false;
      failures.push(probe.id + ' has no input to probe with. Its reference ' +
        'value comes from test/parity/seed.js, so the seeder no longer ' +
        'exports what this probe was written against and the rule it covers ' +
        'is unverified.');
      return;
    }

    if (record.observed !== probe.expected) {
      record.ok = false;
      failures.push(probe.id + ': ' + probe.what + '. Normalizing ' +
        JSON.stringify(probe.input) + ' must produce ' +
        JSON.stringify(probe.expected) + ' and produced ' +
        JSON.stringify(record.observed) + '.');
      return;
    }

    if (probe.mustNormalize && !record.normalized) {
      record.ok = false;
      failures.push(probe.id + ' expected the ' + JSON.stringify(probe.rule) +
        ' rule of the ' + probe.category + ' category to fire and nothing ' +
        'changed, so this value would be compared as though it were stable.');
      return;
    }

    if (!probe.mustNormalize && record.normalized) {
      record.ok = false;
      failures.push(probe.id + ' expected no rule to fire on ' +
        JSON.stringify(probe.input) + ' and ' + record.rulesApplied.join(', ') +
        ' did, which means this value is no longer compared.');
    }
  });

  NORMALIZATION_PROBES.forEach(function(probe) {
    var mine;
    var other;

    if (!probe.mustDifferFrom) {
      return;
    }

    mine = byId[probe.id];
    other = byId[probe.mustDifferFrom];

    if (!other) {
      mine.ok = false;
      failures.push(probe.id + ' compares itself against the probe ' +
        JSON.stringify(probe.mustDifferFrom) + ', which is not declared');
      return;
    }

    if (mine.observed === other.observed) {
      mine.ok = false;
      failures.push(probe.id + ': ' + probe.what + '. It normalized to the ' +
        'same value as ' + probe.mustDifferFrom + ' (' +
        JSON.stringify(mine.observed) + '), so the rule is swallowing more ' +
        'than the volatile part and the surrounding value is no longer ' +
        'compared.');
    }
  });

  if (failures.length) {
    throw new ToolError('the normalization rules do not behave as the ' +
      'volatile set declares, so no comparison this tool made would mean ' +
      'anything:\n  - ' + failures.join('\n  - '));
  }

  return results;
}

/**
 * The comparison contract for binary and stream bodies, as it is APPLIED.
 *
 * Emitted into the result and rendered into the report because the two halves
 * of it are not the same, and a document that states only the first half
 * overstates the gate. The length is compared exactly for every binary body.
 * The digest is compared exactly for every binary body EXCEPT the enumerated
 * archive container types, where it is recorded as an observation: those
 * containers embed each entry's modification time in their own headers, so the
 * digest is a clock read while the length - the timestamp fields being
 * fixed-width - is not. Measured: two captures of the identical tree produced
 * two digests for the same 182-byte zip.
 *
 * The exemption is not a hole left open. It is bounded by the enumerated list,
 * it comes from the timestamps category of the volatile set and from nowhere
 * else, and the entry-level contract those archives carry - the internal
 * layout, the object key, the download url - is asserted by
 * test/parity/storage.js and test/parity/worker.js, which open the archive
 * rather than hashing it.
 *
 * @returns {Object}
 */
function describeBinaryBodyContract() {
  return {
    lengthCompared: 'every binary or stream body, exactly',
    digestCompared: 'every binary or stream body except the enumerated ' +
      'archive container types, exactly',
    digestObservationOnly: ARCHIVE_DIGEST_EXEMPT.slice(),
    digestObservationOnlyReason: 'these containers embed each entry\'s ' +
      'modification time, so the content digest is a clock read while the ' +
      'byte length is not - the timestamp fields are fixed-width. Measured: ' +
      'two captures of the identical tree produced two digests for the same ' +
      '182-byte zip and the same length both times. The corpus records a ' +
      'binary body as a length and a digest and never as bytes, so there is ' +
      'no archive to open from a recording.',
    digestObservationOnlyDeclaredBy: 'the timestamps category of the volatile set',
    entryLevelAssertedBy: Object.freeze([
      'test/parity/storage.js',
      'test/parity/worker.js'
    ]),
    coverageLost: 'For those six content types only: that two archives with ' +
      'the same byte length hold the same bytes. A changed entry name, a ' +
      'changed entry body or a changed layout is caught by the storage and ' +
      'worker harnesses, which open the archive; a changed length is caught ' +
      'here. For every other binary type - images, PDFs, streamed files - ' +
      'both the length and the digest are compared exactly and a single ' +
      'changed byte fails.'
  };
}

/**
 * Collects one field across every category of the volatile set.
 *
 * The single accessor every derived list below goes through, so that a rule can
 * only take effect by being declared in the set.
 *
 * @param {string} field
 * @returns {Array.<*>}
 */
function volatileField(field) {
  var out = [];

  VOLATILE_SET.forEach(function(category) {
    (category[field] || []).forEach(function(value) {
      if (out.indexOf(value) === -1) {
        out.push(value);
      }
    });
  });

  return out;
}

/**
 * Which category declares a given header, for the report.
 *
 * @param {string} name a lowercased header name
 * @returns {(string|null)} the category id
 */
function categoryForHeader(name) {
  var found = null;

  VOLATILE_SET.forEach(function(category) {
    if (found) {
      return;
    }

    if ((category.headers || []).indexOf(name) >= 0 ||
        (category.presenceOnlyHeaders || []).indexOf(name) >= 0) {
      found = category.id;
    }
  });

  return found;
}

// Derived once, at load, so the comparators cannot drift from the set and so
// the lists appear in the result document exactly as they are applied.
var VOLATILE_HEADERS        = Object.freeze(volatileField('headers'));
var ARCHIVE_DIGEST_EXEMPT   = Object.freeze(volatileField('binaryDigestExemptTypes'));
var PRESENCE_ONLY_HEADERS   = Object.freeze(volatileField('presenceOnlyHeaders'));
var VOLATILE_COOKIE_FIELDS  = Object.freeze(volatileField('cookieFields'));
var VOLATILE_RESPONSE_FIELDS = Object.freeze(volatileField('responseFields'));

/**
 * Applies every text pattern in the volatile set, in declaration order.
 *
 * The one text normalizer in this file. Every comparator that touches a string
 * - Location, a header value, rendered HTML, a JSON scalar - routes through
 * here, so what is normalized is exactly what the set declares and nothing
 * else. It also reports WHETHER it changed anything, which is what lets the
 * comparators keep `content-length` and the recorded body digest as exact
 * fields whenever no normalization was needed.
 *
 * @param {*} value
 * @returns {Object} {value, applied: Array.<string>}
 */
function normalizeText(value) {
  var text;
  var applied = [];

  if (typeof value !== 'string') {
    return { value: value, applied: applied };
  }

  text = value;

  VOLATILE_SET.forEach(function(category) {
    (category.textPatterns || []).forEach(function(pattern) {
      var before = text;

      // The expressions are declared global; `replace` on a global expression
      // does not depend on lastIndex, so the shared literal is safe here. It is
      // never used with `test` or `exec`, which would.
      text = text.replace(pattern.expression, pattern.replace);

      if (text !== before) {
        applied.push(category.id + ':' + pattern.name);
      }
    });
  });

  return { value: text, applied: applied };
}

/**
 * The normalized form of a string, discarding the applied list.
 *
 * @param {*} value
 * @returns {*}
 */
function normalized(value) {
  return normalizeText(value).value;
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

var PASS_NON_SECURE = 'non-secure';
var PASS_SECURE     = 'secure';
var PASS_BOTH       = 'both';

var USAGE = [
  'Usage: node test/parity/replay.js [options]',
  '',
  'Replays the committed baseline corpus against the application in the',
  'worktree given by --app and compares every recorded response field by',
  'field. Exits 0 only when every scenario matched, every route in the route',
  'manifest was represented, and every scenario could be driven.',
  '',
  'Options:',
  '  --app <dir>            Worktree under test; the application runs there as',
  '                         a child process. Defaults to the current directory.',
  '  --corpus <path>        Baseline corpus. Default ' + DEFAULT_CORPUS + '.',
  '                         Its provenance sidecar <corpus>' + PROVENANCE_SUFFIX,
  '                         is REQUIRED and is validated before anything is',
  '                         driven: a corpus that does not say which tree it',
  '                         recorded cannot be a baseline, and one captured',
  '                         from the tree under test would compare cleanly',
  '                         against it and prove nothing.',
  '  --annotations <path>   Join `expectedDeviation` and `unreachableReason`',
  '                         back on by scenario id. A CAPTURED corpus does not',
  '                         carry them - capture.js\'s scenario builder emits',
  '                         neither - so a replay of one needs this to tell an',
  '                         approved change from a regression. There is no',
  '                         default: a marker has to be asked for by name.',
  '  --secure-corpus <path> Baseline corpus for the secure cookie pass, with',
  '                         its own provenance sidecar. With one, that pass',
  '                         compares exactly; without one it asserts the',
  '                         documented differential DERIVED from the',
  '                         non-secure pass, says so in both artifacts, and',
  '                         the run is not gate-qualifying - the secure cookie',
  '                         contract has to be measured, not computed.',
  '  --manifest <path>      Route manifest for the coverage gate. Read from',
  '                         ' + COMMITTED_MANIFEST,
  '                         when it is there; otherwise generated by spawning',
  '                         manifest.js into ' + ARTIFACT_DIR_ENV + ' or a fresh',
  '                         temporary directory - never into the worktree',
  '                         unless this flag named a path inside it.',
  '  --out <path>           Machine-readable result. REQUIRED unless',
  '                         ' + ARTIFACT_DIR_ENV + ' names a directory, in which',
  '                         case it is <dir>/' + ARTIFACT_NAMES.result + '.',
  '                         There is no repository default, so no run leaves',
  '                         artifacts in tracked source unless it was asked to.',
  '                         Provenance is written to <path>.provenance.json.',
  '  --report <path>        Human report. Same rule as --out; from',
  '                         ' + ARTIFACT_DIR_ENV + ' it is',
  '                         <dir>/' + ARTIFACT_NAMES.report + '.',
  '  --only <pattern>       Replay a subset. Repeatable. A value wrapped in',
  '                         slashes is a regular expression, anything else a',
  '                         case-insensitive substring, matched against the',
  '                         scenario id, its group and its route key. A',
  '                         narrowed run is a DIAGNOSTIC: it is labelled',
  '                         gateQualifying: false and cannot stand as the gate.',
  '  --pass <which>         ' + PASS_BOTH + ' (default), ' + PASS_NON_SECURE +
    ', or ' + PASS_SECURE + '.',
  '                         Anything other than ' + PASS_BOTH + ' is also a',
  '                         narrowed run.',
  '  --timeout <ms>         Per-request budget for a step that recorded none.',
  '                         Default ' + DEFAULT_TIMEOUT_MS + '.',
  '  --overlay [path]       NODE_CONFIG overlay for the launcher. Defaults to',
  '                         test/parity/server-overlay.json.',
  '  --no-overlay           Start with no overlay file. Note that the test',
  '                         configuration sets app.start false, so this',
  '                         normally produces no listening socket.',
  '  --host <host>          Bind host, and app.url.hostname with it.',
  '  --port <n>             Bind port, and app.url.port with it. Absolute',
  '                         Location headers embed the port, so a corpus is',
  '                         only comparable against the port it was captured',
  '                         on.',
  '  --database <name>      Pin the MongoDB database name.',
  '  --mongo-uri <uri>      Use an already-running mongod at this address.',
  '  --no-mongo             Provision nothing; the inherited NODE_CONFIG or',
  '                         --config must carry the address.',
  '  --provision-mongo      Always provision, even when one was inherited.',
  '  --run-dir <dir>        Per-run directory for the launcher. A fresh',
  '                         directory under the system temp by default.',
  '  --node-flags <flags>   Node flags for the application child. Repeatable,',
  '                         and one value may be space-separated:',
  '                         --node-flags "--pending-deprecation --trace-deprecation".',
  '                         Those two are added whether or not you pass them:',
  '                         AAP 0.9.3 measures the zero-warning gate under',
  '                         them, and a pending deprecation is silent without',
  '                         them. A suppressor you pass deliberately',
  '                         (--no-warnings, --no-deprecation) is reported and',
  '                         FAILS the warning check rather than being honoured',
  '                         quietly.',
  '  --worker-evidence <p>  The artifact test/parity/worker.js wrote (its',
  '                         --out). AAP 0.9.3 measures the warning gate over',
  '                         the server, the full route surface AND the worker;',
  '                         this tool cannot drive the worker, so without this',
  '                         the run is labelled gateQualifying: false.',
  '  --ready-timeout <ms>   Readiness budget. Default ' + DEFAULT_READY_TIMEOUT_MS + '.',
  '  --config <json>        An explicit top NODE_CONFIG layer for the child.',
  '  --baseline-head <sha>  The commit the corpus is expected to have been',
  '                         captured from. Defaults to the R-f baseline',
  '                         reference ' + BASELINE_COMMIT.slice(0, 7) +
    ' (AAP §0.10.3). `any` declines',
  '                         the check. Ignored under --self-check, where the',
  '                         corpus comes from the tree under test by',
  '                         declaration.',
  '  --self-check           Declare that --app names the very tree the corpus',
  '                         was captured from. STRICTER, not weaker: every',
  '                         difference fails, and an approved deviation that',
  '                         materializes fails too, because against that tree',
  '                         it must not. This is the self-consistency rehearsal',
  '                         - a corpus that does not replay cleanly against its',
  '                         own tree is nondeterministic, and the fix is the',
  '                         seeding, never the comparison.',
  '  --allow-unreviewed-corpus',
  '                         Replay a corpus whose provenance does not establish',
  '                         a capture of the base commit - one captured with',
  '                         capture.js --allow-nonbaseline, or from the',
  '                         migrated tree. NOT a way past a corrupt block: the',
  '                         schema, the artifact name, a named generator and',
  '                         the payload digest are still required, and so is',
  '                         any sidecar beside the artifact agreeing with it.',
  '                         It is also the ONLY mode that tolerates a generator',
  '                         this repository does not contain, and only when the',
  '                         block itself says the source was uncommitted: those',
  '                         checks are then recorded as WAIVED, with their',
  '                         reason, rather than as passed. The run is labelled',
  '                         gateQualifying: false, because a comparison against',
  '                         a reference nobody has tied to the base commit, or',
  '                         produced by a generator nobody can retrieve, is a',
  '                         diagnostic.',
  '  --print-report         Also write the full report to stdout.',
  '  -h, --help             Print this on stderr and exit 0.',
  '',
  'There is deliberately no --force, no threshold and no pass-with-warnings',
  'mode. A difference is a failure unless the scenario carries an approved',
  'deviation marker, and the exit code is the whole verdict.',
  '',
  'A GATE-QUALIFYING run is one AAP §0.9.3 would accept as the parity gate,',
  'and it needs all ten of: the whole corpus (no --only); both cookie passes;',
  'a secure baseline whose provenance ATTESTS a secure capture, rather than a',
  'derived differential; --node-flags carrying ' + REQUIRED_NODE_FLAGS.join(' and ') + ';',
  'warning evidence from every pass; a route manifest that IS the registered',
  'surface, key for key in both directions; a real baseline rather than',
  '--self-check; a corpus authenticated by digest as ' + CAPTURE_GENERATOR + "'s",
  'recording of the frozen R-f baseline ' + BASELINE_COMMIT.slice(0, 7) + '; a known commit for the',
  'tree under test; and all ' + AUTH_OUTCOME_IDS.length + ' auth-scheme outcomes DRIVEN, not explained by a',
  'stated reason. Every requirement is reported by name in both artifacts, met',
  'or unmet. A run that misses one still compares, still fails on a difference',
  'and can still exit 0 - it simply may not be cited as the gate.',
  '',
  'Option rules: only --only and --node-flags may be repeated; any other option',
  'given twice is a usage error rather than a last-one-wins. A value beginning',
  'with "-" is a usage error too, so a missing value cannot swallow the next',
  'option; write --flag=-value when a value really begins with a dash, and note',
  'that --node-flags takes dash-leading values by design.',
  '',
  'Exit codes: ' + EXIT_OK + ' every comparison matched; ' + EXIT_DIFFERENCE +
    ' a difference, an unrepresented route or an',
  'undriven scenario; ' + EXIT_ERROR + ' the replay could not be performed at all.',
  '',
  'Examples:',
  '  node test/parity/replay.js --app . --port 3010',
  '  node test/parity/replay.js --app . --annotations test/parity/corpus.json',
  '  node test/parity/replay.js --app . --only /quirk\\./ --pass non-secure',
  '',
  'Every diagnostic goes to stderr. Both artifacts go to files.'
].join('\n');

/**
 * The option defaults, as a fresh object.
 *
 * Returned rather than shared, for the reason ./server's own defaults are: a
 * shared object would accumulate one caller's choices into the next caller's
 * baseline.
 *
 * @returns {Object}
 */
function defaultOptions() {
  return {
    appRoot        : process.cwd(),
    corpus         : DEFAULT_CORPUS,
    annotations    : null,
    secureCorpus   : null,
    manifestPath   : COMMITTED_MANIFEST,
    manifestExplicit: false,
    // Null rather than a repository path: `replay` resolves these through
    // resolveArtifactPath, which requires the flag or ARTIFACT_DIR_ENV.
    out            : null,
    report         : null,
    only           : [],
    pass           : PASS_BOTH,
    timeoutMs      : DEFAULT_TIMEOUT_MS,
    // `undefined` means "the launcher's own default"; null means --no-overlay.
    overlay        : undefined,
    host           : null,
    port           : null,
    database       : null,
    mongoUri       : null,
    provisionMongo : undefined,
    runDir         : null,
    nodeFlags      : [],
    // The worker's own warning evidence. AAP §0.9.3 measures the zero-warning
    // gate over the listening server, the full route surface AND the standalone
    // worker; this file can drive the first two and cannot drive the third, so
    // the worker's artifact is read rather than re-measured. Absent, the run
    // still replays and still reports - it simply cannot QUALIFY as the gate,
    // because a third of the required exercise would be unaccounted.
    workerEvidence : null,
    readyTimeoutMs : DEFAULT_READY_TIMEOUT_MS,
    config         : null,
    selfCheck      : false,
    // The one way past the corpus provenance requirement, and it costs the
    // gate: a run that takes it is a diagnostic and is labelled as one.
    allowUnreviewedCorpus: false,
    // null means "the R-f baseline reference"; a sha names another baseline
    // deliberately, and 'any' declines the check.
    baselineHead   : null,
    printReport    : false,
    help           : false
  };
}

/**
 * Parses `--flag value` and `--flag=value` into the shape `replay` accepts.
 *
 * Exported so its failure modes are testable without spawning anything, and
 * deliberately the same shape a programmatic caller passes.
 *
 * @param {Array.<string>} argv Arguments after `node script`.
 * @returns {Object} Options for `replay`.
 * @throws {ToolError} On an unknown flag, a missing value or a bad number.
 */
function parseArguments(argv) {
  var options = defaultOptions();
  var index = 0;
  var seen = {};
  var token;
  var eq;
  var name;
  var inlineValue;
  var hasInline;

  // Reads the value for `flag`, from `--flag=value` when one was attached and
  // from the next token otherwise.
  //
  // A DASH-LEADING NEXT TOKEN IS A USAGE ERROR, not a value. `--corpus --out x`
  // used to consume `--out` as the corpus path and then treat `x` as an unknown
  // option - or worse, silently replay a file named "--out". The `=` form is
  // the escape hatch for a value that genuinely begins with a dash, and
  // `allowDashes` is the declared exception for --node-flags, whose whole
  // purpose is to carry `--pending-deprecation` into the child.
  function next(flag, allowDashes) {
    var value;

    if (hasInline) {
      return inlineValue;
    }

    index++;

    if (index >= argv.length) {
      throw usageError(flag + ' requires a value');
    }

    value = String(argv[index]);

    if (!allowDashes && value.charAt(0) === '-' && value !== '-') {
      throw usageError(flag + ' requires a value, and ' +
        JSON.stringify(value) + ' is an option. Write ' + flag + '=' +
        JSON.stringify(value) + ' if the value really begins with a dash.');
    }

    return value;
  }

  // A REPEATED OPTION IS A USAGE ERROR. Two `--corpus` paths or two `--pass`
  // selections mean the command line says two things, and quietly acting on the
  // last one produces a run that is not the run that was asked for - reported
  // under a name that claims it was. The two exceptions accumulate by design.
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

  for (; index < argv.length; index++) {
    token = String(argv[index]);
    eq = token.indexOf('=');
    hasInline = token.slice(0, 2) === '--' && eq > 2;
    name = hasInline ? token.slice(0, eq) : token;
    inlineValue = hasInline ? token.slice(eq + 1) : null;

    once(name);

    switch (name) {
      case '--app':
        options.appRoot = next(name);
        break;
      case '--corpus':
        options.corpus = next(name);
        break;
      case '--annotations':
        options.annotations = next(name);
        break;
      case '--secure-corpus':
        options.secureCorpus = next(name);
        break;
      case '--manifest':
        options.manifestPath = next(name);
        options.manifestExplicit = true;
        break;
      case '--out':
        options.out = next(name);
        break;
      case '--report':
        options.report = next(name);
        break;
      case '--only':
        options.only.push(next(name));
        break;
      case '--pass':
        options.pass = parsePass(next(name));
        break;
      case '--timeout':
        options.timeoutMs = parsePositiveInteger(next(name), name);
        break;
      case '--overlay':
        // The one flag whose value is optional, matching ./server and ./mongo
        // so the three read the same way on a command line.
        if (hasInline) {
          options.overlay = inlineValue;
        }
        else if (index + 1 < argv.length && String(argv[index + 1]).slice(0, 1) !== '-') {
          index++;
          options.overlay = argv[index];
        }
        else {
          options.overlay = mongo.DEFAULT_OVERLAY;
        }
        break;
      case '--no-overlay':
        options.overlay = null;
        break;
      case '--host':
        options.host = next(name);
        break;
      case '--port':
        options.port = parsePositiveInteger(next(name), name);
        break;
      case '--database':
        options.database = next(name);
        break;
      case '--mongo-uri':
        options.mongoUri = next(name);
        break;
      case '--no-mongo':
        options.provisionMongo = false;
        break;
      case '--provision-mongo':
        options.provisionMongo = true;
        break;
      case '--run-dir':
        options.runDir = next(name);
        break;
      case '--node-flags':
        // The one option whose values legitimately begin with a dash.
        options.nodeFlags.push(next(name, true));
        break;
      case '--worker-evidence':
        options.workerEvidence = next(name);
        break;
      case '--ready-timeout':
        options.readyTimeoutMs = parsePositiveInteger(next(name), name);
        break;
      case '--config':
        options.config = parseConfigLayer(next(name));
        break;
      case '--self-check':
        options.selfCheck = true;
        break;
      case '--allow-unreviewed-corpus':
        options.allowUnreviewedCorpus = true;
        break;

      case '--baseline-head':
        options.baselineHead = parseBaselineHead(next(name));
        break;
      case '--print-report':
        options.printReport = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
      default:
        throw usageError('unknown option ' + JSON.stringify(token));
    }
  }

  return options;
}

/**
 * Validates a --baseline-head value.
 *
 * `any` is accepted and means the check is declined, which is deliberately a
 * word rather than a flag: declining to verify which tree a corpus recorded is
 * a decision worth spelling out in the command a reviewer reads.
 *
 * @param {string} value
 * @returns {string}
 * @throws {ToolError}
 */
function parseBaselineHead(value) {
  var text = String(value).trim();

  if (text.toLowerCase() === 'any') {
    return 'any';
  }

  if (!/^[0-9a-f]{7,40}$/i.test(text)) {
    throw usageError('--baseline-head takes a git commit sha (7 to 40 hex ' +
      'characters) or the word `any`; got ' + JSON.stringify(String(value)));
  }

  return text.toLowerCase();
}

/**
 * Validates a --pass value.
 *
 * @param {string} value
 * @returns {string}
 * @throws {ToolError}
 */
function parsePass(value) {
  var normalizedValue = String(value).toLowerCase();

  if ([PASS_BOTH, PASS_NON_SECURE, PASS_SECURE].indexOf(normalizedValue) === -1) {
    throw usageError('--pass takes ' + PASS_BOTH + ', ' + PASS_NON_SECURE +
      ' or ' + PASS_SECURE + '; got ' + JSON.stringify(String(value)));
  }

  return normalizedValue;
}

/**
 * Parses a positive integer flag.
 *
 * @param {string} value
 * @param {string} flag
 * @returns {number}
 * @throws {ToolError}
 */
function parsePositiveInteger(value, flag) {
  var parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw usageError(flag + ' takes a positive integer; got ' +
      JSON.stringify(String(value)));
  }

  return parsed;
}

/**
 * Parses the --config JSON layer.
 *
 * @param {string} value
 * @returns {Object}
 * @throws {ToolError}
 */
function parseConfigLayer(value) {
  var parsed;

  try {
    parsed = JSON.parse(value);
  }
  catch (err) {
    throw usageError('--config is not valid JSON: ' + reasonOf(err));
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw usageError('--config must be a JSON object');
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Reading the corpus
// ---------------------------------------------------------------------------

/**
 * What a corpus supplying the recorded baseline has to prove.
 *
 * `baseline` is the only role that qualifies, because that is the claim the
 * comparison rests on: a corpus captured from the migrated tree, or from a
 * tree nobody identified, cannot be the reference the migrated tree is
 * measured against. The escape relaxes the role, the analysed-tree
 * requirement and - only when the block itself says so - the requirement that
 * the generator be committed. It is named in the refusal, and a run that takes
 * it is labelled gateQualifying: false.
 *
 * `allowUncommittedGenerator` is the ONLY route to the identity waiver in this
 * file. It used to be on by default at the single call site, which made the
 * escape redundant and the gate unsound: a corpus naming a generator blob that
 * is no object in this repository, no generator commit and a delivered head
 * nobody can resolve was accepted as verified the moment its payload digest
 * recomputed. The waiver now travels with the flag that already labels the run
 * a diagnostic, so a gate run cannot reach it.
 *
 * @param {Object} options
 * @returns {Object} the expectation readCorpus takes
 */
function baselineExpectation(options) {
  if (options.allowUnreviewedCorpus) {
    return {
      roles: manifest.provenance.ROLES,
      requireBaselineTree: false,
      allowUncommittedGenerator: true
    };
  }

  return {
    roles: ['baseline'],
    requireBaselineTree: true,
    escape: '--allow-unreviewed-corpus'
  };
}

/**
 * The artifact's payload - everything except its own provenance block.
 *
 * This is what `payloadDigest` covers, so recomputing it here is what detects
 * a block that was copied in from another run: the digest travels with the
 * facts it describes and cannot be transplanted onto different bytes.
 *
 * @param {Object} parsed
 * @returns {Object}
 */
function provenancePayload(parsed) {
  var payload = {};

  Object.keys(parsed).forEach(function(key) {
    if (key !== 'provenance') {
      payload[key] = parsed[key];
    }
  });

  return payload;
}

/**
 * Verifies an artifact's provenance before this tool consumes it.
 *
 * The gap this closes: replay used to accept ANY JSON carrying a `scenarios`
 * array as the baseline corpus, and any file at the manifest path as the route
 * surface. Nothing checked which tree either was measured on, which tool
 * produced it, or whether its recorded provenance belonged to those very bytes
 * - so a corpus captured from the migrated tree, or from a sibling clone at
 * some other commit, replayed as though it were the baseline and every
 * comparison in the result was against the wrong reference.
 *
 * Every requirement is passed to the shared contract rather than re-derived
 * here, and a failure names each unmet requirement: a refusal a reader cannot
 * act on gets worked around instead of fixed.
 *
 * WHAT A GATE CONSUMER MAY NOT WAIVE. This function used to pass
 * `allowUncommitted: true` unconditionally, because when it was written the
 * generators themselves were not yet committed and the mode kept the tool
 * usable mid-change. Once they were committed that default became the hole it
 * had been standing in for: a corpus carrying a random generator blob that
 * resolves to nothing in this repository, `commit: null`, `verified: false`
 * and a random delivered head passed every check and was reported as
 * "provenance verified" as soon as its payload digest recomputed - which it
 * does, because a fabricated artifact hashes to whatever it says it hashes to.
 * Identity is the one thing a payload digest cannot establish, so it is now
 * required here: the generator blob and the delivered head must resolve as
 * objects in this repository, and `requireGeneratorVerified` demands that the
 * recorded commit be verified to hold the generator as it ran.
 *
 * The waiver survives only where it cannot decide a gate: `expect
 * .allowUncommittedGenerator`, which `baselineExpectation` sets from
 * `--allow-unreviewed-corpus` alone - a flag that already labels the whole run
 * `gateQualifying: false`. Under it the resolution checks are recorded as
 * WAIVED with their reason rather than as passed, and only when the block
 * itself says `commitState: uncommitted-source`; a block that claims a
 * committed generator is held to that claim either way.
 *
 * The sidecar is reconciled here too, when one sits beside the artifact. Its
 * whole contribution is a digest of the exact bytes written and it was being
 * written and never read, so a stale sidecar - or one carried over from a
 * different file - looked exactly like a fresh one.
 *
 * @param {(Object|null)} block from provenance.extract
 * @param {Object} parsed the parsed artifact
 * @param {string} target its path
 * @param {string} label what it is, for the message
 * @param {Object} expect roles, requireBaselineTree, allowUncommittedGenerator
 *   and the escape's name
 * @returns {Object} the validation verdict
 * @throws {ToolError} When a requirement is not met.
 */
function validateArtifactProvenance(block, parsed, target, label, expect) {
  // Absent for most artifacts, because it is a run output; present and
  // disagreeing is a finding, and that is what is checked.
  var beside = sidecarBeside(target, label);
  var diagnostic = !!expect.allowUncommittedGenerator;
  var verdict = manifest.provenance.validate(block, {
    artifact           : target,
    roles              : expect.roles,
    requireBaselineTree: !!expect.requireBaselineTree,
    // The generator's recorded commit must be VERIFIED to contain the source
    // that ran. `verified: false` is legitimate mid-change and is exactly what
    // a gate must not consume, so it is required unless the diagnostic escape
    // was taken.
    requireGeneratorVerified: !diagnostic,
    payload            : provenancePayload(parsed),
    // The tool's own repository is where every recorded object has to resolve:
    // the generator blob, the generator commit, the analysed head and the
    // delivered head. An identity that resolves nowhere is unfalsifiable, and
    // an unfalsifiable claim is not evidence.
    repositoryRoot     : TOOL_ROOT,
    // Never a default. See the note above: this is reachable only from
    // --allow-unreviewed-corpus, and it records the resolution checks as
    // waived rather than passed.
    allowUncommitted   : diagnostic,
    // Both halves, or the contract runs no sidecar check: the sidecar's digest
    // is compared against the artifact's own bytes, and its payload digest
    // against the embedded block's.
    sidecar            : beside ? beside.sidecar : undefined,
    artifactText       : beside ? beside.artifactText : undefined
  });

  if (!verdict.ok) {
    throw new ToolError('the ' + label + ' ' + target + ' does not carry ' +
      'provenance this replay can rely on, so it is not evidence about a ' +
      'known tree:\n  - ' + verdict.failures.join('\n  - ') +
      // The remedy names the tool that produces THIS artifact. A refusal that
      // tells the reader to re-capture a corpus when what failed was the route
      // manifest is a refusal that gets worked around.
      '\n' + (expect.regenerate || 'Re-capture it with `node ' +
        'test/parity/capture.js --app <worktree at ' +
        manifest.provenance.BASELINE_HEAD.slice(0, 7) +
        '> --expect-baseline`') + ', from a worktree whose generators are ' +
      'committed - an object this repository does not contain cannot be ' +
      'retrieved from it, whatever the artifact says about it' +
      (expect.escape
        ? '. Or pass ' + expect.escape + ' to replay it as a DIAGNOSTIC, ' +
          'which is labelled gateQualifying: false, cannot stand as the gate, ' +
          'and is the only mode that tolerates an uncommitted generator.'
        : '.'));
  }

  if (beside) {
    note(label + ': the provenance sidecar ' + beside.path + ' agrees with ' +
      'the artifact beside it');
  }

  return verdict;
}

/**
 * The provenance sidecar written beside an artifact, when there is one.
 *
 * `<artifact>.provenance.json` is a RUN OUTPUT: capture.js and this file both
 * write one, no delivery commits one, and most artifacts a consumer is handed
 * therefore have none. So absence is an answer rather than a failure - what is
 * not permitted is a sidecar that exists and does not describe the bytes it
 * sits beside, which is either a stale file left from an earlier run or one
 * copied in from a different artifact. Both were invisible before, because
 * nothing ever read one.
 *
 * A sidecar that cannot be parsed is fatal rather than ignored, for the same
 * reason: silently skipping an unreadable one turns "the pair disagrees" into
 * "there is no pair", which is the shape of the hole this closes.
 *
 * @param {string} target the artifact's path
 * @param {string} label what the artifact is, for the message
 * @returns {(Object|null)} {path, sidecar, artifactText}, or null when absent
 * @throws {ToolError} If a present sidecar cannot be read or parsed.
 */
function sidecarBeside(target, label) {
  var sidecarPath = target + '.provenance.json';
  var text;
  var parsed;
  var artifactText;

  try {
    text = fs.readFileSync(sidecarPath, 'utf8');
  }
  catch (err) {
    if (err && err.code === 'ENOENT') {
      return null;
    }

    throw new ToolError('the ' + label + ' ' + target + ' has a provenance ' +
      'sidecar at ' + sidecarPath + ' that cannot be read: ' + reasonOf(err) +
      '. A sidecar that cannot be reconciled with its artifact is not ' +
      'skippable evidence; repair or remove it.');
  }

  try {
    parsed = JSON.parse(text);
  }
  catch (err) {
    throw new ToolError('the provenance sidecar ' + sidecarPath + ' beside ' +
      'the ' + label + ' ' + target + ' is not valid JSON: ' + reasonOf(err) +
      '. Re-generate the pair, or remove the sidecar - it is a run output and ' +
      'the artifact carries the same block embedded.');
  }

  try {
    artifactText = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot re-read the ' + label + ' ' + target +
      ' to reconcile it with its provenance sidecar: ' + reasonOf(err));
  }

  return { path: sidecarPath, sidecar: parsed, artifactText: artifactText };
}

/**
 * Reads a corpus artifact and verifies it says which tree it measured.
 *
 * Two checks, in this order: the shape, so a file that is not a corpus at all
 * is reported as that; then the provenance, which is what makes the artifact
 * evidence rather than a plausible JSON document.
 *
 * `expect` is how a caller says what it is consuming the corpus FOR, because
 * the requirements genuinely differ. A corpus supplying the recorded baseline
 * must have been measured on the base commit by a known tool. An annotations
 * corpus supplies authored markers and no measurement at all, so a block is
 * verified when it carries one and its absence is reported rather than fatal -
 * the committed definitions corpus is hand-authored and no generator produced
 * it.
 *
 * @param {string} target
 * @param {string} label what this corpus is, for the message
 * @param {(Object|undefined)} expect {roles, requireBaselineTree, optional,
 *   escape}
 * @returns {Object} the parsed corpus, unmodified
 * @throws {ToolError} If it cannot be read, parsed, recognized or verified.
 */
function readCorpus(target, label, expect) {
  var artifact = readCorpusFile(target, label);

  verifyCorpusBlock(artifact, label, expect);

  return artifact.parsed;
}

/**
 * Verifies the provenance BLOCK a corpus carries about itself.
 *
 * Separate from the sidecar check below, and neither replaces the other: the
 * block travels inside the artifact and is what makes a transplanted record
 * detectable, because the payload digest is recomputed over the artifact's own
 * bytes; the sidecar is a second, external record of the same capture. An
 * artifact that carries a block naming a generator nobody can resolve is not
 * evidence, whatever its sidecar says.
 *
 * @param {Object} artifact as readCorpusFile returns
 * @param {string} label what this corpus is, for the message
 * @param {(Object|undefined)} expect {roles, requireBaselineTree, optional,
 *   escape}
 * @returns {(Object|null)} the verdict, or null when an optional block is absent
 * @throws {ToolError} If the block is missing, contradicted or unverifiable.
 */
function verifyCorpusBlock(artifact, label, expect) {
  var wanted = expect || {};
  var block = manifest.provenance.extract(artifact.text);
  var verdict;
  var waived;

  if (block === null && wanted.optional) {
    note('the ' + label + ' ' + artifact.path + ' carries no provenance ' +
      'block. It supplies authored markers rather than measurements, so this ' +
      'is reported and not fatal - but nothing establishes which tree those ' +
      'markers were written against.');

    return null;
  }

  verdict = validateArtifactProvenance(block, artifact.parsed, artifact.path,
    label, wanted);
  // Named rather than counted silently: under the diagnostic escape some
  // repository-resolution checks are recorded as waived, and a line that says
  // "provenance verified" while an identity check was waived is exactly the
  // report that let a fabricated corpus read as evidence.
  waived = verdict.checks.filter(function(entry) { return entry.waived; });

  note(label + ': provenance verified - role ' + block.role +
    ', analysed tree ' + ((block.analysedTree && block.analysedTree.headShort) ||
      'not recorded') + ', generator ' + block.generator.path + ' blob ' +
    String(block.generator.blob).slice(0, 12) + ', payload digest recomputed' +
    (waived.length
      ? ' - but ' + waived.length + ' identity check(s) WAIVED (' +
        waived.map(function(entry) { return entry.name; }).join(', ') +
        '), so this corpus is a DIAGNOSTIC reference and not baseline evidence'
      : ''));

  return verdict;
}

/**
 * Reads a corpus and keeps its bytes, so the artifact can be digested.
 *
 * The digest is what ties a run to the exact artifact it compared against. It
 * is computed over the raw bytes rather than over a re-serialization, because a
 * re-serialization is a different byte string and would not match a digest
 * anybody else computed.
 *
 * @param {string} target
 * @param {string} label
 * @returns {Object} {path, text, digest, parsed}
 * @throws {ToolError} If it cannot be read, parsed or recognized.
 */
function readCorpusFile(target, label) {
  var text;
  var parsed;

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    throw new ToolError('cannot read the ' + label + ' ' + target + ': ' +
      reasonOf(err));
  }

  try {
    parsed = JSON.parse(text);
  }
  catch (err) {
    throw new ToolError('the ' + label + ' ' + target +
      ' is not valid JSON: ' + reasonOf(err));
  }

  if (!parsed || !Array.isArray(parsed.scenarios)) {
    throw new ToolError('the ' + label + ' ' + target +
      ' has no `scenarios` array, so it is not a corpus');
  }

  return {
    path: target,
    text: text,
    digest: sha256Hex(text),
    parsed: parsed
  };
}

/**
 * Requires and validates the provenance sidecar of a corpus being COMPARED
 * AGAINST.
 *
 * A corpus is a recording of one tree's behaviour, and on its own it does not
 * say which tree. Being an array of scenarios was the only thing this file used
 * to check, which left three failure modes indistinguishable from a clean gate:
 * a corpus captured from the MIGRATED tree replayed against the migrated tree
 * (a self-comparison that always passes), a corpus captured from some
 * intermediate commit (a recording of behaviour nobody approved), and a corpus
 * edited after capture (a baseline adjusted to match the target). Each is
 * checked here, by name, before a request is driven.
 *
 * The sidecar is `<corpus>.provenance.json`, which is what capture.js writes
 * and the same convention manifest.js and joi-matrix.js follow. It is required
 * for `--corpus` and `--secure-corpus` - the artifacts whose recorded responses
 * are the baseline - and NOT for `--annotations`, which carries markers and
 * reasons rather than responses and is a hand-authored definition file with no
 * capture behind it.
 *
 * THE COOKIE MODE IS PART OF THE IDENTITY. capture.js records which cookie
 * configuration it drove - `configuration.secure` and `server.secure` - and the
 * two corpus roles want opposite values: `--corpus` is the non-secure
 * recording and `--secure-corpus` is the secure one. Without that check the
 * same non-secure artifact could be handed to both roles and the secure pass
 * would report a measured secure baseline while comparing against a recording
 * made with `isSecure` unset, which is the one thing the secure pass exists to
 * measure. The same artifact in both roles is refused outright, by digest.
 *
 * @param {Object} artifact as readCorpusFile returns
 * @param {string} label
 * @param {Object} context {appHead, selfCheck, baselineHead, expectSecure,
 *   otherDigest}
 * @returns {Object} the provenance record for the result document
 * @throws {ToolError} On a missing, unreadable or contradicted sidecar.
 */
function validateCorpusProvenance(artifact, label, context) {
  var sidecarPath = artifact.path + PROVENANCE_SUFFIX;
  var failures = [];
  var text;
  var sidecar;
  var declaredDigest;
  var expectedBaseline;
  var identity;
  var treeHead;
  var toolHead;
  var toolPath;
  var capturedSecure;
  var record;

  if (!fs.existsSync(sidecarPath)) {
    throw new ToolError('the ' + label + ' ' + artifact.path + ' carries no ' +
      'provenance sidecar at ' + sidecarPath + '. A corpus without one does ' +
      'not say which tree it recorded, so replaying against it proves ' +
      'nothing: a corpus captured from the MIGRATED tree would compare ' +
      'cleanly against the migrated tree and the gate would pass on a ' +
      'self-comparison. capture.js writes the sidecar beside the corpus, so ' +
      'capture one:\n' +
      '  node test/parity/capture.js --app "$BASELINE" --out "$CORPUS" ' +
      '--expect-baseline\n' +
      'and replay with --corpus "$CORPUS". Its digest is ' + artifact.digest +
      ', which is what the sidecar has to describe.');
  }

  try {
    text = fs.readFileSync(sidecarPath, 'utf8');
  }
  catch (err) {
    throw new ToolError('the provenance sidecar ' + sidecarPath +
      ' cannot be read, so the ' + label + ' cannot be authenticated: ' +
      reasonOf(err));
  }

  try {
    sidecar = JSON.parse(text);
  }
  catch (err) {
    throw new ToolError('the provenance sidecar ' + sidecarPath +
      ' is not valid JSON, so the ' + label + ' cannot be authenticated: ' +
      reasonOf(err));
  }

  if (!sidecar || typeof sidecar !== 'object') {
    throw new ToolError('the provenance sidecar ' + sidecarPath +
      ' is not an object');
  }

  identity = readSidecarIdentity(sidecar);
  treeHead = identity.treeHead;
  toolHead = identity.toolHead;
  toolPath = identity.toolPath;
  declaredDigest = identity.digest;
  expectedBaseline = context.baselineHead === null
    ? BASELINE_COMMIT
    : context.baselineHead;

  // The cookie configuration the recording was made under. `configuration` is
  // what the capturing run was ASKED for and `server` is what the launcher
  // reports it did; a disagreement between them is itself a finding, so both
  // are read and the pair has to agree.
  capturedSecure = describeCapturedCookieMode(sidecar);

  if (sidecar.artifact && String(sidecar.artifact) !== path.basename(artifact.path)) {
    failures.push('it describes the artifact ' +
      JSON.stringify(String(sidecar.artifact)) + ' and sits beside ' +
      JSON.stringify(path.basename(artifact.path)) + ', so one of the two ' +
      'was moved and this sidecar is not this corpus\'s');
  }

  if (identity.corpusSchema !== undefined && artifact.parsed.schema !== undefined &&
      String(identity.corpusSchema) !== String(artifact.parsed.schema)) {
    failures.push('it records schema ' + JSON.stringify(identity.corpusSchema) +
      ' and the corpus declares schema ' +
      JSON.stringify(artifact.parsed.schema));
  }

  if (!treeHead || !/^[0-9a-f]{40}$/i.test(treeHead)) {
    failures.push('it records no commit for the tree that was captured - ' +
      'neither `analysedTree.head` nor `tree.head` (' +
      JSON.stringify(treeHead) + ') - so the baseline this corpus ' +
      'describes cannot be identified');
  }

  if (!toolHead || !/^[0-9a-f]{40}$/i.test(toolHead)) {
    failures.push('it records no commit for the generator - neither ' +
      '`generator.commit` nor `tool.head` (' + JSON.stringify(toolHead) +
      ') - so which version of the capture tool produced this corpus ' +
      'cannot be established');
  }

  if (!toolPath) {
    failures.push('it names no generator path - neither `generator.path` ' +
      'nor `tool.path` - so the generator behind the corpus is ' +
      'unidentified');
  }
  else if (!/^[A-Za-z0-9._\/-]+\.js$/.test(toolPath)) {
    failures.push('it names the generator ' + JSON.stringify(toolPath) +
      ', which is not a path to a JavaScript tool, so what produced this ' +
      'corpus cannot be identified');
  }

  if (capturedSecure.contradictory) {
    failures.push('it records the capturing run as ' +
      (capturedSecure.requested ? 'secure' : 'non-secure') + ' under ' +
      '`configuration.secure` and the server it drove as ' +
      (capturedSecure.served ? 'secure' : 'non-secure') + ' under ' +
      '`server.secure`. The two disagree, so which cookie configuration this ' +
      'recording was made under is not established');
  }

  // The role check. `--corpus` is the non-secure recording and
  // `--secure-corpus` the secure one; a run that handed the same artifact to
  // both roles, or the non-secure recording to the secure role, would report a
  // measured secure baseline while comparing against a recording made with
  // `isSecure` unset.
  if (context.expectSecure !== undefined && capturedSecure.known &&
      capturedSecure.secure !== context.expectSecure) {
    failures.push('this role needs a corpus captured in the ' +
      (context.expectSecure ? 'SECURE' : 'NON-SECURE') + ' cookie ' +
      'configuration and the sidecar records a ' +
      (capturedSecure.secure ? 'secure' : 'non-secure') + ' capture. ' +
      (context.expectSecure
        ? 'Capture one with capture.js against a --secure server; a ' +
          'non-secure recording cannot evidence the secure cookie contract, ' +
          'which is the only thing the secure pass measures.'
        : 'The primary corpus is the non-secure recording; the secure one ' +
          'belongs to --secure-corpus.'));
  }

  if (context.expectSecure !== undefined && !capturedSecure.known) {
    failures.push('it records no cookie configuration - neither ' +
      '`configuration.secure` nor `server.secure` - so whether this ' +
      'recording was made with `isSecure` set cannot be established, and ' +
      'this role requires the ' +
      (context.expectSecure ? 'secure' : 'non-secure') + ' one');
  }

  if (context.otherDigest && context.otherDigest === artifact.digest) {
    failures.push('this is byte-for-byte the same artifact as the other ' +
      'corpus in this run (digest ' + artifact.digest.slice(0, 16) + '). One ' +
      'recording cannot be both cookie configurations, and passing it as ' +
      'both would report the secure contract as measured while measuring ' +
      'nothing');
  }

  if (declaredDigest && String(declaredDigest) !== artifact.digest) {
    failures.push('it declares the artifact digest ' +
      JSON.stringify(String(declaredDigest)) + ' and the file on disk ' +
      'digests to ' + artifact.digest + ', so the corpus was changed after ' +
      'it was captured');
  }

  // The self-comparison guard. Replaying a corpus against the very tree it was
  // captured from is a legitimate REHEARSAL - the file's own --self-check - and
  // it is a meaningless gate run when it happens by accident, which is why the
  // declaration is required rather than inferred.
  if (!context.selfCheck && treeHead && context.appHead &&
      treeHead.toLowerCase() === String(context.appHead).toLowerCase()) {
    failures.push('it records the captured tree as ' + treeHead +
      ', which is the HEAD of the tree now under test. That is a ' +
      'self-comparison: it compares a recording against the tree that ' +
      'produced it and cannot fail on a behaviour change. Pass --self-check ' +
      'to declare that deliberately (it makes the run STRICTER: every ' +
      'difference fails and the approved deviation must NOT materialize), or ' +
      'replay a corpus captured at the baseline commit');
  }

  if (!context.selfCheck && expectedBaseline !== 'any' && treeHead &&
      treeHead.toLowerCase().indexOf(String(expectedBaseline).toLowerCase()) !== 0 &&
      String(expectedBaseline).toLowerCase().indexOf(treeHead.toLowerCase()) !== 0) {
    failures.push('it records the captured tree as ' + treeHead +
      ' and the R-f baseline reference is ' + expectedBaseline +
      ' (AAP §0.10.3). A corpus captured anywhere else records some other ' +
      'tree\'s behaviour, so comparing against it says nothing about this ' +
      'migration. Pass --baseline-head <sha> to name a different baseline ' +
      'deliberately, or --baseline-head any to compare against a corpus ' +
      'whose commit is not being checked');
  }

  if (failures.length) {
    throw new ToolError('the provenance sidecar ' + sidecarPath +
      ' does not authenticate the ' + label + ' ' + artifact.path + ':\n  - ' +
      failures.join('\n  - '));
  }

  record = {
    corpus: artifact.path,
    sidecar: sidecarPath,
    artifactDigest: artifact.digest,
    digestDeclared: declaredDigest ? String(declaredDigest) : null,
    digestVerified: !!declaredDigest,
    cookieMode: capturedSecure,
    generatorIsCapture: toolPath
      ? path.basename(toolPath) === CAPTURE_GENERATOR
      : false,
    schema: identity.corpusSchema === undefined ? null : identity.corpusSchema,
    capturedTree: {
      appRoot: identity.treeAppRoot,
      head: treeHead
    },
    generator: {
      path: identity.toolPath,
      worktree: identity.toolWorktree,
      head: toolHead
    },
    capturedAt: sidecar.generatedAt || sidecar.capturedAt || null,
    baselineHeadExpected: expectedBaseline,
    baselineHeadMatched: context.selfCheck || expectedBaseline === 'any'
      ? null
      : true,
    // Whether the FROZEN R-f reference was the one checked, rather than a
    // caller-named commit or no commit at all. `qualifyGate` requires this for
    // gate status: --baseline-head is a diagnostic escape, not a way to
    // redefine the baseline.
    frozenBaselineChecked: !context.selfCheck &&
      expectedBaseline === BASELINE_COMMIT,
    selfComparisonDeclared: !!context.selfCheck,
    note: declaredDigest
      ? 'the sidecar declares the artifact digest and it matches the file on disk'
      : 'the sidecar carries no artifact digest - capture.js does not write ' +
        'one - so the digest recorded here was computed from the file this ' +
        'run read, and it is what a later run compares against'
  };

  return record;
}

/**
 * Reads the cookie configuration a capture was made under, from its sidecar.
 *
 * capture.js records it twice and the two mean different things:
 * `configuration.secure` is what the capturing run was ASKED for, and
 * `server.secure` is what the launcher reports it actually served. Both are
 * read, a disagreement between them is reported as one, and a sidecar carrying
 * neither is `known: false` rather than assumed either way - an assumption here
 * would be the whole of the check it is supposed to support.
 *
 * @param {Object} sidecar
 * @returns {Object} {known, secure, requested, served, contradictory}
 */
function describeCapturedCookieMode(sidecar) {
  // The delivered writer records the run's own description under `detail`, so
  // both spellings are read: `detail.configuration` / `detail.server` first,
  // then the flat form. Reading only the flat form found nothing in a sidecar
  // capture.js had just written, which left `known` false and silently
  // disabled the role check this value exists for.
  var configuration = (sidecar.detail && sidecar.detail.configuration) ||
    sidecar.configuration || null;
  var server = (sidecar.detail && sidecar.detail.server) ||
    sidecar.server || null;
  var requested = configuration && configuration.secure !== undefined
    ? !!configuration.secure
    : null;
  var served = server && server.secure !== undefined
    ? !!server.secure
    : null;

  return {
    known: requested !== null || served !== null,
    // The served value wins where both exist and agree; where only one exists
    // it is the only evidence there is.
    secure: served === null ? !!requested : served,
    requested: requested,
    served: served,
    contradictory: requested !== null && served !== null && requested !== served
  };
}

/**
 * The identity fields this file checks, resolved out of a provenance sidecar.
 *
 * There are two spellings in the tree and this reads both, because the checks
 * are about the FACTS - which tree was captured, which generator captured it,
 * and whether the bytes still digest to what was declared - not about where
 * those facts are spelled.
 *
 * The delivered writer records `analysedTree.head`, `generator.path`,
 * `generator.commit` and an `artifactDigest` OBJECT carrying `{algorithm,
 * canonicalization, value}`. Reading only `tree.head`, `tool.head`, `tool.path`
 * and a STRING `artifactDigest` found none of them: measured against a sidecar
 * capture.js had just written, all three identity reads came back null and the
 * digest comparison stringified the object to "[object Object]", so it reported
 * a corpus "changed after it was captured" that was untouched. Worse than the
 * noise, `treeHead` being null is what the self-comparison guard and the R-f
 * baseline guard are both conditioned on, so the two checks that make a replay
 * evidence rather than a rehearsal did not run at all.
 *
 * `generator.commit` and not `generator.deliveredHead` for the tool: the
 * question is which generator source produced the artifact, and the delivered
 * writer leaves `commit` null precisely when the generator was uncommitted.
 * Falling back to the delivered head would answer a question nobody asked and
 * would let an unreviewed generator pass a check written to catch it.
 *
 * @param {Object} sidecar
 * @returns {Object} {treeHead, treeAppRoot, toolHead, toolPath, toolWorktree,
 *   digest, corpusSchema} with null for anything absent
 */
function readSidecarIdentity(sidecar) {
  var tree = sidecar.analysedTree || sidecar.tree || null;
  var tool = sidecar.generator || sidecar.tool || null;
  var digest = sidecar.artifactDigest || sidecar.digest || null;
  var schema = sidecar.schema;

  if (schema === undefined) {
    schema = sidecar.detail && sidecar.detail.corpusSchema !== undefined
      ? sidecar.detail.corpusSchema
      : undefined;
  }

  if (digest && typeof digest === 'object') {
    digest = digest.value === undefined ? null : digest.value;
  }

  return {
    treeHead: tree && tree.head ? String(tree.head) : null,
    treeAppRoot: (tree && tree.appRoot) || null,
    toolHead: tool && (tool.commit || tool.head)
      ? String(tool.commit || tool.head)
      : null,
    toolPath: tool && tool.path ? String(tool.path) : null,
    toolWorktree: (tool && tool.worktree) || null,
    digest: digest === null || digest === undefined ? null : String(digest),
    corpusSchema: schema
  };
}

/**
 * Compiles the --only patterns into one predicate.
 *
 * Same semantics as capture.js's, deliberately, so a segment captured with one
 * command is replayed with the same one: a value wrapped in slashes is a
 * regular expression, anything else a case-insensitive substring, matched
 * against the scenario id, its group and its route key.
 *
 * @param {Array.<string>} patterns
 * @returns {(function(Object): boolean|null)} null when everything is selected
 * @throws {ToolError} On an invalid regular expression.
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
      manifest.routeKey(item.route.method, item.route.path)
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
 * Reads one step in EITHER of the two shapes a corpus step can have.
 *
 * Before a capture a step carries its spec - label, method, target, accept,
 * payload, and optionally timeoutMs, identity and resetSessionBefore - with
 * `response: null`. When capture.js drives it, the step is REPLACED by
 * {label, request, response}, and the spec-only fields are dropped with it. A
 * replay needs them back: a step that reset the session before running is a
 * different request without that reset, and a step with a four-second budget
 * would sit for fifteen without it.
 *
 * So both shapes are read here, and anything the recorded shape dropped is
 * taken from the matching step of the annotations corpus when one was given.
 * Which fields came from where is recorded on the step, and the report says so,
 * because a silently defaulted timeout is a silently different request.
 *
 * @param {Object} step the corpus step
 * @param {number} index its position in the sequence
 * @param {Object} item the scenario
 * @param {(Object|null)} definition the matching step of the annotations corpus
 * @returns {Object} the internal step
 * @throws {ToolError} If neither shape yields a method and a target.
 */
function readStep(step, index, item, definition) {
  var request = step && step.request ? step.request : null;
  var recorded = step && step.response !== undefined ? step.response : null;
  var spec = definition || {};
  var restored = [];
  var out = {
    index: index,
    label: step && step.label ? step.label : 'step-' + index,
    method: null,
    target: null,
    accept: null,
    payload: null,
    contentType: null,
    identity: null,
    resetSessionBefore: false,
    timeoutMs: null,
    // The model-boundary fault control. It has to be carried into the plan or
    // the step is replayed UNFAULTED against a baseline captured faulted, and
    // the resulting difference is attributed to the application instead of to
    // the harness that stopped injecting.
    modelFault: null,
    baseline: recorded,
    restoredFields: restored
  };

  out.method = request && request.method
    ? request.method
    : (step && step.method) || spec.method || null;
  out.target = request && request.target
    ? request.target
    : (step && step.target) || spec.target || null;
  out.accept = (request && request.accept) || (step && step.accept) ||
    spec.accept || item.accept || ACCEPT_HTML;
  out.contentType = (request && request.contentType) ||
    (step && step.contentType) || spec.contentType || null;

  if (request && request.payload !== undefined) {
    out.payload = request.payload;
  }
  else if (step && step.payload !== undefined) {
    out.payload = step.payload;
  }
  else if (spec.payload !== undefined) {
    out.payload = spec.payload;
  }

  if (request && request.identity) {
    out.identity = request.identity;
  }
  else if (step && step.identity) {
    out.identity = step.identity;
  }
  else if (spec.identity) {
    out.identity = spec.identity;
    restored.push('identity');
  }
  else {
    out.identity = item.identity;
  }

  if (step && step.resetSessionBefore !== undefined) {
    out.resetSessionBefore = !!step.resetSessionBefore;
  }
  else if (spec.resetSessionBefore !== undefined) {
    out.resetSessionBefore = !!spec.resetSessionBefore;
    restored.push('resetSessionBefore');
  }

  // The fault control, from the corpus step first and the annotation spec
  // second - the same precedence every other field above uses. `recordStep`
  // carries it through capture, so a corpus driven by the current tooling has
  // it on the step; an older artifact may not, and `assertFaultControls` below
  // is what stops that being replayed as an application difference.
  if (step && step.modelFault) {
    out.modelFault = step.modelFault;
  }
  else if (spec.modelFault) {
    out.modelFault = spec.modelFault;
    restored.push('modelFault');
  }

  if (step && step.timeoutMs) {
    out.timeoutMs = step.timeoutMs;
  }
  else if (recorded && recorded.timeoutMs) {
    // The budget the capture actually applied. Preferred over the spec, because
    // it is what produced the recorded result.
    out.timeoutMs = recorded.timeoutMs;
  }
  else if (spec.timeoutMs) {
    out.timeoutMs = spec.timeoutMs;
    restored.push('timeoutMs');
  }

  if (!out.method || !out.target) {
    throw new ToolError('scenario ' + item.id + ' step ' + index + ' (' +
      out.label + ') carries neither a spec nor a recorded request, so there ' +
      'is nothing to replay. A corpus step must have either ' +
      '{method, target} or {request: {method, target}}.');
  }

  return out;
}

/**
 * Builds the replay plan: one entry per selected scenario, with its baseline.
 *
 * @param {Object} corpus the baseline corpus
 * @param {(Object|null)} annotations the marker and spec source, or null
 * @param {(function(Object): boolean|null)} filter
 * @returns {Object} {scenarios, skipped, annotationsUsed, unknownAnnotations}
 * @throws {ToolError} On a corpus that cannot be planned.
 */
function buildPlan(corpus, annotations, filter) {
  var byId = Object.create(null);
  var used = { expectedDeviation: [], unreachableReason: [], steps: [] };
  var unknown = [];
  var skipped = [];
  var scenarios = [];

  if (annotations) {
    annotations.scenarios.forEach(function(item) {
      if (item && item.id) {
        byId[item.id] = item;
      }
    });
  }

  corpus.scenarios.forEach(function(item, position) {
    var annotation;
    var plan;

    if (!item || !item.id || !item.route || !item.route.method || !item.route.path) {
      throw new ToolError('the corpus scenario at position ' + position +
        ' has no id or no route, so it cannot be replayed or accounted');
    }

    if (filter && !filter(item)) {
      skipped.push(item.id);
      return;
    }

    annotation = byId[item.id] || null;

    plan = {
      id: item.id,
      group: item.group || '(ungrouped)',
      route: { method: item.route.method, path: item.route.path },
      routeKey: manifest.routeKey(item.route.method, item.route.path),
      identity: item.identity || IDENTITY_ANONYMOUS,
      accept: item.accept || ACCEPT_HTML,
      intent: item.intent || 'success',
      mutating: !!item.mutating,
      fixtureProfile: item.fixtureProfile || 'default',
      freshSession: !!item.freshSession,
      covers: Array.isArray(item.covers) ? item.covers.slice() : [],
      notes: Array.isArray(item.notes) ? item.notes.slice() : [],
      expectation: item.expectation ||
        (annotation && annotation.expectation) || null,
      expectedDeviation: item.expectedDeviation || null,
      unreachableReason: item.unreachableReason || null,
      markerSource: { expectedDeviation: null, unreachableReason: null },
      steps: [],
      baselineRecorded: false
    };

    if (!plan.covers.length) {
      plan.covers = [plan.routeKey];
    }

    if (plan.expectedDeviation) {
      plan.markerSource.expectedDeviation = 'corpus';
    }
    else if (annotation && annotation.expectedDeviation) {
      plan.expectedDeviation = annotation.expectedDeviation;
      plan.markerSource.expectedDeviation = 'annotations';
      used.expectedDeviation.push(item.id);
    }

    if (plan.unreachableReason) {
      plan.markerSource.unreachableReason = 'corpus';
    }
    else if (annotation && annotation.unreachableReason) {
      plan.unreachableReason = annotation.unreachableReason;
      plan.markerSource.unreachableReason = 'annotations';
      used.unreachableReason.push(item.id);
    }

    (item.steps || []).forEach(function(step, index) {
      var definition = annotation && Array.isArray(annotation.steps)
        ? matchDefinitionStep(annotation.steps, step, index)
        : null;
      var planned = readStep(step, index, plan, definition);

      if (planned.restoredFields.length) {
        used.steps.push(plan.id + '#' + index + ': ' +
          planned.restoredFields.join(', '));
      }

      if (planned.baseline) {
        plan.baselineRecorded = true;
      }

      plan.steps.push(planned);
    });

    assertFaultControls(plan, item);
    // After the steps, so a clause that addresses a step the scenario does not
    // have is caught with the rest. This is where a corpus declaring an
    // operator this file cannot evaluate stops the run.
    assertExpectationSchema(plan);

    scenarios.push(plan);
  });

  // A marker in the annotations for a scenario the corpus does not hold is
  // reported rather than ignored: it means the two artifacts describe different
  // scenario sets, and the marker it was carrying is doing nothing.
  if (annotations) {
    annotations.scenarios.forEach(function(item) {
      var carriesMarker = item &&
        (item.expectedDeviation || item.unreachableReason);
      var present = corpus.scenarios.some(function(candidate) {
        return candidate && candidate.id === item.id;
      });

      if (carriesMarker && !present) {
        unknown.push(item.id);
      }
    });
  }

  return {
    scenarios: scenarios,
    skipped: skipped,
    annotationsUsed: used,
    unknownAnnotations: unknown
  };
}

/**
 * Refuses to replay a scenario whose fault control was lost.
 *
 * FAIL CLOSED, and this is the point of the function. A step captured with a
 * `modelFault` produced a FAULTED response; replaying it without the control
 * drives the ordinary path, gets an ordinary success, and reports the
 * difference against the application - when what changed is that the harness
 * stopped injecting. That failure mode is silent in exactly the direction that
 * matters: the auth scheme's lookup-error case would report "the outcome
 * changed" while the truth is "the outcome was never reached".
 *
 * Two shapes are refused:
 *
 *   A corpus step whose recorded response exists and whose declared fault has
 *   not reached the plan. Either the artifact predates `recordStep` carrying
 *   the control, or a hand edit dropped it.
 *
 *   A scenario in the auth-outcome group that declares no fault at all on any
 *   step. That group's fifth member is only reachable through one, so a
 *   silently fault-free `auth.outcome.lookup-error` is the exact regression
 *   this whole mechanism exists to prevent, and it is caught at plan time
 *   rather than discovered as a mismatched response.
 *
 * @param {Object} plan The planned scenario.
 * @param {Object} item The corpus scenario it was planned from.
 * @returns {undefined}
 * @throws {ToolError} When a fault control is missing.
 */
function assertFaultControls(plan, item) {
  var declared = 0;
  var planned = 0;

  (item.steps || []).forEach(function(step, index) {
    if (!step || !step.modelFault) {
      return;
    }

    declared = declared + 1;

    if (!plan.steps[index] || !plan.steps[index].modelFault) {
      throw new ToolError('corpus scenario ' + plan.id + ' step ' + index +
        ' (' + (step.label || 'unlabelled') + ') declares a model-boundary ' +
        'fault that did not reach the replay plan. Replaying it would drive ' +
        'the step UNFAULTED against a baseline captured WITH the fault, and ' +
        'report the resulting difference against the application rather than ' +
        'against this harness. Re-capture the scenario with tooling that ' +
        'carries `modelFault` through recordStep, or supply it through ' +
        '--annotations.');
    }
  });

  plan.steps.forEach(function(step) {
    if (step.modelFault) {
      planned = planned + 1;
    }
  });

  if (plan.id === LOOKUP_ERROR_SCENARIO && !planned) {
    throw new ToolError('corpus scenario ' + plan.id + ' carries no ' +
      'model-boundary fault on any step. That outcome - the auth scheme\'s ' +
      'fifth, `Boom.unauthorized(\'Auth error\')` - is reachable ONLY by ' +
      'making the user lookup itself fail, so a fault-free version of this ' +
      'scenario cannot assert it however it is driven. It would drive an ' +
      'ordinary authenticated request and pass.');
  }

  if (declared !== planned) {
    throw new ToolError('corpus scenario ' + plan.id + ' declares ' + declared +
      ' model-boundary fault(s) and the plan carries ' + planned +
      '. The two must agree, because a fault the plan does not carry is a ' +
      'step driven down a different path than the one that was recorded.');
  }
}

/**
 * Finds the annotation step that corresponds to a corpus step.
 *
 * By label first, because both shapes keep it and it survives a reordering, and
 * by position only when the label does not resolve.
 *
 * @param {Array.<Object>} steps
 * @param {Object} step
 * @param {number} index
 * @returns {(Object|null)}
 */
function matchDefinitionStep(steps, step, index) {
  var label = step && step.label;
  var found = null;

  if (label) {
    steps.forEach(function(candidate) {
      if (!found && candidate && candidate.label === label) {
        found = candidate;
      }
    });
  }

  return found || steps[index] || null;
}

// ---------------------------------------------------------------------------
// The driver
// ---------------------------------------------------------------------------

/**
 * Encodes a scenario payload the way the application expects to receive it.
 *
 * Form encoding is the default because that is what the page routes' own forms
 * send and what the hand-rolled validation block reads; a payload the corpus
 * recorded as JSON is sent as JSON. A payload carrying a Buffer-shaped entry is
 * rejected rather than silently mangled - the corpus holds none, and a
 * multipart upload is driven by the storage harness, not from here.
 *
 * @param {*} payload
 * @param {(string|null)} preferred the content type the corpus recorded
 * @returns {Object} {body, contentType, encoding}
 * @throws {ToolError} On a payload shape that cannot be encoded faithfully.
 */
function encodePayload(payload, preferred) {
  var parameters;

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

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ToolError('a scenario payload must be an object, a string or ' +
      'null; got ' + (Array.isArray(payload) ? 'an array' : typeof payload));
  }

  if (preferred && preferred.indexOf('json') >= 0) {
    return {
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
      contentType: JSON_TYPE,
      encoding: 'json'
    };
  }

  parameters = Object.keys(payload).map(function(key) {
    var value = payload[key];

    if (value !== null && typeof value === 'object') {
      // Nested objects have no faithful form encoding, and guessing one would
      // send a different request than the one that was recorded.
      throw new ToolError('the payload key ' + JSON.stringify(key) + ' holds ' +
        'an object, which has no faithful form encoding. Record the step with ' +
        'a JSON content type instead.');
    }

    return encodeURIComponent(key) + '=' +
      encodeURIComponent(value === null || value === undefined ? '' : String(value));
  });

  return {
    body: Buffer.from(parameters.join('&'), 'utf8'),
    contentType: FORM_TYPE,
    encoding: 'form'
  };
}

/**
 * Drives one request and records what came back, in the corpus's own shape.
 *
 * Deliberately NOT shared with capture.js, and the reason is the comparison
 * itself: if the recorder and the comparator were one implementation, a bug in
 * its normalization would be symmetric and therefore invisible - both sides
 * would be wrong in the same way and the gate would pass. This is an
 * independent implementation of the SAME documented contract (corpus schema 1),
 * which makes the two a cross-check rather than a tautology. Everything the
 * contract fixes is reproduced exactly: which types are textual, the text
 * cut-off, the sha256 body digest, the header normalization, the Set-Cookie
 * parse, and the three record shapes - answered, timed out, and transport
 * failure.
 *
 * Never rejects. A transport failure IS a recorded outcome here - it is how the
 * refused streaming case is captured - so it resolves with a record rather than
 * throwing.
 *
 * @param {Object} spec {baseUrl, method, target, headers, body, contentType}
 * @param {number} timeoutMs
 * @returns {Promise<Object>} the response record
 */
function drive(spec, timeoutMs) {
  return new Promise(function(resolve) {
    var url;
    var transport;
    var started = process.hrtime.bigint();
    var settled = false;
    var request;
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
      // `new URL` throughout. The legacy parser emits DEP0169, and this
      // process's stderr is inside the stream the zero-warning gate inspects.
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

    try {
      request = transport.request(url, {
        method: spec.method,
        headers: headers,
        // A per-request agent with keep-alive off. A pooled socket held open by
        // the never-settling case would keep this process alive after the
        // report was written, turning a clean exit into a hang.
        agent: new transport.Agent({ keepAlive: false })
      });
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

      // The expected-timeout path. A recorded `timedOut: true` is the EXPECTED
      // result for the two never-settling cases, so this is a first-class
      // outcome rather than a fault.
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
        var rawCookies = response.headers['set-cookie'] || [];
        var textual = isTextualType(response.headers['content-type']);
        var body = {
          encoding: textual ? 'text' : 'binary',
          length: buffer.length,
          digest: sha256Hex(buffer),
          truncated: false,
          text: null
        };
        var record;

        if (textual) {
          if (buffer.length > MAX_TEXT_BYTES) {
            body.text = buffer.slice(0, MAX_TEXT_BYTES).toString('utf8');
            body.truncated = true;
          }
          else {
            body.text = buffer.toString('utf8');
          }
        }

        record = {
          ok: true,
          timedOut: false,
          timeoutMs: timeoutMs,
          status: response.statusCode,
          statusMessage: response.statusMessage || '',
          httpVersion: response.httpVersion,
          headers: recordHeaders(response.headers),
          setCookies: rawCookies.map(parseSetCookie),
          body: body,
          elapsedMs: spent,
          elapsedBucket: elapsedBucket(spent)
        };

        // The genuine Set-Cookie values, needed to carry a session across a
        // sequence. NON-ENUMERABLE so that neither JSON.stringify nor
        // Object.keys can move a live session token into an artifact, however
        // this record is handled later.
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

/**
 * Splits one Set-Cookie header into its name, its value digest and its
 * attributes - the same parse the corpus was written with.
 *
 * The VALUE is replaced by its digest and its length, both of which are inside
 * the cookie-values category of the volatile set and are therefore not
 * compared. Everything that IS compared survives in full: the name, every
 * attribute, and the presence and day horizon of Expires.
 *
 * @param {string} raw one Set-Cookie header value
 * @returns {Object}
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
    // The absolute date is volatile; the HORIZON is the contract, and it is
    // recorded in whole days so that a one-year expiry compares equal across
    // two runs taken on different days while a collapse to session-only does
    // not.
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
 * Normalizes the raw header bag: keys lowercased and sorted, repeated headers
 * kept as arrays, and the value of any Set-Cookie redacted to its digest.
 *
 * The header is otherwise kept in its original shape, so a change in attribute
 * ORDER or spelling is still visible rather than being smoothed away by the
 * parse.
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

        return String(entry).replace(/^([^=;]*)=([^;]*)/, function(match, cookieName) {
          return cookieName + '=<redacted:sha256:' +
            parsed.valueDigest.slice(0, 16) + '>';
        });
      });
      return;
    }

    out[lower] = Array.isArray(value) ? value.slice() : value;
  });

  return sortedKeys(out);
}

// ---------------------------------------------------------------------------
// The cookie jar
// ---------------------------------------------------------------------------

/**
 * A cookie jar keyed by identity, plus the login flow that populates it.
 *
 * This reproduces the pattern the suite's own request helper uses - file the
 * `set-cookie` of a response against the active identity, replay only its
 * name=value pair on that identity's later requests, and send a `referer` of
 * the configured url on everything - rather than importing it. That helper
 * requires the application at its top, which would pull the entry point into
 * this process and break the two-worktree model outright. It is a pattern
 * reference, not a dependency.
 *
 * Sessions are established by driving the REAL login, never by forging a
 * cookie: maxCookieSize is 0, so session state lives on the server and a forged
 * cookie could not work even in principle, and the login flow is itself part of
 * the surface under comparison.
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
 * browser sends; replaying the attributes would produce a malformed header.
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
 * rotated session id does not accumulate duplicates a server would then have to
 * disambiguate.
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
 * Discards an identity's cookies, so its next request starts a fresh session.
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
 * @param {Object} spec {method, target, accept, headers, payload, contentType}
 * @param {number} [timeoutMs]
 * @returns {Promise<Object>} {response, sent}
 */
Jar.prototype.request = async function(identity, spec, timeoutMs) {
  var encoded = encodePayload(spec.payload, spec.contentType);
  var cookie = this.header(identity);
  var headers = {
    // The shape the suite's own requests have, so a replayed request is the
    // same kind of request the assertions were written against. Several
    // handlers read `request.headers.referer` into the view metrics they
    // persist, which makes it part of the behaviour rather than decoration.
    referer: this.referer,
    accept: spec.accept || ACCEPT_HTML,
    // Identity encoding, so a body digest is over the bytes the application
    // produced rather than over whatever compression negotiated.
    'accept-encoding': 'identity',
    'user-agent': USER_AGENT
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
  }, timeoutMs === undefined || timeoutMs === null ? this.timeoutMs : timeoutMs);

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
      payloadEncoding: encoded.encoding
    }
  };
};

/**
 * Establishes a session for one of the password identities by driving the real
 * login form, and reports whether it landed.
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
 * @returns {Promise<Object>} {ok, status, location, error}
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
// Difference records
// ---------------------------------------------------------------------------

/**
 * One difference, in the shape the report and the result document both use.
 *
 * The four fields the agent prompt requires of every difference - the scenario
 * id, the route, the field, and the two values - plus the step, because a
 * sequence has more than one request and "which one" is the first thing a
 * reviewer asks.
 *
 * @param {string} field
 * @param {*} baseline
 * @param {*} target
 * @param {Object} [extra] further named context
 * @returns {Object}
 */
function difference(field, baseline, target, extra) {
  var record = {
    field: field,
    baseline: excerpt(baseline),
    target: excerpt(target)
  };

  Object.keys(extra || {}).forEach(function(key) {
    record[key] = extra[key];
  });

  return record;
}

/**
 * An observation: something worth reporting that is NOT a gate field.
 *
 * Exactly two things reach here, and both are inside the volatile set: coarse
 * timing, where a case that moved from under a second to over ten is worth
 * seeing even though the value is a clock read, and a field whose exactness was
 * given up for this one comparison because normalization had to touch the body
 * it derives from. Nothing else may be reported this way - an observation is
 * not a soft failure, and there is no mode in which one affects the verdict.
 *
 * @param {string} field
 * @param {*} baseline
 * @param {*} target
 * @param {string} reason
 * @returns {Object}
 */
function observation(field, baseline, target, reason) {
  return {
    field: field,
    baseline: excerpt(baseline),
    target: excerpt(target),
    reason: reason
  };
}

// ---------------------------------------------------------------------------
// Header comparison
// ---------------------------------------------------------------------------

/**
 * A content type with its charset parameter removed.
 *
 * @param {*} value
 * @returns {(string|null)}
 */
function typeWithoutCharset(value) {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value)
    .split(';')
    .filter(function(part) {
      return !/^\s*charset\s*=/i.test(part);
    })
    .join(';')
    .replace(/\s+$/, '');
}

/**
 * A header value in a comparable form: normalized through the volatile set,
 * with an array kept as an array so a repeated header cannot compare equal to a
 * single one.
 *
 * @param {*} value
 * @returns {*}
 */
function comparableHeader(value) {
  if (Array.isArray(value)) {
    return value.map(function(entry) {
      return normalized(entry);
    });
  }

  return normalized(value);
}

/**
 * Compares two header bags exactly, field by field.
 *
 * EVERY header is compared, not only the ones the contract names: the named
 * ones lead the report, and the rest are compared with the same rigour, because
 * a header that appeared or vanished is a behaviour change whether or not
 * anyone thought to name it. Three rules bend, each declared in the volatile
 * set and nowhere else:
 *
 *   * a header in `VOLATILE_HEADERS` is dropped from both sides;
 *   * a header in `PRESENCE_ONLY_HEADERS` is compared for presence only;
 *   * `content-length` is compared exactly only when normalization touched
 *     neither body, because a normalized id or timestamp of a different length
 *     changes the byte count without changing behaviour. When it is not
 *     comparable it becomes an observation, and the body is compared in full
 *     regardless, so nothing is lost.
 *
 * The four error-page headers are compared like any other, which is the correct
 * treatment of the branch behaviour: app.js's first onPreResponse extension
 * returns early on 401/404/403/>=500 for a browser HTML request, so those
 * responses carry none of them and both sides agree on their absence, while a
 * 400 Boom and every non-Boom response carry all of them and both sides agree
 * on their values. Asserting the branch rule directly would encode a second
 * copy of the application's logic; comparing every response against its own
 * recorded baseline tests the same thing without one.
 *
 * A fourth rule applies to the derived secure pass only, and only to
 * `set-cookie`: that pass exists to change exactly the attribute suffix of that
 * one header, so its string form is compared for count while its attributes are
 * compared one by one through the cookie comparator, with the two documented
 * moves applied. Nothing is lost - the attributes ARE the header.
 *
 * @param {Object} baseline recorded headers
 * @param {Object} target observed headers
 * @param {Object} context {normalizationApplied, differential}
 * @returns {Object} {differences, observations}
 */
function compareHeaders(baseline, target, context) {
  var differences = [];
  var observations = [];
  var names = {};
  var ordered;

  Object.keys(baseline || {}).forEach(function(name) { names[name] = true; });
  Object.keys(target || {}).forEach(function(name) { names[name] = true; });

  // The named headers first, then everything else alphabetically, so the report
  // leads with the contract.
  ordered = NAMED_HEADERS.filter(function(name) {
    return names[name];
  }).concat(Object.keys(names).sort().filter(function(name) {
    return NAMED_HEADERS.indexOf(name) === -1;
  }));

  ordered.forEach(function(name) {
    var left = baseline ? baseline[name] : undefined;
    var right = target ? target[name] : undefined;
    var leftValue;
    var rightValue;

    if (VOLATILE_HEADERS.indexOf(name) >= 0) {
      return;
    }

    if (PRESENCE_ONLY_HEADERS.indexOf(name) >= 0) {
      if ((left === undefined) !== (right === undefined)) {
        differences.push(difference('header.' + name + '.present',
          left !== undefined, right !== undefined, {
            note: 'compared for presence only; its value is inside the ' +
              categoryForHeader(name) + ' category of the volatile set'
          }));
      }
      return;
    }

    if (name === 'content-type') {
      leftValue = typeWithoutCharset(left);
      rightValue = typeWithoutCharset(right);

      if (leftValue !== rightValue) {
        differences.push(difference('content-type', leftValue, rightValue, {
          note: 'compared without the charset parameter'
        }));
      }
      else if (String(left) !== String(right)) {
        observations.push(observation('content-type.charset', left, right,
          'the media type is identical and the charset parameter is excluded ' +
          'from the comparison by the contract'));
      }
      return;
    }

    if (name === 'set-cookie' && context.differential) {
      if ((Array.isArray(left) ? left.length : 0) !==
          (Array.isArray(right) ? right.length : 0)) {
        differences.push(difference('header.set-cookie.count',
          Array.isArray(left) ? left.length : 0,
          Array.isArray(right) ? right.length : 0));
      }
      else {
        observations.push(observation('header.set-cookie', left, right,
          'the secure pass changes exactly this header\'s attribute suffix, ' +
          'so its string form is compared for count here and its attributes ' +
          'are compared one by one against the documented differential'));
      }
      return;
    }

    if (name === 'content-length' && context.normalizationApplied) {
      if (String(left) !== String(right)) {
        observations.push(observation('content-length', left, right,
          'not comparable for this response: normalization touched the body ' +
          'it counts (' + context.normalizationApplied + '). The body itself ' +
          'is compared in full.'));
      }
      return;
    }

    leftValue = comparableHeader(left);
    rightValue = comparableHeader(right);

    if (JSON.stringify(leftValue) !== JSON.stringify(rightValue)) {
      differences.push(difference('header.' + name, leftValue, rightValue));
    }
  });

  return { differences: differences, observations: observations };
}

// ---------------------------------------------------------------------------
// Cookie comparison
// ---------------------------------------------------------------------------

/**
 * Compares the parsed Set-Cookie records of two responses.
 *
 * Every attribute is compared over the UNION of the two attribute maps, so an
 * attribute nobody enumerated - one a new framework version started emitting -
 * still fails rather than passing unnoticed. COOKIE_ATTRIBUTES exists to order
 * the report and to document the contract, not to bound the comparison.
 *
 * `expires` is the one attribute whose VALUE is not compared, because it is
 * "one year from whenever the response was produced". Its presence is compared
 * through the attribute map, where the parse has already reduced it to the
 * literal `present`, and its HORIZON is compared in whole days with a two-day
 * tolerance. That horizon assertion is the only thing in this file that can
 * detect the failure mode AAP §0.9.6 lists as unproven: the cookie patch runs
 * only while `request.response._header` is a function, so if hapi stopped
 * populating that private field the patch would silently become a no-op and the
 * expiry would change with nothing erroring.
 *
 * @param {Array.<Object>} baseline recorded setCookies
 * @param {Array.<Object>} target observed setCookies
 * @param {Object} [expectation] {differential} for the derived secure pass
 * @returns {Object} {differences, observations}
 */
function compareCookies(baseline, target, expectation) {
  var differences = [];
  var observations = [];
  var left = indexCookies(baseline);
  var right = indexCookies(target);
  var names = Object.keys(left).concat(Object.keys(right)).filter(function(name, index, all) {
    return all.indexOf(name) === index;
  }).sort();

  if ((baseline || []).length !== (target || []).length) {
    differences.push(difference('cookies.count',
      (baseline || []).length, (target || []).length));
  }

  names.forEach(function(name) {
    var recorded = left[name] || null;
    var observed = right[name] || null;
    var expectedAttributes;
    var attributeNames;

    if (!recorded || !observed) {
      differences.push(difference('cookie[' + name + '].present',
        !!recorded, !!observed));
      return;
    }

    expectedAttributes = expectation && expectation.differential
      ? secureDifferential(recorded.attributes)
      : recorded.attributes;

    attributeNames = COOKIE_ATTRIBUTES.filter(function(attribute) {
      return has(expectedAttributes, attribute) || has(observed.attributes, attribute);
    }).concat(Object.keys(expectedAttributes || {})
      .concat(Object.keys(observed.attributes || {}))
      .filter(function(attribute, index, all) {
        return all.indexOf(attribute) === index &&
          COOKIE_ATTRIBUTES.indexOf(attribute) === -1;
      }).sort());

    attributeNames.forEach(function(attribute) {
      var recordedValue = has(expectedAttributes, attribute)
        ? expectedAttributes[attribute]
        : null;
      var observedValue = has(observed.attributes, attribute)
        ? observed.attributes[attribute]
        : null;

      if (String(recordedValue) !== String(observedValue)) {
        differences.push(difference(
          'cookie[' + name + '].' + attribute,
          recordedValue,
          observedValue,
          expectation && expectation.differential
            ? { note: 'expected value derived from the non-secure pass; see ' +
                'the secure-pass note in the report' }
            : undefined
        ));
      }
    });

    if ((recorded.expiresInDays === null) !== (observed.expiresInDays === null)) {
      differences.push(difference('cookie[' + name + '].expires.horizon',
        recorded.expiresInDays, observed.expiresInDays, {
          note: 'one side carries an Expires horizon and the other does not. ' +
            'This is the assertion that detects the private-field cookie ' +
            'patch going silently no-op.'
        }));
      return;
    }

    if (recorded.expiresInDays !== null &&
        Math.abs(recorded.expiresInDays - observed.expiresInDays) >
          EXPIRES_HORIZON_TOLERANCE_DAYS) {
      differences.push(difference('cookie[' + name + '].expires.horizon',
        recorded.expiresInDays + ' days', observed.expiresInDays + ' days', {
          note: 'the horizon is compared in whole days with a tolerance of ' +
            EXPIRES_HORIZON_TOLERANCE_DAYS + ', because the timestamp is ' +
            'volatile and the horizon is the contract'
        }));
    }
    else if (recorded.expiresInDays !== null &&
             recorded.expiresInDays !== observed.expiresInDays) {
      observations.push(observation('cookie[' + name + '].expires.horizon',
        recorded.expiresInDays + ' days', observed.expiresInDays + ' days',
        'within the ' + EXPIRES_HORIZON_TOLERANCE_DAYS + '-day tolerance, ' +
        'which absorbs a baseline and a replay taken on different dates'));
    }
  });

  return { differences: differences, observations: observations };
}

/**
 * Indexes cookie records by name.
 *
 * @param {Array.<Object>} records
 * @returns {Object}
 */
function indexCookies(records) {
  var out = Object.create(null);

  (records || []).forEach(function(record) {
    if (record && record.name) {
      out[record.name] = record;
    }
  });

  return out;
}

/**
 * The attribute map the SECURE pass is expected to produce, derived from what
 * the non-secure pass produced.
 *
 * TWO MECHANISMS MOVE, AND THEY DO NOT MOVE TOGETHER, which is the whole
 * subtlety of this function:
 *
 *   Yar emits `Secure` on every cookie it sets whenever the session cookie
 *   options say the connection is secure. That applies to EVERY response that
 *   sets the session cookie.
 *
 *   The private-field patch appends `; SameSite=None; Secure` only on a request
 *   the route DSL marked as cookie-setting - the parser sets that flag, and six
 *   routes carry it. On any other response the patch does not run, so SameSite
 *   stays at Yar's own `Lax`.
 *
 * The observable marker of "the patch ran" is the `Expires` attribute, because
 * the patch's two appends sit under the identical guard: a baseline cookie
 * carrying an Expires horizon is one the patch touched, and only those move to
 * `SameSite=None`. Deriving otherwise - moving SameSite on every cookie - was
 * measured to report a difference on every non-cookie route in the secure pass.
 *
 * Everything else - HttpOnly, Path, Domain, Max-Age and the Expires horizon -
 * is expected to be identical, and a difference in any of them fails.
 *
 * This derivation exists because the committed corpus was captured through the
 * launcher's non-secure default and therefore holds no secure-pass baseline.
 * Capture one and pass --secure-corpus and this function is not used at all.
 *
 * @param {Object} attributes the non-secure attributes
 * @returns {Object}
 */
function secureDifferential(attributes) {
  var out = {};

  Object.keys(attributes || {}).forEach(function(key) {
    out[key] = attributes[key];
  });

  out.secure = true;

  if (has(attributes, 'expires')) {
    out.samesite = 'None';
  }

  return out;
}

/**
 * Whether an object carries a key of its own.
 *
 * @param {Object} value
 * @param {string} key
 * @returns {boolean}
 */
function has(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

// ---------------------------------------------------------------------------
// Body comparison
// ---------------------------------------------------------------------------

/**
 * Compares two recorded bodies.
 *
 * A BINARY body is compared by length, always and exactly, and by content
 * digest for every media type EXCEPT the six enumerated archive containers,
 * where the digest is recorded as an OBSERVATION rather than gating. Those
 * containers embed each entry's modification time in their own headers, so
 * their digest is a clock read while their length is not; the exemption is
 * declared in the timestamps category of the volatile set and nowhere else, and
 * the archive's internal layout is asserted by ./storage and ./worker, which
 * open it instead of hashing it. `describeBinaryBodyContract` emits both halves
 * of that contract into every artifact. No normalization applies to a binary
 * body either way, because there is no text to normalize.
 *
 * A TEXTUAL body is compared as its NORMALIZED WHOLE first. That is deliberate
 * and it is the strongest available reading of this folder's third commitment:
 * gating on the whole document means every byte a rendered page emits is
 * compared unless a volatile-set rule removed it, rather than only the parts
 * someone thought to enumerate. The named sub-fields - rendered text, form and
 * input names and values, ids, classes, data- and ARIA attributes, inline
 * scripts, href and src - are then extracted to SAY WHAT DIFFERED, so a
 * reviewer can act on the report without re-running the tool. They narrow the
 * report; they never narrow the gate.
 *
 * @param {Object} baseline recorded body
 * @param {Object} target observed body
 * @param {Object} context {contentType, normalizationApplied}
 * @returns {Object} {differences, observations}
 */
function compareBody(baseline, target, context) {
  var differences = [];
  var observations = [];
  var left;
  var right;
  var divergence;

  if (!baseline || !target) {
    if (!baseline !== !target) {
      differences.push(difference('body.present', !!baseline, !!target));
    }

    return { differences: differences, observations: observations };
  }

  if (baseline.encoding !== target.encoding) {
    differences.push(difference('body.encoding', baseline.encoding,
      target.encoding, {
        note: 'text or binary follows from the content type, so this is a ' +
          'content-type consequence as much as a body one'
      }));
  }

  if (baseline.truncated !== target.truncated) {
    differences.push(difference('body.truncated', baseline.truncated,
      target.truncated, {
        note: 'both sides truncate at ' + MAX_TEXT_BYTES + ' bytes, so this ' +
          'means the body crossed that boundary on one side only'
      }));
  }

  if (baseline.encoding === 'binary' || target.encoding === 'binary' ||
      baseline.text === null || target.text === null) {
    if (baseline.length !== target.length) {
      differences.push(difference('body.length', baseline.length, target.length));
    }

    if (baseline.digest === target.digest) {
      return { differences: differences, observations: observations };
    }

    if (isArchiveDigestExempt(context.contentType)) {
      observations.push(observation('body.digest', baseline.digest,
        target.digest, 'this content type embeds each entry\'s modification ' +
        'time, so its digest is a clock read - see the timestamps category of ' +
        'the volatile set. The byte length IS compared, and the archive\'s ' +
        'internal layout is asserted by the storage and worker harnesses, ' +
        'which open it rather than hashing it.'));

      return { differences: differences, observations: observations };
    }

    differences.push(difference('body.digest', baseline.digest, target.digest, {
      note: 'sha256 over the whole body; no normalization applies to a ' +
        'binary or stream body'
    }));

    return { differences: differences, observations: observations };
  }

  left = normalizeText(baseline.text);
  right = normalizeText(target.text);

  if (left.value === right.value) {
    if (!left.applied.length && !right.applied.length) {
      // Nothing was normalized, so the recorded byte count and digest are
      // exactly comparable and are compared.
      if (baseline.length !== target.length) {
        differences.push(difference('body.length', baseline.length, target.length));
      }

      if (baseline.digest !== target.digest) {
        differences.push(difference('body.digest', baseline.digest,
          target.digest, {
            note: 'the normalized text is identical but the raw bytes are ' +
              'not, and no volatile rule fired - so the difference is in ' +
              'bytes the text form does not carry, such as an encoding change'
          }));
      }
    }
    else if (baseline.digest !== target.digest) {
      observations.push(observation('body.digest', baseline.digest,
        target.digest, 'the normalized text is identical; the raw digest ' +
        'differs because normalization fired (' +
        left.applied.concat(right.applied).join(', ') + ')'));
    }

    return { differences: differences, observations: observations };
  }

  // The gate has already failed at this point. Everything below only decides
  // how precisely the report can name what changed.
  if (isTextualJson(context.contentType)) {
    differences = differences.concat(compareJson(left.value, right.value));
  }
  else if (isTextualMarkup(context.contentType)) {
    differences = differences.concat(compareMarkup(left.value, right.value));
  }

  if (!differences.length) {
    divergence = firstDivergence(left.value, right.value);

    differences.push(difference('body.text', windowAround(left.value, divergence),
      windowAround(right.value, divergence), {
        note: 'the normalized bodies differ at character ' + divergence +
          ' and no structured sub-field accounts for it',
        offset: divergence
      }));
  }

  return { differences: differences, observations: observations };
}

/**
 * Whether a content type is one the volatile set exempts from a binary digest
 * comparison, because the container embeds modification times.
 *
 * The list is read from the timestamps category and from nowhere else, so the
 * exemption cannot be widened without appearing in that list.
 *
 * @param {*} contentType
 * @returns {boolean}
 */
function isArchiveDigestExempt(contentType) {
  var media = String(typeWithoutCharset(contentType) || '').trim().toLowerCase();

  return ARCHIVE_DIGEST_EXEMPT.indexOf(media) >= 0;
}

/**
 * Whether a content type is JSON.
 *
 * @param {*} contentType
 * @returns {boolean}
 */
function isTextualJson(contentType) {
  return /json/i.test(String(contentType || ''));
}

/**
 * Whether a content type is HTML or XML markup.
 *
 * @param {*} contentType
 * @returns {boolean}
 */
function isTextualMarkup(contentType) {
  return /html|xml/i.test(String(contentType || ''));
}

// ---------------------------------------------------------------------------
// JSON comparison
// ---------------------------------------------------------------------------

/**
 * Compares two JSON documents structurally.
 *
 * Structurally so that key ORDER cannot manufacture a difference, and never
 * loosely: a scalar is compared by value AND by type, so `"1"` and `1` differ;
 * a missing key is reported as a difference rather than skipped; and an array
 * is compared element by element including its length.
 *
 * @param {string} baselineText
 * @param {string} targetText
 * @returns {Array.<Object>} differences
 */
function compareJson(baselineText, targetText) {
  var left;
  var right;
  var leftFlat;
  var rightFlat;
  var paths;
  var differences = [];

  try {
    left = JSON.parse(baselineText);
  }
  catch (err) {
    left = undefined;
  }

  try {
    right = JSON.parse(targetText);
  }
  catch (err) {
    right = undefined;
  }

  if (left === undefined || right === undefined) {
    // One of them is not JSON despite the content type. Reported as its own
    // difference, because "the response stopped being parseable JSON" is a
    // finding in its own right, and the caller falls back to a text window.
    if ((left === undefined) !== (right === undefined)) {
      return [difference('body.json.parseable', left !== undefined,
        right !== undefined, {
          note: 'the content type says JSON but one side does not parse'
        })];
    }

    return [];
  }

  leftFlat = flattenJson(left, '$', Object.create(null));
  rightFlat = flattenJson(right, '$', Object.create(null));

  paths = Object.keys(leftFlat).concat(Object.keys(rightFlat))
    .filter(function(value, index, all) {
      return all.indexOf(value) === index;
    })
    .sort();

  paths.forEach(function(pathKey) {
    var recorded = has(leftFlat, pathKey) ? leftFlat[pathKey] : undefined;
    var observed = has(rightFlat, pathKey) ? rightFlat[pathKey] : undefined;

    if (recorded === undefined) {
      differences.push(difference('body.json' + pathKey.slice(1),
        '(absent)', observed, { note: 'a key the baseline did not carry' }));
      return;
    }

    if (observed === undefined) {
      differences.push(difference('body.json' + pathKey.slice(1),
        recorded, '(absent)', { note: 'a key the baseline carried' }));
      return;
    }

    if (recorded !== observed) {
      differences.push(difference('body.json' + pathKey.slice(1),
        recorded, observed));
    }
  });

  return differences;
}

/**
 * Flattens a JSON value into a path-keyed map of type-tagged scalars.
 *
 * The type tag is what keeps the comparison honest: `number:1` never equals
 * `string:1`, and `null` never equals `string:`. String scalars are normalized
 * through the volatile set, and so is the string form of a number, so a
 * run-minted id or a run-era instant compares equal while the type it arrived
 * as is still checked.
 *
 * @param {*} value
 * @param {string} prefix
 * @param {Object} out
 * @returns {Object}
 */
function flattenJson(value, prefix, out) {
  if (value === null) {
    out[prefix] = 'null';
    return out;
  }

  if (Array.isArray(value)) {
    // The container's own kind and size are recorded, so an empty array does
    // not compare equal to an empty object and a truncated list is a
    // difference even when every element it kept still matches.
    out[prefix + '.@kind'] = 'array';
    out[prefix + '.length'] = 'number:' + value.length;

    value.forEach(function(entry, index) {
      flattenJson(entry, prefix + '[' + index + ']', out);
    });

    return out;
  }

  if (typeof value === 'object') {
    out[prefix + '.@kind'] = 'object';

    Object.keys(value).sort().forEach(function(key) {
      flattenJson(value[key], prefix + '.' + key, out);
    });

    return out;
  }

  if (typeof value === 'number') {
    out[prefix] = 'number:' + normalized(String(value));
    return out;
  }

  if (typeof value === 'string') {
    out[prefix] = 'string:' + normalized(value);
    return out;
  }

  out[prefix] = typeof value + ':' + String(value);

  return out;
}

// ---------------------------------------------------------------------------
// Markup comparison
// ---------------------------------------------------------------------------

// The tag scanner. One alternation, in priority order: a comment, a script
// element with its content, a style element with its content, then any tag.
// Anything between two matches is text. Written as one expression rather than
// as nested passes so a `<` inside an attribute value cannot desynchronize the
// two sides differently.
var MARKUP_TOKEN = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<\/?([a-zA-Z][-a-zA-Z0-9:]*)((?:"[^"]*"|'[^']*'|[^>"'])*)\/?>/g;

var ATTRIBUTE_TOKEN = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

// The elements whose name and value pairs are the form surface.
var FORM_CONTROLS = Object.freeze(['input', 'select', 'textarea', 'button', 'option']);

/**
 * Extracts the comparable surface of a markup document.
 *
 * Both sides go through this same extractor, so the extraction only has to be
 * DETERMINISTIC to be useful - it is not trying to be a conforming HTML parser,
 * and it does not need to be: the gate is the whole-document comparison, and
 * this exists to name what changed within it.
 *
 * @param {string} text markup, already normalized
 * @returns {Object} the surface
 */
function markupSurface(text) {
  var source = String(text || '');
  var surface = {
    text: '',
    forms: [],
    controls: [],
    ids: [],
    classes: [],
    dataAria: [],
    hrefs: [],
    srcs: [],
    inlineScripts: 0,
    externalScripts: [],
    inlineScriptDigests: []
  };
  var textParts = [];
  var lastIndex = 0;
  var formIndex = -1;
  var match;

  MARKUP_TOKEN.lastIndex = 0;

  while ((match = MARKUP_TOKEN.exec(source)) !== null) {
    if (match.index > lastIndex) {
      textParts.push(source.slice(lastIndex, match.index));
    }

    lastIndex = match.index + match[0].length;

    if (match[0].slice(0, 4) === '<!--') {
      continue;
    }

    if (match[3] === undefined && match[1] !== undefined) {
      // A script element. Its content is not page text, and its presence is
      // part of the compared surface.
      recordScript(surface, match[1], match[2]);
      continue;
    }

    if (match[3] === undefined) {
      // A style element; its content is not page text either.
      continue;
    }

    recordTag(surface, match[0], match[3].toLowerCase(), match[4] || '',
      function(next) { formIndex = next; }, formIndex);
  }

  if (lastIndex < source.length) {
    textParts.push(source.slice(lastIndex));
  }

  surface.text = textParts.join(' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return surface;
}

/**
 * Records one script element on the surface.
 *
 * @param {Object} surface
 * @param {string} attributeText
 * @param {string} content
 * @returns {undefined}
 */
function recordScript(surface, attributeText, content) {
  var attributes = parseAttributes(attributeText);

  if (attributes.src) {
    surface.externalScripts.push(attributes.src);
    surface.srcs.push(attributes.src);
    return;
  }

  surface.inlineScripts++;
  // The content is compared too, not merely counted. It has already been
  // normalized with the rest of the document, so an inlined id or instant does
  // not make it volatile, and an inline script IS client-visible behaviour.
  surface.inlineScriptDigests.push(sha256Hex(String(content || '').replace(/\s+/g, ' ').trim()));
}

/**
 * Records one tag on the surface.
 *
 * @param {Object} surface
 * @param {string} raw the whole tag
 * @param {string} name the lowercased tag name
 * @param {string} attributeText
 * @param {function(number): undefined} setForm
 * @param {number} formIndex the enclosing form, or -1
 * @returns {undefined}
 */
function recordTag(surface, raw, name, attributeText, setForm, formIndex) {
  var attributes;

  if (raw.slice(0, 2) === '</') {
    if (name === 'form') {
      setForm(-1);
    }

    return;
  }

  attributes = parseAttributes(attributeText);

  if (name === 'form') {
    surface.forms.push({
      action: attributes.action === undefined ? null : attributes.action,
      method: attributes.method === undefined ? null : String(attributes.method).toLowerCase(),
      name: attributes.name === undefined ? null : attributes.name
    });
    setForm(surface.forms.length - 1);
    formIndex = surface.forms.length - 1;
  }

  if (FORM_CONTROLS.indexOf(name) >= 0) {
    surface.controls.push({
      form: formIndex,
      tag: name,
      type: attributes.type === undefined ? null : attributes.type,
      name: attributes.name === undefined ? null : attributes.name,
      value: attributes.value === undefined ? null : attributes.value,
      checked: has(attributes, 'checked'),
      selected: has(attributes, 'selected'),
      disabled: has(attributes, 'disabled')
    });
  }

  if (attributes.id !== undefined) {
    surface.ids.push(name + '#' + attributes.id);
  }

  if (attributes['class'] !== undefined) {
    surface.classes.push(name + '.' + String(attributes['class']).split(/\s+/).sort().join(' '));
  }

  Object.keys(attributes).forEach(function(attribute) {
    if (attribute === 'role' || attribute.slice(0, 5) === 'data-' ||
        attribute.slice(0, 5) === 'aria-') {
      surface.dataAria.push(name + '[' + attribute + '=' +
        String(attributes[attribute]) + ']');
    }
  });

  if (attributes.href !== undefined) {
    surface.hrefs.push(attributes.href);
  }

  if (attributes.src !== undefined) {
    surface.srcs.push(attributes.src);
  }
}

/**
 * Parses a tag's attribute text into a map, values unquoted and keys
 * lowercased. A valueless attribute becomes boolean true.
 *
 * @param {string} attributeText
 * @returns {Object}
 */
function parseAttributes(attributeText) {
  var out = Object.create(null);
  var source = String(attributeText || '');
  var match;

  ATTRIBUTE_TOKEN.lastIndex = 0;

  while ((match = ATTRIBUTE_TOKEN.exec(source)) !== null) {
    if (match[2] === undefined) {
      out[match[1].toLowerCase()] = true;
      continue;
    }

    out[match[1].toLowerCase()] = /^["']/.test(match[2])
      ? match[2].slice(1, -1)
      : match[2];
  }

  return out;
}

/**
 * Compares the surfaces of two markup documents, field by named field.
 *
 * @param {string} baselineText normalized markup
 * @param {string} targetText normalized markup
 * @returns {Array.<Object>} differences
 */
function compareMarkup(baselineText, targetText) {
  var left = markupSurface(baselineText);
  var right = markupSurface(targetText);
  var differences = [];
  var divergence;

  if (left.text !== right.text) {
    divergence = firstDivergence(left.text, right.text);

    differences.push(difference('html.text',
      windowAround(left.text, divergence),
      windowAround(right.text, divergence), {
        note: 'the rendered text, whitespace-collapsed, with script and style ' +
          'content excluded; differs at character ' + divergence,
        offset: divergence
      }));
  }

  compareLists(differences, 'html.forms', left.forms, right.forms);
  compareLists(differences, 'html.controls', left.controls, right.controls);
  compareLists(differences, 'html.ids', left.ids, right.ids);
  compareLists(differences, 'html.classes', left.classes, right.classes);
  compareLists(differences, 'html.dataAria', left.dataAria, right.dataAria);
  compareLists(differences, 'html.href', left.hrefs, right.hrefs);
  compareLists(differences, 'html.src', left.srcs, right.srcs);
  compareLists(differences, 'html.externalScripts', left.externalScripts,
    right.externalScripts);
  compareLists(differences, 'html.inlineScriptDigests', left.inlineScriptDigests,
    right.inlineScriptDigests);

  if (left.inlineScripts !== right.inlineScripts) {
    differences.push(difference('html.inlineScripts', left.inlineScripts,
      right.inlineScripts, { note: 'the count of inline script elements' }));
  }

  return differences;
}

/**
 * Compares two ordered lists element by element, in document order.
 *
 * Order is part of the comparison: two pages carrying the same set of links in
 * a different order are two different pages.
 *
 * @param {Array.<Object>} differences accumulator
 * @param {string} field
 * @param {Array.<*>} left
 * @param {Array.<*>} right
 * @returns {undefined}
 */
function compareLists(differences, field, left, right) {
  var limit = Math.max(left.length, right.length);
  var index;
  var recorded;
  var observed;

  if (left.length !== right.length) {
    differences.push(difference(field + '.count', left.length, right.length));
  }

  for (index = 0; index < limit; index++) {
    recorded = index < left.length ? left[index] : undefined;
    observed = index < right.length ? right[index] : undefined;

    if (JSON.stringify(recorded) !== JSON.stringify(observed)) {
      differences.push(difference(field + '[' + index + ']',
        recorded === undefined ? '(absent)' : recorded,
        observed === undefined ? '(absent)' : observed));
    }
  }
}

// ---------------------------------------------------------------------------
// The step comparator
// ---------------------------------------------------------------------------

var OUTCOME_ANSWERED  = 'answered';
var OUTCOME_TIMED_OUT = 'timed-out';
var OUTCOME_TRANSPORT = 'transport-failure';
var OUTCOME_MISSING   = 'not-recorded';

/**
 * The outcome class of a response record.
 *
 * The first thing compared, because the three are not degrees of one another:
 * a route that answered where it used to hang, or hung where it used to answer,
 * is a different finding from one that answered differently, and only the
 * outcome class distinguishes them.
 *
 * @param {(Object|null)} record
 * @returns {string}
 */
function outcomeOf(record) {
  if (!record) {
    return OUTCOME_MISSING;
  }

  if (record.timedOut) {
    return OUTCOME_TIMED_OUT;
  }

  if (record.ok === false) {
    return OUTCOME_TRANSPORT;
  }

  return OUTCOME_ANSWERED;
}

/**
 * The error code of a transport failure, which is the comparable part of it.
 *
 * The message embeds the address that was dialled, and two runs on different
 * ports would differ there without differing in behaviour. The CODE - the
 * bracketed suffix `drive` appends - is what says what happened, so it is the
 * gate field and the whole message is reported beside it.
 *
 * @param {(Object|null)} record
 * @returns {(string|null)}
 */
function transportCodeOf(record) {
  var match = /\(([A-Z][A-Z0-9_]+)\)\s*$/.exec(String((record && record.error) || ''));

  return match ? match[1] : null;
}

/**
 * Compares one step's recorded response with what was just observed.
 *
 * @param {Object} step the planned step, carrying its baseline
 * @param {Object} observed the response record just driven
 * @param {Object} [expectation] {differential} for the derived secure pass
 * @returns {Object} {outcome, baselineOutcome, differences, observations}
 */
function compareStep(step, observed, expectation) {
  var baseline = step.baseline;
  var baselineOutcome = outcomeOf(baseline);
  var observedOutcome = outcomeOf(observed);
  var differences = [];
  var observations = [];
  var contentType;
  var normalizationApplied;
  var headerResult;
  var cookieResult;
  var bodyResult;

  if (baselineOutcome === OUTCOME_MISSING) {
    return {
      outcome: observedOutcome,
      baselineOutcome: baselineOutcome,
      differences: [difference('baseline', '(no recorded response)',
        observedOutcome, {
          note: 'this step carries no baseline, so there is nothing to ' +
            'compare it against. A corpus is captured by capture.js; replay ' +
            'never records one.'
        })],
      observations: observations
    };
  }

  if (baselineOutcome !== observedOutcome) {
    differences.push(difference('outcome', baselineOutcome, observedOutcome, {
      note: describeOutcomeChange(baselineOutcome, observedOutcome),
      baselineDetail: baselineOutcome === OUTCOME_TRANSPORT
        ? baseline.error
        : (baseline.status === undefined ? null : baseline.status),
      targetDetail: observedOutcome === OUTCOME_TRANSPORT
        ? observed.error
        : (observed.status === undefined ? null : observed.status)
    }));

    // The two records are not commensurable once the class differs, so nothing
    // below would mean anything. The one difference is the whole finding.
    return {
      outcome: observedOutcome,
      baselineOutcome: baselineOutcome,
      differences: differences,
      observations: observations
    };
  }

  if (observedOutcome === OUTCOME_TIMED_OUT) {
    // A recorded timeout is the EXPECTED result for the two never-settling
    // cases, so matching it is a pass. The budget is reported when it differs,
    // because a case that timed out under a different budget is not the same
    // measurement even though the outcome reads the same.
    if (baseline.timeoutMs !== observed.timeoutMs) {
      observations.push(observation('timeoutMs', baseline.timeoutMs,
        observed.timeoutMs, 'both sides timed out, under different budgets'));
    }

    return {
      outcome: observedOutcome,
      baselineOutcome: baselineOutcome,
      differences: differences,
      observations: observations
    };
  }

  if (observedOutcome === OUTCOME_TRANSPORT) {
    if (transportCodeOf(baseline) !== transportCodeOf(observed)) {
      differences.push(difference('transport.code', transportCodeOf(baseline),
        transportCodeOf(observed), {
          baselineDetail: baseline.error,
          targetDetail: observed.error
        }));
    }
    else {
      observations.push(observation('transport.error', baseline.error,
        observed.error, 'the error code matches; the message embeds the ' +
        'address that was dialled, which is not a behaviour'));
    }

    return {
      outcome: observedOutcome,
      baselineOutcome: baselineOutcome,
      differences: differences,
      observations: observations
    };
  }

  if (baseline.status !== observed.status) {
    differences.push(difference('status', baseline.status, observed.status));
  }

  if (String(baseline.statusMessage) !== String(observed.statusMessage)) {
    differences.push(difference('statusMessage', baseline.statusMessage,
      observed.statusMessage, {
        note: 'the reason phrase on the status line, which is part of the ' +
          'wire response and is deterministic per status'
      }));
  }

  if (String(baseline.httpVersion) !== String(observed.httpVersion)) {
    differences.push(difference('httpVersion', baseline.httpVersion,
      observed.httpVersion));
  }

  contentType = observed.headers ? observed.headers['content-type'] : null;
  normalizationApplied = bodyNormalization(baseline.body, observed.body);

  headerResult = compareHeaders(baseline.headers, observed.headers, {
    normalizationApplied: normalizationApplied,
    differential: !!(expectation && expectation.differential)
  });
  cookieResult = compareCookies(baseline.setCookies, observed.setCookies,
    expectation);
  bodyResult = compareBody(baseline.body, observed.body, {
    contentType: contentType,
    normalizationApplied: normalizationApplied
  });

  differences = differences
    .concat(headerResult.differences)
    .concat(cookieResult.differences)
    .concat(bodyResult.differences);

  observations = observations
    .concat(headerResult.observations)
    .concat(cookieResult.observations)
    .concat(bodyResult.observations);

  VOLATILE_RESPONSE_FIELDS.forEach(function(field) {
    if (String(baseline[field]) !== String(observed[field])) {
      observations.push(observation(field, baseline[field], observed[field],
        'inside the volatile set, so not a gate field; reported because a ' +
        'large timing change is worth seeing even when the response matches'));
    }
  });

  return {
    outcome: observedOutcome,
    baselineOutcome: baselineOutcome,
    differences: differences,
    observations: observations
  };
}

/**
 * Which volatile text rules fired on either body, as a readable list.
 *
 * Used to decide whether the recorded byte count and digest are still exactly
 * comparable for this response. It is a REPORTING and exactness decision only;
 * it can never suppress a difference in the body itself, which is always
 * compared in full.
 *
 * @param {(Object|null)} baselineBody
 * @param {(Object|null)} targetBody
 * @returns {(string|null)}
 */
function bodyNormalization(baselineBody, targetBody) {
  var applied = [];

  [baselineBody, targetBody].forEach(function(body) {
    if (body && typeof body.text === 'string') {
      normalizeText(body.text).applied.forEach(function(rule) {
        if (applied.indexOf(rule) === -1) {
          applied.push(rule);
        }
      });
    }
  });

  return applied.length ? applied.join(', ') : null;
}

/**
 * A sentence naming what an outcome change means, so the report says why it
 * matters rather than only that it happened.
 *
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
function describeOutcomeChange(from, to) {
  if (from === OUTCOME_TIMED_OUT && to === OUTCOME_ANSWERED) {
    return 'the baseline never settled and the target answered. This is a ' +
      'behaviour change: it is a FAILURE unless the scenario carries an ' +
      'approved deviation marker.';
  }

  if (from === OUTCOME_ANSWERED && to === OUTCOME_TIMED_OUT) {
    return 'the baseline answered and the target hangs. A route that stopped ' +
      'serving is the most serious finding this gate can produce.';
  }

  if (to === OUTCOME_TRANSPORT) {
    return 'the target could not be reached for this step. If the application ' +
      'died mid-run, every later step reports the same thing and only the ' +
      'first is meaningful - see the application-death report.';
  }

  if (from === OUTCOME_TRANSPORT) {
    return 'the baseline recorded a transport failure and the target answered.';
  }

  return 'the outcome class changed';
}

// ---------------------------------------------------------------------------
// Declared expectations
// ---------------------------------------------------------------------------

/**
 * Rejects an expectation this file cannot fully evaluate.
 *
 * Called from `buildPlan` for every selected scenario, before anything is
 * launched, and it THROWS rather than reporting. The reason is what this check
 * was written for: four operators the corpus authors used - `statusIn`,
 * `headerPresent`, `bodyIncludes` and `cross.bodiesDiffer` - were simply not
 * implemented here, so sixteen authored clauses and eleven whole scenarios read
 * as checked and asserted NOTHING. That is worse than an absent check, because
 * a reader of the corpus sees a declared expectation and believes it. A clause
 * this tool does not understand is therefore a reason to refuse the run, not a
 * clause to skip: exit 2, "the comparison never happened", is the honest
 * outcome, and it is the same treatment a corpus with no recorded baseline gets.
 *
 * @param {Object} plan the planned scenario, with its steps already read
 * @returns {undefined}
 * @throws {ToolError} On an unknown key, a malformed clause or a step index
 *   that addresses a step the scenario does not have.
 */
function assertExpectationSchema(plan) {
  var declared = plan.expectation;
  var failures = [];
  var stepCount = plan.steps.length;

  function integer(value) {
    return typeof value === 'number' && isFinite(value) &&
      Math.floor(value) === value;
  }

  function text(value) {
    return typeof value === 'string' && value.length > 0;
  }

  function addressable(index, where) {
    if (!integer(index) || index < 0) {
      failures.push(where + ' addresses step ' + JSON.stringify(index) +
        ', which is not a step index');
      return;
    }

    // A scenario with no steps is unreachable by design and is not driven, so
    // its clauses have nothing to address; the bound is only checked where
    // there are steps to bound it by.
    if (stepCount && index >= stepCount) {
      failures.push(where + ' addresses step ' + index + ' and the scenario ' +
        'has ' + stepCount + ' step(s)');
    }
  }

  if (declared === null || declared === undefined) {
    return;
  }

  if (typeof declared !== 'object' || Array.isArray(declared)) {
    throw new ToolError('the scenario ' + plan.id + ' declares an expectation ' +
      'that is not an object, so nothing about it can be evaluated');
  }

  Object.keys(declared).forEach(function(key) {
    if (EXPECTATION_KEYS.indexOf(key) === -1) {
      failures.push('the expectation carries the unknown key ' +
        JSON.stringify(key) + '; an expectation may carry ' +
        EXPECTATION_KEYS.join(', '));
    }
  });

  if (declared.description !== undefined && !text(declared.description)) {
    failures.push('`description` is not a non-empty string');
  }

  if (declared.steps !== undefined && !Array.isArray(declared.steps)) {
    failures.push('`steps` is not an array');
  }

  (Array.isArray(declared.steps) ? declared.steps : []).forEach(function(clause, position) {
    var where = 'clause ' + position;
    var operators = 0;

    if (!clause || typeof clause !== 'object' || Array.isArray(clause)) {
      failures.push(where + ' is not an object');
      return;
    }

    Object.keys(clause).forEach(function(key) {
      if (EXPECTATION_STEP_KEYS.indexOf(key) === -1) {
        failures.push(where + ' carries the unknown operator ' +
          JSON.stringify(key) + '; a step clause may carry ' +
          EXPECTATION_STEP_KEYS.join(', '));
        return;
      }

      if (key !== 'index') {
        operators++;
      }
    });

    addressable(clause.index, where);

    if (!operators) {
      failures.push(where + ' asserts nothing: it carries an index and no ' +
        'operator, so it would be counted as a declared check and evaluate ' +
        'to nothing');
    }

    if (clause.timedOut !== undefined && typeof clause.timedOut !== 'boolean') {
      failures.push(where + ' has a non-boolean `timedOut`');
    }

    if (clause.status !== undefined && !integer(clause.status)) {
      failures.push(where + ' has a non-integer `status`');
    }

    if (clause.notStatus !== undefined && !integer(clause.notStatus)) {
      failures.push(where + ' has a non-integer `notStatus`');
    }

    if (clause.statusIn !== undefined) {
      if (!Array.isArray(clause.statusIn) || !clause.statusIn.length) {
        failures.push(where + ' has a `statusIn` that is not a non-empty array');
      }
      else if (!clause.statusIn.every(integer)) {
        failures.push(where + ' has a `statusIn` holding a non-integer status');
      }
    }

    if (clause.locationEndsWith !== undefined && !text(clause.locationEndsWith)) {
      failures.push(where + ' has a `locationEndsWith` that is not a ' +
        'non-empty string');
    }

    if (clause.headerPresent !== undefined && !text(clause.headerPresent)) {
      failures.push(where + ' has a `headerPresent` that is not a non-empty ' +
        'header name');
    }

    if (clause.bodyIncludes !== undefined && !text(clause.bodyIncludes)) {
      failures.push(where + ' has a `bodyIncludes` that is not a non-empty ' +
        'string');
    }
  });

  if (declared.cross !== undefined) {
    if (!declared.cross || typeof declared.cross !== 'object' ||
        Array.isArray(declared.cross)) {
      failures.push('`cross` is not an object');
    }
    else {
      Object.keys(declared.cross).forEach(function(key) {
        var indexes = declared.cross[key];

        if (EXPECTATION_CROSS_KEYS.indexOf(key) === -1) {
          failures.push('`cross` carries the unknown comparison ' +
            JSON.stringify(key) + '; it may carry ' +
            EXPECTATION_CROSS_KEYS.join(', '));
          return;
        }

        if (!Array.isArray(indexes) || indexes.length < 2) {
          failures.push('`cross.' + key + '` is not an array of at least two ' +
            'step indexes');
          return;
        }

        indexes.forEach(function(index) {
          addressable(index, '`cross.' + key + '`');
        });
      });
    }
  }

  if (failures.length) {
    throw new ToolError('the scenario ' + plan.id + ' declares an expectation ' +
      'this file cannot evaluate, and a clause that cannot be evaluated must ' +
      'not be quietly skipped - it would read as a check and assert nothing:' +
      '\n  - ' + failures.join('\n  - ') + '\n' +
      'Every operator this file implements is listed in EXPECTATION_STEP_KEYS ' +
      'and EXPECTATION_CROSS_KEYS, and capture.js evaluates the same set ' +
      'against the recording. Fix the corpus, or implement the operator in ' +
      'both files.');
  }
}

/**
 * Evaluates a scenario's declared expectation against what was OBSERVED.
 *
 * This is a second, independent check beside the baseline comparison, and two
 * of its clauses cannot be replaced by that comparison because they compare two
 * steps TO EACH OTHER rather than to a recording. `cross.locationsEqual` is the
 * cross-request fail.redirect leak - both requests redirect to the first one's
 * interpolated target - and comparing the pair directly is what detects a build
 * that "fixed" it. `cross.bodiesDiffer` is the OAuth existing-user
 * differentiator: the two sign-in attempts must remain observably different
 * responses, and neither one's recorded body says that about the other.
 *
 * Every operator `assertExpectationSchema` accepts is evaluated here. That
 * correspondence is the contract between the two functions: the schema refuses
 * what this cannot check, so nothing declared is ever skipped.
 *
 * @param {Object} item the planned scenario
 * @param {Array.<Object>} observed one response record per step, in order
 * @returns {(Object|null)} {description, met, failures} or null when none was declared
 */
function evaluateExpectation(item, observed) {
  var declared = item.expectation;
  var failures = [];

  if (!declared) {
    return null;
  }

  (declared.steps || []).forEach(function(clause) {
    var record = observed[clause.index];
    var location;
    var headerName;
    var body;

    if (!record) {
      failures.push('step ' + clause.index + ' was not driven');
      return;
    }

    if (clause.timedOut !== undefined) {
      if (!!record.timedOut !== !!clause.timedOut) {
        failures.push('step ' + clause.index + ' expected timedOut=' +
          clause.timedOut + ' and observed timedOut=' + !!record.timedOut);
      }
    }

    if (clause.status !== undefined && record.status !== clause.status) {
      failures.push('step ' + clause.index + ' expected status ' +
        clause.status + ' and observed ' + describeStatus(record));
    }

    if (clause.statusIn !== undefined &&
        clause.statusIn.indexOf(record.status) === -1) {
      failures.push('step ' + clause.index + ' expected one of the statuses ' +
        clause.statusIn.join('/') + ' and observed ' + describeStatus(record));
    }

    if (clause.notStatus !== undefined && record.status === clause.notStatus) {
      failures.push('step ' + clause.index + ' expected any status other ' +
        'than ' + clause.notStatus + ' and observed it');
    }

    if (clause.locationEndsWith !== undefined) {
      location = String((record.headers && record.headers.location) || '');

      if (location.slice(-clause.locationEndsWith.length) !== clause.locationEndsWith) {
        failures.push('step ' + clause.index + ' expected a Location ending ' +
          JSON.stringify(clause.locationEndsWith) + ' and observed ' +
          JSON.stringify(location || '(none)'));
      }
    }

    if (clause.headerPresent !== undefined) {
      // The recorded header map is lowercased by `recordHeaders`, so the clause
      // is matched case-insensitively rather than requiring the corpus to know
      // that.
      headerName = String(clause.headerPresent).toLowerCase();

      if (!record.headers || record.headers[headerName] === undefined) {
        failures.push('step ' + clause.index + ' expected the ' + headerName +
          ' header to be present and it is not' +
          (record.timedOut ? ' (the request timed out)' : ''));
      }
    }

    if (clause.bodyIncludes !== undefined) {
      body = record.body;

      if (!body || typeof body.text !== 'string') {
        failures.push('step ' + clause.index + ' has no text body to search ' +
          'for ' + JSON.stringify(clause.bodyIncludes) +
          (body ? ' (the body was recorded as ' + body.encoding + ')' : ''));
      }
      else if (body.text.indexOf(clause.bodyIncludes) === -1) {
        failures.push('step ' + clause.index + ' expected its body to ' +
          'contain ' + JSON.stringify(clause.bodyIncludes) + ' and it does ' +
          'not' + (body.truncated
            ? ' (the body was truncated at ' + MAX_TEXT_BYTES + ' bytes, so ' +
              'the string may sit beyond the cut-off)'
            : ''));
      }
    }
  });

  if (declared.cross && Array.isArray(declared.cross.locationsEqual)) {
    failures = failures.concat(
      compareCrossLocations(declared.cross.locationsEqual, observed));
  }

  if (declared.cross && Array.isArray(declared.cross.bodiesDiffer)) {
    failures = failures.concat(
      compareCrossBodies(declared.cross.bodiesDiffer, observed));
  }

  return {
    description: declared.description || '(no description)',
    met: !failures.length,
    failures: failures
  };
}

/**
 * A status for a message, naming the outcome when there is no status.
 *
 * @param {(Object|null)} record
 * @returns {(number|string)}
 */
function describeStatus(record) {
  if (!record || record.status === null || record.status === undefined) {
    return outcomeOf(record);
  }

  return record.status;
}

/**
 * Checks that the named steps produced the SAME Location as each other.
 *
 * @param {Array.<number>} indexes
 * @param {Array.<Object>} observed
 * @returns {Array.<string>} failures
 */
function compareCrossLocations(indexes, observed) {
  var values = [];
  var failures = [];

  indexes.forEach(function(index) {
    var record = observed[index];

    values.push({
      index: index,
      value: record && record.headers
        ? String(record.headers.location || '(none)')
        : '(not driven)'
    });
  });

  values.forEach(function(entry) {
    if (entry.value !== values[0].value) {
      failures.push('step ' + values[0].index + ' redirected to ' +
        values[0].value + ' and step ' + entry.index + ' to ' + entry.value +
        '; the corpus declares these must be EQUAL, because both requests ' +
        'consume the target the first one interpolated. A build that sent ' +
        'them to different places fixed a documented quirk, which R-d ' +
        'prohibits.');
    }
  });

  return failures;
}

/**
 * Checks that the named steps produced OBSERVABLY DIFFERENT bodies.
 *
 * The OAuth differentiator. `quirk.oauth.existing-user-succeeds` drives the
 * same route twice, and the two attempts take different database branches - the
 * first creates the account and reports failure, the second finds it and can
 * succeed - so the two responses must remain distinguishable. Neither response's
 * own recording says that about the other, which is why this is a cross-step
 * comparison rather than a field comparison.
 *
 * The bodies are compared in their NORMALIZED form, and that is the whole
 * correctness of this check rather than a detail. Two consecutive requests
 * render two different `/cache-prefix-<epoch>/` values and, on the pages that
 * carry it, two different encrypted roles tokens, so comparing raw digests
 * would find every pair of HTML responses "different" and the check would pass
 * without ever looking at the branch it exists to distinguish. A binary body
 * has no text form and falls back to its digest, which for a binary response is
 * exactly comparable.
 *
 * @param {Array.<number>} indexes
 * @param {Array.<Object>} observed
 * @returns {Array.<string>} failures
 */
function compareCrossBodies(indexes, observed) {
  var failures = [];
  var values = [];

  indexes.forEach(function(index) {
    var record = observed[index];
    var body = record ? record.body : null;

    if (!record) {
      values.push({ index: index, comparable: false, reason: 'not driven' });
      return;
    }

    if (record.timedOut) {
      values.push({ index: index, comparable: false, reason: 'timed out' });
      return;
    }

    if (!body) {
      values.push({ index: index, comparable: false, reason: 'no body was recorded' });
      return;
    }

    values.push({
      index: index,
      comparable: true,
      form: typeof body.text === 'string' ? 'normalized text' : 'digest',
      value: typeof body.text === 'string'
        ? normalized(body.text)
        : String(body.digest),
      length: body.length
    });
  });

  values.forEach(function(entry) {
    if (!entry.comparable) {
      failures.push('the body pair could not be compared because step ' +
        entry.index + ' ' + entry.reason);
    }
  });

  if (failures.length) {
    return failures;
  }

  values.forEach(function(entry, position) {
    if (position === 0) {
      return;
    }

    if (entry.value === values[0].value) {
      failures.push('step ' + values[0].index + ' and step ' + entry.index +
        ' returned the SAME body (compared as ' + entry.form + ', ' +
        entry.length + ' bytes), and the corpus declares they must differ: ' +
        'the two requests take different branches and the responses were ' +
        'observably different at baseline. Either the branch this scenario ' +
        'exists to exercise is no longer reached, or the two responses now ' +
        'differ only in a value inside the volatile set - a minted id or a ' +
        'clock read - which is not a difference in behaviour and cannot ' +
        'stand as the differentiator. Both are findings; the second one is ' +
        'answered by giving the scenario a stronger differentiator in the ' +
        'corpus.');
    }
  });

  return failures;
}

// ---------------------------------------------------------------------------
// The approved deviations: the closed register, and the verifier that reads it
// ---------------------------------------------------------------------------

/**
 * The register of approved, replay-visible deviations, keyed by scenario id.
 *
 * This is an ALLOWLIST, not a pattern, and that is the whole point of it. The
 * register is closed - `docs/preserved-quirks.md` §11.0: "Exactly two
 * deviations are approved. This section is the whole list, and it is not
 * extensible by a tool." - and only ONE of the two is replay-visible.
 * Deviation 2, the retained `marked` fork, carries no scenario id at all
 * because it changes no response: it is a departure from the audit TARGET
 * measured by `npm audit`, not by a replay diff. So there is exactly one id a
 * marker on a scenario can ever be justified by, and every other id is drift.
 *
 * Keying the contract by id rather than matching a marker's own claim is what
 * keeps this tool from minting deviations for itself. A verifier that approves
 * whatever calls itself approved defeats R-d, which is the one prohibition the
 * quirk catalogue exists to enforce, and it is reachable in practice rather
 * than in theory: markers arrive from an external `--annotations` file as well
 * as from the corpus, so "today's corpus carries only the canonical marker" is
 * a fact about today's corpus and not a property of the check.
 *
 * Each entry is FIELD-COMPLETE - the five fields §11.0 names - and each is
 * derived from the seeded fixture rather than restated, so an assertion cannot
 * drift from the object the scenario actually downloads: the legacy File
 * document carries this mime and this byte count, and the image branch of the
 * download deliberately omits Content-Disposition where its sibling four lines
 * below sets one.
 *
 * Adding a future approved deviation is one entry here, carrying its own field
 * contract. Nothing else in this file needs to know about it - and adding one
 * without the argument in §11.0 behind it is the thing this structure exists
 * to make visible.
 *
 * @returns {Object} a frozen map of scenario id to frozen contract
 */
function approvedDeviationRegister() {
  var legacy = (seed.fixtures && seed.fixtures.bytes && seed.fixtures.bytes.legacyPng) || {};
  var register = {};

  // Deviation 1: the never-settling image-download response is served.
  // AAP §0.7 and docs/preserved-quirks.md §11.1.
  register[DEVIATION_SCENARIO_ID] = Object.freeze({
    scenarioId: DEVIATION_SCENARIO_ID,
    number: 1,
    summary: 'the never-settling image-download response is served',
    approvedIn: 'AAP §0.7',
    describedIn: 'docs/preserved-quirks.md §11.1',
    fromOutcome: OUTCOME_TIMED_OUT,
    toOutcome: OUTCOME_ANSWERED,
    status: 200,
    contentType: legacy.mime || null,
    bodyLength: legacy.size === undefined ? null : legacy.size,
    absentHeaders: Object.freeze(['content-disposition'])
  });

  return Object.freeze(register);
}

var APPROVED_DEVIATIONS = approvedDeviationRegister();

// The allowlisted ids, in registration order, for the messages that have to
// name what IS allowed beside what was rejected.
var APPROVED_DEVIATION_IDS = Object.freeze(Object.keys(APPROVED_DEVIATIONS));

/**
 * The contract for a scenario id, or null when the id is not allowlisted.
 *
 * `hasOwnProperty` rather than a bare property read, because the id arrives
 * from a corpus or an annotations file - which is to say from outside this
 * process - and a scenario called `constructor` or `toString` must resolve to
 * "not on the allowlist" rather than to something inherited from
 * Object.prototype.
 *
 * @param {*} scenarioId
 * @returns {(Object|null)}
 */
function approvedDeviationContract(scenarioId) {
  if (typeof scenarioId !== 'string') {
    return null;
  }

  return Object.prototype.hasOwnProperty.call(APPROVED_DEVIATIONS, scenarioId)
    ? APPROVED_DEVIATIONS[scenarioId]
    : null;
}

// Deviation 1's contract under its own name, because it is the one the report
// and the gates refer to directly. Derived from the register rather than built
// beside it, so the two cannot disagree.
var APPROVED_DEVIATION = APPROVED_DEVIATIONS[DEVIATION_SCENARIO_ID];

/**
 * Verifies that an approved deviation materialized AS APPROVED.
 *
 * Two independent questions, in this order, and the first one is about
 * IDENTITY rather than about the change. A marker is not a licence for any
 * change at all, and it is not a licence held by whichever scenario carries
 * it: the approval attaches to a named scenario id in the closed register
 * `approvedDeviationRegister` holds, so an id that register does not name is
 * unapproved drift no matter how well-formed its marker looks. That is why the
 * lookup below fails closed rather than falling back to "approved but not
 * verified" - a verifier able to approve an id nobody argued for is a tool
 * minting its own deviations, which defeats R-d.
 *
 * For an allowlisted id the question becomes the shape of the change. The
 * deviation was approved to be one specific response - AAP §0.7: "a 200 stream
 * response carrying the file's own mime type and byte length, and NO
 * Content-Disposition" - so a scenario that changed differently is a failure
 * that happens to carry a marker, and a scenario whose change did not happen
 * at all is a failure too: R-b requires the route to serve, and a marker on a
 * route that still hangs would let the whole point of the deviation go
 * unnoticed.
 *
 * `approved: true` is reachable only for an allowlisted id that satisfied its
 * contract field by field.
 *
 * @param {Object} item the planned scenario
 * @param {Array.<Object>} observed one response record per step
 * @param {Array.<Object>} differences the differences found against baseline
 * @returns {Object} {approved, verified, failures, described}
 */
function verifyApprovedDeviation(item, observed, differences) {
  var marker = item.expectedDeviation;
  var contract = approvedDeviationContract(item.id);
  var record = observed[0] || null;
  var baselineStep = (item.steps || [])[0] || null;
  var recordedBaseline = outcomeOf(baselineStep && baselineStep.baseline);
  var failures = [];
  var contentType;

  if (!marker) {
    return { approved: false, verified: false, failures: [], described: null };
  }

  if (marker.replayDisposition !== 'approved-change') {
    failures.push('the marker declares replayDisposition ' +
      JSON.stringify(String(marker.replayDisposition)) + ', and this file ' +
      'only knows how to approve "approved-change"');
  }

  // Identity before shape. An id off the allowlist is rejected here and does
  // not reach the field checks, because there is no contract to check it
  // against - and inventing one from the marker's own prose is precisely the
  // laundering this branch exists to stop.
  if (!contract) {
    failures.push('the scenario id ' + JSON.stringify(String(item.id)) +
      ' is not on the approved-deviation allowlist, so its marker approves ' +
      'nothing. The deviation register is CLOSED at exactly two approved ' +
      'deviations (docs/preserved-quirks.md §11.0) and only ONE of them is ' +
      'replay-visible: ' + APPROVED_DEVIATION_IDS.join(', ') + '. Deviation ' +
      '2 - the retained `marked` fork - carries no scenario id at all, ' +
      'because it changes no response: it is a departure from the audit ' +
      'target measured by npm audit, not by a replay diff, so it can never ' +
      'justify a marker on any scenario. A marker on ' +
      JSON.stringify(String(item.id)) + ' is therefore unapproved drift ' +
      'wearing an approved label, and the difference it carries is ' +
      'UNAPPROVED. Markers reach this tool from an --annotations file as well ' +
      'as from the corpus, so a marker appearing here is not evidence that ' +
      'anyone approved it. If this change really is approved, argue it into ' +
      '§11.0 with its own precedence argument and add its field contract to ' +
      'the allowlist in this file - the register is not extensible by a tool.');

    return {
      approved: false,
      verified: true,
      failures: failures,
      described: marker.target || null
    };
  }

  // The from-outcome is checked FIRST among the shape questions, because it
  // decides whether the others are even meaningful. A corpus that already
  // records the DEVIATED behaviour was captured from a tree where the
  // deviation had landed, so it is not a baseline for this scenario, and
  // saying that once is more useful than also complaining that nothing
  // changed.
  if (recordedBaseline !== contract.fromOutcome) {
    failures.push('the recorded baseline for this scenario is ' +
      recordedBaseline + ', and the ' +
      'deviation was approved as a change FROM ' + contract.fromOutcome +
      '. This corpus therefore already records the deviated behaviour, which ' +
      'means it was captured from a tree where the change had landed - it is ' +
      'not a baseline for this scenario. Capture the baseline at the base ' +
      'commit, or drop --annotations if you are deliberately replaying a ' +
      'target-captured corpus against itself (--self-check does this for the ' +
      'whole run).');

    return {
      approved: false,
      verified: true,
      failures: failures,
      described: marker.target || null
    };
  }

  if (!differences.length) {
    failures.push('the approved deviation did NOT materialize: the target ' +
      'reproduced the baseline exactly. AAP §0.7 decided this collision in ' +
      'favour of the route serving, so a target that still behaves as the ' +
      'baseline did has not implemented the decision.');
  }

  if (outcomeOf(record) !== contract.toOutcome) {
    failures.push('the target outcome is ' + outcomeOf(record) +
      ', and the deviation was approved as a change to ' + contract.toOutcome);

    return {
      approved: false,
      verified: true,
      failures: failures,
      described: marker.target || null
    };
  }

  // ---------------------------------------------------------------------
  // The field checks, and the rule that makes them fail CLOSED
  // ---------------------------------------------------------------------
  // Every mandatory field is checked for PRESENCE before it is compared, and
  // an unobserved field is a failure rather than a skipped check.
  //
  // This is not defensive padding; it closes a hole this block used to have.
  // The byte-length comparison was written `contract.bodyLength !== null &&
  // record.body && record.body.length !== contract.bodyLength`, so a response
  // recorded with `body: null` - one the harness could not read, or a driver
  // that recorded headers but no payload - skipped the comparison entirely
  // and the scenario was APPROVED. Measured: the canonical id with a timeout
  // baseline, an answered `200 image/png` target and `body: null` returned
  // `approved: true` with zero failures, while a body of 68 bytes correctly
  // failed. An omission was therefore stronger evidence than a wrong value,
  // which is precisely backwards.
  //
  // The rule, stated once because it governs every registered deviation and
  // not just this one: a marker must never compensate for a missing
  // observation. The deviation was approved as ONE specific response, so a
  // field nobody measured is not that response, and `approved: true` may only
  // be reached when every mandatory field was observed AND matched.
  if (record.status !== contract.status) {
    failures.push('the approved response is ' + contract.status +
      ' and the target answered ' +
      (record.status === undefined || record.status === null
        ? 'no status at all (' + JSON.stringify(record.status) + '), so the ' +
          'status was not observed - an unobserved mandatory field is not a ' +
          'match'
        : String(record.status)));
  }

  if (!record.headers) {
    // Two mandatory fields are derived from the headers - the mime type and
    // the absence of content-disposition - so a record with no headers object
    // leaves both unverifiable. Reported once, here, rather than twice below.
    failures.push('the target record carries no headers, so neither the ' +
      'approved mime type ' + JSON.stringify(String(contract.contentType)) +
      ' nor the required absence of ' + contract.absentHeaders.join(', ') +
      ' could be verified. The deviation was approved as one specific ' +
      'response and an unobserved header set cannot be approved by the ' +
      'marker.');
  }
  else {
    contentType = typeWithoutCharset(record.headers['content-type']);

    if (contract.contentType && contentType !== contract.contentType) {
      failures.push('the approved response carries the file\'s own mime type ' +
        JSON.stringify(contract.contentType) + ' and the target sent ' +
        (contentType === null
          ? 'no content-type at all, so the mime type was not observed'
          : JSON.stringify(String(contentType))));
    }

    contract.absentHeaders.forEach(function(name) {
      if (record.headers[name] !== undefined) {
        failures.push('the approved response omits ' + name +
          ' - that omission is the purpose of the image branch, which renders ' +
          'inline rather than downloading - and the target sent ' +
          JSON.stringify(String(record.headers[name])));
      }
    });
  }

  if (contract.bodyLength !== null) {
    if (!record.body || typeof record.body.length !== 'number') {
      failures.push('the approved response carries the file\'s byte length ' +
        contract.bodyLength + ' and the target\'s body was not observed at ' +
        'all (' + JSON.stringify(record.body === undefined
          ? undefined
          : (record.body === null ? null : typeof record.body)) +
        '). An absent observation is not a match: a mandatory contract field ' +
        'that nobody measured cannot be approved by the marker.');
    }
    else if (record.body.length !== contract.bodyLength) {
      failures.push('the approved response carries the file\'s byte length ' +
        contract.bodyLength + ' and the target sent ' + record.body.length);
    }
  }

  return {
    approved: !failures.length,
    verified: true,
    failures: failures,
    described: marker.target || null
  };
}

// ---------------------------------------------------------------------------
// Coverage accounting
// ---------------------------------------------------------------------------

/**
 * Accounts every route in the manifest against the scenarios that were
 * replayed, and every scenario against the manifest.
 *
 * Coverage IS part of the gate. A replay that compared 380 scenarios cleanly
 * while never touching a route cannot support the claim that the surface was
 * verified, and the honest response is to fail rather than to report a pass
 * that overstates itself. An entry that genuinely cannot be driven is listed
 * with its stated reason - never silently omitted - which is the difference
 * between an explained gap and a hidden one.
 *
 * Success and failure paths are accounted separately, because one minimal
 * request per route exercises success paths only: R-e is about the error
 * mappings, and the changed-error-edge checklist in docs/error-edge-inventory.md
 * is what supplies the rest. A route with no failure-path scenario is reported
 * so the gap is visible, not failed - the corpus decides which routes have
 * error edges worth driving.
 *
 * @param {Array.<Object>} entries the manifest entries
 * @param {Array.<Object>} scenarios the planned scenarios, after replay
 * @returns {Object} the coverage document
 */
function accountCoverage(entries, scenarios) {
  var byRoute = {};
  var known = Object.create(null);
  var unknown = [];
  var unrepresented = [];
  var unreachable = [];
  var successOnly = [];
  var order = [];

  entries.forEach(function(entry) {
    var key = manifest.routeKey(entry.method, entry.path);

    known[key] = true;
    order.push(key);
    byRoute[key] = {
      method: entry.method,
      path: entry.path,
      handlerKind: entry.handlerKind,
      auth: entry.auth,
      scenarios: [],
      driven: 0,
      compared: 0,
      differing: 0,
      successPath: false,
      failurePath: false,
      unreachable: null
    };
  });

  scenarios.forEach(function(item) {
    item.covers.forEach(function(key) {
      var route = byRoute[key];

      if (!route) {
        if (unknown.indexOf(key) === -1) {
          unknown.push(key);
        }
        return;
      }

      route.scenarios.push(item.id);

      if (item.unreachableReason) {
        route.unreachable = { id: item.id, reason: item.unreachableReason };
        unreachable.push({
          route: key,
          id: item.id,
          reason: item.unreachableReason
        });
        return;
      }

      if (item.result && item.result.driven) {
        route.driven++;
      }

      if (item.result && item.result.compared) {
        route.compared++;
      }

      if (item.result && item.result.differences.length) {
        route.differing++;
      }

      if (isFailurePathScenario(item)) {
        route.failurePath = true;
      }
      else {
        route.successPath = true;
      }
    });
  });

  order.forEach(function(key) {
    var route = byRoute[key];

    if (!route.scenarios.length) {
      unrepresented.push(key);
      return;
    }

    if (!route.failurePath && !route.unreachable) {
      successOnly.push(key);
    }
  });

  return {
    routes: entries.length,
    represented: entries.length - unrepresented.length,
    unrepresented: unrepresented,
    unknownRoutes: unknown,
    unreachable: unreachable,
    successPathOnly: successOnly,
    byRoute: sortedKeys(byRoute)
  };
}

/**
 * Whether a scenario drives a failure path.
 *
 * Taken from the corpus's own declared intent and group rather than inferred
 * from a status, so the accounting says what the corpus MEANT to exercise. A
 * redirect is a success path: it is the route working.
 *
 * @param {Object} item
 * @returns {boolean}
 */
function isFailurePathScenario(item) {
  return item.intent === 'failure' ||
    item.intent === 'timeout' ||
    String(item.group).slice(0, 11) === 'error-edge.';
}

// ---------------------------------------------------------------------------
// The five auth-scheme outcomes
// ---------------------------------------------------------------------------

/**
 * Every outcome AAP §0.6.1 and §0.9.3 require to be asserted independently,
 * and the corpus scenario that is expected to assert each one.
 *
 * The list is here, closed and explicit, because the previous shape of this
 * check derived the set from whatever scenarios happened to be in the
 * `auth-outcome` group - so a group with four scenarios reported four out of
 * four and a group with one reported one out of one. Neither says anything
 * about the contract. With the required set named, a missing scenario is a
 * failure rather than a smaller denominator.
 *
 * @type {Array.<{id: string, outcome: string}>}
 */
var REQUIRED_AUTH_OUTCOMES = [
  { id: 'auth.outcome.not-logged-in',   outcome: 'no userId in the session -> "Not logged in"' },
  { id: 'auth.outcome.valid-user',      outcome: 'a valid user -> h.authenticated' },
  { id: 'auth.outcome.user-not-found',  outcome: 'a session whose record is gone -> session cleared, "User not found"' },
  { id: 'auth.outcome.account-disabled',outcome: 'a disabled user -> session cleared, "Account disabled"' },
  { id: 'auth.outcome.lookup-error',    outcome: 'the lookup itself fails -> "Auth error"' }
];

/**
 * The outcomes permitted to go undriven, keyed by scenario id.
 *
 * DELIBERATELY EMPTY. It exists so that the decision to stop driving one of the
 * five is a code change in this file carrying the AAP section that allows it,
 * reviewed like any other, rather than a sentence written into an artifact by
 * the tool that produces the artifact. That is exactly how the fifth outcome
 * came to be reported as asserted while nothing drove it: the corpus said it
 * was unreachable and cited an injector that did not exist, and this check took
 * the corpus's word for it.
 *
 * An entry must carry `{reason, aap}` - what makes the outcome undrivable, and
 * the section that permits leaving it so. Nothing else counts.
 *
 * @type {Object.<string, {reason: string, aap: string}>}
 */
var AUTH_OUTCOMES_EXEMPT_FROM_DRIVING = {};

/**
 * Asserts the five outcomes of the session auth scheme, each independently.
 *
 * The scheme has five distinct outcomes and they are asserted one by one rather
 * than through an aggregate, because an aggregate cannot tell a missing-record
 * refusal from a disabled-account refusal - both are 401-shaped, and only the
 * message and the session clearing distinguish them.
 *
 * ALL FIVE ARE DRIVEN. That is a change from an earlier shape of this check,
 * and the reason it changed is worth stating because it is the failure mode the
 * check now exists to prevent. The fifth outcome - 'Auth error', which needs
 * the `User` lookup ITSELF to fail - was accepted here as "not reachable over
 * HTTP" on the strength of a `unreachableReason` string, and the only thing the
 * check required of it was that the string be non-empty. It counted toward
 * `asserted`. So the gate reported five outcomes asserted while driving four,
 * and the reason string pointed at a server-level injector that did not exist
 * anywhere in test/parity/. A stated reason is a description of a gap; it is
 * not an assertion, and it must not be counted as one.
 *
 * fixtures/model.js is now that injector, and `auth.outcome.lookup-error`
 * drives the outcome for real. So an unreachable entry in this group is a
 * FAILURE unless its id appears in `AUTH_OUTCOMES_EXEMPT_FROM_DRIVING` - which
 * is empty, and which exists so that adding one takes a deliberate edit here
 * with an AAP citation rather than a sentence in an artifact.
 *
 * @param {Array.<Object>} scenarios the planned scenarios, after replay
 * @returns {Object} the check document
 */
function accountAuthOutcomes(scenarios, selectionComplete, evidence) {
  var outcomes = scenarios.filter(function(item) {
    return item.group === AUTH_OUTCOME_GROUP;
  });
  var present = Object.create(null);
  var entries = [];
  var failures = [];
  var asserted = 0;
  var missing;
  var drivenAndCompared = 0;

  outcomes.forEach(function(item) {
    present[item.id] = true;
  });

  missing = AUTH_OUTCOME_IDS.filter(function(id) {
    return !present[id];
  });

  if (!outcomes.length) {
    // A skipped check that reports ok is only honest for a NARROWED run, where
    // the group was deliberately outside the selection. Under a complete
    // selection an empty group means the five outcomes were never asserted, and
    // reporting that as a pass is exactly how a gate comes to certify nothing.
    return {
      name: 'auth-scheme outcomes',
      asserted: 0,
      minimum: AUTH_OUTCOME_IDS.length,
      required: AUTH_OUTCOME_IDS.slice(),
      missing: missing,
      ok: !selectionComplete,
      skipped: !selectionComplete,
      reason: selectionComplete
        ? null
        : 'no scenario in the ' + AUTH_OUTCOME_GROUP + ' group was selected ' +
          'by this narrowed run, so the outcomes were not exercised here and ' +
          'this run is not the gate',
      entries: entries,
      failures: selectionComplete
        ? ['not one of the ' + AUTH_OUTCOME_IDS.length + ' auth-scheme ' +
           'outcomes was exercised, although this run replayed the whole ' +
           'corpus. AAP §0.9.3 requires all five independently: ' +
           AUTH_OUTCOME_IDS.join(', ')]
        : []
    };
  }

  if (selectionComplete && missing.length) {
    failures.push(missing.length + ' of the ' + AUTH_OUTCOME_IDS.length +
      ' auth-scheme outcomes have no scenario in this replay: ' +
      missing.join(', ') + '. AAP §0.9.3 requires each independently, ' +
      'because an aggregate cannot tell a missing-record refusal from a ' +
      'disabled-account refusal - both are 401-shaped, and only the message ' +
      'and the session clearing distinguish them.');
  }

  outcomes.forEach(function(item) {
    present[item.id] = item;
  });

  REQUIRED_AUTH_OUTCOMES.forEach(function(required) {
    var item = present[required.id];
    var exempt = AUTH_OUTCOMES_EXEMPT_FROM_DRIVING[required.id] || null;
    var entry;

    if (!item) {
      // The whole point of the required list: on a COMPLETE run a scenario that
      // is simply absent used to shrink the denominator instead of failing the
      // check. On a narrowed run it is absent because the filter excluded it,
      // which is what `--only` is for - and such a run is already labelled
      // gateQualifying: false, so it cannot stand as the gate whatever this
      // check says about it.
      entries.push({
        id: required.id,
        outcome: required.outcome,
        present: false,
        filteredOut: !selectionComplete,
        driven: false,
        compared: false,
        asserted: false,
        differences: 0,
        expectation: null
      });

      if (selectionComplete) {
        failures.push(required.id + ' is not in the corpus, so the auth ' +
          'outcome "' + required.outcome + '" is not asserted by anything');
      }

      return;
    }

    entry = {
      id: item.id,
      outcome: required.outcome,
      present: true,
      route: item.routeKey,
      identity: item.identity,
      description: describeScenario(item),
      steps: item.steps ? item.steps.length : 0,
      // An `unreachableReason` is reported so a reviewer can see the claim, but
      // it no longer excuses anything on its own.
      unreachableReason: item.unreachableReason || null,
      exempt: exempt,
      driven: !!(item.result && item.result.driven),
      compared: !!(item.result && item.result.compared),
      asserted: false,
      differences: item.result ? item.result.differences.length : 0,
      expectation: item.result ? item.result.expectation : null,
      armedSteps: (item.steps || []).filter(function(step) {
        return step && step.modelFault;
      }).length,
      // The document ids the armed steps name, so the evidence can be
      // reconciled against the intended lookup rather than against any fault.
      armedIds: (item.steps || []).filter(function(step) {
        return step && step.modelFault && step.modelFault.id;
      }).map(function(step) {
        return String(step.modelFault.id);
      }),
      faultCheck: null
    };

    entry.faultCheck = checkInjectedFaults(entry, evidence);

    entries.push(entry);

    if (!entry.driven) {
      if (exempt) {
        // The only way an outcome escapes being driven, and it takes an edit to
        // the table below with the AAP section that permits it.
        note(required.id + ' is exempt from being driven: ' + exempt.reason +
          ' (' + exempt.aap + ')');
        return;
      }

      failures.push(required.id + ' was not driven, so the auth outcome "' +
        required.outcome + '" was not asserted. ' +
        (entry.unreachableReason
          ? 'It carries an unreachableReason - "' +
            String(entry.unreachableReason).slice(0, 120) +
            '" - and that is a description of the gap, not an assertion: an ' +
            'outcome AAP 0.9.3 requires is either driven or exempted in ' +
            'AUTH_OUTCOMES_EXEMPT_FROM_DRIVING with the section that permits it.'
          : 'It has ' + entry.steps + ' step(s) and produced no result.'));
      return;
    }

    if (!entry.compared) {
      failures.push(required.id + ' was driven but has no recorded baseline to ' +
        'be compared against, so nothing establishes that this outcome is ' +
        'unchanged');
      return;
    }

    drivenAndCompared++;

    if (entry.differences) {
      failures.push(required.id + ' differs from its baseline in ' +
        entry.differences + ' field(s), so this auth outcome changed');
      return;
    }

    if (!entry.expectation) {
      failures.push(required.id + ' carries no declared expectation, so the ' +
        'only thing checked was that it matched its baseline - which a ' +
        'baseline captured from the same defect would also do');
      return;
    }

    if (!entry.expectation.met) {
      failures.push(required.id + ' did not meet its declared expectation: ' +
        entry.expectation.failures.join('; '));
      return;
    }

    if (entry.faultCheck && !entry.faultCheck.ok) {
      failures.push(required.id + ' met its expectation but its injected ' +
        'fault evidence does not support it: ' + entry.faultCheck.reason);
      return;
    }

    entry.asserted = true;
    asserted = asserted + 1;
  });

  outcomes.forEach(function(item) {
    var known = REQUIRED_AUTH_OUTCOMES.some(function(required) {
      return required.id === item.id;
    });

    if (!known) {
      // Not a failure - extra coverage of this scheme is welcome - but it is
      // reported, so that a scenario renamed out of the required set cannot
      // quietly become "an extra" while its outcome goes unasserted.
      entries.push({
        id: item.id,
        outcome: 'not one of the five required outcomes',
        present: true,
        driven: !!(item.result && item.result.driven),
        compared: !!(item.result && item.result.compared),
        asserted: false,
        differences: item.result ? item.result.differences.length : 0,
        expectation: item.result ? item.result.expectation : null
      });
    }
  });

  // Four of the five are reachable over HTTP, so four is the floor for a
  // complete run. Without it, a corpus that had lost three outcome scenarios
  // would report "2 asserted, ok" - a true statement about a gate that is no
  // longer the gate.
  if (selectionComplete && drivenAndCompared < MIN_AUTH_OUTCOMES_DRIVEN) {
    failures.push('only ' + drivenAndCompared + ' auth-scheme outcome(s) were ' +
      'driven and compared, and ' + MIN_AUTH_OUTCOMES_DRIVEN + ' of the ' +
      AUTH_OUTCOME_IDS.length + ' are reachable over HTTP. The fifth needs ' +
      'the user lookup itself to fail, which no request can cause, so it ' +
      'carries a stated reason and is asserted by the server-level gate that ' +
      'can inject the fault.');
  }

  return {
    name: 'auth-scheme outcomes',
    // `asserted` is the STRICT count - an outcome driven, compared, matching
    // its baseline, and meeting its declared expectation - and `exercised`
    // counts the ones driven and compared at all. These were one number
    // before, and that is how four could read as five. `accountedFor` is how
    // many the closed list resolved to a scenario, which is a different
    // statement again, and none of the three is a substitute for another.
    // `unexercised` names each gap, and `auth-outcomes-exercised` in
    // `qualifyGate` refuses gate status while the list is non-empty - so the
    // fifth outcome, which needs the user lookup itself to reject and
    // therefore needs a fault injector no HTTP request can stand in for,
    // blocks the gate instead of passing inside a count of five.
    asserted: asserted,
    accountedFor: entries.length,
    exercised: drivenAndCompared,
    minimum: AUTH_OUTCOME_IDS.length,
    required: AUTH_OUTCOME_IDS.slice(),
    missing: missing,
    unexercised: entries.filter(function(entry) {
      return !(entry.driven && entry.compared);
    }).map(function(entry) {
      return {
        id: entry.id,
        reason: entry.reason ||
          (entry.driven ? 'driven with no recorded baseline' : 'not driven')
      };
    }),
    drivenAndCompared: drivenAndCompared,
    ok: !failures.length,
    skipped: false,
    reason: null,
    entries: entries,
    failures: failures
  };
}

/**
 * Reconciles an auth-outcome scenario's armed steps against what was faulted.
 *
 * The expectation alone is not sufficient evidence, and the gap is not
 * hypothetical: a `302 /login` is what outcomes 2 and 3 produce as well, and a
 * step whose fault silently failed to arm would drive an ordinary
 * authenticated request. It would then either pass the expectation for the
 * wrong reason or report a difference against the application for a fault the
 * harness never injected. So a scenario that declares armed steps must have
 * the fixture's own record of the same number of faults, on the id it armed.
 *
 * A scenario with no armed steps is not checked - four of the five outcomes are
 * reachable without a fault and must stay that way. Absent evidence is reported
 * as not-ok rather than waved through: "no fault was injected" and "the record
 * of the injection could not be read" are different findings, and neither
 * supports the claim.
 *
 * @param {Object} entry The per-outcome entry under construction.
 * @param {(Object|null)} evidence The pass's collected evidence.
 * @returns {(Object|null)} {ok, reason, expected, observed} or null when N/A.
 */
function checkInjectedFaults(entry, evidence) {
  var record = evidence && evidence.modelFault ? evidence.modelFault : null;
  var expectedId;
  var observedForId;

  if (!entry.armedSteps) {
    return null;
  }

  if (!record) {
    return {
      ok: false,
      reason: 'the scenario arms ' + entry.armedSteps + ' model-boundary ' +
        'fault(s), and this pass collected no fault evidence at all, so ' +
        'nothing establishes that any of them was injected',
      expected: entry.armedSteps,
      observed: null
    };
  }

  if (!record.available) {
    return {
      ok: false,
      reason: 'the scenario arms ' + entry.armedSteps + ' model-boundary ' +
        'fault(s) and the fixture\'s evidence log could not be read (' +
        (record.reason || 'no reason given') + '), so whether they were ' +
        'injected is unknown rather than confirmed',
      expected: entry.armedSteps,
      observed: null
    };
  }

  if (record.faulted < entry.armedSteps) {
    return {
      ok: false,
      reason: 'the scenario arms ' + entry.armedSteps + ' model-boundary ' +
        'fault(s) and the fixture recorded ' + record.faulted + '. A step ' +
        'whose fault did not arm drove an ordinary request, so its result ' +
        'says nothing about the outcome under test',
      expected: entry.armedSteps,
      observed: record.faulted
    };
  }

  // The id every armed step names. A single scenario arming two different
  // documents would be a scenario doing two things, so the first is the one
  // reconciled and a divergence is reported rather than averaged.
  expectedId = null;
  (entry.armedIds || []).forEach(function(id) {
    if (expectedId === null) {
      expectedId = id;
    }
  });

  if (expectedId !== null && record.byId) {
    observedForId = record.byId[expectedId] || 0;

    if (observedForId < entry.armedSteps) {
      return {
        ok: false,
        reason: 'the scenario arms ' + entry.armedSteps + ' fault(s) on id ' +
          expectedId + ' and the fixture recorded ' + observedForId +
          ' fault(s) on that id (' + record.faulted + ' in total), so the ' +
          'faults that were injected were not the ones this scenario armed',
        expected: entry.armedSteps,
        observed: observedForId
      };
    }
  }

  return {
    ok: true,
    reason: null,
    expected: entry.armedSteps,
    observed: record.faulted
  };
}

/**
 * A one-line description of a scenario, from its own declarations.
 *
 * @param {Object} item
 * @returns {string}
 */
function describeScenario(item) {
  if (item.expectation && item.expectation.description) {
    return item.expectation.description;
  }

  if (item.notes && item.notes.length) {
    return String(item.notes[0]);
  }

  return item.intent + ' on ' + item.routeKey + ' as ' + item.identity;
}

// ---------------------------------------------------------------------------
// The remaining named checks
// ---------------------------------------------------------------------------

/**
 * Asserts that the four header-resolved reply chains are UNCHANGED.
 *
 * These four are the collateral-damage guard on the AAP §0.7 decision. Each
 * continues to `.header(...)`, which settled the deferred response at baseline,
 * so each returned a real response then and must return the identical one now.
 * The never-settling chain four lines above one of them was deliberately
 * changed; these were not, they carry no marker, and a difference in any of
 * them means the decision reached further than it was approved to.
 *
 * @param {Array.<Object>} scenarios
 * @returns {Object} the check document
 */
function accountHeaderResolvedChains(scenarios, selectionComplete) {
  var chains = scenarios.filter(function(item) {
    return item.group === HEADER_RESOLVED_GROUP;
  });
  var failures = [];
  var entries = [];

  // The count is part of the assertion. AAP §0.6.6 enumerates four chains, and
  // a run that checked three of them left one unlooked-at while reporting a
  // pass - which is precisely the collateral damage this check exists to catch.
  if (selectionComplete && chains.length !== HEADER_RESOLVED_CHAIN_COUNT) {
    failures.push(chains.length + ' scenario(s) in the ' +
      HEADER_RESOLVED_GROUP + ' group were replayed and AAP §0.6.6 ' +
      'enumerates ' + HEADER_RESOLVED_CHAIN_COUNT + ' header-resolved reply ' +
      'chains (files.js:102-105, courses.js:269-272, trinket.js:1383-1386 and ' +
      'trinket.js:1548-1551). A chain with no scenario is a chain nobody ' +
      'checked, and these four were NOT approved to change.');
  }

  chains.forEach(function(item) {
    var differences = item.result ? item.result.differences.length : 0;

    entries.push({
      id: item.id,
      route: item.routeKey,
      differences: differences,
      driven: !!(item.result && item.result.driven),
      compared: !!(item.result && item.result.compared),
      marked: !!item.expectedDeviation
    });

    if (item.expectedDeviation) {
      failures.push(item.id + ' carries an expectedDeviation marker. These ' +
        'four chains were NOT approved to change - only the never-settling ' +
        'one was - so a marker here would launder exactly the collateral ' +
        'damage this check exists to catch.');
    }

    // Driven AND compared, both required. "Unchanged" is a claim about a
    // response, so a chain that was never driven supports no claim at all -
    // and a check that counted four records while none of them ran would
    // report the strongest sentence in this file about the weakest evidence.
    if (!(item.result && item.result.driven)) {
      failures.push(item.id + ' was not driven, so "unchanged" was not ' +
        'established for this chain. These four are the collateral-damage ' +
        'guard on the AAP §0.7 decision and a chain nobody drove is a chain ' +
        'nobody checked.');
    }
    else if (!item.result.compared) {
      failures.push(item.id + ' has no recorded baseline, so "unchanged" ' +
        'could not be established');
    }

    if (differences) {
      failures.push(item.id + ' differs from its baseline in ' + differences +
        ' field(s)');
    }
  });

  return {
    name: 'header-resolved reply chains unchanged',
    asserted: entries.length,
    minimum: HEADER_RESOLVED_CHAIN_COUNT,
    ok: !failures.length,
    skipped: !chains.length && !selectionComplete,
    reason: chains.length || selectionComplete
      ? null
      : 'no scenario in the ' + HEADER_RESOLVED_GROUP + ' group was selected ' +
        'by this narrowed run',
    entries: entries,
    failures: failures
  };
}

/**
 * Asserts that guest browsing still works on the routes that inherit the
 * default auth mode.
 *
 * The default strategy runs in `try` mode, which is why 126 of the 233 routes
 * carry no explicit auth and why an unauthenticated request to them is served
 * rather than refused. The assertion is framed against the BASELINE rather than
 * against 401 outright, because a handful of those routes legitimately refuse
 * an anonymous caller through their own logic, and R-d protects that too: what
 * must not happen is a route that served a guest at baseline refusing one now.
 *
 * @param {Array.<Object>} entries manifest entries
 * @param {Array.<Object>} scenarios
 * @returns {Object} the check document
 */
function accountGuestBrowsing(entries, scenarios, selectionComplete) {
  var inherited = Object.create(null);
  var failures = [];
  var checked = 0;
  var eligible = 0;
  var refusedNow = [];

  entries.forEach(function(entry) {
    if (entry.auth && entry.auth.inherited) {
      inherited[manifest.routeKey(entry.method, entry.path)] = true;
    }
  });

  scenarios.forEach(function(item) {
    var observed;
    var baseline;

    if (item.identity !== IDENTITY_ANONYMOUS || !inherited[item.routeKey]) {
      return;
    }

    // The eligible population, counted from the plan and the manifest rather
    // than from what happened to be compared. It is what turns "0 asserted,
    // ok" into a failure: this run selected anonymous scenarios on
    // auth-inheriting routes, and if none of them reached a comparison then
    // guest browsing was not checked at all.
    if (item.steps.length) {
      eligible++;
    }

    if (!item.result || !item.result.compared || !item.result.steps.length) {
      return;
    }

    observed = item.result.steps[0].observed;
    baseline = item.steps[0] ? item.steps[0].baseline : null;

    if (!observed || !baseline) {
      return;
    }

    checked++;

    if (observed.status === 401 && baseline.status !== 401) {
      refusedNow.push(item.id + ' (' + item.routeKey + ')');
      failures.push(item.id + ' on ' + item.routeKey + ' answered 401 to an ' +
        'anonymous request where the baseline answered ' + baseline.status +
        '. The default strategy runs in try mode, so guest browsing on an ' +
        'auth-inheriting route is preserved behaviour.');
    }
  });

  if (!checked && eligible) {
    failures.push(eligible + ' anonymous scenario(s) on auth-inheriting ' +
      'routes were selected and not one of them reached a comparison, so ' +
      'guest browsing was not checked. The default strategy runs in try mode, ' +
      'which is why 126 of the 233 routes carry no explicit auth and why an ' +
      'unauthenticated request to them is served rather than refused - if ' +
      'that stopped being true, this check is what would have said so.');
  }

  if (!checked && !eligible && selectionComplete) {
    failures.push('this run replayed the whole corpus and found no anonymous ' +
      'scenario on any auth-inheriting route, so guest browsing has no ' +
      'coverage at all. 126 of the 233 routes inherit the default try-mode ' +
      'strategy.');
  }

  return {
    name: 'guest browsing on auth-inheriting routes',
    asserted: checked,
    eligible: eligible,
    minimum: eligible ? 1 : 0,
    ok: !failures.length,
    skipped: !checked && !eligible && !selectionComplete,
    reason: checked
      ? null
      : 'no anonymous scenario on an auth-inheriting route was compared in ' +
        'this run',
    entries: refusedNow,
    failures: failures
  };
}

/**
 * Asserts that each scenario's fixture profile was actually IN FORCE, rather
 * than assuming that writing it was enough.
 *
 * Two independent pieces of evidence, because either alone is weak. The profile
 * file is read back after it is written, which proves the channel the fixture
 * re-reads on every intercepted call carries the right name. And for a scenario
 * that actually crossed the module boundary, the fixture's own JSONL evidence
 * log records the profile it served under, so the records appended DURING the
 * scenario are checked to carry that profile. A mismatch in either invalidates
 * the comparison - the response would have been produced under a different
 * external outcome than the recorded one - so it is a failure, not a note.
 *
 * @param {Array.<Object>} scenarios
 * @returns {Object} the check document
 */
function accountFixtureProfiles(scenarios, selectionComplete) {
  var failures = [];
  var entries = [];
  var checked = 0;
  var driven = 0;
  var declared = [];
  var confirmedProfiles = Object.create(null);
  var unconfirmed;

  scenarios.forEach(function(item) {
    if (declared.indexOf(item.fixtureProfile) === -1 && item.steps.length) {
      declared.push(item.fixtureProfile);
    }

    if (item.result && item.result.driven) {
      driven++;
    }
  });

  scenarios.forEach(function(item) {
    var evidence = item.result ? item.result.profileEvidence : null;

    if (!evidence) {
      return;
    }

    checked++;
    confirmedProfiles[item.fixtureProfile] = true;

    entries.push({
      id: item.id,
      profile: item.fixtureProfile,
      fileConfirmed: evidence.fileConfirmed,
      interceptedCalls: evidence.interceptedCalls,
      profileChanges: evidence.profileChanges,
      profilesSeen: evidence.profilesSeen
    });

    if (!evidence.fileConfirmed) {
      failures.push(item.id + ' requested the fixture profile ' +
        JSON.stringify(item.fixtureProfile) + ' but the profile file did not ' +
        'read back as that profile' +
        (evidence.fileReason ? ': ' + evidence.fileReason : ''));
    }

    evidence.profilesSeen.forEach(function(seen) {
      if (seen !== item.fixtureProfile) {
        failures.push(item.id + ' ran under the fixture profile ' +
          JSON.stringify(item.fixtureProfile) + ' but the fixture served an ' +
          'intercepted call under ' + JSON.stringify(seen) + ', so the ' +
          'external outcome behind this response was not the one the ' +
          'scenario declares');
      }
    });

    // The fixture's own adoption record. A change to a profile other than the
    // requested one means the file and the fixture disagree, which the
    // read-back alone cannot see.
    evidence.profileChangeMismatch.forEach(function(seen) {
      failures.push(item.id + ' requested the fixture profile ' +
        JSON.stringify(item.fixtureProfile) + ' but the fixture recorded ' +
        'adopting ' + JSON.stringify(seen));
    });
  });

  unconfirmed = declared.filter(function(profile) {
    return !confirmedProfiles[profile];
  });

  // Two cardinalities, and they catch different things. Every DRIVEN scenario
  // must carry profile evidence, because a response produced under an unknown
  // external outcome is not comparable against a recording made under a known
  // one. And every DECLARED profile must appear among the confirmed ones, which
  // is what catches the specific case of a provider-branch scenario - the
  // OAuth and asset-transport profiles - never reaching the fixture at all.
  if (checked !== driven) {
    failures.push(driven + ' scenario(s) were driven and ' + checked +
      ' carry fixture-profile evidence, so ' + (driven - checked) +
      ' response(s) were produced under an external outcome this run did not ' +
      'establish');
  }

  if (unconfirmed.length) {
    failures.push(unconfirmed.length + ' declared fixture profile(s) were ' +
      'never confirmed in force: ' + unconfirmed.join(', ') + '. A scenario ' +
      'exists to drive each of them, so an unconfirmed profile means that ' +
      'provider branch was not the one behind the response.');
  }

  if (!checked && selectionComplete) {
    failures.push('this run replayed the whole corpus and established no ' +
      'fixture profile at all, so no comparison in it rests on a known ' +
      'external outcome');
  }

  return {
    name: 'fixture profiles in force',
    asserted: checked,
    driven: driven,
    declaredProfiles: declared.slice().sort(),
    unconfirmedProfiles: unconfirmed,
    minimum: driven,
    ok: !failures.length,
    skipped: !checked && !driven && !selectionComplete,
    reason: checked ? null : 'no scenario was driven in this run',
    entries: entries,
    failures: failures
  };
}

/**
 * Scans the application child's captured stderr for notices.
 *
 * AAP §0.6.4's finding is the reason this belongs here rather than in a boot
 * check: two internal re-entrant injections put a deprecation on the LIVE
 * REQUEST PATH, and a boot that never serves a request never reveals them. A
 * full replay over the whole route surface is exactly the exercise that does,
 * so the stream is scanned here, and it is scanned on every run rather than
 * only when the deprecation flags were passed - a warning is a finding whether
 * or not anyone asked to see it.
 *
 * WHAT counts as a notice, WHICH flags the measurement requires, and the fact
 * that THERE ARE NO ALLOWANCES are all decided in test/parity/warning-policy.js
 * and are not restated here. Three consequences of using that policy rather
 * than a local predicate are worth naming, because each was a defect:
 *
 *   * the local predicate's `Warning:\b` alternative could never match - `:`
 *     and the space after it are both non-word characters - and it knew
 *     nothing of Mongoose's console.warn notices or the AWS SDK banner;
 *   * a stream measured WITHOUT --pending-deprecation is not evidence, because
 *     a pending deprecation is silent without it, so the flag audit is part of
 *     the check rather than a detail of the invocation;
 *   * a run against a worktree that is not this one is a MEASUREMENT of that
 *     tree - a baseline install legitimately emits the AWS notice, which only
 *     the target's config/aws.js suppresses - and is forced non-qualifying so
 *     it can never be presented as the gate.
 *
 * The breadth requirements AAP §0.9.3 puts on this exercise - all 233 routes,
 * more than one identity, methods beyond GET, and the worker - are added by
 * `qualifyWarningEvidence` once the pass has been accounted, because only then
 * is the coverage known.
 *
 * The `context` argument is what stops this from passing on nothing. A pass
 * that LAUNCHED the application and then produced no stderr to read, or drove
 * no scenario, has no warning evidence at all, and reporting that as "zero
 * warnings" would be a claim about a stream nobody looked at. The flags the
 * child actually received are recorded here too, because a scan taken without
 * `--pending-deprecation` sees a strictly smaller set of warnings than the gate
 * requires - that does not weaken this check, but it does mean the run is not
 * the gate, which `qualifyGate` enforces separately.
 *
 * @param {(string|null)} stderrPath
 * @param {Object} [context]
 * @param {Array.<string>} [context.nodeFlags] The flags the child was given.
 * @param {string} [context.appRoot] The tree that was served.
 * @returns {Object} the check document
 */
function accountWarnings(stderrPath, context) {
  var settings = context || {};
  // Rule 4 is decided by the policy, not here, so that all four gates treat a
  // foreign --app tree identically.
  var tree = warningPolicy.gateAppliesTo(settings.appRoot || null);
  var inputs = {
    // Everything `judge` needs, kept beside the check so that
    // `qualifyWarningEvidence` can re-judge the SAME evidence with this
    // exercise's breadth requirements added, rather than reconstructing the
    // inputs from the rendered check and getting one of them subtly wrong.
    notices: [],
    flags: warningPolicy.auditFlags(settings.nodeFlags || []),
    subject: 'the application\'s stderr over this pass',
    gateApplies: tree.applies,
    treeNote: tree.treeNote,
    launched: !!stderrPath,
    unlaunchedReason: 'the application was not launched by this run, so its ' +
      'captured stderr belongs to whoever started it, and this run cannot ' +
      'stand as the warning gate'
  };
  var check;
  var text;

  if (stderrPath) {
    try {
      text = fs.readFileSync(stderrPath, 'utf8');
    }
    catch (err) {
      check = warningPolicy.judge(inputs);
      check.ok = false;
      check.qualifying = false;
      check.failures = ['the captured stderr at ' + stderrPath + ' could not ' +
        'be read, so the warning gate could not be evaluated: ' + reasonOf(err)];
      check.stderrPath = stderrPath;
      check.evidenceInputs = inputs;
      check.unreadable = true;

      return check;
    }

    inputs.notices = warningPolicy.noticesFromText(text, {
      ignorePrefixes: [LOG_PREFIX],
      source: stderrPath
    });
  }

  check = warningPolicy.judge(inputs);
  check.stderrPath = stderrPath || null;
  check.evidenceInputs = inputs;

  return check;
}

/**
 * Adds this exercise's breadth requirements to the warning check.
 *
 * A clean stderr proves nothing about the routes nobody requested, and the
 * measurement that stood for this gate before was 137 anonymous GETs - the
 * mutating routes, the authenticated identities and the worker were never
 * exercised under the tracing flags at all. AAP §0.9.3 asks for the whole
 * surface, so each part of "the whole surface" is a named requirement here, and
 * an unmet one fails the check on the tree it gates rather than being noted.
 *
 * The requirements are deliberately about the DRIVEN scenarios, not the planned
 * ones: a scenario that never reached the application contributed nothing to
 * the stream being judged.
 *
 * @param {Object} check The document `accountWarnings` produced.
 * @param {Object} coverage The pass's coverage document.
 * @param {Array.<Object>} scenarios The planned scenarios, after replay.
 * @param {boolean} selectionComplete Whether every corpus scenario ran.
 * @param {Object} workerEvidence As `readWorkerEvidence` produced.
 * @returns {Object} the same check, re-judged with its requirements
 */
function qualifyWarningEvidence(check, coverage, scenarios, selectionComplete,
  workerEvidence) {
  var driven = scenarios.filter(function(item) {
    return item.result && item.result.driven;
  });
  var methods = {};
  var identities = {};
  var identifiedRoutes = {};
  var routesDriven = 0;
  var authRequired = 0;
  var authDriven = 0;
  var authMissing = [];
  var anonymousOnly;
  var requirements = [];
  var judged;

  driven.forEach(function(item) {
    var identified = isIdentified(item.identity);

    identities[String(item.identity)] = true;

    item.covers.forEach(function(key) {
      var entry = coverage.byRoute[key];

      if (!entry) {
        return;
      }

      methods[String(entry.method).toUpperCase()] = true;

      if (identified) {
        identifiedRoutes[key] = true;
      }
    });
  });

  anonymousOnly = !Object.keys(identities).some(isIdentified);

  Object.keys(coverage.byRoute).forEach(function(key) {
    if (coverage.byRoute[key].driven > 0) {
      routesDriven++;
    }
  });

  requirements.push(warningPolicy.requirement('whole-route-surface',
    selectionComplete && !coverage.unrepresented.length &&
      !coverage.unknownRoutes.length && routesDriven === coverage.routes,
    routesDriven + ' of ' + coverage.routes + ' manifest route(s) were ' +
    'actually driven in this pass' +
    (selectionComplete ? '' : ', and the selection was narrowed') +
    (coverage.unrepresented.length
      ? ', and ' + coverage.unrepresented.length + ' route(s) have no ' +
        'scenario at all'
      : '') +
    '. AAP 0.9.3 measures the warning gate over a full pass across all ' +
    coverage.routes + ' routes, and an unrequested route emits nothing.'));

  requirements.push(warningPolicy.requirement('methods-beyond-get',
    Object.keys(methods).some(function(method) {
      return method !== 'GET';
    }),
    'every driven scenario in this pass was a GET (' +
    Object.keys(methods).sort().join(', ') + '). A mutating handler is where ' +
    'the upload, archive and mail paths run, so a GET-only sweep leaves the ' +
    'code most likely to warn unmeasured.'));

  // Identity coverage is accounted PER ROUTE, not as a global count. A run that
  // drove one authenticated request anywhere and met a global "more than one
  // identity" test would leave every other session-required handler measured
  // only through its own 401, which is the branch that runs BEFORE the handler
  // and therefore emits nothing the handler would have emitted. So each route
  // whose effective auth mode is `required` must have been driven by a
  // non-anonymous identity, and the ones that were not are named.
  Object.keys(coverage.byRoute).forEach(function(key) {
    var entry = coverage.byRoute[key];
    var mode = entry.auth && entry.auth.mode;

    if (mode !== 'required') {
      return;
    }

    authRequired++;

    if (identifiedRoutes[key]) {
      authDriven++;
      return;
    }

    authMissing.push(key);
  });

  requirements.push(warningPolicy.requirement('identities-per-route',
    authRequired > 0 && !authMissing.length && anonymousOnly === false,
    (authRequired
      ? authDriven + ' of ' + authRequired + ' route(s) whose auth mode is ' +
        '`required` were driven by a non-anonymous identity' +
        (authMissing.length
          ? '; not driven under an identity: ' +
            authMissing.slice(0, 12).join(', ') +
            (authMissing.length > 12
              ? ' and ' + (authMissing.length - 12) + ' more'
              : '')
          : '')
      : 'no route whose auth mode is `required` appears in this coverage ' +
        'document at all, so the manifest and the pass disagree') +
    '. Identities seen: ' + (Object.keys(identities).sort().join(', ') ||
      '(none)') + '. An authenticated request reaches handlers a guest cannot, ' +
    'and a 401 is answered before the handler runs, so an anonymous-only ' +
    'sweep measures the refusal rather than the code.'));

  // Named for what it asserts - that the worker third of the exercise has
  // warning evidence AND that the evidence is clean - because all three ways it
  // can be unmet are different: no artifact was supplied, one was supplied but
  // produced without the flags, or one was supplied and carries notices. The
  // detail says which; a requirement called `worker-measured` would have read
  // as "unmeasured" in the third case, which is the one where it was measured
  // and failed.
  requirements.push(warningPolicy.requirement('worker-warning-evidence',
    workerEvidence.qualifying, workerEvidence.detail));

  if (check.unreadable) {
    // The stream could not be read at all. Re-judging would replace a stated
    // read failure with a clean verdict on an empty string, which is the one
    // outcome that must not happen here.
    check.requirements = requirements;
    check.workerEvidence = workerEvidence;
    delete check.evidenceInputs;

    return check;
  }

  judged = warningPolicy.judge(mergeEvidenceInputs(check.evidenceInputs, {
    requirements: requirements
  }));

  judged.stderrPath = check.stderrPath || null;
  judged.workerEvidence = workerEvidence;

  // The inputs were a carrier between the two judgements and are not part of
  // the record: everything they held - the notices, the flags, the tree - is on
  // the judged document already, and a second copy in the artifact would be one
  // more thing that can disagree with the first.
  return judged;
}

/**
 * Whether a scenario's identity is an authenticated one.
 *
 * The corpus names identities in words - `anonymous`, a seeded user, a seeded
 * admin - so anything that is not the anonymous one, and not an absent value
 * spelled as a word by `String()`, is an identity a session was established
 * for.
 *
 * @param {*} identity
 * @returns {boolean}
 */
function isIdentified(identity) {
  var name = String(identity);

  return name !== 'anonymous' && name !== 'null' && name !== 'undefined' &&
    name !== '';
}

/**
 * The evidence inputs plus one override, as a new object.
 *
 * A copy rather than a mutation, because the inputs are also the record of what
 * was measured and a second call must not see the first call's additions.
 *
 * @param {Object} inputs As `accountWarnings` stashed them.
 * @param {Object} extra
 * @returns {Object}
 */
function mergeEvidenceInputs(inputs, extra) {
  var merged = {};

  Object.keys(inputs || {}).forEach(function(key) {
    merged[key] = inputs[key];
  });

  Object.keys(extra || {}).forEach(function(key) {
    merged[key] = extra[key];
  });

  return merged;
}

/**
 * Reads the worker's warning evidence, if the caller supplied it.
 *
 * AAP §0.9.3's exercise is the server, the full route surface AND the
 * standalone worker. This file cannot drive the worker - the in-memory queue
 * lives in the process that registered the processor - so the worker's own
 * artifact is read instead of re-measured, and its absence is a stated
 * shortfall rather than a silent one.
 *
 * @param {(string|null)} target The path the caller passed, if any.
 * @returns {Object} `{supplied, qualifying, detail, path, summary}`
 */
function readWorkerEvidence(target) {
  var document;
  var warnings;
  var shortfalls;

  if (!target) {
    return {
      supplied: false,
      qualifying: false,
      path: null,
      summary: null,
      detail: 'the worker\'s warning evidence was not supplied. AAP 0.9.3 ' +
        'measures this gate over the listening server, the full route ' +
        'surface AND the standalone worker; this tool drives the first two. ' +
        'Run test/parity/worker.js under ' +
        warningPolicy.REQUIRED_FLAGS.join(' ') + ' and pass its --out ' +
        'artifact as --worker-evidence.'
    };
  }

  try {
    document = JSON.parse(fs.readFileSync(target, 'utf8'));
  }
  catch (err) {
    return {
      supplied: true,
      qualifying: false,
      path: target,
      summary: null,
      detail: 'the worker evidence at ' + target + ' could not be read: ' +
        reasonOf(err)
    };
  }

  warnings = document && document.warnings;

  if (!warnings || !warnings.flags) {
    return {
      supplied: true,
      qualifying: false,
      path: target,
      summary: null,
      detail: 'the worker evidence at ' + target + ' carries no warning ' +
        'section with a flag audit, so it cannot say what it measured. ' +
        'Regenerate it with a current test/parity/worker.js.'
    };
  }

  // Fail-closed, condition by condition, and the reason it is spelled out this
  // way is that a shorter test let a FAILED worker run satisfy this
  // requirement: an artifact with `verdict: "FAIL"`, complete flags and an
  // empty notice list is a worker that did not do its job while emitting
  // nothing, and AAP §0.9.3's worker third is not satisfied by silence. So the
  // artifact must be the current shape, measured under the flags, clean, AND a
  // run that actually completed its contract - which for test/parity/worker.js
  // means verdict PASS with no failed check and its jobs driven.
  shortfalls = [];

  if (warnings.policy !== warningPolicy.POLICY.id) {
    shortfalls.push('it was judged against policy ' +
      JSON.stringify(warnings.policy || null) + ' rather than ' +
      JSON.stringify(warningPolicy.POLICY.id) + ', so the two runs did not ' +
      'apply the same bar');
  }

  if (!warnings.flags.complete) {
    shortfalls.push('it was produced without ' +
      (warnings.flags.missing || []).join(' ') +
      ((warnings.flags.suppressors || []).length
        ? ' and with ' + warnings.flags.suppressors.join(' ')
        : '') +
      ', so it is not a measurement of the worker under the required flags');
  }

  if (warnings.ok === false || (warnings.failures || []).length) {
    shortfalls.push('its own warning gate did not pass');
  }

  if (warnings.qualifying === false) {
    shortfalls.push('it reports itself as not qualifying');
  }

  if ((warnings.notices || []).length) {
    shortfalls.push((warnings.notices || []).length + ' notice(s) were ' +
      'recorded by that run: ' +
      (warnings.notices || []).map(function(entry) {
        return entry && entry.summary ? entry.summary : String(entry);
      }).join(' | '));
  }

  if (document.verdict !== 'PASS') {
    shortfalls.push('its verdict is ' +
      JSON.stringify(document.verdict || null) + ' rather than "PASS", so the ' +
      'worker did not complete the contract AAP 0.9.3 requires of it - a ' +
      'blocked or failing worker run measures nothing about the worker path');
  }

  if (document.checks && (document.checks.failures || []).length) {
    shortfalls.push((document.checks.failures || []).length + ' of its ' +
      'checks failed: ' + (document.checks.failures || []).map(function(entry) {
        return entry && entry.name ? entry.name : String(entry);
      }).join(', '));
  }

  if (!(document.jobs || []).length) {
    shortfalls.push('it drove no job, so it exercised no worker code path');
  }

  return {
    supplied: true,
    qualifying: !shortfalls.length,
    path: target,
    summary: {
      verdict: document.verdict || null,
      policy: warnings.policy || null,
      flags: warnings.flags,
      jobs: (document.jobs || []).length,
      failedChecks: document.checks
        ? (document.checks.failures || []).length
        : null,
      notices: (warnings.notices || []).map(function(entry) {
        return entry && entry.summary ? entry.summary : String(entry);
      })
    },
    shortfalls: shortfalls,
    detail: shortfalls.length
      ? 'the worker evidence at ' + target + ' does not stand: ' +
        shortfalls.join('; ')
      : 'the worker evidence at ' + target + ' is clean under the required ' +
        'flags'
  };
}

/**
 * Asserts the route manifest IS the 233-entry surface, independently.
 *
 * Coverage accounting is only as good as the surface it is accounted against.
 * A manifest holding 200 entries would let a replay report "200 of 200 routes
 * represented" and pass, having never noticed the 33 routes nobody drove - and
 * printing the number in a header line, which is what this file used to do, is
 * not an assertion. So the cardinality is checked against the figure manifest.js
 * itself publishes (`manifest.EXPECTED.routes`, verified at 2f8712a and
 * re-measured on the target tree) rather than against a second copy of 233
 * kept here.
 *
 * Key equality is checked in both directions, ALWAYS: a manifest key with no
 * corpus entry is a route the corpus does not cover, and a corpus key with no
 * manifest entry is a scenario driving a route that no longer exists. The
 * corpus key set is read from its declared `coverage.byRoute` when it has one
 * and DERIVED from the scenarios themselves when it does not - every scenario
 * carries the routes it covers - so there is no shape of corpus for which this
 * comparison is skipped. It was skippable once, and a corpus without a coverage
 * block could then satisfy the gate having been compared key-for-key against
 * nothing.
 *
 * `accountCoverage` catches the same drift for the SELECTED scenarios; this
 * catches it for the whole artifact, so a narrowed run still reports a corpus
 * and a manifest that have drifted apart.
 *
 * @param {Object} manifestDocument
 * @param {Object} corpus
 * @param {boolean} selectionComplete
 * @returns {Object} the check document
 */
function accountManifestCardinality(manifestDocument, corpus, selectionComplete) {
  // Strict when the caller says nothing. An omitted argument must not be the
  // lenient case in a gate tool: the softening exists for a --only run and
  // has to be asked for.
  var complete = selectionComplete === undefined ? true : !!selectionComplete;
  var expected = (manifest.EXPECTED && manifest.EXPECTED.routes) || null;
  var entries = manifestDocument.entries || [];
  var seen = Object.create(null);
  var duplicates = [];
  var keys = [];
  var corpusKeys = corpusRouteKeys(corpus);
  var declared = corpusKeys.keys;
  var missingFromCorpus = [];
  var missingFromManifest = [];
  var failures = [];

  entries.forEach(function(entry) {
    var key = manifest.routeKey(entry.method, entry.path);

    if (seen[key]) {
      duplicates.push(key);
      return;
    }

    seen[key] = true;
    keys.push(key);
  });

  if (expected === null) {
    failures.push('test/parity/manifest.js publishes no expected route count, ' +
      'so the manifest\'s cardinality cannot be checked against the measured ' +
      'surface');
  }
  else if (entries.length !== expected) {
    failures.push('the route manifest holds ' + entries.length + ' entr(ies) ' +
      'and the registered surface is ' + expected + ' routes (AAP §0.9.1, ' +
      'reconciled as 178 literal declarations + 50 language expansions + 2 ' +
      'static pages + 3 static routes). Coverage was therefore accounted ' +
      'against the wrong surface, and "every route represented" says nothing ' +
      'about the routes this manifest does not list.');
  }

  if (duplicates.length) {
    failures.push(duplicates.length + ' route key(s) appear more than once in ' +
      'the manifest (' + duplicates.slice(0, 5).join(', ') + '), so the ' +
      'entry count and the surface size are not the same number');
  }

  missingFromCorpus = keys.filter(function(key) {
    return declared.indexOf(key) === -1;
  });
  missingFromManifest = declared.filter(function(key) {
    return !seen[key];
  });

  // A corpus driving a route the manifest does not hold is unambiguously wrong
  // whatever the selection: the corpus and the tree disagree about what exists.
  if (missingFromManifest.length) {
    failures.push(missingFromManifest.length + ' route(s) the corpus covers ' +
      'are absent from the manifest (' +
      missingFromManifest.slice(0, 5).join(', ') + '), so the corpus drives ' +
      'routes this tree no longer registers');
  }

  // The other direction is conditioned the way `accountCoverage` conditions
  // its own: under a complete selection an uncovered route is a hole in the
  // gate, and under --only it is outside what this run claims to cover.
  if (missingFromCorpus.length) {
    if (complete) {
      failures.push(missingFromCorpus.length + ' of ' + entries.length +
        ' manifest route(s) are absent from the corpus (' +
        missingFromCorpus.slice(0, 5).join(', ') + '), so this corpus does ' +
        'not describe the registered surface and cannot be compared against ' +
        'it key for key');
    }
  }

  return {
    name: 'route manifest is the registered surface',
    asserted: entries.length,
    minimum: expected,
    corpusKeySource: corpusKeys.source,
    corpusKeys: declared.length,
    missingFromCorpus: missingFromCorpus.length,
    missingFromManifest: missingFromManifest.length,
    ok: !failures.length,
    skipped: false,
    reason: missingFromCorpus.length && !complete
      ? missingFromCorpus.length + ' manifest route(s) are outside this ' +
        'narrowed selection\'s corpus and are therefore not failed here. A ' +
        'narrowed run cannot stand as the key-equality gate.'
      : null,
    entries: duplicates.concat(missingFromCorpus).concat(missingFromManifest),
    failures: failures
  };
}

/**
 * Asserts that every declared expectation is one the RECORDING satisfies.
 *
 * This closes the last way a declared clause can end up asserting nothing about
 * the target. A declared expectation describes the BASELINE, so this file
 * evaluates it twice - against the observation and against the recording - and
 * `classifyScenario` fails the scenario only where the recording met it and the
 * target did not. That order is right: an expectation the corpus itself does not
 * meet is a finding about the CAPTURE, and failing the scenario for it would
 * blame the target for the corpus's defect.
 *
 * What was missing is that the finding was then never reported at all. A clause
 * the recording does not satisfy was silently dropped, which is the same
 * outcome as not implementing the operator - the corpus tells its reader the
 * check exists and nothing ever evaluates it against the tree under test. So it
 * is reported here, as a named check that FAILS, attributing it to the corpus
 * rather than to the target. The remedy is a re-capture or a corrected clause;
 * either way the gate does not pass while a declared check is inert.
 *
 * @param {Array.<Object>} scenarios
 * @returns {Object} the check document
 */
function accountDeclaredExpectations(scenarios) {
  var failures = [];
  var entries = [];
  var asserted = 0;

  scenarios.forEach(function(item) {
    var result = item.result;
    var baseline;
    var target;

    if (!item.expectation || !result || !result.driven || !result.compared) {
      return;
    }

    baseline = result.baselineExpectation;
    target = result.expectation;
    asserted++;

    entries.push({
      id: item.id,
      description: item.expectation.description || null,
      recordingMet: baseline ? !!baseline.met : null,
      targetMet: target ? !!target.met : null
    });

    if (baseline && !baseline.met) {
      failures.push(item.id + ' declares an expectation its own RECORDING ' +
        'does not meet, so it could not be held against the target and the ' +
        'clause asserted nothing about this tree' +
        (target && target.met
          ? ' - note that the target DOES meet it'
          : ' - the target does not meet it either') + '. The recording ' +
        'fails it because: ' + baseline.failures.join('; ') + '. This is a ' +
        'finding about the corpus: re-capture the scenario, or correct the ' +
        'clause so it describes what the baseline actually does.');
    }
  });

  return {
    name: 'declared expectations are met by the recording',
    asserted: asserted,
    ok: !failures.length,
    skipped: !asserted,
    reason: asserted
      ? null
      : 'no compared scenario in this run carries a declared expectation',
    entries: entries,
    failures: failures
  };
}

/**
 * The route keys a corpus covers, from its own declarations.
 *
 * Two sources and neither is optional. A corpus written by capture.js carries a
 * `coverage.byRoute` block, and that is read when it is there. A corpus that
 * does not is not exempt from the comparison: every scenario declares the
 * routes it covers - `covers` when it has one, its own route otherwise - so the
 * set is derived from the scenarios instead. Which source was used is recorded,
 * because a derived set is an inference about the artifact while a declared one
 * is the artifact's own statement.
 *
 * @param {Object} corpus
 * @returns {Object} {keys, source}
 */
function corpusRouteKeys(corpus) {
  var out = [];
  var byRoute = corpus && corpus.coverage && corpus.coverage.byRoute;

  if (byRoute && typeof byRoute === 'object') {
    return { keys: Object.keys(byRoute), source: 'coverage.byRoute' };
  }

  ((corpus && corpus.scenarios) || []).forEach(function(item) {
    var covers = item && Array.isArray(item.covers) && item.covers.length
      ? item.covers
      : (item && item.route && item.route.method && item.route.path
        ? [manifest.routeKey(item.route.method, item.route.path)]
        : []);

    covers.forEach(function(key) {
      if (out.indexOf(key) === -1) {
        out.push(key);
      }
    });
  });

  return { keys: out, source: 'derived from the scenarios' };
}

/**
 * Decides whether this run is the GATE, and records why it is not.
 *
 * `gateQualifying` is the flag every downstream document reads to tell a
 * diagnostic from the parity gate, and it used to be set from two conditions -
 * a complete selection and both cookie passes - while AAP §0.9.3 requires
 * considerably more of the gate than that. A run could therefore be labelled as
 * the gate having produced no warning evidence, having compared coverage
 * against a manifest of any size, and having asserted the secure cookie
 * contract by DERIVING it from the non-secure recording rather than measuring
 * it.
 *
 * Each requirement below is checked and reported by name, met or unmet, so the
 * label carries its own justification instead of a boolean nobody can audit.
 * None of them fails the run: a narrowed diagnostic is a legitimate thing to
 * run and exits 0 when it matches. What they decide is whether this run may be
 * cited as the gate.
 *
 * @param {Object} options
 * @param {Object} manifestDocument
 * @param {Array.<Object>} passes the accounted passes
 * @param {boolean} selectionComplete
 * @param {Object} [evidence] {corpus, secureCorpus, appHead} - the validated
 *   provenance records and the commit of the tree under test
 * @returns {Object} {qualifying, requirements, unmet}
 */
function qualifyGate(options, manifestDocument, passes, selectionComplete,
  evidence) {
  var provenance = evidence || {};
  var corpusProvenance = provenance.corpus || null;
  var secureProvenance = provenance.secureCorpus || null;
  var flags = flattenNodeFlags(options.nodeFlags);
  var missingFlags = REQUIRED_NODE_FLAGS.filter(function(flag) {
    return flags.indexOf(flag) === -1;
  });
  var childFlagFailures = [];
  var warningEvidence = [];
  var manifestCheck = null;
  var authCheck = null;
  var unexercisedOutcomes = [];
  var authFailures = [];
  var authenticationFailures = [];
  var requirements;
  var unmet;

  passes.forEach(function(entry) {
    var passFlags = flattenNodeFlags(entry.pass.nodeFlags);
    var missingHere = REQUIRED_NODE_FLAGS.filter(function(flag) {
      return passFlags.indexOf(flag) === -1;
    });
    var warnings = entry.pass.warnings;

    if (missingHere.length) {
      childFlagFailures.push(entry.pass.name + ' ran the application without ' +
        missingHere.join(' and '));
    }

    if (!warnings || warnings.skipped || !warnings.asserted) {
      warningEvidence.push(entry.pass.name + ' produced no warning evidence');
    }
    else if (!warnings.qualifying) {
      // Qualified is stricter than non-empty: a stream measured without the
      // tracing flags, against a foreign --app tree, or over a sweep that
      // touched a fraction of the surface is evidence about something other
      // than this gate. `warningShortfalls` names which of those it was.
      warningEvidence.push(entry.pass.name + ' produced warning evidence that ' +
        'does not qualify as this gate\'s measurement');
    }

    entry.checks.forEach(function(check) {
      if (check.name === 'route manifest is the registered surface') {
        manifestCheck = check;
      }

      if (check.name === 'auth-scheme outcomes') {
        authCheck = check;

        // An outcome with no scenario at all and one with a scenario that was
        // not driven are the same gap from the gate's point of view, and both
        // are named rather than summarized: which outcome is unproven is the
        // whole of the information here.
        (check.missing || []).forEach(function(id) {
          var line = entry.pass.name + ': ' + id + ' (no scenario)';

          if (unexercisedOutcomes.indexOf(line) === -1) {
            unexercisedOutcomes.push(line);
          }
        });

        (check.unexercised || []).forEach(function(gap) {
          var line = entry.pass.name + ': ' + gap.id + ' (' + gap.reason + ')';

          if (unexercisedOutcomes.indexOf(line) === -1) {
            unexercisedOutcomes.push(line);
          }
        });
      }
    });
  });

  // The specific shortfall, alongside the categorical one above.
  warningEvidence = warningEvidence.concat(warningShortfalls(passes));

  // What makes a corpus AUTHENTICATED, as opposed to merely present with a
  // sidecar beside it. Each of these three is a way a corpus can fail to be a
  // baseline recording of the frozen tree, and none of them fails the run: a
  // corpus with no digest is still worth replaying, it just cannot be shown to
  // be the file that was captured.
  if (!corpusProvenance) {
    authenticationFailures.push('no corpus provenance was established');
  }
  else {
    if (!corpusProvenance.digestVerified) {
      authenticationFailures.push('the corpus sidecar declares no artifact ' +
        'digest, so an edit made to the corpus after it was captured - a ' +
        'baseline adjusted to match the target - cannot be detected. Its ' +
        'digest as read is ' + corpusProvenance.artifactDigest.slice(0, 16) +
        '; a sidecar carrying `artifactDigest` is what makes that checkable');
    }

    if (!corpusProvenance.generatorIsCapture) {
      authenticationFailures.push('the corpus sidecar names the generator ' +
        JSON.stringify(corpusProvenance.generator.path) + ' and a baseline ' +
        'recording is ' + CAPTURE_GENERATOR + '\'s artifact');
    }

    if (!corpusProvenance.frozenBaselineChecked) {
      authenticationFailures.push('the captured tree was not checked against ' +
        'the frozen R-f reference ' + BASELINE_COMMIT.slice(0, 7) +
        ' (AAP §0.10.3)' + (options.selfCheck
          ? ' because --self-check declares the corpus to come from the tree ' +
            'under test'
          : ', because --baseline-head named ' +
            JSON.stringify(String(options.baselineHead)) + ' instead'));
    }
  }

  if (secureProvenance && !secureProvenance.digestVerified) {
    authenticationFailures.push('the secure-pass corpus sidecar declares no ' +
      'artifact digest');
  }

  // The diagnostic escape belongs to this requirement rather than to a
  // requirement of its own: what it waives IS corpus authentication. Under it
  // the block's identity checks are recorded as waived instead of refused, and
  // a waived identity check is exactly what a payload digest cannot stand in
  // for - a fabricated artifact hashes to whatever it claims.
  if (options.allowUnreviewedCorpus) {
    authenticationFailures.push('--allow-unreviewed-corpus was in force, so ' +
      'the corpus was accepted without establishing that it records the base ' +
      'commit ' + manifest.provenance.BASELINE_HEAD.slice(0, 7) + ', and any ' +
      'identity check that could not be resolved was recorded as waived');
  }

  if (authCheck && !authCheck.ok) {
    authFailures.push('the auth-outcome check itself failed');
  }

  requirements = [
    {
      id: 'complete-selection',
      requirement: 'every scenario in the corpus was replayed (no --only)',
      met: selectionComplete,
      detail: selectionComplete
        ? null
        : '--only narrowed the selection to ' + options.only.join(' ') +
          ', so route coverage cannot be accounted over the whole surface'
    },
    {
      id: 'both-cookie-passes',
      requirement: 'both cookie configurations were driven (--pass ' + PASS_BOTH + ')',
      met: options.pass === PASS_BOTH,
      detail: options.pass === PASS_BOTH
        ? null
        : '--pass ' + options.pass + ' ran one cookie configuration; AAP ' +
          '§0.9.3 runs the overlay twice, once with isSecure unset and once ' +
          'in secure mode'
    },
    {
      id: 'measured-secure-pass',
      requirement: 'the secure pass compared against a secure baseline of its ' +
        'own, attested as a secure capture by its provenance',
      // The PATH is not the evidence. `validateCorpusProvenance` refuses a
      // recording whose sidecar attests a non-secure capture for this role and
      // refuses the same artifact in both roles, so what qualifies the gate is
      // the validated record rather than the flag having been passed.
      met: !!(options.secureCorpus && secureProvenance &&
        secureProvenance.cookieMode && secureProvenance.cookieMode.known &&
        secureProvenance.cookieMode.secure === true),
      detail: options.secureCorpus
        ? (secureProvenance && secureProvenance.cookieMode &&
           secureProvenance.cookieMode.known &&
           secureProvenance.cookieMode.secure === true
          ? null
          : 'the --secure-corpus provenance does not attest a secure capture, ' +
            'so the secure cookie contract would be compared against a ' +
            'recording made with isSecure unset')
        : 'without --secure-corpus the secure pass DERIVES its expected ' +
          'cookie attributes from the non-secure recording, so the secure ' +
          'cookie contract - Secure on every session cookie, SameSite ' +
          'Lax -> None on the cookies the private-field patch touched, and ' +
          'the Expires horizon - is asserted against a value this tool ' +
          'computed rather than one the baseline produced. Capture a corpus ' +
          'against a --secure server and pass --secure-corpus'
    },
    {
      id: 'deprecation-flags',
      requirement: 'the application ran under ' + REQUIRED_NODE_FLAGS.join(' and '),
      met: !missingFlags.length && !childFlagFailures.length,
      detail: missingFlags.length || childFlagFailures.length
        ? (missingFlags.length
          ? '--node-flags did not carry ' + missingFlags.join(' and ') + '. '
          : '') + (childFlagFailures.length
          ? childFlagFailures.join('; ') + '. '
          : '') + 'AAP §0.9.3 runs the whole exercise under both, and §0.6.4 ' +
          'is why: two internal re-entrant injections put a deprecation on ' +
          'the live request path that boot never reveals'
        : null
    },
    {
      id: 'warning-evidence',
      requirement: 'every pass scanned the application\'s own stderr over ' +
        'driven scenarios',
      met: !!passes.length && !warningEvidence.length,
      detail: passes.length
        ? (warningEvidence.length ? warningEvidence.join('; ') : null)
        : 'no pass was accounted, so there is no stderr to have scanned'
    },
    {
      id: 'manifest-cardinality',
      requirement: 'the route manifest is the ' +
        ((manifest.EXPECTED && manifest.EXPECTED.routes) || 233) +
        '-entry registered surface, key for key',
      met: !!(manifestCheck && manifestCheck.ok),
      detail: manifestCheck
        ? (manifestCheck.ok ? null : manifestCheck.failures.join('; '))
        : 'the manifest cardinality check did not run, so coverage was ' +
          'accounted against an unverified surface'
    },
    {
      id: 'not-self-check',
      requirement: 'the run compares the migrated tree against a baseline ' +
        'recording, rather than a tree against its own recording',
      met: !options.selfCheck,
      detail: options.selfCheck
        ? '--self-check declares the tree under test to be the tree the ' +
          'corpus came from. That is the self-consistency rehearsal and it is ' +
          'stricter than the gate, but it is not evidence of parity between ' +
          'two trees'
        : null
    },
    {
      id: 'authenticated-corpus',
      requirement: 'the corpus is authenticated as ' + CAPTURE_GENERATOR +
        '\'s recording of the frozen R-f baseline ' +
        BASELINE_COMMIT.slice(0, 7) + ', by digest',
      met: !authenticationFailures.length,
      detail: authenticationFailures.length
        ? authenticationFailures.join('; ')
        : null
    },
    {
      id: 'known-target-identity',
      requirement: 'the commit of the tree under test is established',
      met: !!provenance.appHead,
      detail: provenance.appHead
        ? null
        : 'git could not name the HEAD of ' + options.appRoot + ', so the ' +
          'result would say which corpus it compared and not which tree it ' +
          'compared it against. R-f identifies both sides by commit'
    },
    {
      id: 'auth-outcomes-exercised',
      requirement: 'all ' + AUTH_OUTCOME_IDS.length + ' auth-scheme outcomes ' +
        'were driven and compared, not explained',
      met: !unexercisedOutcomes.length && !authFailures.length &&
        !!passes.length,
      detail: passes.length
        ? (unexercisedOutcomes.length || authFailures.length
          ? (unexercisedOutcomes.length
            ? unexercisedOutcomes.join('; ') + '. A stated reason explains a ' +
              'gap and does not close it: the "Auth error" outcome needs ' +
              'User.findById itself to reject, which no HTTP request can ' +
              'cause, so it needs a bounded fault injector in the parity ' +
              'server and a scenario that records its result. '
            : '') + authFailures.join('; ')
          : null)
        : 'no pass was accounted, so no outcome was exercised'
    }
  ];

  unmet = requirements.filter(function(entry) {
    return !entry.met;
  });

  return {
    qualifying: !unmet.length,
    requirements: requirements,
    unmet: unmet.map(function(entry) {
      return entry.id;
    })
  };
}

/**
 * Flattens `--node-flags` into individual tokens.
 *
 * One value may be space-separated - the usage text says so - so
 * `["--pending-deprecation --trace-deprecation"]` and
 * `["--pending-deprecation", "--trace-deprecation"]` are the same thing, and a
 * requirement that only understood the second form would fail a run that did
 * exactly what the documentation asked for.
 *
 * @param {(Array.<string>|null)} flags
 * @returns {Array.<string>}
 */
function flattenNodeFlags(flags) {
  var out = [];

  (flags || []).forEach(function(value) {
    String(value).split(/\s+/).forEach(function(token) {
      if (token && out.indexOf(token) === -1) {
        out.push(token);
      }
    });
  });

  return out;
}

// ---------------------------------------------------------------------------
// Children: the manifest, the object-store manifest and the seeder
// ---------------------------------------------------------------------------

/**
 * The git HEAD of a worktree, or null when it is not a checkout.
 *
 * A missing git or a non-zero exit yields null rather than throwing:
 * provenance is evidence about a run, and a run that produced a correct
 * comparison must not be failed for being unable to name its own commit.
 * `spawnSync` with an argument array, so nothing goes through a shell.
 *
 * @param {string} root
 * @returns {(string|null)}
 */
function gitHead(root) {
  var result = childProcess.spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    // Finite because this child is SYNCHRONOUS: it blocks this process's event
    // loop outright, so a `git` waiting on an index lock would stall a replay
    // that is holding a mongod and up to two application servers open, for the
    // sake of one provenance string.
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
 * Resolves the route manifest, generating it in a CHILD when it is not there.
 *
 * Read as an artifact rather than generated in this process, because the
 * generator loads the application's route modules and controllers - which is
 * the one thing this file must not put in its own module graph. When the
 * artifact is missing the generator is spawned instead, with both of its
 * streams discarded: loading the controllers prints the in-memory-queue line on
 * stdout and a baseline tree prints the AWS notice on stderr, and the artifact
 * is the only output that matters.
 *
 * Where a GENERATED manifest lands is not where a read one is looked for. The
 * committed artifact is read when it exists, but generating one is a WRITE, and
 * a write nobody asked for does not go into the worktree: unless --manifest
 * named the path, the generated copy goes to scratch space.
 *
 * @param {Object} options
 * @returns {Object} the parsed manifest
 * @throws {ToolError} If it can be neither read nor generated.
 */
function resolveManifest(options) {
  var generated;
  var env;
  var target;

  if (options.manifestPath && fs.existsSync(options.manifestPath)) {
    return verifiedManifest(options.manifestPath);
  }

  target = manifestDestination(options);
  note('no route manifest at ' + options.manifestPath + '; generating one at ' +
    target);

  env = Object.assign({}, process.env, {
    NODE_ENV: 'test',
    NODE_CONFIG: JSON.stringify({ db: { redis: { enabled: false } } })
  });

  // The manifest is the route inventory this replay's coverage gate is
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

  // A timeout names a budget; a non-zero exit names a fault in the generator.
  // Reported separately, because they send a reader to different places.
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

  // Verified even though this run generated it: the check is over the artifact
  // that reached disk, and a generator that wrote something unattributable is
  // exactly what it exists to catch.
  return verifiedManifest(target);
}


/**
 * Reads the route manifest and verifies its provenance the same way.
 *
 * The coverage gate is only as good as the surface it counts against, and the
 * default manifest path is a shared artifact any run may have written. So the
 * same contract applies: schema, the artifact it claims to be, a role that
 * follows from a tree somebody identified, a generator whose blob and verified
 * commit resolve in this repository, and a payload digest recomputed over the
 * entries themselves. `unreviewed` is not accepted - manifest.js does not emit
 * it, and a route surface nobody can attribute to a tree cannot decide whether
 * a route was represented.
 *
 * There is no escape here, and that is deliberate: this is the surface the
 * coverage gate counts against, and a manifest whose generator cannot be
 * retrieved from this repository cannot be reproduced from it either. The
 * remedy is to regenerate it, which the refusal names.
 *
 * @param {string} target
 * @returns {Object} the parsed manifest
 * @throws {ToolError} If it cannot be read or verified.
 */
function verifiedManifest(target) {
  var parsed = manifest.readManifest(target);
  var block = parsed.provenance === undefined ? null : parsed.provenance;

  validateArtifactProvenance(block, parsed, target, 'route manifest', {
    roles: ['baseline', 'target', 'analysis'],
    regenerate: 'Regenerate it with `node test/parity/manifest.js --app ' +
      '<worktree> --out ' + target + '`'
  });

  note('route manifest: provenance verified - role ' + block.role +
    ', analysed tree ' + ((block.analysedTree && block.analysedTree.headShort) ||
      'not recorded') + ', generator ' + block.generator.path + ' blob ' +
    String(block.generator.blob).slice(0, 12));

  return parsed;
}

/**
 * Where a manifest this tool has to generate is written.
 *
 * `--manifest <path>` is an explicit destination and is honoured as given.
 * Without it the manifest is a side artifact of this run and belongs in scratch
 * space: ARTIFACT_DIR_ENV when the caller named one, otherwise a fresh
 * directory under the system temp - which is where this tool's per-run files
 * already go.
 *
 * @param {Object} options
 * @returns {string} An absolute path.
 * @throws {ToolError} If no scratch directory can be created.
 */
function manifestDestination(options) {
  var configured = process.env[ARTIFACT_DIR_ENV];

  if (options.manifestExplicit && options.manifestPath) {
    return path.resolve(options.manifestPath);
  }

  if (typeof configured === 'string' && configured.trim()) {
    return path.resolve(configured.trim(), ARTIFACT_NAMES.manifest);
  }

  try {
    return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-manifest-')),
      ARTIFACT_NAMES.manifest);
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
    'so that a replay cannot leave artifacts in tracked source without being ' +
    'asked to. Pass ' + flag + ' <path>, or set ' + ARTIFACT_DIR_ENV + ' to a ' +
    'scratch directory and the artifact goes to <dir>/' + basename + '.');
}

/**
 * Writes the object-store pre-population manifest and returns its path.
 *
 * Not optional, and its omission is not survivable. The seeder plants a File
 * document whose hash, url and name describe a PRE-MIGRATION object that has to
 * already exist inside the server child, and an environment variable is the
 * only channel that reaches a preload. Without it a download route asks the
 * store for a key it does not hold, the fixture raises NoSuchKey on the
 * returned stream, nothing in the application listens for `error` on that
 * stream, and the unhandled error event takes the whole server down mid-run -
 * after which every remaining case records a meaningless transport failure.
 *
 * Built in a CHILD because the seeder resolves bucket names through the
 * configuration, and requiring the configuration here is exactly what this file
 * must not do. It runs BEFORE the launcher, because the fixture reads the
 * manifest once at load.
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
  // under; a redirected module resolution would put them in the wrong bucket
  // and every download comparison would be made against a not-found.
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
      reason: 'the object-store manifest generator exited ' + result.status +
        ': ' + String(result.stderr || '').trim().split('\n').slice(-3).join(' | ')
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
 * Seeds the fixtures, in a child process, AWAITED.
 *
 * Fixture creation belongs to the seeder, and this file must not require the
 * models to invoke it. The child runs with the tool root as its working
 * directory, deliberately, so one consistent module tree resolves: the tool's
 * mongoose, the tool's models and the tool's configuration together. Writing
 * fixtures with the target tree's model code into the database a baseline
 * server reads is sound because the model layer is unchanged across the two
 * commits and because what crosses between the trees is BSON, not JavaScript.
 *
 * AWAITED, NEVER `spawnSync`, and that is not a stylistic preference. By the
 * time this runs, the launcher has provisioned the database IN THIS PROCESS -
 * mongodb-memory-server runs mongod as a child of this one and reads its piped
 * stdout - and has spawned the application as a second piped child. A
 * `spawnSync` here blocks this event loop for the whole seeding window, neither
 * pipe is drained, mongod blocks on its own log writes and stops completing
 * handshakes, and the seeder dies of server selection against a database that
 * is running and reachable.
 *
 * @param {Object} info the launcher's start result
 * @returns {Promise<Object>} {ok, reason, summary}
 */
function seedFixtures(info) {
  var script = [
    'var mongoose = require("mongoose");',
    'var seeder = require(' + JSON.stringify(path.join(__dirname, 'seed.js')) + ');',
    'mongoose.set("strictQuery", true);',
    // The disconnect runs on EVERY path. One `finish` both branches call is
    // the ES5 shape of a `finally`, and it is what the earlier chain lacked:
    // it disconnected only after a successful seed, so a rejection AFTER
    // connect - a duplicate key, a validation error, a dropped write - left
    // this child holding an open connection whose socket kept its event loop
    // alive. The child never exited, `close` never fired, and the parent below
    // waited on it forever while owning a mongod and live application servers.
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
    '  .then(function() { return seeder.seed(); })',
    '  .then(function(summary) {',
    '    process.stderr.write("seeded: " + JSON.stringify(summary.created) + "\\n");',
    '    return finish(0);',
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

  // The seeder writes the fixtures every comparison is made against, so
  // nothing outside this tree may preload code into it or change which
  // `mongoose` and which models it loads. See mongo.PRELOAD_ENV_VARS.
  mongo.scrubPreloadVars(env);

  // The full isolation contract, not persistence alone: `config` 0.4.37 creates
  // its runtime JSON unless persistence is off AND the file watch is disabled,
  // this child requires `config` through the seeder, and `appRoot: TOOL_ROOT`
  // points it at the config/ of the tree it runs in instead of an inherited
  // directory from another one.
  mongo.applyConfigIsolation(env, { appRoot: TOOL_ROOT, configDir: 'set' });

  return new Promise(function(resolve) {
    var child;
    var stderr  = '';
    var settled = false;
    var timers  = [];

    function tail() {
      return String(stderr || '').trim().split('\n').slice(-3).join(' | ');
    }

    function clearTimers() {
      timers.forEach(function(timer) { clearTimeout(timer); });
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
    // process is also the parent of an in-memory mongod and of the application
    // servers being compared, so a process-group signal here would end the very
    // run this seeder is preparing. `child.kill` reaches that one pid only.
    function signalOwned(signal) {
      if (!alive()) {
        return;
      }

      try {
        child.kill(signal);
      }
      catch (err) {
        // ESRCH: it exited between the check and the signal - the race this
        // guard absorbs rather than a failure.
        if (!err || err.code !== 'ESRCH') {
          note('warning: could not send ' + signal + ' to the seeder (pid ' +
            child.pid + '): ' + reasonOf(err));
        }
      }
    }

    // Last resort for a teardown of THIS process while the seeder still runs:
    // an `exit` listener cannot await, so it is SIGKILL or an orphan holding a
    // connection to a database that is about to disappear.
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

      // Dropped only when there is nothing left for it to do; a child that
      // outlived every signal keeps it, so this process's exit tries once more.
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
        reason: 'the seeder could not be spawned: ' + reasonOf(err),
        summary: null
      });
      return;
    }

    process.on('exit', sweep);

    // The seeder reports on stderr and writes nothing to stdout, but both are
    // drained anyway: an undrained pipe is what this function exists to avoid.
    child.stdout.resume();
    child.stderr.on('data', function(chunk) {
      stderr += chunk.toString();
    });

    // The deadline, in three bounded steps. The parent never waits past the
    // last one: a seeder that survived SIGKILL would otherwise reproduce
    // exactly the indefinite wait this replaces.
    timers.push(setTimeout(function() {
      note('the seeder has not finished within ' + SEED_TIMEOUT_MS +
        'ms; sending SIGTERM to pid ' + child.pid + '.');
      signalOwned('SIGTERM');

      timers.push(setTimeout(function() {
        note('the seeder did not exit on SIGTERM; sending SIGKILL to pid ' +
          child.pid + '.');
        signalOwned('SIGKILL');

        timers.push(setTimeout(function() {
          settle({
            ok: false,
            reason: 'the seeder (pid ' + child.pid + ') did not finish ' +
              'within ' + SEED_TIMEOUT_MS + 'ms and could not be reaped ' +
              'after SIGTERM and SIGKILL. End it by hand; its last output ' +
              'was: ' + (tail() || '(nothing on stderr)'),
            summary: null
          });
        }, SEED_KILL_GRACE_MS));
      }, SEED_KILL_GRACE_MS));
    }, SEED_TIMEOUT_MS));

    child.on('error', function(err) {
      settle({
        ok: false,
        reason: 'the seeder could not be spawned: ' + reasonOf(err),
        summary: null
      });
    });

    child.on('close', function(status, signal) {
      if (status === 0) {
        settle({ ok: true, reason: null, summary: tail() });
        return;
      }

      settle({
        ok: false,
        reason: 'the seeder ' +
          (status === null
            ? 'was killed on ' + signal + ' (the deadline above says whether ' +
              'this harness sent it)'
            : 'exited ' + String(status)) +
          ': ' + (tail() || '(nothing on stderr)'),
        summary: null
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Fixture profiles and evidence
// ---------------------------------------------------------------------------

/**
 * Selects the http fixture profile for the next request and CONFIRMS it.
 *
 * The profile file is the documented way to switch profiles without restarting
 * the server: the fixture re-reads it synchronously at the start of every
 * intercepted call. Writing it is not the same as it being in force, so it is
 * read back here and the result is carried onto the scenario - a request driven
 * under the wrong external outcome would be compared against a recording made
 * under a different one, which is a silent invalidation of the comparison
 * rather than a visible failure.
 *
 * A profile name the catalogue does not know is rejected rather than written,
 * because the fixture's own contract is to log an unknown name and KEEP the
 * previous profile.
 *
 * @param {(string|null)} profileFile
 * @param {string} profile
 * @returns {Object} {fileConfirmed, fileReason}
 * @throws {ToolError} If the profile is unknown to the catalogue.
 */
function selectProfile(profileFile, profile) {
  var written;

  if (httpFixture.profileNames().indexOf(profile) === -1) {
    throw new ToolError('the fixture profile ' + JSON.stringify(profile) +
      ' is not in the catalogue. Known profiles: ' +
      httpFixture.profileNames().join(', '));
  }

  if (!profileFile) {
    return {
      fileConfirmed: false,
      fileReason: 'the launcher published no profile file, so the profile ' +
        'could not be switched or confirmed'
    };
  }

  try {
    fs.writeFileSync(profileFile, JSON.stringify({ profile: profile }) + '\n');
  }
  catch (err) {
    return {
      fileConfirmed: false,
      fileReason: 'could not write ' + profileFile + ': ' + reasonOf(err)
    };
  }

  try {
    written = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
  }
  catch (err) {
    return {
      fileConfirmed: false,
      fileReason: 'could not read ' + profileFile + ' back: ' + reasonOf(err)
    };
  }

  if (!written || written.profile !== profile) {
    return {
      fileConfirmed: false,
      fileReason: 'the profile file reads back as ' +
        JSON.stringify(written && written.profile) + ' rather than ' +
        JSON.stringify(profile)
    };
  }

  return { fileConfirmed: true, fileReason: null };
}

/**
 * Arms or disarms the model-boundary fault injector for the next step.
 *
 * The channel that makes the auth scheme's fifth outcome - 'Auth error', which
 * needs the `User` lookup ITSELF to fail - reachable over HTTP. It is
 * step-scoped rather than scenario-scoped because the value of that case is
 * that exactly one lookup fails: the login that establishes the session and the
 * request that proves the session survived both have to succeed.
 *
 * The arming document is built by `fixtures/model.js`'s own `arming()` and
 * written by `server.writeModelFaultFile`, so neither this file nor capture.js
 * holds a second copy of its field names or of what disarmed looks like.
 *
 * An arming with nowhere to write it is a hard error rather than a skip. The
 * failure mode it prevents is the one that matters: driving the request with no
 * fault armed and comparing the perfectly ordinary 200 against a baseline that
 * recorded a refusal, or - worse, on a self-comparison - against another
 * unfaulted response, and calling the pair a match.
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
        'armed, but this run has no arming file to write it to. The launcher ' +
        'publishes one as `modelFaultPath` on its start result, so this can ' +
        'only happen against a server this file did not start. Driving the ' +
        'step unfaulted and comparing the result would report a pass for an ' +
        'outcome that was never reached.');
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
 * Clears an arming this scenario left behind, on every exit path.
 *
 * Recorded rather than thrown, because this runs on error paths too and a throw
 * here would replace the diagnosis with its own. A failed disarm is an
 * observation on the scenario, which is what puts it in the report: every
 * scenario after it is suspect, since the next user lookup will fail and will
 * be attributed to whatever case happens to make it.
 *
 * @param {(string|null)} faultFile
 * @param {boolean} armed Whether anything is believed to be armed.
 * @param {Object} item The scenario.
 * @param {Object} result The scenario's result, for recording against.
 * @returns {undefined}
 */
function disarmModelFault(faultFile, armed, item, result) {
  if (!armed || !faultFile) {
    return;
  }

  try {
    selectModelFault(faultFile, null);
  }
  catch (err) {
    result.observations.push({
      kind    : 'model-fault-not-disarmed',
      scenario: item.id,
      detail  : reasonOf(err)
    });
    note('WARNING: could not disarm the model-boundary fault after ' + item.id +
      ': ' + reasonOf(err) + '. Every later scenario in this pass is suspect.');
  }
}

/**
 * Reads one of the fixtures' JSONL evidence logs.
 *
 * The fixtures run inside the CHILD, so their in-memory call logs are
 * unreachable from here; the log files are the published cross-process channel
 * and each is written through per call, precisely because some profiles end in
 * an uncaught throw or never settle and buffered evidence would be lost exactly
 * where it matters most.
 *
 * A missing log is reported as such rather than treated as an empty one: "no
 * external call was made" and "the evidence could not be read" are different
 * findings.
 *
 * @param {(string|null)} target
 * @returns {Object} {available, records, malformed, reason}
 */
function readEvidenceLog(target) {
  var text;
  var records = [];
  var malformed = 0;

  if (!target) {
    return {
      available: false,
      records: records,
      malformed: 0,
      reason: 'no log path was configured'
    };
  }

  try {
    text = fs.readFileSync(target, 'utf8');
  }
  catch (err) {
    return {
      available: false,
      records: records,
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

  return {
    available: true,
    records: records,
    malformed: malformed,
    reason: null
  };
}

/**
 * Counts evidence records by one field, sorted for stability.
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

/**
 * Collects the external-effect evidence a pass produced.
 *
 * This is what turns "no real network was reached" and "these object keys were
 * stored" from claims into recorded facts. The stored keys matter beyond this
 * report: an upload's object key is the sha1 digest of the file's CONTENT, so a
 * change to that digest silently orphans every stored object, and recording the
 * keys a run produced is what makes such a change visible.
 *
 * @param {(Object|null)} info the launcher's start result
 * @returns {Object}
 */
function collectEvidence(info) {
  var httpLog;
  var mailLog;
  var s3Log;
  var modelLog;
  var stored = { available: false, objects: [], reason: null };

  if (!info) {
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

  // The object store is a directory on disk, so it is read directly. The
  // fixture resolves its root AT LOAD from this variable, which is why it is
  // set before the require and why the require is lazy; it is restored
  // immediately afterwards, because nothing in this process should stay patched.
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
      expectedSendResult: mailFixture.sendResult
    },
    s3: {
      available: s3Log.available,
      reason: s3Log.reason,
      calls: s3Log.records.length,
      malformedLines: s3Log.malformed,
      byOperation: countBy(s3Log.records, 'operation'),
      stored: stored
    },
    // The injected data-store faults. `accountAuthOutcomes` reconciles the
    // armed steps of the lookup-error scenario against `faulted` and `byId`,
    // because a scenario that reports the right status without a recorded
    // fault reached that status some other way - which is precisely the state
    // this whole mechanism was added to make visible.
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
 * Whether the application child is still alive.
 *
 * Signal 0 tests for the process without touching it. Used to tell a genuine
 * per-route transport failure - the refused streaming case records one by
 * design - from an application that died and took every remaining case with it.
 *
 * @param {(Object|null)} info the launcher's start result
 * @returns {boolean}
 */
function serverAlive(info) {
  if (!info || !info.pid) {
    return false;
  }

  try {
    process.kill(info.pid, 0);
    return true;
  }
  catch (err) {
    return err && err.code === 'EPERM';
  }
}

// ---------------------------------------------------------------------------
// Driving one scenario
// ---------------------------------------------------------------------------

/**
 * Replays one scenario and compares every step of it.
 *
 * Never throws for a fault in the driving: a step that could not be driven is
 * recorded with its reason and the scenario is marked as not driven, because a
 * case silently dropped is the one failure mode a parity gate cannot tolerate.
 * Step order is preserved exactly as the corpus holds it - reordering the two
 * consecutive requests of the cross-request redirect leak would destroy the
 * only evidence of it.
 *
 * @param {Object} item the planned scenario
 * @param {Object} context {jar, profileFile, faultFile, httpLogPath, timeoutMs, selfCheck, expectation}
 * @returns {Promise<Object>} the scenario result
 */
async function runScenario(item, context) {
  var result = {
    driven: false,
    compared: false,
    skipped: false,
    error: null,
    steps: [],
    differences: [],
    observations: [],
    expectation: null,
    deviation: null,
    profileEvidence: null,
    outcome: null
  };
  var evidenceBefore;
  var profileSelection;
  var observedRecords = [];
  var index;
  var step;
  var driven;
  var comparison;
  // Whether an arming this scenario wrote is still in the fault file. It must
  // be cleared on every exit path: the server is long-lived and the scenarios
  // are driven serially, so an arming left behind would fail the next
  // scenario's user lookup and be reported as that scenario's own difference.
  var faultArmed = false;

  item.result = result;

  if (!item.steps.length) {
    // A scenario with no steps. It carries its reason and is accounted as an
    // explained gap, which is the difference between that and a silent one -
    // and `accountAuthOutcomes` treats such a gap in the auth group as a
    // FAILURE unless the AAP itself justifies it, because a stated reason is
    // not an assertion.
    result.skipped = true;
    return result;
  }

  try {
    profileSelection = selectProfile(context.profileFile, item.fixtureProfile);
  }
  catch (err) {
    result.error = reasonOf(err);
    return result;
  }

  evidenceBefore = readEvidenceLog(context.httpLogPath).records.length;

  if (item.freshSession) {
    context.jar.reset(item.identity);
  }

  for (index = 0; index < item.steps.length; index++) {
    step = item.steps[index];

    if (step.resetSessionBefore) {
      context.jar.reset(step.identity || item.identity);
    }

    // Arm for a step that declares a fault, and disarm as soon as the step
    // after it does not. Written only when the state changes, so the scenarios
    // that never arm anything pay nothing for this.
    if (step.modelFault || faultArmed) {
      try {
        selectModelFault(context.faultFile, step.modelFault || null);
        faultArmed = !!step.modelFault;
      }
      catch (err) {
        result.error = 'step ' + index + ' (' + step.label + ') could not arm ' +
          'the model-boundary fault: ' + reasonOf(err);
        disarmModelFault(context.faultFile, faultArmed, item, result);
        return result;
      }
    }

    try {
      driven = await context.jar.request(step.identity || item.identity, {
        method: step.method,
        target: step.target,
        accept: step.accept,
        payload: step.payload === undefined ? null : step.payload,
        contentType: step.contentType
      }, step.timeoutMs || context.timeoutMs);
    }
    catch (err) {
      // Nothing in the driver rejects, so reaching here means a fault in this
      // file rather than in the application. Recorded against the step, in
      // place, so the report says which case failed and why.
      result.error = 'step ' + index + ' (' + step.label + ') could not be ' +
        'driven: ' + reasonOf(err);
      result.steps.push({
        label: step.label,
        request: { method: step.method, target: step.target },
        observed: null,
        outcome: OUTCOME_MISSING,
        baselineOutcome: outcomeOf(step.baseline),
        differences: [],
        observations: [],
        error: result.error
      });
      disarmModelFault(context.faultFile, faultArmed, item, result);
      return result;
    }

    observedRecords.push(driven.response);
    comparison = compareStep(step, driven.response, context.expectation);

    result.steps.push({
      label: step.label,
      request: driven.sent,
      observed: driven.response,
      outcome: comparison.outcome,
      baselineOutcome: comparison.baselineOutcome,
      differences: comparison.differences,
      observations: comparison.observations,
      error: null
    });

    result.differences = result.differences.concat(
      comparison.differences.map(function(record) {
        return annotateDifference(record, item, step);
      }));
    result.observations = result.observations.concat(
      comparison.observations.map(function(record) {
        return annotateDifference(record, item, step);
      }));

    if (step.baseline) {
      result.compared = true;
    }
  }

  disarmModelFault(context.faultFile, faultArmed, item, result);

  result.driven = true;
  result.outcome = result.steps.length
    ? result.steps[0].outcome
    : OUTCOME_MISSING;
  result.expectation = evaluateExpectation(item, observedRecords);
  // The same clauses against the RECORDED responses. A declared expectation
  // describes the BASELINE, so it is only evidence about the target where the
  // baseline satisfied it: an expectation the corpus itself does not meet is a
  // finding about the capture, and failing the replay for it would report the
  // same thing twice and blame the wrong artifact.
  result.baselineExpectation = evaluateExpectation(item, item.steps.map(function(step) {
    return step.baseline;
  }));
  result.profileEvidence = profileEvidenceFor(item, context, profileSelection,
    evidenceBefore);

  if (item.expectedDeviation && !context.selfCheck) {
    // Skipped under --self-check: there the tree under test IS the tree the
    // corpus came from, so the deviation must not materialize and the marker
    // has nothing to approve. classifyScenario enforces that directly from the
    // marker, so computing a verdict here would only produce a misleading
    // progress line.
    result.deviation = verifyApprovedDeviation(item, observedRecords,
      result.differences);
  }

  return result;
}

/**
 * Attaches the scenario and step context every difference record needs.
 *
 * The agent prompt's requirement, literally: the scenario id, the route, the
 * field and the two values, so a reviewer can act on the report without
 * re-running the tool. The step label is here too, because a sequence has more
 * than one request.
 *
 * @param {Object} record
 * @param {Object} item
 * @param {Object} step
 * @returns {Object}
 */
function annotateDifference(record, item, step) {
  var out = {
    scenario: item.id,
    group: item.group,
    route: item.routeKey,
    identity: item.identity,
    step: step.label,
    stepIndex: step.index,
    target: step.target,
    field: record.field,
    baselineValue: record.baseline,
    targetValue: record.target
  };

  Object.keys(record).forEach(function(key) {
    if (key !== 'field' && key !== 'baseline' && key !== 'target') {
      out[key] = record[key];
    }
  });

  return out;
}

/**
 * Builds the fixture-profile evidence for one scenario.
 *
 * @param {Object} item
 * @param {Object} context
 * @param {Object} selection the result of selectProfile
 * @param {number} evidenceBefore records in the log before the scenario ran
 * @returns {Object}
 */
function profileEvidenceFor(item, context, selection, evidenceBefore) {
  var log = readEvidenceLog(context.httpLogPath);
  var appended = log.available ? log.records.slice(evidenceBefore) : [];
  var profiles = [];
  var calls = 0;
  var notes = 0;
  var changes = [];

  // The fixture's log carries three kinds of record and only one of them is an
  // intercepted call. A `profile-changed` event reports the switch itself, with
  // its profile nested under `detail`; a bare `event` record is a diagnostic
  // note, such as the one saying the legacy request mechanism is not resolvable
  // on this tree; and a record carrying `endpoint` and `mechanism` is a CALL
  // the fixture served, with the profile it served it under at the top level.
  // Counting the first two as calls would report "(unset)" for every scenario
  // and turn a working assertion into noise.
  appended.forEach(function(record) {
    var profile;

    if (record && record.event === 'profile-changed') {
      changes.push(record.detail && record.detail.profile
        ? String(record.detail.profile)
        : '(unset)');
      return;
    }

    if (record && record.event !== undefined) {
      notes++;
      return;
    }

    calls++;
    profile = record && record.profile ? String(record.profile) : '(unset)';

    if (profiles.indexOf(profile) === -1) {
      profiles.push(profile);
    }
  });

  return {
    fileConfirmed: selection.fileConfirmed,
    fileReason: selection.fileReason,
    interceptedCalls: calls,
    fixtureNotes: notes,
    // The fixture's own record of having adopted the profile from the file.
    // Present only when the profile actually changed - a scenario that reuses
    // the previous profile produces no event, which is not a fault.
    profileChanges: changes,
    profileChangeMismatch: changes.filter(function(profile) {
      return profile !== item.fixtureProfile;
    }),
    profilesSeen: profiles,
    logAvailable: log.available,
    logReason: log.reason
  };
}

/**
 * Logs in every password identity the selected scenarios actually need.
 *
 * Driven through the real login form rather than by forging a cookie: session
 * state lives on the server, so a forged cookie could not work, and the login
 * flow is part of the surface under comparison. Only the identities in use are
 * logged in, so a narrow run does not pay for sessions it will not spend.
 *
 * A login that does not land is reported rather than hidden, with one
 * exception: the disabled account is REFUSED by design and its scenario exists
 * to record that, so its failure to land is the expected outcome.
 *
 * @param {Jar} jar
 * @param {Array.<Object>} scenarios
 * @returns {Promise<Object>} {established, failures}
 */
async function establishSessions(jar, scenarios) {
  var wanted = {};
  var identity;
  var outcome;

  scenarios.forEach(function(item) {
    [item.identity].concat(item.steps.map(function(step) {
      return step.identity;
    })).forEach(function(name) {
      if (PASSWORD_IDENTITIES.indexOf(name) >= 0) {
        wanted[name] = true;
      }
    });
  });

  for (identity of Object.keys(wanted).sort()) {
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
        'identity will be compared as whatever an unauthenticated request ' +
        'returns, which is very likely to differ from the recording.');
    }
  }

  return {
    established: sortedKeys(jar.established),
    failures: sortedKeys(jar.failures)
  };
}

// ---------------------------------------------------------------------------
// One cookie pass
// ---------------------------------------------------------------------------

/**
 * Runs one cookie pass end to end: provision, launch, seed, drive, compare,
 * account, and shut down.
 *
 * The order is the order in which each step can still fail cheaply. The
 * object-store pre-population manifest is built BEFORE the launcher, because
 * the fixture reads it once at load. The seeder runs AFTER the server is up,
 * awaited, for the pipe-starvation reason on `seedFixtures`. Sessions are
 * established before the sweep, because a case driven as an identity with no
 * session is compared against a recording made with one.
 *
 * Every pass gets its own freshly provisioned database and its own server, so
 * the mutating scenarios of one pass cannot change the fixture the next pass
 * reads.
 *
 * @param {string} passName
 * @param {Object} options
 * @param {Object} plan {scenarios, ...}
 * @param {Object} context {differential, scratchDir}
 * @returns {Promise<Object>} the pass document
 */
async function runPass(passName, options, plan, context) {
  var scenarios = plan.scenarios;
  var s3Seed;
  var info = null;
  var jar;
  var sessions = null;
  var seeded = null;
  var fatal = null;
  var died = {
    died: false,
    lastScenario: null,
    lastIndex: -1,
    remaining: 0,
    stderrPath: null
  };
  var undriven = [];
  var evidence;
  var warnings;
  var index;
  var item;
  var result;

  note('--- pass ' + passName + ': ' + scenarios.length + ' scenario(s)');

  // Before the launcher, deliberately: the object-store fixture reads this
  // manifest ONCE at load, so a manifest prepared afterwards would never be
  // seen. See prepareS3Seed for what that costs.
  s3Seed = prepareS3Seed(options, context.scratchDir);

  if (!s3Seed.path) {
    throw new ToolError('the object-store pre-population manifest could not ' +
      'be prepared, and without it a download route asks the store for a key ' +
      'it does not hold and takes the server down mid-run: ' + s3Seed.reason);
  }

  info = await server.start(launcherOptions(options, passName, s3Seed.path));

  try {
    seeded = await seedFixtures(info);

    if (!seeded.ok) {
      throw new ToolError('the fixtures could not be seeded, so every ' +
        'scenario would be compared against a database the corpus was not ' +
        'recorded against: ' + seeded.reason);
    }

    note('seeded the fixtures (' + seeded.summary + ')');

    jar = new Jar({
      baseUrl: info.baseUrl,
      referer: refererFor(info),
      timeoutMs: options.timeoutMs
    });

    sessions = await establishSessions(jar, scenarios);

    for (index = 0; index < scenarios.length; index++) {
      item = scenarios[index];

      result = await runScenario(item, {
        jar: jar,
        profileFile: info.httpProfilePath,
        faultFile: info.modelFaultPath,
        httpLogPath: info.httpLogPath,
        timeoutMs: options.timeoutMs,
        selfCheck: !!options.selfCheck,
        expectation: context.differential ? { differential: true } : null
      });

      reportScenario(item, index, scenarios.length);

      if (result.error) {
        undriven.push({ id: item.id, reason: result.error, neverReached: false });
      }

      if (sawTransportFailure(result) && !serverAlive(info)) {
        died = {
          died: true,
          lastScenario: item.id,
          lastIndex: index,
          remaining: scenarios.length - index - 1,
          stderrPath: info.stderrPath
        };

        note('THE APPLICATION DIED on ' + item.id + '; ' + died.remaining +
          ' scenario(s) were never reached. Every comparison after this point ' +
          'would be a transport failure that means nothing.');

        undriven = undriven.concat(
          markRemainingUndriven(scenarios, index + 1,
            'never reached: the application died on ' + item.id));
        break;
      }
    }
  }
  catch (err) {
    // Recorded on the pass rather than thrown away, so the artifacts still say
    // what happened and how far the pass got. The caller turns a fatal pass
    // into the "could not be performed" exit code - never into a pass.
    fatal = reasonOf(err);
    note('the ' + passName + ' pass could not be completed: ' + fatal);
  }
  finally {
    // Collected while the run directory is still the current one, and the
    // server is stopped whatever happened, so no failure path can leak a child
    // process holding the port.
    evidence = collectEvidence(info);
    warnings = accountWarnings(info ? info.stderrPath : null, {
      nodeFlags: info ? info.nodeFlags : [],
      appRoot: info ? info.appRoot : options.appRoot
    });

    // The boolean this used to discard is the whole answer: ./server resolves
    // `false` for an unclean stop instead of rejecting, so a child still
    // holding the port left no trace in the result document at all. `foldStop`
    // reads the value, the rejection and the launcher's own records; the pass
    // itself still returns whatever it produced.
    await foldStop('stop the application', server, 'test/parity/server.js',
      'test/parity/server.js');

    // Read as well: the launcher adopts ./mongo's records when it stopped a
    // database it provisioned, but a start that failed after the database came
    // up can leave a record the launcher never adopted. `recordCleanupFailure`
    // deduplicates, so reading both cannot double-count one fault.
    mongo.cleanupFailures().forEach(function(entry) {
      recordCleanupFailure(entry.operation + ' (test/parity/mongo.js)',
        entry.message);
    });
  }

  return {
    name: passName,
    secure: passName === PASS_SECURE,
    differential: !!context.differential,
    fatal: fatal,
    scenarios: scenarios.length,
    driven: scenarios.filter(function(entry) {
      return entry.result && entry.result.driven;
    }).length,
    baseUrl: info ? info.baseUrl : null,
    port: info ? info.port : null,
    appRoot: info ? info.appRoot : options.appRoot,
    appHead: info ? gitHead(info.appRoot) : null,
    runDir: info ? info.runDir : null,
    stdoutPath: info ? info.stdoutPath : null,
    stderrPath: info ? info.stderrPath : null,
    nodeFlags: info ? info.nodeFlags : [],
    mongo: info ? info.mongo : null,
    s3Seed: { path: s3Seed.path, entries: s3Seed.entries },
    seeded: seeded,
    sessions: sessions,
    applicationDied: died,
    undriven: undriven,
    evidence: evidence,
    warnings: warnings,
    ordering: describeOrdering(scenarios)
  };
}

/**
 * The launcher options for one pass.
 *
 * `secure` is the whole difference between the two passes. The fake Google
 * client is the same explicit top layer capture.js applies, because without it
 * the OAuth handlers short-circuit to a different branch than the one the
 * corpus recorded.
 *
 * @param {Object} options
 * @param {string} passName
 * @param {string} s3SeedPath
 * @returns {Object}
 */
function launcherOptions(options, passName, s3SeedPath) {
  var launcher = {
    appRoot: options.appRoot,
    s3Seed: s3SeedPath,
    secure: passName === PASS_SECURE,
    host: options.host,
    port: options.port,
    database: options.database,
    mongoUri: options.mongoUri,
    // The required deprecation flags are added here rather than demanded of
    // the caller. They are how the evidence is produced - a caller who forgot
    // them wanted the gate, not a lecture - and a suppressor passed
    // deliberately still surfaces in the audit and still fails the check. One
    // value may be space-separated, so the list is flattened first.
    nodeFlags: warningPolicy.childFlags(
      options.nodeFlags.reduce(function(flat, entry) {
        return flat.concat(warningPolicy.splitFlags(entry));
      }, [])),
    readyTimeoutMs: options.readyTimeoutMs,
    config: mergeGoogleStub(options.config)
  };

  if (options.overlay !== undefined) {
    launcher.overlay = options.overlay;
  }

  if (options.provisionMongo !== undefined) {
    launcher.provisionMongo = options.provisionMongo;
  }

  if (options.runDir) {
    launcher.runDir = path.join(options.runDir, passName);
  }

  return launcher;
}

/**
 * Merges the fake Google client into a caller's own top configuration layer.
 *
 * A caller that supplies `app.auth.google` itself wins, because an explicit
 * value is a decision; anything else keeps its own keys.
 *
 * @param {(Object|null)} supplied
 * @returns {Object}
 */
function mergeGoogleStub(supplied) {
  var out = { app: { auth: { google: GOOGLE_STUB } } };
  var app;

  if (!supplied) {
    return out;
  }

  out = JSON.parse(JSON.stringify(supplied));
  app = out.app = out.app || {};
  app.auth = app.auth || {};

  if (!app.auth.google) {
    app.auth.google = GOOGLE_STUB;
  }

  return out;
}

/**
 * The referer every request carries: the configured url, which is what the
 * application itself would compute and what the suite's own requests send.
 * Several handlers read it into the view metrics they persist, so it is part of
 * the behaviour rather than decoration.
 *
 * @param {(Object|null)} info the launcher's start result
 * @returns {string}
 */
function refererFor(info) {
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

  return info ? info.baseUrl : '';
}

/**
 * Whether any step of a scenario recorded a transport failure.
 *
 * @param {Object} result
 * @returns {boolean}
 */
function sawTransportFailure(result) {
  return (result.steps || []).some(function(step) {
    return step.outcome === OUTCOME_TRANSPORT;
  });
}

/**
 * Marks every scenario from `from` onwards as never reached.
 *
 * They share one cause, which is reported once, so the report does not carry
 * three hundred identical lines that say nothing about the routes they name.
 *
 * @param {Array.<Object>} scenarios
 * @param {number} from
 * @param {string} reason
 * @returns {Array.<Object>}
 */
function markRemainingUndriven(scenarios, from, reason) {
  var out = [];
  var index;

  for (index = from; index < scenarios.length; index++) {
    scenarios[index].result = {
      driven: false,
      compared: false,
      skipped: false,
      error: reason,
      steps: [],
      differences: [],
      observations: [],
      expectation: null,
      deviation: null,
      profileEvidence: null,
      outcome: OUTCOME_MISSING,
      neverReached: true
    };

    out.push({
      id: scenarios[index].id,
      reason: reason,
      neverReached: true
    });
  }

  return out;
}

/**
 * Reports the read-only-before-mutating property of the replayed order.
 *
 * The order is the corpus's own and is never changed here - a mutation replayed
 * early would change the fixture a later read-only case was recorded against,
 * and the corpus is already ordered that way by its recorder. This is an
 * observation about the artifact rather than a gate: a corpus that lost the
 * property would produce differences, and those are what fail.
 *
 * @param {Array.<Object>} scenarios
 * @returns {Object}
 */
function describeOrdering(scenarios) {
  var lastReadOnly = -1;
  var firstMutating = -1;

  scenarios.forEach(function(item, index) {
    if (item.mutating) {
      if (firstMutating === -1) {
        firstMutating = index;
      }
    }
    else {
      lastReadOnly = index;
    }
  });

  return {
    readOnly: scenarios.filter(function(item) { return !item.mutating; }).length,
    mutating: scenarios.filter(function(item) { return item.mutating; }).length,
    firstMutatingIndex: firstMutating,
    lastReadOnlyIndex: lastReadOnly,
    readOnlyBeforeMutating: firstMutating === -1 || lastReadOnly < firstMutating
  };
}

/**
 * One progress line per scenario, on stderr as it happens, so a long replay is
 * observable while it runs and a stall is attributable to a case.
 *
 * @param {Object} item
 * @param {number} index
 * @param {number} total
 * @returns {undefined}
 */
function reportScenario(item, index, total) {
  var result = item.result;
  var state;

  if (result.skipped) {
    state = 'unreachable-by-design';
  }
  else if (result.error) {
    state = 'COULD NOT DRIVE: ' + result.error;
  }
  else if (!result.compared) {
    state = result.outcome + ' (no baseline)';
  }
  else if (result.differences.length) {
    state = result.differences.length + ' DIFFERENCE(S): ' +
      result.differences.slice(0, 3).map(function(record) {
        return record.field;
      }).join(', ');
  }
  else {
    state = 'match';
  }

  if (result.deviation) {
    state += result.deviation.approved
      ? ' [APPROVED DEVIATION]'
      : ' [DEVIATION NOT AS APPROVED]';
  }

  if (result.expectation && !result.expectation.met) {
    state += (result.baselineExpectation && result.baselineExpectation.met
      ? ' [EXPECTATION NOT MET: '
      : ' [expectation unmet by the recorded baseline too, so it is a corpus ' +
        'finding rather than a replay failure: ') +
      result.expectation.failures.join('; ') + ']';
  }

  note('[' + (index + 1) + '/' + total + '] ' + item.id + ' -> ' + state);
}

// ---------------------------------------------------------------------------
// Classification and the verdict
// ---------------------------------------------------------------------------

var STATUS_MATCH       = 'match';
var STATUS_APPROVED    = 'approved-deviation';
var STATUS_DIFFERENCE  = 'difference';
var STATUS_UNDRIVEN    = 'undriven';
var STATUS_UNREACHABLE = 'unreachable-by-design';
var STATUS_NO_BASELINE = 'no-baseline';

/**
 * Classifies one replayed scenario.
 *
 * Six outcomes and only one of them is a pass with differences: an approved
 * deviation, whose marker was checked against what the deviation was approved
 * to BE. Under --self-check even that is a failure, because the tree under test
 * is the tree the corpus came from and against it nothing may differ.
 *
 * @param {Object} item
 * @param {Object} options
 * @returns {Object} {status, failing, reason}
 */
function classifyScenario(item, options) {
  var result = item.result;

  if (!result) {
    return {
      status: STATUS_UNDRIVEN,
      failing: true,
      reason: 'the scenario was never run'
    };
  }

  if (result.skipped) {
    return {
      status: STATUS_UNREACHABLE,
      failing: !item.unreachableReason,
      reason: item.unreachableReason ||
        'the scenario has no steps and carries no stated reason, so the gap ' +
        'cannot be reviewed'
    };
  }

  if (!result.driven || result.error) {
    return {
      status: STATUS_UNDRIVEN,
      failing: true,
      reason: result.error || 'the scenario could not be driven'
    };
  }

  if (!result.compared) {
    return {
      status: STATUS_NO_BASELINE,
      failing: true,
      reason: 'no step of this scenario carries a recorded response, so ' +
        'nothing was compared. Capture a baseline with capture.js; replay ' +
        'never records one.'
    };
  }

  // ONE decision path owns the deviation, and it is resolved BEFORE the
  // declared expectation and before the differences. Both parts of that order
  // are load-bearing. A scenario carrying an approved deviation is one whose
  // recorded baseline expectation the target is EXPECTED to violate - that
  // violation IS the deviation - so evaluating the expectation first would fail
  // every approved change before its marker was ever consulted. And a marker on
  // a scenario that did not change at all is a failure too, which
  // `verifyApprovedDeviation` already reports as an unmet contract ("the
  // approved deviation did NOT materialize"), so the no-difference case needs
  // no branch of its own here.
  //
  // `result.deviation` is set by runScenario exactly when the scenario carries
  // a marker and this is not a --self-check run, so this block covers every
  // case in which a deviation can be approved. Three further branches used to
  // repeat these two verdicts further down and none of them was reachable: the
  // conditions they tested had already returned here.
  if (result.deviation && !options.selfCheck) {
    if (result.deviation.approved) {
      return {
        status: STATUS_APPROVED,
        failing: false,
        reason: 'approved by ' +
          (item.expectedDeviation.approvedBy || 'its marker') +
          ' under rule ' + (item.expectedDeviation.rule || '(unstated)') +
          (result.expectation && !result.expectation.met
            ? '. The scenario\'s declared baseline expectation is no longer ' +
              'met, which is what the deviation changed: ' +
              result.expectation.failures.join('; ')
            : '')
      };
    }

    return {
      status: STATUS_DIFFERENCE,
      failing: true,
      reason: 'the scenario carries an approved-deviation marker but what ' +
        'happened is not what was approved: ' +
        result.deviation.failures.join('; ')
    };
  }

  if (result.expectation && !result.expectation.met &&
      result.baselineExpectation && result.baselineExpectation.met) {
    return {
      status: STATUS_DIFFERENCE,
      failing: true,
      reason: 'the recorded baseline meets this scenario\'s declared ' +
        'expectation and the target does not: ' +
        result.expectation.failures.join('; ')
    };
  }

  if (!result.differences.length) {
    return { status: STATUS_MATCH, failing: false, reason: null };
  }

  if (item.expectedDeviation && options.selfCheck) {
    return {
      status: STATUS_DIFFERENCE,
      failing: true,
      reason: '--self-check declares the tree under test to be the tree the ' +
        'corpus was captured from, so the approved deviation must NOT ' +
        'materialize here and this difference is a failure'
    };
  }

  if (!item.expectedDeviation) {
    return {
      status: STATUS_DIFFERENCE,
      failing: true,
      reason: options.annotations
        ? 'the scenario carries no approved-deviation marker in the corpus or ' +
          'in the annotations'
        : 'the scenario carries no approved-deviation marker. A CAPTURED ' +
          'corpus does not carry one - capture.js does not emit it - so if ' +
          'this difference is the approved deviation, join the markers back ' +
          'on with --annotations test/parity/corpus.json.'
    };
  }

  // The default, and the only case left: a scenario carrying a marker whose
  // contract was never evaluated. runScenario evaluates one for every marker
  // outside --self-check, so this is unreachable through the CLI and is kept as
  // the closing verdict rather than removed - a caller assembling a result
  // itself must not fall out of this function without one, and the safe answer
  // to "a difference with no verified approval" is that it is not approved.
  return {
    status: STATUS_DIFFERENCE,
    failing: true,
    reason: 'the difference carries a marker whose contract was not ' +
      'evaluated, so it is not approved'
  };
}

/**
 * Builds the whole result document for one pass, including its gates.
 *
 * @param {Object} pass the pass document from runPass
 * @param {Object} plan
 * @param {Object} manifestDocument
 * @param {Object} options
 * @param {boolean} selectionComplete whether every corpus scenario ran in this
 *   pass, which is what conditions the coverage gate
 * @param {Object} corpus the corpus document, for manifest key equality
 * @returns {Object}
 */
function accountPass(pass, plan, manifestDocument, options, selectionComplete,
  corpus) {
  var scenarios = plan.scenarios;
  var classified = [];
  var differences = [];
  var observations = [];
  var approved = [];
  var counts = {};
  var checks = [];
  var coverage = accountCoverage(manifestDocument.entries, scenarios);
  var failing = 0;

  scenarios.forEach(function(item) {
    var verdict = classifyScenario(item, options);
    var record = {
      id: item.id,
      group: item.group,
      route: item.routeKey,
      identity: item.identity,
      intent: item.intent,
      fixtureProfile: item.fixtureProfile,
      status: verdict.status,
      failing: verdict.failing,
      reason: verdict.reason,
      differences: item.result ? item.result.differences.length : 0,
      markerSource: item.markerSource
    };

    counts[verdict.status] = (counts[verdict.status] || 0) + 1;
    classified.push(record);

    if (verdict.failing) {
      failing++;
    }

    if (verdict.status === STATUS_APPROVED) {
      approved.push({
        id: item.id,
        route: item.routeKey,
        approvedBy: item.expectedDeviation.approvedBy || null,
        rule: item.expectedDeviation.rule || null,
        baseline: item.expectedDeviation.baseline || null,
        target: item.expectedDeviation.target || null,
        reason: item.expectedDeviation.reason || null,
        markerSource: item.markerSource.expectedDeviation,
        verified: item.result.deviation.verified,
        differences: item.result.differences
      });
      return;
    }

    if (item.result && item.result.differences.length && verdict.failing) {
      differences = differences.concat(
        item.result.differences.slice(0, MAX_DIFFERENCES_PER_STEP));

      if (item.result.differences.length > MAX_DIFFERENCES_PER_STEP) {
        differences.push({
          scenario: item.id,
          group: item.group,
          route: item.routeKey,
          step: '(summary)',
          field: '(further differences)',
          baselineValue: null,
          targetValue: null,
          note: item.result.differences.length - MAX_DIFFERENCES_PER_STEP +
            ' further difference(s) in this scenario are counted but not ' +
            'enumerated. The count is complete and the verdict is unaffected; ' +
            'only the listing is bounded, so one restructured page cannot ' +
            'fill the report.'
        });
      }
    }

    if (item.result) {
      observations = observations.concat(item.result.observations);
    }
  });

  checks.push(accountAuthOutcomes(scenarios, selectionComplete,
    pass.evidence));
  checks.push(accountHeaderResolvedChains(scenarios, selectionComplete));
  checks.push(accountGuestBrowsing(manifestDocument.entries, scenarios,
    selectionComplete));
  checks.push(accountFixtureProfiles(scenarios, selectionComplete));
  // Each of the four accounting checks above is pushed ONCE, with the full
  // argument list its definition declares. They were each pushed a second time
  // in the shorter form the signatures used to have, and the shorter form is
  // not a harmless duplicate: `accountAuthOutcomes(scenarios)` leaves
  // `evidence` undefined, so `checkInjectedFaults` takes the "this pass
  // collected no fault evidence at all" branch and reports the injected faults
  // NOT CONFIRMED while the pass's own `evidence.modelFault` records them -
  // measured, `faulted: 2, byId: {000000000000000000000101: 2}` reported as
  // "2 armed, no record". A duplicate that reaches a different verdict from the
  // same data makes the auth-outcome gate unpassable, so the argument-less
  // calls are gone rather than left as redundancy.
  // The warning check is re-judged here rather than in runPass, because the
  // breadth AAP 0.9.3 requires of this exercise - the whole route surface,
  // more than one identity, methods beyond GET, and the worker - is only known
  // once coverage has been accounted. `pass.warnings` is replaced by the
  // re-judged document so there is exactly one warning check in the report.
  pass.warnings = qualifyWarningEvidence(pass.warnings, coverage, scenarios,
    selectionComplete, readWorkerEvidence(options.workerEvidence));
  checks.push(pass.warnings);
  checks.push(accountCoverageCheck(coverage, selectionComplete));
  checks.push(accountManifestCardinality(manifestDocument, corpus,
    selectionComplete));
  checks.push(accountDeclaredExpectations(scenarios));

  return {
    pass: pass,
    coverage: coverage,
    scenarios: classified,
    counts: sortedKeys(counts),
    failingScenarios: failing,
    differences: differences,
    observations: observations,
    approvedDeviations: approved,
    checks: checks,
    failingChecks: checks.filter(function(check) {
      return !check.ok;
    }).map(function(check) {
      return check.name;
    })
  };
}

/**
 * The coverage gate, as a named check.
 *
 * @param {Object} coverage
 * @param {boolean} selectionComplete whether every corpus scenario ran
 * @returns {Object}
 */
function accountCoverageCheck(coverage, selectionComplete) {
  var failures = [];

  if (coverage.unknownRoutes.length) {
    failures.push(coverage.unknownRoutes.length + ' scenario route key(s) are ' +
      'not in the manifest, which means the corpus and the route surface are ' +
      'out of step: ' + coverage.unknownRoutes.join(', '));
  }

  if (coverage.unrepresented.length) {
    if (selectionComplete) {
      failures.push(coverage.unrepresented.length + ' of ' + coverage.routes +
        ' route(s) have no scenario in this replay. Every route must be ' +
        'represented, or listed as unreachable with a reason: ' +
        coverage.unrepresented.join(', '));
    }
  }

  return {
    name: 'route coverage',
    asserted: coverage.routes,
    ok: !failures.length,
    skipped: false,
    reason: coverage.unrepresented.length && !selectionComplete
      ? coverage.unrepresented.length + ' route(s) are outside this narrowed ' +
        'selection and are therefore not failed here. A narrowed run cannot ' +
        'stand as the coverage gate.'
      : null,
    entries: coverage.unrepresented,
    failures: failures
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Replays the corpus and returns the result document.
 *
 * Never throws for a difference - a difference is a result, and the exit code
 * carries it. It DOES throw when the replay cannot be performed at all: a
 * corpus that cannot be read, a corpus with no recorded baseline, a manifest
 * that cannot be produced, a pass that could not be launched. Those are not
 * comparisons that failed, they are comparisons that never happened, and
 * reporting them as a difference would be a lie in the other direction.
 *
 * @param {Object} options as `parseArguments` produces
 * @returns {Promise<Object>} the result document, carrying `exitCode`
 * @throws {ToolError} If the replay could not be performed.
 */
async function replay(options) {
  var corpusArtifact;
  var secureArtifact = null;
  var corpus;
  var annotations = null;
  var secureCorpus = null;
  var manifestDocument;
  var filter = compileFilter(options.only);
  var scratchDir;
  var passNames;
  var selectionComplete;
  var gate;
  var provenanceContext;
  var corpusProvenance;
  var secureProvenance = null;
  var normalizationProbes;
  var passes = [];
  var plans = {};
  var passName;
  var plan;
  var passResult;
  var index;
  var result;

  assertVolatileSetIntegrity();
  normalizationProbes = assertNormalizationRules();

  resetCleanupFailures();

  // Both destinations are resolved BEFORE anything is launched, so a run that
  // has nowhere to write its evidence fails in the first second rather than
  // after driving the whole corpus. A programmatic caller does not come through
  // parseArguments, which is the other reason the policy is applied here.
  options.out = options.out
    ? path.resolve(options.out)
    : resolveArtifactPath(ARTIFACT_NAMES.result, '--out');
  options.report = options.report
    ? path.resolve(options.report)
    : resolveArtifactPath(ARTIFACT_NAMES.report, '--report');

  options.appRoot = path.resolve(options.appRoot);

  if (!fs.existsSync(path.join(options.appRoot, 'app.js'))) {
    throw usageError('--app names ' + options.appRoot + ', which holds no ' +
      'application entry point. It must be a worktree of this repository.');
  }

  // The corpus is the REFERENCE every comparison in this run is made against,
  // so it is verified before it is consumed rather than trusted for carrying a
  // `scenarios` array. Two independent records are checked, and they establish
  // different things: the block the artifact carries about itself, which names
  // the generator blob and the analysed tree and re-computes the payload
  // digest, and the sidecar beside it, which is what `validateCorpusProvenance`
  // reconciles below against the bytes read here.
  corpusArtifact = readCorpusFile(options.corpus, 'corpus');
  verifyCorpusBlock(corpusArtifact, 'corpus', baselineExpectation(options));
  corpus = corpusArtifact.parsed;

  if (options.annotations) {
    // Markers, not measurements: `expectedDeviation` and `unreachableReason`
    // joined on by scenario id. No sidecar is required of it, and that is a
    // decision rather than an oversight - it is the hand-authored definition
    // file with no capture behind it, and nothing compared here comes from it.
    // A block is verified when the file carries one, and its absence is
    // reported rather than fatal, because refusing it would make the
    // documented `--annotations test/parity/corpus.json` invocation
    // impossible.
    annotations = readCorpus(options.annotations, 'annotations corpus', {
      roles: manifest.provenance.ROLES,
      optional: true
    });
  }

  if (options.secureCorpus) {
    // The secure pass compares against a capture of its own, so it is held to
    // exactly what the non-secure corpus is held to.
    secureArtifact = readCorpusFile(options.secureCorpus, 'secure-pass corpus');
    verifyCorpusBlock(secureArtifact, 'secure-pass corpus',
      baselineExpectation(options));
    secureCorpus = secureArtifact.parsed;
  }

  // The plan for the non-secure pass decides whether there is anything to
  // replay at all, so it is built before anything is launched. Building it also
  // validates every declared expectation against the grammar this file can
  // evaluate, which is why an unimplementable clause stops the run here.
  plans[PASS_NON_SECURE] = buildPlan(corpus, annotations, filter);

  assertReplayable(plans[PASS_NON_SECURE], options, corpus);

  // AFTER the replayability check, deliberately: a definitions-only corpus is
  // better diagnosed as "carries no recorded baseline" than as "has no
  // provenance sidecar", and the committed corpus.json is exactly that file.
  // A corpus that DOES carry recorded responses is a baseline recording, and
  // from here on it has to say which tree it recorded.
  provenanceContext = {
    appHead: gitHead(options.appRoot),
    selfCheck: !!options.selfCheck,
    baselineHead: options.baselineHead
  };

  corpusProvenance = validateCorpusProvenance(corpusArtifact, 'corpus',
    Object.assign({}, provenanceContext, {
      // The primary corpus is the NON-SECURE recording, and it is only held to
      // that where a second corpus makes the distinction load-bearing: a run
      // with one corpus drives both cookie configurations from it by
      // derivation, which the gate already refuses to call measured.
      expectSecure: options.secureCorpus ? false : undefined,
      otherDigest: secureArtifact ? secureArtifact.digest : null
    }));

  note('corpus provenance: captured from ' +
    (corpusProvenance.capturedTree.head || '(unknown)') + ' by ' +
    (corpusProvenance.generator.path || '(unknown)') + ' @ ' +
    (corpusProvenance.generator.head || '(unknown)') + '; artifact digest ' +
    corpusProvenance.artifactDigest.slice(0, 16));

  if (secureArtifact) {
    secureProvenance = validateCorpusProvenance(secureArtifact,
      'secure-pass corpus', Object.assign({}, provenanceContext, {
        expectSecure: true,
        otherDigest: corpusArtifact.digest
      }));

    note('secure-pass corpus provenance: ' +
      (secureProvenance.cookieMode.secure ? 'secure' : 'NON-SECURE') +
      ' capture from ' + (secureProvenance.capturedTree.head || '(unknown)'));
  }

  manifestDocument = resolveManifest(options);

  note('manifest: ' + manifestDocument.entries.length + ' route(s) from ' +
    options.manifestPath);
  note('corpus: ' + plans[PASS_NON_SECURE].scenarios.length + ' selected of ' +
    corpus.scenarios.length + ' scenario(s) in ' + options.corpus);

  passNames = options.pass === PASS_BOTH
    ? [PASS_NON_SECURE, PASS_SECURE]
    : [options.pass];

  // Two distinct properties, deliberately not conflated. A COMPLETE SELECTION
  // means every scenario in the corpus ran, which is what makes route coverage
  // accountable and is therefore what the coverage gate is conditioned on. A
  // GATE-QUALIFYING run satisfies every requirement AAP §0.9.3 puts on the gate
  // as a whole, which `qualifyGate` decides once the passes have run - it needs
  // the flags the children actually received and the manifest check's verdict,
  // neither of which is knowable here. So `--pass non-secure` still enforces
  // coverage - it does not narrow the scenario set - while being honestly
  // labelled as not the gate.
  // GATE-QUALIFYING run additionally drove both cookie configurations, which is
  // what AAP §0.9.3 requires of the gate as a whole. So `--pass non-secure`
  // still enforces coverage - it does not narrow the scenario set - while being
  // honestly labelled as not the gate.
  //
  // Selection and cookie configuration are NOT the whole of qualification. AAP
  // §0.9.3 measures the zero-warning condition over this same exercise, so a
  // run that produced no warning evidence cannot be the gate however cleanly it
  // compared: without --pending-deprecation a pending deprecation is silent, a
  // suppressor makes the stream meaningless, a narrowed or GET-only sweep
  // leaves most of the surface unmeasured, and the worker is a third of the
  // required exercise this tool cannot drive. Each of those is decided per pass
  // by `qualifyWarningEvidence` and folded in below, AFTER the passes have run,
  // because none of it can be known in advance.
  selectionComplete = !options.only.length;
  // A corpus whose provenance does not establish a capture of the base commit
  // makes the run a diagnostic too, on the same principle - and that is not
  // decided here either: `authenticated-corpus` in `qualifyGate` refuses gate
  // status while --allow-unreviewed-corpus is in force.

  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-replay-'));

  try {
    for (index = 0; index < passNames.length; index++) {
      passName = passNames[index];

      // A FRESH plan per pass. The plan objects carry each scenario's result,
      // so reusing one would have the second pass overwrite the first pass's
      // findings before they were accounted.
      plan = passName === PASS_SECURE
        ? securePassPlan(corpus, secureCorpus, annotations, filter)
        : buildPlan(corpus, annotations, filter);

      plans[passName] = plan;

      passResult = await runPass(passName, options, plan, {
        differential: passName === PASS_SECURE && !secureCorpus,
        scratchDir: scratchDir
      });

      // Coverage is enforced on EVERY pass with a complete selection, not on
      // the first one only: both passes now drive the same scenarios in the
      // same order, so each is independently accountable against the manifest,
      // and a --secure-corpus carrying a different scenario set gets its own
      // accounting rather than inheriting the other pass's.
      passes.push(accountPass(passResult, plan, manifestDocument, options,
        selectionComplete, corpus));
    }
  }
  finally {
    removeDirectory(scratchDir);
  }

  gate = qualifyGate(options, manifestDocument, passes, selectionComplete, {
    corpus: corpusProvenance,
    secureCorpus: secureProvenance,
    appHead: provenanceContext.appHead
  });

  result = buildResult(options, corpus, annotations, secureCorpus,
    manifestDocument, plans, passes, gate, {
      corpus: corpusProvenance,
      secureCorpus: secureProvenance,
      normalizationProbes: normalizationProbes
    });

  return result;
}

/**
 * Refuses to replay a corpus that carries no recorded baseline.
 *
 * The committed corpus ships as DEFINITIONS: every scenario has `baseline:
 * null` and every step `response: null`, because its own first note refuses to
 * fabricate one - "an invented status would make the parity gate pass against
 * a fiction". So this is checked BEFORE anything is launched, and it fails as
 * "could not be performed" rather than as a difference, because there was no
 * comparison. A corpus where SOME scenarios carry a baseline is replayed, and
 * the ones that do not are each failed individually, which is the honest
 * treatment of a partial capture.
 *
 * @param {Object} plan
 * @param {Object} options
 * @param {Object} corpus
 * @returns {undefined}
 * @throws {ToolError}
 */
function assertReplayable(plan, options, corpus) {
  var comparable = plan.scenarios.filter(function(item) {
    return item.steps.length && item.baselineRecorded;
  });
  var drivable = plan.scenarios.filter(function(item) {
    return item.steps.length;
  });

  if (!plan.scenarios.length) {
    throw usageError('no scenario in ' + options.corpus + ' matched ' +
      (options.only.length
        ? '--only ' + options.only.map(function(pattern) {
          return JSON.stringify(pattern);
        }).join(' ')
        : 'the selection'));
  }

  if (comparable.length) {
    return;
  }

  throw new ToolError('the corpus at ' + options.corpus + ' carries NO ' +
    'recorded baseline: ' + drivable.length + ' drivable scenario(s) and not ' +
    'one recorded response' +
    (corpus.summary && corpus.summary.captured === false
      ? ' (its own summary says captured: false' +
        (corpus.summary.baselinesPending
          ? ', baselinesPending: ' + corpus.summary.baselinesPending
          : '') + ')'
      : '') + '. There is nothing to compare against, and this file will not ' +
    'invent one - a fabricated baseline would make the parity gate pass ' +
    'against a fiction. Capture one first:\n' +
    '  node test/parity/capture.js --app <worktree at the base commit> ' +
    '--out <corpus> --expect-baseline\n' +
    'then replay against the migrated tree with --corpus <corpus> ' +
    '--annotations ' + DEFAULT_CORPUS + ', which joins the approved-deviation ' +
    'marker back on - a capture does not carry it.');
}

/**
 * Builds the plan for the secure cookie pass.
 *
 * With a --secure-corpus the pass is an ordinary exact replay of that corpus.
 * Without one it is the DERIVED differential described in the header: the same
 * scenarios, in the same order, compared against the non-secure recording with
 * the cookie attributes the secure configuration moves - and every other field
 * compared exactly, because `isSecure` moves nothing else.
 *
 * IT DRIVES THE WHOLE SELECTION AND IS NOT NARROWED TO THE COOKIE-SETTING
 * SCENARIOS, and that was a measurement rather than a preference. A first
 * version drove only the scenarios whose baseline set a cookie, which is the
 * subset the differential has anything to say about. It reported a difference
 * on `POST /api/interest`: several responses embed the yar FLASH, which is
 * cross-request session state, so a pass that skips the requests in between
 * arrives at that route with a different session than the recording did. The
 * sequence is part of the input, so the secure pass replays all of it.
 *
 * @param {Object} corpus
 * @param {(Object|null)} secureCorpus
 * @param {(Object|null)} annotations
 * @param {(function(Object): boolean|null)} filter
 * @returns {Object} the plan
 */
function securePassPlan(corpus, secureCorpus, annotations, filter) {
  var plan;

  if (secureCorpus) {
    return buildPlan(secureCorpus, annotations, filter);
  }

  plan = buildPlan(corpus, annotations, filter);
  plan.derived = true;

  note('the secure pass has no baseline of its own (none was captured with ' +
    '--secure), so it replays the same ' + plan.scenarios.length +
    ' scenario(s) in the same order and asserts the documented cookie ' +
    'differential, comparing every other field exactly. THIS RUN IS ' +
    'THEREFORE NOT GATE-QUALIFYING: the secure cookie contract is compared ' +
    'against a value this tool derived from the non-secure recording rather ' +
    'than one a secure baseline produced. Capture a corpus against a ' +
    '--secure server and pass --secure-corpus for the measured comparison ' +
    'AAP §0.9.3 asks for.');

  return plan;
}

/**
 * The teardown operations of this run that did not complete.
 *
 * Module-scoped because the two places that observe one - the per-pass server
 * stop in `runPass`'s `finally`, and the scratch removal in `replay`'s - are in
 * different frames from `buildResult`, which is where the verdict is assembled;
 * neither can return the answer without changing what it reports.
 */
var cleanupFailures = [];

/**
 * Records a teardown operation that did not complete, once.
 *
 * The note is left at each site, unchanged: those lines are the diagnostic
 * evidence and none of them was the defect. What this adds is the entry
 * `buildResult` folds into `gates`, so the failure reaches both the result
 * document and the exit code.
 *
 * DEDUPLICATED ON THE MESSAGE, because ./server adopts ./mongo's records when
 * it stopped a database it provisioned: one leaked mongod is reachable through
 * both accessors, both are read, and one fault must still be one entry.
 *
 * @param {string} operation What was attempted, phrased to follow 'could not'.
 * @param {string} message The measured cause.
 * @returns {undefined}
 */
function recordCleanupFailure(operation, message) {
  var seen = cleanupFailures.some(function(entry) {
    return entry.message === message;
  });

  if (!seen) {
    cleanupFailures.push({ operation: operation, message: message });
  }
}

/**
 * Forgets the recorded teardown failures, so a second `replay` in one process
 * does not inherit the first one's.
 *
 * @returns {undefined}
 */
function resetCleanupFailures() {
  cleanupFailures = [];
}

/**
 * Folds one lifecycle module's stop into the record, counting each fault once.
 *
 * Three channels carry a failure out of ./server's and ./mongo's `stop`, and a
 * `catch` sees only one of them: both modules RESOLVE `false` for an unclean
 * stop rather than rejecting, so that a caller's real result still reaches the
 * shell. The fulfilled value, the rejection and the module's own named records
 * are therefore all read here.
 *
 * @param {string} what The operation, phrased to follow 'could not'.
 * @param {Object} target ./server or ./mongo.
 * @param {string} attribution The module its own records come from.
 * @param {string} owner The module, for the generic entry.
 * @returns {Promise<undefined>}
 */
async function foldStop(what, target, attribution, owner) {
  var clean = true;
  var threw = false;
  var named;

  try {
    clean = (await target.stop()) !== false;
  }
  catch (err) {
    threw = true;
    clean = false;
    note('warning: could not ' + what + ': ' + reasonOf(err));
    recordCleanupFailure(what, reasonOf(err));
  }

  named = typeof target.cleanupFailures === 'function'
    ? target.cleanupFailures()
    : [];

  // The module's records name the operation as a bare phrase, so they are
  // carried through with an attribution rather than a second 'could not'.
  named.forEach(function(entry) {
    recordCleanupFailure(entry.operation + ' (' + attribution + ')',
      entry.message);
  });

  if (!clean && !threw && !named.length) {
    recordCleanupFailure(what, owner + ' reported an unclean stop without ' +
      'naming an operation, so something it started may still be running');
  }
}

/**
 * Removes a directory this tool created.
 *
 * Only ever called with a path from `mkdtempSync` in the system temp
 * directory, and it is checked here as well, because a recursive removal is not
 * something to leave to the caller's discipline.
 *
 * A refusal and a failure are both recorded as teardown faults: either way the
 * directory this run was responsible for is still there, and `buildResult`
 * carries that into the verdict rather than leaving it on stderr.
 *
 * @param {string} target
 * @returns {undefined}
 */
function removeDirectory(target) {
  var temp = os.tmpdir();

  if (!target || String(target).indexOf(path.join(temp, 'parity-replay-')) !== 0) {
    note('warning: declining to remove ' + target +
      ', which this run did not create');
    recordCleanupFailure('remove the scratch directory ' + target,
      'the path is not one this run created, so it was left as it is');
    return;
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
  }
  catch (err) {
    note('warning: could not remove the scratch directory ' + target + ': ' +
      reasonOf(err));
    recordCleanupFailure('remove the scratch directory ' + target,
      reasonOf(err));
  }
}

// ---------------------------------------------------------------------------
// The result document
// ---------------------------------------------------------------------------

/**
 * Builds the machine-readable result, and with it the verdict and exit code.
 *
 * Six things fail a run, and each is listed separately in `gates` so a reader
 * knows which one it was rather than inferring it from a number: an unapproved
 * difference, a scenario that could not be driven, a scenario with no baseline
 * to compare against, a failed named check - which includes route coverage and
 * the zero-warning condition - an application that died mid-pass, and a
 * teardown operation that did not complete.
 *
 * The last one is the only entry that also changes the CODE rather than only
 * the verdict: `cleanupFailures` answers EXIT_ERROR, because a live application
 * process, a leaked mongod or a surviving scratch directory means the run could
 * not be performed cleanly, which is not the same statement as "the comparison
 * found a difference". Every artifact is still written first, and every stderr
 * line is still printed.
 *
 * @param {Object} options
 * @param {Object} corpus
 * @param {(Object|null)} annotations
 * @param {(Object|null)} secureCorpus
 * @param {Object} manifestDocument
 * @param {Object} plans
 * @param {Array.<Object>} passes
 * @param {Object} gate as `qualifyGate` returns
 * @param {Object} evidence {corpus, secureCorpus, normalizationProbes}
 * @returns {Object}
 */
function buildResult(options, corpus, annotations, secureCorpus,
  manifestDocument, plans, passes, gate, evidence) {
  // `failingScenarios` counts SCENARIOS and `differenceRecords` counts
  // individual differences, and they are two different numbers - one
  // restructured page can contribute twenty-five records. The report used to
  // print the scenario count under the label "unapproved differences", which
  // understates a failure by as much as the fan-out of its worst scenario, so
  // both are carried and each is labelled as what it counts.
  var gates = {
    failingScenarios: 0,
    differenceRecords: 0,
    undriven: 0,
    missingBaselines: 0,
    failedChecks: [],
    applicationDied: false,
    fatalPasses: [],
    // One string per teardown operation that did not complete, in the same
    // shape as `failedChecks` and `fatalPasses`, so the result document carries
    // what leaked and not merely that something did.
    cleanupFailures: cleanupFailures.map(function(entry) {
      return 'could not ' + entry.operation + ': ' + entry.message;
    })
  };
  var approved = [];
  var result;

  passes.forEach(function(entry) {
    entry.scenarios.forEach(function(record) {
      if (!record.failing) {
        return;
      }

      if (record.status === STATUS_UNDRIVEN) {
        gates.undriven++;
        return;
      }

      if (record.status === STATUS_NO_BASELINE) {
        gates.missingBaselines++;
        return;
      }

      gates.failingScenarios++;
      // The COMPLETE count, taken from the scenario record rather than from the
      // enumerated list, which is capped at MAX_DIFFERENCES_PER_STEP per
      // scenario for the report's sake.
      gates.differenceRecords += record.differences;
    });

    entry.failingChecks.forEach(function(name) {
      gates.failedChecks.push(entry.pass.name + ': ' + name);
    });

    if (entry.pass.applicationDied.died) {
      gates.applicationDied = true;
    }

    if (entry.pass.fatal) {
      gates.fatalPasses.push(entry.pass.name + ': ' + entry.pass.fatal);
    }

    approved = approved.concat(entry.approvedDeviations.map(function(record) {
      var copy = JSON.parse(JSON.stringify(record));

      copy.pass = entry.pass.name;

      return copy;
    }));
  });

  result = {
    schema: 1,
    tool: 'test/parity/replay.js',
    verdict: null,
    exitCode: null,
    gateQualifying: gate.qualifying,
    gateQualifyingReason: gate.qualifying
      ? null
      : unmetGateReason(gate, options, passes),
    gateQualification: {
      requirements: gate.requirements,
      unmet: gate.unmet,
      note: 'AAP §0.9.3 decides what the gate is; this list is that decision, ' +
        'requirement by requirement. None of these fails the run - a narrowed ' +
        'diagnostic is a legitimate thing to run - they decide whether this ' +
        'run may be cited AS the gate.'
    },
    // The zero-warning gate this run was judged against, and the evidence it
    // stands on. Persisted so the artifact says which bar was applied and
    // under which flags, rather than leaving a reader to infer it from a
    // command nobody recorded.
    warningGate: {
      policy: warningPolicy.POLICY,
      workerEvidence: options.workerEvidence,
      passes: passes.map(function(entry) {
        var warnings = entry.pass.warnings || {};

        return {
          pass: entry.pass.name,
          nodeFlags: entry.pass.nodeFlags,
          flags: warnings.flags || null,
          gateApplies: warnings.gateApplies !== false,
          qualifying: !!warnings.qualifying,
          ok: warnings.ok !== false,
          notices: warnings.notices || [],
          requirements: warnings.requirements || [],
          worker: warnings.workerEvidence || null,
          stderrPath: warnings.stderrPath || null
        };
      })
    },
    selfCheck: !!options.selfCheck,
    gates: gates,
    approvedDeviations: approved,
    volatileSet: describeVolatileSet(evidence.normalizationProbes),
    comparisonContract: {
      binaryBodies: describeBinaryBodyContract()
    },
    sources: {
      appRoot: options.appRoot,
      appHead: gitHead(options.appRoot),
      corpus: options.corpus,
      corpusDigest: evidence.corpus ? evidence.corpus.artifactDigest : null,
      corpusProvenance: evidence.corpus,
      secureCorpusProvenance: evidence.secureCorpus,
      corpusSchema: corpus.schema === undefined ? corpus.version : corpus.schema,
      corpusScenarios: corpus.scenarios.length,
      // Derived from the records rather than from a summary key, because
      // capture.js writes no `captured` flag - only the hand-authored
      // definition corpus carries one, where it is false. Counting the
      // scenarios that actually hold a recorded response says the same thing
      // and cannot go stale.
      corpusScenariosWithBaseline: plans[PASS_NON_SECURE].scenarios
        .filter(function(item) { return item.baselineRecorded; }).length,
      corpusScenariosDrivable: plans[PASS_NON_SECURE].scenarios
        .filter(function(item) { return item.steps.length; }).length,
      annotations: options.annotations,
      annotationsUsed: plans[PASS_NON_SECURE].annotationsUsed,
      annotationsUnknown: plans[PASS_NON_SECURE].unknownAnnotations,
      secureCorpus: options.secureCorpus,
      manifest: options.manifestPath,
      manifestRoutes: manifestDocument.entries.length,
      selection: options.only.length ? options.only.slice() : 'all',
      skippedByFilter: plans[PASS_NON_SECURE].skipped.length,
      passesRequested: options.pass
    },
    passes: passes.map(summarizePass)
  };

  if (gates.fatalPasses.length) {
    result.verdict = 'NOT PERFORMED';
    result.exitCode = EXIT_ERROR;
  }
  // `failingScenarios` is this document's name for the difference count the
  // predicate used to read as `differences`; `cleanupFailures` is the teardown
  // fault that must reach the exit code even when every comparison matched.
  else if (gates.failingScenarios || gates.undriven || gates.missingBaselines ||
           gates.failedChecks.length || gates.applicationDied ||
           gates.cleanupFailures.length) {
    result.verdict = 'FAIL';
    // A teardown fault is OPERATIONAL and dominates: the passes may have
    // compared cleanly, but this process could not release what it acquired, so
    // the honest code is "could not be performed cleanly" rather than "found a
    // difference". A code already at EXIT_ERROR is never lowered.
    result.exitCode = gates.cleanupFailures.length
      ? EXIT_ERROR
      : EXIT_DIFFERENCE;
  }
  else {
    result.verdict = 'PASS';
    result.exitCode = EXIT_OK;
  }

  return result;
}

/**
 * The specific warning shortfalls of each pass, by name.
 *
 * AAP 0.9.3 measures the zero-warning condition over THIS exercise, so a run
 * that cannot vouch for its own stream is not the gate - and a reader is owed
 * the reason, because a missing flag and a GET-only sweep are different
 * problems with different fixes. Read in two places, deliberately: the
 * `warning-evidence` requirement in `qualifyGate` is decided on it, and
 * `unmetGateReason` reports it.
 *
 * @param {Array.<Object>} passes
 * @returns {Array.<string>}
 */
function warningShortfalls(passes) {
  var shortfalls = [];

  // The warning evidence, stated as the specific shortfall rather than as a
  // category. AAP §0.9.3 measures the zero-warning condition over this exercise,
  // so a run that cannot vouch for its own stream is not the gate, and a reader
  // is owed the reason - a missing flag and a GET-only sweep are different
  // problems with different fixes.
  (passes || []).forEach(function(entry) {
    var warnings = entry.pass && entry.pass.warnings;

    if (!warnings || warnings.qualifying) {
      return;
    }

    if (warnings.skipped) {
      shortfalls.push('the ' + entry.pass.name + ' pass launched no application, ' +
        'so it produced no warning evidence');
      return;
    }

    if (!warnings.gateApplies) {
      shortfalls.push('the ' + entry.pass.name + ' pass measured a tree that is ' +
        'not this worktree, so its stream is a measurement of that tree and ' +
        'not this gate');
      return;
    }

    if (!warnings.flags.complete) {
      shortfalls.push('the ' + entry.pass.name + ' pass produced no warning ' +
        'evidence: ' +
        (warnings.flags.missing.length
          ? warnings.flags.missing.join(' ') + ' were not in force'
          : 'warnings were suppressed by ' +
            warnings.flags.suppressors.join(' ')));
      return;
    }

    (warnings.requirements || []).forEach(function(item) {
      if (!item.met) {
        shortfalls.push('the ' + entry.pass.name + ' pass did not measure the ' +
          'whole exercise - ' + item.id);
      }
    });
  });

  return shortfalls;
}

/**
 * Why a run does not qualify as the gate, from the requirements it missed.
 *
 * Derived from `qualifyGate`'s own records rather than restated, so the reason
 * cannot drift from the predicate: a requirement added there appears here
 * without being written twice, and a run labelled non-qualifying can always
 * name which requirement did it.
 *
 * @param {Object} gate as `qualifyGate` returns
 * @returns {string}
 */
function unmetGateReason(gate, options, passes) {
  var reasons = gate.requirements.filter(function(entry) {
    return !entry.met;
  }).map(function(entry) {
    return entry.id + ': ' + (entry.detail || 'the requirement was not met');
  });

  // --only and --pass are already named by the `complete-selection` and
  // `both-cookie-passes` requirements above, so they are not repeated. The
  // diagnostic escape is not a gate requirement and would otherwise go
  // unmentioned.
  if (options.allowUnreviewedCorpus) {
    reasons.push('--allow-unreviewed-corpus accepted a corpus whose ' +
      'provenance does not establish a capture of the base commit ' +
      manifest.provenance.BASELINE_HEAD.slice(0, 7) + ', so the reference ' +
      'these comparisons were made against is not baseline evidence');
  }


  reasons = reasons.concat(warningShortfalls(passes));

  return reasons.join('; ') ||
    'the run did not satisfy the gate requirements';
}

/**
 * The volatile set as it was applied, for the artifact.
 *
 * Emitted in full, justifications included, so docs/baseline-parity.md can
 * cite them verbatim: every entry here is a field the migration is not checked
 * on, and that list belongs in the evidence rather than only in the source.
 *
 * The measured probe results travel with it. A declared rule that does not fire
 * is not distinguishable from an absent one by reading the artifact, and the
 * cache-prefix rule is the case where that matters: every rendered page carries
 * a `/cache-prefix-<epoch>/` asset URL, so a reviewer needs to see that the
 * rule fired rather than take the declaration's word for it.
 *
 * @param {Array.<Object>} [probes] as `assertNormalizationRules` returns
 * @returns {Object}
 */
function describeVolatileSet(probes) {
  return {
    categories: VOLATILE_SET.map(function(category) {
      return {
        id: category.id,
        title: category.title,
        why: category.why,
        seedingAlternative: category.seedingAlternative,
        coverageLost: category.coverageLost,
        headersRemoved: (category.headers || []).slice(),
        headersComparedForPresenceOnly: (category.presenceOnlyHeaders || []).slice(),
        cookieFieldsNotCompared: (category.cookieFields || []).slice(),
        recordedFieldsNotCompared: (category.responseFields || []).slice(),
        binaryDigestExemptTypes: (category.binaryDigestExemptTypes || []).slice(),
        textPatterns: (category.textPatterns || []).map(function(pattern) {
          return { name: pattern.name, expression: String(pattern.expression) };
        })
      };
    }),
    appliedHeadersRemoved: VOLATILE_HEADERS.slice(),
    appliedHeadersPresenceOnly: PRESENCE_ONLY_HEADERS.slice(),
    appliedCookieFields: VOLATILE_COOKIE_FIELDS.slice(),
    appliedRecordedFields: VOLATILE_RESPONSE_FIELDS.slice(),
    appliedArchiveDigestExempt: ARCHIVE_DIGEST_EXEMPT.slice(),
    normalizationProbes: (probes || []).map(function(record) {
      return {
        id: record.id,
        category: record.category,
        rule: record.rule,
        what: record.what,
        input: record.input,
        normalizedTo: record.observed,
        rulesApplied: record.rulesApplied,
        ok: record.ok
      };
    }),
    normalizationProbeNote: 'Each probe is RUN at startup and the run refuses ' +
      'to proceed if one does not hold, so this section is a measurement ' +
      'rather than a restatement of the rules above. They assert both halves ' +
      'of every rule: that the volatile part IS normalized, and that the ' +
      'value around it is NOT - a rule that swallowed the rest of an asset ' +
      'URL would stop comparing asset paths altogether.',
    note: 'Six categories, fixed. An addition is a weakening and has to be ' +
      'justified in docs/baseline-parity.md, naming the field, why seeding ' +
      'could not make it deterministic instead, and what coverage is lost. ' +
      'Everything else is compared exactly.'
  };
}

/**
 * Reduces one accounted pass to what belongs in the artifact.
 *
 * The per-scenario records and the differences are kept in full - they are the
 * evidence - while the raw response records are not: the artifact says what
 * differed, and the corpus already holds what was recorded.
 *
 * @param {Object} entry
 * @returns {Object}
 */
function summarizePass(entry) {
  return {
    name: entry.pass.name,
    secure: entry.pass.secure,
    differential: entry.pass.differential,
    fatal: entry.pass.fatal,
    scenarios: entry.pass.scenarios,
    driven: entry.pass.driven,
    counts: entry.counts,
    failingScenarios: entry.failingScenarios,
    baseUrl: entry.pass.baseUrl,
    port: entry.pass.port,
    appRoot: entry.pass.appRoot,
    appHead: entry.pass.appHead,
    nodeFlags: entry.pass.nodeFlags,
    runDir: entry.pass.runDir,
    stdoutPath: entry.pass.stdoutPath,
    stderrPath: entry.pass.stderrPath,
    mongo: entry.pass.mongo,
    seeded: entry.pass.seeded,
    sessions: entry.pass.sessions,
    s3Seed: entry.pass.s3Seed,
    ordering: entry.pass.ordering,
    applicationDied: entry.pass.applicationDied,
    undriven: entry.pass.undriven,
    evidence: entry.pass.evidence,
    coverage: entry.coverage,
    checks: entry.checks,
    approvedDeviations: entry.approvedDeviations,
    differences: entry.differences,
    observations: entry.observations,
    scenarioResults: entry.scenarios
  };
}

/**
 * The label for a path, so no block this file writes carries an absolute one.
 *
 * @param {(string|null|undefined)} target
 * @param {string} appRoot the tree under test
 * @returns {(string|null)}
 */
function pathLabelFor(target, appRoot) {
  return manifest.provenance.pathLabel(target, {
    toolRoot: TOOL_ROOT,
    analysedRoot: appRoot
  });
}

/**
 * A recorded reason, made safe to write into a provenance block.
 *
 * The contract's guard rejects any value CONTAINING an absolute path or an ISO
 * instant, not merely one that starts with one, and a reason is the one field
 * here whose value is an underlying error's own words - which for a
 * filesystem error is a quoted machine path. Delegated to
 * `provenance.portableText` rather than matched locally, so this file and
 * capture.js sanitize by one implementation: it replaces every embedded path
 * with the same label `pathLabel` would give it and every instant with a
 * marker, and keeps the words that say what happened.
 *
 * @param {*} value
 * @param {string} appRoot the tree under test
 * @returns {(string|null)}
 */
function portableReason(value, appRoot) {
  return manifest.provenance.portableText(value, {
    toolRoot: TOOL_ROOT,
    analysedRoot: appRoot
  });
}

/**
 * The `--only` patterns, labelled so a regular expression is not mistaken for
 * a path.
 *
 * `--only /quirk\./` is a regular expression wrapped in slashes, which is
 * exactly the shape the contract's guard rejects as an absolute path - and it
 * is right to reject the shape, because a value it cannot tell apart from a
 * machine path must not reach a committed block unlabelled. The prefix is the
 * same device `pathLabel` uses: it says what the string IS, and it keeps the
 * pattern readable instead of reducing it to a count.
 *
 * @param {Array.<string>} patterns
 * @returns {Array.<string>}
 */
function patternLabels(patterns) {
  return (patterns || []).map(function(pattern) {
    return 'pattern:' + String(pattern);
  });
}

/**
 * The identity an input artifact records about itself, as this run read it.
 *
 * A replay is only as attributable as the evidence it consumed, so the result
 * names each input by the commit and generator that input claims - not by the
 * path it happened to sit at. `readCorpus` and `verifiedManifest` have already
 * refused anything whose block does not hold up, so what is recorded here is a
 * VERIFIED identity rather than a copied assertion. A file with no block
 * reaches this point only where absence is permitted, and says so.
 *
 * @param {(string|null)} target
 * @param {string} appRoot
 * @returns {(Object|null)}
 */
function inputIdentity(target, appRoot) {
  var block;

  if (!target) {
    return null;
  }

  try {
    block = manifest.provenance.extract(fs.readFileSync(target, 'utf8'));
  }
  catch (err) {
    return {
      artifact: pathLabelFor(path.resolve(target), appRoot),
      recorded: false,
      // Through portableText, because this is the one field here that carries
      // an underlying error's own words and a filesystem error's words are a
      // path: an ENOENT message reaching the block verbatim throws in the
      // contract's guard at write time, which is after the whole replay has
      // run. The words are kept and the machine-specific parts are labelled.
      reason: portableReason('could not be re-read while writing this block: ' +
        reasonOf(err), appRoot)
    };
  }

  if (!block) {
    return {
      artifact: pathLabelFor(path.resolve(target), appRoot),
      recorded: false,
      reason: 'the artifact carries no provenance block, which this consumer ' +
        'permits only for authored markers'
    };
  }

  return {
    artifact: block.artifact,
    recorded: true,
    role: block.role,
    analysedHead: block.analysedTree ? block.analysedTree.head : null,
    analysedIsBaseline: !!(block.analysedTree &&
      block.analysedTree.isBaselineCommit),
    generator: block.generator ? block.generator.path : null,
    generatorBlob: block.generator ? block.generator.blob : null,
    generatorCommit: block.generator ? block.generator.commit : null,
    generatorVerified: !!(block.generator && block.generator.verified),
    deliveredHead: block.delivered ? block.delivered.head : null,
    payloadDigest: block.payloadDigest || null
  };
}

/**
 * Builds the replay result's provenance block.
 *
 * "Replayed against the migrated tree" means replayed BY target-worktree
 * tooling against a particular install of a particular commit, and this block
 * is what makes that claim checkable. It is built by the shared contract in
 * `./manifest`, which is what removes the three things this record used to
 * assert without being able to prove:
 *
 *   the tool identified itself by `toolRoot` plus the HEAD of whatever
 *   worktree ran it. A path is machine state and that HEAD belonged to a
 *   clone, not to an artifact - so the tool is now named by the git BLOB that
 *   ran and the commit verified to contain it;
 *
 *   `generatedAt` was a wall clock, which made two runs over one tree differ
 *   for no reason a reviewer could act on. There is no clock here, so a
 *   re-run over one tree produces the same block; and
 *
 *   each pass carried its `appRoot`, `port`, `baseUrl`, `runDir`, `stderrPath`
 *   and Mongo settings. Every one of those is run-local. What a reader needs
 *   from a pass is what it MEANT - which cookie configuration, whether it
 *   compared against a capture or asserted the documented differential, which
 *   node flags were in force, how many scenarios were driven, and which tree
 *   it drove - and that is what is kept.
 *
 * The result's own `sources` and `passes` keep their full detail, absolute
 * paths included: they are the run's report, and the contract's guard applies
 * to the provenance block. What is NOT allowed is for that unattributable
 * detail to be the artifact's provenance.
 *
 * @param {Object} options
 * @param {Object} result
 * @returns {Object}
 */
/**
 * A requirement list reduced to its verdicts, for the provenance block.
 *
 * Every key is kept except the free-form `detail` and `reason`, and that is
 * the whole point: a requirement's prose enumerates route paths, and an HTTP
 * route path is indistinguishable from a filesystem path to the contract's
 * portability guard. Measured, `provenance.portableText` rewrites
 * `DELETE /api/admin/featured-course/{courseId}` to
 * `DELETE ephemeral:featured-course{courseId}`, so making the prose portable
 * would corrupt the very names it exists to report.
 *
 * Nothing is lost. The block needs to name WHICH requirement was unmet, which
 * is its id and its verdict; the verbatim prose is carried at the result
 * document's own top level, where full detail belongs.
 *
 * @param {Array.<Object>} list
 * @returns {Array.<Object>}
 */
function requirementVerdicts(list) {
  return (list || []).map(function(entry) {
    var projected = {};

    Object.keys(entry).forEach(function(key) {
      if (key === 'detail' || key === 'reason') {
        return;
      }

      projected[key] = entry[key];
    });

    return projected;
  });
}

/**
 * Recorded evidence made portable, whatever shape it arrived in.
 *
 * A warning notice is the runtime's own words and may name a file; worker
 * evidence is a nested object that may carry a path several levels down. Both
 * are walked so a run-local path is labelled wherever it sits, which is what
 * lets this evidence travel in a provenance block at all.
 *
 * @param {*} value
 * @param {string} appRoot the tree under test
 * @returns {*}
 */
function portableEvidence(value, appRoot) {
  if (typeof value === 'string') {
    return portableReason(value, appRoot);
  }

  if (Array.isArray(value)) {
    return value.map(function(item) {
      return portableEvidence(item, appRoot);
    });
  }

  if (value && typeof value === 'object') {
    return Object.keys(value).reduce(function(carried, key) {
      carried[key] = portableEvidence(value[key], appRoot);
      return carried;
    }, {});
  }

  return value;
}

function buildProvenance(options, result) {
  var provenance = manifest.provenance;
  var appRoot = path.resolve(options.appRoot);
  var tree = provenance.treeIdentity(appRoot);

  return provenance.build({
    artifact: options.out,
    // The role follows the tree that was DRIVEN, which is what this artifact
    // is evidence about: the migrated tree is `target`, and the base commit is
    // `baseline`, which is what --self-check's rehearsal against the captured
    // tree produces.
    role: tree.isBaselineCommit ? 'baseline' : 'target',
    generatorFile: __filename,
    toolRoot: TOOL_ROOT,
    analysedRoot: appRoot,
    detail: {
      resultSchema: result.schema,
      verdict: result.verdict,
      exitCode: result.exitCode,
      // Whether this run stands as the gate, and if not, why - carried in the
      // provenance as well as in the result, so a block detached from its
      // artifact still cannot be read as the gate.
      gateQualifying: result.gateQualifying,
      // A reason is the one field that legitimately carries prose, so it keeps
      // its words and loses only the run-local parts of them.
      gateQualifyingReason: portableReason(result.gateQualifyingReason, appRoot),
      // The requirement-by-requirement verdict, not only its conclusion: a
      // block that says `false` without naming which of the requirements was
      // unmet cannot be audited. Verdicts only - see `requirementVerdicts`.
      gateQualification: {
        requirements: requirementVerdicts(result.gateQualification.requirements),
        unmet: (result.gateQualification.unmet || []).slice()
      },
      // The warning gate travels with the provenance as well as with the
      // result: which bar was applied, and under which flags, is part of what
      // this artifact is evidence of. The bar and the flags are reproducible
      // as recorded; the per-pass stderr file is not, so it becomes a label,
      // exactly as each pass's own stderr does below.
      warningGate: {
        policy: result.warningGate.policy,
        workerEvidence: result.warningGate.workerEvidence,
        passes: (result.warningGate.passes || []).map(function(entry) {
          return {
            pass: entry.pass,
            nodeFlags: (entry.nodeFlags || []).slice(),
            flags: entry.flags,
            gateApplies: entry.gateApplies,
            qualifying: entry.qualifying,
            ok: entry.ok,
            notices: portableEvidence(entry.notices || [], appRoot),
            requirements: requirementVerdicts(entry.requirements),
            worker: portableEvidence(entry.worker, appRoot),
            stderrLog: pathLabelFor(entry.stderrPath, appRoot)
          };
        })
      },
      selfCheck: result.selfCheck,
      passesRequested: options.pass,
      selection: options.only.length ? 'filtered' : 'all',
      selectionPatterns: patternLabels(options.only),
      unreviewedCorpusAccepted: !!options.allowUnreviewedCorpus,
      // Each input by the identity it records about itself, verified before it
      // was consumed. This is what ties the whole set to one target state:
      // corpus, secure corpus, annotations and route manifest each name the
      // tree they describe and the generator that wrote them.
      inputs: {
        corpus: inputIdentity(options.corpus, appRoot),
        secureCorpus: inputIdentity(options.secureCorpus, appRoot),
        annotations: inputIdentity(options.annotations, appRoot),
        routeManifest: inputIdentity(options.manifestPath, appRoot)
      },
      corpusScenarios: result.sources.corpusScenarios,
      corpusScenariosWithBaseline: result.sources.corpusScenariosWithBaseline,
      manifestRoutes: result.sources.manifestRoutes,
      passes: result.passes.map(function(entry) {
        return {
          name: entry.name,
          secure: !!entry.secure,
          differential: !!entry.differential,
          nodeFlags: (entry.nodeFlags || []).slice(),
          scenarios: entry.scenarios,
          driven: entry.driven,
          // The tree each pass drove, by commit. The launcher reports the
          // path it used; the commit is what identifies it.
          appHead: entry.appHead || null,
          appIsBaseline: provenance.isBaselineHead(entry.appHead || null),
          // The application's own stderr, as a label: the file lives in the
          // launcher's per-run directory, whose name carries a PID, and only
          // its basename is reproducible.
          stderrLog: pathLabelFor(entry.stderrPath, appRoot)
        };
      }),
      artifacts: {
        result: pathLabelFor(path.resolve(options.out), appRoot),
        report: pathLabelFor(path.resolve(options.report), appRoot)
      }
    }
  });
}

// ---------------------------------------------------------------------------
// The human report
// ---------------------------------------------------------------------------

/**
 * Renders the human report.
 *
 * Written to a FILE, always, so docs/baseline-parity.md can cite it - a report
 * that existed only on a terminal is not evidence. The approved deviation gets
 * a section of its own, before the differences, because a clean exit that
 * contains an intended behaviour change must not be read as "nothing changed".
 *
 * @param {Object} result
 * @param {Object} options
 * @returns {string}
 */
function renderReport(result, options) {
  var lines = [];

  function heading(text) {
    lines.push('');
    lines.push(text);
    lines.push(new Array(text.length + 1).join('='));
  }

  function bullet(text) {
    lines.push('  - ' + text);
  }

  lines.push('TRINKET PARITY REPLAY');
  lines.push('=====================');
  lines.push('');
  lines.push('VERDICT        ' + result.verdict + ' (exit ' + result.exitCode + ')');
  lines.push('gate run       ' + (result.gateQualifying
    ? 'yes - the full corpus in both cookie configurations'
    : 'NO - ' + result.gateQualifyingReason));

  if (result.selfCheck) {
    lines.push('mode           --self-check: the tree under test is declared ' +
      'to be the tree the');
    lines.push('               corpus was captured from, so EVERY difference ' +
      'fails and an');
    lines.push('               approved deviation that materializes fails too.');
  }

  lines.push('application    ' + result.sources.appRoot +
    (result.sources.appHead ? ' @ ' + result.sources.appHead : ''));
  lines.push('corpus         ' + result.sources.corpus + ' (' +
    result.sources.corpusScenarios + ' scenarios, schema ' +
    result.sources.corpusSchema + ', ' +
    result.sources.corpusScenariosWithBaseline + ' of ' +
    result.sources.corpusScenariosDrivable +
    ' drivable ones carrying a recorded baseline)');

  if (result.sources.corpusProvenance) {
    lines.push('corpus origin  captured from ' +
      (result.sources.corpusProvenance.capturedTree.head || '(unknown)') +
      ' by ' + (result.sources.corpusProvenance.generator.path || '(unknown)') +
      ' @ ' + (result.sources.corpusProvenance.generator.head || '(unknown)'));
    lines.push('corpus digest  ' + result.sources.corpusProvenance.artifactDigest +
      (result.sources.corpusProvenance.digestVerified
        ? ' (matches the digest its sidecar declares)'
        : ' (computed here; the sidecar declares none)'));
  }

  lines.push('annotations    ' + (result.sources.annotations || '(none)'));
  lines.push('secure corpus  ' + (result.sources.secureCorpus || '(none - the ' +
    'secure pass asserts the documented differential)'));
  lines.push('manifest       ' + result.sources.manifest + ' (' +
    result.sources.manifestRoutes + ' routes)');
  lines.push('selection      ' + (Array.isArray(result.sources.selection)
    ? result.sources.selection.join(' ')
    : result.sources.selection));

  heading('GATES');
  bullet('failing scenarios (unapproved difference)  ' +
    result.gates.failingScenarios);
  bullet('difference records in them                 ' +
    result.gates.differenceRecords +
    ' (the complete count; the listing below is capped at ' +
    MAX_DIFFERENCES_PER_STEP + ' per scenario)');
  bullet('scenarios not driven     ' + result.gates.undriven);
  bullet('scenarios with no baseline ' + result.gates.missingBaselines);
  bullet('failed named checks      ' + (result.gates.failedChecks.length
    ? result.gates.failedChecks.join('; ')
    : '0'));
  bullet('application died         ' + (result.gates.applicationDied ? 'YES' : 'no'));
  bullet('failed teardown          ' + (result.gates.cleanupFailures.length
    ? result.gates.cleanupFailures.join('; ')
    : '0'));

  if (result.gates.fatalPasses.length) {
    bullet('passes not performed     ' + result.gates.fatalPasses.join('; '));
  }

  renderGateQualification(lines, result, heading);
  renderApprovedSection(lines, result, heading, bullet);

  result.passes.forEach(function(pass) {
    renderPass(lines, pass, result, heading, bullet);
  });

  renderVolatileSection(lines, result, heading, bullet);
  renderBinaryContract(lines, result, heading, bullet);
  renderClosing(lines, result, options, heading);

  return lines.join('\n') + '\n';
}

/**
 * What the gate requires, requirement by requirement, met or not.
 *
 * Rendered whatever the verdict, because "this run was the gate" is a claim in
 * its own right and a reader has to be able to check it without reading the
 * source. A run that satisfies every comparison and misses a requirement here
 * is a clean diagnostic, not the parity gate, and the two must not read the
 * same.
 *
 * @param {Array.<string>} lines
 * @param {Object} result
 * @param {function(string): undefined} heading
 * @returns {undefined}
 */
function renderGateQualification(lines, result, heading) {
  heading('GATE QUALIFICATION (AAP §0.9.3)');

  result.gateQualification.requirements.forEach(function(entry) {
    lines.push('  ' + (entry.met ? 'met ' : 'NOT ') + '  ' + entry.id +
      ' - ' + entry.requirement);

    if (entry.detail) {
      lines.push('          ' + entry.detail);
    }
  });

  lines.push('');
  lines.push('  ' + (result.gateQualifying
    ? 'Every requirement is met, so this run may be cited as the parity gate.'
    : result.gateQualification.unmet.length + ' requirement(s) unmet, so this ' +
      'run is a DIAGNOSTIC. It can still'));

  if (!result.gateQualifying) {
    lines.push('  exit 0 - a narrowed comparison that matches is a real ' +
      'result - but it does not stand');
    lines.push('  as the gate, and a document citing it as one would ' +
      'overstate what was measured.');
  }
}

/**
 * The comparison contract for binary and stream bodies, as it is applied.
 *
 * In the report because a document that quotes "length and content digest"
 * without its exception overstates the gate: the digest is an OBSERVATION for
 * the enumerated archive container types, whose headers embed each entry's
 * modification time. This section is what such a document should be written
 * from.
 *
 * @param {Array.<string>} lines
 * @param {Object} result
 * @param {function(string): undefined} heading
 * @param {function(string): undefined} bullet
 * @returns {undefined}
 */
function renderBinaryContract(lines, result, heading, bullet) {
  var contract = result.comparisonContract.binaryBodies;

  heading('BINARY AND STREAM BODIES - what is compared, exactly');

  bullet('length        ' + contract.lengthCompared);
  bullet('digest        ' + contract.digestCompared);
  bullet('exception     ' + contract.digestObservationOnly.join(', '));
  lines.push('                for those content types the digest is RECORDED ' +
    'AS AN OBSERVATION and does');
  lines.push('                not fail the gate. ' +
    contract.digestObservationOnlyReason);
  bullet('declared by   ' + contract.digestObservationOnlyDeclaredBy);
  bullet('made up for by ' + contract.entryLevelAssertedBy.join(' and ') +
    ', which open the archive rather than hashing it');
  bullet('coverage lost ' + contract.coverageLost);
}

/**
 * The approved-deviation section: separate, and before the differences.
 *
 * @param {Array.<string>} lines
 * @param {Object} result
 * @param {function(string): undefined} heading
 * @param {function(string): undefined} bullet
 * @returns {undefined}
 */
function renderApprovedSection(lines, result, heading, bullet) {
  heading('APPROVED DEVIATIONS');

  if (!result.approvedDeviations.length) {
    lines.push('  none. Every compared scenario either matched its baseline or ' +
      'failed.');
    lines.push('');
    lines.push('  Note that the corpus carries exactly one approved deviation - ' +
      DEVIATION_SCENARIO_ID + ' - so');
    lines.push('  "none" is expected only when that scenario was outside the ' +
      'selection, when this is a');
    lines.push('  --self-check run against the baseline tree, or when a ' +
      'captured corpus was replayed');
    lines.push('  without --annotations to join the marker back on.');
    return;
  }

  result.approvedDeviations.forEach(function(record) {
    lines.push('');
    lines.push('  ' + record.id + '  [' + record.pass + ' pass]');
    bullet('route        ' + record.route);
    bullet('approved by  ' + (record.approvedBy || '(unstated)') +
      ', under rule ' + (record.rule || '(unstated)'));
    bullet('marker from  ' + record.markerSource);
    bullet('verified     ' + (record.verified
      ? 'yes - the change was checked field by field against what was approved'
      : 'by marker only - no structured contract for this scenario'));
    bullet('baseline     ' + (record.baseline || '(unstated)'));
    bullet('target       ' + (record.target || '(unstated)'));
    bullet('why approved ' + (record.reason || '(unstated)'));
    lines.push('    the change, field by field:');
    record.differences.forEach(function(entry) {
      lines.push('      ' + entry.field + ': ' + JSON.stringify(entry.baselineValue) +
        ' -> ' + JSON.stringify(entry.targetValue));
    });
  });

  lines.push('');
  lines.push('  This run\'s clean exit therefore does NOT mean "nothing ' +
    'changed": it means nothing');
  lines.push('  changed except the deviation above, which was approved in ' +
    'advance and verified here.');
}

/**
 * One pass: its differences, its coverage, its checks and its evidence.
 *
 * @param {Array.<string>} lines
 * @param {Object} pass
 * @param {Object} result
 * @param {function(string): undefined} heading
 * @param {function(string): undefined} bullet
 * @returns {undefined}
 */
function renderPass(lines, pass, result, heading, bullet) {
  heading('PASS: ' + pass.name.toUpperCase() +
    (pass.differential ? ' (derived differential)' : ''));

  bullet('served       ' + (pass.baseUrl || '(not started)') +
    ' from ' + pass.appRoot + (pass.appHead ? ' @ ' + pass.appHead : ''));
  bullet('scenarios    ' + pass.driven + ' driven of ' + pass.scenarios +
    ', ' + pass.failingScenarios + ' failing');
  bullet('outcomes     ' + JSON.stringify(pass.counts));
  bullet('node flags   ' + (pass.nodeFlags.length
    ? pass.nodeFlags.join(' ')
    : '(none)') + describeWarningFlags(pass));
  bullet('stderr       ' + (pass.stderrPath || '(none)'));
  bullet('database     ' + (pass.mongo
    ? pass.mongo.host + ':' + pass.mongo.port + '/' + pass.mongo.database
    : '(none)'));
  bullet('sessions     ' + JSON.stringify(pass.sessions &&
    pass.sessions.established));
  bullet('order        ' + pass.ordering.readOnly + ' read-only then ' +
    pass.ordering.mutating + ' mutating, in the corpus\'s own order' +
    (pass.ordering.readOnlyBeforeMutating
      ? ''
      : ' - NOTE: the corpus interleaves them, so a mutation ran before a ' +
        'read-only case'));

  if (pass.fatal) {
    lines.push('');
    lines.push('  THIS PASS WAS NOT PERFORMED: ' + pass.fatal);
  }

  if (pass.differential) {
    lines.push('');
    lines.push('  This pass has no recorded baseline of its own: the corpus ' +
      'was captured through the');
    lines.push('  launcher\'s non-secure default. It replays the SAME ' +
      'scenarios in the SAME order - a');
    lines.push('  subset would change the cross-request session state some ' +
      'responses embed, which was');
    lines.push('  measured - and asserts the documented cookie differential: ' +
      'Secure becomes true on');
    lines.push('  every session cookie, SameSite moves Lax -> None on the ' +
      'cookies the private-field');
    lines.push('  patch touched (the ones carrying an Expires horizon, since ' +
      'both appends sit under one');
    lines.push('  guard), the horizon itself is unchanged, and EVERY OTHER ' +
      'FIELD is compared exactly.');
    lines.push('  Capture a corpus with capture.js against a --secure server ' +
      'and pass --secure-corpus');
    lines.push('  for an exact comparison instead of a derived one.');
  }

  if (pass.applicationDied.died) {
    lines.push('');
    lines.push('  THE APPLICATION DIED during this pass, on ' +
      pass.applicationDied.lastScenario + ' (case ' +
      (pass.applicationDied.lastIndex + 1) + ').');
    lines.push('  ' + pass.applicationDied.remaining + ' scenario(s) were ' +
      'never reached. Only the first transport failure is');
    lines.push('  meaningful; the rest describe a server that was no longer ' +
      'there. Its stderr is at');
    lines.push('  ' + (pass.applicationDied.stderrPath || '(unknown)') + '.');
  }

  renderDifferences(lines, pass);
  renderChecks(lines, pass, bullet);
  renderCoverage(lines, pass, bullet);
  renderObservations(lines, pass);
}

/**
 * The differences, each with everything a reviewer needs to act on it.
 *
 * @param {Array.<string>} lines
 * @param {Object} pass
 * @returns {undefined}
 */
function renderDifferences(lines, pass) {
  lines.push('');
  lines.push('  DIFFERENCES (' + pass.differences.length + ' listed)');

  if (!pass.differences.length) {
    lines.push('    none.');
    return;
  }

  pass.differences.forEach(function(entry, index) {
    lines.push('');
    lines.push('  [' + (index + 1) + '] ' + entry.scenario +
      '  ' + entry.route + '  step ' + entry.step);
    lines.push('      field    ' + entry.field);
    lines.push('      request  ' + (entry.target === undefined
      ? '(unknown)'
      : entry.identity + ' -> ' + entry.target));
    lines.push('      baseline ' + JSON.stringify(entry.baselineValue));
    lines.push('      target   ' + JSON.stringify(entry.targetValue));

    if (entry.note) {
      lines.push('      note     ' + entry.note);
    }

    if (entry.baselineDetail !== undefined || entry.targetDetail !== undefined) {
      lines.push('      detail   baseline ' + JSON.stringify(entry.baselineDetail) +
        ', target ' + JSON.stringify(entry.targetDetail));
    }
  });
}

/**
 * The named checks.
 *
 * @param {Array.<string>} lines
 * @param {Object} pass
 * @param {function(string): undefined} bullet
 * @returns {undefined}
 */
/**
 * The flag audit, beside the flags themselves in the report.
 *
 * Read off the pass's own warning check rather than from a second copy, so the
 * line a human reads and the field a machine reads cannot disagree. Printed
 * next to `node flags` because that is where a reader looks when asking whether
 * this run could have SEEN a warning at all - the question AAP §0.9.3's gate
 * turns on, and the one a flagless run silently answered "no" to.
 *
 * @param {Object} pass A summarized pass.
 * @returns {string}
 */
function describeWarningFlags(pass) {
  var check = (pass.checks || []).filter(function(entry) {
    return entry.name === warningPolicy.CHECK_NAME;
  })[0];

  if (!check || !check.flags) {
    return '';
  }

  if (check.flags.complete) {
    return '  [warning evidence: the required flags were in force]';
  }

  return '  [NO WARNING EVIDENCE: ' + (check.flags.missing.length
    ? 'missing ' + check.flags.missing.join(' ')
    : 'suppressed by ' + check.flags.suppressors.join(' ')) + ']';
}

function renderChecks(lines, pass, bullet) {
  lines.push('');
  lines.push('  CHECKS');

  pass.checks.forEach(function(check) {
    lines.push('    ' + (check.ok ? 'PASS' : 'FAIL') + '  ' + check.name +
      '  (' + check.asserted + ' asserted' +
      // A check that knows how many assertions it OWES prints the
      // denominator, so "5 asserted" can never be read off a set of four.
      // `minimum` is the field the accounting functions carry it in; a
      // numeric `required` is honoured too, and the auth check's `required`
      // is the list of ids rather than a count, which is why the type is
      // tested rather than assumed.
      (check.minimum === undefined || check.minimum === null
        ? (typeof check.required === 'number'
          ? ' of ' + check.required + ' required'
          : '')
        : ' of ' + check.minimum + ' required') +
      (check.skipped ? ', skipped' : '') + ')');

    if (check.reason) {
      lines.push('          ' + check.reason);
    }

    check.failures.forEach(function(failure) {
      lines.push('          ! ' + failure);
    });
  });

  // The auth outcomes are listed one by one whatever the verdict, because "all
  // five were asserted" is itself the claim being made.
  pass.checks.forEach(function(check) {
    if (check.name !== 'auth-scheme outcomes' || !check.entries.length) {
      return;
    }

    lines.push('');
    lines.push('  AUTH-SCHEME OUTCOMES, one by one');
    check.entries.forEach(function(entry) {
      var state;

      if (!entry.present) {
        state = entry.filteredOut ? 'filtered' : 'ABSENT ';
      }
      else if (entry.asserted) {
        state = 'asserted';
      }
      else if (!entry.driven) {
        state = entry.exempt ? 'exempt ' : 'UNDRIVEN';
      }
      else if (entry.differences) {
        state = 'DIFFERS';
      }
      else if (!entry.compared) {
        state = 'no base';
      }
      else {
        state = 'NOT MET';
      }

      lines.push('    ' + state + '  ' + entry.id +
        (entry.route ? '  (' + entry.route + ', as ' + entry.identity + ')' : ''));
      lines.push('        outcome: ' + entry.outcome);

      if (entry.description) {
        lines.push('        ' + entry.description);
      }

      // Printed when present, and never as a justification: an outcome that
      // carries one and was not driven prints UNDRIVEN above it.
      if (entry.unreachableReason) {
        lines.push('        claimed unreachable: ' +
          String(entry.unreachableReason).slice(0, 160));
      }

      if (entry.exempt) {
        lines.push('        exempt: ' + entry.exempt.reason +
          ' (' + entry.exempt.aap + ')');
      }

      // The injected-fault reconciliation, printed whenever the scenario arms
      // one. "expectation met" and "the fault was actually injected" are two
      // claims and the report says both.
      if (entry.faultCheck) {
        lines.push('        injected faults: ' +
          (entry.faultCheck.ok ? 'confirmed ' : 'NOT CONFIRMED ') +
          '(' + entry.faultCheck.expected + ' armed, ' +
          (entry.faultCheck.observed === null
            ? 'no record'
            : entry.faultCheck.observed + ' recorded') + ')');

        if (!entry.faultCheck.ok) {
          lines.push('        ' + entry.faultCheck.reason);
        }
      }
    });
  });

  // The warning gate's own evidence, listed whatever the verdict, for the same
  // reason the auth outcomes are: "the whole exercise was measured under the
  // tracing flags" is itself a claim, and a reader must be able to see which
  // part of it holds. A clean stderr over 137 anonymous GETs is not the gate,
  // and printing only PASS would let it look like one.
  pass.checks.forEach(function(check) {
    if (check.name !== warningPolicy.CHECK_NAME) {
      return;
    }

    lines.push('');
    lines.push('  ZERO-WARNING GATE (' + check.policy.id + ', ' +
      check.policy.allowances.length + ' allowance(s))');
    lines.push('    flags        ' + (check.flags.effective.length
      ? check.flags.effective.join(' ')
      : '(none)') + (check.flags.complete
        ? ''
        : '  <- REQUIRED: ' + check.flags.required.join(' ')));
    lines.push('    stream       ' + (check.stderrPath || '(none)') + ', ' +
      check.notices.length + ' notice(s)');
    lines.push('    applies      ' + (check.gateApplies
      ? 'yes - the tree under test is this worktree'
      : 'NO - measurement only; ' + check.reason));

    check.notices.forEach(function(notice) {
      lines.push('    notice       ' + notice.summary);

      if (notice.origin.length) {
        lines.push('                 raised at ' + notice.origin[0]);
      }
    });

    (check.requirements || []).forEach(function(item) {
      lines.push('    ' + (item.met ? 'met      ' : 'NOT MET  ') + '    ' +
        item.id + (item.met ? '' : ': ' + item.detail));
    });

    if (check.workerEvidence) {
      lines.push('    worker       ' + (check.workerEvidence.supplied
        ? check.workerEvidence.path + ' (' +
          (check.workerEvidence.qualifying ? 'clean under the flags' : 'not qualifying')
          + ')'
        : '(not supplied)'));
    }
  });
}

/**
 * Coverage, including the unreachable entries with their stated reasons.
 *
 * @param {Array.<string>} lines
 * @param {Object} pass
 * @param {function(string): undefined} bullet
 * @returns {undefined}
 */
function renderCoverage(lines, pass, bullet) {
  lines.push('');
  lines.push('  COVERAGE');
  bullet('routes represented   ' + pass.coverage.represented + ' of ' +
    pass.coverage.routes);
  bullet('unrepresented        ' + (pass.coverage.unrepresented.length || 'none'));

  pass.coverage.unrepresented.slice(0, 50).forEach(function(key) {
    lines.push('      ! ' + key);
  });

  if (pass.coverage.unrepresented.length > 50) {
    lines.push('      ! ... and ' + (pass.coverage.unrepresented.length - 50) +
      ' more; the machine-readable result lists them all');
  }

  bullet('unknown route keys   ' + (pass.coverage.unknownRoutes.length || 'none'));
  bullet('failure paths        ' +
    (pass.coverage.routes - pass.coverage.successPathOnly.length -
      pass.coverage.unrepresented.length) +
    ' route(s) were driven on a failure path as well as a success path; ' +
    pass.coverage.successPathOnly.length + ' on a success path only');
  lines.push('      (one minimal request per route exercises success paths ' +
    'only. The changed-error-edge');
  lines.push('      checklist in docs/error-edge-inventory.md is what ' +
    'supplies the rest, and the corpus');
  lines.push('      decides which routes carry an error edge worth driving.)');

  if (pass.coverage.unreachable.length) {
    lines.push('');
    lines.push('  UNREACHABLE BY DESIGN, each with its stated reason');
    pass.coverage.unreachable.forEach(function(entry) {
      lines.push('    ' + entry.id + '  (' + entry.route + ')');
      lines.push('      ' + entry.reason);
    });
  }
}

/**
 * Observations: reported, never gating.
 *
 * @param {Array.<string>} lines
 * @param {Object} pass
 * @returns {undefined}
 */
function renderObservations(lines, pass) {
  var grouped = {};

  pass.observations.forEach(function(entry) {
    grouped[entry.field] = (grouped[entry.field] || 0) + 1;
  });

  lines.push('');
  lines.push('  OBSERVATIONS (not gate fields; inside the volatile set)');

  if (!pass.observations.length) {
    lines.push('    none.');
    return;
  }

  Object.keys(grouped).sort().forEach(function(field) {
    lines.push('    ' + grouped[field] + ' x ' + field);
  });

  lines.push('    the machine-readable result carries each one with its ' +
    'values and its reason.');
}

/**
 * The volatile set, in the report, because a reader has to be able to see what
 * was NOT compared without reading the source.
 *
 * @param {Array.<string>} lines
 * @param {Object} result
 * @param {function(string): undefined} heading
 * @param {function(string): undefined} bullet
 * @returns {undefined}
 */
function renderVolatileSection(lines, result, heading, bullet) {
  heading('WHAT WAS NOT COMPARED - the volatile set, in full');

  lines.push('  ' + result.volatileSet.categories.length + ' categories, ' +
    'fixed. Everything else is compared exactly.');

  result.volatileSet.categories.forEach(function(category) {
    lines.push('');
    lines.push('  ' + category.id + ' - ' + category.title);
    bullet('why           ' + category.why);
    bullet('seeding       ' + category.seedingAlternative);
    bullet('coverage lost ' + category.coverageLost);

    if (category.headersRemoved.length) {
      bullet('headers       ' + category.headersRemoved.join(', '));
    }

    if (category.headersComparedForPresenceOnly.length) {
      bullet('presence only ' + category.headersComparedForPresenceOnly.join(', '));
    }

    if (category.cookieFieldsNotCompared.length) {
      bullet('cookie fields ' + category.cookieFieldsNotCompared.join(', '));
    }

    if (category.recordedFieldsNotCompared.length) {
      bullet('record fields ' + category.recordedFieldsNotCompared.join(', '));
    }

    if (category.binaryDigestExemptTypes.length) {
      bullet('archive types ' + category.binaryDigestExemptTypes.join(', ') +
        ' (length compared, digest observed)');
    }

    category.textPatterns.forEach(function(pattern) {
      bullet('pattern       ' + pattern.name + '  ' + pattern.expression);
    });
  });

  if (result.volatileSet.normalizationProbes.length) {
    lines.push('');
    lines.push('  RULES EXERCISED AT STARTUP (' +
      result.volatileSet.normalizationProbes.length + ' probes, all of which ' +
      'must hold or the run refuses to start)');

    result.volatileSet.normalizationProbes.forEach(function(probe) {
      lines.push('    ' + (probe.ok ? 'ok  ' : 'FAIL') + '  ' + probe.id);
      lines.push('          ' + probe.what);
      lines.push('          ' + JSON.stringify(probe.input) + ' -> ' +
        JSON.stringify(probe.normalizedTo) +
        (probe.rulesApplied.length
          ? '  [' + probe.rulesApplied.join(', ') + ']'
          : '  [no rule fired]'));
    });

    lines.push('');
    lines.push('  ' + result.volatileSet.normalizationProbeNote);
  }

  lines.push('');
  lines.push('  These justifications belong in docs/baseline-parity.md and are ' +
    'emitted into the');
  lines.push('  machine-readable result so they can be cited verbatim rather ' +
    'than paraphrased.');
}

/**
 * The closing lines: where the artifacts are, and what to do next.
 *
 * @param {Array.<string>} lines
 * @param {Object} result
 * @param {Object} options
 * @param {function(string): undefined} heading
 * @returns {undefined}
 */
function renderClosing(lines, result, options, heading) {
  heading('ARTIFACTS');
  lines.push('  result      ' + options.out + ' (provenance embedded)');
  lines.push('  provenance  ' + options.out + '.provenance.json (run output; ' +
    'the same block plus a digest of the result\'s bytes)');
  lines.push('  report      ' + options.report);
  lines.push('');
  lines.push('  ' + (result.exitCode === EXIT_OK
    ? 'Nothing to act on.'
    : 'Act on the differences above. Each names its scenario, its route, its ' +
      'field and both'));

  if (result.exitCode !== EXIT_OK) {
    lines.push('  values, so no re-run is needed to see what changed. R-d ' +
      'prohibits behaviour');
    lines.push('  improvements, so a difference is a failure even where the ' +
      'new behaviour looks');
    lines.push('  better - the only exception is a scenario carrying an ' +
      'approved-deviation marker.');
  }
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

// Counter behind the temporary filenames below, so two artifacts written in
// the same millisecond by the same process cannot collide.
var artifactSequence = 0;

/**
 * Writes one artifact atomically, creating its directory if it is not there.
 *
 * The bytes go to a unique temporary file in the artifact's own directory,
 * which is flushed, closed and then renamed over the target. A same-directory
 * rename is atomic, so a reader sees either the previous artifact or the
 * complete new one - never a half-written file. Writing in place would let an
 * interruption or a full filesystem truncate the last known-good result, and a
 * truncated gate artifact reads as a gate that was never run.
 *
 * The temporary file is removed on failure, so a failed run leaves the
 * previous artifacts exactly as it found them.
 *
 * @param {string} target
 * @param {string} text
 * @returns {undefined}
 * @throws {ToolError} If it cannot be written.
 */
function writeArtifact(target, text) {
  var resolved = path.resolve(target);
  var temporary;
  var descriptor = null;

  try {
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
  }
  catch (err) {
    throw new ToolError('could not create the directory for ' + target + ': ' +
      reasonOf(err));
  }

  artifactSequence += 1;
  temporary = resolved + '.parity-tmp-' + process.pid + '-' + artifactSequence;

  try {
    // 'wx' rather than 'w': a temporary name that already exists is a
    // collision worth failing on, not a file to overwrite.
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, text);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, resolved);
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

/**
 * Writes the result - provenance embedded - its sidecar and the human report.
 *
 * All three, always, whatever the verdict. A failing run is exactly the run
 * whose artifacts someone needs. Nothing here declares any of the three
 * mandatory to READ another: the result carries its own provenance, so it is
 * attributable on its own.
 *
 * @param {Object} result
 * @param {Object} options
 * @returns {string} the rendered report
 */
function writeArtifacts(result, options) {
  var report = renderReport(result, options);
  var record = buildProvenance(options, result);
  var text;

  // Embedded AND written beside, for the reason the corpus is: the result
  // itself must say which tree it drove and which evidence it consumed,
  // without depending on a companion file that a delivery may not carry.
  // `attach` hash-links the two, so a block copied in from another run fails
  // its own payload digest.
  manifest.provenance.attach(result, record);
  text = serialize(result);

  writeArtifact(options.out, text);
  // A run output: it adds a digest over the exact bytes just written, which is
  // what a byte-for-byte comparison of two results wants outside the compared
  // region.
  writeArtifact(options.out + '.provenance.json',
    serialize(manifest.provenance.sidecar(record, text)));
  writeArtifact(options.report, report);

  note('wrote ' + options.out + ' (role ' + record.role + ', tree under test ' +
    ((record.analysedTree && record.analysedTree.headShort) ||
      'not a checkout') + ', generator blob ' +
    String(record.generator.blob).slice(0, 12) +
    (record.generator.verified
      ? ' verified in ' + String(record.generator.commit).slice(0, 7)
      : ' (' + record.generator.commitState + ')') + ')');
  note('wrote ' + options.out + '.provenance.json (run output; the result ' +
    'carries the same block embedded)');
  note('wrote ' + options.report);

  return report;
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
  var result;
  var report;

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
    result = await replay(options);
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

    // A replay that could not be performed is never a pass. There is no path
    // through this file that returns EXIT_OK without a completed comparison.
    return EXIT_ERROR;
  }

  report = writeArtifacts(result, options);

  if (options.printReport) {
    process.stdout.write(report);
  }

  // The report also goes to stderr, so a human running this sees the verdict
  // and the differences without opening a file - while the file remains the
  // citable copy.
  process.stderr.write(report);

  note('VERDICT ' + result.verdict + ' (exit ' + result.exitCode + ')' +
    (result.gateQualifying ? '' : ' - NOT A GATE RUN: ' +
      result.gateQualifyingReason));

  return result.exitCode;
}

module.exports = {
  // The lifecycle.
  replay: replay,
  runPass: runPass,
  runScenario: runScenario,

  // Comparison - the gate. Exported because every one of these has a failure
  // mode worth testing directly rather than through a spawned server: a
  // comparator that cannot fail in a category is not comparing it.
  compareStep: compareStep,
  compareHeaders: compareHeaders,
  compareCookies: compareCookies,
  compareBody: compareBody,
  compareJson: compareJson,
  compareMarkup: compareMarkup,
  compareLists: compareLists,
  compareCrossLocations: compareCrossLocations,
  markupSurface: markupSurface,
  flattenJson: flattenJson,
  parseAttributes: parseAttributes,
  secureDifferential: secureDifferential,
  typeWithoutCharset: typeWithoutCharset,
  outcomeOf: outcomeOf,
  transportCodeOf: transportCodeOf,

  // Normalization. Every rule comes from the volatile set, and these are the
  // accessors that prove it.
  normalizeText: normalizeText,
  normalized: normalized,
  assertVolatileSetIntegrity: assertVolatileSetIntegrity,
  assertNormalizationRules: assertNormalizationRules,
  describeVolatileSet: describeVolatileSet,
  describeBinaryBodyContract: describeBinaryBodyContract,
  volatileField: volatileField,
  categoryForHeader: categoryForHeader,

  // Planning and accounting.
  readCorpus: readCorpus,
  readCorpusFile: readCorpusFile,
  verifyCorpusBlock: verifyCorpusBlock,
  validateCorpusProvenance: validateCorpusProvenance,
  // The provenance checks that stand between an artifact and this tool
  // consuming it, exported so each refusal is exercisable on a fixture file
  // rather than only through a full replay.
  validateArtifactProvenance: validateArtifactProvenance,
  sidecarBeside: sidecarBeside,
  baselineExpectation: baselineExpectation,
  provenancePayload: provenancePayload,
  verifiedManifest: verifiedManifest,
  buildPlan: buildPlan,
  readStep: readStep,
  matchDefinitionStep: matchDefinitionStep,
  compileFilter: compileFilter,
  assertReplayable: assertReplayable,
  securePassPlan: securePassPlan,
  classifyScenario: classifyScenario,
  accountPass: accountPass,
  accountCoverage: accountCoverage,
  accountCoverageCheck: accountCoverageCheck,
  accountAuthOutcomes: accountAuthOutcomes,
  accountHeaderResolvedChains: accountHeaderResolvedChains,
  accountGuestBrowsing: accountGuestBrowsing,
  accountFixtureProfiles: accountFixtureProfiles,
  accountWarnings: accountWarnings,
  qualifyWarningEvidence: qualifyWarningEvidence,
  readWorkerEvidence: readWorkerEvidence,
  isIdentified: isIdentified,
  mergeEvidenceInputs: mergeEvidenceInputs,
  warningShortfalls: warningShortfalls,
  accountManifestCardinality: accountManifestCardinality,
  accountDeclaredExpectations: accountDeclaredExpectations,
  corpusRouteKeys: corpusRouteKeys,
  describeCapturedCookieMode: describeCapturedCookieMode,
  qualifyGate: qualifyGate,
  unmetGateReason: unmetGateReason,
  flattenNodeFlags: flattenNodeFlags,
  assertExpectationSchema: assertExpectationSchema,
  evaluateExpectation: evaluateExpectation,
  compareCrossLocations: compareCrossLocations,
  compareCrossBodies: compareCrossBodies,
  verifyApprovedDeviation: verifyApprovedDeviation,
  approvedDeviationContract: approvedDeviationContract,
  approvedDeviationRegister: approvedDeviationRegister,
  isFailurePathScenario: isFailurePathScenario,
  describeOrdering: describeOrdering,

  // Driving and recording.
  drive: drive,
  Jar: Jar,
  encodePayload: encodePayload,
  parseSetCookie: parseSetCookie,
  recordHeaders: recordHeaders,
  selectProfile: selectProfile,
  selectModelFault: selectModelFault,
  disarmModelFault: disarmModelFault,
  readEvidenceLog: readEvidenceLog,
  collectEvidence: collectEvidence,
  serverAlive: serverAlive,
  establishSessions: establishSessions,
  refererFor: refererFor,
  launcherOptions: launcherOptions,
  mergeGoogleStub: mergeGoogleStub,
  markRemainingUndriven: markRemainingUndriven,
  seedFixtures: seedFixtures,
  prepareS3Seed: prepareS3Seed,
  resolveManifest: resolveManifest,
  gitHead: gitHead,

  // Artifacts.
  buildResult: buildResult,
  buildProvenance: buildProvenance,
  // The provenance building blocks, exported for the same reason the checks
  // above are: a block must be inspectable without a database, a listening
  // socket or a corpus that carries recorded baselines.
  inputIdentity: inputIdentity,
  pathLabelFor: pathLabelFor,
  portableReason: portableReason,
  renderReport: renderReport,
  writeArtifacts: writeArtifacts,
  writeArtifact: writeArtifact,
  serialize: serialize,
  sortedKeys: sortedKeys,
  sha256Hex: sha256Hex,
  elapsedBucket: elapsedBucket,
  isTextualType: isTextualType,
  firstDivergence: firstDivergence,
  reasonOf: reasonOf,

  // Building blocks and reference values, so a harness asserts against the
  // same constants this file uses rather than a second copy of them.
  parseArguments: parseArguments,
  defaultOptions: defaultOptions,
  VOLATILE_SET: VOLATILE_SET,
  VOLATILE_CATEGORY_COUNT: VOLATILE_CATEGORY_COUNT,
  VOLATILE_HEADERS: VOLATILE_HEADERS,
  PRESENCE_ONLY_HEADERS: PRESENCE_ONLY_HEADERS,
  VOLATILE_COOKIE_FIELDS: VOLATILE_COOKIE_FIELDS,
  VOLATILE_RESPONSE_FIELDS: VOLATILE_RESPONSE_FIELDS,
  ARCHIVE_DIGEST_EXEMPT: ARCHIVE_DIGEST_EXEMPT,
  isArchiveDigestExempt: isArchiveDigestExempt,
  EXPIRES_HORIZON_TOLERANCE_DAYS: EXPIRES_HORIZON_TOLERANCE_DAYS,
  APPROVED_DEVIATION: APPROVED_DEVIATION,
  APPROVED_DEVIATIONS: APPROVED_DEVIATIONS,
  APPROVED_DEVIATION_IDS: APPROVED_DEVIATION_IDS,
  DEVIATION_SCENARIO_ID: DEVIATION_SCENARIO_ID,
  HEADER_RESOLVED_GROUP: HEADER_RESOLVED_GROUP,
  HEADER_RESOLVED_CHAIN_COUNT: HEADER_RESOLVED_CHAIN_COUNT,
  AUTH_OUTCOME_GROUP: AUTH_OUTCOME_GROUP,
  AUTH_OUTCOME_IDS: AUTH_OUTCOME_IDS,
  MIN_AUTH_OUTCOMES_DRIVEN: MIN_AUTH_OUTCOMES_DRIVEN,
  REQUIRED_NODE_FLAGS: REQUIRED_NODE_FLAGS,
  BASELINE_COMMIT: BASELINE_COMMIT,
  PROVENANCE_SUFFIX: PROVENANCE_SUFFIX,
  CAPTURE_GENERATOR: CAPTURE_GENERATOR,
  NORMALIZATION_PROBES: NORMALIZATION_PROBES,
  EXPECTATION_KEYS: EXPECTATION_KEYS,
  EXPECTATION_STEP_KEYS: EXPECTATION_STEP_KEYS,
  EXPECTATION_STEP_OPERATORS: EXPECTATION_STEP_OPERATORS,
  EXPECTATION_CROSS_KEYS: EXPECTATION_CROSS_KEYS,
  ERROR_PAGE_HEADERS: ERROR_PAGE_HEADERS,
  NAMED_HEADERS: NAMED_HEADERS,
  COOKIE_ATTRIBUTES: COOKIE_ATTRIBUTES,
  IDENTITIES: IDENTITIES,
  PASSWORD_IDENTITIES: PASSWORD_IDENTITIES,
  GOOGLE_STUB: GOOGLE_STUB,
  ACCEPT_HTML: ACCEPT_HTML,
  ACCEPT_JSON: ACCEPT_JSON,
  DEFAULT_CORPUS: DEFAULT_CORPUS,

  // The artifact-destination policy. `COMMITTED_MANIFEST` is a READ default;
  // there is no write default, so a caller resolves a destination the same way
  // this tool does rather than rebuilding one.
  COMMITTED_MANIFEST: COMMITTED_MANIFEST,
  ARTIFACT_DIR_ENV: ARTIFACT_DIR_ENV,
  ARTIFACT_NAMES: ARTIFACT_NAMES,
  resolveArtifactPath: resolveArtifactPath,
  manifestDestination: manifestDestination,
  DEFAULT_TIMEOUT_MS: DEFAULT_TIMEOUT_MS,
  MAX_TEXT_BYTES: MAX_TEXT_BYTES,
  MAX_DIFFERENCES_PER_STEP: MAX_DIFFERENCES_PER_STEP,
  PASS_NON_SECURE: PASS_NON_SECURE,
  PASS_SECURE: PASS_SECURE,
  PASS_BOTH: PASS_BOTH,
  STATUS_MATCH: STATUS_MATCH,
  STATUS_APPROVED: STATUS_APPROVED,
  STATUS_DIFFERENCE: STATUS_DIFFERENCE,
  STATUS_UNDRIVEN: STATUS_UNDRIVEN,
  STATUS_UNREACHABLE: STATUS_UNREACHABLE,
  STATUS_NO_BASELINE: STATUS_NO_BASELINE,
  OUTCOME_ANSWERED: OUTCOME_ANSWERED,
  OUTCOME_TIMED_OUT: OUTCOME_TIMED_OUT,
  OUTCOME_TRANSPORT: OUTCOME_TRANSPORT,
  OUTCOME_MISSING: OUTCOME_MISSING,
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
