/**
 * test/parity/storage.js - the storage and archive contract cases.
 *
 * Executes the persisted-data and file-format contract of `lib/util/file.js`
 * and `lib/workers/exports.js` against an isolated in-memory MongoDB and a
 * filesystem-backed S3 fixture, recording what each case MEASURED - keys
 * composed, buckets resolved, archive produced - and not a pass mark.
 *
 * INVOCATION
 *   node test/parity/storage.js [--app <path>] [--out <path>] [--help]
 *   PARITY_ALLOW_EXTERNAL_MONGO=1 node test/parity/mongo.js -- \
 *     node test/parity/storage.js
 *
 *   The first form starts and stops its own MongoDB; the second joins the
 *   lifecycle `test/parity/mongo.js` owns, which publishes PARITY_MONGO_URI.
 *   The opt-in is REQUIRED there: this run seeds and DELETES documents in
 *   whatever it connects to, and an address found in the environment is
 *   indistinguishable from one exported by hand. Such an address must carry
 *   the disposable prefix too, and every refusal precedes any connection.
 *
 *   Progress goes to stderr; stdout carries the JSON result alone, and only
 *   when `--out` is absent - loading the controllers prints an SDK notice and
 *   a queue line the artifact stream is kept clear of by construction.
 *
 * ARTIFACT
 *   `test/parity/storage-result.json`: `{tool, nodeFlags, volatile, nodeEnv,
 *   dataStore, total, passed, failed, notRun, cases, warnings, warningGate,
 *   findings, gate, provenance}`. Each case carries its own `evidence`, read
 *   back from the store, the document or the fixture's call log rather than
 *   copied from the expectation, and `provenance` is the shared contract in
 *   `test/parity/manifest.js` - never a path, port, pid or database name.
 *
 * THE KEY IS A CONTENT HASH, SO A DIGEST CHANGE FAILS SILENTLY
 *   `lib/util/file.js` streams an upload through `crypto.createHash('sha1')`
 *   and uses the hex digest as the object's `Key`, so changing the algorithm,
 *   the encoding or the bytes leaves every object written earlier unreachable
 *   while every new write still looks perfect - no error, only files that
 *   cannot be found. A round trip cannot detect that, both halves using the
 *   same digest; the pre-migration cases can, reading objects and File
 *   documents `test/parity/seed.js` created with fixed digests. So every
 *   payload is a committed byte literal, every expected key and digest is
 *   computed here and re-checked at load time, and only the snapshot cases
 *   read a clock, to MEASURE that the module's own delay elapsed.
 *
 * ORDERING, WHICH IS LOAD-BEARING
 *   Nothing application-facing is required at module scope. `config` freezes
 *   its values on first require, so the database address must reach
 *   NODE_CONFIG first; the S3 fixture must patch `AWS.S3` on the application's
 *   own `config/aws` before `lib/util/file.js` constructs a client from it;
 *   and the `File` model must be the undeclared global `app.js` assigns in
 *   `init()` before that module is required, or `new File()` reaches Node's
 *   built-in WHATWG `File` and fails naming neither.
 *
 * ISOLATION AND CLEANUP
 *   No real S3 and no network on any path: `test/parity/fixtures/aws.js` backs
 *   the client with a filesystem store, rooted by PARITY_S3_ROOT inside this
 *   run's scratch directory so its objects go with it. The directory is
 *   CREATED, never adopted, and its recursive removal is proven to target it
 *   by device and inode - a predictable name under a shared temporary
 *   directory may exist already, or be another user's symlink.
 *
 * THE ARCHIVE IS READ TWICE, AND ONLY ONE READ IS THE VERDICT
 *   `probeApplicationRead` reads through the `adm-zip` the tree under test
 *   declares, with no bypass, and `archive-layout` fails on THAT read: an
 *   archive the repository's own ZIP library cannot open is a broken persisted
 *   format whatever its layout. `readArchiveEntries` then inflates
 *   `entry.getCompressedData()` with core zlib, so the layout assertions still
 *   run and the failure arrives with a diagnosis - as EVIDENCE.
 *
 * THE EXIT PREDICATE
 *   ONE FAILURE SET, ASSEMBLED ONCE, READ ONCE. `run()` builds `result.gate`
 *   from every failure observed - failed cases, captured process warnings,
 *   recorded findings, callbacks that delivered more than once, failed
 *   teardowns, an unwritable artifact - and `main()` derives the exit code
 *   from `result.gate.passed` alone; `total`, `passed` and `failed` stay the
 *   CASE TALLY. No warning allowance list exists and none may be added:
 *   `test/parity/warning-policy.js` owns that bar. A TIMED-OUT case stops the
 *   run and every case after it is recorded `not-run`, apart from `failed`.
 *   Exit 0 on an empty failure set, 1 otherwise, 2 on a usage error.
 */

var assert   = require('node:assert');
var crypto   = require('node:crypto');
var fs       = require('node:fs');
var os       = require('node:os');
var path     = require('node:path');
var zlib     = require('node:zlib');
var Readable = require('node:stream').Readable;

// Sibling tooling. Both are declared dependencies of this file and neither
// starts anything at require time: mongo.js runs `main` only under direct
// execution, and seed.js resolves `config` and the models lazily so that
// requiring it for its fixture values cannot freeze the configuration before
// the address is published.
var mongo = require('./mongo');
var seed  = require('./seed');

// THE SHARED PROVENANCE CONTRACT, from the one place it lives. Requiring
// test/parity/manifest.js costs nothing: it is Node-core-only at module scope
// and self-executes only under `require.main === module`, so it neither parses
// routes, connects to anything nor spawns a process. Taking the contract from
// there rather than re-deriving it here is what keeps this file's evidence
// identity identical in kind to every sibling artifact's - a second copy of
// these guarantees would drift from the first.
var provenance = require('./manifest').provenance;

// The zero-warning gate, stated once for all four parity gates. What counts as
// a notice, which flags the measurement requires, and the fact that there are
// no allowances are decided there and not here.
var warningPolicy = require('./warning-policy');

// Under direct execution the flags come first. This file loads the application
// modules it exercises INTO ITS OWN PROCESS, so its own stderr is the stream
// the zero-warning gate judges, and a pending deprecation is silent without
// --pending-deprecation: a run that lacks the flags cannot tell "nothing was
// emitted" from "nothing was asked for". So it re-executes itself once with
// them. A re-execution that still lacks them fails closed - the gate reports
// the missing evidence and the run fails on it.
if (require.main === module) {
  warningPolicy.elevate();
}

// The tooling's own mongoose, which is the instance seed.js registers its
// models on. `connectAll` below reconciles it with the application's when
// `--app` points at a different worktree; see the note there.
var mongoose = require('mongoose');

var LOG_PREFIX = '[parity:storage] ';

// This tool's own repository root, two levels above test/parity/. The default
// `--app`, and the tree whose `adm-zip` and `archiver` are used when no other
// tree is named.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

var EXIT_OK    = 0;
var EXIT_ERROR = 1;
var EXIT_USAGE = 2;

// The artifact name recorded in provenance when the result goes to stdout
// instead of to `--out`. A block names the artifact it describes, and a run
// with no output file still describes one thing - this file's result - so the
// name is a stable label rather than a path, a stream name or nothing at all.
var DEFAULT_ARTIFACT = 'storage-contract.json';

// `lib/util/file.js`'s `uploadSnapshot` waits 1000 ms in a `setTimeout` before
// it even looks for the snapshot. The snapshot cases must outlast that rather
// than shorten it, so every case gets a ceiling comfortably above it and the
// snapshot cases get their own.
var CASE_TIMEOUT_MS     = 20000;
var SNAPSHOT_TIMEOUT_MS = 30000;

// The fields two runs of this harness against the SAME tree are expected to
// differ in. Every one is a physical fact of a single run rather than a
// statement about the storage contract: `appRoot` is a per-clone absolute path,
// `uri` carries an ephemeral port and a per-run database name, `durationMs` is
// wall clock, and `stack` is a set of frames carrying absolute paths and the
// line numbers of THIS file - so leaving it in would make the digest change
// whenever a comment here moved, which is the opposite of what it is for. A
// failed case's `error` message stays inside the digest, and that is where the
// diagnosis lives.
var VOLATILE_FIELDS = ['appRoot', 'uri', 'durationMs', 'stack', 'digest'];

// What the digest is taken over: the volatile fields above, plus `provenance`.
//
// PROVENANCE IS EXCLUDED BECAUSE THE OTHER DIGEST COVERS IT, and getting this
// wrong made the committed number unrecomputable. `provenance.attach` writes
// the block AFTER the digest exists and hash-links it in the opposite
// direction - its `payloadDigest` covers the artifact WITHOUT its provenance
// and WITH this `digest` field - so a number taken over a payload that
// included the block could never be reproduced from the delivered bytes.
// Measured on the artifact this replaces: the stored value was
// a4c96245eb21..., recomputing it from the committed file gave 73b10ebfb378...,
// and recomputing with the block removed gave 1820db9efac7... - three different
// answers, none of which a reviewer could act on. Excluding it here makes the
// pair complete and non-circular: `digest` certifies the result, and
// `provenance.payloadDigest` certifies the result plus that digest.
//
// Anything NOT on this list is part of the digest, so a change to the contract
// cannot hide behind normalization.
var DIGEST_EXCLUDED_FIELDS = VOLATILE_FIELDS.concat(['provenance']);

// `uploadSnapshot`'s own `setTimeout` delay, as a value the assertion can name.
var SNAPSHOT_DELAY_MS = 1000;

// The fixture delivers every callback through setImmediate, so a state change
// an assertion waits for is at most a few ticks away. The poll exists for the
// two paths that report nothing back - `removeFile` without a callback, and the
// fire-and-forget unlink - and its ceiling is short because a miss means the
// behaviour is absent rather than slow.
var SETTLE_TIMEOUT_MS  = 5000;
var SETTLE_INTERVAL_MS = 10;

var USAGE = [
  'test/parity/storage.js - the storage and archive contract cases',
  '',
  'Runs the persisted-data and file-format contract of lib/util/file.js and',
  'lib/workers/exports.js against an isolated in-memory MongoDB and a',
  'filesystem-backed S3 fixture. AAP 0.6.7.',
  '',
  'OPTIONS',
  '  --app <path>  Root of the worktree under test. Defaults to this tool\'s',
  '                own repository root, two levels above test/parity/.',
  '  --out <path>  Write the JSON result here instead of to stdout. The',
  '                provenance record is embedded in the result either way, and',
  '                with --out it is also written to <path>.provenance.json',
  '                with a digest of the bytes as written.',
  '  --help, -h    This text.',
  '',
  'OPTION RULES',
  '  No option is repeatable: a second --app or --out is a usage error rather',
  '  than a last-one-wins. A value beginning with "-" is a usage error too, so',
  '  a missing value cannot swallow the following option.',
  '',
  'ENVIRONMENT',
  '  PARITY_MONGO_URI      When set - which is what test/parity/mongo.js exports',
  '                        to a command it spawns - the harness connects to that',
  '                        instance instead of starting one of its own. This run',
  '                        SEEDS AND DELETES documents in whatever it connects',
  '                        to, and an address arriving in the environment proves',
  '                        nothing about what it names, so this path ALWAYS',
  '                        requires the opt-in below, and the database must also',
  '                        carry the `parity_` prefix.',
  '  PARITY_ALLOW_EXTERNAL_MONGO',
  '                        Set to 1, yes or true to confirm that seeding and',
  '                        deleting in the database PARITY_MONGO_URI names is',
  '                        intended. Required for EVERY externally supplied',
  '                        address, whatever it is called. Not needed when this',
  '                        harness starts its own instance, because then the',
  '                        address is disposable by construction rather than by',
  '                        its name.',
  '  MONGOMS_SYSTEM_BINARY Honoured by test/parity/mongo.js; point it at an',
  '                        existing mongod on a host with no cached binary.',
  '',
  'EXIT CODES',
  '  0  the failure set is empty: every case passed, no process warning was',
  '     captured, no contract finding was recorded, no callback delivered',
  '     twice and every teardown succeeded',
  '  1  the failure set is not empty, or the run could not be completed. The',
  '     result artifact is written first either way, and every failure is',
  '     named on stderr with its kind and its owner',
  '  2  a usage error'
].join('\n');


// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * A usage or environment failure, distinguished from an assertion failure so
 * the CLI can answer 2 for "you called it wrong" and 1 for "the contract is
 * broken". Conflating the two would let a mistyped `--app` read as a storage
 * regression.
 *
 * @param {string} message
 * @constructor
 */
function ToolError(message) {
  Error.call(this, message);
  this.name    = 'ToolError';
  this.message = message;
  this.stack   = new Error(message).stack;
}

ToolError.prototype = Object.create(Error.prototype);
ToolError.prototype.constructor = ToolError;

/**
 * Writes one prefixed line to stderr.
 *
 * Every human-readable byte this file produces goes to stderr, because stdout
 * is the artifact stream. Nothing here writes to stdout except `emit`.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  process.stderr.write(LOG_PREFIX + message + '\n');
}


// ---------------------------------------------------------------------------
// The failure ledger and the exit predicate
// ---------------------------------------------------------------------------
// ONE AUTHORITATIVE FAILURE SET, AND ONE PLACE THAT READS IT.
//
// Four classes of failure are observed outside the case tally - a captured
// process warning, a recorded contract finding, a callback that delivered
// twice, and a failed stop, disconnect or removal. A gate that printed those to
// stderr and still exited 0 would report the defect in a stream nobody has to
// read and report success in the one every caller acts on.
//
// The contract this section implements: THIS TOOL MAY EXIT 0 ONLY WHEN ITS
// FAILURE SET IS EMPTY, and the exit code is derived from that set at exactly
// one place - `main`, from `result.gate.passed`. Seven kinds belong to the set:
//
//   case               a case's assertions failed, or it did not finish
//   warning            a process warning was captured during the run. There is
//                      no allowance list and none may be added: the AAP
//                      approves exactly two deviations - the
//                      lib/controllers/files.js image-stream response (AAP 0.7)
//                      and the `marked` audit high (AAP 0.5.1.4) - and neither
//                      is a warning, so no warning is approved
//   warning-gate       the shared zero-warning policy judged this run not-ok.
//                      It is a SEPARATE kind from `warning` because it fails
//                      for reasons a captured warning cannot express - the
//                      measurement flags not in force, output suppressed, a
//                      notice seen only by the stderr tee - and because the
//                      same notice reaching both collectors must read as one
//                      observation reported by two, not as two defects
//   finding            a case recorded a contract finding on the context
//   double-settlement  a callback adapter observed a second delivery
//   teardown           a stop, disconnect or removal operation failed, so the
//                      run may have left a live connection or a leftover behind
//   output             a requested artifact could not be written
//
// DIAGNOSTIC EVIDENCE IS STILL PRODUCED IN EVERY CASE. The artifact is emitted
// BEFORE the code is derived, every stderr note is kept, and a failing case
// still runs the rest of the suite - a storage regression is usually one cause
// with several symptoms and seeing all of them is what identifies it.
//
// `result.failed`, `result.passed` and `result.total` keep their meaning
// exactly: they are the CASE TALLY, not the verdict. A reader comparing two
// runs needs the tally to stay a tally.
//
// The ledger is module-scoped because the operations that observe a teardown
// failure or a second callback delivery - `removeScratch`, `disconnectAll`,
// `cleanupDocuments`, the per-case cleanup and the callback adapter - are
// reached from four different levels and cannot all be handed a collector.
// `beginLedger` therefore refuses to start a second concurrent run rather than
// silently interleaving two runs' failures.

/**
 * The kinds of entry the failure set admits. Named rather than spelled inline
 * so a reader of the artifact and a reader of this file are looking at the same
 * vocabulary.
 */
var FAILURE_KIND = Object.freeze({
  CASE              : 'case',
  WARNING           : 'warning',
  WARNING_GATE      : 'warning-gate',
  FINDING           : 'finding',
  DOUBLE_SETTLEMENT : 'double-settlement',
  TEARDOWN          : 'teardown',
  OUTPUT            : 'output'
});

/**
 * The run-scoped ledger, or null between runs.
 *
 * Holds what the helpers observe and the runner cannot see: teardown failures
 * and second callback deliveries.
 */
var ledger = null;

/**
 * Opens the ledger for one run.
 *
 * @returns {Object} The ledger.
 * @throws {ToolError} If a run is already in flight.
 */
function beginLedger() {
  if (ledger) {
    throw new ToolError(
      'a run is already in flight; this harness chdirs into the tree under ' +
      'test, patches the AWS namespace and installs a global `File`, so it is ' +
      'not re-entrant and two concurrent runs would report each other\'s ' +
      'failures'
    );
  }

  ledger = {
    // Gate entries observed outside a case: teardown failures, and late
    // callback deliveries.
    failures    : [],
    // Every extra callback delivery, whether or not a case owned it.
    settlements : [],
    // The case currently executing, so a second delivery can be attributed.
    activeCase  : null
  };

  return ledger;
}

/**
 * Closes the ledger.
 *
 * @returns {(Object|null)} The closed ledger.
 */
function endLedger() {
  var finished = ledger;

  if (finished) {
    // Marked rather than merely dropped, so an adapter still holding this
    // object by reference can tell that its run's verdict has been assembled
    // and escalate instead of writing into a record nothing will read again.
    finished.closed = true;
  }

  ledger = null;

  return finished;
}

/**
 * Lets already-scheduled callbacks and warnings reach their listeners.
 *
 * Called immediately before the verdict is assembled. Both classes of late
 * observation this harness accounts for - a callback delivering a second time
 * and a process warning - are DELIVERED ASYNCHRONOUSLY: `process.emitWarning`
 * schedules through the microtask queue, and a callback the application already
 * queued fires on a later turn. Assembling the verdict in the same turn the
 * last case finished would therefore read a record that is complete only by
 * luck of scheduling.
 *
 * Two `setImmediate` turns, because one drains what is pending now and the
 * second drains anything the first turn scheduled in its place. This is a
 * bounded, unconditional cost of a few milliseconds at the end of a run, not a
 * wait for something that may never arrive: a delivery later than this is
 * caught by the escalation in `recordDoubleSettlement` and
 * `guardLateWarnings`, which does not depend on timing at all.
 *
 * @returns {Promise<undefined>}
 */
async function quiesce() {
  await new Promise(function(resolve) { setImmediate(resolve); });
  await new Promise(function(resolve) { setImmediate(resolve); });

  return undefined;
}

/**
 * Records a failure the runner cannot observe for itself, and reports it.
 *
 * Called with the ledger closed - which happens when a sibling harness requires
 * this module for `assertArchiveLayout` and nothing else - it still writes the
 * note, because the evidence must not depend on a run being in flight.
 *
 * @param {string} kind One of FAILURE_KIND.
 * @param {string} subject What failed, one line.
 * @param {string} detail The measured cause.
 * @param {string} [owner] The file that must act; defaults to this harness.
 * @returns {Object} The entry.
 */
function recordFailure(kind, subject, detail, owner) {
  var entry = {
    kind    : kind,
    subject : subject,
    detail  : detail,
    owner   : owner || 'test/parity/storage.js'
  };

  if (ledger) {
    ledger.failures.push(entry);
  }

  return entry;
}

/**
 * Records a failed stop, disconnect or removal, and notes it on stderr.
 *
 * One place emits the note, in one shape - `WARNING: <subject>: <detail>` -
 * and the same observation reaches the verdict. A failed teardown is not a
 * cosmetic complaint: it means the run may have left a live connection, a live
 * process or a leftover file behind, and a gate that exits 0 in that state is
 * asserting something it did not establish.
 *
 * @param {string} subject
 * @param {*} cause An Error or a message.
 * @returns {Object} The entry.
 */
function recordTeardownFailure(subject, cause) {
  var detail = (cause && cause.message) || String(cause);

  note('WARNING: ' + subject + ': ' + detail);

  return recordFailure(FAILURE_KIND.TEARDOWN, subject, detail);
}

/**
 * Records a callback that delivered more than once.
 *
 * A second delivery CANNOT be turned into a rejection: the promise settled on
 * the first one and a settled promise is immutable, so the registry is the only
 * place the second delivery can be seen at all. `runCase` reads it back to fail
 * the owning case, and `buildGate` sweeps whatever no case claimed.
 *
 * `owner` IS THE CASE THAT CREATED THE ADAPTER, not the case running when the
 * second delivery arrived, and the difference decides which contract the report
 * names: a delivery that arrives late lands while some other case is running,
 * so reading the active case here would blame the wrong one. The owner is
 * captured when the adapter is created and travels with the entry.
 *
 * @param {(Object|null)} sink The ledger of the run that CREATED the adapter,
 *   handed in rather than read from module scope so a late delivery is
 *   accountable to its own run. A closed or absent sink escalates instead.
 * @param {number} calls How many times the callback has now fired.
 * @param {string} where The call site's description, for the report.
 * @param {(string|null|undefined)} owner The case that created the adapter;
 *   `undefined` is recorded as `null`.
 * @returns {Object} The entry.
 */
function recordDoubleSettlement(sink, calls, where, owner) {
  var entry = {
    case       : owner === undefined ? null : owner,
    where      : where,
    calls      : calls,
    // Set by runCase when it fails the case that owned this delivery, so the
    // end-of-run sweep reports only the deliveries that arrived too late for
    // their own case to claim them.
    attributed : false
  };

  // Reading the module-scoped `ledger` here instead of taking the sink would
  // fail twice over: after `endLedger()` the entry would go nowhere, the gate
  // having already been assembled without it, and once a second run had begun
  // the entry would land in THAT run's ledger - a defect reported against the
  // wrong experiment.
  if (sink) {
    sink.settlements.push(entry);
  }

  // A delivery that arrives after its own run assembled its verdict cannot be
  // folded into that verdict - it no longer exists to be amended. It must still
  // decide the exit code, because the contract is that this tool exits 0 only
  // when nothing it was built to detect was detected. The process is provably
  // still alive - the delivery just happened inside it - so `process.exitCode`
  // is still the code the shell will see, and raising it is the one remaining
  // way to keep the observation from being lost. A code already set to a
  // failure is left alone.
  if (!sink || sink.closed) {
    note('GATE FAILURE [' + FAILURE_KIND.DOUBLE_SETTLEMENT + '] ' +
      '(lib/util/file.js) a callback delivered ' + calls + ' times' +
      (owner ? ', owned by the case `' + owner + '`' : '') + ': ' + where +
      '. It arrived after this run had assembled its verdict, so it could not ' +
      'be folded into it; the exit code is forced to ' + EXIT_ERROR +
      ' instead, because a response delivered twice is a defect whether or ' +
      'not the harness was still listening when it happened.');

    process.exitCode = EXIT_ERROR;
  }

  return entry;
}

/**
 * The nearest caller frame outside this file's helper machinery.
 *
 * Used to describe a callback call site in the report. A frame is enough: the
 * reader needs to know WHICH of the 18 adapters delivered twice, and the case
 * name is already recorded alongside it.
 *
 * @returns {string} `file:line:column`, or a stated fallback.
 */
function callerFrame() {
  var frames = (new Error('frame').stack || '').split('\n');
  var i;
  var match;

  for (i = 1; i < frames.length; i++) {
    match = /\(?([^()\s]+:\d+:\d+)\)?\s*$/.exec(frames[i]);

    if (match && match[1].indexOf('node:') !== 0 &&
        frames[i].indexOf('callerFrame') === -1 &&
        frames[i].indexOf('at callback') === -1) {
      return match[1];
    }
  }

  return 'call site not resolvable from the stack';
}

/**
 * Tallies a failure list by kind.
 *
 * @param {Array<Object>} failures
 * @returns {Object} kind -> count, plus `total`.
 */
function tallyFailures(failures) {
  var counts = { total : failures.length };

  Object.keys(FAILURE_KIND).forEach(function(name) {
    counts[FAILURE_KIND[name]] = 0;
  });

  failures.forEach(function(entry) {
    counts[entry.kind] = (counts[entry.kind] || 0) + 1;
  });

  return counts;
}

/**
 * Adds one failure to an already-built verdict and re-derives it.
 *
 * Exists for the one failure that can only be discovered after the verdict is
 * assembled: an artifact that could not be written.
 *
 * @param {Object} gate
 * @param {string} kind
 * @param {string} subject
 * @param {string} detail
 * @param {string} owner
 * @returns {Object} The same gate.
 */
function addGateFailure(gate, kind, subject, detail, owner) {
  gate.failures.push({
    kind    : kind,
    subject : subject,
    detail  : detail,
    owner   : owner
  });

  gate.counts = tallyFailures(gate.failures);
  gate.passed = gate.failures.length === 0;

  return gate;
}

/**
 * Assembles THE verdict from every failure the run observed.
 *
 * This is the only function that decides what a failure is, and `main` is the
 * only caller that turns the answer into an exit code. Nothing else in this
 * file may return a code, and nothing outside this function may add a reason
 * to the verdict after it - which is what keeps the serialized `gate` and the
 * process's exit status statements about the same thing.
 *
 * @param {Object} result The run result, with `cases`, `warnings`, `findings`
 *   and `warningGate` - the last of which must already be set, because the
 *   zero-warning verdict is folded into this failure set rather than checked
 *   beside it.
 * @param {Object} closed The closed ledger.
 * @returns {{passed: boolean, failures: Array<Object>, counts: Object}}
 */
function buildGate(result, closed) {
  var failures = [];

  // 1. Cases. A case failed by a double delivery carries that kind, so the
  //    verdict names the mechanism rather than only the case.
  (result.cases || []).forEach(function(record) {
    if (record.status === 'passed') {
      return;
    }

    failures.push({
      kind    : record.failureKind || FAILURE_KIND.CASE,
      subject : record.name,
      detail  : record.error || 'the case did not pass',
      owner   : record.owner || 'test/parity/storage.js'
    });
  });

  // 2. Captured process warnings. Unconditional - there is no allowance list.
  (result.warnings || []).forEach(function(warning) {
    failures.push({
      kind    : FAILURE_KIND.WARNING,
      subject : (warning.code || warning.name || 'warning') + ' from the ' +
                warning.attribution,
      detail  : warning.message + ' (' +
                ((warning.origin && warning.origin[0]) || 'origin unknown') + ')',
      owner   : warning.attribution === 'dependency'
        ? 'docs/dependency-inventory.md'
        : 'test/parity/storage.js'
    });
  });

  // 3. THE SHARED ZERO-WARNING GATE'S OWN VERDICT, folded in HERE rather than
  //    consulted beside this one. That separation was the defect: `main` read
  //    `gate.passed` for the exit code and checked `warningGate.ok` afterwards,
  //    so a run that failed the policy wrote an artifact saying the gate passed
  //    and then exited 1 - the artifact and the shell disagreeing about the
  //    same run. The rendering rules live in test/parity/warning-policy.js so
  //    every gate folds the verdict the same way, and they are the reason no
  //    `gateApplies` test is needed here: a run against another worktree
  //    measures that tree and contributes nothing.
  //
  //    A notice raised inside THIS process is also in (2) above; `fromWarning`
  //    there and `fromWarningGate` here say which collector saw it, so the two
  //    sets read as one observation reported twice rather than two defects.
  warningPolicy.gateFailures(result.warningGate, {
    owner    : 'the tree under test',
    selfOwner: 'test/parity/storage.js'
  }).forEach(function(entry) {
    failures.push({
      kind            : FAILURE_KIND.WARNING_GATE,
      subject         : entry.subject,
      detail          : entry.detail,
      owner           : entry.owner,
      fromWarningGate : true
    });
  });

  // 4. Contract findings a case recorded. The warning-derived findings are
  //    skipped here and only here: they are the same observations as (2) and
  //    are marked `fromWarning` for exactly this reason, so a warning is one
  //    failure and not two.
  (result.findings || []).forEach(function(finding) {
    if (finding.fromWarning) {
      return;
    }

    failures.push({
      kind    : FAILURE_KIND.FINDING,
      subject : finding.subject,
      detail  : finding.detail,
      owner   : finding.owner || 'test/parity/storage.js'
    });
  });

  // 5. The double-delivery sweep. A delivery a case owned has already failed
  //    that case; one that arrived after its case finished - or with no case
  //    running at all - would otherwise be invisible, which is why the registry
  //    exists at all.
  ((closed && closed.settlements) || []).forEach(function(entry) {
    if (entry.attributed) {
      return;
    }

    failures.push({
      kind    : FAILURE_KIND.DOUBLE_SETTLEMENT,
      subject : 'a callback delivered ' + entry.calls + ' times, ' +
                (entry.case
                  ? 'too late for its own case `' + entry.case + '` to claim it'
                  : 'with no case running'),
      detail  : entry.where + ': only the first delivery could be asserted, ' +
                'because the promise had already settled. A response delivered ' +
                'twice is a defect in the module under test, and one that ' +
                'arrives after its case has ended is one the case could not ' +
                'have failed on.',
      owner   : 'lib/util/file.js'
    });
  });

  // 6. Whatever the helpers recorded: teardown failures, and anything else
  //    observed outside a case.
  ((closed && closed.failures) || []).forEach(function(entry) {
    failures.push(entry);
  });

  return {
    passed   : failures.length === 0,
    failures : failures,
    counts   : tallyFailures(failures)
  };
}


// ---------------------------------------------------------------------------
// The digest, computed here
// ---------------------------------------------------------------------------

/**
 * `lib/util/file.js`'s `hashcontents` digest, over a buffer instead of a stream.
 *
 * Identical algorithm and encoding - sha1, hex - so the value this returns is
 * the object key the application will produce for the same bytes. The two
 * implementations are proven to agree by the `digest-agreement` case, which
 * runs the application's STREAMING implementation over every payload and
 * compares it with this one; without that case, agreement would be an
 * assumption shared by both sides of every other assertion.
 *
 * @param {Buffer|string} value
 * @returns {string} 40-character lowercase hex
 */
function sha1Hex(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}


// ---------------------------------------------------------------------------
// The committed payloads
// ---------------------------------------------------------------------------
// Byte literals, so the digest of each is fixed by this file and not by
// anything it reads. They are deliberately DISTINCT from one another so that no
// two cases can write the same key and mask each other, and distinct from
// `test/parity/seed.js`'s payloads except where a case is specifically about a
// seeded object.
//
// `test/data/test.ipynb` exists in the repository and would have served for the
// whitelist case, but a payload read from a file this plan does not own can
// drift, and the digest IS the assertion. The notebook below is inline for the
// same reason seed.js's is.

var PAYLOADS = Object.freeze({
  // The key-composition cases. One payload across four containers, so the four
  // keys differ only in the fileId and extension suffixes `_fileToContainer`
  // appends.
  keyBytes : Buffer.from(
    'Parity storage case: key composition.\n' +
    'Fixed bytes, fixed digest.\n',
    'utf8'
  ),

  // A filename with several dots, to prove the extension comes from the LAST
  // one (`_fileToContainer` derives the extension with `lastIndexOf('.')`).
  multiDotBytes : Buffer.from(
    'Parity storage case: last-dot extension.\n',
    'utf8'
  ),

  // A structurally valid but minimal notebook. The EXTENSION is what matters:
  // `ipynb` is the only entry in `config/default.yaml`'s
  // `app.extensionWhitelist`, so this is the sole payload that can exercise
  // `_fileToContainer`'s content-type override.
  notebookBytes : Buffer.from(
    '{\n' +
    '  "cells": [],\n' +
    '  "metadata": {},\n' +
    '  "nbformat": 4,\n' +
    '  "nbformat_minor": 4\n' +
    '}\n',
    'utf8'
  ),

  // The other direction: an extension the whitelist does not name, whose
  // declared content type must reach S3 untouched.
  passthroughBytes : Buffer.from(
    'Parity storage case: content-type pass-through.\n',
    'utf8'
  ),

  // A real 2x2 PNG - 77 bytes. Used for the avatar accept path. Deliberately
  // NOT the same bytes as seed.js's 1x1 PNG: an avatar is keyed by its digest,
  // and a shared digest would make one case's object indistinguishable from
  // another's.
  avatarPng : Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAACJmvbYAAAAFUlEQVR4nGP8z8DAwMDAxAADIAYAGO8CTgNsaK0AAAAASUVORK5CYII=',
    'base64'
  ),

  // A real 1x1 PNG - 69 bytes. Snapshots are keyed by their FILENAME
  // (`uploadSnapshot` takes `fileinfo.name` from `file.name`, not from a
  // digest), so this payload's digest is never a key and cannot collide.
  snapshotPng : Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAADAAEAAQD6AAAAAElFTkSuQmCC',
    'base64'
  ),

  // The 1x1 transparent GIF89a - 42 bytes. The SAME bytes seed.js stores as the
  // seeded user asset, on purpose: the pre-migration cases read that object
  // back, so the payload has to be the one behind it.
  assetGif : Buffer.from(
    'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    'base64'
  ),

  // The swallowed-upload-error case, which stores nothing - the payload exists
  // so the digest in the success-shaped callback can still be asserted.
  failBytes : Buffer.from(
    'Parity storage case: swallowed upload error.\n',
    'utf8'
  )
});

// Derived from the payloads above.
var DIGESTS = Object.freeze(Object.keys(PAYLOADS).reduce(function(acc, name) {
  acc[name] = sha1Hex(PAYLOADS[name]);
  return acc;
}, {}));

// And checked against the values measured when the payloads were chosen.
// Deriving alone would make each digest whatever the bytes happen to be, so an
// accidental edit would re-key every object this file writes and every
// assertion would still agree with itself. Committing both turns that into a
// load-time failure naming both values, which is the same guard seed.js
// applies to its own fixtures.
var EXPECTED_DIGESTS = Object.freeze({
  keyBytes         : '07481165fe77e6f3ab46ac69a7100245a0eb645c',
  multiDotBytes    : '17a919e9bf5c3234848d19a552de7868e99551e8',
  notebookBytes    : '04cbb0110ad616b88b4b1779a5684049c78d4a89',
  passthroughBytes : '540e259e043e17dfb13cb27b4b6dfe4ebcf0d769',
  avatarPng        : 'fea9d396f751d00b7469dda31a46aba650288aa7',
  snapshotPng      : '309a9fdfaa34a9b5b4872f5fbd743eb8e596f1fd',
  assetGif         : 'd5fceb6532643d0d84ffe09c40c481ecdf59e15a',
  failBytes        : 'cf010878237a8f91f42a5ecf343b0cd8008a2fed'
});

Object.keys(EXPECTED_DIGESTS).forEach(function(name) {
  if (DIGESTS[name] !== EXPECTED_DIGESTS[name]) {
    throw new Error(
      LOG_PREFIX + 'payload `' + name + '` no longer hashes to its committed ' +
      'digest: expected ' + EXPECTED_DIGESTS[name] + ', computed ' +
      DIGESTS[name] + '. The digest IS the stored object key ' +
      '(lib/util/file.js:32-43), so changing these bytes re-keys every object ' +
      'the cases write. Update the payload and the committed digest together.'
    );
  }
});

// The seeded user asset with one byte flipped, and the digest that alteration
// produces. Committed rather than computed at case time for the same reason as
// everything else here: the negative control asserts that the digest CHANGED,
// and an expectation derived from the altered bytes at run time would be true
// however the alteration behaved.
var ALTERED_ASSET_GIF = (function() {
  var altered = Buffer.from(PAYLOADS.assetGif);

  // The penultimate byte. The GIF trailer stays intact, so the alteration is a
  // change of content and not a change of format.
  altered[altered.length - 2] = altered[altered.length - 2] ^ 0x01;

  return altered;
})();

var ALTERED_ASSET_DIGEST = '8829a62d0b401e45ab8d9e2bfbf6c4937d8527d7';

if (sha1Hex(ALTERED_ASSET_GIF) !== ALTERED_ASSET_DIGEST) {
  throw new Error(
    LOG_PREFIX + 'the altered user-asset payload no longer hashes to its ' +
    'committed digest ' + ALTERED_ASSET_DIGEST + ' (computed ' +
    sha1Hex(ALTERED_ASSET_GIF) + '), so the negative control would no longer ' +
    'prove that a one-byte change re-keys the object.'
  );
}

if (ALTERED_ASSET_DIGEST === DIGESTS.assetGif) {
  throw new Error(
    LOG_PREFIX + 'the altered user-asset payload hashes to the SAME digest as ' +
    'the original, so the negative control cannot distinguish them.'
  );
}


// ---------------------------------------------------------------------------
// Duplicate callback delivery, which is a failure and not a note
// ---------------------------------------------------------------------------
// A lifecycle callback that fires twice delivers a response twice, and in this
// module's callers that means a File document written twice or a response
// already sent being sent again. It is exactly the class of defect the async
// conversion can introduce - an `await` added inside a callback, a promise
// chain that both resolves and calls back - so it has to end the run.
//
// It cannot be reported through the promise the adapter returns: by the time a
// second call arrives the promise has already settled with the first, and a
// settled promise cannot be rejected. Writing the second call to stderr and
// nothing else would leave a passing run and a run that delivered every
// callback twice indistinguishable in the artifact and in the exit code, since
// only a case that asserts `calls === 1` itself would notice.
//
// So deliveries beyond the first are recorded on a ledger stamped with the case
// that was running, and `runCase` turns any entry into that case's failure. That
// makes the check universal without every case body opting in, which is the
// only form of it that cannot be forgotten by the next case someone adds.
//
// A DUPLICATE CAN ARRIVE AFTER THE RUN HAS FINISHED, and a single drain at the
// end does not catch it. Measured: a callback that fires again eight seconds
// after its case ended left a run that had already returned `passed`, and the
// only trace was a stderr line saying the run would fail when it had not. Three
// mechanisms together, because no one of them covers the whole window:
//
//   1. `runCase` drains after each case body, so a duplicate that arrives while
//      its own case is still running fails that case;
//   2. `run` WAITS for quiescence before it finalizes - a bounded window of
//      macrotask turns in which nothing new arrives - so a duplicate a few
//      ticks or a few hundred milliseconds late is caught and reported as a
//      failed case in the result and the artifact;
//   3. past that window, `recordDuplicateDelivery` ESCALATES onto the result
//      object the last run returned and onto `process.exitCode`, and the
//      direct-execution exit hook re-reads that. An arbitrarily late delivery
//      cannot be caught before the artifact is written - nothing can predict
//      it - but it can be made to fail the process rather than vanish, and the
//      escalation says in the same breath that the artifact predates it.
//
// The ledger is also never emptied silently: entries left over from a previous
// programmatic call are carried into the next run's result as their own failed
// case rather than discarded, because a callback firing twice is a defect
// whoever provoked it.

// A bounded quiescence window. Long enough for a delivery deferred through a
// timer or an I/O turn, short enough that a clean run pays it once and barely
// notices; the poll is what makes an early exit possible.
var DUPLICATE_QUIESCE_MS       = 400;
var DUPLICATE_QUIESCE_POLL_MS  = 20;

var duplicateDeliveries = [];
var activeCaseName      = null;

// Set once `run` has finalized its result, and cleared when the next run
// starts. `finalizedResult` is the object that run returned, so a late delivery
// can still make it fail; `lateDeliveries` is what arrived after finalization,
// which `main` and the exit hook read.
var runFinalized    = false;
var finalizedResult = null;
var lateDeliveries  = [];

/**
 * Records a callback delivery beyond the first.
 *
 * @param {number} calls How many times it has now fired.
 * @param {*} err The duplicate delivery's error argument.
 * @param {*} result The duplicate delivery's result argument.
 * @returns {undefined}
 */
function recordDuplicateDelivery(calls, err, result) {
  var entry = {
    case   : activeCaseName,
    calls  : calls,
    err    : describeValue(err),
    result : describeValue(result)
  };

  if (runFinalized) {
    // Past the point where the result could be assembled. It is escalated
    // rather than logged, so the process cannot exit 0 on it.
    entry.afterFinalization = true;
    lateDeliveries.push(entry);

    note('ERROR: a callback fired ' + calls + ' times' +
      (entry.case ? ' during ' + entry.case : '') + ', AFTER the run had ' +
      'finalized its result. The artifact was written before this arrived and ' +
      'does not describe it; the exit code is set to failure.');

    if (finalizedResult) {
      finalizedResult.cases.push({
        name       : 'duplicate-callback-delivery-after-finalization',
        pins       : 'test/parity/storage.js (the `callback` adapter)',
        status     : 'failed',
        durationMs : 0,
        error      : 'a tracked callback fired ' + calls + ' times, after the ' +
                     'result had been assembled. A lifecycle callback that ' +
                     'fires more than once delivers a response more than once.',
        duplicateDeliveries : [entry]
      });

      finalizedResult.total  = finalizedResult.cases.length;
      finalizedResult.failed = finalizedResult.failed + 1;
    }

    // The last word on the run's outcome, whoever set it earlier. Nothing here
    // lowers a code that already indicates failure.
    process.exitCode = EXIT_ERROR;

    return undefined;
  }

  duplicateDeliveries.push(entry);

  // Still written to stderr, because a duplicate arriving after the case that
  // caused it has finished is easier to place with a live line than with a
  // ledger entry read later.
  note('WARNING: a callback fired ' + calls + ' times' +
    (activeCaseName ? ' during ' + activeCaseName : '') +
    '; only the first was asserted, and the run will fail');

  return undefined;
}

/**
 * Takes every recorded duplicate delivery off the ledger.
 *
 * @returns {Array<Object>} Possibly empty.
 */
function drainDuplicateDeliveries() {
  return duplicateDeliveries.splice(0);
}

/**
 * Waits until no new duplicate delivery has arrived for a full poll interval,
 * or until the window expires.
 *
 * This is the "close the adapters" step: the run has stopped issuing calls, so
 * anything still in flight is a delivery beyond the first, and giving it a
 * bounded chance to arrive is what makes the result describe the whole run
 * rather than the instant the last case returned. A clean run pays one poll
 * interval; a run with a late delivery pays up to the window and reports it.
 *
 * @returns {Promise<Array<Object>>} Everything drained during the wait.
 */
async function quiesceDuplicateDeliveries() {
  var collected = [];
  var deadline  = Date.now() + DUPLICATE_QUIESCE_MS;
  var batch;

  for (;;) {
    await delay(DUPLICATE_QUIESCE_POLL_MS);

    batch = drainDuplicateDeliveries();

    if (!batch.length) {
      // A whole interval with nothing new. Anything later than this cannot be
      // waited for without waiting forever, and is escalated instead.
      return collected;
    }

    collected = collected.concat(batch);

    if (Date.now() >= deadline) {
      // Still arriving at the end of the window: report what there is and let
      // the escalation path take the rest.
      return collected.concat(drainDuplicateDeliveries());
    }
  }
}


// ---------------------------------------------------------------------------
// Callback adapters
// ---------------------------------------------------------------------------
// `lib/util/file.js` is callback-based and stays that way. These adapters
// wrap a call for `await` WITHOUT touching the module under test: the module
// still sees an ordinary `function(err, result)`, and everything about its
// timing, its argument count and its error handling is preserved. Nothing here
// promisifies the module itself.

/**
 * Invokes a callback-taking function and resolves with BOTH arguments.
 *
 * Deliberately not node-style: several contracts here are about a callback
 * receiving an error AND a result together - `uploadUserAsset` ends in
 * `cb(err, file)` - or about a success-shaped result arriving after
 * `_fileToContainer` swallowed an upload error at `err && console.log(err)`. A
 * promisifier that rejected on a truthy first argument would discard exactly
 * the evidence those cases need.
 *
 * EXACTLY ONCE IS THIS ADAPTER'S DEFAULT CONTRACT, not a per-case opt-in.
 * Every one of the 18 call sites below asserts the outcome of a single
 * delivery, so a second delivery invalidates the case that observed it whether
 * or not that case thought to check `outcome.calls`. A second delivery that
 * only printed a warning would leave every case passing while a response was
 * delivered twice, which is the defect this adapter is placed to detect.
 *
 * The mechanism is a registry rather than a rejection, and that is forced
 * rather than chosen: the promise settled on the first delivery and a settled
 * promise cannot be re-settled, so `reject` after `resolve` is a no-op. The
 * second delivery is recorded, `runCase` fails the case that owned it, and
 * `buildGate` sweeps any delivery that arrived too late for a case to claim.
 *
 * NO CALL SITE OPTS OUT, and that is an audit rather than an assumption. All 18
 * were read: FIFTEEN drive a `lib/util/file.js` entry point whose contract is
 * one callback - `_fileToContainer`, `uploadMaterialFile`, `uploadUserAvatar`,
 * `uploadSnapshot`, `uploadSnapshotFromBuffer`, `removeFile` and
 * `uploadUserAsset`; ONE adapts
 * `hashcontents`, whose callback takes the digest alone and fires once; and TWO
 * drive the S3 fixture's own `deleteObject`. Not one of them documents or
 * exhibits a second delivery. If a future contract legitimately delivers twice,
 * pass `expectDeliveries` with the application line that justifies it rather
 * than relaxing this default.
 *
 * @param {function(function(*, *)): *} invoke Receives the callback.
 * @param {number} [timeoutMs] Defaults to CASE_TIMEOUT_MS.
 * @param {Object} [options]
 * @param {number} [options.expectDeliveries=1] How many deliveries the
 *   application's own contract makes. Only a value above 1 changes anything,
 *   and a caller passing one must name the line that justifies it.
 * @param {string} [options.where] A description of the call site for the
 *   report; defaults to the first caller frame outside this function.
 * @returns {Promise<{err: *, result: *, calls: number}>}
 */
function callback(invoke, timeoutMs, options) {
  var limit    = timeoutMs === undefined ? CASE_TIMEOUT_MS : timeoutMs;
  var opts     = options || {};
  var expected = opts.expectDeliveries === undefined
    ? 1
    : opts.expectDeliveries;
  var where    = opts.where || callerFrame();
  // Captured NOW: a delivery that arrives after this case has ended must still
  // name the case whose contract it belongs to.
  var owner    = ledger ? ledger.activeCase : null;
  // And the RUN, by reference, for the same reason one step further out: a
  // delivery must be accounted to the run that created the adapter even after
  // that run has closed its ledger, and must never be written into a later
  // run's.
  var sink     = ledger;

  return new Promise(function(resolve, reject) {
    var settled = false;
    var calls   = 0;
    var timer   = setTimeout(function() {
      if (settled) {
        return;
      }
      settled = true;
      reject(new Error(
        'the callback did not fire within ' + limit + ' ms; a lifecycle that ' +
        'never settles is a finding, not a slow test'
      ));
    }, limit);

    function done(err, result) {
      calls++;

      if (settled) {
        // A second invocation is a real defect - a response delivered twice -
        // so it is surfaced rather than ignored. It cannot resolve the promise
        // again, so it goes on stderr AND into the ledger, which is what makes
        // it fail the owning case instead of decorating a passing run.
        note('WARNING: a callback fired ' + calls + ' times; only the first ' +
          'was asserted');

        if (calls > expected) {
          recordDoubleSettlement(sink, calls, where, owner);
        }
    recordDuplicateDelivery(calls, err, result);
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve({ err: err, result: result, calls: calls });
    }

    try {
      invoke(done);
    }
    catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    }
  });
}

/**
 * Waits until `predicate` is true, or fails.
 *
 * Used only where the application reports nothing back: `removeFile` called
 * without a callback - `removeFile` substitutes one - performs a delete whose
 * only
 * evidence is the store, and the fixture delivers through setImmediate. The
 * ceiling is short on purpose - a miss means the behaviour is absent, and a
 * long wait would only delay saying so.
 *
 * @param {string} description What is being waited for, for the failure message.
 * @param {function(): boolean} predicate
 * @param {number} [timeoutMs]
 * @returns {Promise<undefined>}
 */
async function waitFor(description, predicate, timeoutMs) {
  var limit    = timeoutMs === undefined ? SETTLE_TIMEOUT_MS : timeoutMs;
  var deadline = Date.now() + limit;

  while (Date.now() < deadline) {
    if (predicate()) {
      return undefined;
    }
    await delay(SETTLE_INTERVAL_MS);
  }

  throw new Error(
    'timed out after ' + limit + ' ms waiting for ' + description
  );
}

/**
 * A promise that resolves after `ms`.
 *
 * @param {number} ms
 * @returns {Promise<undefined>}
 */
function delay(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Drains a readable stream into one Buffer.
 *
 * `lib/util/file.js`'s `downloadMaterialFile` returns a PassThrough its callers
 * pipe onward, so reading it is how the materials contract is asserted. An
 * 'error' listener is attached here even though the success case cannot emit
 * one, because a stream that errors with no listener takes the process down and
 * the failure would be reported as a crash rather than as this case failing.
 *
 * @param {stream.Readable} stream
 * @param {number} [timeoutMs]
 * @returns {Promise<Buffer>}
 */
function drain(stream, timeoutMs) {
  var limit = timeoutMs === undefined ? CASE_TIMEOUT_MS : timeoutMs;

  return new Promise(function(resolve, reject) {
    var chunks  = [];
    var settled = false;
    var timer   = setTimeout(function() {
      if (settled) {
        return;
      }
      settled = true;
      stream.removeAllListeners('data');
      reject(new Error(
        'the stream neither ended nor errored within ' + limit + ' ms'
      ));
    }, limit);

    function finish(err, value) {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);

      if (err) {
        reject(err);
        return;
      }

      resolve(value);
    }

    stream.on('data', function(chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8'));
    });
    stream.on('end', function() {
      finish(null, Buffer.concat(chunks));
    });
    stream.on('error', function(err) {
      finish(err, null);
    });
  });
}

/**
 * Captures `console.log` for the duration of `body`, and restores it.
 *
 * `_fileToContainer` does `err && console.log(err)`: the upload error is LOGGED
 * and then discarded. Capturing turns that into a positive assertion - the
 * error really was reported before being dropped - and keeps the application's
 * own output off this harness's stdout, which carries the artifact and nothing
 * else.
 *
 * The restore is in a `finally`, so a throwing body cannot leave the process
 * with a swallowed console.
 *
 * @param {function(): Promise<*>} body
 * @returns {Promise<{value: *, logged: Array<Array<*>>}>}
 */
async function captureConsoleLog(body) {
  var logged   = [];
  var original = console.log;
  var value;

  console.log = function() {
    logged.push(Array.prototype.slice.call(arguments));
  };

  try {
    value = await body();
  }
  finally {
    console.log = original;
  }

  return { value: value, logged: logged };
}


// ---------------------------------------------------------------------------
// The scratch directory
// ---------------------------------------------------------------------------
// Uploads arrive as a temporary file the application unlinks - the `fs.unlink`
// in `_fileToContainer` - so every upload case needs a fresh one. They are
// created inside one per-run directory that is removed at the end, which is how
// "leaves no temp files behind" is made true rather than hoped for.
//
// THE DIRECTORY IS CREATED, NEVER ADOPTED, AND THE REMOVAL IS PROVEN TO TARGET
// IT. This run ends by deleting a directory tree recursively, so what gets
// deleted has to be a directory this process made and nothing else. A name
// composed from the pid - `parity-storage-<pid>` - is predictable and pids are
// reused, so `mkdirSync({recursive: true})` on such a path succeeds against an
// existing directory, or against a SYMLINK to one, and the recursive delete
// then follows whatever was there. Two distinct exposures: a stale directory
// from a crashed run is silently adopted and its contents contaminate the
// leftover assertion (CWE-377), and a symlink planted at that predictable path
// by any other user of the shared temporary directory redirects the delete
// (CWE-59).
//
// So: `fs.mkdtempSync` supplies the leaf, because mkdtemp(3) creates a NEW
// directory with mode 0700 and fails rather than opening an existing one -
// adoption is not expressible. The parent is `fs.realpathSync(os.tmpdir())`, so
// a symlinked TMPDIR is resolved ONCE, up front, and every later containment
// check compares real paths.
//
// OWNERSHIP IS PROVEN BY A TOKEN, NOT BY AN INODE. `createScratch` also writes
// a marker file holding 16 random bytes, and `removeScratch` requires that
// exact token back before it deletes anything. The device and inode are
// recorded and checked too, but they are not sufficient on their own and this
// was MEASURED rather than assumed: removing a directory and recreating one at
// the same path on this container's filesystem produced the SAME inode number,
// so an identity check alone accepts a directory it never made. A random token
// cannot be re-created by accident, which is what makes the recursive delete
// safe to perform at all.
//
// A directory that fails any check is REPORTED AND LEFT ALONE. Leaking a
// temporary directory is a nuisance; deleting a tree whose ownership cannot be
// proven is not recoverable, and the leftover assertion in the last case is
// what makes the nuisance visible.
//
// The FILE names inside it stay fixed per case, because the digest is the
// assertion and a name that varied would make a failure harder to read. Neither
// the directory name nor the pid is part of any asserted value.

// The leaf prefix `mkdtempSync` extends with its own random suffix, and the
// prefix `removeScratch` requires before it will delete anything.
var SCRATCH_PREFIX = 'parity-storage-';

// The ownership marker. Named with a leading dot so it reads as bookkeeping,
// and excluded by name from the leftover assertion rather than by a pattern
// that could also hide a real leftover.
var SCRATCH_MARKER = '.parity-storage-owner';

/**
 * Creates the run's scratch directory, and returns proof of what it created.
 *
 * @returns {{path: string, base: string, dev: number, ino: number,
 *   token: string, pid: number}} Frozen. `path` is the real path of a directory
 *   that did not exist a moment ago; `token` is the ownership proof
 *   `removeScratch` requires back.
 * @throws {ToolError} If the temporary directory is unusable, or if what was
 *   created is somehow not a plain directory.
 */
function createScratch() {
  var token = crypto.randomBytes(16).toString('hex');
  var base;
  var created;
  var real;
  var stat;

  try {
    base = fs.realpathSync(os.tmpdir());
  }
  catch (err) {
    throw new ToolError(
      'the temporary directory ' + os.tmpdir() + ' cannot be resolved (' +
      ((err && err.message) || err) + '); this run needs a scratch directory ' +
      'for every upload it makes'
    );
  }

  try {
    created = fs.mkdtempSync(path.join(base, SCRATCH_PREFIX));
    // Resolved again: the leaf is new, but resolving it is what makes `path`
    // comparable with the realpath taken at removal time on every platform.
    real = fs.realpathSync(created);
    stat = fs.lstatSync(real);
  }
  catch (err) {
    throw new ToolError(
      'cannot create a scratch directory under ' + base + ': ' +
      ((err && err.message) || err)
    );
  }

  if (!stat.isDirectory()) {
    throw new ToolError(
      'the scratch path ' + real + ' is not a directory; refusing to continue ' +
      'because the run would later delete it recursively'
    );
  }

  try {
    // 'wx' - fails if it already exists. It cannot, in a directory mkdtemp just
    // made, and asking for the guarantee costs nothing.
    fs.writeFileSync(path.join(real, SCRATCH_MARKER), token, { flag : 'wx' });
  }
  catch (err) {
    throw new ToolError(
      'cannot write the ownership marker in ' + real + ': ' +
      ((err && err.message) || err) + '. Without it the run could not later ' +
      'prove which directory it owns, and it will not delete one it cannot ' +
      'prove.'
    );
  }

  return Object.freeze({
    path  : real,
    base  : base,
    dev   : stat.dev,
    ino   : stat.ino,
    token : token,
    pid   : process.pid
  });
}

/**
 * Writes an upload's temporary file and returns the shape
 * `lib/util/file.js`'s `_fileToContainer` and `uploadUserAsset` read: `path`,
 * `filename`, `bytes` and `headers['content-type']`.
 *
 * `bytes` is the payload's real length, because `_fileToContainer` copies it
 * into its result as `size` and `uploadUserAsset` onto the File document, so a
 * wrong value here would make a passing assertion meaningless.
 *
 * @param {Object} ctx The run context, for the scratch directory.
 * @param {string} name The scratch file name; fixed per case.
 * @param {Buffer} payload
 * @param {string} filename The upload's declared filename.
 * @param {string} contentType The upload's declared content type.
 * @param {Object} [options]
 * @param {boolean} [options.harnessOwned=false] Registers the path for the
 *   runner's own teardown, which removes it after the case whether it passed
 *   or failed. It is set on the user-asset and avatar-reject paths, whose
 *   cases assert WHETHER the application removed the file: the assertion is
 *   the case's, and the teardown only guarantees nothing survives a case that
 *   failed before reaching it. Teardown is `fs.rmSync(force: true)`, so a file
 *   the application already removed - which `lib/util/file.js` now does on
 *   every terminal path of `uploadUserAsset` and on the avatar reject - is not
 *   an error here.
 *
 *   Unconditional cleanup matters for a reason measured rather than imagined:
 *   with cleanup at the end of a case body, one failing assertion left its
 *   temporary file behind and the `no-leftover-uploads` case then failed too -
 *   a second failure with a misleading message, caused by the first. Cleanup
 *   that cannot be skipped keeps every failure attributable to its own cause,
 *   and keeps the leftover check meaning "the application stopped unlinking"
 *   rather than "some earlier case threw".
 * @returns {{path: string, filename: string, bytes: number, headers: Object}}
 */
function upload(ctx, name, payload, filename, contentType, options) {
  var target = path.join(ctx.scratch, name);

  fs.writeFileSync(target, payload);

  if (options && options.harnessOwned) {
    ctx.harnessOwned.push(target);
  }

  return {
    path     : target,
    filename : filename,
    bytes    : payload.length,
    headers  : { 'content-type': contentType }
  };
}

/**
 * Removes the scratch directory this run created, and only that.
 *
 * Five things are checked before a single byte is deleted, because the delete
 * is recursive and unrecoverable:
 *
 *   1. the descriptor is one `createScratch` produced, carrying a token;
 *   2. the path is a DIRECT child of the recorded real temporary directory and
 *      its name carries the prefix, so a descriptor that has been tampered with
 *      cannot point the delete at an unrelated tree;
 *   3. the entry on disk is a real directory - `lstatSync`, so a symlink that
 *      replaced the directory since creation is seen as a symlink and refused
 *      rather than followed;
 *   4. its device and inode still match what was created;
 *   5. the ownership marker inside it still holds the exact token. This is the
 *      decisive check, and (4) is not: inode numbers are reused, measurably so
 *      on this container's filesystem, and a directory recreated at the same
 *      path can present the same identity. Only the token cannot be reproduced
 *      by coincidence.
 *
 * Failures and refusals are reported and never thrown: a case result must
 * still reach the shell, and a surviving temporary directory is reported by the
 * run's own leftover assertion rather than by an exception here.
 *
 * @param {(Object|null|undefined)} owned From `createScratch`.
 * @returns {boolean} True when the directory was removed, false when it was
 *   refused, absent or could not be removed.
 */
function removeScratch(owned) {
  var stat;
  var marker;

  if (!owned || typeof owned.path !== 'string' || !owned.path ||
      typeof owned.token !== 'string' || !owned.token) {
    return false;
  }

  if (path.dirname(owned.path) !== owned.base ||
      path.basename(owned.path).indexOf(SCRATCH_PREFIX) !== 0) {
    note('REFUSING to remove ' + owned.path + ': it is not a ' +
      SCRATCH_PREFIX + '* directory directly inside ' + owned.base +
      '. Nothing was deleted.');
    return false;
  }

  try {
    stat = fs.lstatSync(owned.path);
  }
  catch (err) {
    if (err && err.code === 'ENOENT') {
      // Already gone. Not a fault: a caller may have removed it, and the
      // leftover assertion is what reports a directory that should not be.
      return false;
    }
    // Reported AND recorded: the note keeps the diagnostic it always wrote and
    // the ledger entry is what stops a surviving temporary directory - the S3
    // store lives in it - from exiting 0. The subject is `owned.path`, which is
    // the only name for the directory in scope here: an earlier version named a
    // `dir` that this function never declares, so the one path that reaches
    // this line threw a ReferenceError out of the catch block - losing the
    // ledger entry, losing the note below, and replacing the real teardown
    // error with a defect in the reporting of it.
    recordTeardownFailure(
      'could not remove the scratch directory ' + owned.path, err
    );

    note('WARNING: could not inspect the scratch directory ' + owned.path +
      ': ' + ((err && err.message) || err) + '. Nothing was deleted.');
    return false;
  }

  if (!stat.isDirectory()) {
    note('REFUSING to remove ' + owned.path + ': it is no longer a directory ' +
      '(a symlink or file now occupies the path). Nothing was deleted.');
    return false;
  }

  if (stat.dev !== owned.dev || stat.ino !== owned.ino) {
    note('REFUSING to remove ' + owned.path + ': it is a different directory ' +
      'from the one this run created (expected device ' + owned.dev +
      ' inode ' + owned.ino + ', found device ' + stat.dev + ' inode ' +
      stat.ino + '). Nothing was deleted.');
    return false;
  }

  try {
    // lstat first: a symlink standing in for the marker must not be followed
    // into a file that happens to hold the token.
    if (!fs.lstatSync(path.join(owned.path, SCRATCH_MARKER)).isFile()) {
      throw new Error('the ownership marker is not a plain file');
    }

    marker = fs.readFileSync(path.join(owned.path, SCRATCH_MARKER), 'utf8');
  }
  catch (err) {
    note('REFUSING to remove ' + owned.path + ': its ownership marker ' +
      SCRATCH_MARKER + ' cannot be read (' + ((err && err.message) || err) +
      '), so this run cannot prove it created the directory it is about to ' +
      'delete recursively. Nothing was deleted; the directory is left for ' +
      'inspection.');
    return false;
  }

  if (marker !== owned.token) {
    note('REFUSING to remove ' + owned.path + ': its ownership marker holds a ' +
      'different token from the one this run wrote, so the directory is not ' +
      'the one it created. Nothing was deleted.');
    return false;
  }

  try {
    fs.rmSync(owned.path, { recursive: true, force: true });
  }
  catch (err) {
    note('WARNING: could not remove the scratch directory ' + owned.path +
      ': ' + ((err && err.message) || err));
    return false;
  }

  return true;
}


// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

/**
 * Parses the command line.
 *
 * @param {string[]} args process.argv.slice(2)
 * @returns {{appRoot: string, out: (string|null), help: boolean}}
 * @throws {ToolError} On any usage error; `showUsage` is set on it.
 */
function parseArguments(args) {
  var options = { appRoot: TOOL_ROOT, out: null, help: false };
  var seen = {};
  var i;
  var arg;

  // A dash-leading token is never a value: `--out --app x` is a missing --out,
  // not a result artifact named "--app".
  function value(flag, index) {
    var next = args[index + 1];

    if (next === undefined || next.charAt(0) === '-') {
      throw usageError(flag + ' requires a path' +
        (next === undefined ? '' : ', and ' + JSON.stringify(next) +
        ' is an option'));
    }

    return next;
  }

  // NO OPTION HERE IS REPEATABLE, so a second occurrence is a usage error
  // rather than a last-one-wins. Two `--out` paths would mean the artifact this
  // gate's verdict is evidenced by is not the one the caller named - and this
  // tool writes the artifact BEFORE deriving its exit code precisely so the two
  // always agree.
  function once(flag) {
    if (seen[flag]) {
      throw usageError(flag + ' was given more than once; no option here is ' +
        'repeatable, so two values would mean this run silently discarded one ' +
        'of them');
    }

    seen[flag] = true;

    return flag;
  }

  for (i = 0; i < args.length; i++) {
    arg = args[i];

    once(arg);

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--app') {
      options.appRoot = path.resolve(process.cwd(), value('--app', i));
      i++;
      continue;
    }

    if (arg === '--out') {
      options.out = path.resolve(process.cwd(), value('--out', i));
      i++;
      continue;
    }

    throw usageError('unrecognized argument: ' + arg);
  }

  return options;
}

/**
 * A ToolError flagged for the usage text.
 *
 * @param {string} message
 * @returns {ToolError}
 */
function usageError(message) {
  var err = new ToolError(message);

  err.showUsage = true;

  return err;
}

/**
 * Verifies that `appRoot` looks like a checkout of this application.
 *
 * Checked before anything is required, because a wrong `--app` otherwise
 * surfaces as a bare MODULE_NOT_FOUND from deep inside a require chain. The
 * files named are the ones this harness actually loads.
 *
 * Both failures are flagged `showUsage`, so a mistyped path exits 2 like every
 * other usage error rather than 1 - which is reserved for "the contract is
 * broken" and must not be reachable by calling the tool wrongly.
 *
 * @param {string} appRoot Absolute path.
 * @returns {undefined}
 * @throws {ToolError} If a required file is absent.
 */
function assertAppRoot(appRoot) {
  var required = [
    'app.js',
    'config/aws.js',
    'config/default.yaml',
    'lib/util/file.js',
    'lib/models/file.js'
  ];
  var i;
  var candidate;

  if (!fs.existsSync(appRoot) || !fs.statSync(appRoot).isDirectory()) {
    throw usageError('--app is not a directory: ' + appRoot);
  }

  for (i = 0; i < required.length; i++) {
    candidate = path.join(appRoot, required[i]);

    if (!fs.existsSync(candidate)) {
      throw usageError(
        '--app does not look like a trinket checkout: missing ' + required[i] +
        ' under ' + appRoot
      );
    }
  }

  return undefined;
}


// ---------------------------------------------------------------------------
// Process state: what this run mutates, and how it is put back
// ---------------------------------------------------------------------------
// This harness is a MODULE as well as a CLI - `run` and `main` are exported so
// a sibling can drive it - and everything it needs in order to load the
// application is process-wide: six environment variables, the working
// directory, and one undeclared global. Under `require.main === module` that
// never mattered, because the process exits immediately afterwards. Called
// programmatically it matters twice over:
//
//   * `config` freezes its values on first require, so a SECOND run in
//     the same process inherits the first run's NODE_CONFIG whatever it sets -
//     but the leaked variables also reach anything else in the process that
//     reads them, and a caller that ran this gate and then started the
//     application would get this gate's database address.
//   * `global.File` is left pointing at the application's Mongoose model, so
//     Node 22's own WHATWG `File` constructor stays shadowed for the rest of
//     the process - a change with no connection to storage at all.
//
// The remedy is one snapshot taken before the first mutation and one restore in
// the outermost `finally`, covering EXACTLY the keys this file writes and
// nothing else. Absence is part of the snapshot: a variable that was unset must
// end up unset again, not set to the empty string, because `config` and
// `test/parity/mongo.js` both distinguish the two.

// The environment variables `prepareEnvironment` and `run` write. Anything
// added there must be added here, or it leaks.
var MANAGED_ENV_KEYS = Object.freeze([
  'NODE_ENV',
  'NODE_CONFIG',
  'NODE_CONFIG_DIR',
  'NODE_CONFIG_PERSIST_ON_CHANGE',
  'PARITY_APP_ROOT',
  'PARITY_S3_ROOT'
]);

/**
 * Snapshots the process state this run is about to mutate.
 *
 * Taken BEFORE `prepareEnvironment` and before any application require, so the
 * snapshot describes the caller's process and not a half-prepared one.
 *
 * @returns {{cwd: (string|null), env: Object, fileGlobal: Object}}
 */
function captureProcessState() {
  var snapshot = {
    cwd        : null,
    env        : {},
    fileGlobal : {
      // An own property of globalThis on Node 22 - the WHATWG File - so the
      // descriptor is captured rather than the value alone: restoring by
      // assignment would leave it enumerable and writable even if it had not
      // been.
      owned      : Object.prototype.hasOwnProperty.call(globalThis, 'File'),
      descriptor : Object.getOwnPropertyDescriptor(globalThis, 'File') || null
    }
  };

  try {
    snapshot.cwd = process.cwd();
  }
  catch (err) {
    // A deleted working directory makes process.cwd() throw. Recording null is
    // honest - there is nothing to go back to - and the run can still proceed
    // because it chdirs to appRoot next.
    snapshot.cwd = null;
  }

  MANAGED_ENV_KEYS.forEach(function(key) {
    snapshot.env[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? { present : true, value : process.env[key] }
      : { present : false, value : undefined };
  });

  return snapshot;
}

/**
 * Puts back everything `captureProcessState` recorded.
 *
 * Runs in a `finally`, so it never throws: each restoration is attempted
 * independently and a failure is reported, because abandoning the rest would
 * leak more than it reports.
 *
 * @param {(Object|null)} snapshot From captureProcessState.
 * @returns {undefined}
 */
function restoreProcessState(snapshot) {
  if (!snapshot) {
    return undefined;
  }

  MANAGED_ENV_KEYS.forEach(function(key) {
    var recorded = snapshot.env[key];

    try {
      if (!recorded || !recorded.present) {
        delete process.env[key];
      }
      else {
        process.env[key] = recorded.value;
      }
    }
    catch (err) {
      note('WARNING: could not restore the environment variable ' + key +
        ': ' + ((err && err.message) || err));
    }
  });

  try {
    if (snapshot.fileGlobal.owned && snapshot.fileGlobal.descriptor) {
      Object.defineProperty(globalThis, 'File', snapshot.fileGlobal.descriptor);
    }
    else if (!snapshot.fileGlobal.owned) {
      delete globalThis.File;
    }
  }
  catch (err) {
    note('WARNING: could not restore the global File: ' +
      ((err && err.message) || err));
  }

  if (snapshot.cwd) {
    try {
      process.chdir(snapshot.cwd);
    }
    catch (err) {
      note('WARNING: could not return to the working directory ' +
        snapshot.cwd + ': ' + ((err && err.message) || err));
    }
  }

  return undefined;
}



// ---------------------------------------------------------------------------
// The environment, published before the first application require
// ---------------------------------------------------------------------------

/**
 * Publishes the environment the application will read, and changes into
 * `appRoot`.
 *
 * ORDERING IS THIS FUNCTION'S REASON FOR EXISTING. `config` freezes its values
 * when it is first required, and `lib/util/file.js`, `config/aws.js` and every
 * model reach it, so NODE_CONFIG and NODE_CONFIG_DIR have to be right BEFORE
 * any of them loads. Three layers, lowest first:
 *
 *   1. `test/parity/server-overlay.json`, which is where `db.redis.enabled:
 *      false` and the `aws.buckets.exports` entry committed configuration
 *      lacks come from.
 *   2. Whatever NODE_CONFIG was inherited - which, when this runs as a child of
 *      `test/parity/mongo.js`, already carries the published database address
 *      and must therefore win over the overlay's placeholder database name.
 *   3. `db.redis.enabled: false`, forced last, so an inherited overlay cannot
 *      switch Redis back on and have `lib/util/queues.js` dial localhost:6379
 *      from inside a storage gate.
 *
 * PARITY_APP_ROOT is what `test/parity/fixtures/aws.js` resolves `config/aws`
 * from, so it is published here rather than left to `process.cwd()`
 * - and PARITY_S3_ROOT points the fixture's store inside this run's scratch
 * directory, so the objects it writes are removed with everything else instead
 * of accumulating under the system temporary directory.
 *
 * @param {string} appRoot Absolute path, already validated.
 * @param {string} scratch This run's scratch directory.
 * @returns {{nodeEnv: string, nodeConfig: string, nodeConfigDir: string,
 *   s3Root: string}}
 * @throws {ToolError} If the working directory cannot be changed.
 */
function prepareEnvironment(appRoot, scratch) {
  var overlay  = mongo.readOverlay(mongo.DEFAULT_OVERLAY);
  var composed = mongo.deepMerge(overlay, parseInheritedNodeConfig());
  var s3Root   = path.join(scratch, 's3');
  var isolation;

  composed = mongo.deepMerge(composed, { db: { redis: { enabled: false } } });

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  // NODE_CONFIG_DIR plus the three runtime-layer controls, from ./mongo's one
  // implementation. All three and not persistence alone: `config` creates its
  // runtime JSON unless persistence is off AND the file watch is disabled, so
  // setting one of them still leaves config/runtime.json written into the
  // worktree being read - gitignored, hence invisible to `git status`, and
  // layered over every other configuration source on the following run.
  // Redirecting the path also discards an inherited one, which would otherwise
  // import a previous run's persisted values into this one.
  isolation = mongo.isolateRuntimeConfig({
    appRoot   : appRoot,
    configDir : 'set'
  });

  process.env.NODE_CONFIG     = JSON.stringify(composed);
  process.env.PARITY_APP_ROOT = appRoot;
  process.env.PARITY_S3_ROOT  = s3Root;

  fs.mkdirSync(s3Root, { recursive: true });

  try {
    process.chdir(appRoot);
  }
  catch (err) {
    throw new ToolError('cannot chdir to ' + appRoot + ': ' + err.message);
  }

  return {
    nodeEnv         : process.env.NODE_ENV,
    nodeConfig      : process.env.NODE_CONFIG,
    nodeConfigDir   : isolation.configDir,
    runtimeJsonPath : isolation.runtimeJsonPath,
    s3Root          : s3Root
  };
}

/**
 * Parses an inherited NODE_CONFIG, failing loudly on a value that is present
 * but unusable.
 *
 * A malformed inherited value must not be silently discarded: it would take the
 * published database address with it and the run would quietly use the
 * overlay's placeholder instead.
 *
 * @returns {Object}
 * @throws {ToolError} If NODE_CONFIG is set but is not a JSON object.
 */
function parseInheritedNodeConfig() {
  var inherited = process.env.NODE_CONFIG;
  var parsed;

  if (inherited === undefined || inherited === '') {
    return {};
  }

  try {
    parsed = JSON.parse(inherited);
  }
  catch (err) {
    throw new ToolError(
      'the inherited NODE_CONFIG is not valid JSON (' + err.message + '); it ' +
      'carries the published database address, so it cannot be ignored'
    );
  }

  if (!mongo.isPlainObject(parsed)) {
    throw new ToolError('the inherited NODE_CONFIG is not a JSON object');
  }

  return parsed;
}

/**
 * Requires one module from the tree under test.
 *
 * EVERY application require goes through here, resolved ABSOLUTELY inside
 * `appRoot`. Node resolves `require` relative to the requiring FILE, so a
 * relative '../../lib/util/file' would always load THIS tree even while a
 * `--app` pointed somewhere else, and the whole two-worktree model would
 * silently collapse into testing one tree twice.
 *
 * @param {string} appRoot Absolute path.
 * @param {string} relative Repository-relative module path.
 * @returns {*} The module's exports.
 * @throws {ToolError} If the module cannot be loaded.
 */
function requireFromApp(appRoot, relative) {
  var target = path.resolve(appRoot, relative);

  try {
    return require(target);
  }
  catch (err) {
    throw new ToolError(
      'cannot load ' + relative + ' from ' + appRoot + ': ' +
      ((err && err.message) || err)
    );
  }
}

/**
 * Resolves an npm package from the tree under test rather than from this file.
 *
 * The archive cases turn on which `adm-zip` and which `archiver` the tree under
 * test declares: the read is asserted through the reader that tree would use,
 * and the bytes are produced by the writer that tree would use. Resolving
 * either from this file would exercise this tool's own installation instead.
 * The resolved versions are read at runtime and recorded in the artifact rather
 * than stated here.
 *
 * @param {string} appRoot Absolute path.
 * @param {string} name Package name.
 * @returns {*} The package's exports.
 * @throws {ToolError} If the package cannot be resolved.
 */
function resolveDependency(appRoot, name) {
  var resolved;

  try {
    resolved = require.resolve(name, { paths: [appRoot] });
  }
  catch (err) {
    throw new ToolError(
      'cannot resolve `' + name + '` from ' + appRoot + '; the tree under ' +
      'test has not been installed'
    );
  }

  return require(resolved);
}


// ---------------------------------------------------------------------------
// The application under test
// ---------------------------------------------------------------------------

/**
 * Loads the S3 fixture, installs the `File` global and requires the module
 * under test, in that order.
 *
 * THE ORDER IS THE CONTRACT. `_upload`, `downloadMaterialFile`, `removeFile`
 * and `downloadUserAsset` each do `new aws.S3()`, resolving `AWS.S3` at CALL
 * time from the `config/aws` module object - so the fixture only has to be
 * loaded before the first call, but loading it first is what makes that
 * unconditional rather than a race with whatever else pulls `config/aws` in.
 *
 * THE GLOBAL. `uploadUserAsset` does `file = new File()` against an UNDECLARED
 * global that `app.js` installs with a bare assignment inside `init()`. A
 * harness that requires `lib/util/file.js` without installing it does NOT get
 * the ReferenceError one would expect, because Node 22 ships its own global
 * `File` - the WHATWG one, writable and configurable, both measured.
 * `new File()` therefore reaches that constructor and fails with
 * `TypeError: The "fileBits" and "fileName" arguments must be specified` from
 * inside `uploadUserAsset`, which names neither this module nor the model and
 * sends a reader looking for a malformed upload. Installing the model here
 * overrides that built-in deliberately, and the override is what makes
 * `file.setOwner` and `file.save` exist at all - the WHATWG File has neither.
 * The whole application is NOT started to obtain it, because booting `app.js`
 * would connect its own database and start a listener that has nothing to do
 * with the storage contract.
 *
 * WHAT IS REGISTERED, AND WHY IT IS REGISTERED AS IT HAPPENS. Requiring the
 * fixture PATCHES `AWS.S3` on the application's `config/aws`, and assigning
 * `global.File` shadows a Node built-in. Both are process-wide, and both are
 * in place before this function has finished - so if a later step throws
 * (`lib/util/file.js` failing to load, a package the tree has not installed),
 * whatever is already installed has to be released by the caller. That is what
 * `acquired` is for: each mutation is recorded on it in the same statement that
 * makes it, so the caller's `finally` always sees exactly what exists. A
 * ledger built from the RETURN value could only ever describe a successful
 * load, which is the case that needs no help.
 *
 * @param {string} appRoot Absolute path, already validated.
 * @param {Object} acquired The caller's acquisition ledger. `awsFixture` is set
 *   on it as soon as the namespace is patched.
 * @returns {Object} The loaded application surface.
 * @throws {ToolError} If the fixture did not patch the namespace.
 */
function loadApplication(appRoot, acquired) {
  var awsFixture = require('./fixtures/aws');
  var status     = awsFixture.status();
  var FileModel;
  var FileUtil;

  // Recorded before the first check, because requiring the module above is what
  // performs the patch: a fixture that patched and then reported an
  // inconsistent status still has to be restored.
  if (acquired) {
    acquired.awsFixture = awsFixture;
  }

  if (!status.installed || !status.patched) {
    throw new ToolError(
      'test/parity/fixtures/aws.js did not patch AWS.S3 (installed=' +
      status.installed + ', patched=' + status.patched + ', appRoot=' +
      status.appRoot + ', diagnostic=' + status.diagnostic + '). Every case ' +
      'below would otherwise reach the real SDK, so the run stops here.'
    );
  }

  if (path.resolve(status.appRoot) !== appRoot) {
    throw new ToolError(
      'the S3 fixture patched config/aws under ' + status.appRoot +
      ' but the tree under test is ' + appRoot + '; the application would ' +
      'construct an unpatched client'
    );
  }

  FileModel = requireFromApp(appRoot, 'lib/models/file');

  // Installed BEFORE `lib/util/file.js` is required below, because
  // `uploadUserAsset` constructs `new File()` against this undeclared global
  // and Node's own built-in `File` would otherwise answer, with neither
  // `setOwner` nor `save` on it.
  global.File = FileModel;

  FileUtil = requireFromApp(appRoot, 'lib/util/file');

  return {
    appRoot     : appRoot,
    awsFixture  : awsFixture,
    // The application's own `config/aws` module object - the one
    // `lib/util/file.js` binds and calls `new aws.S3()` on. Required here so
    // the preflight can assert the patch sits on THIS instance rather than on
    // whatever reference the fixture retained: `status().patched` inspects the
    // fixture's own bookkeeping, and only resolving the module from `appRoot`
    // proves the require-cache entry the application will hit is the patched
    // one. Two resolved paths for `config/aws` would satisfy the first check
    // and fail this one.
    awsModule   : requireFromApp(appRoot, 'config/aws'),
    FileModel   : FileModel,
    FileUtil    : FileUtil,
    config      : resolveDependency(appRoot, 'config'),
    appMongoose : resolveDependency(appRoot, 'mongoose'),
    AdmZip      : resolveDependency(appRoot, 'adm-zip'),
    archiver    : resolveDependency(appRoot, 'archiver')
  };
}

/**
 * Drops the S3 fixture from the require cache, so the next run loads it fresh.
 *
 * WHY THIS IS NECESSARY AND WHY IT LIVES HERE. `test/parity/fixtures/aws.js`
 * resolves its object-store root from PARITY_S3_ROOT **once, at module load**,
 * and `restore()` puts back `AWS.S3` without touching that root or the
 * `rootReady` flag it set alongside it. Every run owns a NEW scratch directory
 * and publishes a new PARITY_S3_ROOT inside it, and the old one has been deleted
 * by then - so on a second `run()` in the same process Node returns the cached
 * fixture, uninstalled and still pointing at the first run's deleted root, and
 * the second call fails its own preflight with `patched=false`.
 *
 * The fixture exposes no lifecycle API that re-resolves the root - `reset()`
 * clears the call log and the objects, not the root - so the cache lifecycle is
 * handled on this side of the boundary: evict the entry, and
 * `loadApplication`'s own `require` re-executes the fixture's load block, which
 * re-reads PARITY_S3_ROOT and re-patches the namespace for the run that is
 * starting.
 *
 * Evicting is safe because this module is the fixture's only consumer here:
 * `test/parity/worker.js` requires this file for `assertArchiveLayout` and
 * never calls `run`, so no live reference is left dangling. Called only when
 * this run actually installed the fixture.
 *
 * @returns {boolean} True when an entry was evicted.
 */
function releaseAwsFixtureModule() {
  var resolved;

  try {
    resolved = require.resolve('./fixtures/aws');
  }
  catch (err) {
    return false;
  }

  if (!require.cache[resolved]) {
    return false;
  }

  delete require.cache[resolved];

  return true;
}

/**
 * Connects every mongoose instance in play, and returns the ones it opened.
 *
 * Normally there is one. `test/parity/seed.js` registers its models on the
 * mongoose it resolves relative to ITSELF, and this file resolves the
 * application's relative to `appRoot`; when both are the same tree - the
 * ordinary case - `require` returns the same cached module and this connects
 * once. When `--app` names a different worktree they are two module instances
 * with two connection pools, so both are dialled at the same URI: the documents
 * seed.js writes and the documents `uploadUserAsset` saves then land in
 * the same database and each side can read the other's, which is what the
 * pre-migration cases depend on.
 *
 * `strictQuery` is pinned on every instance for the same reason
 * `config/db.js` pins it: without it Mongoose prints a deprecation warning,
 * and the zero-warning gate covers this tooling's stderr as well as the
 * application's.
 *
 * PARTIAL ACQUISITION. Connecting is a loop, so it can fail halfway: with two
 * instances, a failure on the second leaves the FIRST connected and holding a
 * socket and a heartbeat timer. A function that only returned its list on
 * success would hand the caller nothing to close, the process would not exit,
 * and the run would appear to hang rather than to fail. So the caller supplies
 * the accumulator and each instance is appended to it the moment its own
 * `connect` resolves - the caller's `finally` therefore always holds exactly
 * the set that is open, whether this returned or threw.
 *
 * @param {Array<Object>} instances Mongoose instances, duplicates tolerated.
 * @param {string} uri
 * @param {Array<Object>} opened The caller's accumulator; each instance is
 *   pushed onto it as soon as it is connected.
 * @returns {Promise<Array<Object>>} `opened`, for convenience.
 */
async function connectAll(instances, uri, opened) {
  var distinct = [];
  var i;

  for (i = 0; i < instances.length; i++) {
    if (instances[i] && distinct.indexOf(instances[i]) === -1) {
      distinct.push(instances[i]);
    }
  }

  for (i = 0; i < distinct.length; i++) {
    distinct[i].set('strictQuery', true);
    await distinct[i].connect(uri);
    // Appended AFTER the await resolves and BEFORE the next iteration, which is
    // what makes the accumulator exact rather than optimistic.
    opened.push(distinct[i]);
  }

  return opened;
}

/**
 * Disconnects what `connectAll` opened.
 *
 * Failures are reported, never thrown: the case results must still reach the
 * shell.
 *
 * @param {Array<Object>} instances
 * @returns {Promise<undefined>}
 */
async function disconnectAll(instances) {
  var i;

  for (i = 0; i < instances.length; i++) {
    try {
      await instances[i].disconnect();
    }
    catch (err) {
      // A connection that would not close is a live connection, so it is a
      // gate failure and not a note: the run's own results still reach the
      // shell, and the verdict now says the process did not let go.
      recordTeardownFailure('disconnect failed', err);
    }
  }

  return undefined;
}


// ---------------------------------------------------------------------------
// The disposable-database guard
// ---------------------------------------------------------------------------
// This harness MUTATES the database it connects to, and destructively. `prepare`
// calls `seed.seed({force: true})`, which deletes the fixed fixture ids before
// re-inserting them, and `cleanupDocuments` issues a `deleteMany`. Both are
// correct against a per-run throwaway database and catastrophic against
// anything else.
//
// PARITY_MONGO_URI is how `test/parity/mongo.js` hands its in-memory instance
// to a command it spawns. Taking that address and using it verbatim would seed
// and delete in any value at all, including a developer's working database or a
// staging address that happened to be exported in the shell. The variable is a
// plain string in the environment: nothing about its presence proves who wrote
// it.
//
// PROVENANCE COMES FROM THE CALL PATH, NEVER FROM THE NAME. There are exactly
// two ways this harness obtains an address, and only one of them is trustworthy
// by construction:
//
//   * THIS process started the server, through `mongo.withMongo` inside `run`.
//     The address is the one that call returned, so it is disposable because of
//     what happened, not because of what it is called. `run` says so by passing
//     MONGO_SOURCE_LIFECYCLE, and nothing outside this file can produce that
//     argument.
//   * the address arrived in the environment. Then it is EXTERNAL, and the
//     explicit destructive opt-in is required - unconditionally, whatever the
//     database is called.
//
// EXEMPTING THE GENERATED NAME SHAPE WOULD NOT BE SAFE, and the counter-example
// is one line long: `mongodb://db.example.invalid:27017/parity_12345_abc123_
// deadbe` satisfies the shape below while naming a host nothing here created.
// The shape is a public regular expression anyone can satisfy by typing. A name
// is a claim; it is not evidence about who created the database or whether it
// can be destroyed.
//
// The name checks are RETAINED, as validation rather than as provenance: an
// external address must still carry the disposable prefix, so a typo that
// resolved to something real is refused even when the operator did opt in, and
// it must still agree with PARITY_MONGO_DATABASE when the spawner published one,
// which catches a URI edited after the fact. Requiring both the opt-in and the
// prefix means the destruction was named twice.
//
// Every refusal happens BEFORE the first connection, which is the only point at
// which refusing costs nothing.

// The prefix `test/parity/mongo.js` uses, and the shape it generates.
var DISPOSABLE_DATABASE_PREFIX = 'parity_';
var GENERATED_DATABASE_NAME    = /^parity_[0-9]+_[0-9a-z]+_[0-9a-f]{6}$/;

// The explicit destructive opt-in, and the values that count as one. Spelled
// out rather than treated as "any truthy string", so `=0` and `=false` do not
// silently authorize a delete.
var EXTERNAL_MONGO_OPT_IN     = 'PARITY_ALLOW_EXTERNAL_MONGO';
var EXTERNAL_MONGO_OPT_IN_SET = Object.freeze(['1', 'yes', 'true']);

// How the address reached this run. These are the only two values, they are
// passed by `run` rather than inferred, and `MONGO_SOURCE_LIFECYCLE` is
// reachable only from the branch that started the server itself.
var MONGO_SOURCE_LIFECYCLE = 'lifecycle';
var MONGO_SOURCE_EXTERNAL  = 'external';

/**
 * Extracts the database name from a MongoDB connection string.
 *
 * Written out rather than delegated: `url.parse` is prohibited in this file
 * because it emits DEP0169 and this tooling's stderr is inside the stream the
 * zero-warning gate judges, and `new URL` rejects the multi-host form
 * `mongodb://a:1,b:2/db` that a replica-set address takes. Only the database
 * segment is needed, and it is unambiguous: everything between the first `/`
 * after the host section and the first `?` or `#`.
 *
 * @param {string} uri
 * @returns {(string|null)} The database name, `''` when the URI names none, or
 *   null when the value is not a connection string at all.
 */
function mongoDatabaseFromUri(uri) {
  var value  = typeof uri === 'string' ? uri : '';
  var scheme = value.indexOf('://');
  var rest;
  var hostEnd;
  var credentials;
  var at;
  var cut;
  var database;

  if (scheme === -1) {
    return null;
  }

  rest    = value.slice(scheme + 3);
  hostEnd = rest.indexOf('/');

  // Credentials are searched for only within the host section: a password must
  // be percent-encoded, so an unencoded '@' cannot appear there, while an
  // option value later in the string might.
  credentials = hostEnd === -1 ? rest : rest.slice(0, hostEnd);
  at          = credentials.lastIndexOf('@');

  if (at !== -1) {
    rest    = rest.slice(at + 1);
    hostEnd = rest.indexOf('/');
  }

  if (hostEnd === -1) {
    return '';
  }

  rest = rest.slice(hostEnd + 1);
  cut  = rest.length;

  ['?', '#'].forEach(function(terminator) {
    var index = rest.indexOf(terminator);

    if (index !== -1 && index < cut) {
      cut = index;
    }
  });

  database = rest.slice(0, cut);

  try {
    return decodeURIComponent(database);
  }
  catch (err) {
    // An undecodable name is not a name this guard will accept anyway, so the
    // raw value is returned and the caller refuses it by shape.
    return database;
  }
}

/**
 * Refuses to proceed unless the database is provably disposable.
 *
 * Called before the first `connect` and therefore before anything is written or
 * deleted. `source` is the whole of the provenance decision and comes from the
 * caller: see the note above for why a name can never supply it.
 *
 * @param {string} uri The address the run is about to seed and delete in.
 * @param {string} source MONGO_SOURCE_LIFECYCLE when this process started the
 *   server itself, MONGO_SOURCE_EXTERNAL when the address arrived in the
 *   environment. Anything else is treated as external, because an unrecognised
 *   value is not a proof of anything.
 * @returns {{database: string, provenance: string, optedIn: boolean}}
 * @throws {ToolError} On any address that is not provably disposable.
 */
function assertDisposableMongoUri(uri, source) {
  var database  = mongoDatabaseFromUri(uri);
  var published = process.env.PARITY_MONGO_DATABASE;
  var optIn     = process.env[EXTERNAL_MONGO_OPT_IN];
  var optedIn   = EXTERNAL_MONGO_OPT_IN_SET.indexOf(
    String(optIn).toLowerCase()
  ) !== -1;

  if (database === null) {
    throw new ToolError(
      'the MongoDB address ' + JSON.stringify(String(uri)) + ' is not a ' +
      'connection string, so the database this run would seed and delete ' +
      'cannot be identified. Refusing to connect.'
    );
  }

  if (!database) {
    throw new ToolError(
      'the MongoDB address ' + uri + ' names no database. This run seeds and ' +
      'deletes documents, so it will not connect to an address whose database ' +
      'is whatever the driver defaults to. Append /' +
      DISPOSABLE_DATABASE_PREFIX + '<name> or let test/parity/mongo.js supply ' +
      'the address.'
    );
  }

  // The one trustworthy route: this process started the server a moment ago
  // through mongo.withMongo, and `run` is the only caller that can say so. The
  // shape is still checked, because a lifecycle address that did NOT look
  // generated would mean the sibling tool's naming had changed under us and the
  // isolation assumption with it - but the shape is being validated here, not
  // believed as evidence.
  if (source === MONGO_SOURCE_LIFECYCLE) {
    if (!GENERATED_DATABASE_NAME.test(database)) {
      throw new ToolError(
        'test/parity/mongo.js returned the database `' + database + '`, which ' +
        'is not the per-run name it is expected to generate. Its isolation ' +
        'contract may have changed, and this run will not seed and delete in a ' +
        'database it cannot recognise. Refusing to connect.'
      );
    }

    return {
      database   : database,
      provenance : MONGO_SOURCE_LIFECYCLE,
      optedIn    : optedIn
    };
  }

  // Everything else is external, and the destructive opt-in is required
  // UNCONDITIONALLY - the name is checked too, but it never substitutes for the
  // instruction. Order matters only for the message: the missing instruction is
  // reported first, because that is the one the operator has to supply.
  if (!optedIn) {
    throw new ToolError(
      'refusing to seed and delete documents in the database `' + database +
      '`: PARITY_MONGO_URI was supplied from outside this run, and nothing ' +
      'about an environment variable proves which database it names or that ' +
      'the database can be destroyed. This run calls seed({force: true}), ' +
      'which deletes fixed fixture ids, and deleteMany on the documents its ' +
      'cases create. Either let this harness start its own throwaway instance ' +
      'by unsetting PARITY_MONGO_URI, or set ' + EXTERNAL_MONGO_OPT_IN + '=1 ' +
      '(or yes, or true) to confirm the destruction is intended. A database ' +
      'name that happens to look generated is not that confirmation: the shape ' +
      'is public and anyone can type it.'
    );
  }

  if (database.indexOf(DISPOSABLE_DATABASE_PREFIX) !== 0) {
    throw new ToolError(
      'the destructive opt-in ' + EXTERNAL_MONGO_OPT_IN + ' is set, but the ' +
      'database `' + database + '` does not carry the disposable prefix `' +
      DISPOSABLE_DATABASE_PREFIX + '`. The opt-in authorizes destroying a ' +
      'throwaway database, not any database: a typo that resolved to a real ' +
      'one would otherwise be accepted. Rename it ' +
      DISPOSABLE_DATABASE_PREFIX + '<something> or drop PARITY_MONGO_URI.'
    );
  }

  if (published && published !== database) {
    throw new ToolError(
      'PARITY_MONGO_URI names the database `' + database + '` but ' +
      'PARITY_MONGO_DATABASE says `' + published + '`. The two are published ' +
      'together by test/parity/mongo.js, so a disagreement means one of them ' +
      'was changed and this run cannot tell which database is the disposable ' +
      'one. Refusing to connect.'
    );
  }

  return {
    database   : database,
    provenance : MONGO_SOURCE_EXTERNAL,
    optedIn    : true
  };
}


// ---------------------------------------------------------------------------
// The archive contract
// ---------------------------------------------------------------------------
// `lib/workers/exports.js` has NO module.exports - it is a side-effect-only
// worker that registers a Bull processor and connects a database at module
// scope - so its internals cannot be imported and must not be: requiring it
// from a storage gate would start a queue consumer. The three values below are
// therefore INDEPENDENT reimplementations of its specification, read from the
// lines named, and each is asserted against hand-written literal expectations
// by the `archive-sanitizer` and `archive-code-shapes` cases. That is the point:
// an expectation that merely called the application's own function would assert
// nothing.

// lib/workers/exports.js (`langExtensions`), verbatim.
var LANG_EXTENSIONS = Object.freeze({
  'python'     : '.py',
  'python3'    : '.py',
  'pygame'     : '.py',
  'html'       : '.html',
  'java'       : '.java',
  'R'          : '.R',
  'glowscript' : '.py',
  'blocks'     : '.xml',
  'console'    : '.py',
  'music'      : '.py',
  'skulpt'     : '.py'
});

/**
 * `lib/workers/exports.js` (`sanitizeFolderName`), reimplemented.
 *
 * Four rules, in this order: default a falsy name to 'untitled', strip every
 * character outside [a-zA-Z0-9_\-\s], collapse each whitespace run to a single
 * '_', then truncate to 50 characters.
 *
 * The order matters and is preserved: stripping BEFORE collapsing means
 * 'a b' - where the punctuation vanishes first - becomes 'a_b' and not 'a__b',
 * and truncating LAST means the 50-character limit applies to the collapsed
 * form. Truncating first would produce a different directory name for any long
 * name containing punctuation.
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeFolderName(name) {
  return (name || 'untitled')
    .replace(/[^a-zA-Z0-9_\-\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

/**
 * `lib/workers/exports.js` (`parseCodeFiles`), reimplemented.
 *
 * `trinket.code` is either a JSON array of `{name, content}` files, or anything
 * else. "Anything else" includes valid JSON that is not an array - the
 * application throws its own 'Not an array' to force that into the same
 * fallback - and the fallback names the single file 'main.xml' when the lang
 * MATCHES /blocks/ anywhere, not when it equals 'blocks', which is why the
 * regexp is preserved rather than replaced with a comparison.
 *
 * @param {{code: string, lang: string}} trinket
 * @returns {Array<{name: string, content: string}>}
 */
function parseCodeFiles(trinket) {
  var code;
  var extension;
  var mainName;

  try {
    code = JSON.parse(trinket.code);

    if (!Array.isArray(code)) {
      throw new Error('Not an array');
    }
  }
  catch (e) {
    extension = LANG_EXTENSIONS[trinket.lang] || '.txt';
    mainName  = /blocks/.test(trinket.lang) ? 'main.xml' : 'main' + extension;

    code = [{ name: mainName, content: trinket.code }];
  }

  return code;
}

/**
 * `lib/workers/exports.js` (`addTrinketToArchive`, `var basePath = (trinket.lang
 * || 'other') + '/' + folderName + '_' + trinket.shortCode + '/'`),
 * reimplemented: the directory every one of a
 * trinket's entries lives under.
 *
 * @param {{shortCode: string, name: string, lang: string}} trinket
 * @returns {string} With a trailing '/'.
 */
function archiveBasePath(trinket) {
  return (trinket.lang || 'other') + '/' +
    sanitizeFolderName(trinket.name || trinket.shortCode) + '_' +
    trinket.shortCode + '/';
}

// A base for `new URL`, used only to give a RELATIVE url a pathname. It is
// never part of any asserted value.
var URL_BASE = 'https://parity.invalid';

/**
 * `lib/workers/exports.js` (`addTrinketToArchive`, `var assetFile =
 * path.basename(parseLegacy(asset.url).pathname)` and the `asset.name ||
 * assetFile` archive entry), reimplemented: the name an asset is stored
 * under.
 *
 * `asset.name` when it has one, otherwise the basename of the url's pathname.
 *
 * `new URL` and NOT `url.parse`: the latter emits DEP0169 and this tooling's
 * stderr is inside the stream the zero-warning gate judges. The base is what
 * makes the substitution faithful rather than merely warning-free - `url.parse`
 * returns a pathname for a RELATIVE url too, and bare `new URL('x/y.gif')`
 * throws instead. Only the pathname is read, so the base cannot leak into an
 * assertion; and unlike the application's own six call sites, nothing here
 * needs `url.parse`'s null-protocol behaviour, because no caller of this
 * function branches on the protocol.
 *
 * @param {{name: (string|undefined), url: string}} asset
 * @returns {string}
 */
function archiveAssetName(asset) {
  if (asset.name) {
    return asset.name;
  }

  return path.basename(new URL(asset.url, URL_BASE).pathname);
}

/**
 * CRC-32 of a buffer.
 *
 * `zlib.crc32` was added part-way through the Node 22 line, and `package.json`
 * admits the whole of it, so on an early 22 the function is absent and a gate
 * that assumed it would fail for a reason that has nothing to do with storage.
 * The fallback is the standard reflected table algorithm, verified against
 * `zlib.crc32` by the `archive-layout` case whenever both are available.
 *
 * @param {Buffer} buffer
 * @returns {number} Unsigned 32-bit.
 */
function crc32(buffer) {
  var table;
  var value;
  var i;
  var j;
  var byte;

  if (typeof zlib.crc32 === 'function') {
    return zlib.crc32(buffer) >>> 0;
  }

  table = crc32.table;

  if (!table) {
    table = crc32.table = new Int32Array(256);

    for (i = 0; i < 256; i++) {
      byte = i;

      for (j = 0; j < 8; j++) {
        byte = byte & 1 ? (byte >>> 1) ^ 0xedb88320 : byte >>> 1;
      }

      table[i] = byte;
    }
  }

  value = -1;

  for (i = 0; i < buffer.length; i++) {
    value = (value >>> 8) ^ table[(value ^ buffer[i]) & 0xff];
  }

  return (value ^ -1) >>> 0;
}

/**
 * Reads a ZIP into `{name, content}` records, byte-exactly.
 *
 * WHY NOT `entry.getData()`. A ZIP writer that computes an entry's crc and raw
 * size inside an override of `Writable.prototype.write` loses both when the
 * entry is delivered through `Writable.prototype.end(chunk)`, which does not
 * route through `write()`. Such a writer states crc32=0 and uncompressed size=0
 * in the local header, the data descriptor and the central directory alike, and
 * `adm-zip` cannot recover an entry in that state through `getData()`: it
 * either returns an empty buffer, because it trusts the declared size, or
 * throws a CRC32 failure, because it validates against the declared crc. This
 * reader still has to be able to say what is inside such an archive.
 *
 * `entry.getCompressedData()` is adm-zip's own public accessor for the stored
 * bytes and performs no validation, and the COMPRESSED size is the one length
 * such an archive states truthfully, so inflating from there recovers the bytes
 * exactly - verified against the input. Integrity is not abandoned: where a
 * declared crc32 is actually present it is checked, and where it is absent that
 * is recorded as the defect it is rather than passed over. The verdict rests on
 * `probeApplicationRead` instead, which reads through `getData()` with no
 * bypass; this reader produces the evidence beside it, and the reader version
 * it used is reported on `reader.version`.
 *
 * @param {Buffer} zipBytes
 * @param {Object} [options]
 * @param {string} [options.appRoot] Tree whose adm-zip is used; default this one.
 * @param {Function} [options.AdmZip] A pre-resolved constructor.
 * @returns {{entries: Array<Object>, reader: Object}}
 */
function readArchiveEntries(zipBytes, options) {
  var opts    = options || {};
  var AdmZip  = opts.AdmZip ||
                resolveDependency(opts.appRoot || TOOL_ROOT, 'adm-zip');
  var bytes   = Buffer.isBuffer(zipBytes) ? zipBytes : Buffer.from(zipBytes);
  var zip     = new AdmZip(bytes);
  var entries = [];
  var reader  = {
    library            : 'adm-zip',
    version            : readAdmZipVersion(opts.appRoot || TOOL_ROOT),
    entryCount         : 0,
    crcVerified        : 0,
    crcAbsent          : 0,
    // Set to false by the `getData()` check below on the first entry the
    // application's own read path cannot recover. It starts true and is
    // demonstrated per entry, not assumed: `getDataFailures` carries the
    // evidence either way.
    getDataUsable      : true,
    getDataFailures    : [],
    defect             : null
  };

  zip.getEntries().forEach(function(entry) {
    var name        = entry.entryName;
    var isDirectory = entry.isDirectory;
    var method      = entry.header.method;
    var compressed  = entry.getCompressedData();
    var content;
    var declaredCrc;
    var record;
    var getDataOk;
    var getDataError;

    // 0 is STORED and 8 is DEFLATED; those are the only two methods `archiver`
    // emits, and an unknown one is reported rather than guessed at.
    if (isDirectory) {
      content = Buffer.alloc(0);
    }
    else if (method === 0) {
      content = compressed;
    }
    else if (method === 8) {
      content = zlib.inflateRawSync(compressed);
    }
    else {
      throw new Error(
        'archive entry `' + name + '` uses compression method ' + method +
        ', which neither this reader nor `archiver` produces'
      );
    }

    declaredCrc = entry.header.crc >>> 0;

    // THE LIBRARY'S OWN READ PATH, exercised rather than assumed.
    //
    // `adm-zip` is the ZIP library this repository declares and
    // `lib/controllers/courses.js` requires, and `getData()` is its content
    // accessor and the only one that validates the declared crc32. Inflating
    // `getCompressedData()` above recovers the bytes whatever the archive
    // declares, so on its own it can pass while `getData()` on the same entry
    // fails - which is the state this reader exists to diagnose. `getData()` is
    // therefore called here too and its bytes compared against the
    // independently inflated ones. A throw is captured rather than propagated,
    // because an archive in that state is expected to fail this and the
    // diagnosis below is what reports it.
    try {
      var viaGetData = entry.isDirectory ? Buffer.alloc(0) : entry.getData();
      getDataOk      = Buffer.compare(viaGetData, content) === 0;
      getDataError   = getDataOk ? null :
        'getData() returned ' + viaGetData.length + ' bytes where the ' +
        'independently inflated content is ' + content.length;
    }
    catch (err) {
      getDataOk    = false;
      getDataError = err.message;
    }

    record = {
      name           : name,
      isDirectory    : isDirectory,
      method         : method,
      compressedSize : compressed.length,
      declaredCrc    : declaredCrc,
      declaredSize   : entry.header.size,
      size           : content.length,
      content        : content,
      crcVerified    : null,
      getDataOk      : getDataOk,
      getDataError   : getDataError
    };

    if (!getDataOk) {
      reader.getDataUsable  = false;
      reader.getDataFailures.push({ name : name, error : getDataError });
    }

    if (!isDirectory) {
      if (declaredCrc === 0 && entry.header.size === 0 && content.length > 0) {
        // The writer stated neither a crc nor an uncompressed size for an
        // entry that has content, so there is nothing to verify against.
        reader.crcAbsent++;
        reader.defect = 'archiver 2.1.1 via crc32-stream 2.0.0 writes crc32=0 ' +
          'and uncompressed size=0 in the local header, the data descriptor ' +
          'and the central directory alike. The trigger is the Node stream ' +
          'contract rather than one Node version: crc32-stream 2.0.0 computes ' +
          'both values inside an override of Writable.prototype.write, and ' +
          'Writable.prototype.end(chunk) has not routed through write() for ' +
          'several major Node lines, so zip-stream 1.2.0 appending a buffer or ' +
          'a string with .end(source) records neither. Downgrading the runtime ' +
          'does not repair it. adm-zip 0.4.16 returns an empty buffer for such ' +
          'an entry and adm-zip 0.6.0 throws BAD_CRC, so neither version can ' +
          'read the contents through getData(); this reader inflates ' +
          'getCompressedData() instead. Measured fix, either one: append a ' +
          'stream instead of a buffer at the four lib/workers/exports.js call ' +
          'sites, which makes zip-stream pipe through write() and records a ' +
          'valid crc; or move archiver to a line whose crc32-stream writes ' +
          'through write(). A finding for docs/dependency-inventory.md.';
        reader.getDataUsable = false;
      }
      else {
        record.crcVerified = crc32(content) === declaredCrc;
        reader.crcVerified++;

        if (!record.crcVerified) {
          throw new Error(
            'archive entry `' + name + '` fails its own declared crc32: the ' +
            'archive says ' + declaredCrc.toString(16) + ' and its ' +
            content.length + ' inflated bytes hash to ' +
            crc32(content).toString(16) + '. The archive is corrupt.'
          );
        }
      }
    }

    reader.entryCount++;
    entries.push(record);
  });

  return { entries: entries, reader: reader };
}

/**
 * Reads every entry through the `adm-zip` the tree under test declares, with
 * no bypass, and reports what happened.
 *
 * THIS IS THE ASSERTION THE PERSISTED-FORMAT GATE RESTS ON. `readArchiveEntries`
 * above deliberately avoids `entry.getData()` and inflates
 * `entry.getCompressedData()` instead, which recovers the bytes and makes every
 * layout assertion possible - but a bypass that produces evidence is useful
 * only while it is not also producing a PASS. An export archive that the ZIP
 * library this repository ships cannot open is a broken persisted format
 * whatever the layout inside it looks like, so the read is performed here with
 * no bypass at all and its result is what the `archive-layout` case fails on.
 *
 * The comparison value is computed here rather than taken from the diagnostic
 * reader, so this probe stands alone and runs FIRST: the stored payload is
 * inflated with core zlib and `getData()` must return exactly those bytes.
 * Comparing the bytes rather than asking whether the call threw is what covers
 * both ways a reader fails on an entry whose crc and size were never recorded -
 * a CRC32 failure raised, and an empty buffer returned with no error at all,
 * which a "did it throw" check would pass.
 *
 * @param {Buffer} zipBytes The archive.
 * @param {Function} [AdmZip] The constructor from the tree under test.
 * @param {Object} [options]
 * @param {string} [options.appRoot] Tree whose adm-zip is used and reported.
 * @returns {{library: string, version: (string|null), entries: number,
 *   files: number, readable: number, unreadable: Array<Object>}}
 */
function probeApplicationRead(zipBytes, AdmZip, options) {
  var opts        = options || {};
  var root        = opts.appRoot || TOOL_ROOT;
  var Constructor = AdmZip || resolveDependency(root, 'adm-zip');
  var bytes       = Buffer.isBuffer(zipBytes) ? zipBytes : Buffer.from(zipBytes);
  var zip         = new Constructor(bytes);
  var result      = {
    library    : 'adm-zip',
    version    : readAdmZipVersion(root),
    entries    : 0,
    files      : 0,
    readable   : 0,
    unreadable : []
  };

  zip.getEntries().forEach(function(entry) {
    var compressed;
    var stored;
    var data;

    result.entries++;

    if (entry.isDirectory) {
      return undefined;
    }

    result.files++;

    compressed = entry.getCompressedData();
    stored     = entry.header.method === 0
      ? compressed
      : zlib.inflateRawSync(compressed);

    try {
      data = entry.getData();
    }
    catch (err) {
      result.unreadable.push({
        name         : entry.entryName,
        reason       : 'getData() threw: ' + ((err && err.message) || err),
        declaredCrc  : entry.header.crc >>> 0,
        declaredSize : entry.header.size,
        storedBytes  : stored.length
      });

      return undefined;
    }

    if (!data || !Buffer.isBuffer(data) || !data.equals(stored)) {
      result.unreadable.push({
        name         : entry.entryName,
        reason       : 'getData() returned ' +
                       ((data && data.length) || 0) + ' byte(s) where the ' +
                       'archive stores ' + stored.length + ', with no error',
        declaredCrc  : entry.header.crc >>> 0,
        declaredSize : entry.header.size,
        storedBytes  : stored.length
      });

      return undefined;
    }

    result.readable++;

    return undefined;
  });

  return result;
}

/**
 * The `adm-zip` version actually in use, for the report.
 *
 * Read from the resolved package rather than stated in a comment, so the
 * artifact records which reader produced the result it carries.
 *
 * @param {string} appRoot
 * @returns {(string|null)}
 */
function readAdmZipVersion(appRoot) {
  try {
    return resolveDependency(appRoot, 'adm-zip/package.json').version;
  }
  catch (err) {
    return null;
  }
}

/**
 * Asserts the internal structure of an export archive.
 *
 * THE SHARED ASSERTION. `test/parity/worker.js` calls this on the archive the
 * worker actually produces, and the `archive-layout` case below calls it on one
 * built here from fixed trinket specs. It is therefore PURE - bytes in,
 * assertions out - and touches no filesystem, no database and no fixture. The
 * only optional input is `expected`, and without it the function still asserts
 * every invariant the archive states about itself.
 *
 * WHAT IS ASSERTED, and the writer each claim pins:
 *
 *   manifest         a top-level `manifest.json`, valid JSON, with
 *                    `exportedAt`, `trinkets`, `totalTrinkets` and
 *                    `failedTrinkets`, and `trinkets.length ===
 *                    totalTrinkets`. `createExportArchive` appends it.
 *   directories      every trinket's entries live under
 *                    `<lang>/<sanitizeFolderName(name || shortCode)>_
 *                    <shortCode>/`, which is `addTrinketToArchive`'s
 *                    `basePath`. The directory name is recomputed from the
 *                    manifest entry through this file's own sanitizer, so a
 *                    change to the sanitizer's rules fails here.
 *   metadata         each such directory holds a `metadata.json` whose
 *                    `shortCode`, `name` and `lang` match the manifest entry,
 *                    and whose `url` ends in `/<lang>/<shortCode>`.
 *   code files       `parseCodeFiles`' output, at `<basePath><file.name>`.
 *   assets           downloaded assets, at
 *                    `<basePath>assets/<asset.name || basename>`.
 *   the whole        nothing else. An entry outside `manifest.json` and the
 *                    manifest's own trinket directories is a failure, because
 *                    a stray entry is how a leaked temporary file or another
 *                    user's trinket would show up in an export.
 *
 * `expected` additionally asserts CONTENT: each code file's exact bytes, each
 * asset's exact bytes, and that the archive contains no entry beyond the
 * expected set. Assets are matched by the same `asset.name || basename(url)`
 * rule the application uses.
 *
 * @param {Buffer} zipBytes The archive.
 * @param {Object} [expected]
 * @param {Array<Object>} [expected.trinkets] `{shortCode, name, lang, code,
 *   assets}` specs; `assets` entries are `{name, url, content}`.
 * @param {number} [expected.failedTrinkets] Asserted when supplied.
 * @param {Object} [options] Passed to `readArchiveEntries`.
 * @returns {{manifest: Object, trinkets: Array<Object>, entries: Array<string>,
 *   reader: Object}}
 * @throws {assert.AssertionError} On any structural or content mismatch.
 */
function assertArchiveLayout(zipBytes, expected, options) {
  var read     = readArchiveEntries(zipBytes, options);
  var byName   = {};
  var names    = [];
  var expect   = expected || {};
  var manifest;
  var manifestEntry;
  var described = [];
  var allowed   = ['manifest.json'];

  read.entries.forEach(function(entry) {
    byName[entry.name] = entry;

    if (!entry.isDirectory) {
      names.push(entry.name);
    }
  });

  names.sort();

  // --- the manifest -------------------------------------------------------
  manifestEntry = byName['manifest.json'];

  assert.ok(
    manifestEntry,
    'lib/workers/exports.js (createExportArchive) appends a top-level ' +
    'manifest.json; the ' +
    'archive holds [' + names.join(', ') + ']'
  );
  assert.strictEqual(
    manifestEntry.isDirectory, false,
    'manifest.json must be a file'
  );

  manifest = JSON.parse(manifestEntry.content.toString('utf8'));

  assert.ok(
    Array.isArray(manifest.trinkets),
    'the manifest\'s `trinkets` must be an array ' +
    '(lib/workers/exports.js, createExportArchive: `trinkets: []`)'
  );
  assert.strictEqual(
    typeof manifest.exportedAt, 'string',
    'the manifest carries an `exportedAt` timestamp ' +
    '(lib/workers/exports.js, createExportArchive: `exportedAt: new ' +
    'Date().toISOString()`)'
  );
  assert.ok(
    !isNaN(Date.parse(manifest.exportedAt)),
    '`exportedAt` must parse as a date; got ' + JSON.stringify(manifest.exportedAt)
  );
  assert.strictEqual(
    typeof manifest.totalTrinkets, 'number',
    'the manifest carries `totalTrinkets` (lib/workers/exports.js, ' +
    'createExportArchive: `manifest.totalTrinkets = processed`)'
  );
  assert.strictEqual(
    typeof manifest.failedTrinkets, 'number',
    'the manifest carries `failedTrinkets` (lib/workers/exports.js, ' +
    'createExportArchive: `manifest.failedTrinkets = failed`)'
  );
  assert.strictEqual(
    manifest.trinkets.length, manifest.totalTrinkets,
    'one manifest entry is pushed per processed trinket ' +
    '(lib/workers/exports.js, createExportArchive: `processed++`) and ' +
    '`totalTrinkets` is that same counter ' +
    '(:250), so they must agree'
  );

  if (expect.failedTrinkets !== undefined) {
    assert.strictEqual(
      manifest.failedTrinkets, expect.failedTrinkets,
      'failedTrinkets'
    );
  }

  // --- one directory per manifest entry -----------------------------------
  manifest.trinkets.forEach(function(trinket) {
    var basePath = archiveBasePath(trinket);
    var metadata = byName[basePath + 'metadata.json'];
    var parsed;

    assert.ok(
      metadata,
      'lib/workers/exports.js (addTrinketToArchive) writes ' + basePath +
      'metadata.json; the ' +
      'archive holds [' + names.join(', ') + ']. The directory name is ' +
      'recomputed from the manifest entry through sanitizeFolderName, so a ' +
      'mismatch here means either the entry is absent or the sanitizer\'s ' +
      'rules changed.'
    );

    parsed = JSON.parse(metadata.content.toString('utf8'));

    assert.strictEqual(parsed.shortCode, trinket.shortCode,
      basePath + 'metadata.json shortCode');
    assert.strictEqual(parsed.name, trinket.name,
      basePath + 'metadata.json name');
    assert.strictEqual(parsed.lang, trinket.lang,
      basePath + 'metadata.json lang');
    assert.strictEqual(typeof parsed.url, 'string',
      basePath + 'metadata.json url must be a string ' +
      '(lib/workers/exports.js, addTrinketToArchive: the `metadata` object)');
    assert.ok(
      parsed.url.endsWith('/' + trinket.lang + '/' + trinket.shortCode),
      basePath + 'metadata.json url is config.url + \'/\' + lang + \'/\' + ' +
      'shortCode (lib/workers/exports.js, addTrinketToArchive: `url: ' +
      'config.url + \'/\' + trinket.lang + \'/\' + trinket.shortCode`); got ' +
      parsed.url
    );

    ['created', 'lastUpdated'].forEach(function(field) {
      if (parsed[field] !== undefined && parsed[field] !== null) {
        assert.ok(
          !isNaN(Date.parse(parsed[field])),
          basePath + 'metadata.json ' + field + ' must parse as a date; got ' +
          JSON.stringify(parsed[field])
        );
      }
    });

    described.push({ trinket: trinket, basePath: basePath, metadata: parsed });
    allowed.push(basePath + 'metadata.json');
  });

  // --- expected content ---------------------------------------------------
  if (expect.trinkets) {
    assert.strictEqual(
      manifest.trinkets.length, expect.trinkets.length,
      'the manifest lists one entry per archived trinket'
    );

    expect.trinkets.forEach(function(spec) {
      var basePath = archiveBasePath(spec);

      parseCodeFiles(spec).forEach(function(file) {
        var entry = byName[basePath + file.name];

        assert.ok(
          entry,
          'lib/workers/exports.js (addTrinketToArchive: `archive.append(' +
          'file.content || \'\', { name: basePath + file.name })`) writes ' +
          basePath + file.name +
          '; the archive holds [' + names.join(', ') + ']'
        );
        assert.strictEqual(
          entry.content.toString('utf8'), file.content || '',
          basePath + file.name + ' content. `archive.append(file.content || \'\')`' +
          ' at :295 substitutes an empty string for a falsy content, which is ' +
          'preserved.'
        );

        allowed.push(basePath + file.name);
      });

      (spec.assets || []).forEach(function(asset) {
        var assetName = archiveAssetName(asset);
        var entry     = byName[basePath + 'assets/' + assetName];

        assert.ok(
          entry,
          'lib/workers/exports.js (addTrinketToArchive: the `basePath + ' +
          '\'assets/\' + (asset.name || assetFile)` entry) writes ' +
          basePath + 'assets/' +
          assetName + '; the archive holds [' + names.join(', ') + ']'
        );

        if (asset.content !== undefined) {
          assert.ok(
            entry.content.equals(Buffer.isBuffer(asset.content)
              ? asset.content
              : Buffer.from(asset.content)),
            basePath + 'assets/' + assetName + ' must hold the downloaded ' +
            'bytes exactly; an asset is stored by :308 as the Buffer ' +
            'downloadAsset resolved, so any transformation here would ' +
            'corrupt every exported image'
          );
        }

        allowed.push(basePath + 'assets/' + assetName);
      });
    });

    assert.deepStrictEqual(
      names, allowed.slice().sort(),
      'the archive must contain exactly the manifest, each trinket\'s ' +
      'metadata.json, its parsed code files and its downloaded assets - and ' +
      'nothing else. A stray entry is how a leaked temporary file or another ' +
      'owner\'s trinket would reach an export.'
    );
  }
  else {
    // Without an expectation the entry set cannot be pinned exactly, but every
    // entry must still belong to a directory the manifest declares. An entry
    // under no declared trinket is a leak either way.
    names.forEach(function(name) {
      var owned = name === 'manifest.json' || described.some(function(item) {
        return name.indexOf(item.basePath) === 0;
      });

      assert.ok(
        owned,
        'archive entry `' + name + '` lives outside manifest.json and every ' +
        'trinket directory the manifest declares'
      );
    });
  }

  return {
    manifest : manifest,
    trinkets : described,
    entries  : names,
    reader   : read.reader
  };
}

/**
 * Builds a ZIP from `{name, content}` records with the tree's own `archiver`.
 *
 * Used only to produce input for the `archive-*` cases. It uses the same writer
 * and the same options as `lib/workers/exports.js`'s `createExportArchive` -
 * `archiver('zip', {zlib: {level: 6}})` - so the bytes the reader is asserted
 * against are the bytes the application's writer really emits, including
 * whatever each entry declares about its own crc and uncompressed size.
 * Building with a different writer would conceal exactly that.
 *
 * @param {Array<{name: string, content: (Buffer|string)}>} entries Appended in
 *   the order given, one archive entry each.
 * @param {Object} [options]
 * @param {Function} [options.archiver] A pre-resolved archiver factory.
 * @param {string} [options.appRoot] Tree whose `archiver` is resolved when no
 *   factory is supplied; defaults to this tool's own root.
 * @returns {Promise<Buffer>}
 */
function buildArchive(entries, options) {
  var opts    = options || {};
  var factory = opts.archiver ||
                resolveDependency(opts.appRoot || TOOL_ROOT, 'archiver');

  return new Promise(function(resolve, reject) {
    var archive = factory('zip', { zlib: { level: 6 } });
    var chunks  = [];
    var settled = false;

    function finish(err, value) {
      if (settled) {
        return;
      }
      settled = true;

      if (err) {
        reject(err);
        return;
      }

      resolve(value);
    }

    archive.on('data', function(chunk) {
      chunks.push(chunk);
    });
    archive.on('error', function(err) {
      finish(err, null);
    });
    archive.on('end', function() {
      finish(null, Buffer.concat(chunks));
    });

    try {
      entries.forEach(function(entry) {
        archive.append(entry.content, { name: entry.name });
      });
      archive.finalize();
    }
    catch (err) {
      finish(err, null);
    }
  });
}


// ---------------------------------------------------------------------------
// Case helpers
// ---------------------------------------------------------------------------

/**
 * A synthetic container.
 *
 * `_fileToContainer` reads only `name`, `host` and `fileId`, and no bucket in
 * `config/default.yaml`'s `aws.buckets` declares `fileId` - recorded
 * independently in seed.js's note on KEYS. `_fileToContainer`'s
 * `if (container.fileId)` branch is therefore unreachable through any public
 * entry point, and passing a synthetic container is the only way to assert the
 * naming it produces rather than asserting against a shape nothing has written.
 *
 * @param {string} name Bucket name.
 * @param {string} [fileId]
 * @returns {{name: string, host: string, fileId: (string|undefined)}}
 */
function container(name, fileId) {
  var value = { name: name, host: 'https://' + name + '.parity.invalid' };

  if (fileId !== undefined) {
    value.fileId = fileId;
  }

  return value;
}

/**
 * Reads a stored object and fails with the bucket's actual key list when it is
 * absent.
 *
 * The key IS the assertion in almost every case here, so "absent" has to report
 * what WAS written - otherwise a digest change reads as a bare undefined.
 *
 * @param {Object} ctx
 * @param {string} bucket
 * @param {string} key
 * @returns {Object} The fixture's record: bucket, key, body, contentType,
 *   contentDisposition, etag, size.
 */
function storedObject(ctx, bucket, key) {
  var record = ctx.awsFixture.get(bucket, key);

  assert.ok(
    record,
    'no object at ' + bucket + '/' + key + '. That bucket holds [' +
    ctx.awsFixture.list(bucket).join(', ') + ']. Because the key is the sha1 ' +
    'digest of the contents (lib/util/file.js:32-43), a key that is merely ' +
    'different is a silently orphaned object, not an error.'
  );

  return record;
}

/**
 * The fixture's call log for one operation, in order.
 *
 * @param {Object} ctx
 * @param {string} operation
 * @returns {Array<Object>}
 */
function callsFor(ctx, operation) {
  return ctx.awsFixture.calls().filter(function(entry) {
    return entry.operation === operation;
  });
}

/**
 * Records what a case MEASURED, for the artifact.
 *
 * An assertion proves a value and then throws it away. That is enough while
 * someone is watching the run and useless afterwards: `{status: 'passed'}` says
 * a key was correct without saying what the key WAS, so a committed result
 * cannot be reviewed, cannot be diffed against another tree's, and cannot show
 * a reader the sha1 the contract turns on. This contract cannot rest on prose,
 * and a pass/fail list is prose with a tickmark.
 *
 * So every case that establishes a contract value records it here, and it
 * reaches the JSON under that case's `evidence`. The values are the ones the
 * APPLICATION produced, read back from the store, the document or the call log
 * - never the expectation, which is already in this file's source. Assertions
 * are what make them right; this is what makes them inspectable.
 *
 * `runCase` supplies and collects the bag, so a case cannot leak evidence into
 * its neighbour, and a case that throws halfway still reports what it had
 * measured before it did.
 *
 * @param {Object} ctx The run context.
 * @param {Object} values Measured values, merged onto the bag.
 * @returns {undefined}
 */
function measured(ctx, values) {
  if (!ctx || !ctx.evidence) {
    return undefined;
  }

  Object.keys(values).forEach(function(key) {
    ctx.evidence[key] = values[key];
  });

  return undefined;
}

/**
 * Asserts the S3 fixture reported no fault of its own.
 *
 * `errors()` is empty in the healthy state, so asserting it turns "the case
 * passed" into "the case passed and the fixture was sound while it did" - which
 * matters because an unusable store root would otherwise surface as a missing
 * object, and a missing object is exactly what a broken digest looks like.
 *
 * @param {Object} ctx
 * @param {string} where
 * @returns {undefined}
 */
function assertFixtureHealthy(ctx, where) {
  assert.deepStrictEqual(
    ctx.awsFixture.errors(), [],
    'the S3 fixture recorded a fault of its own during ' + where + ', so a ' +
    'missing object here would not be evidence about the application'
  );

  return undefined;
}

/**
 * Runs `_fileToContainer` against a container and returns everything asserted
 * about it.
 *
 * `_fileToContainer` is called directly, and legitimately: it is assigned on
 * the instance and is the only entry point that accepts a container, which is
 * what the fileId cases require.
 *
 * @param {Object} ctx
 * @param {Object} spec {scratchName, payload, filename, contentType, container}
 * @returns {Promise<{upload: Object, err: *, result: *}>}
 */
async function fileToContainer(ctx, spec) {
  var source = upload(
    ctx, spec.scratchName, spec.payload, spec.filename, spec.contentType,
    { harnessOwned : !!spec.harnessOwned }
  );
  var outcome = await callback(function(done) {
    ctx.FileUtil._fileToContainer(source, spec.container, true, done);
  });

  return { upload: source, err: outcome.err, result: outcome.result };
}

/**
 * Asserts the success-shaped result `_fileToContainer` passes to its callback.
 *
 * All five fields, because `path` and `name` are the same value read by
 * different callers - `lib/controllers/files.js` stores `name` while the
 * material record keeps `path` - and a change that set only one of them would
 * pass a laxer assertion.
 *
 * @param {Object} result
 * @param {Object} expect {host, key, digest, size}
 * @returns {undefined}
 */
function assertUploadResult(result, expect) {
  assert.deepStrictEqual(
    result,
    {
      host : expect.host,
      path : expect.key,
      name : expect.key,
      hash : expect.digest,
      size : expect.size
    },
    'the callback shape at lib/util/file.js:53-59'
  );

  return undefined;
}


// ---------------------------------------------------------------------------
// The cases
// ---------------------------------------------------------------------------
// Ordered, and run in order. Each carries the contract it pins in its `pins`
// field, so a failure leads straight to it. Nothing between cases is shared
// except the store and the database, both of which are per-run.

var cases = [];

cases.push({
  name : 'fixture-preflight',
  pins : 'test/parity/fixtures/aws.js, config/default.yaml:236-237',
  run  : async function(ctx) {
    var status = ctx.awsFixture.status();

    assert.strictEqual(status.patched, true,
      'AWS.S3 must be the fixture, or every case below would reach real S3');
    assert.strictEqual(status.installed, true, 'the fixture must be installed');
    assert.strictEqual(status.appRoot, ctx.appRoot,
      'the fixture must have patched the tree under test');

    // The application's own module object, not the fixture's bookkeeping.
    // `lib/util/file.js` binds `config/aws` at require time and calls
    // `new aws.S3()` inside `_upload`, so THIS is the reference every upload
    // resolves through.
    assert.strictEqual(ctx.awsModule.S3, ctx.awsFixture.ParityS3,
      'config/aws.S3 must BE the fixture constructor. status().patched checks ' +
      'the reference the fixture retained; this checks the require-cache entry ' +
      'lib/util/file.js:4 actually binds, and only the two together rule out a ' +
      'second resolved copy of config/aws serving the application.');
    assertFixtureHealthy(ctx, 'preflight');

    // The whitelist is a MEASUREMENT this file depends on: `ipynb` is the only
    // entry, so the .ipynb upload is the only override case that exists. If a
    // second entry ever appears, the content-type cases below stop being
    // exhaustive and this assertion says so.
    assert.deepStrictEqual(
      ctx.config.app.extensionWhitelist, { ipynb: 'text/plain' },
      'config/default.yaml:236-237 declares exactly one whitelisted extension. ' +
      'A new entry means lib/util/file.js:28-30 has another override branch ' +
      'and this file needs another case.'
    );

    // Redis must be off: lib/util/queues.js would otherwise construct Bull
    // against localhost:6379 from inside a storage gate.
    assert.strictEqual(ctx.config.db.redis.enabled, false,
      'db.redis.enabled must be false in the composed NODE_CONFIG');

    // The seeded objects have to be in the store before the pre-migration cases
    // read them back.
    seed.s3Manifest().forEach(function(entry) {
      assert.ok(
        ctx.awsFixture.has(entry.bucket, entry.key),
        'the seeded object ' + entry.bucket + '/' + entry.key + ' must be ' +
        'pre-populated; the pre-migration cases read it through the ' +
        'application\'s own read path'
      );
    });

    measured(ctx, {
      s3Patched          : status.patched,
      extensionWhitelist : ctx.config.app.extensionWhitelist,
      redisEnabled       : ctx.config.db.redis.enabled,
      seededObjects      : seed.s3Manifest().map(function(entry) {
        return entry.bucket + '/' + entry.key;
      })
    });
  }
});

cases.push({
  name : 'digest-agreement',
  pins : 'lib/util/file.js:66-78',
  run  : async function(ctx) {
    var names = Object.keys(PAYLOADS);
    var i;
    var name;
    var source;
    var digest;

    // The application's STREAMING implementation, over every payload, compared
    // with this file's buffer implementation AND with the committed constant.
    // Without this case, every key assertion below would rest on an unproven
    // assumption that the two agree - and they would agree with each other even
    // if both were wrong.
    for (i = 0; i < names.length; i++) {
      name   = names[i];
      source = path.join(ctx.scratch, 'digest-' + name);

      fs.writeFileSync(source, PAYLOADS[name]);
      ctx.harnessOwned.push(source);

      digest = (await callback(function(done) {
        // hashcontents calls back with the digest ALONE - no error argument -
        // so it is adapted here rather than the module being reshaped.
        ctx.FileUtil.hashcontents(source, function(value) {
          done(null, value);
        });
      })).result;

      assert.strictEqual(digest, EXPECTED_DIGESTS[name],
        'the streaming sha1 of payload `' + name + '` must equal the ' +
        'committed digest');
      assert.strictEqual(digest, sha1Hex(PAYLOADS[name]),
        'the streaming and buffer implementations must agree for `' + name + '`');
      assert.strictEqual(digest.length, 40,
        'a hex sha1 digest is 40 characters; a different length means the ' +
        'encoding changed and every stored key with it');
      assert.match(digest, /^[0-9a-f]{40}$/,
        'the digest must be lowercase hex');

      // `hashcontents` does not unlink; only `_fileToContainer` does. The
      // runner removes it, so a failure above cannot leave it behind.
      assert.strictEqual(fs.existsSync(source), true,
        'hashcontents must not remove the file it read');

      // The digest the APPLICATION's streaming implementation produced, per
      // payload. Every key below is built from one of these, so this is the
      // root value the whole contract rests on.
      ctx.evidence[name] = { bytes : PAYLOADS[name].length, sha1 : digest };
    }
  }
});

cases.push({
  name : 'upload-parameters',
  pins : 'lib/util/file.js:10-19, 91-94',
  run  : async function(ctx) {
    var bucket = ctx.config.aws.buckets.materials;
    var key    = DIGESTS.keyBytes + '.txt';
    var source = upload(
      ctx, 'upload-parameters.txt', PAYLOADS.keyBytes,
      'parity-upload.txt', 'text/plain'
    );
    var outcome = await callback(function(done) {
      ctx.FileUtil.uploadMaterialFile(source, done);
    });
    var record = storedObject(ctx, bucket.name, key);
    var logged = callsFor(ctx, 'putObject').filter(function(entry) {
      return entry.key === key;
    });

    assert.strictEqual(outcome.err, null, 'the unlink must succeed');
    assertUploadResult(outcome.result, {
      host   : bucket.host,
      key    : key,
      digest : DIGESTS.keyBytes,
      size   : PAYLOADS.keyBytes.length
    });

    // All four putObject parameters, not merely that a write happened.
    assert.strictEqual(record.bucket, bucket.name,
      'Bucket is container.name (lib/util/file.js:13); uploadMaterialFile ' +
      'selects config.aws.buckets.materials (:92)');
    assert.strictEqual(record.key, key,
      'Key is fileinfo.name (:14), which is the content digest plus the ' +
      'extension (:34,:42)');
    assert.ok(record.body.equals(PAYLOADS.keyBytes),
      'Body is a read stream over the uploaded file (:15,:46), so the stored ' +
      'bytes must equal the uploaded bytes exactly');
    assert.strictEqual(record.contentType, 'text/plain',
      'ContentType is fileinfo.contentType (:16), taken from the upload ' +
      'header (:23) because .txt is not whitelisted');
    assert.strictEqual(record.size, PAYLOADS.keyBytes.length, 'stored length');
    assert.strictEqual(logged.length, 1,
      'exactly one putObject for this key');
    assert.strictEqual(logged[0].bodyType, 'readable',
      'the Body reaches the client as a stream, which is what :45-46\'s ' +
      'comment is about');
    assert.strictEqual(fs.existsSync(source.path), false,
      'the temporary file is unlinked at :52');

    measured(ctx, {
      bucket        : record.bucket,
      key           : record.key,
      contentType   : record.contentType,
      storedBytes   : record.size,
      storedSha1    : sha1Hex(record.body),
      bodyType      : logged[0].bodyType,
      callbackResult: outcome.result,
      sourceUnlinked: fs.existsSync(source.path) === false
    });

    assertFixtureHealthy(ctx, 'upload-parameters');
  }
});

cases.push({
  name : 'key-bare-digest',
  pins : 'lib/util/file.js:26, 32-37',
  run  : async function(ctx) {
    // No dot in the filename, so the extension is '' and the `if (extension)`
    // suffix is not appended.
    var target  = container('parity-keys');
    var outcome = await fileToContainer(ctx, {
      scratchName : 'key-bare',
      payload     : PAYLOADS.keyBytes,
      filename    : 'parity-key-case',
      contentType : 'application/octet-stream',
      container   : target
    });
    var key = DIGESTS.keyBytes;
    var record = storedObject(ctx, target.name, key);

    assert.strictEqual(record.key, key,
      'with no fileId and no extension the Key is the bare 40-character digest');
    assert.strictEqual(key.indexOf('.'), -1,
      'a filename with no dot must not produce a trailing "." - :41 guards the ' +
      'append on a truthy extension');
    assert.ok(record.body.equals(PAYLOADS.keyBytes), 'stored bytes');
    assertUploadResult(outcome.result, {
      host   : target.host,
      key    : key,
      digest : DIGESTS.keyBytes,
      size   : PAYLOADS.keyBytes.length
    });
    assert.strictEqual(fs.existsSync(outcome.upload.path), false, 'unlinked');

    measured(ctx, {
      bucket         : record.bucket,
      key            : record.key,
      digest         : outcome.result.hash,
      declaredFilename: 'parity-key-case',
      suffixes       : { fileId : null, extension : null },
      sourceUnlinked : fs.existsSync(outcome.upload.path) === false
    });
  }
});

cases.push({
  name : 'key-digest-fileId',
  pins : 'lib/util/file.js:38-40',
  run  : async function(ctx) {
    var target  = container('parity-keys-fileid', seed.ids.file);
    var outcome = await fileToContainer(ctx, {
      scratchName : 'key-fileid',
      payload     : PAYLOADS.keyBytes,
      filename    : 'parity-key-case',
      contentType : 'application/octet-stream',
      container   : target
    });
    var key = DIGESTS.keyBytes + '-' + seed.ids.file;

    storedObject(ctx, target.name, key);
    assertUploadResult(outcome.result, {
      host   : target.host,
      key    : key,
      digest : DIGESTS.keyBytes,
      size   : PAYLOADS.keyBytes.length
    });
    assert.strictEqual(outcome.result.hash, DIGESTS.keyBytes,
      '`hash` stays the bare digest even though the Key carries the fileId ' +
      'suffix (:57 reports `digest`, not `fileinfo.name`)');

    measured(ctx, {
      bucket   : target.name,
      key      : outcome.result.name,
      digest   : outcome.result.hash,
      suffixes : { fileId : seed.ids.file, extension : null }
    });
  }
});

cases.push({
  name : 'key-digest-extension',
  pins : 'lib/util/file.js:41-43',
  run  : async function(ctx) {
    var target  = container('parity-keys-ext');
    var outcome = await fileToContainer(ctx, {
      scratchName : 'key-ext.txt',
      payload     : PAYLOADS.keyBytes,
      filename    : 'parity-key-case.txt',
      contentType : 'text/plain',
      container   : target
    });
    var key = DIGESTS.keyBytes + '.txt';

    storedObject(ctx, target.name, key);
    assertUploadResult(outcome.result, {
      host   : target.host,
      key    : key,
      digest : DIGESTS.keyBytes,
      size   : PAYLOADS.keyBytes.length
    });

    measured(ctx, {
      bucket   : target.name,
      key      : outcome.result.name,
      digest   : outcome.result.hash,
      suffixes : { fileId : null, extension : 'txt' }
    });
  }
});

cases.push({
  name : 'key-digest-fileId-extension',
  pins : 'lib/util/file.js:38-43',
  run  : async function(ctx) {
    var target  = container('parity-keys-both', seed.ids.notebookFile);
    var outcome = await fileToContainer(ctx, {
      scratchName : 'key-both.txt',
      payload     : PAYLOADS.keyBytes,
      filename    : 'parity-key-case.txt',
      contentType : 'text/plain',
      container   : target
    });
    var key = DIGESTS.keyBytes + '-' + seed.ids.notebookFile + '.txt';

    storedObject(ctx, target.name, key);
    assertUploadResult(outcome.result, {
      host   : target.host,
      key    : key,
      digest : DIGESTS.keyBytes,
      size   : PAYLOADS.keyBytes.length
    });

    // The order of the two suffixes is part of the contract: `_fileToContainer`
    // appends the fileId first and the extension second, so the extension is
    // always last and the key remains recognisable by its file type.
    assert.ok(key.endsWith('.txt'), 'the extension is appended last');

    measured(ctx, {
      bucket   : target.name,
      key      : outcome.result.name,
      digest   : outcome.result.hash,
      suffixes : { fileId : seed.ids.notebookFile, extension : 'txt' }
    });
  }
});

cases.push({
  name : 'key-last-dot-extension',
  pins : 'lib/util/file.js:26',
  run  : async function(ctx) {
    // Three dots. `_fileToContainer` derives the extension with
    // `lastIndexOf('.')`, so it is 'gz' and not 'tar.gz' - and certainly not
    // 'parity-last'.
    var target  = container('parity-keys-multidot');
    var outcome = await fileToContainer(ctx, {
      scratchName : 'key-multidot.tar.gz',
      payload     : PAYLOADS.multiDotBytes,
      filename    : 'parity.last.tar.gz',
      contentType : 'application/gzip',
      container   : target
    });
    var key = DIGESTS.multiDotBytes + '.gz';

    storedObject(ctx, target.name, key);
    assertUploadResult(outcome.result, {
      host   : target.host,
      key    : key,
      digest : DIGESTS.multiDotBytes,
      size   : PAYLOADS.multiDotBytes.length
    });
    assert.deepStrictEqual(
      ctx.awsFixture.list(target.name), [key],
      'exactly one object in the container, keyed by the digest and the LAST ' +
      'extension. Had :26 taken the FIRST dot, the key would have ended ' +
      '".last.tar.gz"; had it taken the whole filename, ".parity.last.tar.gz".'
    );

    measured(ctx, {
      bucket           : target.name,
      declaredFilename : 'parity.last.tar.gz',
      key              : outcome.result.name,
      digest           : outcome.result.hash,
      suffixes         : { fileId : null, extension : 'gz' },
      bucketContents   : ctx.awsFixture.list(target.name)
    });
  }
});

cases.push({
  name : 'content-type-override-ipynb',
  pins : 'lib/util/file.js:28-30, config/default.yaml:236-237',
  run  : async function(ctx) {
    var bucket = ctx.config.aws.buckets.materials;
    var key    = DIGESTS.notebookBytes + '.ipynb';
    var source = upload(
      ctx, 'override.ipynb', PAYLOADS.notebookBytes,
      'parity-notebook.ipynb', 'application/x-ipynb+json'
    );
    var outcome = await callback(function(done) {
      ctx.FileUtil.uploadMaterialFile(source, done);
    });
    var record = storedObject(ctx, bucket.name, key);

    assert.strictEqual(record.contentType, 'text/plain',
      'the whitelist entry for `ipynb` REPLACES the declared ' +
      'application/x-ipynb+json (lib/util/file.js:28-30)');
    assert.notStrictEqual(record.contentType, 'application/x-ipynb+json',
      'the declared type must not survive the override');
    assert.ok(record.body.equals(PAYLOADS.notebookBytes),
      'the override changes the content type and nothing else - the bytes, and ' +
      'therefore the key, are untouched');
    assertUploadResult(outcome.result, {
      host   : bucket.host,
      key    : key,
      digest : DIGESTS.notebookBytes,
      size   : PAYLOADS.notebookBytes.length
    });

    measured(ctx, {
      bucket             : record.bucket,
      key                : record.key,
      declaredContentType: 'application/x-ipynb+json',
      storedContentType  : record.contentType,
      overridden         : record.contentType !== 'application/x-ipynb+json',
      whitelistEntry     : ctx.config.app.extensionWhitelist.ipynb
    });
  }
});

cases.push({
  name : 'content-type-passthrough',
  pins : 'lib/util/file.js:23, 28-30',
  run  : async function(ctx) {
    var bucket = ctx.config.aws.buckets.materials;
    var key    = DIGESTS.passthroughBytes + '.bin';
    var source = upload(
      ctx, 'passthrough.bin', PAYLOADS.passthroughBytes,
      'parity-passthrough.bin', 'application/octet-stream'
    );

    await callback(function(done) {
      ctx.FileUtil.uploadMaterialFile(source, done);
    });

    measured(ctx, {
      bucket             : bucket.name,
      key                : key,
      declaredContentType: 'application/octet-stream',
      storedContentType  : storedObject(ctx, bucket.name, key).contentType,
      extension          : 'bin',
      whitelisted        : Object.prototype.hasOwnProperty.call(
        ctx.config.app.extensionWhitelist, 'bin'
      )
    });

    assert.strictEqual(
      storedObject(ctx, bucket.name, key).contentType,
      'application/octet-stream',
      'an extension the whitelist does not name leaves the upload\'s own ' +
      'content type in place (:23), which is the other half of the override ' +
      'branch and the half a one-sided assertion would miss'
    );
  }
});

cases.push({
  name : 'swallowed-upload-error',
  pins : 'lib/util/file.js:48-59',
  run  : async function(ctx) {
    // An empty Bucket makes the fixture answer MissingRequiredParameter, which
    // is the real SDK's client-side rejection. Nothing about the application is
    // stubbed to produce it.
    var target = container('');
    var key    = DIGESTS.failBytes + '.txt';
    var captured = await captureConsoleLog(async function() {
      return await fileToContainer(ctx, {
        scratchName : 'swallowed.txt',
        payload     : PAYLOADS.failBytes,
        filename    : 'parity-fail.txt',
        contentType : 'text/plain',
        container   : target
      });
    });
    var outcome = captured.value;

    // Logged - `_fileToContainer` does `err && console.log(err)`, so the error
    // was reported...
    assert.strictEqual(captured.logged.length, 1,
      'the upload error is logged exactly once at :49');
    assert.strictEqual(captured.logged[0].length, 1,
      'console.log receives the error object alone');
    assert.strictEqual(captured.logged[0][0].code, 'MissingRequiredParameter',
      'the logged value is the S3 error');

    // ...and then discarded. The callback fires with the SUCCESS shape and the
    // upload error never reaches the caller. That is the behaviour under test
    // rather than a defect to repair here: a caller cannot distinguish a stored
    // object from a lost one, and every consumer of this callback is written as
    // though the upload succeeded.
    assert.strictEqual(outcome.err, null,
      'the callback\'s error argument is the UNLINK\'s (:52), never the ' +
      'upload\'s; the upload error was dropped at :49');
    assertUploadResult(outcome.result, {
      host   : target.host,
      key    : key,
      digest : DIGESTS.failBytes,
      size   : PAYLOADS.failBytes.length
    });

    // Nothing was stored, which is what makes the swallow consequential.
    assert.deepStrictEqual(ctx.awsFixture.list(''), [],
      'a rejected putObject stores nothing');
    assert.strictEqual(
      ctx.awsFixture.objects().some(function(entry) { return entry.key === key; }),
      false,
      'no object anywhere carries the failed upload\'s key'
    );

    // And the temporary file is still removed, on the failing path as well.
    assert.strictEqual(fs.existsSync(outcome.upload.path), false,
      ':52 runs whether the upload succeeded or not');

    measured(ctx, {
      key                : key,
      loggedErrorCode    : captured.logged[0][0].code,
      loggedCallCount    : captured.logged.length,
      callbackError      : describeValue(outcome.err),
      callbackResult     : outcome.result,
      storedAnywhere     : ctx.awsFixture.objects().some(function(entry) {
        return entry.key === key;
      }),
      sourceUnlinked     : fs.existsSync(outcome.upload.path) === false
    });

    assertFixtureHealthy(ctx, 'swallowed-upload-error');
  }
});

cases.push({
  name : 'temp-file-cleanup-both-paths',
  pins : 'lib/util/file.js:52',
  run  : async function(ctx) {
    var good = await fileToContainer(ctx, {
      scratchName : 'cleanup-good.txt',
      payload     : PAYLOADS.passthroughBytes,
      filename    : 'parity-cleanup.txt',
      contentType : 'text/plain',
      container   : container('parity-cleanup')
    });
    var bad = await captureConsoleLog(async function() {
      return await fileToContainer(ctx, {
        scratchName : 'cleanup-bad.txt',
        payload     : PAYLOADS.passthroughBytes,
        filename    : 'parity-cleanup.txt',
        contentType : 'text/plain',
        container   : container('')
      });
    });

    // Both outcomes, side by side, because `_fileToContainer`'s `fs.unlink`
    // sits OUTSIDE its `err && console.log(err)` check, and a conversion that
    // moved it inside would leave the upload directory filling up only on
    // failures - the slowest possible way to find out.
    assert.strictEqual(fs.existsSync(good.upload.path), false,
      'the temporary file is removed after a successful upload');
    assert.strictEqual(fs.existsSync(bad.value.upload.path), false,
      'the temporary file is removed after a failed upload too');
    assert.strictEqual(bad.logged.length, 1, 'the failure was logged');

    measured(ctx, {
      successPathUnlinked : fs.existsSync(good.upload.path) === false,
      failurePathUnlinked : fs.existsSync(bad.value.upload.path) === false,
      failureLogged       : bad.logged.length
    });
  }
});

cases.push({
  name : 'materials-read',
  pins : 'lib/util/file.js:80-89',
  run  : async function(ctx) {
    var descriptor = seed.storage({ exports: false }).materialText;
    var expected   = Buffer.from(seed.fixtures.bytes.materialText.base64, 'base64');
    var before     = callsFor(ctx, 'createReadStream').length;
    var stream     = ctx.FileUtil.downloadMaterialFile(descriptor.key);
    var body;
    var reads;

    // The request-object form: `getObject({...}).createReadStream()`, not the
    // callback form. Both exist on the client and they behave differently on a
    // miss, so which one is used is part of the contract.
    assert.ok(stream instanceof Readable,
      'downloadMaterialFile returns the PassThrough it piped into (:81,:88)');

    body  = await drain(stream);
    reads = callsFor(ctx, 'createReadStream').slice(before);

    assert.ok(body.equals(expected),
      'the streamed bytes must be the stored bytes exactly - this is a ' +
      'PRE-MIGRATION object, written before the run, so a changed read path ' +
      'shows up here as wrong or missing bytes');
    assert.strictEqual(reads.length, 1, 'exactly one read stream was opened');
    assert.strictEqual(reads[0].bucket, ctx.config.aws.buckets.materials.name,
      'Bucket is config.aws.buckets.materials.name (:84)');
    assert.strictEqual(reads[0].key, descriptor.key,
      'Key is the `remote` argument verbatim (:85) - no digest is recomputed ' +
      'on the read side, which is precisely why a changed digest orphans ' +
      'rather than errors');
    assert.strictEqual(reads[0].outcome, 'served', 'the object was served');

    measured(ctx, {
      bucket      : reads[0].bucket,
      key         : reads[0].key,
      outcome     : reads[0].outcome,
      readBytes   : body.length,
      readSha1    : sha1Hex(body),
      seededSha1  : sha1Hex(expected),
      streamForm  : 'getObject(...).createReadStream()'
    });

    // The absent-key half of this contract is `materials-read-missing` below.
    // It is a separate case because it needs a process-level error capture that
    // has no business being installed around a success path.
  }
});

cases.push({
  name : 'materials-read-missing',
  pins : 'lib/util/file.js:80-89',
  run  : async function(ctx) {
    // THE OTHER HALF OF THE MATERIALS CONTRACT, and the one with a consequence.
    //
    // For an absent key the SDK's read stream emits 'error' and never ends
    // (test/parity/fixtures/aws.js reproduces exactly that), and
    // `downloadMaterialFile` pipes it with `.pipe()`, which attaches NO error
    // listener to the source. Two things follow, both measured here rather
    // than described:
    //
    //   1. the PassThrough the caller holds neither ends nor errors, so a
    //      consumer waiting on it waits forever - the request is left
    //      unsettled. That is asserted rather than corrected, because the only
    //      alternative is to make the read reject, which is a change to what a
    //      client sees.
    //   2. the source's 'error' has no listener anywhere, so Node raises it as
    //      an UNCAUGHT EXCEPTION. In the running application that is an
    //      unhandled error on the request path; in this harness it would end
    //      the process mid-run.
    //
    // So the uncaught exception is captured for the duration of this case and
    // released in a `finally`, which is the only way to observe an error that
    // by construction has no listener. The capture is scoped as narrowly as the
    // mechanism allows - one case, one handler, removed whatever happens - and
    // it asserts the identity of what it caught rather than swallowing it.
    var missingKey = 'parity-absent-material.txt';
    var before     = callsFor(ctx, 'createReadStream').length;
    var uncaught   = [];
    var settled    = null;
    var chunks     = 0;
    var stream;
    var reads;

    function onUncaught(err) {
      uncaught.push(err);
    }

    assert.strictEqual(
      ctx.awsFixture.has(ctx.config.aws.buckets.materials.name, missingKey),
      false,
      'the key this case reads must NOT be in the store, or it would be ' +
      'measuring the success path a second time'
    );

    process.on('uncaughtException', onUncaught);

    try {
      stream = ctx.FileUtil.downloadMaterialFile(missingKey);

      assert.ok(stream instanceof Readable,
        'downloadMaterialFile returns its PassThrough even for a key that ' +
        'does not exist - the miss is not detectable at the call'
      );

      // What a real consumer does: read it and wait for it to finish. If the
      // behaviour ever changed to forwarding the error, these listeners are
      // what keep that change from crashing this case instead of failing it.
      stream.on('data', function() { chunks++; });
      stream.on('end', function() { settled = 'end'; });
      stream.on('error', function(err) {
        settled = 'error:' + ((err && err.code) || (err && err.message) || err);
      });

      // Bounded, and deliberately far below the case ceiling: the claim is that
      // nothing ever settles, and the fixture delivers through `setImmediate`,
      // so a settlement would have happened within a few ticks. Waiting longer
      // would not make the negative stronger, only slower.
      await delay(250);

      reads = callsFor(ctx, 'createReadStream').slice(before);

      // The read really was attempted, against the right bucket and key.
      assert.strictEqual(reads.length, 1,
        'exactly one read stream was opened for the absent key');
      assert.strictEqual(reads[0].bucket, ctx.config.aws.buckets.materials.name,
        'Bucket is config.aws.buckets.materials.name (:84) on the miss path too');
      assert.strictEqual(reads[0].key, missingKey,
        'Key is the `remote` argument verbatim (:85)');
      assert.strictEqual(reads[0].outcome, 'missing',
        'and the store reported the object absent');

      // (1) The caller's stream never settles. This is the preserved quirk, and
      // it is asserted positively so that a future change which made the read
      // reject would fail here and be looked at, rather than passing silently.
      assert.strictEqual(settled, null,
        'the PassThrough at :81 neither ends nor errors: `.pipe()` at :86 ' +
        'forwards neither the source\'s end nor its error, so a caller waiting ' +
        'on this stream waits forever. Preserved as measured under R-d - a ' +
        'read that rejected would be a different observable behaviour.'
      );
      assert.strictEqual(chunks, 0, 'and no bytes are delivered');

      // (2) The source's error surfaced as an uncaught exception, with the
      // SDK's own identity intact.
      assert.strictEqual(uncaught.length, 1,
        'the absent key raises exactly one uncaught error: the source stream ' +
        'emits \'error\' and no listener exists on it, here or in the ' +
        'application. In a running server this is an unhandled error on the ' +
        'request path.'
      );
      assert.strictEqual(uncaught[0].code, 'NoSuchKey',
        'and it is the SDK\'s NoSuchKey, unwrapped - the same error ' +
        'downloadUserAsset REJECTS with, which is the difference between the ' +
        'two read paths'
      );
      assert.strictEqual(uncaught[0].statusCode, 404, 'with its 404 intact');

      measured(ctx, {
        bucket        : reads[0].bucket,
        key           : reads[0].key,
        outcome       : reads[0].outcome,
        streamSettled : settled,
        bytesDelivered: chunks,
        uncaught      : {
          code       : uncaught[0].code,
          statusCode : uncaught[0].statusCode
        }
      });
    }
    finally {
      process.removeListener('uncaughtException', onUncaught);
      // Detached from the source so the abandoned pipe cannot deliver anything
      // into a later case's assertions.
      if (stream) {
        stream.removeAllListeners('data');
        stream.removeAllListeners('end');
        stream.removeAllListeners('error');
      }
    }

    assertFixtureHealthy(ctx, 'materials-read-missing');
  }
});

cases.push({
  name : 'avatar-accept',
  pins : 'lib/util/file.js:96-102',
  run  : async function(ctx) {
    var bucket   = ctx.config.aws.buckets.useravatars;
    var accepted = [
      { type: 'image/png',  filename: 'parity-avatar.png',  extension: 'png' },
      { type: 'image/jpg',  filename: 'parity-avatar.jpg',  extension: 'jpg' },
      { type: 'image/jpeg', filename: 'parity-avatar.jpeg', extension: 'jpeg' }
    ];
    var i;
    var entry;
    var source;
    var outcome;
    var key;
    var record;

    // All three types `uploadUserAvatar`'s content-type regexp admits, because
    // a narrowed regexp would still pass a single-type assertion.
    for (i = 0; i < accepted.length; i++) {
      entry  = accepted[i];
      source = upload(
        ctx, 'avatar-' + entry.extension, PAYLOADS.avatarPng,
        entry.filename, entry.type
      );
      outcome = await callback(function(done) {
        ctx.FileUtil.uploadUserAvatar(source, done);
      });
      key    = DIGESTS.avatarPng + '.' + entry.extension;
      record = storedObject(ctx, bucket.name, key);

      assert.strictEqual(outcome.err, null,
        entry.type + ' must be accepted');
      assert.strictEqual(record.bucket, bucket.name,
        'the accept path selects config.aws.buckets.useravatars (:100)');
      assert.strictEqual(record.contentType, entry.type,
        'no image type is whitelisted, so the declared type passes through');
      assert.ok(record.body.equals(PAYLOADS.avatarPng), 'stored bytes');
      assertUploadResult(outcome.result, {
        host   : bucket.host,
        key    : key,
        digest : DIGESTS.avatarPng,
        size   : PAYLOADS.avatarPng.length
      });
      assert.strictEqual(fs.existsSync(source.path), false, 'unlinked');

      ctx.evidence[entry.type] = {
        bucket        : record.bucket,
        key           : record.key,
        contentType   : record.contentType,
        storedSha1    : sha1Hex(record.body),
        sourceUnlinked: fs.existsSync(source.path) === false
      };
    }
  }
});

cases.push({
  name : 'avatar-reject',
  pins : 'lib/util/file.js:97-98',
  run  : async function(ctx) {
    var rejected = ['image/gif', 'image/svg+xml', 'text/plain', 'image/pngx', ''];
    var before   = callsFor(ctx, 'putObject').length;
    var i;
    var source;
    var outcome;

    for (i = 0; i < rejected.length; i++) {
      source = upload(
        ctx, 'avatar-reject-' + i, PAYLOADS.avatarPng,
        'parity-avatar.png', rejected[i], { harnessOwned : true }
      );
      outcome = await callback(function(done) {
        ctx.FileUtil.uploadUserAvatar(source, done);
      });

      assert.ok(outcome.err instanceof Error,
        JSON.stringify(rejected[i]) + ' must be rejected with an Error');
      assert.strictEqual(
        outcome.err.message, 'unsupported image type, must be png or jpg',
        'the message is asserted EXACTLY: lib/controllers/users.js surfaces it ' +
        'to the user, so it is part of the observable contract'
      );
      assert.strictEqual(outcome.result, undefined,
        'the reject path calls back with the error alone (:98)');

      // 'image/pngx' is in the list on purpose: that regexp is anchored at
      // both ends, so a trailing character must not sneak through.
      // SEC-F34 (CWE-459/CWE-400): the reject path returns before
      // `_fileToContainer`, which was the only site in the module that
      // unlinked, so every rejected avatar left its multipart temp file
      // behind - repeatable by any authenticated caller. `lib/util/file.js`
      // now runs `removeTemporaryFile` on this terminal path, so the file is
      // gone by the time the callback fires. Cleanup only: the callback's
      // arity, its error and the absence of any upload are asserted above
      // and are unchanged.
      assert.strictEqual(fs.existsSync(source.path), false,
        'the reject path removes the temporary file it was handed'
      );
    }

    assert.strictEqual(callsFor(ctx, 'putObject').length, before,
      'a rejected avatar performs no upload at all');

    measured(ctx, {
      rejectedTypes  : rejected,
      errorMessage   : 'unsupported image type, must be png or jpg',
      uploadsAttempted: callsFor(ctx, 'putObject').length - before,
      sourceRemoved  : fs.existsSync(source.path) === false
    });
  }
});

cases.push({
  name       : 'snapshot-exists',
  pins       : 'lib/util/file.js:105-122',
  timeoutMs  : SNAPSHOT_TIMEOUT_MS,
  run        : async function(ctx) {
    var bucket = ctx.config.aws.buckets.snapshots;
    // `uploadSnapshot` concatenates `file.path + file.name` with no separator,
    // so the path must carry its own trailing slash. Reproduced, not corrected.
    var dir     = path.join(ctx.scratch, 'snapshots') + path.sep;
    var name    = 'parity-snapshot.png';
    var started;
    var outcome;
    var record;

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dir + name, PAYLOADS.snapshotPng);

    started = Date.now();
    outcome = await callback(function(done) {
      ctx.FileUtil.uploadSnapshot({ path: dir, name: name }, done);
    }, SNAPSHOT_TIMEOUT_MS);
    record  = storedObject(ctx, bucket.name, name);

    // `uploadSnapshot`'s 1000 ms wait is honoured, not defeated. It is measured
    // because a conversion that dropped the timer would still pass every other
    // assertion here while changing the timing the timer exists for.
    assert.ok(
      Date.now() - started >= SNAPSHOT_DELAY_MS,
      'the setTimeout at :107 must still delay the upload by ' +
      SNAPSHOT_DELAY_MS + ' ms; measured ' + (Date.now() - started) + ' ms'
    );
    assert.strictEqual(outcome.err, null, 'the upload must succeed');
    assert.strictEqual(record.key, name,
      'a snapshot is keyed by its FILENAME (:112), not by a content digest - ' +
      'the one storage path in this module that is not content-addressed'
    );
    assert.strictEqual(record.contentType, 'image/png',
      'the content type is hard-coded at :113');
    assert.ok(record.body.equals(PAYLOADS.snapshotPng), 'stored bytes');
    assert.strictEqual(fs.existsSync(dir + name), true,
      'uploadSnapshot does not unlink its source; only _fileToContainer:52 does'
    );

    measured(ctx, {
      bucket        : record.bucket,
      key           : record.key,
      contentType   : record.contentType,
      storedSha1    : sha1Hex(record.body),
      delayMs       : Date.now() - started,
      sourceRetained: fs.existsSync(dir + name)
    });
  }
});

cases.push({
  name      : 'snapshot-missing',
  pins      : 'lib/util/file.js:108, 117-119',
  timeoutMs : SNAPSHOT_TIMEOUT_MS,
  run       : async function(ctx) {
    var dir     = path.join(ctx.scratch, 'snapshots') + path.sep;
    var name    = 'parity-absent-snapshot.png';
    var before  = callsFor(ctx, 'putObject').length;
    var started = Date.now();
    var outcome;

    fs.mkdirSync(dir, { recursive: true });

    outcome = await callback(function(done) {
      ctx.FileUtil.uploadSnapshot({ path: dir, name: name }, done);
    }, SNAPSHOT_TIMEOUT_MS);

    assert.ok(
      Date.now() - started >= SNAPSHOT_DELAY_MS,
      'the wait happens before the existence check, so the failure is also ' +
      'delayed by ' + SNAPSHOT_DELAY_MS + ' ms'
    );
    assert.ok(outcome.err instanceof Error, 'an absent snapshot is an error');
    assert.strictEqual(
      outcome.err.message, 'Snapshot does not exists: ' + dir + name,
      'the message is asserted EXACTLY, including its concatenation of path ' +
      'and name and its 2013 grammar (:118)'
    );
    assert.strictEqual(callsFor(ctx, 'putObject').length, before,
      'nothing is uploaded when the snapshot is absent');

    measured(ctx, {
      errorMessage    : outcome.err.message,
      delayMs         : Date.now() - started,
      uploadsAttempted: callsFor(ctx, 'putObject').length - before
    });
  }
});

cases.push({
  name : 'snapshot-from-buffer',
  pins : 'lib/util/file.js:124-130',
  run  : async function(ctx) {
    var bucket  = ctx.config.aws.buckets.snapshots;
    var name    = 'parity-buffer-snapshot.png';
    var started = Date.now();
    var outcome = await callback(function(done) {
      ctx.FileUtil.uploadSnapshotFromBuffer(name, PAYLOADS.snapshotPng, done);
    });
    var record  = storedObject(ctx, bucket.name, name);
    var logged  = callsFor(ctx, 'putObject').filter(function(entry) {
      return entry.key === name;
    });

    assert.strictEqual(outcome.err, null, 'the upload must succeed');
    assert.strictEqual(record.key, name, 'keyed by the supplied filename (:126)');
    assert.strictEqual(record.contentType, 'image/png', 'hard-coded at :127');
    assert.ok(record.body.equals(PAYLOADS.snapshotPng), 'the buffer, byte-exact');
    assert.strictEqual(logged[0].bodyType, 'buffer',
      'the buffer variant hands the Body straight to putObject (:129) rather ' +
      'than opening a read stream');
    assert.ok(
      Date.now() - started < SNAPSHOT_DELAY_MS,
      'the buffer variant carries NO setTimeout, which is the difference the ' +
      'comment at :104 is about; measured ' + (Date.now() - started) + ' ms'
    );

    measured(ctx, {
      bucket     : record.bucket,
      key        : record.key,
      contentType: record.contentType,
      storedSha1 : sha1Hex(record.body),
      bodyType   : logged[0].bodyType,
      elapsedMs  : Date.now() - started
    });
  }
});

cases.push({
  name : 'delete-basename-only',
  pins : 'lib/util/file.js:132-147',
  run  : async function(ctx) {
    var bucket = ctx.config.aws.buckets.materials;
    var key    = 'parity-delete-target.png';
    // A full URL with several path segments, which is what the application's
    // own callers pass: a stored `file.url`.
    var value  = 'https://cdn.parity.invalid/deep/nested/path/' + key;
    var before = ctx.awsFixture.calls().length;
    var outcome;
    var deletes;

    ctx.awsFixture.put(bucket.name, key, PAYLOADS.snapshotPng, {
      contentType : 'image/png'
    });
    assert.strictEqual(ctx.awsFixture.has(bucket.name, key), true, 'seeded');

    outcome = await callback(function(done) {
      ctx.FileUtil.removeFile('materials', value, done);
    });
    deletes = ctx.awsFixture.calls().slice(before).filter(function(entry) {
      return entry.operation === 'deleteObject';
    });

    assert.strictEqual(outcome.err, null, 'the delete must succeed');
    assert.strictEqual(deletes.length, 1, 'exactly one deleteObject');
    assert.strictEqual(deletes[0].bucket, bucket.name,
      'the bucket is config.aws.buckets[container].name (:144), so the ' +
      'container ARGUMENT selects it - a string key, not an object'
    );
    assert.strictEqual(deletes[0].key, key,
      'the Key is the substring after the LAST "/" (:142). Passing a full URL ' +
      'proves only the basename reaches S3; sending the whole URL would delete ' +
      'nothing and report success, because deleting an absent key is a success.'
    );
    assert.strictEqual(deletes[0].existed, true, 'the object was really there');
    assert.strictEqual(ctx.awsFixture.has(bucket.name, key), false, 'and is gone');

    measured(ctx, {
      containerArgument: 'materials',
      resolvedBucket   : deletes[0].bucket,
      suppliedValue    : value,
      deletedKey       : deletes[0].key,
      existed          : deletes[0].existed,
      stillPresent     : ctx.awsFixture.has(bucket.name, key)
    });
  }
});

cases.push({
  name : 'delete-missing-callback',
  pins : 'lib/util/file.js:135-139',
  run  : async function(ctx) {
    var bucket = ctx.config.aws.buckets.materials;
    var key    = 'parity-delete-nocallback.png';
    var value  = 'https://cdn.parity.invalid/assets/' + key;
    var result;

    ctx.awsFixture.put(bucket.name, key, PAYLOADS.snapshotPng, {
      contentType : 'image/png'
    });

    // No callback. `removeFile` substitutes
    // `function(err, result) { return result }` - a callback whose return value
    // goes nowhere, so the delete's only evidence is the store itself. The
    // substitution matters because without it the SDK would receive `undefined`
    // and, per its own contract, perform nothing at all.
    result = ctx.FileUtil.removeFile('materials', value);

    assert.strictEqual(result, undefined,
      'removeFile returns nothing; the substituted callback\'s return value is ' +
      'discarded by the SDK'
    );

    await waitFor(
      'the object at ' + bucket.name + '/' + key + ' to be deleted with no ' +
      'callback supplied',
      function() { return !ctx.awsFixture.has(bucket.name, key); }
    );

    assert.strictEqual(ctx.awsFixture.has(bucket.name, key), false,
      'the delete really happened');

    measured(ctx, {
      suppliedValue : value,
      deletedKey    : key,
      bucket        : bucket.name,
      returnValue   : result,
      stillPresent  : ctx.awsFixture.has(bucket.name, key)
    });

    assertFixtureHealthy(ctx, 'delete-missing-callback');
  }
});

// Fixed File ids for the `replaceFile` cases. Supplied rather than generated so
// `remoteName` - which embeds the document id, as `uploadUserAsset` builds it -
// is predictable end to end and the assertion can be composed from constants
// instead of read back from the document the application just built. They sit
// outside seed.js's own 05xx block so no seeded fixture is disturbed.
var REPLACE_FILE_ID     = '0000000000000000000005a1';
var UPLOAD_FAIL_FILE_ID = '0000000000000000000005a2';

cases.push({
  name : 'user-asset-upload',
  pins : 'lib/util/file.js:149-194',
  run  : async function(ctx) {
    var bucket  = ctx.config.aws.buckets.userassets;
    var source  = upload(
      ctx, 'user-asset-new.gif', PAYLOADS.assetGif,
      'parity-new-asset.gif', 'image/gif', { harnessOwned : true }
    );
    var outcome = await callback(function(done) {
      ctx.FileUtil.uploadUserAsset(source, seed.ids.user, null, done);
    });
    var file = outcome.result;
    var remoteName;
    var record;
    var persisted;

    assert.strictEqual(outcome.err, null, 'the upload must succeed');
    assert.ok(file, 'the callback receives the File document (:190)');
    assert.match(file.id, /^[0-9a-f]{24}$/,
      'a new document gets a generated ObjectId');

    // The naming pattern here is NOT `_fileToContainer`'s. `uploadUserAsset`
    // always joins the digest, the document id and the extension with a '-' and
    // a '.', with no conditional on either - so a user asset is keyed
    // differently from a material even for identical bytes.
    remoteName = DIGESTS.assetGif + '-' + file.id + '.gif';

    assert.strictEqual(file.url, bucket.host + '/' + remoteName,
      'file.url is container.host + \'/\' + remoteName (:179)');
    assert.strictEqual(file.hash, DIGESTS.assetGif, 'file.hash is the digest (:173)');
    assert.strictEqual(file.mime, 'image/gif', 'file.mime is the declared type (:172)');
    assert.strictEqual(file.size, PAYLOADS.assetGif.length,
      'file.size is upload.bytes (:174)');
    assert.strictEqual(file.name, 'parity-new-asset.gif',
      'file.name is the upload\'s filename, NOT the remote name (:170)');
    assert.strictEqual(file.type, 'embed', 'the type is hard-coded at :171');
    assert.strictEqual(String(file._owner), seed.ids.user, 'setOwner (:176)');
    assert.strictEqual(String(file._creator), seed.ids.user,
      'the ownable plugin defaults the creator to the owner');

    record = storedObject(ctx, bucket.name, remoteName);

    assert.strictEqual(record.contentType, 'image/gif',
      'the fileinfo content type is the declared one (:187); the extension ' +
      'whitelist is not consulted on this path at all');
    assert.ok(record.body.equals(PAYLOADS.assetGif), 'stored bytes');

    // Persisted, and readable back through the model.
    persisted = await ctx.FileModel.findById(file.id);

    assert.ok(persisted, 'the File document must be persisted (:181)');
    assert.strictEqual(persisted.url, file.url, 'persisted url');
    assert.strictEqual(persisted.hash, DIGESTS.assetGif, 'persisted hash');
    assert.strictEqual(persisted.mime, 'image/gif', 'persisted mime');
    assert.strictEqual(persisted.size, PAYLOADS.assetGif.length, 'persisted size');
    assert.strictEqual(String(persisted._owner), seed.ids.user, 'persisted owner');

    // SEC-F34: all three of `uploadUserAsset`'s terminal paths - save error,
    // upload failure and success - reached the callback without unlinking,
    // so the temp directory grew one upload at a time. `lib/util/file.js`
    // now destroys the stream and removes the file on each of them, and the
    // removal completes before the callback fires, which is what makes this
    // assertion deterministic. The stored key, the document and the callback
    // shape are asserted above and are unchanged.
    assert.strictEqual(fs.existsSync(source.path), false,
      'uploadUserAsset removes the temporary file on its success path');

    measured(ctx, {
      bucket        : record.bucket,
      remoteName    : remoteName,
      documentId    : file.id,
      url           : file.url,
      hash          : file.hash,
      mime          : file.mime,
      size          : file.size,
      name          : file.name,
      type          : file.type,
      owner         : String(file._owner),
      storedSha1    : sha1Hex(record.body),
      storedType    : record.contentType,
      persistedUrl  : persisted.url,
      sourceRemoved : fs.existsSync(source.path) === false
    });

    ctx.createdFileIds.push(file.id);
  }
});

cases.push({
  name : 'user-asset-argument-shift',
  pins : 'lib/util/file.js:154-157',
  run  : async function(ctx) {
    var bucket  = ctx.config.aws.buckets.userassets;
    var source  = upload(
      ctx, 'user-asset-shift.gif', PAYLOADS.assetGif,
      'parity-shift-asset.gif', 'image/gif', { harnessOwned : true }
    );
    // THREE arguments: the callback arrives where `replaceFile` is declared.
    // Without `uploadUserAsset`'s `typeof replaceFile === 'function'` shift,
    // `cb` would be undefined and neither the save-error return nor the final
    // `cb(err, file)` would call anything back - which is why the `callback`
    // helper's timeout is itself part of this assertion.
    var outcome = await callback(function(done) {
      ctx.FileUtil.uploadUserAsset(source, seed.ids.user, done);
    });
    var file = outcome.result;

    assert.strictEqual(outcome.err, null, 'the shifted call must succeed');
    assert.ok(file, 'the callback fired, so replaceFile was recognised as it');
    assert.strictEqual(outcome.calls, 1, 'and fired exactly once');
    assert.match(file.id, /^[0-9a-f]{24}$/,
      'a shifted call takes the NEW-document branch, because replaceFile was ' +
      'set to null at :156');
    storedObject(ctx, bucket.name, DIGESTS.assetGif + '-' + file.id + '.gif');

    measured(ctx, {
      bucket           : bucket.name,
      remoteName       : DIGESTS.assetGif + '-' + file.id + '.gif',
      documentId       : file.id,
      callbackCalls    : outcome.calls,
      replaceFileShifted: true
    });

    ctx.createdFileIds.push(file.id);
  }
});

cases.push({
  name : 'user-asset-replace-existing',
  pins : 'lib/util/file.js:163-165, 178-179',
  run  : async function(ctx) {
    var bucket     = ctx.config.aws.buckets.userassets;
    // A fixed id, so `remoteName` is composed entirely from constants.
    var replacement = new ctx.FileModel({ _id: REPLACE_FILE_ID });
    var remoteName  = DIGESTS.assetGif + '-' + REPLACE_FILE_ID + '.gif';
    var source      = upload(
      ctx, 'user-asset-replace.gif', PAYLOADS.assetGif,
      'parity-replacement.gif', 'image/gif', { harnessOwned : true }
    );
    var outcome = await callback(function(done) {
      ctx.FileUtil.uploadUserAsset(source, seed.ids.user, replacement, done);
    });
    var file  = outcome.result;
    var count;

    assert.strictEqual(outcome.err, null, 'the replace must succeed');
    assert.strictEqual(file.id, REPLACE_FILE_ID,
      'the supplied document is reused rather than a new one created (:163-164)');
    assert.strictEqual(file.url, bucket.host + '/' + remoteName,
      'the url is rebuilt from the digest and the EXISTING id');

    storedObject(ctx, bucket.name, remoteName);

    count = await ctx.FileModel.model.collection.countDocuments({
      _id : new ctx.appMongoose.Types.ObjectId(REPLACE_FILE_ID)
    });

    assert.strictEqual(count, 1,
      'replacing writes one document, not two - a second would orphan the ' +
      'first document\'s object');

    measured(ctx, {
      bucket        : bucket.name,
      remoteName    : remoteName,
      documentId    : file.id,
      url           : file.url,
      documentCount : count
    });

    ctx.createdFileIds.push(REPLACE_FILE_ID);
  }
});

cases.push({
  name : 'user-asset-save-error-early-return',
  pins : 'lib/util/file.js:181-182',
  run  : async function(ctx) {
    var before = callsFor(ctx, 'putObject').length;
    var source = upload(
      ctx, 'user-asset-noowner.gif', PAYLOADS.assetGif,
      'parity-noowner.gif', 'image/gif', { harnessOwned : true }
    );
    // No owner. The ownable plugin declares `_owner` required, so `file.save`
    // rejects and `uploadUserAsset` returns before any upload is attempted.
    var outcome = await callback(function(done) {
      ctx.FileUtil.uploadUserAsset(source, undefined, null, done);
    });

    assert.ok(outcome.err, 'a save failure must reach the callback');
    assert.strictEqual(outcome.err.name, 'ValidationError',
      'the mongoose validation error is passed through unwrapped');
    assert.match(String(outcome.err.message), /_owner/,
      'and it names the missing owner');
    assert.strictEqual(outcome.result, undefined,
      ':182 is `return cb(err)` - the error alone, with no document');
    assert.strictEqual(callsFor(ctx, 'putObject').length, before,
      'the early return means NOTHING is uploaded: the document is saved ' +
      'first (:181), so a save failure leaves the store untouched'
    );
    // SEC-F34, the save-error half of the same finding: the early return is
    // still `return cb(err)` with nothing uploaded, and it now removes the
    // temporary file on the way out.
    assert.strictEqual(fs.existsSync(source.path), false,
      'and the temporary file is removed on the early return');

    measured(ctx, {
      errorName       : outcome.err.name,
      errorMessage    : String(outcome.err.message),
      callbackResult  : outcome.result,
      uploadsAttempted: callsFor(ctx, 'putObject').length - before,
      sourceRemoved   : fs.existsSync(source.path) === false
    });
  }
});

cases.push({
  name : 'user-asset-saved-before-upload',
  pins : 'lib/util/file.js:181, 189-191',
  run  : async function(ctx) {
    var bucket      = ctx.config.aws.buckets.userassets;
    var replacement = new ctx.FileModel({ _id: UPLOAD_FAIL_FILE_ID });
    var remoteName  = DIGESTS.assetGif + '-' + UPLOAD_FAIL_FILE_ID + '.gif';
    var source      = upload(
      ctx, 'user-asset-uploadfail.gif', PAYLOADS.assetGif,
      'parity-uploadfail.gif', 'image/gif', { harnessOwned : true }
    );
    var ParityS3  = ctx.awsFixture.ParityS3;
    var original  = ParityS3.prototype.putObject;
    var outcome;
    var persisted;

    // The ONLY stub in this file, and it stubs the FIXTURE's client rather than
    // anything in the application: there is no configuration that makes a
    // well-formed putObject fail, and `uploadUserAsset`'s save-before-upload
    // ordering is only observable when the upload fails after the save
    // succeeded. Restored in a `finally` so no later case inherits it.
    ParityS3.prototype.putObject = function(params, cb) {
      var err = new Error('parity fixture: forced upload failure');

      err.name       = 'InternalError';
      err.code       = 'InternalError';
      err.statusCode = 500;

      setImmediate(function() { cb(err, null); });
    };

    try {
      outcome = await callback(function(done) {
        ctx.FileUtil.uploadUserAsset(source, seed.ids.user, replacement, done);
      });
    }
    finally {
      ParityS3.prototype.putObject = original;
    }

    // `uploadUserAsset` ends in `cb(err, file)` - BOTH arguments. A caller that
    // only checks the error still has the document, and a caller that only
    // checks the document never learns the object is missing.
    assert.ok(outcome.err, 'the upload error reaches the callback');
    assert.strictEqual(outcome.err.code, 'InternalError', 'the forced failure');
    assert.ok(outcome.result, ':190 passes the file alongside the error');
    assert.strictEqual(outcome.result.id, UPLOAD_FAIL_FILE_ID, 'the same document');

    persisted = await ctx.FileModel.findById(UPLOAD_FAIL_FILE_ID);

    assert.ok(persisted,
      'the File document is saved BEFORE the upload (:181), so it survives a ' +
      'failed upload - the record points at an object that does not exist. ' +
      'Preserved as measured: repairing it would change what a client sees.'
    );
    assert.strictEqual(persisted.url, bucket.host + '/' + remoteName,
      'and it carries the url of the object that was never stored');
    assert.strictEqual(ctx.awsFixture.has(bucket.name, remoteName), false,
      'while the store holds nothing at that key');

    measured(ctx, {
      bucket        : bucket.name,
      remoteName    : remoteName,
      documentId    : UPLOAD_FAIL_FILE_ID,
      persistedUrl  : persisted.url,
      objectStored  : ctx.awsFixture.has(bucket.name, remoteName),
      callbackError : describeValue(outcome.err)
    });

    ctx.createdFileIds.push(UPLOAD_FAIL_FILE_ID);
  }
});

cases.push({
  name : 'user-asset-read',
  pins : 'lib/util/file.js:196-212',
  run  : async function(ctx) {
    var bucket   = ctx.config.aws.buckets.userassets;
    var expected = Buffer.from(seed.fixtures.bytes.assetGif.base64, 'base64');
    var key      = seed.fixtures.keys.userAsset;
    var body     = await ctx.FileUtil.downloadUserAsset(key);
    var reads    = callsFor(ctx, 'getObject').filter(function(entry) {
      return entry.key === key && entry.form === 'callback';
    });
    var rejection = null;

    assert.ok(Buffer.isBuffer(body),
      'the promise resolves data.Body, which the SDK delivers as a Buffer (:209)');
    assert.ok(body.equals(expected), 'the seeded bytes, exactly');
    assert.ok(reads.length >= 1, 'the CALLBACK form of getObject is used (:203)');
    assert.strictEqual(reads[0].bucket, bucket.name,
      'Bucket is config.aws.buckets.userassets.name (:201)');

    try {
      await ctx.FileUtil.downloadUserAsset('parity-absent-user-asset.gif');
    }
    catch (err) {
      rejection = err;
    }

    assert.ok(rejection, 'an absent key must REJECT (:204-206)');
    assert.strictEqual(rejection.code, 'NoSuchKey',
      'with the SDK\'s own error, unwrapped - which is what makes this the ' +
      'read path the digest-sensitivity controls below can use'
    );

    measured(ctx, {
      bucket        : reads[0].bucket,
      key           : key,
      readBytes     : body.length,
      readSha1      : sha1Hex(body),
      seededSha1    : sha1Hex(expected),
      absentKey     : 'parity-absent-user-asset.gif',
      rejectionCode : rejection.code
    });
  }
});

cases.push({
  name : 'export-key-format',
  pins : 'lib/workers/exports.js (processBulkExport, uploadToS3)',
  run  : async function(ctx) {
    var bucket   = ctx.config.aws.buckets.exports;
    var userId   = seed.ids.user;
    // Composed here from `processBulkExport`'s own derivation, with '0'
    // standing in for `Date.now().toString()` - the only variable input.
    // Compared against seed.js's independent derivation, so the two agree or
    // the case fails.
    var hash     = sha1Hex(userId + '0').substring(0, 12);
    var filename = 'trinket-export-' + hash + '.zip';
    var s3Key    = 'exports/' + userId + '/' + filename;
    var record;

    assert.ok(bucket && bucket.name,
      'config.aws.buckets.exports must be configured. config/default.yaml ' +
      'declares NO exports bucket (AAP 0.6.7) - an existing deployment ' +
      'requirement - so this run needs test/parity/server-overlay.json, which ' +
      'supplies one.'
    );

    assert.strictEqual(hash.length, 12, 'the digest is truncated to 12 (:100)');
    assert.match(filename, /^trinket-export-[0-9a-f]{12}\.zip$/,
      'the filename shape at :102');
    assert.strictEqual(filename, seed.fixtures.exportArchive.filename,
      'this file\'s derivation and seed.js\'s must agree');
    assert.strictEqual(s3Key, seed.fixtures.exportArchive.s3Key,
      'and so must the key');
    assert.deepStrictEqual(s3Key.split('/'), ['exports', userId, filename],
      'the key is exactly three segments: the literal prefix, the OWNER id and ' +
      'the filename (:104). The owner segment is what keeps one user\'s ' +
      'exports out of another\'s prefix.'
    );

    record = storedObject(ctx, bucket.name, s3Key);

    assert.strictEqual(record.contentType, 'application/zip',
      'ContentType is hard-coded at :370');
    assert.strictEqual(
      record.contentDisposition, 'attachment; filename="' + filename + '"',
      'ContentDisposition is an attachment naming the file (:371), which is ' +
      'what makes a browser download rather than render the archive'
    );
    assert.strictEqual(
      seed.storage().exportArchive.url, bucket.host + '/' + s3Key,
      'the resolved download url is host + \'/\' + s3Key (:378)'
    );

    measured(ctx, {
      bucket             : record.bucket,
      s3Key              : record.key,
      filename           : filename,
      digestPrefix       : hash,
      keySegments        : s3Key.split('/'),
      contentType        : record.contentType,
      contentDisposition : record.contentDisposition,
      downloadUrl        : seed.storage().exportArchive.url,
      storedSha1         : sha1Hex(record.body)
    });

    // The key format is asserted here; test/parity/worker.js asserts it end to
    // end, against an archive the worker really produced and uploaded.
  }
});


// ---------------------------------------------------------------------------
// The pre-migration cases - the reason this file exists
// ---------------------------------------------------------------------------
// Everything above writes an object and reads it back, and every one of those
// round trips would pass under ANY digest algorithm, because both halves use
// the same one. These three cases are the ones that cannot: they read an object
// seeded BEFORE the run through the application's own read path, and then prove
// the assertion is sensitive to a digest change rather than merely passing.

cases.push({
  name : 'pre-migration-lookup',
  pins : 'lib/util/file.js:178, 196-212, lib/models/file.js:41',
  run  : async function(ctx) {
    // Found by its HASH, through the model's own alternate-id lookup
    // (`lib/models/file.js` declares `alternateIds: ['hash']`, which
    // `lib/models/model.js`'s generated `findById` turns into a `findOne` on
    // that field). This is
    // the application's real "find the record for this content" path.
    var doc  = await ctx.FileModel.findById(seed.fixtures.digests.assetGif);
    var key;
    var body;

    assert.ok(doc,
      'the seeded File document must be findable by its content digest ' +
      seed.fixtures.digests.assetGif + '. If it is not, the record and the ' +
      'object have already diverged.'
    );
    assert.strictEqual(doc.id, seed.ids.userAssetFile,
      'and it must be the seeded user-asset record');

    key = seed.keyFromUrl(doc.url);

    // Composed from the digest constant and the seeded id, NOT read off the
    // document: the claim is that the url resolves to the key `uploadUserAsset`
    // builds.
    assert.strictEqual(
      key, seed.fixtures.digests.assetGif + '-' + seed.ids.userAssetFile + '.gif',
      'the stored url resolves to the digest-fileId.extension key ' +
      'lib/util/file.js:178 builds'
    );
    assert.strictEqual(key, seed.fixtures.keys.userAsset,
      'and to the key seed.js says it pre-populated');

    body = await ctx.FileUtil.downloadUserAsset(key);

    assert.ok(
      body.equals(Buffer.from(seed.fixtures.bytes.assetGif.base64, 'base64')),
      'the pre-migration object must still be findable and byte-exact'
    );
    assert.strictEqual(sha1Hex(body), doc.hash,
      'and its contents must still hash to the digest the RECORD carries. ' +
      'This is the whole contract: the key is a content hash, so record and ' +
      'object are bound by the digest and nothing else.'
    );
    measured(ctx, {
      lookupField    : 'hash',
      lookupValue    : seed.fixtures.digests.assetGif,
      documentId     : doc.id,
      documentUrl    : doc.url,
      documentHash   : doc.hash,
      resolvedKey    : key,
      readBytes      : body.length,
      readSha1       : sha1Hex(body)
    });

    assert.strictEqual(sha1Hex(body), seed.fixtures.digests.assetGif,
      'and to the committed fixture digest');
  }
});

cases.push({
  name : 'pre-migration-digest-drift',
  pins : 'lib/util/file.js:66-78, AAP 0.6.7',
  run  : async function(ctx) {
    var bucket = ctx.config.aws.buckets.userassets;
    var key    = seed.fixtures.keys.userAsset;
    var doc    = await ctx.FileModel.findById(seed.ids.userAssetFile);
    var original = ctx.awsFixture.get(bucket.name, key);
    var drifted;
    var restored;

    assert.ok(original, 'the seeded object must be present before it is altered');

    // ONE byte, at a position that leaves the GIF trailer intact - a change of
    // content, not of format.
    ctx.awsFixture.put(bucket.name, key, ALTERED_ASSET_GIF, {
      contentType : original.contentType
    });

    try {
      drifted = await ctx.FileUtil.downloadUserAsset(key);

      // The read still SUCCEEDS - which is exactly the danger. Nothing on the
      // read path recomputes a digest (`downloadUserAsset` passes the key to
      // `getObject` verbatim), so a changed object is served without complaint
      // and only a caller that hashes the bytes can tell.
      assert.strictEqual(sha1Hex(drifted), ALTERED_ASSET_DIGEST,
        'the altered bytes hash to the committed altered digest');
      assert.notStrictEqual(sha1Hex(drifted), doc.hash,
        'and therefore NO LONGER match the hash the record carries. A ' +
        'digest-sensitive assertion must fail here; one that only checked ' +
        '"the read returned some bytes" would have passed.'
      );
      assert.strictEqual(doc.hash, seed.fixtures.digests.assetGif,
        'the record itself is untouched - it is the binding that broke');
    }
    finally {
      ctx.awsFixture.put(bucket.name, key, PAYLOADS.assetGif, {
        contentType : original.contentType
      });
    }

    // Restored, and proven restored: a negative control that left the store
    // altered would fail every later case for the wrong reason.
    restored = await ctx.FileUtil.downloadUserAsset(key);

    assert.strictEqual(sha1Hex(restored), doc.hash,
      'the seeded object is restored and the binding holds again');

    measured(ctx, {
      key            : key,
      recordHash     : doc.hash,
      originalSha1   : seed.fixtures.digests.assetGif,
      driftedSha1    : sha1Hex(drifted),
      readStillSucceeded : true,
      restoredSha1   : sha1Hex(restored)
    });
  }
});

cases.push({
  name : 'pre-migration-rekey-orphans',
  pins : 'lib/util/file.js:32-43, 178, AAP 0.6.7',
  run  : async function(ctx) {
    var bucket   = ctx.config.aws.buckets.userassets;
    var key      = seed.fixtures.keys.userAsset;
    var original = ctx.awsFixture.get(bucket.name, key);
    // The key the SAME object would carry if its digest changed - which is what
    // a different hash algorithm, a different encoding or an altered payload
    // all produce.
    var rekeyed  = ALTERED_ASSET_DIGEST + '-' + seed.ids.userAssetFile + '.gif';
    var client   = new ctx.awsFixture.ParityS3();
    var rejection = null;
    var body;

    assert.ok(original, 'the seeded object must be present');
    assert.notStrictEqual(rekeyed, key, 'the re-keyed name must differ');

    ctx.awsFixture.put(bucket.name, rekeyed, ALTERED_ASSET_GIF, {
      contentType : original.contentType
    });

    try {
      // Remove the object from under the key the RECORD points at, which is
      // what a re-keying leaves behind.
      await callback(function(done) {
        client.deleteObject({ Bucket: bucket.name, Key: key }, done);
      });

      try {
        await ctx.FileUtil.downloadUserAsset(key);
      }
      catch (err) {
        rejection = err;
      }

      assert.ok(rejection,
        'once the digest changes, the record\'s own key resolves to nothing: ' +
        'the object is still there under its NEW name, and every File ' +
        'document pointing at the old one is orphaned. No error is raised ' +
        'anywhere in the write path - this rejection on read is the first and ' +
        'only symptom.'
      );
      assert.strictEqual(rejection.code, 'NoSuchKey',
        'and the symptom is a plain NoSuchKey - indistinguishable from a file ' +
        'that was never uploaded'
      );
      assert.strictEqual(ctx.awsFixture.has(bucket.name, rekeyed), true,
        'while the bytes themselves are perfectly intact under the new key'
      );
    }
    finally {
      ctx.awsFixture.put(bucket.name, key, PAYLOADS.assetGif, {
        contentType : original.contentType
      });

      await callback(function(done) {
        client.deleteObject({ Bucket: bucket.name, Key: rekeyed }, done);
      });
    }

    body = await ctx.FileUtil.downloadUserAsset(key);

    assert.strictEqual(sha1Hex(body), seed.fixtures.digests.assetGif,
      'the seeded object is restored');
    assert.strictEqual(ctx.awsFixture.has(bucket.name, rekeyed), false,
      'and the re-keyed object is removed, so nothing is left behind');

    measured(ctx, {
      recordKey     : key,
      rekeyedKey    : rekeyed,
      rejectionCode : rejection.code,
      bytesIntactUnderNewKey : true,
      restoredSha1  : sha1Hex(body)
    });
  }
});


// ---------------------------------------------------------------------------
// The archive cases
// ---------------------------------------------------------------------------
// Fixed trinket specs covering every branch of `lib/workers/exports.js`'s
// `addTrinketToArchive`, `parseCodeFiles` and `sanitizeFolderName`:
// both code shapes, a name that needs sanitizing, a falsy name, a lang the
// extension map does not know, and a trinket with assets.

var ARCHIVE_EXPORTED_AT = '2024-04-01T00:00:00.000Z';

var ARCHIVE_TRINKETS = Object.freeze([
  {
    // `parseCodeFiles`' JSON file-array shape: two named files, taken verbatim.
    shortCode : 'AAAAAA',
    name      : 'Parity Python',
    lang      : 'python',
    code      : JSON.stringify([
      { name : 'main.py',   content : 'print("parity")\n' },
      { name : 'helper.py', content : 'VALUE = 1\n' }
    ])
  },
  {
    // `parseCodeFiles`' raw-string fallback for a lang MATCHING /blocks/ ->
    // main.xml, and a name that exercises the sanitizer's strip-then-collapse
    // order.
    shortCode : 'BBBBBB',
    name      : 'Parity  Blocks! (v2)',
    lang      : 'blocks',
    code      : '<xml><block type="parity"/></xml>'
  },
  {
    // A falsy name, so `addTrinketToArchive`'s `trinket.name ||
    // trinket.shortCode` falls back to the shortCode - NOT to 'untitled', which
    // needs both to be falsy - and a lang `langExtensions` does not know, so
    // `parseCodeFiles` defaults the extension to '.txt'.
    shortCode : 'CCCCCC',
    name      : '',
    lang      : 'ruby',
    code      : 'puts "parity"\n'
  },
  {
    // `addTrinketToArchive`'s downloaded assets, one named and one taking its
    // name from the url's basename.
    shortCode : 'DDDDDD',
    name      : 'Parity Assets',
    lang      : 'html',
    code      : '<p>parity</p>\n',
    assets    : [
      {
        name    : 'logo.gif',
        url     : 'https://assets.parity.invalid/deep/path/original.gif',
        content : PAYLOADS.assetGif
      },
      {
        url     : 'https://assets.parity.invalid/deep/path/derived.png',
        content : PAYLOADS.snapshotPng
      }
    ]
  }
]);

/**
 * Builds the entry list `lib/workers/exports.js` would append for the fixed
 * specs above, in the same order it appends them.
 *
 * @returns {Array<{name: string, content: (Buffer|string)}>}
 */
function archiveEntriesForFixtures() {
  var entries  = [];
  var manifest = {
    exportedAt : ARCHIVE_EXPORTED_AT,
    trinkets   : []
  };

  ARCHIVE_TRINKETS.forEach(function(trinket) {
    var basePath = archiveBasePath(trinket);

    // The per-trinket metadata document.
    entries.push({
      name    : basePath + 'metadata.json',
      content : JSON.stringify({
        shortCode   : trinket.shortCode,
        name        : trinket.name,
        lang        : trinket.lang,
        created     : '2024-01-01T00:00:00.000Z',
        lastUpdated : '2024-02-01T00:00:00.000Z',
        settings    : { autorun : false },
        url         : 'https://parity.invalid/' + trinket.lang + '/' +
                      trinket.shortCode
      }, null, 2)
    });

    // The parsed code files, one entry each, directly under the base path.
    parseCodeFiles(trinket).forEach(function(file) {
      entries.push({ name : basePath + file.name, content : file.content || '' });
    });

    // The downloaded assets, under the base path's `assets/` directory.
    (trinket.assets || []).forEach(function(asset) {
      var assetName = archiveAssetName(asset);

      entries.push({
        name    : basePath + 'assets/' + assetName,
        content : asset.content
      });
    });

    manifest.trinkets.push({
      shortCode : trinket.shortCode,
      name      : trinket.name,
      lang      : trinket.lang
    });
  });

  // The manifest is appended LAST, after every trinket, with its counters
  // filled in - the order `createExportArchive` writes it in.
  manifest.totalTrinkets  = manifest.trinkets.length;
  manifest.failedTrinkets = 0;

  entries.push({
    name    : 'manifest.json',
    content : JSON.stringify(manifest, null, 2)
  });

  return entries;
}

cases.push({
  name : 'archive-sanitizer',
  pins : 'lib/workers/exports.js (sanitizeFolderName)',
  run  : async function(ctx) {
    // Literal expectations, written out by hand. A case that only compared the
    // function with itself would assert nothing.
    var expectations = [
      // The 'untitled' default, for every falsy input.
      ['',          'untitled'],
      [null,        'untitled'],
      [undefined,   'untitled'],
      // Characters outside [a-zA-Z0-9_\-\s] are stripped, hyphen and underscore
      // survive.
      ['a-b_c',     'a-b_c'],
      ['a.b',       'ab'],
      ['a/b',       'ab'],
      ['../../etc', 'etc'],
      ['héllo',     'hllo'],
      ['emoji \u2764', 'emoji_'],
      // Whitespace runs collapse to a single underscore - and stripping happens
      // FIRST, so punctuation between two spaces leaves ONE underscore.
      ['a  b',      'a_b'],
      ['a\t\nb',    'a_b'],
      ['a . b',     'a_b'],
      ['Parity  Blocks! (v2)', 'Parity_Blocks_v2'],
      // A leading or trailing space becomes a leading or trailing underscore;
      // nothing is trimmed.
      [' a ',       '_a_']
    ];

    expectations.forEach(function(pair) {
      assert.strictEqual(sanitizeFolderName(pair[0]), pair[1],
        'sanitizeFolderName(' + JSON.stringify(pair[0]) + ')');
    });

    // Truncation, LAST, at 50 characters.
    assert.strictEqual(
      sanitizeFolderName(new Array(61).join('x')).length, 50,
      'the name is truncated to 50 characters (`.substring(0, 50)`)'
    );
    assert.strictEqual(
      sanitizeFolderName(new Array(61).join('x')), new Array(51).join('x'),
      'and the first 50 are the ones kept'
    );
    // Order matters. 48 'a's, three spaces, then 19 'b's. Collapsing first
    // turns the run into ONE underscore, so the 50-character budget leaves room
    // for a 'b': 48 + '_' + 'b'. Truncating first would have spent two of those
    // characters on spaces and produced a 49-character name ending in '_', with
    // no 'b' at all - a different directory for the same trinket.
    assert.strictEqual(
      sanitizeFolderName(new Array(49).join('a') + '   ' + new Array(20).join('b')),
      new Array(49).join('a') + '_b',
      'collapse happens before truncation (`.replace(/\\s+/g, \'_\')` then ' +
      '`.substring(0, 50)`)'
    );
    assert.strictEqual(
      sanitizeFolderName(new Array(49).join('a') + '   ' + new Array(20).join('b')).length,
      50,
      'and the result still fills the 50-character budget'
    );

    // The archive directory name, composed.
    assert.strictEqual(
      archiveBasePath({ lang: 'python', name: 'My Trinket', shortCode: 'ABC123' }),
      'python/My_Trinket_ABC123/',
      'the base path is lang/sanitized_shortCode/ (addTrinketToArchive)'
    );
    assert.strictEqual(
      archiveBasePath({ lang: '', name: '', shortCode: 'ABC123' }),
      'other/ABC123_ABC123/',
      'a falsy lang defaults to "other" and a falsy name falls back to the ' +
      'shortCode (addTrinketToArchive) - so "untitled" is reachable in the ' +
      'archive only ' +
      'when the name AND the shortCode are both falsy'
    );
    assert.strictEqual(
      archiveBasePath({ lang: 'python', name: '', shortCode: '' }),
      'python/untitled_/',
      'and then it really is "untitled"'
    );

    measured(ctx, {
      sanitized : expectations.map(function(pair) {
        return JSON.stringify(pair[0]) + ' -> ' + sanitizeFolderName(pair[0]);
      }),
      truncatedLength : sanitizeFolderName(new Array(61).join('x')).length,
      basePaths : [
        archiveBasePath({ lang: 'python', name: 'My Trinket', shortCode: 'ABC123' }),
        archiveBasePath({ lang: '', name: '', shortCode: 'ABC123' }),
        archiveBasePath({ lang: 'python', name: '', shortCode: '' })
      ]
    });
  }
});

cases.push({
  name : 'archive-code-shapes',
  pins : 'lib/workers/exports.js (parseCodeFiles)',
  run  : async function(ctx) {
    var files;

    // The JSON file-array shape, taken verbatim - names and contents both.
    files = parseCodeFiles({
      lang : 'python',
      code : '[{"name":"main.py","content":"print(1)\\n"},' +
             '{"name":"lib/util.py","content":"X = 1\\n"}]'
    });
    assert.deepStrictEqual(files, [
      { name : 'main.py',      content : 'print(1)\n' },
      { name : 'lib/util.py',  content : 'X = 1\n' }
    ], 'a JSON array of {name, content} is used as it stands (parseCodeFiles)');

    // The raw-string fallback, per lang.
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'python', code : 'print(1)' }),
      [{ name : 'main.py', content : 'print(1)' }],
      'a non-JSON payload becomes one file named main + the lang extension'
    );
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'blocks', code : '<xml/>' }),
      [{ name : 'main.xml', content : '<xml/>' }],
      'a lang matching /blocks/ names it main.xml (parseCodeFiles: ' +
      '`/blocks/.test(trinket.lang) ? \'main.xml\' : ...`)'
    );
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'my-blocks-variant', code : '<xml/>' }),
      [{ name : 'main.xml', content : '<xml/>' }],
      ':344 tests /blocks/ as a SUBSTRING, so any lang containing it takes the ' +
      'xml branch - preserved rather than tightened to an equality'
    );
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'ruby', code : 'puts 1' }),
      [{ name : 'main.txt', content : 'puts 1' }],
      'a lang the extension map does not know defaults to .txt ' +
      '(parseCodeFiles: `langExtensions[trinket.lang] || \'.txt\'`)'
    );
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'R', code : 'x <- 1' }),
      [{ name : 'main.R', content : 'x <- 1' }],
      'the extension map is case-sensitive: the lang is `R`, not `r` ' +
      '(`langExtensions`)'
    );

    // Valid JSON that is not an array takes the SAME fallback, because
    // `parseCodeFiles` throws its own 'Not an array' to get there.
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'python', code : '{"name":"x"}' }),
      [{ name : 'main.py', content : '{"name":"x"}' }],
      'valid JSON that is not an array is treated as a single raw file ' +
      '(parseCodeFiles: the `throw new Error(\'Not an array\')` branch), and ' +
      'its own text becomes the content'
    );
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'python', code : '"a string"' }),
      [{ name : 'main.py', content : '"a string"' }],
      'and so is a JSON scalar'
    );

    // A JSON array of anything at all is accepted without validation, and
    // `addTrinketToArchive` then appends an entry named `basePath + undefined`.
    // Asserted as it behaves rather than corrected: the behaviour under test is
    // the application's, not this harness's.
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'python', code : '["a"]' }),
      ['a'],
      'a JSON array is returned unvalidated (parseCodeFiles)'
    );

    measured(ctx, {
      fallbackNames : ['blocks', 'python', 'R', 'r', 'unknown-lang'].map(
        function(lang) {
          return lang + ' -> ' + parseCodeFiles({
            lang : lang, code : 'not json'
          })[0].name;
        }
      ),
      langExtensions : LANG_EXTENSIONS
    });
  }
});

cases.push({
  name : 'archive-layout',
  pins : 'lib/workers/exports.js (createExportArchive, addTrinketToArchive)',
  run  : async function(ctx) {
    var entries = archiveEntriesForFixtures();
    var bytes   = await buildArchive(entries, { archiver: ctx.archiver });
    // THE APPLICATION'S OWN READ LIBRARY, FIRST AND WITH NO BYPASS. This is
    // the assertion the persisted-format gate rests on; the inflating reader
    // below is diagnostic evidence about what the archive contains, and
    // evidence is not a verdict.
    var probe   = probeApplicationRead(bytes, ctx.AdmZip, {
      appRoot : ctx.appRoot
    });
    var report;
    var fileEntries = entries.length;
    var failure;

    // The layout assertions run NEXT, and they run whether or not the probe
    // succeeded: a reader who has just been told the archive cannot be opened
    // needs to know what is inside it, and re-running the gate to find out is
    // exactly the cost this harness exists to remove.
    report = assertArchiveLayout(
      bytes,
      { trinkets : ARCHIVE_TRINKETS, failedTrinkets : 0 },
      { AdmZip : ctx.AdmZip, appRoot : ctx.appRoot }
    );

    assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0,
      'the archive must have been produced');
    assert.strictEqual(report.entries.length, fileEntries,
      'every appended entry must be readable back');
    assert.strictEqual(report.manifest.totalTrinkets, ARCHIVE_TRINKETS.length,
      'the manifest counts every trinket');
    assert.strictEqual(report.trinkets.length, ARCHIVE_TRINKETS.length,
      'and describes each of them');

    // The four directory names, spelled out, so the sanitizer's effect on the
    // LAYOUT is asserted and not only on the function.
    assert.deepStrictEqual(
      report.trinkets.map(function(item) { return item.basePath; }),
      [
        'python/Parity_Python_AAAAAA/',
        'blocks/Parity_Blocks_v2_BBBBBB/',
        'ruby/CCCCCC_CCCCCC/',
        'html/Parity_Assets_DDDDDD/'
      ],
      'one directory per trinket, named lang/sanitized_shortCode/'
    );

    // The asset naming rule, both halves.
    assert.ok(
      report.entries.indexOf('html/Parity_Assets_DDDDDD/assets/logo.gif') !== -1,
      'a named asset uses `asset.name` (:308)'
    );
    assert.ok(
      report.entries.indexOf('html/Parity_Assets_DDDDDD/assets/derived.png') !== -1,
      'an unnamed asset falls back to the basename of its url (:304,:308)'
    );

    // --- the read surface, and the verdict ---------------------------------
    assert.strictEqual(report.reader.library, 'adm-zip', 'the reader used');
    assert.ok(report.reader.version, 'and its version was read, not assumed');
    assert.strictEqual(probe.files, fileEntries,
      'the unbypassed read must see every appended entry');

    // Recorded on the artifact BEFORE anything throws, so the evidence exists
    // whichever way the verdict goes.
    ctx.reader = report.reader;
    ctx.reader.applicationRead = probe;

    if (report.reader.defect) {
      // Reached when the writer stated no crc and no uncompressed size for an
      // entry that has content. The trigger is a writer computing both inside
      // an override of `Writable.prototype.write` while the entry arrives
      // through `end(chunk)`, which does not route through it - not a property
      // of one Node version, so this branch is not waiting on a runtime change.
      note('archive read surface: ' + report.reader.defect);

      ctx.findings.push({
        subject : 'adm-zip / archiver archive read surface',
        detail  : report.reader.defect,
        owner   : 'docs/dependency-inventory.md'
      });
    }

    measured(ctx, {
      archiveBytes : bytes.length,
      archiveSha1  : sha1Hex(bytes),
      entries      : report.entries.slice().sort(),
      basePaths    : report.trinkets.map(function(item) {
        return item.basePath;
      }),
      manifest     : {
        totalTrinkets  : report.manifest.totalTrinkets,
        failedTrinkets : report.manifest.failedTrinkets,
        trinkets       : report.manifest.trinkets.length
      },
      reader       : {
        library        : report.reader.library,
        version        : report.reader.version,
        getDataUsable  : report.reader.getDataUsable,
        crcVerified    : report.reader.crcVerified,
        crcAbsent      : report.reader.crcAbsent
      },
      writer       : {
        archiver : readPackageVersion(ctx.appRoot, 'archiver'),
        admZip   : readAdmZipVersion(ctx.appRoot)
      }
    });

    if (probe.unreadable.length) {
      // WHAT THIS CASE DETECTS, AND WHY THE DETECTION IS A FAILURE RATHER THAN
      // A FINDING. The archive the application writes must be readable by the
      // ZIP library the application reads archives with. When it is not, the
      // persisted format is broken however tidy the layout inside it is, so
      // this branch fails the case; recording the observation without failing
      // would let a corrupt archive format exit 0.
      //
      // THE MECHANISM, which is what makes the failure diagnosable. A ZIP
      // writer that computes an entry's crc and raw size inside an override of
      // `Writable.prototype.write` records neither when the entry is delivered
      // through `Writable.prototype.end(chunk)`, because `end(chunk)` does not
      // route through `write()`. Every deflated entry then states crc32=0 and
      // uncompressed size=0 in the local header, the data descriptor AND the
      // central directory, and `adm-zip` cannot recover such an entry through
      // `getData()`: it returns an empty buffer where it trusts the declared
      // size, and throws a CRC32 failure where it validates the declared crc.
      //
      // WHAT MAKES THE CASE PASS, which is a condition on the writer rather
      // than on this tool: either the entry is appended as a stream, so the
      // writer pipes it through `write()` and records a valid crc, or the
      // writer records both values outside the `write()` override. The
      // versions in play are read at runtime rather than stated here, and are
      // reported in the artifact under `reader.version` for the reader and
      // `writer` for the writer. The case passes once every entry declares a
      // correct crc and length, and fails again if the writer stops doing so.
      failure = new Error(
        'the archive this repository\'s own archiver ' +
        (readPackageVersion(ctx.appRoot, 'archiver') || '?') + ' produced ' +
        'cannot be read by the adm-zip ' + probe.version + ' the application ' +
        'reads archives with: ' + probe.unreadable.length + ' of ' +
        probe.files + ' entries failed. ' +
        // The first three, named; all of them are in the artifact under
        // `reader.applicationRead.unreadable`. Twelve near-identical clauses on
        // stderr bury the cause that follows them.
        probe.unreadable.slice(0, 3).map(function(entry) {
          return entry.name + ' (' + entry.reason + '; the archive declares ' +
            'crc32=' + entry.declaredCrc + ' and uncompressed size=' +
            entry.declaredSize + ' for ' + entry.storedBytes + ' stored bytes)';
        }).join('; ') +
        (probe.unreadable.length > 3
          ? ' and ' + (probe.unreadable.length - 3) + ' more, all in the ' +
            'artifact under reader.applicationRead.unreadable'
          : '') +
        '. MEASURED CAUSE: compress-commons 1.2.2 computes the crc and the raw ' +
        'size inside an override of Writable.prototype.write (crc32-stream ' +
        '2.0.0), and modern Node\'s Writable.prototype.end(chunk) does not go ' +
        'through write(), so zip-stream 1.2.0 delivering a buffer entry with ' +
        '.end(source) leaves crc32=0 and uncompressed size=0 in the local ' +
        'header, the data descriptor and the central directory. OWNERS: ' +
        'package.json and package-lock.json (the writer chain archiver 2.1.1 ' +
        '-> zip-stream 1.2.0 -> compress-commons 1.2.2 -> crc32-stream 2.0.0) ' +
        'and lib/workers/exports.js (the archiver call site). Pre-existing at ' +
        'base commit 2f8712a; this harness reports it and does not repair it.'
      );

      // Carried on the error so the verdict names the files that must change
      // rather than blaming the harness that found the problem.
      failure.owner = 'package.json, package-lock.json, lib/workers/exports.js';

      throw failure;
    }

    // The pass branch: `adm-zip` read every entry, the archive declares a crc
    // for each of them, and the diagnostic reader verified all of those crcs.
    // A writer that states a valid crc and length per entry satisfies all four.
    assert.strictEqual(probe.readable, fileEntries,
      'every entry must be readable through the application\'s own getData()');
    assert.strictEqual(report.reader.crcAbsent, 0,
      'no entry may be left unverified when the archive states its crc');
    assert.strictEqual(report.reader.crcVerified, fileEntries,
      'every entry\'s declared crc32 was checked');
    assert.strictEqual(report.reader.getDataUsable, true,
      'and the reader must say so, so the artifact and the verdict agree');
  }
});

cases.push({
  name : 'no-leftover-uploads',
  pins : 'lib/util/file.js:52',
  run  : async function(ctx) {
    // Everything the cases wrote into the scratch root should be gone by now:
    // either `_fileToContainer` unlinked it or the case that owns it
    // removed it. Three entries this harness created on purpose remain - the
    // S3 store, the snapshot source directory, and the ownership marker
    // `removeScratch` requires before it will delete the tree - and all three
    // go with the scratch root at the end of the run. They are excluded BY
    // NAME rather than by a pattern, so nothing else can hide behind them.
    var expected  = [SCRATCH_MARKER, 's3', 'snapshots'];
    var entries   = fs.readdirSync(ctx.scratch).sort();
    var remaining = entries.filter(function(entry) {
      return expected.indexOf(entry) === -1;
    });

    assert.deepStrictEqual(remaining, [],
      'the scratch directory must hold no leftover upload files; found [' +
      remaining.join(', ') + ']. A survivor means either :52 stopped running ' +
      'or a case that owns its temporary file stopped removing it.'
    );

    // The marker has to survive the run: without it `removeScratch` refuses to
    // delete the tree, and the run would leak its scratch directory silently.
    assert.strictEqual(entries.indexOf(SCRATCH_MARKER) !== -1, true,
      'the ownership marker ' + SCRATCH_MARKER + ' must still be present, or ' +
      'the scratch directory cannot be proven owned and will not be removed'
    );

    measured(ctx, {
      scratchEntries : entries,
      leftovers      : remaining,
      markerPresent  : entries.indexOf(SCRATCH_MARKER) !== -1
    });
  }
});


// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

// A timeout is distinguished from every other failure by this marker rather
// than by matching its message, because the run has to STOP on a timeout and
// only on a timeout - see `runCases`.
var TIMED_OUT = {};

/**
 * Runs one case with a ceiling, and collects the evidence it measured.
 *
 * The ceiling is a race rather than a wrapper around the assertions, because
 * the failure it exists for is a lifecycle that never settles - and no
 * assertion inside such a case ever runs. The timer is unref'd so a completed
 * run is never held open by it.
 *
 * A TIMEOUT IS NOT AN ORDINARY FAILURE. `Promise.race` reports which promise
 * settled first; it does not stop the other one. So a case that timed out is
 * still running - still holding the store, the database and the fixture's call
 * log - while this function's `finally` deletes the temporary files it owns and
 * the runner moves on. Anything it does from then on lands in whichever case
 * happens to be executing, and every later assertion about the ordered call log
 * or the leftover file set is reading a state two cases are writing. The record
 * therefore carries `timedOut`, and `runCases` stops.
 *
 * @param {Object} testCase
 * @param {Object} ctx
 * @returns {Promise<Object>} The result record; never rejects.
 */
async function runCase(testCase, ctx) {
  var limit   = testCase.timeoutMs || CASE_TIMEOUT_MS;
  var started = Date.now();
  var timer   = null;
  var record  = {
    name       : testCase.name,
    pins       : testCase.pins,
    status     : 'passed',
    durationMs : 0
  };
  var owned;
  var duplicates;

  activeCaseName = testCase.name;

  if (ctx) {
    // One evidence bag per case. Reset here rather than in the case body so a
    // case that throws halfway still reports what it had measured up to that
    // point, which is usually what identifies the failure.
    ctx.evidence = {};
  }

  var settlementsBefore = ledger ? ledger.settlements.length : 0;
  var extraDeliveries;

  if (ledger) {
    ledger.activeCase = testCase.name;
  }

  try {
    await Promise.race([
      testCase.run(ctx),
      new Promise(function(resolve, reject) {
        timer = setTimeout(function() {
          var err = new Error('the case did not finish within ' + limit + ' ms');

          err.parityTimeout = TIMED_OUT;
          reject(err);
        }, limit);

        if (timer.unref) {
          timer.unref();
        }
      })
    ]);
  }
  catch (err) {
    record.status  = 'failed';
    record.error   = (err && err.message) || String(err);
    record.stack   = (err && err.stack) || null;

    if (err && err.parityTimeout === TIMED_OUT) {
      record.timedOut = true;
    }

    // A case that knows which files must change says so on the error, and the
    // verdict repeats it rather than blaming the harness that found the
    // problem. The archive-read case is the one that needs this: its cause is
    // in the writer chain, which this file may not touch.
    if (err && err.owner) {
      record.owner = err.owner;
    }

    // assert's own diff is the most useful part of an assertion failure, so it
    // is kept alongside the message rather than flattened into it.
    if (err && err.code === 'ERR_ASSERTION') {
      record.expected = describeValue(err.expected);
      record.actual   = describeValue(err.actual);
      record.operator = err.operator;
    }
  }
  finally {
    if (timer) {
      clearTimeout(timer);
    }

    // A CALLBACK THAT DELIVERED TWICE FAILS THE CASE THAT OWNED IT. The second
    // delivery could not re-settle the promise the case awaited, so nothing in
    // the case body could have seen it; the registry is read here instead,
    // which is what makes exactly-once the adapter's default contract rather
    // than an assertion 17 of the 18 call sites forgot to write. Each claimed
    // entry is marked so `buildGate`'s sweep reports only the deliveries that
    // arrived too late for any case to own.
    extraDeliveries = ledger
      ? ledger.settlements.slice(settlementsBefore).filter(function(entry) {
          return entry.case === testCase.name;
        })
      : [];

    if (extraDeliveries.length) {
      extraDeliveries.forEach(function(entry) {
        entry.attributed = true;
      });

      record.doubleSettlements = extraDeliveries.map(function(entry) {
        return { where : entry.where, calls : entry.calls };
      });

      // An existing failure is not overwritten - it may be the CAUSE of the
      // second delivery - but the mechanism is appended so the verdict names
      // it either way.
      if (record.status === 'passed') {
        record.status      = 'failed';
        record.failureKind = 'double-settlement';
        record.error       = 'a callback delivered more than once: ' +
          extraDeliveries.map(function(entry) {
            return entry.where + ' fired ' + entry.calls + ' times';
          }).join('; ') +
          '. Only the first delivery could be asserted, because the promise ' +
          'had already settled; a response delivered twice is a defect in the ' +
          'module under test.';
      }
      else {
        record.error = record.error + ' [and a callback delivered more than ' +
          'once: ' + extraDeliveries.map(function(entry) {
            return entry.where + ' fired ' + entry.calls + ' times';
          }).join('; ') + ']';
      }
    }

    if (ledger) {
      ledger.activeCase = null;
    }

    // Every temporary file the case owns - the ones the application is NOT
    // expected to unlink - goes now, whether the case passed or threw. See the
    // note on `upload`: without this, one failed assertion left a file behind
    // and `no-leftover-uploads` failed too, reporting a cause that was not the
    // real one.
    owned = ctx && ctx.harnessOwned ? ctx.harnessOwned.splice(0) : [];

    owned.forEach(function(target) {
      try {
        fs.rmSync(target, { force: true });
      }
      catch (err) {
        // A leftover the harness owns would make `no-leftover-uploads` fail
        // with someone else's cause, so the removal failure is attributed here
        // and enters the verdict as a teardown failure of its own.
        recordTeardownFailure('could not remove ' + target, err);
      }
    });

    // Any callback that fired more than once while this case ran. Collected
    // after the body so a duplicate delivered on a later tick of the same case
    // is still attributed to it, and converted into a failure here so no case
    // has to remember to check.
    duplicates = drainDuplicateDeliveries();

    if (duplicates.length) {
      record.duplicateDeliveries = duplicates;

      if (record.status === 'passed') {
        record.status = 'failed';
        record.error  = duplicates.length + ' callback delivery/deliveries ' +
          'beyond the first: ' + duplicates.map(function(entry) {
            return 'fired ' + entry.calls + ' times';
          }).join(', ') + '. A lifecycle callback that fires twice delivers a ' +
          'response twice; the first delivery is what every assertion above ' +
          'saw, so the case is reported as failed rather than passed.';
      }
    }

    if (ctx && ctx.evidence && Object.keys(ctx.evidence).length) {
      record.evidence = ctx.evidence;
    }

    if (ctx) {
      ctx.evidence = null;
    }

    activeCaseName = null;
  }

  record.durationMs = Date.now() - started;

  return record;
}

/**
 * Reduces one process warning to the record the artifact carries.
 *
 * The message alone does not say who raised it, and "who" is the whole
 * question: a warning from this harness's own source is a defect in this file,
 * one from a dependency is a finding about that dependency. So the caller
 * frames come with it, and `attributeWarning` reads them.
 *
 * @param {Object} warning A `process.on('warning')` argument.
 * @returns {{name: string, code: string, message: string, origin: Array<string>}}
 */
function describeWarning(warning) {
  var frames = ((warning && warning.stack) || '')
    .split('\n')
    .filter(function(line) { return /^\s+at /.test(line); })
    .map(function(line) { return line.trim(); })
    // Node's own frames are dropped, and not for brevity: a flagged
    // deprecation is RAISED inside node - DEP0005's top two frames are
    // `showFlaggedDeprecation` and `new Buffer`, both `node:buffer` - so
    // keeping them would attribute every such warning to Node and hide the
    // module that actually called the deprecated API, which is the decision
    // `attributeWarning` reads these frames to make.
    .filter(function(line) {
      return !/^at node:/.test(line) && !/\(node:/.test(line);
    });

  return {
    name    : warning && warning.name,
    code    : warning && warning.code,
    message : warning && warning.message,
    // The first three caller frames are enough to attribute it, and keeping
    // the whole stack out of the artifact keeps a diff of two runs readable.
    origin  : frames.slice(0, 3)
  };
}

/**
 * Collects every process warning raised while `body` runs, and judges the run
 * against the shared zero-warning policy.
 *
 * AAP 0.9.3's gate is that the run emits no warning attributable to the
 * application's own source or to any dependency the plan retains, and the agent
 * brief for this file asks for it to be run under `--pending-deprecation
 * --trace-deprecation` and confirmed to contribute nothing of its own. Reading
 * that off a terminal is not evidence, so the warnings are captured into the
 * artifact WITH their origin - the frame that raised them.
 *
 * RECORDING THEM WAS NOT ENOUGH, and that was the defect this now closes: the
 * captures went into `findings`, which only printed, so a run that emitted a
 * deprecation still exited 0 and still read as a passing gate. They are now
 * judged by test/parity/warning-policy.js, which has no allowances, and the
 * verdict reaches the exit code through the failure set `buildGate` assembles -
 * not through a branch beside it, which was the second half of the same defect.
 *
 * Two collectors run, because one alone has a measured blind spot. The listener
 * below sees every `process.emitWarning` and attributes it to a frame; the
 * shared collector additionally TEES stderr, which is the only way to see
 * Mongoose's notices - it prints them through `console.warn`, so no process
 * warning listener ever sees them. Both are added rather than substituted:
 * Node's own handler still prints, nothing is suppressed, and a notice stays as
 * visible as it was. Both are removed in a `finally` so a caller that requires
 * this module inherits neither.
 *
 * `--pending-deprecation` matters here. DEP0005 - `new Buffer()` - is a PENDING
 * deprecation, silent without that flag, and this is the one measurement that
 * makes it visible: `archiver` 2.1.1 reaches it through `compress-commons`
 * 1.2.2, and `lib/workers/exports.js:11` requires `archiver`, so the worker
 * emits it too. That is a finding about a retained dependency - and under
 * 0.9.3, which covers retained dependencies explicitly, it is a gate FAILURE
 * rather than a note, until the dependency decision that owns archiver removes
 * the emitting path.
 *
 * @param {function(): Promise<*>} body
 * @param {(string|null)} [appRoot] The tree under test, for the policy's
 *   foreign-tree rule: a run against a BASELINE worktree measures that tree
 *   rather than gating it, because only the target's `config/aws.js` suppresses
 *   the AWS SDK's end-of-support notice.
 * @returns {Promise<{value: *, warnings: Array<Object>, gate: Object}>}
 */
async function captureWarnings(body, appRoot) {
  var warnings = [];
  var collector = warningPolicy.createCollector({
    tee            : true,
    ignorePrefixes : [LOG_PREFIX]
  });
  var notices;
  var tree = warningPolicy.gateAppliesTo(appRoot || null);
  var value;

  function onWarning(warning) {
    warnings.push(describeWarning(warning));
  }

  process.on('warning', onWarning);

  try {
    value = await body();
  }
  finally {
    // Warnings already scheduled are delivered before the collector closes.
    // Node delivers an emitWarning on a later turn and a dependency can
    // schedule one on a timer - the retained AWS SDK emits its NOTE from a
    // zero-delay timer - so closing synchronously here would report a clean run
    // and then let the notice print after the verdict.
    await warningPolicy.drainPendingWarnings();
    // DRAINED BEFORE THE LISTENER COMES OFF, and this is load-bearing rather
    // than defensive. `process.emitWarning` does not call listeners
    // synchronously - it schedules the emission - so a warning raised in the
    // body's final microtask is still queued when the body's promise resolves.
    // Removing the listener in the same turn was measured to lose exactly that
    // warning: it printed on stderr, `warnings` came back empty, and the gate
    // passed. Draining first is what makes the captured set complete, and it
    // is inside the `finally` so a rejecting body's last warning is captured
    // too - the drain cannot change the outcome, because the rejection
    // continues to propagate after it.
    await quiesce();
    process.removeListener('warning', onWarning);
    notices = collector.close();
  }

  return {
    value: value,
    warnings: warnings,
    gate: warningPolicy.judge({
      notices     : notices,
      flags       : warningPolicy.processFlagAudit(),
      subject     : 'this harness\'s process, which loads the application ' +
                    'modules it exercises',
      gateApplies : tree.applies,
      treeNote    : tree.treeNote
    })
  };
}

// Installed at most once per process: `run()` is exported and a caller may
// invoke it twice, and two guards would report one late warning twice.
var lateWarningGuardInstalled = false;

/**
 * Keeps a warning raised AFTER the capture window from being lost.
 *
 * The capture above closes when the measured body finishes, and everything
 * after it - assembling the verdict, computing the digest, writing the
 * artifact - can still raise one. Such a warning cannot be folded into a
 * verdict that already exists, so it does the one thing still available and
 * decides the exit code, for the same reason a late callback delivery does: the
 * contract is that this tool exits 0 only when nothing it was built to detect
 * was detected, and a warning after finalization was still detected.
 *
 * The listener is left installed for the life of the process deliberately -
 * there is no later point at which a warning would stop mattering - and it is
 * additive, so Node's own handler still prints and nothing is suppressed.
 *
 * @returns {undefined}
 */
function guardLateWarnings() {
  if (lateWarningGuardInstalled) {
    return undefined;
  }

  lateWarningGuardInstalled = true;

  process.on('warning', function(warning) {
    var described = describeWarning(warning);

    note('GATE FAILURE [' + FAILURE_KIND.WARNING + '] (' +
      (attributeWarning(described) === 'dependency'
        ? 'docs/dependency-inventory.md'
        : 'test/parity/storage.js') + ') ' +
      (described.code || described.name || 'warning') + ' from the ' +
      attributeWarning(described) + ': ' + described.message + ' (' +
      (described.origin[0] || 'origin unknown') + '). It was raised after ' +
      'this run assembled its verdict, so it could not be folded into it; ' +
      'the exit code is forced to ' + EXIT_ERROR + ' instead.');

    process.exitCode = EXIT_ERROR;
  });

  return undefined;
}

/**
 * Attributes a captured warning to the code that raised it.
 *
 * A warning from this harness's own source is a defect in this file; one from a
 * dependency is a finding about that dependency. Distinguishing them mechanically
 * is what makes "the harness contributes no warning of its own" an assertion
 * rather than a claim.
 *
 * @param {Object} warning From captureWarnings.
 * @returns {string} 'harness', 'dependency' or 'unknown'
 */
function attributeWarning(warning) {
  var origin = (warning.origin || []).join(' ');

  if (origin.indexOf('node_modules') !== -1) {
    return 'dependency';
  }

  if (/test[\/\\]parity|[\/\\]lib[\/\\]|app\.js/.test(origin)) {
    return 'harness';
  }

  return 'unknown';
}

/**
 * Renders a value for the artifact.
 *
 * Buffers are summarized rather than dumped: a failing byte comparison would
 * otherwise put an entire payload into the report, and the length and digest
 * say more about a mismatch than the bytes do.
 *
 * @param {*} value
 * @returns {*}
 */
function describeValue(value) {
  if (Buffer.isBuffer(value)) {
    return {
      type   : 'Buffer',
      length : value.length,
      sha1   : sha1Hex(value)
    };
  }

  if (value instanceof Error) {
    return { type : 'Error', name : value.name, message : value.message };
  }

  return value;
}

/**
 * Runs every case in order and returns the result.
 *
 * Sequential and never parallel: the cases share one object store and one
 * database, several of them assert on the fixture's ordered call log, and two
 * of them deliberately alter a seeded object and restore it. Interleaving would
 * make every one of those assertions a race.
 *
 * A failing case does NOT stop the run: a storage regression is usually one
 * cause with several symptoms, and seeing all of them is what identifies it.
 * The two negative controls restore their state in a `finally`, so a failure
 * there cannot poison what follows.
 *
 * A TIMED-OUT case DOES stop it, and the distinction is not a preference. An
 * assertion failure is over - the body has returned and the shared state is
 * whatever it left. A timeout means the body is STILL RUNNING: `Promise.race`
 * settles on the timer without cancelling the case, and JavaScript offers no
 * way to terminate it. From that point the abandoned body keeps writing to the
 * one object store, the one database and the one ordered call log that every
 * later case reads, and `runCase`'s cleanup has already deleted the temporary
 * files it owned underneath it. Anything reported after that describes two
 * cases at once, so it is not evidence - and this file exists to produce
 * evidence. The remaining cases are recorded as `not-run` with the reason, so
 * the artifact says what was not measured instead of leaving it to be inferred
 * from a count.
 *
 * @param {Object} ctx
 * @returns {Promise<Array<Object>>}
 */
async function runCases(ctx) {
  var results = [];
  var aborted = null;
  var i;
  var record;

  for (i = 0; i < cases.length; i++) {
    if (aborted) {
      results.push({
        name       : cases[i].name,
        pins       : cases[i].pins,
        status     : 'not-run',
        durationMs : 0,
        reason     : 'the run stopped after `' + aborted + '` timed out: that ' +
                     'case\'s body cannot be cancelled and is still using the ' +
                     'shared store, database and call log, so any later result ' +
                     'would describe two cases at once'
      });
      continue;
    }

    record = await runCase(cases[i], ctx);
    results.push(record);

    if (record.status === 'passed') {
      note('ok   ' + record.name + ' (' + record.durationMs + ' ms)');
    }
    else {
      note('FAIL ' + record.name + ' (' + record.durationMs + ' ms): ' +
        record.error);
    }

    if (record.timedOut) {
      aborted = record.name;
      note('STOPPING: `' + aborted + '` timed out and its body is still ' +
        'running against the shared store and database. The remaining ' +
        (cases.length - i - 1) + ' case(s) are recorded as not-run rather ' +
        'than measured against a contaminated context.');
    }
  }

  return results;
}

/**
 * Seeds the database and pre-populates the object store.
 *
 * The three groups are the ones the cases read: `users` because a File document
 * needs an owner, `files` because the pre-migration cases read a seeded record,
 * and `exports` because the export-key case reads a seeded archive.
 * `force: true` deletes the fixed ids first, so a run inside a shared
 * `test/parity/mongo.js` lifecycle starts from the same state as a solitary one.
 *
 * The object store is pre-populated from the SAME descriptors, so a record's
 * `url` and the key it resolves to cannot drift apart.
 *
 * @param {Object} app The loaded application surface.
 * @returns {Promise<Object>} A summary for the artifact.
 */
async function prepare(app) {
  var summary = await seed.seed({
    force : true,
    users : true,
    files : true,
    exports : true
  });
  var manifest = seed.s3Manifest();
  var loaded   = app.awsFixture.prepopulate(manifest);

  if (loaded.rejected !== 0) {
    throw new ToolError(
      'the S3 fixture rejected ' + loaded.rejected + ' of ' + manifest.length +
      ' seed entries: ' + loaded.errors.join('; ')
    );
  }

  if (loaded.loaded !== manifest.length) {
    throw new ToolError(
      'the S3 fixture stored ' + loaded.loaded + ' of ' + manifest.length +
      ' seed entries'
    );
  }

  note('seeded ' + summary.selected.join(', ') + '; pre-populated ' +
    loaded.loaded + ' objects');

  return { groups: summary.selected, objects: loaded.loaded };
}

/**
 * Removes the documents the cases created.
 *
 * Only ids the cases recorded are deleted, so nothing a sibling harness put in
 * a shared database is touched, and the seeded fixtures - which
 * `seed.reset` owns - are left alone.
 *
 * @param {Object} ctx
 * @returns {Promise<number>} How many were removed.
 */
async function cleanupDocuments(ctx) {
  var ObjectId = ctx.appMongoose.Types.ObjectId;
  var ids;
  var result;

  if (!ctx.createdFileIds.length) {
    return 0;
  }

  ids = ctx.createdFileIds.map(function(id) { return new ObjectId(id); });

  try {
    result = await ctx.FileModel.model.collection.deleteMany({
      _id : { $in : ids }
    });

    return result.deletedCount;
  }
  catch (err) {
    // The documents the cases created are still in the database, so a later
    // run in the same lifecycle starts from a state nobody chose. Recorded on
    // the verdict; the removal count still returns, so the artifact reports 0
    // rather than a number it did not achieve.
    recordTeardownFailure(
      'could not remove the documents the cases created', err
    );
    return 0;
  }
}

/**
 * Loads the application, connects, seeds and runs the cases.
 *
 * Separated from `run` so that the database lifecycle - started here or
 * inherited from `test/parity/mongo.js` - is decided in exactly one place.
 *
 * ACQUISITION IS INSIDE THE TRY, ALL OF IT. Three things are acquired before a
 * case can run - the AWS namespace patch and the `File` global that
 * `loadApplication` installs, and one or two Mongoose connections - and each is
 * a process-wide mutation that has to be undone. Acquiring any of them ABOVE
 * the `try` means a failure in the next step returns through no `finally` at
 * all: the fixture stays patched over the real SDK, and an open Mongoose
 * connection keeps its socket and heartbeat timer alive so the process does not
 * exit and the run reads as a hang rather than as the error it was. Both were
 * reachable in practice - `lib/util/file.js` failing to load in a tree that has
 * not been installed, and the second `connect` failing after the first
 * succeeded.
 *
 * So the ledger is created first and empty, every acquisition records itself on
 * it as it happens, and one `finally` releases whatever the ledger holds. That
 * makes the release exact under partial acquisition, which is the only case
 * where it matters.
 *
 * @param {string} appRoot
 * @param {string} scratch The scratch directory's path.
 * @param {Object} env From prepareEnvironment.
 * @param {string} uri
 * @param {string} source MONGO_SOURCE_LIFECYCLE or MONGO_SOURCE_EXTERNAL; the
 *   whole of the destructive-write provenance decision, supplied by the caller
 *   because nothing in the address itself can establish it.
 * @returns {Promise<Object>} The result.
 */
async function execute(appRoot, scratch, env, uri, source) {
  // The acquisition ledger. Empty until something is actually acquired, and
  // read only by the `finally` below.
  var acquired = { app : null, awsFixture : null, connected : [] };
  var ctx;
  var results;
  var prepared;
  var database;
  var removed = 0;

  try {
    // Before the first connection, and therefore before `prepare` deletes the
    // fixed fixture ids in it.
    database = assertDisposableMongoUri(uri, source);

    note('database ' + database.database + ' (' + database.provenance +
      (database.provenance === MONGO_SOURCE_EXTERNAL
        ? ', authorized by ' + EXTERNAL_MONGO_OPT_IN
        : '') +
      '), which this run seeds and deletes documents in');

    acquired.app = loadApplication(appRoot, acquired);

    await connectAll(
      [mongoose, acquired.app.appMongoose], uri, acquired.connected
    );

    prepared = await prepare(acquired.app);

    ctx = {
      appRoot        : appRoot,
      scratch        : scratch,
      awsFixture     : acquired.app.awsFixture,
      awsModule      : acquired.app.awsModule,
      FileUtil       : acquired.app.FileUtil,
      FileModel      : acquired.app.FileModel,
      config         : acquired.app.config,
      appMongoose    : acquired.app.appMongoose,
      AdmZip         : acquired.app.AdmZip,
      archiver       : acquired.app.archiver,
      createdFileIds : [],
      harnessOwned   : [],
      findings       : [],
      evidence       : null,
      reader         : null
    };

    results = await runCases(ctx);
  }
  finally {
    if (ctx) {
      removed = await cleanupDocuments(ctx);
    }

    // Unpatched before the process ends, so a require of this module inside a
    // longer-lived process cannot leave the genuine SDK swapped out. Read off
    // the ledger rather than off `app`, because the patch exists as soon as the
    // fixture module is required - which is before `loadApplication` returns.
    if (acquired.awsFixture) {
      try {
        acquired.awsFixture.restore();
      }
      catch (err) {
        note('WARNING: could not restore the S3 fixture: ' +
          ((err && err.message) || err));
      }

      releaseAwsFixtureModule();
    }

    await disconnectAll(acquired.connected);
  }

  // WHAT IDENTIFIES THIS RESULT is the provenance block `run()` attaches, not
  // a path: the tree under test is named there by its HEAD, whereas an absolute
  // `appRoot` would say only where that tree sat on one machine. The MongoDB
  // URI is absent for the same reason and one more - it carries a host, a port
  // and a per-run database name, all of them run state - and `dataStore` below
  // records what a reader actually needs from it.
  return {
    tool     : 'test/parity/storage.js',
    // The flags this run was started under, verbatim. They DECIDE what
    // `warnings` can contain - DEP0005 is a pending deprecation and is silent
    // without `--pending-deprecation` - so a warning set read without them is
    // not interpretable. Kept on the result rather than in the provenance
    // block, which the shared contract owns.
    nodeFlags: process.execArgv.slice(),
    // The keys two correct runs legitimately differ on, so a reviewer diffing
    // two artifacts knows which differences mean nothing. This is the DIFF
    // guide; what the `digest` covers is a narrower question and `digest.over`
    // answers it in the artifact itself.
    volatile : [
      'provenance, in full - the run\'s revisions and runtime, which is also ' +
        'why the digest excludes it (see digest.over)',
      'dataStore.digest, when the run-local address differs',
      'cases[].durationMs',
      'cases[*].evidence.documentId, and the remoteName, url and ' +
        'persistedUrl built from it (a generated ObjectId, except where a ' +
        'case supplies a fixed id)',
      'cases[*].evidence.delayMs and elapsedMs (measured wall clock; the ' +
        'assertions bound them, the values are not fixed)',
      'cases[*].evidence.errorMessage where the message embeds a generated ' +
        'id or a scratch path',
      'cases[archive-layout].evidence.archiveSha1 and archiveBytes (the ZIP ' +
        'records a modification time per entry)',
      'warnings, and the findings derived from them - see nodeFlags'
    ],
    nodeEnv  : env.nodeEnv,
    node     : process.version,
    dataStore: describeDataStore(uri),
    seeded   : prepared,
    versions : {
      admZip   : readAdmZipVersion(appRoot),
      archiver : readPackageVersion(appRoot, 'archiver')
    },
    // NO `provenance` KEY HERE, deliberately. `run` attaches the shared block
    // from test/parity/manifest.js once the result is final, and a placeholder
    // in its place used to be built here and then silently replaced - so the
    // digest taken between the two certified a value the artifact never
    // carried. The block is ADDED by `attach`, never a field it overwrites.
    reader          : ctx.reader,
    findings        : ctx.findings,
    documentsRemoved: removed,
    total           : results.length,
    passed          : results.filter(function(r) { return r.status === 'passed'; }).length,
    failed          : results.filter(function(r) { return r.status === 'failed'; }).length,
    notRun          : results.filter(function(r) { return r.status === 'not-run'; }).length,
    cases           : results
  };
}

/**
 * A digest over everything about the result that a reader must be able to
 * recompute from the delivered bytes.
 *
 * Two runs on the same tree differ in the fields `VOLATILE_FIELDS` names - a
 * per-clone absolute path, an ephemeral database address, wall-clock durations.
 * Those come out, and so does `provenance`, for the reason
 * `DIGEST_EXCLUDED_FIELDS` states: the block is written after this value exists
 * and hash-links the payload in the other direction. What is left is the
 * storage verdict itself, which gives a committed artifact one number a
 * reviewer can recompute instead of a diff they have to read past.
 *
 * THE RECOMPUTATION IS THE POINT, so it is stated as a recipe a reader can
 * follow without this file: parse the artifact, delete the keys `over` names
 * wherever they appear at any depth, `JSON.stringify` what remains in the
 * artifact's own key order, and sha256 it. A number that cannot be reproduced
 * that way is not evidence, which is exactly what the previous version
 * delivered - it hashed a payload containing a provenance placeholder that
 * `provenance.attach` then replaced.
 *
 * @param {Object} result The result, final except for the provenance block.
 * @returns {{algorithm: string, value: string, over: string}}
 */
function digestResult(result) {
  var projection = stripForDigest(result);

  return {
    algorithm : 'sha256',
    value     : crypto.createHash('sha256')
      .update(JSON.stringify(projection))
      .digest('hex'),
    over      : 'the result with ' + DIGEST_EXCLUDED_FIELDS.join(', ') +
                ' removed at any depth, serialized with JSON.stringify in the ' +
                'artifact\'s own key order'
  };
}

/**
 * Deep copy of `value` with every `DIGEST_EXCLUDED_FIELDS` key removed, at any
 * depth.
 *
 * By key name rather than by path, so a duration nested inside a case record is
 * removed by the same rule as one at the top - there is no list of paths to keep
 * in step with the result's shape.
 *
 * @param {*} value
 * @returns {*}
 */
function stripForDigest(value) {
  var copy;

  if (Array.isArray(value)) {
    return value.map(stripForDigest);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  copy = {};

  Object.keys(value).forEach(function(key) {
    if (DIGEST_EXCLUDED_FIELDS.indexOf(key) !== -1) {
      return;
    }

    copy[key] = stripForDigest(value[key]);
  });

  return copy;
}

/**
 * A package's declared version, for the artifact.
 *
 * @param {string} appRoot
 * @param {string} name
 * @returns {(string|null)}
 */
function readPackageVersion(appRoot, name) {
  try {
    return resolveDependency(appRoot, name + '/package.json').version;
  }
  catch (err) {
    return null;
  }
}


// ---------------------------------------------------------------------------
// Evidence identity
// ---------------------------------------------------------------------------
// A standalone gate whose artifact records only paths and a runtime cannot say
// which application and which generator produced it, so the artifact proves
// nothing about the delivery it is filed against. Both halves are recorded
// here through the shared contract in test/parity/manifest.js: the APPLICATION
// by the HEAD of the tree under test, and the GENERATOR by the git blob of
// this file's exact bytes plus the commit that has been verified to hold that
// blob at this path - or an explicit non-git state when there is no such
// commit, which is an honest answer rather than a commit id that cannot
// reproduce the artifact.
//
// Both are bound to the bytes: `provenance.attach` records a digest of this
// result WITHOUT its provenance, so a block copied in from another run fails
// recomputation, and the `<out>.provenance.json` sidecar adds a digest of the
// artifact exactly as written.
//
// Nothing run-local reaches the block. `provenance.build` throws on an absolute
// path, a wall-clock instant, or a field named for run state - which is why the
// scratch directory, the process id and the database address appear nowhere in
// it, and why the address is reduced to the descriptor below.
//
// THE SAME RULE REACHES THE ARTIFACT AROUND THE BLOCK, because a guard on one
// key is no use when the file it sits in names the machine anyway. Two values
// here are harness-authored rather than measured, and either could carry host
// state: the store's address, reduced to the configuration digest below, and a
// captured warning's ORIGIN FRAMES, which are stack lines quoting the absolute
// file that raised the warning and which are quoted again into the finding
// built from them. Both go through `portableReason`, which keeps every word and
// replaces each host path with the label `provenance.pathLabel` gives it - so a
// frame of the form `at fn (<abs>/node_modules/<pkg>/<file>:<line>:<col>)` is
// recorded as `at fn (tool:node_modules/<pkg>/<file>:<line>:<col>)`, or with
// `analysed:` in place of `tool:` when `--app` names another tree: the same
// attribution, reproducible in any clone.
//
// What is left verbatim is what the CASES measured - a digest, a bucket name,
// an S3 key, an assertion's own failure text about expected bytes - because
// those are the contract this gate exists to check.

/**
 * A harness-authored message, made reproducible without losing its words.
 *
 * The contract's guard rejects a value CONTAINING an absolute path or an ISO
 * instant, not merely one that is nothing else, and a message is where such a
 * value hides: a captured warning's origin frame has the form
 * `at fn (<file>:<line>:<col>)` with `<file>` absolute, and a filesystem error
 * is `ENOENT ... open '<abs>'`.
 * `provenance.portableText` replaces each path with the label `pathLabel`
 * would give it and each instant with a marker, keeping the sentence that says
 * what happened, and it is used rather than a local matcher so that this file,
 * capture.js, replay.js and worker.js sanitize by one implementation.
 *
 * `appRoot` is optional because the two callers below are inside `run`, where
 * it is known; without it a path in the tree under test still labels, as
 * `ephemeral:` plus its basename, rather than reaching the artifact whole.
 *
 * @param {*} value
 * @param {(string|undefined)} appRoot The tree under test.
 * @returns {(string|null)}
 */
function portableReason(value, appRoot) {
  return provenance.portableText(value, {
    toolRoot     : TOOL_ROOT,
    analysedRoot : appRoot
  });
}

/**
 * Splits a connection string into its components, so a digest can be taken
 * over the parsed form rather than over the string.
 *
 * The parse is deliberate rather than incidental. `provenance.digestSafe`
 * decides what may be hashed by KEY NAME on scalar leaves, so a string handed
 * to it whole is opaque to that decision and every run-local part of it - the
 * port, the database name - survives into the digest. Parsing first is what
 * puts each part under a name the contract can judge: `host`, `port` and
 * `database` are address-labelled and are dropped, while the connection
 * OPTIONS keep their own names and stay in the digest, which is where the
 * settings that describe the store actually live.
 *
 * Credentials are not carried into the returned object at all. The contract
 * would redact them - `credentials` matches its secret hints - but a value that
 * is never placed in the object cannot be leaked by a later change to those
 * hints, so the userinfo is reduced here to the one fact that is part of the
 * configuration: whether the store required any.
 *
 * A value that is not in `scheme://[userinfo@]authority[/database][?options]`
 * form yields `{scheme: null}` with `authentication: 'unknown'` and no text
 * from the value itself, because an unparseable connection string is exactly
 * the case where its unparsed remainder is most likely to be host state.
 *
 * @param {string} value A connection string.
 * @returns {{scheme: (string|null), authentication: string,
 *            host: (string|null), database: (string|null),
 *            options: Object}}
 */
function parseStoreUri(value) {
  var text  = typeof value === 'string' ? value : '';
  var match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/(?:([^@/]*)@)?([^/?]*)(?:\/([^?]*))?(?:\?(.*))?$/
    .exec(text);
  var parsed = {
    scheme        : null,
    authentication: 'unknown',
    host          : null,
    database      : null,
    options       : {}
  };

  if (!match) {
    return parsed;
  }

  parsed.scheme         = match[1].toLowerCase();
  parsed.authentication = match[2] ? 'credentials' : 'none';
  parsed.host           = match[3] || null;
  parsed.database       = match[4] ? decodeURIComponent(match[4]) : null;

  (match[5] === undefined ? '' : match[5]).split('&').forEach(function(pair) {
    var equals;

    if (!pair) {
      return;
    }

    equals = pair.indexOf('=');

    if (equals === -1) {
      parsed.options[decodeURIComponent(pair)] = true;
      return;
    }

    parsed.options[decodeURIComponent(pair.slice(0, equals))] =
      decodeURIComponent(pair.slice(equals + 1));
  });

  return parsed;
}

/**
 * A portable descriptor for the MongoDB the cases ran against.
 *
 * The URI itself is run state three times over: the loopback host, the ephemeral
 * port `mongodb-memory-server` chose, and the per-run database name
 * `test/parity/mongo.js` generates. None of it is reproducible from the
 * repository and none of it is what a reader of the evidence needs.
 *
 * What IS useful is recorded: that the store was MongoDB, whether this harness
 * started it or inherited the one `test/parity/mongo.js` published - which is
 * how a reader tells a run inside the shared lifecycle from a standalone one -
 * and a digest of the store's CONFIGURATION, taken through the shared contract
 * over the parsed components above.
 *
 * WHY NOT A DIGEST OF THE CONNECTION STRING, which is the obvious shortcut. It
 * is wrong twice over. It changes on every run, because the ephemeral port and
 * the generated database name are inside the bytes being hashed, so the field
 * would identify the RUN while claiming to identify the store; this digest
 * deliberately does NOT join two artifacts of one lifecycle, because the only
 * way to join them is to hash the address and an artifact must not carry one.
 * And a connection string with credentials in it - `scheme://user:secret@host` -
 * would become an unsalted sha256 of those credentials inside a file, which is
 * an offline oracle for any value cheap enough to enumerate.
 *
 * `provenance.configurationDigest` is the safe route and records what it did in
 * its own `canonicalization` string: secret-labelled leaves replaced, address-
 * labelled leaves dropped, URI userinfo removed. What survives is the scheme,
 * whether credentials were required and the connection options - which is the
 * configuration this field claims to describe, so it still discriminates a
 * replica-set or TLS store from this harness's plain loopback one while being
 * identical across two runs of the same configuration.
 *
 * @param {string} uri The connection string the cases used.
 * @returns {{kind: string, lifecycle: string,
 *            configurationDigest: {algorithm: string, canonicalization: string,
 *                                  value: string}}}
 */
function describeDataStore(uri) {
  return {
    kind               : 'mongodb',
    lifecycle          : process.env.PARITY_MONGO_URI
      ? 'inherited from test/parity/mongo.js'
      : 'started by this harness',
    configurationDigest: provenance.configurationDigest(parseStoreUri(uri))
  };
}

/**
 * The role this run's evidence may claim, decided by the tree it measured.
 *
 * The role follows the TREE rather than the mode, exactly as the sibling
 * generators decide it: these cases run against whichever worktree `--app`
 * names, so a run against a worktree at the base commit is baseline evidence
 * and a run against the migrated tree is target evidence.
 *
 * THE ONE CASE THAT NEEDS DECIDING is a DIRTY worktree at the base commit.
 * `tree.isBaselineCommit` is not sufficient on its own: the base commit plus
 * uncommitted edits is not the base commit's content, so what such a run
 * measures is not retrievable from this repository while the block it produces
 * reads exactly like a clean baseline capture. The decision is delegated to
 * `provenance.assertBaseline` rather than re-implemented here, so this harness
 * and every sibling refuse the same thing for the same reason.
 *
 * It is a DOWNGRADE, not a crash, and that is deliberate for this file: the
 * storage cases are worth running against any tree, and their result is worth
 * having. What must not happen is the result being FILED as baseline evidence,
 * so the role becomes `unreviewed` - which every gate treats as
 * non-qualifying - and the contract's own explanation, including how to list
 * the uncommitted changes, is printed. A caller that wants the refusal to be
 * fatal reads `role` off the returned block.
 *
 * @param {Object} tree From `provenance.treeIdentity`.
 * @returns {string} 'target', 'baseline' or 'unreviewed'.
 */
function resolveProvenanceRole(tree) {
  if (!tree.isBaselineCommit) {
    return 'target';
  }

  try {
    return provenance.assertBaseline(tree, {
      what : 'the storage-contract evidence from this run'
    });
  }
  catch (err) {
    // Reachable only for a dirty worktree at the base commit: a tree that is
    // not at that commit returned above, so the contract's other refusal
    // cannot be reached from here.
    note('WARNING: ' + ((err && err.message) || err));
    note('the cases still run and their result is still written; the ' +
      'provenance role is recorded as `unreviewed`, which does not qualify ' +
      'as baseline evidence.');

    return provenance.assertBaseline(tree, {
      allowNonBaseline : true,
      what             : 'the storage-contract evidence from this run'
    });
  }
}

/**
 * Builds this tool's provenance block.
 *
 * The role is `resolveProvenanceRole`'s above; everything else here is the
 * shared contract's. There is no baseline MODE, because this harness exists to
 * validate the migrated tree and neither mode claims otherwise - it measures
 * whatever tree it was pointed at and says which one that was.
 *
 * @param {Object} spec
 * @param {string} spec.appRoot Absolute path of the tree under test. Used to
 *   read the tree's identity; never recorded.
 * @param {(string|null|undefined)} spec.out The `--out` path, when there is
 *   one. Only its basename is recorded.
 * @param {(string|null|undefined)} spec.nodeEnv The NODE_ENV the cases ran
 *   under.
 * @returns {Object} The block, portability already asserted.
 * @throws {ToolError} From the contract, when a value is not reproducible.
 */
function buildProvenanceRecord(spec) {
  var appRoot = spec.appRoot;
  var tree    = provenance.treeIdentity(appRoot);

  return provenance.build({
    artifact     : spec.out || DEFAULT_ARTIFACT,
    role         : resolveProvenanceRole(tree),
    generatorFile: __filename,
    toolRoot     : TOOL_ROOT,
    analysedRoot : appRoot,
    detail       : {
      contract                  : 'AAP 0.6.7 - the persisted-data and ' +
        'file-format contract of lib/util/file.js and lib/workers/exports.js',
      configuration             : { NODE_ENV : spec.nodeEnv || null },
      // Whether the tree under test IS this tool's own worktree, recorded as
      // the boolean it is because the alternative - the two paths - is exactly
      // the machine state this block may not carry. False means a foreign
      // `--app`, and the two HEADs above then differ by construction.
      analysedTreeIsToolWorktree: appRoot === TOOL_ROOT
    }
  });
}



/**
 * Runs the harness.
 *
 * THE DATABASE. When `PARITY_MONGO_URI` is present - which is what
 * `test/parity/mongo.js` exports to a command it spawns - that instance is
 * used. Starting a second one would be worse than wasteful: the seeded
 * fixtures would land in a database no other harness in the lifecycle can see.
 * Otherwise the whole run is wrapped in `mongo.withMongo`, whose `finally`
 * stops the server however this returns.
 *
 * THE SCRATCH DIRECTORY is removed in a `finally` that encloses everything,
 * including the database lifecycle, so the S3 store inside it cannot outlive a
 * failure.
 *
 * THE PROCESS IS PUT BACK. `run` is exported, so it can be called more than
 * once and by something that goes on to do other work. Everything it mutates to
 * make the application loadable is process-wide - six environment variables,
 * the working directory, the `File` global - and every one of them is
 * snapshotted before the first mutation and restored in the outermost
 * `finally`. Without that, a second call inherits the first call's frozen
 * `config` values and its database address, and Node's own `File` constructor
 * stays shadowed by a Mongoose model for the rest of the process.
 *
 * @param {Object} [options]
 * @param {string} [options.appRoot]
 * @param {string} [options.out] Recorded, by basename only, as the artifact
 *   the provenance block describes. The writing itself is `emit`'s.
 * @returns {Promise<Object>} The result, carrying its provenance block.
 */
async function run(options) {
  var opts    = options || {};
  var appRoot = opts.appRoot ? path.resolve(opts.appRoot) : TOOL_ROOT;
  var state;
  var scratch;
  var env;
  var captured;
  var result;
  var stale;
  var late;
  // Declared with the rest, because this file is not in strict mode: assigning
  // it without a declaration - which is what the closed ledger used to do -
  // created a `closed` property on the global object that outlived the run and
  // was visible to every other module in the process.
  var closed;

  assertAppRoot(appRoot);

  // Taken before anything is mutated, so it describes the caller's process.
  state = captureProcessState();

  // A new run reopens the escalation path: a delivery from here on belongs to
  // this run, and the previous run's result must stop absorbing them.
  runFinalized    = false;
  finalizedResult = null;
  lateDeliveries  = [];

  // Anything left on the ledger by a previous call is NOT discarded. It belongs
  // to that call rather than to this one, so it is reported as its own failed
  // case below instead of being attributed to this run's first case - and
  // instead of disappearing, which is what a silent drain did.
  stale = drainDuplicateDeliveries();

  scratch = createScratch();

  // Opened before anything can fail and closed in the outermost `finally`, so
  // every teardown failure and every second callback delivery the run observes
  // has somewhere to go - including the ones raised by the scratch removal
  // below, which is why the verdict is assembled after it.
  beginLedger();

  try {
    try {
      env = prepareEnvironment(appRoot, scratch.path);

      note('tree under test ' + appRoot + ' (NODE_ENV=' + env.nodeEnv + ')');
      note('scratch ' + scratch.path);

      captured = await captureWarnings(async function() {
        if (process.env.PARITY_MONGO_URI) {
          note('using the MongoDB already published at ' +
            process.env.PARITY_MONGO_URI);

          return await execute(
            appRoot, scratch.path, env, process.env.PARITY_MONGO_URI,
            MONGO_SOURCE_EXTERNAL
          );
        }

        try {
          return await mongo.withMongo(async function(info) {
            // mongo.js composed this from the environment published above plus
            // the overlay plus the address, and the address must win - so the
            // composed value replaces what prepareEnvironment set, before
            // `config` is first required inside execute().
            process.env.NODE_CONFIG = info.nodeConfig;

            // MONGO_SOURCE_LIFECYCLE is passed only from here, the one place
            // that knows this process started the server it is about to write
            // to.
            return await execute(
              appRoot, scratch.path, env, info.uri, MONGO_SOURCE_LIFECYCLE
            );
          }, { overlay : mongo.readOverlay(mongo.DEFAULT_OVERLAY) });
        }
        finally {
          // THE DATABASE'S OWN TEARDOWN, which `withMongo` cannot report
          // through its return value: its `finally` stops the server and
          // discards the boolean, deliberately, so that the run's result - a
          // rejection or a value - reaches this caller untouched. So the answer
          // is read from the accessor instead, in a `finally` of our own so a
          // failing run accounts for its database as well, and each entry goes
          // into the SAME failure set the four local teardown sites use. A
          // leaked mongod or a surviving data directory is a teardown failure
          // like any other, and this gate may not exit 0 with one behind it.
          mongo.cleanupFailures().forEach(function(entry) {
            recordTeardownFailure(
              'the database lifecycle could not ' + entry.operation,
              entry.message
            );
          });
        }
      }, appRoot);

      result = captured.value;

      // Close the adapters before finalizing: wait a bounded window for a
      // delivery still in flight, rather than reading the ledger at the instant
      // the last case returned, which would read it before an already-queued
      // callback had fired.
      late = await quiesceDuplicateDeliveries();

      // A callback that fired again after the last case finished. It belongs to
      // no case, so it becomes one: without this the run would report every case
      // passed while a duplicate delivery sat unmentioned in the log.
      if (late.length) {
        result.cases.push({
          name       : 'duplicate-callback-delivery',
          pins       : 'test/parity/storage.js (the `callback` adapter)',
          status     : 'failed',
          durationMs : 0,
          error      : late.length + ' callback delivery/deliveries arrived ' +
                       'after the last case finished, so no case could be held ' +
                       'responsible for them. A lifecycle callback that fires ' +
                       'more than once delivers a response more than once.',
          duplicateDeliveries : late
        });

        result.total  = result.cases.length;
        result.failed = result.failed + 1;
      }

      // Left over from a previous programmatic call. Reported rather than
      // dropped, and named as such so it is not read as this run's defect.
      if (stale && stale.length) {
        result.cases.push({
          name       : 'duplicate-callback-delivery-before-run',
          pins       : 'test/parity/storage.js (the `callback` adapter)',
          status     : 'failed',
          durationMs : 0,
          error      : stale.length + ' callback delivery/deliveries were ' +
                       'already on the ledger when this run started, so they ' +
                       'belong to an earlier call in this process. They are ' +
                       'reported here because a callback firing more than once ' +
                       'is a defect whoever provoked it, and discarding them ' +
                       'would be the only way it went unrecorded.',
          duplicateDeliveries : stale
        });

        result.total  = result.cases.length;
        result.failed = result.failed + 1;
      }

      // From here a delivery cannot be folded into the result in time, so the
      // escalation path in `recordDuplicateDelivery` takes over.
      finalizedResult = result;
      runFinalized    = true;

      // ATTRIBUTION FIRST, from the RAW frames: `attributeWarning` decides
      // 'dependency' or 'harness' by looking for `node_modules` and for this
      // repository's own paths in them, so it has to see the paths as Node wrote
      // them. Only the recorded copy is made portable, and only after that
      // decision - the frames still name the module that raised the warning,
      // which is what they are kept for, but as a label rather than as a path
      // on the machine this ran on.
      result.warnings = captured.warnings.map(function(warning) {
        return {
          name        : warning.name,
          code        : warning.code,
          message     : portableReason(warning.message, appRoot),
          origin      : (warning.origin || []).map(function(frame) {
            return portableReason(frame, appRoot);
          }),
          attribution : attributeWarning(warning)
        };
      });

      // The gate's own record, in the shape every parity gate now writes it: the
      // policy, the flags the run was measured under - without which a quiet
      // stream is not evidence - and every notice, with none subtracted. `main`
      // reads `ok` for the exit code, so a warning is no longer a line nobody
      // acted on.
      result.warningGate = {
        policy      : captured.gate.policy.id,
        flags       : captured.gate.flags,
        gateApplies : captured.gate.gateApplies,
        ok          : captured.gate.ok,
        qualifying  : captured.gate.qualifying,
        notices     : captured.gate.notices,
        failures    : captured.gate.failures
      };
      // A warning raised by this harness's own source is a defect in this file
      // - the brief is explicit that one would be a real finding, having
      // measured that `lib/util/file.js`'s callback `fs.unlink` and `fs.exists`
      // emit nothing on Node 22. A warning from a dependency is a finding about
      // that dependency, and belongs in the inventory rather than in a stack
      // trace nobody re-reads.
      //
      // `fromWarning` marks these so the verdict counts a warning ONCE: it is
      // already a `warning` failure, and counting the finding it produces as a
      // second, separate failure would inflate the report without adding an
      // observation.
      result.warnings.forEach(function(warning) {
        result.findings.push({
          subject : (warning.code || warning.name || 'warning') + ' from the ' +
                    warning.attribution,
          // Already portable: both halves are read from the recorded copy
          // above rather than from the raw warning, so the finding cannot
          // reintroduce the path the frames were labelled to remove.
          detail  : warning.message + ' (' + (warning.origin[0] || 'origin unknown') + ')',
          owner   : warning.attribution === 'dependency'
            ? 'docs/dependency-inventory.md'
            : 'test/parity/storage.js',
          fromWarning : true
        });
      });
    }
    finally {
      // Before the verdict, deliberately: a scratch root that would not go is
      // a leftover the run created, and the ledger entry it raises has to be
      // inside the failure set `buildGate` reads a few lines below.
      removeScratch(scratch);
    }

    // Anything the application already queued gets its turn BEFORE the verdict
    // exists, so a delivery or a warning that was pending at the end of the
    // last case is inside the failure set rather than behind it. What arrives
    // later still cannot be lost: the escalation in `recordDoubleSettlement`
    // and `guardLateWarnings` forces the exit code without needing a verdict
    // to amend.
    await quiesce();
    guardLateWarnings();

    closed = endLedger();

    // THE FAILURE SET, AND THE ONLY PLACE IT IS ASSEMBLED. `main` reads
    // `gate.passed` and nothing else. The case tally beside it - `total`,
    // `passed`, `failed` - keeps its own meaning untouched.
    result.settlements = closed.settlements;
    result.gate        = buildGate(result, closed);

    // After the verdict, so it covers it as well as the cases: a result whose
    // digest matches but whose `gate` differs would be a contradiction, and
    // this is what makes that checkable. `digest` is itself on
    // `DIGEST_EXCLUDED_FIELDS`, so the value never has to be computed over a
    // copy of itself - and `provenance` is on that list too, which is what
    // makes this number reproducible from the committed bytes even though the
    // block below is written afterwards.
    result.digest = digestResult(result);

    // LAST, and that ordering is the whole point: `attach` hashes the result
    // WITHOUT its provenance and WITH the digest above, so every field a
    // consumer will read - the cases, the findings, the warnings and the
    // verdict - has to be final before it runs. Attach earlier and the block
    // would certify a payload the artifact no longer contains. The two digests
    // meet rather than overlap: `digest` certifies the result without the
    // block, `payloadDigest` certifies the result WITH the digest, and each is
    // recomputable from the delivered file on its own.
    provenance.attach(result, buildProvenanceRecord({
      appRoot: appRoot,
      out    : opts.out,
      nodeEnv: env.nodeEnv
    }));

    note('provenance: ' + result.provenance.role + ' evidence about tree ' +
      (result.provenance.analysedTree.head || 'not a checkout') +
      ', generator ' + result.provenance.generator.path + ' blob ' +
      String(result.provenance.generator.blob).slice(0, 12) +
      (result.provenance.generator.verified
        ? ', verified in commit ' +
          String(result.provenance.generator.commit).slice(0, 7)
        : ', ' + result.provenance.generator.commitState));

    return result;
  }
  finally {
    removeScratch(scratch);
    restoreProcessState(state);
    // Idempotent: `endLedger` above already closed it on the success path, and
    // this is what closes it when the run threw.
    endLedger();
  }
}


// ---------------------------------------------------------------------------
// Direct execution
// ---------------------------------------------------------------------------

// Counter behind the temporary filename in writeArtifactAtomically, so two
// artifacts written in the same millisecond by the same process cannot
// collide.
var artifactSequence = 0;

/**
 * Writes the result where it belongs.
 *
 * With `--out` the artifact goes to that file and stdout stays empty; without
 * it the artifact IS stdout. Either way nothing human-readable reaches stdout,
 * because the artifact stream must be one application side effects cannot
 * contaminate - and loading the controllers to reach this point prints an AWS
 * SDK maintenance notice and a queue line that would otherwise be mixed into
 * it.
 *
 * THE PROVENANCE goes out twice, and neither copy is redundant. It is EMBEDDED
 * in the result, so a delivered artifact says which application tree and which
 * generator produced it without depending on a companion file that may not
 * exist. It is ALSO written to `<out>.provenance.json` from the same record,
 * with a digest of the artifact's exact bytes added, for a run that wants the
 * record outside the bytes it intends to compare. The sidecar is a run output,
 * not a delivery artifact.
 *
 * @param {Object} result
 * @param {(string|null)} out
 * @returns {undefined}
 */
function emit(result, out) {
  var rendered = JSON.stringify(result, null, 2) + '\n';
  var sidecarPath;
  var sidecar;

  if (out) {
    writeArtifactAtomically(out, rendered);
    note('result written to ' + out);

    if (result && result.provenance) {
      sidecarPath = out + '.provenance.json';
      fs.writeFileSync(sidecarPath, JSON.stringify(
        provenance.sidecar(result.provenance, rendered), null, 2) + '\n');
      note('provenance written to ' + sidecarPath);
    }

    return undefined;
  }

  process.stdout.write(rendered);

  return undefined;
}

/**
 * Writes the result artifact atomically, creating its directory if needed.
 *
 * The bytes go to a unique temporary file in the artifact's own directory,
 * which is flushed, closed and then renamed over the target. A same-directory
 * rename is atomic, so a reader sees either the previous artifact or the
 * complete new one. Writing in place would let an interruption or a full
 * filesystem truncate the last known-good evidence, and a truncated gate
 * artifact reads as a gate that never ran.
 *
 * The temporary file is removed on failure, so a failed run leaves the previous
 * artifact exactly as it found it.
 *
 * @param {string} out Destination path.
 * @param {string} rendered The artifact text.
 * @returns {undefined}
 * @throws {ToolError} If the artifact cannot be written.
 */
function writeArtifactAtomically(out, rendered) {
  var target = path.resolve(out);
  var temporary;
  var descriptor = null;

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  catch (err) {
    throw new ToolError('cannot create the directory for ' + out + ': ' +
      ((err && err.message) || err));
  }

  artifactSequence += 1;
  temporary = target + '.parity-tmp-' + process.pid + '-' + artifactSequence;

  try {
    // 'wx' rather than 'w': a temporary name that already exists is a
    // collision worth failing on, not a file to overwrite.
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, rendered);
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
      // artifact itself is untouched, which is the guarantee that matters.
    }

    throw new ToolError('cannot write ' + out + ': ' +
      ((err && err.message) || err));
  }
}

/**
 * The CLI entry point.
 *
 * @param {string[]} [argv] Defaults to process.argv.slice(2).
 * @returns {Promise<number>} The exit code.
 */
async function main(argv) {
  var options;
  var result;

  try {
    options = parseArguments(argv || process.argv.slice(2));
  }
  catch (err) {
    note((err && err.message) || String(err));
    process.stderr.write(USAGE + '\n');
    return EXIT_USAGE;
  }

  if (options.help) {
    process.stderr.write(USAGE + '\n');
    return EXIT_OK;
  }

  try {
    result = await run(options);
  }
  catch (err) {
    note('ERROR: ' + ((err && err.message) || String(err)));

    if (err && err.stack && !(err instanceof ToolError)) {
      process.stderr.write(err.stack + '\n');
    }

    if (err && err.showUsage) {
      process.stderr.write(USAGE + '\n');
      return EXIT_USAGE;
    }

    return EXIT_ERROR;
  }

  // THE ARTIFACT FIRST, ALWAYS. It is the diagnostic evidence for whatever the
  // verdict is about to say, and a gate that wrote nothing when it failed would
  // leave the reader to re-run it blind.
  try {
    emit(result, options.out);
  }
  catch (err) {
    // A requested output that could not be produced is a gate failure in its
    // own right: the run happened but its evidence does not exist, so nothing
    // downstream can act on it.
    note('ERROR: the result could not be written: ' +
      ((err && err.message) || String(err)));

    addGateFailure(
      result.gate,
      FAILURE_KIND.OUTPUT,
      'the result artifact could not be written',
      ((err && err.message) || String(err)) +
        (options.out ? ' (--out ' + options.out + ')' : ' (stdout)'),
      'the caller: ' + (options.out || 'stdout')
    );
  }

  note(result.passed + ' of ' + result.total + ' cases passed');

  // Reported separately from the failure count, because "not run" is not "not
  // broken": the run stopped and those contracts were never measured.
  if (result.notRun) {
    note(result.notRun + ' case(s) were NOT RUN because the run stopped early; ' +
      'their contracts are unmeasured, not passing');
  }

  if (result.findings.length) {
    result.findings.forEach(function(finding) {
      note('FINDING (' + finding.owner + '): ' + finding.subject);
    });
  }

  // The zero-warning gate, named before the case tally. These lines are
  // DIAGNOSTICS and not the authority: the verdict itself was folded into the
  // failure set by `buildGate`, so each reason below also appears as a
  // `GATE FAILURE [warning-gate]` line with its owner. They are printed
  // separately anyway - as test/parity/joi-matrix.js does - so nobody reads a
  // warning failure as a storage-contract failure: they are different findings
  // with different owners, and the message says which.
  if (result.warningGate && !result.warningGate.ok) {
    result.warningGate.failures.forEach(function(failure) {
      note('WARNING GATE: ' + failure);
    });
  }

  // A measurement of another worktree prints what it saw and does not fail on
  // it. Printed rather than only recorded, because the baseline's notices are
  // the comparison's other half and a measurement nobody reads is not one.
  if (result.warningGate && result.warningGate.gateApplies === false) {
    note('WARNING GATE: measurement only - ' + result.warningGate.notices.length +
      ' notice(s) from the tree under test, which is not this worktree, so ' +
      'they are recorded rather than failed');
    result.warningGate.notices.forEach(function(notice) {
      note('  measured: ' + notice.summary);
    });
  }

  if (result.failed) {
    note(result.failed + ' case(s) failed');
  }

  // ---------------------------------------------------------------------
  // THE EXIT PREDICATE. One place, one input: the failure set `buildGate`
  // assembled. `result.failed` is the case tally and deliberately not consulted
  // here - a run with no failed case can still have captured a warning, failed
  // the shared zero-warning policy, recorded a finding, observed a callback
  // delivering twice or failed to tear its own fixtures down, and every one of
  // those is a reason this tool may not report success.
  //
  // `result.warningGate` is NOT consulted here either, and that is the point
  // rather than an omission: its verdict is inside the failure set, folded in
  // by `buildGate` before the artifact was written a few lines above. Reading
  // it again here is how the previous version came to write `"passed": true`
  // into the artifact and then exit 1 - two answers to one question, of which
  // only the one nobody parses was correct.
  // ---------------------------------------------------------------------
  if (!result.gate.passed) {
    result.gate.failures.forEach(function(failure) {
      note('GATE FAILURE [' + failure.kind + '] (' + failure.owner + ') ' +
        failure.subject + ': ' + failure.detail);
    });

    note('gate FAILED: ' + result.gate.counts.total + ' failure(s) - ' +
      Object.keys(FAILURE_KIND).map(function(name) {
        return FAILURE_KIND[name] + '=' +
          result.gate.counts[FAILURE_KIND[name]];
      }).join(' '));

    return EXIT_ERROR;
  }

  // A delivery that arrived between finalization and here. `run` could not have
  // folded it into the result, but the exit code is still ours to get right.
  if (lateDeliveries.length) {
    note(lateDeliveries.length + ' callback delivery/deliveries arrived after ' +
      'the result was assembled');
    return EXIT_ERROR;
  }

  note('gate PASSED: no failed case, no captured warning, the shared ' +
    'zero-warning policy satisfied, no recorded finding, no double delivery ' +
    'and no failed teardown');

  return EXIT_OK;
}


// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
// `assertArchiveLayout` is the one entry point a sibling harness needs:
// test/parity/worker.js calls it on the archive the worker produces. Requiring
// this module starts NOTHING - no server, no database, no fixture patch - so
// that reuse costs a caller nothing but the assertion it asked for.

module.exports = {
  // The shared archive assertion, and the pieces it is built from.
  assertArchiveLayout : assertArchiveLayout,
  readArchiveEntries  : readArchiveEntries,
  // The unbypassed read, exported for the same reason: an archive the
  // application's own library cannot open is a broken persisted format, and
  // test/parity/worker.js asserts the same contract on the archive the worker
  // itself produces.
  probeApplicationRead : probeApplicationRead,
  buildArchive        : buildArchive,
  sanitizeFolderName  : sanitizeFolderName,
  parseCodeFiles      : parseCodeFiles,
  archiveBasePath     : archiveBasePath,
  archiveAssetName    : archiveAssetName,
  LANG_EXTENSIONS     : LANG_EXTENSIONS,

  // The committed fixtures, so a sibling asserts against the same bytes rather
  // than a second copy of them.
  PAYLOADS             : PAYLOADS,
  DIGESTS              : DIGESTS,
  EXPECTED_DIGESTS     : EXPECTED_DIGESTS,
  ALTERED_ASSET_GIF    : ALTERED_ASSET_GIF,
  ALTERED_ASSET_DIGEST : ALTERED_ASSET_DIGEST,
  ARCHIVE_TRINKETS     : ARCHIVE_TRINKETS,
  sha1Hex              : sha1Hex,
  crc32                : crc32,

  // The harness. `emit` is exported with it because the artifact-and-sidecar
  // pair it writes is a contract of its own - the two files have to be
  // hash-linked - and that is checkable without a database or a full run.
  cases : cases,
  run   : run,
  main  : main,
  emit  : emit,

  // Evidence identity, exported so the block can be built and inspected
  // WITHOUT a database: the guarantees it carries - no absolute path, no
  // address, a generator blob that resolves in this repository, a tree HEAD
  // that matches the worktree - are all checkable on their own, and a full run
  // is not the place to discover that one of them regressed.
  buildProvenanceRecord : buildProvenanceRecord,
  resolveProvenanceRole : resolveProvenanceRole,
  describeDataStore     : describeDataStore,
  parseStoreUri         : parseStoreUri,
  portableReason        : portableReason,
  provenance            : provenance,
  DEFAULT_ARTIFACT      : DEFAULT_ARTIFACT,

  // The verdict, exported because the exit predicate is the part of this file
  // most worth driving directly: a failure set that classified a warning as
  // anything other than a failure would be invisible in a passing run.
  buildGate      : buildGate,
  tallyFailures  : tallyFailures,
  addGateFailure : addGateFailure,
  FAILURE_KIND   : FAILURE_KIND,

  // Building blocks, exported because each has a failure mode worth testing
  // directly rather than only through a full run. The four guards below are
  // here for a sharper reason: each one exists to REFUSE something - a
  // non-disposable database, a directory this process did not create, an
  // unrestored global - and a guard whose refusal path is only reachable by
  // arranging the disaster it prevents is a guard nobody ever checks.
  parseArguments            : parseArguments,
  assertAppRoot             : assertAppRoot,
  // The callback adapter, exported for one reason: its duplicate-delivery path
  // is unreachable from any case that behaves correctly, so the only way to
  // check that a callback firing twice really fails the run is to drive the
  // adapter with one that does.
  callback                  : callback,
  assertDisposableMongoUri  : assertDisposableMongoUri,
  mongoDatabaseFromUri      : mongoDatabaseFromUri,
  releaseAwsFixtureModule   : releaseAwsFixtureModule,
  quiesceDuplicateDeliveries: quiesceDuplicateDeliveries,
  pendingDuplicateDeliveries: function() { return duplicateDeliveries.slice(); },
  lateDuplicateDeliveries   : function() { return lateDeliveries.slice(); },
  createScratch             : createScratch,
  removeScratch             : removeScratch,
  captureProcessState       : captureProcessState,
  restoreProcessState       : restoreProcessState,
  ToolError                 : ToolError,
  USAGE                     : USAGE,
  SCRATCH_PREFIX            : SCRATCH_PREFIX,
  MANAGED_ENV_KEYS          : MANAGED_ENV_KEYS,
  EXTERNAL_MONGO_OPT_IN     : EXTERNAL_MONGO_OPT_IN,
  MONGO_SOURCE_LIFECYCLE    : MONGO_SOURCE_LIFECYCLE,
  MONGO_SOURCE_EXTERNAL     : MONGO_SOURCE_EXTERNAL,
  DUPLICATE_QUIESCE_MS      : DUPLICATE_QUIESCE_MS,
  EXIT_OK                   : EXIT_OK,
  EXIT_ERROR                : EXIT_ERROR,
  EXIT_USAGE                : EXIT_USAGE,
  captureWarnings : captureWarnings,
  describeWarning : describeWarning,
  quiesce         : quiesce,
};

if (require.main === module) {
  // Read at the last possible moment, which is the only moment that covers an
  // arbitrarily late duplicate delivery: `main` has returned, the artifact is
  // written, and the process is about to leave. Nothing here can be waited for
  // in advance - a callback firing after the run cannot be predicted - but the
  // process can be prevented from exiting 0, so it cannot report success while
  // stderr says the run would fail.
  process.on('exit', function() {
    if (lateDeliveries.length && process.exitCode === EXIT_OK) {
      process.exitCode = EXIT_ERROR;
    }
  });

  main()
    .then(function(code) {
      // Never lowers a failing code the escalation path already set.
      // NEVER LOWERED. A late callback delivery or a late warning may already
      // have raised the code from its own listener, and this assignment runs
      // afterwards - so writing `code` unconditionally would discard exactly
      // the observation the escalation exists to preserve.
      if (code !== EXIT_OK || !process.exitCode) {
        process.exitCode = code;
      }
    })
    .catch(function(err) {
      note('ERROR: ' + ((err && err.message) || String(err)));

      if (err && err.stack) {
        process.stderr.write(err.stack + '\n');
      }

      process.exitCode = EXIT_ERROR;
    });
}
