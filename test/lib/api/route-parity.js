var chai     = require('chai'),
    should   = chai.should(),
    crypto   = require('crypto'),
    fs       = require('fs'),
    path     = require('path'),
    CryptoJS = require('crypto-js'),
    config   = require('config'),
    roles    = require('../../../lib/util/roles'),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults'),
    app      = require('../../../app.js');

/**
 * Baseline route parity, asserted from inside `npm test` — SELF-CONTAINED.
 *
 * This suite pins the route table against the documented anchor, and asserts status, content type, body
 * shape, Location and Set-Cookie attributes for every one of the 58 parameterless GET routes plus the whole
 * authenticated supplement and the whole `next`-destination contract.
 *
 * INDEPENDENCE. This file requires NEITHER test/baseline/capture.js NOR test/baseline/replay.js, and loads
 * NEITHER committed JSON artifact. Every expectation below is a literal in this file, and every helper it
 * needs — the corpus selection rule, the canonical row builder, the three fingerprints, the title extractor,
 * the Set-Cookie attribute reader — is implemented here. That is the whole point: the CLI harness and this
 * suite are two INDEPENDENT verifiers of the same behavior, so a defect in the harness's canonicalization
 * cannot make this suite pass, and vice versa.
 *
 * WHAT IT PINS ABOUT THE ROUTE TABLE. Independence is only worth having if the independent check is as
 * strong as the one it corroborates, so nothing here is weakened into a count: from the live server and from
 * literals in this file it pins the exact sorted 233-row canonical set row for row (CANONICAL_ROWS_SORTED),
 * the FULL registration order derived from config.routes, and all three fingerprints — sha256 and md5 of the
 * sorted set and sha256 of the registration order (ROUTE_TABLE_FINGERPRINTS) — alongside the eleven
 * documented-anchor clauses, the last of which RECOMPUTES the sorted sha256 from the live table rather than
 * comparing two stored strings. A middle-order permutation, or a swap that left every countable gate
 * balanced, therefore fails here.
 *
 * TRANSPORT. Every request goes through `flow`, the suite's own harness, which issues real HTTP over an
 * ephemeral socket against the booted server's listener. `server.inject()` is never used here, for the same
 * reason the CLI harness avoids it: @hapi/shot is the last remaining DEP0169 source in the tree. That is a
 * rule about this suite, not a claim about the application — lib/controllers/courses.js and
 * lib/controllers/folders.js both perform internal sub-requests with request.server.inject().
 *
 * ISOLATION. The unauthenticated corpus is driven through the empty cookie slot (`flow.switchUser('')`),
 * which attaches no cookie at all. The authenticated supplement is driven through a slot of this suite's
 * own, `defaults.parity`, created here and removed here, so it neither consumes nor disturbs the session
 * state the earlier suites share. `flow.activeUser` is restored when the suite finishes.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED. HTML body digests. This suite runs inside `npm test`, where the
 * database carries whatever the preceding suites left behind, so a leftover course or user can legitimately
 * change rendered markup without changing any behavior under test. Digests are test/baseline/replay.js's job,
 * on a clean capture. What IS asserted here is everything that is a pure function of routing, configuration
 * and templates: the status, the content type, the body kind, the exact JSON bodies, the HTML <title> and
 * structural markers, the literal Location and the Set-Cookie attribute set.
 */

// The documented route-table anchor, as literals

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

/**
 * The three authoritative fingerprints route-table.json publishes, as literals.
 *
 * All three are recomputed here from the live server, in this file, with node:crypto — the same recipe
 * route-table.json#canonicalization publishes and the same one test/baseline/replay.js applies, arrived at
 * independently because this suite shares no code with the harness and loads no artifact. A uniqueness count
 * or a first-two/last-two order check would not do: either would accept a middle-order permutation or a swap
 * that kept every countable gate balanced.
 *
 * `sortedSha256` and `sortedMd5` hash the 233 canonical rows sorted with the default
 * Array.prototype.sort() and joined with "\n" and no trailing newline. `registrationOrderSha256` hashes the
 * same rows in REGISTRATION order - the order of `config.routes`, which is the array app.js hands to
 * server.route() - because server.table() returns router order instead.
 */
var ROUTE_TABLE_FINGERPRINTS = {
  sortedSha256            : '452116ce74301c61c92efb36fe8ead987b6a9e81d83a28af335c8d08fa1d64a8',
  sortedMd5               : 'dfc1e295156ecdbbee4a073b231b9326',
  registrationOrderSha256 : '6a65d18273c731aa070cf905625a9dfe4789caf066dde0c5beb14c6dd8131898'
};

/**
 * The auth descriptor each single-letter code below stands for. Three codes cover all 233 rows because the
 * table has exactly three auth shapes: 105 rows requiring the session strategy, 126 inheriting the server
 * default, and the 2 rows that disable authentication outright.
 */
var DESCRIPTOR_CODES = {
  R : 'mode=required strategies=["session"]',
  T : 'mode=try strategies=["session"]',
  F : 'false'
};

/**
 * THE EXACT 233-ROW CANONICAL SET, in sorted order, as literals.
 *
 * This is the row set the documented digest stands for, and it is pinned here row for row rather than
 * summarized, because a distinct-row COUNT would accept any permutation, any renamed path and any changed
 * auth mode as long as the total stayed 233.
 *
 * Each entry is `METHOD path CODE preCount`, expanded by expandCanonicalRow() into the
 * "METHOD | path | descriptor | preCount" form route-table.json#canonicalization specifies. The compact
 * encoding exists only so that every row fits the repository's 120-column limit; nothing is abbreviated
 * away, and the expansion is asserted to reproduce its own sorted order so the literal cannot be
 * re-ordered without failing.
 */
var CANONICAL_ROWS_SORTED = [
  'DELETE /api/admin/featured-course/{courseId} R 1',
  'DELETE /api/courses/{courseId} R 1',
  'DELETE /api/courses/{courseId}/invitations/{invitationId} R 1',
  'DELETE /api/courses/{courseId}/lessons/{lessonId} R 3',
  'DELETE /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId} R 5',
  'DELETE /api/courses/{courseId}/users/{userId} R 1',
  'DELETE /api/drafts/{trinketId} R 1',
  'DELETE /api/folders/{folderId} R 1',
  'DELETE /api/trinkets/{lang}/list/{shortCode} T 2',
  'DELETE /api/trinkets/{trinketId} R 2',
  'DELETE /api/trinkets/{trinketId}/folder R 2',
  'DELETE /api/users R 0',
  'DELETE /api/users/assets/{fileId} R 1',
  'GET / T 0',
  'GET /.well-known/{path*} T 0',
  'GET /R T 2',
  'GET /R/ T 2',
  'GET /R/{shortCode} T 3',
  'GET /R/{shortCode}/ T 1',
  'GET /R/{shortCode}/{path*} T 1',
  'GET /about T 0',
  'GET /account R 0',
  'GET /account-deleted T 0',
  'GET /account/{accountPage} R 0',
  'GET /activate-account T 0',
  'GET /admin R 1',
  'GET /admin/{adminPage*} R 1',
  'GET /api/classes/{userSlug}/{courseSlug} T 3',
  'GET /api/courses R 0',
  'GET /api/courses/{courseId} T 2',
  'GET /api/courses/{courseId}/accessCode R 1',
  'GET /api/courses/{courseId}/dashboard R 1',
  'GET /api/courses/{courseId}/invitations R 1',
  'GET /api/courses/{courseId}/lessons/{lessonId} T 3',
  'GET /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId} T 5',
  'GET /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/dashboard R 1',
  'GET /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/submissions R 1',
  'GET /api/courses/{courseId}/users R 1',
  'GET /api/courses/{courseId}/users/{userId}/materials/{materialId}/submissions R 0',
  'GET /api/courses/{courseId}/users/{userId}/submissions R 2',
  'GET /api/exports R 0',
  'GET /api/exports/{exportId} R 0',
  'GET /api/exports/{exportId}/download R 0',
  'GET /api/featured-courses R 0',
  'GET /api/files/{fileId}/{fileName} T 1',
  'GET /api/folders R 0',
  'GET /api/folders/{folderId}/trinkets R 1',
  'GET /api/submissions/{materialId} R 0',
  'GET /api/trinkets R 0',
  'GET /api/trinkets/active T 2',
  'GET /api/trinkets/popular T 2',
  'GET /api/trinkets/search R 0',
  'GET /api/trinkets/{lang}/list T 1',
  'GET /api/trinkets/{trinketId} T 1',
  'GET /api/trinkets/{trinketId}/interactions T 1',
  'GET /api/users/assets T 0',
  'GET /api/users/resendEmailChange R 0',
  'GET /api/users/{userId}/avatar T 1',
  'GET /api/users/{userId}/info T 1',
  'GET /assignment-embed-feedback/{lang}/{trinketId} R 3',
  'GET /assignment-embed-viewonly/{lang}/{trinketId} T 3',
  'GET /assignment-embed/{lang}/{trinketId} R 3',
  'GET /auth/google F 0',
  'GET /auth/google/callback F 0',
  'GET /blocks T 2',
  'GET /blocks/ T 2',
  'GET /blocks/{shortCode} T 3',
  'GET /blocks/{shortCode}/ T 1',
  'GET /blocks/{shortCode}/{path*} T 1',
  'GET /cache-prefix-{timestamp}/{assetType}/{path*} T 0',
  'GET /change-email T 0',
  'GET /console T 2',
  'GET /console/ T 2',
  'GET /console/{shortCode} T 3',
  'GET /console/{shortCode}/ T 1',
  'GET /console/{shortCode}/{path*} T 1',
  'GET /courses/accept/{token} T 1',
  'GET /courses/join/{accessCode} T 1',
  'GET /courses/new R 1',
  'GET /docs/colors T 0',
  'GET /embed/beta/{type} T 1',
  'GET /embed/blocks-iframe T 0',
  'GET /embed/glowscript-blocks-iframe T 0',
  'GET /embed/{lang} T 3',
  'GET /embed/{lang}/{trinketId} T 3',
  'GET /forgot-pass T 0',
  'GET /glowscript T 2',
  'GET /glowscript-blocks T 2',
  'GET /glowscript-blocks/ T 2',
  'GET /glowscript-blocks/{shortCode} T 3',
  'GET /glowscript-blocks/{shortCode}/ T 1',
  'GET /glowscript-blocks/{shortCode}/{path*} T 1',
  'GET /glowscript/ T 2',
  'GET /glowscript/{shortCode} T 3',
  'GET /glowscript/{shortCode}/ T 1',
  'GET /glowscript/{shortCode}/{path*} T 1',
  'GET /help T 0',
  'GET /home R 0',
  'GET /html T 2',
  'GET /html/ T 2',
  'GET /html/{shortCode} T 3',
  'GET /html/{shortCode}/ T 1',
  'GET /html/{shortCode}/{path*} T 1',
  'GET /java T 2',
  'GET /java/ T 2',
  'GET /java/{shortCode} T 3',
  'GET /java/{shortCode}/ T 1',
  'GET /java/{shortCode}/{path*} T 1',
  'GET /library/folder/{slug} R 0',
  'GET /library/trinkets/{path*} T 1',
  'GET /login T 0',
  'GET /logout T 0',
  'GET /music T 2',
  'GET /music/ T 2',
  'GET /music/{shortCode} T 3',
  'GET /music/{shortCode}/ T 1',
  'GET /music/{shortCode}/{path*} T 1',
  'GET /pygame T 2',
  'GET /pygame/ T 2',
  'GET /pygame/{shortCode} T 3',
  'GET /pygame/{shortCode}/ T 1',
  'GET /pygame/{shortCode}/{path*} T 1',
  'GET /python T 2',
  'GET /python/ T 2',
  'GET /python/{shortCode} T 3',
  'GET /python/{shortCode}/ T 1',
  'GET /python/{shortCode}/{path*} T 1',
  'GET /python3 T 2',
  'GET /python3/ T 2',
  'GET /python3/{shortCode} T 3',
  'GET /python3/{shortCode}/ T 1',
  'GET /python3/{shortCode}/{path*} T 1',
  'GET /r T 0',
  'GET /r/{shortCode} T 0',
  'GET /reset-pass T 0',
  'GET /signup T 0',
  'GET /skulpt T 0',
  'GET /skulpt/{hash} T 0',
  'GET /tools/{version}/jekyll/embed/{lang} T 2',
  'GET /u/{username}/classes T 2',
  'GET /u/{username}/classes/{courseSlug} T 3',
  'GET /verify-email T 0',
  'GET /vpython T 0',
  'GET /vpython/{shortCode} T 0',
  'GET /webvpython T 0',
  'GET /webvpython/{shortCode} T 0',
  'GET /welcome R 0',
  'GET /{path*} T 0',
  'GET /{userSlug}/courses/{courseSlug} T 3',
  'GET /{userSlug}/courses/{courseSlug}/download.zip R 3',
  'PATCH /api/courses/{courseId} R 1',
  'POST /activate-account T 0',
  'POST /admin/upload R 1',
  'POST /api/admin/featured-course R 1',
  'POST /api/admin/featured-course/move R 1',
  'POST /api/admin/user/{userId} R 1',
  'POST /api/admin/user/{userId}/grant R 1',
  'POST /api/comments/{trinketId} R 1',
  'POST /api/courses R 0',
  'POST /api/courses/join R 0',
  'POST /api/courses/{courseId}/accessCode R 1',
  'POST /api/courses/{courseId}/copy R 1',
  'POST /api/courses/{courseId}/invitations R 1',
  'POST /api/courses/{courseId}/lessons R 1',
  'POST /api/courses/{courseId}/lessons/{lessonId}/materials R 3',
  'POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/acceptSubmission R 2',
  'POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/feedback R 1',
  'POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/startAssignment R 0',
  'POST /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/submissions R 0',
  'POST /api/courses/{courseId}/roles R 1',
  'POST /api/courses/{courseId}/userLookup R 1',
  'POST /api/courses/{courseId}/users R 1',
  'POST /api/courses/{courseId}/views R 1',
  'POST /api/exports R 0',
  'POST /api/feedback-comments/{trinketId} R 1',
  'POST /api/files/{fileId}/thumbnail T 1',
  'POST /api/folders R 0',
  'POST /api/interest T 0',
  'POST /api/ohnoes T 0',
  'POST /api/submission-opt/{trinketId} R 1',
  'POST /api/submissions/{trinketId} R 1',
  'POST /api/trinkets T 0',
  'POST /api/trinkets/clientmetric T 0',
  'POST /api/trinkets/codeerror T 1',
  'POST /api/trinkets/download T 0',
  'POST /api/trinkets/{shortCode}/list T 2',
  'POST /api/trinkets/{trinketId}/autosave R 1',
  'POST /api/trinkets/{trinketId}/draft R 0',
  'POST /api/trinkets/{trinketId}/email T 2',
  'POST /api/trinkets/{trinketId}/folder R 2',
  'POST /api/trinkets/{trinketId}/forks T 1',
  'POST /api/trinkets/{trinketId}/grant R 3',
  'POST /api/trinkets/{trinketId}/snapshot T 1',
  'POST /api/users T 1',
  'POST /api/users/assetFromURL R 0',
  'POST /api/users/assets R 0',
  'POST /api/users/assets/restore R 1',
  'POST /api/users/assets/{fileId} R 1',
  'POST /api/users/email R 1',
  'POST /api/users/login T 2',
  'POST /api/users/password R 0',
  'POST /api/users/settings R 0',
  'POST /api/users/settings/indentation R 0',
  'POST /api/users/settings/lineWrapping R 0',
  'POST /api/users/verify-email R 0',
  'POST /courses R 1',
  'POST /file R 0',
  'POST /file/avatar R 0',
  'POST /login T 1',
  'POST /python T 0',
  'POST /save-pass T 0',
  'POST /send-pass-reset T 1',
  'POST /users T 1',
  'POST /{userSlug}/courses/{courseSlug}/copy R 3',
  'PUT /api/courses/{courseId}/invitations/{invitationId}/email R 2',
  'PUT /api/courses/{courseId}/invitations/{invitationId}/resend R 2',
  'PUT /api/courses/{courseId}/lessons/{lessonId}/draft R 3',
  'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/assignment R 5',
  'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/draft R 5',
  'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/move R 5',
  'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/name R 5',
  'PUT /api/courses/{courseId}/lessons/{lessonId}/materials/{materialId}/patchContent R 5',
  'PUT /api/courses/{courseId}/lessons/{lessonId}/move R 2',
  'PUT /api/courses/{courseId}/lessons/{lessonId}/name R 3',
  'PUT /api/courses/{courseId}/metadata R 1',
  'PUT /api/folders/{folderId}/name R 2',
  'PUT /api/trinkets/{trinketId}/code R 2',
  'PUT /api/trinkets/{trinketId}/description R 2',
  'PUT /api/trinkets/{trinketId}/metrics T 0',
  'PUT /api/trinkets/{trinketId}/name R 2',
  'PUT /api/trinkets/{trinketId}/published R 2',
  'PUT /api/trinkets/{trinketId}/slug R 2',
  'PUT /api/users/{userId} R 0'
];

// Request policy — the same policy the corpus below was recorded under

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
 * API request, which would move five of the seven session-required routes off their recorded takeover
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
 * THE 58-ROUTE UNAUTHENTICATED CORPUS, encoded here directly as literals.
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
  // The pre-existing 500: reproduced, never repaired.
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
 * THE RESOLVED READING, recorded rather than derived.
 *
 * Exactly the sixteen 302 rows above carry a Location chain, and this map records where each chain ENDS:
 * the terminal status, and the number of hops it takes to reach it. The values come from the running
 * application, which is the only way to get `/change-email` and `/verify-email` right — both take TWO hops,
 * because `{origin}/account/email` is itself a redirect to a parameterless page the corpus does not contain,
 * so no amount of walking the table above reaches their terminus.
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
 * THE AUTHENTICATED SUPPLEMENT, driven LIVE.
 *
 * Every entry below is issued here, in this order, against a session this suite established itself —
 * checking these values against a stored artifact alone would prove nothing about the running application.
 *
 * Entries [2] and [3] are the flagship preserved quirk: an AUTHENTICATED GET /login and GET /signup answer
 * HTTP 500 rendered as 50x.html, because lib/controllers/pages.js raises the internal error deliberately.
 * They must NOT become 302s. See docs/PRESERVED-QUIRKS.md section 1.1.
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

/** The session cookie contract, as literals. */
var COOKIE_NAME  = 'session';
var COOKIE_SEAL  = 'Fe26.2';

/** The `next` destination contract, including the preserved open redirect. */
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
 * The destination shapes `lib/http/redirect.js#internalDestination` REFUSES: each one falls through to the
 * route's declared fallback instead of reaching a Location header.
 *
 * The same-origin shapes are asserted separately and round-trip byte-for-byte, which is what keeps the
 * confinement gated in BOTH directions — a filter that also refused the absolute same-origin destination the
 * frozen assignment UI sends would fail those tests. None of the refused shapes appears anywhere in
 * test/baseline/responses.json: every recorded Location in the corpus is same-host or relative, so refusing
 * them contradicts no recorded datum. See docs/PRESERVED-QUIRKS.md section 4.4.
 */
var REFUSED_DESTINATIONS = [
  { label : 'an off-origin absolute URL',       candidate : 'https://evil.example/steal' },
  { label : 'a scheme-relative URL',            candidate : '//evil.example/steal' },
  { label : 'the backslash form of one',        candidate : '/\\evil.example/steal' },
  { label : 'a userinfo disguise',              candidate : 'https://trinket.dev@evil.example/x' },
  { label : 'a subdomain-suffix lookalike',     candidate : 'https://trinket.dev.evil.example/x' },
  { label : 'a javascript: scheme',             candidate : 'javascript:alert(1)' },
  { label : 'a bare relative value',            candidate : 'courses/algebra-1' }
];

/** The roles-token envelope invariants, as literals. */
var ROLES_TOKEN = {
  envelopeBase64Prefix : 'U2FsdGVkX1',
  magic                : 'Salted__',
  hexLength            : 32
};

// Helpers — implemented here rather than imported, so this suite stands on its own

/**
 * Expands one compact `METHOD path CODE preCount` literal into the canonical row form
 * route-table.json#canonicalization specifies: uppercase method, one ASCII space around every pipe,
 * `false` for auth:false and `mode=<mode> strategies=[...]` otherwise, then the pre-handler count.
 *
 * @param   {string} compact One entry of CANONICAL_ROWS_SORTED.
 * @returns {string} `"METHOD | path | descriptor | preCount"`.
 */
function expandCanonicalRow(compact) {
  var parts = String(compact).split(' ');

  return [parts[0], parts[1], DESCRIPTOR_CODES[parts[2]], parts[3]].join(' | ');
}

/** The 233 pinned rows, expanded. Computed once per call so no test can mutate another's expectation. */
function expectedCanonicalRowsSorted() {
  return CANONICAL_ROWS_SORTED.map(expandCanonicalRow);
}

/** sha256 of a canonical row list joined with "\n" and no trailing newline. */
function sha256Rows(rows) {
  return crypto.createHash('sha256').update(rows.join('\n'), 'utf8').digest('hex');
}

/** md5 of the same serialization, which route-table.json publishes beside the sha256. */
function md5Rows(rows) {
  return crypto.createHash('md5').update(rows.join('\n'), 'utf8').digest('hex');
}

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
 * The RESOLVED status of one corpus row, read off the RESOLVED map above. Rows with no chain resolve to
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

// The suite

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
     * rely on the account existing without either of them owning it. The callback form of `switchUser` looks
     * its slot name up in `defaults`, so it works only with a real `defaults` key — a slot name such as
     * 'parity-next' is valid only in the callback-free form, purely to select a cookie jar.
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

    // The registered route table

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
            byKey    = {},
            raw      = { 'undefined' : 0, 'object' : 0, 'false' : 0 };

        server.table().forEach(function(row) {
          var auth       = row.settings.auth,
              strategies = auth && (auth.strategies || (auth.strategy ? [auth.strategy] : null)),
              descriptor = auth === false
                ? 'false'
                : 'mode=' + ((auth && auth.mode) || fallback.mode) +
                  ' strategies=' + JSON.stringify(strategies || fallback.strategies);

          var entry = {
            method     : String(row.method).toUpperCase(),
            path       : row.path,
            descriptor : descriptor,
            preCount   : (row.settings.pre || []).length,
            canonical  : [String(row.method).toUpperCase(), row.path, descriptor,
                          String((row.settings.pre || []).length)].join(' | ')
          };

          rows.push(entry);
          // Keyed by "METHOD path" so the registration order can be recovered from config.routes below:
          // server.table() answers in ROUTER order, which is not the order the routes were registered in.
          byKey[entry.method + ' ' + entry.path] = entry;
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
          byKey         : byKey,
          raw           : raw,
          serverDefault : { mode : fallback.mode, strategies : (fallback.strategies || []).slice() },
          canonical     : rows.map(function(row) { return row.canonical; })
        };
      }

      /**
       * The FULL registration order, derived from `config.routes` — the array app.js passes to
       * server.route() — mapped onto the live canonical row for each declaration's (METHOD, path) key.
       *
       * A declaration that resolves to no live row is reported through `missing` rather than skipped,
       * because it would mean the router and the declaration list disagree, which is exactly the drift
       * this gate exists to catch.
       *
       * @returns {Object} `{ canonical : String[], missing : String[] }`.
       */
      function registrationOrderCanonical() {
        var live    = liveTable(),
            ordered = [],
            missing = [];

        config.routes.forEach(function(route) {
          [].concat(route.method).forEach(function(method) {
            var key = String(method).toUpperCase() + ' ' + route.path,
                row = live.byKey[key];

            if (!row) {
              missing.push(key);

              return;
            }

            ordered.push(row.canonical);
          });
        });

        return { canonical : ordered, missing : missing };
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
       * THE EXACT ROW SET. Not a count and not a uniqueness check: the 233 canonical rows, sorted, compared
       * row for row against the literals at the head of this file. A renamed path, a changed method, a changed
       * auth mode or a changed pre-handler count each fails here and names itself in the diff.
       */
      it('registers the exact sorted 233-row canonical set, row for row', function() {
        var expected = expectedCanonicalRowsSorted();

        // The literal block is asserted to BE its own sorted order, so it cannot be re-ordered by hand
        // into agreement with a re-ordered table.
        expected.should.eql(expected.slice().sort());
        expected.length.should.eql(DOCUMENTED_ANCHOR.rowCount);

        liveTable().canonical.slice().sort().should.eql(expected);
      });

      /**
       * THE FULL REGISTRATION ORDER, and all three authoritative fingerprints, recomputed here from the live
       * server with node:crypto.
       *
       * The head/tail assertion above proves the two synthesized pages come first and the two catch-alls
       * last; this proves every one of the 231 rows between them is still where it was. A middle-order
       * permutation changes registrationOrderSha256 and nothing else, so only the full fingerprint sees it.
       */
      it('reproduces all three authoritative fingerprints, including the full registration order',
        function() {
          var sorted = liveTable().canonical.slice().sort(),
              order  = registrationOrderCanonical();

          order.missing.should.eql([]);
          order.canonical.length.should.eql(DOCUMENTED_ANCHOR.rowCount);

          sha256Rows(sorted).should.eql(ROUTE_TABLE_FINGERPRINTS.sortedSha256);
          md5Rows(sorted).should.eql(ROUTE_TABLE_FINGERPRINTS.sortedMd5);
          sha256Rows(order.canonical).should.eql(ROUTE_TABLE_FINGERPRINTS.registrationOrderSha256);

          // The published 32-character documented digest is NOT one of these and is never confused with
          // them: the first 32 characters of the sorted sha256 are recorded separately in the artifact and
          // are deliberately different from the Specification's literal (ADJ-4).
          ROUTE_TABLE_FINGERPRINTS.sortedSha256.slice(0, 32).should.not.eql(DOCUMENTED_DIGEST);
        });

      /**
       * THE DOCUMENTED ANCHOR, AS A MANDATORY GATE, computed here from literals and the live server.
       *
       * The frozen 32-character digest is retained verbatim as clause 1 and is never replaced by a computed
       * value; the remaining clauses are the substance it summarizes. Clause 11 is the one that DERIVES a
       * value — the sorted sha256, recomputed from the live rows under the artifact's published
       * canonicalization — so this gate cannot be satisfied without a digest having been computed from the
       * running server. Any drift lands in `failures` and fails this test, which is what makes it a gate
       * rather than a stored boolean being read back.
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
        // These two clauses carry their published meaning in full: the exact sorted row set, and the whole
        // registration order through its fingerprint. A distinct-row COUNT would pass any permutation and any
        // renamed path as long as the total stayed 233, and a first-two/last-two path check would pass any
        // middle-order permutation.
        clause('canonicalRowsTheDigestStandsFor', expectedCanonicalRowsSorted(),
               live.canonical.slice().sort());

        var order = registrationOrderCanonical();

        clause('registrationOrderContract',
               { unresolvedDeclarations : [],
                 fingerprint            : ROUTE_TABLE_FINGERPRINTS.registrationOrderSha256 },
               { unresolvedDeclarations : order.missing,
                 fingerprint            : sha256Rows(order.canonical) });

        // Clause 11 — the digest this gate RECOMPUTES.
        //
        // Clause 1 above compares the frozen 32-character literal to this suite's own copy of it, which
        // detects an edit to either but computes nothing; the published value is 32 characters where a sha256
        // is 64 and carries no serialization, so it cannot be recomputed at all (ADJ-4). Clause 11 is the
        // derivation: the LIVE table's canonical rows, sorted and joined with "\n" exactly as
        // route-table.json's `canonicalization` block publishes, hashed here with this file's own
        // sha256Rows() and compared against this file's own literal. Nothing is loaded from the artifact and
        // no harness code is shared, so a defect in capture.js#documentedAnchorGate cannot make this pass.
        // Both widths are checked together so a truncation cannot satisfy the long form.
        clause('measuredSha256RecomputedFromLiveTable',
               { measuredSha256        : ROUTE_TABLE_FINGERPRINTS.sortedSha256,
                 measuredSha256First32 : ROUTE_TABLE_FINGERPRINTS.sortedSha256.slice(0, 32) },
               { measuredSha256        : sha256Rows(live.canonical.slice().sort()),
                 measuredSha256First32 : sha256Rows(live.canonical.slice().sort()).slice(0, 32) });

        failures.should.eql([]);
        clauses.length.should.eql(11);
        clauses[0].name.should.eql('documentedDigestRetainedVerbatim');
        // The eleven clause NAMES this suite evaluates are the eleven route-table.json publishes, in that
        // order.
        clauses.map(function(entry) { return entry.name; }).should.eql([
          'documentedDigestRetainedVerbatim',
          'rowCount',
          'methods',
          'apiPaths',
          'withPreHandlers',
          'authRequiredSession',
          'authFalse',
          'authTryInherited',
          'canonicalRowsTheDigestStandsFor',
          'registrationOrderContract',
          'measuredSha256RecomputedFromLiveTable'
        ]);
      });
    });

    // The 58-route unauthenticated corpus, live

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

    // The authenticated supplement, driven LIVE

    describe('the authenticated supplement, live (TR2, TR3, TR4)', function() {
      /**
       * The seven entries are issued in the ORDER the array declares, and that order is load-bearing: the
       * session every GET below asserts against is the one entry [0]'s POST /login hands back, and entry
       * [6]'s GET /logout destroys it.
       *
       * Every request below is sent through a THROWAWAY slot with the cookie supplied EXPLICITLY rather than
       * through a slot's cookie jar. That is not a stylistic choice: lib/controllers/users.js#login calls
       * `request.yar.reset()` on success, which rotates the session id and invalidates whatever cookie the
       * request arrived with, so a slot-based flow would hand the four GETs a cookie entry [0] has already
       * killed — and they would then quietly assert the UNAUTHENTICATED outcomes (200 for /login, 302 for
       * /home) while looking authenticated.
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

    // The roles-token crypto parity contract

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

    // The cache-prefix {assetType} confinement contract

    /**
     * The one route whose confinement root is user-controlled. lib/http/staticRoutes.js returns
     * `'./public/' + request.params.assetType` as Inert's root, and {assetType} arrives PERCENT-DECODED after
     * route matching, so the guard there is what holds the served root inside ./public. The route is
     * `auth mode=try` with zero pre-handlers, so it is reachable unauthenticated.
     *
     * Both directions are asserted, so neither a missing guard nor an over-eager one can pass: every
     * traversal shape must answer 404, and the two positive controls must keep answering what a legitimate
     * asset URL answers. The literals below are declared IN THIS FILE and no artifact is loaded, so a defect
     * in the parity harness cannot make this suite pass; test/baseline/responses.json#assetConfinementContract
     * carries the same probes for the replay CLI, and the two are deliberately independent. See
     * docs/PRESERVED-QUIRKS.md section 4.1.
     */
    describe('the cache-prefix asset confinement contract (SEC-1, TR5)', function() {
      var PREFIX = '/' + config.app.cachePrefix + '1';

      var TRAVERSALS = [
        { label : 'the encoded-slash escape',        path : PREFIX + '/..%2fconfig/local.yaml' },
        { label : 'the fully encoded escape',        path : PREFIX + '/%2e%2e%2fconfig/local.yaml' },
        { label : 'the mixed literal/encoded form',  path : PREFIX + '/.%2e%2fpackage.json' },
        { label : 'the escape out of the checkout',
          path : PREFIX + '/..%2F..%2F..%2F..%2F..%2F..%2Fetc/passwd' },
        { label : 'the backslash form',              path : PREFIX + '/..%5cconfig/local.yaml' },
        { label : 'a traversal in the {path*} tail', path : PREFIX + '/js/../../config/local.yaml' }
      ];

      before(function() {
        flow.switchUser('');
      });

      it('allows exactly the eight configured app.prefixes keys, so no legitimate asset URL is refused',
        function() {
          // The allow-list is read from configuration rather than restated in the module, and public/
          // holds exactly six directories - every one of them a member. That superset relation is what
          // makes the refusal observably neutral, so it is asserted rather than argued.
          var configured = Object.keys(config.app.prefixes).sort(),
              onDisk     = fs.readdirSync(path.join(__dirname, '..', '..', '..', 'public'))
                             .filter(function(entry) {
                               return fs.statSync(path.join(__dirname, '..', '..', '..', 'public', entry))
                                        .isDirectory();
                             });

          configured.should.eql(['components', 'css', 'fonts', 'img', 'js', 'models', 'partials',
                                 'skulpt']);
          onDisk.forEach(function(directory) {
            configured.indexOf(directory).should.not.eql(-1, directory + ' is not in the allow-list');
          });
        });

      it('still serves a real file under a configured asset directory', function(done) {
        this.timeout(30000);

        get(PREFIX + '/js/trinket-config.js').end(function(err, response) {
          if (err) { return done(err); }

          try {
            response.statusCode.should.eql(200);
            response.text.length.should.be.above(0);
          }
          catch (assertion) { return done(assertion); }

          return done();
        });
      });

      it('answers 404 for an asset directory that does not exist, exactly as it did before the guard',
        function(done) {
          this.timeout(30000);

          get(PREFIX + '/nonexistentdir/x.js').end(function(err, response) {
            if (err) { return done(err); }

            try {
              response.statusCode.should.eql(404);
            }
            catch (assertion) { return done(assertion); }

            return done();
          });
        });

      TRAVERSALS.forEach(function(traversal) {
        it('refuses ' + traversal.label + ' with 404 and discloses nothing', function(done) {
          this.timeout(30000);

          get(traversal.path).end(function(err, response) {
            if (err) { return done(err); }

            try {
              response.statusCode.should.eql(404);
              // Two markers that would only appear if a file outside ./public had been served. They are
              // asserted on the BODY rather than inferred from the status, so a 404 that still carried file
              // bytes would fail.
              response.text.should.not.contain('cookieOptions');
              response.text.should.not.contain('root:x:0:0');
            }
            catch (assertion) { return done(assertion); }

            return done();
          });
        });
      });
    });

    // The `next` destination contract, including the preserved open redirect

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

          // If any of these three stops being true the producer has changed shape, and this contract has to
          // be re-derived from it rather than trusted.
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
       * THE REFUSED `next` DESTINATIONS. See docs/PRESERVED-QUIRKS.md section 4.4.
       *
       * `lib/http/redirect.js#internalDestination` refuses each of these shapes, so the handler takes the
       * SAME no-destination branch an absent `next` takes and the route's declared fallback answers instead
       * of the shape reaching a Location header.
       *
       * They are asserted HERE rather than in the corpus precisely because they are the cases that must NOT
       * replay: none of these shapes appears anywhere in test/baseline/responses.json, so the replay CLI
       * reports 0 differences whether they are refused or echoed, and only a live assertion can pin them.
       */
      describe('an off-origin destination is refused, leaving the declared fallback', function() {
        REFUSED_DESTINATIONS.forEach(function(refusal) {
          it('POST /login ignores ' + refusal.label, function() {
            this.timeout(30000);

            return loginWith(refusal.candidate).then(function(response) {
              response.statusCode.should.eql(302);
              response.headers.location.should.eql(appOrigin() + '/home');
              response.headers.location.should.not.contain('evil.example');
            });
          });
        });

        it('POST /users ignores an off-origin absolute URL', function() {
          this.timeout(30000);

          return signupWith('https://evil.example/steal').then(function(response) {
            response.statusCode.should.eql(302);
            response.headers.location.should.eql(appOrigin() + '/welcome');
            response.headers.location.should.not.contain('evil.example');
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

        it('does not persist an off-origin destination', function() {
          this.timeout(30000);

          // The filter covers the OAuth entry point as well: GET /auth/google refuses to store an
          // off-origin request.query.next at all, so whichever consumer reads the session slot next finds
          // nothing there and answers the declared fallback.
          return driveFlow('/auth/google', 'https://evil.example/steal', '/login',
                           credentials, 302)
            .then(function(response) {
              response.statusCode.should.eql(302);
              response.headers.location.should.eql(appOrigin() + '/home');
              response.headers.location.should.not.contain('evil.example');
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
