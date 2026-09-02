// Recorded OAuth, reCAPTCHA and asset-fetch responses.
//
// One of the three external-effect interceptors in test/parity/fixtures/. It is
// loaded as a preload - `node --require <abs path>/test/parity/fixtures/http.js
// app.js` - by test/parity/server.js, before the application, and it installs
// itself on first require. Node core only, CommonJS, no CLI arguments.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// Four call sites reach a third-party HTTP endpoint from inside the request
// path, and none of them can be exercised by the corpus without a substitute:
//
//   1. reCAPTCHA siteverify   lib/util/recaptcha.js
//   2. Google token exchange  lib/controllers/auth.js  (googleCallback)
//   3. Google profile fetch   lib/controllers/auth.js  (googleCallback)
//   4. The streaming asset    lib/controllers/users.js (assetUploadFromURL)
//
// Substitution happens at the MODULE BOUNDARY, not over the network: there is
// no proxy, no listening socket and no DNS, so the corpus is reproducible on
// any host. Every served value is a frozen literal, so test/parity/replay.js
// can compare exactly instead of normalizing (AAP 0.9.3).
//
// ===========================================================================
// USER-SPECIFIED RULES
// ===========================================================================
// `review_rules` reports that NO user-specified rules were provided for this
// project, which AAP 0.7 and 0.10.1 independently record. None are invented
// here, and their absence is not treated as licence to lower the bar:
// enterprise-standard practice governs, and the binding constraints are the
// request's own RULES block as interpreted in AAP 0.7, cited by name below.
//
//   R-a  Single purpose. Recorded responses for the endpoints the application
//        actually calls, under named profiles - not a general HTTP recorder, a
//        proxy or a cassette format. Every profile here maps to an outcome one
//        of the four call sites can actually receive and branch on.
//   R-b  Runs on Node 22, no route or module excluded. The OAuth, reCAPTCHA
//        and asset-upload routes belong to the 233-route surface replay.js
//        must cover, and they are unreachable without this file.
//   R-c  Node core only. Nothing is required except `fs` and `stream`, plus
//        the runtime's own globals (URL, Response, ReadableStream, Uint8Array,
//        Buffer, Promise). No `nock`, no `sinon`, no HTTP-mocking package:
//        this preload also runs inside the BASELINE worktree's process, which
//        has none of the target's devDependencies. The one dynamic require is
//        the application's own `request` package, resolved from the worktree
//        under test purely so that its export can be swapped and retained.
//   R-d  Behaviour "improvements" are prohibited; a quirk is preserved and
//        documented, not fixed. Three rulings are implemented literally:
//          (1) reCAPTCHA outcomes 5 and 6 deliver NO callback to verify()'s
//              caller. Their contract is a process-level failure signature, so
//              a "safe" fallback would repair a documented defect.
//          (2) `asset:transport-refused` emits 'error' and NEVER 'end'. The
//              upload does not start and the route is left UNSETTLED. No 'end'
//              is synthesized and no partial byte is uploaded.
//          (3) `oauth:success-new-user` serves an unseeded email so the
//              controller reaches its save-then-throw: the account IS created
//              and a generic authentication failure IS reported (AAP 0.6.6).
//   R-e  Error-to-response mappings survive unchanged, so each failure is
//        delivered in the exact shape its mechanism uses - the shape decides
//        which funnel the edge reaches:
//          `request` callback form -> cb(err, undefined, undefined) with a real
//            Error carrying code 'ECONNREFUSED'. That is precisely what leaves
//            `response` undefined at lib/util/recaptcha.js and makes reading
//            `response.statusCode` throw.
//          `request` stream form   -> an 'error' event on the returned stream.
//          `fetch`                 -> a rejected TypeError('fetch failed')
//            carrying `cause`, which is undici's shape on Node 22.
//   R-f  Baseline observed behaviour is the tie-breaker. ONE implementation is
//        loaded into BOTH worktrees, so any difference the corpus reports is
//        the application's and never the harness's. Everything the real
//        library did that is not self-evident was MEASURED and is recorded
//        under "BASELINE RECORD" below rather than assumed.
//   AAP 0.8  Zero-warning bar. No `url.parse` (DEP0169 - endpoint matching uses
//        `new URL`), no `new Buffer`, no deprecated stream or fs form, and no
//        console output of any kind: evidence goes to PARITY_HTTP_LOG. The
//        application's own log at lib/controllers/users.js (the asset 'error'
//        handler) is application output and is left alone.
//   AAP 0.9.3  Exact comparison. The OAuth access token is persisted onto
//        user.profiles.google.token and the profile picture becomes
//        user.avatar, which is rendered into HTML, so both are frozen
//        constants. No timestamp, id or token is generated anywhere.
//
// Folder prohibitions, all absolute and all honoured: no network access on any
// code path (the originals are retained solely so restore() can put them
// back, and are never invoked); an unrecorded endpoint fails deterministically
// through its own mechanism's failure shape plus a log entry, never falling
// through to the network; nothing from test/helpers/** or test/lib/** is
// required (test/helpers/defaults.js informed the record style only); no
// `url.parse`; no nondeterministic value in anything a response can expose;
// no application, config or baseline-worktree file is touched; and no CLI
// argument is read - every path and profile arrives through a PARITY_*
// variable.
//
// Load-order safety (AAP 0.6.5 defect 2): this module requires nothing from
// config/**, lib/models/** or lib/controllers/**. Reaching
// `mongoose-schema-extend` from a preload would replace the global
// Object.getPrototypeOf and make @hapi/hapi unloadable for the rest of the
// process.
//
// ===========================================================================
// ENVIRONMENT CONTRACT - the authoritative list. These four variables are
// every variable this file reads, so test/parity/server.js can match it
// exactly. No unset or malformed value causes a throw.
// ===========================================================================
//   PARITY_APP_ROOT          Absolute path of the worktree under test, used to
//                            resolve the application's own `request` package.
//                            FALLBACK: process.cwd(). The fallback is correct
//                            because test/parity/server.js spawns the
//                            application with the worktree under test as its
//                            working directory, while this file lives in the
//                            TARGET worktree - so `__dirname` would resolve
//                            the wrong tree's node_modules and is deliberately
//                            not used for resolution.
//   PARITY_HTTP_PROFILE      Name of the initial profile. Unset selects
//                            'default'. An unknown name also leaves 'default'
//                            in force and is logged - loading must not throw,
//                            because a throwing preload kills the server
//                            before app.js loads.
//   PARITY_HTTP_PROFILE_FILE Optional absolute path of a JSON file shaped
//                            {"profile": "<name>"}, RE-READ SYNCHRONOUSLY at
//                            the start of every intercepted call. This is how
//                            profiles switch WITHOUT restarting the server:
//                            test/parity/corpus.json carries a per-case
//                            `fixtureProfile`, and a single capture.js run
//                            drives the success, non-2xx, malformed-body,
//                            transport-failure and missing-field OAuth cases
//                            plus both streaming failure modes. No control
//                            socket and no network are involved. A missing,
//                            unreadable, malformed or unknown-name file leaves
//                            the previous profile in force and is logged,
//                            never thrown.
//   PARITY_HTTP_LOG          Optional evidence file. A strict no-op when
//                            unset. When set, one JSON record per intercepted
//                            call is appended synchronously - mechanism,
//                            endpoint, url, method, active profile and the
//                            outcome served, with NO timestamp. Appending per
//                            call rather than only on flush() is deliberate:
//                            several profiles deliberately end in an uncaught
//                            throw or an unsettled request, and evidence has
//                            to survive that. Every write is guarded, so a
//                            logging fault can never propagate into the
//                            application.
//
// ===========================================================================
// BASELINE RECORD (R-f) - measured, not assumed. Real `request` 2.88.2 driven
// against a loopback http server on Node v22.23.2, in a scratch directory
// outside the repository. Each line is a result, not an expectation.
// ===========================================================================
// Callback form:
//   json:true + JSON body  -> the callback's `body` argument is the PARSED
//                             object and `response.body` is the SAME reference.
//   no json  + JSON body   -> both are the raw STRING. This is the shape
//                             lib/util/recaptcha.js depends on: it parses
//                             `response.body`, not the `body` argument, so a
//                             parsed object there would change the outcome.
//   json:true + non-JSON   -> both stay the raw string; the guard
//                             `!body.access_token` does NOT throw.
//   json:true + 'null'     -> body === null, and the guard THROWS a TypeError.
//   json:true + empty body -> body === undefined, and the guard THROWS.
//   json:true + 404        -> err is NULL and the body is delivered normally.
//                             A non-2xx is not a transport error.
// Stream form (`.on()` returns self for every event; `.pipe()` returns the
// destination):
//   200            -> ['response:200', 'data', 'end']
//   query-bearing  -> identical sequence for '.../pic.png?v=2'
//   404            -> ['response:404', 'data', 'end'] - 'end' DOES fire, so the
//                     error page IS piped and uploaded, with the 404's own
//                     content-type. No 'error' event. This answers the
//                     non-2xx question the plan left open, by measurement.
//   302            -> ['redirect:302->/final', 'response:200', 'data', 'end'] -
//                     redirects ARE followed for GET, and the consumer's
//                     'response' handler observes ONLY the FINAL response, so
//                     the content-type it reads is the final response's and
//                     never the 302's. This answers the redirect question.
//   mid-stream cut -> ['response:200', 'data', 'error:ECONNRESET', 'end'] with
//                     the partial bytes on disk: 'error' AND 'end' both fire,
//                     so the upload proceeds with partial content.
//   refused        -> ['error:ECONNREFUSED'] alone. No 'response', no 'end',
//                     empty file, upload never starts, request unsettled.
//   refused Error  -> name 'Error', message 'connect ECONNREFUSED <host>:<port>',
//                     code 'ECONNREFUSED', errno -111, syscall 'connect'.
// Export surface: the module is itself callable and carries Request, cookie,
//   debug, defaults, del, delete, forever, get, head, initParams, jar,
//   options, patch, post, put - which is why every request-issuing entry point
//   is routed into one dispatcher instead of patching `get`/`post` alone.
// Node 22 fetch: a transport failure rejects with TypeError('fetch failed')
//   carrying a populated `cause`; lib/controllers/auth.js unwraps that cause,
//   so the cause must be the ECONNREFUSED Error itself.
// Web streams: enqueue-then-error inside a ReadableStream's `start()` DISCARDS
//   the queued chunk, so the mid-stream fetch profile uses a `pull()`-driven
//   stream that enqueues on the first pull and errors on the second. Measured
//   result: 'data' with the partial bytes, then 'error'.
//
// ===========================================================================
// NOTES OWED TO docs/baseline-parity.md (owned elsewhere)
// ===========================================================================
//   1. reCAPTCHA outcomes 3-6 are exercised by DIRECT MODULE-LEVEL INVOCATION
//      of lib/util/recaptcha.js's verify(), not through routes. Under
//      NODE_ENV=test, config.isTest is true (config/app.config.js sets
//      `config.isTest = node_env === 'test'`), so outcome 1 short-circuits
//      before any HTTP happens and always wins. What makes 3-6 reachable is a
//      direct require of lib/util/recaptcha.js WITHOUT loading
//      config/app.config - which leaves config.isTest undefined - together
//      with a present config.app.recaptcha.secretkey.
//   2. The OAuth profiles have a configuration precondition. Both handlers
//      guard on config.app.auth && config.app.auth.google &&
//      config.app.auth.google.clientID and short-circuit to request.fail when
//      it is absent, and test/parity/server-overlay.json's declared contract
//      does not include app.auth.google. So clientID, clientSecret and
//      callbackURL MUST be present in the composed NODE_CONFIG for these
//      profiles to be reached through routes; the overlay owner or capture.js
//      supplies them. This module stays fully usable by direct invocation
//      either way.
//   3. The asset redirect and non-2xx behaviours encoded here were RECORDED
//      from the real library (see BASELINE RECORD above), not assumed: a
//      non-2xx still reaches 'end' and therefore uploads the error page, and a
//      redirect is followed for GET with only the final response observable.
//
// ===========================================================================
// SEEDING CONTRACT
// ===========================================================================
// Which database branch googleCallback takes is decided by the EMAIL this
// fixture serves - there is no separate switch. This module is therefore the
// single source of truth for the two identities, exported as `identities`:
//   identities.existing  MUST be seeded by test/parity/seed.js as a user.
//   identities.new       MUST NOT be seeded, so the new-user branch is taken.
// If the seeder uses different addresses, call setIdentityEmails() before the
// first intercepted call rather than editing this file, so the two artifacts
// cannot drift. The derived username the controller computes for an identity
// is email.replace(/\W+/g, '-').toLowerCase(), which is exported alongside as
// identities.existingUsername / identities.newUsername for the seeder's use.

'use strict';

var fs = require('fs');

// The LEGACY stream base class, deliberately. The replaced library's Request
// object extends this class, so its `.pipe()` is Stream.prototype.pipe rather
// than Readable.prototype.pipe, and the two differ in how an 'error' on the
// source is propagated to the destination. Building the stream form on the
// same base as the original removes a whole class of difference that would
// otherwise belong to the harness rather than to the application (R-f).
var Stream = require('stream').Stream;

// ---------------------------------------------------------------------------
// Frozen constants. Everything a response can expose is a literal, because
// every one of these values reaches somewhere the corpus compares exactly:
// the access token is persisted onto user.profiles.google.token, the picture
// becomes user.avatar and is rendered into HTML, and the asset bytes decide
// the sha1 that becomes the stored S3 object key (AAP 0.6.7).
// ---------------------------------------------------------------------------

// Obviously synthetic, and deliberately unable to match any provider's token
// format so that secret scanners cannot mistake it for a credential.
var ACCESS_TOKEN = 'PARITY-FIXED-GOOGLE-ACCESS-TOKEN';

// Rendered into HTML as an avatar src. Never fetched by anything.
var PICTURE_URL = 'https://parity.example.com/avatars/google-fixed.png';

// Fixed Google account ids: stored on profiles.google.id and matched by
// findByMultiple.
var GOOGLE_ID_EXISTING = '100000000000000000001';
var GOOGLE_ID_NEW      = '100000000000000000002';

// A 42-byte 1x1 transparent GIF - the same shape of fixture the suite already
// uses for uploads. sha1 d5fceb6532643d0d84ffe09c40c481ecdf59e15a, which is
// the object key a successful asset upload must produce.
var ASSET_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// The first 21 bytes of that GIF: a truncated file, which is what the
// mid-stream failure uploads. sha1 8885cfafb2d7b043d78a4913bb5f3b0f405b0109.
var ASSET_GIF_PARTIAL = ASSET_GIF.subarray(0, 21);

// A 70-byte 1x1 PNG served as the FINAL response of the redirect profile, so
// that "the consumer observed the final response, not the 302" is provable
// from the stored bytes alone. sha1 9fb285daedf99a4dad5de09770de5fadf688d3ee.
var ASSET_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

// The body a 404 serves. Because a non-2xx still reaches 'end' (measured),
// these bytes really are uploaded, under content-type text/html.
// sha1 6196b3f53dcab9801e387f9e327228a3aaa9385a.
var ASSET_ERROR_PAGE = Buffer.from(
  '<html><head><title>404 Not Found</title></head><body>Not Found</body></html>',
  'utf8'
);

// The three endpoints the application calls. Compared by origin + pathname
// through `new URL`, so a query string or a trailing difference in the
// caller's spelling cannot break matching.
var ENDPOINT_URLS = {
  recaptcha : 'https://www.google.com/recaptcha/api/siteverify',
  token     : 'https://oauth2.googleapis.com/token',
  userinfo  : 'https://www.googleapis.com/oauth2/v2/userinfo'
};

// The asset URLs the corpus should request. Exported so capture.js does not
// hard-code them. `query` exists because the upload filename is derived with
// path.basename() over a legacy `path` field that RETAINS the query string, so
// '?v=2' ends up inside the stored filename - behaviour lib/util/url.js
// preserves on the target tree and the corpus must exercise.
var ASSET_URLS = {
  plain    : 'https://parity.example.com/assets/fixture.gif',
  query    : 'https://parity.example.com/assets/fixture.gif?v=2',
  redirect : 'https://parity.example.com/assets/redirected.png',
  missing  : 'https://parity.example.com/assets/missing.gif'
};

// A URL no profile records, kept here so the no-escape-to-the-network path can
// be exercised by name instead of by inventing a string at the call site.
var UNRECORDED_URL = 'https://parity.example.com/unrecorded/never-recorded';

// ---------------------------------------------------------------------------
// Identities. The email decides the database branch, so these two values and
// the seeder must agree - see the SEEDING CONTRACT above.
// ---------------------------------------------------------------------------

// The transform lib/util/user.js applies to derive a username from an email.
// Replicated rather than required: this module imports no application source,
// and the expression is one line whose behaviour is fixed by the corpus.
function derivedUsername(email) {
  return String(email).replace(/\W+/g, '-').toLowerCase();
}

var identities = {
  existing         : 'parity-existing@example.com',
  new              : 'parity-newcomer@example.com',
  existingUsername : derivedUsername('parity-existing@example.com'),
  newUsername      : derivedUsername('parity-newcomer@example.com')
};

// ---------------------------------------------------------------------------
// Response records.
//
// A record for one of the three JSON endpoints is exactly one of:
//   {outcome, status, headers, json}  - the body is JSON.stringify(json), so
//                                       the served bytes are a stable literal.
//   {outcome, status, headers, body}  - a raw body string, used where the
//                                       point of the case is that the body is
//                                       NOT valid JSON.
//   {outcome, transport: {...}}       - a transport failure, delivered in each
//                                       mechanism's own failure shape.
//   {outcome, recorded: false}        - nothing recorded; deterministic
//                                       failure, never a network call.
//
// An asset record is {outcome, mode, status, contentType, bytes, ...} where
// mode is one of 'complete', 'non-2xx', 'redirect', 'refused' or 'midstream'.
// Modes exist because the four failure shapes are not variations on a status
// code - they differ in which EVENTS fire, and the events are what the
// controller branches on.
//
// A record may be a function returning a record, which is how the two OAuth
// profile bodies pick up a later setIdentityEmails() call.
// ---------------------------------------------------------------------------

var JSON_HEADERS = { 'content-type': 'application/json; charset=UTF-8' };
var HTML_HEADERS = { 'content-type': 'text/html; charset=UTF-8' };

// reCAPTCHA outcome 3: a 200 whose body is a realistic siteverify payload.
// `challenge_ts` is a FROZEN literal, not a generated timestamp.
var RECAPTCHA_SUCCESS = {
  outcome : 'recaptcha-200-success',
  status  : 200,
  headers : JSON_HEADERS,
  json    : {
    success      : true,
    challenge_ts : '2015-06-15T12:00:00Z',
    hostname     : 'localhost',
    score        : 0.9,
    action       : 'submit'
  }
};

// Also outcome 3 structurally - a 200 the module parses successfully - but the
// provider says no. It is recorded separately because it is the only way to
// reach the request.fail edges that branch on `recaptcha_result.success` in
// lib/controllers/users.js (create and sendEmailVerification), which the
// error-edge inventory needs (AAP 0.6.3).
var RECAPTCHA_REJECTED = {
  outcome : 'recaptcha-200-rejected',
  status  : 200,
  headers : JSON_HEADERS,
  json    : {
    success        : false,
    challenge_ts   : '2015-06-15T12:00:00Z',
    hostname       : 'localhost',
    'error-codes'  : ['invalid-input-response']
  }
};

// reCAPTCHA outcome 4: any non-200 makes verify() call back with the
// differently shaped {status: false}. That key is `status`, not `success`, and
// the two shapes are deliberately NOT unified: callers test `success`, so a
// non-200 is not merely a falsy success but a different object (R-d).
var RECAPTCHA_NON_200 = {
  outcome : 'recaptcha-503',
  status  : 503,
  headers : HTML_HEADERS,
  body    : '<html><body>Service Unavailable</body></html>'
};

// reCAPTCHA outcome 5: a transport failure. `err` is never inspected, so
// `response` stays undefined and reading `response.statusCode` throws an
// uncaught TypeError. verify()'s callback is NEVER invoked.
var RECAPTCHA_TRANSPORT_FAILURE = {
  outcome   : 'recaptcha-transport-failure',
  transport : { code: 'ECONNREFUSED', host: 'www.google.com', port: 443 }
};

// reCAPTCHA outcome 6: a 200 whose body is not JSON. JSON.parse throws an
// uncaught SyntaxError and verify()'s callback is NEVER invoked.
var RECAPTCHA_MALFORMED_JSON = {
  outcome : 'recaptcha-200-malformed-json',
  status  : 200,
  headers : HTML_HEADERS,
  body    : '<html><body>not json</body></html>'
};

// Google token exchange: the success case. `access_token` is the frozen
// constant because it is persisted onto user.profiles.google.token.
var TOKEN_SUCCESS = {
  outcome : 'token-200-success',
  status  : 200,
  headers : JSON_HEADERS,
  json    : {
    access_token : ACCESS_TOKEN,
    expires_in   : 3599,
    scope        : 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
    token_type   : 'Bearer'
  }
};

// A non-2xx from the token endpoint. Measured: `err` is null and the JSON body
// is still parsed, so the guard sees an object with no access_token and
// rejects - reaching the generic authentication failure, not a throw.
var TOKEN_NON_2XX = {
  outcome : 'token-400-invalid-grant',
  status  : 400,
  headers : JSON_HEADERS,
  json    : { error: 'invalid_grant', error_description: 'Bad Request' }
};

// A 200 carrying an object that simply has no access_token: same reject, same
// generic failure, different provider fault.
var TOKEN_MALFORMED_BODY = {
  outcome : 'token-200-no-access-token',
  status  : 200,
  headers : JSON_HEADERS,
  json    : { token_type: 'Bearer', expires_in: 3599 }
};

// A 200 whose body parses to a NON-OBJECT. Measured on the real library: a
// body of 'null' arrives as null, and `!body.access_token` then throws a
// TypeError out of the callback - an uncaught exception that leaves the
// request unanswered rather than producing the generic failure. Recorded as a
// separate profile because the outcome differs from the case above, and
// preserved rather than tidied (R-d).
var TOKEN_NON_OBJECT_BODY = {
  outcome : 'token-200-null-body',
  status  : 200,
  headers : JSON_HEADERS,
  body    : 'null'
};

var TOKEN_TRANSPORT_FAILURE = {
  outcome   : 'token-transport-failure',
  transport : { code: 'ECONNREFUSED', host: 'oauth2.googleapis.com', port: 443 }
};

// Google profile fetch. `picture` is the frozen constant because it becomes
// user.avatar and is rendered into HTML. Built through a function so that a
// setIdentityEmails() call is picked up.
function userinfoExisting() {
  return {
    outcome : 'userinfo-200-existing-user',
    status  : 200,
    headers : JSON_HEADERS,
    json    : {
      id             : GOOGLE_ID_EXISTING,
      email          : identities.existing,
      verified_email : true,
      name           : 'Parity Existing User',
      given_name     : 'Parity',
      family_name    : 'Existing User',
      picture        : PICTURE_URL,
      locale         : 'en'
    }
  };
}

// The same shape with an UNSEEDED email, which is the whole mechanism for
// selecting the new-user branch. The controller then saves the user, sets the
// yar `next` and `grantDemoTrinkets` values, and throws a ReferenceError on an
// undefined `opts` - so the account is created and a generic failure is
// reported. That outcome is reproduced deliberately (R-d ruling 3, AAP 0.6.6).
function userinfoNew() {
  return {
    outcome : 'userinfo-200-new-user',
    status  : 200,
    headers : JSON_HEADERS,
    json    : {
      id             : GOOGLE_ID_NEW,
      email          : identities.new,
      verified_email : true,
      name           : 'Parity Newcomer',
      given_name     : 'Parity',
      family_name    : 'Newcomer',
      picture        : PICTURE_URL,
      locale         : 'en'
    }
  };
}

// A 200 profile with no email at all: the guard rejects and the chain answers
// with the generic authentication failure.
var USERINFO_MISSING_EMAIL = {
  outcome : 'userinfo-200-missing-email',
  status  : 200,
  headers : JSON_HEADERS,
  json    : {
    id          : GOOGLE_ID_EXISTING,
    name        : 'Parity No Email',
    given_name  : 'Parity',
    family_name : 'No Email',
    picture     : PICTURE_URL,
    locale      : 'en'
  }
};

var USERINFO_TRANSPORT_FAILURE = {
  outcome   : 'userinfo-transport-failure',
  transport : { code: 'ECONNREFUSED', host: 'www.googleapis.com', port: 443 }
};

// Asset records. `mode` selects the event sequence, which is the observable
// that matters - see BASELINE RECORD above for the measured sequences.
var ASSET_COMPLETE = {
  outcome     : 'asset-200-complete',
  mode        : 'complete',
  status      : 200,
  contentType : 'image/gif',
  bytes       : ASSET_GIF
};

// A 404 still reaches 'end' (measured), so the error page really is uploaded,
// with the 404's own content-type. Preserved exactly: this is the recorded
// baseline, not a convenience.
var ASSET_NON_2XX = {
  outcome     : 'asset-404-uploaded',
  mode        : 'non-2xx',
  status      : 404,
  contentType : 'text/html; charset=UTF-8',
  bytes       : ASSET_ERROR_PAGE
};

// A 302 is followed for GET and only the FINAL response is observable, so the
// record carries the final status, the final content-type and the final bytes,
// with the intermediate status recorded for the 'redirect' event alone.
var ASSET_REDIRECT = {
  outcome            : 'asset-302-followed',
  mode               : 'redirect',
  status             : 200,
  contentType        : 'image/png',
  bytes              : ASSET_PNG,
  redirectStatus     : 302,
  redirectLocation   : ASSET_URLS.redirect
};

// 'error' only, and NEVER 'end': the upload does not start and the route is
// left unsettled (R-d ruling 2).
var ASSET_REFUSED = {
  outcome   : 'asset-transport-refused',
  mode      : 'refused',
  transport : { code: 'ECONNREFUSED', host: 'parity.example.com', port: 443 }
};

// 'response', partial bytes, 'error', and then 'end' as well, so the upload
// proceeds with partial content. Kept strictly separate from the refused case
// because the two outcomes must stay distinguishable.
var ASSET_MIDSTREAM = {
  outcome     : 'asset-midstream-failure',
  mode        : 'midstream',
  status      : 200,
  contentType : 'image/gif',
  bytes       : ASSET_GIF_PARTIAL,
  transport   : { code: 'ECONNRESET', message: 'socket hang up' }
};

// Nothing recorded for this endpoint under this profile.
var NOT_RECORDED = { outcome: 'unrecorded', recorded: false };

// ---------------------------------------------------------------------------
// The profile catalogue. Every profile is layered over 'default', so a profile
// declares only the endpoint it is about and no call can land on a hole by
// accident. 'none' is the deliberate exception: it records nothing, and exists
// so the no-escape-to-the-network path can be exercised for every endpoint.
// ---------------------------------------------------------------------------

var DEFAULT_PROFILE = {
  description : 'Every endpoint succeeds; OAuth resolves to the seeded existing user.',
  recaptcha   : RECAPTCHA_SUCCESS,
  token       : TOKEN_SUCCESS,
  userinfo    : userinfoExisting,
  asset       : ASSET_COMPLETE
};

var PROFILES = {
  'default' : DEFAULT_PROFILE,

  'recaptcha:success'           : { description: 'siteverify 200, success true.', recaptcha: RECAPTCHA_SUCCESS },
  'recaptcha:rejected'          : { description: 'siteverify 200, success false - reaches the request.fail edges.', recaptcha: RECAPTCHA_REJECTED },
  'recaptcha:non-200'           : { description: 'siteverify 503 - verify() calls back with {status:false}.', recaptcha: RECAPTCHA_NON_200 },
  'recaptcha:transport-failure' : { description: 'siteverify transport failure - uncaught TypeError, no callback.', recaptcha: RECAPTCHA_TRANSPORT_FAILURE },
  'recaptcha:malformed-json'    : { description: 'siteverify 200 with a non-JSON body - uncaught SyntaxError, no callback.', recaptcha: RECAPTCHA_MALFORMED_JSON },

  'oauth:success-existing-user'    : { description: 'Token and profile succeed; the email is the seeded user.', token: TOKEN_SUCCESS, userinfo: userinfoExisting },
  'oauth:success-new-user'         : { description: 'Token and profile succeed; the email is unseeded, so the account is created and a generic failure is reported.', token: TOKEN_SUCCESS, userinfo: userinfoNew },
  'oauth:token-non-2xx'            : { description: 'Token endpoint 400 - generic authentication failure.', token: TOKEN_NON_2XX },
  'oauth:token-malformed-body'     : { description: 'Token endpoint 200 with no access_token - generic authentication failure.', token: TOKEN_MALFORMED_BODY },
  'oauth:token-non-object-body'    : { description: 'Token endpoint 200 whose body parses to null - uncaught TypeError, request unanswered.', token: TOKEN_NON_OBJECT_BODY },
  'oauth:token-transport-failure'  : { description: 'Token endpoint transport failure - generic authentication failure.', token: TOKEN_TRANSPORT_FAILURE },
  'oauth:profile-missing-email'    : { description: 'Profile 200 with no email - generic authentication failure.', token: TOKEN_SUCCESS, userinfo: USERINFO_MISSING_EMAIL },
  'oauth:profile-transport-failure': { description: 'Profile endpoint transport failure - generic authentication failure.', token: TOKEN_SUCCESS, userinfo: USERINFO_TRANSPORT_FAILURE },

  'asset:success'           : { description: 'response, fixed bytes, end - the upload stores sha1 d5fceb6532643d0d84ffe09c40c481ecdf59e15a.', asset: ASSET_COMPLETE },
  'asset:non-2xx'           : { description: '404 that still reaches end, so the error page is uploaded as text/html.', asset: ASSET_NON_2XX },
  'asset:redirect'          : { description: '302 followed for GET; only the final 200 is observable.', asset: ASSET_REDIRECT },
  'asset:transport-refused' : { description: 'error only, never end - the upload never starts and the route is unsettled.', asset: ASSET_REFUSED },
  'asset:midstream-failure' : { description: 'response, partial bytes, error, then end - the partial content is uploaded.', asset: ASSET_MIDSTREAM },

  'none' : {
    description : 'Nothing recorded. Every endpoint fails deterministically in its own mechanism\'s failure shape, proving no path reaches the network.',
    recaptcha   : NOT_RECORDED,
    token       : NOT_RECORDED,
    userinfo    : NOT_RECORDED,
    asset       : NOT_RECORDED
  }
};

var DEFAULT_PROFILE_NAME = 'default';

// ---------------------------------------------------------------------------
// Module state. Held in one object so install()/restore() can be idempotent
// and so a second require() of this file - which returns the same cached
// exports - cannot double-patch anything.
// ---------------------------------------------------------------------------
var state = {
  installed        : false,
  activeProfile    : DEFAULT_PROFILE_NAME,
  requestPatched   : false,
  fetchPatched     : false,
  requestModule    : null,   // the Module record whose exports were swapped
  originalRequest  : null,   // the genuine `request` export, for restore()
  originalFetch    : null,   // the genuine globalThis.fetch, for restore()
  resolveDiagnostic: null,   // why the `request` mechanism is inactive, if it is
  profileFileState : null,   // last value read from PARITY_HTTP_PROFILE_FILE
  calls            : []
};

// ---------------------------------------------------------------------------
// Evidence log. Nothing here may ever throw into the application, and nothing
// here may emit to stdout or stderr: the zero-warning gate captures both
// streams for the whole run (AAP 0.8).
// ---------------------------------------------------------------------------

// Appends one record and, when PARITY_HTTP_LOG is set, writes it through
// immediately. Writing per call rather than only on flush() is deliberate:
// `recaptcha:transport-failure`, `recaptcha:malformed-json` and
// `oauth:token-non-object-body` end in an uncaught throw and
// `asset:transport-refused` never settles, so evidence buffered in memory
// would be lost exactly where it is most needed.
function record(entry) {
  state.calls.push(entry);

  var target = process.env.PARITY_HTTP_LOG;
  if (!target) {
    return;                                  // strict no-op when unset
  }

  try {
    fs.appendFileSync(target, JSON.stringify(entry) + '\n');
  }
  catch (e) {
    // A logging fault is not the application's problem. It is retained in
    // memory and surfaced by calls(), which is where a harness looks.
    state.calls.push({ event: 'log-write-failed', error: e.message });
  }
}

// Records something about the fixture itself rather than about an intercepted
// call - an unknown profile name, an unreadable profile file, a mechanism that
// could not be patched. Same guarantees, same destination.
function note(event, detail) {
  record({ event: event, detail: detail === undefined ? null : detail });
}

// Rewrites PARITY_HTTP_LOG with the complete set of records held in memory.
// Exposed for a harness that wants one self-contained artifact rather than the
// append stream; a strict no-op when the variable is unset, and it never
// throws. Returns the path written, or null.
function flush() {
  var target = process.env.PARITY_HTTP_LOG;
  if (!target) {
    return null;
  }

  try {
    var lines = state.calls.map(function(entry) {
      return JSON.stringify(entry);
    });

    // The directory is NOT created here. The harness owns the log path, the
    // per-call append does not create directories either - so the two paths
    // stay consistent - and a recursive mkdir is not a safe operation to run
    // blind from inside a request: measured on this host,
    // fs.mkdirSync('/proc/<missing>/<missing>', {recursive: true}) BLOCKS
    // indefinitely where appendFileSync on the same path returns ENOENT at
    // once. A fixture must never be able to stall the process it is loaded
    // into.
    fs.writeFileSync(target, lines.length ? lines.join('\n') + '\n' : '');
    return target;
  }
  catch (e) {
    state.calls.push({ event: 'log-flush-failed', error: e.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Profile selection.
// ---------------------------------------------------------------------------

// Resolves the record for one endpoint under the active profile, layering the
// profile over 'default' so that a profile which says nothing about an
// endpoint still serves a recorded response rather than a hole.
function recordFor(endpoint) {
  var profile = PROFILES[state.activeProfile] || DEFAULT_PROFILE;
  var entry = Object.prototype.hasOwnProperty.call(profile, endpoint)
    ? profile[endpoint]
    : DEFAULT_PROFILE[endpoint];

  return typeof entry === 'function' ? entry() : entry;
}

// Re-reads PARITY_HTTP_PROFILE_FILE synchronously. Called at the start of
// every intercepted call, which is what lets capture.js switch profiles
// between corpus cases without restarting the server. Every failure mode -
// unset, absent, unreadable, malformed, unknown name - leaves the profile
// already in force untouched, is logged, and never throws.
function refreshProfileFromFile() {
  var file = process.env.PARITY_HTTP_PROFILE_FILE;
  if (!file) {
    return;
  }

  var raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  }
  catch (e) {
    if (state.profileFileState !== 'unreadable') {
      state.profileFileState = 'unreadable';
      note('profile-file-unreadable', { file: file, error: e.code || e.message, keeping: state.activeProfile });
    }
    return;
  }

  var parsed;
  try {
    parsed = JSON.parse(raw);
  }
  catch (e) {
    if (state.profileFileState !== 'malformed') {
      state.profileFileState = 'malformed';
      note('profile-file-malformed', { file: file, keeping: state.activeProfile });
    }
    return;
  }

  var name = parsed && parsed.profile;
  if (typeof name !== 'string' || !name) {
    if (state.profileFileState !== 'no-profile-key') {
      state.profileFileState = 'no-profile-key';
      note('profile-file-missing-key', { file: file, keeping: state.activeProfile });
    }
    return;
  }

  if (!Object.prototype.hasOwnProperty.call(PROFILES, name)) {
    if (state.profileFileState !== 'unknown:' + name) {
      state.profileFileState = 'unknown:' + name;
      note('profile-file-unknown-name', { file: file, requested: name, keeping: state.activeProfile });
    }
    return;
  }

  state.profileFileState = 'ok:' + name;
  if (state.activeProfile !== name) {
    state.activeProfile = name;
    note('profile-changed', { via: 'file', profile: name });
  }
}

// Selects a profile directly. Unlike the file, an unknown name here is a
// programming error at the point of selection and is rejected loudly, which is
// what the exported catalogue exists to prevent.
function setProfile(name) {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, name)) {
    throw new Error(
      'test/parity/fixtures/http.js: unknown profile ' + JSON.stringify(name) +
      '. Valid profiles: ' + Object.keys(PROFILES).join(', ')
    );
  }

  if (state.activeProfile !== name) {
    state.activeProfile = name;
    note('profile-changed', { via: 'setProfile', profile: name });
  }

  return name;
}

// ---------------------------------------------------------------------------
// Endpoint classification. `new URL` only - never url.parse, which emits
// DEP0169 on every call (AAP 0.8).
// ---------------------------------------------------------------------------

// Extracts the URL from either accepted call shape: a bare string, a WHATWG
// URL, or the options object the application passes ({url: ...}). `uri` is
// accepted as well because the replaced library treated the two as synonyms
// and a future call site might use either.
function urlFrom(target) {
  if (typeof target === 'string') {
    return target;
  }

  if (target instanceof URL) {
    return target.href;
  }

  if (target && typeof target === 'object') {
    if (typeof target.url === 'string') return target.url;
    if (target.url instanceof URL) return target.url.href;
    if (typeof target.uri === 'string') return target.uri;
    if (target.uri instanceof URL) return target.uri.href;
    // A WHATWG Request, which is what a `fetch(new Request(...))` call passes.
    if (typeof target.href === 'string') return target.href;
  }

  return null;
}

// Maps a URL onto one of the four endpoint classes. Matching is on origin plus
// pathname, so a query string or a caller's trailing-slash spelling cannot
// break it. Anything parseable and http(s) that is not one of the three known
// endpoints is an asset fetch, which is the classification the application's
// own asset route relies on. Anything else - a non-http scheme, an unparseable
// string, a missing URL - is unrecorded, and unrecorded never reaches the
// network.
function classify(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl) {
    return { endpoint: null, url: rawUrl === null || rawUrl === undefined ? '' : String(rawUrl), reason: 'no-url' };
  }

  var parsed;
  try {
    parsed = new URL(rawUrl);
  }
  catch (e) {
    return { endpoint: null, url: rawUrl, reason: 'unparseable-url' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { endpoint: null, url: rawUrl, reason: 'unsupported-protocol:' + parsed.protocol };
  }

  var names = Object.keys(ENDPOINT_URLS);
  for (var i = 0; i < names.length; i++) {
    var known = new URL(ENDPOINT_URLS[names[i]]);
    if (known.origin === parsed.origin && known.pathname === parsed.pathname) {
      return { endpoint: names[i], url: rawUrl };
    }
  }

  return { endpoint: 'asset', url: rawUrl };
}

// ---------------------------------------------------------------------------
// Failure construction.
// ---------------------------------------------------------------------------

// The Error a refused or reset connection produced, reproduced field for
// field from the measured original: name 'Error', a message naming the host
// and port, and code/errno/syscall. Deterministic - the host and port come
// from the record, never from a live socket (R-e).
function transportError(spec) {
  var message = spec.message ||
    ('connect ' + spec.code + ' ' + (spec.host || 'parity.example.com') + ':' + (spec.port || 443));

  var err = new Error(message);
  err.code = spec.code;
  err.errno = spec.errno === undefined ? -111 : spec.errno;
  err.syscall = spec.syscall || 'connect';

  if (spec.host) err.hostname = spec.host;
  if (spec.port) err.port = spec.port;

  return err;
}

// The error an unrecorded endpoint produces. It is a transport-shaped Error so
// that it travels through exactly the same funnel a real connection failure
// would, but its code and message say plainly that the fixture, not the
// network, refused - which is what makes an accidental omission in the corpus
// obvious instead of silent.
function unrecordedError(classified, mechanism) {
  var err = new Error(
    'test/parity/fixtures/http.js: no response recorded for ' +
    JSON.stringify(classified.url) + ' under profile ' + JSON.stringify(state.activeProfile) +
    (classified.reason ? ' (' + classified.reason + ')' : '') +
    '. The fixture never reaches the network, so this request cannot be served.'
  );

  err.code = 'PARITY_UNRECORDED';
  err.syscall = 'connect';
  err.parityMechanism = mechanism;
  err.parityProfile = state.activeProfile;

  return err;
}

// The rejection `fetch` produces for a transport failure on Node 22: a
// TypeError whose message is exactly 'fetch failed', carrying the underlying
// Error as `cause`. lib/controllers/auth.js unwraps that cause, so the cause
// must be the Error the replaced library reported directly (R-e).
function fetchFailure(cause) {
  var err = new TypeError('fetch failed');
  err.cause = cause;
  return err;
}

// ---------------------------------------------------------------------------
// Response construction shared by both mechanisms.
// ---------------------------------------------------------------------------

// Only the statuses this fixture serves need a reason phrase.
var STATUS_TEXT = {
  200 : 'OK',
  302 : 'Found',
  400 : 'Bad Request',
  404 : 'Not Found',
  503 : 'Service Unavailable'
};

// The exact bytes a record serves, as a string. A record carries either a
// `json` object - stringified here so the served bytes are a stable literal
// with a fixed key order - or a raw `body` string, or `bytes` for the asset
// records.
function bodyStringFor(rec) {
  if (rec.json !== undefined) {
    return JSON.stringify(rec.json);
  }

  if (typeof rec.body === 'string') {
    return rec.body;
  }

  if (rec.bytes) {
    return rec.bytes.toString('utf8');
  }

  return '';
}

// The body-parsing rule `json: true` applied, reproduced from measurement
// rather than from documentation: an empty body becomes undefined, a parseable
// body becomes the parsed value INCLUDING null, and an unparseable body stays
// the raw string. The first two are what make the application's
// `!body.access_token` and `!profile.email` guards throw a TypeError instead
// of rejecting, and that fault is preserved (R-d).
function legacyJsonBody(text) {
  if (text === '') {
    return undefined;
  }

  try {
    return JSON.parse(text);
  }
  catch (e) {
    return text;
  }
}

// Builds the response object the callback form receives. `response.body` and
// the callback's `body` argument are the SAME value, which is measured
// behaviour and is load-bearing: lib/util/recaptcha.js parses
// `response.body`, so under `json: true` both are the parsed object and
// without it both are the raw string.
function buildCallbackResponse(rec, classified, method, wantsJson) {
  var text = bodyStringFor(rec);
  var body = wantsJson ? legacyJsonBody(text) : text;
  var headers = {};

  Object.keys(rec.headers || {}).forEach(function(name) {
    headers[name.toLowerCase()] = rec.headers[name];
  });

  if (rec.contentType && !headers['content-type']) {
    headers['content-type'] = rec.contentType;
  }

  return {
    statusCode    : rec.status,
    statusMessage : STATUS_TEXT[rec.status] || '',
    httpVersion   : '1.1',
    headers       : headers,
    body          : body,
    url           : classified.url,
    method        : method
  };
}

// ---------------------------------------------------------------------------
// Mechanism 1: the `request` module.
//
// The whole export is replaced with one dispatcher, so every request-issuing
// entry point the module exposes - the callable form included - lands here and
// nothing can escape to the network. Two call shapes are served from that one
// dispatcher, selected by whether a callback was supplied: the callback form
// the two OAuth calls and reCAPTCHA use, and the no-callback stream form the
// asset upload uses.
// ---------------------------------------------------------------------------

// Normalizes the argument shapes the library accepted: (url), (url, cb),
// (url, options, cb), (options), (options, cb). `uri` is honoured as a synonym
// for `url`, as the original did.
function normalizeArgs(defaultMethod, args) {
  var list = Array.prototype.slice.call(args);
  var callback = null;

  if (list.length && typeof list[list.length - 1] === 'function') {
    callback = list.pop();
  }

  var options = {};
  var i;
  for (i = 0; i < list.length; i++) {
    if (list[i] && typeof list[i] === 'object' && !(list[i] instanceof URL)) {
      options = list[i];
      break;
    }
  }

  var url = null;
  for (i = 0; i < list.length && url === null; i++) {
    url = urlFrom(list[i]);
  }
  if (url === null) {
    url = urlFrom(options);
  }

  return {
    url      : url,
    method   : (options && typeof options.method === 'string' ? options.method.toUpperCase() : defaultMethod),
    options  : options,
    callback : callback
  };
}

// Delivers a callback-form response. The callback is dispatched on a next tick
// rather than synchronously, which is what the original did from its own
// emitter: a throw inside the callback then escapes as an uncaught exception,
// which is the documented contract of reCAPTCHA outcomes 5 and 6 and of the
// null-body token case (R-d, R-e).
function serveRequestCallback(call) {
  var classified = classify(call.url);
  var rec = classified.endpoint ? recordFor(classified.endpoint) : null;
  var wantsJson = !!(call.options && call.options.json);

  if (!rec || rec.recorded === false) {
    record({
      mechanism : 'request',
      endpoint  : classified.endpoint || 'unknown',
      url       : classified.url,
      method    : call.method,
      profile   : state.activeProfile,
      outcome   : 'unrecorded'
    });
    process.nextTick(call.callback, unrecordedError(classified, 'request'), undefined, undefined);
    return;
  }

  record({
    mechanism : 'request',
    endpoint  : classified.endpoint,
    url       : classified.url,
    method    : call.method,
    profile   : state.activeProfile,
    outcome   : rec.outcome
  });

  if (rec.transport) {
    // (err, undefined, undefined) - the shape that leaves `response`
    // undefined at the reCAPTCHA call site and throws there.
    process.nextTick(call.callback, transportError(rec.transport), undefined, undefined);
    return;
  }

  var response = buildCallbackResponse(rec, classified, call.method, wantsJson);
  process.nextTick(call.callback, null, response, response.body);
}

// Builds the object the stream form returns: a legacy Stream carrying the
// no-op control surface the original exposed, so a consumer that pauses,
// resumes or aborts it behaves as before.
function newRequestStream(call, classified) {
  var stream = new Stream();

  stream.readable = true;
  stream.method = call.method;
  stream.href = classified.url;
  stream.pause = function() { return stream; };
  stream.resume = function() { return stream; };
  stream.abort = function() { return stream; };
  stream.end = function() { return stream; };

  return stream;
}

// Delivers the stream form. Emission is deferred to setImmediate so that the
// caller's whole synchronous chain - three .on() calls and the .pipe() - is
// attached first, which is what the original's real I/O guaranteed. The event
// sequences below are the measured baseline sequences, one per mode.
function serveRequestStream(call) {
  var classified = classify(call.url);
  var rec = classified.endpoint ? recordFor(classified.endpoint) : null;
  var stream = newRequestStream(call, classified);

  if (!rec || rec.recorded === false) {
    record({
      mechanism : 'request',
      endpoint  : classified.endpoint || 'unknown',
      url       : classified.url,
      method    : call.method,
      profile   : state.activeProfile,
      outcome   : 'unrecorded'
    });
    setImmediate(function() {
      stream.emit('error', unrecordedError(classified, 'request'));
    });
    return stream;
  }

  record({
    mechanism : 'request',
    endpoint  : classified.endpoint,
    url       : classified.url,
    method    : call.method,
    profile   : state.activeProfile,
    outcome   : rec.outcome
  });

  // A JSON endpoint asked for without a callback still has to answer, and it
  // answers as a stream: response, body, end.
  var mode = rec.mode || 'complete';

  setImmediate(function() {
    if (mode === 'refused') {
      // 'error' and nothing else, ever: no 'response', no 'data', no 'end'.
      // The upload never starts and the request is left unsettled (R-d).
      stream.emit('error', transportError(rec.transport));
      return;
    }

    if (mode === 'redirect') {
      // The intermediate response is announced through 'redirect' - the event
      // the original emitted, and one no application handler listens for -
      // and then only the FINAL response is delivered, which is what a
      // consumer of the original could observe.
      stream.response = {
        statusCode : rec.redirectStatus,
        headers    : { location: rec.redirectLocation }
      };
      stream.emit('redirect');
    }

    var response = buildCallbackResponse(rec, classified, call.method, false);
    delete response.body;              // the stream form carries no body field
    stream.response = response;
    stream.emit('response', response);

    var bytes = rec.bytes || Buffer.from(bodyStringFor(rec), 'utf8');
    if (bytes.length) {
      stream.emit('data', bytes);
    }

    if (mode === 'midstream') {
      // 'error' AFTER the partial bytes and 'end' AFTER the error: both fire,
      // so the upload proceeds with partial content. Deferred one tick so the
      // bytes are through the pipe before the error unwires it, which is the
      // order the measured baseline produced.
      setImmediate(function() {
        stream.emit('error', transportError(rec.transport));
        stream.emit('end');
      });
      return;
    }

    // 'complete' and 'non-2xx' both end normally: a non-2xx is not a
    // transport error, so its body really is piped and uploaded.
    stream.emit('end');
  });

  return stream;
}

// The single entry point every patched `request` export routes into.
function dispatchRequest(defaultMethod, args) {
  refreshProfileFromFile();

  var call = normalizeArgs(defaultMethod, args);

  if (call.callback) {
    serveRequestCallback(call);
    // The original returned its Request object from the callback form too.
    // An inert stream is returned here for shape only: the response travels
    // through the callback, and emitting on both would serve it twice. No
    // call site reads this value.
    return newRequestStream(call, classify(call.url));
  }

  return serveRequestStream(call);
}

// Builds the replacement export: callable, and carrying every entry point the
// measured export surface exposed. `defaults()` and `forever()` return the
// dispatcher itself rather than a configured client, because a configured
// client would be one more way to reach the network. `Request` is a throwing
// shim for the same reason - nothing in the application constructs it, and if
// something ever does, failing loudly beats opening a socket.
function buildRequestReplacement() {
  var dispatcher = function() {
    return dispatchRequest('GET', arguments);
  };

  ['get', 'post', 'put', 'patch', 'head', 'del', 'delete', 'options'].forEach(function(name) {
    var method = (name === 'del' ? 'DELETE' : name.toUpperCase());
    dispatcher[name] = function() {
      return dispatchRequest(method, arguments);
    };
  });

  // Both hand out a configured client in the original, so both must hand out
  // the dispatcher here: a configured client would be one more way to reach
  // the network.
  dispatcher.defaults = function() { return dispatcher; };
  dispatcher.forever = function() { return dispatcher; };

  // The remaining members of the measured export surface - Request,
  // initParams, jar and cookie - are declared UNAVAILABLE rather than faked.
  // None is referenced anywhere in the application, at the base commit or on
  // the target tree, and none issues an HTTP request, so their absence cannot
  // open a route to the network. Declaring them loudly is the honest option:
  // a hollow cookie jar that silently stores nothing, or an initParams that
  // returns a differently shaped object, would turn a missing capability into
  // a subtle wrong answer.
  ['Request', 'initParams', 'jar', 'cookie'].forEach(function(name) {
    dispatcher[name] = function() {
      throw new Error(
        'test/parity/fixtures/http.js: request.' + name + ' is not available under the parity fixture. ' +
        'Every HTTP call must go through a recorded profile, and the fixture never reaches the network. ' +
        'If a call site ever needs this member, record its behaviour and implement it here rather than ' +
        'restoring the real module.'
      );
    };
  });

  // A data property on the original, carrying no behaviour.
  dispatcher.debug = false;

  // The marker install() uses to recognize its own patch, which is what keeps
  // a repeated install() to a single layer.
  dispatcher.parityFixture = true;

  return dispatcher;
}

// ---------------------------------------------------------------------------
// Mechanism 2: `globalThis.fetch`.
//
// Patched unconditionally, because on the target tree all four call sites are
// native fetch. The served shapes are real WHATWG Response objects built by
// the runtime's own constructor, so `.status`, `.headers.get()`, `.text()` and
// a `.body` that Readable.fromWeb() can consume all behave exactly as they do
// against a live server - which matters, because the application reads all
// four.
// ---------------------------------------------------------------------------

// A web ReadableStream delivering the whole payload and closing.
function completeWebStream(bytes) {
  return new ReadableStream({
    start : function(controller) {
      if (bytes.length) {
        controller.enqueue(new Uint8Array(bytes));
      }
      controller.close();
    }
  });
}

// A web ReadableStream delivering the partial payload and THEN failing.
//
// Two details are measured rather than chosen. It is pull-driven because
// enqueueing and erroring inside start() DISCARDS the queued chunk, which
// would turn the mid-stream case into a zero-byte failure instead of a
// partial-content upload. And the error is deferred by one setImmediate,
// because the consumer pipes this stream into a write stream and a failure in
// the same turn as the chunk tears the pipe down before the write is issued -
// measured: the partial bytes never reached the file. One immediate of
// separation is the same separation the stream form gives the `request`
// mechanism, so both mechanisms deliver partial content and then fail.
function partialThenErrorWebStream(bytes, err) {
  var delivered = false;

  return new ReadableStream({
    pull : function(controller) {
      if (!delivered) {
        delivered = true;
        if (bytes.length) {
          controller.enqueue(new Uint8Array(bytes));
        }
        return;
      }

      return new Promise(function(resolve) {
        setImmediate(function() {
          controller.error(err);
          resolve();
        });
      });
    }
  });
}

// Builds the Response for one record.
function buildFetchResponse(rec, classified) {
  var headers = {};

  Object.keys(rec.headers || {}).forEach(function(name) {
    headers[name.toLowerCase()] = rec.headers[name];
  });

  if (rec.contentType && !headers['content-type']) {
    headers['content-type'] = rec.contentType;
  }

  var init = {
    status     : rec.status,
    statusText : STATUS_TEXT[rec.status] || '',
    headers    : headers
  };

  if (rec.mode === 'midstream') {
    // The stream form emits 'error' and then 'end', because both are events
    // the fixture controls. A Node Readable adapted from a web stream cannot
    // do that - a Readable that errors never emits 'end' - so on this
    // mechanism the fixture's contract stops at "partial bytes, then error".
    // That is a property of the runtime's own stream adapter, not a gap here,
    // and the application accounts for it: its 'error' handler starts the
    // upload itself, which is how the partial content still gets uploaded on
    // both mechanisms. Measured on both.
    return new Response(
      partialThenErrorWebStream(rec.bytes, transportError(rec.transport)),
      init
    );
  }

  if (rec.bytes) {
    return new Response(completeWebStream(rec.bytes), init);
  }

  // The JSON endpoints. The body is handed over as the same string the
  // callback form serves, so both mechanisms parse identical bytes and the
  // `json: true` semantics are reproduced by the application's own reader.
  return new Response(bodyStringFor(rec), init);
}

// The replacement for globalThis.fetch. It never calls the original and never
// opens a socket.
function parityFetch(input, init) {
  refreshProfileFromFile();

  var rawUrl = urlFrom(input);
  var classified = classify(rawUrl);
  var method = 'GET';

  if (init && typeof init.method === 'string') {
    method = init.method.toUpperCase();
  }
  else if (input && typeof input === 'object' && typeof input.method === 'string') {
    method = input.method.toUpperCase();
  }

  var rec = classified.endpoint ? recordFor(classified.endpoint) : null;

  if (!rec || rec.recorded === false) {
    record({
      mechanism : 'fetch',
      endpoint  : classified.endpoint || 'unknown',
      url       : classified.url,
      method    : method,
      profile   : state.activeProfile,
      outcome   : 'unrecorded'
    });
    // fetch's own failure shape, so the caller's rejection handling is
    // reached exactly as a real transport failure would reach it (R-e).
    return Promise.reject(fetchFailure(unrecordedError(classified, 'fetch')));
  }

  record({
    mechanism : 'fetch',
    endpoint  : classified.endpoint,
    url       : classified.url,
    method    : method,
    profile   : state.activeProfile,
    outcome   : rec.outcome
  });

  // A transport failure on a JSON endpoint, and the refused asset, are the
  // same event to fetch: the promise rejects and no Response ever exists.
  if (rec.transport && rec.mode !== 'midstream') {
    return Promise.reject(fetchFailure(transportError(rec.transport)));
  }

  // `init.redirect` is recorded in the log but does not change what is
  // served. Nothing needs it to: the only recorded redirect belongs to the
  // asset GET, which follows redirects and therefore observes the final
  // response - the response this record already describes - while the token
  // POST that asks for redirect:'manual' has no recorded redirect at all.
  try {
    return Promise.resolve(buildFetchResponse(rec, classified));
  }
  catch (e) {
    // A malformed record is a fixture fault, not a network event. It is
    // reported through fetch's own failure shape so it cannot be mistaken for
    // a successful response, and it is logged for the harness.
    note('fetch-response-build-failed', { url: classified.url, profile: state.activeProfile, error: e.message });
    return Promise.reject(fetchFailure(e));
  }
}

// ---------------------------------------------------------------------------
// Installation.
// ---------------------------------------------------------------------------

var requestReplacement = buildRequestReplacement();

// Resolves the application's own `request` package from the worktree under
// test. On the target tree the package is removed from the manifest, so
// MODULE_NOT_FOUND is an expected, silent outcome - not an error - and only
// the fetch mechanism is installed.
function patchRequestModule(appRoot) {
  var resolved;

  try {
    resolved = require.resolve('request', { paths: [appRoot] });
  }
  catch (e) {
    state.resolveDiagnostic = 'request is not resolvable from ' + appRoot +
      ' (' + (e.code || e.message) + '); only the fetch mechanism is active, which is the expected state on the target tree';
    return false;
  }

  try {
    // Loading the module performs no network I/O; it is loaded so that the
    // genuine export can be retained for restore() and so that the cache
    // entry the application will hit is the one being replaced.
    require(resolved);

    var mod = require.cache[resolved];
    if (!mod) {
      state.resolveDiagnostic = 'request resolved to ' + resolved + ' but left no cache entry to patch';
      return false;
    }

    if (mod.exports && mod.exports.parityFixture) {
      // Already patched by an earlier install(); one layer only.
      state.requestModule = mod;
      return true;
    }

    state.requestModule = mod;
    state.originalRequest = mod.exports;
    mod.exports = requestReplacement;
    return true;
  }
  catch (e) {
    state.resolveDiagnostic = 'request resolved to ' + resolved + ' but could not be patched: ' + e.message;
    return false;
  }
}

// Replaces globalThis.fetch, retaining the genuine original exactly once so
// that a repeated install() cannot make the fixture its own "original".
function patchFetch() {
  if (globalThis.fetch === parityFetch) {
    return true;
  }

  state.originalFetch = globalThis.fetch;
  globalThis.fetch = parityFetch;
  return true;
}

// Installs both mechanisms. Idempotent: a second call is a no-op that returns
// the same status. Never throws - a preload that throws kills the server
// before app.js loads - so a failure is recorded in the returned status and in
// the evidence log instead.
function install() {
  if (state.installed) {
    return status();
  }

  var appRoot = process.env.PARITY_APP_ROOT || process.cwd();

  try {
    state.requestPatched = patchRequestModule(appRoot);
  }
  catch (e) {
    state.requestPatched = false;
    state.resolveDiagnostic = 'request patch failed: ' + e.message;
  }

  try {
    state.fetchPatched = patchFetch();
  }
  catch (e) {
    state.fetchPatched = false;
    note('fetch-patch-failed', { error: e.message });
  }

  state.installed = state.requestPatched || state.fetchPatched;

  if (state.resolveDiagnostic) {
    note('request-mechanism-inactive', state.resolveDiagnostic);
  }

  return status();
}

// Puts back the genuine `request` export and the genuine globalThis.fetch. The
// retained originals are used here and nowhere else: no code path in this file
// ever calls them.
function restore() {
  if (state.requestModule && state.originalRequest) {
    state.requestModule.exports = state.originalRequest;
  }

  if (state.fetchPatched && globalThis.fetch === parityFetch) {
    globalThis.fetch = state.originalFetch;
  }

  state.requestModule = null;
  state.originalRequest = null;
  state.originalFetch = null;
  state.requestPatched = false;
  state.fetchPatched = false;
  state.installed = false;

  return status();
}

// What is patched, what is not, and why. Returned by install() and available
// on its own so a harness can report the active mechanisms rather than guess
// at them.
function status() {
  return {
    installed  : state.installed,
    appRoot    : process.env.PARITY_APP_ROOT || process.cwd(),
    profile    : state.activeProfile,
    mechanisms : {
      request : state.requestPatched,
      fetch   : state.fetchPatched
    },
    diagnostic : state.resolveDiagnostic
  };
}

// ---------------------------------------------------------------------------
// Initial profile, from PARITY_HTTP_PROFILE and then from
// PARITY_HTTP_PROFILE_FILE. An unknown name is logged and ignored rather than
// thrown, because this runs at load time.
// ---------------------------------------------------------------------------
function selectInitialProfile() {
  var requested = process.env.PARITY_HTTP_PROFILE;

  if (requested) {
    if (Object.prototype.hasOwnProperty.call(PROFILES, requested)) {
      state.activeProfile = requested;
    }
    else {
      note('initial-profile-unknown', { requested: requested, keeping: state.activeProfile });
    }
  }

  refreshProfileFromFile();
}

// ---------------------------------------------------------------------------
// Public API. Consumed by test/parity/server.js (install), capture.js
// (profiles, setProfile, identities, endpoints, assetUrls) and replay.js
// (calls, reset, flush).
// ---------------------------------------------------------------------------
module.exports = {
  install : install,
  restore : restore,
  status  : status,

  // Profile selection. `profiles` is the catalogue, so capture.js enumerates
  // valid `fixtureProfile` values instead of hard-coding strings.
  profiles     : PROFILES,
  profileNames : function() { return Object.keys(PROFILES); },
  setProfile   : setProfile,
  getProfile   : function() { return state.activeProfile; },

  // Evidence.
  calls : function() { return state.calls.slice(); },
  reset : function() {
    // Clears the evidence log only. The active profile is deliberately left
    // alone, because a corpus run selects it per case through setProfile or
    // the profile file.
    state.calls = [];
    state.profileFileState = null;
    return null;
  },
  flush : flush,

  // Identities. See the SEEDING CONTRACT in the header: seed `existing`, never
  // seed `new`, and align through this function rather than by editing either
  // file.
  identities       : identities,
  setIdentityEmails : function(next) {
    if (!next || typeof next !== 'object') {
      throw new Error('test/parity/fixtures/http.js: setIdentityEmails requires an object with `existing` and/or `new`');
    }

    if (next.existing !== undefined) {
      if (typeof next.existing !== 'string' || next.existing.indexOf('@') === -1) {
        throw new Error('test/parity/fixtures/http.js: setIdentityEmails `existing` must be an email address');
      }
      identities.existing = next.existing;
      identities.existingUsername = derivedUsername(next.existing);
    }

    if (next.new !== undefined) {
      if (typeof next.new !== 'string' || next.new.indexOf('@') === -1) {
        throw new Error('test/parity/fixtures/http.js: setIdentityEmails `new` must be an email address');
      }
      identities.new = next.new;
      identities.newUsername = derivedUsername(next.new);
    }

    return {
      existing         : identities.existing,
      new              : identities.new,
      existingUsername : identities.existingUsername,
      newUsername      : identities.newUsername
    };
  },

  // The frozen values a corpus assertion needs to name. `assetDigests` are the
  // sha1 hex digests of the corresponding buffers, which is what
  // lib/util/file.js turns into the stored S3 object key, so a storage
  // assertion can reference them without recomputing.
  endpoints     : ENDPOINT_URLS,
  assetUrls     : ASSET_URLS,
  unrecordedUrl : UNRECORDED_URL,
  accessToken   : ACCESS_TOKEN,
  pictureUrl    : PICTURE_URL,
  googleIds     : { existing: GOOGLE_ID_EXISTING, new: GOOGLE_ID_NEW },
  assetBytes    : {
    complete  : ASSET_GIF,
    partial   : ASSET_GIF_PARTIAL,
    redirected: ASSET_PNG,
    errorPage : ASSET_ERROR_PAGE
  },
  assetDigests  : {
    complete  : 'd5fceb6532643d0d84ffe09c40c481ecdf59e15a',
    partial   : '8885cfafb2d7b043d78a4913bb5f3b0f405b0109',
    redirected: '9fb285daedf99a4dad5de09770de5fadf688d3ee',
    errorPage : '6196b3f53dcab9801e387f9e327228a3aaa9385a'
  }
};

// ---------------------------------------------------------------------------
// Auto-install on first require, so a preload needs no argument and no call.
// Wrapped so that nothing here can throw out of the load: this module is
// required before app.js, and a throw at this point would take the server down
// before it ever started.
// ---------------------------------------------------------------------------
try {
  selectInitialProfile();
  install();
}
catch (e) {
  try {
    note('install-failed', { error: e.message });
  }
  catch (ignored) {
    // The evidence log itself is unavailable, so the failure is kept on the
    // state object instead, where status().diagnostic surfaces it. A plain
    // assignment cannot throw, which is what makes this the last layer.
    state.resolveDiagnostic = 'install failed and could not be logged: ' +
      (e && e.message ? e.message : String(e)) +
      ' (secondary failure: ' + (ignored && ignored.message ? ignored.message : String(ignored)) + ')';
  }
}
