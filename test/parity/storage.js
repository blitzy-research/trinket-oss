/**
 * test/parity/storage.js - the storage and archive contract cases.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * AAP 0.6.7 states the contract and the trap in one sentence: the S3 key IS a
 * content hash, so any change to the digest silently orphans every stored
 * object - no error, no exception, only files that cannot be found.
 * `lib/util/file.js:66-78` streams a file through `crypto.createHash('sha1')`
 * with hex encoding, and `:32-43` uses that 40-character digest as the object's
 * `Key`. Change the algorithm, the encoding or the bytes, and every object
 * written before the change becomes unreachable while every new write still
 * looks perfect.
 *
 * That failure mode is INVISIBLE on freshly written data: a write-then-read
 * round trip passes under any digest algorithm, because both halves use the
 * same one. It only surfaces when a record seeded BEFORE the change is read
 * back afterwards. `test/parity/seed.js` provides exactly that - File documents
 * whose `hash`, `name` and `url` match objects the S3 fixture is pre-populated
 * with - and proving the application can still find them is this file's
 * headline case.
 *
 * AAP 0.6.7 is also explicit that NO existing test asserts any of this, which
 * is why the contract cannot rest on prose. Every claim below is executable.
 *
 * RULES
 * -----
 * NO USER-SPECIFIED RULES WERE PROVIDED for this project - `review_rules`
 * returns exactly "No user rules provided", which AAP 0.7 and 0.10.1 also
 * record. None is invented here, and their absence is not treated as licence to
 * lower the bar: enterprise-standard practice for a runtime and framework
 * migration governs instead, and the commitment that produced this file is that
 * every parity claim is backed by an inspectable artifact.
 *
 * The AAP's own RULES block IS binding, and four of its items shape this file.
 * R-c permits a package change for a stated reason, which makes `adm-zip`
 * 0.4.16 -> 0.6.0 a CHANGED SURFACE to be covered rather than assumed - see the
 * finding below. R-d prohibits behaviour "improvements", so the swallowed upload
 * error, the un-unlinked user-asset upload and the document saved before a
 * failing upload are asserted as they behave, not as they ought to. R-e requires
 * error-to-response mappings to survive, so every failure path asserts the exact
 * error and message the caller receives. R-f makes observed behaviour at base
 * commit 2f8712a the tie-breaker, which is why every expectation here was
 * measured against the source rather than inferred from it. The BOUNDARIES &
 * PRESERVATION clause on persisted data and file formats is bound to precisely
 * these cases.
 *
 * WHAT IS ASSERTED
 * ----------------
 * Each case names the lines it pins, so a reader can go from a failure to the
 * contract without a search:
 *
 *   _upload                  lib/util/file.js:10-19    all four putObject params
 *   key composition          lib/util/file.js:26,32-43 digest [-fileId] [.ext]
 *   content-type override    lib/util/file.js:28-30    extensionWhitelist
 *   swallowed upload error   lib/util/file.js:49       logged, then discarded
 *   temp-file cleanup        lib/util/file.js:52       both outcomes
 *   materials read           lib/util/file.js:84-86    createReadStream form
 *   avatar gate              lib/util/file.js:96-102   accept and reject
 *   snapshots                lib/util/file.js:105-130  1000 ms, exists, buffer
 *   delete                   lib/util/file.js:132-147  bucket + basename Key
 *   user assets              lib/util/file.js:149-194  save BEFORE upload
 *   user asset read          lib/util/file.js:196-212  resolve and reject
 *   export key format        lib/workers/exports.js:102-104,366-372,378
 *   archive layout           lib/workers/exports.js:252,277-295,308,334-359
 *
 * EXPECTATIONS ARE COMPUTED, NEVER OBSERVED
 * -----------------------------------------
 * Every payload is a committed byte literal and every expected digest and key
 * is computed here with `crypto.createHash('sha1')`. Nothing is derived from
 * what the application produced - an expectation copied out of the output under
 * test asserts only that the code agrees with itself. The digests are also
 * checked against committed constants at LOAD time, so a stray edit to a
 * payload fails immediately and by name instead of quietly re-keying every
 * object the cases write.
 *
 * NO RANDOMNESS, NO CLOCK
 * -----------------------
 * Fixed bytes, fixed digests, fixed ids, fixed filenames. The one place a real
 * clock is read is the snapshot case, which MEASURES that
 * `lib/util/file.js:107`'s 1000 ms `setTimeout` really elapsed rather than
 * defeating it with a shortened timer.
 *
 * THE MODULE UNDER TEST STAYS CALLBACK-BASED
 * ------------------------------------------
 * AAP rule T-3 keeps the promise boundary at the lifecycle method, and
 * `lib/util/file.js` is provisionally excluded from the async conversion (AAP
 * 0.2.2, gated by 0.9.2). So this harness wraps callbacks; it does not
 * modernize, promisify or otherwise reshape the module under test. If the
 * repaired suite ever forces that module's conversion, these cases must still
 * pass unchanged - which is why every call goes through `callback()` below
 * rather than through a promisified alias.
 *
 * ISOLATION
 * ---------
 * No real S3 and no network on any path. `test/parity/fixtures/aws.js` patches
 * `AWS.S3` on the application's own `config/aws` module and backs it with a
 * filesystem store under a per-run temporary root. MongoDB is the isolated
 * in-memory instance `test/parity/mongo.js` owns. Nothing in `test/helpers/**`
 * or `test/lib/**` is required: the sinon shapes in the store helper under
 * `test/helpers` were read as a pattern reference and nothing more.
 *
 * ORDERING, WHICH IS LOAD-BEARING
 * -------------------------------
 * Nothing application-facing is required at module scope. `config` 0.4.37
 * freezes its values on first require, so the database address has to be
 * published into NODE_CONFIG before anything reaches it, and the S3 fixture has
 * to patch `AWS.S3` before `lib/util/file.js` captures `new aws.S3()`. The
 * sequence inside `run()` is therefore: publish the environment, chdir, patch
 * the namespace, install the `File` global, then require the module under test.
 *
 * A MEASURED FINDING ABOUT THE ARCHIVE READ SURFACE
 * -------------------------------------------------
 * `adm-zip` moves 0.4.16 -> 0.6.0 (AAP 0.5.1.2), so archive reads are a changed
 * surface. Measured on an archive produced by this repository's own `archiver`
 * 2.1.1 on Node 22:
 *
 *   archiver 2.1.1 -> zip-stream -> compress-commons -> crc32-stream 2.0.0
 *   writes crc32 = 0 and uncompressed size = 0 into the local header, the data
 *   descriptor AND the central directory. `new DeflateCRC32Stream()` returns
 *   digest() = 0 and size() = 0 on Node 22 while size(true) is correct, so the
 *   compressed size is the only length the archive states truthfully.
 *
 *   adm-zip 0.4.16  entry.getData() returns an EMPTY Buffer, silently.
 *   adm-zip 0.6.0   entry.getData() THROWS 'ADM-ZIP: CRC32 checksum failed'.
 *
 * Neither version can read an export archive's contents through `getData()`, so
 * this file reads through adm-zip's own public `entry.getCompressedData()` and
 * inflates with core zlib, which recovers the bytes exactly. That is a
 * diagnosis, not a workaround: `assertArchiveLayout` reports the defect on its
 * result under `reader`, verifies a declared crc32 whenever one is actually
 * present, and the finding belongs in `docs/dependency-inventory.md`. Changing
 * `archiver` is outside this file's scope.
 *
 * USAGE
 * -----
 *   node test/parity/storage.js [--app <path>] [--out <path>] [--help]
 *   node test/parity/mongo.js -- node test/parity/storage.js
 *
 * The second form is what AAP 0.9.2 means by running in the same lifecycle as
 * the joi matrix: when `PARITY_MONGO_URI` is already in the environment this
 * file connects to that instance instead of starting a second one.
 *
 * On a host with no cached mongod, point the package at an existing binary with
 * MONGOMS_SYSTEM_BINARY - `test/parity/mongo.js` honours MONGOMS_* and never
 * overrides it.
 *
 * ARTIFACT AND STREAMS
 * --------------------
 * Human-readable progress goes to stderr. stdout carries the JSON result only,
 * and only when `--out` is absent; with `--out` the result is written there and
 * stdout stays empty. This is the same split the sibling gates use, because
 * AAP 0.9.1 requires an artifact stream that application side effects cannot
 * contaminate.
 *
 * EXIT CODES
 * ----------
 *   0  every case passed
 *   1  a case failed, or the run could not be completed
 *   2  a usage error
 *
 * PUBLIC API
 * ----------
 *   assertArchiveLayout(zipBytes[, expected])  the shared archive assertion,
 *                                              reused by test/parity/worker.js
 *   sanitizeFolderName(name)                   the expected sanitizer
 *   parseCodeFiles(trinket)                    the expected code-file split
 *   readArchiveEntries(zipBytes)               entry name -> {name, content}
 *   buildArchive(entries)                      archiver-produced test bytes
 *   PAYLOADS, DIGESTS                          the committed fixtures
 *   cases                                      the ordered case list
 *   run(options)                               the harness, as a promise
 *   main(argv)                                 the CLI entry point
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

// `lib/util/file.js:107` waits 1000 ms before it even looks for the snapshot.
// The snapshot cases must outlast that rather than shorten it, so every case
// gets a ceiling comfortably above it and the snapshot cases get their own.
var CASE_TIMEOUT_MS     = 20000;
var SNAPSHOT_TIMEOUT_MS = 30000;

// `lib/util/file.js:107`, as a value the assertion can name.
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
  '  --out <path>  Write the JSON result here instead of to stdout.',
  '  --help, -h    This text.',
  '',
  'ENVIRONMENT',
  '  PARITY_MONGO_URI      When set - which is what test/parity/mongo.js exports',
  '                        to a command it spawns - the harness connects to that',
  '                        instance instead of starting one of its own.',
  '  MONGOMS_SYSTEM_BINARY Honoured by test/parity/mongo.js; point it at an',
  '                        existing mongod on a host with no cached binary.',
  '',
  'EXIT CODES',
  '  0  every case passed',
  '  1  a case failed, or the run could not be completed',
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
// The digest, computed here
// ---------------------------------------------------------------------------

/**
 * `lib/util/file.js:66-78`'s digest, over a buffer instead of a stream.
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
  // keys differ only in the parts lib/util/file.js:38-43 appends.
  keyBytes : Buffer.from(
    'Parity storage case: key composition.\n' +
    'Fixed bytes, fixed digest.\n',
    'utf8'
  ),

  // A filename with several dots, to prove the extension comes from the LAST
  // one (lib/util/file.js:26 uses lastIndexOf).
  multiDotBytes : Buffer.from(
    'Parity storage case: last-dot extension.\n',
    'utf8'
  ),

  // A structurally valid but minimal notebook. The EXTENSION is what matters:
  // `ipynb` is the only entry in config/default.yaml:236-237's
  // extensionWhitelist, so this is the sole payload that can exercise the
  // content-type override at lib/util/file.js:28-30.
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
  // (lib/util/file.js:112 takes fileinfo.name from file.name, not from a
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
// load-time failure naming both values - the same guard seed.js applies to its
// own fixtures, and the guard AAP 0.6.7 asks for applied to the test data.
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
// Callback adapters
// ---------------------------------------------------------------------------
// `lib/util/file.js` is callback-based and stays that way (AAP rule T-3). These
// wrap a call for `await` WITHOUT touching the module under test: the module
// still sees an ordinary `function(err, result)`, and everything about its
// timing, its argument count and its error handling is preserved. Nothing here
// promisifies the module itself.

/**
 * Invokes a callback-taking function and resolves with BOTH arguments.
 *
 * Deliberately not node-style: several contracts here are about a callback
 * receiving an error AND a result together - `lib/util/file.js:190` calls
 * `cb(err, file)` - or about a success-shaped result arriving after an error was
 * swallowed at `:49`. A promisifier that rejected on a truthy first argument
 * would discard exactly the evidence those cases need.
 *
 * @param {function(function(*, *)): *} invoke Receives the callback.
 * @param {number} [timeoutMs] Defaults to CASE_TIMEOUT_MS.
 * @returns {Promise<{err: *, result: *, calls: number}>}
 */
function callback(invoke, timeoutMs) {
  var limit = timeoutMs === undefined ? CASE_TIMEOUT_MS : timeoutMs;

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
        // again, so it is reported on stderr where the run still shows it.
        note('WARNING: a callback fired ' + calls + ' times; only the first ' +
          'was asserted');
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
 * without a callback (lib/util/file.js:135-139) performs a delete whose only
 * evidence is the store, and the fixture delivers through setImmediate. The
 * ceiling is short on purpose - a miss here means the behaviour is absent, and
 * a long wait would only delay saying so.
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
 * `lib/util/file.js:80-89` returns a PassThrough that the application's callers
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
 * `lib/util/file.js:49` is `err && console.log(err)`: the upload error is LOGGED
 * and then discarded. Capturing turns that into a positive assertion - the
 * error really was reported before being dropped - and keeps the application's
 * own output off this harness's stdout, which AAP 0.9.1 requires to stay an
 * artifact stream.
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
// Uploads arrive as a temporary file the application unlinks
// (lib/util/file.js:52), so every upload case needs a fresh one. They are
// created inside one per-run directory that is removed at the end, which is how
// "leaves no temp files behind" is made true rather than hoped for.
//
// The directory name carries the pid so two concurrent runs cannot collide, and
// the FILE names are fixed per case, because the digest is the assertion and a
// name that varied would make a failure harder to read. The pid is not part of
// any asserted value.

/**
 * Creates the run's scratch directory.
 *
 * @returns {string} Absolute path.
 */
function createScratch() {
  var dir = path.join(os.tmpdir(), 'parity-storage-' + process.pid);

  fs.mkdirSync(dir, { recursive: true });

  return dir;
}

/**
 * Writes an upload's temporary file and returns the shape
 * `lib/util/file.js:22-30,149-152` reads: `path`, `filename`, `bytes` and
 * `headers['content-type']`.
 *
 * `bytes` is the payload's real length, because `:58` copies it into the result
 * as `size` and `:174` onto the File document, so a wrong value here would make
 * a passing assertion meaningless.
 *
 * @param {Object} ctx The run context, for the scratch directory.
 * @param {string} name The scratch file name; fixed per case.
 * @param {Buffer} payload
 * @param {string} filename The upload's declared filename.
 * @param {string} contentType The upload's declared content type.
 * @param {Object} [options]
 * @param {boolean} [options.harnessOwned=false] Set when the application is
 *   NOT expected to unlink the file - `uploadUserAsset` never does, and
 *   `uploadUserAvatar` returns before it would on the reject path. Such a path
 *   is registered on the context and removed by the runner after the case,
 *   whether it passed or failed.
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
 * Removes the scratch directory.
 *
 * Failures are reported and not thrown: a case result must still reach the
 * shell, and a surviving temporary directory is reported by the run's own
 * `leftovers` assertion rather than by an exception here.
 *
 * @param {string} dir
 * @returns {undefined}
 */
function removeScratch(dir) {
  if (!dir) {
    return undefined;
  }

  try {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  catch (err) {
    note('WARNING: could not remove the scratch directory ' + dir + ': ' +
      ((err && err.message) || err));
  }

  return undefined;
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
  var i;
  var arg;

  function value(flag, index) {
    var next = args[index + 1];

    if (next === undefined || next.charAt(0) === '-') {
      throw usageError(flag + ' requires a path');
    }

    return next;
  }

  for (i = 0; i < args.length; i++) {
    arg = args[i];

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
// The environment, published before the first application require
// ---------------------------------------------------------------------------

/**
 * Publishes the environment the application will read, and changes into
 * `appRoot`.
 *
 * Ordering is the whole point of this function. `config` 0.4.37 freezes its
 * values when it is first required, and `lib/util/file.js`, `config/aws.js` and
 * every model reach it, so NODE_CONFIG and NODE_CONFIG_DIR have to be right
 * BEFORE any of them loads. Three layers, lowest first:
 *
 *   1. `test/parity/server-overlay.json`, which is where `db.redis.enabled:
 *      false` and the `aws.buckets.exports` entry committed configuration
 *      lacks come from (AAP 0.6.7, 0.9.3).
 *   2. Whatever NODE_CONFIG was inherited - which, when this runs as a child of
 *      `test/parity/mongo.js`, already carries the published database address
 *      and must therefore win over the overlay's placeholder database name.
 *   3. `db.redis.enabled: false`, forced last. The agent brief requires it in
 *      the composed configuration, and forcing it means an inherited overlay
 *      cannot switch Redis back on and have `lib/util/queues.js` dial
 *      localhost:6379 from inside a storage gate.
 *
 * PARITY_APP_ROOT is what `test/parity/fixtures/aws.js:1786` resolves
 * `config/aws` from, so it is published here rather than left to `process.cwd()`
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

  composed = mongo.deepMerge(composed, { db: { redis: { enabled: false } } });

  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }

  process.env.NODE_CONFIG_PERSIST_ON_CHANGE = mongo.PERSIST_ON_CHANGE;
  process.env.NODE_CONFIG_DIR               = path.join(appRoot, 'config');
  process.env.NODE_CONFIG                   = JSON.stringify(composed);
  process.env.PARITY_APP_ROOT               = appRoot;
  process.env.PARITY_S3_ROOT                = s3Root;

  fs.mkdirSync(s3Root, { recursive: true });

  try {
    process.chdir(appRoot);
  }
  catch (err) {
    throw new ToolError('cannot chdir to ' + appRoot + ': ' + err.message);
  }

  return {
    nodeEnv       : process.env.NODE_ENV,
    nodeConfig    : process.env.NODE_CONFIG,
    nodeConfigDir : process.env.NODE_CONFIG_DIR,
    s3Root        : s3Root
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
 * This matters for exactly one package and for a substantive reason: `adm-zip`
 * is the version whose read surface changed (0.4.16 -> 0.6.0, AAP 0.5.1.2), so
 * the archive cases have to exercise the version the tree under test declares.
 * `archiver` is resolved the same way so that the bytes the cases read were
 * produced by the same writer the application would use.
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
 * THE ORDER IS THE CONTRACT. `lib/util/file.js:11,82,141,197` each do
 * `new aws.S3()`, resolving `AWS.S3` at CALL time from the `config/aws` module
 * object - so the fixture only has to be loaded before the first call, but
 * loading it first is what makes that unconditional rather than a race with
 * whatever else pulls `config/aws` in.
 *
 * THE GLOBAL. `lib/util/file.js:167` does `file = new File()` against an
 * UNDECLARED global that `app.js:317` installs with a bare assignment inside
 * `init()`. A harness that requires `lib/util/file.js` without installing it
 * does NOT get the ReferenceError one would expect, because Node 22 ships its
 * own global `File` - the WHATWG one, writable and configurable, both measured.
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
 * @param {string} appRoot Absolute path, already validated.
 * @returns {Object} The loaded application surface.
 * @throws {ToolError} If the fixture did not patch the namespace.
 */
function loadApplication(appRoot) {
  var awsFixture = require('./fixtures/aws');
  var status     = awsFixture.status();
  var FileModel;
  var FileUtil;

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

  // See THE GLOBAL, above.
  global.File = FileModel;

  FileUtil = requireFromApp(appRoot, 'lib/util/file');

  return {
    appRoot     : appRoot,
    awsFixture  : awsFixture,
    // The application's own `config/aws` module object - the one
    // `lib/util/file.js:4` binds and calls `new aws.S3()` on. Required here so
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
 * Connects every mongoose instance in play, and returns the ones it opened.
 *
 * Normally there is one. `test/parity/seed.js` registers its models on the
 * mongoose it resolves relative to ITSELF, and this file resolves the
 * application's relative to `appRoot`; when both are the same tree - the
 * ordinary case - `require` returns the same cached module and this connects
 * once. When `--app` names a different worktree they are two module instances
 * with two connection pools, so both are dialled at the same URI: the documents
 * seed.js writes and the documents `lib/util/file.js:181` writes then land in
 * the same database and each side can read the other's, which is what the
 * pre-migration cases depend on.
 *
 * `strictQuery` is pinned on every instance for the same reason
 * `config/db.js` pins it: without it Mongoose 6 prints a deprecation warning,
 * and AAP 0.9.3's zero-warning gate covers this tooling's stderr as well as the
 * application's.
 *
 * @param {Array<Object>} instances Mongoose instances, duplicates tolerated.
 * @param {string} uri
 * @returns {Promise<Array<Object>>} The distinct instances now connected.
 */
async function connectAll(instances, uri) {
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
  }

  return distinct;
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
      note('WARNING: disconnect failed: ' + ((err && err.message) || err));
    }
  }

  return undefined;
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

// lib/workers/exports.js:23-35, verbatim.
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
 * `lib/workers/exports.js:354-359`, reimplemented.
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
 * `lib/workers/exports.js:334-352`, reimplemented.
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
 * `lib/workers/exports.js:277-278`, reimplemented: the directory every one of a
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
 * `lib/workers/exports.js:304,308`, reimplemented: the name an asset is stored
 * under.
 *
 * `asset.name` when it has one, otherwise the basename of the url's pathname.
 *
 * `new URL` and NOT `url.parse`: the latter emits DEP0169 on Node 22 and this
 * tooling's stderr is inside AAP 0.9.3's zero-warning gate. The base is what
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
 * `zlib.crc32` landed in Node 22.2.0, and AAP 0.5.3 bounds the runtime at
 * `>=22.0.0 <23.0.0` - so on 22.0 or 22.1 it is absent and a gate that assumed
 * it would fail for a reason that has nothing to do with storage. The fallback
 * is the standard reflected table algorithm, verified against `zlib.crc32` by
 * the `archive-layout` case whenever both are available.
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
 * WHY NOT `entry.getData()`. Measured on an archive this repository's own
 * `archiver` 2.1.1 produces on Node 22: `crc32-stream` 2.0.0's
 * `DeflateCRC32Stream` reports `digest()` 0 and `size()` 0, so zero crc32 and
 * zero uncompressed size are written into the local header, the data descriptor
 * and the central directory alike. `adm-zip` 0.4.16 then returns an EMPTY
 * buffer for every entry - silently, because it trusts the declared size - and
 * `adm-zip` 0.6.0 THROWS 'CRC32 checksum failed', because it validates against
 * the central directory's crc. Neither version can read the contents that way.
 *
 * `entry.getCompressedData()` is adm-zip's own public accessor for the stored
 * bytes and performs no validation, and the COMPRESSED size is the one length
 * the archive states truthfully, so inflating from there recovers the bytes
 * exactly - verified against the input. Integrity is not abandoned: where a
 * declared crc32 is actually present it is checked, and where it is absent that
 * is recorded as the defect it is rather than passed over.
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
    getDataUsable      : true,
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

    record = {
      name           : name,
      isDirectory    : isDirectory,
      method         : method,
      compressedSize : compressed.length,
      declaredCrc    : declaredCrc,
      declaredSize   : entry.header.size,
      size           : content.length,
      content        : content,
      crcVerified    : null
    };

    if (!isDirectory) {
      if (declaredCrc === 0 && entry.header.size === 0 && content.length > 0) {
        // The archiver/crc32-stream defect: the archive states no crc and no
        // uncompressed size, so there is nothing to verify against.
        reader.crcAbsent++;
        reader.defect = 'archiver 2.1.1 via crc32-stream 2.0.0 writes crc32=0 ' +
          'and uncompressed size=0 on Node 22, in the local header, the data ' +
          'descriptor and the central directory alike. adm-zip 0.4.16 returns ' +
          'an empty buffer for such an entry and adm-zip 0.6.0 throws ' +
          'BAD_CRC, so neither version can read the contents through ' +
          'getData(); this reader inflates getCompressedData() instead. A ' +
          'finding for docs/dependency-inventory.md.';
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
 * The adm-zip version actually in use, for the report.
 *
 * Read rather than assumed, because the whole point of the reader notes above is
 * which version's behaviour was observed.
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
 * WHAT IS ASSERTED, and the lines each claim pins:
 *
 *   :252      a top-level `manifest.json`, valid JSON, with `exportedAt`,
 *             `trinkets`, `totalTrinkets` and `failedTrinkets`, and
 *             `trinkets.length === totalTrinkets`.
 *   :277-278  every trinket's entries live under
 *             `<lang>/<sanitizeFolderName(name || shortCode)>_<shortCode>/`.
 *             The directory name is recomputed from the manifest entry through
 *             this file's own sanitizer, so a change to the sanitizer's rules
 *             fails here.
 *   :290      each such directory holds a `metadata.json` whose `shortCode`,
 *             `name` and `lang` match the manifest entry, and whose `url` ends
 *             in `/<lang>/<shortCode>`.
 *   :294-296  the parsed code files, at `<basePath><file.name>`.
 *   :304-308  downloaded assets, at `<basePath>assets/<name || basename>`.
 *   the whole: nothing else. An entry outside `manifest.json` and the manifest's
 *             own trinket directories is a failure, because a stray entry is
 *             how a leaked temporary file or another user's trinket would show
 *             up in an export.
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
    'lib/workers/exports.js:252 appends a top-level manifest.json; the ' +
    'archive holds [' + names.join(', ') + ']'
  );
  assert.strictEqual(
    manifestEntry.isDirectory, false,
    'manifest.json must be a file'
  );

  manifest = JSON.parse(manifestEntry.content.toString('utf8'));

  assert.ok(
    Array.isArray(manifest.trinkets),
    'the manifest\'s `trinkets` must be an array (lib/workers/exports.js:194)'
  );
  assert.strictEqual(
    typeof manifest.exportedAt, 'string',
    'the manifest carries an `exportedAt` timestamp (lib/workers/exports.js:193)'
  );
  assert.ok(
    !isNaN(Date.parse(manifest.exportedAt)),
    '`exportedAt` must parse as a date; got ' + JSON.stringify(manifest.exportedAt)
  );
  assert.strictEqual(
    typeof manifest.totalTrinkets, 'number',
    'the manifest carries `totalTrinkets` (lib/workers/exports.js:250)'
  );
  assert.strictEqual(
    typeof manifest.failedTrinkets, 'number',
    'the manifest carries `failedTrinkets` (lib/workers/exports.js:251)'
  );
  assert.strictEqual(
    manifest.trinkets.length, manifest.totalTrinkets,
    'one manifest entry is pushed per processed trinket ' +
    '(lib/workers/exports.js:225) and `totalTrinkets` is that same counter ' +
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
      'lib/workers/exports.js:290 writes ' + basePath + 'metadata.json; the ' +
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
      '(lib/workers/exports.js:288)');
    assert.ok(
      parsed.url.endsWith('/' + trinket.lang + '/' + trinket.shortCode),
      basePath + 'metadata.json url is config.url + \'/\' + lang + \'/\' + ' +
      'shortCode (lib/workers/exports.js:288); got ' + parsed.url
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
          'lib/workers/exports.js:294-296 writes ' + basePath + file.name +
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
          'lib/workers/exports.js:304-308 writes ' + basePath + 'assets/' +
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
 * and the same options as `lib/workers/exports.js:188` - `archiver('zip',
 * {zlib: {level: 6}})` - so the bytes the reader is asserted against are the
 * bytes the application's writer really emits, including the crc32 defect
 * documented on `readArchiveEntries`. Building with a different writer would
 * have concealed exactly that.
 *
 * @param {Array<{name: string, content: (Buffer|string)}>} entries
 * @param {Object} [options]
 * @param {Function} [options.archiver] A pre-resolved archiver factory.
 * @param {string} [options.appRoot]
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
 * `_fileToContainer` reads only `name`, `host` and `fileId`, and NO configured
 * bucket declares `fileId` - measured across config/default.yaml:394-415, and
 * recorded independently in seed.js's note on KEYS. The `container.fileId`
 * branch at lib/util/file.js:38-40 is therefore unreachable through any public
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
 * `_fileToContainer` is called directly, and legitimately: it is assigned on the
 * instance (lib/util/file.js:22) and is the only entry point that accepts a
 * container, which is what the fileId cases require.
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
 * Asserts the success-shaped result `lib/util/file.js:53-59` produces.
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
// Ordered, and run in order. Each carries the lines it pins so a failure leads
// straight to the contract. Nothing between cases is shared except the store
// and the database, both of which are per-run.

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
    // lib/util/file.js:4 binds config/aws and calls `new aws.S3()` at :11, so
    // THIS is the reference every upload resolves through.
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

      // hashcontents does not unlink; only _fileToContainer:52 does. The
      // runner removes it, so a failure above cannot leave it behind.
      assert.strictEqual(fs.existsSync(source), true,
        'hashcontents must not remove the file it read');
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
    assertFixtureHealthy(ctx, 'upload-parameters');
  }
});

cases.push({
  name : 'key-bare-digest',
  pins : 'lib/util/file.js:26, 32-37',
  run  : async function(ctx) {
    // No dot in the filename, so :26 yields '' and :41 appends nothing.
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

    // The order of the two suffixes is part of the contract: :39 appends the
    // fileId and :42 the extension, so the extension is always last and the
    // key remains recognisable by its file type.
    assert.ok(key.endsWith('.txt'), 'the extension is appended last');
  }
});

cases.push({
  name : 'key-last-dot-extension',
  pins : 'lib/util/file.js:26',
  run  : async function(ctx) {
    // Three dots. :26 uses lastIndexOf, so the extension is 'gz' and not
    // 'tar.gz' - and certainly not 'parity-last'.
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

    // Logged - :49 is `err && console.log(err)`, so the error was reported...
    assert.strictEqual(captured.logged.length, 1,
      'the upload error is logged exactly once at :49');
    assert.strictEqual(captured.logged[0].length, 1,
      'console.log receives the error object alone');
    assert.strictEqual(captured.logged[0][0].code, 'MissingRequiredParameter',
      'the logged value is the S3 error');

    // ...and then discarded. The callback fires with the SUCCESS shape and the
    // upload error never reaches the caller. This is preserved behaviour under
    // R-d, not a defect to repair: a caller cannot distinguish a stored object
    // from a lost one, and every consumer of this callback is written as though
    // the upload succeeded.
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

    // Both outcomes, side by side, because :52 sits OUTSIDE the error check at
    // :49 and a conversion that moved it inside would leave the upload
    // directory filling up only on failures - the slowest possible way to find
    // out.
    assert.strictEqual(fs.existsSync(good.upload.path), false,
      'the temporary file is removed after a successful upload');
    assert.strictEqual(fs.existsSync(bad.value.upload.path), false,
      'the temporary file is removed after a failed upload too');
    assert.strictEqual(bad.logged.length, 1, 'the failure was logged');
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

    // Deliberately no missing-key case here. For an absent key the SDK's read
    // stream emits 'error' and never ends, and :86's `.pipe()` attaches no
    // error listener, so the PassThrough the caller holds neither ends nor
    // errors - the request hangs. That is baseline behaviour with no assertable
    // response, and provoking it would take the harness process down with an
    // unhandled 'error'. The digest-sensitivity negative control is done
    // through downloadUserAsset, which rejects.
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

    // All three types the regexp at :97 admits, because a narrowed regexp would
    // still pass a single-type assertion.
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

      // 'image/pngx' is in the list on purpose: :97's regexp is anchored at
      // both ends, so a trailing character must not sneak through.
      assert.strictEqual(fs.existsSync(source.path), true,
        'the reject returns BEFORE _fileToContainer, so nothing unlinks the ' +
        'temporary file - the caller keeps it. Preserved as measured.'
      );
    }

    assert.strictEqual(callsFor(ctx, 'putObject').length, before,
      'a rejected avatar performs no upload at all');
  }
});

cases.push({
  name       : 'snapshot-exists',
  pins       : 'lib/util/file.js:105-122',
  timeoutMs  : SNAPSHOT_TIMEOUT_MS,
  run        : async function(ctx) {
    var bucket = ctx.config.aws.buckets.snapshots;
    // :108 concatenates `file.path + file.name` with no separator, so the path
    // must carry its own trailing slash. Reproduced rather than corrected.
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

    // The 1000 ms wait at :107 is honoured, not defeated. It is measured
    // because a conversion that dropped the timer would still pass every other
    // assertion here while changing the timing the comment at :106 exists for.
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

    // No callback. :135-139 substitutes `function(err, result) { return result }`
    // - a callback whose return value goes nowhere, so the delete's only
    // evidence is the store itself. The substitution matters because without it
    // the SDK would receive `undefined` and, per its own contract, perform
    // nothing at all.
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
    assertFixtureHealthy(ctx, 'delete-missing-callback');
  }
});

// Fixed File ids for the `replaceFile` cases. Supplied rather than generated so
// `remoteName` - which embeds the document id at lib/util/file.js:178 - is
// predictable end to end and the assertion can be composed from constants
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

    // The naming pattern here is NOT _fileToContainer's. :178 always joins the
    // digest, the document id and the extension with a '-' and a '.', with no
    // conditional on either - so a user asset is keyed differently from a
    // material even for identical bytes.
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

    // uploadUserAsset never unlinks - unlike _fileToContainer:52 - so the
    // caller still owns the temporary file. Measured, and preserved.
    assert.strictEqual(fs.existsSync(source.path), true,
      'uploadUserAsset leaves the temporary file in place');

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
    // Without the shift at :154-157, `cb` would be undefined and :182/:190
    // would throw rather than call anything back - which is why the `callback`
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
    // No owner. The ownable plugin declares `_owner` required, so save()
    // rejects and :182 returns before any upload is attempted.
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
    assert.strictEqual(fs.existsSync(source.path), true,
      'and the temporary file is still the caller\'s');
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
    // well-formed putObject fail, and the ordering at :181 versus :189 is only
    // observable when the upload fails after the save succeeded. Restored in a
    // `finally` so no later case inherits it.
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

    // :190 is `cb(err, file)` - BOTH arguments. A caller that only checks the
    // error still has the document, and a caller that only checks the document
    // never learns the object is missing.
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
  }
});

cases.push({
  name : 'export-key-format',
  pins : 'lib/workers/exports.js:97-104, 366-372, 378',
  run  : async function(ctx) {
    var bucket   = ctx.config.aws.buckets.exports;
    var userId   = seed.ids.user;
    // Composed here from the specification at :97-102, with '0' standing in for
    // Date.now().toString() - the only variable input. Compared against
    // seed.js's independent derivation, so the two agree or the case fails.
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
    // (lib/models/file.js:41 declares alternateIds ['hash'], which
    // lib/models/model.js:117-131 turns into a findOne on that field). This is
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
    // document: the claim is that the url resolves to the key :178 builds.
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
      // read path recomputes a digest (lib/util/file.js:200-202 uses the key
      // verbatim), so a changed object is served without complaint and only a
      // caller that hashes the bytes can tell.
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
  }
});


// ---------------------------------------------------------------------------
// The archive cases
// ---------------------------------------------------------------------------
// Fixed trinket specs covering every branch of lib/workers/exports.js:277-359:
// both code shapes, a name that needs sanitizing, a falsy name, a lang the
// extension map does not know, and a trinket with assets.

var ARCHIVE_EXPORTED_AT = '2024-04-01T00:00:00.000Z';

var ARCHIVE_TRINKETS = Object.freeze([
  {
    // The JSON file-array shape (:337-340): two named files, taken verbatim.
    shortCode : 'AAAAAA',
    name      : 'Parity Python',
    lang      : 'python',
    code      : JSON.stringify([
      { name : 'main.py',   content : 'print("parity")\n' },
      { name : 'helper.py', content : 'VALUE = 1\n' }
    ])
  },
  {
    // The raw-string fallback for a lang MATCHING /blocks/ (:344) -> main.xml,
    // and a name that exercises the sanitizer's strip-then-collapse order.
    shortCode : 'BBBBBB',
    name      : 'Parity  Blocks! (v2)',
    lang      : 'blocks',
    code      : '<xml><block type="parity"/></xml>'
  },
  {
    // A falsy name, so :277 falls back to the shortCode - NOT to 'untitled',
    // which needs both to be falsy - and a lang the extension map does not
    // know, so :343 defaults to '.txt'.
    shortCode : 'CCCCCC',
    name      : '',
    lang      : 'ruby',
    code      : 'puts "parity"\n'
  },
  {
    // Downloaded assets (:304-308), one named and one taking its name from the
    // url's basename.
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

    // :281-290
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

    // :293-296
    parseCodeFiles(trinket).forEach(function(file) {
      entries.push({ name : basePath + file.name, content : file.content || '' });
    });

    // :301-308
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

  // :250-252 - appended LAST, after every trinket, with the counters filled in.
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
  pins : 'lib/workers/exports.js:354-359',
  run  : async function() {
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
      'the name is truncated to 50 characters (:358)'
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
      'collapse happens before truncation (:357 then :358)'
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
      'the base path is lang/sanitized_shortCode/ (:278)'
    );
    assert.strictEqual(
      archiveBasePath({ lang: '', name: '', shortCode: 'ABC123' }),
      'other/ABC123_ABC123/',
      'a falsy lang defaults to "other" and a falsy name falls back to the ' +
      'shortCode (:277-278) - so "untitled" is reachable in the archive only ' +
      'when the name AND the shortCode are both falsy'
    );
    assert.strictEqual(
      archiveBasePath({ lang: 'python', name: '', shortCode: '' }),
      'python/untitled_/',
      'and then it really is "untitled"'
    );
  }
});

cases.push({
  name : 'archive-code-shapes',
  pins : 'lib/workers/exports.js:334-352',
  run  : async function() {
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
    ], 'a JSON array of {name, content} is used as it stands (:337)');

    // The raw-string fallback, per lang.
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'python', code : 'print(1)' }),
      [{ name : 'main.py', content : 'print(1)' }],
      'a non-JSON payload becomes one file named main + the lang extension'
    );
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'blocks', code : '<xml/>' }),
      [{ name : 'main.xml', content : '<xml/>' }],
      'a lang matching /blocks/ names it main.xml (:344)'
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
      'a lang the extension map does not know defaults to .txt (:343)'
    );
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'R', code : 'x <- 1' }),
      [{ name : 'main.R', content : 'x <- 1' }],
      'the extension map is case-sensitive: the lang is `R`, not `r` (:29)'
    );

    // Valid JSON that is not an array takes the SAME fallback, because :338-339
    // throws its own error to get there.
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'python', code : '{"name":"x"}' }),
      [{ name : 'main.py', content : '{"name":"x"}' }],
      'valid JSON that is not an array is treated as a single raw file ' +
      '(:338-340), and its own text becomes the content'
    );
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'python', code : '"a string"' }),
      [{ name : 'main.py', content : '"a string"' }],
      'and so is a JSON scalar'
    );

    // A JSON array of anything at all is accepted without validation. Recorded
    // rather than corrected: :294-296 then appends an entry whose name is
    // `basePath + undefined`, which is a real 2013 quirk and not this file's to
    // repair.
    assert.deepStrictEqual(
      parseCodeFiles({ lang : 'python', code : '["a"]' }),
      ['a'],
      'a JSON array is returned unvalidated (:337-341)'
    );
  }
});

cases.push({
  name : 'archive-layout',
  pins : 'lib/workers/exports.js:252, 277-295, 308',
  run  : async function(ctx) {
    var entries = archiveEntriesForFixtures();
    var bytes   = await buildArchive(entries, { archiver: ctx.archiver });
    var report  = assertArchiveLayout(
      bytes,
      { trinkets : ARCHIVE_TRINKETS, failedTrinkets : 0 },
      { AdmZip : ctx.AdmZip, appRoot : ctx.appRoot }
    );
    var fileEntries = entries.length;
    var probe;

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

    // --- the adm-zip read surface, reported rather than papered over --------
    assert.strictEqual(report.reader.library, 'adm-zip', 'the reader used');
    assert.ok(report.reader.version, 'and its version was read, not assumed');

    if (report.reader.defect) {
      // The measured state of this repository: archiver 2.1.1 via crc32-stream
      // 2.0.0 states no crc and no uncompressed size on Node 22.
      note('archive read surface: ' + report.reader.defect);
      assert.strictEqual(report.reader.getDataUsable, false,
        'if the archive states no crc, adm-zip\'s getData() cannot serve it');

      // Both adm-zip versions fail here, differently, and either failure is
      // evidence for the finding: 0.4.16 returns an empty buffer and 0.6.0
      // throws. Asserting "one of those two" holds whichever is installed.
      probe = (function() {
        var zip = new ctx.AdmZip(bytes);
        var entry = zip.getEntries().filter(function(candidate) {
          return candidate.entryName === 'manifest.json';
        })[0];

        try {
          return { threw : false, length : entry.getData().length };
        }
        catch (err) {
          return { threw : true, message : err.message };
        }
      })();

      assert.ok(
        probe.threw || probe.length === 0,
        'adm-zip ' + report.reader.version + ' must either throw or return ' +
        'nothing for an entry whose declared crc and size are zero; it ' +
        'returned ' + JSON.stringify(probe) + '. If it now returns the real ' +
        'bytes, the writer has been fixed and this branch - and the finding in ' +
        'docs/dependency-inventory.md - should be retired.'
      );
    }
    else {
      // The archive states a crc for every entry, so every entry was verified
      // against it. Both worlds are handled; neither is assumed.
      assert.strictEqual(report.reader.crcAbsent, 0,
        'no entry may be left unverified when the archive states its crc');
      assert.strictEqual(report.reader.crcVerified, fileEntries,
        'every entry\'s declared crc32 was checked');
    }

    ctx.reader = report.reader;

    if (report.reader.defect) {
      ctx.findings.push({
        subject : 'adm-zip / archiver archive read surface',
        detail  : report.reader.defect,
        owner   : 'docs/dependency-inventory.md'
      });
    }
  }
});

cases.push({
  name : 'no-leftover-uploads',
  pins : 'lib/util/file.js:52',
  run  : async function(ctx) {
    // Everything the cases wrote into the scratch root should be gone by now:
    // either the application unlinked it at :52 or the case that owns it
    // removed it. Only the two directories this harness created on purpose
    // remain - the S3 store and the snapshot source directory - and both go
    // with the scratch root at the end of the run.
    var remaining = fs.readdirSync(ctx.scratch).filter(function(entry) {
      return entry !== 's3' && entry !== 'snapshots';
    });

    assert.deepStrictEqual(remaining, [],
      'the scratch directory must hold no leftover upload files; found [' +
      remaining.join(', ') + ']. A survivor means either :52 stopped running ' +
      'or a case that owns its temporary file stopped removing it.'
    );
  }
});


// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

/**
 * Runs one case with a ceiling.
 *
 * The ceiling is a race rather than a wrapper around the assertions, because
 * the failure it exists for is a lifecycle that never settles - and no
 * assertion inside such a case ever runs. The timer is unref'd so a completed
 * run is never held open by it.
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

  try {
    await Promise.race([
      testCase.run(ctx),
      new Promise(function(resolve, reject) {
        timer = setTimeout(function() {
          reject(new Error(
            'the case did not finish within ' + limit + ' ms'
          ));
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
        note('WARNING: could not remove ' + target + ': ' +
          ((err && err.message) || err));
      }
    });
  }

  record.durationMs = Date.now() - started;

  return record;
}

/**
 * Collects every process warning raised while `body` runs.
 *
 * AAP 0.9.3's gate is that the run emits no warning attributable to the
 * application's own source or to any dependency the plan retains, and the agent
 * brief for this file asks for it to be run under `--pending-deprecation
 * --trace-deprecation` and confirmed to contribute nothing of its own. Reading
 * that off a terminal is not evidence, so the warnings are captured into the
 * artifact WITH their origin - the frame that raised them - and reported as
 * findings.
 *
 * The listener is added, not substituted: Node's own handler still prints, so
 * nothing is suppressed and a warning stays as visible as it was. It is removed
 * in a `finally` so a caller that requires this module does not inherit it.
 *
 * `--pending-deprecation` matters here. DEP0005 - `new Buffer()` - is a PENDING
 * deprecation, silent without that flag, and this is the one measurement that
 * makes it visible: `archiver` 2.1.1 reaches it through `compress-commons`
 * 1.2.2, and `lib/workers/exports.js:11` requires `archiver`, so the worker
 * emits it too. That is a finding about a retained dependency, not about this
 * harness.
 *
 * @param {function(): Promise<*>} body
 * @returns {Promise<{value: *, warnings: Array<Object>}>}
 */
async function captureWarnings(body) {
  var warnings = [];
  var value;

  function onWarning(warning) {
    var frames = ((warning && warning.stack) || '')
      .split('\n')
      .filter(function(line) { return /^\s+at /.test(line); })
      .map(function(line) { return line.trim(); })
      // Node's own frames are dropped, and not for brevity: a flagged
      // deprecation is RAISED inside node - DEP0005's top two frames are
      // `showFlaggedDeprecation` and `new Buffer`, both `node:buffer` - so
      // keeping them would attribute every such warning to Node and hide the
      // module that actually called the deprecated API. Measured: attributing
      // from the unfiltered top two frames reported 'unknown' for a warning
      // whose real origin is compress-commons.
      .filter(function(line) {
        return !/^at node:/.test(line) && !/\(node:/.test(line);
      });

    warnings.push({
      name    : warning && warning.name,
      code    : warning && warning.code,
      message : warning && warning.message,
      // The first three caller frames are enough to attribute it, and keeping
      // the whole stack out of the artifact keeps a diff of two runs readable.
      origin  : frames.slice(0, 3)
    });
  }

  process.on('warning', onWarning);

  try {
    value = await body();
  }
  finally {
    process.removeListener('warning', onWarning);
  }

  return { value: value, warnings: warnings };
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
 * @param {Object} ctx
 * @returns {Promise<Array<Object>>}
 */
async function runCases(ctx) {
  var results = [];
  var i;
  var record;

  for (i = 0; i < cases.length; i++) {
    record = await runCase(cases[i], ctx);
    results.push(record);

    if (record.status === 'passed') {
      note('ok   ' + record.name + ' (' + record.durationMs + ' ms)');
    }
    else {
      note('FAIL ' + record.name + ' (' + record.durationMs + ' ms): ' +
        record.error);
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
    note('WARNING: could not remove the documents the cases created: ' +
      ((err && err.message) || err));
    return 0;
  }
}

/**
 * Loads the application, connects, seeds and runs the cases.
 *
 * Separated from `run` so that the database lifecycle - started here or
 * inherited from `test/parity/mongo.js` - is decided in exactly one place.
 *
 * @param {string} appRoot
 * @param {string} scratch
 * @param {Object} env From prepareEnvironment.
 * @param {string} uri
 * @returns {Promise<Object>} The result.
 */
async function execute(appRoot, scratch, env, uri) {
  var app       = loadApplication(appRoot);
  var connected = await connectAll([mongoose, app.appMongoose], uri);
  var ctx;
  var results;
  var prepared;
  var removed = 0;

  try {
    prepared = await prepare(app);

    ctx = {
      appRoot        : appRoot,
      scratch        : scratch,
      awsFixture     : app.awsFixture,
      awsModule      : app.awsModule,
      FileUtil       : app.FileUtil,
      FileModel      : app.FileModel,
      config         : app.config,
      appMongoose    : app.appMongoose,
      AdmZip         : app.AdmZip,
      archiver       : app.archiver,
      createdFileIds : [],
      harnessOwned   : [],
      findings       : [],
      reader         : null
    };

    results = await runCases(ctx);
  }
  finally {
    if (ctx) {
      removed = await cleanupDocuments(ctx);
    }

    // Unpatched before the process ends, so a require of this module inside a
    // longer-lived process cannot leave the genuine SDK swapped out.
    app.awsFixture.restore();
    await disconnectAll(connected);
  }

  return {
    tool     : 'test/parity/storage.js',
    appRoot  : appRoot,
    nodeEnv  : env.nodeEnv,
    node     : process.version,
    uri      : uri,
    seeded   : prepared,
    versions : {
      admZip   : readAdmZipVersion(appRoot),
      archiver : readPackageVersion(appRoot, 'archiver')
    },
    reader          : ctx.reader,
    findings        : ctx.findings,
    documentsRemoved: removed,
    total           : results.length,
    passed          : results.filter(function(r) { return r.status === 'passed'; }).length,
    failed          : results.filter(function(r) { return r.status === 'failed'; }).length,
    cases           : results
  };
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
 * @param {Object} [options]
 * @param {string} [options.appRoot]
 * @returns {Promise<Object>} The result.
 */
async function run(options) {
  var opts    = options || {};
  var appRoot = opts.appRoot ? path.resolve(opts.appRoot) : TOOL_ROOT;
  var scratch;
  var env;
  var captured;
  var result;

  assertAppRoot(appRoot);

  scratch = createScratch();

  try {
    env = prepareEnvironment(appRoot, scratch);

    note('tree under test ' + appRoot + ' (NODE_ENV=' + env.nodeEnv + ')');

    captured = await captureWarnings(async function() {
      if (process.env.PARITY_MONGO_URI) {
        note('using the MongoDB already published at ' +
          process.env.PARITY_MONGO_URI);

        return await execute(
          appRoot, scratch, env, process.env.PARITY_MONGO_URI
        );
      }

      return await mongo.withMongo(async function(info) {
        // mongo.js composed this from the environment published above plus the
        // overlay plus the address, and the address must win - so the composed
        // value replaces what prepareEnvironment set, before `config` is first
        // required inside execute().
        process.env.NODE_CONFIG = info.nodeConfig;

        return await execute(appRoot, scratch, env, info.uri);
      }, { overlay : mongo.readOverlay(mongo.DEFAULT_OVERLAY) });
    });

    result = captured.value;

    result.warnings = captured.warnings.map(function(warning) {
      warning.attribution = attributeWarning(warning);
      return warning;
    });

    // A warning raised by this harness's own source is a defect in this file -
    // the brief is explicit that one would be a real finding, having measured
    // that lib/util/file.js:52 and :108 emit nothing on Node 22. A warning from
    // a dependency is a finding about that dependency, and belongs in the
    // inventory rather than in a stack trace nobody re-reads.
    result.warnings.forEach(function(warning) {
      result.findings.push({
        subject : (warning.code || warning.name || 'warning') + ' from the ' +
                  warning.attribution,
        detail  : warning.message + ' (' + (warning.origin[0] || 'origin unknown') + ')',
        owner   : warning.attribution === 'dependency'
          ? 'docs/dependency-inventory.md'
          : 'test/parity/storage.js'
      });
    });

    return result;
  }
  finally {
    removeScratch(scratch);
  }
}


// ---------------------------------------------------------------------------
// Direct execution
// ---------------------------------------------------------------------------

/**
 * Writes the result where it belongs.
 *
 * With `--out` the artifact goes to that file and stdout stays empty; without
 * it the artifact IS stdout. Either way nothing human-readable reaches stdout,
 * because AAP 0.9.1 requires an artifact stream that application side effects
 * cannot contaminate - and loading the controllers to reach this point prints
 * an AWS SDK maintenance notice and a queue line that would otherwise be mixed
 * into it.
 *
 * @param {Object} result
 * @param {(string|null)} out
 * @returns {undefined}
 */
function emit(result, out) {
  var rendered = JSON.stringify(result, null, 2) + '\n';

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, rendered);
    note('result written to ' + out);
    return undefined;
  }

  process.stdout.write(rendered);

  return undefined;
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

  emit(result, options.out);

  note(result.passed + ' of ' + result.total + ' cases passed');

  if (result.findings.length) {
    result.findings.forEach(function(finding) {
      note('FINDING (' + finding.owner + '): ' + finding.subject);
    });
  }

  if (result.failed) {
    note(result.failed + ' case(s) failed');
    return EXIT_ERROR;
  }

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

  // The harness.
  cases : cases,
  run   : run,
  main  : main,

  // Building blocks, exported because each has a failure mode worth testing
  // directly rather than only through a full run.
  parseArguments : parseArguments,
  assertAppRoot  : assertAppRoot,
  ToolError      : ToolError,
  USAGE          : USAGE,
  EXIT_OK        : EXIT_OK,
  EXIT_ERROR     : EXIT_ERROR,
  EXIT_USAGE     : EXIT_USAGE
};

if (require.main === module) {
  main()
    .then(function(code) {
      process.exitCode = code;
    })
    .catch(function(err) {
      note('ERROR: ' + ((err && err.message) || String(err)));

      if (err && err.stack) {
        process.stderr.write(err.stack + '\n');
      }

      process.exitCode = EXIT_ERROR;
    });
}
