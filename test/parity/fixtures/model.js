'use strict';

// The model-boundary fault fixture - the one way a database failure is made to
// happen on purpose, so that the auth scheme's fifth outcome can be observed
// rather than asserted in prose.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// AAP §0.6.1 records that the session auth scheme has FIVE distinct outcomes
// and §0.9.3 requires each to be "asserted independently". Four are reachable
// over HTTP:
//
//   1. no `userId` in the session          -> 'Not logged in'
//   2. a session whose user record is gone -> session cleared, 'User not found'
//   3. a `disabled` user                   -> session cleared, 'Account disabled'
//   4. a valid user                        -> h.authenticated
//
// The fifth is not, and that is the whole problem this file solves:
//
//   5. the LOOKUP ITSELF fails             -> 'Auth error'
//
// `User.findById` has to reject for outcome 5 to happen, and no request can
// make a healthy database reject. Before this file existed the corpus recorded
// the outcome as "unreachable" and pointed at a server-level gate that "can
// inject the fault" - and no such gate existed anywhere in test/parity/. The
// gap was reported as covered. This file is that gate, and it is a real one.
//
// ===========================================================================
// WHY A PRELOAD, AND NOT A HOOK IN THE APPLICATION
// ===========================================================================
// The obvious alternative - an env-var-guarded branch in app.js or
// lib/models/user.js - is wrong three times over:
//
//   R-f makes baseline behaviour at 2f8712a the tie-breaker, and the baseline
//   worktree has no test/parity/ and no such branch. A hook that exists only on
//   the target tree cannot produce a comparable measurement on both.
//
//   R-a requires the diff to read as migration work only, and R-d prohibits
//   behaviour changes. A test hook compiled into the shipped request path is
//   neither.
//
//   The launcher already establishes the mechanism for exactly this: AAP §0.9.3
//   intercepts external effects "at the module boundary rather than over the
//   network", through preloads that resolve the application module they patch
//   via PARITY_APP_ROOT. fixtures/aws.js, fixtures/mail.js and fixtures/http.js
//   are the three that existed; this is the fourth, and it follows their
//   conventions deliberately so that there is one pattern to understand rather
//   than four.
//
// So the application source is untouched on both trees, and the same fixture
// drives the baseline and the target.
//
// ===========================================================================
// WHY THE MODEL IS WRAPPED LAZILY - THIS IS THE LOAD-BEARING DETAIL
// ===========================================================================
// This file must NOT require the model it patches. AAP §0.6.5 Defect 2 is
// measured: `mongoose-schema-extend` installs a Proxy polyfill that REPLACES
// the global `Object.getPrototypeOf`, after which requiring `@hapi/hapi` throws
// `Error: Schema can only contain plain objects` - and the version bump to
// 21.4.10 does not fix it. `lib/models/user` pulls in `mongoose`, so requiring
// it from a preload would load that polyfill BEFORE `@hapi/hapi`, and the
// application would die at startup with an error that looks nothing like its
// cause. `config/app.config.js:3-7` documents the same ordering rule in code.
//
// So the model is not loaded here. It is wrapped when the application loads it
// ITSELF, through the one line that publishes it:
//
//   app.js  `User = require('./lib/models/user');`   (target :313, baseline :290)
//
// `User` is an UNDECLARED assignment, so that line writes a property on the
// global object - which app.js confirms four lines later by naming it in
// `gleak.ignore("User", ...)`. And the auth scheme reads the bare identifier,
// `await User.findById(userId)`, so the global is exactly the binding under
// test. This fixture therefore installs an accessor for `User` on the global
// object, wraps the export IN PLACE when the application assigns it, and then
// replaces the accessor with an ordinary writable property. Both trees assign
// it at the same point in the same way, so one mechanism drives both.
//
// Wrapping in place rather than substituting an object matters: `require`
// returns the same object to every consumer, so `lib/workers/exports.js`'s own
// `require('../models/user')` sees the wrap too, and nothing depends on which
// consumer happened to load the module first.
//
// AN EARLIER REVISION HOOKED `Module.prototype.require` INSTEAD, and it is
// worth recording why that was wrong, because it looked correct and passed its
// own tests. The model is required late in boot - app.js:313, after
// config/app.config has pulled in every controller - so the hook sat in the
// call path for essentially every require in the process. It worked. But it
// also inserted a frame from THIS FILE into the stack trace of every
// deprecation warning emitted during module loading, and measured: the
// `--trace-deprecation` evidence for the pre-existing DEP0040 (punycode) and
// DEP0005 (compress-commons) warnings then named
// `test/parity/fixtures/model.js` as their call site. Those warnings belong to
// retained dependencies and are what AAP §0.9.3's zero-warning gate reasons
// about, so a fixture that rewrites their attribution actively degrades the
// evidence it exists to produce. The accessor touches nothing but one property
// on one object and appears in no stack at all.
//
// ===========================================================================
// WHY BOTH CALL SHAPES ARE FAULTED
// ===========================================================================
// `lib/models/model.js:115-150` generates `findById` to support a callback and
// a promise, and it is byte-identical on both trees (verified with
// `git diff 2f8712a -- lib/models/model.js`). The two trees call it differently:
//
//   target   `const user = await User.findById(userId);`
//   baseline `User.findById(userId, (err, user) => { ... })` inside a
//            hand-rolled `new Promise` (2f8712a app.js:254-260)
//
// A fault that only rejected the promise would be invisible to the baseline, so
// the wrapper calls the callback AND returns a rejected promise.
//
// That returned promise carries a no-op `catch` before it is handed back, and
// that is not decoration. The baseline IGNORES the return value, so an
// unhandled rejection would reach Node 22's default `--unhandled-rejections=throw`
// and kill the application - the fixture would look like an application crash.
// Attaching a handler marks it handled without changing what a caller that DOES
// await it receives: still a rejection, still the same error.
//
// ===========================================================================
// WHY THE FAULT IS BOUNDED, AND HOW
// ===========================================================================
// An armed fault that stayed armed would break every subsequent authenticated
// request, and the corpus is driven serially against one long-lived server. So
// an arming declares how many calls it applies to - one, for the auth case -
// and the fixture stops faulting after that.
//
// The counter is held IN THIS PROCESS, not written back into the file, and the
// arming file is treated as read-only. Writing to it from inside a request
// would race the harness that owns it, and the fixture must never be able to
// stall or corrupt the process it is loaded into. The file's exact text is used
// as an arming token: when the text changes the arming is new and the counter
// resets, and while it is unchanged the counter keeps counting down. That gives
// "fault the next N calls" with no writes and no clock.
//
// The optional `id` narrows an arming to one document id, which is what makes
// the auth case exact rather than approximate: `test/parity/seed.js:175` freezes
// the seeded user's `_id` at '000000000000000000000101', so an arming keyed to
// that id can only be spent by a lookup of that user - and the evidence log
// records the id of every call it saw, so a reviewer can confirm which lookup
// was faulted instead of trusting that it was the intended one.
//
// ===========================================================================
// ENVIRONMENT CONTRACT
// ===========================================================================
// A preload takes no arguments, so everything arrives through the environment.
// test/parity/server.js sets all of these and reproduces this list in its own
// header, so the two cannot drift.
//
//   PARITY_APP_ROOT           Absolute path of the worktree under test. The
//                             model is resolved relative to THIS, never to this
//                             file's own directory - on a baseline run the
//                             latter would patch a module instance the
//                             application never sees. Falls back to
//                             `process.cwd()`, which is correct because the
//                             child's cwd IS the app root; the launcher sets it
//                             explicitly anyway so the contract is visible.
//   PARITY_MODEL_FAULT_FILE   The arming file. JSON, RE-READ synchronously at
//                             the start of every intercepted call, so a corpus
//                             case can arm and disarm between steps without
//                             restarting the server. Absent, missing,
//                             unparseable or `{}` all mean DISARMED, which is
//                             the state every run starts and ends in.
//   PARITY_MODEL_FAULT        Optional arming for a run with NO arming file -
//                             an externally started server, say. The same JSON
//                             an arming file holds. When a file IS configured
//                             the file is authoritative and this is ignored,
//                             because an explicit disarm through the file has
//                             to be able to win: the bounded design depends on
//                             it.
//   PARITY_MODEL_FAULT_LOG    Optional evidence file. Every intercepted call is
//                             appended as one JSON line - faulted or not - so
//                             "the fault landed on the auth-scheme lookup" is a
//                             claim backed by an artifact. A strict no-op when
//                             unset.
//
// ===========================================================================
// THE ARMING DOCUMENT
// ===========================================================================
//   {
//     "fault"     : "reject",      required; the only supported action
//     "model"     : "user",        optional; only 'user' is wrapped today
//     "method"    : "findById",    optional; defaults to findById
//     "id"        : "0000...0101", optional; when set, only this id faults
//     "remaining" : 1,             optional; defaults to 1. -1 means unbounded
//     "message"   : "...",         optional; the rejection's message
//     "errorName" : "MongoError"   optional; the rejection's `name`
//   }
//
// Any other key is IGNORED for matching, which is what lets a harness stamp an
// arming with a value of its own. `capture.js` and `replay.js` both add an
// `armGeneration`, so two consecutive armed steps produce two textually
// distinct documents and therefore two distinct generations even when their
// specifications are identical - without which the second step would find the
// first one's use count still spent.
//
// An unknown `fault` value, or a `model`/`method` this fixture does not wrap,
// is logged once and treated as disarmed rather than thrown: this code runs
// inside a live request, and a throw there would surface as an application
// fault rather than a harness mistake.
//
// ===========================================================================
// PROHIBITIONS
// ===========================================================================
//   No require of any application module. Honoured below: `fs` and `path` from
//     Node core, and nothing else. The model is reached only through the object
//     the application itself published.
//   No interception on a path the whole application traverses. The accessor is
//     on one property of one object; nothing here is in the call path of a
//     require, a request, or a response, so no stack trace and no timing
//     anywhere else in the process is altered by this file's presence.
//   No write to the arming file, the application tree, or anything outside the
//     evidence log the launcher hands it.
//   No throw out of load. A preload that throws takes the server down before
//     app.js runs, so the auto-install at the bottom is wrapped and a failure
//     is recorded in `status().diagnostic` instead.
//   No `url.parse` and nothing else that emits a deprecation warning: this
//     process's stderr is the stream AAP §0.9.3's zero-warning gate inspects.

var fs   = require('fs');
var path = require('path');

// ---------------------------------------------------------------------------
// What this fixture is able to wrap. Kept as a table rather than hard-coded
// strings so that `status()` can report it and an arming naming something else
// can be rejected with a specific message.
//
// `globalName` is the property the application publishes the model on, and it
// is the interception point - see WHY THE MODEL IS WRAPPED LAZILY above.
// `relativePath` is provenance only: it is resolved (never loaded) so the
// evidence log can say which file's export was wrapped.
// ---------------------------------------------------------------------------
var WRAPPABLE = {
  user: {
    globalName    : 'User',
    relativePath  : 'lib/models/user',
    methods       : ['findById']
  }
};

var DEFAULT_MODEL   = 'user';
var DEFAULT_METHOD  = 'findById';
var DEFAULT_MESSAGE = 'parity fixture: injected data-store failure on ' +
  'User.findById, so that the auth scheme reaches its lookup-error outcome';
var DEFAULT_ERROR_NAME = 'MongoNetworkError';

var state = {
  installed  : false,
  // Whether the global accessor is currently in place, waiting for the
  // application to publish the model.
  waiting    : false,
  // What the application assigned, held here while the accessor is in place so
  // a read between the assignment and the replacement returns it unchanged.
  published  : undefined,
  wrapped    : false,
  target     : null,
  originals  : {},
  calls      : [],
  armToken   : null,
  used       : 0,
  armDiagnostic : null,
  diagnostic : null
};

// ---------------------------------------------------------------------------
// Evidence.
// ---------------------------------------------------------------------------

/**
 * Appends one record to the in-memory log and, when a log path is configured,
 * to the file.
 *
 * The directory is NOT created here, for the reason fixtures/http.js gives: a
 * recursive mkdir is not a safe operation to run blind from inside a request,
 * and the harness owns the log path. An append that fails is kept in memory so
 * the failure is visible through `calls()` rather than silently dropped.
 *
 * @param {Object} record
 * @returns {undefined}
 */
function record(record_) {
  var entry = {};
  var key;
  var target;

  for (key in record_) {
    if (Object.prototype.hasOwnProperty.call(record_, key)) {
      entry[key] = record_[key];
    }
  }

  entry.at = new Date().toISOString();
  state.calls.push(entry);

  target = process.env.PARITY_MODEL_FAULT_LOG;
  if (!target) {
    return;
  }

  try {
    fs.appendFileSync(target, JSON.stringify(entry) + '\n');
  }
  catch (e) {
    state.calls.push({
      event : 'log-append-failed',
      error : e && e.message ? e.message : String(e),
      at    : new Date().toISOString()
    });
  }
}

/**
 * Notes something about the fixture itself rather than about a call.
 *
 * @param {string} event
 * @param {*} [detail]
 * @returns {undefined}
 */
function note(event, detail) {
  record({ event: event, detail: detail === undefined ? null : detail });
}

/**
 * Rewrites the evidence log from the in-memory record.
 *
 * @returns {(string|null)} The path written, or null when none is configured.
 */
function flush() {
  var target = process.env.PARITY_MODEL_FAULT_LOG;
  var lines;

  if (!target) {
    return null;
  }

  try {
    lines = state.calls.map(function(entry) {
      return JSON.stringify(entry);
    });
    fs.writeFileSync(target, lines.length ? lines.join('\n') + '\n' : '');
    return target;
  }
  catch (e) {
    state.calls.push({
      event : 'log-flush-failed',
      error : e && e.message ? e.message : String(e),
      at    : new Date().toISOString()
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// The arming.
// ---------------------------------------------------------------------------

/**
 * Reads the arming document, as raw text plus its parsed form.
 *
 * The raw text is returned alongside the object because it is the arming TOKEN:
 * the in-process counter resets when the text changes, which is what makes
 * "fault the next N calls" work without writing to the file. Every failure mode
 * - no file configured, missing, unreadable, unparseable, not an object -
 * returns a disarmed result, and each is noted at most once per distinct cause
 * so a corpus run cannot fill the log with the same line.
 *
 * @returns {{token: (string|null), arming: (Object|null), reason: (string|null)}}
 */
function readArming() {
  var file = process.env.PARITY_MODEL_FAULT_FILE;
  var raw;
  var parsed;

  if (!file) {
    return fromEnvironment('no arming file is configured');
  }

  try {
    raw = fs.readFileSync(file, 'utf8');
  }
  catch (e) {
    // ENOENT is the ordinary disarmed state - the launcher creates the file,
    // but a caller driving an externally started server may not have - so it is
    // not worth a log line of its own beyond the first.
    return diagnose('arming-file-unreadable',
      { file: file, error: e && e.code ? e.code : String(e) },
      'the arming file could not be read');
  }

  if (!String(raw).trim()) {
    // An empty file is disarmed, and it carries a TOKEN: the token tracks the
    // file's state, not just its armings, so passing through disarmed advances
    // the generation and a later arming starts with a fresh use count. See
    // `decide`, where getting this wrong left an identical re-arm spent.
    return {
      token  : 'empty',
      arming : null,
      reason : 'the arming file is empty'
    };
  }

  try {
    parsed = JSON.parse(raw);
  }
  catch (e) {
    return diagnose('arming-file-malformed', { file: file },
      'the arming file is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return diagnose('arming-file-not-an-object', { file: file },
      'the arming file does not hold a JSON object');
  }

  if (!parsed.fault) {
    return { token: String(raw), arming: null, reason: 'no fault is armed' };
  }

  return { token: String(raw), arming: parsed, reason: null };
}

/**
 * The initial arming from PARITY_MODEL_FAULT, used when no file is configured.
 *
 * @param {string} fallbackReason What to report when the variable is unset too.
 * @returns {{token: (string|null), arming: (Object|null), reason: (string|null)}}
 */
function fromEnvironment(fallbackReason) {
  var raw = process.env.PARITY_MODEL_FAULT;
  var parsed;

  if (!raw) {
    return { token: null, arming: null, reason: fallbackReason };
  }

  try {
    parsed = JSON.parse(raw);
  }
  catch (e) {
    return diagnose('arming-env-malformed', {},
      'PARITY_MODEL_FAULT is not valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || !parsed.fault) {
    return { token: null, arming: null, reason: 'PARITY_MODEL_FAULT arms nothing' };
  }

  return { token: 'env:' + raw, arming: parsed, reason: null };
}

/**
 * Notes a distinct arming problem once and returns a disarmed result.
 *
 * @param {string} event
 * @param {Object} detail
 * @param {string} reason
 * @returns {{token: null, arming: null, reason: string}}
 */
function diagnose(event, detail, reason) {
  var signature = event + ':' + JSON.stringify(detail);

  if (state.armDiagnostic !== signature) {
    state.armDiagnostic = signature;
    note(event, detail);
  }

  return { token: null, arming: null, reason: reason };
}

/**
 * Decides whether this call is faulted, and spends one use when it is.
 *
 * @param {string} model Which wrapped model is being called.
 * @param {string} method Which wrapped method is being called.
 * @param {*} id The first argument, as the application passed it.
 * @returns {{fault: boolean, reason: string, arming: (Object|null)}}
 */
function decide(model, method, id) {
  var read = readArming();
  var arming = read.arming;
  var remaining;
  var wantedId;

  // The generation is synced BEFORE the disarmed check, and that ordering is
  // the whole of a bug that was measured and fixed here. The counter belongs to
  // the arming rather than to the process, so it resets when the file's text
  // changes - but an earlier version returned for a disarmed document without
  // syncing, so `arm A -> disarm -> arm A again` left the token still reading A
  // and the second arm was treated as already spent. Measured: the first arm
  // rejected, the identical second arm passed through, one fault logged where
  // two were wanted. Syncing on every readable state means passing through
  // disarmed advances the generation, which is what makes an identical re-arm
  // a new arming.
  //
  // A NULL token is the exception and is deliberately not synced: it means the
  // file could not be read or parsed, and letting a transient read failure
  // refresh a spent arming would make the bound unenforceable in exactly the
  // case where the harness has lost control of the file.
  if (read.token !== null && read.token !== state.armToken) {
    state.armToken = read.token;
    state.used     = 0;
  }

  if (!arming) {
    return { fault: false, reason: read.reason || 'disarmed', arming: null };
  }

  if (arming.fault !== 'reject') {
    return {
      fault  : false,
      reason : 'unsupported fault action ' + JSON.stringify(arming.fault),
      arming : arming
    };
  }

  if (String(arming.model || DEFAULT_MODEL) !== model) {
    return {
      fault  : false,
      reason : 'armed for model ' + JSON.stringify(arming.model) +
        ', which is not ' + model,
      arming : arming
    };
  }

  if (String(arming.method || DEFAULT_METHOD) !== method) {
    return {
      fault  : false,
      reason : 'armed for method ' + JSON.stringify(arming.method) +
        ', which is not ' + method,
      arming : arming
    };
  }

  if (arming.id !== undefined && arming.id !== null) {
    wantedId = String(arming.id);

    // `id` arrives as whatever the application had - a string from the session,
    // or an ObjectId - so both sides are compared as strings.
    if (String(id) !== wantedId) {
      return {
        fault  : false,
        reason : 'armed for id ' + wantedId + ', not ' + String(id),
        arming : arming
      };
    }
  }

  remaining = arming.remaining === undefined ? 1 : Number(arming.remaining);

  // -1 is the deliberate unbounded form, for a harness that wants every lookup
  // to fail for as long as the arming stands. Anything else is a count.
  if (remaining !== -1 && !(state.used < remaining)) {
    return {
      fault  : false,
      reason : 'this arming is spent (' + state.used + ' of ' + remaining +
        ' uses)',
      arming : arming
    };
  }

  state.used = state.used + 1;

  return { fault: true, reason: 'armed', arming: arming };
}

// ---------------------------------------------------------------------------
// The wrapper.
// ---------------------------------------------------------------------------

/**
 * Builds the replacement for one model method.
 *
 * @param {string} model
 * @param {string} method
 * @param {function} original
 * @returns {function}
 */
function faultingMethod(model, method, original) {
  var replacement = function(id) {
    var callback = arguments.length > 1 ? arguments[arguments.length - 1] : null;
    var decision = decide(model, method, id);
    var error;
    var rejected;

    if (!decision.fault) {
      // Only recorded while an arming is in force. Every authenticated request
      // performs one of these lookups, so logging the disarmed steady state
      // would bury the handful of records that carry the evidence under
      // hundreds that carry none. While an arming IS in force, a pass-through
      // is exactly what a reviewer needs - it says which lookup the fixture
      // saw and why it declined to fault it.
      if (decision.arming) {
        record({
          event  : 'passed-through',
          model  : model,
          method : method,
          id     : id === undefined ? null : String(id),
          reason : decision.reason
        });
      }

      return original.apply(this, arguments);
    }

    error = new Error(decision.arming.message || DEFAULT_MESSAGE);
    error.name = String(decision.arming.errorName || DEFAULT_ERROR_NAME);
    error.parityInjected = true;

    record({
      event      : 'faulted',
      model      : model,
      method     : method,
      id         : id === undefined ? null : String(id),
      shape      : typeof callback === 'function' ? 'callback+promise' : 'promise',
      errorName  : error.name,
      message    : error.message,
      usesSpent  : state.used
    });

    rejected = Promise.reject(error);

    // Marked handled before it leaves this function. The baseline call shape
    // discards the return value, and an unhandled rejection under Node 22's
    // default policy would end the process - a harness fault dressed as an
    // application crash. A caller that awaits it still gets the rejection.
    rejected.catch(function() {});

    if (typeof callback === 'function') {
      // `nextTick` rather than a synchronous call, because the real
      // `findById` never calls back before returning and a caller that
      // assigned the return value first would otherwise see its own variable
      // unassigned inside the callback.
      process.nextTick(function() {
        callback(error);
      });
    }

    return rejected;
  };

  replacement.parityFixture = true;

  return replacement;
}

/**
 * Wraps the methods of one freshly required model export.
 *
 * @param {string} model The key in WRAPPABLE.
 * @param {Object} exported The module's exports, as the application received it.
 * @returns {boolean} Whether anything was wrapped.
 */
function wrapModel(model, exported) {
  var methods = WRAPPABLE[model].methods;
  var wrappedAny = false;
  var i;
  var name;
  var original;

  if (!exported) {
    note('model-export-empty', { model: model });
    return false;
  }

  for (i = 0; i < methods.length; i++) {
    name     = methods[i];
    original = exported[name];

    if (typeof original !== 'function') {
      note('model-method-absent', { model: model, method: name });
      continue;
    }

    if (original.parityFixture) {
      // Already wrapped by an earlier install(); one layer only.
      wrappedAny = true;
      continue;
    }

    state.originals[model + '.' + name] = { holder: exported, original: original };
    exported[name] = faultingMethod(model, name, original);
    wrappedAny = true;
  }

  return wrappedAny;
}

// ---------------------------------------------------------------------------
// Installation - the lazy require hook.
// ---------------------------------------------------------------------------

/**
 * Resolves the model file inside the worktree under test - for the record.
 *
 * `require.resolve` performs no load, so this touches nothing: it exists so the
 * evidence log and `status()` can name the file whose export was wrapped, which
 * on a two-worktree run is the difference between "the target's model" and "the
 * baseline's model". A tree where it does not resolve is reported rather than
 * treated as fatal - the wrap keys on the global the application publishes, not
 * on this path.
 *
 * @param {string} appRoot
 * @param {string} model
 * @returns {(string|null)} The resolved filename, or null with a diagnostic set.
 */
function resolveModel(appRoot, model) {
  try {
    return require.resolve(path.join(appRoot, WRAPPABLE[model].relativePath));
  }
  catch (e) {
    state.diagnostic = WRAPPABLE[model].relativePath + ' did not resolve from ' +
      appRoot + ' (' + (e && e.code ? e.code : e.message) + '); the wrap keys ' +
      'on the global the application publishes rather than on this path, so ' +
      'this is a gap in the evidence rather than a failure to install';
    return null;
  }
}

/**
 * Installs the global accessor that wraps the model when the application
 * publishes it.
 *
 * `app.js` assigns the undeclared `User`, which writes a property on the global
 * object. The setter wraps the assigned export IN PLACE - so every consumer of
 * `require('lib/models/user')` sees the wrap, not just the global - and then
 * REPLACES ITSELF with an ordinary writable property, leaving the global in
 * exactly the shape the plain assignment would have produced.
 *
 * Nothing else in the process is intercepted, which is the point: this file
 * appears in no stack trace and on no hot path.
 *
 * @param {string} model The key in WRAPPABLE.
 * @returns {boolean} Whether the accessor is in place, or the wrap already done.
 */
function watchGlobal(model) {
  var name = WRAPPABLE[model].globalName;
  var existing;

  if (state.waiting || state.wrapped) {
    return true;
  }

  // A process that already published the model before this fixture loaded -
  // not the preload case, but a harness that required the fixture late - is
  // wrapped immediately rather than left unwrapped waiting for an assignment
  // that has already happened.
  existing = globalThis[name];
  if (existing) {
    state.wrapped = wrapModel(model, existing);
    if (state.wrapped) {
      note('model-wrapped', {
        model : model,
        via   : 'already-published',
        file  : state.target
      });
    }
    return state.wrapped;
  }

  try {
    Object.defineProperty(globalThis, name, {
      configurable : true,
      enumerable   : true,
      get : function() {
        return state.published;
      },
      set : function(value) {
        state.published = value;

        try {
          state.wrapped = wrapModel(model, value);
        }
        catch (e) {
          note('wrap-failed', {
            model : model,
            error : e && e.message ? e.message : String(e)
          });
          state.wrapped = false;
        }

        // Put the global back to a plain property whatever happened, so a
        // failed wrap cannot leave an accessor in the application's way.
        Object.defineProperty(globalThis, name, {
          value        : value,
          writable     : true,
          enumerable   : true,
          configurable : true
        });
        state.waiting = false;

        if (state.wrapped) {
          note('model-wrapped', {
            model : model,
            via   : 'global-assignment',
            file  : state.target
          });
        }
      }
    });
  }
  catch (e) {
    state.diagnostic = 'the global ' + name + ' could not be watched (' +
      (e && e.message ? e.message : String(e)) + '), so no model fault can be ' +
      'injected in this process';
    return false;
  }

  state.waiting = true;
  return true;
}

/**
 * Installs the fixture. Idempotent, and never throws.
 *
 * @returns {Object} The same document `status()` returns.
 */
function install() {
  var appRoot;

  if (state.installed) {
    return status();
  }

  appRoot      = process.env.PARITY_APP_ROOT || process.cwd();
  state.target = resolveModel(appRoot, DEFAULT_MODEL);

  if (!state.target) {
    note('model-path-unresolved', state.diagnostic);
  }

  state.installed = watchGlobal(DEFAULT_MODEL);

  if (!state.installed) {
    note('install-inactive', state.diagnostic);
  }

  return status();
}

/**
 * Puts the genuine model methods back and removes the global accessor.
 *
 * @returns {Object} The same document `status()` returns.
 */
function restore() {
  var keys = Object.keys(state.originals);
  var name = WRAPPABLE[DEFAULT_MODEL].globalName;
  var i;
  var entry;
  var method;

  for (i = 0; i < keys.length; i++) {
    entry  = state.originals[keys[i]];
    method = keys[i].slice(keys[i].indexOf('.') + 1);
    entry.holder[method] = entry.original;
  }

  if (state.waiting) {
    // Leave the global as an ordinary, unset property rather than an accessor
    // this fixture no longer backs.
    try {
      delete globalThis[name];
    }
    catch (e) {
      state.diagnostic = 'the global ' + name + ' accessor could not be ' +
        'removed: ' + (e && e.message ? e.message : String(e));
    }
  }

  state.originals = {};
  state.published = undefined;
  state.waiting   = false;
  state.wrapped   = false;
  state.installed = false;
  state.armToken  = null;
  state.used      = 0;

  return status();
}

/**
 * What is wrapped, what is armed, and why not when it is not.
 *
 * @returns {Object}
 */
function status() {
  var read = readArming();

  return {
    installed  : state.installed,
    waiting    : state.waiting,
    wrapped    : state.wrapped,
    appRoot    : process.env.PARITY_APP_ROOT || process.cwd(),
    target     : state.target,
    wrappable  : Object.keys(WRAPPABLE),
    armed      : !!read.arming,
    arming     : read.arming,
    usesSpent  : state.used,
    faultFile  : process.env.PARITY_MODEL_FAULT_FILE || null,
    logFile    : process.env.PARITY_MODEL_FAULT_LOG || null,
    diagnostic : state.diagnostic
  };
}

// ---------------------------------------------------------------------------
// Public API, and who actually consumes each part.
//
//   test/parity/server.js loads this module as a PRELOAD, so `install()` runs
//     by itself at the bottom of this file; the launcher calls nothing here.
//   capture.js and replay.js require it in THEIR OWN process for `arming()`
//     only - so the arming document's field names live here and nowhere else -
//     and immediately call `restore()`, because nothing in a driver process
//     should stay patched. They write the arming file between steps.
//   `calls()`, `faultedCalls()`, `reset()` and `flush()` read the in-memory
//     record, which is reachable only INSIDE the server process. The drivers
//     are separate processes, so they read the EVIDENCE LOG at
//     PARITY_MODEL_FAULT_LOG instead - `collectEvidence` in both of them parses
//     it, and replay's auth check reconciles a scenario's armed steps against
//     the `faulted` records it holds. The in-process accessors exist for a
//     harness that runs in the same process as the application.
// ---------------------------------------------------------------------------
module.exports = {
  install : install,
  restore : restore,
  status  : status,

  // The arming document a harness writes. Exported as a builder so that
  // capture.js and replay.js do not each hard-code the field names.
  arming : function(spec) {
    var out = { fault: 'reject' };
    var source = spec || {};

    out.model     = source.model === undefined ? DEFAULT_MODEL : source.model;
    out.method    = source.method === undefined ? DEFAULT_METHOD : source.method;
    out.remaining = source.remaining === undefined ? 1 : source.remaining;

    if (source.id !== undefined && source.id !== null) {
      out.id = String(source.id);
    }
    if (source.message !== undefined) {
      out.message = source.message;
    }
    if (source.errorName !== undefined) {
      out.errorName = source.errorName;
    }

    return out;
  },

  // Evidence.
  calls : function() { return state.calls.slice(); },
  faultedCalls : function() {
    return state.calls.filter(function(entry) {
      return entry.event === 'faulted';
    });
  },
  reset : function() {
    state.calls = [];
    state.armDiagnostic = null;
    return null;
  },
  flush : flush,

  // Field names and defaults, so a harness can build an arming without
  // duplicating any literal from this file.
  DEFAULT_MODEL      : DEFAULT_MODEL,
  DEFAULT_METHOD     : DEFAULT_METHOD,
  DEFAULT_MESSAGE    : DEFAULT_MESSAGE,
  DEFAULT_ERROR_NAME : DEFAULT_ERROR_NAME
};

// ---------------------------------------------------------------------------
// Auto-install on first require, so a preload needs no argument and no call.
// Wrapped so nothing here can throw out of the load: this module is required
// before app.js, and a throw at this point would take the server down before it
// ever started.
// ---------------------------------------------------------------------------
try {
  install();
}
catch (e) {
  try {
    note('install-failed', { error: e && e.message ? e.message : String(e) });
  }
  catch (ignored) {
    // The evidence log itself is unavailable, so the failure is kept on the
    // state object where status().diagnostic surfaces it. A plain assignment
    // cannot throw, which is what makes this the last layer.
    state.diagnostic = 'install failed and could not be logged: ' +
      (e && e.message ? e.message : String(e)) +
      ' (secondary failure: ' +
      (ignored && ignored.message ? ignored.message : String(ignored)) + ')';
  }
}
