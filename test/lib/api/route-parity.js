var chai     = require('chai'),
    should   = chai.should(),
    CryptoJS = require('crypto-js'),
    config   = require('config'),
    roles    = require('../../../lib/util/roles'),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults'),
    app      = require('../../../app.js');

/**
 * R-6 baseline route parity — SELF-CONTAINED.
 *
 * The review recorded that only 16 distinct route paths were asserted against 233 registered routes, 117
 * of them under /api/. This suite closes that gap from inside `npm test`: it asserts the route table
 * against the documented anchor, and it asserts status, content type, body shape, Location and Set-Cookie
 * attributes for every one of the 58 parameterless GET routes plus the whole authenticated supplement and
 * the whole `next`-destination contract.
 *
 * INDEPENDENCE (review finding M2). This file requires NEITHER test/baseline/capture.js NOR
 * test/baseline/replay.js, and loads NEITHER committed JSON artifact. Every expectation below is a literal
 * in this file, and every helper it needs — the corpus selection rule, the title extractor, the
 * Set-Cookie attribute reader — is implemented here. That is the whole point: the CLI harness and this
 * suite are two INDEPENDENT verifiers of the same measured behavior, so a defect in the harness's
 * canonicalization cannot make this suite pass, and vice versa. An earlier revision imported both modules
 * and read both artifacts, which meant it shared the very oracle it was supposed to corroborate.
 *
 * TRANSPORT (review finding M3). Every request goes through `flow`, the suite's own harness, which issues
 * real HTTP over an ephemeral socket against the booted server's listener. `server.inject()` is never
 * used here, for the same reason the CLI harness avoids it: @hapi/shot/lib/request.js:L30 is the last
 * remaining DEP0169 source in the tree. That is a rule about this suite, not a claim about the
 * application — lib/controllers/courses.js and lib/controllers/folders.js both perform internal
 * sub-requests with request.server.inject(), base-identical at both commits.
 *
 * ISOLATION. The unauthenticated corpus is driven through the empty cookie slot (`flow.switchUser('')`),
 * which attaches no cookie at all. The authenticated supplement is driven through a slot of this suite's
 * own, `defaults.parity`, created here and removed here, so it neither consumes nor disturbs the session
 * state the earlier eight suites share. `flow.activeUser` is restored when the suite finishes.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED. HTML body digests. This suite runs inside `npm test`, where the
 * database carries whatever the preceding suites left behind, so a leftover course or user can
 * legitimately change rendered markup without changing any behavior under test. Digests are
 * test/baseline/replay.js's job, on a clean capture. What IS asserted here is everything that is a pure
 * function of routing, configuration and templates: the status, the content type, the body kind, the exact
 * JSON bodies, the HTML <title> and structural markers, the literal Location and the Set-Cookie attribute
 * set.
 */

// ---------------------------------------------------------------------------------------------
// The documented route-table anchor (TR1), as literals
// ---------------------------------------------------------------------------------------------

/**
 * The Technical Specification's published 32-character digest for the 233-row route table. It is retained
 * VERBATIM and is never replaced by a measurement.
 *
 * It is deliberately NOT recomputed here. The published value is 32 hexadecimal characters labelled
 * sha256 where a SHA-256 is 64, and the Specification publishes no serialization for it, so no input
 * exists from which any verifier could reproduce the string. Reverse-engineering a serialization until
 * something matched would be a fabrication rather than a verification. The table the digest stands for is
 * held to byte-identity instead, clause by clause, below.
 */
var DOCUMENTED_DIGEST = 'cd2a7e38a39bd84902ac1a0d69f50e2a';

/** Every substantive anchor the Specification publishes for this table, as literals. */
var DOCUMENTED_ANCHOR = {
  rowCount            : 233,
  methods             : { GET : 137, POST : 63, PUT : 19, DELETE : 13, PATCH : 1 },
  apiPaths            : 117,
  withPreHandlers     : 161,
  authRequiredSession : 105,
  authFalse           : 2,
  authTryInherited    : 126
};

/** The registration-order contract: static pages first, the two catch-alls last. */
var REGISTRATION_ORDER_HEAD = ['/about', '/help'];
var REGISTRATION_ORDER_TAIL = ['/.well-known/{path*}', '/{path*}'];

/** The raw shape of each row's own `auth` setting, tallied by type. */
var RAW_AUTH_TALLY = { 'undefined' : 126, 'object' : 105, 'false' : 2 };

/** The server default the 126 untouched rows inherit. */
var SERVER_AUTH_DEFAULT = { mode : 'try', strategies : ['session'] };

/** Declared entries plus routes the parser synthesizes. */
var DECLARED_ROUTE_ENTRIES = 228;
var SYNTHESIZED_ROUTES     = 5;

// ---------------------------------------------------------------------------------------------
// Request policy — the same policy the base-commit measurement was taken under
// ---------------------------------------------------------------------------------------------

var POLICY = {
  referer   : 'https://trinket.dev',
  userAgent : 'trinket-oss-baseline-capture/1.0 (R-6 parity harness)'
};

/** The statuses that carry a Location this suite is willing to follow. */
var REDIRECT_STATUSES = [301, 302, 303, 307, 308];

/**
 * One request through the flow harness under the capture policy.
 *
 * Accept is deliberately never set: app.js:L161-L163 treats any Accept containing application/json as an
 * API request, which would move five of the seven session-required routes off their measured takeover
 * redirect and onto a raw 401. Accept-Encoding is pinned to identity so nothing is compressed. The referer
 * flow sets by default is replaced with the policy value. Redirects are never followed automatically,
 * because the Location header itself is an assertion target.
 *
 * @param   {string} path The path to request.
 * @returns {Object} A supertest request, ready for `.end()`.
 */
function get(path) {
  return flow.get(path)
    .set('referer', POLICY.referer)
    .set('user-agent', POLICY.userAgent)
    .set('accept-encoding', 'identity')
    .redirects(0);
}

/**
 * The same policy for a POST, with a payload.
 *
 * @param   {string} path The path to request.
 * @param   {Object} body The payload to send.
 * @returns {Object} A supertest request, ready for `.end()`.
 */
function post(path, body) {
  return flow.post(path)
    .set('referer', POLICY.referer)
    .set('user-agent', POLICY.userAgent)
    .set('accept-encoding', 'identity')
    .redirects(0)
    .send(body);
}

/**
 * The same policy for a GET replayed under an EXPLICIT cookie rather than under the active slot.
 *
 * The authenticated supplement needs this because the session cookie it asserts against is the one POST
 * /login handed back inside this suite: lib/controllers/users.js#login calls `request.yar.reset()` on
 * success, which rotates the session id, so any cookie captured before that POST is deliberately dead.
 * `flow.replay` is the harness's existing accessor for exactly this - a request bound to a caller-supplied
 * cookie - and it is used unmodified.
 *
 * @param   {string} path   The path to request.
 * @param   {*}      cookie The raw Set-Cookie value (string or array) to send back.
 * @returns {Object} A supertest request, ready for `.end()`.
 */
function getWithCookie(path, cookie) {
  return flow.replay('get', path, cookie)
    .set('referer', POLICY.referer)
    .set('user-agent', POLICY.userAgent)
    .set('accept-encoding', 'identity')
    .redirects(0);
}

/**
 * The same explicit-cookie policy for a POST.
 *
 * The `next` contract needs it because the destination is persisted in the SESSION by the entry GET and
 * consumed by this POST, so the two requests must demonstrably share one session. `flow.get`/`flow.post`
 * attach the active slot's cookie but never record a response's cookie back into the slot - only the
 * `setLastResponse` wrapper does that, and it is not on this path - so threading the cookie by hand is
 * both the correct and the more honest way to prove the two requests are one session.
 *
 * @param   {string} path   The path to request.
 * @param   {Object} body   The payload to send.
 * @param   {*}      cookie The raw Set-Cookie value to send back.
 * @returns {Object} A supertest request, ready for `.end()`.
 */
function postWithCookie(path, body, cookie) {
  return flow.replay('post', path, cookie)
    .set('referer', POLICY.referer)
    .set('user-agent', POLICY.userAgent)
    .set('accept-encoding', 'identity')
    .redirects(0)
    .send(body);
}

/** Two shorthands for the two HTML/JSON content types every entry below carries. */
var HTML = 'text/html; charset=utf-8';
var JSON_TYPE = 'application/json; charset=utf-8';

/** The Set-Cookie attribute sets that appear, named so the table stays readable. */
var NO_COOKIE      = null;
var ORDINARY       = [['HttpOnly', 'SameSite', 'Path']];
var COOKIE_ROUTE   = [['HttpOnly', 'SameSite', 'Path', 'Expires']];

/** The two structural marker sets an HTML body can carry, plus the error pages. */
function markers(notFoundPage, serverErrorPage) {
  return { notFoundPage : notFoundPage, serverErrorPage : serverErrorPage, hasDoctype : true };
}

var PAGE      = markers(false, false);
var NOT_FOUND = markers(true, false);
var SERVER_ERR = markers(false, true);

/** The Boom JSON body shape every 4xx and 5xx under /api/ carries. */
var BOOM_KEYS = ['error', 'message', 'statusCode'];

/**
 * THE 58-ROUTE UNAUTHENTICATED CORPUS, measured at base commit 2f8712a and encoded here directly.
 *
 * Selection is REPRODUCIBLE rather than curated: every GET row of the live route table whose path
 * contains no `{param}` segment. `selectCorpusPaths()` below re-derives it from the running server and the
 * first test asserts the derivation equals these 58 paths, so the table cannot silently drift out of step
 * with the route table.
 *
 * Fields: path, status, contentType, location (null when no Location header), body kind, HTML title (null
 * when the page renders none), structural markers, Set-Cookie attribute names, and for a JSON body the
 * sorted key list.
 *
 * The 25×200 / 7×401 / 25×404 / 1×500 distribution the Specification publishes is recomputed from this
 * table and asserted. The single 500, at GET /api/users/assets, is a PRE-EXISTING condition that must be
 * reproduced rather than repaired, and the 25 404s are feature-flag-gated by
 * lib/util/features.js#isKnownTrinketType.
 */
var CORPUS = [
  { path : '/',                               status : 200, type : HTML,      loc : null,
    kind : 'html',  title : 'Trinket',             mark : PAGE,        cookie : ORDINARY },
  { path : '/R',                              status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/R/',                             status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/about',                          status : 200, type : HTML,      loc : null,
    kind : 'html',  title : 'About Trinket',       mark : PAGE,        cookie : NO_COOKIE },
  { path : '/account',                        status : 302, type : HTML,      loc : '/login',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE },
  { path : '/account-deleted',                status : 302, type : HTML,      loc : '/',
    kind : 'empty', title : null,                  mark : null,        cookie : ORDINARY },
  { path : '/activate-account',               status : 200, type : HTML,      loc : null,
    kind : 'html',  title : 'Trinket',             mark : PAGE,        cookie : ORDINARY },
  { path : '/admin',                          status : 302, type : HTML,      loc : '/login',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE },
  { path : '/api/courses',                    status : 401, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  { path : '/api/exports',                    status : 401, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  { path : '/api/featured-courses',           status : 401, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  { path : '/api/folders',                    status : 401, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  { path : '/api/trinkets',                   status : 401, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  { path : '/api/trinkets/active',            status : 404, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  { path : '/api/trinkets/popular',           status : 404, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  { path : '/api/trinkets/search',            status : 401, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  // The pre-existing 500. AAP invariant I14: reproduced, never repaired.
  { path : '/api/users/assets',               status : 500, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  { path : '/api/users/resendEmailChange',    status : 401, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : BOOM_KEYS,              cookie : NO_COOKIE },
  // GET /auth/google under the SHIPPED configuration: clientID is null, so the handler answers the
  // no-status failure responder rather than reaching Google. The 200 with { flash, message } is the
  // preserved failure-responder quirk.
  { path : '/auth/google',                    status : 200, type : JSON_TYPE, loc : null,
    kind : 'json',  keys : ['flash', 'message'],   cookie : ORDINARY },
  { path : '/auth/google/callback',           status : 302, type : HTML,      loc : '{origin}/signup',
    kind : 'empty', title : null,                  mark : null,        cookie : COOKIE_ROUTE },
  { path : '/blocks',                         status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/blocks/',                        status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/change-email',                   status : 302, type : HTML,      loc : '{origin}/account/email',
    kind : 'empty', title : null,                  mark : null,        cookie : ORDINARY },
  { path : '/console',                        status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/console/',                       status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/courses/new',                    status : 302, type : HTML,      loc : '/login',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE },
  { path : '/docs/colors',                    status : 200, type : HTML,      loc : null,
    kind : 'html',  title : 'Colors',              mark : PAGE,        cookie : ORDINARY },
  { path : '/embed/blocks-iframe',            status : 200, type : HTML,      loc : null,
    kind : 'html',  title : null,                  mark : PAGE,        cookie : ORDINARY },
  { path : '/embed/glowscript-blocks-iframe', status : 200, type : HTML,      loc : null,
    kind : 'html',  title : null,                  mark : PAGE,        cookie : ORDINARY },
  { path : '/forgot-pass',                    status : 200, type : HTML,      loc : null,
    kind : 'html',  title : 'Trinket',             mark : PAGE,        cookie : ORDINARY },
  { path : '/glowscript',                     status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/glowscript-blocks',              status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/glowscript-blocks/',             status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/glowscript/',                    status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/help',                           status : 200, type : HTML,      loc : null,
    kind : 'html',  title : 'Help',                mark : PAGE,        cookie : NO_COOKIE },
  { path : '/home',                           status : 302, type : HTML,      loc : '/login',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE },
  { path : '/html',                           status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/html/',                          status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/java',                           status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/java/',                          status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/login',                          status : 200, type : HTML,      loc : null,
    kind : 'html',  title : 'Trinket',             mark : PAGE,        cookie : ORDINARY },
  { path : '/logout',                         status : 302, type : HTML,      loc : '{origin}/',
    kind : 'empty', title : null,                  mark : null,        cookie : COOKIE_ROUTE },
  { path : '/music',                          status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/music/',                         status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/pygame',                         status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/pygame/',                        status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/python',                         status : 200, type : HTML,      loc : null,
    kind : 'html',  title : 'Your Python Trinket', mark : PAGE,        cookie : ORDINARY },
  { path : '/python/',                        status : 302, type : HTML,      loc : '{origin}/python',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE },
  { path : '/python3',                        status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/python3/',                       status : 404, type : HTML,      loc : null,
    kind : 'html',  title : 'Page not found',      mark : NOT_FOUND,   cookie : NO_COOKIE },
  { path : '/r',                              status : 302, type : HTML,      loc : '{origin}/R',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE },
  { path : '/reset-pass',                     status : 302, type : HTML,      loc : '{origin}/forgot-pass',
    kind : 'empty', title : null,                  mark : null,        cookie : ORDINARY },
  { path : '/signup',                         status : 200, type : HTML,      loc : null,
    kind : 'html',  title : 'Trinket',             mark : PAGE,        cookie : ORDINARY },
  { path : '/skulpt',                         status : 302, type : HTML,      loc : '{origin}/python',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE },
  { path : '/verify-email',                   status : 302, type : HTML,      loc : '{origin}/account/email',
    kind : 'empty', title : null,                  mark : null,        cookie : ORDINARY },
  { path : '/vpython',                        status : 302, type : HTML,      loc : '{origin}/glowscript',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE },
  { path : '/webvpython',                     status : 302, type : HTML,      loc : '{origin}/glowscript',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE },
  { path : '/welcome',                        status : 302, type : HTML,      loc : '/login',
    kind : 'empty', title : null,                  mark : null,        cookie : NO_COOKIE }
];

/** The distribution the Technical Specification publishes for the corpus, in its RESOLVED reading. */
var DOCUMENTED_DISTRIBUTION = { '200' : 25, '401' : 7, '404' : 25, '500' : 1 };

/** The distribution of the corpus's FIRST-HOP reading, which is what this suite issues. */
var FIRST_HOP_DISTRIBUTION = { '200' : 12, '302' : 16, '401' : 7, '404' : 22, '500' : 1 };

/**
 * THE RESOLVED READING, measured rather than derived.
 *
 * Exactly the sixteen 302 rows above carry a Location chain, and this map records where each chain ENDS:
 * the terminal status, and the number of hops it takes to reach it. Every value was measured against the
 * running application, which is the only way to get `/change-email` and `/verify-email` right - both take
 * TWO hops, because `{origin}/account/email` is itself a redirect to a parameterless page that the corpus
 * does not contain, so no amount of walking the table above can reach their terminus.
 *
 * A path absent from this map resolves to its own first-hop status in zero hops. Summing this map over the
 * corpus is what reproduces DOCUMENTED_DISTRIBUTION, and `follows every Location chain to the terminus the
 * documented reading names` below re-walks all sixteen chains over real HTTP so the numbers stay honest.
 */
var RESOLVED = {
  '/account'              : { status : 200, hops : 1 },
  '/account-deleted'      : { status : 200, hops : 1 },
  '/admin'                : { status : 200, hops : 1 },
  '/auth/google/callback' : { status : 200, hops : 1 },
  '/change-email'         : { status : 200, hops : 2 },
  '/courses/new'          : { status : 200, hops : 1 },
  '/home'                 : { status : 200, hops : 1 },
  '/logout'               : { status : 200, hops : 1 },
  '/python/'              : { status : 200, hops : 1 },
  '/r'                    : { status : 404, hops : 1 },
  '/reset-pass'           : { status : 200, hops : 1 },
  '/skulpt'               : { status : 200, hops : 1 },
  '/verify-email'         : { status : 200, hops : 2 },
  '/vpython'              : { status : 404, hops : 1 },
  '/webvpython'           : { status : 404, hops : 1 },
  '/welcome'              : { status : 200, hops : 1 }
};

/**
 * THE AUTHENTICATED SUPPLEMENT, driven LIVE (review finding M5).
 *
 * An earlier revision checked these values only inside the committed artifact while its live request loop
 * stayed unauthenticated, which proves nothing about the running application. Every entry below is issued
 * here, in this order, against a session this suite established itself.
 *
 * Entries [2] and [3] are the flagship preserved quirk: an AUTHENTICATED GET /login and GET /signup answer
 * HTTP 500 rendered as 50x.html, because lib/controllers/pages.js throws Boom.badImplementation where the
 * base commit's `reply.redirect` raised a TypeError. They must NOT become 302s.
 */
var AUTHENTICATED = [
  { label : 'POST /login with valid credentials', status : 302, type : HTML, loc : '{origin}/home',
    kind : 'empty', cookie : COOKIE_ROUTE },
  { label : 'POST /login with a wrong password',  status : 302, type : HTML, loc : '{origin}/login',
    kind : 'empty', cookie : COOKIE_ROUTE },
  { label : 'GET /login authenticated',           status : 500, type : HTML, loc : null,
    kind : 'html',  cookie : ORDINARY,     title : 'Something went wrong', mark : SERVER_ERR },
  { label : 'GET /signup authenticated',          status : 500, type : HTML, loc : null,
    kind : 'html',  cookie : ORDINARY,     title : 'Something went wrong', mark : SERVER_ERR },
  { label : 'GET /home authenticated',            status : 200, type : HTML, loc : null,
    kind : 'html',  cookie : ORDINARY,     title : 'Trinket',              mark : PAGE },
  { label : 'GET /account authenticated',         status : 302, type : HTML, loc : '/account/profile',
    kind : 'empty', cookie : ORDINARY },
  { label : 'GET /logout authenticated',          status : 302, type : HTML, loc : '{origin}/',
    kind : 'empty', cookie : COOKIE_ROUTE }
];

/** The session cookie contract (TR4), as literals. */
var COOKIE_NAME  = 'session';
var COOKIE_SEAL  = 'Fe26.2';

/** The `next` destination contract (P3-1 and the preserved open redirect). */
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

/**
 * Every destination shape and the Location it produces. The first four are same-origin and round-trip
 * byte-for-byte; the rest are the PRESERVED OPEN REDIRECT (docs/PRESERVED-QUIRKS.md section 4.4) — echoed
 * unchanged because `next` is persisted and read verbatim, exactly as at the base commit. There are no
 * exemptions: an earlier revision asserted refusals here and excluded three of these from the parity
 * corpus, which let a behavior-changing build report parity.
 */
var ECHOED_DESTINATIONS = [
  { label : 'an off-origin absolute URL',       candidate : 'https://evil.example/steal' },
  { label : 'a scheme-relative URL',            candidate : '//evil.example/steal' },
  { label : 'the backslash form of one',        candidate : '/\\evil.example/steal' },
  { label : 'a userinfo disguise',              candidate : 'https://trinket.dev@evil.example/x' },
  { label : 'a subdomain-suffix lookalike',     candidate : 'https://trinket.dev.evil.example/x' },
  { label : 'a javascript: scheme',             candidate : 'javascript:alert(1)' },
  { label : 'a bare relative value',            candidate : 'courses/algebra-1' }
];

/** The roles-token envelope invariants (F7), as literals. */
var ROLES_TOKEN = {
  envelopeBase64Prefix : 'U2FsdGVkX1',
  magic                : 'Salted__',
  hexLength            : 32
};

// ---------------------------------------------------------------------------------------------
// Helpers — implemented here rather than imported, so this suite stands on its own
// ---------------------------------------------------------------------------------------------

/** The app.url origin this process is configured for; absolute Locations carry it. */
function appOrigin() {
  return config.url;
}

/** Resolves a `{origin}` placeholder in an expected Location. */
function expectedLocation(template) {
  return template === null ? null : template.replace('{origin}', appOrigin());
}

/**
 * The corpus SELECTION RULE, re-derived from the live route table: every GET row whose path carries no
 * `{param}` segment, de-duplicated and sorted. This is what makes the encoded table above a measurement
 * of a rule rather than a curated list.
 *
 * @param   {Object} server The booted hapi server.
 * @returns {string[]} The selected paths, sorted.
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

/** The `<title>` of an HTML body, or null when it renders none. */
function extractTitle(body) {
  var match = /<title>([\s\S]*?)<\/title>/i.exec(String(body || ''));

  return match ? match[1].trim() : null;
}

/** The attribute NAMES of one Set-Cookie value, in order, excluding the name=value pair itself. */
function setCookieAttributeNames(value) {
  return String(value).split(';').slice(1).map(function(part) {
    return part.trim().split('=')[0];
  }).filter(function(name) {
    return name.length > 0;
  });
}

/** The Set-Cookie attribute sets of a response, or null when it set no cookie. */
function cookieAttributes(response) {
  var raw = response.headers['set-cookie'];

  return raw ? [].concat(raw).map(setCookieAttributeNames) : null;
}

/** A status tally, keyed by status as a string, for comparison against a published distribution. */
function tally(statuses) {
  return statuses.reduce(function(counts, status) {
    counts[String(status)] = (counts[String(status)] || 0) + 1;

    return counts;
  }, {});
}

/**
 * The RESOLVED status of one corpus row, read off the measured RESOLVED map. Rows with no chain resolve to
 * their own status in zero hops.
 *
 * @param   {Object} row A row of CORPUS.
 * @returns {number} The terminal status.
 */
function resolvedStatus(row) {
  return RESOLVED[row.path] ? RESOLVED[row.path].status : row.status;
}

/** @returns {Array.<string>} Every corpus path that carries a Location chain, sorted. */
function chainedPaths() {
  return Object.keys(RESOLVED).sort();
}

/**
 * Turns an absolute or relative Location value into a path this process can request again, or null when it
 * leaves this origin (which no corpus chain does).
 *
 * @param   {string} location A raw Location header value.
 * @returns {?string} A leading-slash path, or null when the destination is off-origin.
 */
function samePathOf(location) {
  var origin = appOrigin();

  if (String(location).indexOf(origin) === 0) {
    return String(location).slice(origin.length) || '/';
  }

  return String(location).charAt(0) === '/' ? String(location) : null;
}

/**
 * Walks one Location chain over real HTTP, unauthenticated, counting hops.
 *
 * @param   {string}   path The corpus path to start from.
 * @param   {Function} done Node-style callback invoked with `(err, {status, hops})`.
 * @returns {undefined}
 */
function walkChain(path, done) {
  var hops = 0,
      seen = {};

  function step(current) {
    if (hops > 6) {
      return done(new Error('Location chain from ' + path + ' did not terminate within 6 hops'));
    }

    get(current).end(function(err, response) {
      if (err) {
        return done(err);
      }

      if (REDIRECT_STATUSES.indexOf(response.statusCode) === -1) {
        return done(null, { status : response.statusCode, hops : hops });
      }

      var next = samePathOf(response.headers.location);

      if (next === null || seen[next]) {
        return done(null, { status : response.statusCode, hops : hops });
      }

      seen[next] = true;
      hops += 1;

      return step(next);
    });
  }

  step(path);
}

// ---------------------------------------------------------------------------------------------
// The suite
// ---------------------------------------------------------------------------------------------

module.exports = function() {
  describe('R-6 baseline route parity', function() {
    var server        = null,
        previousUser  = null,
        parityCookie  = null,
        loginResponse = null;

    before(function() {
      this.timeout(60000);

      return Promise.resolve(app).then(function(started) {
        server = started;
      });
    });

    /**
     * THE ACCOUNT LIFECYCLE, owned by the OUTER block.
     *
     * `defaults.parity` is created once here and removed once at the end, so both inner blocks below can
     * rely on the account existing without either of them owning it. An earlier revision created and
     * removed it inside the authenticated block and then had the `next` block re-create it through
     * `flow.switchUser('parity-next', callback)` - which cannot work, because the callback form of
     * `switchUser` looks the slot name up in `defaults` and there is no `defaults['parity-next']`. Slot
     * names that are not `defaults` keys are only ever used in the callback-free form, purely to select a
     * cookie jar.
     *
     * `switchUser` with a callback creates the account on first use and logs in, which is exactly what is
     * needed; the cookie it leaves in the slot is deliberately NOT reused by the assertions below, for the
     * reason `getWithCookie` documents.
     */
    before(function(done) {
      this.timeout(60000);

      previousUser = flow.activeUser;
      flow.switchUser('parity', function(err) {
        done(err);
      });
    });

    after(function(done) {
      this.timeout(60000);

      flow.activeUser = previousUser === null ? 'user' : previousUser;

      User.findByLogin(defaults.parity.email, function(err, doc) {
        if (err || !doc) {
          return done(err);
        }

        return doc.remove(function(removeErr) {
          done(removeErr);
        });
      });
    });

    /** Asserts one response against one encoded expectation. */
    function assertEntry(expected, response, label) {
      response.statusCode.should.eql(expected.status, label + ' status');
      String(response.headers['content-type'] || '').should.eql(expected.type, label + ' content-type');

      if (expected.loc === null) {
        should.not.exist(response.headers.location, label + ' must set no Location');
      }
      else {
        should.equal(response.headers.location, expectedLocation(expected.loc), label + ' Location');
      }

      if (expected.cookie === null) {
        should.not.exist(response.headers['set-cookie'], label + ' must set no cookie');
      }
      else {
        cookieAttributes(response).should.eql(expected.cookie, label + ' Set-Cookie attributes');
      }

      if (expected.kind === 'empty') {
        Buffer.byteLength(response.text || '', 'utf8').should.eql(0, label + ' body must be empty');
      }
      else if (expected.kind === 'json') {
        Object.keys(response.body).sort().should.eql(expected.keys, label + ' JSON keys');
        response.body.statusCode === undefined ||
          response.body.statusCode.should.eql(expected.status, label + ' JSON statusCode');
      }
      else {
        should.exist(response.text, label + ' body');
        should.equal(extractTitle(response.text), expected.title, label + ' <title>');
        /^\s*<!doctype html/i.test(response.text).should.eql(expected.mark.hasDoctype, label + ' doctype');
        /<title>\s*Page not found\s*<\/title>/i.test(response.text)
          .should.eql(expected.mark.notFoundPage, label + ' 404 marker');
        /<title>\s*Something went wrong\s*<\/title>/i.test(response.text)
          .should.eql(expected.mark.serverErrorPage, label + ' 50x marker');
      }
    }

    // -----------------------------------------------------------------------------------------
    // TR1 — the registered route table
    // -----------------------------------------------------------------------------------------

    describe('the registered route table (TR1)', function() {
      /**
       * Canonicalizes the live table exactly as the documented anchor's row form describes.
       *
       * The server-wide default is read from `server.auth.settings.default`, which is where hapi 21 records
       * what `server.auth.default()` was called with. It is deliberately NOT read from
       * `server.settings.routes.auth` - that key is the route-level default a server may be constructed
       * with, app.js sets no such thing, and reading it yields undefined.
       *
       * @returns {Object} `{rows, raw, serverDefault, canonical}`.
       */
      function liveTable() {
        var fallback = server.auth.settings.default || {},
            rows     = [],
            raw      = { 'undefined' : 0, 'object' : 0, 'false' : 0 };

        server.table().forEach(function(row) {
          var auth       = row.settings.auth,
              strategies = auth && (auth.strategies || (auth.strategy ? [auth.strategy] : null)),
              descriptor = auth === false
                ? 'false'
                : 'mode=' + ((auth && auth.mode) || fallback.mode) +
                  ' strategies=' + JSON.stringify(strategies || fallback.strategies);

          rows.push({
            method     : String(row.method).toUpperCase(),
            path       : row.path,
            descriptor : descriptor,
            preCount   : (row.settings.pre || []).length,
            canonical  : [String(row.method).toUpperCase(), row.path, descriptor,
                          String((row.settings.pre || []).length)].join(' | ')
          });
        });

        // The RAW shape of each declaration's own auth setting, read from the parsed route table rather
        // than from the resolved one, because that is what the published tally counts.
        config.routes.forEach(function(route) {
          var own = route.options && route.options.auth !== undefined
            ? route.options.auth
            : (route.config && route.config.auth !== undefined ? route.config.auth : undefined);

          if (own === undefined)      { raw['undefined'] += 1; }
          else if (own === false)     { raw['false'] += 1; }
          else                        { raw['object'] += 1; }
        });

        return {
          rows          : rows,
          raw           : raw,
          serverDefault : { mode : fallback.mode, strategies : (fallback.strategies || []).slice() },
          canonical     : rows.map(function(row) { return row.canonical; })
        };
      }

      it('registers exactly the row count the documented anchor names', function() {
        server.table().length.should.eql(DOCUMENTED_ANCHOR.rowCount);
        config.routes.length.should.eql(DOCUMENTED_ANCHOR.rowCount);
      });

      it('reproduces the documented method distribution', function() {
        var methods = tally(server.table().map(function(row) {
          return String(row.method).toUpperCase();
        }));

        methods.should.eql(DOCUMENTED_ANCHOR.methods);
      });

      it('reproduces the documented /api/ path count and pre-handler count', function() {
        var table = server.table(),
            api   = table.filter(function(row) { return row.path.indexOf('/api/') === 0; }),
            pre   = table.filter(function(row) { return (row.settings.pre || []).length > 0; });

        api.length.should.eql(DOCUMENTED_ANCHOR.apiPaths);
        pre.length.should.eql(DOCUMENTED_ANCHOR.withPreHandlers);
      });

      it('reproduces the three documented auth buckets and the raw settings tally', function() {
        var live     = liveTable(),
            required = live.rows.filter(function(row) {
              return row.descriptor === 'mode=required strategies=["session"]';
            }),
            disabled = live.rows.filter(function(row) { return row.descriptor === 'false'; }),
            inherited = live.rows.filter(function(row) {
              return row.descriptor === 'mode=try strategies=["session"]';
            });

        required.length.should.eql(DOCUMENTED_ANCHOR.authRequiredSession);
        disabled.length.should.eql(DOCUMENTED_ANCHOR.authFalse);
        inherited.length.should.eql(DOCUMENTED_ANCHOR.authTryInherited);
        live.raw.should.eql(RAW_AUTH_TALLY);
      });

      it('keeps the server auth default that 126 rows inherit', function() {
        liveTable().serverDefault.should.eql(SERVER_AUTH_DEFAULT);
      });

      /**
       * routeParser.js invokes addStaticPages FIRST and addStaticRoutes LAST, which is what keeps the
       * /{path*} catch-all from shadowing every real route. The order is contractual, so it is asserted
       * against the parsed declaration order rather than merely assumed.
       */
      it('preserves the registration order contract: static pages first, catch-all last', function() {
        var paths = config.routes.map(function(route) {
          return route.path;
        });

        paths.slice(0, 2).should.eql(REGISTRATION_ORDER_HEAD);
        paths.slice(-2).should.eql(REGISTRATION_ORDER_TAIL);
      });

      it('re-derives the declared entries and the synthesized routes from committed code', function() {
        var declared = require('../../../config/api_routes').length +
                       require('../../../config/routes').length;

        declared.should.eql(DECLARED_ROUTE_ENTRIES);
        (declared + SYNTHESIZED_ROUTES).should.eql(DOCUMENTED_ANCHOR.rowCount);
      });

      /**
       * THE DOCUMENTED ANCHOR, AS A MANDATORY GATE, computed here from literals and the live server.
       *
       * The frozen 32-character digest is retained verbatim as clause 1 and is never replaced by a
       * measurement; the remaining clauses are the substance it summarizes. Any drift lands in `failures`
       * and fails this test, which is what makes it a gate rather than a stored boolean being read back.
       */
      it('enforces the documented route-table anchor as a mandatory gate', function() {
        var table    = server.table(),
            live     = liveTable(),
            clauses  = [],
            failures = [];

        function clause(name, documented, measured) {
          var satisfied = JSON.stringify(documented) === JSON.stringify(measured);

          clauses.push({ name : name, satisfied : satisfied });

          if (!satisfied) {
            failures.push(name + ': documented ' + JSON.stringify(documented) +
                          ', measured ' + JSON.stringify(measured));
          }
        }

        clause('documentedDigestRetainedVerbatim', 'cd2a7e38a39bd84902ac1a0d69f50e2a', DOCUMENTED_DIGEST);
        clause('rowCount', DOCUMENTED_ANCHOR.rowCount, table.length);
        clause('methods', DOCUMENTED_ANCHOR.methods,
               tally(table.map(function(row) { return String(row.method).toUpperCase(); })));
        clause('apiPaths', DOCUMENTED_ANCHOR.apiPaths,
               table.filter(function(row) { return row.path.indexOf('/api/') === 0; }).length);
        clause('withPreHandlers', DOCUMENTED_ANCHOR.withPreHandlers,
               table.filter(function(row) { return (row.settings.pre || []).length > 0; }).length);
        clause('authRequiredSession', DOCUMENTED_ANCHOR.authRequiredSession,
               live.rows.filter(function(row) {
                 return row.descriptor === 'mode=required strategies=["session"]';
               }).length);
        clause('authFalse', DOCUMENTED_ANCHOR.authFalse,
               live.rows.filter(function(row) { return row.descriptor === 'false'; }).length);
        clause('authTryInherited', DOCUMENTED_ANCHOR.authTryInherited,
               live.rows.filter(function(row) {
                 return row.descriptor === 'mode=try strategies=["session"]';
               }).length);
        clause('canonicalRowsAreUnique', DOCUMENTED_ANCHOR.rowCount,
               Object.keys(live.canonical.reduce(function(seen, row) {
                 seen[row] = true;
                 return seen;
               }, {})).length);
        clause('registrationOrderContract',
               REGISTRATION_ORDER_HEAD.concat(REGISTRATION_ORDER_TAIL),
               config.routes.map(function(route) { return route.path; }).slice(0, 2)
                 .concat(config.routes.map(function(route) { return route.path; }).slice(-2)));

        failures.should.eql([]);
        clauses.length.should.eql(10);
        clauses[0].name.should.eql('documentedDigestRetainedVerbatim');
      });
    });

    // -----------------------------------------------------------------------------------------
    // TR2 / TR3 / TR4 — the 58-route unauthenticated corpus, live
    // -----------------------------------------------------------------------------------------

    describe('the 58 parameterless GET routes (TR2, TR3, TR4)', function() {
      before(function() {
        // The empty slot attaches no cookie at all, which is what makes these requests unauthenticated
        // whatever the earlier suites - or this suite's own outer `before` - left in their own slots.
        flow.switchUser('');
      });

      it('derives the corpus from the live route table, not from a curated list', function() {
        selectCorpusPaths(server).should.eql(CORPUS.map(function(row) { return row.path; }));
        CORPUS.length.should.eql(58);
      });

      it('reproduces the documented resolved distribution from the encoded corpus', function() {
        tally(CORPUS.map(resolvedStatus)).should.eql(DOCUMENTED_DISTRIBUTION);
      });

      it('reproduces the first-hop distribution the requests below actually produce', function() {
        tally(CORPUS.map(function(row) { return row.status; })).should.eql(FIRST_HOP_DISTRIBUTION);
      });

      it('agrees with itself: exactly the redirect rows carry a chain, and no others', function() {
        var redirecting = CORPUS.filter(function(row) {
          return REDIRECT_STATUSES.indexOf(row.status) !== -1;
        }).map(function(row) { return row.path; }).sort();

        chainedPaths().should.eql(redirecting);
        chainedPaths().length.should.eql(FIRST_HOP_DISTRIBUTION['302']);
      });

      chainedPaths().forEach(function(path) {
        it('follows the Location chain from ' + path + ' to the documented terminus', function(done) {
          this.timeout(30000);

          walkChain(path, function(err, terminus) {
            if (err) {
              return done(err);
            }

            try {
              terminus.should.eql(RESOLVED[path], 'resolved reading of ' + path);
            }
            catch (assertion) {
              return done(assertion);
            }

            return done();
          });
        });
      });

      CORPUS.forEach(function(row) {
        it('GET ' + row.path + ' answers ' + row.status + ' with a ' + row.kind + ' body',
          function(done) {
            this.timeout(20000);

            get(row.path).end(function(err, response) {
              if (err) {
                return done(err);
              }

              try {
                assertEntry(row, response, 'GET ' + row.path);
              }
              catch (assertion) {
                return done(assertion);
              }

              done();
            });
          });
      });
    });

    // -----------------------------------------------------------------------------------------
    // The authenticated supplement, driven LIVE (review finding M5)
    // -----------------------------------------------------------------------------------------

    describe('the authenticated supplement, live (TR2, TR3, TR4)', function() {
      /**
       * The seven entries are issued in the ORDER the array declares, which is the order the base-commit
       * measurement was taken in, because the order is load-bearing: the session every GET below asserts
       * against is the one entry [0]'s POST /login hands back, and entry [6]'s GET /logout destroys it.
       *
       * Every request below is sent through a THROWAWAY slot with the cookie supplied explicitly rather
       * than through a slot's cookie jar. That is not a stylistic choice: lib/controllers/users.js#login
       * calls `request.yar.reset()` on success, which rotates the session id and invalidates whatever
       * cookie the request arrived with. A slot-based flow therefore hands the four GETs a cookie that
       * entry [0] has already killed - which is precisely how an earlier revision of this block came to
       * assert the UNAUTHENTICATED outcomes (200 for /login, 302 for /home) while looking authenticated.
       */
      before(function(done) {
        this.timeout(30000);

        parityCookie = null;
        flow.switchUser('parity-login-ok');
        post('/login', { email : defaults.parity.email, password : defaults.parity.password })
          .end(function(err, response) {
            if (err) { return done(err); }

            parityCookie = response.headers['set-cookie'];
            loginResponse = response;

            return done();
          });
      });

      it('POST /login with valid credentials answers 302 to the declared success.redirect', function() {
        assertEntry(AUTHENTICATED[0], loginResponse, AUTHENTICATED[0].label);
      });

      it('handed back a sealed session cookie for the rest of this block to use', function() {
        should.exist(parityCookie);

        var pair = String([].concat(parityCookie)[0]).split(';')[0];

        pair.indexOf(COOKIE_NAME + '=').should.eql(0);
        pair.slice((COOKIE_NAME + '=').length).indexOf(COOKIE_SEAL).should.eql(0);
      });

      it('POST /login with a wrong password answers 302 to the declared fail.redirect',
        function(done) {
          this.timeout(30000);

          // Its own throwaway slot, and no cookie: a failed login must not be able to disturb the session
          // the four probes below run under.
          flow.switchUser('parity-wrong-password');
          post('/login', { email : defaults.parity.email, password : 'not-the-password' })
            .end(function(err, response) {
              if (err) { return done(err); }

              try {
                assertEntry(AUTHENTICATED[1], response, AUTHENTICATED[1].label);
              }
              catch (assertion) { return done(assertion); }

              return done();
            });
        });

      [
        { path : '/login',   entry : AUTHENTICATED[2] },
        { path : '/signup',  entry : AUTHENTICATED[3] },
        { path : '/home',    entry : AUTHENTICATED[4] },
        { path : '/account', entry : AUTHENTICATED[5] }
      ].forEach(function(probe) {
        it(probe.entry.label + ' answers ' + probe.entry.status, function(done) {
          this.timeout(30000);

          getWithCookie(probe.path, parityCookie).end(function(err, response) {
            if (err) { return done(err); }

            try {
              assertEntry(probe.entry, response, probe.entry.label);
            }
            catch (assertion) { return done(assertion); }

            return done();
          });
        });
      });

      /**
       * A negative control for the pair above: the SAME two paths, with no cookie, answer 200 instead of
       * 500. Without this, a session that silently failed to attach would turn entries [2] and [3] into a
       * false green, because 200 is exactly what an unauthenticated GET /login answers.
       */
      it('answers 200 for the same two paths when the session cookie is absent', function(done) {
        this.timeout(30000);

        flow.switchUser('');
        get('/login').end(function(err, login) {
          if (err) { return done(err); }

          return get('/signup').end(function(signupErr, signup) {
            if (signupErr) { return done(signupErr); }

            try {
              login.statusCode.should.eql(200, 'unauthenticated GET /login');
              signup.statusCode.should.eql(200, 'unauthenticated GET /signup');
              AUTHENTICATED[2].status.should.eql(500);
              AUTHENTICATED[3].status.should.eql(500);
            }
            catch (assertion) { return done(assertion); }

            return done();
          });
        });
      });

      // LAST, because it destroys the session every test above depends on.
      it('GET /logout authenticated answers 302 to the site root and rewrites the cookie',
        function(done) {
          this.timeout(30000);

          getWithCookie('/logout', parityCookie).end(function(err, response) {
            if (err) { return done(err); }

            try {
              assertEntry(AUTHENTICATED[6], response, AUTHENTICATED[6].label);
            }
            catch (assertion) { return done(assertion); }

            return done();
          });
        });
    });

    // -----------------------------------------------------------------------------------------
    // The roles-token crypto parity contract (F7)
    // -----------------------------------------------------------------------------------------

    describe('the roles-token crypto parity contract (F7)', function() {
      var payload = [{ context : 'site', roles : ['user'], permissions : ['create-python-trinket'] }];

      it('joins a 32-character lowercase hex passphrase to an OpenSSL base64 envelope', function() {
        var token  = roles.encrypt(payload),
            parts  = token.split('+'),
            hex    = parts[0],
            base64 = parts.slice(1).join('+');

        hex.should.match(/^[0-9a-f]{32}$/);
        hex.length.should.eql(ROLES_TOKEN.hexLength);
        base64.indexOf(ROLES_TOKEN.envelopeBase64Prefix).should.eql(0);
        Buffer.from(base64, 'base64').slice(0, 8).toString('latin1').should.eql(ROLES_TOKEN.magic);
      });

      it('round-trips exactly as public/js/trinket-roles.js:L7-L11 splits and decrypts it', function() {
        var token = roles.encrypt(payload),
            value = token.split('+'),
            key   = value[0],
            body  = value.slice(1).join('+'),
            clear = CryptoJS.enc.Utf8.stringify(CryptoJS.AES.decrypt(body, key));

        JSON.parse(clear).should.eql(payload);
      });

      /**
       * The ciphertext length is a deterministic function of the plaintext length — AES-CBC with PKCS#7
       * padding behind a 16-byte OpenSSL salt header — which is what makes the length safe to assert
       * rather than something that has to be normalized away.
       */
      it('encodes a deterministic ciphertext length for a fixed plaintext length', function() {
        [0, 1, 15, 16, 17, 48, 199].forEach(function(length) {
          var plain    = new Array(length + 1).join('x'),
              base64   = roles.encrypt(plain).split('+').slice(1).join('+'),
              raw      = Buffer.from(base64, 'base64'),
              expected = 16 + (Math.floor(length / 16) + 1) * 16;

          raw.length.should.eql(expected);
          base64.length.should.eql(Math.ceil(expected / 3) * 4);
        });
      });

      it('produces a fresh salt on every render, which is why the token is normalized in a capture',
        function() {
          roles.encrypt(payload).should.not.eql(roles.encrypt(payload));
        });
    });

    // -----------------------------------------------------------------------------------------
    // The `next` destination contract (P3-1 and the preserved open redirect)
    // -----------------------------------------------------------------------------------------

    describe('the `next` destination contract (P3-1, TR2, TR4)', function() {
      var absolute    = appOrigin() + ASSIGNMENT.destinationPath,
          credentials = { email : defaults.parity.email, password : defaults.parity.password };

      /**
       * The `defaults.parity` account this block logs in as is created and removed by the OUTER block, so
       * nothing here owns it. The only fixture this block owns is the signup identity, which it removes
       * both before and after so a half-finished earlier run cannot make `POST /users` fail on a duplicate.
       */
      before(function(done) {
        this.timeout(60000);

        removeSignupUser(done);
      });

      after(function(done) {
        this.timeout(60000);

        removeSignupUser(done);
      });

      function removeSignupUser(done) {
        User.findByLogin(ASSIGNMENT.signup.email, function(err, doc) {
          if (err || !doc) { return done(err); }

          doc.remove(function(removeErr) { done(removeErr); });
        });
      }

      /** `/<page>?next=<percent-encoded candidate>`, exactly as trinketConfig.getUrl builds it. */
      function entryPath(page, candidate) {
        return page + '?next=' + encodeURIComponent(candidate);
      }

      /**
       * Persists a destination through an entry page on a FRESH session, then consumes it on that same
       * session.
       *
       * Both halves are asserted rather than assumed. The entry GET must answer the expected status AND
       * must hand back a session cookie - without one there is no session for `next` to have been written
       * into, so a flow that never reached the persisting branch would silently "agree" with every
       * expectation below while proving nothing. The cookie is then threaded into the consuming POST
       * explicitly, which is what makes the two requests provably one session.
       *
       * @param   {string}  page        The entry page path, e.g. '/login'.
       * @param   {string}  candidate   The raw destination to hand it as ?next=.
       * @param   {string}  action      The consuming path, e.g. '/login' or '/users'.
       * @param   {Object}  body        The payload for the consuming POST.
       * @param   {number=} entryStatus The status the entry GET must answer; defaults to 200.
       * @returns {Promise.<Object>} The consuming response.
       */
      function driveFlow(page, candidate, action, body, entryStatus) {
        return new Promise(function(resolve, reject) {
          // The empty slot attaches no cookie, so the entry GET always lands on a brand-new session.
          flow.switchUser('');
          get(entryPath(page, candidate)).end(function(err, entry) {
            if (err) { return reject(err); }

            try {
              entry.statusCode.should.eql(entryStatus || 200, 'entry status for ' + page);
              should.exist(entry.headers['set-cookie'],
                           page + ' must open a session for `next` to be persisted into');
            }
            catch (assertion) {
              return reject(assertion);
            }

            return postWithCookie(action, body, entry.headers['set-cookie'])
              .end(function(postErr, consumed) {
                return postErr ? reject(postErr) : resolve(consumed);
              });
          });
        });
      }

      function loginWith(candidate) {
        return driveFlow('/login', candidate, '/login', credentials);
      }

      function signupWith(candidate) {
        return new Promise(function(resolve, reject) {
          removeSignupUser(function(err) {
            return err ? reject(err) : resolve();
          });
        }).then(function() {
          return driveFlow('/signup', candidate, '/users', {
            formName : ASSIGNMENT.signup.formName,
            fullname : ASSIGNMENT.signup.fullname,
            username : ASSIGNMENT.signup.username,
            email    : ASSIGNMENT.signup.email,
            password : ASSIGNMENT.signup.password,
            next     : candidate
          });
        });
      }

      describe('the frozen producer this contract exists for', function() {
        it('still sends an encodeURIComponent-escaped absolute href as ?next=', function() {
          var producer = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', '..', 'public', 'partials', 'directives',
                                 'trinket-assignment.js'), 'utf8');

          // If any of these three stops being true the producer has changed shape and this contract has
          // to be re-measured rather than trusted.
          producer.should.contain('window.encodeURIComponent');
          producer.should.contain('?next=');
          producer.should.contain('$window.location.href');
        });
      });

      it('POST /login answers 302 to a same-origin absolute destination, query and fragment included',
        function() {
          this.timeout(30000);

          return loginWith(absolute).then(function(response) {
            response.statusCode.should.eql(302);
            response.headers.location.should.eql(absolute);
            // Not the declared success.redirect: that is the regression this test exists to catch.
            response.headers.location.should.not.eql(appOrigin() + '/home');
            cookieAttributes(response).should.eql(COOKIE_ROUTE);
          });
        });

      it('POST /login echoes a root-relative destination unchanged, still relative', function() {
        this.timeout(30000);

        return loginWith(ASSIGNMENT.rootRelative).then(function(response) {
          response.statusCode.should.eql(302);
          response.headers.location.should.eql(ASSIGNMENT.rootRelative);
        });
      });

      it('POST /users answers 302 to the same destination rather than to /welcome', function() {
        this.timeout(30000);

        return signupWith(absolute).then(function(response) {
          response.statusCode.should.eql(302);
          response.headers.location.should.eql(absolute);
          response.headers.location.should.not.eql(appOrigin() + '/welcome');
        });
      });

      it('falls back to the declared success.redirect when nothing was persisted', function(done) {
        this.timeout(30000);

        flow.switchUser('');
        post('/login', credentials).end(function(err, response) {
          if (err) { return done(err); }

          response.statusCode.should.eql(302);
          response.headers.location.should.eql(appOrigin() + '/home');
          done();
        });
      });

      /**
       * THE PRESERVED OPEN REDIRECT (docs/PRESERVED-QUIRKS.md section 4.4).
       *
       * Every candidate is echoed straight back into the Location, byte-for-byte, because `next` is
       * persisted and read verbatim - which is what the base commit did. An intermediate revision
       * filtered these to same-origin destinations and this block asserted the refusals; code review
       * rejected that under R-1 (an open-redirect repair is not one of the four sanctioned diff
       * categories), R-4 (it changed emitted Location values) and R-6 (excluding three of the cases from
       * the parity corpus let a behavior-changing build report parity). Three of these shapes are now
       * ordinary replayed legs of test/baseline/responses.json#assignmentNext as well; the other four are
       * pinned only here, so the echo cannot narrow silently on any shape.
       */
      describe('a destination is echoed back verbatim, whatever shape it has', function() {
        ECHOED_DESTINATIONS.forEach(function(echoed) {
          it('POST /login echoes ' + echoed.label + ' unchanged', function() {
            this.timeout(30000);

            return loginWith(echoed.candidate).then(function(response) {
              response.statusCode.should.eql(302);
              response.headers.location.should.eql(echoed.candidate);
              response.headers.location.should.not.eql(appOrigin() + '/home');
            });
          });
        });

        it('POST /users echoes an off-origin absolute URL rather than /welcome', function() {
          this.timeout(30000);

          return signupWith('https://evil.example/steal').then(function(response) {
            response.statusCode.should.eql(302);
            response.headers.location.should.eql('https://evil.example/steal');
            response.headers.location.should.not.eql(appOrigin() + '/welcome');
          });
        });
      });

      /**
       * The OAuth leg. GET /auth/google returns before it reaches `next` when
       * config.app.auth.google.clientID is null, which is the shipped configuration and the outcome the
       * corpus records. The persistence leg is driven with the three credential keys set for the duration
       * of this block and restored afterwards, so no YAML is edited and no other suite sees the change.
       */
      describe('the OAuth persistence leg', function() {
        var google   = config.app.auth.google,
            original = {};

        before(function() {
          original = {
            clientID     : google.clientID,
            clientSecret : google.clientSecret,
            callbackURL  : google.callbackURL
          };
          google.clientID     = 'route-parity-client-id.apps.googleusercontent.com';
          google.clientSecret = 'route-parity-client-secret';
          google.callbackURL  = appOrigin() + '/auth/google/callback';
        });

        after(function() {
          google.clientID     = original.clientID;
          google.clientSecret = original.clientSecret;
          google.callbackURL  = original.callbackURL;
        });

        it('answers 200 with no Location under the SHIPPED configuration', function(done) {
          this.timeout(30000);

          var saved = google.clientID;

          google.clientID = original.clientID;
          flow.switchUser('');
          get(entryPath('/auth/google', absolute)).end(function(err, response) {
            google.clientID = saved;

            if (err) { return done(err); }

            // The preserved failure-responder quirk: no fail.redirect and no fail.html, so a 200 with a
            // { flash, message } body comes back.
            response.statusCode.should.eql(200);
            should.not.exist(response.headers.location);
            Object.keys(response.body).sort().should.eql(['flash', 'message']);
            done();
          });
        });

        it('redirects to Google itself, which is deliberately NOT confined to this origin',
          function(done) {
            this.timeout(30000);

            flow.switchUser('');
            get(entryPath('/auth/google', absolute)).end(function(err, response) {
              if (err) { return done(err); }

              // lib/http/redirect.js does not confine declarative redirects, precisely so this one still
              // reaches accounts.google.com.
              response.statusCode.should.eql(302);
              response.headers.location.indexOf('https://accounts.google.com/o/oauth2/v2/auth?')
                .should.eql(0);
              done();
            });
          });

        it('persists a same-origin absolute destination and hands it back byte-for-byte', function() {
          this.timeout(30000);

          return driveFlow('/auth/google', absolute, '/login', credentials, 302)
            .then(function(response) {
              response.statusCode.should.eql(302);
              response.headers.location.should.eql(absolute);
            });
        });

        it('persists an off-origin destination too, and hands it back unchanged', function() {
          this.timeout(30000);

          // The preserved open redirect reaches the OAuth entry point as well: GET /auth/google stores
          // request.query.next verbatim, and whichever consumer reads the session slot next emits it.
          return driveFlow('/auth/google', 'https://evil.example/steal', '/login',
                           credentials, 302)
            .then(function(response) {
              response.statusCode.should.eql(302);
              response.headers.location.should.eql('https://evil.example/steal');
            });
        });

        it('answers the declared fail.redirect when the callback arrives with no code', function(done) {
          this.timeout(30000);

          flow.switchUser('');
          get('/auth/google/callback').end(function(err, response) {
            if (err) { return done(err); }

            response.statusCode.should.eql(302);
            response.headers.location.should.eql(appOrigin() + '/signup');
            done();
          });
        });
      });
    });
  });
};
