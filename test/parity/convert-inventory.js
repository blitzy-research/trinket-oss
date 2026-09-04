#!/usr/bin/env node
/**
 * Generates docs/conversion-inventory.md -- the per-site checklist for the
 * callback-to-lifecycle conversion -- from the analysed tree's own source text.
 * Over the base commit it is the work to be done, over a converted tree what is
 * closed and what is not, and the document states which. Every input is read AS
 * TEXT: requiring lib/controllers/users.js would create the exports queue and
 * load the AWS SDK inside a static generator.
 *
 * INVOCATION
 *   node test/parity/convert-inventory.js [--app <path>] [--out <path>]
 *                                         [--check] [--verbose]
 *
 *   --app      tree to analyse; default the repository holding this file. A
 *              `git worktree` path inventories another commit.
 *   --out      document to write; default <repo>/docs/conversion-inventory.md.
 *   --check    write nothing: regenerate in memory, compare with the document at
 *              --out, exit 3 if it differs -- so a committed artifact is proven
 *              current without trusting its own header.
 *   --verbose  a one-screen summary on STDERR. Off by default.
 *
 *   The document goes ONLY to --out; nothing goes to stdout, and a successful
 *   run writes nothing to stderr either, because this tooling's stderr sits in
 *   the zero-deprecation-warning gate's captured stream. Failures do report
 *   there. Exit codes: 0 written or already current, 1 usage error or unreadable
 *   tree, 2 self-check failure with nothing written, 3 --check found it stale.
 *
 * ARTIFACT
 *   One Markdown document, written atomically through a same-directory rename so
 *   a reader never sees a partial file. Its first line is a machine-readable
 *   `provenance-json` block, repeated in the front matter and read back by
 *   `node test/parity/manifest.js --verify-provenance <document>`: the analysed
 *   revision, whether it still describes the analysed BYTES, a digest over
 *   exactly the files read, this generator's digest and git blob, and a
 *   `bodyDigest` over the prose beneath.
 *
 *   A row carries the SITE, anchored by the symbol enclosing it rather than by a
 *   line so the anchor survives editing; its CURRENT SHAPE as measured here; its
 *   TARGET DISPOSITION; and, where that target is a measured outcome rather than
 *   a construction, its EVIDENCE STATE.
 *
 * THE ROW COUNT IS DERIVED, NEVER DECLARED
 *   Handler rows come from the binding graph, not the export list: routes name
 *   controller methods that do not exist, and exports go unrouted. Every other
 *   row is whatever the analysers find, and a signature census cannot stand in
 *   for them -- a returned-but-unawaited chain and an awaited-but-unreturned one
 *   are both `async (request, h)`, and hapi turns the `undefined` into a 500.
 *
 * FOUR RECURRING SHAPES, EACH WITH ITS OWN FAILURE MODE
 *   promise chain      its value must leave the enclosing function exactly once
 *                      per path, and a terminal link handed a bare function
 *                      reference has its return value discarded by the caller.
 *   callback boundary  the `await` is created AT THE CALL SITE, inside the
 *                      converted lifecycle method, not pushed down into
 *                      lib/util/file.js, lib/util/store.js or lib/util/queues.js,
 *                      which keep their callback interfaces.
 *   reply chain        the outcome is NOT uniform: in the shim's response
 *                      builder some links resolve the deferred and others hand
 *                      the builder back, so the outcome turns on which ran LAST.
 *   stream             completion and error TIMING is what must survive, and no
 *                      reading of a `.pipe(...)` establishes it.
 *   The last two are joined to the scenario that drives them, read from
 *   test/parity/corpus.json as DATA, and close only on a captured baseline plus
 *   a confirming replay verdict; a corpus-less tree reports having no evidence.
 *
 * SCRUB, THEN SCAN
 *   The order inside scrubSource() is load-bearing: comments first, then quotes,
 *   then regex literals. The password schema in config/routes.js and
 *   config/api_routes.js has a character class holding a single quote, a double
 *   quote and an UNPAIRED backtick, so a scan reaching template literals first
 *   blanks the rest of the file; lib/controllers/trinket.js has a pair of
 *   backticks inside a `//` comment that such a scan reads as a template. Regex
 *   and division share `/`, decided from the preceding token; the balance check
 *   in checkDelimiterBalance() is the tokenizer's self-test.
 *
 * A ROW THAT CANNOT BE PLACED FAILS THE RUN
 *   runSelfChecks() exits 2 without writing when the analysis disagrees with the
 *   recorded baseline in a way conversion cannot explain, or when an anchored
 *   site or roster entry cannot be located by its symbol. auditRenderedEvidence
 *   then refuses to write a document asserting a measurement the corpus lacks.
 */

'use strict';

var childProcess = require('node:child_process');
var crypto = require('node:crypto');
var fs = require('node:fs');
var path = require('node:path');

// The provenance contract shared by every tool in test/parity/ and by the two
// generated inventories in docs/. Required from manifest.js because that tool
// is Node-core-only at module scope, and because a second copy of these
// guarantees would drift from the first. It supplies what a local
// implementation cannot: the generator identified by its git BLOB, a commit
// recorded only when that commit's tree holds that blob, and a `bodyDigest`
// that binds this document to its own prose so a hand-edited row cannot verify
// clean.
var provenanceContract = require('./manifest').provenance;

// ---------------------------------------------------------------------------
// SECTION 1 -- MEASURED BASELINE CONSTANTS
//
// Every figure below is measured on a worktree at the base commit named in
// BASELINE_COMMIT, using the analysers in this file. They are recorded here
// rather than recomputed because their whole purpose is to be a fixed
// reference the analysis can be checked against: a figure that moves with the
// code it is supposed to police checks nothing. The base commit is also the
// authority for the "current shape" column.
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
// metrics. The stream figure has to be DERIVED rather than grepped: a crude
// pattern under-counts, and the rule deriveStreamSites() documents is what
// yields the figure below across four controllers.
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
//
// The two promise-chain figures were RE-MEASURED when `isPromiseReaction` was
// added, and the correction is recorded here rather than quietly absorbed. The
// earlier figures were 129 chains and 39 open, counting
// `lib/controllers/folders.js:71` and `:128` -- two `request.catch({ ... })`
// member calls that share the name of a promise reaction but are not one: the
// member does not exist, so the call throws `TypeError` and the route
// catch-all answers 500 (a preserved quirk, present at the base commit and
// after conversion alike). A constant measured by a corrected analyser is a
// corrected constant; what would be dishonest is leaving the old number and
// letting the check fail on the tree it was measured from.
//
// THE OPEN FIGURE IS PREDICATE-RELATIVE, and it was re-measured a second time
// for the same reason. It was 37 under a closure test that read only
// `return`/`await` and only a first-argument function literal; under the
// disposition model in `resolveChainDispositions` -- which recognizes the five
// delivery mechanisms this codebase actually uses and asks whether a discarded
// value could have been the response -- the base commit measures 21: 17
// discarded inside a carrier with no proven delivery, and 4 delivered into a
// terminal reaction that produces nothing. The POPULATION figure is unchanged
// at 127, because what a chain IS did not change; only the question asked of
// it did. Re-measured with:
//
//   git worktree add --detach "$BASELINE" 2f8712a
//   node test/parity/convert-inventory.js --app "$BASELINE" --out "$OUT"
//
// The same run corroborates the direction the whole document depends on: at
// the base commit 2 of 145 routed handlers close and 52 of 57 callback
// boundaries are open, against 145 and 0 in the delivered tree. A predicate
// that closed rows indiscriminately could not produce that gap.
var BASELINE_PROMISE_CHAINS = 127;
var BASELINE_PROMISE_CHAINS_OPEN = 21;
var BASELINE_NON_REACTION_CATCHES = 2;
var BASELINE_CALLBACK_BOUNDARIES = 57;

// Coordinates the surrounding documents cite for a site whose measured extent
// differs from the citation, so the row can carry both: the citation a reader
// will be searching for, and the extent measured in the analysed tree. The
// chain in `lib/controllers/pages.js`'s `home` is the case in point.
//
// The anchor is the ENCLOSING FUNCTION, never the line span. Once the file is
// edited the chain moves out from under any cited line, and a span-anchored
// citation then disappears from the document exactly when a reader
// cross-referencing another document most needs it.
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
// `internals.lowerUserFields` and `findFeaturedTrinkets`, both declared
// `(request, h)`. That exclusion is exactly what makes 11 = 8 routed + 3
// unrouted close.
var BASELINE_NAMED_PRE_HANDLERS = 11;

// ---------------------------------------------------------------------------
// SECTION 2 -- THE ANCHORED ROSTER
//
// Eight reply chains, and they are NOT uniform. In the response builder the
// shim's fake `reply` returns, `.type()` and `.bytes()` hand back the builder
// WITHOUT resolving the deferred, while `.code()`, `.header()`,
// `.redirect()` and `.view()` resolve it. So what a client actually receives
// depends on which chain method ran LAST -- and 13 `.type()`/`.bytes()` calls
// spread across 8 chains produce three different outcomes.
//
// That three-way classification is an EXECUTION-TIME measurement of the shim.
// No amount of reading the text tells you whether a given chain settled,
// because the answer depends on the order the builder's methods ran in. The
// roster is therefore carried here as a recorded baseline fact, and each entry
// is VERIFIED against the analysed tree with an open/closed determination
// rather than re-derived from it.
// ---------------------------------------------------------------------------

var REPLY_CHAIN_ROSTER = [
  {
    file: 'lib/controllers/files.js',
    lines: '98-100',
    startLine: 98,
    endLine: 100,
    carrier: 'download',
    links: ['type', 'bytes'],
    ordinal: 1,
    targetShape: { root: 'h.response', links: ['type', 'bytes'] },
    scenario: 'quirk.reply-chain.never-settles.image-download',
    category: 'never-settles',
    current: 'reply(stream).type(...).bytes(...) with no `return` and no resolving ' +
      'call. Neither .type() nor .bytes() settles the deferred, so the ' +
      'image-download branch never produces a response at all -- the request hangs.',
    // The renderer prepends the bold "APPROVED DEVIATION." marker, so the text
    // itself must not repeat it.
    targetText: 'Return `h.response(stream).type(request.pre.file.mime)' +
      '.bytes(request.pre.file.size)` -- and NO Content-Disposition header, because ' +
      'the image branch deliberately omits it.',
    approvedDeviation: true,
    // One sentence, and it is the sentence an implementer needs at the call
    // site: the response to serve is not inferred, it is already written four
    // lines below. The precedence argument lives in docs/preserved-quirks.md
    // and the renderer emits a pointer to it, so it is not repeated here.
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
    carrier: 'download',
    links: ['type', 'bytes', 'header'],
    ordinal: 1,
    targetShape: { root: 'h.response', links: ['type', 'bytes', 'header'] },
    scenario: 'quirk.reply-chain.header-resolved.file-download-attachment',
    category: 'header-resolved',
    current: 'reply(stream).type(...).bytes(...).header(\'Content-Disposition\', ...). ' +
      'Also has no `return`, but .header() resolves the deferred, so it works and ' +
      'returns a real hapi response.',
    targetText: 'Identical response. This is the non-image branch and it must NOT become ' +
      'collateral damage of the approved deviation four lines above.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/courses.js',
    lines: '269-272',
    startLine: 269,
    endLine: 272,
    // The innermost symbol containing the site, which is what the anchor
    // resolves: `returnZip` is a named function declared inside the routed
    // `courses.download`, and the chain lives in it at both commits.
    carrier: 'returnZip',
    links: ['type', 'bytes', 'header'],
    ordinal: 1,
    targetShape: { root: 'h.response', links: ['type', 'bytes', 'header'] },
    scenario: 'quirk.reply-chain.header-resolved.course-download-zip',
    category: 'header-resolved',
    current: 'return reply(stream).type(\'application/zip\').bytes(stats.size)' +
      '.header(\'Content-Disposition\', ...), inside the rimraf callback. Works: ' +
      '.header() resolves the deferred.',
    targetText: 'Identical response. Baseline WAITS for the deletion callback before the ' +
      'final .header() resolves, so the conversion awaits fs.promises.rm, swallows its ' +
      'error exactly as the empty callback does, and only then returns the response.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1204',
    startLine: 1204,
    endLine: 1204,
    carrier: 'downloadMain',
    links: ['type'],
    ordinal: 1,
    // No target SHAPE is declared for a builder-returned chain, and that is a
    // decision rather than an omission: what the builder emitted is not
    // inferable from the text, so the target is the MEASURED status,
    // content-type and body. The structural half of closure is that the legacy
    // chain is gone; the behavioural half is the corpus.
    targetShape: null,
    scenario: 'quirk.reply-chain.builder-returned.download-main',
    category: 'builder-returned',
    current: 'return reply(code[0].content).type(type) -- hands the WRAPPER the builder ' +
      'object rather than a hapi response. What is emitted depends on whether the ' +
      'deferred had already been resolved earlier in the request.',
    // Phrased as the REQUIREMENT, not as a claim that the measurement exists.
    // Whether it does is the row's own EVIDENCE sentence, computed from the
    // corpus; stating it twice let the target text assert a capture the
    // evidence sentence was simultaneously reporting as absent.
    targetText: 'Reproduce the status, content-type and body this branch measures, as ' +
      'recorded for its scenario by test/parity/capture.js.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1246',
    startLine: 1246,
    endLine: 1246,
    carrier: 'downloadFile',
    links: ['type'],
    // Two chains of the identical shape live in `downloadFile`, so the anchor
    // carries their order within the carrier. The ordinal is only ever a
    // tie-breaker between same-shaped chains in one symbol.
    ordinal: 1,
    targetShape: null,
    scenario: 'quirk.reply-chain.builder-returned.download-code-file',
    category: 'builder-returned',
    current: 'return reply(file.content).type(type) -- builder object returned to hapi.',
    // Phrased as the REQUIREMENT, not as a claim that the measurement exists.
    // Whether it does is the row's own EVIDENCE sentence, computed from the
    // corpus; stating it twice let the target text assert a capture the
    // evidence sentence was simultaneously reporting as absent.
    targetText: 'Reproduce the status, content-type and body this branch measures, as ' +
      'recorded for its scenario by test/parity/capture.js.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1259',
    startLine: 1259,
    endLine: 1259,
    carrier: 'downloadFile',
    links: ['type'],
    ordinal: 2,
    targetShape: null,
    scenario: 'quirk.reply-chain.builder-returned.download-asset',
    category: 'builder-returned',
    current: 'return reply(stream).type(type) inside a .then() -- builder object ' +
      'returned to hapi, wrapping a stream.',
    // Phrased as the REQUIREMENT, not as a claim that the measurement exists.
    // Whether it does is the row's own EVIDENCE sentence, computed from the
    // corpus; stating it twice let the target text assert a capture the
    // evidence sentence was simultaneously reporting as absent.
    targetText: 'Reproduce the status, content-type and body this branch measures, as ' +
      'recorded for its scenario by test/parity/capture.js.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1383-1386',
    startLine: 1383,
    endLine: 1386,
    carrier: 'downloadPostedZip',
    links: ['type', 'bytes', 'header'],
    ordinal: 1,
    targetShape: { root: 'h.response', links: ['type', 'bytes', 'header'] },
    scenario: 'quirk.reply-chain.header-resolved.posted-zip-download',
    category: 'header-resolved',
    current: 'return reply(outputReadStream).type(\'application/zip\').bytes(bytes)' +
      '.header(\'Content-Disposition\', ...). Works: .header() resolves the deferred.',
    targetText: 'Identical response, including the quoted filename form this chain uses.',
    approvedDeviation: false
  },
  {
    file: 'lib/controllers/trinket.js',
    lines: '1548-1551',
    startLine: 1548,
    endLine: 1551,
    // A module-scope function, not an exported handler: the site is inside
    // `downloadZip`, which the route reaches through the
    // `supportedDownloadFormats` dispatch table.
    carrier: 'downloadZip',
    links: ['type', 'bytes', 'header'],
    ordinal: 1,
    targetShape: { root: 'h.response', links: ['type', 'bytes', 'header'] },
    scenario: 'quirk.reply-chain.header-resolved.short-code-zip',
    category: 'header-resolved',
    current: 'return reply(outputReadStream).type(\'application/zip\').bytes(bytes)' +
      '.header(\'Content-Disposition\', ...). Works: .header() resolves the deferred.',
    targetText: 'Identical response, including the unquoted filename form this chain uses.',
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
    // No corpus scenario drives the ERROR path of POST /api/trinkets -- the
    // route is covered only by a success scenario, which is not evidence for
    // this row. Left null deliberately: a row that names the wrong scenario
    // is worse than one that reports having none.
    scenario: null,
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
    scenario: 'quirk.dead-301.find-trinket-language-mismatch',
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
    scenario: 'quirk.dead-301.course-by-slug-alias',
    current: 'courseBySlug slug-alias branch (reached from 5 route declarations): return ' +
      'reply().redirect(location).permanent().takeover(). MEASURED DEAD by the same ' +
      'mechanism -- the deferred is already settled with null.',
    target: 'return null. Coverage is counted from the route manifest rather than from ' +
      'lexical references, because the per-language expansion multiplies them.'
  }
];

// Target-idiom anchors. Every one of these is already in the tree, so the
// conversion has references rather than inventions to work from. The
// coordinates are the base commit's; a converted tree has moved some of them.
var TARGET_IDIOM_ANCHORS = [
  {
    site: 'lib/util/helpers.js:397-403',
    // The anchor carries the SYMBOL it names, so the analysed tree is searched
    // for that export rather than for a position. An earlier revision printed
    // this anchor's name beside `nativePreHandlers[0].line`, which is the
    // first native pre-handler in file order -- `findTrinket`, at
    // lib/util/helpers.js:143 and not even declared `async`. The document
    // therefore reported the exemplar at a line belonging to a different
    // function, which is the one thing a reader follows this pointer to check.
    symbol: 'findFeaturedTrinkets',
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
// what it must return afterwards. Two sibling documents carry the rest of the
// story about the same sites, and a pointer rather than a second copy is what
// keeps one place for each fact:
//
//   docs/preserved-quirks.md      -- the measured baseline OUTCOME of a quirk,
//                                    and, for each of the TWO approved
//                                    deviations, the full precedence argument.
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

// The row kinds that are composed from a GENERIC MANDATE plus a pointer, and
// are therefore the kinds a governing action can displace. Every other row in
// this document -- an anchored site, one of the eight reply chains -- states
// its target per site and never takes a mandate, so there is nothing there to
// displace (see ALLOW_LIST_COVERAGE).
var ROW_KINDS = ['handler', 'pre-handler', 'chain', 'callback', 'stream'];

// What the displaced mandate is CALLED, per row kind. A governed row has to
// name what it displaced, or a reader cannot tell that the omission was
// deliberate rather than a generator fault.
var GENERIC_MANDATE_LABELS = {
  handler: 'handler conversion mandate',
  'pre-handler': 'pre-handler conversion mandate',
  chain: 'promise-chain mandate',
  callback: 'callback-boundary mandate',
  stream: 'stream-timing mandate'
};

// Quirk ownership per hapi-invoked function, keyed by the ENCLOSING FUNCTION
// rather than by line, so the reference survives the file being edited. Every
// entry names a quirk whose target disposition REPRODUCES a defect: the row
// says so and points here, and no row proposes the fix.
//
// This table is also the ALLOW-LIST from docs/preserved-quirks.md Appendix A,
// and that changes how it is consumed. A pointer appended AFTER a generic
// mandate is not enough: for a site whose preserved outcome requires the body
// NOT to return -- to be left unsettled, or to throw -- the mandate and the
// pointer say opposite things in the same cell, and the mandate comes first.
// Appendix A is explicit that the allow-list must be resolved BEFORE the
// action is composed, so composeTarget() looks here first and lets the
// governing action replace or qualify the mandate.
//
// Three optional fields carry that:
//
//   kinds    -- the row kinds this entry applies to AT ALL. Omitted means every
//               kind, which is right for a quirk about whether a handler
//               settles: that is worth pointing at from the chain, callback and
//               stream rows inside it. An entry that is about ONE expression
//               names its kinds, so it does not decorate ten unrelated rows in
//               the same function.
//   governs  -- per row kind, the governing target action: `action` (what to
//               do), `why` (why the generic mandate is wrong there, from
//               Appendix A's third column) and `mode`:
//                 'replace'  -- the mandate does not apply to this row at all;
//                 'qualify'  -- the mandate still governs the rest of the body
//                               and the governed branch is carved out of it.
//   note     -- the measured outcome, emitted by quirkRef().
var QUIRK_REFS = [
  {
    file: 'lib/controllers/pages.js',
    enclosing: 'login',
    section: '5',
    note: 'the authenticated-visitor 500 is REPRODUCED -- `reply.redirect` is a property ' +
      'access on a bare function and throws a TypeError that reaches the catch-all',
    governs: {
      handler: {
        mode: 'replace',
        action: 'keep `return reply.redirect(\'/home\')` as the expression it is, so the ' +
          'authenticated branch throws its `TypeError` and reaches the preserved handler ' +
          'catch-all as a 500',
        why: 'returning `request.success(...)` / `request.fail(...)` on every path would ' +
          'replace the throw with a working response, which is the quirk itself'
      }
    }
  },
  {
    file: 'lib/controllers/pages.js',
    enclosing: 'signup',
    section: '5',
    note: 'the authenticated-visitor 500 is REPRODUCED, and `request.yar.set(\'next\', ...)` ' +
      'stays in the `else` branch only -- it does not precede the throw',
    governs: {
      handler: {
        mode: 'replace',
        action: 'keep `return reply.redirect(\'/welcome\')` as the expression it is, so the ' +
          'authenticated branch throws and answers 500, and leave ' +
          '`request.yar.set(\'next\', ...)` in the `else` branch only',
        why: 'returning `request.success(...)` / `request.fail(...)` on every path would ' +
          'replace the throw with a working response, which is the quirk itself'
      }
    }
  },
  {
    file: 'lib/controllers/auth.js',
    enclosing: 'googleCallback',
    section: '6',
    note: 'the new-user path persists the user, mutates session state and THEN reports the ' +
      'generic failure; that sequence is reproduced, not repaired',
    governs: {
      handler: {
        mode: 'replace',
        action: 'persist the user, mutate the session, and THEN report the generic ' +
          'authentication failure -- preserve that ORDER and the absence of a login, so a ' +
          'first-time sign-in still creates the account and still reports failure',
        why: 'a mandate to return a response on every path can silently drop the throw that ' +
          'produces the failure'
      },
      chain: {
        mode: 'replace',
        action: 'keep the chain returned, and keep the link that throws on the undefined ' +
          '`opts` reference throwing, so the `.catch` still produces the generic ' +
          'authentication failure after the user has been persisted',
        why: 'requiring that no branch inside the links return nothing is the same mandate ' +
          'one level down, and the branch that returns nothing is the one that produces the ' +
          'failure'
      },
      callback: {
        mode: 'replace',
        action: 'take the `await` at this call site, and keep the surrounding order intact -- ' +
          'persist, mutate the session, then report the generic failure',
        why: 'continuing with a result on every path can drop the throw that produces the ' +
          'failure',
        // The same quirk, stated for a boundary that KEEPS its callback
        // interface: there is no `await` to place, so what survives is the
        // order the conversion must not disturb.
        whenKept: {
          action: 'keep the surrounding ORDER intact through this callback -- persist the ' +
            'user, mutate the session, and only THEN report the generic failure -- and do ' +
            'not let the conversion of anything around it drop the throw that produces that ' +
            'failure',
          why: 'a callback-boundary mandate that continues with a result on every path can ' +
            'drop the throw that produces the failure'
        }
      }
    }
  },
  {
    file: 'lib/controllers/folders.js',
    enclosing: 'trinkets',
    section: '7',
    note: 'the queryless case passes NO folder filter because the injected URL is malformed; ' +
      'the extraction must reproduce both cases',
    governs: {
      handler: {
        mode: 'replace',
        action: 'pass NO folder filter on the queryless path, and pass it only when a query ' +
          'is present -- the extracted core reproduces both cases',
        why: '"every path returns exactly once" is satisfiable while accidentally passing the ' +
          'folder through on the queryless path, which R-d forbids'
      }
    }
  },
  {
    file: 'lib/controllers/users.js',
    enclosing: 'assetUploadFromURL',
    section: '8.1',
    note: 'a refused connection logs and leaves the route UNSETTLED; the conversion must not ' +
      'turn that into a rejection',
    governs: {
      handler: {
        mode: 'replace',
        action: 'on transport refusal, log and leave the request UNSETTLED -- one path ' +
          'deliberately returns nothing, and the other paths return as they do today',
        why: '"every path returns exactly once" is the direct negation of this quirk'
      },
      chain: {
        mode: 'replace',
        action: 'await the transport chain where baseline continues, and leave the ' +
          'refused-connection path UNSETTLED -- that path deliberately produces no response',
        why: 'returning the chain\'s value exactly once per path settles the path this quirk ' +
          'requires to stay open'
      },
      callback: {
        mode: 'replace',
        action: 'take the `await` at this call site WITHOUT making the refused-connection ' +
          'path settle: the upload never starts when `end` never arrives, and the route is ' +
          'left unsettled',
        why: 'a callback-boundary mandate that continues with a result on every path removes ' +
          'the unsettled outcome',
        // The same quirk, stated for a boundary that KEEPS its shape -- a
        // callee with no promise form, or a scheduling primitive whose timing
        // is the target. Nothing is being converted at the site, so the
        // surviving requirement is the outcome the surrounding function must
        // still produce.
        whenKept: {
          action: 'keep the refused-connection path UNSETTLED -- when `end` never arrives ' +
            'the upload never starts and that path deliberately produces no response, so ' +
            'nothing done to this boundary or to the code around it may make the route ' +
            'answer on it',
          why: 'a callback-boundary mandate that continues with a result on every path ' +
            'removes the unsettled outcome'
        }
      }
    }
  },
  {
    // The generic mandate is exactly wrong for this handler, so it needs both
    // an entry here and a governing action. docs/preserved-quirks.md states the
    // outcome: the route is real, routed and authenticated, and it answers 500.
    file: 'lib/controllers/courses.js',
    enclosing: 'download',
    section: '9.7',
    kinds: ['handler'],
    note: 'the unauthorized branch evaluates an UNBOUND `Boom`, so it throws a ' +
      '`ReferenceError` before any response is constructed and the route answers 500 where ' +
      'the expression names 403',
    governs: {
      handler: {
        mode: 'replace',
        action: 'keep the residual `reply(Boom.forbidden())` in the unauthorized branch ' +
          'exactly as it stands, so it throws and the route answers 500',
        why: 'converting every `reply(...)` into a returned toolkit response -- or taking the ' +
          'residual-reply row\'s "either return a toolkit response there" option -- would ' +
          'turn the 500 into the 403 the expression names'
      }
    }
  },
  {
    // The two measured-dead 301s have their own anchored rows, which state
    // "return null" per site. This entry covers the pre-handler row for the
    // function that CONTAINS one of them, which would otherwise take the
    // generic mandate: "every reply(...) becomes a returned toolkit response",
    // applied to reply().redirect(...).permanent().takeover(), emits a 301 the
    // baseline never emitted. The mandate is right for the rest of the body, so
    // this is a qualification rather than a replacement.
    file: 'lib/util/helpers.js',
    enclosing: 'findTrinket',
    section: '2',
    kinds: ['pre-handler'],
    note: 'the language-mismatch 301 at `lib/util/helpers.js:182` is MEASURED DEAD -- the ' +
      'deferred is settled with `null` at `lib/util/routeParser.js:147` before `.takeover()` ' +
      'reaches its own resolve at `:154`, so the pre value is already `null`',
    governs: {
      'pre-handler': {
        mode: 'qualify',
        action: 'at the language-mismatch branch, `return null` -- the value the shim ' +
          'produced. Its redirect construction is REMOVED, not converted',
        why: 'converting that chain into a returned toolkit response would emit a 301 the ' +
          'baseline never emitted'
      }
    }
  },
  {
    file: 'lib/util/helpers.js',
    enclosing: 'courseBySlug',
    section: '2',
    kinds: ['pre-handler'],
    note: 'the slug-alias 301 at `lib/util/helpers.js:385`, reached from 5 route ' +
      'declarations, is MEASURED DEAD by the same mechanism -- the deferred is already ' +
      'settled with `null`',
    governs: {
      'pre-handler': {
        mode: 'qualify',
        action: 'at the slug-alias branch, `return null` -- the value the shim produced. Its ' +
          'redirect construction is REMOVED, not converted',
        why: 'converting that chain into a returned toolkit response would emit a 301 the ' +
          'baseline never emitted'
      }
    }
  }
];

// docs/preserved-quirks.md Appendix A is a TEN-ROW contract, and this is the
// map of how each row is discharged. It exists so the encoding is auditable
// rather than asserted: runSelfChecks() resolves every satisfaction below and
// fails the run if one of them no longer exists.
//
// A row is discharged in one of two ways:
//
//   governs  -- the site takes a generic mandate from one of the five row
//               kinds, so the governing action lives in QUIRK_REFS above and
//               composeTarget() resolves it before the mandate is composed;
//   per-site -- the site's target is already stated per site by ANCHORED_SITES
//               or REPLY_CHAIN_ROSTER, so no generic mandate is ever composed
//               for it and there is nothing to displace.
//
// The last row is the INVERSE case and is deliberately here: in
// `lib/controllers/trinket.js`'s `create`, the unreturned `reply(err)` on the
// error path genuinely must change for the outcome to be preserved. The
// allow-list is not "never change a statement" -- it is "the quirk record
// decides, and it is consulted first".
var ALLOW_LIST_COVERAGE = [
  {
    site: 'lib/controllers/pages.js `login`',
    section: '5',
    governs: [{ file: 'lib/controllers/pages.js', enclosing: 'login', kind: 'handler' }]
  },
  {
    site: 'lib/controllers/pages.js `signup`',
    section: '5',
    governs: [{ file: 'lib/controllers/pages.js', enclosing: 'signup', kind: 'handler' }]
  },
  {
    site: 'lib/controllers/users.js `assetUploadFromURL` (handler)',
    section: '8.1',
    governs: [{ file: 'lib/controllers/users.js', enclosing: 'assetUploadFromURL', kind: 'handler' }]
  },
  {
    site: 'lib/controllers/users.js `assetUploadFromURL` callback boundaries and its ' +
      'transport chain',
    section: '8.1',
    governs: [
      { file: 'lib/controllers/users.js', enclosing: 'assetUploadFromURL', kind: 'callback' },
      { file: 'lib/controllers/users.js', enclosing: 'assetUploadFromURL', kind: 'chain' }
    ]
  },
  {
    site: 'lib/controllers/auth.js `googleCallback`, its three callback boundaries and its ' +
      'chains',
    section: '6',
    governs: [
      { file: 'lib/controllers/auth.js', enclosing: 'googleCallback', kind: 'handler' },
      { file: 'lib/controllers/auth.js', enclosing: 'googleCallback', kind: 'callback' },
      { file: 'lib/controllers/auth.js', enclosing: 'googleCallback', kind: 'chain' }
    ]
  },
  {
    site: 'lib/controllers/folders.js `trinkets`',
    section: '7',
    governs: [{ file: 'lib/controllers/folders.js', enclosing: 'trinkets', kind: 'handler' }]
  },
  {
    site: 'lib/controllers/courses.js `download`',
    section: '9.7',
    governs: [{ file: 'lib/controllers/courses.js', enclosing: 'download', kind: 'handler' }]
  },
  {
    site: 'lib/util/helpers.js:182 `findTrinket`, :385 `courseBySlug`',
    section: '2',
    governs: [
      { file: 'lib/util/helpers.js', enclosing: 'findTrinket', kind: 'pre-handler' },
      { file: 'lib/util/helpers.js', enclosing: 'courseBySlug', kind: 'pre-handler' }
    ],
    anchored: [
      { file: 'lib/util/helpers.js', line: 182 },
      { file: 'lib/util/helpers.js', line: 385 }
    ]
  },
  {
    site: 'lib/controllers/trinket.js:1204, :1246, :1259',
    section: '4.3',
    roster: [
      { file: 'lib/controllers/trinket.js', startLine: 1204 },
      { file: 'lib/controllers/trinket.js', startLine: 1246 },
      { file: 'lib/controllers/trinket.js', startLine: 1259 }
    ]
  },
  {
    site: 'lib/controllers/trinket.js:375 -- the inverse case, where the statement MUST change',
    section: '4.4',
    anchored: [{ file: 'lib/controllers/trinket.js', line: 375 }]
  }
];

// Appendix A's row count. An eleventh row appearing there without appearing
// above is the failure this number exists to catch.
var ALLOW_LIST_ROWS = 10;

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

// The quirk sections that own the migration's approved deviations. The
// precedence argument lives there in full; this document states the target and
// points at it.
//
// There are TWO, and generated prose must not collapse them to one -- the
// closing paragraph of docs/preserved-quirks.md Appendix A is explicit about
// why. The count is the smaller half of it; the KIND is what makes the
// reference useful to a row:
//
//   deviation 1 (\u00a711.1) is a RESPONSE deviation -- the never-settling
//   image-download branch is served -- and it is the only one a row in this
//   checklist can be affected by, because it is the only row whose target
//   changes observable behaviour;
//
//   deviation 2 (\u00a711.2) is an AUDIT deviation -- the `marked` fork is
//   retained, leaving one named high advisory -- and no conversion row touches
//   it, because retaining the fork is precisely what keeps rendered output
//   identical.
//
// So a row cites \u00a711.1, and the cross-reference section names both and says
// which is which.
var DEVIATION_QUIRK_SECTION = '11.1';
// The rest of the deviation register. There are TWO deviations and they differ
// in kind, which is what makes the reference useful to a row: deviation 1 is a
// RESPONSE deviation and the only one a conversion row touches, deviation 2 is
// an AUDIT deviation with no conversion site.
var AUDIT_DEVIATION_QUIRK_SECTION = '11.2';
var DEVIATION_REGISTER_QUIRK_SECTION = '11';
var DEFERRED_DEPENDENCY_DOC = 'docs/deferred-dependencies.md';
var AUDIT_DEVIATION_DEFERRED_SECTION = '4.2';

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

/**
 * The allow-list entry covering one site, or null.
 *
 * `kind` is optional and is what scopes an entry to the rows it is actually
 * about. An entry with no `kinds` list covers every row inside the function,
 * which is right for a quirk about whether the function settles at all; an
 * entry that names its kinds covers only those, so a quirk about one
 * expression does not decorate ten unrelated rows in the same body. Calling
 * this without a `kind` matches on the function alone, which is what the
 * exported two-argument quirkRef form does.
 */
function quirkEntry(file, enclosing, kind) {
  if (!enclosing) {
    return null;
  }
  for (var i = 0; i < QUIRK_REFS.length; i++) {
    var ref = QUIRK_REFS[i];
    if (ref.file === file && ref.enclosing === enclosing) {
      if (kind && ref.kinds && ref.kinds.indexOf(kind) === -1) {
        return null;
      }
      return ref;
    }
  }
  return null;
}

/** The quirk pointer for a hapi-invoked function, or '' when it carries none. */
function quirkRef(file, enclosing, kind) {
  var ref = quirkEntry(file, enclosing, kind);
  if (!ref) {
    return '';
  }
  return ' PRESERVED QUIRK -- ' + ref.note + '. Owned by `' + QUIRK_DOC +
    '` \u00a7' + ref.section + '; reproduce it, do not fix it.';
}

/**
 * The governing target action for one row, or null when the generic mandate
 * for that row kind is compatible with the quirk and stands as it is.
 *
 * `state` is the row's CURRENT state, and it selects between two phrasings of
 * the same quirk. A governing action is written as an instruction, and an
 * instruction is only correct against a stated starting point: "take the
 * `await` at this call site" presumes the site still has a callback to
 * replace. On a boundary the migration KEEPS -- rule T-3, no promise form to
 * await without pushing the boundary into the callee -- that instruction is
 * not merely redundant but the opposite of the row's own disposition, and nine
 * rows read "LEAVE THE INTERFACE AS IT STANDS ... Do not promisify the callee
 * to create an `await` here" followed by "GOVERNING ACTION -- take the `await`
 * at this call site" before this existed.
 *
 * So an entry whose action presumes a conversion carries a `whenKept` variant
 * stating what survives of the quirk when there is no conversion left to
 * perform: the OUTCOME to reproduce, without the instruction that contradicts
 * the kept interface. `why` falls back to the base entry's when the variant
 * does not restate it, because the reason the generic mandate is wrong there
 * does not change with the row's state.
 */
function governingAction(file, enclosing, kind, state) {
  var ref = quirkEntry(file, enclosing, kind);
  if (!ref || !ref.governs) {
    return null;
  }
  var base = ref.governs[kind] || null;
  if (!base || state !== 'kept' || !base.whenKept) {
    return base;
  }
  return {
    mode: base.whenKept.mode || base.mode,
    action: base.whenKept.action,
    why: base.whenKept.why || base.why
  };
}

/**
 * One row's target-disposition cell, with the quirk allow-list resolved
 * BEFORE the generic mandate is composed.
 *
 * The ordering is what this function is for. Composing `generic + pointer`
 * puts a mandate first and a quirk note second, and for a site whose preserved
 * outcome requires the body NOT to return -- unsettled, or throwing -- those
 * two clauses contradict each other in one cell, with the mandate leading. So:
 *
 *   no governing action  -- emit the mandate alone, so every row where it is
 *                           compatible is unaffected by this resolution;
 *   mode 'replace'       -- the mandate is not emitted at all; the governing
 *                           action takes its place and the row says which
 *                           mandate was displaced and why;
 *   mode 'qualify'       -- the mandate still governs the rest of the body and
 *                           is emitted after the governing action, which
 *                           carves out the one branch it must not reach.
 *
 * `lead` is the part of a generic action a preserved outcome never contradicts
 * -- a signature conversion, or where the `await` goes -- and it is kept in
 * front of the governing action rather than thrown away with the mandate.
 *
 * `state` is the row's current state, forwarded to governingAction() so that a
 * quirk whose action presumes a conversion states its OUTCOME instead on a row
 * where there is no conversion left to perform. Without it a row can carry a
 * lead that preserves the current shape and a governing action that instructs
 * replacing it -- two opposite instructions in one cell, which is exactly the
 * failure this function exists to prevent, arriving from the other direction.
 *
 * The `Owned by ... reproduce it, do not fix it.` tail is emitted on every
 * governed row, in the same words quirkRef() uses: it is the sentence that
 * makes the row's authority explicit, and a governed row needs it more than an
 * ungoverned one, not less.
 */
function composeTarget(spec) {
  var trailing = spec.trailing || '';
  var governing = governingAction(spec.file, spec.enclosing, spec.kind, spec.state);
  if (!governing) {
    return spec.generic + trailing + quirkRef(spec.file, spec.enclosing, spec.kind);
  }

  var ref = quirkEntry(spec.file, spec.enclosing, spec.kind);
  var label = GENERIC_MANDATE_LABELS[spec.kind] || 'generic mandate';
  var qualifies = governing.mode === 'qualify';
  // A qualified row emits the mandate in full further down, so leading with a
  // paraphrase of it would say the same thing twice.
  var head = (spec.lead && !qualifies ? spec.lead + ' ' : '') +
    'PRESERVED QUIRK, GOVERNING ACTION -- ' + governing.action + '.';

  var displaced;
  if (qualifies) {
    displaced = ' That QUALIFIES the generic ' + label + ' rather than displacing it. The ' +
      'mandate still governs every OTHER path in this body: ' + spec.generic +
      ' The carve-out exists because ' + governing.why + '.';
  } else {
    displaced = ' That REPLACES the generic ' + label + ', which is wrong here: ' +
      governing.why + '.';
  }

  return head + displaced + ' Measured outcome: ' + ref.note + '.' + trailing +
    ' Owned by `' + QUIRK_DOC + '` \u00a7' + ref.section + '; reproduce it, do not fix it.';
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
//   comments FIRST, because lib/controllers/trinket.js holds a pair of
//   backticks inside a `//` comment, which a template-literal-first scan would
//   read as a template spanning that comment;
//
//   then quotes, handling backslash escapes;
//
//   then regex literals, which is where config/routes.js and
//   config/api_routes.js bite: their password schema's character class holds a
//   single quote, a double quote and a backtick simultaneously. That backtick
//   is UNPAIRED in both files, so mis-tokenizing the regex blanks the rest of
//   the file -- most of config/routes.js.
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
 * mode the config/routes.js regex and the backtick pair inside a
 * lib/controllers/trinket.js comment both provoke -- swallows or exposes large
 * spans of code and the counts go wildly unbalanced. Balanced delimiters are
 * not a proof of correctness, but no desync this repository can produce
 * survives the check.
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
 * says "1 chains" reads as assembled rather than written, which undercuts a
 * document whose claim is that every figure in it was measured.
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
 * Looking only at the immediately preceding token is not enough, and this is
 * the measurement it costs most to get wrong: `reliesOnInterception` is the
 * document's central column, and a false positive sends someone chasing a
 * handler that was already correct.
 *
 * The case that proves it is this ternary in `lib/controllers/trinket.js`:
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

// ---------------------------------------------------------------------------
// SECTION 5b -- STATEMENT STRUCTURE, COMPLETION ANALYSIS AND LEXICAL OWNERSHIP
//
// Three questions decide whether a lifecycle method is converted, and none of
// them can be answered by looking at a call site in isolation:
//
//   1. Does every reachable path leave the function by `return` or `throw`?
//      A body that falls off the end returns `undefined`, which the toolkit
//      turns into Boom.badImplementation once the shim is gone. An EMPTY
//      `async (request, h)` satisfies every signature check and every
//      "no unreturned signalling call" count, and it is broken -- so closure
//      has to rest on a proof of exit, not on the absence of a counter-example.
//
//   2. Which function does a signalling call belong to? `resolve(request.fail(err))`
//      inside `return await new Promise(function (resolve) { ... })` is not an
//      unreturned call in the handler: it belongs to the executor, and its
//      value settles the promise the handler returns. Counting it against the
//      handler yields false "relies on the interception" flags, which
//      lib/controllers/users.js and lib/controllers/admin.js both provoke.
//
//   3. If it belongs to a nested function, does its value still reach hapi?
//      A value returned from a `.then()` handler on a chain the handler
//      returns does; the same value dropped inside a fire-and-forget callback
//      does not, and that difference is what the column records.
//
// The statement reader below is what makes 1 and 3 answerable: it gives the
// analysed function's own statement tree, treating any nested function literal
// as an opaque part of the expression that contains it. It is deliberately
// CONSERVATIVE -- a construct it cannot prove exits is reported as not
// exiting, which leaves a row open for a human rather than closing it on a
// guess. Direction matters here: a false "open" costs a reader one look, a
// false "closed" costs the migration a 500 in production.
// ---------------------------------------------------------------------------

/** Index of the first non-whitespace character at or after `from`, bounded. */
function skipWhitespace(scrubbed, from, to) {
  var i = from;
  while (i < to && /\s/.test(scrubbed[i])) {
    i++;
  }
  return i;
}

/** The identifier starting at `from`, with the offset just past it. */
function readWord(scrubbed, from) {
  var i = from;
  while (i < scrubbed.length && /[A-Za-z0-9_$]/.test(scrubbed[i])) {
    i++;
  }
  return { word: scrubbed.slice(from, i), end: i };
}

// Characters that can CONTINUE an expression after a closing brace, so a `}`
// followed by one of them does not end a statement: `.then(`, `)`, `,`, an
// operator. Anything else after a brace group that has closed back to depth
// zero is a new statement by automatic semicolon insertion.
var CONTINUES_AFTER_BRACE = /[.,;)\]([+\-*/%?:=<>&|^`]/;

// Keywords that can only begin a statement. A newline followed by one of them,
// at depth zero, ends the statement before it even without a semicolon.
var STATEMENT_HEAD = /^(?:return|throw|if|for|while|do|try|switch|var|let|const|function|async|break|continue|case|default|delete)(?![A-Za-z0-9_$])/;

/**
 * End of a simple statement.
 *
 * A `;` at nesting depth zero ends it, and so do the two automatic-semicolon
 * cases this codebase actually contains, each of which otherwise swallows
 * statements whole:
 *
 *   1. `var mkLessonDirs = function () { ... }` with NO trailing semicolon, in
 *      `lib/controllers/courses.js`. Scanning on to the next `;` absorbs the
 *      rest of the enclosing body, including the handler's own
 *      `return fs.promises.mkdir(...)`, and the row then reads "no proven
 *      exit" for a body that exits on both branches.
 *   2. A newline followed by a statement keyword.
 *
 * Nested function literals passed as arguments sit inside parentheses, so
 * their braces are never at depth zero and never end a statement early.
 */
function endOfSimpleStatement(scrubbed, from, to) {
  var depth = 0;
  var i = from;
  while (i < to) {
    var c = scrubbed[i];
    if (c === '(' || c === '[' || c === '{') {
      depth++;
    } else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) {
        return i;
      }
      depth--;
      if (c === '}' && depth === 0) {
        var afterBrace = skipWhitespace(scrubbed, i + 1, to);
        if (afterBrace >= to) {
          return i + 1;
        }
        if (scrubbed[afterBrace] === ';') {
          return afterBrace + 1;
        }
        if (!CONTINUES_AFTER_BRACE.test(scrubbed[afterBrace])) {
          return i + 1;
        }
      }
    } else if (c === ';' && depth === 0) {
      return i + 1;
    } else if (c === '\n' && depth === 0 && i > from) {
      var afterNewline = skipWhitespace(scrubbed, i + 1, to);
      if (afterNewline < to && STATEMENT_HEAD.test(scrubbed.slice(afterNewline, afterNewline + 10))) {
        return i + 1;
      }
    }
    i++;
  }
  return to;
}

/**
 * Read one statement starting at or after `from`, bounded by `to`.
 *
 * Recognized kinds: `exit` (return/throw), `block`, `if`, `try`, `switch`,
 * `loop`, `label` (a switch `case`/`default`), `empty` and `plain`. Anything
 * unrecognized becomes `plain`, which never proves an exit.
 */
function readStatement(scrubbed, from, to) {
  var i = skipWhitespace(scrubbed, from, to);
  if (i >= to) {
    return null;
  }

  var c = scrubbed[i];

  if (c === ';') {
    return { kind: 'empty', start: i, end: i + 1 };
  }

  if (c === '{') {
    var close = matchDelimiter(scrubbed, i);
    if (close === -1 || close > to) {
      return { kind: 'plain', start: i, end: to };
    }
    return {
      kind: 'block',
      start: i,
      end: close + 1,
      body: readStatementList(scrubbed, i + 1, close)
    };
  }

  if (!/[A-Za-z_$]/.test(c)) {
    return { kind: 'plain', start: i, end: endOfSimpleStatement(scrubbed, i, to) };
  }

  var w = readWord(scrubbed, i);

  if (w.word === 'return' || w.word === 'throw') {
    var exitEnd = endOfSimpleStatement(scrubbed, w.end, to);
    // The returned EXPRESSION is recorded, not just the fact of a `return`.
    // Control flow and lifecycle delivery are different questions: `return;`
    // leaves the function on every path and still hands hapi `undefined`,
    // which the toolkit converts into `Boom.badImplementation`. Only a
    // statement that carries a value can close a lifecycle row, so the text
    // has to survive this far. `exitDelivers` decides on it.
    var argument = scrubbed.slice(w.end, exitEnd + 1)
      .replace(/;\s*$/, '')
      .trim();
    return {
      kind: 'exit',
      start: i,
      end: exitEnd,
      exit: w.word,
      argument: argument
    };
  }

  // A function DECLARATION in statement position. It has to be recognized
  // explicitly, because a declaration carries no trailing semicolon: read as a
  // simple statement it swallows everything up to the next `;`, which in
  // `lib/controllers/courses.js`'s `download` absorbs the handler's own
  // `return fs.promises.mkdir(...)` into the declaration of the nested
  // `returnZip` and hides the exit, so the row reads "no proven exit" for a
  // body that exits on both branches.
  if (w.word === 'function' || (w.word === 'async' &&
      readWord(scrubbed, skipWhitespace(scrubbed, w.end, to)).word === 'function')) {
    var declaration = readFunctionAt(scrubbed, i);
    if (declaration && declaration.bodyEnd < to) {
      var after = skipWhitespace(scrubbed, declaration.bodyEnd + 1, to);
      return {
        kind: 'declaration',
        start: i,
        end: scrubbed[after] === ';' ? after + 1 : declaration.bodyEnd + 1
      };
    }
  }

  if (w.word === 'case' || w.word === 'default') {
    // A switch clause label. The clause's statements are read as siblings, so
    // the label itself only has to end at its colon.
    var colon = scrubbed.indexOf(':', w.end);
    return {
      kind: 'label',
      label: w.word,
      start: i,
      end: colon === -1 || colon >= to ? to : colon + 1
    };
  }

  if (w.word === 'if') {
    var head = skipWhitespace(scrubbed, w.end, to);
    var headClose = scrubbed[head] === '(' ? matchDelimiter(scrubbed, head) : -1;
    if (headClose === -1 || headClose > to) {
      return { kind: 'plain', start: i, end: endOfSimpleStatement(scrubbed, i, to) };
    }
    var consequent = readStatement(scrubbed, headClose + 1, to);
    if (!consequent) {
      return { kind: 'plain', start: i, end: to };
    }
    var afterConsequent = skipWhitespace(scrubbed, consequent.end, to);
    var elseWord = readWord(scrubbed, afterConsequent);
    var alternate = null;
    var end = consequent.end;
    if (elseWord.word === 'else') {
      alternate = readStatement(scrubbed, elseWord.end, to);
      end = alternate ? alternate.end : elseWord.end;
    }
    return {
      kind: 'if',
      start: i,
      end: end,
      consequent: consequent,
      alternate: alternate
    };
  }

  if (w.word === 'try') {
    var tryBlock = readStatement(scrubbed, w.end, to);
    if (!tryBlock) {
      return { kind: 'plain', start: i, end: to };
    }
    var cursor = skipWhitespace(scrubbed, tryBlock.end, to);
    var catchBlock = null;
    var finallyBlock = null;
    var word = readWord(scrubbed, cursor);
    if (word.word === 'catch') {
      var catchHead = skipWhitespace(scrubbed, word.end, to);
      var catchHeadClose = scrubbed[catchHead] === '(' ? matchDelimiter(scrubbed, catchHead) : -1;
      var catchBodyFrom = catchHeadClose === -1 ? word.end : catchHeadClose + 1;
      catchBlock = readStatement(scrubbed, catchBodyFrom, to);
      cursor = skipWhitespace(scrubbed, catchBlock ? catchBlock.end : catchBodyFrom, to);
      word = readWord(scrubbed, cursor);
    }
    if (word.word === 'finally') {
      finallyBlock = readStatement(scrubbed, word.end, to);
      cursor = finallyBlock ? finallyBlock.end : word.end;
    }
    return {
      kind: 'try',
      start: i,
      end: cursor,
      block: tryBlock,
      handler: catchBlock,
      finalizer: finallyBlock
    };
  }

  if (w.word === 'switch') {
    var switchHead = skipWhitespace(scrubbed, w.end, to);
    var switchHeadClose = scrubbed[switchHead] === '(' ? matchDelimiter(scrubbed, switchHead) : -1;
    if (switchHeadClose === -1 || switchHeadClose > to) {
      return { kind: 'plain', start: i, end: endOfSimpleStatement(scrubbed, i, to) };
    }
    var bodyOpen = skipWhitespace(scrubbed, switchHeadClose + 1, to);
    var bodyClose = scrubbed[bodyOpen] === '{' ? matchDelimiter(scrubbed, bodyOpen) : -1;
    if (bodyClose === -1 || bodyClose > to) {
      return { kind: 'plain', start: i, end: endOfSimpleStatement(scrubbed, i, to) };
    }
    return {
      kind: 'switch',
      start: i,
      end: bodyClose + 1,
      body: readStatementList(scrubbed, bodyOpen + 1, bodyClose)
    };
  }

  if (w.word === 'for' || w.word === 'while') {
    var loopHead = skipWhitespace(scrubbed, w.end, to);
    var loopHeadClose = scrubbed[loopHead] === '(' ? matchDelimiter(scrubbed, loopHead) : -1;
    if (loopHeadClose === -1 || loopHeadClose > to) {
      return { kind: 'plain', start: i, end: endOfSimpleStatement(scrubbed, i, to) };
    }
    var loopBody = readStatement(scrubbed, loopHeadClose + 1, to);
    var testText = scrubbed.slice(loopHead + 1, loopHeadClose).replace(/\s+/g, '');
    return {
      kind: 'loop',
      start: i,
      end: loopBody ? loopBody.end : loopHeadClose + 1,
      unconditional: testText === '' || testText === ';;' || testText === 'true',
      body: loopBody
    };
  }

  if (w.word === 'do') {
    var doBody = readStatement(scrubbed, w.end, to);
    var after = endOfSimpleStatement(scrubbed, doBody ? doBody.end : w.end, to);
    return { kind: 'loop', start: i, end: after, unconditional: false, body: doBody };
  }

  return { kind: 'plain', start: i, end: endOfSimpleStatement(scrubbed, i, to) };
}

/** Every statement between `from` and `to`, in source order. */
function readStatementList(scrubbed, from, to) {
  var list = [];
  var cursor = from;
  var guard = 0;
  while (cursor < to && guard++ < 20000) {
    var statement = readStatement(scrubbed, cursor, to);
    if (!statement || statement.end <= cursor) {
      break;
    }
    list.push(statement);
    cursor = statement.end;
  }
  return list;
}

/** Does a `break` sit at depth zero of this statement's own text? */
function containsTopLevelBreak(scrubbed, statement) {
  if (!statement) {
    return false;
  }
  var text = scrubbed.slice(statement.start, statement.end);
  return /(?<![A-Za-z0-9_$])break(?![A-Za-z0-9_$])/.test(text);
}

/**
 * Whether a statement provably transfers control out of the function on every
 * path through it. Conservative by construction: an unrecognized construct
 * answers `false`.
 */
function statementAlwaysExits(scrubbed, statement) {
  if (!statement) {
    return false;
  }
  switch (statement.kind) {
    case 'exit':
      return true;
    case 'block':
      return statementListAlwaysExits(scrubbed, statement.body);
    case 'if':
      // Without an `else` the false branch falls through, so an `if` alone
      // never proves an exit however the true branch ends.
      return !!statement.alternate &&
        statementAlwaysExits(scrubbed, statement.consequent) &&
        statementAlwaysExits(scrubbed, statement.alternate);
    case 'try':
      if (statement.finalizer && statementAlwaysExits(scrubbed, statement.finalizer)) {
        return true;
      }
      if (statement.handler) {
        return statementAlwaysExits(scrubbed, statement.block) &&
          statementAlwaysExits(scrubbed, statement.handler);
      }
      // No catch: the block either exits or throws, and a throw leaves too.
      return statementAlwaysExits(scrubbed, statement.block);
    case 'switch':
      return switchAlwaysExits(scrubbed, statement);
    case 'loop':
      // Only an unconditional loop with no way out proves an exit.
      return !!statement.unconditional && !containsTopLevelBreak(scrubbed, statement.body);
    default:
      return false;
  }
}

/**
 * Callees whose return value is `undefined` by specification, so returning one
 * delivers nothing to hapi however the statement is written. Deliberately a
 * SHORT, certain list: the analysis is conservative, and a callee not named
 * here is assumed to produce a value rather than assumed not to. `console.*`
 * is what appears in this codebase's debug paths.
 */
var VOID_CALLEES = /^(?:console\s*\.\s*(?:log|info|warn|error|debug|trace|dir|table)|process\s*\.\s*(?:nextTick)|void)\b/;

/**
 * Whether one exit statement delivers a LIFECYCLE RESULT, as distinct from
 * merely transferring control out of the function.
 *
 * This distinction is what the document records. hapi converts an `undefined`
 * return into `Boom.badImplementation` -- the exact failure the migration
 * exists to remove -- so a handler whose every path ends in `return;` is not
 * converted, even though every path ends in `return`.
 * Rejected here:
 *
 *   * `return;`                     -- no value at all
 *   * `return undefined;`           -- the failing value, written out
 *   * `return void anything;`       -- `void` evaluates to `undefined`
 *   * `return console.log(...);`    -- a callee specified to return `undefined`
 *
 * A `throw` DOES deliver: hapi maps a thrown error onto a response, and the
 * three preserved error funnels depend on that. `return null` also delivers --
 * `null` is what a pre-handler with nothing to contribute returns, and it is
 * not `undefined`.
 */
function exitDelivers(statement) {
  if (!statement || statement.kind !== 'exit') {
    return false;
  }
  if (statement.exit === 'throw') {
    return true;
  }
  var argument = (statement.argument || '').trim();
  if (argument === '') {
    return false;
  }
  if (/^undefined$/.test(argument)) {
    return false;
  }
  return !VOID_CALLEES.test(argument);
}

/**
 * Whether a statement provably delivers a lifecycle result on every path.
 *
 * Structurally identical to `statementAlwaysExits` -- the same recognized
 * constructs, the same conservative default -- and different in exactly two
 * places, each of which the reviewer of a checklist would otherwise have to
 * take on trust:
 *
 *   * an `exit` leaf must satisfy `exitDelivers`, not merely be an exit;
 *   * an unconditional loop with no break proves an exit and delivers NOTHING.
 *     `while (true) {}` never falls off the end of the function and never
 *     produces a response either, so it cannot close a row.
 */
function statementAlwaysDelivers(scrubbed, statement) {
  if (!statement) {
    return false;
  }
  switch (statement.kind) {
    case 'exit':
      return exitDelivers(statement);
    case 'block':
      return statementListAlwaysDelivers(scrubbed, statement.body);
    case 'if':
      return !!statement.alternate &&
        statementAlwaysDelivers(scrubbed, statement.consequent) &&
        statementAlwaysDelivers(scrubbed, statement.alternate);
    case 'try':
      if (statement.finalizer && statementAlwaysDelivers(scrubbed, statement.finalizer)) {
        return true;
      }
      if (statement.handler) {
        return statementAlwaysDelivers(scrubbed, statement.block) &&
          statementAlwaysDelivers(scrubbed, statement.handler);
      }
      return statementAlwaysDelivers(scrubbed, statement.block);
    case 'switch':
      return switchAlwaysDelivers(scrubbed, statement);
    case 'loop':
      // A non-settling unconditional loop is where control flow and delivery
      // come apart most sharply, so it is rejected explicitly rather than by
      // falling through to the default.
      return false;
    default:
      return false;
  }
}

/** The delivery counterpart of `statementListAlwaysExits`. */
function statementListAlwaysDelivers(scrubbed, statements) {
  for (var i = 0; i < statements.length; i++) {
    if (statementAlwaysDelivers(scrubbed, statements[i])) {
      return true;
    }
  }
  return false;
}

/**
 * A switch exits when it has a `default` clause and every clause that carries
 * statements exits. A label with no statements of its own falls through into
 * the next clause, so it is not required to exit on its own account.
 */
function switchAlwaysExits(scrubbed, statement) {
  var hasDefault = false;
  var groups = [];
  var current = null;
  statement.body.forEach(function (item) {
    if (item.kind === 'label') {
      if (item.label === 'default') {
        hasDefault = true;
      }
      current = [];
      groups.push(current);
      return;
    }
    if (current) {
      current.push(item);
    }
  });
  if (!hasDefault || groups.length === 0) {
    return false;
  }
  return groups.every(function (group) {
    if (group.length === 0) {
      return true;
    }
    return statementListAlwaysExits(scrubbed, group);
  });
}

/**
 * The delivery counterpart of `switchAlwaysExits`: the same `default`-clause
 * and per-group requirements, with each group required to DELIVER rather than
 * merely to exit.
 */
function switchAlwaysDelivers(scrubbed, statement) {
  var hasDefault = false;
  var groups = [];
  var current = null;
  statement.body.forEach(function (item) {
    if (item.kind === 'label') {
      if (item.label === 'default') {
        hasDefault = true;
      }
      current = [];
      groups.push(current);
      return;
    }
    if (current) {
      current.push(item);
    }
  });
  if (!hasDefault || groups.length === 0) {
    return false;
  }
  return groups.every(function (group) {
    if (group.length === 0) {
      return true;
    }
    return statementListAlwaysDelivers(scrubbed, group);
  });
}

/**
 * A statement LIST exits when any statement in it exits: statements after an
 * exiting statement are unreachable.
 */
function statementListAlwaysExits(scrubbed, list) {
  return list.some(function (statement) {
    return statementAlwaysExits(scrubbed, statement);
  });
}

/**
 * The innermost statement of this tree containing `offset`. Nested function
 * literals are opaque -- the answer is the statement of the ANALYSED function
 * that holds the whole expression, which is what decides whether a value
 * produced inside that expression leaves the function.
 */
function innermostStatementContaining(scrubbed, list, offset) {
  var hit = null;
  list.forEach(function (statement) {
    if (offset < statement.start || offset >= statement.end) {
      return;
    }
    hit = statement;
    var children = [];
    if (statement.kind === 'block' || statement.kind === 'switch') {
      children = statement.body;
    } else if (statement.kind === 'if') {
      children = [statement.consequent, statement.alternate].filter(Boolean);
    } else if (statement.kind === 'try') {
      children = [statement.block, statement.handler, statement.finalizer].filter(Boolean);
    } else if (statement.kind === 'loop') {
      children = [statement.body].filter(Boolean);
    }
    if (children.length > 0) {
      var deeper = innermostStatementContaining(scrubbed, children, offset);
      if (deeper) {
        hit = deeper;
      }
    }
  });
  return hit;
}

/**
 * Every function literal nested inside `[from, to)`, innermost-resolvable.
 *
 * The `function` keyword covers the analysed source as it stands, but arrows
 * are collected too, because the conversion may introduce them and a missed
 * nested function silently mis-attributes the values produced inside it.
 */
function collectNestedFunctions(scrubbed, from, to) {
  var found = [];

  var keyword = /(?<![A-Za-z0-9_$])(?:async\s+)?function(?![A-Za-z0-9_$])/g;
  keyword.lastIndex = from;
  var m;
  while ((m = keyword.exec(scrubbed)) !== null && m.index < to) {
    var fn = readFunctionAt(scrubbed, m.index);
    if (fn && fn.bodyEnd <= to && m.index > from) {
      found.push(fn);
    }
  }

  var arrow = /=>/g;
  arrow.lastIndex = from;
  while ((m = arrow.exec(scrubbed)) !== null && m.index < to) {
    var back = m.index - 1;
    while (back >= from && /\s/.test(scrubbed[back])) {
      back--;
    }
    var start = -1;
    if (scrubbed[back] === ')') {
      start = matchDelimiterBackwards(scrubbed, back);
    } else if (/[A-Za-z0-9_$]/.test(scrubbed[back] || '')) {
      var k = back;
      while (k >= from && /[A-Za-z0-9_$]/.test(scrubbed[k])) {
        k--;
      }
      start = k + 1;
    }
    if (start < from) {
      continue;
    }
    var arrowFn = readArrowAt(scrubbed, start, m.index, to);
    if (arrowFn) {
      found.push(arrowFn);
    }
  }

  return found;
}

/**
 * A function record for an arrow whose parameter list starts at `start`.
 * Handles the parenthesized form through readFunctionAt and the
 * single-identifier form (`err => ...`) directly, since the shared reader
 * requires a parenthesis.
 */
function readArrowAt(scrubbed, start, arrowOffset, to) {
  if (scrubbed[start] === '(') {
    var viaReader = readFunctionAt(scrubbed, start);
    return viaReader && viaReader.bodyEnd <= to ? viaReader : null;
  }
  var bodyStart = skipWhitespace(scrubbed, arrowOffset + 2, to);
  if (bodyStart >= to) {
    return null;
  }
  var bodyEnd;
  var concise = scrubbed[bodyStart] !== '{';
  if (concise) {
    bodyEnd = endOfSimpleStatement(scrubbed, bodyStart, to);
  } else {
    bodyEnd = matchDelimiter(scrubbed, bodyStart);
    if (bodyEnd === -1 || bodyEnd > to) {
      return null;
    }
  }
  return {
    kind: 'arrow',
    isAsync: false,
    start: start,
    paramStart: start,
    paramEnd: arrowOffset,
    bodyStart: bodyStart,
    bodyEnd: bodyEnd,
    concise: concise
  };
}

/** The innermost collected function whose body contains `offset`, or null. */
function ownerOf(nested, offset) {
  var owner = null;
  nested.forEach(function (fn) {
    if (offset <= fn.bodyStart || offset > fn.bodyEnd) {
      return;
    }
    if (!owner || fn.bodyStart > owner.bodyStart) {
      owner = fn;
    }
  });
  return owner;
}

// Settlement callees: a value handed to one of these becomes the settled value
// of the promise the enclosing executor produced, so it is delivered rather
// than dropped. Restricted to the two promise settlement functions on purpose
// -- a value passed to an arbitrary callback is NOT a response reaching hapi.
var SETTLEMENT_CALLEE = /(?:^|\.)(?:resolve|reject)$/;

/** Is this offset the argument of a `resolve(...)` / `reject(...)` call? */
function isSettlementArgument(scrubbed, offset) {
  var i = offset - 1;
  while (i >= 0 && /\s/.test(scrubbed[i])) {
    i--;
  }
  if (scrubbed[i] !== '(') {
    return false;
  }
  var calleeStart = trimLeading(scrubbed, expressionStart(scrubbed, i), i);
  var callee = scrubbed.slice(calleeStart, i).replace(/\s+/g, '');
  return SETTLEMENT_CALLEE.test(callee);
}

/**
 * The plain identifier a call's value is assigned to, or null.
 *
 * `var response = request.success();` and `failResponse = request.fail({...})`
 * are both real delivery mechanisms in this codebase -- the response is built
 * at the point the callback-era code signalled it and returned from a later
 * branch -- so a capture is not a dropped value. It is only delivered if the
 * name is subsequently read in a position that leaves the function, which
 * `nameLeavesFunction` decides.
 */
function capturedInto(scrubbed, offset) {
  var i = offset - 1;
  while (i >= 0 && /\s/.test(scrubbed[i])) {
    i--;
  }
  // A single `=` and not a comparison or a compound operator.
  if (scrubbed[i] !== '=' || scrubbed[i + 1] === '=' ||
      /[=!<>+\-*/%&|^]/.test(scrubbed[i - 1] || '')) {
    return null;
  }
  i--;
  while (i >= 0 && /\s/.test(scrubbed[i])) {
    i--;
  }
  var end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(scrubbed[i])) {
    i--;
  }
  var name = scrubbed.slice(i + 1, end);
  // A member assignment (`req.x = ...`) is not a local capture this analysis
  // can follow, so it is reported as no capture at all.
  if (name === '' || scrubbed[i] === '.') {
    return null;
  }
  return name;
}

/**
 * Whether `name` is read somewhere inside this function in a position whose
 * value leaves it: a `return`/`throw` expression, or a promise settlement
 * argument, and in both cases under a statement of the analysed function that
 * itself exits.
 */
function nameLeavesFunction(scrubbed, fn, statements, name) {
  var pattern = new RegExp('(?<![A-Za-z0-9_$.])' + name + '(?![A-Za-z0-9_$])', 'g');
  pattern.lastIndex = fn.bodyStart;
  var m;
  while ((m = pattern.exec(scrubbed)) !== null && m.index < fn.bodyEnd) {
    if (!isInReturnPosition(scrubbed, m.index) && !isSettlementArgument(scrubbed, m.index)) {
      continue;
    }
    var statement = innermostStatementContaining(scrubbed, statements, m.index);
    if (statement && statement.kind === 'exit') {
      return true;
    }
  }
  return false;
}

/**
 * Whether a nested function occupies the argument slot of a PROMISE REACTION
 * -- `.then(fn)`, `.catch(fn)`, `.finally(fn)`, or the second argument of
 * `.then(onFulfilled, onRejected)`.
 *
 * This is what separates a nested value that reaches hapi from one that is
 * discarded, and the distinction is not cosmetic. In
 *
 *     return service.load(function (err, value) {
 *         return request.success(value);   // DISCARDED
 *     });
 *
 * the callback's return value goes to `service.load`, which drops it; the
 * lifecycle function returns whatever `load` returns. In
 *
 *     return promise.then(function (value) {
 *         return request.success(value);   // DELIVERED
 *     });
 *
 * the same text delivers, because a reaction's return value becomes the
 * chain's value. Asking only whether the enclosing STATEMENT exits cannot tell
 * the two apart, and closes a handler on a discarded callback return.
 *
 * The receiver is put through `isPromiseReaction`, so `request.catch({...})`
 * -- a data property in this codebase, not a rejection handler -- does not
 * qualify here either.
 */
function ownerIsPromiseReaction(scrubbed, owner) {
  if (!owner) {
    return false;
  }

  // Walk back from the nested function to the `(` of the call that receives
  // it, counting depth so a preceding argument's own parentheses or brackets
  // cannot be mistaken for it.
  var depth = 0;
  var i = owner.start - 1;
  var open = -1;
  while (i >= 0) {
    var c = scrubbed[i];
    if (c === ')' || c === ']' || c === '}') {
      depth++;
    } else if (c === '(') {
      if (depth === 0) {
        open = i;
        break;
      }
      depth--;
    } else if (c === '[' || c === '{') {
      if (depth === 0) {
        // An object or array literal encloses it -- not a call argument.
        return false;
      }
      depth--;
    }
    i--;
  }
  if (open === -1) {
    return false;
  }

  var before = skipWhitespaceBack(scrubbed, open - 1);
  if (before < 0 || !/[A-Za-z0-9_$]/.test(scrubbed[before])) {
    return false;
  }
  var word = readWordBack(scrubbed, before);
  if (!/^(?:then|catch|finally)$/.test(word.word)) {
    return false;
  }
  var dot = skipWhitespaceBack(scrubbed, word.start - 1);
  if (dot < 0 || scrubbed[dot] !== '.') {
    return false;
  }
  return isPromiseReaction(scrubbed, { dot: dot, open: open, close: matchingClose(scrubbed, open) });
}

/** Skip whitespace backwards from `i`, returning the first non-space index. */
function skipWhitespaceBack(scrubbed, i) {
  while (i >= 0 && /\s/.test(scrubbed[i])) {
    i--;
  }
  return i;
}

/** Read the identifier ending at `i` (inclusive), backwards. */
function readWordBack(scrubbed, i) {
  var end = i;
  while (i >= 0 && /[A-Za-z0-9_$]/.test(scrubbed[i])) {
    i--;
  }
  return { word: scrubbed.slice(i + 1, end + 1), start: i + 1 };
}

/** The index of the `)` matching the `(` at `open`, or the end of the text. */
function matchingClose(scrubbed, open) {
  var depth = 0;
  for (var i = open; i < scrubbed.length; i++) {
    if (scrubbed[i] === '(') {
      depth++;
    } else if (scrubbed[i] === ')') {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return scrubbed.length - 1;
}

/**
 * Static shape analysis for one hapi-invoked function.
 *
 * Three measurements, each answering one of the questions in this section's
 * header: whether every path exits, who owns each signalling call, and whether
 * a nested call's value still reaches hapi. It is an analysis of TEXT rather
 * than a proof over a control-flow graph, and the generated document says so;
 * within that limit it distinguishes a delivered value from a dropped one, and
 * an empty body never reads as converted.
 */
function analyseFunctionShape(scrubbed, fn) {
  var body = scrubbed.slice(fn.bodyStart, fn.bodyEnd + 1);
  var nested = collectNestedFunctions(scrubbed, fn.bodyStart, fn.bodyEnd);
  var statements = fn.concise
    ? [{
      kind: 'exit',
      start: fn.bodyStart,
      end: fn.bodyEnd,
      exit: 'return',
      // A concise arrow body IS the returned expression, so it is recorded
      // here as one -- which puts it through the same `exitDelivers` rule as
      // an explicit `return`, rather than exempting it.
      argument: scrubbed.slice(fn.bodyStart, fn.bodyEnd + 1).trim()
    }]
    : readStatementList(scrubbed, fn.bodyStart + 1, fn.bodyEnd);

  var signals = [];
  var re = new RegExp(SIGNAL_CALL.source, 'g');
  var m;
  while ((m = re.exec(body)) !== null) {
    var abs = fn.bodyStart + m.index;
    var owner = ownerOf(nested, abs);
    var localReturn = isInReturnPosition(scrubbed, abs);
    var settles = isSettlementArgument(scrubbed, abs);
    var containing = innermostStatementContaining(scrubbed, statements, abs);
    var underExit = !!containing && containing.kind === 'exit';
    var capture = capturedInto(scrubbed, abs);
    var captured = capture !== null &&
      nameLeavesFunction(scrubbed, fn, statements, capture);
    var delivery;

    if (captured) {
      delivery = 'captured-and-returned';
    } else if (!owner) {
      delivery = localReturn ? 'returned' : 'unreturned';
    } else if (!localReturn && !settles) {
      delivery = 'nested-dropped';
    } else if (settles) {
      // Settling a promise the lifecycle function returns delivers wherever
      // the settlement sits, because the returned promise carries the value
      // out regardless of the enclosing statement's own shape.
      delivery = underExit ? 'settles-returned-promise' : 'nested-dropped';
    } else if (underExit && ownerIsPromiseReaction(scrubbed, owner)) {
      delivery = 'returned-through-owner';
    } else {
      // Returned from a nested function that is NOT a reaction on the returned
      // chain: an ordinary callback, whose return value the caller discards.
      delivery = 'nested-dropped';
    }

    signals.push({
      offset: abs,
      text: m[0].replace(/\s*\($/, ''),
      owned: !owner,
      // Named `.returned` because several renderers read that field. Its
      // meaning: this call's value leaves the function.
      returned: delivery !== 'unreturned' && delivery !== 'nested-dropped',
      delivery: delivery
    });
  }

  function count(kind) {
    return signals.filter(function (s) {
      return s.delivery === kind;
    }).length;
  }

  var ownUnreturned = count('unreturned');
  var nestedDropped = count('nested-dropped');
  var alwaysExits = statementListAlwaysExits(scrubbed, statements);
  // Delivery is asked separately from control flow, because they answer
  // different questions and only one of them closes a row: see
  // `statementAlwaysDelivers`.
  var alwaysDelivers = statementListAlwaysDelivers(scrubbed, statements);

  return {
    signalCount: signals.length,
    signals: signals,
    ownSignals: signals.filter(function (s) {
      return s.owned;
    }).length,
    ownReturned: count('returned'),
    ownUnreturned: ownUnreturned,
    nestedDelivered: count('returned-through-owner') + count('settles-returned-promise'),
    nestedSettling: count('settles-returned-promise'),
    nestedDropped: nestedDropped,
    captured: count('captured-and-returned'),
    // "Signals whose value does not reach hapi", which is what every consumer
    // of this field means by it.
    unreturnedSignals: ownUnreturned + nestedDropped,
    // `reply` appearing at all means the fake reply is still being consumed.
    usesReply: signals.some(function (s) {
      return s.text === 'reply';
    }),
    hasReturnStatement: /(?<![A-Za-z0-9_$])return(?![A-Za-z0-9_$])/.test(body),
    alwaysExits: alwaysExits,
    alwaysDelivers: alwaysDelivers,
    statementCount: statements.length,
    // RELIANCE IS ABOUT THE MECHANISM BEING REMOVED, not about tidiness. The
    // interception is `if (result === undefined) { result = await
    // responsePromise; }`: it fires only when the body returns `undefined`. So
    // a body that delivers a lifecycle value on EVERY path cannot reach it,
    // whatever its discarded signalling calls do -- under the shim those calls
    // resolved a deferred whose value was then thrown away, exactly as they
    // now return a response that is thrown away. Reading reliance as
    // `unreturnedSignals > 0` alone reported `lib/controllers/trinket.js`'s
    // `updateMetrics` as relying on a mechanism it cannot reach, and attached
    // to it an instruction to make the discarded value the response -- which
    // would turn that branch's measured 500 into a 200, the change R-d
    // prohibits and the branch's own source comment refuses.
    //
    // `usesReply` keeps its place in the test. For a body that still consumes
    // the shim's fake `reply`, the value it returns may itself be the shim's
    // builder object, so "the interception cannot fire, therefore nothing
    // changes" does not hold and the older framing is the accurate one. Only a
    // body already off the shim earns the settled reading.
    reliesOnInterception: ownUnreturned + nestedDropped > 0 &&
      (!alwaysDelivers || signals.some(function (s) {
        return s.text === 'reply';
      }))
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
 * At the base commit the rule yields the per-file distribution recorded in
 * BASELINE_EXPORTS, which is the calibration that lets the export census
 * police the rest of the analysis.
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
 * extracted expression text begins with a comment.
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
 * Whether a `.then(` / `.catch(` / `.finally(` call is a PROMISE REACTION, or
 * merely a member call that shares the name.
 *
 * The name alone is not enough, and this repository proves it: after
 * conversion `lib/controllers/folders.js` calls `request.catch({ err : err,
 * message : ... })` in two places -- a preserved quirk in which the member does
 * not exist, so the call throws `TypeError` and the route catch-all answers
 * 500. Reading those as promise chains yields rows whose "current shape"
 * describes a chain that is not there and whose target disposition proposes
 * wrapping a bare reference that is an object literal.
 *
 * The structure that distinguishes them, applied to the call rather than to
 * the name:
 *
 *   - a receiver that is itself a CALL or an index (`...)`, `...]`) is a
 *     promise reaction -- `Model.find().then(...)`, `.then(...).catch(...)`;
 *   - a receiver that is a plain identifier or member path is one only when
 *     the argument is FUNCTION-SHAPED: a function literal, an arrow, or a bare
 *     reference such as `.catch(request.fail)`. That admits the
 *     promise-variable receivers in this tree (`promise.then(...)`,
 *     `trinketPromise.then(...)`, `usernameCheck.then(...)`,
 *     `addFolderSlugJob.then(...)`, `getUserFiles.then(...)`,
 *     `checkCurrent.then(...)`) and rejects an object-literal argument, which
 *     cannot be a reaction handler in any case.
 */
function isPromiseReaction(scrubbed, link) {
  var i = link.dot - 1;
  while (i >= 0 && /\s/.test(scrubbed[i])) {
    i--;
  }
  var receiverChar = scrubbed[i];
  if (receiverChar === ')' || receiverChar === ']') {
    return true;
  }
  if (!/[A-Za-z0-9_$]/.test(receiverChar || '')) {
    return false;
  }

  var argStart = skipWhitespace(scrubbed, link.open + 1, link.close);
  if (argStart >= link.close) {
    // `.then()` with no argument: a no-op reaction, but still a promise call
    // when the receiver is a plain binding -- nothing else accepts it.
    return true;
  }
  if (readFunctionAt(scrubbed, argStart) !== null) {
    return true;
  }
  // A bare reference -- `.catch(request.fail)`, `.catch(reply)` -- is the shape
  // whose return value is silently dropped, so it must stay in scope.
  var argText = scrubbed.slice(argStart, link.close).trim();
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\s*\.\s*[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(argText);
}

/**
 * `.then(` / `.catch(` / `.finally(` calls the structural test above REJECTS.
 *
 * Reported rather than silently dropped: a reader who greps for `.catch(` and
 * counts rows needs to see the difference accounted for, and these particular
 * sites are a documented preserved quirk rather than an analysis gap.
 */
function findNonReactionMemberCalls(scrubbed, lineIndex, original) {
  var found = [];
  offsetsOf(scrubbed, PROMISE_LINK).forEach(function (hit) {
    var open = scrubbed.indexOf('(', hit.index);
    var close = open === -1 ? -1 : matchDelimiter(scrubbed, open);
    if (open === -1 || close === -1) {
      return;
    }
    var link = {
      dot: hit.index,
      name: /then/.test(hit.match) ? 'then' : (/catch/.test(hit.match) ? 'catch' : 'finally'),
      open: open,
      close: close
    };
    if (isPromiseReaction(scrubbed, link)) {
      return;
    }
    var receiverStart = trimLeading(scrubbed, expressionStart(scrubbed, hit.index), hit.index);
    found.push({
      line: lineAt(lineIndex, hit.index),
      name: link.name,
      receiver: oneLine(original.slice(receiverStart, hit.index), 40),
      excerpt: oneLine(original.slice(receiverStart, Math.min(close + 1, receiverStart + 160)), 90)
    });
  });
  return found.sort(function (a, b) {
    return a.line - b.line;
  });
}

/**
 * Group `.then(` / `.catch(` / `.finally(` links into chains.
 *
 * Two links belong to the same chain when the second one's `.` is the first
 * non-whitespace character after the first one's closing paren. The chain's
 * disposition is then read once, at the head, because "returned or awaited
 * exactly once per path" is a property of the chain, not of each link.
 *
 * Every chain gets ONE row. The link totals recorded in BASELINE_THEN_CALLS
 * and BASELINE_CATCH_CALLS are reported as scale in the document but are
 * deliberately not the row count -- a row is a unit of work someone closes,
 * and closing a chain means fixing all of its links at once.
 */
// The two response-producing helpers the wrapper re-shapes to RETURN a toolkit
// response (AAP rule T-1). A bare reference to one of them in a reaction slot
// is therefore a reaction that produces a value, and the AAP names this exact
// shape as the trap to get right: "the bare `request.fail` reference must have
// its return value propagated".
var RESPONSE_HELPER_REFERENCE = /^request\s*\.\s*(success|fail)$/;

/**
 * What the terminal link's reaction produces.
 *
 * Two mechanisms, and reading only the first argument saw neither of the
 * second two forms that occur in this tree:
 *
 *   - a function literal in ANY argument slot. `.then(null, function (e) {
 *     return e; })` registers a rejection handler in the SECOND slot;
 *     `readFunctionAt` at the first argument returns null for it, so the
 *     measured `lib/controllers/users.js:103` and `lib/controllers/auth.js:199`
 *     chains were reported as having no reaction at all.
 *   - a bare reference to `request.success` / `request.fail`. Six chains in
 *     this tree end `.catch(request.fail)` or `.then(request.success)`, three
 *     of them with an in-source comment recording that the call shape is
 *     preserved verbatim. Since those helpers now RETURN the response, the
 *     reaction produces the chain's value.
 *
 * @returns {{delivers: boolean, kind: string, helper: (string|null)}}
 */
function terminalReactionOf(scrubbed, original, terminal, argIsFunction) {
  if (argIsFunction) {
    return { delivers: true, kind: 'function-literal', helper: null };
  }

  var argText = original.slice(terminal.open + 1, terminal.close).trim();
  var helper = RESPONSE_HELPER_REFERENCE.exec(argText.replace(/\s+/g, ''));
  if (helper) {
    return {
      delivers: true,
      kind: 'response-helper-reference',
      helper: 'request.' + helper[1]
    };
  }

  // A function literal in a later argument slot: scan the argument list at the
  // call's own depth so a nested call's arguments cannot be mistaken for it.
  var depth = 0;
  for (var i = terminal.open + 1; i < terminal.close; i++) {
    var ch = scrubbed[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (depth === 0 && ch === 'f' && readFunctionAt(scrubbed, i) !== null &&
        /(?:^|[^A-Za-z0-9_$])function$/.test(scrubbed.slice(Math.max(0, i - 1), i + 8))) {
      return { delivers: true, kind: 'function-literal-later-slot', helper: null };
    }
  }

  return { delivers: false, kind: 'no-reaction-value', helper: null };
}

/**
 * How a chain's value leaves the expression it sits in.
 *
 * `returned`/`awaited` were the only two mechanisms recognized, and the
 * measured tree uses five. The other three are not sloppiness: they are how
 * this codebase composes work.
 *
 *   settlement-argument  `resolve(chain)` inside a `new Promise` executor --
 *                        the chain's value becomes the settled value.
 *   argument             `promises.push(chain)` -- handed to a consumer, which
 *                        `Promise.all` then awaits.
 *   capture              `promise = chain` -- bound to a name that a later
 *                        `return promise.then(...)` delivers.
 *
 * A chain in none of these positions is in STATEMENT position: its value is
 * discarded. That is a defect only where the discarded value could have been
 * the response, which is decided by the carrier's own proof of delivery, not
 * here (see chainDisposition).
 *
 * @returns {{kind: string, detail: (string|null)}}
 */
function chainDeliveryOf(scrubbed, original, headStart) {
  var prefix = precedingToken(scrubbed, headStart);

  if (prefix === 'return') {
    return { kind: 'return', detail: null };
  }
  if (prefix === 'await') {
    return { kind: 'await', detail: null };
  }
  if (isSettlementArgument(scrubbed, headStart)) {
    return { kind: 'settlement-argument', detail: null };
  }

  var captured = capturedInto(scrubbed, headStart);
  if (captured) {
    return { kind: 'capture', detail: captured };
  }

  // An argument to some other call. The callee is recorded rather than
  // asserted to be an aggregate: `promises.push` and `resolve` are what the
  // tree uses, and a reader closing the row needs to see which one.
  var before = headStart - 1;
  while (before >= 0 && /\s/.test(scrubbed[before])) {
    before--;
  }
  if (scrubbed[before] !== '(' && scrubbed[before] !== ',') {
    return { kind: 'statement', detail: null };
  }

  var open = enclosingCallOpen(scrubbed, before);
  if (open === -1) {
    return { kind: 'argument', detail: null };
  }
  var calleeStart = trimLeading(scrubbed, expressionStart(scrubbed, open), open);
  var callee = oneLine(original.slice(calleeStart, open), 40);
  return { kind: 'argument', detail: callee === '' ? null : callee };
}

/**
 * The offset of the `(` that opens the call an offset sits inside, or -1.
 *
 * Walks back at balanced depth so a preceding argument that is itself a call
 * cannot be mistaken for the enclosing one. Needed for a chain in a later
 * argument slot, where the character before it is a comma rather than the
 * open paren.
 */
function enclosingCallOpen(scrubbed, from) {
  var depth = 0;
  for (var i = from; i >= 0; i--) {
    var ch = scrubbed[i];
    if (ch === ')' || ch === ']' || ch === '}') {
      depth++;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      if (depth === 0) {
        return ch === '(' ? i : -1;
      }
      depth--;
    }
  }
  return -1;
}

/**
 * Whether one of the chain's own reactions settles the promise its carrier
 * returns, by handing a value to `resolve(...)` / `reject(...)`.
 *
 * The same mechanism the handler analysis counts as `nestedSettling`, applied
 * to a chain: `lib/controllers/admin.js:357` and `lib/controllers/course.js:1840`
 * both sit in statement position inside a `new Promise` executor and deliver
 * through settlement, and reading them as discarded said the opposite of what
 * their in-source comments record.
 */
function chainSettlesInReaction(scrubbed, headStart, endOffset) {
  var re = /(?<![A-Za-z0-9_$.])(?:resolve|reject)\s*\(/g;
  re.lastIndex = headStart;
  var match = re.exec(scrubbed);
  return match !== null && match.index < endOffset;
}

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
  }).filter(function (link) {
    return isPromiseReaction(scrubbed, link);
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
    var reaction = terminalReactionOf(scrubbed, original, terminal, argIsFunction);
    var delivery = chainDeliveryOf(scrubbed, original, headStart);

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
      // Whether the TERMINAL LINK produces a value at all, and by which of the
      // two mechanisms this repository uses. `terminalIsFunction` alone answers
      // only the first-argument case and reported `.then(null, fn)` and
      // `.catch(request.fail)` as producing nothing -- see terminalReactionOf.
      terminalDelivers: reaction.delivers,
      terminalReactionKind: reaction.kind,
      terminalHelper: reaction.helper,
      // How the chain's own value or settlement leaves the expression.
      delivery: delivery.kind,
      deliveryDetail: delivery.detail,
      settlesInReaction: chainSettlesInReaction(scrubbed, headStart, terminal.close),
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

// Node-core callback APIs. Rule T-5 converts one of these to its promise
// equivalent when it sits inside the hapi-facing surface, and -- this is the
// part a warning-driven reading of the rule gets wrong -- REGARDLESS of
// whether it emits a deprecation warning: AAP 0.6.4 measured
// `util.promisify(fs.writeFile)`, callback `fs.stat` and `fs.unlink` as silent
// on Node 22 and converts them anyway. `rimraf` and `mkdirp` are here because
// the plan treats them as exactly that -- Node-core-style callbacks whose
// conversion to `fs.promises.rm` / `fs.promises.mkdir` is what removes the
// package.
var NODE_CORE_CALLBACK_CALLEE = /(?:^|\.)(?:fs|fsPromises)\s*\.\s*[A-Za-z]+$|^(?:rimraf|mkdirp)$|^(?:zlib|dns|child_process|childProcess)\s*\.\s*[A-Za-z]+$|^crypto\s*\.\s*(?:randomBytes|pbkdf2|scrypt|generateKeyPair|randomFill)$|^util\s*\.\s*promisify$/;

// Node-core, but NOT completion callbacks: these schedule work rather than
// report the outcome of it, so there is no promise equivalent that preserves
// what they do. `setTimeout` has a promisified form whose semantics differ,
// and `process.nextTick` has none at all. Converting one changes when the next
// tick of work runs, which is a timing change R-d prohibits -- so T-5 does not
// reach them and the row says which of the two Node-core categories it is in
// rather than leaving a reader to assume the mandate applies.
var NODE_SCHEDULING_CALLEE = /^(?:process\s*\.\s*nextTick|setTimeout|setImmediate|setInterval)$/;

/**
 * Node-style callback boundaries inside a controller.
 *
 * A boundary is a call that receives a function literal whose parameter list
 * is either the error-first convention (`err`/`error` first) or empty -- the
 * two shapes a completion callback takes -- where the callee is not a promise
 * link, an event registration or a synchronous iteration helper.
 *
 * Empty-parameter callbacks are deliberately included, because two conversion
 * sites are exactly that shape: `rimraf(dir, function() {})` and
 * `fs.unlink(file, function() {})`.
 *
 * What each row records is where the `await` goes: AT THE CALL SITE, inside the
 * converted lifecycle method. It is not pushed down into lib/util/file.js,
 * lib/util/store.js or lib/util/queues.js, which keep their callback interfaces,
 * because they are utilities a handler awaits rather than lifecycle methods
 * themselves.
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
    // the callee, and truncating first cuts the trailing `.then` off a long
    // chain, which lets promise links through as callback boundaries.
    var calleeFull = oneLine(original.slice(calleeStart, callOpen));
    var callee = oneLine(calleeFull, 60);
    if (calleeFull === '' || NON_CALLBACK_CALLEES.test(calleeFull) ||
        UNDERSCORE_CALLEE.test(calleeFull)) {
      continue;
    }
    // A promise constructor is not a callback boundary: `new Promise(function
    // () {})` produces a promise whose settlement is the point, whereas a
    // boundary is a call that takes a completion callback.
    //
    // Two tests, because either one alone misses. `expressionStart` walks back
    // over identifier characters, so for `new Promise(...)` it returns the
    // offset of `new` ITSELF -- `new` becomes part of the callee text and the
    // token before it is whatever precedes the expression (`return`, in
    // `lib/controllers/trinket.js`'s `return new Promise(function() {})`),
    // which the preceding-token test alone reads as a boundary. Testing the
    // callee text for a leading `new` closes that; the preceding-token test is
    // retained for the case where the walk stops before the keyword.
    if (precedingToken(scrubbed, calleeStart) === 'new' || /^new(?![A-Za-z0-9_$])/.test(calleeFull)) {
      continue;
    }

    var normalizedCallee = calleeFull.replace(/\s+/g, '');
    boundaries.push({
      line: lineAt(lineIndex, calleeStart),
      callee: callee,
      params: params,
      errorFirst: errorFirst,
      offset: calleeStart,
      endOffset: fn.bodyEnd,
      alreadyAwaited: precedingToken(scrubbed, calleeStart) === 'await',
      // Which side of rule T-5 this callee falls on -- the question that
      // decides whether the boundary must convert or is one the AAP keeps in
      // callback form. Measured on the callee text, not on the callback's
      // shape, because the mandate is about the API being called.
      nodeCore: NODE_CORE_CALLBACK_CALLEE.test(normalizedCallee),
      scheduling: NODE_SCHEDULING_CALLEE.test(normalizedCallee)
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
 * A crude pattern under-counts them, so the rule is stated here in full and
 * the result is cross-checked against BASELINE_STREAM_SITES.
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
 * What is deliberately EXCLUDED is what keeps the count to one row per place a
 * reader has to look: `.on('close')` / `.on('error')` lifecycle listeners are
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
// then show up as phantom "unrouted" exports. At the base commit a
// literal-only scan finds 145 bindings and reports 5 unrouted exports, where
// assembling the concatenation finds 148 and reports the correct 2.
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
 * array in a route-config module. There is exactly one at the base commit, on
 * `POST /api/users/login` in config/api_routes.js, and it is the single member
 * of its own category in the conversion set.
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
// In the response builder the shim's fake `reply` returns, these four methods
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
 * Named functions declared in a file, whatever their nesting depth.
 *
 * The exported handlers are found by findControllerExports; this covers the
 * module-scope declarations and function-valued bindings, which is what makes
 * a site inside `function downloadZip(request, h)` addressable by SYMBOL
 * rather than by "(module scope)". Anchoring on a symbol is the point: a line
 * number stops being an address the moment the file is edited, and the reply
 * chains this document tracks all moved between the base commit and the
 * delivered tree.
 */
function findNamedFunctions(scrubbed, lineIndex) {
  var found = [];
  var patterns = [
    // function NAME(...)
    /(?<![A-Za-z0-9_$.])(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g,
    // var NAME = function(...)  |  NAME = function(...)
    /(?<![A-Za-z0-9_$.])([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?function\s*[A-Za-z0-9_$]*\s*\(/g
  ];

  patterns.forEach(function (pattern) {
    var re = new RegExp(pattern.source, 'g');
    var m;
    while ((m = re.exec(scrubbed)) !== null) {
      var keyword = scrubbed.indexOf('function', m.index);
      var fn = readFunctionAt(scrubbed, keyword);
      if (!fn) {
        continue;
      }
      found.push({
        name: m[1],
        line: lineAt(lineIndex, m.index),
        endLine: lineAt(lineIndex, fn.bodyEnd),
        start: m.index,
        end: fn.bodyEnd
      });
    }
  });

  return found.sort(function (a, b) {
    return a.start - b.start;
  });
}

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
 * the shape in `lib/controllers/trinket.js`'s `create`, where `reply(err)` on
 * an error path relies entirely on the deferred.
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

  // The quirk allow-list is a contract with docs/preserved-quirks.md
  // Appendix A, and a contract that is not checked is a comment. These are
  // TIER 1 because they are properties of this generator's own tables: they
  // hold or fail identically on every tree, so a failure is always an encoding
  // fault and never conversion progress.
  invariant(
    ALLOW_LIST_COVERAGE.length === ALLOW_LIST_ROWS,
    'The quirk allow-list encodes ' + ALLOW_LIST_COVERAGE.length + ' of the ' +
      ALLOW_LIST_ROWS + ' rows in ' + QUIRK_DOC + ' Appendix A. A row added there without ' +
      'being added to ALLOW_LIST_COVERAGE would let a generic mandate contradict its own ' +
      'quirk record.'
  );
  ALLOW_LIST_COVERAGE.forEach(function (row) {
    var satisfactions = (row.governs || []).length + (row.anchored || []).length +
      (row.roster || []).length;
    invariant(
      satisfactions > 0,
      'Allow-list row "' + row.site + '" (' + QUIRK_DOC + ' \u00a7' + row.section +
        ') names no satisfaction, so nothing enforces its governing action.'
    );
    (row.governs || []).forEach(function (key) {
      var governing = governingAction(key.file, key.enclosing, key.kind);
      invariant(
        !!governing,
        'Allow-list row "' + row.site + '": QUIRK_REFS carries no governing action for ' +
          key.file + ' `' + key.enclosing + '` at row kind `' + key.kind + '`, so that row ' +
          'would be composed from the generic mandate that ' + QUIRK_DOC + ' \u00a7' +
          row.section + ' contradicts.'
      );
      invariant(
        ROW_KINDS.indexOf(key.kind) !== -1,
        'Allow-list row "' + row.site + '" names row kind `' + key.kind +
          '`, which is not one of [' + ROW_KINDS.join(', ') + '].'
      );
      if (governing) {
        invariant(
          !!governing.action && !!governing.why &&
            (governing.mode === 'replace' || governing.mode === 'qualify'),
          'Allow-list row "' + row.site + '" at row kind `' + key.kind + '` is incomplete: a ' +
            'governing action needs an `action`, a `why` and a `mode` of `replace` or ' +
            '`qualify`.'
        );
      }
    });
    (row.anchored || []).forEach(function (key) {
      invariant(
        ANCHORED_SITES.some(function (site) {
          return site.file === key.file && site.line === key.line;
        }),
        'Allow-list row "' + row.site + '": ANCHORED_SITES no longer carries ' + key.file +
          ':' + key.line + ', which is where that row\'s target action is stated per site.'
      );
    });
    (row.roster || []).forEach(function (key) {
      invariant(
        REPLY_CHAIN_ROSTER.some(function (entry) {
          return entry.file === key.file && entry.startLine === key.startLine;
        }),
        'Allow-list row "' + row.site + '": REPLY_CHAIN_ROSTER no longer carries ' + key.file +
          ':' + key.startLine + ', which is where that row\'s target action is stated per site.'
      );
    });
  });
  QUIRK_REFS.forEach(function (ref) {
    invariant(
      !!ref.note && !!ref.section,
      'QUIRK_REFS entry for ' + ref.file + ' `' + ref.enclosing +
        '` is missing its note or its section.'
    );
    (ref.kinds || []).forEach(function (kind) {
      invariant(
        ROW_KINDS.indexOf(kind) !== -1,
        'QUIRK_REFS entry for ' + ref.file + ' `' + ref.enclosing + '` scopes itself to row ' +
          'kind `' + kind + '`, which is not one of [' + ROW_KINDS.join(', ') + '].'
      );
    });
    Object.keys(ref.governs || {}).forEach(function (kind) {
      invariant(
        ROW_KINDS.indexOf(kind) !== -1,
        'QUIRK_REFS entry for ' + ref.file + ' `' + ref.enclosing + '` governs row kind `' +
          kind + '`, which is not one of [' + ROW_KINDS.join(', ') + '].'
      );
      invariant(
        !ref.kinds || ref.kinds.indexOf(kind) !== -1,
        'QUIRK_REFS entry for ' + ref.file + ' `' + ref.enclosing + '` governs row kind `' +
          kind + '` but scopes itself to [' + (ref.kinds || []).join(', ') + '], so the ' +
          'governing action would never be reached.'
      );
    });
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
  // The same arithmetic over the MEASURED model rather than over the
  // constants, because the document's headline sentence -- "the function rows
  // are exactly the 154" -- is a claim about the rows it emits. Counting the
  // two dead-301 branch sites as pre-handler functions makes that sentence
  // false by two while every constant still agrees with itself.
  var measuredFunctionRows = model.routedHandlers + model.routedPreHandlerNames.length +
    model.inlinePreHandlers.length;
  invariant(
    measuredFunctionRows === CONVERSION_SET.total,
    'Function rows emitted (routed handlers + routed pre-handlers + inline pre-handler): ' +
      measuredFunctionRows + ', expected ' + CONVERSION_SET.total + '. Sections 1, 2a and 3 ' +
      'are the conversion set, and a branch site counted among them would overstate it.'
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
    'Legacy `reply(`-rooted chains carrying .type()/.bytes(): derived ' + derived.length +
      ', roster has ' + REPLY_CHAIN_ROSTER.length + '. At the base commit the two must agree; ' +
      'on a converted tree a lower figure is the expected direction, since each converted ' +
      'chain leaves the legacy population.'
  );
  // The roster is anchored by SYMBOL, so the anchor itself is what gets
  // asserted at the base commit: every entry must be locatable by its carrier
  // and link sequence, and the chain found there must sit at the coordinates
  // the roster records. That is the check a mis-specified anchor fails. An
  // anchor on `file` + `startLine` instead reports "not found" the moment the
  // lines move, which a renderer reads as "converted".
  REPLY_CHAIN_ROSTER.forEach(function (entry) {
    var located = locateRosterEntry(model, entry);
    calibrated(
      !!located.legacy,
      'Reply chain ' + entry.file + ':' + entry.lines + ' (' + entry.category + ') has no ' +
        '`reply(`-rooted chain with links .' + entry.links.join('().') + '() at ordinal ' +
        (entry.ordinal || 1) + ' inside `' + entry.carrier + '`. At the base commit that is a ' +
        'fault -- a mis-specified anchor or a tokenizer fault. On a converted tree it is the ' +
        'expected state, and section 6 closes the row on its target shape and its corpus ' +
        'scenario instead.'
    );
    if (located.legacy) {
      calibrated(
        located.legacy.startLine === entry.startLine,
        'Reply chain ' + entry.file + ':' + entry.lines + ' was located by symbol inside `' +
          entry.carrier + '` but at line ' + located.legacy.startLine +
          ', not the recorded baseline line ' + entry.startLine + '.'
      );
      calibrated(
        located.legacy.category === entry.category,
        'Reply chain ' + entry.file + ':' + entry.lines + ' derived as ' +
          located.legacy.category + ' but the roster records ' + entry.category + '.'
      );
    }
    if (entry.scenario) {
      // A scenario id that does not exist would silently downgrade the row to
      // "unlinked", so it is checked wherever a corpus is present rather than
      // only at the base commit.
      if (model.evidence.available && !model.evidence.scenarios[entry.scenario]) {
        failures.push({
          tier: 1,
          message: 'Reply chain ' + entry.file + ':' + entry.lines + ' names corpus scenario `' +
            entry.scenario + '`, which does not exist in ' + CORPUS_PATH + '.'
        });
      }
    }
  });
  ANCHORED_SITES.forEach(function (site) {
    if (site.scenario && model.evidence.available && !model.evidence.scenarios[site.scenario]) {
      failures.push({
        tier: 1,
        message: 'Anchored site ' + site.file + ':' + site.line + ' names corpus scenario `' +
          site.scenario + '`, which does not exist in ' + CORPUS_PATH + '.'
      });
    }
  });
  calibrated(
    model.nonReactionMemberCalls.length === BASELINE_NON_REACTION_CATCHES,
    '`.then(`/`.catch(` member calls rejected as non-reactions: found ' +
      model.nonReactionMemberCalls.length + ', baseline ' + BASELINE_NON_REACTION_CATCHES +
      ' (the two `request.catch({ ... })` sites in lib/controllers/folders.js).'
  );
  ['never-settles', 'header-resolved', 'builder-returned'].forEach(function (cat) {
    var expected = REPLY_CHAIN_ROSTER.filter(function (e) {
      return e.category === cat;
    }).length;
    var got = derived.filter(function (c) {
      return c.category === cat;
    }).length;
    calibrated(
      expected === got,
      'Legacy `reply(`-rooted chains in category ' + cat + ': derived ' + got + ', roster has ' +
        expected + '. Asserted at the base commit; on a converted tree the derived figure ' +
        'falls as chains convert.'
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

  // --- TIER 1: THE COMPLETION ACCOUNTING ----------------------------------
  // Every closure figure the document prints comes from one census, and these
  // checks are what make that a fact rather than an intention. The defect they
  // exist to prevent is the one the row totals carried: two closure figures
  // computed by different routes, printed a few hundred lines apart, that did
  // not agree -- and a closed row in a population whose authority is a
  // measurement nobody took.
  // The section-4 policy prints one row per delivery mechanism and states that
  // they sum to the delivered total. That is an arithmetic claim, so it is
  // asserted here rather than left to a reader: a mechanism recognized by
  // chainDeliveryOf() and absent from CHAIN_DELIVERY_MECHANISMS would silently
  // fall into the reaction-settlement bucket and mislabel every row using it.
  var chainCensus = chainDeliveryCensus(model.promiseChains);
  var mechanismSum = CHAIN_DELIVERY_MECHANISMS.reduce(function (acc, key) {
    return acc + (chainCensus.byDelivery[key] || 0);
  }, 0);
  invariant(
    mechanismSum === chainCensus.delivered,
    'The section-4 delivery-mechanism table sums to ' + mechanismSum +
      ' but ' + chainCensus.delivered + ' chains are delivered. Every delivered chain must ' +
      'appear under exactly one mechanism, or the section states an arithmetic claim that ' +
      'does not hold.'
  );
  invariant(
    chainCensus.delivered + (chainCensus.byState['discarded-by-design'] || 0) +
      (chainCensus.byState['discarded-outside-lifecycle'] || 0) +
      (chainCensus.byState['discarded-in-unproven-carrier'] || 0) === model.promiseChains.length,
    'The section-4 disposition states do not partition the ' + model.promiseChains.length +
      ' chain rows. Delivered, deliberately discarded and open must cover the population ' +
      'exactly once each.'
  );

  var accounting = model.accounting;
  if (accounting) {
    invariant(
      accounting.populationRows === accounting.totalRows,
      'Population rows (' + accounting.populationRows + ') do not sum to the census total (' +
        accounting.totalRows + '). Every section must carry exactly one population, or the ' +
        'accounting describes a different set of rows from the table above it.'
    );
    invariant(
      accounting.populationClosed === accounting.totalClosed,
      'Population closures (' + accounting.populationClosed + ') do not sum to the census ' +
        'closure total (' + accounting.totalClosed + '). Both must be derived from one ' +
        'computed census.'
    );
    invariant(
      accounting.measuredClosed === 0 || model.evidence.recorded > 0,
      accounting.measuredClosed + ' row(s) whose target is a MEASUREMENT are closed while ' +
        'the corpus records ' + model.evidence.recorded + ' scenarios with a confirming ' +
        'replay verdict. Such a row cannot be closed by reading the tree: the source does ' +
        'not say what the measurement was.'
    );

    // PER ROW, against its OWN scenario. Not a count against a count: one
    // confirmed scenario legitimately closes every row pinned to it, so
    // comparing the closed-row total to the confirmed-scenario total rejects
    // valid partial evidence. See measuredRowLedger().
    var ledger = measuredRowLedger(model);
    var closedRows = ledger.filter(function (row) {
      return row.closed;
    });
    closedRows.forEach(function (row) {
      invariant(
        Boolean(row.scenario) && row.evidenceState === EVIDENCE.RECORDED,
        'Section ' + row.section + ' row ' + row.label + ' is closed, but its linked ' +
          'scenario ' + (row.scenario ? '`' + row.scenario + '` is in state ' +
            row.evidenceState : 'is absent') + '. A measurement-gated row closes only on a ' +
          'confirming replay verdict for the scenario that drives IT.'
      );
    });
    invariant(
      accounting.measuredClosed === closedRows.length,
      'The accounting reports ' + accounting.measuredClosed + ' closed measurement-gated ' +
        'rows and the per-row ledger finds ' + closedRows.length +
        '. Both enumerate the same populations, so a difference means one of them is ' +
        'counting a row the other does not.'
    );

    // The distinct scenarios backing those rows cannot outnumber the confirmed
    // scenarios in the corpus. This is the aggregate form that DOES hold,
    // because it compares scenario identities rather than row counts.
    var backing = Object.create(null);
    closedRows.forEach(function (row) {
      backing[row.scenario] = true;
    });
    invariant(
      Object.keys(backing).length <= model.evidence.recorded,
      Object.keys(backing).length + ' distinct scenarios back the closed ' +
        'measurement-gated rows while only ' + model.evidence.recorded +
        ' carry a confirming replay verdict.'
    );
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

/**
 * `git status --porcelain` restricted to a set of paths, or null when the
 * directory is not a git worktree.
 *
 * Scoped to the paths that were actually READ, which is the only cleanliness
 * question this document can answer: a commit identifies the analysed bytes
 * exactly when the analysed files match that commit. Whether unrelated
 * files in the tree are dirty says nothing about the analysis -- and this
 * document is itself one of them, so a whole-tree check would report dirt the
 * moment the document is written.
 */
function gitDirtyPaths(cwd, relPaths) {
  try {
    var out = childProcess.execFileSync('git',
      ['status', '--porcelain', '--'].concat(relPaths), {
        cwd: cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20000
      });
    return out.split('\n').map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line !== '';
    }).map(function (line) {
      return line.replace(/^\S+\s+/, '');
    });
  } catch (err) {
    return null;
  }
}

/** The commit that last touched a path, or null. */
function gitLastCommitFor(cwd, relPath) {
  try {
    var out = childProcess.execFileSync('git',
      ['log', '-1', '--format=%H', '--', relPath], {
        cwd: cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 20000
      });
    return out.trim() || null;
  } catch (err) {
    return null;
  }
}

/** SHA-256 of a string, as `sha256:<hex>`. */
function digestOf(text) {
  return 'sha256:' + crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * A digest over the exact set of files the analysis read, path and content,
 * in sorted order.
 *
 * This is the provenance claim that does not depend on commit identity at
 * all. A commit hash answers "which revision was analysed" only while the
 * working tree matches it, and it is useless to a reader when the hash names
 * an object their clone does not contain -- a revision recorded from a
 * throwaway worktree, for instance. A content digest is checkable from the
 * files themselves, by anyone, with no repository at all.
 */
function analysedSourceDigest(files) {
  var parts = files.slice().sort(function (a, b) {
    return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0);
  }).map(function (f) {
    return f.path + '\u0000' + f.original.length + '\u0000' + f.original;
  });
  return digestOf(parts.join('\u0001'));
}

// ---------------------------------------------------------------------------
// SECTION 11b -- PARITY EVIDENCE
//
// Two of this document's row kinds cannot be closed by reading the tree, and
// pretending otherwise is the failure this section exists to prevent.
//
// A reply chain's outcome depended on which builder method ran LAST, and a
// stream site's correctness is whether completion and error TIMING survived.
// Neither is a property of the text: the legacy syntax disappearing proves
// only that the syntax disappeared. What decides them is the captured
// baseline response and the replayed target response -- so a row of either
// kind carries the identifier of the scenario that drives it, and closes only
// when that scenario actually holds a recorded baseline.
//
// The evidence is read from test/parity/corpus.json, which is DATA. Nothing
// here executes the harness, starts a server or needs a database, and a tree
// without a corpus (the base commit, for instance) is reported as having no
// evidence rather than failing -- at the base commit nothing is converted, so
// there is nothing for the evidence to be evidence of.
// ---------------------------------------------------------------------------

var CORPUS_PATH = 'test/parity/corpus.json';

var EVIDENCE = {
  // Both halves present: a captured baseline response AND a replay result for
  // the target. This is the ONLY state that closes a behavioural row.
  RECORDED: 'recorded',
  // The baseline is captured and the target has not been replayed. Kept
  // separate from PENDING because the two are different distances from
  // closure and a reader is entitled to know which one a row is at -- and
  // separate from RECORDED because a baseline alone says what the OLD code
  // did, which is not a comparison. Closing on it re-creates, in the checklist,
  // exactly the "syntax disappeared, therefore done" reasoning this gate exists
  // to prevent.
  BASELINE_ONLY: 'baseline-captured-not-replayed',
  PENDING: 'defined-not-captured',
  // A scenario covers the ROUTE this site is reached from, but nothing pins
  // it to this site's branch. Reported as a candidate; cannot close a row.
  INDIRECT: 'route-level-only',
  UNLINKED: 'unlinked',
  NO_CORPUS: 'no-corpus'
};

/**
 * BRANCH-EXACT scenario resolution for stream sites.
 *
 * A stream site's row claims that one specific stream's completion and error
 * TIMING is preserved. Resolving the site's carrier to the routes that reach
 * it and then taking every scenario covering those routes does not establish
 * that: `files.download` reaches three stream sites across two MUTUALLY
 * EXCLUSIVE branches -- the inline image response and the attachment response
 * -- so a captured result for the image branch is silent about the attachment
 * branch, and propagating it to both closes a row that nothing exercised.
 *
 * The branch is derived from the reply chains this document already anchors
 * STRUCTURALLY, rather than from a table of line numbers or a text match on
 * the site's own line. Each roster entry names the scenario that drives it and
 * is located in the analysed tree by carrier and link sequence; a stream site
 * whose line falls inside a located chain's span is on that chain's branch and
 * inherits its scenario. That keeps the pin correct as lines move, and it
 * reports the sites it CANNOT place: in `lib/controllers/files.js`'s `download`
 * the stream is constructed by `FileUtil.downloadMaterialFile(remoteFile)`
 * before the image/attachment branch splits, so no branch-exact scenario exists
 * for that site and its state is `EVIDENCE.INDIRECT` -- candidates reported,
 * row held open.
 */
function pinStreamScenario(model, site) {
  var best = null;

  REPLY_CHAIN_ROSTER.forEach(function (entry) {
    if (entry.file !== site.file || !entry.scenario) {
      return;
    }
    var located = locateRosterEntry(model, entry);
    // The TARGET chain is the one present in a converted tree; the legacy
    // chain is the one present before conversion. Either locates the branch,
    // so whichever is found is used.
    [located.target, located.legacy].forEach(function (chain) {
      if (!chain) {
        return;
      }
      if (site.line < chain.startLine || site.line > chain.endLine) {
        return;
      }
      var span = chain.endLine - chain.startLine;
      // The tightest containing span wins, so a site inside a short branch
      // chain is not attributed to a longer chain that also encloses it.
      if (!best || span < best.span) {
        best = {
          scenario: entry.scenario,
          span: span,
          branch: entry.carrier + ' ' + chain.startLine + '-' + chain.endLine,
          category: entry.category || null,
          basis: 'the site sits inside the located chain'
        };
      }
    });
  });

  if (best) {
    return best;
  }

  // SOLE-BRANCH PIN. A site that sits in a carrier holding exactly ONE located
  // reply chain is on that chain's branch, because there is no other branch in
  // that carrier to be on. This is the case the containment test alone cannot
  // reach: `downloadZip` builds its archive and its read stream BEFORE the
  // response expression, so four of its five sites fall outside the chain's
  // span while being unambiguously on the same path through the function.
  //
  // The condition is exactly one chain, and that is the whole safeguard.
  // `files.download` holds TWO -- the inline-image branch and the attachment
  // branch, which are mutually exclusive -- so a result for one is silent
  // about the other and no pin is derived there. The basis is recorded on the
  // pin so a reader checks the reasoning rather than taking the scenario id.
  var carrierName = site.carrier ? site.carrier.name : null;
  if (!carrierName) {
    return null;
  }

  // The branch count is the number of ROSTER ENTRIES in the carrier, not the
  // number this run managed to locate in the text. That distinction is the
  // safeguard, and getting it wrong is not hypothetical: `files.download`
  // carries two entries -- the never-settling inline-image branch and the
  // header-resolved attachment branch -- and only the second is locatable in
  // the converted tree, so counting located chains found "exactly one" and
  // pinned a site to a branch it may not be on. Counting declared entries
  // refuses the pin, which is the correct answer for a carrier with two
  // mutually exclusive branches.
  var entriesInCarrier = REPLY_CHAIN_ROSTER.filter(function (entry) {
    return entry.file === site.file && entry.carrier === carrierName;
  });
  if (entriesInCarrier.length !== 1 || !entriesInCarrier[0].scenario) {
    return null;
  }

  var inCarrier = [];
  entriesInCarrier.forEach(function (entry) {
    var located = locateRosterEntry(model, entry);
    var chain = located.target || located.legacy;
    if (chain) {
      inCarrier.push({ entry: entry, chain: chain });
    }
  });

  if (inCarrier.length !== 1) {
    return null;
  }

  return {
    scenario: inCarrier[0].entry.scenario,
    span: inCarrier[0].chain.endLine - inCarrier[0].chain.startLine,
    branch: carrierName + ' ' + inCarrier[0].chain.startLine + '-' +
      inCarrier[0].chain.endLine,
    category: inCarrier[0].entry.category || null,
    basis: 'the site is outside the located chain\'s span, but `' + carrierName +
      '` DECLARES exactly one reply chain, so there is no other branch in it for the site ' +
      'to be on'
  };
}

/**
 * Load the request corpus as evidence, indexed for the two joins this
 * document needs: by scenario id (a reply chain names its scenario) and by
 * route (a stream site resolves to routes, and the corpus records which
 * routes each scenario covers).
 */
function loadEvidence(appRoot) {
  var abs = path.join(appRoot, CORPUS_PATH);
  var raw;
  try {
    raw = fs.readFileSync(abs, 'utf8');
  } catch (err) {
    return {
      available: false,
      reason: CORPUS_PATH + ' is not present in the analysed tree',
      captured: false,
      scenarios: Object.create(null),
      byRoute: Object.create(null),
      total: 0,
      pending: 0,
      recorded: 0
    };
  }

  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    // A corpus that does not parse is not "no evidence" -- it is a broken
    // artifact, and continuing would silently downgrade every evidence-gated
    // row to "pending" for the wrong reason.
    throw usageError('Cannot parse ' + CORPUS_PATH + ' under ' + appRoot + ': ' + err.message);
  }

  var summary = parsed.summary || {};
  var scenarios = Object.create(null);
  var byRoute = Object.create(null);

  (parsed.scenarios || []).forEach(function (scenario) {
    var route = scenario.route
      ? scenario.route.method + ' ' + scenario.route.path
      : null;
    var entry = {
      id: scenario.id,
      group: scenario.group || null,
      route: route,
      intent: scenario.intent || null,
      covers: Array.isArray(scenario.covers) ? scenario.covers.slice() : [],
      hasBaseline: scenario.baseline !== null && scenario.baseline !== undefined,
      approvedDeviation: !!scenario.expectedDeviation,
      replayDisposition: scenario.expectedDeviation
        ? scenario.expectedDeviation.replayDisposition || null
        : null,
      // THE REPLAY HALF. A captured baseline records what the pre-migration
      // code did; only a replay against the migrated tree says whether the
      // target matches it -- or, for the approved deviation, whether the
      // declared change is what actually happened. `test/parity/replay.js`
      // produces this; the field names below are the ones it may write, and
      // absence is reported as absence rather than assumed to be a pass.
      replay: readReplayResult(scenario)
    };
    scenarios[entry.id] = entry;
    entry.covers.forEach(function (covered) {
      if (!byRoute[covered]) {
        byRoute[covered] = [];
      }
      byRoute[covered].push(entry.id);
    });
    if (route && entry.covers.indexOf(route) === -1) {
      if (!byRoute[route]) {
        byRoute[route] = [];
      }
      byRoute[route].push(entry.id);
    }
  });

  Object.keys(byRoute).forEach(function (key) {
    byRoute[key].sort();
  });

  var ids = Object.keys(scenarios);
  return {
    available: true,
    reason: null,
    captured: summary.captured === true,
    scenarios: scenarios,
    byRoute: byRoute,
    total: ids.length,
    pending: typeof summary.baselinesPending === 'number'
      ? summary.baselinesPending
      : ids.filter(function (id) {
        return !scenarios[id].hasBaseline;
      }).length,
    // Scenarios carrying BOTH halves of a comparison. Counted here rather than
    // derived at each call site, because it is the figure the one
    // runtime-evidence predicate answers from and the figure the document
    // reports: a corpus can be fully captured and still prove nothing about
    // this tree, which is exactly the state a `summary.captured` reading
    // mistook for evidence.
    recorded: ids.filter(function (id) {
      var scenario = scenarios[id];
      return scenario.hasBaseline && scenario.replay && scenario.replay.confirmed;
    }).length
  };
}

/**
 * The replay result recorded on one scenario, or `null` when none is.
 *
 * The reader accepts the shapes a replay result written by
 * `test/parity/replay.js` can reasonably take, rather than one field name, and
 * treats anything it does not recognize as ABSENT. Recognizing a result
 * requires an explicit verdict: a bare `replay: {}` is not a pass.
 */
function readReplayResult(scenario) {
  var raw = scenario.replay || scenario.target || scenario.replayResult || null;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  var verdict = raw.verdict || raw.status || raw.outcome || raw.disposition || null;
  if (typeof verdict !== 'string' || verdict === '') {
    return null;
  }
  var normalized = verdict.toLowerCase();
  return {
    verdict: verdict,
    // A row closes on a replay that MATCHED the baseline, or -- for the
    // approved deviation -- on one that confirmed the declared change. Any
    // other verdict (a difference, an error, a skip) leaves the row open,
    // which is the point of reading the verdict rather than its presence.
    confirmed: normalized === 'match' || normalized === 'matched' ||
      normalized === 'identical' || normalized === 'pass' ||
      normalized === 'approved-change' || normalized === 'approved' ||
      normalized === 'approved-deviation',
    approvedChange: normalized === 'approved-change' || normalized === 'approved' ||
      normalized === 'approved-deviation'
  };
}

// Where a replay artifact keeps its per-scenario verdicts, and what a verdict
// is called there. Read from test/parity/replay.js's own writer
// (`summarizePass`, whose `scenarioResults` carries one record per scenario
// with a `status` drawn from its STATUS_* constants) rather than guessed, so
// the join is against the shape that tool actually emits.
var REPLAY_ARTIFACT_TOOL = 'test/parity/replay.js';

/**
 * Reads the artifact `test/parity/replay.js --out` writes, and returns its
 * per-scenario verdicts.
 *
 * WHY THIS EXISTS. The verdicts a measurement-gated row needs are produced by
 * replay.js and written to ITS OWN artifact. Nothing in this repository writes
 * a verdict back into `test/parity/corpus.json`: `--annotations` is an INPUT to
 * replay.js (it joins `expectedDeviation` and `unreachableReason` by id), and
 * capture.js is the only writer of the corpus. This generator read verdicts
 * only off the corpus scenario objects, so the two halves of the workflow could
 * not meet and no amount of replaying would have closed a single row. That was
 * not a policy decision, it was a missing join, and it is the reason the 28
 * measurement-gated rows could not close from evidence that had been produced.
 *
 * WHAT IT REFUSES. A replay run labelled `gateQualifying: false` by its own
 * producer -- a narrowed `--only` run, a single pass, a corpus replayed under
 * `--allow-unreviewed-corpus` -- cannot stand as the gate, and replay.js says
 * so in the artifact. Its verdicts are read and REPORTED but do not close a
 * row: closing on them would put back exactly what this area was repaired for,
 * a checklist asserting a measurement that cannot be cited. The rows stay open
 * and the document names the artifact and the reason it does not qualify.
 *
 * @param {string} artifactPath the path given to --replay
 * @returns {{path: string, verdict: (string|null), gateQualifying: boolean,
 *            gateQualifyingReason: (string|null), digest: string,
 *            statuses: Object, scenarios: number, confirming: number,
 *            usable: boolean}}
 * @throws {Error} a usage error when the artifact is missing or unreadable
 */
function loadReplayArtifact(artifactPath) {
  var raw;
  try {
    raw = fs.readFileSync(artifactPath, 'utf8');
  } catch (err) {
    throw usageError('Cannot read the replay artifact ' + artifactPath + ': ' + err.message);
  }

  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw usageError('Cannot parse the replay artifact ' + artifactPath + ': ' + err.message);
  }

  if (parsed.tool !== REPLAY_ARTIFACT_TOOL) {
    throw usageError('The replay artifact ' + artifactPath + ' names ' +
      JSON.stringify(parsed.tool || null) + ' as its tool, not ' +
      JSON.stringify(REPLAY_ARTIFACT_TOOL) + '. --replay takes the `--out` artifact of ' +
      REPLAY_ARTIFACT_TOOL + ' and nothing else: an artifact of unknown provenance joined ' +
      'onto the evidence would close rows on verdicts whose meaning is unknown.');
  }

  var passes = Array.isArray(parsed.passes) ? parsed.passes : [];
  if (passes.length === 0) {
    throw usageError('The replay artifact ' + artifactPath + ' records no passes, so it ' +
      'carries no per-scenario verdict to join.');
  }

  // A scenario driven in several passes must be confirmed in EVERY one of
  // them. The weakest verdict governs, for the same reason
  // weakestEvidenceState() takes the weakest of several scenarios: a row is
  // only as proven as its least-proven driving, and the secure and non-secure
  // passes measure different cookie contracts over the same route.
  var statuses = Object.create(null);
  passes.forEach(function (pass) {
    var results = Array.isArray(pass.scenarioResults) ? pass.scenarioResults : [];
    results.forEach(function (record) {
      if (!record || typeof record.id !== 'string' || record.id === '') {
        return;
      }
      var verdict = readReplayResult({ replay: { verdict: record.status } });
      var confirmed = Boolean(verdict && verdict.confirmed);
      var held = statuses[record.id];
      if (!held) {
        statuses[record.id] = {
          verdict: record.status || null,
          confirmed: confirmed,
          approvedChange: Boolean(verdict && verdict.approvedChange),
          passes: [pass.name || 'unnamed']
        };
        return;
      }
      held.passes.push(pass.name || 'unnamed');
      if (!confirmed) {
        held.verdict = record.status || null;
        held.confirmed = false;
        held.approvedChange = Boolean(verdict && verdict.approvedChange);
      }
    });
  });

  var ids = Object.keys(statuses);
  return {
    path: artifactPath,
    verdict: typeof parsed.verdict === 'string' ? parsed.verdict : null,
    gateQualifying: parsed.gateQualifying === true,
    gateQualifyingReason: typeof parsed.gateQualifyingReason === 'string'
      ? parsed.gateQualifyingReason
      : null,
    digest: crypto.createHash('sha256').update(raw).digest('hex'),
    statuses: statuses,
    scenarios: ids.length,
    confirming: ids.filter(function (id) {
      return statuses[id].confirmed;
    }).length,
    // Only a gate-qualifying artifact may close a row. See the note above.
    usable: parsed.gateQualifying === true
  };
}

/**
 * Joins a replay artifact's verdicts onto the corpus evidence, in place.
 *
 * The corpus supplies the baseline half of every comparison and the artifact
 * supplies the target half, which is the division the two tools already have.
 * A verdict for a scenario the corpus does not contain is recorded as
 * unmatched rather than silently ignored: it means the two artifacts describe
 * different corpora, and a reader is entitled to see that rather than a lower
 * closure figure with no reason.
 *
 * @param {Object} evidence the loaded corpus evidence, mutated
 * @param {Object} artifact from loadReplayArtifact
 * @returns {{joined: number, unmatched: string[], closed: number}}
 */
function joinReplayEvidence(evidence, artifact) {
  var joined = 0;
  var unmatched = [];
  var closed = 0;

  Object.keys(artifact.statuses).forEach(function (id) {
    var status = artifact.statuses[id];
    var scenario = evidence.scenarios[id];
    if (!scenario) {
      unmatched.push(id);
      return;
    }
    joined++;
    if (!artifact.usable) {
      return;
    }
    scenario.replay = {
      verdict: status.verdict,
      confirmed: status.confirmed,
      approvedChange: status.approvedChange
    };
    if (status.confirmed && scenario.hasBaseline) {
      closed++;
    }
  });

  // The one figure every closure rule reads. Recomputed here rather than
  // adjusted, so it cannot drift from the scenarios it counts.
  evidence.recorded = Object.keys(evidence.scenarios).filter(function (id) {
    var scenario = evidence.scenarios[id];
    return scenario.hasBaseline && scenario.replay && scenario.replay.confirmed;
  }).length;

  return { joined: joined, unmatched: unmatched.sort(), closed: closed };
}

/**
 * The evidence state of one named scenario.
 *
 * RECORDED requires BOTH halves: the baseline captured and the target
 * replayed with a confirming verdict. A captured baseline alone records what
 * the pre-migration code did, which is not a comparison, so it yields
 * BASELINE_ONLY -- returning RECORDED from `hasBaseline` alone would let a
 * baseline with no replay close a row and call it a measurement.
 */
function evidenceStateOf(evidence, scenarioId) {
  if (!evidence.available) {
    return EVIDENCE.NO_CORPUS;
  }
  if (!scenarioId || !evidence.scenarios[scenarioId]) {
    return EVIDENCE.UNLINKED;
  }
  var scenario = evidence.scenarios[scenarioId];
  if (!scenario.hasBaseline) {
    return EVIDENCE.PENDING;
  }
  return scenario.replay && scenario.replay.confirmed
    ? EVIDENCE.RECORDED
    : EVIDENCE.BASELINE_ONLY;
}

/**
 * The evidence state of a row backed by SEVERAL scenarios.
 *
 * The weakest state governs, not the strongest. A row that claims the
 * preserved behaviour of every branch it names is only as proven as its
 * least-proven branch, and taking the strongest lets one captured scenario
 * close sibling rows for branches that scenario cannot reach -- the image and
 * attachment branches of `files.download` are mutually exclusive, so a result
 * for one is silent about the other.
 */
function weakestEvidenceState(evidence, scenarioIds) {
  if (!evidence.available) {
    return EVIDENCE.NO_CORPUS;
  }
  if (!scenarioIds || scenarioIds.length === 0) {
    return EVIDENCE.UNLINKED;
  }
  var order = [
    EVIDENCE.UNLINKED,
    EVIDENCE.PENDING,
    EVIDENCE.INDIRECT,
    EVIDENCE.BASELINE_ONLY,
    EVIDENCE.RECORDED
  ];
  var worst = EVIDENCE.RECORDED;
  scenarioIds.forEach(function (id) {
    var state = evidenceStateOf(evidence, id);
    if (order.indexOf(state) < order.indexOf(worst)) {
      worst = state;
    }
  });
  return worst;
}

/**
 * The sentence a row uses to report its evidence, naming the scenario and, when
 * the row cannot close, the exact reason. Written to be read at the row rather
 * than looked up: "pending" without the artifact and the field that says so is
 * indistinguishable from an assertion.
 */
function describeEvidence(evidence, scenarioIds, subject, forcedState) {
  var state = forcedState || weakestEvidenceState(evidence, scenarioIds);
  var named = (scenarioIds || []).map(function (id) {
    return '`' + id + '`';
  }).join(', ');

  if (state === EVIDENCE.NO_CORPUS) {
    return ' EVIDENCE: none available -- `' + CORPUS_PATH + '` is not present in the ' +
      'analysed tree, so ' + subject + ' cannot be verified from this tree and the row ' +
      'stays open.';
  }
  if (state === EVIDENCE.UNLINKED) {
    return ' EVIDENCE: **no linked scenario**. Nothing in `' + CORPUS_PATH + '` drives ' +
      'this site, so ' + subject + ' rests on nothing measurable. The row cannot close ' +
      'until a scenario covers it.';
  }
  if (state === EVIDENCE.PENDING) {
    return ' EVIDENCE: driven by ' + named + ' in `' + CORPUS_PATH + '`, which defines the ' +
      'request but carries **no captured baseline response** yet (`summary.captured: false`, ' +
      '`baselinesPending: ' + evidence.pending + '`). ' + subject.charAt(0).toUpperCase() +
      subject.slice(1) + ' is therefore prospective, not recorded, and the row stays open ' +
      'until the corpus is captured and replayed.';
  }
  if (state === EVIDENCE.INDIRECT) {
    return ' EVIDENCE: **route-level only**. ' + named + ' in `' + CORPUS_PATH + '` cover ' +
      'the route this site is reached from, but none of them is pinned to THIS site: ' +
      'route-level coverage cannot distinguish it from the other sites the same route ' +
      'reaches, and some of those sit on branches that are mutually exclusive with each ' +
      'other. So those scenarios are candidates, not proof of ' + subject + '. The row ' +
      'closes when a scenario is pinned to this site -- by a reply chain located around it ' +
      '-- and that scenario carries a captured baseline and a confirming replay.';
  }
  if (state === EVIDENCE.BASELINE_ONLY) {
    return ' EVIDENCE: ' + named + ' in `' + CORPUS_PATH + '` carries a captured baseline ' +
      'response, but **no replay result for the target** -- so what is recorded is what the ' +
      'PRE-MIGRATION code did, which is one half of a comparison. ' +
      subject.charAt(0).toUpperCase() + subject.slice(1) + ' stays open until ' +
      '`test/parity/replay.js` records a confirming verdict for that scenario against this ' +
      'tree.';
  }
  return ' EVIDENCE: ' + named + ' in `' + CORPUS_PATH + '` carries a captured baseline ' +
    'response AND a confirming replay verdict against this tree, so ' + subject + ' is a ' +
    'recorded comparison rather than an expectation.';
}

// ---------------------------------------------------------------------------
// SECTION 12 -- MODEL CONSTRUCTION
// ---------------------------------------------------------------------------

var CONTROLLER_DIR = 'lib/controllers';
var HELPERS_PATH = 'lib/util/helpers.js';
var ROUTE_CONFIGS = ['config/routes.js', 'config/api_routes.js'];

// The repository this generator belongs to, which is NOT necessarily the tree
// being analysed: --app points at the baseline worktree while the generator
// stays here. Its own identity has to be resolved against its own repository.
var GENERATOR_REPO_ROOT = path.resolve(__dirname, '..', '..');

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
function analyseTree(appRoot, replayArtifact) {
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
    nonReactionMemberCalls: [],
    namedFunctionsByFile: Object.create(null),
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

    findNonReactionMemberCalls(file.scrubbed, file.lineIndex, file.original)
      .forEach(function (site) {
        site.file = relPath;
        site.controller = name;
        site.enclosing = enclosingHandlerName(model.handlers, relPath, site.line);
        model.nonReactionMemberCalls.push(site);
      });

    findCallbackBoundaries(file.scrubbed, file.lineIndex, file.original).forEach(function (cb) {
      cb.file = relPath;
      cb.controller = name;
      cb.enclosing = enclosingHandlerName(model.handlers, relPath, cb.line);
      model.callbackBoundaries.push(cb);
    });

    model.namedFunctionsByFile[relPath] = findNamedFunctions(file.scrubbed, file.lineIndex);

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

  // --- carriers, routes and parity evidence -------------------------------
  // Every site whose row is anchored by symbol or joined to a scenario gets
  // its carrier resolved here, once, so the renderers read a resolved model
  // rather than re-deriving the join per table.
  model.evidence = loadEvidence(appRoot);

  // The target half of every comparison, when a replay artifact was supplied.
  // Joined here -- immediately after the corpus and before any row reads an
  // evidence state -- so the stream pins, the roster rows and the accounting
  // all see one settled evidence model. See loadReplayArtifact() for why the
  // join is needed at all and what it refuses.
  model.replayArtifact = replayArtifact || null;
  model.replayJoin = replayArtifact
    ? joinReplayEvidence(model.evidence, replayArtifact)
    : null;

  model.replyChains.forEach(function (chain) {
    chain.carrier = carrierOf(model, chain.file, chain.startLine);
    chain.enclosing = chain.carrier ? chain.carrier.name : null;
  });

  resolveChainDispositions(model);

  // Same carrier resolution for callback boundaries: the closure question has
  // a carrier half, so the carrier travels with the row rather than being
  // re-derived in the renderer.
  model.callbackBoundaries.forEach(function (cb) {
    cb.carrier = carrierOf(model, cb.file, cb.line);
    cb.disposition = callbackDisposition(cb);
  });

  Object.keys(model.streamSitesByController).forEach(function (name) {
    model.streamSitesByController[name].forEach(function (site) {
      site.carrier = carrierOf(model, site.file, site.line);
      var reach = routesForCarrier(model, site.file, site.carrier);
      site.routes = reach.routes;
      site.routeVia = reach.via;
      site.scenarios = [];
      reach.routes.forEach(function (route) {
        (model.evidence.byRoute[route] || []).forEach(function (id) {
          if (site.scenarios.indexOf(id) === -1) {
            site.scenarios.push(id);
          }
        });
      });
      site.scenarios.sort();
      site.routeScenarios = site.scenarios.slice();

      var pin = pinStreamScenario(model, site);
      if (pin) {
        site.scenarioPin = pin;
        site.scenario = pin.scenario;
        site.scenarios = [pin.scenario];
        site.evidenceState = evidenceStateOf(model.evidence, pin.scenario);
      } else {
        // Route-level coverage only. The candidates stay on the row so a
        // reader can see what was found, but the state says plainly that
        // nothing pins them to THIS branch, and the row cannot close.
        site.scenarioPin = null;
        site.scenario = null;
        site.evidenceState = site.scenarios.length === 0
          ? EVIDENCE.UNLINKED
          : EVIDENCE.INDIRECT;
      }
    });
  });

  // --- gate evidence for the five unrouted functions ----------------------
  // Only the unrouted ones are measured. The routed ones are in the
  // conversion set unconditionally, so a gate determination for them would be
  // noise -- and findExportReferences() walks the tree, which is not free.
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
  //
  // Four separate claims, because they answer four different questions and a
  // header that conflates them is unusable: the analysed tree's revision,
  // whether that revision still describes the analysed BYTES, a content digest
  // checkable without any repository, and the identity of the generator itself.
  // The last is resolved against the generator's OWN repository rather than the
  // directory it happens to run from, so the revision it names is one a reader
  // can retrieve.
  var appHead = gitHead(appRoot);
  var analysedPaths = files.map(function (f) {
    return f.path;
  }).sort();
  var dirty = gitDirtyPaths(appRoot, analysedPaths);
  var generatorRel = path.relative(GENERATOR_REPO_ROOT, __filename).split(path.sep).join('/');
  var generatorSource = '';
  try {
    generatorSource = fs.readFileSync(__filename, 'utf8');
  } catch (err) {
    generatorSource = '';
  }
  var generatorDirty = gitDirtyPaths(GENERATOR_REPO_ROOT, [generatorRel]);

  model.provenance = {
    appRoot: appRoot,
    appHead: appHead,
    atBaseline: isCommit(appHead, BASELINE_COMMIT),
    analysedPaths: analysedPaths,
    analysedDigest: analysedSourceDigest(files),
    analysedDirty: dirty,
    generatorPath: generatorRel,
    generatorDigest: generatorSource === '' ? null : digestOf(generatorSource),
    generatorCommit: generatorDirty && generatorDirty.length === 0
      ? gitLastCommitFor(GENERATOR_REPO_ROOT, generatorRel)
      : null,
    generatorDirty: generatorDirty === null ? null : generatorDirty.length > 0,
    evidencePath: CORPUS_PATH,
    evidenceAvailable: model.evidence.available,
    evidenceCaptured: model.evidence.captured,
    // The gate-relevant figure: scenarios carrying BOTH a captured baseline
    // and a confirming replay verdict. Recorded in the artifact's own header
    // because it is the number every measurement-gated row answers to, and a
    // header that carried only `evidenceCaptured` reported a corpus as
    // evidence while none of it had been replayed against this tree.
    evidenceRecorded: model.evidence.recorded,
    evidenceDigest: model.evidence.available
      ? digestOf(fs.readFileSync(path.join(appRoot, CORPUS_PATH), 'utf8'))
      : null,
    nodeVersion: process.version,
    // The generator's identity under the shared contract, alongside the
    // sha256 above: a git blob, and a commit only when that commit's tree
    // holds that blob at that path.
    contractGenerator: provenanceContract.generator(__filename, GENERATOR_REPO_ROOT)
  };

  // The row census and its population accounting, attached to the model so the
  // self-checks can assert the arithmetic before anything is rendered.
  var census = buildSectionCensus(model);
  model.sections = census.sections;
  model.accounting = census.accounting;

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

/**
 * The innermost NAMED symbol containing a line: an exported handler where one
 * encloses it, otherwise a module-scope named function.
 *
 * Returns `{ name, kind }` or null. `kind` is `'handler'` for an exported
 * controller method and `'function'` for anything else, because the two are
 * routed differently: a handler is named by a route binding, a function is
 * reached from one and has to be traced.
 */
function carrierOf(model, file, line) {
  var best = null;
  var bestSpan = Infinity;

  model.handlers.forEach(function (h) {
    if (h.file !== file || line < h.line || line > h.endLine) {
      return;
    }
    var span = h.endLine - h.line;
    if (span < bestSpan) {
      // `line`/`endLine` and the handler's own delivery proof travel with the
      // carrier, because a site's disposition often depends on them: a value
      // discarded inside a lifecycle method that is PROVEN to deliver on every
      // path cannot have been the response.
      best = {
        name: h.name,
        kind: 'handler',
        binding: h.binding,
        line: h.line,
        endLine: h.endLine,
        delivers: isHandlerClosed(h),
        routed: h.routed
      };
      bestSpan = span;
    }
  });

  (model.namedFunctionsByFile[file] || []).forEach(function (fn) {
    if (line < fn.line || line > fn.endLine) {
      return;
    }
    var span = fn.endLine - fn.line;
    if (span < bestSpan) {
      best = {
        name: fn.name,
        kind: 'function',
        line: fn.line,
        endLine: fn.endLine,
        // A module-scope helper is not a lifecycle method, so there is no
        // delivery obligation on it to prove (rule T-3 puts the promise
        // boundary at the lifecycle method).
        delivers: null,
        routed: false
      };
      bestSpan = span;
    }
  });

  return best;
}

/**
 * Whether a captured name is later read in a position that delivers its value,
 * anywhere in the span given.
 *
 * Three positions count, and the third is transitive: a `return`/`throw`
 * expression, a promise settlement argument, and the head of ANOTHER chain
 * that this analysis has already established as delivered -- which is how
 * `addFolderSlugJob = Folder.findByOwner(user)...` reaches hapi, through
 * `addFolderSlugJob.then(...).then(function () { resolve(request.success(...)); })`
 * twenty lines below it.
 */
function nameDeliveredIn(scrubbed, from, to, name, chains) {
  var pattern = new RegExp('(?<![A-Za-z0-9_$.])' + name + '(?![A-Za-z0-9_$])', 'g');
  pattern.lastIndex = from;
  var match;

  while ((match = pattern.exec(scrubbed)) !== null && match.index < to) {
    if (isInReturnPosition(scrubbed, match.index) ||
        isSettlementArgument(scrubbed, match.index)) {
      return true;
    }
    var headOfDelivered = chains.some(function (other) {
      return other.headStart === match.index && other.delivered === true;
    });
    if (headOfDelivered) {
      return true;
    }
  }

  return false;
}

/**
 * Settles every promise chain's disposition: whether its value reaches a
 * consumer, and -- where it does not -- whether that is a defect or the
 * preserved fire-and-forget the baseline had.
 *
 * WHY THIS IS NOT A PREFIX TEST. The question a chain row answers is the one
 * AAP 0.4.1 poses: after conversion each chain must be "returned or awaited
 * exactly once per path", because "neither a returned-but-unawaited chain nor
 * an awaited-but-unreturned one is visible in a signature count". Reading only
 * `return`/`await` and only a first-argument function literal answered a
 * narrower question than that, and got 34 chains in this tree wrong in the
 * SAFE-LOOKING direction -- reporting delivered work as open, including all
 * ten `return ....catch(request.fail)` chains, which are the very shape the
 * AAP singles out as correct and which three carry an in-source comment
 * recording as preserved verbatim.
 *
 * A row therefore closes when either half of the disposition is settled:
 *
 *   DELIVERED -- the chain's value or settlement reaches a consumer (return,
 *   await, `resolve(chain)`, an argument such as `promises.push(chain)`, a
 *   capture whose name is later delivered, or a reaction that settles the
 *   carrier's promise) AND its terminal reaction produces a value.
 *
 *   DELIBERATELY DISCARDED -- the chain is in statement position with no
 *   settlement, and nothing can have depended on its value: either the carrier
 *   is a lifecycle method PROVEN to deliver on every path (so the discarded
 *   value provably was not the response), or the carrier is not a lifecycle
 *   method at all, where T-3 puts no delivery obligation and the discard is
 *   the helper's own timing -- preserved under R-d. Two of these are mandated
 *   by T-5 in as many words: the fire-and-forget
 *   `fs.promises.unlink(...).catch(() => {})` sites.
 *
 * It stays OPEN when the value is discarded inside a lifecycle method whose
 * own delivery is NOT proven -- there the discarded value may have been the
 * response -- or when it is delivered into a reaction that produces nothing.
 * Both reasons are recorded on the chain and printed in the row.
 */
function resolveChainDispositions(model) {
  var scrubbedByFile = Object.create(null);
  model.files.forEach(function (file) {
    scrubbedByFile[file.path] = file.scrubbed;
  });

  model.promiseChains.forEach(function (chain) {
    chain.carrier = carrierOf(model, chain.file, chain.startLine);
    chain.delivered = chain.delivery === 'return' || chain.delivery === 'await' ||
      chain.delivery === 'settlement-argument' || chain.delivery === 'argument' ||
      chain.settlesInReaction;
  });

  // The capture case is transitive -- a name delivered by a chain that is
  // itself delivered by a name -- so it is resolved to a fixpoint rather than
  // in one pass. The bound exists because a cycle in the tree must terminate
  // the loop rather than hang the generator.
  var pass = 0;
  var changed = true;
  while (changed && pass < 8) {
    changed = false;
    pass++;
    model.promiseChains.forEach(function (chain) {
      if (chain.delivered || chain.delivery !== 'capture' || !chain.deliveryDetail) {
        return;
      }
      var scrubbed = scrubbedByFile[chain.file];
      if (!scrubbed) {
        return;
      }
      var siblings = model.promiseChains.filter(function (other) {
        return other.file === chain.file;
      });
      var from = chain.endOffset;
      var to = scrubbed.length;
      if (chain.carrier) {
        var lineIndex = null;
        model.files.forEach(function (file) {
          if (file.path === chain.file) {
            lineIndex = file.lineIndex;
          }
        });
        if (lineIndex) {
          to = chain.carrier.endLine < lineIndex.length
            ? lineIndex[chain.carrier.endLine]
            : scrubbed.length;
        }
      }
      if (nameDeliveredIn(scrubbed, from, to, chain.deliveryDetail, siblings)) {
        chain.delivered = true;
        changed = true;
      }
    });
  }

  model.promiseChains.forEach(function (chain) {
    chain.disposition = chainDisposition(chain);
  });
}

/** The settled disposition of one chain: closed or open, and why. */
function chainDisposition(chain) {
  if (chain.delivered && chain.terminalDelivers) {
    return {
      closed: true,
      state: 'delivered',
      reason: chainDeliveryPhrase(chain)
    };
  }
  if (chain.delivered && !chain.terminalDelivers) {
    return {
      closed: false,
      state: 'delivered-into-nothing',
      reason: 'the chain leaves the expression (' + chainDeliveryPhrase(chain) +
        ') but its terminal `.' + chain.terminalName + '(' +
        (chain.terminalArg ? chain.terminalArg : '') + ')` registers no reaction that ' +
        'produces a value, so what reaches hapi is whatever the previous link resolved to'
    };
  }
  if (chain.carrier && chain.carrier.kind === 'handler' && chain.carrier.delivers !== true) {
    return {
      closed: false,
      state: 'discarded-in-unproven-carrier',
      reason: 'the chain is in statement position, so its value is discarded, and `' +
        chain.carrier.name + '` is not proven to deliver on every path -- the discarded ' +
        'value may be the response on the path that does not'
    };
  }
  if (chain.carrier && chain.carrier.kind === 'handler') {
    return {
      closed: true,
      state: 'discarded-by-design',
      reason: 'the chain is in statement position and `' + chain.carrier.name +
        '` is proven to deliver a lifecycle value on every path, so the discarded value ' +
        'was not the response -- this is fire-and-forget timing, and preserving it is the ' +
        'target (R-d)'
    };
  }
  return {
    closed: true,
    state: 'discarded-outside-lifecycle',
    reason: 'the chain is in statement position inside ' +
      (chain.carrier ? '`' + chain.carrier.name + '`' : 'module scope') +
      ', which is not a lifecycle method, so rule T-3 places no delivery obligation on ' +
      'it and the discard is the helper\'s own timing -- preserved under R-d'
  };
}

/** How a delivered chain's value leaves, in a phrase a row can carry. */
function chainDeliveryPhrase(chain) {
  if (chain.delivery === 'return') {
    return 'returned';
  }
  if (chain.delivery === 'await') {
    return 'awaited';
  }
  if (chain.delivery === 'settlement-argument') {
    return 'handed to `resolve(...)` / `reject(...)`, settling the promise the carrier returns';
  }
  if (chain.delivery === 'argument') {
    return 'passed to `' + (chain.deliveryDetail || 'a consumer') + '`';
  }
  if (chain.delivery === 'capture') {
    return 'captured into `' + chain.deliveryDetail + '`, which a later expression delivers';
  }
  if (chain.settlesInReaction) {
    return 'settled through `resolve(...)` / `reject(...)` inside one of its own reactions';
  }
  return 'delivered';
}

/**
 * The routes a carrier answers, and how the analysis got from one to the other.
 *
 * A handler is named directly by its route bindings. A module-scope function is
 * not: `lib/controllers/trinket.js`'s `downloadZip` is reached through the
 * `supportedDownloadFormats` dispatch table, so the route it serves is two
 * identifier hops away. Both hops are followed and the PATH is reported, so a
 * reader can check the join rather than take it -- and a carrier whose route
 * cannot be reached in two hops is reported as unresolved rather than guessed.
 */
function routesForCarrier(model, file, carrier, depth, seen) {
  if (!carrier) {
    return { routes: [], via: [], resolved: false };
  }
  var hops = depth === undefined ? 2 : depth;
  var visited = seen || Object.create(null);
  if (visited[carrier.name]) {
    return { routes: [], via: [], resolved: false };
  }
  visited[carrier.name] = true;

  if (carrier.kind === 'handler') {
    var declarations = model.bindings.filter(function (d) {
      return d.binding === carrier.binding;
    });
    return {
      routes: declarations.map(function (d) {
        return d.method + ' ' + d.path;
      }).filter(function (r, i, all) {
        return all.indexOf(r) === i;
      }).sort(),
      via: [],
      resolved: declarations.length > 0
    };
  }

  if (hops <= 0) {
    return { routes: [], via: [], resolved: false };
  }

  // A module-scope function: find where its name is referenced, and resolve
  // the carrier of each reference. A reference that is itself at module scope
  // (the dispatch table) resolves through the binding that holds it.
  var sourceFile = model.files.filter(function (f) {
    return f.path === file;
  })[0];
  if (!sourceFile) {
    return { routes: [], via: [], resolved: false };
  }

  var routes = [];
  var via = [];
  var pattern = new RegExp('(?<![A-Za-z0-9_$.])' + carrier.name + '(?![A-Za-z0-9_$])', 'g');
  var m;
  while ((m = pattern.exec(sourceFile.scrubbed)) !== null) {
    var line = lineAt(sourceFile.lineIndex, m.index);
    var referrer = carrierOf(model, file, line);
    if (!referrer || referrer.name === carrier.name) {
      // A module-scope reference: the enclosing binding is the next hop.
      var holder = enclosingBindingName(sourceFile.scrubbed, sourceFile.lineIndex, m.index);
      if (!holder) {
        continue;
      }
      referrer = { name: holder, kind: 'function' };
    }
    var upstream = routesForCarrier(model, file, referrer, hops - 1, visited);
    if (upstream.routes.length === 0) {
      continue;
    }
    via.push(referrer.name);
    upstream.routes.forEach(function (r) {
      if (routes.indexOf(r) === -1) {
        routes.push(r);
      }
    });
    upstream.via.forEach(function (v) {
      if (via.indexOf(v) === -1) {
        via.push(v);
      }
    });
  }

  return { routes: routes.sort(), via: via, resolved: routes.length > 0 };
}

/**
 * The name of the module-scope binding whose initializer contains `offset` --
 * the dispatch table in `var supportedDownloadFormats = { 'zip' : downloadZip }`.
 */
function enclosingBindingName(scrubbed, lineIndex, offset) {
  var re = /(?<![A-Za-z0-9_$.])(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*[{[]/g;
  var m;
  var name = null;
  while ((m = re.exec(scrubbed)) !== null) {
    var open = scrubbed.indexOf(scrubbed[m.index + m[0].length - 1], m.index + m[0].length - 1);
    var close = matchDelimiter(scrubbed, open);
    if (close === -1) {
      continue;
    }
    if (offset > open && offset < close) {
      name = m[1];
    }
  }
  return name;
}

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
// They convert only if another gate independently forces it, and that
// determination is RECORDED per function rather than assumed. Two gates can
// force one:
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
 * The module path a `require(...)` argument names, resolved to a path relative
 * to the analysed tree's root, or null when it is not a relative require.
 *
 * Only relative requires can name a file in this tree; a bare specifier is a
 * package. The `.js` extension is supplied when the specifier omits it, which
 * is how every require in this repository is written.
 */
function resolveRequiredPath(fromRel, specifier) {
  if (specifier.charAt(0) !== '.') {
    return null;
  }
  var resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromRel), specifier)
  );
  return /\.js$/.test(resolved) ? resolved : resolved + '.js';
}

/**
 * The local names one file binds to a given module, plus whether it reaches
 * that module's exports without binding a name at all.
 *
 * Read from the UNSCRUBBED text, because the module path is a string literal
 * and `scrubSource` blanks string contents by design. The member access is
 * then matched in the scrubbed text, so the two halves read the form each one
 * survives in.
 */
function moduleBindingsIn(text, fromRel, targetRel, identifier) {
  var bindings = [];
  var direct = false;
  var re = /require\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  var match;

  while ((match = re.exec(text)) !== null) {
    if (resolveRequiredPath(fromRel, match[2]) !== targetRel) {
      continue;
    }

    // `require('./x').name` -- the export is reached with no intermediate
    // name, so there is nothing to match a member access against later.
    var after = text.slice(match.index + match[0].length, match.index + match[0].length + 80);
    if (new RegExp('^\\s*\\.\\s*' + identifier + '(?![A-Za-z0-9_$])').test(after)) {
      direct = true;
    }

    // The binding is whatever the require is assigned to. All three forms this
    // repository uses are accepted: `var x = require(...)`, a continued
    // `x = require(...)` inside a multi-name declaration, and destructuring.
    var before = text.slice(Math.max(0, match.index - 200), match.index);
    var assigned = /([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*$/.exec(before);
    if (assigned) {
      bindings.push(assigned[1]);
      continue;
    }
    var destructured = /\{([^{}]*)\}\s*=\s*$/.exec(before);
    if (destructured && new RegExp('(?<![A-Za-z0-9_$])' + identifier +
        '(?![A-Za-z0-9_$])').test(destructured[1])) {
      direct = true;
    }
  }

  return { bindings: bindings, direct: direct };
}

/**
 * Where one EXPORT of one module is referenced across the application and the
 * suite, excluding the file that defines it.
 *
 * A reference to `pages.features` is a member access on something bound to
 * `lib/controllers/pages.js` -- under whatever local name that file chose,
 * since `test/lib/api/trinket.js` binds controllers as `filesCtrl` and
 * `usersCtrl` rather than by basename. So the module is resolved first and the
 * access is matched against its local bindings.
 *
 * IT IS NOT A BARE OCCURRENCE OF THE NAME, which is what an earlier revision
 * matched. Measured consequence: `pages.features` was reported as referenced
 * by `lib/util/features.js`, `lib/controllers/files.js`,
 * `lib/controllers/users.js`, `lib/util/helpers.js`, `test/lib/api/files.js`
 * and `test/lib/api/trinket.js` -- every hit a `config.features.assets` read
 * or a module of that name, and not one of them a reference to the export. On
 * that evidence the document concluded that the repaired suite forced the
 * conversion of a function no route and no test reaches, which R-a forbids and
 * which would have been read as instructed work.
 *
 * Files are read as TEXT and scrubbed for the access match, so a mention
 * inside a comment or a string does not count -- and nothing under test/lib or
 * test/helpers is ever REQUIRED, only read.
 */
function findExportReferences(appRoot, identifier, definedIn) {
  var searchRoots = ['lib', 'test/lib', 'test/helpers', 'config'];
  var hits = [];

  searchRoots.forEach(function (dir) {
    collectJsFiles(appRoot, dir, 6, []).forEach(function (rel) {
      if (rel === definedIn) {
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

      var reached = moduleBindingsIn(text, rel, definedIn, identifier);
      if (reached.direct) {
        hits.push(rel);
        return;
      }
      if (reached.bindings.length === 0) {
        return;
      }

      var scrubbed = scrubSource(text);
      var qualified = new RegExp('(?<![A-Za-z0-9_$.])(?:' +
        reached.bindings.join('|') + ')\\s*\\.\\s*' + identifier +
        '(?![A-Za-z0-9_$])');
      if (qualified.test(scrubbed)) {
        hits.push(rel);
      }
    });
  });

  return hits.filter(function (rel, index) {
    return hits.indexOf(rel) === index;
  }).sort();
}

/** Per-function gate evidence for one unrouted function. */
function gateEvidence(appRoot, definedIn, identifier, bodyText) {
  var deprecated = deprecatedApisIn(bodyText);
  var references = findExportReferences(appRoot, identifier, definedIn);
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

/** The measured signature phrase for a lifecycle method, e.g. "async (request, h)". */
function signaturePhrase(entry) {
  return (entry.isAsync ? 'async ' : '') + 'function (' + entry.params + ')';
}

/**
 * How each signalling call's value reaches hapi, in the order that matters to
 * a reader closing the row.
 *
 * The distinction this column exists to draw is between a value that leaves
 * the function and one that does not, and the mechanism is not always a
 * `return` in front of the call: a response can be settled into the promise
 * the handler returns, returned from a `.then` handler on a chain the handler
 * returns, or captured into a name a later branch returns. All three are
 * delivery; a call whose value is simply discarded inside a callback is not.
 */
function describeDelivery(a) {
  var parts = [];
  if (a.ownReturned > 0) {
    parts.push(a.ownReturned + ' returned directly');
  }
  if (a.nestedSettling > 0) {
    parts.push(a.nestedSettling + ' settling the returned promise');
  }
  var throughOwner = a.nestedDelivered - a.nestedSettling;
  if (throughOwner > 0) {
    parts.push(throughOwner + ' returned through a nested handler on a returned chain');
  }
  if (a.captured > 0) {
    parts.push(a.captured + ' captured into a name a returning branch reads');
  }
  return parts.join(', ');
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
  } else if (a.reliesOnInterception) {
    parts.push('RELIES ON THE INTERCEPTION -- ' + a.unreturnedSignals + ' of ' +
      a.signalCount + ' signalling call' + (a.signalCount === 1 ? '' : 's') +
      ' produce a value that never leaves the function (' + a.ownUnreturned +
      ' unreturned in the body, ' + a.nestedDropped + ' dropped inside a nested function)' +
      ', and at least one path delivers nothing, which is where the interception fires');
  } else if (a.unreturnedSignals > 0) {
    parts.push('delivers on every path, with ' + a.unreturnedSignals + ' of ' +
      a.signalCount + ' signalling call' + (a.signalCount === 1 ? '' : 's') +
      ' discarded (' + a.ownUnreturned + ' unreturned in the body, ' + a.nestedDropped +
      ' dropped inside a nested function) -- the interception cannot fire for this body, ' +
      'so the discarded value was already discarded at baseline');
  } else {
    parts.push('returns its response -- all ' + a.signalCount + ' signalling call' +
      (a.signalCount === 1 ? '' : 's') + ' delivered: ' + describeDelivery(a));
  }

  // The exit proof is reported for every row, because it is the half of the
  // contract a signalling-call census cannot see: an empty `async (request, h)`
  // has no unreturned call and still returns `undefined` to the toolkit.
  if (a.alwaysDelivers) {
    parts.push('every path through the body delivers a value or throws');
  } else if (a.alwaysExits) {
    // Exits everywhere and still delivers nothing: a bare `return;`, a
    // `return undefined`, a `void`/`console` return, or a non-settling
    // unconditional loop. Reported distinctly from "no exit", because the two
    // need different fixes and reading one as the other lets a body that hands
    // hapi `undefined` look converted.
    parts.push('NO PROVEN DELIVERY -- every path exits, but at least one exits WITHOUT ' +
      'a lifecycle value (a bare `return`, a statically `undefined` return, or a ' +
      'non-settling loop), which reaches hapi as `undefined`');
  } else {
    parts.push('NO PROVEN EXIT -- at least one path through the body reaches the end without ' +
      '`return` or `throw`');
  }

  if (a.usesReply) {
    parts.push('still consumes the shim `reply`');
  }

  return parts.join('; ');
}

/** The target signature phrase for a handler or pre-handler row. */
function handlerShape(isPreHandler) {
  return isPreHandler
    ? 'native lifecycle method `async function (request, h)`'
    : '`async function (request, h)`';
}

/**
 * The part of a handler's or pre-handler's target action that a governing
 * quirk action never contradicts, and which therefore LEADS a governed row
 * instead of being discarded with the mandate.
 *
 * A signature is a shape; a preserved outcome is about which value leaves the
 * body. Converting `function (request, reply)` to `async function (request, h)`
 * does not settle a request that baseline leaves unsettled, and it does not
 * suppress a throw. So the shape sentence survives, and the measured state of
 * the body's signalling calls survives with it -- it is a measurement, not an
 * instruction. What does not survive is the return mandate that follows it in
 * describeHandlerTarget(), which is exactly the clause a governed row must not
 * carry.
 *
 * WHICH SHAPE THE SENTENCE NAMES depends on which direction it points. For an
 * unconverted site the shape is the TARGET idiom, because the sentence is an
 * instruction. For a site already in a lifecycle shape the sentence is a
 * statement about the code, so it names the shape MEASURED on this body --
 * exactly as describeHandlerTarget() does. Reading `handlerShape()` in both
 * positions described `lib/controllers/auth.js`'s two handlers, which are
 * plain promise-returning `function (request, h)` declarations, as
 * `async function (request, h)`: a claim about the target dressed up as a
 * claim about the code, and wrong on a row whose whole purpose is to record
 * what the body currently does. The measured phrase is `async`-accurate
 * because `signaturePhrase()` reads the declaration's own `async` keyword.
 */
function describeHandlerLead(entry, isPreHandler) {
  var a = entry.analysis;
  var shape = handlerShape(isPreHandler);
  var measured = '`' + signaturePhrase(entry) + '`';

  if (entry.signature === 'legacy') {
    return 'Convert to ' + shape + '.';
  }
  if (a.reliesOnInterception) {
    return 'Signature is already ' + measured + ', with ' + a.unreturnedSignals + ' of ' +
      a.signalCount + ' signalling call' + (a.signalCount === 1 ? '' : 's') +
      ' falling off the end.';
  }
  if (a.unreturnedSignals > 0) {
    return 'Signature is already ' + measured + ', delivering on every path, with ' +
      a.unreturnedSignals + ' of ' + a.signalCount + ' signalling call' +
      (a.signalCount === 1 ? '' : 's') + ' discarded as at baseline.';
  }
  if (a.usesReply) {
    return 'Signature and returns are converted, with a residual `reply(` reference remaining.';
  }
  return 'Signature is already ' + measured + ', returning on every measured path.';
}

/** Target disposition for a handler or pre-handler row. */
function describeHandlerTarget(entry, isPreHandler) {
  var a = entry.analysis;
  // The target shape for an UNCONVERTED site is the idiom; for a site already
  // in a lifecycle shape it is the shape MEASURED on this body, so a plain
  // `function (request, h)` that returns on every path is not described as
  // `async`. Both `lib/controllers/auth.js` handlers are exactly that, and
  // calling them async would state the target as though it were the code.
  var shape = isPreHandler
    ? 'native lifecycle method `async function (request, h)`'
    : '`async function (request, h)`';
  var measured = '`' + signaturePhrase(entry) + '`';

  if (entry.signature === 'toolkit' && a.alwaysExits && !a.alwaysDelivers) {
    return 'Signature is already ' + measured + ', and every path exits -- but at least one ' +
      'path exits without delivering a lifecycle value: a bare `return`, a statically ' +
      '`undefined` return, or a loop that never settles. hapi receives `undefined` from ' +
      'such a path and converts it into `Boom.badImplementation`, so an exit on every ' +
      'path is not sufficient. This row closes when every reachable path returns a ' +
      'response, returns a promise of one, returns `null` where that is the intended ' +
      'lifecycle value, or throws.';
  }

  if (entry.signature === 'toolkit' && !a.alwaysExits) {
    return 'Signature is already ' + measured + ', but no path through the body was proven ' +
      'to end in `return` or `throw`. A lifecycle method that falls off the end returns ' +
      '`undefined`, which the toolkit converts into `Boom.badImplementation` once the shim ' +
      'is gone, so this row closes only when every reachable path returns a response, ' +
      'returns a promise of one, throws, or -- where baseline produced no response at all -- ' +
      'reproduces that outcome deliberately and records it in `' + QUIRK_DOC + '`.';
  }

  if (entry.signature === 'legacy') {
    if (a.usesReply) {
      return 'Convert to ' + shape + '; every `reply(...)` becomes a returned toolkit ' +
        'response and every path returns exactly once' +
        (isPreHandler ? ', or returns `null` where there is nothing to contribute' : '') + '.';
    }
    return 'Convert to ' + shape + '; return `request.success(...)` / `request.fail(...)` ' +
      'on every path' + (isPreHandler ? ', or `null` where there is nothing to contribute' : '') + '.';
  }

  if (a.reliesOnInterception) {
    return 'Signature is already ' + measured + ', but ' + a.unreturnedSignals +
      ' signalling call' + (a.unreturnedSignals === 1 ? '' : 's') +
      ' produce a value that never leaves the function (' + a.ownUnreturned +
      ' unreturned in the body, ' + a.nestedDropped + ' dropped inside a nested function) ' +
      'and at least one path delivers nothing, so the interception is what answers it today. ' +
      'Deliver the response on every path: return it, settle the promise the method returns ' +
      'with it, or return it from the nested handler of a chain this method returns.';
  }

  if (a.unreturnedSignals > 0) {
    // Delivers everywhere AND discards a signalling call. The measurement is
    // reported and no change is instructed, because there is none to make: the
    // interception fires only on an `undefined` result, this body never returns
    // one, and so the discarded value reached no client before the migration
    // either. Rerouting it to deliver would REPLACE the response this body
    // returns -- for `lib/controllers/trinket.js`'s `updateMetrics`, turning a
    // measured 500 into a 200 (R-d).
    return 'Already converted: ' + measured + ', every path delivering a lifecycle value. ' +
      a.unreturnedSignals + ' signalling call' +
      (a.unreturnedSignals === 1 ? ' produces' : 's produce') +
      ' a value that is discarded (' + a.ownUnreturned + ' unreturned in the body, ' +
      a.nestedDropped + ' dropped inside a nested function). That is the BASELINE outcome, ' +
      'not an unfinished conversion: the wrapper\'s interception substitutes a value only ' +
      'when the body returns `undefined`, which this body never does, so those calls ' +
      'resolved a deferred nobody read before the migration and return a response nobody ' +
      'reads after it. Do NOT reroute them to deliver -- that replaces the value this body ' +
      'returns with a different response, which is a behaviour change (R-d). Nothing ' +
      'further is required of this site.';
  }

  if (a.usesReply) {
    return 'Signature and returns are converted, but a residual `reply(` reference remains. ' +
      'Either return a toolkit response there, or -- if the expression is deliberately ' +
      'unreachable -- record it in `docs/preserved-quirks.md`. Do not change its behaviour.';
  }

  if (a.signalCount === 0) {
    // No `request.success` / `request.fail` / `reply` call at all. The response
    // comes from something else the body returns -- a toolkit call, a returned
    // chain, a Boom, a throw -- which the exit proof is what establishes.
    return 'Already converted: ' + measured + ' with no `request.success` / `request.fail` / ' +
      '`reply` call in the body, and every path ending in `return` or `throw`, so its ' +
      'response is whatever it returns. Nothing further is required of this site.';
  }

  return 'Already converted: ' + measured + ', every signalling call delivered (' +
    describeDelivery(a) + ') and every path ending in `return` or `throw`. Nothing further ' +
    'is required of this site.';
}

/**
 * Whether a handler/pre-handler row counts as closed.
 *
 * Four conditions, and the fourth is the one a signature census and a
 * signalling-call census both miss: the body must be PROVEN to leave on every
 * path. Without it an empty `async (request, h)` closes -- no legacy
 * signature, no unreturned signalling call, no `reply` -- while returning
 * `undefined` to a toolkit that converts it into a 500.
 */
function isHandlerClosed(entry) {
  var a = entry.analysis;
  return entry.signature === 'toolkit' &&
    // Reliance on the interception, not the presence of a discarded signalling
    // call. The two differ on exactly one body in this tree -- `updateMetrics`,
    // which delivers on every path and discards one nested `request.success`
    // -- and the difference matters because the interception fires only on an
    // `undefined` result. A body that never returns one is finished work; the
    // discarded call is reported in the row and instructs nothing, since
    // rerouting it would replace the response the body returns.
    !a.reliesOnInterception &&
    !a.usesReply &&
    // Delivery, not merely an exit. A body whose every path ends in `return;`
    // exits everywhere and hands hapi `undefined`, which the toolkit turns
    // into `Boom.badImplementation` -- the failure this whole document exists
    // to find. `statementAlwaysDelivers` states the rule.
    a.alwaysDelivers;
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

  // A replay artifact is a RUN OUTPUT and lives outside the repository, so its
  // path is recorded as a token rather than verbatim -- the same treatment the
  // baseline worktree gets, and for the same reason: a recorded absolute path
  // is not reproducible and its presence in the document would make two runs
  // over one tree differ. That the artifact was supplied IS recorded, because
  // it changes which rows close.
  var replayToken = null;
  if (options.replay) {
    var relativeReplay = path.relative(repoRoot, options.replay);
    replayToken = (relativeReplay !== '' && relativeReplay.indexOf('..') !== 0 &&
      !path.isAbsolute(relativeReplay)) ? relativeReplay : '"$REPLAY_RESULT"';
  }

  var command = 'node test/parity/convert-inventory.js' +
    (appToken ? ' --app ' + appToken : '') +
    (replayToken ? ' --replay ' + replayToken : '') +
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

/** The generator-commit line: a retrievable revision, or why there is none. */
function describeGeneratorCommit(p) {
  if (p.generatorDirty === null) {
    return '(the generator is not in a git worktree -- identified by the sha256 above)';
  }
  if (p.generatorDirty) {
    return '(uncommitted at generation time -- identified by the sha256 above)';
  }
  return (p.generatorCommit || '(unknown)') +
    ' (the last commit touching the generator, whose content matches it)';
}

/** Whether the analysed revision still describes the analysed bytes. */
function describeAnalysedState(p) {
  if (p.analysedDirty === null) {
    return 'not a git worktree -- the digest above is the only identification';
  }
  if (p.analysedDirty.length === 0) {
    return 'clean -- every analysed file matches that revision';
  }
  return p.analysedDirty.length + ' of ' + p.analysedPaths.length +
    ' analysed files differ from that revision (' + p.analysedDirty.join(', ') +
    '), so the digest above identifies what was read, not the revision';
}

/** The corpus this run read its evidence from, and its capture state. */
function describeEvidenceProvenance(p) {
  if (!p.evidenceAvailable) {
    return p.evidencePath + ' not present -- evidence-gated rows report having none';
  }
  return p.evidencePath + ', ' + p.evidenceDigest + ', captured: ' +
    (p.evidenceCaptured ? 'yes' : 'no');
}

/** The generator-commit line under the shared contract: three states, not one. */
function renderContractCommit(generator) {
  if (generator.commitState === 'contains-this-exact-source' && generator.verified) {
    return generator.commit + '  <-- verified: this commit\'s tree holds the blob ' +
      'above at that path';
  }
  if (generator.commitState === 'uncommitted-source') {
    return 'none -- `uncommitted-source`. The generator that produced this document ' +
      'is in no commit of this repository, so the blob above is its identity';
  }
  return 'none -- `' + generator.commitState + '`. No repository is reachable from ' +
    'the generator, so no commit could be resolved';
}

/**
 * Records the digest of the document's own body on its provenance block.
 *
 * A Markdown document has no JSON payload, so without this nothing ties the
 * block to the prose it describes and a hand-edited row verifies clean. The
 * shared contract treats a document block with no `bodyDigest` as a FAILURE.
 * The ordering is not circular: the canonicalization drops the
 * `provenance-json` line itself, so the digest of the pass-1 text and of the
 * written text are the same value.
 */
function bindBodyDigest(block, body) {
  block.bodyDigest = provenanceContract.bodyDigest(body);

  // Re-asserted because build() guards the block it returns and this field is
  // added after that.
  return provenanceContract.assertPortable(block, 'provenance');
}

function renderFrontMatter(model) {
  var p = model.provenance;
  var invocation = p.invocation || UNKNOWN_INVOCATION;
  var lines = [];
  // The machine-readable block goes ABOVE the front matter rather than inside
  // it: this front matter is one HTML comment, and a nested `-->` would close
  // it early. One line, first line, so a verifier finds it without parsing the
  // table. Consumed by
  // `node test/parity/manifest.js --verify-provenance docs/conversion-inventory.md`.
  if (p.block) {
    lines.push(provenanceContract.markdown(p.block));
  }
  lines.push('<!--');
  lines.push('  GENERATED FILE -- do not hand-edit it. Every line below this block is written');
  lines.push('  by the generator named here from the analysed tree named here. An edit made by');
  lines.push('  hand is lost on the next run and, while it survives, is indistinguishable from a');
  lines.push('  measurement. To change what this document says, change the generator or the');
  lines.push('  tree and re-run the exact command.');
  lines.push('');
  lines.push('  generator            : ' + (p.generatorPath || 'test/parity/convert-inventory.js'));
  lines.push('  generator sha256     : ' + (p.generatorDigest || '(unreadable)'));
  // The blob is the generator's identity in every clone: `git hash-object`
  // yields these same forty characters anywhere, and `git cat-file blob`
  // returns the exact source that ran. The sha256 above identifies the same
  // bytes without a repository; both are recorded because each survives what
  // the other does not.
  lines.push('  generator blob       : ' + (p.contractGenerator && p.contractGenerator.blob
    ? p.contractGenerator.blob
    : 'none -- the generator is not inside a git checkout'));
  if (p.contractGenerator && p.contractGenerator.blob) {
    lines.push('                         `git cat-file blob ' +
      p.contractGenerator.blob.slice(0, 12) +
      '` retrieves the exact source that ran');
  }
  lines.push('  generator commit     : ' + (p.contractGenerator
    ? renderContractCommit(p.contractGenerator)
    : describeGeneratorCommit(p)));
  lines.push('  exact command        : ' + invocation.command);
  if (invocation.recreate) {
    lines.push('  where $BASELINE is   : ' + invocation.recreate);
  }
  lines.push('  analysed tree        : ' + invocation.appLabel);
  lines.push('  analysed tree HEAD   : ' + (p.appHead || '(not a git worktree)'));
  lines.push('  analysed source      : ' + p.analysedPaths.length + ' files, ' +
    p.analysedDigest);
  lines.push('  analysed source state: ' + describeAnalysedState(p));
  lines.push('  parity evidence      : ' + describeEvidenceProvenance(p));
  lines.push('  base commit          : ' + BASELINE_COMMIT +
    (p.atBaseline
      ? '  <-- the analysed tree IS the base commit, so the'
      : '  <-- the analysed tree is NOT the base commit, so the'));
  lines.push('                         baseline-calibrated self-checks are ' +
    (p.atBaseline ? 'ASSERTED' : 'reported as deltas'));
  lines.push('  node                 : ' + p.nodeVersion);
  lines.push('');
  lines.push('  WHAT IDENTIFIES THIS DOCUMENT\'S SUBJECT, and why there are four lines above');
  lines.push('  where a single commit hash would seem to do:');
  lines.push('');
  lines.push('    * "analysed tree HEAD" is the revision the analysed tree was checked out at.');
  lines.push('    * "analysed source state" says whether that revision still describes the');
  lines.push('      analysed BYTES, over the analysed files only -- this document is not one of');
  lines.push('      them, so writing it cannot make its own provenance stale.');
  lines.push('    * "analysed source" is a digest over exactly the files that were read, which');
  lines.push('      is checkable from the files themselves with no repository at all. It is the');
  lines.push('      claim that survives a rebase, a squash, or a clone that never received the');
  lines.push('      commit.');
  lines.push('    * "generator sha256" identifies the code that produced this, unconditionally.');
  lines.push('      "generator commit" is recorded only when the generator file matches its');
  lines.push('      last commit, and says so plainly when it does not, because a revision that');
  lines.push('      is not an object in this repository cannot be retrieved by a reader.');
  lines.push('');
  lines.push('  Re-run the exact command above to check this document against a tree; or run');
  lines.push('  it with --check, which regenerates in memory, compares, and exits 3 if the');
  lines.push('  committed document no longer describes the tree. --check normalizes the');
  lines.push('  "analysed tree HEAD" and "generator commit" lines above -- and the');
  lines.push('  `provenance-json` line, which carries both -- because each of them moves for');
  lines.push('  reasons that have nothing to do with what was analysed: a revision that');
  lines.push('  commit including the one that stores this document, and a commit identity whose');
  lines.push('  content is already compared through "generator sha256". Everything it does');
  lines.push('  compare is content-derived: every row, and the three digests.');
  lines.push('');
  lines.push('  No absolute path appears anywhere in this document. A worktree\'s location on');
  lines.push('  disk is specific to the machine it was generated on, so recording it would make');
  lines.push('  two correct runs differ for a reason that says nothing about the tree.');
  lines.push('');
  lines.push('  Everything below this block is deterministic: two runs over the same tree');
  lines.push('  produce byte-identical output. Nothing in this document records a wall clock,');
  lines.push('  a process id, a port or a path, so there is nothing left to differ.');
  lines.push('-->');
  return lines.join('\n');
}

/**
 * One cell summarizing the state of the evidence the behavioural rows depend
 * on. Reported in the same table as the code measurements, because "the
 * corpus has not been captured" is a measurement about this document's own
 * completeness and belongs where a reader is already looking.
 */
function describeEvidenceSummary(model) {
  if (!model.evidence.available) {
    return '`' + CORPUS_PATH + '` absent -- none of them can close';
  }
  var recorded = 0;
  var baselineOnly = 0;
  var pending = 0;
  var indirect = 0;
  var unlinked = 0;

  function tally(state) {
    if (state === EVIDENCE.RECORDED) {
      recorded++;
    } else if (state === EVIDENCE.BASELINE_ONLY) {
      baselineOnly++;
    } else if (state === EVIDENCE.PENDING) {
      pending++;
    } else if (state === EVIDENCE.INDIRECT) {
      indirect++;
    } else {
      unlinked++;
    }
  }

  REPLY_CHAIN_ROSTER.forEach(function (entry) {
    tally(evidenceStateOf(model.evidence, entry.scenario));
  });
  ANCHORED_SITES.forEach(function (site) {
    tally(evidenceStateOf(model.evidence, site.scenario));
  });
  Object.keys(model.streamSitesByController).forEach(function (name) {
    model.streamSitesByController[name].forEach(function (site) {
      tally(site.evidenceState);
    });
  });

  // Every state is named, including the two that are one step from closing.
  // Collapsing them would hide the distance a row still has to travel.
  var parts = [recorded + ' recorded (baseline + confirming replay)'];
  if (baselineOnly > 0) {
    parts.push(baselineOnly + ' baseline captured but not replayed');
  }
  if (pending > 0) {
    parts.push(pending + ' defined but not captured');
  }
  if (indirect > 0) {
    parts.push(indirect + ' route-level only (no branch-exact scenario)');
  }
  if (unlinked > 0) {
    parts.push(unlinked + ' with no scenario');
  }
  return parts.join(', ');
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
    ' `.type()`/`.bytes()`, ' + BASELINE_STREAM_SITES + ' stream sites, the ' +
    BASELINE_NON_REACTION_CATCHES + ' rejected non-reaction `.catch(` calls, and the ' +
    'eight-entry reply-chain roster -- each entry located by its **carrier symbol**, at the ' +
    'baseline line it records, in the category the analysis derives independently. Asserted ' +
    '**exactly** at `' + BASELINE_COMMIT + '`; reported as a delta elsewhere. | ' +
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
  out.push('| Non-reaction `.catch(` member calls rejected | ' + BASELINE_NON_REACTION_CATCHES +
    ' | ' + model.nonReactionMemberCalls.length + ' | invariant (a preserved quirk) |');
  out.push('| Function rows emitted (the conversion set) | ' + CONVERSION_SET.total + ' | ' +
    (model.routedHandlers + model.routedPreHandlerNames.length +
      model.inlinePreHandlers.length) + ' | invariant |');
  out.push('| Handlers and pre-handlers with a proven exit on every path | not measured at `' +
    BASELINE_COMMIT + '` | ' +
    model.handlers.filter(function (h) {
      return h.routed && h.analysis.alwaysDelivers;
    }).length + ' of ' + model.routedHandlers + ' routed handlers, ' +
    model.preHandlers.filter(function (pre) {
      return pre.routed && pre.analysis.alwaysDelivers;
    }).length + ' of ' + model.routedPreHandlerNames.length + ' routed pre-handlers' +
    ' | progress |');
  out.push('| Parity evidence for the ' + (REPLY_CHAIN_ROSTER.length + ANCHORED_SITES.length +
    model.streamSiteTotal) + ' behavioural rows | n/a | ' +
    describeEvidenceSummary(model) + ' | evidence |');
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


function renderPreamble(model) {
  var out = [];
  var atBaseline = model.provenance.atBaseline;
  out.push('# Conversion inventory');
  out.push('');
  out.push('One row per site an implementing agent must close to move this application from');
  out.push('the 2013 callback idiom to the hapi lifecycle contract. **There is no target row');
  out.push('count.** Rows are derived from the tree; nothing is padded to reach a number.');
  out.push('');
  out.push('## Which tree this describes, and what that makes it');
  out.push('');
  out.push('Every row below was computed from the tree named in the header block, and the');
  out.push('document is only ever a statement about that tree. The distinction is not');
  out.push('pedantic: the same generator over the base commit and over the delivered tree');
  out.push('produces two documents that look alike and mean opposite things.');
  out.push('');
  if (atBaseline) {
    out.push('**This run analysed the base commit `' + BASELINE_COMMIT + '`, so this is the');
    out.push('PLANNING view: the work to be done.** A row is open here because the site has not');
    out.push('been converted yet. It is not evidence about the delivered code, and it cannot be');
    out.push('cited as completion -- re-run the exact command in the header against the');
    out.push('delivered tree for that.');
  } else {
    out.push('**This run analysed the delivered tree, not the base commit, so this is the');
    out.push('COMPLETION view: what is actually closed and what is not.** A row is open here');
    out.push('for one of exactly two reasons, and the row states which: the site in the');
    out.push('delivered code has not reached its target, or -- for the row kinds whose');
    out.push('correctness is behavioural rather than textual -- the driven comparison that');
    out.push('settles it has not been completed. Those two are not interchangeable, and the');
    out.push('accounting under "Row totals" keeps them apart rather than adding them up:');
    out.push('reading a missing measurement as unfinished conversion work overstates what is');
    out.push('left to do, and reading it as finished overstates what has been proved.');
    out.push('Re-running the exact command in the header against a `git worktree` at `' +
      BASELINE_COMMIT + '` reproduces the');
    out.push('planning view, which is how the two are compared.');
  }
  out.push('');
  out.push('Both views are the same generator over different inputs, and `--check` proves the');
  out.push('committed document still matches the tree it claims. Nothing here is transcribed');
  out.push('by hand, and a hand edit would be lost on the next run.');
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
  out.push('The same reasoning rules out the two counts that look like adequate substitutes:');
  out.push('');
  out.push('- **A count of unreturned signalling calls.** An EMPTY `async (request, h)` has');
  out.push('  none -- no legacy signature, no stray `reply(`, nothing unreturned -- and returns');
  out.push('  `undefined` to a toolkit that converts it into `Boom.badImplementation`. So every');
  out.push('  handler and pre-handler row also carries a **proof of exit**: whether every path');
  out.push('  through the body ends in `return` or `throw`. A body that cannot be shown to');
  out.push('  leave stays open, and the row says which half is missing.');
  out.push('- **A count of legacy calls that disappeared.** For a reply chain or a stream site,');
  out.push('  the legacy syntax vanishing proves only that the syntax vanished. What a client');
  out.push('  received from a reply chain depended on which builder method ran last, and');
  out.push('  whether a stream still errors after the response began is a timing question. Both');
  out.push('  are settled by a driven request, so those rows name the corpus scenario that');
  out.push('  drives them and close on a driven COMPARISON -- a captured baseline and a');
  out.push('  confirming replay verdict against this tree -- rather than on absence. A');
  out.push('  baseline on its own records what the pre-migration code did, which is one side');
  out.push('  of that comparison.');
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
  out.push('| Done | `[x]` when this run measured the site to have reached its target, `[ ]` otherwise, with the reason in the row. Recomputed on every run: re-generating against a tree is how progress is demonstrated, and no box is ever set by hand. |');
  out.push('| Site | The carrier SYMBOL the row is anchored on, plus its coordinate in the analysed tree. Where another document cites a baseline coordinate, that coordinate is shown too, because a line number stops being an address once a file is edited. |');
  out.push('| Kind | One of: routed handler, routed pre-handler, inline pre-handler, promise chain, callback boundary, reply chain, stream site. |');
  out.push('| Current shape | What the code does **now**, measured -- not what it looks like. |');
  out.push('| Target disposition | The exact converted shape. Under R-d this is always the *preserved* behaviour, with one approved exception among these rows, labelled as such -- the migration approves two deviations in total and only one of them reaches a row here. |');
  out.push('');
  out.push('### What closes a row, by kind');
  out.push('');
  out.push('| Kind | Closes when |');
  out.push('| --- | --- |');
  out.push('| Routed handler, routed pre-handler, inline pre-handler | The signature is `(request, h)`; no `reply(` reference remains; **every path through the body DELIVERS a value or throws**; and the body does not RELY ON THE INTERCEPTION. Exiting is not enough: a path ending in a bare `return`, a statically `undefined` return, or a non-settling loop reaches hapi as `undefined`, which the toolkit converts into `Boom.badImplementation`. Reliance is about the mechanism being removed -- the interception substitutes a value only when the body returns `undefined` -- so a body that delivers on every path cannot reach it, and a signalling call whose value is discarded there is reported, instructs nothing, and does not hold the row open: it was discarded at baseline too. |');
  out.push('| Promise chain | Its value or settlement reaches a consumer AND its terminal link registers a reaction that produces a value -- or the value is deliberately discarded somewhere nothing could have depended on it. Five mechanisms deliver: `return`, `await`, `resolve(chain)`, an argument such as `promises.push(chain)`, and a capture whose name a later expression delivers. A reaction produces a value when it is a function literal in any argument slot, or a bare reference to `request.success` / `request.fail`, which now RETURN the toolkit response. A statement-position chain is deliberate when its carrier is proven to deliver on every path -- so the discarded value provably was not the response -- or when its carrier is not a lifecycle method at all. |');
  out.push('| Callback boundary | The callee is one the migration KEEPS in callback form, and its carrier is settled. Rules T-3 and T-5 divide the population: a Node-core callback API inside the hapi-facing surface must become its promise equivalent, warning or no warning, and stays OPEN until it does; anything else -- `lib/util/file.js`, `lib/util/store.js`, `lib/util/queues.js`, `lib/models/model.js`, a plugin API, a module-local helper -- has no promise form to await without pushing the boundary into the callee, which T-3 forbids, so it is finished in its current shape. The carrier half is the same one a discarded chain answers to. This population SHRINKS as work completes, because a converted site passes no callback literal and leaves it. |');
  out.push('| Reply chain, dead-301 branch site, unreturned bare `reply(` | The legacy construct is gone from its carrier, the declared target shape (where one can be declared) is present in it, **and** the corpus scenario that drives the site carries BOTH a captured baseline response AND a confirming replay verdict against this tree. A baseline alone records what the pre-migration code did, which is one half of a comparison. |');
  out.push('| Stream site | A scenario is pinned to **this branch** -- from the located reply chain that CONTAINS the site, or, for a site outside every located chain, from the single reply chain its carrier DECLARES, since a carrier with one declared branch has no other branch for the site to be on -- and that scenario carries a captured baseline plus a confirming replay. Whether completion and error timing survived is not visible in the text at all, and a sibling branch\'s result is silent about this one, which is why a carrier declaring two branches yields no pin. |');
  out.push('');
  out.push('The `Current shape` column for handlers and pre-handlers reports two measurements,');
  out.push('and both are needed because each misses what the other catches.');
  out.push('');
  out.push('The first is **delivery**: whether each signalling call\'s value reaches hapi. That');
  out.push('is not the same as a `return` in front of the call. A response is also delivered');
  out.push('when it settles the promise the method returns (`resolve(request.fail(err))` inside');
  out.push('a returned `new Promise`), when it is returned from a nested handler of a chain the');
  out.push('method returns, or when it is captured into a name a returning branch reads');
  out.push('(`var response = request.success(); ... return response;`). All three are counted as');
  out.push('delivery, and the row says which mechanism carried each call -- because counting');
  out.push('them as "unreturned" flagged 17 correctly converted handlers in an earlier run of');
  out.push('this generator, and a false flag sends a reader to fix code that is already right.');
  out.push('');
  out.push('The second is the **proof of delivery** described above -- which is asked');
  out.push('separately from the proof of exit, because the two come apart. `while (true) {}`');
  out.push('exits on every path and delivers nothing; `return;` does the same. Both are');
  out.push('reported distinctly from "no exit", since they need different fixes. It is');
  out.push('deliberately');
  out.push('conservative: a construct the analysis cannot show to exit is reported as not');
  out.push('exiting. The direction is chosen on cost -- a false "open" costs one look, a false');
  out.push('"closed" ships a 500 -- and a site that deliberately reproduces a baseline');
  out.push('non-settlement is expected to be recorded as such in `' + QUIRK_DOC + '`');
  out.push('rather than silently accepted here.');
  out.push('');
  out.push('This remains an analysis of TEXT, and it says so. It does not execute the');
  out.push('application, and for the two behavioural row kinds it does not pretend to: those');
  out.push('rows carry a scenario identifier and defer to it.');
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
  out.push('- It is **not itself evidence of parity**, and it does not close a behavioural row');
  out.push('  on its own authority. Whether a converted site behaves identically is decided by');
  out.push('  the request corpus (`test/parity/capture.js` and `replay.js`), the storage cases');
  out.push('  and the joi matrix. What this document does is name, per row, the scenario that');
  out.push('  settles it and report that scenario\'s state as read from');
  out.push('  `' + CORPUS_PATH + '`: recorded (both halves), captured-but-not-replayed,');
  out.push('  defined-but-not-yet-captured, route-level-only, or absent. A row');
  out.push('  whose evidence is pending stays open and says so; a row with no scenario at all');
  out.push('  says that too, because an unlinked site is a gap in the corpus rather than a');
  out.push('  finished piece of work.');
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
  // Both deviations are named, with their kinds: there are two, and which of
  // the two a row can be affected by is what a reader holding a row needs. The
  // authority for this wording is the closing paragraph of
  // docs/preserved-quirks.md Appendix A.
  out.push('| `' + QUIRK_DOC + '` | The measured baseline **outcome** of a quirk, and the ' +
    'precedence argument in full for each of the migration\'s **two** approved deviations ' +
    '(\u00a7' + DEVIATION_REGISTER_QUIRK_SECTION + ', a closed register). The two have ' +
    'different roles and this table does not collapse them: **deviation 1** (\u00a7' +
    DEVIATION_QUIRK_SECTION + '), the never-settling image-download branch that the target ' +
    'serves, is a **response** deviation and the only one a row in this checklist can be ' +
    'affected by -- it is the one row whose target changes observable behaviour; ' +
    '**deviation 2** (\u00a7' + AUDIT_DEVIATION_QUIRK_SECTION + ', reasoned in full in `' +
    DEFERRED_DEPENDENCY_DOC + '` \u00a7' + AUDIT_DEVIATION_DEFERRED_SECTION + '), the ' +
    'retained `marked` fork and its one named high advisory, is an **audit** deviation that ' +
    'no conversion row touches, because retaining the fork is what keeps rendered output ' +
    'identical. A row whose target reproduces a defect says so and cites the section. |');
  out.push('| `' + ERROR_EDGE_DOC + '` | The **status, payload, side effects and timing** of every changed error edge. Rows that are themselves error edges -- a chain carrying a `.catch(` link, an error-first callback, an unreturned `reply(err)` -- cite the per-file section that owns them. |');
  out.push('');
  out.push('Neither reference is decorative. R-d requires that a preserved defect be recorded');
  out.push('rather than fixed, and R-e requires that the error mapping survive unchanged; this');
  out.push('document would contradict both if it restated their content in its own words.');
  out.push('');
  out.push('**The quirk reference is resolved BEFORE a row\'s target action is composed, not');
  out.push('appended after it.** `' + QUIRK_DOC + '` Appendix A is the allow-list, and for a');
  out.push('site whose preserved outcome requires the body *not* to return -- to be left');
  out.push('unsettled, or to throw -- a generic mandate and a quirk pointer in one cell say');
  out.push('opposite things with the mandate leading. So a row on that allow-list carries a');
  out.push('**governing action** instead: it states what to do, names the generic mandate it');
  out.push('**replaces** or **qualifies**, says why that mandate is wrong there, and still cites');
  out.push('the section that owns the measured outcome. Rows where the mandate is compatible are');
  out.push('unchanged, and one allow-list entry is the inverse case -- at');
  out.push('`lib/controllers/trinket.js:375` the statement genuinely must change to preserve the');
  out.push('outcome, which is why this is an allow-list and not a blanket "change nothing".');
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
  out.push('A **promise constructor is not a boundary**, and the exclusion is tested on the');
  out.push('callee text rather than on the token before it: `return new Promise(function () {})`');
  out.push('at baseline `lib/controllers/trinket.js:876` was classified as an empty-parameter');
  out.push('completion callback because the walk that finds the callee absorbs the `new`');
  out.push('keyword into it, so a test on the preceding token never fired. `new Promise` is a');
  out.push('promise being constructed, whose settlement is the point; the boundary this section');
  out.push('tracks is a call that takes a completion callback.');
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
  // Resolved by EXPORT IDENTITY: the anchor names a symbol, and the symbol is
  // looked up among the pre-handler declarations this run measured. A tree
  // that no longer declares it says so, rather than pointing at whichever
  // pre-handler happens to come first.
  var exemplarSymbol = TARGET_IDIOM_ANCHORS.filter(function (anchor) {
    return anchor.symbol;
  })[0];
  if (exemplarSymbol) {
    var exemplar = model.preHandlerDeclarations.filter(function (declared) {
      return declared.name === exemplarSymbol.symbol;
    })[0];
    if (exemplar) {
      out.push('In the analysed tree the pre-handler exemplar `' + exemplarSymbol.symbol +
        '` sits at `' + HELPERS_PATH + ':' + exemplar.line + '`, declared `' +
        signaturePhrase(exemplar) + '`.');
    } else {
      out.push('The analysed tree declares no pre-handler named `' + exemplarSymbol.symbol +
        '`, so the exemplar above is a baseline coordinate only.');
    }
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
        ' | ' + cell(composeTarget({
          kind: 'handler',
          file: h.file,
          enclosing: h.name,
          generic: describeHandlerTarget(h, false),
          lead: describeHandlerLead(h, false)
        })) + ' |');
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
  // This section renders 2a AND 2b, so the header counts both. A header reading
  // "8 rows (8 closed)" above ten rows, two of them open, contradicts the table
  // under it and the row-totals census, which counts the branch sites
  // separately for exactly this reason.
  var deadRedirectRows = ANCHORED_SITES.filter(function (site) {
    return site.kind === 'dead-301';
  });
  var deadRedirectClosed = deadRedirectRows.filter(function (site) {
    return anchoredSiteState(model, site).closed;
  }).length;

  out.push('## 2. Routed pre-handlers -- ' +
    pluralize(routed.length + deadRedirectRows.length, 'row') + ' (' +
    (closed + deadRedirectClosed) + ' closed): ' + routed.length +
    ' pre-handler functions plus ' +
    pluralize(deadRedirectRows.length, 'dead 301 branch site') + ' inside two of them');
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
      ' | ' + cell(composeTarget({
        kind: 'pre-handler',
        file: HELPERS_PATH,
        enclosing: p.name,
        generic: describeHandlerTarget(p, true),
        lead: describeHandlerLead(p, true)
      })) + ' |');
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
    var state = anchoredSiteState(model, s);
    out.push('| ' + box(state.closed) +
      ' | ' + cell(anchoredSiteLabel(model, s)) +
      ' | routed pre-handler' +
      ' | ' + cell(s.current +
        (state.stillLegacy
          ? '; STILL PRESENT in `' + s.enclosing + '` in this tree'
          : '; the legacy construct is gone from `' + s.enclosing + '`')) +
      ' | ' + cell(s.target + anchoredQuirkRef(s) +
        describeEvidence(model.evidence, s.scenario ? [s.scenario] : [],
          'the pre value this row claims')) + ' |');
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

/** Do two link sequences match, in order? */
function sameLinks(a, b) {
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return a.every(function (name, i) {
    return name === b[i];
  });
}

/**
 * Locate one roster entry in the analysed tree BY SYMBOL, not by line.
 *
 * A line number is not an address once a file has been edited: the reply
 * chains all move during the conversion, so an anchor on `file` + `startLine`
 * reports "not found at its baseline coordinates" for every one of them, and a
 * renderer reads that as "converted" and ticks it.
 *
 * The anchor is therefore the carrier SYMBOL (the exported handler or the
 * module-scope function that contains the site), the chain's link sequence,
 * and, where a carrier holds two chains of the same shape, their order within
 * it. Returned: the legacy chain if it is still there, the converted chain if
 * the target shape is, and the roster's declared target shape.
 */
function locateRosterEntry(model, entry) {
  function inCarrier(root, links) {
    return model.replyChains.filter(function (chain) {
      return chain.file === entry.file &&
        chain.root === root &&
        chain.enclosing === entry.carrier &&
        sameLinks(chain.links, links);
    }).sort(function (a, b) {
      return a.startLine - b.startLine;
    });
  }

  var legacyMatches = inCarrier('reply', entry.links);
  var legacy = legacyMatches[(entry.ordinal || 1) - 1] || null;

  var target = null;
  if (entry.targetShape) {
    var targetMatches = inCarrier(entry.targetShape.root, entry.targetShape.links);
    target = targetMatches[(entry.ordinal || 1) - 1] || null;
  }

  return {
    legacy: legacy,
    target: target,
    // A carrier that cannot be found at all is a different failure from a
    // chain that has been converted, and the row has to say which.
    carrierPresent: model.handlers.some(function (h) {
      return h.file === entry.file && h.name === entry.carrier;
    }) || (model.namedFunctionsByFile[entry.file] || []).some(function (fn) {
      return fn.name === entry.carrier;
    })
  };
}

/**
 * Whether a roster row closes.
 *
 * Three conditions, and the third is the one that makes this row evidence
 * rather than a syntax check:
 *
 *   1. the legacy `reply(`-rooted chain is gone from its carrier;
 *   2. where the roster declares a target SHAPE -- the never-settling chain
 *      and the four header-resolved ones -- that shape is present in the same
 *      carrier. A builder-returned chain declares none, because what the
 *      builder emitted is not inferable from text;
 *   3. the corpus scenario that drives the site carries a captured baseline
 *      response AND a replay verdict confirming the target against it. Both
 *      halves: a baseline alone is a record of the pre-migration behaviour,
 *      and closing a row on it asserts a match that nothing performed.
 *
 * Condition 3 is what holds a row open while the corpus defines its scenario
 * but holds no captured response for it: "the legacy syntax is gone" is not a
 * statement about what the route now serves.
 */
function rosterRowState(model, entry) {
  var located = locateRosterEntry(model, entry);
  var evidenceState = evidenceStateOf(model.evidence, entry.scenario);
  var structural = !located.legacy && (!entry.targetShape || !!located.target);
  return {
    located: located,
    evidenceState: evidenceState,
    structural: structural,
    closed: structural && evidenceState === EVIDENCE.RECORDED
  };
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

/**
 * Whether an anchored site's row closes.
 *
 * Same two halves as a roster row, for the same reason. The legacy construct
 * disappearing is structural; what the route now DOES -- a mapped error
 * reaching the same funnel with the same status, a pre-handler contributing
 * `null` where the baseline built a discarded 301 -- is behaviour, and
 * behaviour is decided by the scenario that drives it. A site with no scenario
 * reports having none rather than closing on the syntax.
 */
function anchoredSiteState(model, site) {
  var stillLegacy = anchoredSiteStillLegacy(model, site);
  var evidenceState = evidenceStateOf(model.evidence, site.scenario);
  return {
    stillLegacy: stillLegacy,
    evidenceState: evidenceState,
    closed: !stillLegacy && evidenceState === EVIDENCE.RECORDED
  };
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
 * Site label for a roster row: the baseline coordinate every other document
 * cites, the carrier symbol that is the actual anchor, and the coordinate in
 * the analysed tree of whichever chain was located there.
 */
function rosterSiteLabel(entry, state) {
  var label = '`' + entry.file + ':' + entry.lines + '` `' + entry.carrier + '`';
  if (state.located.legacy) {
    var chain = state.located.legacy;
    var span = chain.startLine === chain.endLine
      ? String(chain.startLine)
      : chain.startLine + '-' + chain.endLine;
    return label + ' (legacy chain still present, now `:' + span + '`)';
  }
  if (state.located.target) {
    var t = state.located.target;
    var targetSpan = t.startLine === t.endLine
      ? String(t.startLine)
      : t.startLine + '-' + t.endLine;
    return label + ' (converted; target chain at `:' + targetSpan + '`)';
  }
  if (!state.located.carrierPresent) {
    return label + ' (**carrier not found in the analysed tree** -- the anchor is a symbol, ' +
      'so this is a missing or renamed function, not a moved line)';
  }
  return label + ' (legacy chain gone; no declared target shape to locate)';
}

/**
 * How the corpus currently treats the approved deviation -- stated in the
 * tense the artifact supports.
 *
 * The scenario declares an expected timeout at baseline and a 200 stream
 * response after conversion, with `replayDisposition: approved-change` so the
 * difference reads as an approved change rather than a failure. That is the
 * DEFINITION. Whether the baseline response has been captured is a separate
 * fact, and until it has, the comparison is prospective: nothing has been
 * recorded, and saying otherwise would present a plan as a measurement.
 */
function describeDeviationCorpusState(evidence, entry) {
  if (!evidence.available) {
    return '`' + CORPUS_PATH + '` is not present in the analysed tree, so there is no ' +
      'scenario, no baseline result and no target result for this deviation here. The ' +
      'comparison this row depends on has to be built before it can be cited.';
  }
  var scenario = evidence.scenarios[entry.scenario];
  if (!scenario) {
    return 'no scenario named `' + entry.scenario + '` exists in `' + CORPUS_PATH + '`, so ' +
      'the deviation is not driven by anything and no comparison can be made. The row cannot ' +
      'close until one covers it.';
  }
  var definition = 'the corpus DEFINES the comparison: scenario `' + scenario.id +
    '` drives `' + scenario.route + '` with `intent: ' + scenario.intent + '`' +
    (scenario.replayDisposition
      ? ' and `expectedDeviation.replayDisposition: ' + scenario.replayDisposition + '`'
      : '') + ', so a baseline timeout against a target 200 stream response is expected to ' +
    'read as an approved change rather than a failure.';
  // "Measurement" is rendered from the SAME predicate that closes the row --
  // a captured baseline AND a confirming replay verdict -- and from nothing
  // weaker. The timeout-to-200 claim is a claim about two observations, so a
  // baseline alone cannot support it: that would describe what the OLD code
  // did and call it a comparison.
  var state = evidenceStateOf(evidence, entry.scenario);
  if (state === EVIDENCE.RECORDED) {
    return definition + ' Both halves exist: the baseline response has been captured on ' +
      'that scenario AND a replay against this tree recorded a confirming verdict (`' +
      scenario.replay.verdict + '`), so the timeout-to-200 comparison is a measurement.';
  }
  if (state === EVIDENCE.BASELINE_ONLY) {
    return definition + ' The baseline response HAS been captured -- but **no replay result ' +
      'for the target is recorded**, so only the pre-migration half of the comparison ' +
      'exists. A baseline says what the unmigrated code did; it cannot say that this tree ' +
      'now serves the 200 stream response. The timeout-to-200 claim stays PROSPECTIVE and ' +
      'the row stays open until `test/parity/replay.js` records a confirming verdict.';
  }
  return definition + ' **No baseline response has been captured** -- the scenario\'s ' +
    '`baseline` is null, and the corpus reports `summary.captured: false` with ' +
    '`baselinesPending: ' + evidence.pending + '`. So the timeout-to-200 comparison is at ' +
    'present a PROSPECTIVE description of what capture and replay are expected to show, not ' +
    'a recorded result, and this row stays open until it is one.';
}

/** The structural half of a roster row's current shape, measured in this tree. */
function rosterStructuralNote(entry, state) {
  if (state.located.legacy) {
    return '; STILL PRESENT in `' + entry.carrier + '` in this tree';
  }
  if (entry.targetShape && state.located.target) {
    return '; the legacy chain is gone from `' + entry.carrier + '` and the declared target ' +
      '`h.response(...).' + entry.targetShape.links.join('().') + '()` is present';
  }
  if (entry.targetShape) {
    return '; the legacy chain is gone from `' + entry.carrier + '` but the declared target ' +
      '`h.response(...).' + entry.targetShape.links.join('().') + '()` was NOT found there';
  }
  return '; the legacy chain is gone from `' + entry.carrier + '`, and this category declares ' +
    'no target shape -- what the builder emitted is not inferable from the text, so the ' +
    'outcome is settled by measurement alone';
}

/**
 * Site label for an anchored row: the baseline coordinate always, plus the
 * current coordinate when the site is still present in the analysed tree.
 * Both are shown because the baseline coordinate is the one every other
 * document cites, and the current one is the one a reader has to open.
 */
function anchoredSiteLabel(model, site) {
  var label = '`' + site.file + ':' + site.line + '` `' + site.enclosing + '`';
  var current = anchoredSiteCurrentLine(model, site);
  if (current === null) {
    // "converted" is deliberately not the word: the legacy construct being
    // absent is the structural half of this row, and the row closes on the
    // behavioural half as well.
    return label + ' (baseline coordinate; the legacy construct is no longer in this tree)';
  }
  if (current === site.line) {
    return label;
  }
  return label + ' (now `:' + current + '`)';
}

function renderInlinePreHandlerRows(model) {
  var out = [];
  var inlineClosed = model.inlinePreHandlers.filter(function (inline) {
    return inline.signature === 'toolkit' && !inline.analysis.usesReply &&
      inline.analysis.alwaysDelivers;
  }).length;
  out.push('## 3. Inline pre-handler -- ' +
    pluralize(model.inlinePreHandlers.length, 'row') + ' (' + inlineClosed + ' closed)');
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

// The delivery mechanisms section 4 tabulates, in the order the table prints
// them. Named here rather than inline so the self-check and the renderer
// partition the delivered rows the same way: a mechanism recognized by
// chainDeliveryOf() and missing from this list would leave the table summing
// to less than the delivered total, which is what the check asserts against.
var CHAIN_DELIVERY_MECHANISMS = Object.freeze([
  'return', 'await', 'settlement-argument', 'argument', 'capture', 'reaction-settlement'
]);

/**
 * Counts the chain population by delivery mechanism, disposition state and
 * terminal reaction.
 *
 * One function so the rendered policy and the self-check that validates it
 * cannot count differently -- which is the failure mode this whole area is
 * being repaired for.
 *
 * @param {Object[]} chains model.promiseChains
 * @returns {{byDelivery: Object, byState: Object, helpers: Object,
 *            settleInReaction: number, noReaction: number, delivered: number}}
 */
function chainDeliveryCensus(chains) {
  var byDelivery = Object.create(null);
  var byState = Object.create(null);
  var helpers = Object.create(null);
  var settleInReaction = 0;
  var noReaction = 0;
  var delivered = 0;

  chains.forEach(function (chain) {
    var state = chain.disposition ? chain.disposition.state : 'unclassified';
    byState[state] = (byState[state] || 0) + 1;
    if (chain.delivered) {
      delivered++;
      var key = CHAIN_DELIVERY_MECHANISMS.indexOf(chain.delivery) > -1
        ? chain.delivery
        : 'reaction-settlement';
      byDelivery[key] = (byDelivery[key] || 0) + 1;
    }
    if (chain.settlesInReaction) {
      settleInReaction++;
    }
    if (chain.terminalReactionKind === 'response-helper-reference' && chain.terminalHelper) {
      helpers[chain.terminalHelper] = (helpers[chain.terminalHelper] || 0) + 1;
    }
    if (!chain.terminalDelivers) {
      noReaction++;
    }
  });

  return {
    byDelivery: byDelivery,
    byState: byState,
    helpers: helpers,
    settleInReaction: settleInReaction,
    noReaction: noReaction,
    delivered: delivered
  };
}

/**
 * The section-4 policy, DERIVED from the disposition model rather than written
 * beside it.
 *
 * This block was prose, and prose beside a classifier drifts from it in one
 * direction: the classifier is changed because it was wrong, and the paragraph
 * that describes it is not. It said a chain closes only when its value is
 * "`return`ed or `await`ed", and that a bare `.catch(request.fail)` "produces
 * nothing the handler returns" -- both true of the first implementation and
 * both contradicted by the rows underneath them, which close 131 chains
 * through five delivery mechanisms and count the bare response-helper
 * reference as producing the response. A reader had a policy and a table that
 * disagreed, in the document that is supposed to settle such questions.
 *
 * So every rule stated here is stated with the count of rows it decides in
 * THIS tree, taken from the same chains the table renders. A rule that decides
 * nothing says so, which is how a reader can tell a policy that has gone stale
 * from one that is merely not exercised.
 *
 * @param {Object} model the analysed model
 * @returns {string[]} markdown lines
 */
function chainPolicyLines(model) {
  var census = chainDeliveryCensus(model.promiseChains);
  var out = [];
  var settleInReaction = census.settleInReaction;
  var noReaction = census.noReaction;
  var helpers = census.helpers;

  var count = function (key) {
    return census.byDelivery[key] || 0;
  };
  var stateCount = function (key) {
    return census.byState[key] || 0;
  };

  out.push('One row per chain. AAP \u00a70.4.1 states the requirement this section measures:');
  out.push('after conversion each chain must be delivered **exactly once per path**, because');
  out.push('"neither a returned-but-unawaited chain nor an awaited-but-unreturned one is');
  out.push('visible in a signature count". A row closes on one of two settled dispositions,');
  out.push('and the `Current shape` and `Target disposition` columns name which one it is.');
  out.push('');
  out.push('**DELIVERED -- ' + stateCount('delivered') + ' rows.** The chain\'s value or its');
  out.push('settlement reaches a consumer, AND its terminal link registers a reaction that');
  out.push('produces a value. Delivery is not one mechanism: this codebase composes work');
  out.push('through ' + CHAIN_DELIVERY_MECHANISMS.length +
    ', and a row names the one it uses.');
  out.push('');
  out.push('| Delivery mechanism | Rows | What it looks like |');
  out.push('| --- | --- | --- |');
  out.push('| `return` | ' + count('return') + ' | `return chain.then(...)` |');
  out.push('| `await` | ' + count('await') + ' | `await chain.then(...)` |');
  out.push('| settlement argument | ' + count('settlement-argument') +
    ' | `resolve(chain)` inside a `new Promise` executor -- the chain\'s value becomes ' +
    'the settled value |');
  out.push('| call argument | ' + count('argument') +
    ' | `promises.push(chain)` -- handed to a consumer that awaits it later |');
  out.push('| transitive capture | ' + count('capture') +
    ' | `promise = chain`, bound to a name a later expression delivers. Resolved to a ' +
    'fixpoint, so a name delivered by a delivered name counts |');
  out.push('| reaction settlement | ' + count('reaction-settlement') +
    ' | the chain settles the carrier\'s promise from INSIDE one of its own reactions, so ' +
    'the expression itself has nothing left to return |');
  out.push('');
  out.push('Those columns sum to the ' + census.delivered +
    ' chains whose value leaves the expression, which is');
  out.push('asserted rather than asked of the reader: a mechanism added to the classifier and');
  out.push('not to this table would make the section\'s own arithmetic fail before the');
  out.push('document is written. ' + stateCount('delivered') + ' of those ' + census.delivered +
    ' also have a terminal link that');
  out.push('produces a value, which is what closes the row; the other ' +
    stateCount('delivered-into-nothing') + ' are the');
  out.push('delivered-into-nothing rows below.');
  out.push(settleInReaction + ' chains carry a settling reaction in total -- the ' +
    count('reaction-settlement') + ' counted under');
  out.push('reaction settlement above, plus the ones that also leave by one of the earlier');
  out.push('mechanisms and are counted there instead.');
  out.push('');

  var helperNames = Object.keys(helpers).sort();
  if (helperNames.length > 0) {
    out.push('**A terminal link passing a BARE REFERENCE to a response helper produces the');
    out.push('value.** `request.success` and `request.fail` RETURN a toolkit response, so a');
    out.push('chain ending `.catch(request.fail)` resolves to that response and a `return` in');
    out.push('front of it delivers it. That is the shape AAP \u00a70.3.1 singles out as the');
    out.push('correct one, and it occurs here as ' + helperNames.map(function (name) {
      return helpers[name] + ' terminal reference(s) to `' + name + '`';
    }).join(' and ') + '.');
    out.push('');
    out.push('An earlier revision of this section asserted the opposite -- that such a link');
    out.push('"reads as handled and produces nothing the handler returns" -- and the classifier');
    out.push('behind it reported every one of those rows as open. Both were wrong in the');
    out.push('safe-looking direction. The `Current shape` column now states per row that the');
    out.push('bare reference resolves to the toolkit response.');
    out.push('');
  }

  out.push('**DELIBERATELY DISCARDED -- ' +
    (stateCount('discarded-by-design') + stateCount('discarded-outside-lifecycle')) +
    ' rows.** The chain is in statement position, so its');
  out.push('value is discarded, and nothing could have depended on it. A discard is');
  out.push('intentional for one of exactly two reasons, and the row states which:');
  out.push('');
  out.push('- **' + stateCount('discarded-by-design') + ' rows** -- the carrier is a lifecycle');
  out.push('  method PROVEN to deliver on every path, so the discarded value provably was not');
  out.push('  the response. The discard is fire-and-forget timing, and R-d preserves it. Two');
  out.push('  are mandated by rule T-5 in as many words: the');
  out.push('  `fs.promises.unlink(...).catch(() => {})` sites.');
  out.push('- **' + stateCount('discarded-outside-lifecycle') + ' rows** -- the carrier is not');
  out.push('  a lifecycle method at all. Rule T-3 places no delivery obligation there, so the');
  out.push('  discard is the helper\'s own timing, preserved under R-d.');
  out.push('');
  out.push('**A row stays OPEN in exactly two states**, and the row prints the one it is in:');
  out.push('');
  out.push('- **' + stateCount('discarded-in-unproven-carrier') + ' rows** -- discarded inside');
  out.push('  a lifecycle method whose own delivery is NOT proven. There the discarded value');
  out.push('  may be the response on the path that does not deliver, so section 1\'s row for');
  out.push('  the carrier has to close first.');
  out.push('- **' + stateCount('delivered-into-nothing') + ' rows** -- delivered into a');
  out.push('  terminal link that produces nothing (' + noReaction + ' chains have such a');
  out.push('  terminal). What reaches hapi is then whatever the previous link resolved to.');
  out.push('');
  out.push('What happens INSIDE the links -- a `reply(...)` becoming a returned toolkit');
  out.push('response -- is the enclosing function\'s row in section 1, not this one. Splitting');
  out.push('it that way keeps each site closable by one person looking at one thing.');

  return out;
}

function renderPromiseChainRows(model) {
  var out = [];
  var chains = model.promiseChains;
  var closed = chains.filter(isChainClosed).length;

  out.push('## 4. Promise chains -- ' + pluralize(chains.length, 'row') +
    ' (' + closed + ' closed)');
  out.push('');
  chainPolicyLines(model).forEach(function (line) {
    out.push(line);
  });
  out.push('');
  out.push('A `.then(` / `.catch(` / `.finally(` call is admitted as a chain link only when its');
  out.push('STRUCTURE is a promise reaction: a receiver that is itself a call or an index, or a');
  out.push('plain binding receiving a function-shaped argument. The name alone is not enough,');
  out.push('and the difference is accounted for here rather than left to a reader who greps');
  out.push('`.catch(` and finds more hits than rows:');
  out.push('');
  if (model.nonReactionMemberCalls.length === 0) {
    out.push('- This tree contains no `.then(`/`.catch(` call that the structural test rejects.');
  } else {
    model.nonReactionMemberCalls.forEach(function (site) {
      out.push('- `' + site.file + ':' + site.line + '`' +
        (site.enclosing ? ' `' + site.enclosing + '`' : '') + ' -- `' + site.receiver +
        '.' + site.name + '(...)` takes an object literal on a plain receiver. It is **not** a');
      out.push('  promise reaction: the member does not exist on `' + site.receiver + '`, so the');
      out.push('  call throws `TypeError` and the route catch-all answers 500. That is a');
      out.push('  preserved baseline outcome owned by `' + QUIRK_DOC + '`, and an error edge');
      out.push('  rather than a chain -- reading it as one produced a row describing a chain');
      out.push('  that is not there and a target proposing to wrap an object literal in a');
      out.push('  function.');
    });
  }
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
        ' | ' + cell(composeTarget({
          kind: 'chain',
          file: c.file,
          enclosing: c.enclosing,
          generic: describeChainTarget(c),
          trailing: isErrorEdge ? errorEdgeRef(c.file) : ''
        })) + ' |');
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
 * A promise-chain row closes on its settled DISPOSITION, computed once in
 * `resolveChainDispositions` and carried on the chain: either the chain's
 * value or settlement reaches a consumer through one of the five mechanisms
 * this tree uses and its terminal reaction produces a value, or its value is
 * deliberately discarded somewhere nothing could have depended on it.
 *
 * What happens INSIDE the links -- a `reply(...)` becoming a returned toolkit
 * response -- is the enclosing handler's row, not this one. Splitting it that
 * way keeps each site closable by one person looking at one thing.
 */
function isChainClosed(chain) {
  return chain.disposition ? chain.disposition.closed : false;
}
// ---------------------------------------------------------------------------
// RUNTIME-EVIDENCE ROWS, AND WHY SOURCE SHAPE CANNOT CLOSE THEM
// ---------------------------------------------------------------------------
// Two categories of row in this document state, in the document's own words,
// that they "depend on that evidence outright, which is why their boxes are
// never ticked by analysis alone": the three BUILDER-RETURNED reply chains and
// all seventeen STREAM sites.
//
// That sentence was true as a policy and false as a description. The
// reply-chain box was computed as `box(!stillLegacy)` - ticked as soon as the
// legacy `reply(...)` chain stopped appearing in the source - so a
// current-tree run ticked all three builder-returned rows and asserted that
// their status, content type and body had been "captured before conversion".
// Nothing had been captured. The document therefore contradicted its own
// evidence policy two hundred lines apart, which is the same false-evidence
// defect it exists to prevent elsewhere.
//
// The rule: a row whose TARGET is a measurement rather than a construction
// cannot be closed by reading the source, because the source cannot tell you
// what the measurement was. Converting the site is necessary and is reported
// ("converted in this tree"); it is not sufficient, and the box stays open
// until linked evidence exists for it.
//
// A stream row's target is completion and error TIMING, which no static read
// establishes either, so it takes the same rule.
//
// THERE IS EXACTLY ONE PREDICATE FOR THAT QUESTION, and it lives at
// `runtimeEvidenceAvailable(model)` in the self-check section. An earlier
// revision declared a SECOND function of the same name here -- an
// argumentless `return false` -- alongside a `isReplyChainRowClosed(entry,
// stillLegacy)` helper that called it. Hoisting made the later declaration
// win for every caller, so the argumentless call passed no model and the
// helper's builder-returned branch was permanently false: the seam could
// never learn to read delivered evidence, whatever the corpus held. Two
// declarations of one predicate is the defect, not the `false`.
//
// The helper went with it rather than being repaired, because it was a
// LOOSER duplicate of the live rule and nothing called it: it closed the
// never-settling and header-resolved rows on source shape alone, while
// `rosterRowState()` -- the authority the roster renderer actually uses --
// requires a captured baseline AND a confirming replay for every category.
// Wiring the duplicate in would have loosened five rows onto evidence that
// does not exist. `rosterRowState()` decides a reply-chain row; nothing else
// does.

function describeChainCurrent(chain) {
  var parts = [];
  parts.push(chain.linkCount + '-link chain `.' + chain.linkNames.join('().') + '()`');

  if (chain.returned) {
    parts.push('currently RETURNED');
  } else if (chain.awaited) {
    parts.push('currently AWAITED');
  } else if (chain.delivered) {
    parts.push('currently ' + chainDeliveryPhrase(chain));
  } else {
    parts.push('currently in statement position -- its value is discarded' +
      (chain.prefix ? ' (preceded by `' + chain.prefix + '`)' : ''));
  }

  if (chain.terminalReactionKind === 'response-helper-reference') {
    parts.push('terminal `.' + chain.terminalName + '(' + chain.terminalArg +
      ')` passes a BARE REFERENCE to `' + chain.terminalHelper +
      '`, which returns the toolkit response, so the chain resolves to it');
  } else if (!chain.terminalDelivers) {
    parts.push('terminal `.' + chain.terminalName + '(' + chain.terminalArg +
      ')` registers no reaction that produces a value');
  }

  parts.push('head ' + code(chain.head));
  return parts.join('; ');
}

function describeChainTarget(chain) {
  var disposition = chain.disposition || chainDisposition(chain);

  if (!disposition.closed) {
    if (disposition.state === 'delivered-into-nothing') {
      return 'Give the terminal link a reaction that produces the value: ' +
        '`.' + chain.terminalName + '(function (err) { return /* the response */; })` or a ' +
        'reference to a helper that returns one. Measured state: ' + disposition.reason + '.';
    }
    return 'Deliver this chain exactly once on the path that needs it -- return it, await it, ' +
      'settle the carrier\'s promise with it, or hand it to a consumer that does. Measured ' +
      'state: ' + disposition.reason + '.';
  }

  if (disposition.state === 'discarded-by-design' ||
      disposition.state === 'discarded-outside-lifecycle') {
    return 'PRESERVE AS IT STANDS -- fire-and-forget, and that timing is the target. ' +
      disposition.reason.charAt(0).toUpperCase() + disposition.reason.slice(1) +
      '. Do not await it and do not attach a handler that reports an error the baseline ' +
      'swallowed: either would change observable behaviour.';
  }

  return 'Already delivered (' + disposition.reason + '), and its terminal reaction produces ' +
    'the value. Nothing further is required of this site: what remains is that no branch ' +
    'inside the links returns nothing, which the enclosing function\'s own row proves.';
}

// The generic callback-boundary action, split at the point where a preserved
// outcome can contradict it. The LEAD says where the `await` goes and that the
// baseline's error handling is preserved -- neither of which a quirk ever
// overrides. The MANDATE goes on to say that every path continues with a
// result, which is exactly what a route deliberately left unsettled must not
// do, so a governed row replaces it (see composeTarget).
var CALLBACK_TARGET_LEAD = 'Create the `await` AT THIS CALL SITE inside the converted ' +
  'handler, not in the callee, and preserve the baseline\'s error handling exactly -- ' +
  'swallowed stays swallowed, fire-and-forget stays fire-and-forget.';

var CALLBACK_TARGET_MANDATE = 'Create the `await` AT THIS CALL SITE inside the converted ' +
  'handler: await the promise form (or a promisified wrapper) and continue with its ' +
  'result. Do not push the boundary into the callee. Preserve the baseline\'s error ' +
  'handling exactly -- swallowed stays swallowed, fire-and-forget stays fire-and-forget.';

/**
 * The target for a boundary the migration KEEPS.
 *
 * Not the conversion mandate: awaiting a callee that has no promise form means
 * giving it one, which pushes the promise boundary past the lifecycle method
 * and is precisely what rule T-3 forbids. So the row states that the site is
 * settled and what would break if it were "finished" anyway.
 */
function describeKeptBoundaryTarget(cb) {
  if (cb.disposition.state === 'scheduling-primitive') {
    return 'LEAVE AS IT STANDS. ' + cb.disposition.reason.charAt(0).toUpperCase() +
      cb.disposition.reason.slice(1) + '. The callback body\'s own contents are covered by ' +
      'the rows for whatever it contains.';
  }
  return 'LEAVE THE INTERFACE AS IT STANDS -- this boundary is settled, not pending. ' +
    cb.disposition.reason.charAt(0).toUpperCase() + cb.disposition.reason.slice(1) +
    '. Do not promisify the callee to create an `await` here: rule T-3 puts the promise ' +
    'boundary at the lifecycle method and no deeper, and the baseline\'s error handling ' +
    'inside the callback is the target -- swallowed stays swallowed, fire-and-forget stays ' +
    'fire-and-forget.';
}

function renderCallbackRows(model) {
  var out = [];
  var rows = model.callbackBoundaries;
  var closed = rows.filter(isCallbackClosed).length;

  var resolvedSinceBaseline = BASELINE_CALLBACK_BOUNDARIES - rows.length;
  out.push('## 5. Callback boundaries -- ' + pluralize(rows.length, 'row') +
    ' (' + closed + ' closed)');
  out.push('');
  out.push('**A CONVERTED callback boundary ceases to exist**, so this population shrinks as');
  out.push('work completes: replacing `util.f(x, function (err, r) { ... })` with `await`');
  out.push('removes the callback literal, and the row with it. Baseline: **' +
    BASELINE_CALLBACK_BOUNDARIES + '**. This tree: **' + rows.length + '**' +
    (resolvedSinceBaseline > 0
      ? ', so ' + resolvedSinceBaseline + ' boundar' +
        (resolvedSinceBaseline === 1 ? 'y has' : 'ies have') + ' been converted away.'
      : resolvedSinceBaseline === 0
        ? ' -- none converted away yet.'
        : '. That is MORE than baseline, which needs explaining.'));
  out.push('');
  out.push('**A remaining boundary is not by itself unfinished work, and the `Done` box says');
  out.push('which it is.** Rules T-3 and T-5 divide this population, and the division is the');
  out.push('whole content of the box:');
  out.push('');
  out.push('- **T-5 -- must convert, box OPEN.** A Node-core callback API inside the');
  out.push('  hapi-facing surface becomes its promise equivalent *whether or not it emits a');
  out.push('  deprecation warning*: AAP \u00a70.6.4 measured `util.promisify(fs.writeFile)`,');
  out.push('  callback `fs.stat` and `fs.unlink` as silent on Node 22 and converts them');
  out.push('  anyway. `rimraf` and `mkdirp` count as the same thing, and converting them is');
  out.push('  what removes those packages.');
  out.push('- **T-3 -- keeps its callback interface, box CLOSED.** The promise boundary sits');
  out.push('  AT the lifecycle method and no deeper, so `lib/util/file.js`,');
  out.push('  `lib/util/store.js`, `lib/util/queues.js` and `lib/models/model.js` keep their');
  out.push('  callback interfaces even though controllers call them directly. There is no');
  out.push('  promise form to await without pushing the boundary into the callee, which T-3');
  out.push('  forbids -- so such a site is finished in its current shape.');
  out.push('- **Node-core but not a completion callback, box CLOSED.** `process.nextTick` and');
  out.push('  `setTimeout` schedule work rather than report an outcome. T-5 does not reach');
  out.push('  them and converting one would move when the work runs, which is a timing change');
  out.push('  (R-d).');
  out.push('');
  out.push('The second half of a closed box is the CARRIER. A boundary hands its own value to');
  out.push('the callee, so the response has to come from somewhere else -- and "somewhere');
  out.push('else" is established only where the enclosing lifecycle method is PROVEN to');
  out.push('deliver a value on every path, which is section 1\'s and section 2a\'s measurement.');
  out.push('Inside a module-scope helper there is no lifecycle obligation to prove (T-3');
  out.push('again), so the interface question decides the row alone. Every row states which');
  out.push('of these applies to it.');
  out.push('');
  out.push('An earlier revision computed this box as "the call site already carries an');
  out.push('`await`" -- a shape that is neither the legacy one nor the converted one, and');
  out.push('occurs nowhere in this tree. The column could not reach anything but zero, and');
  out.push('zero out of a shrinking population read, in the row totals, as ' + rows.length +
    ' units of unfinished work.');
  out.push('');
  out.push('Each row still records **where the `await` goes** for the boundaries that must');
  out.push('take one: at the call site, inside the converted lifecycle method.');
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
          (c.alreadyAwaited ? '; call site is already awaited' : '') +
          '; ' + c.disposition.reason) +
        ' | ' + cell(composeTarget({
          kind: 'callback',
          file: c.file,
          enclosing: c.enclosing,
          // A boundary T-5 mandates converting carries the conversion mandate.
          // One T-3 KEEPS does not: instructing an `await` there would push the
          // promise boundary into the callee, which is the thing T-3 forbids,
          // and would read as unfinished work on a settled site.
          generic: c.disposition.closed
            ? describeKeptBoundaryTarget(c)
            : CALLBACK_TARGET_MANDATE,
          lead: c.disposition.closed ? describeKeptBoundaryTarget(c) : CALLBACK_TARGET_LEAD,
          // The state a governing action is phrased against. A kept boundary
          // has no `await` to place, so a quirk written as "take the `await`
          // here" states its outcome instead (see governingAction).
          state: c.disposition.closed ? 'kept' : 'converting',
          // An error-first callback carries an error disposition; an
          // empty-parameter one carries none, so only the former points at the
          // error-edge inventory.
          trailing: c.errorFirst ? errorEdgeRef(c.file) : ''
        })) + ' |');
    });
    out.push('');
  });

  return out.join('\n');
}

/**
 * Whether a callback-boundary row is closed.
 *
 * WHY `alreadyAwaited` WAS NOT A PREDICATE. A row in this section exists
 * because a call PASSES A FUNCTION LITERAL as its completion callback -- that
 * is the detection rule. A converted site passes no literal, so it does not
 * appear at all: it leaves the population. `return cb.alreadyAwaited` therefore
 * asked whether a site was written `await util.f(x, function (err) {...})`,
 * which is neither the legacy shape nor the converted one and occurs nowhere
 * in this tree. The column could not reach anything but zero -- measured, 0 of
 * 52 -- and zero out of a population that shrinks as work completes read, in
 * the row totals, as fifty-two units of unfinished work.
 *
 * The question the row actually poses is the one rules T-3 and T-5 answer
 * together: is this boundary one the migration must remove, or one it keeps?
 *
 *   T-5 -- a Node-core callback API inside the hapi-facing surface becomes its
 *   promise equivalent, whether or not it warns. Such a boundary is UNFINISHED
 *   work and its row stays open. AAP 0.6.4 names the four:
 *   lib/controllers/courses.js:145, :266, :268 and
 *   lib/controllers/trinket.js:1389.
 *
 *   T-3 -- the promise boundary sits AT the lifecycle method and no deeper, so
 *   lib/util/file.js, lib/util/store.js, lib/util/queues.js and
 *   lib/models/model.js keep their callback interfaces even though controllers
 *   call them directly. A boundary onto one of those, onto a Mongoose model or
 *   document, onto a plugin's own callback API or onto a module-local helper is
 *   FINISHED work in its current shape: there is no promise form to await
 *   without pushing the boundary into the callee, which T-3 forbids.
 *
 * The second condition is the carrier's, and it is the same one a discarded
 * promise chain answers to: the boundary's own value goes to the callee, so
 * the response must come from somewhere else, and "somewhere else" is only
 * established when the enclosing lifecycle method is PROVEN to deliver on
 * every path. Inside a module-scope helper there is no lifecycle obligation to
 * prove (T-3 again), and the row closes on the interface question alone.
 *
 * A closed row is not a claim that the site was edited. It is the claim the
 * AAP asks this document for: that the site's disposition is settled and
 * nothing further is required of it.
 */
function isCallbackClosed(cb) {
  if (cb.nodeCore) {
    return false;
  }
  if (cb.carrier && cb.carrier.kind === 'handler') {
    return cb.carrier.delivers === true;
  }
  return true;
}

/** Why a callback-boundary row is in the state it is, for the row to carry. */
function callbackDisposition(cb) {
  if (cb.nodeCore) {
    return {
      closed: false,
      state: 'node-core-callback',
      reason: 'the callee is a Node-core callback API, so rule T-5 converts it to the ' +
        'promise equivalent whether or not it emits a deprecation warning -- this row is ' +
        'open until it is'
    };
  }
  if (cb.carrier && cb.carrier.kind === 'handler' && cb.carrier.delivers !== true) {
    return {
      closed: false,
      state: 'unproven-carrier',
      reason: 'the callee keeps its callback interface under rule T-3, but `' +
        cb.carrier.name + '` is not proven to deliver a lifecycle value on every path, and ' +
        'a boundary\'s own value goes to the callee -- so the response this path produces ' +
        'is not established'
    };
  }
  if (cb.scheduling) {
    return {
      closed: true,
      state: 'scheduling-primitive',
      reason: 'the callee schedules work rather than reporting an outcome, so it has no ' +
        'promise equivalent that preserves when the work runs; rule T-5 does not reach it ' +
        'and changing it would be a timing change (R-d)'
    };
  }
  if (cb.carrier && cb.carrier.kind === 'handler') {
    return {
      closed: true,
      state: 'kept-interface',
      reason: 'the callee keeps its callback interface under rule T-3 -- awaiting it would ' +
        'push the promise boundary into the callee -- and `' + cb.carrier.name +
        '` is proven to deliver a lifecycle value on every path, so this boundary is ' +
        'settled in its current shape'
    };
  }
  return {
    closed: true,
    state: 'kept-interface-outside-lifecycle',
    reason: 'the callee keeps its callback interface under rule T-3, and the boundary sits ' +
      'in ' + (cb.carrier ? '`' + cb.carrier.name + '`' : 'module scope') + ', which is not ' +
      'a lifecycle method, so there is no delivery obligation to prove here'
  };
}

function renderReplyChainRows(model) {
  var out = [];
  var derived = model.replyChains;
  var legacy = derived.filter(function (c) {
    return c.root === 'reply';
  });

  // The header counts every row the section RENDERS, not just the roster: the
  // unreturned bare `reply(` shape is a row here too, so a header reading
  // "8 rows" above nine of them contradicted both the table below it and the
  // row-totals census, which counts 9.
  var bareReplyRows = ANCHORED_SITES.filter(function (site) {
    return site.kind === 'reply-no-return';
  });
  var sectionRows = REPLY_CHAIN_ROSTER.length + bareReplyRows.length;
  var sectionClosed = REPLY_CHAIN_ROSTER.filter(function (entry) {
    return rosterRowState(model, entry).closed;
  }).length + bareReplyRows.filter(function (site) {
    return anchoredSiteState(model, site).closed;
  }).length;

  out.push('## 6. Reply chains -- ' + pluralize(sectionRows, 'row') + ' (' + sectionClosed +
    ' closed): the ' + REPLY_CHAIN_ROSTER.length + ' chains of the roster plus ' +
    pluralize(bareReplyRows.length, 'unreturned bare `reply(` site'));
  out.push('');
  out.push('The roster below is a **recorded baseline measurement**, not a transcription: the');
  out.push('three-way classification depends on which builder method ran last, and the');
  out.push('analysis derives the same classification independently from');
  out.push('`RESOLVING_BUILDER_METHODS` and `NON_RESOLVING_BUILDER_METHODS`. At `' +
    BASELINE_COMMIT + '` every entry');
  out.push('must be locatable by its carrier symbol and link sequence, sit at the line the');
  out.push('roster records, and derive the category the roster records -- and the self-check');
  out.push('fails if any of the three disagrees. Two independent routes to the same answer is');
  out.push('the point; the symbol is what makes the first of them survive an edit.');
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
  out.push('**Each row is anchored on its carrier SYMBOL, not on a line number**, and closes on');
  out.push('three conditions rather than one. Baseline coordinates stop being addresses the');
  out.push('moment a file is edited -- every one of these eight chains moved during the');
  out.push('conversion -- so a row is located by the exported handler or module-scope function');
  out.push('that contains it, by its link sequence, and, where one carrier holds two chains of');
  out.push('the same shape, by their order within it. The three conditions are: the legacy');
  out.push('`reply(`-rooted chain is gone from that carrier; the declared target shape is');
  out.push('present in it, where a target shape can be declared at all; and the corpus scenario');
  out.push('that drives the site carries a captured baseline response AND a confirming replay');
  out.push('verdict against this tree. The third is not ceremony, and it has two halves for a');
  out.push('reason. What a client received from one of these chains depended on which builder');
  out.push('method ran last, so "the legacy syntax is gone" says nothing about what the route');
  out.push('now serves; and a captured baseline alone says only what the OLD code did, which');
  out.push('is one side of a comparison. Both sides are required, because a row that closed on');
  out.push('the baseline half would be asserting a match nothing had checked.');
  out.push('');
  // The evidence sentence is DERIVED from the same figures the boxes are, and
  // says which of the two halves is missing rather than which is present. An
  // earlier revision printed "reports itself captured, so rows below close on
  // the recorded comparison" whenever `summary.captured` was true -- which is
  // the state of this corpus -- immediately above a table in which every row
  // was open, because closure needs the replay half as well. A section that
  // contradicts its own table is worse than a section that reports a gap.
  var rosterClosed = REPLY_CHAIN_ROSTER.filter(function (entry) {
    return rosterRowState(model, entry).closed;
  }).length;

  if (!model.evidence.available) {
    out.push('Evidence state in this tree: `' + CORPUS_PATH + '` is **not present**, so no row');
    out.push('here can close on measured behaviour. ' + rosterClosed + ' of ' +
      REPLY_CHAIN_ROSTER.length + ' rows below are closed.');
  } else if (model.evidence.pending >= model.evidence.total) {
    out.push('Evidence state in this tree: `' + CORPUS_PATH + '` defines ' +
      model.evidence.total + ' scenarios and has captured **none** of them');
    out.push('(`baselinesPending: ' + model.evidence.pending + '`), so every row below reports a');
    out.push('**prospective** comparison and stays open. Capturing the corpus against an');
    out.push('installed baseline worktree and replaying it is what closes them; nothing in this');
    out.push('generator can substitute for that. ' + rosterClosed + ' of ' +
      REPLY_CHAIN_ROSTER.length + ' rows below are closed.');
  } else if (model.evidence.recorded === 0) {
    out.push('Evidence state in this tree: `' + CORPUS_PATH + '` holds ' +
      (model.evidence.total - model.evidence.pending) + ' captured baseline' +
      (model.evidence.total - model.evidence.pending === 1 ? '' : 's') + ' across ' +
      model.evidence.total + ' scenarios and');
    out.push('**no replay verdict for any of them**, so the comparison these rows close on has');
    out.push('one side only. A captured baseline records what the PRE-migration code did; what');
    out.push('this tree serves is unmeasured until `test/parity/replay.js` drives the corpus');
    out.push('against it and records a verdict per scenario. ' + rosterClosed + ' of ' +
      REPLY_CHAIN_ROSTER.length + ' rows below are therefore closed, and');
    out.push('each open row names the scenario whose verdict would close it.');
  } else {
    out.push('Evidence state in this tree: ' + model.evidence.recorded + ' of ' +
      model.evidence.total + ' scenarios in `' + CORPUS_PATH + '` carry both a');
    out.push('captured baseline and a confirming replay verdict. ' + rosterClosed + ' of ' +
      REPLY_CHAIN_ROSTER.length + ' rows below close on that');
    out.push('recorded comparison; the rest name the scenario whose verdict is still missing.');
  }
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
      var state = rosterRowState(model, entry);
      var section = CATEGORY_QUIRK_SECTIONS[entry.category];
      var reference = entry.approvedDeviation
        ? ' Measured baseline outcome owned by `' + QUIRK_DOC + '` \u00a7' + section +
          '; the deviation and its precedence argument by \u00a7' + DEVIATION_QUIRK_SECTION + '.'
        : ' Measured baseline outcome owned by `' + QUIRK_DOC + '` \u00a7' + section +
          '; reproduce it, do not fix it.';
      out.push('| ' + box(state.closed) +
        ' | ' + cell(rosterSiteLabel(entry, state)) +
        ' | reply chain (' + entry.category + ')' +
        ' | ' + cell(entry.current + rosterStructuralNote(entry, state)) +
        ' | ' + cell((entry.approvedDeviation ? '**APPROVED DEVIATION.** ' : '') +
          entry.targetText + reference +
          describeEvidence(model.evidence, [entry.scenario],
            'the outcome this row claims')) + ' |');
    });
    out.push('');
    // The deviation is STATED here and ARGUED in docs/preserved-quirks.md
    // §11.1. Restating the argument would put the same reasoning in two
    // documents, where it can drift, so this block gives the reader what
    // changes, which requirement controls, and where the argument lives.
    entries.filter(function (e) {
      return e.approvedDeviation;
    }).forEach(function (entry) {
      out.push('> **Approved deviation, `' + entry.file + ':' + entry.lines + '`.** This is the');
      out.push('> only row in this document whose target changes observable behaviour -- the');
      out.push('> migration\'s other approved deviation, the retained `marked` advisory, reaches no');
      out.push('> conversion site -- and it is');
      out.push('> approved rather than assumed. ' + entry.justification.replace(/\s+/g, ' '));
      out.push('>');
      out.push('> The precedence argument -- why R-b ("every route serves") controls over');
      out.push('> R-d ("behaviour improvements prohibited") here and nowhere else -- is owned by');
      out.push('> `' + QUIRK_DOC + '` \u00a7' + DEVIATION_QUIRK_SECTION + ' and is not restated here.');
      out.push('>');
      // The corpus treatment is reported from the corpus, in the tense the
      // corpus justifies. Describing a comparison as "recorded" while the
      // artifact holds no response is the kind of claim this document exists
      // to make checkable, so the state is read out of the file every run.
      out.push('> **The corpus treatment of this deviation, as it actually stands.** ' +
        describeDeviationCorpusState(model.evidence, entry).replace(/\s+/g, ' '));
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
    var state = anchoredSiteState(model, s);
    out.push('| ' + box(state.closed) +
      ' | ' + cell(anchoredSiteLabel(model, s)) +
      ' | reply call, no return' +
      ' | ' + cell(s.current +
        (state.stillLegacy
          ? '; STILL PRESENT in `' + s.enclosing + '` in this tree'
          : '; the unreturned bare `reply(` is gone from `' + s.enclosing + '`')) +
      ' | ' + cell(s.target + anchoredQuirkRef(s) +
        describeEvidence(model.evidence, s.scenario ? [s.scenario] : [],
          'the status and payload this row claims reach the same funnel')) + ' |');
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
    'earlier in the request, so the outcome has to be captured at the baseline BEFORE ' +
    'conversion rather than ' +
    'reasoned about.'
};

// The generic stream action. It is about TIMING rather than about which value
// leaves the body, so no quirk in the allow-list overrides it -- the two
// governed streaming sites in lib/controllers/users.js keep this mandate and
// carry the quirk pointer alongside it.
var STREAM_TARGET_MANDATE = 'Preserve completion and error TIMING exactly: the same event ' +
  'ordering, the same point at which the response begins, and the same behaviour for an ' +
  'error raised after it has begun. Awaiting a stream that baseline did not await, or ' +
  'surfacing an error baseline swallowed, is a behaviour change.';

function renderStreamRows(model) {
  var out = [];
  var names = Object.keys(model.streamSitesByController).sort(function (a, b) {
    return CONTROLLERS.indexOf(a) - CONTROLLERS.indexOf(b);
  });

  var linked = 0;
  var unlinked = [];
  names.forEach(function (name) {
    model.streamSitesByController[name].forEach(function (site) {
      if (site.scenarios.length > 0) {
        linked++;
      } else {
        unlinked.push(site);
      }
    });
  });

  var streamClosed = names.reduce(function (acc, name) {
    return acc + model.streamSitesByController[name].filter(function (site) {
      return site.evidenceState === EVIDENCE.RECORDED;
    }).length;
  }, 0);
  out.push('## 7. Stream sites -- ' + pluralize(model.streamSiteTotal, 'row') +
    ' across ' + pluralize(names.length, 'controller') + ' (' + streamClosed + ' closed)');
  out.push('');
  out.push('Derived, then reviewed -- see "Streams" above for the rule and for what it');
  out.push('deliberately excludes. Several of these error **after the response has begun**,');
  out.push('which is why every row carries the same non-negotiable target: completion and error');
  out.push('**timing** are preserved.');
  out.push('');
  out.push('**Each row names the scenario that drives it, and a row with none cannot close.**');
  out.push('Whether timing survived is not a property of the text: no reading of a');
  out.push('`.pipe(...)` tells you whether the response still begins at the same point or');
  out.push('whether an error raised after it began is still swallowed. Only a driven request');
  out.push('does. The join is mechanical rather than asserted -- the site resolves to the');
  out.push('innermost symbol that contains it, that symbol resolves to the routes it answers');
  out.push('(through the dispatch table where the carrier is a module-scope function, with the');
  out.push('hops named in the row), and the routes resolve to the corpus scenarios whose');
  out.push('`covers` list them.');
  out.push('');
  out.push('In this tree ' + linked + ' of ' + model.streamSiteTotal +
    ' stream rows resolve to at least one scenario' +
    (unlinked.length > 0
      ? ', and ' + unlinked.length + ' resolve to none: ' + unlinked.map(function (s) {
        return '`' + s.file + ':' + s.line + '`';
      }).join(', ') + '. An unlinked row is a gap in the corpus, not a closed row.'
      : '.'));
  out.push('');

  names.forEach(function (name) {
    var sites = model.streamSitesByController[name];
    out.push('### `' + CONTROLLER_DIR + '/' + name + '.js` -- ' +
      pluralize(sites.length, 'site'));
    out.push('');
    out.push('| Done | Site | Kind | Current shape | Target disposition |');
    out.push('| --- | --- | --- | --- | --- |');
    sites.forEach(function (site) {
      out.push('| ' + box(site.evidenceState === EVIDENCE.RECORDED) +
        ' | ' + cell(streamSiteLabel(site)) +
        ' | stream site' +
        ' | ' + cell(site.reasons.join(', ') + ' -- ' + code(site.text)) +
        ' | ' + cell('Preserve completion and error TIMING exactly: the same event ordering, ' +
          'the same point at which the response begins, and the same behaviour for an error ' +
          'raised after it has begun. Awaiting a stream that baseline did not await, or ' +
          'surfacing an error baseline swallowed, is a behaviour change.' +
          errorEdgeRef(site.file) +
          quirkRef(site.file, site.enclosing) +
          describeEvidence(model.evidence,
            // When nothing pins a scenario to this branch, the row names the
            // route-level CANDIDATES it found: reporting them is useful,
            // treating them as proof closes unexercised rows.
            site.evidenceState === EVIDENCE.INDIRECT
              ? site.routeScenarios
              : site.scenarios,
            'the preserved timing this row claims',
            site.evidenceState) +
          // How the pin was derived, so the join is checkable rather than
          // taken on the scenario id. Two derivations reach a branch and they
          // are not equally direct, so the row says which one it used.
          (site.scenarioPin
            ? ' PIN: ' + site.scenarioPin.basis + ' (`' + site.scenarioPin.branch + '`).'
            : '')) + ' |');
    });
    out.push('');
  });

  out.push('A stream row closes on measured behaviour of ITS OWN BRANCH or not at all. Two');
  out.push('things have to hold. First a scenario must be pinned to this branch, and the pin is');
  out.push('derived rather than tabulated -- from the reply chains this document already');
  out.push('anchors structurally, not from the routes the carrier is reached from. That');
  out.push('distinction is load-bearing: `files.download` reaches three stream sites across two');
  out.push('mutually exclusive branches, so a result for the inline-image branch is silent');
  out.push('about the attachment branch, and spreading one route-level scenario across both');
  out.push('would tick a row nothing exercised.');
  out.push('');
  out.push('Two derivations produce a pin, and each row says which one it used. A site INSIDE a');
  out.push('located chain is on that chain\'s branch. A site outside every located chain is on');
  out.push('the branch of the one reply chain its carrier declares -- when its carrier declares');
  out.push('exactly one, because then there is no other branch in that carrier for the site to');
  out.push('be on. `downloadZip` and `downloadPostedZip` build the archive and the read stream');
  out.push('BEFORE the response expression, which is why the containment test alone left four');
  out.push('sites in each of them resting on nothing. The branch count is the number of chains');
  out.push('the carrier DECLARES rather than the number this run located, which is what');
  out.push('refuses the pin for `files.download`: only one of its two branches is locatable in');
  out.push('a converted tree, and counting located chains would have found "exactly one" and');
  out.push('pinned a site to a branch it may not be on.');
  out.push('');
  out.push('Second, the pinned scenario must carry a captured baseline AND a confirming replay');
  out.push('verdict. Until both hold the row stays open with the reason stated in it, which is');
  out.push('the difference between an open checklist item and an unsupported claim. A site that');
  out.push('cannot be pinned at all reports its route-level scenarios as candidates, or says');
  out.push('that it has none.');
  out.push('');
  return out.join('\n');
}

/**
 * Site label for a stream row: the coordinate, the symbol that carries it, and
 * -- where that symbol is not itself a routed handler -- the route the join
 * resolved to and the hops it took to get there.
 */
function streamSiteLabel(site) {
  var label = '`' + site.file + ':' + site.line + '`';
  if (site.carrier) {
    label += ' `' + site.carrier.name + '`';
    if (site.carrier.kind !== 'handler') {
      label += ' (module-scope function';
      if (site.routeVia && site.routeVia.length > 0) {
        label += ', reached via ' + site.routeVia.map(function (v) {
          return '`' + v + '`';
        }).join(' -> ');
      }
      label += ')';
    }
  } else {
    label += ' (no enclosing symbol)';
  }
  if (site.routes && site.routes.length > 0) {
    label += ' -- serves ' + site.routes.slice(0, 2).map(function (r) {
      return '`' + r + '`';
    }).join(', ') + (site.routes.length > 2 ? ' and ' + (site.routes.length - 2) + ' more' : '');
  } else {
    label += ' -- **no route resolved**';
  }
  return label;
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
  out.push('**The `Done` box means something different in this section and the next**: it is');
  out.push('ticked when the recorded determination is that no gate forces this function into');
  out.push('scope, and left open when one does. It is not a conversion claim -- an unrouted');
  out.push('function in its legacy shape is finished work under blocking-only scope.');
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
  out.push('exception among these rows, labelled as such in section 6 and argued in');
  out.push('`' + QUIRK_DOC + '` \u00a7' + DEVIATION_QUIRK_SECTION + '. The migration approves');
  out.push('**two** deviations; the second (`' + QUIRK_DOC + '` \u00a7' +
    AUDIT_DEVIATION_QUIRK_SECTION + ')');
  out.push('is an audit result and reaches no row in this document.');
  out.push('');
  return out.join('\n');
}

// The four populations the rows fall into, and what decides a row in each.
// They are reported with their OWN denominators because they are not
// commensurable: summing them and calling the result a completion figure was
// the defect this accounting replaces.
var POPULATIONS = [
  {
    key: 'lifecycle',
    title: 'Lifecycle functions -- the conversion set',
    decidedBy: 'the analysed tree: a lifecycle shape, no residual `reply(`, and a PROVEN ' +
      'delivery of a value on every path through the body',
    openMeans: 'a body that is still legacy, still consumes the shim, or cannot be shown to ' +
      'deliver on some path -- unfinished conversion work, and the row says which half is ' +
      'missing'
  },
  {
    key: 'structural',
    title: 'Sites inside those functions, decided by the tree',
    decidedBy: 'the analysed tree: a chain\'s value or settlement reaching a consumer, and a ' +
      'callback boundary falling on the side of rules T-3 and T-5 that keeps it',
    openMeans: 'a value that is discarded where something could have depended on it, a ' +
      'reaction that produces nothing, or a Node-core callback API that rule T-5 mandates ' +
      'converting -- unfinished conversion work'
  },
  {
    key: 'measured',
    title: 'Sites whose target IS a measurement',
    decidedBy: 'a DRIVEN COMPARISON -- the corpus scenario that drives the site carrying ' +
      'both a captured baseline response and a confirming replay verdict against this tree',
    openMeans: 'the comparison has not been performed, or has been performed on one side ' +
      'only. This is NOT a statement that the site is unconverted: what the site now serves ' +
      'is unmeasured, and no reading of the source can substitute'
  },
  {
    key: 'excluded',
    title: 'Rows outside the conversion set',
    decidedBy: 'a recorded per-function determination -- whether an independent gate (the ' +
      'zero-deprecation-warning bar, or the repaired suite) forces a defined-but-unrouted ' +
      'function into scope -- and, for a route with no function, whether the preserved ' +
      'fallback still serves it',
    openMeans: 'a gate does force the function into scope, so it joins the conversion set'
  }
];

/**
 * The completion accounting, by population rather than by one sum.
 *
 * WHY THE SUM WAS THE DEFECT. The table above is a per-section census and is
 * correct as one. Adding its Closed column up and printing `382 / 266` -- as an
 * earlier revision did -- asserted a completion figure over four populations
 * that answer to different authorities, and the arithmetic then read as one
 * number of outstanding units of conversion work. It was not: the largest part
 * of that gap was a callback-boundary column that could not reach anything but
 * zero, and the rest was a driven comparison nobody in the delivery had run.
 * Both are real facts, and neither is "116 sites left to convert".
 *
 * So the sum stays -- it is the census total and a reader may want it -- and
 * the claim is made per population, each with its own denominator, the
 * authority that decides it, and, for what remains, the artifact that would
 * close it. Every figure here is derived from the same `sections` array the
 * table is, and the self-check asserts the two agree.
 */
function renderPopulationAccounting(model, sections, totalRows, totalClosed) {
  var out = [];
  var buckets = populationTotals(sections);

  out.push('### What that total does and does not say');
  out.push('');
  out.push('The census above is correct as a census. **Its Closed column must not be read as');
  out.push('a single completion figure**, because the rows answer to four different');
  out.push('authorities, and only two of the four are statements about conversion work at');
  out.push('all. So the claim is made per population:');
  out.push('');
  out.push('| Population | Rows | Closed | Decided by |');
  out.push('| --- | --- | --- | --- |');
  POPULATIONS.forEach(function (population) {
    var bucket = buckets[population.key];
    out.push('| ' + population.title + ' | ' + bucket.rows + ' | ' + bucket.closed +
      ' | ' + cell(population.decidedBy) + ' |');
  });
  out.push('| **All rows** | **' + totalRows + '** | **' + totalClosed + '** | |');
  out.push('');

  POPULATIONS.forEach(function (population) {
    var bucket = buckets[population.key];
    var open = bucket.rows - bucket.closed;
    out.push('- **' + population.title + ' -- ' + bucket.closed + ' of ' + bucket.rows +
      ' closed' + (open === 0 ? ', none open' : ', ' + open + ' open') + '.** ' +
      (open === 0
        ? 'Every row in this population is settled by the analysed tree.'
        : 'An open row here means ' + population.openMeans + '.'));
  });
  out.push('');

  var measured = buckets.measured;
  var conversionRows = buckets.lifecycle.rows + buckets.structural.rows;
  var conversionClosed = buckets.lifecycle.closed + buckets.structural.closed;
  var conversionOpen = conversionRows - conversionClosed;

  out.push('**The one completion claim this document supports, stated as narrowly as the');
  out.push('evidence allows.** ' + conversionClosed + ' of the ' + conversionRows +
    ' rows whose disposition the analysed tree decides are');
  out.push('closed' + (conversionOpen === 0
    ? ' -- every routed handler, every routed pre-handler, the inline pre-handler, every'
    : ', and ' + conversionOpen + ' are not. The population covers every routed handler,') +
    (conversionOpen === 0
      ? ' promise chain and every callback boundary.'
      : ' every routed pre-handler, the inline pre-handler, every promise chain and every ' +
        'callback boundary.'));
  out.push('');
  if (measured.closed < measured.rows) {
    out.push('**What is NOT claimed.** ' + (measured.rows - measured.closed) + ' of the ' +
      measured.rows + ' rows whose target is a measurement remain');
    out.push('open, and no amount of reading this tree closes one: a reply chain\'s outcome');
    out.push('depended on which builder method ran last, and whether a stream still errors');
    out.push('after the response has begun is a timing question. What closes them is');
    out.push('`test/parity/replay.js` driving `' + CORPUS_PATH + '` against this tree and');
    out.push('recording a verdict per scenario. This tree carries ' + model.evidence.total +
      ' scenarios, ' +
      (model.evidence.total - model.evidence.pending) + ' with a captured');
    out.push('baseline and **' + model.evidence.recorded + ' with a confirming replay**, so');
    out.push('the comparison exists on one side. Each open row below names the scenario whose');
    out.push('verdict would close it, or states that no scenario is pinned to its branch.');
    out.push('');
    replayEvidenceLines(model).forEach(function (line) {
      out.push(line);
    });
    out.push('');
  }
  return out.join('\n');
}

/**
 * Where the target half of the comparison comes from, and its state in this
 * run.
 *
 * Stated in the document because a reader looking at 28 open measurement rows
 * needs to know what closes them, and the answer is not "run the replay
 * again". The corpus holds baselines; replay.js writes verdicts to its own
 * artifact; nothing writes them back into the corpus. So the closing step is
 * two commands, and the second one is the join this generator now accepts.
 *
 * @param {Object} model the analysed model
 * @returns {string[]} markdown lines
 */
function replayEvidenceLines(model) {
  var out = [];
  var artifact = model.replayArtifact;
  var join = model.replayJoin;

  if (!artifact) {
    out.push('**How the target half arrives.** `test/parity/replay.js` writes its per-scenario');
    out.push('verdicts to its OWN `--out` artifact, and nothing in this repository writes a');
    out.push('verdict back into `' + CORPUS_PATH + '` -- that tool\'s `--annotations` flag is');
    out.push('an input, joining `expectedDeviation` and `unreachableReason` by scenario id,');
    out.push('and `test/parity/capture.js` is the only writer of the corpus. This run was');
    out.push('given no replay artifact, so every row below stands on its captured baseline');
    out.push('alone. To close them, produce the artifact and hand it back:');
    out.push('');
    out.push('```sh');
    out.push('npm run verify:corpus                       # writes $PARITY_OUT/replay-result.json');
    out.push('node test/parity/convert-inventory.js \\');
    out.push('  --replay "$PARITY_OUT/replay-result.json" --out docs/conversion-inventory.md');
    out.push('```');
    return out;
  }

  out.push('**The replay artifact this run was given.** `' + path.basename(artifact.path) +
    '`, written by');
  out.push('`' + REPLAY_ARTIFACT_TOOL + '`, digest `sha256:' + artifact.digest.slice(0, 16) +
    '...`, verdict ' + JSON.stringify(artifact.verdict) + '. It carries ' +
    artifact.scenarios + ' scenario');
  out.push('verdicts, ' + artifact.confirming + ' of them confirming' +
    (join ? ', of which ' + join.joined + ' matched a scenario in the corpus' : '') + '.');
  out.push('');

  if (!artifact.usable) {
    out.push('**Those verdicts close no row.** The artifact labels itself');
    out.push('`gateQualifying: false`' + (artifact.gateQualifyingReason
      ? ' -- ' + artifact.gateQualifyingReason
      : '') + '. A run its own producer says cannot stand as the gate cannot');
    out.push('close a row here either: that would put back the thing this section exists to');
    out.push('prevent, a checklist asserting a measurement that cannot be cited. The');
    out.push('verdicts are reported above and the rows stay open.');
    return out;
  }

  if (join && join.unmatched.length > 0) {
    out.push('**' + join.unmatched.length + ' verdict(s) name a scenario the corpus does not');
    out.push('contain**, so the two artifacts describe different corpora and those verdicts');
    out.push('were not joined: ' + join.unmatched.slice(0, 6).map(function (id) {
      return '`' + id + '`';
    }).join(', ') + (join.unmatched.length > 6 ? ', and others' : '') + '.');
  }
  return out;
}

/** Rows and closed rows per population, derived from the section census. */
function populationTotals(sections) {
  var buckets = Object.create(null);
  POPULATIONS.forEach(function (population) {
    buckets[population.key] = { rows: 0, closed: 0 };
  });
  sections.forEach(function (section) {
    var bucket = buckets[section.population];
    if (!bucket) {
      return;
    }
    bucket.rows += section.rows;
    bucket.closed += section.closed;
  });
  return buckets;
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
  out.push(renderPopulationAccounting(model, sections, totalRows, totalClosed));

  var functionRows = sections.filter(function (s) {
    return s.functionRows;
  });
  var functionRowTotal = functionRows.reduce(function (acc, s) {
    return acc + s.rows;
  }, 0);
  var functionRowClosed = functionRows.reduce(function (acc, s) {
    return acc + s.closed;
  }, 0);

  out.push('The row count is **derived, not targeted**. It is not ' + CONVERSION_SET.total +
    ', and it should not be: the ' + CONVERSION_SET.total + ' counts hapi-invoked');
  out.push('*functions*, while a function typically contains several sites -- a chain, two');
  out.push('callback boundaries, a stream -- each of which is closed separately.');
  out.push('');
  out.push('**The function rows are exactly the ' + CONVERSION_SET.total + ', and they are the ' +
    'rows marked `yes` above**: ' + functionRows.map(function (s) {
      return s.rows + ' (' + s.title.replace(/^[0-9a-z]+\. /, '') + ')';
    }).join(' + ') + ' = **' + functionRowTotal + '**, of which ' + functionRowClosed +
    ' are closed.');
  out.push('That arithmetic is asserted by the self-check rather than asserted in prose: ' +
    CONVERSION_SET.routedHandlers + ' routed handlers + ' + CONVERSION_SET.routedPreHandlers +
    ' routed');
  out.push('pre-handlers + ' + CONVERSION_SET.inlinePreHandlers + ' inline pre-handler = ' +
    CONVERSION_SET.total + '. Everything else is a **site within** one of those functions or');
  out.push('deliberately outside the set:');
  out.push('');
  out.push('- **2b** holds two BRANCH SITES, not two functions. They live inside `findTrinket`');
  out.push('  and `courseBySlug`, which are already two of the ' + CONVERSION_SET.routedPreHandlers +
    ' rows in 2a, so counting them');
  out.push('  as functions would say this document tracks ' + (CONVERSION_SET.total + 2) +
    ' hapi-invoked functions when it');
  out.push('  tracks ' + CONVERSION_SET.total + '.');
  out.push('- **Sections 4 to 7** are sites inside the function rows: promise chains, callback');
  out.push('  boundaries, reply chains and stream sites.');
  out.push('- **Sections 8 to 10** are outside the set entirely -- the 2 unrouted exports, the 3');
  out.push('  unrouted pre-handlers and the 3 routes with no function to convert.');
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// SECTION 15 -- DOCUMENT ASSEMBLY
// ---------------------------------------------------------------------------

/**
 * The per-section row census, and the population accounting derived from it.
 *
 * Built here rather than inside `renderDocument` so that the SELF-CHECKS can
 * assert the arithmetic before a document exists: a closure figure that only
 * comes into being while rendering cannot be checked, and the accounting
 * defect this replaces was two figures computed by different routes that did
 * not agree.
 */
/**
 * Every measurement-gated row, with the scenario that is supposed to close it.
 *
 * The accounting needs this per row rather than in aggregate, and the reason is
 * that one confirmed scenario can legitimately close SEVERAL rows. The
 * sole-branch stream pin does exactly that on purpose: a controller declaring
 * one reply chain in a function that owns five stream sites pins all six to
 * that chain's scenario, because the response those sites produce IS the one
 * that scenario drives. An earlier revision asserted
 * `measuredClosed <= evidence.recorded`, which reads one scenario as licensing
 * one row and therefore FAILS generation on valid partial evidence: marking a
 * single scenario replay-confirmed closed its six pinned rows and the run
 * exited 2 complaining that "6 rows are closed but only 1 scenario carries a
 * confirming verdict". The invariant that actually holds is per row -- every
 * closed row's OWN scenario must carry the confirming verdict -- and it is
 * strictly stronger, because it also catches a row closed on some other row's
 * evidence, which the aggregate never could.
 *
 * @param {Object} model the analysed model
 * @returns {{section: string, label: string, scenario: (string|null),
 *            evidenceState: string, closed: boolean}[]}
 */
function measuredRowLedger(model) {
  var ledger = [];

  ANCHORED_SITES.forEach(function (site) {
    if (site.kind !== 'dead-301' && site.kind !== 'reply-no-return') {
      return;
    }
    var state = anchoredSiteState(model, site);
    ledger.push({
      section: site.kind === 'dead-301' ? '2b' : '6',
      label: site.file + ' `' + site.enclosing + '` (' + site.kind + ')',
      scenario: site.scenario || null,
      evidenceState: state.evidenceState,
      closed: state.closed
    });
  });

  REPLY_CHAIN_ROSTER.forEach(function (entry) {
    var state = rosterRowState(model, entry);
    ledger.push({
      section: '6',
      label: entry.file + ':' + entry.lines + ' `' + entry.carrier + '`',
      scenario: entry.scenario || null,
      evidenceState: state.evidenceState,
      closed: state.closed
    });
  });

  Object.keys(model.streamSitesByController).forEach(function (name) {
    model.streamSitesByController[name].forEach(function (site) {
      ledger.push({
        section: '7',
        label: site.file + ':' + site.line +
          (site.enclosing ? ' `' + site.enclosing + '`' : ''),
        scenario: site.scenario || null,
        evidenceState: site.evidenceState,
        closed: site.evidenceState === EVIDENCE.RECORDED
      });
    });
  });

  return ledger;
}

function buildSectionCensus(model) {
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
      inSet: 'yes',
      functionRows: true,
      population: 'lifecycle'
    },
    {
      title: '2a. Routed pre-handler functions',
      rows: routedPre.length,
      closed: routedPre.filter(isHandlerClosed).length,
      inSet: 'yes',
      functionRows: true,
      population: 'lifecycle'
    },
    {
      // Counted apart from 2a because they are not functions: they are two
      // BRANCH SITES inside two of 2a's functions (`findTrinket` and
      // `courseBySlug`). Counting them in section 2 puts 156 rows in sections
      // 1 to 3 while the prose calls them the 154 -- 145 + 8 + 1 is 154, and
      // the two dead 301s are sites within, exactly like a promise chain.
      title: '2b. Dead pre-handler 301 branch sites (inside 2a)',
      rows: deadRedirects.length,
      closed: deadRedirects.filter(function (s) {
        return anchoredSiteState(model, s).closed;
      }).length,
      inSet: 'sites within',
      population: 'measured'
    },
    {
      title: '3. Inline pre-handler',
      rows: model.inlinePreHandlers.length,
      closed: model.inlinePreHandlers.filter(function (i) {
        return i.signature === 'toolkit' && !i.analysis.usesReply && i.analysis.alwaysDelivers;
      }).length,
      inSet: 'yes',
      functionRows: true,
      population: 'lifecycle'
    },
    {
      title: '4. Promise chains',
      rows: model.promiseChains.length,
      closed: model.promiseChains.filter(isChainClosed).length,
      inSet: 'sites within',
      population: 'structural'
    },
    {
      title: '5. Callback boundaries',
      rows: model.callbackBoundaries.length,
      closed: model.callbackBoundaries.filter(isCallbackClosed).length,
      inSet: 'sites within',
      population: 'structural'
    },
    {
      title: '6. Reply chains (+1 distinct shape)',
      rows: REPLY_CHAIN_ROSTER.length + bareReplyRows.length,
      closed: REPLY_CHAIN_ROSTER.filter(function (entry) {
        return rosterRowState(model, entry).closed;
      }).length + bareReplyRows.filter(function (s) {
        return anchoredSiteState(model, s).closed;
      }).length,
      inSet: 'sites within',
      population: 'measured'
    },
    {
      title: '7. Stream sites',
      rows: model.streamSiteTotal,
      closed: Object.keys(model.streamSitesByController).reduce(function (acc, name) {
        return acc + model.streamSitesByController[name].filter(function (site) {
          return site.evidenceState === EVIDENCE.RECORDED;
        }).length;
      }, 0),
      inSet: 'sites within',
      population: 'measured'
    },
    {
      title: '8. Unrouted controller exports',
      rows: unroutedHandlers.length,
      closed: unroutedHandlers.filter(function (h) {
        return !h.gate.forced;
      }).length,
      inSet: 'NO -- excluded',
      population: 'excluded'
    },
    {
      title: '9. Unrouted named pre-handlers',
      rows: unroutedPre.length,
      closed: unroutedPre.filter(function (p) {
        return !p.gate.forced;
      }).length,
      inSet: 'NO -- excluded',
      population: 'excluded'
    },
    {
      title: '10. Routes with no function',
      rows: EXCLUDED_MISSING_BINDINGS.length,
      closed: EXCLUDED_MISSING_BINDINGS.filter(function (entry) {
        return model.bindings.some(function (d) {
          return d.binding === entry.binding;
        });
      }).length,
      inSet: 'NO -- excluded',
      population: 'excluded'
    }
  ];

  var totalRows = sections.reduce(function (acc, section) {
    return acc + section.rows;
  }, 0);
  var totalClosed = sections.reduce(function (acc, section) {
    return acc + section.closed;
  }, 0);
  var buckets = populationTotals(sections);

  return {
    sections: sections,
    accounting: {
      totalRows: totalRows,
      totalClosed: totalClosed,
      populationRows: POPULATIONS.reduce(function (acc, population) {
        return acc + buckets[population.key].rows;
      }, 0),
      populationClosed: POPULATIONS.reduce(function (acc, population) {
        return acc + buckets[population.key].closed;
      }, 0),
      measuredRows: buckets.measured.rows,
      measuredClosed: buckets.measured.closed
    }
  };
}

function renderDocument(model, checks) {
  var sections = model.sections;

  var body = [
    renderFrontMatter(model),
    '',
    renderPreamble(model),
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
  var text = body.replace(/\n+$/, '') + '\n';

  // Two passes over one block: the body has to exist before it can be
  // digested, and the digest has to be on the block before the block is
  // serialized into the body. The canonicalization drops the serialized
  // `provenance-json` line, so the digest taken from pass 1 is the digest of
  // what pass 2 writes, and no other line is derived from the block.
  if (model.provenance && model.provenance.block && !renderDocument.rebinding) {
    bindBodyDigest(model.provenance.block, text);
    renderDocument.rebinding = true;
    try {
      text = renderDocument(model, checks);
    }
    finally {
      renderDocument.rebinding = false;
    }
  }

  return text;
}


// ---------------------------------------------------------------------------
// SECTION 16 -- CLI
// ---------------------------------------------------------------------------

var EXIT_OK = 0;
var EXIT_USAGE = 1;
var EXIT_SELF_CHECK = 2;
// A committed document that no longer describes the tree is its own failure
// mode, distinct from a usage error and from a self-check failure: the
// analysis succeeded, and what is wrong is that the artifact is stale. Given
// its own code so a caller can tell the three apart mechanically.
var EXIT_STALE = 3;

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
  '  --replay <path>  the `--out` artifact of test/parity/replay.js, supplying the',
  '                 TARGET half of every measurement-gated row. The corpus holds',
  '                 the captured baselines; replay.js writes its verdicts to its',
  '                 own artifact and nothing writes them back into the corpus, so',
  '                 without this the measurement-gated rows cannot close however',
  '                 many times the replay is run. An artifact the tool labelled',
  '                 gateQualifying: false is read and reported but closes no row.',
  '  --check        write nothing; regenerate in memory and compare against the',
  '                 document at --out. Exits 3 when it differs, so the committed',
  '                 artifact can be proven current without trusting its header.',
  '  --verbose      print a short summary to stderr',
  '  --help, -h     print this message',
  '',
  'No option is repeatable: a second --app, --out, --replay or --verbose is a usage',
  'error rather than a last-one-wins, and a path beginning with "-" is a usage',
  'error too, so a missing value cannot swallow the following option.',
  '',
  'Exit codes:',
  '  0  document written (or, with --check, the document is current)',
  '  1  usage error, or a tree that could not be read',
  '  2  self-check failure -- no document written',
  '  3  --check only: the document at --out does not match the analysed tree'
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

// Assertive capture claims. Each one states that a measurement EXISTS, which
// no analysis of source can establish, so none of them may appear while this
// run has no linked runtime evidence. They are matched literally rather than by
// a general "recorded"/"captured" scan on purpose: the document legitimately
// says a row "stays OPEN until the captured response it must reproduce exists",
// which describes a requirement, while the phrases below assert a result. A
// scan loose enough to catch the second fails on the first, and a check that
// fires on correct prose stops being run.
var FALSE_EVIDENCE_CLAIMS = Object.freeze([
  { phrase: 'captured before conversion by', requires: 'baseline' },
  { phrase: 'the baseline result is recorded', requires: 'baseline' },
  { phrase: 'has been captured', requires: 'baseline' },
  { phrase: 'were captured before', requires: 'baseline' },
  { phrase: 'the target result as a 200', requires: 'target' },
  { phrase: 'results are recorded', requires: 'target' }
]);

// A rendered row names the scenario that closes it in one form -- the EVIDENCE
// sentence -- so the audit can join a row back to its own evidence state
// without trusting the model that rendered it.
/**
 * Whether this run carries captured baseline evidence AT ALL.
 *
 * A document-wide claim asks that question; `summary.captured` answers a
 * stricter one -- whether EVERY scenario carries a baseline -- and goes false
 * as soon as one scenario is recorded as unreachable by design. That is a
 * state a capture may legitimately be in, and the corpus records the reason
 * rather than driving a request that terminates the application: the folder
 * duplicate-name contract raises a duplicate-key error inside a save callback
 * that reaches an undefined `request.catch`, which Mongoose re-emits as an
 * unlistened 'error' event, so the process exits and every scenario ordered
 * after it would be lost. Reading the strict flag here refused a document
 * whose baselines were otherwise complete, with `baselinesPending: 0`.
 *
 * So the predicate is: the corpus is readable, nothing is pending, and at
 * least one baseline exists. A claim on a row that names its own scenario is
 * still judged against THAT scenario, which is stricter than this and
 * unchanged -- this only governs prose that names none.
 *
 * @returns {boolean}
 */
function baselineEvidenceAvailable(evidence) {
  if (!evidence || !evidence.available) {
    return false;
  }
  if (evidence.captured) {
    return true;
  }
  return evidence.pending === 0 && evidence.total > 0;
}

var SCENARIO_IN_ROW = /EVIDENCE: `([^`]+)`/g;

// Row kinds whose target IS a measurement. Used for the rows that name NO
// scenario: those must never be ticked, and without a kind test they would be
// invisible to an audit that keys on the EVIDENCE sentence.
var MEASURED_ROW_KINDS = Object.freeze([
  '| stream site',
  '| reply chain (',
  '| reply call, no return'
]);

/** The scenario ids one rendered line names, in order, without duplicates. */
function scenariosNamedIn(line) {
  var found = [];
  var match;
  SCENARIO_IN_ROW.lastIndex = 0;
  while ((match = SCENARIO_IN_ROW.exec(line)) !== null) {
    if (found.indexOf(match[1]) === -1) {
      found.push(match[1]);
    }
  }
  return found;
}

/** Whether one scenario carries the half of the evidence a claim asserts. */
function claimBackedByScenario(evidence, id, requires) {
  var state = evidenceStateOf(evidence, id);
  if (requires === 'baseline') {
    return state === EVIDENCE.RECORDED || state === EVIDENCE.BASELINE_ONLY;
  }
  return state === EVIDENCE.RECORDED;
}

/**
 * Whether this run has runtime evidence to cite at all -- THE one predicate
 * for that question, passed the model explicitly by every caller.
 *
 * Read from the corpus this run loaded rather than hardcoded: the predicate
 * exists so that a claim about a measurement is permitted exactly when the
 * measurement is present, and a constant answer is wrong on one side or the
 * other as soon as the corpus changes state.
 *
 * "Present" means a scenario in `EVIDENCE.RECORDED` -- a captured baseline AND
 * a confirming replay verdict -- because that is the state every closure rule
 * in this file requires, and a predicate that answered a weaker question than
 * the rules it guards would license exactly the claims it exists to refuse. An
 * earlier revision read `evidence.available && evidence.captured`, which the
 * corpus in this tree satisfies with 383 captured baselines and zero replays:
 * the audit below therefore returned early and let the reply-chain section
 * assert that "rows below close on the recorded comparison" while every one of
 * them was open. A baseline alone records what the PRE-migration code did,
 * which is one half of a comparison.
 *
 * Its scope is deliberately narrow: a DOCUMENT-WIDE claim, one whose row names
 * no scenario and which can therefore only be about the run as a whole. A
 * claim attached to a row is judged against that row's own scenario instead,
 * because a run holding one confirmed scenario says nothing about a row driven
 * by a different one -- and reading this predicate as an answer for every row
 * is what let a ticked stream row through on an unrelated verdict.
 */
function runtimeEvidenceAvailable(model) {
  return Boolean(model && model.evidence && model.evidence.recorded > 0);
}

/**
 * Refuses to write a document that asserts a measurement nobody took.
 *
 * Two invariants, both derived from the document's own stated policy and both
 * evaluated PER ROW:
 *
 *   1. no assertive capture claim unless the scenario the claim's own row
 *      names carries the half of the evidence the claim asserts -- a claim
 *      about a captured baseline needs a captured baseline, a claim about a
 *      target result needs a confirming replay verdict;
 *   2. no ticked box on a row whose target IS a measurement unless that row's
 *      own scenario is in EVIDENCE.RECORDED. A row that names no scenario can
 *      never be ticked, because there is nothing for it to have measured.
 *
 * WHY PER ROW. An earlier revision opened with `if
 * (runtimeEvidenceAvailable(model)) { return; }`, which switched the whole
 * audit off as soon as ONE scenario anywhere in the corpus carried a verdict.
 * Both scans then stopped running for every other row, and a ticked stream row
 * whose own scenario had no verdict at all was accepted -- the exact claim the
 * function exists to refuse, admitted by an unrelated scenario's evidence. The
 * all-or-nothing shape also contradicted the guarantee stated below: a check
 * that stops evaluating cannot hold "however a future renderer computes the
 * box".
 *
 * Both invariants are checked against the rendered rows rather than against
 * the model, and the join back to the evidence is the scenario id the row
 * itself prints. So the audit is independent of whatever computed the box, and
 * a renderer that ticked a row without printing its scenario fails on
 * invariant 2 rather than passing unnoticed.
 *
 * @param {string} document the rendered markdown
 * @param {Object} model the analysed model, for its evidence state
 * @returns {undefined}
 * @throws {Error} with the self-check exit code, so nothing is written
 */
function auditRenderedEvidence(document, model) {
  var failures = [];
  var lines = document.split('\n');
  var evidence = model.evidence;

  lines.forEach(function (line, index) {
    var named = scenariosNamedIn(line);

    FALSE_EVIDENCE_CLAIMS.forEach(function (claim) {
      if (line.indexOf(claim.phrase) === -1) {
        return;
      }
      // A claim on a row that names its scenario is judged against THAT
      // scenario. A claim in prose that names none is judged against the
      // document-wide state, which is the only thing it can be about.
      var backed = named.length > 0
        ? named.every(function (id) {
          return claimBackedByScenario(evidence, id, claim.requires);
        })
        : (claim.requires === 'baseline'
          ? baselineEvidenceAvailable(evidence)
          : runtimeEvidenceAvailable(model));
      if (backed) {
        return;
      }
      failures.push({
        tier: 1,
        message: 'line ' + (index + 1) + ' asserts ' + JSON.stringify(claim.phrase) +
          ', which claims a ' + (claim.requires === 'baseline'
            ? 'CAPTURED BASELINE'
            : 'CONFIRMED TARGET RESULT') + ' that ' +
          (named.length > 0
            ? 'scenario(s) ' + named.map(function (id) {
              return '`' + id + '` (' + evidenceStateOf(evidence, id) + ')';
            }).join(', ') + ' do not carry'
            : 'this run has no evidence for') +
          '. State the requirement prospectively, or supply the evidence. ' +
          'Offending line: ' + line.slice(0, 160)
      });
    });

    if (line.indexOf('| [x] |') !== 0) {
      return;
    }

    var measured = MEASURED_ROW_KINDS.some(function (kind) {
      return line.indexOf(kind) > -1;
    }) || named.length > 0;
    if (!measured) {
      return;
    }

    var confirming = named.filter(function (id) {
      return evidenceStateOf(evidence, id) === EVIDENCE.RECORDED;
    });
    if (confirming.length > 0) {
      return;
    }
    failures.push({
      tier: 1,
      message: 'line ' + (index + 1) + ' ticks a row whose target is a MEASUREMENT rather ' +
        'than a construction, and ' + (named.length === 0
          ? 'the row names no scenario, so there is nothing it could have measured'
          : 'none of the scenarios it names (' + named.map(function (id) {
            return '`' + id + '` (' + evidenceStateOf(evidence, id) + ')';
          }).join(', ') + ') carries a confirming replay verdict') +
        '. Source shape cannot close it: the source does not say what the measurement was. ' +
        'Offending line: ' + line.slice(0, 160)
    });
  });

  if (failures.length > 0) {
    throw selfCheckError(formatFailures({ failures: failures }));
  }
}

// The two halves of a self-contradicting instruction, matched literally in one
// rendered target cell. The left column says the site keeps the shape it has;
// the right column tells an implementer to replace that shape with an `await`.
// A cell holding one of each is not ambiguous prose -- it is two opposite
// instructions in the authoritative checklist, and an implementer following
// either one can be said to have followed the document.
var PRESERVE_INSTRUCTIONS = Object.freeze([
  'LEAVE THE INTERFACE AS IT STANDS',
  'LEAVE AS IT STANDS',
  'PRESERVE AS IT STANDS'
]);

var CONVERT_INSTRUCTIONS = Object.freeze([
  'take the `await` at this call site',
  'Create the `await` AT THIS CALL SITE',
  'await the promise form'
]);

/**
 * Refuses to write a document in which one row gives two opposite actions.
 *
 * Checked on the RENDERED rows rather than on the composition inputs, for the
 * same reason the evidence audit is: the defect was produced by composing two
 * separately-correct fragments, so only the composed string shows it. Nine
 * callback rows carried "LEAVE THE INTERFACE AS IT STANDS ... Do not promisify
 * the callee to create an `await` here" and then "GOVERNING ACTION -- take the
 * `await` at this call site", because the kept-boundary disposition was passed
 * as the `lead` in front of a governing action written for an unconverted
 * site. governingAction()'s `whenKept` variant is the fix; this is what keeps
 * it fixed.
 *
 * @param {string} document the rendered markdown
 * @returns {undefined}
 * @throws {Error} with the self-check exit code, so nothing is written
 */
function auditRenderedInstructions(document) {
  var failures = [];

  document.split('\n').forEach(function (line, index) {
    if (line.indexOf('| [') !== 0) {
      return;
    }
    var preserve = PRESERVE_INSTRUCTIONS.filter(function (phrase) {
      return line.indexOf(phrase) > -1;
    });
    var convert = CONVERT_INSTRUCTIONS.filter(function (phrase) {
      return line.indexOf(phrase) > -1;
    });
    if (preserve.length > 0 && convert.length > 0) {
      failures.push({
        tier: 1,
        message: 'line ' + (index + 1) + ' gives two opposite actions for one site: it says ' +
          JSON.stringify(preserve[0]) + ' and also ' + JSON.stringify(convert[0]) +
          '. A row states exactly one action. Offending line: ' + line.slice(0, 200)
      });
    }
  });

  if (failures.length > 0) {
    throw selfCheckError(formatFailures({ failures: failures }));
  }
}

function staleError(message) {
  var err = new Error(message);
  err.exitCode = EXIT_STALE;
  return err;
}


// Counter behind the temporary filename in writeDocumentAtomically, so two
// documents written in the same millisecond by the same process cannot
// collide.
var documentSequence = 0;

/**
 * Writes the generated document atomically, creating its directory if needed.
 *
 * The bytes go to a unique temporary file in the document's own directory,
 * which is flushed, closed and then renamed over the target. A same-directory
 * rename is atomic, so a reader sees either the previous inventory or the
 * complete new one - never a half-written file. Writing in place would let an
 * interruption or a full filesystem truncate the committed deliverable, which
 * is a tracked file a reviewer reads.
 *
 * The temporary file is removed on failure, so a failed run leaves the previous
 * document exactly as it found it.
 *
 * @param {string} out Destination path.
 * @param {string} document The rendered document.
 * @returns {undefined}
 * @throws {Error} A usage error, if the document cannot be written.
 */
function writeDocumentAtomically(out, document) {
  var target = path.resolve(out);
  var outDir = path.dirname(target);
  var temporary;
  var descriptor = null;

  try {
    fs.mkdirSync(outDir, { recursive: true });
  } catch (err) {
    throw usageError('Cannot create the output directory ' + outDir + ': ' + err.message);
  }

  documentSequence += 1;
  temporary = target + '.parity-tmp-' + process.pid + '-' + documentSequence;

  try {
    // 'wx' rather than 'w': a temporary name that already exists is a
    // collision worth failing on, not a file to overwrite.
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, document, 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(temporary, target);
  } catch (err) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      } catch (closeError) {
        // Swallowed deliberately: the write failure below is the reason worth
        // reporting, and a close error while already failing would mask it.
      }
    }

    try {
      fs.unlinkSync(temporary);
    } catch (unlinkError) {
      // The temporary file may never have been created. Either way the
      // document itself is untouched, which is the guarantee that matters.
    }

    throw usageError('Cannot write ' + out + ': ' + err.message);
  }
}

/**
 * Parse argv.
 *
 * TWO RULES, both of them about a document this tool WRITES. No option is
 * repeatable, so a second `--out` is a usage error rather than a
 * last-one-wins - a caller who named two paths has to be told which one would
 * have been used. And a value beginning with a dash is a missing value:
 * otherwise `--out --verbose` writes the checklist to a file called
 * "--verbose" and runs without the summary it was asked for, reporting neither.
 *
 * @param {string[]} argv
 * @returns {Object} the resolved options
 * @throws {Error} carrying `exitCode` EXIT_USAGE on any usage fault
 */
function parseArgs(argv) {
  var repoRoot = path.resolve(__dirname, '..', '..');
  var options = {
    app: repoRoot,
    out: null,
    replay: null,
    check: false,
    verbose: false,
    help: false,
    repoRoot: repoRoot
  };
  var seen = {};

  /** The next token, when it can be a value rather than another option. */
  function value(flag, index) {
    var next = index + 1 < argv.length ? argv[index + 1] : undefined;

    if (next === undefined) {
      throw usageError(flag + ' requires a path.\n\n' + USAGE);
    }

    if (String(next).charAt(0) === '-' && next !== '-') {
      throw usageError(flag + ' requires a path, and ' + JSON.stringify(next) +
        ' is an option.\n\n' + USAGE);
    }

    return next;
  }

  for (var i = 0; i < argv.length; i++) {
    var arg = argv[i];

    if (seen[arg]) {
      throw usageError(arg + ' was given more than once, and no option here ' +
        'is repeatable.\n\n' + USAGE);
    }
    seen[arg] = true;

    switch (arg) {
      case '--app':
        options.app = path.resolve(value('--app', i));
        i++;
        break;
      case '--out':
        options.out = path.resolve(value('--out', i));
        i++;
        break;
      case '--replay':
        options.replay = path.resolve(value('--replay', i));
        i++;
        break;
      case '--check':
        options.check = true;
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
    '  evidence        : ' + describeEvidenceSummary(model),
    '  self-check      : ' + (checks.atBaseline ? 'tiers 1-2 asserted' : 'tier 1 + directional') +
      ', ' + checks.notes.length + ' delta' + (checks.notes.length === 1 ? '' : 's') + ' reported'
  ].join('\n');
}

// The header lines that move for reasons unrelated to what was analysed, and
// which --check therefore normalizes before comparing. Each one is here for a
// specific reason:
//
//   analysed tree HEAD  -- the tree's revision, which advances on ANY commit,
//                          including the commit that stores this very document
//                          and any unrelated commit by anyone else. Comparing
//                          it would make --check fail on every subsequent
//                          commit, which is a check nobody can keep green and
//                          therefore a check nobody runs.
//   generator commit    -- moves when the generator is committed or amended,
//                          while its CONTENT is compared through
//                          "generator sha256", which is not normalized.
//
// What --check does compare is content-derived and complete: every row, the
// digest over the analysed source, the digest over the parity corpus, and the
// generator's own digest. A stale document fails on the rows or on a digest,
// which is the failure that matters.
var VOLATILE_PROVENANCE_LINES = [
  /^(\s*analysed tree HEAD\s*:).*$/m,
  /^(\s*generator commit\s*:).*$/m,
  // The machine-readable block carries both of the above, plus the body digest
  // that covers the very text being compared, so it is normalized for exactly
  // the reasons those two lines are.
  /^(<!-- provenance-json:).*$/m
];

/** Blank the volatile provenance lines so two renderings compare equal. */
function withoutTimestamp(text) {
  return VOLATILE_PROVENANCE_LINES.reduce(function (acc, pattern) {
    return acc.replace(pattern, '$1 <normalized>');
  }, text);
}

/**
 * Compare the committed document against a fresh rendering of the same tree.
 *
 * This exists because a provenance header is a claim by the artifact about
 * itself, and a stale artifact's header is exactly as confident as a current
 * one's. The check is cheap, mechanical, and answers the question a reader
 * actually has: does this document describe the tree in front of me?
 */
function checkDocument(options, document) {
  var existing;
  try {
    existing = fs.readFileSync(options.out, 'utf8');
  } catch (err) {
    throw staleError('convert-inventory --check: cannot read ' +
      path.relative(options.repoRoot, options.out) + ': ' + err.message +
      '\nThe document does not exist, so it cannot be current. Run without --check to write it.');
  }

  if (withoutTimestamp(existing) === withoutTimestamp(document)) {
    return EXIT_OK;
  }

  var existingLines = withoutTimestamp(existing).split('\n');
  var freshLines = withoutTimestamp(document).split('\n');
  var firstDifference = -1;
  for (var i = 0; i < Math.max(existingLines.length, freshLines.length); i++) {
    if (existingLines[i] !== freshLines[i]) {
      firstDifference = i;
      break;
    }
  }

  var report = [
    'convert-inventory --check: ' + path.relative(options.repoRoot, options.out) +
      ' does not describe the analysed tree.',
    '',
    'Committed document: ' + existingLines.length + ' lines.',
    'Fresh rendering:    ' + freshLines.length + ' lines.',
    'First difference at line ' + (firstDifference + 1) + ':',
    '  committed: ' + (existingLines[firstDifference] === undefined
      ? '(end of file)'
      : existingLines[firstDifference].slice(0, 160)),
    '  fresh:     ' + (freshLines[firstDifference] === undefined
      ? '(end of file)'
      : freshLines[firstDifference].slice(0, 160)),
    '',
    'Regenerate it with the exact command in its own header. A checklist that no',
    'longer matches the tree reads as completed work about code that has moved.'
  ].join('\n');
  throw staleError(report);
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

  // Read before the analysis, so a malformed artifact fails as a usage error
  // rather than half-way through a join.
  var replayArtifact = options.replay ? loadReplayArtifact(options.replay) : null;
  var model = analyseTree(options.app, replayArtifact);
  // The provenance block reports the command that produced the document, so
  // the invocation is recorded where the analysis cannot invent it.
  model.provenance.invocation = describeInvocation(options);
  // The shared provenance block, built from the same resolved facts the front
  // matter prints. Role `analysis`: this generator executes no application
  // code and starts no server, so the artifact is derived from a tree rather
  // than measured against a running one. Every value is portable by
  // construction -- the artifact is a symbolic label and the invocation is the
  // `$BASELINE`-tokenized command the header carries -- so two runs over one
  // tree are byte-identical.
  model.provenance.block = provenanceContract.build({
    artifact: path.basename(options.out),
    role: 'analysis',
    generatorFile: __filename,
    toolRoot: GENERATOR_REPO_ROOT,
    analysedRoot: options.app,
    detail: {
      artifactLabel: provenanceContract.pathLabel(path.resolve(options.out), {
        toolRoot: GENERATOR_REPO_ROOT,
        analysedRoot: path.resolve(options.app)
      }),
      invocation: model.provenance.invocation.command,
      analysedTreeLabel: model.provenance.invocation.appLabel,
      analysedSourceDigest: model.provenance.analysedDigest,
      analysedFiles: model.provenance.analysedPaths.length,
      evidenceAvailable: model.provenance.evidenceAvailable,
      evidenceCaptured: model.provenance.evidenceCaptured,
      atBaseline: model.provenance.atBaseline
    }
  });
  var checks = runSelfChecks(model);

  if (checks.failures.length > 0) {
    throw selfCheckError(formatFailures(checks));
  }

  var document = renderDocument(model, checks);

  // The evidence audit, run on the RENDERED document and before anything is
  // written. The self-checks above audit the analysis; this audits the prose,
  // where the defect it catches lives: a ticked runtime-evidence row whose
  // target asserts a captured response the corpus does not hold. A generator
  // that can emit a claim its own policy forbids will emit it again, so the
  // policy is a check rather than a sentence.
  auditRenderedEvidence(document, model);

  // The instruction audit, for the other way a composed cell goes wrong: not a
  // claim about evidence, but two opposite actions for one site.
  auditRenderedInstructions(document);

  if (options.check) {
    return checkDocument(options, document);
  }
  writeDocumentAtomically(options.out, document);

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
  QUIRK_REFS: QUIRK_REFS,
  ALLOW_LIST_COVERAGE: ALLOW_LIST_COVERAGE,
  ROW_KINDS: ROW_KINDS,
  quirkEntry: quirkEntry,
  quirkRef: quirkRef,
  governingAction: governingAction,
  composeTarget: composeTarget,
  describeHandlerTarget: describeHandlerTarget,
  describeHandlerLead: describeHandlerLead,
  anchoredQuirkRef: anchoredQuirkRef,
  pluralize: pluralize,
  analyseFunctionShape: analyseFunctionShape,
  findControllerExports: findControllerExports,
  findPromiseChains: findPromiseChains,
  isPromiseReaction: isPromiseReaction,
  findNonReactionMemberCalls: findNonReactionMemberCalls,
  statementListAlwaysExits: statementListAlwaysExits,
  readStatementList: readStatementList,
  findCallbackBoundaries: findCallbackBoundaries,
  findReplyChains: findReplyChains,
  findUnreturnedBareReplies: findUnreturnedBareReplies,
  deriveStreamSites: deriveStreamSites,
  findNamedPreHandlers: findNamedPreHandlers,
  findExportReferences: findExportReferences,
  findRouteDeclarations: findRouteDeclarations,
  findInlinePreHandlers: findInlinePreHandlers,
  findPreHandlerReferences: findPreHandlerReferences,
  assembleRouteExpression: assembleRouteExpression,
  analyseTree: analyseTree,
  loadReplayArtifact: loadReplayArtifact,
  joinReplayEvidence: joinReplayEvidence,
  measuredRowLedger: measuredRowLedger,
  chainDeliveryCensus: chainDeliveryCensus,
  runSelfChecks: runSelfChecks,
  renderDocument: renderDocument,
  auditRenderedEvidence: auditRenderedEvidence,
  auditRenderedInstructions: auditRenderedInstructions,
  parseArgs: parseArgs,
  main: main
};
