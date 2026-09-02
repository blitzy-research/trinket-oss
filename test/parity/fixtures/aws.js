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
// substitute. The inventory below was re-measured over the current tree with
// `grep -rn "client\.[a-zA-Z]*(" lib/ config/` rather than taken on trust:
//
//   putObject   (callback)        lib/util/file.js:12
//   putObject   (callback)        lib/workers/exports.js:390
//   getObject   (callback)        lib/util/file.js:200
//   getObject   (callback)        lib/workers/exports.js:61
//   getObject   (request object)  lib/util/file.js:83  -> .createReadStream()
//   deleteObject(callback)        lib/util/file.js:143
//   getSignedUrl(synchronous)     lib/controllers/users.js:1299
//
// The repository's eighth aws-sdk call site is AWS.config.update at
// config/aws.js:8, which reconciles the "eight call sites" figure in AAP
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
//                    application.
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
// Exactly one of `bytesBase64` or `file` must be present. Any other key, a
// non-array manifest, a non-absolute `file`, an unreadable `file` or a
// `bytesBase64` that is not valid base64 REJECTS THAT ENTRY: the reason is
// recorded on errors() and the remaining entries are still loaded. Nothing
// here throws, because this runs at preload time and a throwing preload takes
// the server down before app.js loads.
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
//   2. headObject is never called: grep over lib/ and config/ returns no
//      occurrence. AAP 0.9.3 names it among the methods to replace and omits
//      getSignedUrl; the corrected seven-site inventory at the top of this
//      file is authoritative. A defensive stub is provided so that a future
//      caller fails visibly and is recorded, and nothing in the harness relies
//      on it.
//   3. A missing key in the request-object form leaves the application's
//      PassThrough un-ended AND raises an unhandled 'error' event, because the
//      application attaches no handler and Node's pipe attaches none to the
//      source. That is the real SDK's behaviour, preserved deliberately; a
//      harness case that drives it must expect the process-level signature
//      rather than a response.
//
// ===========================================================================
// PUBLIC API (consumed by test/parity/server.js, storage.js and worker.js)
// ===========================================================================
//   install()                     idempotent; returns status()
//   restore()                     puts the genuine AWS.S3 back; returns status()
//   status()                      what is patched, the resolved root, the seed
//                                 result and any diagnostic
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
//   root                          the resolved store root
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

// Store layout. Data and metadata are separate directories so that an object
// whose key ends in '.json' cannot collide with another object's sidecar.
var OBJECTS_DIR = 'objects';
var META_DIR    = 'meta';

// Flat-name construction. See STORE LAYOUT AND KEY ENCODING in the header for
// the collision and traversal argument that these three values carry.
var NAME_SEPARATOR   = '#';
var MAX_FLAT_NAME    = 180;
var TRUNCATED_PREFIX = 140;

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

// Base64 with optional whitespace and padding. Used to reject a `bytesBase64`
// that Buffer.from would silently truncate instead of failing.
var BASE64_PATTERN = /^[A-Za-z0-9+/\s]*={0,2}$/;

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
  root       : null,   // the resolved store root
  rootReady  : false,  // whether <root>/objects and <root>/meta exist
  diagnostic : null,   // why install() could not patch, if it could not
  seed       : null,   // the result of the PARITY_S3_SEED load
  calls      : [],     // one entry per intercepted call
  errors     : []      // fixture-level faults: never thrown, always reported
};

// ---------------------------------------------------------------------------
// Evidence log. Nothing here may ever throw into the application and nothing
// here may emit to stdout or stderr: the zero-warning gate captures both
// streams for the whole run (AAP 0.8).
// ---------------------------------------------------------------------------

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
    fs.appendFileSync(target, JSON.stringify(entry) + '\n');
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
    fs.writeFileSync(target, lines.length ? lines.join('\n') + '\n' : '');
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

  return path.join(os.tmpdir(), 'parity-s3-' + process.pid);
}

// Creates <root>/objects and <root>/meta. Called at load and again before
// every write, so a root removed between operations is recreated rather than
// turning into a cascade of ENOENT. Returns a boolean and never throws: at
// load time a throw would take the server down before app.js loads.
function ensureRoot() {
  if (state.rootReady) {
    return true;
  }

  try {
    fs.mkdirSync(path.join(state.root, OBJECTS_DIR), { recursive: true });
    fs.mkdirSync(path.join(state.root, META_DIR), { recursive: true });
    state.rootReady = true;
    return true;
  }
  catch (e) {
    state.rootReady = false;
    fail('store-root-unavailable', {
      root  : state.root,
      error : e && e.message ? e.message : String(e)
    });
    return false;
  }
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

  fs.writeFileSync(objectPath(bucket, key), body);
  fs.writeFileSync(metaPath(bucket, key), JSON.stringify(sidecar, null, 2) + '\n');

  return sidecar;
}

// Returns the stored object, or null when the key is absent. A sidecar that is
// missing or unreadable does not hide the object: the bytes still answer and
// the recoverable metadata is rebuilt from them, which matters because the
// bytes are the contract and the metadata is not.
function readObject(bucket, key) {
  if (!state.rootReady && !ensureRoot()) {
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
  if (!state.rootReady && !ensureRoot()) {
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
  if (!state.rootReady && !ensureRoot()) {
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
  if (!state.rootReady && !ensureRoot()) {
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

  if (!state.rootReady && !ensureRoot()) {
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
    if (!BASE64_PATTERN.test(entry.bytesBase64)) {
      // Buffer.from silently truncates at the first invalid character, which
      // would seed the wrong bytes and therefore the wrong content digest -
      // the one failure AAP 0.6.7 says surfaces as nothing but a lookup miss.
      return { ok: false, reason: where + ' has a `bytesBase64` that is not valid base64' };
    }
    body = Buffer.from(entry.bytesBase64, 'base64');
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

// Puts the genuine AWS.S3 back. The retained original is used here and nowhere
// else: no code path in this file ever constructs or calls it, which is what
// keeps "no network access on any code path" true.
function restore() {
  if (state.awsModule && state.originalS3) {
    state.awsModule.S3 = state.originalS3;
  }

  state.awsModule  = null;
  state.originalS3 = null;
  state.installed  = false;

  return status();
}

// What is patched, where, and what the store and the seed load produced.
// Deliberately free of directory scans, so a harness can call it cheaply from
// inside a run; objects() is the accessor that touches the filesystem.
function status() {
  return {
    installed  : state.installed,
    appRoot    : process.env.PARITY_APP_ROOT || process.cwd(),
    awsPath    : state.awsPath,
    patched    : !!(state.awsModule && state.awsModule.S3 &&
                    state.awsModule.S3.parityFixture === FIXTURE_MARKER),
    root       : state.root,
    rootReady  : state.rootReady,
    seed       : state.seed,
    calls      : state.calls.length,
    errors     : state.errors.length,
    diagnostic : state.diagnostic
  };
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

  // The resolved store root. Present as a value because it is fixed for the
  // life of the process, and repeated in status() for a harness that reports
  // one object.
  root : null,

  // A fixture client without touching the namespace, for a direct require that
  // wants to exercise the SDK surface itself.
  client : function() {
    return new ParityS3();
  },

  ParityS3 : ParityS3,

  // The frozen LastModified every getObject and headObject returns, so an
  // assertion can reference it instead of restating the literal.
  fixedLastModified : FIXED_LAST_MODIFIED
};

// ---------------------------------------------------------------------------
// Load. The store root is resolved and created, PARITY_S3_SEED is loaded and
// the namespace is patched, in that order - the seed has to be on disk before
// the application can read it, and the application cannot read anything until
// the namespace is patched.
//
// Wrapped so that nothing here can throw out of the load: this module is
// required before app.js, and a throw at this point would take the server down
// before it ever started. Every failure is on errors() and in status().
// ---------------------------------------------------------------------------
try {
  state.root = resolveRoot();
  module.exports.root = state.root;

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

