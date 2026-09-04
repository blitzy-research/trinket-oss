#!/usr/bin/env node
'use strict';

// Generator for docs/error-edge-inventory.md - the per-edge error-to-response
// checklist that rule R-e's parity claim rests on.
//
// Node core only, CommonJS, no third-party requires, no application requires.
// Writes exactly one file, the one named by --out, and never writes to stdout.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// R-e says every converted path must preserve its error-to-response mapping -
// same status codes, same error payload shapes. The migration preserves three
// shared funnels verbatim, and AAP 0.6.3 is explicit that this is *necessary
// but not sufficient*: the funnels are reached from hundreds of local
// branches, each branch decides *which* funnel its error reaches, and some
// reach none at all. "The error mappings survived" is therefore a claim about
// those branches, not about the three funnels, and the only form of it a
// reviewer can inspect is a generated, per-edge checklist. This tool generates
// it.
//
// The document is a checklist, not a report: every row carries a checkbox so
// an implementing agent closes rows one at a time, and every row names the
// route or the reachable code path that drives it so test/parity/capture.js
// can turn the row set into failure-path scenarios.
//
// ===========================================================================
// THE ROW COUNT IS NOT PREDETERMINED
// ===========================================================================
// AAP 0.1.1.1 records 132 functions with an `err` parameter in
// lib/controllers/**. That is a SIZING METRIC AND NOTHING ELSE. A crude grep
// over the baseline tree returns 133 rather than 132 depending on the pattern
// used, which is itself the point:
//
//   - one callback can carry zero error dispositions (it never inspects
//     `err`) or several (a guard, a log, and a late resolve);
//   - promise `.catch` handlers and synchronous `throw` statements add edges
//     entirely outside the `err`-parameter count;
//   - a `reply(` call site is only an error edge when what it carries is an
//     error, and 61 of the baseline's 202 sites carry success payloads.
//
// So this tool counts edges and reports the number it found. It does not
// target a number, and the generated document says so near the top.
//
// ===========================================================================
// MEASURED FIGURES, AND WHAT THEY GUARD
// ===========================================================================
// Measured over the baseline worktree at 2f8712a with `grep -o | wc -l`,
// which is unaffected by this tool's tokenizer and therefore an independent
// witness:
//
//   reply( sites          202  =  172 lib/controllers/*.js
//                                +  29 lib/util/helpers.js
//                                +   1 config/api_routes.js:1104
//   .then( sites          183     across the ten controllers
//   .catch( sites          85     across the ten controllers
//   err-parameter fns     133     sizing metric only (AAP quotes 132)
//
// None of those tokens occurs inside a comment or a string literal in the
// baseline tree - verified - so a tokenizer that is working must reproduce
// the first three exactly. When it does not, it has desynchronized and the
// inventory it would emit is quietly incomplete, which is worse than no
// inventory at all. BASELINE_COUNTS below is asserted for that reason.
//
// The assertion is conditional, and it has to be. The baseline figures are
// properties of 2f8712a, not of every tree: the same measurement over a
// converted tree returns 26 + 11 + 0 reply( sites, 186 `.then(` and 95
// `.catch(`, because conversion is exactly what removes the legacy idiom. A
// tool that hard-failed on those numbers could not be run against the tree it
// ships in, and AAP 0.4.1 requires it to be - "re-generated from the target to
// show rows closing". So:
//
//   --counts-check=auto    (default) hard-assert when the analysed tree is
//                          detected as the baseline; otherwise report the
//                          observed counts as deltas against the baseline.
//   --counts-check=strict  hard-assert always. Use this against a baseline
//                          worktree, where it is the Phase 6 gate.
//   --counts-check=off     report only. Recorded in the document as such.
//
// Baseline detection uses three independent signals, any one of which is
// sufficient: the analysed tree's `git rev-parse HEAD` is BASELINE_COMMIT; or
// all three counts already match; or the legacy-handler fingerprint - the
// number of `function (request, reply)` declarations in the ten controllers -
// is at or above LEGACY_FINGERPRINT_FLOOR. That fingerprint is 145 at
// baseline and 2 after conversion, a clean separation, and it is what keeps
// the guard live on a baseline tree with no usable git metadata.
//
// Independently of all of that, SELF_TESTS runs on every invocation and
// hard-fails on any mismatch. It is the guard that does not depend on which
// tree is being analysed, and it includes the exact hazard AAP 0.4.1 names:
// the regex literal at config/routes.js:87 whose character class contains a
// single quote and a double quote. A tokenizer that treats that quote as a
// string delimiter desynchronizes everything after it - in a measured trial
// it under-counted `payload` keys - and the same class of bug silently drops
// error edges.
//
// ===========================================================================
// STATIC ANALYSIS, AND WHY IT IS NOT `require`
// ===========================================================================
// The controllers are read as text and never required. This is not a
// preference. lib/controllers/users.js creates the exports queue at module
// load and loads the AWS SDK a line later; lib/controllers/* pull in
// config/app.config transitively, which loads config/db and calls
// mongoose.connect. Requiring one controller to inventory it would open
// sockets, print the in-memory-queue line and the SDK maintenance notice, and
// exit non-zero without a database - and this tool has to run on a baseline
// worktree that has no install at all.
//
// No JavaScript parser is available: acorn, esprima, espree and @babel are
// all absent from node_modules, and declaring one is package.json work this
// file does not own. So the analysis is built on a hand-written scanner that
// classifies every offset in a source file as code, string, template,
// regex or comment, and then does all structural matching against a copy of
// the source with the non-code offsets blanked to spaces. Blanking preserves
// length and newlines, so every offset still maps to its original line, and
// braces, parentheses and keywords inside literals and comments cannot
// confuse the structural passes.
//
// ===========================================================================
// WHAT A ROW SAYS
// ===========================================================================
// Disposition is a CLOSED vocabulary of SEVEN values, and every row carries
// exactly one of them. Six are the ones AAP 0.6.3 enumerates:
//
//   calls request.fail locally | calls reply(err) | returns or throws a Boom
//   logs and continues | swallows silently | resolves on a later callback
//
// The seventh is this tool's own addition and is marked as such wherever it
// appears, here and in the document:
//
//   propagates to its caller
//
// It exists because none of the six can describe a callback that hands its
// error to an outer continuation - `reject(err)`, `next(err)`,
// `resolve({err: err})` - and labelling such an edge with the nearest of the
// six states something false about it. "Swallows silently" is wrong twice
// over, since the error is neither absorbed nor silent and the awaiting
// caller decides the response; "logs and continues" is wrong for a callback
// that logs AND rejects. R-e exists so these rows can be acted on without
// re-deriving them, so the vocabulary carries the value the rows need. See
// DISPOSITION for the same note at the definition.
//
// Seven values cannot express the sub-shapes that a mechanical conversion
// changes silently, so each row also carries a Shape - `reply(err) with no
// return`, `.catch(request.fail) bare reference`, `synchronous throw
// (TypeError)`, `CPS callback boundary`, and so on. Shape is descriptive and
// open; Disposition is the closed vocabulary. The document states the mapping.
//
// Funnel is Layer 1, Layer 2, Layer 3 or none. `none` is a legitimate and
// important value: an edge that produces no response at all is the edge most
// likely to be converted into one by accident.
//
// Target states the PRESERVED outcome - status, payload or redirect, side
// effects, timing. It never proposes a fix. R-d prohibits improvements, and a
// row that recommended repairing a swallowed error would send an implementing
// agent in precisely the wrong direction. Where the baseline outcome is a
// defect, the row says so and requires the defect.
//
// ===========================================================================
// KNOWN LIMITS, STATED RATHER THAN HIDDEN
// ===========================================================================
//  - Expression-bodied arrow functions get an approximated body extent (to
//    the enclosing delimiter). The analysed files contain none in the
//    baseline tree; the approximation exists so a converted tree does not
//    silently lose rows.
//  - Downstream-catch resolution is lexical: it finds `.catch(` links in the
//    same statement at the chain's own depth. A rejection that crosses a
//    function boundary into a caller's chain is reported as reaching the
//    handler catch-all, with the carrier named so a reviewer can confirm.
//  - Route binding reads the literal `route :` declarations in
//    config/routes.js and config/api_routes.js. The per-language expansion
//    loop multiplies those declarations at parse time; the document reports
//    the literal declaration and says so. test/parity/manifest.js owns the
//    expanded 233-entry manifest.
//
// ===========================================================================
// USAGE
// ===========================================================================
// The option list is NOT duplicated here. `--help` prints it from the USAGE
// constant near the CLI at the foot of this file, which is the one place it is
// written and the one place it is maintained - a second copy in this comment
// was already a version behind the parser by the time it was read.
//
//   node test/parity/error-edges.js --help
//
// In outline: `--app` and `--baseline` name the two trees; `--scenarios`
// names the capture corpus; `--out`, `--edge-index` and `--provenance-out`
// name the three artifacts, each written only if asked for; `--closure-gate`
// and `--coverage-gate` turn findings into exit codes and are evaluated
// BEFORE anything is written, so a failed gate never leaves a document on
// disk asserting its own failure.
//
// Exit 0 on success. Exit 1 on any failure, with the reason on stderr.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// The provenance contract shared by every tool in test/parity/ and by the two
// generated inventories in docs/. It is required from manifest.js because that
// is the only tool that is Node-core-only at module scope, so requiring it
// costs this generator nothing, and because a second copy of these guarantees
// would drift from the first. What it adds to the block this file already
// carried is the part a local implementation could not: the generator is
// identified by its git BLOB (`git hash-object`) and by a commit only when
// that commit's tree actually holds that blob, and the document is bound to
// its own prose by a `bodyDigest`. `git log -1 -- <path>` names the last
// commit that touched the path, which is a different claim and is false for an
// uncommitted generator, so it is no longer the identity this document prints.
const { provenance } = require('./manifest');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// R-f's tie-breaker reference. Baseline claims are taken at this commit.
const BASELINE_COMMIT = '2f8712a112db46f923918c4507c75abc732d83d0';

// Measured at BASELINE_COMMIT. See "MEASURED FIGURES" above.
const BASELINE_COUNTS = Object.freeze({
  replyControllers: 172,
  replyHelpers: 29,
  replyInlinePre: 1,
  replyTotal: 202,
  thenControllers: 183,
  catchControllers: 85,
  errParamFunctionsSizingMetric: 132,
  legacyHandlerDeclarations: 145
});

// `function (request, reply)` declarations in the ten controllers: 145 at
// baseline, 2 after conversion. Any tree at or above this floor is treated as
// a baseline tree for the purpose of the count assertions.
const LEGACY_FINGERPRINT_FLOOR = 100;

// The ten controllers, lib/util/helpers.js and the one inline pre-handler in
// config/api_routes.js. Sorted by path, which is also the document's section
// order - deterministic by construction.
const ANALYSIS_TARGETS = Object.freeze([
  'config/api_routes.js',
  'lib/controllers/admin.js',
  'lib/controllers/auth.js',
  'lib/controllers/classes.js',
  'lib/controllers/course.js',
  'lib/controllers/courses.js',
  'lib/controllers/files.js',
  'lib/controllers/folders.js',
  'lib/controllers/pages.js',
  'lib/controllers/trinket.js',
  'lib/controllers/users.js',
  'lib/util/helpers.js'
]);

const CONTROLLER_FILES = Object.freeze(
  ANALYSIS_TARGETS.filter((p) => p.indexOf('lib/controllers/') === 0)
);

const HELPERS_FILE = 'lib/util/helpers.js';
const INLINE_PRE_FILE = 'config/api_routes.js';

// Read for route binding only. Not an edge-analysis target, and optional: a
// tree without it still produces a complete inventory, with carriers naming
// the reachable code path instead of a route.
const ROUTE_MODULES = Object.freeze(['config/routes.js', 'config/api_routes.js']);

// The closed Disposition vocabulary of AAP 0.6.3. Exactly one per row.
const DISPOSITION = Object.freeze({
  FAIL_LOCAL: 'calls request.fail locally',
  REPLY_ERR: 'calls reply(err)',
  BOOM: 'returns or throws a Boom',
  LOG_CONTINUE: 'logs and continues',
  SWALLOW: 'swallows silently',
  LATE_RESOLVE: 'resolves on a later callback',
  // The seventh value, and the one addition this tool makes to AAP 0.6.3's
  // list. It exists because the six above cannot describe a callback that
  // hands its error to an outer continuation - `reject(err)`,
  // `resolve({err: err, ...})`, `next(err)` - and marking such an edge with
  // any of the six states something false about it. "Swallows silently" is
  // the wrong one twice over: the error is neither absorbed nor silent, and a
  // reviewer reading that row would conclude no response can follow from the
  // failure when in fact the awaiting caller decides the response. "Logs and
  // continues" is equally wrong for a callback that logs AND rejects, because
  // the continuation is a rejection rather than the normal path. R-e exists so
  // these rows can be trusted, so the vocabulary carries the value the rows
  // need rather than the nearest of six. The document states this addition and
  // its reason where it lists the vocabulary.
  PROPAGATE: 'propagates to its caller'
});

const DISPOSITION_ORDER = Object.freeze([
  DISPOSITION.FAIL_LOCAL,
  DISPOSITION.REPLY_ERR,
  DISPOSITION.BOOM,
  DISPOSITION.LOG_CONTINUE,
  DISPOSITION.PROPAGATE,
  DISPOSITION.SWALLOW,
  DISPOSITION.LATE_RESOLVE
]);

// The six values AAP 0.6.3 enumerates, kept separately so the document can
// state exactly which of its dispositions come from the plan and which one
// does not.
const AAP_DISPOSITIONS = Object.freeze([
  DISPOSITION.FAIL_LOCAL,
  DISPOSITION.REPLY_ERR,
  DISPOSITION.BOOM,
  DISPOSITION.LOG_CONTINUE,
  DISPOSITION.SWALLOW,
  DISPOSITION.LATE_RESOLVE
]);

// A row's stable identity is (file, carrier, class, ordinal). CLASS is the
// coarse bucket that SURVIVES conversion, which is the whole point: a
// `reply(err)` site becomes `return errors.notFound()` and its disposition
// changes from REPLY_ERR to BOOM, so an identity keyed on disposition would
// never match its own target row. Line numbers are excluded for the same
// reason - every one of them moves.
const EDGE_CLASS = Object.freeze({
  // A site that produces an error response on its own stack: reply(err),
  // request.fail(...), throw, return Boom, the reply.<prop> TypeError, and an
  // unbound Boom reference. Passes A-E.
  RESPONSE: 'response',
  // A .catch(...) or .on('error', ...) handler. Pass F.
  HANDLER: 'handler',
  // A continuation-passing callback that produces the response. Pass G.
  CPS: 'cps',
  // An error parameter nothing dispositions. Pass H.
  ERR_PARAM: 'errparam'
});

// Differences between a baseline row and its target row that are APPROVED
// rather than failures. AAP 0.7 records exactly one approved behaviour
// deviation - the never-settling image branch of the file download at
// lib/controllers/files.js - and its `reply(stream)` sites carry a stream, not
// an error, so Pass A skips them and no error edge exists for it. The list is
// therefore empty, and it is empty by measurement rather than by omission.
//
// It is a LIST OF IDENTITIES, not a marker convention, deliberately: a
// comparator that approved a difference because the tree said "approved"
// would approve any difference at all. An entry must name the exact edge id
// and the exact from/to outcome, and a difference that does not match the
// entry it claims is still a failure.
const APPROVED_DEVIATIONS = Object.freeze([]);

const FUNNEL = Object.freeze({
  L1: 'Layer 1',
  L2: 'Layer 2',
  L3: 'Layer 3',
  NONE: 'none'
});

// The two documents this one deliberately does not duplicate. Every claim
// about *why* a defect is kept belongs to the quirk catalogue, and every
// claim about which call sites still need a `return`/`await` belongs to the
// conversion checklist. Rows cross-reference them; they do not restate them.
const SIBLING_DOCS = Object.freeze({
  quirks: 'docs/preserved-quirks.md',
  conversion: 'docs/conversion-inventory.md'
});

// Edges that are also catalogued quirks, matched on properties that survive a
// conversion - carrier name, thrown kind, mechanism - rather than on line
// numbers, which move. A matcher that finds nothing simply emits no
// cross-reference, so a closed row does not produce a dangling one.
const QUIRK_CROSS_REFERENCES = Object.freeze([
  {
    section: '5',
    title: 'the two `pages` handlers that answer 500 to authenticated visitors',
    match: function (edge) {
      return Boolean(edge.thrownKind) && edge.thrownKind.kind === 'type-error';
    }
  },
  {
    // Section 8.1 is specifically the `_request.get(...).on('error')` listener
    // in the user-asset upload, not every stream error listener in the tree:
    // the other `.on('error')` sites are archive and download streams with
    // their own outcomes. Matching them here would point a reviewer at the
    // wrong catalogue entry, so the predicate names the file and the
    // disposition as well as the mechanism.
    section: '8.1',
    title: 'the streaming asset fetch\'s two failure modes',
    match: function (edge) {
      return edge.file === 'lib/controllers/users.js' &&
        edge.disposition === DISPOSITION.LOG_CONTINUE &&
        edge.mechanism === '.on(\'error\')';
    }
  },
  {
    section: '6',
    title: 'Google OAuth\'s new-user path, which saves the user and then reports failure',
    match: function (edge) {
      return edge.carrier === 'auth.googleCallback';
    }
  },
  {
    section: '7',
    title: '`folders.trinkets`, whose injected URL is malformed when no query is present',
    match: function (edge) {
      return edge.carrier === 'folders.trinkets';
    }
  },
  {
    // Section 4.4 is one site: the `reply(err)` with no return inside a
    // `.catch` in the trinket controller. The other unreturned replies carry
    // Boom factories rather than the caught error and are not that entry.
    section: '4.4',
    title: 'the unreturned reply on an error path',
    match: function (edge) {
      return edge.file === 'lib/controllers/trinket.js' &&
        edge.disposition === DISPOSITION.REPLY_ERR &&
        edge.returned === false &&
        Boolean(edge.valueKind) && edge.valueKind.kind === 'error-identifier';
    }
  },
  {
    // Section 3's blast radius is the routes whose `fail.redirect` carries a
    // placeholder: interpolating a literal string is idempotent, so only a
    // template can be consumed. The leak-bearing routes are MEASURED from the
    // route declarations rather than listed here, so this reference cannot
    // drift from the tree.
    section: '3',
    title: 'the cross-request state leak in `fail.redirect`',
    match: function (edge, bindings) {
      if (edge.disposition !== DISPOSITION.FAIL_LOCAL || !bindings ||
        !bindings.templatedFailRedirects) {
        return false;
      }
      return edge.routes.some(function (spec) {
        return bindings.templatedFailRedirects.has(spec);
      });
    }
  }
]);

/**
 * The `See also` targets for one edge: the quirk sections that catalogue it,
 * and - where the missing `return` is what the conversion has to fix - the
 * conversion checklist that owns that call site.
 *
 * Deterministic: QUIRK_CROSS_REFERENCES is evaluated in declaration order and
 * the conversion reference is appended last.
 */
function crossReferences(edge, bindings) {
  const refs = QUIRK_CROSS_REFERENCES.filter(function (entry) {
    return entry.match(edge, bindings);
  }).map(function (entry) {
    return SIBLING_DOCS.quirks + ' section ' + entry.section + ' - ' + entry.title;
  });

  if (edge.returned === false) {
    refs.push(
      SIBLING_DOCS.conversion + ' - this call site has no `return`, so the ' +
      'per-site return/await disposition is tracked there as well as here'
    );
  }

  return refs;
}

// Boom factory -> status. Used to state the status a row must preserve rather
// than leaving the reader to look it up. Every factory the analysed tree uses
// is present; unknown factories are reported without a status rather than
// guessed.
const BOOM_STATUS = Object.freeze({
  badRequest: 400,
  unauthorized: 401,
  paymentRequired: 402,
  forbidden: 403,
  notFound: 404,
  methodNotAllowed: 405,
  notAcceptable: 406,
  proxyAuthRequired: 407,
  clientTimeout: 408,
  conflict: 409,
  resourceGone: 410,
  lengthRequired: 411,
  preconditionFailed: 412,
  entityTooLarge: 413,
  uriTooLong: 414,
  unsupportedMediaType: 415,
  rangeNotSatisfiable: 416,
  expectationFailed: 417,
  teapot: 418,
  badData: 422,
  locked: 423,
  failedDependency: 424,
  tooEarly: 425,
  preconditionRequired: 428,
  tooManyRequests: 429,
  illegal: 451,
  internal: 500,
  badImplementation: 500,
  notImplemented: 501,
  badGateway: 502,
  serverUnavailable: 503,
  gatewayTimeout: 504
});

// A `/` opens a regex literal when the preceding significant token cannot end
// a value. After an identifier the answer depends on which identifier: these
// are the keywords a regex may follow.
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw'
]);

// Offset classification produced by classifySource. Literal interiors are
// marked; the delimiters themselves stay CODE, because the scanner's
// value-boundary logic reads them - a `/` after a closing quote is division.
const KIND = Object.freeze({ CODE: 0, STRING: 1, TEMPLATE: 2, REGEX: 3, COMMENT: 4 });

// Names treated as error-valued when they appear as the first argument of a
// reply() call or as the parameter of a catch handler.
const ERROR_IDENTIFIERS = new Set(['err', 'error', 'e', 'ex', 'exception', 'reason']);

// Callee tails that make a function argument a promise continuation rather
// than a continuation-passing callback.
const PROMISE_CONTINUATIONS = new Set(['then', 'catch', 'finally']);

// Callee tails whose function argument is a synchronous iteratee, not a
// deferred callback. A response produced inside one of these still settles
// within the same turn, so it is not a late resolve.
const SYNCHRONOUS_ITERATEES = new Set([
  'forEach', 'map', 'filter', 'reduce', 'reduceRight', 'some', 'every', 'find',
  'findIndex', 'sort', 'each', 'pluck', 'reject', 'extendOwn', 'bind', 'call',
  'apply', 'flatten', 'groupBy', 'sortBy', 'indexBy', 'partition'
]);

// Calls whose sole purpose is to emit a log line. A handler body that touches
// its error only through one of these logs and continues.
const LOGGING_CALLS = [
  'console.log', 'console.error', 'console.warn', 'console.info',
  'console.debug', 'console.trace', 'log.error', 'log.warn', 'log.info',
  'log.debug', 'log.verbose', 'log.silly', 'logger.error', 'logger.warn',
  'logger.info', 'logger.debug'
];

// ---------------------------------------------------------------------------
// Failures
// ---------------------------------------------------------------------------

// Every failure in this tool is loud. AnalysisError carries the reason to the
// CLI, which prints it on stderr and exits 1. Nothing is swallowed, and no
// partial document is written: the single write happens once, after every
// check has passed, and it publishes through a temporary file and a rename so
// an interrupted write cannot truncate the document either (see
// writeDocumentAtomically).
class AnalysisError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalysisError';
  }
}

// Counter behind the temporary filename in writeDocumentAtomically, so two
// documents written in the same millisecond by the same process cannot
// collide.
let documentSequence = 0;

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
 * @param {string} target Absolute destination path.
 * @param {string} document The rendered document.
 * @returns {undefined}
 * @throws {AnalysisError} If the document cannot be written.
 */
function writeDocumentAtomically(target, document) {
  let temporary;
  let descriptor = null;

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  catch (err) {
    throw new AnalysisError('cannot create the directory for ' + target + ': ' +
      err.message);
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
  }
  catch (err) {
    if (descriptor !== null) {
      try {
        fs.closeSync(descriptor);
      }
      catch (closeError) {
        // Swallowed deliberately: the write failure below is the reason worth
        // reporting, and a close error while already failing would mask it.
      }
    }

    try {
      fs.unlinkSync(temporary);
    }
    catch (unlinkError) {
      // The temporary file may never have been created. Either way the
      // document itself is untouched, which is the guarantee that matters.
    }

    throw new AnalysisError('cannot write ' + target + ': ' + err.message);
  }
}

// ---------------------------------------------------------------------------
// Source classification - the scanner
// ---------------------------------------------------------------------------

/**
 * Split a JavaScript source into code and non-code offsets.
 *
 * Returns { kinds, codeOnly }, both exactly `src.length` long:
 *
 *   kinds     Uint8Array of KIND values. Literal interiors and whole comments
 *             are marked; delimiters stay CODE.
 *   codeOnly  the source with comment text, string interiors, template text
 *             and regex bodies replaced by spaces. Newlines are preserved, so
 *             offset -> line arithmetic is identical on both strings, and
 *             every structural pass in this file matches against codeOnly
 *             while reading display text from `src`.
 *
 * Throws AnalysisError on an unterminated literal, comment or interpolation.
 * That is the point: an unterminated literal at EOF is the signature of a
 * desynchronized scan, and a desynchronized scan silently drops error edges.
 *
 * @param {string} src   file contents
 * @param {string} label path or name used in error messages
 */
function classifySource(src, label) {
  const n = src.length;
  const kinds = new Uint8Array(n);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = src[i];
  }

  function fail(what, offset) {
    throw new AnalysisError(
      'scanner desynchronized in ' + label + ': unterminated ' + what +
      ' beginning at line ' + lineNumberAt(src, offset) +
      ' (offset ' + offset + ')'
    );
  }

  function blank(from, to, kind) {
    const stop = Math.min(to, n);
    for (let k = Math.max(from, 0); k < stop; k++) {
      kinds[k] = kind;
      out[k] = src[k] === '\n' ? '\n' : ' ';
    }
  }

  function isIdentChar(ch) {
    return ch === '_' || ch === '$' ||
      (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9');
  }

  // Whether the `/` at offset i opens a regex literal. Walks back through
  // already-blanked whitespace - which includes every comment consumed so far,
  // because comments are blanked whole - to the previous significant token.
  function regexAllowedAt(i) {
    let j = i - 1;
    while (j >= 0 && (out[j] === ' ' || out[j] === '\n' || out[j] === '\t' || out[j] === '\r')) {
      j--;
    }
    if (j < 0) {
      return true;
    }
    const prev = out[j];
    if (isIdentChar(prev)) {
      let k = j;
      while (k >= 0 && isIdentChar(out[k])) {
        k--;
      }
      return REGEX_PRECEDING_KEYWORDS.has(out.slice(k + 1, j + 1).join(''));
    }
    // A value ended here, so `/` divides it.
    if (prev === ')' || prev === ']' || prev === '.' ||
        prev === '\'' || prev === '"' || prev === '`') {
      return false;
    }
    // `}` closes a block far more often than an object literal in this
    // codebase, so a regex may follow. Either answer is safe: tryScanRegex
    // refuses any candidate containing a newline, which is what an
    // accidentally-opened regex would immediately hit.
    return true;
  }

  // Returns { bodyEnd, end } for a regex literal at i, or null when the
  // candidate is not one. A regex literal cannot contain an unescaped
  // newline, so hitting one means the `/` was division after all.
  function tryScanRegex(i) {
    let j = i + 1;
    let inClass = false;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '\n') {
        return null;
      }
      if (inClass) {
        if (ch === ']') {
          inClass = false;
        }
      } else if (ch === '[') {
        inClass = true;
      } else if (ch === '/') {
        let k = j + 1;
        while (k < n && src[k] >= 'a' && src[k] <= 'z') {
          k++;
        }
        return { bodyEnd: j, end: k };
      }
      j++;
    }
    return null;
  }

  function scanQuoted(i, quote) {
    let j = i + 1;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === quote) {
        blank(i + 1, j, KIND.STRING);
        return j + 1;
      }
      if (ch === '\n') {
        fail('string literal', i);
      }
      j++;
    }
    return fail('string literal', i);
  }

  function scanTemplate(i) {
    let j = i + 1;
    let textStart = j;
    while (j < n) {
      const ch = src[j];
      if (ch === '\\') {
        j += 2;
        continue;
      }
      if (ch === '`') {
        blank(textStart, j, KIND.TEMPLATE);
        return j + 1;
      }
      if (ch === '$' && src[j + 1] === '{') {
        blank(textStart, j, KIND.TEMPLATE);
        j = scanTemplateExpression(j + 2);
        textStart = j;
        continue;
      }
      j++;
    }
    return fail('template literal', i);
  }

  // Scans the code inside `${ ... }`, honouring nested literals and braces,
  // and returns the offset just past the matching `}`.
  function scanTemplateExpression(i) {
    let depth = 0;
    let j = i;
    while (j < n) {
      const next = scanUnit(j);
      if (next !== -1) {
        j = next;
        continue;
      }
      const ch = src[j];
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        if (depth === 0) {
          return j + 1;
        }
        depth--;
      }
      j++;
    }
    return fail('template interpolation', i);
  }

  // Consumes one lexical unit at i and returns the next offset, or -1 when i
  // holds a plain code character.
  function scanUnit(i) {
    const c = src[i];
    if (c !== '/' && c !== '"' && c !== '\'' && c !== '`') {
      return -1;
    }
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      let j = i + 2;
      while (j < n && src[j] !== '\n') {
        j++;
      }
      blank(i, j, KIND.COMMENT);
      return j;
    }
    if (c === '/' && c2 === '*') {
      let j = i + 2;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) {
        j++;
      }
      if (j >= n) {
        fail('block comment', i);
      }
      blank(i, j + 2, KIND.COMMENT);
      return j + 2;
    }
    if (c === '"' || c === '\'') {
      return scanQuoted(i, c);
    }
    if (c === '`') {
      return scanTemplate(i);
    }
    if (regexAllowedAt(i)) {
      const found = tryScanRegex(i);
      if (found) {
        blank(i + 1, found.bodyEnd, KIND.REGEX);
        return found.end;
      }
    }
    return -1;
  }

  let i = 0;
  while (i < n) {
    const next = scanUnit(i);
    if (next !== -1) {
      i = next;
      continue;
    }
    i++;
  }

  return { kinds: kinds, codeOnly: out.join('') };
}

/** 1-based line number of an offset. */
function lineNumberAt(src, offset) {
  let line = 1;
  const stop = Math.min(offset, src.length);
  for (let i = 0; i < stop; i++) {
    if (src[i] === '\n') {
      line++;
    }
  }
  return line;
}

/** Offsets of the first character of every line, for O(log n) line lookup. */
function buildLineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '\n') {
      starts.push(i + 1);
    }
  }
  return starts;
}

function lineFromIndex(starts, offset) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo + 1;
}

/** Count non-overlapping occurrences of a literal token in a string. */
function countOccurrences(haystack, needle) {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) {
      return count;
    }
    count++;
    from = at + needle.length;
  }
}

// ---------------------------------------------------------------------------
// Scanner self-tests
// ---------------------------------------------------------------------------
//
// These run on every invocation, before any tree is touched, and they are the
// desync guard that does not depend on which tree is analysed. Case 1 is the
// exact hazard AAP 0.4.1 names: the regex literal at config/routes.js:87
// carries both a single and a double quote inside its character class, and a
// scanner that treats either as a string delimiter loses everything after it.

const SELF_TESTS = Object.freeze([
  {
    name: 'regex literal whose character class holds both quote characters (config/routes.js:87)',
    source: 'var re = /^[\\w`~!@#$%^&*+=:;\'"<>,.?{}\\-\\/\\(\\)\\[\\]\\|\\\\\\s]*$/;\nif (x) { reply(err); }\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'string literal containing the token',
    source: 'var s = "reply(err)";\nvar t = \'reply(\';\nreply(err);\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'line comment containing the token',
    source: '// reply(err) used to live here\nreply(err);\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'block comment containing the token, including a stray quote',
    source: '/* reply(err) and it\'s gone */\nreply(err);\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'division is not mistaken for a regex',
    source: 'var a = b / c;\nvar d = (e + f) / g;\nvar h = i[0] / 2;\nvar j = 100 / 4;\nreply(err);\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'regex after a keyword, with a quote inside it',
    source: 'return /x\'y/.test(s) ? reply(err) : 0;\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'regex character class containing a slash',
    source: 'var re = /a[/]b/g;\nreply(err);\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'escaped quote inside a string',
    source: 'var s = \'it\\\'s reply( still a string\';\nreply(err);\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'template literal: text is not code, interpolation is',
    source: 'var s = `text reply( ${ a ? reply(err) : `${ "reply(" }` } tail`;\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'template literal with a brace inside its text',
    source: 'var s = `a { b ${ x } c } d`;\nreply(err);\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'comment immediately before a regex',
    source: 'var re = /* pick one */ /a\'b/;\nreply(err);\n',
    token: 'reply(',
    expected: 1
  },
  {
    name: 'brace-matching is unaffected by braces inside literals',
    source: 'function f() { var s = "}{"; var r = /}{/; /* } */ reply(err); }\n',
    token: 'reply(',
    expected: 1
  }
]);

const SELF_TESTS_THROWING = Object.freeze([
  { name: 'unterminated string literal', source: 'var s = \'abc\nreply(err);\n' },
  { name: 'unterminated block comment', source: 'var a = 1; /* forever\nreply(err);\n' },
  { name: 'unterminated template literal', source: 'var s = `abc ${ d } e\n' }
]);

/**
 * Run the scanner self-tests. Throws AnalysisError on the first failure, with
 * the case name, the expectation and what was actually produced.
 */
function runSelfTests() {
  SELF_TESTS.forEach(function (test) {
    const classified = classifySource(test.source, 'self-test: ' + test.name);
    const actual = countOccurrences(classified.codeOnly, test.token);
    if (actual !== test.expected) {
      throw new AnalysisError(
        'scanner self-test failed - "' + test.name + '": expected ' +
        test.expected + ' code occurrence(s) of "' + test.token + '", found ' +
        actual + '. The scanner is desynchronized; refusing to emit an ' +
        'inventory that would be quietly incomplete.'
      );
    }
    if (classified.codeOnly.length !== test.source.length) {
      throw new AnalysisError(
        'scanner self-test failed - "' + test.name + '": blanked source is ' +
        classified.codeOnly.length + ' characters, source is ' +
        test.source.length + '. Offset arithmetic would be wrong.'
      );
    }
  });

  SELF_TESTS_THROWING.forEach(function (test) {
    let threw = false;
    try {
      classifySource(test.source, 'self-test: ' + test.name);
    } catch (err) {
      threw = err instanceof AnalysisError;
      if (!threw) {
        throw err;
      }
    }
    if (!threw) {
      throw new AnalysisError(
        'scanner self-test failed - "' + test.name + '": expected an ' +
        'AnalysisError, none was raised. An unterminated literal is the ' +
        'signature of a desynchronized scan and must not pass silently.'
      );
    }
  });

  ANALYSIS_SELF_TESTS.forEach(function (test) {
    const actual = test.run();
    if (actual !== test.expected) {
      throw new AnalysisError(
        'analysis self-test failed - "' + test.name + '": expected ' +
        JSON.stringify(test.expected) + ', got ' + JSON.stringify(actual) +
        '. The classifier that produces every row is wrong, so the inventory ' +
        'it would emit is wrong; refusing to write it.'
      );
    }
  });

  return SELF_TESTS.length + SELF_TESTS_THROWING.length + ANALYSIS_SELF_TESTS.length;
}

// ---------------------------------------------------------------------------
// Analysis self-tests
//
// The scanner tests above prove the tokenizer stays in sync. These prove the
// CLASSIFIERS built on it are right, and each one is pinned to a defect that
// was measured in this generator's own output: a wrong answer here put a
// false statement in a generated R-e deliverable, which is worse than an
// absent one because it reads as a measurement. They run on every invocation,
// like the scanner tests, so the failure surfaces before a document is
// written rather than in a review of the document.
// ---------------------------------------------------------------------------

const ANALYSIS_SELF_TESTS = Object.freeze([
  {
    // A pipe inside a code span used to split the Markdown row it sat in, and
    // `||` is common in error expressions - `err.message || String(err)` -
    // so the rows most worth reading were the ones that broke. The assertion
    // is a property rather than a literal: no pipe survives unescaped, and
    // every pipe that was there is still represented.
    name: 'no pipe survives a source fragment unescaped',
    run: function () {
      const rendered = code('err.message || String(err)');
      const bare = rendered.replace(/\\\|/g, '');
      return String(bare.indexOf('|') === -1) + '/' +
        (rendered.match(/\\\|/g) || []).length;
    },
    expected: 'true/2'
  },
  {
    name: 'a backslash in a source fragment is escaped, and before any pipe is',
    run: function () {
      // A regex literal is the realistic case: escaping the pipe first and
      // the backslash second would double the escape character that the pipe
      // escape just introduced.
      const rendered = escapeInline('/^[a-z\\|]+$/');
      return String(rendered.indexOf('\\\\') !== -1) + '/' +
        String(rendered.indexOf('\\|') !== -1);
    },
    expected: 'true/true'
  },
  {
    name: 'a newline in a source fragment cannot break out of its row',
    run: function () {
      return code('a\nb');
    },
    expected: '`a b`'
  },
  {
    name: 'prose interpolated into a table cell has its pipes escaped',
    run: function () {
      return cell('Layer 3 | 500');
    },
    expected: 'Layer 3 \\| 500'
  },
  {
    // 61 baseline sites read as Boom factories while `Boom` was unbound.
    name: 'an unbound Boom holder is a ReferenceError, not a Boom factory',
    run: function () {
      const src = 'var errors = require("@hapi/boom");\nfunction f() { return Boom.forbidden(); }\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      const kind = valueKind('Boom.forbidden()', bindings, src.indexOf('Boom.forbidden'));
      return kind.kind + '/' + kind.status + '/' + kind.nominalStatus;
    },
    expected: 'unbound-reference/500/403'
  },
  {
    name: 'a bound Boom holder is a Boom factory with its own status',
    run: function () {
      const src = 'var Boom = require("@hapi/boom");\nfunction f() { return Boom.forbidden(); }\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      const kind = valueKind('Boom.forbidden()', bindings, src.indexOf('Boom.forbidden'));
      return kind.kind + '/' + kind.status;
    },
    expected: 'boom/403'
  },
  {
    // `.catch(` matched the catch-clause pattern, so every identifier in a
    // catch handler's body was harvested as a declared name and `Boom` came
    // back bound in a file that never binds it.
    name: 'a .catch() method call is not read as a catch clause parameter list',
    run: function () {
      const src = 'var errors = require("x");\np.catch(function(err) { return reply(Boom.forbidden(err)); });\n';
      const names = collectDeclaredNames(classifySource(src, 't').codeOnly);
      return String(names.has('Boom'));
    },
    expected: 'false'
  },
  {
    name: 'a real catch clause parameter is a declared name',
    run: function () {
      const src = 'try { f(); } catch (Boom) { g(Boom); }\n';
      const names = collectDeclaredNames(classifySource(src, 't').codeOnly);
      return String(names.has('Boom'));
    },
    expected: 'true'
  },
  {
    // The flat per-file name set reported this BOUND, so a line that throws
    // ReferenceError at runtime was recorded with its factory's own status.
    name: 'a Boom bound in a sibling function is not visible in this one',
    run: function () {
      const src =
        'function a() { var Boom = require("@hapi/boom"); return Boom.notFound(); }\n' +
        'function b() { return Boom.forbidden(); }\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      const inA = valueKind('Boom.notFound()', bindings, src.indexOf('Boom.notFound'));
      const inB = valueKind('Boom.forbidden()', bindings, src.indexOf('Boom.forbidden'));
      return inA.kind + '/' + inB.kind;
    },
    expected: 'boom/unbound-reference'
  },
  {
    // Containment IS the scope chain, so this must hold without any extra
    // machinery: an outer binding is visible at every nested offset.
    name: 'a binding in an enclosing function is visible in a nested one',
    run: function () {
      const src =
        'function outer() {\n' +
        '  var Boom = require("@hapi/boom");\n' +
        '  p.then(function () { return Boom.forbidden(); });\n' +
        '}\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      return valueKind('Boom.forbidden()', bindings, src.indexOf('Boom.forbidden')).kind;
    },
    expected: 'boom'
  },
  {
    name: 'a parameter binds the name over its own function only',
    run: function () {
      const src =
        'function a(Boom) { return Boom.notFound(); }\n' +
        'function b() { return Boom.notFound(); }\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      return valueKind('Boom.notFound()', bindings, src.indexOf('Boom.notFound')).kind + '/' +
        valueKind('Boom.notFound()', bindings, src.lastIndexOf('Boom.notFound')).kind;
    },
    expected: 'boom/unbound-reference'
  },
  {
    name: 'a catch parameter binds over the catch block, not past it',
    run: function () {
      const src =
        'function f() {\n' +
        '  try { g(); } catch (Boom) { return Boom.notFound(); }\n' +
        '  return Boom.forbidden();\n' +
        '}\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      return valueKind('Boom.notFound()', bindings, src.indexOf('Boom.notFound')).kind + '/' +
        valueKind('Boom.forbidden()', bindings, src.indexOf('Boom.forbidden')).kind;
    },
    expected: 'boom/unbound-reference'
  },
  {
    name: 'a const in a block is not visible outside that block',
    run: function () {
      const src =
        'function f() {\n' +
        '  if (x) { const Boom = require("@hapi/boom"); h(Boom.notFound()); }\n' +
        '  return Boom.forbidden();\n' +
        '}\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      return valueKind('Boom.forbidden()', bindings, src.indexOf('Boom.forbidden')).kind;
    },
    expected: 'unbound-reference'
  },
  {
    // The predecessor tested `carrierMember && surface !== module`, which
    // every non-module row satisfies, so an uncalled function came back
    // drivable and the guard it fed was dead a second time.
    name: 'an uncalled internal function is not drivable, and says which',
    run: function () {
      const proven = {
        surface: SURFACE.INTERNAL, carrierMember: 'userByLogin', routes: [],
        callers: [], valueReferences: [],
        reachability: { searched: true, mentions: 0, sites: [] }
      };
      const unknown = {
        surface: SURFACE.INTERNAL, carrierMember: 'userByLogin', routes: [],
        callers: [], valueReferences: [],
        reachability: { searched: false, mentions: 0, sites: [] }
      };
      return driveVia(proven) + '/' + String(isDrivable(proven)) + ' ' +
        driveVia(unknown) + '/' + String(isDrivable(unknown));
    },
    expected: 'unreachable/false unresolved/false'
  },
  {
    name: 'a traced value reference is a driver even with no call syntax',
    run: function () {
      const edge = {
        surface: SURFACE.INTERNAL, carrierMember: 'isAdmin', routes: [],
        callers: [], valueReferences: [{ line: 287, context: 'server.method(...)' }],
        reachability: { searched: true, mentions: 1, sites: [] }
      };
      return driveVia(edge) + '/' + String(isDrivable(edge));
    },
    expected: 'caller-chain/true'
  },
  {
    // The measured NEW-H2 shape: resolveFunnels answered a returned error
    // value through Layer 3 and targetCore's tail prescribed Layer 1, on 49
    // rows of one document.
    name: 'a Layer 3 row whose target text prescribes Layer 1 is fatal',
    run: function () {
      const edge = { id: 't.1', file: 'f.js', line: 1, funnel: FUNNEL.L3 };
      try {
        assertRowCoherence(edge, 'Layer 1. The handler catch-all logs err.stack.');
        return 'not detected';
      } catch (err) {
        return err instanceof AnalysisError ? 'fatal' : 'wrong error';
      }
    },
    expected: 'fatal'
  },
  {
    // The second measured shape: two internal-callee rows said funnel `none`
    // while their target said Layer 1, and their side effects then said no
    // funnel logs anything.
    name: 'a funnel-none row whose target text prescribes a funnel is fatal',
    run: function () {
      const edge = { id: 't.2', file: 'f.js', line: 1, funnel: FUNNEL.NONE };
      try {
        assertRowCoherence(edge, 'Layer 1 catches it and answers 500.');
        return 'not detected';
      } catch (err) {
        return err instanceof AnalysisError ? 'fatal' : 'wrong error';
      }
    },
    expected: 'fatal'
  },
  {
    name: 'a coherent row passes the integrity check',
    run: function () {
      const edge = { id: 't.3', file: 'f.js', line: 1, funnel: FUNNEL.L3 };
      assertRowCoherence(edge, 'Layer 3. hapi answers from the returned value.');
      return 'ok';
    },
    expected: 'ok'
  },
  {
    // A value-dependent site genuinely has two outcomes, so its second funnel
    // is a FIELD and not a contradiction - but only the field makes it one.
    name: 'a declared alternate funnel is not a contradiction, an undeclared one is',
    run: function () {
      const withAlt = {
        id: 't.4', file: 'f.js', line: 1,
        funnel: FUNNEL.NONE, funnelAlternate: FUNNEL.L3
      };
      const text = 'Funnel: none. Where the value is a Boom the same site ' +
        'rejects and reaches Layer 3.';
      let declared;
      try {
        assertRowCoherence(withAlt, text);
        declared = 'accepted';
      } catch (err) {
        declared = 'rejected';
      }
      let undeclared;
      try {
        assertRowCoherence({ id: 't.5', file: 'f.js', line: 1, funnel: FUNNEL.NONE }, text);
        undeclared = 'accepted';
      } catch (err) {
        undeclared = 'rejected';
      }
      return declared + '/' + undeclared;
    },
    expected: 'accepted/rejected'
  },
  {
    // Runtime-confirmed: with neither name bound, `reply(Boom.forbidden())`
    // throws `ReferenceError: reply is not defined`, never `Boom`.
    name: 'an unbound callee throws before an unbound argument is evaluated',
    run: function () {
      const src = 'var errors = require("@hapi/boom");\nfunction f() { return reply(Boom.forbidden()); }\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      const at = src.indexOf('reply(');
      const arg = valueKind('Boom.forbidden()', bindings, at);
      const kind = calleeKind('reply', at, bindings, arg);
      return kind.holder + '/' + String(kind.viaCallee) + '/' + kind.status + '/' +
        kind.shadowedArgumentKind.holder;
    },
    expected: 'reply/true/500/Boom'
  },
  {
    name: 'a bound callee leaves the argument to decide the kind',
    run: function () {
      const src = 'function f(reply) { return reply(Boom.forbidden()); }\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      const at = src.indexOf('reply(Boom');
      const arg = valueKind('Boom.forbidden()', bindings, at);
      const kind = calleeKind('reply', at, bindings, arg);
      return kind.holder + '/' + String(Boolean(kind.viaCallee));
    },
    expected: 'Boom/false'
  },
  {
    // The language hoists `var` to the whole function, so the model must too
    // - resolving it to the block would invent a ReferenceError.
    name: 'a var in a block is hoisted to the whole enclosing function',
    run: function () {
      const src =
        'function f() {\n' +
        '  if (x) { var Boom = require("@hapi/boom"); }\n' +
        '  return Boom.forbidden();\n' +
        '}\n';
      const bindings = collectBindings(classifySource(src, 't').codeOnly);
      return valueKind('Boom.forbidden()', bindings, src.indexOf('Boom.forbidden')).kind;
    },
    expected: 'boom'
  },
  {
    // helpers.js:203 and trinket.js:881 are returned through a conditional,
    // and were reported "with no return".
    name: 'a value returned through a conditional operator is returned',
    run: function () {
      const src = 'function f() { return isValid ? reply(lang) : reply(Boom.notFound()); }';
      const code0 = classifySource(src, 't').codeOnly;
      const first = code0.indexOf('reply(');
      const second = code0.indexOf('reply(', first + 1);
      return String(isReturned(code0, first)) + '/' + String(isReturned(code0, second));
    },
    expected: 'true/true'
  },
  {
    // trinket.js:881 - the condition holds a string literal, which the
    // tokenizer blanks, and the walk then lands on the `=` of `===`.
    name: 'a conditional whose condition contains a comparison and a string literal is still returned',
    run: function () {
      const src = 'function f() { return err === "threshold exceeded" ? reply(errors.forbidden()) : reply(); }';
      const code0 = classifySource(src, 't').codeOnly;
      const first = code0.indexOf('reply(');
      return String(isReturned(code0, first));
    },
    expected: 'true'
  },
  {
    name: 'an assignment stops the return walk even inside a conditional',
    run: function () {
      const src = 'function f() { var x = cond === 1 ? reply(a) : b; }';
      const code0 = classifySource(src, 't').codeOnly;
      return String(isReturned(code0, code0.indexOf('reply(')));
    },
    expected: 'false'
  },
  {
    name: 'a compound assignment stops the return walk',
    run: function () {
      const src = 'function f() { total += reply(a); }';
      const code0 = classifySource(src, 't').codeOnly;
      return String(isReturned(code0, code0.indexOf('reply(')));
    },
    expected: 'false'
  },
  {
    name: 'a statement boundary stops the return walk',
    run: function () {
      const src = 'function f() { return 1; reply(err); }';
      const code0 = classifySource(src, 't').codeOnly;
      return String(isReturned(code0, code0.indexOf('reply(err)')));
    },
    expected: 'false'
  },
  {
    name: 'a value passed as an argument is not returned',
    run: function () {
      const src = 'function f() { return wrap(reply(err)); }';
      const code0 = classifySource(src, 't').codeOnly;
      return String(isReturned(code0, code0.indexOf('reply(')));
    },
    expected: 'false'
  },
  {
    name: 'a value assigned to a variable is not returned',
    run: function () {
      const src = 'function f() { var r = reply(err); }';
      const code0 = classifySource(src, 't').codeOnly;
      return String(isReturned(code0, code0.indexOf('reply(')));
    },
    expected: 'false'
  },
  {
    name: 'a value returned through a logical operator is returned',
    run: function () {
      const src = 'function f() { return ok && reply(err); }';
      const code0 = classifySource(src, 't').codeOnly;
      return String(isReturned(code0, code0.indexOf('reply(')));
    },
    expected: 'true'
  },
  {
    // courses.js:289 belonged to `download`; the nested `var returnZip =`
    // carrier swallowed it and reported it as unrouted.
    name: 'a nested function declaration does not absorb its enclosing carrier sites',
    run: function () {
      const src = 'module.exports = {\n' +
        '  download : function(request, reply) {\n' +
        '    var returnZip = function(z) { return reply(z); };\n' +
        '    if (ok) { return returnZip(1); }\n' +
        '    else { return reply(Boom.forbidden()); }\n' +
        '  }\n};\n';
      const code0 = classifySource(src, 't').codeOnly;
      const carriers = findCarriers('lib/controllers/courses.js', src, code0, findFunctions(code0));
      const at = code0.indexOf('reply(Boom');
      const carrier = carrierAt(carriers, at);
      return carrier ? carrier.member : 'none';
    },
    expected: 'download'
  },
  {
    // The tmp.tmpName(err, path) callback's own error had no row, because a
    // response three frames deeper looked like its own disposition.
    name: 'terminal ownership is innermost, so a nested response is not the outer callback\'s',
    run: function () {
      const src = 'module.exports = {\n' +
        '  asset : function(request, reply) {\n' +
        '    tmp.tmpName(function(err, p) {\n' +
        '      go(function() { return request.success({ p : p }); });\n' +
        '    });\n' +
        '  }\n};\n';
      const analysed = analyseFile('lib/controllers/users.js', src, { byTarget: new Map(), byHelper: new Map(), modulesRead: [] });
      return String(analysed.edges.some(function (edge) {
        return edge.edgeClass === EDGE_CLASS.ERR_PARAM && edge.paramName === 'err';
      }));
    },
    expected: 'true'
  },
  {
    // 18 propagating edges were filed as "swallows silently" and 2 that log
    // and reject as "logs and continues".
    name: 'a callback that rejects with its error propagates, and does so even when it logs',
    run: function () {
      const src = 'module.exports = {\n' +
        '  login : function(request, reply) {\n' +
        '    return new Promise(function(resolve, reject) {\n' +
        '      User.find(function(err, u) {\n' +
        '        console.log("cb", err);\n' +
        '        if (err) reject(err);\n' +
        '        else resolve(u);\n' +
        '      });\n' +
        '    });\n' +
        '  }\n};\n';
      const analysed = analyseFile('lib/controllers/users.js', src, { byTarget: new Map(), byHelper: new Map(), modulesRead: [] });
      const row = analysed.edges.find(function (edge) {
        return edge.paramName === 'err' && edge.edgeClass === EDGE_CLASS.ERR_PARAM;
      });
      return row ? row.disposition : 'no row';
    },
    expected: DISPOSITION.PROPAGATE
  },
  {
    name: 'a callback that only logs its error still logs and continues',
    run: function () {
      const src = 'module.exports = {\n' +
        '  a : function(request, reply) {\n' +
        '    fs.unlink(p, function(err) { console.log(err); });\n' +
        '  }\n};\n';
      const analysed = analyseFile('lib/controllers/admin.js', src, { byTarget: new Map(), byHelper: new Map(), modulesRead: [] });
      const row = analysed.edges.find(function (edge) {
        return edge.paramName === 'err';
      });
      return row ? row.disposition : 'no row';
    },
    expected: DISPOSITION.LOG_CONTINUE
  },
  {
    // The same conceptual edge is class `response` on one tree and `handler`
    // on the other, and a class-first join crossed the pairs and reported
    // both as changed.
    name: 'the join aligns a carrier\'s edges by source order across edge classes',
    run: function () {
      // Both sides sit inside a chain the carrier returns, which is what the
      // measured `course.deleteCourse` case looks like - the class flips but
      // the settlement does not move. An under-specified fixture with no
      // propagation reported a timing difference that the real pair does not
      // have, and would have hidden what this test is for.
      const chain = { kind: 'promise-chain', chainReturned: true };
      const mk = function (file, carrier, cls, ordinal, offset, funnel) {
        return {
          file: file, carrierMember: carrier, edgeClass: cls, offset: offset,
          identityBase: 'x.' + carrier + '.' + cls, ordinal: ordinal,
          id: 'x.' + carrier + '.' + cls + '.' + ordinal,
          disposition: DISPOSITION.BOOM, funnel: funnel, surface: SURFACE.HANDLER,
          line: offset, endLine: offset, thrownKind: { kind: 'boom', status: 500 },
          returnedBoom: true, routes: [], propagation: chain
        };
      };
      const baseline = [mk('f.js', 'del', EDGE_CLASS.RESPONSE, 1, 10, FUNNEL.L3),
        mk('f.js', 'del', EDGE_CLASS.RESPONSE, 2, 20, FUNNEL.L3)];
      const target = [mk('f.js', 'del', EDGE_CLASS.HANDLER, 1, 11, FUNNEL.L3),
        mk('f.js', 'del', EDGE_CLASS.RESPONSE, 1, 21, FUNNEL.L3)];
      const joined = joinTrees(baseline, target);
      return joined.summary.closed + '/' + joined.summary.changed;
    },
    expected: '2/0'
  },
  {
    // An id match is evidence only while the carrier's population of that
    // CLASS is unchanged. Here it is not - two response edges at baseline,
    // one in the target - so `response.1` renumbered and the match must not
    // override source order. The row records that the identically-named
    // target row exists elsewhere.
    name: 'a renumbered ordinal does not override source order, and says so',
    run: function () {
      const chain = { kind: 'promise-chain', chainReturned: true };
      const mk = function (cls, ordinal, offset) {
        return {
          file: 'f.js', carrierMember: 'del', edgeClass: cls, offset: offset,
          identityBase: 'x.del.' + cls, ordinal: ordinal,
          id: 'x.del.' + cls + '.' + ordinal,
          disposition: DISPOSITION.BOOM, funnel: FUNNEL.L3, surface: SURFACE.HANDLER,
          line: offset, endLine: offset, thrownKind: { kind: 'boom', status: 500 },
          returnedBoom: true, routes: [], propagation: chain
        };
      };
      const joined = joinTrees(
        [mk(EDGE_CLASS.RESPONSE, 1, 10), mk(EDGE_CLASS.RESPONSE, 2, 20)],
        [mk(EDGE_CLASS.HANDLER, 1, 11), mk(EDGE_CLASS.RESPONSE, 1, 21)]
      );
      const first = joined.rows[0];
      return first.target.id + '/' + String(Boolean(first.renumbered)) + '/' +
        joined.summary.renumberedOrdinals;
    },
    expected: 'x.del.handler.1/true/1'
  },
  {
    // An edge inserted at the head of a carrier used to shift every later
    // pair by one and close them all against the wrong counterpart. Anchors
    // that ARE trusted stop the shift at themselves.
    name: 'an inserted leading edge does not shift the pairs behind an anchor',
    run: function () {
      const chain = { kind: 'promise-chain', chainReturned: true };
      const mk = function (ordinal, offset, funnel) {
        return {
          file: 'f.js', carrierMember: 'c', edgeClass: EDGE_CLASS.RESPONSE,
          offset: offset, identityBase: 'x.c.response', ordinal: ordinal,
          id: 'x.c.response.' + ordinal, disposition: DISPOSITION.BOOM,
          funnel: funnel, surface: SURFACE.HANDLER, line: offset, endLine: offset,
          thrownKind: { kind: 'boom', status: 500 }, returnedBoom: true,
          routes: [], propagation: chain
        };
      };
      // Baseline holds response.1 and response.2; the target inserts a new
      // leading edge, so it holds three and the ids no longer line up by
      // position. The class population changed, so no anchor is trusted and
      // the surplus target row is reported added rather than force-matched.
      const joined = joinTrees(
        [mk(1, 10, FUNNEL.L3), mk(2, 20, FUNNEL.L1)],
        [mk(1, 5, FUNNEL.L3), mk(2, 11, FUNNEL.L3), mk(3, 21, FUNNEL.L1)]
      );
      return joined.summary.closed + '/' + joined.summary.changed + '/' +
        joined.summary.added + '/' + joined.summary.missing + '/' +
        joined.summary.ambiguous;
    },
    // Nothing closes and nothing is reported changed: an insertion inside the
    // gap means source order cannot say which target row each baseline row
    // is, and a guess is what produced the false closure this test exists for.
    expected: '0/0/1/0/2'
  },
  {
    // R-e names side effects and timing alongside the status, so a change to
    // either must open the row even when the status is identical. Comparing
    // the status alone closed 16 such rows in an earlier edition.
    name: 'a logging-only or timing-only change cannot close a row',
    run: function () {
      const base = {
        funnel: FUNNEL.L1, disposition: DISPOSITION.SWALLOW,
        surface: SURFACE.HANDLER, loggingCalls: ['console.log'],
        producedResponses: [], propagation: { kind: 'carrier-body' }
      };
      const logMoved = Object.assign({}, base, { loggingCalls: ['logger.error'] });
      const retimed = Object.assign({}, base, {
        propagation: { kind: 'promise-chain', chainReturned: false }
      });
      return String(sameOutcome(outcomeOf(base), outcomeOf(base))) + '/' +
        outcomeDiff(outcomeOf(base), outcomeOf(logMoved)).join('+') + '/' +
        outcomeDiff(outcomeOf(base), outcomeOf(retimed)).join('+');
    },
    expected: 'true/log calls/settlement timing'
  },
  {
    // Where the trusted anchors appear in a different order on the two trees,
    // no alignment of that carrier can be established, and neither verdict
    // may be borrowed.
    name: 'crossed anchors make a carrier ambiguous rather than closed or changed',
    run: function () {
      const chain = { kind: 'promise-chain', chainReturned: true };
      const mk = function (ordinal, offset) {
        return {
          file: 'f.js', carrierMember: 'c', edgeClass: EDGE_CLASS.RESPONSE,
          offset: offset, identityBase: 'x.c.response', ordinal: ordinal,
          id: 'x.c.response.' + ordinal, disposition: DISPOSITION.BOOM,
          funnel: FUNNEL.L3, surface: SURFACE.HANDLER, line: offset, endLine: offset,
          thrownKind: { kind: 'boom', status: 500 }, returnedBoom: true,
          routes: [], propagation: chain
        };
      };
      // Same two ids on both trees, in the opposite source order.
      const joined = joinTrees(
        [mk(1, 10), mk(2, 20)],
        [mk(2, 11), mk(1, 21)]
      );
      return joined.summary.ambiguous + '/' + joined.summary.closed;
    },
    expected: '2/0'
  },
  {
    name: 'an approved deviation approves only its own exact from/to outcome',
    run: function () {
      return String(approvedDeviationFor(
        'nothing.matches.this.1',
        { funnel: FUNNEL.NONE, status: null, producesResponse: false, surface: SURFACE.HANDLER },
        { funnel: FUNNEL.L3, status: 200, producesResponse: true, surface: SURFACE.HANDLER }
      ));
    },
    expected: 'null'
  }
]);

// ---------------------------------------------------------------------------
// Structural helpers
//
// Every one of these reads codeOnly, never the raw source, so braces,
// parentheses and keywords inside literals and comments cannot mislead them.
// ---------------------------------------------------------------------------

const OPENERS = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = { ')': '(', ']': '[', '}': '{' };

/** Offset of the delimiter matching the opener at openIdx, or -1. */
function matchDelimiter(codeOnly, openIdx) {
  const wanted = OPENERS[codeOnly[openIdx]];
  if (!wanted) {
    return -1;
  }
  const stack = [codeOnly[openIdx]];
  for (let i = openIdx + 1; i < codeOnly.length; i++) {
    const ch = codeOnly[i];
    if (OPENERS[ch]) {
      stack.push(ch);
    } else if (CLOSERS[ch]) {
      if (stack.length === 0 || OPENERS[stack[stack.length - 1]] !== ch) {
        return -1;
      }
      stack.pop();
      if (stack.length === 0) {
        return i;
      }
    }
  }
  return -1;
}

function isIdentifierChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_$]/.test(ch);
}

/** Offset of the next character that is not whitespace, from `from` forward. */
function skipSpaceForward(codeOnly, from) {
  let i = from;
  while (i < codeOnly.length && /\s/.test(codeOnly[i])) {
    i++;
  }
  return i;
}

/** Offset of the previous character that is not whitespace, from `from` back. */
function skipSpaceBack(codeOnly, from) {
  let i = from;
  while (i >= 0 && /\s/.test(codeOnly[i])) {
    i--;
  }
  return i;
}

/** The member path ending at `end` inclusive, e.g. "request.yar.flash". */
function readMemberPathBack(codeOnly, end) {
  let i = end;
  while (i >= 0 && (isIdentifierChar(codeOnly[i]) || codeOnly[i] === '.')) {
    i--;
  }
  return { text: codeOnly.slice(i + 1, end + 1), start: i + 1 };
}

/** The identifier starting at `start`, or ''. */
function readIdentifierForward(codeOnly, start) {
  let i = start;
  while (i < codeOnly.length && isIdentifierChar(codeOnly[i])) {
    i++;
  }
  return codeOnly.slice(start, i);
}

/**
 * Read the string literal whose opening delimiter sits at or after `from`,
 * skipping whitespace. Returns { text, quote, start, end } or null. The text
 * comes from the raw source because classifySource blanks literal interiors;
 * the closing delimiter is located in codeOnly, where delimiters survive.
 */
function readStringLiteral(src, codeOnly, from) {
  const start = skipSpaceForward(codeOnly, from);
  const quote = codeOnly[start];
  if (quote !== '\'' && quote !== '"' && quote !== '`') {
    return null;
  }
  const close = codeOnly.indexOf(quote, start + 1);
  if (close === -1) {
    return null;
  }
  return { text: src.slice(start + 1, close), quote: quote, start: start, end: close + 1 };
}

/**
 * Bounds of the statement containing `offset`, clamped to [floor, ceil]. The
 * walk stops at a `;` at depth 0 or at an enclosing opener/closer, so for an
 * offset inside a callback body the statement is bounded by that body.
 */
function statementBounds(codeOnly, offset, floor, ceil) {
  let depth = 0;
  let start = floor;
  for (let i = offset; i > floor; i--) {
    const ch = codeOnly[i];
    if (CLOSERS[ch]) {
      depth++;
    } else if (OPENERS[ch]) {
      if (depth === 0) {
        start = i + 1;
        break;
      }
      depth--;
    } else if ((ch === ';' || ch === ',') && depth === 0) {
      start = i + 1;
      break;
    }
  }
  depth = 0;
  let end = ceil;
  for (let i = offset; i < ceil; i++) {
    const ch = codeOnly[i];
    if (OPENERS[ch]) {
      depth++;
    } else if (CLOSERS[ch]) {
      if (depth === 0) {
        end = i;
        break;
      }
      depth--;
    } else if (ch === ';' && depth === 0) {
      end = i;
      break;
    }
  }
  return { start: start, end: end };
}

/**
 * Offset of the parenthesis enclosing `offset`, or -1 when a brace encloses it
 * first - which means `offset` is in a block, not an argument list.
 */
function enclosingCallParen(codeOnly, offset, floor) {
  let depth = 0;
  for (let i = offset - 1; i >= floor; i--) {
    const ch = codeOnly[i];
    if (ch === ')' || ch === ']' || ch === '}') {
      depth++;
    } else if (ch === '(') {
      if (depth === 0) {
        return i;
      }
      depth--;
    } else if (ch === '[' || ch === '{') {
      if (depth === 0) {
        return -1;
      }
      depth--;
    }
  }
  return -1;
}

/**
 * Every function in the file, as { kind, keywordAt, paramsStart, paramsEnd,
 * params, bodyStart, bodyEnd, blockBody }, sorted by bodyStart.
 *
 * `function` declarations and expressions are exact. Arrow functions with a
 * block body are exact. An expression-bodied arrow gets its extent
 * approximated to the end of the enclosing expression: the analysed files
 * contain none in the baseline tree, and the approximation is here so a
 * converted tree cannot silently lose rows.
 */
function findFunctions(codeOnly) {
  const found = [];

  const fnKeyword = /\bfunction\b/g;
  let m;
  while ((m = fnKeyword.exec(codeOnly)) !== null) {
    if (m.index > 0 && codeOnly[m.index - 1] === '.') {
      continue;
    }
    let i = skipSpaceForward(codeOnly, m.index + 8);
    if (codeOnly[i] === '*') {
      i = skipSpaceForward(codeOnly, i + 1);
    }
    if (isIdentifierChar(codeOnly[i])) {
      i = skipSpaceForward(codeOnly, i + readIdentifierForward(codeOnly, i).length);
    }
    if (codeOnly[i] !== '(') {
      continue;
    }
    const paramsEnd = matchDelimiter(codeOnly, i);
    if (paramsEnd === -1) {
      continue;
    }
    const braceAt = skipSpaceForward(codeOnly, paramsEnd + 1);
    if (codeOnly[braceAt] !== '{') {
      continue;
    }
    const bodyEnd = matchDelimiter(codeOnly, braceAt);
    if (bodyEnd === -1) {
      continue;
    }
    found.push({
      kind: 'function',
      keywordAt: m.index,
      paramsStart: i,
      paramsEnd: paramsEnd,
      params: codeOnly.slice(i + 1, paramsEnd),
      bodyStart: braceAt,
      bodyEnd: bodyEnd,
      blockBody: true
    });
  }

  const arrow = /=>/g;
  while ((m = arrow.exec(codeOnly)) !== null) {
    const beforeArrow = skipSpaceBack(codeOnly, m.index - 1);
    let paramsStart;
    let paramsEnd;
    let params;
    if (codeOnly[beforeArrow] === ')') {
      paramsEnd = beforeArrow;
      paramsStart = -1;
      let depth = 0;
      for (let i = beforeArrow; i >= 0; i--) {
        if (codeOnly[i] === ')') {
          depth++;
        } else if (codeOnly[i] === '(') {
          depth--;
          if (depth === 0) {
            paramsStart = i;
            break;
          }
        }
      }
      if (paramsStart === -1) {
        continue;
      }
      params = codeOnly.slice(paramsStart + 1, paramsEnd);
    } else if (isIdentifierChar(codeOnly[beforeArrow])) {
      const back = readMemberPathBack(codeOnly, beforeArrow);
      paramsStart = back.start;
      paramsEnd = beforeArrow;
      params = back.text;
    } else {
      continue;
    }

    const bodyAt = skipSpaceForward(codeOnly, m.index + 2);
    if (codeOnly[bodyAt] === '{') {
      const bodyEnd = matchDelimiter(codeOnly, bodyAt);
      if (bodyEnd === -1) {
        continue;
      }
      found.push({
        kind: 'arrow',
        keywordAt: paramsStart,
        paramsStart: paramsStart,
        paramsEnd: paramsEnd,
        params: params,
        bodyStart: bodyAt,
        bodyEnd: bodyEnd,
        blockBody: true
      });
    } else {
      const bounds = statementBounds(codeOnly, bodyAt, 0, codeOnly.length);
      found.push({
        kind: 'arrow',
        keywordAt: paramsStart,
        paramsStart: paramsStart,
        paramsEnd: paramsEnd,
        params: params,
        bodyStart: bodyAt,
        bodyEnd: Math.max(bodyAt, bounds.end),
        blockBody: false
      });
    }
  }

  found.sort(function (a, b) {
    return a.bodyStart - b.bodyStart || b.bodyEnd - a.bodyEnd;
  });
  return found;
}

/** Enclosing functions of `offset`, outermost first. */
function enclosingFunctions(functions, offset) {
  return functions.filter(function (fn) {
    return fn.bodyStart <= offset && offset < fn.bodyEnd;
  });
}

/** The function whose body most tightly encloses `offset`, or null. */
function innermostFunction(functions, offset) {
  const list = enclosingFunctions(functions, offset);
  return list.length ? list[list.length - 1] : null;
}

/** Parameter names of a function, as written. */
function parameterNames(fn) {
  return fn.params
    .split(',')
    .map(function (part) {
      return part.trim();
    })
    .filter(function (part) {
      return part.length > 0;
    });
}

/**
 * How a function is being used: the call it is an argument to, and that
 * call's callee. Returns { calleeText, calleeTail, parenStart, parenEnd } or
 * null when the function is not a call argument.
 */
function callSiteOf(codeOnly, fn) {
  const paren = enclosingCallParen(codeOnly, fn.keywordAt, 0);
  if (paren === -1) {
    return null;
  }
  const parenEnd = matchDelimiter(codeOnly, paren);
  const before = skipSpaceBack(codeOnly, paren - 1);
  if (before < 0) {
    return null;
  }
  if (!isIdentifierChar(codeOnly[before]) && codeOnly[before] !== ')' && codeOnly[before] !== ']') {
    return null;
  }
  const back = readMemberPathBack(codeOnly, before);
  const segments = back.text.split('.').filter(function (s) {
    return s.length > 0;
  });
  return {
    calleeText: back.text,
    calleeTail: segments.length ? segments[segments.length - 1] : '',
    parenStart: paren,
    parenEnd: parenEnd
  };
}

/**
 * The `.name(` links that continue a chain after the call closing at
 * `parenEnd`, in order. Used to decide whether a rejection raised inside a
 * `.then` callback is taken by a later `.catch` in the same chain.
 */
function chainLinksAfter(codeOnly, parenEnd) {
  const links = [];
  let i = skipSpaceForward(codeOnly, parenEnd + 1);
  while (codeOnly[i] === '.') {
    const nameStart = skipSpaceForward(codeOnly, i + 1);
    const name = readIdentifierForward(codeOnly, nameStart);
    if (!name) {
      break;
    }
    const parenAt = skipSpaceForward(codeOnly, nameStart + name.length);
    if (codeOnly[parenAt] !== '(') {
      break;
    }
    const close = matchDelimiter(codeOnly, parenAt);
    if (close === -1) {
      break;
    }
    links.push({ name: name, parenStart: parenAt, parenEnd: close });
    i = skipSpaceForward(codeOnly, close + 1);
  }
  return links;
}

// ---------------------------------------------------------------------------
// Carriers - the reachable code path every row must name
// ---------------------------------------------------------------------------

/**
 * The named, top-level containers of a file, each spanning to the next one.
 * A row's carrier is the container whose span holds it, which gives every row
 * a reachable code path even when no route binds to it.
 *
 * Three shapes are recognised, covering every analysed file:
 *   - depth-1 keys of `module.exports = { ... }`      (the ten controllers)
 *   - top-level `module.exports.<name> =` assignments (lib/util/helpers.js)
 *   - top-level `internals.<name> =` / `function <name>(` / `var <name> = function`
 * config/api_routes.js has none of these; its carriers are route
 * declarations, handled by findRouteDeclarationCarriers.
 */
function findCarriers(relPath, src, codeOnly, knownFunctions) {
  if (relPath === INLINE_PRE_FILE) {
    return findRouteDeclarationCarriers(relPath, src, codeOnly);
  }

  const prefix = path.basename(relPath, '.js');
  const carriers = [];

  const exportsObject = /\bmodule\.exports\s*=\s*\{/g;
  let m = exportsObject.exec(codeOnly);
  if (m) {
    const objStart = codeOnly.indexOf('{', m.index);
    const objEnd = matchDelimiter(codeOnly, objStart);
    if (objEnd === -1) {
      throw new AnalysisError(
        'unbalanced module.exports object literal in ' + relPath +
        ' at line ' + lineNumberAt(src, objStart)
      );
    }
    let depth = 0;
    for (let i = objStart + 1; i < objEnd; i++) {
      const ch = codeOnly[i];
      if (OPENERS[ch]) {
        depth++;
        continue;
      }
      if (CLOSERS[ch]) {
        depth--;
        continue;
      }
      if (depth !== 0 || !isIdentifierChar(ch)) {
        continue;
      }
      if (i > 0 && (isIdentifierChar(codeOnly[i - 1]) || codeOnly[i - 1] === '.')) {
        continue;
      }
      const name = readIdentifierForward(codeOnly, i);
      const colon = skipSpaceForward(codeOnly, i + name.length);
      if (codeOnly[colon] === ':') {
        carriers.push({ name: prefix + '.' + name, member: name, start: i, exported: true });
        i = colon;
      } else {
        i += name.length - 1;
      }
    }
  }

  const topLevel = /(?:^|\n)[ \t]*(?:module\.exports\.([A-Za-z0-9_$]+)|internals\.([A-Za-z0-9_$]+)|function[ \t]+([A-Za-z0-9_$]+)|var[ \t]+([A-Za-z0-9_$]+)[ \t]*=[ \t]*(?:async[ \t]+)?function)/g;
  while ((m = topLevel.exec(codeOnly)) !== null) {
    const exportedName = m[1];
    const name = m[1] || m[2] || m[3] || m[4];
    const at = m.index + m[0].indexOf(name);
    carriers.push({
      name: exportedName ? prefix + '.' + exportedName : prefix + '.' + name + (m[2] ? ' (internal)' : ' (module-local)'),
      member: name,
      start: at,
      exported: Boolean(exportedName)
    });
  }

  carriers.sort(function (a, b) {
    return a.start - b.start;
  });

  // A carrier's extent is the extent of the value it declares - not the
  // distance to whatever is declared next.
  //
  // The distance-to-the-next-declaration reading is wrong whenever one
  // carrier is declared INSIDE another, and this repository does that. In the
  // baseline tree `lib/controllers/courses.js` declares
  // `var returnZip = function(zipFile) {...}` at :265, indented, inside the
  // routed handler `download` which starts at :132; the `topLevel` pattern
  // above matches it because it allows leading indentation. Under the old
  // reading `returnZip` then ran from :265 to the next declaration, which
  // swallowed :285 and :289 - two sites belonging to `download`'s own body,
  // one of them the `else` branch that answers the request. Both were
  // reported under the carrier `courses.returnZip (module-local)` with
  // "Routes none declared", so a routed edge on
  // `GET /{userSlug}/courses/{courseSlug}/download.zip` looked unrouted and
  // undrivable.
  //
  // Measuring the declared value instead makes the extents properly nested,
  // and `carrierAt` then attributes each offset to the INNERMOST carrier that
  // contains it, falling outward to the routed handler when no inner carrier
  // does.
  const functions = knownFunctions && knownFunctions.length
    ? knownFunctions
    : findFunctions(codeOnly);

  for (let i = 0; i < carriers.length; i++) {
    const carrier = carriers[i];
    const provisionalEnd = i + 1 < carriers.length ? carriers[i + 1].start : src.length;
    carrier.end = carrierExtent(codeOnly, functions, carrier, provisionalEnd, src.length);
  }

  // Sort so that an enclosing carrier precedes the carriers nested inside it,
  // which makes `carrierAt`'s innermost search a simple scan.
  carriers.sort(function (a, b) {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    return b.end - a.end;
  });
  return carriers;
}

/**
 * The route specification a `route :` key names, as a single string.
 *
 * A declaration is usually one literal, but the per-language loop in
 * config/routes.js builds its declarations by concatenation:
 *
 *   route : 'GET /' + lang + '/{shortCode} trinket.getByShortCode'
 *
 * Reading only the first literal there yields `GET /`, whose third
 * whitespace-separated token - the controller binding - does not exist, so
 * three routed download handlers were reported as having no declaration at
 * all and their rows fell back to "drive through the carrier". The
 * concatenation is therefore followed, with each non-literal operand rendered
 * as `<name>` so the result reads as the template it is rather than as a
 * literal path: `GET /<lang>/{shortCode} trinket.getByShortCode`. The
 * expanded per-language surface belongs to test/parity/manifest.js and the
 * generated document says so.
 */
function readRouteSpec(src, codeOnly, from) {
  const first = readStringLiteral(src, codeOnly, from);
  if (!first) {
    return null;
  }
  let text = first.text;
  let cursor = first.end;

  for (;;) {
    const plus = skipSpaceForward(codeOnly, cursor);
    if (codeOnly[plus] !== '+') {
      break;
    }
    const operandAt = skipSpaceForward(codeOnly, plus + 1);
    const literal = readStringLiteral(src, codeOnly, operandAt);
    if (literal) {
      text += literal.text;
      cursor = literal.end;
      continue;
    }
    if (!isIdentifierChar(codeOnly[operandAt])) {
      break;
    }
    const identifier = readIdentifierForward(codeOnly, operandAt);
    if (!identifier) {
      break;
    }
    text += '<' + identifier + '>';
    cursor = operandAt + identifier.length;
  }

  return { text: text, end: cursor };
}

/** Carriers for a route module: one per literal `route :` declaration. */
function findRouteDeclarationCarriers(relPath, src, codeOnly) {
  const carriers = [];
  const routeKey = /\broute\s*:/g;
  let m;
  while ((m = routeKey.exec(codeOnly)) !== null) {
    const literal = readRouteSpec(src, codeOnly, m.index + m[0].length);
    if (!literal) {
      continue;
    }
    const spec = literal.text.trim().replace(/\s+/g, ' ');
    carriers.push({
      name: spec,
      member: spec,
      start: m.index,
      exported: false,
      routeSpec: spec
    });
  }
  carriers.sort(function (a, b) {
    return a.start - b.start;
  });

  // A route declaration's carrier is the route OBJECT it sits in, and
  // `config/api_routes.js` is a flat array of them, so each one genuinely
  // does run to the next declaration. Nothing here is nested inside anything
  // else, and there is no declared function value to measure.
  for (let i = 0; i < carriers.length; i++) {
    carriers[i].end = i + 1 < carriers.length ? carriers[i + 1].start : src.length;
  }
  return carriers;
}

/**
 * The extent of the value a carrier declares.
 *
 * Reads the first thing after the carrier's name and `:` or `=`:
 *   - an object literal  -> the literal's matched braces, so every function
 *     inside a pre-handler declaration such as `{ method : ..., assign : ... }`
 *     belongs to that carrier;
 *   - a function of any form -> that function's body end;
 *   - anything else -> the provisional end, which is the next declaration.
 *
 * @returns {number} exclusive end offset
 */
function carrierExtent(codeOnly, functions, carrier, provisionalEnd, hardEnd) {
  let i = skipSpaceForward(codeOnly, carrier.start + String(carrier.member).length);
  // Step over the binding token: `:` in an exports object literal, `=` in a
  // top-level assignment. A `module.exports.x` carrier's start is at `x`, so
  // one step is enough in both forms.
  if (codeOnly[i] === ':' || codeOnly[i] === '=') {
    i = skipSpaceForward(codeOnly, i + 1);
  }

  if (codeOnly[i] === '{') {
    const close = matchDelimiter(codeOnly, i);
    if (close !== -1) {
      return Math.min(close + 1, hardEnd);
    }
  }

  for (let f = 0; f < functions.length; f++) {
    const fn = functions[f];
    if (fn.keywordAt < i) {
      continue;
    }
    // Only the value POSITION counts. A gap of more than the `async ` keyword
    // between the binding token and the function keyword means the value is
    // not a function literal, so the provisional end is used instead.
    if (fn.keywordAt > skipSpaceForward(codeOnly, i) + 6) {
      break;
    }
    return Math.min(fn.bodyEnd + 1, hardEnd);
  }

  return Math.min(provisionalEnd, hardEnd);
}

/**
 * The carrier an offset belongs to: the INNERMOST carrier containing it.
 *
 * With nested extents there can be several containing carriers - a
 * module-local function declared inside a routed handler is contained by
 * both - and the narrowest is the one that owns the offset. When no carrier
 * contains it the offset is module scope, and null says so rather than the
 * nearest preceding declaration claiming it.
 */
function carrierAt(carriers, offset) {
  let found = null;
  for (let i = 0; i < carriers.length; i++) {
    const carrier = carriers[i];
    if (carrier.start <= offset && offset < carrier.end) {
      if (!found || (carrier.end - carrier.start) < (found.end - found.start)) {
        found = carrier;
      }
    }
  }
  return found;
}

/**
 * The carriers containing an offset, outermost first.
 *
 * An edge inside a module-local function is driven by driving the routed
 * handler that calls it, and when the module-local function is declared
 * inside that handler the enclosing carrier IS that handler - so the route
 * bindings are reachable without a call-graph. This returns the chain so the
 * route lookup can fall outward.
 */
function carrierChainAt(carriers, offset) {
  const chain = carriers.filter(function (carrier) {
    return carrier.start <= offset && offset < carrier.end;
  });
  chain.sort(function (a, b) {
    return (b.end - b.start) - (a.end - a.start);
  });
  return chain;
}

// ---------------------------------------------------------------------------
// Route binding - so a row can be driven, not just read
// ---------------------------------------------------------------------------

/**
 * Map controller methods and named pre-handlers to the routes that bind them,
 * read from the literal `route :` declarations in config/routes.js and
 * config/api_routes.js.
 *
 * These are the literal declarations. config/routes.js expands a subset of
 * them per language at parse time, so the registered surface is larger; the
 * expanded 233-entry manifest belongs to test/parity/manifest.js and the
 * generated document says so. A tree missing either module still yields a
 * complete inventory - carriers name the reachable code path instead.
 */
/**
 * Whether the route declaration between `from` and `to` declares a
 * `fail.redirect` whose value carries a `{placeholder}`.
 *
 * This is what decides section 3's blast radius. `request.fail` assigns the
 * interpolated value back onto the parse-time object on every such route, but
 * interpolating a literal string yields the same string, so only a template
 * can be consumed by the first request. Measuring it here keeps the
 * cross-reference tied to the tree instead of to a list in this file.
 */
function hasTemplatedFailRedirect(src, codeOnly, from, to) {
  const failKey = /\bfail\s*:/g;
  failKey.lastIndex = from;
  let m;
  while ((m = failKey.exec(codeOnly)) !== null && m.index < to) {
    const brace = skipSpaceForward(codeOnly, m.index + m[0].length);
    if (codeOnly[brace] !== '{') {
      continue;
    }
    const end = matchDelimiter(codeOnly, brace);
    if (end === -1 || end > to) {
      continue;
    }
    const redirectKey = /\bredirect\s*:/g;
    redirectKey.lastIndex = brace;
    let r;
    while ((r = redirectKey.exec(codeOnly)) !== null && r.index < end) {
      const literal = readStringLiteral(src, codeOnly, r.index + r[0].length);
      if (literal && /\{[^}]+\}/.test(literal.text)) {
        return true;
      }
    }
  }
  return false;
}

function buildRouteBindings(appRoot) {
  const byTarget = new Map();
  const byHelper = new Map();
  const templatedFailRedirects = new Set();
  const modulesRead = [];

  ROUTE_MODULES.forEach(function (relPath) {
    const abs = path.join(appRoot, relPath);
    if (!fs.existsSync(abs)) {
      return;
    }
    const src = fs.readFileSync(abs, 'utf8');
    const classified = classifySource(src, relPath);
    const codeOnly = classified.codeOnly;
    modulesRead.push(relPath);

    const declarations = [];
    const routeKey = /\broute\s*:/g;
    let m;
    while ((m = routeKey.exec(codeOnly)) !== null) {
      const literal = readRouteSpec(src, codeOnly, m.index + m[0].length);
      if (!literal) {
        continue;
      }
      const parts = literal.text.trim().split(/\s+/);
      declarations.push({
        start: m.index,
        method: parts[0] || '',
        pathSpec: parts[1] || '',
        target: parts[2] || '',
        spec: (parts[0] || '') + ' ' + (parts[1] || '')
      });
    }

    declarations.forEach(function (decl, index) {
      const blockEnd = index + 1 < declarations.length ? declarations[index + 1].start : codeOnly.length;
      if (hasTemplatedFailRedirect(src, codeOnly, decl.start, blockEnd)) {
        templatedFailRedirects.add(decl.spec);
      }
      if (decl.target) {
        if (!byTarget.has(decl.target)) {
          byTarget.set(decl.target, []);
        }
        byTarget.get(decl.target).push(decl.spec);
      }
      const helperRef = /\bhelpers\.([A-Za-z0-9_$]+)/g;
      const block = codeOnly.slice(decl.start, blockEnd);
      let h;
      while ((h = helperRef.exec(block)) !== null) {
        const key = 'helpers.' + h[1];
        if (!byHelper.has(key)) {
          byHelper.set(key, []);
        }
        const list = byHelper.get(key);
        if (list.indexOf(decl.spec) === -1) {
          list.push(decl.spec);
        }
      }
    });
  });

  return {
    byTarget: byTarget,
    byHelper: byHelper,
    templatedFailRedirects: templatedFailRedirects,
    modulesRead: modulesRead
  };
}

/** Routes bound to a carrier, deduplicated and ordered. */
function routesForCarrier(bindings, relPath, carrier) {
  if (!carrier) {
    return [];
  }
  if (carrier.routeSpec) {
    return [carrier.routeSpec];
  }
  const direct = bindings.byTarget.get(carrier.name);
  if (direct && direct.length) {
    return dedupe(direct);
  }
  if (relPath === HELPERS_FILE) {
    const viaHelper = bindings.byHelper.get('helpers.' + carrier.member);
    if (viaHelper && viaHelper.length) {
      return dedupe(viaHelper);
    }
  }
  return [];
}

/**
 * The routes that drive an offset, resolved through the chain of carriers
 * containing it rather than through one carrier alone.
 *
 * A module-local function declared inside a routed handler is contained by
 * that handler, so its edges are driven by the handler's routes. Resolving
 * only the innermost carrier reported "Routes none declared" for edges that
 * a named route reaches directly, which is how a routed 403-looking edge in
 * `courses.download` came to be described as undrivable. The innermost
 * carrier that resolves to routes wins; the fall outward is recorded so the
 * row can say which carrier supplied them.
 *
 * @returns {{routes: string[], via: Object|null}}
 */
function routesForChain(bindings, relPath, chain) {
  for (let i = chain.length - 1; i >= 0; i--) {
    const routes = routesForCarrier(bindings, relPath, chain[i]);
    if (routes.length) {
      return { routes: routes, via: chain[i] };
    }
  }
  return { routes: [], via: null };
}

function dedupe(list) {
  const seen = new Set();
  const out = [];
  list.forEach(function (item) {
    if (!seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Surface and propagation
//
// Which funnel an edge reaches depends on what invoked the function the edge
// sits in, and the two invocation paths in this application behave
// differently in a way that decides many rows:
//
//  ROUTE HANDLERS are called from the wrapper in lib/util/routeParser.js
//  inside a try/catch - Layer 1 - which does NOT test err.isBoom. So a
//  `throw Boom.notFound()` in a controller is answered 500 with Boom's hidden
//  5xx message, while `return Boom.notFound()` is answered 404. Same value,
//  different verb, different status.
//
//  PRE-HANDLERS are called through convertPreHandlers, whose fakeReply
//  rejects on an isBoom value - preserving that Boom's own status - and
//  RESOLVES on anything else, including a plain Error. So `reply(err)` in a
//  pre-handler with a non-Boom error resolves the pre-handler with the Error
//  object as its assigned value and the request continues: no error response
//  is produced at all. A synchronous throw inside a pre-handler is caught by
//  the shim and rejected, so a thrown Boom keeps its status. Pre-handler
//  edges never reach Layer 1.
// ---------------------------------------------------------------------------

const SURFACE = Object.freeze({
  HANDLER: 'route handler',
  PRE: 'pre-handler',
  INLINE_PRE: 'inline pre-handler',
  SERVER_METHOD: 'server method',
  // A module-local function that hapi never invokes: it is reached only by
  // being called from one of the surfaces above. Its errors travel by the
  // ordinary rules of its caller, so it has no funnel of its own.
  INTERNAL: 'internal callee',
  MODULE: 'module scope'
});

/**
 * How the function a carrier names is INVOKED, read from the analysed file
 * rather than assumed from the file's path.
 *
 * lib/util/helpers.js holds three different kinds of function and they do not
 * share error semantics:
 *
 *   - `module.exports.<name>` entries that hapi invokes as lifecycle
 *     pre-handlers. A returned or thrown Boom reaches Layer 3 with its own
 *     status; the handler catch-all never sees it.
 *   - `internals.<name>` functions handed to `server.method('<name>', ...)`
 *     inside `module.exports.register`. hapi does not invoke these as
 *     lifecycle methods at all: routeParser's string-form dispatcher looks
 *     them up on `server.methods`, resolves their arguments out of the
 *     request, and returns whatever they return. Their signatures say so -
 *     `(user, next)`, `(userSlug, next)`, `(resource, user, next)` - none of
 *     them takes `(request, h)`.
 *   - internal callees such as `internals.namedTrinketList(lang, category)`,
 *     which a pre-handler awaits.
 *
 * Calling the second and third kinds "pre-handler" attributes to them a
 * funnel and a target they do not have, which is why this is computed from
 * the registration evidence in the file.
 */
function surfaceFor(relPath, carrier, bindings, fileFacts) {
  if (relPath === INLINE_PRE_FILE) {
    return SURFACE.INLINE_PRE;
  }
  if (!carrier) {
    return SURFACE.MODULE;
  }
  if (relPath === HELPERS_FILE) {
    const facts = fileFacts || {};
    const serverMethods = facts.serverMethodTargets || Object.create(null);
    const lifecycleExports = facts.lifecycleExports || Object.create(null);
    if (carrier.member === 'register') {
      // `register` itself invokes nothing; it is the registration site. An
      // edge inside its body is module-scope work performed at plugin
      // registration time.
      return SURFACE.MODULE;
    }
    if (Object.prototype.hasOwnProperty.call(serverMethods, carrier.member)) {
      return SURFACE.SERVER_METHOD;
    }
    if (Object.prototype.hasOwnProperty.call(lifecycleExports, carrier.member)) {
      return SURFACE.PRE;
    }
    return SURFACE.INTERNAL;
  }
  if (CONTROLLER_FILES.indexOf(relPath) !== -1) {
    // A controller's exported members are the handlers hapi binds; a
    // module-local or `internals.` function is reached through one of them.
    return carrier.exported ? SURFACE.HANDLER : SURFACE.INTERNAL;
  }
  return SURFACE.MODULE;
}

/**
 * How a row is driven, from PROVEN REACHABILITY.
 *
 * Two predecessors of this function were dead in the same way. The first
 * tested `!edge.carrier`, which no edge can satisfy, because `push()`
 * substitutes the literal `'(module scope)'` when carrier resolution finds
 * nothing. The second tested `edge.carrierMember && surface !== MODULE`,
 * which every non-module edge satisfies by construction - so a function that
 * nothing anywhere calls came back `carrier` / drivable, and the guard was
 * dead a second time under a new name. The display metadata being present is
 * not evidence that anything can reach the code.
 *
 * So each answer below names a MECHANISM that reaches this edge, and every
 * one of them is something the analysis resolved rather than assumed:
 *
 *   route         a route declaration binds this carrier - the manifest
 *                 entry is the driver
 *   pre-handler   the carrier is a lifecycle export hapi invokes, bound by
 *                 at least one route
 *   lifecycle-export  exported for hapi to invoke but no route names it, so
 *                 it is reachable by declaration and not by any route here
 *   server-method the carrier is registered with `server.method`, reached
 *                 through routeParser's string-form pre-handler dispatcher
 *   caller-chain  a routed or invoked caller was TRACED to it, by call or by
 *                 handing its value on
 *   module-load   module scope, which every require of the file runs
 *   unreachable   PROVEN: the corpus was searched and holds exactly one
 *                 mention of this member - its own declaration. Nothing can
 *                 drive it, and the row says so instead of claiming a driver
 *   unresolved    none of the above could be established. Fatal in
 *                 `generate`: an edge nobody can reach and that was not
 *                 proven unreachable is a row whose truth is unknown
 *
 * @param {Object} edge the edge, after surface and caller resolution
 * @returns {string} one of the mechanisms above
 */
function driveVia(edge) {
  if (edge.routes && edge.routes.length > 0) {
    return edge.surface === SURFACE.PRE || edge.surface === SURFACE.INLINE_PRE
      ? 'pre-handler'
      : 'route';
  }
  if (edge.surface === SURFACE.SERVER_METHOD) {
    return 'server-method';
  }
  if (edge.surface === SURFACE.PRE || edge.surface === SURFACE.INLINE_PRE) {
    return 'lifecycle-export';
  }
  if (edge.surface === SURFACE.MODULE) {
    // Module scope runs when the module is loaded, which every routed handler
    // in the file forces. That is a reachable path and it is named as one.
    return 'module-load';
  }
  if ((edge.callers || []).length > 0 || (edge.valueReferences || []).length > 0) {
    return 'caller-chain';
  }
  if (edge.reachability && edge.reachability.searched &&
      edge.reachability.mentions === 0) {
    return 'unreachable';
  }
  return 'unresolved';
}

/** How a row's driver reads in prose, from its resolved mechanism. */
function driveDescription(edge) {
  switch (edge.driveVia) {
    case 'route':
      return 'a bound route';
    case 'pre-handler':
      return 'a route that binds this pre-handler';
    case 'lifecycle-export':
      return 'invoking it as the lifecycle method it is exported as';
    case 'server-method':
      return 'a route naming its `server.method` registration';
    case 'caller-chain':
      return 'its traced caller(s) ' +
        ((edge.callers || []).length ? '`' + edge.callers.join('`, `') + '`' : '') +
        ((edge.valueReferences || []).length
          ? ' - its value is handed on at line ' +
            edge.valueReferences.map(function (ref) {
              return ref.line;
            }).join(', ')
          : '');
    case 'module-load':
      return 'loading the module';
    case 'unreachable':
      return '**nothing - proven unreachable**';
    default:
      return '**nothing resolved**';
  }
}

/**
 * Whether an edge can be driven at all - which is not the same as whether its
 * reachability is known. A proven-unreachable edge is not drivable and its
 * row must not claim an outcome; an unresolved one is fatal.
 */
function isDrivable(edge) {
  const via = driveVia(edge);
  return via !== 'unreachable' && via !== 'unresolved';
}

// ---------------------------------------------------------------------------
// Lexical bindings
//
// `Boom.notFound()` is a Boom factory only when `Boom` is bound. In the
// baseline tree it very often is not: five of the ten controllers import
// @hapi/boom under a different name - `errors` in course.js, courses.js,
// folders.js, admin.js and users.js - and then write `Boom.` anyway. Measured
// over the baseline worktree, that is 41 references in course.js, 15 in
// users.js, 2 in folders.js, 2 in admin.js and 1 in courses.js: 61 sites at
// which the expression does not construct a Boom at all but throws
// `ReferenceError: Boom is not defined` when the line is evaluated.
//
// The distinction is not cosmetic and it is not the same on both trees. On a
// route handler, `return Boom.forbidden()` with `Boom` bound is answered 403;
// with `Boom` unbound the evaluation throws before any value exists, the
// handler catch-all takes the ReferenceError, and the answer is 500 with
// Boom's generic 5xx body. A row that recorded 403 there would be describing a
// response no client has ever received, and an implementing agent preserving
// "the 403" would be preserving a fiction. In the target tree all ten
// controllers bind `Boom`, so the same text IS a factory - which is exactly
// why binding resolution, not text matching, is what makes a baseline row and
// its target row comparable.
//
// The resolver is deliberately conservative: a name counts as bound if it is
// declared ANYWHERE the expression could see it - a module-level or nested
// `var`/`let`/`const` declarator, a function declaration, a function
// parameter, a catch parameter, an assignment to a bare identifier, or a
// global this tool knows the runtime provides. Over-reporting boundness would
// hide a real ReferenceError, so the only names reported unbound are those
// with no declaration of any kind in the file.
// ---------------------------------------------------------------------------

// Names the runtime provides. `Promise`, `Error` and friends are here because
// error expressions reference them; the list is not a general global table and
// does not need to be, since it is consulted only for the identifier at the
// head of an error expression.
const KNOWN_GLOBALS = Object.freeze(new Set([
  'Array', 'Boolean', 'Buffer', 'Date', 'Error', 'EvalError', 'Function',
  'Infinity', 'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise',
  'Proxy', 'RangeError', 'ReferenceError', 'Reflect', 'RegExp', 'Set',
  'String', 'Symbol', 'SyntaxError', 'TypeError', 'URIError', 'URL',
  'URLSearchParams', 'WeakMap', 'WeakSet', '__dirname', '__filename',
  'console', 'exports', 'global', 'globalThis', 'module', 'process',
  'require', 'undefined'
]));

/**
 * Every identifier the file declares, as a Set.
 *
 * Every binding is recorded WITH THE EXTENT IT IS VISIBLE OVER, and that
 * extent is the scope chain: a record is consulted for an offset only when
 * the record's extent contains that offset. Containment gives closure
 * semantics for free - a `var` in an outer function is visible at every
 * offset inside a nested one, because the outer body's extent contains them -
 * while a name bound in a SIBLING function is not visible here at all,
 * because that sibling's extent does not contain this offset.
 *
 * A flat per-file name set was the first implementation and it was wrong in a
 * way that mattered: `var Boom = ...` inside one function made every `Boom.`
 * in a sibling function of the same file read as a bound Boom factory, so a
 * line that throws `ReferenceError` at runtime was recorded with the status
 * its factory name reads as. Scope resolution is therefore not a refinement
 * of this resolver - it is the thing that makes its answer correct.
 *
 * Where the model is deliberately approximate it approximates towards BOUND,
 * never towards unbound, because reporting a name bound can only ever lose a
 * real ReferenceError while reporting one unbound would invent a 500 that no
 * client has ever received. The two approximations are a named function
 * expression, whose name is bound in the enclosing scope as well as its own
 * body, and a `var` inside a block, which is hoisted to the whole enclosing
 * function - which is what the language does.
 *
 * @param {string} codeOnly source with strings, regexes and comments blanked
 * @returns {Object} a resolver exposing isBoundAt(name, offset), the record
 *   list, and the flat name set for callers that only need presence
 */
function collectBindings(codeOnly) {
  const ceilingAll = codeOnly.length;
  const functions = findFunctions(codeOnly);
  const blocks = braceBlocks(codeOnly);

  // Function scopes, keyed for innermost-first lookup. The extent starts at
  // the parameter list so a parameter is visible to a default initialiser and
  // to the whole body.
  const fnScopes = functions.map(function (fn) {
    return {
      start: fn.paramsStart >= 0 ? fn.paramsStart : fn.bodyStart,
      end: fn.bodyEnd
    };
  });

  function innermost(scopes, offset) {
    let best = null;
    for (let i = 0; i < scopes.length; i++) {
      const scope = scopes[i];
      if (offset >= scope.start && offset <= scope.end) {
        if (!best || scope.start > best.start) {
          best = scope;
        }
      }
    }
    return best;
  }

  /** The extent a `var`, function declaration or parameter is visible over. */
  function functionScopeAt(offset) {
    return innermost(fnScopes, offset) || { start: 0, end: ceilingAll };
  }

  /** The extent a `let`, `const`, `class` or catch parameter is visible over. */
  function blockScopeAt(offset) {
    return innermost(blocks, offset) || { start: 0, end: ceilingAll };
  }

  const records = new Map();
  const names = new Set();
  // Offsets at which a name is DECLARED. The implicit-global pass below is a
  // pattern for `x = ...`, which also matches the `x =` inside
  // `var x = ...` and inside a defaulted parameter. Recording those at module
  // scope would bind every declaration file-wide and defeat scoping
  // altogether - measured: it made a `var Boom` inside one function bind
  // `Boom` for the whole file, which is the exact defect the scope model
  // exists to remove. An implicit global is an assignment to an UNDECLARED
  // identifier, so the declared offsets are excluded by identity rather than
  // by a backwards pattern match.
  const declaredAt = new Set();

  function record(name, scope, kind) {
    if (!name) {
      return;
    }
    names.add(name);
    if (!records.has(name)) {
      records.set(name, []);
    }
    records.get(name).push({ start: scope.start, end: scope.end, kind: kind });
  }

  // var/let/const, including every declarator of a comma-separated list:
  //   var Trinket = require('...'),
  //       errors  = require('@hapi/boom'),
  //       _       = require('underscore');
  // Only the first declarator carries the keyword, so the list is walked.
  const declKeyword = /\b(var|let|const)\s+/g;
  let m;
  while ((m = declKeyword.exec(codeOnly)) !== null) {
    // `var` hoists to the enclosing function; `let` and `const` are bound to
    // the enclosing block. Both are read from the declaration's own offset.
    const declScope = m[1] === 'var'
      ? functionScopeAt(m.index)
      : blockScopeAt(m.index);
    const declKind = m[1];
    let i = m.index + m[0].length;
    const ceiling = codeOnly.length;
    let expectName = true;
    while (i < ceiling) {
      if (expectName) {
        i = skipSpaceForward(codeOnly, i);
        // Destructuring: take every identifier inside the pattern.
        if (codeOnly[i] === '{' || codeOnly[i] === '[') {
          const close = matchDelimiter(codeOnly, i);
          if (close === -1) {
            break;
          }
          const pattern = codeOnly.slice(i + 1, close);
          const idents = pattern.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
          const patternStart = i + 1;
          idents.forEach(function (name) {
            record(name, declScope, declKind);
            const at = pattern.indexOf(name);
            if (at !== -1) {
              declaredAt.add(patternStart + at);
            }
          });
          i = close + 1;
        } else {
          const name = readIdentifierForward(codeOnly, i);
          if (!name) {
            break;
          }
          record(name, declScope, declKind);
          declaredAt.add(i);
          i += name.length;
        }
        expectName = false;
        continue;
      }
      // Skip the initialiser: hop matched groups so a comma inside a call
      // argument list or an object literal is not read as a declarator
      // separator.
      const ch = codeOnly[i];
      if (OPENERS[ch]) {
        const close = matchDelimiter(codeOnly, i);
        if (close === -1) {
          break;
        }
        i = close + 1;
        continue;
      }
      if (ch === ',') {
        expectName = true;
        i++;
        continue;
      }
      if (ch === ';' || ch === '}' || ch === ')') {
        break;
      }
      i++;
    }
  }

  // Function declarations and named function expressions, hoisted to the
  // enclosing function scope. For a named function EXPRESSION the language
  // binds the name only inside its own body; binding it in the enclosing
  // scope too is the approximation towards BOUND described above.
  const fnName = /\bfunction\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  while ((m = fnName.exec(codeOnly)) !== null) {
    record(m[1], functionScopeAt(m.index), 'function');
  }

  // Class declarations are block-scoped.
  const className = /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = className.exec(codeOnly)) !== null) {
    record(m[1], blockScopeAt(m.index), 'class');
  }

  // Parameter lists of every function form, and catch parameters.
  //
  // The `catch` alternative excludes a PRECEDING DOT, because `.catch(` is a
  // promise method call and not a catch clause. Without that exclusion the
  // whole of `.catch(function(err) { return reply(Boom.forbidden(err)); })`
  // is read as a parameter list, every identifier inside it is harvested as
  // a declared name, and `Boom` is then reported bound in a file that never
  // binds it - which silently restored the very misclassification the
  // resolver exists to remove. Measured on the baseline
  // `lib/controllers/course.js`, where two such links made 41 unbound
  // references look bound.
  const paramHead = /(?:\bfunction\s*\*?\s*[A-Za-z0-9_$]*\s*|(?<![.\w$])catch\s*)\(/g;
  while ((m = paramHead.exec(codeOnly)) !== null) {
    const isCatch = /catch/.test(m[0]);
    const open = m.index + m[0].length - 1;
    const close = matchDelimiter(codeOnly, open);
    if (close === -1) {
      continue;
    }
    // A catch parameter is visible over the catch BLOCK, not over the
    // enclosing function: `catch (e) { }` leaves `e` unbound after the block,
    // and a file whose only `Boom` is a catch parameter binds it only there.
    let scope;
    if (isCatch) {
      const brace = skipSpaceForward(codeOnly, close + 1);
      const blockEnd = codeOnly[brace] === '{' ? matchDelimiter(codeOnly, brace) : -1;
      scope = { start: open, end: blockEnd === -1 ? close : blockEnd };
    } else {
      scope = { start: open, end: functionScopeAt(open + 1).end };
    }
    const paramText = codeOnly.slice(open + 1, close);
    const idents = paramText.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
    idents.forEach(function (name) {
      record(name, scope, isCatch ? 'catch' : 'param');
      const at = paramText.indexOf(name);
      if (at !== -1) {
        declaredAt.add(open + 1 + at);
      }
    });
  }

  // Arrow parameters: `(a, b) =>` and `a =>`, visible over the arrow's body.
  const arrow = /(\([^()]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/g;
  while ((m = arrow.exec(codeOnly)) !== null) {
    const scope = { start: m.index, end: functionScopeAt(m.index).end };
    const idents = m[1].match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
    idents.forEach(function (name) {
      record(name, scope, 'param');
      const at = m[1].indexOf(name);
      if (at !== -1) {
        declaredAt.add(m.index + at);
      }
    });
  }

  // Bare assignment to an undeclared identifier creates a global in sloppy
  // mode. These files are sloppy-mode CommonJS, so `Boom = require(...)`
  // would bind. Counted so the resolver cannot invent a ReferenceError.
  const assign = /(?:^|[^A-Za-z0-9_$.=!<>+\-*/%&|^])([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g;
  const moduleScope = { start: 0, end: ceilingAll };
  while ((m = assign.exec(codeOnly)) !== null) {
    const identStart = m.index + m[0].indexOf(m[1]);
    if (declaredAt.has(identStart)) {
      continue;
    }
    record(m[1], moduleScope, 'global-assign');
  }

  return {
    names: names,
    records: records,
    /**
     * Whether `name` is bound where an expression AT `offset` can see it.
     *
     * @param {string} name identifier at the head of an error expression
     * @param {number} offset where the expression is evaluated
     * @returns {boolean}
     */
    isBoundAt: function (name, offset) {
      if (KNOWN_GLOBALS.has(name)) {
        return true;
      }
      const found = records.get(name);
      if (!found) {
        return false;
      }
      for (let i = 0; i < found.length; i++) {
        if (offset >= found[i].start && offset <= found[i].end) {
          return true;
        }
      }
      return false;
    }
  };
}

/**
 * Every `{ ... }` pair in the file, as extents.
 *
 * Block extents are what make `let` and `const` resolvable, and a function
 * body is itself a block, so one walk serves both. The source is the blanked
 * copy, so a brace inside a string or a comment cannot unbalance the stack.
 *
 * @param {string} codeOnly source with non-code offsets blanked
 * @returns {Object[]} extents, in the order they close
 */
function braceBlocks(codeOnly) {
  const found = [];
  const open = [];
  for (let i = 0; i < codeOnly.length; i++) {
    const ch = codeOnly[i];
    if (ch === '{') {
      open.push(i);
    } else if (ch === '}') {
      const start = open.pop();
      if (start !== undefined) {
        found.push({ start: start, end: i });
      }
    }
  }
  return found;
}

/**
 * The flat set of every name the file binds anywhere.
 *
 * Retained because two callers only ask whether a file mentions a name at
 * all, where scope cannot change the answer. It is DERIVED from the scope
 * model rather than collected separately, so the two cannot drift.
 *
 * @param {string} codeOnly source with non-code offsets blanked
 * @returns {Set<string>} every bound name
 */
function collectDeclaredNames(codeOnly) {
  return collectBindings(codeOnly).names;
}

/**
 * Facts about a file that its edges' classification depends on: which names
 * it binds, and - for the helpers module - how each of its functions is
 * invoked.
 *
 * @param {string} relPath repository-relative path
 * @param {string} src raw source
 * @param {string} codeOnly source with non-code offsets blanked
 * @returns {Object} { bindings, declaredNames, serverMethodTargets,
 *   lifecycleExports }
 */
function collectFileFacts(relPath, src, codeOnly) {
  const bindings = collectBindings(codeOnly);
  const facts = {
    bindings: bindings,
    declaredNames: bindings.names,
    serverMethodTargets: Object.create(null),
    lifecycleExports: Object.create(null)
  };

  // `server.method('isAdmin', internals.isAdmin)` and
  // `server.method('user', internals.findById(User))`. The registered name is
  // a string literal, so it is read from the RAW source; the target is read
  // from the blanked copy, where `internals.findById(User)` is intact.
  const serverMethod = /\bserver\.method\s*\(/g;
  let m;
  while ((m = serverMethod.exec(codeOnly)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = matchDelimiter(codeOnly, open);
    if (close === -1) {
      continue;
    }
    const nameLiteral = readStringLiteral(src, codeOnly, open + 1);
    const args = codeOnly.slice(open + 1, close);
    const target = args.match(/internals\.([A-Za-z0-9_$]+)/);
    if (target) {
      facts.serverMethodTargets[target[1]] = nameLiteral ? nameLiteral.text : target[1];
    }
  }

  // `module.exports.<name> = ...` and `module.exports.<name> = { method: ... }`
  // are the entries hapi can invoke as lifecycle methods. `register` is
  // excluded: it is the plugin registration hook, not a pre-handler.
  const exported = /\bmodule\.exports\.([A-Za-z0-9_$]+)\s*=/g;
  while ((m = exported.exec(codeOnly)) !== null) {
    if (m[1] === 'register') {
      continue;
    }
    facts.lifecycleExports[m[1]] = true;
  }

  // `module.exports.lowerUserFields = internals.lowerUserFields;` re-exports
  // an internals function AS a lifecycle method. The internals name is then
  // both an internal function and an invoked pre-handler, and the invoked
  // reading is the one that decides its funnel.
  const reexport = /\bmodule\.exports\.([A-Za-z0-9_$]+)\s*=\s*internals\.([A-Za-z0-9_$]+)\s*[;,\n]/g;
  while ((m = reexport.exec(codeOnly)) !== null) {
    if (m[1] === 'register') {
      continue;
    }
    facts.lifecycleExports[m[2]] = true;
    delete facts.serverMethodTargets[m[2]];
  }

  return facts;
}

/** The outermost function belonging to a carrier, i.e. the invoked body. */
function carrierFunction(functions, carrier) {
  if (!carrier) {
    return null;
  }
  let best = null;
  for (let i = 0; i < functions.length; i++) {
    const fn = functions[i];
    if (fn.keywordAt >= carrier.start && fn.keywordAt < carrier.end) {
      if (!best || fn.bodyStart < best.bodyStart) {
        best = fn;
      }
    }
  }
  return best;
}

/**
 * How an exception raised at `offset` travels outward.
 *
 * Returns:
 *   kind             'carrier-body' | 'promise-chain' | 'cps-callback' | 'module-scope'
 *   downstreamCatch  the `.catch(` link that takes it, or null
 *   catchLine        line of that link
 *   chainReturned    whether the chain it joins is returned or awaited
 *   chainLine        line of the chain statement
 *   viaIteratee      it passed through a synchronous iteratee on the way out
 *
 * The walk is lexical and it says so: a rejection that leaves this file
 * through a helper's own chain is reported as reaching the handler catch-all,
 * with the carrier named so a reviewer can confirm the hop.
 */
function propagationAt(ctx, offset) {
  const carrier = carrierAt(ctx.carriers, offset);
  const invoked = carrierFunction(ctx.functions, carrier);
  const chainOfFns = enclosingFunctions(ctx.functions, offset);
  if (chainOfFns.length === 0) {
    return { kind: 'module-scope', downstreamCatch: null, catchLine: null, chainReturned: false, chainLine: null, viaIteratee: false };
  }

  let index = chainOfFns.length - 1;
  let viaIteratee = false;

  while (index >= 0) {
    const fn = chainOfFns[index];
    if (invoked && fn.bodyStart === invoked.bodyStart) {
      return {
        kind: 'carrier-body',
        downstreamCatch: null,
        catchLine: null,
        chainReturned: false,
        chainLine: null,
        viaIteratee: viaIteratee
      };
    }
    const site = callSiteOf(ctx.codeOnly, fn);
    if (!site) {
      // A named local function invoked elsewhere in the file: the exception
      // surfaces at its call sites, which the enclosing carrier owns.
      index--;
      continue;
    }
    if (SYNCHRONOUS_ITERATEES.has(site.calleeTail)) {
      viaIteratee = true;
      index--;
      continue;
    }
    if (PROMISE_CONTINUATIONS.has(site.calleeTail)) {
      const links = chainLinksAfter(ctx.codeOnly, site.parenEnd);
      let downstream = null;
      for (let i = 0; i < links.length; i++) {
        if (links[i].name === 'catch') {
          downstream = links[i];
          break;
        }
      }
      // Whether the chain is awaited is read by walking the chain itself, via
      // chainContext, and NOT by bounding the statement.
      //
      // statementBounds walks backwards to the previous `;` or `{`, and an
      // `if (...) { ... }` earlier in the same function body masks the `;`
      // that would have bounded the statement - so the walk lands on the
      // function body's own start, sees no `return` in front of it, and
      // reports the chain as neither returned nor awaited. chainContext was
      // written for exactly that defect and carries the measurement in its
      // own comment; this call site had been left on the old reading.
      //
      // The consequence was not cosmetic. `courses.download` returns its
      // chain and its `.catch` returns `errors.badImplementation(...)`, so
      // the edge answers 500 - but with chainReturned false, funnel
      // resolution takes a returned Boom in an unawaited chain to reach no
      // funnel at all. The row then said the request is never answered, and
      // the comparison against the baseline reported a difference where there
      // is none: a false R-e failure, which is worse than a missing row
      // because it sends someone to preserve behaviour that is already
      // preserved.
      const context = chainContext(ctx, site.parenStart);
      return {
        kind: 'promise-chain',
        downstreamCatch: downstream,
        catchLine: downstream ? lineFromIndex(ctx.lineIndex, downstream.parenStart) : null,
        chainReturned: Boolean(context.awaited),
        chainBoundTo: context.boundTo || null,
        chainLine: context.line,
        viaIteratee: viaIteratee
      };
    }
    return {
      kind: 'cps-callback',
      downstreamCatch: null,
      catchLine: null,
      chainReturned: false,
      chainLine: null,
      viaIteratee: viaIteratee,
      callee: site.calleeText
    };
  }

  return { kind: 'carrier-body', downstreamCatch: null, catchLine: null, chainReturned: false, chainLine: null, viaIteratee: viaIteratee };
}

/** Classify the disposition a `.catch` handler reference delegates to. */
function bareHandlerDisposition(name) {
  if (name === 'request.fail' || /(^|\.)fail$/.test(name)) {
    return { disposition: DISPOSITION.FAIL_LOCAL, resolved: true };
  }
  if (name === 'reply' || /(^|\.)reply$/.test(name)) {
    return { disposition: DISPOSITION.REPLY_ERR, resolved: true };
  }
  return { disposition: DISPOSITION.SWALLOW, resolved: false };
}

/** First argument of the call whose `(` is at parenStart, as written. */
function firstArgument(src, codeOnly, parenStart, parenEnd) {
  let depth = 0;
  for (let i = parenStart + 1; i < parenEnd; i++) {
    const ch = codeOnly[i];
    if (OPENERS[ch]) {
      depth++;
    } else if (CLOSERS[ch]) {
      depth--;
    } else if (ch === ',' && depth === 0) {
      return { raw: src.slice(parenStart + 1, i), code: codeOnly.slice(parenStart + 1, i), end: i };
    }
  }
  return {
    raw: src.slice(parenStart + 1, parenEnd),
    code: codeOnly.slice(parenStart + 1, parenEnd),
    end: parenEnd
  };
}

/**
 * What kind of value an argument expression is, for reply()-style calls.
 *
 * The Boom branch RESOLVES ITS BINDING. `Boom.notFound()` constructs a Boom
 * only where `Boom` is bound; where it is not, evaluating the expression
 * throws `ReferenceError: Boom is not defined` and no value is ever
 * constructed, so the status the factory name suggests is not the status the
 * client receives. Text matching cannot tell those apart and reported 61
 * baseline sites as nominal Boom responses when every one of them is a 500.
 *
 * The binding is resolved AT THE EXPRESSION'S OWN OFFSET, through the file's
 * scope model, so a `Boom` bound in a sibling function does not make this
 * expression's `Boom` bound. Passing no resolver treats every name as bound,
 * which is the safe direction and is what the reconciliation counters do.
 *
 * @param {string} codeExpression the argument, from the blanked source
 * @param {Object} [bindings] the file's scope resolver, from collectBindings
 * @param {number} [offset] where the expression is evaluated
 */
function valueKind(codeExpression, bindings, offset) {
  const text = codeExpression.trim();
  if (text === '') {
    return { kind: 'empty' };
  }
  const boom = text.match(/^(Boom|errors|Hapi)\.(?:error\.)?([A-Za-z0-9_$]+)/);
  if (boom) {
    const holder = boom[1];
    const factory = boom[2];
    if (bindings && !isBoundName(holder, bindings, offset)) {
      return {
        kind: 'unbound-reference',
        holder: holder,
        factory: factory,
        // The status the text READS as, kept so the row can state what the
        // line looks like it does alongside what it actually does.
        nominalStatus: BOOM_STATUS[factory] || null,
        status: 500
      };
    }
    return { kind: 'boom', factory: factory, status: BOOM_STATUS[factory] || null };
  }
  if (/^new\s+[A-Za-z0-9_$.]*Error\b/.test(text)) {
    return { kind: 'error-construction' };
  }
  const ident = text.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
  if (ident && ERROR_IDENTIFIERS.has(ident[1])) {
    return { kind: 'error-identifier', name: ident[1] };
  }
  if (/^(?:err|error)\./.test(text)) {
    return { kind: 'error-member' };
  }
  return { kind: 'value' };
}

/**
 * Whether a name is bound where an error expression at `offset` can see it.
 *
 * Accepts either the file's scope resolver - the correct form, which answers
 * per offset - or a bare name set, which answers per file and is retained
 * only for the reconciliation counters, where scope cannot change the answer.
 *
 * @param {string} name identifier at the head of the expression
 * @param {Object|Set<string>} bindings scope resolver, or a flat name set
 * @param {number} [offset] where the expression is evaluated
 * @returns {boolean}
 */
function isBoundName(name, bindings, offset) {
  if (KNOWN_GLOBALS.has(name)) {
    return true;
  }
  if (bindings && typeof bindings.isBoundAt === 'function') {
    return bindings.isBoundAt(name, typeof offset === 'number' ? offset : 0);
  }
  return Boolean(bindings) && bindings.has(name);
}

/**
 * The kind of value a response call actually produces, accounting for the
 * order the runtime evaluates it in.
 *
 * A call expression resolves its callee first. So for `reply(Boom.forbidden())`
 * with neither name bound, the exception is
 * `ReferenceError: reply is not defined` and `Boom.forbidden()` is never
 * reached - the argument's own unbound holder is unobservable. Where the
 * callee IS bound the argument decides, which is the ordinary case.
 *
 * Both orders reach the same funnel and the same 500, so this does not move a
 * status. What it moves is the exception message, and therefore the text
 * Layer 1 writes to the error log - a side effect R-e requires the inventory
 * to record and the closure comparison to check.
 *
 * @param {string} callee the called identifier
 * @param {number} offset the call site
 * @param {Object} bindings the file's scope resolver
 * @param {Object} argKind what the first argument would have been
 * @returns {Object} the kind that governs, with `viaCallee` set when the
 *   callee is what throws and `shadowedArgumentKind` recording what the
 *   argument would have produced had it been reached
 */
function calleeKind(callee, offset, bindings, argKind) {
  if (!bindings || isBoundName(callee, bindings, offset)) {
    return argKind;
  }
  return {
    kind: 'unbound-reference',
    holder: callee,
    factory: null,
    viaCallee: true,
    nominalStatus: null,
    status: 500,
    shadowedArgumentKind: argKind
  };
}

/**
 * Logging calls that reference `name` and run on `fn`'s OWN stack.
 *
 * Ownership is innermost, for the same reason terminal ownership is, and
 * with a sharper failure mode: the name is usually `err` on both sides of the
 * nesting, so a nested callback's log of its OWN error reads as the outer
 * callback logging the outer error. The baseline asset-from-URL handler is
 * the measured case -
 *
 *   tmp.tmpName(function(err, tmpPath) {        <- this err: never read
 *     _request.get(...)
 *       .on('error', function(err) {            <- a DIFFERENT err, shadowing
 *         console.log('on error:', err);
 *
 * - where the shadowed log made the outer row `logs and continues` when the
 * outer `err` is discarded without a trace. Two dispositions that a reviewer
 * must be able to tell apart, reported as the same one.
 *
 * A log inside an `if` or `try` block still counts: a block is not a
 * function.
 *
 * @param {Object} ctx analysis context, for the function table
 * @param {Object} fn the function whose own logging is wanted
 * @param {string|null} name the identifier the log must reference, or null
 *   for any log
 */
function loggingReferences(ctx, fn, name) {
  const codeOnly = ctx.codeOnly;
  const from = fn.bodyStart;
  const to = fn.bodyEnd;
  const body = codeOnly.slice(from, to);
  const hits = [];
  LOGGING_CALLS.forEach(function (call) {
    let at = body.indexOf(call + '(');
    while (at !== -1) {
      const absolute = from + at;
      const before = absolute > 0 ? codeOnly[absolute - 1] : ' ';
      const close = matchDelimiter(codeOnly, absolute + call.length);
      const inner = innermostFunction(ctx.functions, absolute);
      if (close !== -1 &&
        !isIdentifierChar(before) &&
        inner && inner.bodyStart === fn.bodyStart &&
        (!name || referencesIdentifier(codeOnly.slice(absolute, close + 1), name))) {
        hits.push(call);
      }
      at = body.indexOf(call + '(', at + 1);
    }
  });
  return dedupe(hits);
}

/** Whether a code fragment references an identifier as a whole word. */
function referencesIdentifier(fragment, name) {
  if (!name) {
    return false;
  }
  const re = new RegExp('(^|[^A-Za-z0-9_$.])' + name.replace(/\$/g, '\\$') + '($|[^A-Za-z0-9_$])');
  return re.test(fragment);
}

/** Non-whitespace body text of a function, for emptiness tests. */
function bodyText(codeOnly, fn) {
  return codeOnly.slice(fn.bodyStart + 1, fn.bodyEnd).trim();
}

// Calls that produce a response. Used to find the callbacks a response is
// resolved from, and to tell a response-producing catch handler from an
// inert one.
const RESPONSE_CALLS = Object.freeze([
  { token: 'request.success(', kind: 'success' },
  { token: 'request.fail(', kind: 'fail' },
  { token: 'reply(', kind: 'reply' },
  { token: 'h.response(', kind: 'toolkit' },
  { token: 'h.view(', kind: 'toolkit' },
  { token: 'h.redirect(', kind: 'toolkit' }
]);

/**
 * Module-local functions that produce a response, discovered from the tree.
 *
 * The fixed token list above cannot be the whole answer, because the
 * conversion introduces local response builders and each controller names its
 * own. `lib/controllers/admin.js` has
 *
 *   function errorResponse(h, err) {
 *     if (err && err.isBoom) { return err; }
 *     if (err instanceof Error) { return errors.badImplementation(err.message); }
 *     return h.response({});
 *   }
 *
 * and its chains end `.catch(function(err) { return errorResponse(h, err); })`.
 * A scanner that knew only the fixed tokens saw that catch handler produce
 * nothing, classified it as absorbing the error, and gave the two
 * `throw Boom.notFound()` sites upstream a funnel of `none` - so two edges
 * that answer 500 were reported as answering nothing, and the comparison
 * against the baseline then reported a difference that does not exist. The
 * conversion changes the NAME of the response builder, not whether a response
 * is built, and this is what keeps the analysis from mistaking the one for the
 * other.
 *
 * A local function counts when its own body returns a response call, a Boom,
 * or a hapi toolkit value.
 *
 * @returns {Set<string>} local function names that produce a response
 */
function responseProducingLocals(ctx) {
  const names = new Set();
  const codeOnly = ctx.codeOnly;

  ctx.functions.forEach(function (fn) {
    const name = declaredFunctionName(codeOnly, fn);
    if (!name) {
      return;
    }
    const body = codeOnly.slice(fn.bodyStart, fn.bodyEnd);
    const producesResponseValue = RESPONSE_CALLS.some(function (entry) {
      return body.indexOf(entry.token) !== -1;
    }) ||
      /\breturn\s+(?:err|error)\b/.test(body) ||
      /\breturn\s+(?:Boom|errors|Hapi)\.[A-Za-z0-9_$]+\s*\(/.test(body);
    if (producesResponseValue) {
      names.add(name);
    }
  });

  return names;
}

/** The declared name of a function, for `function f(` and `var f = function(`. */
function declaredFunctionName(codeOnly, fn) {
  const forward = readIdentifierForward(codeOnly, skipSpaceForward(codeOnly, fn.keywordAt + 'function'.length));
  if (forward) {
    return forward;
  }
  // `var f = function(` / `f : function(` / `f = function(`
  let i = skipSpaceBack(codeOnly, fn.keywordAt - 1);
  if (i >= 0 && (codeOnly[i] === '=' || codeOnly[i] === ':')) {
    i = skipSpaceBack(codeOnly, i - 1);
    if (i >= 0 && isIdentifierChar(codeOnly[i])) {
      const back = readMemberPathBack(codeOnly, i);
      const tail = back.text.split('.').pop();
      return tail || null;
    }
  }
  return null;
}

/** Response-producing calls whose innermost enclosing function is `fn`. */
function responseCallsDirectlyIn(ctx, fn) {
  const hits = [];
  const entries = RESPONSE_CALLS.concat(
    Array.from(ctx.responseLocals || []).map(function (name) {
      return { token: name + '(', kind: 'local-response-builder' };
    })
  );
  entries.forEach(function (entry) {
    let at = ctx.codeOnly.indexOf(entry.token, fn.bodyStart);
    while (at !== -1 && at < fn.bodyEnd) {
      const before = at > 0 ? ctx.codeOnly[at - 1] : ' ';
      if (!isIdentifierChar(before) && before !== '.') {
        const inner = innermostFunction(ctx.functions, at);
        if (inner && inner.bodyStart === fn.bodyStart) {
          hits.push({ token: entry.token, kind: entry.kind, offset: at });
        }
      }
      at = ctx.codeOnly.indexOf(entry.token, at + 1);
    }
  });
  hits.sort(function (a, b) {
    return a.offset - b.offset;
  });
  return hits;
}

/**
 * A `return <name>` (or `return <name>.something`) directly in `fn`, or null.
 *
 * Only direct returns count - a return inside a nested callback belongs to
 * that callback - and the name must be the whole returned expression, so
 * `return err.message` counts and `return foo(err)` does not.
 *
 * @returns {{line: number, text: string}|null}
 */
function bareReturnOf(ctx, fn, name) {
  const codeOnly = ctx.codeOnly;
  const pattern = new RegExp('\\breturn\\s+' + name.replace(/\$/g, '\\$') +
    '(?![A-Za-z0-9_$])', 'g');
  const body = codeOnly.slice(fn.bodyStart, fn.bodyEnd);
  let m;
  while ((m = pattern.exec(body)) !== null) {
    const absolute = fn.bodyStart + m.index;
    const inner = innermostFunction(ctx.functions, absolute);
    if (inner && inner.bodyStart === fn.bodyStart) {
      const line = lineFromIndex(ctx.lineIndex, absolute);
      return { line: line, text: sourceLine(ctx, line) };
    }
  }
  return null;
}

/** The raw source line for a 1-based line number, trimmed. */
function sourceLine(ctx, line) {
  const start = ctx.lineIndex[line - 1];
  const end = line < ctx.lineIndex.length ? ctx.lineIndex[line] - 1 : ctx.src.length;
  return ctx.src.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Whether the value produced at `offset` is RETURNED by its statement.
 *
 * The predecessor of this function read only the token immediately behind the
 * offset, which answers the question for `return reply(x)` and gets it wrong
 * for every expression that reaches the offset through an operator. Two
 * baseline sites are exactly that shape:
 *
 *   lib/util/helpers.js:203
 *     return isValid ? reply(lang) : reply(Boom.notFound());
 *   lib/controllers/trinket.js:881
 *     return err === "threshold exceeded" ? reply(errors.forbidden()) : reply();
 *
 * The token behind each inner `reply(` is `?` or `:`, so both were reported
 * "with no return" although both are returned. That matters after conversion:
 * "with no return" tells an implementing agent the value is discarded today
 * and must start being returned, and here the value is already returned and
 * the conversion has nothing to change.
 *
 * The walk goes backwards from the offset to the head of the enclosing
 * expression statement, hopping matched groups and member paths and stepping
 * over expression joiners, and reports whether that head is `return`. An
 * arrow function's concise body is also a return, and is reported as one.
 */
function isReturned(codeOnly, offset) {
  let i = skipSpaceBack(codeOnly, offset - 1);

  while (i >= 0) {
    const ch = codeOnly[i];

    if (CLOSERS[ch]) {
      const open = findMatchingOpen(codeOnly, i);
      if (open === -1) {
        return false;
      }
      i = skipSpaceBack(codeOnly, open - 1);
      continue;
    }

    // An unmatched opener means the offset sits inside an argument list or a
    // group. Step out of it and keep asking the question of the enclosing
    // expression: `return foo(reply(x))` returns the value of `foo`, not of
    // `reply`, so the answer for the inner call is no.
    if (OPENERS[ch]) {
      return false;
    }

    if (isIdentifierChar(ch)) {
      const memberPath = readMemberPathBack(codeOnly, i);
      const text = memberPath.text;
      if (text === 'return') {
        return true;
      }
      if (text === 'throw' || text === 'typeof' || text === 'new' ||
          text === 'await' || text === 'void' || text === 'delete') {
        // These consume the value rather than returning it, except that an
        // awaited value can itself be returned - `return await f()` - which
        // the walk finds by continuing past `await`.
        if (text !== 'await') {
          return false;
        }
        i = skipSpaceBack(codeOnly, memberPath.start - 1);
        continue;
      }
      // Any other identifier immediately behind the expression means the
      // offset is not at the head of a returned expression: `var x = reply()`
      // reaches `=` next, and `foo bar` cannot occur in valid code.
      i = skipSpaceBack(codeOnly, memberPath.start - 1);
      continue;
    }

    if (ch === '>' && i > 0 && codeOnly[i - 1] === '=') {
      // `=> reply(x)` - a concise arrow body is a return.
      return true;
    }

    // A statement or block boundary: nothing before it belongs to this
    // expression, so the walk has run past the head without finding `return`.
    if (ch === ';' || ch === '{' || ch === '}') {
      return false;
    }

    // `=` is either an assignment - which stops the walk, because an assigned
    // value is not a returned one - or part of a comparison, which does not.
    // The distinction matters for the shape this walk exists to read:
    //
    //   return err === "threshold exceeded" ? reply(errors.forbidden()) : reply();
    //
    // is `trinket.js:881` in the baseline tree, and the string literal in the
    // condition is BLANKED by the tokenizer, so walking back from the inner
    // `reply(` crosses `?`, then a run of spaces where the literal was, and
    // lands on the `=` of `===`. Reading that as an assignment stopped the
    // walk one token short of the `return` and reported a returned value as
    // discarded.
    if (ch === '=') {
      const before = i > 0 ? codeOnly[i - 1] : '';
      const after = codeOnly[i + 1];
      const isComparison = before === '=' || before === '!' || before === '<' ||
        before === '>' || after === '=';
      const isCompoundAssignment = '+-*/%&|^'.indexOf(before) !== -1;
      if (!isComparison || isCompoundAssignment) {
        return false;
      }
      i = skipSpaceBack(codeOnly, i - 1);
      continue;
    }

    // Every other operator - `?`, `:`, `,`, the logical and comparison and
    // arithmetic operators - can sit between a returned expression and the
    // `return` at its head, so the walk continues through them. Enumerating
    // what CONTINUES rather than what STOPS was the earlier reading, and it
    // stopped at the first operator not on the list, which is how a condition
    // containing `===` ended the walk.
    i = skipSpaceBack(codeOnly, i - 1);
  }

  return false;
}

/**
 * The offset of the opener matching the closer at `closeIdx`.
 *
 * `matchDelimiter` only walks forwards, and the return analysis needs the
 * other direction.
 */
function findMatchingOpen(codeOnly, closeIdx) {
  const want = CLOSERS[codeOnly[closeIdx]];
  if (!want) {
    return -1;
  }
  let depth = 0;
  for (let i = closeIdx; i >= 0; i--) {
    const ch = codeOnly[i];
    if (CLOSERS[ch]) {
      depth++;
      continue;
    }
    if (OPENERS[ch]) {
      depth--;
      if (depth === 0) {
        return ch === want ? i : -1;
      }
    }
  }
  return -1;
}

/**
 * The statement a chain link or listener registration belongs to, and whether
 * anything waits for it.
 *
 * A `.catch(handler)` link is REGISTERED synchronously and INVOKED later, so
 * its timing is decided by the statement it hangs off: a chain that is
 * returned or awaited makes the enclosing function wait for the rejection,
 * and one that is neither leaves nothing waiting for it. `isReturned` cannot
 * answer that, because it only looks immediately behind the offset and the
 * `return` sits at the head of the statement, several links earlier.
 */
function chainContext(ctx, offset) {
  const code = ctx.codeOnly;
  let head = offset;
  let i = skipSpaceBack(code, offset - 1);

  // Walk back along the chain itself rather than using statementBounds, whose
  // backward walk cannot see past an intervening block: an `if (...) { ... }`
  // earlier in the same handler masks the `;` that would have bounded the
  // statement, and the walk then reports the function body's own start with
  // no `return` in front of it. Measured on the `home` handler of the pages
  // controller, whose chain IS returned - so the naive reading got both the
  // line and the awaited-ness wrong, on the two fields this clause exists to
  // state. This walk hops matched `(...)`/`[...]` groups and member paths
  // backwards until it reaches something that cannot be part of the chain.
  while (i >= 0) {
    const ch = code[i];
    if (ch === ')' || ch === ']') {
      let depth = 0;
      let j = i;
      for (; j >= 0; j--) {
        if (CLOSERS[code[j]]) {
          depth++;
        } else if (OPENERS[code[j]]) {
          depth--;
          if (depth === 0) {
            break;
          }
        }
      }
      if (j < 0) {
        break;
      }
      head = j;
      i = skipSpaceBack(code, j - 1);
      continue;
    }
    if (ch === '.') {
      head = i;
      i = skipSpaceBack(code, i - 1);
      continue;
    }
    if (isIdentifierChar(ch)) {
      const path = readMemberPathBack(code, i);
      if (path.text === 'return' || path.text === 'await') {
        return { line: lineFromIndex(ctx.lineIndex, path.start), awaited: true };
      }
      head = path.start;
      i = skipSpaceBack(code, path.start - 1);
      continue;
    }
    break;
  }

  // The chain is not returned or awaited at its own statement. It may still
  // be assigned to something that is - `promise = featuredStore.getList()...`
  // in the admin controller is returned twenty lines later - so an assignment
  // is reported as an assignment rather than as "nothing waits for it", which
  // would be a false claim about the very field this clause exists to state.
  let boundTo = null;
  const before = skipSpaceBack(code, head - 1);
  if (before >= 0 && code[before] === '=' && code[before - 1] !== '=' &&
    code[before - 1] !== '!' && code[before - 1] !== '<' && code[before - 1] !== '>' &&
    code[before + 1] !== '=') {
    const target = skipSpaceBack(code, before - 1);
    if (target >= 0 && (isIdentifierChar(code[target]) || code[target] === ']')) {
      const path = readMemberPathBack(code, target);
      boundTo = path.text || null;
    }
  }

  return {
    line: lineFromIndex(ctx.lineIndex, head),
    awaited: false,
    boundTo: boundTo
  };
}

// ---------------------------------------------------------------------------
// Corpus-wide reachability
//
// A carrier that no route binds is not automatically unreachable, and it is
// not automatically reachable either. Deciding which requires looking outside
// the file it lives in, because a helper's value can be handed to
// `server.method`, stored in a table, re-exported, or called from a
// controller. So the whole set this tool reads - the analysis targets, both
// route modules, the route parser and the bootstrap - is searched for
// mentions of the member, and the answer is either a traced driver or a PROOF
// that nothing mentions it.
//
// Measured on the helpers module: `internals.userByLogin` is declared at one
// offset and mentioned at no other in the entire repository, so it is dead
// code. Before this search the row for its error edge claimed a funnel it
// could not have, and was ticked closed. It is now proven unreachable, said
// to be so, and excluded from the closure gate rather than counted as proof
// of anything.
// ---------------------------------------------------------------------------

/**
 * Every file whose text can mention a carrier, read once per tree.
 *
 * @param {string} root the tree being analysed
 * @returns {Object[]} { relPath, src, codeOnly }
 */
function buildCorpus(root) {
  const paths = ANALYSIS_TARGETS
    .concat(ROUTE_MODULES)
    .concat(['lib/util/routeParser.js', 'app.js']);
  const seen = Object.create(null);
  const corpus = [];
  paths.forEach(function (relPath) {
    if (seen[relPath]) {
      return;
    }
    seen[relPath] = true;
    const abs = path.join(root, relPath);
    if (!fs.existsSync(abs)) {
      return;
    }
    const src = fs.readFileSync(abs, 'utf8');
    corpus.push({
      relPath: relPath,
      src: src,
      codeOnly: classifySource(src, relPath).codeOnly
    });
  });
  return corpus;
}

/**
 * Where a member is mentioned across the corpus, excluding its own
 * declaration.
 *
 * A mention is counted when the member appears qualified - `internals.name`,
 * `helpers.name`, `anything.name` - or as a quoted string, which is how a
 * server method is named in a route declaration. An unqualified bare
 * identifier is NOT counted, because member names like `list` and `create`
 * collide with local variables and would manufacture a driver that does not
 * exist.
 *
 * @param {Object[]} corpus from buildCorpus, or null when unavailable
 * @param {string} declaringFile the file that declares the member
 * @param {string} member the member name
 * @param {number} declStart start of the declaring carrier's extent
 * @param {number} declEnd end of the declaring carrier's extent
 * @returns {Object} { searched, mentions, sites }
 */
function memberMentions(corpus, declaringFile, member, declStart, declEnd) {
  if (!corpus || !corpus.length || !member) {
    return { searched: false, mentions: 0, sites: [] };
  }
  const escaped = member.replace(/[$]/g, '\\$');
  const qualified = new RegExp('\\.\\s*' + escaped + '\\b', 'g');
  const quoted = new RegExp("['\"]" + escaped + "['\"]", 'g');
  const sites = [];
  corpus.forEach(function (file) {
    let m;
    qualified.lastIndex = 0;
    while ((m = qualified.exec(file.codeOnly)) !== null) {
      if (file.relPath === declaringFile &&
          m.index >= declStart - member.length - 16 && m.index <= declEnd) {
        continue;
      }
      sites.push({ file: file.relPath, line: lineNumberAt(file.src, m.index), form: 'qualified' });
    }
    quoted.lastIndex = 0;
    while ((m = quoted.exec(file.src)) !== null) {
      sites.push({ file: file.relPath, line: lineNumberAt(file.src, m.index), form: 'string' });
    }
  });
  return { searched: true, mentions: sites.length, sites: sites };
}

// ---------------------------------------------------------------------------
// Edge extraction
// ---------------------------------------------------------------------------

/**
 * Inventory one analysed file.
 *
 * Terminal passes run first - the sites that actually dispose of an error -
 * because the container passes need to know whether a `.catch` handler, an
 * error listener or a callback already disposes of its error inside its own
 * body. A container that does is not a separate edge; the terminal site's row
 * records the container as its context.
 */
function analyseFile(relPath, src, bindings) {
  const classified = classifySource(src, relPath);
  const codeOnly = classified.codeOnly;
  const functions = findFunctions(codeOnly);
  const facts = collectFileFacts(relPath, src, codeOnly);
  const ctx = {
    relPath: relPath,
    src: src,
    codeOnly: codeOnly,
    kinds: classified.kinds,
    lineIndex: buildLineIndex(src),
    functions: functions,
    carriers: findCarriers(relPath, src, codeOnly, functions),
    bindings: bindings,
    facts: facts
  };
  // Discovered from this file, so a locally-named response builder is
  // recognised as one instead of looking like a handler that absorbs its
  // error.
  ctx.responseLocals = responseProducingLocals(ctx);

  const counts = {
    // Literal-substring counts, directly comparable to the measured
    // `grep -o '<token>' | wc -l` figures in BASELINE_COUNTS.
    replyLiteral: countOccurrences(codeOnly, 'reply('),
    thenLiteral: countOccurrences(codeOnly, '.then('),
    catchLiteral: countOccurrences(codeOnly, '.catch('),
    legacyHandlerDeclarations: (codeOnly.match(/function\s*\(\s*request\s*,\s*reply\s*\)/g) || []).length,
    toolkitHandlerDeclarations: (codeOnly.match(/function\s*\(\s*request\s*,\s*h\s*\)/g) || []).length,
    errParamFunctions: (codeOnly.match(/function\s*\(\s*err\b/g) || []).length
  };

  const edges = [];
  const terminalOffsets = [];
  const handlerFunctionBodies = new Set();

  function push(offset, spec) {
    const line = lineFromIndex(ctx.lineIndex, offset);
    const chain = carrierChainAt(ctx.carriers, offset);
    const carrier = chain.length ? chain[chain.length - 1] : null;
    const surface = surfaceFor(relPath, carrier, bindings, facts);
    const routing = routesForChain(bindings, relPath, chain);
    const edge = {
      file: relPath,
      offset: offset,
      line: line,
      endLine: spec.endLine || line,
      carrier: carrier ? carrier.name : '(module scope)',
      carrierMember: carrier ? carrier.member : null,
      // The carrier the routes came from, when it is not the innermost one.
      // A module-local function declared inside a routed handler is driven by
      // that handler, and the row says which.
      routedVia: routing.via && carrier && routing.via.name !== carrier.name
        ? routing.via.name
        : null,
      surface: surface,
      routes: routing.routes,
      snippet: sourceLine(ctx, line),
      notes: spec.notes || [],
      unresolved: Boolean(spec.unresolved),
      precedence: spec.precedence
    };
    // Tracing runs for an INTERNAL carrier and for an EXPORTED one that NO
    // ROUTE BINDS. The second case is a shared core: exported so a sibling
    // controller can call it, but not a lifecycle method, so `surfaceFor`
    // reads the export as a handler while route resolution correctly finds no
    // route. With tracing conditioned on INTERNAL alone such a row got no
    // callers, no value references and no reachability search, so `driveVia`
    // had nothing left to consult and returned `unresolved` - fatal - for
    // code two routed handlers demonstrably call. Whether a route binds it is
    // resolved by measurement here, not assumed from the export.
    if (surface === SURFACE.INTERNAL ||
        (surface === SURFACE.HANDLER && !(routing.routes || []).length)) {
      // Traced rather than assumed: see internalCallerSurfaces.
      const traced = internalCallerSurfaces(carrier);
      edge.callerSurfaces = traced.surfaces;
      edge.callers = traced.callers;
      edge.valueReferences = traced.valueReferences;
      edge.reachability = traced.reachability;
    }
    Object.keys(spec).forEach(function (key) {
      if (key !== 'notes' && key !== 'endLine') {
        edge[key] = spec[key];
      }
    });
    edge.endLine = spec.endLine || line;
    edge.notes = spec.notes || [];
    edges.push(edge);
    return edge;
  }

  // -- Pass A: reply(<value>) -----------------------------------------------
  // Only the sites that carry an error are edges. A reply() with a success
  // payload is counted for the self-check and skipped here; when it is the
  // response a deferred callback resolves, Pass F picks it up as a timing
  // edge instead.
  const replyCall = /(^|[^A-Za-z0-9_$.])reply\s*\(/g;
  let m;
  while ((m = replyCall.exec(codeOnly)) !== null) {
    const parenStart = m.index + m[0].length - 1;
    const parenEnd = matchDelimiter(codeOnly, parenStart);
    if (parenEnd === -1) {
      throw new AnalysisError(
        'unbalanced reply() call in ' + relPath + ' at line ' +
        lineNumberAt(src, parenStart)
      );
    }
    const arg = firstArgument(src, codeOnly, parenStart, parenEnd);
    const argKind = valueKind(arg.code, facts.bindings, parenStart);
    if (argKind.kind === 'empty' || argKind.kind === 'value') {
      continue;
    }
    const site = m.index + m[0].length - 1 - 'reply'.length;

    // EVALUATION ORDER. JavaScript resolves the CALLEE reference before it
    // evaluates any argument, so where `reply` is itself unbound the
    // exception names `reply` and the argument is never evaluated at all -
    // even when the argument would have thrown too. Measured against the
    // runtime for `return reply(Boom.forbidden())` with neither name bound:
    // `ReferenceError: reply is not defined`. Reading the argument first put
    // the wrong identifier in the message and therefore the wrong text in
    // Layer 1's log, which R-e requires this inventory to preserve and
    // compare. The status and the funnel are the same either way; the
    // message and the log are not.
    const kind = calleeKind('reply', site, facts.bindings, argKind);
    const unbound = kind.kind === 'unbound-reference';
    terminalOffsets.push(site);
    push(site, {
      precedence: 10,
      edgeClass: EDGE_CLASS.RESPONSE,
      // An unbound holder never constructs the value, so the site is not a
      // reply(err) at all: it is a synchronous ReferenceError that the
      // reply() call never receives.
      disposition: unbound ? DISPOSITION.BOOM : DISPOSITION.REPLY_ERR,
      shape: unbound
        ? 'synchronous throw (ReferenceError: ' + kind.holder + ' is not defined) ' +
          (kind.viaCallee
            ? 'resolving the callee of reply(' + summarise(arg.raw) + ')'
            : 'evaluating the argument of reply(' + summarise(arg.raw) + ')')
        : 'reply(' + summarise(arg.raw) + ')' +
          (isReturned(codeOnly, site) ? '' : ' with no return'),
      valueKind: kind,
      thrownKind: unbound ? kind : undefined,
      returned: isReturned(codeOnly, site),
      argument: summarise(arg.raw),
      propagation: propagationAt(ctx, site)
    });
  }

  // -- Pass B: reply.<property> --------------------------------------------
  // `reply` is a bare function; only the object it RETURNS carries .redirect
  // and friends. A property call on the function itself is a synchronous
  // TypeError, and the two sites in the baseline tree are the reason two
  // pages answer authenticated visitors with a 500.
  const replyMember = /(^|[^A-Za-z0-9_$.])reply\s*\.\s*([A-Za-z0-9_$]+)/g;
  while ((m = replyMember.exec(codeOnly)) !== null) {
    const site = m.index + m[0].indexOf('reply');
    terminalOffsets.push(site);
    push(site, {
      precedence: 5,
      edgeClass: EDGE_CLASS.RESPONSE,
      disposition: DISPOSITION.BOOM,
      shape: 'synchronous throw (TypeError: reply.' + m[2] + ' is not a function)',
      thrownKind: { kind: 'type-error', member: m[2] },
      propagation: propagationAt(ctx, site)
    });
  }

  // -- Pass C: request.fail(...) -------------------------------------------
  const failCall = /\brequest\.fail\s*\(/g;
  while ((m = failCall.exec(codeOnly)) !== null) {
    const parenStart = m.index + m[0].length - 1;
    const parenEnd = matchDelimiter(codeOnly, parenStart);
    if (parenEnd === -1) {
      throw new AnalysisError(
        'unbalanced request.fail() call in ' + relPath + ' at line ' +
        lineNumberAt(src, parenStart)
      );
    }
    const arg = firstArgument(src, codeOnly, parenStart, parenEnd);
    terminalOffsets.push(m.index);
    push(m.index, {
      precedence: 10,
      edgeClass: EDGE_CLASS.RESPONSE,
      disposition: DISPOSITION.FAIL_LOCAL,
      shape: 'request.fail(' + summarise(arg.raw) + ')' +
        (isReturned(codeOnly, m.index) ? '' : ' with no return'),
      returned: isReturned(codeOnly, m.index),
      argument: summarise(arg.raw),
      propagation: propagationAt(ctx, m.index)
    });
  }

  // -- Pass D: throw ---------------------------------------------------------
  const throwStmt = /\bthrow\b/g;
  while ((m = throwStmt.exec(codeOnly)) !== null) {
    const exprStart = skipSpaceForward(codeOnly, m.index + 5);
    const inner = innermostFunction(ctx.functions, m.index);
    const bounds = statementBounds(
      codeOnly,
      exprStart,
      inner ? inner.bodyStart + 1 : 0,
      inner ? inner.bodyEnd : codeOnly.length
    );
    const expr = codeOnly.slice(exprStart, Math.max(exprStart, bounds.end));
    terminalOffsets.push(m.index);
    const thrown = valueKind(expr, facts.bindings, exprStart);
    push(m.index, {
      precedence: 10,
      edgeClass: EDGE_CLASS.RESPONSE,
      disposition: DISPOSITION.BOOM,
      shape: (thrown.kind === 'unbound-reference'
        ? 'synchronous throw (ReferenceError: ' + thrown.holder + ' is not defined) ' +
          'evaluating '
        : 'throw ') + summarise(src.slice(exprStart, Math.max(exprStart, bounds.end))),
      thrownKind: thrown,
      propagation: propagationAt(ctx, m.index)
    });
  }

  // -- Pass E: return Boom / return errors ---------------------------------
  // Absent from the baseline tree - it has no such site - and present after
  // conversion, which is exactly why it is detected: the contrast with
  // `throw` is a 404 against a 500.
  const returnBoom = /\breturn\s+((?:Boom|errors|Hapi)\.(?:error\.)?[A-Za-z0-9_$]+)/g;
  while ((m = returnBoom.exec(codeOnly)) !== null) {
    const exprStart = m.index + m[0].indexOf(m[1]);
    // Binding-resolved for the same reason as every other Boom site: an
    // unbound holder throws while evaluating the return expression, so the
    // value is never returned and the contrast this pass exists to record -
    // a returned Boom's 404 against a thrown Boom's 500 - does not apply.
    const kind = valueKind(m[1], facts.bindings, exprStart);
    const unbound = kind.kind === 'unbound-reference';
    terminalOffsets.push(m.index);
    push(m.index, {
      precedence: 10,
      edgeClass: EDGE_CLASS.RESPONSE,
      disposition: DISPOSITION.BOOM,
      shape: (unbound
        ? 'synchronous throw (ReferenceError: ' + kind.holder + ' is not defined) evaluating return '
        : 'return ') + summarise(src.slice(exprStart, exprStart + 60).split('\n')[0]),
      thrownKind: kind,
      returnedBoom: !unbound,
      propagation: propagationAt(ctx, m.index)
    });
  }

  const terminalSet = terminalOffsets.slice().sort(function (a, b) {
    return a - b;
  });

  /**
   * Whether `fn` dispositions an error ON ITS OWN STACK.
   *
   * Terminal ownership has to be innermost-aware. The predecessor of this
   * function asked only whether a terminal offset fell anywhere between
   * `fn.bodyStart` and `fn.bodyEnd`, which is true for every terminal in
   * every function nested inside `fn` as well. The baseline asset-from-URL
   * handler is the case that exposes it:
   *
   *   tmp.tmpName(function(err, tmpPath) {          <- err, never inspected
   *     _request.get(...)
   *       .on('end', function() {
   *         FileUtil.uploadUserAsset(..., function(err, file) {
   *           if (err) return request.fail(err);     <- a terminal, 3 frames in
   *
   * The `request.fail` four frames down made the outer `tmp.tmpName` callback
   * look as though it disposed of its own `err`, so Passes F, G and H all
   * skipped it and the failure of `tmp.tmpName` - which discards `err` and
   * then uses an undefined path - got no row at all. It is a genuine edge
   * with a genuine disposition, and it was invisible.
   *
   * A terminal counts as owned by `fn` only when `fn` is the INNERMOST
   * function containing it. A terminal inside an `if` or a `try` block still
   * counts, because a block is not a function.
   */
  function hasDirectTerminalIn(fn) {
    for (let i = 0; i < terminalSet.length; i++) {
      const at = terminalSet[i];
      if (at <= fn.bodyStart || at >= fn.bodyEnd) {
        continue;
      }
      const inner = innermostFunction(ctx.functions, at);
      if (inner && inner.bodyStart === fn.bodyStart) {
        return true;
      }
    }
    return false;
  }

  /** Whether a terminal exists in a function nested inside `fn`. */
  function hasNestedTerminalIn(fn) {
    for (let i = 0; i < terminalSet.length; i++) {
      const at = terminalSet[i];
      if (at <= fn.bodyStart || at >= fn.bodyEnd) {
        continue;
      }
      const inner = innermostFunction(ctx.functions, at);
      if (!inner || inner.bodyStart !== fn.bodyStart) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether `fn` hands its error to an outer continuation, and by what.
   *
   * Three vehicles, all measured in this repository:
   *
   *   if (err) reject(err);                 - rejects the enclosing promise
   *   resolve({ err : err, value : value }) - resolves WITH the error as data
   *   if (err) return next(err);            - invokes an outer continuation
   *
   * All three mean the error leaves this function and the awaiting caller
   * decides the response. None of them is "swallows silently", and a callback
   * that logs and then rejects is not "logs and continues" either: its
   * continuation is a rejection.
   *
   * @returns {{vehicle: string, line: number}|null}
   */
  function propagationVehicleIn(fn, paramName) {
    if (!paramName) {
      return null;
    }
    const body = codeOnly.slice(fn.bodyStart, fn.bodyEnd);
    const outerParams = new Set();
    enclosingFunctions(ctx.functions, fn.keywordAt).forEach(function (outer) {
      if (outer.bodyStart === fn.bodyStart) {
        return;
      }
      parameterNames(outer).forEach(function (name) {
        outerParams.add(name);
      });
    });

    const candidates = ['reject', 'resolve', 'callback', 'cb', 'next', 'done', 'deferred.reject'];
    let best = null;
    candidates.forEach(function (callee) {
      const token = callee + '(';
      let at = body.indexOf(token);
      while (at !== -1) {
        const absolute = fn.bodyStart + at;
        const before = absolute > 0 ? codeOnly[absolute - 1] : ' ';
        const isMemberCall = callee.indexOf('.') !== -1;
        if ((isMemberCall || (!isIdentifierChar(before) && before !== '.')) &&
            innermostFunctionIs(absolute, fn)) {
          const open = absolute + callee.length;
          const close = matchDelimiter(codeOnly, open);
          if (close !== -1) {
            const args = codeOnly.slice(open + 1, close);
            // Only a call that actually carries the error propagates it.
            // `resolve(user)` on the success arm of `if (err) reject(err);
            // else resolve(user)` is not a propagation of `err`.
            if (referencesIdentifier(args, paramName)) {
              const vehicle = callee === 'reject' || callee === 'deferred.reject'
                ? 'rejects the enclosing promise via `' + callee + '(' + paramName + ')`'
                : callee === 'resolve'
                  ? 'resolves the enclosing promise WITH the error, via `resolve(' +
                    summarise(src.slice(open + 1, close)) + ')`'
                  : (outerParams.has(callee)
                    ? 'invokes its caller\'s continuation `' + callee + '(' + paramName + ')`'
                    : 'invokes `' + callee + '(' + paramName + ')`');
              const line = lineFromIndex(ctx.lineIndex, absolute);
              if (!best || line < best.line) {
                best = { vehicle: vehicle, line: line, callee: callee };
              }
            }
          }
        }
        at = body.indexOf(token, at + 1);
      }
    });
    return best;
  }

    /**
   * The surfaces that CALL an internal callee, traced through the file.
   *
   * An internal callee has no funnel of its own: hapi never invokes it, so
   * its errors travel by the rules of whatever called it, and a pre-handler
   * caller and a route-handler caller send the same throw to different
   * funnels. Asserting one without looking would put a guess where a
   * measurement belongs, so the callers are traced and a row with no
   * traceable caller says so instead of claiming a funnel.
   *
   * @returns {{surfaces: string[], callers: string[]}}
   */
  function internalCallerSurfaces(carrier) {
    if (!carrier || !carrier.member) {
      return { surfaces: [], callers: [], valueReferences: [], reachability: { searched: false, mentions: 0, sites: [] } };
    }
    const surfaces = new Set();
    const callers = new Set();
    const escaped = carrier.member.replace(/\$/g, '\\$');

    // Direct call syntax: `name(...)`, `internals.name(...)`, and the
    // same-module export forms `module.exports.name(...)` / `exports.name(...)`.
    // The last two are how a shared core extracted out of a handler is called
    // by the handler it was extracted from, and recognising only `internals.`
    // missed it: measured, `module.exports.createCourseCore(...)` at
    // lib/controllers/course.js:27 traced to no caller at all, so the row for
    // its save callback resolved `unresolved` and the generator refused to
    // write the document. A qualifier naming this module's own exports is a
    // call to a member of this module, which is exactly what is being traced.
    const pattern = new RegExp('(^|[^A-Za-z0-9_$.])' +
      '(?:module\\.exports\\.|exports\\.|internals\\.)?' +
      escaped + '\\s*\\(', 'g');
    let m;
    while ((m = pattern.exec(codeOnly)) !== null) {
      const at = m.index + m[0].length - 1;
      // Its own declaration, and the `server.method('x', internals.x)`
      // registration, are not calls.
      if (at >= carrier.start && at < carrier.end) {
        continue;
      }
      const callerChain = carrierChainAt(ctx.carriers, at);
      const caller = callerChain.length ? callerChain[callerChain.length - 1] : null;
      if (!caller || caller.member === carrier.member) {
        continue;
      }
      const surface = surfaceFor(relPath, caller, bindings, facts);
      if (surface === SURFACE.MODULE) {
        continue;
      }
      surfaces.add(surface);
      callers.add(caller.name);
    }

    // INDIRECT AND TABLE DISPATCH. Recognising call syntax alone misses every
    // function that is INVOKED SOMEWHERE ELSE from a value handed on here -
    // `server.method('n', internals.x)`, `[internals.x, internals.y]`,
    // `{ method: internals.x }`, `pre: internals.x`, `f(internals.x)`,
    // `module.exports.y = internals.x`. Each is a driver, and each looks like
    // nothing at all to a pattern that requires a following `(`. A reference
    // that is NOT followed by `(` and is not the declaration is therefore
    // recorded as the value escaping, with where it escapes to.
    const valueReferences = [];
    const asValue = new RegExp('(^|[^A-Za-z0-9_$.])' +
      '(?:module\\.exports\\.|exports\\.|internals\\.)?' +
      escaped + '\\b(?!\\s*[(=])', 'g');
    while ((m = asValue.exec(codeOnly)) !== null) {
      const at = m.index + m[0].indexOf(carrier.member);
      if (at >= carrier.start && at < carrier.end) {
        continue;
      }
      valueReferences.push({
        line: lineFromIndex(ctx.lineIndex, at),
        context: summarise(src.slice(
          src.lastIndexOf('\n', at) + 1,
          (function () {
            const nl = src.indexOf('\n', at);
            return nl === -1 ? src.length : nl;
          }())
        ))
      });
      const holderChain = carrierChainAt(ctx.carriers, at);
      const holder = holderChain.length ? holderChain[holderChain.length - 1] : null;
      if (holder && holder.member !== carrier.member) {
        const surface = surfaceFor(relPath, holder, bindings, facts);
        if (surface !== SURFACE.MODULE) {
          surfaces.add(surface);
          callers.add(holder.name);
        }
      }
    }

    return {
      surfaces: Array.from(surfaces).sort(),
      callers: Array.from(callers).sort(),
      valueReferences: valueReferences,
      reachability: memberMentions(
        bindings && bindings.corpus,
        relPath,
        carrier.member,
        carrier.start,
        carrier.end
      )
    };
  }

  /** Whether the innermost function containing `offset` is `fn`. */
  function innermostFunctionIs(offset, fn) {
    const inner = innermostFunction(ctx.functions, offset);
    return Boolean(inner) && inner.bodyStart === fn.bodyStart;
  }

  // -- Pass F: error handlers - .catch(...) and .on('error', ...) ----------
  const handlerSites = [];

  const catchCall = /\.catch\s*\(/g;
  while ((m = catchCall.exec(codeOnly)) !== null) {
    const parenStart = m.index + m[0].length - 1;
    const parenEnd = matchDelimiter(codeOnly, parenStart);
    if (parenEnd === -1) {
      throw new AnalysisError(
        'unbalanced .catch() call in ' + relPath + ' at line ' +
        lineNumberAt(src, parenStart)
      );
    }
    handlerSites.push({ at: m.index, parenStart: parenStart, parenEnd: parenEnd, mechanism: '.catch()' });
  }

  // The event name has to be read from the RAW source: classifySource blanks
  // string interiors, so a pattern that spelled out 'error' inside the regex
  // would match nothing. Getting this wrong is silent - the listener still
  // gets a row from the error-parameter pass, with the wrong mechanism and
  // without the stream-sibling finding - so it is spelled out here.
  const anyListener = /\.on\s*\(/g;
  while ((m = anyListener.exec(codeOnly)) !== null) {
    const parenStart = m.index + m[0].length - 1;
    const eventArgument = readStringLiteral(src, codeOnly, parenStart + 1);
    if (!eventArgument || eventArgument.text !== 'error') {
      continue;
    }
    const parenEnd = matchDelimiter(codeOnly, parenStart);
    if (parenEnd === -1) {
      throw new AnalysisError(
        'unbalanced .on(\'error\') call in ' + relPath + ' at line ' +
        lineNumberAt(src, parenStart)
      );
    }
    handlerSites.push({
      at: m.index,
      parenStart: parenStart,
      parenEnd: parenEnd,
      mechanism: '.on(\'error\')',
      listener: true
    });
  }

  handlerSites.sort(function (a, b) {
    return a.at - b.at;
  });

  handlerSites.forEach(function (site) {
    const handlerFn = ctx.functions.find(function (fn) {
      return fn.keywordAt > site.parenStart && fn.bodyEnd <= site.parenEnd;
    });

    if (!handlerFn) {
      const arg = firstArgument(src, codeOnly, site.parenStart, site.parenEnd);
      const bare = arg.code.trim();
      if (!/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(bare)) {
        return;
      }
      const resolved = bareHandlerDisposition(bare);
      push(site.at, {
        precedence: 20,
        edgeClass: EDGE_CLASS.HANDLER,
        disposition: resolved.disposition,
        shape: site.mechanism.replace('()', '(' + bare + ')') + ' bare reference',
        bareReference: bare,
        mechanism: site.mechanism,
        unresolved: !resolved.resolved,
        chain: chainContext(ctx, site.at),
        notes: resolved.resolved ? [] : [
          'The handler is a bare reference to `' + bare + '`, which this tool ' +
          'did not resolve to a body in this file. The disposition recorded is ' +
          'the conservative one; confirm it by hand before closing the row.'
        ],
        propagation: propagationAt(ctx, site.at)
      });
      return;
    }

    handlerFunctionBodies.add(handlerFn.bodyStart);
    if (hasDirectTerminalIn(handlerFn)) {
      // The handler disposes of the error on its own stack; those sites are
      // already rows and they name this handler as their context.
      return;
    }

    const params = parameterNames(handlerFn);
    const paramName = params.length ? params[0] : null;
    const body = bodyText(codeOnly, handlerFn);
    const logs = loggingReferences(ctx, handlerFn, paramName);
    const anyLogs = logs.length ? logs : loggingReferences(ctx, handlerFn, null);
    const references = paramName
      ? referencesIdentifier(codeOnly.slice(handlerFn.bodyStart, handlerFn.bodyEnd), paramName)
      : false;

    // A handler that produces a response while disposing of no error is the
    // sharpest case in this pass: the rejection is answered as a SUCCESS.
    const producedHere = responseCallsDirectlyIn(ctx, handlerFn);
    const propagates = propagationVehicleIn(handlerFn, paramName);
    const nestedTerminal = hasNestedTerminalIn(handlerFn);
    // A response BUILT FROM the error is a different edge from a response
    // that ignores it, and the two must not share a classification. The
    // conversion routinely replaces `return reply(err)` with
    // `return errorResponse(h, err)` or `return legacyReply(err, h)`, which
    // reproduces the shim's own selection - a Boom unchanged, another Error
    // as badImplementation, anything else as a 200 body. That is the same
    // OUTCOME by another name, so it is classified as returning the error and
    // not as absorbing it.
    const returnsErrorAsResponse = paramName
      ? producedHere.filter(function (hit) {
        const open = ctx.codeOnly.indexOf('(', hit.offset + hit.token.length - 1);
        const close = matchDelimiter(ctx.codeOnly, open);
        if (close === -1) {
          return false;
        }
        return referencesIdentifier(ctx.codeOnly.slice(open + 1, close), paramName) &&
          isReturned(ctx.codeOnly, hit.offset);
      })
      : [];
    // `return err;` with no call at all. The bare return is the converted
    // form of `return reply(err)` and it is the most common one in this
    // tree, because hapi normalizes a returned Error itself - `Response.wrap`
    // boomifies it - so a controller that wants the shim's exact selection
    // returns the value and nothing else. Without this the handler looks like
    // it absorbs its error and every edge upstream of it inherits a funnel of
    // `none`, which is how 21 edges that answer 500 came to be reported as
    // answering nothing.
    const bareErrorReturn = paramName
      ? bareReturnOf(ctx, handlerFn, paramName)
      : null;
    const notes = [];
    let disposition;
    let errorAsResponseKind = null;
    let errorAsResponseVia = null;
    if (propagates) {
      // Precedence over both logging and swallowing: an error handed onward
      // is neither absorbed nor merely logged, whatever else the body does.
      disposition = DISPOSITION.PROPAGATE;
      notes.push(
        'The handler ' + propagates.vehicle + ' at line ' + propagates.line +
        ', so the error leaves this function and the awaiting caller decides ' +
        'the response.' +
        (anyLogs.length
          ? ' It logs as well, which is why this row is not `' +
            DISPOSITION.LOG_CONTINUE + '`: the continuation is a rejection, ' +
            'not the normal path.'
          : '')
      );
    } else if (returnsErrorAsResponse.length || bareErrorReturn) {
      // The error itself becomes the response. `reply(` is the legacy spelling
      // and gets the vocabulary's own value for it; any other builder, and a
      // bare `return err`, is a returned error value - which is what
      // `returns or throws a Boom` names.
      const builder = returnsErrorAsResponse.length
        ? returnsErrorAsResponse[0].token.replace('(', '')
        : null;
      disposition = builder === 'reply' ? DISPOSITION.REPLY_ERR : DISPOSITION.BOOM;
      errorAsResponseKind = { kind: 'error-identifier', name: paramName };
      errorAsResponseVia = builder ? '`' + builder + '`' : '`return ' + paramName + '`';
      notes.push(
        'The handler returns the error as the response, through ' +
        errorAsResponseVia + ', so the rejection is answered with a response ' +
        'derived from `' + paramName + '` rather than absorbed. A Boom keeps ' +
        'its own status; any other Error is boomified and answered 500 with ' +
        'the generic 5xx body; a value that is neither is served 200 as the ' +
        'body. Preserve the selection, not just the common case.'
      );
    } else if (anyLogs.length > 0) {
      disposition = DISPOSITION.LOG_CONTINUE;
    } else if (body === '') {
      disposition = DISPOSITION.SWALLOW;
      notes.push('The handler body is empty.');
    } else if (nestedTerminal) {
      // The response exists, but it is produced in a function nested inside
      // this handler, so it settles only if that nested callback runs.
      disposition = DISPOSITION.LATE_RESOLVE;
      notes.push(
        'The response for this rejection is produced inside a callback ' +
        'nested in this handler, not on the handler\'s own stack, so it ' +
        'settles only when that callback runs.'
      );
    } else {
      disposition = DISPOSITION.SWALLOW;
      if (!producedHere.length) {
        notes.push(
          'The handler body runs work but produces no response and rethrows ' +
          'nothing, so the error is absorbed here.'
        );
      }
    }

    if (site.listener) {
      const siblings = streamSiblingListeners(ctx, site);
      if (siblings.length) {
        notes.push(
          'Sibling listeners on the same stream: ' + siblings.join(', ') +
          '. A refused connection emits `error` and NOT `end`, so the `end` ' +
          'handler never runs and the request is left unsettled; a mid-stream ' +
          'failure after `response` may still reach `end`. Both outcomes are ' +
          'baseline behaviour and both are preserved.'
        );
      }
    }

    push(handlerFn.keywordAt, {
      precedence: 20,
      edgeClass: EDGE_CLASS.HANDLER,
      disposition: disposition,
      shape: site.mechanism + ' handler' +
        (disposition === DISPOSITION.LOG_CONTINUE
          ? ' - logs only'
          : disposition === DISPOSITION.PROPAGATE
            ? ' - hands the error onward'
            : disposition === DISPOSITION.LATE_RESOLVE
              ? ' - responds from a nested callback'
              : errorAsResponseKind
                ? ' - returns the error as the response via ' +
                  String(errorAsResponseVia).replace(/`/g, '')
                : ' - absorbs'),
      mechanism: site.mechanism,
      propagatesVia: propagates,
      valueKind: errorAsResponseKind || undefined,
      thrownKind: errorAsResponseKind || undefined,
      paramName: paramName,
      loggingCalls: anyLogs,
      referencesParam: references,
      producedResponses: producedHere.map(function (p) {
        return p.token.replace('(', '');
      }),
      endLine: lineFromIndex(ctx.lineIndex, handlerFn.bodyEnd),
      notes: notes,
      chain: chainContext(ctx, site.at),
      propagation: propagationAt(ctx, handlerFn.keywordAt)
    });
  });

  // -- Pass G: continuation-passing callbacks that produce the response ----
  ctx.functions.forEach(function (fn) {
    const site = callSiteOf(codeOnly, fn);
    if (!site) {
      return;
    }
    if (PROMISE_CONTINUATIONS.has(site.calleeTail) || SYNCHRONOUS_ITERATEES.has(site.calleeTail)) {
      return;
    }
    if (handlerFunctionBodies.has(fn.bodyStart)) {
      return;
    }
    const carrier = carrierAt(ctx.carriers, fn.keywordAt);
    const invoked = carrierFunction(ctx.functions, carrier);
    if (invoked && invoked.bodyStart === fn.bodyStart) {
      return;
    }
    const produced = responseCallsDirectlyIn(ctx, fn);
    if (produced.length === 0) {
      return;
    }
    const params = parameterNames(fn);
    const errParam = params.length && isErrorParameter(params[0]) ? params[0] : null;
    const notes = [];
    if (!errParam) {
      notes.push(
        'The callback declares no error parameter, so the failure of `' +
        site.calleeText + '` is dropped entirely: no response, no log, no ' +
        'branch. That is baseline behaviour and it is preserved.'
      );
    } else if (!referencesIdentifier(codeOnly.slice(fn.bodyStart, fn.bodyEnd), errParam)) {
      notes.push(
        'The callback declares `' + errParam + '` and never inspects it, so ' +
        'the failure of `' + site.calleeText + '` is dropped while the ' +
        'response is produced regardless.'
      );
    }
    push(fn.keywordAt, {
      precedence: 30,
      edgeClass: EDGE_CLASS.CPS,
      disposition: DISPOSITION.LATE_RESOLVE,
      shape: 'CPS callback boundary (' + site.calleeText + ')',
      callee: site.calleeText,
      producedResponses: produced.map(function (p) {
        return p.token.replace('(', '');
      }),
      paramName: errParam,
      endLine: lineFromIndex(ctx.lineIndex, fn.bodyEnd),
      notes: notes,
      propagation: propagationAt(ctx, fn.keywordAt)
    });
  });

  // -- Pass H: error parameters nobody dispositions ------------------------
  ctx.functions.forEach(function (fn) {
    if (handlerFunctionBodies.has(fn.bodyStart)) {
      return;
    }
    const params = parameterNames(fn);
    if (!params.length || !isErrorParameter(params[0])) {
      return;
    }
    // Direct ownership only. A response produced by a DESCENDANT callback
    // does not disposition this function's own error parameter, and treating
    // it as though it did is what lost the `tmp.tmpName(err, path)` edge.
    if (hasDirectTerminalIn(fn)) {
      return;
    }
    const paramName = params[0];
    const bodyRange = codeOnly.slice(fn.bodyStart, fn.bodyEnd);
    const references = referencesIdentifier(bodyRange, paramName);
    const logs = loggingReferences(ctx, fn, paramName);
    const body = bodyText(codeOnly, fn);
    const site = callSiteOf(codeOnly, fn);
    const propagates = propagationVehicleIn(fn, paramName);
    const nestedTerminal = hasNestedTerminalIn(fn);
    const notes = [];
    let disposition;
    if (propagates) {
      disposition = DISPOSITION.PROPAGATE;
      notes.push(
        'The callback ' + propagates.vehicle + ' at line ' + propagates.line +
        ', so `' + paramName + '` leaves this function and the awaiting ' +
        'caller decides the response.' +
        (logs.length
          ? ' It logs `' + paramName + '` as well, which is why this row is ' +
            'not `' + DISPOSITION.LOG_CONTINUE + '`: the continuation is a ' +
            'rejection, not the normal path.'
          : '')
      );
    } else if (logs.length > 0) {
      disposition = DISPOSITION.LOG_CONTINUE;
    } else {
      disposition = DISPOSITION.SWALLOW;
      if (body === '') {
        notes.push('The callback body is empty: the operation is fired and forgotten.');
      } else if (!references) {
        notes.push('`' + paramName + '` is declared and never read.');
      } else {
        notes.push(
          '`' + paramName + '` is read but never turned into a response, a ' +
          'log or a rethrow.'
        );
      }
      if (nestedTerminal) {
        notes.push(
          'A callback nested inside this one does produce a response, but it ' +
          'dispositions its own error rather than this `' + paramName + '`: ' +
          'this parameter is still undispositioned, and the nested response ' +
          'is produced whether this operation failed or not.'
        );
      }
    }
    push(fn.keywordAt, {
      precedence: 40,
      edgeClass: EDGE_CLASS.ERR_PARAM,
      disposition: disposition,
      shape: 'error parameter of a callback to ' +
        (site ? '`' + site.calleeText + '`' : 'a local function') +
        (disposition === DISPOSITION.LOG_CONTINUE
          ? ' - logs only'
          : disposition === DISPOSITION.PROPAGATE
            ? ' - handed onward'
            : ' - undispositioned'),
      callee: site ? site.calleeText : null,
      paramName: paramName,
      propagatesVia: propagates,
      loggingCalls: logs,
      referencesParam: references,
      endLine: lineFromIndex(ctx.lineIndex, fn.bodyEnd),
      notes: notes,
      propagation: propagationAt(ctx, fn.keywordAt)
    });
  });

  const finalEdges = assignIdentities(dedupeEdges(edges));
  finalEdges.forEach(function (edge) {
    edge.driveVia = driveVia(edge);
    // Drivable and reachability-known are different properties. A proven
    // unreachable edge is reachability-KNOWN and NOT drivable, so its row
    // must not claim an outcome and must not be ticked; an unresolved one is
    // neither, and is fatal.
    edge.drivable = isDrivable(edge);
    edge.reachabilityKnown = edge.driveVia !== 'unresolved';
  });
  return { edges: finalEdges, counts: counts, carriers: ctx.carriers, facts: facts };
}

/**
 * Give every edge a STABLE identity, so a baseline row and its target row can
 * be joined mechanically.
 *
 * The identity is `<file basename>.<carrier member>.<class>.<ordinal>`, and
 * what it leaves OUT is the design:
 *
 *   - no line number, because conversion moves every one of them;
 *   - no disposition, because conversion is what changes dispositions - a
 *     `reply(err)` site becomes `return errors.notFound()` and goes from
 *     `calls reply(err)` to `returns or throws a Boom`. An identity carrying
 *     the disposition would never match its own target row, which is the one
 *     comparison the identity exists to make;
 *   - no funnel, for the same reason.
 *
 * What it keeps is the file, the carrier the edge sits in, the coarse class
 * of edge, and the ordinal of the edge within that (file, carrier, class) in
 * source order. Handler and pre-handler names are invariants of this
 * migration - the route declarations bind them by name - so the carrier is
 * stable, and the class buckets together exactly the shapes that convert into
 * one another.
 *
 * The ordinal is the one component that can shift, when conversion adds or
 * removes a site inside one carrier. That is reported rather than hidden: a
 * baseline row whose exact identity finds no target row is matched by
 * position within its (file, carrier, class) group and flagged
 * `matched-by-fallback`, and a row that finds nothing at all is reported as
 * missing from the target. Both are states a reviewer must resolve, which is
 * the correct outcome for a row whose target cannot be located.
 */
function assignIdentities(edges) {
  const ordinals = new Map();
  edges.forEach(function (edge) {
    const base = identityBase(edge);
    const next = (ordinals.get(base) || 0) + 1;
    ordinals.set(base, next);
    edge.identityBase = base;
    edge.ordinal = next;
    edge.id = base + '.' + next;
  });
  return edges;
}

/** The identity of an edge without its ordinal. */
function identityBase(edge) {
  const file = path.basename(edge.file, '.js');
  const carrier = edge.carrierMember || '$module';
  const cls = edge.edgeClass || EDGE_CLASS.RESPONSE;
  return file + '.' + carrier + '.' + cls;
}

function isErrorParameter(name) {
  return ERROR_IDENTIFIERS.has(name) || /^err/i.test(name);
}

/** Event names other than 'error' listened for on the same chain. */
function streamSiblingListeners(ctx, site) {
  const inner = innermostFunction(ctx.functions, site.at);
  const bounds = statementBounds(
    ctx.codeOnly,
    site.at,
    inner ? inner.bodyStart + 1 : 0,
    inner ? inner.bodyEnd : ctx.codeOnly.length
  );
  const fragment = ctx.src.slice(bounds.start, bounds.end);
  const names = [];
  const listener = /\.on\s*\(\s*['"]([A-Za-z0-9_$-]+)['"]/g;
  let m;
  while ((m = listener.exec(fragment)) !== null) {
    if (m[1] !== 'error' && names.indexOf('`' + m[1] + '`') === -1) {
      names.push('`' + m[1] + '`');
    }
  }
  return names;
}

/** One row per offset: the highest-precedence finding wins, notes merge. */
function dedupeEdges(edges) {
  const byOffset = new Map();
  edges.forEach(function (edge) {
    const existing = byOffset.get(edge.offset);
    if (!existing) {
      byOffset.set(edge.offset, edge);
      return;
    }
    if (edge.precedence < existing.precedence) {
      edge.notes = dedupe(edge.notes.concat(existing.notes));
      byOffset.set(edge.offset, edge);
    } else {
      existing.notes = dedupe(existing.notes.concat(edge.notes));
    }
  });
  return Array.from(byOffset.values()).sort(function (a, b) {
    return a.line - b.line || a.offset - b.offset;
  });
}

/** Compact a source fragment for use inside a Markdown table cell. */
function summarise(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  if (flat.length <= 60) {
    return flat;
  }
  return flat.slice(0, 57) + '...';
}

// ---------------------------------------------------------------------------
// Funnel resolution
//
// Runs after a file's edges are collected, because an edge whose exception is
// taken by a downstream `.catch` reaches whichever funnel THAT handler
// reaches, and that handler is itself a row.
// ---------------------------------------------------------------------------

/**
 * The funnel an edge reaches, given the surface it sits on.
 *
 * An internal callee inherits from its traced callers. Where the callers all
 * agree the answer is theirs; where they disagree the more severe funnel is
 * taken and the row is marked unresolved so a reviewer settles it; where
 * nothing in the file calls the function at all there is no funnel to claim,
 * and the row says that rather than defaulting to one.
 */
function inheritedSurfaceFunnel(edge, pre) {
  if (edge.surface === SURFACE.HANDLER) {
    return FUNNEL.L1;
  }
  if (pre || edge.surface === SURFACE.SERVER_METHOD) {
    return FUNNEL.L3;
  }
  if (edge.surface === SURFACE.INTERNAL) {
    const surfaces = edge.callerSurfaces || [];
    if (!surfaces.length) {
      const reach = edge.reachability || { searched: false, mentions: 0 };
      if (reach.searched && reach.mentions === 0) {
        // SETTLED, not deferred. The corpus - the analysis targets, both
        // route modules, the route parser and the bootstrap - was searched
        // for this member and holds exactly one mention of it: its own
        // declaration. So nothing calls it, nothing hands its value on, and
        // no route names it. There is no funnel because there is no
        // invocation, and the row says that rather than asking a reviewer to
        // find out.
        edge.unreachableProven = true;
        edge.notes = (edge.notes || []).concat(
          'PROVEN UNREACHABLE. This member is mentioned nowhere in the ' +
          'analysed corpus outside its own declaration - not called, not ' +
          'handed on as a value, not registered as a server method, not ' +
          'exported as a lifecycle method and named by no route - so nothing ' +
          'in this tree can reach this edge. It claims no funnel because it ' +
          'produces no response, it is excluded from the closure gate because ' +
          'there is no outcome to compare, and it is dead code rather than an ' +
          'open question.'
        );
        return FUNNEL.NONE;
      }
      edge.unresolved = true;
      edge.notes = (edge.notes || []).concat(
        'No caller was traced for this function and the corpus search could ' +
        'not be run, so no funnel is claimed for this edge and its ' +
        'reachability is UNKNOWN rather than absent. Settle it before ' +
        'closing the row.'
      );
      return FUNNEL.NONE;
    }
    if (surfaces.indexOf(SURFACE.HANDLER) !== -1) {
      if (surfaces.length > 1) {
        edge.unresolved = true;
        edge.notes = (edge.notes || []).concat(
          'This function is called from more than one surface (' +
          surfaces.join(', ') + ', via ' + (edge.callers || []).join(', ') +
          '), which reach different funnels. The more severe is recorded; ' +
          'confirm per caller before closing the row.'
        );
      }
      return FUNNEL.L1;
    }
    return FUNNEL.L3;
  }
  return FUNNEL.NONE;
}

function resolveFunnels(edges, funnels) {
  // Whether this tree still carries the compatibility shim decides two
  // funnels outright, so it is an input rather than an assumption. A
  // pre-handler that hands back a non-Boom Error RESOLVES under the shim -
  // no response, funnel none - and is boomified to 500 through Layer 3
  // without it. Deciding that without knowing which tree this is produced a
  // row whose Funnel said one thing and whose Target said the other.
  const shimPresent = !funnels || funnels.shimPresent !== false;
  const byOffset = new Map();
  edges.forEach(function (edge) {
    byOffset.set(edge.offset, edge);
  });

  function inheritFrom(link) {
    if (!link) {
      return null;
    }
    let found = null;
    edges.forEach(function (edge) {
      if (edge.offset >= link.parenStart - 8 && edge.offset <= link.parenEnd) {
        if (!found || edge.offset < found.offset) {
          found = edge;
        }
      }
    });
    return found;
  }

  edges.forEach(function (edge) {
    const pre = edge.surface === SURFACE.PRE || edge.surface === SURFACE.INLINE_PRE;
    const prop = edge.propagation || {};

    // An error handed to an outer continuation reaches whatever funnel the
    // awaiting caller reaches. Within this file that is the carrier's own
    // funnel; the row names the vehicle so the hop is checkable. On a route
    // handler an unhandled rejection lands in the handler catch-all, which is
    // Layer 1; on a pre-handler or server method there is no catch-all and
    // hapi's own lifecycle error handling answers, which is Layer 3.
    if (edge.disposition === DISPOSITION.PROPAGATE) {
      edge.funnel = inheritedSurfaceFunnel(edge, pre);
      return;
    }

    if (edge.disposition === DISPOSITION.FAIL_LOCAL) {
      edge.funnel = FUNNEL.L2;
      if (pre) {
        edge.funnel = FUNNEL.NONE;
        edge.notes = edge.notes.concat(
          'request.fail is installed on the request by the handler wrapper, ' +
          'which runs after pre-handlers, so on this surface the call is a ' +
          'TypeError rather than a Layer 2 entry. Confirm against the ' +
          'baseline capture before closing.'
        );
      }
      return;
    }

    if (edge.disposition === DISPOSITION.REPLY_ERR) {
      const kind = edge.valueKind || { kind: 'error-identifier' };
      if (pre) {
        // A Boom reaches Layer 3 on either tree. A non-Boom Error is where
        // the two contracts diverge: the shim resolves it as the pre value,
        // so nothing answers; hapi's own Response.wrap boomifies it and the
        // default pre failAction throws it, so Layer 3 answers 500.
        edge.funnel = kind.kind === 'boom' || !shimPresent ? FUNNEL.L3 : FUNNEL.NONE;
        if (edge.funnel === FUNNEL.NONE) {
          // The site is VALUE-DEPENDENT: the shim selects on `isBoom` at
          // runtime, so the same line resolves for a plain Error and rejects
          // for a Boom. One funnel field cannot carry both, and burying the
          // second in prose left the row saying `none` while its own text
          // named Layer 3. It is recorded as a FIELD so the row states both
          // outcomes and the coherence check can tell a genuine alternative
          // from a contradiction.
          edge.funnelAlternate = FUNNEL.L3;
          edge.notes = edge.notes.concat(
            'This site is value-dependent. The shim selects on `isBoom`, so ' +
            'the funnel is none when the value is a plain Error - it is ' +
            'RESOLVED as the pre-handler\'s assigned value and nothing ' +
            'answers - and Layer 3 when the value is a Boom, which the same ' +
            'line rejects with. Both outcomes are baseline behaviour and both ' +
            'must be preserved; the funnel field carries the plain-Error case ' +
            'because that is what an ordinary rejection produces here, and the ' +
            'closure comparison keys on it.'
          );
        }
      } else {
        edge.funnel = FUNNEL.L3;
      }
      return;
    }

    if (edge.disposition === DISPOSITION.LOG_CONTINUE || edge.disposition === DISPOSITION.SWALLOW) {
      edge.funnel = FUNNEL.NONE;
      return;
    }

    // An error handler that RETURNS the error as its response answers the
    // request from the value it returns, exactly as the legacy `reply(err)`
    // did. hapi post-processes the result, so the funnel is Layer 3 on every
    // surface - there is no throw for the handler catch-all to take.
    if (edge.edgeClass === EDGE_CLASS.HANDLER && edge.valueKind &&
        edge.valueKind.kind === 'error-identifier') {
      edge.funnel = FUNNEL.L3;
      return;
    }

    if (edge.disposition === DISPOSITION.LATE_RESOLVE) {
      const produced = edge.producedResponses || [];
      edge.funnel = produced.indexOf('request.fail') !== -1 ? FUNNEL.L2 : FUNNEL.NONE;
      return;
    }

    // DISPOSITION.BOOM - throw, return Boom, the reply.<prop> TypeError, or
    // an unbound Boom reference.
    //
    // An unbound reference throws a ReferenceError while the expression is
    // being evaluated, so it behaves exactly like a synchronous throw of a
    // non-Boom error: on a route handler the catch-all answers 500, and on a
    // pre-handler or server method hapi boomifies it to 500 through Layer 3.
    // It is handled with the throw cases below rather than separately,
    // because that IS what it is; the row's status field is what records that
    // the factory name in the source is not the status served.
    if (prop.downstreamCatch) {
      const inherited = inheritFrom(prop.downstreamCatch);
      edge.funnel = inherited ? inherited.funnel || FUNNEL.NONE : FUNNEL.L2;
      edge.inheritedFrom = prop.catchLine;
      return;
    }
    if (edge.returnedBoom) {
      edge.funnel = prop.kind === 'promise-chain' && !prop.chainReturned ? FUNNEL.NONE : FUNNEL.L3;
      return;
    }
    if (pre || edge.surface === SURFACE.SERVER_METHOD) {
      // A server method is reached through routeParser's string-form
      // dispatcher, which returns `serverMethod.apply(null, args)` from an
      // `async (request, h)` wrapper. A throw inside it therefore rejects
      // that wrapper, exactly as a pre-handler's own throw does, and hapi's
      // lifecycle answers - never the handler catch-all, which runs only for
      // the handler.
      edge.funnel = prop.kind === 'cps-callback' ? FUNNEL.NONE : FUNNEL.L3;
      return;
    }
    if (prop.kind === 'cps-callback') {
      edge.funnel = FUNNEL.NONE;
      return;
    }
    if (prop.kind === 'promise-chain' && !prop.chainReturned) {
      edge.funnel = FUNNEL.NONE;
      return;
    }
    if (edge.surface === SURFACE.INTERNAL) {
      edge.funnel = inheritedSurfaceFunnel(edge, pre);
      return;
    }
    edge.funnel = FUNNEL.L1;
  });

  // Inherited funnels can chain, so settle them once more in line order now
  // that every handler row carries a funnel.
  edges.forEach(function (edge) {
    if (edge.disposition === DISPOSITION.BOOM && edge.propagation && edge.propagation.downstreamCatch) {
      const inherited = inheritFrom(edge.propagation.downstreamCatch);
      if (inherited && inherited.funnel) {
        edge.funnel = inherited.funnel;
      }
    }
  });

  return edges;
}

// ---------------------------------------------------------------------------
// Target text
//
// Every target states the outcome to PRESERVE. None proposes a fix: R-d
// prohibits improvements, and a row that recommended repairing a swallowed
// error or settling an unsettled request would send an implementing agent in
// the wrong direction. Where the baseline outcome is a defect, the target says
// so and requires it.
// ---------------------------------------------------------------------------

const RETURN_DISCIPLINE_SHIM =
  'Under the shim the call\'s return value is discarded and the deferred ' +
  'promise carries the response, so the converted body must RETURN this ' +
  'value exactly once on this path - a returned-but-unawaited chain and an ' +
  'awaited-but-unreturned one both pass a signature count and both break ' +
  'this edge.';

const RETURN_DISCIPLINE_NATIVE =
  'The emulation is gone from this tree, so the returned value IS the ' +
  'response: this path must return it exactly once, because a path that ' +
  'returns nothing is converted by hapi into ' +
  'Boom.badImplementation - a 500 in place of whatever this edge answers - ' +
  'and a returned-but-unawaited chain answers with a pending promise ' +
  'instead of its value.';

/**
 * The return-discipline sentence for the analysed tree.
 *
 * Two trees, two mechanisms, and the sentence is decisive in both - so it is
 * selected from what the tree actually contains rather than asserted.
 */
function returnDiscipline(shimPresent) {
  return shimPresent ? RETURN_DISCIPLINE_SHIM : RETURN_DISCIPLINE_NATIVE;
}

function statusPhrase(kind) {
  if (!kind || kind.kind !== 'boom') {
    return null;
  }
  return kind.status ? String(kind.status) : 'the status of Boom.' + kind.factory + '()';
}

// ---------------------------------------------------------------------------
// Side effects and timing
//
// R-e's deliverable is one row per changed error edge carrying the target
// status, payload or redirect, its SIDE EFFECTS and its TIMING. The first
// group is what the disposition prose states. The last two are the fields a
// mechanical conversion drops silently - a swallowed error that starts being
// reported, a fire-and-forget deletion that starts being awaited, a response
// that starts settling earlier than the callback that used to produce it - so
// they are stated explicitly on EVERY row rather than only where the prose
// happens to mention them. A row without them is not checkable.
//
// Neither clause is boilerplate. The effects clause names the writes this
// edge actually performs, read from the edge's own logging calls, settling
// calls and surface; the timing clause names the point at which it settles,
// taken from the propagation walk that already decided its funnel.
// ---------------------------------------------------------------------------

/** The edge's logging calls as an inline list, or null when it makes none. */
function logList(edge) {
  const calls = edge.loggingCalls || [];
  if (!calls.length) {
    return null;
  }
  return calls.map(function (call) {
    return '`' + call + '`';
  }).join(', ');
}

/** The settling calls the edge produces, as an inline list, or null. */
function producedList(edge) {
  const produced = edge.producedResponses || [];
  if (!produced.length) {
    return null;
  }
  return produced.map(function (call) {
    return '`' + call + '`';
  }).join(', ');
}

/**
 * What this edge writes, beyond the response itself. Stated so a conversion
 * that adds a write - or drops one - is visible in a diff of this document.
 */
function sideEffectsText(edge) {
  const logs = logList(edge);
  const pre = edge.surface === SURFACE.PRE || edge.surface === SURFACE.INLINE_PRE;

  if (edge.disposition === DISPOSITION.FAIL_LOCAL) {
    return 'request.fail logs its argument at info level when one is present; on ' +
      'the `html` + `fail.redirect` branch it writes the `failure` flash (only ' +
      'when a payload was passed), mutates `fail.redirect` IN PLACE on the ' +
      'object captured at parse time, and writes the `payload` and `query` ' +
      'flashes; on the other two branches it calls `request.yar.flash()` with ' +
      'no arguments, which READS AND CLEARS the accumulated flash into the ' +
      'response body. Preserve exactly those writes - no more, and none ' +
      'dropped. The in-place mutation is the cross-request leak catalogued in ' +
      SIBLING_DOCS.quirks + ' section 3 and is required, not repaired.';
  }

  if (edge.disposition === DISPOSITION.REPLY_ERR) {
    if (pre) {
      return 'on the resolving path the pre-handler\'s assigned value becomes ' +
        'the value passed here, so `request.pre.<assign>` holds it for every ' +
        'later stage that reads it; on the rejecting path nothing is assigned. ' +
        'No session or database write happens at this edge.';
    }
    return 'the shim resolves its deferred promise with this value, which is ' +
      'the mechanism the conversion removes and the only effect this edge has ' +
      'beyond the response. No flash, session or database write happens here' +
      (logs ? ', and the ' + logs + ' log call is unchanged' : '') + '.';
  }

  if (edge.disposition === DISPOSITION.LOG_CONTINUE) {
    return 'the ' + (logs || 'log') + ' call and nothing else - no flash, no ' +
      'session write, no response, no rethrow. A conversion that adds any of ' +
      'those changes this edge.';
  }

  if (edge.disposition === DISPOSITION.SWALLOW) {
    return logs
      ? 'the ' + logs + ' call only. The error itself is discarded, so no ' +
        'response, rethrow, flash or session write follows it.'
      : 'none at all - no log, no response, no rethrow, no flash. The error ' +
        'value is discarded where it is received, and R-d requires that it ' +
        'keep being discarded.';
  }

  if (edge.disposition === DISPOSITION.LATE_RESOLVE) {
    const produced = producedList(edge);
    return 'whatever the callback body performs before it settles, plus the ' +
      'effects of the settling call' + (produced ? 's ' + produced : '') +
      ' itself - for `request.fail` that includes its flash writes. The ' +
      'deferred promise is resolved at that point and not before.';
  }

  if (edge.disposition === DISPOSITION.PROPAGATE) {
    const via = edge.propagatesVia || {};
    return 'none here beyond the handing on itself' +
      ((edge.loggingCalls || []).length ? ' and ' + logList(edge) : '') +
      ': no response is built and nothing is written on this line. The effects ' +
      'belong to whatever receives the error through ' +
      (via.callee ? '`' + via.callee + '`' : 'the continuation') +
      ', and its own row states them where it is in this file.';
  }

  // DISPOSITION.BOOM
  const kind = edge.thrownKind || { kind: 'value' };
  const prop = edge.propagation || {};
  if (kind.kind === 'type-error') {
    return 'none from this line, and that is part of the contract: it throws ' +
      'before a response is built, so every statement that follows it in the ' +
      'same branch does not run. ' +
      (edge.funnel === FUNNEL.L1
        ? 'Layer 1 then logs `err.stack` at error level. Preserve both the ' +
          'absence and the log.'
        : edge.funnel === FUNNEL.NONE
          ? 'Nothing logs it either - the throw reaches no funnel. Preserve ' +
            'both absences.'
          : 'The funnel that answers it writes nothing of its own. Preserve ' +
            'the absence.');
  }
  if (edge.returnedBoom) {
    return 'none beyond the response itself - the value is returned, not ' +
      'thrown, so nothing is logged and nothing is written.';
  }
  if (prop.downstreamCatch) {
    return 'none here; the writes belong to the `.catch(...)` handler at line ' +
      prop.catchLine + ', whose own row states them.';
  }
  if (pre) {
    return 'none beyond the rejection: the pre-handler assigns nothing when it ' +
      'rejects, so no `request.pre` value is written on this path.';
  }
  if (prop.kind === 'cps-callback') {
    return 'none, and nothing is logged either: the throw escapes the callback ' +
      'as an uncaught exception rather than reaching a funnel that would log it.';
  }
  if (prop.kind === 'promise-chain' && !prop.chainReturned) {
    return 'none - the rejection is unhandled, so nothing logs it and nothing ' +
      'is written in response to it.';
  }
  if (edge.funnel === FUNNEL.L1) {
    return 'Layer 1 logs `err.stack` at error level, or `String(err)` when there ' +
      'is no stack. Nothing else is written.';
  }
  if (edge.funnel === FUNNEL.L3) {
    return 'none beyond the response: hapi answers from the value without ' +
      'logging it here, and Layer 3 post-processes the result.';
  }
  // Funnel `none`: nothing answers this edge, so nothing logs it either. The
  // Layer 1 wording was the unconditional default and asserted a log that
  // does not happen whenever the edge reaches no funnel at all.
  return 'none, and nothing is logged either: this edge reaches no funnel, so ' +
    'no funnel writes anything in response to it.';
}

/**
 * When this edge settles, relative to the handler body. This is the field a
 * mechanical conversion is most likely to change without changing a single
 * status code, because moving an `await` moves the settlement.
 */
function timingText(edge) {
  const prop = edge.propagation || {};
  const chain = edge.chain || null;

  // A `.catch(...)` link is registered on the handler's own stack and RUN
  // later, so its timing is the chain's, never the registration's. Saying
  // "synchronous" here - which the propagation walk would, because the link
  // itself sits in the handler body - would be exactly backwards on the one
  // field a conversion is most likely to break.
  if (edge.mechanism === '.catch()') {
    return 'deferred. The handler is registered synchronously while the chain ' +
      'at line ' + ((chain && chain.line) || edge.line) + ' is built, and runs ' +
      'only when that chain rejects - a microtask at the earliest, and after ' +
      'the handler body has already returned. ' +
      (chain && chain.awaited
        ? 'The chain is returned or awaited, so the enclosing function waits ' +
          'for the rejection and must keep waiting for it.'
        : (chain && chain.boundTo
          ? 'The chain is assigned to `' + chain.boundTo + '` at that ' +
            'statement rather than returned, so whether anything waits for ' +
            'the rejection is decided where `' + chain.boundTo + '` is ' +
            'consumed - preserve that consumption point, and do not move the ' +
            'settlement to this one.'
          : 'The chain is NEITHER returned, awaited nor assigned at that ' +
            'statement, so nothing waits for the rejection today: the request ' +
            'settles on whichever path settles it first, and adding an await ' +
            'here would change that.'));
  }

  if (edge.mechanism === '.on(\'error\')' || edge.listener) {
    return 'when the stream emits `' + (edge.listener || 'error') + '`, which is ' +
      'not awaited by anything: for a refused connection it fires INSTEAD of ' +
      '`end`, and for a mid-stream failure it fires after `response`. The ' +
      'handler body has already returned by then, so the settlement time of ' +
      'the request is decided by whichever listener runs - or, when none does, ' +
      'not at all. Preserve that, including the case where nothing settles.';
  }

  if (edge.disposition === DISPOSITION.LATE_RESOLVE) {
    return 'deferred. The response is built only when `' +
      (edge.callee || 'the surrounding call') + '` invokes its callback, so the ' +
      'request settles then and not when the handler body returns. Rule T-3 ' +
      'puts the `await` boundary at this call site; moving the settlement ' +
      'earlier changes which settle wins.';
  }

  if (prop.kind === 'promise-chain') {
    return 'asynchronous, in the chain step at line ' + (prop.chainLine || edge.line) +
      ', so it settles a microtask after the handler body has run' +
      (prop.chainReturned
        ? '. The chain is returned or awaited, so the handler waits for it and must keep waiting.'
        : '. The chain is NEITHER returned nor awaited, so nothing waits for it today and nothing may start waiting for it.');
  }

  if (prop.kind === 'cps-callback') {
    return 'inside the callback `' + (prop.callee || 'library code') +
      '` invokes, off the handler\'s own stack, so it runs after the handler ' +
      'body has already returned.';
  }

  if (prop.kind === 'module-scope') {
    return 'at module load, before any request exists.';
  }

  return 'synchronous, on the handler body\'s own stack, before it returns' +
    (prop.viaIteratee
      ? ', reached through a synchronous iteratee which is why it stays on that stack'
      : '') + '.';
}

/** The two fields R-e requires on every row, appended to every target. */
function effectsAndTiming(edge) {
  return ' Side effects: ' + sideEffectsText(edge) +
    ' Timing: ' + timingText(edge);
}

/** The composed target: the disposition prose, then side effects and timing. */
function targetText(edge, funnels) {
  const text = targetCore(edge, funnels) + effectsAndTiming(edge);
  assertRowCoherence(edge, text);
  return text;
}

/**
 * The funnel field as a row renders it, including a value-dependent
 * alternative where the site has one. `edge.funnel` itself stays single-valued
 * because the closure comparison keys on it.
 *
 * @param {Object} edge the edge being rendered
 * @returns {string} the funnel, with its alternative where there is one
 */
function funnelField(edge) {
  const own = edge.funnel === FUNNEL.NONE ? 'none' : edge.funnel;
  return edge.funnelAlternate
    ? own + ' (or ' + edge.funnelAlternate + ', depending on the runtime value)'
    : own;
}

/**
 * Every funnel this text PRESCRIBES, as a set.
 *
 * A prescription is the token `Layer 1`, `Layer 2` or `Layer 3` naming what
 * answers this edge. Contrastive references are deliberately worded without
 * the token - "the handler catch-all", "the onPreResponse extension" - so
 * that a `Layer N` token appearing in a row's target text always means "this
 * is what answers here", and a token that disagrees with the row's own Funnel
 * field is therefore always a contradiction rather than a turn of phrase.
 *
 * @param {string} text the rendered Target and side-effect prose
 * @returns {string[]} the funnels the text names, sorted
 */
function funnelsNamedIn(text) {
  const named = new Set();
  const token = /\bLayer\s+([123])\b/g;
  let m;
  while ((m = token.exec(text)) !== null) {
    named.add('Layer ' + m[1]);
  }
  return Array.from(named).sort();
}

/**
 * A row must not say two different things about the same edge.
 *
 * This is an INDEPENDENT check: the Funnel field comes from resolveFunnels
 * and the prose comes from targetCore, and the two are written in different
 * places against different branch conditions. Nothing but a check like this
 * one stops them drifting, and they did drift - a clause added to
 * resolveFunnels answering a returned error value through Layer 3 had no
 * counterpart in targetCore, whose tail then prescribed Layer 1 for all 49 of
 * those rows. The document said `Layer 3` in the Funnel field of a row whose
 * Target said "Layer 1. The handler catch-all logs...", and a reader had no
 * way to tell which was true.
 *
 * Three further contradictions of the same shape were found by writing it:
 * `request.fail` on a pre-handler surface, which enters no funnel at all but
 * was prescribed Layer 2; a throw inside a callback a pre-handler passed to
 * library code, which nothing catches but was prescribed Layer 3; and a
 * `reply(err)` on a pre-handler in a tree with no shim, where the funnel
 * resolution itself was shim-blind.
 *
 * Fatal rather than reported: a document that contradicts itself is not a
 * partial deliverable, and the R-e checklist's whole use is that a reader can
 * act on a row without re-deriving it.
 *
 * @param {Object} edge the edge being rendered
 * @param {string} text its rendered Target and side-effect prose
 */
function assertRowCoherence(edge, text) {
  const named = funnelsNamedIn(text);
  const own = edge.funnel;
  const alternate = edge.funnelAlternate || null;
  const contradicting = named.filter(function (funnel) {
    return funnel !== own && funnel !== alternate;
  });
  if (contradicting.length) {
    throw new AnalysisError(
      'row ' + edge.id + ' (' + lineRef(edge) + ') contradicts itself: its ' +
      'Funnel field is ' + (own === FUNNEL.NONE ? 'none' : own) +
      (alternate ? ' (alternate ' + alternate + ')' : '') +
      ' and its target text prescribes ' + contradicting.join(' and ') +
      '. One edge cannot reach two funnels, so one of the two is false and ' +
      'the row is unusable either way. Fix the branch in targetCore or in ' +
      'resolveFunnels that disagrees - do not reword the text to hide it.'
    );
  }
  if (own !== FUNNEL.NONE && named.length === 0 &&
      edge.disposition === DISPOSITION.BOOM) {
    throw new AnalysisError(
      'row ' + edge.id + ' (' + lineRef(edge) + ') reaches ' + own +
      ' but its target text names no funnel at all, so the row states a ' +
      'funnel it never explains. Add the prescription to targetCore.'
    );
  }
}

/**
 * The outcome an edge must still produce, computed for the ANALYSED TREE.
 *
 * `funnels.shimPresent` selects between two genuinely different contracts,
 * and on the pre-handler surface they disagree about the outcome rather than
 * only about the mechanism. Measured against installed @hapi/hapi 21.4.10:
 *
 *   shim      reply(err) with a non-Boom Error RESOLVES the pre-handler with
 *             the Error as its assigned value. The request continues,
 *             `request.pre.<assign>` holds an Error, no error response is
 *             produced, funnel `none`.
 *   native    returning any Error goes through `Response.wrap`, which calls
 *             `Boom.boomify` on it (lib/response.js:81-83); `isBoom` then
 *             routes it to `failAction(request, pre.failAction)`, whose
 *             default `'error'` THROWS (lib/handler.js:59-63). So the request
 *             is answered - the Boom's own status for a Boom, 500 for a plain
 *             Error - and the funnel is Layer 3.
 *
 * Describing one while reporting the other is the failure this parameter
 * removes.
 */
function targetCore(edge, funnels) {
  const shimPresent = !funnels || funnels.shimPresent !== false;
  const RETURN_DISCIPLINE = returnDiscipline(shimPresent);
  const pre = edge.surface === SURFACE.PRE || edge.surface === SURFACE.INLINE_PRE;
  const prop = edge.propagation || {};

  if (edge.disposition === DISPOSITION.PROPAGATE) {
    const via = edge.propagatesVia || {};
    return 'The error is handed to an outer continuation - ' +
      (via.vehicle || 'the enclosing continuation') +
      (via.line ? ', at line ' + via.line : '') + ' - so this edge produces no ' +
      'response of its own and the response comes from whatever awaits that ' +
      'continuation. Funnel: ' + edge.funnel + ', reached through the ' +
      'awaiting caller rather than from here. Preserve the HANDING ON as much ' +
      'as the eventual response: a conversion that answers here instead ' +
      'produces a response one frame earlier than baseline and skips whatever ' +
      'the caller does with the error, and one that drops the propagation ' +
      'turns an error the caller acts on into one it never sees.';
  }

  if (edge.thrownKind && edge.thrownKind.kind === 'unbound-reference') {
    const k = edge.thrownKind;
    const shadowed = k.shadowedArgumentKind || null;
    const cause = k.viaCallee
      ? 'This file does not bind `' + k.holder + '` at this offset, and a ' +
        'call expression resolves its CALLEE before it evaluates any ' +
        'argument, so the reference throws before the argument runs' +
        (shadowed && shadowed.kind === 'unbound-reference'
          ? ' - including before `' + shadowed.holder + '.' + shadowed.factory +
            '(...)`, whose own unbound holder is therefore never reached and ' +
            'never observable'
          : '') +
        '. Preserve the identifier in the message: it is what Layer 1 writes ' +
        'to the error log, and naming the argument instead would record a log ' +
        'line this tree does not produce.'
      : 'This file does not bind `' + k.holder + '` at this offset - it ' +
        'imports @hapi/boom under another name - so evaluating `' + k.holder +
        '.' + k.factory + '(...)` throws before any value exists and no Boom ' +
        'is ever constructed.';
    return 'A synchronous `ReferenceError: ' + k.holder + ' is not defined`. ' +
      cause + ' ' +
      'The status the line READS as' +
      (k.nominalStatus ? ' - ' + k.nominalStatus + ' - ' : ' ') +
      'is therefore not the status served: ' +
      (edge.funnel === FUNNEL.L1
        ? 'the handler catch-all logs err.stack at error level and returns ' +
          'Boom.badImplementation(err.message), so the client is answered ' +
          '**500** with Boom\'s generic 5xx body.'
        : edge.funnel === FUNNEL.L3
          ? 'hapi boomifies the ReferenceError and answers **500** through ' +
            'Layer 3.'
          : 'the ReferenceError escapes without producing a response at all.') +
      ' Preserve the 500 and the log. R-d requires this: it is a defect, it is ' +
      'baseline behaviour, and repairing the binding would change an ' +
      'observable status.';
  }

  if (edge.disposition === DISPOSITION.FAIL_LOCAL) {
    if (edge.funnel === FUNNEL.NONE) {
      // request.fail is installed by the handler wrapper, which runs after
      // pre-handlers, so on this surface the call is a TypeError and no
      // funnel is entered. Saying "Layer 2" here contradicted the row's own
      // Funnel field.
      return 'No funnel is entered. `request.fail` is installed on the ' +
        'request by the handler wrapper, which runs AFTER pre-handlers, so on ' +
        'this surface the property is undefined and the call is a synchronous ' +
        'TypeError rather than an entry into the failure funnel. Preserve ' +
        'whatever the baseline capture shows this produces, and do not make ' +
        'the call succeed: turning a TypeError into a real failure response ' +
        'would give this edge a response it does not have.';
    }
    let text =
      'Layer 2. request.fail logs its argument at info level, then selects one ' +
      'of three responses: with a negotiated `html` type and a configured ' +
      '`fail.redirect` it flashes `failure`, interpolates `fail.redirect` IN ' +
      'PLACE on the parse-time route object - the cross-request leak - flashes ' +
      '`payload` and `query`, and redirects; with `html`, a configured ' +
      '`fail.html` and no `.json` extension on the path it renders that view ' +
      'through addUserContext; otherwise it returns h.response(json) with ' +
      '`json.flash` attached. Preserve the branch selection, both flash ' +
      'writes, the status and the body. The response is not a Boom, so the ' +
      'onPreResponse extension takes its `else if (response.header)` branch ' +
      'and applies Cache-Control, Pragma and Expires. ' + RETURN_DISCIPLINE;
    if (edge.bareReference) {
      text +=
        ' The reference is bare, so the rejection value arrives as ' +
        'request.fail\'s FIRST parameter - the `json` payload, not `err` - and ' +
        'is what gets logged and flashed. Preserve that: the flash content is ' +
        'the rejection value itself, not a message derived from it.';
    }
    if (edge.returned === false) {
      text +=
        ' This call site has no `return`, which is immaterial under the shim ' +
        'and decisive after conversion.';
    }
    return text;
  }

  if (edge.disposition === DISPOSITION.REPLY_ERR) {
    const kind = edge.valueKind || { kind: 'error-identifier' };
    if (pre) {
      if (kind.kind === 'boom') {
        return (shimPresent
          ? 'The pre-handler shim\'s fakeReply rejects on an isBoom value, so '
          : 'A pre-handler that returns a Boom has it wrapped by hapi\'s ' +
            'Response.wrap and routed through the default pre failAction, ' +
            'which throws it, so ') +
          'this Boom keeps its own status - ' + statusPhrase(kind) + ' - and reaches ' +
          'Layer 3 through hapi\'s own lifecycle error handling. It does NOT become ' +
          'a 500: only the handler catch-all does that, and pre-handlers never ' +
          'reach it. Preserve the status and the Boom payload shape.';
      }
      if (shimPresent) {
        return 'The pre-handler shim\'s fakeReply resolves on anything that is not ' +
          'isBoom, so an ordinary Error is RESOLVED as this pre-handler\'s assigned ' +
          'value: the request continues, `request.pre.<assign>` holds the error ' +
          'object, and no error response is produced. Funnel: none. When the value ' +
          'happens to be a Boom the same site rejects instead and the Boom\'s own ' +
          'status reaches Layer 3. Preserve BOTH outcomes and the selection between ' +
          'them - converting this into an unconditional failure response would ' +
          'change every non-Boom case.';
      }
      return 'This tree has no pre-handler emulation, so hapi\'s own contract ' +
        'applies and it does NOT resolve a non-Boom Error the way the shim did: ' +
        '`Response.wrap` calls `Boom.boomify` on any Error, and the default pre ' +
        '`failAction` then throws it. So a Boom keeps its own status and a plain ' +
        'Error becomes **500**, both answered through Layer 3, and the request ' +
        'does NOT continue with the error as `request.pre.<assign>`. This is the ' +
        'sharpest difference between the two contracts on this surface: under the ' +
        'shim the same value produced no response at all. Where baseline resolved ' +
        'and continued, the converted pre-handler must reproduce THAT - return a ' +
        'non-Error value, so the request still continues - rather than returning ' +
        'the Error and letting hapi answer.';
    }
    if (kind.kind === 'boom') {
      return (shimPresent
        ? 'The shim\'s reply() resolves an isBoom value unchanged, so the '
        : 'A returned Boom is the response, so the ') +
        'response is this Boom: ' + statusPhrase(kind) + ' with the Boom payload ' +
        'shape. Layer 3 then post-processes it, and for a browser HTML request at ' +
        '401/403/404/>=500 it takes over BEFORE the header block, so the four ' +
        'cache and frame headers do not reach the rendered error page. Preserve ' +
        'the status and the payload. ' + RETURN_DISCIPLINE;
    }
    return (shimPresent
      ? 'The shim\'s reply() selects on the runtime value and all three '
      : 'The value reaching hapi selects the outcome and all three ') +
      'outcomes are observable: an isBoom value ' +
      (shimPresent ? 'resolves unchanged with' : 'is answered with') + ' its own ' +
      'status; any other Error becomes ' +
      (shimPresent
        ? 'Boom.badImplementation(err.message), so '
        : 'Boom.boomify(err) - and where the handler catch-all takes it, ' +
          'Boom.badImplementation(err.message) - so ') +
      '500 with the 5xx message Boom hides from the client; a value that is ' +
      'neither is wrapped by h.response(value) and served 200 with the value as ' +
      'the body. Preserve the selection itself, not just the common case. ' +
      RETURN_DISCIPLINE;
  }

  if (edge.disposition === DISPOSITION.LOG_CONTINUE) {
    const calls = (edge.loggingCalls || []).map(function (c) {
      return '`' + c + '`';
    }).join(', ');
    if ((edge.producedResponses || []).length) {
      return 'The error is logged' + (calls ? ' via ' + calls : '') + ' and the ' +
        'handler then answers with ' + (edge.producedResponses || []).map(function (c) {
          return '`' + c + '`';
        }).join(', ') + ', so a client sees that response and not a failure. ' +
        'Funnel: none - no error funnel is entered. Preserve the response, the ' +
        'log and the fact that the error does not change what is served.';
    }
    return 'No response is produced here and nothing is thrown: the error is ' +
      'logged' + (calls ? ' via ' + calls : '') + ' and control continues. ' +
      'Funnel: none - and that is the point. Preserve the continuation. ' +
      'Converting a log-and-continue branch into a rejection or a returned Boom ' +
      'turns an edge that produces no response into one that does, changes the ' +
      'status a client sees from whatever else settles the request to a 500, ' +
      'and is exactly the silent conversion R-e is written to catch.';
  }

  if (edge.disposition === DISPOSITION.SWALLOW) {
    if ((edge.producedResponses || []).length) {
      return 'The error is discarded and the handler answers with ' +
        (edge.producedResponses || []).map(function (c) {
          return '`' + c + '`';
        }).join(', ') + ', so the failure is reported to the client as a ' +
        'success. Funnel: none. Preserve the status, the payload and the ' +
        'discarding - R-d prohibits turning this into a failure response, ' +
        'however much it looks like one is owed.';
    }
    return 'The error is absorbed: no response, no rethrow' +
      ((edge.loggingCalls || []).length ? '' : ', no log') +
      '. Funnel: none. Preserve the swallow exactly - R-d prohibits repairing ' +
      'it, and a caller that today proceeds on a failed operation must keep ' +
      'proceeding.';
  }

  if (edge.disposition === DISPOSITION.LATE_RESOLVE) {
    const produced = (edge.producedResponses || []).map(function (c) {
      return '`' + c + '`';
    }).join(', ');
    return 'The response is produced inside the callback passed to `' +
      (edge.callee || 'the surrounding call') + '` (' + produced + '), so it ' +
      'settles only when that operation calls back, and what a client receives ' +
      'today is whichever settlement wins. Preserve the ordering: rule T-3 puts ' +
      'the await boundary at this call site, and the response must still be ' +
      'produced after the callback would have run. Collapsing this into an ' +
      'earlier await changes which settle wins and can change the response ' +
      'itself. Status and payload unchanged.';
  }

  // DISPOSITION.BOOM
  const kind = edge.thrownKind || { kind: 'value' };

  // AN ERROR HANDLER THAT RETURNS ITS ERROR, checked here because
  // resolveFunnels checks it here: a `.catch` handler that RETURNS the error
  // RESOLVES its chain rather than rejecting it, so nothing downstream
  // catches the value and the chain's own later `.catch` never sees it. The
  // clause was added to resolveFunnels and not to this function, and the two
  // then disagreed twice over - the funnel field said Layer 3 while the tail
  // prescribed Layer 1 for 49 rows, and where a later `.catch` existed the
  // text routed the value to a handler that cannot receive it. Both are
  // decided by putting the case in the same place in both functions.
  if (edge.edgeClass === EDGE_CLASS.HANDLER && edge.valueKind &&
      edge.valueKind.kind === 'error-identifier') {
    return 'Layer 3. The handler RETURNS the error value rather than throwing ' +
      'it, so there is no throw for the handler catch-all to take and no ' +
      'rejection for a later `.catch` to receive - returning from a catch ' +
      'handler RESOLVES the chain. hapi wraps the returned value - ' +
      '`Response.wrap` calls `Boom.boomify` on an Error - and answers **500** ' +
      'from it, then post-processes the result. Preserve the RETURN as much as ' +
      'the status: converting this into a throw would route the same 500 ' +
      'through the catch-all instead and add its error-level `err.stack` log, ' +
      'which is a side-effect change even though the status a client sees is ' +
      'identical.';
  }

  if (kind.kind === 'type-error') {
    return 'A synchronous TypeError: `reply` is a bare function and only the ' +
      'object it RETURNS carries `.' + kind.member + '`, so this line throws ' +
      'before any response is built. ' +
      (edge.funnel === FUNNEL.L1
        ? 'Layer 1 catches it, logs err.stack at error level and returns ' +
          'Boom.badImplementation(err.message), so the client is answered 500 ' +
          'with Boom\'s generic 5xx body - not the redirect the line reads as. ' +
          'Preserve the 500 and the log.'
        : 'Preserve the throw and the response the enclosing handler produces ' +
          'from it.') +
      ' R-d requires this: it is a defect and it is baseline behaviour.';
  }
  if (edge.returnedBoom) {
    if (edge.funnel === FUNNEL.NONE) {
      return 'The value is RETURNED, not thrown, but the chain it is returned ' +
        'into is neither returned nor awaited, so nothing receives it: no ' +
        'funnel is entered and this edge produces no response. Preserve that ' +
        '- returning or awaiting the chain would settle a request that today ' +
        'may not settle, and would give the Boom a status it never serves.';
    }
    return 'Layer 3. The value is RETURNED, not thrown, so the wrapper hands ' +
      'it to hapi and the answer carries the Boom\'s own status - ' +
      (statusPhrase(kind) || 'the factory\'s status') + ' - which Layer 3 then ' +
      'post-processes. Note the contrast with `throw` on this same surface, ' +
      'which the handler catch-all converts to 500. Preserve the status and ' +
      'the payload shape.';
  }
  if (prop.downstreamCatch) {
    // The funnel is INHERITED from the catch handler, so the row states which
    // one rather than only pointing at another row. Leaving it unstated meant
    // a row could carry a Funnel field its own text never explained, which is
    // the same defect as carrying one its text contradicts.
    return 'The rejection is taken by the `.catch(...)` at line ' +
      prop.catchLine + ', which answers through ' +
      (edge.funnel === FUNNEL.NONE ? 'no funnel at all' : edge.funnel) +
      ' - see its row for the status and the payload, which are that ' +
      'handler\'s and not this line\'s. Preserve the ROUTING as much as the ' +
      'response: after conversion the chain must still be what catches this, ' +
      'not a try/catch added around the handler body, or the edge silently ' +
      'changes funnel.';
  }
  if (pre || edge.surface === SURFACE.SERVER_METHOD) {
    const invoker = edge.surface === SURFACE.SERVER_METHOD
      ? 'This is a server method, reached through routeParser\'s string-form ' +
        'pre-handler dispatcher, which returns `serverMethod.apply(null, args)` ' +
        'from its own `async (request, h)` wrapper. A throw here rejects that ' +
        'wrapper. '
      : '';
    if (edge.funnel === FUNNEL.NONE) {
      // The throw is inside a callback the pre-handler passed to library
      // code, so it is not on the stack hapi awaits: nothing catches it and
      // no funnel is entered. Prescribing Layer 3 here contradicted the row.
      return invoker + 'The throw happens inside a callback invoked by `' +
        (prop.callee || 'library code') + '`, not on the stack hapi awaits, so ' +
        'neither the pre-handler\'s own rejection path nor the handler ' +
        'catch-all sees it: it escapes as an uncaught exception and this edge ' +
        'produces no response. No funnel is entered. Preserve that - wrapping ' +
        'the callback so that it starts producing one would give this edge a ' +
        'response it does not have.';
    }
    return invoker + (shimPresent
      ? 'The pre-handler shim catches a synchronous throw and rejects with it, so '
      : 'hapi takes the rejection through its own lifecycle error handling, so ') +
      'a thrown Boom keeps its own status - ' +
      (statusPhrase(kind) || 'the thrown value\'s status') + ' - and a non-Boom ' +
      'becomes hapi\'s own 500. Layer 3 post-processes the result. Preserve the ' +
      'status and the payload shape; nothing on this surface reaches the handler ' +
      'catch-all.';
  }
  if (prop.kind === 'cps-callback') {
    return 'The throw happens inside a callback invoked by `' +
      (prop.callee || 'library code') + '`, not on the handler\'s own stack, so ' +
      'the handler catch-all never sees it: it escapes as an uncaught exception ' +
      'and this edge produces no response. Funnel: none. Preserve that - do not ' +
      'wrap the callback so that it starts producing one.';
  }
  if (prop.kind === 'promise-chain' && !prop.chainReturned) {
    return 'The chain at line ' + prop.chainLine + ' is neither returned nor ' +
      'awaited and carries no `.catch`, so the rejection is unhandled: this edge ' +
      'produces no response, and the request settles only if something else ' +
      'resolves the deferred. Funnel: none. Preserve it - adding a catch or ' +
      'returning the chain would settle a request that today may not settle.';
  }
  // THE TAIL IS FUNNEL-DRIVEN, and it has to be. It used to return the Layer 1
  // text unconditionally, which was correct for a throw on a handler's own
  // stack and wrong for everything else that reached here - most visibly for
  // an error handler that RETURNS its error as the response, which
  // resolveFunnels answers through Layer 3. Measured on the analysed tree,
  // that put a Layer 3 Funnel field and a "Layer 1. The handler catch-all
  // logs..." Target on 49 rows of one document. One edge cannot truthfully
  // prescribe both, and a reviewer reading either field alone was being told
  // something the other field denied.
  if (edge.funnel === FUNNEL.L3) {
    return 'Layer 3. hapi answers from the value this edge produces rather ' +
      'than from the handler catch-all - there is no throw on the handler\'s ' +
      'own stack for the catch-all to take - and post-processes the result' +
      (statusPhrase(kind) ? ', carrying ' + statusPhrase(kind) : ', carrying 500') +
      '. Preserve the status, the payload shape and the absence of the ' +
      'catch-all\'s error-level log.';
  }
  if (edge.funnel === FUNNEL.NONE) {
    return 'No funnel is entered: this edge produces no response, and the ' +
      'request settles only if something else settles it. Preserve that. ' +
      'Giving the edge a response - by returning a Boom, by throwing where ' +
      'the throw would now be caught, or by adding a catch - converts an edge ' +
      'that answers nothing into one that answers 500, which is the silent ' +
      'conversion R-e exists to catch.';
  }
  if (edge.funnel === FUNNEL.L2) {
    return 'Layer 2. The response is request.fail\'s, so its branch ' +
      'selection, its flash writes, its status and its body are what must be ' +
      'preserved here; the handler catch-all is not reached.';
  }
  return 'Layer 1. The handler catch-all logs err.stack at error level and ' +
    'returns Boom.badImplementation(err.message || String(err)), so the answer ' +
    'is 500 and Boom hides the 5xx message' +
    (statusPhrase(kind) ? ' - the thrown value\'s own status, ' + statusPhrase(kind) +
      ', is NOT preserved by the funnel and must not start being preserved' : '') +
    '. After conversion this becomes structural: a rejecting async handler ' +
    'lands in the same catch. Preserve the 500, the generic body and the ' +
    'error-level log.';
}

// ---------------------------------------------------------------------------
// Locating the funnels in the analysed tree
//
// Line numbers are read from the tree being analysed, never hardcoded: the
// baseline carries the catch-all at 578-589 and a converted tree carries it
// somewhere else entirely, and a document that stated the baseline's numbers
// while describing a converted tree would be worse than one that stated none.
// A funnel that cannot be located is a hard failure - the document's opening
// section is not optional.
// ---------------------------------------------------------------------------

function locateFunnels(appRoot) {
  const parserPath = 'lib/util/routeParser.js';
  const appPath = 'app.js';
  const configPath = 'config/default.yaml';

  const parserAbs = path.join(appRoot, parserPath);
  const appAbs = path.join(appRoot, appPath);
  if (!fs.existsSync(parserAbs) || !fs.existsSync(appAbs)) {
    throw new AnalysisError(
      'cannot locate the shared error funnels: ' + parserPath + ' and ' +
      appPath + ' must both exist under --app (' + appRoot + ')'
    );
  }

  const parserSrc = fs.readFileSync(parserAbs, 'utf8');
  const parser = classifySource(parserSrc, parserPath);
  const parserLines = buildLineIndex(parserSrc);
  const parserFns = findFunctions(parser.codeOnly);

  // Layer 1 - the catch block that returns Boom.badImplementation.
  let layer1 = null;
  const catchKeyword = /\bcatch\s*\(/g;
  let m;
  while ((m = catchKeyword.exec(parser.codeOnly)) !== null) {
    const paren = parser.codeOnly.indexOf('(', m.index);
    const parenEnd = matchDelimiter(parser.codeOnly, paren);
    if (parenEnd === -1) {
      continue;
    }
    const brace = skipSpaceForward(parser.codeOnly, parenEnd + 1);
    if (parser.codeOnly[brace] !== '{') {
      continue;
    }
    const blockEnd = matchDelimiter(parser.codeOnly, brace);
    if (blockEnd === -1) {
      continue;
    }
    const block = parser.codeOnly.slice(brace, blockEnd);
    if (block.indexOf('Boom.badImplementation') === -1) {
      continue;
    }
    layer1 = {
      file: parserPath,
      startLine: lineFromIndex(parserLines, m.index),
      endLine: lineFromIndex(parserLines, blockEnd),
      guardLine: block.indexOf('if') !== -1
        ? lineFromIndex(parserLines, brace + block.indexOf('if'))
        : null,
      badImplementationLine: lineFromIndex(parserLines, brace + block.indexOf('Boom.badImplementation')),
      hasIsBoomTest: /\bisBoom\b/.test(block)
    };
    break;
  }

  // Layer 2 - request.fail.
  let layer2 = null;
  const failAssign = /\brequest\.fail\s*=\s*(?:async\s+)?function/g;
  m = failAssign.exec(parser.codeOnly);
  if (m) {
    const fn = parserFns.find(function (candidate) {
      return candidate.keywordAt >= m.index && candidate.keywordAt <= m.index + m[0].length;
    });
    if (fn) {
      const body = parser.codeOnly.slice(fn.bodyStart, fn.bodyEnd);
      // 'failure' is a string literal, so it survives only in the raw source.
      const rawBody = parserSrc.slice(fn.bodyStart, fn.bodyEnd);
      const flashAt = rawBody.indexOf('\'failure\'');
      layer2 = {
        file: parserPath,
        startLine: lineFromIndex(parserLines, m.index),
        endLine: lineFromIndex(parserLines, fn.bodyEnd),
        interpolateLine: body.indexOf('StringUtils.interpolate') !== -1
          ? lineFromIndex(parserLines, fn.bodyStart + body.indexOf('StringUtils.interpolate'))
          : null,
        flashFailureLine: flashAt !== -1 ? lineFromIndex(parserLines, fn.bodyStart + flashAt) : null
      };
    }
  }

  // Layer 3 - the onPreResponse extension that classifies API requests.
  const appSrc = fs.readFileSync(appAbs, 'utf8');
  const appClassified = classifySource(appSrc, appPath);
  const appLines = buildLineIndex(appSrc);
  let layer3 = null;
  const ext = /\bserver\.ext\s*\(/g;
  while ((m = ext.exec(appClassified.codeOnly)) !== null) {
    const paren = appClassified.codeOnly.indexOf('(', m.index);
    const parenEnd = matchDelimiter(appClassified.codeOnly, paren);
    if (parenEnd === -1) {
      continue;
    }
    const span = appClassified.codeOnly.slice(paren, parenEnd);
    if (span.indexOf('isApiRequest') === -1) {
      continue;
    }
    // Header names are string literals, so they are read from the raw source.
    const rawSpan = appSrc.slice(paren, parenEnd);
    const cacheFirst = rawSpan.indexOf('Cache-Control');
    const cacheSecond = rawSpan.indexOf('Cache-Control', cacheFirst + 1);
    const xframeFirst = rawSpan.indexOf('X-Frame-Options');
    layer3 = {
      file: appPath,
      startLine: lineFromIndex(appLines, m.index),
      endLine: lineFromIndex(appLines, parenEnd),
      apiTestLine: lineFromIndex(appLines, paren + span.indexOf('isApiRequest =')),
      redirect401Line: span.indexOf('takeover') !== -1
        ? lineFromIndex(appLines, paren + span.indexOf('takeover'))
        : null,
      boomHeaderLine: cacheFirst !== -1 ? lineFromIndex(appLines, paren + cacheFirst) : null,
      nonBoomHeaderLine: cacheSecond !== -1 ? lineFromIndex(appLines, paren + cacheSecond) : null,
      xframeLine: xframeFirst !== -1 ? lineFromIndex(appLines, paren + xframeFirst) : null
    };
    break;
  }

  // The pre-handler shim: not one of the three funnels, and decisive for
  // every row on the pre-handler surface.
  let preShim = null;
  const convert = /\bfunction\s+convertPreHandlers\s*\(/g;
  m = convert.exec(parser.codeOnly);
  if (m) {
    const fn = parserFns.find(function (candidate) {
      return candidate.keywordAt === m.index;
    });
    if (fn) {
      const body = parser.codeOnly.slice(fn.bodyStart, fn.bodyEnd);
      const fakeReplyLines = allOccurrenceLines(parser.codeOnly, parserLines, 'fakeReply = function', fn.bodyStart, fn.bodyEnd);
      preShim = {
        file: parserPath,
        startLine: lineFromIndex(parserLines, fn.keywordAt),
        endLine: lineFromIndex(parserLines, fn.bodyEnd),
        fakeReplyLines: fakeReplyLines,
        rejectsOnBoom: /isBoom\s*\)\s*\{\s*reject/.test(body.replace(/\s+/g, ' ')) || body.indexOf('reject(value)') !== -1,
        // Whether the RESPONSE EMULATION is present, which is what decides
        // the semantics every pre-handler row describes - not whether the
        // function exists.
        //
        // `convertPreHandlers` survives the migration: rule T-2 reshapes it
        // into a pass-through for native lifecycle methods and keeps the
        // string-form dispatcher. So detecting the function by name reported
        // the shim as present in the converted tree too, and every
        // pre-handler row then narrated `fakeReply` semantics that the tree
        // no longer has - a stale target model on the one surface where the
        // shim and the native lifecycle disagree about the OUTCOME rather
        // than only about the mechanism.
        emulationPresent: fakeReplyLines.length > 0 ||
          body.indexOf('_isRedirect') !== -1 ||
          body.indexOf('_takeover') !== -1
      };
    }
  }

  // The handler wrapper's response emulation: the deferred promise whose
  // value is substituted when a handler returns undefined. Its presence
  // decides whether a `reply(...)` site's return value is discarded (shim) or
  // is the response (native), which is the return-discipline sentence every
  // response row carries.
  const wrapperEmulation = /result\s*===\s*undefined/.test(parser.codeOnly) &&
    /await\s+responsePromise|responsePromise/.test(parser.codeOnly);

  // The five paths X-Frame-Options is limited to.
  let xframePaths = null;
  const configAbs = path.join(appRoot, configPath);
  if (fs.existsSync(configAbs)) {
    const configSrc = fs.readFileSync(configAbs, 'utf8');
    const configLines = configSrc.split('\n');
    for (let i = 0; i < configLines.length; i++) {
      if (/^\s*xframeDeny\s*:/.test(configLines[i])) {
        const entries = [];
        for (let j = i + 1; j < configLines.length; j++) {
          const entry = configLines[j].match(/^\s*-\s*'?([^'\s#]+)'?/);
          if (!entry) {
            break;
          }
          entries.push(entry[1]);
        }
        // startLine is the `xframeDeny:` key; endLine is its last list entry.
        xframePaths = {
          file: configPath,
          startLine: i + 1,
          endLine: i + 1 + entries.length,
          entries: entries
        };
        break;
      }
    }
  }

  const missing = [];
  if (!layer1) {
    missing.push('Layer 1 (the handler catch-all returning Boom.badImplementation in ' + parserPath + ')');
  }
  if (!layer2) {
    missing.push('Layer 2 (request.fail in ' + parserPath + ')');
  }
  if (!layer3) {
    missing.push('Layer 3 (the onPreResponse extension computing isApiRequest in ' + appPath + ')');
  }
  if (missing.length) {
    throw new AnalysisError(
      'could not locate ' + missing.join('; ') + '. The inventory opens with ' +
      'the funnels every row refers to, so this is fatal rather than a ' +
      'degraded section.'
    );
  }

  return {
    layer1: layer1,
    layer2: layer2,
    layer3: layer3,
    preShim: preShim,
    xframePaths: xframePaths,
    wrapperEmulation: wrapperEmulation,
    // One flag every prose branch consults, so the document cannot describe
    // one tree's mechanism while reporting another tree's rows.
    shimPresent: wrapperEmulation || Boolean(preShim && preShim.emulationPresent)
  };
}

function allOccurrenceLines(codeOnly, lineIndex, token, from, to) {
  const lines = [];
  let at = codeOnly.indexOf(token, from);
  while (at !== -1 && at < to) {
    lines.push(lineFromIndex(lineIndex, at));
    at = codeOnly.indexOf(token, at + 1);
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

function git(args) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000
    }).trim();
  } catch (err) {
    return '';
  }
}

/**
 * Provenance for an analysed tree, carrying a SYMBOLIC label alongside the
 * physical path.
 *
 * The label is what the committed document prints. It identifies the tree by
 * what it is - the repository the generator lives in, or a worktree at the
 * R-f baseline commit - rather than by where it happened to be checked out,
 * so the same two commits analysed on any machine produce the same label.
 */
function treeProvenance(dir, toolRoot) {
  const head = git(['-C', dir, 'rev-parse', 'HEAD']);
  // Dirtiness is scoped to the files this analysis READS, not to the whole
  // checkout.
  //
  // A whole-tree `git status --porcelain` is dirty whenever anything at all
  // is uncommitted - including this document itself, which is uncommitted at
  // the moment it is generated, every single time. The committed artifact
  // therefore carried "working tree has uncommitted changes" against its own
  // analysed tree, which reads as "the sources these rows describe were
  // modified and unrecorded" and is the opposite of the truth: the sources
  // were committed and only the output was not. Scoping the check to the
  // analysed sources makes the annotation mean what it says, and it fires
  // when it should - an uncommitted controller edit really does make the rows
  // unreproducible from any commit.
  const status = git(['-C', dir, 'status', '--porcelain', '--']
    .concat(ANALYSIS_TARGETS)
    .concat(ROUTE_MODULES)
    .concat(['lib/util/routeParser.js', 'app.js', 'config/default.yaml']));
  const isBaseline = Boolean(head) && head.indexOf(BASELINE_COMMIT.slice(0, 7)) === 0;
  const isToolRepo = Boolean(toolRoot) && path.resolve(dir) === path.resolve(toolRoot);

  let label;
  if (isToolRepo) {
    label = 'the repository this generator lives in (the target worktree)';
  } else if (isBaseline) {
    label = 'a worktree at the R-f baseline commit `' + BASELINE_COMMIT.slice(0, 7) + '`';
  } else {
    label = 'a worktree at `' + (head ? head.slice(0, 7) : 'an unidentified revision') + '`';
  }

  return {
    path: dir,
    label: label,
    head: head || 'unavailable (no git metadata reachable from this path)',
    subject: head ? git(['-C', dir, 'log', '-1', '--format=%s']) : '',
    dirty: head ? status.length > 0 : false,
    dirtyPaths: status.length
      ? status.split('\n').map(function (line) {
        return line.slice(3).trim();
      }).filter(Boolean).sort()
      : [],
    isBaselineCommit: isBaseline,
    isToolRepository: isToolRepo
  };
}

function toolProvenance(toolRoot, toolRelPath) {
  const lastTouch = git(['-C', toolRoot, 'log', '-1', '--format=%H', '--', toolRelPath]);
  const status = git(['-C', toolRoot, 'status', '--porcelain', '--', toolRelPath]);
  const head = git(['-C', toolRoot, 'rev-parse', 'HEAD']);
  return {
    path: toolRelPath,
    commit: lastTouch || (head ? head + ' (repository HEAD; this file has no commit of its own yet)' : 'unavailable'),
    uncommittedChanges: status.length > 0
  };
}

// ---------------------------------------------------------------------------
// Closure: joining a baseline row to its target row
//
// A checklist whose every row is permanently unchecked is not a checklist.
// The previously committed inventory had 341 rows and 341 empty checkboxes,
// because the renderer emitted the literal string `- [ ] ` and the generator
// took no target input at all: there was nothing a row COULD be closed
// against. R-e's deliverable is the target status, payload, side effects and
// timing of every changed edge, and none of that was established.
//
// So closure is computed here, from both trees, and a box is ticked only when
// something was proven. The comparison has two independent dimensions and
// they are reported separately because they are proven by different means:
//
//   STATIC closure  the target row exists and its outcome - disposition,
//                   funnel, served status - equals what the baseline row
//                   requires, or the difference is an explicitly approved
//                   deviation naming this exact edge. Provable by this tool
//                   alone, over the two trees.
//   DRIVEN coverage a corpus scenario reaches the edge and its measured
//                   response was compared. Not provable here: it needs
//                   test/parity/capture.js and test/parity/replay.js, so it
//                   is joined from the corpus when one is supplied.
//
// The checkbox is static closure, because that is what this tool can prove.
// Driven coverage is a field on the row and a section of its own, so a row
// that is statically closed but never driven says exactly that instead of
// being presented as fully verified.
// ---------------------------------------------------------------------------

const CLOSURE = Object.freeze({
  CLOSED: 'closed',
  CHANGED: 'changed',
  MISSING: 'missing from the target',
  APPROVED: 'changed - approved deviation',
  ADDED: 'new in the target',
  // Two rows that COULD be the same edge and could equally be two different
  // ones. A pairing that cannot be established is not a closed row and not a
  // changed row: it is a row whose verdict is unknown, and it says so instead
  // of borrowing either verdict. Introduced because exact-identity pairs were
  // being overridden by positional ones - 34 of them in one document, 24
  // reported closed and 8 reported open on the strength of a pairing that put
  // the wrong two rows together.
  AMBIGUOUS: 'pairing ambiguous - not compared',
  // Nothing in the analysed corpus can reach this edge, so there is no
  // outcome on either tree to compare. Closing it would be asserting parity
  // of nothing against nothing.
  UNREACHABLE: 'not compared - proven unreachable',
  NOT_COMPARED: 'not compared'
});

/**
 * The observable outcome of an edge, reduced to the fields R-e names.
 *
 * Two edges have the same outcome when a client cannot tell them apart:
 * same funnel, same served status, same response-production. The MECHANISM is
 * deliberately excluded - `reply(Boom.notFound())` and
 * `return Boom.notFound()` are the same outcome by different means, and the
 * conversion changes the means on purpose. Comparing mechanisms would report
 * every converted row as a difference and the comparison would say nothing.
 */
function outcomeOf(edge) {
  return {
    funnel: edge.funnel || FUNNEL.NONE,
    status: servedStatus(edge),
    producesResponse: producesResponse(edge),
    surface: edge.surface,
    // R-e names four things an edge must still do after conversion: the
    // status, the payload, the side effects and the timing. Comparing only
    // the first - which is what this comparison did - closes a row whose log
    // moved, whose flash writes changed, or whose settlement moved to a
    // different tick, and R-e exists precisely to catch those. Each dimension
    // below is normalised so that a rename or a reordering is not a
    // difference and a real change is.
    payload: payloadShape(edge),
    effects: effectShape(edge),
    logs: logShape(edge),
    timing: timingShape(edge)
  };
}

/**
 * The payload or redirect a client receives, normalised.
 *
 * The status alone does not distinguish a Boom body from a rendered view from
 * a redirect from a raw value, and R-e requires the payload SHAPE be
 * preserved, not just the code.
 */
/**
 * The SEMANTIC kind of a produced response, from the name that produced it.
 *
 * Comparing the callee names directly compares the mechanism: `reply` is
 * exactly what this migration replaces, so a branch answering with
 * `reply(...)` at baseline and `request.fail(...)` in the target differs on
 * every callee name while producing the same response. Measured, that alone
 * opened 11 rows.
 *
 * `reply` is the shim's ONE universal producer - it served redirects, views,
 * values and failures alike - so its semantic kind is not knowable from the
 * name. It contributes `null` here, and a row whose only producer was
 * `reply` says that its payload kind could not be established statically
 * rather than claiming one.
 */
function responseKindOf(callee) {
  const name = String(callee || '');
  if (/request\.fail|(^|\.)fail$/.test(name)) {
    return 'a failure response';
  }
  if (/request\.success|(^|\.)success$/.test(name)) {
    return 'a success response';
  }
  if (/redirect/i.test(name)) {
    return 'a redirect';
  }
  if (/view|render/i.test(name)) {
    return 'a rendered view';
  }
  if (/^reply$/.test(name)) {
    return null;
  }
  if (/h\.response|errorResponse|legacyReply|response$/.test(name)) {
    return 'a response value';
  }
  return 'a response from ' + name;
}

/** The produced-response kinds this edge answers with, normalised and sorted. */
function producedKinds(edge) {
  const raw = edge.producedResponses || [];
  const kinds = [];
  let generic = false;
  raw.forEach(function (callee) {
    const kind = responseKindOf(callee);
    if (kind === null) {
      generic = true;
    } else if (kinds.indexOf(kind) === -1) {
      kinds.push(kind);
    }
  });
  if (!kinds.length) {
    return generic
      ? 'a response whose kind the shim\'s generic reply() does not reveal'
      : 'none';
  }
  return kinds.sort().join(', ');
}

function payloadShape(edge) {
  const kind = edge.thrownKind || edge.valueKind || null;
  if (edge.disposition === DISPOSITION.FAIL_LOCAL) {
    return edge.funnel === FUNNEL.L2
      ? 'request.fail: redirect, rendered fail view, or json+flash by branch'
      : 'none - request.fail is not installed on this surface';
  }
  if (edge.disposition === DISPOSITION.PROPAGATE) {
    return 'none - handed to the caller';
  }
  if (edge.disposition === DISPOSITION.LOG_CONTINUE ||
      edge.disposition === DISPOSITION.SWALLOW) {
    return producedKinds(edge);
  }
  if (edge.disposition === DISPOSITION.LATE_RESOLVE) {
    return producedKinds(edge);
  }
  if (!kind) {
    // `.catch(reply)` - a BARE reference used as the handler - has no argument
    // expression to classify, but the value reaching the response layer is
    // the rejection itself, which is an error value. Leaving it
    // "unclassified" made five rows differ on payload against a target that
    // returns the same error value by a different means.
    if (edge.disposition === DISPOSITION.REPLY_ERR) {
      return edge.funnel === FUNNEL.NONE
        ? 'none'
        : 'the error value, boomified or served as-is by the funnel';
    }
    return edge.funnel === FUNNEL.NONE ? 'none' : 'unclassified value';
  }
  if (kind.kind === 'unbound-reference') {
    return 'Boom generic 5xx body (ReferenceError: ' + kind.holder + ')';
  }
  if (kind.kind === 'type-error') {
    return 'Boom generic 5xx body (TypeError)';
  }
  if (kind.kind === 'boom') {
    return 'Boom payload for ' + (kind.factory || 'an unnamed factory');
  }
  if (kind.kind === 'error-construction') {
    return 'Boom generic 5xx body (constructed Error)';
  }
  if (kind.kind === 'error-identifier' || kind.kind === 'error-member') {
    return edge.funnel === FUNNEL.NONE
      ? 'none'
      : 'the error value, boomified or served as-is by the funnel';
  }
  return 'value';
}

/**
 * The writes an edge performs beyond its response, normalised to the KINDS of
 * write rather than their wording, so that rephrasing the row's prose is not
 * a difference and adding a flash write is.
 */
function effectShape(edge) {
  const parts = [];
  if (edge.disposition === DISPOSITION.FAIL_LOCAL && edge.funnel === FUNNEL.L2) {
    parts.push('yar-flash:failure', 'yar-flash:payload', 'yar-flash:query',
      'mutates fail.redirect in place');
  }
  if (edge.disposition === DISPOSITION.REPLY_ERR &&
      (edge.surface === SURFACE.PRE || edge.surface === SURFACE.INLINE_PRE) &&
      edge.funnel === FUNNEL.NONE) {
    parts.push('assigns request.pre');
  }
  if (edge.disposition === DISPOSITION.PROPAGATE) {
    parts.push('hands the error to ' +
      ((edge.propagatesVia && edge.propagatesVia.callee) || 'a continuation'));
  }
  if (edge.funnel === FUNNEL.L1) {
    parts.push('layer-1 logs err.stack at error level');
  }
  if (edge.funnel === FUNNEL.L2) {
    parts.push('layer-2 logs at info level');
  }
  return parts.length ? parts.sort().join('; ') : 'none';
}

/**
 * The log calls on this edge's own stack, by callee, sorted.
 *
 * A logging change is a side-effect change even when the status is identical -
 * the verifier's own synthetic case - so it is compared rather than described.
 */
function logShape(edge) {
  const calls = (edge.loggingCalls || []).slice().sort();
  return calls.length ? calls.join(', ') : 'none';
}

/**
 * WHEN the edge settles, relative to the carrier body, normalised.
 *
 * Moving an `await` moves the settlement without moving a single status code,
 * which is the change R-e is most likely to miss and the one a mechanical
 * conversion is most likely to make.
 */
function timingShape(edge) {
  const prop = edge.propagation || {};

  // OBSERVABLE ordering, reduced to the three answers a client can tell
  // apart, and nothing else.
  //
  // Two coarsenings were forced by measurement, and both were the mechanism
  // comparison that section 8 exists to avoid, arriving through the timing
  // field:
  //
  //   Rule T-3 puts the await boundary at the lifecycle method, so a callback
  //   becomes an awaited promise chain BY DESIGN. Naming the vehicle -
  //   `cps-callback` against `promise-chain` - made rows differ on timing for
  //   having been converted exactly as the plan requires.
  //
  //   A registered callback is created synchronously and INVOKED later, so
  //   `propagationAt` at a `.catch(fn)` handler's own keyword reads
  //   `carrier-body`, which is where the function is WRITTEN and not when it
  //   RUNS. Reading that as the settlement moved 38 rows from deferred to
  //   synchronous purely for relocating from a `reply(err)` inside a chain to
  //   the `.catch` handler that replaced it - the same deferred settlement
  //   under a different shape. Distinguishing "settles on a chain the carrier
  //   waits for" from "settles when the registered callback runs, and the
  //   carrier waits for it" then kept 40 of them differing on the wording of
  //   a vehicle rather than on an outcome.
  //
  // So three answers remain, and each is something a client can observe:
  // the edge settles before the carrier returns; it settles later and the
  // carrier waits, so the request settles; or it settles later with nothing
  // waiting, which is the case where the request may never settle and where
  // collapsing the wait changes which settlement wins. The vehicle is stated
  // in the row's Timing prose, where a reader needs it - it is only kept out
  // of the COMPARISON.
  const SYNC = 'synchronous - settles before the carrier returns';
  const WAITED = 'deferred - settles later, and the carrier waits for it';
  const UNWAITED = 'deferred - settles later, and nothing waits for it';

  const waited = prop.kind === 'promise-chain' ? prop.chainReturned !== false : true;

  if (edge.disposition === DISPOSITION.LATE_RESOLVE) {
    return WAITED;
  }
  if (edge.edgeClass === EDGE_CLASS.HANDLER ||
      edge.edgeClass === EDGE_CLASS.CPS ||
      edge.edgeClass === EDGE_CLASS.ERR_PARAM) {
    return waited ? WAITED : UNWAITED;
  }
  switch (prop.kind) {
    case 'cps-callback':
      return WAITED;
    case 'promise-chain':
      return waited ? WAITED : UNWAITED;
    case 'carrier-body':
      return SYNC;
    default:
      return prop.kind ? WAITED : SYNC;
  }
}

/** The status a client receives from this edge, or null when none is served. */
function servedStatus(edge) {
  const kind = edge.thrownKind || edge.valueKind || null;

  if (edge.disposition === DISPOSITION.BOOM) {
    if (kind && kind.kind === 'unbound-reference') {
      return edge.funnel === FUNNEL.NONE ? null : 500;
    }
    if (kind && kind.kind === 'type-error') {
      return edge.funnel === FUNNEL.NONE ? null : 500;
    }
    if (edge.returnedBoom && kind && kind.kind === 'boom') {
      return edge.funnel === FUNNEL.NONE ? null : (kind.status || null);
    }
    if (edge.funnel === FUNNEL.L1) {
      // The handler catch-all flattens every thrown value to 500, including a
      // thrown Boom whose own status is discarded.
      return 500;
    }
    if (edge.funnel === FUNNEL.L3) {
      return kind && kind.kind === 'boom' ? (kind.status || null) : 500;
    }
    return null;
  }

  if (edge.disposition === DISPOSITION.REPLY_ERR) {
    if (edge.funnel === FUNNEL.NONE) {
      return null;
    }
    return kind && kind.kind === 'boom' ? (kind.status || null) : 500;
  }

  if (edge.disposition === DISPOSITION.FAIL_LOCAL) {
    // request.fail answers 302 or 200 depending on the route's own fail
    // configuration, which is a property of the route rather than of the
    // edge; the funnel is what this comparison can assert.
    return edge.funnel === FUNNEL.L2 ? 'request.fail' : null;
  }

  return null;
}

/** Whether this edge produces a response at all. */
function producesResponse(edge) {
  if (edge.disposition === DISPOSITION.LOG_CONTINUE ||
      edge.disposition === DISPOSITION.SWALLOW ||
      edge.disposition === DISPOSITION.PROPAGATE) {
    return (edge.producedResponses || []).length > 0;
  }
  return edge.funnel !== FUNNEL.NONE;
}

/**
 * The R-e dimensions two outcomes disagree on, named.
 *
 * Returning the NAMES rather than a boolean is what lets a changed row say
 * what changed. A row reported changed without that is a row a reader has to
 * re-derive.
 */
const OUTCOME_DIMENSIONS = Object.freeze([
  ['funnel', 'funnel'],
  ['status', 'status served'],
  ['producesResponse', 'whether a response is produced'],
  ['surface', 'surface'],
  ['payload', 'payload or redirect shape'],
  ['effects', 'side effects'],
  ['logs', 'log calls'],
  ['timing', 'settlement timing']
]);

function outcomeDiff(a, b) {
  if (!a || !b) {
    return [];
  }
  return OUTCOME_DIMENSIONS.filter(function (entry) {
    return String(a[entry[0]]) !== String(b[entry[0]]);
  }).map(function (entry) {
    return entry[1];
  });
}

/** Whether two outcomes agree on every R-e dimension. */
function sameOutcome(a, b) {
  return outcomeDiff(a, b).length === 0;
}

/** A human-readable outcome, for the row and the closure table. */
function outcomeText(outcome) {
  const status = outcome.status === null
    ? 'no response'
    : outcome.status === 'request.fail'
      ? 'the route\'s request.fail response'
      : String(outcome.status);
  return outcome.funnel + ' / ' + status +
    ' / ' + (outcome.producesResponse ? 'answers' : 'answers nothing') +
    ' / ' + outcome.surface;
}

/**
 * Join baseline edges to target edges and decide each row's closure.
 *
 * Matching is two-tier. The exact tier joins on the full stable identity. The
 * fallback tier joins the leftovers within their (file, carrier, class) group
 * by position, and MARKS them, because a fallback match is a weaker claim
 * than an exact one and a reviewer needs to know which they are reading.
 *
 * @param {Object[]} baselineEdges rows measured on the R-f baseline tree
 * @param {Object[]} targetEdges rows measured on the analysed target tree
 * @returns {Object} { rows, byId, summary }
 */
function joinTrees(baselineEdges, targetEdges) {
  // Both sides are aligned CARRIER BY CARRIER, IN SOURCE ORDER.
  //
  // Source order within one carrier is the strongest signal available, and
  // the edge class is one of the weakest, because the conversion flips the
  // class of the same conceptual edge routinely:
  //
  //   baseline  .catch(function(err) { return reply(err); })
  //             the reply site is a terminal, so the edge is that site and
  //             its class is `response`
  //   target    .catch(function(err) { return err; })
  //             there is no terminal, so the edge is the handler itself and
  //             its class is `handler`
  //
  // Matching on class first therefore crosses the pairs. Measured on
  // `course.deleteCourse`, whose two edges are `response, response` at
  // baseline and `handler, response` in the target: a class-first match
  // paired baseline edge 1 with target edge 2 and baseline edge 2 with target
  // edge 1, and reported BOTH as changed although both are unchanged - the
  // catch still answers 500 through Layer 3 and the forbidden branch still
  // raises a ReferenceError that Layer 1 answers 500. Two false failures out
  // of one crossing.
  //
  // Aligning by position inside the carrier pairs them correctly, and the
  // handler and pre-handler NAMES are invariants of this migration - the
  // route declarations bind them - so the carrier is a reliable grouping key.
  // Where the counts differ the surplus is reported as missing or added
  // rather than force-matched, and every positional pairing says so on its
  // own row.
  const groupKey = function (edge) {
    return edge.file + '\u0000' + (edge.carrierMember || '$module');
  };
  const bySourceOrder = function (a, b) {
    return a.offset - b.offset;
  };

  const baselineGroups = new Map();
  baselineEdges.forEach(function (edge) {
    const key = groupKey(edge);
    if (!baselineGroups.has(key)) {
      baselineGroups.set(key, []);
    }
    baselineGroups.get(key).push(edge);
  });

  const targetGroups = new Map();
  targetEdges.forEach(function (edge) {
    const key = groupKey(edge);
    if (!targetGroups.has(key)) {
      targetGroups.set(key, []);
    }
    targetGroups.get(key).push(edge);
  });

  const rows = [];
  const claimed = new Set();

  // ANCHORED ALIGNMENT.
  //
  // Two signals are available and neither is sufficient alone. Exact identity
  // is the stronger claim, but it is not always present, because the
  // conversion flips an edge's CLASS routinely and the class is part of the
  // identity:
  //
  //   baseline  .catch(function(err) { return reply(err); })
  //             the reply site is a terminal, so the edge is that site and
  //             its class is `response`
  //   target    .catch(function(err) { return err; })
  //             there is no terminal, so the edge is the handler itself and
  //             its class is `handler`
  //
  // Source order within one carrier covers those, but using it alone
  // OVERRIDES exact identity when the two disagree: measured, 34 pairs in one
  // document were positioned onto a different row than the one carrying their
  // own id, and 24 of them were reported closed and 8 open on that pairing.
  //
  // So identity is authoritative and position fills its gaps. Exact-id pairs
  // become ANCHORS; the anchors are checked for order-preservation, which is
  // the property that makes a positional fill between them meaningful; and
  // the leftovers are aligned positionally only WITHIN a gap between two
  // consecutive anchors. Where the anchors cross - the target's ids appear in
  // a different order than the baseline's - no alignment of that group can be
  // trusted, and every pair in it is reported AMBIGUOUS rather than given a
  // verdict from a pairing that may be wrong.
  Array.from(baselineGroups.keys()).sort().forEach(function (key) {
    const baseGroup = baselineGroups.get(key).slice().sort(bySourceOrder);
    const targetGroup = (targetGroups.get(key) || []).slice().sort(bySourceOrder);

    const targetIndexById = new Map();
    targetGroup.forEach(function (edge, index) {
      targetIndexById.set(edge.id, index);
    });

    // WHEN IS AN EXACT ID MATCH EVIDENCE, AND WHEN IS IT A COINCIDENCE?
    //
    // An identity is `<file>.<carrier>.<class>.<ordinal>`, so `response.1`
    // means "the first response-class edge in this carrier". That denotes the
    // same edge on both trees only while the carrier's population of that
    // CLASS is unchanged. Where it changed, the ordinals renumber and the
    // match is an artefact of the renumbering. Measured on
    // `course.deleteCourse`, whose baseline is
    //
    //   response.1  line 151  reply(err)
    //   response.2  line 155  throw (ReferenceError: Boom is not defined)
    //
    // and whose target is
    //
    //   handler.1   line 183  .catch() handler - returns the error as the response
    //   response.1  line 192  throw (ReferenceError: Boom is not defined)
    //
    // the first baseline edge became the handler-class edge and the second
    // kept its shape - so baseline `response.1` corresponds to target
    // `handler.1`, and target `response.1` is the SECOND baseline edge under
    // a renumbered ordinal. Taking the id match would pair line 151 with line
    // 192 and report both rows changed, which is two false failures from one
    // crossing.
    //
    // So an id match is an anchor only when that (carrier, class) holds the
    // same number of edges on both trees. Where it does not, the match is
    // discarded and source order - which the conversion preserves, because
    // the route declarations bind the carrier names and the statements keep
    // their order - decides. The discarded match is not hidden: the row
    // records that a target row of the same id exists elsewhere in the
    // carrier, so a reviewer can see the pairing this alignment chose and
    // why.
    const classCount = function (group, edgeClass) {
      return group.filter(function (edge) {
        return edge.edgeClass === edgeClass;
      }).length;
    };
    const anchors = [];
    const discarded = [];
    baseGroup.forEach(function (base, index) {
      if (!targetIndexById.has(base.id)) {
        return;
      }
      const stable = classCount(baseGroup, base.edgeClass) ===
        classCount(targetGroup, base.edgeClass);
      if (stable) {
        anchors.push({ base: index, target: targetIndexById.get(base.id) });
      } else {
        discarded.push({
          base: index,
          target: targetIndexById.get(base.id),
          edgeClass: base.edgeClass,
          baselineCount: classCount(baseGroup, base.edgeClass),
          targetCount: classCount(targetGroup, base.edgeClass)
        });
      }
    });

    // Order-preservation. Anchors are already ascending in `base`; if they are
    // not also ascending in `target`, the same edges appear in a different
    // order on the two trees and nothing about this group's alignment can be
    // established from position.
    let monotonic = true;
    for (let i = 1; i < anchors.length; i++) {
      if (anchors[i].target <= anchors[i - 1].target) {
        monotonic = false;
        break;
      }
    }

    const pairing = new Map();
    const unequalGapPairs = new Set();
    let ambiguous = false;

    if (!monotonic) {
      ambiguous = true;
      anchors.forEach(function (anchor) {
        pairing.set(anchor.base, anchor.target);
      });
    } else {
      anchors.forEach(function (anchor) {
        pairing.set(anchor.base, anchor.target);
      });
      // Fill each gap between consecutive anchors positionally, pairing the
      // k-th unanchored baseline row in the gap with the k-th unanchored
      // target row in the SAME gap. A leftover cannot cross an anchor, which
      // is what stops an inserted leading edge shifting every later pair -
      // the failure the verifier reproduced synthetically.
      let prevBase = -1;
      let prevTarget = -1;
      const gaps = anchors.map(function (anchor) {
        const gap = { baseFrom: prevBase + 1, baseTo: anchor.base, targetFrom: prevTarget + 1, targetTo: anchor.target };
        prevBase = anchor.base;
        prevTarget = anchor.target;
        return gap;
      });
      gaps.push({
        baseFrom: prevBase + 1, baseTo: baseGroup.length,
        targetFrom: prevTarget + 1, targetTo: targetGroup.length
      });
      gaps.forEach(function (gap) {
        const bases = [];
        for (let i = gap.baseFrom; i < gap.baseTo; i++) {
          bases.push(i);
        }
        const targets = [];
        for (let j = gap.targetFrom; j < gap.targetTo; j++) {
          if (!targetGroup[j] || !anchors.some(function (a) { return a.target === j; })) {
            targets.push(j);
          }
        }
        // SOURCE ORDER PAIRS A GAP ONLY WHEN THE GAP IS THE SAME SIZE ON BOTH
        // SIDES. Equal counts make the fill a bijection, and the conversion
        // preserves statement order within a carrier, so the k-th unanchored
        // row on one side is the k-th on the other. Unequal counts mean a row
        // was added or removed INSIDE the gap, and position cannot say which:
        // pairing from the start silently shifts every row after the
        // insertion point onto its neighbour. Measured on a synthetic
        // leading insertion - baseline `response.1, response.2` against a
        // target holding a new leading edge and then both - the fill paired
        // the new edge with the first baseline row and closed it, then
        // reported the genuine first row changed. So an unequal gap is
        // reported AMBIGUOUS for the rows that could be paired and
        // missing/added for the surplus, rather than given a verdict from a
        // pairing that may be off by one.
        const equalGap = bases.length === targets.length;
        bases.forEach(function (baseIndex, k) {
          if (k < targets.length) {
            pairing.set(baseIndex, targets[k]);
            if (!equalGap) {
              unequalGapPairs.add(baseIndex);
            }
          }
        });
      });
    }

    baseGroup.forEach(function (base, index) {
      const targetIndex = pairing.has(index) ? pairing.get(index) : -1;
      const target = targetIndex >= 0 ? targetGroup[targetIndex] : null;
      const baselineOutcome = outcomeOf(base);

      if (!target) {
        rows.push({
          id: base.id,
          baseline: base,
          target: null,
          matchedBy: null,
          baselineOutcome: baselineOutcome,
          targetOutcome: null,
          closure: CLOSURE.MISSING,
          differences: [],
          approved: null
        });
        return;
      }

      claimed.add(target.id);
      const targetOutcome = outcomeOf(target);
      const byIdentity = target.id === base.id;
      const matchedBy = byIdentity
        ? 'identity'
        : 'position ' + (targetIndex + 1) + ' of ' + targetGroup.length + ' in `' +
          base.file + '` carrier `' + (base.carrierMember || '(module scope)') +
          '` (target row `' + target.id + '`)';

      const differences = outcomeDiff(baselineOutcome, targetOutcome);
      const renumbered = discarded.filter(function (entry) {
        return entry.base === index;
      })[0] || null;
      let closure;
      let approved = null;

      if (ambiguous || unequalGapPairs.has(index)) {
        // A crossed group, or a pairing inside a gap whose two sides are
        // different sizes. Reporting either verdict would be reporting a
        // pairing this alignment cannot establish.
        closure = CLOSURE.AMBIGUOUS;
      } else if (base.unreachableProven || target.unreachableProven) {
        closure = CLOSURE.UNREACHABLE;
      } else if (differences.length === 0) {
        closure = CLOSURE.CLOSED;
      } else {
        closure = CLOSURE.CHANGED;
        approved = approvedDeviationFor(base.id, baselineOutcome, targetOutcome);
        if (approved) {
          closure = CLOSURE.APPROVED;
        }
      }

      rows.push({
        id: base.id,
        baseline: base,
        target: target,
        matchedBy: matchedBy,
        baselineOutcome: baselineOutcome,
        targetOutcome: targetOutcome,
        closure: closure,
        differences: differences,
        ambiguousGroup: ambiguous
          ? key.replace('\u0000', ' carrier ') + ' - its trusted anchors appear in a different order on the two trees'
          : unequalGapPairs.has(index)
            ? key.replace('\u0000', ' carrier ') + ' - a row was added or removed between the same two anchors, so source order cannot say which row this one is'
            : null,
        renumbered: renumbered && !byIdentity
          ? 'a target row also carries id `' + base.id + '`, but this ' +
            'carrier holds ' + renumbered.baselineCount + ' `' +
            renumbered.edgeClass + '`-class edge(s) at baseline and ' +
            renumbered.targetCount + ' in the target, so that ordinal has ' +
            'renumbered and the match is not evidence of correspondence. ' +
            'Source order decided this pairing.'
          : null,
        approved: approved
      });
    });
  });

  // Target rows nothing in the baseline claimed. A new edge is not a failure -
  // conversion legitimately introduces sites - but it is unverified against
  // any baseline fact, and the document says so rather than omitting it.
  const added = targetEdges.filter(function (edge) {
    return !claimed.has(edge.id);
  }).map(function (edge) {
    return {
      id: edge.id,
      baseline: null,
      target: edge,
      matchedBy: null,
      baselineOutcome: null,
      targetOutcome: outcomeOf(edge),
      closure: edge.unreachableProven ? CLOSURE.UNREACHABLE : CLOSURE.ADDED,
      differences: [],
      approved: null
    };
  });

  const all = rows.concat(added);

  // TWO indexes, not one merged map.
  //
  // A baseline id and a target id are drawn from the same namespace and can
  // collide across differently-aligned rows: a baseline row left unmatched
  // keeps its id, and a target row aligned to a DIFFERENT baseline row can
  // carry that same id. Merging both into one map let the second write win or
  // lose by insertion order, and the document then printed one row's verdict
  // against another row's edge - measured as six target rows reported
  // "missing from the target", which is a verdict that cannot apply to a row
  // the target contains. Keeping the namespaces apart makes each lookup
  // answer the question it was asked.
  const byBaselineId = new Map();
  const byTargetId = new Map();
  all.forEach(function (row) {
    if (row.baseline) {
      byBaselineId.set(row.baseline.id, row);
    }
    if (row.target) {
      byTargetId.set(row.target.id, row);
    }
  });

  const count = function (state) {
    return all.filter(function (row) {
      return row.closure === state;
    }).length;
  };

  // Rows carrying `side` whose bucket is one that side may legitimately be in.
  const accountedOn = function (side, states) {
    return all.filter(function (row) {
      return Boolean(row[side]) && states.indexOf(row.closure) !== -1;
    }).length;
  };

  return {
    rows: all,
    byBaselineId: byBaselineId,
    byTargetId: byTargetId,
    summary: {
      baselineRows: baselineEdges.length,
      targetRows: targetEdges.length,
      closed: count(CLOSURE.CLOSED),
      changed: count(CLOSURE.CHANGED),
      missing: count(CLOSURE.MISSING),
      approved: count(CLOSURE.APPROVED),
      added: count(CLOSURE.ADDED),
      ambiguous: count(CLOSURE.AMBIGUOUS),
      unreachable: count(CLOSURE.UNREACHABLE),
      fallbackMatches: all.filter(function (row) {
        return row.matchedBy && row.matchedBy !== 'identity';
      }).length,
      renumberedOrdinals: all.filter(function (row) {
        return Boolean(row.renumbered);
      }).length,
      // Arithmetic that RECONCILES, and is asserted rather than presented.
      // Every baseline row lands in exactly one of closed / changed /
      // approved / missing / ambiguous / unreachable, and every target row in
      // exactly one of closed / changed / approved / ambiguous / unreachable
      // / added. A summary whose buckets do not add up to the row counts is a
      // summary that has lost rows, and losing rows is how a closure claim
      // overstates itself.
      //
      // Counted on the SIDE each row actually has, not by bucket totals.
      // Ambiguous and unreachable are not necessarily two-sided: a row new in
      // the target whose member the corpus never mentions is proven
      // unreachable and has no baseline at all, which is why `--edge-index`
      // lists "proven unreachable" among the UNPAIRED categories beside
      // "missing from the target" and "new in the target". Adding those
      // buckets into the baseline total counted such a row against a side it
      // does not have: measured on this tree, 345 of 342 baseline rows
      // "accounted for", an overstatement of exactly the three target-only
      // unreachable rows. The check keeps all of its force - a row whose
      // bucket contradicts the sides it carries, or a row in no bucket at
      // all, still fails to be counted and is still fatal.
      baselineAccounted: accountedOn('baseline', [
        CLOSURE.CLOSED, CLOSURE.CHANGED, CLOSURE.APPROVED, CLOSURE.MISSING,
        CLOSURE.AMBIGUOUS, CLOSURE.UNREACHABLE
      ]),
      targetAccounted: accountedOn('target', [
        CLOSURE.CLOSED, CLOSURE.CHANGED, CLOSURE.APPROVED, CLOSURE.AMBIGUOUS,
        CLOSURE.UNREACHABLE, CLOSURE.ADDED
      ])
    }
  };
}

/**
 * The approved deviation covering a difference, or null.
 *
 * An entry must name the edge id AND the exact from/to outcome. A marker that
 * merely says "approved" approves nothing here: the point of approving a
 * deviation is that a specific change was reviewed, and a comparator that
 * accepted any change under an approved id would let an unrelated regression
 * through on the strength of the review of something else.
 */
function approvedDeviationFor(id, baselineOutcome, targetOutcome) {
  for (let i = 0; i < APPROVED_DEVIATIONS.length; i++) {
    const entry = APPROVED_DEVIATIONS[i];
    if (entry.id !== id) {
      continue;
    }
    if (entry.from === outcomeText(baselineOutcome) && entry.to === outcomeText(targetOutcome)) {
      return entry;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Driven coverage: joining rows to corpus scenarios
//
// The corpus is owned by test/parity/capture.js and read here, never
// written. Two join keys are accepted, in this order:
//
//   1. a `covers` entry naming an edge id from this document, which is the
//      direct join and the one a scenario author should use;
//   2. a `covers` entry naming a route key - `GET /api/trinkets/{id}` - which
//      joins to every row whose carrier is bound to that route. This is
//      weaker: it says the route was driven, not that the failure branch was
//      reached. It is reported as `route-level` so the difference is visible.
//
// The corpus in this repository carries route keys only and nine
// `error-edge.*` scenarios, so most rows come back route-level or uncovered.
// That is the measurement, and it is printed as one.
// ---------------------------------------------------------------------------

/**
 * Read the corpus and index its scenarios by what they cover.
 *
 * @param {string} scenariosPath path to a capture corpus
 * @returns {Object} { path, scenarioCount, byEdgeId, byRoute, errorEdgeGroups }
 */
function readScenarios(scenariosPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
  } catch (err) {
    throw new AnalysisError(
      'could not read the scenario corpus at ' + scenariosPath + ': ' +
      (err && err.message ? err.message : String(err))
    );
  }
  if (!parsed || !Array.isArray(parsed.scenarios)) {
    throw new AnalysisError(
      'the scenario corpus at ' + scenariosPath + ' has no `scenarios` array, ' +
      'so nothing can be joined to the inventory rows.'
    );
  }

  const byEdgeId = new Map();
  const byRoute = new Map();
  const errorEdgeGroups = new Set();

  parsed.scenarios.forEach(function (scenario) {
    const id = String(scenario.id || '');
    if (id.indexOf('error-edge') === 0) {
      errorEdgeGroups.add(String(scenario.group || id));
    }
    // TWO FIELDS, because `covers` cannot carry an edge id.
    //
    // `test/parity/capture.js` validates every `covers` entry against the
    // route manifest and reports anything else as `unknownRoutes`, which it
    // treats as a defect in its own tables. So a scenario that named an edge
    // id in `covers` would fail the producer, and an earlier edition of this
    // document nonetheless told authors to put them there - a join contract
    // the producer cannot satisfy.
    //
    // `coversEdges` is a field capture.js does not read, so a scenario can
    // carry it without tripping that validation. Edge ids in `covers` are
    // still accepted here, so a corpus that adopts either shape joins; the
    // document names `coversEdges` as the one to write.
    const listOf = function (value) {
      return Array.isArray(value) ? value : (value ? [value] : []);
    };
    listOf(scenario.covers).forEach(function (key) {
      const text = String(key);
      // An edge id has the shape `<file>.<carrier>.<class>.<n>`; a route key
      // begins with an HTTP method. The two cannot be confused.
      const target = /^(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s/.test(text)
        ? byRoute
        : byEdgeId;
      if (!target.has(text)) {
        target.set(text, []);
      }
      target.get(text).push(id);
    });
    listOf(scenario.coversEdges).forEach(function (key) {
      const text = String(key);
      if (!byEdgeId.has(text)) {
        byEdgeId.set(text, []);
      }
      byEdgeId.get(text).push(id);
    });
  });

  return {
    path: scenariosPath,
    scenarioCount: parsed.scenarios.length,
    byEdgeId: byEdgeId,
    byRoute: byRoute,
    errorEdgeScenarioCount: parsed.scenarios.filter(function (scenario) {
      return String(scenario.id || '').indexOf('error-edge') === 0;
    }).length,
    errorEdgeGroups: Array.from(errorEdgeGroups).sort()
  };
}

/**
 * The corpus scenarios that drive an edge, and how directly.
 *
 * @returns {{level: string, scenarios: string[]}}
 */
function coverageFor(edge, scenarios) {
  if (!scenarios) {
    return { level: 'not joined', scenarios: [] };
  }
  const direct = scenarios.byEdgeId.get(edge.id);
  if (direct && direct.length) {
    return { level: 'edge-level', scenarios: dedupe(direct) };
  }
  const viaRoutes = [];
  (edge.routes || []).forEach(function (route) {
    const key = String(route).replace(/\s+[A-Za-z0-9_$.]+$/, '');
    const hits = scenarios.byRoute.get(key) || scenarios.byRoute.get(String(route));
    if (hits) {
      hits.forEach(function (id) {
        viaRoutes.push(id);
      });
    }
  });
  if (viaRoutes.length) {
    return { level: 'route-level', scenarios: dedupe(viaRoutes).sort() };
  }
  return { level: 'uncovered', scenarios: [] };
}

// ---------------------------------------------------------------------------
// The counts self-check
// ---------------------------------------------------------------------------

/**
 * Compare the scanner's token counts with the figures measured at the
 * baseline commit, and decide whether a mismatch is a failure.
 *
 * A mismatch means one of two things and they are not equally likely: either
 * the scanner has desynchronized, or the tree is not the baseline. The first
 * must be loud; the second is the normal case for a converted tree and must
 * not be. So the assertion applies when the tree is detected as the baseline
 * and, in strict mode, always.
 */
function checkCounts(observed, mode, tree) {
  const expected = BASELINE_COUNTS;
  const comparisons = [
    { label: 'reply( in lib/controllers/*.js', observed: observed.replyControllers, expected: expected.replyControllers },
    { label: 'reply( in ' + HELPERS_FILE, observed: observed.replyHelpers, expected: expected.replyHelpers },
    { label: 'reply( in ' + INLINE_PRE_FILE, observed: observed.replyInlinePre, expected: expected.replyInlinePre },
    { label: 'reply( total', observed: observed.replyTotal, expected: expected.replyTotal },
    { label: '.then( in lib/controllers/*.js', observed: observed.thenControllers, expected: expected.thenControllers },
    { label: '.catch( in lib/controllers/*.js', observed: observed.catchControllers, expected: expected.catchControllers }
  ];

  const allMatch = comparisons.every(function (row) {
    return row.observed === row.expected;
  });
  const fingerprintSaysBaseline = observed.legacyHandlerDeclarations >= LEGACY_FINGERPRINT_FLOOR;
  const baselineDetected = tree.isBaselineCommit || allMatch || fingerprintSaysBaseline;

  const reasons = [];
  if (tree.isBaselineCommit) {
    reasons.push('the analysed tree\'s HEAD is the baseline commit');
  }
  if (allMatch) {
    reasons.push('all six token counts already match the baseline figures');
  }
  if (fingerprintSaysBaseline) {
    reasons.push(
      'the legacy-handler fingerprint is ' + observed.legacyHandlerDeclarations +
      ' `function (request, reply)` declarations, at or above the floor of ' +
      LEGACY_FINGERPRINT_FLOOR
    );
  }

  const applied = mode === 'strict' || (mode === 'auto' && baselineDetected);

  if (applied && !allMatch) {
    const failures = comparisons.filter(function (row) {
      return row.observed !== row.expected;
    }).map(function (row) {
      return '  ' + row.label + ': expected ' + row.expected + ', counted ' + row.observed;
    }).join('\n');
    throw new AnalysisError(
      'token self-check failed against the figures measured at ' +
      BASELINE_COMMIT.slice(0, 7) + ':\n' + failures + '\n' +
      (mode === 'strict'
        ? 'Mode is --counts-check=strict, so every figure must match.'
        : 'The analysed tree was detected as the baseline because ' +
          reasons.join(' and ') + ', so every figure must match.') +
      '\nEither the scanner is desynchronized - in which case the inventory ' +
      'would be quietly incomplete and must not be written - or this tree is ' +
      'not the baseline, in which case pass --counts-check=off and record why.'
    );
  }

  return {
    mode: mode,
    applied: applied,
    baselineDetected: baselineDetected,
    detectionReasons: reasons,
    allMatch: allMatch,
    comparisons: comparisons
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Make a source fragment safe inside a Markdown inline code span that may sit
 * inside a table cell.
 *
 * Three characters have to be handled and the predecessor of this function
 * handled one:
 *
 *   `   ends the code span early - handled before, replaced with an apostrophe;
 *   |   ends the TABLE CELL, wherever it appears, including inside a code
 *       span. A source line containing `err.message || String(err)` or a
 *       regex alternation splits its row into extra columns, and the row
 *       after it in the rendered table is silently misaligned - which makes
 *       a generated evidence table unreadable at exactly the rows most worth
 *       reading, because `||` is common in error expressions;
 *   \\   escapes the next character in Markdown, so a fragment ending in a
 *       backslash consumes the closing delimiter.
 *
 * Newlines are folded to spaces so a fragment can never break out of its row.
 */
function code(text) {
  return '`' + escapeInline(text) + '`';
}

/** The body of an inline code span: no backticks, no pipes, no line breaks. */
function escapeInline(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\'')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ');
}

/**
 * Make prose safe inside a Markdown table cell.
 *
 * Prose is not wrapped in a code span, so a pipe in it splits the row just
 * the same. Applied to every value this tool interpolates into a table.
 */
function cell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function lineRef(edge) {
  return edge.endLine > edge.line
    ? edge.file + ':' + edge.line + '-' + edge.endLine
    : edge.file + ':' + edge.line;
}

/**
 * The provenance block, containing nothing that varies between two machines
 * analysing the same commits.
 *
 * Three values used to make the committed artifact machine-specific, and a
 * generated deliverable that differs across machines cannot be reviewed by
 * diffing it - which is the only way anyone reviews a 300-row generated
 * table:
 *
 *   the analysed tree's ABSOLUTE PATH - `/tmp/blitzy-c8/baseline-2f8712a` in
 *     the previously committed output. It named one agent's scratch directory
 *     on one pod. Nobody else has that path, and its presence made the file's
 *     first table row a fact about the machine rather than about the tree;
 *   the WALL CLOCK, which differs between two runs over one tree by
 *     construction, so every regeneration produced a diff even when nothing
 *     had changed;
 *   the EXACT PHYSICAL COMMAND, which embedded the same absolute path again.
 *
 * All three are replaced here by their reproducible form: a symbolic label
 * for the tree, the commit it is at, and a command anyone can run. The
 * physical values are not lost - `--provenance-out` writes them to a sidecar,
 * which is where a volatile fact belongs. What remains in the committed body
 * is a pure function of the analysed commits, so two runs on two machines
 * over the same commits produce byte-identical output and `diff` reviews the
 * tree.
 */
/**
 * How the generator's commit is rendered, in three states rather than one.
 *
 * A commit is printed ONLY when a commit has been found whose tree holds the
 * generator blob at the generator path. `uncommitted-source` is the honest
 * answer while this generator is still changing, and it is what stops the
 * document naming a revision that cannot reproduce it.
 */
function renderGeneratorCommit(tool) {
  if (tool.commitState === 'contains-this-exact-source' && tool.verified) {
    return '`' + tool.commit + '` - verified: its tree holds `' + tool.path +
      '` as the blob above (`git cat-file -e ' + tool.commit.slice(0, 12) +
      '` resolves it)';
  }

  if (tool.commitState === 'uncommitted-source') {
    return 'none - `uncommitted-source`. The generator that produced this ' +
      'document is not in any commit of this repository, so naming one would ' +
      'name a revision that cannot reproduce it. The blob above is its ' +
      'identity until it is committed.';
  }

  return 'none - `' + tool.commitState + '`. No repository is reachable from ' +
    'the generator, so no commit could be resolved.';
}

/**
 * Records the digest of the document's own body on its provenance block.
 *
 * A JSON artifact is bound to its provenance by `payloadDigest`; a Markdown
 * document has no JSON payload, so without this nothing ties the block to the
 * prose it describes and a hand-edited row verifies clean. The shared contract
 * treats a document block with no `bodyDigest` as a FAILURE, so this is a gate
 * rather than an addition.
 *
 * The ordering looks circular and is not: `provenance.bodyDigest()`
 * canonicalizes the document with its `provenance-json` line REMOVED, so the
 * digest of the pass-1 text (whose line carries a block without the field) and
 * of the written text (whose line carries it) are the same value.
 */
function bindBodyDigest(block, body) {
  block.bodyDigest = provenance.bodyDigest(body);

  // Re-asserted because `provenance.build()` guards the block it returns and
  // this field is added after that: a value appended to a validated block is
  // unvalidated unless it is checked here.
  return provenance.assertPortable(block, 'provenance');
}

function renderProvenance(model) {
  const lines = [];
  lines.push('<!-- Generated output. Every value in this block is a function of the analysed commits, not of the machine or the moment: see --provenance-out for the volatile physical detail. -->');
  lines.push('# Error-edge inventory');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| Analysed tree | ' + cell(model.tree.label) + ' |');
  lines.push('| Analysed tree HEAD | `' + model.tree.head + '`' +
    (model.tree.subject ? ' - ' + cell(model.tree.subject) : '') +
    (model.tree.dirty
      ? ' **(analysed sources have uncommitted changes: ' +
        cell(model.tree.dirtyPaths.join(', ')) + ' - these rows are not ' +
        'reproducible from any commit)**'
      : '') + ' |');
  lines.push('| Is the R-f baseline commit | ' + (model.tree.isBaselineCommit ? 'yes' : 'no') +
    ' (baseline is `' + BASELINE_COMMIT + '`) |');
  if (model.baselineTree) {
    lines.push('| Compared against | ' + cell(model.baselineTree.label) + ' |');
    lines.push('| Compared-against HEAD | `' + model.baselineTree.head + '`' +
      (model.baselineTree.subject ? ' - ' + cell(model.baselineTree.subject) : '') +
      (model.baselineTree.dirty ? ' **(working tree has uncommitted changes)**' : '') + ' |');
  }
  lines.push('| Generator | `' + model.tool.path + '` |');
  // The blob is the generator's identity, and it is printed with the command
  // that retrieves it: `git hash-object` yields these same 40 characters in
  // every clone, and `git cat-file blob` returns the exact source that ran.
  lines.push('| Generator blob | ' +
    (model.identity && model.identity.blob
      ? '`' + model.identity.blob + '` - retrieve the exact source that ran ' +
        'with `git cat-file blob ' + model.identity.blob.slice(0, 12) + '`'
      : 'not recorded - this generator is not inside a git checkout, so its ' +
        'source cannot be retrieved by id') + ' |');
  lines.push('| Generator commit | ' +
    (model.identity
      ? renderGeneratorCommit(model.identity)
      : '`' + model.tool.commit + '`' +
        (model.tool.uncommittedChanges ? ' **(uncommitted changes present)**' : '')) + ' |');
  lines.push('| Node major | `v' + process.versions.node.split('.')[0] + '` |');
  lines.push('| Token self-check | ' + (model.check.applied ? 'asserted' : 'reported only') +
    ' (`--counts-check=' + model.check.mode + '`) |');
  lines.push('| Closure comparison | ' + cell(model.closureMode) + ' |');
  lines.push('| Scenario coverage | ' + cell(model.coverageMode) + ' |');
  lines.push('| Rows emitted by this run | ' + model.totals.rows + ' |');
  lines.push('| Reproduce with | `' + escapeInline(model.reproduce) + '` |');
  lines.push('');
  lines.push('<!-- The same facts, machine-readable, so a verifier reads them without');
  lines.push('     parsing the table above. Consumed by');
  lines.push('     `node test/parity/manifest.js --verify-provenance <this file>`. -->');
  // A caller reaching renderDocument() through the module API without a block
  // gets the table and no machine-readable line, rather than a line carrying
  // `undefined` that a verifier would read as a malformed block.
  if (model.provenance) {
    lines.push(provenance.markdown(model.provenance));
  }
  lines.push('');
  lines.push('<!-- /provenance -->');
  lines.push('');
  lines.push('> **This file is generated output. Do not hand-edit it.** Every line below is');
  lines.push('> written by `' + model.tool.path + '` from the analysed tree named above;');
  lines.push('> an edit made here is lost on the next run and, worse, is indistinguishable');
  lines.push('> from a measurement while it survives. To change what this document says,');
  lines.push('> change the generator or the tree and re-run the exact command in the');
  lines.push('> provenance block.');
  lines.push('>');
  if (model.tree.isBaselineCommit) {
    lines.push('> The analysed tree is an untouched worktree at the R-f baseline commit, which');
    lines.push('> is what makes every *current* disposition below a baseline fact rather than a');
    lines.push('> reading of the converted tree. Recreate it with');
    lines.push('> `git worktree add --detach <path> ' + BASELINE_COMMIT.slice(0, 7) + '`; it needs no install,');
    lines.push('> because this generator requires nothing but Node core and reads the');
    lines.push('> controllers as text.');
    lines.push('>');
  }
  lines.push('> The HEAD above is the commit whose sources these rows describe, which is');
  lines.push('> the commit BEFORE the one that carries this file: generating the document');
  lines.push('> and committing it cannot happen in the same revision. Regenerating after');
  lines.push('> that commit changes this one line and nothing else, because the annotation');
  lines.push('> beside it is scoped to the analysed sources rather than to the whole');
  lines.push('> checkout - so an uncommitted controller edit is reported here, and an');
  lines.push('> uncommitted document is not.');
  lines.push('>');
  lines.push('> Everything in this file, including the block above, is a pure function of');
  lines.push('> the analysed commits. There is no wall clock in it and no path from the');
  lines.push('> machine that produced it, so two runs over the same commits - on any two');
  lines.push('> machines - produce byte-identical output and `diff` reviews the tree');
  lines.push('> rather than the run. The volatile physical detail of a run is written by');
  lines.push('> `--provenance-out` to a sidecar, which is not this artifact.');
  return lines;
}

function renderPreamble(model) {
  const lines = [];
  lines.push('');
  lines.push('## 1. What this is, and what its length does not mean');
  lines.push('');
  lines.push('Rule R-e requires every converted path to preserve its error-to-response');
  lines.push('mapping - same status codes, same error payload shapes. The migration');
  lines.push('preserves three shared funnels verbatim, and that is **necessary but not');
  lines.push('sufficient**: the funnels are reached from hundreds of local branches, each');
  lines.push('branch decides *which* funnel its error reaches, and some reach none. This');
  lines.push('document is one checkbox row per changed error edge, so the claim "the error');
  lines.push('mappings survived" can be inspected rather than asserted.');
  lines.push('');
  lines.push('**The row count is not a target and is not authoritative.** This run emitted ' +
    model.totals.rows + ' rows over ' + model.totals.files + ' files. A different tree');
  lines.push('yields a different number, and that is the intended behaviour: conversion');
  lines.push('closes rows.');
  lines.push('');
  if (model.closure) {
    const sum = model.closure.summary;
    const open = sum.changed + sum.missing + sum.added;
    lines.push('**' + (sum.closed + sum.approved) + ' of the ' + sum.baselineRows +
      ' baseline edges are closed** against this tree, and **' + open + '** are not.');
    lines.push('A row is closed when the edge produces the same observable outcome on both');
    lines.push('trees - same funnel, same served status, same answers-or-does-not - so a');
    lines.push('ticked box is a comparison and not an opinion. Section ' +
      model.sections.closure + ' lists every open');
    lines.push('row with both outcomes side by side, and section ' + model.sections.coverage +
      ' says which rows a');
    lines.push('measured request actually reached, because a closed row is a reading of two');
    lines.push('trees and not a response anyone observed.');
  } else {
    lines.push('**No row in this run is closed, because closure is a comparison and this run');
    lines.push('analysed one tree.** Section ' + model.sections.closure +
      ' gives the command that produces the');
    lines.push('comparison. An unticked box here means "not compared", not "not preserved".');
  }
  lines.push('');
  lines.push('### What is in scope, and what deliberately is not');
  lines.push('');
  lines.push('The analysed surface is the ' + ANALYSIS_TARGETS.length + ' files hapi itself invokes into: the ten');
  lines.push('controllers, the named pre-handlers in `' + HELPERS_FILE + '`, and the one');
  lines.push('inline pre-handler in `' + INLINE_PRE_FILE + '`. Every one of them is read,');
  lines.push('and a file with no row says so in its own section rather than being omitted.');
  lines.push('');
  lines.push('Nothing else is reviewed. Rule R-a requires the diff to read as a runtime bump,');
  lines.push('a hapi API migration, an async conversion and blocking-only dependency swaps -');
  lines.push('so this is a record of the error edges **that conversion moves**, not a general');
  lines.push('audit of the application\'s error handling. The internal callback modules keep');
  lines.push('their callback interfaces under rule T-3, which puts the `await` boundary at the');
  lines.push('lifecycle method rather than pushing it into the utility, so their internal');
  lines.push('error edges are not conversion sites and carry no row here. Where a converted');
  lines.push('handler awaits one of them, the edge that appears below is the handler\'s own.');
  lines.push('');
  lines.push('### The sizing metric is not the row count');
  lines.push('');
  lines.push('AAP 0.1.1.1 records **' + BASELINE_COUNTS.errParamFunctionsSizingMetric +
    ' functions with an `err` parameter** in `lib/controllers/**`. That figure is a');
  lines.push('**sizing metric and nothing else.** A crude grep over the baseline tree returns');
  lines.push('133 rather than 132 depending on the pattern, which is itself the point:');
  lines.push('');
  lines.push('- one callback can carry **zero** error dispositions - it never inspects `err` -');
  lines.push('  or **several**: a guard, a log, and a late resolve;');
  lines.push('- promise `.catch` handlers and synchronous `throw` statements add edges');
  lines.push('  **entirely outside** that count;');
  lines.push('- a `reply(` site is an error edge only when what it carries is an error, and at');
  lines.push('  baseline 61 of the 202 sites carry success payloads.');
  lines.push('');
  lines.push('This run counted ' + model.counts.errParamFunctions + ' `err`-parameter functions in the ten controllers and');
  lines.push('emitted ' + model.totals.rows + ' rows. Neither number derives from the other. Do not read the row');
  lines.push('count as a coverage figure for the sizing metric, or the sizing metric as a');
  lines.push('target for the row count.');
  return lines;
}

function renderFunnels(model) {
  const f = model.funnels;
  const lines = [];
  lines.push('');
  lines.push('## 2. The three shared funnels');
  lines.push('');
  lines.push('Every row names the funnel its edge reaches. Line ranges below are read from');
  lines.push('the analysed tree, not quoted from the plan, so they are correct for whichever');
  lines.push('tree this document describes.');
  lines.push('');
  lines.push('### Layer 1 - the handler catch-all, `' + f.layer1.file + ':' +
    f.layer1.startLine + '-' + f.layer1.endLine + '`');
  lines.push('');
  lines.push('Logs `err.stack` when present, else `String(err)`, and returns');
  lines.push('`Boom.badImplementation(err.message || String(err))` - so **500**. After the');
  lines.push('async conversion this becomes structural: a rejecting `async` handler lands');
  lines.push('here without anything having to call it.');
  lines.push('');
  lines.push('Two properties of this block decide many rows below.');
  lines.push('');
  lines.push('1. **The `if (err)` guard at `:' + (f.layer1.guardLine || f.layer1.startLine) +
    '` is preserved.** A falsy throw satisfies the `catch` but');
  lines.push('   fails the guard, so the block produces **no return**, and hapi\'s toolkit');
  lines.push('   converts that `undefined` into the same status with a different message.');
  lines.push('2. **It does not test `isBoom`' + (f.layer1.hasIsBoomTest ? ' - but this tree contains an `isBoom` reference inside the block, so re-read it before relying on the next sentence' : '') + '.** A `throw Boom.notFound()` inside a');
  lines.push('   handler is therefore answered **500** with Boom\'s hidden 5xx body, not 404,');
  lines.push('   while `return Boom.notFound()` is answered 404. Same value, different verb,');
  lines.push('   different status. Rows distinguish the two.');
  lines.push('');
  lines.push('### Layer 2 - `request.fail`, `' + f.layer2.file + ':' +
    f.layer2.startLine + '-' + f.layer2.endLine + '`');
  lines.push('');
  lines.push('Logs at info level, then selects one of three responses:');
  lines.push('');
  lines.push('- negotiated `html` **and** a configured `fail.redirect`: flashes `failure`' +
    (f.layer2.flashFailureLine ? ' (`:' + f.layer2.flashFailureLine + '`)' : '') + ',');
  lines.push('  **interpolates `fail.redirect` in place**' +
    (f.layer2.interpolateLine ? ' (`:' + f.layer2.interpolateLine + '`)' : '') +
    ' - the cross-request state leak,');
  lines.push('  because the object being mutated was captured once at parse time - flashes');
  lines.push('  `payload` and `query`, and redirects;');
  lines.push('- negotiated `html`, a configured `fail.html` and no `.json` extension on the');
  lines.push('  path: renders that view after `addUserContext`;');
  lines.push('- otherwise: defaults the payload to `{}`, attaches `json.flash`, and returns');
  lines.push('  `h.response(json)`.');
  lines.push('');
  lines.push('None of those three is a Boom, so a Layer 2 response takes Layer 3\'s non-Boom');
  lines.push('branch and **does** receive the cache headers.');
  lines.push('');
  lines.push('The in-place interpolation is the **cross-request state leak**: the `fail`');
  lines.push('object was captured once at parse time and the handler closure holds it by');
  lines.push('reference, so the assignment mutates the long-lived object and a later request');
  lines.push('to the same route redirects to the earlier request\'s target. It is catalogued,');
  lines.push('with its measurement and its blast radius, in `' + SIBLING_DOCS.quirks +
    '` section 3.');
  lines.push('R-d requires it: rows on this funnel preserve the mutation rather than');
  lines.push('repairing it.');
  lines.push('');
  lines.push('### Layer 3 - `onPreResponse`, `' + f.layer3.file + ':' +
    f.layer3.startLine + '-' + f.layer3.endLine + '`');
  lines.push('');
  lines.push('For a Boom response it computes `isApiRequest`' +
    (f.layer3.apiTestLine ? ' at `:' + f.layer3.apiTestLine + '`' : '') + ' from three tests: a path');
  lines.push('beginning `/api/`, an `Accept` containing `application/json`, or a path');
  lines.push('beginning `/partials/`.');
  lines.push('');
  lines.push('**Branch order matters, and the code\'s shape misleads on it.** For a browser');
  lines.push('HTML request the extension **returns immediately** on 401 (`h.redirect(\'/login\')`');
  lines.push('with `.takeover()`' + (f.layer3.redirect401Line ? ' at `:' + f.layer3.redirect401Line + '`' : '') +
    '), on 404, on 403 and on any status >= 500 -');
  lines.push('**before** the header assignments' +
    (f.layer3.boomHeaderLine ? ' that begin at `:' + f.layer3.boomHeaderLine + '`' : '') + '. So:');
  lines.push('');
  lines.push('- `Cache-Control`, `Pragma`, `Expires` and the conditional `X-Frame-Options`');
  lines.push('  reach **API/JSON error responses and non-Boom responses only**' +
    (f.layer3.nonBoomHeaderLine ? ' (the non-Boom branch re-applies them at `:' + f.layer3.nonBoomHeaderLine + '`)' : '') + ';');
  lines.push('- they do **not** reach the rendered HTML error pages;');
  lines.push('- a Boom status outside that set - a **400**, for instance - falls through the');
  lines.push('  early returns and **does** receive them.');
  lines.push('');
  lines.push('This is a correction R-e forced on an earlier reading of the code\'s shape. It');
  lines.push('is stated here so nobody re-derives it wrongly from the source order.');
  lines.push('');
  if (f.xframePaths) {
    lines.push('`X-Frame-Options: deny` applies only to the ' + f.xframePaths.entries.length +
      ' paths at `' + f.xframePaths.file + ':' +
      f.xframePaths.startLine + '-' + f.xframePaths.endLine + '`: ' +
      f.xframePaths.entries.map(code).join(', ') + '.');
  } else {
    lines.push('`X-Frame-Options: deny` applies only to the paths listed under `app.xframeDeny`');
    lines.push('in the configuration; that key was not found in the analysed tree.');
  }
  lines.push('');
  // The pre-handler contract, read from the analysed tree.
  //
  // `convertPreHandlers` SURVIVES the migration - rule T-2 reshapes it into a
  // pass-through for native lifecycle methods and keeps the string-form
  // dispatcher - so its presence proves nothing about the semantics. What
  // decides them is whether the RESPONSE EMULATION is still there, and the
  // two contracts disagree about the outcome and not merely the mechanism:
  // the shim RESOLVED a non-Boom Error and produced no response at all, while
  // hapi boomifies the same value and answers 500. Describing the shim while
  // reporting a converted tree's rows therefore stated the opposite of the
  // truth on the sharpest case on this surface.
  const shim = f.preShim && f.preShim.emulationPresent;
  lines.push('### Not a funnel, but decisive: how a pre-handler error is answered' +
    (f.preShim ? ', `' + f.preShim.file + ':' + f.preShim.startLine + '-' + f.preShim.endLine + '`' : ''));
  lines.push('');
  lines.push('Pre-handlers are not invoked by the handler wrapper, so **their errors never');
  lines.push('reach Layer 1**. What answers them instead depends on whether the analysed');
  lines.push('tree still carries the response emulation, and this tree ' +
    (shim ? '**does**.' : '**does not**.'));
  lines.push('');
  if (shim) {
    lines.push('They go through `convertPreHandlers`, whose `fakeReply`:');
    lines.push('');
    lines.push('- **rejects** on an `isBoom` value, so that Boom keeps its own status and');
    lines.push('  reaches Layer 3 through hapi\'s own lifecycle error handling;');
    lines.push('- **resolves** on anything else, *including a plain `Error`*. So `reply(err)`');
    lines.push('  in a pre-handler with a non-Boom error resolves the pre-handler with the');
    lines.push('  error object as its assigned value: the request continues, `request.pre.<assign>`');
    lines.push('  holds an `Error`, and **no error response is produced at all**.');
    lines.push('');
    lines.push('A synchronous `throw` inside a pre-handler is caught by the shim and rejected,');
    lines.push('so a thrown Boom keeps its status there while the same statement in a handler');
    lines.push('would be flattened to 500 by Layer 1. Rows on the two surfaces read');
    lines.push('differently for that reason.');
    if (f.preShim && f.preShim.fakeReplyLines.length) {
      lines.push('');
      lines.push('The shim is written twice - once for the object pre-handler form and once for');
      lines.push('the bare-function form - with a `fakeReply` at ' +
        f.preShim.fakeReplyLines.map(function (line) {
          return '`:' + line + '`';
        }).join(' and ') + '. Both behave identically for');
      lines.push('the purposes above.');
    }
  } else {
    lines.push('`convertPreHandlers` passes a function-valued pre-handler to hapi as it is,');
    lines.push('so hapi\'s own contract applies. Read from the installed framework rather');
    lines.push('than remembered:');
    lines.push('');
    lines.push('- a returned or thrown **Boom** keeps its own status. `Response.wrap` returns');
    lines.push('  it unchanged, `isBoom` routes it to the route\'s pre `failAction`, and the');
    lines.push('  default `\'error\'` throws it - so **Layer 3** answers with that status');
    lines.push('  (`@hapi/hapi/lib/handler.js`, the `if (response.isBoom)` branch of the pre');
    lines.push('  path).');
    lines.push('- a returned **plain `Error`** is **not** resolved as the pre value. It is');
    lines.push('  boomified - `Response.wrap` calls `Boom.boomify` on any `Error` - and then');
    lines.push('  takes the same path, so the request is answered **500** through Layer 3.');
    lines.push('  **This is where the two contracts differ, and it is the reason a');
    lines.push('  pre-handler that used to hand an `Error` on as its assigned value must');
    lines.push('  now return a non-`Error` value to keep the request continuing.**');
    lines.push('- returning **`undefined`** - falling off the end of the function - becomes');
    lines.push('  `Boom.badImplementation`, so a pre-handler with nothing to contribute must');
    lines.push('  `return null`, which is a pre value of `null` and not an error.');
    lines.push('');
    lines.push('The string form is not a lifecycle method at all: the dispatcher wraps it in');
    lines.push('its own `async (request, h)` and returns `serverMethod.apply(null, args)`, so');
    lines.push('a server method\'s throw rejects that wrapper and reaches Layer 3 the same');
    lines.push('way. Rows on the `' + SURFACE.SERVER_METHOD + '` surface say so.');
  }
  return lines;
}

function renderSilentChanges() {
  return [
    '',
    '## 3. Two dispositions a mechanical conversion changes silently',
    '',
    'These two are called out because converting them correctly looks like',
    'converting them wrongly. Both appear as row dispositions below.',
    '',
    '### log-and-continue',
    '',
    'The handler logs and **returns nothing**, so the surrounding flow continues and',
    'this edge produces no response. Mechanically converting such a handler into a',
    'rejection - or into a returned Boom - turns an edge that produces no response',
    'into one that does, and changes what a client receives from whatever else',
    'settles the request into a 500.',
    '',
    'The clearest instance is the streaming asset fetch, whose `error` listener only',
    '`console.log`s. Two measured details belong with it, because they are different',
    'failure modes with different outcomes:',
    '',
    '- a **refused connection** emits `error` and **not** `end`, so the upload',
    '  continuation never runs, **nothing is uploaded at all**, and the request is',
    '  left **unsettled**. An earlier reading of this site had it uploading partial',
    '  bytes; that was wrong, and the distinction matters because the two failure',
    '  modes need different fixtures and produce different observable results;',
    '- a **mid-stream failure after `response`** may still reach `end`, so *there*',
    '  the continuation does run, on a partial file.',
    '',
    'Both are baseline behaviour and both are preserved.',
    '',
    '### resolve-on-later-callback',
    '',
    'The response is produced inside a continuation-passing callback, so it settles',
    'only when that operation calls back, and what a client receives today is',
    'whichever settlement wins. These must **not** be collapsed into an earlier',
    '`await`: rule T-3 puts the await boundary at the call site, and moving the',
    'settlement earlier can change the response itself. Where such a callback also',
    'declares no error parameter, the operation\'s own failure is dropped, and the row',
    'says so.'
  ];
}

function renderHowToRead(model) {
  const lines = [];
  lines.push('');
  lines.push('## ' + model.sections.howToRead + '. How to read a row');
  lines.push('');
  lines.push('```');
  lines.push('  ... - [ ] `<file>:<line>` - <Disposition> - <Funnel> - <Shape>');
  lines.push('  ...       Carrier <reachable code path> - Routes <bound routes> - Source <the line>');
  lines.push('  ...       Target: <the outcome to preserve, ending in Side effects and Timing>');
  lines.push('  ...       Note: <a measured detail, when there is one>');
  lines.push('  ...       See also: <the sibling document that catalogues this edge>');
  lines.push('```');
  lines.push('');
  lines.push('A real row is a line beginning `- [ ] ` or `- [x] ` at column 0, and its');
  lines.push('continuation lines are indented six spaces and begin `Carrier `, `Target: `,');
  lines.push('`Closure: `, `Driven: `, `Note: ` or `See also: `. Every line of the sketch');
  lines.push('above carries a `... ` prefix that a real row does not, so counting lines');
  lines.push('matching `^- \\[[ x]\\] ` returns the row count this document states and');
  lines.push('nothing else - the sketch does not inflate it by one.');
  lines.push('');
  lines.push('### The join contract');
  lines.push('');
  lines.push('**Every row carries a stable id**, printed in the row as `` `id=...` `` and');
  lines.push('shaped `<file>.<carrier>.<class>.<ordinal>`. It deliberately contains no');
  lines.push('line number, no disposition and no funnel, because conversion changes all');
  lines.push('three: a `reply(err)` site becomes `return errors.notFound()` and moves from');
  lines.push('`' + DISPOSITION.REPLY_ERR + '` to `' + DISPOSITION.BOOM + '`, so an id');
  lines.push('carrying either would never match its own target row - and matching a');
  lines.push('baseline row to its target row is the one comparison the id exists to make.');
  lines.push('');
  lines.push('That id is the join key in both directions:');
  lines.push('');
  lines.push('| Consumer | How it joins |');
  lines.push('|---|---|');
  lines.push('| a reviewer | `grep \'id=<the id>\'` in this file |');
  lines.push('| `test/parity/capture.js` | put the id in a scenario\'s **`coversEdges`** array - NOT in `covers`; this generator then reports that row as **edge-level** driven |');
  lines.push('| `test/parity/replay.js`, or any tool | read the machine-readable index this generator writes with `--edge-index <path>`: schema `trinket-oss/error-edge-index@2`, holding one record per TARGET row and one per BASELINE row, each with the id, file, carrier, surface, class, disposition, funnel, served status, the dimensions that differ, the closure verdict and the driver - plus an `unpaired` block naming every row missing from the target, new in the target, ambiguous, or proven unreachable |');
  lines.push('');
  lines.push('**`coversEdges`, and not `covers`.** `test/parity/capture.js` validates every');
  lines.push('`covers` entry against the route manifest and reports anything that is not a');
  lines.push('declared route as `unknownRoutes`, which it treats as a defect in its own');
  lines.push('tables. So a scenario naming an edge id in `covers` fails the producer, and');
  lines.push('an earlier edition of this document told authors to put them there - a join');
  lines.push('contract the producer cannot satisfy. `coversEdges` is a field capture.js');
  lines.push('does not read, so a scenario carries it without tripping that validation,');
  lines.push('and it is the field this generator names. The change that closes the join is');
  lines.push('one line per scenario in the `error-edge.*` groups of');
  lines.push('`test/parity/capture.js` - `coversEdges: [\'<edge id>\']` alongside the');
  lines.push('existing route-keyed `covers` - and that file belongs to the');
  lines.push('capture-scenario unit, not to this generator. Until it lands, edge-level');
  lines.push('coverage is 0 and section ' + model.sections.coverage + ' reports route-level coverage instead,');
  lines.push('which is weaker: a scenario that reaches a route does not establish that it');
  lines.push('reached a particular error branch within it.');
  lines.push('');
  lines.push('So this document is no longer the only carrier of its own contents, and a');
  lines.push('consumer never has to parse the prose. The previous edition of this file');
  lines.push('said "Nothing machine-reads this document", and that was the problem rather');
  lines.push('than a design note: with 341 rows and no key, the corpus could not state');
  lines.push('which edge a scenario reached, and no tool could report that a changed edge');
  lines.push('had never been driven.');
  lines.push('');
  lines.push('**Disposition** is a closed vocabulary and every row carries exactly one');
  lines.push('value from it. Six of the values are the ones AAP 0.6.3 enumerates:');
  lines.push('');
  AAP_DISPOSITIONS.forEach(function (value) {
    lines.push('- `' + value + '`');
  });
  lines.push('');
  lines.push('The seventh is an addition this generator makes, and it is called out rather');
  lines.push('than slipped in:');
  lines.push('');
  lines.push('- `' + DISPOSITION.PROPAGATE + '`');
  lines.push('');
  lines.push('It exists because none of the six describes a callback that hands its error');
  lines.push('to an outer continuation - `reject(err)`, `resolve({err : err, ...})`,');
  lines.push('`next(err)` - and R-e\'s deliverable is worth having only if its rows are');
  lines.push('true. Filing such an edge under `' + DISPOSITION.SWALLOW + '` states two');
  lines.push('false things at once: that the error is absorbed, and that no response can');
  lines.push('follow from it. Filing a callback that logs *and* rejects under');
  lines.push('`' + DISPOSITION.LOG_CONTINUE + '` states a third, that the normal path');
  lines.push('continues, when the continuation is a rejection. The value takes precedence');
  lines.push('over both, and each such row names the vehicle and the line so the hop can');
  lines.push('be checked against the source.');
  lines.push('');
  lines.push('**Shape** carries the sub-shape that six values cannot express - `reply(err)`');
  lines.push('with no return, a bare `.catch(request.fail)` reference, a synchronous throw, a');
  lines.push('CPS callback boundary. Shape is descriptive and open; Disposition is closed.');
  lines.push('');
  lines.push('**Funnel** is `' + FUNNEL.L1 + '`, `' + FUNNEL.L2 + '`, `' + FUNNEL.L3 +
    '` or `' + FUNNEL.NONE + '`. `' + FUNNEL.NONE + '` is a legitimate and');
  lines.push('important value: an edge that produces no response at all is the edge most');
  lines.push('likely to be given one by accident.');
  lines.push('');
  lines.push('**Target** states the outcome to **preserve** - status, payload or redirect,');
  lines.push('side effects, timing. **No row proposes a fix.** R-d prohibits improvements, so');
  lines.push('where the baseline outcome is a defect the row requires the defect.');
  lines.push('');
  lines.push('**Carrier** is the reachable code path - the exported handler or pre-handler');
  lines.push('the edge sits in - and **Routes** are the literal route declarations that bind');
  lines.push('it. Every row carries a carrier, so every row is drivable; see section ' +
    model.sections.drivability + '.');
  lines.push('');
  lines.push('**See also** appears on a row whose edge is also catalogued elsewhere, and is');
  lines.push('the only form of duplication this document permits.');
  lines.push('');
  lines.push('### What this document does not own');
  lines.push('');
  lines.push('Three documents describe the same edges from different angles, and each claim');
  lines.push('belongs to exactly one of them:');
  lines.push('');
  lines.push('| Document | Owns |');
  lines.push('|---|---|');
  lines.push('| this document | the per-edge status, payload or redirect, side effects and timing, and the funnel each edge must still reach |');
  lines.push('| `' + SIBLING_DOCS.quirks + '` | why a baseline defect is kept, its measurement, and the two approved deviations |');
  lines.push('| `' + SIBLING_DOCS.conversion + '` | the per-site return/await disposition for every handler body the conversion touches |');
  lines.push('');
  lines.push('So a row states the outcome to preserve and points at the quirk catalogue for');
  lines.push('the reasoning; it does not restate it. Every row whose Target carries the');
  lines.push('return-discipline sentence is also a conversion site, and the call sites where');
  lines.push('a missing `return` is what makes the conversion decisive carry an explicit');
  lines.push('`See also` to `' + SIBLING_DOCS.conversion + '`.');
  return lines;
}

function renderCounts(model) {
  const lines = [];
  lines.push('');
  lines.push('## ' + model.sections.counts + '. Token counts in the analysed tree');
  lines.push('');
  lines.push('The scanner\'s counts against the figures measured at `' +
    BASELINE_COMMIT.slice(0, 7) + '` with `grep -o | wc -l`,');
  lines.push('which is an independent witness because it does not use the scanner.');
  lines.push('');
  lines.push('| Token | Baseline | This tree | |');
  lines.push('|---|---:|---:|---|');
  model.check.comparisons.forEach(function (row) {
    lines.push('| ' + row.label + ' | ' + row.expected + ' | ' + row.observed + ' | ' +
      (row.observed === row.expected ? 'match' : 'differs') + ' |');
  });
  lines.push('| `function (request, reply)` declarations (fingerprint) | ' +
    BASELINE_COUNTS.legacyHandlerDeclarations + ' | ' + model.counts.legacyHandlerDeclarations + ' | |');
  lines.push('| `function (request, h)` declarations | 2 | ' +
    model.counts.toolkitHandlerDeclarations + ' | |');
  lines.push('');
  lines.push('**Those are CALL-SITE counts, and they are not error-edge counts.** The');
  lines.push('distinction is not pedantry: a `reply(` site is an error edge only when what');
  lines.push('it carries is an error, and the table above counts the token either way.');
  lines.push('`' + INLINE_PRE_FILE + '` is the clearest case. It contributes exactly one');
  lines.push('`reply(` site, which is why the row above reads ' +
    BASELINE_COUNTS.replyInlinePre + ' - and that site is');
  lines.push('`return reply(true)`, an inline pre-handler answering with a boolean. It');
  lines.push('carries no error, so it produces **no error-edge row**, and the file\'s');
  lines.push('section below correctly holds none. A reconciliation that treated the site');
  lines.push('count as evidence of edge coverage would have reported that file as covered');
  lines.push('on the strength of a row that does not exist.');
  lines.push('');
  lines.push('| | Sites (tokens) | Error-edge rows |');
  lines.push('|---|---:|---:|');
  lines.push('| `lib/controllers/*.js` | ' + model.counts.replyControllers + ' `reply(` | ' +
    model.allEdges.filter(function (edge) {
      return CONTROLLER_FILES.indexOf(edge.file) !== -1;
    }).length + ' |');
  lines.push('| `' + HELPERS_FILE + '` | ' + model.counts.replyHelpers + ' `reply(` | ' +
    model.allEdges.filter(function (edge) {
      return edge.file === HELPERS_FILE;
    }).length + ' |');
  lines.push('| `' + INLINE_PRE_FILE + '` | ' + model.counts.replyInlinePre + ' `reply(` | ' +
    model.allEdges.filter(function (edge) {
      return edge.file === INLINE_PRE_FILE;
    }).length + ' |');
  lines.push('');
  if (model.check.applied) {
    lines.push('The counts were **asserted** on this run' +
      (model.check.mode === 'strict'
        ? ' because `--counts-check=strict` was passed.'
        : ' because ' + model.check.detectionReasons.join(' and ') + '.'));
    lines.push('A mismatch would have failed the run rather than emitting a quietly');
    lines.push('incomplete inventory.');
  } else {
    lines.push('The counts were **reported, not asserted**' +
      (model.check.mode === 'off'
        ? ' because `--counts-check=off` was passed.'
        : ' because the analysed tree was not detected as the baseline: the' +
          ' legacy-handler fingerprint is ' + model.counts.legacyHandlerDeclarations +
          ' against a floor of ' + LEGACY_FINGERPRINT_FLOOR + ', its HEAD is not the' +
          ' baseline commit, and the token counts already differ.'));
    lines.push('A differing count here is the conversion, not a scanner fault: the legacy');
    lines.push('idiom is what these tokens measure and removing it is the work. The');
    lines.push('scanner\'s own correctness is guaranteed independently, by ' +
      model.selfTests + ' self-tests that');
    lines.push('run on every invocation and include the regex-literal-with-quotes hazard.');
  }
  return lines;
}

function renderSummary(model) {
  const lines = [];
  lines.push('');
  lines.push('## ' + model.sections.summary + '. Summary');
  lines.push('');
  lines.push('| File | Rows | ' + DISPOSITION_ORDER.join(' | ') + ' |');
  lines.push('|---|---:|' + DISPOSITION_ORDER.map(function () {
    return '---:';
  }).join('|') + '|');
  model.files.forEach(function (file) {
    const cells = DISPOSITION_ORDER.map(function (value) {
      return String(file.edges.filter(function (edge) {
        return edge.disposition === value;
      }).length);
    });
    lines.push('| `' + file.relPath + '` | ' + file.edges.length + ' | ' + cells.join(' | ') + ' |');
  });
  const totalCells = DISPOSITION_ORDER.map(function (value) {
    return String(model.allEdges.filter(function (edge) {
      return edge.disposition === value;
    }).length);
  });
  lines.push('| **total** | **' + model.totals.rows + '** | ' + totalCells.join(' | ') + ' |');
  lines.push('');
  lines.push('| Funnel | Rows |');
  lines.push('|---|---:|');
  [FUNNEL.L1, FUNNEL.L2, FUNNEL.L3, FUNNEL.NONE].forEach(function (value) {
    lines.push('| ' + value + ' | ' + model.allEdges.filter(function (edge) {
      return edge.funnel === value;
    }).length + ' |');
  });
  lines.push('');
  lines.push('Rows reaching **no funnel**: ' + model.allEdges.filter(function (edge) {
    return edge.funnel === FUNNEL.NONE;
  }).length + '. Each of those is an error that produces no');
  lines.push('response today, and each must still produce none after conversion.');

  // Closure per file, so the open rows cannot hide inside an aggregate.
  if (model.closure) {
    lines.push('');
    lines.push('| File | Rows | Closed | Open |');
    lines.push('|---|---:|---:|---:|');
    model.files.forEach(function (file) {
      let closed = 0;
      let open = 0;
      file.edges.forEach(function (edge) {
        const row = model.closure.byTargetId.get(edge.id);
        if (row && (row.closure === CLOSURE.CLOSED || row.closure === CLOSURE.APPROVED)) {
          closed++;
        } else {
          open++;
        }
      });
      lines.push('| `' + file.relPath + '` | ' + file.edges.length + ' | ' + closed +
        ' | ' + (open || '-') + ' |');
    });
    lines.push('');
    lines.push('Counted over the rows THIS tree emits. Section ' + model.sections.closure +
      ' counts over the baseline\'s');
    lines.push(model.closure.summary.baselineRows + ' rows as well, so it also carries the ' +
      model.closure.summary.missing + ' baseline edge(s) that have no row');
    lines.push('here at all - which no per-file count over this tree could show.');
  }
  return lines;
}

/**
 * What was proven about this row's target, in one line.
 *
 * Every row gets one, including the rows that were not compared, because "no
 * comparison was run" is itself the fact a reader needs when the box is
 * empty.
 */
function closureLine(model, edge, row) {
  if (!model.closure) {
    return 'not compared - this run analysed one tree. Pass `--baseline <path>` ' +
      'to join each row to its target row and close it, or `--closure-gate` to ' +
      'make an unclosed row fatal.';
  }
  if (!row) {
    return 'no comparison row - this edge was not present in the join, which is ' +
      'a defect in the join rather than a fact about the edge. Re-run the ' +
      'comparison and treat this row as unverified until it appears.';
  }
  const via = row.matchedBy && row.matchedBy !== 'identity'
    ? ' Matched by ' + row.matchedBy + ' rather than by identity, so confirm the ' +
      'pairing before relying on it.'
    : '';
  if (row.closure === CLOSURE.CLOSED) {
    return 'CLOSED. Baseline and target both produce ' +
      outcomeText(row.targetOutcome) + ', measured at `' +
      lineRef(row.baseline) + '` and `' + lineRef(row.target) + '`.' + via;
  }
  if (row.closure === CLOSURE.APPROVED) {
    return 'CLOSED by approved deviation. Baseline produced ' +
      outcomeText(row.baselineOutcome) + ' and the target produces ' +
      outcomeText(row.targetOutcome) + ', which is the change approved for ' +
      'this exact edge.' + via;
  }
  if (row.closure === CLOSURE.CHANGED) {
    return '**OPEN - the outcome changed.** Baseline produced ' +
      outcomeText(row.baselineOutcome) + '; the target produces ' +
      outcomeText(row.targetOutcome) + '. R-e requires these to match, and no ' +
      'approved deviation names this edge.' + via;
  }
  if (row.closure === CLOSURE.MISSING) {
    return '**OPEN - no target row.** Nothing in the target tree matched `' +
      row.id + '`, so this baseline edge has either been removed or moved to a ' +
      'carrier or class this join cannot follow. Either is a state to resolve ' +
      'by hand.';
  }
  if (row.closure === CLOSURE.ADDED) {
    return '**OPEN - new in the target.** No baseline row matched this edge, so ' +
      'there is no baseline fact to preserve and nothing has been verified ' +
      'about it. Conversion may legitimately introduce a site; this row is ' +
      'where that introduction is reviewed.';
  }
  return row.closure;
}

/** Which corpus scenarios drive this row. */
function coverageLine(model, edge) {
  if (!model.scenarios) {
    return 'not joined - pass `--scenarios <corpus.json>` to join this row to ' +
      'the capture corpus, or `--coverage-gate` to make an undriven changed ' +
      'edge fatal.';
  }
  const coverage = coverageFor(edge, model.scenarios);
  if (coverage.level === 'edge-level') {
    return 'edge-level, by ' + coverage.scenarios.map(code).join(', ') +
      ' - a scenario that names this edge id.';
  }
  if (coverage.level === 'route-level') {
    return 'route-level only, by ' + coverage.scenarios.slice(0, 4).map(code).join(', ') +
      (coverage.scenarios.length > 4 ? ' and ' + (coverage.scenarios.length - 4) + ' more' : '') +
      '. Those scenarios drive the route, which is not the same as reaching ' +
      'this failure branch: only an `error-edge.*` scenario naming `id=' +
      edge.id + '` proves the branch was exercised.';
  }
  return '**not driven.** No corpus scenario names this edge id or its routes, ' +
    'so its target outcome above is a reading of the code and not a measured ' +
    'response.';
}

function renderInventory(model) {
  const lines = [];
  lines.push('');
  lines.push('## ' + model.sections.inventory + '. The inventory');
  lines.push('');
  lines.push('Grouped by file, then by line. Re-running produces a reviewable diff, not a');
  lines.push('reshuffle.');
  model.files.forEach(function (file, fileIndex) {
    lines.push('');
    lines.push('### ' + model.sections.inventory + '.' + (fileIndex + 1) + ' `' + file.relPath + '` - ' +
      file.edges.length + ' row' + (file.edges.length === 1 ? '' : 's'));
    lines.push('');
    if (file.edges.length === 0) {
      lines.push('No error edge detected in this file. The scanner counted ' +
        file.counts.replyLiteral + ' `reply(` site(s), ' +
        file.counts.catchLiteral + ' `.catch(` site(s) and ' +
        file.counts.errParamFunctions + ' `err`-parameter function(s) here, and');
      lines.push('classified every one of them as carrying a non-error value: the file was');
      lines.push('analysed, not skipped.');
      return;
    }
    file.edges.forEach(function (edge) {
      const row = model.closure ? model.closure.byTargetId.get(edge.id) : null;
      // The box is ticked only when closure was PROVEN, and the Closure line
      // below always states on what. A row with no comparison available is
      // unchecked and says why, rather than being unchecked with no
      // explanation - which is what 341 rows of `- [ ]` amounted to.
      // A TICK MEANS PROVED, and it means nothing else. Three things can make
      // it false, and all three used to be able to coexist with a tick:
      // the closure comparison did not close the row; the row's reachability
      // or caller could not be resolved, so its own facts are provisional;
      // or the edge is proven unreachable, in which case there is no outcome
      // on either tree and "closed" would be parity of nothing against
      // nothing. Six rows saying `confirm this row by hand before closing it`
      // were nonetheless ticked in an earlier edition.
      const closed = Boolean(row) &&
        (row.closure === CLOSURE.CLOSED || row.closure === CLOSURE.APPROVED) &&
        !edge.unresolved && !edge.unreachableProven;
      lines.push('- [' + (closed ? 'x' : ' ') + '] `' + lineRef(edge) + '` `id=' +
        edge.id + '` - **' + edge.disposition + '** - ' +
        funnelField(edge) + ' - ' + escapeInline(edge.shape).replace(/\\\|/g, '|'));
      const context = ['Carrier `' + edge.carrier + '` (' + edge.surface + ')'];
      context.push(edge.routes.length
        ? 'Routes ' + edge.routes.map(code).join(', ') +
          (edge.routedVia ? ' (bound on `' + edge.routedVia + '`, which encloses this one)' : '')
        : 'Routes none declared - driven by ' + driveDescription(edge));
      context.push('Source ' + code(summarise(edge.snippet)));
      lines.push('      ' + context.join(' - '));
      lines.push('      Target: ' + targetText(edge, model.funnels));
      lines.push('      Closure: ' + closureLine(model, edge, row));
      lines.push('      Driven: ' + coverageLine(model, edge));
      edge.notes.forEach(function (note) {
        lines.push('      Note: ' + note);
      });
      crossReferences(edge, model.bindings).forEach(function (reference) {
        lines.push('      See also: ' + reference);
      });
      if (edge.unresolved) {
        lines.push('      **Unresolved:** confirm this row by hand before closing it.');
      }
    });
  });
  return lines;
}

function renderReconciliation(model) {
  const lines = [];
  lines.push('');
  lines.push('## ' + model.sections.reconciliation + '. Locator reconciliation');
  lines.push('');
  lines.push('Locations in this document are measured in the analysed tree. Where a locator');
  lines.push('cited in the plan differs, both are given, so following either finds the same');
  lines.push('edge.');
  lines.push('');
  lines.push('| Cited | Measured | Subject |');
  lines.push('|---|---|---|');
  model.reconciliation.forEach(function (row) {
    lines.push('| `' + escapeInline(row.cited) + '` | ' + cell(row.measured) + ' | ' +
      cell(row.subject) + ' |');
  });
  lines.push('');
  lines.push('A cited locator that matches is listed too: a reader checking the plan against');
  lines.push('this document needs to see the agreement as much as the disagreement.');
  return lines;
}

const DRIVE_MECHANISMS = Object.freeze([
  ['route', 'a bound route declaration'],
  ['pre-handler', 'a lifecycle export bound by at least one route'],
  ['lifecycle-export', 'a lifecycle export hapi can invoke, named by no route here'],
  ['server-method', 'a `server.method` registration, through the string-form dispatcher'],
  ['caller-chain', 'a traced caller - a call, or its value handed on'],
  ['module-load', 'module load, which every require of the file runs'],
  ['unreachable', '**proven unreachable** - the corpus mentions it only where it is declared'],
  ['unresolved', '**nothing resolved** - fatal']
]);

function renderDrivability(model) {
  const count = function (via) {
    return model.allEdges.filter(function (edge) {
      return edge.driveVia === via;
    }).length;
  };
  const unresolved = model.allEdges.filter(function (edge) {
    return edge.driveVia === 'unresolved';
  });
  const unreachable = model.allEdges.filter(function (edge) {
    return edge.driveVia === 'unreachable';
  });
  const accounted = DRIVE_MECHANISMS.reduce(function (total, entry) {
    return total + count(entry[0]);
  }, 0);
  if (accounted !== model.allEdges.length) {
    throw new AnalysisError(
      'the drivability table accounts for ' + accounted + ' of ' +
      model.allEdges.length + ' rows, so ' + (model.allEdges.length - accounted) +
      ' row(s) carry a driveVia value the table does not enumerate. A table ' +
      'with a silent remainder is what let an unreachable row be counted as ' +
      'drivable, so this is fatal rather than a rounding note.'
    );
  }
  const lines = [];
  lines.push('');
  lines.push('## ' + model.sections.drivability + '. Drivability');
  lines.push('');
  lines.push('`test/parity/capture.js`\'s failure-path scenarios are derived from these rows -');
  lines.push('by hand, in its `error-edge.*` groups, not by parsing this file - and');
  lines.push('`test/parity/replay.js` cites this checklist as what supplies the failure paths');
  lines.push('the success sweep cannot reach. A row nothing can drive is not a testable');
  lines.push('edge, so every row names the MECHANISM that reaches it - and where nothing');
  lines.push('does, says so with the search that proves it.');
  lines.push('');
  lines.push('Driveability is a FIELD on each row - `driveVia` - resolved from');
  lines.push('reachability rather than inferred from the row carrying metadata. Two');
  lines.push('earlier versions of this check were dead in the same way, and the second is');
  lines.push('worth stating because it looked like a fix: it tested');
  lines.push('`carrierMember && surface !== module`, which every non-module row satisfies');
  lines.push('by construction, so a function that nothing anywhere calls came back');
  lines.push('drivable. Each value below therefore names something the analysis RESOLVED:');
  lines.push('a route declaration, a `server.method` registration, a lifecycle export, a');
  lines.push('traced caller, module load - or a corpus-wide search returning nothing but');
  lines.push('the declaration itself, which is a proof of unreachability rather than an');
  lines.push('absence of evidence. `unresolved` is fatal in the generator, and that');
  lines.push('assertion is live; so is the check that this table accounts for every row.');
  lines.push('');
  lines.push('| How the row is driven | Rows |');
  lines.push('|---|---:|');
  DRIVE_MECHANISMS.forEach(function (entry) {
    lines.push('| ' + entry[1] + ' | ' + count(entry[0]) + ' |');
  });
  lines.push('');
  if (unreachable.length) {
    lines.push('The **proven unreachable** rows are listed rather than counted. Each was');
    lines.push('searched for across the analysis targets, both route modules, the route');
    lines.push('parser and the bootstrap, and found only at its own declaration. Nothing');
    lines.push('can drive them, so they carry no funnel claim, they are not ticked, and the');
    lines.push('closure gate excludes them - an unreachable edge has no observable outcome,');
    lines.push('so calling it closed would be asserting parity of nothing against nothing:');
    lines.push('');
    unreachable.forEach(function (edge) {
      lines.push('- `' + lineRef(edge) + '` `id=' + edge.id + '` - ' + cell(edge.shape) +
        '. Corpus mentions outside its declaration: 0.');
    });
    lines.push('');
  }
  if (unresolved.length) {
    lines.push('The unresolved rows are listed here rather than counted, because each one');
    lines.push('is a row a failure-path scenario cannot be written against:');
    lines.push('');
    unresolved.forEach(function (edge) {
      lines.push('- `' + lineRef(edge) + '` `id=' + edge.id + '` - ' + cell(edge.shape));
    });
  } else if (unreachable.length) {
    lines.push('No row is unresolved: every row either names a driver or carries the');
    lines.push('search that proves it has none. That is the property that makes this');
    lines.push('checklist convertible into failure-path scenarios - for the ' +
      (model.allEdges.length - unreachable.length) + ' rows that');
    lines.push('have a driver - and it is what keeps the ' + unreachable.length +
      ' that do not out of the gate');
    lines.push('rather than silently inside it.');
  } else {
    lines.push('No row is unresolved and none was proven unreachable, so every row can be');
    lines.push('driven - which is the property that makes this checklist convertible into');
    lines.push('failure-path scenarios at all.');
  }
  lines.push('');
  lines.push('Route bindings are read from the `route :` declarations in ' +
    (model.bindings.modulesRead.length
      ? model.bindings.modulesRead.map(code).join(' and ')
      : 'the route modules, neither of which was present') + '.');
  lines.push('`config/routes.js` expands a subset of those per language at parse time, so the');
  lines.push('registered surface is larger than the declarations named here; the expanded');
  lines.push('route manifest belongs to `test/parity/manifest.js`. A declaration built by');
  lines.push('concatenation is read through the concatenation and rendered with its');
  lines.push('non-literal operands as `<name>`, so `GET /<lang>/{shortCode}` is a template');
  lines.push('standing for one registered route per configured language - not a path with a');
  lines.push('`lang` parameter.');
  lines.push('');
  lines.push('A row whose carrier names no declaration is reached **through a traced');
  lines.push('caller**, and tracing covers indirect dispatch as well as call syntax: a');
  lines.push('function value passed as an argument, stored in an array or object, assigned');
  lines.push('to a `pre` entry, re-exported, or registered with `server.method` is invoked');
  lines.push('somewhere its own name is never followed by a `(`. Recognising only call');
  lines.push('syntax reported such a function as having no caller, which understates its');
  lines.push('reachability in exactly the direction that matters.');
  lines.push('');
  lines.push('| Carrier surface | Rows |');
  lines.push('|---|---:|');
  [SURFACE.HANDLER, SURFACE.PRE, SURFACE.INLINE_PRE, SURFACE.SERVER_METHOD, SURFACE.MODULE].forEach(function (surface) {
    const count = model.allEdges.filter(function (edge) {
      return edge.surface === surface;
    }).length;
    if (count > 0) {
      lines.push('| ' + surface + ' | ' + count + ' |');
    }
  });
  return lines;
}


/**
 * The closure register: what this run PROVED about the target, per row.
 *
 * This section is the answer to "the artifact is generated from the baseline
 * and has zero closed rows, so no target edge's status, payload, side effects
 * or timing is established". It states, mechanically, how many rows were
 * closed and against what, and it names every row that is not - because a
 * count of closed rows is worth nothing if the open ones are invisible.
 */
function renderClosure(model) {
  const lines = [];
  lines.push('');
  lines.push('## ' + model.sections.closure + '. Closure against the target tree');
  lines.push('');

  if (!model.closure) {
    lines.push('**Not run.** This document was generated from one tree, so no row above is');
    lines.push('closed and none of the checkboxes is ticked. That is the honest state of a');
    lines.push('single-tree run and not a defect in the rows: closure is a comparison, and');
    lines.push('a comparison needs two trees.');
    lines.push('');
    lines.push('To produce it, name both:');
    lines.push('');
    lines.push('```');
    lines.push('BASELINE=$(mktemp -d)');
    lines.push('git worktree add --detach "$BASELINE" ' + BASELINE_COMMIT.slice(0, 7));
    lines.push('node ' + TOOL_RELATIVE_PATH + ' --baseline "$BASELINE" --app . \\');
    lines.push('  --out docs/error-edge-inventory.md --scenarios test/parity/corpus.json');
    lines.push('```');
    lines.push('');
    lines.push('Add `--closure-gate` to exit non-zero while any row is unclosed, and');
    lines.push('`--coverage-gate` to exit non-zero while any changed edge is undriven.');
    return lines;
  }

  const sum = model.closure.summary;
  if (sum.baselineAccounted !== sum.baselineRows ||
      sum.targetAccounted !== sum.targetRows) {
    throw new AnalysisError(
      'the closure buckets do not reconcile: ' + sum.baselineAccounted +
      ' of ' + sum.baselineRows + ' baseline rows and ' + sum.targetAccounted +
      ' of ' + sum.targetRows + ' target rows are accounted for. A closure ' +
      'summary that has lost rows overstates itself by exactly the rows it ' +
      'lost, so this is fatal.'
    );
  }
  lines.push('Each row above is joined to the row measuring the same edge on the other');
  lines.push('tree and closed only when the two agree on EVERY dimension R-e names:');
  lines.push('');
  OUTCOME_DIMENSIONS.forEach(function (entry) {
    lines.push('- ' + entry[1]);
  });
  lines.push('');
  lines.push('Comparing the status alone is not closure, and it was what an earlier');
  lines.push('edition of this document compared: 16 rows closed on a matching status');
  lines.push('while their payload, their side effects or their settlement had moved, and');
  lines.push('R-e exists to catch exactly those.');
  lines.push('');
  lines.push('The MECHANISM is deliberately not compared - a `reply(Boom.notFound())` and');
  lines.push('a `return Boom.notFound()` are one outcome by two means, and changing the');
  lines.push('means IS the migration. Keeping the mechanism out took three calibrations,');
  lines.push('each forced by a measurement rather than assumed:');
  lines.push('');
  lines.push('- **Timing** compares whether the edge settles before the carrier returns,');
  lines.push('  later with the carrier waiting, or later with nothing waiting. Naming the');
  lines.push('  vehicle instead - a callback against an awaited chain - reported 54 rows');
  lines.push('  as retimed for having been converted exactly as rule T-3 requires, and');
  lines.push('  reading a registered `.catch` handler\'s declaration site as its');
  lines.push('  settlement moved another 38 from deferred to synchronous.');
  lines.push('- **Produced responses** compare their semantic KIND - a failure response, a');
  lines.push('  success response, a redirect, a rendered view - and not the callee that');
  lines.push('  produced them. `reply` was the shim\'s one universal producer, so its own');
  lines.push('  kind is not knowable from the name; a row whose only producer was `reply`');
  lines.push('  says so rather than claiming a kind.');
  lines.push('- **A bare `.catch(reply)`** carries the rejection value itself, so its');
  lines.push('  payload is an error value and not an unclassifiable one.');
  lines.push('');
  lines.push('| Verdict | Rows | What it means |');
  lines.push('|---|---:|---|');
  lines.push('| closed | ' + sum.closed + ' | baseline and target agree on every dimension above |');
  lines.push('| closed by approved deviation | ' + sum.approved + ' | the outcome changed, and this exact edge and this exact change are on the approved list |');
  lines.push('| **open - outcome changed** | ' + sum.changed + ' | R-e requires these to match and they do not; each row names the dimensions |');
  lines.push('| **open - no target row** | ' + sum.missing + ' | the baseline edge could not be located in the target |');
  lines.push('| **open - new in the target** | ' + sum.added + ' | no baseline fact to preserve, so nothing is verified |');
  lines.push('| **open - pairing ambiguous** | ' + sum.ambiguous + ' | the two trees order the same ids differently, so no pairing in that carrier can be established |');
  lines.push('| not compared - proven unreachable | ' + sum.unreachable + ' | nothing in the corpus reaches the edge, so there is no outcome on either tree to compare |');
  lines.push('');
  lines.push('| Reconciliation | Rows |');
  lines.push('|---|---:|');
  lines.push('| baseline rows, all accounted for | ' + sum.baselineAccounted + ' of ' + sum.baselineRows + ' |');
  lines.push('| target rows, all accounted for | ' + sum.targetAccounted + ' of ' + sum.targetRows + ' |');
  lines.push('| paired by exact identity | ' + (sum.baselineAccounted - sum.missing - sum.fallbackMatches) + ' |');
  lines.push('| paired by source order within the carrier | ' + sum.fallbackMatches + ' |');
  lines.push('| of those, where an identically-named target row exists elsewhere | ' + sum.renumberedOrdinals + ' |');
  lines.push('');
  lines.push('Identity is authoritative and source order fills its gaps, in that order.');
  lines.push('An identity is `<file>.<carrier>.<class>.<ordinal>`, so it denotes the same');
  lines.push('edge on both trees only while that carrier\'s population of that CLASS is');
  lines.push('unchanged; where it changed, the ordinals renumbered and the id match is an');
  lines.push('artefact. Measured on `course.deleteCourse`, whose first baseline edge');
  lines.push('became the handler-class edge and whose second kept its shape, taking the');
  lines.push('id match would pair line 151 with line 192 and report both rows changed -');
  lines.push('two false failures from one crossing. So an id match anchors the alignment');
  lines.push('only where the class population is stable, and the ' + sum.renumberedOrdinals + ' rows where it is');
  lines.push('not say so on their own row rather than having the choice hidden. Where the');
  lines.push('anchors that ARE trusted appear in a different order on the two trees,');
  lines.push('nothing about that carrier can be established from position and every pair');
  lines.push('in it is reported ambiguous instead of given a verdict.');
  lines.push('');

  const open = model.closure.rows.filter(function (row) {
    return row.closure !== CLOSURE.CLOSED && row.closure !== CLOSURE.APPROVED &&
      row.closure !== CLOSURE.UNREACHABLE;
  });

  if (!open.length) {
    lines.push('**Every row is closed.** No edge in the analysed surface changed its');
    lines.push('observable outcome between the two trees.');
  } else {
    lines.push('### The ' + open.length + ' open row' + (open.length === 1 ? '' : 's'));
    lines.push('');
    lines.push('Listed in full, because a closure count with the open rows left out is the');
    lines.push('same claim the previous edition of this document made by ticking nothing.');
    lines.push('');
    lines.push('| Row | Edge | Baseline outcome | Target outcome | Verdict | What differs |');
    lines.push('|---|---|---|---|---|---|');
    open.forEach(function (row) {
      const edge = row.baseline || row.target;
      lines.push('| `' + row.id + '` | `' + lineRef(edge) + '` | ' +
        (row.baselineOutcome ? cell(outcomeText(row.baselineOutcome)) : 'n/a - not in the baseline') + ' | ' +
        (row.targetOutcome ? cell(outcomeText(row.targetOutcome)) : 'n/a - not in the target') + ' | ' +
        cell(row.closure) + ' | ' +
        ((row.differences || []).length ? cell(row.differences.join(', ')) : 'n/a') + ' |');
    });
  }

  lines.push('');
  lines.push('### The approved-deviation list');
  lines.push('');
  if (!APPROVED_DEVIATIONS.length) {
    lines.push('**Empty, by measurement.** AAP 0.7 records exactly one approved behaviour');
    lines.push('deviation on this surface - the never-settling image branch of the file');
    lines.push('download - and its `reply(stream)` calls carry a stream rather than an');
    lines.push('error, so no error edge exists for it and there is nothing to exempt here.');
    lines.push('An entry would have to name the exact row id AND the exact from/to');
    lines.push('outcome; a difference that merely claimed to be approved would still be');
    lines.push('reported open, because approving a deviation approves one reviewed change');
    lines.push('and not any change under the same name.');
  } else {
    lines.push('| Row | From | To |');
    lines.push('|---|---|---|');
    APPROVED_DEVIATIONS.forEach(function (entry) {
      lines.push('| `' + entry.id + '` | ' + cell(entry.from) + ' | ' + cell(entry.to) + ' |');
    });
  }

  lines.push('');
  lines.push('The gate is ' + (model.closureGate ? '**enforced**' : 'reported only') + ' on this run' +
    (model.closureGate
      ? ', so an open row would have failed it.'
      : '. Pass `--closure-gate` to exit non-zero while any row is open.'));
  return lines;
}

/**
 * The coverage register: which rows a corpus scenario actually drives.
 *
 * Static closure is a reading of two trees. It is not a measured response,
 * and this section keeps the two apart so that a statically closed row is
 * never presented as a driven one.
 */
function renderCoverage(model) {
  const lines = [];
  lines.push('');
  lines.push('## ' + model.sections.coverage + '. Driven coverage');
  lines.push('');

  if (!model.scenarios) {
    lines.push('**Not joined.** No corpus was supplied, so no row above carries a measured');
    lines.push('response and every `Driven:` line says so. Pass');
    lines.push('`--scenarios test/parity/corpus.json` to join, and `--coverage-gate` to');
    lines.push('exit non-zero while a changed edge has no scenario naming it.');
    return lines;
  }

  const levels = { 'edge-level': [], 'route-level': [], uncovered: [] };
  model.allEdges.forEach(function (edge) {
    const coverage = coverageFor(edge, model.scenarios);
    (levels[coverage.level] || levels.uncovered).push(edge);
  });

  lines.push('Joined against `' + model.scenarios.path.split('/').slice(-2).join('/') + '`: ' +
    model.scenarios.scenarioCount + ' scenarios, of which ' +
    model.scenarios.errorEdgeScenarioCount + ' are `error-edge.*`' +
    (model.scenarios.errorEdgeGroups.length
      ? ' across the groups ' + model.scenarios.errorEdgeGroups.map(code).join(', ')
      : '') + '.');
  lines.push('');
  lines.push('| Coverage | Rows | What it proves |');
  lines.push('|---|---:|---|');
  lines.push('| edge-level | ' + levels['edge-level'].length + ' | a scenario names this row\'s id, so the branch itself was reached |');
  lines.push('| route-level only | ' + levels['route-level'].length + ' | a scenario drives the row\'s route, which is not the same as reaching its failure branch |');
  lines.push('| **not driven** | ' + levels.uncovered.length + ' | no scenario names the row or its routes |');
  lines.push('');
  lines.push('**Route-level is not coverage of an error edge.** One minimal request per');
  lines.push('route exercises success paths; an error edge needs a request that reaches');
  lines.push('its own branch. The distinction is the reason this table has three rows');
  lines.push('rather than two, and the reason a route-level row is reported as');
  lines.push('unverified above.');
  lines.push('');

  const changedUndriven = model.closure
    ? model.closure.rows.filter(function (row) {
      if (row.closure === CLOSURE.CLOSED || row.closure === CLOSURE.APPROVED) {
        return false;
      }
      const edge = row.target || row.baseline;
      return coverageFor(edge, model.scenarios).level !== 'edge-level';
    })
    : [];

  if (model.closure) {
    lines.push('### Changed edges with no scenario of their own');
    lines.push('');
    if (!changedUndriven.length) {
      lines.push('None: every edge whose outcome is not closed has a scenario naming it.');
    } else {
      lines.push('**' + changedUndriven.length + '** of the open rows in section ' +
        model.sections.closure + ' have no `error-edge.*` scenario naming their id, so');
      lines.push('their target outcome is a reading of the code rather than a measured');
      lines.push('response. Each one needs a scenario in `test/parity/capture.js` whose');
      lines.push('`coversEdges` array carries the id - `covers` is route-keys only and');
      lines.push('capture.js rejects anything else there:');
      lines.push('');
      changedUndriven.slice(0, 60).forEach(function (row) {
        const edge = row.target || row.baseline;
        lines.push('- `' + row.id + '` - `' + lineRef(edge) + '` - ' + cell(row.closure));
      });
      if (changedUndriven.length > 60) {
        lines.push('- ... and ' + (changedUndriven.length - 60) +
          ' more, all present in the `--edge-index` output.');
      }
    }
    lines.push('');
  }

  lines.push('The gate is ' + (model.coverageGate ? '**enforced**' : 'reported only') + ' on this run' +
    (model.coverageGate
      ? ', so an undriven changed edge would have failed it.'
      : '. Pass `--coverage-gate` to exit non-zero while any changed edge is undriven.'));
  return lines;
}

function renderDocument(model) {
  // Two passes over one block, in this order, for the reason bindBodyDigest()
  // documents: the body has to exist before it can be digested, and the digest
  // has to be on the block before the block is serialized into the body. The
  // canonicalization drops the serialized line, so the digest taken from pass
  // 1 is the digest of what pass 2 writes. Every caller gets a bound document,
  // including one that calls this function through the module API.
  if (model.provenance) {
    bindBodyDigest(model.provenance, composeDocument(model));
  }

  return composeDocument(model);
}

function composeDocument(model) {
  return renderProvenance(model)
    .concat(renderPreamble(model))
    .concat(renderFunnels(model))
    .concat(renderSilentChanges())
    .concat(renderHowToRead(model))
    .concat(renderCounts(model))
    .concat(renderSummary(model))
    .concat(renderInventory(model))
    .concat(renderClosure(model))
    .concat(renderCoverage(model))
    .concat(renderReconciliation(model))
    .concat(renderDrivability(model))
    .concat([''])
    .join('\n');
}

// ---------------------------------------------------------------------------
// Locator reconciliation
//
// The plan cites some locations that do not match the tree - the
// `.catch(request.fail)` chain in the pages controller is cited at :52 and
// measured at :54, because the chain statement begins two lines above the
// `.catch` link - and a reviewer following either must land on the same edge.
// A cited locator with nothing measured against it is equally informative on a
// converted tree: it means the row has closed.
// ---------------------------------------------------------------------------

const CITED_LOCATORS = Object.freeze([
  { cited: 'lib/util/routeParser.js:578-589', subject: 'Layer 1, the handler catch-all', kind: 'funnel', funnel: 'layer1' },
  { cited: 'lib/util/routeParser.js:482-514', subject: 'Layer 2, request.fail', kind: 'funnel', funnel: 'layer2' },
  { cited: 'app.js:152-200', subject: 'Layer 3, onPreResponse', kind: 'funnel', funnel: 'layer3' },
  { cited: 'app.js:183-190', subject: 'Layer 3 Boom-branch header assignments', kind: 'headers' },
  { cited: 'lib/util/routeParser.js:79-126, :137-178', subject: 'the pre-handler shim', kind: 'funnel', funnel: 'preShim' },
  { cited: 'config/default.yaml:353-358', subject: 'the paths X-Frame-Options is limited to', kind: 'xframe' },
  {
    cited: 'lib/controllers/pages.js:52',
    subject: 'the `.catch(request.fail)` chain',
    kind: 'edge',
    file: 'lib/controllers/pages.js',
    match: function (edge) {
      return edge.bareReference === 'request.fail';
    }
  },
  {
    cited: 'lib/controllers/pages.js:17, :27',
    subject: 'the `reply.redirect is not a function` synchronous throws',
    kind: 'edge',
    file: 'lib/controllers/pages.js',
    match: function (edge) {
      return edge.thrownKind && edge.thrownKind.kind === 'type-error';
    }
  },
  {
    cited: 'lib/controllers/users.js:596-598',
    subject: 'the streaming asset fetch error listener (log-and-continue)',
    kind: 'edge',
    file: 'lib/controllers/users.js',
    match: function (edge) {
      return edge.disposition === DISPOSITION.LOG_CONTINUE && edge.mechanism === '.on(\'error\')';
    }
  },
  {
    cited: 'lib/controllers/trinket.js:375',
    subject: '`reply(err)` with no return on an error path',
    kind: 'edge',
    file: 'lib/controllers/trinket.js',
    match: function (edge) {
      return edge.disposition === DISPOSITION.REPLY_ERR && edge.returned === false &&
        edge.valueKind && edge.valueKind.kind === 'error-identifier';
    }
  },
  {
    cited: 'lib/controllers/courses.js:268',
    subject: 'resolve-on-later-callback inside rimraf',
    kind: 'edge',
    file: 'lib/controllers/courses.js',
    match: function (edge) {
      return edge.disposition === DISPOSITION.LATE_RESOLVE;
    }
  },
  {
    cited: 'lib/util/helpers.js:190, :393',
    subject: '`reply(err)` inside a pre-handler',
    kind: 'edge',
    file: 'lib/util/helpers.js',
    match: function (edge) {
      return edge.disposition === DISPOSITION.REPLY_ERR &&
        edge.valueKind && edge.valueKind.kind === 'error-identifier';
    }
  },
  {
    cited: 'config/api_routes.js:1104',
    subject: 'the inline pre-handler',
    // Not `kind: 'edge'`: the site exists and carries no error, so "no
    // matching row" is the CORRECT result and the reconciliation must say
    // which of the two possible reasons applies rather than offering both.
    // The ambiguous wording let a site count stand in for edge coverage:
    // `config/api_routes.js` contributes one `reply(` token, the count
    // self-check asserts that 1, and a reader could take the assertion as
    // evidence that the file's error edges were inventoried. They were not,
    // because it has none.
    kind: 'inline-pre',
    file: 'config/api_routes.js'
  }
]);

function locatorReconciliation(files, funnels) {
  const byFile = new Map();
  files.forEach(function (file) {
    byFile.set(file.relPath, file);
  });

  return CITED_LOCATORS.map(function (entry) {
    let measured = 'no matching row in this tree - either the shape has closed here, ' +
      'or the cited site carries no error value';
    if (entry.kind === 'funnel') {
      const funnel = funnels[entry.funnel];
      measured = funnel
        ? funnel.file + ':' + funnel.startLine + '-' + funnel.endLine
        : 'not located in this tree';
    } else if (entry.kind === 'headers') {
      const l3 = funnels.layer3;
      measured = l3 && l3.boomHeaderLine
        ? l3.file + ':' + l3.boomHeaderLine + '-' + (l3.xframeLine || l3.boomHeaderLine) +
          ' (Boom branch), ' + l3.file + ':' + (l3.nonBoomHeaderLine || '?') + ' (non-Boom branch)'
        : 'not located in this tree';
    } else if (entry.kind === 'xframe') {
      measured = funnels.xframePaths
        ? funnels.xframePaths.file + ':' + funnels.xframePaths.startLine + '-' +
          funnels.xframePaths.endLine + ' (' + funnels.xframePaths.entries.length + ' paths)'
        : 'not located in this tree';
    } else if (entry.kind === 'inline-pre') {
      const file = byFile.get(entry.file);
      const sites = file ? file.counts.replyLiteral : 0;
      measured = sites
        ? sites + ' `reply(` site(s) in this file, **0 error-edge rows** - the ' +
          'site carries a non-error value (`reply(true)`), so it correctly ' +
          'produces no row. The site count is not edge coverage.'
        : 'no `reply(` site in this file, and no error-edge row';
    } else {
      const file = byFile.get(entry.file);
      if (file) {
        const hits = file.edges.filter(entry.match);
        if (hits.length) {
          measured = entry.file + ':' + hits.map(function (edge) {
            return edge.endLine > edge.line ? edge.line + '-' + edge.endLine : String(edge.line);
          }).join(', :');
        }
      }
    }
    return { cited: entry.cited, measured: measured, subject: entry.subject };
  });
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const TOOL_RELATIVE_PATH = 'test/parity/error-edges.js';

function toolRepositoryRoot() {
  return path.resolve(__dirname, '..', '..');
}

/**
 * A path expressed relative to this repository when it lies inside it, and
 * absolute otherwise. The recorded command is meant to be re-runnable by a
 * reviewer with a different checkout location, so the output path is written
 * the way they would type it; --app stays absolute because the baseline
 * worktree is external and its location is genuinely a property of the run.
 */
function relativeToToolRepository(target) {
  const root = toolRepositoryRoot();
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (relative && relative.indexOf('..') !== 0 && !path.isAbsolute(relative)) {
    return relative;
  }
  // A path outside the repository is a fact about the machine, and the
  // committed document must not carry one. Only the basename is kept, which
  // is enough for a reader to recognise what was written without recording
  // where. The absolute path is in the `--provenance-out` sidecar.
  return '<outside the repository>/' + path.basename(resolved);
}

/**
 * Analyse a tree and write the inventory. Returns a summary for callers that
 * want to assert on the run without parsing the document.
 *
 * @param {{appRoot: string, outPath: string, countsCheck: string}} options
 */
/**
 * Write the machine-readable edge index.
 *
 * The document is prose with tables in it. A consumer that wanted to know
 * which edge a scenario reached, or whether a changed edge had been driven,
 * had to parse that prose - so in practice nothing did, and the checklist and
 * the corpus were two unrelated artifacts describing the same edges. This
 * index is the join surface: one record per row, keyed by the same stable id
 * the document prints, carrying everything a consumer needs and no prose at
 * all.
 *
 * Deterministic by construction - sorted, no timestamp - so it can be
 * committed and diffed like the document.
 */
function writeEdgeIndex(indexPath, model) {
  const records = model.allEdges.map(function (edge) {
    const row = model.closure ? model.closure.byTargetId.get(edge.id) : null;
    const coverage = model.scenarios ? coverageFor(edge, model.scenarios) : null;
    return {
      id: edge.id,
      file: edge.file,
      line: edge.line,
      endLine: edge.endLine,
      carrier: edge.carrier,
      carrierMember: edge.carrierMember,
      surface: edge.surface,
      edgeClass: edge.edgeClass || EDGE_CLASS.RESPONSE,
      disposition: edge.disposition,
      funnel: edge.funnel,
      shape: edge.shape,
      routes: edge.routes,
      routedVia: edge.routedVia,
      driveVia: edge.driveVia,
      outcome: outcomeOf(edge),
      closure: row ? row.closure : CLOSURE.NOT_COMPARED,
      differences: row && row.differences ? row.differences : [],
      matchedBy: row ? row.matchedBy : null,
      renumberedOrdinal: row && row.renumbered ? row.renumbered : null,
      ambiguousBecause: row && row.ambiguousGroup ? row.ambiguousGroup : null,
      baselineOutcome: row && row.baselineOutcome ? row.baselineOutcome : null,
      baselineLine: row && row.baseline ? row.baseline.line : null,
      coverage: coverage ? coverage.level : 'not joined',
      coveringScenarios: coverage ? coverage.scenarios : []
    };
  }).sort(function (a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // BOTH SIDES, and every record that did not pair.
  //
  // An index of target rows alone cannot answer the question it exists for:
  // a baseline row missing from the target has no target row to carry it, so
  // it vanished from the machine artifact exactly when a consumer most needed
  // it. The baseline rows are therefore emitted too, keyed by their own ids,
  // and the unpaired and ambiguous records are named as such.
  const baselineRecords = model.closure
    ? model.closure.rows.filter(function (row) {
      return row.baseline;
    }).map(function (row) {
      return {
        id: row.id,
        file: row.baseline.file,
        line: row.baseline.line,
        endLine: row.baseline.endLine,
        carrier: row.baseline.carrier,
        surface: row.baseline.surface,
        edgeClass: row.baseline.edgeClass || EDGE_CLASS.RESPONSE,
        disposition: row.baseline.disposition,
        funnel: row.baseline.funnel,
        shape: row.baseline.shape,
        routes: row.baseline.routes,
        driveVia: row.baseline.driveVia,
        outcome: row.baselineOutcome,
        closure: row.closure,
        pairedWith: row.target ? row.target.id : null,
        matchedBy: row.matchedBy,
        differences: row.differences || []
      };
    }).sort(function (a, b) {
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    : [];

  const unpaired = model.closure
    ? {
      missingFromTarget: model.closure.rows.filter(function (row) {
        return row.closure === CLOSURE.MISSING;
      }).map(function (row) {
        return { id: row.id, file: row.baseline.file, line: row.baseline.line };
      }),
      newInTarget: model.closure.rows.filter(function (row) {
        return row.closure === CLOSURE.ADDED;
      }).map(function (row) {
        return { id: row.id, file: row.target.file, line: row.target.line };
      }),
      ambiguous: model.closure.rows.filter(function (row) {
        return row.closure === CLOSURE.AMBIGUOUS;
      }).map(function (row) {
        return {
          id: row.id,
          pairedWith: row.target ? row.target.id : null,
          reason: row.ambiguousGroup || 'the pairing could not be established'
        };
      }),
      provenUnreachable: model.closure.rows.filter(function (row) {
        return row.closure === CLOSURE.UNREACHABLE;
      }).map(function (row) {
        const edge = row.target || row.baseline;
        return { id: row.id, file: edge.file, line: edge.line };
      })
    }
    : null;

  const payload = {
    // @2 adds `baselineRows`, `unpaired` and per-row `differences`. A
    // consumer written against @1 reads `rows` unchanged.
    schema: 'trinket-oss/error-edge-index@2',
    document: relativeToToolRepository(model.outPathForIndex || ''),
    generator: model.tool,
    analysedTree: {
      label: model.tree.label,
      head: model.tree.head,
      isBaselineCommit: model.tree.isBaselineCommit
    },
    comparedAgainst: model.baselineTree
      ? { label: model.baselineTree.label, head: model.baselineTree.head }
      : null,
    closureSummary: model.closure ? model.closure.summary : null,
    scenarioCorpus: model.scenarios
      ? {
        scenarioCount: model.scenarios.scenarioCount,
        errorEdgeScenarioCount: model.scenarios.errorEdgeScenarioCount,
        errorEdgeGroups: model.scenarios.errorEdgeGroups
      }
      : null,
    rowCount: records.length,
    baselineRowCount: baselineRecords.length,
    rows: records,
    baselineRows: baselineRecords,
    unpaired: unpaired
  };

  const resolved = path.resolve(indexPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

/**
 * Write the volatile physical provenance.
 *
 * Absolute paths, the wall clock and the exact command as typed are facts
 * about a RUN, not about the analysed commits, and putting them in the
 * committed body made the deliverable differ between two machines analysing
 * the same code. They are still worth recording - a reader asking "where was
 * this run and when" deserves an answer - so they are recorded here, in a
 * sidecar that is not the reviewed artifact.
 */
function writeProvenanceSidecar(sidecarPath, model, options, document) {
  const resolved = path.resolve(sidecarPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify({
    schema: 'trinket-oss/error-edge-provenance@1',
    generatedAt: new Date().toISOString(),
    node: process.version,
    physicalCommand: 'node ' + TOOL_RELATIVE_PATH +
      (options.baselineRoot ? ' --baseline ' + path.resolve(options.baselineRoot) : '') +
      ' --app ' + path.resolve(options.appRoot) +
      ' --out ' + path.resolve(options.outPath) +
      (options.scenariosPath ? ' --scenarios ' + path.resolve(options.scenariosPath) : '') +
      ' --counts-check ' + options.countsCheck,
    analysedTreePath: path.resolve(options.appRoot),
    baselineTreePath: options.baselineRoot ? path.resolve(options.baselineRoot) : null,
    outPath: path.resolve(options.outPath),
    documentBytes: Buffer.byteLength(document, 'utf8'),
    rows: model.totals.rows,
    closureSummary: model.closure ? model.closure.summary : null
  }, null, 2) + '\n', 'utf8');
}

/**
 * Read and analyse one tree, returning its per-file edge sets.
 *
 * Factored out because closure needs TWO of these and both must be produced
 * by the same code: a comparison whose two sides were measured differently
 * measures the difference between the measurements.
 */
function analyseTree(root, label) {
  const missing = ANALYSIS_TARGETS.filter(function (relPath) {
    return !fs.existsSync(path.join(root, relPath));
  });
  if (missing.length) {
    throw new AnalysisError(
      'the ' + label + ' tree is missing ' + missing.length + ' of the ' +
      ANALYSIS_TARGETS.length + ' analysis targets: ' + missing.join(', ') +
      '. An inventory generated over a partial target set would understate ' +
      'the edge count, so this is fatal. Check the ' + label + ' path (' + root + ').'
    );
  }

  const bindings = buildRouteBindings(root);
  // Read once per tree and shared by every file's reachability search, so a
  // helper's driver can be traced to a controller or a route module and a
  // helper nothing mentions can be PROVEN unreachable rather than assumed
  // reachable because it happens to have a name.
  bindings.corpus = buildCorpus(root);
  const funnels = locateFunnels(root);
  const files = ANALYSIS_TARGETS.map(function (relPath) {
    const src = fs.readFileSync(path.join(root, relPath), 'utf8');
    const analysed = analyseFile(relPath, src, bindings);
    resolveFunnels(analysed.edges, funnels);
    return {
      relPath: relPath,
      edges: analysed.edges,
      counts: analysed.counts,
      carriers: analysed.carriers.length
    };
  });

  return {
    root: root,
    bindings: bindings,
    funnels: funnels,
    files: files,
    allEdges: files.reduce(function (list, file) {
      return list.concat(file.edges);
    }, [])
  };
}

/** Resolve a directory argument, failing with the reason. */
function resolveTreeArgument(value, flag) {
  const root = path.resolve(value);
  let stat;
  try {
    stat = fs.statSync(root);
  } catch (err) {
    throw new AnalysisError(flag + ' path does not exist: ' + root);
  }
  if (!stat.isDirectory()) {
    throw new AnalysisError(flag + ' path is not a directory: ' + root);
  }
  return root;
}

function generate(options) {
  const selfTests = runSelfTests();

  const appRoot = resolveTreeArgument(options.appRoot, '--app');
  const analysed = analyseTree(appRoot, 'analysed');
  const bindings = analysed.bindings;
  const funnels = analysed.funnels;
  const files = analysed.files;

  const controllerFiles = files.filter(function (file) {
    return CONTROLLER_FILES.indexOf(file.relPath) !== -1;
  });
  const sum = function (list, key) {
    return list.reduce(function (total, file) {
      return total + file.counts[key];
    }, 0);
  };
  const helpersFile = files.find(function (file) {
    return file.relPath === HELPERS_FILE;
  });
  const inlineFile = files.find(function (file) {
    return file.relPath === INLINE_PRE_FILE;
  });

  const counts = {
    replyControllers: sum(controllerFiles, 'replyLiteral'),
    replyHelpers: helpersFile.counts.replyLiteral,
    replyInlinePre: inlineFile.counts.replyLiteral,
    thenControllers: sum(controllerFiles, 'thenLiteral'),
    catchControllers: sum(controllerFiles, 'catchLiteral'),
    legacyHandlerDeclarations: sum(controllerFiles, 'legacyHandlerDeclarations'),
    toolkitHandlerDeclarations: sum(controllerFiles, 'toolkitHandlerDeclarations'),
    errParamFunctions: sum(controllerFiles, 'errParamFunctions')
  };
  counts.replyTotal = counts.replyControllers + counts.replyHelpers + counts.replyInlinePre;

  const toolRoot = toolRepositoryRoot();
  const tree = treeProvenance(appRoot, toolRoot);
  const check = checkCounts(counts, options.countsCheck, tree);

  const allEdges = analysed.allEdges;

  // Driveability is asserted on the FIELD, not on the carrier string.
  //
  // The predecessor of this check tested `!edge.carrier`, which no edge can
  // satisfy: `push()` substitutes `'(module scope)'` when carrier resolution
  // finds nothing, so the filter was always empty and the throw was
  // unreachable. An edge that genuinely could not be driven would have been
  // written into the document with no indication of it, which is worse than
  // the check being absent, because the document's own driveability section
  // asserted that every row was drivable on the strength of it.
  const undrivable = allEdges.filter(function (edge) {
    return edge.driveVia === 'unresolved';
  });
  if (undrivable.length) {
    throw new AnalysisError(
      undrivable.length + ' row(s) resolved no driver and no proof of ' +
      'unreachability, so their truth is unknown and no failure-path ' +
      'scenario can be written against them: ' +
      undrivable.slice(0, 5).map(function (edge) {
        return lineRef(edge) + ' (id=' + edge.id + ')';
      }).join(', ') +
      '. Carrier and route resolution both failed for those offsets.'
    );
  }

  // ---- Closure, when a baseline tree was named -----------------------------
  let closure = null;
  let baselineTree = null;
  if (options.baselineRoot) {
    const baselineRoot = resolveTreeArgument(options.baselineRoot, '--baseline');
    if (path.resolve(baselineRoot) === path.resolve(appRoot)) {
      throw new AnalysisError(
        '--baseline and --app resolve to the same directory (' + baselineRoot +
        '), so the comparison would join every row to itself and report ' +
        'universal closure while proving nothing. Name two different trees.'
      );
    }
    baselineTree = treeProvenance(baselineRoot, toolRoot);
    if (!baselineTree.isBaselineCommit) {
      throw new AnalysisError(
        'the tree at ' + baselineRoot + ' is at `' + baselineTree.head +
        '`, which is not the R-f baseline commit `' + BASELINE_COMMIT + '`. ' +
        'Closure is a claim about preserving BASELINE behaviour, so comparing ' +
        'against another revision would close rows against the wrong facts. ' +
        'Create the worktree with `git worktree add --detach <path> ' +
        BASELINE_COMMIT.slice(0, 7) + '`.'
      );
    }
    const baselineAnalysis = analyseTree(baselineRoot, 'baseline');
    closure = joinTrees(baselineAnalysis.allEdges, allEdges);
    closure.baselineFiles = baselineAnalysis.files;
  }

  // ---- Driven coverage, when a corpus was named ---------------------------
  const scenarios = options.scenariosPath ? readScenarios(options.scenariosPath) : null;

  const sections = {
    howToRead: 4,
    counts: 5,
    summary: 6,
    inventory: 7,
    closure: 8,
    coverage: 9,
    reconciliation: 10,
    drivability: 11
  };

  const model = {
    // A command anyone can run, in repository-relative terms. The physical
    // command - which carries this machine's absolute paths - goes to the
    // provenance sidecar, never into the committed body.
    reproduce: 'node ' + TOOL_RELATIVE_PATH +
      (options.baselineRoot ? ' --baseline "$BASELINE"' : '') +
      ' --app .' +
      ' --out ' + relativeToToolRepository(options.outPath) +
      (options.scenariosPath ? ' --scenarios ' + relativeToToolRepository(options.scenariosPath) : '') +
      ' --counts-check ' + options.countsCheck,
    tree: tree,
    baselineTree: baselineTree,
    tool: toolProvenance(toolRoot, TOOL_RELATIVE_PATH),
    // The generator's identity under the shared contract: its git blob, and a
    // commit only when that commit's tree holds that blob.
    identity: provenance.generator(__filename, toolRoot),
    funnels: funnels,
    counts: counts,
    check: check,
    files: files,
    allEdges: allEdges,
    bindings: bindings,
    selfTests: selfTests,
    sections: sections,
    closure: closure,
    closureMode: closure
      ? (options.closureGate ? 'run against the baseline worktree, gate enforced' : 'run against the baseline worktree, reported')
      : 'not run - single-tree run, so no row is closed',
    closureGate: Boolean(options.closureGate),
    scenarios: scenarios,
    coverageMode: scenarios
      ? (options.coverageGate ? 'joined to the capture corpus, gate enforced' : 'joined to the capture corpus, reported')
      : 'not joined - no corpus supplied',
    coverageGate: Boolean(options.coverageGate),
    reconciliation: locatorReconciliation(files, funnels),
    outPathForIndex: options.outPath,
    totals: { rows: allEdges.length, files: files.length }
  };

  // The shared provenance block, built from the same resolved facts the table
  // above prints. Role `analysis`: this generator executes no application code
  // and starts no server - it reads the tree as text - so the artifact is
  // derived from a tree rather than measured against a running one. Every
  // value is portable by construction: the artifact is a symbolic label and
  // the invocation is the same `--baseline "$BASELINE" --app .` string the
  // `Reproduce with` row carries, so two runs over one pair of commits are
  // byte-identical.
  model.provenance = provenance.build({
    artifact: path.basename(options.outPath),
    role: 'analysis',
    generatorFile: __filename,
    toolRoot: toolRoot,
    analysedRoot: appRoot,
    detail: {
      artifactLabel: provenance.pathLabel(path.resolve(options.outPath), {
        toolRoot: toolRoot,
        analysedRoot: appRoot
      }),
      invocation: model.reproduce,
      analysedTreeLabel: tree.label,
      analysedSourcesDirty: tree.dirty,
      comparedAgainstHead: baselineTree ? baselineTree.head : null,
      rowsEmitted: allEdges.length,
      filesAnalysed: files.length,
      closureMode: model.closureMode,
      coverageMode: model.coverageMode,
      countsCheck: {
        mode: check.mode,
        applied: check.applied,
        allMatch: check.allMatch
      }
    }
  });

  // ---- The gates, evaluated BEFORE anything is written -------------------
  // A gate that failed after writing would leave a document on disk stating
  // its own gate had failed, which is exactly the artifact a reader would
  // then cite.
  if (options.closureGate) {
    if (!closure) {
      throw new AnalysisError(
        '--closure-gate requires --baseline: there is nothing to close rows ' +
        'against in a single-tree run, and a gate that passes because no ' +
        'comparison ran is not a gate.'
      );
    }
    // AMBIGUOUS counts as open - a pairing that could not be established is
    // not a preserved mapping - while a PROVEN UNREACHABLE row does not,
    // because there is no outcome on either tree to preserve. A row whose own
    // reachability or caller is unresolved is open too, whatever its
    // comparison said, because its facts are provisional.
    const open = closure.rows.filter(function (row) {
      const edge = row.target || row.baseline;
      if (row.closure === CLOSURE.UNREACHABLE) {
        return false;
      }
      if (row.closure !== CLOSURE.CLOSED && row.closure !== CLOSURE.APPROVED) {
        return true;
      }
      return Boolean(edge && edge.unresolved);
    });
    if (open.length) {
      throw new AnalysisError(
        '--closure-gate: ' + open.length + ' of ' + closure.rows.length +
        ' error-edge row(s) are not closed against the baseline. R-e requires ' +
        'every converted path to preserve its error-to-response mapping, so ' +
        'each of these is an unpreserved or unverified mapping:\n' +
        open.slice(0, 20).map(function (row) {
          const edge = row.baseline || row.target;
          return '  ' + row.id + ' (' + lineRef(edge) + '): ' + row.closure +
            (row.baselineOutcome && row.targetOutcome
              ? ' - baseline ' + outcomeText(row.baselineOutcome) +
                ' vs target ' + outcomeText(row.targetOutcome)
              : '');
        }).join('\n') +
        (open.length > 20 ? '\n  ... and ' + (open.length - 20) + ' more' : '')
      );
    }
  }

  if (options.coverageGate) {
    if (!scenarios) {
      throw new AnalysisError(
        '--coverage-gate requires --scenarios: without a corpus every row is ' +
        'trivially uncovered and the gate would report nothing about coverage.'
      );
    }
    if (!closure) {
      throw new AnalysisError(
        '--coverage-gate requires --baseline: the gate applies to CHANGED ' +
        'edges, and which edges changed is what the closure comparison ' +
        'establishes.'
      );
    }
    const undriven = closure.rows.filter(function (row) {
      if (row.closure === CLOSURE.CLOSED || row.closure === CLOSURE.APPROVED) {
        return false;
      }
      const edge = row.target || row.baseline;
      return coverageFor(edge, scenarios).level !== 'edge-level';
    });
    if (undriven.length) {
      throw new AnalysisError(
        '--coverage-gate: ' + undriven.length + ' changed error edge(s) have no ' +
        'corpus scenario naming their id, so their target outcome is a reading ' +
        'of the code rather than a measured response:\n' +
        undriven.slice(0, 20).map(function (row) {
          const edge = row.target || row.baseline;
          return '  ' + row.id + ' (' + lineRef(edge) + ')';
        }).join('\n') +
        (undriven.length > 20 ? '\n  ... and ' + (undriven.length - 20) + ' more' : '')
      );
    }
  }

  const document = renderDocument(model);

  const outPath = path.resolve(options.outPath);
  writeDocumentAtomically(outPath, document);

  // ---- The machine-readable index, when asked for -------------------------
  if (options.edgeIndexPath) {
    writeEdgeIndex(options.edgeIndexPath, model);
  }

  // ---- The volatile provenance sidecar, when asked for -------------------
  if (options.provenanceOutPath) {
    writeProvenanceSidecar(options.provenanceOutPath, model, options, document);
  }

  return {
    outPath: outPath,
    appRoot: appRoot,
    rows: allEdges.length,
    counts: counts,
    check: check,
    selfTests: selfTests,
    funnels: funnels,
    files: files.map(function (file) {
      return { relPath: file.relPath, rows: file.edges.length };
    }),
    bytes: Buffer.byteLength(document, 'utf8')
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = [
  'Usage: node ' + TOOL_RELATIVE_PATH + ' [options]',
  '',
  'Generates the per-edge error-to-response inventory that rule R-e requires.',
  '',
  'Options:',
  '  --app <path>              tree to analyse (default: the repository this',
  '                            file lives in)',
  '  --out <path>              file to write (default: <this repository>/docs/',
  '                            error-edge-inventory.md). Resolved against THIS',
  '                            repository, never against --app, so generating',
  '                            the baseline inventory cannot write into the',
  '                            baseline worktree.',
  '  --counts-check <mode>     auto (default) | strict | off. Whether the token',
  '                            counts measured at the baseline commit are',
  '                            asserted. auto asserts when the analysed tree is',
  '                            detected as the baseline.',
  '  --baseline <path>         a worktree at the R-f baseline commit. Supplying',
  '                            it turns on the closure comparison: every row is',
  '                            joined to the row measuring the same edge on the',
  '                            other tree and closed only when the two produce',
  '                            the same observable outcome. Without it no row',
  '                            can be closed, and the document says so.',
  '  --scenarios <path>        a test/parity/capture.js corpus. Joins each row',
  '                            to the scenarios that drive it, by edge id from',
  '                            a scenario\'s `coversEdges` array and by route',
  '                            otherwise. NOT `covers`: capture.js validates',
  '                            that against the route manifest and reports',
  '                            anything else as an unknown route.',
  '  --edge-index <path>       write the machine-readable index, schema',
  '                            trinket-oss/error-edge-index@2: one record per',
  '                            target row AND one per baseline row, keyed by',
  '                            the same stable ids the document prints, with',
  '                            an `unpaired` block naming every row missing',
  '                            from the target, new in the target, ambiguous',
  '                            or proven unreachable. A consumer never parses',
  '                            the prose.',
  '  --provenance-out <path>   write the volatile physical provenance -',
  '                            absolute paths, wall clock, the command as',
  '                            typed - to a sidecar. None of it appears in the',
  '                            document, which is why two machines analysing',
  '                            the same commits produce identical output.',
  '  --closure-gate            exit non-zero while any row is unclosed.',
  '                            Requires --baseline. An ambiguous pairing',
  '                            counts as open, and so does a row whose own',
  '                            reachability could not be resolved; a proven',
  '                            unreachable row does not, because there is no',
  '                            outcome on either tree to preserve.',
  '  --coverage-gate           exit non-zero while any CHANGED edge has no',
  '                            scenario naming its id. Requires --baseline and',
  '                            --scenarios.',
  '  -h, --help                print this and exit 0',
  '',
  'No option is repeatable: a second occurrence, in either the `--flag value`',
  'or the `--flag=value` spelling, is a usage error rather than a',
  'last-one-wins. A value beginning with "-" is a usage error too, so a',
  'missing value cannot swallow the following option; write --flag=-value when',
  'a value really begins with a dash.',
  '',
  'Writes the document, and the index and sidecar when asked for, and nothing to',
  'stdout. Exits 0 on success, 1 with the reason on stderr on any failure. Both',
  'gates are evaluated BEFORE anything is written, so a failed gate never leaves',
  'a document on disk asserting its own failure.'
].join('\n');

const COUNTS_CHECK_MODES = ['auto', 'strict', 'off'];

/**
 * Parse argv. Supports `--flag value` and `--flag=value`. Any unrecognised
 * argument is an error rather than a silent no-op, so a typo cannot produce a
 * document written somewhere unintended.
 *
 * Two further rules, for the same reason: NO OPTION IS REPEATABLE, so a second
 * `--out` is a usage error rather than a last-one-wins - this tool writes one
 * document and a caller who named two paths must be told which one it would
 * have used - and A VALUE BEGINNING WITH A DASH IS A MISSING VALUE. The second
 * check previously tested for a `--` prefix only, so `--out -o` recorded an
 * output path of "-o"; any leading dash is now rejected, with `--flag=value`
 * as the escape hatch for a value that genuinely begins with one.
 */
function parseArgs(argv) {
  const options = {
    appRoot: toolRepositoryRoot(),
    outPath: path.join(toolRepositoryRoot(), 'docs', 'error-edge-inventory.md'),
    baselineRoot: null,
    scenariosPath: null,
    edgeIndexPath: null,
    provenanceOutPath: null,
    closureGate: false,
    coverageGate: false,
    countsCheck: 'auto',
    help: false
  };

  const takesValue = {
    '--app': 'appRoot',
    '--out': 'outPath',
    '--counts-check': 'countsCheck',
    '--baseline': 'baselineRoot',
    '--scenarios': 'scenariosPath',
    '--edge-index': 'edgeIndexPath',
    '--provenance-out': 'provenanceOutPath'
  };
  const flags = { '--closure-gate': 'closureGate', '--coverage-gate': 'coverageGate' };
  const seen = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const equalsAt = arg.indexOf('=');
    const seenName = equalsAt > 0 ? arg.slice(0, equalsAt) : arg;

    if (Object.prototype.hasOwnProperty.call(seen, seenName)) {
      throw new AnalysisError('repeated argument: ' + seenName +
        ' was given more than once, and no option here is repeatable\n\n' +
        USAGE);
    }
    seen[seenName] = true;

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(flags, arg)) {
      options[flags[arg]] = true;
      continue;
    }
    const equals = arg.indexOf('=');
    let name = arg;
    let value = null;
    if (equals > 0) {
      name = arg.slice(0, equals);
      value = arg.slice(equals + 1);
    }
    if (!Object.prototype.hasOwnProperty.call(takesValue, name)) {
      throw new AnalysisError('unrecognised argument: ' + arg + '\n\n' + USAGE);
    }
    if (value === null) {
      value = argv[i + 1];
      if (value === undefined ||
          (value.charAt(0) === '-' && value !== '-')) {
        throw new AnalysisError('missing value for ' + name + '\n\n' + USAGE);
      }
      i++;
    }
    if (value === '') {
      throw new AnalysisError('empty value for ' + name + '\n\n' + USAGE);
    }
    options[takesValue[name]] = value;
  }

  if (COUNTS_CHECK_MODES.indexOf(options.countsCheck) === -1) {
    throw new AnalysisError(
      'invalid --counts-check value: ' + options.countsCheck +
      ' (expected one of ' + COUNTS_CHECK_MODES.join(', ') + ')'
    );
  }

  return options;
}

/**
 * Entry point. Returns 0 on success and 1 on failure; nothing is written to
 * stdout in either case, and the document is written once, only after every
 * check has passed.
 */
function main(argv) {
  let options;
  try {
    options = parseArgs(argv || []);
  } catch (err) {
    process.stderr.write((err && err.message ? err.message : String(err)) + '\n');
    return 1;
  }

  if (options.help) {
    process.stderr.write(USAGE + '\n');
    return 0;
  }

  try {
    generate(options);
    return 0;
  } catch (err) {
    if (err instanceof AnalysisError) {
      process.stderr.write('error-edges: ' + err.message + '\n');
    } else {
      process.stderr.write(
        'error-edges: unexpected failure while generating the inventory\n' +
        ((err && err.stack) ? err.stack : String(err)) + '\n'
      );
    }
    return 1;
  }
}

module.exports = {
  AnalysisError: AnalysisError,
  ANALYSIS_TARGETS: ANALYSIS_TARGETS,
  BASELINE_COMMIT: BASELINE_COMMIT,
  BASELINE_COUNTS: BASELINE_COUNTS,
  DISPOSITION: DISPOSITION,
  FUNNEL: FUNNEL,
  KIND: KIND,
  AAP_DISPOSITIONS: AAP_DISPOSITIONS,
  APPROVED_DEVIATIONS: APPROVED_DEVIATIONS,
  CLOSURE: CLOSURE,
  EDGE_CLASS: EDGE_CLASS,
  SURFACE: SURFACE,
  analyseFile: analyseFile,
  buildRouteBindings: buildRouteBindings,
  cell: cell,
  code: code,
  assertRowCoherence: assertRowCoherence,
  outcomeDiff: outcomeDiff,
  outcomeOf: outcomeOf,
  buildCorpus: buildCorpus,
  funnelsNamedIn: funnelsNamedIn,
  calleeKind: calleeKind,
  driveVia: driveVia,
  isDrivable: isDrivable,
  memberMentions: memberMentions,
  collectBindings: collectBindings,
  collectDeclaredNames: collectDeclaredNames,
  collectFileFacts: collectFileFacts,
  coverageFor: coverageFor,
  escapeInline: escapeInline,
  isReturned: isReturned,
  joinTrees: joinTrees,
  outcomeOf: outcomeOf,
  readScenarios: readScenarios,
  surfaceFor: surfaceFor,
  valueKind: valueKind,
  checkCounts: checkCounts,
  classifySource: classifySource,
  findCarriers: findCarriers,
  findFunctions: findFunctions,
  generate: generate,
  locateFunnels: locateFunnels,
  main: main,
  parseArgs: parseArgs,
  renderDocument: renderDocument,
  resolveFunnels: resolveFunnels,
  runSelfTests: runSelfTests,
  targetText: targetText
};

// Guarded so that requiring this module - Mocha collects `test/**/*.js` under
// the committed mocha.opts - neither generates a document nor exits.
if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
