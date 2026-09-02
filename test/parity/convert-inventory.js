#!/usr/bin/env node
/**
 * Generator for docs/conversion-inventory.md -- the per-site completion
 * checklist for the callback-to-lifecycle conversion.
 *
 * Usage:
 *   node test/parity/convert-inventory.js [--app <path>] [--out <path>] [--verbose]
 *
 *   --app <path>   tree to analyse. Default: the repository root containing
 *                  this file. Point it at a `git worktree` to inventory the
 *                  baseline commit.
 *   --out <path>   document to write. Default: <repo>/docs/conversion-inventory.md
 *   --verbose      emit a one-screen summary on STDERR. Off by default (see
 *                  "Output discipline" below).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The claim "all 154 hapi-invoked functions were converted correctly" is not
 * inspectable as a number. In hapi 17+ every lifecycle method must return a
 * value, return a promise, or throw; `undefined` is turned into a server error
 * by the toolkit. The requirement that makes a conversion *correct* is that
 * each handler returns exactly once on every path -- and neither a
 * returned-but-unawaited chain nor an awaited-but-unreturned one is visible in
 * a signature count. Both are `async (request, h)` functions. Both pass any
 * grep for the new signature. Only one of them works.
 *
 * So the artifact has to be a per-site checklist, and this file generates it.
 *
 * WHY THE CONVERSION IS SAFELY ORDERABLE
 * --------------------------------------
 * The mechanism being removed is the response emulation in the route wrapper:
 *
 *     if (result === undefined) { result = await responsePromise; }
 *
 * at lib/util/routeParser.js:567-570 (baseline coordinates). It intercepts
 * ONLY an `undefined` result and passes any defined result straight through,
 * so a handler converted to return its response already works under the shim.
 * Converted and unconverted handlers coexist, which is what lets the work be
 * closed one row at a time -- and is what makes a per-site checklist the right
 * instrument rather than a big-bang cutover plan.
 *
 * Immediately BELOW that block, lib/util/routeParser.js:574-576 is a different
 * mechanism -- the `else` branch returning `request.success(request.params)`
 * when a route names a controller method that does not exist. Three registered
 * routes depend on it. The emulation goes; the fallback stays. This generator
 * emits those three routes as their own section precisely so nobody deletes
 * the fallback by association or hunts for a handler that was never written.
 *
 * ANALYSIS APPROACH
 * -----------------
 * The tree is read AS TEXT. Nothing here requires a controller, or
 * config/app.config, or anything under test/helpers or test/lib:
 * lib/controllers/users.js creates the exports queue at module load and loads
 * the AWS SDK, and a static generator has no business doing either.
 *
 * Reading JavaScript as text needs a real tokenizer, not a regex sweep. Three
 * measured hazards in this repository prove it:
 *
 *   1. config/routes.js and config/api_routes.js both contain
 *        Joi.string().min(3).regex(/^[\w`~!@#$%^&*+=:;'"<>,.?{}\-\/...]*$/)
 *      whose character class holds a single quote, a double quote AND a
 *      backtick. Measured: a naive string-stripper finds 10 `Joi.` references
 *      in config/routes.js where the correct answer is 36 -- a silent
 *      under-count of 26. The same bug would silently drop conversion sites,
 *      which is the failure mode this tool exists to prevent.
 *   2. Backticks appear where they are not template literals, and the counts
 *      make the failure mode concrete. config/routes.js and
 *      config/api_routes.js each hold a SINGLE, unpaired backtick -- inside
 *      the character class above -- so a scan that looks for template
 *      literals before it consumes regex literals finds no closing backtick
 *      and blanks everything to end-of-file: measured, 12891 of
 *      config/routes.js's 15120 characters, 85% of the file. Meanwhile
 *      lib/controllers/trinket.js:625 holds a PAIR of backticks inside a `//`
 *      comment, which such a scan would read as a template literal spanning
 *      the comment. Comments and regexes must therefore be consumed first.
 *   3. Regex literals and division share the `/` character, so the tokenizer
 *      has to decide between them from the preceding token.
 *
 * Hence `scrubSource()` below, and hence the delimiter-balance check that runs
 * over every scrubbed file: a desynchronized tokenizer produces wildly
 * unbalanced braces, so balance is a cheap and decisive self-test.
 *
 * OUTPUT DISCIPLINE
 * -----------------
 * The document is written ONLY to --out. Nothing is ever written to stdout.
 * On a successful run nothing is written to stderr either, because this
 * tooling's stderr sits inside the zero-deprecation-warning gate's captured
 * stream and a chatty tool would pollute it. Failures do report on stderr --
 * a failing run is not a gate run -- and --verbose opts in to a summary.
 *
 * `url.parse` is not used anywhere in this file (DEP0169). Nothing here needs
 * to parse a URL at all; paths are handled with node:path. If that ever
 * changes, use `new URL(...)`.
 *
 * Exit codes:
 *   0   document written
 *   1   usage error, or a tree that cannot be read
 *   2   SELF-CHECK FAILURE -- the analysis disagrees with the measured
 *       baseline in a way conversion cannot explain. No document is written.
 *       Failing loudly is the point: a quietly incomplete checklist is worse
 *       than no checklist, because it reads as completed work.
 */

'use strict';

var childProcess = require('node:child_process');
var fs = require('node:fs');
var path = require('node:path');

// ---------------------------------------------------------------------------
// SECTION 1 -- MEASURED BASELINE CONSTANTS
//
// Every figure below was measured on a worktree at the base commit named in
// BASELINE_COMMIT, using the very analysers in this file. They are recorded
// here rather than recomputed because their whole purpose is to be a fixed
// reference the analysis can be checked against: a figure that moves with the
// code it is supposed to police checks nothing.
//
// R-f makes the base commit the tie-breaker, so these are also the "current
// shape" column's authority.
// ---------------------------------------------------------------------------

var BASELINE_COMMIT = '2f8712a';

// The ten controllers, in the order used for every table in the document.
// Ordering is by baseline handler count, descending, then alphabetically --
// fixed here so re-running shows rows closing rather than reshuffling.
var CONTROLLERS = [
  'course', 'trinket', 'users', 'admin', 'courses',
  'pages', 'folders', 'classes', 'files', 'auth'
];

// Handler exports per controller. 147 total. Conversion changes a function's
// signature and body; it neither adds nor removes an export. This makes the
// export census a TREE INVARIANT rather than a progress metric -- it must hold
// on the baseline tree and on a fully converted tree alike -- which is why it
// is the check that actually catches a tokenizer desync.
var BASELINE_EXPORTS = {
  course: 42, trinket: 34, users: 31, admin: 9, courses: 7,
  pages: 7, folders: 6, classes: 5, files: 4, auth: 2
};
var BASELINE_EXPORTS_TOTAL = 147;

// `reply(` call sites: 172 in controllers + 29 in lib/util/helpers.js + 1
// inline in config/api_routes.js = 202. Unlike the export census this is a
// PROGRESS metric: a converted tree legitimately has fewer.
var BASELINE_REPLY_SITES = {
  course: 63, users: 37, trinket: 35, classes: 13, folders: 7,
  admin: 6, files: 5, courses: 4, pages: 2, auth: 0
};
var BASELINE_REPLY_SITES_HELPERS = 29;
var BASELINE_REPLY_SITES_INLINE = 1;
var BASELINE_REPLY_SITES_TOTAL = 202;

// Promise-chain scale, reply-chain scale and stream-site scale. All progress
// metrics. The stream figure is the one the AAP flags as needing derivation
// rather than a grep: a crude pattern returns 10, and the documented rule in
// deriveStreamSites() returns 17 across four controllers.
var BASELINE_THEN_CALLS = 183;
var BASELINE_CATCH_CALLS = 85;
var BASELINE_TYPE_BYTES_CALLS = 13;
var BASELINE_STREAM_SITES = 17;
var BASELINE_STREAM_CONTROLLERS = { trinket: 11, files: 3, courses: 2, users: 1 };

// Row counts for the two derived categories, measured with the analysers in
// this file at the base commit. They are progress metrics like the ones
// above, and they are recorded for the same reason: without a reference
// figure, "42 callback boundaries" tells a reviewer nothing about whether 15
// were closed or 15 were dropped by a tokenizer fault.
var BASELINE_PROMISE_CHAINS = 129;
var BASELINE_PROMISE_CHAINS_OPEN = 39;
var BASELINE_CALLBACK_BOUNDARIES = 57;

// Coordinates the AAP cites for a site whose measured extent differs, so the
// row can carry the citation a reader will be searching for. The chain in
// `pages.home` is cited as `lib/controllers/pages.js:52`; measured at the base
// commit it spans :48-54 with the terminal `.catch(request.fail)` on :54.
// Both are shown -- the citation because every other document uses it, the
// measurement because it is what is true.
//
// The anchor is the ENCLOSING FUNCTION, not the line span. Anchoring on the
// span was tried and is wrong: once the file is edited the chain moves out
// from under the cited line -- measured, :48-54 becomes :65-71 in the
// converted tree -- and the citation silently disappears from the document
// exactly when a reader cross-referencing the AAP most needs it.
var AAP_CITED_CHAINS = [
  {
    file: 'lib/controllers/pages.js',
    enclosing: 'home',
    citedLine: 52,
    baselineSpan: '48-54'
  }
];

// The conversion set, derived from the binding graph rather than the export
// list. 145 routed handlers + 8 routed pre-handlers + 1 inline = 154.
var CONVERSION_SET = {
  routedHandlers: 145,
  routedPreHandlers: 8,
  inlinePreHandlers: 1,
  total: 154
};

// Deliberately NOT in the 154, each with its own section in the document.
var EXCLUDED_UNROUTED_EXPORTS = ['pages.features', 'admin.uploadForm'];
var EXCLUDED_UNROUTED_PRE_HANDLERS = ['toLowerCaseURI', 'logUnauth', 'trinketByOwnerAndSlug'];
var EXCLUDED_MISSING_BINDINGS = [
  { route: 'POST /api/interest', binding: 'pages.interest' },
  { route: 'GET /api/trinkets/popular', binding: 'trinket.mostActive' },
  { route: 'GET /api/trinkets/active', binding: 'trinket.risingActive' }
];

// Named pre-handlers in lib/util/helpers.js declared in the legacy
// `(request, reply)` idiom. 11 of them; 8 routed, 3 not.
//
// Two exports are deliberately absent from this list because they are ALREADY
// native lifecycle methods and so are not conversion work:
// `internals.lowerUserFields` (baseline :111) and `findFeaturedTrinkets`
// (baseline :397), both declared `(request, h)`. That exclusion is exactly
// what makes 11 = 8 routed + 3 unrouted close.
var BASELINE_NAMED_PRE_HANDLERS = 11;

// ---------------------------------------------------------------------------
// SECTION 2 -- THE ANCHORED ROSTER
//
// Eight reply chains, and they are NOT uniform. In the shim's response
// builder (lib/util/routeParser.js:375-405) `.type()` and `.bytes()` return
// the builder WITHOUT resolving the deferred, while `.code()`, `.header()`,
// `.redirect()` and `.view()` resolve it. So what a client actually receives
// depends on which chain method ran LAST -- and 13 `.type()`/`.bytes()` calls
// spread across 8 chains produce three different outcomes.
//
// That three-way classification is an EXECUTION-TIME measurement of the shim.
// No amount of reading the text tells you whether a given chain settled,
// because the answer depends on the order the builder's methods ran in. The
// roster is therefore carried here as a recorded baseline fact (AAP 0.6.6),
// and each entry is VERIFIED against the analysed tree with an open/closed
// determination rather than re-derived from it.
// ---------------------------------------------------------------------------

var REPLY_CHAIN_ROSTER = [
  {
    file: 'lib/controllers/files.js',
    lines: '98-100',
    startLine: 98,
    endLine: 100,
    category: 'never-settles',
    current: 'reply(stream).type(...).bytes(...) with no `return` and no resolving ' +
      'call. Neither .type() nor .bytes() settles the deferred, so the ' +
      'image-download branch never produces a response at all -- the request hangs.',
    // The renderer prepends the bold "APPROVED DEVIATION." marker, so the text
    // itself must not repeat it.
    target: 'Return `h.response(stream).type(request.pre.file.mime)' +
      '.bytes(request.pre.file.size)` -- and NO Content-Disposition header, because ' +
      'the image branch deliberately omits it.',
    approvedDeviation: true,
    // One sentence, and it is the sentence an implementer needs at the call
    // site: the response to serve is not inferred, it is already written four
    // lines below. The precedence argument is NOT repeated here -- it is owned
    // by docs/preserved-quirks.md, and the renderer emits the pointer.
    justification:
      'The response to serve is not inferred: the sibling branch four lines below performs ' +
      'the identical chain ending in .header() and returns a working stream response, so ' +
      'the target is that same response minus the Content-Disposition header the image ' +
      'branch deliberately omits.'
  },
  {
    file: 'lib/controllers/files.js',
    lines: '102-105',
    startLine: 102,
    endLine: 105,
    category: 'header-resolved',
    current: 'reply(stream).type(...).bytes(...).header(\'Content-Disposition\', ...). ' +
      'Also has no `return`, but .header() resolves the deferred, so it works and ' +
      'returns a real hapi response.',
    target: 'Identical response. This is the non-image branch and it must NOT become ' +
      'collateral damage of the approved deviation four lines above.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/courses.js',
    lines: '269-272',
    startLine: 269,
    endLine: 272,
    category: 'header-resolved',
    current: 'return reply(stream).type(\'application/zip\').bytes(stats.size)' +
      '.header(\'Content-Disposition\', ...), inside the rimraf callback. Works: ' +
      '.header() resolves the deferred.',
    target: 'Identical response. Baseline WAITS for the deletion callback before the ' +
      'final .header() resolves, so the conversion awaits fs.promises.rm, swallows its ' +
      'error exactly as the empty callback does, and only then returns the response.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1204',
    startLine: 1204,
    endLine: 1204,
    category: 'builder-returned',
    current: 'return reply(code[0].content).type(type) -- hands the WRAPPER the builder ' +
      'object rather than a hapi response. What is emitted depends on whether the ' +
      'deferred had already been resolved earlier in the request.',
    target: 'Reproduce the measured status, content-type and body, captured before ' +
      'conversion by test/parity/capture.js.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1246',
    startLine: 1246,
    endLine: 1246,
    category: 'builder-returned',
    current: 'return reply(file.content).type(type) -- builder object returned to hapi.',
    target: 'Reproduce the measured status, content-type and body, captured before ' +
      'conversion by test/parity/capture.js.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1259',
    startLine: 1259,
    endLine: 1259,
    category: 'builder-returned',
    current: 'return reply(stream).type(type) inside a .then() -- builder object ' +
      'returned to hapi, wrapping a stream.',
    target: 'Reproduce the measured status, content-type and body, captured before ' +
      'conversion by test/parity/capture.js.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1383-1386',
    startLine: 1383,
    endLine: 1386,
    category: 'header-resolved',
    current: 'return reply(outputReadStream).type(\'application/zip\').bytes(bytes)' +
      '.header(\'Content-Disposition\', ...). Works: .header() resolves the deferred.',
    target: 'Identical response, including the quoted filename form this chain uses.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1548-1551',
    startLine: 1548,
    endLine: 1551,
    category: 'header-resolved',
    current: 'return reply(outputReadStream).type(\'application/zip\').bytes(bytes)' +
      '.header(\'Content-Disposition\', ...). Works: .header() resolves the deferred.',
    target: 'Identical response, including the unquoted filename form this chain uses.',
    approvedDeviation: false
  }
];

// Sites that are their own distinct shape rather than one of the eight chains,
// and that -- like the roster above -- were established by measuring the
// shim's behaviour rather than by reading the source.
var ANCHORED_SITES = [
  {
    file: 'lib/controllers/trinket.js',
    line: 375,
    // The enclosing function, not the line, is what identifies this site once
    // the file has been edited and line numbers have shifted.
    enclosing: 'create',
    kind: 'reply-no-return',
    current: 'reply(err); with NO `return`, inside .catch(function(err) { ... }) on an ' +
      'error path. The shim resolved a Boom for an Error and the handler fell off the ' +
      'end returning undefined, so the response came from the deferred.',
    target: 'Return the mapped error so the same status and payload reach the same error ' +
      'funnel. This is a DISTINCT shape, not one of the eight reply chains.'
  },
  {
    file: 'lib/util/helpers.js',
    line: 182,
    enclosing: 'findTrinket',
    kind: 'dead-301',
    current: 'findTrinket language-mismatch branch: return reply().redirect(location)' +
      '.permanent().takeover(). MEASURED DEAD: fakeReply(undefined) settles the deferred ' +
      'with null at lib/util/routeParser.js:147 BEFORE .takeover() reaches its own resolve ' +
      'at :154, so the redirect is discarded and the pre value is already null.',
    target: 'return null. The probe confirmed GET /prenull -> {"pre":null}. The capability ' +
      'is dead end to end: _isRedirect, _permanent and _takeover appear only on the six ' +
      'lines defining them (routeParser :98, :100, :101, :151, :153, :154).'
  },
  {
    file: 'lib/util/helpers.js',
    line: 385,
    enclosing: 'courseBySlug',
    kind: 'dead-301',
    current: 'courseBySlug slug-alias branch (reached from 5 route declarations): return ' +
      'reply().redirect(location).permanent().takeover(). MEASURED DEAD by the same ' +
      'mechanism -- the deferred is already settled with null.',
    target: 'return null. Coverage is counted from the route manifest rather than from ' +
      'lexical references, because the per-language expansion multiplies them.'
  }
];

// Target-idiom anchors. Every one of these is already in the tree, so the
// conversion has references rather than inventions to work from. Coordinates
// are baseline (R-f); a converted tree will have moved some of them.
var TARGET_IDIOM_ANCHORS = [
  {
    site: 'lib/util/helpers.js:397-403',
    what: 'The target PRE-HANDLER shape, already present: ' +
      '`async function (request, h) { ...; return await internals.namedTrinketList(lang, \'featured\'); }`'
  },
  {
    site: 'app.js:116-137',
    what: 'A server extension returning `h.continue` -- the shape for a lifecycle ' +
      'method that has nothing to contribute but must still return.'
  },
  {
    site: 'app.js:152-201',
    what: 'The onPreResponse error mapper. Branch ORDER is load-bearing: it returns ' +
      'immediately on 401/404/403/>=500 for browser HTML requests, BEFORE the cache and ' +
      'frame header assignments, so those headers reach API/JSON and non-Boom responses only.'
  },
  {
    site: 'app.js:243-281',
    what: 'The auth scheme, with all five outcomes -- absent userId, missing user, ' +
      'disabled user, valid user, lookup error. The modern `h.unauthenticated(...)` / ' +
      '`h.authenticated(...)` idiom.'
  },
  {
    site: 'lib/controllers/*.js',
    what: 'Controllers converge on `async function (request, h) { ...; return request.success(data); }`.'
  }
];


// ---------------------------------------------------------------------------
// SECTION 2b -- CROSS-REFERENCES TO THE DOCUMENTS THAT OWN WHAT THIS ONE DOES NOT
//
// This document records, per site, the RETURN SHAPE: what the body does now and
// what it must return afterwards. Two sibling documents own the rest of the
// story about the same sites, and R-d and R-e both require the pointer rather
// than a second copy:
//
//   docs/preserved-quirks.md      -- the measured baseline OUTCOME of a quirk,
//                                    and, for the one approved deviation, the
//                                    full precedence argument.
//   docs/error-edge-inventory.md  -- the status, payload, side effects and
//                                    timing of every changed error edge.
//
// So a row that carries a quirk or an error edge emits a section reference into
// its target-disposition cell and stops there. Duplicating either document
// would create two places for the same fact to drift.
//
// Section NUMBERS are cited rather than Markdown anchors on purpose: the
// numbers are stable identifiers in both sibling documents, whereas a
// GitHub-style anchor is derived from heading text and breaks silently when a
// heading is reworded.
// ---------------------------------------------------------------------------

var QUIRK_DOC = 'docs/preserved-quirks.md';
var ERROR_EDGE_DOC = 'docs/error-edge-inventory.md';

// docs/error-edge-inventory.md lays its rows out in per-file sections, ordered
// alphabetically by path: 7.1 through 7.12. A row here cites the section that
// owns its file, which is as precise as a cross-reference can be without
// pinning to that document's own row numbering -- which would couple two
// generators to each other and break on either one's next run.
var ERROR_EDGE_SECTIONS = {
  'config/api_routes.js': '7.1',
  'lib/controllers/admin.js': '7.2',
  'lib/controllers/auth.js': '7.3',
  'lib/controllers/classes.js': '7.4',
  'lib/controllers/course.js': '7.5',
  'lib/controllers/courses.js': '7.6',
  'lib/controllers/files.js': '7.7',
  'lib/controllers/folders.js': '7.8',
  'lib/controllers/pages.js': '7.9',
  'lib/controllers/trinket.js': '7.10',
  'lib/controllers/users.js': '7.11',
  'lib/util/helpers.js': '7.12'
};

// Quirk ownership per hapi-invoked function, keyed by the ENCLOSING FUNCTION
// rather than by line, so the reference survives the file being edited. Every
// entry names a quirk whose target disposition REPRODUCES a defect: the row
// says so and points here, and no row proposes the fix.
var QUIRK_REFS = [
  {
    file: 'lib/controllers/pages.js',
    enclosing: 'login',
    section: '5',
    note: 'the authenticated-visitor 500 is REPRODUCED -- `reply.redirect` is a property ' +
      'access on a bare function and throws a TypeError that reaches the catch-all'
  },
  {
    file: 'lib/controllers/pages.js',
    enclosing: 'signup',
    section: '5',
    note: 'the authenticated-visitor 500 is REPRODUCED, and `request.yar.set(\'next\', ...)` ' +
      'stays in the `else` branch only -- it does not precede the throw'
  },
  {
    file: 'lib/controllers/auth.js',
    enclosing: 'googleCallback',
    section: '6',
    note: 'the new-user path persists the user, mutates session state and THEN reports the ' +
      'generic failure; that sequence is reproduced, not repaired'
  },
  {
    file: 'lib/controllers/folders.js',
    enclosing: 'trinkets',
    section: '7',
    note: 'the queryless case passes NO folder filter because the injected URL is malformed; ' +
      'the extraction must reproduce both cases'
  },
  {
    file: 'lib/controllers/users.js',
    enclosing: 'assetUploadFromURL',
    section: '8.1',
    note: 'a refused connection logs and leaves the route UNSETTLED; the conversion must not ' +
      'turn that into a rejection'
  }
];

// The quirk sections that own the eight reply chains, keyed by the category
// this generator derives independently. docs/preserved-quirks.md §4 splits the
// same three-way classification into 4.1, 4.2 and 4.3, and §4.4 owns the one
// further unreturned reply on an error path.
var CATEGORY_QUIRK_SECTIONS = {
  'never-settles': '4.1',
  'header-resolved': '4.2',
  'builder-returned': '4.3'
};

// The quirk sections that own the anchored sites, keyed by their kind.
var ANCHORED_QUIRK_SECTIONS = {
  'reply-no-return': '4.4',
  'dead-301': '2'
};

// The quirk section that owns the approved deviation. The precedence argument
// lives there in full; this document states the target and points at it.
var DEVIATION_QUIRK_SECTION = '11.1';

// The quirk section that owns the three routes with no function to convert.
var MISSING_BINDING_QUIRK_SECTION = '1';

/**
 * The error-edge pointer for one file, or '' when that file has no section in
 * the sibling document. Emitted only on rows whose own measured shape IS an
 * error edge -- a chain carrying a `.catch(` link, an error-first callback, an
 * unreturned `reply(err)` -- because a pointer on every row of all ten
 * controllers would be noise rather than a cross-reference.
 */
function errorEdgeRef(file) {
  var section = ERROR_EDGE_SECTIONS[file];
  if (!section) {
    return '';
  }
  return ' Error mapping (status, payload, side effects, timing): `' +
    ERROR_EDGE_DOC + '` \u00a7' + section + '.';
}

/**
 * The quirk pointer for an anchored site, derived from its kind. Every
 * anchored site IS a recorded quirk, so unlike quirkRef() this never returns
 * an empty string for a known kind -- a missing entry is a generator fault and
 * says so in the emitted text rather than silently dropping the reference.
 */
function anchoredQuirkRef(site) {
  var section = ANCHORED_QUIRK_SECTIONS[site.kind];
  if (!section) {
    return ' Quirk record: `' + QUIRK_DOC + '` (section unmapped for kind `' +
      site.kind + '` -- fix ANCHORED_QUIRK_SECTIONS).';
  }
  return ' Baseline outcome owned by `' + QUIRK_DOC + '` \u00a7' + section +
    '; reproduce it, do not fix it.' +
    (site.kind === 'reply-no-return' ? errorEdgeRef(site.file) : '');
}

/** The quirk pointer for a hapi-invoked function, or '' when it carries none. */
function quirkRef(file, enclosing) {
  if (!enclosing) {
    return '';
  }
  for (var i = 0; i < QUIRK_REFS.length; i++) {
    var ref = QUIRK_REFS[i];
    if (ref.file === file && ref.enclosing === enclosing) {
      return ' PRESERVED QUIRK -- ' + ref.note + '. Owned by `' + QUIRK_DOC +
        '` \u00a7' + ref.section + '; reproduce it, do not fix it.';
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// SECTION 3 -- THE TOKENIZER
//
// scrubSource() returns a string the SAME LENGTH as its input, in which the
// interior of every comment, string literal, template literal and regex
// literal has been replaced by spaces. Newlines are preserved everywhere, so
// an offset in the scrubbed text is the same offset in the original and line
// numbers are exact.
//
// Order matters and is the whole reason this function exists rather than a
// chain of regexes:
//
//   comments FIRST, because lib/controllers/trinket.js:625 holds a pair of
//   backticks inside a `//` comment, which a template-literal-first scan would
//   read as a template spanning that comment;
//
//   then quotes, handling backslash escapes;
//
//   then regex literals, which is where config/routes.js and
//   config/api_routes.js bite: their password schema's character class holds a
//   single quote, a double quote and a backtick simultaneously. That backtick
//   is UNPAIRED in both files, so mis-tokenizing the regex blanks the rest of
//   the file -- 85% of config/routes.js, measured.
//
// Delimiters themselves are LEFT IN PLACE (only the interior is blanked) so
// that the balance check in checkDelimiterBalance() still sees a well-formed
// string and quote-counting stays possible for callers that want it.
// ---------------------------------------------------------------------------

// Keywords after which a `/` begins a regex literal rather than a division.
// Everything else that ends in an identifier, a number, `)`, `]` or a
// quote/backtick is treated as the end of an operand, so `/` divides.
var REGEX_PRECEDING_KEYWORDS = /^(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await|throw)$/;

/**
 * Decide whether the `/` at `index` starts a regex literal.
 *
 * The rule is positional: scan backwards past whitespace and comments to the
 * last significant character. If it closes an operand -- an identifier
 * character, a digit, `)`, `]` or a closing quote -- then `/` is division,
 * unless the identifier is one of the keywords above. Anything else (`(`,
 * `,`, `=`, `:`, `[`, `{`, `;`, `!`, `&`, `|`, `?`, `+`, `-`, `*`, `%`, `<`,
 * `>`, `~`, `^`, or start of file) means an operand is expected, so `/`
 * starts a regex.
 *
 * `)` is the genuinely ambiguous case -- `if (x) /re/.test(y)` versus
 * `(a + b) / c`. It is resolved as division, which is correct for every
 * occurrence in this repository and fails safe: a misjudged regex would blank
 * real code and be caught by checkDelimiterBalance(), whereas a misjudged
 * division leaves the regex text visible, which at worst adds a token the
 * analysers do not look for.
 */
function startsRegexLiteral(src, index) {
  var j = index - 1;

  while (j >= 0) {
    var c = src[j];

    // Skip whitespace.
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
      j--;
      continue;
    }

    // A preceding `*/` means a block comment sits between us and the real
    // previous token; step over it and keep looking.
    if (c === '/' && j > 0 && src[j - 1] === '*') {
      var close = src.lastIndexOf('/*', j - 1);
      if (close === -1) {
        return true;
      }
      j = close - 1;
      continue;
    }

    if (/[A-Za-z0-9_$]/.test(c)) {
      var word = '';
      var k = j;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(src[k])) {
        word = src[k] + word;
        k--;
      }
      // A numeric literal is an operand, never a keyword.
      if (/^[0-9]/.test(word)) {
        return false;
      }
      return REGEX_PRECEDING_KEYWORDS.test(word);
    }

    if (c === ')' || c === ']' || c === '\'' || c === '"' || c === '`') {
      return false;
    }

    // `}` ends a block (regex may follow) or an object literal (it may not).
    // Blocks are far more common in this position; treating it as
    // regex-allowed is the safer default because an unterminated candidate is
    // rejected below anyway.
    return true;
  }

  return true;
}

/**
 * Blank out comment, string, template and regex interiors, preserving length
 * and every newline. See the section comment for why the order is fixed.
 */
function scrubSource(src) {
  var out = src.split('');
  var n = src.length;
  var i = 0;

  function blankRange(from, to) {
    for (var k = from; k < to && k < n; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') {
        out[k] = ' ';
      }
    }
  }

  while (i < n) {
    var c = src[i];

    // --- line comment -------------------------------------------------------
    if (c === '/' && src[i + 1] === '/') {
      var lineEnd = src.indexOf('\n', i);
      if (lineEnd === -1) {
        lineEnd = n;
      }
      blankRange(i, lineEnd);
      i = lineEnd;
      continue;
    }

    // --- block comment ------------------------------------------------------
    if (c === '/' && src[i + 1] === '*') {
      var blockEnd = src.indexOf('*/', i + 2);
      blockEnd = blockEnd === -1 ? n : blockEnd + 2;
      blankRange(i, blockEnd);
      i = blockEnd;
      continue;
    }

    // --- string / template literal -----------------------------------------
    // Template interiors are blanked wholesale, `${...}` included. Nothing in
    // this analysis needs to see inside one, and blanking the substitution
    // avoids having to track nested braces.
    if (c === '"' || c === '\'' || c === '`') {
      var j = i + 1;
      var closed = false;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === c) {
          closed = true;
          break;
        }
        // An unescaped newline terminates a single- or double-quoted string
        // in valid JavaScript. Stopping here keeps one malformed literal from
        // consuming the rest of the file.
        if ((c === '"' || c === '\'') && src[j] === '\n') {
          break;
        }
        j++;
      }
      blankRange(i + 1, j);
      i = closed ? j + 1 : j;
      continue;
    }

    // --- regex literal ------------------------------------------------------
    if (c === '/' && startsRegexLiteral(src, i)) {
      var r = i + 1;
      var inClass = false;
      var terminated = false;
      while (r < n) {
        var d = src[r];
        if (d === '\\') {
          r += 2;
          continue;
        }
        if (d === '\n') {
          break;
        }
        if (d === '[') {
          inClass = true;
        } else if (d === ']') {
          inClass = false;
        } else if (d === '/' && !inClass) {
          terminated = true;
          break;
        }
        r++;
      }
      if (terminated) {
        var flagsEnd = r + 1;
        while (flagsEnd < n && /[dgimsuvy]/.test(src[flagsEnd])) {
          flagsEnd++;
        }
        // Blank the body and the flags, leaving both `/` delimiters.
        blankRange(i + 1, r);
        blankRange(r + 1, flagsEnd);
        i = flagsEnd;
        continue;
      }
      // Unterminated on this line: it was division after all.
    }

    i++;
  }

  return out.join('');
}

// ---------------------------------------------------------------------------
// SECTION 4 -- SCAN HELPERS
// ---------------------------------------------------------------------------

/**
 * Build a sorted array of newline offsets so line lookup is O(log n) rather
 * than a substring-and-split per call. On the largest controller the naive
 * form is called thousands of times.
 */
function buildLineIndex(src) {
  var offsets = [0];
  for (var i = 0; i < src.length; i++) {
    if (src[i] === '\n') {
      offsets.push(i + 1);
    }
  }
  return offsets;
}

/** 1-based line number for a character offset. */
function lineAt(lineIndex, offset) {
  var lo = 0;
  var hi = lineIndex.length - 1;
  while (lo < hi) {
    var mid = (lo + hi + 1) >> 1;
    if (lineIndex[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo + 1;
}

/**
 * Offset of the delimiter matching the one at `open`, or -1. Operates on
 * scrubbed text, so delimiters inside strings and regexes cannot confuse it.
 */
function matchDelimiter(scrubbed, open) {
  var pairs = { '(': ')', '[': ']', '{': '}' };
  var closer = pairs[scrubbed[open]];
  if (!closer) {
    return -1;
  }
  var depth = 0;
  for (var i = open; i < scrubbed.length; i++) {
    var c = scrubbed[i];
    if (c === scrubbed[open]) {
      depth++;
    } else if (c === closer) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Verify that a scrubbed file has balanced `()`, `[]` and `{}`.
 *
 * This is the tokenizer's self-test. A desynchronized scrub -- the failure
 * mode the config/routes.js regex and the trinket.js comment backtick both
 * provoke -- swallows or exposes large spans of code and the counts go wildly
 * unbalanced. Balanced delimiters are not a proof of correctness, but no
 * desync this repository can produce survives the check.
 */
function checkDelimiterBalance(scrubbed) {
  var counts = { paren: 0, bracket: 0, brace: 0 };
  for (var i = 0; i < scrubbed.length; i++) {
    switch (scrubbed[i]) {
      case '(': counts.paren++; break;
      case ')': counts.paren--; break;
      case '[': counts.bracket++; break;
      case ']': counts.bracket--; break;
      case '{': counts.brace++; break;
      case '}': counts.brace--; break;
      default: break;
    }
    if (counts.paren < 0 || counts.bracket < 0 || counts.brace < 0) {
      return { balanced: false, counts: counts, at: i };
    }
  }
  return {
    balanced: counts.paren === 0 && counts.bracket === 0 && counts.brace === 0,
    counts: counts,
    at: -1
  };
}

/** All match offsets of a sticky-free global regex over `scrubbed`. */
function offsetsOf(scrubbed, pattern) {
  var re = new RegExp(pattern.source, pattern.flags.indexOf('g') === -1 ? pattern.flags + 'g' : pattern.flags);
  var found = [];
  var m;
  while ((m = re.exec(scrubbed)) !== null) {
    found.push({ index: m.index, match: m[0] });
    if (m.index === re.lastIndex) {
      re.lastIndex++;
    }
  }
  return found;
}

/** Collapse runs of whitespace so a source excerpt fits a table cell. */
function oneLine(text, limit) {
  var flat = String(text).replace(/\s+/g, ' ').trim();
  if (typeof limit === 'number' && flat.length > limit) {
    return flat.slice(0, limit - 1).trimEnd() + '\u2026';
  }
  return flat;
}

/**
 * "1 chain" / "2 chains". Generated prose should read as prose: a heading that
 * says "1 chains" tells a reviewer the document was assembled rather than
 * written, which is precisely the impression a generated artifact cannot
 * afford when its whole claim is that every figure in it was measured.
 */
function pluralize(count, singular, plural) {
  return count + ' ' + (count === 1 ? singular : (plural || singular + 's'));
}

/** Escape the characters that would break a Markdown table cell. */
function cell(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

/** Wrap an excerpt as inline code, escaping backticks by widening the fence. */
function code(text) {
  var flat = oneLine(text, 160);
  if (flat === '') {
    return '';
  }
  var fence = flat.indexOf('`') === -1 ? '`' : '``';
  var pad = flat.indexOf('`') === -1 ? '' : ' ';
  return fence + pad + flat + pad + fence;
}


// ---------------------------------------------------------------------------
// SECTION 5 -- FUNCTION AND SIGNATURE READING
// ---------------------------------------------------------------------------

/** Offset of the delimiter matching a closer, scanning backwards. Or -1. */
function matchDelimiterBackwards(scrubbed, close) {
  var pairs = { ')': '(', ']': '[', '}': '{' };
  var opener = pairs[scrubbed[close]];
  if (!opener) {
    return -1;
  }
  var depth = 0;
  for (var i = close; i >= 0; i--) {
    var c = scrubbed[i];
    if (c === scrubbed[close]) {
      depth++;
    } else if (c === opener) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

/**
 * Read a function literal starting at or after `offset`, skipping whitespace.
 * Handles `function (a, b) {}`, `async function name(a) {}`, `(a, b) => {}`
 * and `async (a) => {}`. Returns null when no function literal starts there.
 *
 * Arrow support is not speculative: the tree already contains one, and the
 * conversion may well introduce more.
 */
function readFunctionAt(scrubbed, offset) {
  var i = offset;
  while (i < scrubbed.length && /\s/.test(scrubbed[i])) {
    i++;
  }

  var isAsync = false;
  if (/^async[\s(]/.test(scrubbed.slice(i, i + 6))) {
    isAsync = true;
    i += 5;
    while (i < scrubbed.length && /\s/.test(scrubbed[i])) {
      i++;
    }
  }

  var kind = null;
  if (/^function[\s(*]/.test(scrubbed.slice(i, i + 9))) {
    kind = 'function';
    i += 8;
    // Optional generator star and optional function name.
    while (i < scrubbed.length && /[\s*]/.test(scrubbed[i])) {
      i++;
    }
    while (i < scrubbed.length && /[A-Za-z0-9_$]/.test(scrubbed[i])) {
      i++;
    }
    while (i < scrubbed.length && /\s/.test(scrubbed[i])) {
      i++;
    }
  } else if (scrubbed[i] === '(') {
    kind = 'arrow';
  } else {
    return null;
  }

  if (scrubbed[i] !== '(') {
    return null;
  }
  var paramOpen = i;
  var paramClose = matchDelimiter(scrubbed, paramOpen);
  if (paramClose === -1) {
    return null;
  }

  var afterParams = paramClose + 1;
  while (afterParams < scrubbed.length && /\s/.test(scrubbed[afterParams])) {
    afterParams++;
  }

  if (kind === 'arrow') {
    if (scrubbed.slice(afterParams, afterParams + 2) !== '=>') {
      return null;
    }
    afterParams += 2;
    while (afterParams < scrubbed.length && /\s/.test(scrubbed[afterParams])) {
      afterParams++;
    }
  }

  // A concise arrow body (`=> expr`) has no brace. Treat the rest of the
  // statement as the body so shape analysis still has something to read.
  if (scrubbed[afterParams] !== '{') {
    if (kind !== 'arrow') {
      return null;
    }
    var stop = afterParams;
    var d = 0;
    while (stop < scrubbed.length) {
      var ch = scrubbed[stop];
      if (ch === '(' || ch === '[' || ch === '{') {
        d++;
      } else if (ch === ')' || ch === ']' || ch === '}') {
        if (d === 0) {
          break;
        }
        d--;
      } else if ((ch === ',' || ch === ';') && d === 0) {
        break;
      }
      stop++;
    }
    return {
      kind: kind,
      isAsync: isAsync,
      start: offset,
      paramStart: paramOpen + 1,
      paramEnd: paramClose,
      bodyStart: afterParams,
      bodyEnd: stop,
      concise: true
    };
  }

  var bodyEnd = matchDelimiter(scrubbed, afterParams);
  if (bodyEnd === -1) {
    return null;
  }

  return {
    kind: kind,
    isAsync: isAsync,
    start: offset,
    paramStart: paramOpen + 1,
    paramEnd: paramClose,
    bodyStart: afterParams,
    bodyEnd: bodyEnd,
    concise: false
  };
}

/** Normalized comma-separated parameter names, e.g. "request, reply". */
function paramList(scrubbed, fn) {
  return scrubbed.slice(fn.paramStart, fn.paramEnd).replace(/\s+/g, ' ').trim();
}

/**
 * Classify a lifecycle-method signature.
 *
 * `legacy`     -- second parameter is `reply` (or `res`/`callback`): the shim's
 *                 fake reply, so the body signals out of band.
 * `toolkit`    -- second parameter is `h`: already the native shape. Note that
 *                 this alone does NOT mean the site is done -- both
 *                 lib/controllers/auth.js handlers are declared `(request, h)`
 *                 at baseline and are still shim-dependent, because they lean
 *                 on request.success/request.fail being resolved for them.
 * `other`      -- anything else (a helper, a registrar, an iteratee).
 */
function classifySignature(params) {
  var names = params === '' ? [] : params.split(',').map(function (p) {
    return p.trim().replace(/\s*=.*$/, '');
  });
  if (names.length < 2) {
    return { kind: 'other', names: names };
  }
  var first = names[0];
  var second = names[1];
  var firstIsRequest = first === 'request' || first === 'req';
  if (!firstIsRequest) {
    return { kind: 'other', names: names };
  }
  if (second === 'h') {
    return { kind: 'toolkit', names: names };
  }
  if (second === 'reply' || second === 'res' || second === 'callback' || second === 'cb') {
    return { kind: 'legacy', names: names };
  }
  return { kind: 'other', names: names };
}

// Calls through which a hapi-facing function signals its response.
var SIGNAL_CALL = /(?<![A-Za-z0-9_$])(?:request\.success|request\.fail|reply)\s*\(/g;

// Characters that CONTINUE an expression when walking backwards, so a call
// sitting behind one of them may still be in a return position.
var EXPRESSION_CONTINUATION = /[?:|&,!~+\-*\/%^<>=]/;

/**
 * Decide whether an offset sits in a `return`/`throw` position -- i.e. whether
 * the value it produces actually leaves the function.
 *
 * Looking only at the immediately preceding token is not enough, and getting
 * this wrong matters more than anything else in this file: `reliesOnInterception`
 * is the document's central column, and a false positive sends someone chasing
 * a handler that was already correct.
 *
 * The case that proves it is `lib/controllers/trinket.js:881`:
 *
 *     return err === "threshold exceeded" ? reply(errors.forbidden()) : reply();
 *
 * Two `reply(` calls, preceded by `?` and `:`, both of whose values ARE
 * returned by the enclosing ternary. So the walk continues through expression
 * operators, over balanced groups and over operand words, and stops at a
 * genuine boundary: `{`, `}`, `;`, or an opening `(`/`[` -- an opening paren
 * meaning the call is an ARGUMENT, whose value goes to the callee rather than
 * out of the function.
 */
function isInReturnPosition(scrubbed, offset) {
  var i = offset - 1;
  var guard = 0;

  while (i >= 0 && guard++ < 4096) {
    var c = scrubbed[i];

    if (/\s/.test(c)) {
      i--;
      continue;
    }

    // Concise arrow body: `err => reply(err)` returns its value.
    if (c === '>' && i >= 1 && scrubbed[i - 1] === '=') {
      return true;
    }

    if (EXPRESSION_CONTINUATION.test(c)) {
      i--;
      continue;
    }

    // A balanced group, or a string literal, is an operand -- step over it.
    if (c === ')' || c === ']') {
      var open = matchDelimiterBackwards(scrubbed, i);
      if (open < 0) {
        return false;
      }
      i = open - 1;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      var quote = scrubbed.lastIndexOf(c, i - 1);
      if (quote < 0) {
        return false;
      }
      i = quote - 1;
      continue;
    }
    if (c === '.') {
      i--;
      continue;
    }

    if (/[A-Za-z0-9_$]/.test(c)) {
      var word = '';
      var k = i;
      while (k >= 0 && /[A-Za-z0-9_$]/.test(scrubbed[k])) {
        word = scrubbed[k] + word;
        k--;
      }
      if (word === 'return' || word === 'throw') {
        return true;
      }
      // `await`/`yield` are transparent: whether an awaited value leaves the
      // function is decided further back still.
      i = k;
      continue;
    }

    // `{`, `}`, `;` end a statement; `(`/`[` mean this call is an argument or
    // an element, so its value does not leave the function.
    return false;
  }

  return false;
}

/**
 * Static shape analysis for one hapi-invoked function.
 *
 * This is a documented HEURISTIC, and the generated document says so. It
 * cannot prove "returns exactly once on every path" -- that needs the reader
 * this checklist exists to prompt. What it does reliably is separate the two
 * populations that matter: bodies that hand their response to the interception
 * and bodies that return it.
 */
function analyseFunctionShape(scrubbed, fn) {
  var body = scrubbed.slice(fn.bodyStart, fn.bodyEnd + 1);
  var signals = [];
  var re = new RegExp(SIGNAL_CALL.source, 'g');
  var m;
  while ((m = re.exec(body)) !== null) {
    var abs = fn.bodyStart + m.index;
    signals.push({
      offset: abs,
      text: m[0].replace(/\s*\($/, ''),
      returned: isInReturnPosition(scrubbed, abs)
    });
  }

  var unreturned = signals.filter(function (s) {
    return !s.returned;
  });

  return {
    signalCount: signals.length,
    signals: signals,
    unreturnedSignals: unreturned.length,
    // `reply` appearing at all means the fake reply is still being consumed.
    usesReply: signals.some(function (s) {
      return s.text === 'reply';
    }),
    hasReturnStatement: /(?<![A-Za-z0-9_$])return(?![A-Za-z0-9_$])/.test(body),
    reliesOnInterception: unreturned.length > 0
  };
}

// ---------------------------------------------------------------------------
// SECTION 6 -- CONTROLLER ANALYSIS
// ---------------------------------------------------------------------------

/**
 * Handler exports are the top-level keys of the `module.exports = { ... }`
 * object literal whose value is a function literal. Depth is tracked so that
 * a `method :` nested inside a route-ish object, or a key inside a returned
 * object, is never mistaken for an export -- and paren/bracket depth is
 * tracked alongside brace depth so that an object literal passed as a call
 * argument cannot contribute keys either.
 *
 * Measured against the base commit this rule yields exactly 147 exports with
 * the per-file distribution in BASELINE_EXPORTS, which is what makes it
 * trustworthy enough to police the rest of the analysis.
 */
function findControllerExports(scrubbed, lineIndex) {
  var anchor = scrubbed.indexOf('module.exports');
  if (anchor === -1) {
    return [];
  }
  var open = scrubbed.indexOf('{', anchor);
  if (open === -1) {
    return [];
  }
  var close = matchDelimiter(scrubbed, open);
  if (close === -1) {
    return [];
  }

  var found = [];
  var braceDepth = 0;
  var parenDepth = 0;
  var bracketDepth = 0;

  for (var i = open; i <= close; i++) {
    var c = scrubbed[i];
    if (c === '{') {
      braceDepth++;
      continue;
    }
    if (c === '}') {
      braceDepth--;
      continue;
    }
    if (c === '(') {
      parenDepth++;
      continue;
    }
    if (c === ')') {
      parenDepth--;
      continue;
    }
    if (c === '[') {
      bracketDepth++;
      continue;
    }
    if (c === ']') {
      bracketDepth--;
      continue;
    }
    if (c !== ':' || braceDepth !== 1 || parenDepth !== 0 || bracketDepth !== 0) {
      continue;
    }

    var j = i - 1;
    while (j >= 0 && /\s/.test(scrubbed[j])) {
      j--;
    }
    var name = '';
    while (j >= 0 && /[A-Za-z0-9_$]/.test(scrubbed[j])) {
      name = scrubbed[j] + name;
      j--;
    }
    if (name === '') {
      continue;
    }

    var fn = readFunctionAt(scrubbed, i + 1);
    if (!fn) {
      continue;
    }

    found.push({
      name: name,
      line: lineAt(lineIndex, i),
      fn: fn,
      params: paramList(scrubbed, fn),
      startLine: lineAt(lineIndex, fn.bodyStart),
      endLine: lineAt(lineIndex, fn.bodyEnd)
    });

    i = fn.bodyEnd;
    // The body's own braces were consumed by matchDelimiter, so re-align the
    // depth counters to the object literal we are still inside.
    braceDepth = 1;
    parenDepth = 0;
    bracketDepth = 0;
  }

  return found;
}


// Keywords that CANNOT be part of a member expression, so walking backwards
// must stop in front of them. Getting this list wrong is not cosmetic: treat
// `return` as part of the expression and every returned chain reads as
// unreturned, which is precisely the distinction this document exists to make.
//
// `new` is deliberately absent -- it IS part of the expression, so that
// `return new Promise(...).then(...)` still reports its prefix as `return`
// rather than as `new`.
var EXPRESSION_STOP_KEYWORDS = /^(?:return|await|throw|yield|typeof|void|delete|instanceof|in|of|else|case|do|if|while|for|switch|try|catch|finally|break|continue|default|var|let|const|function)$/;

/**
 * Walk backwards from a `.` to the start of the member/call expression it
 * belongs to, so the chain's head -- and therefore whether the chain is
 * returned or awaited -- can be read.
 *
 * Identifiers are consumed a WHOLE WORD at a time rather than a character at
 * a time, because a character-wise walk cannot tell `return` from part of a
 * property path and swallows it.
 */
function expressionStart(scrubbed, dotOffset) {
  var i = dotOffset - 1;
  while (i >= 0) {
    var c = scrubbed[i];

    if (/\s/.test(c)) {
      i--;
      continue;
    }
    if (c === ')' || c === ']') {
      var open = matchDelimiterBackwards(scrubbed, i);
      if (open < 0) {
        break;
      }
      i = open - 1;
      continue;
    }
    if (c === '.') {
      i--;
      continue;
    }
    if (/[A-Za-z0-9_$]/.test(c)) {
      var k = i;
      var word = '';
      while (k >= 0 && /[A-Za-z0-9_$]/.test(scrubbed[k])) {
        word = scrubbed[k] + word;
        k--;
      }
      if (EXPRESSION_STOP_KEYWORDS.test(word)) {
        // Stop in FRONT of the keyword: `i` still points at its last
        // character, so `i + 1` is the first offset of the expression proper.
        break;
      }
      i = k;
      continue;
    }
    break;
  }
  return i + 1;
}

/**
 * Advance an offset past leading whitespace, using the SCRUBBED text so that
 * comments -- already blanked to spaces -- are skipped too.
 *
 * expressionStart() stops in front of the previous statement's terminator, so
 * its result can sit before a run of blank lines and comments. Without this
 * trim the reported line number belongs to the previous statement and the
 * extracted expression text begins with a comment, both of which were
 * observed before it was added.
 */
function trimLeading(scrubbed, from, to) {
  var i = from;
  while (i < to && /\s/.test(scrubbed[i])) {
    i++;
  }
  return i;
}

/** The keyword or operator immediately preceding an expression. */
function precedingToken(scrubbed, start) {
  var i = start - 1;
  while (i >= 0 && /\s/.test(scrubbed[i])) {
    i--;
  }
  if (i < 0) {
    return '';
  }
  if (/[A-Za-z0-9_$]/.test(scrubbed[i])) {
    var word = '';
    while (i >= 0 && /[A-Za-z0-9_$]/.test(scrubbed[i])) {
      word = scrubbed[i] + word;
      i--;
    }
    return word;
  }
  if (scrubbed[i] === '>' && i >= 1 && scrubbed[i - 1] === '=') {
    return '=>';
  }
  return scrubbed[i];
}

var PROMISE_LINK = /\.\s*(then|catch|finally)\s*\(/g;

/**
 * Group `.then(` / `.catch(` / `.finally(` links into chains.
 *
 * Two links belong to the same chain when the second one's `.` is the first
 * non-whitespace character after the first one's closing paren. The chain's
 * disposition is then read once, at the head, because "returned or awaited
 * exactly once per path" is a property of the chain, not of each link.
 *
 * Every chain gets ONE row. The measured link totals (183 `.then(` and 85
 * `.catch(` at the base commit) are reported as scale in the document but are
 * deliberately not the row count -- a row is a unit of work an implementing
 * agent closes, and closing a chain means fixing all of its links at once.
 */
function findPromiseChains(scrubbed, lineIndex, original) {
  var links = offsetsOf(scrubbed, PROMISE_LINK).map(function (hit) {
    var openParen = scrubbed.indexOf('(', hit.index);
    return {
      dot: hit.index,
      name: /then/.test(hit.match) ? 'then' : (/catch/.test(hit.match) ? 'catch' : 'finally'),
      open: openParen,
      close: matchDelimiter(scrubbed, openParen)
    };
  }).filter(function (link) {
    return link.open !== -1 && link.close !== -1;
  });

  var consumed = Object.create(null);
  var chains = [];

  // Index links by their `.` offset so a successor can be found in O(1).
  var byDot = Object.create(null);
  links.forEach(function (link) {
    byDot[link.dot] = link;
  });

  function nextLinkAfter(close) {
    var i = close + 1;
    while (i < scrubbed.length && /\s/.test(scrubbed[i])) {
      i++;
    }
    return byDot[i] || null;
  }

  links.forEach(function (link) {
    if (consumed[link.dot]) {
      return;
    }
    var members = [link];
    consumed[link.dot] = true;
    var cursor = link;
    for (;;) {
      var next = nextLinkAfter(cursor.close);
      if (!next || consumed[next.dot]) {
        break;
      }
      consumed[next.dot] = true;
      members.push(next);
      cursor = next;
    }

    var headStart = trimLeading(scrubbed, expressionStart(scrubbed, members[0].dot), members[0].dot);
    var prefix = precedingToken(scrubbed, headStart);
    var terminal = members[members.length - 1];
    var argText = original.slice(terminal.open + 1, terminal.close).trim();
    var argIsFunction = readFunctionAt(scrubbed, terminal.open + 1) !== null;

    chains.push({
      startLine: lineAt(lineIndex, headStart),
      endLine: lineAt(lineIndex, terminal.close),
      headStart: headStart,
      endOffset: terminal.close,
      linkNames: members.map(function (mm) {
        return mm.name;
      }),
      linkCount: members.length,
      terminalName: terminal.name,
      terminalIsFunction: argIsFunction,
      terminalArg: argIsFunction ? null : oneLine(argText, 60),
      returned: prefix === 'return',
      awaited: prefix === 'await',
      prefix: prefix,
      head: oneLine(original.slice(headStart, members[0].dot), 70)
    });
  });

  chains.sort(function (a, b) {
    return a.startLine - b.startLine || a.endLine - b.endLine;
  });
  return chains;
}

// Callees that take a function argument but are NOT asynchronous callback
// boundaries. Promise links have their own category; `.on(` registrations are
// stream/event lifecycle and are covered by the stream rows; the rest are
// synchronous iteration helpers whose function argument returns immediately.
var NON_CALLBACK_CALLEES = /(?:^|\.)(?:then|catch|finally|on|once|addListener|map|forEach|each|filter|find|findIndex|findWhere|reduce|reduceRight|sort|some|every|reject|pluck|groupBy|sortBy|countBy|partition|flatMap|bind|call|apply|defineProperty|freeze)$/;
var UNDERSCORE_CALLEE = /^(?:_|lodash|Object|Array|JSON|Math|Promise|util)\./;

/**
 * Node-style callback boundaries inside a controller.
 *
 * A boundary is a call that receives a function literal whose parameter list
 * is either the error-first convention (`err`/`error` first) or empty -- the
 * two shapes a completion callback takes -- where the callee is not a promise
 * link, an event registration or a synchronous iteration helper.
 *
 * Empty-parameter callbacks are deliberately included, because two of the
 * conversions the plan names are exactly that shape:
 * `rimraf(dir, function() {})` and `fs.unlink(file, function() {})`.
 *
 * Rule T-3 is what each row records: the `await` is created AT THE CALL SITE,
 * inside the converted lifecycle method. It is not pushed down into
 * lib/util/file.js, lib/util/store.js or lib/util/queues.js, which keep their
 * callback interfaces -- three, three and one controller consume them
 * respectively -- because they are utilities a handler awaits, not lifecycle
 * methods themselves.
 */
function findCallbackBoundaries(scrubbed, lineIndex, original) {
  var boundaries = [];
  var re = /(?<![A-Za-z0-9_$])(?:async\s+)?function(?![A-Za-z0-9_$])/g;
  var m;

  while ((m = re.exec(scrubbed)) !== null) {
    var fn = readFunctionAt(scrubbed, m.index);
    if (!fn) {
      continue;
    }
    var params = paramList(scrubbed, fn);
    var names = params === '' ? [] : params.split(',').map(function (p) {
      return p.trim();
    });
    var errorFirst = names.length > 0 && /^(err|error|e)$/.test(names[0]);
    var noParams = names.length === 0;
    if (!errorFirst && !noParams) {
      continue;
    }

    // Find the call this function literal is an argument to.
    var callOpen = -1;
    var depth = 0;
    for (var i = m.index - 1; i >= 0; i--) {
      var c = scrubbed[i];
      if (c === ')' || c === ']' || c === '}') {
        depth++;
      } else if (c === '(' || c === '[' || c === '{') {
        if (depth === 0) {
          callOpen = c === '(' ? i : -1;
          break;
        }
        depth--;
      }
    }
    if (callOpen === -1) {
      continue;
    }

    var calleeStart = trimLeading(scrubbed, expressionStart(scrubbed, callOpen), callOpen);

    // The exclusion tests MUST run on the full callee text, not on the
    // truncated display form. `NON_CALLBACK_CALLEES` anchors on the end of
    // the callee, and truncating first cut the trailing `.then` off a long
    // chain -- which let promise links through as callback boundaries. That
    // was measured, not hypothesised.
    var calleeFull = oneLine(original.slice(calleeStart, callOpen));
    var callee = oneLine(calleeFull, 60);
    if (calleeFull === '' || NON_CALLBACK_CALLEES.test(calleeFull) ||
        UNDERSCORE_CALLEE.test(calleeFull)) {
      continue;
    }
    // `new Promise(function (resolve, reject))` is a promise constructor, not
    // a callback boundary; its parameters never match the filter above, but a
    // `new X(function (err) ...)` would, so exclude constructors explicitly.
    if (precedingToken(scrubbed, calleeStart) === 'new') {
      continue;
    }

    boundaries.push({
      line: lineAt(lineIndex, calleeStart),
      callee: callee,
      params: params,
      errorFirst: errorFirst,
      offset: calleeStart,
      endOffset: fn.bodyEnd,
      alreadyAwaited: precedingToken(scrubbed, calleeStart) === 'await'
    });
    re.lastIndex = fn.bodyStart + 1;
  }

  boundaries.sort(function (a, b) {
    return a.line - b.line || a.callee.localeCompare(b.callee);
  });
  return boundaries;
}

/**
 * Stream sites, DERIVED rather than grepped.
 *
 * The plan counts 17 across four controllers and warns that a crude pattern
 * returns 10, so the rule is stated here in full and the result is
 * cross-checked against BASELINE_STREAM_SITES.
 *
 * A stream site is a single source LINE that does one of:
 *   (a) creates a stream          -- createReadStream( / createWriteStream(
 *   (b) pipes one                 -- .pipe(
 *   (c) constructs an archive     -- archiver(
 *   (d) hands one to the response -- reply(<ident>) / h.response(<ident>)
 *                                    where the identifier names a stream
 *   (e) binds a call's result to a stream-named identifier
 *
 * Sites are DEDUPED BY LINE, which matters: `.pipe(fs.createWriteStream(p))`
 * is (a) and (b) at once but is one place a reader has to look, and
 * `outputWriteStream = fs.createWriteStream(zipFile)` is (a) and (e) at once.
 *
 * What is deliberately EXCLUDED is what makes the rule land on 17 rather than
 * on a larger number: `.on('close')` / `.on('error')` lifecycle listeners are
 * attached AT a stream site already counted, and a `.then(function (stream))`
 * parameter merely names a stream without operating on one.
 */
function deriveStreamSites(scrubbed, lineIndex, original) {
  var byLine = Object.create(null);

  function record(offset, reason) {
    var line = lineAt(lineIndex, offset);
    if (!byLine[line]) {
      byLine[line] = { line: line, reasons: [], text: '' };
    }
    if (byLine[line].reasons.indexOf(reason) === -1) {
      byLine[line].reasons.push(reason);
    }
  }

  offsetsOf(scrubbed, /(?<![A-Za-z0-9_$])create(?:Read|Write)Stream\s*\(/).forEach(function (hit) {
    record(hit.index, 'creates a stream');
  });
  offsetsOf(scrubbed, /\.\s*pipe\s*\(/).forEach(function (hit) {
    record(hit.index, 'pipes a stream');
  });
  offsetsOf(scrubbed, /(?<![A-Za-z0-9_$.])archiver\s*\(/).forEach(function (hit) {
    record(hit.index, 'constructs an archive');
  });
  offsetsOf(scrubbed, /(?<![A-Za-z0-9_$])(?:reply|h\.response)\s*\(\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\)/).forEach(function (hit) {
    if (/stream/i.test(hit.match)) {
      record(hit.index, 'hands a stream to the response');
    }
  });
  offsetsOf(scrubbed, /([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*[A-Za-z_$][A-Za-z0-9_$.]*\s*\(/).forEach(function (hit) {
    var name = hit.match.split('=')[0].trim();
    if (/stream/i.test(name)) {
      record(hit.index, 'binds a stream');
    }
  });

  var lines = original.split('\n');
  return Object.keys(byLine).map(function (k) {
    var site = byLine[k];
    site.reasons.sort();
    site.text = oneLine(lines[site.line - 1] || '', 110);
    return site;
  }).sort(function (a, b) {
    return a.line - b.line;
  });
}

/** Count `reply(` call sites -- the shim's fake reply being consumed. */
function countReplySites(scrubbed) {
  return offsetsOf(scrubbed, /(?<![A-Za-z0-9_$.])reply\s*\(/).length;
}

/** Locate every `reply(` call site with its line, for per-row reporting. */
function findReplySites(scrubbed, lineIndex) {
  return offsetsOf(scrubbed, /(?<![A-Za-z0-9_$.])reply\s*\(/).map(function (hit) {
    return { line: lineAt(lineIndex, hit.index), offset: hit.index };
  });
}

/** Count `.then(` / `.catch(` links and `.type()` / `.bytes()` calls. */
function countChainCalls(scrubbed) {
  return {
    then: offsetsOf(scrubbed, /\.\s*then\s*\(/).length,
    catch: offsetsOf(scrubbed, /\.\s*catch\s*\(/).length,
    typeBytes: offsetsOf(scrubbed, /\.\s*(?:type|bytes)\s*\(/).length
  };
}


// ---------------------------------------------------------------------------
// SECTION 7 -- PRE-HANDLER ANALYSIS (lib/util/helpers.js)
// ---------------------------------------------------------------------------

/**
 * Named pre-handlers in lib/util/helpers.js.
 *
 * Two declaration shapes carry a pre-handler body:
 *   module.exports.name = function (request, reply) { ... }
 *   module.exports.name = { assign : '...', method : function (request, reply) { ... } }
 *
 * Only declarations whose function literal has a lifecycle signature count --
 * `(request, reply)` for legacy, `(request, h)` for already-native. That one
 * filter is what makes the census close at 11 legacy pre-handlers, and it does
 * so by excluding exactly the right two things:
 *
 *   `register` is `function (server)`, a server-method registrar, not a
 *   pre-handler at all; and
 *
 *   `lowerUserFields` is an ALIAS -- `module.exports.lowerUserFields =
 *   internals.lowerUserFields;` -- with no function literal at the
 *   declaration. The function it points at is already `(request, h)`.
 *
 * `findFeaturedTrinkets` is found, classified `toolkit`, and reported
 * separately: it is the target pre-handler shape and therefore the exemplar
 * rather than the work.
 */
function findNamedPreHandlers(scrubbed, lineIndex, original) {
  var found = [];
  var re = /(?<![A-Za-z0-9_$.])module\.exports\.([A-Za-z0-9_$]+)\s*=/g;
  var m;

  while ((m = re.exec(scrubbed)) !== null) {
    var name = m[1];
    var valueAt = m.index + m[0].length;

    var direct = readFunctionAt(scrubbed, valueAt);
    if (direct) {
      pushCandidate(name, direct, m.index, null);
      continue;
    }

    // Object-descriptor form: find a top-level `method :` in the literal.
    var i = valueAt;
    while (i < scrubbed.length && /\s/.test(scrubbed[i])) {
      i++;
    }
    if (scrubbed[i] !== '{') {
      // An alias or a non-function value. Recorded so the document can say
      // WHY it is not a row rather than leaving a silent gap.
      found.push({
        name: name,
        line: lineAt(lineIndex, m.index),
        shape: 'alias-or-value',
        params: null,
        signature: 'n/a',
        excerpt: oneLine(original.slice(m.index, scrubbed.indexOf('\n', m.index)), 90)
      });
      continue;
    }
    var objClose = matchDelimiter(scrubbed, i);
    if (objClose === -1) {
      continue;
    }
    var methodHit = /(?<![A-Za-z0-9_$.])method\s*:/.exec(scrubbed.slice(i, objClose));
    if (!methodHit) {
      continue;
    }
    var methodValueAt = i + methodHit.index + methodHit[0].length;
    var nested = readFunctionAt(scrubbed, methodValueAt);
    if (nested) {
      pushCandidate(name, nested, methodValueAt, i);
    }
  }

  function pushCandidate(name, fn, declOffset, descriptorOffset) {
    var params = paramList(scrubbed, fn);
    var signature = classifySignature(params);
    var shapeInfo = analyseFunctionShape(scrubbed, fn);
    found.push({
      name: name,
      line: lineAt(lineIndex, fn.bodyStart),
      declLine: lineAt(lineIndex, declOffset),
      endLine: lineAt(lineIndex, fn.bodyEnd),
      shape: descriptorOffset === null ? 'function' : 'descriptor',
      params: params,
      signature: signature.kind,
      isAsync: fn.isAsync,
      analysis: shapeInfo,
      fn: fn,
      bodyText: scrubbed.slice(fn.bodyStart, fn.bodyEnd + 1)
    });
  }

  found.sort(function (a, b) {
    return a.line - b.line;
  });
  return found;
}

// ---------------------------------------------------------------------------
// SECTION 8 -- THE BINDING GRAPH (config/routes.js, config/api_routes.js)
//
// The conversion set is derived from the binding graph, not from the export
// list. That distinction is not academic: the two disagree in both directions.
// Three routes name a controller method that does not exist, and two exported
// handlers are never routed.
//
// The DSL is a single string: 'METHOD /path controller.handler', split on
// whitespace by lib/util/routeParser.js. Extracting it needs one thing a
// regex over string literals does not give: route strings are sometimes
// CONCATENATED. The per-language expansion in config/routes.js writes
//
//     route : 'GET /' + lang + '/{shortCode} trinket.getByShortCode'
//
// and a literal-only scan silently misses all three such bindings -- which
// then show up as phantom "unrouted" exports. Measured: a literal-only scan
// finds 145 bindings and reports 5 unrouted exports; assembling the
// concatenation finds 148 bindings and reports the correct 2.
//
// assembleRouteExpression() therefore walks the value expression, reads each
// string literal from the ORIGINAL text (the scrubbed copy has blanked their
// interiors) and substitutes a whitespace-free placeholder for every
// non-literal operand, so the whitespace split still yields three fields.
// ---------------------------------------------------------------------------

var INTERPOLATION_PLACEHOLDER = '{lang}';

/**
 * Assemble a route-string expression that may concatenate literals with
 * identifiers. Returns the assembled text, plus whether any non-literal
 * operand took part.
 */
function assembleRouteExpression(scrubbed, original, from, to) {
  var text = '';
  var interpolated = false;
  var i = from;

  while (i < to) {
    var c = scrubbed[i];

    if (/\s/.test(c) || c === '+') {
      i++;
      continue;
    }

    if (c === '"' || c === '\'' || c === '`') {
      var close = scrubbed.indexOf(c, i + 1);
      if (close === -1 || close > to) {
        break;
      }
      text += original.slice(i + 1, close);
      i = close + 1;
      continue;
    }

    // A non-literal operand: consume it and stand a placeholder in its place.
    var start = i;
    while (i < to && !/[\s+"'`]/.test(scrubbed[i])) {
      i++;
    }
    if (i === start) {
      i++;
    }
    text += INTERPOLATION_PLACEHOLDER;
    interpolated = true;
  }

  return { text: text, interpolated: interpolated };
}

/**
 * Every `route :` declaration in a route-config module, with its assembled
 * DSL string split into method, path and controller binding.
 */
function findRouteDeclarations(scrubbed, lineIndex, original, file) {
  var declarations = [];
  var re = /(?<![A-Za-z0-9_$.])route\s*:/g;
  var m;

  while ((m = re.exec(scrubbed)) !== null) {
    var valueStart = m.index + m[0].length;

    // The value runs to the next `,` or `}` at this nesting depth.
    var depth = 0;
    var end = valueStart;
    while (end < scrubbed.length) {
      var c = scrubbed[end];
      if (c === '(' || c === '[' || c === '{') {
        depth++;
      } else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) {
          break;
        }
        depth--;
      } else if (c === ',' && depth === 0) {
        break;
      }
      end++;
    }

    var assembled = assembleRouteExpression(scrubbed, original, valueStart, end);
    var fields = assembled.text.trim().split(/\s+/);
    declarations.push({
      file: file,
      line: lineAt(lineIndex, m.index),
      method: fields[0] || '',
      path: fields[1] || '',
      binding: fields[2] || '',
      interpolated: assembled.interpolated
    });
    re.lastIndex = end;
  }

  return declarations;
}

/** `helpers.<name>` references inside a route-config module. */
function findPreHandlerReferences(scrubbed) {
  var names = Object.create(null);
  offsetsOf(scrubbed, /(?<![A-Za-z0-9_$.])helpers\.([A-Za-z0-9_$]+)/).forEach(function (hit) {
    names[hit.match.slice('helpers.'.length)] = true;
  });
  return Object.keys(names).sort();
}

/**
 * Inline pre-handlers: function literals declared directly inside a `pre :`
 * array in a route-config module. There is exactly one at the base commit --
 * config/api_routes.js:1104, on POST /api/users/login -- and it is the single
 * member of its own category in the conversion set.
 */
function findInlinePreHandlers(scrubbed, lineIndex, original, file) {
  var found = [];
  var re = /(?<![A-Za-z0-9_$.])pre\s*:/g;
  var m;

  while ((m = re.exec(scrubbed)) !== null) {
    var i = m.index + m[0].length;
    while (i < scrubbed.length && /\s/.test(scrubbed[i])) {
      i++;
    }
    if (scrubbed[i] !== '[') {
      continue;
    }
    var close = matchDelimiter(scrubbed, i);
    if (close === -1) {
      continue;
    }

    var inner = /(?<![A-Za-z0-9_$])(?:async\s+)?function(?![A-Za-z0-9_$])/g;
    var region = scrubbed.slice(i, close);
    var hit;
    while ((hit = inner.exec(region)) !== null) {
      var abs = i + hit.index;
      var fn = readFunctionAt(scrubbed, abs);
      if (!fn) {
        continue;
      }
      found.push({
        file: file,
        line: lineAt(lineIndex, abs),
        params: paramList(scrubbed, fn),
        signature: classifySignature(paramList(scrubbed, fn)).kind,
        isAsync: fn.isAsync,
        analysis: analyseFunctionShape(scrubbed, fn),
        excerpt: oneLine(original.slice(abs, fn.bodyEnd + 1), 120)
      });
      inner.lastIndex = fn.bodyEnd - i;
    }
    re.lastIndex = close;
  }

  found.sort(function (a, b) {
    return a.line - b.line;
  });
  return found;
}


// ---------------------------------------------------------------------------
// SECTION 9 -- REPLY CHAINS
//
// In the shim's builder (lib/util/routeParser.js:375-405) these four methods
// resolve the deferred and hand back a real hapi response...
var RESOLVING_BUILDER_METHODS = ['redirect', 'code', 'header', 'view'];
// ...while these two mutate the response and hand back the BUILDER, leaving
// the deferred unsettled.
var NON_RESOLVING_BUILDER_METHODS = ['type', 'bytes'];
//
// So the outcome of a chain is decided by which method ran LAST, and the eight
// chains in this repository fall into three groups because of it. That makes
// the classification derivable from the text after all -- given the knowledge
// above, which is why it is written down here -- so the analysis DERIVES the
// category and then cross-checks it against REPLY_CHAIN_ROSTER. Two
// independent routes to the same answer is the point: a disagreement between
// them is a self-check failure rather than a silent reclassification.
// ---------------------------------------------------------------------------

/**
 * Find `reply(...)` / `h.response(...)` expressions carrying at least one
 * `.type()` or `.bytes()` link, and classify each.
 *
 *   never-settles     -- only non-resolving links, and the chain's value is
 *                        not returned either: nothing ever produces a response
 *   builder-returned  -- only non-resolving links, but the chain IS returned,
 *                        so hapi receives the builder object rather than a
 *                        response
 *   header-resolved   -- reaches a resolving link, so a real hapi response is
 *                        produced and the chain works
 */
function findReplyChains(scrubbed, lineIndex, original) {
  var chains = [];
  var re = /(?<![A-Za-z0-9_$.])(reply|h\.response)\s*\(/g;
  var m;

  while ((m = re.exec(scrubbed)) !== null) {
    var rootStart = m.index;
    var open = scrubbed.indexOf('(', rootStart);
    var close = matchDelimiter(scrubbed, open);
    if (close === -1) {
      continue;
    }

    var links = [];
    var cursor = close;
    for (;;) {
      var i = cursor + 1;
      while (i < scrubbed.length && /\s/.test(scrubbed[i])) {
        i++;
      }
      if (scrubbed[i] !== '.') {
        break;
      }
      var nameStart = i + 1;
      while (nameStart < scrubbed.length && /\s/.test(scrubbed[nameStart])) {
        nameStart++;
      }
      var nameEnd = nameStart;
      while (nameEnd < scrubbed.length && /[A-Za-z0-9_$]/.test(scrubbed[nameEnd])) {
        nameEnd++;
      }
      var linkName = scrubbed.slice(nameStart, nameEnd);
      var linkOpen = nameEnd;
      while (linkOpen < scrubbed.length && /\s/.test(scrubbed[linkOpen])) {
        linkOpen++;
      }
      if (scrubbed[linkOpen] !== '(') {
        break;
      }
      var linkClose = matchDelimiter(scrubbed, linkOpen);
      if (linkClose === -1) {
        break;
      }
      links.push({ name: linkName, open: linkOpen, close: linkClose });
      cursor = linkClose;
    }

    var linkNames = links.map(function (l) {
      return l.name;
    });
    var carriesTypeOrBytes = linkNames.some(function (n) {
      return NON_RESOLVING_BUILDER_METHODS.indexOf(n) !== -1;
    });
    if (!carriesTypeOrBytes) {
      re.lastIndex = close;
      continue;
    }

    var resolvesAt = linkNames.filter(function (n) {
      return RESOLVING_BUILDER_METHODS.indexOf(n) !== -1;
    });
    var returned = isInReturnPosition(scrubbed, rootStart);

    var category;
    if (resolvesAt.length > 0) {
      category = 'header-resolved';
    } else if (returned) {
      category = 'builder-returned';
    } else {
      category = 'never-settles';
    }

    chains.push({
      root: m[1],
      startLine: lineAt(lineIndex, rootStart),
      endLine: lineAt(lineIndex, cursor),
      links: linkNames,
      resolvingLinks: resolvesAt,
      returned: returned,
      category: category,
      typeBytesCalls: linkNames.filter(function (n) {
        return NON_RESOLVING_BUILDER_METHODS.indexOf(n) !== -1;
      }).length,
      excerpt: oneLine(original.slice(rootStart, cursor + 1), 130)
    });

    re.lastIndex = cursor;
  }

  chains.sort(function (a, b) {
    return a.startLine - b.startLine;
  });
  return chains;
}

/**
 * `reply(...)` call sites that are NOT returned and carry no chain at all --
 * the shape at lib/controllers/trinket.js:375, where `reply(err)` on an error
 * path relies entirely on the deferred.
 */
function findUnreturnedBareReplies(scrubbed, lineIndex, original) {
  var found = [];
  offsetsOf(scrubbed, /(?<![A-Za-z0-9_$.])reply\s*\(/).forEach(function (hit) {
    var open = scrubbed.indexOf('(', hit.index);
    var close = matchDelimiter(scrubbed, open);
    if (close === -1) {
      return;
    }
    if (isInReturnPosition(scrubbed, hit.index)) {
      return;
    }
    // Skip anything with a following `.` link -- those are reply chains.
    var i = close + 1;
    while (i < scrubbed.length && /\s/.test(scrubbed[i])) {
      i++;
    }
    if (scrubbed[i] === '.') {
      return;
    }
    found.push({
      line: lineAt(lineIndex, hit.index),
      excerpt: oneLine(original.slice(hit.index, close + 1), 90)
    });
  });
  return found.sort(function (a, b) {
    return a.line - b.line;
  });
}

// ---------------------------------------------------------------------------
// SECTION 10 -- SELF-CHECKS
//
// Three tiers, because the analysed tree may legitimately be at the base
// commit OR partway through the conversion OR finished, and a check that
// cannot tell those apart is either useless or wrong.
//
//   TIER 1  INVARIANTS. Must hold on ANY tree. The conversion changes
//           signatures and bodies; it does not add or remove a handler, a
//           route declaration or a binding. These are the checks that catch a
//           tokenizer desync, which is the whole reason the self-check exists:
//           a desynchronized scrub loses exports and the census collapses.
//
//   TIER 2  BASELINE-CALIBRATED. Progress metrics -- reply sites, chain
//           counts, stream sites, legacy signatures. Asserted EXACTLY when the
//           analysed tree is at the base commit. On any other tree an exact
//           assertion would be a category error: a converted tree has fewer
//           `reply(` sites BY DESIGN, and failing there would make the tool
//           unable to demonstrate the very progress it exists to demonstrate.
//
//   TIER 3  DIRECTIONAL. Off baseline, the one direction that is still
//           meaningful is enforced: `reply(` sites may fall but must never
//           rise above the baseline figure. Everything else is reported as a
//           delta so a reviewer sees movement rather than a bare pass.
// ---------------------------------------------------------------------------

function runSelfChecks(model) {
  var failures = [];
  var notes = [];
  var atBaseline = model.provenance.atBaseline;

  function invariant(ok, message) {
    if (!ok) {
      failures.push({ tier: 1, message: message });
    }
  }
  function calibrated(ok, message) {
    if (ok) {
      return;
    }
    if (atBaseline) {
      failures.push({ tier: 2, message: message });
    } else {
      notes.push(message);
    }
  }

  // --- TIER 1 -------------------------------------------------------------
  model.files.forEach(function (f) {
    invariant(
      f.scrubbedLength === f.originalLength,
      'Tokenizer changed the length of ' + f.path + ' (' + f.originalLength +
        ' -> ' + f.scrubbedLength + '). Offsets and line numbers would be wrong.'
    );
    invariant(
      f.balance.balanced,
      'Tokenizer desynchronized on ' + f.path + ': unbalanced delimiters after scrubbing ' +
        '(paren ' + f.balance.counts.paren + ', bracket ' + f.balance.counts.bracket +
        ', brace ' + f.balance.counts.brace + '). A regex literal or comment was almost ' +
        'certainly mis-tokenized -- see config/routes.js and lib/controllers/trinket.js:625.'
    );
  });

  invariant(
    model.exportTotal === BASELINE_EXPORTS_TOTAL,
    'Controller handler exports: found ' + model.exportTotal + ', expected ' +
      BASELINE_EXPORTS_TOTAL + '. Conversion never adds or removes an export, so this is ' +
      'an analysis fault, not conversion progress.'
  );
  CONTROLLERS.forEach(function (name) {
    var found = model.exportsByController[name] || 0;
    invariant(
      found === BASELINE_EXPORTS[name],
      'Handler exports in lib/controllers/' + name + '.js: found ' + found +
        ', expected ' + BASELINE_EXPORTS[name] + '.'
    );
  });

  invariant(
    model.routeDeclarations === 178,
    'Route declarations across config/routes.js and config/api_routes.js: found ' +
      model.routeDeclarations + ', expected 178 (62 + 116).'
  );
  invariant(
    model.routedHandlers === CONVERSION_SET.routedHandlers,
    'Routed handlers derived from the binding graph: found ' + model.routedHandlers +
      ', expected ' + CONVERSION_SET.routedHandlers + '. If this reads 142, the ' +
      'concatenated route strings in the per-language expansion were missed.'
  );
  invariant(
    sameSet(model.missingBindings, EXCLUDED_MISSING_BINDINGS.map(function (b) {
      return b.binding;
    })),
    'Routes naming a nonexistent controller method: found [' + model.missingBindings.join(', ') +
      '], expected [' + EXCLUDED_MISSING_BINDINGS.map(function (b) {
        return b.binding;
      }).join(', ') + '].'
  );
  invariant(
    sameSet(model.unroutedExports, EXCLUDED_UNROUTED_EXPORTS),
    'Defined-but-unrouted controller exports: found [' + model.unroutedExports.join(', ') +
      '], expected [' + EXCLUDED_UNROUTED_EXPORTS.join(', ') + '].'
  );
  invariant(
    model.routedPreHandlerNames.length + model.unroutedPreHandlerNames.length ===
      BASELINE_NAMED_PRE_HANDLERS,
    'Named pre-handlers with a lifecycle signature in lib/util/helpers.js: found ' +
      (model.routedPreHandlerNames.length + model.unroutedPreHandlerNames.length) +
      ', expected ' + BASELINE_NAMED_PRE_HANDLERS + ' legacy-or-converted plus the ' +
      'already-native findFeaturedTrinkets.'
  );
  invariant(
    model.routedPreHandlerNames.length === CONVERSION_SET.routedPreHandlers,
    'Routed named pre-handlers: found ' + model.routedPreHandlerNames.length +
      ', expected ' + CONVERSION_SET.routedPreHandlers + '.'
  );
  invariant(
    sameSet(model.unroutedPreHandlerNames, EXCLUDED_UNROUTED_PRE_HANDLERS),
    'Unrouted named pre-handlers: found [' + model.unroutedPreHandlerNames.join(', ') +
      '], expected [' + EXCLUDED_UNROUTED_PRE_HANDLERS.join(', ') + '].'
  );
  invariant(
    model.inlinePreHandlers.length === CONVERSION_SET.inlinePreHandlers,
    'Inline pre-handlers in the route configs: found ' + model.inlinePreHandlers.length +
      ', expected ' + CONVERSION_SET.inlinePreHandlers + ' (config/api_routes.js:1104).'
  );
  invariant(
    CONVERSION_SET.routedHandlers + CONVERSION_SET.routedPreHandlers +
      CONVERSION_SET.inlinePreHandlers === CONVERSION_SET.total,
    'Conversion-set arithmetic does not close: ' + CONVERSION_SET.routedHandlers + ' + ' +
      CONVERSION_SET.routedPreHandlers + ' + ' + CONVERSION_SET.inlinePreHandlers +
      ' != ' + CONVERSION_SET.total + '.'
  );

  // --- TIER 2 -------------------------------------------------------------
  calibrated(
    model.replySitesTotal === BASELINE_REPLY_SITES_TOTAL,
    'reply( call sites: found ' + model.replySitesTotal + ', baseline ' +
      BASELINE_REPLY_SITES_TOTAL + '.'
  );
  CONTROLLERS.forEach(function (name) {
    var found = model.replySitesByController[name] || 0;
    calibrated(
      found === BASELINE_REPLY_SITES[name],
      'reply( sites in lib/controllers/' + name + '.js: found ' + found + ', baseline ' +
        BASELINE_REPLY_SITES[name] + '.'
    );
  });
  calibrated(
    model.replySitesHelpers === BASELINE_REPLY_SITES_HELPERS,
    'reply( sites in lib/util/helpers.js: found ' + model.replySitesHelpers +
      ', baseline ' + BASELINE_REPLY_SITES_HELPERS + '.'
  );
  calibrated(
    model.replySitesInline === BASELINE_REPLY_SITES_INLINE,
    'reply( sites in config/api_routes.js: found ' + model.replySitesInline +
      ', baseline ' + BASELINE_REPLY_SITES_INLINE + '.'
  );
  calibrated(
    model.thenCalls === BASELINE_THEN_CALLS,
    '.then( links across the ten controllers: found ' + model.thenCalls + ', baseline ' +
      BASELINE_THEN_CALLS + '.'
  );
  calibrated(
    model.catchCalls === BASELINE_CATCH_CALLS,
    '.catch( links across the ten controllers: found ' + model.catchCalls + ', baseline ' +
      BASELINE_CATCH_CALLS + '.'
  );
  calibrated(
    model.typeBytesCalls === BASELINE_TYPE_BYTES_CALLS,
    '.type() / .bytes() calls across the ten controllers: found ' + model.typeBytesCalls +
      ', baseline ' + BASELINE_TYPE_BYTES_CALLS + '.'
  );
  calibrated(
    model.streamSiteTotal === BASELINE_STREAM_SITES,
    'Derived stream sites: found ' + model.streamSiteTotal + ', baseline ' +
      BASELINE_STREAM_SITES + '. This figure is DERIVED (see deriveStreamSites) rather ' +
      'than grepped -- a crude pattern returns 10 -- so a mismatch means the rule needs ' +
      'review, not that the rule is wrong.'
  );
  Object.keys(BASELINE_STREAM_CONTROLLERS).forEach(function (name) {
    var found = (model.streamSitesByController[name] || []).length;
    calibrated(
      found === BASELINE_STREAM_CONTROLLERS[name],
      'Stream sites in lib/controllers/' + name + '.js: found ' + found + ', baseline ' +
        BASELINE_STREAM_CONTROLLERS[name] + '.'
    );
  });
  calibrated(
    model.promiseChains.length === BASELINE_PROMISE_CHAINS,
    'Promise chains derived across the ten controllers: found ' +
      model.promiseChains.length + ', baseline ' + BASELINE_PROMISE_CHAINS + '.'
  );
  calibrated(
    model.promiseChains.filter(function (c) {
      return !isChainClosed(c);
    }).length === BASELINE_PROMISE_CHAINS_OPEN,
    'Open promise chains: found ' + model.promiseChains.filter(function (c) {
      return !isChainClosed(c);
    }).length + ', baseline ' + BASELINE_PROMISE_CHAINS_OPEN + '.'
  );
  calibrated(
    model.callbackBoundaries.length === BASELINE_CALLBACK_BOUNDARIES,
    'Callback boundaries derived across the ten controllers: found ' +
      model.callbackBoundaries.length + ', baseline ' + BASELINE_CALLBACK_BOUNDARIES + '.'
  );
  calibrated(
    model.legacyPreHandlerCount === BASELINE_NAMED_PRE_HANDLERS,
    'Named pre-handlers still declared (request, reply): found ' +
      model.legacyPreHandlerCount + ', baseline ' + BASELINE_NAMED_PRE_HANDLERS + '.'
  );

  // The reply-chain roster, cross-checked against the derived classification.
  // At the base commit the two must agree exactly, chain for chain and line
  // for line -- which is what makes the eight entries in the document evidence
  // rather than transcription.
  var derived = model.replyChains.filter(function (c) {
    return c.root === 'reply';
  });
  calibrated(
    derived.length === REPLY_CHAIN_ROSTER.length,
    'Reply chains carrying .type()/.bytes(): derived ' + derived.length + ', roster has ' +
      REPLY_CHAIN_ROSTER.length + '.'
  );
  REPLY_CHAIN_ROSTER.forEach(function (entry) {
    var match = derived.filter(function (c) {
      return c.file === entry.file && c.startLine === entry.startLine;
    })[0];
    calibrated(
      !!match,
      'Reply chain ' + entry.file + ':' + entry.lines + ' (' + entry.category +
        ') was not found at its baseline coordinates.'
    );
    if (match) {
      calibrated(
        match.category === entry.category,
        'Reply chain ' + entry.file + ':' + entry.lines + ' derived as ' + match.category +
          ' but the roster records ' + entry.category + '.'
      );
    }
  });
  ['never-settles', 'header-resolved', 'builder-returned'].forEach(function (cat) {
    var expected = REPLY_CHAIN_ROSTER.filter(function (e) {
      return e.category === cat;
    }).length;
    var got = derived.filter(function (c) {
      return c.category === cat;
    }).length;
    calibrated(
      expected === got,
      'Reply chains in category ' + cat + ': derived ' + got + ', roster has ' + expected + '.'
    );
  });

  // --- TIER 3 -------------------------------------------------------------
  if (!atBaseline) {
    if (model.replySitesTotal > BASELINE_REPLY_SITES_TOTAL) {
      failures.push({
        tier: 3,
        message: 'reply( call sites ROSE to ' + model.replySitesTotal + ' from a baseline of ' +
          BASELINE_REPLY_SITES_TOTAL + '. Conversion removes these sites; it never adds them, ' +
          'so this is either a regression or an analysis fault.'
      });
    }
    if (model.exportTotal !== BASELINE_EXPORTS_TOTAL) {
      failures.push({
        tier: 3,
        message: 'The handler census moved off ' + BASELINE_EXPORTS_TOTAL + '. Routes are an ' +
          'invariant of this migration, so a handler cannot appear or disappear.'
      });
    }
  }

  return { failures: failures, notes: notes, atBaseline: atBaseline };
}

/** Order-insensitive set comparison over string arrays. */
function sameSet(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  var sortedA = a.slice().sort();
  var sortedB = b.slice().sort();
  return sortedA.every(function (v, i) {
    return v === sortedB[i];
  });
}


// ---------------------------------------------------------------------------
// SECTION 11 -- PROVENANCE
// ---------------------------------------------------------------------------

/**
 * `git rev-parse HEAD` in a directory, or null.
 *
 * stdio is fully piped: git writes "not a git repository" to stderr, and this
 * tool's stderr is inside the zero-warning gate's captured stream, so it must
 * not leak. A tree with no git metadata is a legitimate input -- the point of
 * --app is that it may be an exported directory -- so failure is a null, not
 * an error.
 */
function gitHead(cwd) {
  try {
    var out = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15000
    });
    return out.trim() || null;
  } catch (err) {
    return null;
  }
}

/** Short-hash comparison, so a full SHA matches the abbreviated base commit. */
function isCommit(head, shortSha) {
  return typeof head === 'string' && head.indexOf(shortSha) === 0;
}

// ---------------------------------------------------------------------------
// SECTION 12 -- MODEL CONSTRUCTION
// ---------------------------------------------------------------------------

var CONTROLLER_DIR = 'lib/controllers';
var HELPERS_PATH = 'lib/util/helpers.js';
var ROUTE_CONFIGS = ['config/routes.js', 'config/api_routes.js'];

/** Read, scrub and index one source file. Throws a usage error if absent. */
function loadFile(appRoot, relPath) {
  var abs = path.join(appRoot, relPath);
  var original;
  try {
    original = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    throw usageError('Cannot read ' + relPath + ' under ' + appRoot + ': ' + err.message +
      '\nIs --app pointing at a trinket-oss worktree?');
  }
  var scrubbed = scrubSource(original);
  return {
    path: relPath,
    original: original,
    scrubbed: scrubbed,
    lineIndex: buildLineIndex(scrubbed),
    originalLength: original.length,
    scrubbedLength: scrubbed.length,
    balance: checkDelimiterBalance(scrubbed)
  };
}

/**
 * Analyse a whole tree and return the model the renderer and the self-checks
 * both consume. Nothing here requires application code: every input is read
 * as text, which is what keeps lib/controllers/users.js from creating the
 * exports queue and loading the AWS SDK inside a static generator.
 */
function analyseTree(appRoot) {
  var files = [];
  var model = {
    appRoot: appRoot,
    files: files,
    controllers: {},
    exportsByController: {},
    exportTotal: 0,
    replySitesByController: {},
    replySitesTotal: 0,
    replySitesHelpers: 0,
    replySitesInline: 0,
    thenCalls: 0,
    catchCalls: 0,
    typeBytesCalls: 0,
    promiseChains: [],
    callbackBoundaries: [],
    replyChains: [],
    bareReplies: [],
    streamSitesByController: {},
    streamSiteTotal: 0,
    handlers: [],
    preHandlers: [],
    inlinePreHandlers: [],
    routeDeclarations: 0,
    bindings: [],
    routedHandlers: 0,
    missingBindings: [],
    unroutedExports: [],
    routedPreHandlerNames: [],
    unroutedPreHandlerNames: [],
    legacyPreHandlerCount: 0,
    nativePreHandlers: []
  };

  // --- controllers --------------------------------------------------------
  var exportKeys = Object.create(null);

  CONTROLLERS.forEach(function (name) {
    var relPath = CONTROLLER_DIR + '/' + name + '.js';
    var file = loadFile(appRoot, relPath);
    files.push(file);

    var exportsFound = findControllerExports(file.scrubbed, file.lineIndex);
    model.exportsByController[name] = exportsFound.length;
    model.exportTotal += exportsFound.length;

    exportsFound.forEach(function (entry) {
      exportKeys[name + '.' + entry.name] = true;
      var signature = classifySignature(entry.params);
      model.handlers.push({
        controller: name,
        file: relPath,
        name: entry.name,
        binding: name + '.' + entry.name,
        line: entry.line,
        endLine: entry.endLine,
        params: entry.params,
        signature: signature.kind,
        isAsync: entry.fn.isAsync,
        analysis: analyseFunctionShape(file.scrubbed, entry.fn),
        // Retained so the gate evidence in section 13 can read the body as
        // text without re-parsing the file.
        bodyText: file.scrubbed.slice(entry.fn.bodyStart, entry.fn.bodyEnd + 1)
      });
    });

    var replies = findReplySites(file.scrubbed, file.lineIndex);
    model.replySitesByController[name] = replies.length;
    model.replySitesTotal += replies.length;

    var counts = countChainCalls(file.scrubbed);
    model.thenCalls += counts.then;
    model.catchCalls += counts.catch;
    model.typeBytesCalls += counts.typeBytes;

    findPromiseChains(file.scrubbed, file.lineIndex, file.original).forEach(function (chain) {
      chain.file = relPath;
      chain.controller = name;
      chain.enclosing = enclosingHandlerName(model.handlers, relPath, chain.startLine);
      model.promiseChains.push(chain);
    });

    findCallbackBoundaries(file.scrubbed, file.lineIndex, file.original).forEach(function (cb) {
      cb.file = relPath;
      cb.controller = name;
      cb.enclosing = enclosingHandlerName(model.handlers, relPath, cb.line);
      model.callbackBoundaries.push(cb);
    });

    findReplyChains(file.scrubbed, file.lineIndex, file.original).forEach(function (chain) {
      chain.file = relPath;
      chain.controller = name;
      model.replyChains.push(chain);
    });

    findUnreturnedBareReplies(file.scrubbed, file.lineIndex, file.original).forEach(function (site) {
      site.file = relPath;
      site.controller = name;
      site.enclosing = enclosingHandlerName(model.handlers, relPath, site.line);
      model.bareReplies.push(site);
    });

    var streams = deriveStreamSites(file.scrubbed, file.lineIndex, file.original);
    if (streams.length > 0) {
      streams.forEach(function (site) {
        site.file = relPath;
        site.controller = name;
        site.enclosing = enclosingHandlerName(model.handlers, relPath, site.line);
      });
      model.streamSitesByController[name] = streams;
      model.streamSiteTotal += streams.length;
    }
  });

  // --- pre-handlers -------------------------------------------------------
  var helpers = loadFile(appRoot, HELPERS_PATH);
  files.push(helpers);
  model.replySitesHelpers = countReplySites(helpers.scrubbed);
  model.replySitesTotal += model.replySitesHelpers;

  var declared = findNamedPreHandlers(helpers.scrubbed, helpers.lineIndex, helpers.original);
  model.preHandlerDeclarations = declared;
  model.nativePreHandlers = declared.filter(function (d) {
    return d.signature === 'toolkit';
  });
  model.legacyPreHandlerCount = declared.filter(function (d) {
    return d.signature === 'legacy';
  }).length;

  // --- route configs ------------------------------------------------------
  var preHandlerRefs = Object.create(null);
  ROUTE_CONFIGS.forEach(function (relPath) {
    var file = loadFile(appRoot, relPath);
    files.push(file);

    var declarations = findRouteDeclarations(file.scrubbed, file.lineIndex, file.original, relPath);
    model.routeDeclarations += declarations.length;
    declarations.forEach(function (d) {
      model.bindings.push(d);
    });

    findPreHandlerReferences(file.scrubbed).forEach(function (n) {
      preHandlerRefs[n] = true;
    });

    findInlinePreHandlers(file.scrubbed, file.lineIndex, file.original, relPath)
      .forEach(function (inline) {
        model.inlinePreHandlers.push(inline);
      });

    if (relPath === 'config/api_routes.js') {
      model.replySitesInline = countReplySites(file.scrubbed);
      model.replySitesTotal += model.replySitesInline;
    }
  });

  // --- the binding graph --------------------------------------------------
  var distinct = Object.create(null);
  model.bindings.forEach(function (d) {
    if (d.binding) {
      if (!distinct[d.binding]) {
        distinct[d.binding] = [];
      }
      distinct[d.binding].push(d);
    }
  });
  var bindingNames = Object.keys(distinct).sort();
  model.distinctBindings = bindingNames.length;
  model.interpolatedDeclarations = model.bindings.filter(function (d) {
    return d.interpolated;
  }).length;

  model.missingBindings = bindingNames.filter(function (b) {
    return !exportKeys[b];
  });
  model.routedHandlers = bindingNames.length - model.missingBindings.length;
  model.unroutedExports = Object.keys(exportKeys).filter(function (k) {
    return !distinct[k];
  }).sort();

  // Route references per handler, so a handler row can say how many route
  // declarations reach it -- the per-language expansion multiplies several.
  model.handlers.forEach(function (h) {
    h.routeDeclarations = (distinct[h.binding] || []).length;
    h.routed = h.routeDeclarations > 0;
  });

  // --- pre-handler routing ------------------------------------------------
  var legacyOrConverted = declared.filter(function (d) {
    return d.signature === 'legacy' || d.signature === 'toolkit';
  });
  legacyOrConverted.forEach(function (d) {
    d.routed = !!preHandlerRefs[d.name];
  });
  // findFeaturedTrinkets is routed AND already native, so it is the exemplar
  // rather than a row. Excluding it here is what makes 11 = 8 + 3 close, and
  // the document says so out loud rather than leaving the arithmetic implicit.
  var conversionScoped = legacyOrConverted.filter(function (d) {
    return BASELINE_NAMED_PRE_HANDLER_NAMES.indexOf(d.name) !== -1;
  });
  model.preHandlers = conversionScoped;
  model.routedPreHandlerNames = conversionScoped.filter(function (d) {
    return d.routed;
  }).map(function (d) {
    return d.name;
  }).sort();
  model.unroutedPreHandlerNames = conversionScoped.filter(function (d) {
    return !d.routed;
  }).map(function (d) {
    return d.name;
  }).sort();
  model.preHandlerReferences = Object.keys(preHandlerRefs).sort();

  // --- gate evidence for the five unrouted functions ----------------------
  // Only the unrouted ones are measured. The routed ones are in the
  // conversion set unconditionally, so a gate determination for them would be
  // noise -- and findReferences() walks the tree, which is not free.
  model.handlers.forEach(function (h) {
    if (!h.routed) {
      h.gate = gateEvidence(appRoot, h.file, h.name, h.bodyText);
    }
  });
  model.preHandlers.forEach(function (p) {
    if (!p.routed) {
      p.gate = gateEvidence(appRoot, HELPERS_PATH, p.name, p.bodyText || '');
    }
  });

  // --- provenance ---------------------------------------------------------
  var appHead = gitHead(appRoot);
  var toolHead = gitHead(__dirname);
  model.provenance = {
    appRoot: appRoot,
    appHead: appHead,
    toolHead: toolHead,
    atBaseline: isCommit(appHead, BASELINE_COMMIT),
    nodeVersion: process.version
  };

  return model;
}

/**
 * The eleven pre-handlers that ARE the conversion scope, identified by name
 * rather than by signature so that the census stays stable as sites convert:
 * once a routed pre-handler becomes `(request, h)` its signature changes, and
 * a signature-only filter would silently drop it from its own checklist.
 */
var BASELINE_NAMED_PRE_HANDLER_NAMES = [
  'findTrinket', 'validLang', 'trinketTypeEnabled', 'coursesEnabled',
  'verifyEmailToken', 'toLowerCaseURI', 'logUnauth', 'getDefaultTrinket',
  'userByUsername', 'courseBySlug', 'trinketByOwnerAndSlug'
];

/** Name of the exported handler whose body contains `line`, or null. */
function enclosingHandlerName(handlers, file, line) {
  for (var i = 0; i < handlers.length; i++) {
    var h = handlers[i];
    if (h.file === file && line >= h.line && line <= h.endLine) {
      return h.name;
    }
  }
  return null;
}


// ---------------------------------------------------------------------------
// SECTION 13 -- GATE EVIDENCE FOR THE UNROUTED FUNCTIONS
//
// The five defined-but-unrouted functions -- two controller exports and three
// named pre-handlers -- are not hapi-facing work under blocking-only scope.
// They convert only if another gate independently forces it, and the plan is
// explicit that the determination must be RECORDED per function rather than
// assumed. Two gates can force one:
//
//   the deprecation bar   -- a Node-core deprecated API inside the body
//   the repaired suite    -- a reference from any spec or test helper
//
// Both are measured below, by text scan, and both answers go in the document
// next to the function they describe.
// ---------------------------------------------------------------------------

// APIs that emit a deprecation warning on Node 22 and would therefore drag a
// function into scope through the zero-warning gate regardless of routing.
var DEPRECATED_API_PATTERNS = [
  { pattern: /(?<![A-Za-z0-9_$.])new\s+Buffer\s*\(/, label: 'new Buffer( (DEP0005)' },
  { pattern: /(?<![A-Za-z0-9_$])url\s*\.\s*parse\s*\(/, label: 'url.parse( (DEP0169)' },
  { pattern: /(?<![A-Za-z0-9_$.])parseUrl\s*\(/, label: 'parseUrl( alias of url.parse (DEP0169)' },
  { pattern: /(?<![A-Za-z0-9_$])server\s*\.\s*inject\s*\(/, label: 'server.inject( (DEP0169 via @hapi/shot)' }
];

/** Deprecated-API labels present in a body excerpt. */
function deprecatedApisIn(bodyText) {
  return DEPRECATED_API_PATTERNS.filter(function (entry) {
    return entry.pattern.test(bodyText);
  }).map(function (entry) {
    return entry.label;
  });
}

/** Collect *.js paths under a directory, bounded in depth and count. */
function collectJsFiles(root, relDir, maxDepth, out) {
  if (maxDepth < 0 || out.length > 4000) {
    return out;
  }
  var abs = path.join(root, relDir);
  var entries;
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch (err) {
    return out;
  }
  entries.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
  entries.forEach(function (entry) {
    var rel = relDir ? relDir + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.charAt(0) === '.') {
        return;
      }
      collectJsFiles(root, rel, maxDepth - 1, out);
    } else if (entry.isFile() && /\.js$/.test(entry.name)) {
      out.push(rel);
    }
  });
  return out;
}

/**
 * Where an identifier is referenced across the application and the suite,
 * excluding the file that defines it. Files are read as TEXT and scrubbed, so
 * a mention inside a comment or a string does not count as a reference -- and
 * nothing under test/lib or test/helpers is ever REQUIRED, only read.
 */
function findReferences(appRoot, identifier, excludePath) {
  var searchRoots = ['lib', 'test/lib', 'test/helpers', 'config'];
  var pattern = new RegExp('(?<![A-Za-z0-9_$])' + identifier + '(?![A-Za-z0-9_$])');
  var hits = [];

  searchRoots.forEach(function (dir) {
    collectJsFiles(appRoot, dir, 6, []).forEach(function (rel) {
      if (rel === excludePath) {
        return;
      }
      var text;
      try {
        text = fs.readFileSync(path.join(appRoot, rel), 'utf8');
      } catch (err) {
        return;
      }
      if (text.indexOf(identifier) === -1) {
        return;
      }
      var scrubbed = scrubSource(text);
      if (pattern.test(scrubbed)) {
        hits.push(rel);
      }
    });
  });

  return hits.sort();
}

/** Per-function gate evidence for one unrouted function. */
function gateEvidence(appRoot, definedIn, identifier, bodyText) {
  var deprecated = deprecatedApisIn(bodyText);
  var references = findReferences(appRoot, identifier, definedIn);
  var suiteReferences = references.filter(function (rel) {
    return rel.indexOf('test/') === 0;
  });

  var forced = deprecated.length > 0 || suiteReferences.length > 0;
  var reasons = [];
  if (deprecated.length > 0) {
    reasons.push('deprecation bar: body uses ' + deprecated.join(', '));
  } else {
    reasons.push('deprecation bar: no deprecated Node-core API in the body');
  }
  if (suiteReferences.length > 0) {
    reasons.push('repaired suite: referenced by ' + suiteReferences.join(', '));
  } else {
    reasons.push('repaired suite: no reference from test/lib or test/helpers');
  }

  return {
    forced: forced,
    determination: forced
      ? 'CONVERT -- an independent gate forces it'
      : 'DO NOT CONVERT -- no gate forces it under blocking-only scope',
    reasons: reasons,
    references: references
  };
}

// ---------------------------------------------------------------------------
// SECTION 14 -- MARKDOWN RENDERING
//
// Ordering is fixed everywhere -- controllers in the order of CONTROLLERS,
// then by line -- so re-running against a partially converted tree shows rows
// CLOSING rather than reshuffling, and a diff of two runs is readable. The
// only part of the document that varies between two runs over the same tree is
// the provenance front matter.
// ---------------------------------------------------------------------------

function box(done) {
  return done ? '[x]' : '[ ]';
}

/** Human description of a handler's or pre-handler's measured current shape. */
function describeCurrentShape(entry) {
  var sig = '`(' + entry.params + ')`';
  var a = entry.analysis;
  var parts = [];

  if (entry.signature === 'legacy') {
    parts.push('legacy ' + sig);
  } else if (entry.signature === 'toolkit') {
    parts.push((entry.isAsync ? 'async ' : '') + 'toolkit ' + sig);
  } else {
    parts.push('non-lifecycle ' + sig);
  }

  if (a.signalCount === 0) {
    parts.push('no `request.success` / `request.fail` / `reply` call in the body');
  } else if (a.unreturnedSignals > 0) {
    parts.push('RELIES ON THE INTERCEPTION -- ' + a.unreturnedSignals + ' of ' +
      a.signalCount + ' signalling call' + (a.signalCount === 1 ? '' : 's') +
      ' not returned');
  } else {
    parts.push('returns its response -- all ' + a.signalCount + ' signalling call' +
      (a.signalCount === 1 ? '' : 's') + ' in return position');
  }

  if (a.usesReply) {
    parts.push('still consumes the shim `reply`');
  }

  return parts.join('; ');
}

/** Target disposition for a handler or pre-handler row. */
function describeHandlerTarget(entry, isPreHandler) {
  var a = entry.analysis;
  var shape = isPreHandler
    ? 'native lifecycle method `async function (request, h)`'
    : '`async function (request, h)`';

  if (entry.signature === 'legacy') {
    if (a.usesReply) {
      return 'Convert to ' + shape + '; every `reply(...)` becomes a returned toolkit ' +
        'response and every path returns exactly once' +
        (isPreHandler ? ', or returns `null` where there is nothing to contribute' : '') + '.';
    }
    return 'Convert to ' + shape + '; return `request.success(...)` / `request.fail(...)` ' +
      'on every path' + (isPreHandler ? ', or `null` where there is nothing to contribute' : '') + '.';
  }

  if (a.unreturnedSignals > 0) {
    return 'Signature is already ' + shape + ', but ' + a.unreturnedSignals +
      ' signalling call' + (a.unreturnedSignals === 1 ? '' : 's') +
      ' still fall off the end. Return the response on every path.';
  }

  if (a.usesReply) {
    return 'Signature and returns are converted, but a residual `reply(` reference remains. ' +
      'Either return a toolkit response there, or -- if the expression is deliberately ' +
      'unreachable -- record it in `docs/preserved-quirks.md`. Do not change its behaviour.';
  }

  return 'Already converted: ' + shape + ' returning on every measured path. Confirm no ' +
    'branch falls through before ticking.';
}

/** Whether a handler/pre-handler row counts as closed. */
function isHandlerClosed(entry) {
  return entry.signature === 'toolkit' &&
    entry.analysis.unreturnedSignals === 0 &&
    !entry.analysis.usesReply;
}

/**
 * Describe the invocation that produced this run, in a form that is the same
 * on every machine.
 *
 * Two requirements pull against each other here and both are met. The artifact
 * has to record the EXACT command that produced it, or it is not reproducible.
 * It also has to be byte-identical when two people generate it from the same
 * tree, or `diff` stops being a review of the tree and becomes a review of
 * whose checkout it ran in -- and an absolute path is exactly that kind of
 * difference. So paths inside the repository are recorded relative to its
 * root, and an external worktree is recorded as the shell variable the command
 * reads, with the one command that creates it printed alongside. Nothing is
 * lost: what identifies the analysed tree is its HEAD, which is recorded.
 */
function describeInvocation(options) {
  var repoRoot = options.repoRoot;
  var appIsRepo = path.resolve(options.app) === path.resolve(repoRoot);
  var relativeApp = path.relative(repoRoot, options.app);
  var appInsideRepo = !appIsRepo && relativeApp !== '' &&
    relativeApp.indexOf('..') !== 0 && !path.isAbsolute(relativeApp);

  var appToken;
  var appLabel;
  var recreate = null;

  if (appIsRepo) {
    // The default. No --app is needed, so the command does not carry one.
    appToken = null;
    appLabel = 'the repository containing the generator (no --app given)';
  } else if (appInsideRepo) {
    appToken = relativeApp;
    appLabel = '`' + relativeApp + '`, inside the repository';
  } else {
    appToken = '"$BASELINE"';
    appLabel = 'a git worktree outside the repository (its path is deliberately not recorded)';
    recreate = 'any path you choose -- create it with `git worktree add --detach ' +
      '"$BASELINE" ' + BASELINE_COMMIT + '`';
  }

  var relativeOut = path.relative(repoRoot, options.out);
  var outToken = (relativeOut !== '' && relativeOut.indexOf('..') !== 0 &&
    !path.isAbsolute(relativeOut)) ? relativeOut : '"$OUT"';

  var command = 'node test/parity/convert-inventory.js' +
    (appToken ? ' --app ' + appToken : '') +
    ' --out ' + outToken;

  return { command: command, appLabel: appLabel, recreate: recreate };
}

// Used when renderDocument() is called directly by a consumer of the module
// rather than through main(), so the header never reports a command it cannot
// substantiate.
var UNKNOWN_INVOCATION = {
  command: 'node test/parity/convert-inventory.js --app <tree> --out <file>  ' +
    '(this run was driven through the module API, not the CLI)',
  appLabel: '(not recorded -- renderDocument() was called directly)',
  recreate: null
};

function renderFrontMatter(model) {
  var p = model.provenance;
  var invocation = p.invocation || UNKNOWN_INVOCATION;
  var lines = [];
  lines.push('<!--');
  lines.push('  GENERATED FILE -- do not hand-edit it. Every line below this block is written');
  lines.push('  by the generator named here from the analysed tree named here. An edit made by');
  lines.push('  hand is lost on the next run and, while it survives, is indistinguishable from a');
  lines.push('  measurement. To change what this document says, change the generator or the');
  lines.push('  tree and re-run the exact command.');
  lines.push('');
  lines.push('  generator          : test/parity/convert-inventory.js');
  lines.push('  exact command      : ' + invocation.command);
  if (invocation.recreate) {
    lines.push('  where $BASELINE is : ' + invocation.recreate);
  }
  lines.push('  analysed tree      : ' + invocation.appLabel);
  lines.push('  analysed tree HEAD : ' + (p.appHead || '(not a git worktree)'));
  lines.push('  base commit        : ' + BASELINE_COMMIT +
    (p.atBaseline
      ? '  <-- the analysed tree IS the base commit, so the'
      : '  <-- the analysed tree is NOT the base commit, so the'));
  lines.push('                       baseline-calibrated self-checks are ' +
    (p.atBaseline ? 'ASSERTED' : 'reported as deltas'));
  lines.push('  generator HEAD     : ' + (p.toolHead || '(not a git worktree)'));
  lines.push('  node               : ' + p.nodeVersion);
  lines.push('  generated at       : ' + new Date().toISOString());
  lines.push('');
  lines.push('  No absolute path appears anywhere in this document. A worktree\'s location on');
  lines.push('  disk is specific to the machine it was generated on, so recording it would make');
  lines.push('  two correct runs differ for a reason that says nothing about the tree. The tree');
  lines.push('  is identified by its HEAD, above.');
  lines.push('');
  lines.push('  Everything below this block is deterministic: two runs over the same tree');
  lines.push('  differ only in the "generated at" line above.');
  lines.push('-->');
  return lines.join('\n');
}

function renderSelfCheck(model, checks) {
  var out = [];
  out.push('## Self-check');
  out.push('');
  out.push('This generator refuses to emit a quietly incomplete checklist. A checklist that');
  out.push('has silently dropped sites is worse than no checklist at all, because it reads as');
  out.push('completed work. Three tiers of check therefore run before anything is written, and');
  out.push('a failure in any of them exits non-zero with no document produced.');
  out.push('');
  out.push('| Tier | What it asserts | Result |');
  out.push('| --- | --- | --- |');
  out.push('| 1 -- invariants | Handler census (' + BASELINE_EXPORTS_TOTAL + ' exports and its ' +
    'per-file distribution), route declarations (178), binding graph (' +
    CONVERSION_SET.routedHandlers + ' routed / ' + EXCLUDED_MISSING_BINDINGS.length +
    ' nonexistent / ' + EXCLUDED_UNROUTED_EXPORTS.length + ' unrouted), pre-handler census (' +
    BASELINE_NAMED_PRE_HANDLERS + '), tokenizer length and delimiter balance per file. ' +
    'Must hold on **any** tree, converted or not. | ' +
    (checks.failures.filter(function (f) { return f.tier === 1; }).length === 0 ? 'pass' : 'FAIL') + ' |');
  out.push('| 2 -- baseline-calibrated | Progress metrics: ' + BASELINE_REPLY_SITES_TOTAL +
    ' `reply(` sites and their distribution, ' + BASELINE_THEN_CALLS + ' `.then(`, ' +
    BASELINE_CATCH_CALLS + ' `.catch(`, ' + BASELINE_TYPE_BYTES_CALLS +
    ' `.type()`/`.bytes()`, ' + BASELINE_STREAM_SITES + ' stream sites, and the eight-entry ' +
    'reply-chain roster with its three categories. Asserted **exactly** at `' +
    BASELINE_COMMIT + '`; reported as a delta elsewhere. | ' +
    (checks.atBaseline
      ? (checks.failures.filter(function (f) { return f.tier === 2; }).length === 0 ? 'pass (asserted)' : 'FAIL')
      : 'reported (tree is not at `' + BASELINE_COMMIT + '`)') + ' |');
  out.push('| 3 -- directional | Off baseline, `reply(` sites may fall but must never rise ' +
    'above ' + BASELINE_REPLY_SITES_TOTAL + ', and the handler census may not move. | ' +
    (checks.failures.filter(function (f) { return f.tier === 3; }).length === 0 ? 'pass' : 'FAIL') + ' |');
  out.push('');
  out.push('Why tier 2 is conditional rather than absolute: a converted tree has fewer `reply(`');
  out.push('sites **by design**. Asserting the baseline figure unconditionally would make this');
  out.push('tool fail on exactly the tree whose progress it exists to demonstrate. The check');
  out.push('that actually catches a mis-tokenized file is the tier-1 handler census, because a');
  out.push('desynchronized scrub loses exports and the census collapses immediately.');
  out.push('');

  out.push('### Measured against baseline');
  out.push('');
  out.push('| Metric | Baseline (`' + BASELINE_COMMIT + '`) | This tree | Kind |');
  out.push('| --- | --- | --- | --- |');
  out.push('| Controller handler exports | ' + BASELINE_EXPORTS_TOTAL + ' | ' +
    model.exportTotal + ' | invariant |');
  out.push('| Route declarations | 178 | ' + model.routeDeclarations + ' | invariant |');
  out.push('| Distinct controller bindings | 148 | ' + model.distinctBindings + ' | invariant |');
  out.push('| Routed handlers | ' + CONVERSION_SET.routedHandlers + ' | ' +
    model.routedHandlers + ' | invariant |');
  out.push('| `reply(` call sites | ' + BASELINE_REPLY_SITES_TOTAL + ' | ' +
    model.replySitesTotal + ' | progress |');
  out.push('| `.then(` links | ' + BASELINE_THEN_CALLS + ' | ' + model.thenCalls + ' | progress |');
  out.push('| `.catch(` links | ' + BASELINE_CATCH_CALLS + ' | ' + model.catchCalls + ' | progress |');
  out.push('| `.type()` / `.bytes()` calls | ' + BASELINE_TYPE_BYTES_CALLS + ' | ' +
    model.typeBytesCalls + ' | progress |');
  out.push('| Derived stream sites | ' + BASELINE_STREAM_SITES + ' | ' +
    model.streamSiteTotal + ' | derived |');
  out.push('| Pre-handlers still `(request, reply)` | ' + BASELINE_NAMED_PRE_HANDLERS + ' | ' +
    model.legacyPreHandlerCount + ' | progress |');
  out.push('');

  if (checks.notes.length > 0) {
    out.push('### Deltas from baseline');
    out.push('');
    out.push('The analysed tree is not at `' + BASELINE_COMMIT + '`, so the following ' +
      'differences are reported rather than asserted. Each one should be explicable as ' +
      'conversion progress; anything that is not is a finding.');
    out.push('');
    checks.notes.slice().sort().forEach(function (note) {
      out.push('- ' + note);
    });
    out.push('');
  }

  return out.join('\n');
}


function renderPreamble() {
  var out = [];
  out.push('# Conversion inventory');
  out.push('');
  out.push('One row per site an implementing agent must close to move this application from');
  out.push('the 2013 callback idiom to the hapi lifecycle contract. **There is no target row');
  out.push('count.** Rows are derived from the tree; nothing is padded to reach a number.');
  out.push('');
  out.push('## Why a signature count is not enough');
  out.push('');
  out.push('In hapi 17 and later every lifecycle method must return a value, return a promise,');
  out.push('or throw. `undefined` is converted into a server error by the toolkit. So the');
  out.push('requirement that makes a conversion *correct* is that **each handler returns exactly');
  out.push('once on every path** -- and neither a returned-but-unawaited chain nor an');
  out.push('awaited-but-unreturned one is visible in a signature count. Both are');
  out.push('`async (request, h)`. Both satisfy any grep for the new signature. Only one works.');
  out.push('');
  out.push('That is the entire reason this document exists.');
  out.push('');
  out.push('## Why the work is safely orderable');
  out.push('');
  out.push('The mechanism being removed is the response emulation in the route wrapper:');
  out.push('');
  out.push('```js');
  out.push('// lib/util/routeParser.js:567-570  (baseline coordinates)');
  out.push('if (result === undefined) {');
  out.push('    result = await responsePromise;');
  out.push('}');
  out.push('```');
  out.push('');
  out.push('It intercepts **only** an `undefined` result and passes any defined result straight');
  out.push('through, so a handler converted to return its response **already works under the');
  out.push('shim**. Converted and unconverted handlers coexist, which is what lets these rows be');
  out.push('closed one at a time and re-verified as they go.');
  out.push('');
  out.push('Immediately **below** that block, `lib/util/routeParser.js:574-576` is a *different*');
  out.push('mechanism -- the `else` branch returning `request.success(request.params)` when a');
  out.push('route names a controller method that does not exist. Three registered routes depend');
  out.push('on it. **The emulation goes; the fallback stays.** It is easy to delete by');
  out.push('association, which is why those three routes have their own section below.');
  out.push('');
  out.push('## How to read a row');
  out.push('');
  out.push('| Column | Meaning |');
  out.push('| --- | --- |');
  out.push('| Done | `[x]` when the analysis finds the site already in its target shape, `[ ]` otherwise. Recomputed on every run, so re-generating against the working tree is how progress is demonstrated. |');
  out.push('| Site | File and line in the analysed tree. |');
  out.push('| Kind | One of: routed handler, routed pre-handler, inline pre-handler, promise chain, callback boundary, reply chain, stream site. |');
  out.push('| Current shape | What the code does **now**, measured -- not what it looks like. |');
  out.push('| Target disposition | The exact converted shape. Under R-d this is always the *preserved* behaviour, with one approved exception that is labelled as such. |');
  out.push('');
  out.push('The `Current shape` column for handlers and pre-handlers reports whether the body');
  out.push('**returns its response** or **relies on the interception**, decided by whether every');
  out.push('`request.success` / `request.fail` / `reply` call sits in a `return` position. That is');
  out.push('a documented heuristic and it is honest about being one: it separates the two');
  out.push('populations that matter, and it cannot prove "returns exactly once on every path".');
  out.push('Proving that is what closing the row means.');
  out.push('');
  out.push('## What this document is NOT');
  out.push('');
  out.push('Saying so matters, because a checklist that looks complete is read as complete.');
  out.push('');
  out.push('- It is **not the error-edge inventory**. Every target disposition here preserves the');
  out.push('  error mapping of the site it describes -- a swallowed error stays swallowed, a');
  out.push('  fire-and-forget stays fire-and-forget, a mapped error reaches the same funnel -- but');
  out.push('  the per-branch enumeration that R-e actually calls for lives in');
  out.push('  `docs/error-edge-inventory.md`, generated by `test/parity/error-edges.js`. Closing');
  out.push('  every row below does not discharge R-e.');
  out.push('- It is **not evidence of parity**. Whether a converted site behaves identically is');
  out.push('  decided by the request corpus (`test/parity/capture.js` and `replay.js`), the');
  out.push('  storage cases and the joi matrix. This document tells you which sites to convert');
  out.push('  and what to convert them to; those tell you whether you got it right. The three');
  out.push('  builder-returning reply chains and all 17 stream sites depend on that evidence');
  out.push('  outright, which is why their boxes are never ticked by analysis alone.');
  out.push('- It is **not a route inventory**. The 233-route surface is gated by');
  out.push('  `test/parity/manifest.js`. This document counts hapi-invoked *functions*, of which');
  out.push('  there are ' + CONVERSION_SET.total + ' -- a different number for a different purpose.');
  out.push('');
  out.push('## Where the rest of the story lives');
  out.push('');
  out.push('A row here records the **return shape** of one site and stops. Two sibling');
  out.push('documents own the rest about the same sites, and rows point at them by section');
  out.push('number rather than repeating them -- two copies of one fact is how the two drift');
  out.push('apart.');
  out.push('');
  out.push('| Document | What it owns about a site in this checklist |');
  out.push('| --- | --- |');
  out.push('| `' + QUIRK_DOC + '` | The measured baseline **outcome** of a quirk, and, for the single approved deviation, the precedence argument in full. A row whose target reproduces a defect says so and cites the section. |');
  out.push('| `' + ERROR_EDGE_DOC + '` | The **status, payload, side effects and timing** of every changed error edge. Rows that are themselves error edges -- a chain carrying a `.catch(` link, an error-first callback, an unreturned `reply(err)` -- cite the per-file section that owns them. |');
  out.push('');
  out.push('Neither reference is decorative. R-d requires that a preserved defect be recorded');
  out.push('rather than fixed, and R-e requires that the error mapping survive unchanged; this');
  out.push('document would contradict both if it restated their content in its own words.');
  out.push('');
  return out.join('\n');
}

function renderShapeOverview(model) {
  var out = [];
  out.push('## The four recurring shapes, and streams');
  out.push('');
  out.push('Four shapes recur across the conversion set, each with its own distinct failure');
  out.push('mode, plus stream sites which cut across all of them.');
  out.push('');
  out.push('### 1. Promise chains');
  out.push('');
  out.push('Their value is **discarded by the wrapper today**. After conversion each must be');
  out.push('**returned or awaited exactly once per path**. Measured scale across the ten');
  out.push('controllers: **' + BASELINE_THEN_CALLS + '** `.then(` and **' + BASELINE_CATCH_CALLS +
    '** `.catch(` links at `' + BASELINE_COMMIT + '`.');
  out.push('');
  out.push('The canonical trap is `lib/controllers/pages.js:52` -- the AAP\'s own citation for');
  out.push('the chain in `pages.home`, which ends `.then(...).catch(request.fail)`. The terminal');
  out.push('link passes a **bare function reference**, so after conversion `request.fail`\'s');
  out.push('return value must **propagate** out of the handler rather than being dropped on the');
  out.push('floor. A chain that is awaited but not returned, or returned but not awaited, looks');
  out.push('identical in a signature scan.');
  out.push('');
  out.push('Rows are emitted **per chain**, not per link: "returned or awaited exactly once" is a');
  out.push('property of the chain, and closing one means fixing all of its links together.');
  out.push('');
  out.push('### 2. Callback boundaries');
  out.push('');
  out.push('The `await` is created **at the call site**, per rule T-3 -- never pushed down into');
  out.push('the utility. `lib/util/file.js`, `lib/util/store.js` and `lib/util/queues.js` keep');
  out.push('their callback interfaces even though controllers call them directly (three, three');
  out.push('and one controller respectively), because they are **not lifecycle methods**. Each');
  out.push('row records where the `await` goes.');
  out.push('');
  out.push('### 3. Reply chains -- exactly eight, and they are not uniform');
  out.push('');
  out.push('In the shim\'s response builder (`lib/util/routeParser.js:375-405`) `.type()` and');
  out.push('`.bytes()` return the builder **without** resolving the deferred, while `.code()`,');
  out.push('`.header()`, `.redirect()` and `.view()` resolve it. So **what a client receives');
  out.push('depends on which chain method ran last** -- and the ' + BASELINE_TYPE_BYTES_CALLS +
    ' `.type()`/`.bytes()` calls');
  out.push('spread across 8 chains produce three different outcomes. This is the largest source');
  out.push('of preserved-quirk work in the migration.');
  out.push('');
  out.push('### 4. Streams');
  out.push('');
  out.push('**' + BASELINE_STREAM_SITES + '** sites across four controllers, several of which');
  out.push('error **after the response has begun**. Every row records that completion and error');
  out.push('**timing** must be preserved.');
  out.push('');
  out.push('These are **derived, not grepped**. A crude pattern returns 10. The rule is: a stream');
  out.push('site is a source line that creates a stream (`createReadStream` / `createWriteStream`),');
  out.push('pipes one (`.pipe(`), constructs an archive (`archiver(`), hands one to the response');
  out.push('(`reply(<stream>)` / `h.response(<stream>)`), or binds a call result to a');
  out.push('stream-named identifier -- **deduped by line**, because');
  out.push('`.pipe(fs.createWriteStream(p))` is two operations at one place a reader has to look.');
  out.push('Lifecycle listeners (`.on(\'close\')`, `.on(\'error\')`) are attached *at* a site already');
  out.push('counted, and a `.then(function (stream))` parameter merely names one. Excluding those');
  out.push('two is what lands the rule on ' + BASELINE_STREAM_SITES + ' rather than a larger number.');
  out.push('');
  out.push('### Target idiom, anchored on code already in the tree');
  out.push('');
  out.push('The conversion has references to work from, not inventions. Coordinates are baseline');
  out.push('(`' + BASELINE_COMMIT + '`); a converted tree will have moved some of them.');
  out.push('');
  TARGET_IDIOM_ANCHORS.forEach(function (anchor) {
    out.push('- **`' + anchor.site + '`** -- ' + anchor.what);
  });
  out.push('');
  if (model.nativePreHandlers.length > 0) {
    out.push('In the analysed tree the pre-handler exemplar `findFeaturedTrinkets` sits at ' +
      '`' + HELPERS_PATH + ':' + model.nativePreHandlers[0].line + '`.');
    out.push('');
  }
  return out.join('\n');
}

function renderConversionSet(model) {
  var out = [];
  out.push('## The conversion set');
  out.push('');
  out.push('Derived from the **binding graph**, not from the export list. The two disagree in');
  out.push('both directions, which is exactly why the export list is the wrong source: three');
  out.push('routes name a controller method that does not exist, and two exported handlers are');
  out.push('never routed.');
  out.push('');
  out.push('```text');
  out.push('  ' + String(CONVERSION_SET.routedHandlers).padStart(3) + '  routed handlers        ' +
    '(' + BASELINE_EXPORTS_TOTAL + ' controller exports minus the ' +
    EXCLUDED_UNROUTED_EXPORTS.length + ' that no route references)');
  out.push('  ' + String(CONVERSION_SET.routedPreHandlers).padStart(3) + '  routed pre-handlers    ' +
    '(of ' + BASELINE_NAMED_PRE_HANDLERS + ' named pre-handlers in ' + HELPERS_PATH + ')');
  out.push('  ' + String(CONVERSION_SET.inlinePreHandlers).padStart(3) + '  inline pre-handler     ' +
    '(config/api_routes.js:1104, on POST /api/users/login)');
  out.push('  ---');
  out.push('  ' + String(CONVERSION_SET.total).padStart(3) + '  hapi-invoked functions to convert');
  out.push('```');
  out.push('');
  out.push('`' + CONVERSION_SET.routedHandlers + ' + ' + CONVERSION_SET.routedPreHandlers +
    ' + ' + CONVERSION_SET.inlinePreHandlers + ' = ' + CONVERSION_SET.total + '`, and the');
  out.push('arithmetic is asserted by the self-check rather than asserted by this sentence.');
  out.push('');
  out.push('Measured in the analysed tree: ' + model.routeDeclarations + ' route declarations ' +
    'produce ' + model.distinctBindings + ' distinct controller bindings, of which ' +
    model.routedHandlers + ' resolve to a defined export and ' + model.missingBindings.length +
    ' do not. ' + model.interpolatedDeclarations + ' declarations build their route string by');
  out.push('concatenation and would be missed entirely by a scan over string literals alone.');
  out.push('');
  out.push('Three groups are **excluded from the ' + CONVERSION_SET.total + '** and have their');
  out.push('own sections: the ' + EXCLUDED_UNROUTED_EXPORTS.length + ' defined-but-unrouted ' +
    'controller exports, the ' + EXCLUDED_UNROUTED_PRE_HANDLERS.length + ' unrouted named');
  out.push('pre-handlers, and the ' + EXCLUDED_MISSING_BINDINGS.length + ' routes whose named ' +
    'controller method does not exist.');
  out.push('');
  return out.join('\n');
}

function renderHandlerRows(model) {
  var out = [];
  var routed = model.handlers.filter(function (h) {
    return h.routed;
  });
  var closed = routed.filter(isHandlerClosed).length;

  out.push('## 1. Routed handlers -- ' + pluralize(routed.length, 'row') +
    ' (' + closed + ' closed)');
  out.push('');
  out.push('Every controller method that hapi invokes. **A declared signature settles nothing**,');
  out.push('which is why the `Current shape` column reports what the body does rather than what');
  out.push('the parameters are called. `lib/controllers/auth.js` contributes two rows that are');
  out.push('declared `(request, h)` already, and the analysis still has to read their bodies to');
  out.push('decide whether every signalling call sits in a `return` position -- while several');
  out.push('handlers still declared `(request, reply)` turn out to return on every path and');
  out.push('others fall off the end. Neither population is identifiable from the signature.');
  out.push('');

  CONTROLLERS.forEach(function (name) {
    var rows = routed.filter(function (h) {
      return h.controller === name;
    }).sort(function (a, b) {
      return a.line - b.line;
    });
    if (rows.length === 0) {
      return;
    }
    var sub = rows.filter(isHandlerClosed).length;
    out.push('### `' + CONTROLLER_DIR + '/' + name + '.js` -- ' +
      pluralize(rows.length, 'handler') + ' (' + sub + ' closed)');
    out.push('');
    out.push('| Done | Site | Kind | Current shape | Target disposition |');
    out.push('| --- | --- | --- | --- | --- |');
    rows.forEach(function (h) {
      out.push('| ' + box(isHandlerClosed(h)) +
        ' | `' + h.file + ':' + h.line + '` `' + h.name + '`' +
        (h.routeDeclarations > 1 ? ' (' + h.routeDeclarations + ' routes)' : '') +
        ' | routed handler' +
        ' | ' + cell(describeCurrentShape(h)) +
        ' | ' + cell(describeHandlerTarget(h, false) + quirkRef(h.file, h.name)) + ' |');
    });
    out.push('');
  });

  return out.join('\n');
}

function renderPreHandlerRows(model) {
  var out = [];
  var routed = model.preHandlers.filter(function (p) {
    return p.routed;
  }).sort(function (a, b) {
    return a.line - b.line;
  });
  var closed = routed.filter(isHandlerClosed).length;

  out.push('## 2. Routed pre-handlers -- ' + pluralize(routed.length, 'row') +
    ' (' + closed + ' closed)');
  out.push('');
  out.push('Named pre-handlers in `' + HELPERS_PATH + '` that a route references. The census is');
  out.push('' + BASELINE_NAMED_PRE_HANDLERS + ' named pre-handlers in total; ' + routed.length +
    ' are routed and ' + EXCLUDED_UNROUTED_PRE_HANDLERS.length + ' are not.');
  out.push('');
  out.push('Two exports are deliberately **not** in that census, and saying why keeps the');
  out.push('arithmetic honest: `lowerUserFields` is an alias -- `module.exports.lowerUserFields =');
  out.push('internals.lowerUserFields;` -- with no function literal at the declaration, and the');
  out.push('function it points at is already `(request, h)`; and `findFeaturedTrinkets` is');
  out.push('already `(request, h)` too, which makes it the exemplar rather than the work.');
  out.push('`register` is a `server.method` registrar, not a pre-handler at all.');
  out.push('');
  out.push('A pre-handler with nothing to contribute returns **`null`**, which is exactly what');
  out.push('the shim already produces for it.');
  out.push('');
  out.push('| Done | Site | Kind | Current shape | Target disposition |');
  out.push('| --- | --- | --- | --- | --- |');
  routed.forEach(function (p) {
    out.push('| ' + box(isHandlerClosed(p)) +
      ' | `' + HELPERS_PATH + ':' + p.line + '` `' + p.name + '`' +
      (p.shape === 'descriptor' ? ' (descriptor `method`)' : '') +
      ' | routed pre-handler' +
      ' | ' + cell(describeCurrentShape(p)) +
      ' | ' + cell(describeHandlerTarget(p, true) + quirkRef(HELPERS_PATH, p.name)) + ' |');
  });
  out.push('');

  // The two measured-dead 301s.
  out.push('### The two dead pre-handler 301 redirects');
  out.push('');
  out.push('Both are **measured dead**, and the mechanism matters because deleting it does not');
  out.push('preserve the outcome. In the shim, `fakeReply(undefined)` settles the deferred with');
  out.push('`null` at `lib/util/routeParser.js:147` **before** `.takeover()` reaches its own');
  out.push('resolve at `:154`. So the redirect is discarded and the pre value is already `null`.');
  out.push('The capability is dead end to end: `_isRedirect`, `_permanent` and `_takeover` appear');
  out.push('**only** on the six lines that define them -- `lib/util/routeParser.js:98`, `:100`,');
  out.push('`:101`, `:151`, `:153`, `:154`.');
  out.push('');
  out.push('| Done | Site | Kind | Current shape | Target disposition |');
  out.push('| --- | --- | --- | --- | --- |');
  ANCHORED_SITES.filter(function (s) {
    return s.kind === 'dead-301';
  }).forEach(function (s) {
    var stillLegacy = anchoredSiteStillLegacy(model, s);
    out.push('| ' + box(!stillLegacy) +
      ' | ' + cell(anchoredSiteLabel(model, s)) +
      ' | routed pre-handler' +
      ' | ' + cell(s.current) +
      ' | ' + cell(s.target + anchoredQuirkRef(s)) + ' |');
  });
  out.push('');
  return out.join('\n');
}

// A legacy dead 301 is `reply().redirect(...).permanent().takeover()`.
var DEAD_301_PATTERN = /(?<![A-Za-z0-9_$.])reply\s*\(\s*\)\s*\.\s*redirect\s*\([\s\S]{0,240}?\.\s*permanent\s*\(\s*\)\s*\.\s*takeover\s*\(/g;

/**
 * Locate the dead 301 constructs in lib/util/helpers.js and attribute each to
 * the named pre-handler that encloses it.
 *
 * Attribution is essential rather than decorative: the file contains FOUR of
 * these chains, and only two of them -- inside `findTrinket` and
 * `courseBySlug` -- belong to ROUTED pre-handlers and so to the conversion
 * set. The other two sit inside `toLowerCaseURI` and `trinketByOwnerAndSlug`,
 * which are unrouted and correctly stay as they are. A file-wide test would
 * therefore report the routed pair as unconverted forever, because the
 * unrouted pair keeps matching.
 */
function findDead301Sites(model) {
  var file = model.files.filter(function (f) {
    return f.path === HELPERS_PATH;
  })[0];
  if (!file) {
    return [];
  }
  var declarations = model.preHandlerDeclarations || [];
  var sites = [];
  var re = new RegExp(DEAD_301_PATTERN.source, 'g');
  var m;
  while ((m = re.exec(file.scrubbed)) !== null) {
    var line = lineAt(file.lineIndex, m.index);
    var owner = null;
    declarations.forEach(function (d) {
      if (typeof d.line === 'number' && typeof d.endLine === 'number' &&
          line >= d.line && line <= d.endLine) {
        owner = d.name;
      }
    });
    sites.push({ line: line, enclosing: owner });
  }
  return sites;
}

/**
 * Whether an anchored baseline site still appears in its legacy shape in the
 * analysed tree.
 *
 * Baseline line numbers stop being addresses the moment a file is edited, so
 * the site is identified by the function that ENCLOSES it -- a name, which
 * survives editing -- and the legacy construct is then looked for inside that
 * function only.
 */
function anchoredSiteStillLegacy(model, site) {
  var file = model.files.filter(function (f) {
    return f.path === site.file;
  })[0];
  if (!file) {
    return true;
  }

  if (site.kind === 'dead-301') {
    return findDead301Sites(model).some(function (found) {
      return found.enclosing === site.enclosing;
    });
  }

  if (site.kind === 'reply-no-return') {
    return model.bareReplies.some(function (b) {
      return b.file === site.file && b.enclosing === site.enclosing;
    });
  }

  return true;
}

/** Current location of an anchored site in the analysed tree, or null. */
function anchoredSiteCurrentLine(model, site) {
  if (site.kind === 'dead-301') {
    var hit = findDead301Sites(model).filter(function (found) {
      return found.enclosing === site.enclosing;
    })[0];
    return hit ? hit.line : null;
  }
  if (site.kind === 'reply-no-return') {
    var bare = model.bareReplies.filter(function (b) {
      return b.file === site.file && b.enclosing === site.enclosing;
    })[0];
    return bare ? bare.line : null;
  }
  return null;
}


/**
 * Site label for an anchored row: the baseline coordinate always, plus the
 * current coordinate when the site is still present in the analysed tree.
 * Both are shown because the baseline coordinate is the one every other
 * document cites, and the current one is the one a reader has to open.
 */
function anchoredSiteLabel(model, site) {
  var label = '`' + site.file + ':' + site.line + '`';
  var current = anchoredSiteCurrentLine(model, site);
  if (current === null) {
    return label + ' (baseline; converted in this tree)';
  }
  if (current === site.line) {
    return label + ' `' + site.enclosing + '`';
  }
  return label + ' `' + site.enclosing + '` (now `:' + current + '`)';
}

function renderInlinePreHandlerRows(model) {
  var out = [];
  out.push('## 3. Inline pre-handler -- ' +
    pluralize(model.inlinePreHandlers.length, 'row'));
  out.push('');
  out.push('A function literal declared directly inside a `pre :` array in a route config.');
  out.push('There is exactly one, on `POST /api/users/login`, and it is the sole member of its');
  out.push('own category in the conversion set. Note its parameter is `req`, not `request`.');
  out.push('');
  out.push('The other 116 declarations in `config/api_routes.js` are untouched by this');
  out.push('migration -- only this pre-handler changes.');
  out.push('');
  out.push('| Done | Site | Kind | Current shape | Target disposition |');
  out.push('| --- | --- | --- | --- | --- |');
  model.inlinePreHandlers.forEach(function (inline) {
    var closed = inline.signature === 'toolkit' && !inline.analysis.usesReply;
    out.push('| ' + box(closed) +
      ' | `' + inline.file + ':' + inline.line + '`' +
      ' | inline pre-handler' +
      ' | ' + cell((inline.signature === 'legacy' ? 'legacy ' : '') + '`(' + inline.params +
        ')`; body is ' + code(inline.excerpt) + ' -- signals through the shim rather than ' +
        'returning to hapi') +
      ' | ' + cell('A function returning `true`: `function (request, h) { return true; }`. ' +
        'The assigned pre value stays `true`, so `request.pre.encryptRoles` is unchanged.') + ' |');
  });
  out.push('');
  return out.join('\n');
}

function renderPromiseChainRows(model) {
  var out = [];
  var chains = model.promiseChains;
  var closed = chains.filter(isChainClosed).length;

  out.push('## 4. Promise chains -- ' + pluralize(chains.length, 'row') +
    ' (' + closed + ' closed)');
  out.push('');
  out.push('One row per chain. A chain is closed when its value leaves the enclosing function --');
  out.push('`return`ed or `await`ed -- exactly once. Today the wrapper discards it.');
  out.push('');
  out.push('Terminal links that pass a **bare function reference** rather than a function');
  out.push('literal are called out in the `Current shape` column, because that is the shape');
  out.push('whose return value is silently dropped: `.catch(request.fail)` reads as handled and');
  out.push('produces nothing the handler returns.');
  out.push('');

  CONTROLLERS.forEach(function (name) {
    var rows = chains.filter(function (c) {
      return c.controller === name;
    }).sort(function (a, b) {
      return a.startLine - b.startLine;
    });
    if (rows.length === 0) {
      return;
    }
    var sub = rows.filter(isChainClosed).length;
    out.push('### `' + CONTROLLER_DIR + '/' + name + '.js` -- ' +
      pluralize(rows.length, 'chain') + ' (' + sub + ' closed)');
    out.push('');
    out.push('| Done | Site | Kind | Current shape | Target disposition |');
    out.push('| --- | --- | --- | --- | --- |');
    rows.forEach(function (c) {
      // A chain carrying a `.catch(` link IS an error edge, so it gets the
      // pointer at the document that owns the status, payload and timing.
      // A chain without one is not, and does not.
      var isErrorEdge = c.linkNames.indexOf('catch') !== -1;
      out.push('| ' + box(isChainClosed(c)) +
        ' | ' + cell(chainSiteLabel(c)) +
        ' | promise chain' +
        ' | ' + cell(describeChainCurrent(c)) +
        ' | ' + cell(describeChainTarget(c) +
          (isErrorEdge ? errorEdgeRef(c.file) : '') +
          quirkRef(c.file, c.enclosing)) + ' |');
    });
    out.push('');
  });

  return out.join('\n');
}

function chainSiteLabel(chain) {
  var span = chain.startLine === chain.endLine
    ? String(chain.startLine)
    : chain.startLine + '-' + chain.endLine;
  var label = '`' + chain.file + ':' + span + '`' +
    (chain.enclosing ? ' `' + chain.enclosing + '`' : ' (module scope)');

  AAP_CITED_CHAINS.forEach(function (cite) {
    if (cite.file !== chain.file || cite.enclosing !== chain.enclosing) {
      return;
    }
    label += ' -- the AAP cites this chain as `' + cite.file + ':' + cite.citedLine + '`';
    if (String(chain.startLine + '-' + chain.endLine) !== cite.baselineSpan) {
      label += ' (measured at the base commit as `:' + cite.baselineSpan +
        '`, here `:' + chain.startLine + '-' + chain.endLine + '`)';
    }
  });
  return label;
}

/**
 * A promise-chain row closes on the two properties that belong to the CHAIN,
 * as opposed to the handler that contains it:
 *
 *   1. its value leaves the enclosing function -- `return`ed or `await`ed; and
 *   2. its terminal link does not pass a bare function reference, whose
 *      return value is silently dropped.
 *
 * What happens INSIDE the links -- a `reply(...)` becoming a returned toolkit
 * response -- is the enclosing handler's row, not this one. Splitting it that
 * way keeps each site closable by one person looking at one thing.
 */
function isChainClosed(chain) {
  return (chain.returned || chain.awaited) && chain.terminalIsFunction;
}

function describeChainCurrent(chain) {
  var parts = [];
  parts.push(chain.linkCount + '-link chain `.' + chain.linkNames.join('().') + '()`');
  if (chain.returned) {
    parts.push('currently RETURNED');
  } else if (chain.awaited) {
    parts.push('currently AWAITED');
  } else {
    parts.push('currently NEITHER returned nor awaited -- its value is discarded' +
      (chain.prefix ? ' (preceded by `' + chain.prefix + '`)' : ''));
  }
  if (!chain.terminalIsFunction) {
    parts.push('terminal `.' + chain.terminalName + '(' + chain.terminalArg +
      ')` passes a BARE REFERENCE, so its return value is dropped');
  }
  parts.push('head ' + code(chain.head));
  return parts.join('; ');
}

function describeChainTarget(chain) {
  if (!chain.terminalIsFunction) {
    return 'Await the chain and return its value, and make sure the bare `' +
      chain.terminalArg + '` reference\'s return value PROPAGATES -- ' +
      '`.' + chain.terminalName + '(function (err) { return ' + chain.terminalArg +
      '(err); })` or an equivalent that does not drop it. Exactly once per path.';
  }
  if (chain.returned || chain.awaited) {
    return 'Already leaves the function (' + (chain.returned ? '`return`' : '`await`') +
      '). Confirm the value reaching hapi is a response and not a builder, and that no ' +
      'branch inside the links returns nothing.';
  }
  return 'Await the chain and return its value -- exactly once per path. Every branch inside ' +
    'the links must produce the response, not signal it.';
}

function renderCallbackRows(model) {
  var out = [];
  var rows = model.callbackBoundaries;
  var closed = rows.filter(isCallbackClosed).length;

  var resolvedSinceBaseline = BASELINE_CALLBACK_BOUNDARIES - rows.length;
  out.push('## 5. Callback boundaries -- ' + pluralize(rows.length, 'row'));
  out.push('');
  out.push('**A closed callback boundary ceases to exist**, so this section shrinks rather');
  out.push('than ticks: replacing `util.f(x, function (err, r) { ... })` with `await` removes');
  out.push('the callback literal, and the row with it. The `Done` box is therefore ticked only');
  out.push('in the one case that is still detectable -- a call site that already carries an');
  out.push('`await` -- and progress is read from the count instead. Baseline: **' +
    BASELINE_CALLBACK_BOUNDARIES + '**. This tree: **' + rows.length + '**' +
    (resolvedSinceBaseline > 0
      ? ', so ' + resolvedSinceBaseline + ' boundar' +
        (resolvedSinceBaseline === 1 ? 'y has' : 'ies have') + ' been resolved.'
      : resolvedSinceBaseline === 0
        ? ' -- none resolved yet.'
        : '. That is MORE than baseline, which needs explaining.') +
    (closed > 0 ? ' ' + closed + ' remaining site' + (closed === 1 ? ' is' : 's are') +
      ' already awaited.' : ''));
  out.push('');
  out.push('Each row records **where the `await` goes**: at the call site, inside the converted');
  out.push('lifecycle method. Rule T-3 puts the promise boundary at the lifecycle method and');
  out.push('nowhere deeper, which is why `lib/util/file.js`, `lib/util/store.js` and');
  out.push('`lib/util/queues.js` keep their callback interfaces -- a handler `await`s them, they');
  out.push('are not lifecycle methods themselves.');
  out.push('');
  out.push('A boundary here is a call receiving a function literal whose parameters are either');
  out.push('error-first or empty -- the two shapes a completion callback takes. Empty-parameter');
  out.push('callbacks are deliberately included, because two named conversions are exactly that');
  out.push('shape: `rimraf(dir, function () {})` and `fs.unlink(file, function () {})`. Promise');
  out.push('links, event registrations and synchronous iteration helpers are excluded -- they');
  out.push('have their own categories or are not boundaries at all.');
  out.push('');
  out.push('Where baseline swallows a callback error or fires and forgets, **that timing is the');
  out.push('target**: an error made visible, or a response made to wait, is a behaviour change.');
  out.push('');

  CONTROLLERS.forEach(function (name) {
    var group = rows.filter(function (c) {
      return c.controller === name;
    }).sort(function (a, b) {
      return a.line - b.line || a.callee.localeCompare(b.callee);
    });
    if (group.length === 0) {
      return;
    }
    var sub = group.filter(isCallbackClosed).length;
    out.push('### `' + CONTROLLER_DIR + '/' + name + '.js` -- ' +
      pluralize(group.length, 'boundary', 'boundaries') + ' (' + sub + ' closed)');
    out.push('');
    out.push('| Done | Site | Kind | Current shape | Target disposition |');
    out.push('| --- | --- | --- | --- | --- |');
    group.forEach(function (c) {
      out.push('| ' + box(isCallbackClosed(c)) +
        ' | `' + c.file + ':' + c.line + '`' +
        (c.enclosing ? ' `' + c.enclosing + '`' : ' (module scope)') +
        ' | callback boundary' +
        ' | ' + cell(code(c.callee + '(..., function (' + c.params + ') { ... })') + ' -- ' +
          (c.errorFirst
            ? 'Node error-first callback'
            : 'completion callback with no parameters') +
          (c.alreadyAwaited ? '; call site is already awaited' : '; call site is not awaited')) +
        ' | ' + cell('Create the `await` AT THIS CALL SITE inside the converted handler: ' +
          'await the promise form (or a promisified wrapper) and continue with its result. ' +
          'Do not push the boundary into the callee. Preserve the baseline\'s error handling ' +
          'exactly -- swallowed stays swallowed, fire-and-forget stays fire-and-forget.' +
          // An error-first callback carries an error disposition; an
          // empty-parameter one carries none, so only the former points at the
          // error-edge inventory.
          (c.errorFirst ? errorEdgeRef(c.file) : '') +
          quirkRef(c.file, c.enclosing)) + ' |');
    });
    out.push('');
  });

  return out.join('\n');
}

function isCallbackClosed(cb) {
  return cb.alreadyAwaited;
}

function renderReplyChainRows(model) {
  var out = [];
  var derived = model.replyChains;
  var legacy = derived.filter(function (c) {
    return c.root === 'reply';
  });

  out.push('## 6. Reply chains -- ' + pluralize(REPLY_CHAIN_ROSTER.length, 'row'));
  out.push('');
  out.push('The roster below is a **recorded baseline measurement**, not a transcription: the');
  out.push('three-way classification depends on which builder method ran last, and the');
  out.push('analysis derives the same classification independently from');
  out.push('`RESOLVING_BUILDER_METHODS` and `NON_RESOLVING_BUILDER_METHODS`. At `' +
    BASELINE_COMMIT + '` the two must');
  out.push('agree chain for chain and line for line, and the self-check fails if they do not.');
  out.push('Two independent routes to the same answer is the point.');
  out.push('');
  out.push('Removing the builder removes a **mechanism**, not a set of outcomes. Three of these');
  out.push('chains return a builder object to hapi, four resolve real responses, and one never');
  out.push('settles at all -- so the target disposition has to be stated per chain.');
  out.push('');
  out.push('In the analysed tree the derived scan finds ' + legacy.length +
    ' `reply(`-rooted chain' + (legacy.length === 1 ? '' : 's') + ' carrying `.type()`/`.bytes()`' +
    (derived.length - legacy.length > 0
      ? ' and ' + (derived.length - legacy.length) + ' `h.response(`-rooted equivalent' +
        (derived.length - legacy.length === 1 ? '' : 's')
      : '') + '.');
  out.push('');

  ['never-settles', 'header-resolved', 'builder-returned'].forEach(function (category) {
    var entries = REPLY_CHAIN_ROSTER.filter(function (e) {
      return e.category === category;
    });
    out.push('### ' + CATEGORY_TITLES[category] + ' -- ' + entries.length + ' chain' +
      (entries.length === 1 ? '' : 's'));
    out.push('');
    out.push(CATEGORY_BLURBS[category]);
    out.push('');
    out.push('| Done | Site | Kind | Current shape | Target disposition |');
    out.push('| --- | --- | --- | --- | --- |');
    entries.forEach(function (entry) {
      var match = legacy.filter(function (c) {
        return c.file === entry.file && c.startLine === entry.startLine;
      })[0];
      var stillLegacy = !!match;
      var section = CATEGORY_QUIRK_SECTIONS[entry.category];
      var reference = entry.approvedDeviation
        ? ' Measured baseline outcome owned by `' + QUIRK_DOC + '` \u00a7' + section +
          '; the deviation and its precedence argument by \u00a7' + DEVIATION_QUIRK_SECTION + '.'
        : ' Measured baseline outcome owned by `' + QUIRK_DOC + '` \u00a7' + section +
          '; reproduce it, do not fix it.';
      out.push('| ' + box(!stillLegacy) +
        ' | `' + entry.file + ':' + entry.lines + '`' +
        (stillLegacy ? '' : ' (baseline; converted in this tree)') +
        ' | reply chain (' + entry.category + ')' +
        ' | ' + cell(entry.current) +
        ' | ' + cell((entry.approvedDeviation ? '**APPROVED DEVIATION.** ' : '') +
          entry.target + reference) + ' |');
    });
    out.push('');
    // The deviation is STATED here and ARGUED in docs/preserved-quirks.md
    // §11.1. Restating the argument would put the same reasoning in two
    // documents, which is the drift R-d's cross-reference requirement exists
    // to prevent -- so this block gives the reader what changes, which
    // requirement controls, and where the argument lives.
    entries.filter(function (e) {
      return e.approvedDeviation;
    }).forEach(function (entry) {
      out.push('> **Approved deviation, `' + entry.file + ':' + entry.lines + '`.** This is the');
      out.push('> only row in this document whose target changes observable behaviour, and it is');
      out.push('> approved rather than assumed. ' + entry.justification.replace(/\s+/g, ' '));
      out.push('>');
      out.push('> The precedence argument -- why R-b ("every route serves") controls over');
      out.push('> R-d ("behaviour improvements prohibited") here and nowhere else -- is owned by');
      out.push('> `' + QUIRK_DOC + '` \u00a7' + DEVIATION_QUIRK_SECTION + ', which also');
      out.push('> carries the corpus treatment: the baseline result is recorded as an expected');
      out.push('> timeout and the target result as a 200 stream response, so the diff reads as an');
      out.push('> approved change rather than a failure. It is not restated here.');
      out.push('');
    });
  });

  // The distinct reply-no-return shape.
  var bare = ANCHORED_SITES.filter(function (s) {
    return s.kind === 'reply-no-return';
  });
  out.push('### A distinct shape, not one of the eight chains');
  out.push('');
  out.push('| Done | Site | Kind | Current shape | Target disposition |');
  out.push('| --- | --- | --- | --- | --- |');
  bare.forEach(function (s) {
    var stillLegacy = anchoredSiteStillLegacy(model, s);
    out.push('| ' + box(!stillLegacy) +
      ' | ' + cell(anchoredSiteLabel(model, s)) +
      ' | reply call, no return' +
      ' | ' + cell(s.current) +
      ' | ' + cell(s.target + anchoredQuirkRef(s)) + ' |');
  });
  out.push('');
  if (model.bareReplies.length > 0) {
    out.push('The analysed tree still carries ' + model.bareReplies.length +
      ' unreturned bare `reply(` call' + (model.bareReplies.length === 1 ? '' : 's') + ': ' +
      model.bareReplies.map(function (b) {
        return '`' + b.file + ':' + b.line + '`';
      }).join(', ') + '.');
    out.push('');
  }
  return out.join('\n');
}

var CATEGORY_TITLES = {
  'never-settles': 'Never settles',
  'header-resolved': 'Header-resolved and working',
  'builder-returned': 'Builder returned to hapi'
};

var CATEGORY_BLURBS = {
  'never-settles':
    'Only non-resolving links, and the chain\'s value is not returned either, so nothing ' +
    'ever produces a response and the branch hangs.',
  'header-resolved':
    'The chain reaches `.header(...)`, which resolves the deferred, so a real hapi response ' +
    'is produced. These work today and must come through the migration unchanged -- they must ' +
    'not become collateral damage of the approved deviation above.',
  'builder-returned':
    '`return reply(...).type(type)` hands the wrapper the **builder object** rather than a ' +
    'hapi response. What is emitted depends on whether the deferred was already resolved ' +
    'earlier in the request, so the outcome has to be captured before conversion rather than ' +
    'reasoned about.'
};

function renderStreamRows(model) {
  var out = [];
  var names = Object.keys(model.streamSitesByController).sort(function (a, b) {
    return CONTROLLERS.indexOf(a) - CONTROLLERS.indexOf(b);
  });

  out.push('## 7. Stream sites -- ' + pluralize(model.streamSiteTotal, 'row') +
    ' across ' + pluralize(names.length, 'controller'));
  out.push('');
  out.push('Derived, then reviewed -- see "Streams" above for the rule and for what it');
  out.push('deliberately excludes. Several of these error **after the response has begun**,');
  out.push('which is why every row carries the same non-negotiable target: completion and error');
  out.push('**timing** are preserved.');
  out.push('');

  names.forEach(function (name) {
    var sites = model.streamSitesByController[name];
    out.push('### `' + CONTROLLER_DIR + '/' + name + '.js` -- ' +
      pluralize(sites.length, 'site'));
    out.push('');
    out.push('| Done | Site | Kind | Current shape | Target disposition |');
    out.push('| --- | --- | --- | --- | --- |');
    sites.forEach(function (site) {
      out.push('| ' + box(false) +
        ' | `' + site.file + ':' + site.line + '`' +
        (site.enclosing ? ' `' + site.enclosing + '`' : ' (module scope)') +
        ' | stream site' +
        ' | ' + cell(site.reasons.join(', ') + ' -- ' + code(site.text)) +
        ' | ' + cell('Preserve completion and error TIMING exactly: the same event ordering, ' +
          'the same point at which the response begins, and the same behaviour for an error ' +
          'raised after it has begun. Awaiting a stream that baseline did not await, or ' +
          'surfacing an error baseline swallowed, is a behaviour change.' +
          errorEdgeRef(site.file) +
          quirkRef(site.file, site.enclosing)) + ' |');
    });
    out.push('');
  });

  out.push('Stream rows are never auto-ticked. Whether timing is preserved is not a property of');
  out.push('the text -- it is decided by the corpus and the storage cases -- so these boxes are');
  out.push('closed by a human or an agent who has checked that evidence, not by this generator.');
  out.push('');
  return out.join('\n');
}


function renderExcludedSections(model) {
  var out = [];

  // --- 8. defined-but-unrouted controller exports -------------------------
  var unrouted = model.handlers.filter(function (h) {
    return !h.routed;
  }).sort(function (a, b) {
    return a.binding.localeCompare(b.binding);
  });

  out.push('## 8. EXCLUDED -- defined-but-unrouted controller exports (' + unrouted.length + ')');
  out.push('');
  out.push('**Not counted in the ' + CONVERSION_SET.total + '.** These are exported handlers');
  out.push('that no route references, so under blocking-only scope they are not hapi-facing');
  out.push('work. They convert only if another gate independently forces it, and that');
  out.push('determination is **recorded per function below rather than assumed**. Two gates can');
  out.push('force one: the zero-deprecation-warning bar, and the repaired test suite.');
  out.push('');
  out.push('| Done | Site | Kind | Current shape | Target disposition |');
  out.push('| --- | --- | --- | --- | --- |');
  unrouted.forEach(function (h) {
    var evidence = h.gate;
    out.push('| ' + box(!evidence.forced) +
      ' | `' + h.file + ':' + h.line + '` `' + h.name + '`' +
      ' | unrouted export (excluded)' +
      ' | ' + cell(describeCurrentShape(h) + '; no route declaration references `' +
        h.binding + '`') +
      ' | ' + cell('**' + evidence.determination + '.** ' + evidence.reasons.join('; ') + '.' +
        (evidence.forced
          ? ' Convert to `async function (request, h)` returning on every path.'
          : ' Leave as it is; R-a confines the diff to conversion work that something requires.')) +
      ' |');
  });
  out.push('');

  // --- 9. unrouted named pre-handlers -------------------------------------
  var unroutedPre = model.preHandlers.filter(function (p) {
    return !p.routed;
  }).sort(function (a, b) {
    return a.line - b.line;
  });

  out.push('## 9. EXCLUDED -- unrouted named pre-handlers (' + unroutedPre.length + ')');
  out.push('');
  out.push('**Not counted in the ' + CONVERSION_SET.total + '.** Same conditional basis as the');
  out.push('section above: no route references them, so nothing forces their conversion unless');
  out.push('a gate does. Recorded, not assumed.');
  out.push('');
  out.push('| Done | Site | Kind | Current shape | Target disposition |');
  out.push('| --- | --- | --- | --- | --- |');
  unroutedPre.forEach(function (p) {
    var evidence = p.gate;
    out.push('| ' + box(!evidence.forced) +
      ' | `' + HELPERS_PATH + ':' + p.line + '` `' + p.name + '`' +
      ' | unrouted pre-handler (excluded)' +
      ' | ' + cell(describeCurrentShape(p) + '; no route declaration references `helpers.' +
        p.name + '`') +
      ' | ' + cell('**' + evidence.determination + '.** ' + evidence.reasons.join('; ') + '.' +
        (evidence.forced
          ? ' Convert to a native lifecycle method.'
          : ' Leave as it is.')) + ' |');
  });
  out.push('');
  out.push('One of these -- `trinketByOwnerAndSlug` -- carries a `reply().redirect(...)');
  out.push('.permanent().takeover()` chain of the same shape as the two dead 301s in section 2,');
  out.push('and `toLowerCaseURI` carries a fourth `.permanent()` chain of a different shape');
  out.push('(`reply(\'\')` settles the deferred immediately and there is no `.takeover()`).');
  out.push('Neither is in the conversion set, because neither is routed. They are named here so');
  out.push('that a file-wide search for `.permanent()` in `' + HELPERS_PATH + '` -- which finds');
  out.push('four hits, not two -- does not read as unfinished work.');
  out.push('');

  // --- 10. routes with no function to convert ------------------------------
  out.push('## 10. EXCLUDED -- routes whose named controller method does not exist (' +
    EXCLUDED_MISSING_BINDINGS.length + ')');
  out.push('');
  out.push('**Not counted in the ' + CONVERSION_SET.total + ', and there is nothing to convert:');
  out.push('these are routes with no function.** They are recorded so that nobody hunts for a');
  out.push('handler that was never written.');
  out.push('');
  out.push('All three answer entirely through the wrapper\'s missing-controller fallback at');
  out.push('`lib/util/routeParser.js:574-576`, which returns `request.success(request.params)`.');
  out.push('**That fallback must be PRESERVED.** It sits immediately below the interception');
  out.push('block being removed and is easy to delete by association -- which would turn all');
  out.push('three of these routes into failures.');
  out.push('');
  out.push('| Done | Route | Named binding | Declared at | Behaviour to preserve |');
  out.push('| --- | --- | --- | --- | --- |');
  EXCLUDED_MISSING_BINDINGS.forEach(function (entry) {
    var declarations = model.bindings.filter(function (d) {
      return d.binding === entry.binding;
    });
    var where = declarations.map(function (d) {
      return '`' + d.file + ':' + d.line + '`';
    }).join(', ') || '(not found in the analysed tree)';
    out.push('| ' + box(declarations.length > 0) +
      ' | `' + entry.route + '`' +
      ' | `' + entry.binding + '` -- **not defined**' +
      ' | ' + cell(where) +
      ' | ' + cell('Resolves through the preserved fallback at `lib/util/routeParser.js:574-576`, ' +
        'returning `request.success(request.params)`. Same status, same payload, same ' +
        'template resolution as today. Baseline outcome owned by `' + QUIRK_DOC +
        '` \u00a7' + MISSING_BINDING_QUIRK_SECTION + '.') + ' |');
  });
  out.push('');
  out.push('The `Done` box here means "the route declaration is present and the fallback is');
  out.push('still what serves it" -- these rows are a **preservation** check, not conversion');
  out.push('work.');
  out.push('');

  return out.join('\n');
}

function renderRetainedByDesign() {
  var out = [];
  out.push('## Retained by design -- never a removal row');
  out.push('');
  out.push('R-a confines the diff to four things: the runtime bump, the hapi API migration, the');
  out.push('async conversion, and blocking-only dependency swaps. The following are explicitly');
  out.push('**retained**, and if any of them ever shows up in this document as work to be done,');
  out.push('the generator is wrong -- not the code.');
  out.push('');
  out.push('| Retained | Why it must not be touched |');
  out.push('| --- | --- |');
  out.push('| Per-request debug logging at `lib/util/routeParser.js:311`, `:543-552`, `:556` | Explicitly retained. Performance is not a goal of this migration, so there is no licence to remove logging along the way. Recorded in `' + QUIRK_DOC + '` \u00a79.3. |');
  out.push('| The missing-controller fallback at `lib/util/routeParser.js:574-576` | Three registered routes answer through it (section 10). It is adjacent to the interception block being removed, which is the whole risk. |');
  out.push('| `request.success` (`:412-479`), `request.fail` (`:482-514`) and the hand-rolled validation block (`:516-541`) | Reshaped to *return* their response, but their projection, flash-and-redirect behaviour and validation outcomes are invariant. |');
  out.push('| The handler catch-all at `lib/util/routeParser.js:578-589`, including its `if (err)` guard | A falsy throw produces no return and the toolkit converts `undefined` to the same status with a different message. That is observable, so the guard is copied verbatim. |');
  out.push('| The route DSL, the `route.config` -> `route.options` rename, the forced `cors = false` and `delete route.options.validate` | The route surface is an invariant of this migration. |');
  out.push('| The cross-request `fail.redirect` state leak | A measured baseline defect with a documented blast radius. R-d preserves it; two consecutive corpus requests exist so it cannot be silently fixed. Recorded in `' + QUIRK_DOC + '` \u00a73. |');
  out.push('| The two validation message maps in `config/routes.js` | Measured inert on both joi 17.13.3 and 18.2.5. Inert is the baseline behaviour, so inert is the target. Recorded in `' + QUIRK_DOC + '` \u00a79.1. |');
  out.push('');
  out.push('No row in this document proposes a rename, a cleanup, or a "while we\'re here".');
  out.push('Every target disposition is the **preserved** behaviour, with exactly one approved');
  out.push('exception, labelled as such in section 6 and argued in `' + QUIRK_DOC + '` \u00a7' +
    DEVIATION_QUIRK_SECTION + '.');
  out.push('');
  return out.join('\n');
}

function renderTotals(model, sections) {
  var out = [];
  out.push('## Row totals');
  out.push('');
  out.push('| Section | Rows | Closed | In the ' + CONVERSION_SET.total + '? |');
  out.push('| --- | --- | --- | --- |');
  sections.forEach(function (s) {
    out.push('| ' + s.title + ' | ' + s.rows + ' | ' + s.closed + ' | ' + s.inSet + ' |');
  });
  var totalRows = sections.reduce(function (acc, s) {
    return acc + s.rows;
  }, 0);
  var totalClosed = sections.reduce(function (acc, s) {
    return acc + s.closed;
  }, 0);
  out.push('| **Total** | **' + totalRows + '** | **' + totalClosed + '** | |');
  out.push('');
  out.push('The row count is **derived, not targeted**. It is not ' + CONVERSION_SET.total +
    ', and it should not be: the ' + CONVERSION_SET.total + ' counts hapi-invoked');
  out.push('*functions*, while a function typically contains several sites -- a chain, two');
  out.push('callback boundaries, a stream -- each of which is closed separately. Sections 1 to 3');
  out.push('are the ' + CONVERSION_SET.total + '; sections 4 to 7 are the sites inside them;');
  out.push('sections 8 to 10 are deliberately outside.');
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// SECTION 15 -- DOCUMENT ASSEMBLY
// ---------------------------------------------------------------------------

function renderDocument(model, checks) {
  var routedHandlers = model.handlers.filter(function (h) {
    return h.routed;
  });
  var routedPre = model.preHandlers.filter(function (p) {
    return p.routed;
  });
  var unroutedHandlers = model.handlers.filter(function (h) {
    return !h.routed;
  });
  var unroutedPre = model.preHandlers.filter(function (p) {
    return !p.routed;
  });
  var deadRedirects = ANCHORED_SITES.filter(function (s) {
    return s.kind === 'dead-301';
  });
  var bareReplyRows = ANCHORED_SITES.filter(function (s) {
    return s.kind === 'reply-no-return';
  });

  var sections = [
    {
      title: '1. Routed handlers',
      rows: routedHandlers.length,
      closed: routedHandlers.filter(isHandlerClosed).length,
      inSet: 'yes'
    },
    {
      title: '2. Routed pre-handlers (incl. the 2 dead 301s)',
      rows: routedPre.length + deadRedirects.length,
      closed: routedPre.filter(isHandlerClosed).length + deadRedirects.filter(function (s) {
        return !anchoredSiteStillLegacy(model, s);
      }).length,
      inSet: 'yes'
    },
    {
      title: '3. Inline pre-handler',
      rows: model.inlinePreHandlers.length,
      closed: model.inlinePreHandlers.filter(function (i) {
        return i.signature === 'toolkit' && !i.analysis.usesReply;
      }).length,
      inSet: 'yes'
    },
    {
      title: '4. Promise chains',
      rows: model.promiseChains.length,
      closed: model.promiseChains.filter(isChainClosed).length,
      inSet: 'sites within'
    },
    {
      title: '5. Callback boundaries',
      rows: model.callbackBoundaries.length,
      closed: model.callbackBoundaries.filter(isCallbackClosed).length,
      inSet: 'sites within'
    },
    {
      title: '6. Reply chains (+1 distinct shape)',
      rows: REPLY_CHAIN_ROSTER.length + bareReplyRows.length,
      closed: REPLY_CHAIN_ROSTER.filter(function (entry) {
        return !model.replyChains.some(function (c) {
          return c.root === 'reply' && c.file === entry.file && c.startLine === entry.startLine;
        });
      }).length + bareReplyRows.filter(function (s) {
        return !anchoredSiteStillLegacy(model, s);
      }).length,
      inSet: 'sites within'
    },
    {
      title: '7. Stream sites',
      rows: model.streamSiteTotal,
      closed: 0,
      inSet: 'sites within'
    },
    {
      title: '8. Unrouted controller exports',
      rows: unroutedHandlers.length,
      closed: unroutedHandlers.filter(function (h) {
        return !h.gate.forced;
      }).length,
      inSet: 'NO -- excluded'
    },
    {
      title: '9. Unrouted named pre-handlers',
      rows: unroutedPre.length,
      closed: unroutedPre.filter(function (p) {
        return !p.gate.forced;
      }).length,
      inSet: 'NO -- excluded'
    },
    {
      title: '10. Routes with no function',
      rows: EXCLUDED_MISSING_BINDINGS.length,
      closed: EXCLUDED_MISSING_BINDINGS.filter(function (entry) {
        return model.bindings.some(function (d) {
          return d.binding === entry.binding;
        });
      }).length,
      inSet: 'NO -- excluded'
    }
  ];

  var body = [
    renderFrontMatter(model),
    '',
    renderPreamble(),
    renderShapeOverview(model),
    renderConversionSet(model),
    renderSelfCheck(model, checks),
    renderTotals(model, sections),
    renderHandlerRows(model),
    renderPreHandlerRows(model),
    renderInlinePreHandlerRows(model),
    renderPromiseChainRows(model),
    renderCallbackRows(model),
    renderReplyChainRows(model),
    renderStreamRows(model),
    renderExcludedSections(model),
    renderRetainedByDesign()
  ].join('\n');

  // Exactly one trailing newline. Each section renderer ends with a blank
  // line so that sections are separated when they are joined, which leaves a
  // run of newlines at the very end; trimming it here rather than in the
  // renderers keeps the separation rule in one place instead of making the
  // last section a special case.
  return body.replace(/\n+$/, '') + '\n';
}


// ---------------------------------------------------------------------------
// SECTION 16 -- CLI
// ---------------------------------------------------------------------------

var EXIT_OK = 0;
var EXIT_USAGE = 1;
var EXIT_SELF_CHECK = 2;

var USAGE = [
  'Usage: node test/parity/convert-inventory.js [options]',
  '',
  'Generates the per-site conversion checklist for the callback-to-lifecycle',
  'migration. Writes ONLY to --out; never to stdout.',
  '',
  'Options:',
  '  --app <path>   tree to analyse (default: the repository root containing',
  '                 this file). Point it at a `git worktree` to inventory the',
  '                 baseline commit ' + BASELINE_COMMIT + '.',
  '  --out <path>   document to write (default: <repo>/docs/conversion-inventory.md)',
  '  --verbose      print a short summary to stderr',
  '  --help, -h     print this message',
  '',
  'Exit codes:',
  '  0  document written',
  '  1  usage error, or a tree that could not be read',
  '  2  self-check failure -- no document written'
].join('\n');

/** An error carrying an exit code, so main() does not have to guess one. */
function usageError(message) {
  var err = new Error(message);
  err.exitCode = EXIT_USAGE;
  return err;
}

function selfCheckError(message) {
  var err = new Error(message);
  err.exitCode = EXIT_SELF_CHECK;
  return err;
}

function parseArgs(argv) {
  var repoRoot = path.resolve(__dirname, '..', '..');
  var options = {
    app: repoRoot,
    out: null,
    verbose: false,
    help: false,
    repoRoot: repoRoot
  };

  for (var i = 0; i < argv.length; i++) {
    var arg = argv[i];
    switch (arg) {
      case '--app':
        if (i + 1 >= argv.length) {
          throw usageError('--app requires a path.\n\n' + USAGE);
        }
        options.app = path.resolve(argv[++i]);
        break;
      case '--out':
        if (i + 1 >= argv.length) {
          throw usageError('--out requires a path.\n\n' + USAGE);
        }
        options.out = path.resolve(argv[++i]);
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw usageError('Unrecognized argument: ' + arg + '\n\n' + USAGE);
    }
  }

  if (options.out === null) {
    options.out = path.join(repoRoot, 'docs', 'conversion-inventory.md');
  }
  return options;
}

/**
 * Render the self-check failures for stderr. Deliberately verbose: a failure
 * here means the analysis disagrees with a measured figure, and the whole
 * value of failing is that the reader can tell WHICH figure and by how much.
 */
function formatFailures(checks) {
  var lines = [];
  lines.push('convert-inventory: SELF-CHECK FAILED -- no document was written.');
  lines.push('');
  lines.push('A quietly incomplete checklist is worse than none, because it reads as');
  lines.push('completed work. ' + checks.failures.length + ' check' +
    (checks.failures.length === 1 ? '' : 's') + ' failed:');
  lines.push('');
  checks.failures.forEach(function (failure, index) {
    lines.push('  ' + (index + 1) + '. [tier ' + failure.tier + '] ' + failure.message);
  });
  lines.push('');
  lines.push('If a tier-1 check failed, suspect the tokenizer first: a regex literal or a');
  lines.push('comment containing a quote or a backtick will desynchronize a naive scan and');
  lines.push('silently drop sites. config/routes.js and lib/controllers/trinket.js:625 are');
  lines.push('the two known hazards in this repository.');
  return lines.join('\n');
}

function formatSummary(model, checks, outPath) {
  var p = model.provenance;
  return [
    'convert-inventory: wrote ' + outPath,
    '  analysed        : ' + p.appRoot,
    '  HEAD            : ' + (p.appHead || '(not a git worktree)') +
      (p.atBaseline ? '  [base commit]' : ''),
    '  exports         : ' + model.exportTotal + ' (invariant ' + BASELINE_EXPORTS_TOTAL + ')',
    '  conversion set  : ' + CONVERSION_SET.routedHandlers + ' + ' +
      CONVERSION_SET.routedPreHandlers + ' + ' + CONVERSION_SET.inlinePreHandlers +
      ' = ' + CONVERSION_SET.total,
    '  reply( sites    : ' + model.replySitesTotal + ' (baseline ' +
      BASELINE_REPLY_SITES_TOTAL + ')',
    '  chains          : ' + model.promiseChains.length +
      ', callbacks: ' + model.callbackBoundaries.length +
      ', reply chains: ' + REPLY_CHAIN_ROSTER.length +
      ', streams: ' + model.streamSiteTotal,
    '  self-check      : ' + (checks.atBaseline ? 'tiers 1-2 asserted' : 'tier 1 + directional') +
      ', ' + checks.notes.length + ' delta' + (checks.notes.length === 1 ? '' : 's') + ' reported'
  ].join('\n');
}

function main(argv) {
  var options = parseArgs(argv);

  if (options.help) {
    // --help is the one case where a human explicitly asked for output, and
    // stderr keeps stdout clean for callers that redirect it.
    process.stderr.write(USAGE + '\n');
    return EXIT_OK;
  }

  var appStat;
  try {
    appStat = fs.statSync(options.app);
  } catch (err) {
    throw usageError('--app path does not exist: ' + options.app);
  }
  if (!appStat.isDirectory()) {
    throw usageError('--app must be a directory, got: ' + options.app);
  }

  var model = analyseTree(options.app);
  // The provenance block reports the command that produced the document, so
  // the invocation is recorded where the analysis cannot invent it.
  model.provenance.invocation = describeInvocation(options);
  var checks = runSelfChecks(model);

  if (checks.failures.length > 0) {
    throw selfCheckError(formatFailures(checks));
  }

  var document = renderDocument(model, checks);

  var outDir = path.dirname(options.out);
  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (err) {
    throw usageError('Cannot create the output directory ' + outDir + ': ' + err.message);
  }
  try {
    fs.writeFileSync(options.out, document, 'utf8');
  } catch (err) {
    throw usageError('Cannot write ' + options.out + ': ' + err.message);
  }

  if (options.verbose) {
    process.stderr.write(formatSummary(model, checks, options.out) + '\n');
  }

  return EXIT_OK;
}

// A `require.main` guard rather than a bare call, and it is load-bearing
// rather than idiomatic tidiness: test/mocha.opts runs `--recursive` over
// `test/`, so mocha COLLECTS this file as a spec. Without the guard, merely
// running the suite would perform the analysis and write the document as a
// side effect of test collection.
if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err) {
    process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
    process.exitCode = (err && err.exitCode) || EXIT_USAGE;
  }
}

// Exported for the harness and for ad-hoc verification. Every one of these is
// a pure function of text: nothing here opens a socket, connects to a
// database, or requires application code.
module.exports = {
  BASELINE_COMMIT: BASELINE_COMMIT,
  CONTROLLERS: CONTROLLERS,
  CONVERSION_SET: CONVERSION_SET,
  REPLY_CHAIN_ROSTER: REPLY_CHAIN_ROSTER,
  ANCHORED_SITES: ANCHORED_SITES,
  EXCLUDED_MISSING_BINDINGS: EXCLUDED_MISSING_BINDINGS,
  EXCLUDED_UNROUTED_EXPORTS: EXCLUDED_UNROUTED_EXPORTS,
  EXCLUDED_UNROUTED_PRE_HANDLERS: EXCLUDED_UNROUTED_PRE_HANDLERS,
  scrubSource: scrubSource,
  checkDelimiterBalance: checkDelimiterBalance,
  buildLineIndex: buildLineIndex,
  lineAt: lineAt,
  readFunctionAt: readFunctionAt,
  classifySignature: classifySignature,
  describeInvocation: describeInvocation,
  errorEdgeRef: errorEdgeRef,
  quirkRef: quirkRef,
  anchoredQuirkRef: anchoredQuirkRef,
  pluralize: pluralize,
  analyseFunctionShape: analyseFunctionShape,
  findControllerExports: findControllerExports,
  findPromiseChains: findPromiseChains,
  findCallbackBoundaries: findCallbackBoundaries,
  findReplyChains: findReplyChains,
  findUnreturnedBareReplies: findUnreturnedBareReplies,
  deriveStreamSites: deriveStreamSites,
  findNamedPreHandlers: findNamedPreHandlers,
  findRouteDeclarations: findRouteDeclarations,
  findInlinePreHandlers: findInlinePreHandlers,
  findPreHandlerReferences: findPreHandlerReferences,
  assembleRouteExpression: assembleRouteExpression,
  analyseTree: analyseTree,
  runSelfChecks: runSelfChecks,
  renderDocument: renderDocument,
  parseArgs: parseArgs,
  main: main
};

