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
// Disposition is a CLOSED vocabulary of exactly the six values AAP 0.6.3
// defines, and every row carries exactly one of them:
//
//   calls request.fail locally | calls reply(err) | returns or throws a Boom
//   logs and continues | swallows silently | resolves on a later callback
//
// Six values cannot express the sub-shapes that a mechanical conversion
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
//   node test/parity/error-edges.js [--app <path>] [--out <path>]
//                                   [--counts-check auto|strict|off]
//
//   --app    tree to analyse. Default: the repository this file lives in.
//   --out    file to write. Default: <this repository>/docs/error-edge-inventory.md.
//            The default deliberately resolves against THIS repository and
//            never against --app, so generating the baseline inventory cannot
//            write into the baseline worktree.
//
// Exit 0 on success. Exit 1 on any failure, with the reason on stderr.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
  LATE_RESOLVE: 'resolves on a later callback'
});

const DISPOSITION_ORDER = Object.freeze([
  DISPOSITION.FAIL_LOCAL,
  DISPOSITION.REPLY_ERR,
  DISPOSITION.BOOM,
  DISPOSITION.LOG_CONTINUE,
  DISPOSITION.SWALLOW,
  DISPOSITION.LATE_RESOLVE
]);

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
// partial document is written: writeFileSync happens once, after every check
// has passed.
class AnalysisError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AnalysisError';
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

  return SELF_TESTS.length + SELF_TESTS_THROWING.length;
}

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
function findCarriers(relPath, src, codeOnly) {
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
  for (let i = 0; i < carriers.length; i++) {
    carriers[i].end = i + 1 < carriers.length ? carriers[i + 1].start : src.length;
  }
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
  for (let i = 0; i < carriers.length; i++) {
    carriers[i].end = i + 1 < carriers.length ? carriers[i + 1].start : src.length;
  }
  return carriers;
}

function carrierAt(carriers, offset) {
  let found = null;
  for (let i = 0; i < carriers.length; i++) {
    if (carriers[i].start <= offset && offset < carriers[i].end) {
      found = carriers[i];
    }
  }
  return found;
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
  MODULE: 'module scope'
});

function surfaceFor(relPath, carrier) {
  if (relPath === INLINE_PRE_FILE) {
    return SURFACE.INLINE_PRE;
  }
  if (relPath === HELPERS_FILE) {
    if (carrier && carrier.member === 'register') {
      return SURFACE.SERVER_METHOD;
    }
    return SURFACE.PRE;
  }
  if (CONTROLLER_FILES.indexOf(relPath) !== -1) {
    return carrier ? SURFACE.HANDLER : SURFACE.MODULE;
  }
  return SURFACE.MODULE;
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
      const outer = index > 0 ? chainOfFns[index - 1] : null;
      const floor = outer ? outer.bodyStart + 1 : 0;
      const ceil = outer ? outer.bodyEnd : ctx.codeOnly.length;
      const stmt = statementBounds(ctx.codeOnly, site.parenStart, floor, ceil);
      const lead = ctx.codeOnly.slice(stmt.start, Math.min(stmt.start + 48, stmt.end)).trim();
      return {
        kind: 'promise-chain',
        downstreamCatch: downstream,
        catchLine: downstream ? lineFromIndex(ctx.lineIndex, downstream.parenStart) : null,
        chainReturned: /^(return|await)\b/.test(lead),
        chainLine: lineFromIndex(ctx.lineIndex, stmt.start),
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

/** What kind of value an argument expression is, for reply()-style calls. */
function valueKind(codeExpression) {
  const text = codeExpression.trim();
  if (text === '') {
    return { kind: 'empty' };
  }
  const boom = text.match(/^(?:Boom|errors|Hapi\.error)\.([A-Za-z0-9_$]+)/);
  if (boom) {
    return { kind: 'boom', factory: boom[1], status: BOOM_STATUS[boom[1]] || null };
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

/** Logging calls that reference `name` inside a code range. */
function loggingReferences(codeOnly, from, to, name) {
  const body = codeOnly.slice(from, to);
  const hits = [];
  LOGGING_CALLS.forEach(function (call) {
    let at = body.indexOf(call + '(');
    while (at !== -1) {
      const close = matchDelimiter(codeOnly, from + at + call.length);
      if (close !== -1 && (!name || referencesIdentifier(codeOnly.slice(from + at, close + 1), name))) {
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

/** Response-producing calls whose innermost enclosing function is `fn`. */
function responseCallsDirectlyIn(ctx, fn) {
  const hits = [];
  RESPONSE_CALLS.forEach(function (entry) {
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

/** The raw source line for a 1-based line number, trimmed. */
function sourceLine(ctx, line) {
  const start = ctx.lineIndex[line - 1];
  const end = line < ctx.lineIndex.length ? ctx.lineIndex[line] - 1 : ctx.src.length;
  return ctx.src.slice(start, end).replace(/\s+/g, ' ').trim();
}

/** Whether the token immediately before `offset` is `return`. */
function isReturned(codeOnly, offset) {
  const prev = skipSpaceBack(codeOnly, offset - 1);
  if (prev < 0 || !isIdentifierChar(codeOnly[prev])) {
    return false;
  }
  return readMemberPathBack(codeOnly, prev).text === 'return';
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
  const ctx = {
    relPath: relPath,
    src: src,
    codeOnly: codeOnly,
    kinds: classified.kinds,
    lineIndex: buildLineIndex(src),
    functions: findFunctions(codeOnly),
    carriers: findCarriers(relPath, src, codeOnly),
    bindings: bindings
  };

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
    const carrier = carrierAt(ctx.carriers, offset);
    const surface = surfaceFor(relPath, carrier);
    const edge = {
      file: relPath,
      offset: offset,
      line: line,
      endLine: spec.endLine || line,
      carrier: carrier ? carrier.name : '(module scope)',
      carrierMember: carrier ? carrier.member : null,
      surface: surface,
      routes: routesForCarrier(bindings, relPath, carrier),
      snippet: sourceLine(ctx, line),
      notes: spec.notes || [],
      unresolved: Boolean(spec.unresolved),
      precedence: spec.precedence
    };
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
    const kind = valueKind(arg.code);
    if (kind.kind === 'empty' || kind.kind === 'value') {
      continue;
    }
    const site = m.index + m[0].length - 1 - 'reply'.length;
    terminalOffsets.push(site);
    push(site, {
      precedence: 10,
      disposition: DISPOSITION.REPLY_ERR,
      shape: 'reply(' + summarise(arg.raw) + ')' +
        (isReturned(codeOnly, site) ? '' : ' with no return'),
      valueKind: kind,
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
    push(m.index, {
      precedence: 10,
      disposition: DISPOSITION.BOOM,
      shape: 'throw ' + summarise(src.slice(exprStart, Math.max(exprStart, bounds.end))),
      thrownKind: valueKind(expr),
      propagation: propagationAt(ctx, m.index)
    });
  }

  // -- Pass E: return Boom / return errors ---------------------------------
  // Absent from the baseline tree - it has no such site - and present after
  // conversion, which is exactly why it is detected: the contrast with
  // `throw` is a 404 against a 500.
  const returnBoom = /\breturn\s+(?:Boom|errors|Hapi\.error)\.([A-Za-z0-9_$]+)/g;
  while ((m = returnBoom.exec(codeOnly)) !== null) {
    const exprStart = m.index + m[0].indexOf(m[1]) - (m[0].indexOf(m[1]) - m[0].search(/(?:Boom|errors|Hapi)/));
    terminalOffsets.push(m.index);
    push(m.index, {
      precedence: 10,
      disposition: DISPOSITION.BOOM,
      shape: 'return ' + summarise(src.slice(exprStart, exprStart + 60).split('\n')[0]),
      thrownKind: { kind: 'boom', factory: m[1], status: BOOM_STATUS[m[1]] || null },
      returnedBoom: true,
      propagation: propagationAt(ctx, m.index)
    });
  }

  const terminalSet = terminalOffsets.slice().sort(function (a, b) {
    return a - b;
  });

  function hasTerminalIn(fn) {
    for (let i = 0; i < terminalSet.length; i++) {
      if (terminalSet[i] > fn.bodyStart && terminalSet[i] < fn.bodyEnd) {
        return true;
      }
    }
    return false;
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
    if (hasTerminalIn(handlerFn)) {
      // The handler disposes of the error inside its own body; those sites
      // are already rows and they name this handler as their context.
      return;
    }

    const params = parameterNames(handlerFn);
    const paramName = params.length ? params[0] : null;
    const body = bodyText(codeOnly, handlerFn);
    const logs = loggingReferences(codeOnly, handlerFn.bodyStart, handlerFn.bodyEnd, paramName);
    const anyLogs = logs.length ? logs : loggingReferences(codeOnly, handlerFn.bodyStart, handlerFn.bodyEnd, null);
    const references = paramName
      ? referencesIdentifier(codeOnly.slice(handlerFn.bodyStart, handlerFn.bodyEnd), paramName)
      : false;

    // A handler that produces a response while disposing of no error is the
    // sharpest case in this pass: the rejection is answered as a SUCCESS.
    const producedHere = responseCallsDirectlyIn(ctx, handlerFn);
    const notes = [];
    let disposition;
    if (anyLogs.length > 0) {
      disposition = DISPOSITION.LOG_CONTINUE;
    } else if (body === '') {
      disposition = DISPOSITION.SWALLOW;
      notes.push('The handler body is empty.');
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
      disposition: disposition,
      shape: site.mechanism + ' handler' +
        (disposition === DISPOSITION.LOG_CONTINUE ? ' - logs only' : ' - absorbs'),
      mechanism: site.mechanism,
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
    if (hasTerminalIn(fn)) {
      return;
    }
    const paramName = params[0];
    const bodyRange = codeOnly.slice(fn.bodyStart, fn.bodyEnd);
    const references = referencesIdentifier(bodyRange, paramName);
    const logs = loggingReferences(codeOnly, fn.bodyStart, fn.bodyEnd, paramName);
    const body = bodyText(codeOnly, fn);
    const site = callSiteOf(codeOnly, fn);
    const notes = [];
    let disposition;
    if (logs.length > 0) {
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
    }
    push(fn.keywordAt, {
      precedence: 40,
      disposition: disposition,
      shape: 'error parameter of a callback to ' +
        (site ? '`' + site.calleeText + '`' : 'a local function') +
        (disposition === DISPOSITION.LOG_CONTINUE ? ' - logs only' : ' - undispositioned'),
      callee: site ? site.calleeText : null,
      paramName: paramName,
      loggingCalls: logs,
      referencesParam: references,
      endLine: lineFromIndex(ctx.lineIndex, fn.bodyEnd),
      notes: notes,
      propagation: propagationAt(ctx, fn.keywordAt)
    });
  });

  return { edges: dedupeEdges(edges), counts: counts, carriers: ctx.carriers };
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

function resolveFunnels(edges) {
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
        edge.funnel = kind.kind === 'boom' ? FUNNEL.L3 : FUNNEL.NONE;
      } else {
        edge.funnel = FUNNEL.L3;
      }
      return;
    }

    if (edge.disposition === DISPOSITION.LOG_CONTINUE || edge.disposition === DISPOSITION.SWALLOW) {
      edge.funnel = FUNNEL.NONE;
      return;
    }

    if (edge.disposition === DISPOSITION.LATE_RESOLVE) {
      const produced = edge.producedResponses || [];
      edge.funnel = produced.indexOf('request.fail') !== -1 ? FUNNEL.L2 : FUNNEL.NONE;
      return;
    }

    // DISPOSITION.BOOM - throw, return Boom, or the reply.<prop> TypeError.
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
    if (pre) {
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

const RETURN_DISCIPLINE =
  'Under the shim the call\'s return value is discarded and the deferred ' +
  'promise carries the response, so the converted body must RETURN this ' +
  'value exactly once on this path - a returned-but-unawaited chain and an ' +
  'awaited-but-unreturned one both pass a signature count and both break ' +
  'this edge.';

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

  // DISPOSITION.BOOM
  const kind = edge.thrownKind || { kind: 'value' };
  const prop = edge.propagation || {};
  if (kind.kind === 'type-error') {
    return 'none from this line, and that is part of the contract: it throws ' +
      'before a response is built, so every statement that follows it in the ' +
      'same branch does not run. Layer 1 then logs `err.stack` at error level. ' +
      'Preserve both the absence and the log.';
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
  return 'Layer 1 logs `err.stack` at error level, or `String(err)` when there ' +
    'is no stack. Nothing else is written.';
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
function targetText(edge) {
  return targetCore(edge) + effectsAndTiming(edge);
}

function targetCore(edge) {
  const pre = edge.surface === SURFACE.PRE || edge.surface === SURFACE.INLINE_PRE;
  const prop = edge.propagation || {};

  if (edge.disposition === DISPOSITION.FAIL_LOCAL) {
    let text =
      'Layer 2. request.fail logs its argument at info level, then selects one ' +
      'of three responses: with a negotiated `html` type and a configured ' +
      '`fail.redirect` it flashes `failure`, interpolates `fail.redirect` IN ' +
      'PLACE on the parse-time route object - the cross-request leak - flashes ' +
      '`payload` and `query`, and redirects; with `html`, a configured ' +
      '`fail.html` and no `.json` extension on the path it renders that view ' +
      'through addUserContext; otherwise it returns h.response(json) with ' +
      '`json.flash` attached. Preserve the branch selection, both flash ' +
      'writes, the status and the body. The response is not a Boom, so Layer ' +
      '3 takes its `else if (response.header)` branch and applies ' +
      'Cache-Control, Pragma and Expires. ' + RETURN_DISCIPLINE;
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
        return 'The pre-handler shim\'s fakeReply rejects on an isBoom value, so ' +
          'this Boom keeps its own status - ' + statusPhrase(kind) + ' - and reaches ' +
          'Layer 3 through hapi\'s own lifecycle error handling. It does NOT become ' +
          'a 500: only the handler catch-all does that. Preserve the status, the ' +
          'Boom payload shape and the fact that the pre-handler rejects rather ' +
          'than resolving.';
      }
      return 'The pre-handler shim\'s fakeReply resolves on anything that is not ' +
        'isBoom, so an ordinary Error is RESOLVED as this pre-handler\'s assigned ' +
        'value: the request continues, `request.pre.<assign>` holds the error ' +
        'object, and no error response is produced. Funnel: none. When the value ' +
        'happens to be a Boom the same site rejects instead and the Boom\'s own ' +
        'status reaches Layer 3. Preserve BOTH outcomes and the selection between ' +
        'them - converting this into an unconditional failure response would ' +
        'change every non-Boom case.';
    }
    if (kind.kind === 'boom') {
      return 'The shim\'s reply() resolves an isBoom value unchanged, so the ' +
        'response is this Boom: ' + statusPhrase(kind) + ' with the Boom payload ' +
        'shape. Layer 3 then post-processes it, and for a browser HTML request at ' +
        '401/403/404/>=500 it takes over BEFORE the header block, so the four ' +
        'cache and frame headers do not reach the rendered error page. Preserve ' +
        'the status and the payload. ' + RETURN_DISCIPLINE;
    }
    return 'The shim\'s reply() selects on the runtime value and all three ' +
      'outcomes are observable: an isBoom value resolves unchanged with its own ' +
      'status; any other Error becomes Boom.badImplementation(err.message), so ' +
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
    return 'The value is RETURNED, not thrown, so the wrapper hands it to hapi ' +
      'and the answer carries the Boom\'s own status - ' +
      (statusPhrase(kind) || 'the factory\'s status') + '. Note the contrast ' +
      'with `throw` on this same surface, which Layer 1 converts to 500. ' +
      'Preserve the status and the payload shape.';
  }
  if (prop.downstreamCatch) {
    return 'The rejection is taken by the `.catch(...)` at line ' +
      prop.catchLine + ', so this edge\'s response is that handler\'s - see its ' +
      'row for the status and payload. Preserve the ROUTING as much as the ' +
      'response: after conversion the chain must still be what catches this, ' +
      'not a try/catch added around the handler body, or the edge silently ' +
      'changes funnel.';
  }
  if (pre) {
    return 'The pre-handler shim catches a synchronous throw and rejects with ' +
      'it, so a thrown Boom keeps its own status - ' +
      (statusPhrase(kind) || 'the thrown value\'s status') + ' - and a non-Boom ' +
      'becomes hapi\'s own 500. Layer 3 post-processes the result. Preserve the ' +
      'status and the payload shape; pre-handler throws never reach the handler ' +
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
      preShim = {
        file: parserPath,
        startLine: lineFromIndex(parserLines, fn.keywordAt),
        endLine: lineFromIndex(parserLines, fn.bodyEnd),
        fakeReplyLines: allOccurrenceLines(parser.codeOnly, parserLines, 'fakeReply = function', fn.bodyStart, fn.bodyEnd),
        rejectsOnBoom: /isBoom\s*\)\s*\{\s*reject/.test(body.replace(/\s+/g, ' ')) || body.indexOf('reject(value)') !== -1
      };
    }
  }

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

  return { layer1: layer1, layer2: layer2, layer3: layer3, preShim: preShim, xframePaths: xframePaths };
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

function treeProvenance(dir) {
  const head = git(['-C', dir, 'rev-parse', 'HEAD']);
  const status = git(['-C', dir, 'status', '--porcelain']);
  return {
    path: dir,
    head: head || 'unavailable (no git metadata reachable from this path)',
    subject: head ? git(['-C', dir, 'log', '-1', '--format=%s']) : '',
    dirty: head ? status.length > 0 : false,
    isBaselineCommit: Boolean(head) && head.indexOf(BASELINE_COMMIT.slice(0, 7)) === 0
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

/** Make a source fragment safe inside a Markdown inline code span. */
function code(text) {
  return '`' + String(text).replace(/`/g, '\'').replace(/\r?\n/g, ' ') + '`';
}

function lineRef(edge) {
  return edge.endLine > edge.line
    ? edge.file + ':' + edge.line + '-' + edge.endLine
    : edge.file + ':' + edge.line;
}

function renderProvenance(model) {
  const lines = [];
  lines.push('<!-- provenance: the only part of this document that varies between two runs over the same tree -->');
  lines.push('# Error-edge inventory');
  lines.push('');
  lines.push('| | |');
  lines.push('|---|---|');
  lines.push('| Analysed tree | `' + model.tree.path + '` |');
  lines.push('| Analysed tree HEAD | `' + model.tree.head + '`' +
    (model.tree.subject ? ' - ' + model.tree.subject : '') +
    (model.tree.dirty ? ' **(working tree has uncommitted changes)**' : '') + ' |');
  lines.push('| Is the R-f baseline commit | ' + (model.tree.isBaselineCommit ? 'yes' : 'no') +
    ' (baseline is `' + BASELINE_COMMIT + '`) |');
  lines.push('| Generator | `' + model.tool.path + '` |');
  lines.push('| Generator commit | `' + model.tool.commit + '`' +
    (model.tool.uncommittedChanges ? ' **(uncommitted changes present)**' : '') + ' |');
  lines.push('| Node | `' + process.version + '` |');
  lines.push('| Generated at | ' + model.generatedAt + ' |');
  lines.push('| Token self-check | ' + (model.check.applied ? 'asserted' : 'reported only') +
    ' (`--counts-check=' + model.check.mode + '`) |');
  lines.push('| Rows emitted by this run | ' + model.totals.rows + ' |');
  lines.push('| Exact command | `' + model.invocation + '` |');
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
  lines.push('> Everything below the provenance block is a pure function of the analysed');
  lines.push('> tree, so two runs over one tree differ only inside that block - which makes');
  lines.push('> `diff` on the body a review of the tree rather than of the run.');
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
  lines.push('### Not a funnel, but decisive: the pre-handler shim' +
    (f.preShim ? ', `' + f.preShim.file + ':' + f.preShim.startLine + '-' + f.preShim.endLine + '`' : ''));
  lines.push('');
  lines.push('Pre-handlers are not invoked by the handler wrapper, so **their errors never');
  lines.push('reach Layer 1**. They go through `convertPreHandlers`, whose `fakeReply`:');
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
  lines.push('## 4. How to read a row');
  lines.push('');
  lines.push('```');
  lines.push('  ... - [ ] `<file>:<line>` - <Disposition> - <Funnel> - <Shape>');
  lines.push('  ...       Carrier <reachable code path> - Routes <bound routes> - Source <the line>');
  lines.push('  ...       Target: <the outcome to preserve, ending in Side effects and Timing>');
  lines.push('  ...       Note: <a measured detail, when there is one>');
  lines.push('  ...       See also: <the sibling document that catalogues this edge>');
  lines.push('```');
  lines.push('');
  lines.push('A real row is a line beginning `- [ ] ` at column 0, and its continuation');
  lines.push('lines are indented six spaces and begin `Carrier `, `Target: `, `Note: ` or');
  lines.push('`See also: `. Every line of the sketch above carries a `... ` prefix that a');
  lines.push('real row does not, so counting lines that begin `- [ ] ` at column 0 returns');
  lines.push('the row count this document states and nothing else - the sketch does not');
  lines.push('inflate it by one.');
  lines.push('');
  lines.push('Nothing machine-reads this document. `test/parity/capture.js` carries the');
  lines.push('corresponding failure-path scenarios by hand, in its `error-edge.*` groups,');
  lines.push('and `test/parity/replay.js` cites this checklist as what supplies the failure');
  lines.push('paths that one-minimal-request-per-route cannot reach. The row format is');
  lines.push('stable and grep-friendly so that a reviewer, and a future consumer, can both');
  lines.push('work from it.');
  lines.push('');
  lines.push('**Disposition** is the closed vocabulary of AAP 0.6.3 and every row carries');
  lines.push('exactly one value from it:');
  lines.push('');
  DISPOSITION_ORDER.forEach(function (value) {
    lines.push('- `' + value + '`');
  });
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
  lines.push('## 5. Token counts in the analysed tree');
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
  lines.push('## 6. Summary');
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
  return lines;
}

function renderInventory(model) {
  const lines = [];
  lines.push('');
  lines.push('## 7. The inventory');
  lines.push('');
  lines.push('Grouped by file, then by line. Re-running produces a reviewable diff, not a');
  lines.push('reshuffle.');
  model.files.forEach(function (file, fileIndex) {
    lines.push('');
    lines.push('### 7.' + (fileIndex + 1) + ' `' + file.relPath + '` - ' +
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
      lines.push('- [ ] `' + lineRef(edge) + '` - **' + edge.disposition + '** - ' +
        edge.funnel + ' - ' + edge.shape.replace(/`/g, '\''));
      const context = ['Carrier `' + edge.carrier + '` (' + edge.surface + ')'];
      context.push(edge.routes.length
        ? 'Routes ' + edge.routes.map(code).join(', ')
        : 'Routes none declared - drive through the carrier');
      context.push('Source ' + code(summarise(edge.snippet)));
      lines.push('      ' + context.join(' - '));
      lines.push('      Target: ' + targetText(edge));
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
  lines.push('## 8. Locator reconciliation');
  lines.push('');
  lines.push('Locations in this document are measured in the analysed tree. Where a locator');
  lines.push('cited in the plan differs, both are given, so following either finds the same');
  lines.push('edge.');
  lines.push('');
  lines.push('| Cited | Measured | Subject |');
  lines.push('|---|---|---|');
  model.reconciliation.forEach(function (row) {
    lines.push('| `' + row.cited + '` | `' + row.measured + '` | ' + row.subject + ' |');
  });
  lines.push('');
  lines.push('A cited locator that matches is listed too: a reader checking the plan against');
  lines.push('this document needs to see the agreement as much as the disagreement.');
  return lines;
}

function renderDrivability(model) {
  const withRoutes = model.allEdges.filter(function (edge) {
    return edge.routes.length > 0;
  }).length;
  const withCarrier = model.allEdges.filter(function (edge) {
    return edge.carrier && edge.carrier !== '(module scope)';
  }).length;
  const lines = [];
  lines.push('');
  lines.push('## ' + model.sections.drivability + '. Drivability');
  lines.push('');
  lines.push('`test/parity/capture.js`\'s failure-path scenarios are derived from these rows -');
  lines.push('by hand, in its `error-edge.*` groups, not by parsing this file - and');
  lines.push('`test/parity/replay.js` cites this checklist as what supplies the failure paths');
  lines.push('the success sweep cannot reach. A row nothing can drive is not a testable');
  lines.push('edge, so every row names either a bound route or the code path that reaches');
  lines.push('it.');
  lines.push('');
  lines.push('- Rows naming at least one route declaration: **' + withRoutes + '** of ' +
    model.totals.rows + '.');
  lines.push('- Rows naming a reachable code path (their carrier): **' + withCarrier + '** of ' +
    model.totals.rows + '.');
  lines.push('- Rows naming neither: **' + (model.totals.rows - Math.max(withRoutes, withCarrier)) +
    '**.');
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
  lines.push('A row whose carrier names no declaration is reached **through its carrier**, and');
  lines.push('there are two such cases: a module-local function called by a routed handler,');
  lines.push('marked `(module-local)` or `(internal)` in the carrier field, and an export');
  lines.push('with no route reference at all. Both are driven by driving the routed caller,');
  lines.push('or - for an unrouted export - by calling it directly.');
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

function renderDocument(model) {
  return renderProvenance(model)
    .concat(renderPreamble(model))
    .concat(renderFunnels(model))
    .concat(renderSilentChanges())
    .concat(renderHowToRead(model))
    .concat(renderCounts(model))
    .concat(renderSummary(model))
    .concat(renderInventory(model))
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
    kind: 'edge',
    file: 'config/api_routes.js',
    match: function () {
      return true;
    }
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
  return relative && relative.indexOf('..') !== 0 && !path.isAbsolute(relative)
    ? relative
    : resolved;
}

/**
 * Analyse a tree and write the inventory. Returns a summary for callers that
 * want to assert on the run without parsing the document.
 *
 * @param {{appRoot: string, outPath: string, countsCheck: string}} options
 */
function generate(options) {
  const selfTests = runSelfTests();

  const appRoot = path.resolve(options.appRoot);
  let stat;
  try {
    stat = fs.statSync(appRoot);
  } catch (err) {
    throw new AnalysisError('--app path does not exist: ' + appRoot);
  }
  if (!stat.isDirectory()) {
    throw new AnalysisError('--app path is not a directory: ' + appRoot);
  }

  const missing = ANALYSIS_TARGETS.filter(function (relPath) {
    return !fs.existsSync(path.join(appRoot, relPath));
  });
  if (missing.length) {
    throw new AnalysisError(
      'the analysed tree is missing ' + missing.length + ' of the ' +
      ANALYSIS_TARGETS.length + ' analysis targets: ' + missing.join(', ') +
      '. An inventory generated over a partial target set would understate ' +
      'the edge count, so this is fatal. Check --app (' + appRoot + ').'
    );
  }

  const bindings = buildRouteBindings(appRoot);
  const funnels = locateFunnels(appRoot);

  const files = ANALYSIS_TARGETS.map(function (relPath) {
    const src = fs.readFileSync(path.join(appRoot, relPath), 'utf8');
    const analysed = analyseFile(relPath, src, bindings);
    resolveFunnels(analysed.edges);
    return {
      relPath: relPath,
      edges: analysed.edges,
      counts: analysed.counts,
      carriers: analysed.carriers.length
    };
  });

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

  const tree = treeProvenance(appRoot);
  const check = checkCounts(counts, options.countsCheck, tree);

  const allEdges = files.reduce(function (list, file) {
    return list.concat(file.edges);
  }, []);

  const undrivable = allEdges.filter(function (edge) {
    return !edge.carrier;
  });
  if (undrivable.length) {
    throw new AnalysisError(
      undrivable.length + ' row(s) name neither a route nor a reachable code ' +
      'path, so test/parity/capture.js could not drive them: ' +
      undrivable.slice(0, 5).map(lineRef).join(', ') +
      '. Carrier resolution failed for those offsets.'
    );
  }

  const model = {
    generatedAt: new Date().toISOString(),
    // The exact command, rebuilt from the RESOLVED options rather than from
    // argv, so it is truthful for a programmatic caller too and re-running it
    // reproduces this document byte for byte outside the provenance block.
    invocation: 'node ' + TOOL_RELATIVE_PATH + ' --app ' + appRoot +
      ' --out ' + relativeToToolRepository(options.outPath) +
      ' --counts-check ' + options.countsCheck,
    tree: tree,
    tool: toolProvenance(toolRepositoryRoot(), TOOL_RELATIVE_PATH),
    funnels: funnels,
    counts: counts,
    check: check,
    files: files,
    allEdges: allEdges,
    bindings: bindings,
    selfTests: selfTests,
    sections: { drivability: 9 },
    reconciliation: locatorReconciliation(files, funnels),
    totals: { rows: allEdges.length, files: files.length }
  };

  const document = renderDocument(model);

  const outPath = path.resolve(options.outPath);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, document, 'utf8');

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
  '  -h, --help                print this and exit 0',
  '',
  'Writes exactly one file and nothing to stdout. Exits 0 on success, 1 with the',
  'reason on stderr on any failure.'
].join('\n');

const COUNTS_CHECK_MODES = ['auto', 'strict', 'off'];

/**
 * Parse argv. Supports `--flag value` and `--flag=value`. Any unrecognised
 * argument is an error rather than a silent no-op, so a typo cannot produce a
 * document written somewhere unintended.
 */
function parseArgs(argv) {
  const options = {
    appRoot: toolRepositoryRoot(),
    outPath: path.join(toolRepositoryRoot(), 'docs', 'error-edge-inventory.md'),
    countsCheck: 'auto',
    help: false
  };

  const takesValue = { '--app': 'appRoot', '--out': 'outPath', '--counts-check': 'countsCheck' };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
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
      if (value === undefined || value.indexOf('--') === 0) {
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
  analyseFile: analyseFile,
  buildRouteBindings: buildRouteBindings,
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
