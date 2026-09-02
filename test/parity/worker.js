#!/usr/bin/env node
'use strict';

// Bounded functional validation of the export worker.
//
// AAP 0.9.3 states the requirement this file answers: "The export worker is
// functionally validated, not merely required. A bare require opens Mongo and
// Redis handles and registers a long-lived processor, so it is neither finite
// nor meaningful." So this harness starts the worker against an isolated
// MongoDB, the in-memory queue, the filesystem-backed S3 fixture and the
// captured-mail fixture, drives real jobs through the processor the worker
// registered, asserts the persisted documents, the produced archive, the
// uploaded object and the captured mail, and closes - inside an overall
// timeout, with every human-readable byte on stderr because stdout carries the
// artifact.
//
// ===========================================================================
// USER-SPECIFIED RULES
// ===========================================================================
// `review_rules` returns exactly "No user rules provided." for this project,
// which AAP 0.7 and 0.10.1 independently record. None are invented here and
// their absence is not read as licence to lower the bar: enterprise practice
// governs, and two commitments shape every assertion below.
//
//   * Every parity claim is backed by an inspectable artifact. The worker's
//     persisted documents, the archive it produced, the object it uploaded and
//     the mail it sent are all read back and asserted - never inferred from
//     the absence of an error.
//   * Nothing is normalized away that could be compared exactly. The S3 key,
//     the download URL, the filename, the content type, the content
//     disposition and the archive's entry list are exact strings. The
//     enumerated volatile set is in VOLATILE below and nothing else joins it.
//
// The request's own RULES block is binding and is not that document:
//
//   R-b  No module excluded. This worker is why that clause reaches beyond the
//        request path: at base commit 2f8712a it cannot be REQUIRED at all,
//        because its first two requires load config/db before
//        config/app.config and mongoose-schema-extend's transitive Proxy
//        polyfill replaces the global Object.getPrototypeOf before
//        @hapi/hapi loads. The require-time check below is therefore an
//        assertion, not a formality.
//   R-c  Every package move needs a stated reason, and `bull` 0.7.2 -> 4.16.5
//        passed an API-surface check and then failed a closer read. That is
//        exactly why method presence is not evidence and why this file drives
//        the handler BODIES rather than checking that handlers exist.
//   R-e  Error-to-response mappings survive unchanged. The worker's failure
//        path is asserted per edge: which document field is written, which
//        mail is sent, whether the promise rejects, and with which error.
//
// ===========================================================================
// TWO MEASURED OBSTACLES, AND WHAT WAS DONE ABOUT THEM
// ===========================================================================
// OBSTACLE 1 - the worker has no API. `lib/workers/exports.js` is a pure
// side-effect module: it exports nothing, and requiring it calls
// `require('../util/queues').exports()` at :16 and then registers
// `on('error')` (:72), `on('failed')` (:76), `on('completed')` (:93) and
// `process(fn)` (:97). There is nothing to call, so the only way to reach a
// handler body is to put a job on the very queue instance the worker
// registered against.
//
// That instance is reachable because `lib/util/queues.js` caches per name in a
// module-local `cache` (:98) and this harness and the worker resolve the same
// module instance. But reaching it is not sufficient, which is obstacle 1's
// real content: with `db.redis.enabled: false` the in-memory branch (:137-141)
// is selected, and `InMemoryQueue.prototype.on` is a NO-OP that returns `this`
// and emits nothing (:78-81) - measured: `queue.on('x', fn) === queue`. This
// migration leaves that branch byte-identical. So all three of the worker's
// event handlers are unreachable through the plain in-memory queue, and with
// them `job.id` in the failed handler, `job.remove()` on completion and the
// failed handler's own persistence at :86-89. A harness that merely enqueued a
// failing job and expected the `failed` handler to run would assert nothing at
// all, silently.
//
// THE MECHANISM USED, in this order and for this reason:
//   1. require `<appRoot>/lib/util/queues` and call `.exports()`, which creates
//      and caches the InMemoryQueue;
//   2. replace THAT INSTANCE's `on` with an EventEmitter-backed implementation
//      and wrap its `_processJob` so that it emits `completed` and `failed`
//      with a Bull-4-shaped job object - `id` present, `jobId` ABSENT,
//      `remove()` present and observable, `data` carried through;
//   3. only THEN require the worker, so its handlers register on the patched
//      instance.
// No application source is touched. The patch is applied to an object at run
// time, and `installQueuePatch` is the only place that happens.
//
// THE LIMIT OF THAT MECHANISM, stated rather than glossed. This reaches the
// handler BODIES: it proves `job.id` is read (a body still reading `job.jobId`
// logs `undefined`, which assertFailedHandlerReadJobId catches), that
// `job.remove()` is called on completion, and that `status: 'failed'` and
// `errorMessage` are persisted. It does NOT prove Bull's own emission, retry
// or stalled-job semantics - no Bull queue exists in this process. AAP 0.9.6
// already carries Bull 4 behaviour as an open item and overstating this
// harness would be worse than the gap, so the emitted report says
// `emission: 'harness-emitted'` and the note is owed to docs/baseline-parity.md.
//
// OBSTACLE 2 - nunjucks. `lib/workers/exports.js:128-130` runs
// `nunjucks.configure(config.app.templates)` only when `!config.isTest`, and
// this harness runs under NODE_ENV=test, so the worker itself never configures
// it. The concern is that `nunjucks.render('emails/export-ready')` (:419) would
// then resolve against nunjucks' default loader and throw, driving an otherwise
// successful export into the failure path.
//
// MEASURED, before anything was written, and the premise does not hold in this
// tree:
//   * before any application require: THROWS "template not found:
//     emails/export-ready" - the default loader searches the process's own
//     working directory;
//   * after `require(<appRoot>/lib/workers/exports)`: RENDERS 1020 bytes.
// The reason is a side effect of the worker's own require graph:
// config/app.config -> lib/util/routeParser -> lib/controllers/courses.js
// requires lib/util/nunjucks, whose module scope calls
// `nunjucks.configure(config.app.templates, ...)` and configures the GLOBAL
// environment that `nunjucks.render` uses. The mail path is therefore genuinely
// exercised with no harness intervention at all.
//
// So the harness configures NOTHING and instead ASSERTS the capability as a
// measured precondition (`measureTemplateResolution`), recording both
// observations in the report. This is identical on both worktrees - the
// require chain is the same at 2f8712a - and it is written down here, which is
// what the decision required. Requiring `lib/util/nunjucks` from the harness
// was considered and REJECTED for two measured reasons: it configures with
// `watch: config.isDev || config.isTest`, which under NODE_ENV=test needs
// `chokidar` - no longer a declared dependency, present only transitively -
// and starts 114 filesystem watchers, which would defeat this file's own
// clean-close assertion.
//
// ===========================================================================
// TWO BLOCKING APPLICATION DEFECTS, AND WHY THIS FILE DOES NOT FIX THEM
// ===========================================================================
// The success half of AAP 0.9.3's worker gate is UNREACHABLE with the installed
// dependency set, for two measured reasons that have nothing to do with Bull:
//
//   BLOCKER-Q  `q` 1.0.1's `Q.nsend`/`Q.ninvoke` runs
//              `Q(object).dispatch("post", [name, nodeArgs])` and Q ASSIMILATES
//              the value the method returns when it is a thenable - proven with
//              a micro-test in which a thenable-returning method has its
//              `.then()` called by Q and a plain-object-returning one does not.
//              A mongoose 6 Query IS a thenable, so each of the worker's eight
//              `Q.nsend` calls executes its query a second time and mongoose
//              6.13.11 throws "Query was already executed". Measured for
//              `findByIdAndUpdate`, `findById` and `count`.
//   BLOCKER-S  `Query.prototype.stream` is `undefined` on mongoose 6 - it was
//              removed in mongoose 5 - and `createExportArchive` calls
//              `.find(...).select(...).stream()` at :237, so archive creation
//              cannot start.
//
// Neither is a regression from this migration. The same mongoose 6 line and
// the same `q` 1.0.1 are declared at 2f8712a, `lib/models/user.js:174` already
// carries the comment "Use promise directly instead of Q.nsend for Mongoose 6
// compatibility", and the worker is that incompatibility's last consumer -
// unnoticed precisely because the module could not be required at all.
//
// THAT THESE TWO ARE THE ONLY BLOCKERS IS ITSELF MEASURED. A scratch control
// copy of the worker carrying exactly two textual substitutions - `Q.nsend(`
// replaced by a shim that calls the same method and `.exec()`s the Query, and
// `.stream()` by `.cursor()` - completed a job end to end: the four updates in
// order, `progress.total`/`trinketCount` 6, the exact `s3Key` and
// `downloadUrl`, `fileSize` equal to the stored bytes, ContentType
// `application/zip`, the attachment ContentDisposition, one `export-ready`
// mail, `/tmp` left clean, `job.remove()` called once, and
// `assertArchiveLayout` passing over 15 entries. `--worker-module` exists so
// that control is repeatable; see THE CONTROLS below.
//
// WHY THE FIX IS NOT HERE, with the precedence argument stated. Repairing
// either blocker means converting the worker's `q` idiom and its mongoose
// stream API. AAP 0.4.1's change list for `lib/workers/exports.js` authorizes
// only the require ordering, the Bull 4 adaptations and the URL helper, and
// AAP 0.2.2 explicitly defers "`q` -> native promises" and "Mongoose 6 -> 7+"
// as "real modernization work outside R-a's four categories". Those are
// PROHIBITIONS; AAP 0.9.3's worker gate is a VALIDATION TARGET; and the AAP's
// own rule for that collision (0.5.1.4) is that the prohibition controls. So
// this file does not touch the worker. It probes for both blockers, asserts the
// EXACT blocked outcome when they are present, implements the full success-path
// assertion set behind those probes, and reports a distinct BLOCKED verdict
// with a non-zero exit. The follow-up it names is the one that closes the gate:
// convert the worker's eight `Q.nsend` calls to `Model.<method>(...).exec()`
// and its one `.stream()` to `.cursor()`, as separate work with its own
// approval.
//
// A blocked verdict is a result, not a skip. Every assertion in the blocked
// expectation set is a real assertion: the document reaches `status: 'failed'`,
// the persisted `errorMessage` matches the measured query error, nothing is
// uploaded, no mail is sent, no temporary file is left, and the failed handler
// ran and read a real `job.id`. A worker that regressed in some OTHER way
// would fail those.
//
// ===========================================================================
// THE TWO ALLOWANCES
// ===========================================================================
// Both are measured, both are attributed, both are printed as deviations, and
// each is bounded so that anything beyond it still fails the run. They are
// declared as data - WARNING_ALLOWANCES and HANDLE_ALLOWANCES - because a
// justification kept in prose is a justification nobody can check.
//
//   1. DEP0005 `Buffer()` from `compress-commons/lib/archivers/zip/constants.js`,
//      reached through `archiver` 2.1.1, which AAP 0.5.1.1 RETAINS and 0.2.2
//      leaves out of scope. It is the only warning the whole run emits under
//      `--pending-deprecation --trace-deprecation`.
//   2. `FSEventWrap` handles from the chokidar watchers `lib/util/nunjucks.js`
//      creates under NODE_ENV=test. They cannot be closed by a caller:
//      measured, nunjucks 3.2.4's FileSystemLoader keeps the FSWatcher in a
//      constructor-local variable, and the loader's own keys are
//      `_events`/`_eventsCount`/`_maxListeners`/`pathsToNames`/`noCache`/
//      `searchPaths`/`cache` - there is no `watcher` property to close. The
//      process therefore cannot self-exit, so teardown reports the attributed
//      inventory and then exits deliberately with the run's own code. That is
//      reporting a leak and then leaving, not hiding one.
//
// ===========================================================================
// THE ENVIRONMENT CONTRACT
// ===========================================================================
// Composed here and applied to this process, because this process IS the
// worker whose stderr AAP 0.9.3 inspects. Nothing is forked: the in-memory
// queue lives in the process that registered the processor, so the job has to
// be enqueued from inside it.
//
//   NODE_ENV                       'test', the value every sibling parity tool
//                                  uses.
//   NODE_CONFIG                    from `mongo.start({overlay}).nodeConfig` -
//                                  the inherited value, then the overlay, then
//                                  the database address.
//   NODE_CONFIG_PERSIST_ON_CHANGE  'N'.
//   NODE_CONFIG_RUNTIME_JSON       inside the run directory. Measured
//                                  necessary: `config` 0.4.37 otherwise writes
//                                  `runtime.json` INTO the tree under test.
//   NODE_CONFIG_DIR                `<appRoot>/config`, so one harness can run
//                                  against either worktree.
//   PARITY_APP_ROOT                how fixtures/aws.js resolves `config/aws`
//                                  and fixtures/mail.js resolves
//                                  `lib/util/mailer`.
//   PARITY_S3_ROOT                 the object store, inside the run directory.
//   PARITY_S3_LOG, PARITY_MAIL_LOG the fixtures' evidence files.
//   TMPDIR, TMP, TEMP              inside the run directory.
//   MONGOMS_SYSTEM_BINARY          read by mongodb-memory-server itself;
//                                  neither set nor cleared here.
//
// The working directory is changed to `appRoot` before the first application
// require, because `config.app.templates` is the RELATIVE path 'lib/views/' and
// nunjucks resolves it against the process's working directory.
//
// The overlay's `app.start` is REMOVED from the composed configuration. The
// overlay exists to launch a server; this harness must not open a listening
// socket, and `aws.buckets.exports` - which the overlay supplies and
// `config/default.yaml:394-415` does not, although :391 reads `.name` and :402
// reads `.host` - is the reason the overlay is still mandatory here.
// `config/default.yaml` is NOT edited; AAP 0.6.7 records that gap as an
// existing deployment requirement.
//
// ===========================================================================
// THE CONTROLS
// ===========================================================================
// AAP 0.9.6-grade evidence needs proof that the assertions are not vacuous, so
// two documented flags exist for exactly that and default to the real thing:
//
//   --no-emitter-patch      leaves `InMemoryQueue.prototype.on` a no-op. The
//                           handler-ran assertions must then FAIL, which is
//                           what proves the patch is doing the work.
//   --worker-module <path>  requires a different module as the worker,
//                           relative to appRoot. Two uses: restore `job.jobId`
//                           in a scratch copy and confirm the `job.id`
//                           assertion fails, and run the mongoose-6-compatible
//                           scratch copy to confirm the success-path assertion
//                           set passes.
//
// ===========================================================================
// PUBLIC API
// ===========================================================================
//   run(options)             the whole harness; resolves to an exit code and
//                            never throws for an assertion failure
//   parseArguments(argv)     the CLI contract, exported because its failure
//                            modes are worth testing directly
//   normalizeEvidence(ev)    the artifact comparison's volatile-field pass
//   compareEvidence(a, b)    the determinism check, as a list of differences
//   buildExpectedTrinkets(seed)  the archive expectation, derived per owner
//   installQueuePatch(queue) the emitter patch, in one place
//   main()                   argv -> exit code, used by the require.main guard
//   EXIT_OK / EXIT_ERROR / EXIT_USAGE / EXIT_BLOCKED
//   JOBS / VOLATILE / WARNING_ALLOWANCES / HANDLE_ALLOWANCES / USAGE
//
// ===========================================================================
// INVOCATION
// ===========================================================================
//   node --pending-deprecation --trace-deprecation test/parity/worker.js
//   node test/parity/worker.js --out evidence.json
//   node test/parity/worker.js --out b.json --compare a.json   # determinism
//   node test/parity/worker.js --app ../baseline               # the load-order
//                                                              # measurement
//
// Exit codes: 0 every reachable assertion passed and the worker completed the
// success job; 1 an assertion failed, a timeout expired, or the worker could
// not be required; 2 a usage error; 3 BLOCKED - the harness is sound and the
// application cannot do what the gate requires.
//
// ===========================================================================
// PROHIBITIONS OBSERVED
// ===========================================================================
// No bare require treated as validation. No real Redis, S3, SMTP or network on
// any code path. No modification of lib/workers/exports.js, lib/util/queues.js,
// any configuration file or any baseline worktree. Nothing under `test/lib` and
// nothing in the sibling `helpers` directory is required - in particular not
// its `queue.js`, which this migration DELETES because it targets
// `queues.snapshots()`, a getter that is not exported, for a queue that is in
// `disabledQueues` at lib/util/queues.js:101; nothing here is modelled on it.
// The directory and the filename are kept in separate spans throughout, so the
// mechanical independence check - a grep of this file for the joined path -
// returns nothing but this comment. No `url.parse` either: it emits DEP0169 and
// this harness's own stderr is inside the zero-warning gate's stream. No
// unbounded wait, no `process.exit(0)` on a timeout, and no assertion that can
// pass when the handler never ran.

var assert       = require('assert');
var crypto       = require('crypto');
var fs           = require('fs');
var os           = require('os');
var path         = require('path');
var EventEmitter = require('events').EventEmitter;

// The lifecycle owner. Requiring it starts NOTHING - its `main` runs only under
// direct execution - so this require creates no server and installs no signal
// handler. `deepMerge` and `readOverlay` are borrowed from it rather than
// reimplemented, so the overlay is layered by exactly the code the sibling
// harnesses layer it with.
var mongo = require('./mongo');

// The fixtures. Deliberately NOT required at module scope: both install
// themselves on first require and both read PARITY_APP_ROOT and PARITY_S3_ROOT
// at load, so requiring them before the environment is composed would install
// against the wrong tree and root a store in the wrong place. `loadFixtures`
// owns the require, and the two variables below hold the results.
var awsFixture  = null;
var mailFixture = null;

// The seeder and the archive assertion, likewise resolved on first use so that
// requiring this module reads no configuration and opens no socket. `seed`
// pulls in the models, and a model require freezes `config`.
var seedTool    = null;
var storageTool = null;

var LOG_PREFIX = '[parity:worker] ';

var EXIT_OK      = 0;
var EXIT_ERROR   = 1;
var EXIT_USAGE   = 2;
var EXIT_BLOCKED = 3;

// Bounds. A hung worker gate is indistinguishable from a passing one, which is
// the failure mode this file is named for, so every wait below is one of these.
var OVERALL_TIMEOUT_MS   = 240000;
var JOB_TIMEOUT_MS       = 60000;
var CONNECT_TIMEOUT_MS   = 20000;
var SETTLE_TIMEOUT_MS    = 5000;
var POLL_INTERVAL_MS     = 10;
var EXIT_GRACE_MS        = 1500;

// The fixed Export ids this harness owns. Block 06 is the seeder's export
// block; :601-:603 and :6ff are its, so :611 upward are free and are used here
// so that two runs write the same identifiers and the artifact is comparable.
// The seeded `pending` export at ids.exportPending is deliberately NOT reused:
// a job mutates its document, and an assertion about job B must not be reading
// a value job A wrote.
var HARNESS_IDS = Object.freeze({
  exportSuccess       : '000000000000000000000611',
  exportMissingUser   : '000000000000000000000612',
  exportUnknownAction : '000000000000000000000613'
});

// The four jobs, declared as data because the report is keyed on these names
// and because the order is part of the contract: they run SEQUENTIALLY, each
// waited out and asserted before the next is enqueued, so that no job's
// cleanup can mask another's side effects.
var JOBS = Object.freeze([
  Object.freeze({
    name        : 'success',
    action      : 'bulk-export',
    exportId    : HARNESS_IDS.exportSuccess,
    user        : 'user',
    description : 'the successful export: every AAP 0.9.3 success assertion'
  }),
  Object.freeze({
    name        : 'missing-user',
    action      : 'bulk-export',
    exportId    : HARNESS_IDS.exportMissingUser,
    user        : 'missingUser',
    description : 'fails at lib/workers/exports.js:140 with `User not found`; ' +
                  'no user was resolved, so :198-200 sends NO failure mail'
  }),
  Object.freeze({
    name        : 'late-failure',
    action      : 'bulk-export',
    exportId    : 'missingExport',
    user        : 'user',
    description : 'a resolved user and an absent Export document, so the chain ' +
                  'reaches :176 with a null record and throws in ' +
                  'sendCompletionEmail: this is the case where a temporary file ' +
                  'EXISTS and is cleaned and where the failure mail IS sent'
  }),
  Object.freeze({
    name        : 'unknown-action',
    action      : 'not-a-real-action',
    exportId    : HARNESS_IDS.exportUnknownAction,
    user        : 'user',
    description : 'the processor rejection branch at :103-105, which reaches the ' +
                  'failed handler WITHOUT entering the export chain, so :86-89 ' +
                  'is the only writer of status and errorMessage'
  })
]);

// The fields the determinism comparison normalizes, and the only ones. Each is
// here because it is generated by the clock, by the run, or by a library, and
// each is still asserted for SHAPE where a shape assertion is possible - the
// filename against /^trinket-export-[0-9a-f]{12}\.zip$/, `expiresAt` against
// the three-day horizon, `fileSize` against the stored bytes. Nothing is
// normalized merely because it differed.
var VOLATILE = Object.freeze([
  'jobId',           // InMemoryQueue builds it from Date.now() and Math.random
  'filename',        // sha1(userId + Date.now()) at :118-124
  's3Key',           // 'exports/' + userId + '/' + filename
  'downloadUrl',     // host + '/' + s3Key
  'expiresAt',       // new Date() + 3 days at :162-163
  'fileSize',        // the zip embeds timestamps, so its length can move
  'etag',            // md5 of those same bytes
  'database',        // generated per run by mongo.generateDatabaseName
  'runDir',          // per run
  's3Root',          // inside runDir
  'uri',             // the in-memory server's port
  'durationMs',      // wall clock
  'htmlLength',      // the rendered mail embeds expiresAt
  'archiveBytes',    // as fileSize
  'stdio',           // which of stdout/stderr is a pipe depends on the shell
  'bodyBytes'        // the S3 call log's own byte count, which for the export
                     // archive IS the zip length. The asset's byte count goes
                     // with it, and is compared instead through
                     // assertArchiveLayout's content check, which is stronger.
]);

// The evidence sections the determinism comparison covers, as an allow-list.
//
// An allow-list rather than an exclusion list, and for a reason worth stating:
// the artifact records the comparison's OWN result, so comparing it wholesale
// compares a run that has run the check against one that has not - `verdict`,
// `checks` and `comparison` itself all differ by construction, and a
// self-referential difference is noise that would hide a real one. What is
// compared is therefore everything the run OBSERVED about the application, and
// what is left out is the run's commentary on itself: `tool`, `checks`,
// `verdict`, `comparison`, `notesOwed`, and the per-run addresses, which are
// keys in VOLATILE.
var COMPARABLE = Object.freeze([
  'moduleGraph', 'fixtures', 'templates', 'loadOrder', 'capabilities', 'queue',
  'seed', 'jobs', 'warnings', 'handles', 'teardown'
]);

// Warning allowance. One entry, and it names the module, the code, the
// dependency that reaches it and the AAP decision that keeps it, because a
// warning allowed without an attribution is a warning nobody will ever
// revisit. A captured warning matching NO entry here fails the run.
var WARNING_ALLOWANCES = Object.freeze([
  Object.freeze({
    id        : 'compress-commons-DEP0005',
    match     : /compress-commons[\/\\]lib[\/\\]archivers[\/\\]zip[\/\\]constants\.js/,
    code      : 'DEP0005',
    attributed: 'archiver 2.1.1 -> compress-commons: `new Buffer(...)` at ' +
                'constants.js:11, emitted once at load under ' +
                '--pending-deprecation',
    decision  : 'archiver is RETAINED at 2.1.1 by AAP 0.5.1.1 (moderate-only ' +
                'finding, deferred by the 0.5.1 triage rule) and is out of ' +
                'scope by AAP 0.2.2, so this cannot be resolved from inside ' +
                'the authorized diff. Reported as a named deviation from the ' +
                'zero-warning bar in AAP 0.8, not silenced.'
  })
]);

// Handle allowance. Same discipline: the type, the attribution, and why it
// cannot be closed. Anything else still open after teardown fails the run,
// which is what keeps a genuinely leaked connection, queue or timer visible.
var HANDLE_ALLOWANCES = Object.freeze([
  Object.freeze({
    id        : 'nunjucks-watch-FSEventWrap',
    type      : 'FSEventWrap',
    attributed: 'lib/util/nunjucks.js calls nunjucks.configure(..., {watch: ' +
                'config.isDev || config.isTest}), so under NODE_ENV=test ' +
                'chokidar watches every directory under config.app.templates',
    decision  : 'unclosable by a caller: nunjucks 3.2.4 FileSystemLoader keeps ' +
                'the FSWatcher in a constructor-local variable and exposes no ' +
                '`watcher` property (measured). Teardown reports the inventory ' +
                'and exits with the run code rather than waiting forever.'
  }),
  Object.freeze({
    // stdout and stderr, when either is a pipe or a tty rather than a file.
    // These are not resources this harness opened and they never keep the loop
    // alive, but WHICH of them exist depends on how the process was invoked -
    // `> /dev/null` produces none and `| grep` produces one - so they are
    // partitioned into their own `stdio` bucket by inspectHandles and kept out
    // of both the assertion and the determinism comparison. Measured: two
    // otherwise identical runs differed by exactly this, which is a fact about
    // the shell rather than about the application.
    id        : 'stdio',
    type      : 'PipeWrap',
    attributed: 'this process\'s own stdout/stderr when they are pipes or ttys',
    decision  : 'not a leak and not an application observation: partitioned ' +
                'into inspectHandles().stdio and excluded from the comparison'
  })
]);

var USAGE = [
  'Usage: node test/parity/worker.js [options]',
  '',
  'Drives the export worker through four deterministic jobs against an',
  'isolated MongoDB, the in-memory queue and the S3 and mail fixtures, and',
  'asserts the persisted documents, the archive, the upload and the mail.',
  '',
  'Options:',
  '  --app <path>            worktree under test (default: this file\'s own).',
  '  --overlay <path>        NODE_CONFIG overlay (default:',
  '                          test/parity/server-overlay.json beside this file).',
  '  --run-dir <path>        per-run directory; created if absent, never',
  '                          removed. Default: a unique directory in os.tmpdir().',
  '  --out <path>            write the evidence artifact as JSON.',
  '  --compare <path>        compare this run against a previous artifact and',
  '                          fail on any non-volatile difference.',
  '  --worker-module <path>  the module to require as the worker, relative to',
  '                          appRoot (default: lib/workers/exports). A CONTROL.',
  '  --no-emitter-patch      leave InMemoryQueue.on a no-op. A CONTROL: the',
  '                          handler assertions must fail.',
  '  --timeout <ms>          overall bound (default: ' + OVERALL_TIMEOUT_MS + ').',
  '  --job-timeout <ms>      per-job bound (default: ' + JOB_TIMEOUT_MS + ').',
  '  --help                  this text.',
  '',
  'Exit: 0 pass, 1 failure or timeout, 2 usage, 3 blocked by an application',
  'defect the harness is not authorized to fix.'
].join('\n');

// ---------------------------------------------------------------------------
// Reporting primitives
// ---------------------------------------------------------------------------
// Everything human-readable goes to STDERR. stdout belongs to the artifact and
// to the worker's own console.log lines, which are EVIDENCE this file asserts
// against - mixing commentary into that stream would make the evidence
// unparseable.

/**
 * One prefixed line on stderr, through the captured writer so the harness's
 * own output is visible in the same stream a reviewer reads.
 *
 * @param {string} message
 * @returns {undefined}
 */
function note(message) {
  process.stderr.write(LOG_PREFIX + message + '\n');
}

/**
 * A usage or environment failure that is reported as a message rather than a
 * stack: the caller mistyped something or the host is missing something, and
 * in neither case is this file's own call stack the information wanted.
 *
 * @constructor
 * @param {string} message
 */
function ToolError(message) {
  Error.call(this, message);
  this.name    = 'ToolError';
  this.message = message;

  if (Error.captureStackTrace) {
    Error.captureStackTrace(this, ToolError);
  }
}

ToolError.prototype = Object.create(Error.prototype);
ToolError.prototype.constructor = ToolError;

// ---------------------------------------------------------------------------
// Bounded waiting
// ---------------------------------------------------------------------------
// Every timer this file creates is cleared, without exception. That is not
// tidiness: an uncleared timer shows up in process.getActiveResourcesInfo() as
// a `Timeout` handle and would be reported by this harness's own clean-close
// assertion as an application leak. It was measured happening in a prototype,
// which is why the rule is written down here.

/**
 * Suspends for `ms`, clearing its own timer.
 *
 * @param {number} ms
 * @returns {Promise<undefined>}
 */
function sleep(ms) {
  return new Promise(function(resolve) {
    var timer = setTimeout(function() {
      clearTimeout(timer);
      resolve();
    }, ms);
  });
}

/**
 * Races a promise against a bound, and clears the bound's timer on either
 * outcome so a fast success leaves nothing behind.
 *
 * @param {Promise} promise
 * @param {number} ms
 * @param {string} label What timed out, for the message.
 * @returns {Promise} The promise's own settlement, or a rejection naming the
 *   bound that expired.
 */
function withTimeout(promise, ms, label) {
  var timer = null;

  var bound = new Promise(function(_resolve, reject) {
    timer = setTimeout(function() {
      reject(new Error(label + ' did not settle within ' + ms + 'ms'));
    }, ms);
  });

  return Promise.race([promise, bound]).then(
    function(value) {
      clearTimeout(timer);
      return value;
    },
    function(err) {
      clearTimeout(timer);
      throw err;
    }
  );
}

/**
 * Polls `probe` until it returns a value that is neither undefined nor null,
 * or the bound expires.
 *
 * Used instead of a fixed sleep wherever the worker's own write is
 * fire-and-forget - the failed handler's update at :86-89 takes an empty
 * callback, and the temporary-file unlink at :184 and :190 take one too - so
 * "the value is not there yet" and "the value will never be there" are
 * distinguished by the bound rather than by a guess.
 *
 * @param {function(): (Promise|*)} probe
 * @param {number} ms
 * @param {string} label
 * @returns {Promise<*>} The first non-empty value.
 * @throws {Error} If the bound expires; the message names the label.
 */
async function pollFor(probe, ms, label) {
  var deadline = Date.now() + ms;
  var value;

  for (;;) {
    value = await probe();

    if (value !== undefined && value !== null && value !== false) {
      return value;
    }

    if (Date.now() >= deadline) {
      throw new Error(label + ' was still absent after ' + ms + 'ms');
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ---------------------------------------------------------------------------
// Stream capture
// ---------------------------------------------------------------------------
// Both streams are TEED, never swallowed: the run has to remain readable while
// it happens, and AAP 0.9.3's zero-warning gate inspects stderr for the whole
// exercise. Two things are asserted off these buffers and nothing else is:
//   * stdout - the worker's own console.log lines, which is how
//     `exports failed job: <id>` proves the failed handler read `job.id`;
//   * stderr - the deprecation and warning notices, classified against
//     WARNING_ALLOWANCES.
// The writers are restored in teardown so that a caller requiring this module
// is not left with patched streams.

var capture = {
  installed : false,
  stdout    : [],
  stderr    : [],
  originals : { stdout : null, stderr : null }
};

/**
 * Tees stdout and stderr into memory. Idempotent.
 *
 * @returns {undefined}
 */
function installCapture() {
  if (capture.installed) {
    return;
  }

  capture.originals.stdout = process.stdout.write;
  capture.originals.stderr = process.stderr.write;

  process.stdout.write = function(chunk) {
    if (typeof chunk === 'string') {
      capture.stdout.push(chunk);
    }
    else if (Buffer.isBuffer(chunk)) {
      capture.stdout.push(chunk.toString('utf8'));
    }

    return capture.originals.stdout.apply(process.stdout, arguments);
  };

  process.stderr.write = function(chunk) {
    if (typeof chunk === 'string') {
      capture.stderr.push(chunk);
    }
    else if (Buffer.isBuffer(chunk)) {
      capture.stderr.push(chunk.toString('utf8'));
    }

    return capture.originals.stderr.apply(process.stderr, arguments);
  };

  capture.installed = true;
}

/**
 * Restores the genuine writers. Idempotent.
 *
 * @returns {undefined}
 */
function restoreCapture() {
  if (!capture.installed) {
    return;
  }

  process.stdout.write = capture.originals.stdout;
  process.stderr.write = capture.originals.stderr;
  capture.installed    = false;
}

/**
 * The captured stderr as one string.
 *
 * @returns {string}
 */
function capturedStderr() {
  return capture.stderr.join('');
}

// ---------------------------------------------------------------------------
// The CLI contract
// ---------------------------------------------------------------------------

/**
 * Parses argv into resolved options.
 *
 * Both `--flag value` and `--flag=value` are accepted for every option that
 * takes one, because the sibling tools accept both and a gate script should not
 * have to remember which spelling this one wanted.
 *
 * @param {string[]} argv Arguments after the script name.
 * @returns {Object} `{mode, appRoot, overlayPath, runDir, outPath, comparePath,
 *   workerModule, emitterPatch, timeoutMs, jobTimeoutMs}`
 * @throws {ToolError} On an unknown flag, a missing value, or a value that is
 *   not a positive integer where one is required.
 */
function parseArguments(argv) {
  var args = argv || [];
  var options = {
    mode         : 'run',
    appRoot      : path.resolve(__dirname, '..', '..'),
    overlayPath  : path.join(__dirname, 'server-overlay.json'),
    runDir       : null,
    outPath      : null,
    comparePath  : null,
    workerModule : 'lib/workers/exports',
    emitterPatch : true,
    timeoutMs    : OVERALL_TIMEOUT_MS,
    jobTimeoutMs : JOB_TIMEOUT_MS
  };
  var i;
  var arg;

  function valueFor(name) {
    var equals = arg.indexOf('=');

    if (equals > -1) {
      return arg.slice(equals + 1);
    }

    i += 1;

    if (i >= args.length) {
      throw new ToolError(name + ' requires a value');
    }

    return args[i];
  }

  function positiveInteger(name, raw) {
    var parsed = Number(raw);

    if (!isFinite(parsed) || Math.floor(parsed) !== parsed || parsed <= 0) {
      throw new ToolError(name + ' requires a positive integer; got ' +
        JSON.stringify(raw));
    }

    return parsed;
  }

  for (i = 0; i < args.length; i++) {
    arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.mode = 'help';
    }
    else if (arg === '--app' || arg.indexOf('--app=') === 0) {
      options.appRoot = path.resolve(valueFor('--app'));
    }
    else if (arg === '--overlay' || arg.indexOf('--overlay=') === 0) {
      options.overlayPath = path.resolve(valueFor('--overlay'));
    }
    else if (arg === '--run-dir' || arg.indexOf('--run-dir=') === 0) {
      options.runDir = path.resolve(valueFor('--run-dir'));
    }
    else if (arg === '--out' || arg.indexOf('--out=') === 0) {
      options.outPath = path.resolve(valueFor('--out'));
    }
    else if (arg === '--compare' || arg.indexOf('--compare=') === 0) {
      options.comparePath = path.resolve(valueFor('--compare'));
    }
    else if (arg === '--worker-module' || arg.indexOf('--worker-module=') === 0) {
      options.workerModule = valueFor('--worker-module');
    }
    else if (arg === '--no-emitter-patch') {
      options.emitterPatch = false;
    }
    else if (arg === '--timeout' || arg.indexOf('--timeout=') === 0) {
      options.timeoutMs = positiveInteger('--timeout', valueFor('--timeout'));
    }
    else if (arg === '--job-timeout' || arg.indexOf('--job-timeout=') === 0) {
      options.jobTimeoutMs = positiveInteger('--job-timeout',
        valueFor('--job-timeout'));
    }
    else {
      throw new ToolError('unknown argument `' + arg + '`. Use --help.');
    }
  }

  return options;
}

/**
 * Asserts that `appRoot` looks like this repository's worktree.
 *
 * Checked rather than assumed because every application require below is built
 * from this path, and a wrong one would otherwise surface as a confusing
 * MODULE_NOT_FOUND several steps later.
 *
 * @param {string} appRoot
 * @returns {string} The same path.
 * @throws {ToolError} If a required member is missing.
 */
function assertAppRoot(appRoot) {
  ['package.json', 'lib/workers/exports.js', 'lib/util/queues.js', 'config']
    .forEach(function(member) {
      if (!fs.existsSync(path.join(appRoot, member))) {
        throw new ToolError(appRoot + ' does not look like the worktree: ' +
          member + ' is missing');
      }
    });

  return appRoot;
}

// ---------------------------------------------------------------------------
// The run directory
// ---------------------------------------------------------------------------

/**
 * Creates the per-run directory and returns its layout.
 *
 * One directory per run holding the object store, the upload scratch space,
 * the two fixture evidence logs and the `config` package's runtime.json. The
 * grouping is not tidiness: a reviewer reading the evidence for a failed run,
 * or a gate script cleaning up after an abnormal exit, needs one path rather
 * than five. A caller-supplied directory is reused and never removed.
 *
 * @param {(string|null)} requested
 * @returns {Object} The layout.
 * @throws {ToolError} If a directory cannot be created.
 */
function createRunDirectory(requested) {
  var owned = requested === null || requested === undefined;
  var base  = owned
    ? path.join(os.tmpdir(), 'parity-worker-' + process.pid + '-' +
        crypto.randomBytes(4).toString('hex'))
    : path.resolve(requested);
  var layout = {
    runDir          : base,
    owned           : owned,
    s3Root          : path.join(base, 's3'),
    uploadsDir      : path.join(base, 'uploads'),
    s3LogPath       : path.join(base, 's3.log'),
    mailLogPath     : path.join(base, 'mail.log'),
    runtimeJsonPath : path.join(base, 'runtime.json')
  };

  [base, layout.s3Root, layout.uploadsDir].forEach(function(dir) {
    try {
      fs.mkdirSync(dir, { recursive : true });
    }
    catch (err) {
      throw new ToolError('could not create ' + dir + ': ' + err.message);
    }
  });

  return layout;
}

// ---------------------------------------------------------------------------
// The environment
// ---------------------------------------------------------------------------

/**
 * Composes the configuration and applies the whole environment contract to
 * THIS process, then changes the working directory to `appRoot`.
 *
 * Layering is `mongo.start`'s: the inherited NODE_CONFIG, then the overlay,
 * then the database address. `app.start` is deleted from the overlay copy
 * first - the overlay exists to launch a server and this harness must not open
 * a socket - while `aws.buckets.exports` is exactly why the overlay is still
 * required, since committed configuration declares no exports bucket although
 * the worker dereferences its `name` and `host`.
 *
 * Called BEFORE the first application require, because the `config` package
 * resolves and freezes on first require and because `config.app.templates` is
 * the relative path 'lib/views/'.
 *
 * @param {Object} options Resolved options.
 * @param {Object} layout From createRunDirectory.
 * @returns {Promise<Object>} `{address, overlay, cwdBefore}`
 * @throws {ToolError} If the overlay is unusable or MongoDB cannot start.
 */
async function applyEnvironment(options, layout) {
  var overlay = mongo.readOverlay(options.overlayPath);
  var address;
  var cwdBefore = process.cwd();

  if (!overlay || !overlay.aws || !overlay.aws.buckets ||
      !overlay.aws.buckets.exports || !overlay.aws.buckets.exports.name ||
      !overlay.aws.buckets.exports.host) {
    throw new ToolError(options.overlayPath + ' must carry ' +
      'aws.buckets.exports.{name,host}: config/default.yaml:394-415 declares ' +
      'no exports bucket although lib/workers/exports.js:391 reads its `name` ' +
      'and :402 its `host`, so without it the worker throws on its first ' +
      'upload. config/default.yaml is not edited - AAP 0.6.7 records the gap ' +
      'as an existing deployment requirement.');
  }

  // A copy, so the caller's overlay file is untouched and so `app.start` can be
  // removed without the removal leaking into anything else that reads it.
  overlay = JSON.parse(JSON.stringify(overlay));

  if (overlay.app && overlay.app.start !== undefined) {
    delete overlay.app.start;
  }

  address = await mongo.start({ overlay : overlay });

  process.env.NODE_ENV                      = 'test';
  process.env.NODE_CONFIG                   = address.nodeConfig;
  process.env.NODE_CONFIG_PERSIST_ON_CHANGE = mongo.PERSIST_ON_CHANGE;
  process.env.NODE_CONFIG_RUNTIME_JSON      = layout.runtimeJsonPath;
  process.env.NODE_CONFIG_DIR               = path.join(options.appRoot, 'config');

  process.env.PARITY_APP_ROOT = options.appRoot;
  process.env.PARITY_S3_ROOT  = layout.s3Root;
  process.env.PARITY_S3_LOG   = layout.s3LogPath;
  process.env.PARITY_MAIL_LOG = layout.mailLogPath;

  // hapi's payload `uploads` default and `tmp`'s scratch space both read these.
  // The worker's own temporary file is NOT covered by them - :125 hard-codes
  // '/tmp/' + filename - which is why the cleanup assertions look there.
  process.env.TMPDIR = layout.uploadsDir;
  process.env.TMP    = layout.uploadsDir;
  process.env.TEMP   = layout.uploadsDir;

  // An inherited seed manifest from an unrelated run would be read once at
  // fixture load and would place objects this run never asked for.
  delete process.env.PARITY_S3_SEED;

  process.chdir(options.appRoot);

  note('database ' + address.database + ' at ' + address.uri);
  note('run directory ' + layout.runDir);

  return { address : address, overlay : overlay, cwdBefore : cwdBefore };
}

/**
 * Decides whether this harness and the worktree under test share one module
 * graph, and says so.
 *
 * This matters and is easy to miss. `seed` and `storage` beside this file
 * resolve mongoose and the models from THIS worktree, while the worker resolves
 * them from `appRoot`. When the two differ there are two mongoose instances,
 * two connections and two model registries, so a document the seeder writes is
 * not one the worker can read and driving jobs would produce a confidently
 * wrong result. The check is mechanical rather than a comparison of paths,
 * because a hardlinked or symlinked install is legitimately the same graph.
 *
 * @param {string} appRoot
 * @returns {Object} `{shared, toolMongoose, appMongoose}`
 */
function inspectModuleGraph(appRoot) {
  var toolMongoose = null;
  var appMongoose  = null;

  try {
    toolMongoose = require.resolve('mongoose');
  }
  catch (err) {
    toolMongoose = null;
  }

  try {
    appMongoose = require.resolve('mongoose', { paths : [appRoot] });
  }
  catch (err) {
    appMongoose = null;
  }

  return {
    shared       : toolMongoose !== null && toolMongoose === appMongoose,
    toolMongoose : toolMongoose,
    appMongoose  : appMongoose
  };
}

/**
 * Requires a module from the worktree under test.
 *
 * Every application require in this file goes through here, so there is exactly
 * one place where `appRoot` is joined and nothing can accidentally resolve
 * against this file's own tree.
 *
 * @param {string} appRoot
 * @param {string} relative
 * @returns {*} The module's exports.
 */
function requireApp(appRoot, relative) {
  return require(path.resolve(appRoot, relative));
}

/**
 * Requires a PACKAGE as the worktree under test resolves it.
 *
 * `mongoose`, `q` and `nunjucks` are read through here so the harness holds the
 * same module instance the application holds - a second copy would have its own
 * model registry, its own promise implementation and its own configured
 * template environment, and every assertion built on it would be about the
 * wrong object.
 *
 * @param {string} appRoot
 * @param {string} name
 * @returns {*} The package's exports.
 * @throws {ToolError} If it cannot be resolved from appRoot.
 */
function requireAppPackage(appRoot, name) {
  var resolved;

  try {
    resolved = require.resolve(name, { paths : [appRoot] });
  }
  catch (err) {
    throw new ToolError('`' + name + '` is not resolvable from ' + appRoot +
      ' (' + ((err && err.code) || (err && err.message) || err) + ')');
  }

  return require(resolved);
}

// ---------------------------------------------------------------------------
// The fixtures
// ---------------------------------------------------------------------------

/**
 * Loads the S3 and mail fixtures, in that order, and asserts both installed.
 *
 * Both install themselves on first require and both read PARITY_APP_ROOT at
 * load, so this must happen after `applyEnvironment` and before the worker is
 * required: the cache entry the worker will hit has to be the patched one.
 *
 * `fixtures/mail.js` replacing `mailer.send` wholesale is what makes the
 * notification assertion possible at all. The overlay configures `app.mail`
 * with `from` and `host`, so `lib/util/mailer.js`'s `isConfigured` is true and
 * the genuine `send` would build a transport and attempt SMTP; with mail
 * UNconfigured it would instead short-circuit at :30-33 to `{skipped: true}`
 * and there would be nothing to observe. Neither is what this gate needs.
 *
 * @param {string} appRoot
 * @returns {Object} `{aws, mail}` statuses.
 * @throws {ToolError} If either fixture declined to install.
 */
function loadFixtures(appRoot) {
  var awsStatus;
  var mailStatus;

  awsFixture  = require('./fixtures/aws');
  mailFixture = require('./fixtures/mail');

  awsStatus  = awsFixture.status();
  mailStatus = mailFixture.status();

  if (!awsStatus.installed || !awsStatus.patched) {
    throw new ToolError('the S3 fixture did not install against ' + appRoot +
      ': ' + (awsStatus.diagnostic || 'no diagnostic') + '. Every S3 call in ' +
      'this run would otherwise reach the real service.');
  }

  if (!mailStatus.installed) {
    throw new ToolError('the mail fixture did not install against ' + appRoot +
      ': ' + (mailStatus.diagnostic || 'no diagnostic') + '. The notification ' +
      'assertions would have nothing to observe and SMTP would be attempted.');
  }

  if (awsStatus.root !== process.env.PARITY_S3_ROOT) {
    throw new ToolError('the S3 fixture rooted its store at ' + awsStatus.root +
      ' rather than ' + process.env.PARITY_S3_ROOT);
  }

  return { aws : awsStatus, mail : mailStatus };
}

// ---------------------------------------------------------------------------
// The queue patch
// ---------------------------------------------------------------------------

/**
 * Makes one InMemoryQueue instance emit Bull's events, at run time.
 *
 * THE MECHANISM OBSTACLE 1 REQUIRES. `InMemoryQueue.prototype.on` is a no-op
 * and `_processJob` only `.catch`-logs a rejected processor, so without this
 * the worker's `error`, `failed` and `completed` handlers never run and every
 * assertion about their bodies would pass vacuously. Applied to the INSTANCE:
 * the prototype is untouched, `lib/util/queues.js` is untouched, and `restore`
 * puts the three members back.
 *
 * The job handed to the processor and to the events is shaped like a Bull 4
 * Job, which is the whole point of the exercise:
 *   `id`        present - Bull 4's identifier, the one the failed handler must
 *               read now that `job.jobId` is gone;
 *   `jobId`     ABSENT - deliberately not defined, so a body still reading it
 *               logs `undefined` and the assertion catches it;
 *   `remove()`  present and OBSERVABLE, because the completed handler calls it
 *               (:94) and "it did not throw" is not evidence that it ran;
 *   `data`      carried through unchanged, since every handler reads it.
 *
 * The processor's own promise decides which event is emitted, which is Bull's
 * contract for a one-argument promise-returning processor - the form the worker
 * registers at :97. A synchronous throw is treated as a rejection, and the
 * `done` callback is still offered as the second argument so the two-argument
 * form remains available; whichever settles first wins, once.
 *
 * @param {Object} queue The cached InMemoryQueue.
 * @returns {Object} `{records, recordFor, emitError, handlerCount, restore}`
 * @throws {ToolError} If the instance is not the shape this patch expects.
 */
function installQueuePatch(queue) {
  var emitter = new EventEmitter();
  var records = [];
  var byId    = {};
  var originals;

  if (!queue || typeof queue.on !== 'function' ||
      typeof queue._processJob !== 'function' ||
      typeof queue.add !== 'function' || !Array.isArray(queue.handlers)) {
    throw new ToolError('the exports queue is not the InMemoryQueue this patch ' +
      'expects (needs on, add, handlers and _processJob). With Redis enabled ' +
      'lib/util/queues.js:117 builds a real Bull queue instead, and this ' +
      'harness neither wants nor needs one - db.redis.enabled must be false.');
  }

  originals = {
    on          : queue.on,
    emit        : queue.emit,
    _processJob : queue._processJob
  };

  queue.on = function(event, handler) {
    emitter.on(event, handler);
    return this;
  };

  queue.emit = function() {
    return emitter.emit.apply(emitter, arguments);
  };

  queue._processJob = function(job) {
    var self    = this;
    var settled = false;
    var settle;
    var record;
    var bullJob;
    var result;

    bullJob = {
      id       : job.id,
      data     : job.data,
      opts     : job.opts,
      attempts : job.attempts,
      remove   : function() {
        record.removeCalls += 1;
        return Promise.resolve();
      }
    };

    record = {
      id             : job.id,
      job            : bullJob,
      hasJobIdField  : Object.prototype.hasOwnProperty.call(bullJob, 'jobId'),
      handlerCount   : this.handlers.length,
      completedCount : 0,
      failedCount    : 0,
      removeCalls    : 0,
      result         : undefined,
      error          : null,
      settled        : null
    };

    record.settled = new Promise(function(resolve) {
      settle = resolve;
    });

    records.push(record);
    byId[job.id] = record;

    if (this.handlers.length === 0) {
      // The worker never registered, which is a harness-ordering failure rather
      // than an application outcome. Settle so nothing waits forever; the
      // handlerCount assertion reports it.
      settle(record);
      return;
    }

    function finish(err, value) {
      if (settled) {
        return;
      }

      settled = true;

      if (err) {
        record.error = err;
        record.failedCount += 1;
        self.emit('failed', bullJob, err);
      }
      else {
        record.result = value;
        record.completedCount += 1;
        self.emit('completed', bullJob, value);
      }

      settle(record);
    }

    try {
      result = this.handlers[0](bullJob, function done(err) {
        finish(err || null, undefined);
      });
    }
    catch (err) {
      finish(err || new Error('the processor threw a falsy value'), undefined);
      return;
    }

    if (result && typeof result.then === 'function') {
      Promise.resolve(result).then(
        function(value) {
          finish(null, value);
        },
        function(err) {
          finish(err || new Error('the processor rejected with a falsy value'),
            undefined);
        }
      );
    }
    else if (result !== undefined) {
      // A processor that returned a non-thenable has completed synchronously.
      finish(null, result);
    }
  };

  return {
    records : records,

    recordFor : function(id) {
      return byId[id] || null;
    },

    /**
     * Emits a queue-level `error`, which is how the handler at :72-74 is
     * reached. Stated for what it is in the report: a harness emission that
     * proves the handler body, not proof that Bull emits.
     */
    emitError : function(err) {
      return emitter.emit('error', err);
    },

    listenerCounts : function() {
      return {
        error     : emitter.listenerCount('error'),
        failed    : emitter.listenerCount('failed'),
        completed : emitter.listenerCount('completed')
      };
    },

    restore : function() {
      queue.on          = originals.on;
      queue.emit        = originals.emit;
      queue._processJob = originals._processJob;
    }
  };
}

// ---------------------------------------------------------------------------
// The update recorder
// ---------------------------------------------------------------------------

/**
 * Records every `findByIdAndUpdate` the worker performs on one model, in order,
 * and forwards each call unchanged.
 *
 * This is what makes the `processing` -> `completed` sequence an EXACT
 * assertion instead of a race. Polling the document cannot prove the
 * intermediate `processing` state - the whole chain can land between two polls -
 * and an assertion that only sometimes observes what it claims to observe is
 * not an assertion. Recording the calls also captures the payloads themselves:
 * the dotted `progress.total`, the `trinketCount`, and the completion update's
 * five fields.
 *
 * It records and never alters: same `this`, same arguments, same return value.
 * `restore` puts the original static back.
 *
 * @param {Object} model A mongoose model.
 * @returns {Object} `{calls, restore}`
 */
function installUpdateRecorder(model) {
  var calls    = [];
  var original = model.findByIdAndUpdate;

  model.findByIdAndUpdate = function(id, update) {
    var recorded;

    try {
      recorded = JSON.parse(JSON.stringify(update));
    }
    catch (err) {
      // An unserializable update is still worth recording as having happened.
      recorded = { unserializable : true };
    }

    calls.push({ id : String(id), update : recorded });

    return original.apply(this, arguments);
  };

  return {
    calls   : calls,
    restore : function() {
      model.findByIdAndUpdate = original;
    }
  };
}

// ---------------------------------------------------------------------------
// The load-order measurement
// ---------------------------------------------------------------------------

/**
 * Requires the worker and reports the outcome as a measurement.
 *
 * At 2f8712a this THROWS `Error: Schema can only contain plain objects`,
 * because the worker's first two requires load config/db before
 * config/app.config, so mongoose-schema-extend's transitive Proxy polyfill
 * replaces the global `Object.getPrototypeOf` before the schema libraries
 * reached through app.config load. On the baseline worktree that failure is
 * this harness's DELIVERABLE, and the caller reports it as the measured
 * baseline rather than as a pass - which is why the error is captured and
 * returned rather than swallowed by a try/catch that carries on.
 *
 * On the target worktree it must succeed, and `run` treats a failure here as a
 * run failure.
 *
 * @param {Object} options Resolved options.
 * @returns {Object} `{required, module, durationMs, error}`
 */
function requireWorker(options) {
  var started = Date.now();

  try {
    requireApp(options.appRoot, options.workerModule);

    return {
      required   : true,
      module     : options.workerModule,
      durationMs : Date.now() - started,
      error      : null
    };
  }
  catch (err) {
    return {
      required   : false,
      module     : options.workerModule,
      durationMs : Date.now() - started,
      error      : {
        name    : (err && err.name) || 'Error',
        message : (err && err.message) || String(err),
        code    : (err && err.code) || null
      }
    };
  }
}

// ---------------------------------------------------------------------------
// The template measurement (obstacle 2)
// ---------------------------------------------------------------------------

/**
 * Renders one of the worker's two mail templates and reports what happened.
 *
 * Called twice - before the worker is required and after - because the pair is
 * the whole measurement: unconfigured, nunjucks' default loader searches the
 * process's working directory and throws; configured, the template renders. The
 * worker skips `nunjucks.configure` under `config.isTest` (:128-130), so the
 * second result is produced entirely by its own require graph
 * (config/app.config -> lib/util/routeParser -> lib/controllers/courses.js ->
 * lib/util/nunjucks). The harness configures nothing.
 *
 * @param {string} appRoot
 * @param {string} template
 * @returns {Object} `{rendered, bytes, error}`
 */
function measureTemplateResolution(appRoot, template) {
  var nunjucks = requireAppPackage(appRoot, 'nunjucks');
  var html;

  try {
    // A complete context, so a failure here is about template RESOLUTION and
    // never about an undefined variable. These are the five keys
    // sendCompletionEmail passes at :412-418.
    html = nunjucks.render(template, {
      username     : 'measurement',
      trinketCount : 0,
      fileSize     : '0 B',
      expiresAt    : 'Jan 1, 2000',
      downloadUrl  : 'http://127.0.0.1/measurement'
    });

    return { rendered : true, bytes : html.length, error : null };
  }
  catch (err) {
    return {
      rendered : false,
      bytes    : null,
      error    : ((err && err.message) || String(err)).split('\n')[0]
    };
  }
}

// ---------------------------------------------------------------------------
// The capability probes
// ---------------------------------------------------------------------------

/**
 * Measures whether the worker's database idiom can work at all here.
 *
 * Two independent probes, both against the packages the worktree under test
 * resolves, and both reported whether they pass or fail:
 *
 *   `nsend` - `Q.nsend(Model, 'findById', id)`, which is the exact form the
 *     worker uses at :135. `q` 1.0.1's ninvoke assimilates a thenable return
 *     value by calling `.then()` on it, and a mongoose 6 Query is a thenable,
 *     so the query executes twice and mongoose throws "Query was already
 *     executed". No document is needed for the probe: the second execution is
 *     what fails, not the lookup.
 *
 *   `stream` - whether `Query.prototype.stream` is a function.
 *     `createExportArchive` calls `.find(...).select(...).stream()` at :237,
 *     and mongoose removed that method in 5.x.
 *
 * The result decides which expectation set each bulk-export job is asserted
 * against, and a blocked capability is reported with its remedy rather than
 * turning any assertion off.
 *
 * @param {string} appRoot
 * @param {Object} mongooseInstance The application's mongoose.
 * @returns {Promise<Object>} `{nsend, stream, exportPathUsable}`
 */
async function probeCapabilities(appRoot, mongooseInstance, workerModule) {
  var Q = requireAppPackage(appRoot, 'q');
  // Fixed rather than generated: mongoose's own error text quotes the id, so a
  // generated one would make the recorded measurement differ between two runs
  // of identical behaviour. It belongs to no document - the probe fails on the
  // SECOND execution, not on the lookup - and it is outside the seeder's
  // blocks, so it can never collide with a fixture.
  var probeId = '0000000000000000000000fe';
  var nsend = { usable : false, error : null, sites : 0 };
  var stream = {
    usable : typeof mongooseInstance.Query.prototype.stream === 'function',
    error  : null,
    sites  : 0
  };
  var source = '';

  try {
    await Q.nsend(mongooseInstance.model('Export'), 'findById', probeId);
    nsend.usable = true;
  }
  catch (err) {
    nsend.error = ((err && err.message) || String(err)).split('\n')[0];
  }

  if (!stream.usable) {
    stream.error = 'Query.prototype.stream is ' +
      typeof mongooseInstance.Query.prototype.stream +
      '; mongoose removed it in 5.x';
  }

  // Whether the MODULE UNDER TEST actually uses each idiom, counted from its
  // own source. Both halves are needed: an unusable idiom only blocks the
  // export path if the worker reaches for it, and reading the source is what
  // makes the verdict follow the module rather than the environment. It is also
  // what lets a repaired worker - or the scratch control copy - flip the
  // expectation set automatically instead of by a flag.
  try {
    source = fs.readFileSync(
      require.resolve(path.resolve(appRoot, workerModule)), 'utf8');
  }
  catch (err) {
    source = '';
  }

  nsend.sites  = (source.match(/Q\.nsend\(/g) || []).length;
  stream.sites = (source.match(/\.stream\(\)/g) || []).length;

  return {
    nsend            : nsend,
    stream           : stream,
    exportPathUsable : (nsend.usable || nsend.sites === 0) &&
                       (stream.usable || stream.sites === 0)
  };
}

// ---------------------------------------------------------------------------
// Database readiness and fixtures
// ---------------------------------------------------------------------------

/**
 * Waits for the connection the worker's own require opened.
 *
 * `config/db.js` calls `connect()` at module scope, so requiring the worker -
 * which requires config/app.config, which requires config/db - is what opens
 * it. Nothing here dials: a second place deciding the database address is
 * exactly the confusion `test/parity/mongo.js` exists to prevent.
 *
 * @param {Object} mongooseInstance
 * @param {number} ms
 * @returns {Promise<string>} The connected database name.
 * @throws {Error} If it is not ready inside the bound.
 */
async function awaitConnection(mongooseInstance, ms) {
  await pollFor(function() {
    return mongooseInstance.connection.readyState === 1;
  }, ms, 'the mongoose connection config/db.js opened');

  return mongooseInstance.connection.name;
}

/**
 * Seeds the fixtures this gate needs and creates the per-job Export documents.
 *
 * Four groups are selected. `users` and `trinkets` are the export's subject -
 * a user owning trinkets in BOTH of the code shapes `parseCodeFiles` branches
 * on at :356-374 - `files` because an asset-bearing trinket's File document
 * arms the metric hook the seeder reconciles, and `exports` for the three
 * export states the seeder owns. `force: true` so a reused run directory or a
 * second pass starts from the same state.
 *
 * The per-job `pending` Export documents are created here with fixed ids of
 * this harness's own rather than by reusing the seeder's `exportPending`: a job
 * MUTATES its document, and an assertion about one job must never be reading a
 * value another job wrote.
 *
 * @param {Object} deps `{seed, Export, mongooseInstance}`
 * @returns {Promise<Object>} `{summary, created}`
 */
async function seedFixtures(deps) {
  var summary = await deps.seed.seed({
    users    : true,
    files    : true,
    trinkets : true,
    exports  : true,
    force    : true
  });
  var created = [];
  var ids = [
    HARNESS_IDS.exportSuccess,
    HARNESS_IDS.exportMissingUser,
    HARNESS_IDS.exportUnknownAction
  ];
  var i;

  for (i = 0; i < ids.length; i++) {
    await deps.ExportModel.collection.deleteOne({
      _id : new deps.mongooseInstance.Types.ObjectId(ids[i])
    });

    await new deps.ExportModel({
      _id      : ids[i],
      _owner   : deps.seed.ids.user,
      status   : 'pending',
      progress : { total : 0, processed : 0, failed : 0 },
      created  : '2024-06-01T00:00:00.000Z'
    }).save();

    created.push(ids[i]);
  }

  // The pre-migration objects the export path reads: the user asset an
  // asset-bearing trinket points at, and the seeded completed export's own
  // archive. Prepopulating is what makes a changed key surface as a lookup
  // failure rather than passing on freshly written data (AAP 0.6.7).
  awsFixture.prepopulate(deps.seed.s3Manifest());

  return { summary : summary, created : created };
}

/**
 * The archive expectation, derived rather than borrowed.
 *
 * `seed.fixtures.exportArchive.trinketCount` is the count of ALL seeded
 * trinkets and is 7. The worker counts `{_owner: userId}` at :144, and one of
 * those seven belongs to the admin, so the expected count for a job on the
 * seeded user is 6. Measured, and the difference matters: borrowing the
 * fixture's number would fail the `progress.total` assertion for a reason that
 * has nothing to do with the worker.
 *
 * Each spec is what `assertArchiveLayout` compares content against:
 * `{shortCode, name, lang, code}` plus, for the asset-bearing trinket, the
 * asset the seeder attached - matched by the application's own
 * `asset.name || basename(url)` rule.
 *
 * @param {Object} seed The seeder module.
 * @returns {Object[]} One spec per trinket the seeded user owns.
 */
function buildExpectedTrinkets(seed) {
  var trinkets   = seed.fixtures.trinkets;
  var assetBytes = Buffer.from(seed.fixtures.bytes.assetGif.base64, 'base64');
  var descriptors = seed.storage({ exports : false });

  return Object.keys(trinkets)
    .filter(function(key) {
      return trinkets[key].owner === 'user';
    })
    .map(function(key) {
      var trinket = trinkets[key];
      var spec = {
        shortCode : trinket.shortCode,
        name      : trinket.name,
        lang      : trinket.lang,
        code      : trinket.code
      };

      if (key === 'trinketWithAssets') {
        spec.assets = [{
          name    : seed.fixtures.bytes.assetGif.filename,
          url     : descriptors.userAsset.url,
          content : assetBytes
        }];
      }

      return spec;
    });
}

// ---------------------------------------------------------------------------
// The assertion ledger
// ---------------------------------------------------------------------------

/**
 * Records every check by name with its outcome.
 *
 * Two reasons it exists rather than bare `assert` calls. A gate should report
 * WHAT it asserted, not only what broke - "56 checks, 56 passed" is evidence
 * where silence is not. And one failure should not hide the next: a run that
 * stops at the first mismatch sends a reviewer round the loop once per problem.
 * The run still fails; it fails with the whole list.
 *
 * @returns {Object} `{check, checks, failures, count, passed}`
 */
function createLedger() {
  var checks = [];

  return {
    /**
     * Runs one check. `body` may be sync or async; an AssertionError - or any
     * throw - is recorded as a failure with its message.
     *
     * @param {string} name
     * @param {function(): (Promise|undefined)} body
     * @returns {Promise<boolean>} Whether it passed.
     */
    check : async function(name, body) {
      try {
        await body();
        checks.push({ name : name, ok : true, message : null });
        return true;
      }
      catch (err) {
        checks.push({
          name    : name,
          ok      : false,
          message : (err && err.message) || String(err)
        });
        note('FAIL ' + name + ': ' + ((err && err.message) || err));
        return false;
      }
    },

    checks : checks,

    failures : function() {
      return checks.filter(function(entry) {
        return !entry.ok;
      });
    },

    count : function() {
      return checks.length;
    },

    passed : function() {
      return checks.filter(function(entry) {
        return entry.ok;
      }).length;
    }
  };
}

// ---------------------------------------------------------------------------
// Driving one job
// ---------------------------------------------------------------------------

/**
 * The worker's temporary files, which are NOT inside the run directory.
 *
 * `lib/workers/exports.js:125` hard-codes `'/tmp/' + filename`, so TMPDIR does
 * not move them and cleanup has to be asserted where the worker actually
 * writes. The pattern is the export filename's own shape.
 *
 * @returns {string[]} Sorted names of matching files in /tmp.
 */
function listWorkerTempFiles() {
  var names;

  try {
    names = fs.readdirSync('/tmp');
  }
  catch (err) {
    return [];
  }

  return names.filter(function(name) {
    return /^trinket-export-[0-9a-f]{12}\.zip$/.test(name);
  }).sort();
}

/**
 * Enqueues one job, waits for the processor to settle, and collects everything
 * observable about it.
 *
 * Jobs run SEQUENTIALLY and each is fully collected before the next is
 * enqueued, which is what makes "assert both jobs' side effects independently"
 * true rather than aspirational: the mail window is reset per job, the S3 call
 * log is sliced per job, and the recorded updates are filtered to the job's own
 * export id.
 *
 * Two waits, and both are bounded. The processor's settlement comes from the
 * queue patch. The document's terminal state is then POLLED, because the
 * writes that produce it are fire-and-forget: the failed handler's update at
 * :86-89 takes an empty callback, so it can land after the promise has already
 * rejected.
 *
 * @param {Object} ctx The run context.
 * @param {Object} spec One entry of JOBS.
 * @returns {Promise<Object>} The outcome.
 */
async function driveJob(ctx, spec) {
  var exportId = spec.exportId === 'missingExport'
    ? ctx.seed.ids.missingExport
    : spec.exportId;
  var userId = ctx.seed.ids[spec.user];
  var data = {
    action   : spec.action,
    exportId : exportId,
    userId   : userId
  };
  var stdoutBefore = capture.stdout.length;
  var callsBefore  = awsFixture.calls().length;
  var updatesBefore = ctx.updates.calls.length;
  var tempBefore   = listWorkerTempFiles();
  var startedAt    = Date.now();
  var added;
  var record;
  var doc = null;

  mailFixture.reset();

  note('job ' + spec.name + ': ' + spec.description);

  added  = await ctx.queue.add(data);
  record = await pollFor(function() {
    return ctx.patch.recordFor(added.id);
  }, SETTLE_TIMEOUT_MS, 'job ' + spec.name + ' reaching the processor');

  await withTimeout(record.settled, ctx.options.jobTimeoutMs,
    'job ' + spec.name + '\'s processor');

  // The document, once it stops moving. `pending` is the state this harness
  // wrote, so anything else is the worker's; an absent document is a legitimate
  // outcome for the late-failure job and is reported as null rather than waited
  // out.
  try {
    doc = await pollFor(async function() {
      var found = await ctx.ExportModel.findById(exportId).exec();

      if (!found) {
        return false;
      }

      return found.status === 'completed' || found.status === 'failed'
        ? found
        : false;
    }, SETTLE_TIMEOUT_MS, 'the Export document for job ' + spec.name +
      ' reaching a terminal status');
  }
  catch (err) {
    doc = await ctx.ExportModel.findById(exportId).exec();
  }

  return {
    name        : spec.name,
    spec        : spec,
    data        : data,
    exportId    : exportId,
    userId      : userId,
    jobId       : added.id,
    record      : record,
    doc         : doc,
    startedAt   : startedAt,
    durationMs  : Date.now() - startedAt,
    mail        : mailFixture.calls(),
    awsCalls    : awsFixture.calls().slice(callsBefore),
    updates     : ctx.updates.calls.slice(updatesBefore).filter(function(entry) {
      return entry.id === String(exportId);
    }),
    allUpdates  : ctx.updates.calls.slice(updatesBefore),
    tempBefore  : tempBefore,
    tempAfter   : listWorkerTempFiles(),
    stdout      : capture.stdout.slice(stdoutBefore).join('').split('\n')
  };
}

/**
 * The `status` values the worker wrote for one job, in order.
 *
 * The sequence is the assertion AAP 0.9.3 asks for - `processing` then
 * `completed` - and it comes from the recorded calls rather than from polling,
 * because the intermediate state can be overwritten between two polls and an
 * assertion that only sometimes sees what it claims is not one.
 *
 * @param {Object} outcome
 * @returns {string[]}
 */
function statusSequence(outcome) {
  return outcome.updates
    .filter(function(entry) {
      return entry.update && typeof entry.update.status === 'string';
    })
    .map(function(entry) {
      return entry.update.status;
    });
}

/**
 * The line the failed handler logs, if it logged one.
 *
 * `lib/workers/exports.js:82` is `console.log('exports failed job:', job.id,
 * job.data)`, so the id is the token between the label and the inspected data
 * object. Parsing it is the only way to see what the handler READ: a body still
 * reading Bull 0.7's `job.jobId` would print `undefined` there, and no
 * assertion on the document or the promise would notice.
 *
 * @param {Object} outcome
 * @returns {(string|null)} The logged id, or null if no line was emitted.
 */
function loggedFailedJobId(outcome) {
  var i;
  var match;

  for (i = 0; i < outcome.stdout.length; i++) {
    match = /^exports failed job: (.*?) (\{|undefined|null)/.exec(outcome.stdout[i]);

    if (match) {
      return match[1];
    }

    match = /^exports failed job: (\S+)\s*$/.exec(outcome.stdout[i]);

    if (match) {
      return match[1];
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Assertions - registration and the error handler
// ---------------------------------------------------------------------------

/**
 * Asserts that the worker registered what it is supposed to register.
 *
 * This is the emitter patch's own proof. Under `--no-emitter-patch` the
 * listener counts are zero, because `InMemoryQueue.prototype.on` discards its
 * argument, and these checks fail - which is exactly the control AAP 0.9.6
 * asks for. Without them, every later "the handler ran" assertion could pass
 * vacuously on a queue that emits nothing.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @returns {Promise<undefined>}
 */
async function assertQueueRegistration(ctx, ledger) {
  var counts = ctx.patch ? ctx.patch.listenerCounts() : {
    error : 0, failed : 0, completed : 0
  };

  await ledger.check('the worker registered exactly one processor (:97)',
    function() {
      assert.strictEqual(ctx.queue.handlers.length, 1,
        'lib/workers/exports.js:97 calls exportsQueue.process(fn) once; the ' +
        'queue holds ' + ctx.queue.handlers.length + ' handler(s)');
    });

  await ledger.check('the three event handlers are attached (:72, :76, :93)',
    function() {
      assert.deepStrictEqual(counts, { error : 1, failed : 1, completed : 1 },
        'the worker attaches error, failed and completed handlers; the ' +
        'emitter holds ' + JSON.stringify(counts) + '. Zero counts mean the ' +
        'queue instance was not patched, so InMemoryQueue.prototype.on ' +
        '(lib/util/queues.js:78-81) discarded them and no assertion about a ' +
        'handler body can mean anything.');
    });
}

/**
 * Asserts the `error` handler's payload shape (:72-74).
 *
 * The emission is the harness's own - there is no Bull queue in this process to
 * emit one - so what this proves is bounded and stated: the handler is
 * attached, its body runs, and it logs the error object it was handed. That is
 * the payload-shape claim AAP 0.9.3 asks for; Bull's own emission remains an
 * open item in 0.9.6.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @returns {Promise<undefined>}
 */
async function assertErrorHandler(ctx, ledger) {
  var marker = 'parity-worker synthetic queue error ' +
    crypto.randomBytes(4).toString('hex');
  var before = capture.stdout.length;
  var emitted = false;
  var lines;

  if (ctx.patch) {
    emitted = ctx.patch.emitError(new Error(marker));
  }

  lines = capture.stdout.slice(before).join('').split('\n');

  await ledger.check('the error handler logged the error it was handed (:72-74)',
    function() {
      assert.ok(emitted,
        'no listener received the emission, so the error handler is not ' +
        'attached');
      assert.ok(lines.some(function(line) {
        return line.indexOf('exports queue error:') === 0 &&
               line.indexOf(marker) > -1;
      }), 'expected a line `exports queue error: ... ' + marker + '`; got ' +
        JSON.stringify(lines));
    });
}

// ---------------------------------------------------------------------------
// Assertions - every job
// ---------------------------------------------------------------------------

/**
 * The checks that hold for any job, whatever its outcome.
 *
 * The Bull-4 job shape is asserted here rather than trusted: `id` present and
 * non-empty, `jobId` ABSENT as an own property, `remove` callable, and `data`
 * carried through byte for byte. If the fixture job grew a `jobId` the
 * `job.id` assertion below would stop meaning anything, so the shape is part
 * of the gate.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertJobShape(ctx, ledger, outcome) {
  await ledger.check(outcome.name + ': the job handed to the worker is Bull-4 ' +
    'shaped (id present, jobId absent, remove callable)', function() {
    assert.ok(outcome.record.job.id, 'job.id must be present and non-empty');
    assert.strictEqual(String(outcome.record.job.id), String(outcome.jobId),
      'job.id must be the id `add` returned');
    assert.strictEqual(outcome.record.hasJobIdField, false,
      'the fixture job must NOT carry `jobId`: Bull 4 removed it, and a job ' +
      'that still had one would let a body reading job.jobId pass');
    assert.strictEqual(typeof outcome.record.job.remove, 'function',
      'Bull 4 Job#remove must be present, since :94 calls it');
    assert.deepStrictEqual(outcome.record.job.data, outcome.data,
      'job.data must reach the processor unchanged');
  });

  await ledger.check(outcome.name + ': the processor settled exactly once',
    function() {
      assert.strictEqual(
        outcome.record.completedCount + outcome.record.failedCount, 1,
        'exactly one of completed/failed must be emitted; got ' +
        outcome.record.completedCount + ' completed and ' +
        outcome.record.failedCount + ' failed');
    });
}

/**
 * The checks for a job that FAILED, whatever made it fail.
 *
 * `job.id` is the important one and is the single most consequential assertion
 * in this file: it is the one thing the Bull 0.7 -> 4 move actually breaks. The
 * handler's own log line is the evidence, because the document and the promise
 * look identical either way - a body still reading `job.jobId` writes exactly
 * the same document and rejects with exactly the same error, and prints
 * `undefined` where the id belongs.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertFailedHandlerRan(ctx, ledger, outcome) {
  var logged = loggedFailedJobId(outcome);

  await ledger.check(outcome.name + ': the failed handler ran and read `job.id`',
    function() {
      assert.notStrictEqual(logged, null,
        'lib/workers/exports.js:82 logs `exports failed job: <id> <data>`; no ' +
        'such line was emitted, so the handler did not run');
      assert.notStrictEqual(logged, 'undefined',
        'the handler logged `undefined` for the job id, which is what a body ' +
        'still reading Bull 0.7\'s `job.jobId` produces on a Bull 4 job');
      assert.strictEqual(logged, String(outcome.jobId),
        'the handler must log the real job id');
    });

  await ledger.check(outcome.name + ': the completed handler did NOT run, so ' +
    'job.remove() was not called', function() {
    assert.strictEqual(outcome.record.removeCalls, 0,
      'job.remove() is called only from the completed handler (:93-95)');
  });
}

/**
 * Asserts that a job produced no S3 write, no mail and no leftover temporary
 * file - the shape every failure that never reached the upload must have.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertNoExternalEffects(ctx, ledger, outcome) {
  await ledger.check(outcome.name + ': nothing was uploaded', function() {
    var puts = outcome.awsCalls.filter(function(call) {
      return call.operation === 'putObject';
    });

    assert.deepStrictEqual(puts, [],
      'the upload at :390-397 must not have been reached');
  });

  await ledger.check(outcome.name + ': no mail was sent', function() {
    assert.deepStrictEqual(outcome.mail.map(function(call) {
      return call.type;
    }), [], 'no mail is expected on this path');
  });

  await ledger.check(outcome.name + ': no temporary file was left in /tmp',
    async function() {
      var remaining = await pollFor(function() {
        var after = listWorkerTempFiles().filter(function(name) {
          return outcome.tempBefore.indexOf(name) === -1;
        });

        return after.length === 0 ? [] : false;
      }, SETTLE_TIMEOUT_MS, 'the temporary file to be unlinked');

      assert.deepStrictEqual(remaining, [],
        'lib/workers/exports.js:190 unlinks the temporary file on the failure ' +
        'path; a leftover means it did not');
    });
}

// ---------------------------------------------------------------------------
// Assertions - the successful export
// ---------------------------------------------------------------------------

/**
 * Every AAP 0.9.3 success assertion, against the job the worker completed.
 *
 * Reached when the capability probes report the export path usable. With the
 * shipped worker and the installed mongoose 6 they do not, and
 * `assertBulkExportBlocked` asserts the measured blocked outcome instead -
 * which is a different expectation set, not a weaker one. This block was
 * verified end to end through `--worker-module` against a scratch
 * mongoose-6-compatible copy of the worker, so it is neither unexercised nor
 * hypothetical.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertSuccessCompleted(ctx, ledger, outcome) {
  var expectedCount = ctx.expectedTrinkets.length;
  var bucket = ctx.config.aws.buckets.exports;
  var doc = outcome.doc;
  var filename = doc && doc.s3Key ? path.basename(doc.s3Key) : null;
  var stored = null;

  await ledger.check('success: the processor completed and job.remove() ran ' +
    '(:93-95)', function() {
    assert.strictEqual(outcome.record.failedCount, 0,
      'the job must not have failed; error was ' +
      (outcome.record.error && outcome.record.error.message));
    assert.strictEqual(outcome.record.completedCount, 1,
      'the completed event must be emitted once');
    assert.strictEqual(outcome.record.removeCalls, 1,
      'the completed handler calls job.remove() exactly once');
  });

  await ledger.check('success: the status sequence is processing -> completed ' +
    '(:132, :169-175)', function() {
      assert.deepStrictEqual(statusSequence(outcome), ['processing', 'completed'],
        'the recorded updates carrying a `status` must be exactly those two, ' +
        'in that order; got ' + JSON.stringify(outcome.updates));
    });

  await ledger.check('success: four updates, since ' + expectedCount +
    ' trinkets is below the every-tenth progress update at :251', function() {
      assert.strictEqual(outcome.updates.length, 4,
        'expected {status:processing}, {progress.total, trinketCount}, ' +
        '{progress.processed, progress.failed} and the completion update; got ' +
        JSON.stringify(outcome.updates));
      assert.deepStrictEqual(outcome.updates[1].update, {
        'progress.total' : expectedCount,
        trinketCount     : expectedCount
      }, 'the count update at :148-151');
      assert.deepStrictEqual(outcome.updates[2].update, {
        'progress.processed' : expectedCount,
        'progress.failed'    : 0
      }, 'the final progress update at :277-280');
      assert.deepStrictEqual(Object.keys(outcome.updates[3].update).sort(),
        ['downloadUrl', 'expiresAt', 'fileSize', 's3Key', 'status'],
        'the completion update at :169-175 writes exactly those five fields');
    });

  await ledger.check('success: the document carries the seeded trinket count ' +
    '(' + expectedCount + ', per owner, not the fixture\'s 7)', function() {
      assert.ok(doc, 'the Export document must exist');
      assert.strictEqual(doc.status, 'completed', 'status');
      assert.strictEqual(doc.progress.total, expectedCount, 'progress.total');
      assert.strictEqual(doc.trinketCount, expectedCount, 'trinketCount');
      assert.strictEqual(doc.progress.processed, expectedCount,
        'progress.processed');
      assert.strictEqual(doc.progress.failed, 0, 'progress.failed');
      assert.strictEqual(doc.errorMessage, undefined,
        'no errorMessage on a completed export');
    });

  await ledger.check('success: the filename, s3Key and downloadUrl are the ' +
    'exact strings :118-126 and :402 build', function() {
      assert.ok(filename, 'the document must carry an s3Key');
      assert.ok(/^trinket-export-[0-9a-f]{12}\.zip$/.test(filename),
        'the filename is `trinket-export-` + 12 hex characters + `.zip`; got ' +
        JSON.stringify(filename));
      assert.strictEqual(doc.s3Key,
        'exports/' + outcome.userId + '/' + filename, 's3Key');
      assert.strictEqual(doc.downloadUrl, bucket.host + '/' + doc.s3Key,
        'downloadUrl is config.aws.buckets.exports.host + \'/\' + s3Key');
    });

  await ledger.check('success: expiresAt is three days out (EXPORT_EXPIRY_DAYS ' +
    'at :33, applied at :162-163)', function() {
      var expected = new Date(outcome.startedAt || Date.now());
      var actual   = new Date(doc.expiresAt).getTime();
      var driftMs;

      expected.setDate(expected.getDate() + 3);
      driftMs = Math.abs(actual - expected.getTime());

      assert.ok(driftMs < 300000,
        'expiresAt must be within five minutes of the job\'s start plus three ' +
        'days; drift was ' + driftMs + 'ms (expiresAt ' + doc.expiresAt + ')');
    });

  await ledger.check('success: the object is in the store with the archive\'s ' +
    'own byte length, content type and attachment disposition (:390-397)',
    function() {
      var puts = outcome.awsCalls.filter(function(call) {
        return call.operation === 'putObject';
      });

      assert.strictEqual(puts.length, 1, 'exactly one upload; got ' +
        JSON.stringify(puts));
      assert.strictEqual(puts[0].bucket, bucket.name, 'Bucket');
      assert.strictEqual(puts[0].key, doc.s3Key, 'Key');
      assert.strictEqual(puts[0].contentType, 'application/zip', 'ContentType');
      assert.strictEqual(puts[0].contentDisposition,
        'attachment; filename="' + filename + '"', 'ContentDisposition');

      stored = awsFixture.get(bucket.name, doc.s3Key);

      assert.ok(stored, 'the object must be readable back from the fixture');
      assert.strictEqual(stored.contentType, 'application/zip',
        'the stored content type');
      assert.strictEqual(stored.contentDisposition,
        'attachment; filename="' + filename + '"',
        'the stored content disposition');
      assert.strictEqual(doc.fileSize, stored.body.length,
        'fileSize at :175 is fs.statSync(tempFile).size, which must equal the ' +
        'uploaded body length');
    });

  await ledger.check('success: the asset was fetched from the userassets ' +
    'bucket by the basename of its url (:60-68, :323-326)', function() {
      var gets = outcome.awsCalls.filter(function(call) {
        return call.operation === 'getObject';
      });
      var descriptors = ctx.seed.storage({ exports : false });

      assert.strictEqual(gets.length, 1,
        'one asset-bearing trinket is seeded, so exactly one getObject; got ' +
        JSON.stringify(gets));
      assert.strictEqual(gets[0].bucket,
        ctx.config.aws.buckets.userassets.name, 'the assets bucket');
      assert.strictEqual(gets[0].key, descriptors.userAsset.key,
        'the key is path.basename(parseLegacy(asset.url).pathname)');
    });

  await ledger.check('success: the archive satisfies storage.js\'s ' +
    'assertArchiveLayout, contents included', function() {
      var result;

      assert.ok(stored, 'the stored archive is needed for this assertion');

      result = ctx.storage.assertArchiveLayout(stored.body, {
        trinkets       : ctx.expectedTrinkets,
        failedTrinkets : 0
      }, { appRoot : ctx.options.appRoot });

      assert.strictEqual(result.manifest.totalTrinkets, expectedCount,
        'the manifest\'s totalTrinkets');
      assert.strictEqual(result.manifest.failedTrinkets, 0,
        'no trinket may fail: an asset that failed to download is swallowed at ' +
        ':330-333, but a trinket that failed is counted at :257');

      outcome.archiveEntries = result.entries.slice().sort();
    });

  await ledger.check('success: one `export-ready` mail to the owner (:409-421)',
    function() {
      assert.strictEqual(outcome.mail.length, 1,
        'exactly one mail; got ' + JSON.stringify(outcome.mail.map(function(c) {
          return c.type;
        })));
      assert.strictEqual(outcome.mail[0].to, ctx.seed.credentials.user.email,
        'the recipient is the export owner\'s email');
      assert.strictEqual(outcome.mail[0].subject,
        'Your Trinket Export is Ready', 'the subject at :409');
      assert.strictEqual(outcome.mail[0].type, 'export-ready',
        'the type at :421');
      assert.strictEqual(typeof outcome.mail[0].options.html, 'string',
        'the body is the rendered template from :419');
      assert.ok(outcome.mail[0].options.html.length > 0,
        'the rendered body must not be empty');
    });

  await ledger.check('success: the temporary file /tmp/' + filename +
    ' is gone (:184)', async function() {
      var remaining = await pollFor(function() {
        return fs.existsSync('/tmp/' + filename) ? false : [];
      }, SETTLE_TIMEOUT_MS, 'the temporary file to be unlinked');

      assert.deepStrictEqual(remaining, [], 'unreachable');
      assert.deepStrictEqual(listWorkerTempFiles().filter(function(name) {
        return outcome.tempBefore.indexOf(name) === -1;
      }), [], 'no other temporary file may be left behind either');
    });
}

// ---------------------------------------------------------------------------
// Assertions - the blocked bulk export
// ---------------------------------------------------------------------------

/**
 * The measured outcome of ANY bulk-export job while BLOCKER-Q stands.
 *
 * Every bulk-export job fails at the FIRST database call - :132's
 * `Q.nsend(..., 'findByIdAndUpdate', exportId, {status: 'processing'})` - so
 * none of them reaches the user lookup, the archive, the upload or the mail.
 * That makes this one expectation set for all three, and it is a real one:
 *
 *   * the update at :132 LANDS before the rejection, because q's second
 *     execution is what throws and the first has already written, so the
 *     document does pass through `processing`;
 *   * the `.fail` chain at :193-197 then writes `status: 'failed'` and
 *     `errorMessage`, and its own `Q.nsend` rejects in turn, which is why
 *     :198-200's failure mail is NOT reached even when a user was resolved;
 *   * the failed handler at :86-89 writes the same pair independently;
 *   * nothing is uploaded, no mail is sent, and no temporary file is created,
 *     because :133 is never reached.
 *
 * A worker that regressed in some other way fails these checks, which is what
 * makes a blocked run an assertion rather than a skip.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertBulkExportBlocked(ctx, ledger, outcome) {
  var expectedMessage = /Query was already executed/;

  await ledger.check(outcome.name + ' [blocked]: the processor rejected with ' +
    'the measured query error', function() {
      assert.strictEqual(outcome.record.completedCount, 0,
        'no bulk-export job can complete while BLOCKER-Q stands');
      assert.strictEqual(outcome.record.failedCount, 1, 'one failure');
      assert.ok(outcome.record.error, 'an error must be carried');
      assert.ok(expectedMessage.test(outcome.record.error.message),
        'expected mongoose\'s double-execution error, which is what q 1.0.1 ' +
        'ninvoke produces by assimilating the thenable Query :132 returns; ' +
        'got ' + JSON.stringify(outcome.record.error.message));
    });

  await ledger.check(outcome.name + ' [blocked]: the status update at :132 ' +
    'landed before the rejection', function() {
      assert.strictEqual(statusSequence(outcome)[0], 'processing',
        'the first recorded status write must still be `processing`: q throws ' +
        'on the SECOND execution, so the first one already wrote. Got ' +
        JSON.stringify(outcome.updates));
    });

  if (outcome.spec.exportId === 'missingExport') {
    // The late-failure job addresses the seeder's absent export id on purpose,
    // so there is no document to carry a status - and none may be created,
    // since neither :193's update nor :87's upserts.
    await ledger.check(outcome.name + ' [blocked]: no document was created for ' +
      'the absent export id', async function() {
        var found = await ctx.ExportModel.findById(outcome.exportId).exec();

        assert.strictEqual(outcome.doc, null,
          'the fixture id belongs to no document, which is the fixture');
        assert.strictEqual(found, null,
          'findByIdAndUpdate does not upsert, so neither the .fail chain at ' +
          ':193 nor the failed handler at :87 may have created one');
      });
  }
  else {
    await ledger.check(outcome.name + ' [blocked]: status and errorMessage are ' +
      'persisted (:193-197 and :86-89)', function() {
        assert.ok(outcome.doc, 'the Export document must exist for this job');
        assert.strictEqual(outcome.doc.status, 'failed', 'status');
        assert.ok(expectedMessage.test(outcome.doc.errorMessage || ''),
          'the persisted errorMessage must be the thrown message; got ' +
          JSON.stringify(outcome.doc.errorMessage));
        assert.strictEqual(outcome.doc.progress.total, 0,
          'the count update at :148 is never reached, so progress.total stays 0');
      });
  }

  await assertFailedHandlerRan(ctx, ledger, outcome);
  await assertNoExternalEffects(ctx, ledger, outcome);
}

// ---------------------------------------------------------------------------
// Assertions - the three failure jobs, unblocked
// ---------------------------------------------------------------------------

/**
 * The `User not found` job: the failure edge with NO user resolved.
 *
 * :140 throws before `user` is ever assigned, so :198-200's `if (user)` guard
 * is false and NO failure mail is sent. That is the edge R-e binds here, and it
 * is asserted as an absence rather than assumed.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertMissingUserJob(ctx, ledger, outcome) {
  await ledger.check('missing-user: rejected with `User not found` (:138-141)',
    function() {
      assert.strictEqual(outcome.record.failedCount, 1, 'one failure');
      assert.strictEqual(outcome.record.error.message, 'User not found',
        'the exact message thrown at :140');
    });

  await ledger.check('missing-user: the document carries status `failed` and ' +
    'that exact errorMessage (:193-197)', function() {
      assert.ok(outcome.doc, 'the Export document must exist');
      assert.strictEqual(outcome.doc.status, 'failed', 'status');
      assert.strictEqual(outcome.doc.errorMessage, 'User not found',
        'errorMessage is `err.message` verbatim');
      assert.deepStrictEqual(statusSequence(outcome), ['processing', 'failed',
        'failed'], 'processing at :132, then the same failure written twice - ' +
        'once by the .fail chain at :193 and once by the failed handler at ' +
        ':86 - which is baseline and is preserved. Got ' +
        JSON.stringify(statusSequence(outcome)));
    });

  await ledger.check('missing-user: NO failure mail, because no user was ' +
    'resolved (:198-200)', function() {
      assert.deepStrictEqual(outcome.mail, [],
        'the `if (user)` guard is false on this edge, so nothing is sent');
    });

  await assertFailedHandlerRan(ctx, ledger, outcome);
  await assertNoExternalEffects(ctx, ledger, outcome);
}

/**
 * The late-failure job: the failure edge WITH a user resolved.
 *
 * One job cannot assert both halves of the mail edge, which is why there are
 * two. `missing-user` fails before a user exists and must send nothing;
 * this one resolves the user, builds and uploads the archive, and then throws
 * in `sendCompletionEmail` because :169-175's `findByIdAndUpdate` returns null
 * for an Export id that belongs to no document and :413 dereferences
 * `exportRecord.progress`. So this is the case where the failure mail IS sent
 * (:198-200) and where a temporary file EXISTS and is cleaned (:190).
 *
 * The absent id is the seeder's `missingExport`, whose absence is itself the
 * fixture; nothing is created for it, and nothing may be created BY it, since
 * `findByIdAndUpdate` does not upsert.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertLateFailureJob(ctx, ledger, outcome) {
  await ledger.check('late-failure: rejected after the upload, on the null ' +
    'export record (:176, :413)', function() {
      assert.strictEqual(outcome.record.failedCount, 1, 'one failure');
      assert.ok(/progress/.test(outcome.record.error.message),
        'the throw is a dereference of `exportRecord.progress` on a null ' +
        'record; got ' + JSON.stringify(outcome.record.error.message));
    });

  await ledger.check('late-failure: the archive WAS uploaded before the throw',
    function() {
      var puts = outcome.awsCalls.filter(function(call) {
        return call.operation === 'putObject';
      });

      assert.strictEqual(puts.length, 1,
        'the upload at :390-397 precedes the completion mail, so it must have ' +
        'happened; got ' + JSON.stringify(puts));
      assert.strictEqual(puts[0].bucket, ctx.config.aws.buckets.exports.name,
        'Bucket');
    });

  await ledger.check('late-failure: the failure mail IS sent, because a user ' +
    'was resolved (:198-200, :424-434)', function() {
      assert.strictEqual(outcome.mail.length, 1,
        'exactly one mail; got ' + JSON.stringify(outcome.mail.map(function(c) {
          return c.type;
        })));
      assert.strictEqual(outcome.mail[0].to, ctx.seed.credentials.user.email,
        'the recipient');
      assert.strictEqual(outcome.mail[0].subject, 'Your Trinket Export Failed',
        'the subject at :425');
      assert.strictEqual(outcome.mail[0].type, 'export-failed', 'the type');
      assert.strictEqual(typeof outcome.mail[0].options.html, 'string',
        'the rendered body from :432');
    });

  await ledger.check('late-failure: the temporary file existed and was ' +
    'unlinked (:190)', async function() {
      var remaining = await pollFor(function() {
        var extra = listWorkerTempFiles().filter(function(name) {
          return outcome.tempBefore.indexOf(name) === -1;
        });

        return extra.length === 0 ? [] : false;
      }, SETTLE_TIMEOUT_MS, 'the temporary file to be unlinked');

      assert.deepStrictEqual(remaining, [], 'nothing may be left in /tmp');
    });

  await ledger.check('late-failure: no document was created for the absent ' +
    'export id', async function() {
      var found = await ctx.ExportModel.findById(ctx.seed.ids.missingExport)
        .exec();

      assert.strictEqual(found, null,
        'findByIdAndUpdate does not upsert, so the absent fixture id must ' +
        'still resolve to nothing');
    });

  await assertFailedHandlerRan(ctx, ledger, outcome);
}

/**
 * The unknown-action job: the processor's own rejection branch.
 *
 * :98-105 rejects before `processBulkExport` is entered, so the `.fail` chain
 * never runs and the failed handler at :86-89 is the ONLY writer of `status`
 * and `errorMessage`. That isolation is the point: it is the one job that
 * asserts the handler's persistence on its own, and it is reachable whatever
 * the capability probes say, because it touches no database call inside the
 * chain.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertUnknownActionJob(ctx, ledger, outcome) {
  await ledger.check('unknown-action: rejected by the processor branch at ' +
    ':103-105', function() {
      assert.strictEqual(outcome.record.completedCount, 0, 'no completion');
      assert.strictEqual(outcome.record.failedCount, 1, 'one failure');
      assert.strictEqual(outcome.record.error.message,
        'Unknown action: ' + outcome.spec.action,
        'the exact message the branch builds');
    });

  await ledger.check('unknown-action: the failed handler is the only writer, ' +
    'and it wrote status and errorMessage (:86-89)', async function() {
      var doc = await pollFor(async function() {
        var found = await ctx.ExportModel.findById(outcome.exportId).exec();

        return found && found.status === 'failed' ? found : false;
      }, SETTLE_TIMEOUT_MS, 'the failed handler\'s fire-and-forget update');

      assert.strictEqual(doc.status, 'failed', 'status');
      assert.strictEqual(doc.errorMessage,
        'Unknown action: ' + outcome.spec.action, 'errorMessage');
      assert.strictEqual(doc.progress.total, 0,
        'the export chain never ran, so progress is untouched');
      assert.strictEqual(outcome.updates.length, 1,
        'exactly one update, from the handler; the chain\'s writers are ' +
        'unreachable on this path. Got ' + JSON.stringify(outcome.updates));
    });

  await assertFailedHandlerRan(ctx, ledger, outcome);
  await assertNoExternalEffects(ctx, ledger, outcome);
}

// ---------------------------------------------------------------------------
// Assertions - isolation
// ---------------------------------------------------------------------------

/**
 * Asserts that nothing was written outside the fixture and the isolated
 * database.
 *
 * Five mechanical claims rather than one hopeful one: the connection is the
 * per-run database, the object store is inside the run directory, every S3
 * call went to a CONFIGURED bucket through the fixture, the fixture recorded no
 * internal fault, and `/tmp` holds no export archive. The mail claim is
 * structural - `fixtures/mail.js` replaced `send`, so a captured call is proof
 * that SMTP was not attempted.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @returns {Promise<undefined>}
 */
async function assertIsolation(ctx, ledger) {
  await ledger.check('isolation: the worker is connected to the per-run ' +
    'database', function() {
      assert.strictEqual(ctx.mongoose.connection.name, ctx.address.database,
        'config/db.js must have connected to the database ' +
        'test/parity/mongo.js published');
    });

  await ledger.check('isolation: the object store is inside the run directory',
    function() {
      var root = awsFixture.status().root;

      assert.strictEqual(root, ctx.layout.s3Root, 'the fixture store root');
      assert.strictEqual(root.indexOf(ctx.layout.runDir), 0,
        'the store must be under ' + ctx.layout.runDir);
    });

  await ledger.check('isolation: every S3 call went to a configured bucket, ' +
    'through the fixture', function() {
      var configured = Object.keys(ctx.config.aws.buckets).map(function(key) {
        return ctx.config.aws.buckets[key].name;
      });
      var stray = awsFixture.calls().filter(function(call) {
        return call.bucket !== undefined && call.bucket !== null &&
               configured.indexOf(call.bucket) === -1;
      });

      assert.deepStrictEqual(stray, [],
        'a call to an unconfigured bucket would mean the worker built a bucket ' +
        'name from something other than configuration');
      assert.strictEqual(awsFixture.status().patched, true,
        'the fixture must still be the installed AWS.S3');
    });

  await ledger.check('isolation: the S3 fixture recorded no internal fault',
    function() {
      assert.deepStrictEqual(awsFixture.errors(), [],
        'a fixture error means an unusable store, a rejected seed entry, or a ' +
        'client call the real SDK would not have made');
    });

  await ledger.check('isolation: the mail fixture is installed on the very ' +
    'module the worker calls, so no SMTP was attempted', function() {
      var status = mailFixture.status();
      var mailer = requireApp(ctx.options.appRoot, 'lib/util/mailer');

      assert.strictEqual(status.installed, true, 'installed');
      assert.strictEqual(status.diagnostic, null, 'no diagnostic');

      // Identity, not presence. The worker calls `mailer.send` on the module
      // instance IT resolved (:421 and :434), so a fixture installed on some
      // other copy of that module would leave the genuine transport in the
      // worker's path while still reporting itself installed - which is the
      // most plausible silent failure of this whole design.
      assert.strictEqual(mailer.send.parityFixture, 'mail',
        'lib/util/mailer resolved from ' + ctx.options.appRoot + ' must be ' +
        'carrying the fixture\'s `send`');
      assert.strictEqual(typeof mailer.isConfigured, 'function',
        'the fixture must not have disturbed the rest of the module surface');
    });

  await ledger.check('isolation: /tmp holds no export archive', function() {
    assert.deepStrictEqual(listWorkerTempFiles(), [],
      'every temporary file the worker created must have been unlinked; ' +
      'lib/workers/exports.js:125 writes to /tmp directly, so TMPDIR does not ' +
      'contain this');
  });
}

// ---------------------------------------------------------------------------
// The warning stream
// ---------------------------------------------------------------------------

/**
 * Splits captured stderr into warning blocks and classifies each one.
 *
 * A block is a warning line plus the indented stack lines
 * `--trace-deprecation` puts under it. The harness's own prefixed lines and
 * the sibling tools' are excluded by prefix, since they are commentary rather
 * than notices.
 *
 * Classification is against WARNING_ALLOWANCES and nothing else: a block that
 * matches no entry is UNEXPECTED and fails the run. That is what keeps the
 * single allowed deviation from becoming a habit.
 *
 * @param {string} stderr
 * @returns {Object} `{blocks, allowed, unexpected}`
 */
function classifyWarnings(stderr) {
  var lines  = String(stderr || '').split('\n');
  var blocks = [];
  var current = null;
  var i;
  var line;

  function isNotice(text) {
    return /^\(node:\d+\)/.test(text) ||
           /^\[MONGOOSE\]/.test(text) ||
           /^Warning:/.test(text) ||
           /DeprecationWarning|ExperimentalWarning/.test(text) ||
           /maintenance mode/i.test(text);
  }

  for (i = 0; i < lines.length; i++) {
    line = lines[i];

    if (line.indexOf(LOG_PREFIX) === 0 || line.indexOf('[parity:') === 0) {
      current = null;
      continue;
    }

    if (isNotice(line)) {
      current = { text : line, lines : [line] };
      blocks.push(current);
      continue;
    }

    if (current && /^\s+/.test(line) && line.trim().length > 0) {
      current.lines.push(line);
      current.text += '\n' + line;
      continue;
    }

    current = null;
  }

  blocks.forEach(function(block) {
    var allowance = null;

    WARNING_ALLOWANCES.forEach(function(entry) {
      if (allowance === null && entry.match.test(block.text)) {
        allowance = entry;
      }
    });

    block.allowance = allowance ? allowance.id : null;
    block.summary   = block.lines[0].trim();
  });

  return {
    blocks     : blocks,
    allowed    : blocks.filter(function(block) {
      return block.allowance !== null;
    }),
    unexpected : blocks.filter(function(block) {
      return block.allowance === null;
    })
  };
}

/**
 * Asserts the zero-warning bar with its one enumerated allowance.
 *
 * AAP 0.8's requirement is zero deprecation warnings across the entire running
 * application, and the pass condition in 0.9.3 is "no warning or deprecation
 * notice attributable to the application's own source or to any dependency
 * this plan retains". Measured, this run emits exactly one: DEP0005 from
 * `compress-commons`, reached through the retained `archiver` 2.1.1. It is
 * allowed by name, printed as a deviation, and everything else fails.
 *
 * @param {Object} ledger
 * @param {Object} classified
 * @returns {Promise<undefined>}
 */
async function assertWarnings(ledger, classified) {
  classified.allowed.forEach(function(block) {
    var entry = WARNING_ALLOWANCES.filter(function(candidate) {
      return candidate.id === block.allowance;
    })[0];

    note('DEVIATION (allowed warning) ' + block.allowance + ': ' +
      block.summary);
    note('  attributed to: ' + entry.attributed);
    note('  decision: ' + entry.decision);
  });

  await ledger.check('warnings: nothing beyond the enumerated allowance',
    function() {
      var summaries = classified.unexpected.map(function(block) {
        return block.summary;
      });

      assert.deepStrictEqual(summaries, [],
        'an unallowed warning or deprecation notice was emitted under ' +
        '--pending-deprecation --trace-deprecation: ' +
        JSON.stringify(summaries));
    });
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Puts everything back and closes everything this harness opened.
 *
 * Order matters: the instrumentation is removed before the resources it
 * observed are closed, so nothing is recorded during teardown; the queue is
 * closed through the application's own `closeAll` (lib/util/queues.js:169-175)
 * rather than by reaching into the cache; and the in-memory server is stopped
 * last, after the client that talks to it is disconnected.
 *
 * Every step is guarded: a teardown that threw would lose the report, and the
 * report is the deliverable.
 *
 * @param {Object} ctx
 * @returns {Promise<Object[]>} One entry per step, with its outcome.
 */
async function teardown(ctx) {
  var steps = [];

  async function step(name, body) {
    try {
      await body();
      steps.push({ name : name, ok : true, message : null });
    }
    catch (err) {
      steps.push({
        name    : name,
        ok      : false,
        message : (err && err.message) || String(err)
      });
      note('teardown: ' + name + ' failed: ' + ((err && err.message) || err));
    }
  }

  await step('restore the update recorder', function() {
    if (ctx.updates) {
      ctx.updates.restore();
    }
  });

  await step('restore the queue instance', function() {
    if (ctx.patch) {
      ctx.patch.restore();
    }
  });

  await step('flush the fixture evidence logs', function() {
    if (awsFixture) {
      awsFixture.flush();
    }

    if (mailFixture) {
      mailFixture.flush();
    }
  });

  await step('restore the fixtures', function() {
    if (awsFixture) {
      awsFixture.restore();
    }

    if (mailFixture) {
      mailFixture.restore();
    }
  });

  await step('close every queue (lib/util/queues.js:169-175)', async function() {
    if (ctx.queues) {
      await withTimeout(Promise.resolve(ctx.queues.closeAll()), SETTLE_TIMEOUT_MS,
        'closeAll()');
    }
  });

  await step('disconnect mongoose', async function() {
    if (ctx.mongoose) {
      await withTimeout(Promise.resolve(ctx.mongoose.disconnect()),
        CONNECT_TIMEOUT_MS, 'mongoose.disconnect()');
    }
  });

  await step('stop the in-memory MongoDB', async function() {
    await withTimeout(Promise.resolve(mongo.stop()), CONNECT_TIMEOUT_MS,
      'mongo.stop()');
  });

  await step('restore the working directory', function() {
    if (ctx.cwdBefore) {
      process.chdir(ctx.cwdBefore);
    }
  });

  return steps;
}

/**
 * The open-handle inventory, by type, classified against HANDLE_ALLOWANCES.
 *
 * @returns {Object} `{counts, allowed, unexpected}`
 */
function inspectHandles() {
  var counts = {};
  var stdio  = {};
  var stdioTypes = ['PipeWrap', 'TTYWrap'];
  var allowedTypes = HANDLE_ALLOWANCES.map(function(entry) {
    return entry.type;
  }).filter(function(type) {
    return stdioTypes.indexOf(type) === -1;
  });

  process.getActiveResourcesInfo().forEach(function(type) {
    if (stdioTypes.indexOf(type) > -1) {
      stdio[type] = (stdio[type] || 0) + 1;
      return;
    }

    counts[type] = (counts[type] || 0) + 1;
  });

  return {
    counts     : counts,
    stdio      : stdio,
    allowed    : Object.keys(counts).filter(function(type) {
      return allowedTypes.indexOf(type) > -1;
    }),
    unexpected : Object.keys(counts).filter(function(type) {
      return allowedTypes.indexOf(type) === -1;
    })
  };
}

/**
 * Gives in-flight work a bounded chance to finish, then reports the inventory.
 *
 * "No open handles" is a claim about the steady state, and two of the things
 * teardown triggers are asynchronous filesystem work rather than open
 * resources: chokidar's directory walk and the memory server's removal of its
 * own data directory. Both show up as `FSReqCallback` for a few milliseconds -
 * measured, and measured to disappear on its own. Waiting a bounded moment for
 * them is therefore accurate rather than lenient: anything still present when
 * the bound expires is genuinely held, and it fails.
 *
 * @param {number} ms
 * @returns {Promise<Object>} The inventory from inspectHandles.
 */
async function settleHandles(ms) {
  var handles  = inspectHandles();
  var deadline = Date.now() + ms;

  while (handles.unexpected.length > 0 && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS * 5);
    handles = inspectHandles();
  }

  return handles;
}

/**
 * Asserts a clean close, bounded by the one handle allowance.
 *
 * The process cannot self-exit here and the reason is measured and attributed:
 * `lib/util/nunjucks.js` configures nunjucks with `watch: config.isDev ||
 * config.isTest`, so under NODE_ENV=test chokidar watches every directory under
 * `config.app.templates`, and nunjucks 3.2.4 keeps the FSWatcher in a
 * constructor-local variable with no `watcher` property on the loader - so no
 * caller can close it. The inventory is therefore reported and asserted to
 * contain NOTHING BEYOND that allowance, which is what keeps a genuinely leaked
 * connection, queue, socket or timer visible. `run` then exits deliberately
 * with the run's own code; it never exits 0 on a timeout.
 *
 * @param {Object} ledger
 * @param {Object} handles
 * @returns {Promise<undefined>}
 */
async function assertCleanClose(ledger, handles) {
  handles.allowed.forEach(function(type) {
    var entry = HANDLE_ALLOWANCES.filter(function(candidate) {
      return candidate.type === type;
    })[0];

    note('DEVIATION (allowed handles) ' + entry.id + ': ' + handles.counts[type] +
      ' x ' + type);
    note('  attributed to: ' + entry.attributed);
    note('  decision: ' + entry.decision);
  });

  await ledger.check('clean close: no open handle beyond the enumerated ' +
    'allowance', function() {
      assert.deepStrictEqual(handles.unexpected, [],
        'after closeAll() and mongoose.disconnect() the only handles left may ' +
        'be the allowed ones; ' + JSON.stringify(handles.counts) + ' remains. ' +
        'A Timeout here is usually an uncleared timer, a TCP or Socket handle ' +
        'an unclosed connection.');
    });
}

// ---------------------------------------------------------------------------
// The evidence artifact
// ---------------------------------------------------------------------------

/**
 * The comparable projection of one job's outcome.
 *
 * Deliberately not the raw outcome: a mongoose document and an Error do not
 * survive JSON, and the artifact is something a reviewer diffs. Every field
 * here is either exactly comparable or is normalized by name in VOLATILE.
 *
 * @param {Object} outcome
 * @param {string} expectation Which expectation set was applied.
 * @returns {Object}
 */
function projectJob(outcome, expectation) {
  var doc = outcome.doc;

  return {
    name           : outcome.name,
    expectation    : expectation,
    action         : outcome.data.action,
    exportId       : String(outcome.exportId),
    userId         : String(outcome.userId),
    jobId          : outcome.jobId,
    durationMs     : outcome.durationMs,
    completedCount : outcome.record.completedCount,
    failedCount    : outcome.record.failedCount,
    removeCalls    : outcome.record.removeCalls,
    error          : outcome.record.error
      ? {
        name    : outcome.record.error.name || 'Error',
        message : outcome.record.error.message || String(outcome.record.error)
      }
      : null,
    statusSequence : statusSequence(outcome),
    updates        : outcome.updates,
    loggedJobId    : loggedFailedJobId(outcome),
    document       : doc
      ? {
        status       : doc.status,
        errorMessage : doc.errorMessage === undefined ? null : doc.errorMessage,
        trinketCount : doc.trinketCount === undefined ? null : doc.trinketCount,
        fileSize     : doc.fileSize === undefined ? null : doc.fileSize,
        s3Key        : doc.s3Key === undefined ? null : doc.s3Key,
        downloadUrl  : doc.downloadUrl === undefined ? null : doc.downloadUrl,
        expiresAt    : doc.expiresAt ? new Date(doc.expiresAt).toISOString() : null,
        progress     : doc.progress
          ? {
            total     : doc.progress.total,
            processed : doc.progress.processed,
            failed    : doc.progress.failed
          }
          : null
      }
      : null,
    mail : outcome.mail.map(function(call) {
      return {
        to         : call.to,
        subject    : call.subject,
        type       : call.type,
        htmlLength : call.options && typeof call.options.html === 'string'
          ? call.options.html.length
          : null
      };
    }),
    s3 : outcome.awsCalls.map(function(call) {
      return {
        operation          : call.operation,
        bucket             : call.bucket,
        key                : call.key,
        contentType        : call.contentType === undefined
          ? null
          : call.contentType,
        contentDisposition : call.contentDisposition === undefined
          ? null
          : call.contentDisposition,
        bodyBytes          : call.bodyBytes === undefined ? null : call.bodyBytes,
        outcome            : call.outcome
      };
    }),
    archiveEntries : outcome.archiveEntries || null
  };
}

/**
 * Scrubs the values that move between two runs of identical behaviour.
 *
 * Two passes and both are enumerated. Keys named in VOLATILE are removed; the
 * generated substrings below are rewritten in place, because a value like the
 * S3 key carries BOTH structure worth comparing (`exports/<userId>/`) and a
 * clock-derived hash that cannot be. Rewriting keeps the structure in the
 * comparison, where deleting the key would hide it.
 *
 * Nothing joins either list because it "differed": the export filename is
 * sha1(userId + Date.now()) at :118-124, the job id is Date.now() plus
 * Math.random in lib/util/queues.js:21, the database name and the run
 * directory are generated per run, and the port is the in-memory server's.
 * Each is still asserted for SHAPE by the checks above.
 *
 * @param {*} value
 * @returns {*} A normalized deep copy.
 */
function normalizeEvidence(value) {
  var rewrites = [
    [/trinket-export-[0-9a-f]{12}\.zip/g, 'trinket-export-<hash>.zip'],
    [/parity-worker-\d+-[0-9a-f]{8}/g,    'parity-worker-<run>'],
    [/parity_\d+_[a-z0-9]+_[0-9a-f]+/g,   'parity_<database>'],
    [/(mongodb:\/\/[^:\/]+):\d+/g,        '$1:<port>'],
    [/\b\d{13}-[a-z0-9]{6,12}\b/g,        '<jobId>'],
    [/"?[0-9a-f]{32}"?(?=\s*$)/g,         '<md5>'],
    [/\(node:\d+\)/g,                    '(node:<pid>)']
  ];

  function scrubString(text) {
    var out = text;

    rewrites.forEach(function(pair) {
      out = out.replace(pair[0], pair[1]);
    });

    return out;
  }

  function walk(node) {
    var out;

    if (typeof node === 'string') {
      return scrubString(node);
    }

    if (Array.isArray(node)) {
      return node.map(walk);
    }

    if (node && typeof node === 'object') {
      out = {};

      Object.keys(node).forEach(function(key) {
        if (VOLATILE.indexOf(key) > -1) {
          return;
        }

        out[key] = walk(node[key]);
      });

      return out;
    }

    return node;
  }

  return walk(value);
}

/**
 * The comparable projection of one artifact: the COMPARABLE sections only.
 *
 * @param {Object} evidence
 * @returns {Object}
 */
function projectComparable(evidence) {
  var out = {};

  COMPARABLE.forEach(function(section) {
    if (evidence && Object.prototype.hasOwnProperty.call(evidence, section)) {
      out[section] = evidence[section];
    }
  });

  return out;
}

/**
 * Deep-compares two normalized artifacts and lists the differences.
 *
 * The determinism check AAP 0.9.6 asks for, as a mechanical operation:
 *
 *   node test/parity/worker.js --out a.json
 *   node test/parity/worker.js --out b.json --compare a.json
 *
 * The ZIP bytes themselves are not compared, and that is deliberate: an
 * archive embeds modification timestamps, so two runs of identical behaviour
 * produce different bytes. The archive's ENTRY LIST and each entry's CONTENT
 * are compared instead, by `assertArchiveLayout` during the run and by the
 * entry list here.
 *
 * @param {*} actual
 * @param {*} expected
 * @returns {Object[]} `{path, actual, expected}` per difference.
 */
function compareEvidence(actual, expected) {
  var differences = [];

  function describe(value) {
    if (value === undefined) {
      return '<absent>';
    }

    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    return JSON.stringify(value);
  }

  function walk(a, b, at) {
    var keys;

    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
        differences.push({ path : at, actual : describe(a), expected : describe(b) });
        return;
      }

      a.forEach(function(entry, index) {
        walk(entry, b[index], at + '[' + index + ']');
      });

      return;
    }

    if (a && b && typeof a === 'object' && typeof b === 'object') {
      keys = Object.keys(a).concat(Object.keys(b)).filter(
        function(key, index, all) {
          return all.indexOf(key) === index;
        });

      keys.forEach(function(key) {
        walk(a[key], b[key], at ? at + '.' + key : key);
      });

      return;
    }

    if (a !== b) {
      differences.push({ path : at, actual : describe(a), expected : describe(b) });
    }
  }

  walk(actual, expected, '');

  return differences;
}

// ---------------------------------------------------------------------------
// Notes owed elsewhere
// ---------------------------------------------------------------------------

/**
 * The measurements this run owes `docs/baseline-parity.md`.
 *
 * Emitted rather than written: that document is owned by another lane and this
 * file edits no documentation. Each entry is a fact a reviewer of the parity
 * evidence needs and cannot derive from a pass or a fail - most importantly the
 * LIMIT of what this harness proves, because overstating it would be worse
 * than the gap AAP 0.9.6 already records.
 *
 * @param {Object} ctx
 * @param {Object} evidence
 * @returns {string[]}
 */
function buildNotesOwed(ctx, evidence) {
  var notes = [];
  var capabilities = evidence.capabilities;
  var templates    = evidence.templates;

  notes.push('Bull semantics: the completed/failed/error events in this run ' +
    'are HARNESS-EMITTED. lib/util/queues.js selects its in-memory queue when ' +
    'Redis is disabled and that queue\'s `on` is a no-op, so the events are ' +
    'produced by a run-time patch on the queue INSTANCE. This proves the ' +
    'handler bodies - job.id is read, job.remove() is called, status and ' +
    'errorMessage are persisted - and does NOT prove Bull\'s own emission, ' +
    'retry or stalled-job semantics, which stay open in AAP 0.9.6.');

  if (templates && templates.afterWorkerRequire) {
    notes.push('Nunjucks under NODE_ENV=test: unconfigured, ' +
      'nunjucks.render(\'emails/export-ready\') ' +
      (templates.beforeWorkerRequire.rendered
        ? 'rendered'
        : 'threw "' + templates.beforeWorkerRequire.error + '"') +
      '; after the worker\'s own require graph it ' +
      (templates.afterWorkerRequire.rendered
        ? 'rendered ' + templates.afterWorkerRequire.bytes + ' bytes'
        : 'threw "' + templates.afterWorkerRequire.error + '"') +
      '. The worker skips nunjucks.configure under config.isTest (:128-130), ' +
      'but config/app.config -> lib/util/routeParser -> ' +
      'lib/controllers/courses.js requires lib/util/nunjucks, which configures ' +
      'the global environment. The harness configures nothing, and the ' +
      'decision is identical on both worktrees because the require chain is.');
  }

  if (capabilities && !capabilities.exportPathUsable) {
    notes.push('The export chain cannot complete with the installed ' +
      'dependency set, for two reasons that are not regressions of this ' +
      'migration: q 1.0.1 ninvoke assimilates the thenable mongoose 6 Query ' +
      'its target returns and executes it twice (' +
      capabilities.nsend.sites + ' Q.nsend site(s)), and ' +
      'Query.prototype.stream was removed in mongoose 5 (' +
      capabilities.stream.sites + ' site(s)). lib/models/user.js:174 already ' +
      'carries a comment about the first, so the worker is its last consumer. ' +
      'AAP 0.4.1 does not authorize converting either from this lane and AAP ' +
      '0.2.2 defers both, so the gate reports BLOCKED. The follow-up that ' +
      'closes it: Model.<method>(...).exec() and .cursor(). Verified as the ' +
      'ONLY blockers by running this harness with --worker-module against a ' +
      'scratch copy carrying exactly those two substitutions, which passes.');
  }

  notes.push('The archive expectation is derived per OWNER: ' +
    'seed.fixtures.exportArchive.trinketCount counts all seeded trinkets (7) ' +
    'while lib/workers/exports.js:144 counts {_owner: userId}, and one seeded ' +
    'trinket belongs to the admin. This gate expects ' +
    (ctx.expectedTrinkets ? ctx.expectedTrinkets.length : 'the per-owner') +
    ' and would fail on the fixture\'s number for a reason unrelated to the ' +
    'worker.');

  evidence.warnings.allowed.forEach(function(block) {
    notes.push('Allowed warning ' + block.allowance + ': ' + block.summary +
      ' - a named deviation from the zero-warning bar in AAP 0.8, attributable ' +
      'to a dependency AAP 0.5.1.1 retains.');
  });

  notes.push('Clean close: the process cannot self-exit under NODE_ENV=test. ' +
    'lib/util/nunjucks.js configures nunjucks with watch:true when isTest, and ' +
    'nunjucks 3.2.4 keeps the chokidar FSWatcher in a constructor-local ' +
    'variable, so no caller can close it. The inventory is reported and ' +
    'asserted to hold nothing beyond that allowance, and the harness then ' +
    'exits with its own code.');

  notes.push('config/default.yaml declares no aws.buckets.exports although ' +
    'lib/workers/exports.js:391 reads its name and :402 its host, so the ' +
    'overlay supplies one. The committed gap is left as it is (AAP 0.6.7).');

  return notes;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * The whole harness: bootstrap, drive, assert, report, close.
 *
 * Never throws for an assertion failure - the ledger holds those and the
 * verdict reflects them - and always tears down, because a run that lost its
 * report or left a mongod behind has failed at its actual job.
 *
 * @param {Object} options From parseArguments.
 * @returns {Promise<Object>} `{code, verdict, evidence}`
 */
async function run(options) {
  var ledger  = createLedger();
  var started = Date.now();
  var ctx     = { options : options };
  var evidence = {
    tool : {
      file         : 'test/parity/worker.js',
      node         : process.version,
      execArgv     : process.execArgv.slice(),
      appRoot      : options.appRoot,
      workerModule : options.workerModule,
      emitterPatch : options.emitterPatch,
      overlay      : options.overlayPath
    },
    jobs : []
  };
  var verdict = 'FAIL';
  var blocked = false;
  var code;
  var handles;
  var classified;
  var previous;
  var differences;

  installCapture();

  if (!options.emitterPatch) {
    note('CONTROL RUN: --no-emitter-patch. InMemoryQueue.on stays a no-op, so ' +
      'the worker\'s handlers are discarded and the handler assertions MUST ' +
      'fail. A pass here would mean the assertions were vacuous.');
  }

  if (options.workerModule !== 'lib/workers/exports') {
    note('CONTROL RUN: the worker module is ' + options.workerModule +
      ', not the shipped lib/workers/exports.');
  }

  try {
    assertAppRoot(options.appRoot);

    ctx.layout = createRunDirectory(options.runDir);
    evidence.runDir = ctx.layout.runDir;
    evidence.s3Root = ctx.layout.s3Root;

    ctx.environment = await applyEnvironment(options, ctx.layout);
    ctx.address     = ctx.environment.address;
    ctx.cwdBefore   = ctx.environment.cwdBefore;
    evidence.database = ctx.address.database;
    evidence.uri      = ctx.address.uri;

    ctx.graph = inspectModuleGraph(options.appRoot);
    evidence.moduleGraph = {
      shared       : ctx.graph.shared,
      toolMongoose : ctx.graph.toolMongoose,
      appMongoose  : ctx.graph.appMongoose
    };

    evidence.fixtures = loadFixtures(options.appRoot);

    // The queue instance FIRST, then the patch, then the worker: the worker's
    // handlers have to land on a patched instance, and it caches the instance
    // it resolves at require time.
    ctx.queues = requireApp(options.appRoot, 'lib/util/queues');

    await ledger.check('redis is disabled, so the in-memory queue is selected ' +
      '(lib/util/queues.js:137-141)', function() {
        assert.strictEqual(ctx.queues.isRedisEnabled(), false,
          'this harness must not reach a real Redis; the overlay sets ' +
          'db.redis.enabled to false');
      });

    ctx.queue = ctx.queues.exports();
    evidence.queue = {
      constructor : ctx.queue.constructor.name,
      emission    : 'harness-emitted',
      patched     : options.emitterPatch
    };

    ctx.patch = options.emitterPatch ? installQueuePatch(ctx.queue) : null;

    evidence.templates = {
      beforeWorkerRequire : measureTemplateResolution(options.appRoot,
        'emails/export-ready')
    };

    ctx.load = requireWorker(options);
    evidence.loadOrder = ctx.load;

    if (!ctx.load.required) {
      note('the worker could not be REQUIRED: ' + ctx.load.error.message);
      note('At base commit 2f8712a this is the expected, measured baseline: ' +
        'lib/workers/exports.js loads config/db before config/app.config, so ' +
        'mongoose-schema-extend\'s Proxy polyfill replaces the global ' +
        'Object.getPrototypeOf before @hapi/hapi loads. It is reported as that ' +
        'measurement and NOT as a pass.');
    }

    await ledger.check('the worker can be required (the load-order fix)',
      function() {
        assert.strictEqual(ctx.load.required, true,
          'require(' + options.workerModule + ') threw: ' +
          (ctx.load.error && ctx.load.error.message));
      });

    if (ctx.load.required) {
      evidence.templates.afterWorkerRequire = measureTemplateResolution(
        options.appRoot, 'emails/export-ready');

      note('templates: unconfigured -> ' +
        (evidence.templates.beforeWorkerRequire.rendered
          ? 'rendered'
          : evidence.templates.beforeWorkerRequire.error) +
        '; after the worker\'s own require graph -> ' +
        (evidence.templates.afterWorkerRequire.rendered
          ? evidence.templates.afterWorkerRequire.bytes + ' bytes'
          : evidence.templates.afterWorkerRequire.error));

      await ledger.check('the mail templates resolve, so the notification path ' +
        'is genuinely exercised', function() {
          assert.strictEqual(evidence.templates.afterWorkerRequire.rendered, true,
            'nunjucks.render(\'emails/export-ready\') must work in the ' +
            'worker\'s process. The worker skips nunjucks.configure under ' +
            'config.isTest (:128-130), and what configures the global ' +
            'environment instead is its own require graph, through ' +
            'lib/util/nunjucks. Error: ' +
            evidence.templates.afterWorkerRequire.error);
        });

      ctx.mongoose = requireAppPackage(options.appRoot, 'mongoose');
      ctx.config   = requireAppPackage(options.appRoot, 'config');

      await awaitConnection(ctx.mongoose, CONNECT_TIMEOUT_MS);

      // The Export model, taken through the application's own module so the
      // declared dependency is the one exercised. `lib/models/export.js`
      // exports model.js's `publicModel`, whose `.model` IS the registered
      // mongoose model (lib/models/model.js:104 assigns it), and the worker
      // uses `Export.model || mongoose.model('Export')` at :132 and elsewhere.
      // Asserting the identity is what makes reading the document back, and
      // recording the updates, provably about the same object the worker
      // writes through.
      ctx.Export      = requireApp(options.appRoot, 'lib/models/export');
      ctx.ExportModel = ctx.mongoose.model('Export');

      await ledger.check('the Export model the harness reads is the one the ' +
        'worker writes through', function() {
          assert.strictEqual(ctx.Export.model, ctx.ExportModel,
            'lib/models/export.js\'s publicModel.model must be the registered ' +
            'mongoose model; the worker resolves the same pair at :132');
          assert.strictEqual(ctx.ExportModel.modelName, 'Export', 'modelName');
        });

      if (!ctx.graph.shared) {
        // A foreign worktree resolves its own mongoose, so the seeder beside
        // this file would write through a different connection and model
        // registry than the worker reads. Driving jobs would produce a
        // confidently wrong answer, so it is not attempted and the limit is
        // reported. The load-order measurement above is the deliverable here.
        blocked = true;
        note('BLOCKED: ' + options.appRoot + ' resolves its own mongoose (' +
          ctx.graph.appMongoose + ') while this harness resolves ' +
          ctx.graph.toolMongoose + '. Two module graphs mean two connections ' +
          'and two model registries, so seeded documents would be invisible ' +
          'to the worker. Jobs are NOT driven; the require-time load-order ' +
          'measurement above is this run\'s result.');
      }
      else {
        seedTool    = require('./seed');
        storageTool = require('./storage');
        ctx.seed    = seedTool;
        ctx.storage = storageTool;

        ctx.capabilities = await probeCapabilities(options.appRoot, ctx.mongoose,
          options.workerModule);
        evidence.capabilities = ctx.capabilities;

        if (!ctx.capabilities.exportPathUsable) {
          blocked = true;
          note('BLOCKED: the export chain cannot complete with the installed ' +
            'dependency set.');

          if (!ctx.capabilities.nsend.usable && ctx.capabilities.nsend.sites > 0) {
            note('  BLOCKER-Q  q 1.0.1 ninvoke assimilates the thenable ' +
              'mongoose 6 Query the called method returns, executing it twice: ' +
              '"' + ctx.capabilities.nsend.error + '". ' +
              ctx.capabilities.nsend.sites + ' Q.nsend call site(s) in ' +
              options.workerModule + ' fail this way. Remedy: ' +
              'Model.<method>(...).exec().');
          }

          if (!ctx.capabilities.stream.usable && ctx.capabilities.stream.sites > 0) {
            note('  BLOCKER-S  ' + ctx.capabilities.stream.error +
              ', and ' + options.workerModule + ' calls .stream() at ' +
              ctx.capabilities.stream.sites + ' site(s) - createExportArchive ' +
              'streams the owner\'s trinkets at :237. Remedy: .cursor().');
          }

          note('  Neither is a regression from this migration and neither is ' +
            'inside this lane\'s authorized diff: AAP 0.4.1 authorizes only the ' +
            'require ordering, the Bull 4 adaptations and the URL helper for ' +
            'lib/workers/exports.js, and AAP 0.2.2 defers `q` -> native ' +
            'promises and Mongoose 6 -> 7+. The blocked expectation set is ' +
            'asserted instead, and this run\'s verdict is BLOCKED.');
        }

        ctx.expectedTrinkets = buildExpectedTrinkets(ctx.seed);
        ctx.updates = installUpdateRecorder(ctx.ExportModel);

        evidence.seed = await seedFixtures({
          seed             : ctx.seed,
          ExportModel      : ctx.ExportModel,
          mongooseInstance : ctx.mongoose
        });
        evidence.seed = {
          created         : evidence.seed.created,
          expectedTrinkets : ctx.expectedTrinkets.map(function(spec) {
            return spec.shortCode;
          })
        };

        await assertQueueRegistration(ctx, ledger);
        await assertErrorHandler(ctx, ledger);

        // Without the patch there is nothing to observe: the in-memory queue
        // emits no event and `_processJob` only `.catch`-logs, so a job's
        // settlement, its `job.remove()` and its handler output are all
        // invisible. Driving jobs anyway would produce assertions about
        // nothing, so the control run stops here with that stated as a failed
        // check rather than proceeding into a TypeError.
        await ledger.check('the queue instance is patched, without which no ' +
          'job outcome is observable', function() {
            assert.notStrictEqual(ctx.patch, null,
              '--no-emitter-patch was given, so InMemoryQueue.prototype.on ' +
              'discarded the worker\'s handlers and no job can be observed. ' +
              'This is the control: a PASS here would mean every handler ' +
              'assertion in this file was vacuous.');
          });

        await withTimeout((async function() {
          var i;
          var spec;
          var outcome;
          var expectation;

          if (!ctx.patch) {
            return;
          }

          for (i = 0; i < JOBS.length; i++) {
            spec    = JOBS[i];
            outcome = await driveJob(ctx, spec);

            await assertJobShape(ctx, ledger, outcome);

            if (spec.name === 'unknown-action') {
              expectation = 'unknown-action';
              await assertUnknownActionJob(ctx, ledger, outcome);
            }
            else if (!ctx.capabilities.exportPathUsable) {
              expectation = 'blocked';
              await assertBulkExportBlocked(ctx, ledger, outcome);
            }
            else if (spec.name === 'success') {
              expectation = 'success';
              await assertSuccessCompleted(ctx, ledger, outcome);
            }
            else if (spec.name === 'missing-user') {
              expectation = 'missing-user';
              await assertMissingUserJob(ctx, ledger, outcome);
            }
            else {
              expectation = 'late-failure';
              await assertLateFailureJob(ctx, ledger, outcome);
            }

            evidence.jobs.push(projectJob(outcome, expectation));
          }
        })(), options.timeoutMs, 'the four jobs');

        await assertIsolation(ctx, ledger);
      }
    }
  }
  catch (err) {
    // A bootstrap or bound failure, as opposed to an assertion: recorded as a
    // failed check so it lands in the report with everything else.
    await ledger.check('the harness ran to completion', function() {
      throw err;
    });

    if (err && err.stack && !(err instanceof ToolError)) {
      process.stderr.write(err.stack + '\n');
    }
  }

  evidence.teardown = await teardown(ctx);

  handles    = await settleHandles(SETTLE_TIMEOUT_MS);
  classified = classifyWarnings(capturedStderr());

  await assertWarnings(ledger, classified);
  await assertCleanClose(ledger, handles);

  evidence.warnings = {
    allowed    : classified.allowed.map(function(block) {
      return { allowance : block.allowance, summary : block.summary };
    }),
    unexpected : classified.unexpected.map(function(block) {
      return block.summary;
    })
  };
  evidence.handles = handles;
  evidence.checks  = {
    count    : ledger.count(),
    passed   : ledger.passed(),
    failures : ledger.failures()
  };
  evidence.durationMs = Date.now() - started;

  if (options.comparePath) {
    try {
      previous    = JSON.parse(fs.readFileSync(options.comparePath, 'utf8'));
      differences = compareEvidence(
        normalizeEvidence(projectComparable(evidence)),
        normalizeEvidence(projectComparable(previous)));

      evidence.comparison = {
        against     : options.comparePath,
        differences : differences
      };

      await ledger.check('determinism: this run matches ' + options.comparePath +
        ' once the enumerated volatile values are normalized', function() {
          assert.deepStrictEqual(differences, [],
            'differences: ' + JSON.stringify(differences, null, 2));
        });

      evidence.checks = {
        count    : ledger.count(),
        passed   : ledger.passed(),
        failures : ledger.failures()
      };
    }
    catch (err) {
      note('the comparison against ' + options.comparePath + ' could not be ' +
        'made: ' + ((err && err.message) || err));
      evidence.comparison = {
        against : options.comparePath,
        error   : (err && err.message) || String(err)
      };
    }
  }

  if (ledger.failures().length > 0) {
    verdict = 'FAIL';
    code    = EXIT_ERROR;
  }
  else if (blocked) {
    verdict = 'BLOCKED';
    code    = EXIT_BLOCKED;
  }
  else {
    verdict = 'PASS';
    code    = EXIT_OK;
  }

  evidence.verdict = verdict;

  if (options.outPath) {
    try {
      fs.writeFileSync(options.outPath, JSON.stringify(evidence, null, 2) + '\n');
      note('artifact ' + options.outPath);
    }
    catch (err) {
      note('the artifact could not be written to ' + options.outPath + ': ' +
        ((err && err.message) || err));
    }
  }

  evidence.notesOwed = buildNotesOwed(ctx, evidence);

  note('notes owed to docs/baseline-parity.md (emitted here; this file edits ' +
    'no documentation):');
  evidence.notesOwed.forEach(function(entry, index) {
    note('  ' + (index + 1) + '. ' + entry);
  });

  note('checks ' + ledger.passed() + '/' + ledger.count() + ' passed, ' +
    evidence.jobs.length + ' job(s) driven, ' +
    evidence.warnings.allowed.length + ' allowed warning(s), ' +
    evidence.warnings.unexpected.length + ' unexpected, ' +
    evidence.durationMs + 'ms');

  ledger.failures().forEach(function(failure) {
    note('  FAILED ' + failure.name + ': ' + failure.message);
  });

  note('VERDICT ' + verdict + (verdict === 'BLOCKED'
    ? ' - the harness is sound and the application cannot do what AAP 0.9.3 ' +
      'requires; see the BLOCKER notes above'
    : ''));

  restoreCapture();

  return { code : code, verdict : verdict, evidence : evidence };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * argv -> exit code.
 *
 * @returns {Promise<number>}
 */
async function main() {
  var options;
  var result;

  try {
    options = parseArguments(process.argv.slice(2));
  }
  catch (err) {
    process.stderr.write(LOG_PREFIX + ((err && err.message) || err) + '\n');
    process.stderr.write(USAGE + '\n');
    return EXIT_USAGE;
  }

  if (options.mode === 'help') {
    process.stderr.write(USAGE + '\n');
    return EXIT_OK;
  }

  result = await run(options);

  return result.code;
}

module.exports = {
  // The harness.
  run  : run,
  main : main,

  // Building blocks, exported because each has a failure mode worth testing
  // directly rather than only through a full run - and because the queue patch
  // in particular is the mechanism obstacle 1 forces, so it should be
  // inspectable on its own.
  parseArguments         : parseArguments,
  assertAppRoot          : assertAppRoot,
  createRunDirectory     : createRunDirectory,
  inspectModuleGraph     : inspectModuleGraph,
  installQueuePatch      : installQueuePatch,
  installUpdateRecorder  : installUpdateRecorder,
  requireWorker          : requireWorker,
  measureTemplateResolution : measureTemplateResolution,
  probeCapabilities      : probeCapabilities,
  buildExpectedTrinkets  : buildExpectedTrinkets,
  buildNotesOwed         : buildNotesOwed,
  listWorkerTempFiles    : listWorkerTempFiles,
  classifyWarnings       : classifyWarnings,
  inspectHandles         : inspectHandles,
  settleHandles          : settleHandles,
  normalizeEvidence      : normalizeEvidence,
  projectComparable      : projectComparable,
  compareEvidence        : compareEvidence,
  createLedger           : createLedger,

  // Reference values, so a caller asserts against the same constants this file
  // uses rather than a second copy of them.
  JOBS               : JOBS,
  HARNESS_IDS        : HARNESS_IDS,
  VOLATILE           : VOLATILE,
  COMPARABLE         : COMPARABLE,
  WARNING_ALLOWANCES : WARNING_ALLOWANCES,
  HANDLE_ALLOWANCES  : HANDLE_ALLOWANCES,
  ToolError          : ToolError,
  USAGE              : USAGE,
  EXIT_OK            : EXIT_OK,
  EXIT_ERROR         : EXIT_ERROR,
  EXIT_USAGE         : EXIT_USAGE,
  EXIT_BLOCKED       : EXIT_BLOCKED
};

if (require.main === module) {
  main()
    .then(function(code) {
      // The process cannot self-exit: the chokidar watchers described in
      // HANDLE_ALLOWANCES keep the loop alive and no caller can close them. So
      // the inventory has already been reported and asserted, the artifact has
      // already been written, and this exits with the run's OWN code - never 0
      // on a failure or a timeout, which is the thing that would make a hung
      // gate indistinguishable from a passing one.
      process.exitCode = code;

      var timer = setTimeout(function() {
        clearTimeout(timer);
        process.stderr.write(LOG_PREFIX + 'exiting with code ' + code +
          '; see the reported handle inventory for what is still open\n');
        process.exit(code);
      }, EXIT_GRACE_MS);

      // If nothing is holding the loop, the grace timer is the only handle and
      // unref'ing it lets the process leave immediately with the same code.
      timer.unref();
    })
    .catch(function(err) {
      process.stderr.write(LOG_PREFIX + 'the harness itself failed: ' +
        ((err && err.message) || err) + '\n');

      if (err && err.stack) {
        process.stderr.write(err.stack + '\n');
      }

      process.exit(EXIT_ERROR);
    });
}
