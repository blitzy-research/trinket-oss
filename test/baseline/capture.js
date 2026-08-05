/**
 * test/baseline/capture.js — the baseline capture harness.
 *
 * WHAT THIS IS
 * BOTH artifacts under test/baseline/ name this file in `metadata.regenerationOwner`: it is the harness
 * that owns test/baseline/route-table.json and test/baseline/responses.json. It boots the application
 * exactly the way they were produced, re-reads BOTH halves of the parity contract — the 233-row hapi
 * route table and the 58 + 7 + 8 entry response corpus — reports every difference, evaluates every gate
 * the artifacts publish, and can regenerate them. It is also the shared implementation library for
 * test/baseline/replay.js, which require()s it — the `require.main === module` guard below means
 * requiring this file boots nothing and captures nothing, so a fifth file under test/baseline/ is not
 * needed. test/lib/api/route-parity.js deliberately does NOT require it: that suite is an independent
 * verifier carrying its own literals.
 *
 * OWNERSHIP, published once and truthfully. Because this file owns the artifacts,
 * it also owns the things the artifacts declare about themselves:
 *   - `DOCUMENTED_DIGEST` and `documentedAnchorGate()` are declared HERE and nowhere else in
 *     test/baseline/. replay.js re-exports both rather than keeping a second copy, because two copies
 *     of a gate is how a gate rots: it ends up enforced in one file and UNEVALUATED in the other, and
 *     route-table.json can no longer name a single honest evaluator.
 *   - `routeTableGates()` turns all eleven clauses AND the verdict into pass/fail entries of this CLI's
 *     gate summary, so a --dry-run exits non-zero on drift and a write is refused.
 *   - `mergeMeasuredRouteTable()` REGENERATES `gates.documentedAnchorGateSatisfied` from this run's own
 *     evaluation, and `recordReproducedCounts()` regenerates the provenance block's section sizes, so
 *     neither is a hand-authored value that can rot. Everything the
 *     merge does NOT recompute is reported by name as hand-derived on every write.
 *
 * HARD CONSTRAINTS, all of them from the artifact's own metadata.captureNotes. Every one of these is a
 * correctness requirement, not a preference:
 *
 *   1. REAL HTTP ONLY. Requests are issued with node:http against server.info. This harness NEVER
 *      calls server.inject(): @hapi/shot is the sole remaining DEP0169 source in the dependency tree,
 *      and the zero-deprecation boot gate forbids tripping it. There is no upstream fix — 6.0.3 is the
 *      latest published @hapi/shot.
 *      SCOPE OF THAT CLAIM: it is a rule about the HARNESS, not about the application. The
 *      application itself performs internal sub-requests with request.server.inject() in
 *      lib/controllers/courses.js and lib/controllers/folders.js, so DEP0169 does fire once a route
 *      that injects is exercised. The boot gate is still clean because nothing injects during boot,
 *      and the corpus stays clean because the harness reaches the app only over a real socket. See
 *      docs/PRESERVED-QUIRKS.md section 7.6 for why neither inject site may be rewritten.
 *   2. RUNTIME CONFIG OVERRIDE, NEVER A FILE EDIT. config/test.yaml sets app.start:false, so under
 *      NODE_ENV=test the server is constructed but never bound. app.start:true, the bind host, the
 *      port, the disposable database and the >=32-character session cookie password app.js requires
 *      are injected through NODE_CONFIG *before* app.js is required. config/test.yaml is not edited
 *      and config/local.yaml is not created: editing either would change the behavior of the existing
 *      mocha suite, which is a prohibited side effect.
 *   3. NEITHER A CAPTURE NOR A VERIFY RUN EVER OVERRIDES app.url, AND NO RECORDED VALUE IS EVER
 *      REBASED ONTO A DIFFERENT ORIGIN. config/app.config.js computes config.url from
 *      app.url.{protocol,hostname,port}, which config/default.yaml fixes at https + trinket.dev +
 *      (empty port), and ten of the corpus's sixteen unauthenticated redirects carry an absolute
 *      Location built from it. Injecting that origin so a diff passes, or rewriting an observed
 *      Location onto the recorded origin, would let a build that emits the WRONG configured origin
 *      replay clean — the literal Location is part of what the redirect-parity evidence rests on.
 *      A run whose live origin differs from metadata.appUrlOrigin is therefore UNABLE TO RUN
 *      (exit 2) and says so, with the remedy: drop the app.url override from config/local.yaml, or
 *      export a NODE_CONFIG app.url that matches the recorded origin. Configuration mismatch is a
 *      precondition failure, never a normalization.
 *   4. NO REDIRECT IS EVER FOLLOWED WITH A SESSION COOKIE, AND NOTHING IS FOLLOWED BEFORE THE WHOLE
 *      PRIMARY CORPUS IS RECORDED. Every entry's PRIMARY reading is the raw first hop: the status the
 *      server answered and the literal Location it sent, both compared byte for byte. A second,
 *      strictly ADDITIVE reading resolves each unauthenticated entry's Location chain to its terminal
 *      response, because that resolved reading is what the published 25x200 / 7x401 / 25x404 / 1x500
 *      tally counts; the first-hop tally is {200:12, 302:16, 401:7, 404:22, 500:1}. Two rules make the
 *      additive reading provably non-perturbing, and both are load-bearing:
 *        (a) it runs AFTER the unauthenticated, authenticated and assignment sections are all
 *            recorded, so no resolution request can precede a recorded value; and
 *        (b) it NEVER sends a cookie, so it cannot consume a flash message or touch session state.
 *      `request.yar` flash storage is single-read, so following the authenticated chains with the
 *      pinned session cookie consumes the post-login flash and shortens the PRIMARY GET /home body;
 *      the authenticated and assignment sections therefore carry NO redirectChain and NO resolved
 *      field at all. See docs/PRESERVED-QUIRKS.md section 3.38.
 *   5. THE NORMALIZATION CONTRACT IS READ FROM THE ARTIFACT, NOT RE-DECLARED HERE. The HTML
 *      normalization rules come from responses.json#normalizationContract, so the harness and the
 *      contract cannot drift apart. The artifact's own prohibition binds this file: "Do NOT normalize
 *      away a difference in order to make a replay diff pass." The roles-token rule is therefore
 *      GATED — every match is structurally verified against cryptoParityContract before it is
 *      substituted, and a violation throws instead of being quietly erased.
 *   6. CLONE-SAFE PORT AND A DISPOSABLE, VALIDATED DATABASE. /tmp/blitzy is a shared workspace;
 *      sibling clones hold other ports and other databases. The bind port defaults to
 *      30112 + CLONE_INDEX (BASELINE_PORT overrides) and the database is forced to
 *      `test_baseline[_<CLONE_INDEX>]` (BASELINE_MONGO_DATABASE overrides). This harness creates and
 *      DELETES two throwaway identities, so before every query and every delete it fails closed
 *      exactly the way test/helpers/db.js does — NODE_ENV must be `test`, the connection must be open,
 *      mongoose and the driver must agree on the name, and the name must match the disposable
 *      allow-list — and it refuses to delete a document that is not the harness identity it created. A
 *      developer database such as `trinket` fails closed instead of being mutated.
 *   7. WRITING IS THE DEFAULT PURPOSE AND IS STILL HARD TO DO BY ACCIDENT. A plain run captures and
 *      writes both artifacts, because that is what a capture harness is for; --dry-run measures and
 *      diffs and writes absolutely nothing. A writing run refuses unless HEAD is the commit recorded in
 *      metadata.baseCommit AND no tracked file is modified AND no gitignored configuration layer such
 *      as config/local.yaml is present — the porcelain read is --ignored=matching precisely so that one
 *      can be seen — so post-migration values, half-finished values and one operator's private
 *      configuration cannot become the baseline. There is no --force: re-baselining is
 *      --adopt-base-commit, which says what it does, and which lifts the commit condition alone.
 *
 * USAGE
 *   node test/baseline/capture.js                  capture at the commit metadata.baseCommit records
 *                                                  and rewrite BOTH artifacts atomically; refuses
 *                                                  (exit 2) off that commit, with a modified tracked
 *                                                  tree, or with a gitignored config/local.* layer
 *   node test/baseline/capture.js --write          the same run, said explicitly
 *   node test/baseline/capture.js --dry-run        measure, diff and gate only — writes nothing
 *   node test/baseline/capture.js --dry-run --routes-only
 *                                                  the route table and its gates only, no HTTP corpus
 *   node test/baseline/capture.js --dry-run --quiet
 *                                                  summary and gates only, no per-difference detail
 *   node test/baseline/capture.js --out <path>     also dump the raw measurement to <path>, which must
 *                                                  be a new non-symlinked file outside test/baseline
 *   node test/baseline/capture.js --adopt-base-commit
 *                                                  deliberately establish a NEW baseline at this HEAD
 *
 * EXIT CODES
 *   0  parity: nothing differed, every required gate was evaluated and held, and a requested write
 *      actually happened
 *   1  a real difference or a FAILED gate — an application-code or harness defect to report
 *   2  unable to run: bad flags, a configuration precondition (origin, database, git state), a
 *      refused write, absent required evidence, an unevaluated required gate, or failed cleanup
 */

var childProcess = require('child_process'),
    crypto       = require('crypto'),
    fs           = require('fs'),
    http         = require('http'),
    os           = require('os'),
    path         = require('path'),
    nodeUtil     = require('node:util'),
    // The ENDPOINT half of assertDisposableDatabase()'s gate, shared verbatim with
    // test/helpers/db.js — the tree's other destructive caller — so the two cannot diverge.
    // Requiring nothing and touching nothing on load is a precondition of this file being able to use
    // it at all: this is a CLI, not a Mocha spec, so it cannot pull in test/helpers/db.js, whose first
    // statement requires the chai/sinon bootstrap.
    endpointGate = require('../helpers/disposable-endpoint');

var ARTIFACT_PATH    = path.join(__dirname, 'responses.json'),
    ROUTE_TABLE_PATH = path.join(__dirname, 'route-table.json');

/**
 * The literal the Technical Specification publishes for the baseline route table.
 *
 * It lives HERE, in the harness that owns route-table.json, and it is the ONLY copy in the tree:
 * test/baseline/replay.js re-exports it rather than declaring a second one, and
 * test/lib/api/route-parity.js carries its own independent literal because that suite deliberately
 * loads neither this module nor the artifact. Clause 1 of documentedAnchorGate() compares this constant
 * against the artifact's stored gates.documentedDigest, so an edit that quietly substituted one of the
 * artifact's own readings for the published anchor FAILS the gate instead of passing unnoticed.
 *
 * The evaluator, this literal and the regeneration of the stored verdict all live in this file, so the
 * artifact names one honest home for all three.
 */
var DOCUMENTED_DIGEST = 'cd2a7e38a39bd84902ac1a0d69f50e2a';

/**
 * The request policy, mirroring responses.json#requestPolicy. Every value here is load-bearing:
 *  - no Accept header, because app.js:L161-L163 turns any accept containing application/json into an
 *    API request, which would make all twelve session-required parameterless GETs answer 401 instead
 *    of the measured seven;
 *  - the exact User-Agent, because routeParser.js:L29-L52 sniffs it for isMobile and aceOff and both
 *    reach the templates;
 *  - no redirect following, because most Location values are absolutized to https://trinket.dev and
 *    following one would leave the system under test;
 *  - a mandatory timeout, because a handler that never settles its response (the baseline no-response
 *    fate catalogued in docs/PRESERVED-QUIRKS.md) would otherwise hang the run forever.
 */
var POLICY = {
  referer         : 'https://trinket.dev',
  userAgent       : 'trinket-oss-baseline-capture/1.0 (R-6 parity harness)',
  followRedirects : false,
  timeoutMs       : 15000
};

/**
 * The ADDITIVE redirect-resolution reading, mirroring responses.json#requestPolicy.resolutionReading.
 * Constraint 4 in the file header is the whole specification of this block, and every field below is one
 * of its clauses rather than a tunable:
 *
 *   follow            the resolved reading exists at all, because the Technical Specification's
 *                     published 25/7/25/1 tally counts terminal responses and §0.7.5 is the authority
 *                     for what this corpus must reproduce;
 *   maxHops           a bound, so a redirect cycle in the application cannot spin the harness;
 *   sections          UNAUTHENTICATED ONLY. The authenticated and assignment sections are first-hop
 *                     only and carry no resolution fields, because resolving them requires a session
 *                     cookie and a cookie-bearing GET consumes flash state;
 *   sendsCookies      NEVER. A resolution hop that carried a cookie would mutate the session whose
 *                     first-hop readings were just recorded;
 *   runsAfter         the entire primary capture. Ordering, not intent, is what makes the pass
 *                     additive: nothing measured can follow a resolution request.
 */
var RESOLUTION = {
  follow       : true,
  maxHops      : 10,
  sections     : ['unauthenticated'],
  sendsCookies : false,
  // Spelled to match responses.json#requestPolicy.resolutionReading.runsAfter BYTE FOR BYTE, because
  // test/baseline/replay.js#requestPolicyMismatches compares the two and refuses to replay when they
  // disagree. One policy, one spelling: an artifact and a harness that describe the ordering rule
  // differently are two policies, and a diff taken under the wrong one compares policies not behavior.
  runsAfter    : 'the unauthenticated, authenticated and assignmentNext sections are ALL recorded'
};

var RESOLUTION_STATUSES = [301, 302, 303, 307, 308];

/**
 * The runtime override, mirroring responses.json#metadata.nodeConfigOverride. The cookie password is
 * a deliberate non-secret placeholder: it is a capture-time input, not a credential. It seals
 * throwaway sessions for a throwaway user on a loopback port, and the sealed payload it produces is
 * redacted everywhere in the artifact.
 *
 * `databasePrefix` is the disposable database this harness owns. It is deliberately spelled so that it
 * matches the SAME allow-list test/helpers/db.js:L34 applies before it drops a database
 * (/^test([_-][A-Za-z0-9][A-Za-z0-9_-]*)?$/), because there is exactly one definition of "disposable"
 * in this repository and a second one would be a second thing to get wrong.
 */
var RUNTIME = {
  hostname              : '127.0.0.1',
  defaultPort           : 30112,
  databasePrefix        : 'test_baseline',
  sessionCookiePassword : 'baseline-capture-placeholder-not-a-real-secret-0000'
};

/**
 * test/helpers/db.js:L34 verbatim — the ONLY shape of database name this repository treats as
 * disposable. `test` is what config/test.yaml declares, `test_<suffix>` / `test-<suffix>` admit the
 * per-clone namespaces test/setup.js and resolveDatabase() derive. Anything else — `trinket`,
 * `trinket_test`, `production`, `test.backup` — fails closed.
 */
var DISPOSABLE_DATABASE = /^test([_-][A-Za-z0-9][A-Za-z0-9_-]*)?$/;

/**
 * The database configureRuntime() forced, or null when this module was required rather than run (which
 * is what happens inside `npm test`, where test/setup.js owns the database instead). Recorded so the
 * guard below can demand the exact forced name in a harness process while still admitting the mocha
 * suite's own disposable database when test/lib/api/route-parity.js calls the identity helpers.
 */
var FORCED_DATABASE = null;

/** The exact merged NODE_CONFIG configureRuntime() installed, for metadata.nodeConfigOverride. */
var EFFECTIVE_NODE_CONFIG = null;

/**
 * Errors raised while removing a throwaway identity. Collected rather than thrown away: a capture that
 * left an identity behind has polluted the datastore it was given, which the run must report as a
 * failure instead of finishing quietly.
 */
var CLEANUP_ERRORS = [];

/**
 * The throwaway identity. The email and username are the ones recorded in
 * responses.json#metadata.throwawayUser. The two password lengths are recovered from the recorded
 * POST /login request content-lengths rather than guessed: the JSON envelope
 * {"email":"baseline-capture@example.com","password":""} is 54 bytes, the valid login recorded
 * content-length 73 (=> a 19-character password) and the invalid login recorded 81 (=> 27), so these
 * two literals reproduce both recorded content-length headers exactly.
 */
var THROWAWAY = {
  fullname      : 'baseline capture',
  username      : 'baselinecapture',
  email         : 'baseline-capture@example.com',
  password      : 'baselineCapture!234',
  wrongPassword : 'definitely-not-the-password'
};

/**
 * The assignment `next` flow, mirroring responses.json#assignmentNextContract.
 *
 * `destinationPath` is the path half of the destination the frozen assignment UI produces:
 * public/partials/directives/trinket-assignment.js registers `.filter('escape', …)` as
 * window.encodeURIComponent at L8 and scope.goto (L334-L339) sends
 * next = encodeURIComponent($window.location.href), while public/js/trinket-config.js#getUrl
 * (L34-L39) targets config.protocol + '://' + config.apphostname. The wire shape is therefore a
 * percent-encoded ABSOLUTE same-origin URL, and the query and fragment are part of it because
 * location.href carries both.
 *
 * The ORIGIN half is deliberately not a literal here: it is taken from the live configuration, so the
 * flow is driven against the origin the process is actually configured for. That is sound because
 * originPrecondition() has already established the process is configured for the origin the corpus was
 * captured under; the resulting request path and Location are then compared byte for byte, including the
 * percent-encoded origin inside the query string.
 *
 * `signup` is a SECOND throwaway identity, needed because POST /users creates a user: the login
 * leg reuses THROWAWAY, and this one is removed before and after the signup leg so the leg starts
 * from the same state every time.
 */
var ASSIGNMENT = {
  destinationPath : '/u/instructor/classes/algebra-1?assignment=7#work',
  rootRelative    : '/courses/algebra-1',
  signup          : {
    formName : 'sign-up',
    fullname : 'assignment next',
    username : 'assignmentnext',
    email    : 'assignment-next@example.com',
    password : 'assignmentNext!234'
  }
};

/** Fields compared per entry by compareCorpus(). Prose (`notes`, `state`) is never compared. */
var COMPARED_FIELDS = [
  'requestHeaders',
  'status',
  'statusText',
  'headers',
  'contentType',
  'setCookie',
  'setCookieAttributes',
  'location',
  'isApiRequest',
  'bodyShape',
  'redirectChain',
  'resolved'
];

// Committed artifacts

function loadCommittedCorpus() {
  return JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
}

function loadCommittedRouteTable() {
  return JSON.parse(fs.readFileSync(ROUTE_TABLE_PATH, 'utf8'));
}

// Runtime configuration — must run before anything requires `config` or `app.js`

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Recursive merge of plain objects; `source` wins. Arrays and scalars are replaced, not merged. */
function deepMerge(target, source) {
  var merged = isPlainObject(target) ? target : {};

  Object.keys(source || {}).forEach(function(key) {
    if (isPlainObject(source[key]) && isPlainObject(merged[key])) {
      merged[key] = deepMerge(merged[key], source[key]);
    }
    else {
      merged[key] = source[key];
    }
  });

  return merged;
}

/**
 * The bind port. BASELINE_PORT wins; otherwise 30112 (the port recorded in metadata.serverUri) is
 * offset by CLONE_INDEX so parallel clones under the shared /tmp/blitzy workspace cannot collide.
 * The port is not part of the corpus: config.url is https://trinket.dev regardless of the bind port,
 * and normalizationContract.mayBeNormalized explicitly permits "the ephemeral port inside any
 * self-referential URL".
 */
function resolvePort() {
  if (process.env.BASELINE_PORT) {
    return parseInt(process.env.BASELINE_PORT, 10);
  }

  var cloneIndex = parseInt(process.env.CLONE_INDEX || '0', 10);

  if (isNaN(cloneIndex)) {
    cloneIndex = 0;
  }

  return RUNTIME.defaultPort + cloneIndex;
}

/**
 * The disposable database this run owns. BASELINE_MONGO_DATABASE wins; otherwise
 * `test_baseline[_<CLONE_INDEX>]`, sanitized the way test/setup.js sanitizes CLONE_INDEX. The result is
 * validated against DISPOSABLE_DATABASE here, at the point it is chosen, so a bad value fails loudly at
 * configuration time instead of much later from inside a delete.
 *
 * Forcing a name at all is mandatory: without it the capture inherits whatever node-config finally
 * resolved — for a developer who followed docs/setup.md that is the `trinket` DEVELOPMENT database — and
 * this harness deletes documents by a fixed email before it creates them.
 */
function resolveDatabase() {
  var explicit = process.env.BASELINE_MONGO_DATABASE;

  if (explicit) {
    if (!DISPOSABLE_DATABASE.test(explicit)) {
      throw new Error('capture.js: BASELINE_MONGO_DATABASE=' + JSON.stringify(explicit) + ' is not a ' +
                      'disposable database name. Only "test" and "test_<suffix>" are disposable, ' +
                      'because this harness creates and deletes documents in whatever it is pointed at.');
    }

    return explicit;
  }

  if (!process.env.CLONE_INDEX) {
    return RUNTIME.databasePrefix;
  }

  var suffix = String(process.env.CLONE_INDEX).replace(/[^A-Za-z0-9_-]/g, ''),
      name   = RUNTIME.databasePrefix + '_' + suffix;

  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(suffix) || !DISPOSABLE_DATABASE.test(name)) {
    throw new Error('capture.js: CLONE_INDEX=' + JSON.stringify(process.env.CLONE_INDEX) + ' reduces ' +
                    'to ' + JSON.stringify(suffix) + ' once the characters a database name may not ' +
                    'carry are stripped, which would select ' + JSON.stringify(name) + ' — not a name ' +
                    'this harness treats as disposable. Use a value starting with a letter or digit, ' +
                    'or set BASELINE_MONGO_DATABASE explicitly.');
  }

  return name;
}

/**
 * Injects the runtime override into NODE_CONFIG. Any NODE_CONFIG the caller already exported is used
 * as the base and merged, so an operator can add their own keys — including the app.url that
 * constraint 3 forbids this function from inventing; the five keys this function owns (app.start,
 * app.hostname, app.port, the session cookie password and db.mongo.database) always win, because the
 * capture cannot safely happen without them. MUST be called before startServer(), i.e. before
 * `config` is required.
 *
 * The merged result is both returned AND retained in EFFECTIVE_NODE_CONFIG, so a write run records the
 * override it actually ran under rather than a hand-written literal that can drift from it.
 */
function configureRuntime(extraOverrides) {
  process.env.NODE_ENV = 'test';
  process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';

  var base = {};

  if (process.env.NODE_CONFIG) {
    base = JSON.parse(process.env.NODE_CONFIG);
  }

  var database = resolveDatabase(),
      merged   = deepMerge(deepMerge(base, extraOverrides || {}), {
        app : {
          start    : true,
          hostname : RUNTIME.hostname,
          port     : resolvePort(),
          plugins  : {
            session : {
              cookieOptions : { password : RUNTIME.sessionCookiePassword }
            }
          }
        },
        db : {
          mongo : { database : database }
        }
      });

  process.env.NODE_CONFIG = JSON.stringify(merged);
  FORCED_DATABASE         = database;
  EFFECTIVE_NODE_CONFIG   = JSON.parse(JSON.stringify(merged));

  return merged;
}

/** The exact merged override the last configureRuntime() call installed, or null. */
function effectiveNodeConfig() {
  return EFFECTIVE_NODE_CONFIG ? JSON.parse(JSON.stringify(EFFECTIVE_NODE_CONFIG)) : null;
}

/**
 * Fails closed unless the live mongoose connection is pointed at a database it is safe to mutate.
 *
 * FIVE clauses, all required. The name on its own is not enough: a `local.yaml` or a NODE_CONFIG layer
 * naming a remote, credentialed, SRV-resolved, replica-set or TLS endpoint whose database happens to be
 * called `test` must not pass this gate. Clause 5 checks the ENDPOINT as well as the name, and it is the
 * SAME code test/helpers/db.js runs: test/helpers/disposable-endpoint is one side-effect-free module both
 * destructive callers require, so neither can be hardened without the other.
 *
 * Why each clause is necessary on its own:
 *   1. NODE_ENV - a floor, but not sufficient: NODE_CONFIG can repoint the database without touching it.
 *   2. An open connection whose two database names agree - mongoose's record and the driver's, so a
 *      mismatch cannot slip a non-disposable name past the pattern.
 *   3. The DISPOSABLE_DATABASE name pattern - necessary, but a deployment could own a database called
 *      `test`, which is exactly why clause 5 exists.
 *   4. FORCED_DATABASE - when this process configured the runtime itself, the connection must be on
 *      exactly the database configureRuntime() forced, so a stray NODE_CONFIG layer or a later reconnect
 *      cannot move the deletes somewhere else. This clause is this function's own; db.js has no
 *      equivalent because nothing forces a database on its behalf.
 *   5. The ENDPOINT - a credential-free loopback mongod with no SRV cluster, no replica set and no TLS.
 *
 * @param   {string} operation A short label naming the caller, used in the thrown message.
 * @returns {string} The validated database name.
 * @throws  {Error}  When the environment, the connection, the database name or the endpoint is not safe
 *   to mutate.
 */
function assertDisposableDatabase(operation) {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('capture.js refused to ' + operation + ': NODE_ENV is ' +
                    JSON.stringify(process.env.NODE_ENV) + ', not "test".');
  }

  var connection = require('mongoose').connection;

  if (!connection || !connection.db) {
    throw new Error('capture.js refused to ' + operation + ': there is no open mongoose connection to ' +
                    'validate, so the target database cannot be identified.');
  }

  var name       = connection.name,
      driverName = connection.db.databaseName;

  if (!name || !driverName || name !== driverName) {
    throw new Error('capture.js refused to ' + operation + ': mongoose reports database ' +
                    JSON.stringify(name) + ' while the driver is addressing ' +
                    JSON.stringify(driverName) + '.');
  }

  if (!DISPOSABLE_DATABASE.test(name)) {
    throw new Error('capture.js refused to ' + operation + ' in the database ' + JSON.stringify(name) +
                    ': only "test" and "test_<suffix>" are treated as disposable. Point ' +
                    'db.mongo.database at a disposable name (BASELINE_MONGO_DATABASE) before running ' +
                    'the harness.');
  }

  if (FORCED_DATABASE && name !== FORCED_DATABASE) {
    throw new Error('capture.js refused to ' + operation + ' in the database ' + JSON.stringify(name) +
                    ': this run forced ' + JSON.stringify(FORCED_DATABASE) + ', so something moved the ' +
                    'connection after configureRuntime() ran.');
  }

  // THE ENDPOINT CLAUSE. The four clauses above all describe the database NAME and
  // the process; none of them describes the SERVER. configureRuntime() forces db.mongo.host to a loopback
  // address, but a NODE_CONFIG layer or a config/local.yaml is read alongside that and can move the host
  // without moving the name - so the host the driver actually resolved is read back off the live
  // connection here, immediately before anything is written, rather than being assumed from what this
  // process asked for.
  var endpointReasons = endpointGate.nonDisposableIdentityReasons(require('mongoose').connection);

  if (endpointReasons.length) {
    throw new Error('capture.js refused to ' + operation + ' in the database ' + JSON.stringify(name) +
                    ': ' + endpointGate.refusalTail(endpointReasons) + ' configureRuntime() forces that ' +
                    'identity through $NODE_CONFIG; a run that reaches here has had it overridden.');
  }

  return name;
}

/**
 * Refuses to delete a document that is not the throwaway identity this harness created. `findById` on
 * the User model resolves by email (lib/models/user.js:L328 alternateIds), and an email is not proof of
 * provenance: a real account could legitimately hold it. Every field the harness sets is therefore
 * compared before a delete, and a mismatch aborts the run instead of destroying someone's record.
 *
 * @param   {Object} doc      The document found by email.
 * @param   {Object} identity The harness identity that email belongs to.
 * @param   {string} operation A short label naming the caller, used in the thrown message.
 * @returns {Object} The document, when it is safe to delete.
 * @throws  {Error}  When the document does not match the harness identity.
 */
function assertHarnessIdentity(doc, identity, operation) {
  var mismatched = ['username', 'email'].filter(function(field) {
    return String(doc[field] || '') !== String(identity[field] || '');
  });

  if (mismatched.length) {
    throw new Error('capture.js refused to ' + operation + ': the document holding ' +
                    JSON.stringify(identity.email) + ' does not match the harness identity (' +
                    mismatched.map(function(field) {
                      return field + '=' + JSON.stringify(doc[field]);
                    }).join(', ') + '). It was not created by this harness, so it is not this ' +
                    'harness\'s to delete.');
  }

  return doc;
}

/** The cleanup failures collected so far; empty means every throwaway identity was removed. */
function cleanupErrors() {
  return CLEANUP_ERRORS.slice();
}

function resetCleanupErrors() {
  CLEANUP_ERRORS.length = 0;
}

/**
 * Boots the application. app.js:L356 exports the promise returned by init(), which resolves to the
 * started hapi server. Requiring app.js is what creates the nine implicit model globals the capture
 * needs (User in particular), so this must complete before createThrowawayUser() runs.
 */
function startServer() {
  return Promise.resolve(require('../../app.js')).then(function(server) {
    if (!server || !server.info || !server.info.uri) {
      throw new Error('capture.js: the application did not expose a listening server. app.start was ' +
                      'not honoured — check that configureRuntime() ran before startServer().');
    }

    return server;
  });
}

function stopServer(server) {
  if (!server) {
    return Promise.resolve();
  }

  return server.stop({ timeout : 1000 }).catch(function() { return undefined; });
}

// Real HTTP

/**
 * One real HTTP request. node:http adds only Host and Connection beyond the headers passed in, which
 * is what keeps every recorded content-length an identity length (no Accept-Encoding is ever sent, so
 * nothing is content-encoded). Resolves with { timedOut : true } rather than rejecting when the
 * per-request budget is exhausted, so a never-settling handler is recorded as an outcome instead of
 * hanging the run.
 */
function httpRequest(server, options) {
  return new Promise(function(resolve, reject) {
    var headers = { referer : POLICY.referer, 'user-agent' : POLICY.userAgent };

    Object.keys(options.headers || {}).forEach(function(key) {
      headers[key] = options.headers[key];
    });

    var payload = null;

    if (options.payload !== undefined && options.payload !== null) {
      payload = Buffer.from(options.payload, 'utf8');
      headers['content-type']   = options.contentType || 'application/json';
      headers['content-length'] = String(payload.length);
    }

    var request = http.request({
      host    : server.info.host,
      port    : server.info.port,
      path    : options.path,
      method  : options.method || 'GET',
      headers : headers
    }, function(response) {
      var chunks = [];

      response.on('data', function(chunk) { chunks.push(chunk); });
      response.on('end', function() {
        resolve({
          status         : response.statusCode,
          statusText     : response.statusMessage,
          headers        : response.headers,
          body           : Buffer.concat(chunks),
          requestHeaders : headers,
          timedOut       : false
        });
      });
    });

    request.setTimeout(POLICY.timeoutMs, function() {
      request.destroy();
      resolve({
        status         : null,
        statusText     : 'timeout',
        headers        : {},
        body           : Buffer.alloc(0),
        requestHeaders : headers,
        timedOut       : true
      });
    });

    request.on('error', function(err) {
      if (request.destroyed) {
        return;
      }

      reject(err);
    });

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

// Header normalization

/**
 * Redacts one Set-Cookie (or Cookie) header value. Two things are neutralized and nothing else: the
 * iron-sealed payload after the Fe26.2 prefix, and the absolute date of the Expires attribute that
 * app.js:L205-L240 appends on cookie-declaring routes. The cookie NAME, the Fe26.2 PREFIX and the
 * PRESENCE of every attribute survive verbatim, because all three are contractual — see
 * normalizationContract.mustNotBeNormalized.
 */
function redactSetCookie(value) {
  return String(value)
    .replace(/Fe26\.2\*[^;]*/, 'Fe26.2*<REDACTED_IRON_SEAL_PAYLOAD>')
    .replace(/Expires=[^;]*/, 'Expires=<normalized:expires>');
}

/** The attribute NAMES of one Set-Cookie value, in header order, excluding the name=value pair. */
function setCookieAttributeNames(value) {
  return String(value).split(';').slice(1).map(function(part) {
    var trimmed = part.trim(),
        equals  = trimmed.indexOf('=');

    return equals === -1 ? trimmed : trimmed.slice(0, equals);
  }).filter(function(name) { return name.length > 0; });
}

/**
 * Normalizes a response header bag for the artifact: keys sorted, Date replaced with a marker, every
 * Set-Cookie redacted. Nothing else is touched — Cache-Control, Pragma, Expires, X-Frame-Options,
 * Location, Content-Type and Content-Length are all compared literally.
 */
function normalizeResponseHeaders(raw) {
  var normalized = {};

  Object.keys(raw || {}).sort().forEach(function(key) {
    if (key === 'date') {
      normalized[key] = '<normalized:date>';
    }
    else if (key === 'set-cookie') {
      normalized[key] = [].concat(raw[key]).map(redactSetCookie);
    }
    else {
      normalized[key] = raw[key];
    }
  });

  return normalized;
}

/** Normalizes the request headers we sent, so a live Cookie value never lands in the artifact. */
function normalizeRequestHeaders(raw) {
  var normalized = {};

  Object.keys(raw || {}).forEach(function(key) {
    normalized[key] = key === 'cookie' ? redactSetCookie(raw[key]) : raw[key];
  });

  return normalized;
}

// HTML body normalization — rules read from the artifact, roles-token matches structurally gated

/**
 * The measured structural invariants of the roles token produced by lib/util/roles.js#encrypt and
 * consumed by public/js/trinket-roles.js:L10-L11. These are asserted for EVERY match before the
 * roles-token normalization rule is allowed to substitute, so a build whose crypto changed shape
 * cannot have that change silently erased by the normalizer. Mirrored in
 * responses.json#cryptoParityContract.
 */
var ROLES_TOKEN_OBSERVATIONS = [];

function resetRolesTokenObservations() {
  ROLES_TOKEN_OBSERVATIONS.length = 0;

  return ROLES_TOKEN_OBSERVATIONS;
}

var ROLES_TOKEN_INVARIANTS = {
  hexTokenPattern       : /^[0-9a-f]{32}$/,
  hexTokenLength        : 32,
  envelopeBase64Prefix  : 'U2FsdGVkX1',
  envelopeMagic         : 'Salted__',
  envelopeMagicLength   : 8,
  base64LengthModulus   : 4,
  rawByteLengthModulus  : 16
};

/**
 * Verifies one roles-token match. Throws — never returns false — because the caller is a normalizer
 * and the artifact's prohibition is explicit: a real difference must be reported, not normalized
 * away. The three checks correspond exactly to the three halves of the token contract: a 32-character
 * lowercase hex AES passphrase, an OpenSSL "Salted__" envelope, and a ciphertext length that is a
 * whole number of AES blocks (which is what makes the length a deterministic function of the
 * plaintext length and therefore safely assertable).
 */
function assertRolesTokenStructure(hexToken, envelopeBase64, context) {
  var where = context ? ' (' + context + ')' : '';

  if (!ROLES_TOKEN_INVARIANTS.hexTokenPattern.test(hexToken)) {
    throw new Error('capture.js: roles token passphrase is not 32 lowercase hex characters' + where +
                    ': ' + JSON.stringify(hexToken));
  }

  if (envelopeBase64.indexOf(ROLES_TOKEN_INVARIANTS.envelopeBase64Prefix) !== 0) {
    throw new Error('capture.js: roles token ciphertext does not start with the OpenSSL base64 ' +
                    'prefix ' + ROLES_TOKEN_INVARIANTS.envelopeBase64Prefix + where);
  }

  if (envelopeBase64.length % ROLES_TOKEN_INVARIANTS.base64LengthModulus !== 0) {
    throw new Error('capture.js: roles token ciphertext is not a whole number of base64 quanta' +
                    where + ': length ' + envelopeBase64.length);
  }

  var raw = Buffer.from(envelopeBase64, 'base64');

  if (raw.slice(0, ROLES_TOKEN_INVARIANTS.envelopeMagicLength).toString('latin1') !==
      ROLES_TOKEN_INVARIANTS.envelopeMagic) {
    throw new Error('capture.js: roles token ciphertext does not carry the OpenSSL "' +
                    ROLES_TOKEN_INVARIANTS.envelopeMagic + '" magic' + where);
  }

  if (raw.length % ROLES_TOKEN_INVARIANTS.rawByteLengthModulus !== 0) {
    throw new Error('capture.js: roles token ciphertext is not a whole number of AES blocks' + where +
                    ': ' + raw.length + ' bytes');
  }

  return { hexLength : hexToken.length, base64Length : envelopeBase64.length, rawLength : raw.length };
}

/**
 * The HTML normalization rules, read from the committed artifact so the harness and the contract
 * cannot drift. Order matters and is the array order: the roles-token rule (a 32-hex passphrase, a
 * '+', then an OpenSSL envelope) must run before the bare-envelope rule, or the bare rule would eat
 * the envelope half and leave a dangling passphrase behind.
 */
function htmlNormalizationRules(corpus) {
  var contract = (corpus || loadCommittedCorpus()).normalizationContract.htmlBodyNormalization;

  return contract.rules.map(function(rule) {
    return {
      regexp      : new RegExp(rule.pattern, 'g'),
      replacement : rule.replacement,
      pattern     : rule.pattern,
      gated       : rule.pattern.indexOf('U2FsdGVkX1') !== -1 &&
                    rule.pattern.indexOf('[0-9a-f]{32}') !== -1
    };
  });
}

/**
 * Applies the normalization contract to an HTML body and returns { normalized, rolesTokens }, where
 * rolesTokens is the structural measurement of every roles token found. Any roles token that violates
 * ROLES_TOKEN_INVARIANTS throws out of here rather than being normalized.
 */
function normalizeHtmlBody(body, rules, context) {
  var normalized  = String(body),
      rolesTokens = [],
      observed    = ROLES_TOKEN_OBSERVATIONS;

  rules.forEach(function(rule) {
    if (rule.gated) {
      var gate = new RegExp('([0-9a-f]{32})\\+(U2FsdGVkX1[A-Za-z0-9+/=]*)', 'g'),
          match;

      while ((match = gate.exec(normalized)) !== null) {
        var measurement = assertRolesTokenStructure(match[1], match[2], context);

        rolesTokens.push(measurement);
        observed.push({
          context      : context || null,
          hexLength    : measurement.hexLength,
          base64Length : measurement.base64Length,
          rawLength    : measurement.rawLength
        });
      }
    }

    normalized = normalized.replace(rule.regexp, rule.replacement);
  });

  return { normalized : normalized, rolesTokens : rolesTokens };
}

// Body shape

function extractTitle(html) {
  var match = /<title>([\s\S]*?)<\/title>/i.exec(html);

  return match ? match[1].trim() : null;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The three body kinds the corpus records — html, json and empty — reproduced exactly. HTML bodies are
 * never stored verbatim: raw HTML digests differ between otherwise identical runs, so only the
 * normalized digest, the byte counts, the <title> and three structural markers are recorded.
 */
function describeBody(contentType, body, rules, context) {
  var bytes = body.length;

  if (bytes === 0) {
    return { kind : 'empty', bytes : 0 };
  }

  var type = String(contentType || '').toLowerCase(),
      text = body.toString('utf8');

  if (type.indexOf('application/json') === 0) {
    var parsed = JSON.parse(text),
        shape  = {
          kind     : 'json',
          bytes    : bytes,
          isArray  : Array.isArray(parsed),
          keys     : Array.isArray(parsed) ? [] : Object.keys(parsed).sort(),
          keyCount : Array.isArray(parsed) ? parsed.length : Object.keys(parsed).length
        };

    shape.stableScalars = {};

    if (!Array.isArray(parsed)) {
      Object.keys(parsed).forEach(function(key) {
        var value = parsed[key];

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          shape.stableScalars[key] = value;
        }
      });

      if (isPlainObject(parsed.flash)) {
        shape.flashKeys = Object.keys(parsed.flash).sort();
      }
    }

    shape.body = parsed;

    return shape;
  }

  if (type.indexOf('text/html') === 0) {
    var result = normalizeHtmlBody(text, rules, context);

    return {
      kind            : 'html',
      bytes           : bytes,
      normalizedBytes : Buffer.byteLength(result.normalized, 'utf8'),
      sha256          : sha256(result.normalized),
      title           : extractTitle(result.normalized),
      markers         : {
        notFoundPage    : /<title>\s*Page not found\s*<\/title>/i.test(result.normalized),
        serverErrorPage : /<title>\s*Something went wrong\s*<\/title>/i.test(result.normalized),
        hasDoctype      : /^\s*<!doctype html/i.test(result.normalized)
      }
    };
  }

  return {
    kind   : 'other',
    bytes  : bytes,
    sha256 : sha256(text)
  };
}

/**
 * app.js:L161-L163 verbatim. Recorded per entry because it is what decides whether a Boom takes the
 * HTML error branch (redirect to /login, 404.html, 50x.html) or is emitted as raw JSON.
 */
function computeIsApiRequest(requestPath, acceptHeader) {
  var accept = acceptHeader || '';

  return requestPath.indexOf('/api/') === 0 ||
         accept.indexOf('application/json') !== -1 ||
         requestPath.indexOf('/partials/') === 0;
}

/** Assembles one corpus entry from a live response. Field order matches the committed artifact. */
function buildEntry(method, requestPath, response, rules, state) {
  var headers     = normalizeResponseHeaders(response.headers),
      contentType = response.headers['content-type'] || null,
      setCookie   = response.headers['set-cookie'] ? [].concat(response.headers['set-cookie']) : null,
      context     = method + ' ' + requestPath,
      entry       = {
        method              : method,
        path                : requestPath,
        requestHeaders      : normalizeRequestHeaders(response.requestHeaders),
        status              : response.status,
        statusText          : response.statusText,
        headers             : headers,
        contentType         : contentType,
        setCookie           : setCookie ? setCookie.map(redactSetCookie) : null,
        setCookieAttributes : setCookie ? setCookie.map(setCookieAttributeNames) : null,
        location            : response.headers.location || null,
        isApiRequest        : computeIsApiRequest(requestPath, response.requestHeaders.accept),
        bodyShape           : describeBody(contentType, response.body, rules, context)
      };

  if (state) {
    entry.state = state;
  }

  return entry;
}


// Redirect resolution — the additive reading (responses.json#requestPolicy.resolutionReading)

function isRedirectStatus(status) {
  return RESOLUTION_STATUSES.indexOf(status) !== -1;
}

/**
 * Decides whether one Location can be followed without leaving the process under test, and what it maps
 * onto. Three shapes are followable — a relative path, an absolute URL on the configured origin, and an
 * absolute URL on the probe's own origin — and everything else is recorded with `target : null`, which
 * stops the chain with `stoppedBecause : "off-site"`.
 *
 * The origin test is EXACT ORIGIN EQUALITY through the non-throwing static URL.parse, never a string
 * prefix. `https://trinket.dev.evil.example/x` and `https://trinket.dev@evil.example/x`
 * both begin with the configured origin as a string, and a prefix match would have mapped either of them
 * onto the local probe and requested it — a harness that follows an attacker-shaped Location and then
 * records the result as this application's behavior. URL.parse is used rather than `new URL` because it
 * returns null instead of throwing ERR_INVALID_URL on the malformed values a redirect can legitimately
 * carry, and null is a measurement here: the chain stops.
 */
function classifyHopTarget(location, configOrigin, probeOrigin) {
  if (typeof location !== 'string' || location === '') {
    return { kind : 'none', mappedBy : null, target : null };
  }

  if (location.indexOf('//') === 0) {
    return { kind : 'protocol-relative', mappedBy : null, target : null };
  }

  if (location.charAt(0) === '/') {
    return { kind : 'relative', mappedBy : 'relative', target : location };
  }

  var parsed = URL.parse(location);

  if (!parsed) {
    return { kind : 'unparseable', mappedBy : null, target : null };
  }

  var origins = [
    { origin : configOrigin, mappedBy : 'config.url origin' },
    { origin : probeOrigin,  mappedBy : 'probe origin' }
  ];

  for (var index = 0; index < origins.length; index++) {
    var candidate = origins[index],
        reference = candidate.origin ? URL.parse(candidate.origin) : null;

    if (reference && parsed.origin === reference.origin) {
      return {
        kind     : 'absolute',
        mappedBy : candidate.mappedBy,
        target   : (parsed.pathname || '/') + (parsed.search || '') + (parsed.hash || '')
      };
    }
  }

  return { kind : 'absolute', mappedBy : null, target : null };
}

/**
 * The terminal response of a chain, in the four dimensions the artifact records. Deliberately NOT
 * describeBody(): the resolved body is a second reading of a page whose own first-hop entry already
 * carries the normalized shape, and running the HTML normalizer here would add roles-token observations
 * for bodies that are not part of the corpus proper.
 */
function describeResolvedBody(contentType, body) {
  var type  = String(contentType || '').toLowerCase(),
      bytes = body.length;

  if (bytes === 0) {
    return { bytes : 0, kind : 'empty', title : null };
  }

  if (type.indexOf('application/json') === 0) {
    return { bytes : bytes, kind : 'json', title : null };
  }

  if (type.indexOf('text/html') === 0) {
    return { bytes : bytes, kind : 'html', title : extractTitle(body.toString('utf8')) };
  }

  return { bytes : bytes, kind : 'other', title : null };
}

/**
 * Walks one entry's Location chain to its terminal response and returns the `redirectChain` and
 * `resolved` fields. Every followed hop is a GET (RFC 9110 302 handling, which is also what a browser
 * and `curl -L` do) and an already-visited URL is recorded but not re-requested.
 *
 * NO HOP EVER CARRIES A COOKIE. There is deliberately no parameter to pass one: constraint 4 in the file
 * header is enforced by the shape of this function rather than by the discipline of its callers, because
 * the defect it replaces was exactly a caller pinning a session cookie onto the chain. A cookie-less hop
 * cannot consume a flash message, so it cannot move a reading that was already recorded — and, since
 * resolveUnauthenticated() is the only caller and runs after every section, there is no later reading to
 * move either.
 */
function followRedirectChain(server, seed) {
  var configOrigin = liveAppUrlOrigin(),
      probeOrigin  = server.info.uri,
      chain        = [],
      visited      = {},
      hops         = 0,
      state        = {
        status      : seed.response.status,
        statusText  : seed.response.statusText,
        headers     : seed.response.headers,
        // The seed's shape comes from the caller's already-recorded first hop rather than from a body
        // this function re-reads, so a chain that stops at hop 0 (an off-site or unparseable Location)
        // restates the recorded first hop exactly instead of reporting an empty body.
        shape       : seed.shape,
        requested   : seed.path,
        method      : seed.method
      };

  visited[seed.method + ' ' + seed.path] = true;

  function terminate(stoppedBecause) {
    var shape = state.shape;

    return {
      redirectChain : chain,
      resolved      : {
        status         : state.status,
        contentType    : state.headers['content-type'] || null,
        bytes          : shape.bytes,
        kind           : shape.kind,
        title          : shape.title,
        hops           : hops,
        stoppedBecause : stoppedBecause
      }
    };
  }

  function step() {
    if (!RESOLUTION.follow || !isRedirectStatus(state.status)) {
      return Promise.resolve(terminate('terminal'));
    }

    if (hops >= RESOLUTION.maxHops) {
      return Promise.resolve(terminate('max-hops'));
    }

    var location = state.headers.location || null,
        target   = classifyHopTarget(location, configOrigin, probeOrigin),
        hop      = {
          hop                     : hops + 1,
          requested               : state.requested,
          method                  : state.method,
          status                  : state.status,
          location                : location,
          locationKind            : target.kind,
          mappedOntoProbeOriginBy : target.mappedBy,
          followed                : false,
          followedAs              : null
        };

    if (!target.target) {
      chain.push(hop);

      return Promise.resolve(terminate(target.kind === 'none' ? 'no-location' : 'off-site'));
    }

    if (visited['GET ' + target.target]) {
      chain.push(hop);

      return Promise.resolve(terminate('loop'));
    }

    hop.followed   = true;
    hop.followedAs = target.target;
    chain.push(hop);
    visited['GET ' + target.target] = true;
    hops += 1;

    return httpRequest(server, {
      method : 'GET',
      path   : target.target
    }).then(function(response) {
      state = {
        status     : response.status,
        statusText : response.statusText,
        headers    : response.headers,
        shape      : describeResolvedBody(response.headers['content-type'] || null, response.body),
        requested  : target.target,
        method     : 'GET'
      };

      return step();
    });
  }

  return step();
}

/** Attaches the two resolution fields to an entry in the committed field order. */
function attachResolution(entry, resolution) {
  entry.redirectChain = resolution.redirectChain;
  entry.resolved      = resolution.resolved;

  return entry;
}


// Corpus selection and capture

/**
 * responses.json#selectionRule, reproduced against the LIVE route table rather than against the
 * committed row list: `row.method === "GET" && row.path.indexOf("{") === -1`, de-duplicated and
 * sorted ascending. The corpus is therefore a pure function of the registered routes and cannot
 * drift with reviewer taste.
 */
function selectCorpusPaths(server) {
  var seen = {};

  server.table().forEach(function(row) {
    if (String(row.method).toUpperCase() === 'GET' && row.path.indexOf('{') === -1) {
      seen[row.path] = true;
    }
  });

  return Object.keys(seen).sort();
}

/**
 * The 58 parameterless GETs, first hop only. Nothing is followed here: the resolved reading is added by
 * resolveUnauthenticated() after every section is recorded, so a resolution request cannot precede a
 * measured value (constraint 4a).
 */
function captureUnauthenticated(server, paths, rules) {
  var entries = [];

  return paths.reduce(function(chain, requestPath) {
    return chain.then(function() {
      return httpRequest(server, { method : 'GET', path : requestPath });
    }).then(function(response) {
      entries.push(buildEntry('GET', requestPath, response, rules));
    });
  }, Promise.resolve()).then(function() {
    return entries;
  });
}

/**
 * The additive resolved reading, attached to the unauthenticated entries in place. Runs LAST and
 * cookie-less, which is what makes it additive in fact and not merely in name — see constraint 4.
 *
 * It is here rather than inside captureUnauthenticated() because ordering is the guarantee: with the
 * whole corpus already recorded, no request this function issues can change a value the artifact
 * carries. The seed response body is re-supplied from the entry's own recorded first hop, so a chain
 * that needs no hop at all (the 42 non-redirecting entries) issues no request whatsoever.
 */
function resolveUnauthenticated(server, entries) {
  return entries.reduce(function(chain, entry) {
    return chain.then(function() {
      return followRedirectChain(server, {
        method   : entry.method,
        path     : entry.path,
        // The seed is the entry's OWN recorded first hop, not a fresh request: re-issuing the first hop
        // would be a second measurement of something already measured, and for the 42 non-redirecting
        // entries this function then issues no request at all.
        response : {
          status     : entry.status,
          statusText : entry.statusText,
          headers    : { 'content-type' : entry.contentType, location : entry.location }
        },
        shape    : {
          bytes : entry.bodyShape.bytes,
          kind  : entry.bodyShape.kind,
          title : entry.bodyShape.title === undefined ? null : entry.bodyShape.title
        }
      }).then(function(resolution) {
        return attachResolution(entry, resolution);
      });
    });
  }, Promise.resolve()).then(function() {
    return entries;
  });
}

/**
 * Creates the throwaway identity through the application's own global User model — never by writing
 * to MongoDB directly, so every pre-save hook (password hashing at lib/models/user.js:L53-L56, the
 * name/username/email normalization at L34-L39, the avatar normalization) runs exactly as it does for
 * a real registration. dropDatabase is never called.
 *
 * The global `User` is the factory's publicModel (lib/models/model.js:L177-L198), a callable
 * constructor with the class methods bolted on — NOT a mongoose model — so mongoose statics such as
 * findOne are deliberately not on it. The generated findById at lib/models/model.js:L115-L148 honours
 * `alternateIds : ['username', 'email']` (lib/models/user.js:L328) and therefore resolves the identity
 * by email through the model's own public API rather than through the NODE_ENV=test `expose.model`
 * leak at lib/models/model.js:L102-L104.
 */
function findThrowawayUser() {
  assertDisposableDatabase('look up the throwaway identity');

  return Promise.resolve(User.findById(THROWAWAY.email));
}

function createThrowawayUser() {
  return removeThrowawayUser().then(function() {
    return new User({
      fullname : THROWAWAY.fullname,
      username : THROWAWAY.username,
      email    : THROWAWAY.email,
      password : THROWAWAY.password
    }).save();
  });
}

/**
 * Removes the throwaway identity, or explains why it did not. Nothing is swallowed:
 * a rejection here means the datastore still holds a document this harness created, so the caller has to
 * see it. Both guards fire before the delete — the database must be disposable, and the document must be
 * this harness's own identity rather than merely something holding the same email.
 */
function removeThrowawayUser() {
  return findThrowawayUser().then(function(existing) {
    if (!existing) {
      return undefined;
    }

    assertHarnessIdentity(existing, THROWAWAY, 'remove the throwaway identity');

    return existing.remove();
  });
}

/** Removes the signup identity, with the same two guards and the same refusal to swallow errors. */
function removeAssignmentSignupUser() {
  assertDisposableDatabase('look up the assignment signup identity');

  return Promise.resolve(User.findById(ASSIGNMENT.signup.email)).then(function(existing) {
    if (!existing) {
      return undefined;
    }

    assertHarnessIdentity(existing, ASSIGNMENT.signup, 'remove the assignment signup identity');

    return existing.remove();
  });
}

/**
 * Removes BOTH throwaway identities, attempting each one even when the other fails, and collecting the
 * failures instead of raising. This is the function every terminal `finally` calls: a capture must not
 * abandon an identity because one step threw, and it must not report success when it did not
 * remove them. Resolves with the list of errors, which main() turns into exit 2.
 */
function cleanupIdentities() {
  var attempts = [
    { label : 'throwaway identity', run : removeThrowawayUser },
    { label : 'assignment signup identity', run : removeAssignmentSignupUser }
  ];

  return attempts.reduce(function(chain, attempt) {
    return chain.then(function() {
      return Promise.resolve().then(attempt.run).catch(function(err) {
        CLEANUP_ERRORS.push(attempt.label + ': ' + (err && err.message ? err.message : String(err)));
      });
    });
  }, Promise.resolve()).then(function() {
    return cleanupErrors();
  });
}

/** The name=value pair of the session cookie from a Set-Cookie bag, or null. */
function extractSessionCookie(response) {
  var cookies = response.headers['set-cookie'];

  if (!cookies) {
    return null;
  }

  var found = null;

  [].concat(cookies).forEach(function(cookie) {
    var pair = String(cookie).split(';')[0];

    if (pair.indexOf('session=') === 0 && pair.length > 'session='.length) {
      found = pair;
    }
  });

  return found;
}

/**
 * The mandatory authenticated supplement, in exactly the recorded order. The order is contractual,
 * not incidental:
 *   [0] POST /login with valid credentials — establishes the session and yields the cookie;
 *   [1] POST /login with a wrong password — sent WITHOUT a cookie, so it cannot disturb [0]'s session;
 *   [2] GET /login   authenticated — the flagship 500 quirk;
 *   [3] GET /signup  authenticated — the other half of the flagship quirk;
 *   [4] GET /home    authenticated — the only entry whose body carries a roles token;
 *   [5] GET /account authenticated — the recorded RELATIVE redirect;
 *   [6] GET /logout  authenticated — LAST, because it clears the session.
 *
 * FIRST HOP ONLY, and no chain is resolved here at any point. This section is the reason constraint 4
 * exists: yar session storage is single-read, so a cookie-bearing GET of a redirect target consumes the
 * flash the next recorded page would have rendered and silently shortens [4]'s own body. Every entry
 * here therefore carries `status`, `location`, `headers` and `bodyShape` exactly as the server answered,
 * and no `redirectChain` or `resolved` field at all.
 */
function captureAuthenticated(server, rules) {
  var entries = [],
      validPayload = JSON.stringify({ email : THROWAWAY.email, password : THROWAWAY.password }),
      wrongPayload = JSON.stringify({ email : THROWAWAY.email, password : THROWAWAY.wrongPassword }),
      cookie       = null;

  return createThrowawayUser().then(function() {
    return httpRequest(server, {
      method      : 'POST',
      path        : '/login',
      payload     : validPayload,
      contentType : 'application/json'
    });
  }).then(function(response) {
    var entry = buildEntry('POST', '/login', response, rules, 'login-flow (valid credentials)');

    cookie = extractSessionCookie(response);

    if (!cookie) {
      throw new Error('capture.js: POST /login did not return a session cookie, so the authenticated ' +
                      'supplement cannot be captured.');
    }

    entries.push(entry);

    return httpRequest(server, {
      method      : 'POST',
      path        : '/login',
      payload     : wrongPayload,
      contentType : 'application/json'
    });
  }).then(function(response) {
    entries.push(buildEntry('POST', '/login', response, rules, 'login-flow (invalid credentials)'));

    return ['/login', '/signup', '/home', '/account', '/logout'].reduce(function(chain, requestPath) {
      return chain.then(function() {
        return httpRequest(server, { method : 'GET', path : requestPath, headers : { cookie : cookie } });
      }).then(function(authResponse) {
        entries.push(buildEntry('GET', requestPath, authResponse, rules, 'authenticated'));
      });
    }, Promise.resolve());
  }).then(function() {
    return entries;
  });
}

// The assignment `next` supplement

/** The absolute same-origin destination the frozen assignment UI would send, on the live origin. */
function assignmentDestination() {
  return liveAppUrlOrigin() + ASSIGNMENT.destinationPath;
}

/** `/login?next=<percent-encoded candidate>`, exactly as trinketConfig.getUrl builds it. */
function assignmentEntryPath(page, candidate) {
  return page + '?next=' + encodeURIComponent(candidate);
}

/**
 * Removes BOTH identities the assignment supplement creates - the signup identity and the primary
 * throwaway user - in the order the successful path has always used.
 *
 * Neither removal can reject: each one ends in its own swallowing `.catch` and resolves with
 * `undefined`, and each is idempotent because it looks the identity up first and removes nothing when
 * it is absent. That is what lets `captureAssignmentNext` call this on its failure path and still
 * rethrow the ORIGINAL capture error - there is no cleanup rejection available to displace it.
 */
function removeAssignmentIdentities() {
  return removeAssignmentSignupUser().then(function() {
    return removeThrowawayUser();
  });
}

/**
 * One assignment leg: GET the entry page so the session persists `next`, then perform the action
 * that consumes it. Both hops are recorded, because the contract has two halves — the entry hop
 * must answer normally while storing the destination, and the consuming hop must emit it.
 *
 * No redirect chain is followed. The consuming hop's Location is the measurement, and following it
 * would leave this contract behind and start measuring whatever page the destination resolves to,
 * which depends on database state the assignment flow does not own.
 */
function captureAssignmentLeg(server, rules, entries, leg) {
  var entryPath = assignmentEntryPath(leg.page, leg.candidate),
      cookie    = null;

  return httpRequest(server, { method : 'GET', path : entryPath }).then(function(response) {
    entries.push(buildEntry('GET', entryPath, response, rules, leg.entryState));
    cookie = extractSessionCookie(response);

    if (!cookie) {
      throw new Error('capture.js: GET ' + entryPath + ' did not set a session cookie, so the ' +
                      'assignment `next` destination cannot have been persisted.');
    }

    return httpRequest(server, {
      method      : leg.method,
      path        : leg.action,
      payload     : leg.payload,
      contentType : 'application/json',
      headers     : { cookie : cookie }
    });
  }).then(function(response) {
    entries.push(buildEntry(leg.method, leg.action, response, rules, leg.consumeState));
  });
}

/**
 * The assignment `next` supplement, in exactly the recorded order. Every entry here is a case the tree
 * must reproduce byte-for-byte, including the off-origin and scheme-relative destinations, which are
 * echoed straight back rather than filtered. They are recorded in
 * responses.json#assignmentNextContract.confinedOpenRedirect and asserted live by
 * test/lib/api/route-parity.js rather than replayed, because driving them needs a two-hop cookie-bearing
 * flow that this corpus deliberately does not walk. See docs/PRESERVED-QUIRKS.md section 4.4.
 *
 *   [0][1] login  — absolute same-origin destination, persisted then consumed
 *   [2][3] login  — root-relative destination, the shape that already round-tripped
 *   [4]    login  — no destination at all, so the declared success.redirect answers
 *   [5][6] signup — absolute same-origin destination through POST /users
 *   [7]    oauth  — GET /auth/google under the SHIPPED configuration, which answers before it
 *                   reaches `next`; the configured persistence leg needs a runtime configuration
 *                   change and therefore lives in route-parity.js, never in a capture.
 */
function captureAssignmentNext(server, rules) {
  var entries   = [],
      absolute  = assignmentDestination(),
      loginBody = JSON.stringify({ email : THROWAWAY.email, password : THROWAWAY.password });

  function signupBody(candidate) {
    return JSON.stringify({
      formName : ASSIGNMENT.signup.formName,
      fullname : ASSIGNMENT.signup.fullname,
      username : ASSIGNMENT.signup.username,
      email    : ASSIGNMENT.signup.email,
      password : ASSIGNMENT.signup.password,
      next     : candidate
    });
  }

  return createThrowawayUser().then(function() {
    return captureAssignmentLeg(server, rules, entries, {
      page         : '/login',
      candidate    : absolute,
      method       : 'POST',
      action       : '/login',
      payload      : loginBody,
      entryState   : 'assignment-next (login entry, absolute same-origin)',
      consumeState : 'assignment-next (login consumed, absolute same-origin)'
    });
  }).then(function() {
    return captureAssignmentLeg(server, rules, entries, {
      page         : '/login',
      candidate    : ASSIGNMENT.rootRelative,
      method       : 'POST',
      action       : '/login',
      payload      : loginBody,
      entryState   : 'assignment-next (login entry, root-relative)',
      consumeState : 'assignment-next (login consumed, root-relative)'
    });
  }).then(function() {
    // No entry hop and no cookie: nothing was ever persisted, so the declared success.redirect
    // '/home' answers. This is the control that proves the destination and not the flow is what
    // moves the Location.
    return httpRequest(server, {
      method      : 'POST',
      path        : '/login',
      payload     : loginBody,
      contentType : 'application/json'
    }).then(function(response) {
      entries.push(buildEntry('POST', '/login', response, rules,
                              'assignment-next (login consumed, no destination persisted)'));
    });
  }).then(function() {
    return removeAssignmentSignupUser();
  }).then(function() {
    return captureAssignmentLeg(server, rules, entries, {
      page         : '/signup',
      candidate    : absolute,
      method       : 'POST',
      action       : '/users',
      payload      : signupBody(absolute),
      entryState   : 'assignment-next (signup entry, absolute same-origin)',
      consumeState : 'assignment-next (signup consumed, absolute same-origin)'
    });
  }).then(function() {
    return httpRequest(server, {
      method : 'GET',
      path   : assignmentEntryPath('/auth/google', absolute)
    }).then(function(response) {
      entries.push(buildEntry('GET', assignmentEntryPath('/auth/google', absolute), response, rules,
                              'assignment-next (oauth entry, shipped configuration)'));
    });
  }).then(function() {
    return removeAssignmentIdentities().then(function() { return entries; });
  }, function(captureFailure) {
    // FINALLY-EQUIVALENT CLEANUP. This rejection handler used to remove only the
    // signup identity and then rethrow, which meant the rejection skipped the SUCCESS-ONLY
    // `removeThrowawayUser()` that followed further down the chain: a failed assignment capture left the
    // primary throwaway user in the database, so the next run started against a datastore the previous
    // one had polluted. Both removals now run on BOTH terminal paths, in the same order as before.
    //
    // The original capture error is rethrown UNCHANGED, because it is the diagnostic the operator needs
    // and a cleanup failure must never displace it. removeAssignmentIdentities() cannot reject, so there
    // is nothing here that could.
    return removeAssignmentIdentities().then(function() { throw captureFailure; });
  });
}

/**
 * Measures the whole corpus: the 58 parameterless GETs, the 7-entry authenticated supplement, the
 * 8-entry assignment `next` supplement and then — strictly last — the additive resolved reading.
 *
 * THE ORDER IS THE CORRECTNESS ARGUMENT, not a style choice:
 *   1. unauthenticated first hops, with no session in play at all;
 *   2. the authenticated supplement, whose first hops depend on single-read flash state;
 *   3. the assignment supplement, which creates and removes a second identity;
 *   4. resolveUnauthenticated(), cookie-less, after every value above is already recorded. Nothing it
 *      requests can move a recorded reading, because there is no recorded reading left to take.
 * Both throwaway identities are removed in a terminal `finally`, so an exception anywhere above still
 * leaves the disposable database as it was found.
 */
function captureCorpus(server, corpus) {
  var committed = corpus || loadCommittedCorpus(),
      rules     = htmlNormalizationRules(committed),
      startedAt = new Date().toISOString(),
      measured  = {
        capturedAt   : startedAt,
        serverUri    : server.info.uri,
        // The origin this measurement ran under. Recorded because it decides which Locations are
        // absolute and what every rendered page embeds, and because a --write run must publish it as
        // metadata.appUrlOrigin rather than inheriting a stale value from the artifact it replaces.
        appUrlOrigin : liveAppUrlOrigin()
      };

  resetRolesTokenObservations();

  return captureUnauthenticated(server, selectCorpusPaths(server), rules).then(function(entries) {
    measured.unauthenticated = entries;

    return captureAuthenticated(server, rules);
  }).then(function(entries) {
    measured.authenticated = entries;

    return captureAssignmentNext(server, rules);
  }).then(function(entries) {
    measured.assignmentNext = entries;

    // The cache-prefix confinement probes. Placed after the three response sections and before the
    // resolution pass because they need nothing from either: no identity, no cookie and no flash state,
    // so they cannot perturb what the sections above recorded.
    return captureAssetConfinement(server);
  }).then(function(entries) {
    measured.assetConfinement = entries;

    // Step 4. Every primary reading above is already recorded, so this pass is additive in fact.
    return resolveUnauthenticated(server, measured.unauthenticated);
  }).then(function() {
    measured.rolesTokenObservations = ROLES_TOKEN_OBSERVATIONS.slice();
    measured.finishedAt             = new Date().toISOString();

    return measured;
  }).finally(function() {
    return cleanupIdentities();
  });
}

// Asset confinement — the cache-prefix {assetType} probes

/**
 * The cache-prefix route's {assetType} segment IS the Inert confinement root
 * (lib/http/staticRoutes.js), and it arrives percent-DECODED after route matching, so the guard there is
 * what holds the served root inside ./public.
 *
 * These probes verify that confinement in BOTH directions: every traversal shape must answer 404, and the
 * two positive controls must keep answering what a legitimate asset URL has always answered, so a guard
 * that over-rejects fails just as loudly as a missing one. See docs/PRESERVED-QUIRKS.md section 4.1.
 *
 * Only the STATUS is gated, deliberately. Inert stamps `etag` and `last-modified` on a served file from
 * that file's inode, which differ per checkout, so recording a body digest or a header set here would
 * make the artifact non-reproducible on another machine while adding nothing: the security-relevant
 * datum is exactly "does this URL answer 404 or does it serve a file".
 *
 * The prefix is read from config.app.cachePrefix rather than restated, because that value is what
 * lib/util/stringUtils.js#addPrefix stamps into every generated asset URL.
 */
function assetConfinementProbes() {
  // `config` is required HERE rather than at module load, exactly as liveAppUrlOrigin() does: node-config
  // snapshots its layers on first require, and this file must stay inert until configureRuntime() has
  // installed the capture override.
  var prefix = '/' + require('config').app.cachePrefix + '1';

  return [
    { path : prefix + '/js/trinket-config.js', kind : 'legitimate',
      note : 'the positive control: a real file under a configured asset directory' },
    { path : prefix + '/nonexistentdir/x.js', kind : 'legitimate',
      note : 'an asset directory that does not exist answered 404 before the guard and answers 404 ' +
             'after it, so the guard adds no new status here' },
    { path : prefix + '/..%2fconfig/local.yaml', kind : 'traversal',
      note : 'served config/local.yaml with HTTP 200 before the guard - the Yar session-seal password' },
    { path : prefix + '/%2e%2e%2fconfig/local.yaml', kind : 'traversal',
      note : 'the fully percent-encoded form of the same escape; also 200 before the guard' },
    { path : prefix + '/.%2e%2fpackage.json', kind : 'traversal',
      note : 'the mixed literal/encoded form; also 200 before the guard' },
    { path : prefix + '/..%2F..%2F..%2F..%2F..%2F..%2Fetc/passwd', kind : 'traversal',
      note : 'escaped the checkout entirely and served /etc/passwd with HTTP 200 before the guard' },
    { path : prefix + '/..%5cconfig/local.yaml', kind : 'traversal',
      note : 'the backslash form, which answered 404 before the guard as well - pinned so the ' +
             'measurement is complete rather than only the cases that changed' },
    { path : prefix + '/js/../../config/local.yaml', kind : 'tail',
      note : 'the {path*} TAIL rather than the root: Inert already confined this and answered 404 ' +
             'before the guard, which is why the root was the whole of the exposure' }
  ];
}

/**
 * Drives every probe over real HTTP and records `{ path, kind, status }` for each, in declaration order.
 *
 * @param   {Object} server The listening hapi server.
 * @returns {Promise<Array>} One entry per probe.
 */
function captureAssetConfinement(server) {
  var probes  = assetConfinementProbes(),
      entries = [];

  function step(index) {
    if (index >= probes.length) {
      return Promise.resolve(entries);
    }

    return httpRequest(server, { method : 'GET', path : probes[index].path }).then(function(response) {
      entries.push({
        path   : probes[index].path,
        kind   : probes[index].kind,
        status : response.status
      });

      return step(index + 1);
    });
  }

  return step(0);
}

/** The probe statuses keyed by path, which is the shape the artifact publishes and replay compares. */
function assetConfinementStatusMap(entries) {
  var map = {};

  (entries || []).forEach(function(entry) {
    map[entry.path] = entry.status;
  });

  return map;
}

/**
 * Gate entries for the confinement contract: the whole status map, plus the two directional invariants
 * stated independently of it so a wholesale artifact edit cannot satisfy them by agreeing with itself.
 *
 * @param   {Object} committedCorpus The committed responses artifact.
 * @param   {Object} measured        The measurement, carrying `assetConfinement`.
 * @returns {Array}  Gate entries.
 */
function assetConfinementGates(committedCorpus, measured) {
  var contract = committedCorpus.assetConfinementContract,
      entries  = measured.assetConfinement || [];

  if (!contract) {
    return [unevaluatedGate('assetConfinement contract',
                            'responses.json carries no assetConfinementContract block')];
  }

  function statusesOfKind(kind) {
    return entries.filter(function(entry) {
      return entry.kind === kind;
    }).map(function(entry) {
      return entry.status;
    }).filter(function(status, index, all) {
      return all.indexOf(status) === index;
    }).sort();
  }

  return [
    gate('assetConfinement statuses', contract.statuses, assetConfinementStatusMap(entries)),
    gate('assetConfinement probeCount', contract.probes.length, entries.length),
    // The two directional invariants. Every traversal shape must be refused, and the legitimate asset
    // must still be served - an over-eager guard is a parity failure too.
    gate('assetConfinement every traversal refused', [contract.refusedStatus], statusesOfKind('traversal')),
    gate('assetConfinement legitimate asset still served', contract.legitimateStatus,
         (assetConfinementStatusMap(entries)[contract.servedProbe] || null))
  ];
}

// Route table — the other artifact this harness owns (test/baseline/route-table.json)

/**
 * route-table.json#metadata.regenerationOwner names THIS FILE, and its metadata.captureNotes bind it:
 * "Any later run of capture.js must reproduce gates.measuredSha256 and
 * gates.registrationOrderFingerprint." The recipe below is therefore not a local convenience, it is the
 * artifact's own canonicalization block reproduced field for field:
 *
 *   rowFormat        "METHOD | path | authDescriptor | preCount", one ASCII space around every pipe
 *   methodCase       uppercase — hapi lowercases route.method
 *   authDescriptor   the literal string "false" when route.settings.auth === false, otherwise
 *                    'mode=<mode> strategies=["s1",...]' with the names double-quoted and joined by a
 *                    bare comma
 *   preCount         Array.isArray(route.settings.pre) ? route.settings.pre.length : 0
 *   sort             default Array.prototype.sort() — UTF-16 code units, NOT locale-aware
 *   join             "\n", with NO trailing newline
 *
 * It is implemented here rather than imported from test/baseline/replay.js deliberately. This file is
 * the artifact's declared regeneration owner and has to be able to produce it standalone, and a second
 * implementation cannot drift silently: every run of either tool asserts its own canonicalization
 * against the same committed digests, so a divergence fails the tool that diverged.
 */
function md5(text) {
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

/**
 * The server's default auth strategy, which app.js:L279 sets with
 * server.auth.default({ strategy : 'session', mode : 'try' }) and hapi normalizes to
 * { mode : 'try', strategies : ['session'] }. Read from the live server rather than assumed, because it
 * is what every one of the 126 rows that declare no auth of their own inherits.
 */
function liveServerAuthDefault(server) {
  var settings = (server.auth && server.auth.settings && server.auth.settings.default) || {};

  return {
    mode       : settings.mode,
    strategies : settings.strategies ? settings.strategies.slice() : undefined
  };
}

/**
 * The EFFECTIVE auth of one row, resolved exactly as @hapi/hapi lib/auth.js lookup(route) resolves it:
 * `false` stays false — hapi's _setupRoute carries the comment "Preserve the difference between
 * undefined and false" — and anything else is (route.settings.auth || server.auth.settings.default).
 * The declared string form `auth : 'session'` has already been rewritten by hapi into
 * { strategies : ['session'], mode : 'required' } by the time it reaches server.table(); the
 * `auth.strategy` branch is kept because a hand-built route object can still carry the singular key.
 */
function effectiveRouteAuth(auth, serverDefault) {
  if (auth === false) {
    return false;
  }

  var mode       = (auth && auth.mode) || serverDefault.mode,
      strategies = (auth && auth.strategies) ||
                   (auth && auth.strategy ? [auth.strategy] : serverDefault.strategies);

  return { mode : mode, strategies : strategies ? strategies.slice() : strategies };
}

/** The auth half of one canonical row: 'false', or 'mode=<mode> strategies=["s1",...]'. */
function authDescriptor(auth, serverDefault) {
  var effective = effectiveRouteAuth(auth, serverDefault);

  if (effective === false) {
    return 'false';
  }

  return 'mode=' + effective.mode + ' strategies=' + JSON.stringify(effective.strategies);
}

/** One canonical row: "METHOD | path | authDescriptor | preCount". */
function canonicalRow(method, routePath, auth, preCount, serverDefault) {
  return [
    String(method).toUpperCase(),
    routePath,
    authDescriptor(auth, serverDefault),
    String(preCount)
  ].join(' | ');
}

/**
 * Canonicalizes the live route table. Everything returned is derived from server.table() and
 * server.auth.settings.default and from nothing else — no committed value is consulted, so the
 * measurement cannot be contaminated by the artifact it is about to be compared against.
 */
function canonicalizeLiveTable(server) {
  var serverDefault = liveServerAuthDefault(server),
      byKey         = {},
      canonical     = [],
      tally         = { undefined : 0, object : 0, 'false' : 0 },
      gates         = {
        rowCount            : 0,
        methods             : {},
        apiPaths            : 0,
        withPreHandlers     : 0,
        authRequiredSession : 0,
        authFalse           : 0,
        authTryInherited    : 0
      };

  server.table().forEach(function(row) {
    var method   = String(row.method).toUpperCase(),
        auth     = row.settings.auth,
        preCount = Array.isArray(row.settings.pre) ? row.settings.pre.length : 0,
        text     = canonicalRow(method, row.path, auth, preCount, serverDefault);

    byKey[method + ' ' + row.path] = {
      method    : method,
      path      : row.path,
      auth      : effectiveRouteAuth(auth, serverDefault),
      preCount  : preCount,
      canonical : text
    };
    canonical.push(text);

    if (auth === false)          { tally['false'] += 1; gates.authFalse += 1; }
    else if (auth === undefined) { tally.undefined += 1; }
    else                         { tally.object += 1; }

    if (auth && auth.mode === 'required' &&
        JSON.stringify(auth.strategies || []) === JSON.stringify(['session'])) {
      gates.authRequiredSession += 1;
    }

    if (auth === undefined && serverDefault.mode === 'try') {
      gates.authTryInherited += 1;
    }

    if (row.path.indexOf('/api/') === 0) {
      gates.apiPaths += 1;
    }

    if (preCount > 0) {
      gates.withPreHandlers += 1;
    }

    gates.methods[method] = (gates.methods[method] || 0) + 1;
    gates.rowCount += 1;
  });

  return {
    byKey                : byKey,
    canonical            : canonical,
    rawSettingsAuthTally : tally,
    serverAuthDefault    : serverDefault,
    gates                : gates
  };
}

/**
 * The rows in REGISTRATION order, which is what the artifact persists and what
 * gates.registrationOrderFingerprint hashes. server.table() returns ROUTER order (route-table.json#ADJ-5),
 * so the order is taken from config.routes — the array app.js hands to server.route() — and each
 * declaration is mapped onto the live canonical row for its (METHOD, path) key. A declaration with no
 * live row is reported through `missing` instead of being skipped quietly: it would mean the router and
 * the declaration list disagree, which is exactly the kind of drift this artifact exists to catch.
 */
function registrationOrderRows(live) {
  var rows    = [],
      missing = [];

  require('config').routes.forEach(function(route) {
    [].concat(route.method).forEach(function(method) {
      var key = String(method).toUpperCase() + ' ' + route.path,
          row = live.byKey[key];

      if (!row) {
        missing.push(key);

        return;
      }

      rows.push({
        index     : rows.length,
        method    : row.method,
        path      : row.path,
        auth      : row.auth,
        preCount  : row.preCount,
        canonical : row.canonical
      });
    });
  });

  return { rows : rows, missing : missing };
}

/**
 * The four digests the artifact publishes. The sorted set is hashed twice — sha256 and md5 — and the
 * registration-order list once; `measuredSha256First32` is the 32-character head, recorded because the
 * Technical Specification's own published value is 32 hex characters and the artifact keeps the two
 * comparable side by side (route-table.json#gates.documentedDigestNote).
 */
function routeTableDigests(canonical, registrationOrderCanonicalRows) {
  var sortedText  = canonical.slice().sort().join('\n'),
      orderedText = registrationOrderCanonicalRows.map(function(row) { return row.canonical; }).join('\n'),
      sorted      = sha256(sortedText);

  return {
    measuredSha256               : sorted,
    measuredSha256First32        : sorted.slice(0, 32),
    measuredMd5                  : md5(sortedText),
    registrationOrderFingerprint : sha256(orderedText)
  };
}

/**
 * The registration order as canonical strings, plus any declaration that resolved to no live row.
 *
 * Thin by design: registrationOrderRows() does the work, and this shape is what both the anchor gate's
 * registrationOrderContract clause and replay.js's fingerprint comparison consume.
 *
 * @param   {Object} live A canonicalizeLiveTable() result (needs `byKey`).
 * @returns {Object} `{ canonical : String[], missing : String[] }`.
 */
function registrationOrderCanonical(live) {
  var order = registrationOrderRows(live);

  return {
    canonical : order.rows.map(function(row) { return row.canonical; }),
    missing   : order.missing
  };
}

/**
 * Evaluate the documented route-table anchor as a MANDATORY pass/fail gate, computed from the LIVE
 * server on every run rather than read out of a stored flag.
 *
 * THIS IS THE SINGLE IMPLEMENTATION. It lives in the harness that owns route-table.json, which is what
 * lets that artifact name one honest evaluator and what lets mergeMeasuredRouteTable() REGENERATE
 * gates.documentedAnchorGateSatisfied instead of carrying a hand-authored boolean.
 * test/baseline/replay.js re-exports this function; test/lib/api/route-parity.js recomputes the same
 * eleven clauses from its own in-file literals, sharing no code and loading no artifact, so a defect here
 * cannot make that suite pass.
 *
 * ELEVEN clauses, all of them the Specification's own published values for this table, plus the table
 * itself: the frozen digest literal is still stored verbatim; the row count; the method distribution;
 * the /api/ path count; the pre-handler count; the three auth buckets; the 233 canonical rows the digest
 * stands for, compared as a sorted multiset against the recorded set; the registration-order contract,
 * whose fingerprint is re-derived from config.routes; and a sha256 RECOMPUTED from the live table under
 * the artifact's published serialization. Any drift in any of them lands in `failures` and makes
 * `satisfied` false, so a regression FAILS this gate instead of being recorded as expected.
 *
 * Why there are two digest clauses, and what each one is worth. Clause 1 compares two literals — this
 * file's DOCUMENTED_DIGEST against the artifact's stored copy — which detects an edit to the stored
 * anchor but computes nothing. Clause 11 is the one that computes: it applies the artifact's published
 * canonicalization to the LIVE route table and requires the result to equal gates.measuredSha256. Both
 * are needed, because a gate that only compares literals can report `satisfied` on a run where no digest
 * was derived from the running server at all.
 *
 * What neither clause does is recompute the Specification's own 32-character literal, and that is a
 * limit of the published value rather than a gap in this gate: it is 32 hexadecimal characters labelled
 * sha256 where a SHA-256 is 64, and no serialization is published for it — no field set, no separator,
 * no sort collation, no trailing-newline convention — so no verifier can derive the string from any
 * input; route-table.json#adjudications ADJ-4 records the exhaustive search. Reverse-engineering a
 * serialization to force a string match is forbidden by ADJ-4 and would prove nothing about the table.
 * What the literal names is a specific 233-row table; that table is pinned here exactly, clause by
 * clause, and the digest that CAN be recomputed over it is.
 *
 * @param   {Object} live           A canonicalizeLiveTable() result, or a captureRouteTable() result —
 *                                 both carry `gates`, `canonical` and `byKey`.
 * @param   {Object} committedTable The committed route-table.json artifact.
 * @returns {Object} `{ documentedDigest, clauses, failures, satisfied }`.
 */
function documentedAnchorGate(live, committedTable) {
  var gates    = committedTable.gates,
      order    = registrationOrderCanonical(live),
      clauses  = [],
      failures = [];

  function clause(name, documented, measured) {
    var satisfied = stableStringify(documented) === stableStringify(measured);

    clauses.push({ name : name, documented : documented, measured : measured, satisfied : satisfied });

    if (!satisfied) {
      failures.push(name);
    }
  }

  clause('documentedDigestRetainedVerbatim', DOCUMENTED_DIGEST, gates.documentedDigest);
  clause('rowCount', gates.rowCount, live.gates.rowCount);
  clause('methods', gates.methods, live.gates.methods);
  clause('apiPaths', gates.apiPaths, live.gates.apiPaths);
  clause('withPreHandlers', gates.withPreHandlers, live.gates.withPreHandlers);
  clause('authRequiredSession', gates.authRequiredSession, live.gates.authRequiredSession);
  clause('authFalse', gates.authFalse, live.gates.authFalse);
  clause('authTryInherited', gates.authTryInherited, live.gates.authTryInherited);
  clause('canonicalRowsTheDigestStandsFor',
         committedTable.rows.map(function(row) { return row.canonical; }).slice().sort(),
         live.canonical.slice().sort());
  clause('registrationOrderContract',
         { unresolvedDeclarations : [], fingerprint : gates.registrationOrderFingerprint },
         { unresolvedDeclarations : order.missing, fingerprint : sha256(order.canonical.join('\n')) });
  // CLAUSE 11 — A DIGEST THIS GATE ACTUALLY RECOMPUTES.
  //
  // Clause 1 compares DOCUMENTED_DIGEST to gates.documentedDigest: a literal in this file against a
  // literal in the artifact. That catches an edit to the stored anchor but computes nothing, so on its
  // own it would let `satisfied` be true on a run where no digest was derived from the running server.
  //
  // This clause applies the artifact's PUBLISHED serialization to the LIVE table and requires the result
  // to equal the stored digest. The recipe is not invented here: route-table.json's `canonicalization`
  // block publishes rowFormat, the sort ("Array.prototype.sort() default, UTF-16 code-unit ascending"),
  // the join ("\n") and no trailing newline, plus a `reproduce` one-liner, and
  // `sha256(live.canonical.slice().sort().join('\n'))` is exactly that recipe. Both digest widths are
  // asserted together so a truncation cannot pass the long form.
  //
  // What this clause deliberately does NOT do is recompute the 32-character documented literal. That
  // value is 32 characters where a SHA-256 is 64 and no serialization is published for it, so no input
  // exists to derive it from; route-table.json#adjudications ADJ-4 records the exhaustive search.
  // Reverse-engineering one to force a string match is forbidden by ADJ-4 and would prove nothing. The
  // recomputable digest is the recorded one, and it is recomputed INSIDE the gate rather than beside it.
  clause('measuredSha256RecomputedFromLiveTable',
         { measuredSha256 : gates.measuredSha256, measuredSha256First32 : gates.measuredSha256First32 },
         { measuredSha256        : sha256(live.canonical.slice().sort().join('\n')),
           measuredSha256First32 : sha256(live.canonical.slice().sort().join('\n')).slice(0, 32) });

  return {
    documentedDigest : DOCUMENTED_DIGEST,
    clauses          : clauses,
    failures         : failures,
    satisfied        : failures.length === 0
  };
}

/**
 * Whether every COUNTABLE documented anchor was reproduced — that is, every clause of the anchor gate
 * except `documentedDigestRetainedVerbatim`, which is a statement about the artifact's storage rather
 * than about the table.
 *
 * This is what route-table.json#gates.documentedAnchorsExceptDigestAllReproduced asserts, and it is
 * computed here so that mergeMeasuredRouteTable() can regenerate the flag instead of copying a stored
 * boolean forward over a measurement that no longer justifies it.
 *
 * @param   {Object} verdict A documentedAnchorGate() result.
 * @returns {Boolean} true when every clause other than the retention clause is satisfied.
 */
function countableAnchorsReproduced(verdict) {
  return verdict.clauses.every(function(clause) {
    return clause.name === 'documentedDigestRetainedVerbatim' || clause.satisfied;
  });
}

/**
 * Measures the whole route table. Synchronous by nature — the table is already in memory once the
 * server has started, and no HTTP is involved — so this runs before the corpus walk and its result is
 * available even under --routes-only.
 *
 * `byKey` and `canonical` are carried through so the anchor gate can be evaluated from this result
 * directly, which is what makes routeTableGates() able to gate all eleven clauses. Neither field is ever
 * written to the artifact: mergeMeasuredRouteTable() copies only the keys it names.
 */
function captureRouteTable(server) {
  var startedAt = new Date().toISOString(),
      live      = canonicalizeLiveTable(server),
      order     = registrationOrderRows(live);

  return {
    capturedAt           : startedAt,
    finishedAt           : new Date().toISOString(),
    serverUri            : server.info.uri,
    serverAuthDefault    : live.serverAuthDefault,
    rawSettingsAuthTally : live.rawSettingsAuthTally,
    gates                : live.gates,
    digests              : routeTableDigests(live.canonical, order.rows),
    rows                 : order.rows,
    routerOrderCanonical : live.canonical,
    canonical            : live.canonical,
    byKey                : live.byKey,
    missingDeclarations  : order.missing
  };
}

/** One difference in the shape compareSection() produces, so both halves report identically. */
function pushDifference(differences, section, subject, expected, actual) {
  if (stableStringify(expected) === stableStringify(actual)) {
    return differences;
  }

  differences.push({
    section  : section,
    entry    : subject,
    field    : subject,
    expected : stableStringify(expected),
    actual   : stableStringify(actual)
  });

  return differences;
}

/**
 * Compares the measured route table against the committed one: the sorted canonical set, every row in
 * registration order, the four digests, the seven countable gates, the raw auth tally and the server
 * default. gates.documentedDigest is deliberately NOT compared — the artifact records it as
 * unreproducible in gates.documentedDigestReproduced ("none") and gates.documentedDigestGateSatisfied,
 * and manufacturing a match for it would be evidence-tampering.
 */
function compareRouteTable(committedTable, measured) {
  var differences = [],
      committedRows = committedTable.rows || [],
      length        = Math.max(committedRows.length, measured.rows.length),
      empirical     = (committedTable.canonicalization &&
                       committedTable.canonicalization.empiricalAuthShape) || {};

  pushDifference(differences, 'route-table', 'rows (sorted canonical set)',
                 committedRows.map(function(row) { return row.canonical; }).sort(),
                 measured.routerOrderCanonical.slice().sort());
  pushDifference(differences, 'route-table', 'registration order: unresolved declarations',
                 [], measured.missingDeclarations);

  for (var index = 0; index < length; index++) {
    var committedRow = committedRows[index],
        measuredRow  = measured.rows[index];

    pushDifference(differences, 'route-table', 'rows[' + index + ']',
                   committedRow || '<absent from the committed table>',
                   measuredRow || '<not measured>');
  }

  ['measuredSha256', 'measuredSha256First32', 'measuredMd5', 'registrationOrderFingerprint']
    .forEach(function(digest) {
      pushDifference(differences, 'route-table', 'gates.' + digest,
                     committedTable.gates[digest], measured.digests[digest]);
    });

  ['rowCount', 'methods', 'apiPaths', 'withPreHandlers', 'authRequiredSession', 'authFalse',
   'authTryInherited'].forEach(function(name) {
    pushDifference(differences, 'route-table', 'gates.' + name,
                   committedTable.gates[name], measured.gates[name]);
  });

  pushDifference(differences, 'route-table',
                 'canonicalization.empiricalAuthShape.rawSettingsAuthTally',
                 empirical.rawSettingsAuthTally, measured.rawSettingsAuthTally);
  pushDifference(differences, 'route-table',
                 'canonicalization.empiricalAuthShape.serverAuthSettingsDefault',
                 empirical.serverAuthSettingsDefault, measured.serverAuthDefault);

  return differences;
}

/**
 * Merges a measurement into the committed route table for --write, preserving every hand-authored
 * field — purpose, derivation, adjudications, the provenance prose and the documented-digest block —
 * and replacing only what is a pure function of the measurement. The keys left alone are returned so
 * main() can name them rather than leaving a reader to assume the whole gate block was re-derived.
 */
function mergeMeasuredRouteTable(committedTable, measured) {
  var merged        = JSON.parse(JSON.stringify(committedTable)),
      recomputed    = ['rowCount', 'methods', 'apiPaths', 'withPreHandlers', 'authRequiredSession',
                       'authFalse', 'authTryInherited', 'measuredSha256', 'measuredSha256First32',
                       'measuredMd5', 'registrationOrderFingerprint', 'documentedAnchorGateSatisfied',
                       'documentedAnchorsExceptDigestAllReproduced'],
      notRecomputed = [];

  merged.metadata.capturedAt = measured.capturedAt;
  merged.metadata.finishedAt = measured.finishedAt;
  merged.metadata.serverUri  = measured.serverUri;
  merged.metadata.measuredServerAuthDefault = measured.serverAuthDefault;

  if (merged.canonicalization && merged.canonicalization.empiricalAuthShape) {
    merged.canonicalization.empiricalAuthShape.rawSettingsAuthTally = measured.rawSettingsAuthTally;
    merged.canonicalization.empiricalAuthShape.serverAuthSettingsDefault = measured.serverAuthDefault;
  }

  ['rowCount', 'methods', 'apiPaths', 'withPreHandlers', 'authRequiredSession', 'authFalse',
   'authTryInherited'].forEach(function(name) {
    merged.gates[name] = measured.gates[name];
  });

  ['measuredSha256', 'measuredSha256First32', 'measuredMd5', 'registrationOrderFingerprint']
    .forEach(function(digest) {
      merged.gates[digest] = measured.digests[digest];
    });

  merged.rows = measured.rows;

  // Both verdicts are REGENERATED from this run's own evaluation of the anchor rather than carried
  // across as hand-authored booleans. `merged` already holds the recomputed rows, gates and
  // digests, so the clause set is evaluated against the merged artifact — which is the artifact that is
  // about to be written — and a write whose table no longer satisfies the anchor therefore stores `false`
  // and fails routeTableGates() rather than shipping a stale `true`.
  var mergedVerdict = documentedAnchorGate(measured, merged);

  merged.gates.documentedAnchorGateSatisfied = mergedVerdict.satisfied;
  merged.gates.documentedAnchorsExceptDigestAllReproduced = countableAnchorsReproduced(mergedVerdict);

  Object.keys(merged.gates).forEach(function(key) {
    if (recomputed.indexOf(key) === -1) {
      notRecomputed.push(key);
    }
  });

  return { artifact : merged, notRecomputed : notRecomputed };
}

/**
 * The four section sizes a run reproduced, as a computed value rather than as prose.
 *
 * A hand-authored provenance sentence naming those sizes inline cannot be recomputed, so it can drift
 * from the arrays, the gates and the metadata beside it without anything noticing. The numbers therefore
 * live in this block, which the generator writes on every capture and which the gates below compare
 * against the live values; the provenance sentence points here instead of restating them.
 *
 * @param   {Object} routeTable A captureRouteTable() result.
 * @param   {Object} [measured] A captureCorpus() result; absent under --routes-only.
 * @returns {Object} `{ routeRows, unauthenticated, authenticated, assignmentNext }`.
 */
function reproducedCounts(routeTable, measured) {
  return {
    routeRows       : routeTable.gates.rowCount,
    unauthenticated : ((measured && measured.unauthenticated) || []).length,
    authenticated   : ((measured && measured.authenticated) || []).length,
    assignmentNext  : ((measured && measured.assignmentNext) || []).length
  };
}

/**
 * Writes reproducedCounts() into an artifact's shared provenance block. Both artifacts carry the same
 * block, and both are written by the same run, so both receive the same measured counts.
 *
 * @param   {Object} artifact The merged artifact about to be written.
 * @param   {Object} counts   A reproducedCounts() result.
 * @returns {Boolean} true when the block existed and was updated.
 */
function recordReproducedCounts(artifact, counts) {
  var block = artifact.metadata && artifact.metadata.toolchainReverification;

  if (!block) {
    return false;
  }

  block.reproducedCounts = counts;

  return true;
}

// There is deliberately no single-artifact writer here. The route table is the parity DENOMINATOR and the
// corpus is the parity EVIDENCE, and a generation of one without the other is not a baseline — so the
// only way to write either is writeArtifactPair(), below, which writes both or neither.

// Comparison — shared with test/baseline/replay.js

function stableStringify(value) {
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }

  if (isPlainObject(value)) {
    return '{' + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ':' + stableStringify(value[key]);
    }).join(',') + '}';
  }

  return JSON.stringify(value === undefined ? null : value);
}

function describeEntry(entry, index) {
  return '[' + index + '] ' + entry.method + ' ' + entry.path +
         (entry.state ? ' {' + entry.state + '}' : '');
}

/**
 * Field-by-field comparison of one measured corpus section against the committed one. Prose fields
 * (`notes`) are never compared; every measured field listed in COMPARED_FIELDS is compared literally
 * under the normalization already applied by buildEntry(). A missing or extra entry is itself a
 * difference — the corpus is a closed set.
 */
// Location origin — deployment configuration, not behavior

/**
 * Ten of the sixteen recorded redirects carry an ABSOLUTE Location, and the origin in it comes from
 * `config.app.url` by way of lib/http/redirect.js. The shipped configuration disagrees with itself about
 * that origin on purpose: `config/default.yaml` declares `https` + `trinket.dev` with no port, while
 * `config/local.example.yaml` — the file `docs/setup.md` tells a developer to copy to
 * `config/local.yaml` — declares `http` + `localhost` + 3000, and node-config loads `local.yaml` last.
 * The corpus was captured under the default origin, recorded in `metadata.appUrlOrigin`.
 *
 * THE ORIGIN IS A PRECONDITION, NOT SOMETHING TO NORMALIZE. Injecting the recorded origin into a verify
 * run, or rewriting an observed Location onto it before comparing, would let a build that emits the WRONG
 * configured origin — a broken absolutizer, a config key read from the wrong place — replay clean. The
 * literal Location is what the redirect-parity evidence rests on, so this module compares Locations
 * literally and reports a configuration mismatch as UNABLE TO RUN, with the remedy, instead of papering
 * over it. The absolute-versus-relative split stays pinned by `gates.absoluteRedirectCount` and
 * `gates.relativeRedirectCount`.
 */
function appUrlOrigin(url) {
  if (!url) {
    return null;
  }

  var protocol = url.protocol ? String(url.protocol).replace(/:$/, '') : null,
      hostname = url.hostname ? String(url.hostname) : null,
      port     = (url.port === 0 || url.port) ? String(url.port) : '';

  if (!protocol || !hostname) {
    return null;
  }

  return protocol + '://' + hostname + (port ? ':' + port : '');
}

/** The origin the running process would emit, derived from the effective configuration. */
function liveAppUrlOrigin() {
  return appUrlOrigin(require('config').app.url);
}

/**
 * Exact origin equality through the non-throwing static URL.parse — never a string comparison of two
 * spellings and never a prefix test. Either side being
 * unparseable is `false`, which fails the precondition rather than passing it by accident.
 */
function sameOrigin(left, right) {
  var a = left ? URL.parse(left) : null,
      b = right ? URL.parse(right) : null;

  return !!(a && b && a.origin === b.origin);
}

/**
 * The app.url precondition. A corpus entry's absolute Location and every rendered body embed the
 * configured origin, so a run under a different origin is measuring a different deployment
 * configuration, and its differences would describe the checkout rather than the code. That is a reason
 * to STOP with a remedy, not a reason to rewrite the measurement.
 *
 * @param   {Object} committedCorpus The committed responses.json.
 * @returns {Object} { satisfied, live, recorded, remedy } — `remedy` is null when satisfied.
 */
function originPrecondition(committedCorpus) {
  var recorded = (committedCorpus && committedCorpus.metadata && committedCorpus.metadata.appUrlOrigin) ||
                 null,
      live     = liveAppUrlOrigin();

  if (!recorded) {
    return {
      satisfied : false,
      live      : live,
      recorded  : recorded,
      remedy    : 'the committed corpus records no metadata.appUrlOrigin, so the origin it was captured ' +
                  'under cannot be reproduced. Regenerate the artifact from the base commit.'
    };
  }

  if (sameOrigin(live, recorded)) {
    return { satisfied : true, live : live, recorded : recorded, remedy : null };
  }

  return {
    satisfied : false,
    live      : live,
    recorded  : recorded,
    remedy    : 'this process is configured for app.url origin ' + String(live) + ' but the corpus was ' +
                'captured under ' + recorded + ', and every absolute Location and rendered body moves ' +
                'with it. Remove the app.url block from config/local.yaml, or export a matching ' +
                'NODE_CONFIG, e.g. NODE_CONFIG=\'{"app":{"url":{"protocol":"https","hostname":' +
                '"trinket.dev","port":null}}}\'. The harness will not inject it for you: an injected ' +
                'origin would let a build that emits the wrong one replay clean.'
  };
}

function compareSection(section, committedEntries, measuredEntries) {
  var differences = [],
      length      = Math.max(committedEntries.length, measuredEntries.length);

  for (var index = 0; index < length; index++) {
    var committed = committedEntries[index],
        measured  = measuredEntries[index];

    if (!committed) {
      differences.push({
        section : section,
        entry   : describeEntry(measured, index),
        field   : '<entry>',
        expected: '<absent from the committed corpus>',
        actual  : 'present'
      });
      continue;
    }

    if (!measured) {
      differences.push({
        section : section,
        entry   : describeEntry(committed, index),
        field   : '<entry>',
        expected: 'present',
        actual  : '<not captured>'
      });
      continue;
    }

    ['method', 'path'].concat(committed.state ? ['state'] : []).forEach(function(field) {
      if (committed[field] !== measured[field]) {
        differences.push({
          section : section,
          entry   : describeEntry(committed, index),
          field   : field,
          expected: committed[field],
          actual  : measured[field]
        });
      }
    });

    COMPARED_FIELDS.forEach(function(field) {
      var expected = stableStringify(committed[field]),
          actual   = stableStringify(measured[field]);

      if (expected !== actual) {
        differences.push({
          section : section,
          entry   : describeEntry(committed, index),
          field   : field,
          expected: expected,
          actual  : actual
        });
      }
    });
  }

  return differences;
}

/**
 * Every section, compared literally. There is no origin rebasing: originPrecondition() has already
 * established that the process is configured for the origin the corpus was captured under, so an origin
 * that appears in a measured Location, in a measured header or percent-encoded inside a measured request
 * path is compared byte for byte like everything else.
 */
function compareCorpus(committed, measured) {
  return compareSection('unauthenticated', committed.unauthenticated, measured.unauthenticated)
    .concat(compareSection('authenticated', committed.authenticated, measured.authenticated))
    // The assignment supplement is compared exactly as hard as the other two sections. An older
    // artifact that predates the section has no entries to compare, and `|| []` keeps it replayable
    // rather than reporting eight phantom differences.
    .concat(compareSection('assignmentNext', committed.assignmentNext || [],
                           measured.assignmentNext || []));
}

/** The FIRST-HOP status distribution of the 58 unauthenticated entries, keyed by status code. */
function statusDistribution(entries) {
  var distribution = {};

  entries.forEach(function(entry) {
    var key = String(entry.status);

    distribution[key] = (distribution[key] || 0) + 1;
  });

  return distribution;
}

/** The RESOLVED status distribution — the terminal status of each entry's Location chain. */
function resolvedStatusDistribution(entries) {
  var distribution = {};

  entries.forEach(function(entry) {
    var key = String(entry.resolved ? entry.resolved.status : entry.status);

    distribution[key] = (distribution[key] || 0) + 1;
  });

  return distribution;
}

/** How many hops each entry needed, keyed by hop count. */
function hopCountHistogram(entries) {
  var histogram = {};

  entries.forEach(function(entry) {
    var key = String(entry.resolved ? entry.resolved.hops : 0);

    histogram[key] = (histogram[key] || 0) + 1;
  });

  return histogram;
}

/** The paths whose FIRST hop is a redirect, in corpus order. */
function redirectingEntryPaths(entries) {
  return entries.filter(function(entry) {
    return isRedirectStatus(entry.status);
  }).map(function(entry) {
    return entry.path;
  });
}

/** The resolved status distribution of the redirecting subset only. */
function redirectResolutionDistribution(entries) {
  return resolvedStatusDistribution(entries.filter(function(entry) {
    return isRedirectStatus(entry.status);
  }));
}

/** `POST /login (valid credentials)` etc. — the label the authenticated gate maps are keyed by. */
function authenticatedEntryLabel(entry) {
  var state = String(entry.state || ''),
      short = state.indexOf('login-flow ') === 0 ? state.slice('login-flow '.length) : '(' + state + ')';

  return entry.method + ' ' + entry.path + ' ' + short;
}

/**
 * label -> first-hop status map for the authenticated supplement. There is only ONE reading of this
 * section by design: resolving it would need the session cookie, and a cookie-bearing hop consumes the
 * flash state the recorded bodies depend on (constraint 4). The flagship quirk is unaffected either
 * way — GET /login and GET /signup authenticated are terminal 500s with no Location to follow.
 */
function authenticatedStatusMap(entries) {
  var map = {};

  entries.forEach(function(entry) {
    map[authenticatedEntryLabel(entry)] = entry.status;
  });

  return map;
}

/** `<state> -> <status>` for the assignment supplement; `state` is what distinguishes its two hops. */
function assignmentNextStatusMap(entries) {
  var map = {};

  (entries || []).forEach(function(entry) {
    map[entry.method + ' ' + entry.path.split('?')[0] + ' ' + String(entry.state || '')] = entry.status;
  });

  return map;
}

/**
 * `<state> -> <Location>` for the assignment supplement. The two consuming hops carry the destination
 * itself, so a build that discarded it would answer the declared success.redirect here instead and fail
 * this gate.
 */
function assignmentNextLocationMap(entries) {
  var map = {};

  (entries || []).forEach(function(entry) {
    map[String(entry.state || '')] = entry.location;
  });

  return map;
}


// Build artifacts — the two CSS files the corpus pins in responses.json#buildArtifacts

var BUILD_ARTIFACT_FILES = ['public/css/base.css', 'public/css/embed.css'];

function repositoryRoot() {
  return path.join(__dirname, '..', '..');
}

/** Every *.map file under a directory, recursively. Returns [] when the directory does not exist. */
function mapFilesUnder(directory) {
  var found = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  fs.readdirSync(directory, { withFileTypes : true }).forEach(function(entry) {
    var full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      found = found.concat(mapFilesUnder(full));
    }
    else if (/\.map$/.test(entry.name)) {
      found.push(full);
    }
  });

  return found;
}

/**
 * Measures the two build artifacts and the source-map count. Absence is neither a pass nor a parity
 * failure: `npm run build` fails on a clean checkout until public/components is hydrated from the
 * public-components.tgz asset of release v1.1.0, which responses.json#buildArtifacts.precondition
 * records, so a missing file means the checkout was never built rather than that the bytes changed.
 *
 * It is, however, MISSING REQUIRED EVIDENCE. buildArtifactGates() reports it UNEVALUATED and a full run
 * turns any UNEVALUATED gate into exit 2: the build artifacts are one of
 * the two halves of the parity claim, and a run that never looked at them has not verified parity, so it
 * must not exit 0. Hydrate and build, or say explicitly that the run is narrowed.
 */
function measureBuildArtifacts() {
  var root      = repositoryRoot(),
      cssRoot   = path.join(root, 'public', 'css'),
      measured  = { files : {}, missing : [], cssMapFilesEmitted : null, cssMapFiles : null };

  BUILD_ARTIFACT_FILES.forEach(function(relative) {
    var full = path.join(root, relative);

    if (!fs.existsSync(full)) {
      measured.missing.push(relative);

      return;
    }

    var contents = fs.readFileSync(full);

    measured.files[relative] = {
      bytes  : contents.length,
      sha256 : crypto.createHash('sha256').update(contents).digest('hex')
    };
  });

  if (fs.existsSync(cssRoot)) {
    var maps = mapFilesUnder(cssRoot);

    measured.cssMapFiles        = maps.map(function(full) { return path.relative(root, full); }).sort();
    measured.cssMapFilesEmitted = maps.length;
  }

  return measured;
}

// Gates — the artifacts' own published values, recomputed from the measurement

/**
 * A gate is a named triple of an expectation the artifact publishes, the value recomputed from this
 * run, and a verdict. Four verdicts exist, and the difference between the last two is the whole point:
 *
 *   PASS           the recomputed value equals the published expectation.
 *   FAIL           it does not. Exit 1: a difference to report.
 *   UNEVALUATED    this run could not measure the input at all — an unbuilt stylesheet, a corpus half
 *                  skipped by --routes-only. It is NEVER a pass, and in a full run it is exit 2
 *                  (unable to run), because "the gate held" and "the gate was never checked" are
 *                  different claims and a run that conflates them can report success having verified
 *                  nothing. It is tolerated only in an explicitly narrowed mode.
 *   UNREPRODUCIBLE the published expectation cannot be recomputed by ANY verifier, permanently, and the
 *                  artifact itself says so. Exactly one gate is in this class — the Technical
 *                  Specification's 32-character route-table digest, which is labelled sha256 where a
 *                  SHA-256 is 64 characters and is published with no serialization
 *                  (route-table.json#adjudications: an exhaustive sweep of candidate serializations
 *                  found no input that produces it). It is reported loudly, never counted as a pass,
 *                  and it does not make the run unable-to-run — but it is only admitted while the
 *                  artifact DECLARES it unreproducible, so the class cannot be used to hide a gate that
 *                  simply was not measured.
 */
function gate(name, expected, actual) {
  var passed = stableStringify(expected) === stableStringify(actual);

  return {
    name     : name,
    status   : passed ? 'PASS' : 'FAIL',
    expected : expected,
    actual   : actual
  };
}

function unevaluatedGate(name, reason) {
  return { name : name, status : 'UNEVALUATED', expected : null, actual : null, reason : reason };
}

/**
 * The permanently-unreproducible verdict. `declared` is the artifact's own declaration that the value
 * cannot be recomputed; when it is missing or says anything else the gate becomes a FAIL, so an artifact
 * cannot acquire this verdict by silence.
 */
function unreproducibleGate(name, reason, declared) {
  if (declared !== 'none') {
    return {
      name     : name,
      status   : 'FAIL',
      expected : 'the artifact must declare this value unreproducible (documentedDigestReproduced: ' +
                 '"none") for the UNREPRODUCIBLE verdict to be admissible',
      actual   : 'documentedDigestReproduced=' + JSON.stringify(declared)
    };
  }

  return { name : name, status : 'UNREPRODUCIBLE', expected : null, actual : null, reason : reason };
}

/** The first entry of a section for one method and path, or null. */
function findEntry(entries, method, requestPath, state) {
  var found = null;

  (entries || []).forEach(function(entry) {
    if (found || entry.method !== method || entry.path !== requestPath) {
      return;
    }

    if (state && String(entry.state || '') !== state) {
      return;
    }

    found = entry;
  });

  return found;
}

function statusOf(entries, method, requestPath, state) {
  var entry = findEntry(entries, method, requestPath, state);

  return entry ? entry.status : null;
}

function pathsWithStatus(entries, status) {
  return entries.filter(function(entry) {
    return entry.status === status;
  }).map(function(entry) {
    return entry.path;
  }).sort();
}

function pathsWithStatusAndBodyKind(entries, status, kind) {
  return entries.filter(function(entry) {
    return entry.status === status && entry.bodyShape && entry.bodyShape.kind === kind;
  }).map(function(entry) {
    return entry.path;
  }).sort();
}

function pathsWithHeader(entries, header) {
  return entries.filter(function(entry) {
    return entry.headers && entry.headers[header] !== undefined;
  }).map(function(entry) {
    return entry.path;
  }).sort();
}

/**
 * The redirecting entries split by whether their Location is absolute on `origin` or relative. The
 * absolute test is exact origin equality, not a prefix match, for the same reason classifyHopTarget's
 * is: `https://trinket.dev.evil.example/x` starts with the configured origin as a string and would
 * otherwise have been counted as a same-origin absolute redirect.
 */
function redirectLocationKinds(entries, origin) {
  var kinds = { absolute : [], relative : [], other : [] };

  entries.filter(function(entry) {
    return isRedirectStatus(entry.status);
  }).forEach(function(entry) {
    var location = entry.location;

    if (typeof location !== 'string') {
      kinds.other.push(location);
    }
    else if (location.charAt(0) === '/' && location.indexOf('//') !== 0) {
      kinds.relative.push(location);
    }
    else if (sameOrigin(location, origin)) {
      kinds.absolute.push(location);
    }
    else {
      kinds.other.push(location);
    }
  });

  return kinds;
}

/** The paths whose first hop redirects to the bare relative '/login' — the 401 HTML takeover branch. */
function takeoverRedirectPaths(entries) {
  return entries.filter(function(entry) {
    return isRedirectStatus(entry.status) && entry.location === '/login';
  }).map(function(entry) {
    return entry.path;
  }).sort();
}

/** The distinct Set-Cookie attribute-name lists observed across every section, de-duplicated. */
function cookieAttributeVariants(sections) {
  var seen = {};

  sections.forEach(function(entries) {
    (entries || []).forEach(function(entry) {
      (entry.setCookieAttributes || []).forEach(function(names) {
        seen[JSON.stringify(names)] = true;
      });
    });
  });

  return Object.keys(seen).sort();
}

/** Every redacted Set-Cookie value observed across every section. */
function allSetCookies(sections) {
  var cookies = [];

  sections.forEach(function(entries) {
    (entries || []).forEach(function(entry) {
      (entry.setCookie || []).forEach(function(value) { cookies.push(String(value)); });
    });
  });

  return cookies;
}

function routeTableGates(committedTable, measured) {
  var empirical = (committedTable.canonicalization &&
                   committedTable.canonicalization.empiricalAuthShape) || {},
      gates     = [
        gate('route-table rowCount', committedTable.gates.rowCount, measured.gates.rowCount),
        gate('route-table methods', committedTable.gates.methods, measured.gates.methods),
        gate('route-table apiPaths', committedTable.gates.apiPaths, measured.gates.apiPaths),
        gate('route-table withPreHandlers', committedTable.gates.withPreHandlers,
             measured.gates.withPreHandlers),
        gate('route-table authRequiredSession', committedTable.gates.authRequiredSession,
             measured.gates.authRequiredSession),
        gate('route-table authFalse', committedTable.gates.authFalse, measured.gates.authFalse),
        gate('route-table authTryInherited', committedTable.gates.authTryInherited,
             measured.gates.authTryInherited),
        gate('route-table authFalseRoutes', (committedTable.authFalseRoutes || []).map(function(entry) {
          return entry.row;
        }), measured.rows.filter(function(row) {
          return row.auth === false;
        }).map(function(row) { return row.canonical; })),
        gate('route-table rawSettingsAuthTally', empirical.rawSettingsAuthTally,
             measured.rawSettingsAuthTally),
        gate('route-table serverAuthSettingsDefault', empirical.serverAuthSettingsDefault,
             measured.serverAuthDefault),
        gate('route-table registration order resolves every declaration', [],
             measured.missingDeclarations),
        gate('route-table gates.measuredSha256', committedTable.gates.measuredSha256,
             measured.digests.measuredSha256),
        gate('route-table gates.measuredSha256First32', committedTable.gates.measuredSha256First32,
             measured.digests.measuredSha256First32),
        gate('route-table gates.measuredMd5', committedTable.gates.measuredMd5,
             measured.digests.measuredMd5),
        gate('route-table gates.registrationOrderFingerprint',
             committedTable.gates.registrationOrderFingerprint,
             measured.digests.registrationOrderFingerprint)
      ];

  // THE DOCUMENTED ANCHOR, CLAUSE BY CLAUSE. Every clause documentedAnchorGate()
  // evaluates becomes its own PASS/FAIL entry here, plus the verdict itself, so this CLI enforces the
  // gate the artifact calls mandatory rather than merely printing that some other file does: a --dry-run
  // exits non-zero on any failure and main() REFUSES to write over a failed gate. Naming each clause
  // separately is deliberate — a summary boolean tells an operator that something drifted, and this
  // tells them which anchor.
  var anchor = documentedAnchorGate(measured, committedTable);

  anchor.clauses.forEach(function(clause) {
    gates.push(gate('route-table documentedAnchorGate clause ' + clause.name,
                    clause.documented, clause.measured));
  });

  gates.push(gate('route-table documentedAnchorGate unsatisfied clauses', [], anchor.failures));
  // The clause NAMES the artifact publishes, in order, against the evaluator's own. This is what stops the
  // published clause list drifting away from the clauses actually evaluated — an artifact that advertised a
  // clause the evaluator no longer has would otherwise read as enforced. Only the leading name token of
  // each published clause string is read; the descriptive text after it is hand-authored documentation.
  gates.push(gate('route-table gates.documentedAnchorGate.clauses (names, in order)',
                  (((committedTable.gates.documentedAnchorGate || {}).clauses) || [])
                    .map(function(text) { return String(text).split(' ')[0]; }),
                  anchor.clauses.map(function(clause) { return clause.name; })));
  // The countable anchors — every clause except the digest-retention one — as the artifact's own flag
  // claims them. mergeMeasuredRouteTable() regenerates the flag from this same computation.
  gates.push(gate('route-table gates.documentedAnchorsExceptDigestAllReproduced',
                  committedTable.gates.documentedAnchorsExceptDigestAllReproduced,
                  countableAnchorsReproduced(anchor)));
  // The provenance block's own count of reproduced route rows, gated against this run rather than left
  // as prose.
  gates.push(gate('route-table metadata.toolchainReverification.reproducedCounts.routeRows',
                  (((committedTable.metadata || {}).toolchainReverification || {})
                    .reproducedCounts || {}).routeRows,
                  measured.gates.rowCount));
  // The artifact's own stored verdict is ANDed with the freshly computed one, so neither a stale `true`
  // in the file nor a passing computation on its own can carry the gate. mergeMeasuredRouteTable()
  // regenerates the stored value from this same evaluator, which is what stops it being hand-authored.
  gates.push(gate('route-table gates.documentedAnchorGateSatisfied', true,
                  committedTable.gates.documentedAnchorGateSatisfied === true && anchor.satisfied));

  // The Technical Specification's published digest is 32 hexadecimal characters labelled sha256, where a
  // SHA-256 is 64, and it is published with no serialization — so no verifier can recompute the STRING
  // from any input. The gate is therefore reported as UNREPRODUCIBLE and NOT as a pass, which is the
  // honest report: the anchor the literal names is enforced instead over the 233-row table itself, by
  // the eleven clauses above, which are recomputed live and are mandatory PASS/FAIL - and clause 11 of
  // which recomputes the full-width sha256 this table CAN be hashed to. The verdict is
  // admissible only because the artifact declares it (gates.documentedDigestReproduced), and the one
  // thing that must never happen is a run that manufactures agreement with the string.
  gates.push(unreproducibleGate('route-table gates.documentedDigest (' +
                                committedTable.gates.documentedDigest + ')',
                                'the Specification publishes 32 hex characters labelled sha256 with no ' +
                                'serialization; route-table.json#adjudications records the exhaustive ' +
                                'sweep that found no input producing it. The anchor is enforced over ' +
                                'the 233-row table by capture.js#documentedAnchorGate instead, whose ' +
                                'eleven clauses are gated individually above, the last of which ' +
                                'recomputes the full-width sha256 this table CAN be hashed to.',
                                committedTable.gates.documentedDigestReproduced));

  return gates;
}

/**
 * The response-corpus gates. Every expectation is read from responses.json#gates or #selectionRule and
 * every actual is recomputed from the measurement, so a gate can only pass because the run reproduced
 * the recorded value. `origin` is the app.url origin the measurement ran under, which is what decides
 * whether a Location counts as absolute.
 */
function corpusGates(committedCorpus, measured, origin) {
  var unauthenticated = measured.unauthenticated,
      authenticated   = measured.authenticated,
      published       = committedCorpus.gates,
      locations       = redirectLocationKinds(unauthenticated, origin),
      serverErrors    = unauthenticated.filter(function(entry) { return entry.status === 500; }),
      contract        = committedCorpus.locationContract || [],
      loginEntry      = findEntry(authenticated, 'POST', '/login', 'login-flow (valid credentials)'),
      accountEntry    = findEntry(authenticated, 'GET', '/account', 'authenticated');

  return [
    gate('corpus selectionRule.expectedCount', committedCorpus.selectionRule.expectedCount,
         unauthenticated.length),
    gate('corpus selectionRule.paths', committedCorpus.selectionRule.paths,
         unauthenticated.map(function(entry) { return entry.path; })),
    gate('corpus unauthenticatedEntryCount', published.unauthenticatedEntryCount,
         unauthenticated.length),
    gate('corpus authenticatedEntryCount', published.authenticatedEntryCount, authenticated.length),
    gate('corpus assignmentNextEntryCount', published.assignmentNextEntryCount,
         (measured.assignmentNext || []).length),
    gate('corpus firstHopStatusDistribution', published.firstHopStatusDistribution,
         statusDistribution(unauthenticated)),
    gate('corpus resolvedStatusDistribution', published.resolvedStatusDistribution,
         resolvedStatusDistribution(unauthenticated)),
    // The Technical Specification's published 25x200 / 7x401 / 25x404 / 1x500 tally, which the corpus
    // reproduces in its RESOLVED reading (responses.json#gates.distributionAuthority).
    gate('corpus documentedDistribution (25/7/25/1)', published.documentedDistribution,
         resolvedStatusDistribution(unauthenticated)),
    gate('corpus hopCountHistogram', published.hopCountHistogram, hopCountHistogram(unauthenticated)),
    gate('corpus redirectingRouteCount', published.redirectingRouteCount,
         redirectingEntryPaths(unauthenticated).length),
    gate('corpus redirectingRoutePaths', published.redirectingRoutePaths,
         redirectingEntryPaths(unauthenticated)),
    gate('corpus redirectResolution', published.redirectResolution,
         redirectResolutionDistribution(unauthenticated)),
    gate('corpus authRequiredApiUnauthorized (7x401)', published.authRequiredApiUnauthorized,
         pathsWithStatus(unauthenticated, 401).length),
    gate('corpus authRequiredApiUnauthorizedPaths', published.authRequiredApiUnauthorizedPaths,
         pathsWithStatus(unauthenticated, 401)),
    // The provenance block's own count of reproduced corpus entries, gated against this run. The
    // route-row half is gated in routeTableGates().
    gate('corpus metadata.toolchainReverification.reproducedCounts (sections)',
         {
           unauthenticated : (((committedCorpus.metadata || {}).toolchainReverification || {})
                               .reproducedCounts || {}).unauthenticated,
           authenticated   : (((committedCorpus.metadata || {}).toolchainReverification || {})
                               .reproducedCounts || {}).authenticated,
           assignmentNext  : (((committedCorpus.metadata || {}).toolchainReverification || {})
                               .reproducedCounts || {}).assignmentNext
         },
         {
           unauthenticated : unauthenticated.length,
           authenticated   : authenticated.length,
           assignmentNext  : (measured.assignmentNext || []).length
         }),
    gate('corpus serverErrorEntryCount (1x500)', published.serverErrorEntryCount, serverErrors.length),
    gate('corpus singleServerErrorRoute', published.singleServerErrorRoute,
         serverErrors.length === 1 ? serverErrors[0].method + ' ' + serverErrors[0].path : null),
    // The pre-existing 500 is Boom JSON rather than a rendered 50x.html, because /api/ is an API
    // request. The body KIND is the assertion; the message is scrubbed by hapi either way.
    gate('corpus serverError delivered as JSON', 'json',
         serverErrors.length === 1 ? serverErrors[0].bodyShape.kind : null),
    gate('corpus languageFlagFourOhFours (20)', published.languageFlagFourOhFours,
         pathsWithStatusAndBodyKind(unauthenticated, 404, 'html').length),
    gate('corpus languageFlagFourOhFourPaths', published.languageFlagFourOhFourPaths,
         pathsWithStatusAndBodyKind(unauthenticated, 404, 'html')),
    gate('corpus boomJsonFourOhFours', published.boomJsonFourOhFours,
         pathsWithStatusAndBodyKind(unauthenticated, 404, 'json').length),
    gate('corpus boomJsonFourOhFourPaths', published.boomJsonFourOhFourPaths,
         pathsWithStatusAndBodyKind(unauthenticated, 404, 'json')),
    gate('corpus takeoverRedirectsToLogin', published.takeoverRedirectsToLogin,
         takeoverRedirectPaths(unauthenticated)),
    gate('corpus absoluteRedirectCount', published.absoluteRedirectCount, locations.absolute.length),
    gate('corpus relativeRedirectCount', published.relativeRedirectCount, locations.relative.length),
    gate('corpus xFrameOptionsPaths', published.xFrameOptionsPaths,
         pathsWithHeader(unauthenticated, 'x-frame-options')),
    gate('corpus unauthenticatedLoginStatus', published.unauthenticatedLoginStatus,
         statusOf(unauthenticated, 'GET', '/login')),
    gate('corpus unauthenticatedSignupStatus', published.unauthenticatedSignupStatus,
         statusOf(unauthenticated, 'GET', '/signup')),
    // The flagship quirk: authenticated GET /login and GET /signup are 500, not 302. A 302 here is a
    // lib/controllers/pages.js defect, never a corpus to be adjusted. See docs/PRESERVED-QUIRKS.md 1.1.
    gate('corpus authenticatedLoginStatus (500 quirk)', published.authenticatedLoginStatus,
         statusOf(authenticated, 'GET', '/login', 'authenticated')),
    gate('corpus authenticatedSignupStatus (500 quirk)', published.authenticatedSignupStatus,
         statusOf(authenticated, 'GET', '/signup', 'authenticated')),
    gate('corpus authenticatedHomeStatus', published.authenticatedHomeStatus,
         statusOf(authenticated, 'GET', '/home', 'authenticated')),
    gate('corpus authenticatedAccountStatus', published.authenticatedAccountStatus,
         statusOf(authenticated, 'GET', '/account', 'authenticated')),
    gate('corpus authenticatedFirstHopStatuses', published.authenticatedFirstHopStatuses,
         authenticatedStatusMap(authenticated)),
    // locationContract[0] is the ABSOLUTE literal a successful login emits and locationContract[2] the
    // RELATIVE one the account route emits. Both are asserted LITERALLY — no origin rewriting — because
    // the contrast between them is the evidence behind test/helpers/flow.js's URL.parse base argument and
    // the 22 lastRedirect.pathname assertions that ride on it.
    gate('corpus locationContract absolute (POST /login valid)',
         contract[0] ? contract[0].location : null, loginEntry ? loginEntry.location : null),
    gate('corpus locationContract relative (GET /account authenticated)',
         contract[2] ? contract[2].location : null, accountEntry ? accountEntry.location : null)
  ];
}

/** The cookie contract from responses.json#cookieContract, recomputed from every measured Set-Cookie. */
function cookieContractGates(committedCorpus, measured) {
  var contract = committedCorpus.cookieContract,
      sections = [measured.unauthenticated, measured.authenticated, measured.assignmentNext],
      cookies  = allSetCookies(sections),
      expected = [contract.measuredAttributesOrdinaryRoute, contract.measuredAttributesCookieRoute]
        .map(function(names) { return JSON.stringify(names); }).sort();

  return [
    gate('cookie name is ' + contract.name, [contract.name], cookies.map(function(value) {
      return value.split('=')[0];
    }).filter(function(name, index, all) { return all.indexOf(name) === index; })),
    gate('cookie seal prefix ' + contract.sealPrefix, cookies.length,
         cookies.filter(function(value) {
           return value.indexOf(contract.name + '=' + contract.sealPrefix + '*') === 0;
         }).length),
    gate('cookie attribute variants', expected, cookieAttributeVariants(sections)),
    // isSecure is false in the shipped configuration, so app.js appends only "; Expires=…". A capture
    // that overrode cookieOptions.isSecure would append "; SameSite=None; Secure" and change an
    // observable header, which is why the override set excludes it. Both gates below are named after the
    // cookieContract key they check, and both expectations are the recorded `false`.
    gate('cookie sameSiteSecureAppended', contract.sameSiteSecureAppended,
         cookies.some(function(value) {
           return /SameSite=None/i.test(value) || /;\s*Secure(\s*;|\s*$)/i.test(value);
         })),
    gate('cookie domainAttributePresent', contract.domainAttributePresent,
         cookies.some(function(value) { return /;\s*Domain=/i.test(value); }))
  ];
}

/** The buildArtifacts block. Absent build output yields UNEVALUATED gates carrying the precondition. */
function buildArtifactGates(committedCorpus, measured) {
  var published = committedCorpus.buildArtifacts || {},
      gates     = [];

  BUILD_ARTIFACT_FILES.forEach(function(relative) {
    if (!measured.files[relative]) {
      gates.push(unevaluatedGate('buildArtifacts ' + relative,
                                 'absent from this checkout — ' + (published.precondition ||
                                 'run `npm run build` after hydrating public/components')));

      return;
    }

    gates.push(gate('buildArtifacts ' + relative, published[relative], measured.files[relative]));
  });

  if (measured.cssMapFilesEmitted === null) {
    gates.push(unevaluatedGate('buildArtifacts cssMapFilesEmitted',
                               'public/css does not exist in this checkout'));
  }
  else {
    gates.push(gate('buildArtifacts cssMapFilesEmitted', published.cssMapFilesEmitted,
                    measured.cssMapFilesEmitted));
  }

  return gates;
}

/**
 * Prints one line per gate and returns the tally. FAIL lines carry both values, because a gate summary
 * that says only "FAIL" forces a reader back into the artifact to find out what was expected.
 */
function printGateSummary(gates, quiet) {
  var tally = { pass : 0, fail : 0, unevaluated : 0, unreproducible : 0 };

  gates.forEach(function(entry) {
    if (entry.status === 'PASS')                     { tally.pass += 1; }
    else if (entry.status === 'UNEVALUATED')         { tally.unevaluated += 1; }
    else if (entry.status === 'UNREPRODUCIBLE')      { tally.unreproducible += 1; }
    else                                             { tally.fail += 1; }

    if (entry.status === 'PASS' && quiet) {
      return;
    }

    console.log('  [' + entry.status + '] ' + entry.name +
                (entry.status === 'PASS' ? ' = ' + String(stableStringify(entry.actual)).slice(0, 120)
                                         : ''));

    if (entry.status === 'UNEVALUATED' || entry.status === 'UNREPRODUCIBLE') {
      console.log('      reason: ' + entry.reason);
    }
    else if (entry.status === 'FAIL') {
      console.log('      expected: ' + String(stableStringify(entry.expected)).slice(0, 400));
      console.log('      measured: ' + String(stableStringify(entry.actual)).slice(0, 400));
    }
  });

  console.log('capture.js: gates ' + tally.pass + ' PASS, ' + tally.fail + ' FAIL, ' +
              tally.unevaluated + ' UNEVALUATED, ' + tally.unreproducible + ' UNREPRODUCIBLE');

  return tally;
}

// Writing — deliberately hard to do by accident

function currentHeadCommit() {
  try {
    return childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd      : path.join(__dirname, '..', '..'),
      encoding : 'utf8'
    }).trim();
  }
  catch (err) {
    return null;
  }
}

/**
 * Configuration layers that are gitignored, outrank `config/default.yaml` and `config/test.yaml`, and
 * are NOT force-owned by configureRuntime().
 *
 * configureRuntime() installs NODE_CONFIG, which node-config ranks above every file layer
 * (`node_modules/config/lib/config.js:L746-L757`), so the five keys it owns — `app.start`,
 * `app.hostname`, `app.port`, the session cookie password and `db.mongo.database` — cannot be moved by
 * a file. Everything else can: `features.*`, `app.usersubdomains`, `app.prefixes`, and the mail and
 * recaptcha blocks all sit in the file layers, and any one of them changes what the corpus measures.
 * `config/runtime.json` is here for the same reason — node-config writes and reads it as a layer
 * (`node_modules/config/lib/config.js:L111`).
 */
var UNSANCTIONED_CONFIG_LAYERS = /^config\/(local(-[^/]+)?\.(ya?ml|json|js)|runtime\.json)$/;

/**
 * Whether a configuration layer actually declares anything, so an inert file is not reported as one.
 *
 * `config/runtime.json` in particular is node-config's own bookkeeping and is routinely present as
 * exactly `{}` — node-config creates it and this harness sets NODE_CONFIG_PERSIST_ON_CHANGE=N so it
 * stays that way. An empty layer cannot move a single key, so refusing on it would be a false positive
 * that blocks a legitimate capture. A file that cannot be read is treated as declaring something,
 * because "I could not tell" must fail closed here rather than open.
 *
 * The test is deliberately syntactic and cheap: strip JSON/YAML comment lines and whitespace, and treat
 * the empty string, `{}`, `null` and a document marker as declaring nothing. Anything else counts.
 *
 * @param   {String}  relativePath A repository-relative path.
 * @returns {Boolean} true when the layer would contribute at least one key.
 */
function declaresConfiguration(relativePath) {
  var contents;

  try {
    contents = fs.readFileSync(path.join(repositoryRoot(), relativePath), 'utf8');
  }
  catch (err) {
    return true;
  }

  var stripped = contents.split('\n').filter(function(line) {
    return line.trim() !== '' && line.trim().indexOf('#') !== 0 && line.trim().indexOf('//') !== 0;
  }).join('').replace(/\s+/g, '');

  return stripped !== '' && stripped !== '{}' && stripped !== 'null' && stripped !== '---';
}

/**
 * The state of the tree that is about to be measured, read from git rather than assumed.
 *
 * The distinction between the three lists is deliberate, and each is acted on differently.
 *
 *   - MODIFIED tracked files mean the source being measured is not the commit it claims to be, which
 *     disqualifies the run from writing baseline evidence. assertWritable() REFUSES.
 *   - UNTRACKED paths do not disqualify it: a capture is performed in a checkout of the recorded commit
 *     with this harness copied in beside it — the harness does not exist at that commit — and with
 *     node_modules installed from the lockfile beside it, so untracked paths are expected. They are
 *     RECORDED in the artifact instead of silently tolerated, which is what makes the provenance
 *     auditable.
 *   - IGNORED paths are read too, because `git status --porcelain` alone cannot see them: a gitignored
 *     `config/local.yaml` — a layer that outranks `config/default.yaml` for every key configureRuntime()
 *     does not force — would appear in NEITHER list and stay invisible to both the refusal logic and the
 *     provenance. `--ignored` makes it visible. The whole ignored set is far too broad to record (it
 *     includes node_modules and the 435 MB component tree), so only the configuration layers matching
 *     UNSANCTIONED_CONFIG_LAYERS that declaresConfiguration() finds non-empty are kept: those are the
 *     ones that change what is captured, and assertWritable() REFUSES on them.
 *
 * @returns {Object|null} { head, trackedModifications, untracked, configLayers } or null when there is
 *   no git metadata.
 */
function gitState() {
  var head = currentHeadCommit(),
      porcelain;

  if (!head) {
    return null;
  }

  try {
    // --ignored=matching lists ignored FILES individually rather than collapsing them into their
    // ignored parent directory, which is what makes `config/local.yaml` appear at all.
    porcelain = childProcess.execFileSync('git', ['status', '--porcelain', '--ignored=matching'], {
      cwd      : repositoryRoot(),
      encoding : 'utf8'
    });
  }
  catch (err) {
    return null;
  }

  var lines        = porcelain.split('\n').filter(function(line) { return line.trim() !== ''; }),
      tracked      = [],
      untracked    = [],
      configLayers = [];

  lines.forEach(function(line) {
    if (line.indexOf('!! ') === 0) {
      var ignoredPath = line.slice(3);

      if (UNSANCTIONED_CONFIG_LAYERS.test(ignoredPath) && declaresConfiguration(ignoredPath)) {
        configLayers.push(ignoredPath);
      }

      return;
    }

    if (line.indexOf('?? ') === 0) {
      untracked.push(line.slice(3));

      return;
    }

    tracked.push(line);
  });

  return {
    head                 : head,
    trackedModifications : tracked,
    untracked            : untracked,
    configLayers         : configLayers
  };
}

/**
 * The npm version, for provenance. Read from the package manager itself rather than from package.json's
 * `engines` range, because the range is what is permitted and this field records what actually ran.
 * Resolves to null rather than throwing when npm is not on PATH, since a capture does not need it.
 */
function npmVersion() {
  try {
    return childProcess.execFileSync('npm', ['--version'], {
      encoding : 'utf8',
      stdio    : ['ignore', 'pipe', 'ignore']
    }).trim();
  }
  catch (err) {
    return null;
  }
}

/**
 * The versions of the packages the artifact pins, read from the installed tree. Recorded on every write
 * so metadata.dependencyVersions describes the stack the measurement actually ran on rather than the
 * stack whoever last edited the artifact believed it ran on.
 */
function installedDependencyVersions(names) {
  var versions = {};

  (names || []).forEach(function(name) {
    try {
      versions[name] = require(path.join(repositoryRoot(), 'node_modules', name, 'package.json')).version;
    }
    catch (err) {
      versions[name] = null;
    }
  });

  return versions;
}

/**
 * Decides whether this run may replace the committed evidence, and says exactly why not when it may not.
 *
 * Three conditions, none of them with an escape hatch:
 *   - the SOURCE being captured must be the commit the artifacts are the baseline for. Anything else
 *     writes post-migration or half-finished values over the only thing that makes the migration
 *     falsifiable. --adopt-base-commit lifts this one, deliberately and on the record, because
 *     establishing a new baseline is a real operation that should not require a wildcard --force.
 *   - no tracked file may be modified. A dirty tree at the right commit is not that commit.
 *   - no unsanctioned CONFIGURATION LAYER may be present. A gitignored `config/local.yaml` outranks
 *     `config/default.yaml` and `config/test.yaml` for every key configureRuntime() does not force, so
 *     a corpus captured with one in place records that operator's configuration rather than the
 *     repository's. --adopt-base-commit does NOT lift this one: adopting a new HEAD is a decision about
 *     WHICH commit is the baseline, not a licence to measure it under an undeclared configuration.
 *     The sanctioned way to vary the runtime is NODE_CONFIG, which configureRuntime() merges and
 *     effectiveNodeConfig() records into the artifact for anyone to audit.
 *
 * @param   {Object} committed The committed responses.json.
 * @param   {Object} options   The parsed CLI options.
 * @returns {Object} { allowed, state, reason, adopting } — `reason` is null when allowed.
 */
function assertWritable(committed, options) {
  var state    = gitState(),
      recorded = committed.metadata.baseCommit;

  if (!state) {
    return {
      allowed  : false,
      state    : null,
      adopting : false,
      reason   : 'this tree has no readable git metadata, so the source being measured cannot be ' +
                 'identified. Baseline evidence must be attributable to a commit; refusing to write.'
    };
  }

  if (state.trackedModifications.length) {
    return {
      allowed  : false,
      state    : state,
      adopting : false,
      reason   : state.trackedModifications.length + ' tracked file(s) are modified in this tree (' +
                 state.trackedModifications.slice(0, 5).join(', ') + (state.trackedModifications.length > 5
                   ? ', …' : '') + '). A dirty tree at the right commit is not that commit, so the ' +
                 'measurement is not attributable. Commit or restore them first.'
    };
  }

  if (state.head !== recorded && !options.adoptBaseCommit) {
    return {
      allowed  : false,
      state    : state,
      adopting : false,
      reason   : 'HEAD is ' + state.head + ' but the artifacts are the baseline for ' + recorded +
                 '. Capture from a checkout of that commit — `git archive ' + recorded.slice(0, 7) +
                 '` or a detached clone, with this harness copied in and node_modules installed from ' +
                 'that commit\'s lockfile. Pass --adopt-base-commit only if you genuinely intend to ' +
                 'replace the baseline with this HEAD.'
    };
  }

  if (state.configLayers.length) {
    return {
      allowed  : false,
      state    : state,
      adopting : false,
      reason   : state.configLayers.length + ' gitignored configuration layer(s) are present (' +
                 state.configLayers.join(', ') + '). node-config ranks them above config/default.yaml ' +
                 'and config/test.yaml for every key configureRuntime() does not force, so a corpus ' +
                 'captured with one in place records that layer\'s features, prefixes, subdomains and ' +
                 'mail settings rather than the repository\'s — and the baseline for ' + recorded +
                 ' would stop being reproducible from a clean checkout. Move it aside for the capture ' +
                 'and express any intended variation through NODE_CONFIG, which is merged by ' +
                 'configureRuntime() and recorded in metadata.nodeConfigOverride. There is no flag ' +
                 'that lifts this.'
    };
  }

  return {
    allowed  : true,
    state    : state,
    adopting : state.head !== recorded,
    reason   : null
  };
}

/** `METHOD path {state}` — the stable identity of one corpus entry, used to carry prose across a write. */
function entryIdentity(entry) {
  return entry.method + ' ' + entry.path + ' {' + String(entry.state || '') + '}';
}

/**
 * Merges measured values into the committed artifact.
 *
 * TWO RULES:
 *
 *   1. THE ARRAYS ARE BUILT FROM THE CAPTURED ENTRIES, never by mapping over the committed array. An
 *      entry this run captured but the artifact does not carry must not be discarded, and an entry the
 *      artifact carries but this run did not capture must not be retained with stale values while the
 *      counts around it move. The capture is the evidence; the artifact is what it is written into.
 *   2. PROSE IS CARRIED ACROSS BY IDENTITY, NEVER BY ARRAY INDEX. `notes` is hand-authored per entry, and
 *      matching it positionally means one inserted route re-labels every entry after it. The identity is
 *      METHOD + path + state, which is unique across all three sections: 58 + 7 + 8 entries, 73 distinct
 *      identities.
 *
 * Every hand-authored block outside the entries — the contracts, adjudications and the gate keys that are
 * not pure functions of the measurement — is preserved untouched, and the keys that were NOT recomputed
 * are returned so main() can name them instead of leaving a reader to assume the whole block was
 * re-derived.
 */
function mergeMeasuredIntoCommitted(committed, measured, buildArtifacts, provenance) {
  var merged        = JSON.parse(JSON.stringify(committed)),
      notRecomputed = [],
      carried       = { prose : 0, withoutProse : [], dropped : [] };

  ['unauthenticated', 'authenticated', 'assignmentNext'].forEach(function(section) {
    var prose = {};

    (committed[section] || []).forEach(function(entry) {
      prose[entryIdentity(entry)] = entry;
    });

    merged[section] = (measured[section] || []).map(function(entry) {
      var identity = entryIdentity(entry),
          previous = prose[identity],
          target   = JSON.parse(JSON.stringify(entry));

      if (previous && previous.notes !== undefined) {
        // The prose describes THIS entry, identified by what it is rather than by where it sat.
        target.notes = previous.notes;
        carried.prose += 1;
      }
      else if (!previous) {
        carried.withoutProse.push(section + ' :: ' + identity);
      }

      delete prose[identity];

      return target;
    });

    Object.keys(prose).forEach(function(identity) {
      carried.dropped.push(section + ' :: ' + identity);
    });
  });

  merged.metadata.capturedAt = measured.capturedAt;
  merged.metadata.finishedAt = measured.finishedAt;
  merged.metadata.serverUri  = measured.serverUri;
  // The origin this run actually captured under, never a carried-over value: every absolute Location and
  // every rendered body in the rows above is relative to it, so a stale one would make the artifact
  // describe a surface it does not contain.
  merged.metadata.appUrlOrigin = measured.appUrlOrigin || merged.metadata.appUrlOrigin;

  // PROVENANCE. Every field here is read from THIS run, so the artifact cannot claim a runtime it did
  // not use — app.port and the serverUri port come from the same run and their agreement is gated below.
  if (provenance) {
    merged.metadata.node             = provenance.node;
    merged.metadata.npm              = provenance.npm;
    merged.metadata.nodeEnv          = provenance.nodeEnv;
    merged.metadata.nodeConfigOverride = provenance.nodeConfigOverride;
    merged.metadata.captureCommit    = provenance.captureCommit;
    merged.metadata.gitState         = provenance.gitState;
    merged.metadata.gitStatusClean   = provenance.gitStatusClean;
    merged.metadata.database         = provenance.database;
    merged.metadata.dependencyVersions = provenance.dependencyVersions;

    if (provenance.adopting) {
      merged.metadata.baseCommit = provenance.captureCommit;
    }
  }

  merged.selectionRule.actualCount        = measured.unauthenticated.length;
  // The RESOLVED reading, which is the one the Technical Specification publishes (25/7/25/1). The
  // first-hop reading is kept beside it as gates.firstHopStatusDistribution.
  merged.gates.measuredDistribution       = resolvedStatusDistribution(measured.unauthenticated);
  merged.gates.unauthenticatedEntryCount  = measured.unauthenticated.length;
  merged.gates.authenticatedEntryCount    = measured.authenticated.length;

  var redirecting = redirectingEntryPaths(measured.unauthenticated);

  merged.gates.firstHopStatusDistribution      = statusDistribution(measured.unauthenticated);
  merged.gates.resolvedStatusDistribution      = resolvedStatusDistribution(measured.unauthenticated);
  merged.gates.hopCountHistogram               = hopCountHistogram(measured.unauthenticated);
  merged.gates.redirectingRouteCount           = redirecting.length;
  merged.gates.redirectingRoutePaths           = redirecting;
  merged.gates.redirectResolution              = redirectResolutionDistribution(measured.unauthenticated);
  merged.gates.authenticatedFirstHopStatuses   = authenticatedStatusMap(measured.authenticated);
  merged.gates.assignmentNextEntryCount        = (measured.assignmentNext || []).length;
  merged.gates.assignmentNextStatuses          = assignmentNextStatusMap(measured.assignmentNext);
  merged.gates.assignmentNextLocations         =
    assignmentNextLocationMap(measured.assignmentNext);
  // The cache-prefix confinement probes. Recomputed like every other gate above, so a --write run
  // records what this run observed rather than carrying a stale verdict forward.
  merged.gates.assetConfinementStatuses        =
    assetConfinementStatusMap(measured.assetConfinement);

  if (merged.assetConfinementContract && measured.assetConfinement) {
    merged.assetConfinementContract.statuses =
      assetConfinementStatusMap(measured.assetConfinement);
  }

  // The build artifacts, and ONLY the halves this run could actually measure. An absent stylesheet means
  // the checkout was never built (responses.json#buildArtifacts.precondition), which is not evidence
  // that the bytes changed — overwriting a recorded digest with "missing" would destroy a measurement
  // and replace it with the story of how this particular checkout was set up.
  if (buildArtifacts && merged.buildArtifacts) {
    Object.keys(buildArtifacts.files || {}).forEach(function(relative) {
      merged.buildArtifacts[relative] = buildArtifacts.files[relative];
    });

    if (buildArtifacts.cssMapFilesEmitted !== null && buildArtifacts.cssMapFilesEmitted !== undefined) {
      merged.buildArtifacts.cssMapFilesEmitted = buildArtifacts.cssMapFilesEmitted;
    }
  }

  var recomputed = [
    'measuredDistribution', 'unauthenticatedEntryCount', 'authenticatedEntryCount',
    'firstHopStatusDistribution', 'resolvedStatusDistribution', 'hopCountHistogram',
    'redirectingRouteCount', 'redirectingRoutePaths', 'redirectResolution',
    'authenticatedFirstHopStatuses',
    'assignmentNextEntryCount', 'assignmentNextStatuses', 'assignmentNextLocations',
    'assetConfinementStatuses'
  ];

  Object.keys(merged.gates).forEach(function(key) {
    if (recomputed.indexOf(key) === -1) {
      notRecomputed.push(key);
    }
  });

  return { artifact : merged, notRecomputed : notRecomputed, carried : carried };
}

/**
 * Replaces BOTH artifacts or NEITHER. The old code wrote route-table.json and then
 * responses.json as two independent operations, so a failure in between — or a `--write --routes-only`
 * run, which could not produce a corpus at all — left the pair describing two different runs, which is
 * exactly the state in which the parity denominator and the parity evidence stop being comparable.
 *
 * Each file is staged beside its destination and then renamed, because rename within a directory is
 * atomic; if the second rename fails the first is rolled back from the copy taken before it, so the pair
 * on disk is always one consistent generation. The staged files are removed on every path.
 *
 * @param {Object} routeTable The route-table artifact to write.
 * @param {Object} corpus     The responses artifact to write.
 */
function writeArtifactPair(routeTable, corpus) {
  var writes = [
        { target : ROUTE_TABLE_PATH, artifact : routeTable },
        { target : ARTIFACT_PATH, artifact : corpus }
      ],
      staged = [],
      backups = [],
      index;

  try {
    writes.forEach(function(write) {
      var temp = write.target + '.staged';

      fs.writeFileSync(temp, JSON.stringify(write.artifact, null, 2) + '\n', 'utf8');
      staged.push({ temp : temp, target : write.target });
    });

    for (index = 0; index < staged.length; index++) {
      if (fs.existsSync(staged[index].target)) {
        backups.push({ target : staged[index].target, contents : fs.readFileSync(staged[index].target) });
      }

      fs.renameSync(staged[index].temp, staged[index].target);
    }
  }
  catch (err) {
    backups.forEach(function(backup) {
      fs.writeFileSync(backup.target, backup.contents);
    });

    throw err;
  }
  finally {
    staged.forEach(function(entry) {
      if (fs.existsSync(entry.temp)) {
        fs.unlinkSync(entry.temp);
      }
    });
  }
}

// CLI

/**
 * Validates a --out destination BEFORE anything is captured, so a run cannot spend two minutes capturing
 * and then discover it has nowhere safe to put the result — and, more importantly, so it can never
 * overwrite something that matters. Without it, `--out test/baseline/responses.json` would destroy the
 * committed evidence the run is verifying, and a traversal or a symlink could write anywhere the process
 * can reach.
 *
 * A destination is ALLOWED in exactly two places — a scratch file inside the repository whose name begins
 * with `blitzy_adhoc_test_`, or a new file under the OS temporary directory — and refused everywhere
 * else. An allow-list rather than a deny-list is deliberate: refusing only the in-repository hazards
 * below would still let ANY out-of-repository path through, and several checkouts of this repository sit
 * side by side under one shared root on the hosts this project is developed and validated on, so
 * `--out ../<other-checkout>/x.json` reaches into a neighbour. Confining the destination is the only
 * form of this check that holds.
 *
 * Six refusals, each for a distinct hazard:
 *   1. the two committed artifacts, and anything else under test/baseline — the evidence this harness
 *      exists to protect;
 *   2. any git-TRACKED file — a repository source overwritten by a measurement dump;
 *   3. any other in-repository path, unless its name begins with `blitzy_adhoc_test_`, which is this
 *      repository's convention for a scratch file that is never committed;
 *   4. any path that is neither in this repository nor under the OS temporary directory — a traversal,
 *      a sibling checkout, a home directory, a system path;
 *   5. an existing file, a symlink anywhere on the path, or a missing/non-directory parent — resolved
 *      with fs.realpathSync so a symlinked parent cannot smuggle the target elsewhere;
 *   6. the write itself uses the exclusive 'wx' flag, so even a race cannot clobber.
 *
 * @param   {string} raw   The value passed to the flag.
 * @param   {string} [flag] The flag being validated, for the message; defaults to `--out`. replay.js
 *   passes `--report`, so a refusal names the flag the operator actually typed.
 * @returns {string} The absolute, validated path.
 * @throws  {Error}  With the reason, when the destination is not safe to create.
 */
function validateOutPath(raw, flag) {
  var label      = flag || '--out',
      root       = fs.realpathSync(repositoryRoot()),
      resolved   = path.resolve(process.cwd(), raw),
      parent     = path.dirname(resolved),
      baseline   = path.join(root, 'test', 'baseline'),
      realParent;

  if (fs.existsSync(resolved)) {
    throw new Error('capture.js: ' + label + ' ' + JSON.stringify(raw) + ' already exists. This harness never ' +
                    'overwrites: name a new file.');
  }

  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error('capture.js: ' + label + ' ' + JSON.stringify(raw) + ' names a directory that does not ' +
                    'exist (' + parent + ').');
  }

  realParent = fs.realpathSync(parent);

  if (realParent !== parent) {
    throw new Error('capture.js: ' + label + ' ' + JSON.stringify(raw) + ' resolves through a symlink (' +
                    parent + ' -> ' + realParent + '). Name a real directory, so the destination cannot ' +
                    'be redirected.');
  }

  var target   = path.join(realParent, path.basename(resolved)),
      inRepo   = target === root || target.indexOf(root + path.sep) === 0,
      relative = path.relative(root, target);

  if (target === baseline || target.indexOf(baseline + path.sep) === 0) {
    throw new Error('capture.js: ' + label + ' ' + JSON.stringify(raw) + ' points inside test/baseline, which ' +
                    'holds the committed evidence this run is verifying. Refusing.');
  }

  if (inRepo) {
    if (isTrackedByGit(relative)) {
      throw new Error('capture.js: ' + label + ' ' + JSON.stringify(raw) + ' is a git-tracked file (' + relative +
                      '). Refusing to overwrite repository source with a measurement dump.');
    }

    if (path.basename(target).indexOf('blitzy_adhoc_test_') !== 0) {
      throw new Error('capture.js: ' + label + ' ' + JSON.stringify(raw) + ' is inside the repository. Name the ' +
                      'file blitzy_adhoc_test_<something>, so it is recognisable as scratch that is never ' +
                      'committed, or write it under ' + os.tmpdir() + '.');
    }

    return target;
  }

  // Not in the repository: the ONLY other destination this harness will create is a new file sitting
  // DIRECTLY in the OS temporary directory. The test is `parent === tmpdir`, not "somewhere under
  // tmpdir", and that distinction is the whole point: this repository is checked out at
  // <tmpdir>/blitzy/<project>/<clone> alongside its sibling clones, so a subtree test would have
  // admitted `--out ../dump.json` and `--out ../<sibling-clone>/dump.json` as "under /tmp" and written
  // into a neighbour. Requiring the file to sit directly in tmpdir admits the one destination an operator
  // actually wants — `--out /tmp/measurement.json` — and no nested path at all.
  var tmpRoot = fs.realpathSync(os.tmpdir());

  if (realParent !== tmpRoot) {
    throw new Error('capture.js: ' + label + ' ' + JSON.stringify(raw) + ' resolves to ' + target + ', which is ' +
                    'neither an in-repository blitzy_adhoc_test_<name> nor a file directly in ' + tmpRoot + '. ' +
                    'Refusing: this repository is checked out beside its sibling clones, so a path outside it ' +
                    'can land in one of them.');
  }

  return target;
}

/** True when `relative` is tracked by git. A repository with no git metadata reports nothing tracked. */
function isTrackedByGit(relative) {
  try {
    return childProcess.execFileSync('git', ['ls-files', '--error-unmatch', '--', relative], {
      cwd    : repositoryRoot(),
      stdio  : ['ignore', 'ignore', 'ignore']
    }) !== undefined;
  }
  catch (err) {
    return false;
  }
}

/**
 * The command line, parsed with node:util.parseArgs — a Node 22 built-in, so no dependency is added and
 * no hand-rolled loop is needed. `strict` is on so a mistyped flag fails loudly instead of being
 * silently ignored.
 *
 * A PLAIN RUN CAPTURES AND WRITES. That is what this file is: the harness both artifacts name in
 * metadata.regenerationOwner. Writing is safe as the default because a write is gated on being at the
 * commit metadata.baseCommit records, with a clean tracked tree and no unsanctioned configuration
 * layer — see assertWritable() — so an accidental write is impossible by construction rather than by
 * flag discipline. --write is still accepted so a script can state its intent, and --dry-run is the
 * verify mode: it writes NOTHING, which is why it refuses --out rather than quietly producing a file.
 *
 * There is no --force. Establishing a new baseline is --adopt-base-commit, which names what it does and
 * is recorded in the artifact it produces.
 */
function parseArgv(argv) {
  var parsed = nodeUtil.parseArgs({
    args   : argv,
    strict : true,
    allowPositionals : false,
    options : {
      write               : { type : 'boolean', default : false },
      quiet               : { type : 'boolean', default : false },
      'dry-run'           : { type : 'boolean', default : false },
      'routes-only'       : { type : 'boolean', default : false },
      'adopt-base-commit' : { type : 'boolean', default : false },
      out                 : { type : 'string' }
    }
  }).values;

  var dryRun = parsed['dry-run'],
      out    = parsed.out === undefined ? null : parsed.out;

  if (parsed.write && dryRun) {
    throw new Error('capture.js: --write and --dry-run contradict each other. Pass --dry-run to verify ' +
                    'without writing, or nothing at all to capture.');
  }

  if (dryRun && out !== null) {
    throw new Error('capture.js: --dry-run writes nothing at all, so --out has no meaning with it. Drop ' +
                    'one of the two.');
  }

  if (dryRun && parsed['adopt-base-commit']) {
    throw new Error('capture.js: --adopt-base-commit establishes a new baseline, which a --dry-run ' +
                    'cannot do.');
  }

  // A narrowed run measures only the route table, so it cannot produce the response corpus — and writing
  // one artifact of a pair leaves the two describing different runs.
  if (parsed['routes-only'] && !dryRun) {
    throw new Error('capture.js: --routes-only skips the HTTP corpus, so a capture cannot write the ' +
                    'artifact pair from it. Use --dry-run --routes-only to verify the route table only.');
  }

  return {
    write           : !dryRun,
    quiet           : parsed.quiet,
    dryRun          : dryRun,
    routesOnly      : parsed['routes-only'],
    adoptBaseCommit : parsed['adopt-base-commit'],
    out             : out === null ? null : validateOutPath(out)
  };
}

function reportDifferences(differences, quiet) {
  if (!differences.length) {
    console.log('capture.js: 0 differences against the committed corpus.');
    return;
  }

  console.log('capture.js: ' + differences.length + ' difference(s) against the committed corpus.');

  if (quiet) {
    return;
  }

  differences.forEach(function(difference) {
    console.log('  ' + difference.section + ' ' + difference.entry + ' :: ' + difference.field);
    console.log('    committed: ' + String(difference.expected).slice(0, 400));
    console.log('    measured : ' + String(difference.actual).slice(0, 400));
  });
}

/** The route-table half of the human-readable summary — the published anchor values for this table. */
function reportRouteTable(measured) {
  console.log('capture.js: route table rows=' + measured.gates.rowCount +
              ' methods=' + JSON.stringify(measured.gates.methods) +
              ' api=' + measured.gates.apiPaths +
              ' withPre=' + measured.gates.withPreHandlers);
  console.log('capture.js: route table auth required=' + measured.gates.authRequiredSession +
              ' false=' + measured.gates.authFalse +
              ' inheritedTry=' + measured.gates.authTryInherited +
              ' rawTally=' + JSON.stringify(measured.rawSettingsAuthTally));
  console.log('capture.js: route table sha256=' + measured.digests.measuredSha256 +
              ' (first32=' + measured.digests.measuredSha256First32 + ')');
  console.log('capture.js: route table md5=' + measured.digests.measuredMd5 +
              ' registrationOrderFingerprint=' + measured.digests.registrationOrderFingerprint);
}

/** The corpus half of the human-readable summary, in both readings the artifact publishes. */
function reportCorpus(measured) {
  console.log('capture.js: unauthenticated=' + measured.unauthenticated.length +
              ' authenticated=' + measured.authenticated.length +
              ' assignmentNext=' + (measured.assignmentNext || []).length +
              ' assetConfinement=' + (measured.assetConfinement || []).length);
  console.log('capture.js: assetConfinement statuses=' +
              JSON.stringify(assetConfinementStatusMap(measured.assetConfinement)));
  console.log('capture.js: firstHopDistribution=' +
              JSON.stringify(statusDistribution(measured.unauthenticated)) +
              ' resolvedDistribution=' +
              JSON.stringify(resolvedStatusDistribution(measured.unauthenticated)));
  console.log('capture.js: roles tokens structurally verified before normalization: ' +
              measured.rolesTokenObservations.length + ' ' +
              JSON.stringify(measured.rolesTokenObservations));
}

/**
 * Measures both halves of the parity contract, diffs them against what is committed, evaluates every gate
 * the artifacts publish, and — unless this is a --dry-run — regenerates the artifact pair.
 *
 * Resolves with the process exit code rather than exiting itself, so the single `process.exit` lives in
 * the guarded entry point below where a synchronous throw is also caught. The three codes mean exactly
 * three different things, and keeping them apart is what lets a caller tell "the code changed" from "this
 * run never checked":
 *
 *   0  every required gate was evaluated and held, and either a verification run found no difference or a
 *      capture run wrote the pair;
 *   1  a FAILED gate, or a difference found by a --dry-run verification — something to report and fix. A
 *      difference on a CAPTURE run is not a failure: it is what the regeneration changes, and it is
 *      printed as such;
 *   2  unable to run — bad or contradictory flags, an unmet precondition (app.url origin, database, git
 *      state), a refused write, an unevaluated required gate in a full run, a thrown error, or a failure
 *      to remove a throwaway identity.
 */
function main() {
  var options        = parseArgv(process.argv.slice(2)),
      committed      = loadCommittedCorpus(),
      committedTable = loadCommittedRouteTable(),
      server         = null,
      differences    = [],
      gates          = [],
      measured       = null,
      exitCode       = 0;

  // No app.url override is ever injected (constraint 3). configureRuntime owns app.start, the bind
  // address, the disposable database and the session password, and nothing else.
  configureRuntime();

  var precondition = originPrecondition(committed);

  if (!precondition.satisfied) {
    console.error('capture.js: UNABLE TO RUN — ' + precondition.remedy);

    return Promise.resolve(2);
  }

  return startServer().then(function(started) {
    server = started;
    console.log('capture.js: real HTTP against ' + server.info.uri +
                ' (this harness never calls server.inject(); the app still does — PRESERVED-QUIRKS 7.6)');
    console.log('capture.js: mode=' + (options.dryRun ? 'DRY RUN (measure and diff only)' : 'CAPTURE') +
                ' app.url origin=' + precondition.live +
                ' database=' + FORCED_DATABASE +
                ' resolution reading=cookie-less, ' + RESOLUTION.sections.join('+') + ', after ' +
                RESOLUTION.runsAfter);

    var routeTable = captureRouteTable(server);

    differences = differences.concat(compareRouteTable(committedTable, routeTable));
    gates       = gates.concat(routeTableGates(committedTable, routeTable));
    reportRouteTable(routeTable);

    if (options.routesOnly) {
      gates.push(unevaluatedGate('corpus (58 + 7 + 8 entries)',
                                 '--routes-only: the HTTP corpus was deliberately not walked'));

      return routeTable;
    }

    return captureCorpus(server, committed).then(function(result) {
      measured    = result;
      differences = differences.concat(compareCorpus(committed, measured));
      gates       = gates
        .concat(corpusGates(committed, measured, liveAppUrlOrigin()))
        .concat(cookieContractGates(committed, measured))
        .concat(assetConfinementGates(committed, measured));
      reportCorpus(measured);

      return routeTable;
    });
  }).then(function(routeTable) {
    var buildArtifacts = measureBuildArtifacts();

    gates = gates.concat(buildArtifactGates(committed, buildArtifacts));

    reportDifferences(differences, options.quiet);
    console.log('capture.js: gate summary — every expectation below is read from the committed ' +
                'artifacts and every measured value is recomputed from this run:');

    var tally = printGateSummary(gates, options.quiet);

    if (tally.fail) {
      exitCode = 1;
    }

    // A DIFFERENCE is a verification outcome, so it decides the exit code of a verification run. On a
    // CAPTURE run it is the point of the exercise — the measurement is expected to differ from the
    // artifact being replaced — so it is reported prominently and the exit code is decided by whether the
    // write happened and whether the published gates held.
    if (differences.length && options.dryRun) {
      exitCode = 1;
    }
    else if (differences.length) {
      console.log('capture.js: the ' + differences.length + ' difference(s) above are what this ' +
                  'regeneration changes relative to the artifact it replaces. Read them: a difference ' +
                  'that was not intended is a defect, not a new baseline.');
    }

    // MISSING EVIDENCE IS NOT A PASS. A full run that could not evaluate a
    // gate has not verified the thing that gate exists to verify, so it reports unable-to-run rather than
    // success. Only an explicitly narrowed run tolerates it, and only for the halves it narrowed away.
    if (tally.unevaluated && !options.routesOnly) {
      console.error('capture.js: UNABLE TO RUN — ' + tally.unevaluated + ' required gate(s) could not ' +
                    'be evaluated in a full run, so this run has not verified parity. Each one names its ' +
                    'reason above; the usual cause is an unbuilt checkout (hydrate public/components, ' +
                    'then `npm run build`).');
      exitCode = 2;
    }
    else if (tally.unevaluated) {
      console.log('capture.js: ' + tally.unevaluated + ' gate(s) UNEVALUATED, which this narrowed ' +
                  '--routes-only run tolerates. A full run does not.');
    }

    if (options.out) {
      // Validated by parseArgv before anything was captured, and created exclusively so a race cannot
      // clobber.
      fs.writeFileSync(options.out, JSON.stringify(measured || { routeTable : routeTable }, null, 2) +
                       '\n', { encoding : 'utf8', flag : 'wx' });
      console.log('capture.js: measurement written to ' + options.out);
    }

    if (!options.write) {
      console.log('capture.js: DRY RUN — nothing was written' +
                  (differences.length
                    ? '. Every difference above is either an application-code defect or a harness ' +
                      'defect; it must be reported, not written over.'
                    : ' and nothing differed.'));

      return undefined;
    }

    var writable = assertWritable(committed, options);

    // A refusal exits 2: the run was asked to capture and produced no evidence, which is neither parity
    // nor a difference. There is no --force.
    if (!writable.allowed) {
      console.error('capture.js: REFUSING to write — ' + writable.reason);
      exitCode = 2;

      return undefined;
    }

    if (tally.fail) {
      console.error('capture.js: REFUSING to write. ' + tally.fail + ' gate(s) FAILED above, so this ' +
                    'measurement contradicts the contract the artifacts publish — that is a regression ' +
                    'to report, not a new baseline.');
      exitCode = 1;

      return undefined;
    }

    if (writable.adopting) {
      console.log('capture.js: ADOPTING ' + writable.state.head + ' as the new baseline commit. The ' +
                  'previous baseline (' + committed.metadata.baseCommit + ') is being replaced on ' +
                  'purpose, and metadata.baseCommit will say so.');
    }

    var provenance = {
          node               : process.version,
          npm                : npmVersion(),
          nodeEnv            : process.env.NODE_ENV,
          nodeConfigOverride : effectiveNodeConfig(),
          captureCommit      : writable.state.head,
          gitState           : {
            trackedModifications : writable.state.trackedModifications.length,
            untracked            : writable.state.untracked,
            // Always [] in a written artifact, because assertWritable() refuses otherwise. It is
            // recorded rather than omitted so the artifact states the absence as an observed fact
            // instead of leaving a reader to infer it from a rule.
            configLayers         : writable.state.configLayers
          },
          gitStatusClean     : writable.state.trackedModifications.length === 0,
          database           : FORCED_DATABASE,
          dependencyVersions : installedDependencyVersions(
            Object.keys(committed.metadata.dependencyVersions || {})),
          adopting           : writable.adopting
        },
        table  = mergeMeasuredRouteTable(committedTable, routeTable),
        corpus = mergeMeasuredIntoCommitted(committed, measured, buildArtifacts, provenance),
        counts = reproducedCounts(routeTable, measured);

    // The reproduced section sizes are written into BOTH artifacts from this run's own counts, so the
    // provenance block states an observed fact rather than a transcribed one.
    recordReproducedCounts(table.artifact, counts);
    recordReproducedCounts(corpus.artifact, counts);

    // Both artifacts or neither.
    writeArtifactPair(table.artifact, corpus.artifact);
    console.log('capture.js: wrote ' + ROUTE_TABLE_PATH + ' and ' + ARTIFACT_PATH + ' atomically');
    console.log('capture.js: provenance recorded — node ' + provenance.node + ', npm ' + provenance.npm +
                ', commit ' + provenance.captureCommit + ', database ' + provenance.database +
                ', tracked modifications ' + provenance.gitState.trackedModifications +
                ', untracked paths ' + provenance.gitState.untracked.length +
                ', gitignored configuration layers ' + provenance.gitState.configLayers.length);
    console.log('capture.js: recomputed route-table gates rowCount, methods, apiPaths, ' +
                'withPreHandlers, authRequiredSession, authFalse, authTryInherited and the four ' +
                'digests, plus every row. NOT recomputed (hand-derived, verify by hand if the surface ' +
                'changed): ' + table.notRecomputed.join(', '));
    console.log('capture.js: corpus arrays rebuilt from the ' +
                (measured.unauthenticated.length + measured.authenticated.length +
                 measured.assignmentNext.length) + ' MEASURED entries; ' + corpus.carried.prose +
                ' notes carried across by identity' +
                (corpus.carried.withoutProse.length
                  ? '; ' + corpus.carried.withoutProse.length + ' measured entry/entries had no ' +
                    'recorded prose: ' + corpus.carried.withoutProse.join(', ')
                  : '') +
                (corpus.carried.dropped.length
                  ? '; ' + corpus.carried.dropped.length + ' recorded entry/entries were NOT measured ' +
                    'and have been dropped: ' + corpus.carried.dropped.join(', ')
                  : ''));
    console.log('capture.js: recomputed corpus gates measuredDistribution, unauthenticatedEntryCount, ' +
                'authenticatedEntryCount, the two status distributions, the hop histogram, the ' +
                'redirect and assignment maps and selectionRule.actualCount. NOT recomputed ' +
                '(hand-derived, verify by hand if the surface changed): ' +
                corpus.notRecomputed.join(', '));

    return undefined;
  }).catch(function(err) {
    // ONE terminal handler for the whole chain, attached after the steps that can throw rather than
    // beside them, so a failing artifact write still reaches stopServer() instead of leaving the process
    // holding a listening socket.
    console.error('capture.js: FAILED — ' + (err && err.stack ? err.stack : err));
    exitCode = 2;
  }).then(function() {
    return stopServer(server);
  }).then(function() {
    var failures = cleanupErrors();

    if (failures.length) {
      // A capture that could not remove an identity it created has polluted the database it was given.
      // That is an operational failure, not a difference, and it must not be reported as success.
      console.error('capture.js: UNABLE TO RUN CLEANLY — ' + failures.length + ' cleanup failure(s): ' +
                    failures.join('; '));
      exitCode = 2;
    }

    return exitCode;
  });
}

module.exports = {
  ARTIFACT_PATH            : ARTIFACT_PATH,
  ROUTE_TABLE_PATH         : ROUTE_TABLE_PATH,
  POLICY                   : POLICY,
  RUNTIME                  : RUNTIME,
  DISPOSABLE_DATABASE      : DISPOSABLE_DATABASE,
  // Re-exported rather than re-declared, so a test can assert that this CLI and test/helpers/db.js
  // enforce the identical endpoint rule rather than two lookalikes.
  endpointGate             : endpointGate,
  THROWAWAY                : THROWAWAY,
  ASSIGNMENT               : ASSIGNMENT,
  COMPARED_FIELDS          : COMPARED_FIELDS,
  ROLES_TOKEN_INVARIANTS   : ROLES_TOKEN_INVARIANTS,
  loadCommittedCorpus      : loadCommittedCorpus,
  loadCommittedRouteTable  : loadCommittedRouteTable,
  deepMerge                : deepMerge,
  resolvePort              : resolvePort,
  resolveDatabase          : resolveDatabase,
  configureRuntime         : configureRuntime,
  effectiveNodeConfig      : effectiveNodeConfig,
  assertDisposableDatabase : assertDisposableDatabase,
  assertHarnessIdentity    : assertHarnessIdentity,
  cleanupErrors            : cleanupErrors,
  resetCleanupErrors       : resetCleanupErrors,
  cleanupIdentities        : cleanupIdentities,
  startServer              : startServer,
  stopServer               : stopServer,
  httpRequest              : httpRequest,
  redactSetCookie          : redactSetCookie,
  setCookieAttributeNames  : setCookieAttributeNames,
  normalizeResponseHeaders : normalizeResponseHeaders,
  normalizeRequestHeaders  : normalizeRequestHeaders,
  htmlNormalizationRules   : htmlNormalizationRules,
  assertRolesTokenStructure: assertRolesTokenStructure,
  normalizeHtmlBody        : normalizeHtmlBody,
  resetRolesTokenObservations : resetRolesTokenObservations,
  ROLES_TOKEN_OBSERVATIONS : ROLES_TOKEN_OBSERVATIONS,
  extractTitle             : extractTitle,
  describeBody             : describeBody,
  computeIsApiRequest      : computeIsApiRequest,
  buildEntry               : buildEntry,
  selectCorpusPaths        : selectCorpusPaths,
  captureUnauthenticated   : captureUnauthenticated,
  resolveUnauthenticated   : resolveUnauthenticated,
  findThrowawayUser        : findThrowawayUser,
  createThrowawayUser      : createThrowawayUser,
  removeThrowawayUser      : removeThrowawayUser,
  extractSessionCookie     : extractSessionCookie,
  captureAuthenticated     : captureAuthenticated,
  assignmentDestination    : assignmentDestination,
  assignmentEntryPath      : assignmentEntryPath,
  removeAssignmentSignupUser : removeAssignmentSignupUser,
  captureAssignmentNext    : captureAssignmentNext,
  assetConfinementProbes   : assetConfinementProbes,
  captureAssetConfinement  : captureAssetConfinement,
  assetConfinementStatusMap : assetConfinementStatusMap,
  assetConfinementGates    : assetConfinementGates,
  captureCorpus            : captureCorpus,
  md5                      : md5,
  liveServerAuthDefault    : liveServerAuthDefault,
  effectiveRouteAuth       : effectiveRouteAuth,
  authDescriptor           : authDescriptor,
  canonicalRow             : canonicalRow,
  canonicalizeLiveTable    : canonicalizeLiveTable,
  registrationOrderRows    : registrationOrderRows,
  registrationOrderCanonical : registrationOrderCanonical,
  routeTableDigests        : routeTableDigests,
  DOCUMENTED_DIGEST        : DOCUMENTED_DIGEST,
  documentedAnchorGate     : documentedAnchorGate,
  countableAnchorsReproduced : countableAnchorsReproduced,
  captureRouteTable        : captureRouteTable,
  compareRouteTable        : compareRouteTable,
  mergeMeasuredRouteTable  : mergeMeasuredRouteTable,
  reproducedCounts         : reproducedCounts,
  recordReproducedCounts   : recordReproducedCounts,
  pushDifference           : pushDifference,
  BUILD_ARTIFACT_FILES     : BUILD_ARTIFACT_FILES,
  mapFilesUnder            : mapFilesUnder,
  measureBuildArtifacts    : measureBuildArtifacts,
  gate                     : gate,
  unevaluatedGate          : unevaluatedGate,
  findEntry                : findEntry,
  redirectLocationKinds    : redirectLocationKinds,
  takeoverRedirectPaths    : takeoverRedirectPaths,
  cookieAttributeVariants  : cookieAttributeVariants,
  routeTableGates          : routeTableGates,
  corpusGates              : corpusGates,
  cookieContractGates      : cookieContractGates,
  buildArtifactGates       : buildArtifactGates,
  printGateSummary         : printGateSummary,
  appUrlOrigin             : appUrlOrigin,
  liveAppUrlOrigin         : liveAppUrlOrigin,
  sameOrigin               : sameOrigin,
  originPrecondition       : originPrecondition,
  compareSection           : compareSection,
  compareCorpus            : compareCorpus,
  statusDistribution       : statusDistribution,
  resolvedStatusDistribution : resolvedStatusDistribution,
  hopCountHistogram        : hopCountHistogram,
  redirectingEntryPaths    : redirectingEntryPaths,
  redirectResolutionDistribution : redirectResolutionDistribution,
  authenticatedEntryLabel  : authenticatedEntryLabel,
  authenticatedStatusMap   : authenticatedStatusMap,
  assignmentNextStatusMap  : assignmentNextStatusMap,
  assignmentNextLocationMap : assignmentNextLocationMap,
  isRedirectStatus         : isRedirectStatus,
  classifyHopTarget        : classifyHopTarget,
  followRedirectChain      : followRedirectChain,
  RESOLUTION               : RESOLUTION,
  stableStringify          : stableStringify,
  mergeMeasuredIntoCommitted: mergeMeasuredIntoCommitted,
  writeArtifactPair        : writeArtifactPair,
  entryIdentity            : entryIdentity,
  currentHeadCommit        : currentHeadCommit,
  gitState                 : gitState,
  npmVersion               : npmVersion,
  installedDependencyVersions : installedDependencyVersions,
  assertWritable           : assertWritable,
  validateOutPath          : validateOutPath,
  unreproducibleGate       : unreproducibleGate,
  parseArgv                : parseArgv,
  reportDifferences        : reportDifferences,
  reportRouteTable         : reportRouteTable,
  reportCorpus             : reportCorpus,
  main                     : main
};

// The mocha spec glob is recursive and would otherwise load this file as a spec and run a full capture on
// every `npm test`. Requiring this module must therefore be inert — no HTTP, no app.js, no datastore
// connection, no write and no process.exit happens above this line.
//
// The exit is here rather than inside main() so that one place owns it and so that a SYNCHRONOUS throw —
// a corrupt artifact, an unknown flag, --write together with --dry-run — is reported and exits rather
// than surfacing as an unhandled error. Promise.resolve().then(main) is what converts such a throw into a
// rejection this chain can see. Exiting explicitly is mandatory: the un-unref'd 60-second detectLeaks
// interval app.js installs, the module-load mongoose connection in config/db.js and the eager redis
// client each keep the event loop alive after the server has stopped, which is the same reason
// .mocharc.json carries "exit": true.
if (require.main === module) {
  Promise.resolve().then(main).then(function(exitCode) {
    process.exit(exitCode);
  }).catch(function(err) {
    // A synchronous throw before the run even starts — an unknown or contradictory flag, an unsafe --out,
    // a non-disposable database name, a corrupt artifact — is UNABLE TO RUN, not a parity difference, so
    // it exits 2 like every other precondition failure.
    console.error('capture.js: UNABLE TO RUN — ' + (err && err.message ? err.message : String(err)));

    if (process.env.BASELINE_DEBUG && err && err.stack) {
      console.error(err.stack);
    }

    process.exit(2);
  });
}
