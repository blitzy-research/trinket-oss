// Captured mail for the parity harness.
//
// One of the three external-effect interceptors in test/parity/fixtures/. It is
// loaded as a preload - `node --require <abs path>/test/parity/fixtures/mail.js
// app.js` - by test/parity/server.js, before the application, and it is also
// required directly by test/parity/worker.js. It installs itself on first
// require. Node core only, CommonJS, no CLI arguments.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// Configuration alone is not sufficient isolation, and that is the whole
// reason this file exists. test/parity/server-overlay.json sets app.mail.from
// and app.mail.host, and lib/util/mailer.js decides whether mail is configured
// from exactly those two values, so `isConfigured()` is TRUE inside the parity
// run. Without a substitute, the eight `mailer.send` call sites would each
// reach nodemailer's `createTransport(...).sendMail(...)` and a real SMTP
// connection would be dialled from inside the harness.
//
// Substitution happens at the MODULE BOUNDARY, not over the network: the
// `send` property of the application's own mailer instance is replaced with a
// capturing function. There is no transport, no socket and no DNS, so the
// corpus is reproducible on any host, and every value this file produces is a
// fixed literal so test/parity/replay.js can compare exactly instead of
// normalizing (AAP 0.9.3).
//
// It is also the only way test/parity/worker.js can observe the export
// worker's notification mail on the success and the failure path, which AAP
// 0.9.3 makes part of the worker gate.
//
// ===========================================================================
// USER-SPECIFIED RULES
// ===========================================================================
// `review_rules` reports that NO user-specified rules were provided for this
// project - it returns exactly "No user rules provided." - which AAP 0.7 and
// 0.10.1 independently record. None are invented here, and their absence is
// not read as licence to lower the bar: enterprise-standard practice governs,
// and the binding constraints are the request's own RULES block as interpreted
// in AAP 0.7, cited by name below and never reproduced.
//
//   R-a  Single purpose. This file replaces `mailer.send`, captures the calls
//        and writes the evidence file. It renders no template, emulates no
//        SMTP conversation, provides no assertion helper beyond exposing the
//        captured calls, and re-implements nothing else from
//        lib/util/mailer.js.
//   R-b  Runs on Node 22, with no module excluded. "No module excluded" is
//        what puts lib/workers/exports.js in scope, and its two notification
//        mails are asserted by the worker gate, which has nothing to observe
//        without this file.
//   R-c  Node core only. `fs` and `path` are the only requires, plus one
//        DYNAMIC require of the application's own lib/util/mailer so that its
//        `send` can be swapped and its original retained. Deliberately NOT
//        required, even though test/helpers/mail.js uses both: `sinon` and
//        `q`. This module is also preloaded inside the BASELINE worktree's
//        process, where sinon is 1.7.3 and the target's devDependency graph
//        does not exist, so the swap is plain property replacement against a
//        saved original.
//   R-d  Behaviour "improvements" are prohibited; a quirk is preserved and
//        documented, not fixed. Two rulings are implemented literally:
//          (1) Only what the application ACTUALLY reached is captured. No send
//              is ever synthesized. In particular
//              lib/workers/exports.js:127-129 configures nunjucks only when
//              NOT config.isTest, so under NODE_ENV=test sendCompletionEmail
//              throws inside nunjucks.render (:419) BEFORE mailer.send (:421)
//              is reached. That throw is baseline behaviour on that path; a
//              missing 'export-ready' capture is therefore a true observation
//              and is neither pre-empted nor papered over here.
//          (2) `isConfigured` is left UNPATCHED. Its result is what seven
//              gates branch on, and configuration - not this fixture - is what
//              makes those branches reachable.
//   R-e  Error-to-response mappings survive unchanged, so the stub NEVER
//        rejects and never throws. Two measured consequences make this
//        load-bearing rather than defensive:
//          lib/controllers/trinket.js:853 does `return mailer.send(...)` and
//            its `.catch` returns a deliberately unsettled promise for any
//            rejection that is not the string "threshold exceeded", so a
//            rejecting stub would hang that route.
//          lib/controllers/users.js:313, :1327, :1339 and
//            lib/controllers/admin.js:109 do not await the promise at all, so
//            on Node 22 a rejection there is an unhandled rejection, which by
//            default terminates the process.
//        A benign deterministic value is resolved instead, on every path.
//   R-f  Baseline observed behaviour is the tie-breaker. ONE implementation is
//        loaded into BOTH worktrees and contains no branch on which tree is
//        running, so any difference the corpus reports belongs to the
//        application and never to the harness. lib/util/mailer.js is
//        byte-identical at base commit 2f8712a and on the target tree
//        (measured: an empty `git diff` for that path), so the patch target's
//        shape is the same on both sides.
//   BOUNDARIES & PRESERVATION, client-visible page behaviour. This file must
//        not add or alter mail configuration in ANY way. The overlay sets
//        app.mail.from and app.mail.host and deliberately nothing else under
//        `mail`, and lib/util/routeParser.js computes, inside addUserContext:
//            hasAWS     = config.aws && config.aws.mail && config.aws.mail.keyId && config.aws.mail.key
//            hasMailgun = config.app.mail && config.app.mail.key && config.app.mail.domain
//            hasFrom    = config.app.mail && config.app.mail.from
//            json.emailEnabled = hasFrom && (hasAWS || hasMailgun)
//        With from+host only, `emailEnabled` stays FALSY and rendered HTML is
//        unchanged. THE COUPLING IS DISCOVERABLE HERE ON PURPOSE: if a future
//        overlay change adds app.mail.key + app.mail.domain, or aws.mail
//        credentials, emailEnabled flips true, the rendered pages change and
//        replay.js fails on every page that carries user context. This file
//        never writes to `config`, so it cannot cause that flip - and it must
//        not be edited to do so.
//   AAP 0.8  Zero-warning bar. test/parity/server.js runs the whole exercise
//        under --pending-deprecation --trace-deprecation with stderr captured,
//        so there is no `url.parse` (DEP0169), no `new Buffer` (DEP0005), no
//        deprecated fs or stream form, and NO console output of any kind:
//        evidence goes to PARITY_MAIL_LOG and nowhere else. Note that
//        lib/util/mailer.js:31 logs "Email not configured, skipping send to:"
//        on its unconfigured path - that is application output on the very
//        path this fixture replaces, and this stub deliberately emits nothing
//        comparable.
//
// Folder prohibitions, all absolute and all honoured: no network access on any
// code path (the genuine `send` is retained solely so restore() can put it
// back, and is never invoked from this file); nothing from test/helpers/** or
// test/lib/** is required - test/helpers/mail.js informed the restore
// discipline only, and its Mocha before/after hooks are impossible in a
// preload because Mocha 3 loads --require modules before installing the BDD
// globals, so `typeof before === 'undefined'` there (AAP 0.6.5); no
// `url.parse` anywhere; no nondeterministic value in anything this file
// produces; no application file, no config/*.yaml and nothing in the baseline
// worktree is edited; and no CLI argument is read.
//
// Load-order safety (AAP 0.6.5 defect 2): `mongoose-schema-extend` replaces
// the global Object.getPrototypeOf and makes @hapi/hapi unloadable for the
// rest of the process if it loads first. lib/util/mailer.js requires only
// `nodemailer`, `config` and `underscore`, so requiring it from a preload is
// safe - measured, it emits nothing on stdout or stderr under
// --pending-deprecation --trace-deprecation. Nothing under config/db,
// config/app.config or lib/models/** is required here, and `config` is never
// required with a bare specifier, which would load the TARGET worktree's own
// instance rather than the instance the application under test holds.
//
// ===========================================================================
// ENVIRONMENT CONTRACT - the authoritative list. These TWO variables are every
// variable this file reads, so test/parity/server.js can match it exactly. No
// unset, empty or malformed value causes a throw, and nothing is read from the
// command line.
// ===========================================================================
//   PARITY_APP_ROOT  Absolute path of the worktree under test, used to resolve
//                    the application's own lib/util/mailer.
//                    FALLBACK: process.cwd(). The fallback is correct because
//                    test/parity/server.js spawns the application with the
//                    worktree under test as its working directory, while this
//                    file lives in the TARGET worktree. `__dirname` is
//                    therefore deliberately NOT used for resolution: on a
//                    baseline run it would resolve the target tree's mailer,
//                    patch a module instance no controller holds, and let
//                    every send through to a real transport while reporting a
//                    successful install.
//   PARITY_MAIL_LOG  Absolute path of the evidence file. When unset, calls are
//                    captured in memory only and NOTHING is written. When set,
//                    one JSON record per captured call is appended the moment
//                    the call happens, and flush() rewrites the file with the
//                    complete set. A write fault is recorded in memory, never
//                    thrown and never printed - not even at load time, because
//                    a preload that throws kills the server before app.js
//                    loads.
//
// ===========================================================================
// BASELINE RECORD (R-f) - measured against the tree, not assumed.
// ===========================================================================
// PATCH TARGET. lib/util/mailer.js exports a plain object literal:
//   module.exports = { isConfigured: isConfigured, send: async function(to, subject, options) }
// with `send` at :29. Every one of the seven consumers binds the OBJECT -
// `var mailer = require('../util/mailer')` - and calls `mailer.send(...)`,
// resolving the property at call time; none destructures `send` and none
// caches it. app.js:36, lib/controllers/{pages,admin,trinket,users,course}.js,
// lib/models/courseInvitation.js and lib/workers/exports.js:25 all reach the
// same instance through require.cache. Replacing the property on that one
// object is therefore visible to all of them, whether they required the module
// before or after this preload ran.
//
// THE EIGHT `mailer.send` CALL SITES, none of them behind an isConfigured()
// gate, so the stub must tolerate being called on a path where no gate ran.
// Line numbers are the current tree's, with the AAP's baseline numbers in
// parentheses where they have moved:
//   lib/workers/exports.js:421 (397)   {html, type:'export-ready'}   RETURNED into the export chain
//   lib/workers/exports.js:434 (410)   {html, type:'export-failed'}  RETURNED into the export chain
//   lib/controllers/users.js:313 (257) {html, type:'password-reset'} un-awaited, after the response is settled
//   lib/controllers/users.js:1327 (1115) {html, type:'confirm-email-change'} un-awaited
//   lib/controllers/users.js:1339 (1127) {html, type:'verify-email'} un-awaited
//   lib/models/courseInvitation.js:82  {html, replyTo, type:'course-invitation'} returned into a chain
//   lib/controllers/admin.js:109 (104) {text}  un-awaited, and the ONLY site with NO `type` field
//   lib/controllers/trinket.js:853 (873) {html, subject, optional replyTo/address} returned into a chain
// So `options` legitimately carries html, text, type, replyTo or address, and
// `type` is legitimately ABSENT. The record keeps whatever arrived.
//
// THE SEVEN isConfigured() GATES, grep-verified as exactly seven and left
// untouched: lib/controllers/trinket.js:787, lib/controllers/users.js:268,
// :846, :889, :960, lib/controllers/course.js:823, :877.
//
// WHAT THIS FIXTURE DOES NOT REPRODUCE, stated so a reviewer is not surprised:
// `send` is replaced WHOLESALE, so neither the unconfigured short-circuit at
// lib/util/mailer.js:30-33 - which logs and returns {skipped, reason} - nor
// the `_.extend({from, to, subject}, options)` defaulting at :35-39 runs. The
// captured record therefore holds exactly what the CALLER passed: `from` is
// not defaulted into it, and `to`/`subject` appear as the arguments they were
// rather than folded into the options object. That is the point - a reviewer
// reads the call, not the library's normalization of it.
//
// EVIDENCE FILE FORMAT. One JSON object per line (JSONL), encoded at capture
// time and never re-encoded, with keys in a fixed order:
//   {"event":"send","sequence":0,"to":...,"subject":...,"type":...,"options":{...}}
// `type` is null for the un-typed admin alert. `sequence` counts sends in
// process order and is NOT reset by reset(), so a reviewer can align the file
// with an assertion window. There is no timestamp, no message id and no
// generated value anywhere in a record: the file is evidence a reviewer diffs,
// and two runs of the same behaviour produce byte-identical output. Values the
// APPLICATION generates are recorded verbatim and are deliberately not
// laundered - the password-reset URL, for instance, carries a key derived from
// crypto.randomBytes, so that line differs between runs. Normalizing it would
// hide what the application actually sent, which R-d forbids.
//
// A record for the fixture itself - a log write that failed, a mailer that
// could not be resolved - is written the same way with a different event name
// and a `detail` field, so one file carries both the captures and the reasons
// a capture is missing.

'use strict';

var fs = require('fs');
var path = require('path');

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

// Resolved against PARITY_APP_ROOT, never against __dirname. See the
// environment contract above for why that distinction decides correctness.
var MAILER_MODULE = 'lib/util/mailer';

// The value every captured send resolves with. Baseline resolves nodemailer's
// `transport.sendMail` response; nothing in the repository reads a field off
// it - every call site either ignores the result, fires and forgets, or
// returns the promise into a chain - so a small fixed object is the whole
// requirement. No message id, no timestamp, nothing generated. Frozen so it
// cannot become a channel for cross-call state, and copied per call so a
// caller that did decide to write to its result could not affect the next
// call's value.
var SEND_RESULT = Object.freeze({ parityFixture: 'mail', captured: true });

// ---------------------------------------------------------------------------
// Module state. Held in one object so that install()/restore() are idempotent
// and so a second require() of this file - which returns the same cached
// exports - cannot double-patch anything or lose the genuine `send`.
//
// Two collections, deliberately, because they answer two different questions:
//   calls  the ASSERTION WINDOW. reset() clears it, so a harness can bound one
//          export job's mail to one assertion.
//   log    the COMPLETE EVIDENCE, as capture-time encoded lines. reset() never
//          clears it, so flush() at the end of a run - or from the exit hook -
//          cannot truncate away evidence that a mid-run reset() dropped from
//          the window.
// ---------------------------------------------------------------------------
var state = {
  installed        : false,
  mailer           : null,  // the exports object whose `send` was swapped
  originalSend     : null,  // the genuine `send`, held only for restore()
  resolvedPath     : null,  // absolute path of the patched module
  diagnostic       : null,  // why the install is inactive, when it is
  exitHookInstalled: false,
  sequence         : 0,     // sends in process order; reset() does not clear it
  calls            : [],    // assertion window: structured records
  notes            : [],    // records about the fixture itself, not about mail
  log              : []     // complete evidence: encoded lines, in order
};

// ---------------------------------------------------------------------------
// Evidence log. Nothing in this section may throw into the application and
// nothing may emit to stdout or stderr: the zero-warning gate captures both
// streams for the whole run (AAP 0.8), and three of the eight call sites do
// not await the promise, so a throw here would surface as an unhandled
// rejection rather than as a handled error.
// ---------------------------------------------------------------------------

// Coerces anything to a short string without ever throwing - String(aSymbol)
// and a throwing toString() both land in the catch.
function safeText(value) {
  if (value === undefined || value === null) {
    return null;
  }

  try {
    return String(value);
  }
  catch (e) {
    return null;
  }
}

// The message of an unknown thrown value, for a diagnostic. Never throws.
function reasonOf(err) {
  if (err && typeof err === 'object' && typeof err.message === 'string') {
    return err.message;
  }

  var text = safeText(err);
  return text === null ? 'unknown error' : text;
}

// Encodes one record as a single JSON line. A record whose `options` cannot be
// serialized - a circular reference, a BigInt, a getter that throws - is
// reduced to its identifying fields rather than lost, and the reduction is
// itself guarded. Key order is the object literal's, which JSON.stringify
// preserves, so two runs of the same behaviour produce byte-identical lines.
function encode(record) {
  try {
    return JSON.stringify(record);
  }
  catch (e) {
    var reduced = {
      event   : 'send-unencodable',
      sequence: typeof record.sequence === 'number' ? record.sequence : null,
      to      : safeText(record.to),
      subject : safeText(record.subject),
      type    : safeText(record.type),
      reason  : reasonOf(e)
    };

    try {
      return JSON.stringify(reduced);
    }
    catch (ignored) {
      // Only reachable if the reduction itself is unserializable, which the
      // coercions above make impossible; kept so this function has no throwing
      // path at all.
      return '{"event":"encode-failed","sequence":null}';
    }
  }
}

// Appends one already-encoded line to PARITY_MAIL_LOG. A strict no-op when the
// variable is unset. A write fault is retained in memory ONLY - deliberately
// not appended, because the destination is what failed, and appending would
// recurse - and is surfaced by status().notes, which is where a harness looks.
// The directory is not created: the harness owns the log path, and a blind
// recursive mkdir is not a safe operation to run from inside a request.
function appendLine(line) {
  var target = process.env.PARITY_MAIL_LOG;
  if (!target) {
    return null;
  }

  try {
    fs.appendFileSync(target, line + '\n');
    return target;
  }
  catch (e) {
    state.notes.push({
      event : 'log-write-failed',
      detail: { path: target, error: reasonOf(e) }
    });
    return null;
  }
}

// Records one captured send: the full triple, plus the `type` discriminator
// lifted out of `options` because that is how every gate selects a call. The
// line is encoded here, at capture time, and never re-encoded, so the evidence
// cannot drift if a caller later mutates the object it passed.
function recordSend(to, subject, options) {
  var type = null;

  // `options.type` is read through a guard because it is the caller's object:
  // a throwing getter must not be able to lose the capture.
  try {
    if (options && typeof options === 'object' && options.type !== undefined && options.type !== null) {
      type = options.type;
    }
  }
  catch (e) {
    type = null;
  }

  var record = {
    event   : 'send',
    sequence: state.sequence++,
    to      : to,
    subject : subject,
    type    : type,
    // The caller's own object is retained, so an assertion sees exactly what
    // was passed. `undefined` becomes null so the record is JSON-complete.
    options : options === undefined ? null : options
  };

  state.calls.push(record);

  var line = encode(record);
  state.log.push(line);
  appendLine(line);

  return record;
}

// Records something about the fixture itself rather than about a mail: a
// mailer that could not be resolved, a property that could not be replaced, an
// exit hook that could not be registered. Same guarantees, same destination,
// but kept OUT of the assertion window so calls() stays exactly the captured
// mail.
function note(event, detail) {
  var record = { event: event, detail: detail === undefined ? null : detail };

  state.notes.push(record);

  var line = encode(record);
  state.log.push(line);
  appendLine(line);

  return record;
}

// Rewrites PARITY_MAIL_LOG with the complete evidence held in memory, joining
// the capture-time lines rather than re-encoding them. Exposed for a harness
// that wants one self-contained artifact, and called from the exit hook so a
// failed run still leaves evidence. A strict no-op when the variable is unset,
// and it never throws. Returns the path written, or null.
function flush() {
  var target = process.env.PARITY_MAIL_LOG;
  if (!target) {
    return null;
  }

  try {
    fs.writeFileSync(target, state.log.length ? state.log.join('\n') + '\n' : '');
    return target;
  }
  catch (e) {
    state.notes.push({
      event : 'log-flush-failed',
      detail: { path: target, error: reasonOf(e) }
    });
    return null;
  }
}


// ---------------------------------------------------------------------------
// The replacement. Same shape as lib/util/mailer.js:29 - an async function of
// arity three - so nothing about the call site changes: `await`, `.then()` and
// fire-and-forget all behave as they did.
//
// It NEVER rejects and NEVER throws (R-e). Every step that touches caller data
// or the filesystem is guarded, and the guard's own failure is swallowed
// rather than printed, because a capture failure must not become an
// application failure and must not breach the zero-output bar.
// ---------------------------------------------------------------------------
var capturingSend = async function (to, subject, options) {
  try {
    recordSend(to, subject, options);
  }
  catch (e) {
    try {
      note('capture-failed', { error: reasonOf(e) });
    }
    catch (ignored) {
      // The evidence log itself is unavailable. There is nothing further to be
      // done that would not print, so the send still resolves: an observation
      // this fixture failed to make is not a failure of the application under
      // test.
    }
  }

  // A fresh copy per call, so no caller can turn the resolved value into
  // shared state, while the content stays fixed and therefore deterministic.
  return Object.assign({}, SEND_RESULT);
};

// The marker that makes install() idempotent across separate require sites
// without depending on function identity.
capturingSend.parityFixture = 'mail';

// ---------------------------------------------------------------------------
// Install and restore.
// ---------------------------------------------------------------------------

// The worktree under test. See the environment contract: __dirname would
// resolve the wrong tree on a baseline run.
function appRoot() {
  return process.env.PARITY_APP_ROOT || process.cwd();
}

// Replaces one property, then verifies the replacement took. Plain assignment
// first, because that is what the module's plain object literal supports;
// Object.defineProperty second, for the case where a descriptor has been made
// non-writable. Returns true only when the property really is the intended
// value afterwards.
function replaceProperty(target, name, value) {
  try {
    target[name] = value;
  }
  catch (e) {
    try {
      Object.defineProperty(target, name, {
        value       : value,
        writable    : true,
        enumerable  : true,
        configurable: true
      });
    }
    catch (inner) {
      note('property-replace-failed', { property: name, error: reasonOf(inner) });
      return false;
    }
  }

  return target[name] === value;
}

// Registers the exit-time flush. Only 'exit' is used, and that is a decision
// rather than an omission:
//   * A SIGINT or SIGTERM listener would SUPPRESS Node's default termination
//     and change the signal behaviour of the application this fixture is
//     loaded into - and test/parity/server.js owns graceful shutdown.
//   * An 'uncaughtException' listener would swallow application crashes, which
//     are exactly what the parity run needs to observe.
// Evidence is not at risk from either: every record is appended the moment it
// is captured, so a signal kill loses nothing. The hook is registered once,
// and it cannot throw out of the exit path.
function installExitHook() {
  if (state.exitHookInstalled) {
    return true;
  }

  try {
    process.on('exit', function () {
      try {
        flush();
      }
      catch (ignored) {
        // Nothing may escape an exit handler, and nothing may be printed from
        // one. flush() already has no throwing path; this is the last layer.
      }
    });

    state.exitHookInstalled = true;
    return true;
  }
  catch (e) {
    note('exit-hook-failed', { error: reasonOf(e) });
    return false;
  }
}

// Resolves and patches the application's own mailer instance. Idempotent, and
// it never throws: a preload that throws kills the server before app.js loads,
// so every failure becomes a diagnostic in status() and a record in the
// evidence log instead.
function install() {
  if (state.installed) {
    return status();
  }

  var root = appRoot();
  var target = path.resolve(root, MAILER_MODULE);
  var resolved;

  try {
    resolved = require.resolve(target);
  }
  catch (e) {
    state.diagnostic = MAILER_MODULE + ' is not resolvable from ' + root +
      ' (' + (e && e.code ? e.code : reasonOf(e)) + '); no mail is intercepted';
    note('mailer-unresolvable', { appRoot: root, error: state.diagnostic });
    return status();
  }

  var mailer;

  try {
    // Loading performs no network I/O - lib/util/mailer.js requires only
    // nodemailer, config and underscore, and creates a transport per send
    // rather than at load. It is loaded here so that the cache entry the
    // application will hit is the one being patched.
    mailer = require(resolved);
  }
  catch (e) {
    state.diagnostic = MAILER_MODULE + ' resolved to ' + resolved +
      ' but could not be loaded: ' + reasonOf(e);
    note('mailer-unloadable', { module: resolved, error: state.diagnostic });
    return status();
  }

  state.resolvedPath = resolved;

  if (!mailer || typeof mailer.send !== 'function') {
    state.diagnostic = MAILER_MODULE + ' resolved to ' + resolved +
      ' but exports no `send` function to replace';
    note('mailer-shape-unexpected', { module: resolved, error: state.diagnostic });
    return status();
  }

  // Already wrapped - by an earlier install(), or by a second copy of this
  // file loaded from a different path. One layer only, and the genuine `send`
  // that the first install saved is not overwritten with the stub.
  if (mailer.send.parityFixture === 'mail') {
    state.mailer = mailer;
    state.installed = true;

    if (typeof state.originalSend !== 'function') {
      note('adopted-existing-patch', { module: resolved });
    }

    installExitHook();
    return status();
  }

  state.originalSend = mailer.send;

  if (!replaceProperty(mailer, 'send', capturingSend)) {
    state.originalSend = null;
    state.diagnostic = MAILER_MODULE + ' resolved to ' + resolved +
      ' but its `send` property could not be replaced; no mail is intercepted';
    return status();
  }

  state.mailer = mailer;
  state.installed = true;
  state.diagnostic = null;

  installExitHook();
  return status();
}

// Puts the genuine `send` back. The retained original is used here and nowhere
// else: no code path in this file ever calls it, which is what makes the "no
// network access" prohibition structural rather than incidental. Idempotent -
// a second call is a no-op - and `isConfigured` is never touched, on either
// side of the swap (R-d).
function restore() {
  if (state.mailer && typeof state.originalSend === 'function') {
    if (!replaceProperty(state.mailer, 'send', state.originalSend)) {
      // The property is locked against us. The state is still cleared so a
      // later install() re-derives everything from the module rather than
      // trusting a stale original.
      note('restore-failed', { module: state.resolvedPath });
    }
  }

  state.mailer = null;
  state.originalSend = null;
  state.installed = false;

  return status();
}

// What is patched, what is not, and why. Returned by install() and restore()
// and available on its own, so a harness reports the active interception
// rather than guessing at it. `notes` carries the reasons a capture might be
// missing, which is the first thing to read when an assertion finds no mail.
function status() {
  return {
    installed : state.installed,
    appRoot   : appRoot(),
    module    : state.resolvedPath,
    logPath   : process.env.PARITY_MAIL_LOG || null,
    captured  : state.calls.length,
    sends     : state.sequence,
    diagnostic: state.diagnostic,
    notes     : state.notes.slice()
  };
}

// ---------------------------------------------------------------------------
// Selection. `type` is the discriminator every call site sets and every gate
// keys on, so one selector is provided and nothing beyond it (R-a).
// ---------------------------------------------------------------------------

// Captured sends carrying the given `options.type`, in call order. Called with
// no argument, or with null, it selects the UN-TYPED calls - which is the admin
// session alert at lib/controllers/admin.js:109, the one site that sets no
// type.
function findByType(type) {
  var wanted = type === undefined ? null : type;

  return state.calls.filter(function (record) {
    return record.type === wanted;
  });
}

// ---------------------------------------------------------------------------
// Public API. Consumed by test/parity/server.js (install), test/parity/worker.js
// (calls, findByType, reset, flush) and any harness that needs to hand the
// genuine transport back (restore).
// ---------------------------------------------------------------------------
module.exports = {
  install : install,
  restore : restore,
  status  : status,

  // Evidence.
  calls: function () {
    return state.calls.slice();
  },
  reset: function () {
    // Clears the assertion window ONLY. The complete evidence log, the note
    // list and the send counter are deliberately left alone, so a flush after
    // a reset still writes the whole run and `sequence` still aligns a record
    // with the order it was sent in.
    state.calls = [];
    return null;
  },
  flush     : flush,
  findByType: findByType,

  // The exact value every captured send resolves with, so an assertion can
  // name it instead of restating its shape.
  sendResult: SEND_RESULT
};

// ---------------------------------------------------------------------------
// Auto-install on first require, so a preload needs no argument and no call.
// Wrapped so that nothing here can throw out of the load: this module is
// required before app.js, and a throw at this point would take the server down
// before it ever started.
// ---------------------------------------------------------------------------
try {
  install();
}
catch (e) {
  try {
    note('install-failed', { error: reasonOf(e) });
  }
  catch (ignored) {
    // The evidence log itself is unavailable, so the failure is kept on the
    // state object, where status().diagnostic surfaces it. A plain assignment
    // cannot throw, which is what makes this the last layer.
    state.diagnostic = 'install failed and could not be logged: ' + reasonOf(e);
  }
}

