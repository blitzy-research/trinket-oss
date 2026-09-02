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
// binary or stream bodies: length and content digest.
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
// THE TWO CORPUS FACTS THIS FILE HAD TO BE BUILT AROUND
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
//     difference into a pass. A narrowed run (--only, or a single pass) is
//     labelled `gateQualifying: false` in both artifacts and in the closing
//     line, because a diagnostic must never be mistaken for the gate.
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var LOG_PREFIX = 'replay: ';

// The repository root. Used as the working directory of every child this file
// spawns, so one consistent module tree resolves for the tooling regardless of
// which worktree `--app` names.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

var DEFAULT_CORPUS   = path.join(__dirname, 'corpus.json');
var DEFAULT_MANIFEST = path.join(__dirname, 'route-manifest.json');
var DEFAULT_OUT      = path.join(__dirname, 'replay-result.json');
var DEFAULT_REPORT   = path.join(__dirname, 'replay-report.txt');

// Matches capture.js. A step that recorded its own timeout carries it, and this
// is the fallback for one that does not.
var DEFAULT_TIMEOUT_MS = 15000;

// The readiness budget. Generous because the child provisions a database, loads
// every controller and compiles the view engine before it answers.
var DEFAULT_READY_TIMEOUT_MS = 120000;

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
  '  --annotations <path>   Join `expectedDeviation` and `unreachableReason`',
  '                         back on by scenario id. A CAPTURED corpus does not',
  '                         carry them - capture.js\'s scenario builder emits',
  '                         neither - so a replay of one needs this to tell an',
  '                         approved change from a regression. There is no',
  '                         default: a marker has to be asked for by name.',
  '  --secure-corpus <path> Baseline corpus for the secure cookie pass. With',
  '                         one, that pass compares exactly; without one it',
  '                         asserts the documented differential from the',
  '                         non-secure pass and says so in both artifacts.',
  '  --manifest <path>      Route manifest for the coverage gate. Default',
  '                         ' + DEFAULT_MANIFEST + ';',
  '                         generated by spawning manifest.js when absent.',
  '  --out <path>           Machine-readable result. Default ' + DEFAULT_OUT + '.',
  '                         Provenance is written to <path>.provenance.json.',
  '  --report <path>        Human report. Default ' + DEFAULT_REPORT + '.',
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
  '  --ready-timeout <ms>   Readiness budget. Default ' + DEFAULT_READY_TIMEOUT_MS + '.',
  '  --config <json>        An explicit top NODE_CONFIG layer for the child.',
  '  --self-check           Declare that --app names the very tree the corpus',
  '                         was captured from. STRICTER, not weaker: every',
  '                         difference fails, and an approved deviation that',
  '                         materializes fails too, because against that tree',
  '                         it must not. This is the self-consistency rehearsal',
  '                         - a corpus that does not replay cleanly against its',
  '                         own tree is nondeterministic, and the fix is the',
  '                         seeding, never the comparison.',
  '  --print-report         Also write the full report to stdout.',
  '  -h, --help             Print this on stderr and exit 0.',
  '',
  'There is deliberately no --force, no threshold and no pass-with-warnings',
  'mode. A difference is a failure unless the scenario carries an approved',
  'deviation marker, and the exit code is the whole verdict.',
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
    manifestPath   : DEFAULT_MANIFEST,
    out            : DEFAULT_OUT,
    report         : DEFAULT_REPORT,
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
    readyTimeoutMs : DEFAULT_READY_TIMEOUT_MS,
    config         : null,
    selfCheck      : false,
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
  var token;
  var eq;
  var name;
  var inlineValue;
  var hasInline;

  function next(flag) {
    if (hasInline) {
      return inlineValue;
    }

    index++;

    if (index >= argv.length) {
      throw usageError(flag + ' requires a value');
    }

    return argv[index];
  }

  for (; index < argv.length; index++) {
    token = String(argv[index]);
    eq = token.indexOf('=');
    hasInline = token.slice(0, 2) === '--' && eq > 2;
    name = hasInline ? token.slice(0, eq) : token;
    inlineValue = hasInline ? token.slice(eq + 1) : null;

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
        options.nodeFlags.push(next(name));
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
 * Reads and shallowly validates a corpus artifact.
 *
 * @param {string} target
 * @param {string} label what this corpus is, for the message
 * @returns {Object} the parsed corpus
 * @throws {ToolError} If it cannot be read, parsed or recognized.
 */
function readCorpus(target, label) {
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

  return parsed;
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
 * A BINARY body is compared by length and content digest, which is exact and
 * complete - no normalization applies, because there is no text to normalize.
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
 * Evaluates a scenario's declared expectation against what was OBSERVED.
 *
 * This is a second, independent check beside the baseline comparison, and one
 * of its clauses cannot be replaced by that comparison: `cross.locationsEqual`
 * compares two steps' Location headers TO EACH OTHER. The cross-request
 * fail.redirect leak is exactly the case - both requests redirect to the first
 * one's interpolated target - and comparing the pair directly is what detects a
 * build that "fixed" it, independently of whether the recorded values are
 * available to compare against.
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
        clause.status + ' and observed ' +
        (record.status === null || record.status === undefined
          ? outcomeOf(record)
          : record.status));
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
  });

  if (declared.cross && Array.isArray(declared.cross.locationsEqual)) {
    failures = failures.concat(
      compareCrossLocations(declared.cross.locationsEqual, observed));
  }

  return {
    description: declared.description || '(no description)',
    met: !failures.length,
    failures: failures
  };
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

// ---------------------------------------------------------------------------
// The approved deviation
// ---------------------------------------------------------------------------

/**
 * The structured contract for the one approved deviation AAP §0.7 records.
 *
 * Derived from the seeded fixture rather than restated, so the assertion cannot
 * drift from the object the scenario actually downloads: the legacy File
 * document carries this mime and this byte count, and the image branch of the
 * download deliberately omits Content-Disposition where its sibling four lines
 * below sets one.
 *
 * @returns {Object}
 */
function approvedDeviationContract() {
  var legacy = (seed.fixtures && seed.fixtures.bytes && seed.fixtures.bytes.legacyPng) || {};

  return Object.freeze({
    scenarioId: DEVIATION_SCENARIO_ID,
    fromOutcome: OUTCOME_TIMED_OUT,
    toOutcome: OUTCOME_ANSWERED,
    status: 200,
    contentType: legacy.mime || null,
    bodyLength: legacy.size === undefined ? null : legacy.size,
    absentHeaders: Object.freeze(['content-disposition'])
  });
}

var APPROVED_DEVIATION = approvedDeviationContract();

/**
 * Verifies that an approved deviation materialized AS APPROVED.
 *
 * A marker is not a licence for any change at all. The deviation was approved
 * to be one specific response - AAP §0.7: "a 200 stream response carrying the
 * file's own mime type and byte length, and NO Content-Disposition" - so a
 * scenario that changed differently is a failure that happens to carry a
 * marker, and a scenario whose change did not happen at all is a failure too:
 * R-b requires the route to serve, and a marker on a route that still hangs
 * would let the whole point of the deviation go unnoticed.
 *
 * @param {Object} item the planned scenario
 * @param {Array.<Object>} observed one response record per step
 * @param {Array.<Object>} differences the differences found against baseline
 * @returns {Object} {approved, verified, failures, described}
 */
function verifyApprovedDeviation(item, observed, differences) {
  var marker = item.expectedDeviation;
  var contract = marker && item.id === APPROVED_DEVIATION.scenarioId
    ? APPROVED_DEVIATION
    : null;
  var record = observed[0] || null;
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

  // The from-outcome is checked FIRST, because it decides whether the other
  // questions are even meaningful. A corpus that already records the DEVIATED
  // behaviour was captured from a tree where the deviation had landed, so it is
  // not a baseline for this scenario, and saying that once is more useful than
  // also complaining that nothing changed.
  if (contract &&
      outcomeOf(item.steps[0] && item.steps[0].baseline) !== contract.fromOutcome) {
    failures.push('the recorded baseline for this scenario is ' +
      outcomeOf(item.steps[0] && item.steps[0].baseline) + ', and the ' +
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

  if (!contract) {
    return {
      approved: !failures.length,
      verified: false,
      failures: failures,
      described: marker.target || null,
      note: 'approved by its marker alone: this file carries a structured ' +
        'contract only for ' + APPROVED_DEVIATION.scenarioId + ', so the ' +
        'shape of this change was not verified field by field'
    };
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

  if (record.status !== contract.status) {
    failures.push('the approved response is ' + contract.status +
      ' and the target answered ' + record.status);
  }

  contentType = typeWithoutCharset(record.headers && record.headers['content-type']);

  if (contract.contentType && contentType !== contract.contentType) {
    failures.push('the approved response carries the file\'s own mime type ' +
      JSON.stringify(contract.contentType) + ' and the target sent ' +
      JSON.stringify(String(contentType)));
  }

  if (contract.bodyLength !== null && record.body &&
      record.body.length !== contract.bodyLength) {
    failures.push('the approved response carries the file\'s byte length ' +
      contract.bodyLength + ' and the target sent ' + record.body.length);
  }

  contract.absentHeaders.forEach(function(name) {
    if (record.headers && record.headers[name] !== undefined) {
      failures.push('the approved response omits ' + name +
        ' - that omission is the purpose of the image branch, which renders ' +
        'inline rather than downloading - and the target sent ' +
        JSON.stringify(String(record.headers[name])));
    }
  });

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
 * Asserts the five outcomes of the session auth scheme, each independently.
 *
 * The scheme has five distinct outcomes and they are asserted one by one rather
 * than through an aggregate, because an aggregate cannot tell a missing-record
 * refusal from a disabled-account refusal - both are 401-shaped, and only the
 * message and the session clearing distinguish them. Four are reachable over
 * HTTP and each has its own corpus scenario; the fifth needs the user lookup
 * itself to fail, which no request can cause, so it carries a stated reason and
 * is asserted by the server-level gate that can inject the fault. Listed here
 * with that reason rather than quietly counted as four out of four.
 *
 * @param {Array.<Object>} scenarios the planned scenarios, after replay
 * @returns {Object} the check document
 */
function accountAuthOutcomes(scenarios) {
  var outcomes = scenarios.filter(function(item) {
    return item.group === AUTH_OUTCOME_GROUP;
  });
  var entries = [];
  var failures = [];

  if (!outcomes.length) {
    return {
      name: 'auth-scheme outcomes',
      asserted: 0,
      ok: true,
      skipped: true,
      reason: 'no scenario in the ' + AUTH_OUTCOME_GROUP + ' group was ' +
        'selected by this run, so the outcomes were not exercised here',
      entries: entries,
      failures: failures
    };
  }

  outcomes.forEach(function(item) {
    var entry = {
      id: item.id,
      route: item.routeKey,
      identity: item.identity,
      description: describeScenario(item),
      reachable: !item.unreachableReason,
      reason: item.unreachableReason || null,
      driven: !!(item.result && item.result.driven),
      compared: !!(item.result && item.result.compared),
      differences: item.result ? item.result.differences.length : 0,
      expectation: item.result ? item.result.expectation : null
    };

    entries.push(entry);

    if (!entry.reachable) {
      // An unreachable outcome must carry its reason. That is the whole
      // contract for it: a reason is what makes the gap reviewable.
      if (!entry.reason) {
        failures.push(item.id + ' is not reachable over HTTP and carries no ' +
          'stated reason, so the gap cannot be reviewed');
      }
      return;
    }

    if (!entry.driven) {
      failures.push(item.id + ' could not be driven, so this outcome was not ' +
        'asserted at all');
      return;
    }

    if (!entry.compared) {
      failures.push(item.id + ' was driven but has no recorded baseline to ' +
        'be compared against');
      return;
    }

    if (entry.differences) {
      failures.push(item.id + ' differs from its baseline in ' +
        entry.differences + ' field(s), so this auth outcome changed');
    }

    if (entry.expectation && !entry.expectation.met) {
      failures.push(item.id + ' did not meet its declared expectation: ' +
        entry.expectation.failures.join('; '));
    }
  });

  return {
    name: 'auth-scheme outcomes',
    asserted: entries.length,
    ok: !failures.length,
    skipped: false,
    reason: null,
    entries: entries,
    failures: failures
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
function accountHeaderResolvedChains(scenarios) {
  var chains = scenarios.filter(function(item) {
    return item.group === HEADER_RESOLVED_GROUP;
  });
  var failures = [];
  var entries = [];

  chains.forEach(function(item) {
    var differences = item.result ? item.result.differences.length : 0;

    entries.push({
      id: item.id,
      route: item.routeKey,
      differences: differences,
      driven: !!(item.result && item.result.driven),
      marked: !!item.expectedDeviation
    });

    if (item.expectedDeviation) {
      failures.push(item.id + ' carries an expectedDeviation marker. These ' +
        'four chains were NOT approved to change - only the never-settling ' +
        'one was - so a marker here would launder exactly the collateral ' +
        'damage this check exists to catch.');
    }

    if (item.result && item.result.driven && !item.result.compared) {
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
    ok: !failures.length,
    skipped: !chains.length,
    reason: chains.length
      ? null
      : 'no scenario in the ' + HEADER_RESOLVED_GROUP + ' group was selected ' +
        'by this run',
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
function accountGuestBrowsing(entries, scenarios) {
  var inherited = Object.create(null);
  var failures = [];
  var checked = 0;
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

  return {
    name: 'guest browsing on auth-inheriting routes',
    asserted: checked,
    ok: !failures.length,
    skipped: !checked,
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
function accountFixtureProfiles(scenarios) {
  var failures = [];
  var entries = [];
  var checked = 0;

  scenarios.forEach(function(item) {
    var evidence = item.result ? item.result.profileEvidence : null;

    if (!evidence) {
      return;
    }

    checked++;

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

  return {
    name: 'fixture profiles in force',
    asserted: checked,
    ok: !failures.length,
    skipped: !checked,
    reason: checked ? null : 'no scenario was driven in this run',
    entries: entries,
    failures: failures
  };
}

/**
 * Scans the application child's captured stderr for warnings.
 *
 * AAP §0.6.4's finding is the reason this belongs here rather than in a boot
 * check: two internal re-entrant injections put a deprecation on the LIVE
 * REQUEST PATH, and a boot that never serves a request never reveals them. A
 * full replay over the whole route surface is exactly the exercise that does,
 * so the stream is scanned here, and it is scanned on every run rather than
 * only when the deprecation flags were passed - a warning is a finding whether
 * or not anyone asked to see it.
 *
 * There are no allowances. Not one line is excluded by name, because an
 * excluded line is a warning nobody will ever look at again.
 *
 * @param {(string|null)} stderrPath
 * @returns {Object} the check document
 */
function accountWarnings(stderrPath) {
  var text;
  var lines = [];

  if (!stderrPath) {
    return {
      name: 'zero warnings from the application',
      asserted: 0,
      ok: true,
      skipped: true,
      reason: 'the application was not launched by this run, so its captured ' +
        'stderr belongs to whoever started it',
      entries: [],
      failures: []
    };
  }

  try {
    text = fs.readFileSync(stderrPath, 'utf8');
  }
  catch (err) {
    return {
      name: 'zero warnings from the application',
      asserted: 0,
      ok: false,
      skipped: false,
      reason: null,
      entries: [],
      failures: ['the captured stderr at ' + stderrPath + ' could not be ' +
        'read, so the warning gate could not be evaluated: ' + reasonOf(err)]
    };
  }

  text.split('\n').forEach(function(line) {
    if (/\b(?:DeprecationWarning|ExperimentalWarning|Warning:|DEP0\d{3})\b/.test(line) ||
        /\(node:\d+\)/.test(line)) {
      lines.push(line.trim());
    }
  });

  return {
    name: 'zero warnings from the application',
    asserted: 1,
    ok: !lines.length,
    skipped: false,
    reason: null,
    stderrPath: stderrPath,
    entries: lines,
    failures: lines.length
      ? [lines.length + ' warning line(s) on the application\'s stderr. The ' +
         'zero-warning condition covers the whole running application, not ' +
         'boot alone, and this replay is the pass over the route surface ' +
         'where handler-time warnings surface.']
      : []
  };
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
    encoding: 'utf8'
  });

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

  return new Promise(function(resolve) {
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
    child.stderr.on('data', function(chunk) {
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
        reason: 'the seeder exited ' +
          (status === null ? 'on ' + signal : String(status)) + ': ' + tail(),
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
 * @param {Object} context {jar, profileFile, httpLogPath, timeoutMs, selfCheck, expectation}
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

  item.result = result;

  if (!item.steps.length) {
    // An unreachable scenario. It carries its reason and is accounted as an
    // explained gap, which is the difference between that and a silent one.
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
    warnings = accountWarnings(info ? info.stderrPath : null);

    await server.stop();
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
    nodeFlags: options.nodeFlags,
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

  // The marker is resolved BEFORE the declared expectation, and the order is
  // load-bearing. A scenario carrying an approved deviation is one whose
  // recorded baseline expectation the target is EXPECTED to violate - that
  // violation is the deviation - so evaluating the expectation first would
  // fail every approved change before its marker was ever consulted.
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
    if (result.deviation && !options.selfCheck) {
      // A marker on a scenario that did not change. R-b requires the route to
      // serve, so the absence of the approved change is itself the finding.
      return {
        status: STATUS_DIFFERENCE,
        failing: true,
        reason: result.deviation.failures.join('; ')
      };
    }

    return { status: STATUS_MATCH, failing: false, reason: null };
  }

  if (result.deviation && result.deviation.approved && !options.selfCheck) {
    return {
      status: STATUS_APPROVED,
      failing: false,
      reason: 'approved by ' + (item.expectedDeviation.approvedBy || 'its marker') +
        ' under rule ' + (item.expectedDeviation.rule || '(unstated)')
    };
  }

  if (result.deviation && !options.selfCheck) {
    return {
      status: STATUS_DIFFERENCE,
      failing: true,
      reason: 'the scenario carries an approved-deviation marker but the ' +
        'change is not the one that was approved: ' +
        result.deviation.failures.join('; ')
    };
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

  return {
    status: STATUS_DIFFERENCE,
    failing: true,
    reason: 'the difference is not approved'
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
 * @returns {Object}
 */
function accountPass(pass, plan, manifestDocument, options, selectionComplete) {
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

  checks.push(accountAuthOutcomes(scenarios));
  checks.push(accountHeaderResolvedChains(scenarios));
  checks.push(accountGuestBrowsing(manifestDocument.entries, scenarios));
  checks.push(accountFixtureProfiles(scenarios));
  checks.push(pass.warnings);
  checks.push(accountCoverageCheck(coverage, selectionComplete));

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
  var corpus;
  var annotations = null;
  var secureCorpus = null;
  var manifestDocument;
  var filter = compileFilter(options.only);
  var scratchDir;
  var passNames;
  var selectionComplete;
  var gateQualifying;
  var passes = [];
  var plans = {};
  var passName;
  var plan;
  var passResult;
  var index;
  var result;

  assertVolatileSetIntegrity();

  options.appRoot = path.resolve(options.appRoot);

  if (!fs.existsSync(path.join(options.appRoot, 'app.js'))) {
    throw usageError('--app names ' + options.appRoot + ', which holds no ' +
      'application entry point. It must be a worktree of this repository.');
  }

  corpus = readCorpus(options.corpus, 'corpus');

  if (options.annotations) {
    annotations = readCorpus(options.annotations, 'annotations corpus');
  }

  if (options.secureCorpus) {
    secureCorpus = readCorpus(options.secureCorpus, 'secure-pass corpus');
  }

  // The plan for the non-secure pass decides whether there is anything to
  // replay at all, so it is built before anything is launched.
  plans[PASS_NON_SECURE] = buildPlan(corpus, annotations, filter);

  assertReplayable(plans[PASS_NON_SECURE], options, corpus);

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
  // GATE-QUALIFYING run additionally drove both cookie configurations, which is
  // what AAP §0.9.3 requires of the gate as a whole. So `--pass non-secure`
  // still enforces coverage - it does not narrow the scenario set - while being
  // honestly labelled as not the gate.
  selectionComplete = !options.only.length;
  gateQualifying = selectionComplete && options.pass === PASS_BOTH;

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
        selectionComplete));
    }
  }
  finally {
    removeDirectory(scratchDir);
  }

  result = buildResult(options, corpus, annotations, secureCorpus,
    manifestDocument, plans, passes, gateQualifying);

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
    'differential, comparing every other field exactly. Capture a secure ' +
    'corpus and pass --secure-corpus for an exact comparison.');

  return plan;
}

/**
 * Removes a directory this tool created.
 *
 * Only ever called with a path from `mkdtempSync` in the system temp
 * directory, and it is checked here as well, because a recursive removal is not
 * something to leave to the caller's discipline.
 *
 * @param {string} target
 * @returns {undefined}
 */
function removeDirectory(target) {
  var temp = os.tmpdir();

  if (!target || String(target).indexOf(path.join(temp, 'parity-replay-')) !== 0) {
    note('warning: declining to remove ' + target +
      ', which this run did not create');
    return;
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
  }
  catch (err) {
    note('warning: could not remove the scratch directory ' + target + ': ' +
      reasonOf(err));
  }
}

// ---------------------------------------------------------------------------
// The result document
// ---------------------------------------------------------------------------

/**
 * Builds the machine-readable result, and with it the verdict and exit code.
 *
 * Five things fail a run, and each is listed separately in `gates` so a reader
 * knows which one it was rather than inferring it from a number: an unapproved
 * difference, a scenario that could not be driven, a scenario with no baseline
 * to compare against, a failed named check - which includes route coverage and
 * the zero-warning condition - and an application that died mid-pass.
 *
 * @param {Object} options
 * @param {Object} corpus
 * @param {(Object|null)} annotations
 * @param {(Object|null)} secureCorpus
 * @param {Object} manifestDocument
 * @param {Object} plans
 * @param {Array.<Object>} passes
 * @param {boolean} gateQualifying
 * @returns {Object}
 */
function buildResult(options, corpus, annotations, secureCorpus,
  manifestDocument, plans, passes, gateQualifying) {
  var gates = {
    differences: 0,
    undriven: 0,
    missingBaselines: 0,
    failedChecks: [],
    applicationDied: false,
    fatalPasses: []
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

      gates.differences++;
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
    gateQualifying: gateQualifying,
    gateQualifyingReason: gateQualifying
      ? null
      : narrowedReason(options),
    selfCheck: !!options.selfCheck,
    gates: gates,
    approvedDeviations: approved,
    volatileSet: describeVolatileSet(),
    sources: {
      appRoot: options.appRoot,
      appHead: gitHead(options.appRoot),
      corpus: options.corpus,
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
  else if (gates.differences || gates.undriven || gates.missingBaselines ||
           gates.failedChecks.length || gates.applicationDied) {
    result.verdict = 'FAIL';
    result.exitCode = EXIT_DIFFERENCE;
  }
  else {
    result.verdict = 'PASS';
    result.exitCode = EXIT_OK;
  }

  return result;
}

/**
 * Why a run does not qualify as the gate.
 *
 * @param {Object} options
 * @returns {string}
 */
function narrowedReason(options) {
  var reasons = [];

  if (options.only.length) {
    reasons.push('--only narrowed the scenario selection, so route coverage ' +
      'cannot be accounted over the whole surface');
  }

  if (options.pass !== PASS_BOTH) {
    reasons.push('--pass ' + options.pass + ' ran one cookie configuration; ' +
      'the gate requires both');
  }

  return reasons.join('; ') || 'the run was narrowed';
}

/**
 * The volatile set as it was applied, for the artifact.
 *
 * Emitted in full, justifications included, so docs/baseline-parity.md can
 * cite them verbatim: every entry here is a field the migration is not checked
 * on, and that list belongs in the evidence rather than only in the source.
 *
 * @returns {Object}
 */
function describeVolatileSet() {
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
 * Builds the provenance sidecar.
 *
 * "Replayed against the migrated tree" means replayed BY target-worktree
 * tooling against a particular install of a particular commit, and this is the
 * record that makes the claim checkable rather than asserted. It is kept out of
 * the result so the result stays diff-clean: a second run on a different day
 * changes the provenance and nothing else.
 *
 * @param {Object} options
 * @param {Object} result
 * @returns {Object}
 */
function buildProvenance(options, result) {
  return {
    schema: 1,
    tool: 'test/parity/replay.js',
    toolRoot: TOOL_ROOT,
    toolHead: gitHead(TOOL_ROOT),
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform + ' ' + process.arch,
    execPath: process.execPath,
    verdict: result.verdict,
    exitCode: result.exitCode,
    gateQualifying: result.gateQualifying,
    selfCheck: result.selfCheck,
    sources: result.sources,
    passes: result.passes.map(function(entry) {
      return {
        name: entry.name,
        appRoot: entry.appRoot,
        appHead: entry.appHead,
        baseUrl: entry.baseUrl,
        port: entry.port,
        nodeFlags: entry.nodeFlags,
        runDir: entry.runDir,
        stderrPath: entry.stderrPath,
        mongo: entry.mongo,
        differential: entry.differential
      };
    }),
    artifacts: {
      result: options.out,
      report: options.report
    },
    note: 'Read this beside the result. A result without its sidecar does not ' +
      'say which tree it measured, and is not parity evidence.'
  };
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
  lines.push('annotations    ' + (result.sources.annotations || '(none)'));
  lines.push('secure corpus  ' + (result.sources.secureCorpus || '(none - the ' +
    'secure pass asserts the documented differential)'));
  lines.push('manifest       ' + result.sources.manifest + ' (' +
    result.sources.manifestRoutes + ' routes)');
  lines.push('selection      ' + (Array.isArray(result.sources.selection)
    ? result.sources.selection.join(' ')
    : result.sources.selection));

  heading('GATES');
  bullet('unapproved differences   ' + result.gates.differences);
  bullet('scenarios not driven     ' + result.gates.undriven);
  bullet('scenarios with no baseline ' + result.gates.missingBaselines);
  bullet('failed named checks      ' + (result.gates.failedChecks.length
    ? result.gates.failedChecks.join('; ')
    : '0'));
  bullet('application died         ' + (result.gates.applicationDied ? 'YES' : 'no'));

  if (result.gates.fatalPasses.length) {
    bullet('passes not performed     ' + result.gates.fatalPasses.join('; '));
  }

  renderApprovedSection(lines, result, heading, bullet);

  result.passes.forEach(function(pass) {
    renderPass(lines, pass, result, heading, bullet);
  });

  renderVolatileSection(lines, result, heading, bullet);
  renderClosing(lines, result, options, heading);

  return lines.join('\n') + '\n';
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
    : '(none)'));
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
function renderChecks(lines, pass, bullet) {
  lines.push('');
  lines.push('  CHECKS');

  pass.checks.forEach(function(check) {
    lines.push('    ' + (check.ok ? 'PASS' : 'FAIL') + '  ' + check.name +
      '  (' + check.asserted + ' asserted' +
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
      lines.push('    ' + (entry.reachable
        ? (entry.differences ? 'DIFFERS' : (entry.compared ? 'match  ' : 'no base'))
        : 'unreachable') + '  ' + entry.id + '  (' + entry.route +
        ', as ' + entry.identity + ')');
      lines.push('        ' + entry.description);

      if (entry.reason) {
        lines.push('        reason: ' + entry.reason);
      }
    });
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
  lines.push('  result      ' + options.out);
  lines.push('  provenance  ' + options.out + '.provenance.json');
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

/**
 * Writes one artifact, creating its directory if it is not there.
 *
 * @param {string} target
 * @param {string} text
 * @returns {undefined}
 * @throws {ToolError} If it cannot be written.
 */
function writeArtifact(target, text) {
  try {
    fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
    fs.writeFileSync(target, text);
  }
  catch (err) {
    throw new ToolError('could not write ' + target + ': ' + reasonOf(err));
  }
}

/**
 * Writes the result, its provenance sidecar and the human report.
 *
 * All three, always, whatever the verdict. A failing run is exactly the run
 * whose artifacts someone needs.
 *
 * @param {Object} result
 * @param {Object} options
 * @returns {string} the rendered report
 */
function writeArtifacts(result, options) {
  var report = renderReport(result, options);

  writeArtifact(options.out, serialize(result));
  writeArtifact(options.out + '.provenance.json',
    serialize(buildProvenance(options, result)));
  writeArtifact(options.report, report);

  note('wrote ' + options.out);
  note('wrote ' + options.out + '.provenance.json');
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
  describeVolatileSet: describeVolatileSet,
  volatileField: volatileField,
  categoryForHeader: categoryForHeader,

  // Planning and accounting.
  readCorpus: readCorpus,
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
  evaluateExpectation: evaluateExpectation,
  verifyApprovedDeviation: verifyApprovedDeviation,
  isFailurePathScenario: isFailurePathScenario,
  describeOrdering: describeOrdering,

  // Driving and recording.
  drive: drive,
  Jar: Jar,
  encodePayload: encodePayload,
  parseSetCookie: parseSetCookie,
  recordHeaders: recordHeaders,
  selectProfile: selectProfile,
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
  DEVIATION_SCENARIO_ID: DEVIATION_SCENARIO_ID,
  HEADER_RESOLVED_GROUP: HEADER_RESOLVED_GROUP,
  AUTH_OUTCOME_GROUP: AUTH_OUTCOME_GROUP,
  ERROR_PAGE_HEADERS: ERROR_PAGE_HEADERS,
  NAMED_HEADERS: NAMED_HEADERS,
  COOKIE_ATTRIBUTES: COOKIE_ATTRIBUTES,
  IDENTITIES: IDENTITIES,
  PASSWORD_IDENTITIES: PASSWORD_IDENTITIES,
  GOOGLE_STUB: GOOGLE_STUB,
  ACCEPT_HTML: ACCEPT_HTML,
  ACCEPT_JSON: ACCEPT_JSON,
  DEFAULT_CORPUS: DEFAULT_CORPUS,
  DEFAULT_MANIFEST: DEFAULT_MANIFEST,
  DEFAULT_OUT: DEFAULT_OUT,
  DEFAULT_REPORT: DEFAULT_REPORT,
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
