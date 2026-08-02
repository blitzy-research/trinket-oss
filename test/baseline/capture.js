/**
 * test/baseline/capture.js — the R-6 baseline capture harness.
 *
 * WHAT THIS IS
 * ------------
 * test/baseline/responses.json names this file in `metadata.capturedBy` as the harness that owns the
 * corpus in the finished repository. This is that harness. It boots the application exactly the way
 * the corpus was produced, re-measures every entry, and reports the differences. It is also the
 * shared implementation library for test/baseline/replay.js and test/lib/api/route-parity.js, which
 * require() it — the `require.main === module` guard below means requiring this file boots nothing
 * and captures nothing, so a fifth file under test/baseline/ is not needed.
 *
 * HARD CONSTRAINTS, all of them from AAP 0.7.5 and from the artifact's own metadata.captureNotes.
 * Every one of these is a correctness requirement, not a preference:
 *
 *   1. REAL HTTP ONLY. Requests are issued with node:http against server.info. server.inject() is
 *      NEVER used: @hapi/shot/lib/request.js:L30 is the sole remaining DEP0169 source in the whole
 *      dependency tree, and the zero-deprecation boot gate forbids tripping it. There is no upstream
 *      fix — 6.0.3 is the latest published @hapi/shot.
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
 *   6. CLONE-SAFE PORT. /tmp/blitzy is a shared workspace; sibling clones hold other ports. The bind
 *      port defaults to 30112 + CLONE_INDEX and is overridable with BASELINE_PORT.
 *
 * USAGE
 *   node test/baseline/capture.js                 measure, diff against the committed corpus, exit 1
 *                                                 if anything differs
 *   node test/baseline/capture.js --quiet          same, summary only
 *   node test/baseline/capture.js --write          rewrite responses.json (base commit only)
 *   node test/baseline/capture.js --write --force  rewrite anyway (destroys base-commit evidence)
 */

var childProcess = require('child_process'),
    crypto       = require('crypto'),
    fs           = require('fs'),
    http         = require('http'),
    path         = require('path');

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
      measured  = { capturedAt : startedAt, serverUri : server.info.uri };

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
function mergeMeasuredIntoCommitted(committed, measured) {
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

function parseArgv(argv) {
  var options = { write : false, force : false, quiet : false, out : null };

  for (var index = 0; index < argv.length; index++) {
    if (argv[index] === '--write')      { options.write = true; }
    else if (argv[index] === '--force') { options.force = true; }
    else if (argv[index] === '--quiet') { options.quiet = true; }
    else if (argv[index] === '--out')   { options.out = argv[++index]; }
  }

  return options;
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

function main() {
  var options   = parseArgv(process.argv.slice(2)),
      committed = loadCommittedCorpus(),
      server    = null,
      exitCode  = 0;

  configureRuntime();

  return startServer().then(function(started) {
    server = started;
    console.log('capture.js: real HTTP against ' + server.info.uri + ' (server.inject() is never used)');

    return captureCorpus(server, committed);
  }).then(function(measured) {
    var differences = compareCorpus(committed, measured);

    console.log('capture.js: unauthenticated=' + measured.unauthenticated.length +
                ' authenticated=' + measured.authenticated.length +
                ' assignmentNext=' + measured.assignmentNext.length +
                ' distribution=' + JSON.stringify(statusDistribution(measured.unauthenticated)));
    console.log('capture.js: roles tokens structurally verified before normalization: ' +
                measured.rolesTokenObservations.length + ' ' +
                JSON.stringify(measured.rolesTokenObservations));

    reportDifferences(differences, options.quiet);

    if (options.out) {
      fs.writeFileSync(options.out, JSON.stringify(measured, null, 2) + '\n', 'utf8');
      console.log('capture.js: measured corpus written to ' + options.out);
    }

    if (!options.write) {
      if (differences.length) {
        console.log('capture.js: DRY RUN — nothing was written. Every difference above is either an ' +
                    'application-code defect or a harness defect; it must be reported, not written ' +
                    'over. Re-run with --write ONLY on the base commit.');
        exitCode = 1;
      }

      return undefined;
    }

    var head = currentHeadCommit();

    if (head !== committed.metadata.baseCommit && !options.force) {
      console.log('capture.js: REFUSING to write. HEAD is ' + head + ' but the corpus records ' +
                  'baseCommit ' + committed.metadata.baseCommit + '. Overwriting here would replace ' +
                  'base-commit evidence with post-migration values. Pass --force if you genuinely ' +
                  'intend to discard the baseline.');
      exitCode = 1;

      return undefined;
    }

    if (head !== committed.metadata.baseCommit) {
      console.log('capture.js: WARNING — writing the corpus from ' + head + ', which is NOT the ' +
                  'recorded base commit. The artifact will no longer be baseline evidence.');
    }

    var result = mergeMeasuredIntoCommitted(committed, measured);

    writeArtifact(result.artifact);
    console.log('capture.js: wrote ' + ARTIFACT_PATH);
    console.log('capture.js: recomputed gates measuredDistribution, unauthenticatedEntryCount, ' +
                'authenticatedEntryCount and selectionRule.actualCount. NOT recomputed (hand-derived, ' +
                'verify by hand if the surface changed): ' + result.notRecomputed.join(', '));

    return undefined;
  }).then(function() {
    return stopServer(server);
  }, function(err) {
    console.error('capture.js: FAILED — ' + (err && err.stack ? err.stack : err));
    exitCode = 1;

    return stopServer(server);
  }).then(function() {
    // app.js:L348 installs a 60-second detectLeaks interval that is never unref'd, config/db.js:L35
    // opens the mongoose connection at module load and config/redis.js creates its client eagerly, so
    // three handles keep the loop alive after the server stops. Exit explicitly.
    process.exit(exitCode);
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
  resolvePort              : resolvePort,
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
  appUrlOrigin             : appUrlOrigin,
  liveAppUrlOrigin         : liveAppUrlOrigin,
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
  main                     : main
};

// AAP 0.7.5: the mocha spec glob is recursive and would otherwise load this file as a spec and run a
// full capture on every `npm test`. Requiring this module must therefore be inert.
if (require.main === module) {
  main();
}
