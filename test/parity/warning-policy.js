/**
 * test/parity/warning-policy.js - the zero-warning gate, in one place.
 *
 * ===========================================================================
 * WHY THIS FILE EXISTS
 * ===========================================================================
 * AAP 0.8 states the bar in the user's own emphasis: "Boot with zero
 * deprecation warnings across the ENTIRE running application, not just the
 * hapi-facing surface." AAP 0.9.3 turns that into a pass condition - "no
 * warning or deprecation notice attributable to the application's own source or
 * to any dependency this plan retains" - and names the exercise it is measured
 * over: `node --pending-deprecation --trace-deprecation` across the listening
 * server, a full replay pass over all 233 routes, and the standalone worker.
 *
 * That is ONE condition. It was implemented four times, once per tool, and the
 * four disagreed:
 *
 *   test/parity/replay.js     no allowances, but a detector whose `Warning:\b`
 *                             alternative can never match and which knew
 *                             nothing of Mongoose or AWS notices - and gate
 *                             qualification that never asked whether the
 *                             deprecation flags had been passed at all.
 *   test/parity/worker.js     one named allowance for the compress-commons
 *                             DEP0005, printed as a "deviation" that no AAP
 *                             section authorizes.
 *   test/parity/storage.js    warnings recorded into `findings`, which only
 *                             printed - the exit code never saw them.
 *   test/parity/joi-matrix.js warnings discarded, on the reasoning that the
 *                             gate belonged to somebody else.
 *
 * Four policies are no policy: whichever tool a reader happened to open told
 * them a different thing was required. So the policy lives here, as data and as
 * one predicate, and the four tools state it by reference. A change to the bar
 * is now a change to this file, visible in one diff.
 *
 * ===========================================================================
 * THE POLICY, IN FULL
 * ===========================================================================
 * 1. THERE ARE NO ALLOWANCES. `ALLOWANCES` is empty and is not a list waiting
 *    to be populated. AAP 0.7 and 0.5.1.4 authorize exactly two deviations
 *    from this migration's requirements - the never-settling file response at
 *    lib/controllers/files.js:98-100 becoming a real stream response, and the
 *    `marked` fork's residual high audit finding - and NEITHER is a warning.
 *    AAP 0.9.5 is explicit that "no exception is granted to the plan by the
 *    plan". A retained dependency's deprecation is therefore a gate FAILURE,
 *    not a footnote: 0.9.3's pass condition names retained dependencies as
 *    covered, and archiver 2.1.1 - which 0.5.1.1 retains and 0.2.2 leaves out
 *    of scope - is exactly that case. The gate fails while its DEP0005 stands,
 *    and clearing it is a dependency decision, not a gate decision.
 * 2. THE FLAGS ARE A PRECONDITION, NOT A PREFERENCE. DEP0005 is a PENDING
 *    deprecation: without `--pending-deprecation` it is silent, so a run that
 *    did not pass the flags cannot distinguish "nothing was emitted" from
 *    "nothing was asked for". Such a run produces no warning evidence and
 *    cannot stand as the gate. `auditFlags` measures this - reading
 *    `process.execArgv`, `NODE_OPTIONS` (whose entries do NOT appear in
 *    execArgv - measured) and `NODE_NO_WARNINGS` - and `elevate` removes the
 *    ergonomic excuse by re-executing an in-process tool with the flags once.
 * 3. SUPPRESSION IS A FAILURE, NOT A CONFIGURATION. `--no-deprecation`,
 *    `--no-warnings`, `--disable-warning=...` and `NODE_NO_WARNINGS` are
 *    reported as failures wherever they appear, because a silent stream under
 *    them is indistinguishable from a clean one.
 * 4. THE GATE IS THE TARGET TREE'S. A run against another worktree - a
 *    baseline install reached through `--app` - is a MEASUREMENT: its notices
 *    are recorded and printed, its exit code is not decided by them, and it is
 *    forced NON-QUALIFYING so it can never be presented as the gate. This is
 *    what reconciles zero allowances with the fact that a baseline tree
 *    legitimately emits the AWS SDK v2 end-of-support notice, which only the
 *    target's `config/aws.js:6` suppresses.
 * 5. EVIDENCE HAS A BREADTH, AND THE CALLER DECLARES IT. A clean stderr proves
 *    nothing about the routes nobody requested. Callers pass `requirements`,
 *    each a named prerequisite with its own met/unmet state, and an unmet one
 *    fails the check on the tree it gates. AAP 0.9.3's breadth - all 233
 *    routes, more than one identity, methods beyond GET, and the worker - is
 *    expressed that way by test/parity/replay.js.
 *
 * ===========================================================================
 * WHAT COUNTS AS A NOTICE
 * ===========================================================================
 * `NOTICE_PATTERNS` is the whole answer, as data, each entry saying what it is
 * for. Three of them exist because of specific measurements on this codebase:
 *
 *   * `(node:PID)` is Node's own warning printer and catches every
 *     `process.emitWarning` - including the AWS SDK v2 banner, which is an
 *     emitWarning of type NOTE with UNINDENTED continuation lines (measured),
 *     so it folds into exactly one block.
 *   * `[MONGOOSE]` exists because Mongoose emits its deprecation notices
 *     through `console.warn`, NOT through `process.emitWarning` - so a
 *     `process.on('warning')` listener alone would miss them entirely. That is
 *     why detection is text-first here and the listener is the supplement.
 *   * `Warning:` is written as `(^|\s)Warning:(\s|$)`. The predicate this file
 *     replaces wrote `Warning:\b`, which cannot match anything: `:` and the
 *     space after it are both non-word characters, so the boundary never
 *     holds. It was dead, and a dead pattern in a gate reads as coverage.
 *
 * Generic deprecation wording is included deliberately, to catch a retained
 * dependency that prints its own notice through `console.warn` with none of
 * Node's markers. Measured on this repository: no runtime output in `lib/`,
 * `config/` or `app.js` contains the word, so the application's own log stream
 * cannot false-positive on it.
 *
 * ===========================================================================
 * PROHIBITIONS OBSERVED
 * ===========================================================================
 * This module requires nothing from the application, nothing from `test/lib`
 * and nothing from `test/helpers`. It uses `new URL` and never `url.parse`
 * (DEP0169) and `Buffer.from` and never `new Buffer` (DEP0005), because its own
 * stderr is inside the stream it judges. It suppresses nothing: the collector
 * TEES, so every notice stays as visible as it was.
 */

'use strict';

var childProcess = require('child_process');
var path         = require('path');

// This tool's own worktree root, two levels above test/parity/. Rule 4 of the
// policy is decided against it in ONE place - `gateAppliesTo` - so every gate
// treats a foreign `--app` tree the same way instead of each deciding for
// itself, which is how three of the four came to apply the target's gate to a
// baseline install.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Prefixed so this module's own lines can be excluded from detection by the
// same mechanism that excludes each tool's `note()` output. Without that, a
// summary of the notices found would itself read as a notice.
var LOG_PREFIX = '[parity:warning-gate] ';

// Set on the child `elevate` spawns, so a second failure to obtain the flags
// fails closed instead of re-executing forever.
var ELEVATION_MARKER = 'PARITY_WARNING_GATE_ELEVATED';

// One name, so the check reads identically in every tool's report and a
// reviewer grepping for it finds all four.
var CHECK_NAME = 'zero warnings (AAP 0.9.3, no allowances)';

// The flags AAP 0.9.3 names. Order is the order the AAP writes them in.
var REQUIRED_FLAGS = Object.freeze([
  '--pending-deprecation',
  '--trace-deprecation'
]);

// Anything here makes a quiet stream meaningless, whether it silences the
// warning or merely moves it somewhere nobody is reading. Matched as prefixes
// because each can take a value (`--disable-warning=DEP0005`,
// `--redirect-warnings=file`).
//
// `--redirect-warnings` belongs here for a measured reason rather than a
// theoretical one: under `--pending-deprecation --trace-deprecation
// --redirect-warnings=<file>` a `new Buffer()` deprecation was written to the
// file and stderr stayed EMPTY. Every one of these gates judges a stream, so a
// run that diverted its warnings elsewhere passes every check while producing
// no evidence at all - which is the failure mode this whole policy exists to
// prevent, arriving through a flag instead of an allowance.
var SUPPRESSING_FLAGS = Object.freeze([
  '--no-deprecation',
  '--no-warnings',
  '--disable-warning',
  '--redirect-warnings'
]);

// The environment's own suppressors, checked because a flag audit that read
// only argv would miss them. `NODE_REDIRECT_WARNINGS` is the environment form
// of the flag above and was reproduced doing the same thing.
var SUPPRESSING_ENV = Object.freeze([
  'NODE_NO_WARNINGS',
  'NODE_REDIRECT_WARNINGS'
]);

// EMPTY, AND NOT A PLACEHOLDER. See paragraph 1 of the policy above: the AAP
// authorizes two deviations and neither is a warning, so there is nothing this
// list could legitimately hold. It is exported as data so a reader can see that
// it is empty rather than having to trust prose, and so a future entry would
// have to arrive as a visible diff carrying the AAP section that grants it.
var ALLOWANCES = Object.freeze([]);

// The policy as a document, embedded in every artifact that reports the gate so
// the artifact says which bar it was judged against.
var POLICY = Object.freeze({
  id        : 'aap-0.9.3-zero-warnings',
  statement : 'No warning or deprecation notice attributable to the ' +
              'application\'s own source or to any dependency this plan ' +
              'retains, measured under ' + REQUIRED_FLAGS.join(' ') + ' over ' +
              'the listening server, the full route surface and the worker.',
  allowances: ALLOWANCES,
  authority : Object.freeze([
    'AAP 0.8 - zero deprecation warnings across the ENTIRE running application',
    'AAP 0.9.3 - the pass condition and the exercise it is measured over',
    'AAP 0.7 and 0.5.1.4 - the only two authorized deviations, neither a warning',
    'AAP 0.9.5 - no exception is granted to the plan by the plan'
  ]),
  retained  : 'A notice from a retained dependency FAILS this gate. archiver ' +
              '2.1.1 -> compress-commons DEP0005 was the instance that ' +
              'proved it: the gate failed while the notice stood, and ' +
              'clearing it was a dependency decision rather than a gate ' +
              'decision - archiver moved to 6.0.2 and the notice is gone at ' +
              'its source.'
});

// What a notice is. Every entry carries its own reason, because a pattern
// without one is a pattern nobody dares change.
var NOTICE_PATTERNS = Object.freeze([
  Object.freeze({
    id     : 'node-warning-printer',
    pattern: /\(node:\d+\)/,
    what   : 'Node\'s own warning printer prefixes every process warning ' +
             'with (node:PID), which covers every emitWarning - including ' +
             'the AWS SDK v2 end-of-support NOTE.'
  }),
  Object.freeze({
    id     : 'deprecation-code',
    pattern: /\[?\bDEP\d{4}\b\]?/,
    what   : 'A Node deprecation code, bracketed or bare.'
  }),
  Object.freeze({
    id     : 'warning-class',
    pattern: new RegExp('\\b(?:DeprecationWarning|ExperimentalWarning' +
                        '|UnsupportedWarning|MaxListenersExceededWarning)\\b'),
    what   : 'The warning classes Node and its ecosystem raise by name.'
  }),
  Object.freeze({
    id     : 'bare-warning-label',
    pattern: /(?:^|\s)Warning:(?:\s|$)/,
    what   : 'A library printing `Warning: ...` itself. Written with an ' +
             'explicit space or end-of-line rather than \\b, which cannot ' +
             'match after a colon and made the previous predicate dead.'
  }),
  Object.freeze({
    id     : 'emit-warning-note',
    pattern: /(?:^|\s)NOTE:(?:\s|$)/,
    what   : 'process.emitWarning(text, {type: \'NOTE\'}), the form the AWS ' +
             'SDK v2 maintenance banner uses.'
  }),
  Object.freeze({
    id     : 'mongoose-notice',
    pattern: /^\s*\[MONGOOSE\]/,
    what   : 'Mongoose prints its deprecation notices through console.warn, ' +
             'so no process warning listener would ever see them.'
  }),
  Object.freeze({
    id     : 'aws-maintenance',
    pattern: /\b(?:maintenance mode|end-of-support|end of support)\b/i,
    what   : 'The AWS SDK v2 banner in either of its published wordings, in ' +
             'case it is ever printed outside emitWarning.'
  }),
  Object.freeze({
    id     : 'generic-deprecation',
    pattern: /\bdeprecat(?:ed|es|ing|ion)\b/i,
    what   : 'A retained dependency printing its own notice with none of ' +
             'Node\'s markers. Safe here: measured, no runtime output in ' +
             'lib/, config/ or app.js contains the word.'
  })
]);

// A gate report that listed a thousand identical notices would be unreadable,
// so the listing is bounded while the COUNT stays complete.
var MAX_LISTED_NOTICES = 20;

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Writes one prefixed line to stderr.
 *
 * Prefixed with LOG_PREFIX so `noticesFromText` excludes it: this module
 * reports on notices, and its report must not become one.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  harnessOutput(function() {
    process.stderr.write(LOG_PREFIX + message + '\n');
  });
}

// How many `harnessOutput` scopes are open. A counter rather than a boolean so
// that a nested call - a note inside a note's own formatting - cannot end the
// outer scope early.
var harnessDepth = 0;

/**
 * Marks everything `body` writes as the harness's own prose, not a notice.
 *
 * A prefix is the better mechanism and two of the four gates have one; the
 * third writes unprefixed progress lines, and teeing its stream without a way
 * to tell prose from notices would either miss its dependencies' `console.warn`
 * output (with `tee: false`) or judge its own sentences (with `tee: true`).
 * This closes that gap without changing what any tool prints: the writer is
 * unchanged, and only the collector's view of the line changes.
 *
 * Synchronous by contract. An `async` body would leave the scope open across an
 * await and swallow a notice raised in between, so a function is taken and
 * called, and the scope closes in a `finally`.
 *
 * @param {function(): *} body
 * @returns {*} whatever `body` returned
 */
function harnessOutput(body) {
  harnessDepth++;

  try {
    return body();
  }
  finally {
    harnessDepth--;
  }
}

/**
 * Whether a write is happening inside a `harnessOutput` scope.
 *
 * @returns {boolean}
 */
function writingHarnessOutput() {
  return harnessDepth > 0;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * The first line of a multi-line value, trimmed of its trailing whitespace.
 *
 * @param {*} value
 * @returns {string}
 */
function firstLine(value) {
  return String(value === undefined || value === null ? '' : value)
    .split('\n')[0]
    .replace(/\s+$/, '');
}

/**
 * Whether a line is a stack frame rather than a notice of its own.
 *
 * Tested BEFORE the patterns, because `--trace-deprecation` puts a stack under
 * every notice and a frame naming a path that happens to contain a matched word
 * would otherwise open a second block for the same notice.
 *
 * @param {string} line
 * @returns {boolean}
 */
function isStackFrame(line) {
  return /^\s+at\s/.test(line);
}

/**
 * Whether a line begins a notice.
 *
 * This module's own prefix is ALWAYS ignored, whatever the caller passes: this
 * file reports on notices, and a summary of what it found must never be read
 * back as one.
 *
 * @param {string} line
 * @param {Array.<string>} [ignorePrefixes] Prefixes whose lines are the
 *   harness's own commentary and are never notices.
 * @returns {boolean}
 */
function isNotice(line, ignorePrefixes) {
  var text = String(line === undefined || line === null ? '' : line);
  var prefixes = (ignorePrefixes || []).concat([LOG_PREFIX]);
  var ignored = false;
  var index;

  if (!text.trim().length || isStackFrame(text)) {
    return false;
  }

  for (index = 0; index < prefixes.length; index++) {
    if (text.indexOf(prefixes[index]) === 0) {
      ignored = true;
      break;
    }
  }

  if (ignored) {
    return false;
  }

  return NOTICE_PATTERNS.some(function(entry) {
    return entry.pattern.test(text);
  });
}

/**
 * Every pattern a line matches, so a report can say WHY a line was counted.
 *
 * @param {string} line
 * @returns {Array.<string>} the pattern ids
 */
function matchedPatterns(line) {
  return NOTICE_PATTERNS.filter(function(entry) {
    return entry.pattern.test(String(line));
  }).map(function(entry) {
    return entry.id;
  });
}

/**
 * The identity of a notice, for de-duplication.
 *
 * The pid is normalized out because the same notice printed by Node's handler
 * and reported by a `process.on('warning')` listener differs only there, and
 * counting one notice twice would overstate the finding as surely as missing it
 * would understate it.
 *
 * @param {Object} notice
 * @returns {string}
 */
function noticeKey(notice) {
  return firstLine(notice && notice.summary)
    .replace(/\(node:\d+\)/g, '(node:PID)')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Splits captured text into notice blocks.
 *
 * A block is a notice line plus the indented continuation lines
 * `--trace-deprecation` puts under it, which is what makes one deprecation one
 * finding rather than eleven. A line matching an ignored prefix closes the open
 * block, because a harness log line between a notice and its stack means the
 * stack has ended.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {Array.<string>} [options.ignorePrefixes]
 * @param {string} [options.source] Recorded on each notice.
 * @returns {Array.<Object>} `{source, summary, text, lines, patterns, code}`
 */
function noticesFromText(text, options) {
  var settings = options || {};
  var prefixes = (settings.ignorePrefixes || []).concat([LOG_PREFIX]);
  var source = settings.source || 'stderr';
  var lines = String(text === undefined || text === null ? '' : text)
    .split('\n');
  var notices = [];
  var current = null;
  var index;
  var line;
  var ignored;

  for (index = 0; index < lines.length; index++) {
    line = lines[index];
    ignored = prefixes.some(function(prefix) {
      return line.indexOf(prefix) === 0;
    });

    if (ignored) {
      current = null;
      continue;
    }

    if (isNotice(line, prefixes)) {
      current = {
        source  : source,
        summary : line.trim(),
        text    : line,
        lines   : [line],
        patterns: matchedPatterns(line),
        code    : deprecationCode(line)
      };
      notices.push(current);
      continue;
    }

    if (current && /^\s+\S/.test(line)) {
      current.lines.push(line);
      current.text += '\n' + line;
      continue;
    }

    current = null;
  }

  return notices;
}

/**
 * The Node deprecation code a line carries, when it carries one.
 *
 * @param {string} line
 * @returns {(string|null)}
 */
function deprecationCode(line) {
  var match = /\bDEP\d{4}\b/.exec(String(line));

  return match ? match[0] : null;
}

/**
 * Converts a process warning - or a reduced record of one - into a notice.
 *
 * Duck-typed on purpose: `process.on('warning')` hands over an Error, while
 * test/parity/storage.js already reduces its captures to `{name, code, message,
 * origin}` for its own attribution. Both reach the same judgement through this
 * one adapter rather than through a second copy of the rules.
 *
 * The summary is built in Node's OWN printed format - `(node:PID) [CODE] Name:
 * message` - so that when the same warning is also seen on the teed stream the
 * two records collapse to one key.
 *
 * @param {(Error|Object)} warning
 * @returns {Object} the notice
 */
function noticeFromWarning(warning) {
  var name = (warning && warning.name) || 'Warning';
  var code = (warning && warning.code) || null;
  var message = (warning && warning.message) || '';
  var stack = (warning && warning.stack) || '';
  var origin = Array.isArray(warning && warning.origin)
    ? warning.origin.slice(0, 3)
    : framesOf(stack);
  var summary = '(node:' + process.pid + ') ' +
    (code ? '[' + code + '] ' : '') + name + ': ' + firstLine(message);

  return {
    source  : 'process',
    summary : summary,
    text    : summary + (origin.length ? '\n    ' + origin.join('\n    ') : ''),
    lines   : [summary],
    patterns: matchedPatterns(summary),
    code    : code || deprecationCode(summary),
    name    : name,
    message : String(message),
    origin  : origin
  };
}

/**
 * The first three caller frames of a stack, with Node's own frames dropped.
 *
 * Not for brevity: a flagged deprecation is RAISED inside Node - DEP0005's top
 * two frames are `showFlaggedDeprecation` and `new Buffer`, both `node:buffer` -
 * so keeping them would attribute every such warning to Node and hide the
 * module that actually called the deprecated API.
 *
 * @param {string} stack
 * @returns {Array.<string>}
 */
function framesOf(stack) {
  return String(stack || '')
    .split('\n')
    .filter(function(line) {
      return /^\s+at\s/.test(line);
    })
    .map(function(line) {
      return line.trim();
    })
    .filter(function(line) {
      return !/^at node:/.test(line) && !/\(node:/.test(line);
    })
    .slice(0, 3);
}

// ---------------------------------------------------------------------------
// Collection, for the tools that run the code they judge in their own process
// ---------------------------------------------------------------------------

/**
 * Collects notices raised in THIS process while a body runs.
 *
 * Two collectors, because one alone has a measured blind spot:
 *
 *   * a `process.on('warning')` listener sees every `process.emitWarning` -
 *     Node's deprecations, and the AWS SDK v2 banner - but NOT Mongoose, which
 *     prints through `console.warn`;
 *   * a stderr tee sees everything that is printed, including Mongoose, but
 *     also sees the harness's own progress output, so it is only safe where
 *     that output carries a prefix to exclude.
 *
 * So `tee` is opt-in per caller. Both feed one de-duplicated list through
 * `noticeKey`, which is why a warning seen twice - once by the listener and
 * once as Node's printed line - counts once.
 *
 * NOTHING IS SUPPRESSED. The tee writes through to the real stream and the
 * listener is added rather than substituted, so Node's own handler still
 * prints. A notice stays exactly as visible as it was.
 *
 * @param {Object} [options]
 * @param {boolean} [options.tee=false] Whether to tee stderr as well.
 * @param {Array.<string>} [options.ignorePrefixes] Harness prefixes.
 * @returns {Object} `{notices, close, add, ingest}`
 */
function createCollector(options) {
  var settings = options || {};
  var prefixes = (settings.ignorePrefixes || []).slice();
  var collected = [];
  var seen = Object.create(null);
  var teed = [];
  var originalWrite = null;
  var closed = false;
  var listener = function(warning) {
    add(noticeFromWarning(warning));
  };

  /**
   * Records one notice unless an equal one is already held.
   *
   * @param {Object} notice
   * @returns {boolean} whether it was new
   */
  function add(notice) {
    var key = noticeKey(notice);

    if (!key.length || seen[key]) {
      return false;
    }

    seen[key] = true;
    collected.push(notice);

    return true;
  }

  /**
   * Records every notice in a block of text - a child's captured stderr, for
   * instance - through the same de-duplication.
   *
   * @param {string} text
   * @param {string} [source]
   * @returns {number} how many were new
   */
  function ingest(text, source) {
    return noticesFromText(text, {
      ignorePrefixes: prefixes,
      source: source || 'stderr'
    }).filter(add).length;
  }

  if (settings.tee) {
    originalWrite = process.stderr.write;

    process.stderr.write = function(chunk) {
      // A write inside a `harnessOutput` scope is the tool's own prose and is
      // not teed at all. That is what lets a tool whose progress lines carry no
      // prefix still tee its stream: the alternative was to miss its
      // dependencies' console.warn output or to judge its own sentences.
      if (!writingHarnessOutput()) {
        if (typeof chunk === 'string') {
          teed.push(chunk);
        }
        else if (Buffer.isBuffer(chunk)) {
          teed.push(chunk.toString('utf8'));
        }
      }

      return originalWrite.apply(process.stderr, arguments);
    };
  }

  process.on('warning', listener);

  return {
    add: add,
    ingest: ingest,

    /**
     * Stops collecting and returns everything held.
     *
     * Idempotent, and it restores the real writer before it parses the teed
     * text, so a caller left holding this module cannot inherit a patched
     * stream. The teed text is parsed here rather than incrementally because a
     * notice block spans lines and a chunk boundary can fall inside one.
     *
     * @returns {Array.<Object>}
     */
    close: function() {
      if (closed) {
        return collected.slice();
      }

      closed = true;
      process.removeListener('warning', listener);

      if (originalWrite) {
        process.stderr.write = originalWrite;
        originalWrite = null;
        ingest(teed.join(''), 'stderr');
      }

      return collected.slice();
    },

    /**
     * What is held so far, without closing.
     *
     * @returns {Array.<Object>}
     */
    notices: function() {
      return collected.slice();
    }
  };
}

// ---------------------------------------------------------------------------
// The flag precondition
// ---------------------------------------------------------------------------

/**
 * Splits a flag string the way a shell would, for NODE_OPTIONS.
 *
 * @param {string} value
 * @returns {Array.<string>}
 */
function splitFlags(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(function(entry) {
      return entry.length > 0;
    });
}

/**
 * Whether a flag list carries a suppressor.
 *
 * @param {Array.<string>} flags
 * @returns {Array.<string>} the suppressors present
 */
function suppressorsIn(flags) {
  return (flags || []).filter(function(flag) {
    return SUPPRESSING_FLAGS.some(function(candidate) {
      return flag === candidate || flag.indexOf(candidate + '=') === 0;
    });
  });
}

/**
 * Audits a flag list against the policy.
 *
 * `NODE_OPTIONS` is folded in because its entries do NOT appear in
 * `process.execArgv` - measured on Node 22.23.2 - so an audit that read only
 * execArgv would report a properly-flagged run as unflagged. `NODE_NO_WARNINGS`
 * is folded in as a suppressor for the same reason: it is not a flag anywhere
 * argv can see.
 *
 * @param {Array.<string>} flags The flags the measured process was given.
 * @param {Object} [env=process.env]
 * @returns {Object} `{required, effective, fromEnv, missing, suppressors,
 *   complete}`
 */
function auditFlags(flags, env) {
  var environment = env || process.env;
  var fromEnv = splitFlags(environment.NODE_OPTIONS);
  var effective = (flags || []).concat(fromEnv);
  var missing = REQUIRED_FLAGS.filter(function(flag) {
    return effective.indexOf(flag) === -1;
  });
  var suppressors = suppressorsIn(effective).concat(
    SUPPRESSING_ENV.filter(function(name) {
      return environment[name] !== undefined && environment[name] !== '';
    }).map(function(name) {
      return name + '=' + environment[name];
    }));

  return {
    required   : REQUIRED_FLAGS.slice(),
    effective  : effective.slice(),
    fromEnv    : fromEnv,
    missing    : missing,
    suppressors: suppressors,
    complete   : !missing.length && !suppressors.length
  };
}

/**
 * The audit of the flags THIS process was started with.
 *
 * @param {Object} [env=process.env]
 * @returns {Object} as `auditFlags`
 */
function processFlagAudit(env) {
  return auditFlags(process.execArgv.slice(), env);
}

/**
 * The flag list to launch a child with: the caller's, plus whatever the policy
 * requires and the caller did not pass.
 *
 * The union rather than a rejection, because the flags are how the evidence is
 * produced - a caller who forgot them wanted the gate, not a lecture - while
 * `auditFlags` still reports a suppressor the caller added deliberately, and
 * that still fails.
 *
 * @param {Array.<string>} [flags]
 * @returns {Array.<string>}
 */
function childFlags(flags) {
  var supplied = (flags || []).slice();

  return supplied.concat(REQUIRED_FLAGS.filter(function(flag) {
    return supplied.indexOf(flag) === -1;
  }));
}

// ---------------------------------------------------------------------------
// The judgement
// ---------------------------------------------------------------------------

/**
 * Judges one measured stream against the policy.
 *
 * Returns a check document in the shape test/parity/replay.js's report already
 * renders - `{name, asserted, ok, skipped, reason, entries, failures}` - with
 * the policy, the flag audit, the notices and the caller's own evidence
 * requirements alongside, so an artifact carrying it says what bar was applied
 * and on what evidence.
 *
 * `ok` and `qualifying` are deliberately separate. `ok` answers "did this
 * stream satisfy the gate"; `qualifying` answers "can this run stand AS the
 * gate". A run with no flags is not ok, because its silence is not evidence. A
 * run against another worktree IS ok - its notices are a measurement of that
 * tree, not a verdict on this one - but it never qualifies.
 *
 * @param {Object} input
 * @param {Array.<Object>} input.notices
 * @param {Object} input.flags An `auditFlags` result.
 * @param {string} input.subject What was measured, for the report.
 * @param {boolean} [input.gateApplies=true] False for a foreign worktree.
 * @param {string} [input.treeNote] Why the gate does not apply.
 * @param {boolean} [input.launched=true] False when there was no stream.
 * @param {string} [input.unlaunchedReason]
 * @param {Array.<Object>} [input.requirements] `{id, met, detail}` - the
 *   caller's own evidence prerequisites, each failing the check when unmet.
 * @returns {Object} the check document
 */
function judge(input) {
  var settings = input || {};
  var notices = settings.notices || [];
  var flags = settings.flags || auditFlags([]);
  var requirements = settings.requirements || [];
  var gateApplies = settings.gateApplies !== false;
  var launched = settings.launched !== false;
  var failures = [];
  var unmet;

  if (!launched) {
    return {
      name        : CHECK_NAME,
      policy      : POLICY,
      subject     : settings.subject || 'the run',
      gateApplies : gateApplies,
      asserted    : 0,
      ok          : true,
      qualifying  : false,
      skipped     : true,
      reason      : settings.unlaunchedReason ||
        'nothing was launched by this run, so there is no stream of its own ' +
        'to judge; a run that measured nothing cannot stand as the gate',
      flags       : flags,
      notices     : [],
      entries     : [],
      requirements: requirements,
      failures    : []
    };
  }

  if (flags.missing.length) {
    failures.push('the required flag(s) ' + flags.missing.join(' ') +
      ' were not in force, so this stream carries no warning evidence: ' +
      'DEP0005 is a PENDING deprecation and is silent without ' +
      '--pending-deprecation, which makes a quiet stream and a clean one ' +
      'indistinguishable. AAP 0.9.3 measures this gate under ' +
      REQUIRED_FLAGS.join(' ') + '.');
  }

  if (flags.suppressors.length) {
    failures.push('warning output was suppressed by ' +
      flags.suppressors.join(' ') + ', so this stream cannot be evidence of ' +
      'anything. Remove the suppressor and re-run.');
  }

  notices.slice(0, MAX_LISTED_NOTICES).forEach(function(notice) {
    failures.push('notice on ' + (settings.subject || 'the run') + ': ' +
      firstLine(notice.summary) +
      (notice.origin && notice.origin.length
        ? '  [raised at ' + notice.origin[0] + ']'
        : ''));
  });

  if (notices.length > MAX_LISTED_NOTICES) {
    failures.push((notices.length - MAX_LISTED_NOTICES) + ' further notice(s) ' +
      'are counted but not listed here; the artifact carries all ' +
      notices.length + '.');
  }

  if (notices.length) {
    failures.push('the policy has no allowances: AAP 0.7 and 0.5.1.4 ' +
      'authorize exactly two deviations from this migration and neither is a ' +
      'warning, and 0.9.3 covers retained dependencies explicitly. ' +
      POLICY.retained);
  }

  unmet = requirements.filter(function(entry) {
    return !entry.met;
  });

  unmet.forEach(function(entry) {
    failures.push('the warning evidence is incomplete - ' + entry.id + ': ' +
      entry.detail);
  });

  return {
    name        : CHECK_NAME,
    policy      : POLICY,
    subject     : settings.subject || 'the run',
    gateApplies : gateApplies,
    asserted    : 1 + requirements.length,
    ok          : gateApplies ? !failures.length : true,
    qualifying  : gateApplies && flags.complete && !unmet.length,
    skipped     : false,
    reason      : gateApplies
      ? null
      : (settings.treeNote || 'the tree under test is not this worktree, so ' +
         'this run is a MEASUREMENT of that tree and never the gate') +
        '. ' + notices.length + ' notice(s) were recorded rather than failed.',
    flags       : flags,
    notices     : notices.map(function(notice) {
      return {
        source  : notice.source || null,
        summary : firstLine(notice.summary),
        code    : notice.code || null,
        patterns: notice.patterns || [],
        origin  : notice.origin || []
      };
    }),
    entries     : notices.map(function(notice) {
      return firstLine(notice.summary);
    }),
    requirements: requirements.map(function(entry) {
      return { id: entry.id, met: !!entry.met, detail: entry.detail };
    }),
    failures    : gateApplies ? failures : []
  };
}

/**
 * Rule 4, decided once: whether the gate applies to the tree under test.
 *
 * The gate is the TARGET tree's. A run against another worktree - a baseline
 * install reached through `--app` - is a measurement of that tree: its notices
 * are recorded and printed, they do not decide its exit code, and it is forced
 * non-qualifying so it can never be presented as the gate. That is what lets
 * this policy have no allowances while a baseline install legitimately emits
 * the AWS SDK v2 end-of-support notice that only the target's `config/aws.js`
 * suppresses.
 *
 * Every gate calls this rather than computing it, because three of the four
 * previously did not compute it at all and would have failed a baseline
 * measurement on a notice the baseline is expected to emit.
 *
 * @param {(string|null)} appRoot The tree under test, or null for this one.
 * @returns {Object} `{applies, appRoot, toolRoot, treeNote}`
 */
function gateAppliesTo(appRoot) {
  var resolved = appRoot ? path.resolve(appRoot) : null;
  var applies = !resolved || resolved === TOOL_ROOT;

  return {
    applies : applies,
    appRoot : resolved,
    toolRoot: TOOL_ROOT,
    treeNote: applies
      ? null
      : 'the tree under test is ' + resolved + ', which is not this worktree ' +
        '(' + TOOL_ROOT + '), so this run MEASURES that tree rather than ' +
        'gating it'
  };
}

/**
 * Waits for warnings already scheduled to be delivered.
 *
 * Node delivers a `process.emitWarning` on a later turn, and a dependency can
 * schedule one on a timer: the retained AWS SDK v2 emits its end-of-support
 * NOTE from a zero-delay timer, and a collector closed synchronously right
 * after the work finished reported a clean run and then let that NOTE print.
 * Two macrotask turns are awaited - one for a `setTimeout(fn, 0)` already
 * queued, one for a warning that turn emits - which is bounded, deterministic
 * and cheap.
 *
 * Every in-process gate awaits this before it reads its stream or closes its
 * collector. A gate that cannot await - there is none today - would be
 * reporting on a stream that is still being written.
 *
 * @returns {Promise<undefined>}
 */
async function drainPendingWarnings() {
  await new Promise(function(resolve) {
    setTimeout(resolve, 0);
  });

  await new Promise(function(resolve) {
    setImmediate(resolve);
  });

  return undefined;
}

/**
 * One named evidence requirement, for callers to pass to `judge`.
 *
 * @param {string} id
 * @param {boolean} met
 * @param {string} detail Read when it is UNMET, so write it as the shortfall.
 * @returns {Object}
 */
function requirement(id, met, detail) {
  return { id: id, met: !!met, detail: detail };
}

// ---------------------------------------------------------------------------
// Elevation, for the tools that measure their own process
// ---------------------------------------------------------------------------

/**
 * Re-executes this process once with the required flags, if it lacks them.
 *
 * The three in-process gates - worker.js, storage.js and joi-matrix.js - are
 * themselves the process whose stderr AAP 0.9.3 inspects, so a caller who
 * omitted the flags would get a run that cannot produce evidence. Rejecting it
 * would be honest and useless; re-executing it once is honest and useful, and
 * it removes the only reason anyone had to run these tools without the flags.
 *
 * Guarded by an environment marker, so a re-execution that STILL lacks the
 * flags - `NODE_OPTIONS=--no-warnings`, say - does not loop: it returns the
 * audit and `judge` fails the run on it. Fail-closed, not fail-quiet.
 *
 * Call it from a `require.main === module` guard only, and call it before the
 * heavy requires: the parent's only job is to spawn and forward.
 *
 * @param {Object} [options]
 * @param {Array.<string>} [options.argv=process.argv] For testing.
 * @param {Array.<string>} [options.execArgv=process.execArgv] For testing.
 * @param {Object} [options.env=process.env] For testing.
 * @param {boolean} [options.exit=true] When false the decision is returned
 *   instead of acted on, which is how this is tested without spawning.
 * @returns {(Object|null)} null when nothing was needed; otherwise the
 *   decision `{elevated, audit, argv, code}`.
 */
function elevate(options) {
  var settings = options || {};
  var env = settings.env || process.env;
  var argv = settings.argv || process.argv;
  var execArgv = settings.execArgv || process.execArgv;
  var audit = auditFlags(execArgv.slice(), env);
  var childArgv;
  var childEnv;
  var result;

  if (audit.complete) {
    return null;
  }

  if (env[ELEVATION_MARKER]) {
    note('the required flag(s) ' + audit.missing.concat(audit.suppressors)
      .join(' ') + ' are still not in force after re-execution, so this run ' +
      'cannot produce warning evidence. The gate will fail on it rather than ' +
      'report a silence it cannot vouch for.');

    return { elevated: false, audit: audit, argv: null, code: null };
  }

  childArgv = audit.missing
    .concat(execArgv)
    .concat(argv.slice(1));

  if (settings.exit === false) {
    return { elevated: true, audit: audit, argv: childArgv, code: null };
  }

  note('re-executing with ' + audit.missing.join(' ') + ': AAP 0.9.3 measures ' +
    'the zero-warning gate under ' + REQUIRED_FLAGS.join(' ') + ', and a ' +
    'pending deprecation is silent without them.');

  childEnv = {};

  Object.keys(env).forEach(function(key) {
    childEnv[key] = env[key];
  });

  childEnv[ELEVATION_MARKER] = '1';

  result = childProcess.spawnSync(process.execPath, childArgv, {
    stdio: 'inherit',
    env: childEnv
  });

  if (result.error) {
    note('the re-execution could not be started (' +
      (result.error.message || result.error) + '); continuing without the ' +
      'flags, and the gate will fail on the missing evidence.');

    return { elevated: false, audit: audit, argv: childArgv, code: null };
  }

  if (result.signal) {
    note('the re-executed run was killed by ' + result.signal + '.');
    process.exit(1);
  }

  process.exit(result.status === null ? 1 : result.status);

  // Unreachable in practice; kept so the contract is total for a caller that
  // stubs process.exit.
  return { elevated: true, audit: audit, argv: childArgv, code: result.status };
}

/**
 * The script `elevate` would re-execute, for a message or a test.
 *
 * @param {Array.<string>} [argv=process.argv]
 * @returns {string}
 */
function scriptOf(argv) {
  var list = argv || process.argv;

  return list.length > 1 ? path.resolve(list[1]) : '';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // The policy, as data. Read these rather than restating them.
  POLICY           : POLICY,
  TOOL_ROOT        : TOOL_ROOT,
  ALLOWANCES       : ALLOWANCES,
  REQUIRED_FLAGS   : REQUIRED_FLAGS,
  SUPPRESSING_FLAGS: SUPPRESSING_FLAGS,
  SUPPRESSING_ENV  : SUPPRESSING_ENV,
  NOTICE_PATTERNS  : NOTICE_PATTERNS,
  CHECK_NAME       : CHECK_NAME,
  LOG_PREFIX       : LOG_PREFIX,
  ELEVATION_MARKER : ELEVATION_MARKER,
  MAX_LISTED_NOTICES: MAX_LISTED_NOTICES,

  // Detection.
  isNotice        : isNotice,
  matchedPatterns : matchedPatterns,
  noticesFromText : noticesFromText,
  noticeFromWarning: noticeFromWarning,
  noticeKey       : noticeKey,
  deprecationCode : deprecationCode,
  framesOf        : framesOf,

  // Collection, for a tool that runs the code it judges.
  createCollector : createCollector,

  // The flag precondition.
  auditFlags      : auditFlags,
  processFlagAudit: processFlagAudit,
  childFlags      : childFlags,
  splitFlags      : splitFlags,
  suppressorsIn   : suppressorsIn,

  // The judgement.
  judge           : judge,
  requirement     : requirement,
  gateAppliesTo   : gateAppliesTo,
  drainPendingWarnings: drainPendingWarnings,

  // Telling the harness's own prose from a notice, for a tool with no prefix.
  harnessOutput       : harnessOutput,
  writingHarnessOutput: writingHarnessOutput,

  // Elevation.
  elevate         : elevate,
  scriptOf        : scriptOf,

  // Reporting.
  note            : note
};
