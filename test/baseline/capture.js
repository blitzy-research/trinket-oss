/**
 * test/baseline/capture.js — the R-6 baseline capture harness.
 *
 * WHAT THIS IS
 * ------------
 * BOTH artifacts under test/baseline/ name this file in `metadata.regenerationOwner`: it is the harness
 * that owns test/baseline/route-table.json and test/baseline/responses.json in the finished repository.
 * It boots the application exactly the way they were produced, re-measures BOTH halves of the R-6
 * parity contract — the 233-row hapi route table (TR1) and the 58 + 7 + 8 entry response corpus (TR2,
 * TR3, TR4) — reports every difference, evaluates every gate the artifacts publish, and can regenerate
 * them. It is also the shared implementation library for test/baseline/replay.js and
 * test/lib/api/route-parity.js, which require() it — the `require.main === module` guard below means
 * requiring this file boots nothing and captures nothing, so a fifth file under test/baseline/ is not
 * needed.
 *
 * HARD CONSTRAINTS, all of them from AAP 0.7.5 and from the artifact's own metadata.captureNotes.
 * Every one of these is a correctness requirement, not a preference:
 *
 *   1. REAL HTTP ONLY. Requests are issued with node:http against server.info. This harness NEVER
 *      calls server.inject(): @hapi/shot/lib/request.js:L30 is the sole remaining DEP0169 source in
 *      the dependency tree, and the zero-deprecation boot gate forbids tripping it. There is no
 *      upstream fix — 6.0.3 is the latest published @hapi/shot.
 *      SCOPE OF THAT CLAIM: it is a rule about the HARNESS, not about the application. The
 *      application itself performs internal sub-requests with request.server.inject() at
 *      lib/controllers/courses.js:L24 and lib/controllers/folders.js:L50, both base-identical, so
 *      DEP0169 does fire once a route that injects is exercised. The boot gate is still clean
 *      because nothing injects during boot, and the corpus stays clean because the harness reaches
 *      the app only over a real socket. See docs/PRESERVED-QUIRKS.md section 7.6 for the full
 *      measurement and for why neither inject site may be rewritten.
 *   2. RUNTIME CONFIG OVERRIDE, NEVER A FILE EDIT. config/test.yaml:L3 sets app.start:false, so under
 *      NODE_ENV=test the server is constructed but never bound. app.start:true, the bind host, the
 *      port and the >=32-character session cookie password that app.js:L50-L66 requires are injected
 *      through NODE_CONFIG *before* app.js is required. config/test.yaml is not edited and
 *      config/local.yaml is not created: editing either would change the behavior of the existing
 *      mocha suite, which is a prohibited side effect.
 *   3. NODE_CONFIG DELIBERATELY DOES NOT TOUCH app.url. config/app.config.js:L16-L17 computes
 *      config.url from app.url.{protocol,hostname,port}, which config/default.yaml:L30-L33 fixes at
 *      https + trinket.dev + (empty). Overriding app.url would rewrite every absolute Location in the
 *      corpus and destroy the absolute-versus-relative distinction the corpus exists to prove.
 *   4. DRY RUN BY DEFAULT. Running this file measures and diffs; it does not write. Writing requires
 *      an explicit --write, and --write refuses unless HEAD is the base commit recorded in
 *      metadata.baseCommit (override with --force, which prints a loud warning). The corpus is
 *      base-commit evidence: silently overwriting it with post-migration values would destroy the
 *      only thing that makes the migration falsifiable.
 *   5. THE NORMALIZATION CONTRACT IS READ FROM THE ARTIFACT, NOT RE-DECLARED HERE. The HTML
 *      normalization rules come from responses.json#normalizationContract, so the harness and the
 *      contract cannot drift apart. The artifact's own prohibition binds this file: "Do NOT normalize
 *      away a difference in order to make a replay diff pass." The roles-token rule is therefore
 *      GATED — every match is structurally verified against cryptoParityContract before it is
 *      substituted, and a violation throws instead of being quietly erased.
 *   6. CLONE-SAFE PORT, VALIDATED AND PROVEN FREE BEFORE THE BOOT. /tmp/blitzy is a shared workspace;
 *      sibling clones hold other ports. The bind port defaults to 30112 + CLONE_INDEX and is
 *      overridable with BASELINE_PORT, which is CHECKED rather than trusted: it must be a decimal
 *      integer from 1 to 65535, and anything else stops the run with an operator-facing message
 *      instead of being coerced. An unchecked value did not fail safe — parseInt('notaport') is NaN,
 *      JSON.stringify turns NaN into null, node-config then fell back to config/default.yaml's port
 *      and the harness silently bound 3000, the port docs/setup.md documents for `node app.js`. The
 *      resolved port is then PROBED with a throwaway listener before app.js is required, so a port
 *      that is already held by a sibling clone or a development server is reported as an unusable
 *      environment rather than as a measurement.
 *   7. A VERIFY RUN REPRODUCES THE RECORDED app.url ORIGIN; A WRITE RUN MEASURES THE LIVE ONE. The
 *      corpus is origin-specific by construction — ten of its sixteen unauthenticated redirects carry an
 *      absolute Location and every rendered page embeds the site origin in its markup — so a diff taken
 *      under a different origin reports configuration, not behavior. Measured on a checkout carrying the
 *      config/local.yaml that docs/setup.md tells a developer to create (app.url =
 *      http://localhost:3000, two characters longer than https://trinket.dev): 54 differences, every one
 *      of them a two-byte body, content-length or payload shift, and zero once the recorded origin is
 *      reproduced. Reproducing it is a runtime NODE_CONFIG override — the same mechanism as the port and
 *      the session password, no YAML edited — and it is emphatically NOT a normalization: nothing in a
 *      response is rewritten, the capture conditions are restored. A --write run deliberately does the
 *      opposite, because the artifact must record the origin it was actually captured under.
 *
 * USAGE
 *   node test/baseline/capture.js                  measure both halves, diff against the committed
 *                                                  artifacts, print the gate summary, exit 1 if
 *                                                  anything differs or any evaluable gate fails
 *   node test/baseline/capture.js --dry-run         the same run, said explicitly
 *   node test/baseline/capture.js --routes-only     the route table and its gates only, no HTTP corpus
 *   node test/baseline/capture.js --quiet           summary and gates only, no per-difference detail
 *   node test/baseline/capture.js --out <path>      also write the raw measurement to <path>
 *   node test/baseline/capture.js --write           rewrite both artifacts (base commit only)
 *   node test/baseline/capture.js --write --force   rewrite anyway (destroys base-commit evidence)
 *
 * ENVIRONMENT
 *   BASELINE_PORT=<1-65535>  the bind port for this run, taking precedence over CLONE_INDEX. VALIDATED
 *                            rather than coerced (see validateBaselinePort below) and then PROBED before
 *                            app.js is required, so an unusable or occupied port stops the run with a
 *                            remedy instead of being measured or silently redirected to another port.
 *   CLONE_INDEX=<n>          offsets the clone-safe default port, 30112 + n, so sibling clones sharing
 *                            /tmp/blitzy cannot collide. A malformed value falls back to 0.
 *   NODE_CONFIG=<json>       merged UNDERNEATH the four keys configureRuntime() owns, so a caller may add
 *                            keys of its own. Use it to isolate the DATABASE, which concurrent runs
 *                            require: every run creates the same throwaway identity, so two runs sharing
 *                            one MongoDB database interfere. Give each run its own database and port:
 *                              NODE_CONFIG='{"db":{"mongo":{"database":"trinket_2"}}}' \
 *                              BASELINE_PORT=30114 node test/baseline/capture.js
 */

var childProcess = require('child_process'),
    crypto       = require('crypto'),
    fs           = require('fs'),
    http         = require('http'),
    net          = require('net'),
    path         = require('path'),
    nodeUtil     = require('node:util');

var ARTIFACT_PATH    = path.join(__dirname, 'responses.json'),
    ROUTE_TABLE_PATH = path.join(__dirname, 'route-table.json');

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
 * The runtime override, mirroring responses.json#metadata.nodeConfigOverride. The cookie password is
 * a deliberate non-secret placeholder: it is a capture-time input, not a credential. It seals
 * throwaway sessions for a throwaway user on a loopback port, and the sealed payload it produces is
 * redacted everywhere in the artifact.
 */
/**
 * The ADDITIVE redirect-resolution policy, mirroring responses.json#requestPolicy.redirectPolicy. The
 * first hop of every entry is still recorded exactly as the server answered it — POLICY.followRedirects
 * stays false and `status`, `location`, `headers` and `bodyShape` are untouched — and a SECOND pass then
 * walks the recorded Location chain to its terminal response. Both readings are kept because they answer
 * different questions: the first hop is the wire contract of the route itself, while the resolved status
 * is what a redirect-following client (which is how the Technical Specification's 25x200 / 7x401 /
 * 25x404 / 1x500 tally was produced) actually observes. The hop is only ever followed back onto the
 * process under test: a relative Location, or an absolute one whose origin is config.url or the probe
 * itself, is rewritten onto the probe origin; any other origin is recorded and never requested.
 */
var RESOLUTION = {
  follow  : true,
  maxHops : 10
};

var RESOLUTION_STATUSES = [301, 302, 303, 307, 308];

var RUNTIME = {
  hostname              : '127.0.0.1',
  defaultPort           : 30112,
  sessionCookiePassword : 'baseline-capture-placeholder-not-a-real-secret-0000'
};

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
 * The ORIGIN half is deliberately not a literal here: it is taken from the live configuration by
 * candidate() so the flow is driven against whatever origin the process is actually configured
 * for, and the comparison rebases it back onto metadata.appUrlOrigin (see rebaseEntryOrigin).
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

// ---------------------------------------------------------------------------------------------
// Committed artifacts
// ---------------------------------------------------------------------------------------------

function loadCommittedCorpus() {
  return JSON.parse(fs.readFileSync(ARTIFACT_PATH, 'utf8'));
}

function loadCommittedRouteTable() {
  return JSON.parse(fs.readFileSync(ROUTE_TABLE_PATH, 'utf8'));
}

// ---------------------------------------------------------------------------------------------
// Runtime configuration — must run before anything requires `config` or `app.js`
// ---------------------------------------------------------------------------------------------

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
 * A failure of a PRECONDITION rather than of a measurement: the run could not be attempted at all, so
 * nothing about the application was proven or disproven. The marker property is deliberately the same
 * one test/baseline/replay.js#isPreconditionFailure reads, and that shared marker is the whole bridge
 * between the two exit contracts: replay.js publishes a separate could-not-run code (2) and maps one of
 * these onto it, while this file publishes only 0 and 1 and reports one as a curated message instead of
 * a stack trace. Neither tool has to guess what the other meant.
 */
function preconditionFailure(message) {
  var failure = new Error(message);

  failure.baselinePrecondition = true;

  return failure;
}

function isPreconditionFailure(err) {
  return !!(err && err.baselinePrecondition);
}

/**
 * Prints one failure for the operator who has to act on it. A precondition failure carries text written
 * for exactly that reader, so it is printed as written; everything else keeps the stack it arrived with,
 * because a defect in the harness or the application is read by a developer. This preserves the existing
 * reporting of every non-precondition path — a mistyped flag still prints its stack, as this file's
 * documented contract says it does.
 */
function reportFailure(err) {
  if (isPreconditionFailure(err)) {
    console.error(err.message);

    return;
  }

  console.error('capture.js: FAILED — ' + (err && err.stack ? err.stack : String(err)));
}

/**
 * Validates one BASELINE_PORT value. parseInt is deliberately NOT used: it accepts '30150.5', '3015x'
 * and '0x7530' and silently returns a different port than the operator asked for, and it returns NaN for
 * a word — which is the value that used to reach JSON.stringify, serialize as null, and hand the harness
 * config/default.yaml's port 3000. A port is therefore accepted only in the one form a port has: decimal
 * digits inside the assignable range.
 */
function validateBaselinePort(raw) {
  var trimmed = String(raw).trim(),
      port    = /^[0-9]+$/.test(trimmed) ? Number(trimmed) : NaN;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw preconditionFailure('capture.js: BASELINE_PORT=' + JSON.stringify(String(raw)) + ' is not a ' +
                              'usable TCP port, so the run was not started. Pass a decimal integer ' +
                              'from 1 to 65535, or unset BASELINE_PORT to take the clone-safe default ' +
                              RUNTIME.defaultPort + ' + CLONE_INDEX (= ' + resolveCloneIndex() +
                              ' here, so port ' + (RUNTIME.defaultPort + resolveCloneIndex()) + '). ' +
                              'Refusing to continue rather than coercing the value: an unusable port ' +
                              'used to be neutralized silently and the harness then bound ' +
                              'config/default.yaml\'s port 3000 — the port docs/setup.md documents ' +
                              'for `node app.js` — inside the shared /tmp/blitzy workspace.');
  }

  return port;
}

/** The clone offset. A malformed CLONE_INDEX has always fallen back to 0, and still does. */
function resolveCloneIndex() {
  var cloneIndex = parseInt(process.env.CLONE_INDEX || '0', 10);

  return isNaN(cloneIndex) ? 0 : cloneIndex;
}

/**
 * The bind port. A validated BASELINE_PORT wins; otherwise 30112 (the port recorded in
 * metadata.serverUri) is offset by CLONE_INDEX so parallel clones under the shared /tmp/blitzy
 * workspace cannot collide. An empty or whitespace-only BASELINE_PORT means "not set" — the shell
 * convention for an unset variable — and takes the clone-safe default, which is the one fallback that
 * can never resolve to an unrelated port. Every other malformed value throws.
 *
 * The port is not part of the corpus: config.url is https://trinket.dev regardless of the bind port,
 * and normalizationContract.mayBeNormalized explicitly permits "the ephemeral port inside any
 * self-referential URL".
 */
function resolvePort() {
  if (process.env.BASELINE_PORT !== undefined && String(process.env.BASELINE_PORT).trim() !== '') {
    return validateBaselinePort(process.env.BASELINE_PORT);
  }

  return RUNTIME.defaultPort + resolveCloneIndex();
}

/**
 * Injects the runtime override into NODE_CONFIG. Any NODE_CONFIG the caller already exported is used
 * as the base and merged, so an outer harness can add its own keys; the four keys this function owns
 * (app.start, app.hostname, app.port and the session cookie password) always win, because the capture
 * cannot happen without them. MUST be called before startServer(), i.e. before `config` is required.
 */
function configureRuntime(extraOverrides) {
  process.env.NODE_ENV = 'test';
  process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';

  var base = {};

  if (process.env.NODE_CONFIG) {
    base = JSON.parse(process.env.NODE_CONFIG);
  }

  var merged = deepMerge(deepMerge(base, extraOverrides || {}), {
    app : {
      start    : true,
      hostname : RUNTIME.hostname,
      port     : resolvePort(),
      plugins  : {
        session : {
          cookieOptions : { password : RUNTIME.sessionCookiePassword }
        }
      }
    }
  });

  process.env.NODE_CONFIG = JSON.stringify(merged);

  return merged;
}

/**
 * Proves the bind port is actually available, BEFORE app.js is required. This exists because of where
 * the application puts its own boot failure: app.js:L357-L360 catches anything init() throws, logs it
 * and calls process.exit(1) itself, so a port that is already taken terminates the process from inside
 * app.js and never surfaces as a rejection either CLI can classify. That behavior is AAP-preserved and
 * may not be changed, so the common cause is detected one step earlier instead, where it is still an
 * ordinary rejection carrying an operator-facing remedy.
 *
 * The probe is a throwaway listener on the same host and port the boot will use. It is unref'd so it can
 * never hold the event loop open, `exclusive` so a shared handle cannot mask a conflict, and closed
 * before the promise settles. Re-binding immediately afterwards is safe: a listening socket that never
 * accepted a connection leaves no TIME_WAIT state, and libuv sets SO_REUSEADDR on every TCP listener.
 */
function assertPortAvailable(port, hostname) {
  return new Promise(function(resolve, reject) {
    var probe = net.createServer();

    probe.unref();

    probe.once('error', function(err) {
      var code = (err && err.code) || 'unknown';

      if (code === 'EADDRINUSE') {
        reject(preconditionFailure('capture.js: ' + hostname + ':' + port + ' is already in use, so ' +
                                   'the application cannot bind it and no measurement was taken. ' +
                                   '/tmp/blitzy is a shared workspace: a sibling clone, a `node ' +
                                   'app.js` development server or a previous run may hold it. Free ' +
                                   'the port, or move this run with BASELINE_PORT=<1-65535> or ' +
                                   'CLONE_INDEX=<n> (which selects ' + RUNTIME.defaultPort + ' + n).'));

        return;
      }

      reject(preconditionFailure('capture.js: ' + hostname + ':' + port + ' cannot be bound (' + code +
                                 ': ' + (err && err.message ? err.message : String(err)) + '), so no ' +
                                 'measurement was taken. Choose a bindable port with ' +
                                 'BASELINE_PORT=<1-65535>.'));
    });

    probe.listen({ host : hostname, port : port, exclusive : true }, function() {
      probe.close(function() {
        resolve(port);
      });
    });
  });
}

/**
 * Boots the application. app.js:L356 exports the promise returned by init(), which resolves to the
 * started hapi server. Requiring app.js is what creates the nine implicit model globals the capture
 * needs (User in particular), so this must complete before createThrowawayUser() runs.
 *
 * The port is resolved and probed first, and it is resolved from the same two values configureRuntime()
 * injected — resolvePort() and RUNTIME.hostname — so the probe cannot check one port while the boot
 * binds another. This is the single boot procedure under test/baseline/: test/baseline/replay.js calls
 * it rather than restating it, so both CLIs classify an unusable port identically.
 */
function startServer() {
  var port = resolvePort();

  return assertPortAvailable(port, RUNTIME.hostname).then(function() {
    return Promise.resolve(require('../../app.js'));
  }).then(function(server) {
    if (!server || !server.info || !server.info.uri) {
      throw preconditionFailure('capture.js: the application booted but did not expose a listening ' +
                                'server, so no measurement was taken. app.start was not honoured — ' +
                                'check that configureRuntime() ran before startServer(), which is ' +
                                'what injects app.start:true through NODE_CONFIG over ' +
                                'config/test.yaml\'s app.start:false.');
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

// ---------------------------------------------------------------------------------------------
// Real HTTP
// ---------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------
// Header normalization
// ---------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------
// HTML body normalization — rules read from the artifact, roles-token matches structurally gated
// ---------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------
// Body shape
// ---------------------------------------------------------------------------------------------

function extractTitle(html) {
  var match = /<title>([\s\S]*?)<\/title>/i.exec(html);

  return match ? match[1].trim() : null;
}

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The three body kinds the corpus records — html, json and empty — reproduced exactly. HTML bodies
 * are never stored verbatim: raw HTML digests were measured to differ between identical runs, so only
 * the normalized digest, the byte counts, the <title> and three structural markers are recorded.
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


// ---------------------------------------------------------------------------------------------
// Redirect resolution — the additive second pass (responses.json#requestPolicy.redirectPolicy)
// ---------------------------------------------------------------------------------------------

function isRedirectStatus(status) {
  return RESOLUTION_STATUSES.indexOf(status) !== -1;
}

/**
 * Decides whether one Location can be followed without leaving the process under test, and what it maps
 * onto. Three shapes are followable — a relative path, an absolute URL on the configured origin, and an
 * absolute URL on the probe's own origin — and everything else is recorded with `target : null`, which
 * stops the chain with `stoppedBecause : "off-site"`.
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

  var origins = [
    { origin : configOrigin, mappedBy : 'config.url origin' },
    { origin : probeOrigin,  mappedBy : 'probe origin' }
  ];

  for (var index = 0; index < origins.length; index++) {
    var candidate = origins[index];

    if (candidate.origin && location.indexOf(candidate.origin) === 0) {
      return {
        kind     : 'absolute',
        mappedBy : candidate.mappedBy,
        target   : location.slice(candidate.origin.length) || '/'
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
 * and `curl -L` do), an already-visited URL is recorded but not re-requested, and the cookie the caller
 * pins is sent on every hop so an authenticated chain stays authenticated.
 */
function followRedirectChain(server, seed, options) {
  var settings     = options || {},
      cookie       = settings.cookie || null,
      configOrigin = liveAppUrlOrigin(),
      probeOrigin  = server.info.uri,
      chain        = [],
      visited      = {},
      hops         = 0,
      state        = {
        status      : seed.response.status,
        statusText  : seed.response.statusText,
        headers     : seed.response.headers,
        body        : seed.response.body,
        requested   : seed.path,
        method      : seed.method
      };

  visited[seed.method + ' ' + seed.path] = true;

  function terminate(stoppedBecause) {
    var shape = describeResolvedBody(state.headers['content-type'] || null, state.body);

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
      method  : 'GET',
      path    : target.target,
      headers : cookie ? { cookie : cookie } : {}
    }).then(function(response) {
      state = {
        status     : response.status,
        statusText : response.statusText,
        headers    : response.headers,
        body       : response.body,
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


// ---------------------------------------------------------------------------------------------
// Corpus selection and capture
// ---------------------------------------------------------------------------------------------

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

function captureUnauthenticated(server, paths, rules) {
  var entries = [];

  return paths.reduce(function(chain, requestPath) {
    return chain.then(function() {
      return httpRequest(server, { method : 'GET', path : requestPath });
    }).then(function(response) {
      var entry = buildEntry('GET', requestPath, response, rules);

      // No cookie on any hop, so a 3xx to /login resolves to the UNAUTHENTICATED login page.
      return followRedirectChain(server, {
        method   : 'GET',
        path     : requestPath,
        response : response
      }).then(function(resolution) {
        entries.push(attachResolution(entry, resolution));
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

function removeThrowawayUser() {
  return findThrowawayUser().then(function(existing) {
    return existing ? existing.remove() : undefined;
  }).catch(function() {
    return undefined;
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
 *   [5] GET /account authenticated — the measured RELATIVE redirect;
 *   [6] GET /logout  authenticated — LAST, because it clears the session.
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

    // Each POST /login flow adopts the Set-Cookie of its OWN first hop, which is what makes the
    // resolved /home body carry the post-login flash and the resolved /login body the validation flash.
    return followRedirectChain(server, {
      method   : 'POST',
      path     : '/login',
      response : response
    }, { cookie : cookie }).then(function(resolution) {
      entries.push(attachResolution(entry, resolution));

      return httpRequest(server, {
        method      : 'POST',
        path        : '/login',
        payload     : wrongPayload,
        contentType : 'application/json'
      });
    });
  }).then(function(response) {
    var entry = buildEntry('POST', '/login', response, rules, 'login-flow (invalid credentials)');

    return followRedirectChain(server, {
      method   : 'POST',
      path     : '/login',
      response : response
    }, { cookie : extractSessionCookie(response) }).then(function(resolution) {
      entries.push(attachResolution(entry, resolution));

      return ['/login', '/signup', '/home', '/account', '/logout'].reduce(function(chain, requestPath) {
        return chain.then(function() {
          return httpRequest(server, { method : 'GET', path : requestPath, headers : { cookie : cookie } });
        }).then(function(response) {
          var authEntry = buildEntry('GET', requestPath, response, rules, 'authenticated');

          return followRedirectChain(server, {
            method   : 'GET',
            path     : requestPath,
            response : response
          }, { cookie : cookie }).then(function(resolution) {
            entries.push(attachResolution(authEntry, resolution));
          });
        });
      }, Promise.resolve());
    });
  }).then(function() {
    return removeThrowawayUser();
  }, function(err) {
    return removeThrowawayUser().then(function() { throw err; });
  }).then(function() {
    return entries;
  });
}

// ---------------------------------------------------------------------------------------------
// The assignment `next` supplement (review finding P3-1)
// ---------------------------------------------------------------------------------------------

/** The absolute same-origin destination the frozen assignment UI would send, on the live origin. */
function assignmentDestination() {
  return liveAppUrlOrigin() + ASSIGNMENT.destinationPath;
}

/** `/login?next=<percent-encoded candidate>`, exactly as trinketConfig.getUrl builds it. */
function assignmentEntryPath(page, candidate) {
  return page + '?next=' + encodeURIComponent(candidate);
}

/** Removes the signup identity, so the signup leg starts from the same state on every run. */
function removeAssignmentSignupUser() {
  return Promise.resolve(User.findById(ASSIGNMENT.signup.email)).then(function(existing) {
    return existing ? existing.remove() : undefined;
  }).catch(function() {
    return undefined;
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
 * The assignment `next` supplement, in exactly the recorded order. Every entry here is a case the
 * migrated tree must reproduce byte-for-byte; the three deliberate SEC-4 deviations (off-origin and
 * scheme-relative destinations, which the base commit echoed straight back) are recorded in
 * responses.json#assignmentNextContract.securityDeviations and asserted live by
 * test/lib/api/route-parity.js instead, because by construction they do NOT replay.
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
    return removeAssignmentSignupUser();
  }, function(err) {
    return removeAssignmentSignupUser().then(function() { throw err; });
  }).then(function() {
    return removeThrowawayUser();
  }).then(function() {
    return entries;
  });
}

/**
 * Measures the whole corpus: the 58 parameterless GETs, the 7-entry authenticated supplement and the
 * 8-entry assignment `next` supplement. The order is contractual — the assignment supplement runs
 * LAST because it creates and removes two identities of its own, and running it before the
 * authenticated supplement would leave a different datastore behind than the one that was recorded.
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
    measured.assignmentNext         = entries;
    measured.rolesTokenObservations = ROLES_TOKEN_OBSERVATIONS.slice();
    measured.finishedAt             = new Date().toISOString();

    return measured;
  });
}

// ---------------------------------------------------------------------------------------------
// Route table — the other artifact this harness owns (test/baseline/route-table.json)
// ---------------------------------------------------------------------------------------------

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
 * Measures the whole route table. Synchronous by nature — the table is already in memory once the
 * server has started, and no HTTP is involved — so this runs before the corpus walk and its result is
 * available even under --routes-only.
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
 * and manufacturing a match for it would be exactly the kind of evidence-tampering R-6 forbids.
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
                       'measuredMd5', 'registrationOrderFingerprint'],
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

  Object.keys(merged.gates).forEach(function(key) {
    if (recomputed.indexOf(key) === -1) {
      notRecomputed.push(key);
    }
  });

  return { artifact : merged, notRecomputed : notRecomputed };
}

function writeRouteTable(artifact) {
  fs.writeFileSync(ROUTE_TABLE_PATH, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------------------------
// Comparison — shared with test/baseline/replay.js
// ---------------------------------------------------------------------------------------------

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
// ---------------------------------------------------------------------------------------------
// Location origin — deployment configuration, not behavior
// ---------------------------------------------------------------------------------------------

/**
 * Ten of the sixteen recorded redirects carry an ABSOLUTE Location, and the origin in it comes from
 * `config.app.url` by way of lib/http/redirect.js. That origin is deployment configuration rather than
 * behavior, and the shipped configuration disagrees with itself about it on purpose: `config/default.yaml`
 * declares `https` + `trinket.dev` with no port, while `config/local.example.yaml` — the file
 * `docs/setup.md` tells a developer to copy to `config/local.yaml` — declares `http` + `localhost` + 3000,
 * and node-config loads `local.yaml` last. The corpus was captured under the default origin, recorded in
 * `metadata.appUrlOrigin`.
 *
 * Comparing the literal Location string would therefore fail on a correctly configured developer
 * checkout while nothing about routing had changed — a false parity failure. The comparison is made
 * origin-relative instead: the measured origin is rewritten to the origin the corpus was captured under
 * before the strings are compared. Nothing is weakened by this. The absolute-versus-relative
 * distinction is still asserted, because a relative Location has no origin to rewrite and an absolute
 * one that lost its origin no longer matches; the path, query and fragment are still compared byte for
 * byte; and `gates.absoluteRedirectCount` / `gates.relativeRedirectCount` still pin the 10/6 split.
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
 * The corpus origin expressed as a config.app.url override, for a VERIFY run. This is how constraint 7
 * in the file header is implemented: the recorded metadata.appUrlOrigin is turned back into the
 * { protocol, hostname, port } shape config/app.config.js:L16-L17 reads and injected through
 * NODE_CONFIG, so the diff measures behavior instead of measuring which config/local.yaml the checkout
 * happens to carry. Parsing uses the NON-THROWING static URL.parse and handles its null: url.parse()
 * warns under --pending-deprecation and `new URL(x)` throws ERR_INVALID_URL, and a corpus that predates
 * the key must still replay exactly as it did, which an empty override guarantees.
 */
function corpusOriginOverride(committedCorpus) {
  var origin = committedCorpus && committedCorpus.metadata && committedCorpus.metadata.appUrlOrigin,
      parsed = origin ? URL.parse(origin) : null;

  if (!parsed) {
    return {};
  }

  return {
    app : {
      url : {
        protocol : parsed.protocol.replace(/:$/, ''),
        hostname : parsed.hostname,
        port     : parsed.port === '' ? null : Number(parsed.port)
      }
    }
  };
}

/** Rewrites a leading `fromOrigin` to `toOrigin`. Relative values and other origins pass through. */
function rebaseOrigin(value, fromOrigin, toOrigin) {
  if (typeof value !== 'string' || !fromOrigin || !toOrigin || fromOrigin === toOrigin) {
    return value;
  }

  return value.indexOf(fromOrigin) === 0 ? toOrigin + value.slice(fromOrigin.length) : value;
}

/**
 * The same rewrite for an origin that is EMBEDDED in a value rather than leading it, in both the raw
 * and the percent-encoded spelling. Only the assignment `next` entries need it: their request path
 * carries the destination in its query string, so `/login?next=https%3A%2F%2Ftrinket.dev%2Fu%2F…`
 * would otherwise be compared against an origin the process was never configured for. Exactly the
 * origin is rewritten and nothing else, so the path, query and fragment of the destination stay
 * byte-compared — including the percent-encoding itself, which is part of what the frozen producer
 * emits.
 */
function rebaseEmbeddedOrigin(value, fromOrigin, toOrigin) {
  if (typeof value !== 'string' || !fromOrigin || !toOrigin || fromOrigin === toOrigin) {
    return value;
  }

  return value
    .split(fromOrigin).join(toOrigin)
    .split(encodeURIComponent(fromOrigin)).join(encodeURIComponent(toOrigin));
}

/**
 * A shallow copy of one measured entry with every Location rebased onto the corpus origin. Both places a
 * Location appears are covered: the dedicated `location` field and the `headers` bag, which
 * normalizeResponseHeaders() deliberately keeps literal.
 */
function rebaseEntryOrigin(entry, fromOrigin, toOrigin) {
  if (!entry || !fromOrigin || !toOrigin || fromOrigin === toOrigin) {
    return entry;
  }

  var copy = {};

  Object.keys(entry).forEach(function(key) { copy[key] = entry[key]; });

  copy.location = rebaseOrigin(entry.location, fromOrigin, toOrigin);
  // The request path carries an origin only in the assignment `next` entries; for every other entry
  // this is a no-op, because no other recorded path contains one.
  copy.path     = rebaseEmbeddedOrigin(entry.path, fromOrigin, toOrigin);

  if (Array.isArray(entry.redirectChain)) {
    copy.redirectChain = entry.redirectChain.map(function(hop) {
      var rebased = {};

      Object.keys(hop).forEach(function(key) { rebased[key] = hop[key]; });
      rebased.location = rebaseOrigin(hop.location, fromOrigin, toOrigin);

      return rebased;
    });
  }

  if (entry.headers && typeof entry.headers.location === 'string') {
    var headers = {};

    Object.keys(entry.headers).forEach(function(key) { headers[key] = entry.headers[key]; });
    headers.location = rebaseOrigin(entry.headers.location, fromOrigin, toOrigin);
    copy.headers     = headers;
  }

  return copy;
}

function compareSection(section, committedEntries, measuredEntries, originRebase) {
  var differences = [],
      length      = Math.max(committedEntries.length, measuredEntries.length);

  for (var index = 0; index < length; index++) {
    var committed = committedEntries[index],
        measured  = measuredEntries[index];

    if (originRebase) {
      measured = rebaseEntryOrigin(measured, originRebase.from, originRebase.to);
    }

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

function compareCorpus(committed, measured) {
  var rebase = {
    from : liveAppUrlOrigin(),
    to   : (committed.metadata && committed.metadata.appUrlOrigin) || null
  };

  return compareSection('unauthenticated', committed.unauthenticated, measured.unauthenticated, rebase)
    .concat(compareSection('authenticated', committed.authenticated, measured.authenticated, rebase))
    // The assignment supplement is compared exactly as hard as the other two sections. An older
    // artifact that predates the section has no entries to compare, and `|| []` keeps it replayable
    // rather than reporting eight phantom differences.
    .concat(compareSection('assignmentNext', committed.assignmentNext || [],
                           measured.assignmentNext || [], rebase));
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

/** label -> status map for the authenticated supplement, in either reading. */
function authenticatedStatusMap(entries, reading) {
  var map = {};

  entries.forEach(function(entry) {
    map[authenticatedEntryLabel(entry)] = reading === 'resolved' && entry.resolved
      ? entry.resolved.status
      : entry.status;
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
 * `<state> -> <Location>` for the assignment supplement. This is the gate the P3-1 regression would
 * have tripped: the two consuming hops carry the destination itself, and a build that discarded it
 * would answer the declared success.redirect here instead.
 */
function assignmentNextLocationMap(entries) {
  var map = {};

  (entries || []).forEach(function(entry) {
    map[String(entry.state || '')] = entry.location;
  });

  return map;
}


// ---------------------------------------------------------------------------------------------
// Build artifacts — the two CSS files the corpus pins in responses.json#buildArtifacts
// ---------------------------------------------------------------------------------------------

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
 * Measures the two build artifacts and the source-map count. Absence is a MEASUREMENT, not an error:
 * `npm run build` fails on a clean checkout until public/components is hydrated from the
 * public-components.tgz asset of release v1.1.0, which responses.json#buildArtifacts.precondition
 * records. A missing file is therefore reported as an unevaluated gate carrying that precondition, never
 * as a silent skip and never as a parity failure — the two are different claims and conflating them
 * would let a genuinely changed stylesheet hide behind a checkout that simply had not been built.
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

// ---------------------------------------------------------------------------------------------
// Gates — the artifacts' own published values, recomputed from the measurement
// ---------------------------------------------------------------------------------------------

/**
 * A gate is a named triple of an expectation the artifact publishes, the value recomputed from this
 * run, and a verdict. Three verdicts exist and the third one matters: UNEVALUATED means the run could
 * not measure the input at all (an unbuilt stylesheet, a corpus half skipped by --routes-only). It is
 * reported loudly and never counted as a pass, which is what keeps "the gate held" and "the gate was
 * never checked" from collapsing into the same summary line.
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

/** The redirecting entries split by whether their Location is absolute on `origin` or relative. */
function redirectLocationKinds(entries, origin) {
  var kinds = { absolute : [], relative : [], other : [] };

  entries.filter(function(entry) {
    return isRedirectStatus(entry.status);
  }).forEach(function(entry) {
    var location = entry.location;

    if (typeof location === 'string' && origin && location.indexOf(origin) === 0) {
      kinds.absolute.push(location);
    }
    else if (typeof location === 'string' && location.charAt(0) === '/') {
      kinds.relative.push(location);
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

  // The Technical Specification's published digest is 32 hex characters and this artifact could never
  // reproduce it: gates.documentedDigestReproduced is the literal string "none". It is surfaced as
  // UNEVALUATED rather than compared, because the one thing that must never happen is a run that
  // manufactures agreement with it.
  gates.push(unevaluatedGate('route-table gates.documentedDigest (' +
                             committedTable.gates.documentedDigest + ')',
                             'recorded as unreproducible — documentedDigestReproduced="' +
                             committedTable.gates.documentedDigestReproduced + '"; the measured ' +
                             'fingerprints above are the subordinate regression gate'));

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
    gate('corpus serverErrorEntryCount (1x500)', published.serverErrorEntryCount, serverErrors.length),
    gate('corpus singleServerErrorRoute', published.singleServerErrorRoute,
         serverErrors.length === 1 ? serverErrors[0].method + ' ' + serverErrors[0].path : null),
    // R-5 evidence: the pre-existing 500 is Boom JSON rather than a rendered 50x.html, because /api/ is
    // an API request. The body KIND is the assertion; the message is scrubbed by hapi either way.
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
    // The flagship R-6 quirk: authenticated GET /login and GET /signup are 500, not 302. A 302 here is a
    // lib/controllers/pages.js conversion defect, never a corpus to be adjusted.
    gate('corpus authenticatedLoginStatus (500 quirk)', published.authenticatedLoginStatus,
         statusOf(authenticated, 'GET', '/login', 'authenticated')),
    gate('corpus authenticatedSignupStatus (500 quirk)', published.authenticatedSignupStatus,
         statusOf(authenticated, 'GET', '/signup', 'authenticated')),
    gate('corpus authenticatedHomeStatus', published.authenticatedHomeStatus,
         statusOf(authenticated, 'GET', '/home', 'authenticated')),
    gate('corpus authenticatedAccountStatus', published.authenticatedAccountStatus,
         statusOf(authenticated, 'GET', '/account', 'authenticated')),
    gate('corpus authenticatedFirstHopStatuses', published.authenticatedFirstHopStatuses,
         authenticatedStatusMap(authenticated, 'firstHop')),
    gate('corpus authenticatedResolvedStatuses', published.authenticatedResolvedStatuses,
         authenticatedStatusMap(authenticated, 'resolved')),
    // locationContract[0] is the ABSOLUTE literal a successful login emits and locationContract[2] the
    // RELATIVE one the account route emits. Both are asserted, because the contrast between them is the
    // evidence behind test/helpers/flow.js's URL.parse base argument and the 22 lastRedirect.pathname
    // assertions that ride on it.
    gate('corpus locationContract absolute (POST /login valid)',
         contract[0] ? contract[0].location : null,
         loginEntry ? rebaseOrigin(loginEntry.location, origin,
                                   committedCorpus.metadata.appUrlOrigin) : null),
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
  var tally = { pass : 0, fail : 0, unevaluated : 0 };

  gates.forEach(function(entry) {
    if (entry.status === 'PASS')             { tally.pass += 1; }
    else if (entry.status === 'UNEVALUATED') { tally.unevaluated += 1; }
    else                                     { tally.fail += 1; }

    if (entry.status === 'PASS' && quiet) {
      return;
    }

    console.log('  [' + entry.status + '] ' + entry.name +
                (entry.status === 'PASS' ? ' = ' + String(stableStringify(entry.actual)).slice(0, 120)
                                         : ''));

    if (entry.status === 'UNEVALUATED') {
      console.log('      reason: ' + entry.reason);
    }
    else if (entry.status === 'FAIL') {
      console.log('      expected: ' + String(stableStringify(entry.expected)).slice(0, 400));
      console.log('      measured: ' + String(stableStringify(entry.actual)).slice(0, 400));
    }
  });

  console.log('capture.js: gates ' + tally.pass + ' PASS, ' + tally.fail + ' FAIL, ' +
              tally.unevaluated + ' UNEVALUATED');

  return tally;
}

// ---------------------------------------------------------------------------------------------
// Writing — deliberately hard to do by accident
// ---------------------------------------------------------------------------------------------

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
 * Merges measured values into the committed artifact, preserving every hand-authored field: the
 * per-entry `notes` prose, `state`, and every contract, gate and adjudication block. Only the measured
 * fields are replaced, and only the gates that are pure functions of the measurement are recomputed.
 * The gate keys that are NOT recomputed are returned so main() can name them explicitly instead of
 * leaving a reader to assume the whole gate block was re-derived.
 */
function mergeMeasuredIntoCommitted(committed, measured, buildArtifacts) {
  var merged        = JSON.parse(JSON.stringify(committed)),
      notRecomputed = [];

  ['unauthenticated', 'authenticated', 'assignmentNext'].forEach(function(section) {
    if (!committed[section]) {
      return;
    }

    merged[section] = committed[section].map(function(entry, index) {
      var source = (measured[section] || [])[index],
          target = JSON.parse(JSON.stringify(entry));

      if (!source) {
        return target;
      }

      COMPARED_FIELDS.forEach(function(field) {
        target[field] = source[field];
      });

      return target;
    });
  });

  merged.metadata.capturedAt = measured.capturedAt;
  merged.metadata.finishedAt = measured.finishedAt;
  merged.metadata.serverUri  = measured.serverUri;
  // The origin the measurement actually ran under, never the one the previous revision recorded: every
  // absolute Location and every rendered body in the rows above is relative to this value, so a stale
  // one would make the artifact describe a surface it does not contain.
  merged.metadata.appUrlOrigin = measured.appUrlOrigin || merged.metadata.appUrlOrigin;

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
  merged.gates.authenticatedFirstHopStatuses   = authenticatedStatusMap(measured.authenticated, 'firstHop');
  merged.gates.authenticatedResolvedStatuses   = authenticatedStatusMap(measured.authenticated, 'resolved');
  merged.gates.assignmentNextEntryCount        = (measured.assignmentNext || []).length;
  merged.gates.assignmentNextStatuses          = assignmentNextStatusMap(measured.assignmentNext);
  merged.gates.assignmentNextLocations         =
    assignmentNextLocationMap(measured.assignmentNext);

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
    'authenticatedFirstHopStatuses', 'authenticatedResolvedStatuses',
    'assignmentNextEntryCount', 'assignmentNextStatuses', 'assignmentNextLocations'
  ];

  Object.keys(merged.gates).forEach(function(key) {
    if (recomputed.indexOf(key) === -1) {
      notRecomputed.push(key);
    }
  });

  return { artifact : merged, notRecomputed : notRecomputed };
}

function writeArtifact(artifact) {
  fs.writeFileSync(ARTIFACT_PATH, JSON.stringify(artifact, null, 2) + '\n', 'utf8');
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

/**
 * The command line, parsed with node:util.parseArgs — a Node 22 built-in, so no dependency is added and
 * neither optimist (a dead package this change removes) nor a hand-rolled loop is needed. `strict` is on
 * so a mistyped flag fails loudly instead of being silently ignored: `--dryrun` quietly starting a run
 * that could write is precisely the accident this CLI is shaped to prevent.
 *
 * --dry-run is accepted explicitly even though it is the default, so the documented invocation works and
 * so a script can state its intent. It is mutually reinforcing with --write rather than redundant:
 * passing both is a contradiction and is rejected.
 */
function parseArgv(argv) {
  var parsed = nodeUtil.parseArgs({
    args   : argv,
    strict : true,
    allowPositionals : false,
    options : {
      write         : { type : 'boolean', default : false },
      force         : { type : 'boolean', default : false },
      quiet         : { type : 'boolean', default : false },
      'dry-run'     : { type : 'boolean', default : false },
      'routes-only' : { type : 'boolean', default : false },
      out           : { type : 'string' }
    }
  }).values;

  if (parsed.write && parsed['dry-run']) {
    throw new Error('capture.js: --write and --dry-run contradict each other. Pass one or neither; ' +
                    'a run with no flags is already a dry run.');
  }

  return {
    write      : parsed.write,
    force      : parsed.force,
    quiet      : parsed.quiet,
    dryRun     : parsed['dry-run'] || !parsed.write,
    routesOnly : parsed['routes-only'],
    out        : parsed.out === undefined ? null : parsed.out
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

/** The route-table half of the human-readable summary — the values AAP 0.7.5 names as the anchors. */
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
              ' assignmentNext=' + (measured.assignmentNext || []).length);
  console.log('capture.js: firstHopDistribution=' +
              JSON.stringify(statusDistribution(measured.unauthenticated)) +
              ' resolvedDistribution=' +
              JSON.stringify(resolvedStatusDistribution(measured.unauthenticated)));
  console.log('capture.js: roles tokens structurally verified before normalization: ' +
              measured.rolesTokenObservations.length + ' ' +
              JSON.stringify(measured.rolesTokenObservations));
}

/**
 * Measures both artifacts, diffs them against what is committed, evaluates every gate the artifacts
 * publish, and — only when explicitly asked and only on the base commit — regenerates them.
 *
 * Resolves with the process exit code rather than exiting itself, so the single `process.exit` lives in
 * the guarded entry point below where a synchronous throw is also caught. Exit 0 means three things and
 * nothing less: every evaluable gate held, nothing differed on a verify run, and a requested write
 * actually happened. A refused write, a failed gate, an unexpected difference and a thrown error all
 * exit 1.
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

  // A VERIFY run reproduces the app.url origin the corpus was captured under; a WRITE run measures the
  // live one and records it. See constraint 7 in the file header for the measurement behind this.
  configureRuntime(options.write ? {} : corpusOriginOverride(committed));

  return startServer().then(function(started) {
    server = started;
    console.log('capture.js: real HTTP against ' + server.info.uri +
                ' (this harness never calls server.inject(); the app still does — PRESERVED-QUIRKS 7.6)');
    console.log('capture.js: mode=' + (options.write ? 'WRITE' : 'VERIFY (dry run)') +
                ' app.url origin=' + liveAppUrlOrigin() +
                ' recorded=' + committed.metadata.appUrlOrigin);

    if (options.write && liveAppUrlOrigin() !== committed.metadata.appUrlOrigin) {
      console.log('capture.js: NOTE — this run would record app.url origin ' + liveAppUrlOrigin() +
                  ', not the ' + committed.metadata.appUrlOrigin + ' the committed artifact carries. ' +
                  'Every absolute Location and every rendered body would move with it.');
    }

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
        .concat(cookieContractGates(committed, measured));
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

    if (options.out && measured) {
      fs.writeFileSync(options.out, JSON.stringify(measured, null, 2) + '\n', 'utf8');
      console.log('capture.js: measured corpus written to ' + options.out);
    }

    if (!options.write) {
      if (differences.length) {
        exitCode = 1;
        console.log('capture.js: DRY RUN — nothing was written. Every difference above is either an ' +
                    'application-code defect or a harness defect; it must be reported, not written ' +
                    'over. Re-run with --write ONLY on the base commit.');
      }

      return undefined;
    }

    var head = currentHeadCommit();

    // A refusal exits 1: the run was asked to write and did not, and an operator (or a CI step) must not
    // read that as success. Both refusals are lifted only by --force, the single deliberate escape hatch.
    if (head !== committed.metadata.baseCommit && !options.force) {
      exitCode = 1;
      console.log('capture.js: REFUSING to write. HEAD is ' + head + ' but the artifacts record ' +
                  'baseCommit ' + committed.metadata.baseCommit + '. Overwriting here would replace ' +
                  'base-commit evidence with post-migration values. Pass --force if you genuinely ' +
                  'intend to discard the baseline.');

      return undefined;
    }

    if (tally.fail && !options.force) {
      exitCode = 1;
      console.log('capture.js: REFUSING to write. ' + tally.fail + ' gate(s) FAILED above, so this ' +
                  'measurement contradicts the contract the artifacts publish — that is a regression ' +
                  'to report, not a new baseline. Pass --force to write it anyway.');

      return undefined;
    }

    if (head !== committed.metadata.baseCommit) {
      console.log('capture.js: WARNING — writing from ' + head + ', which is NOT the recorded base ' +
                  'commit. The artifacts will no longer be baseline evidence.');
    }

    var table = mergeMeasuredRouteTable(committedTable, routeTable);

    writeRouteTable(table.artifact);
    console.log('capture.js: wrote ' + ROUTE_TABLE_PATH);
    console.log('capture.js: recomputed route-table gates rowCount, methods, apiPaths, ' +
                'withPreHandlers, authRequiredSession, authFalse, authTryInherited and the four ' +
                'digests, plus every row. NOT recomputed (hand-derived, verify by hand if the surface ' +
                'changed): ' + table.notRecomputed.join(', '));

    if (!measured) {
      console.log('capture.js: --routes-only, so ' + ARTIFACT_PATH + ' was left exactly as committed.');

      return undefined;
    }

    var corpus = mergeMeasuredIntoCommitted(committed, measured, buildArtifacts);

    writeArtifact(corpus.artifact);
    console.log('capture.js: wrote ' + ARTIFACT_PATH);
    console.log('capture.js: recomputed corpus gates measuredDistribution, unauthenticatedEntryCount, ' +
                'authenticatedEntryCount, the two status distributions, the hop histogram, the ' +
                'redirect and assignment maps and selectionRule.actualCount. NOT recomputed ' +
                '(hand-derived, verify by hand if the surface changed): ' +
                corpus.notRecomputed.join(', '));

    return undefined;
  }).then(function() {
    return stopServer(server);
  }, function(err) {
    reportFailure(err);
    exitCode = 1;

    return stopServer(server);
  }).then(function() {
    return exitCode;
  });
}

module.exports = {
  ARTIFACT_PATH            : ARTIFACT_PATH,
  ROUTE_TABLE_PATH         : ROUTE_TABLE_PATH,
  POLICY                   : POLICY,
  RUNTIME                  : RUNTIME,
  THROWAWAY                : THROWAWAY,
  ASSIGNMENT               : ASSIGNMENT,
  COMPARED_FIELDS          : COMPARED_FIELDS,
  ROLES_TOKEN_INVARIANTS   : ROLES_TOKEN_INVARIANTS,
  loadCommittedCorpus      : loadCommittedCorpus,
  loadCommittedRouteTable  : loadCommittedRouteTable,
  deepMerge                : deepMerge,
  preconditionFailure      : preconditionFailure,
  isPreconditionFailure    : isPreconditionFailure,
  reportFailure            : reportFailure,
  validateBaselinePort     : validateBaselinePort,
  resolveCloneIndex        : resolveCloneIndex,
  resolvePort              : resolvePort,
  assertPortAvailable      : assertPortAvailable,
  configureRuntime         : configureRuntime,
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
  findThrowawayUser        : findThrowawayUser,
  createThrowawayUser      : createThrowawayUser,
  removeThrowawayUser      : removeThrowawayUser,
  extractSessionCookie     : extractSessionCookie,
  captureAuthenticated     : captureAuthenticated,
  assignmentDestination    : assignmentDestination,
  assignmentEntryPath      : assignmentEntryPath,
  removeAssignmentSignupUser : removeAssignmentSignupUser,
  captureAssignmentNext    : captureAssignmentNext,
  captureCorpus            : captureCorpus,
  md5                      : md5,
  liveServerAuthDefault    : liveServerAuthDefault,
  effectiveRouteAuth       : effectiveRouteAuth,
  authDescriptor           : authDescriptor,
  canonicalRow             : canonicalRow,
  canonicalizeLiveTable    : canonicalizeLiveTable,
  registrationOrderRows    : registrationOrderRows,
  routeTableDigests        : routeTableDigests,
  captureRouteTable        : captureRouteTable,
  compareRouteTable        : compareRouteTable,
  mergeMeasuredRouteTable  : mergeMeasuredRouteTable,
  writeRouteTable          : writeRouteTable,
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
  corpusOriginOverride     : corpusOriginOverride,
  rebaseOrigin             : rebaseOrigin,
  rebaseEmbeddedOrigin     : rebaseEmbeddedOrigin,
  rebaseEntryOrigin        : rebaseEntryOrigin,
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
  writeArtifact            : writeArtifact,
  currentHeadCommit        : currentHeadCommit,
  parseArgv                : parseArgv,
  reportDifferences        : reportDifferences,
  reportRouteTable         : reportRouteTable,
  reportCorpus             : reportCorpus,
  main                     : main
};

// AAP 0.7.5: the mocha spec glob is recursive and would otherwise load this file as a spec and run a
// full capture on every `npm test`. Requiring this module must therefore be inert — no HTTP, no app.js,
// no datastore connection, no write and no process.exit happens above this line.
//
// The exit is here rather than inside main() so that one place owns it and so that a SYNCHRONOUS throw —
// a corrupt artifact, an unknown flag, --write together with --dry-run, an unusable BASELINE_PORT — is
// reported and exits 1 instead of surfacing as an unhandled error. Promise.resolve().then(main) is what
// converts such a throw into a rejection this chain can see. Exiting explicitly is mandatory:
// app.js:L355's un-unref'd 60-second detectLeaks interval, the module-load mongoose connection at
// config/db.js:L35 and the eager redis client each keep the event loop alive after the server has
// stopped, which is the same reason .mocharc.json carries "exit": true.
//
// This file publishes exactly two outcomes, 0 and 1, and a precondition failure is one of the 1s: it was
// asked to measure, it did not measure, and neither an operator nor a CI step may read that as success.
// Only test/baseline/replay.js publishes the third outcome — a separate could-not-run code that keeps a
// broken environment distinguishable from a parity regression — and it maps the shared precondition
// marker onto it.
if (require.main === module) {
  Promise.resolve().then(main).then(function(exitCode) {
    process.exit(exitCode);
  }).catch(function(err) {
    reportFailure(err);
    process.exit(1);
  });
}
