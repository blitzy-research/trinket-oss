// Captured mail for the parity harness - no transport, no socket, no DNS.
//
// One of the three external-effect interceptors under test/parity/fixtures/.
// It installs itself on first require, is preloaded by test/parity/server.js
// before the application, and is required directly by test/parity/worker.js,
// the only observer of the export worker's notification mail. Node core only,
// CommonJS, no CLI arguments, no console output.
//
// INVOCATION
//   node --require <worktree>/test/parity/fixtures/mail.js app.js  (server.js)
//   require('<worktree>/test/parity/fixtures/mail.js')             (worker.js)
//   PARITY_APP_ROOT  the worktree under test, for resolving its mailer and
//                    its `config`; falls back to process.cwd(). `__dirname`
//                    would resolve the TARGET tree on a baseline run.
//   PARITY_MAIL_LOG  the evidence file; unset, calls are kept in memory only
//                    and nothing is written. These two are every variable
//                    read, and no unset or malformed value throws.
//
// ARTIFACT
//   One JSONL record per captured call, appended as the call happens; flush()
//   rewrites the file with the same set. Keys in fixed order:
//   {"event":"send","sequence":0,"type":"password-reset","redacted":true,
//    "to"/"subject":{kind,length,digest}, "options":{keys,values}}
//   <PARITY_MAIL_LOG>.notes.jsonl carries the fixture's OWN records -
//   unresolved mailer, failed patch, mail-feature evaluation - because
//   capture.js and replay.js report the send file's line count as the number
//   of mails a run captured. Both files are created 0600, and the path is the
//   CALLER's: no directory is created and nothing is removed at exit. A write,
//   mode or flush fault is recorded in memory, never thrown or printed, since
//   a preload that throws kills the server before app.js loads.
//
// SUBSTITUTION IS AT THE MODULE BOUNDARY
// lib/util/mailer.js's `isConfigured` reads only app.mail.from and
// app.mail.host, which the overlay sets, so mail IS configured and every
// `mailer.send` would otherwise dial SMTP through nodemailer. The mailer
// exports a plain object whose `send` each call site resolves at call time, so
// replacing that property reaches consumers on either side of this preload;
// the genuine one is kept only for restore(), and `isConfigured` stays
// UNPATCHED, its result being what seven configuration gates branch on.
// Nothing under config/db, config/app.config or lib/models/** is required
// here, since that would let `mongoose-schema-extend` make @hapi/hapi
// unloadable for the process; and neither `sinon` nor `q` is required, the
// baseline worktree being preloaded with this same file.
//
// THE STUB NEVER REJECTS, AND SYNTHESIZES NOTHING
// It resolves one benign frozen value on every path:
// lib/controllers/trinket.js's share-threshold handler returns the promise and
// its `.catch` leaves any other rejection unsettled, hanging that route, while
// the un-awaited sites turn a rejection into an unhandled rejection that
// terminates the process. No call site sits behind an isConfigured() gate, so
// `options` legitimately carries html, text, type, replyTo or address, `type`
// is legitimately ABSENT at the admin site, and the record keeps whatever
// arrived. lib/workers/exports.js configures nunjucks only when NOT
// config.isTest, so under NODE_ENV=test its completion path throws before
// `mailer.send` and a missing 'export-ready' capture is a true observation.
// Replacing `send` wholesale also bypasses the mailer's unconfigured
// short-circuit and its `_.extend({from, to, subject}, options)` defaulting,
// so a record holds exactly what the CALLER passed.
//
// TWO WINDOWS, AND ONLY THE REDACTED ONE LEAVES THE PROCESS
// What the application passed is kept VERBATIM in memory, in the window
// calls() returns, and the worker gate asserts recipient, subject and rendered
// body off it. reset() clears that window only - `sequence` keeps counting, so
// the file stays alignable with it. Nothing verbatim is written: these bodies
// carry live recovery URLs, invitation tokens and recipient addresses, which a
// retained artifact would persist in plaintext (CWE-532). A persisted string
// becomes {kind, length, digest} with a full sha256 a reviewer can recompute,
// plus URL SKELETONS - origin and path, parameter names without values - so no
// rendered HTML and no secret reaches the file, and nothing generated or
// timestamped is recorded. evidence() exports that projection for a consumer
// building an artifact of its own.
//
// OPTIONS BECOME A DESCRIPTION, NEVER A VALUE. `keys` is the sorted key list -
// so replyTo, address, text or html appearing or disappearing is visible - and
// each value is a typed descriptor: a string as {kind, length, digest, urls},
// `type` as {kind:'marker', value}, a number or boolean as {kind, value}, null
// or undefined as {kind:'null'}, an array as {kind:'array', length}, an object
// as {kind:'object', keys}, anything else as its typeof. No string value and
// no rendered HTML reaches the file on any path.
//
// THE URL SKELETON KEEPS THE ROUTE, NOT THE SECRET. Every http(s) URL found in
// a string field is reduced to its origin and path, with every QUERY and
// FRAGMENT value replaced by the literal REDACTED while the parameter NAMES
// are kept, and every credential-shaped PATH segment replaced by REDACTED.
// Both rules are measured against the eight call sites listed above rather
// than assumed. Parameter names are the actual parity signal - that
// the reset mail links to the reset route with a `key` parameter is what a
// reviewer needs, and lib/controllers/users.js:306, :1319 and :1331 put the
// live key in exactly that position. The path rule exists because
// lib/models/courseInvitation.js:37,70 puts an 8-character md5 token in a path
// SEGMENT instead - '/courses/accept/<token>' - so a rule that only redacted
// long segments would leak a live invitation token. Userinfo never survives:
// the skeleton is built from URL.origin, which excludes it. The list is
// deduplicated and capped, with an explicit truncation marker, so a
// pathological body cannot produce an unbounded line. Parsing is `new URL`,
// never url.parse, which emits DEP0169 inside the warning gate this file runs
// in (AAP 0.8).
//
// DETERMINISM IS NOW COMPLETE, WHICH IS A GAIN R-d PERMITS BECAUSE IT IS THE
// ARTIFACT AND NOT THE APPLICATION. There is no timestamp, no message id and
// no generated value in a record, and the one field that used to differ
// between two runs of the same behaviour - a password-reset URL carrying a
// crypto.randomBytes key - is now that URL's skeleton, which is identical
// across runs. Two runs of the same behaviour therefore produce byte-identical
// files, and the file is a diff a reviewer can read. What the application
// actually sent is unchanged and is asserted from memory (R-d).
//
// A record for the fixture itself - a mailer that could not be resolved, a
// failed patch, the mail-feature evaluation - is written the same way, with a
// different event name and a `detail` field, but to the SIDECAR
// '<PARITY_MAIL_LOG>.notes.jsonl' rather than to the send stream. The send
// stream is a count: test/parity/capture.js:4269-4278 and
// test/parity/replay.js:5027-5033 report its line count as the number of mails
// a run captured, so a diagnostic in it is a mail the application never sent,
// and the mail-feature record is written on EVERY install, which would make
// that miscount unconditional. Those details carry fixture-internal literals,
// filesystem paths, booleans and digests only; see note() and notePath().
//
// ONE CONSUMER-SIDE OBLIGATION THIS FIXTURE CANNOT DISCHARGE, and it is why
// evidence() is exported. calls() is raw by contract, so a consumer that copies
// it into a retained artifact of its own re-creates the leak this file closes:
// a harness building an artifact must serialize evidence() - the redacted
// projection, exported for exactly this purpose - and keep calls() for
// in-memory assertions only. test/parity/worker.js did copy the raw window,
// writing `to` and `subject` verbatim into the per-job projection it
// serializes; it now keeps calls() for its assertions and persists a slice of
// evidence() instead, taken per job by offset because reset() clears only the
// assertion window. The obligation itself is still the consumer's - this file
// cannot stop one reading calls() - so it stays stated here.
//
// THE MAIL FEATURE IS CLIENT-VISIBLE, SO ITS STATE IS ASSERTED HERE
// lib/util/routeParser.js's addUserContext puts json.emailEnabled on every
// page carrying user context, so mail configuration is a corpus-wide
// precondition. evaluateMailFeature() re-computes it against the application's
// own `config` at install time and compares it with REQUIRED_EMAIL_ENABLED,
// which is falsy; a gate reads status().mailFeature.ok or featureState().
// config is READ and never written, and a violation keeps `installed` true
// rather than handing the genuine `send` back.

'use strict';

var fs = require('fs');
var path = require('path');
var crypto = require('crypto');

// ---------------------------------------------------------------------------
// Constants.
// ---------------------------------------------------------------------------

// Resolved against PARITY_APP_ROOT, never against __dirname, which on a
// baseline run resolves the TARGET tree's mailer instead.
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

// The single literal that stands in for every removed value, so a reviewer can
// grep one word to find everything the projection withheld.
var REDACTED = 'REDACTED';

// The persisted line's upper bound on URL skeletons. Eight is far above what
// the templates under lib/views/emails produce: six carry exactly ONE action
// URL - passwordReset, verifyEmail, confirmEmailChange, course-invitation,
// export-ready and shareTrinket, one `href` each - and export-failed and
// footer.html carry none. A body that produced more is
// truncated with the marker below rather than growing the line without limit.
var MAX_URL_SKELETONS = 8;
var URL_TRUNCATION_MARKER = 'urls-truncated';

// http(s) URLs inside a rendered body. Stops at whitespace and at the
// characters that delimit a URL in HTML or in prose, so an href's closing
// quote or a sentence's bracket is not swallowed into the match.
var URL_PATTERN = /https?:\/\/[^\s"'<>()\[\]{}\\`]+/gi;

// Trailing punctuation a prose or markup context leaves on the end of a match.
var URL_TRAILING_PUNCTUATION = /[.,;:!?]+$/;

// Path-segment shapes that are credentials rather than route names. Each
// disjunct in isCredentialSegment() below names the call site it covers; the
// character class is the union of the token alphabets those sites produce
// (hex, base64url and JWT), so a human-readable route name never matches it
// unless it is also long enough and digit-bearing to be indistinguishable from
// a key.
var TOKEN_SEGMENT_PATTERN = /^[A-Za-z0-9._~+=-]+$/;
var HEX_SEGMENT_PATTERN = /^[0-9a-fA-F]{8,}$/;
var JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/;
var DIGIT_PATTERN = /[0-9]/;
var OPAQUE_SEGMENT_MIN_LENGTH = 16;
var OPAQUE_SEGMENT_ALWAYS_LENGTH = 24;

// The digest algorithm and its label. Named once so the label in the artifact
// and the algorithm that produced it cannot drift apart.
var DIGEST_ALGORITHM = 'sha256';

// Mode for the evidence file. The artifact is redacted, but it is also
// RETAINED - test/parity/server.js and test/parity/worker.js keep the run
// directory for a reviewer - so it is created owner-only rather than at the
// process umask's ambient 0644. The run DIRECTORY's mode is set by the tool
// that creates it and is not touched from here.
var LOG_FILE_MODE = 0o600;

// The mail-feature invariant this fixture asserts: `emailEnabled` must be
// falsy in the parity run, because lib/util/routeParser.js's addUserContext
// puts it on every rendered page that carries user context.
var REQUIRED_EMAIL_ENABLED = false;

// The sidecar the fixture's own diagnostics are written to, appended to
// whatever PARITY_MAIL_LOG names. Derived rather than configured, so the
// authoritative environment contract stays at two entries; see notePath() for
// why the diagnostics cannot share the send stream.
var NOTE_LOG_SUFFIX = '.notes.jsonl';

// ---------------------------------------------------------------------------
// Module state. Held in one object so that install()/restore() are idempotent
// and so a second require() of this file - which returns the same cached
// exports - cannot double-patch anything or lose the genuine `send`.
//
// Four collections, deliberately, because they answer four different
// questions - and the first is the only one that holds what the application
// passed:
//   calls     the ASSERTION WINDOW, raw and IN MEMORY ONLY. reset() clears it,
//             so a harness can bound one export job's mail to one assertion.
//   evidence  the PERSISTED PROJECTION of the sends, as redacted records. 1:1
//             with `log`.
//   log       the same projection as capture-time encoded lines. reset() never
//             clears it, so flush() at the end of a run - or from the exit
//             hook - cannot truncate away evidence that a mid-run reset()
//             dropped from the window.
//   noteLog   the fixture's OWN diagnostics as encoded lines, kept apart from
//             `log` because they are not mail. test/parity/capture.js and
//             test/parity/replay.js report `mailLog.records.length` as the
//             number of captured mails and bucket every line by `type`, so a
//             diagnostic sharing that file is counted as a mail that was never
//             sent - and the mail-feature record below is written on EVERY
//             install, which would make the miscount unconditional. The two
//             streams therefore go to two paths.
// Nothing from `calls` is ever written; nothing in `evidence`, `log` or
// `noteLog` carries a recipient, a subject or a body.
// ---------------------------------------------------------------------------
var state = {
  installed        : false,
  mailer           : null,  // the exports object whose `send` was swapped
  originalSend     : null,  // the genuine `send`, held only for restore()
  resolvedPath     : null,  // absolute path of the patched module
  diagnostic       : null,  // why the install is inactive, when it is
  exitHookInstalled: false,

  // Which paths this process has already tightened to LOG_FILE_MODE, keyed by
  // the path itself rather than by a single boolean: PARITY_MAIL_LOG is read on
  // every write, so a harness that re-points it mid-process has a second file
  // to tighten, and one flag would leave the second file at the ambient 0644.
  // Recorded only on SUCCESS, so a chmod that failed is retried on the
  // next write instead of being abandoned, while `modeFaults` keeps the report
  // of a failing path to one note.
  tightened        : {},
  modeFaults       : {},

  mailFeature      : null,  // the evaluated emailEnabled invariant, when known
  sequence         : 0,     // sends in process order; reset() does not clear it
  calls            : [],    // assertion window: raw records, never persisted
  notes            : [],    // records about the fixture itself, not about mail
  evidence         : [],    // complete send evidence: redacted records, in order
  log              : [],    // the same records as encoded lines, in order
  noteLog          : []     // the fixture's own diagnostics, as encoded lines
};

// ---------------------------------------------------------------------------
// Evidence log. Nothing in this section may throw into the application and
// nothing may emit to stdout or stderr: the zero-warning gate captures both
// streams for the whole run, and three of the eight call sites do
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

// The class name of an unknown thrown value, restricted to an identifier so
// that no thrown object can smuggle arbitrary text through it. Used where the
// thrown value may have been produced by caller data - see note() - and the
// message itself must therefore not be recorded.
function nameOf(err) {
  var candidate = null;

  try {
    if (err && err.constructor && typeof err.constructor.name === 'string') {
      candidate = err.constructor.name;
    }
  }
  catch (e) {
    candidate = null;
  }

  return candidate !== null && /^[A-Za-z][A-Za-z0-9_]*$/.test(candidate)
    ? candidate
    : 'unknown';
}

// The message of an unknown thrown value, for a diagnostic. Never throws.
function reasonOf(err) {
  if (err && typeof err === 'object' && typeof err.message === 'string') {
    return err.message;
  }

  var text = safeText(err);
  return text === null ? 'unknown error' : text;
}

// ---------------------------------------------------------------------------
// Redaction. Everything in this section runs BETWEEN the in-memory assertion
// window and the encoder, and it is the only thing the encoder is ever handed
// for a send: the raw record never reaches encode(), which is what makes the
// artifact structurally unable to carry a recipient, a subject or a body
// rather than merely unlikely to. The file header's ARTIFACT block carries the
// persisted schema.
//
// Every function here is total: it accepts the caller's own objects, including
// a throwing getter or a Proxy, and returns a plain describable value without
// throwing, because three of the eight call sites do not await the promise and
// a throw would become an unhandled rejection.
// ---------------------------------------------------------------------------

// Full, untruncated sha256 hex of a string, labelled with its algorithm. This
// is the verification channel: a reviewer who knows the value they expect can
// reproduce the digest and compare, while the digest itself reveals nothing.
// Returns null if the hash could not be computed, so a caller can distinguish
// "no digest" from a digest of the empty string.
function digestOf(text) {
  try {
    return DIGEST_ALGORITHM + ':' +
      crypto.createHash(DIGEST_ALGORITHM).update(String(text), 'utf8').digest('hex');
  }
  catch (e) {
    return null;
  }
}

// True when a URL path segment is a credential rather than a route name. Each
// disjunct covers a call site:
//   HEX_SEGMENT_PATTERN starts at EIGHT characters because
//     lib/models/courseInvitation.js builds its invitation token as
//     crypto.createHash('md5').update(email + course.id).digest('hex')
//     .substring(0, 8) and puts it in a path segment - the one mail URL whose
//     secret is in the path - so a rule that only redacted long segments would
//     leak a live token. Eight also covers the 24-character ObjectId in
//     lib/workers/exports.js's download URL, whose skeleton becomes
//     /api/exports/REDACTED/download and still shows the route.
//   JWT_SEGMENT_PATTERN covers a dot-separated signed token in a path. No
//     template links with one today - the trinket share token is a
//     `jsonwebtoken` value lib/controllers/trinket.js keeps in the yar
//     session, not in a URL - so this disjunct is here so that a template
//     that later does cannot leak it silently.
//   The length rules cover an opaque key of an unknown shape: digit-bearing
//     from sixteen characters, and unconditional from twenty-four, which is
//     past any route name this application uses.
function isCredentialSegment(segment) {
  if (!segment || !TOKEN_SEGMENT_PATTERN.test(segment)) {
    return false;
  }

  return HEX_SEGMENT_PATTERN.test(segment) ||
    JWT_SEGMENT_PATTERN.test(segment) ||
    (segment.length >= OPAQUE_SEGMENT_MIN_LENGTH && DIGIT_PATTERN.test(segment)) ||
    segment.length >= OPAQUE_SEGMENT_ALWAYS_LENGTH;
}

// Reduces one URL to its skeleton: the origin and the path with credential
// segments removed, the query's parameter NAMES with every value removed, and
// a fragment reduced to the marker if one was present. URL.origin is what
// drops any userinfo, and it is used rather than the href's prefix for exactly
// that reason. Returns null when the value does not parse as an absolute URL,
// which is the only outcome for a relative or malformed match.
function urlSkeleton(candidate) {
  var parsed;
  var skeleton;
  var names = [];

  try {
    // `new URL`, never url.parse: url.parse emits DEP0169 and this file runs
    // inside the --pending-deprecation gate.
    parsed = new URL(candidate);
  }
  catch (e) {
    return null;
  }

  try {
    skeleton = parsed.origin + parsed.pathname
      .split('/')
      .map(function (segment) {
        return isCredentialSegment(segment) ? REDACTED : segment;
      })
      .join('/');

    parsed.searchParams.forEach(function (value, name) {
      names.push(name);
    });

    if (names.length) {
      skeleton += '?' + names.map(function (name) {
        return name + '=' + REDACTED;
      }).join('&');
    }

    if (parsed.hash) {
      skeleton += '#' + REDACTED;
    }

    return skeleton;
  }
  catch (e) {
    return null;
  }
}

// The deduplicated, capped list of URL skeletons a string contains, in the
// order they appear. A body with more than MAX_URL_SKELETONS distinct URLs
// ends with the truncation marker and the number withheld, so the line stays
// bounded and the truncation is visible rather than silent.
function urlSkeletons(text) {
  var found;
  var skeletons = [];
  var withheld = 0;

  try {
    found = String(text).match(URL_PATTERN);
  }
  catch (e) {
    return skeletons;
  }

  if (!found) {
    return skeletons;
  }

  found.forEach(function (candidate) {
    var skeleton = urlSkeleton(candidate.replace(URL_TRAILING_PUNCTUATION, ''));

    if (skeleton === null || skeletons.indexOf(skeleton) !== -1) {
      return;
    }

    if (skeletons.length >= MAX_URL_SKELETONS) {
      withheld++;
      return;
    }

    skeletons.push(skeleton);
  });

  if (withheld) {
    skeletons.push(URL_TRUNCATION_MARKER + ':' + withheld);
  }

  return skeletons;
}

// An identifier for a value whose content must not be persisted: its kind, its
// length and its digest. Used for `to` and `subject`, which are a recipient
// address and a subject line, and for every string inside `options`.
// `kind` distinguishes a genuine absence from a value of length zero, which a
// digest alone could not.
function identityOf(value) {
  var text;

  if (value === undefined || value === null) {
    return { kind: 'null' };
  }

  text = safeText(value);

  if (text === null) {
    // The value could not be coerced at all - a throwing toString() or
    // valueOf(), or a revoked Proxy. Its presence is recorded and nothing
    // else can be. A Symbol is NOT this case, because String() on a Symbol
    // succeeds; it is recorded below as kind 'symbol' with the digest
    // of its description, which reveals nothing.
    return { kind: 'uncoercible' };
  }

  return { kind: typeof value, length: text.length, digest: digestOf(text) };
}

// The identity of a field that redact() has already reduced. An identity-
// shaped object passes through unchanged; anything else is reduced to one.
// encode()'s fallback uses this rather than the field itself so that it cannot
// emit raw text even if it is reached with a record shape that does not exist
// on any path today - which is what makes "no recipient is ever written"
// structural rather than a property of the call order.
function identityFrom(value) {
  if (value && typeof value === 'object' && typeof value.kind === 'string') {
    return value;
  }

  return identityOf(value);
}

// A typed descriptor for one `options` member. The `type` discriminator is the
// one member whose VALUE is carried through, as a marker: it is a fixed
// template name the call site chose - never user or generated content - and
// every gate keys on it. Everything else becomes shape, length and digest.
// The value is read by the caller of this function, so a throwing getter is
// that caller's problem to guard; describeOptions() does the guarding.
function describeMember(name, value) {
  var kind = typeof value;

  if (name === 'type' && kind === 'string') {
    return { kind: 'marker', value: value };
  }

  if (value === undefined || value === null) {
    return { kind: 'null' };
  }

  if (kind === 'string') {
    return {
      kind  : 'string',
      length: value.length,
      digest: digestOf(value),
      urls  : urlSkeletons(value)
    };
  }

  if (kind === 'number' || kind === 'boolean') {
    return { kind: kind, value: value };
  }

  if (Array.isArray(value)) {
    return { kind: 'array', length: value.length };
  }

  if (kind === 'object') {
    return { kind: 'object', keys: safeKeys(value) };
  }

  // A function, a symbol or a bigint. No call site passes one; the kind is
  // recorded so that one appearing is visible rather than dropped.
  return { kind: kind };
}

// The own enumerable key names of a value, sorted, or an empty list when they
// cannot be read - a Proxy whose ownKeys trap throws. Sorted rather than
// insertion-ordered so that two runs produce the same line for the same set.
function safeKeys(value) {
  try {
    return Object.keys(value).sort();
  }
  catch (e) {
    return [];
  }
}

// The structural description of an `options` argument: its sorted key names,
// so a member appearing or disappearing is visible, and one descriptor per
// member. Each member is read inside its own guard, because the object belongs
// to the caller and a throwing getter must reduce that ONE member to an
// unreadable marker rather than lose the whole record. A non-object argument -
// which no call site passes - is described by the same descriptor function, so
// there is no shape this cannot summarize.
function describeOptions(options) {
  var keys;
  var values = {};

  if (options === undefined || options === null) {
    return { kind: 'null' };
  }

  if (typeof options !== 'object') {
    return describeMember(null, options);
  }

  keys = safeKeys(options);

  keys.forEach(function (name) {
    try {
      values[name] = describeMember(name, options[name]);
    }
    catch (e) {
      values[name] = { kind: 'unreadable' };
    }
  });

  return { keys: keys, values: values };
}

// The ONLY projection of a captured send that is ever persisted. `event`,
// `sequence` and `type` stay at the top level and unaltered because
// test/parity/replay.js and test/parity/capture.js read the artifact as
// records.length and countBy(records, 'type'); `redacted`
// marks the schema; everything else is a digest or a shape.
//
// `type` is carried through only when it is a STRING, which is what all eight
// call sites pass - a literal template name - and null otherwise, exactly as
// it is null for the un-typed admin alert. That is not defensive tidying: the
// discriminator is read off the caller's own `options`, so a non-string there
// would otherwise put an arbitrary caller value at the top level of the
// artifact verbatim and defeat the whole projection. Its shape is still
// visible, as options.values.type, which describeMember() reduces like any
// other member.
//
// Never throws: every field is produced by a total function above.
function redact(record) {
  return {
    event   : record.event,
    sequence: record.sequence,
    type    : typeof record.type === 'string' ? record.type : null,
    redacted: true,
    to      : identityOf(record.to),
    subject : identityOf(record.subject),
    options : describeOptions(record.options)
  };
}

// ---------------------------------------------------------------------------
// Encoding and writing.
// ---------------------------------------------------------------------------

// Encodes one record as a single JSON line. Key order is the object literal's,
// which JSON.stringify preserves, so two runs of the same behaviour produce
// byte-identical lines.
//
// Both kinds of record this is handed are built entirely from primitives - a
// redacted send projection, or a note whose detail is a literal, a path, a
// boolean or a digest - so no input reaching it defeats the encoder. The
// reduction below is the same last layer the inner catch is: it
// exists so that this function has no throwing path whatever a future record
// shape contains, and it carries the DIGESTS rather than the recipient or the
// subject, because a fallback that re-emitted raw text would reopen exactly
// the leak redact() closes. `type` is emitted only when it is a string, and a
// non-string is dropped to null rather than coerced, because String() on an
// arbitrary object is a channel for caller content.
function encode(record) {
  try {
    return JSON.stringify(record);
  }
  catch (e) {
    var reduced = {
      event   : 'send-unencodable',
      sequence: typeof record.sequence === 'number' ? record.sequence : null,
      type    : typeof record.type === 'string' ? record.type : null,
      redacted: true,
      to      : identityFrom(record.to),
      subject : identityFrom(record.subject),
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

// Tightens the evidence file to LOG_FILE_MODE, once per process. The `mode`
// option on a write applies only when the file is CREATED, and it is further
// masked by the process umask, so a file the harness happened to create first
// - or a run under a permissive umask - would otherwise stay at the ambient
// 0644. One chmod after the first successful write covers
// both cases. A failure is recorded in memory only, exactly as a write fault
// is, and never through note(), because note() writes to the file this
// function is repairing and would recurse.
function tightenLogMode(target) {
  if (state.tightened[target]) {
    return;
  }

  try {
    fs.chmodSync(target, LOG_FILE_MODE);
    state.tightened[target] = true;
  }
  catch (e) {
    // Not marked as done, so the next write to this path tries again - a
    // transient failure must not leave a retained artifact readable to every
    // account on the host. The REPORT is what is deduplicated, once per path,
    // so a permanently failing chmod cannot fill the note list. The note is
    // pushed in memory only and never routed through note(): note() writes to
    // the file whose permissions are in question and would recurse.
    if (!state.modeFaults[target]) {
      state.modeFaults[target] = true;
      state.notes.push({
        event : 'log-mode-failed',
        detail: { path: target, mode: LOG_FILE_MODE, error: reasonOf(e) }
      });
    }
  }
}

// The path PARITY_MAIL_LOG names, or null when it is unset. Read on every write
// rather than cached, because a harness may re-point it between assertion
// windows.
function logPath() {
  var target = process.env.PARITY_MAIL_LOG;
  return target ? target : null;
}

// Where the fixture's OWN diagnostics go: a sidecar beside the evidence file,
// derived from PARITY_MAIL_LOG rather than from a variable of its own, so the
// authoritative environment contract stays at two entries.
//
// The separation is not tidiness. test/parity/capture.js and
// test/parity/replay.js report `mailLog.records.length` as the number of mails
// a run captured and bucket every line by `type`; a diagnostic in that file is
// therefore counted as a mail the application never sent. With the
// mail-feature record written on EVERY install that miscount would be
// unconditional - a run with no mail at all would report one - and false
// external-effect evidence is worse than none. So PARITY_MAIL_LOG holds sends
// and nothing else, and the reasons a capture is missing sit next to it under
// the same owner-only mode.
function notePath() {
  var target = logPath();
  return target ? target + NOTE_LOG_SUFFIX : null;
}

// Appends one already-encoded line to `target`. The file is created owner-only:
// the artifact is retained for a reviewer, so its mode is part of the
// evidence's handling and not an incidental of the umask. A write fault is
// retained in memory ONLY - deliberately not appended, because the destination
// is what failed, and appending would recurse - and is surfaced by
// status().notes, which is where a harness looks. The directory is not
// created: the harness owns the log path, and a blind recursive mkdir is not a
// safe operation to run from inside a request.
function appendTo(target, line) {
  if (!target) {
    return null;
  }

  try {
    fs.appendFileSync(target, line + '\n', { mode: LOG_FILE_MODE });
    tightenLogMode(target);
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

// Records one captured send. TWO destinations, and only one of them leaves the
// process:
//   state.calls  the full triple as the caller passed it, plus the `type`
//                discriminator lifted out of `options` because that is how
//                every gate selects a call. IN MEMORY ONLY. This is the parity
//                oracle test/parity/worker.js asserts the recipient, the
//                subject and the rendered body against, so its shape is fixed
//                by that contract and is not reduced here.
//   state.log    the redacted projection, encoded at capture time and never
//                re-encoded, so the evidence cannot drift if a caller later
//                mutates the object it passed - and cannot carry the
//                recipient, the subject or the body at all.
// The encoder is handed redact(record) and never `record`, which is what makes
// the separation structural: there is no path from a caller's string to the
// filesystem.
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

  persist(redact(record));

  return record;
}

// Adds one SEND to the persisted evidence: the encoded line to state.log, which
// flush() rewrites from, and the record itself to state.evidence, which
// evidence() returns. The two are kept 1:1 and in the same order, so what a
// harness reads in process is exactly what a reviewer reads off disk, and
// PARITY_MAIL_LOG therefore holds exactly one line per captured mail - which is
// the count test/parity/capture.js and test/parity/replay.js report.
function persist(record) {
  var line = encode(record);

  state.evidence.push(record);
  state.log.push(line);
  appendTo(logPath(), line);

  return record;
}

// Adds one DIAGNOSTIC to the sidecar. Same encoder, same guarantees, same
// owner-only mode, different file - see notePath() for why a diagnostic must
// not share the send stream.
function persistNote(record) {
  var line = encode(record);

  state.noteLog.push(line);
  appendTo(notePath(), line);

  return record;
}

// Records something about the fixture itself rather than about a mail: a
// mailer that could not be resolved, a property that could not be replaced, an
// exit hook that could not be registered, the mail-feature evaluation. Same
// guarantees, same encoder, but kept OUT of the assertion window so calls()
// stays exactly the captured mail, and out of the SEND STREAM so a diagnostic
// is never counted as a mail (see notePath()).
//
// NO MAIL CONTENT REACHES THIS FUNCTION, and that is a property of the call
// sites rather than of a filter here. Every one of them passes fixture-internal
// literals, a module path, a filesystem path, a boolean or a digest:
// mailer-unresolvable, mailer-unloadable, mailer-shape-unexpected,
// adopted-existing-patch, property-replace-failed, restore-failed,
// exit-hook-failed, install-failed, mail-feature, mail-feature-unexpected and
// capture-failed. The one site that is reached WITH a caller's data in scope
// is capture-failed, and it deliberately passes a classification and a digest
// instead of the thrown message, because a throwing getter's message is
// caller-controlled text and would be a way to route mail content into the
// artifact around redact().
function note(event, detail) {
  var record = { event: event, detail: detail === undefined ? null : detail };

  state.notes.push(record);
  persistNote(record);

  return record;
}

// Rewrites PARITY_MAIL_LOG with the complete evidence held in memory, joining
// the capture-time lines rather than re-encoding them. Every line in state.log
// is the redacted projection encode() produced at capture time, so a flush
// cannot reintroduce raw content that an append withheld - the raw record
// exists only in state.calls, which nothing here reads. Exposed for a harness
// that wants one self-contained artifact, and called from the exit hook so a
// failed run still leaves evidence. A strict no-op when the variable is unset,
// and it never throws. Returns the path written, or null.
function flush() {
  var target = logPath();
  if (!target) {
    return null;
  }

  // The sidecar first, and unconditionally: a flush that failed on the send
  // stream must not leave the reasons behind, because the reasons are what
  // explain the failure. Its own faults are recorded by rewrite() itself.
  rewrite(notePath(), state.noteLog);

  return rewrite(target, state.log);
}

// Rewrites one stream's file from the encoded lines held in memory. Owner-only,
// tightened, guarded, and never throwing. Returns the path written, or null.
function rewrite(target, lines) {
  if (!target) {
    return null;
  }

  try {
    fs.writeFileSync(target, lines.length ? lines.join('\n') + '\n' : '',
      { mode: LOG_FILE_MODE });
    tightenLogMode(target);
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
// The replacement. Same shape as lib/util/mailer.js's `send` - an async
// function of arity three - so nothing about the call site changes: `await`,
// `.then()` and fire-and-forget all behave as they did.
//
// It NEVER rejects and NEVER throws. Every step that touches caller data
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
      // The thrown value is reachable from the caller's own object - a
      // throwing getter on `options` - so its message is caller-controlled
      // text and is recorded as a digest rather than verbatim. The class name
      // and the digest are enough to identify a fixture defect, and neither
      // can carry mail content into the artifact.
      note('capture-failed', { errorName: nameOf(e), errorDigest: digestOf(reasonOf(e)) });
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

// The worktree under test, from PARITY_APP_ROOT. `__dirname` would resolve the
// TARGET tree's mailer on a baseline run and patch an instance no controller
// holds.
function appRoot() {
  return process.env.PARITY_APP_ROOT || process.cwd();
}

// ---------------------------------------------------------------------------
// The mail-feature invariant, executable rather than described: `emailEnabled`
// must be falsy in the parity run, because addUserContext puts it on every
// rendered page that carries user context.
//
// Nothing here writes to `config`, and nothing here stores a raw predicate:
// every value that leaves this section is a boolean, because the raw values
// are `config.aws.mail.key` and `config.app.mail.key`, and the raw
// `emailEnabled` is the Mailgun DOMAIN string when credentials are present.
// ---------------------------------------------------------------------------

// The APPLICATION's own `config` instance - the one lib/util/mailer.js and
// lib/util/routeParser.js hold - resolved with the same appRoot discipline the
// mailer resolution uses. A bare require('config') would load the TARGET
// worktree's instance on a baseline run and evaluate an invariant about a
// process that is not under test. Called only after the mailer has loaded, so
// this is a require.cache hit rather than a first load.
function readAppConfig() {
  return require(require.resolve('config', { paths: [appRoot()] }));
}

// Re-computes what lib/util/routeParser.js's addUserContext computes for
// json.emailEnabled, against that instance, and compares the result with the
// state the parity run requires. The three predicates are transcribed rather
// than simplified -
// including their `&&` chains, so an absent `aws` or `app.mail` block behaves
// exactly as it does there - and each is then coerced with `!!`, which
// preserves the truthiness the application acts on while storing none of the
// values it acted on. Never throws: an unreadable `config` is an unverified
// invariant, which is reported as such rather than as a pass.
function evaluateMailFeature() {
  var cfg;
  var awsMail;
  var appMail;
  var hasAWS;
  var hasMailgun;
  var hasFrom;
  var emailEnabled;

  try {
    cfg = readAppConfig();
  }
  catch (e) {
    return {
      evaluated   : false,
      hasAWS      : false,
      hasMailgun  : false,
      hasFrom     : false,
      emailEnabled: false,
      required    : REQUIRED_EMAIL_ENABLED,
      ok          : false,
      reason      : 'the application\'s own `config` could not be read from ' +
        appRoot() + ' (' + (e && e.code ? e.code : reasonOf(e)) +
        '), so the emailEnabled invariant is unverified'
    };
  }

  try {
    awsMail = cfg.aws && cfg.aws.mail;
    appMail = cfg.app && cfg.app.mail;

    hasAWS       = !!(awsMail && awsMail.keyId && awsMail.key);
    hasMailgun   = !!(appMail && appMail.key && appMail.domain);
    hasFrom      = !!(appMail && appMail.from);
    emailEnabled = !!(hasFrom && (hasAWS || hasMailgun));
  }
  catch (e) {
    return {
      evaluated   : false,
      hasAWS      : false,
      hasMailgun  : false,
      hasFrom     : false,
      emailEnabled: false,
      required    : REQUIRED_EMAIL_ENABLED,
      ok          : false,
      reason      : 'the mail configuration could not be read from the ' +
        'application\'s own `config` instance (' + reasonOf(e) +
        '), so the emailEnabled invariant is unverified'
    };
  }

  return {
    evaluated   : true,
    hasAWS      : hasAWS,
    hasMailgun  : hasMailgun,
    hasFrom     : hasFrom,
    emailEnabled: emailEnabled,
    required    : REQUIRED_EMAIL_ENABLED,
    ok          : emailEnabled === REQUIRED_EMAIL_ENABLED,
    reason      : emailEnabled === REQUIRED_EMAIL_ENABLED
      ? 'emailEnabled is falsy, so every rendered page\'s user context is the ' +
        'one the corpus was captured against'
      : 'mail credentials are configured, so emailEnabled is true and every ' +
        'rendered page that carries user context differs from the corpus'
  };
}

// The boolean projection of an evaluation, which is all the evidence file ever
// receives. `reason` is deliberately excluded: it is a human sentence that can
// name the worktree path, and keeping it out of the record is what makes the
// artifact both credential-free and byte-identical between two runs of the
// same configuration.
function featureBooleans(feature) {
  return {
    evaluated   : feature.evaluated,
    hasAWS      : feature.hasAWS,
    hasMailgun  : feature.hasMailgun,
    hasFrom     : feature.hasFrom,
    emailEnabled: feature.emailEnabled,
    required    : feature.required,
    ok          : feature.ok
  };
}

// Evaluates the invariant once per process and records it: one `mail-feature`
// record on every install, so a retained artifact asserts the state the run
// actually had, and a second, loud `mail-feature-unexpected` record when the
// state is wrong. A violation does NOT set state.diagnostic and does NOT stop
// the install: uninstalling would hand the genuine `send` back and dial real
// SMTP, and `diagnostic` means the install is inactive. A gate reads
// status().mailFeature.ok, which is what makes the invariant checkable.
function recordMailFeature() {
  var feature;

  if (state.mailFeature) {
    return state.mailFeature;
  }

  feature = evaluateMailFeature();
  state.mailFeature = feature;

  note('mail-feature', featureBooleans(feature));

  if (!feature.ok) {
    note('mail-feature-unexpected',
      Object.assign(featureBooleans(feature), { reason: feature.reason }));
  }

  return feature;
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

  // The mailer has loaded, so the application's own `config` instance is in
  // require.cache and the mail-feature invariant can be evaluated against the
  // very instance addUserContext will read. Deliberately placed BEFORE the
  // shape check and the adopt branch below, so the invariant is recorded on
  // every path that got this far - a fixture that could not patch `send` still
  // reports whether the run's pages would match the corpus.
  recordMailFeature();

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
// side of the swap.
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
//
// `mailFeature` is the evaluated emailEnabled invariant, or null before an
// install has resolved the mailer. It is a COPY, so a gate that reads
// status().mailFeature.ok cannot alter the recorded evaluation. `diagnostic`
// is deliberately NOT overloaded to carry a violation: it means "the install
// is inactive", and the worker gate asserts it is null on a healthy run.
function status() {
  return {
    installed  : state.installed,
    appRoot    : appRoot(),
    module     : state.resolvedPath,
    logPath    : process.env.PARITY_MAIL_LOG || null,
    captured   : state.calls.length,
    sends      : state.sequence,
    diagnostic : state.diagnostic,
    notes      : state.notes.slice(),
    mailFeature: featureState()
  };
}

// The evaluated emailEnabled invariant on its own, as a copy, or null when no
// install has reached the evaluation. A gate asserts featureState().ok, or
// status().mailFeature.ok.
function featureState() {
  return state.mailFeature ? Object.assign({}, state.mailFeature) : null;
}

// ---------------------------------------------------------------------------
// Selection. `type` is the discriminator every call site sets and every gate
// keys on, so one selector is provided and nothing beyond it.
// ---------------------------------------------------------------------------

// Captured sends carrying the given `options.type`, in call order. Called with
// no argument, or with null, it selects the UN-TYPED calls - which is the admin
// session alert in lib/controllers/admin.js, the one site that sets no
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
// genuine transport back (restore). evidence() exposes what was persisted and
// featureState() the emailEnabled invariant, so a gate can assert the
// artifact's redaction and the mail-feature precondition in process instead of
// re-reading files or trusting this file's comments.
// ---------------------------------------------------------------------------
module.exports = {
  install : install,
  restore : restore,
  status  : status,

  // The evaluated emailEnabled invariant. Also on status().mailFeature.
  featureState: featureState,

  // Evidence. calls() is the raw assertion window; evidence() is exactly what
  // was persisted, so a gate can assert the artifact's redaction in process
  // instead of re-reading and re-parsing the file. Both return a copy of the
  // list, which is the discipline notes already uses.
  calls: function () {
    return state.calls.slice();
  },
  evidence: function () {
    return state.evidence.slice();
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
