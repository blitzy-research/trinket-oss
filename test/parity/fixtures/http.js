// Recorded OAuth, reCAPTCHA and asset-fetch responses.
//
// One of the three external-effect interceptors in test/parity/fixtures/,
// loaded by test/parity/server.js as a `--require` preload ahead of the
// application and installing itself on first require. Node core only,
// CommonJS, and no argv is read on that path: every input arrives through a
// PARITY_* variable.
//
// WHAT IS SUBSTITUTED, AND WHERE
//   Four call sites reach a third-party endpoint from inside the request path:
//   reCAPTCHA siteverify (lib/util/recaptcha.js), the Google token exchange
//   and profile fetch (lib/controllers/auth.js's googleCallback), and the
//   streaming asset fetch (lib/controllers/users.js's assetUploadFromURL).
//   Substitution is at the MODULE BOUNDARY - the application's own `request`
//   export, resolved from the tree under test, and `globalThis.fetch` - so no
//   proxy, socket or DNS is involved, and every served value is a literal.
//   ONE call is handed back to the retained original: a `data:` URL declared in
//   DIVERGENT_URLS. It carries its own payload, so it reaches no dispatcher and
//   no socket, and letting the runtime resolve it is the only way that
//   divergence is a driven result rather than a body this fixture invented. The
//   delegation is gated on the scheme AND on membership of that table, so no
//   http(s) URL and no undeclared data: URL can reach it.
//
// SURFACE AND ARTIFACT
//   install/restore, status/handshake/assertReady, profile selection, the
//   evidence accessors, identities/setIdentityEmails, the frozen
//   endpoint/asset/digest/limit tables, and selfTest/main. Executed directly -
//   `node test/parity/fixtures/http.js [--out <file>]` - it drives every
//   profile and reCAPTCHA outcome, failing on one left unselected.
//   PARITY_HTTP_LOG receives one JSON record per intercepted call - mechanism,
//   endpoint, redacted url, method, profile, outcome and what was SENT, with
//   no timestamp - appended per call rather than on flush(), so evidence
//   survives the outcomes that throw or never settle. PARITY_HTTP_STATUS
//   receives the install handshake: this module, its digest, the app root, the
//   pid, the mechanism table.
//
// PROFILES SELECT AN OUTCOME, AND THE SHAPE IS THE OUTCOME
//   PARITY_HTTP_PROFILE names the initial profile and PARITY_HTTP_PROFILE_FILE
//   ({"profile": "<name>"}) is RE-READ synchronously at the start of every
//   intercepted call, so one capture run drives every branch without a
//   restart. An unknown or unreadable value leaves the profile in force, since
//   a throwing preload would kill the server. Coverage per call site:
//   successful exchange, non-2xx, a body that parses to no usable value, a
//   body that is not JSON, a missing field and transport failure, plus the
//   asset fetch's redirect, hop-limit, mid-stream and refused cases.
//   Each mechanism fails in its own shape, because the shape decides which
//   funnel the edge reaches: the `request` callback form calls back (err,
//   undefined, undefined), which is what the reCAPTCHA call site reads as an
//   unreachable provider; the stream form emits 'error'; `fetch` rejects with
//   TypeError('fetch failed') carrying `cause`. `asset:transport-refused`
//   emits 'error' and NEVER 'end', leaving the upload unstarted and the route
//   unsettled - it is now the only outcome here that answers nothing.
//   The two reCAPTCHA faults and the null token body used to be three more:
//   each dereferenced a value the provider controls and took the process down.
//   All three are guarded in the delivered tree under the approved deviation at
//   docs/preserved-quirks.md 10.7, and each record says what it now produces.
//
// FAIL CLOSED, AND CHECK WHAT WAS SENT
//   An unrecorded endpoint fails with code PARITY_UNRECORDED in the calling
//   mechanism's own shape and never opens a socket: the JSON endpoints match
//   on origin plus pathname, and an asset fetch only from the registry built
//   out of ASSET_URLS, the hop chain and PARITY_HTTP_ASSET_URLS.
//   REQUEST_CONTRACTS then states, per endpoint and mechanism, the method,
//   headers, bearer scheme, body encoding, form fields and redirect mode a
//   call must have; a breach is REFUSED rather than served, which is what
//   keeps a drifted wire encoding visible.
//
// THE THREE URL SHAPES THAT ARE NOT RECORDINGS
//   DIVERGENT_URLS names the three URLs where native fetch and the replaced
//   library disagree about the URL ITSELF - a `data:` URL, a credential-bearing
//   URL and a URL on a Fetch-forbidden port - which are the three divergences
//   docs/preserved-quirks.md 11.4 declares at the asset call site. Each is
//   decided in parityFetch BEFORE the registry is consulted, because that is
//   where the runtime decides them: the credentialed URL is refused with
//   fetch's own TypeError, the blocked port with TypeError('fetch failed')
//   whose cause is Error('bad port'), and the data: URL is delegated. All three
//   are recorded, with the shape named in `registration`, which is what
//   separates a divergence the harness drove from a URL nobody recorded - both
//   leave the asset route on the same log-only arm.
//
// NO CREDENTIAL REACHES THE EVIDENCE
//   `authorization` and `proxy-authorization` keep their SCHEME alone, because
//   a contract asserts on it; cookie, API-key, token and signature headers are
//   redacted WHOLE; query and form values are redacted by name against a list
//   AND a pattern. Userinfo is stripped and the removal MARKED, and a non-URL
//   becomes `unparseable-url:sha1:<12>`. Whether a scheme-bearing header held
//   a non-empty credential is computed before redaction and kept as a boolean,
//   because a contract asserts on that too.
//
// IDENTITIES, READINESS AND THE PROHIBITIONS
//   The email served decides which OAuth database branch runs, since
//   `User.findByMultiple` queries an $or over the email, the derived username
//   and profiles.google.id: `identities.existing` must be an account
//   test/parity/seed.js creates and `identities.new` must miss all three.
//   assertReady() throws unless every required mechanism is active, the app
//   root is the tree it claims to be and the identity contract holds. fetch is
//   always required and `request` exactly when the tree resolves it, so a
//   resolvable package that could not be patched, or a declared app root that
//   does not hold the application, exits with EXIT_UNPROTECTED rather than
//   serving. The retained originals are never invoked, and nothing is required
//   from config/**, lib/models/** or lib/controllers/**, where
//   `mongoose-schema-extend` would make @hapi/hapi unloadable for the rest of
//   the process. No `url.parse` (DEP0169), no `new Buffer`, no console output.

'use strict';

var fs = require('fs');

// Node core, for the digest that lets two runs be compared byte-for-byte over
// bodies whose credential-bearing fields are redacted out of the evidence, and
// for the asset digests the storage contract keys on.
var crypto = require('crypto');

// Node core. Used ONLY by the self-verifying harness below, which runs when
// this file is executed directly: the two reCAPTCHA faults are process-level
// claims - the callback fires, it carries the fail-closed value, and the
// process reaches its own exit rather than being taken down by the provider's
// fault - and none of the three can be asserted from inside the process that
// would have died. Never touched on the preload path.
var childProcess = require('child_process');
var os = require('os');
var pathModule = require('path');

// The LEGACY stream base class, deliberately. The replaced library's Request
// object extends this class, so its `.pipe()` is Stream.prototype.pipe rather
// than Readable.prototype.pipe, and the two differ in how an 'error' on the
// source is propagated to the destination. Building the stream form on the
// same base as the original removes a whole class of difference that would
// otherwise belong to the harness rather than to the application.
var Stream = require('stream').Stream;

// ---------------------------------------------------------------------------
// Frozen constants. Everything a response can expose is a literal, because
// every one of these values reaches somewhere the corpus compares exactly:
// the access token is persisted onto user.profiles.google.token, the picture
// becomes user.avatar and is rendered into HTML, and the asset bytes decide
// the sha1 that becomes the stored S3 object key.
// ---------------------------------------------------------------------------

// Synthetic, and deliberately unable to match any provider's token format so
// that secret scanners cannot mistake it for a credential.
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

// The body a 500 serves. Kept DISTINCT from the 404 page: a 404 and a 500 are
// the same event to this call site - neither is a transport error, so both
// still reach 'end' and both are uploaded - but they store different bytes
// under different keys, and one record cannot evidence two statuses. sha1
// c6a3fa0e0b8b34a56a83b8e5e9f2c1eae4a4b3f2 is NOT asserted from a literal here;
// the digest is computed by the harness from these bytes, which is what makes
// the two cases separable in the evidence.
var ASSET_SERVER_ERROR_PAGE = Buffer.from(
  '<html><head><title>500 Internal Server Error</title></head><body>Internal Server Error</body></html>',
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
//
// This object is also the REGISTRY the asset endpoint matches against. An
// asset fetch is recognized by (origin, pathname) drawn from these entries and
// from the redirect-hop chain below - never by "it parsed and it was not one
// of the three JSON endpoints": an unregistered URL is refused, not served.
var ASSET_URLS = {
  plain       : 'https://parity.example.com/assets/fixture.gif',
  query       : 'https://parity.example.com/assets/fixture.gif?v=2',
  redirect    : 'https://parity.example.com/assets/redirected.png',
  missing     : 'https://parity.example.com/assets/missing.gif',
  serverError : 'https://parity.example.com/assets/server-error.gif'
};

// Redirect hops. A redirect record is a CHAIN, and every hop has its own URL so
// that a caller which follows redirects itself - one fetch per hop with
// `redirect: 'manual'`, which is the only way to enforce a limit below the
// runtime's own - is served the same chain a following caller is. Hop n
// redirects to hop n+1, and the last hop redirects to the chain's destination.
var ASSET_HOP_PREFIX = 'https://parity.example.com/assets/redirect-hop/';

// The number of hops the two boundary profiles serve. The replaced `request`
// library allowed 10 redirects and native fetch allows 20, so a chain of 10 is
// inside both
// limits and a chain of 11 is inside fetch's and outside the replaced
// library's. Those two values are the boundary any redirect-limit claim about
// the asset call site has to be pinned against, so the fixture can serve it.
var ASSET_HOPS_WITHIN_LEGACY_LIMIT = 10;
var ASSET_HOPS_BEYOND_LEGACY_LIMIT = 11;

// The redirect limits each mechanism enforces. LEGACY is the replaced library's
// documented `maxRedirects` default; FETCH is the WHATWG/undici limit. Neither
// is observed here - `request` is not installed on the target tree and the
// runtime's limit is not reachable without 20 real hops - so both are declared
// values the fixture enforces, exported so a caller asserts against the same
// number the fixture used.
var LEGACY_MAX_REDIRECTS = 10;
var FETCH_MAX_REDIRECTS   = 20;

// A URL no profile records, kept here so the no-escape-to-the-network path can
// be exercised by name instead of by inventing a string at the call site. It is
// deliberately on the SAME origin as the recorded asset URLs, so that it proves
// path-level registration rather than merely origin-level rejection.
var UNRECORDED_URL = 'https://parity.example.com/unrecorded/never-recorded';

// A URL on an origin nothing records at all: the control for the fail-closed
// registry. An asset endpoint that accepted any parseable http(s) URL would
// serve plausible bytes to an outbound call no profile describes - a new
// integration, or an SSRF payload reaching a host the application was never
// meant to contact - and that call would read as a success.
var UNREGISTERED_ORIGIN_URL = 'https://unregistered.invalid/some/path';

// ---------------------------------------------------------------------------
// The URL-SHAPE registry.
//
// Three URLs, and each one is a place where native fetch and the replaced
// `request` library disagree about the URL ITSELF rather than about what is
// served for it. docs/preserved-quirks.md 11.4 declares all three at the remote
// asset call site (lib/controllers/users.js's assetUploadFromURL), and none of
// them was reachable through this fixture: a data: URL classified as
// `unsupported-protocol:data:` and a URL on a blocked port classified as
// `unregistered-endpoint`, so both failed closed and reported THE FIXTURE's
// refusal, which is a different event from the runtime's. The only evidence
// either divergence had was a library probe run outside the harness.
//
// Named and exported for the same reason ASSET_URLS is: in all three the URL
// string is the whole of the case, so a driver names a shape here rather than
// typing a string at a call site - where a typo produces a different case that
// still looks like a pass. These are shapes, not recordings: no profile serves
// them and none of them consults the profile, because what each one exercises
// is a decision fetch takes before any response is chosen.
//
// The three outcomes, MEASURED on Node 22.23.2 with a
// net.Socket.prototype.connect tripwire in place - all three at ZERO sockets:
//   data         fetch RESOLVES it: 200, content-type `text/plain`, body "hi".
//                `request` threw `Invalid protocol: data:` synchronously.
//   credentialed fetch REFUSES to construct the request:
//                TypeError('Request cannot be constructed from a URL that
//                includes credentials: <url>'), with NO `cause`. `request`
//                moved the userinfo onto an Authorization header and fetched.
//   blockedPort  fetch REFUSES the request: TypeError('fetch failed') whose
//                `cause` is Error('bad port') with no own properties at all.
//                Measured against the control: the same host on port 8080
//                reaches DNS and fails ENOTFOUND, so the blocked-port refusal
//                really does precede the dispatch. `request` constrained the
//                port not at all.
//
// The credentialed and blockedPort entries are declared ON the registered
// asset path, so a reader can see that the credential and the port are the
// only things that differ from `ASSET_URLS.plain` - which is what makes them
// the shape they are meant to be. Neither needs to be in the asset registry:
// both are refused before it is consulted.
// ---------------------------------------------------------------------------
var DIVERGENT_URLS = {
  data         : 'data:text/plain,hi',
  credentialed : 'https://parity-user:parity-pass@parity.example.com/assets/fixture.gif',
  blockedPort  : 'http://parity.example.com:6000/assets/fixture.gif'
};

// The ports refused as blocked, and deliberately ONLY these three.
//
// The Fetch specification's blocked list is roughly eighty entries and it moves;
// transcribing it here would put a second, drifting copy of a browser policy in
// a fixture, and a wrong long list is worse than a short accurate one - it would
// refuse a port the runtime serves, or serve one the runtime refuses, and either
// way the harness would stop being an oracle. These three are the ones the
// divergence is pinned against and the ones measured above: 6000 (X11), 22
// (ssh) and 9 (discard). Every other port classifies normally, so a URL on one
// takes whichever arm its registration decides - which for an unregistered
// origin is still the fail-closed refusal and still never a socket.
var FETCH_BLOCKED_PORTS = {
  9    : 'discard',
  22   : 'ssh',
  6000 : 'X11'
};

// The registered URLs whose scheme is `data:`, which are the only URLs this
// file ever hands to the genuine fetch. Derived from the SCHEME rather than
// from the key name, so an entry added under the `data` key with an http URL
// would not become delegable - it would simply be an ordinary URL and would
// fail closed like any other. Adding a second data: URL here is a deliberate
// edit of this file, which is the level at which that decision belongs.
function registeredDataUrls() {
  return Object.keys(DIVERGENT_URLS)
    .map(function(name) { return DIVERGENT_URLS[name]; })
    .filter(function(url) { return url.indexOf('data:') === 0; });
}

// True only for a data: URL this file declares, compared as an EXACT string.
// A data: URL carries its payload in the URL, so there is no origin and no path
// to key on the way endpointKey() does for the http(s) registry: "the same
// shape" and "the same bytes" are one question here, and an origin+pathname key
// would admit any payload at all under text/plain.
function isRegisteredDataUrl(rawUrl) {
  return registeredDataUrls().indexOf(rawUrl) !== -1;
}

// The blocked port a parsed URL names, or 0. Only http(s) are considered: they
// are the schemes the Fetch specification's port check applies to among the
// ones anything here can reach, and the delegated data: URL has no authority to
// carry a port at all.
function blockedPortOf(parsed) {
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 0;
  }

  var port = parseInt(parsed.port, 10);

  return Object.prototype.hasOwnProperty.call(FETCH_BLOCKED_PORTS, port) ? port : 0;
}

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

// The accounts test/parity/seed.js actually creates, as (email, username)
// pairs. Declared locally with their provenance rather than imported, because
// requiring test/helpers/** is prohibited in this folder and requiring
// test/parity/seed.js would pull lib/models/** - and therefore
// mongoose-schema-extend - into a preload, which is what makes @hapi/hapi
// unloadable for the rest of the process. The values are copied verbatim from
// test/parity/seed.js's IDENTITIES block, which copies them in turn from
// test/helpers/defaults.js, so the three artifacts state one set of accounts.
//
// This list is what makes the identity contract CHECKABLE from inside the
// fixture: `existing` must be one of these, and `new` must be none of them.
// The fourth entry is the GOOGLE-LINKED account, seeded as
// `fixtures.oauthExisting` with `profiles.google.id` and an avatar already
// populated. It is a full member of this list rather than a special case: the
// seeder creates it exactly as it creates the other three, and omitting it was
// what made `checkIdentityContract` report the OAuth identity as unverified
// while the seeder was creating it all along.
var SEEDED_ACCOUNTS = [
  { email: 'test@dummy.com',            username: 'testing' },
  { email: 'admin@example.com',         username: 'administrator' },
  { email: 'disabled@example.com',      username: 'disableduser' },
  { email: 'parity-existing@example.com', username: 'parity-existing-example-com' }
];

// Which of those accounts the OAuth existing-user branch is driven against.
// Named rather than indexed so the choice reads as a decision: it is the
// google-linked account, for the no-write reason given in the SEEDING CONTRACT
// above, and not the seeded default user.
var OAUTH_EXISTING_ACCOUNT = SEEDED_ACCOUNTS[3];

// Which database branch googleCallback takes is decided by the EMAIL served
// here, matched by `lib/models/user.js`'s `findByMultiple`, whose query is an
// $or over the email, the derived username and profiles.google.id. So
// `existing` has to be an address the seeder really creates and `new` has to
// miss all three criteria.
//
// `existing` is the seeder's GOOGLE-LINKED account, which is the one branch
// this profile is named for: its `profiles.google` is already populated, so
// googleCallback logs it in without writing to it. It briefly pointed at the
// seeded default user instead, which does reach the existing-user branch but
// through its account-LINKING path - a write to the document every other
// scenario reads. checkIdentityContract() below refuses any configuration that
// would invert the two branches, and the self-check compares these literals
// against test/parity/seed.js's `oauthIdentities` export.
var identities = {
  existing         : OAUTH_EXISTING_ACCOUNT.email,
  new              : 'parity-newcomer@example.com',
  existingUsername : derivedUsername(OAUTH_EXISTING_ACCOUNT.email),
  newUsername      : derivedUsername('parity-newcomer@example.com')
};

// Applies an alignment, validating each address. Exposed as setIdentityEmails()
// and called at load time from PARITY_HTTP_IDENTITIES, so the documented hook
// has a caller in every process that loads this file instead of only in
// principle.
function applyIdentityEmails(next) {
  if (!next || typeof next !== 'object') {
    throw new Error('test/parity/fixtures/http.js: setIdentityEmails requires an object with `existing` and/or `new`');
  }

  ['existing', 'new'].forEach(function(key) {
    if (next[key] === undefined) {
      return;
    }

    if (typeof next[key] !== 'string' || next[key].indexOf('@') === -1) {
      throw new Error('test/parity/fixtures/http.js: setIdentityEmails `' + key +
        '` must be an email address');
    }
  });

  if (next.existing !== undefined) {
    identities.existing = next.existing;
    identities.existingUsername = derivedUsername(next.existing);
  }

  if (next.new !== undefined) {
    identities.new = next.new;
    identities.newUsername = derivedUsername(next.new);
  }

  return {
    existing         : identities.existing,
    new              : identities.new,
    existingUsername : identities.existingUsername,
    newUsername      : identities.newUsername
  };
}

// Checks the two identities against the seeded set and against each other, and
// reports every violation rather than the first. The check is deliberately
// conservative about `existing`: an address the fixture cannot see in
// SEEDED_ACCOUNTS is not necessarily unseeded - a seeder may have been extended
// - so it is reported as UNVERIFIED and only becomes a violation when
// `requireSeeded` is set, which is what a harness driving the OAuth branches
// passes. `new` is different: an address that IS in the seeded set, or whose
// derived username collides with a seeded username, provably inverts the
// new-user branch, so it is always a violation.
function checkIdentityContract(options) {
  var opts = options || {};
  var violations = [];
  var unverified = [];

  var existingSeeded = SEEDED_ACCOUNTS.some(function(account) {
    return account.email === identities.existing;
  });

  if (!existingSeeded) {
    var message = 'identities.existing ' + JSON.stringify(identities.existing) +
      ' is not one of the accounts this fixture knows test/parity/seed.js to ' +
      'create (' + SEEDED_ACCOUNTS.map(function(a) { return a.email; }).join(', ') +
      '). The OAuth existing-user branch is only exercised when the served ' +
      'email matches a seeded account, so either seed this address or align ' +
      'through setIdentityEmails()/PARITY_HTTP_IDENTITIES.';

    if (opts.requireSeeded) {
      violations.push(message);
    }
    else {
      unverified.push(message);
    }
  }

  SEEDED_ACCOUNTS.forEach(function(account) {
    if (account.email === identities.new) {
      violations.push('identities.new ' + JSON.stringify(identities.new) +
        ' is a SEEDED account, so the OAuth new-user branch cannot be reached: ' +
        'User.findByMultiple would match it and the existing-user branch would ' +
        'run instead');
    }

    if (account.username === identities.newUsername) {
      violations.push('identities.new ' + JSON.stringify(identities.new) +
        ' derives the username ' + JSON.stringify(identities.newUsername) +
        ', which is the seeded username of ' + JSON.stringify(account.email) +
        '. User.findByMultiple matches on the derived username as well as the ' +
        'email, so the new-user branch cannot be reached.');
    }
  });

  if (identities.existing === identities.new) {
    violations.push('identities.existing and identities.new are the same ' +
      'address, so the two OAuth database branches cannot be distinguished');
  }

  if (GOOGLE_ID_EXISTING === GOOGLE_ID_NEW) {
    violations.push('the two Google account ids are equal, so ' +
      'profiles.google.id would match the seeded user on the new-user branch');
  }

  return {
    existing         : identities.existing,
    existingUsername : identities.existingUsername,
    existingSeeded   : existingSeeded,
    new              : identities.new,
    newUsername      : identities.newUsername,
    seededAccounts   : SEEDED_ACCOUNTS.map(function(a) { return a.email; }),
    unverified       : unverified,
    violations       : violations,
    ok               : !violations.length
  };
}

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
// error-edge inventory needs.
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
// non-200 is not merely a falsy success but a different object.
var RECAPTCHA_NON_200 = {
  outcome : 'recaptcha-503',
  status  : 503,
  headers : HTML_HEADERS,
  body    : '<html><body>Service Unavailable</body></html>'
};

// reCAPTCHA outcome 5: a transport failure. `err` is never inspected, so
// `response` stays undefined.
//
// DELIVERED (measured, this tree): lib/util/recaptcha.js recognises the absent
// response and calls back with `{status: false}` - the same value outcome 4
// delivers - after logging one line naming the provider as unreachable. The
// process survives, and POST /users answers 302 as it does under outcome 4.
//
// Baseline read `response.statusCode` off that undefined response, so the
// TypeError escaped an event-emitter callback as an uncaught exception, `cb`
// was never invoked, and the process exited 1. The guard that changed it is the
// approved deviation recorded at docs/preserved-quirks.md 10.7: a remote,
// unauthenticated path to process termination is not behaviour a client can
// depend on. The record itself is unchanged - what the provider does is the
// same event either way - so this response still drives the baseline outcome on
// the baseline worktree, where the guard does not exist.
var RECAPTCHA_TRANSPORT_FAILURE = {
  outcome   : 'recaptcha-transport-failure',
  transport : { code: 'ECONNREFUSED', host: 'www.google.com', port: 443 }
};

// Structurally outcome 3 - a 200 the module parses successfully and delivers
// verbatim - with a body that is valid JSON and NOT AN OBJECT.
//
// It is deliberately not one of the two guarded faults, and that is the whole
// reason it is recorded separately. lib/util/recaptcha.js guards the response
// and the parse; it does not inspect what the parse produced, so `null` is
// delivered to the caller exactly as baseline delivered it. The read of
// `success` then happens at the CALLER - lib/controllers/users.js:144, :379,
// :1128 and lib/controllers/trinket.js:1033 - inside its own lifecycle method,
// where a throw reaches the preserved Layer 1 catch-all in
// lib/util/routeParser.js and answers 500 with the process alive. So this is
// the boundary of the approved deviation, from the other side: a provider fault
// that still throws, but throws somewhere a funnel already handles.
//
// Recorded so that boundary can be DRIVEN and its outcome recorded rather than
// asserted from this comment. `null` is the clean case because it is the only
// non-object a real siteverify body could plausibly be, and because a
// property read off it throws rather than merely returning undefined - `42`
// would read `undefined` and fail the verification quietly instead.
var RECAPTCHA_NON_OBJECT_BODY = {
  outcome : 'recaptcha-200-null-body',
  status  : 200,
  headers : JSON_HEADERS,
  body    : 'null'
};

// reCAPTCHA outcome 6: a 200 whose body is not JSON - the HTML error page a
// proxy answers with.
//
// DELIVERED (measured, this tree): the JSON.parse failure is caught at the call
// site, which logs one line carrying a bounded excerpt of the body and calls
// back with `{status: false}`. Same value as outcome 5, and deliberately: both
// faults fail the verification closed on the outcome a rejected challenge
// already produces. Baseline let the SyntaxError escape uncaught with `cb`
// never invoked; the same approved deviation covers it.
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

// A 200 whose body parses to a NON-OBJECT. A body of 'null' arrives as null,
// which is a value no object dereference survives.
//
// DELIVERED (measured, this tree): lib/controllers/auth.js's token guard tests
// the body before it reads it - `if (err || !body || !body.access_token)` - so
// this edge rejects with `Error('Failed to get access token')` and lands on the
// generic authentication failure, which for a browser request is a 302 to
// /signup with the message flashed. It is now the same route outcome the other
// seven provider profiles produce, and the process survives.
//
// Baseline dereferenced it unguarded, so the TypeError escaped a next-tick
// callback as an uncaught exception and one unauthenticated
// GET /auth/google/callback ended the process. The guard is the approved
// deviation recorded at docs/preserved-quirks.md 10.7. The record is kept
// separate from TOKEN_MALFORMED_BODY even though the two now produce the same
// response, because they are different provider faults - an object with a
// field missing against a body that is not an object at all - and only this one
// reaches the `!body` test.
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

// The same shape with an UNSEEDED email, which is what selects the new-user
// branch. The controller then saves the user, sets the
// yar `next` and `grantDemoTrinkets` values, and throws a ReferenceError on an
// undefined `opts` - so the account is created and a generic failure is
// reported. That outcome is reproduced deliberately.
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

// A 200 whose body parses to a NON-OBJECT, mirroring TOKEN_NON_OBJECT_BODY on
// the profile endpoint. This is the record for the SECOND OAuth guard, and it
// existed for the first one only: `!profile ||` at
// lib/controllers/auth.js:441 had no profile driving it, so the one edge that
// reaches it was undrivable through this fixture.
//
// It is not the same case as USERINFO_MISSING_EMAIL. That one delivers an
// object whose `email` is absent, so it reaches the SECOND half of the guard;
// this one delivers a value that is not an object at all, so it reaches the
// first. Both now produce the same route outcome - `Google OAuth error: Failed
// to get user profile` logged at lib/controllers/auth.js:562, then the generic
// authentication failure, which for a browser request is a 302 to /signup with
// the message flashed - and that is exactly why both records exist: one
// response cannot evidence two guards.
//
// Baseline dereferenced this value unguarded and the TypeError ended the
// process, as it did at the token endpoint; the same approved deviation at
// docs/preserved-quirks.md 10.7 covers both.
var USERINFO_NON_OBJECT_BODY = {
  outcome : 'userinfo-200-null-body',
  status  : 200,
  headers : JSON_HEADERS,
  body    : 'null'
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

// A 500 is the same EVENT as the 404 - not a transport error, so it still
// reaches 'end' and its body is uploaded - but a different status, different
// bytes and therefore a different stored key. Recorded separately because one
// record cannot evidence two statuses, and because a status-class test that
// only ever sees 404 says nothing about 5xx.
var ASSET_SERVER_ERROR = {
  outcome     : 'asset-500-uploaded',
  mode        : 'non-2xx',
  status      : 500,
  contentType : 'text/html; charset=UTF-8',
  bytes       : ASSET_SERVER_ERROR_PAGE
};

// A 302 is followed for GET and only the FINAL response is observable, so the
// record carries the final status, the final content-type and the final bytes,
// with the intermediate hops carried separately.
//
// `hops` is the chain, one entry per intermediate response, and it is what
// makes redirect behaviour testable in three directions at once: a caller that
// follows (the asset call site) observes only the final response; a caller that
// asks for 'manual' observes the FIRST hop, status and Location intact, which
// is the only shape a hop-counting loop can work from; and a chain longer than
// the mechanism's limit fails instead of succeeding. `redirectStatus` and
// `redirectLocation` are retained because the `request` stream form announces
// the first hop through its own 'redirect' event.
function redirectChain(hopCount, destination) {
  var hops = [];

  for (var i = 1; i <= hopCount; i++) {
    hops.push({
      status   : 302,
      // Hop i points at hop i+1, and the last hop points at the destination.
      location : (i === hopCount ? destination : ASSET_HOP_PREFIX + (i + 1))
    });
  }

  return hops;
}

var ASSET_REDIRECT = {
  outcome            : 'asset-302-followed',
  mode               : 'redirect',
  status             : 200,
  contentType        : 'image/png',
  bytes              : ASSET_PNG,
  hops               : redirectChain(1, ASSET_URLS.redirect),
  redirectStatus     : 302,
  redirectLocation   : ASSET_URLS.redirect
};

// A chain of exactly 10 hops: inside both the replaced library's limit and the
// runtime's, so it must still deliver the final response on either mechanism.
var ASSET_REDIRECT_WITHIN_LIMIT = {
  outcome            : 'asset-302-chain-within-legacy-limit',
  mode               : 'redirect',
  status             : 200,
  contentType        : 'image/png',
  bytes              : ASSET_PNG,
  hops               : redirectChain(ASSET_HOPS_WITHIN_LEGACY_LIMIT, ASSET_URLS.redirect),
  redirectStatus     : 302,
  redirectLocation   : ASSET_HOP_PREFIX + '2'
};

// A chain of 11 hops: outside the replaced library's 10 and inside the
// runtime's 20. This is the boundary where the two mechanisms disagree, and
// serving it is how a claim about which limit the call site now enforces stops
// being an assertion in a comment. On the `request` mechanism the fixture
// enforces LEGACY_MAX_REDIRECTS and the chain fails; through native fetch it is
// followed, which is exactly the drift the migration has to be able to see.
var ASSET_REDIRECT_BEYOND_LIMIT = {
  outcome            : 'asset-302-chain-beyond-legacy-limit',
  mode               : 'redirect',
  status             : 200,
  contentType        : 'image/png',
  bytes              : ASSET_PNG,
  hops               : redirectChain(ASSET_HOPS_BEYOND_LEGACY_LIMIT, ASSET_URLS.redirect),
  redirectStatus     : 302,
  redirectLocation   : ASSET_HOP_PREFIX + '2'
};

// 'error' only, and NEVER 'end': the upload does not start and the route is
// left unsettled.
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
//
// The two OAuth handlers guard on config.app.auth.google.clientID and
// short-circuit to request.fail when it is absent, so clientID, clientSecret
// and callbackURL must be present in the composed NODE_CONFIG for the oauth:*
// profiles to be reachable THROUGH ROUTES. Direct invocation needs none of
// them.
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
  'recaptcha:non-object-body'   : { description: 'siteverify 200 whose body is valid JSON but not an object - verify() delivers `null` verbatim, so reading `success` throws in the CALLER\'s lifecycle method and reaches the Layer 1 catch-all: 500 with the process alive.', recaptcha: RECAPTCHA_NON_OBJECT_BODY },
  'recaptcha:transport-failure' : { description: 'siteverify transport failure - the absent response is recognised and verify() calls back with {status:false}; the process survives and POST /users answers 302.', recaptcha: RECAPTCHA_TRANSPORT_FAILURE },
  'recaptcha:malformed-json'    : { description: 'siteverify 200 with a non-JSON body - the parse failure is caught and verify() calls back with {status:false}; the process survives and POST /users answers 302.', recaptcha: RECAPTCHA_MALFORMED_JSON },

  'oauth:success-existing-user'    : { description: 'Token and profile succeed; the email is the seeded user.', token: TOKEN_SUCCESS, userinfo: userinfoExisting },
  'oauth:success-new-user'         : { description: 'Token and profile succeed; the email is unseeded, so the account is created and a generic failure is reported.', token: TOKEN_SUCCESS, userinfo: userinfoNew },
  'oauth:token-non-2xx'            : { description: 'Token endpoint 400 - generic authentication failure.', token: TOKEN_NON_2XX },
  'oauth:token-malformed-body'     : { description: 'Token endpoint 200 with no access_token - generic authentication failure.', token: TOKEN_MALFORMED_BODY },
  'oauth:token-non-object-body'    : { description: 'Token endpoint 200 whose body parses to null - the `!body` guard rejects with Error("Failed to get access token"), so it reaches the generic authentication failure and the process survives.', token: TOKEN_NON_OBJECT_BODY },
  'oauth:token-transport-failure'  : { description: 'Token endpoint transport failure - generic authentication failure.', token: TOKEN_TRANSPORT_FAILURE },
  'oauth:profile-missing-email'    : { description: 'Profile 200 with no email - generic authentication failure.', token: TOKEN_SUCCESS, userinfo: USERINFO_MISSING_EMAIL },
  'oauth:profile-non-object-body'  : { description: 'Profile 200 whose body parses to null - the `!profile` guard rejects with Error("Failed to get user profile"), so it reaches the generic authentication failure and the process survives.', token: TOKEN_SUCCESS, userinfo: USERINFO_NON_OBJECT_BODY },
  'oauth:profile-transport-failure': { description: 'Profile endpoint transport failure - generic authentication failure.', token: TOKEN_SUCCESS, userinfo: USERINFO_TRANSPORT_FAILURE },

  'asset:success'           : { description: 'response, fixed bytes, end - the upload stores sha1 d5fceb6532643d0d84ffe09c40c481ecdf59e15a.', asset: ASSET_COMPLETE },
  'asset:non-2xx'           : { description: '404 that still reaches end, so the error page is uploaded as text/html.', asset: ASSET_NON_2XX },
  'asset:server-error'      : { description: '500 that still reaches end, so the error page is uploaded - a distinct status and distinct stored bytes from the 404.', asset: ASSET_SERVER_ERROR },
  'asset:redirect'          : { description: '302 followed for GET; only the final 200 is observable.', asset: ASSET_REDIRECT },
  'asset:redirect-within-limit' : { description: 'A 10-hop chain: inside both the legacy 10-redirect limit and the runtime\'s 20, so the final response is still delivered.', asset: ASSET_REDIRECT_WITHIN_LIMIT },
  'asset:redirect-beyond-limit' : { description: 'An 11-hop chain: outside the legacy limit and inside the runtime\'s, which is the boundary where the two mechanisms disagree.', asset: ASSET_REDIRECT_BEYOND_LIMIT },
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
// Exit codes. The first three are the convention every tool in test/parity/
// uses; the fourth is this file's own, and it is deliberately distinguishable
// from a failing assertion because the two mean different things: a failed
// case is a result, whereas an unprotected process is a run that must not
// produce evidence at all.
// ---------------------------------------------------------------------------
var EXIT_OK          = 0;
var EXIT_ERROR       = 1;
var EXIT_USAGE       = 2;
var EXIT_UNPROTECTED = 4;

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
  requestRequired  : false,  // `request` resolves from appRoot, so it MUST be patched
  requestModule    : null,   // the Module record whose exports were swapped
  originalRequest  : null,   // the genuine `request` export, for restore()
  originalFetch    : null,   // the genuine globalThis.fetch, for restore()
  resolveDiagnostic: null,   // why the `request` mechanism is inactive, if it is
  profileFileState : null,   // last value read from PARITY_HTTP_PROFILE_FILE
  calls            : [],
  // Every breach of a request contract, kept separately from the log so
  // assertRequestContract() can answer without re-reading the evidence file.
  contractViolations : [],
  // One counter per (endpoint, profile, outcome) actually served. A fixture
  // profile check that cannot see whether a call happened at all can pass on an
  // empty run, so the counts are part of the evidence rather than derived from
  // it after the fact.
  served           : {},
  // The install handshake: what was patched, in which tree, by which file.
  handshake        : null
};

// The digest used for body evidence and for the asset-byte digests the storage
// contract keys on. sha1 rather than something stronger deliberately:
// lib/util/file.js derives the stored S3 object key from the sha1 of the
// uploaded bytes, so this is the value a storage assertion has to compare
// against.
function sha1(value) {
  return crypto.createHash('sha1')
    .update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'))
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Evidence log. Nothing here may ever throw into the application, and nothing
// here may emit to stdout or stderr: the zero-warning gate captures both
// streams for the whole run.
// ---------------------------------------------------------------------------

// Appends one record and, when PARITY_HTTP_LOG is set, writes it through
// immediately. Writing per call rather than only on flush() is deliberate:
// `asset:transport-refused` never settles, the three delegated and refused URL
// shapes return without a response, and on the BASELINE worktree
// `recaptcha:transport-failure`, `recaptcha:malformed-json` and
// `oauth:token-non-object-body` still end in an uncaught throw that ends the
// process - so evidence buffered in memory would be lost exactly where it is
// most needed. The delivered tree guards those three, and this file's own
// child cases read their evidence from the appended log either way.
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
//
// Every record written through here carries an `event` key, and every record
// written through recordCall() does not. That is not a style choice:
// test/parity/replay.js classifies the fixture's log by exactly that key, so an
// `event`-bearing record is counted as a fixture note and an `event`-free one
// as an intercepted call served under the profile named at its top level.
function note(event, detail) {
  record({ event: event, detail: detail === undefined ? null : detail });
}

// Records one intercepted call: the endpoint, the mechanism, the outcome
// served, and the full description of what was sent. The five original fields
// keep their names and their position at the top level, so every existing
// consumer reads it unchanged; `request` and `registration` are additions.
function recordCall(classified, mechanism, description, outcome) {
  var endpoint = classified.endpoint || 'unknown';
  var key = endpoint + '|' + state.activeProfile + '|' + outcome;

  state.served[key] = (state.served[key] || 0) + 1;

  record({
    mechanism    : mechanism,
    endpoint     : endpoint,
    url          : redactUrl(classified.url),
    method       : description ? description.method : null,
    profile      : state.activeProfile,
    outcome      : outcome,
    registration : classified.registration || null,
    reason       : classified.reason || null,
    request      : description || null
  });
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
    // blind from inside a request: fs.mkdirSync on a path under an
    // unreadable parent can BLOCK indefinitely where appendFileSync on the
    // same path returns ENOENT at once. A fixture must never be able to stall
    // the process it is loaded into.
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
// DEP0169 on every call.
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

// ---------------------------------------------------------------------------
// The registry every URL is matched against. Both halves are (origin,
// pathname) keys built with `new URL`, so a query string, a port spelled
// explicitly or a caller's trailing-slash habit cannot break matching, while an
// origin or a path nothing records cannot slip through either.
// ---------------------------------------------------------------------------

// origin + pathname, the key form used on both sides of the match.
function endpointKey(parsed) {
  return parsed.origin + parsed.pathname;
}

// Builds the asset half of the registry: the enumerated asset URLs plus every
// redirect hop any profile can serve. Hops are registered because a caller
// following a chain itself requests each hop URL in turn, and an unregistered
// hop would fail as an unrecorded endpoint half way through its own chain.
//
// Memoized on the declared-URL variable rather than built per call, because
// classify() runs several times per intercepted request. The key is the
// variable's own value, so a corpus that registers a URL mid-run still takes
// effect on its next call - the registry is re-derived exactly when its input
// changes and not otherwise.
var assetRegistryCache = { key: null, registry: null };

function buildAssetRegistry() {
  var declaredKey = process.env.PARITY_HTTP_ASSET_URLS || '';
  if (assetRegistryCache.registry && assetRegistryCache.key === declaredKey) {
    return assetRegistryCache.registry;
  }

  var registry = {};
  var maxHops = Math.max(ASSET_HOPS_WITHIN_LEGACY_LIMIT, ASSET_HOPS_BEYOND_LEGACY_LIMIT);

  Object.keys(ASSET_URLS).forEach(function(name) {
    registry[endpointKey(new URL(ASSET_URLS[name]))] = 'asset:' + name;
  });

  for (var hop = 1; hop <= maxHops; hop++) {
    registry[endpointKey(new URL(ASSET_HOP_PREFIX + hop))] = 'asset:hop-' + hop;
  }

  // Additional asset URLs a corpus may need, declared through the environment
  // rather than by editing this file - which is the supported way to extend the
  // registry, precisely because extending it has to be a deliberate act. Each
  // entry must be an absolute http(s) URL; anything else is logged and ignored,
  // and ignoring it means the URL stays unrecorded, which fails closed.
  var declared = process.env.PARITY_HTTP_ASSET_URLS;
  if (declared) {
    var parsedList = null;
    try {
      parsedList = JSON.parse(declared);
    }
    catch (e) {
      note('asset-registry-malformed', { value: declared });
    }

    if (parsedList && Array.isArray(parsedList)) {
      parsedList.forEach(function(entry) {
        try {
          var url = new URL(String(entry));
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            note('asset-registry-rejected', { entry: String(entry), reason: 'unsupported-protocol:' + url.protocol });
            return;
          }
          registry[endpointKey(url)] = 'asset:declared';
        }
        catch (e) {
          note('asset-registry-rejected', { entry: String(entry), reason: 'unparseable-url' });
        }
      });
    }
    else if (parsedList) {
      note('asset-registry-rejected', { value: declared, reason: 'not-an-array' });
    }
  }

  assetRegistryCache.key = declaredKey;
  assetRegistryCache.registry = registry;

  return registry;
}

// Maps a URL onto one of the four endpoint classes, FAILING CLOSED.
//
// The three JSON endpoints match on origin plus pathname. An asset fetch
// matches only when its (origin, pathname) is in the asset registry above.
// EVERYTHING ELSE IS UNRECORDED - a non-http scheme, an unparseable string, a
// missing URL, and, the case that matters, a perfectly parseable https URL on
// an origin or a path no profile describes.
//
// That last clause is what keeps the no-network guarantee falsifiable.
// Returning the asset class for any parseable http(s) URL would serve the
// active profile's asset bytes to a call nothing had recorded - a new outbound
// integration, or an SSRF payload reaching a host the application was never
// meant to contact - and nothing could then distinguish "recorded and served"
// from "unknown and served anyway". Unrecorded fails through the calling
// mechanism's own failure shape with code PARITY_UNRECORDED, which is visible,
// deterministic, and still never a socket.
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

  var key = endpointKey(parsed);
  var names = Object.keys(ENDPOINT_URLS);
  for (var i = 0; i < names.length; i++) {
    if (endpointKey(new URL(ENDPOINT_URLS[names[i]])) === key) {
      return { endpoint: names[i], url: rawUrl };
    }
  }

  var assetRegistry = buildAssetRegistry();
  if (Object.prototype.hasOwnProperty.call(assetRegistry, key)) {
    return {
      endpoint     : 'asset',
      url          : rawUrl,
      registration : assetRegistry[key],
      // Which hop of a chain was asked for, when the caller is following the
      // chain itself. `0` means the chain's entry point.
      hop          : hopNumberOf(parsed)
    };
  }

  return {
    endpoint : null,
    url      : rawUrl,
    reason   : 'unregistered-endpoint',
    registry : Object.keys(assetRegistry).length
  };
}

// The classification one of the three URL-shape arms records: whatever
// classify() decided, with the divergence named in the two fields recordCall
// already writes at the top level of every record.
//
// It exists because the outcome name alone does not settle the question a
// reviewer actually asks of this route. All three arms leave the asset call site
// on its log-only failure arm, so the route hangs either way, and "refused
// because the URL carried credentials" and "refused because nothing recorded
// it" arrive at the same place; naming the shape in `registration` is what
// separates a divergence the harness DROVE from an omission in the corpus.
// classify()'s own decision is carried through untouched, so a shape on a
// registered path still records the endpoint it belongs to.
function divergentClassification(classified, shape, reason) {
  return {
    endpoint     : classified.endpoint,
    url          : classified.url,
    registration : 'divergence:' + shape,
    reason       : reason,
    hop          : classified.hop
  };
}

// The hop number encoded in a hop URL, or 0 for any other asset URL.
function hopNumberOf(parsed) {
  var prefix = new URL(ASSET_HOP_PREFIX);
  if (parsed.origin !== prefix.origin || parsed.pathname.indexOf(prefix.pathname) !== 0) {
    return 0;
  }

  var suffix = parsed.pathname.slice(prefix.pathname.length);
  var value = parseInt(suffix, 10);
  return isNaN(value) ? 0 : value;
}

// ---------------------------------------------------------------------------
// Failure construction.
// ---------------------------------------------------------------------------

// The Error a refused or reset connection produced, reproduced field for
// field from the measured original: name 'Error', a message naming the host
// and port, and code/errno/syscall. Deterministic - the host and port come
// from the record, never from a live socket.
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
    JSON.stringify(redactUrl(classified.url)) + ' under profile ' + JSON.stringify(state.activeProfile) +
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
// must be the Error the replaced library reported directly.
function fetchFailure(cause) {
  var err = new TypeError('fetch failed');
  err.cause = cause;
  return err;
}

// The error a call that breached its endpoint's request contract produces.
// Transport-shaped for the same reason unrecordedError is - it has to travel
// the funnel the call site already handles - but with its own code, so a
// contract breach can never be read as a network event or as a missing
// recording.
function contractError(classified, mechanism, violations) {
  var err = new Error(
    'test/parity/fixtures/http.js: the request to ' + JSON.stringify(redactUrl(classified.url)) +
    ' does not satisfy the recorded contract for the ' + classified.endpoint +
    ' endpoint on the ' + mechanism + ' mechanism, so no recorded response ' +
    'applies to it: ' + violations.join('; ')
  );

  err.code = 'PARITY_CONTRACT';
  err.syscall = 'connect';
  err.parityMechanism = mechanism;
  err.parityProfile = state.activeProfile;
  err.parityViolations = violations.slice();

  return err;
}

// ---------------------------------------------------------------------------
// Request description: what was sent, recorded exactly, with credentials
// redacted.
//
// The wire encoding of the two OAuth calls and of reCAPTCHA is hand-written -
// the private rfc3986/formEncode/legacyJsonRequest helpers in
// lib/controllers/auth.js and the URLSearchParams body in
// lib/util/recaptcha.js - so without an oracle over what was SENT, a dropped
// header, a renamed form field or a `+` where %20 belongs would be served the
// same recorded response and produce an identical corpus.
//
// Everything below is therefore recorded per call - method, header names and
// values, body encoding, body field names, byte length and digest, and the
// redirect mode - and then checked against the endpoint's contract.
//
// Redaction is not optional and not cosmetic. A URL can carry userinfo and a
// signed query, an Authorization header carries a bearer token, and a form body
// carries the reCAPTCHA secret, the OAuth client secret and the authorization
// code. Evidence is written to a file and quoted into error messages, so each of
// those is replaced by a marker that preserves its SHAPE - which is what the
// contract asserts on - and never its value.
// ---------------------------------------------------------------------------

var REDACTED = '<redacted>';

// Headers whose value is a credential and whose SCHEME is part of the contract.
// Only these two keep anything: the scheme is what `userinfo`'s contract
// asserts on, and it is not itself a secret.
var SCHEME_BEARING_HEADERS = ['authorization', 'proxy-authorization'];

// Headers whose value is a credential with nothing worth keeping. Redacted
// WHOLE, never up to the first space: that rule belongs to the two
// scheme-bearing headers above and applied here would write
// `session=SECRET;` out of `session=SECRET; Path=/`, or the first word of an
// API key that happens to contain a space.
var OPAQUE_CREDENTIAL_HEADERS = [
  'cookie', 'set-cookie', 'x-api-key', 'x-goog-api-key', 'x-auth-token',
  'x-amz-security-token', 'x-amz-credential', 'x-csrf-token', 'x-xsrf-token'
];

// Body and query field names whose values are credentials or one-time secrets.
// The named list carries the fields these four call sites actually send; the
// pattern catches the rest, because a field this file has never seen is
// exactly the one whose value must not be written down. Both are consulted, so
// a new signed-query parameter is redacted without this list being edited.
var SENSITIVE_FIELDS = [
  'secret', 'client_secret', 'code', 'response', 'access_token', 'refresh_token',
  'id_token', 'password', 'token', 'signature', 'sig', 'session'
];

var SENSITIVE_FIELD_PATTERN = /(secret|token|password|passwd|signature|credential|api[-_]?key|auth|session|cookie|sig|nonce)/i;

function isSensitiveHeader(name) {
  var lower = String(name).toLowerCase();
  return SCHEME_BEARING_HEADERS.indexOf(lower) !== -1 ||
    OPAQUE_CREDENTIAL_HEADERS.indexOf(lower) !== -1 ||
    SENSITIVE_FIELD_PATTERN.test(lower);
}

function isSensitiveField(name) {
  var lower = String(name).toLowerCase();
  return SENSITIVE_FIELDS.indexOf(lower) !== -1 || SENSITIVE_FIELD_PATTERN.test(lower);
}

// A URL safe to write down. Evidence is a file and error messages are strings,
// so nothing that reaches either may carry a credential.
//
// Userinfo is removed and the removal is marked, because "this URL carried
// credentials in its authority" is itself evidence. Sensitive query values are
// replaced. Input that is not a URL is reduced to a DIGEST rather than written
// out verbatim: a malformed string has no credential structure but can still
// carry a signed query in its bytes, and the digest keeps two runs comparable
// without carrying the value. Never throws.
function redactUrl(rawUrl) {
  if (rawUrl === null || rawUrl === undefined || rawUrl === '') {
    return '';
  }

  if (typeof rawUrl !== 'string') {
    return 'non-string-url:sha1:' + sha1(String(rawUrl)).slice(0, 12);
  }

  var parsed;
  try {
    parsed = new URL(rawUrl);
  }
  catch (e) {
    return 'unparseable-url:sha1:' + sha1(rawUrl).slice(0, 12);
  }

  var hadUserinfo = !!(parsed.username || parsed.password);
  parsed.username = '';
  parsed.password = '';

  var keys = [];
  parsed.searchParams.forEach(function(value, name) {
    if (isSensitiveField(name)) {
      keys.push(name);
    }
  });
  keys.forEach(function(name) {
    parsed.searchParams.set(name, REDACTED);
  });

  return (hadUserinfo ? 'userinfo-stripped:' : '') + parsed.href;
}

// Header names and redacted values, lowercased. Accepts the three shapes a
// caller can pass: a plain object, a Headers instance, and an array of pairs.
function redactHeaders(source) {
  var out = {};

  headerPairs(source).forEach(function(pair) {
    var name = String(pair[0]).toLowerCase();
    var value = pair[1];
    var text = value === undefined || value === null ? '' : String(value);

    if (SCHEME_BEARING_HEADERS.indexOf(name) !== -1) {
      // The scheme is kept and the credential dropped: `userinfo`'s contract
      // asserts on the scheme, and the token must never reach the corpus.
      var space = text.indexOf(' ');
      out[name] = space > 0 ? text.slice(0, space + 1) + REDACTED : REDACTED;
      return;
    }

    if (isSensitiveHeader(name)) {
      out[name] = REDACTED;
      return;
    }

    out[name] = text;
  });

  return out;
}

// The header pairs a caller supplied, in whichever of the three shapes.
function headerPairs(source) {
  if (!source) {
    return [];
  }

  if (typeof source.forEach === 'function' && typeof source.get === 'function') {
    var collected = [];
    source.forEach(function(value, name) { collected.push([name, value]); });
    return collected;
  }

  if (Array.isArray(source)) {
    return source.slice();
  }

  if (typeof source === 'object') {
    return Object.keys(source).map(function(name) { return [name, source[name]]; });
  }

  return [];
}

// What a scheme-bearing header carried, WITHOUT carrying it: the scheme, and
// whether a non-empty credential followed it. The contract needs the second
// fact - an `Authorization: Bearer ` with nothing after the space is a
// different request from one with a token, and the redacted value cannot tell
// them apart - so it is computed here, before redaction, and recorded as a
// boolean.
function credentialShapes(source) {
  var shapes = {};

  headerPairs(source).forEach(function(pair) {
    var name = String(pair[0]).toLowerCase();
    if (SCHEME_BEARING_HEADERS.indexOf(name) === -1) {
      return;
    }

    var text = pair[1] === undefined || pair[1] === null ? '' : String(pair[1]);
    var space = text.indexOf(' ');

    shapes[name] = {
      scheme              : space > 0 ? text.slice(0, space) : null,
      credentialPresent   : space > 0 && text.slice(space + 1).trim().length > 0
    };
  });

  return shapes;
}

// Reads the header value a caller supplied, before redaction, so the contract
// can assert on it. Same three accepted shapes.
function headerValue(source, wanted) {
  if (!source) {
    return undefined;
  }

  var target = String(wanted).toLowerCase();
  var found;

  if (typeof source.get === 'function') {
    found = source.get(target);
    return found === null ? undefined : found;
  }

  var pairs = Array.isArray(source)
    ? source
    : Object.keys(source).map(function(name) { return [name, source[name]]; });

  pairs.forEach(function(pair) {
    if (String(pair[0]).toLowerCase() === target) {
      found = pair[1];
    }
  });

  return found === undefined || found === null ? undefined : String(found);
}

// The bytes a body amounts to, as a string, for the shapes these four call
// sites can produce: a string, URLSearchParams, a Buffer or a Uint8Array.
// Anything else is reported by its type rather than guessed at.
function bodyTextOf(body) {
  if (body === undefined || body === null) {
    return { text: '', kind: 'none' };
  }

  if (typeof body === 'string') {
    return { text: body, kind: 'string' };
  }

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return { text: body.toString(), kind: 'urlsearchparams' };
  }

  if (Buffer.isBuffer(body)) {
    return { text: body.toString('utf8'), kind: 'buffer' };
  }

  if (body instanceof Uint8Array) {
    return { text: Buffer.from(body).toString('utf8'), kind: 'uint8array' };
  }

  return { text: '', kind: 'unsupported:' + typeof body };
}

// Splits an application/x-www-form-urlencoded body into field names and
// redacted values WITHOUT URLSearchParams, because URLSearchParams decodes '+'
// as a space and would erase the very distinction the token contract asserts:
// the replaced library's qs encoder never emitted a raw '+', so one appearing
// in the body is a changed encoding rather than a value containing a plus.
function parseFormBody(text) {
  var fields = [];
  var values = {};

  if (!text) {
    return { fields: fields, values: values };
  }

  text.split('&').forEach(function(pair) {
    if (!pair) {
      return;
    }

    var split = pair.indexOf('=');
    var rawName = split === -1 ? pair : pair.slice(0, split);
    var rawValue = split === -1 ? '' : pair.slice(split + 1);
    var name;

    try {
      name = decodeURIComponent(rawName);
    }
    catch (e) {
      name = rawName;
    }

    fields.push(name);

    if (isSensitiveField(name)) {
      values[name] = rawValue === '' ? '' : REDACTED;
      return;
    }

    try {
      values[name] = decodeURIComponent(rawValue);
    }
    catch (e) {
      values[name] = rawValue;
    }
  });

  return { fields: fields, values: values };
}

// The full description of one outbound request: what a reviewer needs to see
// and what the contract check reads. `digest` is over the RAW bytes, including
// the parts redaction hides, so two runs can be compared byte-for-byte without
// the evidence carrying a single credential.
function describeRequest(input) {
  // The `request` mechanism carries the body as a `form` OBJECT rather than as
  // encoded bytes, so it is described from the object: the field names are the
  // same evidence, and inventing an encoding the library would have produced
  // would be an assumption rather than a record.
  if (input.form && typeof input.form === 'object') {
    var formValues = {};
    Object.keys(input.form).forEach(function(name) {
      formValues[name] = isSensitiveField(name)
        ? REDACTED
        : (input.form[name] === undefined || input.form[name] === null
            ? String(input.form[name])
            : String(input.form[name]));
    });

    return {
      method       : input.method,
      headers      : redactHeaders(input.headers),
      credentials  : credentialShapes(input.headers),
      redirect     : input.redirect === undefined ? null : input.redirect,
      bodyKind     : 'form-option',
      bodyBytes    : null,
      bodyDigest   : null,
      bodyEncoding : 'form',
      bodyFields   : Object.keys(input.form).sort(),
      bodyValues   : formValues,
      rawPlus      : false
    };
  }

  var body = bodyTextOf(input.body);
  var contentType = headerValue(input.headers, 'content-type') || '';
  var isForm = contentType.indexOf('application/x-www-form-urlencoded') === 0 ||
    body.kind === 'urlsearchparams';
  var description = {
    method       : input.method,
    headers      : redactHeaders(input.headers),
    credentials  : credentialShapes(input.headers),
    redirect     : input.redirect === undefined ? null : input.redirect,
    bodyKind     : body.kind,
    bodyBytes    : Buffer.byteLength(body.text, 'utf8'),
    bodyDigest   : body.kind === 'none' ? null : sha1(body.text),
    bodyEncoding : body.kind === 'none' ? 'none' : (isForm ? 'form' : 'other'),
    bodyFields   : null,
    bodyValues   : null,
    rawPlus      : body.kind === 'none' ? false : body.text.indexOf('+') !== -1
  };

  if (isForm && body.kind !== 'none') {
    var parsed = parseFormBody(body.text);
    description.bodyFields = parsed.fields.slice().sort();
    description.bodyValues = parsed.values;
  }

  return description;
}

// ---------------------------------------------------------------------------
// Request contracts: the shape each endpoint must be called with.
//
// Measured from the call sites, one entry per (endpoint, mechanism), because
// the two mechanisms encode the same call differently - `request` carried the
// encoding in its `form` and `json` options while fetch carries it in headers
// and a body string - and a contract that ignored the difference could only
// check the weaker of the two.
//
// A breach is not a warning. The call is REFUSED through contractError above,
// so a drifted encoding cannot be handed a recorded success: an oracle that
// records a violation and serves the response anyway leaves the corpus
// identical and the drift invisible, which is the state this replaces.
// ---------------------------------------------------------------------------

var REQUEST_CONTRACTS = {
  recaptcha : {
    // lib/util/recaptcha.js: fetch(url, {method:'POST', headers:{content-type},
    // body: new URLSearchParams({secret, response})}).
    fetch : {
      method         : 'POST',
      noQuery        : true,
      headers        : { 'content-type': 'application/x-www-form-urlencoded' },
      bodyEncoding   : 'form',
      requiredFields : ['response', 'secret']
    },
    // The replaced call shape: request.post({url, form:{secret, response}},
    // cb) with `json` NOT set - which is load-bearing, because verify()
    // parses response.body
    // itself and a parsed object there changes the outcome.
    request : {
      method         : 'POST',
      noQuery        : true,
      requiredForm   : ['response', 'secret'],
      json           : false
    }
  },

  token : {
    // lib/controllers/auth.js googleCallback, token exchange. All FIVE fields
    // are required, not the three that decide the outcome: `formEncode` drops
    // only an `undefined` value and node-config reads an unset key as null, so
    // client_secret and redirect_uri are always PRESENT - with an empty value
    // where the deployment leaves them unset. A request missing either is a
    // changed body, and a contract that ignored them accepted one.
    fetch : {
      method         : 'POST',
      noQuery        : true,
      headers        : {
        'content-type' : 'application/x-www-form-urlencoded',
        'accept'       : 'application/json'
      },
      redirect       : 'manual',
      bodyEncoding   : 'form',
      requiredFields : ['client_id', 'client_secret', 'code', 'grant_type', 'redirect_uri'],
      fieldValues    : { grant_type: 'authorization_code' },
      // qs' RFC 3986 stringifier never emitted a raw '+': a space arrives as
      // %20. A '+' in the body means the encoder changed.
      rfc3986        : true
    },
    request : {
      method         : 'POST',
      noQuery        : true,
      requiredForm   : ['client_id', 'client_secret', 'code', 'grant_type', 'redirect_uri'],
      json           : true
    }
  },

  userinfo : {
    // lib/controllers/auth.js googleCallback, profile fetch. The redirect mode
    // is deliberately NOT constrained: following is the baseline behaviour, and
    // a caller that follows the chain itself in order to enforce a hop limit
    // sends 'manual' for the same observable outcome.
    fetch : {
      method        : 'GET',
      noQuery       : true,
      headers       : { 'accept': 'application/json' },
      // The scheme AND a non-empty credential. `Bearer ` with nothing after it
      // is a different request from one carrying a token, and the redacted
      // header cannot tell them apart - which is why the check reads the
      // credential SHAPE computed before redaction.
      credential    : { 'authorization': 'Bearer' },
      bodyEncoding  : 'none'
    },
    request : {
      method        : 'GET',
      noQuery       : true,
      credential    : { 'authorization': 'Bearer' },
      json          : true
    }
  },

  asset : {
    // lib/controllers/users.js assetUploadFromURL: fetch(url) with no init, so
    // GET and no body. Headers are unconstrained - the call site sends none -
    // and so is the redirect mode.
    fetch : {
      method       : 'GET',
      bodyEncoding : 'none'
    },
    request : {
      method       : 'GET'
    }
  }
};

// Checks one described request against its contract and returns every
// violation, each naming the expectation and what arrived, so a contract that
// is itself wrong is as easy to correct as a call site that drifted.
function contractViolations(endpoint, mechanism, description, options, classified) {
  var byEndpoint = REQUEST_CONTRACTS[endpoint];
  var contract = byEndpoint ? byEndpoint[mechanism] : null;
  var violations = [];

  if (!contract) {
    return violations;
  }

  if (contract.method && description.method !== contract.method) {
    violations.push('method must be ' + contract.method + ', received ' +
      JSON.stringify(description.method));
  }

  Object.keys(contract.headers || {}).forEach(function(name) {
    var actual = description.headers[name];
    if (actual !== contract.headers[name]) {
      violations.push('header ' + name + ' must be ' +
        JSON.stringify(contract.headers[name]) + ', received ' +
        (actual === undefined ? 'no such header' : JSON.stringify(actual)));
    }
  });

  Object.keys(contract.credential || {}).forEach(function(name) {
    var shape = (description.credentials || {})[name];
    var scheme = contract.credential[name];

    if (!shape) {
      violations.push('header ' + name + ' must be present and carry the ' +
        JSON.stringify(scheme) + ' scheme, and no such header arrived');
      return;
    }

    if (shape.scheme !== scheme) {
      violations.push('header ' + name + ' must start with ' +
        JSON.stringify(scheme + ' ') + ', and its scheme is ' +
        JSON.stringify(shape.scheme));
      return;
    }

    if (!shape.credentialPresent) {
      violations.push('header ' + name + ' carries the ' + JSON.stringify(scheme) +
        ' scheme with an EMPTY credential, which is a different request from one ' +
        'carrying a token');
    }
  });

  if (contract.noQuery && classified && classified.url) {
    var search = null;
    try {
      search = new URL(classified.url).search;
    }
    catch (e) {
      search = null;
    }

    if (search) {
      violations.push('this endpoint is called with no query string, and this ' +
        'request carries one (' + search.length + ' characters). Endpoint ' +
        'matching ignores the query, so an unexpected one would otherwise be ' +
        'served the recorded response as though it had not been sent');
    }
  }

  if (contract.redirect !== undefined && description.redirect !== contract.redirect) {
    violations.push('the redirect mode must be ' + JSON.stringify(contract.redirect) +
      ', received ' + JSON.stringify(description.redirect) +
      ' (following a redirect on this call would change the method and the outcome)');
  }

  if (contract.bodyEncoding && description.bodyEncoding !== contract.bodyEncoding) {
    violations.push('the body must be ' + contract.bodyEncoding + '-encoded, received ' +
      description.bodyEncoding + ' (' + description.bodyKind + ')');
  }

  (contract.requiredFields || []).forEach(function(field) {
    if (!description.bodyFields || description.bodyFields.indexOf(field) === -1) {
      violations.push('the body must carry the field ' + JSON.stringify(field) +
        ', and carries ' + JSON.stringify(description.bodyFields || []));
    }
  });

  Object.keys(contract.fieldValues || {}).forEach(function(field) {
    var actual = description.bodyValues ? description.bodyValues[field] : undefined;
    if (actual !== contract.fieldValues[field]) {
      violations.push('the body field ' + JSON.stringify(field) + ' must be ' +
        JSON.stringify(contract.fieldValues[field]) + ', received ' +
        JSON.stringify(actual === undefined ? null : actual));
    }
  });

  if (contract.rfc3986 && description.rawPlus) {
    violations.push('the body contains a raw "+", so it is not RFC 3986 encoded: ' +
      'the encoder this call site reproduces percent-encodes a space as %20 and ' +
      'never as "+"');
  }

  // `request`-mechanism options, which carry the encoding rather than headers.
  var opts = options || {};

  (contract.requiredForm || []).forEach(function(field) {
    var form = opts.form;
    if (!form || typeof form !== 'object' || !Object.prototype.hasOwnProperty.call(form, field)) {
      violations.push('the `form` option must carry the field ' + JSON.stringify(field) +
        ', and carries ' + JSON.stringify(form && typeof form === 'object' ? Object.keys(form).sort() : null));
    }
  });

  if (contract.json !== undefined && !!opts.json !== contract.json) {
    violations.push('the `json` option must be ' + contract.json + ', received ' +
      JSON.stringify(opts.json === undefined ? null : opts.json) +
      (contract.json === false
        ? ' (this call site parses response.body itself, so a parsed body changes the outcome)'
        : ' (this call site reads the parsed body, so a raw string changes the outcome)'));
  }

  return violations;
}

// Records a breach and hands back the violations, so each caller can refuse in
// its own mechanism's shape. The entry carries an `event` key, which is what
// keeps test/parity/replay.js counting it as a fixture note rather than as an
// intercepted call.
function noteContractViolation(classified, mechanism, description, violations) {
  state.contractViolations.push({
    mechanism  : mechanism,
    endpoint   : classified.endpoint,
    url        : redactUrl(classified.url),
    profile    : state.activeProfile,
    violations : violations.slice()
  });

  note('contract-violation', {
    mechanism  : mechanism,
    endpoint   : classified.endpoint,
    url        : redactUrl(classified.url),
    profile    : state.activeProfile,
    request    : description,
    violations : violations.slice()
  });
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
// the raw string. The first two are the values the application's token and
// profile guards have to survive, and in the delivered tree they do: both test
// the body before they read a field off it, so `undefined` and `null` reject
// the chain with the message it always carried instead of throwing a TypeError
// out of a next-tick callback. Reproducing the values exactly is what makes
// that testable at all - a fixture that coerced them to `{}` would exercise
// neither guard.
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
// emitter: a throw inside the callback then escapes as an uncaught exception
// rather than becoming a rejected promise. That timing is why reCAPTCHA
// outcomes 5 and 6 and the null-body token case ended the process on the
// BASELINE worktree, which is the only tree this mechanism is live on - the
// delivered call sites guard all three reads, so nothing there throws out of a
// callback any more. The dispatch is retained because it still decides where
// anything else that throws from a callback is reported.
function serveRequestCallback(call) {
  var classified = classify(call.url);
  var rec = classified.endpoint ? recordFor(classified.endpoint) : null;
  var wantsJson = !!(call.options && call.options.json);
  var description = describeRequest({
    method   : call.method,
    headers  : call.options && call.options.headers,
    body     : call.options && call.options.body,
    form     : call.options && call.options.form,
    redirect : undefined
  });

  if (!rec || rec.recorded === false) {
    recordCall(classified, 'request', description, 'unrecorded');
    process.nextTick(call.callback, unrecordedError(classified, 'request'), undefined, undefined);
    return;
  }

  var violations = contractViolations(classified.endpoint, 'request', description, call.options, classified);
  if (violations.length) {
    noteContractViolation(classified, 'request', description, violations);
    recordCall(classified, 'request', description, 'contract-violation');
    process.nextTick(call.callback, contractError(classified, 'request', violations), undefined, undefined);
    return;
  }

  recordCall(classified, 'request', description, rec.outcome);

  if (rec.transport) {
    // (err, undefined, undefined) - the shape that leaves `response`
    // undefined at the reCAPTCHA call site and throws there.
    process.nextTick(call.callback, transportError(rec.transport), undefined, undefined);
    return;
  }

  var response = buildCallbackResponse(rec, classified, call.method, wantsJson);
  process.nextTick(call.callback, null, response, response.body);
}

// The hops still ahead of a request, so a caller that follows a chain itself -
// one request per hop - is served the same chain a following caller is.
//
// A request for the chain's entry point has every hop ahead of it. A request
// for hop N has the hops from N onwards, which is what makes a hop-counting
// loop terminate at the same destination as a single following request. A
// record with no chain has no hops, and a non-redirect record never reaches
// here.
function hopsFrom(rec, classified) {
  if (!rec || rec.mode !== 'redirect') {
    return [];
  }

  var chain = Array.isArray(rec.hops)
    ? rec.hops
    : (rec.redirectLocation
        ? [{ status: rec.redirectStatus || 302, location: rec.redirectLocation }]
        : []);

  if (!chain.length) {
    return [];
  }

  // A request for the chain's DESTINATION has no hops ahead of it, or a
  // hop-counting caller would arrive and be redirected round the chain again,
  // walking it without end.
  var destination = chain[chain.length - 1].location;
  if (classified && classified.url && sameEndpoint(classified.url, destination)) {
    return [];
  }

  var hop = classified && classified.hop ? classified.hop : 0;
  return chain.slice(Math.max(0, hop - 1));
}

// Whether two URLs name the same recorded endpoint, on the same (origin,
// pathname) basis the registry uses.
function sameEndpoint(left, right) {
  try {
    return endpointKey(new URL(left)) === endpointKey(new URL(right));
  }
  catch (e) {
    return false;
  }
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

  // `pipe` stays Stream.prototype.pipe - its error propagation is the whole
  // reason this object is built on the legacy base class - and the override
  // only RECORDS the destination on the way through, so `afterFlush` below
  // can wait for the bytes it wrote to reach the file.
  stream.pipe = function(destination, options) {
    stream.parityDestination = destination;

    return Stream.prototype.pipe.call(stream, destination, options);
  };

  return stream;
}

// Runs `done` once the destination this stream was piped into has flushed the
// bytes already written to it.
//
// WHY THIS EXISTS, measured. The consumer of this stream is
// `assetUploadFromURL`, which registers its upload on the SOURCE's 'end' and
// separately pipes the source into `fs.createWriteStream(tmpPath)`
// [lib/controllers/users.js:594-615 at 2f8712a]. `Stream.prototype.pipe`
// wires 'data' to `destination.write(chunk)` with no callback, and the 'end'
// handler the application registered BEFORE the pipe therefore runs before
// the write has been flushed - so the upload hashes whatever is on disk at
// that instant. Emitting 'data' and 'end' in one turn made that a coin toss:
// two captures of the identical tree recorded sha1
// da39a3ee5e6b4b0d3255bfef95601890afd80709, which is the digest of NO BYTES,
// and d5fceb6532643d0d84ffe09c40c481ecdf59e15a, which is the digest of the
// 42 bytes this fixture serves and the value this file's own
// `asset:success` profile documents. A content-addressed storage key cannot
// be normalized away - AAP 0.6.7 makes the digest the contract - so the
// stimulus is made faithful instead: no socket delivers a chunk and its EOF
// in the same synchronous turn, and a zero-length marker write is ordered
// behind the chunk already queued, so its callback is the moment the file
// holds what was sent.
//
// Falls back to `setImmediate` when there is nothing to wait for: a consumer
// that never piped, or a destination without a callback-taking `write`.
function afterFlush(stream, done) {
  var destination = stream.parityDestination;

  if (!destination || typeof destination.write !== 'function') {
    setImmediate(done);
    return;
  }

  try {
    destination.write(Buffer.alloc(0), function() {
      done();
    });
  }
  catch (err) {
    // A destination that rejects the marker write tells us nothing about its
    // flush state, so the run continues on the timing it would have had.
    setImmediate(done);
  }
}

// Delivers the stream form. Emission is deferred to setImmediate so that the
// caller's whole synchronous chain - three .on() calls and the .pipe() - is
// attached first, which is what the original's real I/O guaranteed. The event
// sequences below are the measured baseline sequences, one per mode.
function serveRequestStream(call) {
  var classified = classify(call.url);
  var rec = classified.endpoint ? recordFor(classified.endpoint) : null;
  var stream = newRequestStream(call, classified);
  var description = describeRequest({
    method   : call.method,
    headers  : call.options && call.options.headers,
    body     : call.options && call.options.body,
    form     : call.options && call.options.form,
    redirect : undefined
  });

  if (!rec || rec.recorded === false) {
    recordCall(classified, 'request', description, 'unrecorded');
    setImmediate(function() {
      stream.emit('error', unrecordedError(classified, 'request'));
    });
    return stream;
  }

  var violations = contractViolations(classified.endpoint, 'request', description, call.options, classified);
  if (violations.length) {
    noteContractViolation(classified, 'request', description, violations);
    recordCall(classified, 'request', description, 'contract-violation');
    setImmediate(function() {
      stream.emit('error', contractError(classified, 'request', violations));
    });
    return stream;
  }

  recordCall(classified, 'request', description, rec.outcome);

  // A JSON endpoint asked for without a callback still has to answer, and it
  // answers as a stream: response, body, end.
  var mode = rec.mode || 'complete';
  var hops = hopsFrom(rec, classified);

  setImmediate(function() {
    if (mode === 'refused') {
      // 'error' and nothing else, ever: no 'response', no 'data', no 'end'.
      // The upload never starts and the request is left unsettled.
      stream.emit('error', transportError(rec.transport));
      return;
    }

    if (mode === 'redirect' && hops.length > LEGACY_MAX_REDIRECTS) {
      // The chain is longer than this mechanism's own maxRedirects, so it
      // fails instead of arriving: 'error' with the library's own message
      // shape, and no 'response' and no 'end'. Declared rather than measured
      // (see LEGACY_MAX_REDIRECTS), and served identically on every run so the
      // boundary is testable at all.
      var exceeded = new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' +
        redactUrl(classified.url));
      exceeded.code = 'PARITY_REDIRECT_LIMIT';
      exceeded.parityHops = hops.length;
      exceeded.parityLimit = LEGACY_MAX_REDIRECTS;
      stream.emit('error', exceeded);
      return;
    }

    if (mode === 'redirect') {
      // Each intermediate response is announced through 'redirect' - the event
      // the original emitted, and one no application handler listens for - and
      // then only the FINAL response is delivered, which is what a consumer of
      // the original could observe.
      hops.forEach(function(hop) {
        stream.response = {
          statusCode : hop.status,
          headers    : { location: hop.location }
        };
        stream.emit('redirect');
      });
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
      afterFlush(stream, function() {
        stream.emit('error', transportError(rec.transport));
        stream.emit('end');
      });
      return;
    }

    // 'complete' and 'non-2xx' both end normally: a non-2xx is not a
    // transport error, so its body really is piped and uploaded. 'end' waits
    // for the destination to hold the bytes - see `afterFlush` - because the
    // consumer's upload reads the file from its own 'end' handler.
    afterFlush(stream, function() {
      stream.emit('end');
    });
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
  // open a route to the network. Declaring them loudly is what keeps a missing
  // capability from becoming a subtle wrong answer: a hollow cookie jar that
  // silently stores nothing, or an initParams that returns a differently
  // shaped object, would do exactly that.
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

// The 3xx a caller asking for `redirect: 'manual'` receives: the status the
// chain records, the Location it points at, and no body - which is what a real
// redirect response carries.
function buildRedirectResponse(hop) {
  return new Response(null, {
    status     : hop.status,
    statusText : STATUS_TEXT[hop.status] || '',
    headers    : { location: hop.location }
  });
}

// Builds the Response for one record.
//
// `hops` is the chain that was followed to reach it, used only to mark the
// response as redirected. `Response.prototype.redirected` and `.url` are
// prototype getters that the constructor cannot set, so they are shadowed with
// own properties: no application path reads either, and a corpus reviewer
// looking at a followed chain should not have to infer it from the log.
function buildFetchResponse(rec, classified, hops) {
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

  var response;

  if (rec.mode === 'midstream') {
    // The stream form emits 'error' and then 'end', because both are events
    // the fixture controls. A Node Readable adapted from a web stream cannot
    // do that - a Readable that errors never emits 'end' - so on this
    // mechanism the fixture's contract stops at "partial bytes, then error".
    // That is a property of the runtime's own stream adapter, not a gap here,
    // and the application accounts for it: its 'error' handler starts the
    // upload itself, which is how the partial content still gets uploaded on
    // both mechanisms. Measured on both.
    response = new Response(
      partialThenErrorWebStream(rec.bytes, transportError(rec.transport)),
      init
    );
  }
  else if (rec.bytes) {
    response = new Response(completeWebStream(rec.bytes), init);
  }
  else {
    // The JSON endpoints. The body is handed over as the same string the
    // callback form serves, so both mechanisms parse identical bytes and the
    // `json: true` semantics are reproduced by the application's own reader.
    response = new Response(bodyStringFor(rec), init);
  }

  if (hops && hops.length) {
    try {
      Object.defineProperty(response, 'redirected', { value: true, configurable: true });
      Object.defineProperty(response, 'url', {
        value        : rec.redirectLocation || (classified && classified.url) || '',
        configurable : true
      });
    }
    catch (e) {
      // Shadowing is presentation only. A runtime that refuses it changes
      // nothing the application reads, so the failure is recorded and the
      // response is served.
      note('fetch-redirect-marking-failed', { error: e.message });
    }
  }

  return response;
}

// The replacement for globalThis.fetch. It opens no socket, and the ONE call it
// ever hands to the retained original is a data: URL this file declares, which
// carries its own payload and reaches no dispatcher - see the delegation arm.
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

  // What the three URL-shape arms below record. The same description the
  // credential arm has always recorded, lifted into one place because all three
  // return before the redirect-mode resolution the main path performs and would
  // otherwise carry three copies of it.
  function describeShapeCall() {
    return describeRequest({
      method   : method,
      headers  : (init && init.headers) || null,
      body     : init ? init.body : undefined,
      redirect : init && init.redirect
    });
  }

  // The URL as `new URL` sees it, or null. Parsed once for the two refusal arms
  // below, both of which read the authority rather than the recording.
  var authority = null;
  if (typeof rawUrl === 'string' && rawUrl) {
    try {
      authority = new URL(rawUrl);
    }
    catch (e) {
      authority = null;
    }
  }

  // ------------------------------------------------------------------------
  // URL-SHAPE ARM 1 of 3: credentials in the authority.
  //
  // Native fetch REFUSES a URL carrying credentials in its authority, and it
  // refuses it before any request is made. Measured on Node 22.23.2:
  //   TypeError('Request cannot be constructed from a URL that includes
  //   credentials: <url>'), with no `cause`, and no socket opened.
  //
  // Reproducing it matters because the replaced library ACCEPTED such a URL -
  // it moved the userinfo onto an Authorization header and fetched the resource
  // - so this is one of the three divergences docs/preserved-quirks.md 11.4
  // declares at lib/controllers/users.js's asset upload, and a fixture that
  // quietly stripped the credentials and served a 200 would report parity
  // across exactly that difference. The URL is recorded redacted; the message
  // must carry the URL as fetch does, so it carries the redacted form.
  //
  // The outcome is unchanged. What is added is the shape's name in the record:
  // this arm and the unrecorded arm both leave the call site on the same
  // log-only path, so without it a reviewer cannot tell a driven refusal from a
  // URL nobody recorded. DIVERGENT_URLS.credentialed is the declared shape, and
  // the refusal fires for ANY credential-bearing URL, exactly as fetch's does.
  // ------------------------------------------------------------------------
  if (authority && (authority.username || authority.password)) {
    recordCall(divergentClassification(classified, 'credentialed-url',
      'fetch-refuses-url-credentials'), 'fetch', describeShapeCall(), 'credential-url-refused');

    return Promise.reject(new TypeError(
      'Request cannot be constructed from a URL that includes credentials: ' +
      redactUrl(rawUrl)
    ));
  }

  // ------------------------------------------------------------------------
  // URL-SHAPE ARM 2 of 3: a Fetch-forbidden port.
  //
  // Measured on Node 22.23.2: TypeError('fetch failed') whose `cause` is
  // Error('bad port') carrying no own properties at all - no `code`, no
  // `errno`, no `syscall` - and no socket opened. The control measurement is
  // what makes the ordering provable: the same host on port 8080 rejects with
  // a cause of `getaddrinfo ENOTFOUND` and trips the socket counter, while
  // 6000, 22 and 9 reject with `bad port` and leave it at zero - so the
  // blocked-port refusal really does precede the dispatch.
  //
  // So the cause is a plain Error rather than transportError(), which attaches
  // code/errno/syscall and would hand the call site a shape no real refusal
  // has. fetchFailure() supplies the outer TypeError, which is the same
  // construction every other transport failure in this file is built from.
  //
  // Unlike the two arms either side of it, this one had no reproduction at all
  // before: the URL is http, so it reached the registry, missed, and rejected
  // as PARITY_UNRECORDED - the fixture's refusal standing in for the runtime's
  // and hiding the divergence behind it. It sits beside the credential arm so
  // that it likewise precedes the registry lookup, which is where the runtime
  // takes this decision too.
  // ------------------------------------------------------------------------
  if (authority) {
    var blockedPort = blockedPortOf(authority);

    if (blockedPort) {
      recordCall(divergentClassification(classified, 'blocked-port',
        'fetch-blocked-port:' + blockedPort + ':' + FETCH_BLOCKED_PORTS[blockedPort]),
        'fetch', describeShapeCall(), 'blocked-port-refused');

      return Promise.reject(fetchFailure(new Error('bad port')));
    }
  }

  // ------------------------------------------------------------------------
  // URL-SHAPE ARM 3 of 3: a data: URL, and the ONE delegation in this file.
  //
  // Measured on Node 22.23.2: fetch('data:text/plain,hi') resolves 200 with
  // content-type `text/plain` and the body "hi", and opens ZERO sockets - the
  // measurement was taken with net.Socket.prototype.connect patched to count.
  // The replaced library threw `Invalid protocol: data:` synchronously instead,
  // which is the divergence docs/preserved-quirks.md 11.4 records first.
  //
  // This arm hands the call to the genuine fetch the fixture retains, and lets
  // the runtime resolve it. THAT IS NOT A HOLE IN THE NO-NETWORK GUARANTEE, and
  // the argument is the whole reason it is allowed: a data: URL carries its
  // payload inside the URL, so resolving it involves no origin, no DNS, no
  // dispatcher and no socket. There is nothing to record and nothing to
  // intercept - a recorded body would be a body this fixture invented, and
  // inventing it is precisely what would make the divergence unfalsifiable.
  // Delegating is what makes the claim "the runtime resolves this" a driven
  // result rather than a restatement of the recording.
  //
  // The gate is narrow on purpose, and both halves of it are tested here rather
  // than trusted from the caller:
  //   the scheme must be exactly `data:`, so no http(s) URL can ever reach the
  //   original however it is spelled; and
  //   the URL must be one this file DECLARES, so an exotic scheme is not
  //   delegated merely for being exotic and a caller cannot widen the gate by
  //   passing a data: URL of its own - an undeclared one falls through to the
  //   unrecorded arm below and is refused with PARITY_UNRECORDED, carrying
  //   classify()'s `unsupported-protocol:data:` as its reason. Measured.
  // The profile is not consulted, because no profile serves this: what is
  // exercised is the runtime's own decision.
  // ------------------------------------------------------------------------
  if (authority && authority.protocol === 'data:' && isRegisteredDataUrl(rawUrl)) {
    if (typeof state.originalFetch !== 'function') {
      // The fixture is in force without having retained a genuine fetch to
      // delegate to, which is a fixture fault rather than a network event: it
      // is reported through fetch's own failure shape so it cannot be read as
      // a resolved payload, and named so it cannot be read as a refusal by the
      // runtime either.
      recordCall(divergentClassification(classified, 'data-url',
        'no-retained-fetch-to-delegate-to'), 'fetch', describeShapeCall(),
        'data-url-delegation-unavailable');

      return Promise.reject(fetchFailure(new Error(
        'test/parity/fixtures/http.js: the data: URL ' + JSON.stringify(rawUrl) +
        ' is declared as a delegated URL shape, but no genuine fetch was retained to ' +
        'resolve it. install() retains globalThis.fetch, so this means the fixture was ' +
        'installed into a process that had none.'
      )));
    }

    // Recorded BEFORE the delegation, like every other arm: the evidence is
    // appended per call precisely so that it survives an outcome that does not
    // return normally.
    recordCall(divergentClassification(classified, 'data-url',
      'delegated-to-retained-fetch'), 'fetch', describeShapeCall(), 'data-url-delegated');

    return state.originalFetch(input, init);
  }

  // The redirect mode the caller asked for, defaulted the way fetch defaults
  // it. Read from `init` first and then from a Request-shaped input, which is
  // the same order the method is read in.
  var redirectMode = 'follow';
  if (init && typeof init.redirect === 'string') {
    redirectMode = init.redirect;
  }
  else if (input && typeof input === 'object' && typeof input.redirect === 'string') {
    redirectMode = input.redirect;
  }

  var description = describeRequest({
    method   : method,
    headers  : (init && init.headers) || (input && typeof input === 'object' ? input.headers : null),
    body     : init ? init.body : undefined,
    redirect : redirectMode
  });

  if (!rec || rec.recorded === false) {
    recordCall(classified, 'fetch', description, 'unrecorded');
    // fetch's own failure shape, so the caller's rejection handling is
    // reached exactly as a real transport failure would reach it.
    return Promise.reject(fetchFailure(unrecordedError(classified, 'fetch')));
  }

  var violations = contractViolations(classified.endpoint, 'fetch', description, null, classified);
  if (violations.length) {
    noteContractViolation(classified, 'fetch', description, violations);
    recordCall(classified, 'fetch', description, 'contract-violation');
    return Promise.reject(fetchFailure(contractError(classified, 'fetch', violations)));
  }

  recordCall(classified, 'fetch', description, rec.outcome);

  // A transport failure on a JSON endpoint, and the refused asset, are the
  // same event to fetch: the promise rejects and no Response ever exists.
  if (rec.transport && rec.mode !== 'midstream') {
    return Promise.reject(fetchFailure(transportError(rec.transport)));
  }

  // `init.redirect` decides what a recorded redirect chain serves, because the
  // three modes are three different observable outcomes and the token exchange
  // depends on one of them: it sends 'manual' precisely so that a 3xx is NOT
  // chased, since fetch follows every method and downgrades a redirected POST
  // to GET. A dispatcher that ignored the mode would make that dependency
  // untestable and a hop limit inexpressible.
  var hops = hopsFrom(rec, classified);

  if (hops.length) {
    if (redirectMode === 'error') {
      // fetch rejects rather than delivering anything.
      var refused = new Error('unexpected redirect, redirect mode is set to error');
      refused.code = 'PARITY_REDIRECT_MODE';
      return Promise.reject(fetchFailure(refused));
    }

    if (redirectMode === 'manual') {
      // The 3xx ITSELF, Location intact and body empty. This is the only shape
      // a caller counting hops for itself can work from, and it is what a
      // bounded follower needs in order to stop at its own limit rather than
      // the runtime's.
      try {
        return Promise.resolve(buildRedirectResponse(hops[0]));
      }
      catch (e) {
        note('fetch-redirect-build-failed', { url: redactUrl(classified.url), profile: state.activeProfile, error: e.message });
        return Promise.reject(fetchFailure(e));
      }
    }

    if (hops.length > FETCH_MAX_REDIRECTS) {
      // Longer than the runtime's own limit, so following it fails. Declared
      // rather than measured (see FETCH_MAX_REDIRECTS) and served identically
      // every run.
      var tooMany = new Error('redirect count exceeded');
      tooMany.code = 'PARITY_REDIRECT_LIMIT';
      tooMany.parityHops = hops.length;
      tooMany.parityLimit = FETCH_MAX_REDIRECTS;
      return Promise.reject(fetchFailure(tooMany));
    }
  }

  try {
    return Promise.resolve(buildFetchResponse(rec, classified, hops));
  }
  catch (e) {
    // A malformed record is a fixture fault, not a network event. It is
    // reported through fetch's own failure shape so it cannot be mistaken for
    // a successful response, and it is logged for the harness.
    note('fetch-response-build-failed', { url: redactUrl(classified.url), profile: state.activeProfile, error: e.message });
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

  // From here on the mechanism is REQUIRED. The package exists in this tree, so
  // the application can require it and reach a real socket; failing to patch it
  // is not the benign "target tree has no request" case but a live escape from
  // the fixture, and install() treats it as terminal rather than as a note.
  state.requestRequired = true;

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

// Verifies that PARITY_APP_ROOT names the tree it claims to. The `request`
// mechanism is resolved against this path, so a wrong root silently decides
// which mechanisms exist - the exact failure a handshake is supposed to catch.
function verifyAppRoot(appRoot) {
  var missing = ['app.js', 'package.json'].filter(function(name) {
    try {
      return !fs.statSync(pathModule.join(appRoot, name)).isFile();
    }
    catch (e) {
      return true;
    }
  });

  return {
    verified : !missing.length,
    missing  : missing
  };
}

// Installs both mechanisms and publishes the handshake.
//
// Idempotent: a second call is a no-op returning the same status. It still does
// not THROW - a preload that throws kills the server before app.js loads, and
// the diagnosis would be a stack trace from a require - but it no longer treats
// an unprotected process as installed either.
//
// Two things changed, and both are the difference between a fixture and a
// fixture that can be trusted:
//
//   `installed` was `requestPatched || fetchPatched`, so one working mechanism
//   reported success while the other stayed live. It is now every REQUIRED
//   mechanism: fetch always, and `request` exactly when the tree provides it.
//   A tree without the package is the target tree's expected state and is not a
//   failure; a tree with the package that could not be patched is a live socket
//   path and is.
//
//   A required mechanism that is inactive is TERMINAL. The alternative is what
//   this replaces: a diagnostic in a log nobody reads while the child serves
//   traffic to the real internet and produces a corpus that looks like
//   evidence. The process exits with EXIT_UNPROTECTED after writing the reason
//   into the handshake and the evidence log, which is what makes readiness fail
//   for a parent that polls it - test/parity/server.js reports the child's exit,
//   and neither capture.js nor replay.js can proceed past a dead child.
//   Nothing is printed: stdout and stderr belong to the zero-warning gate,
//   and the exit code plus the handshake are the signal.
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

  // fetch is always required: all four call sites are native fetch on the
  // target tree. `request` is required only where it resolves.
  var inactive = [];
  if (!state.fetchPatched) {
    inactive.push('fetch');
  }
  if (state.requestRequired && !state.requestPatched) {
    inactive.push('request');
  }

  // An app root the caller DECLARED and that does not hold the application is
  // the same class of fault: `request` is resolved against it, so a wrong root
  // silently decides which mechanisms exist and a baseline capture could run
  // with the legacy mechanism absent and never notice. An explicit wrong claim
  // is terminal; the implicit process.cwd() fallback is not - it is reported,
  // and assertReady() refuses on it - because a fallback is not a claim.
  var declaredRoot = !!process.env.PARITY_APP_ROOT;
  var rootCheck = verifyAppRoot(appRoot);
  if (declaredRoot && !rootCheck.verified) {
    inactive.push('app-root');
    state.resolveDiagnostic = 'PARITY_APP_ROOT ' + appRoot + ' does not hold the ' +
      'application (' + rootCheck.missing.join(' and ') + ' missing), so `request` was ' +
      'resolved against the wrong worktree';
  }

  state.installed = !inactive.length;

  if (state.resolveDiagnostic) {
    note('request-mechanism-inactive', state.resolveDiagnostic);
  }

  var current = status();
  publishHandshake(current);

  if (inactive.length) {
    note('install-unprotected', {
      inactive : inactive,
      reason   : 'a mechanism this tree provides could not be intercepted, so an ' +
                 'HTTP call could reach the network and the corpus would not be ' +
                 'reproducible',
      diagnostic : state.resolveDiagnostic
    });
    flush();
    process.exit(EXIT_UNPROTECTED);
  }

  return current;
}

// Writes the handshake where a parent can read it, and records it in the
// evidence log as well so it travels with the corpus in every run - including
// runs that set no handshake path.
//
// The handshake answers the question a parent otherwise cannot ask: is the
// fixture that installed the one I meant, in the tree I meant, with every
// mechanism active? It carries the module's own path and a digest of its
// contents, the app root and whether it verified, the pid, the active profile
// and the mechanism table.
function publishHandshake(current) {
  state.handshake = current;

  note('install', current);

  var target = process.env.PARITY_HTTP_STATUS;
  if (!target) {
    return null;
  }

  try {
    fs.writeFileSync(target, JSON.stringify(current, null, 2) + '\n');
    return target;
  }
  catch (e) {
    note('handshake-write-failed', { file: target, error: e.code || e.message });
    return null;
  }
}

// A digest of this file, so a handshake identifies the implementation and not
// merely its path: both worktrees load ONE implementation, and this is what
// lets a run prove it rather than assert it. Computed once, and a failure to
// read is reported rather than thrown.
var fixtureDigest = (function() {
  try {
    return sha1(fs.readFileSync(__filename));
  }
  catch (e) {
    return null;
  }
})();

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
  state.requestRequired = false;
  state.installed = false;
  state.handshake = null;

  return status();
}

// What is patched, what is not, and why - plus the identity a parent checks the
// handshake against. Returned by install() and available on its own so a
// harness can report the active mechanisms rather than guess at them.
function status() {
  var appRoot = process.env.PARITY_APP_ROOT || process.cwd();
  var rootCheck = verifyAppRoot(appRoot);
  var identityCheck = checkIdentityContract();

  return {
    schema     : 'parity-http-fixture-status/1',
    installed  : state.installed,
    appRoot    : appRoot,
    appRootVerified : rootCheck.verified,
    appRootMissing  : rootCheck.missing,
    profile    : state.activeProfile,
    mechanisms : {
      request : state.requestPatched,
      fetch   : state.fetchPatched
    },
    // Which mechanisms this tree obliges the fixture to hold. `request` is
    // required only where the package resolves; fetch always is.
    required   : {
      request : state.requestRequired,
      fetch   : true
    },
    identity   : {
      module   : __filename,
      digest   : fixtureDigest,
      pid      : process.pid,
      node     : process.version,
      existing : identityCheck.existing,
      new      : identityCheck.new,
      identityOk : identityCheck.ok,
      identityViolations : identityCheck.violations,
      identityUnverified : identityCheck.unverified
    },
    diagnostic : state.resolveDiagnostic
  };
}

// Throws unless the fixture is fully in force: every required mechanism active,
// the app root verified, the identity contract satisfied, and no request
// contract breached so far. This is the assertion a driver makes BEFORE it
// trusts a run - the check whose absence let a partially installed fixture, a
// wrong app root or an unexercised profile pass unnoticed.
//
// It throws rather than returning a flag because every caller is a gate: a
// boolean would be checked in one place and forgotten in the next.
function assertReady(options) {
  var opts = options || {};
  var current = status();
  var problems = [];

  if (!current.installed) {
    problems.push('the fixture is not installed: ' +
      Object.keys(current.required).filter(function(name) {
        return current.required[name] && !current.mechanisms[name];
      }).join(', ') + ' inactive');
  }

  if (!current.appRootVerified) {
    problems.push('PARITY_APP_ROOT ' + JSON.stringify(current.appRoot) +
      ' does not look like the application tree - ' +
      current.appRootMissing.join(' and ') + ' missing - so `request` was ' +
      'resolved against the wrong worktree and the active mechanism set is ' +
      'not the one this run assumes');
  }

  // Required by DEFAULT, opt-out rather than opt-in: an existing identity the
  // fixture cannot see in the seeded set means the OAuth existing-user branch
  // is not being exercised, and a driver that has to remember to ask for that
  // check is a driver that will not.
  var identityCheck = checkIdentityContract({
    requireSeeded : opts.requireSeededIdentity !== false
  });
  identityCheck.violations.forEach(function(violation) {
    problems.push(violation);
  });

  if (opts.mechanisms) {
    opts.mechanisms.forEach(function(name) {
      if (!current.mechanisms[name]) {
        problems.push('the ' + name + ' mechanism is required by this driver and is not active' +
          (name === 'request' && current.diagnostic ? ': ' + current.diagnostic : ''));
      }
    });
  }

  if (state.contractViolations.length) {
    problems.push(state.contractViolations.length + ' request contract violation(s) recorded: ' +
      state.contractViolations.map(function(entry) {
        return entry.endpoint + ' (' + entry.mechanism + '): ' + entry.violations.join('; ');
      }).join(' | '));
  }

  if (problems.length) {
    throw new Error('test/parity/fixtures/http.js: the fixture is not ready - ' +
      problems.join('; '));
  }

  return current;
}

// Every contract breach recorded so far, so a driver can assert on them
// without re-reading the evidence file.
function requestContractReport() {
  return {
    violations : state.contractViolations.map(function(entry) {
      return {
        mechanism  : entry.mechanism,
        endpoint   : entry.endpoint,
        url        : entry.url,
        profile    : entry.profile,
        violations : entry.violations.slice()
      };
    }),
    ok : !state.contractViolations.length
  };
}

// How many calls were served per (endpoint, profile, outcome). This is what
// turns "the profile was in force" into "the profile was USED": a check that
// counts nothing cannot tell an exercised branch from an unexercised one, and
// a defined-but-unselected profile is evidence of nothing.
function servedCounts() {
  var out = {};
  Object.keys(state.served).forEach(function(key) {
    out[key] = state.served[key];
  });
  return out;
}

// ---------------------------------------------------------------------------
// Initial profile, from PARITY_HTTP_PROFILE and then from
// PARITY_HTTP_PROFILE_FILE. An unknown name is logged and ignored rather than
// thrown, because this runs at load time.
// ---------------------------------------------------------------------------
// Applies PARITY_HTTP_IDENTITIES, which is how the alignment hook acquires a
// caller in every process that loads this file rather than only in principle:
// setIdentityEmails() is what keeps this fixture and the seeder from drifting,
// and an alignment nothing calls prevents no drift. A malformed value is
// logged and ignored - the declared identities stay in force and the contract
// check reports on them - because a throw here would kill the server before
// app.js loaded.
function alignIdentitiesFromEnvironment() {
  var declared = process.env.PARITY_HTTP_IDENTITIES;
  if (!declared) {
    return;
  }

  var parsed;
  try {
    parsed = JSON.parse(declared);
  }
  catch (e) {
    note('identities-malformed', { value: declared, keeping: identities.existing });
    return;
  }

  try {
    note('identities-aligned', applyIdentityEmails(parsed));
  }
  catch (e) {
    note('identities-rejected', { error: e.message, keeping: identities.existing });
  }
}

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

  // Readiness and evidence about the fixture itself. `assertReady` throws
  // unless every required mechanism is active, the app root is the tree it
  // claims to be, the identity contract holds and no request contract has been
  // breached; `handshake` is the same document install() published.
  assertReady   : assertReady,
  handshake     : function() { return state.handshake; },
  contractReport: requestContractReport,
  servedCounts  : servedCounts,
  identityReport: checkIdentityContract,

  // Profile selection. `profiles` is the catalogue, so capture.js enumerates
  // valid `fixtureProfile` values instead of hard-coding strings.
  profiles     : PROFILES,
  profileNames : function() { return Object.keys(PROFILES); },
  setProfile   : setProfile,
  getProfile   : function() { return state.activeProfile; },

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

  // Identities: `existing` must be an account test/parity/seed.js creates and
  // `new` must be an account it does not, so the two OAuth database branches
  // stay distinct. Alignment goes through this function - or through
  // PARITY_HTTP_IDENTITIES, which calls it at load time - rather than by
  // editing either file.
  identities        : identities,
  seededAccounts    : SEEDED_ACCOUNTS,
  setIdentityEmails : applyIdentityEmails,

  // The frozen values a corpus assertion needs to name. `assetDigests` are the
  // sha1 hex digests of the corresponding buffers, which is what
  // lib/util/file.js turns into the stored S3 object key, so a storage
  // assertion can reference them without recomputing.
  endpoints     : ENDPOINT_URLS,
  assetUrls     : ASSET_URLS,
  unrecordedUrl : UNRECORDED_URL,
  unregisteredOriginUrl : UNREGISTERED_ORIGIN_URL,

  // The three URL SHAPES where fetch and the replaced library disagree about
  // the URL itself, exported next to `assetUrls` for the same reason: a driver
  // names the shape it means instead of typing the string, because in all three
  // the string IS the case. `divergentBlockedPorts` is the pinned set the
  // blocked-port arm enforces, so a driver asserts against the ports the
  // fixture actually refuses rather than against a second copy of a spec list.
  divergentUrls         : DIVERGENT_URLS,
  divergentBlockedPorts : FETCH_BLOCKED_PORTS,
  accessToken   : ACCESS_TOKEN,
  pictureUrl    : PICTURE_URL,
  googleIds     : { existing: GOOGLE_ID_EXISTING, new: GOOGLE_ID_NEW },
  assetBytes    : {
    complete   : ASSET_GIF,
    partial    : ASSET_GIF_PARTIAL,
    redirected : ASSET_PNG,
    errorPage  : ASSET_ERROR_PAGE,
    serverError: ASSET_SERVER_ERROR_PAGE
  },
  assetDigests  : {
    complete   : 'd5fceb6532643d0d84ffe09c40c481ecdf59e15a',
    partial    : '8885cfafb2d7b043d78a4913bb5f3b0f405b0109',
    redirected : '9fb285daedf99a4dad5de09770de5fadf688d3ee',
    errorPage  : '6196b3f53dcab9801e387f9e327228a3aaa9385a',
    // Computed rather than transcribed, so the digest cannot drift from the
    // page it describes.
    serverError: sha1(ASSET_SERVER_ERROR_PAGE)
  },

  // The registry and the redirect contract, exported so a caller asserts
  // against the same numbers the fixture enforced instead of a second copy.
  registeredUrls  : function() { return Object.keys(buildAssetRegistry()); },
  redirectLimits  : {
    legacy : LEGACY_MAX_REDIRECTS,
    fetch  : FETCH_MAX_REDIRECTS,
    withinLegacyLimitHops : ASSET_HOPS_WITHIN_LEGACY_LIMIT,
    beyondLegacyLimitHops : ASSET_HOPS_BEYOND_LEGACY_LIMIT
  },
  hopUrl          : function(n) { return ASSET_HOP_PREFIX + n; },
  requestContracts: REQUEST_CONTRACTS,

  // The self-verifying harness. `selfTest()` drives every profile in the
  // catalogue and every reCAPTCHA outcome and returns a report; `main()` is the
  // same thing as a gate, which is what runs when this file is executed
  // directly.
  selfTest : selfTest,
  main     : main,

  EXIT_OK          : EXIT_OK,
  EXIT_ERROR       : EXIT_ERROR,
  EXIT_USAGE       : EXIT_USAGE,
  EXIT_UNPROTECTED : EXIT_UNPROTECTED
};

// ===========================================================================
// THE SELF-VERIFYING HARNESS
//
// Runs ONLY when this file is executed directly, and is inert on the preload
// path: nothing below is reached by a `require`, and no argv is read unless
// main() is called.
//
// It exists because a recorded response nothing requests is not evidence. The
// catalogue above describes twenty-four outcomes across four call sites, and a
// corpus that drives six of them leaves eighteen recordings that could be wrong
// in any way at all without a single artifact changing - which is exactly the
// state the reCAPTCHA faults, the OAuth failures and the asset status and
// redirect cases were in. Nor is "the profile was in force" the same claim as
// "the branch ran": a check that counts no calls passes on an empty run.
//
// So the harness drives every profile itself, through the same mechanisms and
// with the same call shapes the application uses, and asserts on what came
// back. Three groups can only be asserted from outside the process:
//
//   reCAPTCHA outcome 1 (the isTest short-circuit) and outcome 2 (the
//   unconfigured short-circuit) each need their own configuration state, and
//   they must be distinguishable from one another - so each runs in a child
//   with a configuration that makes only one of the two branches possible.
//
//   reCAPTCHA outcomes 5 and 6 are the two guarded provider faults, and what
//   they have to establish is that the callback FIRES with the fail-closed
//   value and that the process then exits normally. A child is where "the
//   process survived its own provider fault" is a measurement rather than an
//   inference, and it is also what keeps the case honest in the other
//   direction: exit 0 alone would pass on a child that never called verify().
//
//   An unprotected install must terminate the process, which cannot be
//   asserted in the process doing the asserting.
//
// Everything else runs in-process. Every wait is bounded, every child is
// bounded, every temporary directory is removed, and the active profile and the
// identity table are restored afterwards, so a run leaves no state behind.
// ===========================================================================

// The environment variable the parent sets to tell a child which single case to
// run. A PARITY_* variable rather than an argument, because that is how every
// other input to this file arrives.
var SELFTEST_CHILD_VAR = 'PARITY_HTTP_SELFTEST_CHILD';

// Printed by a child when the reCAPTCHA callback fires. Its PRESENCE is the
// assertion for outcomes 5 and 6 - it used to be its absence, and the two
// guards inverted it - so it is a marker rather than prose.
var CHILD_CALLBACK_MARKER = 'PARITY-CHILD-CALLBACK ';
var CHILD_RESULT_MARKER   = 'PARITY-CHILD-RESULT ';

// A configuration overlay carrying a reCAPTCHA secret, which is what makes
// outcomes 3-6 reachable: verify() short-circuits without one. Not a
// credential - it authenticates against this fixture and nothing else.
var SELFTEST_SECRET_OVERLAY = JSON.stringify({ app: { recaptcha: { secretkey: 'parity-fixture-secret' } } });

function expect(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function expectEqual(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(what + ': expected ' + JSON.stringify(expected) +
      ', received ' + JSON.stringify(actual));
  }
}

// Resolves to the rejection a promise produced, and fails if it resolved
// instead. Used wherever the contract is a failure: a case that quietly
// tolerated a success would assert nothing.
function expectRejection(promise, what) {
  return promise.then(
    function(value) {
      throw new Error(what + ': expected a rejection, received a resolved value' +
        (value && value.status ? ' (status ' + value.status + ')' : ''));
    },
    function(error) { return error; }
  );
}

// Runs one case, records the result, and never lets a failure stop the run: a
// harness that stops at the first failure reports one finding per run.
async function runCase(report, group, name, fn) {
  var entry = { group: group, name: name, ok: true, detail: null, error: null };

  try {
    entry.detail = (await fn()) || null;
    report.passed++;
  }
  catch (error) {
    entry.ok = false;
    entry.error = error && error.message ? error.message : String(error);
    report.failed++;
  }

  report.cases.push(entry);
  return entry;
}

// The calls this fixture served since the last mark, as the evidence records
// them. Every driver asserts on this rather than on its own bookkeeping,
// because the record is what a reviewer reads.
function callsSince(mark) {
  return state.calls.slice(mark).filter(function(entry) {
    return entry.event === undefined;
  });
}

// Selects a profile, drives one thing, and returns the calls it produced.
// Wrapping selection and driving together is what makes "exactly one call, to
// this endpoint, under this profile, with this outcome" a single assertion.
async function underProfile(profile, driver) {
  var mark = state.calls.length;
  setProfile(profile);

  var value;
  var failure = null;
  try {
    value = await driver();
  }
  catch (error) {
    failure = error;
  }

  return { value: value, failure: failure, calls: callsSince(mark) };
}

// Asserts that a driver produced exactly one intercepted call with the
// expected endpoint and outcome - the check whose absence let a profile "pass"
// with nothing intercepted at all.
function expectOneCall(result, endpoint, outcome, mechanism) {
  expectEqual(result.calls.length, 1, 'exactly one call should have been intercepted');
  expectEqual(result.calls[0].endpoint, endpoint, 'the endpoint served');
  expectEqual(result.calls[0].outcome, outcome, 'the outcome served');

  if (mechanism) {
    expectEqual(result.calls[0].mechanism, mechanism, 'the mechanism that served it');
  }

  return result.calls[0];
}

// ---------------------------------------------------------------------------
// The request shapes the application sends, replicated exactly so the contract
// oracle is exercised against the real thing rather than against a convenient
// approximation.
//
// They are declared here, next to the drivers, and asserted against the call
// sites' own source text by the `sources` group below, which keeps this copy
// in step with them without importing a controller into a preload.
// ---------------------------------------------------------------------------

function tokenRequestInit(code) {
  return {
    method  : 'POST',
    headers : {
      'content-type' : 'application/x-www-form-urlencoded',
      'accept'       : 'application/json'
    },
    redirect : 'manual',
    body     : 'code=' + encodeURIComponent(code) +
               '&client_id=parity-client-id' +
               '&client_secret=parity-client-secret' +
               '&redirect_uri=' + encodeURIComponent('https://parity.example.com/auth/google/callback') +
               '&grant_type=authorization_code'
  };
}

function userinfoRequestInit(accessToken) {
  return {
    method  : 'GET',
    headers : {
      Authorization : 'Bearer ' + accessToken,
      'accept'      : 'application/json'
    }
  };
}

function recaptchaRequestInit(token) {
  return {
    method  : 'POST',
    headers : { 'content-type': 'application/x-www-form-urlencoded' },
    body    : new URLSearchParams({ secret: 'parity-fixture-secret', response: token })
  };
}

// ---------------------------------------------------------------------------
// Group: identities. The contract that decides which OAuth database branch
// runs, checked rather than described.
// ---------------------------------------------------------------------------
async function identityCases(report) {
  await runCase(report, 'identity', 'the existing identity is an account the seeder creates', async function() {
    var check = checkIdentityContract({ requireSeeded: true });
    expect(check.existingSeeded, 'identities.existing ' + JSON.stringify(check.existing) +
      ' is not among the seeded accounts ' + JSON.stringify(check.seededAccounts) +
      ', so the OAuth existing-user branch would take the new-user path instead');
    expectEqual(check.violations.length, 0, 'identity contract violations');
    return { existing: check.existing, existingUsername: check.existingUsername };
  });

  await runCase(report, 'identity', 'the new identity misses every seeded email and username', async function() {
    var check = checkIdentityContract();
    check.seededAccounts.forEach(function(email) {
      expect(email !== check.new, 'identities.new must not be the seeded address ' + email);
    });
    expect(check.new !== check.existing, 'the two identities must differ');
    expect(check.newUsername !== check.existingUsername, 'the two derived usernames must differ');
    return { new: check.new, newUsername: check.newUsername };
  });

  await runCase(report, 'identity', 'the alignment hook applies and refuses drift', async function() {
    var original = { existing: identities.existing, new: identities.new };

    try {
      var applied = applyIdentityEmails({ existing: 'admin@example.com' });
      expectEqual(applied.existing, 'admin@example.com', 'the aligned existing address');
      expectEqual(applied.existingUsername, 'admin-example-com', 'the derived username');
      expect(checkIdentityContract({ requireSeeded: true }).ok,
        'admin@example.com is seeded, so aligning to it must satisfy the contract');

      applyIdentityEmails({ new: 'test@dummy.com' });
      var drifted = checkIdentityContract();
      expect(!drifted.ok, 'a `new` identity that is seeded must be a violation');
      expect(drifted.violations.join(' ').indexOf('SEEDED') !== -1,
        'the violation must say the address is seeded, and says: ' + drifted.violations.join(' | '));

      var rejected = null;
      try {
        applyIdentityEmails({ existing: 'not-an-email' });
      }
      catch (error) {
        rejected = error;
      }
      expect(rejected, 'a value that is not an email address must be rejected');

      return { violations: drifted.violations.length };
    }
    finally {
      applyIdentityEmails(original);
    }
  });

  await runCase(report, 'identity', 'the literals here equal the seeder\'s published map', async function() {
    // The one check that makes the two artifacts unable to drift. This file
    // may not require test/parity/seed.js - the seeder pulls lib/models/**,
    // and therefore mongoose-schema-extend, into whatever process loads it,
    // which is the load-order fault AAP 0.6.5 defect 2 describes and would
    // make @hapi/hapi unloadable for any preload that did it. So the seeder's
    // export is read in a CHILD process, where that side effect is contained
    // and cannot reach this one, and only its two addresses cross back.
    //
    // Without this, an alignment held by two copies of one address is exactly
    // as strong as the comments asking a reader to keep them equal - which is
    // how the fixture came to serve an identity the seeder was not linking.
    var child = childProcess.spawnSync(process.execPath, [
      '-e',
      'process.stdout.write(JSON.stringify(require(process.argv[1]).oauthIdentities));',
      pathModule.join(__dirname, '..', 'seed.js')
    ], { encoding: 'utf8', timeout: 60000 });

    expectEqual(child.status, 0, 'reading test/parity/seed.js in a child process must ' +
      'succeed, and it said: ' + String(child.stderr || '').slice(0, 400));

    var published = JSON.parse(String(child.stdout));

    expectEqual(published.existing, identities.existing,
      'the seeder publishes the existing OAuth address and this fixture serves it; ' +
      'a difference inverts the branch the profile is named for');
    expectEqual(published.new, identities.new,
      'the seeder publishes the new-user address and this fixture serves it');
    expectEqual(published.existingUsername, identities.existingUsername,
      'both files derive the username the same way');
    expectEqual(published.newUsername, identities.newUsername,
      'both files derive the username the same way');

    // The seeded set this file checks `existing` against has to contain the
    // address the seeder actually creates for it, or requireSeeded reports the
    // aligned identity as unverified - which is the shape the defect took.
    expect(SEEDED_ACCOUNTS.some(function(account) {
      return account.email === published.existing;
    }), 'SEEDED_ACCOUNTS must list the seeder\'s OAuth account ' +
      JSON.stringify(published.existing));

    return { existing: published.existing, new: published.new };
  });
}

// ---------------------------------------------------------------------------
// Group: the registry, and the proof that nothing escapes.
//
// The negative control for the no-network guarantee. It runs against BOTH
// mechanisms and every endpoint class, including the case that a fail-open
// classifier would serve: a perfectly parseable https URL on an origin no
// profile records.
// ---------------------------------------------------------------------------
async function registryCases(report, context) {
  await runCase(report, 'registry', 'an unregistered path on a recorded origin is refused', async function() {
    var result = await underProfile('default', function() {
      return expectRejection(fetch(UNRECORDED_URL), 'the unrecorded URL');
    });

    expectEqual(result.value.constructor.name, 'TypeError', 'the rejection type');
    expectEqual(result.value.message, 'fetch failed', 'the rejection message');
    expectEqual(result.value.cause.code, 'PARITY_UNRECORDED', 'the cause code');
    var call = expectOneCall(result, 'unknown', 'unrecorded', 'fetch');
    expectEqual(call.reason, 'unregistered-endpoint', 'the recorded reason');
    return { code: result.value.cause.code };
  });

  await runCase(report, 'registry', 'an unregistered ORIGIN is refused rather than served asset bytes', async function() {
    var result = await underProfile('default', function() {
      return expectRejection(fetch(UNREGISTERED_ORIGIN_URL), 'the unregistered origin');
    });

    expectEqual(result.value.cause.code, 'PARITY_UNRECORDED', 'the cause code');
    expectOneCall(result, 'unknown', 'unrecorded', 'fetch');

    // What this guards: under a fail-open classifier the same call resolves
    // 200 with the active profile's asset bytes, so a new outbound endpoint -
    // or an SSRF payload - looks like a successful fetch.
    return { url: UNREGISTERED_ORIGIN_URL };
  });

  await runCase(report, 'registry', 'every enumerated asset URL and redirect hop is registered', async function() {
    var registered = Object.keys(buildAssetRegistry());
    Object.keys(ASSET_URLS).forEach(function(name) {
      var parsed = new URL(ASSET_URLS[name]);
      expect(registered.indexOf(parsed.origin + parsed.pathname) !== -1,
        'the asset URL ' + name + ' must be registered');
    });

    for (var hop = 1; hop <= ASSET_HOPS_BEYOND_LEGACY_LIMIT; hop++) {
      var hopUrl = new URL(ASSET_HOP_PREFIX + hop);
      expect(registered.indexOf(hopUrl.origin + hopUrl.pathname) !== -1,
        'redirect hop ' + hop + ' must be registered, or a caller following the ' +
        'chain itself would fail half way through it');
    }

    return { registered: registered.length };
  });

  await runCase(report, 'registry', 'a non-http scheme and an unparseable URL are refused', async function() {
    var scheme = classify('data:image/gif;base64,R0lGODlhAQABAAAAACw=');
    expectEqual(scheme.endpoint, null, 'a data: URL must not classify');
    expect(scheme.reason.indexOf('unsupported-protocol') === 0, 'the reason: ' + scheme.reason);

    var broken = classify('http://[not-a-host]/x');
    expectEqual(broken.endpoint, null, 'an unparseable URL must not classify');
    expectEqual(broken.reason, 'unparseable-url', 'the reason');

    expectEqual(classify('').endpoint, null, 'an empty URL must not classify');
    expectEqual(classify(null).endpoint, null, 'a missing URL must not classify');
    return { reasons: [scheme.reason, broken.reason] };
  });

  await runCase(report, 'registry', 'the `none` profile records nothing for any endpoint', async function() {
    var endpoints = [
      ['recaptcha', ENDPOINT_URLS.recaptcha, recaptchaRequestInit('t')],
      ['token', ENDPOINT_URLS.token, tokenRequestInit('c')],
      ['userinfo', ENDPOINT_URLS.userinfo, userinfoRequestInit(ACCESS_TOKEN)],
      ['asset', ASSET_URLS.plain, undefined]
    ];

    var codes = [];
    for (var i = 0; i < endpoints.length; i++) {
      var entry = endpoints[i];
      var result = await underProfile('none', function() {
        return expectRejection(fetch(entry[1], entry[2]), 'the ' + entry[0] + ' endpoint under `none`');
      });

      expectEqual(result.value.cause.code, 'PARITY_UNRECORDED', entry[0] + ': the cause code');
      expectOneCall(result, entry[0], 'unrecorded', 'fetch');
      codes.push(entry[0]);
    }

    return { endpoints: codes };
  });

  await runCase(report, 'registry', 'a credential-bearing URL is refused exactly as native fetch refuses it', async function() {
    // Measured on Node 22.23.2: fetch rejects a URL with userinfo before any
    // request, with a TypeError naming the URL, no `cause` and no socket. The
    // replaced library ACCEPTED such a URL - it moved the userinfo onto an
    // Authorization header - so this is one of the three divergences
    // docs/preserved-quirks.md 11.4 declares at the asset call site, and a
    // fixture that stripped the credentials and served a 200 would report
    // parity across it.
    //
    // Driven from DIVERGENT_URLS rather than from a string typed here, which is
    // the point of the shape being registered: the driver names the shape.
    var result = await underProfile('asset:success', function() {
      return expectRejection(fetch(DIVERGENT_URLS.credentialed), 'a credential-bearing URL');
    });

    expectEqual(result.value.constructor.name, 'TypeError', 'the rejection type');
    expect(result.value.message.indexOf('Request cannot be constructed from a URL that includes credentials') === 0,
      'the message must be the runtime\'s own, and is: ' + result.value.message);
    expectEqual(result.value.cause, undefined, 'native fetch attaches no cause to this refusal');
    ['parity-user', 'parity-pass'].forEach(function(secret) {
      expect(result.value.message.indexOf(secret) === -1,
        'the message must not carry the ' + secret + ' half of the authority it is refusing');
    });

    var call = expectOneCall(result, 'asset', 'credential-url-refused', 'fetch');
    expect(call.url.indexOf('userinfo-stripped:') === 0,
      'the record must mark the stripped authority, and carries: ' + call.url);
    ['parity-user', 'parity-pass'].forEach(function(secret) {
      expect(call.url.indexOf(secret) === -1, 'and must not carry ' + secret);
    });

    // The shape is NAMED in the record. Without this the refusal is
    // indistinguishable in the evidence from a URL nothing recorded, because
    // both leave the asset call site on the same log-only arm.
    expectEqual(call.registration, 'divergence:credentialed-url',
      'the record must name the divergence it drove');
    expectEqual(call.reason, 'fetch-refuses-url-credentials', 'and why the URL was refused');
    return { message: result.value.message, registration: call.registration };
  });

  await runCase(report, 'registry', 'a Fetch-forbidden port is refused as the runtime refuses it', async function() {
    // The divergence that had NO reproduction before this: the URL is http, so
    // it reached the registry, missed, and rejected as PARITY_UNRECORDED - the
    // fixture's own refusal standing in for the runtime's.
    //
    // Measured on Node 22.23.2, with net.Socket.prototype.connect counting:
    // ports 6000, 22 and 9 all reject with TypeError('fetch failed') whose
    // cause is Error('bad port') carrying no own properties, at zero sockets,
    // while the same host on 8080 reaches DNS and fails ENOTFOUND after one
    // socket. So the refusal precedes the dispatch, which is why the arm
    // precedes the registry lookup.
    var result = await underProfile('asset:success', function() {
      return expectRejection(fetch(DIVERGENT_URLS.blockedPort), 'a URL on a Fetch-forbidden port');
    });

    expectEqual(result.value.constructor.name, 'TypeError', 'the rejection type');
    expectEqual(result.value.message, 'fetch failed', 'the rejection message');
    expectEqual(result.value.cause.message, 'bad port', 'the cause message, which is the whole signature');
    expectEqual(result.value.cause.code, undefined,
      'the genuine cause carries no code, so neither may this one - a code would ' +
      'make it read as a transport error');
    expectEqual(result.value.cause.syscall, undefined, 'and no syscall, for the same reason');

    var call = expectOneCall(result, 'unknown', 'blocked-port-refused', 'fetch');
    expectEqual(call.registration, 'divergence:blocked-port',
      'the record must name the divergence it drove');
    expect(call.reason.indexOf('fetch-blocked-port:6000') === 0,
      'and name the port and why it is blocked, and carries: ' + call.reason);

    // Every pinned port behaves the same way, driven from the exported table
    // rather than from a list repeated here.
    var ports = Object.keys(FETCH_BLOCKED_PORTS);
    for (var i = 0; i < ports.length; i++) {
      var refused = await expectRejection(
        fetch('http://parity.example.com:' + ports[i] + '/assets/fixture.gif'),
        'port ' + ports[i]);
      expectEqual(refused.cause.message, 'bad port', 'port ' + ports[i] + ': the cause message');
    }

    // And a port that is NOT pinned still classifies normally, which is what
    // keeps this arm from becoming a blanket refusal: an unregistered origin is
    // still refused, and refused as unrecorded rather than as a bad port.
    var unpinned = await expectRejection(
      fetch('http://parity.example.com:8081/assets/fixture.gif'), 'an unpinned port');
    expectEqual(unpinned.cause.code, 'PARITY_UNRECORDED',
      'a port this fixture does not pin must fail closed, not as a bad port');

    return { ports: ports, registration: call.registration };
  });

  await runCase(report, 'registry', 'the declared data: URL is resolved by the RUNTIME, with no socket', async function() {
    // The first of 11.4's three divergences, and the only one this file serves
    // by delegation. `request` threw `Invalid protocol: data:` synchronously;
    // fetch resolves the URL out of its own payload. Measured on Node 22.23.2
    // with net.Socket.prototype.connect counting: 200, content-type
    // `text/plain`, body "hi", ZERO sockets.
    //
    // A recorded 200 would prove nothing about the runtime - it would prove
    // this fixture can invent a body - so the call is handed to the retained
    // original and the response asserted is the runtime's own. The harness's
    // tripwire counts that delegation separately from an escape, and the case
    // below asserts both counters.
    var delegationsBefore = context.tripwire.dataUrlDelegations;
    var result = await underProfile('none', function() {
      return fetch(DIVERGENT_URLS.data);
    });

    expect(!result.failure, 'the delegated data: URL must resolve: ' +
      (result.failure && result.failure.message));
    expectEqual(result.value.status, 200, 'the status the runtime produces');
    expectEqual(result.value.headers.get('content-type'), 'text/plain', 'the content type');
    expectEqual(await result.value.text(), 'hi', 'the body, which travels inside the URL');

    // Driven under the `none` profile deliberately: `none` records nothing for
    // any endpoint, so a fixture-served response is impossible here and the 200
    // can only have come from the runtime.
    var call = expectOneCall(result, 'unknown', 'data-url-delegated', 'fetch');
    expectEqual(call.registration, 'divergence:data-url', 'the record must name the divergence');
    expectEqual(call.reason, 'delegated-to-retained-fetch', 'and that it was delegated');
    expectEqual(context.tripwire.dataUrlDelegations, delegationsBefore + 1,
      'the delegation must have gone through the retained original');
    expectEqual(context.tripwire.fetchCalls, 0,
      'and it must not be counted as an escape');

    return { status: 200, delegations: context.tripwire.dataUrlDelegations };
  });

  await runCase(report, 'registry', 'delegation is reachable ONLY for a declared data: URL', async function() {
    // The gate, tested from both sides rather than trusted from the caller.
    //
    // An UNDECLARED data: URL fails closed exactly as it did before this
    // registry existed, so the scheme alone buys nothing: a caller cannot widen
    // the delegation by passing a data: URL of its own, and an exotic scheme is
    // not delegated for being exotic.
    var undeclared = await underProfile('asset:success', function() {
      return expectRejection(fetch('data:text/plain,not-declared'), 'an undeclared data: URL');
    });

    expectEqual(undeclared.value.cause.code, 'PARITY_UNRECORDED', 'the cause code');
    var undeclaredCall = expectOneCall(undeclared, 'unknown', 'unrecorded', 'fetch');
    expectEqual(undeclaredCall.reason, 'unsupported-protocol:data:', 'the recorded reason');

    // And the http(s) side of the gate: the two enumerated fail-closed controls
    // are still refused, which is the invariant the delegation must not have
    // loosened. Re-driven here rather than assumed from the cases above,
    // because this is the case that would catch a scheme test written the wrong
    // way round.
    var controls = [UNRECORDED_URL, UNREGISTERED_ORIGIN_URL];
    for (var i = 0; i < controls.length; i++) {
      var refused = await expectRejection(fetch(controls[i]), controls[i]);
      expectEqual(refused.cause.code, 'PARITY_UNRECORDED', controls[i] + ': the cause code');
    }

    expectEqual(context.tripwire.fetchCalls, 0,
      'none of the four may have reached the retained original');
    return { refused: controls.length + 1 };
  });

  await runCase(report, 'registry', 'the declared shapes cannot be smuggled into the ASSET registry', async function() {
    // PARITY_HTTP_ASSET_URLS is the supported way to extend the ASSET registry,
    // and it takes absolute http(s) URLs only. The URL-shape table is a
    // different thing and must stay one: a data: URL declared through the
    // environment must still be rejected there, or the two registries would
    // merge and the delegation gate would be reachable from outside this file.
    var before = process.env.PARITY_HTTP_ASSET_URLS;
    var mark = state.calls.length;

    try {
      process.env.PARITY_HTTP_ASSET_URLS = JSON.stringify([DIVERGENT_URLS.data, 'not a url']);
      var registered = Object.keys(buildAssetRegistry());

      expect(registered.indexOf('nulltext/plain,hi') === -1,
        'a data: URL must not enter the asset registry under any key');
      registered.forEach(function(key) {
        expect(key.indexOf('data:') === -1, 'no asset key may carry a data: URL, and one does: ' + key);
      });

      var rejections = state.calls.slice(mark).filter(function(entry) {
        return entry.event === 'asset-registry-rejected';
      });
      expectEqual(rejections.length, 2, 'both entries must be rejected and both logged');
      expect(rejections[0].detail.reason === 'unsupported-protocol:data:',
        'the data: entry must be rejected for its scheme, and was: ' + rejections[0].detail.reason);
      expect(rejections[1].detail.reason === 'unparseable-url',
        'and the non-URL for being unparseable, and was: ' + rejections[1].detail.reason);

      return { rejected: rejections.length };
    }
    finally {
      if (before === undefined) {
        delete process.env.PARITY_HTTP_ASSET_URLS;
      }
      else {
        process.env.PARITY_HTTP_ASSET_URLS = before;
      }
      // Re-derive on the restored value, so the memoized registry the rest of
      // the run uses is the one this case started from.
      buildAssetRegistry();
    }
  });

  await runCase(report, 'registry', 'no credential reaches the evidence, from a header, a query or an authority', async function() {
    var mark = state.calls.length;
    setProfile('recaptcha:success');

    var secrets = ['COOKIE-SECRET-VALUE', 'APIKEY-SECRET-VALUE', 'QUERY-SECRET-VALUE', 'AUTHORITY-SECRET'];

    // Served: extra credential-bearing headers alongside a conforming request.
    var init = recaptchaRequestInit('probe-token');
    init.headers = {
      'content-type'  : 'application/x-www-form-urlencoded',
      'cookie'        : 'session=' + secrets[0] + '; Path=/',
      'x-api-key'     : secrets[1] + ' trailing',
      'authorization' : 'Bearer ' + secrets[1]
    };
    await fetch(ENDPOINT_URLS.recaptcha, init);

    // Refused: a signed query, which the contract now rejects - and whose
    // values must be redacted in the violation as well as in the record. The
    // refusal is deliberate, so it is counted: the accounting case at the end
    // of the run requires every recorded violation to be one a case drove on
    // purpose, and it caught this one when it was not.
    context.deliberateBreaches++;
    try {
      await fetch(ENDPOINT_URLS.recaptcha + '?X-Amz-Credential=' + secrets[2] +
        '&X-Amz-Security-Token=' + secrets[2], recaptchaRequestInit('probe-token'));
    }
    catch (ignored) { /* the refusal is the point; the evidence is what is asserted */ }

    // Unparseable, and carrying a secret in what would have been its query.
    try {
      await fetch('https://[broken]/x?access_token=' + secrets[3]);
    }
    catch (ignored) { /* the throw is expected; the evidence is what is asserted */ }

    var evidence = JSON.stringify(state.calls.slice(mark));
    secrets.forEach(function(secret) {
      expect(evidence.indexOf(secret) === -1,
        'the evidence must not carry ' + secret + '; it appears in: ' +
        evidence.slice(Math.max(0, evidence.indexOf(secret) - 80), evidence.indexOf(secret) + 40));
    });

    expect(evidence.indexOf('unparseable-url:sha1:') !== -1,
      'an unparseable URL must be reduced to a digest rather than written out');
    return { probed: secrets.length };
  });

  await runCase(report, 'registry', 'the retained originals were never invoked', async function() {
    expectEqual(context.tripwire.fetchCalls, 0,
      'the genuine fetch must never be called, and was called ' + context.tripwire.fetchCalls + ' time(s)');
    expectEqual(context.tripwire.requestCalls, 0,
      'the genuine request export must never be called, and was called ' + context.tripwire.requestCalls + ' time(s)');

    // The one exception, asserted rather than left implicit: the declared
    // data: URL shape IS handed to the retained original, exactly once, by the
    // delegation case above. Counted separately so that `fetchCalls` keeps
    // meaning "a call this fixture should never have made" - and asserted at an
    // exact number so a second, unexplained delegation is a failure rather
    // than a widened allowance.
    expectEqual(context.tripwire.dataUrlDelegations, 1,
      'exactly one delegation is expected, for the declared data: URL, and there were ' +
      context.tripwire.dataUrlDelegations);
    return { fetchCalls: 0, requestCalls: 0, dataUrlDelegations: 1 };
  });
}

// ---------------------------------------------------------------------------
// Group: readiness. The assertion a driver makes before trusting a run, and
// the states it has to refuse.
// ---------------------------------------------------------------------------
async function readinessCases(report) {
  await runCase(report, 'install', 'assertReady() passes when the fixture is wholly in force', async function() {
    var current = assertReady({ requireSeededIdentity: true });
    expectEqual(current.installed, true, 'the fixture must be installed');
    expectEqual(current.mechanisms.fetch, true, 'fetch must be active');
    expectEqual(current.appRootVerified, true, 'the app root must verify');
    expectEqual(current.identity.identityOk, true, 'the identity contract must hold');
    return { mechanisms: current.mechanisms };
  });

  await runCase(report, 'install', 'assertReady() refuses a mechanism this driver needs and does not have', async function() {
    var threw = null;
    try {
      // `request` is absent from the target manifest, so a driver that needs
      // the legacy mechanism must be told so rather than run against fetch and
      // report a baseline it never exercised.
      assertReady({ mechanisms: ['request'] });
    }
    catch (error) {
      threw = error;
    }

    expect(threw, 'a driver requiring the request mechanism must be refused on this tree');
    expect(threw.message.indexOf('request mechanism is required') !== -1,
      'the refusal must name the mechanism, and says: ' + threw.message);
    return { refused: true };
  });

  await runCase(report, 'install', 'assertReady() requires the seeded identity BY DEFAULT', async function() {
    var original = { existing: identities.existing, new: identities.new };
    var threw = null;

    try {
      // An address no seeded account holds: the OAuth existing-user branch
      // would silently take the new-user path, which is the inversion the
      // identity contract exists to prevent. A driver must not have to ask for
      // that check.
      applyIdentityEmails({ existing: 'nobody-seeded-this@example.com' });

      try {
        assertReady();
      }
      catch (error) {
        threw = error;
      }
    }
    finally {
      applyIdentityEmails(original);
    }

    expect(threw, 'an unseeded existing identity must fail default readiness');
    expect(threw.message.indexOf('not one of the accounts') !== -1,
      'the refusal must say the address is not seeded, and says: ' + threw.message);
    assertReady();                     // and the restored identity passes again
    return { refused: true };
  });

  await runCase(report, 'install', 'assertReady() refuses an uninstalled fixture', async function() {
    var threw = null;
    restore();

    try {
      assertReady();
    }
    catch (error) {
      threw = error;
    }
    finally {
      install();
    }

    expect(threw, 'a restored fixture is not ready, and must say so');
    expect(threw.message.indexOf('not installed') !== -1,
      'the refusal must say the fixture is not installed, and says: ' + threw.message);
    expectEqual(status().installed, true, 'and the fixture must be back in force afterwards');
    return { refused: true };
  });

  await runCase(report, 'install', 'the handshake is recorded in the evidence log of every run', async function() {
    var installRecords = state.calls.filter(function(entry) { return entry.event === 'install'; });
    expect(installRecords.length >= 1,
      'install() must record its handshake, so a run that sets no PARITY_HTTP_STATUS still carries it');

    var recorded = installRecords[installRecords.length - 1].detail;
    expectEqual(recorded.identity.module, __filename, 'the handshake names this implementation');
    expectEqual(recorded.identity.digest, fixtureDigest, 'and carries its digest');
    return { records: installRecords.length };
  });
}

// ---------------------------------------------------------------------------
// Group: reCAPTCHA, all six outcomes, by DIRECT MODULE-LEVEL INVOCATION of
// lib/util/recaptcha.js's verify().
//
// This is the group the header promised and nothing performed. It matters more
// than its size suggests: under NODE_ENV=test `config.isTest` is true and
// outcome 1 short-circuits before any HTTP, so these six recorded responses
// are unreachable through any route in the suite. Direct invocation is the only
// way they are ever exercised, and until it existed the records were unexecuted
// code.
//
// Outcomes 3 and 4, the rejected variant and the non-object body run here.
// Outcomes 1, 2, 5 and 6 need their own process, and childCases() drives them.
// ---------------------------------------------------------------------------
async function recaptchaCases(report, context) {
  var recaptcha = context.recaptcha;

  if (!recaptcha) {
    await runCase(report, 'recaptcha', 'lib/util/recaptcha.js is loadable', async function() {
      throw new Error('lib/util/recaptcha.js could not be required from ' +
        context.appRoot + ': ' + context.recaptchaError +
        '. Every reCAPTCHA outcome is unexercised without it.');
    });
    return;
  }

  // verify() takes a callback and returns nothing, so each outcome is bounded
  // here rather than left to resolve whenever.
  function verifyOnce(token) {
    return new Promise(function(resolve, reject) {
      var settled = false;
      var timer = setTimeout(function() {
        if (!settled) {
          settled = true;
          reject(new Error('verify() did not call back within 5000ms'));
        }
      }, 5000);

      recaptcha.verify(token, function(result) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      });
    });
  }

  await runCase(report, 'recaptcha', 'outcome 3: a 200 delivers the body parsed from response.body', async function() {
    var result = await underProfile('recaptcha:success', function() { return verifyOnce('parity-token'); });
    expect(!result.failure, 'verify() should have called back: ' + (result.failure && result.failure.message));
    expectEqual(result.value.success, true, 'the parsed `success` field');
    expectEqual(result.value.challenge_ts, '2015-06-15T12:00:00Z', 'the frozen challenge_ts');
    expectEqual(result.value.score, 0.9, 'the parsed score');

    var call = expectOneCall(result, 'recaptcha', 'recaptcha-200-success', 'fetch');
    expectEqual(call.request.method, 'POST', 'the outbound method');
    expectEqual(call.request.headers['content-type'], 'application/x-www-form-urlencoded',
      'the outbound content-type');
    expect(call.request.bodyFields.indexOf('secret') !== -1, 'the body must carry `secret`');
    expect(call.request.bodyFields.indexOf('response') !== -1, 'the body must carry `response`');
    expectEqual(call.request.bodyValues.secret, REDACTED, 'the secret must be redacted in the evidence');
    return { fields: call.request.bodyFields };
  });

  await runCase(report, 'recaptcha', 'outcome 3 (rejected): success false reaches the caller as false', async function() {
    var result = await underProfile('recaptcha:rejected', function() { return verifyOnce('parity-token'); });
    expectEqual(result.value.success, false, 'the parsed `success` field');
    expect(Array.isArray(result.value['error-codes']), 'the provider error codes must survive');
    expectOneCall(result, 'recaptcha', 'recaptcha-200-rejected', 'fetch');
    return { errorCodes: result.value['error-codes'] };
  });

  await runCase(report, 'recaptcha', 'outcome 4: a non-200 delivers {status:false}, a DIFFERENT shape', async function() {
    var result = await underProfile('recaptcha:non-200', function() { return verifyOnce('parity-token'); });
    expectEqual(JSON.stringify(result.value), '{"status":false}', 'the callback value');
    expectEqual(result.value.success, undefined,
      'the non-200 shape must NOT carry `success`: callers branch on `success`, so a ' +
      'non-200 is a differently shaped object rather than a falsy success');
    expectOneCall(result, 'recaptcha', 'recaptcha-503', 'fetch');
    return { value: result.value };
  });

  await runCase(report, 'recaptcha', 'outcome 3 (non-object body): the parsed value is delivered VERBATIM', async function() {
    // The boundary of the approved deviation, driven from this side rather
    // than described. verify() guards the response and the parse; it does not
    // inspect what the parse produced, so a body of `null` is delivered as
    // `null` - which is what baseline delivered too, so nothing here deviates.
    var result = await underProfile('recaptcha:non-object-body', function() {
      return verifyOnce('parity-token');
    });

    expect(!result.failure, 'verify() must call back: ' + (result.failure && result.failure.message));
    expectEqual(result.value, null,
      'the parsed value must arrive verbatim and NOT be normalized to {status:false} - ' +
      'that shape belongs to the two guarded faults, and conflating them would hide ' +
      'the fact that this one still throws');

    // Where it throws is the whole point, and it is not here: the read happens
    // at the caller, inside its own lifecycle method, so it reaches the
    // preserved Layer 1 catch-all and answers 500 with the process alive
    // instead of ending it. Reproduced on the delivered value so the case
    // states which fault the route will see; the route outcome itself belongs
    // to a driver against a running server.
    var threw = null;
    try {
      void (result.value.success);
    }
    catch (error) {
      threw = error;
    }

    expect(threw && threw.constructor.name === 'TypeError',
      'reading `success` off the delivered value must throw a TypeError, and produced ' +
      (threw ? threw.constructor.name : 'no throw'));
    expectOneCall(result, 'recaptcha', 'recaptcha-200-null-body', 'fetch');
    return { value: result.value, callerFault: 'TypeError at the read' };
  });
}

// ---------------------------------------------------------------------------
// Group: Google OAuth. Every provider outcome, driven with the exact call
// shapes lib/controllers/auth.js sends.
//
// The controller itself cannot be driven from here - its handlers need a hapi
// request, a live database and the `log` and `User` globals app.js installs -
// so the two calls are replicated and the replication is pinned to the
// controller's own source text by the `sources` group. What that buys is the
// oracle the encoding helpers had none of: the outbound method, headers, form
// fields, encoding and redirect mode are asserted per outcome, on the record
// the evidence log carries.
// ---------------------------------------------------------------------------
async function oauthCases(report) {
  // The token exchange, as the controller issues it.
  function exchangeToken() {
    return fetch(ENDPOINT_URLS.token, tokenRequestInit('parity-authorization-code'))
      .then(function(response) {
        return response.text().then(function(text) {
          return { status: response.status, body: legacyJsonBody(text) };
        });
      });
  }

  function fetchProfile() {
    return fetch(ENDPOINT_URLS.userinfo, userinfoRequestInit(ACCESS_TOKEN))
      .then(function(response) {
        return response.text().then(function(text) {
          return { status: response.status, body: legacyJsonBody(text) };
        });
      });
  }

  await runCase(report, 'oauth', 'success (existing user): the token and the seeded email', async function() {
    var token = await underProfile('oauth:success-existing-user', exchangeToken);
    expectEqual(token.value.status, 200, 'the token status');
    expectEqual(token.value.body.access_token, ACCESS_TOKEN, 'the frozen access token');
    var tokenCall = expectOneCall(token, 'token', 'token-200-success', 'fetch');
    expectEqual(tokenCall.request.redirect, 'manual',
      'the token exchange must not follow redirects: fetch downgrades a redirected POST to GET');
    expectEqual(tokenCall.request.bodyValues.grant_type, 'authorization_code', 'the grant type');
    expectEqual(tokenCall.request.bodyValues.code, REDACTED,
      'the authorization code must be redacted in the evidence');

    var profile = await underProfile('oauth:success-existing-user', fetchProfile);
    expectEqual(profile.value.body.email, identities.existing,
      'the profile email must be the SEEDED identity, or this profile drives the new-user branch');
    expectEqual(profile.value.body.picture, PICTURE_URL, 'the frozen picture URL');
    expectEqual(profile.value.body.id, GOOGLE_ID_EXISTING, 'the frozen Google id');
    var profileCall = expectOneCall(profile, 'userinfo', 'userinfo-200-existing-user', 'fetch');
    expectEqual(profileCall.request.headers.authorization, 'Bearer ' + REDACTED,
      'the bearer token must be redacted in the evidence, with its scheme intact');
    return { email: profile.value.body.email };
  });

  await runCase(report, 'oauth', 'success (new user): an email no seeded account holds', async function() {
    var profile = await underProfile('oauth:success-new-user', fetchProfile);
    expectEqual(profile.value.body.email, identities.new, 'the profile email');
    expectEqual(profile.value.body.id, GOOGLE_ID_NEW, 'the frozen Google id');
    checkIdentityContract().seededAccounts.forEach(function(seeded) {
      expect(profile.value.body.email !== seeded,
        'the new-user email must not be the seeded address ' + seeded);
    });
    expectOneCall(profile, 'userinfo', 'userinfo-200-new-user', 'fetch');

    // The branch this feeds is the preserved save-then-fail: the account IS
    // created and a generic authentication failure IS reported.
    // What is asserted here is the input that selects it - the outcome itself
    // belongs to the corpus, which drives the controller.
    return { email: profile.value.body.email, selects: 'new-user branch' };
  });

  await runCase(report, 'oauth', 'token 400: err is null and the body is still parsed', async function() {
    var token = await underProfile('oauth:token-non-2xx', exchangeToken);
    expectEqual(token.value.status, 400, 'the token status');
    expectEqual(token.value.body.error, 'invalid_grant', 'the provider error');
    expectEqual(token.value.body.access_token, undefined,
      'no access token, so the guard rejects and the generic failure is reported');
    expectOneCall(token, 'token', 'token-400-invalid-grant', 'fetch');
    return { status: 400 };
  });

  await runCase(report, 'oauth', 'token 200 with no access_token', async function() {
    var token = await underProfile('oauth:token-malformed-body', exchangeToken);
    expectEqual(token.value.status, 200, 'the token status');
    expectEqual(token.value.body.access_token, undefined, 'the missing access token');
    expectEqual(token.value.body.token_type, 'Bearer', 'the rest of the body survives');
    expectOneCall(token, 'token', 'token-200-no-access-token', 'fetch');
    return { status: 200 };
  });

  await runCase(report, 'oauth', 'token 200 whose body parses to null: the guard REFUSES it', async function() {
    var token = await underProfile('oauth:token-non-object-body', exchangeToken);
    expectEqual(token.value.status, 200, 'the token status');
    expectEqual(token.value.body, null,
      'a body of `null` must arrive as null - that value is the whole of this case, and ' +
      'the guard below is what the controller does with it');

    // The guard the controller runs, on the value the fixture delivered, in the
    // shape lib/controllers/auth.js delivers it in:
    //   if (err || !body || !body.access_token) return reject(err || new Error(...));
    //
    // Re-pointed at the delivered behaviour. This case used to run baseline's
    // unguarded `!body.access_token` and assert that it threw a TypeError,
    // which was true of baseline and is no longer true of this tree: the `!body`
    // test was added under the approved deviation at
    // docs/preserved-quirks.md 10.7, because one unauthenticated
    // GET /auth/google/callback under this profile ended the process. Measured
    // against a running server, the same request now answers 302 to /signup
    // with the process alive.
    //
    // What is asserted is therefore the delivered outcome and not merely the
    // absence of the old one: the dereference does not happen, the guard
    // produces the rejection value the chain has always carried, and that value
    // is what reaches the generic authentication failure.
    var threw = null;
    var rejection = null;
    try {
      var body = token.value.body;
      if (!body || !body.access_token) {
        rejection = new Error('Failed to get access token');
      }
    }
    catch (error) {
      threw = error;
    }

    expect(!threw, 'the guard must not throw on a null body, and threw ' +
      (threw ? threw.constructor.name + ': ' + threw.message : ''));
    expect(rejection, 'the guard must refuse the body rather than pass it on');
    expectEqual(rejection.constructor.name, 'Error', 'the rejection type');
    expectEqual(rejection.message, 'Failed to get access token',
      'the message the terminal catch logs and the generic failure is reported from');
    expectOneCall(token, 'token', 'token-200-null-body', 'fetch');
    return { body: null, rejection: rejection.message };
  });

  await runCase(report, 'oauth', 'token transport failure: TypeError(fetch failed) with a cause', async function() {
    var token = await underProfile('oauth:token-transport-failure', function() {
      return expectRejection(exchangeToken(), 'the token exchange');
    });

    expectEqual(token.value.constructor.name, 'TypeError', 'the rejection type');
    expectEqual(token.value.message, 'fetch failed', 'the rejection message');
    expectEqual(token.value.cause.code, 'ECONNREFUSED',
      'the cause must be the Error the replaced library reported directly - the controller unwraps it');
    expectEqual(token.value.cause.syscall, 'connect', 'the cause syscall');
    expectOneCall(token, 'token', 'token-transport-failure', 'fetch');
    return { code: token.value.cause.code };
  });

  await runCase(report, 'oauth', 'profile 200 with no email', async function() {
    var profile = await underProfile('oauth:profile-missing-email', fetchProfile);
    expectEqual(profile.value.status, 200, 'the profile status');
    expectEqual(profile.value.body.email, undefined, 'the missing email');
    expectEqual(profile.value.body.id, GOOGLE_ID_EXISTING, 'the rest of the profile survives');
    expectOneCall(profile, 'userinfo', 'userinfo-200-missing-email', 'fetch');
    return { status: 200 };
  });

  await runCase(report, 'oauth', 'profile 200 whose body parses to null: the SECOND guard refuses it', async function() {
    var profile = await underProfile('oauth:profile-non-object-body', fetchProfile);
    expectEqual(profile.value.status, 200, 'the profile status');
    expectEqual(profile.value.body, null, 'a body of `null` must arrive as null');

    // The guard the controller runs, in the shape
    // lib/controllers/auth.js:441 delivers it in:
    //   if (err || !profile || !profile.email) return reject(err || new Error(...));
    //
    // This is the FIRST half of that test, and it is the half
    // `oauth:profile-missing-email` cannot reach: that profile delivers an
    // object, so it falls through to `!profile.email`. Both land on the same
    // generic authentication failure, which is why each needs its own profile
    // to be evidence of anything.
    var threw = null;
    var rejection = null;
    try {
      var body = profile.value.body;
      if (!body || !body.email) {
        rejection = new Error('Failed to get user profile');
      }
    }
    catch (error) {
      threw = error;
    }

    expect(!threw, 'the guard must not throw on a null profile, and threw ' +
      (threw ? threw.constructor.name + ': ' + threw.message : ''));
    expect(rejection, 'the guard must refuse the body rather than pass it on');
    expectEqual(rejection.message, 'Failed to get user profile',
      'the message logged as `Google OAuth error:` and reported as the generic failure');
    expectOneCall(profile, 'userinfo', 'userinfo-200-null-body', 'fetch');
    return { body: null, rejection: rejection.message };
  });

  await runCase(report, 'oauth', 'profile transport failure', async function() {
    var profile = await underProfile('oauth:profile-transport-failure', function() {
      return expectRejection(fetchProfile(), 'the profile fetch');
    });

    expectEqual(profile.value.cause.code, 'ECONNREFUSED', 'the cause code');
    expectEqual(profile.value.cause.hostname, 'www.googleapis.com', 'the host named in the cause');
    expectOneCall(profile, 'userinfo', 'userinfo-transport-failure', 'fetch');
    return { code: profile.value.cause.code };
  });

  await runCase(report, 'oauth', 'the token exchange under `oauth:profile-*` still succeeds', async function() {
    // The layering the catalogue promises: a profile that speaks only about the
    // userinfo endpoint still serves the recorded token response, so the chain
    // reaches the branch the profile is about instead of failing earlier.
    var token = await underProfile('oauth:profile-missing-email', exchangeToken);
    expectEqual(token.value.body.access_token, ACCESS_TOKEN, 'the layered token response');
    expectOneCall(token, 'token', 'token-200-success', 'fetch');
    return { layered: true };
  });
}

// ---------------------------------------------------------------------------
// Group: the streaming asset fetch. Every mode: the complete response, a
// non-2xx, a 500, a followed redirect, both redirect-limit chains, every
// redirect mode, a mid-stream cut and a refused connection.
//
// The consumer is replicated from lib/controllers/users.js: content-type off
// the response headers, and the body read through the same web-stream path.
// ---------------------------------------------------------------------------
async function assetCases(report) {
  // What the call site does with a response: read the content type, then drain
  // the body. Errors during the drain are returned rather than thrown, because
  // for two of these modes the drain failing IS the outcome.
  async function drain(response) {
    var contentType = response.headers.get('content-type');
    var chunks = [];
    var failure = null;

    try {
      var reader = response.body.getReader();
      for (;;) {
        var step = await reader.read();
        if (step.done) {
          break;
        }
        chunks.push(Buffer.from(step.value));
      }
    }
    catch (error) {
      failure = error;
    }

    return {
      status      : response.status,
      contentType : contentType,
      bytes       : Buffer.concat(chunks),
      failure     : failure
    };
  }

  await runCase(report, 'asset', 'success: the exact bytes, and therefore the exact stored key', async function() {
    var result = await underProfile('asset:success', function() { return fetch(ASSET_URLS.plain); });
    var body = await drain(result.value);
    expectEqual(body.status, 200, 'the status');
    expectEqual(body.contentType, 'image/gif', 'the content type the upload will store');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.complete,
      'the sha1 of the delivered bytes IS the S3 object key lib/util/file.js derives, so it is ' +
      'compared rather than the length');
    expect(!body.failure, 'the drain must not fail');
    expectOneCall(result, 'asset', 'asset-200-complete', 'fetch');
    return { digest: sha1(body.bytes) };
  });

  await runCase(report, 'asset', 'the query-bearing URL is served identically', async function() {
    var result = await underProfile('asset:success', function() { return fetch(ASSET_URLS.query); });
    var body = await drain(result.value);
    expectEqual(sha1(body.bytes), module.exports.assetDigests.complete, 'the delivered digest');
    expectOneCall(result, 'asset', 'asset-200-complete', 'fetch');

    // The query survives into the stored filename, which is why the corpus
    // drives this URL: path.basename over a legacy `path` that retains '?v=2'.
    expect(ASSET_URLS.query.indexOf('?v=2') !== -1, 'the query must be part of the URL under test');
    return { url: ASSET_URLS.query };
  });

  await runCase(report, 'asset', '404: not a transport error, so the error page is uploaded', async function() {
    var result = await underProfile('asset:non-2xx', function() { return fetch(ASSET_URLS.missing); });
    var body = await drain(result.value);
    expectEqual(body.status, 404, 'the status');
    expectEqual(body.contentType, 'text/html; charset=UTF-8', 'the content type the upload will store');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.errorPage, 'the delivered digest');
    expect(!body.failure, 'a non-2xx must still complete: the bytes really are uploaded');
    expectOneCall(result, 'asset', 'asset-404-uploaded', 'fetch');
    return { status: 404, digest: sha1(body.bytes) };
  });

  await runCase(report, 'asset', '500: a distinct status and distinct stored bytes from the 404', async function() {
    var result = await underProfile('asset:server-error', function() { return fetch(ASSET_URLS.serverError); });
    var body = await drain(result.value);
    expectEqual(body.status, 500, 'the status');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.serverError, 'the delivered digest');
    expect(sha1(body.bytes) !== module.exports.assetDigests.errorPage,
      'the 500 must store different bytes from the 404, or one record could not evidence both');
    expect(!body.failure, 'a 5xx must still complete, exactly as the 404 does');
    expectOneCall(result, 'asset', 'asset-500-uploaded', 'fetch');
    return { status: 500, digest: sha1(body.bytes) };
  });

  await runCase(report, 'asset', 'redirect, followed: only the FINAL response is observable', async function() {
    // Driven from the chain's ENTRY point, which is the URL a caller supplies.
    // The destination is a different URL, and requesting IT directly serves the
    // final response with no hop - which is what makes a hop-counting walk
    // terminate instead of circling the chain (asserted below).
    var result = await underProfile('asset:redirect', function() { return fetch(ASSET_URLS.plain); });
    var body = await drain(result.value);
    expectEqual(body.status, 200, 'the final status');
    expectEqual(body.contentType, 'image/png', 'the FINAL response content type, never the 302\'s');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.redirected,
      'the final bytes - which is how "the consumer observed the final response" is provable');
    expectEqual(result.value.redirected, true, 'the response is marked as redirected');
    expectOneCall(result, 'asset', 'asset-302-followed', 'fetch');
    return { digest: sha1(body.bytes) };
  });

  await runCase(report, 'asset', 'redirect, manual: the 3xx itself, with its Location', async function() {
    var result = await underProfile('asset:redirect', function() {
      return fetch(ASSET_URLS.plain, { redirect: 'manual' });
    });

    expectEqual(result.value.status, 302, 'the status a manual caller receives');
    expectEqual(result.value.headers.get('location'), ASSET_URLS.redirect, 'the Location header');
    var call = expectOneCall(result, 'asset', 'asset-302-followed', 'fetch');
    expectEqual(call.request.redirect, 'manual', 'the recorded redirect mode');
    return { status: 302 };
  });

  await runCase(report, 'asset', 'redirect, error mode: the promise rejects', async function() {
    var result = await underProfile('asset:redirect', function() {
      return expectRejection(fetch(ASSET_URLS.plain, { redirect: 'error' }), 'redirect mode error');
    });

    expectEqual(result.value.constructor.name, 'TypeError', 'the rejection type');
    expectEqual(result.value.cause.code, 'PARITY_REDIRECT_MODE', 'the cause code');
    return { code: result.value.cause.code };
  });

  await runCase(report, 'asset', 'requesting the destination directly serves the final response', async function() {
    var result = await underProfile('asset:redirect', function() {
      return fetch(ASSET_URLS.redirect, { redirect: 'manual' });
    });

    expectEqual(result.value.status, 200,
      'the chain\'s destination is not itself a hop, or a caller counting hops would be ' +
      'redirected round the chain again and never terminate');
    expectEqual(sha1(Buffer.from(await result.value.arrayBuffer())), module.exports.assetDigests.redirected,
      'the destination bytes');
    return { status: 200 };
  });

  await runCase(report, 'asset', 'a 10-hop chain is inside both limits and still arrives', async function() {
    var result = await underProfile('asset:redirect-within-limit', function() {
      return fetch(ASSET_URLS.plain);
    });

    var body = await drain(result.value);
    expectEqual(body.status, 200, 'the final status');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.redirected, 'the final bytes');
    expectEqual(ASSET_HOPS_WITHIN_LEGACY_LIMIT, LEGACY_MAX_REDIRECTS,
      'the within-limit chain must be exactly at the legacy limit to be a boundary case');
    return { hops: ASSET_HOPS_WITHIN_LEGACY_LIMIT };
  });

  await runCase(report, 'asset', 'a manual hop-walk terminates at the destination', async function() {
    // What a caller enforcing its OWN redirect limit does: one request per hop
    // with redirect:'manual', counting as it goes. It is the only shape a limit
    // below the runtime's can be implemented in, and the fixture has to serve
    // it hop by hop for that to be testable at all.
    var mark = state.calls.length;
    setProfile('asset:redirect-within-limit');

    var target = ASSET_URLS.plain;
    var hops = 0;
    var final = null;

    while (hops <= LEGACY_MAX_REDIRECTS + 1) {
      var response = await fetch(target, { redirect: 'manual' });
      if (response.status < 300 || response.status > 399) {
        final = response;
        break;
      }
      hops++;
      target = response.headers.get('location');
      expect(target, 'every hop must carry a Location header');
    }

    expect(final, 'the walk must reach a non-redirect response');
    expectEqual(hops, ASSET_HOPS_WITHIN_LEGACY_LIMIT, 'the number of hops walked');
    expectEqual(final.status, 200, 'the destination status');
    expectEqual(sha1(Buffer.from(await final.arrayBuffer())), module.exports.assetDigests.redirected,
      'the destination bytes');
    expectEqual(callsSince(mark).length, ASSET_HOPS_WITHIN_LEGACY_LIMIT + 1,
      'one intercepted call per hop plus the destination');
    return { hops: hops };
  });

  await runCase(report, 'asset', 'an 11-hop chain is where the two mechanisms disagree', async function() {
    // Inside fetch's limit of 20, so following it succeeds - and outside the
    // replaced library's 10, which the request-mechanism group asserts on the
    // other side. Serving both is what makes a claim about which limit the call
    // site now enforces checkable rather than asserted in a comment.
    var result = await underProfile('asset:redirect-beyond-limit', function() {
      return fetch(ASSET_URLS.plain);
    });

    var body = await drain(result.value);
    expectEqual(body.status, 200, 'fetch follows 11 hops, being inside its own limit of ' + FETCH_MAX_REDIRECTS);
    expect(ASSET_HOPS_BEYOND_LEGACY_LIMIT > LEGACY_MAX_REDIRECTS,
      'the chain must exceed the legacy limit to be the boundary case');
    expect(ASSET_HOPS_BEYOND_LEGACY_LIMIT <= FETCH_MAX_REDIRECTS,
      'and must stay inside the runtime limit');
    return { hops: ASSET_HOPS_BEYOND_LEGACY_LIMIT, followedBy: 'fetch' };
  });

  await runCase(report, 'asset', 'refused: rejects, and NOTHING is delivered', async function() {
    var result = await underProfile('asset:transport-refused', function() {
      return expectRejection(fetch(ASSET_URLS.plain), 'the refused asset');
    });

    expectEqual(result.value.message, 'fetch failed', 'the rejection message');
    expectEqual(result.value.cause.code, 'ECONNREFUSED', 'the cause code');
    expectOneCall(result, 'asset', 'asset-transport-refused', 'fetch');

    // The preserved consequence: no response means the upload never
    // starts and the route is left UNSETTLED. Nothing here may synthesize a
    // completion.
    return { code: result.value.cause.code, consequence: 'route left unsettled' };
  });

  await runCase(report, 'asset', 'mid-stream: the partial bytes arrive, THEN the failure', async function() {
    var result = await underProfile('asset:midstream-failure', function() { return fetch(ASSET_URLS.plain); });
    var body = await drain(result.value);

    expectEqual(body.status, 200, 'the status - the response itself succeeded');
    expectEqual(body.contentType, 'image/gif', 'the content type');
    expectEqual(sha1(body.bytes), module.exports.assetDigests.partial,
      'the PARTIAL bytes, which is what the upload stores');
    expect(body.failure, 'the drain must fail after the partial bytes');
    expectEqual(body.failure.code, 'ECONNRESET', 'the failure code');
    expect(body.bytes.length < ASSET_GIF.length, 'the partial content must be shorter than the whole');
    expectOneCall(result, 'asset', 'asset-midstream-failure', 'fetch');
    return { bytes: body.bytes.length, digest: sha1(body.bytes) };
  });
}

// ---------------------------------------------------------------------------
// Group: the request-contract oracle itself.
//
// Without the oracle a drifted encoding is served a recorded success, the
// corpus stays identical and the drift is invisible. Each case here breaches
// one clause and asserts the call is REFUSED; the last asserts that a
// conforming call is not.
// ---------------------------------------------------------------------------
async function contractCases(report, context) {
  async function expectRefusal(url, init, expected) {
    var before = state.contractViolations.length;
    var error = await expectRejection(fetch(url, init), expected);
    context.deliberateBreaches++;

    expectEqual(error.cause.code, 'PARITY_CONTRACT',
      'a contract breach must be refused with PARITY_CONTRACT, and produced ' +
      (error.cause && error.cause.code));
    expectEqual(state.contractViolations.length, before + 1, 'one violation recorded');

    var recorded = state.contractViolations[state.contractViolations.length - 1];
    expect(recorded.violations.join(' ').indexOf(expected) !== -1,
      'the violation must name ' + JSON.stringify(expected) + ', and says: ' +
      recorded.violations.join(' | '));

    return recorded;
  }

  await runCase(report, 'contract', 'a wrong method is refused', async function() {
    setProfile('default');
    var recorded = await expectRefusal(ENDPOINT_URLS.token,
      Object.assign(tokenRequestInit('c'), { method: 'GET' }), 'method must be POST');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a missing accept header is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    delete init.headers.accept;
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'header accept must be');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a followed token POST is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    init.redirect = 'follow';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'the redirect mode must be');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a "+"-encoded space in the token body is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    // What URLSearchParams would produce and what qs never did: a space as '+'.
    init.body = 'code=a+b&client_id=x&grant_type=authorization_code';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'not RFC 3986 encoded');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a missing form field is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    init.body = 'client_id=x&grant_type=authorization_code';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'must carry the field "code"');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a wrong grant_type is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    init.body = 'code=a&client_id=x&grant_type=refresh_token';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'must be "authorization_code"');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a profile fetch with no bearer scheme is refused', async function() {
    setProfile('default');
    var recorded = await expectRefusal(ENDPOINT_URLS.userinfo, {
      method  : 'GET',
      headers : { Authorization: ACCESS_TOKEN, 'accept': 'application/json' }
    }, 'must start with "Bearer "');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a siteverify call with no secret is refused', async function() {
    setProfile('default');
    var recorded = await expectRefusal(ENDPOINT_URLS.recaptcha, {
      method  : 'POST',
      headers : { 'content-type': 'application/x-www-form-urlencoded' },
      body    : new URLSearchParams({ response: 'token-only' })
    }, 'must carry the field "secret"');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'an unexpected query string on a JSON endpoint is refused', async function() {
    setProfile('default');
    // Endpoint matching is on (origin, pathname), so a query the call site
    // never sends would otherwise be served the recorded response as though it
    // had not been sent - including a signed or credential-bearing one.
    var recorded = await expectRefusal(
      ENDPOINT_URLS.token + '?X-Amz-Credential=probe&sig=probe',
      tokenRequestInit('parity-authorization-code'),
      'called with no query string');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a token body missing client_secret or redirect_uri is refused', async function() {
    setProfile('default');
    var init = tokenRequestInit('c');
    // `formEncode` drops only an undefined value and node-config reads an unset
    // key as null, so both fields are always PRESENT on the wire, with an empty
    // value where the deployment leaves them unset. A body without them is a
    // changed body.
    init.body = 'code=a&client_id=x&grant_type=authorization_code';
    var recorded = await expectRefusal(ENDPOINT_URLS.token, init, 'must carry the field "client_secret"');
    expect(recorded.violations.join(' ').indexOf('"redirect_uri"') !== -1,
      'and the missing redirect_uri must be reported too, and the violations are: ' +
      recorded.violations.join(' | '));
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'an EMPTY bearer credential is refused', async function() {
    setProfile('default');
    var recorded = await expectRefusal(ENDPOINT_URLS.userinfo, {
      method  : 'GET',
      headers : { Authorization: 'Bearer ', 'accept': 'application/json' }
    }, 'EMPTY credential');
    return { violations: recorded.violations };
  });

  await runCase(report, 'contract', 'a conforming call is not refused, and leaves no violation', async function() {
    var before = state.contractViolations.length;
    var result = await underProfile('default', function() {
      return fetch(ENDPOINT_URLS.token, tokenRequestInit('parity-authorization-code'));
    });

    expectEqual(result.value.status, 200, 'a conforming token exchange must be served');
    expectEqual(state.contractViolations.length, before, 'no violation may be recorded');
    return { violations: 0 };
  });
}

// ---------------------------------------------------------------------------
// Group: the source pins.
//
// The two OAuth call shapes are replicated above because their controller
// cannot be driven from a preload. A replication is only an oracle while it
// still matches the call site, so the call sites' own source text is checked
// for the values this file pins. If one of these fails the call site changed:
// re-derive the shape from it, then re-run. That is a deliberate coupling - it
// is the whole reason the encoding is checkable at all - and it costs one
// readFileSync per case.
// ---------------------------------------------------------------------------
async function sourceCases(report, context) {
  function sourceOf(relative) {
    return fs.readFileSync(pathModule.join(context.appRoot, relative), 'utf8');
  }

  await runCase(report, 'sources', 'lib/util/recaptcha.js still sends the shape this fixture pins', async function() {
    var text = sourceOf('lib/util/recaptcha.js');
    expect(text.indexOf(ENDPOINT_URLS.recaptcha) !== -1,
      'the siteverify URL ' + ENDPOINT_URLS.recaptcha + ' must appear in the call site');
    expect(/method\s*:\s*["']POST["']/.test(text), 'the call must still be a POST');
    expect(text.indexOf('application/x-www-form-urlencoded') !== -1,
      'the form content type must still be set explicitly');
    // The body is built by the call site's own `formEncode`, NOT by a
    // search-params serializer, and that is a measured decision rather than a
    // style choice: `request`'s `form` option implied qs' RFC 3986 encoding and
    // qs' undefined/null conventions - an `undefined` value drops its field, a
    // `null` value keeps the field with an empty value - while a search-params
    // serializer sends the literal strings "undefined" and "null". Both
    // distinctions are live here, since an omitted g-recaptcha-response is
    // `undefined` and node-config reads an unset recaptcha key as `null`. So
    // this pin asserts the encoder that reproduces the baseline bytes is in use
    // AND that the serializer which does not has not come back.
    expect(/body\s*:\s*formEncode\(/.test(text),
      'the body must still be built by the call site\'s formEncode');
    expect(text.indexOf('URLSearchParams') === -1,
      'a search-params serializer must not be reintroduced: it sends "undefined" ' +
      'and "null" as literal values where qs dropped the field or emptied it');
    expect(/secret\s*:/.test(text) && /response\s*:/.test(text),
      'the body must still carry `secret` and `response`');
    return { pinned: 6 };
  });

  await runCase(report, 'sources', 'lib/controllers/auth.js still sends the shapes this fixture pins', async function() {
    var text = sourceOf('lib/controllers/auth.js');
    expect(text.indexOf(ENDPOINT_URLS.token) !== -1, 'the token endpoint must appear in the call site');
    expect(text.indexOf(ENDPOINT_URLS.userinfo) !== -1, 'the userinfo endpoint must appear in the call site');
    expect(/redirect\s*:\s*['"]manual['"]/.test(text),
      'the token exchange must still ask for redirect:\'manual\' - following it would downgrade the POST to GET');
    expect(text.indexOf('application/x-www-form-urlencoded') !== -1, 'the form content type must still be set');
    expect(text.indexOf('grant_type') !== -1, 'the grant_type field must still be sent');
    expect(text.indexOf("'Bearer '") !== -1 || text.indexOf('"Bearer "') !== -1,
      'the profile fetch must still send a Bearer authorization header');
    return { pinned: 6 };
  });

  await runCase(report, 'sources', 'lib/controllers/users.js still fetches the payload URL and reads its content type', async function() {
    var text = sourceOf('lib/controllers/users.js');
    // The call site hands `request.payload.url` to `fetchAssetResource`, which
    // follows redirects itself under a hop budget fetch's own follower cannot be
    // capped at, resolving each hop with `new URL(location, target)`. The URL
    // the handler itself parses goes through `parseLegacy` instead, because AAP
    // 0.4.2 requires this site's `url.parse` to keep `url.parse`'s partial-object
    // and throwing behaviour rather than `new URL`'s. So the pin is in two
    // parts: the target still comes from `request.payload.url`, and the request
    // still goes out through it.
    expect(/fetchAssetResource\(\s*request\.payload\.url/.test(text),
      'the asset upload must still take its target from request.payload.url');
    expect(/globalThis\.fetch\(\s*target\b/.test(text),
      'the fetch must still go to that target through globalThis.fetch, read at ' +
      'call time - a captured reference stops being interceptable and takes ' +
      'every parity scenario for this route with it');
    expect(text.indexOf("headers.get('content-type')") !== -1 ||
           text.indexOf('headers.get("content-type")') !== -1,
      'the stored content type must still come from the response headers');
    return { pinned: 3 };
  });
}

// ---------------------------------------------------------------------------
// Group: the `request` mechanism.
//
// The package is gone from the target manifest, so this mechanism is dormant
// here and live on the baseline worktree - which means it is the half of the
// fixture a target-tree run never touches, and the half a baseline capture
// depends on entirely. It is exercised against a synthetic application root
// carrying a TRIPWIRE `request` package: the fixture must replace its export
// and never call it, which is how "no path reaches the network" is proved for
// this mechanism rather than asserted.
// ---------------------------------------------------------------------------
async function requestMechanismCases(report, context) {
  var root = null;
  var patched = null;
  var previousRoot = process.env.PARITY_APP_ROOT;

  try {
    root = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'parity-http-selftest-'));
    fs.mkdirSync(pathModule.join(root, 'node_modules', 'request'), { recursive: true });
    fs.writeFileSync(pathModule.join(root, 'app.js'), '// synthetic application root\n');
    fs.writeFileSync(pathModule.join(root, 'package.json'), JSON.stringify({ name: 'parity-selftest-root', version: '0.0.0' }) + '\n');
    fs.writeFileSync(pathModule.join(root, 'node_modules', 'request', 'package.json'),
      JSON.stringify({ name: 'request', version: '2.88.2', main: 'index.js' }) + '\n');

    // The tripwire. Every entry point counts an invocation into the harness's
    // own counter, so an escape is a failed case rather than a silent socket.
    fs.writeFileSync(pathModule.join(root, 'node_modules', 'request', 'index.js'), [
      '// Synthetic `request` package, written by the http fixture self-test.',
      '// Every entry point is a tripwire: the fixture must replace this export',
      '// and must never invoke it.',
      'function tripwire() {',
      '  if (globalThis.__parityHttpTripwire) { globalThis.__parityHttpTripwire.requestCalls++; }',
      '  throw new Error("the genuine request export was invoked");',
      '}',
      "['get','post','put','patch','head','del','delete','options','defaults','forever','jar','cookie','initParams'].forEach(function(name) {",
      '  tripwire[name] = tripwire;',
      '});',
      'tripwire.Request = tripwire;',
      'tripwire.debug = false;',
      'module.exports = tripwire;',
      ''
    ].join('\n'));

    restore();
    process.env.PARITY_APP_ROOT = root;
    var installed = install();
    patched = require(require.resolve('request', { paths: [root] }));

    await runCase(report, 'request-mechanism', 'the mechanism activates and is reported as required', async function() {
      expectEqual(installed.mechanisms.request, true, 'the request mechanism must be patched');
      expectEqual(installed.required.request, true,
        'a tree that provides the package makes the mechanism REQUIRED, so a failure to patch it is terminal');
      expectEqual(installed.installed, true, 'the fixture must report itself installed');
      expectEqual(installed.appRootVerified, true, 'the synthetic root must verify');
      expectEqual(patched.parityFixture, true, 'the export in the cache must be the replacement');
      return { mechanisms: installed.mechanisms };
    });

    // The callback form, bounded.
    function callbackForm(method, options) {
      return new Promise(function(resolve, reject) {
        var timer = setTimeout(function() { reject(new Error('the callback never fired within 5000ms')); }, 5000);
        patched[method](options, function(err, response, body) {
          clearTimeout(timer);
          resolve({ err: err, response: response, body: body });
        });
      });
    }

    await runCase(report, 'request-mechanism', 'reCAPTCHA without `json` delivers response.body as a STRING', async function() {
      var result = await underProfile('recaptcha:success', function() {
        return callbackForm('post', { url: ENDPOINT_URLS.recaptcha, form: { secret: 's', response: 'r' } });
      });

      expectEqual(result.value.err, null, 'no transport error');
      expectEqual(typeof result.value.response.body, 'string',
        'lib/util/recaptcha.js parses response.body itself, so a parsed object here would change the outcome');
      expectEqual(result.value.response.body, result.value.body, 'both must be the same value');
      expectEqual(JSON.parse(result.value.response.body).success, true, 'and it must parse');
      expectOneCall(result, 'recaptcha', 'recaptcha-200-success', 'request');
      return { type: typeof result.value.response.body };
    });

    await runCase(report, 'request-mechanism', 'reCAPTCHA with `json: true` is refused as a contract breach', async function() {
      var before = state.contractViolations.length;
      var result = await underProfile('recaptcha:success', function() {
        return callbackForm('post', { url: ENDPOINT_URLS.recaptcha, form: { secret: 's', response: 'r' }, json: true });
      });

      expect(result.value.err, 'the call must fail');
      expectEqual(result.value.err.code, 'PARITY_CONTRACT', 'the refusal code');
      expectEqual(state.contractViolations.length, before + 1, 'one violation recorded');
      context.deliberateBreaches++;
      return { code: result.value.err.code };
    });

    await runCase(report, 'request-mechanism', 'reCAPTCHA transport failure delivers (err, undefined, undefined)', async function() {
      var result = await underProfile('recaptcha:transport-failure', function() {
        return callbackForm('post', { url: ENDPOINT_URLS.recaptcha, form: { secret: 's', response: 'r' } });
      });

      expectEqual(result.value.response, undefined,
        'response must be undefined - that is what makes reading response.statusCode throw');
      expectEqual(result.value.body, undefined, 'body must be undefined');
      expectEqual(result.value.err.code, 'ECONNREFUSED', 'the error code');
      expectOneCall(result, 'recaptcha', 'recaptcha-transport-failure', 'request');
      return { code: result.value.err.code };
    });

    await runCase(report, 'request-mechanism', 'the token exchange with `json: true` delivers the PARSED body', async function() {
      var result = await underProfile('oauth:success-existing-user', function() {
        return callbackForm('post', {
          url  : ENDPOINT_URLS.token,
          form : { code: 'c', client_id: 'id', client_secret: 's', redirect_uri: 'u', grant_type: 'authorization_code' },
          json : true
        });
      });

      expectEqual(result.value.err, null, 'no transport error');
      expectEqual(typeof result.value.body, 'object', 'the body must be parsed under json:true');
      expectEqual(result.value.body.access_token, ACCESS_TOKEN, 'the frozen access token');
      expectEqual(result.value.response.body, result.value.body,
        'response.body and the body argument are the same value under json:true (measured)');
      var call = expectOneCall(result, 'token', 'token-200-success', 'request');
      expectEqual(call.request.bodyEncoding, 'form', 'the recorded encoding');
      expectEqual(call.request.bodyValues.client_secret, REDACTED, 'the client secret must be redacted');
      return { fields: call.request.bodyFields };
    });

    await runCase(report, 'request-mechanism', 'the profile fetch with `json: true` and a Bearer header', async function() {
      var result = await underProfile('oauth:success-existing-user', function() {
        return callbackForm('get', {
          url     : ENDPOINT_URLS.userinfo,
          headers : { Authorization: 'Bearer ' + ACCESS_TOKEN, 'accept': 'application/json' },
          json    : true
        });
      });

      expectEqual(result.value.body.email, identities.existing, 'the seeded identity');
      expectOneCall(result, 'userinfo', 'userinfo-200-existing-user', 'request');
      return { email: result.value.body.email };
    });

    // The stream form, bounded, recording the event sequence - which is the
    // observable the asset call site branches on.
    function streamForm(url, waitMs) {
      return new Promise(function(resolve) {
        var events = [];
        var chunks = [];
        var stream = patched.get(url);

        stream.on('error', function(err) { events.push('error:' + (err.code || err.message)); });
        stream.on('response', function(response) { events.push('response:' + response.statusCode); });
        stream.on('redirect', function() { events.push('redirect:' + (stream.response && stream.response.statusCode)); });
        stream.on('data', function(chunk) { chunks.push(chunk); events.push('data'); });
        stream.on('end', function() { events.push('end'); });

        setTimeout(function() {
          resolve({ events: events, bytes: Buffer.concat(chunks), stream: stream });
        }, waitMs === undefined ? 200 : waitMs);
      });
    }

    await runCase(report, 'request-mechanism', 'the asset stream: response, data, end', async function() {
      var result = await underProfile('asset:success', function() { return streamForm(ASSET_URLS.plain); });
      expectEqual(result.value.events.join(','), 'response:200,data,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.complete, 'the delivered digest');
      expectOneCall(result, 'asset', 'asset-200-complete', 'request');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a 404 still reaches end, so the error page is uploaded', async function() {
      var result = await underProfile('asset:non-2xx', function() { return streamForm(ASSET_URLS.missing); });
      expectEqual(result.value.events.join(','), 'response:404,data,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.errorPage, 'the delivered digest');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a 500 behaves as the 404 does, with its own bytes', async function() {
      var result = await underProfile('asset:server-error', function() { return streamForm(ASSET_URLS.serverError); });
      expectEqual(result.value.events.join(','), 'response:500,data,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.serverError, 'the delivered digest');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a refused connection emits error and NEVER end', async function() {
      var result = await underProfile('asset:transport-refused', function() { return streamForm(ASSET_URLS.plain, 300); });
      expectEqual(result.value.events.join(','), 'error:ECONNREFUSED', 'the event sequence');
      expectEqual(result.value.events.indexOf('end'), -1,
        'no `end` may be synthesized: the upload never starts and the route is left unsettled (R-d)');
      expectEqual(result.value.bytes.length, 0, 'no bytes may be delivered');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a mid-stream failure delivers partial bytes, then error, THEN end', async function() {
      var result = await underProfile('asset:midstream-failure', function() { return streamForm(ASSET_URLS.plain, 300); });
      expectEqual(result.value.events.join(','), 'response:200,data,error:ECONNRESET,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.partial, 'the partial digest');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a followed redirect announces each hop and delivers the final response', async function() {
      var result = await underProfile('asset:redirect', function() { return streamForm(ASSET_URLS.plain, 300); });
      expectEqual(result.value.events.join(','), 'redirect:302,response:200,data,end', 'the event sequence');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.redirected, 'the final digest');
      return { events: result.value.events };
    });

    await runCase(report, 'request-mechanism', 'a chain at the legacy limit still arrives', async function() {
      var result = await underProfile('asset:redirect-within-limit', function() { return streamForm(ASSET_URLS.plain, 300); });
      var redirects = result.value.events.filter(function(name) { return name.indexOf('redirect:') === 0; });
      expectEqual(redirects.length, LEGACY_MAX_REDIRECTS, 'one redirect event per hop');
      expect(result.value.events.indexOf('end') !== -1, 'the chain must complete');
      expectEqual(sha1(result.value.bytes), module.exports.assetDigests.redirected, 'the final digest');
      return { hops: redirects.length };
    });

    await runCase(report, 'request-mechanism', 'a chain beyond the legacy limit fails instead of arriving', async function() {
      var result = await underProfile('asset:redirect-beyond-limit', function() { return streamForm(ASSET_URLS.plain, 300); });
      expectEqual(result.value.events.join(','), 'error:PARITY_REDIRECT_LIMIT', 'the event sequence');
      expectEqual(result.value.events.indexOf('end'), -1, 'no completion');
      expectEqual(result.value.bytes.length, 0, 'no bytes');

      // The other side of the boundary: through native fetch the same chain is
      // followed, because 11 is inside the runtime's limit of 20. The two
      // mechanisms disagree here, deliberately, and both are served.
      return { hops: ASSET_HOPS_BEYOND_LEGACY_LIMIT, legacyLimit: LEGACY_MAX_REDIRECTS };
    });

    await runCase(report, 'request-mechanism', 'an unrecorded URL fails on both call forms', async function() {
      var stream = await underProfile('default', function() { return streamForm(UNRECORDED_URL, 200); });
      expectEqual(stream.value.events.join(','), 'error:PARITY_UNRECORDED', 'the stream form');

      var callback = await underProfile('default', function() {
        return callbackForm('post', { url: UNREGISTERED_ORIGIN_URL, form: { secret: 's', response: 'r' } });
      });
      expectEqual(callback.value.err.code, 'PARITY_UNRECORDED', 'the callback form');
      expectEqual(callback.value.response, undefined, 'no response');
      return { forms: 2 };
    });

    await runCase(report, 'request-mechanism', 'restore() puts the genuine export back', async function() {
      var before = require(require.resolve('request', { paths: [root] }));
      expectEqual(before.parityFixture, true, 'the replacement must be in force before restore');
      restore();
      var after = require(require.resolve('request', { paths: [root] }));
      expectEqual(after.parityFixture, undefined, 'the genuine export must be back');
      expectEqual(after.name, 'tripwire', 'and it must be the genuine export this tree provides');
      return { restored: true };
    });

    await runCase(report, 'request-mechanism', 'the tripwire never fired', async function() {
      expectEqual(context.tripwire.requestCalls, 0,
        'the genuine request export must never be invoked, and was invoked ' +
        context.tripwire.requestCalls + ' time(s)');
      return { requestCalls: 0 };
    });
  }
  finally {
    // Put this process back the way the harness found it, whatever happened:
    // the fixture reinstalled against the real app root, the synthetic tree
    // gone, and the environment variable restored.
    try { restore(); } catch (ignored) { /* reported by the cases above */ }

    if (previousRoot === undefined) {
      delete process.env.PARITY_APP_ROOT;
    }
    else {
      process.env.PARITY_APP_ROOT = previousRoot;
    }

    install();

    if (root) {
      try { fs.rmSync(root, { recursive: true, force: true }); }
      catch (ignored) { note('selftest-cleanup-failed', { root: root }); }
    }
  }
}

// ---------------------------------------------------------------------------
// Group: the cases that can only be asserted from outside the process.
//
// Four of them, and each is a claim about the process rather than a value: two
// reCAPTCHA short-circuits that need mutually exclusive configuration states,
// two guarded reCAPTCHA faults that must call back and then let the process
// exit normally, and an unprotected install that must terminate rather than
// serve.
// ---------------------------------------------------------------------------

// Spawns this file with one case selected, bounded, and never inheriting the
// parent's configuration: NODE_ENV and NODE_CONFIG are set explicitly, so a
// child's outcome is decided by its case and not by the shell that started the
// harness. NODE_CONFIG_PERSIST_ON_CHANGE stops node-config writing
// config/runtime.json into the worktree.
function spawnChild(context, caseName, overrides) {
  // Each child writes its own evidence log, and the parent folds it in. That is
  // what makes a child's intercepted call countable at all, and it is read
  // rather than returned: the per-call append survives a child that does not
  // get to report, which is what the two provider faults did on the baseline
  // worktree and what an unprotected install still does here.
  var logPath = pathModule.join(context.scratch,
    'child-' + caseName.replace(/[^a-z0-9]+/gi, '-') + '-' + (context.childIndex = (context.childIndex || 0) + 1) + '.log');

  var env = {
    PATH     : process.env.PATH,
    HOME     : process.env.HOME,
    NODE_ENV : 'development',
    NODE_CONFIG_PERSIST_ON_CHANGE : 'N',
    PARITY_HTTP_LOG : logPath,
    PARITY_APP_ROOT : (overrides && overrides.appRoot) || process.env.PARITY_APP_ROOT || process.cwd()
  };

  env[SELFTEST_CHILD_VAR] = caseName;

  Object.keys(overrides || {}).forEach(function(name) {
    if (name !== 'appRoot') {
      env[name] = overrides[name];
    }
  });

  var result = childProcess.spawnSync(process.execPath, [__filename], {
    cwd      : env.PARITY_APP_ROOT,
    env      : env,
    encoding : 'utf8',
    timeout  : 30000
  });

  var stdout = result.stdout || '';
  var parsed = null;

  stdout.split('\n').forEach(function(line) {
    if (line.indexOf(CHILD_RESULT_MARKER) === 0) {
      try { parsed = JSON.parse(line.slice(CHILD_RESULT_MARKER.length)); }
      catch (e) { parsed = null; }
    }
  });

  var records = [];
  try {
    fs.readFileSync(logPath, 'utf8').split('\n').forEach(function(line) {
      if (!line) {
        return;
      }
      try { records.push(JSON.parse(line)); }
      catch (e) { /* a truncated final line is not evidence of anything */ }
    });
  }
  catch (e) {
    // A child that intercepted nothing writes no file, which several of these
    // cases assert on rather than treat as a fault.
  }

  context.childRecords = (context.childRecords || []).concat(records);

  return {
    status     : result.status,
    signal     : result.signal,
    stdout     : stdout,
    stderr     : result.stderr || '',
    calledBack : stdout.indexOf(CHILD_CALLBACK_MARKER) !== -1,
    result     : parsed,
    records    : records,
    calls      : records.filter(function(entry) { return entry.event === undefined; }),
    spawnError : result.error ? (result.error.message || String(result.error)) : null
  };
}

async function childCases(report, context) {
  await runCase(report, 'recaptcha', 'outcome 1: the isTest short-circuit answers with NO HTTP at all', async function() {
    var child = spawnChild(context, 'recaptcha:short-circuit-istest', {
      NODE_CONFIG         : SELFTEST_SECRET_OVERLAY,
      PARITY_HTTP_PROFILE : 'recaptcha:non-200'
    });

    expect(!child.spawnError, 'the child must start: ' + child.spawnError);
    expectEqual(child.status, EXIT_OK, 'the child exit code (stderr: ' + child.stderr.trim() + ')');
    expect(child.result, 'the child must report a result, and printed: ' + child.stdout.trim());
    expectEqual(child.result.isTest, true,
      'config.isTest must have been set, or this case proves nothing');
    expectEqual(child.result.value.success, true, 'the short-circuit value');
    expectEqual(child.result.interceptedCalls, 0,
      'the short-circuit happens BEFORE any HTTP - and a secret WAS configured, so the ' +
      'unconfigured branch cannot be the cause');

    // The selected profile would have produced {status:false} had the call
    // reached the fixture, so the value proves which branch ran.
    expectEqual(child.result.value.status, undefined, 'the value must be the short-circuit shape');
    return { calls: 0, value: child.result.value };
  });

  await runCase(report, 'recaptcha', 'outcome 2: the unconfigured short-circuit shares that branch', async function() {
    var child = spawnChild(context, 'recaptcha:short-circuit-unconfigured', {
      PARITY_HTTP_PROFILE : 'recaptcha:non-200'
    });

    expect(!child.spawnError, 'the child must start: ' + child.spawnError);
    expectEqual(child.status, EXIT_OK, 'the child exit code (stderr: ' + child.stderr.trim() + ')');
    expect(child.result, 'the child must report a result, and printed: ' + child.stdout.trim());
    expect(!child.result.isTest, 'config.isTest must be falsy, or this is outcome 1 again');
    expectEqual(child.result.secretkey, '',
      'the secret must be unset, which is what selects this branch');
    expectEqual(child.result.value.success, true, 'the same value outcome 1 produces');
    expectEqual(child.result.interceptedCalls, 0, 'no HTTP may happen');
    return { calls: 0, value: child.result.value };
  });

  // Outcomes 5 and 6 are RE-POINTED at the delivered behaviour, and both are
  // still driven in a child rather than in-process.
  //
  // The assertion they used to make - exit 1, `cb` never invoked, TypeError or
  // SyntaxError on stderr - was baseline's, and lib/util/recaptcha.js now
  // guards both reads under the approved deviation at
  // docs/preserved-quirks.md 10.7: a fault the PROVIDER controls, reachable
  // from one unauthenticated POST /users, was ending the process and ending it
  // again on every restart while the condition lasted. Measured against a
  // running server, both faults now answer POST /users with 302 and leave the
  // process alive.
  //
  // The child is retained because what has to be asserted is still a
  // process-level claim, and it is now a stronger one than an exit code: the
  // callback FIRES, the value it carries is the fail-closed shape, and the
  // process reaches its own exit rather than being taken down by the
  // dereference. None of those three can be observed from inside the process
  // that would have died, and asserting only "exit 0" would pass on a child
  // that never called verify() at all.
  await runCase(report, 'recaptcha', 'outcome 5: a transport failure fails closed and the process survives', async function() {
    var child = spawnChild(context, 'recaptcha:verify', {
      NODE_CONFIG         : SELFTEST_SECRET_OVERLAY,
      PARITY_HTTP_PROFILE : 'recaptcha:transport-failure'
    });

    expect(!child.spawnError, 'the child must start: ' + child.spawnError);
    expectEqual(child.status, EXIT_OK,
      'the guarded fault must let the process exit normally (stderr: ' + child.stderr.trim() + ')');
    expect(child.calledBack,
      'the callback MUST be invoked - that is what the guard changed, and the child printed: ' +
      child.stdout.trim());
    expect(child.result, 'the child must report a result, and printed: ' + child.stdout.trim());
    expectEqual(JSON.stringify(child.result.value), '{"status":false}',
      'the value must be the fail-closed shape, which is the value outcome 4 already delivers');
    expectEqual(child.result.value.success, undefined,
      'and it must carry no `success`, so every caller reads it as a failed verification');
    expectEqual(child.result.noCallback, undefined,
      'the bounded-wait arm must not have fired: the callback is what settles this outcome now');

    // The fault really was the transport one, not a short-circuit: the child
    // had a secret configured and `isTest` false, and the fixture recorded the
    // intercepted call.
    expectEqual(child.result.interceptedCalls, 1, 'exactly one siteverify call must have been made');
    expect(child.calls.some(function(entry) {
      return entry.outcome === 'recaptcha-transport-failure';
    }), 'and it must have been served the transport failure, and the evidence carries: ' +
      JSON.stringify(child.calls.map(function(entry) { return entry.outcome; })));

    return { exit: child.status, value: child.result.value };
  });

  await runCase(report, 'recaptcha', 'outcome 6: a malformed body fails closed and the process survives', async function() {
    var child = spawnChild(context, 'recaptcha:verify', {
      NODE_CONFIG         : SELFTEST_SECRET_OVERLAY,
      PARITY_HTTP_PROFILE : 'recaptcha:malformed-json'
    });

    expect(!child.spawnError, 'the child must start: ' + child.spawnError);
    expectEqual(child.status, EXIT_OK,
      'the guarded parse failure must let the process exit normally (stderr: ' +
      child.stderr.trim() + ')');
    expect(child.calledBack, 'the callback MUST be invoked, and the child printed: ' + child.stdout.trim());
    expect(child.result, 'the child must report a result');
    expectEqual(JSON.stringify(child.result.value), '{"status":false}',
      'the value must be the same fail-closed shape the transport failure delivers: both faults ' +
      'refuse the verification on the outcome a rejected challenge already produces');
    expectEqual(child.result.noCallback, undefined, 'the bounded-wait arm must not have fired');
    expectEqual(child.result.interceptedCalls, 1, 'exactly one siteverify call must have been made');
    expect(child.calls.some(function(entry) {
      return entry.outcome === 'recaptcha-200-malformed-json';
    }), 'and it must have been served the non-JSON body, and the evidence carries: ' +
      JSON.stringify(child.calls.map(function(entry) { return entry.outcome; })));

    return { exit: child.status, value: child.result.value };
  });

  await runCase(report, 'install', 'a mechanism that cannot be intercepted terminates the process', async function() {
    // The escape this guards: the package resolves, so the application can
    // require it and reach a socket, but patching it failed. A diagnostic in a
    // log would leave the child serving real traffic, so it is terminal.
    var root = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'parity-http-unprotected-'));

    try {
      fs.mkdirSync(pathModule.join(root, 'node_modules', 'request'), { recursive: true });
      fs.writeFileSync(pathModule.join(root, 'app.js'), '// synthetic application root\n');
      fs.writeFileSync(pathModule.join(root, 'package.json'),
        JSON.stringify({ name: 'parity-selftest-unprotected', version: '0.0.0' }) + '\n');
      fs.writeFileSync(pathModule.join(root, 'node_modules', 'request', 'package.json'),
        JSON.stringify({ name: 'request', version: '2.88.2', main: 'index.js' }) + '\n');
      // Resolvable and un-patchable: loading it throws, so the fixture cannot
      // reach its exports to replace them.
      fs.writeFileSync(pathModule.join(root, 'node_modules', 'request', 'index.js'),
        'throw new Error("this request package cannot be loaded");\n');

      var statusFile = pathModule.join(root, 'handshake.json');
      var child = spawnChild(context, 'status', {
        appRoot            : root,
        PARITY_HTTP_STATUS : statusFile
      });

      expectEqual(child.status, EXIT_UNPROTECTED,
        'an unprotected install must exit ' + EXIT_UNPROTECTED + ' rather than serve (stdout: ' +
        child.stdout.trim() + ', stderr: ' + child.stderr.trim() + ')');
      expectEqual(child.stdout, '', 'nothing may be printed: stdout belongs to the zero-warning gate');
      expectEqual(child.stderr, '', 'and nothing may reach stderr either');

      var handshake = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      expectEqual(handshake.installed, false, 'the handshake must say the fixture is NOT installed');
      expectEqual(handshake.required.request, true, 'and that the request mechanism was required');
      expectEqual(handshake.mechanisms.request, false, 'and that it is inactive');
      expect(handshake.diagnostic && handshake.diagnostic.indexOf('could not be patched') !== -1,
        'the handshake must carry the reason, and carries: ' + handshake.diagnostic);
      return { exit: child.status, handshake: 'published' };
    }
    finally {
      try { fs.rmSync(root, { recursive: true, force: true }); }
      catch (ignored) { note('selftest-cleanup-failed', { root: root }); }
    }
  });

  await runCase(report, 'install', 'a declared app root that does not hold the application terminates the process', async function() {
    // `request` is resolved against PARITY_APP_ROOT, so a wrong root silently
    // decides which mechanisms exist: a baseline capture could run with the
    // legacy mechanism absent and report a parity it never exercised. An
    // explicit wrong claim is therefore terminal, exactly as an
    // un-interceptable mechanism is.
    var root = fs.mkdtempSync(pathModule.join(os.tmpdir(), 'parity-http-badroot-'));

    try {
      var statusFile = pathModule.join(root, 'handshake.json');
      var child = spawnChild(context, 'status', {
        appRoot            : root,          // empty: no app.js, no package.json
        PARITY_HTTP_STATUS : statusFile
      });

      expectEqual(child.status, EXIT_UNPROTECTED,
        'a declared app root that does not verify must exit ' + EXIT_UNPROTECTED +
        ' (stdout: ' + child.stdout.trim() + ', stderr: ' + child.stderr.trim() + ')');
      expectEqual(child.stdout, '', 'nothing may be printed');

      var handshake = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      expectEqual(handshake.appRootVerified, false, 'the handshake must say the root did not verify');
      expectEqual(handshake.installed, false, 'and that the fixture is not installed');
      expect(handshake.appRootMissing.indexOf('app.js') !== -1,
        'and name what was missing, and names: ' + JSON.stringify(handshake.appRootMissing));
      return { exit: child.status };
    }
    finally {
      try { fs.rmSync(root, { recursive: true, force: true }); }
      catch (ignored) { note('selftest-cleanup-failed', { root: root }); }
    }
  });

  await runCase(report, 'install', 'the handshake identifies the implementation and the tree', async function() {
    var statusFile = pathModule.join(context.scratch, 'handshake.json');
    var child = spawnChild(context, 'status', { PARITY_HTTP_STATUS: statusFile });

    expectEqual(child.status, EXIT_OK, 'the child exit code (stderr: ' + child.stderr.trim() + ')');
    var handshake = JSON.parse(fs.readFileSync(statusFile, 'utf8'));

    expectEqual(handshake.schema, 'parity-http-fixture-status/1', 'the handshake schema');
    expectEqual(handshake.installed, true, 'the fixture must report itself installed');
    expectEqual(handshake.mechanisms.fetch, true, 'fetch must be active');
    expectEqual(handshake.appRootVerified, true, 'the app root must verify');
    expectEqual(handshake.identity.module, __filename, 'the handshake must name this implementation');
    expectEqual(handshake.identity.digest, fixtureDigest,
      'and carry its digest, so a run can prove ONE implementation was loaded in both worktrees');
    expectEqual(handshake.identity.identityOk, true,
      'the identity contract must hold in a process that loaded this file fresh');
    return { digest: handshake.identity.digest };
  });
}

// ---------------------------------------------------------------------------
// The child entry point. Runs exactly one case and reports through markers on
// stdout, because two of the cases end in a fatal throw and a return value
// would never arrive.
// ---------------------------------------------------------------------------
function runChildCase(name) {
  var appRoot = process.env.PARITY_APP_ROOT || process.cwd();

  // The handshake case. The module auto-installed before this ran, so there is
  // nothing to do but report - and an unprotected install has already exited.
  if (name === 'status') {
    process.stdout.write(CHILD_RESULT_MARKER + JSON.stringify(status()) + '\n');
    return;
  }

  var config = require(require.resolve('config', { paths: [appRoot] }));

  if (name === 'recaptcha:short-circuit-istest') {
    // The assignment config/app.config.js itself makes, reproduced without
    // requiring app.config - which would load config/db and mongoose, and with
    // it the prototype patch that makes @hapi/hapi unloadable.
    config.isTest = true;
  }

  var verify = require(pathModule.join(appRoot, 'lib', 'util', 'recaptcha.js')).verify;
  var settled = false;

  function interceptedCalls() {
    return state.calls.filter(function(entry) { return entry.event === undefined; }).length;
  }

  verify('parity-selftest-token', function(result) {
    settled = true;
    process.stdout.write(CHILD_CALLBACK_MARKER + JSON.stringify(result) + '\n');
    process.stdout.write(CHILD_RESULT_MARKER + JSON.stringify({
      value            : result,
      isTest           : !!config.isTest,
      secretkey        : (config.app.recaptcha && config.app.recaptcha.secretkey) || '',
      interceptedCalls : interceptedCalls()
    }) + '\n');
  });

  // A bounded wait, so a child that is never called back exits rather than
  // hanging the harness. It is retained now that every outcome calls back,
  // because it is the arm that tells "verify() answered" apart from "verify()
  // did not": outcomes 5 and 6 assert that `noCallback` is ABSENT from what
  // this child reports, which they could not do if the child simply timed out
  // silently.
  setTimeout(function() {
    if (!settled) {
      process.stdout.write(CHILD_RESULT_MARKER + JSON.stringify({
        value            : null,
        noCallback       : true,
        isTest           : !!config.isTest,
        interceptedCalls : interceptedCalls()
      }) + '\n');
    }
  }, 3000);
}

// ---------------------------------------------------------------------------
// The run.
// ---------------------------------------------------------------------------

// Drives every group and reports. Returns the report rather than exiting, so a
// sibling tool can call it and fold the result into its own gate.
async function selfTest(options) {
  var opts = options || {};
  var report = {
    schema  : 'parity-http-fixture-selftest/1',
    module  : __filename,
    digest  : fixtureDigest,
    node    : process.version,
    appRoot : process.env.PARITY_APP_ROOT || process.cwd(),
    passed  : 0,
    failed  : 0,
    cases   : [],
    profilesDeclared   : Object.keys(PROFILES).length,
    profilesConsumed   : [],
    profilesUnconsumed : [],
    contract  : null,
    // Every violation a self-test run records is a breach the contract group
    // drove deliberately, one per case, and the count is asserted.
    contractViolationsDeliberate : 0,
    handshake : null,
    ok        : false
  };

  // ------------------------------------------------------------------------
  // The caller's state, snapshotted so it can be put back byte for byte.
  //
  // selfTest() is exported for a sibling tool to call in its own process, so
  // it may not leave that process altered. Ownership of the genuine fetch is
  // reclaimed FIRST, through restore(): snapshotting `globalThis.fetch` after
  // the load-time auto-install would capture the fixture's own replacement as
  // though it were the genuine function, and a caller would be left with the
  // patch installed, `installed` false, the deliberate contract violations
  // retained and a fabricated NODE_CONFIG still in the environment. Every
  // mutated key is recorded with its presence as well as its value.
  // ------------------------------------------------------------------------
  var callerState = {
    installed : state.installed,
    profile   : state.activeProfile,
    calls     : state.calls.slice(),
    violations: state.contractViolations.slice(),
    served    : Object.assign({}, state.served),
    fileState : state.profileFileState,
    handshake : state.handshake,
    diagnostic: state.resolveDiagnostic,
    env       : {}
  };

  ['NODE_CONFIG', 'NODE_CONFIG_PERSIST_ON_CHANGE'].forEach(function(name) {
    callerState.env[name] = Object.prototype.hasOwnProperty.call(process.env, name)
      ? { present: true, value: process.env[name] }
      : { present: false, value: null };
  });

  // restore() first, so the value captured next is the GENUINE fetch and not
  // this fixture's replacement.
  restore();
  var genuineFetch = globalThis.fetch;

  var startProfile = callerState.profile;
  var context = {
    appRoot        : report.appRoot,
    scratch        : fs.mkdtempSync(pathModule.join(os.tmpdir(), 'parity-http-report-')),
    // `fetchCalls` counts ESCAPES and is asserted at zero. `dataUrlDelegations`
    // is separate because the data: URL shape is a call the fixture is
    // SUPPOSED to hand back - see the tripwire below.
    tripwire       : { fetchCalls: 0, requestCalls: 0, dataUrlDelegations: 0 },
    recaptcha      : null,
    recaptchaError : null,
    // Every refusal the contract group drives ON PURPOSE. The count is what
    // lets the run assert that no driver which was supposed to CONFORM
    // produced a violation - the difference between an oracle that works and
    // one that fires at random.
    deliberateBreaches : 0
  };

  // The tripwire becomes the "original" the fixture retains, so an escape to
  // the real network is a counted, failing case rather than a socket.
  //
  // It has two arms, because the fixture has exactly one legitimate reason to
  // invoke the retained original: the `data:` URL shape, which the runtime
  // resolves out of the URL's own payload with no dispatcher and no socket. A
  // single-armed tripwire would leave that shape undrivable here - the case
  // would receive a rejected promise instead of the runtime's 200 - and the
  // alternative of moving the assertion to `fetchCalls <= 1` would stop the
  // counter meaning anything. So the delegable URLs are served from the
  // GENUINE fetch and counted separately, and `fetchCalls` still counts only
  // what it counted before: a call this fixture should never have made.
  globalThis.__parityHttpTripwire = context.tripwire;
  globalThis.fetch = function tripwireFetch(input, init) {
    if (isRegisteredDataUrl(urlFrom(input))) {
      context.tripwire.dataUrlDelegations++;
      return genuineFetch(input, init);
    }

    context.tripwire.fetchCalls++;
    return Promise.reject(new Error('the genuine fetch was invoked'));
  };
  install();

  // reCAPTCHA outcomes 3-6 are only reachable with a secret configured and
  // `config.isTest` falsy: without both, verify() short-circuits at its first
  // line and the four recorded responses are unreachable. Both are arranged
  // here, before the module is required, and both are put back afterwards.
  //
  // NODE_CONFIG_PERSIST_ON_CHANGE is set for a second reason: node-config
  // writes config/runtime.json into the worktree on change, and a verification
  // run must not touch the tree it is verifying.
  if (!process.env.NODE_CONFIG_PERSIST_ON_CHANGE) {
    process.env.NODE_CONFIG_PERSIST_ON_CHANGE = 'N';
  }
  if (!process.env.NODE_CONFIG) {
    process.env.NODE_CONFIG = SELFTEST_SECRET_OVERLAY;
  }

  try {
    context.config = require(require.resolve('config', { paths: [context.appRoot] }));

    if (!context.config.app.recaptcha) {
      context.config.app.recaptcha = {};
    }

    context.secretkeyAtStart = context.config.app.recaptcha.secretkey;
    if (!context.config.app.recaptcha.secretkey) {
      context.config.app.recaptcha.secretkey = 'parity-fixture-secret';
    }

    context.isTestAtStart = context.config.isTest;
    context.config.isTest = false;

    context.recaptcha = require(pathModule.join(context.appRoot, 'lib', 'util', 'recaptcha.js'));
  }
  catch (error) {
    context.recaptchaError = error && error.message ? error.message : String(error);
  }

  try {
    await identityCases(report);
    await sourceCases(report, context);
    await readinessCases(report);
    await registryCases(report, context);
    await recaptchaCases(report, context);
    await oauthCases(report);
    await assetCases(report);
    await contractCases(report, context);
    await requestMechanismCases(report, context);
    await childCases(report, context);

    // The coverage assertion. Declaring a profile and never selecting it is the
    // failure this harness exists to make impossible, so it is a case in its
    // own right rather than a statistic at the foot of a report.
    var consumed = {};

    // Counted ONLY from records the fixture wrote for a call it actually served
    // or refused - the `event`-free ones. Selecting a profile is not driving
    // it: crediting the `profile-changed` and `install` notes would report a
    // probe that selected a profile and issued no request as having exercised
    // it, which is the vacuous pass this harness exists to prevent.
    //
    // This process's evidence plus every child's: four outcomes can only be
    // driven in a child, and a child's evidence is read from the log it
    // appended to per call rather than from a value it returns - which is what
    // keeps the accounting correct for a child that does not get to report at
    // all, as an unprotected install does not.
    state.calls.concat(context.childRecords || []).forEach(function(entry) {
      if (entry.event === undefined && entry.profile) {
        consumed[entry.profile] = true;
      }
    });

    report.profilesConsumed = Object.keys(consumed).sort();
    report.profilesUnconsumed = Object.keys(PROFILES).filter(function(name) {
      return !consumed[name];
    }).sort();

    await runCase(report, 'coverage', 'every declared profile was driven by this run', async function() {
      expectEqual(report.profilesUnconsumed.length, 0,
        'these profiles are declared and were never selected: ' + report.profilesUnconsumed.join(', ') +
        '. A recorded response nothing requests is not evidence.');
      return { declared: report.profilesDeclared, consumed: report.profilesConsumed.length };
    });

    await runCase(report, 'coverage', 'a profile counts as driven only from a call the fixture served', async function() {
      // The property, checked against the evidence rather than trusted: for
      // every profile the run reports as consumed there is at least one
      // `event`-free record - a call served or refused - carrying that profile.
      // Selecting a profile writes a `profile-changed` note and nothing else,
      // so a probe that switched profiles and issued no request drives nothing.
      var records = state.calls.concat(context.childRecords || []);

      report.profilesConsumed.forEach(function(profile) {
        var served = records.filter(function(entry) {
          return entry.event === undefined && entry.profile === profile;
        });

        expect(served.length >= 1, 'the profile ' + JSON.stringify(profile) +
          ' is reported as driven with no intercepted call to show for it');
      });

      var notesOnly = records.filter(function(entry) {
        return entry.event === 'profile-changed' || entry.event === 'install';
      });
      expect(notesOnly.length > 0,
        'the run must have produced selection notes, or this case is not testing anything');

      return { consumed: report.profilesConsumed.length, notesIgnored: notesOnly.length };
    });

    await runCase(report, 'coverage', 'every recorded contract violation was a deliberate breach', async function() {
      expectEqual(state.contractViolations.length, context.deliberateBreaches,
        'the only violations may be the ones the contract cases drove on purpose (' +
        context.deliberateBreaches + '); anything else is a driver that was supposed to ' +
        'conform and did not: ' + JSON.stringify(requestContractReport().violations));
      return { deliberate: context.deliberateBreaches };
    });

    await runCase(report, 'coverage', 'all six reCAPTCHA outcomes were exercised', async function() {
      var cases = report.cases.filter(function(entry) { return entry.group === 'recaptcha'; });

      // Six documented outcomes, each named in the case that drives it. The
      // count of CASES is larger, because outcome 3 has a second, rejected
      // variant - the only way to reach the request.fail edges that branch on
      // `success` - so the six are checked by name rather than by tally.
      [1, 2, 3, 4, 5, 6].forEach(function(outcome) {
        var driver = cases.filter(function(entry) {
          return entry.name.indexOf('outcome ' + outcome + ':') === 0;
        });

        expect(driver.length >= 1, 'reCAPTCHA outcome ' + outcome +
          ' has no case driving it, and the cases present are: ' +
          cases.map(function(entry) { return entry.name; }).join(' | '));
      });

      cases.forEach(function(entry) {
        expect(entry.ok, 'the reCAPTCHA case ' + JSON.stringify(entry.name) + ' failed: ' + entry.error);
      });
      return { outcomes: 6, cases: cases.length };
    });
  }
  finally {
    report.contract = requestContractReport();
    report.contractViolationsDeliberate = context.deliberateBreaches;
    report.handshake = state.handshake;

    restoreCallerState(callerState, genuineFetch, context);
  }

  // Proved after the restore rather than asserted before it, because the claim
  // is about the state a CALLER is left in.
  await runCase(report, 'lifecycle', 'the run leaves the caller\'s process as it found it', async function() {
    expectEqual(state.activeProfile, callerState.profile, 'the active profile');
    expectEqual(state.contractViolations.length, callerState.violations.length,
      'the caller\'s violation list must not carry this run\'s deliberate breaches');
    expectEqual(state.calls.length, callerState.calls.length, 'the caller\'s evidence list');
    expectEqual(state.installed, callerState.installed, 'the caller\'s installed state');
    expectEqual(globalThis.__parityHttpTripwire, undefined, 'the tripwire must be gone');

    Object.keys(callerState.env).forEach(function(name) {
      var before = callerState.env[name];
      expectEqual(Object.prototype.hasOwnProperty.call(process.env, name), before.present,
        'the presence of ' + name);
      if (before.present) {
        expectEqual(process.env[name], before.value, 'the value of ' + name);
      }
    });

    if (callerState.installed) {
      // The invariant a caller depends on: the fixture patched, holding the
      // GENUINE fetch as the value restore() would put back - not its own
      // replacement.
      expect(globalThis.fetch !== genuineFetch, 'the fixture must be installed again');
      expectEqual(state.originalFetch, genuineFetch,
        'and it must own the genuine fetch, or a later restore() would install the wrong value');
      assertReady();
    }

    return { restored: true };
  });

  report.ok = report.failed === 0;

  if (opts.out) {
    fs.writeFileSync(opts.out, JSON.stringify(report, null, 2) + '\n');
  }

  return report;
}

// Puts the caller's process back exactly as selfTest() found it. Idempotent,
// so the finally block and an early return cannot double-apply it, and it never
// throws: a restore fault must not replace the report with a stack trace.
function restoreCallerState(callerState, genuineFetch, context) {
  if (callerState.restored) {
    return;
  }
  callerState.restored = true;

  // Ownership first: unpatch, put the genuine fetch back, then re-install so
  // the fixture holds the genuine function as its retained original.
  try { restore(); } catch (ignored) { /* there is nothing left to report to */ }
  globalThis.fetch = genuineFetch;
  delete globalThis.__parityHttpTripwire;

  // The configuration this run had to move, including whether the variable was
  // set at all - an added key is as much a mutation as a changed one.
  if (context && context.config) {
    context.config.isTest = context.isTestAtStart;

    if (context.secretkeyAtStart !== undefined && context.config.app.recaptcha) {
      context.config.app.recaptcha.secretkey = context.secretkeyAtStart;
    }
  }

  Object.keys(callerState.env).forEach(function(name) {
    if (callerState.env[name].present) {
      process.env[name] = callerState.env[name].value;
    }
    else {
      delete process.env[name];
    }
  });

  // Re-installed BEFORE the collections are put back, because install() records
  // its own handshake and diagnostic notes: restoring the evidence first would
  // leave the caller's list two records longer than it started, which is the
  // mutation this function exists to prevent.
  if (callerState.installed) {
    install();
  }

  // The fixture's own collections, so a caller's evidence does not acquire this
  // run's calls or its deliberate contract breaches. COPIES, not the captured
  // arrays: assigning the snapshot itself would alias it, and a later push
  // would silently grow the very record this restore is measured against.
  state.calls = callerState.calls.slice();
  state.contractViolations = callerState.violations.slice();
  state.served = Object.assign({}, callerState.served);
  state.profileFileState = callerState.fileState;
  state.activeProfile = callerState.profile;
  state.resolveDiagnostic = callerState.diagnostic;
  state.handshake = callerState.handshake;

  if (context && context.scratch) {
    try { fs.rmSync(context.scratch, { recursive: true, force: true }); }
    catch (ignored) { /* a leftover temporary directory is not worth a failure */ }
  }
}

var USAGE = [
  'test/parity/fixtures/http.js - recorded OAuth, reCAPTCHA and asset responses.',
  '',
  'As a PRELOAD it takes no arguments and reads only PARITY_* variables:',
  '  node --require <abs path>/test/parity/fixtures/http.js app.js',
  '',
  'Executed DIRECTLY it verifies every recorded outcome against the call sites:',
  '  node test/parity/fixtures/http.js [--out <file>] [--quiet]',
  '',
  '  --out <file>   write the JSON report to <file>. No file is written by',
  '                 default and no path inside the worktree is implied.',
  '  --quiet        report the summary and any failures only.',
  '  --help         this text.',
  '',
  'Exit codes: ' + EXIT_OK + ' every case passed, ' + EXIT_ERROR + ' a case failed, ' +
    EXIT_USAGE + ' bad usage, ' + EXIT_UNPROTECTED,
  'the fixture could not intercept a mechanism this tree provides.'
].join('\n');

// The gate. Reads argv, which the preload path never does.
async function main(argv) {
  var args = (argv || []).slice(2);
  var options = { out: null, quiet: false };
  var i;

  for (i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') {
      process.stdout.write(USAGE + '\n');
      return EXIT_OK;
    }
    else if (args[i] === '--quiet') {
      options.quiet = true;
    }
    else if (args[i] === '--out') {
      options.out = args[++i];
      if (!options.out) {
        process.stderr.write('http fixture: --out requires a path\n');
        return EXIT_USAGE;
      }
    }
    else {
      process.stderr.write('http fixture: unknown argument ' + JSON.stringify(args[i]) + '\n' +
        USAGE + '\n');
      return EXIT_USAGE;
    }
  }

  var report;
  try {
    report = await selfTest(options);
  }
  catch (error) {
    process.stderr.write('http fixture: the self-test could not run: ' +
      (error && error.stack ? error.stack : String(error)) + '\n');
    return EXIT_ERROR;
  }

  report.cases.forEach(function(entry) {
    if (entry.ok && options.quiet) {
      return;
    }
    process.stdout.write((entry.ok ? '  ok   ' : '  FAIL ') + entry.group + ': ' + entry.name +
      (entry.ok ? '' : '\n         ' + entry.error) + '\n');
  });

  process.stdout.write('\n' + (report.ok ? 'PASS' : 'FAIL') + ': ' + report.passed +
    ' passed, ' + report.failed + ' failed, ' + report.profilesConsumed.length + ' of ' +
    report.profilesDeclared + ' profiles driven' +
    (report.profilesUnconsumed.length ? ', undriven: ' + report.profilesUnconsumed.join(', ') : '') +
    '\n');

  if (options.out) {
    process.stdout.write('wrote ' + options.out + '\n');
  }

  return report.ok ? EXIT_OK : EXIT_ERROR;
}

// ---------------------------------------------------------------------------
// Auto-install on first require, so a preload needs no argument and no call.
// Wrapped so that nothing here can throw out of the load: this module is
// required before app.js, and a throw at this point would take the server down
// before it ever started.
// ---------------------------------------------------------------------------
try {
  alignIdentitiesFromEnvironment();

  // The identity contract, checked at load and recorded rather than merely
  // documented. A violation is fatal to the OAuth branches' meaning but not to
  // the server, so it is published in the handshake and the log where a driver
  // - or assertReady() - can refuse to proceed on it.
  var identityAtLoad = checkIdentityContract();
  if (!identityAtLoad.ok) {
    note('identity-contract-violated', identityAtLoad);
  }
  else if (identityAtLoad.unverified.length) {
    note('identity-contract-unverified', identityAtLoad);
  }

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

// ---------------------------------------------------------------------------
// Direct execution: either one child case, or the whole self-test.
//
// Neither branch is reachable through `require`, so the preload contract is
// unchanged - no argv is read, nothing is printed, and every input still
// arrives through a PARITY_* variable. `require.main === module` is what
// separates the two, and it is false for every consumer of this file.
// ---------------------------------------------------------------------------
if (require.main === module) {
  if (process.env[SELFTEST_CHILD_VAR]) {
    runChildCase(process.env[SELFTEST_CHILD_VAR]);
  }
  else {
    main(process.argv).then(function(code) {
      process.exitCode = code;
    }, function(error) {
      process.stderr.write('http fixture: ' +
        (error && error.stack ? error.stack : String(error)) + '\n');
      process.exitCode = EXIT_ERROR;
    });
  }
}
