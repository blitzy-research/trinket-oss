#!/usr/bin/env node
'use strict';

// Fixed-`_id` fixtures for the parity harnesses.
//
// This module exists for one reason, and it is a comparison strategy rather
// than a convenience: AAP 0.9.3 compares baseline and target responses
// EXACTLY - status, Location, Set-Cookie attributes, rendered HTML, JSON
// scalars - and normalizes away only an enumerated volatile set. Every
// identifier that is fixed here is an identifier `test/parity/replay.js` can
// compare instead of scrub, so each entry below removes a member from that set.
// A generated id, shortCode, hash or slug would have to be added back to it,
// and a widened volatile set is a weakened gate that would owe an explanation
// in `docs/baseline-parity.md`.
//
// ===========================================================================
// RULES
// ===========================================================================
// `review_rules` returns exactly "No user rules provided." for this project,
// which AAP 0.7 and 0.10.1 independently record. No rules are invented here and
// their absence is not read as licence to lower the bar - enterprise practice
// governs. The request's own RULES block is binding and is not that document:
//
//   R-a  The diff must read as migration work only. This file adds fixtures and
//        nothing else: it starts no server, connects nothing, writes no file,
//        touches no configuration and changes no application module.
//   R-b  No module excluded. The fixtures cover every model the 233-route
//        surface addresses through a path segment, so no route is unreachable
//        for want of a document to point at.
//   R-d  Behaviour improvements are prohibited. Fixtures are shaped to make
//        baseline quirks REACHABLE - the never-settling image download branch,
//        the queryless folder filter, the expired export - never to avoid them.
//   R-f  Baseline observed behaviour at 2f8712a is the tie-breaker, so the same
//        seed must load against the BASELINE worktree's model code as well as
//        the target's. Only model APIs present in both are used: constructor,
//        `save()`, `setOwner`, `setGlobalSettings`, `setRoles`, `findById`, and
//        the private collection through `mongoose.model(name)`. Nothing here
//        depends on a change this migration makes.
//
// ===========================================================================
// THE BOUNDARY THAT MUST NOT MOVE
// ===========================================================================
// `db.js` under `test/helpers` has a `reset` (:26-32) that does nothing but
// `dropDatabase`, and a `checkState` (:50) that drops again on first ready. The
// serial suite DEPENDS on that emptiness: `registration.js` under
// `test/lib/api` asserts the default user is absent and then creates it, and
// `admin.js` beside it creates its own admin. Seeding from inside that `reset`
// would break both, which is why this seeder is a separately named module used
// only by `capture.js`, `replay.js`, `storage.js` and `worker.js` in this
// directory, and why `reset()` here deletes only the documents in the eight
// collections this file owns and NEVER drops a database.
//
// Nothing under `test/helpers` or `test/lib` is required from here. That
// directory's `db.js` requires `config/db` at :2, which calls
// `mongoose.connect()` at module scope; its `defaults.js` is a PATTERN
// reference only - its identity values are copied verbatim into IDENTITIES
// below so that "seeded normal user" and "seeded admin" mean the same accounts
// the suite uses, but they are declared locally and carry fixed ids.
//
// Those two paths are written unjoined throughout this file on purpose. The
// independence proof for this module is mechanical - a recursive grep of this
// file for a joined helper path must return nothing - and a path quoted in a
// comment would satisfy that pattern while proving nothing about what the file
// requires. Keep the directory and the filename in separate spans.
//
// ===========================================================================
// ORDERING - why the models are loaded LAZILY
// ===========================================================================
// Requiring a model pulls in `config` (npm `config` 0.4.37 resolves and FREEZES
// on first require) and `lib/util/store`, which reads `db.redis.enabled` at its
// own module scope. A module-scope model require here would therefore fix the
// configuration at the moment ANY caller required this file - including a
// caller that wanted nothing but the `ids` map to materialize wildcard paths,
// before `test/parity/mongo.js` had published the database address. So the
// models are resolved inside `loadModels()`, on first use, and requiring this
// module reads no configuration, opens no socket and registers no schema.
//
// The mongoose connection is taken as ALREADY ESTABLISHED: `test/parity/mongo.js`
// owns the lifecycle and the application's own `config/db.js` owns the connect.
// `seed()` asserts a usable connection and says which of the two is missing
// rather than dialing one itself - a seeder that connected would be a second
// place the database address is decided.
//
// ===========================================================================
// DETERMINISM, AND THE THREE FIELDS THAT CANNOT BE FIXED
// ===========================================================================
// Every id, shortCode, hash, slug, digest, key, filename and expiry below is
// fixed or is a pure function of a fixed value. No `Math.random`, no
// `Date.now`, no `new ObjectId()`, no `url.parse` (DEP0169 - this tooling's
// stderr is inside the zero-warning gate's stream; `new URL` is used instead).
//
// Three fields are written by the models themselves and are NOT fixable from
// here, so they stay in replay.js's enumerated volatile set:
//   * `lastUpdated`  - `lib/models/plugins/timestamps.js` assigns `Date.now()`
//                      on every save of a modified document, unconditionally.
//   * `codeLastUpdated` - `lib/models/trinket.js:109` assigns `Date.now()`
//                      whenever `code`, `assets` or `settings` is modified.
//                      Not in the trinket publicSpec.
//   * bcrypt `password` hash - salted per save by design, and never serialized.
// `created` IS fixed: the timestamps plugin only defaults it when null, so an
// explicit value survives. Every fixture therefore carries one.
//
// ===========================================================================
// API
// ===========================================================================
//   ids                  frozen map of every fixed identifier
//   credentials          frozen login literals per seeded identity
//   fixtures             frozen, configuration-INDEPENDENT fixture facts
//                        (bytes, digests, sizes, keys, shortCodes, payloads)
//   GROUPS               the selectable group names, in dependency order
//   seed(options)        idempotent; async; returns a summary
//   reset(options)       deletes only this seeder's collections; async
//   storage()            resolved bucket/key/url descriptors (reads config)
//   s3Manifest()         a seed manifest for test/parity/fixtures/aws.js
//   keyFromUrl(url)      the object key a stored url resolves to
//
// ===========================================================================
// INVOCATION
// ===========================================================================
// As a module, inside a harness that already has a connection:
//
//   var seed = require('./seed');
//   await seed.seed();                       // everything
//   await seed.seed({ users: true, files: true });   // storage.js
//
// Standalone, as a self-check that proves the fixtures load and satisfy every
// assertion AAP 0.9.2 and 0.6.7 name - it starts its own in-memory MongoDB
// through `test/parity/mongo.js`, so it re-implements no lifecycle:
//
//   node test/parity/seed.js --verify
//
// Every human-readable byte goes to STDERR, because sibling tools capture
// stdout as an artifact.

var crypto   = require('crypto');
var mongoose = require('mongoose');

// The lifecycle owner. Requiring it starts NOTHING - its `main` runs only under
// direct execution - and it is used here solely by the `--verify` self-check,
// which borrows `withMongo` rather than duplicating the provisioning it owns.
var mongo = require('./mongo');

// Everything this file prints carries this prefix, so its lines are
// unmistakably fixture output inside a stream that also carries a server's.
var LOG_PREFIX = '[parity:seed] ';

// A model name -> module path map, resolved lazily by loadModels(). The keys
// are the mongoose model names, which is what `mongoose.model()` and therefore
// `reset()` address; note the trinket model is registered as 'Snippet'
// (lib/models/trinket.js:584), a 2013 name the migration does not touch.
var MODEL_MODULES = {
  User     : '../../lib/models/user',
  Snippet  : '../../lib/models/trinket',
  Course   : '../../lib/models/course',
  Lesson   : '../../lib/models/lesson',
  Material : '../../lib/models/material',
  File     : '../../lib/models/file',
  Folder   : '../../lib/models/folder',
  Export   : '../../lib/models/export'
};

// ---------------------------------------------------------------------------
// Fixed identifiers
// ---------------------------------------------------------------------------
// Valid 24-character hex, and deliberately synthetic so a reviewer reading a
// captured response can tell a seeded id from a generated one at a glance. The
// blocks are: 01 users, 02 trinkets, 03 course/lesson/material, 04 folders,
// 05 files, 06 exports. Within a block, `ff` is reserved for an id that belongs
// to NO document - the absence is the fixture.
var ids = Object.freeze({
  // 01 - identities. `missingUser` is planted in a session by capture.js to
  // reach app.js:255-259 ("User not found", session cleared); `disabledUser`
  // reaches app.js:261-264 ("Account disabled", session cleared). Two of the
  // five auth-scheme outcomes AAP 0.9.3 requires are unreachable without them.
  user         : '000000000000000000000101',
  admin        : '000000000000000000000102',
  disabledUser : '000000000000000000000103',
  missingUser  : '0000000000000000000001ff',

  // 02 - trinkets. Both code shapes `lib/workers/exports.js:334-352` branches
  // on are represented, across several of the 11 langs in config/constants.js.
  trinketPython      : '000000000000000000000201',
  trinketPython3     : '000000000000000000000202',
  trinketHtml        : '000000000000000000000203',
  trinketBlocks      : '000000000000000000000204',
  trinketR           : '000000000000000000000205',
  trinketWithAssets  : '000000000000000000000206',
  trinketAdmin       : '000000000000000000000207',
  missingTrinket     : '0000000000000000000002ff',

  // 03 - the course tree. `/api/courses/{courseId}/lessons/{lessonId}/
  // materials/{materialId}/...` is the largest single route family in the 233,
  // and every one of them needs concrete path segments.
  course           : '000000000000000000000301',
  lesson           : '000000000000000000000311',
  lessonDraft      : '000000000000000000000312',
  material         : '000000000000000000000321',
  materialAssignment : '000000000000000000000322',
  missingCourse    : '0000000000000000000003ff',

  // 04 - folders. Required by the `folders.trinkets` quirk case, which must be
  // driven BOTH with and without a query string (AAP 0.6.4).
  folder        : '000000000000000000000401',
  missingFolder : '0000000000000000000004ff',

  // 05 - files. Four documents covering both key-naming patterns in
  // lib/util/file.js plus the extension-whitelist override and one legacy
  // record whose `type` carries a mime-like string.
  file            : '000000000000000000000501',
  notebookFile    : '000000000000000000000502',
  userAssetFile   : '000000000000000000000503',
  legacyImageFile : '000000000000000000000504',
  missingFile     : '0000000000000000000005ff',

  // 06 - exports. Three states, because `lib/controllers/users.js:1291-1296`
  // distinguishes not-completed from expired and each is a separate edge.
  exportPending   : '000000000000000000000601',
  exportCompleted : '000000000000000000000602',
  exportExpired   : '000000000000000000000603',
  missingExport   : '0000000000000000000006ff'
});

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------
// Values copied verbatim from `defaults.js:13-30` under `test/helpers` so a
// seeded identity is the same account the existing suite means, declared
// locally because that file must not be required (see THE BOUNDARY, above).
//
// The passwords are fixture literals, not credentials: they are already
// committed in that same `defaults.js` and authenticate against nothing but an
// in-memory database created for the run.
//
// The admin's `roles` array is reproduced exactly as the suite writes it
// (`admin.js:11-12` under `test/lib/api` does `new User(defaults.admin)`), which means
// a raw role with no `permissions` - `hasRole('admin')` is true, which is the
// predicate `lib/util/helpers.js:22` and `app.js:261` actually use, and
// `hasPermission` is false. That asymmetry is baseline and is preserved.
var IDENTITIES = Object.freeze({
  user : Object.freeze({
    _id      : ids.user,
    fullname : 'test user',
    username : 'testing',
    email    : 'test@dummy.com',
    password : 'bacon'
  }),

  admin : Object.freeze({
    _id      : ids.admin,
    fullname : 'admin user',
    username : 'administrator',
    email    : 'admin@example.com',
    password : 'fakin',
    roles    : [{ context : 'site', roles : ['admin'] }]
  }),

  // Not in defaults.js: the disabled outcome has no fixture in the existing
  // suite. `roles` carries 'user' as well as 'disabled' so the account is a
  // normal user that has been disabled rather than a role-less anomaly, which
  // is what the site's own admin disable action produces.
  disabled : Object.freeze({
    _id      : ids.disabledUser,
    fullname : 'disabled user',
    username : 'disableduser',
    email    : 'disabled@example.com',
    password : 'disabled-fixture-password',
    roles    : [{ context : 'site', roles : ['user', 'disabled'] }]
  })
});

// ---------------------------------------------------------------------------
// Fixed dates
// ---------------------------------------------------------------------------
// One `created` per document, so the field is exactly comparable. Distinct
// values rather than one shared constant, because several routes sort on
// `created` (`lib/models/user.js:144` sorts '-created', and the trinket lists
// page by it) and identical timestamps would make that ordering arbitrary.
//
// The completed export expires in 2099 and the expired one in 2020. A relative
// date ("now + 3 days", which `lib/workers/exports.js:140-141` computes) would
// be correct-looking and useless: `expiresAt` is serialized into the response
// at `lib/controllers/users.js:1245`, so a moving value would have to be
// normalized away. A fixed far-future date is both comparable and permanently
// on the right side of the `expiresAt > new Date()` test at :1229 and :1293.
var DATES = Object.freeze({
  user             : '2024-01-01T00:00:00.000Z',
  admin            : '2024-01-01T00:01:00.000Z',
  disabledUser     : '2024-01-01T00:02:00.000Z',
  trinketPython    : '2024-02-01T00:00:00.000Z',
  trinketPython3   : '2024-02-02T00:00:00.000Z',
  trinketHtml      : '2024-02-03T00:00:00.000Z',
  trinketBlocks    : '2024-02-04T00:00:00.000Z',
  trinketR         : '2024-02-05T00:00:00.000Z',
  trinketWithAssets: '2024-02-06T00:00:00.000Z',
  trinketAdmin     : '2024-02-07T00:00:00.000Z',
  course           : '2024-03-01T00:00:00.000Z',
  lesson           : '2024-03-02T00:00:00.000Z',
  lessonDraft      : '2024-03-03T00:00:00.000Z',
  material         : '2024-03-04T00:00:00.000Z',
  materialAssignment : '2024-03-05T00:00:00.000Z',
  folder           : '2024-04-01T00:00:00.000Z',
  file             : '2024-05-01T00:00:00.000Z',
  notebookFile     : '2024-05-02T00:00:00.000Z',
  userAssetFile    : '2024-05-03T00:00:00.000Z',
  legacyImageFile  : '2024-05-04T00:00:00.000Z',
  exportPending    : '2024-06-01T00:00:00.000Z',
  exportCompleted  : '2024-06-02T00:00:00.000Z',
  exportExpired    : '2024-06-03T00:00:00.000Z',

  // Assignment dates on the seeded material. Fixed and in the past/future
  // respectively so `lib/models/material.js:111-116` `isVisible()` returns a
  // stable answer: available since 2024, hidden after 2099, therefore visible.
  materialAvailableOn : '2024-03-05T00:00:00.000Z',
  materialDueOn       : '2099-01-01T00:00:00.000Z',
  materialHideAfter   : '2099-06-01T00:00:00.000Z',

  exportCompletedExpiresAt : '2099-01-01T00:00:00.000Z',
  exportExpiredExpiresAt   : '2020-01-01T00:00:00.000Z'
});

// ---------------------------------------------------------------------------
// Stored object bytes
// ---------------------------------------------------------------------------
// Five fixed payloads. Their sha1 digests ARE the S3 keys, because
// `lib/util/file.js:32-43` and :159-178 name every stored object after the
// digest of its own contents. AAP 0.6.7 states the consequence: a change to the
// digest silently orphans every stored object, with no error and only files
// that cannot be found - and that is invisible unless a seeded record points at
// an object written BEFORE the migration, which is what these are.
//
// The bytes are inline rather than read from `test/data/**` so that the digest
// cannot drift with a file this plan does not own, and each payload is a valid
// instance of its format (verified by signature in the self-check) so nothing
// downstream has to special-case a fixture.

// 105 bytes of plain text - the ordinary material-upload case.
var MATERIAL_TEXT = Buffer.from(
  'Parity fixture material file.\n' +
  'Seeded before the migration so a changed digest surfaces as a lookup miss.\n',
  'utf8'
);

// A minimal but structurally valid Jupyter notebook. The extension matters
// more than the contents: `ipynb` is the ONLY entry in
// `config/default.yaml:236-237` extensionWhitelist, so this payload is the one
// that exercises the content-type override branch at `lib/util/file.js:28-30`.
// Written as an explicit literal, not JSON.stringify output, so the bytes -
// and therefore the digest - are readable in this file.
var NOTEBOOK_JSON = Buffer.from(
  '{\n' +
  '  "cells": [\n' +
  '    {\n' +
  '      "cell_type": "code",\n' +
  '      "execution_count": null,\n' +
  '      "metadata": {},\n' +
  '      "outputs": [],\n' +
  '      "source": ["print(\\"parity\\")\\n"]\n' +
  '    }\n' +
  '  ],\n' +
  '  "metadata": {\n' +
  '    "kernelspec": {\n' +
  '      "display_name": "Python 3",\n' +
  '      "language": "python",\n' +
  '      "name": "python3"\n' +
  '    }\n' +
  '  },\n' +
  '  "nbformat": 4,\n' +
  '  "nbformat_minor": 4\n' +
  '}\n',
  'utf8'
);

// The 1x1 transparent GIF89a - 42 bytes, the smallest payload that is still a
// real image. Backs the user asset an embedded trinket references.
var ASSET_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// A 1x1 PNG - 69 bytes, complete with IEND. Backs the LEGACY file record whose
// `type` carries a mime-like string, which is the only way into the image
// branch of `lib/controllers/files.js:153-173` (AAP 0.7's approved deviation:
// baseline never settled that branch, the target serves the stream).
var LEGACY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/AAAADAAEAAQD6AAAAAElFTkSuQmCC',
  'base64'
);

// An empty ZIP: the 22-byte end-of-central-directory record and nothing else.
// A real archive would be unpackable but not fixed, since `archiver` writes
// timestamps into every entry. This is a valid archive that reads as empty,
// which is what a download-path fixture needs.
var EXPORT_ZIP = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x05, 0x06]),
  Buffer.alloc(18)
]);

/**
 * The digest `lib/util/file.js:66-78` computes, over a buffer instead of a
 * stream. The algorithm is identical - `crypto.createHash('sha1')`, hex - and
 * the self-check proves it agrees with the streaming implementation.
 *
 * @param {Buffer} buffer
 * @returns {string} 40-character lowercase hex
 */
function sha1Hex(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

// Derived, then checked against the value measured when these payloads were
// chosen. Deriving alone would make the digest whatever the bytes happen to be,
// so a stray edit to a payload would silently re-key every stored object;
// asserting against a committed constant turns that into a load-time failure
// naming both values. This is the guard AAP 0.6.7 asks for, applied to the
// fixtures themselves.
var DIGESTS = Object.freeze({
  materialText : sha1Hex(MATERIAL_TEXT),
  notebook     : sha1Hex(NOTEBOOK_JSON),
  assetGif     : sha1Hex(ASSET_GIF),
  legacyPng    : sha1Hex(LEGACY_PNG),
  exportZip    : sha1Hex(EXPORT_ZIP)
});

var EXPECTED_DIGESTS = Object.freeze({
  materialText : '5d9f824c6e90f8b80a2156c3300263bc92b08653',
  notebook     : '7bc78084f9f965079d5047873879b8bdf76dab07',
  assetGif     : 'd5fceb6532643d0d84ffe09c40c481ecdf59e15a',
  legacyPng    : '309a9fdfaa34a9b5b4872f5fbd743eb8e596f1fd',
  exportZip    : 'b04f3ee8f5e43fa3b162981b50bb72fe1acabb33'
});

// Load-time, not test-time: a wrong digest must not reach a harness at all,
// because everything it keys - object names, file urls, the manifest handed to
// the S3 fixture - would be consistently wrong and would therefore still
// "pass" any comparison of the fixtures against themselves.
Object.keys(EXPECTED_DIGESTS).forEach(function(name) {
  if (DIGESTS[name] !== EXPECTED_DIGESTS[name]) {
    throw new Error(
      LOG_PREFIX + 'fixture payload `' + name + '` no longer hashes to its ' +
      'committed digest: expected ' + EXPECTED_DIGESTS[name] + ', computed ' +
      DIGESTS[name] + '. The digest IS the stored object key ' +
      '(lib/util/file.js:32-43), so changing the bytes re-keys every seeded ' +
      'object and orphans the pre-migration ones. Update both together, and ' +
      'the corpus with them.'
    );
  }
});

// ---------------------------------------------------------------------------
// Stored object keys
// ---------------------------------------------------------------------------
// Both naming patterns in `lib/util/file.js`, reproduced exactly:
//
//   _fileToContainer (:32-43)  digest [+ '-' + container.fileId] [+ '.' + ext]
//   uploadUserAsset  (:178)    digest + '-' + file.id + '.' + extension
//
// The `container.fileId` branch has no configuration that reaches it - no
// `config.aws.buckets.*` entry declares `fileId` - so no seeded File document
// corresponds to `materialWithFileId`. It is stored anyway, with the file id
// that makes it traceable, so `test/parity/storage.js` can assert the naming by
// passing a container that carries one instead of asserting against a shape
// nothing has ever written.
var KEYS = Object.freeze({
  // materials bucket, no fileId, extension present - what `files.upload`
  // produces today (lib/controllers/files.js:67 -> uploadMaterialFile).
  materialText       : DIGESTS.materialText + '.txt',
  materialWithFileId : DIGESTS.materialText + '-' + ids.file + '.txt',

  // materials bucket, the extension-whitelist override case.
  notebook           : DIGESTS.notebook + '.ipynb',

  // materials bucket, the legacy image record.
  legacyPng          : DIGESTS.legacyPng + '.png',

  // userassets bucket, the uploadUserAsset pattern.
  userAsset          : DIGESTS.assetGif + '-' + ids.userAssetFile + '.gif'
});

// ---------------------------------------------------------------------------
// The export archive
// ---------------------------------------------------------------------------
// `lib/workers/exports.js:97-104` builds the filename from
// sha1(userId + Date.now()).substring(0, 12) and the key from
// 'exports/' + userId + '/' + filename. The timestamp is the only variable
// part, so substituting a fixed one yields a filename of exactly the real
// shape - 12 hex characters - that is also reproducible. '0' is the substitute,
// recorded here rather than hidden in a constant so the derivation is checkable
// by hand: sha1('000000000000000000000101' + '0').substring(0, 12).
var EXPORT_TIMESTAMP_SUBSTITUTE = '0';
var EXPORT_EXPIRED_TIMESTAMP_SUBSTITUTE = '1';

/**
 * `lib/workers/exports.js:97-102`, with the timestamp supplied instead of read
 * from the clock. Same algorithm, same 12-character hex substring, same
 * 'trinket-export-<hash>.zip' shape.
 *
 * @param {string} userId
 * @param {string} substitute stands in for `Date.now().toString()`
 * @returns {string}
 */
function exportFilename(userId, substitute) {
  return 'trinket-export-' +
    crypto.createHash('sha1')
      .update(userId + substitute)
      .digest('hex')
      .substring(0, 12) +
    '.zip';
}

var EXPORT_FILENAME = exportFilename(ids.user, EXPORT_TIMESTAMP_SUBSTITUTE);
var EXPORT_S3_KEY   = 'exports/' + ids.user + '/' + EXPORT_FILENAME;

// The expired export gets its own key and NO stored object, deliberately:
// `lib/controllers/users.js:1293-1296` rejects on the expiry check BEFORE it
// reaches `getSignedUrl`, so an object behind this key would never be read and
// seeding one would imply a path that is not taken.
var EXPORT_EXPIRED_FILENAME = exportFilename(ids.user, EXPORT_EXPIRED_TIMESTAMP_SUBSTITUTE);
var EXPORT_EXPIRED_S3_KEY   = 'exports/' + ids.user + '/' + EXPORT_EXPIRED_FILENAME;

// ---------------------------------------------------------------------------
// Trinket code payloads
// ---------------------------------------------------------------------------
// `lib/workers/exports.js:334-352` - reproduced at
// `lib/controllers/trinket.js:1216-1240` - decides between a multi-file and a
// single-file trinket by JSON.parse'ing `code` and checking for an Array. Both
// sides of that branch are seeded, or the worker and download scenarios would
// only ever exercise one of them:
//
//   JSON array of {name, content}  -> the files are written as named
//   anything else (including valid non-array JSON) -> one 'main<ext>' file,
//                                     with 'main.xml' for any /blocks/ lang
//
// The JSON payloads are written as literals rather than JSON.stringify output
// so the stored bytes are exactly what is read here.
var CODE = Object.freeze({
  // Raw, non-JSON. `lib/models/trinket.js:103-106` scans python and console
  // code for imports, so `modules` becomes ['turtle'] - deterministically.
  python : 'import turtle\n\nt = turtle.Turtle()\nt.forward(100)\nt.left(90)\n',

  // A JSON array - the multi-file branch, two named files.
  python3Files :
    '[{"name":"main.py","content":"from helper import greet\\n\\ngreet()\\n"},' +
    '{"name":"helper.py","content":"def greet():\\n    print(\\"parity\\")\\n"}]',

  // Raw, non-JSON, lang html -> langExtensions gives 'main.html'.
  html :
    '<!DOCTYPE html>\n<html>\n  <head><title>parity</title></head>\n' +
    '  <body><p>parity fixture</p></body>\n</html>\n',

  // Raw XML, lang blocks -> the /blocks/ test wins and the file is 'main.xml'
  // regardless of the extension map.
  blocks :
    '<xml xmlns="https://developers.google.com/blockly/xml">\n' +
    '  <block type="text_print" x="10" y="10">\n' +
    '    <value name="TEXT"><block type="text">' +
    '<field name="TEXT">parity</field></block></value>\n' +
    '  </block>\n</xml>\n',

  // A JSON array with a single entry - still the multi-file branch, which is
  // worth seeding separately because a one-element array and a raw string are
  // the two shapes most easily confused.
  rFiles : '[{"name":"analysis.R","content":"x <- c(1, 2, 3)\\nprint(mean(x))\\n"}]',

  // Raw, references the seeded asset by name so an archived copy is checkable.
  withAssets : 'print("parity asset trinket")\n',

  // Raw, owned by the admin - the cross-owner authorization edges need a
  // document the seeded normal user does NOT own.
  admin : 'print("admin fixture")\n'
});

// ---------------------------------------------------------------------------
// Trinket descriptors
// ---------------------------------------------------------------------------
// `shortCode` is fixed here and NOT derived, for a reason worth stating:
// `lib/models/trinket.js:115-121` `hashify()` computes `hash` from a seed of
// fixed fields - code, lang, owner, creator, parent - but computes `shortCode`
// from that seed PLUS `Date.now()`. So `hash` is left unset and the model
// derives it (which keeps the fixture's hash exactly what the application
// would have written), while `shortCode` must be supplied or determinism is
// lost. Twelve characters each, matching the real substring length, and
// visibly synthetic.
var TRINKETS = Object.freeze([
  Object.freeze({
    key       : 'trinketPython',
    _id       : ids.trinketPython,
    shortCode : 'pyfixture001',
    name      : 'parity python trinket',
    lang      : 'python',
    code      : CODE.python,
    owner     : 'user',
    published : true,
    slug      : 'parity-python-trinket',
    created   : DATES.trinketPython
  }),
  Object.freeze({
    key       : 'trinketPython3',
    _id       : ids.trinketPython3,
    shortCode : 'py3fixture02',
    name      : 'parity python3 files',
    lang      : 'python3',
    code      : CODE.python3Files,
    owner     : 'user',
    published : false,
    slug      : 'parity-python3-files',
    created   : DATES.trinketPython3
  }),
  Object.freeze({
    key       : 'trinketHtml',
    _id       : ids.trinketHtml,
    shortCode : 'htmlfixtur03',
    name      : 'parity html trinket',
    lang      : 'html',
    code      : CODE.html,
    owner     : 'user',
    published : true,
    slug      : 'parity-html-trinket',
    created   : DATES.trinketHtml
  }),
  Object.freeze({
    key       : 'trinketBlocks',
    _id       : ids.trinketBlocks,
    shortCode : 'blocksfix004',
    name      : 'parity blocks trinket',
    lang      : 'blocks',
    code      : CODE.blocks,
    owner     : 'user',
    published : false,
    slug      : 'parity-blocks-trinket',
    created   : DATES.trinketBlocks
  }),
  Object.freeze({
    key       : 'trinketR',
    _id       : ids.trinketR,
    shortCode : 'rfixture0005',
    name      : 'parity R trinket',
    lang      : 'R',
    code      : CODE.rFiles,
    owner     : 'user',
    published : false,
    slug      : 'parity-r-trinket',
    created   : DATES.trinketR
  }),
  Object.freeze({
    key       : 'trinketWithAssets',
    _id       : ids.trinketWithAssets,
    shortCode : 'assetfix0006',
    name      : 'parity asset trinket',
    lang      : 'python',
    code      : CODE.withAssets,
    owner     : 'user',
    published : false,
    slug      : 'parity-asset-trinket',
    created   : DATES.trinketWithAssets,
    // Resolved against configuration when the fixture is built, because the
    // asset url carries the userassets host. `lib/workers/exports.js:304`
    // takes `path.basename(pathname)` as the object key, so the basename of
    // this url is exactly KEYS.userAsset and the archived asset resolves.
    asset     : 'userAssetFile',
    // An explicit snapshot, so the snapshot-bearing branch of
    // `lib/models/trinket.js:350-357` is represented alongside the six
    // trinkets that leave it unset. A local path, which is what that hook
    // itself produces while the snapshots bucket host is a placeholder.
    snapshot  : '/img/avatar-default.png'
  }),
  Object.freeze({
    key       : 'trinketAdmin',
    _id       : ids.trinketAdmin,
    shortCode : 'adminfix0007',
    name      : 'admin owned trinket',
    lang      : 'python',
    code      : CODE.admin,
    owner     : 'admin',
    published : false,
    slug      : 'admin-owned-trinket',
    created   : DATES.trinketAdmin
  })
]);

// The trinkets the seeded folder contains. Two of them, so a list response has
// more than one element to order, and both owned by the seeded user.
var FOLDER_TRINKET_KEYS = Object.freeze(['trinketPython', 'trinketHtml']);

// ---------------------------------------------------------------------------
// The configuration-independent fixture facts
// ---------------------------------------------------------------------------
// Everything a sibling harness needs to assert against WITHOUT reading
// configuration: the bytes, their digests and sizes, the object keys, the
// export filename and key, the trinket short codes and code payloads, and the
// slugs. Bucket names, hosts and therefore full urls are deliberately absent -
// they come from configuration and are resolved by `storage()`.
var fixtures = Object.freeze({
  digests : DIGESTS,
  keys    : KEYS,
  dates   : DATES,

  bytes : Object.freeze({
    materialText : Object.freeze({
      base64 : MATERIAL_TEXT.toString('base64'),
      size   : MATERIAL_TEXT.length,
      sha1   : DIGESTS.materialText,
      mime   : 'text/plain',
      filename : 'parity-material.txt'
    }),
    notebook : Object.freeze({
      base64 : NOTEBOOK_JSON.toString('base64'),
      size   : NOTEBOOK_JSON.length,
      sha1   : DIGESTS.notebook,
      // The whitelist override at lib/util/file.js:28-30 replaces whatever
      // content type the upload declared with this one.
      mime   : 'text/plain',
      filename : 'parity-notebook.ipynb'
    }),
    assetGif : Object.freeze({
      base64 : ASSET_GIF.toString('base64'),
      size   : ASSET_GIF.length,
      sha1   : DIGESTS.assetGif,
      mime   : 'image/gif',
      filename : 'parity-asset.gif'
    }),
    legacyPng : Object.freeze({
      base64 : LEGACY_PNG.toString('base64'),
      size   : LEGACY_PNG.length,
      sha1   : DIGESTS.legacyPng,
      mime   : 'image/png',
      filename : 'parity-legacy.png'
    }),
    exportZip : Object.freeze({
      base64 : EXPORT_ZIP.toString('base64'),
      size   : EXPORT_ZIP.length,
      sha1   : DIGESTS.exportZip,
      mime   : 'application/zip',
      filename : EXPORT_FILENAME
    })
  }),

  exportArchive : Object.freeze({
    filename            : EXPORT_FILENAME,
    s3Key               : EXPORT_S3_KEY,
    timestampSubstitute : EXPORT_TIMESTAMP_SUBSTITUTE,
    contentType         : 'application/zip',
    contentDisposition  : 'attachment; filename="' + EXPORT_FILENAME + '"',
    expiresAt           : DATES.exportCompletedExpiresAt,

    // The expired record's key, with no object behind it - see the note on
    // EXPORT_EXPIRED_S3_KEY.
    expiredFilename     : EXPORT_EXPIRED_FILENAME,
    expiredS3Key        : EXPORT_EXPIRED_S3_KEY,
    expiredAt           : DATES.exportExpiredExpiresAt,

    // What the completed record reports, fixed so the response is comparable:
    // one archived entry per seeded trinket, none failed.
    trinketCount        : TRINKETS.length,
    fileSize            : EXPORT_ZIP.length
  }),

  // Short code and code payload per trinket, keyed the way `ids` is, so a
  // harness building a `/python/{shortCode}` path never hard-codes one.
  trinkets : Object.freeze(TRINKETS.reduce(function(acc, trinket) {
    acc[trinket.key] = Object.freeze({
      id        : trinket._id,
      shortCode : trinket.shortCode,
      lang      : trinket.lang,
      name      : trinket.name,
      slug      : trinket.slug,
      published : trinket.published,
      owner     : trinket.owner,
      code      : trinket.code,
      // Which side of the lib/workers/exports.js:334-352 branch this payload
      // lands on, so a worker assertion states its expectation rather than
      // re-deriving it.
      codeShape : isJsonFileArray(trinket.code) ? 'json-file-array' : 'raw-string'
    });
    return acc;
  }, {})),

  // The slugs the `limax` plugin derives from the fixed names. Recorded rather
  // than recomputed because several routes address documents by slug, and a
  // harness must be able to build those paths without importing the plugin.
  slugs : Object.freeze({
    course      : 'test-course',
    lesson      : 'test-lesson',
    lessonDraft : 'draft-lesson',
    material    : 'test-material',
    materialAssignment : 'parity-assignment',
    folder      : 'parity-folder'
  }),

  course : Object.freeze({
    name        : 'test course',
    description : 'test course description',
    // Fixed, because `lib/controllers/course.js:959` generates access codes
    // with Math.random and the join-by-code routes need a stable one.
    accessCode  : 'PAR1TY'
  }),

  folder : Object.freeze({
    name          : 'parity folder',
    trinketKeys   : FOLDER_TRINKET_KEYS
  })
});

/**
 * Whether a `code` payload parses as the JSON array of `{name, content}` files
 * that `lib/workers/exports.js:337-340` accepts. Reproduces that test exactly,
 * including its treatment of valid-but-not-array JSON as a single file.
 *
 * @param {string} code
 * @returns {boolean}
 */
function isJsonFileArray(code) {
  var parsed;

  try {
    parsed = JSON.parse(code);
  }
  catch (e) {
    return false;
  }

  return Array.isArray(parsed);
}

// ---------------------------------------------------------------------------
// Lazy module resolution
// ---------------------------------------------------------------------------

var loaded = null;
var loadedConfig = null;

/**
 * Resolves the npm `config` object on first use.
 *
 * Deliberately not a module-scope require: `config` 0.4.37 freezes its values
 * when it is first required, so requiring it here would fix the configuration
 * at the moment a caller required this file for its `ids` map - which may be
 * before `test/parity/mongo.js` has published the database address.
 *
 * @returns {Object} the loaded configuration
 */
function loadConfig() {
  if (!loadedConfig) {
    loadedConfig = require('config');
  }

  return loadedConfig;
}

/**
 * Resolves the eight models on first use, and caches them.
 *
 * Requiring a model registers its schema on mongoose's default connection and
 * pulls in `config` and `lib/util/store`; none of that should happen merely
 * because a harness wanted to read `ids`. See ORDERING in the header.
 *
 * @returns {Object} model name -> publicModel
 */
function loadModels() {
  if (loaded) {
    return loaded;
  }

  loaded = {};

  Object.keys(MODEL_MODULES).forEach(function(name) {
    loaded[name] = require(MODEL_MODULES[name]);
  });

  return loaded;
}

/**
 * Asserts that somebody else has established the connection this seeder needs.
 *
 * Readiness 1 is connected and 2 is connecting; mongoose buffers commands while
 * connecting, so both are usable. 0 and 3 are not, and the message names the
 * two modules that own the connect rather than leaving a caller to discover
 * that this file deliberately does not dial one.
 *
 * @throws {Error} If no usable connection exists.
 */
function assertConnection() {
  var state = mongoose.connection.readyState;

  if (state !== 1 && state !== 2) {
    throw new Error(
      LOG_PREFIX + 'no mongoose connection (readyState ' + state + '). This ' +
      'seeder deliberately does not connect: the address is owned by ' +
      'test/parity/mongo.js and the connect by the application\'s own ' +
      'config/db.js. Start the database and load the application (or use ' +
      '`node test/parity/seed.js --verify`, which does both) before seeding.'
    );
  }
}

/**
 * The object key a stored url resolves to - the last path segment, which is
 * exactly how `lib/controllers/files.js:135-136` derives it and how
 * `lib/workers/exports.js:304` derives an asset's.
 *
 * `new URL` rather than `url.parse`: the latter emits DEP0169 on Node 22 and
 * this tooling's stderr is inside the zero-warning gate's stream. Unlike the
 * application's own six call sites, nothing here needs `url.parse`'s
 * partial-object behaviour for relative input - every url passed to this
 * helper was built from a configured absolute host.
 *
 * @param {string} value an absolute url
 * @returns {string} the final path segment, percent-decoded
 * @throws {TypeError} If `value` is not a parseable absolute url.
 */
function keyFromUrl(value) {
  var pathname = new URL(value).pathname;

  return decodeURIComponent(pathname.substring(pathname.lastIndexOf('/') + 1));
}

/**
 * Reads one bucket's configuration, and fails with the reason rather than a
 * TypeError when it is absent.
 *
 * `config/default.yaml:394-415` declares userassets, snapshots, cdn, materials,
 * useravatars, appassets and vendorassets - and NO `exports` entry, although
 * `lib/workers/exports.js:367-368` and `lib/controllers/users.js:1305`
 * dereference its `name`. AAP 0.6.7 records that gap as an existing deployment
 * requirement and does not fix `config/default.yaml`, whose bucket values are
 * deployment-specific placeholders; `test/parity/server-overlay.json` supplies
 * the value so the path is exercisable. This message is what a caller sees if
 * it seeds exports without that overlay.
 *
 * @param {string} name bucket key under config.aws.buckets
 * @returns {{name: string, host: string}}
 * @throws {Error} If the bucket is not configured.
 */
function bucket(name) {
  var config  = loadConfig();
  var buckets = config.aws && config.aws.buckets;
  var entry   = buckets && buckets[name];

  if (!entry || !entry.name) {
    throw new Error(
      LOG_PREFIX + 'config.aws.buckets.' + name + ' is not configured, so a ' +
      'fixture that points at it cannot be built.' +
      (name === 'exports'
        ? ' config/default.yaml declares no `exports` bucket at all - an ' +
          'existing deployment requirement recorded in AAP 0.6.7. Run with ' +
          'test/parity/server-overlay.json, which supplies one, or seed ' +
          'without the `exports` group.'
        : ' Check the NODE_CONFIG overlay in force.')
    );
  }

  return { name : entry.name, host : entry.host };
}

/**
 * The resolved storage descriptors: for every seeded object, which bucket it
 * lives in, under which key, and the url the seeded record carries.
 *
 * Configuration-dependent by nature, so this is a function rather than part of
 * the frozen `fixtures` map. `test/parity/storage.js` compares against these;
 * `s3Manifest()` is built from them.
 *
 * @param {Object} [options]
 * @param {boolean} [options.exports=true] include the export archive, which
 *   requires the `exports` bucket to be configured
 * @returns {Object} descriptor name -> {bucket, key, url, ...}
 */
function storage(options) {
  var opts      = options || {};
  var materials = bucket('materials');
  var userassets = bucket('userassets');
  var descriptors = {};

  descriptors.materialText = {
    bucket      : materials.name,
    key         : KEYS.materialText,
    url         : materials.host + '/' + KEYS.materialText,
    contentType : fixtures.bytes.materialText.mime,
    size        : fixtures.bytes.materialText.size,
    sha1        : DIGESTS.materialText,
    fileId      : ids.file
  };

  descriptors.materialWithFileId = {
    bucket      : materials.name,
    key         : KEYS.materialWithFileId,
    url         : materials.host + '/' + KEYS.materialWithFileId,
    contentType : fixtures.bytes.materialText.mime,
    size        : fixtures.bytes.materialText.size,
    sha1        : DIGESTS.materialText,
    // No File document points here: nothing configures container.fileId. See
    // the note on KEYS.
    fileId      : null
  };

  descriptors.notebook = {
    bucket      : materials.name,
    key         : KEYS.notebook,
    url         : materials.host + '/' + KEYS.notebook,
    contentType : fixtures.bytes.notebook.mime,
    size        : fixtures.bytes.notebook.size,
    sha1        : DIGESTS.notebook,
    fileId      : ids.notebookFile
  };

  descriptors.legacyPng = {
    bucket      : materials.name,
    key         : KEYS.legacyPng,
    url         : materials.host + '/' + KEYS.legacyPng,
    contentType : fixtures.bytes.legacyPng.mime,
    size        : fixtures.bytes.legacyPng.size,
    sha1        : DIGESTS.legacyPng,
    fileId      : ids.legacyImageFile
  };

  descriptors.userAsset = {
    bucket      : userassets.name,
    key         : KEYS.userAsset,
    url         : userassets.host + '/' + KEYS.userAsset,
    contentType : fixtures.bytes.assetGif.mime,
    size        : fixtures.bytes.assetGif.size,
    sha1        : DIGESTS.assetGif,
    fileId      : ids.userAssetFile
  };

  if (opts.exports !== false) {
    var exportsBucket = bucket('exports');

    descriptors.exportArchive = {
      bucket             : exportsBucket.name,
      key                : EXPORT_S3_KEY,
      // What `lib/workers/exports.js:378` resolves and stores as downloadUrl.
      url                : exportsBucket.host + '/' + EXPORT_S3_KEY,
      contentType        : fixtures.exportArchive.contentType,
      contentDisposition : fixtures.exportArchive.contentDisposition,
      size               : fixtures.bytes.exportZip.size,
      sha1               : DIGESTS.exportZip,
      exportId           : ids.exportCompleted
    };
  }

  return descriptors;
}

/**
 * A seed manifest in the schema `test/parity/fixtures/aws.js` accepts - an
 * array of `{bucket, key, bytesBase64, contentType, contentDisposition}`.
 *
 * Returned rather than written: this file has no filesystem side effects, so a
 * caller either hands the array to the fixture's `prepopulate()` or writes it
 * where `PARITY_S3_SEED` points. The fixture is not required from here because
 * it is not a declared dependency of this file, and a fixture that installed
 * itself as a side effect of seeding would be impossible to seed without.
 *
 * @param {Object} [options] as `storage()`
 * @returns {Array<Object>} the manifest
 */
function s3Manifest(options) {
  var descriptors = storage(options);
  var payloadFor  = {
    materialText       : fixtures.bytes.materialText.base64,
    materialWithFileId : fixtures.bytes.materialText.base64,
    notebook           : fixtures.bytes.notebook.base64,
    legacyPng          : fixtures.bytes.legacyPng.base64,
    userAsset          : fixtures.bytes.assetGif.base64,
    exportArchive      : fixtures.bytes.exportZip.base64
  };

  return Object.keys(descriptors).map(function(name) {
    var descriptor = descriptors[name];
    var entry      = {
      bucket      : descriptor.bucket,
      key         : descriptor.key,
      bytesBase64 : payloadFor[name],
      contentType : descriptor.contentType
    };

    if (descriptor.contentDisposition) {
      entry.contentDisposition = descriptor.contentDisposition;
    }

    return entry;
  });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------
// Declared in dependency order, so seeding is a single pass over this list.
// The dependencies are not stylistic - each one is a document another group's
// fixture points at, and two of them were found by measurement rather than by
// reading the schema:
//
//   trinkets -> files   `lib/models/trinket.js:88-96` records added asset ids
//     on the document, and the `updateAssetMetrics` pre-save hook (:326-348)
//     then calls `File.findByIdAndUpdateMetric(id, 'trinkets', 1)` with
//     `upsert: true`. Seeding the asset-bearing trinket without its File would
//     therefore CREATE a stub File document carrying nothing but an `_id` and a
//     metric - a document no application path ever writes.
//
//   course -> trinkets  the assignment material embeds a trinket's id, name,
//     shortCode and lang (`lib/models/material.js:11-16`). Seeding it against
//     an absent trinket would leave a reference that resolves to nothing, and
//     making the embed conditional on the selection would make the fixture's
//     CONTENT depend on which groups were asked for - which is exactly the
//     non-determinism this file exists to remove.
var GROUP_ORDER = ['users', 'files', 'trinkets', 'course', 'folders', 'exports'];

var GROUP_DEPENDENCIES = Object.freeze({
  users    : Object.freeze([]),
  files    : Object.freeze(['users']),
  trinkets : Object.freeze(['users', 'files']),
  course   : Object.freeze(['users', 'trinkets']),
  folders  : Object.freeze(['users', 'trinkets']),
  exports  : Object.freeze(['users'])
});

// Which fixed ids each group owns. `reset({ scope: 'fixtures' })` and
// `seed({ force: true })` delete exactly these, and the self-check walks them
// to prove every id in `ids` resolves to a document - except the `missing*`
// ids, which are listed separately because their absence is the fixture.
var GROUP_IDS = Object.freeze({
  users    : Object.freeze(['User', [ids.user, ids.admin, ids.disabledUser]]),
  files    : Object.freeze(['File', [
    ids.file, ids.notebookFile, ids.userAssetFile, ids.legacyImageFile
  ]]),
  trinkets : Object.freeze(['Snippet', TRINKETS.map(function(t) { return t._id; })]),
  course   : Object.freeze(['Course', [ids.course]]),
  folders  : Object.freeze(['Folder', [ids.folder]]),
  exports  : Object.freeze(['Export', [
    ids.exportPending, ids.exportCompleted, ids.exportExpired
  ]])
});

// The course group spans three collections, so its ids do not fit the one-model
// shape above.
var COURSE_TREE_IDS = Object.freeze({
  Course   : Object.freeze([ids.course]),
  Lesson   : Object.freeze([ids.lesson, ids.lessonDraft]),
  Material : Object.freeze([ids.material, ids.materialAssignment])
});

// Ids that must NOT resolve to a document, paired with the collection they
// would have lived in. `missingUser` is the one with a behavioural contract -
// `app.js:255-259` clears the session and answers "User not found" for it - and
// the rest give every `{id}` route an input that resolves to nothing.
var MISSING_IDS = Object.freeze([
  Object.freeze({ model : 'User',    id : ids.missingUser,    key : 'missingUser' }),
  Object.freeze({ model : 'Snippet', id : ids.missingTrinket, key : 'missingTrinket' }),
  Object.freeze({ model : 'Course',  id : ids.missingCourse,  key : 'missingCourse' }),
  Object.freeze({ model : 'Folder',  id : ids.missingFolder,  key : 'missingFolder' }),
  Object.freeze({ model : 'File',    id : ids.missingFile,    key : 'missingFile' }),
  Object.freeze({ model : 'Export',  id : ids.missingExport,  key : 'missingExport' })
]);

/**
 * Resolves the requested groups into a dependency-closed selection.
 *
 * Two selection styles, because both appear in practice:
 *   * At least one group explicitly `true` -> the selection is exactly those,
 *     plus whatever they depend on. `{users: true, files: true}` is how
 *     `test/parity/storage.js` avoids creating the whole world.
 *   * Only `false` values -> the selection is everything except those.
 *   * No group mentioned -> everything.
 *
 * A group that is explicitly `false` but required by a selected group is a
 * contradiction, and it THROWS rather than being silently overridden: seeding
 * something a caller asked not to seed is worse than refusing. A group that was
 * simply not mentioned is included when a dependency needs it, and reported in
 * the summary's `implied` list so it is never invisible.
 *
 * @param {Object} [options]
 * @returns {{selected: string[], implied: string[]}}
 * @throws {Error} On an unknown group, or a false group another needs.
 */
function resolveSelection(options) {
  var opts     = options || {};
  var mentioned = GROUP_ORDER.filter(function(group) {
    return Object.prototype.hasOwnProperty.call(opts, group);
  });

  Object.keys(opts).forEach(function(key) {
    if (key !== 'force' && key !== 'scope' && GROUP_ORDER.indexOf(key) === -1) {
      throw new Error(
        LOG_PREFIX + 'unknown seed option `' + key + '`; the groups are ' +
        GROUP_ORDER.join(', ') + ' and the flags are force, scope'
      );
    }
  });

  var anyTrue = mentioned.some(function(group) { return opts[group] === true; });
  var wanted  = {};

  GROUP_ORDER.forEach(function(group) {
    if (!mentioned.length) {
      wanted[group] = true;
    }
    else if (anyTrue) {
      wanted[group] = opts[group] === true;
    }
    else {
      wanted[group] = opts[group] !== false;
    }
  });

  var implied = [];

  // One pass per group in dependency order is enough, because dependencies
  // only ever point at groups that come earlier in GROUP_ORDER. Walking it in
  // reverse means a dependency added by a later group is still visited.
  GROUP_ORDER.slice().reverse().forEach(function(group) {
    if (!wanted[group]) {
      return;
    }

    GROUP_DEPENDENCIES[group].forEach(function(dependency) {
      if (wanted[dependency]) {
        return;
      }

      if (opts[dependency] === false) {
        throw new Error(
          LOG_PREFIX + 'group `' + group + '` requires `' + dependency +
          '`, which was explicitly disabled. ' + describeDependency(group, dependency) +
          ' Either enable `' + dependency + '` or drop `' + group + '`.'
        );
      }

      wanted[dependency] = true;
      implied.push(dependency);
    });
  });

  return {
    selected : GROUP_ORDER.filter(function(group) { return wanted[group]; }),
    implied  : implied.filter(function(group, index) {
      return implied.indexOf(group) === index;
    })
  };
}

/**
 * The reason one group needs another, quoted into the error a caller sees so
 * the refusal above is actionable rather than merely correct.
 *
 * @param {string} group
 * @param {string} dependency
 * @returns {string}
 */
function describeDependency(group, dependency) {
  if (group === 'trinkets' && dependency === 'files') {
    return 'The asset-bearing trinket\'s pre-save hook upserts a File metric ' +
           '(lib/models/trinket.js:326-348), so without the File documents it ' +
           'would create a stub record no application path writes.';
  }

  if (group === 'course' && dependency === 'trinkets') {
    return 'The assignment material embeds a trinket\'s id, shortCode and lang.';
  }

  return 'Its documents carry a required owner or an embedded reference.';
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * The registered mongoose model behind a public model wrapper.
 *
 * `lib/models/model.js:18,103-105` exposes the private model on the wrapper
 * only when NODE_ENV is 'test' or 'migration', and the generated `findById`
 * applies `alternateIds` (username and email for User, hash for File) and any
 * default field projection. Existence checks, deletes and the one raw insert
 * below need none of that and must not depend on an environment variable, so
 * they go through the registry instead.
 *
 * @param {string} name
 * @returns {Object} the mongoose Model
 */
function privateModel(name) {
  loadModels();

  return mongoose.model(name);
}

/**
 * A structural copy of a frozen fixture literal, so mongoose is never handed a
 * frozen object it might try to annotate. Every value in these literals is a
 * string, number, boolean, array or plain object - dates are carried as ISO
 * strings and cast by the schema - so a JSON round trip is lossless here.
 *
 * @param {*} value
 * @returns {*}
 */
function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Merges fixture attributes into a fresh object.
 *
 * @param {...Object} sources
 * @returns {Object}
 */
function attributes() {
  var result = {};
  var i, source, key;

  for (i = 0; i < arguments.length; i++) {
    source = arguments[i];

    if (!source) {
      continue;
    }

    for (key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        result[key] = source[key];
      }
    }
  }

  return result;
}

/**
 * Records one id against a model in a summary bucket.
 *
 * @param {Object} bucketMap summary.created or summary.skipped
 * @param {string} model
 * @param {string} id
 */
function tally(bucketMap, model, id) {
  if (!bucketMap[model]) {
    bucketMap[model] = [];
  }

  bucketMap[model].push(id);
}

/**
 * Creates a document unless one already carries that `_id`.
 *
 * This is the whole of the idempotence contract: a fixed `_id` that is already
 * present is left ALONE rather than overwritten, so calling `seed()` twice
 * neither throws a duplicate-key error (measured: MongoServerError 11000) nor
 * re-runs a hook. A caller that wants the fixtures restored after a corpus case
 * mutated them asks for `{force: true}`, which deletes them first.
 *
 * @param {Object} summary
 * @param {string} model
 * @param {string} id
 * @param {function(): Promise<Object>} create
 * @returns {Promise<Object>} the existing or newly created document
 */
async function ensure(summary, model, id, create) {
  var Model    = privateModel(model);
  var existing = await Model.findById(id).exec();
  var created;

  if (existing) {
    tally(summary.skipped, model, id);
    return existing;
  }

  created = await create();
  tally(summary.created, model, id);

  return created;
}

// ---------------------------------------------------------------------------
// Group seeders
// ---------------------------------------------------------------------------

/**
 * The three identities.
 *
 * Saved through the model, never inserted raw, because `encryptPassword`
 * (`lib/models/user.js:48-62`) is a pre-save hook: a raw insert would store the
 * plaintext, `POST /login` would reject it, and every authenticated corpus
 * scenario would be unreachable. The same save runs `ensureName` (name from
 * fullname, lowercased username and email, a normalized avatar) and
 * `checkPermissions`, which for the role-less normal user calls
 * `setRoles('user', 'site')` - `grant` with `_skipUpdate`, so it needs no
 * global `User` binding and takes its permissions from the static map in
 * `lib/models/roles.js`. Deterministic, and identical to what registration
 * writes.
 *
 * @param {Object} models
 * @param {Object} summary
 */
async function seedUsers(models, summary) {
  await ensure(summary, 'User', ids.user, async function() {
    return await new models.User(attributes(
      copy(IDENTITIES.user),
      { created : DATES.user }
    )).save();
  });

  await ensure(summary, 'User', ids.admin, async function() {
    return await new models.User(attributes(
      copy(IDENTITIES.admin),
      { created : DATES.admin }
    )).save();
  });

  await ensure(summary, 'User', ids.disabledUser, async function() {
    return await new models.User(attributes(
      copy(IDENTITIES.disabled),
      { created : DATES.disabledUser }
    )).save();
  });
}

/**
 * The four file records, and the stored objects they name.
 *
 * Three go through the model. The fourth cannot: the image branch of
 * `lib/controllers/files.js:153-173` - AAP 0.7's approved deviation, where
 * baseline never settled and the target serves the stream - is entered only
 * when `file.type` matches /^image/, and `type` is an enum of 'embed' and
 * 'download' (`lib/models/file.js:9`). A document with `type: 'image/png'`
 * therefore fails validation and can only exist as what it is: a record written
 * by an older codebase. It is inserted through the collection with every field
 * supplied explicitly, including both timestamps, which makes it the most
 * deterministic document in the set as well as the most legacy one.
 *
 * @param {Object} models
 * @param {Object} summary
 */
async function seedFiles(models, summary) {
  var descriptors = storage({ exports : false });

  await ensure(summary, 'File', ids.file, async function() {
    var doc = new models.File({
      _id     : ids.file,
      hash    : DIGESTS.materialText,
      url     : descriptors.materialText.url,
      type    : 'download',
      name    : fixtures.bytes.materialText.filename,
      mime    : fixtures.bytes.materialText.mime,
      size    : fixtures.bytes.materialText.size,
      created : DATES.file
    });

    doc.setOwner(ids.user);

    return await doc.save();
  });

  await ensure(summary, 'File', ids.notebookFile, async function() {
    var doc = new models.File({
      _id     : ids.notebookFile,
      hash    : DIGESTS.notebook,
      url     : descriptors.notebook.url,
      type    : 'download',
      name    : fixtures.bytes.notebook.filename,
      // The whitelist override, already applied: `config/default.yaml:236-237`
      // maps ipynb to text/plain, and `lib/util/file.js:28-30` uses that in
      // place of whatever the upload declared.
      mime    : fixtures.bytes.notebook.mime,
      size    : fixtures.bytes.notebook.size,
      created : DATES.notebookFile
    });

    doc.setOwner(ids.user);

    return await doc.save();
  });

  await ensure(summary, 'File', ids.userAssetFile, async function() {
    var doc = new models.File({
      _id     : ids.userAssetFile,
      hash    : DIGESTS.assetGif,
      url     : descriptors.userAsset.url,
      type    : 'embed',
      name    : fixtures.bytes.assetGif.filename,
      mime    : fixtures.bytes.assetGif.mime,
      size    : fixtures.bytes.assetGif.size,
      created : DATES.userAssetFile
    });

    doc.setOwner(ids.user);

    return await doc.save();
  });

  await ensure(summary, 'File', ids.legacyImageFile, async function() {
    // `new mongoose.Types.ObjectId(<fixed hex>)` is a cast, not a generator:
    // the prohibition on `new ObjectId()` is a prohibition on generated ids,
    // and a raw insert must supply real ObjectId values or the `_id` and the
    // owner references would be stored as strings and stop matching.
    var ObjectId = mongoose.Types.ObjectId;
    var timestamp = new Date(DATES.legacyImageFile);

    await privateModel('File').collection.insertOne({
      _id      : new ObjectId(ids.legacyImageFile),
      hash     : DIGESTS.legacyPng,
      url      : descriptors.legacyPng.url,
      // The legacy value the enum would now reject.
      type     : 'image/png',
      name     : fixtures.bytes.legacyPng.filename,
      mime     : fixtures.bytes.legacyPng.mime,
      size     : fixtures.bytes.legacyPng.size,
      hidden   : false,
      metrics  : { trinkets : 0 },
      _owner   : new ObjectId(ids.user),
      _creator : new ObjectId(ids.user),
      created     : timestamp,
      lastUpdated : timestamp
    });

    return await privateModel('File').findById(ids.legacyImageFile).exec();
  });
}

/**
 * The seven trinkets, then the asset metric they moved.
 *
 * `hash` is deliberately NOT supplied: `preSaveCreateHash`
 * (`lib/models/trinket.js:98-113`) computes it through `hashify()` from a seed
 * of code, lang, owner, creator and parent - all fixed here - so letting the
 * model derive it makes the fixture's hash exactly the value the application
 * would have written, and it is still reproducible. `shortCode` is the opposite
 * case and MUST be supplied, because `hashify` mixes `Date.now()` into it.
 *
 * @param {Object} models
 * @param {Object} summary
 */
async function seedTrinkets(models, summary) {
  // The trinket model is registered under its 2013 name, 'Snippet'.
  var Trinket     = models.Snippet;
  var descriptors = storage({ exports : false });
  var i, descriptor;

  for (i = 0; i < TRINKETS.length; i++) {
    descriptor = TRINKETS[i];

    /* eslint-disable no-loop-func */
    await ensure(summary, 'Snippet', descriptor._id, (function(spec) {
      return async function() {
        var ownerId = ids[spec.owner];
        var doc     = new Trinket({
          _id       : spec._id,
          shortCode : spec.shortCode,
          name      : spec.name,
          lang      : spec.lang,
          code      : spec.code,
          slug      : spec.slug,
          published : spec.published,
          _owner    : ownerId,
          _creator  : ownerId,
          created   : spec.created
        });

        if (spec.snapshot) {
          doc.snapshot = spec.snapshot;
        }

        if (spec.asset) {
          // The asset's url is what `lib/workers/exports.js:304` reduces to an
          // object key with `path.basename`, so this url's last segment is
          // KEYS.userAsset and the archived asset resolves against the S3
          // fixture. Assigning `assets` also arms the metric hook - see
          // reconcileAssetMetrics below.
          doc.assets = [{
            id   : ids[spec.asset],
            url  : descriptors.userAsset.url,
            name : fixtures.bytes.assetGif.filename
          }];
        }

        return await doc.save();
      };
    })(descriptor));
    /* eslint-enable no-loop-func */
  }

  await reconcileAssetMetrics(summary);
}

// How long reconcileAssetMetrics waits for an in-flight metric increment, and
// how often it looks. Two seconds against a local in-memory mongod is very
// generous for one small update; the bound exists so a lost increment surfaces
// as a reported fact rather than a hang.
var METRIC_SETTLE_TIMEOUT_MS = 2000;
var METRIC_POLL_INTERVAL_MS  = 10;

/**
 * Suspends for `ms`. Used only to wait for an in-flight database update, never
 * to produce a value.
 *
 * @param {number} ms
 * @returns {Promise<undefined>}
 */
function sleep(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

/**
 * Fixes `File.metrics.trinkets` at the value the seeded set implies.
 *
 * `updateAssetMetrics` (`lib/models/trinket.js:326-348`) fires an UNAWAITED
 * `File.findByIdAndUpdateMetric(id, 'trinkets', 1)` and discards the promise,
 * so the increment lands at a moment the caller cannot observe - and `metrics`
 * is in the File publicSpec, so its value is visible in a compared response.
 * The hook is left to run exactly as it does in production, and this makes the
 * result reproducible in two steps:
 *
 *   1. For each file an asset-bearing trinket was CREATED against in this call,
 *      wait until the increment has actually landed. Setting the value while an
 *      increment is still in flight would leave `expected + 1` behind, which is
 *      the whole race - so the wait, not the assignment, is what closes it.
 *   2. Assign the final value. Assignment rather than another increment,
 *      because a repeat `seed()` must not double it, and it also normalizes a
 *      file whose metric a corpus case moved.
 *
 * @param {Object} summary the seed summary; `created.Snippet` says which
 *   trinkets were created in this call, and therefore which increments to wait
 *   for
 */
async function reconcileAssetMetrics(summary) {
  var expected = {};
  var pending  = {};
  var createdTrinkets = summary.created.Snippet || [];

  TRINKETS.forEach(function(descriptor) {
    if (!descriptor.asset) {
      return;
    }

    var fileId = ids[descriptor.asset];
    expected[fileId] = (expected[fileId] || 0) + 1;

    if (createdTrinkets.indexOf(descriptor._id) >= 0) {
      pending[fileId] = (pending[fileId] || 0) + 1;
    }
  });

  var fileIds  = GROUP_IDS.files[1];
  var settled  = true;
  var i, fileId, waited, current;

  for (i = 0; i < fileIds.length; i++) {
    fileId = fileIds[i];

    if (pending[fileId]) {
      waited = 0;

      /* eslint-disable no-await-in-loop */
      while (waited < METRIC_SETTLE_TIMEOUT_MS) {
        current = await privateModel('File').collection.findOne(
          { _id : new mongoose.Types.ObjectId(fileId) },
          { projection : { 'metrics.trinkets' : 1 } }
        );

        if (current && current.metrics &&
            current.metrics.trinkets >= pending[fileId]) {
          break;
        }

        await sleep(METRIC_POLL_INTERVAL_MS);
        waited += METRIC_POLL_INTERVAL_MS;
      }
      /* eslint-enable no-await-in-loop */

      if (waited >= METRIC_SETTLE_TIMEOUT_MS) {
        // Reported, not thrown: the assignment below still leaves the right
        // value, and `verify()` asserts it independently. A hang or a silent
        // pass would both be worse than a recorded fact.
        settled = false;
        note('the asset metric increment for File ' + fileId + ' did not ' +
             'land within ' + METRIC_SETTLE_TIMEOUT_MS + 'ms; the final value ' +
             'is being set anyway and verify() will catch a late arrival');
      }
    }

    await privateModel('File').collection.updateOne(
      { _id : new mongoose.Types.ObjectId(fileId) },
      { $set : { 'metrics.trinkets' : expected[fileId] || 0 } }
    );
  }

  summary.assetMetrics        = expected;
  summary.assetMetricsSettled = settled;
}

/**
 * The course tree: two materials, two lessons, the course, and the role that
 * makes the seeded user its owner.
 *
 * `course.addUser()` is deliberately NOT used. It calls
 * `user.grant(role, 'course', {id})` WITHOUT `_skipUpdate`
 * (`lib/models/course.js:79`), and that path writes through the GLOBAL `User`
 * binding, which exists only inside a running `app.js`. A harness that seeds
 * before loading the application - `test/parity/worker.js` and
 * `test/parity/storage.js` both do - would take a ReferenceError. So the
 * course's own `users` subdocument is written literally, in exactly the shape
 * `addUser` pushes (`lib/models/course.js:61-68`), and the role is granted with
 * `setRoles`, which is `grant` with `_skipUpdate` and therefore touches no
 * global. The resulting documents are indistinguishable from what
 * `createCourseCore` (`lib/controllers/course.js:1765-1782`) produces.
 *
 * @param {Object} models
 * @param {Object} summary
 */
async function seedCourseTree(models, summary) {
  var owner = await privateModel('User').findById(ids.user).exec();
  var trinket;

  if (!owner) {
    throw new Error(
      LOG_PREFIX + 'the course tree needs the seeded user, which is absent. ' +
      'This should be unreachable - `course` depends on `users` - so it ' +
      'indicates the users group failed silently.'
    );
  }

  await ensure(summary, 'Material', ids.material, async function() {
    var doc = new models.Material({
      _id     : ids.material,
      name    : 'test material',
      type    : 'page',
      content : 'test content',
      isDraft : false,
      created : DATES.material
    });

    doc.setOwner(ids.user);

    return await doc.save();
  });

  trinket = await privateModel('Snippet').findById(ids.trinketPython).exec();

  await ensure(summary, 'Material', ids.materialAssignment, async function() {
    var doc = new models.Material({
      _id     : ids.materialAssignment,
      name    : 'parity assignment',
      type    : 'assignment',
      content : 'Submit the parity trinket.',
      isDraft : false,
      // The embedded shape `lib/controllers/course.js` writes when a trinket is
      // attached to an assignment. Every date is fixed and on a fixed side of
      // `isVisible()`'s comparisons, so visibility is stable.
      trinket : {
        trinketId : ids.trinketPython,
        name      : trinket ? trinket.name : null,
        shortCode : trinket ? trinket.shortCode : null,
        lang      : trinket ? trinket.lang : null,
        availableOn : {
          enabled   : true,
          dateValue : DATES.materialAvailableOn
        },
        submissionsDue : {
          enabled   : true,
          dateValue : DATES.materialDueOn
        },
        submissionsCutoff : {
          enabled   : false
        },
        hideAfter : {
          enabled   : true,
          dateValue : DATES.materialHideAfter
        }
      },
      created : DATES.materialAssignment
    });

    doc.setOwner(ids.user);

    return await doc.save();
  });

  await ensure(summary, 'Lesson', ids.lesson, async function() {
    var doc = new models.Lesson({
      _id       : ids.lesson,
      name      : 'test lesson',
      isDraft   : false,
      materials : [ids.material, ids.materialAssignment],
      created   : DATES.lesson
    });

    doc.setOwner(ids.user);

    return await doc.save();
  });

  await ensure(summary, 'Lesson', ids.lessonDraft, async function() {
    var doc = new models.Lesson({
      _id       : ids.lessonDraft,
      name      : 'draft lesson',
      isDraft   : true,
      materials : [],
      created   : DATES.lessonDraft
    });

    doc.setOwner(ids.user);

    return await doc.save();
  });

  await ensure(summary, 'Course', ids.course, async function() {
    var doc = new models.Course({
      _id         : ids.course,
      name        : fixtures.course.name,
      description : fixtures.course.description,
      ownerSlug   : IDENTITIES.user.username,
      accessCode  : fixtures.course.accessCode,
      lessons     : [ids.lesson, ids.lessonDraft],
      users       : [{
        userId      : ids.user,
        username    : owner.username,
        displayName : owner.name,
        email       : owner.email,
        avatar      : owner.normalizeAvatar(),
        roles       : ['course-owner']
      }],
      archived    : false,
      created     : DATES.course
    });

    doc.setOwner(ids.user);
    // Applies every declared default rather than relying on the schema to do
    // it, which is what the controller does on create.
    doc.setGlobalSettings({});

    return await doc.save();
  });

  // Granted ONLY when the role is absent, and the guard is load-bearing rather
  // than an optimization. Measured: `grant` (`lib/models/plugins/roles.js:52-57`)
  // back-fills `thru` and `limits` with `{}` on a role entry that already
  // exists, and assigning them marks the subdocument modified - so where the
  // first save persisted the entry WITHOUT those two empty objects (mongoose
  // omits them), a second `setRoles` persists it WITH them. The documents then
  // differ after a repeat `seed()` even though nothing was created, which is
  // precisely the non-determinism this file exists to prevent. `hasRole` is the
  // same predicate `lib/controllers/course.js:201` uses, so the check asks the
  // application's own question.
  if (!owner.hasRole('course-owner', 'course', { id : ids.course })) {
    await owner.setRoles('course-owner', 'course', { id : ids.course });
    await owner.save();
    tally(summary.updated, 'User', owner.id);
  }
}

/**
 * The folder, and the folder reference on each trinket it contains.
 *
 * Both halves are needed and they are written by different application paths:
 * `Folder.addTrinket` (`lib/models/folder.js:26-42`) pushes the subdocument
 * onto the folder, and `Trinket.addFolder` (`lib/models/trinket.js:390-399`)
 * writes the reverse reference the trinket list filters on. A folder seeded
 * without the reverse references would make the `folders.trinkets` quirk case
 * unfalsifiable: AAP 0.6.4 requires it driven BOTH with and without a query
 * string, because baseline builds `/api/trinkets&folder=...` when no query is
 * present - an `&` where a `?` belongs, so no folder filter applies at all -
 * and a well-formed url when one is. Distinguishing those two outcomes requires
 * a filter that would otherwise have matched something.
 *
 * @param {Object} models
 * @param {Object} summary
 */
async function seedFolders(models, summary) {
  var members = [];
  var i, key, doc, folder;

  for (i = 0; i < FOLDER_TRINKET_KEYS.length; i++) {
    key = FOLDER_TRINKET_KEYS[i];
    doc = await privateModel('Snippet').findById(ids[key]).exec();

    if (!doc) {
      throw new Error(
        LOG_PREFIX + 'the folder needs trinket `' + key + '`, which is ' +
        'absent. This should be unreachable - `folders` depends on ' +
        '`trinkets` - so it indicates the trinkets group failed silently.'
      );
    }

    members.push(doc);
  }

  folder = await ensure(summary, 'Folder', ids.folder, async function() {
    var created = new models.Folder({
      _id       : ids.folder,
      name      : fixtures.folder.name,
      ownerSlug : IDENTITIES.user.username,
      trinkets  : members.map(function(member) {
        return {
          trinketId    : member.id,
          name         : member.name,
          lang         : member.lang,
          shortCode    : member.shortCode,
          // Read from the loaded document, which is where the post-init
          // `checkSnapshot` hook has already supplied the default - exactly
          // what `addTrinket` copies when a user adds a trinket by hand.
          snapshot     : member.snapshot,
          instructions : member.description || '',
          addedBy      : ids.user
        };
      }),
      created   : DATES.folder
    });

    created.setOwner(ids.user);

    return await created.save();
  });

  for (i = 0; i < members.length; i++) {
    doc = members[i];

    if (doc.folder && doc.folder.folderId &&
        doc.folder.folderId.toString() === ids.folder) {
      continue;
    }

    doc.folder = {
      folderId   : folder.id,
      name       : folder.name,
      folderSlug : folder.slug,
      ownerSlug  : folder.ownerSlug
    };

    await doc.save();
    tally(summary.updated, 'Snippet', doc.id);
  }
}

/**
 * The three export records: pending, completed, and completed-but-expired.
 *
 * The completed record carries an `s3Key` of exactly the form
 * `lib/workers/exports.js:104` builds and a `downloadUrl` of exactly the form
 * :378 resolves, so `GET /api/exports/{exportId}` reports what the worker would
 * have reported and `GET /api/exports/{exportId}/download` reaches
 * `getSignedUrl` at `lib/controllers/users.js:1299` instead of failing an
 * earlier guard. The expired record exists because :1293 is a DISTINCT error
 * edge from :1291 - not-completed and expired are two branches, and one fixture
 * cannot reach both.
 *
 * @param {Object} models
 * @param {Object} summary
 */
async function seedExports(models, summary) {
  var descriptors = storage();

  await ensure(summary, 'Export', ids.exportPending, async function() {
    return await new models.Export({
      _id      : ids.exportPending,
      _owner   : ids.user,
      status   : 'pending',
      progress : { total : 0, processed : 0, failed : 0 },
      created  : DATES.exportPending
    }).save();
  });

  await ensure(summary, 'Export', ids.exportCompleted, async function() {
    return await new models.Export({
      _id          : ids.exportCompleted,
      _owner       : ids.user,
      status       : 'completed',
      progress     : {
        total     : fixtures.exportArchive.trinketCount,
        processed : fixtures.exportArchive.trinketCount,
        failed    : 0
      },
      downloadUrl  : descriptors.exportArchive.url,
      s3Key        : EXPORT_S3_KEY,
      expiresAt    : DATES.exportCompletedExpiresAt,
      fileSize     : fixtures.exportArchive.fileSize,
      trinketCount : fixtures.exportArchive.trinketCount,
      created      : DATES.exportCompleted
    }).save();
  });

  await ensure(summary, 'Export', ids.exportExpired, async function() {
    return await new models.Export({
      _id          : ids.exportExpired,
      _owner       : ids.user,
      status       : 'completed',
      progress     : {
        total     : fixtures.exportArchive.trinketCount,
        processed : fixtures.exportArchive.trinketCount,
        failed    : 0
      },
      // Points at a key with no object behind it, on purpose: the expiry guard
      // answers before S3 is touched.
      downloadUrl  : bucket('exports').host + '/' + EXPORT_EXPIRED_S3_KEY,
      s3Key        : EXPORT_EXPIRED_S3_KEY,
      expiresAt    : DATES.exportExpiredExpiresAt,
      fileSize     : fixtures.exportArchive.fileSize,
      trinketCount : fixtures.exportArchive.trinketCount,
      created      : DATES.exportExpired
    }).save();
  });
}

var SEEDERS = {
  users    : seedUsers,
  files    : seedFiles,
  trinkets : seedTrinkets,
  course   : seedCourseTree,
  folders  : seedFolders,
  exports  : seedExports
};

// ---------------------------------------------------------------------------
// The public operations
// ---------------------------------------------------------------------------

/**
 * The model-name -> fixed-ids map for a set of groups.
 *
 * @param {string[]} groups
 * @returns {Object} model name -> id array
 */
function idsForGroups(groups) {
  var map = {};

  groups.forEach(function(group) {
    if (group === 'course') {
      Object.keys(COURSE_TREE_IDS).forEach(function(model) {
        map[model] = (map[model] || []).concat(COURSE_TREE_IDS[model]);
      });
      return;
    }

    var pair  = GROUP_IDS[group];
    var model = pair[0];

    map[model] = (map[model] || []).concat(pair[1]);
  });

  return map;
}

/**
 * Deletes the fixed documents belonging to a set of groups.
 *
 * @param {string[]} groups
 * @returns {Promise<Object>} model name -> deleted count
 */
async function deleteFixtures(groups) {
  var map     = idsForGroups(groups);
  var models  = Object.keys(map);
  var deleted = {};
  var i, model, objectIds, result;

  for (i = 0; i < models.length; i++) {
    model     = models[i];
    objectIds = map[model].map(function(id) {
      return new mongoose.Types.ObjectId(id);
    });

    result = await privateModel(model).collection.deleteMany({
      _id : { $in : objectIds }
    });

    deleted[model] = result.deletedCount;
  }

  return deleted;
}

/**
 * Creates every fixture in the selected groups.
 *
 * Idempotent: a fixed `_id` that already exists is skipped, so a second call
 * neither throws nor duplicates. Pass `{force: true}` to delete the selected
 * fixtures first, which is how a harness restores them between corpus cases
 * without dropping a database other state depends on.
 *
 * @param {Object} [options]
 * @param {boolean} [options.users]    select or exclude a group; see
 * @param {boolean} [options.files]    resolveSelection for the exact semantics
 * @param {boolean} [options.trinkets]
 * @param {boolean} [options.course]
 * @param {boolean} [options.folders]
 * @param {boolean} [options.exports]
 * @param {boolean} [options.force=false] delete the selected fixtures first
 * @returns {Promise<Object>} a summary: selected and implied groups, and the
 *   ids created, skipped, updated and deleted, by model
 * @throws {Error} If there is no connection, a group is unknown, a required
 *   group was disabled, or a needed bucket is unconfigured.
 */
async function seed(options) {
  assertConnection();

  var selection = resolveSelection(options);
  var models    = loadModels();
  var force     = !!(options && options.force);
  var summary   = {
    selected : selection.selected,
    implied  : selection.implied,
    forced   : force,
    created  : {},
    skipped  : {},
    updated  : {},
    deleted  : {},
    ids      : ids
  };
  var i, group;

  if (force) {
    summary.deleted = await deleteFixtures(selection.selected);
  }

  // Sequential and in GROUP_ORDER, because the groups are ordered by
  // dependency and because a fixed insertion order is part of what makes two
  // runs comparable.
  for (i = 0; i < selection.selected.length; i++) {
    group = selection.selected[i];
    await SEEDERS[group](models, summary);
  }

  return summary;
}

/**
 * Removes what this seeder owns.
 *
 * Two scopes, and neither is `dropDatabase`:
 *
 *   'collections' (default) empties the eight collections this file writes.
 *   'fixtures'              deletes only the documents carrying a fixed `_id`,
 *                           leaving anything a corpus case created.
 *
 * Documents are deleted rather than collections dropped, so the indexes
 * `lib/models/*.js` declare - including the unique `{_owner, slug}` compounds
 * on Course and Folder - survive and keep being enforced.
 *
 * This is NOT the `reset` in `db.js` under `test/helpers`, and must never
 * become it. That one drops the whole database and the serial suite depends on
 * the emptiness it produces (`registration.js` under `test/lib/api` asserts the
 * default user is absent before creating it). This one is scoped to the parity
 * harnesses.
 *
 * @param {Object} [options]
 * @param {string} [options.scope='collections'] 'collections' or 'fixtures'
 * @returns {Promise<Object>} model name -> deleted count
 * @throws {Error} If there is no connection, or the scope is unknown.
 */
async function reset(options) {
  assertConnection();

  var scope = (options && options.scope) || 'collections';

  if (scope === 'fixtures') {
    return await deleteFixtures(GROUP_ORDER);
  }

  if (scope !== 'collections') {
    throw new Error(
      LOG_PREFIX + 'unknown reset scope `' + scope + '`; use ' +
      '\'collections\' (empty the eight owned collections) or \'fixtures\' ' +
      '(delete only the fixed ids)'
    );
  }

  var names   = Object.keys(MODEL_MODULES);
  var deleted = {};
  var i, result;

  for (i = 0; i < names.length; i++) {
    result = await privateModel(names[i]).collection.deleteMany({});
    deleted[names[i]] = result.deletedCount;
  }

  return deleted;
}

// ---------------------------------------------------------------------------
// Determinism artifact
// ---------------------------------------------------------------------------

// Fields the models write from the clock or from a random salt. They are the
// enumerated volatile set for the SEEDED documents, and the projection below
// removes exactly these and nothing else - a wider list would hide a real
// difference, which is the failure mode this artifact exists to catch.
var VOLATILE_FIELDS = Object.freeze([
  // lib/models/plugins/timestamps.js:20-28, assigned on every modified save.
  'lastUpdated',
  // lib/models/trinket.js:108-110, assigned whenever code/assets/settings move.
  'codeLastUpdated',
  // lib/models/user.js:48-62, salted per save by design.
  'password'
]);

/**
 * Recursively sorts keys and normalizes BSON values, so two projections can be
 * compared as strings.
 *
 * @param {*} value
 * @returns {*}
 */
function canonical(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (Array.isArray(value)) {
    return value.map(canonical);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return value.toString('base64');
  }

  // ObjectId and any other BSON scalar: its own string form is the comparable
  // one, and it must not be walked as an object.
  if (typeof value === 'object' && typeof value._bsontype === 'string') {
    return value.toString();
  }

  if (typeof value === 'object') {
    return Object.keys(value).sort().reduce(function(acc, key) {
      if (VOLATILE_FIELDS.indexOf(key) >= 0) {
        return acc;
      }

      acc[key] = canonical(value[key]);
      return acc;
    }, {});
  }

  return value;
}

/**
 * A canonical projection of every seeded document, `_id`s included.
 *
 * This is the artifact the determinism check compares: run `seed()` in two
 * processes against two fresh databases, take this projection in each, and the
 * two must be identical. Anything that differs is either a field this file
 * failed to fix or a field that belongs in VOLATILE_FIELDS with a reason.
 *
 * @returns {Promise<Object>} model name -> array of canonical documents,
 *   ordered by `_id`
 */
async function projection() {
  assertConnection();

  var map     = idsForGroups(GROUP_ORDER);
  var models  = Object.keys(map).sort();
  var result  = {};
  var i, model, objectIds, documents;

  for (i = 0; i < models.length; i++) {
    model     = models[i];
    objectIds = map[model].map(function(id) {
      return new mongoose.Types.ObjectId(id);
    });

    documents = await privateModel(model).collection
      .find({ _id : { $in : objectIds } })
      .sort({ _id : 1 })
      .toArray();

    result[model] = documents.map(canonical);
  }

  return result;
}

// ---------------------------------------------------------------------------
// The self-check
// ---------------------------------------------------------------------------

/**
 * Proves the seeded state satisfies every contract this file claims.
 *
 * Assumes a FULL seed: it asserts that every fixed id resolves, so calling it
 * after a subset seed correctly reports the groups that were not asked for as
 * missing. A harness that seeds a subset should assert its own groups rather
 * than call this.
 *
 * Failures are COLLECTED and reported together rather than thrown one at a
 * time: a fixture set with three problems should say so once, because fixing
 * them one run at a time is how a broken corpus takes an afternoon.
 *
 * @returns {Promise<{checks: number, failures: string[]}>}
 * @throws {Error} If any check fails. The message lists every failure.
 */
async function verify() {
  assertConnection();

  var failures = [];
  var checks   = 0;

  function check(description, condition) {
    checks++;

    if (!condition) {
      failures.push(description);
    }
  }

  // 1. Every fixed id resolves to exactly one document.
  var map    = idsForGroups(GROUP_ORDER);
  var models = Object.keys(map);
  var i, j, model, id, count;

  for (i = 0; i < models.length; i++) {
    model = models[i];

    for (j = 0; j < map[model].length; j++) {
      id    = map[model][j];
      count = await privateModel(model).collection.countDocuments({
        _id : new mongoose.Types.ObjectId(id)
      });

      check(model + ' ' + id + ' exists exactly once (found ' + count + ')',
            count === 1);
    }
  }

  // 2. Every `missing*` id resolves to nothing. `missingUser` carries a
  //    behavioural contract - app.js:255-259 - and the rest exist so a `{id}`
  //    route has an input that resolves to no document.
  for (i = 0; i < MISSING_IDS.length; i++) {
    count = await privateModel(MISSING_IDS[i].model).collection.countDocuments({
      _id : new mongoose.Types.ObjectId(MISSING_IDS[i].id)
    });

    check('ids.' + MISSING_IDS[i].key + ' is genuinely absent from ' +
          MISSING_IDS[i].model + ' (found ' + count + ')', count === 0);
  }

  // 3. The passwords authenticate. If this fails the pre-save hook did not
  //    run, POST /login rejects, and every authenticated scenario in the
  //    corpus is unreachable - so it is checked through the model's own
  //    comparePassword rather than by inspecting the stored string.
  var models8 = loadModels();
  var seededUser  = await models8.User.findById(ids.user);
  var seededAdmin = await models8.User.findById(ids.admin);
  var disabled    = await models8.User.findById(ids.disabledUser);

  check('the seeded user was found by findById', !!seededUser);
  check('the seeded admin was found by findById', !!seededAdmin);
  check('the disabled user was found by findById', !!disabled);

  if (seededUser) {
    check('the seeded user\'s password accepts \'' + IDENTITIES.user.password + '\'',
          await seededUser.comparePassword(IDENTITIES.user.password));
    check('the seeded user is reachable by login',
          !!(await models8.User.findByLogin(IDENTITIES.user.email)));
    check('the seeded user owns the course through the course-owner role',
          seededUser.hasRole('course-owner', 'course', { id : ids.course }));
    check('the seeded user is not an admin',
          !seededUser.hasRole('admin'));
  }

  if (seededAdmin) {
    check('the admin\'s password accepts \'' + IDENTITIES.admin.password + '\'',
          await seededAdmin.comparePassword(IDENTITIES.admin.password));
    // The exact predicate lib/util/helpers.js:22 and app.js:261 use.
    check('the admin satisfies hasRole(\'admin\')', seededAdmin.hasRole('admin'));
  }

  if (disabled) {
    check('the disabled user satisfies hasRole(\'disabled\') - the predicate ' +
          'app.js:261 uses', disabled.hasRole('disabled'));
    check('the disabled user is still a user', disabled.hasRole('user'));
  }

  // 4. The content-hash contract. AAP 0.6.7: the S3 key IS a content digest,
  //    so a changed digest silently orphans every stored object. Three things
  //    must agree - the bytes, the seeded record's `hash`, and the key the
  //    record's `url` resolves to.
  var descriptors = storage();
  var names       = Object.keys(descriptors);
  var payloads    = {
    materialText       : MATERIAL_TEXT,
    materialWithFileId : MATERIAL_TEXT,
    notebook           : NOTEBOOK_JSON,
    legacyPng          : LEGACY_PNG,
    userAsset          : ASSET_GIF,
    exportArchive      : EXPORT_ZIP
  };

  for (i = 0; i < names.length; i++) {
    var name       = names[i];
    var descriptor = descriptors[name];
    var digest     = sha1Hex(payloads[name]);

    check(name + ': the payload hashes to the descriptor digest',
          digest === descriptor.sha1);
    check(name + ': the object key begins with the content digest',
          descriptor.key.indexOf(digest) === 0 ||
          descriptor.key.indexOf('exports/') === 0);
    check(name + ': the url resolves to the object key',
          keyFromUrl(descriptor.url) ===
            descriptor.key.substring(descriptor.key.lastIndexOf('/') + 1));
    check(name + ': the recorded size matches the payload',
          descriptor.size === payloads[name].length);
  }

  // 5. Each File record points at the object the fixture stored.
  var fileChecks = [
    ['file', ids.file, DIGESTS.materialText, KEYS.materialText],
    ['notebookFile', ids.notebookFile, DIGESTS.notebook, KEYS.notebook],
    ['userAssetFile', ids.userAssetFile, DIGESTS.assetGif, KEYS.userAsset],
    ['legacyImageFile', ids.legacyImageFile, DIGESTS.legacyPng, KEYS.legacyPng]
  ];

  for (i = 0; i < fileChecks.length; i++) {
    var expectation = fileChecks[i];
    var fileDoc     = await privateModel('File').findById(expectation[1]).exec();

    check('File ' + expectation[0] + ' was found', !!fileDoc);

    if (fileDoc) {
      check('File ' + expectation[0] + ' carries the content digest as its hash',
            fileDoc.hash === expectation[2]);
      check('File ' + expectation[0] + '\'s url resolves to ' + expectation[3],
            keyFromUrl(fileDoc.url) === expectation[3]);
    }
  }

  // 6. The legacy record is the only one whose `type` reaches the image branch
  //    of lib/controllers/files.js:153 - and it must have survived the enum.
  var legacy = await privateModel('File').findById(ids.legacyImageFile).exec();
  check('the legacy file record kept its mime-like `type`, which the enum ' +
        'would now reject and which is the only way into the image download ' +
        'branch', !!legacy && /^image/.test(legacy.type));

  // 7. The asset metric settled at the value the seeded set implies, whatever
  //    the unawaited hook did.
  var assetFile = await privateModel('File').findById(ids.userAssetFile).exec();
  check('the asset file records exactly one referencing trinket',
        !!assetFile && assetFile.metrics && assetFile.metrics.trinkets === 1);

  // 8. Both code shapes lib/workers/exports.js:334-352 branches on are present.
  var shapes = Object.keys(fixtures.trinkets).map(function(key) {
    return fixtures.trinkets[key].codeShape;
  });

  check('at least one trinket carries a JSON file array',
        shapes.indexOf('json-file-array') >= 0);
  check('at least one trinket carries a raw code string',
        shapes.indexOf('raw-string') >= 0);

  // 9. Every trinket's derived hash is the value hashify() computes from the
  //    fixed seed, and its shortCode is the fixed one. This is what proves the
  //    hash was DERIVED rather than defaulted, and that Date.now() never
  //    reached the shortCode.
  for (i = 0; i < TRINKETS.length; i++) {
    var spec        = TRINKETS[i];
    var trinketDoc  = await privateModel('Snippet').findById(spec._id).exec();
    var ownerId     = ids[spec.owner];
    var expectedHash = sha1Hex(Buffer.from(
      spec.code + spec.lang + ownerId + ownerId + '', 'utf8'
    ));

    check('trinket ' + spec.key + ' was found', !!trinketDoc);

    if (trinketDoc) {
      check('trinket ' + spec.key + ' kept its fixed shortCode',
            trinketDoc.shortCode === spec.shortCode);
      check('trinket ' + spec.key + '\'s hash is the one hashify() derives ' +
            'from its fixed seed', trinketDoc.hash === expectedHash);
    }
  }

  // 10. The export records reach the branches they exist for.
  var completed = await privateModel('Export').findById(ids.exportCompleted).exec();
  var expired   = await privateModel('Export').findById(ids.exportExpired).exec();
  var pending   = await privateModel('Export').findById(ids.exportPending).exec();

  check('the completed export is completed',
        !!completed && completed.status === 'completed');
  check('the completed export\'s s3Key has the exports/<userId>/<filename> ' +
        'form lib/workers/exports.js:104 builds',
        !!completed && completed.s3Key === 'exports/' + ids.user + '/' +
          fixtures.exportArchive.filename);
  check('the completed export has not expired, so the download branch is ' +
        'reachable', !!completed && completed.expiresAt > new Date());
  check('the expired export has expired, so lib/controllers/users.js:1293 is ' +
        'reachable', !!expired && expired.expiresAt < new Date());
  check('the pending export is pending, so the in-flight branch is reachable',
        !!pending && pending.status === 'pending');

  // 11. The folder and its reverse references, without which the queryless
  //     folders.trinkets quirk cannot be distinguished from the query-bearing
  //     one.
  var folderDoc = await privateModel('Folder').findById(ids.folder).exec();

  check('the folder was found', !!folderDoc);
  check('the folder lists both member trinkets',
        !!folderDoc && folderDoc.trinkets.length === FOLDER_TRINKET_KEYS.length);

  for (i = 0; i < FOLDER_TRINKET_KEYS.length; i++) {
    var memberId  = ids[FOLDER_TRINKET_KEYS[i]];
    var memberDoc = await privateModel('Snippet').findById(memberId).exec();

    check('trinket ' + FOLDER_TRINKET_KEYS[i] + ' carries the reverse folder ' +
          'reference the trinket list filters on',
          !!memberDoc && !!memberDoc.folder && !!memberDoc.folder.folderId &&
            memberDoc.folder.folderId.toString() === ids.folder);
  }

  // 12. The course tree has the concrete path segments its route family needs.
  var courseDoc = await privateModel('Course').findById(ids.course).exec();
  var lessonDoc = await privateModel('Lesson').findById(ids.lesson).exec();

  check('the course was found', !!courseDoc);
  check('the course lists both lessons',
        !!courseDoc && courseDoc.lessons.length === 2);
  check('the course carries the fixed access code',
        !!courseDoc && courseDoc.accessCode === fixtures.course.accessCode);
  check('the course slug is the recorded one',
        !!courseDoc && courseDoc.slug === fixtures.slugs.course);
  check('the lesson lists both materials',
        !!lessonDoc && lessonDoc.materials.length === 2);

  if (failures.length) {
    throw new Error(
      LOG_PREFIX + failures.length + ' of ' + checks + ' fixture checks ' +
      'failed:\n  - ' + failures.join('\n  - ')
    );
  }

  return { checks : checks, failures : failures };
}

// ---------------------------------------------------------------------------
// Direct execution - the self-check
// ---------------------------------------------------------------------------

var USAGE = [
  'Usage: node test/parity/seed.js [--verify] [--overlay <path>]',
  '',
  'Starts an isolated in-memory MongoDB through test/parity/mongo.js, seeds',
  'the fixtures, runs every fixture check, prints the determinism projection',
  'to stdout and stops the server. Exits 0 only if every check passed.',
  '',
  '  --verify           the default action; accepted explicitly',
  '  --overlay <path>   NODE_CONFIG overlay to apply beneath the address',
  '                     (defaults to test/parity/server-overlay.json, which is',
  '                     what supplies the aws.buckets.exports entry that',
  '                     config/default.yaml lacks - see AAP 0.6.7)',
  '  --help, -h         this message'
].join('\n');

/**
 * Writes a line to stderr. Every human-readable byte this file produces goes
 * there, because the determinism projection goes to stdout as an artifact.
 *
 * @param {string} message
 */
function note(message) {
  process.stderr.write(LOG_PREFIX + message + '\n');
}

/**
 * The self-check entry point.
 *
 * The environment is published BEFORE anything requires `config` or a model:
 * `config` 0.4.37 freezes on first require, and the models are resolved lazily
 * precisely so this ordering is available. The connection is opened here rather
 * than through `config/db.js` because that module connects at module scope from
 * whatever configuration is loaded at the time, and this path has to publish
 * the address first.
 *
 * @param {string[]} [argv] defaults to process.argv.slice(2)
 * @returns {Promise<number>} the process exit code
 */
async function main(argv) {
  var args    = argv || process.argv.slice(2);
  var overlay = mongo.DEFAULT_OVERLAY;
  var i, arg;

  for (i = 0; i < args.length; i++) {
    arg = args[i];

    if (arg === '--help' || arg === '-h') {
      process.stderr.write(USAGE + '\n');
      return 0;
    }

    if (arg === '--verify') {
      continue;
    }

    if (arg === '--overlay') {
      if (args[i + 1] === undefined || args[i + 1].charAt(0) === '-') {
        note('--overlay requires a path');
        process.stderr.write(USAGE + '\n');
        return 2;
      }
      overlay = args[i + 1];
      i++;
      continue;
    }

    note('unrecognized argument: ' + arg);
    process.stderr.write(USAGE + '\n');
    return 2;
  }

  return await mongo.withMongo(async function(info) {
    var summary, report, artifact;

    process.env.NODE_ENV = process.env.NODE_ENV || 'test';
    process.env.NODE_CONFIG_PERSIST_ON_CHANGE = mongo.PERSIST_ON_CHANGE;
    process.env.NODE_CONFIG = info.nodeConfig;

    // The same pin config/db.js:8 applies, so this path emits no Mongoose 7
    // DeprecationWarning either - the zero-warning gate covers this tooling's
    // stderr as well as the application's.
    mongoose.set('strictQuery', true);

    note('connecting to ' + info.uri);
    await mongoose.connect(info.uri);

    try {
      summary = await seed();
      note('seeded groups: ' + summary.selected.join(', '));
      note('created: ' + JSON.stringify(summary.created));

      report = await verify();
      note(report.checks + ' fixture checks passed');

      // Idempotence, proven in this process rather than asserted: a second
      // call must create nothing and throw nothing.
      summary = await seed();
      note('second seed created: ' + JSON.stringify(summary.created));

      if (Object.keys(summary.created).length) {
        throw new Error(
          LOG_PREFIX + 'the second seed() created documents, so seeding is ' +
          'not idempotent: ' + JSON.stringify(summary.created)
        );
      }

      artifact = await projection();
      process.stdout.write(JSON.stringify(artifact, null, 2) + '\n');

      return 0;
    }
    finally {
      await mongoose.disconnect();
    }
  }, { overlay : mongo.readOverlay(overlay) });
}

module.exports = {
  // The fixtures.
  ids         : ids,
  credentials : Object.freeze({
    user     : IDENTITIES.user,
    admin    : IDENTITIES.admin,
    disabled : IDENTITIES.disabled
  }),
  fixtures    : fixtures,
  GROUPS      : Object.freeze(GROUP_ORDER.slice()),
  MISSING_IDS : MISSING_IDS,

  // The operations.
  seed   : seed,
  reset  : reset,
  verify : verify,

  // Resolved against the configuration in force, so a harness asserts against
  // the same values the seeded records carry.
  storage    : storage,
  s3Manifest : s3Manifest,

  // Building blocks, exported because each has a failure mode worth testing
  // directly and because a sibling harness should never need a second copy.
  keyFromUrl       : keyFromUrl,
  projection       : projection,
  resolveSelection : resolveSelection,
  idsForGroups     : idsForGroups,
  exportFilename   : exportFilename,
  sha1Hex          : sha1Hex,
  isJsonFileArray  : isJsonFileArray,
  VOLATILE_FIELDS  : VOLATILE_FIELDS,
  USAGE            : USAGE,
  main             : main
};

if (require.main === module) {
  main()
    .then(function(code) {
      process.exitCode = code;
    })
    .catch(function(err) {
      note((err && err.message) || String(err));

      if (err && err.stack) {
        process.stderr.write(err.stack + '\n');
      }

      process.exitCode = 1;
    });
}
