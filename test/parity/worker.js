#!/usr/bin/env node
'use strict';

// Bounded functional validation of the export worker.
//
// AAP 0.9.3 states the requirement this file answers: "The export worker is
// functionally validated, not merely required. A bare require opens Mongo and
// Redis handles and registers a long-lived processor, so it is neither finite
// nor meaningful." So this harness starts the worker against an isolated
// MongoDB, a REAL Bull 4 queue in a namespace of its own, the filesystem-backed
// S3 fixture and the captured-mail fixture, drives real jobs through the
// processor the worker registered, asserts the persisted documents, the
// produced archive, the uploaded object and the captured mail, asserts Bull's
// own completion, failure, retry and stalled semantics, and closes every handle
// it opened - inside an overall timeout, with every human-readable byte on
// stderr because stdout carries the worker's own log lines.
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
// THE QUEUE: A REAL BULL 4 QUEUE IN A NAMESPACE OF ITS OWN
// ===========================================================================
// `lib/workers/exports.js` has no API. It is a pure side-effect module: it
// exports nothing, and requiring it resolves the exports queue through
// `require('../util/queues').exports()` and then registers an `error` handler,
// a `failed` handler that reads `job.id`, a `completed` handler that calls
// `job.remove()`, and a one-argument promise-returning processor. There is
// nothing to call, so the only way to reach a handler body is to put a job on
// the very queue instance the worker registered against - reachable because
// `lib/util/queues.js` caches per name in a module-local cache and the worker
// and this harness resolve the same module instance.
//
// WHICH KIND OF QUEUE THAT INSTANCE IS decides what this file can prove, and
// there is only one answer that proves anything. With `db.redis.enabled: false`
// `lib/util/queues.js` selects its `InMemoryQueue`, whose `on` is a NO-OP that
// returns `this` and emits nothing and whose `_processJob` merely `.catch`-logs
// a rejected processor. Every one of the worker's three event handlers is
// unreachable there, and with them `job.id` in the failed handler,
// `job.remove()` on completion and the failed handler's own persistence. An
// earlier revision of this file worked around that by replacing the instance's
// `on` and wrapping `_processJob` so that the HARNESS emitted `completed` and
// `failed` itself. That reached the handler bodies and nothing else: no Bull
// existed in the process, so Bull's own emission, retry and stalled-job
// semantics - the exact list AAP 0.5.1.2 says the 0.7.2 -> 4.16.5 move alters
// and AAP 0.9.3 requires asserted - were not exercised at all. Evidence a
// harness produces about itself is not evidence about the application, so that
// mechanism is GONE and nothing in this file emits a queue event.
//
// WHAT REPLACES IT. The composed configuration sets `db.redis.enabled: true`
// and points `db.redis.app` and `db.redis.exports` at a loopback Redis
// (127.0.0.1:6379 by default, `--redis host:port` to override), so
// `lib/util/queues.js` takes its Bull branch and builds a genuine
// `new Queue('exports', {redis: {...}})`. Every event this file asserts is
// emitted by Bull 4.16.5 itself.
//
// ISOLATION, because a queue name IS its Redis keyspace. Bull derives its key
// prefix from `opts.prefix` (default `bull`), and `lib/util/queues.js`
// forwards only host, port and password - by design, and this file does not
// edit it. So the harness patches the `bull` module the application resolves,
// for the duration of the run, with a wrapper that adds ONE option: a
// `prefix` unique to this run. Nothing else is injected - not `settings`, not
// `limiter`, not `defaultJobOptions` - so the queue the worker registers on
// carries Bull's own defaults, which the run asserts (`lockDuration` 30000)
// precisely so that a future timing injection cannot pass unnoticed. The
// wrapper is recorded in the artifact as `queue.injected`, restored in
// teardown, and the namespace is obliterated before the process leaves. Two
// runs on one Redis, or a run beside another agent's, therefore cannot see each
// other's jobs.
//
// WHAT THE SELECTED WORKTREE ACTUALLY RESOLVED IS A MEASUREMENT, NOT A
// PRECONDITION. `--app` exists so this harness, which lives only in the
// migrated worktree, can drive an INDEPENDENTLY INSTALLED one (AAP 0.9.3), and
// the baseline at 2f8712a resolves bull 0.7.2: a queue with `on`, `add`,
// `getJob` and `process`, without `moveUnlockedJobsToWait`, `obliterate`,
// ioredis-shaped clients or `prefix` support. An earlier revision asserted the
// Bull 4 surface while merely CONSTRUCTING its observer, so it threw during
// setup and produced no load-order measurement, no fixtures and no capability
// diagnosis - it refused the very architecture it was built for. So
// `probeQueueSurface` now records the surface into the artifact whatever it
// says, `assertQueueIsRealBull` turns any shortfall into named FAILED checks
// carrying the remedy, and the run continues to collect everything that does
// not depend on the queue. What it will NOT do is enqueue: a queue whose
// `prefix` option was ignored addresses the shared `bull:exports:*` keyspace,
// this host runs up to sixty-four clones against one Redis, and a gate that
// polluted a sibling's keyspace to produce its own evidence would be trading
// someone else's run for its own. Each undriven job is then a failed check of
// its own rather than a check that quietly disappears.
//
// WHAT THAT BUYS, asserted rather than asserted-about:
//   * the processor's promise completion - a real `completed` event carrying
//     the value the processor resolved with, and `job.remove()` proven by the
//     job being GONE from Redis afterwards rather than by a counter;
//   * `job.id` in the failed handler - a real Bull 4 Job, `id` present and
//     `jobId` absent as an own property, and the handler's own log line as the
//     evidence of what it read;
//   * retry - a job added with `attempts: 2` whose processor Bull runs twice,
//     with `attemptsMade` 1 then 2 and the failure persisted after the last;
//   * stalled-job recovery - a job locked by a second queue instance in the
//     same namespace, its lock deleted, and Bull's own
//     `moveUnlockedJobsToWait` run twice (the script's guard key is cleared
//     between passes, because pass one marks and pass two reports): Bull emits
//     `stalled`, moves the job back to wait, and the WORKER's processor picks
//     it up and fails it, which is the whole path a lost lock takes in
//     production;
//   * the queue-level `error` payload - provoked by taking one job's lock away
//     while its processor runs, which is the genuine "Missing lock for job N
//     failed" Bull raises when a processor outlives its lock. Two levers, both
//     on the harness's side and both undone immediately: the lock horizon is
//     shortened for that one job, and the lock key is deleted as soon as it
//     appears. The error object the worker's handler receives is Bull's own,
//     and Bull's decision that a lost lock is not an outcome it records - no
//     `failed`, no `completed`, no failed handler - is asserted rather than
//     assumed.
//
// ===========================================================================
// THE MAIL TEMPLATE PRECONDITION
// ===========================================================================
// `lib/workers/exports.js` calls `nunjucks.configure(config.app.templates)`
// only when `!config.isTest`, and this harness runs under NODE_ENV=test, so the
// worker itself never configures it. The concern is that
// `nunjucks.render('emails/export-ready')` would then resolve against
// nunjucks' default loader and throw, driving an otherwise successful export
// into the failure path.
//
// MEASURED, and the premise does not hold in this tree:
//   * before any application require: THROWS "template not found:
//     emails/export-ready" - the default loader searches the process's own
//     working directory;
//   * after `require(<appRoot>/lib/workers/exports)`: RENDERS.
// The reason is a side effect of the worker's own require graph:
// config/app.config -> lib/util/routeParser -> lib/controllers/courses.js
// requires lib/util/nunjucks, whose module scope configures the GLOBAL
// environment that `nunjucks.render` uses. The mail path is therefore genuinely
// exercised with no harness intervention.
//
// So the harness configures NOTHING and instead ASSERTS the capability as a
// measured precondition (`measureTemplateResolution`), recording both
// observations in the report. This is identical on both worktrees, because the
// require chain is.
//
// ===========================================================================
// NO WATCHER IS STARTED, SO NONE IS ALLOWED OR OWNED
// ===========================================================================
// That same require of `lib/util/nunjucks` configures nunjucks with
// `watch: config.isDev || config.isTest`, so under NODE_ENV=test its
// FileSystemLoader does two things this gate cannot live with: it `require`s
// `chokidar`, which THIS REPOSITORY DOES NOT DECLARE - AAP 0.5.1.3 removes it
// as dead, and it is on disk only because npm 7 and later install nunjucks'
// optional peer automatically - and it starts a watcher per template search
// path, upwards of a hundred FSEventWrap handles, keeping each FSWatcher in a
// constructor-local variable the loader never exposes.
//
// Three revisions of this file, and the third is the one to keep. The first
// declared those handles an allowed deviation and called `process.exit`, which
// reports a leak and leaves rather than closing one. The second resolved
// `chokidar` as nunjucks resolves it, wrapped `watch` to keep a reference, and
// closed each watcher in teardown - which fixed the handles and left the
// harness itself reaching for an undeclared package to do it.
//
// This one removes the cause. Both consequences follow from ONE option, so one
// option is what changes: before the first application require the harness
// wraps `nunjucks.configure` - the declared package's own public API - and
// passes `watch: false` through to it, having normalized the arguments exactly
// as nunjucks does. No watcher is created, no chokidar is loaded, and the
// teardown step asserts both: `configure` is restored, every call was passed
// `watch: false`, and NOTHING matching `node_modules/chokidar` is in this
// process's require cache. What is given up is template hot-reload, which a
// process that renders once and exits cannot use and which
// `lib/util/nunjucks.js` already defeats for itself by clearing `env.cache` on
// every render under isTest.
//
// The handle assertion then requires the inventory to be EMPTY apart from this
// process's own stdout/stderr, which are partitioned separately because which
// of them exists depends on how the process was invoked and neither ever keeps
// the loop alive. Nothing forces the process out: it returns from `main`, sets
// `process.exitCode` and drains, and the watchdog that remains can only ever
// exit NON-ZERO, after reporting what is still open.
//
// The application's own reliance on chokidar REMAINS, and this file records it
// rather than inheriting it: `dependencies.templateWatch` in the artifact
// carries how many `configure` calls asked for watching, where chokidar would
// resolve from, that it is undeclared, that it is nunjucks' optional peer, and
// that nothing loaded it - and the note owed to `docs/baseline-parity.md` says
// in words that under NODE_ENV=test an install which skipped optional peers
// would leave `lib/util/nunjucks.js` unable to load. Declaring the package or
// configuring nunjucks without watching outside development are decisions for
// the lanes that own `package.json` and `lib/util/nunjucks.js`.
//
// ===========================================================================
// THE RUNTIME DEFECT THIS GATE REPORTS AS A FAILURE
// ===========================================================================
// The success half of AAP 0.9.3's worker gate is unreachable while the worker
// carries two idioms the installed dependency set no longer supports, both
// measured:
//
//   Q ASSIMILATION  `q` 1.0.1's `Q.nsend`/`ninvoke` runs
//                   `Q(object).dispatch("post", [name, nodeArgs])` and Q
//                   assimilates the value the method returns when it is a
//                   thenable. A mongoose 6 Query IS a thenable, so each
//                   `Q.nsend` call executes its query a second time and
//                   mongoose 6.13.11 throws "Query was already executed".
//                   Measured for `findByIdAndUpdate`, `findById` and `count`.
//   REMOVED STREAM  `Query.prototype.stream` is `undefined` on mongoose 6 - it
//                   went in mongoose 5 - and `createExportArchive` streams the
//                   owner's trinkets, so archive creation cannot start.
//
// Neither is a regression of this migration: the same mongoose 6 line and the
// same `q` 1.0.1 are declared at 2f8712a, `lib/models/user.js` already carries
// a comment about the first, and the worker is that incompatibility's last
// consumer - unnoticed precisely because the module could not be required at
// all. Neither is repaired from HERE, because `lib/workers/exports.js` is not
// this file's to edit.
//
// WHAT THIS FILE DOES ABOUT IT IS THE POINT. An earlier revision treated the
// combination as a third, accepted outcome - a BLOCKED verdict with its own
// exit code and its own expectation set - which is a gate reporting that it
// cannot do its job while exiting as though that were an answer. It is not one.
// `probeCapabilities` still MEASURES both idioms and still records the exact
// error text and the call-site counts, because a diagnosis is worth more than
// a bare failure; but the measurement is now ASSERTED, every job is driven
// against the real queue, and a worker that cannot complete an export fails
// this gate with the remedy named: convert the `Q.nsend` calls to
// `Model.<method>(...).exec()` and the `.stream()` call to `.cursor()`. There
// is no verdict between PASS and FAIL.
//
// The measurement is in two halves and the halves fail differently. The
// call-site counts come from the worker's SOURCE, over code with comments
// stripped, and an unreadable source is fatal - a failed read used to leave
// the source empty, which reads as zero call sites, which reads as the most
// favourable answer available, produced by the absence of evidence. The
// runtime halves need a registered model on a live connection, so on a
// worktree that cannot require the worker at all they are recorded as
// UNPROBED, and unprobed is never usable.
//
// ===========================================================================
// THE WARNING BAR, AND THE ONE HANDLE ALLOWANCE
// ===========================================================================
// THERE IS NO WARNING ALLOWANCE. The bar is AAP 0.9.3's, it is stated once in
// test/parity/warning-policy.js for all four parity gates, and it has no
// exceptions: any notice attributable to the application's own source or to a
// dependency this plan RETAINS fails this run. The instance that proved the bar
// was DEP0005 `Buffer()` from
// `compress-commons/lib/archivers/zip/constants.js`, reached through
// `archiver` 2.1.1 - which this harness FAILED on rather than excusing.
// Clearing it was the dependency decision's job and that decision was taken:
// archiver moved 2.1.1 -> 6.0.2, the chain is now zip-stream 5.0.2 ->
// compress-commons 5.0.3 -> crc32-stream 5.0.1, and this gate measures zero
// notices on the delivered tree. Excusing it was never this harness's to
// grant, because 0.7 and 0.5.1.4 authorize exactly two deviations and neither
// is a warning.
//
// The flags are a precondition, not an invocation detail: a pending deprecation
// is silent without `--pending-deprecation`, so under direct execution this
// file re-executes itself once with the required flags rather than reporting a
// silence it cannot vouch for.
//
// THE HANDLE BAR IS THE SAME SHAPE, and it is not an allowance table with an
// application observation in it: an open handle this run created is a
// failure, and only this process's own stdio is partitioned out as invocation
// plumbing. The measurement worth keeping is why the watcher handles cannot
// simply be closed by a caller:
//
//      `FSEventWrap` handles from the chokidar watchers `lib/util/nunjucks.js`
//      creates under NODE_ENV=test. They cannot be closed by a caller:
//      measured, nunjucks 3.2.4's FileSystemLoader keeps the FSWatcher in a
//      constructor-local variable, and the loader's own keys are
//      `_events`/`_eventsCount`/`_maxListeners`/`pathsToNames`/`noCache`/
//      `searchPaths`/`cache` - there is no `watcher` property to close. They
//      now land in `handles.unexpected`, which fails the clean-close check.
//      The run still TERMINATES: the deliberate exit at the bottom of this file
//      arms an unref'd grace timer and then calls process.exit with the run's
//      own code, so an open handle produces a failing run rather than a hung
//      gate. That is reporting a leak, failing on it, and then leaving.
//
// Only this process's own stdio remains in HANDLE_ALLOWANCES, and it is not an
// allowance for a defect: which stdio handles exist depends solely on how the
// process was invoked, so they are invocation plumbing and are partitioned out
// of the assertion rather than excused within it.
//
// ===========================================================================
// THE ENVIRONMENT CONTRACT
// ===========================================================================
// Composed here and applied to this process, because this process IS the
// worker whose stderr AAP 0.9.3 inspects. Nothing is forked: the queue instance
// the worker registered its processor on lives in this process, so the job has
// to be enqueued from inside it.
//
//   NODE_ENV                       'test', the value every sibling parity tool
//                                  uses.
//   NODE_CONFIG                    from `mongo.start({overlay}).nodeConfig` -
//                                  the inherited value, then the overlay, then
//                                  the database address. The overlay copy this
//                                  file passes carries the Redis endpoint and
//                                  `db.redis.enabled: true`, and has `app.start`
//                                  removed: the overlay exists to launch a
//                                  server and this harness must not open a
//                                  listening socket. `aws.buckets.exports` is
//                                  why the overlay is still mandatory, since
//                                  committed configuration declares none
//                                  although the worker dereferences its `name`
//                                  and `host` (AAP 0.6.7).
//   NODE_CONFIG_PERSIST_ON_CHANGE  'N'.
//   NODE_CONFIG_DISABLE_FILE_WATCH 'Y'. Both controls, because `config` 0.4.37
//                                  skips creating its runtime JSON only when
//                                  persistence is off AND the watch is
//                                  disabled, and nothing in this application
//                                  subscribes with `config.watch(...)`, so
//                                  disabling it changes no behaviour.
//   NODE_CONFIG_RUNTIME_JSON       inside the run directory. Measured
//                                  necessary: `config` 0.4.37 otherwise writes
//                                  `runtime.json` INTO the tree under test.
//   NODE_CONFIG_DISABLE_FILE_WATCH 'Y'. `config` watches that file and logs
//                                  `Error loading <path>` when a read fails, so
//                                  removing the run directory in teardown would
//                                  otherwise print library output into the
//                                  stream the warning gate reads.
//   NODE_CONFIG_DIR                `<appRoot>/config`, so one harness can run
//                                  against either worktree.
//   All four come from ./mongo's `isolateRuntimeConfig`, the single
//   implementation every parity tool now shares.
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
// ===========================================================================
// THE CONTROLS
// ===========================================================================
// AAP 0.9.6-grade evidence needs proof that the assertions are not vacuous, so
// the flags that provide it are documented and default to the real thing:
//
//   --worker-module <path>  requires a different module as the worker,
//                           relative to appRoot. Two uses: restore `job.jobId`
//                           in a scratch copy and confirm the `job.id`
//                           assertion fails, and run a mongoose-6-compatible
//                           scratch copy to confirm the success-path assertion
//                           set passes end to end.
//   --redis <host:port>     the Redis this run uses. A dedicated instance is
//                           the strongest isolation; the per-run key prefix is
//                           what makes the shared default safe.
//   --keep-run-dir          retains a run directory the harness created. It is
//                           removed on a clean run and always kept on a failed
//                           one, so the fixture evidence logs survive exactly
//                           when they are wanted.
//
// ===========================================================================
// WHAT THE EVIDENCE SAYS ABOUT ITSELF
// ===========================================================================
// A standalone artifact that records only paths and a runtime cannot name the
// application revision it exercised or the generator that produced it, so it
// cannot be authenticated against the delivery it is filed under. Every
// artifact this file emits therefore carries a `provenance` block built by the
// shared contract in `test/parity/manifest.js`, which records the HEAD, subject
// and worktree state of the tree the worker was driven in, the git blob of THIS
// file's exact bytes together with the commit VERIFIED to hold that blob at
// this path - or an explicit non-git state where none does - and this tool's
// own delivered HEAD, and which hash-links all of it to the artifact's bytes.
// With `--out` the same record is written to `<out>.provenance.json` with a
// digest of the bytes as written.
//
// The block carries nothing run-local: the contract's portability guard throws
// on an absolute path, a wall-clock instant or a field named for run state, so
// the tree under test is named by its HEAD rather than its path, and the worker
// module and the overlay are recorded as `tool:`/`analysed:` labels that mean
// the same thing in every clone. `--compare` is unaffected - `COMPARABLE` is an
// allow-list of what the run observed about the application, and `provenance`
// sits outside it exactly as `tool` always has, because two runs from two trees
// differ in provenance while the behaviour they recorded is identical.
//
// THE SAME RULE REACHES THE ARTIFACT AROUND THE BLOCK, because a guard on one
// key is no use when the file it sits in names the machine anyway. Every path
// this harness chose is recorded as a label, the database it drove is recorded
// as a configuration digest rather than as a connection string, and every
// message describing the harness's OWN operation - a failed check, a teardown
// step, a module it could not require, a captured warning - is passed through
// `provenance.portableText`, which keeps the words and replaces the host parts.
// What is deliberately left verbatim is what the application produced: a
// persisted document field, a job's error, a capability probe's error. Those
// strings are the measurement, and rewriting a measurement to make it tidy
// would change what this gate reports. See "WHAT IS MADE PORTABLE" below.
//
// ===========================================================================
// PUBLIC API
// ===========================================================================
//   run(options)             the whole harness; resolves to an exit code and
//                            never throws for an assertion failure
//   buildProvenanceRecord(options[, invocation])
//                            this run's evidence identity, buildable without a
//                            database or a driven job
//   describeInvocation(opts) how the harness was invoked, in portable form
//   describeDataStore(addr)  the store as a configuration digest, never as its
//                            address
//   portableReason(v, root) / portableRecord(v, root) / pathLabelFor(p, root)
//                            the routes by which a harness-authored message or
//                            path reaches an artifact
//   parseArguments(argv)     the CLI contract, exported because its failure
//                            modes are worth testing directly
//   normalizeEvidence(ev)    the artifact comparison's volatile-field pass
//   compareEvidence(a, b)    the determinism check, as a list of differences
//   buildExpectedTrinkets(seed)  the archive expectation, derived per owner
//   installBullPrefix(root, p)    the namespace injection, in one place
//   probeQueueSurface(q, o)  what the selected worktree's queue actually is
//   installQueueObserver(q)  the listen-only event recorder
//   installTemplateWatchSuppression(root)  watch:false through nunjucks' own
//                            API, so no watcher starts and no undeclared
//                            chokidar is loaded
//   verifySeedIntegrity(exp) the pre-migration objects, re-read and digested
//   readSourceAnchors(root)  the current line addresses of the symbols this
//                            gate is written against, generated per run
//   main()                   argv -> exit code, used by the require.main guard
//   EXIT_OK / EXIT_ERROR / EXIT_USAGE
//   JOBS / VOLATILE / WARNING_POLICY / HANDLE_ALLOWANCES / USAGE
//
// ===========================================================================
// INVOCATION
// ===========================================================================
//   node --pending-deprecation --trace-deprecation test/parity/worker.js
//   node test/parity/worker.js --out evidence.json    # re-executes itself
//                                                     # WITH the two flags:
//                                                     # they are the gate's
//                                                     # precondition, not a
//                                                     # detail of the call
//   node test/parity/worker.js --out b.json --compare a.json   # determinism
//   node test/parity/worker.js --redis 127.0.0.1:6390          # dedicated
//   node test/parity/worker.js --app ../baseline               # the load-order
//                                                              # measurement
//
// Exit codes: 0 every assertion passed and the worker completed the success
// job; 1 an assertion failed, a timeout expired, the worker could not be
// required, or something this harness opened was still open at the end; 2 a
// usage error.
//
// ===========================================================================
// PROHIBITIONS OBSERVED
// ===========================================================================
// No bare require treated as validation. No queue event emitted by this file -
// it listens, it never emits, and the one time it reaches into Redis it deletes
// a lock so that BULL will report what a lost lock does. No real S3, no real
// SMTP and no network beyond the loopback Redis this gate is named for. No
// modification of lib/workers/exports.js, lib/util/queues.js,
// lib/util/nunjucks.js, any configuration file, any fixture or any baseline
// worktree. Three run-time interventions and no more, each on an object rather
// than a file, each declared in the artifact and each removed in teardown with
// the removal asserted: one option (`prefix`) added to the `bull` constructor
// the application resolved; `watch: false` passed through the `nunjucks`
// configure the application calls; and a recorder around the Export model's
// `findByIdAndUpdate`. Nothing under `test/lib` and nothing in
// the sibling `helpers` directory is required - in particular not its
// `queue.js`, which this migration DELETES because it targets
// `queues.snapshots()`, a getter that is not exported, for a queue that is in
// `disabledQueues`; nothing here is modelled on it. The directory and the
// filename are kept in separate spans throughout, so the mechanical
// independence check - a grep of this file for the joined path - returns
// nothing but this comment. No `url.parse` either: it emits DEP0169 and this
// harness's own stderr is inside the zero-warning gate's stream. No unbounded
// wait, no `process.exit(0)` on a timeout, no forced exit that can report
// success, and no assertion that can pass when the handler never ran.

var assert       = require('assert');
var crypto       = require('crypto');
var fs           = require('fs');
var os           = require('os');
var path         = require('path');
var EventEmitter = require('events').EventEmitter;

// The zero-warning gate, stated once for all four parity gates. What counts as
// a notice, which flags the measurement requires, and the fact that THERE ARE
// NO ALLOWANCES are decided there and not here.
var warningPolicy = require('./warning-policy');

// Under direct execution the flags come first, before anything else is loaded.
// This process IS the worker whose stderr AAP 0.9.3 inspects, and a pending
// deprecation is SILENT without --pending-deprecation: a run that lacks the
// flags cannot tell "nothing was emitted" from "nothing was asked for". So the
// run re-executes itself once with them - here rather than in the entry point
// at the foot of the file, so the parent spawns and forwards without loading
// the harness at all. A re-execution that still lacks them fails closed:
// `assertWarnings` reports the missing evidence and the run fails on it.
if (require.main === module) {
  warningPolicy.elevate();
}

// The lifecycle owner. Requiring it starts NOTHING - its `main` runs only under
// direct execution - so this require creates no server and installs no signal
// handler. `deepMerge` and `readOverlay` are borrowed from it rather than
// reimplemented, so the overlay is layered by exactly the code the sibling
// harnesses layer it with.
var mongo = require('./mongo');

// THE SHARED PROVENANCE CONTRACT. `test/parity/manifest.js` is the one file in
// this directory that is Node-core-only at module scope and self-executes only
// under `require.main === module`, so requiring it here parses no routes,
// connects to nothing and spawns nothing. Every artifact under test/parity/
// identifies its generator and the tree it measured through this one contract,
// which is what keeps this harness's evidence identity the same in kind as
// every sibling's rather than a second, drifting copy of it.
var provenance = require('./manifest').provenance;

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

// This tool's own worktree root, two levels above test/parity/. It is the tree
// whose HEAD is the DELIVERED head in every provenance block this file emits,
// and the root against which a path is reduced to a symbolic label. It is used,
// never recorded: a block that carried it would carry the machine it ran on.
var TOOL_ROOT = path.resolve(__dirname, '..', '..');

// The artifact name recorded in provenance when no `--out` was given. The
// evidence is returned to the caller in that case, and it still describes one
// thing, so the block names it with a stable label rather than a path.
var DEFAULT_ARTIFACT = 'worker-evidence.json';

var EXIT_OK      = 0;
var EXIT_ERROR   = 1;
var EXIT_USAGE   = 2;

// Bounds. A hung worker gate is indistinguishable from a passing one, which is
// the failure mode this file is named for, so every wait below is one of these.
var OVERALL_TIMEOUT_MS   = 240000;
var JOB_TIMEOUT_MS       = 60000;
var CONNECT_TIMEOUT_MS   = 20000;
var SETTLE_TIMEOUT_MS    = 5000;
var POLL_INTERVAL_MS     = 10;
var EXIT_GRACE_MS        = 1500;

// The Redis this gate needs, and the only external service on any code path.
// Loopback by default and overridable with `--redis`; what makes the default
// safe beside another run is the per-run key prefix, not the address.
var DEFAULT_REDIS_HOST = '127.0.0.1';
var DEFAULT_REDIS_PORT = 6379;

// The key-prefix stem. Bull's own default is `bull`; the run id appended to
// this is what keeps two runs, and two agents, out of each other's keyspace.
var PREFIX_STEM = 'parity-worker';

// How long the second queue instance holds the job whose lock is deleted, in
// the stalled case. It has to outlast the two `moveUnlockedJobsToWait` passes
// and the worker's own re-processing; when it elapses the instance tries to
// finish a job it no longer holds, which is Bull's own lost-lock path and is
// harmless here because that instance is the harness's.
var STALL_HOLD_MS = 4000;

// The lock horizon used for the ONE job that provokes Bull's queue-level
// `error`. 1ms expires before any processor can finish, and the renewal timer
// is pushed past the run so that nothing extends it; both are restored the
// moment the job settles, and the run asserts Bull's defaults are back.
var LOCK_LOSS_DURATION_MS  = 1;
var LOCK_LOSS_RENEW_MS     = 600000;

// How long one lock-loss attempt is given, and how many attempts it gets. The
// window is the processor's own duration, so a missed one is a scheduling
// accident rather than a defect - and three misses in a row are not.
var LOCK_LOSS_WINDOW_MS    = 5000;
var LOCK_LOSS_ATTEMPTS     = 3;

// The fixed Export ids this harness owns. Block 06 is the seeder's export
// block; :601-:603 and :6ff are its, so :611 upward are free and are used here
// so that two runs write the same identifiers and the artifact is comparable.
// The seeded `pending` export at ids.exportPending is deliberately NOT reused:
// a job mutates its document, and an assertion about job B must not be reading
// a value job A wrote.
var HARNESS_IDS = Object.freeze({
  exportSuccess       : '000000000000000000000611',
  exportMissingUser   : '000000000000000000000612',
  exportUnknownAction : '000000000000000000000613',
  exportRetry         : '000000000000000000000614',
  exportStalled       : '000000000000000000000615',
  exportLockLoss      : '000000000000000000000616'
});

// The jobs, declared as data because the report is keyed on these names and
// because the order is part of the contract: they run SEQUENTIALLY, each waited
// out and asserted before the next is enqueued, so that no job's cleanup can
// mask another's side effects.
//
// `kind` selects the expectation set and, for the three Bull-semantics jobs,
// the mechanism `driveJob` applies before or during the job:
//   'export'    plain enqueue; the expectation set is the job's own name
//   'retry'     enqueued with `attempts: 2`, so Bull re-runs the processor
//   'stalled'   locked by a second instance, its lock deleted, then recovered
//               through Bull's own stalled check
//   'lock-loss' processed with an already-expired lock, so Bull raises its own
//               "Missing lock" error into the worker's `error` handler
var JOBS = Object.freeze([
  Object.freeze({
    name        : 'success',
    kind        : 'export',
    action      : 'bulk-export',
    exportId    : HARNESS_IDS.exportSuccess,
    user        : 'user',
    description : 'the successful export: every AAP 0.9.3 success assertion, ' +
                  'plus Bull\'s own completed event and the removal job.remove() ' +
                  'performs'
  }),
  Object.freeze({
    name        : 'missing-user',
    kind        : 'export',
    action      : 'bulk-export',
    exportId    : HARNESS_IDS.exportMissingUser,
    user        : 'missingUser',
    description : 'fails at the user lookup with `User not found`; no user was ' +
                  'resolved, so the failure mail is NOT sent'
  }),
  Object.freeze({
    name        : 'late-failure',
    kind        : 'export',
    action      : 'bulk-export',
    exportId    : 'missingExport',
    user        : 'user',
    description : 'a resolved user and an absent Export document, so the chain ' +
                  'reaches the completion update with a null record and throws ' +
                  'in sendCompletionEmail: this is the case where a temporary ' +
                  'file EXISTS and is cleaned and where the failure mail IS sent'
  }),
  Object.freeze({
    name        : 'unknown-action',
    kind        : 'export',
    action      : 'not-a-real-action',
    exportId    : HARNESS_IDS.exportUnknownAction,
    user        : 'user',
    description : 'the processor\'s own rejection branch, which reaches the ' +
                  'failed handler WITHOUT entering the export chain, so that ' +
                  'handler is the only writer of status and errorMessage'
  }),
  Object.freeze({
    name        : 'retry',
    kind        : 'retry',
    action      : 'not-a-real-action',
    exportId    : HARNESS_IDS.exportRetry,
    user        : 'user',
    attempts    : 2,
    description : 'Bull 4 retry semantics: `attempts: 2` on a rejecting ' +
                  'processor, so Bull runs it twice and the failed handler ' +
                  'sees attemptsMade 1 then 2'
  }),
  Object.freeze({
    name        : 'stalled',
    kind        : 'stalled',
    action      : 'not-a-real-action',
    exportId    : HARNESS_IDS.exportStalled,
    user        : 'user',
    description : 'Bull 4 stalled-job recovery: a second instance takes the ' +
                  'job, its lock is deleted, Bull\'s own stalled check moves it ' +
                  'back to wait, and the WORKER\'s processor picks it up'
  }),
  Object.freeze({
    name        : 'lock-loss',
    kind        : 'lock-loss',
    // A bulk-export job for the ABSENT user, chosen for its duration and its
    // emptiness: the processor spends a few milliseconds in the database before
    // it throws, which is the window the lock has to disappear inside, and it
    // reaches neither the upload nor the mail on any worker state. The
    // processor's own unknown-action branch was tried first and rejected: it
    // rejects in well under a millisecond, so the lock is still there when
    // Bull checks it.
    action      : 'bulk-export',
    exportId    : HARNESS_IDS.exportLockLoss,
    user        : 'missingUser',
    description : 'the queue-level `error` payload: the job\'s lock is taken ' +
                  'away while its processor runs, so Bull raises its own ' +
                  '"Missing lock for job N failed" into the worker\'s error ' +
                  'handler instead of recording an outcome'
  })
]);

// The fields the determinism comparison normalizes, and the only ones. Each is
// here because it is generated by the clock, by the run, or by a library, and
// each is still asserted for SHAPE where a shape assertion is possible - the
// filename against /^trinket-export-[0-9a-f]{12}\.zip$/, `expiresAt` against
// the three-day horizon, `fileSize` against the stored bytes. Nothing is
// normalized merely because it differed.
var VOLATILE = Object.freeze([
  'prefix',          // the run's Bull key prefix, generated per run
  'keyPrefix',       // the same value as Bull reports it back
  'jobId',           // Bull's own counter, restarted by the fresh namespace
  'filename',        // sha1(userId + a timestamp), in processBulkExport
  's3Key',           // 'exports/' + userId + '/' + filename
  'downloadUrl',     // host + '/' + s3Key
  'expiresAt',       // new Date() + EXPORT_EXPIRY_DAYS
  'fileSize',        // the zip embeds timestamps, so its length can move
  'etag',            // md5 of those same bytes
  // 'database' and 'uri' are no longer recorded as evidence fields at all -
  // `evidence.dataStore` carries the store's configuration digest instead - and
  // they stay in this list as a guard: any nested occurrence, such as one
  // inside a fixture's own description, is still generated per run by
  // mongo.generateDatabaseName or carries the in-memory server's port.
  'database',
  'uri',
  // Recorded as `ephemeral:` labels rather than paths, so their values no
  // longer move between runs; still normalized here, because a caller-supplied
  // --run-dir changes the basename the label ends in.
  'runDir',
  's3Root',
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
  'dependencies', 'sourceAnchors', 'seed', 'jobs', 'warnings', 'handles',
  'teardown'
]);

// Every teardown step, by name and in order. `assertTeardown` compares the
// list teardown returned against this one, because a count is satisfied by the
// wrong sixteen steps and a step deleted during a later edit would otherwise
// disappear without a failure. Each step also names the RESOURCE it closes,
// and a step may be skipped exactly when the run recorded that resource as
// never opened - which is what lets one teardown serve a Bull 4 worktree and a
// baseline one without either forgiving a leak or inventing a failure.
var TEARDOWN_STEPS = Object.freeze([
  'stop observing the queue',
  'restore the update recorder',
  'close the stalling queue instance',
  'flush the fixture evidence logs',
  'restore the fixtures',
  'obliterate this run\'s Bull namespace',
  'guard the queue\'s Redis clients against a post-close error',
  'close every queue through lib/util/queues.js closeAll()',
  'restore the bull module',
  'quit the redis client config/redis.js opened',
  'restore nunjucks and prove no filesystem watcher was started',
  'disconnect mongoose',
  'disconnect the tool graph\'s own mongoose',
  'stop the in-memory MongoDB',
  'restore the working directory',
  'remove the run directory this harness created'
]);

// THERE IS NO WARNING ALLOWANCE, and the list that used to hold one is gone
// rather than emptied: it lives in test/parity/warning-policy.js, where
// `ALLOWANCES` is empty for every gate at once.
//
// The entry it held named the compress-commons DEP0005 reached through
// archiver 2.1.1 and printed it as an allowed "deviation". Nothing authorized
// that - and the notice itself is gone, cleared at its source by moving
// archiver to 6.0.2 rather than by excusing it here. AAP 0.7 and 0.5.1.4 grant exactly two deviations from this
// migration - the file-stream response and the `marked` audit high - and
// neither is a warning; 0.9.5 states that no exception is granted to the plan
// by the plan; and 0.9.3's pass condition covers "any dependency this plan
// retains" explicitly, which is precisely what archiver is. So the notice is a
// GATE FAILURE here, and it stays one until the dependency decision that owns
// archiver removes the emitting path. Clearing it is not this harness's call to
// make, and neither is excusing it.

// Handle allowance. There is no allowance for a handle this harness or the
// application opened: every one of those is closed in teardown and the closing
// is asserted, which is what keeps a genuinely leaked connection, queue, socket
// or timer visible. The single entry below is not such a handle - it is this
// process's own stdio, whose existence depends on how the process was invoked.
// The nunjucks/chokidar watchers that used to sit here are not started at all
// any more: `installTemplateWatchSuppression` passes `watch: false` through
// nunjucks' own `configure`, and teardown asserts that no chokidar module even
// entered the require cache. See the header.
//
// The measurement that made the old shortfall real is kept, because it is why
// the suppression exists: `lib/util/nunjucks.js:8` calls
// `nunjucks.configure(..., {watch: config.isDev || config.isTest})`, so under
// NODE_ENV=test the FileSystemLoader watched every directory under
// `config.app.templates`, and nunjucks 3.2.4 keeps the FSWatcher in a
// constructor-local variable with no `watcher` property on the loader - so no
// caller could close it. docs/preserved-quirks.md 10.3 owns that measurement.
var HANDLE_ALLOWANCES = Object.freeze([
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
  'Drives the export worker through ' + JOBS.length + ' deterministic jobs on a',
  'real Bull 4 queue in a per-run Redis namespace, against an isolated MongoDB',
  'and the S3 and mail fixtures, and asserts the persisted documents, the',
  'archive, the upload, the mail and Bull\'s own completion, failure, retry and',
  'stalled semantics.',
  '',
  'Options:',
  '  --app <path>            worktree under test (default: this file\'s own).',
  '  --overlay <path>        NODE_CONFIG overlay (default:',
  '                          test/parity/server-overlay.json beside this file).',
  '  --redis <host:port>     Redis for the Bull queue (default: ' +
    DEFAULT_REDIS_HOST + ':' + DEFAULT_REDIS_PORT + ').',
  '                          The per-run key prefix is what isolates the run.',
  '  --run-dir <path>        per-run directory; created if absent. A directory',
  '                          given here is never removed. Default: a unique',
  '                          directory in os.tmpdir(), removed on a clean run.',
  '  --keep-run-dir          keep a run directory this harness created, even on',
  '                          a clean run, so the fixture logs survive.',
  '  --out <path>            write the evidence artifact as JSON. The',
  '                          provenance record is embedded in the evidence',
  '                          either way, and with --out it is also written to',
  '                          <path>.provenance.json with a digest of the bytes',
  '                          as written.',
  '  --compare <path>        compare this run against a previous artifact and',
  '                          fail on any non-volatile difference.',
  '  --worker-module <path>  the module to require as the worker, relative to',
  '                          appRoot (default: lib/workers/exports). A CONTROL.',
  '  --timeout <ms>          overall bound (default: ' + OVERALL_TIMEOUT_MS + ').',
  '  --job-timeout <ms>      per-job bound (default: ' + JOB_TIMEOUT_MS + ').',
  '  --help                  this text.',
  '',
  'Option rules: no option is repeatable - a second occurrence, in either the',
  '`--flag value` or the `--flag=value` spelling, is a usage error and never a',
  'last-one-wins - and a value beginning with "-" is a usage error, so a',
  'missing value cannot swallow the following option. Use --flag=-value when a',
  'value really begins with a dash.',
  '',
  'Exit: 0 pass, 1 failure, timeout, a leaked handle or a teardown step that',
  'did not complete - a leaked connection or process is a failed run - 2 usage.'
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

// Counter behind the temporary filename in writeArtifactAtomically, so two
// artifacts written in the same millisecond by the same process cannot
// collide.
var artifactSequence = 0;

/**
 * Writes an artifact atomically, creating its directory if needed.
 *
 * The bytes go to a unique temporary file in the artifact's own directory,
 * which is flushed, closed and then renamed over the target. A same-directory
 * rename is atomic, so a reader sees either the previous evidence file or the
 * complete new one - never a half-written one. Writing in place would let an
 * interruption or a full filesystem truncate the last known-good artifact, and
 * for a run whose whole product is its evidence that is the only copy that
 * mattered.
 *
 * The temporary file is removed on failure, so a failed write leaves the
 * previous artifact exactly as it found it.
 *
 * @param {string} out Destination path.
 * @param {string} text The artifact text.
 * @returns {undefined}
 * @throws {ToolError} If the artifact cannot be written.
 */
function writeArtifactAtomically(out, text) {
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
    fs.writeFileSync(descriptor, text);
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
 * fire-and-forget - the failed handler's update takes an empty
 * callback, and the temporary-file unlinks on both the success and failure
 * paths take one too - so
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
//   * stderr - the deprecation and warning notices, judged by
//     test/parity/warning-policy.js, which has no allowances.
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
 * @returns {Object} `{mode, appRoot, overlayPath, runDir, keepRunDir, outPath,
 *   comparePath, workerModule, redisHost, redisPort, timeoutMs, jobTimeoutMs}`
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
    keepRunDir   : false,
    outPath      : null,
    comparePath  : null,
    workerModule : 'lib/workers/exports',
    redisHost    : DEFAULT_REDIS_HOST,
    redisPort    : DEFAULT_REDIS_PORT,
    timeoutMs    : OVERALL_TIMEOUT_MS,
    jobTimeoutMs : JOB_TIMEOUT_MS
  };
  var i;
  var arg;
  var endpoint;
  var seen = {};

  // Reads the value for `name`, from `--name=value` when one is attached and
  // from the next token otherwise.
  //
  // A DASH-LEADING NEXT TOKEN IS A USAGE ERROR, not a value. `--out
  // --no-emitter-patch` used to write its evidence to a file called
  // "--no-emitter-patch" and then run WITHOUT the control flag it was told to
  // drop - two wrong things from one missing argument, neither of them
  // reported. The `=` form is the escape hatch for a path that genuinely
  // begins with a dash.
  function valueFor(name) {
    var equals = arg.indexOf('=');
    var value;

    if (equals > -1) {
      return arg.slice(equals + 1);
    }

    i += 1;

    if (i >= args.length) {
      throw new ToolError(name + ' requires a value');
    }

    value = args[i];

    if (typeof value === 'string' && value.charAt(0) === '-' && value !== '-') {
      throw new ToolError(name + ' requires a value, and ' +
        JSON.stringify(value) + ' is an option. Write ' + name + '=' +
        JSON.stringify(value) + ' if the value really begins with a dash.');
    }

    return value;
  }

  // NO OPTION HERE IS REPEATABLE. Two `--out` paths mean one of the two
  // artifacts this run was asked for does not exist, and two `--compare`
  // baselines mean the determinism check ran against a file the caller did not
  // name - both silently, under an exit code that says the run did what it was
  // told. Tracked by option NAME, so `--out x --out=y` is caught as well.
  function once(name) {
    if (seen[name]) {
      throw new ToolError(name + ' was given more than once; no option here ' +
        'is repeatable, so two values would mean this run silently discarded ' +
        'one of them.');
    }

    seen[name] = true;

    return name;
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

    // The option's name, with any `=value` removed, so both spellings of the
    // same option share one duplicate check.
    once(arg.indexOf('=') > 0 ? arg.slice(0, arg.indexOf('=')) : arg);

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
    else if (arg === '--keep-run-dir') {
      options.keepRunDir = true;
    }
    else if (arg === '--redis' || arg.indexOf('--redis=') === 0) {
      // `host:port`, both required, because a half-specified endpoint that
      // silently kept the default port is exactly the sort of isolation
      // failure this option exists to prevent.
      endpoint = String(valueFor('--redis')).split(':');

      if (endpoint.length !== 2 || endpoint[0] === '') {
        throw new ToolError('--redis requires `host:port`; got ' +
          JSON.stringify(endpoint.join(':')));
      }

      options.redisHost = endpoint[0];
      options.redisPort = positiveInteger('--redis port', endpoint[1]);
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

/**
 * Refuses to produce evidence in a process that may already be contaminated.
 *
 * The harnesses that spawn the application REMOVE the preload and resolution
 * vectors from the child's environment (mongo.PRELOAD_ENV_VARS carries the
 * list and the reasoning). This harness cannot do that, and the difference is
 * structural rather than an oversight: it loads `lib/workers/exports` into ITS
 * OWN process, so by the time any line of this file runs, an ambient
 * `NODE_OPTIONS=--require ...` has already executed and an ambient `NODE_PATH`
 * has already changed where `mongoose`, `bull` and `aws-sdk` resolve from.
 * Deleting the variable at that point would remove the evidence of the
 * contamination and none of its effects.
 *
 * So this run refuses instead. Every Bull-semantics assertion below - processor
 * promise completion, `job.id` in the `failed` handler, `job.remove()` on
 * `completed` - is an assertion about the retained dependency in the tree under
 * test, and it is worth nothing if some other module was given the chance to
 * patch that dependency first. Failing closed with the remedy named is the only
 * honest outcome.
 *
 * @returns {undefined}
 * @throws {ToolError} If any preload vector is set in this process.
 */
function assertUncontaminatedProcess() {
  var offenders = mongo.PRELOAD_ENV_VARS.filter(function(name) {
    return process.env[name] !== undefined && process.env[name] !== '';
  });

  if (!offenders.length) {
    return;
  }

  throw new ToolError(offenders.join(' and ') + ' ' +
    (offenders.length === 1 ? 'is' : 'are') + ' set in this process. This ' +
    'harness requires the worker into its own process, so a preload has ' +
    'already run and a redirected module path has already taken effect - ' +
    'every assertion about the worker\'s dependencies would then be an ' +
    'assertion about whatever was preloaded. Unset ' + offenders.join(' and ') +
    ' and run again; interpreter flags belong in the command line, where ' +
    'they are visible in this run\'s recorded execArgv.');
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
 * than five.
 *
 * OWNERSHIP DECIDES LIFETIME, and `owned` is the flag that carries it into
 * teardown rather than a value nobody reads. A directory this function created
 * is created with `mkdtempSync`, so the name cannot be predicted or
 * pre-created by anything else, and `removeRunDirectory` deletes it when the
 * run had no failures - `--keep-run-dir` and a failed run both retain it, and
 * the retained path is printed, because that is exactly when the fixture
 * evidence logs inside it are worth reading. A caller-supplied directory is
 * reused and NEVER removed: its lifetime belongs to the caller.
 *
 * @param {(string|null)} requested
 * @returns {Object} The layout.
 * @throws {ToolError} If a directory cannot be created.
 */
function createRunDirectory(requested) {
  var owned = requested === null || requested === undefined;
  var base;
  var layout;

  if (owned) {
    try {
      base = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX_STEM + '-'));
    }
    catch (err) {
      throw new ToolError('could not create a run directory under ' +
        os.tmpdir() + ': ' + err.message);
    }
  }
  else {
    base = path.resolve(requested);
  }

  layout = {
    runDir          : base,
    owned           : owned,
    // The system temporary root as it is NOW. `applyEnvironment` points TMPDIR
    // at a directory inside this one, so `os.tmpdir()` stops answering for the
    // system root a moment later - measured, by a removal that refused itself
    // because the run directory was no longer "inside" the temp directory.
    tmpRoot         : (function() {
      try {
        return fs.realpathSync(os.tmpdir());
      }
      catch (err) {
        return os.tmpdir();
      }
    })(),
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

/**
 * Removes a run directory this harness created, and refuses anything else.
 *
 * Three conditions, all required, because a recursive delete driven by a path
 * is only ever as safe as the checks in front of it: the layout must say the
 * directory is OWNED, the resolved real path must still be inside the system
 * temporary directory, and its basename must carry this file's own stem. A
 * caller-supplied directory, a retained one and anything that fails a check are
 * reported as `kept` with the reason, never deleted.
 *
 * @param {Object} layout From createRunDirectory.
 * @param {boolean} keep Whether the caller asked to retain it.
 * @returns {Object} `{removed, kept, refused, reason, path}` - `refused` means
 *   a check failed, which teardown treats as an error rather than as a keep.
 */
function removeRunDirectory(layout, keep) {
  var real;

  if (!layout) {
    return { removed : false, kept : false, refused : false,
      reason : 'no run directory', path : null };
  }

  if (!layout.owned) {
    return { removed : false, kept : true, refused : false,
      reason : 'caller-supplied', path : layout.runDir };
  }

  if (keep) {
    return { removed : false, kept : true, refused : false,
      reason : 'retained', path : layout.runDir };
  }

  try {
    real = fs.realpathSync(layout.runDir);
  }
  catch (err) {
    return { removed : false, kept : false, refused : false,
      reason : 'already gone (' + err.code + ')', path : layout.runDir };
  }

  if (real.indexOf(layout.tmpRoot + path.sep) !== 0 ||
      path.basename(real).indexOf(PREFIX_STEM + '-') !== 0) {
    // Refused, not kept: the layout said this directory was the harness's own
    // and the path does not look like one, so something is wrong with the
    // bookkeeping rather than with the request. Teardown fails on this.
    return { removed : false, kept : false, refused : true,
      reason : 'not inside ' + layout.tmpRoot + ' under ' + PREFIX_STEM +
        '- (' + real + ')', path : real };
  }

  fs.rmSync(real, { recursive : true, force : true });

  return { removed : !fs.existsSync(real), kept : false, refused : false,
    reason : 'owned', path : real };
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
      'no exports bucket although lib/workers/exports.js reads its `name` ' +
      'and its `host` for the download URL, so without it the worker throws on ' +
      'its first '  +
      'upload. config/default.yaml is not edited - AAP 0.6.7 records the gap ' +
      'as an existing deployment requirement.');
  }

  // A copy, so the caller's overlay file is untouched and so `app.start` can be
  // removed without the removal leaking into anything else that reads it.
  overlay = JSON.parse(JSON.stringify(overlay));

  if (overlay.app && overlay.app.start !== undefined) {
    delete overlay.app.start;
  }

  // Redis ON, which is the whole difference between a queue that emits Bull's
  // events and one that emits nothing. The committed overlay disables it
  // because the server gates have no queue to exercise; this gate does, and it
  // is the only place in the parity tooling that says so. Both keys are set:
  // `lib/util/queues.js` reads `config.db.redis[name] || config.db.redis.app`,
  // so `exports` is what the queue itself resolves, while `app` is what
  // `config/redis.js` dials - and a run that set only one of them would leave
  // the other pointed at whatever committed configuration happens to say.
  overlay.db = overlay.db || {};
  overlay.db.redis = overlay.db.redis || {};
  overlay.db.redis.enabled = true;
  overlay.db.redis.app = {
    host : options.redisHost,
    port : options.redisPort
  };
  overlay.db.redis.exports = {
    host : options.redisHost,
    port : options.redisPort
  };

  address = await mongo.start({ overlay : overlay });

  process.env.NODE_ENV    = 'test';
  process.env.NODE_CONFIG = address.nodeConfig;

  // NODE_CONFIG_DIR plus the three runtime-layer controls, from ./mongo's one
  // implementation rather than a copy of the rule kept here. The addition over
  // what this function used to set is NODE_CONFIG_DISABLE_FILE_WATCH: `config`
  // 0.4.37 creates its runtime JSON unless persistence is off AND the watch is
  // disabled, so the redirect below was carrying the whole burden and a `config`
  // that ignored it would have written into the tree under test.
  mongo.isolateRuntimeConfig({
    appRoot         : options.appRoot,
    configDir       : 'set',
    runtimeJsonPath : layout.runtimeJsonPath
  });

  // `config` 0.4.37 watches runtime.json and re-reads it on every change,
  // logging `Error loading <path>` when the read fails. Measured: removing this
  // run's own directory in teardown fires that watcher three times, putting
  // library output into the very stderr stream this gate asserts on - noise
  // this harness creates, at the moment it is cleaning up after itself.
  // Disabling the watch is the supported way to stop it.
  process.env.NODE_CONFIG_DISABLE_FILE_WATCH = 'Y';

  process.env.PARITY_APP_ROOT = options.appRoot;
  process.env.PARITY_S3_ROOT  = layout.s3Root;
  process.env.PARITY_S3_LOG   = layout.s3LogPath;
  process.env.PARITY_MAIL_LOG = layout.mailLogPath;

  // hapi's payload `uploads` default and `tmp`'s scratch space both read these.
  // The worker's own temporary file is NOT covered by them - `processBulkExport`
  // hard-codes '/tmp/' + filename - which is why the cleanup assertions look
  // there.
  process.env.TMPDIR = layout.uploadsDir;
  process.env.TMP    = layout.uploadsDir;
  process.env.TEMP   = layout.uploadsDir;

  // An inherited seed manifest from an unrelated run would be read once at
  // fixture load and would place objects this run never asked for.
  delete process.env.PARITY_S3_SEED;

  process.chdir(options.appRoot);

  note('database ' + address.database + ' at ' + address.uri);
  note('run directory ' + layout.runDir);
  note('redis ' + options.redisHost + ':' + options.redisPort);

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
 * UNconfigured it would instead short-circuit to `{skipped: true}`
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
// The Bull namespace, the event observer and the watcher ownership
// ---------------------------------------------------------------------------

/**
 * The version of the package a resolved module file belongs to.
 *
 * Walks up from the file to the nearest `package.json` rather than assuming the
 * module's own directory is the package root - `bull`'s entry point is one
 * directory down, and a hard-coded `dirname` would have thrown on some other
 * layout inside the one expression in this file that has no fallback.
 *
 * @param {string} modulePath An absolute path to a resolved module file.
 * @returns {string} The version, or 'unknown'.
 */
function packageVersion(modulePath) {
  var directory = path.dirname(modulePath);
  var candidate;
  var parent;

  for (;;) {
    candidate = path.join(directory, 'package.json');

    if (fs.existsSync(candidate)) {
      try {
        return require(candidate).version || 'unknown';
      }
      catch (err) {
        return 'unknown';
      }
    }

    parent = path.dirname(directory);

    if (parent === directory) {
      return 'unknown';
    }

    directory = parent;
  }
}

/**
 * Gives this run its own Bull keyspace, by adding one option to the `bull`
 * module the application resolves.
 *
 * A queue's NAME is its Redis keyspace - Bull addresses everything under
 * `<prefix>:<name>:*` - and the worker's queue must be named `exports`, because
 * that is the identity `lib/util/queues.js` builds and the worker registers
 * against. `lib/util/queues.js` forwards only host, port and password, by
 * design, and this file does not edit it. So the isolation is applied where it
 * belongs: the module's export is replaced, for the duration of the run, by a
 * wrapper that constructs the GENUINE `Queue` with `prefix` merged into the
 * options.
 *
 * `prefix` is the only thing injected. Not `settings`, so the queue carries
 * Bull's own `lockDuration`, `stalledInterval` and `maxStalledCount` and the
 * run can assert they are the defaults; not `limiter` or
 * `defaultJobOptions`, so nothing about scheduling or retention is quietly
 * different from production. A caller-supplied prefix wins over the injected
 * one, since a caller that already isolated itself knows better than this
 * wrapper does.
 *
 * @param {string} appRoot
 * @param {string} prefix The per-run key prefix.
 * @returns {Object} `{module, prefix, constructed, restore}`
 * @throws {ToolError} If `bull` is not resolvable from appRoot or is not the
 *   constructor this wrapper expects.
 */
function installBullPrefix(appRoot, prefix) {
  var resolved;
  var real;
  var entry;
  var constructed = [];

  try {
    resolved = require.resolve('bull', { paths : [appRoot] });
  }
  catch (err) {
    throw new ToolError('`bull` is not resolvable from ' + appRoot + ' (' +
      ((err && err.code) || (err && err.message) || err) + '). This gate ' +
      'drives a real Bull queue, so the package has to be installed in the ' +
      'worktree under test.');
  }

  real  = require(resolved);
  entry = require.cache[resolved];

  if (typeof real !== 'function' || !real.prototype ||
      typeof real.prototype.process !== 'function' ||
      typeof real.prototype.add !== 'function' || !entry) {
    throw new ToolError('the `bull` export at ' + resolved + ' is not the ' +
      'Queue constructor this harness expects (needs prototype.process and ' +
      'prototype.add)');
  }

  function ParityQueue(name, options) {
    var merged = {};
    var queue;

    Object.keys(options || {}).forEach(function(key) {
      merged[key] = options[key];
    });

    if (merged.prefix === undefined) {
      merged.prefix = prefix;
    }

    queue = new real(name, merged);
    constructed.push({ name : name, prefix : queue.keyPrefix });

    return queue;
  }

  // The wrapper has to survive every way `lib/util/queues.js` could use the
  // module: `new Queue(...)` returns the genuine instance because a
  // constructor that returns an object overrides `this`, sharing the prototype
  // keeps `instanceof` true, and the statics are carried across so that a
  // caller reaching for one finds it.
  ParityQueue.prototype = real.prototype;

  Object.getOwnPropertyNames(real).forEach(function(key) {
    if (['length', 'name', 'prototype', 'caller', 'arguments'].indexOf(key) > -1) {
      return;
    }

    try {
      ParityQueue[key] = real[key];
    }
    catch (err) {
      // A non-writable static is not something this wrapper needs to carry;
      // the constructor below is the genuine one either way.
      void err;
    }
  });

  entry.exports = ParityQueue;

  return {
    module      : resolved,
    prefix      : prefix,
    constructed : constructed,

    /**
     * Puts the genuine constructor back. Idempotent, and asserted in teardown:
     * a harness that left a patched module behind would make every later
     * require of `bull` in this process build prefixed queues.
     *
     * @returns {boolean} Whether the module now exports the genuine Queue.
     */
    restore : function() {
      entry.exports = real;

      return require(resolved) === real;
    },

    /**
     * Whether the module is currently patched, for the teardown assertion.
     *
     * @returns {boolean}
     */
    patched : function() {
      return entry.exports === ParityQueue;
    }
  };
}

/**
 * What the selected application's queue ACTUALLY is - measured, recorded, and
 * never a reason to stop measuring.
 *
 * `--app` exists so that this harness, which lives only in the migrated
 * worktree, can drive an INDEPENDENTLY INSTALLED one (AAP 0.9.3). Such a
 * worktree resolves its own dependency graph, and the baseline worktree at
 * `2f8712a` resolves bull 0.7.2 - a queue with `on`, `add`, `getJob` and
 * `process`, and without Bull 4's `moveUnlockedJobsToWait`, `obliterate`,
 * ioredis-shaped clients or `prefix` support. An earlier revision asserted the
 * Bull 4 surface while merely CONSTRUCTING the observer, so it threw during
 * setup and the run produced no load-order measurement, no fixtures and no
 * capability diagnosis: it refused the very architecture it was built for.
 *
 * This function replaces that refusal with a measurement. Two facts are
 * separated because they fail for different reasons and carry different
 * consequences:
 *
 *   `bull4Api`  the semantic surface the assertions in this file drive. Absent
 *               means the assertions cannot mean what they say.
 *   `isolated`  whether the injected `prefix` actually took effect, i.e.
 *               `keyPrefix` is this run's namespace. Bull 0.7.2 ignores the
 *               option, so its keyspace is the SHARED `bull:exports:*` that
 *               every clone on this host would share.
 *
 * `usable` is both together, and it is what gates enqueueing. Refusing to add
 * a job to a namespace this run cannot isolate is not caution about Bull
 * versions - the clone contract on this host is explicit that two agents with
 * Redis enabled would share `bull:exports:*` - and a gate that polluted a
 * sibling's keyspace to produce its own evidence would be trading someone
 * else's run for its own.
 *
 * @param {Object} queue The queue lib/util/queues.js returned.
 * @param {Object} options `{modulePath, expectedPrefix, redis}`
 * @returns {Object} The surface record, which goes into the artifact verbatim.
 */
function probeQueueSurface(queue, options) {
  var api = {};
  var clients = {};
  var settings = null;
  var missing = [];
  var version = packageVersion(options.modulePath);
  var bull4Api;
  var isolated;

  ['add', 'getJob', 'process', 'on', 'close', 'isReady', 'getJobCounts',
    'moveUnlockedJobsToWait', 'obliterate', 'toKey'].forEach(function(name) {
      api[name] = typeof queue[name] === 'function';

      if (!api[name]) {
        missing.push(name + '()');
      }
    });

  // ioredis reports a string `status` per client; node_redis 0.x/2.x, which
  // bull 0.7.2 uses, reports none. That difference is why teardown cannot
  // assert `status === 'end'` unconditionally.
  ['client', 'bclient', 'eclient'].forEach(function(key) {
    var client = queue[key];

    clients[key] = client
      ? { present : true, status : typeof client.status === 'string'
          ? client.status
          : null, ioredis : typeof client.status === 'string' }
      : { present : false, status : null, ioredis : false };

    if (!clients[key].ioredis) {
      missing.push(key + '.status');
    }
  });

  if (queue.settings && typeof queue.settings === 'object') {
    settings = {
      lockDuration    : queue.settings.lockDuration,
      stalledInterval : queue.settings.stalledInterval,
      maxStalledCount : queue.settings.maxStalledCount
    };
  }
  else {
    missing.push('settings');
  }

  bull4Api = missing.length === 0;
  isolated = queue.keyPrefix === options.expectedPrefix;

  return {
    package     : 'bull ' + version,
    version     : version,
    module      : options.modulePath,
    constructor : queue.constructor ? queue.constructor.name : null,
    name        : queue.name,
    prefix      : options.expectedPrefix,
    keyPrefix   : typeof queue.keyPrefix === 'string' ? queue.keyPrefix : null,
    redis       : options.redis,
    injected    : ['prefix'],
    emission    : 'bull',
    api         : api,
    clients     : clients,
    settings    : settings,
    missing     : missing,
    bull4Api    : bull4Api,
    isolated    : isolated,
    usable      : bull4Api && isolated,
    remedy      : 'install the migrated dependency set in ' +
                  (options.appRoot || 'the selected worktree') +
                  ' (npm ci against the migrated package-lock.json, which ' +
                  'resolves bull 4.16.5 per AAP 0.5.1.2). This gate asserts ' +
                  'Bull 4 semantics - processor promise completion, job.id in ' +
                  'the failed handler, job.remove() on completed, retry, ' +
                  'stalled and lock-loss - and it will not enqueue into a ' +
                  'keyspace it cannot isolate by prefix.'
  };
}

/**
 * Records what Bull emits, per job, and emits nothing itself.
 *
 * THIS IS THE FILE'S CENTRAL DISCIPLINE. The events asserted downstream -
 * `completed`, `failed`, `error`, `stalled`, `active` - all come from Bull
 * 4.16.5 running against a real Redis; the observer only listens. It attaches
 * its own listeners ALONGSIDE the worker's, which changes nothing about what
 * Bull does and is removed again in teardown.
 *
 * Per job it records: the Job object Bull handed the event, whether that object
 * carries a `jobId` own property (Bull 4 removed it, and the worker's failed
 * handler reads `job.id` instead), how many completions and failures arrived,
 * `attemptsMade` per failure, the resolved value, the error, and a promise that
 * settles when the job reaches a terminal event. `attempts` is honoured: a job
 * added with two attempts is not terminal on its first failure, so `settled`
 * waits for the last one.
 *
 * @param {Object} queue The real Bull queue.
 * @returns {Object} The observer.
 * @throws {ToolError} If the queue is not the Bull queue this observer expects.
 */
function installQueueObserver(queue) {
  var records = [];
  var byId    = {};
  var queueErrors = [];
  var stalled = [];
  var active  = [];
  var listeners = {};

  // Only what LISTENING needs, deliberately. The Bull 4 methods the semantic
  // assertions drive - `moveUnlockedJobsToWait`, `obliterate`, the ioredis
  // clients - are NOT required here, because a queue that lacks them is a
  // measurement this gate has to report rather than a reason to abandon the
  // run before it has measured anything else. `probeQueueSurface` records what
  // the selected application actually resolved and `assertQueueIsRealBull`
  // turns any shortfall into a named FAILED check; observing is what stays
  // possible either way.
  if (!queue || typeof queue.on !== 'function' ||
      typeof queue.add !== 'function') {
    throw new ToolError('the exports queue cannot even be observed (needs on ' +
      'and add). lib/util/queues.js returned ' +
      (queue ? queue.constructor.name : String(queue)) + '.');
  }

  function recordFor(id, expectedAttempts) {
    var key = String(id);
    var record;
    var settle;

    if (byId[key]) {
      return byId[key];
    }

    record = {
      id                : key,
      job               : null,
      hasJobIdField     : null,
      completedCount    : 0,
      failedCount       : 0,
      attemptsMade      : [],
      expectedAttempts  : expectedAttempts || 1,
      stalledCount      : 0,
      activeCount       : 0,
      result            : undefined,
      error             : null,
      settled           : null
    };

    record.settled = new Promise(function(resolve) {
      settle = resolve;
    });

    record.settle = function() {
      settle(record);
    };

    records.push(record);
    byId[key] = record;

    return record;
  }

  function capture(job) {
    var record = recordFor(job && job.id);

    record.job           = job;
    record.hasJobIdField = job
      ? Object.prototype.hasOwnProperty.call(job, 'jobId')
      : null;

    return record;
  }

  listeners.completed = function(job, result) {
    var record = capture(job);

    record.completedCount += 1;
    record.result = result;
    record.settle();
  };

  listeners.failed = function(job, err) {
    var record = capture(job);

    record.failedCount += 1;
    record.error = err || new Error('Bull emitted `failed` with a falsy error');
    record.attemptsMade.push(job && job.attemptsMade);

    // Bull emits `failed` on every attempt, so a retrying job is terminal only
    // once its attempts are spent. Waiting for the count is what makes the
    // retry assertion an assertion rather than a race.
    if (record.failedCount >= record.expectedAttempts) {
      record.settle();
    }
  };

  listeners.error = function(err) {
    queueErrors.push({
      name    : (err && err.name) || 'Error',
      message : (err && err.message) || String(err)
    });
  };

  listeners.stalled = function(job) {
    var record = capture(job);

    record.stalledCount += 1;
    stalled.push(String(job && job.id));
  };

  listeners.active = function(job) {
    var record = capture(job);

    record.activeCount += 1;
    active.push(String(job && job.id));
  };

  Object.keys(listeners).forEach(function(event) {
    queue.on(event, listeners[event]);
  });

  return {
    records : records,

    /**
     * Declares the attempt count for a job before it is enqueued, so the
     * `settled` promise knows when that job is terminal.
     *
     * @param {(string|number)} id
     * @param {number} attempts
     * @returns {Object} The record.
     */
    expect : function(id, attempts) {
      var record = recordFor(id, attempts);

      record.expectedAttempts = attempts || 1;

      return record;
    },

    recordFor : function(id) {
      return byId[String(id)] || null;
    },

    queueErrors : function() {
      return queueErrors.slice();
    },

    stalledIds : function() {
      return stalled.slice();
    },

    activeIds : function() {
      return active.slice();
    },

    /**
     * The worker's own listener counts, measured as a DELTA against the counts
     * taken before the worker was required. Bull registers one internal
     * `error` listener of its own at construction, so an absolute count would
     * be a fact about Bull's version rather than about the worker.
     *
     * @param {Object} baseline From listenerCounts() before the worker loaded.
     * @returns {Object} `{error, failed, completed}` deltas.
     */
    workerListeners : function(baseline) {
      var counts = {};

      ['error', 'failed', 'completed'].forEach(function(event) {
        // This observer's own listener is subtracted, because it is not the
        // worker's and counting it would hide a worker that registered none.
        counts[event] = queue.listenerCount(event) - (baseline[event] || 0) - 1;
      });

      return counts;
    },

    restore : function() {
      Object.keys(listeners).forEach(function(event) {
        queue.removeListener(event, listeners[event]);
      });

      return ['completed', 'failed', 'error', 'stalled', 'active']
        .every(function(event) {
          return queue.listeners(event).indexOf(listeners[event]) === -1;
        });
    }
  };
}

/**
 * The listener counts on a queue, for the delta the observer reports.
 *
 * @param {Object} queue
 * @returns {Object} `{error, failed, completed}`
 */
function listenerCounts(queue) {
  return {
    error     : queue.listenerCount('error'),
    failed    : queue.listenerCount('failed'),
    completed : queue.listenerCount('completed')
  };
}

/**
 * Stops the application's TEMPLATE WATCHING for this one-shot run, so the
 * harness starts no filesystem watcher and depends on no undeclared package.
 *
 * Requiring `lib/util/nunjucks.js` - which the worker's require graph does,
 * through config/app.config and lib/util/routeParser - calls
 * `nunjucks.configure(config.app.templates, {watch: config.isDev ||
 * config.isTest, ...})`. Under NODE_ENV=test that `watch` is true, and
 * nunjucks 3.2.4's FileSystemLoader then does two things this gate cannot
 * live with (node-loaders.js, the `if (opts.watch)` branch):
 *
 *   it `require`s `chokidar`, which THIS REPOSITORY DOES NOT DECLARE. AAP
 *   0.5.1.3 removes it as dead, and it is present only because npm 7 and
 *   later install nunjucks' optional peer automatically. A gate that reaches
 *   for it is a gate whose result depends on an install detail nobody
 *   declared;
 *
 *   and it keeps the resulting FSWatcher in a constructor-local variable, so
 *   nothing can reach it to close it. Left running it keeps the event loop
 *   alive, which is what made an earlier revision allow-list FSEventWrap
 *   handles and force its own exit.
 *
 * Both follow from ONE option, so one option is what this changes: `configure`
 * is wrapped before the first application require and the wrapper passes
 * `watch: false` through to the genuine implementation, having normalized the
 * arguments exactly as nunjucks itself does (an object in the first position
 * IS the options object). Nothing else is touched - the template search paths,
 * `autoescape`, the returned Environment and every render are the
 * application's own - and the wrapper is removed in teardown.
 *
 * What is lost is template hot-reload, which a process that renders once and
 * exits cannot use, and which `lib/util/nunjucks.js` already defeats for
 * itself by clearing `env.cache` on every render under isTest. What is gained
 * is a run that starts no watcher at all rather than one that closes the
 * watchers it started, and a harness whose dependency set is the declared one.
 *
 * The chokidar provenance is still MEASURED and recorded - resolvable or not,
 * declared or not, and whether any chokidar module entered this process's
 * require cache - because the application's own reliance on it under
 * NODE_ENV=test is a real finding that belongs in the artifact, owned by the
 * lanes that hold `package.json` and `lib/util/nunjucks.js`. Recording it is
 * this file's part; reaching for the package is not.
 *
 * @param {string} appRoot
 * @returns {Object} The suppression handle.
 */
function installTemplateWatchSuppression(appRoot) {
  var resolved = null;
  var nunjucks = null;
  var original = null;
  var calls = [];
  var version = null;
  var diagnostic = null;

  function isOptions(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function relative(target) {
    if (typeof target !== 'string') {
      return target;
    }

    return path.isAbsolute(target) ? path.relative(appRoot, target) : target;
  }

  try {
    resolved = require.resolve('nunjucks', { paths : [appRoot] });
    nunjucks = require(resolved);
    version  = require(path.join(path.dirname(resolved), 'package.json'))
      .version;
  }
  catch (err) {
    diagnostic = 'nunjucks is not resolvable from ' + appRoot + ' (' +
      ((err && err.code) || (err && err.message) || err) + ')';
  }

  if (nunjucks && typeof nunjucks.configure === 'function') {
    original = nunjucks.configure;

    nunjucks.configure = function(templatesPath, opts) {
      var target  = templatesPath;
      var options = opts;
      var forced  = {};
      var requested;

      if (isOptions(target)) {
        options = target;
        target  = null;
      }

      Object.keys(options || {}).forEach(function(key) {
        forced[key] = options[key];
      });

      requested   = forced.watch === true;
      forced.watch = false;

      calls.push({
        templates      : Array.isArray(target)
          ? target.map(relative)
          : relative(target),
        watchRequested : requested,
        watchApplied   : false
      });

      return original.call(nunjucks, target, forced);
    };
  }
  else if (nunjucks) {
    diagnostic = 'the nunjucks at ' + resolved + ' exposes no configure()';
  }

  /**
   * Whether any `chokidar` module is in this process's require cache, and
   * where it would resolve from if something asked. Resolving does not load:
   * `require.resolve` opens no file descriptor and starts no watcher.
   *
   * @returns {Object}
   */
  function chokidarState() {
    var loaded = Object.keys(require.cache).filter(function(file) {
      return /[\\/]node_modules[\\/]chokidar[\\/]/.test(file);
    });
    var resolvableFrom = null;
    var chokidarVersion = null;
    var declared = false;
    var peer = null;
    var nunjucksDir = resolved ? path.dirname(resolved) : appRoot;
    var manifest;

    try {
      resolvableFrom = require.resolve('chokidar', { paths : [nunjucksDir] });
      chokidarVersion = require(path.join(path.dirname(resolvableFrom),
        'package.json')).version;
    }
    catch (err) {
      resolvableFrom = null;
    }

    try {
      manifest = require(path.join(appRoot, 'package.json'));
      declared = Object.prototype.hasOwnProperty.call(
        manifest.dependencies || {}, 'chokidar') ||
        Object.prototype.hasOwnProperty.call(
          manifest.devDependencies || {}, 'chokidar');
    }
    catch (err) {
      declared = false;
    }

    // WHERE it would come from, measured rather than assumed: nunjucks'
    // OPTIONAL PEER declaration is the whole reason the package is on disk.
    try {
      manifest = require(path.join(nunjucksDir, 'package.json'));
      peer = manifest.peerDependencies && manifest.peerDependencies.chokidar
        ? 'nunjucks@' + manifest.version + ' optional peer chokidar@' +
          manifest.peerDependencies.chokidar
        : null;
    }
    catch (err) {
      peer = null;
    }

    return {
      loaded         : loaded.length > 0,
      modulesInCache : loaded.length,
      resolvableFrom : resolvableFrom ? relative(resolvableFrom) : null,
      version        : chokidarVersion,
      declared       : declared,
      installedAs    : peer
    };
  }

  return {
    /**
     * Puts `nunjucks.configure` back.
     *
     * @returns {boolean}
     */
    restore : function() {
      if (original) {
        nunjucks.configure = original;
      }

      return original === null || nunjucks.configure === original;
    },

    /**
     * Whether the wrapper is currently installed.
     *
     * @returns {boolean}
     */
    installed : function() {
      return original !== null && nunjucks.configure !== original;
    },

    describe : function() {
      var requested = calls.filter(function(entry) {
        return entry.watchRequested;
      }).length;

      return {
        nunjucks : {
          resolvedFrom : resolved ? relative(resolved) : null,
          version      : version
        },
        configureCalls : calls.length,
        watchRequested : requested,
        watchApplied   : 0,
        calls          : calls.slice(),
        chokidar       : chokidarState(),
        diagnostic     : diagnostic
      };
    }
  };
}

/**
 * The CURRENT line addresses of the application symbols this gate is written
 * against, read from the tree under test at run time.
 *
 * Copied line numbers rot. Every citation this artifact carries is therefore
 * GENERATED here from the source in front of it, so a reviewer following one
 * lands on the line that exists rather than the line that existed when the
 * comment was typed. A pattern that no longer matches is recorded as `null`
 * rather than asserted: the worker is another lane's file and a repaired worker
 * legitimately loses `Q.nsend` and `.stream()`, so their absence is
 * information, not a failure.
 *
 * @param {string} appRoot
 * @returns {Object} `{<file>: {<symbol>: (number|null)}}`
 */
function readSourceAnchors(appRoot) {
  var wanted = {
    'lib/util/queues.js' : {
      inMemoryOn      : /^InMemoryQueue\.prototype\.on\b/,
      inMemoryProcess : /^InMemoryQueue\.prototype\._processJob\b/,
      bullBranch      : /var Queue = require\('bull'\)/,
      bullConstructor : /cache\[name\] = new Queue\(name, opts\)/,
      inMemoryBranch  : /cache\[name\] = new InMemoryQueue\(name\)/,
      getterFactory   : /bullqueues\.forEach\(/,
      closeAll        : /module\.exports\.closeAll = /
    },
    'lib/workers/exports.js' : {
      queueRequire    : /require\('\.\.\/util\/queues'\)\.exports\(\)/,
      errorHandler    : /exportsQueue\.on\('error'/,
      failedHandler   : /exportsQueue\.on\('failed'/,
      completedHandler: /exportsQueue\.on\('completed'/,
      processor       : /exportsQueue\.process\(/,
      jobIdRead       : /console\.log\('exports failed job:'/,
      jobRemove       : /job\.remove\(\)/,
      tempFile        : /tempFile = '\/tmp\/' \+ filename/,
      s3Key           : /s3Key = 'exports\/' \+ userId \+ '\/' \+ filename/,
      firstNsend      : /Q\.nsend\(/,
      streamCall      : /\.stream\(\)/
    }
  };
  var anchors = {};

  Object.keys(wanted).forEach(function(file) {
    var lines;

    anchors[file] = {};

    try {
      lines = fs.readFileSync(path.join(appRoot, file), 'utf8').split('\n');
    }
    catch (err) {
      anchors[file] = { error : (err && err.message) || String(err) };
      return;
    }

    Object.keys(wanted[file]).forEach(function(symbol) {
      var pattern = wanted[file][symbol];
      var found   = null;
      var i;

      for (i = 0; i < lines.length && found === null; i++) {
        if (pattern.test(lines[i])) {
          found = i + 1;
        }
      }

      anchors[file][symbol] = found;
    });
  });

  return anchors;
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

  // A marker rather than a comparison, so teardown can assert the static was
  // put back without holding a second reference to the original.
  model.findByIdAndUpdate.parityRecorder = 'export-updates';

  return {
    calls   : calls,
    restore : function() {
      model.findByIdAndUpdate = original;
    }
  };
}

/**
 * A second Bull instance in the same namespace, whose only purpose is to hold a
 * job long enough for its lock to be taken away.
 *
 * The stalled case needs an instance that is NOT the worker to own the job when
 * the lock disappears, because that is what a crashed or blocked worker looks
 * like from Redis. This is that instance: same queue name, same prefix, same
 * Redis, its own processor. It is created PAUSED - locally, so it never
 * competes with the worker for any other job - and `driveJob` resumes it for
 * exactly the length of the stalled case.
 *
 * Its processor holds the job for `STALL_HOLD_MS` and then returns. It does not
 * hang forever, deliberately: a never-settling processor cannot be closed
 * gracefully, and this file's own gate is that everything it opened closes.
 * When the hold elapses the instance tries to finish a job it no longer owns
 * and Bull raises `Missing lock` on THIS queue, which is why the harness's own
 * error listener is attached here - that error belongs to the harness's
 * instance, is expected, and must not be confused with the one the worker's
 * handler is asserted on.
 *
 * @param {string} appRoot
 * @param {string} prefix The run's key prefix, so both instances agree.
 * @param {Object} redis `{host, port}`
 * @returns {Promise<Object>} `{queue, taken, errors, close}`
 */
async function createStallingInstance(appRoot, prefix, redis) {
  var Queue = requireAppPackage(appRoot, 'bull');
  var queue = new Queue('exports', {
    redis  : { host : redis.host, port : redis.port },
    prefix : prefix
  });
  var waiting = {};
  var errors  = [];

  queue.on('error', function(err) {
    errors.push((err && err.message) || String(err));
  });

  queue.process(function(job) {
    var key = String(job.id);

    if (waiting[key]) {
      waiting[key].resolve(key);
    }
    else {
      waiting[key] = { taken : Promise.resolve(key), resolve : null };
    }

    return sleep(STALL_HOLD_MS);
  });

  await queue.isReady();
  await queue.pause(true, true);

  return {
    queue : queue,

    /**
     * Resolves with the job id once this instance has taken it.
     *
     * @param {(string|number)} id
     * @returns {Promise<string>}
     */
    taken : function(id) {
      var key = String(id);
      var resolve;

      if (waiting[key]) {
        return waiting[key].taken;
      }

      waiting[key] = {
        taken : new Promise(function(settle) { resolve = settle; })
      };
      waiting[key].resolve = resolve;

      return waiting[key].taken;
    },

    errors : function() {
      return errors.slice();
    },

    /**
     * Closes the instance. `close()` waits for the held job, which is why the
     * hold is bounded; the bound is the harness's own timeout, so a stuck
     * instance fails teardown rather than hanging it.
     *
     * @returns {Promise<undefined>}
     */
    close : function() {
      return queue.close();
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
 * worker skips `nunjucks.configure` under `config.isTest`, so the
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
    // sendCompletionEmail passes to the template.
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
 * A copy of JavaScript source with its comments removed.
 *
 * Small and deliberate: it exists so that a call-site COUNT is a count of
 * calls. Block comments go first, then a line comment is removed only when its
 * `//` is outside a quoted string - which is what keeps a URL in a string
 * literal from truncating the rest of a line and hiding a real call after it.
 * Template literals are treated as quotes for the same reason. Nothing here
 * needs to parse JavaScript; it needs to be wrong in no direction that would
 * make a count too LOW.
 *
 * @param {string} source
 * @returns {string} The same source with comments blanked out.
 */
function stripComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map(function(line) {
      var quote = null;
      var i;
      var character;

      for (i = 0; i < line.length; i++) {
        character = line.charAt(i);

        if (quote) {
          if (character === '\\') {
            i += 1;
          }
          else if (character === quote) {
            quote = null;
          }

          continue;
        }

        if (character === '\'' || character === '"' || character === '`') {
          quote = character;
          continue;
        }

        if (character === '/' && line.charAt(i + 1) === '/') {
          return line.slice(0, i);
        }
      }

      return line;
    })
    .join('\n');
}

/**
 * Measures whether the worker's database idiom can work at all here.
 *
 * Two independent probes, both against the packages the worktree under test
 * resolves, and both reported whether they pass or fail:
 *
 *   `nsend` - `Q.nsend(Model, 'findById', id)`, which is the exact form the
 *     worker uses for the user lookup. `q` 1.0.1's ninvoke assimilates a
 *     thenable return
 *     value by calling `.then()` on it, and a mongoose 6 Query is a thenable,
 *     so the query executes twice and mongoose throws "Query was already
 *     executed". No document is needed for the probe: the second execution is
 *     what fails, not the lookup.
 *
 *   `stream` - whether `Query.prototype.stream` is a function.
 *     `createExportArchive` calls `.find(...).select(...).stream()`,
 *     and mongoose removed that method in 5.x.
 *
 * The result is a DIAGNOSIS, not a verdict. `exportPathUsable` is asserted by
 * the run - a worker that cannot complete an export fails this gate - and the
 * measurement exists so that the failure arrives with the error text, the call
 * sites and the remedy attached instead of as a bare timeout on a job that
 * never completed.
 *
 * @param {string} appRoot
 * @param {Object} mongooseInstance The application's mongoose.
 * @param {string} workerModule The module under test, relative to appRoot.
 * @returns {Promise<Object>} `{nsend, stream, exportPathUsable, remedy}`
 * @throws {ToolError} If the worker module's source cannot be read.
 */
async function probeCapabilities(appRoot, mongooseInstance, workerModule) {
  var Q = requireAppPackage(appRoot, 'q');
  // Fixed rather than generated: mongoose's own error text quotes the id, so a
  // generated one would make the recorded measurement differ between two runs
  // of identical behaviour. It belongs to no document - the probe fails on the
  // SECOND execution, not on the lookup - and it is outside the seeder's
  // blocks, so it can never collide with a fixture.
  var probeId = '0000000000000000000000fe';
  var probed = Boolean(mongooseInstance);
  var nsend = { usable : false, error : null, sites : 0 };
  var stream = { usable : false, error : null, sites : 0 };
  var source = '';
  var code   = '';

  // The RUNTIME half needs a registered model on a live connection, which only
  // exists once the worker's own require graph has run. When it has not - the
  // baseline worktree cannot require the worker at all (AAP 0.6.5) - the
  // source half is still measured and the runtime half is recorded as
  // UNPROBED. Unprobed is never usable: the whole point of this probe is that
  // the absence of evidence is not evidence of a working export path.
  if (probed) {
    stream.usable = typeof mongooseInstance.Query.prototype.stream ===
      'function';

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
  }
  else {
    nsend.error  = 'not probed: the worker\'s module graph never registered ' +
                   'the Export model on a live connection in this run';
    stream.error = nsend.error;
  }

  // Whether the MODULE UNDER TEST actually uses each idiom, counted from its
  // own source. Both halves are needed: an unusable idiom only blocks the
  // export path if the worker reaches for it, and reading the source is what
  // makes the verdict follow the module rather than the environment. It is also
  // what lets a repaired worker - or the scratch control copy - flip the
  // expectation set automatically instead of by a flag.
  // An unreadable source is FATAL, and the reason is the whole point of the
  // counts: a failed read used to leave `source` empty, which reads as zero
  // call sites, which reads as "this worker uses neither idiom" - the most
  // favourable answer available, produced by the absence of evidence. The
  // counts only mean something when the file behind them was actually read.
  try {
    source = fs.readFileSync(
      require.resolve(path.resolve(appRoot, workerModule)), 'utf8');
  }
  catch (err) {
    throw new ToolError('the worker module under test could not be read for ' +
      'the capability probe (' + path.resolve(appRoot, workerModule) + '): ' +
      ((err && err.message) || err) + '. The call-site counts decide whether ' +
      'an unusable idiom matters, so an unread source cannot be treated as a ' +
      'source with no call sites.');
  }

  // Counted over CODE, not over prose. Measured while proving this probe:
  // a control copy of the worker whose header comment described the two
  // substitutions it had made - naming both idioms - was reported as still
  // using them, and the gate failed a worker whose export path completed. A
  // repaired worker documenting what it replaced would fail the same way, so
  // the comments come out before the count. Both figures are recorded, because
  // the difference between them is the thing that was almost missed.
  code = stripComments(source);

  nsend.mentions  = (source.match(/Q\.nsend\(/g) || []).length;
  stream.mentions = (source.match(/\.stream\(\)/g) || []).length;
  nsend.sites  = (code.match(/Q\.nsend\(/g) || []).length;
  stream.sites = (code.match(/\.stream\(\)/g) || []).length;

  return {
    probed           : probed,
    nsend            : nsend,
    stream           : stream,
    exportPathUsable : probed &&
                       (nsend.usable || nsend.sites === 0) &&
                       (stream.usable || stream.sites === 0),
    remedy           : 'convert the Q.nsend calls in ' + workerModule +
                       ' to Model.<method>(...).exec() and its .stream() call ' +
                       'to .cursor()'
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
 * on - `files` because an asset-bearing trinket's File document
 * arms the metric hook the seeder reconciles, and `exports` for the three
 * export states the seeder owns. `force: true` so a reused run directory or a
 * second pass starts from the same state.
 *
 * The per-job `pending` Export documents are created here with fixed ids of
 * this harness's own rather than by reusing the seeder's `exportPending`: a job
 * MUTATES its document, and an assertion about one job must never be reading a
 * value another job wrote.
 *
 * @param {Object} deps `{seed, ExportModel, mongooseInstance}`
 * @returns {Promise<Object>} `{summary, created, s3}` - `summary` is the
 *   seeder's OWN return value, unaltered, and `s3` is the pre-population
 *   result the run asserts.
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
  var ids = JOBS.filter(function(spec) {
    // Every job whose export id is this harness's own gets a `pending`
    // document; the late-failure job deliberately addresses the seeder's
    // ABSENT id, and creating one for it would destroy the fixture.
    return spec.exportId !== 'missingExport';
  }).map(function(spec) {
    return spec.exportId;
  });
  var manifest;
  var loaded;
  var expected;
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
  //
  // The RESULT is returned rather than discarded, and the run asserts it. A
  // rejected entry - a bad base64 body, a missing bucket, an unreadable file -
  // is recorded by the fixture and thrown away by nobody: a seed that silently
  // placed nothing would turn the asset lookup into a NoSuchKey that reads as
  // a worker defect, or worse, would let an assertion pass against an object
  // this run wrote itself.
  manifest = deps.seed.s3Manifest();
  loaded   = awsFixture.prepopulate(manifest);

  // The expectation is DERIVED FROM THE MANIFEST BODY, not read back out of
  // the store. That direction is the whole point: a digest taken from what the
  // store now holds would agree with itself whatever it holds, which is how an
  // earlier revision let a pre-seeded object be replaced after prepopulation
  // and still pass. Every byte the seeder asked for is hashed here, and
  // `verifySeedIntegrity` re-reads the store and compares against these.
  expected = manifest.map(function(entry) {
    var body = Buffer.from(entry.bytesBase64 || '', 'base64');

    return {
      bucket      : entry.bucket,
      key         : entry.key,
      digest      : 'sha256:' +
                    crypto.createHash('sha256').update(body).digest('hex'),
      size        : body.length,
      contentType : entry.contentType || null
    };
  });

  return {
    summary  : summary,
    created  : created,
    s3       : {
      expected  : expected,
      loaded    : loaded.loaded,
      rejected  : loaded.rejected,
      errors    : loaded.errors,
      stored    : awsFixture.objects().map(function(record) {
        return { bucket : record.bucket, key : record.key, etag : record.etag,
          size : record.size };
      })
    }
  };
}

/**
 * Reads every pre-migration object back out of the store and compares it, byte
 * for byte, against the manifest body that was supposed to be there.
 *
 * AAP 0.6.7 turns on one property: because an upload key is the sha1 of the
 * file's own contents, a changed digest must surface as a LOOKUP FAILURE on
 * pre-migration data rather than as a pass on data the run wrote itself. That
 * only holds if the pre-migration data is what the fixture says it is, and
 * presence at the right key does not establish that: an object can be present,
 * addressable, the right length even, and still not be the bytes the manifest
 * described.
 *
 * So the comparison is `{bucket, key, digest, size}` per object, over the
 * complete set, against digests taken from the manifest bodies. It runs twice
 * in a passing run - once after seeding, before any job, and once after every
 * job has been driven - because the second call is what proves the worker read
 * the seeded objects rather than rewriting them.
 *
 * @param {Object[]} expected From `seedFixtures`, one entry per manifest body.
 * @returns {Object[]} One observation per expected object, in the same order.
 */
function verifySeedIntegrity(expected) {
  return (expected || []).map(function(entry) {
    var record = awsFixture.get(entry.bucket, entry.key);
    var digest = record && record.body
      ? 'sha256:' + crypto.createHash('sha256').update(record.body)
        .digest('hex')
      : null;

    return {
      bucket  : entry.bucket,
      key     : entry.key,
      digest  : digest,
      size    : record ? record.size : null,
      present : Boolean(record)
    };
  });
}


/**
 * Asserts that the fixtures this gate depends on are actually there - in the
 * database the WORKER reads, and in the object store it reads through.
 *
 * Two things are proved here that used to be assumed.
 *
 * The pre-population RESULT is asserted. `awsFixture.prepopulate` reports
 * `{loaded, rejected, errors}` and an earlier revision discarded it, so a
 * manifest entry the fixture rejected - a bad base64 body, an absent bucket, an
 * unreadable file - left the object simply missing. The asset lookup would then
 * fail as a NoSuchKey that reads like a worker defect, or, worse, an assertion
 * would pass against an object the worker had just written itself, which is
 * precisely the case AAP 0.6.7 says must surface as a lookup failure on
 * PRE-MIGRATION data.
 *
 * The seeded documents are READ BACK THROUGH THE APPLICATION'S OWN GRAPH. When
 * `--app` names an independently installed worktree there are two mongoose
 * instances - the seeder in this worktree and the worker in that one - both
 * connected to the same database. That is a supported configuration, not a
 * refusal, and this is what makes it one: the fixtures are queried through the
 * models the WORKER resolved, so a graph mismatch is a failed assertion with a
 * name rather than a job that mysteriously finds no user.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} seeded From seedFixtures.
 * @returns {Promise<undefined>}
 */
async function assertSeeded(ctx, ledger, seeded) {
  await ledger.check('the S3 fixture accepted every pre-migration object the ' +
    'seeder asked for', function() {
      assert.strictEqual(seeded.s3.rejected, 0,
        'a rejected seed entry means the object is absent: ' +
        JSON.stringify(seeded.s3.errors));
      assert.deepStrictEqual(seeded.s3.errors, [], 'no rejection reasons');
      assert.strictEqual(seeded.s3.loaded, seeded.s3.expected.length,
        'every one of the ' + seeded.s3.expected.length + ' manifest ' +
        'entries must be stored; ' + seeded.s3.loaded + ' were');
      assert.deepStrictEqual(awsFixture.errors(), [],
        'the fixture must have recorded no fault while seeding');
    });

  await ledger.check('every seeded object is readable back at its exact ' +
    'bucket and key, holding exactly the manifest bytes', function() {
      var observed = verifySeedIntegrity(seeded.s3.expected);
      var comparable = observed.map(function(entry) {
        return { bucket : entry.bucket, key : entry.key,
          digest : entry.digest, size : entry.size };
      });
      var wanted = seeded.s3.expected.map(function(entry) {
        return { bucket : entry.bucket, key : entry.key,
          digest : entry.digest, size : entry.size };
      });

      seeded.s3.integrity = observed;

      // The complete set, compared as a set: an absent object reads as a null
      // digest, a truncated or replaced one as a different digest, and a
      // reordered store as a different array. Presence alone is what an
      // earlier revision checked, and a body swapped after prepopulation
      // passed it - measured.
      assert.deepStrictEqual(comparable, wanted,
        'the export path reads these by key and by content. A changed key is ' +
        'supposed to surface as a lookup failure rather than as a pass on ' +
        'fresh data (AAP 0.6.7), and a changed BODY at the right key must not ' +
        'pass at all: the digests here are taken from the manifest bodies the ' +
        'seeder supplied, not from the store.');
    });

  await ledger.check('the seeded fixtures are visible through the ' +
    'application\'s own module graph (' + ctx.graph.mode + ')',
    async function() {
      var User    = ctx.mongoose.model('User');
      var Trinket = ctx.mongoose.model('Snippet');
      var user    = await User.findById(ctx.seed.ids.user).exec();
      var trinkets = await Trinket.count({ _owner : ctx.seed.ids.user }).exec();
      var exportDocs = await ctx.ExportModel.find({
        _id : { $in : seeded.created }
      }).exec();

      assert.ok(user, 'the seeded user must be readable through the mongoose ' +
        'instance the worker resolved (' + ctx.graph.appMongoose + '); the ' +
        'seeder wrote through ' + ctx.graph.toolMongoose);
      assert.strictEqual(user.email, ctx.seed.credentials.user.email,
        'and it must be the same document, not a coincidence of ids');
      assert.strictEqual(trinkets, ctx.expectedTrinkets.length,
        'the worker counts {_owner: userId}; the app graph must see ' +
        ctx.expectedTrinkets.length + ' trinket(s) for the seeded owner, not ' +
        trinkets);
      assert.strictEqual(exportDocs.length, seeded.created.length,
        'every per-job Export document must be visible to the worker: ' +
        seeded.created.length + ' created, ' + exportDocs.length + ' readable');
      exportDocs.forEach(function(doc) {
        assert.strictEqual(doc.status, 'pending',
          'each starts `pending`, so any other terminal value later is the ' +
          'worker\'s own writing');
      });

      // Set LAST, and only here. `buildNotesOwed` claims the cross-graph read
      // happened only when this flag is true, so it can never be set by
      // reaching this function - it is set by reaching the end of it with
      // every assertion above satisfied.
      ctx.crossGraph.asserted = true;
    });
}

/**
 * The archive expectation, derived rather than borrowed.
 *
 * `seed.fixtures.exportArchive.trinketCount` is the count of ALL seeded
 * trinkets and is 7. The worker counts `{_owner: userId}`, and one of
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
 * `lib/workers/exports.js` hard-codes `'/tmp/' + filename`, so TMPDIR does
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
 * Enqueues one job, applies whatever Bull mechanism its kind calls for, waits
 * for the outcome, and collects everything observable about it.
 *
 * Jobs run SEQUENTIALLY and each is fully collected before the next is
 * enqueued, which is what makes "assert every job's side effects
 * independently" true rather than aspirational: the mail window is reset per
 * job, the S3 call log is sliced per job, and the recorded updates are
 * filtered to the job's own export id.
 *
 * FOUR KINDS, and the mechanism is the only difference between them:
 *   'export'    added and awaited. The expectation set is the job's own name.
 *   'retry'     added with `attempts`, so Bull re-runs the processor itself.
 *               The wait is for the LAST failure, not the first.
 *   'stalled'   `stallJob` below: a second instance takes the job, its lock is
 *               deleted, and Bull's own stalled check hands it back.
 *   'lock-loss' `provokeLockLoss` below: the lock expires while the processor
 *               runs, so Bull raises "Missing lock" instead of recording an
 *               outcome. Nothing settles, and that is the point.
 *
 * Three waits, and every one is bounded. The processor's settlement comes from
 * Bull's own event, through the observer. The document's terminal state is then
 * POLLED, because the writes that produce it are fire-and-forget: the failed
 * handler's update takes an empty callback, so it can land after Bull has
 * already emitted. And the job's own removal is polled, because
 * `job.remove()` in the completed handler is likewise unawaited.
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
  var attempts     = spec.attempts || 1;
  var jobOptions   = spec.attempts
    ? { attempts : spec.attempts, backoff : 0 }
    : {};
  var stdoutBefore  = capture.stdout.length;
  var callsBefore   = awsFixture.calls().length;
  var updatesBefore = ctx.updates.calls.length;
  var errorsBefore  = ctx.observer.queueErrors().length;
  var tempBefore    = listWorkerTempFiles();
  var startedAt     = Date.now();
  var mechanism     = { kind : spec.kind };
  var added;
  var record;
  var doc = null;
  var removal;

  mailFixture.reset();

  note('job ' + spec.name + ' [' + spec.kind + ']: ' + spec.description);

  if (spec.kind === 'stalled') {
    // The worker must not take this job first: the point is that a DIFFERENT
    // instance holds it when its lock disappears, which is what a crashed or
    // blocked worker looks like to Redis.
    await withTimeout(Promise.resolve(ctx.queue.pause(true, true)),
      SETTLE_TIMEOUT_MS, 'pausing the worker queue for the stalled case');
    await withTimeout(Promise.resolve(ctx.staller.queue.resume(true)),
      SETTLE_TIMEOUT_MS, 'resuming the stalling instance');
  }

  if (spec.kind === 'lock-loss') {
    mechanism.lockLoss = await provokeLockLoss(ctx, data);
    added  = mechanism.lockLoss.job;
    record = ctx.observer.expect(added.id, attempts);
  }
  else {
    added  = await ctx.queue.add(data, jobOptions);
    record = ctx.observer.expect(added.id, attempts);

    if (spec.kind === 'stalled') {
      try {
        mechanism.stall = await stallJob(ctx, added);
      }
      finally {
        // The worker was paused so that the stalling instance would win the
        // job. If anything above threw - the instance never took it, a Redis
        // call failed - leaving it paused would hang every job after this one
        // until the overall bound expired, and the failure a reader saw would
        // be a timeout rather than the thing that broke.
        await withTimeout(Promise.resolve(ctx.queue.resume(true)),
          SETTLE_TIMEOUT_MS, 'resuming the worker queue after the stalled case');
      }
    }

    await withTimeout(record.settled, ctx.options.jobTimeoutMs,
      'job ' + spec.name + '\'s processor settling through Bull');

    if (attempts > 1) {
      // Bull emits `failed` once per attempt, so the assertion about the last
      // attempt has to wait for the last attempt rather than for the promise
      // that resolved on it.
      await pollFor(function() {
        return record.failedCount >= attempts ? true : false;
      }, ctx.options.jobTimeoutMs, 'job ' + spec.name + '\'s ' + attempts +
        ' attempts');
    }
  }

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

  removal = await observeRemoval(ctx, added.id);

  return {
    name        : spec.name,
    spec        : spec,
    data        : data,
    exportId    : exportId,
    userId      : userId,
    jobId       : added.id,
    attempts    : attempts,
    mechanism   : mechanism,
    record      : record,
    removal     : removal,
    queueErrors : ctx.observer.queueErrors().slice(errorsBefore),
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
 * Makes one job stall, using Bull's own recovery machinery and nothing else.
 *
 * The sequence is the one a lost lock actually produces, in the order Bull
 * requires:
 *
 *   1. the stalling instance - a second Bull queue on the SAME name and prefix,
 *      whose processor holds the job and never finishes it - takes the job,
 *      which is why the worker was paused before the job was added;
 *   2. the job's lock key is DELETED. This is the one place this file writes to
 *      Redis, and it writes the state a crashed worker leaves behind: an active
 *      job with no lock. Bull decides everything after this;
 *   3. the stalling instance is paused so it cannot take the job back;
 *   4. `moveUnlockedJobsToWait` runs TWICE, with the script's own
 *      `stalled-check` guard key cleared before each pass. That is not a trick:
 *      pass one MARKS every unlocked active job into the stalled set and pass
 *      two REPORTS the ones still unlocked, and the guard exists so the two
 *      passes are separated by `stalledInterval` in production. Clearing it is
 *      how a bounded gate gets the second pass without waiting 30 seconds, and
 *      the decision the script makes is untouched;
 *   5. the worker is resumed by the caller's `finally`, and Bull hands it the
 *      job it moved back to wait.
 *
 * @param {Object} ctx
 * @param {Object} job The job Bull returned from `add`.
 * @returns {Promise<Object>} What each step observed.
 */
async function stallJob(ctx, job) {
  var lockKey = ctx.queue.toKey(job.id) + ':lock';
  var picked;
  var deleted;
  var passes = [];

  picked = await withTimeout(ctx.staller.taken(job.id), SETTLE_TIMEOUT_MS,
    'the stalling instance taking job ' + job.id);

  deleted = await ctx.queue.client.del(lockKey);

  await withTimeout(Promise.resolve(ctx.staller.queue.pause(true, true)),
    SETTLE_TIMEOUT_MS, 'pausing the stalling instance');

  await ctx.queue.client.del(ctx.queue.keys['stalled-check']);
  passes.push(await ctx.queue.moveUnlockedJobsToWait());
  await ctx.queue.client.del(ctx.queue.keys['stalled-check']);
  passes.push(await ctx.queue.moveUnlockedJobsToWait());

  // The resume is `driveJob`'s, in a `finally`, so that a throw anywhere above
  // still lifts the pause.

  return {
    pickedUpByStaller : picked === String(job.id),
    lockKey           : lockKey,
    lockDeleted       : deleted,
    passes            : passes.length,
    stalledIds        : ctx.observer.stalledIds().slice()
  };
}

/**
 * Provokes Bull's own queue-level `error` by taking one job's lock away while
 * its processor runs.
 *
 * `moveToFinished` refuses to record an outcome for a job whose lock is gone -
 * its script returns -2 and Bull turns that into
 * `Missing lock for job <id> failed`, emitted on the queue as an `error`. That
 * is the payload the worker's `error` handler exists for, and the object it
 * receives is Bull's own: this function only removes the lock, exactly as an
 * expiry would.
 *
 * TWO LEVERS, because one of them alone is a race this file would rather not
 * run. The lock horizon is shortened to a millisecond for the duration of the
 * attempt, and the lock key is DELETED as soon as it appears. Measured: with a
 * processor that rejects in under a millisecond the shortened expiry does not
 * win, because `moveToFinished`'s lock check can reach Redis inside the same
 * millisecond the lock was set - so the deletion is what makes the outcome
 * reliable, and the shortened horizon is the backstop for the case where the
 * poll misses the window. Whichever of the two took effect is recorded per
 * attempt, and an attempt that produced no error is retried on a FRESH job:
 * three attempts, each bounded, so a slow host lengthens the run instead of
 * failing it and a genuinely unreachable error path still fails the gate.
 *
 * Nothing settles for the job that succeeds in this: no `completed` and no
 * `failed` event is emitted, so the worker's failed handler never runs. That
 * absence is asserted, and it is why this case is LAST in JOBS - what it leaves
 * behind is an active job with no lock, which is removed here and whose
 * namespace is obliterated in teardown.
 *
 * @param {Object} ctx
 * @param {Object} data The job payload.
 * @returns {Promise<Object>} `{job, error, attempts, savedLockDuration,
 *   savedLockRenewTime}`
 */
async function provokeLockLoss(ctx, data) {
  var savedLockDuration  = ctx.queue.settings.lockDuration;
  var savedLockRenewTime = ctx.queue.settings.lockRenewTime;
  var attempts = [];
  var job = null;
  var found = null;
  var index;

  for (index = 0; index < LOCK_LOSS_ATTEMPTS && found === null; index++) {
    /* eslint-disable no-await-in-loop */
    ctx.queue.settings.lockDuration  = LOCK_LOSS_DURATION_MS;
    ctx.queue.settings.lockRenewTime = LOCK_LOSS_RENEW_MS;

    try {
      job = await ctx.queue.add(data, {});
      ctx.observer.expect(job.id, 1);
      attempts.push(await attemptLockLoss(ctx, job));
      found = attempts[attempts.length - 1].error;
    }
    finally {
      ctx.queue.settings.lockDuration  = savedLockDuration;
      ctx.queue.settings.lockRenewTime = savedLockRenewTime;
    }

    if (found === null && index + 1 < LOCK_LOSS_ATTEMPTS) {
      note('  the lock-loss window was missed on job ' + job.id +
        '; retrying on a fresh job (' + (index + 2) + ' of ' +
        LOCK_LOSS_ATTEMPTS + ')');
    }
  }

  return {
    job                : job,
    error              : found,
    attempts           : attempts,
    savedLockDuration  : savedLockDuration,
    savedLockRenewTime : savedLockRenewTime
  };
}

/**
 * One lock-loss attempt against one job.
 *
 * @param {Object} ctx
 * @param {Object} job
 * @returns {Promise<Object>} `{jobId, lockRemoved, error, settled}`
 */
async function attemptLockLoss(ctx, job) {
  var lockKey = ctx.queue.toKey(job.id) + ':lock';
  var expected = 'Missing lock for job ' + job.id;
  var errorsBefore = ctx.observer.queueErrors().length;
  var record = ctx.observer.recordFor(job.id);
  var lockRemoved = 0;
  var deadline = Date.now() + LOCK_LOSS_WINDOW_MS;
  var error = null;

  // Delete the lock the moment it exists. The loop is tight rather than
  // interval-driven because the window is the processor's own duration.
  while (Date.now() < deadline && lockRemoved === 0) {
    lockRemoved = await ctx.queue.client.del(lockKey);

    if (lockRemoved === 0 && (record.completedCount + record.failedCount) > 0) {
      // The job finished with its lock intact: this attempt is spent.
      break;
    }
  }

  try {
    error = await pollFor(function() {
      var arrived = ctx.observer.queueErrors().slice(errorsBefore)
        .filter(function(entry) {
          return String(entry.message).indexOf(expected) === 0;
        });

      return arrived.length > 0 ? arrived[0] : false;
    }, LOCK_LOSS_WINDOW_MS, 'Bull raising `' + expected + '` on the queue');
  }
  catch (err) {
    error = null;
  }

  if (error) {
    // Cleanup rather than assertion: the job is still in the active list with
    // no lock, and leaving it there lets Bull's own periodic stalled check hand
    // it back during teardown.
    try {
      await (await ctx.queue.getJob(job.id)).remove();
    }
    catch (err) {
      void err;
    }
  }

  return {
    jobId       : String(job.id),
    lockRemoved : lockRemoved,
    mechanism   : lockRemoved > 0 ? 'lock deleted' : 'lock expired or job won',
    settled     : record.completedCount + record.failedCount,
    error       : error
  };
}

/**
 * Whether the job is still in Redis, and in which state.
 *
 * This is `job.remove()` asserted rather than counted. The worker's completed
 * handler calls it and does not await it, so the evidence is the job being GONE
 * from the queue's own keyspace - which a counter on a fake job object could
 * never show, and which no amount of "it did not throw" implies.
 *
 * @param {Object} ctx
 * @param {(string|number)} id
 * @returns {Promise<Object>} `{removed, state}`
 */
async function observeRemoval(ctx, id) {
  var job = null;
  var state = null;

  try {
    job = await pollFor(async function() {
      var found = await ctx.queue.getJob(id);

      return found === null ? null : found;
    }, SETTLE_TIMEOUT_MS, 'job ' + id + ' being removed from the queue');
  }
  catch (err) {
    // Not removed inside the bound, which is the expected outcome for every
    // job except the successful one.
    job = await ctx.queue.getJob(id);
  }

  if (job) {
    try {
      state = await job.getState();
    }
    catch (err) {
      state = 'unreadable (' + ((err && err.message) || err) + ')';
    }
  }

  return { removed : job === null, state : state };
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
 * The failed handler logs `console.log('exports failed job:', job.id,
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
 * Asserts that the worker under test can actually complete an export with the
 * dependency set the selected worktree installed.
 *
 * One check, reached from both paths, because the answer matters most exactly
 * where it is least available: when the worker could not be required the
 * runtime half is UNPROBED, and unprobed must fail rather than default to
 * usable. Whatever was measured - the call-site counts from the source, the
 * runtime errors, or the reason there are none - is in the message, together
 * with the remedy, because this check failing is this gate's way of reporting
 * a defect that lives in another lane's file.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @returns {Promise<undefined>}
 */
async function assertExportPathUsable(ctx, ledger) {
  await ledger.check('the worker\'s database idiom can complete an export',
    function() {
      var capabilities = ctx.capabilities;

      assert.ok(capabilities, 'the capability probe could not run at all: ' +
        ((ctx.capabilityError && ctx.capabilityError.message) ||
          'no reason recorded') + '. The call-site counts decide whether an ' +
        'unusable idiom matters, so an unread source cannot be treated as a ' +
        'source with no call sites.');

      assert.strictEqual(capabilities.exportPathUsable, true,
        'the success half of AAP 0.9.3\'s worker gate is unreachable while ' +
        'this holds, and it is a FAILURE rather than a verdict of its own. ' +
        'Measured: ' + (capabilities.probed
          ? 'Q.nsend usable=' + capabilities.nsend.usable
          : 'the runtime idioms were NOT probed (' + capabilities.nsend.error +
            '); Q.nsend appears') +
        ' at ' + capabilities.nsend.sites + ' call site(s) (' +
        capabilities.nsend.mentions + ' textual mention(s))' +
        (capabilities.probed && capabilities.nsend.error
          ? ' ("' + capabilities.nsend.error + '")'
          : '') +
        '; ' + (capabilities.probed
          ? 'Query.prototype.stream usable=' + capabilities.stream.usable
          : '.stream() appears') +
        ' at ' + capabilities.stream.sites + ' call site(s)' +
        (capabilities.probed && capabilities.stream.error
          ? ' ("' + capabilities.stream.error + '")'
          : '') +
        '. Remedy: ' + capabilities.remedy + '.');
    });
}

/**
 * Fails, by name, every job-dependent claim this run could not make.
 *
 * Reached when the selected worktree's queue is not a Bull 4 queue this run
 * can isolate, so no job may be enqueued (`probeQueueSurface` explains why),
 * or when the worker could not be required at all. One failed check per job
 * spec, rather than one summary failure, because the ledger is the record of
 * what this gate proved: a run that quietly carried seven fewer checks would
 * read as a smaller gate rather than as an unproven one.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {string} reason
 * @returns {Promise<undefined>}
 */
async function failUndrivenJobs(ctx, ledger, reason) {
  var i;

  for (i = 0; i < JOBS.length; i++) {
    await ledger.check('the `' + JOBS[i].name + '` job runs on a real Bull ' +
      'queue: ' + JOBS[i].description, (function(message) {
        return function() {
          assert.fail(message);
        };
      })(reason));
  }
}

/**
 * Asserts that the queue the worker registered on is a real Bull queue in this
 * run's own namespace, carrying Bull's own defaults.
 *
 * Four claims, each of which an earlier revision of this file could not have
 * made: the constructor is Bull's, the key prefix is the per-run one so nothing
 * this run does can be seen by or confused with another, the three Redis
 * clients Bull opens are actually connected, and the queue's SETTINGS are
 * Bull's defaults - `lockDuration` 30000, `stalledInterval` 30000,
 * `maxStalledCount` 1. The last one is the guard on this file's own honesty:
 * the only option the harness injects is `prefix`, and a future injection of
 * timings would change what every semantic assertion below means.
 *
 * Every claim is a LEDGER CHECK and none of them throws. When `--app` names a
 * worktree whose install predates the migration - the baseline at `2f8712a`
 * resolves bull 0.7.2 - these checks FAIL, by name, carrying the measured
 * surface and the remedy, and the run continues to collect the load-order,
 * fixture and capability evidence that `--app` exists to obtain. What it does
 * NOT do is enqueue: `ctx.queueUsable` is what gates that, because a queue
 * whose `prefix` option was ignored addresses the shared `bull:exports:*`
 * keyspace, and this host runs up to sixty-four clones against one Redis.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @returns {Promise<boolean>} Whether the queue can be driven.
 */
async function assertQueueIsRealBull(ctx, ledger) {
  var surface = ctx.queueSurface;

  await ledger.check('the exports queue is a real Bull queue, not the ' +
    'in-memory stand-in', function() {
      assert.strictEqual(surface.constructor, 'Queue',
        'lib/util/queues.js must have taken its Bull branch; it builds ' +
        'InMemoryQueue when db.redis.enabled is false, and that queue emits ' +
        'nothing, so no Bull semantics could be asserted against it. The ' +
        'selected worktree resolved ' + surface.package + ' at ' +
        surface.module);
      assert.strictEqual(ctx.queues.isRedisEnabled(), true,
        'the composed configuration sets db.redis.enabled true');
      assert.strictEqual(surface.name, 'exports',
        'the queue name is the Redis key namespace and the identity the ' +
        'worker registers against');
    });

  await ledger.check('the queue exposes the Bull 4 surface this gate\'s ' +
    'semantic assertions drive', function() {
      assert.deepStrictEqual(surface.missing, [],
        'the selected worktree resolved ' + surface.package + ', which is ' +
        'missing ' + surface.missing.join(', ') + '. AAP 0.5.1.2 requires ' +
        'bull 4.16.5, and the completion, failure, retry, stalled and ' +
        'lock-loss assertions below are assertions ABOUT that version. ' +
        'Remedy: ' + surface.remedy);
    });

  await ledger.check('the queue is namespaced to this run, so no other run ' +
    'or agent shares its keyspace', function() {
      assert.strictEqual(surface.keyPrefix, ctx.bull.prefix,
        'Bull addresses every key as <prefix>:<name>:*, and the injected ' +
        'prefix is what keeps two runs apart. This queue reports ' +
        JSON.stringify(surface.keyPrefix) + ', so the `prefix` option was ' +
        'ignored or overridden. Remedy: ' + surface.remedy);
      assert.notStrictEqual(surface.keyPrefix, 'bull',
        'the default prefix would put this run in the shared bull namespace');
      assert.deepStrictEqual(ctx.bull.constructed.map(function(entry) {
        return entry.name;
      }), ['exports'], 'exactly one queue was constructed through the ' +
        'wrapper; got ' + JSON.stringify(ctx.bull.constructed));
    });

  await ledger.check('Bull\'s three Redis clients are connected', async function() {
    assert.strictEqual(surface.bull4Api, true,
      'the client statuses below are ioredis properties; this queue exposes ' +
      surface.missing.join(', ') + '. Remedy: ' + surface.remedy);

    await ctx.queue.isReady();

    assert.ok(['ready', 'connect', 'connecting']
      .indexOf(ctx.queue.client.status) > -1,
      'the command client must be usable; statuses were ' +
      JSON.stringify(surface.clients));
    assert.strictEqual(await ctx.queue.client.ping(), 'PONG',
      'the command client must answer PING');
  });

  await ledger.check('the queue carries Bull\'s own settings: the harness ' +
    'injected `prefix` and nothing else', function() {
      assert.ok(surface.settings, 'the queue exposes no `settings`, so ' +
        'Bull\'s timings cannot be read. Remedy: ' + surface.remedy);
      assert.strictEqual(surface.settings.lockDuration, 30000,
        'lockDuration must be Bull\'s default; a shortened lock would change ' +
        'what the stalled and error assertions mean');
      assert.strictEqual(surface.settings.stalledInterval, 30000,
        'stalledInterval must be Bull\'s default: this run drives the stalled ' +
        'check itself rather than shortening the interval');
      assert.strictEqual(surface.settings.maxStalledCount, 1,
        'maxStalledCount must be Bull\'s default');
    });

  return surface.usable;
}

/**
 * Asserts that the worker registered what it is supposed to register, on that
 * real queue.
 *
 * Counted as a DELTA against the listener counts taken before the worker was
 * required, and with this file's own observer subtracted, because Bull attaches
 * one internal `error` listener of its own at construction: an absolute count
 * would be an assertion about Bull's version rather than about the worker, and
 * would drift the next time either changes.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @returns {Promise<undefined>}
 */
async function assertQueueRegistration(ctx, ledger) {
  var counts = ctx.observer.workerListeners(ctx.queueListenerBaseline);

  await ledger.check('the worker registered exactly one processor', function() {
    assert.deepStrictEqual(Object.keys(ctx.queue.handlers || {}),
      ['__default__'], 'lib/workers/exports.js calls exportsQueue.process(fn) ' +
      'once with no name, which Bull records under __default__; the queue ' +
      'holds ' + JSON.stringify(Object.keys(ctx.queue.handlers || {})));
    assert.strictEqual(typeof ctx.queue.handlers.__default__, 'function',
      'the registered processor must be a function');
  });

  await ledger.check('the worker attached exactly one error, one failed and ' +
    'one completed handler', function() {
      assert.deepStrictEqual(counts, { error : 1, failed : 1, completed : 1 },
        'measured as a delta over the pre-require baseline ' +
        JSON.stringify(ctx.queueListenerBaseline) + ' with this harness\'s ' +
        'own observer subtracted; got ' + JSON.stringify(counts));
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
  if (outcome.spec.kind === 'lock-loss') {
    // Nothing is emitted for this job by design - Bull raises `error` instead
    // of recording an outcome - so there is no event-borne Job to inspect and
    // `assertLockLossJob` carries its assertions instead.
    return;
  }

  await ledger.check(outcome.name + ': the job Bull handed the worker is a ' +
    'Bull-4 Job (id present, jobId absent, remove callable)', function() {
    assert.ok(outcome.record.job, 'no Bull event carried a Job for this job, ' +
      'so the processor never ran or the queue emitted nothing');
    assert.ok(outcome.record.job.id, 'job.id must be present and non-empty');
    assert.strictEqual(String(outcome.record.job.id), String(outcome.jobId),
      'job.id must be the id `add` returned');
    assert.strictEqual(outcome.record.hasJobIdField, false,
      'a real Bull 4 Job carries no `jobId` own property - Bull 0.7\'s name ' +
      'for it - which is exactly why the worker\'s failed handler had to move ' +
      'to `job.id`');
    assert.strictEqual(typeof outcome.record.job.remove, 'function',
      'Bull 4 Job#remove must be present, since the completed handler calls it');
    assert.deepStrictEqual(outcome.record.job.data, outcome.data,
      'job.data must reach the processor unchanged');
  });

  await ledger.check(outcome.name + ': Bull emitted exactly ' +
    outcome.attempts + ' terminal event(s) for it', function() {
      assert.strictEqual(
        outcome.record.completedCount + outcome.record.failedCount,
        outcome.attempts,
        'a job with ' + outcome.attempts + ' attempt(s) produces that many ' +
        'terminal events, the last of which is final; got ' +
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
        'the failed handler logs `exports failed job: <id> <data>`; no ' +
        'such line was emitted, so the handler did not run');
      assert.notStrictEqual(logged, 'undefined',
        'the handler logged `undefined` for the job id, which is what a body ' +
        'still reading Bull 0.7\'s `job.jobId` produces on a Bull 4 job');
      assert.strictEqual(logged, String(outcome.jobId),
        'the handler must log the real job id');
    });

  await ledger.check(outcome.name + ': the job is still in the queue, because ' +
    'job.remove() runs only on completion', async function() {
      assert.strictEqual(outcome.removal.removed, false,
        'the completed handler is the only caller of job.remove(), so a failed ' +
        'job must still be readable from Redis');
      assert.strictEqual(outcome.removal.state, 'failed',
        'Bull keeps a failed job in its failed set (removeOnFail defaults to ' +
        'false); its state is ' + JSON.stringify(outcome.removal.state));
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
      'the upload in uploadArchive must not have been reached');
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
        'the .fail chain unlinks the temporary file on the failure ' +
        'path; a leftover means it did not');
    });
}

// ---------------------------------------------------------------------------
// Assertions - the successful export
// ---------------------------------------------------------------------------

/**
 * Every AAP 0.9.3 success assertion, against the job the worker completed.
 *
 * Unconditional. There is no expectation set for "the export could not run":
 * a worker that cannot complete this job fails the gate, with the capability
 * diagnosis attached to say why. The block is verified non-vacuous through
 * `--worker-module` against a scratch mongoose-6-compatible copy of the worker,
 * which is also how the remedy the diagnosis names was measured.
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

  await ledger.check('success: Bull emitted `completed` and the completed ' +
    'handler\'s job.remove() actually removed the job', function() {
      assert.strictEqual(outcome.record.failedCount, 0,
        'the job must not have failed; error was ' +
        (outcome.record.error && outcome.record.error.message));
      assert.strictEqual(outcome.record.completedCount, 1,
        'Bull must have emitted `completed` exactly once');
      assert.strictEqual(outcome.removal.removed, true,
        'the job must be GONE from the queue\'s keyspace: the completed ' +
        'handler calls job.remove() and this is what proves the call reached ' +
        'Redis rather than merely being made. The job was still readable in ' +
        'state ' + JSON.stringify(outcome.removal.state));
    });

  await ledger.check('success: the status sequence is processing -> completed ' +
    '(the first status write, then the completion update)', function() {
      assert.deepStrictEqual(statusSequence(outcome), ['processing', 'completed'],
        'the recorded updates carrying a `status` must be exactly those two, ' +
        'in that order; got ' + JSON.stringify(outcome.updates));
    });

  await ledger.check('success: four updates, since ' + expectedCount +
    ' trinkets is below the every-tenth progress update', function() {
      assert.strictEqual(outcome.updates.length, 4,
        'expected {status:processing}, {progress.total, trinketCount}, ' +
        '{progress.processed, progress.failed} and the completion update; got ' +
        JSON.stringify(outcome.updates));
      assert.deepStrictEqual(outcome.updates[1].update, {
        'progress.total' : expectedCount,
        trinketCount     : expectedCount
      }, 'the count update that follows the trinket count');
      assert.deepStrictEqual(outcome.updates[2].update, {
        'progress.processed' : expectedCount,
        'progress.failed'    : 0
      }, 'the final progress update');
      assert.deepStrictEqual(Object.keys(outcome.updates[3].update).sort(),
        ['downloadUrl', 'expiresAt', 'fileSize', 's3Key', 'status'],
        'the completion update writes exactly those five fields');
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
    'exact strings processBulkExport and the download URL build', function() {
      assert.ok(filename, 'the document must carry an s3Key');
      assert.ok(/^trinket-export-[0-9a-f]{12}\.zip$/.test(filename),
        'the filename is `trinket-export-` + 12 hex characters + `.zip`; got ' +
        JSON.stringify(filename));
      assert.strictEqual(doc.s3Key,
        'exports/' + outcome.userId + '/' + filename, 's3Key');
      assert.strictEqual(doc.downloadUrl, bucket.host + '/' + doc.s3Key,
        'downloadUrl is config.aws.buckets.exports.host + \'/\' + s3Key');
    });

  await ledger.check('success: expiresAt is three days out ' +
    '(EXPORT_EXPIRY_DAYS)', function() {
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
    'own byte length, content type and attachment disposition',
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
        'the persisted fileSize is fs.statSync(tempFile).size, which must ' +
        'equal the ' +
        'uploaded body length');
    });

  await ledger.check('success: the asset was fetched from the userassets ' +
    'bucket by the basename of its url', function() {
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
        'downloadAsset, but a trinket that failed is counted in the ' +
        'archive manifest');

      outcome.archiveEntries = result.entries.slice().sort();
    });

  await ledger.check('success: one `export-ready` mail to the owner',
    function() {
      assert.strictEqual(outcome.mail.length, 1,
        'exactly one mail; got ' + JSON.stringify(outcome.mail.map(function(c) {
          return c.type;
        })));
      assert.strictEqual(outcome.mail[0].to, ctx.seed.credentials.user.email,
        'the recipient is the export owner\'s email');
      assert.strictEqual(outcome.mail[0].subject,
        'Your Trinket Export is Ready', 'sendCompletionEmail\'s subject');
      assert.strictEqual(outcome.mail[0].type, 'export-ready',
        'the type sendCompletionEmail passes');
      assert.strictEqual(typeof outcome.mail[0].options.html, 'string',
        'the body is the rendered export-ready template');
      assert.ok(outcome.mail[0].options.html.length > 0,
        'the rendered body must not be empty');
    });

  await ledger.check('success: the temporary file /tmp/' + filename +
    ' is gone', async function() {
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
// Assertions - Bull 4's own semantics
// ---------------------------------------------------------------------------

/**
 * Bull 4 retry: `attempts: 2` on a rejecting processor.
 *
 * AAP 0.5.1.2 lists retry among the behaviours the 0.7.2 -> 4.16.5 move
 * alters, and this is the assertion that it works with THIS worker's
 * processor: Bull re-runs it, the failed handler sees the attempt count
 * climb, and the persisted document carries the last failure. `attemptsMade`
 * is Bull's own counter and is read off the Job the event carried, which is
 * why the sequence - 1 then 2 - is evidence of two real attempts rather than
 * of one event emitted twice.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertRetryJob(ctx, ledger, outcome) {
  await ledger.check('retry: Bull ran the processor twice and reported each ' +
    'attempt', function() {
      assert.strictEqual(outcome.record.completedCount, 0, 'no completion');
      assert.strictEqual(outcome.record.failedCount, 2,
        'Bull emits `failed` once per attempt, so a job with attempts: 2 that ' +
        'always rejects produces two; got ' + outcome.record.failedCount);
      assert.deepStrictEqual(outcome.record.attemptsMade, [1, 2],
        'Bull\'s own attemptsMade counter on the Job each event carried; got ' +
        JSON.stringify(outcome.record.attemptsMade));
      assert.strictEqual(outcome.record.error.message,
        'Unknown action: ' + outcome.spec.action,
        'the last failure carries the processor\'s own error');
    });

  await ledger.check('retry: the job\'s final state is failed with Bull\'s ' +
    'own failedReason and attemptsMade', async function() {
      var job = await ctx.queue.getJob(outcome.jobId);

      assert.ok(job, 'a retried-out job stays in the failed set');
      assert.strictEqual(job.attemptsMade, 2, 'attemptsMade in Redis');
      assert.strictEqual(job.failedReason,
        'Unknown action: ' + outcome.spec.action, 'failedReason in Redis');
      assert.strictEqual(await job.getState(), 'failed', 'the job\'s state');
    });

  await ledger.check('retry: the failed handler persisted the failure, once ' +
    'per attempt and to the same terminal value', async function() {
      var doc = await pollFor(async function() {
        var found = await ctx.ExportModel.findById(outcome.exportId).exec();

        return found && found.status === 'failed' ? found : false;
      }, SETTLE_TIMEOUT_MS, 'the failed handler\'s update for the retry job');

      assert.strictEqual(doc.status, 'failed', 'status');
      assert.strictEqual(doc.errorMessage,
        'Unknown action: ' + outcome.spec.action, 'errorMessage');
      assert.strictEqual(outcome.updates.length, 2,
        'the handler runs on each of the two attempts and writes the same ' +
        'pair each time; got ' + JSON.stringify(outcome.updates));
    });

  await assertFailedHandlerRan(ctx, ledger, outcome);
  await assertNoExternalEffects(ctx, ledger, outcome);
}

/**
 * Bull 4 stalled-job recovery, end to end through the worker.
 *
 * The mechanism is in `stallJob`; this is what it has to have produced. Bull
 * emitted `stalled` for this job id, moved it back to wait, and the WORKER's
 * processor - not the instance that lost the lock - picked it up and failed it,
 * with the failure persisted by the worker's own handler. `stalledCounter` is
 * Bull's counter in Redis and is the mechanical proof that the job travelled
 * the stalled path rather than simply being processed late.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertStalledJob(ctx, ledger, outcome) {
  var stall = outcome.mechanism.stall;

  await ledger.check('stalled: a second instance held the job and its lock ' +
    'was removed', function() {
      assert.strictEqual(stall.pickedUpByStaller, true,
        'the stalling instance must have taken the job, or the lock this case ' +
        'deletes was never the one it holds');
      assert.strictEqual(stall.lockDeleted, 1,
        'exactly one lock key was deleted at ' + stall.lockKey);
      assert.strictEqual(stall.passes, 2,
        'Bull\'s stalled check marks on the first pass and reports on the ' +
        'second, so both are required');
    });

  await ledger.check('stalled: Bull emitted `stalled` for this job',
    function() {
      assert.ok(ctx.observer.stalledIds().indexOf(String(outcome.jobId)) > -1,
        'the `stalled` event Bull emits from moveUnlockedJobsToWait must name ' +
        'this job; the ids seen were ' +
        JSON.stringify(ctx.observer.stalledIds()));
      assert.ok(outcome.record.stalledCount >= 1,
        'the observer must have recorded at least one stalled event for it');
    });

  await ledger.check('stalled: the worker\'s own processor picked the job up ' +
    'again and failed it', function() {
      assert.strictEqual(outcome.record.failedCount, 1,
        'exactly one failure, from the worker\'s processor after recovery');
      assert.strictEqual(outcome.record.error.message,
        'Unknown action: ' + outcome.spec.action,
        'the error is the worker processor\'s own, which is what proves the ' +
        'recovered job reached the worker and not the instance that stalled');
    });

  await ledger.check('stalled: Bull counted the stall in Redis',
    async function() {
      var job = await ctx.queue.getJob(outcome.jobId);
      // Read from the job HASH rather than the Job object: Bull's stalled
      // script HINCRBYs `stalledCounter` on the hash and its Job#fromJSON does
      // not carry that field onto the instance, so the instance property is
      // undefined even after a real stall. The hash is where the counter lives.
      var counter = await ctx.queue.client.hget(
        ctx.queue.toKey(outcome.jobId), 'stalledCounter');

      assert.ok(job, 'the job stays in the failed set');
      assert.strictEqual(Number(counter), 1,
        'Bull\'s HINCRBY on the job hash\'s stalledCounter is the mechanical ' +
        'record of the recovery; got ' + JSON.stringify(counter));
    });

  await ledger.check('stalled: the failure is persisted by the worker\'s ' +
    'failed handler', async function() {
      var doc = await pollFor(async function() {
        var found = await ctx.ExportModel.findById(outcome.exportId).exec();

        return found && found.status === 'failed' ? found : false;
      }, SETTLE_TIMEOUT_MS, 'the failed handler\'s update for the stalled job');

      assert.strictEqual(doc.errorMessage,
        'Unknown action: ' + outcome.spec.action, 'errorMessage');
    });

  await assertFailedHandlerRan(ctx, ledger, outcome);
  await assertNoExternalEffects(ctx, ledger, outcome);
}

/**
 * The queue-level `error` payload, raised by Bull itself.
 *
 * `provokeLockLoss` lets one job's lock expire, so Bull's `moveToFinished`
 * refuses to record the outcome and emits
 * `Missing lock for job <id> failed` on the queue. Three things follow, and all
 * three are asserted: the worker's `error` handler ran and logged the error it
 * was handed - which is the payload-shape claim AAP 0.9.3 asks for - no
 * terminal event was emitted for the job, and therefore the Export document
 * was never written. That last one matters for R-e: a lost lock is not a
 * failure the application records, and a harness that quietly expected
 * `status: 'failed'` here would be asserting something Bull does not do.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertLockLossJob(ctx, ledger, outcome) {
  var expected = 'Missing lock for job ' + outcome.jobId;

  await ledger.check('lock-loss: Bull raised its own `Missing lock` error on ' +
    'the queue', function() {
      assert.ok(outcome.mechanism.lockLoss.error,
        'no such error arrived in ' + outcome.mechanism.lockLoss.attempts.length +
        ' attempt(s): ' +
        JSON.stringify(outcome.mechanism.lockLoss.attempts.map(function(entry) {
          return entry.mechanism + ' (settled ' + entry.settled + ')';
        })));
      assert.strictEqual(
        String(outcome.mechanism.lockLoss.error.message).indexOf(expected), 0,
        'the message must be Bull\'s own `' + expected + ' ...`; got ' +
        JSON.stringify(outcome.mechanism.lockLoss.error.message));
    });

  await ledger.check('lock-loss: the worker\'s error handler ran and logged ' +
    'the error object it was handed', function() {
      var lines = outcome.stdout.filter(function(line) {
        return line.indexOf('exports queue error:') === 0;
      });

      assert.ok(lines.length >= 1,
        'lib/workers/exports.js\'s error handler logs `exports queue error:` ' +
        'followed by the error; nothing like it was emitted, so the handler ' +
        'did not run. Captured: ' + JSON.stringify(outcome.stdout.filter(
          function(line) { return line.length > 0; }).slice(0, 8)));
      assert.ok(lines.join('\n').indexOf('Missing lock for job') > -1,
        'the logged error must be the one Bull raised; got ' +
        JSON.stringify(lines));
    });

  await ledger.check('lock-loss: Bull emitted no terminal event, so the ' +
    'worker\'s failed handler never ran for it', function() {
      var logged = outcome.stdout.filter(function(line) {
        return line.indexOf('exports failed job: ' + outcome.jobId) === 0;
      });

      assert.strictEqual(outcome.record.completedCount, 0,
        'Bull cannot record a completion for a job whose lock is gone');
      assert.strictEqual(outcome.record.failedCount, 0,
        'nor a failure: it raises `error` instead, which is precisely why the ' +
        'failed handler is not reached and why a lost lock is NOT a failure ' +
        'the application records');
      assert.deepStrictEqual(logged, [],
        'the failed handler logs the job id when it runs; it must not have ' +
        'run for this job. Got ' + JSON.stringify(logged));
    });

  await ledger.check('lock-loss: Bull\'s default lock settings are back',
    function() {
      assert.strictEqual(ctx.queue.settings.lockDuration,
        outcome.mechanism.lockLoss.savedLockDuration, 'lockDuration restored');
      assert.strictEqual(ctx.queue.settings.lockRenewTime,
        outcome.mechanism.lockLoss.savedLockRenewTime, 'lockRenewTime restored');
      assert.strictEqual(ctx.queue.settings.lockDuration, 30000,
        'and the restored value is Bull\'s default');
    });
}

// ---------------------------------------------------------------------------
// Assertions - the three export failure edges
// ---------------------------------------------------------------------------

/**
 * The `User not found` job: the failure edge with NO user resolved.
 *
 * The throw happens before `user` is ever assigned, so the failure mail's
 * `if (user)` guard
 * is false and NO failure mail is sent. That is the edge R-e binds here, and it
 * is asserted as an absence rather than assumed.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object} outcome
 * @returns {Promise<undefined>}
 */
async function assertMissingUserJob(ctx, ledger, outcome) {
  await ledger.check('missing-user: rejected with `User not found`',
    function() {
      assert.strictEqual(outcome.record.failedCount, 1, 'one failure');
      assert.strictEqual(outcome.record.error.message, 'User not found',
        'the exact message the user lookup throws');
    });

  await ledger.check('missing-user: the document carries status `failed` and ' +
    'that exact errorMessage', function() {
      assert.ok(outcome.doc, 'the Export document must exist');
      assert.strictEqual(outcome.doc.status, 'failed', 'status');
      assert.strictEqual(outcome.doc.errorMessage, 'User not found',
        'errorMessage is `err.message` verbatim');
      assert.deepStrictEqual(statusSequence(outcome), ['processing', 'failed',
        'failed'], 'the first status write, then the same failure written ' +
        'twice - once by the .fail chain and once by the failed handler - ' +
        'which is baseline and is preserved. Got ' +
        JSON.stringify(statusSequence(outcome)));
    });

  await ledger.check('missing-user: NO failure mail, because no user was ' +
    'resolved', function() {
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
 * in `sendCompletionEmail` because the completion update's
 * `findByIdAndUpdate` returns null for an Export id that belongs to no
 * document and the mail context dereferences
 * `exportRecord.progress`. So this is the case where the failure mail IS sent
 * and where a temporary file EXISTS and is cleaned.
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
    'export record', function() {
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
        'the upload precedes the completion mail, so it must have ' +
        'happened; got ' + JSON.stringify(puts));
      assert.strictEqual(puts[0].bucket, ctx.config.aws.buckets.exports.name,
        'Bucket');
    });

  await ledger.check('late-failure: the failure mail IS sent, because a user ' +
    'was resolved', function() {
      assert.strictEqual(outcome.mail.length, 1,
        'exactly one mail; got ' + JSON.stringify(outcome.mail.map(function(c) {
          return c.type;
        })));
      assert.strictEqual(outcome.mail[0].to, ctx.seed.credentials.user.email,
        'the recipient');
      assert.strictEqual(outcome.mail[0].subject, 'Your Trinket Export Failed',
        'sendFailureEmail\'s subject');
      assert.strictEqual(outcome.mail[0].type, 'export-failed', 'the type');
      assert.strictEqual(typeof outcome.mail[0].options.html, 'string',
        'the rendered export-failed template');
    });

  await ledger.check('late-failure: the temporary file existed and was ' +
    'unlinked', async function() {
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
 * The processor rejects before `processBulkExport` is entered, so the `.fail`
 * chain never runs and the failed handler is the ONLY writer of `status`
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
    'the unknown-action branch', function() {
      assert.strictEqual(outcome.record.completedCount, 0, 'no completion');
      assert.strictEqual(outcome.record.failedCount, 1, 'one failure');
      assert.strictEqual(outcome.record.error.message,
        'Unknown action: ' + outcome.spec.action,
        'the exact message the branch builds');
    });

  await ledger.check('unknown-action: the failed handler is the only writer, ' +
    'and it wrote status and errorMessage', async function() {
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
      // instance IT resolved, so a fixture installed on some
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
      'the worker writes to /tmp directly, so TMPDIR does not ' +
      'contain this');
  });
}

// ---------------------------------------------------------------------------
// The warning stream
// ---------------------------------------------------------------------------

/**
 * Splits captured stderr into notice blocks and judges them.
 *
 * A block is a notice line plus the indented stack lines `--trace-deprecation`
 * puts under it. The harness's own prefixed lines and the sibling tools' are
 * excluded by prefix, since they are commentary rather than notices.
 *
 * The detector, the flag precondition and the empty allowance list all come
 * from test/parity/warning-policy.js. Three consequences of that, each of which
 * was a defect when this file decided them for itself:
 *
 *   * `[MONGOOSE]` notices reach console.warn rather than emitWarning, and the
 *     text detector is what catches them - so the shared patterns matter here
 *     even though this process also has Node's own printer;
 *   * a notice from a RETAINED dependency is a failure, not an allowance, so
 *     there is nothing left for a `match` regex to excuse;
 *   * the flags are part of the judgement: this process's own `execArgv` is
 *     audited, because a quiet stream measured without --pending-deprecation
 *     says nothing about a pending deprecation.
 *
 * There is no `allowed`/`unexpected` split any more, and the absence is the
 * point: with no allowance to subtract, every notice is unexpected, and a
 * partition into two buckets would imply a second bucket exists.
 *
 * @param {string} stderr
 * @param {(string|null)} [appRoot] The tree under test, for the policy's
 *   foreign-tree rule.
 * @returns {Object} `{notices, flags, tree}`
 */
function classifyWarnings(stderr, appRoot) {
  return {
    notices : warningPolicy.noticesFromText(stderr, {
      ignorePrefixes : [LOG_PREFIX, '[parity:'],
      source         : 'stderr'
    }),
    flags   : warningPolicy.processFlagAudit(),
    // Rule 4 of the policy, decided by the policy: a run against a BASELINE
    // worktree measures that tree rather than gating it, which matters here
    // because `--app ../baseline` is a documented invocation of this harness
    // and a baseline install emits the AWS SDK v2 notice that only the
    // target's config/aws.js suppresses.
    tree    : warningPolicy.gateAppliesTo(appRoot || null)
  };
}

/**
 * Asserts the zero-warning bar. There is no allowance.
 *
 * AAP 0.8's requirement is zero deprecation warnings across the entire running
 * application, and 0.9.3's pass condition is "no warning or deprecation notice
 * attributable to the application's own source or to any dependency this plan
 * retains". Measured on the delivered tree, this run emits NONE. The one it
 * used to emit - DEP0005 from `compress-commons`, reached through `archiver`
 * 2.1.1 - was a dependency this plan retained, so it FAILED here, and that
 * failure is what moved archiver to 6.0.2. It had previously been allowed by
 * name and printed as a deviation; nothing in the AAP authorizes that, and a
 * gate that excuses the one thing it was built to detect is not a gate.
 *
 * Two further failures are asserted here rather than left to a reader of the
 * invocation. A run missing `--pending-deprecation` or `--trace-deprecation`
 * has produced no evidence, and a run with a suppressor in force has produced
 * less than none; both are stated as failures, so a silent stream can never be
 * mistaken for a clean one.
 *
 * @param {Object} ledger
 * @param {Object} classified
 * @returns {Promise<Object>} the judged check document, for the artifact
 */
async function assertWarnings(ledger, classified) {
  var judged = warningPolicy.judge({
    notices     : classified.notices,
    flags       : classified.flags,
    subject     : 'this worker process\'s stderr',
    gateApplies : classified.tree.applies,
    treeNote    : classified.tree.treeNote
  });

  judged.failures.forEach(function(failure) {
    note('WARNING GATE: ' + failure);
  });

  await ledger.check(warningPolicy.CHECK_NAME, function() {
    assert.deepStrictEqual(judged.failures, [],
      'the zero-warning gate has no allowances (AAP 0.9.3, and 0.9.5: no ' +
      'exception is granted to the plan by the plan): ' +
      JSON.stringify(judged.failures, null, 2));
  });

  return judged;
}

// ---------------------------------------------------------------------------
// Teardown
// ---------------------------------------------------------------------------

/**
 * Puts everything back, closes everything this harness or the application
 * opened, and reports each step's outcome for the run to ASSERT.
 *
 * Order matters. The instrumentation is removed before the resources it
 * observed are closed, so nothing is recorded during teardown. The Bull
 * namespace is obliterated before the queue is closed, because after `close()`
 * there is no client to obliterate with, and a namespace left behind would
 * accumulate one dead keyspace per run. The queue itself is closed through the
 * application's own `closeAll` rather than by reaching into the cache. The
 * in-memory MongoDB is stopped last, after the client that talks to it is
 * disconnected. And the run directory goes only when the run had nothing to
 * report.
 *
 * Every step is guarded, because a teardown that threw would lose the report
 * and the report is the deliverable - but a guarded step is not a forgiven one:
 * every entry returned here is asserted by `assertTeardown`, and the run fails
 * if any of them failed. That is the difference between recording cleanup and
 * proving it.
 *
 * @param {Object} ctx
 * @param {boolean} clean Whether the run had no failed checks, which decides
 *   the run directory's fate.
 * @returns {Promise<Object[]>} One entry per step, with its outcome.
 */
async function teardown(ctx, clean) {
  var steps = [];
  var opened = ctx.opened || {};

  /**
   * One teardown step, recorded either way.
   *
   * `resource` names the thing the step closes, and it is the key
   * `ctx.opened` records when the run actually opened it. `assertTeardown`
   * then holds the pair to an equivalence: a step is skipped EXACTLY when its
   * resource was never opened. That is what keeps a conditional teardown from
   * becoming a silent one - a skip is a claim about setup, checkable against
   * setup's own record, rather than a shrug.
   *
   * @param {string} name
   * @param {?string} resource
   * @param {Function} body Receives a `skip(reason)` callback.
   * @returns {Promise<undefined>}
   */
  async function step(name, resource, body) {
    var entry = {
      name     : name,
      resource : resource,
      ok       : true,
      skipped  : false,
      reason   : null,
      message  : null
    };

    try {
      await body(function(reason) {
        entry.skipped = true;
        entry.reason  = reason;
      });
    }
    catch (err) {
      entry.ok      = false;
      entry.message = (err && err.message) || String(err);
      note('teardown: ' + name + ' failed: ' + ((err && err.message) || err));
    }

    steps.push(entry);
  }

  await step('stop observing the queue', 'observer', function(skip) {
    if (!ctx.observer) {
      skip('no observer was installed');
      return;
    }

    assert.strictEqual(ctx.observer.restore(), true,
      'every listener this harness attached to the queue must be detached');
  });

  await step('restore the update recorder', 'recorder', function(skip) {
    if (!ctx.updates) {
      skip('the Export model\'s update recorder was never installed');
      return;
    }

    ctx.updates.restore();

    assert.strictEqual(ctx.ExportModel.findByIdAndUpdate.parityRecorder,
      undefined, 'the model\'s own static must be back: a recorder left in ' +
      'place would keep instrumenting the model for anything else in this ' +
      'process');
  });

  await step('close the stalling queue instance', 'staller',
    async function(skip) {
      if (!ctx.staller) {
        skip('no stalling instance was created, so the stalled case did not ' +
          'run');
        return;
      }

      await withTimeout(Promise.resolve(ctx.staller.close()),
        CONNECT_TIMEOUT_MS, 'the stalling instance\'s close()');
    });

  await step('flush the fixture evidence logs', 'fixtures', function(skip) {
    if (!awsFixture && !mailFixture) {
      skip('the fixtures were never loaded');
      return;
    }

    if (awsFixture) {
      awsFixture.flush();
    }

    if (mailFixture) {
      mailFixture.flush();
    }
  });

  await step('restore the fixtures', 'fixtures', function(skip) {
    if (!awsFixture && !mailFixture) {
      skip('the fixtures were never loaded');
      return;
    }

    if (awsFixture) {
      awsFixture.restore();

      assert.strictEqual(awsFixture.status().patched, false,
        'the AWS namespace must be the genuine SDK again');
    }

    if (mailFixture) {
      mailFixture.restore();

      assert.strictEqual(mailFixture.status().installed, false,
        'lib/util/mailer\'s own send must be back');
    }
  });

  await step('obliterate this run\'s Bull namespace', 'bullNamespace',
    async function(skip) {
      if (!opened.bullNamespace) {
        skip('nothing was enqueued: ' + (ctx.queueSurface && !ctx.queueSurface.usable
          ? 'the selected worktree resolved ' + ctx.queueSurface.package +
            ', whose keyspace this run could not isolate, so it added no job ' +
            'and created no namespace'
          : 'the run did not reach the point of adding a job'));
        return;
      }

      await withTimeout(Promise.resolve(ctx.queue.obliterate({ force : true })),
        SETTLE_TIMEOUT_MS, 'queue.obliterate()');
    });

  await step('guard the queue\'s Redis clients against a post-close error',
    'queueClients', function(skip) {
      if (!opened.queueClients) {
        skip('the selected queue exposes no ioredis clients' +
          (ctx.queueSurface ? ' (' + ctx.queueSurface.package + ')' : ''));
        return;
      }
      // Bull removes its OWN error listener from each client when the queue
      // closes, so a socket error arriving during or after the close has
      // nobody to go to and becomes an uncaught exception - measured, and it
      // takes the process down after the report is written. These listeners
      // record such an error instead, and `assertTeardown` reports whatever
      // arrives.
      ctx.postCloseErrors = ctx.postCloseErrors || [];

      ['client', 'eclient', 'bclient'].forEach(function(key) {
        var client = ctx.queue && ctx.queue[key];

        if (client && typeof client.on === 'function') {
          client.on('error', function(err) {
            ctx.postCloseErrors.push(key + ': ' +
              ((err && err.message) || String(err)));
          });
        }
      });
    });

  await step('close every queue through lib/util/queues.js closeAll()',
    'queue', async function(skip) {
      if (!ctx.queues) {
        skip('lib/util/queues.js was never required');
        return;
      }

      await withTimeout(Promise.resolve(ctx.queues.closeAll()),
        CONNECT_TIMEOUT_MS, 'closeAll()');

      // The per-client status assertions are ioredis properties, and only a
      // Bull 4 queue has them. An older selected queue is closed through the
      // application's own `closeAll` exactly the same way; what cannot be
      // asserted is the internal state, and asserting it anyway is what made
      // an earlier revision report a spurious teardown failure against a
      // baseline worktree.
      if (!opened.queueClients) {
        return;
      }

      assert.strictEqual(ctx.queue.client.status, 'end',
        'the queue\'s command client must be closed; it is ' +
        ctx.queue.client.status);
      assert.strictEqual(ctx.queue.bclient.status, 'end',
        'the blocking client must be closed; it is ' +
        ctx.queue.bclient.status);
      assert.strictEqual(ctx.queue.eclient.status, 'end',
        'the subscriber client must be closed; it is ' +
        ctx.queue.eclient.status);
    });

  await step('restore the bull module', 'bull', function(skip) {
    if (!ctx.bull) {
      skip('the bull module was never wrapped');
      return;
    }

    assert.strictEqual(ctx.bull.restore(), true,
      'require(\'bull\') must return the genuine constructor again');
    assert.strictEqual(ctx.bull.patched(), false, 'and stay that way');
  });

  await step('quit the redis client config/redis.js opened', 'redisModule',
    async function(skip) {
      var client;

      if (!ctx.redisModule || typeof ctx.redisModule.getClient !== 'function') {
        skip('config/redis.js was never required, so it opened no client');
        return;
      }

      client = await withTimeout(Promise.resolve(ctx.redisModule.getClient()),
        CONNECT_TIMEOUT_MS, 'config/redis.js getClient()');

      if (client && client.isOpen) {
        await withTimeout(Promise.resolve(client.quit()), CONNECT_TIMEOUT_MS,
          'the config/redis client\'s quit()');
      }

      assert.ok(!client || !client.isOpen,
        'config/redis.js connects at module scope when db.redis.enabled is ' +
        'not false, so this gate opens that client too and has to close it');
    });

  await step('restore nunjucks and prove no filesystem watcher was started',
    'templateWatch', function(skip) {
      var described;

      if (!ctx.templateWatch) {
        skip('the nunjucks configure wrapper was never installed');
        return;
      }

      described = ctx.templateWatch.describe();
      ctx.templateWatchClosure = described;

      assert.strictEqual(ctx.templateWatch.restore(), true,
        'nunjucks.configure must be the genuine function again');
      assert.strictEqual(ctx.templateWatch.installed(), false,
        'and stay that way');
      assert.strictEqual(described.watchApplied, 0,
        'every configure() call must have been passed watch:false; ' +
        described.watchRequested + ' of ' + described.configureCalls +
        ' asked for watching');
      assert.strictEqual(described.chokidar.loaded, false,
        'no chokidar module may enter this process\'s require cache: it is ' +
        'undeclared by this repository (AAP 0.5.1.3 removes it as dead) and ' +
        'present only as nunjucks\' optional peer, so a gate that loaded it ' +
        'would depend on an install detail nobody declared - and nunjucks ' +
        '3.2.4 keeps the FSWatcher out of reach, which is what made an ' +
        'earlier revision allow-list handles and force an exit. Found ' +
        described.chokidar.modulesInCache + ' in cache.');
    });

  await step('disconnect mongoose', 'mongoose', async function(skip) {
    if (!ctx.mongoose) {
      skip('the application\'s mongoose was never resolved');
      return;
    }

    await withTimeout(Promise.resolve(ctx.mongoose.disconnect()),
      CONNECT_TIMEOUT_MS, 'mongoose.disconnect()');

    assert.strictEqual(ctx.mongoose.connection.readyState, 0,
      'the application\'s mongoose connection must be closed; readyState is ' +
      ctx.mongoose.connection.readyState);
  });

  await step('disconnect the tool graph\'s own mongoose', 'toolMongoose',
    async function(skip) {
      if (!ctx.toolMongoose || ctx.toolMongoose === ctx.mongoose) {
        skip('the harness shares the application\'s mongoose (' +
          (ctx.graph ? ctx.graph.mode : 'unknown') + '), so there is no ' +
          'second connection');
        return;
      }

      await withTimeout(Promise.resolve(ctx.toolMongoose.disconnect()),
        CONNECT_TIMEOUT_MS, 'the tool graph\'s mongoose.disconnect()');

      assert.strictEqual(ctx.toolMongoose.connection.readyState, 0,
        'the second graph\'s connection must be closed too');
    });

  await step('stop the in-memory MongoDB', 'mongo', async function(skip) {
    var stopped;

    if (!opened.mongo) {
      skip('test/parity/mongo.js never started a server in this run');
      return;
    }

    stopped = await withTimeout(Promise.resolve(mongo.stop()),
      CONNECT_TIMEOUT_MS, 'mongo.stop()');

    // `mongo.stop()` RESOLVES either way and reports its outcome as a boolean,
    // so a fulfilled `false` is a mongod this run started and did not stop -
    // a process left behind on the host, which is exactly the kind of leak a
    // teardown that only awaited would report as success.
    assert.notStrictEqual(stopped, false,
      'test/parity/mongo.js reported that it could not stop the server it ' +
      'started; a mongod is still running');
  });

  await step('restore the working directory', 'cwd', function(skip) {
    if (!ctx.cwdBefore) {
      skip('the working directory was never changed');
      return;
    }

    process.chdir(ctx.cwdBefore);

    assert.strictEqual(process.cwd(), ctx.cwdBefore,
      'the process must be back where it started');
  });

  await step('remove the run directory this harness created', 'runDir',
    function(skip) {
      if (!ctx.layout) {
        skip('no run directory was created');
        return;
      }

      ctx.runDirectory = removeRunDirectory(ctx.layout,
        ctx.options.keepRunDir || !clean);

      assert.strictEqual(ctx.runDirectory.refused, false,
        'the removal refused itself: ' + ctx.runDirectory.reason);

      if (ctx.runDirectory.kept) {
        note('run directory kept (' + ctx.runDirectory.reason + '): ' +
          ctx.runDirectory.path);
        return;
      }

      if (ctx.runDirectory.reason === 'owned') {
        assert.strictEqual(ctx.runDirectory.removed, true,
          'an owned run directory must be gone after teardown: ' +
          ctx.runDirectory.path);
      }
    });

  return steps;
}

/**
 * Asserts every teardown step, and the two facts that only the whole set can
 * show.
 *
 * The steps themselves are already guarded, so without this they would be a
 * list nobody read: sixteen results in the artifact and a green run beside
 * them. Each `ok` is a ledger check of its own, so the failure names the step;
 * each SKIP is checked against `ctx.opened`, so a step that skipped a resource
 * the run opened - or ran for one it never opened - is a failure of its own
 * rather than a shrug; the whole list is compared against `TEARDOWN_STEPS` by
 * name and in order; and the post-close Redis errors are reported here because
 * a socket error arriving after the close is a teardown observation and
 * nothing else would carry it.
 *
 * @param {Object} ctx
 * @param {Object} ledger
 * @param {Object[]} steps
 * @returns {Promise<undefined>}
 */
async function assertTeardown(ctx, ledger, steps) {
  var opened = ctx.opened || {};
  var i;

  for (i = 0; i < steps.length; i++) {
    await ledger.check('teardown: ' + steps[i].name, (function(entry) {
      return function() {
        assert.strictEqual(entry.ok, true, entry.message || 'the step failed');

        // A skip is a claim about SETUP, so it is checked against setup's own
        // record rather than accepted. The equivalence runs both ways: a step
        // that skipped a resource the run opened would leave that resource
        // open, and a step that ran for a resource the run never opened is
        // asserting about something that does not exist - which is how an
        // earlier revision produced a spurious teardown failure against a
        // worktree whose queue exposed no ioredis clients.
        if (entry.resource) {
          assert.strictEqual(entry.skipped, opened[entry.resource] !== true,
            entry.skipped
              ? 'this step was skipped, but the run recorded `' +
                entry.resource + '` as opened. Reason given: ' + entry.reason
              : 'this step ran, but the run never recorded `' +
                entry.resource + '` as opened');
        }

        if (entry.skipped) {
          assert.ok(typeof entry.reason === 'string' && entry.reason.length > 0,
            'a skipped step must say why');
        }
      };
    })(steps[i]));
  }

  await ledger.check('teardown: every step ran', function() {
    var names = steps.map(function(entry) { return entry.name; });

    // The NAMED records, from the layer that owns the database. `mongo.stop()`
    // resolves either way and reports its outcome as a boolean, so the names
    // are what say WHICH operation did not complete; throwing is what makes
    // this step's entry `ok: false`, which `run` turns into a failed check.
    var named = mongo.cleanupFailures();

    if (named.length) {
      throw new Error('the database lifecycle did not complete: ' +
        named.map(function(entry) {
          return 'could not ' + entry.operation + ' (' + entry.message + ')';
        }).join('; '));
    }

    // By NAME rather than by count, because a count is satisfied by the wrong
    // sixteen steps.
    assert.deepStrictEqual(names, TEARDOWN_STEPS.slice(),
      'teardown reports one entry per step, in order; a missing or reordered ' +
      'entry means it returned early or was edited without this list. Got ' +
      JSON.stringify(names));
  });

  await ledger.check('teardown: no Redis error arrived after the close',
    function() {
      assert.deepStrictEqual(ctx.postCloseErrors || [], [],
        'a socket error after close means the queue was closed while work was ' +
        'in flight');
    });
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
 * Registers a FAILED teardown step as a failed ledger check.
 *
 * A step that succeeded registers nothing, deliberately: every step's outcome
 * is already in `evidence.teardown`, which is where a reader looks for proof
 * that teardown ran, and a check per successful step would change the tally of
 * every clean run for no new evidence. A step that FAILED registers a failing
 * check, which is what `deriveVerdict` reads - so a queue that would not close,
 * a connection that would not drop, a database that would not stop or a working
 * directory that could not be restored fails the run instead of being a line on
 * stderr under a PASS.
 *
 * The step's own note has already been printed by `teardown` and its entry is
 * already in the evidence; neither is replaced.
 *
 * @param {Object} ledger From createLedger.
 * @param {Object} entry One `{name, ok, message}` step.
 * @returns {Promise<boolean>} Whether anything was registered and passed.
 */
async function registerTeardownStep(ledger, entry) {
  if (entry.ok) {
    return true;
  }

  return await ledger.check('teardown: ' + entry.name, function() {
    throw new Error('the teardown step `' + entry.name + '` did not ' +
      'complete: ' + entry.message + '. Whatever it was closing may still be ' +
      'open, so this run cannot be reported as clean.');
  });
}

/**
 * Asserts a clean close: nothing this harness or the application opened is
 * still open.
 *
 * There is no allowance to be bounded by any more. The watchers
 * `lib/util/nunjucks.js` would start are never started
 * (`installTemplateWatchSuppression`), the Bull clients are closed through the
 * application's `closeAll`, the `config/redis.js` client is quit, both mongoose
 * connections are disconnected and the memory server is stopped - so the
 * inventory is asserted EMPTY apart from this process's own stdio, which is
 * partitioned separately by `inspectHandles` because whether stdout and stderr
 * are pipes depends on how the process was invoked and neither ever keeps the
 * loop alive.
 *
 * That is what makes the exit path honest: `main` returns, `process.exitCode`
 * is set, and the loop drains on its own. A process that will not leave has a
 * handle open, this check has already failed, and the watchdog that follows can
 * only exit non-zero.
 *
 * @param {Object} ledger
 * @param {Object} handles
 * @returns {Promise<undefined>}
 */
async function assertCleanClose(ledger, handles) {
  await ledger.check('clean close: nothing this run opened is still open',
    function() {
      assert.deepStrictEqual(handles.unexpected, [],
        'after the watchers were closed, closeAll() ran, the redis client was ' +
        'quit, mongoose disconnected and the memory server stopped, no handle ' +
        'may remain; ' + JSON.stringify(handles.counts) + ' does. A Timeout ' +
        'here is usually an uncleared timer, a TCP or Socket handle an ' +
        'unclosed connection, an FSEventWrap a filesystem watcher nobody ' +
        'owns.');
      assert.deepStrictEqual(handles.allowed, [],
        'HANDLE_ALLOWANCES carries only the stdio partition, so an `allowed` ' +
        'entry here means a new allowance was added; ' +
        JSON.stringify(handles.allowed));
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
    kind           : outcome.spec.kind,
    attempts       : outcome.attempts,
    completedCount : outcome.record.completedCount,
    failedCount    : outcome.record.failedCount,
    attemptsMade   : outcome.record.attemptsMade,
    stalledCount   : outcome.record.stalledCount,
    removed        : outcome.removal.removed,
    finalState     : outcome.removal.state,
    queueErrors    : outcome.queueErrors.map(function(entry) {
      return entry.message;
    }),
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
 * sha1(userId + a timestamp), the job id is Bull's own counter inside a
 * namespace this run created, the key prefix and the database name and the run
 * directory are generated per run, and the port is the in-memory server's.
 * Each is still asserted for SHAPE by the checks above.
 *
 * @param {*} value
 * @returns {*} A normalized deep copy.
 */
function normalizeEvidence(value) {
  var rewrites = [
    [/trinket-export-[0-9a-f]{12}\.zip/g, 'trinket-export-<hash>.zip'],
    [/parity-worker-[A-Za-z0-9]{6}(?:-[0-9a-f]{6})?/g, 'parity-worker-<run>'],
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
 * evidence needs and cannot derive from a pass or a fail - what the run used,
 * what it proved, and what it relies on that the manifest does not declare.
 *
 * @param {Object} ctx
 * @param {Object} evidence
 * @returns {string[]}
 */
function buildNotesOwed(ctx, evidence) {
  var notes = [];
  var capabilities = evidence.capabilities;
  var templates    = evidence.templates;
  var queue        = evidence.queue;
  var watch        = evidence.dependencies &&
                     evidence.dependencies.templateWatch;
  var chokidar     = watch && watch.chokidar;

  if (queue && !queue.usable) {
    notes.push('Selected worktree queue surface: ' + evidence.tool.appRoot +
      ' resolves ' + queue.package + ' at ' + queue.module + ', constructor `' +
      queue.constructor + '`, keyPrefix ' + JSON.stringify(queue.keyPrefix) +
      ', missing ' + (queue.missing.join(', ') || 'nothing') + '. This is a ' +
      'MEASUREMENT of the worktree under test, reported as such: AAP 0.9.3 ' +
      'has this gate drive an independently installed application through ' +
      '`--app`, and the baseline at 2f8712a resolves bull 0.7.2. The run ' +
      'therefore collected its load-order, fixture and capability evidence ' +
      'and FAILED every claim that needs a Bull 4 queue - it enqueued ' +
      'nothing, because a queue whose `prefix` option is ignored addresses ' +
      'the shared bull:exports:* keyspace that every clone on this host would ' +
      'share. Remedy: ' + queue.remedy);
  }

  if (queue && queue.usable) {
    notes.push('Bull semantics: every completed, failed, error and stalled ' +
      'event asserted in this run was emitted by ' + queue.package + ' ' +
      'against Redis at ' + queue.redis + ', on a queue named `' + queue.name +
      '` under the per-run key prefix `' + queue.prefix + '`. The harness ' +
      'listens and never emits. AAP 0.9.3 describes this gate as running ' +
      'against "the in-memory queue"; that queue\'s `on` is a no-op ' +
      '(lib/util/queues.js), so the same section\'s own assertion list - ' +
      'processor promise completion, job.id in the failed handler, ' +
      'job.remove() on completed, retry and stalled behaviour - cannot be ' +
      'asserted against it. This run therefore enables Redis for the worker ' +
      'gate ONLY, isolates itself by key prefix, obliterates the namespace on ' +
      'the way out, and leaves every other parity tool on the in-memory path. ' +
      'The one option injected into the queue is `prefix`; Bull\'s default ' +
      'lockDuration, stalledInterval and maxStalledCount are asserted intact.');

    notes.push('The stalled case drives Bull\'s own moveUnlockedJobsToWait ' +
      'twice with the script\'s `stalled-check` guard key cleared between the ' +
      'passes, because pass one marks and pass two reports and the guard is ' +
      'what separates them by stalledInterval in production. The lock is ' +
      'deleted from Redis by the harness - the state a crashed worker leaves - ' +
      'and every decision after that is Bull\'s. The lock-loss case shortens ' +
      'the lock horizon for ONE job so that Bull raises its own "Missing lock ' +
      'for job N failed", which is the queue-level error payload the worker\'s ' +
      'handler exists for; the settings are restored immediately and the ' +
      'restoration is asserted.');
  }

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
      '. The worker skips nunjucks.configure under config.isTest, and what ' +
      'configures the global environment instead is its own require graph, ' +
      'through lib/util/nunjucks. The harness configures nothing, and the ' +
      'decision is identical on both worktrees because the require chain is.');
  }

  if (watch) {
    notes.push('Undeclared dependency in the application\'s test-mode path, ' +
      'and what this gate does about it: lib/util/nunjucks.js configures ' +
      'nunjucks with watch:true when isDev or isTest (' +
      watch.watchRequested + ' of ' + watch.configureCalls + ' configure() ' +
      'call(s) in this run asked for it), and nunjucks 3.2.4 then requires ' +
      '`chokidar` and starts one FSWatcher per template search path, keeping ' +
      'it in a constructor-local variable nothing can reach. `chokidar` is ' +
      'NOT declared by this repository - AAP 0.5.1.3 removes it as dead - and ' +
      'is present only as ' +
      ((chokidar && chokidar.installedAs) ||
        'a transitive dependency npm installs automatically') +
      '. This run therefore passes watch:false through the declared nunjucks ' +
      'API before the first application require, so it starts no watcher and ' +
      'loads no chokidar (' +
      (chokidar && chokidar.loaded ? 'FOUND IN CACHE - asserted against'
        : 'asserted: nothing matching node_modules/chokidar entered the ' +
          'require cache') +
      '), which is also why no handle is allow-listed and no exit is forced. ' +
      'Template hot-reload is what is given up, and a process that renders ' +
      'once cannot use it. The application\'s own reliance REMAINS: under ' +
      'NODE_ENV=test an install that skipped optional peers would leave ' +
      'lib/util/nunjucks.js unable to load. Declaring chokidar in ' +
      'package.json, or configuring nunjucks without watching outside ' +
      'development, are decisions for the lanes that own package.json and ' +
      'lib/util/nunjucks.js; this file records the reliance and does not ' +
      'depend on it.');
  }

  if (capabilities && !capabilities.exportPathUsable) {
    notes.push('This run FAILED because the worker cannot complete an export ' +
      'with the installed dependency set: q 1.0.1 ninvoke assimilates the ' +
      'thenable mongoose 6 Query its target returns and executes it twice (' +
      capabilities.nsend.sites + ' Q.nsend site(s), "' +
      capabilities.nsend.error + '"), and Query.prototype.stream was removed ' +
      'in mongoose 5 (' + capabilities.stream.sites + ' site(s)). Neither is ' +
      'a regression of this migration and neither is repaired from this lane ' +
      '- lib/workers/exports.js is not this file\'s to edit. The remedy, ' +
      'measured against a scratch copy carrying exactly those two ' +
      'substitutions and passing this whole gate: ' + capabilities.remedy + '.');
  }

  notes.push('The archive expectation is derived per OWNER: ' +
    'seed.fixtures.exportArchive.trinketCount counts all seeded trinkets (7) ' +
    'while the worker counts {_owner: userId}, and one seeded trinket belongs ' +
    'to the admin. This gate expects ' +
    (ctx.expectedTrinkets ? ctx.expectedTrinkets.length : 'the per-owner') +
    ' and would fail on the fixture\'s number for a reason unrelated to the ' +
    'worker.');

  // Every notice, as a note owed to the parity record - and as a FAILURE of
  // this run, not a footnote to it. There is no allowance to report: AAP 0.9.3
  // covers retained dependencies and 0.9.5 grants the plan no exception, so a
  // notice from a retained dependency is a gate failure whose resolution is a
  // dependency decision this harness does not own - as archiver's
  // compress-commons DEP0005 was, and was resolved that way.
  (evidence.warnings.notices || []).forEach(function(notice) {
    notes.push('Zero-warning gate FAILED on: ' + notice.summary +
      (notice.origin && notice.origin.length
        ? ' (raised at ' + notice.origin[0] + ')'
        : '') +
      ' - AAP 0.9.3 covers "any dependency this plan retains" and authorizes ' +
      'no warning exception, so this fails the run until the emitting path is ' +
      'removed by the dependency decision that owns it.');
  });

  if (evidence.warnings.flags && !evidence.warnings.flags.complete) {
    notes.push('This run produced NO warning evidence: ' +
      (evidence.warnings.flags.missing.length
        ? evidence.warnings.flags.missing.join(' ') + ' were not in force'
        : 'output was suppressed by ' +
          evidence.warnings.flags.suppressors.join(' ')) +
      '. A pending deprecation is silent without --pending-deprecation, so a ' +
      'quiet stream here is not a clean one.');
  }

  notes.push('Clean close: the process cannot self-exit under NODE_ENV=test. ' +
    'lib/util/nunjucks.js configures nunjucks with watch:true when isTest, and ' +
    'nunjucks 3.2.4 keeps the chokidar FSWatcher in a constructor-local ' +
    'variable, so no caller can close it. Those FSEventWrap handles are NOT ' +
    'allowed and FAIL this check - they are an unresolved shortfall against ' +
    'clean teardown (docs/preserved-quirks.md 10.3 and 11.3), not an approved ' +
    'deviation. The inventory is reported and ' +
    'exits with its own code.');

  notes.push('config/default.yaml declares no aws.buckets.exports although ' +
    'the worker reads its `name` and `host`, so the overlay supplies one. The ' +
    'committed gap is left as it is (AAP 0.6.7).');

  if (evidence.moduleGraph && evidence.moduleGraph.mode === 'dual-graph') {
    // Gated on what HAPPENED, not on the mode. An earlier revision emitted
    // the success half whenever the mode was dual-graph, so a run that never
    // reached the seeding - the baseline worktree cannot require the worker at
    // all - still shipped an artifact stating that the second graph had
    // connected and the fixtures had been read back and asserted. Both halves
    // are now recorded facts, and the note says which of them held.
    if (ctx.crossGraph.connected && ctx.crossGraph.asserted) {
      notes.push('Dual module graph: ' + ctx.options.appRoot + ' resolves its ' +
        'own mongoose, so the seeder in this worktree connected to the same ' +
        'database separately and the fixtures were then read back THROUGH the ' +
        'application\'s own graph before any job was driven. That cross-graph ' +
        'read is asserted, which is what makes an independently installed ' +
        '--app worktree a supported configuration rather than a refusal.');
    }
    else {
      notes.push('Dual module graph, NOT exercised: ' + ctx.options.appRoot +
        ' resolves its own mongoose (' + evidence.moduleGraph.appMongoose +
        ') while this harness resolves ' + evidence.moduleGraph.toolMongoose +
        ', and in this run the harness\'s second connection ' +
        (ctx.crossGraph.connected ? 'was opened' : 'was NEVER opened') +
        ' and the cross-graph read of the fixtures ' +
        (ctx.crossGraph.asserted ? 'was asserted' : 'was NEVER asserted') +
        '. The run stopped short of it - see the failed checks - so nothing ' +
        'here evidences the two graphs sharing a database, and the artifact ' +
        'carries no seed section to support it.');
    }
  }

  return notes;
}

// ---------------------------------------------------------------------------
// Evidence identity
// ---------------------------------------------------------------------------
// Standalone evidence that records only paths and a runtime cannot say which
// application revision it exercised or which generator produced it, so it
// cannot be authenticated against the delivery it is filed under - and the
// paths it does record name one machine rather than anything a reader can
// retrieve. Both identities are recorded here through the shared contract in
// test/parity/manifest.js:
//
//   the APPLICATION  by the HEAD, subject and worktree state of the tree the
//                    worker was driven in, never by its path;
//   the GENERATOR    by the git blob of THIS file's exact bytes, plus the
//                    commit that has been VERIFIED to hold that blob at this
//                    path - or an explicit non-git state (`uncommitted-source`,
//                    `not-a-checkout`) when no commit does, which is an honest
//                    answer instead of a commit id that cannot reproduce the
//                    artifact;
//   the DELIVERY     by this tool's own worktree HEAD, which is what lets one
//                    command establish that a whole set of parity artifacts
//                    describes one target state.
//
// Both are bound to the bytes. `provenance.attach` records a digest of the
// evidence WITHOUT its provenance immediately before the artifact is written,
// so a block lifted from another run fails recomputation, and the
// `<out>.provenance.json` sidecar adds a digest of the artifact exactly as
// written.
//
// THE DETERMINISM CHECK IS UNAFFECTED, by construction rather than by an
// exclusion added here: `--compare` compares `projectComparable`, whose
// COMPARABLE allow-list holds only the sections describing what the run
// OBSERVED about the application. `tool` was already outside it and
// `provenance` is outside it for the same reason - two runs from two trees
// legitimately differ in their provenance while the behaviour they recorded is
// identical, so comparing it would report a difference that is not one.

// WHAT IS MADE PORTABLE, AND WHAT IS RECORDED AS MEASURED
//
// The two are different in kind and the line between them is deliberate.
//
//   HARNESS-AUTHORED values - a directory this file created, a module path it
//   resolved, a fixture root it chose, the `--compare` target, and any message
//   describing THIS HARNESS's own operation (a failed check, a teardown step, a
//   module it could not require, a warning it captured) - are made portable
//   before they are recorded. They say nothing about the application, and their
//   absolute form says only which machine the run happened on. `assertAppRoot`
//   is the plainest example: its message names the `--app` path, and a
//   bootstrap failure records that message as a failed check, so the artifact
//   ended up carrying a host path from a message that was never meant for it.
//
//   APPLICATION-MEASURED values - a persisted `Export` field, a job's error
//   name and message, the `q`/mongoose capability probe errors, the template
//   resolution errors - are recorded VERBATIM even when they contain a path or
//   an instant. Those strings ARE the measurement: `lib/workers/exports.js:125`
//   hard-codes `'/tmp/' + filename`, so a message naming it is evidence about
//   the application, and rewriting it would change what the run reports and
//   what `--compare` compares.
//
// A message printed to stderr is not an artifact and is never rewritten: an
// operator reading a failed run needs the real path, which is why every `note`
// below still emits the underlying text.

/**
 * The two roots every label in this file is reduced against.
 *
 * @param {string} appRoot The tree under test.
 * @returns {{toolRoot: string, analysedRoot: string}}
 */
function evidenceRoots(appRoot) {
  return { toolRoot : TOOL_ROOT, analysedRoot : appRoot };
}

/**
 * A symbolic label for a path, so an artifact never carries an absolute one.
 *
 * @param {(string|null)} target
 * @param {string} appRoot
 * @returns {(string|null)} `tool:`, `analysed:` or `ephemeral:` plus a name.
 */
function pathLabelFor(target, appRoot) {
  return provenance.pathLabel(target, evidenceRoots(appRoot));
}

/**
 * A harness-authored message, made reproducible without losing its words.
 *
 * The contract's guard rejects a value CONTAINING an absolute path or an ISO
 * instant, not merely one that is nothing else, and a message is where such a
 * value hides: `ENOENT: no such file or directory, open '/tmp/run/x'` is prose
 * with a machine path in the middle of it. `provenance.portableText` replaces
 * each path with the label `pathLabel` would give it and each instant with a
 * marker, which keeps the sentence that says what happened and makes two runs
 * over one tree agree.
 *
 * Delegated to the contract rather than matched here so that this file,
 * capture.js and replay.js sanitize by one implementation.
 *
 * @param {*} value
 * @param {string} appRoot
 * @returns {(string|null)}
 */
function portableReason(value, appRoot) {
  return provenance.portableText(value, evidenceRoots(appRoot));
}

/**
 * `portableReason` applied to every string in a structure.
 *
 * For the records this file receives from elsewhere and records wholesale - the
 * two fixtures' `status()` descriptions, which name the tree they patched, the
 * object store's root and their own log files. Sanitizing them field by field
 * here would mean a field added to a fixture arrives in the artifact unlabelled,
 * so the walk covers whatever shape it is handed.
 *
 * Keys are preserved exactly: this makes values portable and is not a filter.
 *
 * @param {*} value
 * @param {string} appRoot
 * @returns {*} A copy with every string made portable.
 */
function portableRecord(value, appRoot) {
  if (typeof value === 'string') {
    return portableReason(value, appRoot);
  }

  if (Array.isArray(value)) {
    return value.map(function(item) {
      return portableRecord(item, appRoot);
    });
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  return Object.keys(value).reduce(function(out, key) {
    out[key] = portableRecord(value[key], appRoot);

    return out;
  }, {});
}

/**
 * The ledger's failures as an artifact may carry them.
 *
 * A check's name and message are harness-authored: the name can embed a
 * caller-supplied path - `--compare <path>` is quoted into the determinism
 * check's own name - and the message is whatever threw, which for a bootstrap
 * failure is `assertAppRoot`'s ToolError naming the `--app` path and for a
 * filesystem failure is an ENOENT quoting a temporary file. The ledger keeps
 * the raw text, which is what `note` prints; only this recorded copy is
 * rewritten.
 *
 * @param {Object[]} failures From `ledger.failures()`.
 * @param {string} appRoot
 * @returns {Object[]}
 */
function portableFailures(failures, appRoot) {
  return (failures || []).map(function(failure) {
    return {
      name    : portableReason(failure.name, appRoot),
      ok      : failure.ok,
      message : portableReason(failure.message, appRoot)
    };
  });
}

/**
 * Splits a connection string into its components, so a digest can be taken
 * over the parsed form rather than over the string.
 *
 * `provenance.digestSafe` decides what may be hashed by KEY NAME on scalar
 * leaves, so a connection string handed to it whole is opaque to that decision
 * and every run-local part of it survives into the digest. Parsing first puts
 * each part under a name the contract can judge: `host`, `port` and `database`
 * are address-labelled and are dropped, while the connection OPTIONS keep their
 * own names and stay, which is where the settings that describe the store live.
 *
 * Credentials are not carried into the returned object at all. The contract
 * would redact them, but a value never placed in the object cannot be leaked by
 * a later change to its hint lists, so the userinfo is reduced here to the one
 * fact that is part of the configuration: whether the store required any. The
 * same reasoning and the same shape as `test/parity/storage.js`, which digests
 * its own store the same way; the two are separate because neither file
 * requires the other's harness.
 *
 * @param {string} value A connection string.
 * @returns {{scheme: (string|null), authentication: string,
 *            host: (string|null), database: (string|null), options: Object}}
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
 * A portable descriptor for the MongoDB the jobs were driven against.
 *
 * THIS REPLACED `evidence.database` AND `evidence.uri`, which recorded the
 * generated database name and the whole connection string verbatim. Both are
 * run state - the loopback host, the ephemeral port `mongodb-memory-server`
 * chose, the per-run name `test/parity/mongo.js` generates - so an artifact
 * carrying them describes the machine it ran on rather than the store it used,
 * and a connection string is also where credentials live. Digesting the string
 * instead would have been no better: an unsalted digest of a value containing a
 * secret is an offline oracle for it, and a digest whose input contains an
 * ephemeral port changes on every run, so the field would still have
 * identified the RUN while claiming to identify the store.
 *
 * `provenance.configurationDigest` is the safe route and records what it did in
 * its own `canonicalization` string: secret-labelled leaves replaced,
 * address-labelled leaves dropped, URI userinfo removed. What survives is the
 * scheme, whether credentials were required and the connection options, so the
 * field still discriminates a replica-set or TLS store from this harness's
 * plain loopback one while being identical across two runs of the same
 * configuration.
 *
 * The operator is not left without the address: `applyEnvironment` still prints
 * the database name and the URI to stderr, which is where run-local detail
 * belongs and which the artifact rule does not reach.
 *
 * @param {Object} address From `mongo.start`.
 * @returns {{kind: string, lifecycle: string,
 *            configurationDigest: {algorithm: string, canonicalization: string,
 *                                  value: string}}}
 */
function describeDataStore(address) {
  return {
    kind               : 'mongodb',
    // `mongo.start` starts an instance of its own here rather than adopting an
    // inherited one, so this is stated rather than inferred from PARITY_*.
    lifecycle          : 'started by this harness through test/parity/mongo.js',
    configurationDigest: provenance.configurationDigest(
      parseStoreUri(address && address.uri))
  };
}

/**
 * How the harness was invoked, in portable form.
 *
 * Computed once and used twice - by `evidence.tool` and by the provenance
 * block's detail - so the two can never disagree about which module was driven
 * or which overlay was layered.
 *
 * Every path becomes a symbolic label: `tool:` for a file in this tool's
 * worktree, `analysed:` for one in the tree under test, `ephemeral:` plus a
 * basename for anything outside both. That is what makes the record mean the
 * same thing in every clone, and it is why an absolute `--overlay` or
 * `--worker-module` cannot smuggle a machine path into a committed artifact.
 *
 * @param {Object} options From parseArguments.
 * @returns {{workerModule: (string|null), overlay: (string|null),
 *            emitterPatch: boolean, controlRun: boolean,
 *            analysedTreeIsToolWorktree: boolean}}
 */
function describeInvocation(options) {
  return {
    workerModule : pathLabelFor(
      path.resolve(options.appRoot, options.workerModule), options.appRoot),
    overlay      : pathLabelFor(options.overlayPath, options.appRoot),
    emitterPatch : !!options.emitterPatch,
    // A control run measures the harness rather than the application - either
    // the queue patch was withheld so no job outcome is observable, or a module
    // other than the shipped worker was driven. Recorded in the provenance
    // because a control artifact must never be mistaken for gate evidence, and
    // the two flags that produce one are otherwise only in the stderr log.
    controlRun   : !options.emitterPatch ||
      options.workerModule !== 'lib/workers/exports',
    // The boolean, not the two paths: whether the tree driven IS this tool's
    // own worktree. False means a foreign `--app`, in which case the two HEADs
    // in the block differ by construction.
    analysedTreeIsToolWorktree : options.appRoot === TOOL_ROOT
  };
}

/**
 * The role this run's evidence may claim, decided by the tree it drove.
 *
 * The role follows the TREE, not the mode: this harness drives whichever
 * worktree `--app` names, so a run against a worktree at AAP 0.10.3's base
 * commit is baseline evidence and a run against the migrated tree is target
 * evidence.
 *
 * THE ONE CASE THAT NEEDS DECIDING is a DIRTY worktree at the base commit.
 * `tree.isBaselineCommit` alone used to be enough to stamp `baseline` on the
 * block, and it is not: the base commit plus uncommitted edits is not the base
 * commit's content, so what such a run drove is not retrievable from this
 * repository while the block reads exactly like a clean baseline capture. The
 * decision is delegated to `provenance.assertBaseline` rather than
 * re-implemented here, so this harness and every sibling refuse the same thing
 * for the same reason.
 *
 * It is a DOWNGRADE, not a crash, and that matters more here than anywhere:
 * this harness runs for minutes, drives four jobs and asserts every check in
 * its ledger, so throwing at the point the block is built would discard a
 * complete run over a label. The jobs are still driven, the artifact is still written,
 * and the role is recorded as `unreviewed` - which every gate treats as
 * non-qualifying - with the contract's own explanation printed, including how
 * to list the uncommitted changes. A caller that wants the refusal to be fatal
 * reads `role` off the returned block.
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
      what : 'the worker-gate evidence from this run'
    });
  }
  catch (err) {
    // Reachable only for a dirty worktree at the base commit: a tree that is
    // not at that commit returned above, so the contract's other refusal
    // cannot be reached from here.
    note('WARNING: ' + ((err && err.message) || err));
    note('the jobs are still driven and the evidence is still written; the ' +
      'provenance role is recorded as `unreviewed`, which does not qualify ' +
      'as baseline evidence.');

    return provenance.assertBaseline(tree, {
      allowNonBaseline : true,
      what             : 'the worker-gate evidence from this run'
    });
  }
}

/**
 * Builds this harness's provenance block.
 *
 * The role is `resolveProvenanceRole`'s above; everything else here is the
 * shared contract's. There is no baseline MODE, because the worker gate exists
 * to validate the migrated tree - what it measured is stated rather than
 * assumed.
 *
 * @param {Object} options From parseArguments.
 * @param {Object} [invocation] From describeInvocation; computed if absent.
 * @returns {Object} The block, portability already asserted by the contract.
 * @throws {ToolError} From the contract, when a value is not reproducible.
 */
function buildProvenanceRecord(options, invocation) {
  var detail = invocation || describeInvocation(options);
  var tree   = provenance.treeIdentity(options.appRoot);

  return provenance.build({
    artifact     : options.outPath || DEFAULT_ARTIFACT,
    role         : resolveProvenanceRole(tree),
    generatorFile: __filename,
    toolRoot     : TOOL_ROOT,
    analysedRoot : options.appRoot,
    detail       : {
      gate                      : 'AAP 0.9.3 - the export worker driven ' +
        'through deterministic jobs: Bull 4 semantics, the persisted Export ' +
        'document, the archive, the upload and the notification mail',
      workerModule              : detail.workerModule,
      overlay                   : detail.overlay,
      emitterPatch              : detail.emitterPatch,
      controlRun                : detail.controlRun,
      analysedTreeIsToolWorktree: detail.analysedTreeIsToolWorktree
    }
  });
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * The whole harness: bootstrap, drive, assert, close, report.
 *
 * Never throws for an assertion failure - the ledger holds those and the
 * verdict reflects them - and always tears down, because a run that lost its
 * report or left a mongod behind has failed at its actual job. There are two
 * verdicts and no third: PASS when every check passed, FAIL otherwise.
 *
 * The order of the closing sequence is deliberate and each step depends on the
 * one before it: teardown closes what the run opened and every step of it is
 * asserted; the handle inventory is only meaningful after that; the warning
 * classification covers the whole captured stream including teardown; the
 * determinism comparison is a check like any other; the run directory's fate
 * depends on whether anything failed, so it is decided after the checks that
 * could fail; and the artifact is written LAST, once `notesOwed`, the check
 * summary and the verdict are all in it.
 *
 * @param {Object} options From parseArguments.
 * @returns {Promise<Object>} `{code, verdict, evidence}`
 */
async function run(options) {
  var ledger  = createLedger();
  var started = Date.now();
  var ctx     = {
    options         : options,
    postCloseErrors : [],
    // What was actually opened, keyed exactly as the teardown steps name their
    // resources. Teardown skips a step only when its key is absent here, and
    // `assertTeardown` holds the two to an equivalence, so this map is the
    // record that makes a conditional teardown checkable.
    opened          : {},
    // Whether the second module graph was CONNECTED and whether the
    // cross-graph read was ASSERTED. Both start false and the notes claim
    // nothing until they are true: an earlier revision emitted the dual-graph
    // success note whenever the mode was dual-graph, so a baseline run whose
    // seeding never happened still shipped an artifact saying the fixtures had
    // been read back and asserted.
    crossGraph      : { connected : false, asserted : false },
    queueUsable     : false
  };
  // WHAT THIS EVIDENCE IS. `tool` describes HOW the harness was invoked and
  // `provenance` describes WHICH revisions produced the result, and both are
  // needed: a record of paths and a runtime cannot name the application or the
  // generator it came from, so it cannot be authenticated against a delivery.
  //
  // `execArgv` stays verbatim because it is the evidence for a different gate -
  // it carries the `--pending-deprecation --trace-deprecation` flags AAP 0.8's
  // zero-warning bar is measured under, and a run without them has not made
  // that measurement. The three paths that used to sit beside it do not stay:
  // `appRoot` is now named by its HEAD in `provenance.analysedTree`, and the
  // worker module and the overlay are reduced to symbolic labels that identify
  // the same file in every clone.
  var invocation = describeInvocation(options);
  var evidence = {
    tool : {
      file         : 'test/parity/worker.js',
      node         : process.version,
      execArgv     : process.execArgv.slice(),
      workerModule : invocation.workerModule,
      emitterPatch : invocation.emitterPatch,
      overlay      : invocation.overlay
    },
    provenance : buildProvenanceRecord(options, invocation),
    jobs : []
  };
  var verdict = 'FAIL';
  var code;
  var handles;
  var classified;
  var judgedWarnings;
  var teardownRecord;
  var previous;
  var differences;
  // The exact bytes written to `--out`, kept so the sidecar can digest what
  // was written rather than a second serialization of the same object.
  var artifactText;
  var comparisonError;
  var decision;
  var teardownIndex;

  /**
   * The verdict and exit code, derived from the ledger in one place.
   *
   * The one place in this file that turns a failure set into an exit code, so
   * that no operation can end up with a private idea of what "failed" means.
   * A ledger failure is the harness reporting that something it asserted is
   * not true, and there is no softer outcome to fall back to: the BLOCKED
   * verdict went with the unusable-queue path this harness no longer takes -
   * it drives a real queue, and a capability it cannot exercise is a failure.
   *
   * @returns {{verdict: string, code: number}}
   */
  function deriveVerdict() {
    if (ledger.failures().length > 0) {
      return { verdict : 'FAIL', code : EXIT_ERROR };
    }

    return { verdict : 'PASS', code : EXIT_OK };
  }

  installCapture();

  if (options.workerModule !== 'lib/workers/exports') {
    note('CONTROL RUN: the worker module is ' + options.workerModule +
      ', not the shipped lib/workers/exports.');
  }

  try {
    // Before anything is created or connected: a contaminated process cannot
    // produce evidence about the tree under test, so there is nothing to
    // set up.
    assertUncontaminatedProcess();
    assertAppRoot(options.appRoot);

    ctx.layout = createRunDirectory(options.runDir);
    ctx.opened.runDir = true;
    // Labels, not paths. Both directories are this harness's own choice, so
    // their absolute form names the machine and nothing else; `ctx.layout`
    // keeps the real paths for every filesystem operation below and the
    // stderr note in `applyEnvironment` still prints the run directory for an
    // operator who has to go and look at it.
    evidence.runDir = pathLabelFor(ctx.layout.runDir, options.appRoot);
    evidence.s3Root = pathLabelFor(ctx.layout.s3Root, options.appRoot);

    ctx.environment = await applyEnvironment(options, ctx.layout);
    ctx.opened.mongo = true;
    ctx.address     = ctx.environment.address;
    ctx.cwdBefore   = ctx.environment.cwdBefore;
    ctx.opened.cwd  = Boolean(ctx.cwdBefore);
    // The store, as a descriptor rather than as its address: the generated
    // database name and the connection string were recorded here verbatim, and
    // both are run-local state in a file that is read as evidence. See
    // describeDataStore for why digesting the string would not have fixed it.
    evidence.dataStore = describeDataStore(ctx.address);

    ctx.graph = inspectModuleGraph(options.appRoot);
    ctx.graph.mode = ctx.graph.shared ? 'shared' : 'dual-graph';
    // `shared` is the verdict and is computed from the real resolutions in
    // `ctx.graph`; the two paths are its evidence, and labelling them keeps
    // exactly that evidence. Two resolutions of one file inside one root give
    // one label, and a foreign `--app` gives `tool:` against `analysed:`, so
    // the distinction the field exists to show survives without the artifact
    // naming a machine.
    evidence.moduleGraph = {
      mode         : ctx.graph.mode,
      shared       : ctx.graph.shared,
      toolMongoose : pathLabelFor(ctx.graph.toolMongoose, options.appRoot),
      appMongoose  : pathLabelFor(ctx.graph.appMongoose, options.appRoot)
    };

    // The fixtures describe themselves in terms of the tree they patched, the
    // store root they were pointed at and their own log files - four absolute
    // paths and a free-form diagnostic, recorded here wholesale. The walk
    // labels every one of them, and covers a field a fixture adds later.
    // `loadFixtures` still reads the raw status, which is what its own
    // installation checks compare.
    evidence.fixtures = portableRecord(loadFixtures(options.appRoot),
      options.appRoot);
    ctx.opened.fixtures = Boolean(awsFixture || mailFixture);

    // Template watching suppressed BEFORE anything can pull
    // `lib/util/nunjucks` into the process, which the worker's require graph
    // does two levels down. The wrapper has to be in place when
    // `nunjucks.configure` runs, because that single call is what decides
    // whether a watcher - and a require of undeclared chokidar - happens at
    // all.
    ctx.templateWatch = installTemplateWatchSuppression(options.appRoot);
    ctx.opened.templateWatch = true;

    // The namespace BEFORE `lib/util/queues.js` constructs anything, because
    // the prefix is a constructor option and the queue is built on first call.
    ctx.prefix = PREFIX_STEM + '-' + path.basename(ctx.layout.runDir)
      .replace(PREFIX_STEM + '-', '') + '-' +
      crypto.randomBytes(3).toString('hex');
    ctx.bull = installBullPrefix(options.appRoot, ctx.prefix);
    ctx.opened.bull = true;

    // The queue instance FIRST, then the listener baseline, then the observer,
    // and only then the worker: the baseline has to be taken before the
    // worker's handlers land on the queue, or the delta that proves it
    // registered them would already include them.
    ctx.queues = requireApp(options.appRoot, 'lib/util/queues');
    ctx.queue  = ctx.queues.exports();
    ctx.opened.queue = true;
    ctx.queueListenerBaseline = listenerCounts(ctx.queue);
    ctx.observer = installQueueObserver(ctx.queue);
    ctx.opened.observer = true;

    // MEASURED, then asserted - in that order, and the order is the fix. The
    // surface record goes into the artifact whatever it says, so a selected
    // worktree that resolves an older bull is reported as the measurement it
    // is; `assertQueueIsRealBull` then fails by name, and the run carries on
    // to collect the load-order, fixture and capability evidence that `--app`
    // exists to obtain.
    ctx.queueSurface = probeQueueSurface(ctx.queue, {
      modulePath     : ctx.bull.module,
      expectedPrefix : ctx.bull.prefix,
      redis          : options.redisHost + ':' + options.redisPort,
      appRoot        : options.appRoot
    });
    evidence.queue = ctx.queueSurface;
    ctx.opened.queueClients = ctx.queueSurface.bull4Api;

    ctx.queueUsable = await assertQueueIsRealBull(ctx, ledger);

    if (!ctx.queueUsable) {
      note('the selected worktree resolved ' + ctx.queueSurface.package +
        ' (keyPrefix ' + JSON.stringify(ctx.queueSurface.keyPrefix) +
        ', missing ' + (ctx.queueSurface.missing.join(', ') || 'nothing') +
        '). No job will be enqueued: a queue whose `prefix` option was ' +
        'ignored addresses the shared bull:exports:* keyspace, and this host ' +
        'runs many clones against one Redis. The run continues so that the ' +
        'load-order, fixture and capability evidence is still collected, and ' +
        'every job-dependent check below FAILS by name.');
    }

    evidence.templates = {
      watchSuppressed     : true,
      beforeWorkerRequire : measureTemplateResolution(options.appRoot,
        'emails/export-ready')
    };

    ctx.load = requireWorker(options);
    // A require failure's message is a resolution failure of THIS harness -
    // `Cannot find module '<absolute path>'` - so the recorded copy is
    // labelled while `ctx.load` keeps the raw text for the notes below.
    evidence.loadOrder = portableRecord(ctx.load, options.appRoot);

    // The application's own mongoose, resolved whether or not the require
    // succeeded. `lib/workers/exports.js` requires `config/db` FIRST, so a
    // require that throws later has already called `mongoose.connect` - and a
    // connection this run opened is a connection this run has to close,
    // whatever else went wrong.
    ctx.mongoose = requireAppPackage(options.appRoot, 'mongoose');
    ctx.opened.mongoose = true;
    evidence.appConnection = {
      readyState : ctx.mongoose.connection.readyState,
      database   : ctx.mongoose.connection.name || null
    };

    // Generated line addresses, read from the tree under test. Independent of
    // the worker having loaded, so they are read either way: on a worktree
    // where the require fails, the anchors are how a reader finds the code
    // that failed.
    evidence.sourceAnchors = readSourceAnchors(options.appRoot);

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
            'config.isTest, and what configures the global environment instead ' +
            'is its own require graph, through lib/util/nunjucks. Error: ' +
            evidence.templates.afterWorkerRequire.error);
        });

      ctx.config      = requireAppPackage(options.appRoot, 'config');
      ctx.redisModule = requireApp(options.appRoot, 'config/redis');
      ctx.opened.redisModule = true;
      ctx.toolMongoose = require('mongoose');
      ctx.opened.toolMongoose = ctx.toolMongoose !== ctx.mongoose;

      await awaitConnection(ctx.mongoose, CONNECT_TIMEOUT_MS);
      evidence.appConnection = {
        readyState : ctx.mongoose.connection.readyState,
        database   : ctx.mongoose.connection.name || null
      };

      // The Export model, taken through the application's own module so the
      // declared dependency is the one exercised. `lib/models/export.js`
      // exports model.js's `publicModel`, whose `.model` IS the registered
      // mongoose model, and the worker resolves
      // `Export.model || mongoose.model('Export')`. Asserting the identity is
      // what makes reading the document back, and recording the updates,
      // provably about the same object the worker writes through.
      ctx.Export      = requireApp(options.appRoot, 'lib/models/export');
      ctx.ExportModel = ctx.mongoose.model('Export');

      await ledger.check('the Export model the harness reads is the one the ' +
        'worker writes through', function() {
          assert.strictEqual(ctx.Export.model, ctx.ExportModel,
            'lib/models/export.js\'s publicModel.model must be the registered ' +
            'mongoose model; the worker resolves the same pair');
          assert.strictEqual(ctx.ExportModel.modelName, 'Export', 'modelName');
        });

      seedTool    = require('./seed');
      storageTool = require('./storage');
      ctx.seed    = seedTool;
      ctx.storage = storageTool;

      if (!ctx.graph.shared) {
        // An independently installed worktree resolves its own mongoose, so
        // the seeder beside this file has a connection of its own to open -
        // to the SAME database, which is what makes the fixtures visible to
        // the worker. Refusing the configuration was the old behaviour and it
        // refused the very architecture `--app` exists for; the cross-graph
        // read in `assertSeeded` is what replaces the refusal with evidence.
        note('dual module graph: ' + options.appRoot + ' resolves its own ' +
          'mongoose (' + ctx.graph.appMongoose + ') while this harness ' +
          'resolves ' + ctx.graph.toolMongoose + '. The seeder connects ' +
          'separately to the same database and the fixtures are read back ' +
          'through the application\'s graph before any job is driven.');

        // The same disposition `config/db.js` applies to the application's own
        // mongoose, applied here to the harness's second instance. Measured:
        // without it this connection emits the Mongoose 7 `strictQuery`
        // deprecation notice into the very stderr stream this gate asserts on -
        // a warning the application never emits, produced by the harness's own
        // connection. Mirroring the application's setting is the fix; silencing
        // the stream is not.
        ctx.toolMongoose.set('strictQuery', true);

        await withTimeout(Promise.resolve(ctx.toolMongoose.connect(
          ctx.address.uri)), CONNECT_TIMEOUT_MS,
          'the tool graph\'s own connection to ' + ctx.address.database);

        // Recorded only once the connection actually resolved. The dual-graph
        // note in the artifact is gated on this AND on the cross-graph read
        // assertion, so neither can be claimed by a run that never got here.
        ctx.crossGraph.connected = true;
      }

      await ledger.check('the seeder can write to the database the worker ' +
        'reads (' + ctx.graph.mode + ')', function() {
          assert.strictEqual(ctx.toolMongoose.connection.readyState, 1,
            'the mongoose instance test/parity/seed.js resolves must be ' +
            'connected; readyState is ' +
            ctx.toolMongoose.connection.readyState);
          assert.strictEqual(ctx.toolMongoose.connection.name,
            ctx.address.database,
            'and to the per-run database ' + ctx.address.database + ', not ' +
            ctx.toolMongoose.connection.name);
        });

      ctx.capabilities = await probeCapabilities(options.appRoot, ctx.mongoose,
        options.workerModule);
      evidence.capabilities = ctx.capabilities;

      await assertExportPathUsable(ctx, ledger);

      ctx.expectedTrinkets = buildExpectedTrinkets(ctx.seed);
      ctx.updates = installUpdateRecorder(ctx.ExportModel);
      ctx.opened.recorder = true;

      evidence.seed = await seedFixtures({
        seed             : ctx.seed,
        ExportModel      : ctx.ExportModel,
        mongooseInstance : ctx.mongoose
      });
      evidence.seed.expectedTrinkets = ctx.expectedTrinkets.map(function(spec) {
        return spec.shortCode;
      });

      await assertSeeded(ctx, ledger, evidence.seed);
      await assertQueueRegistration(ctx, ledger);

      if (!ctx.queueUsable) {
        await failUndrivenJobs(ctx, ledger, 'no job was enqueued: the ' +
          'selected worktree resolved ' + ctx.queueSurface.package +
          ' with keyPrefix ' + JSON.stringify(ctx.queueSurface.keyPrefix) +
          (ctx.queueSurface.missing.length
            ? ' and without ' + ctx.queueSurface.missing.join(', ')
            : '') +
          '. This gate asserts Bull 4 semantics and refuses to enqueue into ' +
          'a keyspace it cannot isolate by prefix, because up to sixty-four ' +
          'clones share one Redis on this host and they would share ' +
          'bull:exports:*. Remedy: ' + ctx.queueSurface.remedy);
      }

      ctx.staller = ctx.queueUsable
        ? await createStallingInstance(options.appRoot, ctx.prefix, {
            host : options.redisHost,
            port : options.redisPort
          })
        : null;
      ctx.opened.staller = Boolean(ctx.staller);

      if (ctx.queueUsable) {
        // From here on there are keys in this run's namespace, which is what
        // makes the obliterate step in teardown a step that must RUN.
        ctx.opened.bullNamespace = true;

        await withTimeout((async function() {
          var i;
          var spec;
          var outcome;

          for (i = 0; i < JOBS.length; i++) {
            spec    = JOBS[i];
            outcome = await driveJob(ctx, spec);

            await assertJobShape(ctx, ledger, outcome);

            if (spec.name === 'success') {
              await assertSuccessCompleted(ctx, ledger, outcome);
            }
            else if (spec.name === 'missing-user') {
              await assertMissingUserJob(ctx, ledger, outcome);
            }
            else if (spec.name === 'late-failure') {
              await assertLateFailureJob(ctx, ledger, outcome);
            }
            else if (spec.name === 'unknown-action') {
              await assertUnknownActionJob(ctx, ledger, outcome);
            }
            else if (spec.kind === 'retry') {
              await assertRetryJob(ctx, ledger, outcome);
            }
            else if (spec.kind === 'stalled') {
              await assertStalledJob(ctx, ledger, outcome);
            }
            else {
              await assertLockLossJob(ctx, ledger, outcome);
            }

            evidence.jobs.push(projectJob(outcome, spec.name));
          }
        })(), options.timeoutMs, 'the ' + JOBS.length + ' jobs');
      }

      // The SECOND integrity pass, after every job. The first proved the
      // pre-migration objects were the manifest's bytes; this one proves the
      // worker READ them rather than rewriting them - the archive it uploads
      // lands at its own generated key, so a seeded object whose digest moved
      // means something wrote over pre-migration data.
      await ledger.check('the pre-migration objects still hold exactly the ' +
        'bytes they were seeded with, after every job', function() {
          var observed = verifySeedIntegrity(evidence.seed.s3.expected)
            .map(function(entry) {
              return { bucket : entry.bucket, key : entry.key,
                digest : entry.digest, size : entry.size };
            });
          var wanted = evidence.seed.s3.expected.map(function(entry) {
            return { bucket : entry.bucket, key : entry.key,
              digest : entry.digest, size : entry.size };
          });

          evidence.seed.s3.integrityAfterJobs = observed;

          assert.deepStrictEqual(observed, wanted,
            'the export path reads the seeded asset and archive; it must not ' +
            'have written over either');
        });

      await assertIsolation(ctx, ledger);
    }
    else {
      // The worker could not be required, which is the measured baseline
      // behaviour at 2f8712a (AAP 0.6.5) and a failure here. The evidence
      // that does not depend on it is still collected: the source-only
      // capability probe, and a named failure for every job.
      try {
        ctx.capabilities = await probeCapabilities(options.appRoot, null,
          options.workerModule);
      }
      catch (err) {
        ctx.capabilityError = err;
        ctx.capabilities    = null;
      }

      evidence.capabilities = ctx.capabilities;

      await assertExportPathUsable(ctx, ledger);
      await failUndrivenJobs(ctx, ledger, 'the worker module could not be ' +
        'required in the selected worktree, so nothing consumed the queue: ' +
        ((ctx.load.error && ctx.load.error.message) || 'no error recorded'));
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

  // Each step's `message` is whatever the failing teardown operation threw -
  // an ENOENT quoting a directory, a chdir naming the working directory it
  // could not restore - so the recorded copy is labelled. `teardown` printed
  // the raw text as it happened.
  teardownRecord = await teardown(ctx, ledger.failures().length === 0);

  await assertTeardown(ctx, ledger, teardownRecord);

  evidence.teardown = portableRecord(teardownRecord, options.appRoot);

  // EVERY TEARDOWN STEP REACHES THE VERDICT. `teardown` reports each failed
  // step on stderr and returns it in the evidence, and both of those are kept -
  // but neither is a failure the exit code could see, so a run that could not
  // close a queue, disconnect mongoose, stop the database or restore the
  // working directory used to report PASS or BLOCKED with a live connection or
  // a live process behind it. One failed check per failed step, so the report
  // names which one rather than counting them, and `deriveVerdict` - which is
  // read again after the artifact write below - turns any of them into FAIL.
  for (teardownIndex = 0; teardownIndex < evidence.teardown.length;
    teardownIndex++) {
    await registerTeardownStep(ledger, evidence.teardown[teardownIndex]);
  }

  handles    = await settleHandles(SETTLE_TIMEOUT_MS);

  // Warnings already scheduled are delivered before the stream is read. Node
  // delivers an emitWarning on a later turn and a dependency can schedule one
  // on a timer - the retained AWS SDK v2 emits its NOTE from a zero-delay
  // timer - so reading the buffer synchronously here would report a clean run
  // and then let the notice print after the verdict.
  await warningPolicy.drainPendingWarnings();

  classified = classifyWarnings(capturedStderr(), options.appRoot);

  judgedWarnings = await assertWarnings(ledger, classified);
  await assertCleanClose(ledger, handles);

  // The gate's own record, in the shape every parity gate now writes it: the
  // policy it was judged against, the flags it was measured under - without
  // which a quiet stream is not evidence - and every notice, with none
  // subtracted. `test/parity/replay.js --worker-evidence` reads exactly this,
  // which is how the worker third of AAP 0.9.3's exercise is accounted in the
  // replay gate that cannot drive it.
  evidence.warnings = {
    policy      : judgedWarnings.policy.id,
    flags       : judgedWarnings.flags,
    gateApplies : judgedWarnings.gateApplies,
    ok          : judgedWarnings.ok,
    qualifying  : judgedWarnings.qualifying,
    notices     : judgedWarnings.notices,
    failures    : judgedWarnings.failures
  };
  evidence.handles = handles;
  evidence.dependencies = {
    // Taken from teardown's own reading when it ran, so the artifact records
    // the state the assertions were made against rather than a second,
    // later measurement.
    templateWatch : ctx.templateWatchClosure ||
      (ctx.templateWatch ? ctx.templateWatch.describe() : null)
  };
  evidence.runDirectory = ctx.runDirectory || null;
  evidence.stalling = ctx.staller
    ? { errors : ctx.staller.errors() }
    : null;

  evidence.durationMs = Date.now() - started;

  if (options.comparePath) {
    comparisonError = null;

    try {
      previous    = JSON.parse(fs.readFileSync(options.comparePath, 'utf8'));
      differences = compareEvidence(
        normalizeEvidence(projectComparable(evidence)),
        normalizeEvidence(projectComparable(previous)));

      // The compared artifact is named by its label: `--compare` is a
      // caller-supplied absolute path, and the differences themselves are
      // already portable because both sides were.
      evidence.comparison = {
        against     : pathLabelFor(path.resolve(options.comparePath),
          options.appRoot),
        differences : differences
      };
    }
    catch (err) {
      comparisonError = (err && err.message) || String(err);

      note('the comparison against ' + options.comparePath + ' could not be ' +
        'made: ' + comparisonError);

      evidence.comparison = {
        against : pathLabelFor(path.resolve(options.comparePath),
          options.appRoot),
        error   : comparisonError
      };
    }

    // The diagnostic evidence above is kept - the note and `comparison.error`
    // are what a reviewer reads - but it is NOT the verdict. A comparison the
    // caller ASKED for and that did not happen is a failure: an absent,
    // unreadable or malformed comparison input would otherwise leave the
    // verdict at PASS or BLOCKED while the requested determinism check never
    // occurred, which is a gate reporting success on work it did not do.
    await ledger.check('determinism: the comparison against ' +
      options.comparePath + ' was performed', function() {
        assert.strictEqual(comparisonError, null,
          '--compare was given, so this run was asked to compare itself ' +
          'against ' + options.comparePath + ', and the comparison could not ' +
          'be made: ' + comparisonError);
      });

    // Registered separately, and only when there was something to compare, so
    // the report distinguishes "compared and differed" from "could not
    // compare" - two different problems with two different remedies.
    if (comparisonError === null) {
      await ledger.check('determinism: this run matches ' + options.comparePath +
        ' once the enumerated volatile values are normalized', function() {
          assert.deepStrictEqual(differences, [],
            'differences: ' + JSON.stringify(differences, null, 2));
        });
    }
  }

  // Every check that does not depend on the artifact has now run, so the
  // evidence document is COMPLETED before it is serialized. `notesOwed` is
  // built here rather than after the write for the same reason the write is a
  // check: an artifact that omits the notes the terminal then prints is a
  // requested output that only partly happened, and the notes are the part a
  // reviewer of the parity evidence cannot derive from a pass or a fail.
  evidence.notesOwed = buildNotesOwed(ctx, evidence);

  // The check tally as of serialization. It cannot include the artifact
  // write's own check - a document cannot record the outcome of writing
  // itself - so the terminal tally below is one higher whenever `--out` was
  // given. The difference is exactly that check, and reading the artifact at
  // all is proof it passed.
  evidence.checks = {
    count    : ledger.count(),
    passed   : ledger.passed(),
    failures : portableFailures(ledger.failures(), options.appRoot)
  };

  decision = deriveVerdict();
  verdict  = decision.verdict;
  code     = decision.code;
  evidence.verdict = verdict;

  // The provenance is hash-linked to the evidence HERE, as late as possible and
  // immediately before serialization, because `attach` digests the evidence
  // WITHOUT its provenance: every field a consumer will read has to be final or
  // the block would certify a payload the artifact does not contain. The block
  // itself was built at the top of the run, so a run that fails early still
  // says which revisions failed.
  //
  // The digest therefore covers exactly the evidence as serialized below,
  // `notesOwed` included: the notes are assembled just above, before the
  // artifact is written, so what a reviewer of the file reads is what the
  // digest certifies.
  provenance.attach(evidence, evidence.provenance);

  note('provenance: ' + evidence.provenance.role + ' evidence about tree ' +
    (evidence.provenance.analysedTree.head || 'not a checkout') +
    ', generator ' + evidence.provenance.generator.path + ' blob ' +
    String(evidence.provenance.generator.blob).slice(0, 12) +
    (evidence.provenance.generator.verified
      ? ', verified in commit ' +
        String(evidence.provenance.generator.commit).slice(0, 7)
      : ', ' + evidence.provenance.generator.commitState));

  if (options.outPath) {
    // Recorded before the write, so the saved file names the path it was
    // saved to; corrected below if the write itself fails.
    evidence.artifact = { path : options.outPath, written : true };

    try {
      artifactText = JSON.stringify(evidence, null, 2) + '\n';

      writeArtifactAtomically(options.outPath, artifactText);
      note('artifact ' + options.outPath);

      // The same record, plus a digest of the bytes exactly as written. The
      // embedded block is what makes the artifact self-describing; the sidecar
      // is for a caller that wants the record outside bytes it intends to
      // compare, and it is a run output rather than a delivered file.
      fs.writeFileSync(options.outPath + '.provenance.json', JSON.stringify(
        provenance.sidecar(evidence.provenance, artifactText), null, 2) + '\n');
      note('provenance ' + options.outPath + '.provenance.json');
    }
    catch (err) {
      note('the artifact could not be written to ' + options.outPath + ': ' +
        ((err && err.message) || err));

      await ledger.check('the requested artifact was written to ' +
        options.outPath, function() {
          throw err;
        });

      // The run asked for evidence and produced none, so the summary and the
      // verdict are re-derived: a run that could not write its artifact has
      // not done what it was asked to do.
      evidence.checks = {
        count    : ledger.count(),
        passed   : ledger.passed(),
        failures : portableFailures(ledger.failures(), options.appRoot)
      };
      decision = deriveVerdict();
      verdict  = decision.verdict;
      code     = decision.code;
      evidence.verdict = verdict;
      evidence.artifact = { path : options.outPath, written : false };
    }
  }
  note('notes owed to docs/baseline-parity.md (emitted here; this file edits ' +
    'no documentation):');
  evidence.notesOwed.forEach(function(entry, index) {
    note('  ' + (index + 1) + '. ' + entry);
  });

  // Stamped onto the document so the saved artifact carries a verdict, and
  // derived again after the write below, which is where the authoritative
  // exit code comes from.
  decision = deriveVerdict();
  verdict  = decision.verdict;
  code     = decision.code;
  evidence.verdict = verdict;

  if (options.outPath) {
    // Writing the artifact is requested work, so failing to write it is a
    // failed check rather than a note: `--out` must not be able to produce
    // nothing while the process exits 0. Recording it as a check only has
    // teeth because the verdict is derived AGAIN below - the previous shape
    // computed the verdict before this point, so a write failure could not
    // have reached the exit code even had it been recorded.
    await ledger.check('the evidence artifact was written to ' + options.outPath,
      function() {
        try {
          fs.writeFileSync(options.outPath,
            JSON.stringify(evidence, null, 2) + '\n');
        }
        catch (err) {
          note('the artifact could not be written to ' + options.outPath + ': ' +
            ((err && err.message) || err));
          throw err;
        }

        note('artifact ' + options.outPath);
      });
  }

  // The authoritative derivation: after every check that can fail, the write
  // included. One further write to reconcile the file with this verdict is
  // provably unnecessary, which is why none is attempted and an unwritable
  // --out can neither loop nor be counted twice. The write's check is the only
  // check between the two derivations: when it PASSES the failure set is
  // unchanged, so the verdict on disk is already this one; when it FAILS there
  // is no fresh artifact for a stale verdict to mislead anybody from, the
  // verdict becomes FAIL here, and the process exits non-zero.
  decision = deriveVerdict();
  verdict  = decision.verdict;
  code     = decision.code;
  evidence.verdict = verdict;

  note('checks ' + ledger.passed() + '/' + ledger.count() + ' passed, ' +
    evidence.jobs.length + ' job(s) driven on ' +
    (evidence.queue ? evidence.queue.package + ' at ' + evidence.queue.redis +
      ' under ' + evidence.queue.prefix : 'no queue') + ', ' +
    evidence.warnings.notices.length + ' notice(s) (0 allowed - the gate has ' +
    'no allowances), measured under ' +
    (evidence.warnings.flags.complete
      ? evidence.warnings.flags.required.join(' ')
      : 'INCOMPLETE FLAGS, so no warning evidence') + ', ' +
    evidence.durationMs + 'ms');

  ledger.failures().forEach(function(failure) {
    note('  FAILED ' + failure.name + ': ' + failure.message);
  });

  note('VERDICT ' + verdict);

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
  // directly rather than only through a full run - the namespace injection,
  // the queue-surface probe, the template-watch suppression and the seed
  // integrity check in particular, since each replaces a mechanism this gate
  // used to be criticised for and each should be inspectable alone.
  parseArguments         : parseArguments,
  assertAppRoot          : assertAppRoot,
  assertUncontaminatedProcess : assertUncontaminatedProcess,
  createRunDirectory     : createRunDirectory,
  removeRunDirectory     : removeRunDirectory,
  inspectModuleGraph     : inspectModuleGraph,
  installBullPrefix      : installBullPrefix,
  probeQueueSurface      : probeQueueSurface,
  installQueueObserver   : installQueueObserver,
  installTemplateWatchSuppression : installTemplateWatchSuppression,
  verifySeedIntegrity    : verifySeedIntegrity,
  createStallingInstance : createStallingInstance,
  readSourceAnchors      : readSourceAnchors,
  listenerCounts         : listenerCounts,
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

  // Evidence identity, exported so the block and the portable invocation
  // record can be built and inspected WITHOUT a database or a driven job: the
  // guarantees they carry - no absolute path, no address, a generator blob that
  // resolves in this repository, a tree HEAD that matches the worktree - are
  // each checkable on their own, and a full worker run is not the place to
  // discover that one of them regressed.
  buildProvenanceRecord  : buildProvenanceRecord,
  resolveProvenanceRole  : resolveProvenanceRole,
  describeInvocation     : describeInvocation,
  describeDataStore      : describeDataStore,
  parseStoreUri          : parseStoreUri,
  pathLabelFor           : pathLabelFor,
  portableReason         : portableReason,
  portableRecord         : portableRecord,
  portableFailures       : portableFailures,
  provenance             : provenance,
  DEFAULT_ARTIFACT       : DEFAULT_ARTIFACT,

  // Reference values, so a caller asserts against the same constants this file
  // uses rather than a second copy of them.
  JOBS               : JOBS,
  HARNESS_IDS        : HARNESS_IDS,
  VOLATILE           : VOLATILE,
  COMPARABLE         : COMPARABLE,
  // The zero-warning policy, re-exported as the single shared document rather
  // than as a local allowance list - which is gone, along with the entry it
  // held. A caller asserting on the bar asserts on the same object all four
  // parity gates are judged against.
  WARNING_POLICY     : warningPolicy.POLICY,
  HANDLE_ALLOWANCES  : HANDLE_ALLOWANCES,
  TEARDOWN_STEPS     : TEARDOWN_STEPS,
  ToolError          : ToolError,
  USAGE              : USAGE,
  EXIT_OK            : EXIT_OK,
  EXIT_ERROR         : EXIT_ERROR,
  EXIT_USAGE         : EXIT_USAGE
};

if (require.main === module) {
  main()
    .then(function(code) {
      // The process LEAVES ON ITS OWN, and that is the gate. Everything this
      // run opened - Bull's three Redis clients, the client config/redis.js
      // opens, both mongoose connections and the memory server - is closed in
      // teardown and each closure is asserted, and the watchers
      // lib/util/nunjucks.js would have started were never started, so
      // setting the code and returning is enough.
      //
      // The watchdog below exists for the case where that is not true, and it
      // can only ever exit NON-ZERO: a forced exit means something is still
      // holding the loop, the clean-close check has already failed on it, and
      // an exit that reported success would be the very thing that makes a
      // hung gate indistinguishable from a passing one. It is unref'd, so on
      // a clean run it holds nothing and the process is gone before it fires.
      var timer;

      process.exitCode = code;

      timer = setTimeout(function() {
        var open = process.getActiveResourcesInfo().filter(function(type) {
          return ['PipeWrap', 'TTYWrap'].indexOf(type) === -1;
        });

        clearTimeout(timer);
        process.stderr.write(LOG_PREFIX + 'the event loop is still alive ' +
          EXIT_GRACE_MS + 'ms after the run finished; ' +
          JSON.stringify(open) + ' remains open. Leaving with a FAILING code ' +
          'because a gate that has to force its own exit has not proven a ' +
          'clean close.\n');
        process.exit(code === EXIT_OK ? EXIT_ERROR : code);
      }, EXIT_GRACE_MS);

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
