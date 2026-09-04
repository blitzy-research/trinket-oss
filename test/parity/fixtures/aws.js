// Filesystem-backed S3 for the parity harness.
//
// One of the three external-effect interceptors in test/parity/fixtures/. It is
// loaded as a preload - `node --require <abs path>/test/parity/fixtures/aws.js
// app.js` - by test/parity/server.js, before the application, and it installs
// itself on first require. It is also require()d directly by
// test/parity/storage.js and test/parity/worker.js. Node core only, CommonJS,
// no CLI arguments.
//
// ===========================================================================
// WHY THIS FILE EXISTS
// ===========================================================================
// Seven call sites reach Amazon S3 from inside the request path or the export
// worker, and none of them can be exercised by the corpus without a
// substitute:
//
//   putObject   (callback)        lib/util/file.js
//   putObject   (callback)        lib/workers/exports.js
//   getObject   (callback)        lib/util/file.js
//   getObject   (callback)        lib/workers/exports.js
//   getObject   (request object)  lib/util/file.js -> .createReadStream()
//   deleteObject(callback)        lib/util/file.js
//   getSignedUrl(synchronous)     lib/controllers/users.js
//
// THAT SUMMARY IS NOT THE AUTHORITY FOR ITSELF (BE-36). The authoritative form
// is data and instrumentation, both below in this file:
//
//   AWS_SURFACE        the declared inventory, as a frozen constant - one
//                      entry per (method, form, module) with its role, and no
//                      line numbers, because a line number in a comment is
//                      stale the moment a controller is edited.
//   measureSurface()   scans lib/**/*.js and config/*.js for the call sites,
//                      resolves their LINES at run time, classifies each
//                      site's form, and reports the drift against
//                      AWS_SURFACE. This is what a documentation generator or
//                      a reviewer runs to produce the list; the prose above is
//                      a summary that it verifies.
//   surface()          what a run actually reached, from the call log, so
//                      "nothing calls headObject" is a measurement rather than
//                      a claim.
//
// The list above was itself produced that way and is kept only because a
// reader opening this file should not have to run anything to know what it
// answers. When it and the two functions disagree, the functions are right.
//
// The repository's eighth aws-sdk call site is AWS.config.update in
// config/aws.js, which reconciles the "eight call sites" figure in AAP
// 0.5.1.5 and 0.6.7: there is no eighth CLIENT method. Two corrections to the
// fixture description in AAP 0.9.3 follow from the same measurement, and both
// are owed to docs/baseline-parity.md (see NOTES below): it omits
// `getSignedUrl`, which is load-bearing because its value reaches an
// exactly-compared Location header, and it names `headObject`, which nothing
// in lib/ or config/ calls.
//
// Substitution happens at the MODULE BOUNDARY, not over the network: there is
// no proxy, no listening socket and no DNS, so the corpus is reproducible on
// any host. Every value a response can expose is deterministic, so
// test/parity/replay.js can compare exactly instead of normalizing (AAP
// 0.9.3).
//
// ===========================================================================
// USER-SPECIFIED RULES
// ===========================================================================
// `review_rules` reports that NO user-specified rules were provided for this
// project, which AAP 0.7 and 0.10.1 independently record. None are invented
// here, and their absence is not treated as licence to lower the bar:
// enterprise-standard practice governs, and the binding constraints are the
// request's own RULES block as interpreted in AAP 0.7, cited by name and never
// reproduced.
//
//   R-a  Single purpose. The seven measured forms above and nothing else - no
//        generalized mocking framework, no HTTP proxy, no cassette format, no
//        S3 feature no call site uses. `headObject` is a defensive stub that
//        nothing relies on; multipart upload, listObjects, copyObject,
//        versioning, ranges and presigned POST are absent because no call site
//        reaches them.
//   R-b  Runs on Node 22, no route or module excluded. The material download,
//        avatar and asset routes and the whole export worker belong to the
//        233-route surface replay.js must cover, and test/parity/worker.js
//        cannot validate the worker at all without this file. Node 22 only, no
//        shims.
//   R-c  Node core only: fs, os, path, crypto and stream. No package is added
//        and nothing test-only is required - in particular not `sinon`, which
//        is 1.7.3 in the BASELINE worktree this preload also runs inside and
//        lacks .callsFake (AAP 0.6.5 defect 7). Interception is plain property
//        replacement with a saved original, which is the discipline
//        test/helpers/store.js uses; that file informed the style and is NOT
//        imported.
//   R-d  Behaviour "improvements" are prohibited; a quirk is preserved and
//        documented, not fixed. Four rulings are implemented literally:
//          (1) lib/util/file.js:49 is `err && console.log(err)`, so an upload
//              error is SWALLOWED and the callback still fires. putObject can
//              therefore deliver an error, and this file never makes an error
//              louder, fatal or retried.
//          (2) lib/util/file.js:83-86 pipes getObject(...).createReadStream()
//              into a PassThrough. A missing key emits 'error' on the read
//              stream and NEVER ends it. `.pipe()` does not forward that to
//              the destination, so downloadMaterialFile's returned stream is
//              left hanging - which is baseline. No 'end' is synthesized and
//              no empty body is substituted.
//          (3) lib/workers/exports.js:118-126 derives the 12-character hash in
//              the export key from Date.now(), so the export s3Key is NOT
//              stable across runs. Nothing here assumes a fixed export key;
//              the store keys on whatever arrives.
//          (4) lib/util/file.js:28-30 overrides the upload's own
//              content-type from config.app.extensionWhitelist. That is
//              app-side logic: this file stores and returns exactly the
//              ContentType it was given, so the override stays observable.
//   R-e  Error-to-response mappings survive unchanged, so every failure is
//        delivered in the exact shape the real SDK uses - the shape decides
//        which funnel the edge reaches:
//          callback forms       -> cb(err) as the FIRST argument, with a real
//                                  Error carrying `name`, `code`, `statusCode`
//                                  and `retryable`.
//          request-object form  -> an 'error' event on the Readable returned by
//                                  createReadStream(), by the same
//                                  `stream.emit('error', err)` mechanism
//                                  aws-sdk/lib/request.js uses.
//          missing parameters   -> code 'MissingRequiredParameter' with
//                                  statusCode undefined, measured from the real
//                                  SDK (see BASELINE RECORD).
//   R-f  Baseline observed behaviour is the tie-breaker. ONE implementation is
//        loaded into BOTH worktrees, so any difference the corpus reports is
//        the application's and never the harness's. There is no branch
//        anywhere in this file on which tree it is running, on NODE_ENV, or on
//        any application version. Everything the real SDK does that is not
//        self-evident was MEASURED and is recorded under BASELINE RECORD below
//        rather than assumed.
//   BOUNDARIES & PRESERVATION, data and file formats (AAP 0.6.7). The S3 Key is
//        the sha1 hex digest of the file's CONTENTS, so any change to the
//        digest silently orphans every stored object - no error, only files
//        that cannot be found. Keys are therefore preserved BYTE-EXACTLY: the
//        exact bucket and key are recorded in a sidecar and returned verbatim
//        by list()/objects(), never reconstructed from the on-disk filename.
//        prepopulate() and PARITY_S3_SEED exist so representative
//        pre-migration objects are present before the application runs, which
//        is what makes a changed digest surface as a NoSuchKey LOOKUP FAILURE
//        instead of quietly passing on freshly written data.
//   AAP 0.8  Zero-warning bar. test/parity/server.js runs the whole exercise
//        under --pending-deprecation --trace-deprecation with stderr captured
//        for the gate, so this code sits inside the measured stream. No
//        `url.parse` (DEP0169), no `new Buffer` (DEP0005 - Buffer.from and
//        Buffer.alloc only), no deprecated fs, stream or crypto form, and NO
//        console output of any kind on any path: evidence goes to
//        PARITY_S3_LOG. The application's own `console.log(err)` at
//        lib/util/file.js:49 is application output and is left alone.
//   AAP 0.9.3  Exact comparison. lib/controllers/users.js:1311 redirects to the
//        getSignedUrl return value and replay.js compares Location EXACTLY, so
//        the signed URL is derived only from the operation, Bucket, Key and
//        Expires. No Date.now(), no random material, no real signature.
//
// Folder prohibitions, all absolute and all honoured: no network access on any
// code path; nothing from test/helpers/** or test/lib/** is required; no
// `url.parse`; no nondeterministic value in anything a response can expose; no
// application file, no config/*.yaml and nothing in the baseline worktree is
// edited; no reliance on headObject; and no CLI argument is read - every path
// arrives through a PARITY_* variable.
//
// Load-order safety (AAP 0.6.5 defect 2): `mongoose-schema-extend` replaces the
// global Object.getPrototypeOf and makes @hapi/hapi unloadable if it loads
// first. This module requires nothing from config/db, config/app.config,
// lib/models/**, lib/controllers/** or lib/util/file.js - only Node core plus
// the application's own config/aws, which pulls aws-sdk and config and nothing
// else. Measured: the full application initialises behind this preload and
// @hapi/inert loads successfully.
//
// ===========================================================================
// ENVIRONMENT CONTRACT - the authoritative list. These four variables are
// every variable this file reads, so test/parity/server.js can match it
// exactly. No unset, empty or malformed value causes a throw.
// ===========================================================================
//   PARITY_APP_ROOT  Absolute path of the worktree under test, used to resolve
//                    the application's own config/aws so that the patched
//                    namespace is the very module instance the application
//                    requires.
//                    FALLBACK: process.cwd(). The fallback is correct because
//                    test/parity/server.js spawns the application with the
//                    worktree under test as its working directory, while this
//                    file lives in the TARGET worktree - so __dirname would
//                    resolve the wrong tree's node_modules and is deliberately
//                    not used for resolution.
//   PARITY_S3_ROOT   Absolute path of the object-store root. UNSET selects a
//                    per-process directory under os.tmpdir() named
//                    'parity-s3-<pid>', exposed as `root` on the exported API
//                    and in status(). It is never printed. The path is not
//                    reachable from any response: lib/util/file.js returns
//                    `container.host` plus the object key, never a local path.
//                    A relative value is resolved against process.cwd().
//                    RE-READ ON EVERY STORE ACCESS, not once at load: the
//                    variable is resolved inside ensureRoot(), and when the
//                    value has changed the store is RE-BOUND to it - the
//                    previous and new roots are recorded as a
//                    'store-root-bound' entry in the call log, never as an
//                    error, because a re-point is legitimate. restore()
//                    UNBINDS the store, so a caller that runs two passes over
//                    one required copy of this module - set the variable,
//                    restore(), read - gets its OWN store per pass instead of
//                    the previous pass's objects. verifyRoot(expected) is the
//                    explicit assertion, and status().root always reports the
//                    live value.
//                    OWNERSHIP AND PERMISSIONS (SCR-F56). Whatever this file
//                    creates it creates owner-only: <root>/objects and
//                    <root>/meta are 0700, every object and sidecar is 0600,
//                    and each is chmod'ed as well as created that way because
//                    a mode is applied only at creation and is masked by the
//                    umask. The root ITSELF is tightened only when this file
//                    created it, because a harness that supplies this variable
//                    usually creates the directory first and a borrowed
//                    directory is not one to re-permission.
//                    Lifecycle follows the same line. When this variable is
//                    SET the store is the caller's artifact: it is retained
//                    untouched at exit, which is required rather than polite -
//                    test/parity/replay.js and test/parity/capture.js read the
//                    stored objects after the run to collect their evidence.
//                    When it is UNSET the per-process directory above is this
//                    file's own, and it is REMOVED on 'exit'. Ownership is
//                    recorded at the moment the directory is CREATED - derived
//                    rather than supplied, and created by this file's own mkdir
//                    - and every such directory is removed even if the variable
//                    was later set and the store re-bound. A path this file did
//                    not create is never removed, whatever its name looks like:
//                    the default name is only os.tmpdir() plus this pid, which
//                    another process can construct, and a recursive delete of
//                    someone else's directory is not a risk worth taking for a
//                    temporary-file tidy-up.
//   PARITY_S3_SEED   Optional absolute path of a JSON pre-population manifest,
//                    read ONCE at load. Required in practice: test/parity/seed.js
//                    seeds a File document whose hash, url and name correspond
//                    to a pre-migration object that must already exist INSIDE
//                    the server child process, and an environment variable is
//                    the only channel that reaches a preload. Direct requires
//                    use prepopulate() instead. A missing, unreadable,
//                    malformed or partly invalid manifest is recorded on
//                    errors() and never thrown.
//   PARITY_S3_LOG    Optional evidence file, and a strict no-op when unset.
//                    When set, one JSON record per intercepted call is
//                    APPENDED synchronously - operation, Bucket, Key, the
//                    relevant metadata and the outcome, with NO timestamp and
//                    never a body. Appending per call rather than only on
//                    flush() is deliberate: a missing key in the request-object
//                    form deliberately emits an 'error' the application does
//                    not handle, and evidence buffered in memory would be lost
//                    exactly where it is most needed. Every write is guarded,
//                    so a logging fault can never propagate into the
//                    application. The file is created 0600 and chmod'ed once to
//                    0600 (SCR-F56): it names every bucket and key a run
//                    touched, and it is a retained artifact whose path the
//                    harness owns, so it is tightened and never removed. A
//                    chmod failure here is recorded straight onto errors()
//                    rather than through the log, which would recurse.
//
// ===========================================================================
// SEED MANIFEST SCHEMA - deliberately minimal. The manifest is a JSON ARRAY of
// objects, each with EXACTLY one body source:
//
//   {"bucket": "<name>", "key": "<key>", "contentType": "<mime>",
//    "bytesBase64": "<base64>"}
//   {"bucket": "<name>", "key": "<key>", "contentType": "<mime>",
//    "file": "/absolute/path/whose/contents/are/copied"}
//
// `bucket` and `key` are required non-empty strings and are stored BYTE-EXACTLY.
// `contentType` is optional. `contentDisposition` is optional and accepted for
// symmetry with the export upload, which is the only site that supplies one.
// Exactly one of `bytesBase64` or `file` must be present.
//
// `bytesBase64` must be CANONICAL base64 - the exact string
// Buffer#toString('base64') produces for the bytes it decodes to. ASCII
// whitespace is stripped first and is therefore allowed anywhere; after that
// the value must use only the standard alphabet (so base64url is rejected),
// carry at most two '=' and only as trailing padding, have a length that is a
// multiple of four, and RE-ENCODE to itself. A charset test alone is not
// enough: Buffer.from never fails, so 'A', 'a=', 'QQ=', 'Zm9v=' and 'Zm9='
// each decode to something OTHER than the value they appear to name, and
// because the S3 Key is the sha1 digest of the contents (AAP 0.6.7) that is a
// silently different key rather than an error. The empty string is legal and
// seeds a zero-byte object. The load record for each entry carries the sha1
// digest of the bytes actually stored, so a report of "loaded" states which
// bytes were loaded.
//
// Any other key, a non-array manifest, a non-absolute `file`, an unreadable
// `file` or a non-canonical `bytesBase64` REJECTS THAT ENTRY: the reason names
// the rule that failed, is recorded on errors() and the remaining entries are
// still loaded. Nothing here throws, because this runs at preload time and a
// throwing preload takes the server down before app.js loads.
// ===========================================================================
//
// ===========================================================================
// STORE LAYOUT AND KEY ENCODING
// ===========================================================================
// Objects are addressed by bucket + key. Keys contain '/' - for example
// 'exports/<userId>/trinket-export-<hash>.zip' - so they are deliberately NOT
// mapped onto nested directories. Each object becomes ONE flat filename:
//
//   flat = encodeURIComponent(bucket) + '#' + encodeURIComponent(key)
//
//   <root>/objects/<flat>        the exact bytes
//   <root>/meta/<flat>.json      the sidecar: bucket, key, contentType,
//                                contentDisposition, etag, size
//
// encodeURIComponent encodes '/' as %2F, so no separator survives into the
// filename: every object is a single path component under <root>/objects and
// path traversal is impossible. '#' is the joiner because encodeURIComponent
// encodes it too, so it cannot appear inside either encoded part and the split
// is unambiguous. The flat name is an implementation detail of the store: the
// AUTHORITATIVE bucket and key live in the sidecar and are what list(),
// objects() and get() return, so a key is never reconstructed by decoding a
// filename. Data and metadata live in separate directories so that an object
// whose key literally ends in '.json' cannot collide with another object's
// sidecar.
//
// Length guard: a flat name longer than 180 characters is replaced by its
// first 140 characters plus '#' plus the sha1 of the full flat name, which is
// 181 characters and therefore cannot collide with any un-truncated name (all
// of which are 180 or shorter). The sidecar still carries the exact key, so
// assertions are unaffected. This exists only so that a long seeded key cannot
// produce ENAMETOOLONG; no application key comes close.
//
// ===========================================================================
// SIGNED URL FORMULA - deterministic, and identical in both worktrees
// ===========================================================================
//   signature = sha256hex(operation + '\n' + bucket + '\n' + key + '\n' +
//                         expires)
//   key path  = key.split('/').map(encodeURIComponent).join('/')
//
//   DNS-compatible bucket:
//     https://<bucket>.s3.parity.invalid/<key path>?Expires=<expires>&Signature=<signature>
//   otherwise (mirroring the SDK's own virtual-hosted / path-style choice):
//     https://s3.parity.invalid/<encodeURIComponent(bucket)>/<key path>?Expires=<expires>&Signature=<signature>
//
// `Expires` carries the RELATIVE seconds value the caller passed - 3600 at
// lib/controllers/users.js:1301 - and NOT the absolute epoch the real SDK
// emits, which is the whole point: an absolute epoch moves every run. Expires
// defaults to 900 when absent or unusable, which is the SDK's own default. The
// '.invalid' TLD is reserved by RFC 2606 and cannot resolve, so a followed
// redirect still reaches no network. The same formula is exported as
// signedUrlFor(bucket, key, expires) so storage.js and worker.js assert
// against this function rather than duplicating the format; it fixes the
// operation to 'getObject', which is the only operation any call site uses.
//
// ===========================================================================
// BASELINE RECORD (R-f) - measured on this host with Node v22.23.2 and the
// repository's own aws-sdk 2.1693.0. Each line is a result, not an
// expectation.
// ===========================================================================
// Namespace shape:
//   Object.getOwnPropertyDescriptor(AWS,'S3') is
//   {value, writable:true, enumerable:true, configurable:true}, so plain
//   assignment installs and restores cleanly.
//   AWS.S3.prototype.putObject, .getObject, .deleteObject and .headObject are
//   ALL undefined - aws-sdk v2 defines service operations lazily - while
//   .getSignedUrl exists. Patching the prototype would therefore silently
//   cover one of the five forms, which is why the CONSTRUCTOR is replaced.
// Parameter validation:
//   putObject({Key,Body}) with no Bucket -> cb(err) with
//   name === code === 'MissingRequiredParameter', statusCode undefined,
//   message "Missing required key 'Bucket' in params". deleteObject({Bucket})
//   with no Key gives the same code. Reproduced exactly.
// getSignedUrl:
//   Does NOT validate and does NOT throw. With the repository's committed
//   EMPTY credentials it returns the constant 'https://s3.amazonaws.com/' for
//   every input. With credentials supplied it returns
//   https://<bucket>.s3.amazonaws.com/<per-segment-encoded key>
//     ?AWSAccessKeyId=..&Expires=<ABSOLUTE epoch>&Signature=..
//   so both the real Expires and the real Signature are nondeterministic.
//   This fixture therefore neither validates nor throws either, and its URL
//   is deterministic by construction.
// createReadStream:
//   aws-sdk/lib/request.js builds `new streams.PassThrough()`, calls
//   `stream.end()` on success and delivers every failure as
//   `stream.emit('error', err)`. For a non-2xx the `statusCode < 300` branch
//   never runs, so the SDK attaches NO 'error' listener to that stream.
//   Reproduced with the same base class and the same mechanism.
// Node 22 pipe semantics:
//   Readable.prototype.pipe attaches its 'error' listener to the DESTINATION,
//   not the source. Measured: src.pipe(dest) followed by src.emit('error', e)
//   leaves dest with neither 'end' nor 'error' - un-ended and un-destroyed -
//   and, when nothing listens on src, raises an unhandled 'error' event.
//   app.js installs no uncaughtException handler. Both halves of that are the
//   real SDK's behaviour against this application's code and are reproduced
//   rather than repaired (R-d ruling 2).
// Preload safety:
//   `node --require <this file> app.js` initialises the full application,
//   @hapi/inert loads, and `new (require('./config/aws')).S3()` inside the
//   application's own module instance is this fixture's client.
//
// ===========================================================================
// NOTES OWED TO docs/baseline-parity.md (owned elsewhere - this file emits the
// notes and edits no documentation)
// ===========================================================================
//   1. getSignedUrl is stubbed DETERMINISTICALLY, by the formula above. The
//      alternative - keeping a real presigned URL and adding X-Amz-Date and
//      X-Amz-Signature to replay.js's volatile set - was REJECTED: Location is
//      compared exactly, normalizing a whole URL would also hide the Bucket
//      and Key the controller passed, and the measurement above shows the real
//      value under committed configuration is the information-free constant
//      'https://s3.amazonaws.com/'. The deterministic URL is identical in both
//      worktrees and additionally proves which Bucket and Key reached the SDK.
//   2. headObject is never called: a scan of lib/ and config/ returns no
//      occurrence, which is now measurable rather than asserted -
//      measureSurface() reports it as declaredWithoutSite and surface() would
//      list it in stubsInvoked if a run ever reached it. AAP 0.9.3 names it
//      among the methods to replace and omits getSignedUrl; AWS_SURFACE and
//      the two functions in this file are authoritative for the real surface.
//      A defensive stub is provided so that a future caller fails visibly and
//      is recorded, and nothing in the harness relies on it.
//      docs/baseline-parity.md:291 still carries the same wrong list -
//      headObject present, getSignedUrl absent - and correcting that document
//      is owed to the unit that owns it. This fixture emits the measurement
//      and edits no documentation.
//   3. A missing key in the request-object form leaves the application's
//      PassThrough un-ended AND raises an unhandled 'error' event, because the
//      application attaches no handler and Node's pipe attaches none to the
//      source. That is the real SDK's behaviour, preserved deliberately; a
//      harness case that drives it must expect the process-level signature
//      rather than a response.
//   4. test/parity/replay.js:4986 and test/parity/capture.js:4228 ASSIGN
//      PARITY_S3_ROOT in their own process before requiring this module and do
//      not put the previous value back afterwards, so a later reader in that
//      process inherits whichever pass wrote last. This file now re-reads the
//      variable on every store access and re-binds when it changes, which is
//      what makes each pass read its own store without those callers changing
//      (TST-73); restoring the variable they overwrote is still owed to those
//      two files, which this fixture does not own and does not edit.
//
// ===========================================================================
// PUBLIC API (consumed by test/parity/server.js, storage.js and worker.js)
// ===========================================================================
//   install()                     idempotent; returns status()
//   restore()                     puts the genuine AWS.S3 back AND unbinds the
//                                 store; returns status()
//   status()                      what is patched, the LIVE root, the seed
//                                 result and any diagnostic
//   verifyRoot(expected)          rebinds, then {root, expected, ok} - the
//                                 explicit per-pass root assertion
//   reset()                       clears stored objects and the call log,
//                                 without reinstalling
//   put(bucket, key, body, opts)  store directly; returns the sidecar record
//   get(bucket, key)              {bucket, key, body:Buffer, contentType,
//                                 contentDisposition, etag, size} or null
//   has(bucket, key)              boolean
//   list(bucket)                  exact keys for one bucket, sorted
//   objects()                     every sidecar record, sorted by bucket+key
//   prepopulate(manifest)         the programmatic PARITY_S3_SEED
//   calls()                       a copy of the recorded call log
//   errors()                      a copy of the recorded fixture errors
//   flush()                       rewrite PARITY_S3_LOG from memory
//   signedUrlFor(bucket, key, expires)
//   AWS_SURFACE                   the declared AWS surface, frozen: one entry
//                                 per {method, form, module, role}
//   surface()                     what this run reached: {declared, observed,
//                                 stubsInvoked, undeclared}
//   measureSurface(options)       scans lib/**/*.js and config/*.js for the
//                                 real call sites and reports the drift
//                                 against AWS_SURFACE: {ok, sites, drift,
//                                 declaredWithoutSite}. Never runs at load,
//                                 never throws, writes nothing
//   root                          the currently bound store root, or null
//   client()                      a fixture S3 client, for a direct require
//                                 that does not want to go through the
//                                 namespace
//   ParityS3                      the constructor installed onto AWS.S3
//   fixedLastModified             the frozen LastModified value
// ===========================================================================

'use strict';

var fs     = require('fs');
var os     = require('os');
var path   = require('path');
var crypto = require('crypto');

// The core PassThrough, deliberately: aws-sdk's own createReadStream returns
// `new streams.PassThrough()` from this very module, so building the
// request-object form on the same class removes a whole class of difference
// that would otherwise belong to the harness rather than to the application
// (R-f).
var PassThrough = require('stream').PassThrough;

// ---------------------------------------------------------------------------
// Frozen constants. Everything a response can expose is a literal or is
// derived only from the caller's own arguments and the stored bytes, because
// replay.js compares exactly (AAP 0.9.3).
// ---------------------------------------------------------------------------

// Stamped onto the installed constructor and onto every client and request
// object, so an already-installed fixture is recognisable without inspecting
// aws-sdk internals and so a harness can assert it is talking to the fixture.
var FIXTURE_MARKER = 'test/parity/fixtures/aws.js';

// ---------------------------------------------------------------------------
// The AWS surface, as DATA (BE-36).
//
// This is the authoritative inventory of the client methods this fixture has
// to answer, and it exists as a frozen constant rather than only as prose
// because a hand-written list is a list nothing can check: the fixture's own
// header carried the corrected seven-site inventory while
// docs/baseline-parity.md carried the wrong one, and neither could be verified
// against the tree. Two functions close that gap - surface() reports what was
// actually REACHED at run time from the call log, and measureSurface() scans
// lib/ and config/ for the call sites and reports the drift between what is
// declared here and what is really there. A documentation generator or a
// reviewer runs measureSurface() to produce the list rather than transcribing
// one.
//
// Deliberately NO line numbers: a line number recorded here is stale the
// moment a controller or the worker is edited, and measureSurface() resolves
// the lines at run time anyway. `module` is the file that carries the call, and
// null means the method has no call site at all.
//
//   method  the client method the application calls.
//   form    how it is called, which decides how a failure is delivered (R-e):
//           'callback'       -> cb(err) as the first argument.
//           'request-object' -> no callback; createReadStream() is called on
//                               the returned request and the failure arrives
//                               as an 'error' event on that stream.
//           'synchronous'    -> returns its value directly and neither
//                               validates nor throws.
//   module  the application file that carries the call site, or null.
//   role    what the call does, so a reader knows which behaviour a change
//           would break.
// ---------------------------------------------------------------------------
var AWS_SURFACE = Object.freeze([
  Object.freeze({
    method : 'putObject',
    form   : 'callback',
    module : 'lib/util/file.js',
    role   : 'upload: material, snapshot and user-asset writes, keyed on the ' +
             'sha1 digest of the contents'
  }),
  Object.freeze({
    method : 'putObject',
    form   : 'callback',
    module : 'lib/workers/exports.js',
    role   : 'upload: the export archive, under exports/<userId>/<filename>'
  }),
  Object.freeze({
    method : 'getObject',
    form   : 'callback',
    module : 'lib/util/file.js',
    role   : 'download: the user asset, resolved to data.Body as a Buffer'
  }),
  Object.freeze({
    method : 'getObject',
    form   : 'callback',
    module : 'lib/workers/exports.js',
    role   : 'download: an asset appended into the export archive'
  }),
  Object.freeze({
    method : 'getObject',
    form   : 'request-object',
    module : 'lib/util/file.js',
    role   : 'download: the material file, piped from createReadStream() into ' +
             'a PassThrough the route returns'
  }),
  Object.freeze({
    method : 'deleteObject',
    form   : 'callback',
    module : 'lib/util/file.js',
    role   : 'delete: removeFile, whose Key is the basename of a stored URL'
  }),
  Object.freeze({
    method : 'getSignedUrl',
    form   : 'synchronous',
    module : 'lib/controllers/users.js',
    role   : 'presign: the export download redirect, whose value reaches an ' +
             'exactly-compared Location header'
  }),
  Object.freeze({
    method : 'headObject',
    form   : 'callback',
    module : null,
    role   : 'defensive-stub'
  })
]);

// Operations that appear in the call log but are NOT client methods, and are
// therefore not surface drift: 'seed' is the store's own pre-population
// record, 'createReadStream' is the chained call the request-object form of
// getObject records separately so the stream's outcome is visible, and
// 'store-root-bound' is a store rebind.
var NON_METHOD_OPERATIONS = ['seed', 'createReadStream', 'store-root-bound'];

// Store layout. Data and metadata are separate directories so that an object
// whose key ends in '.json' cannot collide with another object's sidecar.
var OBJECTS_DIR = 'objects';
var META_DIR    = 'meta';

// Flat-name construction. See STORE LAYOUT AND KEY ENCODING in the header for
// the collision and traversal argument that these three values carry.
var NAME_SEPARATOR   = '#';
var MAX_FLAT_NAME    = 180;
var TRUNCATED_PREFIX = 140;

// Owner-only permissions for everything this file creates (SCR-F56). The store
// holds uploaded material, avatars, snapshots and export archives seeded from
// fixtures, and the call log names every bucket and key a run touched; both are
// tool-owned state that no other user on the host has any reason to read, and
// both were previously left at whatever the ambient umask produced - 0755 for
// the directories and 0644 for the files.
//
// A mode passed to mkdir or to a write applies only when the entry is CREATED
// and is further masked by the process umask, so each is followed by one
// explicit chmod of the entries this file owns. That is not belt-and-braces: a
// harness that created the store root first, a root reused from an earlier run,
// or a run under a permissive umask each produce exactly the ambient mode the
// finding reports.
var STORE_DIR_MODE  = 0o700;
var STORE_FILE_MODE = 0o600;

// The name of the store root this file derives for itself when PARITY_S3_ROOT
// is unset. It is a per-process directory under os.tmpdir(), and it is the ONE
// path this file owns rather than borrows - which is what decides, at exit,
// what may be removed and what must be left alone.
var DEFAULT_ROOT_PREFIX = 'parity-s3-';

// A fixed LastModified. No call site reads it - lib/util/file.js:209 takes
// data.Body and lib/workers/exports.js:66 takes data.Body - but the real SDK
// always returns one, so the field is present and frozen rather than moving or
// missing. Held as a string and handed out as a fresh Date, so a consumer that
// mutates it cannot corrupt the constant.
var FIXED_LAST_MODIFIED = '2013-01-01T00:00:00.000Z';

// The real SDK decorates every service error with a requestId and a `time`.
// Both are present for shape fidelity and both are frozen: lib/util/file.js:49
// prints the error object with console.log, so a moving value there would put
// a nondeterministic line into captured application output.
var FIXED_REQUEST_ID = 'PARITYFIXTUREREQ01';

// Signed-URL construction. The '.invalid' TLD is reserved by RFC 2606 and
// cannot resolve, which keeps "no network access on any code path" true even
// if a client follows the redirect.
var SIGNED_URL_HOST_SUFFIX = '.s3.parity.invalid';
var SIGNED_URL_PATH_HOST   = 'https://s3.parity.invalid';
var SIGNED_URL_SCHEME      = 'https://';

// The SDK's own default when a presign call omits Expires.
var DEFAULT_SIGNED_EXPIRES = 900;

// The only operation any call site presigns, and therefore the operation
// signedUrlFor() fixes so that storage.js and worker.js assert against this
// module rather than duplicating the format.
var SIGNED_URL_DEFAULT_OPERATION = 'getObject';

// The complete set of keys a seed manifest entry may carry. Anything else
// rejects the entry, because a silently ignored key is how a seeded object
// ends up absent while the manifest looks correct.
var SEED_ENTRY_KEYS = ['bucket', 'key', 'contentType', 'contentDisposition', 'bytesBase64', 'file'];

// The base64 alphabet, WITHOUT padding. Applied to a value whose ASCII
// whitespace has already been stripped, so '-' and '_' (base64url) and an
// interior '=' are rejected by it rather than silently re-interpreted.
var BASE64_ALPHABET_PATTERN = /^[A-Za-z0-9+/]*$/;

// ASCII whitespace, which the manifest schema documents as allowed inside a
// `bytesBase64` value and which is therefore stripped before any other rule is
// applied. Deliberately the ASCII set and not \s: \s also matches U+00A0 and
// the Unicode space separators, and a non-breaking space in a manifest is a
// typo that must be reported, not absorbed.
var BASE64_WHITESPACE_PATTERN = /[ \t\n\r\f\v]/g;

// AWS's own DNS-compatible bucket test, which is what decides virtual-hosted
// versus path-style addressing in the real SDK and therefore here too.
var DNS_BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
var IPV4_PATTERN       = /^\d+\.\d+\.\d+\.\d+$/;

// ---------------------------------------------------------------------------
// Module state. Held in one object so install()/restore() are idempotent and
// so a second require() of this file - which returns the same cached exports -
// cannot double-patch anything or lose the saved original.
// ---------------------------------------------------------------------------
var state = {
  installed  : false,
  awsModule  : null,   // the AWS namespace whose S3 was swapped
  awsPath    : null,   // the resolved path of config/aws, for status()
  originalS3 : null,   // the genuine AWS.S3, for restore()
  root       : null,   // the currently bound store root, null when unbound
  rootReady  : false,  // whether <root>/objects and <root>/meta exist

  // The last root this process bound, retained ACROSS restore() so that a
  // rebind can be reported against the store it replaced. state.root is the
  // live binding and is cleared by restore(); this is history, and it is the
  // only reason a two-pass re-point is visible in the call log at all.
  lastBoundRoot : null,

  diagnostic : null,   // why install() could not patch, if it could not
  seed       : null,   // the result of the PARITY_S3_SEED load
  calls      : [],     // one entry per intercepted call
  errors     : [],     // fixture-level faults: never thrown, always reported

  // Permission and lifecycle bookkeeping (SCR-F56). `tightened` records the
  // mode this file has already applied to a path, so a chmod happens once per
  // path rather than once per write; `modeFaultReported` keeps a systematic
  // chmod failure to ONE error record; `exitCleanupInstalled` keeps the exit
  // hook to one registration whatever mix of preload and direct require
  // reached this module.
  tightened            : {},
  modeFaultReported    : false,
  logModeFaults        : {},
  exitCleanupInstalled : false,

  // Every store root this process DERIVED AND CREATED for itself, in order.
  // Append-only, and untouched by restore() and by every rebind: it is the
  // proof of ownership the exit cleanup removes against, so a process that
  // created its own root and was then re-pointed at a caller's still cleans up
  // the one it made, and a directory this file did not create is never removed
  // however its name looks. See rememberCreatedRoot().
  createdRoots         : []
};

// ---------------------------------------------------------------------------
// Evidence log. Nothing here may ever throw into the application and nothing
// here may emit to stdout or stderr: the zero-warning gate captures both
// streams for the whole run (AAP 0.8).
// ---------------------------------------------------------------------------

// Tightens PARITY_S3_LOG to an owner-only mode (SCR-F56). Keyed by path, like
// tighten(), because the variable is read on every write and a harness that
// re-points it mid-process has a second file to tighten.
//
// Separate from tighten() for one reason: a failure here is recorded straight
// into state.errors and NOT through fail(), because fail() calls record(),
// record() appends to the very file whose permissions are in question, and a
// destination that cannot be chmod'ed is frequently one that cannot be written
// either - so routing it through the log would recurse.
//
// Marked on SUCCESS only, so a transient failure is retried on the next append
// rather than abandoning a retained artifact at the ambient 0644; the REPORT is
// what is deduplicated, once per path, so a permanently failing chmod cannot
// fill the error list.
function tightenLog(target) {
  if (state.tightened[target] === STORE_FILE_MODE) {
    return true;
  }

  try {
    fs.chmodSync(target, STORE_FILE_MODE);
    state.tightened[target] = STORE_FILE_MODE;
    return true;
  }
  catch (e) {
    if (!state.logModeFaults[target]) {
      state.logModeFaults[target] = true;
      state.errors.push({
        event : 'log-mode-not-tightened',
        detail: {
          path  : target,
          mode  : '0' + STORE_FILE_MODE.toString(8),
          error : e && e.message ? e.message : String(e)
        }
      });
    }
    return false;
  }
}

// Appends one record and, when PARITY_S3_LOG is set, writes it through
// immediately. Writing per call rather than only on flush() is deliberate: the
// missing-key request-object form emits an 'error' the application does not
// handle, so evidence buffered in memory would be lost exactly where it is
// most needed.
function record(entry) {
  state.calls.push(entry);

  var target = process.env.PARITY_S3_LOG;
  if (!target) {
    return entry;                              // strict no-op when unset
  }

  try {
    // Owner-only (SCR-F56). The log names every bucket and key a run touched,
    // and it is a retained artifact, so its mode is part of how the evidence is
    // handled rather than an incidental of the umask. tightenLog() covers the
    // case where the harness created the file first.
    fs.appendFileSync(target, JSON.stringify(entry) + '\n', { mode: STORE_FILE_MODE });
    tightenLog(target);
  }
  catch (e) {
    // A logging fault is not the application's problem. It is retained in
    // memory and surfaced by errors(), which is where a harness looks. The
    // directory is deliberately NOT created here: the harness owns the log
    // path, and a blind recursive mkdir is not a safe operation to run from
    // inside a request.
    state.errors.push({
      event : 'log-write-failed',
      detail: e && e.message ? e.message : String(e)
    });
  }

  return entry;
}

// Records something about the fixture itself rather than about an intercepted
// call - an unusable store root, a rejected seed entry, a namespace that could
// not be patched. Same guarantees, same destination, and additionally retained
// on errors() so a harness can assert the fixture was healthy.
function fail(event, detail) {
  var entry = { event: event, detail: detail === undefined ? null : detail };
  state.errors.push(entry);
  record(entry);
  return entry;
}

// Rewrites PARITY_S3_LOG with the complete set of records held in memory.
// Exposed for a harness that wants one self-contained artifact rather than the
// append stream; a strict no-op when the variable is unset, and it never
// throws. Returns the path written, or null.
function flush() {
  var target = process.env.PARITY_S3_LOG;
  if (!target) {
    return null;
  }

  try {
    var lines = state.calls.map(function(entry) {
      return JSON.stringify(entry);
    });
    fs.writeFileSync(target, lines.length ? lines.join('\n') + '\n' : '',
      { mode: STORE_FILE_MODE });
    tightenLog(target);
    return target;
  }
  catch (e) {
    state.errors.push({
      event : 'log-flush-failed',
      detail: e && e.message ? e.message : String(e)
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Callback timing. The real SDK never calls back in the caller's own tick, and
// code written against it relies on that: lib/util/file.js:48-52 registers its
// unlink inside the upload callback, and lib/workers/exports.js resolves a Q
// deferred from it. setImmediate rather than process.nextTick, because a
// nextTick callback still runs before any I/O the caller has queued.
// ---------------------------------------------------------------------------
function deliver(cb, err, data) {
  if (typeof cb !== 'function') {
    return undefined;
  }

  setImmediate(function() {
    cb(err, data);
  });

  return undefined;
}

// ---------------------------------------------------------------------------
// Errors, in the shapes the real SDK delivers them (R-e). `name` and `code`
// both carry the code, which is what the SDK does, and both `time` and
// `requestId` are frozen so that an error printed by the application is
// byte-stable.
// ---------------------------------------------------------------------------
function s3Error(code, message, statusCode) {
  var err = new Error(message);

  err.name       = code;
  err.code       = code;
  err.statusCode = statusCode;
  err.retryable  = false;
  err.time       = new Date(FIXED_LAST_MODIFIED);
  err.requestId  = FIXED_REQUEST_ID;

  return err;
}

// GetObject and the read-stream form for an absent key. Message text is S3's.
function noSuchKeyError() {
  return s3Error('NoSuchKey', 'The specified key does not exist.', 404);
}

// HeadObject's absent-key code is 'NotFound', not 'NoSuchKey'. Preserved here
// even though nothing calls headObject, so the stub cannot teach a future
// caller the wrong shape.
function notFoundError() {
  return s3Error('NotFound', null, 404);
}

// Client-side parameter validation, measured from the real SDK: name and code
// are both 'MissingRequiredParameter' and statusCode is undefined.
function missingParameterError(name) {
  return s3Error(
    'MissingRequiredParameter',
    "Missing required key '" + name + "' in params",
    undefined
  );
}

// A store fault - an unusable root, an unreadable object file. Delivered as a
// service error rather than thrown, so it reaches the same funnel a real S3
// failure would and cannot crash the application from inside a callback.
function internalError(message) {
  return s3Error('InternalError', message, 500);
}

// A store fault - an unusable root, a directory that is not a directory, an
// unreadable object file. Delivered to the caller as a service error so it
// reaches the same funnel a real S3 failure would, recorded once in the call
// log as that call's outcome, and recorded again on errors() because "errors()
// is empty" is how a harness establishes that the fixture itself was healthy
// for a case. The two views are deliberately both present: the call log says
// which call failed, errors() says the fixture was not sound.
function storeFault(operation, params, verb, outcome, cause) {
  var err = internalError(
    'parity S3 store could not ' + verb + ' ' + params.Bucket + '/' + params.Key + ': ' +
    (cause && cause.message ? cause.message : String(cause))
  );

  record({
    operation : operation,
    bucket    : params.Bucket,
    key       : params.Key,
    outcome   : outcome,
    error     : err.message
  });

  fail('store-fault', {
    operation : operation,
    bucket    : params.Bucket,
    key       : params.Key,
    detail    : err.message
  });

  return err;
}

// Bucket and Key are required by every operation the store performs. An empty
// or non-string value is rejected here rather than stored under 'undefined',
// because a silently mis-stored object is the failure mode AAP 0.6.7 warns
// about: no error, only files that cannot be found.
function validateBucketKey(params) {
  if (typeof params.Bucket !== 'string' || params.Bucket === '') {
    return missingParameterError('Bucket');
  }
  if (typeof params.Key !== 'string' || params.Key === '') {
    return missingParameterError('Key');
  }
  return null;
}

// ---------------------------------------------------------------------------
// Store root.
// ---------------------------------------------------------------------------

// PARITY_S3_ROOT when set, otherwise a per-process directory under
// os.tmpdir(). Never printed, and never reachable from a response.
function resolveRoot() {
  var configured = process.env.PARITY_S3_ROOT;

  if (typeof configured === 'string' && configured.trim() !== '') {
    return path.resolve(configured.trim());
  }

  return defaultRoot();
}

// The root this file derives for itself, and therefore the only root it owns.
// Kept as its own function so that the exit hook can recompute it and compare
// rather than trusting a flag: a path is only ever removed when it is byte-
// identical to this value (SCR-F56).
function defaultRoot() {
  return path.join(os.tmpdir(), DEFAULT_ROOT_PREFIX + process.pid);
}

// Whether PARITY_S3_ROOT is currently supplying the root. When it is, the root
// is the caller's; when it is not, resolveRoot() derives the default and the
// root is a candidate for ownership - which is only settled by having CREATED
// it, in rememberCreatedRoot() below.
function environmentRootSet() {
  return typeof process.env.PARITY_S3_ROOT === 'string' &&
         process.env.PARITY_S3_ROOT.trim() !== '';
}

// Records that this process CREATED a root of its own, which is the only proof
// of ownership this file accepts (SCR-F56).
//
// Ownership is deliberately NOT inferred from the path's shape at exit. Two
// measured failures follow from inferring it:
//   * A process can derive its own default root, write into it, and later be
//     re-pointed at a caller-supplied root. state.root then names the caller's
//     directory, and a check against the LIVE root would leave the derived one
//     behind - so the list below is append-only and survives every rebind.
//   * A name-shaped check deletes a directory this file never created. The
//     default name contains only os.tmpdir() and this pid, both of which
//     another process can construct, and `rm -rf` on someone else's directory
//     is not a mistake worth risking for a temporary-file tidy-up.
// Both conditions are therefore required: the root came from the default rather
// than from the environment, AND the mkdir that follows created it.
function rememberCreatedRoot(target) {
  if (state.createdRoots.indexOf(target) === -1) {
    state.createdRoots.push(target);
  }

  return target;
}

// Tightens one directory or file to an owner-only mode, once per path per
// process. A mode given to mkdir or to a write is applied only at creation and
// is masked by the umask, so this is what actually holds SCR-F56's guarantee
// for a root a harness created, a store reused from an earlier run, or a
// permissive umask.
//
// A failure is recorded ONCE per bind through fail(), not once per file: it is
// a genuine fixture fault - the evidence is readable by other users - and
// test/parity/storage.js asserts errors() is empty, so it must be visible; but
// a systematic failure must not push one record per object and drown the list.
// Never throws.
function tighten(target, mode) {
  if (state.tightened[target] === mode) {
    return true;
  }

  try {
    fs.chmodSync(target, mode);
    state.tightened[target] = mode;
    return true;
  }
  catch (e) {
    if (!state.modeFaultReported) {
      state.modeFaultReported = true;
      fail('store-mode-not-tightened', {
        path  : target,
        mode  : '0' + mode.toString(8),
        error : e && e.message ? e.message : String(e)
      });
    }
    return false;
  }
}

// Points the store at a resolved root. Nothing else in this file assigns
// state.root, so this is the one place a store can change identity, and it
// keeps the exported `root` value in step with it.
//
// A rebind that REPLACES a previously bound, different root is recorded as
// evidence, because a store that changed identity mid-process is something a
// reader of the call log has to be able to see. It goes through record() and
// deliberately NOT through fail(): test/parity/storage.js:1896-1900 asserts
// errors() deep-equals [] for most of its cases, and a legitimate re-point -
// which is exactly what a two-pass caller performs - is not a fault. The
// first bind of the process records nothing: there is no previous store to
// report, and lastBoundRoot survives restore() precisely so that the pass
// boundary is still visible after an unbind.
function bindRoot(resolved) {
  var previous = state.lastBoundRoot;

  state.root          = resolved;
  state.rootReady     = false;
  state.lastBoundRoot = resolved;
  module.exports.root = resolved;

  if (previous !== null && previous !== resolved) {
    record({
      operation    : 'store-root-bound',
      previousRoot : previous,
      root         : resolved,
      outcome      : 'rebound'
    });
  }

  return resolved;
}

// Binds the store to whatever PARITY_S3_ROOT names NOW and creates
// <root>/objects and <root>/meta. Every store accessor calls this first, so it
// is the single choke point through which a root is resolved, and it re-reads
// the environment on every call rather than trusting a value cached at load.
//
// That re-read is the whole of the cross-pass guarantee (TST-73).
// test/parity/replay.js:4986 assigns PARITY_S3_ROOT the root of the pass it is
// collecting evidence for and then re-uses this already-required module, so a
// root resolved once at load would report the FIRST pass's objects as the
// SECOND pass's evidence - no error, just the wrong store. Rebinding here also
// means restore() can simply unbind, and the next store access picks up
// whatever the caller has pointed the variable at.
//
// The fast path - the root is unchanged and its directories exist - is one
// environment read and one string comparison, which is why this can sit in
// front of every read rather than only before a write. A root removed between
// operations is still recreated rather than turning into a cascade of ENOENT.
// Returns a boolean and never throws: at load time a throw would take the
// server down before app.js loads.
function ensureRoot() {
  var resolved = resolveRoot();
  var derived  = !environmentRootSet();
  var rootExisted;

  if (state.root === resolved && state.rootReady) {
    return true;
  }

  if (state.root !== resolved) {
    bindRoot(resolved);
  }

  // Whether the root already existed decides ownership of the root ITSELF
  // (SCR-F56): the two subdirectories below are always this file's, but the
  // root is frequently a directory a harness created - test/parity/server.js,
  // worker.js and storage.js each build one inside their own run directory -
  // and a borrowed directory is not one to re-permission or remove.
  rootExisted = directoryExists(state.root);

  try {
    fs.mkdirSync(path.join(state.root, OBJECTS_DIR), { recursive: true, mode: STORE_DIR_MODE });
    fs.mkdirSync(path.join(state.root, META_DIR), { recursive: true, mode: STORE_DIR_MODE });
    state.rootReady = true;
  }
  catch (e) {
    state.rootReady = false;
    fail('store-root-unavailable', {
      root  : state.root,
      error : e && e.message ? e.message : String(e)
    });
    return false;
  }

  if (!rootExisted) {
    tighten(state.root, STORE_DIR_MODE);

    // Created by this call, and derived rather than supplied, so it is this
    // file's to remove at exit - and that fact is recorded HERE, at the
    // creation point, because nothing observable later can establish it.
    if (derived) {
      rememberCreatedRoot(state.root);
    }
  }

  tighten(path.join(state.root, OBJECTS_DIR), STORE_DIR_MODE);
  tighten(path.join(state.root, META_DIR), STORE_DIR_MODE);

  installExitCleanup();

  return true;
}

// Whether a path is an existing directory. Used only to decide whether this
// file created the store root or borrowed it, so anything other than a
// directory - absent, a file, unreadable - answers "not there, and mine if the
// mkdir below succeeds". Never throws.
function directoryExists(target) {
  try {
    return fs.statSync(target).isDirectory();
  }
  catch (e) {
    return false;
  }
}

// Registers the exit-time removal of the store roots this file CREATED, and
// nothing else (SCR-F56). Registered once, from the first bind, so a process
// that only ever talks to a caller-supplied root registers a hook that decides
// to do nothing - which is cheaper and simpler than deciding whether to
// register.
//
// What is removed is decided by state.createdRoots, recorded at the moment each
// directory was created, and not by the live binding or by the shape of a path:
// a process can create its own root and later be re-pointed at a caller's, and
// a name-shaped test would both miss the first and risk deleting a directory
// another process happened to create under the same name.
//
// A caller-supplied root is never touched: it is the artifact the harness asked
// for, it frequently sits inside a run directory the harness also removes, and
// test/parity/replay.js and test/parity/capture.js READ it after the run to
// collect the stored-object evidence. Removing it would delete the evidence
// this fixture exists to produce.
//
// Only 'exit' is used, for the same reason test/parity/fixtures/mail.js gives:
// a signal listener would suppress Node's default termination and change the
// signal behaviour of the application this file is preloaded into, and
// test/parity/server.js owns graceful shutdown. Nothing here throws and nothing
// prints, because neither is permitted from an exit handler in a measured run.
function installExitCleanup() {
  if (state.exitCleanupInstalled) {
    return true;
  }

  state.exitCleanupInstalled = true;

  try {
    process.on('exit', function() {
      try {
        removeCreatedRoots();
      }
      catch (ignored) {
        // removeCreatedRoots() has no throwing path; this is the last layer,
        // and an exit handler is the one place where there is nothing left to
        // report to.
      }
    });

    return true;
  }
  catch (e) {
    state.exitCleanupInstalled = false;
    fail('exit-cleanup-not-installed', {
      error: e && e.message ? e.message : String(e)
    });
    return false;
  }
}

// Removes every store root this process created for itself. Returns the paths
// removed, which is an EMPTY list for every harness in test/parity - all of
// them supply PARITY_S3_ROOT, so nothing here is ever theirs to remove. Never
// throws, and never removes a path that is not in state.createdRoots.
function removeCreatedRoots() {
  var removed = [];

  state.createdRoots.forEach(function(target) {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
    }
    catch (e) {
      // Nothing to report to: this runs from the exit handler, where the log
      // and the error list are both already beyond anyone's reach.
    }
  });

  return removed;
}

// The explicit check a caller performs when it has an expectation about which
// store it is talking to - test/parity/worker.js:1123 and :2616 assert the
// root, and a two-pass caller has a per-pass value to hold this file to.
// Rebinds first, so the answer describes the store the NEXT operation will
// use, and normalizes `expected` exactly as resolveRoot() normalizes the
// environment value so that a trailing separator is not reported as a
// mismatch.
//
// A mismatch IS a fault and goes through fail(): the caller has asserted a
// root the store is not using, which means its evidence is about the wrong
// directory. Returns {root, expected, ok}; `expected` is null when the
// argument was not a usable path.
function verifyRoot(expected) {
  var bound  = ensureRoot();
  var wanted = typeof expected === 'string' && expected.trim() !== ''
    ? path.resolve(expected.trim())
    : null;
  var ok     = bound && wanted !== null && state.root === wanted;

  if (!ok) {
    fail('store-root-mismatch', {
      root      : state.root,
      expected  : wanted,
      rootReady : state.rootReady
    });
  }

  return { root: state.root, expected: wanted, ok: ok };
}

// ---------------------------------------------------------------------------
// Flat naming. The bucket and key are percent-encoded and joined with '#', so
// no '/' survives and every object is a single path component: traversal is
// impossible by construction rather than by sanitisation. The AUTHORITATIVE
// key lives in the sidecar - nothing here ever decodes a filename back into a
// key, so the byte-exactness AAP 0.6.7 requires does not depend on this
// encoding being reversible.
// ---------------------------------------------------------------------------
function flatName(bucket, key) {
  var encoded = encodeURIComponent(String(bucket)) +
                NAME_SEPARATOR +
                encodeURIComponent(String(key));

  if (encoded.length <= MAX_FLAT_NAME) {
    return encoded;
  }

  // 140 + 1 + 40 = 181 characters, which is longer than MAX_FLAT_NAME and
  // therefore cannot equal any un-truncated name.
  return encoded.slice(0, TRUNCATED_PREFIX) +
         NAME_SEPARATOR +
         crypto.createHash('sha1').update(encoded, 'utf8').digest('hex');
}

function objectPath(bucket, key) {
  return path.join(state.root, OBJECTS_DIR, flatName(bucket, key));
}

function metaPath(bucket, key) {
  return path.join(state.root, META_DIR, flatName(bucket, key) + '.json');
}

// A quoted md5 hex digest, which is what S3 returns for a single-part upload.
// Derived from the bytes, so it is deterministic without being invented.
function etagFor(body) {
  return '"' + crypto.createHash('md5').update(body).digest('hex') + '"';
}

// Normalizes an optional metadata string. `undefined` and `null` become null -
// "not supplied" - and everything else is stored verbatim, which is what keeps
// lib/util/file.js:28-30's extensionWhitelist override observable (R-d ruling
// 4). No default content type is invented.
function optionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Store operations. Synchronous internally - the store is a local directory
// and a deterministic harness benefits from ordering it can reason about -
// while every SDK-facing callback still fires through deliver().
// ---------------------------------------------------------------------------

// Writes the bytes and the sidecar, and returns the sidecar record. Throws
// only on a real filesystem fault, which every caller converts into an
// InternalError so nothing escapes as an exception.
function writeObject(bucket, key, body, options) {
  if (!ensureRoot()) {
    throw new Error('store root ' + state.root + ' is unavailable');
  }

  var meta = options && typeof options === 'object' ? options : {};
  var sidecar = {
    bucket             : String(bucket),
    key                : String(key),
    contentType        : optionalString(meta.contentType),
    contentDisposition : optionalString(meta.contentDisposition),
    etag               : etagFor(body),
    size               : body.length
  };

  // Owner-only, and tightened as well as created that way (SCR-F56): a write
  // applies `mode` only when it creates the file, so an object overwritten in a
  // store a harness reused would otherwise keep the 0644 the first run left.
  fs.writeFileSync(objectPath(bucket, key), body, { mode: STORE_FILE_MODE });
  fs.writeFileSync(metaPath(bucket, key), JSON.stringify(sidecar, null, 2) + '\n',
    { mode: STORE_FILE_MODE });

  tighten(objectPath(bucket, key), STORE_FILE_MODE);
  tighten(metaPath(bucket, key), STORE_FILE_MODE);

  return sidecar;
}

// Returns the stored object, or null when the key is absent. A sidecar that is
// missing or unreadable does not hide the object: the bytes still answer and
// the recoverable metadata is rebuilt from them, which matters because the
// bytes are the contract and the metadata is not.
function readObject(bucket, key) {
  if (!ensureRoot()) {
    return null;
  }

  var body;

  try {
    body = fs.readFileSync(objectPath(bucket, key));
  }
  catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
      return null;
    }
    throw e;
  }

  var sidecar = null;

  try {
    sidecar = JSON.parse(fs.readFileSync(metaPath(bucket, key), 'utf8'));
  }
  catch (e) {
    fail('sidecar-unreadable', {
      bucket : String(bucket),
      key    : String(key),
      error  : e && e.message ? e.message : String(e)
    });
  }

  return {
    bucket             : String(bucket),
    key                : String(key),
    body               : body,
    contentType        : sidecar ? optionalString(sidecar.contentType) : null,
    contentDisposition : sidecar ? optionalString(sidecar.contentDisposition) : null,
    etag               : sidecar && sidecar.etag ? sidecar.etag : etagFor(body),
    size               : body.length
  };
}

function hasObject(bucket, key) {
  if (!ensureRoot()) {
    return false;
  }

  try {
    fs.accessSync(objectPath(bucket, key), fs.constants.F_OK);
    return true;
  }
  catch (e) {
    return false;
  }
}

// Removes the bytes and the sidecar. Returns whether the object had been
// present, which the call log records; the SDK reports success either way.
function removeObject(bucket, key) {
  if (!ensureRoot()) {
    return false;
  }

  var existed = hasObject(bucket, key);

  [objectPath(bucket, key), metaPath(bucket, key)].forEach(function(target) {
    try {
      fs.unlinkSync(target);
    }
    catch (e) {
      if (!e || e.code !== 'ENOENT') {
        fail('object-unlink-failed', {
          bucket : String(bucket),
          key    : String(key),
          error  : e && e.message ? e.message : String(e)
        });
      }
    }
  });

  return existed;
}

// Every sidecar record, sorted by bucket then key so a listing is stable
// across runs and across filesystems. The keys come from the sidecars and are
// therefore byte-exact.
function allObjects() {
  if (!ensureRoot()) {
    return [];
  }

  var dir = path.join(state.root, META_DIR);
  var names;

  try {
    names = fs.readdirSync(dir);
  }
  catch (e) {
    if (!e || e.code !== 'ENOENT') {
      fail('meta-listing-failed', {
        directory : dir,
        error     : e && e.message ? e.message : String(e)
      });
    }
    return [];
  }

  var records = [];

  names.forEach(function(name) {
    if (name.slice(-5) !== '.json') {
      return;
    }

    try {
      var sidecar = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (sidecar && typeof sidecar.bucket === 'string' && typeof sidecar.key === 'string') {
        records.push(sidecar);
      }
    }
    catch (e) {
      fail('sidecar-unreadable', {
        file  : name,
        error : e && e.message ? e.message : String(e)
      });
    }
  });

  records.sort(function(a, b) {
    if (a.bucket !== b.bucket) {
      return a.bucket < b.bucket ? -1 : 1;
    }
    if (a.key === b.key) {
      return 0;
    }
    return a.key < b.key ? -1 : 1;
  });

  return records;
}

// Empties the store without removing the root, so a harness that set
// PARITY_S3_ROOT keeps the directory it chose. Only files INSIDE
// <root>/objects and <root>/meta are unlinked - never the root itself and
// never a directory - so a root that a harness shares with other artifacts
// cannot be destroyed from here.
function clearStore() {
  var cleared = 0;

  if (!ensureRoot()) {
    return cleared;
  }

  [OBJECTS_DIR, META_DIR].forEach(function(sub) {
    var dir = path.join(state.root, sub);
    var names;

    try {
      names = fs.readdirSync(dir);
    }
    catch (e) {
      if (!e || e.code !== 'ENOENT') {
        fail('store-clear-failed', {
          directory : dir,
          error     : e && e.message ? e.message : String(e)
        });
      }
      return;
    }

    names.forEach(function(name) {
      var target = path.join(dir, name);

      try {
        if (fs.statSync(target).isFile()) {
          fs.unlinkSync(target);
          cleared += 1;
        }
      }
      catch (e) {
        if (!e || e.code !== 'ENOENT') {
          fail('store-clear-failed', {
            file  : target,
            error : e && e.message ? e.message : String(e)
          });
        }
      }
    });
  });

  return cleared;
}


// ---------------------------------------------------------------------------
// Seed manifests. The schema is in the header; this is its only
// implementation, shared by PARITY_S3_SEED and prepopulate(). Nothing here
// throws: an invalid entry is rejected with its reason on errors() and the
// remaining entries are still loaded, because a preload that throws takes the
// server down before app.js loads.
// ---------------------------------------------------------------------------

// Decodes a `bytesBase64` value, accepting ONLY canonical base64 - the exact
// string Buffer#toString('base64') produces for the bytes it yields. Returns
// {ok:true, body:Buffer} or {ok:false, reason} naming the rule that failed.
//
// A charset test is not enough, which is what this replaced (API-F29,
// SCR-F12). Buffer.from(value, 'base64') never fails: it discards what it
// cannot use and stops where it cannot continue. Measured on Node v22.23.2,
// every one of these passed the previous charset pattern and every one seeds
// DIFFERENT bytes from the ones the manifest appears to name - 'A' yields 0
// bytes, 'a=' 0 bytes, 'QQ=' 1 byte, 'Zm9v=' the 3 bytes of 'foo' with the
// stray pad ignored, and 'Zm9=' the 2 bytes 'fo', whose own encoding is
// 'Zm8='. Because the S3 Key is the sha1 digest of the CONTENTS (AAP 0.6.7),
// different bytes are a different key, and a wrong key surfaces as nothing at
// all: no error, just an object no lookup ever finds. The manifest is
// therefore held to the encoding it claims to be, in this order:
//
//   1. ASCII whitespace is stripped, because the schema documents it as
//      allowed - a manifest may wrap a long value across lines.
//   2. At most two trailing '=' characters. Anything more, or any '=' that is
//      not in that trailing run, means two concatenated encodings or a
//      truncation rather than padding.
//   3. Every remaining character is in the standard alphabet, so base64url
//      ('-' and '_') is REJECTED instead of being decoded as something else.
//   4. The compact length is a multiple of four, which is what rejects 'A',
//      'a=', 'QQ=' and 'Zm9v='.
//   5. The decoded bytes RE-ENCODE to the same string, which is what rejects
//      'Zm9=' - the only rule that catches padding bits carrying values a
//      canonical encoder never emits.
//
// The empty string stays legal and yields a zero-byte body: it satisfies both
// the length and the round-trip rules, and a zero-byte object is a legitimate
// thing to seed.
function decodeCanonicalBase64(value) {
  if (typeof value !== 'string') {
    return { ok: false, reason: 'is not a string' };
  }

  var compact  = value.replace(BASE64_WHITESPACE_PATTERN, '');
  var padMatch = /=+$/.exec(compact);
  var padding  = padMatch ? padMatch[0].length : 0;
  var payload  = padding ? compact.slice(0, compact.length - padding) : compact;

  if (padding > 2) {
    return {
      ok     : false,
      reason : 'carries ' + padding + ' trailing padding characters, and ' +
               'canonical base64 carries at most two'
    };
  }

  if (!BASE64_ALPHABET_PATTERN.test(payload)) {
    return {
      ok     : false,
      reason : 'contains a character outside the base64 alphabet ' +
               '(A-Z, a-z, 0-9, + and /) or an "=" that is not trailing ' +
               'padding, so it is not the encoding it claims to be'
    };
  }

  if (compact.length % 4 !== 0) {
    return {
      ok     : false,
      reason : 'is ' + compact.length + ' characters long, which is not a ' +
               'multiple of four, so Buffer.from would drop the remainder ' +
               'and seed fewer bytes than the value names'
    };
  }

  var decoded   = Buffer.from(compact, 'base64');
  var canonical = decoded.toString('base64');

  if (canonical !== compact) {
    return {
      ok     : false,
      reason : 'is not canonical: it decodes to ' + decoded.length +
               ' bytes which re-encode as ' +
               (canonical.length > 32
                 ? '"' + canonical.slice(0, 32) + '..." (' + canonical.length + ' characters)'
                 : '"' + canonical + '"') +
               ' rather than as the value supplied'
    };
  }

  return { ok: true, body: decoded };
}

// Validates one entry and resolves its body. Returns
// {ok:true, bucket, key, body, contentType, contentDisposition} or
// {ok:false, reason}.
function normalizeSeedEntry(entry, index) {
  var where = 'entry ' + index;

  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { ok: false, reason: where + ' is not an object' };
  }

  var unknown = Object.keys(entry).filter(function(key) {
    return SEED_ENTRY_KEYS.indexOf(key) === -1;
  });

  if (unknown.length) {
    // Rejected rather than ignored: a silently dropped key is how a seeded
    // object ends up absent while the manifest still looks correct.
    return { ok: false, reason: where + ' carries unknown keys: ' + unknown.join(', ') };
  }

  if (typeof entry.bucket !== 'string' || entry.bucket === '') {
    return { ok: false, reason: where + ' requires a non-empty string `bucket`' };
  }

  if (typeof entry.key !== 'string' || entry.key === '') {
    return { ok: false, reason: where + ' requires a non-empty string `key`' };
  }

  var hasBytes = Object.prototype.hasOwnProperty.call(entry, 'bytesBase64');
  var hasFile  = Object.prototype.hasOwnProperty.call(entry, 'file');

  if (hasBytes === hasFile) {
    return {
      ok     : false,
      reason : where + ' requires exactly one of `bytesBase64` or `file`'
    };
  }

  if (entry.contentType !== undefined && typeof entry.contentType !== 'string') {
    return { ok: false, reason: where + ' has a non-string `contentType`' };
  }

  if (entry.contentDisposition !== undefined && typeof entry.contentDisposition !== 'string') {
    return { ok: false, reason: where + ' has a non-string `contentDisposition`' };
  }

  var body;

  if (hasBytes) {
    if (typeof entry.bytesBase64 !== 'string') {
      return { ok: false, reason: where + ' has a non-string `bytesBase64`' };
    }

    // The decode is the validation: a value Buffer.from would silently
    // normalize seeds the wrong bytes and therefore the wrong content digest,
    // which is the one failure AAP 0.6.7 says surfaces as nothing but a lookup
    // miss. The reason names the rule that failed, because this string is what
    // lands on errors() and in the evidence log.
    var decoded = decodeCanonicalBase64(entry.bytesBase64);

    if (!decoded.ok) {
      return { ok: false, reason: where + ' has a `bytesBase64` that ' + decoded.reason };
    }

    body = decoded.body;
  }
  else {
    if (typeof entry.file !== 'string' || entry.file === '') {
      return { ok: false, reason: where + ' requires a non-empty string `file`' };
    }
    if (!path.isAbsolute(entry.file)) {
      return { ok: false, reason: where + ' requires an absolute `file` path' };
    }
    try {
      body = fs.readFileSync(entry.file);
    }
    catch (e) {
      return {
        ok     : false,
        reason : where + ' could not read `file` ' + entry.file + ': ' +
                 (e && e.message ? e.message : String(e))
      };
    }
  }

  return {
    ok                 : true,
    bucket             : entry.bucket,
    key                : entry.key,
    body               : body,
    contentType        : entry.contentType,
    contentDisposition : entry.contentDisposition
  };
}

// Loads a manifest. Returns {loaded, rejected, errors:[...]} and records every
// rejection on errors() as well, so a harness sees the same reasons whether it
// inspects the return value or the fixture's error list.
function prepopulate(manifest) {
  var summary = { loaded: 0, rejected: 0, errors: [] };

  if (!Array.isArray(manifest)) {
    summary.rejected = 1;
    summary.errors.push('manifest is not an array');
    fail('seed-manifest-invalid', 'manifest is not an array');
    return summary;
  }

  manifest.forEach(function(entry, index) {
    var normalized = normalizeSeedEntry(entry, index);

    if (!normalized.ok) {
      summary.rejected += 1;
      summary.errors.push(normalized.reason);
      fail('seed-entry-rejected', normalized.reason);
      return;
    }

    try {
      writeObject(normalized.bucket, normalized.key, normalized.body, {
        contentType        : normalized.contentType,
        contentDisposition : normalized.contentDisposition
      });
      summary.loaded += 1;
      record({
        operation   : 'seed',
        bucket      : normalized.bucket,
        key         : normalized.key,
        contentType : optionalString(normalized.contentType),
        bodyBytes   : normalized.body.length,
        // The identity the storage contract keys on, carried by the record
        // that reports the load (SCR-F12). "Loaded" without it is a claim
        // about a byte count, and two different byte strings of the same
        // length are indistinguishable in it - while lib/util/file.js:32-43
        // derives the object Key from exactly this digest, so a seed that
        // loaded the wrong bytes is only ever visible here. Derived from the
        // bytes actually written, not from the manifest value.
        bodySha1    : crypto.createHash('sha1').update(normalized.body).digest('hex'),
        outcome     : 'stored'
      });
    }
    catch (e) {
      var reason = 'entry ' + index + ' could not be stored: ' +
                   (e && e.message ? e.message : String(e));
      summary.rejected += 1;
      summary.errors.push(reason);
      fail('seed-entry-rejected', reason);
    }
  });

  return summary;
}

// Reads PARITY_S3_SEED once at load. Absent is the normal case for a direct
// require, which uses prepopulate() instead; unreadable or malformed is
// recorded and never thrown.
function loadSeedFromEnvironment() {
  var target = process.env.PARITY_S3_SEED;

  if (typeof target !== 'string' || target.trim() === '') {
    return { path: null, loaded: 0, rejected: 0, errors: [] };
  }

  var resolved = path.resolve(target.trim());
  var text;

  try {
    text = fs.readFileSync(resolved, 'utf8');
  }
  catch (e) {
    var readReason = 'seed manifest ' + resolved + ' could not be read: ' +
                     (e && e.message ? e.message : String(e));
    fail('seed-manifest-unreadable', readReason);
    return { path: resolved, loaded: 0, rejected: 1, errors: [readReason] };
  }

  var manifest;

  try {
    manifest = JSON.parse(text);
  }
  catch (e) {
    var parseReason = 'seed manifest ' + resolved + ' is not valid JSON: ' +
                      (e && e.message ? e.message : String(e));
    fail('seed-manifest-invalid', parseReason);
    return { path: resolved, loaded: 0, rejected: 1, errors: [parseReason] };
  }

  var summary = prepopulate(manifest);
  summary.path = resolved;

  return summary;
}

// ---------------------------------------------------------------------------
// Signed URLs. Deterministic by construction: derived only from the operation,
// the bucket, the key and the caller's own relative Expires. See SIGNED URL
// FORMULA in the header, and note 1 owed to docs/baseline-parity.md for why a
// real presigned URL was rejected.
// ---------------------------------------------------------------------------

// The SDK's default when Expires is absent, and its behaviour of accepting
// whatever number it is given. A non-numeric or non-positive value falls back
// rather than producing 'NaN' in a compared Location header.
function normalizeExpires(expires) {
  var value = Number(expires);

  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_SIGNED_EXPIRES;
  }

  return Math.floor(value);
}

// AWS's own test for whether a bucket can be addressed virtual-hosted. The
// real SDK falls back to path-style otherwise, and so does this, so a bucket
// name a harness invents cannot produce a malformed URL.
function isDnsCompatibleBucket(bucket) {
  return DNS_BUCKET_PATTERN.test(bucket) &&
         bucket.indexOf('..') === -1 &&
         !IPV4_PATTERN.test(bucket);
}

// Percent-encodes each key segment while preserving '/', which is exactly what
// a real presigned URL does: 'exports/1/a b.zip' becomes
// 'exports/1/a%20b.zip'.
function encodeKeyPath(key) {
  return String(key).split('/').map(encodeURIComponent).join('/');
}

function signedUrlForOperation(operation, bucket, key, expires) {
  var op     = String(operation);
  var name   = String(bucket === undefined || bucket === null ? '' : bucket);
  var objKey = String(key === undefined || key === null ? '' : key);
  var window = normalizeExpires(expires);

  var signature = crypto.createHash('sha256')
    .update([op, name, objKey, String(window)].join('\n'), 'utf8')
    .digest('hex');

  var base = isDnsCompatibleBucket(name)
    ? SIGNED_URL_SCHEME + name + SIGNED_URL_HOST_SUFFIX + '/' + encodeKeyPath(objKey)
    : SIGNED_URL_PATH_HOST + '/' + encodeURIComponent(name) + '/' + encodeKeyPath(objKey);

  return base + '?Expires=' + window + '&Signature=' + signature;
}

// The exported form. Fixed to 'getObject' because that is the only operation
// any call site presigns (lib/controllers/users.js:1299), so storage.js and
// worker.js assert against this function instead of duplicating the format.
function signedUrlFor(bucket, key, expires) {
  return signedUrlForOperation(SIGNED_URL_DEFAULT_OPERATION, bucket, key, expires);
}

// ---------------------------------------------------------------------------
// Request bodies. putObject receives a Readable at lib/util/file.js:15 and
// lib/workers/exports.js:393 (both from fs.createReadStream) and a Buffer from
// uploadSnapshotFromBuffer at lib/util/file.js:129, so Readable, Buffer and
// string are all accepted.
//
// A Readable is consumed to COMPLETION before the callback runs, which is not
// an optimisation but a correctness requirement: lib/util/file.js:52 unlinks
// the temporary file immediately inside the upload callback, so a read that
// had not finished would race the unlink and truncate the stored object -
// silently changing its sha1 content-hash key (AAP 0.6.7).
// ---------------------------------------------------------------------------
function readBody(body, cb) {
  if (body === undefined || body === null) {
    // The real SDK treats an absent Body as a zero-length object rather than
    // an error, and lib/util/file.js can reach this when fileinfo carries no
    // stream.
    return deliver(cb, null, { body: Buffer.alloc(0), type: 'empty' });
  }

  if (Buffer.isBuffer(body)) {
    // Copied, so a caller that reuses its buffer cannot mutate a stored
    // object after the fact.
    return deliver(cb, null, { body: Buffer.from(body), type: 'buffer' });
  }

  if (typeof body === 'string') {
    return deliver(cb, null, { body: Buffer.from(body, 'utf8'), type: 'string' });
  }

  if (typeof body.on !== 'function') {
    return deliver(
      cb,
      s3Error(
        'InvalidParameterType',
        'Expected params.Body to be a string, Buffer or Readable stream',
        undefined
      ),
      null
    );
  }

  var chunks  = [];
  var settled = false;

  function onData(chunk) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      return;
    }
    // A stream in object mode or with an encoding set still has to produce
    // bytes, and coercing here is what keeps the stored digest defined.
    chunks.push(Buffer.from(String(chunk), 'utf8'));
  }

  function detach() {
    body.removeListener('data', onData);
    body.removeListener('end', onEnd);
    body.removeListener('error', onError);
  }

  function onEnd() {
    if (settled) {
      return;
    }
    settled = true;
    detach();
    // Already asynchronous - 'end' cannot fire in the caller's tick - so the
    // callback runs directly rather than through another setImmediate, which
    // keeps the write ordered immediately after the last chunk.
    cb(null, { body: Buffer.concat(chunks), type: 'readable' });
  }

  function onError(err) {
    if (settled) {
      return;
    }
    settled = true;
    detach();
    // Delivered as the callback's first argument, which is the shape
    // lib/util/file.js:49 swallows with `err && console.log(err)` before
    // continuing to the unlink and the caller's callback (R-d ruling 1).
    cb(err, null);
  }

  body.on('data', onData);
  body.on('end', onEnd);
  body.on('error', onError);

  return undefined;
}

// ---------------------------------------------------------------------------
// The client. Installed onto AWS.S3, so every `new aws.S3()` the application
// performs later - lib/util/file.js:11,82,141,197,
// lib/controllers/users.js:1298 and lib/workers/exports.js:60,387 - builds one
// of these. Constructor arguments are accepted and ignored: the real client
// takes a configuration object, and none of those call sites passes one.
// ---------------------------------------------------------------------------
function ParityS3(options) {
  this.parityFixture = FIXTURE_MARKER;
  this.config = options && typeof options === 'object' ? options : {};
}

// Lets install() recognise an already-installed fixture without inspecting
// aws-sdk internals, and lets a harness assert which client it holds.
ParityS3.parityFixture = FIXTURE_MARKER;

// A mutating operation with no callback is NOT performed. The real SDK returns
// an unsent AWS.Request in that case and does nothing until .send() or
// .promise() is called, so performing the write here would be a behaviour this
// fixture invented. Every application call site passes a callback, so this
// only ever fires on harness misuse - which is why it is recorded rather than
// ignored.
function requireCallback(operation, params, cb) {
  if (typeof cb === 'function') {
    return true;
  }

  fail('unsent-request', {
    operation : operation,
    bucket    : typeof params.Bucket === 'string' ? params.Bucket : null,
    key       : typeof params.Key === 'string' ? params.Key : null,
    detail    : 'called without a callback; the real SDK would return an unsent request, so nothing was performed'
  });

  return false;
}

// Normalizes the params argument the way the SDK does for a missing object.
function paramsOf(params) {
  return params && typeof params === 'object' ? params : {};
}

// putObject - lib/util/file.js:12 and lib/workers/exports.js:390.
//
// `data` is deliberately minimal: no call site reads any field of it
// (lib/util/file.js:17-19 forwards it and lib/workers/exports.js:396 ignores
// it), so the deterministic ETag is the whole of it.
ParityS3.prototype.putObject = function(params, callback) {
  var p = paramsOf(params);

  if (!requireCallback('putObject', p, callback)) {
    return undefined;
  }

  var invalid = validateBucketKey(p);

  if (invalid) {
    record({
      operation : 'putObject',
      bucket    : typeof p.Bucket === 'string' ? p.Bucket : null,
      key       : typeof p.Key === 'string' ? p.Key : null,
      outcome   : 'invalid-parameters',
      error     : invalid.code
    });
    return deliver(callback, invalid, null);
  }

  return readBody(p.Body, function(bodyErr, resolved) {
    if (bodyErr) {
      record({
        operation   : 'putObject',
        bucket      : p.Bucket,
        key         : p.Key,
        contentType : optionalString(p.ContentType),
        outcome     : 'body-error',
        error       : bodyErr.code || bodyErr.message
      });
      // Not stored: a real upload whose body fails mid-stream leaves no
      // object behind.
      return deliver(callback, bodyErr, null);
    }

    var sidecar;

    try {
      sidecar = writeObject(p.Bucket, p.Key, resolved.body, {
        contentType        : p.ContentType,
        contentDisposition : p.ContentDisposition
      });
    }
    catch (e) {
      return deliver(callback, storeFault('putObject', p, 'write', 'write-failed', e), null);
    }

    record({
      operation          : 'putObject',
      bucket             : p.Bucket,
      key                : p.Key,
      contentType        : sidecar.contentType,
      contentDisposition : sidecar.contentDisposition,
      bodyType           : resolved.type,
      bodyBytes          : sidecar.size,
      etag               : sidecar.etag,
      outcome            : 'stored'
    });

    return deliver(callback, null, { ETag: sidecar.etag });
  });
};

// The callback form of getObject - lib/util/file.js:200 and
// lib/workers/exports.js:61.
//
// data.Body MUST be a Buffer: lib/util/file.js:209 resolves it with the
// comment "Body is a Buffer", and lib/workers/exports.js:66 hands it straight
// to archive.append(), so byte-exactness is what lets a worker assertion
// re-read the archive.
function serveGetObjectCallback(p, callback) {
  var invalid = validateBucketKey(p);

  if (invalid) {
    record({
      operation : 'getObject',
      form      : 'callback',
      bucket    : typeof p.Bucket === 'string' ? p.Bucket : null,
      key       : typeof p.Key === 'string' ? p.Key : null,
      outcome   : 'invalid-parameters',
      error     : invalid.code
    });
    return deliver(callback, invalid, null);
  }

  var found;

  try {
    found = readObject(p.Bucket, p.Key);
  }
  catch (e) {
    return deliver(callback, storeFault('getObject', p, 'read', 'read-failed', e), null);
  }

  if (!found) {
    record({
      operation : 'getObject',
      form      : 'callback',
      bucket    : p.Bucket,
      key       : p.Key,
      outcome   : 'missing',
      error     : 'NoSuchKey'
    });
    return deliver(callback, noSuchKeyError(), null);
  }

  var data = {
    AcceptRanges  : 'bytes',
    LastModified  : new Date(FIXED_LAST_MODIFIED),
    ContentLength : found.size,
    ETag          : found.etag,
    Metadata      : {},
    Body          : found.body
  };

  // Present only when the upload supplied them, so "store and return exactly
  // the ContentType you were given" holds and no default is invented (R-d
  // ruling 4).
  if (found.contentType !== null) {
    data.ContentType = found.contentType;
  }
  if (found.contentDisposition !== null) {
    data.ContentDisposition = found.contentDisposition;
  }

  record({
    operation          : 'getObject',
    form               : 'callback',
    bucket             : p.Bucket,
    key                : p.Key,
    contentType        : found.contentType,
    contentDisposition : found.contentDisposition,
    bodyBytes          : found.size,
    etag               : found.etag,
    outcome            : 'served'
  });

  return deliver(callback, null, data);
}

// The read stream behind the request-object form - lib/util/file.js:83-86.
//
// Built on the core PassThrough and settled by the same mechanism
// aws-sdk/lib/request.js uses: stream.end() for a hit, and
// stream.emit('error', err) for a failure, with NO 'error' listener attached
// by this file. For an absent key the stream therefore emits 'error' and never
// ends, which leaves downloadMaterialFile's PassThrough hanging exactly as
// baseline does - R-d ruling 2. Nothing here synthesizes an 'end' or
// substitutes an empty body.
function createObjectReadStream(p) {
  var stream  = new PassThrough();
  var invalid = validateBucketKey(p);
  var found   = null;

  if (!invalid) {
    try {
      found = readObject(p.Bucket, p.Key);
    }
    catch (e) {
      // storeFault also records the call outcome, which is why the deferred
      // block below records only the two outcomes it can still reach.
      invalid = storeFault('createReadStream', p, 'read', 'read-failed', e);
    }
  }

  // Deferred, because the real SDK sends the request on a later tick
  // (`process.nextTick(function() { req.send(); })`) and a consumer therefore
  // always has the chance to attach its listeners first.
  setImmediate(function() {
    if (invalid) {
      // Recorded BEFORE the emit: an unhandled 'error' ends the process, and
      // evidence written afterwards would never exist. A store fault has
      // already been recorded by storeFault above, so only the parameter
      // rejection is recorded here.
      if (invalid.code === 'MissingRequiredParameter') {
        record({
          operation : 'createReadStream',
          bucket    : typeof p.Bucket === 'string' ? p.Bucket : null,
          key       : typeof p.Key === 'string' ? p.Key : null,
          outcome   : 'invalid-parameters',
          error     : invalid.code
        });
      }
      stream.emit('error', invalid);
      return;
    }

    if (!found) {
      record({
        operation : 'createReadStream',
        bucket    : p.Bucket,
        key       : p.Key,
        outcome   : 'missing',
        error     : 'NoSuchKey'
      });
      stream.emit('error', noSuchKeyError());
      return;
    }

    record({
      operation          : 'createReadStream',
      bucket             : p.Bucket,
      key                : p.Key,
      contentType        : found.contentType,
      contentDisposition : found.contentDisposition,
      bodyBytes          : found.size,
      etag               : found.etag,
      outcome            : 'served'
    });

    if (found.size) {
      stream.write(found.body);
    }
    stream.end();
  });

  return stream;
}

// The request-object form of getObject - `client.getObject({...})` with no
// callback, at lib/util/file.js:83. The real return value is an AWS.Request;
// only createReadStream() is ever called on it, and `on()` is provided because
// AWS.Request's returns itself and a future chained call must not break.
// Registering a listener here would be pointless - this object emits nothing -
// so on() is an explicit no-op that preserves chaining rather than a partial
// event emitter.
function buildGetObjectRequest(p) {
  var request = {
    parityFixture : FIXTURE_MARKER,

    createReadStream : function() {
      return createObjectReadStream(p);
    },

    on : function() {
      return request;
    }
  };

  record({
    operation : 'getObject',
    form      : 'request',
    bucket    : typeof p.Bucket === 'string' ? p.Bucket : null,
    key       : typeof p.Key === 'string' ? p.Key : null,
    outcome   : 'request-created'
  });

  return request;
}

// getObject - both forms. The callback's presence is what selects between
// them, exactly as it does in the real SDK.
ParityS3.prototype.getObject = function(params, callback) {
  var p = paramsOf(params);

  if (typeof callback === 'function') {
    return serveGetObjectCallback(p, callback);
  }

  return buildGetObjectRequest(p);
};

// deleteObject - lib/util/file.js:143, where the callback is the caller's own,
// defaulted at lib/util/file.js:135-138 when the caller passed none.
//
// The Key that arrives here is the substring after the LAST '/'
// (lib/util/file.js:142), so it is a bare filename even where the stored key
// for another operation contains slashes. Exactly that key is deleted; no
// slashed variant is searched for. Deleting an absent key is a success with an
// empty result, which is what real S3 does.
ParityS3.prototype.deleteObject = function(params, callback) {
  var p = paramsOf(params);

  if (!requireCallback('deleteObject', p, callback)) {
    return undefined;
  }

  var invalid = validateBucketKey(p);

  if (invalid) {
    record({
      operation : 'deleteObject',
      bucket    : typeof p.Bucket === 'string' ? p.Bucket : null,
      key       : typeof p.Key === 'string' ? p.Key : null,
      outcome   : 'invalid-parameters',
      error     : invalid.code
    });
    return deliver(callback, invalid, null);
  }

  var existed;

  try {
    existed = removeObject(p.Bucket, p.Key);
  }
  catch (e) {
    return deliver(callback, storeFault('deleteObject', p, 'delete', 'delete-failed', e), null);
  }

  record({
    operation : 'deleteObject',
    bucket    : p.Bucket,
    key       : p.Key,
    existed   : existed,
    outcome   : existed ? 'deleted' : 'absent'
  });

  return deliver(callback, null, {});
};

// getSignedUrl - lib/controllers/users.js:1299, whose return value becomes the
// Location of an h.redirect at :1311 and is compared EXACTLY by replay.js.
//
// SYNCHRONOUS and returns a string. It neither validates nor throws, which is
// measured behaviour: the real SDK returns a string for a missing Bucket or
// Key too. It performs no lookup either, because presigning is a signing
// operation and a real presigned URL for an absent key is still a URL.
ParityS3.prototype.getSignedUrl = function(operation, params, callback) {
  var op = typeof operation === 'string' && operation !== ''
    ? operation
    : SIGNED_URL_DEFAULT_OPERATION;
  var p = paramsOf(params);
  var expires = normalizeExpires(p.Expires);
  var url = signedUrlForOperation(op, p.Bucket, p.Key, p.Expires);

  if (typeof callback === 'function') {
    // The SDK's asynchronous presign form. No call site uses it, so it is
    // recorded rather than implemented: returning the string is still correct
    // for every caller that reads the return value.
    fail('getsignedurl-callback-form', {
      operation : op,
      detail    : 'the asynchronous presign form is not implemented; the URL was returned synchronously'
    });
  }

  record({
    operation   : 'getSignedUrl',
    s3Operation : op,
    bucket      : typeof p.Bucket === 'string' ? p.Bucket : null,
    key         : typeof p.Key === 'string' ? p.Key : null,
    expires     : expires,
    url         : url,
    outcome     : 'signed'
  });

  return url;
};

// headObject - a DEFENSIVE STUB. No call site anywhere in lib/ or config/
// calls it: grep-verified, and note 2 owed to docs/baseline-parity.md records
// that AAP 0.9.3 names it in error. It exists so that a future caller gets S3's
// own shape - including HeadObject's 'NotFound' rather than GetObject's
// 'NoSuchKey' - and is recorded, instead of failing with a TypeError. Nothing
// in the harness relies on it.
ParityS3.prototype.headObject = function(params, callback) {
  var p = paramsOf(params);

  if (!requireCallback('headObject', p, callback)) {
    return undefined;
  }

  var invalid = validateBucketKey(p);

  if (invalid) {
    record({
      operation : 'headObject',
      bucket    : typeof p.Bucket === 'string' ? p.Bucket : null,
      key       : typeof p.Key === 'string' ? p.Key : null,
      outcome   : 'invalid-parameters',
      error     : invalid.code
    });
    return deliver(callback, invalid, null);
  }

  var found;

  try {
    found = readObject(p.Bucket, p.Key);
  }
  catch (e) {
    return deliver(callback, storeFault('headObject', p, 'read', 'read-failed', e), null);
  }

  if (!found) {
    record({
      operation : 'headObject',
      bucket    : p.Bucket,
      key       : p.Key,
      outcome   : 'missing',
      error     : 'NotFound'
    });
    return deliver(callback, notFoundError(), null);
  }

  var data = {
    AcceptRanges  : 'bytes',
    LastModified  : new Date(FIXED_LAST_MODIFIED),
    ContentLength : found.size,
    ETag          : found.etag,
    Metadata      : {}
  };

  if (found.contentType !== null) {
    data.ContentType = found.contentType;
  }
  if (found.contentDisposition !== null) {
    data.ContentDisposition = found.contentDisposition;
  }

  record({
    operation : 'headObject',
    bucket    : p.Bucket,
    key       : p.Key,
    bodyBytes : found.size,
    outcome   : 'served'
  });

  return deliver(callback, null, data);
};


// ---------------------------------------------------------------------------
// Installation. The application's own config/aws is resolved from the worktree
// under test and its S3 property is replaced, so every `new aws.S3()` the
// application performs afterwards builds a fixture client. Every other
// property of the namespace - AWS.config, AWS.util and the other services - is
// left untouched.
// ---------------------------------------------------------------------------

// Idempotent. A second call is a no-op that returns the same status, and an
// already-patched namespace is recognised by the marker rather than by
// assuming this process is the one that patched it - which is what makes a
// direct require() after a preload safe. Never throws: a preload that throws
// takes the server down before app.js loads, so a failure is recorded on
// errors() and reported through status() instead.
function install() {
  // Binding the store is the FIRST thing an install does, before the
  // already-installed no-op, and it is the other half of TST-73. restore()
  // unbinds the store, so a caller that installs once per pass - set
  // PARITY_S3_ROOT, install(), read - would otherwise be holding the exported
  // `root` value at null until some later store access happened to bind it,
  // and a caller that re-pointed the variable WITHOUT restoring would not
  // rebind at all here. Running it unconditionally makes "installed implies
  // bound and published" a real invariant of this module rather than a
  // property of the load order, and it is what keeps the exported `root` value
  // in step with status().root, which resolves live. The fast path is one
  // environment read and one string comparison; a failure to create the
  // directories is already recorded by ensureRoot() through fail() and must
  // not stop the namespace from being patched, because an unpatched namespace
  // means the application reaches real S3.
  ensureRoot();

  if (state.installed) {
    return status();
  }

  var appRoot = process.env.PARITY_APP_ROOT || process.cwd();
  var target  = path.resolve(appRoot, 'config/aws');
  var resolved;

  try {
    resolved = require.resolve(target);
  }
  catch (e) {
    state.diagnostic = 'config/aws is not resolvable from ' + appRoot + ' (' +
                       (e && (e.code || e.message) ? (e.code || e.message) : String(e)) + ')';
    fail('install-failed', state.diagnostic);
    return status();
  }

  try {
    // Loading it performs no network I/O: config/aws requires only aws-sdk and
    // config. It is loaded here so the cache entry the application will hit is
    // the one being patched, and so the genuine constructor can be retained
    // for restore().
    var AWS = require(resolved);

    if (!AWS || typeof AWS !== 'object') {
      state.diagnostic = resolved + ' did not export the AWS namespace';
      fail('install-failed', state.diagnostic);
      return status();
    }

    state.awsModule = AWS;
    state.awsPath   = resolved;

    if (AWS.S3 && AWS.S3.parityFixture === FIXTURE_MARKER) {
      // Already patched by an earlier install() or by the preload. One layer
      // only, and the retained original is left exactly as it was.
      state.installed  = true;
      state.diagnostic = null;
      return status();
    }

    state.originalS3 = AWS.S3;
    AWS.S3           = ParityS3;
    state.installed  = true;
    state.diagnostic = null;
  }
  catch (e) {
    state.diagnostic = resolved + ' could not be patched: ' +
                       (e && e.message ? e.message : String(e));
    fail('install-failed', state.diagnostic);
  }

  return status();
}

// Puts the genuine AWS.S3 back AND unbinds the store. The retained original is
// used here and nowhere else: no code path in this file ever constructs or
// calls it, which is what keeps "no network access on any code path" true.
//
// Unbinding the store is not housekeeping, it is the other half of the same
// guarantee (TST-73): the constructor patch and the object store are two
// separate pieces of state, and a caller that restores between two passes -
// test/parity/replay.js:4986-4999 sets PARITY_S3_ROOT, re-uses the cached
// module, calls restore() and then reads the store - was previously left
// holding the FIRST pass's directory with no error to show for it. After this
// call nothing is bound, and the next store access binds whatever
// PARITY_S3_ROOT names then, so each pass gets its own store.
function restore() {
  if (state.awsModule && state.originalS3) {
    state.awsModule.S3 = state.originalS3;
  }

  state.awsModule  = null;
  state.originalS3 = null;
  state.installed  = false;

  // state.lastBoundRoot is deliberately NOT cleared: it is what lets the next
  // bind report which store it replaced.
  state.root          = null;
  state.rootReady     = false;
  module.exports.root = null;

  return status();
}

// What is patched, where, and what the store and the seed load produced.
// Deliberately free of directory scans and of any mkdir, so a harness can call
// it cheaply from inside a run; objects() is the accessor that touches the
// filesystem.
//
// `root` reports the LIVE root - the directory the next store access will use -
// rather than a value cached at load, which is what
// test/parity/worker.js:1123 and :2616 assert against PARITY_S3_ROOT and
// against the run layout, and what makes the answer meaningful to a caller
// that has just re-pointed the variable or called restore(). `rootReady` is
// true only when that live root is the bound one and its directories exist, so
// the two fields cannot disagree.
function status() {
  var live = resolveRoot();

  return {
    installed  : state.installed,
    appRoot    : process.env.PARITY_APP_ROOT || process.cwd(),
    awsPath    : state.awsPath,
    patched    : !!(state.awsModule && state.awsModule.S3 &&
                    state.awsModule.S3.parityFixture === FIXTURE_MARKER),
    root       : live,
    rootReady  : state.root === live && state.rootReady,
    seed       : state.seed,
    calls      : state.calls.length,
    errors     : state.errors.length,
    diagnostic : state.diagnostic
  };
}

// ---------------------------------------------------------------------------
// Surface inventory (BE-36). Two views of AWS_SURFACE, because a documented
// surface that nothing measures is a surface that drifts: surface() reports
// what a run actually REACHED, and measureSurface() reports what the tree
// actually CONTAINS. The declared constant is the third view, and the point of
// the pair is that any disagreement between the three is visible instead of
// being a comment nobody re-checks.
// ---------------------------------------------------------------------------

// What this run reached, from the call log.
//
//   declared      AWS_SURFACE, unchanged and frozen.
//   observed      {<operation>: <count>} over every recorded call, including
//                 the fixture's own non-method operations, so the log's own
//                 shape is not hidden.
//   stubsInvoked  the defensive stubs that were actually called. `headObject`
//                 appearing here is what would DISPROVE the "nothing calls it"
//                 measurement, which is the claim docs/baseline-parity.md gets
//                 wrong in the other direction.
//   undeclared    an operation the fixture answered that AWS_SURFACE does not
//                 declare - a call site the inventory has not caught up with.
//
// Cheap: it walks the in-memory call log and touches neither the filesystem
// nor the tree.
function surface() {
  var declaredMethods = [];
  var observed        = {};
  var stubsInvoked    = [];
  var undeclared      = [];

  AWS_SURFACE.forEach(function(entry) {
    if (declaredMethods.indexOf(entry.method) === -1) {
      declaredMethods.push(entry.method);
    }
  });

  state.calls.forEach(function(entry) {
    if (!entry || typeof entry.operation !== 'string') {
      // A fail() record is keyed on `event`, not on an operation, and is
      // therefore not a call against the surface.
      return;
    }
    observed[entry.operation] = (observed[entry.operation] || 0) + 1;
  });

  Object.keys(observed).forEach(function(operation) {
    if (declaredMethods.indexOf(operation) === -1 &&
        NON_METHOD_OPERATIONS.indexOf(operation) === -1) {
      undeclared.push(operation);
    }
  });

  AWS_SURFACE.forEach(function(entry) {
    if (entry.role === 'defensive-stub' &&
        observed[entry.method] &&
        stubsInvoked.indexOf(entry.method) === -1) {
      stubsInvoked.push(entry.method);
    }
  });

  return {
    declared     : AWS_SURFACE,
    observed     : observed,
    stubsInvoked : stubsInvoked,
    undeclared   : undeclared
  };
}

// The scan bounds. A tree this size needs none of them - lib/ and config/ hold
// well under a hundred files - and they exist so that a symlink loop or an
// unexpected tree cannot turn a documentation helper into an unbounded walk.
var SCAN_MAX_FILES      = 2000;
var SCAN_MAX_DIRS       = 500;
var SCAN_MAX_FILE_BYTES = 4 * 1024 * 1024;
var SCAN_CALL_WINDOW    = 4000;   // characters of one call expression
var SCAN_CHAIN_WINDOW   = 40;     // characters after it, for a chained call

// Directory names never descended into. `node_modules` is the one that
// matters: aws-sdk's own source is full of these method names and would swamp
// the measurement.
var SCAN_SKIP_DIRS = ['node_modules', '.git'];

// Measures the AWS surface the tree really contains, and is the generator
// behind the inventory rather than a transcription of it (BE-36).
//
// Scans <appRoot>/lib recursively and <appRoot>/config non-recursively for
// `.<method>(` call sites of the methods AWS_SURFACE declares, classifies each
// site's form from the source around it, and compares the measured
// (method, form, module) triples against the declared ones. `lib/` and
// `config/` are the whole of the search space because those are the only trees
// that reach the SDK - the receiver is not matched on its variable name, since
// lib/util/store/*.js and config/redis.js call a Redis `client` with entirely
// different methods and a name-based match would either miss a renamed
// variable or collect those.
//
// Returns:
//   {ok, appRoot, scanned, sites: [{method, form, file, line, source}],
//    declaredWithoutSite: [...], drift: {undeclared: [...], missing: [...]},
//    reason}
//
// `ok` describes the SCAN, not the comparison: it is true only when the walk
// completed inside its bounds, every file was read, and at least one file was
// found - so a measurement of the wrong tree or a partial one can never be
// mistaken for a clean result, and `reason` says which of those happened. The
// comparison's own verdict is `drift`, which a caller asserts separately.
// `declaredWithoutSite` carries the methods AWS_SURFACE declares with no call
// site - `headObject`, the defensive stub - which are deliberately NOT
// reported as missing.
//
// It NEVER runs at load, NEVER throws, writes nothing, records nothing and
// emits nothing on stdout or stderr, so it is safe to call from a
// documentation generator, from a gate, or from a review session.
function measureSurface(options) {
  try {
    return runSurfaceScan(options && typeof options === 'object' ? options : {});
  }
  catch (e) {
    // A scan is a convenience, never a dependency: a caller gets a reason and
    // decides for itself, and nothing propagates into a preloaded process.
    return {
      ok                  : false,
      reason              : 'the surface scan failed: ' +
                            (e && e.message ? e.message : String(e)),
      appRoot             : null,
      scanned             : 0,
      sites               : [],
      declaredWithoutSite : [],
      drift               : { undeclared: [], missing: [] }
    };
  }
}

// The scan itself. Separated from measureSurface() only so that the guarantee
// "never throws" is a single wrapper around a body written for clarity.
function runSurfaceScan(options) {
  var appRoot = options.appRoot ||
                process.env.PARITY_APP_ROOT ||
                process.cwd();
  var methods = [];
  var sites   = [];
  var skipped = [];
  var files;

  AWS_SURFACE.forEach(function(entry) {
    if (methods.indexOf(entry.method) === -1) {
      methods.push(entry.method);
    }
  });

  appRoot = path.resolve(appRoot);
  files   = collectScanFiles(appRoot, skipped);

  files.list.forEach(function(absolute) {
    var text;

    try {
      if (fs.statSync(absolute).size > SCAN_MAX_FILE_BYTES) {
        skipped.push({ file: absolute, reason: 'larger than the scan limit' });
        return;
      }
      text = fs.readFileSync(absolute, 'utf8');
    }
    catch (e) {
      skipped.push({
        file   : absolute,
        reason : e && e.message ? e.message : String(e)
      });
      return;
    }

    scanText(text, methods, relativeTo(appRoot, absolute)).forEach(function(site) {
      sites.push(site);
    });
  });

  sites.sort(function(a, b) {
    if (a.file !== b.file) {
      return a.file < b.file ? -1 : 1;
    }
    return a.line - b.line;
  });

  return buildSurfaceResult(appRoot, files, sites, skipped);
}

// Compares the measured sites against AWS_SURFACE and assembles the result.
// The comparison key is method + form + module, not method + file: two of the
// declared entries are getObject in lib/util/file.js and differ only by form,
// and the form is what decides how a failure is delivered (R-e), so a site
// whose form changed is drift even though its file did not.
function buildSurfaceResult(appRoot, files, sites, skipped) {
  var declaredKeys = [];
  var withoutSite  = [];
  var undeclared   = [];
  var missing      = [];
  var measuredKeys = sites.map(function(site) {
    return surfaceKey(site.method, site.form, site.file);
  });
  var reason = null;

  AWS_SURFACE.forEach(function(entry) {
    if (entry.module === null) {
      if (withoutSite.indexOf(entry.method) === -1) {
        withoutSite.push(entry.method);
      }
      return;
    }
    declaredKeys.push(surfaceKey(entry.method, entry.form, entry.module));
  });

  measuredKeys.forEach(function(key) {
    if (declaredKeys.indexOf(key) === -1 && undeclared.indexOf(key) === -1) {
      undeclared.push(key);
    }
  });

  declaredKeys.forEach(function(key) {
    if (measuredKeys.indexOf(key) === -1 && missing.indexOf(key) === -1) {
      missing.push(key);
    }
  });

  if (skipped.length) {
    reason = skipped.length + ' path(s) could not be scanned, so the ' +
             'measurement is incomplete: ' + skipped.map(function(entry) {
               return entry.file + ' (' + entry.reason + ')';
             }).join('; ');
  }
  else if (files.truncated) {
    reason = 'the scan hit its own bounds (' + SCAN_MAX_FILES + ' files, ' +
             SCAN_MAX_DIRS + ' directories), so the measurement is incomplete';
  }
  else if (files.list.length === 0) {
    // An absent lib/ and config/ is an ENOENT the walk deliberately swallows,
    // so without this the caller would get ok:true, no sites and every
    // declared entry reported missing - a clean-looking answer about the wrong
    // tree. Measured: that is exactly what a wrong `appRoot` produces.
    reason = 'no JavaScript file was found under ' + path.join(appRoot, 'lib') +
             ' or ' + path.join(appRoot, 'config') + ', so the tree scanned ' +
             'is not the application tree';
  }

  return {
    ok                  : reason === null,
    reason              : reason,
    appRoot             : appRoot,
    scanned             : files.list.length,
    sites               : sites,
    declaredWithoutSite : withoutSite,
    drift               : { undeclared: undeclared, missing: missing }
  };
}

function surfaceKey(method, form, module) {
  return method + ' ' + form + ' ' + module;
}

// A repository-relative path with '/' separators, so a site reads the same way
// on any host and can be compared against AWS_SURFACE's `module`.
function relativeTo(appRoot, absolute) {
  return path.relative(appRoot, absolute).split(path.sep).join('/');
}

// lib/**/*.js plus config/*.js. Iterative rather than recursive, with an
// explicit stack and hard caps, so the walk cannot be driven off the end by a
// symlink loop.
function collectScanFiles(appRoot, skipped) {
  var list      = [];
  var truncated = false;
  var stack     = [{ dir: path.join(appRoot, 'lib'), recurse: true }];
  var visited   = 0;

  stack.push({ dir: path.join(appRoot, 'config'), recurse: false });

  while (stack.length) {
    var current = stack.pop();
    var entries;

    if (visited >= SCAN_MAX_DIRS || list.length >= SCAN_MAX_FILES) {
      truncated = true;
      break;
    }

    visited += 1;

    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    }
    catch (e) {
      if (!e || e.code !== 'ENOENT') {
        // An absent lib/ or config/ is a caller pointing at the wrong tree and
        // is reported through `scanned`; anything else is a real fault.
        skipped.push({
          file   : current.dir,
          reason : e && e.message ? e.message : String(e)
        });
      }
      continue;
    }

    entries.forEach(function(entry) {
      var absolute = path.join(current.dir, entry.name);

      if (entry.isDirectory()) {
        if (current.recurse && SCAN_SKIP_DIRS.indexOf(entry.name) === -1) {
          stack.push({ dir: absolute, recurse: true });
        }
        return;
      }

      // Symlinks are not followed: a link is either a copy of a file already
      // in the walk or a path outside the tree, and neither belongs in a
      // measurement of this tree.
      if (entry.isFile() && entry.name.slice(-3) === '.js') {
        list.push(absolute);
      }
    });
  }

  return { list: list, truncated: truncated };
}

// Finds every declared method's call sites in one file's source and classifies
// each one's form.
//
// The form is read from the source around the call rather than assumed, because
// it is what decides how a failure is delivered and therefore which error
// funnel the application reaches (R-e):
//
//   a chained `.createReadStream(` immediately after the call  -> request-object
//   a function expression, an arrow, or a bare identifier as
//     the final argument                                       -> callback
//   anything else                                              -> synchronous
//
// The call's extent is found by balancing parentheses from its own opening one,
// bounded by SCAN_CALL_WINDOW; a call that does not balance inside that window
// is reported as 'unclassified' rather than guessed at, which then shows up as
// drift instead of as a silently wrong form.
function scanText(text, methods, file) {
  var receivers = s3Receivers(text);
  var patterns  = [
    // The declared methods, wherever they are called. This is what resolves
    // the lines and forms of the known surface.
    new RegExp('\\.(' + methods.join('|') + ')\\s*\\(', 'g')
  ];
  var found = [];

  // Every method called on an identifier this file has seen assigned from
  // `new <ns>.S3(...)`, whether or not AWS_SURFACE declares it. Without this
  // the scan could only ever confirm the list it started from, so a genuinely
  // new call site - `client.copyObject(...)`, `client.upload(...)` - would be
  // invisible and the drift report would be vacuous. That was the whole defect
  // BE-36 names in the prose inventory, reproduced in code.
  if (receivers.length) {
    patterns.push(new RegExp('\\b(?:' + receivers.join('|') +
      ')\\.([A-Za-z_$][A-Za-z0-9_$]*)\\s*\\(', 'g'));
  }

  patterns.forEach(function(pattern) {
    var match;

    while ((match = pattern.exec(text)) !== null) {
      var openIndex = match.index + match[0].length - 1;
      var extent    = callExtent(text, openIndex);
      var lineStart = text.lastIndexOf('\n', match.index) + 1;
      var lineEnd   = text.indexOf('\n', match.index);
      var source    = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).trim();
      var line      = lineNumberAt(text, match.index);

      // A line whose match sits inside a line comment or a block-comment
      // continuation is prose about a call, not a call. Raw text is all a
      // Node-core-only scanner has, so this is the one false-positive class
      // worth excluding by rule rather than by parser: every real call site in
      // this repository is code on its own line.
      if (source.indexOf('//') === 0 || source.indexOf('*') === 0) {
        continue;
      }

      if (found.some(function(site) {
        return site.line === line && site.method === match[1];
      })) {
        continue;                              // both patterns matched one call
      }

      found.push({
        method : match[1],
        form   : classifyForm(text, openIndex, extent),
        file   : file,
        line   : line,
        source : source
      });
    }
  });

  return found;
}

// The identifiers in one file that hold an S3 client, taken from their
// assignment: `var client = new aws.S3(...)` at lib/util/file.js:11 and its
// six siblings, which is the only way this application obtains one - there is
// no shared instance (config/aws.js exports the namespace). Also accepts a bare
// `new S3(` for a destructured namespace, which nothing does today.
//
// Deliberately not a general dataflow analysis: it reads assignments of the
// exact shape the repository uses, and a receiver it cannot see simply falls
// back to the declared-method scan above.
function s3Receivers(text) {
  var pattern = /(?:var|let|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*new\s+(?:[A-Za-z_$][A-Za-z0-9_$]*\s*\.\s*)?S3\s*\(/g;
  var names   = [];
  var match;

  while ((match = pattern.exec(text)) !== null) {
    if (names.indexOf(match[1]) === -1) {
      names.push(match[1]);
    }
  }

  return names;
}

// The index of the ')' that closes the '(' at openIndex, or -1 when it does not
// close inside SCAN_CALL_WINDOW characters.
function callExtent(text, openIndex) {
  var depth = 0;
  var limit = Math.min(text.length, openIndex + SCAN_CALL_WINDOW);
  var i;

  for (i = openIndex; i < limit; i += 1) {
    if (text.charAt(i) === '(') {
      depth += 1;
    }
    else if (text.charAt(i) === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function classifyForm(text, openIndex, closeIndex) {
  if (closeIndex === -1) {
    return 'unclassified';
  }

  var args  = text.slice(openIndex + 1, closeIndex);
  var chain = text.slice(closeIndex + 1, closeIndex + 1 + SCAN_CHAIN_WINDOW);

  if (/^\s*\.\s*createReadStream\s*\(/.test(chain)) {
    return 'request-object';
  }

  if (/\bfunction\s*[A-Za-z_$]*\s*\(/.test(args) || /=>/.test(args)) {
    return 'callback';
  }

  // A named callback passed by reference - `client.deleteObject({...}, cb)` at
  // lib/util/file.js is the measured example.
  if (/,\s*[A-Za-z_$][A-Za-z0-9_$.]*\s*$/.test(args)) {
    return 'callback';
  }

  return 'synchronous';
}

function lineNumberAt(text, index) {
  var line = 1;
  var i;

  for (i = 0; i < index; i += 1) {
    if (text.charAt(i) === '\n') {
      line += 1;
    }
  }

  return line;
}

// ---------------------------------------------------------------------------
// Public API. See PUBLIC API in the header for the one-line summary of each
// entry; the notes here are the ones a caller cannot infer from the name.
// ---------------------------------------------------------------------------
module.exports = {
  install : install,
  restore : restore,
  status  : status,

  // Clears the stored objects and the call log without reinstalling, which is
  // what a per-case harness needs between corpus cases. Recorded errors are
  // cleared too, so an assertion of "no fixture fault during this case" is
  // meaningful. The store ROOT is kept, and only files inside it are removed.
  reset : function() {
    var cleared = clearStore();

    state.calls  = [];
    state.errors = [];

    return { cleared: cleared, root: state.root };
  },

  // Direct store access, for a harness that seeds or asserts without going
  // through the client. `put` returns the sidecar record - bucket, key,
  // contentType, contentDisposition, etag, size - and `get` returns the same
  // fields plus the Buffer body, or null for an absent key.
  put : function(bucket, key, body, options) {
    var buffer;

    if (Buffer.isBuffer(body)) {
      buffer = Buffer.from(body);
    }
    else if (typeof body === 'string') {
      buffer = Buffer.from(body, 'utf8');
    }
    else if (body === undefined || body === null) {
      buffer = Buffer.alloc(0);
    }
    else {
      // Synchronous by contract, so a stream cannot be accepted here: a
      // harness that has one should use the client's putObject, which drains
      // it. Throwing is correct for a direct API misuse - unlike the SDK
      // surface and the preload, which must never throw.
      throw new TypeError(
        FIXTURE_MARKER + ': put() requires a Buffer, a string, null or undefined body; ' +
        'use the client putObject for a stream'
      );
    }

    return writeObject(bucket, key, buffer, options);
  },

  get : function(bucket, key) {
    return readObject(bucket, key);
  },

  has : function(bucket, key) {
    return hasObject(bucket, key);
  },

  // The exact keys stored for one bucket, byte-exactly as written and sorted
  // for stability. This is what asserts the sha1 content-hash key
  // (lib/util/file.js:32-43), its '-' + container.fileId and '.' + extension
  // suffixes, the user-asset digest + '-' + file.id + '.' + extension
  // (lib/util/file.js:178) and the export 'exports/' + userId + '/' + filename
  // (lib/workers/exports.js:126).
  list : function(bucket) {
    var records = allObjects();

    if (bucket === undefined) {
      return records.map(function(entry) {
        return { bucket: entry.bucket, key: entry.key };
      });
    }

    return records
      .filter(function(entry) { return entry.bucket === String(bucket); })
      .map(function(entry) { return entry.key; });
  },

  // Every sidecar record, sorted by bucket then key. Bodies are excluded; get()
  // is how a caller reads bytes.
  objects : function() {
    return allObjects();
  },

  prepopulate : prepopulate,

  // One entry per intercepted call, in order, never containing a body. This is
  // how a worker assertion checks the upload parameters at
  // lib/workers/exports.js:390-397 - the Bucket, the s3Key, ContentType
  // 'application/zip' and the ContentDisposition filename.
  calls : function() {
    return state.calls.slice();
  },

  // Fixture-level faults: a rejected seed entry, an unusable store root, a
  // logging failure, a client call the real SDK would not have performed.
  // Empty is the healthy state, and asserting that is worth doing.
  errors : function() {
    return state.errors.slice();
  },

  flush : flush,

  signedUrlFor : signedUrlFor,

  // Asserts which store this fixture is bound to. Rebinds first, so the answer
  // describes the store the next operation will use, and records a mismatch as
  // a fault - a caller checking a root that is not the one in use has evidence
  // about the wrong directory.
  verifyRoot : verifyRoot,

  // The currently BOUND store root, or null when nothing is bound - which is
  // the state restore() leaves behind. It is a value rather than an accessor
  // because a bind is the only thing that changes it, and status().root is the
  // accessor to use for the live root: a caller that has just re-pointed
  // PARITY_S3_ROOT and not yet touched the store sees the new root there and
  // the old binding here, which is the honest description of that moment.
  root : null,

  // A fixture client without touching the namespace, for a direct require that
  // wants to exercise the SDK surface itself.
  client : function() {
    return new ParityS3();
  },

  ParityS3 : ParityS3,

  // The frozen LastModified every getObject and headObject returns, so an
  // assertion can reference it instead of restating the literal.
  fixedLastModified : FIXED_LAST_MODIFIED,

  // The declared AWS surface, frozen. Authoritative for what this fixture has
  // to answer, and the thing measureSurface() is compared against.
  AWS_SURFACE : AWS_SURFACE,

  // What this run reached, from the call log: the declared surface, the
  // observed operation counts, any defensive stub that was actually invoked,
  // and any operation the inventory does not declare.
  surface : surface,

  // What the tree contains: the generator that produces the documented surface
  // from real call sites, with the drift against AWS_SURFACE. Never runs at
  // load, never throws and writes nothing.
  measureSurface : measureSurface
};

// ---------------------------------------------------------------------------
// Load. The store root is bound and created, PARITY_S3_SEED is loaded and the
// namespace is patched, in that order - the seed has to be on disk before the
// application can read it, and the application cannot read anything until the
// namespace is patched.
//
// The bind happens through ensureRoot() rather than by assigning state.root
// here, so the load takes exactly the path every later store access takes and
// there is only one place a root is ever resolved (TST-73). It is also why
// this is not the last word on the root: the variable is re-read on every
// store access, so a caller that re-points it later gets the store it asked
// for rather than this one.
//
// Wrapped so that nothing here can throw out of the load: this module is
// required before app.js, and a throw at this point would take the server down
// before it ever started. Every failure is on errors() and in status().
// ---------------------------------------------------------------------------
try {
  ensureRoot();
  state.seed = loadSeedFromEnvironment();

  install();
}
catch (e) {
  try {
    fail('load-failed', e && e.message ? e.message : String(e));
  }
  catch (ignored) {
    // The evidence log itself is unavailable, so the failure is kept on the
    // state object where status().diagnostic surfaces it. A plain assignment
    // cannot throw, which is what makes this the last layer.
    state.diagnostic = 'load failed and could not be logged: ' +
      (e && e.message ? e.message : String(e)) +
      ' (secondary failure: ' + (ignored && ignored.message ? ignored.message : String(ignored)) + ')';
  }
}
