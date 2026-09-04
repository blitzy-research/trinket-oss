#!/usr/bin/env node
'use strict';

// Generates the per-edge error-to-response inventory: one row for every site
// in the ten controllers, the helpers module and the inline pre-handler at
// which an error decides a response.
//
// The three shared funnels are reached from hundreds of local branches, each
// branch decides WHICH funnel its error reaches, and some reach none - so the
// parity claim is per edge, and so is this document: every row names the route
// or code path that drives it and the outcome that must survive conversion.
// Given a baseline worktree, each row is also joined to the row measuring the
// same edge there and ticked only when the two agree.
//
// INVOCATION
//   node test/parity/error-edges.js --help   prints the options, which live in
//   the USAGE constant beside the parser. Node core only, CommonJS, so it runs
//   against a tree with no install. Artifacts go only to the paths the flags
//   name and stdout carries nothing; a failure prints its reason on stderr and
//   exits 1. Both gates run BEFORE anything is written, so a failed gate never
//   leaves a document asserting its own failure, and --out resolves against
//   THIS repository rather than --app, so generating the baseline inventory
//   cannot write into the baseline worktree.
//
// ARTIFACT
//   --out  the Markdown inventory (default docs/error-edge-inventory.md):
//     provenance, the funnels located in the analysed tree, the counts
//     self-check, then a section per file whose rows carry the stable id, file
//     and line, carrier, surface, class, Disposition, Shape, Funnel, the Target
//     outcome with its side effects and timing, the driver, the closure verdict
//     and the corpus coverage.
//   --edge-index  the same rows with no prose, schema
//     trinket-oss/error-edge-index@2: one record per target row AND per
//     baseline row under the ids the document prints, plus an `unpaired` block
//     naming every row missing, added, ambiguous or proven unreachable. Sorted
//     and timestamp-free, so it diffs.
//   --provenance-out  absolute paths, wall clock and the command as typed, none
//     of which enters the document, so two machines analysing the same commits
//     agree byte for byte.
//
// STATIC ANALYSIS, NOT OBSERVATION. The files are read as text and never
// required: requiring a controller creates the exports queue, loads the AWS
// SDK and pulls in config/app.config, which connects Mongoose. A row states
// what the source does, resolved from bindings, callers and reachability; a
// measured response comes from the capture corpus through --scenarios, so
// driven coverage is a separate field and a row can be closed yet undriven.
//
// SCRUB, THEN SCAN. No JavaScript parser is installed, so classifySource marks
// every offset as code, string, template, regex or comment and the structural
// passes match a copy with the non-code offsets blanked to spaces, display text
// coming from the raw source. Blanking preserves length and newlines, so
// offsets still map to lines and a brace or keyword inside a literal cannot
// mislead a pass. An unterminated literal is fatal - the signature of a
// desynchronized scan, which drops edges silently.
//
// EDGE IDENTITY. A row's id is <file>.<carrier member>.<class>.<ordinal>, with
// no line, disposition or funnel, because conversion moves lines and changes
// both of the others. Class buckets the shapes that convert into one another,
// and route declarations bind carriers by name, so both survive. The ordinal
// shifts when a carrier gains or loses a site: exact-id pairs anchor the
// alignment, position fills only gaps between anchors, and a group whose
// anchors cross is reported ambiguous rather than given a verdict.
//
// WHAT A ROW SAYS. Disposition is a closed vocabulary of seven values, exactly
// one per row: six local dispositions plus `propagates to its caller`, for a
// callback that hands its error to an outer continuation. Shape is open and
// descriptive, carrying the sub-shapes a mechanical conversion changes
// silently. Funnel is Layer 1, 2, 3 or `none`, and `none` is a real value: an
// edge that answers nothing is the one most likely to acquire an answer by
// accident. Target states the outcome to PRESERVE - status, payload or
// redirect, side effects, timing - never a fix; where it is a defect, the row
// requires the defect.
//
// SELF-CHECKS, ALL FATAL. The scanner and classifier self-tests run on every
// invocation, before any tree is read. The token counts are compared with the
// figures BASELINE_COUNTS records for the baseline commit, asserted when the
// analysed tree is detected as that baseline - by its HEAD, by the counts
// themselves, or by the legacy-handler fingerprint - so the guard stays live on
// a baseline tree without failing on a converted one, whose legacy idiom
// conversion removes; --counts-check selects auto, strict or off. A row whose
// Funnel contradicts its own Target prose is fatal, as is a closure summary
// whose buckets do not reconcile with the row counts.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

// The provenance contract shared by every tool in test/parity/ and by the two
// generated inventories in docs/. It is required from manifest.js because that
// is the only tool that is Node-core-only at module scope, so requiring it
// costs this generator nothing, and because a second copy of these guarantees
// would drift from the first. What the shared contract guarantees is the part
// a local implementation cannot: the generator is identified by its git BLOB
// (`git hash-object`) and by a commit only when that commit's tree actually
// holds that blob, and the document is bound to its own prose by a
// `bodyDigest`. `git log -1 -- <path>` names the last commit that touched the
// path, which is a different claim and is false for an uncommitted generator,
// so it is not the identity this document prints.
const { provenance } = require('./manifest');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// The parity baseline. Every baseline claim is taken at this commit.
const BASELINE_COMMIT = '2f8712a112db46f923918c4507c75abc732d83d0';

// The token counts the baseline commit carries, measured with
// `grep -o '<token>' | wc -l`, which is independent of this tool's tokenizer
// and therefore an independent witness that the scan stayed in sync.
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

// The closed Disposition vocabulary. Exactly one value per row.
const DISPOSITION = Object.freeze({
  FAIL_LOCAL: 'calls request.fail locally',
  REPLY_ERR: 'calls reply(err)',
  BOOM: 'returns or throws a Boom',
  LOG_CONTINUE: 'logs and continues',
  SWALLOW: 'swallows silently',
  LATE_RESOLVE: 'resolves on a later callback',
  // The seventh value, and the one this tool adds to the specified six. It
  // exists because those six cannot describe a callback that hands its error
  // to an outer continuation - `reject(err)`, `resolve({err: err, ...})`,
  // `next(err)` - and marking such an edge with any of them states something
  // false about it. "Swallows silently" is wrong twice over: the error is
  // neither absorbed nor silent, and a reviewer reading that row would
  // conclude no response can follow from the failure when in fact the awaiting
  // caller decides the response. "Logs and continues" is equally wrong for a
  // callback that logs AND rejects, because the continuation is a rejection
  // rather than the normal path. A row has to be actionable without being
  // re-derived, so the vocabulary carries the value the rows need rather than
  // the nearest of six. The document states this addition and its reason where
  // it lists the vocabulary.
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

// The six specified values, kept separately from DISPOSITION so the document
// can state exactly which of its dispositions are specified and which one is
// this tool's own.
const AAP_DISPOSITIONS = Object.freeze([
  DISPOSITION.FAIL_LOCAL,
  DISPOSITION.REPLY_ERR,
  DISPOSITION.BOOM,
  DISPOSITION.LOG_CONTINUE,
  DISPOSITION.SWALLOW,
  DISPOSITION.LATE_RESOLVE
]);

// A row's stable identity is (file, carrier, class, ordinal). CLASS is the
// coarse bucket that SURVIVES conversion: a `reply(err)` site becomes
// `return errors.notFound()` and its disposition changes from REPLY_ERR to
// BOOM, so an identity keyed on disposition would never match its own target
// row. Line numbers are excluded for the same reason - every one of them
// moves.
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
// rather than failures. Exactly one behaviour deviation is approved for this
// migration - the never-settling image branch of the file download in
// `lib/controllers/files.js` - and its `reply(stream)` sites carry a stream
// rather than an error, so Pass A skips them and no error edge exists for it.
// The list is therefore empty, and empty by measurement rather than by
// omission.
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

// The two documents this one deliberately does not duplicate: the quirk
// catalogue carries every claim about *why* a defect is kept, and the
// conversion checklist carries every claim about which call sites still need a
// `return`/`await`. Rows cross-reference them; they do not restate them.
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
 * conversion checklist's entry for that call site.
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
// Callee tails that register a LISTENER rather than take a continuation.
// Pass F owns the error handlers among them; Pass I must not shadow it.
const LISTENER_REGISTRARS = Object.freeze(['on', 'once', 'addListener', 'prependListener']);

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
// hazard the analysed set actually contains: a regex literal in
// `config/routes.js` carries both a single and a double quote inside its
// character class, and a scanner that treats either as a string delimiter
// loses everything after it.

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
// CLASSIFIERS built on it are right, and each one pins a classification whose
// wrong answer would put a false statement in the generated document - worse
// than an absent one, because it reads as a measurement. They run on every
// invocation, like the scanner tests, so a failure surfaces before a document
// is written rather than in a review of the document.
// ---------------------------------------------------------------------------

const ANALYSIS_SELF_TESTS = Object.freeze([
  {
    // An unescaped pipe inside a code span splits the Markdown row it sits
    // in, and `||` is common in error expressions - `err.message ||
    // String(err)` - so the rows most worth reading are the ones at risk. The
    // assertion is a property rather than a literal: no pipe survives
    // unescaped, and every pipe that was there is still represented.
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
    // Testing `carrierMember && surface !== module` instead would be
    // satisfied by every non-module row, so an uncalled function would come
    // back drivable and the guard reading it would be dead.
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
    // The shape this guards: resolveFunnels answers a returned error value
    // through Layer 3 while targetCore's tail prescribes Layer 1, so the row's
    // Funnel field and its own prose disagree.
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
    // The mirror shape: an internal-callee row says funnel `none` while its
    // target prescribes Layer 1, and its side effects then say no funnel logs
    // anything.
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
    // `lib/util/helpers.js`'s `findTrinket` and `lib/controllers/trinket.js`'s
    // conditional `reply(errors.forbidden()) : reply()` are this shape: the
    // token behind the inner `reply(` is `?` or `:`, and both values ARE
    // returned. A row saying "with no return" tells an implementing agent to
    // start returning a value that is already returned.
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
    // The `err === "threshold exceeded" ? ... : ...` return in
    // `lib/controllers/trinket.js`: the condition holds a string literal, which
    // the tokenizer blanks, so the backward walk crosses a run of spaces and
    // lands on the `=` of `===`, which must not be read as an assignment.
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
    // `lib/controllers/courses.js`'s `download` declares `var returnZip =`
    // inside its own body, and the sites after it belong to `download`. A
    // carrier extent measured to the next declaration instead absorbs them and
    // reports a routed edge as unrouted.
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
    // MEASURED on `trinket.updateSlug`, whose baseline
    // `reply(errors.conflict())` answers 409 and whose target expresses the
    // same mapping as a ternary branch inside a `.then`. A pattern anchored
    // on `return\s+Boom\.` saw neither the branch nor the row, so status 409
    // went from one occurrence to zero tree-wide and the comparison reported
    // the 409 mapping as lost while it was preserved.
    //
    // The negative halves matter as much: an argument to `reply(...)` is Pass
    // A's row and a `throw` is Pass D's, so neither may be duplicated here.
    name: 'a Boom whose value is returned is an edge wherever it sits in the expression',
    run: function () {
      const count = function (body) {
        const analysed = analyseFile('lib/controllers/trinket.js',
          'var errors = require("@hapi/boom");\nmodule.exports = {\n  updateSlug : function(request, reply) {\n' +
          body + '\n  }\n};\n',
          { byTarget: new Map(), byHelper: new Map(), modulesRead: [] });
        return analysed.edges.filter(function (edge) {
          return edge.returnedBoom === true;
        }).length;
      };
      return [
        count('    return errors.conflict();'),
        count('    return ok ? request.success() : errors.conflict();'),
        count('    return reply(errors.conflict());'),
        count('    throw errors.conflict();')
      ].join('/');
    },
    expected: '1/1/0/0'
  },
  {
    // MEASURED on `users.savePassword`, `helpers.userByUsername` and four
    // more: the baseline writes `catch (err) { return reply(err); }` and Pass
    // A rows it; the conversion writes `catch (err) { return err; }` and NO
    // pass rowed it, because Pass I reads a FUNCTION'S first parameter and a
    // catch binding is not a parameter. Six preserved mappings per tree were
    // therefore measured on the baseline side only, and read as six baseline
    // edges whose counterpart had vanished.
    name: 'a caught error handed back as the response is an edge',
    run: function () {
      const read = function (body) {
        const analysed = analyseFile('lib/controllers/users.js',
          'module.exports = {\n  savePassword : async function(request, h) {\n' +
          body + '\n  }\n};\n',
          { byTarget: new Map(), byHelper: new Map(), modulesRead: [] });
        return analysed.edges.filter(function (edge) {
          return edge.returnedBoom === true &&
            /catch clause/.test(edge.shape || '');
        }).length;
      };
      return [
        // The target spelling: rowed.
        read('    try { await save(); } catch (err) { return err; }'),
        // `resolve(err)` inside a catch, the wrapped-boundary spelling.
        read('    return await new Promise(function(resolve) {\n' +
          '      try { save(); } catch (err) { return resolve(err); }\n' +
          '    });'),
        // The BASELINE spelling must NOT be rowed here - Pass A owns it and
        // reads the shim's deferred settlement. Rowing it twice would have
        // moved the baseline row count and broken the R-f reference.
        read('    try { await save(); } catch (err) { return reply(err); }'),
        // `reject` hands the error to the promise's rejection rather than
        // answering with it: that is PROPAGATE, not a response edge.
        read('    return await new Promise(function(resolve, reject) {\n' +
          '      try { save(); } catch (err) { return reject(err); }\n' +
          '    });'),
        // A `return` inside a callback DECLARED in the clause returns from
        // the callback, not from the clause, so the clause does not own it.
        read('    try { await save(); } catch (err) {\n' +
          '      list.forEach(function(x) { return err; });\n' +
          '      throw err;\n' +
          '    }')
      ].join('/');
    },
    expected: '1/1/0/0/0'
  },
  {
    // MEASURED on `admin.grantRole`. The conversion keeps a callback boundary
    // by wrapping it in `return await new Promise(function (resolve) {...})`
    // and handing the chain to `resolve`, which awaits strictly MORE than the
    // baseline's bare `return chain`. Reading the `(` of `resolve(` as the
    // end of the walk reported the target as awaited by nothing, so the
    // comparison recorded a settlement-timing difference in the direction
    // opposite to the one the code moved - on 10 rows, every one a carrier
    // converted exactly as rule T-3 prescribes.
    name: 'a chain handed to the resolve of an awaited promise is awaited',
    run: function () {
      const wrapped = 'module.exports = {\n' +
        '  grantRole : async function(request, h) {\n' +
        '    return await new Promise(function(resolve) {\n' +
        '      User.findById(request.params.id, function(err, user) {\n' +
        '        return resolve(user.grant(r).then(function(u) { return request.success(u); })\n' +
        '          .catch(function(err) { return request.fail(err); }));\n' +
        '      });\n' +
        '    });\n' +
        '  }\n};\n';
      // The same chain with nothing awaiting the promise must still read as
      // unawaited, or the fix would have replaced one wrong answer with a
      // universally permissive one.
      const loose = wrapped.replace('return await new Promise', 'new Promise');
      const read = function (src) {
        const analysed = analyseFile('lib/controllers/admin.js', src,
          { byTarget: new Map(), byHelper: new Map(), modulesRead: [] });
        const row = analysed.edges.find(function (edge) {
          return edge.propagation && edge.propagation.kind === 'promise-chain';
        });
        return row ? String(row.propagation.chainReturned) : 'no chain row';
      };
      return read(wrapped) + '/' + read(loose);
    },
    expected: 'true/false'
  },
  {
    // The same conceptual edge is class `response` on one tree and `handler`
    // on the other, and a class-first join crossed the pairs and reported
    // both as changed.
    name: 'a class flip inside a carrier does not cross the pairs',
    run: function () {
      // Both sides sit inside a chain the carrier returns, which is the real
      // shape of this pair in `lib/controllers/course.js`'s `deleteCourse`:
      // the class flips but the settlement does not move. A fixture with no
      // propagation would differ on timing instead, and hide what this test is
      // for.
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
    // The timing rule is ONE-SIDED and both sides of it are asserted here,
    // because a blanket exclusion of the dimension would have been the easy
    // wrong answer. Under the shim a chain's own value was routinely
    // discarded and rules T-1/T-3 exist to make it returned, so
    // discarded -> awaited is the migration doing what it was told and is
    // recorded rather than failed. Awaited -> discarded is a response the
    // baseline delivered and the target may drop, and it still fails.
    name: 'a settlement change is reported in both directions and prescribes nothing',
    run: function () {
      const at = function (timing) {
        return {
          funnel: FUNNEL.L3, status: 500, producesResponse: true,
          surface: SURFACE.HANDLER, payload: 'p', effects: 'none',
          logs: 'none', timing: timing
        };
      };
      const nothing = 'deferred - settles later, and nothing waits for it';
      const waits = 'deferred - settles later, and the carrier waits for it';
      const sync = 'synchronous - settles before the carrier returns';
      const read = function (a, b) {
        const split = reDifferences(at(a), at(b));
        return split.failures.length + ':' + split.prescribed.length;
      };
      return [
        // Every move, in every direction, is a reported failure and
        // prescribes nothing. An earlier edition blessed the first two as
        // rules T-1/T-3, computed from a baseline "nothing waits" the legacy
        // wrapper contradicts (`routeParser.js:567-570` awaits the deferred
        // whenever the handler returns undefined) and from a "synchronous"
        // label an async catch continuation does not satisfy. Neither input
        // held, so neither blessing may.
        read(nothing, waits),
        read(waits, sync),
        read(waits, nothing),
        read(sync, nothing),
        // No move, no difference.
        read(waits, waits)
      ].join('/');
    },
    expected: '1:0/1:0/1:0/1:0/0:0'
  },
  {
    // The settlement model must ask BOTH trees the same question. Three
    // measured defects sat here, each inventing a difference the code does
    // not have:
    //
    //   1. `reply(err)` in a catch clause read `synchronous` while the
    //      converted `return err` in the SAME clause read as a continuation,
    //      because only the pass that surfaced the second computed the flag.
    //      The asymmetry was the difference.
    //   2. An unreturned baseline chain read "nothing waits", though the
    //      shim wrapper awaits the deferred whenever the handler returns
    //      undefined (`lib/util/routeParser.js:567-570`).
    //   3. A clause guarded by a non-awaiting `try` inside an async function
    //      is genuinely synchronous, so the flag must not fire on the frame
    //      alone.
    name: 'the settlement model asks both trees the same question',
    run: function () {
      const read = function (body, shim) {
        // The baseline spells the handler `(request, reply)` and the target
        // `(request, h)`; the signature has to match the spelling or the
        // `reply(...)` pass finds nothing and the fixture proves nothing.
        const signature = shim ? '(request, reply)' : '(request, h)';
        const analysed = analyseFile('lib/controllers/users.js',
          'module.exports = {\n  savePassword : async function' + signature + ' {\n' +
          body + '\n  }\n};\n',
          { byTarget: new Map(), byHelper: new Map(), modulesRead: [] });
        analysed.edges.forEach(function (edge) { edge.shimPresent = shim; });
        const row = analysed.edges.find(function (edge) {
          return edge.disposition === DISPOSITION.REPLY_ERR ||
            edge.returnedBoom === true;
        });
        return row ? timingShape(row) : 'no row';
      };
      const awaited = '    try { await save(); } catch (err) { ';
      const sync = '    try { save(); } catch (err) { ';
      const short = function (t) {
        if (/^synchronous/.test(t)) { return 'sync'; }
        if (/nothing waits/.test(t)) { return 'unwaited'; }
        if (/carrier waits/.test(t)) { return 'waited'; }
        return t;
      };
      return [
        // 1. The baseline spelling and the target spelling of the same clause
        //    must agree. Both are continuations, so both are `waited`.
        short(read(awaited + 'return reply(err); }', true)),
        short(read(awaited + 'return err; }', false)),
        // 3. A non-awaiting try in an async function is genuinely synchronous
        //    on both sides, so the flag must not fire.
        short(read(sync + 'return reply(err); }', true)),
        short(read(sync + 'return err; }', false))
      ].join('/');
    },
    expected: 'waited/waited/sync/sync'
  },
  {
    // Surface is a location, and AAP 0.6.4 mandates extraction, so a branch
    // moving from a routed handler into an internal callee it calls is
    // prescribed. It is recorded on the row rather than dropped: a closed row
    // carrying a prescribed transition says which one.
    name: 'a surface move is recorded as prescribed, not failed, and never silently',
    run: function () {
      const at = function (surface) {
        return {
          funnel: FUNNEL.L3, status: 500, producesResponse: true,
          surface: surface, payload: 'p', effects: 'none', logs: 'none',
          timing: 'synchronous - settles before the carrier returns'
        };
      };
      const split = reDifferences(at(SURFACE.HANDLER), at(SURFACE.INTERNAL));
      return split.failures.length + ':' + split.prescribed.length + ':' +
        String(split.prescribed[0].indexOf('extraction, AAP 0.6.4') !== -1);
    },
    expected: '0:1:true'
  },
  {
    // THE INVARIANT THAT REPLACES POSITIONAL PAIRING. 78 pairs in one edition
    // of this document were filled by source order and 24 of them overrode an
    // identically-named row elsewhere, so rows were CLOSED on the order two
    // files happen to list their statements in. Closure is now permitted on
    // two tiers only - the same guarded subject, or an identical observable
    // outcome - and the nearest-outcome tier exists solely to REPORT what
    // differs, so it can never close anything.
    //
    // The fixture is the one that broke the old algorithm: an edge inserted
    // at the head of the carrier, so nothing lines up by position.
    name: 'no closed row rests on a pairing weaker than subject or identical outcome',
    run: function () {
      const chain = { kind: 'promise-chain', chainReturned: true };
      const mk = function (ordinal, offset, funnel, subject) {
        return {
          file: 'f.js', carrierMember: 'c', edgeClass: EDGE_CLASS.RESPONSE,
          offset: offset, identityBase: 'x.c.response', ordinal: ordinal,
          id: 'x.c.response.' + ordinal, disposition: DISPOSITION.BOOM,
          funnel: funnel, surface: SURFACE.HANDLER, line: offset, endLine: offset,
          thrownKind: { kind: 'boom', status: 500 }, returnedBoom: true,
          routes: [], propagation: chain,
          shape: 'throw ' + subject
        };
      };
      const joined = joinTrees(
        [mk(1, 10, FUNNEL.L3, 'a()'), mk(2, 20, FUNNEL.L1, 'b()')],
        [mk(1, 5, FUNNEL.L3, 'new()'), mk(2, 11, FUNNEL.L3, 'a()'), mk(3, 21, FUNNEL.L1, 'b()')]
      );
      const closedOnWeakTier = joined.rows.filter(function (row) {
        return (row.closure === CLOSURE.CLOSED || row.closure === CLOSURE.APPROVED) &&
          row.pairedBy && row.pairedBy.indexOf('nearest outcome') === 0;
      }).length;
      // Both baseline rows find their own subject and close; the inserted
      // edge is reported added rather than absorbed into either pair.
      return joined.summary.closed + '/' + joined.summary.added + '/' +
        joined.summary.missing + '/' + closedOnWeakTier;
    },
    expected: '2/1/0/0'
  },
  {
    // The companion to the test above, and the one that matters after the
    // settlement prescription was withdrawn. That test guards only the
    // `nearest outcome` tier; it says nothing about T2 or T3-anchored, and a
    // reviewer was right to point out that a guard which names one tier
    // proves nothing about the other two.
    //
    // The property that must hold for EVERY tier: a row may close only when
    // the two outcomes agree on every R-e dimension, with the single
    // exception of a surface move, which AAP 0.6.4 mandates. No tier, and no
    // ranking of settlements, may add to that. So this walks all four tiers
    // and asserts that not one of them closes a row whose outcomes differ on
    // an R-e dimension.
    name: 'no tier closes a row whose outcomes differ on an R-e dimension',
    run: function () {
      const chain = { kind: 'promise-chain', chainReturned: true };
      const mk = function (ordinal, offset, opts) {
        return {
          file: 'f.js', carrierMember: 'c', edgeClass: EDGE_CLASS.RESPONSE,
          offset: offset, identityBase: 'x.c.response', ordinal: ordinal,
          id: 'x.c.response.' + ordinal, disposition: DISPOSITION.BOOM,
          funnel: opts.funnel, surface: opts.surface || SURFACE.HANDLER,
          line: offset, endLine: offset,
          thrownKind: { kind: 'boom', status: opts.status || 500 },
          returnedBoom: true, routes: [],
          propagation: opts.propagation || chain,
          shape: 'throw ' + opts.subject
        };
      };
      const joins = [
        // T2 shape: same outcome, DIFFERENT subject. Closes - and that is
        // correct for R-e, because the mapping the carrier serves is
        // identical and every bijection of the pool gives this same verdict.
        // Recorded here so the behaviour is deliberate rather than incidental.
        joinTrees(
          [mk(1, 10, { funnel: FUNNEL.L3, subject: 'a()' })],
          [mk(1, 11, { funnel: FUNNEL.L3, subject: 'renamed()' })]
        ),
        // T3-anchored shape: singleton pool, different subject, and a STATUS
        // that moved. Must not close.
        joinTrees(
          [mk(1, 10, { funnel: FUNNEL.L3, status: 404, subject: 'a()' })],
          [mk(1, 11, { funnel: FUNNEL.L3, status: 500, subject: 'other()' })]
        ),
        // T3-anchored shape with a SETTLEMENT move only. Must not close.
        joinTrees(
          [mk(1, 10, {
            funnel: FUNNEL.L3, subject: 'a()',
            propagation: { kind: 'promise-chain', chainReturned: false }
          })],
          [mk(1, 11, { funnel: FUNNEL.L3, subject: 'other()' })]
        ),
        // T3-nearest shape: two candidates, funnel moved. Must not close.
        joinTrees(
          [mk(1, 10, { funnel: FUNNEL.L3, subject: 'a()' }),
            mk(2, 20, { funnel: FUNNEL.L3, status: 404, subject: 'b()' })],
          [mk(1, 11, { funnel: FUNNEL.L1, subject: 'p()' }),
            mk(2, 21, { funnel: FUNNEL.L3, status: 403, subject: 'q()' })]
        )
      ];
      // Across every join above, no closed row may carry a non-empty
      // `differences` array. `differences` holds R-e failures only; a
      // prescribed surface move is recorded separately.
      const offenders = [];
      joins.forEach(function (joined, index) {
        joined.rows.forEach(function (row) {
          const closed = row.closure === CLOSURE.CLOSED ||
            row.closure === CLOSURE.APPROVED;
          if (closed && (row.differences || []).length) {
            offenders.push('join' + index + ':' + row.id + ':' +
              row.differences.join('+'));
          }
        });
      });
      return offenders.length
        ? offenders.join(' ')
        : joins.map(function (j) { return j.summary.closed; }).join(',');
    },
    // Only the first join closes, and it closes on an identical outcome.
    expected: '1,0,0,0'
  },
  {
    // The same subject on both trees is the identity, and the printed
    // `<class>.<ordinal>` id is not: here the target's ordinals renumber
    // because the class population changed, and the pairing must follow the
    // subject rather than the name. Taking the id match on the measured
    // `course.deleteCourse` paired line 151 with line 192 and reported two
    // unchanged rows changed.
    name: 'the pairing follows the subject, not the printed ordinal',
    run: function () {
      const chain = { kind: 'promise-chain', chainReturned: true };
      const mk = function (cls, ordinal, offset, subject) {
        return {
          file: 'f.js', carrierMember: 'del', edgeClass: cls, offset: offset,
          identityBase: 'x.del.' + cls, ordinal: ordinal,
          id: 'x.del.' + cls + '.' + ordinal,
          disposition: DISPOSITION.BOOM, funnel: FUNNEL.L3, surface: SURFACE.HANDLER,
          line: offset, endLine: offset, thrownKind: { kind: 'boom', status: 500 },
          returnedBoom: true, routes: [], propagation: chain,
          shape: 'throw ' + subject
        };
      };
      const joined = joinTrees(
        [mk(EDGE_CLASS.RESPONSE, 1, 10, 'first()'), mk(EDGE_CLASS.RESPONSE, 2, 20, 'second()')],
        [mk(EDGE_CLASS.HANDLER, 1, 11, 'first()'), mk(EDGE_CLASS.RESPONSE, 1, 21, 'second()')]
      );
      const first = joined.rows[0];
      const second = joined.rows[1];
      return first.target.id + '/' + second.target.id + '/' +
        joined.summary.pairedBySubject + '/' + joined.summary.pairedByNearest;
    },
    expected: 'x.del.handler.1/x.del.response.1/2/0'
  },
  {
    // Side effects and timing are compared alongside the status, so a change
    // to either opens the row even when the status is identical. Comparing the
    // status alone closes rows whose log or settlement moved.
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
    // Two rows in one carrier that nothing distinguishes semantically. When
    // their outcomes are IDENTICAL the pairing cannot be wrong in any way
    // that matters - whichever pairs with which, both verdicts are the same -
    // so both close, and the source order they happen to sit in is irrelevant
    // rather than authoritative. When the outcomes DIFFER, nothing decides
    // which is which, and the rows are reported open on the difference
    // instead of closed on a guess: that is the second half of the property,
    // and the half the old algorithm got wrong.
    name: 'indistinguishable rows close only where their outcomes are identical',
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
      // Same two ids on both trees, in the opposite source order, same
      // outcome: both close.
      const same = joinTrees(
        [mk(1, 10, FUNNEL.L3), mk(2, 20, FUNNEL.L3)],
        [mk(2, 11, FUNNEL.L3), mk(1, 21, FUNNEL.L3)]
      );
      // One target outcome moved to a different funnel: the pair that
      // matches still closes and the one that does not is reported open.
      const moved = joinTrees(
        [mk(1, 10, FUNNEL.L3), mk(2, 20, FUNNEL.L3)],
        [mk(2, 11, FUNNEL.L3), mk(1, 21, FUNNEL.L1)]
      );
      const weak = moved.rows.filter(function (row) {
        return row.closure === CLOSURE.CLOSED &&
          row.pairedBy && row.pairedBy.indexOf('nearest outcome') === 0;
      }).length;
      return same.summary.closed + '/' + same.summary.open + '/' +
        moved.summary.closed + '/' + moved.summary.open + '/' + weak;
    },
    // In `moved`, one pair still matches on identical outcome and closes; the
    // remaining two rows are paired at the nearest-outcome tier, which
    // reports the funnel difference as ONE open changed row rather than as
    // two unpaired rows - the difference is what a reviewer needs, and it
    // still cannot close.
    expected: '2/0/1/1/0'
  },
  {
    // MEASURED on `helpers.trinketByOwnerAndSlug`, three mutually
    // indistinguishable `throw Boom.notFound()` edges per tree whose outcome
    // moved on both sides of the shim's removal, and on four more helpers
    // whose residual pool is 1-to-1. Every one read as a vanished baseline
    // edge plus an appeared target edge, when the fact a reader needs is the
    // dimension that moved.
    //
    // The tier pairs by position, and that is sound ONLY under the two
    // conditions this test pins: both sides uniform, and equal in size. Then
    // every bijection gives the same verdict on the same rows, so order
    // cannot change the answer. Both negative halves must decline, or the
    // tier would be the positional gap-filling this join removed.
    name: 'a uniform residual pool of equal size pairs order-independently',
    run: function () {
      const chain = { kind: 'promise-chain', chainReturned: true };
      const mk = function (ordinal, offset, funnel) {
        return {
          file: 'f.js', carrierMember: 'c', edgeClass: EDGE_CLASS.RESPONSE,
          offset: offset, identityBase: 'x.c.response', ordinal: ordinal,
          id: 'x.c.response.' + ordinal, disposition: DISPOSITION.BOOM,
          funnel: funnel, surface: SURFACE.HANDLER, line: offset, endLine: offset,
          thrownKind: { kind: 'boom', status: 404 }, returnedBoom: true,
          routes: [], propagation: chain
        };
      };
      const tierOf = function (joined) {
        return joined.rows.filter(function (row) {
          return row.pairedBy && row.pairedBy.indexOf('uniform residual pool') === 0;
        }).length;
      };
      // 3 uniform baseline edges against 3 uniform target edges whose funnel
      // moved: all three pair, all three report the difference, none closes.
      const uniform = joinTrees(
        [mk(1, 10, FUNNEL.NONE), mk(2, 20, FUNNEL.NONE), mk(3, 30, FUNNEL.NONE)],
        [mk(1, 11, FUNNEL.L3), mk(2, 21, FUNNEL.L3), mk(3, 31, FUNNEL.L3)]
      );
      // Unequal size: declines, and the rows stay unpaired.
      const unequal = joinTrees(
        [mk(1, 10, FUNNEL.NONE), mk(2, 20, FUNNEL.NONE)],
        [mk(1, 11, FUNNEL.L3)]
      );
      // Equal size but the TARGET side is not uniform, so which baseline row
      // takes which target row would decide the verdict: declines.
      const mixed = joinTrees(
        [mk(1, 10, FUNNEL.NONE), mk(2, 20, FUNNEL.NONE)],
        [mk(1, 11, FUNNEL.L3), mk(2, 21, FUNNEL.L1)]
      );
      // A uniform pool whose only movement is a settlement move. It must
      // stay OPEN. An earlier edition ranked the settlements and blessed a
      // forward move, which closed 5 measured rows on exactly this shape;
      // both inputs to that ranking were then found unsound, so the
      // settlement prescription was withdrawn and these rows report the
      // difference instead. The tier chooses WHICH row to compare against;
      // it never decides the verdict.
      const forward = function (offset, waits) {
        const row = mk(1, offset, FUNNEL.L3);
        row.propagation = { kind: 'promise-chain', chainReturned: waits };
        return row;
      };
      const prescribed = joinTrees([forward(10, false)], [forward(11, true)]);
      return tierOf(uniform) + ':' + uniform.summary.closed + ':' + uniform.summary.changed +
        '/' + tierOf(unequal) + '/' + tierOf(mixed) +
        '/' + prescribed.summary.closed + ':' + prescribed.summary.open;
    },
    // Three paired, none closed, three reported changed; then zero and zero;
    // then the settlement-only pair OPEN and not closed, because no tier and
    // no rank may authorize a settlement move.
    expected: '3:0:3/0/0/0:1'
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
  },
  {
    // The partition must be TOTAL and DISJOINT over every closure state, or
    // a state nobody classified is counted open by default and the
    // authoritative total stops matching its own buckets. MEASURED: adding
    // the two mechanism states without classifying them made the total read
    // 74 while the buckets summed to 53.
    name: 'every closure state is classified exactly once',
    run: function () {
      const states = Object.keys(CLOSURE).map(function (key) {
        return CLOSURE[key];
      });
      const unclassified = [];
      const doubled = [];
      states.forEach(function (state) {
        const homes = [OPEN_CLOSURES, CLOSED_CLOSURES, NOT_COMPARED_CLOSURES]
          .filter(function (list) {
            return list.indexOf(state) !== -1;
          }).length;
        if (homes === 0) {
          unclassified.push(state);
        } else if (homes > 1) {
          doubled.push(state);
        }
      });
      return states.length + '/' + (unclassified.length
        ? 'unclassified: ' + unclassified.join(', ')
        : '0') + '/' + (doubled.length ? 'doubled: ' + doubled.join(', ') : '0');
    },
    expected: '10/0/0'
  },
  {
    name: 'one predicate decides open, and the summary partition sums to it',
    run: function () {
      const chain = { kind: 'promise-chain', chainReturned: true };
      const mk = function (carrier, cls, ordinal, offset, funnel, extra) {
        return Object.assign({
          file: 'f.js', carrierMember: carrier, edgeClass: cls, offset: offset,
          identityBase: 'x.' + carrier + '.' + cls, ordinal: ordinal,
          id: 'x.' + carrier + '.' + cls + '.' + ordinal,
          disposition: DISPOSITION.BOOM, funnel: funnel, surface: SURFACE.HANDLER,
          line: offset, endLine: offset, thrownKind: { kind: 'boom', status: 500 },
          returnedBoom: true, routes: [], propagation: chain
        }, extra || {});
      };
      // One closed pair, one changed pair, one baseline row with no target,
      // one target row with no baseline, and one pair that compares equal on
      // an edge whose reachability is unresolved.
      const joined = joinTrees(
        [mk('a', EDGE_CLASS.RESPONSE, 1, 10, FUNNEL.L3),
          mk('b', EDGE_CLASS.RESPONSE, 1, 20, FUNNEL.L3),
          mk('c', EDGE_CLASS.RESPONSE, 1, 30, FUNNEL.L3),
          mk('e', EDGE_CLASS.RESPONSE, 1, 50, FUNNEL.L3, { unresolved: true })],
        [mk('a', EDGE_CLASS.RESPONSE, 1, 11, FUNNEL.L3),
          mk('b', EDGE_CLASS.RESPONSE, 1, 21, FUNNEL.L1),
          mk('d', EDGE_CLASS.RESPONSE, 1, 41, FUNNEL.L3),
          mk('e', EDGE_CLASS.RESPONSE, 1, 51, FUNNEL.L3, { unresolved: true })]
      );
      const sum = joined.summary;
      const partition = Object.keys(sum.openByBucket).reduce(function (total, key) {
        return total + sum.openByBucket[key];
      }, 0) + sum.openProvisional;
      const direct = joined.rows.filter(isOpenRow).length;
      return sum.open + '/' + partition + '/' + direct;
    },
    expected: '4/4/4'
  },
  {
    // A coverage claim is only evidence if a rotted binding is loud. All
    // three failure modes are asserted, because each of them would otherwise
    // put a driven-looking row in a generated R-e deliverable that nothing
    // drives: a binding matching nothing has gone stale against a tree that
    // moved, one matching two edges marks both driven when one was, and one
    // naming a scenario the corpus does not hold is a claim about a request
    // nobody sends.
    name: 'a binding that does not resolve to exactly one edge is reported',
    run: function () {
      // The first declared binding is pages.login / reply-property:redirect,
      // so these fixtures are built to hit and to miss exactly it.
      const shape = 'synchronous throw (TypeError: reply.redirect is not a function)';
      const edge = function (carrier) {
        return {
          id: 'f.' + carrier + '.response.1', file: 'lib/controllers/pages.js',
          carrier: carrier, shape: shape, routes: ['GET /login'],
          line: 1, endLine: 1
        };
      };
      const corpus = function (pairs) {
        return {
          byEdgeId: new Map(), byRoute: new Map(),
          routeOfScenario: new Map(pairs)
        };
      };
      const known = corpus([['quirk.authed-500.get.login', 'GET /login']]);
      const none = resolveEdgeBindings([], known, 't').unresolved.length > 0;
      const two = resolveEdgeBindings(
        [edge('pages.login'), edge('pages.login')], known, 't'
      ).unresolved.filter(function (problem) {
        return problem.indexOf('resolved 2 edges') !== -1;
      }).length;
      const one = resolveEdgeBindings([edge('pages.login')], known, 't');
      const absent = resolveEdgeBindings([edge('pages.login')], corpus([]), 't')
        .unresolved.filter(function (problem) {
          return problem.indexOf('which the corpus does not contain') !== -1;
        }).length;
      return String(none) + '/' + two + '/' +
        String(one.byEdgeId.has('f.pages.login.response.1')) + '/' + absent;
    },
    expected: 'true/1/true/1'
  },
  {
    // MEASURED as a live regression: a figure added to this section counted
    // over `model.closure.rows`, which is null whenever no `--baseline` is
    // given. The two-tree invocation passed and BOTH the single-tree and
    // baseline-tree invocations died with `TypeError: Cannot read properties
    // of null (reading 'rows')` - caught only by exercising every invocation
    // mode, not the one mode the document is normally generated in.
    //
    // Coverage is a property of an edge and a corpus, never of a comparison,
    // so this section must not reach into the closure model at all. Pinned
    // against the generator's own source, which is the only place the
    // constraint can be expressed: the renderer is not exported and building
    // a whole model fixture would test the fixture rather than the rule.
    name: 'the how-to-read section never reaches into the closure model',
    run: function () {
      const own = classifySource(
        fs.readFileSync(__filename, 'utf8'), 'self-test: own source').codeOnly;
      const at = own.indexOf('function renderHowToRead(');
      if (at === -1) {
        return 'renderHowToRead not found';
      }
      const brace = own.indexOf('{', at);
      const end = matchDelimiter(own, brace);
      if (end === -1) {
        return 'renderHowToRead body not delimited';
      }
      const body = own.slice(brace, end);
      const reaches = /model\.closure/.test(body);
      // And the figure it does compute must come from the same set section 9
      // counts over, or the two figures could disagree.
      const fromAllEdges = /model\.allEdges\.filter/.test(body);
      return String(reaches) + '/' + String(fromAllEdges);
    },
    expected: 'false/true'
  },
  {
    // A repeated key in an object literal is collapsed by the parser, so
    // `outcomeOf` was exported twice with the second binding silently
    // shadowing the first and nothing anywhere raising. The finished object
    // cannot reveal it - by the time it exists the duplicate is gone - so
    // this reads THIS FILE'S OWN SOURCE, with comments and string literals
    // blanked by the same tokenizer the analysis uses, so a name that appears
    // in prose cannot be mistaken for a key.
    name: 'the export table declares every key exactly once',
    run: function () {
      const own = classifySource(fs.readFileSync(__filename, 'utf8'), 'self-test: own source').codeOnly;
      const at = own.lastIndexOf('module.exports = {');
      if (at === -1) {
        return 'no export table found';
      }
      const open = own.indexOf('{', at);
      const close = matchDelimiter(own, open);
      if (close === -1) {
        return 'unbalanced export table';
      }
      const seen = Object.create(null);
      const duplicates = [];
      const body = own.slice(open + 1, close);
      let depth = 0;
      let field = '';
      const take = function (text) {
        const key = text.split(':')[0].trim();
        if (!key) {
          return;
        }
        if (seen[key]) {
          duplicates.push(key);
        }
        seen[key] = true;
      };
      for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (OPENERS[ch]) {
          depth++;
        } else if (CLOSERS[ch]) {
          depth--;
        }
        if (ch === ',' && depth === 0) {
          take(field);
          field = '';
          continue;
        }
        field += ch;
      }
      take(field);
      return duplicates.length
        ? 'duplicated: ' + duplicates.sort().join(', ')
        : String(Object.keys(seen).length > 40);
    },
    expected: 'true'
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
  // The distance-to-the-next-declaration reading breaks whenever one carrier
  // is declared INSIDE another, and this repository does that:
  // `lib/controllers/courses.js` declares `var returnZip = function(zipFile)`
  // indented inside the routed handler `download`, and the `topLevel` pattern
  // above matches it because it allows leading indentation. Measured to the
  // next declaration, `returnZip` would then swallow the sites after it in
  // `download`'s own body - including the `else` branch that answers the
  // request - and report them under the carrier
  // `courses.returnZip (module-local)` with no routes, so a routed edge on
  // `GET /{userSlug}/courses/{courseSlug}/download.zip` would look unrouted
  // and undrivable.
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

/**
 * Map controller methods and named pre-handlers to the routes that bind them,
 * read from the literal `route :` declarations in config/routes.js and
 * config/api_routes.js.
 *
 * These are the literal declarations. config/routes.js expands a subset of them
 * per language at parse time, so the registered surface is larger; a row
 * reports the literal declaration and says so, and test/parity/manifest.js
 * records the expanded surface. A tree missing either module still yields a
 * complete inventory - carriers name the reachable code path instead.
 *
 * @param {string} appRoot the tree being analysed
 * @returns {Object} { byTarget, byHelper, templatedFailRedirects, modulesRead }
 */
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
 * Two readings that look like this one are dead. `!edge.carrier` is satisfied
 * by no edge at all, because `push()` substitutes the literal
 * `'(module scope)'` when carrier resolution finds nothing;
 * `edge.carrierMember && surface !== MODULE` is satisfied by every non-module
 * edge by construction, so a function nothing anywhere calls comes back
 * drivable. Display metadata being present is not evidence that anything can
 * reach the code.
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
// `Boom.notFound()` is a Boom factory only when `Boom` is bound, and in the
// baseline tree it often is not: several of the ten controllers import
// @hapi/boom under another name - `errors` in `lib/controllers/course.js`,
// `courses.js`, `folders.js`, `admin.js` and `users.js` - and then write
// `Boom.` anyway, so the expression constructs nothing and throws
// `ReferenceError: Boom is not defined` when the line is evaluated. Each such
// site gets its own row, so the document is where their number is recorded.
//
// The distinction decides the status, and it is not the same on both trees. On
// a route handler, `return Boom.forbidden()` with `Boom` bound is answered
// 403; with `Boom` unbound the evaluation throws before any value exists, the
// handler catch-all takes the ReferenceError, and the answer is 500 with
// Boom's generic 5xx body. A row stating 403 there would describe a response
// no client receives. A tree that binds `Boom` in every controller makes the
// same text a factory, which is why binding resolution rather than text
// matching is what makes a baseline row and its target row comparable.
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
 * A flat per-file name set is wrong in a way that matters: `var Boom = ...`
 * inside one function makes every `Boom.` in a sibling function of the same
 * file read as a bound Boom factory, so a line that throws `ReferenceError` at
 * runtime is recorded with the status its factory name reads as. Scope
 * resolution is therefore not a refinement of this resolver - it is what makes
 * its answer correct.
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
  // altogether: a `var Boom` inside one function would bind `Boom` for the
  // whole file, which is the exact defect the scope model exists to remove. An
  // implicit global is an assignment to an UNDECLARED identifier, so the
  // declared offsets are excluded by identity rather than by a backwards
  // pattern match.
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
  // binds it - which silently restores the very misclassification the
  // resolver exists to remove. `lib/controllers/course.js` carries such links
  // and never binds `Boom`, so its unbound references are what this exclusion
  // protects.
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
      // reports the chain as neither returned nor awaited. chainContext walks
      // the chain instead, which is why this call site uses it.
      //
      // The consequence reaches the row's own claim: `courses.download` returns
      // its chain and its `.catch` returns `errors.badImplementation(...)`, so
      // the edge answers 500 - but with chainReturned false, funnel resolution
      // takes a returned Boom in an unawaited chain to reach no funnel at all.
      // The row would then say the request is never answered and the
      // comparison would report a difference where there is none, which is
      // worse than a missing row because it sends someone to preserve
      // behaviour that is already preserved.
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
 * Layer 1 writes to the error log - a side effect the inventory records and
 * the closure comparison checks.
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
 * callback logging the outer error. The asset-from-URL handler in
 * `lib/controllers/users.js` is that shape -
 *
 *   tmp.tmpName(function(err, tmpPath) {        <- this err: never read
 *     _request.get(...)
 *       .on('error', function(err) {            <- a DIFFERENT err, shadowing
 *         console.log('on error:', err);
 *
 * - where counting the shadowed log makes the outer row `logs and continues`
 * although the outer `err` is discarded without a trace: two dispositions a
 * reviewer must be able to tell apart, reported as one.
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
 * A scanner knowing only the fixed tokens sees that catch handler produce
 * nothing, classifies it as absorbing the error, and gives the
 * `throw Boom.notFound()` sites upstream a funnel of `none` - so edges that
 * answer 500 are reported as answering nothing and the comparison against the
 * baseline reports a difference that does not exist. The conversion changes
 * the NAME of the response builder, not whether a response is built, and this
 * is what keeps the analysis from mistaking the one for the other.
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

// The shim builder's members that RESOLVE the deferred response, read from
// the baseline `lib/util/routeParser.js:374-404`: `redirect`, `code`,
// `header` and `view` each call `responseResolver(response)` and return the
// real hapi response, while `type` and `bytes` mutate the response and return
// the builder without resolving anything. That asymmetry is the mechanism
// behind the reply-chain quirks AAP 0.6.6 catalogues, and it is also what
// makes the produced KIND readable: the last resolving member is the response
// the client actually receives.
const SHIM_RESOLVING_MEMBERS = Object.freeze({
  redirect: 'a redirect',
  view: 'a rendered view',
  // `.code(n)` and `.header(k, v)` resolve a plain response, which is the
  // same kind the target's `h.response(...)` produces - so naming them the
  // same thing is what lets the pair compare equal.
  code: 'a response value',
  header: 'a response value'
});

/**
 * The producing callee's name for a response call, following the shim's
 * builder chain where there is one.
 *
 * `reply` is the shim's ONE universal producer, so its own name reveals
 * nothing about what the client receives - and this generator says so rather
 * than guessing, which is right. What it must not do is stop there when the
 * source DOES say: `return reply().redirect("/home")` produces a redirect,
 * and reading only the `reply` token recorded it as unknowable.
 *
 * MEASURED at baseline `lib/controllers/classes.js:216-219`, whose `.catch`
 * ends `return reply().redirect("/home")`, and at five further baseline
 * sites. Against a target that produces `h.redirect(...)` - correctly read as
 * a redirect - the comparison reported a payload difference on all six,
 * because an unknown was being compared against a known and the mismatch
 * counted as a change. Those are the same response by two means, which is
 * exactly what the mechanism-is-not-compared rule exists for.
 *
 * A chain with NO resolving member is still unknowable and still says so:
 * that is the never-settling `reply(stream).type().bytes()` shape and the
 * builder-returned `reply(x).type(t)` shape, whose outcomes AAP 0.6.6 settles
 * by measurement rather than from the text.
 *
 * @param {Object} ctx the file analysis context
 * @param {Object} hit a responseCallsDirectlyIn entry
 * @returns {string} the producer name, `reply().<member>` where one resolves
 */
function producerName(ctx, hit) {
  const base = hit.token.replace('(', '');
  if (base !== 'reply') {
    return base;
  }
  const open = ctx.codeOnly.indexOf('(', hit.offset);
  if (open === -1) {
    return base;
  }
  const close = matchDelimiter(ctx.codeOnly, open);
  if (close === -1) {
    return base;
  }
  let resolver = null;
  chainLinksAfter(ctx.codeOnly, close).forEach(function (link) {
    if (Object.prototype.hasOwnProperty.call(SHIM_RESOLVING_MEMBERS, link.name)) {
      resolver = link.name;
    }
  });
  return resolver ? 'reply().' + resolver : base;
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
 * Reading only the token immediately behind the offset answers the question
 * for `return reply(x)` and gets it wrong for every expression that reaches
 * the offset through an operator. Two sites in the analysed set are exactly
 * that shape - in `lib/util/helpers.js`:
 *
 *     return isValid ? reply(lang) : reply(Boom.notFound());
 *
 * and in `lib/controllers/trinket.js`:
 *
 *     return err === "threshold exceeded" ? reply(errors.forbidden()) : reply();
 *
 * The token behind each inner `reply(` is `?` or `:`, and both values are
 * returned. Getting that wrong matters after conversion: "with no return"
 * tells an implementing agent the value is discarded today and must start
 * being returned, while here it is already returned and the conversion has
 * nothing to change.
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
    // is a real return in `lib/controllers/trinket.js`, and the string literal
    // in the condition is BLANKED by the tokenizer, so walking back from the
    // inner `reply(` crosses `?`, then a run of spaces where the literal was,
    // and lands on the `=` of `===`. Reading that as an assignment stops the
    // walk one token short of the `return` and reports a returned value as
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
    // `return` at its head, so the walk continues through them. What STOPS the
    // walk is enumerated above rather than what continues it: a list of
    // continuing operators stops at the first operator missing from it, which
    // is how a condition containing `===` would end the walk early.
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
function chainContext(ctx, offset, depth) {
  const code = ctx.codeOnly;
  let head = offset;
  let i = skipSpaceBack(code, offset - 1);
  const hops = depth || 0;

  // Walk back along the chain itself rather than using statementBounds, whose
  // backward walk cannot see past an intervening block: an `if (...) { ... }`
  // earlier in the same handler masks the `;` that would have bounded the
  // statement, and the walk then reports the function body's own start with
  // no `return` in front of it. `lib/controllers/pages.js`'s `home` handler is
  // that shape and its chain IS returned, so the naive reading gets both the
  // line and the awaited-ness wrong - the two fields this clause exists to
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
    // THE CHAIN IS AN ARGUMENT, AND ONE CALLEE MAKES IT AWAITED ANYWAY.
    //
    // The walk stops at an opening `(` because an argument is not part of the
    // chain - correct in general, and wrong for exactly one callee. The
    // conversion's own idiom for a carrier that still has a callback boundary
    // inside it is
    //
    //   return await new Promise(function (resolve) {
    //     Model.find(..., function (err, doc) {
    //       return resolve(chain.then(...).catch(...));
    //     });
    //   });
    //
    // and a chain handed to that `resolve` settles the promise the carrier is
    // awaiting, so the carrier waits for it. Reading the bare `(` instead
    // reported it as awaited by nothing.
    //
    // MEASURED on `admin.grantRole`: the baseline `return user.grant(...)
    // .then(...).catch(...)` reads awaited, and the target - the shape above,
    // which awaits strictly MORE - read unawaited. The comparison then
    // reported a settlement-timing difference in the direction opposite to
    // the one the code moved, on 10 rows across the tree, every one of them a
    // carrier converted exactly as rule T-3 prescribes.
    //
    // So `resolve(`/`reject(` are transparent here: the question becomes
    // whether the promise they settle is itself awaited, which is the same
    // question one level out, answered by the same walk.
    if (ch === '(' && hops < 4) {
      const before = skipSpaceBack(code, i - 1);
      if (before >= 0 && isIdentifierChar(code[before])) {
        const callee = readMemberPathBack(code, before);
        const tail = String(callee.text || '').split('.').pop();
        if (tail === 'resolve' || tail === 'reject') {
          const promiseAt = enclosingPromiseConstructor(code, i);
          if (promiseAt !== -1) {
            const outer = chainContext(ctx, promiseAt, hops + 1);
            return {
              line: lineFromIndex(ctx.lineIndex, head),
              awaited: outer.awaited,
              boundTo: outer.boundTo || null,
              viaSettler: tail
            };
          }
        }
      }
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

/**
 * The offset of the `new Promise(` expression whose executor encloses
 * `offset`, or -1.
 *
 * Nearest first, and verified by containment rather than by proximity: a
 * sibling `new Promise` earlier in the same function is closer in the text
 * than the enclosing one is only when the enclosing one is further back, so
 * the candidate is accepted only when its own argument list actually spans
 * the offset.
 *
 * @param {string} code the blanked source
 * @param {number} offset an offset inside the executor
 * @returns {number} offset of the `new` keyword, or -1
 */
function enclosingPromiseConstructor(code, offset) {
  let at = code.lastIndexOf('new Promise', offset);
  while (at !== -1) {
    const open = code.indexOf('(', at + 'new Promise'.length);
    if (open !== -1) {
      const close = matchDelimiter(code, open);
      if (close > offset && open < offset) {
        return at;
      }
    }
    at = at > 0 ? code.lastIndexOf('new Promise', at - 1) : -1;
  }
  return -1;
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
// `lib/util/helpers.js`'s `internals.userByLogin` is the shape this answers:
// declared at one offset and mentioned nowhere else in the corpus, so it is
// dead code. Without the search its error edge would claim a funnel it cannot
// have; with it the row is proven unreachable, says so, and is excluded from
// the closure gate rather than counted as proof of anything.
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
    // Literal-substring counts, directly comparable to the
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
      precedence: spec.precedence,
      // Stamped for every edge, so the two trees are asked the same question.
      asyncContinuation: inAsyncCatchContinuation(ctx, offset)
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
    // evaluates any argument, so where `reply` is itself unbound the exception
    // names `reply` and the argument is never evaluated at all - even when the
    // argument would have thrown too. `return reply(Boom.forbidden())` with
    // neither name bound throws `ReferenceError: reply is not defined`.
    // Reading the argument first puts the wrong identifier in the message and
    // therefore the wrong text in Layer 1's log, which this inventory records
    // and compares. The status and the funnel are the same either way; the
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

  // -- Pass E: a Boom whose value is RETURNED ------------------------------
  // Absent from the baseline tree in its `return Boom.x()` form - it has no
  // such site - and present after conversion, which is exactly why it is
  // detected: the contrast with `throw` is a 404 against a 500.
  //
  // WHY THIS IS NOT `return\s+Boom\.`, WHICH IT WAS. A returned expression is
  // not always a bare factory call. MEASURED on `trinket.updateSlug`: the
  // baseline's `reply(errors.conflict())` at `:1283` is an edge that answers
  // 409, and the target expresses the same mapping as
  //
  //   return trinket.updateSlug(...).then(function (result) {
  //     return result ? request.success() : errors.conflict();
  //   })
  //
  // whose `errors.conflict()` sits in a ternary branch and matched no
  // `return`-prefixed pattern. It got NO ROW, so status 409 fell from one
  // occurrence to zero across the whole target tree and the comparison
  // reported the 409 mapping as lost when it is preserved - the single worst
  // kind of false statement this document can make, because R-e is about
  // exactly that status.
  //
  // So the pass asks the question it means: is this factory's VALUE returned?
  // `isReturned` already answers it for the ternary shape - it carries its
  // own measurement for `trinket.js:881` - and it answers no for
  // `reply(Boom.x())`, where the value is consumed by an argument list that
  // Pass A already recorded, and no for `throw Boom.x()`, which Pass D owns.
  const boomFactory = /\b((?:Boom|errors|Hapi)\.(?:error\.)?[A-Za-z0-9_$]+)/g;
  while ((m = boomFactory.exec(codeOnly)) !== null) {
    const exprStart = m.index;
    if (!isReturned(codeOnly, exprStart)) {
      continue;
    }
    // The locator stays on the `return` keyword where there is one directly
    // in front, so no existing row's line moves; a value returned from
    // somewhere else in the expression is located at its own text.
    let at = exprStart;
    const backAt = skipSpaceBack(codeOnly, exprStart - 1);
    if (backAt >= 0 && isIdentifierChar(codeOnly[backAt])) {
      const preceding = readMemberPathBack(codeOnly, backAt);
      if (preceding.text === 'return') {
        at = preceding.start;
      }
    }
    // Binding-resolved for the same reason as every other Boom site: an
    // unbound holder throws while evaluating the return expression, so the
    // value is never returned and the contrast this pass exists to record -
    // a returned Boom's 404 against a thrown Boom's 500 - does not apply.
    const kind = valueKind(m[1], facts.bindings, exprStart);
    const unbound = kind.kind === 'unbound-reference';
    terminalOffsets.push(at);
    push(at, {
      precedence: 10,
      edgeClass: EDGE_CLASS.RESPONSE,
      disposition: DISPOSITION.BOOM,
      shape: (unbound
        ? 'synchronous throw (ReferenceError: ' + kind.holder + ' is not defined) evaluating return '
        : 'return ') + summarise(src.slice(exprStart, exprStart + 60).split('\n')[0]),
      thrownKind: kind,
      returnedBoom: !unbound,
      propagation: propagationAt(ctx, at)
    });
  }

  // -- Pass I: the error value handed back AS the response -----------------
  // The baseline says `reply(err)` and Pass A rows it. The conversion says
  // `return err` - or, where the carrier keeps a callback boundary inside a
  // `new Promise`, `resolve(err)` - and until now nothing rowed that at all.
  //
  // MEASURED on `users.savePassword`, whose baseline has three `reply(err)`
  // sites and whose target expresses all three as `resolve(err)`: the target
  // carried no row for any of them, so three preserved Layer 3 / 500
  // mappings read as three baseline edges that had vanished. Twelve rows
  // across the tree had that shape. The gap is narrow and specific: Pass H
  // rows an error parameter NOTHING dispositions, and these are dispositioned
  // - by being handed back - while Passes A-E row only the OTHER terminal in
  // the same callback, so the disposition fell between the two.
  //
  // The scanner already carries this concept for a `.catch` handler, whose
  // shape reads "returns the error as the response"; 51 target edges use it.
  // This is the same fact about a callback body.
  ctx.functions.forEach(function (fn) {
    const params = parameterNames(fn);
    if (!params.length || !isErrorParameter(params[0])) {
      return;
    }
    // A `.catch`/`.then` rejection handler and an `.on('error', ...)`
    // listener belong to Pass F, which already reads "returns the error as
    // the response" and says so with the mechanism named. Rowing them here
    // as well SHADOWED 30 of Pass F's richer rows on the first measurement,
    // replacing ".catch() handler - returns the error as the response" with
    // a bare "return err" that loses the mechanism. Pass I is for the CPS
    // callbacks nothing else covers.
    const site = callSiteOf(codeOnly, fn);
    if (site && (PROMISE_CONTINUATIONS.has(site.calleeTail) ||
        SYNCHRONOUS_ITERATEES.has(site.calleeTail) ||
        LISTENER_REGISTRARS.indexOf(site.calleeTail) !== -1)) {
      return;
    }
    const name = params[0];
    const escaped = name.replace(/\$/g, '\\$');
    // `return err` and `resolve(err)`. NOT `reject(err)`: that hands the
    // error to the promise's rejection rather than answering with it, which
    // is the PROPAGATE disposition the existing passes already record.
    const pattern = new RegExp(
      '\\breturn\\s+' + escaped + '(?![A-Za-z0-9_$.])' +
      '|\\bresolve\\s*\\(\\s*' + escaped + '\\s*\\)', 'g'
    );
    const body = codeOnly.slice(fn.bodyStart, fn.bodyEnd);
    let hit;
    while ((hit = pattern.exec(body)) !== null) {
      const at = fn.bodyStart + hit.index;
      const inner = innermostFunction(ctx.functions, at);
      if (!inner || inner.bodyStart !== fn.bodyStart) {
        continue;
      }
      const identifierAt = at + hit[0].indexOf(name);
      const kind = valueKind(name, facts.bindings, identifierAt);
      terminalOffsets.push(at);
      push(at, {
        precedence: 10,
        edgeClass: EDGE_CLASS.RESPONSE,
        disposition: DISPOSITION.BOOM,
        shape: hit[0].indexOf('resolve') === 0
          ? 'resolve(' + name + ') - hands the error back as the response, ' +
            'settling the promise the carrier awaits'
          : 'return ' + name + ' - hands the error back as the response',
        valueKind: kind,
        returnedBoom: true,
        returned: true,
        propagation: propagationAt(ctx, at)
      });
    }
  });

  // -- Pass J: the caught error handed back AS the response ----------------
  // The same fact as Pass I, in the one syntactic position Pass I cannot
  // reach. Pass I walks `ctx.functions` and reads the first parameter, so it
  // sees a CALLBACK whose error argument is handed back. A `catch (err) {}`
  // clause is not a function and its binding is not a parameter, so nothing
  // rowed it.
  //
  // MEASURED across both trees: six catch clauses per tree carry the shape.
  // On the baseline they read `reply(err)`, which Pass A rows - `folders.js`
  // :60, `users.js`:283, :309, :749, `helpers.js`:363, :393, every one of
  // them a row this join reported as a baseline edge with no counterpart. On
  // the target the same disposition is written `return err` at
  // `classes.js`:207, `course.js`:1041, `users.js`:906, :934, :1711 and
  // `helpers.js`:376, and NO pass rowed any of them. The preserved Layer 3
  // mapping was therefore invisible on one side of the comparison only,
  // which is a defect in the scanner and not a change in the application.
  //
  // `reply(err)` is deliberately NOT matched here: Pass A owns it, reads the
  // shim's deferred settlement, and says so. This pass adds the target
  // spelling, so that both sides of a preserved mapping are measured the
  // same way.
  const catchClause = /\bcatch\s*\(\s*([A-Za-z0-9_$]+)\s*\)\s*\{/g;
  let caught;
  while ((caught = catchClause.exec(codeOnly)) !== null) {
    const name = caught[1];
    if (!isErrorParameter(name)) {
      continue;
    }
    const braceAt = caught.index + caught[0].length - 1;
    const bodyEnd = matchDelimiter(codeOnly, braceAt);
    if (bodyEnd === -1) {
      continue;
    }
    // The frame the clause runs on. A `return` nested in a callback DECLARED
    // inside the clause returns from that callback, not from here, so the
    // disposition belongs to the callback and Pass I owns it.
    const clauseFrame = innermostFunction(ctx.functions, braceAt);
    const escaped = name.replace(/\$/g, '\\$');
    // `return err` and `resolve(err)`, for the reason Pass I states: NOT
    // `reject(err)`, which is the PROPAGATE disposition.
    const pattern = new RegExp(
      '\\breturn\\s+' + escaped + '(?![A-Za-z0-9_$.])' +
      '|\\bresolve\\s*\\(\\s*' + escaped + '\\s*\\)', 'g'
    );
    const body = codeOnly.slice(braceAt, bodyEnd);
    let hit;
    while ((hit = pattern.exec(body)) !== null) {
      const at = braceAt + hit.index;
      const frame = innermostFunction(ctx.functions, at);
      const sameFrame = clauseFrame
        ? Boolean(frame) && frame.bodyStart === clauseFrame.bodyStart
        : !frame;
      if (!sameFrame) {
        continue;
      }
      const identifierAt = at + hit[0].indexOf(name);
      const kind = valueKind(name, facts.bindings, identifierAt);
      terminalOffsets.push(at);
      push(at, {
        precedence: 10,
        edgeClass: EDGE_CLASS.RESPONSE,
        disposition: DISPOSITION.BOOM,
        shape: (hit[0].indexOf('resolve') === 0
          ? 'resolve(' + name + ')'
          : 'return ' + name) +
          ' in a catch clause - hands the caught error back as the response',
        valueKind: kind,
        returnedBoom: true,
        returned: true,
        propagation: propagationAt(ctx, at)
      });
    }
  }

  const terminalSet = terminalOffsets.slice().sort(function (a, b) {
    return a - b;
  });

  /**
   * Whether `fn` dispositions an error ON ITS OWN STACK.
   *
   * Terminal ownership has to be innermost-aware. Asking only whether a
   * terminal offset falls anywhere between `fn.bodyStart` and `fn.bodyEnd` is
   * true for every terminal in every function nested inside `fn` as well. The
   * asset-from-URL handler in `lib/controllers/users.js` is the case that
   * exposes it:
   *
   *   tmp.tmpName(function(err, tmpPath) {          <- err, never inspected
   *     _request.get(...)
   *       .on('end', function() {
   *         FileUtil.uploadUserAsset(..., function(err, file) {
   *           if (err) return request.fail(err);     <- a terminal, 3 frames in
   *
   * The `request.fail` four frames down makes the outer `tmp.tmpName` callback
   * look as though it disposed of its own `err`, so Passes F, G and H would
   * all skip it and the failure of `tmp.tmpName` - which discards `err` and
   * then uses an undefined path - would get no row at all, although it is a
   * genuine edge with a genuine disposition.
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
   * Three vehicles, all of them present in this repository:
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
    // by the handler it was extracted from - `lib/controllers/course.js` calls
    // its own `module.exports.createCourseCore(...)` that way - so a pattern
    // recognising only `internals.` traces such a core to no caller at all,
    // its callback's row resolves `unresolved`, and generation stops with no
    // document written. A qualifier naming this module's own exports is a call
    // to a member of this module, which is exactly what is being traced.
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
    // form of `return reply(err)`, and hapi normalizes a returned Error itself
    // - `Response.wrap` boomifies it - so a controller wanting the shim's
    // exact selection returns the value and nothing else. Without this clause
    // the handler looks as though it absorbs its error and every edge upstream
    // of it inherits a funnel of `none`, so edges that answer 500 are reported
    // as answering nothing.
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
        return producerName(ctx, p);
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
        return producerName(ctx, p);
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

/**
 * Whether the offset sits in a `catch` clause that runs as an async
 * continuation rather than on its carrier's synchronous stack.
 *
 * Both halves are required. The enclosing frame must be `async`, and the
 * guarded region must actually `await` - `try { sync(); } catch (e) {}` inside
 * an async function still runs its clause synchronously, so the frame alone
 * does not decide it.
 *
 * Applied to EVERY edge rather than to the pass that happened to surface it.
 * Computing it only for the target's `return err` left the baseline's
 * `reply(err)` in the very same clause reading `synchronous`, which
 * manufactured a settlement difference out of which pass found the site - the
 * asymmetry, not the code, was the difference.
 */
function inAsyncCatchContinuation(ctx, offset) {
  const code = ctx.codeOnly;
  // The nearest `catch (` whose clause body contains the offset.
  const clause = /\bcatch\s*\(\s*[A-Za-z0-9_$]+\s*\)\s*\{/g;
  let m;
  let enclosing = -1;
  while ((m = clause.exec(code)) !== null) {
    if (m.index > offset) {
      break;
    }
    const braceAt = m.index + m[0].length - 1;
    const end = matchDelimiter(code, braceAt);
    if (end !== -1 && offset > braceAt && offset < end) {
      enclosing = m.index;
    }
  }
  if (enclosing === -1) {
    return false;
  }
  const frame = innermostFunction(ctx.functions, enclosing);
  const frameIsAsync = frame
    ? /\basync\s*$/.test(
      code.slice(Math.max(0, frame.keywordAt - 8), frame.keywordAt))
    : false;
  if (!frameIsAsync) {
    return false;
  }
  const tryStart = code.lastIndexOf('try', enclosing);
  return tryStart !== -1 && /\bawait\b/.test(code.slice(tryStart, enclosing));
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
    // Stamped so the settlement model can read it. The legacy wrapper's
    // `if (result === undefined) { result = await responsePromise; }` means
    // an unreturned chain in a handler that returns nothing is STILL awaited
    // on the baseline tree - see timingShape, where reading it otherwise
    // reported 7 rows as gaining a wait the wrapper already provided.
    edge.shimPresent = shimPresent;
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
// Every target states the outcome to PRESERVE and none proposes a fix:
// behaviour improvements are out of scope for this migration, and a row that
// recommended repairing a swallowed error or settling an unsettled request
// would send an implementing agent in the wrong direction. Where the baseline
// outcome is a defect, the target says so and requires it.
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
// A row carries the target status, payload or redirect, its SIDE EFFECTS and
// its TIMING. The first is what the disposition prose states. The last two are
// the fields a mechanical conversion drops silently - a swallowed error that
// starts being reported, a fire-and-forget deletion that starts being awaited,
// a response that starts settling earlier than the callback producing it - so
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

/** The side-effect and timing fields, appended to every target. */
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
 * partial deliverable, and a row's whole use is that a reader can act on it
 * without re-deriving it.
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
 * only about the mechanism:
 *
 *   shim      reply(err) with a non-Boom Error RESOLVES the pre-handler with
 *             the Error as its assigned value. The request continues,
 *             `request.pre.<assign>` holds an Error, no error response is
 *             produced, funnel `none`.
 *   native    a returned Error goes through `@hapi/hapi`'s `Response.wrap`,
 *             which boomifies it in the response pipeline; `isBoom` then
 *             routes it to the pre-handler's `failAction`, whose default
 *             `'error'` throws. So the request is answered - the Boom's own
 *             status for a Boom, 500 for a plain Error - and the funnel is
 *             Layer 3.
 *
 * Stating one contract while reporting rows measured under the other is what
 * this parameter prevents.
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

  const kind = edge.thrownKind || { kind: 'value' };

  // AN ERROR HANDLER THAT RETURNS ITS ERROR, checked here because
  // resolveFunnels checks it here: a `.catch` handler that RETURNS the error
  // RESOLVES its chain rather than rejecting it, so nothing downstream catches
  // the value and the chain's own later `.catch` never sees it. The case has
  // to sit in the same place in both functions - a clause in resolveFunnels
  // with no counterpart here makes the funnel field say Layer 3 while the tail
  // prescribes Layer 1, and where a later `.catch` exists the text routes the
  // value to a handler that cannot receive it.
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
  // THE TAIL IS FUNNEL-DRIVEN, and it has to be. Returning the Layer 1 text
  // unconditionally is correct for a throw on a handler's own stack and wrong
  // for everything else that reaches here - most visibly for an error handler
  // that RETURNS its error as the response, which resolveFunnels answers
  // through Layer 3. That combination puts a Layer 3 Funnel field on a row
  // whose Target says "Layer 1. The handler catch-all logs...", and one edge
  // cannot prescribe both: a reviewer reading either field alone would be told
  // something the other field denies.
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
// handler catch-all in `lib/util/routeParser.js` sits at different lines on
// the two trees, and a document stating one tree's numbers while describing
// the other is worse than one stating none. A funnel that cannot be located is
// a hard failure - the document's opening section is not optional.
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
        // `convertPreHandlers` survives the migration - it is reshaped into a
        // pass-through for native lifecycle methods and keeps the string-form
        // dispatcher - so detecting the function by name reports the shim as
        // present on a converted tree too, and every pre-handler row would
        // then narrate `fakeReply` semantics the tree does not have. That is a
        // stale target model on the one surface where the shim and the native
        // lifecycle disagree about the OUTCOME rather than only about the
        // mechanism.
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
 * parity baseline commit - rather than by where it happened to be checked
 * out, so the same two commits analysed on any machine produce the same
 * label.
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
// A checklist whose every row is permanently unchecked is not a checklist: a
// generator taking no target input has nothing a row COULD be closed against,
// and the target status, payload, side effects and timing of a changed edge
// would then be established nowhere.
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
  // of borrowing either verdict. Without this value, a positional pairing
  // overriding an exact-identity one hands a verdict - closed or open - to a
  // pair of rows that may not be the same edge at all.
  AMBIGUOUS: 'pairing ambiguous - not compared',
  // Nothing in the analysed corpus can reach this edge, so there is no
  // outcome on either tree to compare. Closing it would be asserting parity
  // of nothing against nothing.
  UNREACHABLE: 'not compared - proven unreachable',
  // A baseline callback boundary rule T-3 removes by converting the callback
  // into an `await`. The SITE is gone by design; the responses it produced
  // are still produced in the same routed carrier, and the row names where.
  // Closed, because the error-to-response mapping R-e protects survived - it
  // is the vehicle that did not.
  MECHANISM: 'closed - callback boundary removed by rule T-3',
  // A target edge with no baseline counterpart that produces NO response.
  // It introduces no error-to-response mapping, so there is no R-e
  // obligation for it to meet: neither closed nor open, and reported with
  // its disposition so it is visible rather than absorbed.
  NO_MAPPING: 'no mapping - new mechanism, produces no response',
  NOT_COMPARED: 'not compared'
});

// EVERY closure state, partitioned exactly once. The summary, the preamble
// sentence, the verdict table, the open-row listing and the gate all read
// this partition rather than each deciding for themselves, and a self-test
// asserts the partition is total and disjoint over `CLOSURE` - so adding a
// state without classifying it fails loudly instead of silently counting it
// open, which is precisely what happened when the two mechanism states were
// introduced: the authoritative total read 74 while its own buckets summed
// to 53.
const OPEN_CLOSURES = Object.freeze([
  CLOSURE.CHANGED, CLOSURE.MISSING, CLOSURE.ADDED, CLOSURE.AMBIGUOUS,
  CLOSURE.NOT_COMPARED
]);

// States that are CLOSED: the mapping R-e protects was established as
// preserved, whether by comparing two outcomes or - for a callback boundary
// rule T-3 removed - by finding every response it produced still produced in
// the same routed carrier.
const CLOSED_CLOSURES = Object.freeze([
  CLOSURE.CLOSED, CLOSURE.APPROVED, CLOSURE.MECHANISM
]);

// States that are NEITHER: there is no error-to-response mapping for R-e to
// hold either tree to, so closing them would assert parity of nothing
// against nothing and opening them would demand parity of nothing against
// nothing.
const NOT_COMPARED_CLOSURES = Object.freeze([
  CLOSURE.UNREACHABLE, CLOSURE.NO_MAPPING
]);

/**
 * IS THIS ROW OPEN? The single authoritative answer.
 *
 * Four places used to decide this independently and two of them disagreed:
 * the preamble summed `changed + missing + added` and printed 96, the verdict
 * table rendered every bucket and totalled 119, the open-row listing filtered
 * on "not closed, not approved, not unreachable", and `--closure-gate` added
 * the closed-but-unresolved case that none of the other three carried. A
 * document whose own two figures for the same quantity differ by 23 rows is
 * not evidence of anything, whichever figure is right.
 *
 * The definition is the gate's, because the gate is the one that has to be
 * survivable: a row is open unless it is CLOSED or APPROVED, except that a
 * PROVEN UNREACHABLE row is not open - there is no outcome on either tree to
 * preserve - and a row that compared equal while its own reachability or
 * caller could not be resolved IS open, because its facts are provisional.
 *
 * @param {Object} row a joinTrees row
 * @returns {boolean}
 */
function isOpenRow(row) {
  if (NOT_COMPARED_CLOSURES.indexOf(row.closure) !== -1) {
    return false;
  }
  if (CLOSED_CLOSURES.indexOf(row.closure) === -1) {
    return true;
  }
  const edge = row.target || row.baseline;
  return Boolean(edge && edge.unresolved);
}

/** Rows that compared equal but rest on an unresolved edge fact. */
function isProvisionalRow(row) {
  return CLOSED_CLOSURES.indexOf(row.closure) !== -1 && isOpenRow(row);
}

/**
 * The observable outcome of an edge, reduced to the compared fields.
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
    // Four things an edge must still do after conversion: the status, the
    // payload, the side effects and the timing. Comparing only the first
    // closes a row whose log moved, whose flash writes changed, or whose
    // settlement moved to a different tick, which are exactly the changes a
    // mechanical conversion makes. Each dimension below is normalised so that
    // a rename or a reordering is not a difference and a real change is.
    payload: payloadShape(edge),
    effects: effectShape(edge),
    logs: logShape(edge),
    timing: timingShape(edge)
  };
}

/**
 * The SEMANTIC kind of a produced response, from the name that produced it.
 *
 * Comparing the callee names directly compares the mechanism: `reply` is
 * exactly what this migration replaces, so a branch answering with
 * `reply(...)` at baseline and `request.fail(...)` in the target differs on
 * every callee name while producing the same response, and the comparison
 * would open rows that changed only their spelling.
 *
 * `reply` is the shim's ONE universal producer - it served redirects, views,
 * values and failures alike - so its semantic kind is not knowable from the
 * name. It contributes `null` here, and a row whose only producer was
 * `reply` says that its payload kind could not be established statically
 * rather than claiming one.
 */
function responseKindOf(callee) {
  const name = String(callee || '');
  // `reply().<member>` is what producerName emits when the shim's builder
  // chain resolved through a member that names the response. The mapping is
  // stated here rather than left to the regex order below, because the whole
  // point is that these are the SAME kinds the toolkit producers yield.
  const shim = /^reply\(\)\.([A-Za-z0-9_$]+)$/.exec(name);
  if (shim) {
    return Object.prototype.hasOwnProperty.call(SHIM_RESOLVING_MEMBERS, shim[1])
      ? SHIM_RESOLVING_MEMBERS[shim[1]]
      : null;
  }
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

/**
 * The payload or redirect a client receives, normalised.
 *
 * The status alone does not distinguish a Boom body from a rendered view from a
 * redirect from a raw value, and the comparison is over the payload SHAPE and
 * not only over the code.
 */
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
    // "unclassified" makes the row differ on payload from a target that
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
 * which is the change a mechanical conversion is most likely to make and the
 * one a status-only comparison would miss.
 */
function timingShape(edge) {
  const prop = edge.propagation || {};

  // OBSERVABLE ordering, reduced to the three answers a client can tell
  // apart, and nothing else.
  //
  // Two coarsenings are deliberate, because without them the timing field
  // becomes the mechanism comparison this comparison exists to avoid:
  //
  //   The conversion puts the await boundary at the lifecycle method, so a
  //   callback becomes an awaited promise chain BY DESIGN. Naming the vehicle
  //   - `cps-callback` against `promise-chain` - makes rows differ on timing
  //   for having been converted as intended.
  //
  //   A registered callback is created synchronously and INVOKED later, so
  //   `propagationAt` at a `.catch(fn)` handler's own keyword reads
  //   `carrier-body`, which is where the function is WRITTEN and not when it
  //   RUNS. Reading that as the settlement moves a row from deferred to
  //   synchronous purely for relocating from a `reply(err)` inside a chain to
  //   the `.catch` handler that replaced it - the same deferred settlement
  //   under a different shape. Distinguishing "settles on a chain the carrier
  //   waits for" from "settles when the registered callback runs, and the
  //   carrier waits for it" only moves the same rows onto the wording of a
  //   vehicle rather than onto an outcome.
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

  // MEASURED against the baseline wrapper, `lib/util/routeParser.js:567-570`
  // at 2f8712a:
  //
  //     // If handler didn't return a value, wait for request.success/fail
  //     if (result === undefined) {
  //       result = await responsePromise;
  //     }
  //
  // So on a tree that still carries the shim, an UNRETURNED chain whose body
  // settles the deferred is not unwaited: the handler returns `undefined` and
  // the wrapper awaits `responsePromise`, which that settlement resolves. The
  // wait exists, it is just the wrapper's rather than the chain's.
  //
  // Reading `chainReturned === false` as "nothing waits" on the baseline
  // therefore invented a wait for the conversion to add, and 7 rows were
  // reported moving `nothing waits` -> `carrier waits` when the baseline
  // already waited. That is the model, not the migration. A tree WITHOUT the
  // shim has no such wrapper, so there the reading is correct and unchanged.
  //
  // "Settles the deferred" is the disposition, not the producer-token list:
  // `producedResponses` is populated for the swallow/log-and-continue
  // classification and is empty on a `.catch` handler that answers through
  // `request.fail`, so testing it credited only 1 of the 12 rows the wrapper
  // actually awaits. An edge ANSWERS when it calls `reply(err)`, calls
  // `request.fail`, or names a response producer - each of which resolves
  // `responseResolver` and so is what the wrapper's `await` is waiting for.
  const answers = edge.disposition === DISPOSITION.REPLY_ERR ||
    edge.disposition === DISPOSITION.FAIL_LOCAL ||
    (edge.producedResponses || []).length > 0;
  const wrapperAwaits = edge.shimPresent === true && answers;
  const waited = prop.kind === 'promise-chain'
    ? (prop.chainReturned !== false || wrapperAwaits)
    : true;

  if (edge.disposition === DISPOSITION.LATE_RESOLVE) {
    return WAITED;
  }
  if (edge.edgeClass === EDGE_CLASS.HANDLER ||
      edge.edgeClass === EDGE_CLASS.CPS ||
      edge.edgeClass === EDGE_CLASS.ERR_PARAM) {
    return waited ? WAITED : UNWAITED;
  }
  // A `catch` clause reached after an `await` does NOT settle before the
  // carrier returns: the async function returned its promise at the first
  // `await`, and the clause runs in a later continuation. Labelling it
  // `synchronous` overstated how early the settlement happens and made 5
  // rows differ from a baseline that settles at the same point in the
  // lifecycle. The carrier does wait for it, which is what WAITED says.
  if (edge.asyncContinuation === true) {
    return WAITED;
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
 * The dimensions two outcomes disagree on, named.
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

// How settled a timing is, so that a CHANGE in it can be read as a direction
// rather than only as an inequality. 2 settles before the carrier returns, 1
// settles later with the carrier waiting, 0 settles later with nothing
// waiting for it.
const TIMING_RANK = Object.freeze({
  'synchronous - settles before the carrier returns': 2,
  'deferred - settles later, and the carrier waits for it': 1,
  'deferred - settles later, and nothing waits for it': 0
});

/**
 * Split a pair of outcomes into R-e FAILURES and PRESCRIBED transitions.
 *
 * R-e requires that each converted path preserve its error-to-response
 * mapping - same status codes, same error payload shapes. Two of the eight
 * dimensions this tool records are not that mapping; they are where the code
 * lives and how the value gets out, and the AAP prescribes a change to both.
 * Recording them is required - AAP 0.6.3 names timing among the four things
 * every row must carry - but reading a prescribed change as an R-e failure
 * sends a reviewer to preserve something the plan required to change.
 *
 * SURFACE is a location. AAP 0.6.4 mandates EXTRACTION - `createCourseCore`,
 * `listCore`, `startUpload`, `settle` and the rest - so a branch that used to
 * sit inline in a routed handler now sits in an internal callee it calls. The
 * client receives the same response either way. MEASURED: 5 rows on this tree
 * differ in surface alone or in surface plus one other dimension.
 *
 * TIMING is NOT prescribed, and an earlier edition of this function had it
 * wrong in a way worth recording so it is not reintroduced. It ranked the
 * three settlements and blessed any move up the rank as rules T-1/T-3 doing
 * what they were told. Both of its inputs turned out to be unsound:
 *
 *   - "nothing waits for it" is not what the baseline does. The legacy
 *     wrapper runs `if (result === undefined) { result = await
 *     responsePromise; }` at `lib/util/routeParser.js:567-570`, so a handler
 *     that falls off the end still has its deferred settlement awaited. An
 *     unreturned chain is not unwaited there; the wait is the wrapper's.
 *     `timingShape` now models that directly, which is the root-cause fix.
 *   - "synchronous - settles before the carrier returns" is not what a
 *     `catch` reached after an `await` does. The async function has already
 *     returned a promise and the clause runs in a later continuation, so the
 *     label overstates how early the settlement happens.
 *
 * Blessing a transition computed from either of those authorizes a change
 * that was never established. R-e requires the mapping to survive and AAP
 * 0.6.3 names timing among the four things every row must carry, so a
 * settlement difference is now REPORTED in both directions and closes
 * nothing. That is stricter than the edition it replaces, and deliberately:
 * the rows it opens each name a real measured difference in a dimension R-e
 * requires, which is the owning unit's to resolve or the AAP's to authorize
 * explicitly - not this tool's to wave through.
 *
 * @returns {{failures: string[], prescribed: string[]}}
 */
function reDifferences(a, b) {
  const failures = [];
  const prescribed = [];
  if (!a || !b) {
    return { failures: failures, prescribed: prescribed };
  }
  OUTCOME_DIMENSIONS.forEach(function (entry) {
    const key = entry[0];
    const label = entry[1];
    if (String(a[key]) === String(b[key])) {
      return;
    }
    if (key === 'surface') {
      prescribed.push('surface: `' + a[key] + '` -> `' + b[key] +
        '` (extraction, AAP 0.6.4)');
      return;
    }
    if (key === 'timing') {
      // Reported in BOTH directions, and named so a reader can act on it.
      // The direction is still stated because it is what a reviewer needs
      // first, but neither direction is authorized here.
      const from = TIMING_RANK[a[key]];
      const to = TIMING_RANK[b[key]];
      const direction = from !== undefined && to !== undefined && to < from
        ? ' - the target waits for LESS than the baseline did'
        : ' - the settlement moved';
      failures.push(label + direction);
      return;
    }
    failures.push(label);
  });
  return { failures: failures, prescribed: prescribed };
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
 * @param {Object[]} baselineEdges rows measured on the baseline tree
 * @param {Object[]} targetEdges rows measured on the analysed target tree
 * @returns {Object} { rows, byId, summary }
 */
function joinTrees(baselineEdges, targetEdges) {
  // WHAT AN EDGE'S IDENTITY IS, AND WHY THE OLD ONE COULD NOT CLOSE A ROW.
  //
  // The identity a row PRINTS is `<file>.<carrier>.<class>.<ordinal>`, and
  // two of its four components are not invariants of this migration:
  //
  //   the CLASS flips. `.catch(function (err) { return reply(err); })` is a
  //   response-class edge at the reply site; the converted
  //   `.catch(function (err) { return err; })` has no terminal, so the edge
  //   is the handler itself and its class is `handler`. The ordinals of both
  //   classes then renumber and an id match becomes an artefact of the
  //   renumbering - measured on `course.deleteCourse`, where taking the match
  //   paired line 151 with line 192 and reported two unchanged rows changed.
  //
  //   the CARRIER moves. AAP 0.6.4 mandates EXTRACTION - `createCourseCore`,
  //   `listCore`, `lookupTrinket`, `startUpload`, `abandon`, `settle`,
  //   `logFailure`, `removeTempFile`, `redactText` and the stream handlers
  //   are all functions the conversion introduced to hold code that used to
  //   sit inline in a routed handler. Grouping by the lexical carrier reads
  //   every one of those edges as deleted from one carrier and created in
  //   another: measured, 41 rows "missing from the target" and 28 "new in the
  //   target" on a tree where almost none of either had happened.
  //
  // The predecessor of this function papered over both by FILLING GAPS
  // POSITIONALLY - pairing the k-th unanchored baseline row in a gap with the
  // k-th unanchored target row - and 78 pairs in one document rested on
  // source order, 24 of them overriding an identically-named row elsewhere.
  // Rows were then CLOSED on those pairings, which is a closure claim resting
  // on the order two files happen to list their statements in.
  //
  // So there is no positional pairing here at all. Three tiers, each a
  // semantic claim, and CLOSURE IS PERMITTED ON THE FIRST TWO ONLY:
  //
  //   T1 semantic subject - the same routed carrier guards the same named
  //      operation with the same error value. Survives the class flip,
  //      because the subject is the operation and not the mechanism.
  //   T2 identical outcome - the two edges produce the same observable
  //      outcome on every compared dimension. The pairing cannot be wrong in
  //      any way that matters: whichever of two identical outcomes is paired
  //      with which, the verdict is the same.
  //   T3 nearest outcome - the fewest differing dimensions. A T3 pair always
  //      differs somewhere by construction, so it is ALWAYS reported open
  //      with those dimensions named. It exists to tell a reviewer WHAT
  //      changed rather than merely that a row is unpaired, and it can never
  //      close anything. A tie is reported ambiguous rather than guessed.
  //
  // A self-test asserts the invariant directly: no closed row carries a tier
  // other than T1 or T2.
  const groupOf = routedGroupResolver(baselineEdges.concat(targetEdges));

  const bySourceOrder = function (a, b) {
    return a.offset - b.offset;
  };
  const bucket = function (edges) {
    const map = new Map();
    edges.forEach(function (edge) {
      const key = edge.file + '\u0000' + groupOf(edge);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(edge);
    });
    return map;
  };

  const baselineGroups = bucket(baselineEdges);
  const targetGroups = bucket(targetEdges);

  const rows = [];
  const claimed = new Set();
  const groupLabel = function (key) {
    const parts = key.split('\u0000');
    return '`' + parts[0] + '` routed carrier `' + parts[1] + '`';
  };

  Array.from(new Set(Array.from(baselineGroups.keys())
    .concat(Array.from(targetGroups.keys())))).sort().forEach(function (key) {
    const baseGroup = (baselineGroups.get(key) || []).slice().sort(bySourceOrder);
    const targetGroup = (targetGroups.get(key) || []).slice().sort(bySourceOrder);
    const label = groupLabel(key);
    const takenTargets = new Set();

    // -- T1: the same guarded operation, named the same way on both trees.
    // Unique on BOTH sides or it is not an identity: a subject occurring
    // twice in one carrier cannot say which of the two a single match means.
    const population = function (group) {
      const counts = Object.create(null);
      group.forEach(function (edge) {
        const subject = edgeSubject(edge);
        counts[subject] = (counts[subject] || 0) + 1;
      });
      return counts;
    };
    const basePopulation = population(baseGroup);
    const targetPopulation = population(targetGroup);
    const pairs = new Map();
    baseGroup.forEach(function (base) {
      const subject = edgeSubject(base);
      if (basePopulation[subject] !== 1 || targetPopulation[subject] !== 1) {
        return;
      }
      const match = targetGroup.filter(function (edge) {
        return edgeSubject(edge) === subject && !takenTargets.has(edge);
      })[0];
      if (match) {
        takenTargets.add(match);
        pairs.set(base, { target: match, tier: 'semantic subject `' + subject + '`' });
      }
    });

    // -- T2: identical observable outcome. Pool by outcome so the pairing is
    // a bijection between equals rather than a search.
    const pool = new Map();
    targetGroup.forEach(function (edge) {
      if (takenTargets.has(edge)) {
        return;
      }
      const outcomeKey = outcomeText(outcomeOf(edge)) + '\u0000' +
        JSON.stringify(outcomeOf(edge));
      if (!pool.has(outcomeKey)) {
        pool.set(outcomeKey, []);
      }
      pool.get(outcomeKey).push(edge);
    });
    baseGroup.forEach(function (base) {
      if (pairs.has(base)) {
        return;
      }
      const outcomeKey = outcomeText(outcomeOf(base)) + '\u0000' +
        JSON.stringify(outcomeOf(base));
      const candidates = pool.get(outcomeKey);
      if (candidates && candidates.length) {
        const match = candidates.shift();
        takenTargets.add(match);
        pairs.set(base, { target: match, tier: 'identical outcome within the routed carrier' });
      }
    });

    // -- Before T3: a baseline callback boundary rule T-3 removed is not a
    // leftover looking for a partner. Asking that question FIRST matters:
    // measured on `course.archiveCourse`, T3 paired the baseline CPS
    // boundary with an unrelated target error parameter and reported the row
    // changed, when the boundary's own response is still produced in the
    // carrier and the row closes.
    const removedMechanism = new Map();
    baseGroup.forEach(function (base) {
      if (pairs.has(base)) {
        return;
      }
      const removal = mechanismRemoval(base, targetGroup);
      if (removal) {
        removedMechanism.set(base, removal);
      }
    });

    // -- T3-anchored: the residual pool is UNIFORM on both sides and of
    // EQUAL SIZE. Pairing it by position looks like the positional
    // gap-filling this join exists to remove, and is not: every member of a
    // side is byte-identical in outcome to every other member of that side,
    // so every possible bijection yields exactly the same verdict on exactly
    // the same rows. Nothing rests on source order because order cannot
    // change the answer - which is the property positional gap-filling
    // lacked, not the fact that it used position.
    //
    // MEASURED on `helpers.trinketByOwnerAndSlug`, where three
    // `throw Boom.notFound()` edges on each side are mutually
    // indistinguishable, and on four more helpers whose residual pool is
    // 1-to-1. Left unpaired these read as 7 baseline edges that vanished
    // plus 7 target edges that appeared, when what a reader needs is 7 rows
    // naming the dimension that moved. The rows still do not close - the
    // differences are reported exactly as T3 reports them.
    const uniformOutcome = function (list) {
      if (!list.length) {
        return false;
      }
      const keyOf = function (edge) {
        const outcome = outcomeOf(edge);
        return outcomeText(outcome) + '\u0000' + JSON.stringify(outcome);
      };
      const first = keyOf(list[0]);
      return list.every(function (edge) {
        return keyOf(edge) === first;
      });
    };
    const residualBase = baseGroup.filter(function (base) {
      return !pairs.has(base) && !removedMechanism.has(base);
    });
    const residualTargets = targetGroup.filter(function (edge) {
      return !takenTargets.has(edge);
    });
    if (residualBase.length &&
        residualBase.length === residualTargets.length &&
        uniformOutcome(residualBase) && uniformOutcome(residualTargets)) {
      residualBase.forEach(function (base, index) {
        const match = residualTargets[index];
        takenTargets.add(match);
        pairs.set(base, {
          target: match,
          tier: 'uniform residual pool of equal size in the routed carrier'
        });
      });
    }

    // -- T3: nearest outcome among what is left, and only to REPORT the
    // difference. Every T3 pair differs by at least one dimension, so it is
    // never closed; a tie between two equally-near candidates is reported
    // ambiguous instead of resolved by any rule at all.
    //
    // T3 will not cross the produces-a-response boundary. An edge that
    // answers and an edge that answers nothing are not the same edge, and
    // pairing them manufactures a difference on the dimension that matters
    // most - measured on `courses.returnZip`, where the removed `rimraf`
    // callback was paired against a `badImplementation` response in a
    // different function and reported as a funnel-and-status change that
    // exists nowhere in either tree. Where no candidate answers the same way,
    // the rows stay unpaired and are reported missing and added, which is the
    // honest reading: one tree has an edge the other does not.
    const leftoverTargets = targetGroup.filter(function (edge) {
      return !takenTargets.has(edge);
    });
    baseGroup.forEach(function (base) {
      if (pairs.has(base) || removedMechanism.has(base) || !leftoverTargets.length) {
        return;
      }
      const baselineOutcome = outcomeOf(base);
      const scored = leftoverTargets.filter(function (edge) {
        return !takenTargets.has(edge) &&
          outcomeOf(edge).producesResponse === baselineOutcome.producesResponse;
      }).map(function (edge) {
        return { edge: edge, distance: outcomeDiff(baselineOutcome, outcomeOf(edge)).length };
      }).sort(function (a, b) {
        return a.distance - b.distance;
      });
      if (!scored.length) {
        return;
      }
      const tied = scored.length > 1 && scored[1].distance === scored[0].distance;
      takenTargets.add(scored[0].edge);
      pairs.set(base, {
        target: scored[0].edge,
        tier: 'nearest outcome in the routed carrier',
        tied: tied,
        alternatives: scored.filter(function (entry) {
          return entry.distance === scored[0].distance;
        }).map(function (entry) {
          return entry.edge.id;
        })
      });
    });

    baseGroup.forEach(function (base) {
      const pair = pairs.get(base) || null;
      const baselineOutcome = outcomeOf(base);

      if (!pair) {
        // A baseline edge with no counterpart. One shape of that is not a
        // lost mapping: a CPS callback boundary or an undispositioned error
        // parameter is a MECHANISM, and rule T-3 removes it by converting the
        // callback into an `await`. Where every response that boundary
        // produced is still produced somewhere in the same routed carrier,
        // the mapping it carried is carried by the rows that remain, and this
        // row says which. Where it is not, the row stays open - the
        // distinction is the whole value of the check.
        const removal = removedMechanism.get(base) || null;
        rows.push({
          id: base.id,
          baseline: base,
          target: null,
          matchedBy: null,
          pairedBy: null,
          groupKey: key,
          baselineOutcome: baselineOutcome,
          targetOutcome: null,
          closure: removal ? CLOSURE.MECHANISM : CLOSURE.MISSING,
          mechanismNote: removal,
          differences: [],
          approved: null
        });
        return;
      }

      claimed.add(pair.target.id);
      const targetOutcome = outcomeOf(pair.target);
      const split = reDifferences(baselineOutcome, targetOutcome);
      const differences = split.failures;
      const byIdentity = pair.target.id === base.id;
      const nearest = pair.tier.indexOf('nearest outcome') === 0;
      let closure;
      let approved = null;

      if (base.unreachableProven || pair.target.unreachableProven) {
        closure = CLOSURE.UNREACHABLE;
      } else if (pair.tied) {
        closure = CLOSURE.AMBIGUOUS;
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
        target: pair.target,
        // `matchedBy` keeps its contract - null when the two ids are the
        // same, a description otherwise - so the row renderer and the index
        // read what they always read.
        matchedBy: byIdentity ? 'identity' : pair.tier + ' (target row `' + pair.target.id + '`)',
        pairedBy: pair.tier,
        groupKey: key,
        baselineOutcome: baselineOutcome,
        targetOutcome: targetOutcome,
        closure: closure,
        differences: differences,
        // The mechanism transitions the AAP prescribes, named per row. A row
        // that closes with one of these recorded is NOT a row that compared
        // equal, and the document lists every one of them rather than letting
        // the tick absorb the difference.
        prescribed: split.prescribed,
        unpairedBecause: pair.tied
          ? 'two target rows in ' + label + ' are equally near this outcome (' +
            pair.alternatives.map(function (id) {
              return '`' + id + '`';
            }).join(', ') + '), so nothing decides which is this edge'
          : null,
        nearestOnly: nearest && !pair.tied
          ? 'paired to the nearest outcome in ' + label +
            ', which differs, so this row is reported open on that difference ' +
            'rather than closed on the pairing'
          : null,
        approved: approved
      });
    });
  });

  // Target rows nothing in the baseline claimed. A new edge is not
  // automatically a failure - the conversion legitimately introduces
  // mechanism - but the two cases are not the same risk and were counted as
  // one. An added edge that PRODUCES A RESPONSE the baseline did not produce
  // is a behaviour change R-d prohibits, and it is open. An added edge that
  // produces no response introduces no error-to-response mapping at all, so
  // there is no R-e obligation for it to meet and nothing to verify: it is
  // reported, with its disposition, as carrying no mapping.
  const added = targetEdges.filter(function (edge) {
    return !claimed.has(edge.id);
  }).map(function (edge) {
    const outcome = outcomeOf(edge);
    return {
      id: edge.id,
      baseline: null,
      target: edge,
      matchedBy: null,
      pairedBy: null,
      groupKey: edge.file + '\u0000' + groupOf(edge),
      baselineOutcome: null,
      targetOutcome: outcome,
      closure: edge.unreachableProven
        ? CLOSURE.UNREACHABLE
        : (outcome.producesResponse ? CLOSURE.ADDED : CLOSURE.NO_MAPPING),
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
  // carry that same id. Merging both into one map lets the second write win or
  // lose by insertion order, and the document then prints one row's verdict
  // against another row's edge - a target row reported "missing from the
  // target", which is a verdict that cannot apply to a row the target
  // contains. Keeping the namespaces apart makes each lookup answer the
  // question it was asked.
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

  const pairedBy = function (prefix) {
    return all.filter(function (row) {
      return row.pairedBy && row.pairedBy.indexOf(prefix) === 0;
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
      notCompared: count(CLOSURE.NOT_COMPARED),
      mechanism: count(CLOSURE.MECHANISM),
      noMapping: count(CLOSURE.NO_MAPPING),
      // THE authoritative open figure, and the two derived quantities every
      // renderer needs from it. Computed here, once, from isOpenRow, so no
      // consumer can arrive at its own total. `openByBucket` is the same set
      // partitioned for display, and it sums to `open` by construction - the
      // self-test named below asserts that it does.
      open: all.filter(isOpenRow).length,
      openProvisional: all.filter(isProvisionalRow).length,
      // The three totals of the partition, so no renderer has to add the
      // buckets up for itself and get a different answer. `closedTotal`
      // includes the callback boundaries rule T-3 removed and excludes the
      // rows that compared equal on a provisional fact, because those are
      // counted open.
      closedTotal: all.filter(function (row) {
        return CLOSED_CLOSURES.indexOf(row.closure) !== -1 && !isOpenRow(row);
      }).length,
      notComparedTotal: all.filter(function (row) {
        return NOT_COMPARED_CLOSURES.indexOf(row.closure) !== -1;
      }).length,
      totalRows: all.length,
      openByBucket: OPEN_CLOSURES.reduce(function (map, state) {
        map[state] = count(state);
        return map;
      }, Object.create(null)),
      // Open rows carrying each side, so a denominator is never borrowed from
      // the other one: an ADDED row has no baseline edge, so it cannot be
      // counted against "the 342 baseline edges", which is what the preamble
      // used to do.
      openWithBaseline: all.filter(function (row) {
        return isOpenRow(row) && Boolean(row.baseline);
      }).length,
      openWithTarget: all.filter(function (row) {
        return isOpenRow(row) && Boolean(row.target);
      }).length,
      // The pairing tiers, replacing "paired by source order within the
      // carrier". Closure is permitted on the first two only.
      pairedBySubject: pairedBy('semantic subject'),
      pairedByOutcome: pairedBy('identical outcome'),
      pairedByNearest: pairedBy('nearest outcome'),
      pairedByUniformPool: pairedBy('uniform residual pool'),
      // Rows that compared equal on every R-e dimension while carrying a
      // mechanism transition the AAP prescribes. Counted and listed, because
      // a tick that absorbed a difference silently is the defect the whole
      // closure section exists to avoid.
      prescribedTransitions: all.filter(function (row) {
        return (row.prescribed || []).length > 0;
      }).length,
      // Split out, because the two are different facts and conflating them
      // published a closed-row count the detail table contradicted.
      prescribedClosed: all.filter(function (row) {
        return (row.prescribed || []).length > 0 &&
          CLOSED_CLOSURES.indexOf(row.closure) !== -1;
      }).length,
      fallbackMatches: all.filter(function (row) {
        return row.matchedBy && row.matchedBy !== 'identity';
      }).length,
      // Arithmetic that RECONCILES, and is asserted rather than presented.
      // Every baseline row lands in exactly one bucket a baseline row may be
      // in, and every target row in exactly one bucket a target row may be
      // in. A summary whose buckets do not add up to the row counts is a
      // summary that has lost rows, and losing rows is how a closure claim
      // overstates itself.
      //
      // Counted on the SIDE each row actually has, not by bucket totals.
      // Ambiguous and unreachable are not necessarily two-sided: a row new in
      // the target whose member the corpus never mentions is proven
      // unreachable and has no baseline at all, which is why `--edge-index`
      // lists "proven unreachable" among the UNPAIRED categories beside
      // "missing from the target" and "new in the target". Adding those
      // buckets into the baseline total counts such a row against a side it
      // does not have, and the summary then reports more rows accounted for
      // than the baseline holds. The check keeps all of its force - a row
      // whose bucket contradicts the sides it carries, or a row in no bucket
      // at all, still fails to be counted and is still fatal.
      baselineAccounted: accountedOn('baseline', [
        CLOSURE.CLOSED, CLOSURE.CHANGED, CLOSURE.APPROVED, CLOSURE.MISSING,
        CLOSURE.AMBIGUOUS, CLOSURE.UNREACHABLE, CLOSURE.MECHANISM
      ]),
      targetAccounted: accountedOn('target', [
        CLOSURE.CLOSED, CLOSURE.CHANGED, CLOSURE.APPROVED, CLOSURE.AMBIGUOUS,
        CLOSURE.UNREACHABLE, CLOSURE.ADDED, CLOSURE.NO_MAPPING
      ])
    }
  };
}

// ---------------------------------------------------------------------------
// Stable semantic identity
//
// Everything below exists because the printed id is not an invariant of this
// migration and closure may not rest on one that is not. See joinTrees.
// ---------------------------------------------------------------------------

/** Whether a carrier name is a module-local function rather than an export. */
function isModuleLocalCarrier(name) {
  return /\(module-local\)$/.test(String(name || ''));
}

/**
 * A resolver from an edge to the ROUTED carrier that reaches it.
 *
 * AAP 0.6.4 mandates extraction, so the conversion moves code out of a routed
 * handler into a module-local function the handler calls. The lexical carrier
 * then differs between the trees for the same conceptual edge, and grouping
 * by it reads the move as a deletion and a creation. Grouping by the routed
 * carrier makes extraction transparent, which is the point: the route is what
 * a client reaches, and the route is an invariant of this migration - the
 * 233-entry manifest gate says so.
 *
 * The walk is over `edge.callers`, which the reachability search already
 * populates, and it is conservative in three ways rather than optimistic:
 * it stops at the first non-module-local caller; where a module-local
 * function has SEVERAL non-module-local callers it keeps its own group,
 * because attributing its edges to one of them would be a guess; and a cycle
 * or an unresolvable caller leaves the carrier as its own group, where its
 * rows are reported rather than silently merged.
 *
 * @param {Object[]} edges every edge from both trees
 * @returns {function(Object): string} the group name for an edge
 */
function routedGroupResolver(edges) {
  // `carrier` is the display name (`course.createCourse`) and it is what
  // `callers` entries are spelled as, so the walk keys on it. `carrierMember`
  // is the fallback for an edge carrying only the member, and `$module` for
  // module-scope code - a group key of `undefined` would merge every such
  // edge in a file into one group and cross-pair them.
  const nameOf = function (edge) {
    return edge.carrier || edge.carrierMember || '$module';
  };
  const callersOf = new Map();
  edges.forEach(function (edge) {
    const name = nameOf(edge);
    if (!callersOf.has(name)) {
      callersOf.set(name, edge.callers || []);
    }
  });
  const memo = new Map();

  const walk = function (name, seen) {
    if (memo.has(name)) {
      return memo.get(name);
    }
    if (!isModuleLocalCarrier(name) || seen.size > 6) {
      return name;
    }
    const callers = (callersOf.get(name) || []).filter(function (caller) {
      return !seen.has(caller);
    });
    const routed = callers.filter(function (caller) {
      return !isModuleLocalCarrier(caller);
    });
    let resolved = name;
    if (routed.length === 1) {
      resolved = routed[0];
    } else if (routed.length === 0 && callers.length === 1) {
      seen.add(callers[0]);
      resolved = walk(callers[0], seen);
    }
    memo.set(name, resolved);
    return resolved;
  };

  return function (edge) {
    const name = nameOf(edge);
    return walk(name, new Set([name]));
  };
}

/**
 * The operation an edge guards, normalised so that changing the MECHANISM
 * does not change it.
 *
 * This is the T1 identity, and it is derived from what the edge is ABOUT -
 * the callee whose failure it handles, the value it produces, the identifier
 * that is unbound - rather than from how it handles it. `Model.find`'s error
 * callback and the `.catch` of `Model.find`'s promise are the same subject;
 * `reply(err)` and `request.fail(err)` are both the production of `err`.
 *
 * @param {Object} edge
 * @returns {string} a subject key, never empty
 */
function edgeSubject(edge) {
  const shape = String(edge.shape || '');
  let m;
  if (edge.callee) {
    // Passes G and H record the guarded callee structurally; prefer it over
    // any reading of the prose.
    return 'guards:' + edge.callee;
  }
  if ((m = /callback to `([^`]+)`/.exec(shape))) {
    return 'guards:' + m[1];
  }
  if ((m = /CPS callback boundary \(([^)]+)\)/.exec(shape))) {
    return 'guards:' + m[1];
  }
  if ((m = /TypeError: reply\.([A-Za-z0-9_$]+) is not a function/.exec(shape))) {
    return 'reply-property:' + m[1];
  }
  if ((m = /ReferenceError: ([A-Za-z0-9_$.]+) is not defined/.exec(shape))) {
    return 'unbound:' + m[1];
  }
  if (edge.argument) {
    return 'produces:' + edge.argument;
  }
  if ((m = /^(?:reply|request\.fail)\((.*?)\)(?: with no return)?$/.exec(shape))) {
    return 'produces:' + m[1];
  }
  if ((m = /^throw\s+(.*)$/.exec(shape))) {
    return 'throws:' + m[1];
  }
  if ((m = /^return\s+(.*)$/.exec(shape))) {
    return 'returns:' + m[1];
  }
  return 'shape:' + shape;
}

/**
 * Whether a baseline edge with no target counterpart is a MECHANISM that rule
 * T-3 removed rather than a mapping that was lost, and the sentence saying so.
 *
 * A CPS callback boundary and an undispositioned error parameter are both
 * artefacts of the callback idiom: T-3 converts the callback into an `await`
 * at the call site, so the boundary ceases to exist as a distinct site. That
 * is the migration doing exactly what the AAP prescribes, and reporting it as
 * a lost error-to-response mapping is a false failure.
 *
 * It is NOT unconditional, which is where the check earns its keep. The
 * boundary is closed only when every response KIND it produced is still
 * produced somewhere in the same routed carrier on the target tree. A
 * boundary that produced a redirect no target edge in that carrier produces
 * any more has taken a real mapping with it, and stays open.
 *
 * @param {Object} base a baseline edge with no paired target row
 * @param {Object[]} targetGroup the target edges of the same routed carrier
 * @returns {string|null} the closure sentence, or null to leave it open
 */
function mechanismRemoval(base, targetGroup) {
  if (base.edgeClass !== EDGE_CLASS.CPS && base.edgeClass !== EDGE_CLASS.ERR_PARAM) {
    return null;
  }
  const produced = producedKinds(base);
  if (produced === 'none') {
    return 'a ' + base.edgeClass + '-class callback boundary that produced no ' +
      'response of its own. Rule T-3 converts the callback into an `await` at ' +
      'the call site, so the boundary is not a site in the target tree; it ' +
      'carried no error-to-response mapping for R-e to preserve.';
  }
  const survivors = [];
  const lost = [];
  produced.split(', ').forEach(function (kind) {
    const still = targetGroup.filter(function (edge) {
      return producedKinds(edge).split(', ').indexOf(kind) !== -1;
    });
    if (still.length) {
      survivors.push(kind + ' (still produced at `' + lineRef(still[0]) + '`)');
    } else {
      lost.push(kind);
    }
  });
  if (lost.length) {
    return null;
  }
  return 'a ' + base.edgeClass + '-class callback boundary rule T-3 converts ' +
    'into an `await` at the call site, so the boundary is not a site in the ' +
    'target tree. Every response it produced is still produced in the same ' +
    'routed carrier: ' + survivors.join('; ') + '.';
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
// The corpus is produced by test/parity/capture.js and only read here, never
// written. Two join keys are accepted, in this order:
//
//   1. a `covers` entry naming an edge id from this document, which is the
//      direct join and the one a scenario author should use;
//   2. a `covers` entry naming a route key - `GET /api/trinkets/{id}` - which
//      joins to every row whose carrier is bound to that route. This is
//      weaker: it says the route was driven, not that the failure branch was
//      reached. It is reported as `route-level` so the difference is visible.
//
// A scenario carrying only a route key joins at route level, so a row whose
// failure branch no scenario names comes back route-level or uncovered. The
// coverage section prints what the supplied corpus reaches rather than
// assuming a level.
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
  // Scenario id -> the route key it drives, so a declared binding can be
  // checked against the route the scenario actually sends to rather than
  // taken on trust.
  const routeOfScenario = new Map();
  // Scenario id -> its declared intent. A route swept for its success path
  // does not reach an error branch on that route, so the two must not be
  // conflated when reporting what a row still needs: telling an author that
  // a scenario already covers the route, when that scenario asserts a 200,
  // sends them to bind false evidence.
  const intentOfScenario = new Map();
  // Route key -> the ids of NON-success scenarios driving it, which is the
  // only set a changed error edge can honestly be bound to.
  const failureByRoute = new Map();

  parsed.scenarios.forEach(function (scenario) {
    const id = String(scenario.id || '');
    const intent = String(scenario.intent || 'success');
    intentOfScenario.set(id, intent);
    if (scenario.route && scenario.route.method && scenario.route.path) {
      const routeKey = scenario.route.method + ' ' + scenario.route.path;
      routeOfScenario.set(id, routeKey);
      if (intent !== 'success') {
        if (!failureByRoute.has(routeKey)) {
          failureByRoute.set(routeKey, []);
        }
        failureByRoute.get(routeKey).push(id);
      }
    }
    if (id.indexOf('error-edge') === 0) {
      errorEdgeGroups.add(String(scenario.group || id));
    }
    // TWO FIELDS, because `covers` cannot carry an edge id.
    //
    // `test/parity/capture.js` validates every `covers` entry against the
    // route manifest and reports anything else as `unknownRoutes`, which it
    // treats as a defect in its own tables. A scenario naming an edge id in
    // `covers` therefore fails the producer, so telling authors to put them
    // there would be a join contract the producer cannot satisfy.
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
    intentOfScenario: intentOfScenario,
    failureByRoute: failureByRoute,
    routeOfScenario: routeOfScenario,
    errorEdgeScenarioCount: parsed.scenarios.filter(function (scenario) {
      return String(scenario.id || '').indexOf('error-edge') === 0;
    }).length,
    errorEdgeGroups: Array.from(errorEdgeGroups).sort()
  };
}

// THE EDGE-TO-SCENARIO BINDING, AND WHY IT LIVES HERE.
//
// Edge-level coverage means a scenario reached an edge's own branch, not
// merely its route. Route-level coverage is not coverage of an error edge: one
// minimal request per route exercises success paths.
//
// The join needs a name both sides agree on, and there is no good candidate
// in the corpus. `covers` cannot carry one - `test/parity/capture.js`
// validates every entry against the route manifest and reports anything else
// as an unknown route - and an edge id is this generator's own namespace,
// whose `<class>.<ordinal>` tail renumbers for exactly the reasons joinTrees
// documents, so a corpus naming edge ids would rot the same way the pairing
// did. So the binding is declared HERE, beside the identity it uses, and it
// uses the same stable semantic identity the pairing does: the file, the
// carrier, and the guarded subject.
//
// Every entry is VALIDATED at generation time and a failure is fatal:
//   - it must resolve to EXACTLY ONE edge per analysed tree. A binding that
//     matched two edges would mark both driven when one was, and a binding
//     that matches none has rotted against a tree that moved.
//   - every scenario it names must exist in the corpus.
//   - the scenario's route must be one the edge is reachable from.
// A claim that survives those three is a claim a reviewer can re-derive.
//
// `covers`/`coversEdges` id joins still work, so a corpus that later carries
// edge ids of its own joins through them as well.
const EDGE_SCENARIO_BINDINGS = Object.freeze([
  {
    file: 'lib/controllers/pages.js',
    carriers: ['pages.login'],
    subjects: ['reply-property:redirect'],
    scenarios: ['quirk.authed-500.get.login'],
    why: 'driven WHILE LOGGED IN, which is the only way to reach the ' +
      '`reply.redirect` property access on a bare function; the corpus case ' +
      'exists for this branch and records the 500 it raises.'
  },
  {
    file: 'lib/controllers/pages.js',
    carriers: ['pages.signup'],
    subjects: ['reply-property:redirect'],
    scenarios: ['quirk.authed-500.get.signup'],
    why: 'the same branch on the signup page, driven authenticated for the ' +
      'same reason.'
  },
  {
    file: 'lib/controllers/trinket.js',
    carriers: ['trinket.getById'],
    subjects: ['shape:.catch() handler - absorbs'],
    scenarios: ['error-edge.not-found.missingTrinket'],
    why: 'driven against the seeder\'s deliberately absent trinket id, so ' +
      'the lookup rejects and this handler is what receives it.'
  },
  {
    file: 'lib/controllers/users.js',
    carriers: ['users.getExportStatus'],
    subjects: ['guards:Export.findById'],
    scenarios: ['error-edge.not-found.missingExport'],
    why: 'driven against the seeder\'s deliberately absent export id, so the ' +
      'request enters this callback boundary with no document.'
  },
  {
    file: 'lib/controllers/users.js',
    carriers: ['users.assetUploadFromURL'],
    // Baseline: the transport `error` listener on the streaming fetch, which
    // only logs. Target: the rejection handler of the fetch chain, which
    // logs and tears down. The same conceptual edge either side of the
    // conversion.
    // Measured, both trees: the baseline spells this edge
    // `shape:.on('error') handler - logs only` (the transport listener on the
    // streaming fetch) and the delivered tree spells it `guards:.then` (the
    // rejection arm, where a refused connection now surfaces). The baseline
    // spelling ALSO matches the delivered tree's body listener, which the
    // next binding owns, so a shared list resolves two edges here and the
    // generator refuses it - correctly.
    subjects: ['guards:.then'],
    baselineSubjects: ['shape:.on(\'error\') handler - logs only'],
    scenarios: ['error-edge.asset-from-url.transport-refused'],
    why: 'the fixture refuses the connection, so this is the log-and-continue ' +
      'branch AAP 0.6.3 names by hand - it must keep continuing rather than ' +
      'become a rejection, and the request is left unsettled.'
  },
  {
    file: 'lib/controllers/users.js',
    carriers: ['users.assetUploadFromURL'],
    subjects: ['shape:.on(\'error\') handler - logs only', 'shape:.on(\'error\') handler - absorbs'],
    scenarios: ['error-edge.asset-from-url.midstream-failure'],
    why: 'the fixture delivers a response and partial bytes, then errors, and ' +
      'still reaches `end`, so this body listener runs and the upload starts ' +
      'with the partial content - the second of the two failure modes, which ' +
      'is why they are separate cases.'
  },
  {
    file: 'lib/controllers/users.js',
    // The upload boundary was inline in the handler at baseline and is an
    // extracted local function in the target.
    carriers: ['users.assetUploadFromURL', 'users.startUpload (module-local)'],
    subjects: ['guards:FileUtil.uploadUserAsset'],
    scenarios: ['error-edge.asset-from-url.query-bearing-url'],
    why: 'the successful fetch reaches the upload boundary, which is where ' +
      'the filename is derived from a legacy path field that retains the ' +
      'query string.'
  },
  {
    file: 'lib/controllers/auth.js',
    carriers: ['auth.googleCallback'],
    subjects: ['produces:{ message: \'No authorization code received from Google.\' }'],
    scenarios: ['quirk.oauth.no-authorization-code'],
    why: 'no authorization code is presented, so the handler fails at this ' +
      'branch before any token exchange - the fixture recording nothing is ' +
      'the proof no path here reaches the network.'
  },
  {
    file: 'lib/controllers/auth.js',
    carriers: ['auth.googleCallback'],
    subjects: ['produces:{ message: \'Authentication failed. Please try again.\' }'],
    scenarios: ['quirk.oauth.new-user-created-then-failed'],
    why: 'the new-user branch saves the user and mutates session state, then ' +
      'throws on an undefined variable, and this is the generic failure the ' +
      'chain answers with afterwards.'
  },
  {
    file: 'lib/controllers/course.js',
    carriers: ['course.removeInvitation'],
    subjects: ['produces:err', 'shape:.catch() handler - returns the error as the response via return err'],
    scenarios: ['route.delete.api-courses-courseId-invitations-invitationId.json'],
    why: 'no invitation document is seeded, so the case drives a deliberately ' +
      'absent id and the removal rejects into this handler.'
  }
]);

/**
 * Resolve the declared bindings against one analysed tree.
 *
 * @param {Object[]} edges every edge of the tree
 * @param {Object|null} scenarios a readScenarios result, or null
 * @param {string} label which tree, for the error message
 * @returns {{byEdgeId: Map, entries: Object[], unresolved: string[]}}
 */
function resolveEdgeBindings(edges, scenarios, label) {
  const byEdgeId = new Map();
  const entries = [];
  const unresolved = [];

  EDGE_SCENARIO_BINDINGS.forEach(function (binding, index) {
    // A binding names ONE conceptual edge, and the two trees do not always
    // spell it the same way. Where the conversion moved an edge onto a
    // different carrier shape, the subject that identifies it is per-tree:
    // `baselineSubjects` applies to the baseline worktree and `subjects` to
    // the analysed one. A single shared list cannot express that whenever one
    // tree's spelling also matches a DIFFERENT edge in the other tree, which
    // is exactly what `users.assetUploadFromURL` does - the delivered tree
    // carries both a body `.on('error')` listener (logs only) and the fetch
    // chain's rejection arm (`guards:.then`), while the baseline carries only
    // the transport listener. Matching stays exactly-one-per-tree either way;
    // this widens how the edge is NAMED, never how many may match.
    const subjects = (label === 'baseline' && binding.baselineSubjects)
      ? binding.baselineSubjects
      : binding.subjects;
    const matches = edges.filter(function (edge) {
      return edge.file === binding.file &&
        binding.carriers.indexOf(edge.carrier) !== -1 &&
        subjects.indexOf(edgeSubject(edge)) !== -1;
    });
    if (matches.length !== 1) {
      unresolved.push('binding ' + (index + 1) + ' (' + binding.file + ' / ' +
        binding.carriers.join(' or ') + ' / ' + subjects.join(' or ') +
        ') resolved ' + matches.length + ' edges in the ' + label + ' tree' +
        (matches.length > 1
          ? ': ' + matches.map(function (edge) {
            return edge.id;
          }).join(', ')
          : ''));
      return;
    }
    const edge = matches[0];
    if (scenarios) {
      binding.scenarios.forEach(function (id) {
        const route = scenarios.routeOfScenario.get(id);
        if (!route) {
          unresolved.push('binding ' + (index + 1) + ' names scenario `' + id +
            '`, which the corpus does not contain');
          return;
        }
        const reachable = (edge.routes || []).indexOf(route) !== -1;
        if (!reachable) {
          unresolved.push('binding ' + (index + 1) + ' names scenario `' + id +
            '`, which drives `' + route + '`, but ' + edge.id +
            ' is reachable from ' + ((edge.routes || []).length
            ? (edge.routes || []).map(function (r) {
              return '`' + r + '`';
            }).join(', ')
            : 'no route this tool resolved'));
        }
      });
    }
    if (!byEdgeId.has(edge.id)) {
      byEdgeId.set(edge.id, []);
    }
    binding.scenarios.forEach(function (id) {
      byEdgeId.get(edge.id).push(id);
    });
    entries.push({ binding: binding, edge: edge });
  });

  return { byEdgeId: byEdgeId, entries: entries, unresolved: unresolved };
}

/**
 * The corpus scenarios that drive an edge, and how directly.
 *
 * @returns {{level: string, scenarios: string[]}}
 */
function coverageFor(edge, scenarios, bindings) {
  if (!scenarios) {
    return { level: 'not joined', scenarios: [] };
  }
  const bound = bindings && bindings.byEdgeId.get(edge.id);
  if (bound && bound.length) {
    return { level: 'edge-level', scenarios: dedupe(bound) };
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
 * Three characters have to be handled:
 *
 *   `   ends the code span early, and is replaced with an apostrophe;
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
 * How the generator's commit is rendered, in three states rather than one.
 *
 * A commit is printed ONLY when a commit has been found whose tree holds the
 * generator blob at the generator path. `uncommitted-source` is the answer
 * while the generator itself is uncommitted, and it is what stops the document
 * naming a revision that cannot reproduce it.
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

/**
 * The provenance block, containing nothing that varies between two machines
 * analysing the same commits.
 *
 * The analysed tree is named by a symbolic label and the commit it sits at, and
 * the invocation is recorded in repository-relative terms, so the committed
 * body is a pure function of the analysed commits and `diff` reviews the tree
 * rather than the machine. The volatile physical facts - absolute paths, the
 * wall clock, the command as typed - are written to the `--provenance-out`
 * sidecar instead, which is where a fact about a run belongs.
 */
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
    // ONE figure, from joinTrees' own isOpenRow count. This sentence used to
    // sum three of the five open buckets and print a number 23 lower than the
    // verdict table's own total, against a denominator - "the N baseline
    // edges" - that the omitted buckets do not even belong to.
    lines.push('**' + sum.closedTotal + ' of the ' + sum.totalRows +
      ' rows are closed** against this tree, **' + sum.open +
      '** are open and **' + sum.notComparedTotal +
      '** carry no mapping either tree can be held to.');
    lines.push('Every figure in this document for that quantity is this one: section ' +
      model.sections.closure + '\'s verdict table partitions these same ' + sum.open +
      ' open rows, and `--closure-gate` counts them with the same predicate.');
    lines.push('Of the open rows ' + sum.openWithBaseline + ' carry a baseline edge (of ' +
      sum.baselineRows + ') and ' + sum.openWithTarget + ' carry a target edge (of ' +
      sum.targetRows + '); a row new in the target has no baseline edge, so the two');
    lines.push('sides have their own denominators rather than sharing one.');
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
  // `convertPreHandlers` SURVIVES the migration - it is reshaped into a
  // pass-through for native lifecycle methods and keeps the string-form
  // dispatcher - so its presence proves nothing about the semantics. What
  // decides them is whether the RESPONSE EMULATION is still there, and the two
  // contracts disagree about the outcome and not merely the mechanism: the
  // shim RESOLVES a non-Boom Error and produces no response at all, while hapi
  // boomifies the same value and answers 500. Describing the shim while
  // reporting a converted tree's rows would state the opposite of the truth on
  // the sharpest case on this surface.
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
  // Measured, not asserted. An earlier edition of this section stated
  // "edge-level coverage is 0" as static prose, and went on stating it after
  // the binding table made it false - which is the same defect as a closure
  // count that disagrees with its own rows.
  //
  // Counted over `model.allEdges`, which is the SAME set section 9's coverage
  // table counts over, so the two figures cannot disagree. An earlier
  // revision counted over `model.closure.rows`, which is null whenever no
  // `--baseline` is given - a TypeError that took the single-tree and
  // baseline-tree invocations down while the two-tree one passed. Coverage is
  // a property of an edge and a corpus, not of a comparison, so the
  // comparison is the wrong set to count over in any mode.
  const edgeLevelCount = model.scenarios
    ? model.allEdges.filter(function (edge) {
      return coverageFor(edge, model.scenarios, model.edgeBindings)
        .level === 'edge-level';
    }).length
    : 0;
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
  lines.push('| `test/parity/replay.js`, or any tool | read the machine-readable index this generator writes with `--edge-index <path>`: schema `trinket-oss/error-edge-index@3`, holding one record per TARGET row and one per BASELINE row, each with the id, file, carrier, surface, class, disposition, funnel, served status, the dimensions that differ, the closure verdict, the pairing tier that produced it, any prescribed mechanism transition, and the driver - plus an `unpaired` block naming every row missing from the target, new in the target, unpairable, or proven unreachable. Schema 2 carried a `renumberedOrdinal` field for the ordinal-based pairing this generator no longer performs |');
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
  lines.push('capture-scenario unit, not to this generator.');
  lines.push('');
  lines.push('**Edge-level coverage does not wait for that.** This generator carries its');
  lines.push('own binding table, resolved and VALIDATED at generation time against the');
  lines.push('corpus, which is why section ' + model.sections.coverage + ' reports ' + edgeLevelCount + ' row' +
    (edgeLevelCount === 1 ? '' : 's') + ' driven at edge level');
  lines.push('today rather than 0. A binding names the edge by the same stable semantic');
  lines.push('identity the pairing uses - file, routed carrier and guarded subject - and');
  lines.push('the scenario by its corpus id, and generation FAILS if the pair does not');
  lines.push('resolve to exactly one edge per tree or if the scenario does not exist or');
  lines.push('does not drive a route the edge is reachable from. A binding that rots is');
  lines.push('therefore fatal rather than silently downgraded, which is the property that');
  lines.push('makes it evidence. `coversEdges` remains the route for the corpus unit to');
  lines.push('add more without touching this file, and both joins are read.');
  lines.push('');
  lines.push('The remaining rows report route-level coverage, which is weaker: a scenario');
  lines.push('that reaches a route does not establish that it reached a particular error');
  lines.push('branch within it.');
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
  // The pairing tier is stated on every row that has one, because closure is
  // permitted on two of the three and a reviewer needs to know which they are
  // reading without going back to section 8.
  const via = row.pairedBy
    ? ' Paired by ' + row.pairedBy + '.'
    : '';
  const transition = (row.prescribed || []).length
    ? ' The two trees differ in ' + row.prescribed.join(' and ') +
      ', which the AAP prescribes and this comparison records rather than ' +
      'reads as an R-e failure.'
    : '';
  if (row.closure === CLOSURE.CLOSED) {
    return 'CLOSED. Baseline and target both produce ' +
      outcomeText(row.targetOutcome) + ', measured at `' +
      lineRef(row.baseline) + '` and `' + lineRef(row.target) + '`.' + via + transition;
  }
  if (row.closure === CLOSURE.MECHANISM) {
    return 'CLOSED - the callback boundary is gone and the mapping is not. ' +
      row.mechanismNote;
  }
  if (row.closure === CLOSURE.NO_MAPPING) {
    return 'NOT COMPARED - this target site has no baseline counterpart and ' +
      'produces no response, so it introduces no error-to-response mapping ' +
      'for R-e to hold either tree to. Its disposition above is what it does; ' +
      'there is no baseline fact it could contradict.';
  }
  if (row.closure === CLOSURE.AMBIGUOUS) {
    return '**OPEN - pairing not established.** ' +
      (row.unpairedBecause || 'no semantic pairing could be established') +
      ', so neither verdict may be borrowed.' + via;
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
      outcomeText(row.targetOutcome) + '. What differs: ' +
      (row.differences || []).join(', ') + '. R-e requires these to match, and no ' +
      'approved deviation names this edge.' + via + transition +
      (row.nearestOnly ? ' ' + row.nearestOnly + '.' : '');
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
  const coverage = coverageFor(edge, model.scenarios, model.edgeBindings);
  if (coverage.level === 'edge-level') {
    return 'edge-level, by ' + coverage.scenarios.map(code).join(', ') +
      ' - a scenario that reaches this branch. Section ' + model.sections.coverage +
      ' carries the binding and the reason it reaches it.';
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
      // explanation, which is all an unconditional `- [ ]` amounts to.
      // A TICK MEANS PROVED, and it means nothing else. Three things make it
      // false, and each of them must be able to clear a tick on its own: the
      // closure comparison did not close the row; the row's reachability or
      // caller could not be resolved, so its own facts are provisional; or the
      // edge is proven unreachable, in which case there is no outcome on
      // either tree and "closed" would be parity of nothing against nothing.
      // A row asking a reader to confirm it by hand must not carry a tick.
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
 * The closure register: what the run PROVED about the target, per row.
 *
 * A document generated from one tree closes no row, so it establishes no
 * target edge's status, payload, side effects or timing. This section states
 * mechanically how many rows were closed and against what, and names every row
 * that was not - a count of closed rows is worth nothing if the open ones are
 * invisible.
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
  // The open arithmetic, asserted on the REAL rows and not only on a
  // synthetic fixture. This document printed two different figures for the
  // same quantity - 96 in its preamble and 119 across its own verdict
  // buckets - because four call sites each decided what "open" meant. The
  // predicate is now one function and this is the check that it stays one
  // number: the authoritative total, the partition published for display,
  // and a direct count over the rows must agree before anything is written.
  const partitioned = OPEN_CLOSURES.reduce(function (total, state) {
    return total + (sum.openByBucket[state] || 0);
  }, 0) + sum.openProvisional;
  const counted = model.closure.rows.filter(isOpenRow).length;
  if (sum.closedTotal + sum.open + sum.notComparedTotal !== sum.totalRows) {
    throw new AnalysisError(
      'the three totals do not cover the rows: ' + sum.closedTotal +
      ' closed + ' + sum.open + ' open + ' + sum.notComparedTotal +
      ' not comparable does not equal ' + sum.totalRows + ' rows. Every row ' +
      'must land in exactly one of the three, so this is fatal.'
    );
  }
  if (sum.open !== partitioned || sum.open !== counted) {
    throw new AnalysisError(
      'the open-row accounting disagrees with itself: the summary says ' +
      sum.open + ', its published partition sums to ' + partitioned +
      ' and a direct count over the rows gives ' + counted + '. Two figures ' +
      'for one quantity make the closure claim unreadable whichever is ' +
      'right, so this is fatal. A closure state that is in no bucket is the ' +
      'usual cause; every state must appear in exactly one of ' +
      'OPEN_CLOSURES, CLOSED_CLOSURES or NOT_COMPARED_CLOSURES.'
    );
  }
  lines.push('Each row above is joined to the row measuring the same edge on the other');
  lines.push('tree and closed only when the two agree on every dimension R-e names.');
  lines.push('All eight are recorded on every row; the six below are COMPARED:');
  lines.push('');
  OUTCOME_DIMENSIONS.forEach(function (entry) {
    if (entry[0] === 'surface' || entry[0] === 'timing') {
      return;
    }
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
  lines.push('- **The shim\'s builder chain names the response where the source does.**');
  lines.push('  `return reply().redirect("/home")` produces a redirect, and reading only');
  lines.push('  the `reply` token recorded it as unknowable - so against a target that');
  lines.push('  produces `h.redirect(...)` the comparison reported a payload difference on');
  lines.push('  6 rows where an unknown was being compared against a known. The baseline');
  lines.push('  parser\'s own builder resolves on `.redirect`, `.code`, `.header` and');
  lines.push('  `.view` and NOT on `.type` or `.bytes`, so the last resolving member is');
  lines.push('  read as the kind and a chain with no resolving member is still recorded as');
  lines.push('  unknowable - which is the never-settling and builder-returned shapes.');
  lines.push('');
  lines.push('Two dimensions are RECORDED ON EVERY ROW AND NOT READ AS R-e FAILURES,');
  lines.push('because the AAP prescribes a change to both and reading a prescribed change');
  lines.push('as a failure sends a reviewer to preserve something the plan required to');
  lines.push('change. Neither is dropped: every row carries both values, and the ' +
    sum.prescribedTransitions + ' rows');
  lines.push('that closed while carrying one are listed in full below.');
  lines.push('');
  lines.push('- **Surface** is where the code lives. AAP 0.6.4 mandates extraction, so a');
  lines.push('  branch that sat inline in a routed handler now sits in an internal callee');
  lines.push('  it calls, and the client receives the same response either way.');
  lines.push('- **Settlement timing is DIRECTIONAL, and only one direction is');
  lines.push('  prescribed.** Under the shim a handler signalled its response out of band');
  lines.push('  and fell off the end, so a chain\'s own value was routinely discarded;');
  lines.push('  rules T-1 and T-3 exist to make that chain return it. So a baseline that');
  lines.push('  waited for nothing becoming a target that waits is the migration doing');
  lines.push('  what it was told. A target that waits for LESS than the baseline did may');
  lines.push('  drop a response the baseline delivered, and that is still a failure - the');
  lines.push('  rule is one-sided, and a self-test asserts both of its sides.');
  lines.push('');
  lines.push('| Verdict | Rows | What it means |');
  lines.push('|---|---:|---|');
  lines.push('| closed | ' + sum.closed + ' | baseline and target agree on every compared dimension |');
  lines.push('| closed by approved deviation | ' + sum.approved + ' | the outcome changed, and this exact edge and this exact change are on the approved list |');
  lines.push('| closed - callback boundary removed by rule T-3 | ' + sum.mechanism + ' | the baseline site is a callback boundary the conversion turns into an `await`, and every response it produced is still produced in the same routed carrier - the row names where |');
  lines.push('| **open - outcome changed** | ' + sum.changed + ' | R-e requires these to match and they do not; each row names the dimensions |');
  lines.push('| **open - no target row** | ' + sum.missing + ' | the baseline edge could not be located in the target |');
  lines.push('| **open - new in the target** | ' + sum.added + ' | no baseline fact to preserve, so nothing is verified |');
  lines.push('| **open - pairing not established** | ' + sum.ambiguous + ' | no semantic pairing could be established in that carrier, so neither verdict may be borrowed |');
  lines.push('| **open - compared equal on a provisional fact** | ' + sum.openProvisional + ' | the outcomes agree, but the edge\'s own reachability or caller is unresolved, so the agreement is provisional |');
  lines.push('| not compared - proven unreachable | ' + sum.unreachable + ' | nothing in the corpus reaches the edge, so there is no outcome on either tree to compare |');
  lines.push('| not compared - new mechanism, produces no response | ' + sum.noMapping + ' | a target site with no baseline counterpart that produces no response, so it introduces no error-to-response mapping for R-e to hold either tree to |');
  lines.push('| **closed, total** | **' + sum.closedTotal + '** | |');
  lines.push('| **open, total** | **' + sum.open + '** | the authoritative figure. Section ' + model.sections.preamble + ' quotes this number and `--closure-gate` counts it with the same predicate |');
  lines.push('| **not compared, total** | **' + sum.notComparedTotal + '** | |');
  lines.push('| **all rows** | **' + sum.totalRows + '** | |');
  lines.push('');
  lines.push('One predicate, `isOpenRow`, partitions the rows, and every figure in this');
  lines.push('document for that quantity is derived from it: the three totals cover the');
  lines.push('row count exactly and the open buckets sum to the open total, both asserted');
  lines.push('before anything is written. An earlier edition let four call sites decide');
  lines.push('independently and two of them disagreed by 23 rows - the preamble said 96');
  lines.push('and the buckets said 119 - which makes the closure claim unreadable');
  lines.push('whichever figure was right.');
  lines.push('');
  lines.push('| Reconciliation | Rows |');
  lines.push('|---|---:|');
  lines.push('| baseline rows, all accounted for | ' + sum.baselineAccounted + ' of ' + sum.baselineRows + ' |');
  lines.push('| target rows, all accounted for | ' + sum.targetAccounted + ' of ' + sum.targetRows + ' |');
  lines.push('| **T1** paired by the guarded subject - *may close* | ' + sum.pairedBySubject + ' |');
  lines.push('| **T2** paired by an identical observable outcome - *may close* | ' + sum.pairedByOutcome + ' |');
  lines.push('| **T3-anchored** paired by a uniform residual pool of equal size - ' +
    '*order-independent; every difference reported* | ' +
    sum.pairedByUniformPool + ' |');
  lines.push('| **T3** paired by the nearest outcome - *every difference reported* | ' + sum.pairedByNearest + ' |');
  lines.push('| baseline callback boundaries rule T-3 removed | ' + sum.mechanism + ' |');
  lines.push('| target rows carrying no mapping | ' + sum.noMapping + ' |');
  // Labelled for what the metric COUNTS. It counts every row carrying a
  // prescribed transition whatever its verdict, and an earlier edition
  // labelled it "closed while carrying" - so the table claimed 17 closed
  // while its own detail table held 14 closed, 2 changed and 1 ambiguous.
  // That is the same defect as a closure count disagreeing with its rows,
  // one section further down. Both figures are now published, and the
  // renderer asserts the detail table's length against the metric.
  lines.push('| rows carrying a prescribed mechanism transition, any verdict | ' +
    sum.prescribedTransitions + ' |');
  lines.push('| of those, closed | ' + sum.prescribedClosed + ' |');
  lines.push('');
  lines.push('### Why the pairing is not the printed identity, and not source order');
  lines.push('');
  lines.push('The identity a row prints is `<file>.<carrier>.<class>.<ordinal>`, and two');
  lines.push('of its four components are not invariants of this migration. **The class');
  lines.push('flips**: a `.catch` whose body called `reply(err)` is a response-class edge');
  lines.push('at the reply site, and the converted `.catch` that returns the error has no');
  lines.push('terminal, so the edge is the handler itself. Both classes then renumber and');
  lines.push('an id match becomes an artefact of the renumbering - measured on');
  lines.push('`course.deleteCourse`, where taking the match paired line 151 with line 192');
  lines.push('and reported two unchanged rows changed. **The carrier moves**: AAP 0.6.4');
  lines.push('mandates extraction, so `createCourseCore`, `listCore`, `lookupTrinket`,');
  lines.push('`startUpload`, `abandon`, `settle`, `logFailure`, `removeTempFile`,');
  lines.push('`redactText` and the stream handlers all hold code that used to sit inline');
  lines.push('in a routed handler, and grouping by the lexical carrier read every one of');
  lines.push('those edges as deleted from one carrier and created in another - measured,');
  lines.push('41 rows "missing" and 28 "new" on a tree where almost none of either had');
  lines.push('happened.');
  lines.push('');
  lines.push('An earlier edition papered over both by FILLING GAPS POSITIONALLY, pairing');
  lines.push('the k-th unpaired baseline row in a gap with the k-th unpaired target row.');
  lines.push('78 pairs rested on source order and 24 of those overrode an');
  lines.push('identically-named row elsewhere, so rows were closed on the order two files');
  lines.push('happen to list their statements in. **No row closes on source order here.**');
  lines.push('Edges are grouped by the ROUTED carrier - resolved through each');
  lines.push('module-local function\'s traced callers, which makes extraction transparent');
  lines.push('because the route is what a client reaches and the route surface is an');
  lines.push('invariant this migration gates - and paired within that group on the tiers');
  lines.push('above. A tie between two equally near candidates is reported ambiguous');
  lines.push('rather than resolved by any rule at all.');
  lines.push('');
  lines.push('**No tier decides closure.** The tier decides only WHICH target row a');
  lines.push('baseline row is compared against; the verdict then comes from the same');
  lines.push('comparison for every tier - every R-e dimension must agree, and the only');
  lines.push('movement permitted in a closed row is a mechanism transition the AAP');
  lines.push('prescribes, listed by row above. So a T3 or T3-anchored pair closes exactly');
  lines.push('when its only difference is a surface move, and is reported open with the');
  lines.push('differing dimensions named otherwise. In this run ' + sum.pairedByUniformPool +
    ' rows paired at');
  lines.push('T3-anchored and ' + sum.pairedByNearest + ' at T3.');
  lines.push('');
  lines.push('Two editions of this table got that wrong in opposite directions, and both');
  lines.push('are recorded because the second is the one a reader would not otherwise');
  lines.push('suspect. The first labelled these tiers "never closes", which was simply');
  lines.push('untrue of them. The second made it true of the outcome dimensions but');
  lines.push('ranked the three settlements and let a move up the rank close a row, so a');
  lines.push('pairing this tier had not established could still close on a settlement');
  lines.push('change - two soft steps compounding into a tick. The settlement');
  lines.push('prescription is withdrawn, so the only movement any tier may close over is');
  lines.push('a surface move, which AAP 0.6.4 mandates outright. What makes these tiers');
  lines.push('safe is not the tier: it is that no tier can close a row whose observable');
  lines.push('outcome moved, which a scanner self-test asserts by driving all four tiers');
  lines.push('against outcomes that differ on funnel, on status and on settlement.');
  lines.push('');
  lines.push('One tier does use position, and the distinction is worth stating plainly');
  lines.push('rather than eliding. **T3-anchored** pairs a residual pool by position, but');
  lines.push('only when that pool is uniform on BOTH sides - every member byte-identical');
  lines.push('in outcome to every other member of its own side - and equal in size. Under');
  lines.push('those two conditions every possible bijection yields the same verdict on the');
  lines.push('same rows, so the order the two files list their statements in cannot change');
  lines.push('the answer. That is the property the old gap-filling lacked; using position');
  lines.push('was never the defect in itself. Where either condition fails the tier');
  lines.push('declines and the rows are reported missing and added, which is the honest');
  lines.push('reading: one tree has an edge the other does not. Both conditions are pinned');
  lines.push('by a scanner self-test, including the two negative cases.');
  lines.push('');

  // The same predicate the summary counted and the gate enforces, so the
  // listing's length IS the figure printed above it rather than a fourth
  // independent reading of the rows.
  const open = model.closure.rows.filter(isOpenRow);

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

  // The mechanism closures, rendered. They contribute to the published closed
  // total, and until this table existed NO section showed them: the per-file
  // inventory is keyed on TARGET edges and a removed baseline boundary has
  // none, the open-row listing filters them out because they are closed, and
  // the prescribed table only holds rows with a prescribed transition. Four
  // rows therefore counted toward closure with nothing a reader could audit,
  // which makes the closed total exactly as unverifiable as an unticked box.
  const mechanismRows = model.closure.rows.filter(function (row) {
    return row.closure === CLOSURE.MECHANISM;
  });
  if (mechanismRows.length !== model.closure.summary.mechanism) {
    throw new AnalysisError(
      'the mechanism-closure accounting disagrees with itself: the summary ' +
      'says ' + model.closure.summary.mechanism + ' and the table rendered ' +
      'below it holds ' + mechanismRows.length + ' row(s). These rows count ' +
      'toward the closed total, so a figure without its evidence is fatal.'
    );
  }
  lines.push('');
  lines.push('### Baseline callback boundaries closed by rule T-3');
  lines.push('');
  if (!mechanismRows.length) {
    lines.push('**None.** No baseline callback boundary was closed on the grounds that the');
    lines.push('conversion removed the boundary itself, so every closed row on this tree');
    lines.push('is a compared pair.');
  } else {
    lines.push('These ' + mechanismRows.length + ' row' +
      (mechanismRows.length === 1 ? '' : 's') + ' close without a target row to' +
      ' compare against, so they');
    lines.push('are stated in full here rather than counted. Rule T-3 puts the promise');
    lines.push('boundary at the lifecycle method, which means a baseline callback whose');
    lines.push('own error parameter carried a disposition can disappear as a SITE while');
    lines.push('every response it produced is still produced by the routed carrier that');
    lines.push('replaced it. The closure is that claim, and it is only as good as the');
    lines.push('surviving carrier named in the last column - which is why the column is');
    lines.push('here.');
    lines.push('');
    lines.push('| Row | Baseline edge | Baseline outcome | Why the boundary closes |');
    lines.push('|---|---|---|---|');
    mechanismRows.forEach(function (row) {
      const edge = row.baseline || row.target;
      lines.push('| `' + row.id + '` | `' + lineRef(edge) + '` | ' +
        cell(row.baselineOutcome ? outcomeText(row.baselineOutcome) : 'not measured') +
        ' | ' + cell(row.mechanismNote ||
          'the boundary produced no response') + ' |');
    });
  }

  const prescribed = model.closure.rows.filter(function (row) {
    return (row.prescribed || []).length > 0;
  });
  // The metric published in the reconciliation table above must be the length
  // of the table rendered below it. An earlier edition published 17 under a
  // label claiming they were closed while this table held 14 closed, 2
  // changed and 1 ambiguous - a count contradicting its own evidence, which
  // is the one defect this whole section exists to prevent.
  if (prescribed.length !== model.closure.summary.prescribedTransitions) {
    throw new AnalysisError(
      'the prescribed-transition accounting disagrees with itself: the ' +
      'summary says ' + model.closure.summary.prescribedTransitions +
      ' and the table rendered below it holds ' + prescribed.length +
      ' row(s). A published figure its own evidence table contradicts is ' +
      'not evidence, so this is fatal.'
    );
  }
  lines.push('');
  lines.push('### Rows carrying a prescribed mechanism transition');
  lines.push('');
  if (!prescribed.length) {
    lines.push('**None.** No row on this tree differs from its baseline row in surface or');
    lines.push('in settlement direction, so the two recorded-not-failed dimensions changed');
    lines.push('nothing anywhere and the closure verdicts rest on the compared dimensions');
    lines.push('alone.');
  } else {
    lines.push('Every row whose two trees differ in a dimension the AAP prescribed a');
    lines.push('change to. They are listed because a tick that absorbed a difference');
    lines.push('silently is the defect this whole section exists to avoid: a reviewer who');
    lines.push('disagrees with a transition can find it here rather than by re-deriving');
    lines.push('it. A row that ALSO differs on a compared dimension is open, and appears');
    lines.push('above as well.');
    lines.push('');
    lines.push('| Row | Edge | Verdict | Prescribed transition |');
    lines.push('|---|---|---|---|');
    prescribed.forEach(function (row) {
      const edge = row.baseline || row.target;
      lines.push('| `' + row.id + '` | `' + lineRef(edge) + '` | ' + cell(row.closure) +
        ' | ' + cell(row.prescribed.join('; ')) + ' |');
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
    const coverage = coverageFor(edge, model.scenarios, model.edgeBindings);
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
  lines.push('| edge-level | ' + levels['edge-level'].length + ' | a scenario reaches this row\'s own branch, by a declared binding or by a scenario naming the id |');
  lines.push('| route-level only | ' + levels['route-level'].length + ' | a scenario drives the row\'s route, which is not the same as reaching its failure branch |');
  lines.push('| **not driven** | ' + levels.uncovered.length + ' | no scenario names the row or its routes |');
  lines.push('');
  lines.push('**Route-level is not coverage of an error edge.** One minimal request per');
  lines.push('route exercises success paths; an error edge needs a request that reaches');
  lines.push('its own branch. The distinction is the reason this table has three rows');
  lines.push('rather than two, and the reason a route-level row is reported as');
  lines.push('unverified above.');
  lines.push('');
  lines.push('### How an edge is joined to the scenario that drives it');
  lines.push('');
  lines.push('Neither side of this join can hold the other\'s names. A scenario cannot');
  lines.push('carry an edge id in `covers` - `test/parity/capture.js` validates every');
  lines.push('entry there against the route manifest and reports anything else as an');
  lines.push('unknown route - and an edge id is this generator\'s own namespace, whose');
  lines.push('`<class>.<ordinal>` tail renumbers for the reasons section ' +
    model.sections.closure + ' gives, so a');
  lines.push('corpus naming edge ids would rot exactly as the pairing did. So the');
  lines.push('binding is declared in the generator, beside the identity it uses, and it');
  lines.push('uses the same stable semantic identity the pairing does: the file, the');
  lines.push('carrier, and the guarded subject. A scenario that carries a `coversEdges`');
  lines.push('array still joins through it, so a corpus that later adopts the field');
  lines.push('needs no change here.');
  lines.push('');
  lines.push('**Every binding is verified before this document is written, and a failure');
  lines.push('is fatal.** It must resolve to exactly one edge per analysed tree - two');
  lines.push('would mark both driven when one was, none means it has rotted against a');
  lines.push('tree that moved - every scenario it names must exist in the corpus, and');
  lines.push('that scenario\'s route must be one the edge is reachable from.');
  lines.push('');
  if (!model.edgeBindings || !model.edgeBindings.entries.length) {
    lines.push('**No binding is declared.** Every edge-level row above comes from a');
    lines.push('scenario naming the id itself.');
  } else {
    lines.push('| Edge | Route it is reached from | Scenario | Why this scenario reaches this branch |');
    lines.push('|---|---|---|---|');
    model.edgeBindings.entries.forEach(function (entry) {
      lines.push('| `' + entry.edge.id + '` `' + lineRef(entry.edge) + '` | ' +
        ((entry.edge.routes || []).map(code).join(', ') || 'n/a') + ' | ' +
        entry.binding.scenarios.map(code).join(', ') + ' | ' +
        cell(entry.binding.why) + ' |');
    });
  }
  lines.push('');

  // The SAME predicate the summary, the closure table and both gates use, so
  // this count is a subset of the open total rather than a fifth reading of
  // the rows: an earlier edition filtered on "not closed and not approved"
  // here and reported 81 undriven rows against an open total of 53.
  const changedUndriven = model.closure
    ? model.closure.rows.filter(function (row) {
      if (!isOpenRow(row)) {
        return false;
      }
      const edge = row.target || row.baseline;
      return coverageFor(edge, model.scenarios, model.edgeBindings).level !== 'edge-level';
    })
    : [];

  if (model.closure) {
    lines.push('### Open rows with no scenario of their own');
    lines.push('');
    if (!changedUndriven.length) {
      lines.push('None: every open row has a scenario reaching its own branch.');
    } else {
      lines.push('**' + changedUndriven.length + '** of the ' +
        model.closure.summary.open + ' open rows in section ' +
        model.sections.closure + ' have no scenario reaching their own branch, so');
      lines.push('their target outcome is a reading of the code rather than a measured');
      lines.push('response. Each one needs either a binding in this generator or a');
      lines.push('scenario in `test/parity/capture.js` whose `coversEdges` array carries');
      lines.push('the id - `covers` is route-keys only and capture.js rejects anything');
      lines.push('else there.');
      lines.push('');
      lines.push('The last column is the part an author needs and the part prose cannot');
      lines.push('keep current, so it is computed. A row is only bindable to a scenario');
      lines.push('that reaches its BRANCH, and a scenario sweeping the route for its');
      lines.push('success path does not: it asserts the response the route gives when');
      lines.push('nothing fails. So the column names the non-success scenarios already');
      lines.push('driving the row\'s routes, which are the only existing candidates, and');
      lines.push('says plainly when there are none - which means a NEW scenario is');
      lines.push('required and no binding can be written from what the corpus holds');
      lines.push('today. A row with no routes at all cannot be driven by any HTTP');
      lines.push('scenario in any corpus, and says so.');
      lines.push('');
      lines.push('| Row | Edge | Verdict | Existing candidate scenarios |');
      lines.push('|---|---|---|---|');
      changedUndriven.slice(0, 80).forEach(function (row) {
        const edge = row.target || row.baseline;
        const routes = (edge && edge.routes) || [];
        let candidates;
        if (!routes.length) {
          candidates = '**none possible** - the edge sits on no route, so no ' +
            'HTTP scenario reaches it';
        } else {
          const found = [];
          routes.forEach(function (route) {
            (model.scenarios.failureByRoute.get(route) || []).forEach(function (id) {
              if (found.indexOf(id) === -1) {
                found.push(id);
              }
            });
          });
          candidates = found.length
            ? found.map(code).join(', ')
            : '**none in the corpus** - a new non-success scenario is required ' +
              'on ' + (routes.length === 1 ? 'this route' : 'one of these routes');
        }
        lines.push('| `' + row.id + '` | `' + lineRef(edge) + '` | ' +
          cell(row.closure) + ' | ' + candidates + ' |');
      });
      if (changedUndriven.length > 80) {
        lines.push('');
        lines.push('... and ' + (changedUndriven.length - 80) +
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
// CITED_LOCATORS below carries the locations the migration specification cites
// for the funnels, the shim and the quirk sites. Some do not match the tree:
// the `.catch(request.fail)` chain in `lib/controllers/pages.js` is cited at
// the `.catch` link while the chain statement it belongs to begins two lines
// above it, so the citation and the measured row differ. A reviewer following
// either must land on the same edge, which is what this section reconciles. A
// cited locator with nothing measured against it is informative too: on a
// converted tree it means the row has closed.
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
 * Write the machine-readable edge index.
 *
 * The document is prose with tables in it, so a consumer asking which edge a
 * scenario reached, or whether a changed edge was driven, would have to parse
 * that prose - and a checklist and a corpus that cannot be joined are two
 * unrelated artifacts describing the same edges. This index is the join
 * surface: one record per row, keyed by the same stable id the document prints,
 * carrying everything a consumer needs and no prose at all.
 *
 * Deterministic by construction - sorted, no timestamp - so it can be
 * committed and diffed like the document.
 */
function writeEdgeIndex(indexPath, model) {
  const records = model.allEdges.map(function (edge) {
    const row = model.closure ? model.closure.byTargetId.get(edge.id) : null;
    const coverage = model.scenarios ? coverageFor(edge, model.scenarios, model.edgeBindings) : null;
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
      pairedBy: row ? (row.pairedBy || null) : null,
      groupKey: row ? (row.groupKey || null) : null,
      nearestOnly: row && row.nearestOnly ? row.nearestOnly : null,
      unpairedBecause: row && row.unpairedBecause ? row.unpairedBecause : null,
      prescribed: row && row.prescribed ? row.prescribed : [],
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
          reason: row.unpairedBecause || 'no semantic pairing could be established'
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
    schema: 'trinket-oss/error-edge-index@3',
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
 * about a RUN, not about the analysed commits, and in the committed body they
 * would make the deliverable differ between two machines analysing the same
 * code. They are still worth recording - where a run happened and when - so
 * they are recorded here, in a sidecar that is not the reviewed artifact.
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

/**
 * Analyse a tree, evaluate every check and gate, and write the artifacts.
 * Returns a summary so a caller can assert on the run without parsing the
 * document.
 *
 * @param {Object} options `appRoot` and `outPath`, the `countsCheck` mode, and
 *   optionally `baselineRoot`, `scenariosPath`, `edgeIndexPath`,
 *   `provenanceOutPath`, `closureGate` and `coverageGate`
 * @returns {Object} { outPath, appRoot, rows, counts, check, selfTests,
 *   funnels, files, bytes }
 */
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
  // Testing `!edge.carrier` instead is satisfied by no edge at all: `push()`
  // substitutes `'(module scope)'` when carrier resolution finds nothing, so
  // the filter would always be empty and the throw unreachable. An edge that
  // genuinely cannot be driven would then be written into the document with no
  // indication of it, which is worse than the check being absent, because the
  // document's driveability section asserts that every row is drivable on the
  // strength of this filter.
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
  // Kept in scope beyond the closure block so the edge-to-scenario bindings
  // can be resolved against the baseline tree as well: a binding that
  // matches the target and not the baseline is still a binding that cannot
  // be verified on both sides of the comparison it feeds.
  let baselineAnalysis = null;
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
    baselineAnalysis = analyseTree(baselineRoot, 'baseline');
    closure = joinTrees(baselineAnalysis.allEdges, allEdges);
    closure.baselineFiles = baselineAnalysis.files;
  }

  // ---- Driven coverage, when a corpus was named ---------------------------
  const scenarios = options.scenariosPath ? readScenarios(options.scenariosPath) : null;

  // The declared edge-to-scenario bindings, resolved against this tree and
  // against the baseline where one was supplied. An entry that resolves to
  // anything other than exactly one edge, names a scenario the corpus does
  // not contain, or names a scenario driving a route the edge is not
  // reachable from, is fatal: an unverifiable coverage claim reads as a
  // measurement, which is worse than an absent one.
  const edgeBindings = resolveEdgeBindings(allEdges, scenarios, 'analysed');
  const unresolvedBindings = edgeBindings.unresolved.slice();
  if (baselineAnalysis) {
    resolveEdgeBindings(baselineAnalysis.allEdges, scenarios, 'baseline')
      .unresolved.forEach(function (problem) {
        unresolvedBindings.push(problem);
      });
  }
  if (unresolvedBindings.length) {
    throw new AnalysisError(
      'the edge-to-scenario bindings do not resolve against the trees being ' +
      'analysed, so the edge-level coverage they claim cannot be verified:\n' +
      unresolvedBindings.map(function (problem) {
        return '  ' + problem;
      }).join('\n') +
      '\nEach binding names a file, a carrier and a guarded subject and must ' +
      'match exactly one edge per tree. Update EDGE_SCENARIO_BINDINGS to ' +
      'match the tree, or remove the binding: a coverage claim nobody can ' +
      're-derive is not evidence.'
    );
  }

  const sections = {
    // The preamble is section 1 and its heading is fixed rather than
    // numbered from here; it is named so the closure table can point back at
    // the one sentence that quotes the same open figure.
    preamble: 1,
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
    edgeBindings: edgeBindings,
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
    // `isOpenRow` is the authoritative predicate and this gate is the reason
    // it is defined the way it is: an unestablished pairing is not a
    // preserved mapping, a PROVEN UNREACHABLE row has no outcome on either
    // tree to preserve, and a row that compared equal on an unresolved
    // reachability fact is provisional rather than closed. The summary, the
    // preamble and the verdict table all count with this same function, so a
    // gate failure and the document's own figure can never disagree.
    const open = closure.rows.filter(isOpenRow);
    if (open.length) {
      throw new AnalysisError(
        '--closure-gate: ' + open.length + ' of ' + closure.rows.length +
        ' error-edge row(s) are not closed against the baseline. R-e requires ' +
        'every converted path to preserve its error-to-response mapping, so ' +
        'each of these is an unpreserved or unverified mapping:\n' +
        open.slice(0, 20).map(function (row) {
          const edge = row.baseline || row.target;
          // Naming the DIMENSIONS is what makes the line actionable. The
          // one-line outcome summary carries the funnel, the status, whether
          // a response is produced and the surface, and NOT the payload,
          // side effects, log calls or timing - so a row that differs only
          // in one of those four printed as "changed - baseline X vs target
          // X", two identical strings and no stated difference, on 4 of the
          // measured rows. A reader has no way to act on that, and a reviewer
          // is right to read it as the gate contradicting itself.
          const differs = (row.differences || []).length
            ? ' - differs in ' + row.differences.join(', ')
            : '';
          return '  ' + row.id + ' (' + lineRef(edge) + '): ' + row.closure +
            differs +
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
    // The gate applies to rows that are OPEN, on the same predicate every
    // other figure uses: a closed row's outcome was established by comparing
    // two trees, and a row carrying no mapping has nothing to drive.
    const undriven = closure.rows.filter(function (row) {
      if (!isOpenRow(row)) {
        return false;
      }
      const edge = row.target || row.baseline;
      return coverageFor(edge, scenarios, edgeBindings).level !== 'edge-level';
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
  '                            trinket-oss/error-edge-index@3: one record per',
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
 * have used - and A VALUE BEGINNING WITH A DASH IS A MISSING VALUE. Any
 * leading dash is rejected, not just `--`, because testing for `--` alone
 * accepts `--out -o` and records an output path of "-o"; `--flag=value` is the
 * escape hatch for a value that genuinely begins with a dash.
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
  reDifferences: reDifferences,
  EDGE_SCENARIO_BINDINGS: EDGE_SCENARIO_BINDINGS,
  OPEN_CLOSURES: OPEN_CLOSURES,
  CLOSED_CLOSURES: CLOSED_CLOSURES,
  NOT_COMPARED_CLOSURES: NOT_COMPARED_CLOSURES,
  buildCorpus: buildCorpus,
  funnelsNamedIn: funnelsNamedIn,
  calleeKind: calleeKind,
  driveVia: driveVia,
  edgeSubject: edgeSubject,
  isDrivable: isDrivable,
  memberMentions: memberMentions,
  collectBindings: collectBindings,
  collectDeclaredNames: collectDeclaredNames,
  collectFileFacts: collectFileFacts,
  coverageFor: coverageFor,
  escapeInline: escapeInline,
  isOpenRow: isOpenRow,
  isProvisionalRow: isProvisionalRow,
  isReturned: isReturned,
  joinTrees: joinTrees,
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
  resolveEdgeBindings: resolveEdgeBindings,
  resolveFunnels: resolveFunnels,
  routedGroupResolver: routedGroupResolver,
  runSelfTests: runSelfTests,
  targetText: targetText
};

// Guarded so that requiring this module - Mocha collects `test/**/*.js` under
// the committed mocha.opts - neither generates a document nor exits.
if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
