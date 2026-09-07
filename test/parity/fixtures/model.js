'use strict';

// The model-boundary fault fixture - the one way a database failure is made to
// happen on purpose, so that the auth scheme's fifth outcome and the folder
// controller's unknown-write-failure branch can be observed rather than
// asserted in prose.
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
// A SECOND UNREACHABLE BRANCH needs the same gate, and it is why this fixture
// faults instance methods as well as statics. `lib/controllers/folders.js`'s
// `create` splits its save failure two ways: `err.code === 11000` answers 409,
// and every other write failure answers 500 through that file's own error
// mapping. The duplicate side reaches itself - a colliding name is all it takes
// - but nothing a request can do makes a healthy database fail a folder write
// for any OTHER reason, so the 500 side was reported as untested rather than as
// working. Faulting `folder.save(callback)` is what closes that, and the shape
// of the injected error matters as much as its existence: its `code` must NOT be
// 11000, because that value is exactly what selects the other branch.
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
// This file must NOT require the models it patches. AAP §0.6.5 Defect 2 is
// measured: `mongoose-schema-extend` installs a Proxy polyfill that REPLACES
// the global `Object.getPrototypeOf`, after which requiring `@hapi/hapi` throws
// `Error: Schema can only contain plain objects` - and the version bump to
// 21.4.10 does not fix it. `lib/models/user` pulls in `mongoose`, so requiring
// it from a preload would load that polyfill BEFORE `@hapi/hapi`, and the
// application would die at startup with an error that looks nothing like its
// cause. `config/app.config.js:3-7` documents the same ordering rule in code.
//
// So neither model is loaded here. Each is wrapped when the application loads
// it ITSELF, through the one line that publishes it:
//
//   app.js  `User = require('./lib/models/user');`     (target :367, baseline :290)
//   app.js  `Folder = require('./lib/models/folder');` (target :374)
//
// Each is an UNDECLARED assignment, so the line writes a property on the global
// object - which app.js confirms by naming both in `gleak.ignore("User", ...)`
// and `gleak.ignore("Folder", ...)`. The consumers read the bare identifiers,
// `await User.findById(userId)` in the auth scheme and `new Folder(...)` in
// lib/controllers/folders.js, so the globals are exactly the bindings under
// test. This fixture therefore installs an accessor for each watched global,
// wraps the export IN PLACE when the application assigns it, and then replaces
// the accessor with an ordinary writable property. Both trees assign them at the
// same point in the same way, so one mechanism drives both.
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
// evidence it exists to produce. The accessors touch nothing but one named
// property each on one object - the global - and appear in no stack at all.
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
// WHY AN INSTANCE METHOD IS WRAPPED SOMEWHERE ELSE, AND WHERE
// ===========================================================================
// `User.findById` is a STATIC: an own, enumerable property of the object the
// module exports, so wrapping it is one assignment onto that object.
// `folder.save(callback)` is not. `lib/models/folder.js` defines no `save` at
// all - it is mongoose's `Model.prototype.save`, reached through the document's
// prototype chain - so there is no property on the export to overwrite, and the
// wrap has to be installed on the prototype the DOCUMENT inherits from.
//
// Which object that is took measuring rather than assuming, and the obvious
// answer is wrong. `lib/models/folder.js:188` exports `Folder.publicModel`, and
// `lib/models/model.js:180-182` defines that as a PLAIN FUNCTION:
//
//   Model = function(doc) { return new model(doc); };
//
// It is a factory that returns a document of the private mongoose model, so
// `new Folder(payload)` yields an instance of THAT model, and the export's own
// `.prototype` is an ordinary empty object which neither has nor inherits
// `save`. MEASURED on this tree: `typeof require('lib/models/folder').prototype
// .save === 'undefined'`, while `Object.getPrototypeOf(new Folder({})) ===
// Folder.model.prototype` and `save` is present there by inheritance. A wrap
// installed on the export's prototype would therefore be a silent no-op - the
// fixture would report itself armed and nothing would ever fault.
//
// So the holder is RESOLVED, in this order, and which route was taken is
// recorded in the evidence log and in `status()`:
//
//   1. the export's own `.prototype`, when the named method is reachable there -
//      which is the shape of a model that exports its mongoose model directly;
//   2. `exported.model.prototype`, the private model `lib/models/model.js:105-107`
//      exposes as `.model` when NODE_ENV is 'test' or 'migration'. The parity
//      launcher runs `NODE_ENV=test` (test/parity/server.js:167), so this is the
//      route a parity run takes;
//   3. failing both, the prototype of one throwaway document built through the
//      export itself. Constructing a document runs schema defaults and no I/O,
//      and it is the last resort precisely because it is the only route that
//      needs the model to be instantiable.
//
// BECAUSE `save` IS INHERITED, THE WRAP CREATES AN OWN PROPERTY THAT SHADOWS
// IT, and that is what `restore()` has to undo correctly: reassigning the
// captured original would leave a permanent own `save` on that prototype for
// every later consumer in the process, which is a behaviour change this fixture
// is not allowed to make. So `state.originals` records whether the property was
// own BEFORE the wrap, and `restore()` deletes it when it was not.
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
//                             claim backed by an artifact. Each line carries
//                             the record's POSITION in this process rather than
//                             an instant, so the artifact is reproducible; see
//                             `nextSequence`. A strict no-op when unset.
//
// ===========================================================================
// THE ARMING DOCUMENT
// ===========================================================================
//   {
//     "fault"     : "reject",      required; the only supported action
//     "model"     : "user",        optional; 'user' or 'folder', per WRAPPABLE
//     "method"    : "findById",    optional; defaults to findById
//     "id"        : "0000...0101", optional; when set, only this id faults
//     "remaining" : 1,             optional; defaults to 1. -1 means unbounded
//     "message"   : "...",         optional; the rejection's message
//     "errorName" : "MongoError",  optional; the rejection's `name`
//     "errorCode" : 121            optional; the rejection's `code`
//   }
//
// `model` and `method` default to `user` and `findById`, so an arming that names
// neither still means the auth-scheme lookup and nothing else. The folder
// instance fault is therefore always explicit:
//
//   { "fault": "reject", "model": "folder", "method": "save", "remaining": 1 }
//
// `errorCode` exists because for one target the code IS the behaviour: the
// branch under test in `lib/controllers/folders.js` is selected by
// `err.code !== 11000`, and its sibling by `=== 11000`. Each wrappable method
// carries its own default code (`faultCode` in the table below), so an arming
// that omits the field still reaches the intended branch; setting it is how a
// harness would deliberately drive the other one.
//
// `id` narrows a static call by its first argument and an instance call by the
// document's own `_id`, which is the same question asked of the two shapes.
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
//   No interception on a path the whole application traverses. Each accessor is
//     on one named property of the global object and each is replaced by a plain
//     property as soon as the application assigns it; nothing here is in the call
//     path of a require, and nothing is in the call path of a request or a
//     response except the wrapped methods themselves, which are exactly the
//     methods a fault has to be able to reach. No stack trace and no timing
//     anywhere else in the process is altered by this file's presence.
//   No write to the arming file, the application tree, or anything outside the
//     evidence log the launcher hands it.
//   No throw out of load. A preload that throws takes the server down before
//     app.js runs, so the auto-install at the bottom is wrapped and a failure
//     is recorded in `status().diagnostic` instead.
//   No `url.parse` and nothing else that emits a deprecation warning: this
//     process's stderr is the stream AAP §0.9.3's zero-warning gate inspects.
//   No clock read into anything that is persisted. The evidence log is RETAINED
//     parity evidence, so two runs of one tree have to produce the same bytes
//     for the same behaviour; see `nextSequence`, which is what a record
//     carries instead of an instant.

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
//
// `methods` are STATICS, wrapped on the export object itself.
// `prototypeMethods` are INSTANCE methods, wrapped on the prototype the
// documents inherit from - a separate key rather than more entries in `methods`
// because the two are found in different places, called with different argument
// shapes, and restored differently. Keeping them apart is also what leaves the
// `user`/`findById` path byte-for-byte as it was.
//
// `faultCode` is the `code` the injected error carries when an arming does not
// name one. For `folder`/`save` that value is load-bearing rather than
// cosmetic: `lib/controllers/folders.js` routes on `err.code === 11000`, so the
// default is deliberately a different, real MongoDB write-error code - 121,
// DocumentValidationFailure - which selects the unknown-failure branch. The
// injected error also carries `parityInjected: true`, so its provenance is never
// in doubt.
// ---------------------------------------------------------------------------
var WRAPPABLE = {
  user: {
    globalName    : 'User',
    relativePath  : 'lib/models/user',
    methods       : ['findById'],
    message       : 'parity fixture: injected data-store failure on ' +
      'User.findById, so that the auth scheme reaches its lookup-error outcome'
  },
  folder: {
    globalName       : 'Folder',
    relativePath     : 'lib/models/folder',
    methods          : [],
    prototypeMethods : ['save'],
    faultCode        : 121,
    // A write that the server rejected, which is what a coded write error is;
    // the module-wide default names a transport failure, and that shape does
    // not carry a `code` at all.
    errorName        : 'MongoServerError',
    message          : 'parity fixture: injected write failure on ' +
      'Folder.prototype.save with code 121 (not 11000), so that ' +
      'folders.create reaches its unknown-failure branch rather than its ' +
      'duplicate-name branch'
  }
};

var DEFAULT_MODEL   = 'user';
var DEFAULT_METHOD  = 'findById';
var DEFAULT_MESSAGE = WRAPPABLE[DEFAULT_MODEL].message;
var DEFAULT_ERROR_NAME = 'MongoNetworkError';

var state = {
  installed  : false,
  // Per-watched-model state, keyed by the WRAPPABLE key. Each entry holds:
  //   waiting   - whether the global accessor is in place, waiting for the
  //               application to publish this model;
  //   published - what the application assigned, held while the accessor is in
  //               place so a read between the assignment and the replacement
  //               returns it unchanged;
  //   wrapped   - whether anything on it is wrapped;
  //   target    - the resolved model file, for provenance;
  //   via       - how the prototype holder was found, when there is one.
  // `status()`'s flat `waiting` and `wrapped` fields are computed over this map
  // rather than stored, so there is one place a model's state lives and no
  // second copy to fall out of step. `target` is stored, because it names the
  // default model's file and that is what the auth-scheme evidence refers to.
  models     : {},
  target     : null,
  originals  : {},
  calls      : [],
  // Records in process order, and the only ordering channel a record carries.
  // Never cleared by `reset()` - see `nextSequence`.
  sequence   : 0,
  armToken   : null,
  used       : 0,
  armDiagnostic : null,
  diagnostic : null
};

/**
 * The per-model state entry, created on first use.
 *
 * One function rather than an initializer loop so that `restore()` can clear
 * the map wholesale and every later reader still finds a well-formed entry.
 *
 * @param {string} model The key in WRAPPABLE.
 * @returns {Object} The entry, held on `state.models`.
 */
function modelState(model) {
  if (!state.models[model]) {
    state.models[model] = {
      waiting   : false,
      wrapped   : false,
      published : undefined,
      target    : null,
      via       : null
    };
  }

  return state.models[model];
}

// ---------------------------------------------------------------------------
// Evidence.
// ---------------------------------------------------------------------------

/**
 * Mints the ordering stamp a record carries.
 *
 * A WALL-CLOCK INSTANT CANNOT BE PERSISTED HERE, and that is the whole reason
 * this function exists. Every record this fixture writes lands in the file at
 * PARITY_MODEL_FAULT_LOG, and that file is RETAINED parity evidence: the
 * drivers are separate processes, so `collectEvidence` in capture.js and
 * replay.js parses that log as its only view of what this fixture did, and
 * replay reconciles a scenario's armed steps against the `faulted` records it
 * holds. An earlier revision stamped `new Date().toISOString()` on every
 * record, which meant two runs of an identical tree produced different
 * evidence BYTES for identical behaviour - so a reviewer comparing two runs
 * read a difference that says nothing, and no byte comparison of the artifact
 * could mean anything. The same reasoning that keeps the arming counter in
 * this process rather than in the arming file applies to the log: "no writes
 * and no clock".
 *
 * A monotonic per-process counter carries what the consumers actually need.
 * Records are appended in order, so identity plus order is the whole contract,
 * and the counter supplies the order without reading anything outside the
 * process. It is NOT reset by `reset()`: a flush after a reset still writes
 * every record it still holds, and a re-used log file cannot end up with two
 * records claiming the same position.
 *
 * @returns {number} The next position, counting from 0 within this process.
 */
function nextSequence() {
  var position = state.sequence;

  state.sequence = state.sequence + 1;

  return position;
}

/**
 * Appends one record to the in-memory log and, when a log path is configured,
 * to the file.
 *
 * The caller's fields are copied rather than used in place, and the copy is
 * stamped with its position from `nextSequence` - which is the record's only
 * ordering field, and deliberately not an instant.
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

  entry.sequence = nextSequence();
  state.calls.push(entry);

  target = process.env.PARITY_MODEL_FAULT_LOG;
  if (!target) {
    return;
  }

  try {
    fs.appendFileSync(target, JSON.stringify(entry) + '\n');
  }
  catch (e) {
    // Pushed straight onto the in-memory record rather than passed back
    // through `record`, which would attempt the append that just failed and
    // re-enter this catch. It is stamped the same way so the two paths produce
    // one shape, and `flush` can write this record out with the rest.
    state.calls.push({
      event    : 'log-append-failed',
      error    : e && e.message ? e.message : String(e),
      sequence : nextSequence()
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
 * The records are re-encoded exactly as they are held, so a rewritten log
 * carries the same shape - and, for one behaviour, the same bytes - as the
 * appended one: nothing is stamped at flush time that was not stamped when the
 * record was made, which is what keeps the artifact reproducible whichever way
 * it was written.
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
      event    : 'log-flush-failed',
      error    : e && e.message ? e.message : String(e),
      sequence : nextSequence()
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
 * Builds the error one faulted call raises.
 *
 * The three shaping fields all fall back to the wrappable entry's own defaults
 * before the module-wide ones, which is what lets `folder`/`save` carry a
 * `code` that selects the branch it exists to reach without every arming having
 * to name it. `parityInjected` marks provenance so an error read out of a log or
 * a response can never be mistaken for a real driver error.
 *
 * @param {string} model The WRAPPABLE key.
 * @param {Object} arming The arming document in force.
 * @returns {Error}
 */
function injectedError(model, arming) {
  var entry = WRAPPABLE[model] || {};
  var error = new Error(arming.message || entry.message || DEFAULT_MESSAGE);
  var code  = arming.errorCode === undefined ? entry.faultCode : arming.errorCode;

  error.name = String(arming.errorName || entry.errorName || DEFAULT_ERROR_NAME);

  if (code !== undefined && code !== null) {
    error.code = code;
  }

  error.parityInjected = true;

  return error;
}

/**
 * Builds the replacement for one model STATIC.
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

    error = injectedError(model, decision.arming);

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
 * Builds the replacement for one model INSTANCE method.
 *
 * Three things differ from the static wrapper, and each is forced by the shape
 * of the call it intercepts rather than chosen:
 *
 *   The callback is the LAST argument and there may be only one of it -
 *   `folder.save(cb)` - so it is found by testing that argument for a function
 *   instead of by counting arguments. `save(options, cb)` and `save()` are
 *   both covered by the same test.
 *
 *   The id keyed on is the DOCUMENT's `_id`, read off `this`, because an
 *   instance method's first argument is not an identifier. That keeps
 *   `arming.id` meaning the same thing for both shapes: which document the
 *   fault is allowed to land on.
 *
 *   With a callback the return value is `undefined`, which is what mongoose's
 *   real `save` returns in that shape: `Model.prototype.save`
 *   (node_modules/mongoose/lib/model.js:500-525) hands off to
 *   `promiseOrCallback`, whose callback branch returns the inner call's value
 *   and never a promise. Returning a rejected promise here as well - which is
 *   right for the static, whose two trees call it two ways - would hand the
 *   caller a value the genuine method never produces. Without a callback a
 *   rejected promise IS the genuine shape, and it carries the same no-op
 *   `catch` as the static's for the same reason: `lib/controllers/folders.js`'s
 *   `update` awaits it, but nothing may assume every caller does.
 *
 * @param {string} model
 * @param {string} method
 * @param {function} original
 * @returns {function}
 */
function faultingPrototypeMethod(model, method, original) {
  var replacement = function() {
    var last     = arguments.length ? arguments[arguments.length - 1] : null;
    var callback = typeof last === 'function' ? last : null;
    var id       = this && this._id !== undefined && this._id !== null
      ? String(this._id)
      : undefined;
    var decision = decide(model, method, id);
    var error;
    var rejected;

    if (!decision.fault) {
      if (decision.arming) {
        record({
          event  : 'passed-through',
          model  : model,
          method : method,
          id     : id === undefined ? null : id,
          reason : decision.reason
        });
      }

      return original.apply(this, arguments);
    }

    error = injectedError(model, decision.arming);

    record({
      event      : 'faulted',
      model      : model,
      method     : method,
      id         : id === undefined ? null : id,
      shape      : callback ? 'callback' : 'promise',
      errorName  : error.name,
      errorCode  : error.code === undefined ? null : error.code,
      message    : error.message,
      usesSpent  : state.used
    });

    if (callback) {
      // `nextTick` rather than a synchronous call: the real save never calls
      // back before it returns, and a callback that ran first would see the
      // caller's own bindings unassigned.
      process.nextTick(function() {
        callback(error);
      });

      return undefined;
    }

    rejected = Promise.reject(error);
    rejected.catch(function() {});

    return rejected;
  };

  replacement.parityFixture = true;

  return replacement;
}

/**
 * Finds the object that actually holds the instance methods of one model, and
 * says how it was found.
 *
 * The three routes and why the first one is not enough on its own are set out
 * in WHY AN INSTANCE METHOD IS WRAPPED SOMEWHERE ELSE at the top of this file:
 * this repository's model exports are factory FUNCTIONS whose own `.prototype`
 * carries nothing, so assuming route 1 would install a wrap that never runs.
 *
 * @param {string} model The key in WRAPPABLE.
 * @param {Object} exported The module's exports.
 * @param {Array.<string>} methods The instance methods that must be reachable.
 * @returns {?{holder: Object, via: string}}
 */
function resolvePrototypeHolder(model, exported, methods) {
  var candidates = [];
  var probe;
  var i;

  function holds(candidate) {
    var j;

    if (!candidate) {
      return false;
    }

    for (j = 0; j < methods.length; j++) {
      if (typeof candidate[methods[j]] !== 'function') {
        return false;
      }
    }

    return true;
  }

  candidates.push({ holder: exported.prototype, via: 'export-prototype' });

  if (typeof exported.model === 'function') {
    candidates.push({
      holder : exported.model.prototype,
      via    : 'private-model-prototype'
    });
  }

  for (i = 0; i < candidates.length; i++) {
    if (holds(candidates[i].holder)) {
      return candidates[i];
    }
  }

  // Last resort: one throwaway document, built through the export itself. This
  // runs schema defaults and performs no I/O, and it is last precisely because
  // it is the only route that requires the model to be instantiable.
  try {
    probe = new exported({});
  }
  catch (e) {
    note('prototype-probe-failed', {
      model : model,
      error : e && e.message ? e.message : String(e)
    });
    return null;
  }

  if (probe && holds(Object.getPrototypeOf(probe))) {
    return {
      holder : Object.getPrototypeOf(probe),
      via    : 'instance-prototype'
    };
  }

  return null;
}

/**
 * Wraps the methods of one freshly required model export.
 *
 * Statics are wrapped on the export object; instance methods are wrapped on the
 * prototype the documents inherit from, resolved by `resolvePrototypeHolder`.
 * Every wrap records, alongside the original, whether the property was the
 * holder's OWN before the wrap - because an inherited method is shadowed rather
 * than replaced, and `restore` has to delete the shadow instead of reassigning
 * it.
 *
 * @param {string} model The key in WRAPPABLE.
 * @param {Object} exported The module's exports, as the application received it.
 * @returns {boolean} Whether anything was wrapped.
 */
function wrapModel(model, exported) {
  var entry = WRAPPABLE[model];
  var methods = entry.methods || [];
  var prototypeMethods = entry.prototypeMethods || [];
  var wrappedAny = false;
  var resolved;
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

    state.originals[model + '.' + name] = {
      holder   : exported,
      method   : name,
      original : original,
      wasOwn   : Object.prototype.hasOwnProperty.call(exported, name),
      kind     : 'static'
    };
    exported[name] = faultingMethod(model, name, original);
    wrappedAny = true;
  }

  if (prototypeMethods.length) {
    resolved = resolvePrototypeHolder(model, exported, prototypeMethods);

    if (!resolved) {
      note('prototype-holder-unresolved', {
        model   : model,
        methods : prototypeMethods
      });
    }
    else {
      modelState(model).via = resolved.via;

      for (i = 0; i < prototypeMethods.length; i++) {
        name     = prototypeMethods[i];
        original = resolved.holder[name];

        if (typeof original !== 'function') {
          note('model-method-absent', {
            model  : model,
            method : name,
            kind   : 'prototype'
          });
          continue;
        }

        if (original.parityFixture) {
          wrappedAny = true;
          continue;
        }

        state.originals[model + '.prototype.' + name] = {
          holder   : resolved.holder,
          method   : name,
          original : original,
          // False for a mongoose `save`, which is inherited from
          // Model.prototype: the wrap below creates an own property that
          // shadows it, and `restore` deletes that property rather than
          // leaving a permanent own copy behind.
          wasOwn   : Object.prototype.hasOwnProperty.call(resolved.holder, name),
          kind     : 'prototype',
          via      : resolved.via
        };
        resolved.holder[name] = faultingPrototypeMethod(model, name, original);
        wrappedAny = true;
      }
    }
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
 * Installs the global accessor that wraps one model when the application
 * publishes it. Called once per WRAPPABLE entry, each keeping its own state.
 *
 * `app.js` assigns the undeclared `User` and `Folder`, each of which writes a
 * property on the global object. The setter wraps the assigned export IN PLACE -
 * so every consumer of `require('lib/models/user')` or
 * `require('lib/models/folder')` sees the wrap, not just the global - and then
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
  var name  = WRAPPABLE[model].globalName;
  var entry = modelState(model);
  var existing;

  if (entry.waiting || entry.wrapped) {
    return true;
  }

  // A process that already published the model before this fixture loaded -
  // not the preload case, but a harness that required the fixture late - is
  // wrapped immediately rather than left unwrapped waiting for an assignment
  // that has already happened.
  existing = globalThis[name];
  if (existing) {
    entry.wrapped = wrapModel(model, existing);
    if (entry.wrapped) {
      note('model-wrapped', {
        model : model,
        via   : 'already-published',
        how   : entry.via,
        file  : entry.target
      });
    }
    return entry.wrapped;
  }

  try {
    Object.defineProperty(globalThis, name, {
      configurable : true,
      enumerable   : true,
      get : function() {
        return entry.published;
      },
      set : function(value) {
        entry.published = value;

        try {
          entry.wrapped = wrapModel(model, value);
        }
        catch (e) {
          note('wrap-failed', {
            model : model,
            error : e && e.message ? e.message : String(e)
          });
          entry.wrapped = false;
        }

        // Put the global back to a plain property whatever happened, so a
        // failed wrap cannot leave an accessor in the application's way.
        Object.defineProperty(globalThis, name, {
          value        : value,
          writable     : true,
          enumerable   : true,
          configurable : true
        });
        entry.waiting = false;

        if (entry.wrapped) {
          note('model-wrapped', {
            model : model,
            via   : 'global-assignment',
            how   : entry.via,
            file  : entry.target
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

  entry.waiting = true;
  return true;
}

/**
 * Installs the fixture. Idempotent, and never throws.
 *
 * Every entry in WRAPPABLE is watched, not just the default one: an arming
 * names its model, and a model nobody watched could not be faulted however the
 * arming was written. `installed` is true when at least one global is watched
 * or already wrapped, which is the condition under which a fault can still be
 * injected in this process.
 *
 * @returns {Object} The same document `status()` returns.
 */
function install() {
  var appRoot;
  var models;
  var active = false;
  var i;
  var model;
  var entry;

  if (state.installed) {
    return status();
  }

  appRoot = process.env.PARITY_APP_ROOT || process.cwd();
  models  = Object.keys(WRAPPABLE);

  for (i = 0; i < models.length; i++) {
    model = models[i];
    entry = modelState(model);

    entry.target = resolveModel(appRoot, model);

    if (!entry.target) {
      note('model-path-unresolved', state.diagnostic);
    }

    if (watchGlobal(model)) {
      active = true;
    }
    else {
      note('model-watch-inactive', { model: model, detail: state.diagnostic });
    }
  }

  // Kept for the reporting the flat fields have always carried: `target` names
  // the default model's file, which is the one the auth-scheme evidence refers
  // to, and the per-model files are in `status().models`.
  state.target    = modelState(DEFAULT_MODEL).target;
  state.installed = active;

  if (!state.installed) {
    note('install-inactive', state.diagnostic);
  }

  return status();
}

/**
 * Puts the genuine model methods back and removes every global accessor.
 *
 * A wrapped STATIC was an own property of the export, so putting the original
 * back is an assignment. A wrapped INSTANCE method was inherited - mongoose's
 * `save` lives on `Model.prototype` - so the wrap created an own property that
 * SHADOWS it, and the assignment would leave that own property in place
 * forever, permanently changing the prototype for every later consumer in the
 * process. `wasOwn`, recorded at wrap time, is what distinguishes the two, and
 * a shadow is deleted rather than reassigned.
 *
 * @returns {Object} The same document `status()` returns.
 */
function restore() {
  var keys   = Object.keys(state.originals);
  var models = Object.keys(WRAPPABLE);
  var i;
  var entry;
  var name;

  for (i = 0; i < keys.length; i++) {
    entry = state.originals[keys[i]];

    if (entry.wasOwn) {
      entry.holder[entry.method] = entry.original;
    }
    else {
      try {
        delete entry.holder[entry.method];
      }
      catch (e) {
        // A non-configurable property cannot be deleted, and leaving the wrap
        // in place would be worse than leaving the original own copy: fall
        // back to the assignment and record that the prototype is no longer
        // exactly as it was found.
        entry.holder[entry.method] = entry.original;
        state.diagnostic = keys[i] + ' could not be deleted (' +
          (e && e.message ? e.message : String(e)) + '), so the original was ' +
          'reassigned and now stands as an own property of its holder';
      }
    }
  }

  for (i = 0; i < models.length; i++) {
    name = WRAPPABLE[models[i]].globalName;

    if (modelState(models[i]).waiting) {
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
  }

  state.originals = {};
  state.models    = {};
  state.installed = false;
  state.armToken  = null;
  state.used      = 0;

  return status();
}

/**
 * What is wrapped, what is armed, and why not when it is not.
 *
 * The flat `waiting`, `wrapped` and `target` fields are retained with the
 * meanings they have always had, generalized over the watched set: `waiting` is
 * true while ANY watched global is still expecting its assignment, `wrapped` is
 * true once ANY watched model has been wrapped, and `target` names the default
 * model's file. `models` carries the same three per model, plus `via` - which
 * route `resolvePrototypeHolder` took - so a reviewer can tell a fixture that
 * wrapped one model from one that wrapped both.
 *
 * @returns {Object}
 */
function status() {
  var read   = readArming();
  var models = Object.keys(WRAPPABLE);
  var detail = {};
  var waiting = false;
  var wrapped = false;
  var i;
  var entry;

  for (i = 0; i < models.length; i++) {
    entry = state.models[models[i]];

    detail[models[i]] = {
      waiting : !!(entry && entry.waiting),
      wrapped : !!(entry && entry.wrapped),
      target  : entry ? entry.target : null,
      via     : entry ? entry.via : null,
      methods : (WRAPPABLE[models[i]].methods || []).slice(),
      prototypeMethods : (WRAPPABLE[models[i]].prototypeMethods || []).slice()
    };

    waiting = waiting || detail[models[i]].waiting;
    wrapped = wrapped || detail[models[i]].wrapped;
  }

  return {
    installed  : state.installed,
    waiting    : waiting,
    wrapped    : wrapped,
    appRoot    : process.env.PARITY_APP_ROOT || process.cwd(),
    target     : state.target,
    wrappable  : models,
    models     : detail,
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
//   `status()` keeps every field it has ever reported, including `wrappable`,
//     which now lists two entries rather than one; `DEFAULT_MODEL` and
//     `DEFAULT_METHOD` still select `user` and `findById`, so an arming that
//     names no model still means the auth-scheme lookup. Nothing about the
//     arming document's existing field names changed.
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
    // Emitted only when a caller names it, so an arming that does not care
    // about the error's `code` is textually identical to what this builder has
    // always produced - which matters, because the fixture keys its use counter
    // on the arming's exact text.
    if (source.errorCode !== undefined) {
      out.errorCode = source.errorCode;
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
    // Clears the in-memory record and the once-per-cause arming diagnostic.
    // The record counter is deliberately left running: it is the position a
    // record occupies in THIS PROCESS, so resetting it would let two records
    // in one run - and two lines in one log file - claim the same position.
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
