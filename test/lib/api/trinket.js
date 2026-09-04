var flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults'),
    mail     = require('../../helpers/mail'),
    config   = require('config'),
    jwt      = require('jsonwebtoken');

// ---------------------------------------------------------------------------
// Support for the second suite in this file: the legacy URL / MIME /
// inline-image contracts (see the header on that describe below).
//
// These requires are deliberately a SEPARATE var statement from the chain
// above rather than additional entries in it: the Trinket suite's own imports
// are left byte-identical, and nothing here is visible to it.
//
// Everything is required at file-load time on purpose. test/mocha.opts keeps
// --check-leaks, and Mocha snapshots the global object once every spec has been
// collected, so a require that happens later -- inside a hook or a test body --
// can be reported as a leaked global. Loading here also means a resolution
// failure surfaces during collection instead of mid-run.
//
// `usersCtrl` and `FileUtil` are the APPLICATION's own module instances, taken
// through the same cached `require` the route table resolved, which is what
// makes driving `usersCtrl.assetUploadFromURL` below a test of the registered
// handler rather than of a copy of it. `fs` is needed to read the three
// consumer files whose call sites are pinned in source -- lib/workers/exports.js
// in particular MUST be read rather than required -- and to prove the temporary
// upload file the handler creates does not outlive this suite.
// ---------------------------------------------------------------------------
var should      = require('chai').should(),
    nodeUrl     = require('url'),
    nodePath    = require('path'),
    fs          = require('fs'),
    crypto      = require('crypto'),
    spawnSync   = require('child_process').spawnSync,
    parseLegacy = require('../../../lib/util/url').parseLegacy,
    filesCtrl   = require('../../../lib/controllers/files'),
    usersCtrl   = require('../../../lib/controllers/users'),
    FileUtil    = require('../../../lib/util/file'),
    mime        = require('mime').default;

/**
 * Every field `url.parse()` populates. The application reads `protocol`,
 * `pathname` and `path`, but the whole set is compared: a helper that agreed on
 * three fields and diverged on the rest would not be the drop-in replacement
 * the six call sites were converted on the assumption of.
 */
var LEGACY_FIELDS = [
  'protocol', 'slashes', 'auth', 'host', 'port', 'hostname',
  'hash', 'search', 'query', 'pathname', 'path', 'href'
];

/**
 * The old-vs-new input matrix. One entry per shape whose legacy handling is
 * idiosyncratic enough that a reimplementation would get it wrong, plus the
 * ordinary shapes the five asset sites actually see. Each is compared against
 * Node's own `url.parse` on all twelve fields above.
 */
var PARSE_MATRIX = [
  'http://example.com/a/b',        // absolute http
  'https://example.com/a/b',       // absolute https
  'https://h/x?v=2',               // query-bearing: query stays on `path`
  'https://h/a.png#frag',          // fragment-bearing: hash stays off `path`
  'https://h/a%20b.png',           // percent-encoded: nothing is decoded
  'http://h:8080/a',               // port-bearing
  'http://u:p@h/a',                // userinfo-bearing
  'http://h/dir/',                 // trailing slash
  'http://ExAmPle.COM/A',          // mixed-case host: host folds, path does not
  '//h/x',                         // protocol-relative: protocol stays null
  '/x',                            // root-relative
  'x',                             // relative
  '',                              // empty
  '?v=2',                          // query only: pathname null, path '?v=2'
  'data:image/png;base64,AAAA',    // opaque scheme
  'mailto:a@b.com',                // opaque scheme, no pathname
  'javascript:alert(1)',           // opaque scheme, pathname without a slash
  'https://ho st/a',               // a space ends the host
  'http://h\\a',                   // a backslash becomes a slash
  'https://h/x\ty',                // a tab is escaped
  'http://host:abc/a'              // unusable port: ':abc' folds into the path
];

/**
 * The exact throwing set, with the error identity each input must produce.
 * `name` and `code` are asserted rather than just "it threw", because every
 * consumer depends on this throw reaching a specific error funnel: the promise
 * `.catch` in trinket.getByShortCode, the route catch-all at the two
 * downloadZip loops and at users.assetUploadFromURL, and an unsettled deferred
 * in the export worker.
 */
var THROWING_INPUTS = [
  { label : "'http://['",                 input : 'http://[',                 name : 'TypeError', code : 'ERR_INVALID_URL' },
  { label : "'http://[::1'",              input : 'http://[::1',              name : 'TypeError', code : 'ERR_INVALID_URL' },
  { label : "'http://[fe80::1%25eth0]/a'", input : 'http://[fe80::1%25eth0]/a', name : 'TypeError', code : 'ERR_INVALID_URL' },
  { label : "'http://[::1]:port/x'",      input : 'http://[::1]:port/x',      name : 'TypeError', code : 'ERR_INVALID_URL' },
  { label : "'http://xn--a/x'",           input : 'http://xn--a/x',           name : 'TypeError', code : 'ERR_INVALID_URL' },
  { label : '42 (non-string)',            input : 42,                         name : 'TypeError', code : 'ERR_INVALID_ARG_TYPE' }
];

/**
 * Near neighbours of the throwing set that must NOT throw. Widening the
 * throwing set would reroute a request that answers today into an error funnel,
 * which is why both halves are asserted rather than only the throws.
 */
var NEAR_NEIGHBOURS = [
  'http://[]/a',
  'http://[::1]]/a',
  'http://%00/a',
  'http://a..b/x',
  'http://999.999.999.999/a'
];

/**
 * A realistic stored user-asset URL, in the shape the trinket asset sites and
 * the export worker read out of persisted documents.
 */
var STORED_ASSET_URL = 'https://cdn.example.com/userassets/abc123def.png';

// ---------------------------------------------------------------------------
// The IDNA host matrix.
//
// WHY THIS TABLE EXISTS, specifically. lib/util/url.js reconstructs the legacy
// parser's IDNA step -- which Node reaches through an internal binding that
// application code cannot require -- out of the public `url.domainToASCII`,
// and that reconstruction is EMPIRICAL rather than derived: an identity fast
// path for all-ASCII hosts, a sentinel label that suppresses the WHATWG host
// parser's IPv4 canonicalisation, a two-placeholder mask for the code points
// the WHATWG entry point refuses outright, and a bidi direction probe for the
// one rule a mask cannot carry. Each of those four corrections exists because
// the WHATWG entry point diverges from legacy IDNA on a measurable class of
// hosts, and none of them is guarded by anything else in the repository.
//
// Every row below is a host from one of those classes, and the two cases that
// drive this table hold the reconstruction to the RUNNING runtime's own
// `url.parse` on all twelve legacy fields and on the error identity. `throws`
// is what was measured on Node 22.23.2 and is asserted as well as compared, so
// a runtime that changed the legacy algorithm fails here rather than quietly
// changing what the six consumers see.
//
// Non-ASCII hosts are written as \u escapes with the script named, so the file
// stays ASCII and a row cannot be silently altered by a re-encoding.
// ---------------------------------------------------------------------------
var IDNA_HOST_MATRIX = [
  // The identity fast path: all-ASCII hosts, which must not be routed through
  // the WHATWG parser at all.
  { label : 'plain ASCII host',                    host : 'example.com',               throws : false },
  { label : 'uppercase host (ASCII case folding)', host : 'EXAMPLE.COM',               throws : false },
  { label : 'multi-label ASCII host',              host : 'sub.domain.example.co.uk',  throws : false },
  { label : 'empty label',                         host : 'a..b',                      throws : false },
  { label : 'single-character labels',             host : 'a.b.c',                     throws : false },
  { label : 'trailing dot',                        host : 'example.com.',              throws : false },

  // ACE ('xn--') labels, which the fast path must NOT take because they need
  // decoding and re-validation.
  { label : 'ACE label (Cyrillic apple)',          host : 'xn--80ak6aa92e.com',        throws : false },
  { label : 'ACE label (CJK)',                     host : 'xn--fiqs8s',                throws : false },
  { label : 'ACE label, uppercase prefix',         host : 'XN--FIQS8S',                throws : false },
  { label : 'undecodable ACE label',               host : 'xn--a',                     throws : true  },

  // Internationalised hosts, one per script, which exercise the mask-free
  // IDNA path behind the IPv4 sentinel.
  { label : 'CJK IDN',                             host : '\u4e2d\u6587.com',          throws : false },
  { label : 'Japanese IDN',                        host : '\u65e5\u672c\u8a9e.jp',     throws : false },
  { label : 'Cyrillic IDN',                        host : '\u043f\u0440\u0438\u043c\u0435\u0440.\u0440\u0444', throws : false },
  { label : 'Greek IDN',                           host : '\u03c0\u03b1\u03c1\u03ac\u03b4\u03b5\u03b9\u03b3\u03bc\u03b1.\u03b4\u03bf\u03ba\u03b9\u03bc\u03ae', throws : false },
  { label : 'Arabic IDN (RTL)',                    host : '\u0645\u0630\u0627\u0644.\u0625\u062e\u062a\u0628\u0627\u0631', throws : false },
  { label : 'Hebrew IDN (RTL)',                    host : '\u05d3\u05d5\u05d2\u05de\u05d4.\u05d1\u05d3\u05d9\u05e7\u05d4', throws : false },
  { label : 'Latin-1 accents',                     host : '\u00fcn\u00efcode.example', throws : false },
  { label : 'sharp s (UTS #46 mapping)',           host : '\u00df.example',            throws : false },
  { label : 'fullwidth letters (mapped to ASCII)', host : '\uff26\uff35\uff2c\uff2c.example', throws : false },
  { label : 'ideographic full stop as a label separator', host : 'a\u3002b',            throws : false },

  // The bidi direction probe: a C0 separator inside a right-to-left label is
  // refused, and no placeholder can stand in for it.
  { label : 'RTL label containing VT (C0 separator)', host : '\u05d3\u05d5\u05d2\u000b\u05de.com', throws : true  },
  { label : 'RTL label containing FS (C0 separator)', host : '\u0645\u0630\u0627\u0644\u001c.com', throws : true  },
  { label : 'LTR label containing VT (C0 separator)', host : 'ab\u000bcd.com',          throws : false },

  // Zero-width and other bidi-class-BN code points.
  { label : 'zero-width space in a label',         host : 'a\u200bb.com',              throws : false },
  { label : 'soft hyphen in a label',              host : 'a\u00adb.com',              throws : false },
  { label : 'zero-width joiner in a label',        host : 'a\u200db.com',              throws : true  },
  { label : 'word joiner in a label',              host : 'a\u2060b.com',              throws : false },
  { label : 'byte order mark before a label',      host : '\ufeffexample.com',         throws : false },

  // Percent signs, which the WHATWG entry point percent-DECODES and legacy
  // IDNA does not.
  { label : 'percent escape in a label',           host : 'ex%41mple.com',             throws : false },
  { label : 'percent-encoded dot in a label',      host : 'a%2eb.com',                 throws : false },
  { label : 'invalid percent escape in a label',   host : 'a%zzb.com',                 throws : false },

  // C0 controls and DEL, which the WHATWG entry point rejects and legacy IDNA
  // keeps.
  { label : 'DEL in a label',                      host : 'a\u007fb.com',              throws : false },
  { label : 'C0 SOH in a label',                   host : 'a\u0001b.com',              throws : false },
  { label : 'C0 US in an LTR label',               host : 'a\u001fb.com',              throws : false },
  { label : 'tab in the authority',                host : 'a\tb.com',                  throws : false },

  // IPv4-shaped hosts, which the WHATWG parser canonicalises or rejects and
  // legacy IDNA passes through untouched. The two out-of-range rows are the
  // ones that must NOT throw: 'http://999.999.999.999/a' answers today.
  { label : 'hexadecimal IPv4 shape',              host : '0x7f.1',                    throws : false },
  { label : 'three-part IPv4 shape',               host : '1.2.3',                     throws : false },
  { label : 'bare zero',                           host : '0',                         throws : false },
  { label : 'decimal IPv4 shape',                  host : '2130706433',                throws : false },
  { label : 'dotted quad',                         host : '127.0.0.1',                 throws : false },
  { label : 'out-of-range quad (must not throw)',  host : '999.999.999.999',           throws : false },
  { label : 'out-of-range first octet (must not throw)', host : '256.1.1.1',           throws : false },
  { label : 'octal quad',                          host : '0300.0250.0.1',             throws : false },

  // Bracketed hosts, which take the IPv6 branch and skip IDNA entirely.
  { label : 'IPv6 loopback',                       host : '[::1]',                     throws : false },
  { label : 'IPv6 loopback with a port',           host : '[::1]:80',                  throws : false },
  { label : 'IPv6 documentation address with a port', host : '[2001:db8::1]:8080',     throws : false },
  { label : 'IPv4-mapped IPv6',                    host : '[::ffff:127.0.0.1]',        throws : false },
  { label : 'IPv6 with a zone id',                 host : '[fe80::1%25eth0]',          throws : true  },
  { label : 'unterminated bracket',                host : '[',                         throws : true  },
  { label : 'unterminated IPv6',                   host : '[::1',                      throws : true  },
  { label : 'empty brackets (must not throw)',     host : '[]',                        throws : false },

  // Length limits, and hosts that IDNA maps to nothing at all.
  { label : 'over-long host',                      host : new Array(301).join('a') + '.com', throws : false },
  { label : 'over-long single label',              host : new Array(65).join('b') + '.com',  throws : false },
  { label : 'soft hyphen only (maps to nothing)',  host : '\u00ad',                    throws : true  },
  { label : 'zero-width space only (maps to nothing)', host : '\u200b',                throws : true  },

  // Two shapes where the host is not the whole authority.
  { label : 'fullwidth host with a port',          host : '\uff21\uff22.example:8080',  throws : false },
  { label : 'userinfo with an IDN host',           host : 'user:pass@\u4f8b\u3048.jp',  throws : false }
];

/**
 * The number of IDNA_HOST_MATRIX rows that throw, measured on Node 22.23.2 and
 * frozen so that a table whose flags were flipped wholesale, or a runtime that
 * widened or narrowed the throwing set, fails rather than agreeing with itself.
 */
var IDNA_THROWING_ROW_COUNT = 9;

/**
 * How each matrix host is turned into a URL: one that carries a path, a query
 * and a fragment, so all twelve legacy fields are populated and compared on
 * every row rather than only the host-related ones.
 *
 * @param {string} host - the authority under test
 * @returns {string} the URL to parse
 */
function idnaMatrixUrl(host) {
  return 'http://' + host + '/p/a.png?v=2#f';
}

// ---------------------------------------------------------------------------
// Inputs for the four cases that drive the real `users.assetUploadFromURL`
// handler. Each table is the set of payload URLs that reaches ONE of the
// handler's dispositions, so a change of disposition -- a reject that becomes a
// hang, a hang that becomes an upload, a throw that gets caught locally --
// moves an input out of its table and fails the case that owns it.
// ---------------------------------------------------------------------------

/** Reach `if (!requestUrl.protocol) return request.fail();`. */
var PROTOCOL_LESS_UPLOAD_URLS = ['/x', '//h/x', 'relative'];

/**
 * Reach the http/https transport gate, which refuses the scheme and returns
 * without settling. `protocol` is the exact value the gate must have read off
 * the parse result, and it appears in the message of the Error the gate raises,
 * so asserting on that message is what proves the field was read rather than
 * merely that nothing happened.
 *
 * The gate raises at PROCESS SCOPE, on a later tick, rather than logging: the
 * replaced `request` package initialised synchronously and raised for `ftp:`,
 * `file:` and `data:` before its `.on('error')` listener existed, so with no
 * `uncaughtException` handler anywhere in `app.js`, `lib/**` or `config/**` the
 * process terminated with the request unanswered. A log line would keep the
 * process alive, which is a different outcome. Both halves are therefore
 * asserted here - the throw reaching process scope AND the handler promise
 * still being unsettled - which is strictly more evidence than a log line
 * carried, and the protocol value is pinned exactly as before.
 */
var NON_TRANSPORT_UPLOAD_URLS = [
  { url : 'ftp://h/x',         protocol : 'ftp:'  },
  { url : 'data:text/plain,x', protocol : 'data:' }
];

/** Throw ERR_INVALID_URL out of the handler, before any temp file exists. */
var MALFORMED_UPLOAD_URLS = ['http://[', 'http://[::1]:port/x'];

/**
 * Reach the upload, whose `filename` is `path.basename(requestUrl.path)`.
 * `.path` carries the query string where `.pathname` does not, and the third
 * row separates `.path` from `.href` as well: `.href` carries the fragment and
 * `.path` does not, so a filename derived from `.href` would end '?v=2#frag'.
 */
var UPLOAD_FILENAME_CASES = [
  { url : 'https://cdn.example.com/dir/img.png?v=2',      filename : 'img.png?v=2' },
  { url : 'https://cdn.example.com/dir/img.png',          filename : 'img.png'     },
  { url : 'https://cdn.example.com/dir/img.png?v=2#frag', filename : 'img.png?v=2' }
];

// ---------------------------------------------------------------------------
// The source contract for all six parseLegacy call sites.
//
// WHY SOURCE PINNING IS THE RIGHT TOOL HERE, and not a substitute for driving
// the code. Of the six sites, exactly one is drivable from a suite with no
// database: `users.assetUploadFromURL`, which is driven for real in its own
// describe. The other five are not, for three different reasons:
//
//   * lib/workers/exports.js has NO module.exports whatsoever. It is a worker
//     script, `downloadAsset` and `addTrinketToArchive` are private to it, and
//     merely requiring it opens a Mongo connection and a queue and registers a
//     long-lived job processor -- so this suite must not require it, and reads
//     it with fs.readFileSync instead.
//   * `trinket.downloadZip` is module-private in lib/controllers/trinket.js and
//     is not exported under any name; it is reached only as the dispatch target
//     for the '.zip' extension.
//   * `trinket.downloadFile` IS exported, but its stored-asset branch is
//     reached only through `Trinket.findById(...)` returning a document whose
//     `assets` match the requested path, which needs seeded database state and
//     a stubbed asset store. This describe deliberately touches no database.
//   * `trinket.downloadPostedZip` is exported AND needs no database -- it reads
//     its assets out of `request.payload` -- but it opens its archive on the
//     hard-coded path '/tmp/download-<Date.now()>.zip' before it reaches the
//     asset loop, and neither the success path nor the throwing path removes
//     that file. Driving it from here would leave archives in a directory this
//     host shares with every other running process, and a cleanup sweep could
//     not tell its own file from a concurrent run's. Its binding is pinned
//     instead, and the omission is deliberate rather than overlooked.
//
// What can be guarded for those five is therefore their BINDING rather than
// their execution: that the call is still made, on the argument it is made on,
// that the field read off the result is still the same field, and that the call
// is not wrapped in a `try` that would swallow the ERR_INVALID_URL each one
// depends on reaching its own error funnel.
//
// Counts are MINIMUMS, and the wrong field is separately required to be absent.
// That combination is what makes the check strict about the mutations that
// matter -- deleting a call, deleting a read, or substituting one field for
// another -- while staying tolerant of the unrelated edits these three files
// legitimately receive. Patterns are built programmatically so they tolerate
// whitespace and the variable name actually used, and are strict about the call
// and the field.
// ---------------------------------------------------------------------------
var PARSE_LEGACY_SOURCE_CONTRACT = [
  {
    file       : 'lib/controllers/users.js',
    importForm : "require('../util/url').parseLegacy",
    totalCalls : 1,
    // Sites whose result is assigned to a variable; the variable name is
    // CAPTURED from the assignment, never assumed, and the field reads below
    // are then counted over whatever names were captured.
    assignedSites : [
      {
        consumer    : 'users.assetUploadFromURL',
        argument    : 'request.payload.url',
        occurrences : 1
      }
    ],
    inlineSites : [],
    fieldReads : [
      {
        label       : 'the reject guard `if (!<parsed>.protocol) return request.fail()`',
        prefix      : '!',
        field       : 'protocol',
        occurrences : 1,
        meaning     : 'a protocol-less URL would stop being rejected'
      },
      {
        label       : 'every .protocol read: the reject guard, both halves of the ' +
                      'http/https transport gate, and the refusal it logs',
        field       : 'protocol',
        occurrences : 4,
        meaning     : 'a scheme other than http/https would stop being refused'
      },
      {
        label       : 'the stored upload filename `path.basename(<parsed>.path)`',
        wrapper     : 'path.basename',
        field       : 'path',
        occurrences : 1,
        meaning     : 'the stored object name would change for a query-bearing source URL'
      }
    ],
    // Fields that must NOT be read off the parse result in this file. `.path`
    // and `.pathname` differ by exactly the query string, and this consumer is
    // the only one of the six that reads `.path`.
    forbiddenFields : [
      {
        field   : 'pathname',
        meaning : 'the query string would be stripped out of the stored upload filename, ' +
                  'orphaning objects already stored under the query-bearing name'
      }
    ]
  },
  {
    file       : 'lib/controllers/trinket.js',
    importForm : "require('../util/url').parseLegacy",
    totalCalls : 3,
    assignedSites : [
      {
        consumer    : 'trinket.downloadFile, its stored-asset branch',
        argument    : 'file.url',
        occurrences : 1
      },
      {
        consumer    : 'trinket.downloadPostedZip and the module-private downloadZip, one ' +
                      'asset loop each (textually identical, so the count is the only thing ' +
                      'that distinguishes them)',
        argument    : 'asset.url',
        occurrences : 2
      }
    ],
    inlineSites : [],
    fieldReads : [
      {
        label       : 'the stored asset name `path.basename(<parsed>.pathname)`, once per site',
        wrapper     : 'path.basename',
        field       : 'pathname',
        occurrences : 3,
        meaning     : 'the S3 key each asset is already stored under would change, which ' +
                      'orphans stored assets silently rather than erroring'
      }
    ],
    forbiddenFields : [
      {
        field   : 'path',
        meaning : 'a query-bearing stored URL would put its query string into the S3 key'
      }
    ]
  },
  {
    file       : 'lib/workers/exports.js',
    importForm : "require('../util/url').parseLegacy",
    totalCalls : 2,
    assignedSites : [
      {
        consumer    : 'exports.downloadAsset',
        argument    : 'assetUrl',
        occurrences : 1
      }
    ],
    // The one site that reads its field straight off the call, with no
    // intermediate variable, so call and field are pinned in one pattern.
    inlineSites : [
      {
        consumer    : 'exports.addTrinketToArchive',
        argument    : 'asset.url',
        wrapper     : 'path.basename',
        field       : 'pathname',
        occurrences : 1,
        meaning     : 'the archive entry name would change, which is a preserved ' +
                      'file-format contract'
      }
    ],
    fieldReads : [
      {
        label       : 'the S3 Key `path.basename(<parsed>.pathname)`',
        wrapper     : 'path.basename',
        field       : 'pathname',
        occurrences : 1,
        meaning     : 'the export worker would fetch a different S3 Key than the one the ' +
                      'asset is stored under'
      }
    ],
    forbiddenFields : [
      {
        field   : 'path',
        meaning : 'a query-bearing stored URL would put its query string into the S3 Key'
      }
    ]
  }
];

/**
 * The values the synthesized `request.fail` and `request.success` return, so a
 * case can assert WHICH disposition the handler took by identity rather than by
 * inspecting a response body.
 */
var FAIL_DISPOSITION    = { disposition : 'request.fail' },
    SUCCESS_DISPOSITION = { disposition : 'request.success' };

/** The content type the stubbed fetch reports, checked through to the upload. */
var STUB_CONTENT_TYPE = 'image/png';

/**
 * The two windows the handler is raced against.
 *
 * They are deliberately different, and the asymmetry is the point.
 * `HANDLER_SETTLE_MS` is only an upper bound on patience for a path that does
 * settle, so it is generous enough to survive a loaded host.
 * `HANDLER_PENDING_MS` bounds a path that must NOT settle; a short window is
 * sufficient there because the transport gate returns before it creates any
 * asynchronous work at all, so there is nothing left that could settle later.
 */
var HANDLER_SETTLE_MS  = 5000,
    HANDLER_PENDING_MS = 1200;

/**
 * The 13 content types both mime 1.2.11 and mime 4.1.0 answer for, where the
 * answer changed or was lost. `legacy` is what the client-visible upload `path`
 * must keep; `current` is what mime 4 answers instead and is asserted on the
 * same row, so a mime database bump fails here loudly rather than silently
 * agreeing with a stale table.
 */
var MIME_DIVERGENCE = [
  { type : 'application/mp4',           legacy : 'mp4s',          current : 'mp4' },
  { type : 'application/pgp-signature', legacy : 'asc',           current : 'sig' },
  { type : 'application/x-font-otf',    legacy : 'otf',           current : null },
  { type : 'application/x-font-ttf',    legacy : 'ttf',           current : null },
  { type : 'application/font-woff',     legacy : 'woff',          current : null },
  { type : 'application/xslt+xml',      legacy : 'xslt',          current : 'xsl' },
  { type : 'audio/mp4',                 legacy : 'mp4a',          current : 'm4a' },
  { type : 'image/jpeg',                legacy : 'jpeg',          current : 'jpg' },
  { type : 'image/tiff',                legacy : 'tiff',          current : 'tif' },
  { type : 'text/event-stream',         legacy : 'event-stream',  current : null },
  { type : 'text/x-markdown',           legacy : 'markdown',      current : 'mkd' },
  { type : 'application/dash+xml',      legacy : 'mdp',           current : 'mpd' },
  { type : 'font/opentype',             legacy : 'otf',           current : null }
];

/**
 * The algorithmic edges, which are a separate class from the table above: they
 * come from mime 1.2.11's normalization expression rather than from its
 * database, so no table entry covers them.
 */
var MIME_EDGES = [
  { input : 'IMAGE/JPEG',                legacy : 'jpeg',     current : 'jpg' },
  { input : 'image/jpeg; charset=x',     legacy : 'jpeg',     current : 'jpg' },
  { input : 'image/png foo',             legacy : 'png',      current : null },
  { input : 'text/markdown',             legacy : undefined,  current : 'md' },
  { input : 'text/plain; charset=UTF-8', legacy : 'txt',      current : 'txt' },
  { input : 'application/octet-stream',  legacy : 'bin',      current : 'bin' },
  { input : 'image/nope',                legacy : undefined,  current : null },
  { input : '',                          legacy : undefined,  current : '' }
];

/**
 * The completeness tripwire's frozen values, measured over mime 4's entire
 * database (1016 types at the resolved version).
 *
 * 254, not 259: five of the divergent types are ones mime 4 no longer knows at
 * all ('application/x-font-otf', 'application/x-font-ttf',
 * 'application/font-woff', 'text/event-stream', 'font/opentype'), so they are
 * absent from its key list and are covered by MIME_DIVERGENCE above instead.
 * 259 - 5 = 254.
 */
var MIME_DIVERGENT_TYPE_COUNT = 254,
    MIME_DIVERGENCE_DIGEST    = '1528b428a8ca916efab6408d03e8302ae5aa3061a22879f1d0986713e96bc461',
    MIME_DATABASE_TYPES_SEEN  = 1016;

/**
 * What to do when the tripwire fires. Carried in the assertion message because
 * the fix is not local to this file.
 */
var MIME_DRIFT_REMEDY =
  'mime\'s database has changed, so the frozen mime 1.2.11 compatibility layer ' +
  'is stale: re-derive LEGACY_EXTENSION and LEGACY_UNKNOWN_TYPES in ' +
  'lib/controllers/files.js against mime 1.2.11 (the derivation command is in ' +
  'that file\'s header comment) and update MIME_DIVERGENT_TYPE_COUNT and ' +
  'MIME_DIVERGENCE_DIGEST here to the values it prints.';

/**
 * Builds a head buffer from byte values, so the signature fixtures below read
 * as the bytes they spell.
 *
 * @param {Array<number>} values - byte values
 * @returns {Buffer} those bytes
 */
function headBytes(values) {
  return Buffer.from(values);
}

var PNG_HEAD         = headBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]),
    JPEG_HEAD        = headBytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
    GIF87A_HEAD      = Buffer.from('GIF87a', 'latin1'),
    GIF89A_HEAD      = Buffer.from('GIF89a', 'latin1'),
    WEBP_HEAD        = Buffer.concat([
                         Buffer.from('RIFF', 'latin1'),
                         headBytes([0x24, 0x00, 0x00, 0x00]),
                         Buffer.from('WEBP', 'latin1')
                       ]),
    BMP_HEAD         = Buffer.from('BM', 'latin1'),
    TIFF_II_HEAD     = headBytes([0x49, 0x49, 0x2a, 0x00]),
    TIFF_MM_HEAD     = headBytes([0x4d, 0x4d, 0x00, 0x2a]),
    ICO_HEAD         = headBytes([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]),
    HTML_SCRIPT_HEAD = Buffer.from('<html><script>alert(1)</script></html>', 'latin1'),
    SVG_SCRIPT_HEAD  = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'latin1');

/**
 * Every case that may be served inline: an allowlisted declared type whose
 * bytes carry that type's magic signature. The last three cover the head
 * representations the classifier accepts besides a Buffer.
 */
var INLINE_CASES = [
  { label : 'PNG bytes declared image/png',                 mime : 'image/png',                head : PNG_HEAD },
  { label : 'JPEG bytes declared image/jpeg',               mime : 'image/jpeg',               head : JPEG_HEAD },
  { label : 'GIF87a bytes declared image/gif',              mime : 'image/gif',                head : GIF87A_HEAD },
  { label : 'GIF89a bytes declared image/gif',              mime : 'image/gif',                head : GIF89A_HEAD },
  { label : 'WebP bytes declared image/webp',               mime : 'image/webp',               head : WEBP_HEAD },
  { label : 'BMP bytes declared image/bmp',                 mime : 'image/bmp',                head : BMP_HEAD },
  { label : 'little-endian TIFF bytes declared image/tiff', mime : 'image/tiff',               head : TIFF_II_HEAD },
  { label : 'big-endian TIFF bytes declared image/tiff',    mime : 'image/tiff',               head : TIFF_MM_HEAD },
  { label : 'ICO bytes declared image/x-icon',              mime : 'image/x-icon',             head : ICO_HEAD },
  { label : 'ICO bytes declared image/vnd.microsoft.icon',  mime : 'image/vnd.microsoft.icon', head : ICO_HEAD },
  { label : 'PNG bytes declared IMAGE/PNG (case folded)',   mime : 'IMAGE/PNG',                head : PNG_HEAD },
  { label : 'PNG bytes declared image/png; q=1 (parameterized)', mime : 'image/png; q=1',      head : PNG_HEAD },
  { label : 'PNG bytes declared with surrounding whitespace',    mime : '  image/png  ',       head : PNG_HEAD },
  { label : 'PNG bytes handed over as a latin1 string',     mime : 'image/png',                head : '\x89PNG\r\n\x1a\n' },
  { label : 'PNG bytes handed over as a plain array',       mime : 'image/png',                head : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { label : 'PNG bytes handed over as a Uint8Array',        mime : 'image/png',                head : new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }
];

/**
 * Every case that must be served as an attachment. The first group is the
 * mismatched-metadata attack FE-13 describes -- the two legacy fields are
 * independent, so neither one alone may authorise inline rendering -- and the
 * rest cover script-capable declared types, unlisted types, and heads or
 * declared types that cannot be interpreted at all.
 */
var ATTACHMENT_CASES = [
  { label : 'PNG bytes declared text/html',                        mime : 'text/html',             head : PNG_HEAD },
  { label : 'HTML script payload declared image/png',              mime : 'image/png',             head : HTML_SCRIPT_HEAD },
  { label : 'SVG script payload declared image/png',               mime : 'image/png',             head : SVG_SCRIPT_HEAD },
  { label : 'PNG bytes declared image/svg+xml',                    mime : 'image/svg+xml',         head : PNG_HEAD },
  { label : 'JPEG bytes declared text/html',                       mime : 'text/html',             head : JPEG_HEAD },
  { label : 'PNG bytes declared application/xhtml+xml',            mime : 'application/xhtml+xml', head : PNG_HEAD },
  { label : 'PNG bytes declared text/xml',                         mime : 'text/xml',              head : PNG_HEAD },
  { label : 'PNG bytes declared application/xml',                  mime : 'application/xml',       head : PNG_HEAD },
  { label : 'PNG bytes declared application/pdf (not allowlisted)', mime : 'application/pdf',      head : PNG_HEAD },
  { label : 'PNG bytes declared image/tiff (allowlisted, wrong magic)', mime : 'image/tiff',       head : PNG_HEAD },
  { label : 'RIFF container without the WEBP tag declared image/webp', mime : 'image/webp',        head : Buffer.from('RIFFxxxxJUNK', 'latin1') },
  { label : 'empty head declared image/png',                       mime : 'image/png',             head : Buffer.alloc(0) },
  { label : 'two-byte head declared image/png',                    mime : 'image/png',             head : headBytes([0x89, 0x50]) },
  { label : 'null head declared image/png',                        mime : 'image/png',             head : null },
  { label : 'undefined head declared image/png',                   mime : 'image/png',             head : undefined },
  { label : 'PNG bytes with a numeric declared mime',              mime : 42,                      head : PNG_HEAD },
  { label : 'PNG bytes with a null declared mime',                 mime : null,                    head : PNG_HEAD },
  { label : 'PNG bytes with an undefined declared mime',           mime : undefined,               head : PNG_HEAD },
  { label : 'PNG bytes with an object declared mime',              mime : {},                      head : PNG_HEAD },
  { label : 'numeric head declared image/png',                     mime : 'image/png',             head : 42 },
  { label : 'object head declared image/png',                      mime : 'image/png',             head : {} }
];

/**
 * The two child-process snippets behind the DEP0170 gate. Neither ends by
 * exiting the process: warnings are delivered on process.nextTick, so an
 * explicit exit would drop the very output the control case has to observe.
 */
var DEP0170_PARSES = 'p(\'http://host:abc/a\'); p(\'http://other:zzz/b\'); p(\'https://h/x?v=2\');',
    DEP0170_GATE_SNIPPET    = 'var p=require(\'./lib/util/url\').parseLegacy; ' + DEP0170_PARSES,
    DEP0170_CONTROL_SNIPPET = 'var p=require(\'url\').parse; ' + DEP0170_PARSES;

/**
 * The URL the non-poisoning case parses through Node's own `url.parse` AFTER
 * lib/util/url.js has been loaded and used. It is deliberately a different
 * authority from anything the helper parsed, so the warning that must appear
 * can be attributed to this call and to nothing else.
 */
var DEP0170_LATER_URL = 'http://other-consumer:zzz/b';

/**
 * Loads the helper, parses a malformed authority through it, and only then
 * parses a malformed authority through `url.parse`.
 *
 * Node's DEP0170 emission is a module-level ONE-SHOT per process, so a helper
 * that removed the warning by spending that flag -- or by replacing the
 * process-wide warning emitter -- would leave the whole process unable to
 * report DEP0170 from anywhere else: a dependency, a script, another test. The
 * trailing `setTimeout` keeps the process alive without exiting, because
 * warnings are delivered on `process.nextTick` and an explicit exit would drop
 * the very output this measures.
 */
var DEP0170_NON_POISONING_SNIPPET =
  'var p=require(\'./lib/util/url\').parseLegacy; p(\'http://host:abc/a\'); ' +
  'require(\'url\').parse(' + JSON.stringify(DEP0170_LATER_URL) + '); ' +
  'setTimeout(function(){}, 50);';

/**
 * Calls `fn(value)` and reports the outcome instead of propagating it, so a
 * table-driven case can assert on throwing and non-throwing inputs alike.
 *
 * The try/catch here is also the proof of SYNCHRONY that the three trinket
 * sites and the two worker sites depend on: an asynchronous rejection would not
 * be caught by it, so a captured throw is necessarily a synchronous one.
 *
 * @param {function} fn - the function under test
 * @param {*} value - its single argument
 * @returns {{threw: boolean, value: *, name: ?string, code: ?string, message: ?string}}
 */
function attempt(fn, value) {
  try {
    return { threw : false, value : fn(value), name : null, code : null, message : null };
  }
  catch (err) {
    return {
      threw   : true,
      value   : undefined,
      name    : err && err.name,
      code    : err && err.code,
      message : err && err.message
    };
  }
}

/**
 * Builds the `request` object `users.assetUploadFromURL` is invoked with.
 *
 * It carries exactly the four members that handler reads -- `payload.url`,
 * `user`, `fail` and `success` -- plus the `record` the cases assert on, and
 * nothing else, so a rewrite that starts reading a fifth request member fails
 * here loudly instead of being silently satisfied by a fixture that happens to
 * be complete. `fail` and `success` are the route
 * wrapper's own injected members (lib/util/routeParser.js), and recording them
 * is what makes the handler's DISPOSITION observable: which one was called,
 * with what, and how many times.
 *
 * @param {string} url - the payload URL under test
 * @returns {Object} the request, with a `record` of the dispositions taken
 */
function recordingRequest(url) {
  var record = { fail : [], success : [] };

  return {
    payload : { url : url },
    user    : { _id : 'parity-user', username : 'parity-user' },
    record  : record,
    fail    : function(arg) {
      record.fail.push(arg);
      return FAIL_DISPOSITION;
    },
    success : function(arg) {
      record.success.push(arg);
      return SUCCESS_DISPOSITION;
    }
  };
}

/**
 * The `h` argument. `assetUploadFromURL` answers exclusively through
 * `request.fail` and `request.success` and never touches the toolkit, so every
 * member here throws: that keeps the fixture from quietly accommodating a
 * handler that started responding by another route.
 *
 * @returns {Object} a toolkit that refuses to be used
 */
function toolkitStub() {
  function refuse(member) {
    return function() {
      throw new Error('assetUploadFromURL called h.' + member + '(), which it does not do at ' +
        'baseline; it answers through request.success / request.fail only, and the tests ' +
        'around this fixture assert on those');
    };
  }

  return {
    response : refuse('response'),
    redirect : refuse('redirect'),
    view     : refuse('view'),
    continue : refuse('continue')
  };
}

/**
 * Runs `work()` and reports how its promise settled, or that it did not settle
 * within `ms`.
 *
 * A BOUNDED RACE IS MANDATORY for this handler, not defensive: its
 * transport-gate branch returns without resolving the promise it has already
 * returned, so the request is left permanently unsettled -- long-standing,
 * deliberately preserved behaviour. Awaiting it directly would hang the run
 * until Mocha's timeout and report a timeout instead of the outcome.
 *
 * @param {function} work - produces the promise under test
 * @param {number} ms - how long to wait before calling it unsettled
 * @returns {Promise<{state: string, value: *, error: *}>} always resolves
 */
function settlement(work, ms) {
  var timer;

  return Promise.race([
    Promise.resolve().then(work).then(
      function(value) {
        return { state : 'resolved', value : value, error : null };
      },
      function(error) {
        return { state : 'rejected', value : undefined, error : error };
      }
    ),
    new Promise(function(resolve) {
      timer = setTimeout(function() {
        resolve({ state : 'pending', value : undefined, error : null });
      }, ms);
    })
  ]).then(function(outcome) {
    // Cleared on every path so a settled case does not hold the event loop
    // open for the remainder of the window.
    clearTimeout(timer);
    return outcome;
  });
}

/**
 * Runs `work()` with `console.log` captured, and restores it before the caller
 * sees either result.
 *
 * The handler's refusal path is observable only through what it logs, so the
 * capture is required; it is scoped to a single call, and restored on the
 * failure path as well as the success path, because Mocha's own reporter writes
 * through `console.log` between cases.
 *
 * @param {function} work - produces the promise under test
 * @returns {Promise<{lines: Array<string>, value: *}>} the captured lines
 */
function withCapturedLog(work) {
  var lines    = [],
      original = console.log;

  console.log = function() {
    lines.push(Array.prototype.map.call(arguments, String).join(' '));
  };

  return Promise.resolve().then(work).then(
    function(value) {
      console.log = original;
      return { lines : lines, value : value };
    },
    function(error) {
      console.log = original;
      throw error;
    }
  );
}

/**
 * Runs `work()` with process-scope exceptions captured, and restores the
 * process's own listeners before the caller sees either result.
 *
 * The transport gate's refusal is dispatched with `process.nextTick(function() {
 * throw ...; })`, which is deliberate: it reproduces the replaced package's
 * event timing, where the raise reached no listener and terminated the process
 * with the request unanswered. Observing it therefore requires taking the
 * `uncaughtException` listeners off the process for the duration of the call -
 * Mocha installs its own, and it would attribute the throw to whichever case is
 * running - and putting them back afterwards. Saved and restored on the failure
 * path as well as the success path, so a rejecting `work()` cannot leave the
 * runner without its handler.
 *
 * @param {function} work - produces the promise under test
 * @returns {Promise<{errors: Array<Error>, value: *}>} the captured exceptions
 */
function withCapturedUncaught(work) {
  var errors = [],
      saved  = process.listeners('uncaughtException');

  function collect(error) {
    errors.push(error);
  }

  process.removeAllListeners('uncaughtException');
  process.on('uncaughtException', collect);

  function restore() {
    process.removeListener('uncaughtException', collect);
    saved.forEach(function(listener) {
      process.on('uncaughtException', listener);
    });
  }

  return Promise.resolve().then(work).then(
    function(value) {
      restore();
      return { errors : errors, value : value };
    },
    function(error) {
      restore();
      throw error;
    }
  );
}

/**
 * Runs `work(entry)` for each table entry in sequence, so that the shared
 * per-call records a case asserts on describe one entry at a time.
 *
 * @param {Array} entries - the table
 * @param {function} work - returns a promise for one entry
 * @returns {Promise} resolved once every entry has been run
 */
function forEachInSequence(entries, work) {
  return entries.reduce(function(chain, entry) {
    return chain.then(function() {
      return work(entry);
    });
  }, Promise.resolve());
}

// ---------------------------------------------------------------------------
// Source reading for the six-call-site contract above.
// ---------------------------------------------------------------------------

/**
 * Escapes a literal for use inside a regular expression.
 *
 * @param {string} literal - the text to match literally
 * @returns {string} the escaped form
 */
function escapeForPattern(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turns a dotted expression such as 'request.payload.url' or 'path.basename'
 * into a pattern that tolerates whitespace around each dot.
 *
 * @param {string} expression - the dotted expression
 * @returns {string} its pattern source
 */
function dottedPattern(expression) {
  return expression.split('.').map(escapeForPattern).join('\\s*\\.\\s*');
}

/**
 * A `parseLegacy(<argument>)` call, whitespace tolerant.
 *
 * @param {string} argument - the argument expression, matched exactly
 * @returns {string} its pattern source
 */
function callPattern(argument) {
  return 'parseLegacy\\s*\\(\\s*' + dottedPattern(argument) + '\\s*\\)';
}

/**
 * A field read off a variable, optionally wrapped in a call and optionally
 * prefixed.
 *
 * The trailing `(?![\w$])` is what keeps `.path` from matching `.pathname`,
 * which is the exact substitution the two field sets differ by and therefore
 * the exact mutation this has to catch.
 *
 * @param {string} variableName - the captured variable holding the parse result
 * @param {Object} read - {prefix, wrapper, field}
 * @returns {RegExp} a global pattern for that read
 */
function fieldReadPattern(variableName, read) {
  var access = escapeForPattern(variableName) + '\\s*\\.\\s*' + read.field + '(?![\\w$])',
      body   = read.wrapper ? dottedPattern(read.wrapper) + '\\s*\\(\\s*' + access + '\\s*\\)' : access,
      prefix = read.prefix ? escapeForPattern(read.prefix) + '\\s*' : '';

  return new RegExp(prefix + body, 'g');
}

/**
 * Counts non-overlapping matches of a global pattern.
 *
 * @param {string} text - the text to search
 * @param {RegExp} pattern - a global pattern
 * @returns {number} how many times it matched
 */
function countMatches(text, pattern) {
  var matches = text.match(pattern);

  return matches ? matches.length : 0;
}

/**
 * Blanks out every comment, string literal and regular-expression literal in a
 * JavaScript source file, replacing each character with a space and keeping
 * newlines, so the result has the SAME LENGTH and the same line numbering as
 * the original.
 *
 * Masking is what makes the source checks below trustworthy in both directions.
 * All three consumer files discuss `parseLegacy` in comments, so an unmasked
 * search would match prose; and the brace scan that establishes whether a call
 * sits inside a `try` would be thrown off by a brace inside a string, a comment
 * or a character class.
 *
 * The mask is not assumed to be correct: `scanParseLegacyCallSites` reports the
 * final brace balance, and the case that uses it asserts that balance is zero
 * and never went negative. A future edit that introduced a construct this
 * function mishandles would therefore fail that assertion loudly instead of
 * silently mis-locating a call site.
 *
 * @param {string} source - JavaScript source text
 * @returns {string} the masked text, character-for-character aligned
 */
function maskJavaScript(source) {
  var out    = source.split(''),
      length = source.length,
      index  = 0,
      character,
      previous,
      end,
      inClass;

  function blank(from, to) {
    var at;

    for (at = from; at < to && at < length; ++at) {
      if (out[at] !== '\n') {
        out[at] = ' ';
      }
    }
  }

  // The last character that is not whitespace and not already masked, which is
  // what decides whether a '/' opens a regular expression or is a division.
  function previousSignificant(from) {
    var at, candidate;

    for (at = from - 1; at >= 0; --at) {
      candidate = out[at];

      if (candidate !== ' ' && candidate !== '\t' && candidate !== '\n' && candidate !== '\r') {
        return candidate;
      }
    }

    return '';
  }

  while (index < length) {
    character = source.charAt(index);

    if (character === '/' && source.charAt(index + 1) === '/') {
      end = source.indexOf('\n', index);
      end = end === -1 ? length : end;
      blank(index, end);
      index = end;
      continue;
    }

    if (character === '/' && source.charAt(index + 1) === '*') {
      end = source.indexOf('*/', index + 2);
      end = end === -1 ? length : end + 2;
      blank(index, end);
      index = end;
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      end = index + 1;

      while (end < length) {
        if (source.charAt(end) === '\\') {
          end += 2;
          continue;
        }
        if (source.charAt(end) === character) {
          ++end;
          break;
        }
        ++end;
      }

      blank(index, end);
      index = end;
      continue;
    }

    if (character === '/') {
      previous = previousSignificant(index);

      // A '/' after an operator, an opening bracket or a keyword begins a
      // regular expression; after a value it is a division. The keyword forms
      // are spelled out because the character before them is a letter.
      if (previous === '' ||
          '(,=:[!&|?{};+-*%~^<>'.indexOf(previous) !== -1 ||
          /(^|[^\w$])(return|typeof|case|in|of|void|delete|new|do|else)$/.test(
            out.slice(0, index).join('').replace(/\s+$/, ''))) {
        end     = index + 1;
        inClass = false;

        while (end < length) {
          character = source.charAt(end);

          if (character === '\\') {
            end += 2;
            continue;
          }
          if (character === '[') {
            inClass = true;
          }
          else if (character === ']') {
            inClass = false;
          }
          else if (character === '/' && !inClass) {
            ++end;
            break;
          }
          else if (character === '\n') {
            break;
          }
          ++end;
        }

        blank(index, end);
        index = end;
        continue;
      }
    }

    ++index;
  }

  return out.join('');
}

/**
 * Reports whether the block opened by the brace at `braceIndex` is a `try`
 * block.
 *
 * @param {string} masked - the masked source
 * @param {number} braceIndex - the index of a '{'
 * @returns {boolean} true when 'try' immediately precedes it
 */
function opensTryBlock(masked, braceIndex) {
  var before = masked.slice(Math.max(0, braceIndex - 16), braceIndex).replace(/\s+$/, '');

  return /(^|[^\w$.])try$/.test(before);
}

/**
 * Locates every `parseLegacy(` call in a masked source and reports, for each,
 * whether it sits inside a `try` block.
 *
 * @param {string} masked - the masked source
 * @returns {{sites: Array<{line: number, insideTry: boolean}>, balance: number, minimumDepth: number}}
 */
function scanParseLegacyCallSites(masked) {
  var pattern      = /parseLegacy\s*\(/g,
      offsets      = [],
      sites        = [],
      blockStack   = [],
      depth        = 0,
      minimumDepth = 0,
      pending      = 0,
      match,
      character,
      index;

  while ((match = pattern.exec(masked))) {
    offsets.push(match.index);
  }

  for (index = 0; index < masked.length; ++index) {
    while (pending < offsets.length && offsets[pending] === index) {
      sites.push({
        line      : masked.slice(0, index).split('\n').length,
        insideTry : blockStack.indexOf(true) !== -1
      });
      ++pending;
    }

    character = masked.charAt(index);

    if (character === '{') {
      blockStack.push(opensTryBlock(masked, index));
      ++depth;
    }
    else if (character === '}') {
      blockStack.pop();
      --depth;

      if (depth < minimumDepth) {
        minimumDepth = depth;
      }
    }
  }

  return { sites : sites, balance : depth, minimumDepth : minimumDepth };
}

/**
 * Reads one consumer file and returns its raw and masked text.
 *
 * lib/workers/exports.js is READ, never required: it has no exports, and
 * requiring it would open a Mongo connection and a Redis-backed queue and
 * register a long-lived job processor inside this test process.
 *
 * @param {string} relativePath - repository-relative path
 * @returns {{raw: string, masked: string}} the file's text
 */
function readConsumerSource(relativePath) {
  var raw = fs.readFileSync(nodePath.resolve(__dirname, '..', '..', '..', relativePath), 'utf8');

  return { raw : raw, masked : maskJavaScript(raw) };
}

/**
 * Collects the distinct variable names a file assigns a `parseLegacy` result
 * to, so field reads can be counted over the names actually used rather than
 * over names this file assumes.
 *
 * @param {string} masked - the masked source
 * @returns {Array<string>} the distinct names, in order of first appearance
 */
function capturedParseVariables(masked) {
  var pattern = /([A-Za-z_$][\w$]*)\s*=\s*parseLegacy\s*\(/g,
      names   = [],
      match;

  while ((match = pattern.exec(masked))) {
    if (names.indexOf(match[1]) === -1) {
      names.push(match[1]);
    }
  }

  return names;
}

/**
 * Counts one field read across every captured variable name in a file.
 *
 * @param {string} masked - the masked source
 * @param {Array<string>} variableNames - the captured names
 * @param {Object} read - {prefix, wrapper, field}
 * @returns {number} the total number of such reads
 */
function countFieldReads(masked, variableNames, read) {
  return variableNames.reduce(function(total, variableName) {
    return total + countMatches(masked, fieldReadPattern(variableName, read));
  }, 0);
}

/**
 * Loads mime 4's complete type database.
 *
 * mime 4 is ESM and its package `exports` map does not expose the type tables
 * as a subpath, so they are required by absolute path -- which works from
 * CommonJS and is what makes a whole-database assertion possible at all.
 *
 * @returns {Object} every type mime 4 knows, mapped to its extension
 */
function loadMimeDatabase() {
  var root     = nodePath.resolve(nodePath.dirname(require.resolve('mime')), '..', '..'),
      standard = require(nodePath.join(root, 'dist', 'types', 'standard.js')),
      other    = require(nodePath.join(root, 'dist', 'types', 'other.js'));

  return Object.assign({}, standard.default || standard, other.default || other);
}

/**
 * The canonical string form of a divergent-type set: one `type=legacyValue`
 * entry per type, sorted, newline separated. String() is applied to the legacy
 * value so `undefined` -- mime 1.2.11's only falsy answer -- is representable.
 *
 * @param {Array<string>} types - the divergent types
 * @returns {string} the canonical form, ready to digest
 */
function canonicalDivergence(types) {
  return types.map(function(type) {
    return type + '=' + String(filesCtrl.legacyMimeExtension(type));
  }).sort().join('\n');
}

module.exports = function() {
  describe('Trinket Creation', function() {
    var trinketId, trinketShortCode, trinketLang;

    describe('When creating a new trinket', function() {
      mail.stub();

      before(function(done) {
        flow.createTrinket(function() {
          trinketId        = flow.lastResponse.body.data.id;
          trinketShortCode = flow.lastResponse.body.data.shortCode;
          trinketLang      = flow.lastResponse.body.data.lang;
          done();
        });
      });

      it('should return a new trinket', function(done) {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(200);
        flow.lastContentType.should.contain('application/json');
        flow.lastResponse.body.data.should.have.property('id');
        flow.lastResponse.body.data.should.have.property('hash');
        flow.lastResponse.body.data.should.have.property('shortCode');
        flow.lastResponse.body.data.lang.should.eql('python');

        done();
      });

      describe('When I attempt to fork with a new code modification', function() {
        before(function(done) {
          flow.forkTrinket(trinketId, { code : 'modified code' }, function() {
            done();
          });
        });

        it('should create a new trinket', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('application/json');
          flow.lastResponse.body.data.should.contain.keys('id', 'hash', 'shortCode');
          done();
        });

        it('should update the fork count of the parent', function(done) {
          flow.get('/api/trinkets/' + trinketId)
            .end(function(err, res) {
              res.body.data.metrics.forks.should.eql(1);
              done();
            });
        });
      });

      // the next 3 tests below are testing non-api URLs

      it('should allow me to load the trinket', function(done) {
        flow.getTrinket(trinketShortCode, trinketLang, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('text/html');

          done();
        });
      });

      it('should allow me to embed the trinket', function(done) {
        flow.getEmbeddedTrinket(trinketId, trinketLang, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('text/html');

          done();
        });
      });

      it('should allow me to embed the trinket with result showing', function(done) {
        // validating that the query param start is accepted
        flow.getEmbeddedTrinket(trinketId, trinketLang, { start : 'result' }, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('text/html');

          done();
        });
      });

      it('should allow me to share the trinket with a token', function(done) {
        var secret = config.app.mail.secret + trinketShortCode;
        var token = jwt.sign({ shortCode: trinketShortCode }, secret);
        flow.emailTrinket(trinketId, { email: defaults.user.email, name: defaults.user.fullname, replyTo: defaults.user.email, token: token }, function(err, response) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);

          mail.mailer.send.calledOnce.should.be.true;

          done();
        });
      });

      it('should not allow me to share the trinket without a token', function(done) {
        flow.emailTrinket(trinketId, { email: defaults.user.email, name: defaults.user.fullname, replyTo: defaults.user.email }, function(err, response) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(400);

          done();
        });
      });

      it('should allow me to run the trinket', function(done) {
        flow.runTrinket(trinketId, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastResponse.body.data.should.have.property('metrics');
          flow.lastResponse.body.data.metrics.should.have.property('runs');

          done();
        });
      });

      it('should allow an error to be logged if there is an error in the code', function(done) {
        flow.trinketRunError(function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);

          done();
        });
      });
    });
  });

  // -------------------------------------------------------------------------
  // Legacy URL, MIME and inline-image contracts
  // -------------------------------------------------------------------------
  // Covers TST-76 (no direct legacy url.parse parity matrix and no
  // caller-specific malformed/error-funnel tests for lib/util/url.js
  // parseLegacy and its six consumers) together with the test halves of
  // API-F10 and INT-F27 (DEP0170 and malformed-authority parity at every
  // caller), API-F09 and BE-61 (the mime 4 extension mappings the upload
  // response depends on) and FE-13 (the mismatched-metadata decision behind
  // the inline image branch).
  //
  // This is a UNIT-level suite that lives in this file because this file is
  // where the work was assigned. It touches no database, no session and no
  // Supertest agent, and it must stay that way: it is a sibling of the Trinket
  // suite above rather than a nested describe precisely so that nothing the
  // Trinket flow sets up can affect it, and so test/lib/api/index.js picks it
  // up with no change of its own.
  //
  // Route-level and worker-level coverage of the download response and the
  // stored keys is deliberately absent here: it belongs to test/parity/storage.js
  // and test/parity/corpus.json.
  describe('Legacy URL, MIME and inline-image contracts', function() {

    describe('lib/util/url.js parseLegacy, against url.parse as the oracle', function() {

      it('should reproduce url.parse on all twelve legacy fields for every matrix input', function() {
        var mismatches = [];

        // Guards against the one way a table-driven comparison can pass while
        // measuring nothing: an emptied or truncated table.
        should.equal(LEGACY_FIELDS.length, 12,
          'all twelve legacy url.parse fields must be compared');
        should.equal(PARSE_MATRIX.length >= 21, true,
          'the matrix lost inputs: ' + PARSE_MATRIX.length + ' of at least 21');

        PARSE_MATRIX.forEach(function(input) {
          // The oracle is Node's own url.parse, called here rather than
          // hard-coded, so this case measures the property that actually
          // matters: that the six converted call sites see what they saw
          // before. Frozen values are asserted separately below, so a runtime
          // that changed both would still be caught.
          var actual   = parseLegacy(input),
              expected = nodeUrl.parse(input);

          LEGACY_FIELDS.forEach(function(field) {
            if (actual[field] !== expected[field]) {
              mismatches.push(
                JSON.stringify(input) + ' field `' + field + '`: parseLegacy gave ' +
                JSON.stringify(actual[field]) + ', url.parse gave ' +
                JSON.stringify(expected[field])
              );
            }
          });
        });

        should.equal(mismatches.join('\n'), '',
          'parseLegacy diverged from url.parse on ' + mismatches.length + ' of ' +
          (PARSE_MATRIX.length * LEGACY_FIELDS.length) + ' field comparisons');
      });

      it('should throw exactly what url.parse throws, and not for any near neighbour', function() {
        var problems = [];

        should.equal(THROWING_INPUTS.length >= 6, true,
          'the throwing set lost inputs: ' + THROWING_INPUTS.length + ' of at least 6');
        should.equal(NEAR_NEIGHBOURS.length >= 5, true,
          'the near-neighbour set lost inputs: ' + NEAR_NEIGHBOURS.length + ' of at least 5');

        THROWING_INPUTS.forEach(function(entry) {
          var actual   = attempt(parseLegacy, entry.input),
              expected = attempt(nodeUrl.parse, entry.input);

          if (!actual.threw) {
            problems.push(entry.label + ': parseLegacy did not throw, it returned ' +
              JSON.stringify(actual.value && actual.value.href));
            return;
          }
          if (!expected.threw) {
            problems.push(entry.label + ': url.parse no longer throws, so the frozen ' +
              'expectation in THROWING_INPUTS needs re-deriving on this runtime');
            return;
          }
          if (actual.name !== expected.name || actual.code !== expected.code) {
            problems.push(entry.label + ': parseLegacy threw ' + actual.name + '/' +
              actual.code + ' where url.parse threw ' + expected.name + '/' + expected.code);
          }
          // Frozen too, not only oracle-relative: each consumer's error funnel
          // is reached by way of this exact error identity.
          if (actual.name !== entry.name || actual.code !== entry.code) {
            problems.push(entry.label + ': expected ' + entry.name + '/' + entry.code +
              ' but got ' + actual.name + '/' + actual.code);
          }
          if (actual.message !== expected.message) {
            problems.push(entry.label + ': message ' + JSON.stringify(actual.message) +
              ' differs from url.parse\'s ' + JSON.stringify(expected.message));
          }
        });

        NEAR_NEIGHBOURS.forEach(function(input) {
          var actual   = attempt(parseLegacy, input),
              expected = attempt(nodeUrl.parse, input);

          if (actual.threw || expected.threw) {
            problems.push(JSON.stringify(input) + ': near neighbour threw (parseLegacy ' +
              actual.name + '/' + actual.code + ', url.parse ' + expected.name + '/' +
              expected.code + '); widening the throwing set reroutes an error edge');
            return;
          }

          LEGACY_FIELDS.forEach(function(field) {
            if (actual.value[field] !== expected.value[field]) {
              problems.push(JSON.stringify(input) + ' field `' + field + '`: parseLegacy gave ' +
                JSON.stringify(actual.value[field]) + ', url.parse gave ' +
                JSON.stringify(expected.value[field]));
            }
          });
        });

        should.equal(problems.join('\n'), '',
          'the throwing set is wrong in one or both directions (' + problems.length + ' problems)');
      });

      it('should pin the frozen legacy field contract independently of the oracle', function() {
        // AAP 0.4.2's behaviour table, asserted as values rather than against
        // url.parse, so this case still holds the contract if a future runtime
        // changes the built-in parser.
        var queryBearing = parseLegacy('https://h/x?v=2');

        should.equal(queryBearing.protocol, 'https:', "parseLegacy('https://h/x?v=2').protocol");
        should.equal(queryBearing.pathname, '/x', "parseLegacy('https://h/x?v=2').pathname");
        should.equal(queryBearing.path, '/x?v=2',
          "parseLegacy('https://h/x?v=2').path must keep the query string");

        // Strict null, not merely falsy: the users.js guard is a truthiness
        // test, but the parity corpus compares the value itself.
        ['//h/x', '/x', 'x'].forEach(function(input) {
          should.equal(parseLegacy(input).protocol, null,
            'parseLegacy(' + JSON.stringify(input) + ').protocol must be strictly null');
        });

        should.equal(parseLegacy('http://host:abc/a').pathname, '/:abc/a',
          "parseLegacy('http://host:abc/a') must fold an unusable port into the pathname");

        // url.parse returns an already-parsed input untouched; parseLegacy
        // reproduces that rather than rejecting it as a non-string.
        var instance = parseLegacy('https://h/x?v=2');
        instance.should.be.an.instanceOf(nodeUrl.Url);
        should.equal(parseLegacy(instance), instance,
          'a Url instance passed back in must be returned unchanged, by identity');
      });

      it('should reproduce url.parse on every non-throwing host in the IDNA matrix', function() {
        var mismatches = [],
            compared   = 0;

        // Table tripwires first: this case is only as good as its table, and an
        // emptied or wholesale-flipped table would otherwise pass silently.
        should.equal(IDNA_HOST_MATRIX.length >= 40, true,
          'the IDNA matrix lost rows: ' + IDNA_HOST_MATRIX.length + ' of at least 40');
        should.equal(IDNA_HOST_MATRIX.filter(function(row) { return row.throws; }).length,
          IDNA_THROWING_ROW_COUNT,
          'the IDNA matrix marks a different number of rows as throwing than the ' +
          IDNA_THROWING_ROW_COUNT + ' measured on Node 22.23.2');

        IDNA_HOST_MATRIX.forEach(function(row) {
          if (row.throws) {
            return;
          }

          var url      = idnaMatrixUrl(row.host),
              actual   = attempt(parseLegacy, url),
              expected = attempt(nodeUrl.parse, url);

          if (actual.threw || expected.threw) {
            mismatches.push(row.label + ' (' + JSON.stringify(row.host) + '): threw where the ' +
              'matrix says it must not (parseLegacy ' + actual.name + '/' + actual.code +
              ', url.parse ' + expected.name + '/' + expected.code + ')');
            return;
          }

          LEGACY_FIELDS.forEach(function(field) {
            ++compared;

            if (actual.value[field] !== expected.value[field]) {
              mismatches.push(row.label + ' (' + JSON.stringify(row.host) + ') field `' + field +
                '`: parseLegacy gave ' + JSON.stringify(actual.value[field]) + ', url.parse gave ' +
                JSON.stringify(expected.value[field]));
            }
          });
        });

        should.equal(mismatches.join('\n'), '',
          'the reconstructed IDNA step diverged from the runtime\'s own on ' +
          mismatches.length + ' of ' + compared + ' field comparisons');
        should.equal(compared,
          (IDNA_HOST_MATRIX.length - IDNA_THROWING_ROW_COUNT) * LEGACY_FIELDS.length,
          'not every non-throwing row was compared on all twelve fields');
      });

      it('should throw exactly what url.parse throws for every throwing host in the IDNA matrix', function() {
        var problems = [],
            checked  = 0;

        IDNA_HOST_MATRIX.forEach(function(row) {
          if (!row.throws) {
            return;
          }

          var url      = idnaMatrixUrl(row.host),
              actual   = attempt(parseLegacy, url),
              expected = attempt(nodeUrl.parse, url);

          ++checked;

          if (!actual.threw) {
            problems.push(row.label + ' (' + JSON.stringify(row.host) + '): parseLegacy did not ' +
              'throw, it returned ' + JSON.stringify(actual.value && actual.value.href) +
              '; a host that is rejected today would start being accepted');
            return;
          }
          if (!expected.threw) {
            problems.push(row.label + ' (' + JSON.stringify(row.host) + '): url.parse no longer ' +
              'throws, so this row\'s frozen expectation needs re-deriving on this runtime');
            return;
          }
          if (actual.name !== expected.name || actual.code !== expected.code ||
              actual.message !== expected.message) {
            problems.push(row.label + ' (' + JSON.stringify(row.host) + '): parseLegacy threw ' +
              actual.name + '/' + actual.code + ' ' + JSON.stringify(actual.message) +
              ' where url.parse threw ' + expected.name + '/' + expected.code + ' ' +
              JSON.stringify(expected.message));
          }
          if (actual.code !== 'ERR_INVALID_URL') {
            problems.push(row.label + ' (' + JSON.stringify(row.host) + '): the error code is ' +
              actual.code + ', and every consumer\'s error funnel is reached by way of ' +
              'ERR_INVALID_URL');
          }
        });

        should.equal(problems.join('\n'), '',
          'the IDNA throwing set is wrong in ' + problems.length + ' place(s)');
        should.equal(checked, IDNA_THROWING_ROW_COUNT,
          'checked ' + checked + ' throwing rows, expected ' + IDNA_THROWING_ROW_COUNT);
      });

      it('should emit no DEP0170 in a fresh process where url.parse still does', function() {
        // A CHILD PROCESS IS MANDATORY HERE, and the reason is not caution.
        // The claim is about a whole process's stderr, so it can only be made
        // by a process that has not yet loaded anything: this mocha process
        // has required lib/util/url.js, every other application module and the
        // whole test harness, and any of them may legitimately write to
        // stderr. Node's DEP0170 emission site is also guarded by a
        // module-level one-shot flag, and the oracle comparisons in this very
        // suite parse a malformed authority through url.parse -- so the flag is
        // already spent here, and an in-process assertion that "no DEP0170 was
        // emitted" would pass whether the fix exists or not. lib/util/url.js
        // neither carries that emission site nor touches that flag, which is
        // the property the non-poisoning case below measures separately; what
        // makes THIS gate non-vacuous is the control, which runs the same three
        // parses through url.parse in an equally fresh process and must warn.
        this.timeout(30000);

        var repoRoot = nodePath.resolve(__dirname, '..', '..', '..'),
            options  = { cwd : repoRoot, encoding : 'utf8', timeout : 25000 },
            flags    = ['--pending-deprecation', '--trace-deprecation', '-e'],
            gate     = spawnSync(process.execPath, flags.concat(DEP0170_GATE_SNIPPET), options),
            control  = spawnSync(process.execPath, flags.concat(DEP0170_CONTROL_SNIPPET), options);

        should.equal(gate.error ? String(gate.error) : '', '',
          'the parseLegacy child process could not be run');
        should.equal(gate.status, 0,
          'the parseLegacy child process exited ' + gate.status + '; stderr was: ' + gate.stderr);
        should.equal(gate.stderr, '',
          'parseLegacy wrote to stderr under --pending-deprecation --trace-deprecation: ' + gate.stderr);

        // The control proves the assertion above is not vacuous: the same three
        // parses through url.parse must still warn.
        should.equal(control.error ? String(control.error) : '', '',
          'the url.parse control child process could not be run');
        should.equal(control.stderr.length > 0, true,
          'the url.parse control produced no stderr at all, so the gate above proves nothing');
        should.equal(control.stderr.indexOf('DEP0170') !== -1, true,
          'the url.parse control did not emit DEP0170, so the gate above proves nothing; ' +
          'its stderr was: ' + control.stderr);
      });

      it('should leave a later url.parse in the same process still able to report DEP0170', function() {
        // The property the previous revision of lib/util/url.js did NOT have,
        // and the one a future "simplification" is most likely to take back:
        // removing the warning by spending Node's one-shot DEP0170 flag at load
        // time, or by replacing the process-wide warning emitter, makes the
        // helper look warning-free while blinding the entire process to
        // DEP0170 from every other source. Loading and using the helper must
        // therefore change nothing about what url.parse reports afterwards.
        //
        // A child process is what makes this observable at all: the flag is
        // per-process and this mocha process has already spent it.
        this.timeout(30000);

        var repoRoot = nodePath.resolve(__dirname, '..', '..', '..'),
            child    = spawnSync(
              process.execPath,
              ['--pending-deprecation', '--trace-deprecation', '-e', DEP0170_NON_POISONING_SNIPPET],
              { cwd : repoRoot, encoding : 'utf8', timeout : 25000 }
            );

        should.equal(child.error ? String(child.error) : '', '',
          'the non-poisoning child process could not be run');
        should.equal(child.status, 0,
          'the non-poisoning child process exited ' + child.status + '; stderr was: ' + child.stderr);
        should.equal(child.stderr.indexOf('DEP0170') !== -1, true,
          'after lib/util/url.js was loaded and used, a later url.parse of a malformed ' +
          'authority no longer reported DEP0170: loading the helper has made the process blind ' +
          'to that deprecation everywhere else. The child\'s stderr was: ' + child.stderr);
        should.equal(child.stderr.indexOf(DEP0170_LATER_URL) !== -1, true,
          'the DEP0170 the child reported does not name ' + DEP0170_LATER_URL + ', so it cannot ' +
          'be attributed to the url.parse call that followed the helper. Its stderr was: ' +
          child.stderr);
      });
    });

    describe('the fields each parseLegacy consumer reads', function() {

      it('should preserve what lib/controllers/users.js assetUploadFromURL reads', function() {
        // 1. The reject guard `if (!requestUrl.protocol) return request.fail()`.
        ['x', '/x', '//h/x'].forEach(function(input) {
          should.equal(parseLegacy(input).protocol, null,
            'users.assetUploadFromURL would stop rejecting ' + JSON.stringify(input) +
            ' if its protocol were not null');
        });

        // 2. The http/https transport gate, which leaves every other scheme
        //    unsettled. Both halves are asserted: the exact protocol, and that
        //    it is neither of the two the gate admits.
        [
          { input : 'ftp://h/x',           protocol : 'ftp:' },
          { input : 'data:text/plain,x',   protocol : 'data:' }
        ].forEach(function(entry) {
          var protocol = parseLegacy(entry.input).protocol;

          should.equal(protocol, entry.protocol,
            'users.assetUploadFromURL transport gate reads .protocol of ' + JSON.stringify(entry.input));
          should.equal(protocol !== 'http:' && protocol !== 'https:', true,
            'users.assetUploadFromURL must still refuse ' + JSON.stringify(entry.input));
        });

        // 3. The stored upload filename, `path.basename(requestUrl.path)`.
        //    The query string lands IN the filename. That is a PRESERVED
        //    BASELINE DEFECT, not a target: `path` carries the query where
        //    `pathname` does not, it has always fed the stored object name, and
        //    stripping it here would change persisted filenames.
        should.equal(nodePath.basename(parseLegacy('https://cdn/dir/img.png?v=2').path), 'img.png?v=2',
          'the query string must remain in the stored upload filename (preserved baseline defect)');
        should.equal(nodePath.basename(parseLegacy('https://cdn/dir/img.png').path), 'img.png',
          'a query-free source URL yields a clean stored upload filename');

        // 4. The error funnel: a malformed payload URL throws out of the
        //    handler before the temp file is created, reaching the route
        //    catch-all rather than answering.
        var outcome = attempt(parseLegacy, 'http://[::1]:port/x');
        should.equal(outcome.threw, true,
          'a malformed payload URL must still throw out of users.assetUploadFromURL');
        should.equal(outcome.code, 'ERR_INVALID_URL',
          'users.assetUploadFromURL error funnel expects ERR_INVALID_URL, got ' + outcome.code);
      });

      it('should preserve what lib/controllers/trinket.js getByShortCode and downloadZip read', function() {
        // All three sites read `.pathname` and basename it into the S3 key the
        // asset is already stored under, so a divergence here would orphan
        // stored assets silently rather than error.
        should.equal(parseLegacy(STORED_ASSET_URL).pathname, '/userassets/abc123def.png',
          'trinket asset sites read .pathname of ' + STORED_ASSET_URL);
        should.equal(nodePath.basename(parseLegacy(STORED_ASSET_URL).pathname), 'abc123def.png',
          'trinket asset sites derive the stored asset name from .pathname');
        should.equal(nodePath.basename(parseLegacy(STORED_ASSET_URL + '?v=2').pathname), 'abc123def.png',
          'a query-bearing stored URL must NOT put the query into the asset name (.pathname, not .path)');
        should.equal(nodePath.basename(parseLegacy('https://cdn.example.com/userassets/my%20photo.png').pathname),
          'my%20photo.png',
          'a percent-encoded stored asset name must not be decoded');

        // The error funnel: a malformed stored URL throws SYNCHRONOUSLY out of
        // parseLegacy -- which is what lets getByShortCode's promise `.catch`
        // and the two downloadZip loops' route catch-all keep answering as they
        // do today. attempt() catches it, and a catch is only possible for a
        // synchronous throw.
        ['http://[', 'http://[::1]:port/x'].forEach(function(input) {
          var outcome = attempt(parseLegacy, input);

          should.equal(outcome.threw, true,
            'a malformed stored asset URL ' + JSON.stringify(input) +
            ' must throw synchronously at the trinket asset sites');
          should.equal(outcome.code, 'ERR_INVALID_URL',
            'trinket asset error funnel expects ERR_INVALID_URL for ' + JSON.stringify(input) +
            ', got ' + outcome.code);
        });
      });

      it('should preserve what lib/workers/exports.js downloadAsset and addTrinketToArchive read', function() {
        // Both worker sites read `.pathname` and basename it: downloadAsset
        // into the S3 Key it fetches, addTrinketToArchive into the archive
        // entry name, which is a preserved file-format contract.
        [
          { input : STORED_ASSET_URL,                                          derived : 'abc123def.png' },
          { input : STORED_ASSET_URL + '?v=2',                                 derived : 'abc123def.png' },
          { input : 'https://cdn.example.com/userassets/my%20photo.png',       derived : 'my%20photo.png' },
          { input : 'https://cdn.example.com/userassets/nested/dir/logo.svg',  derived : 'logo.svg' }
        ].forEach(function(entry) {
          should.equal(nodePath.basename(parseLegacy(entry.input).pathname), entry.derived,
            'the export worker derives its S3 key / archive entry name from .pathname of ' +
            JSON.stringify(entry.input));
        });

        var outcome = attempt(parseLegacy, 'http://xn--a/x');
        should.equal(outcome.threw, true,
          'a malformed stored asset URL must still throw out of the export worker');
        should.equal(outcome.code, 'ERR_INVALID_URL',
          'the export worker error funnel expects ERR_INVALID_URL, got ' + outcome.code);
      });
    });

    // -----------------------------------------------------------------------
    // The one consumer that can be driven end to end from this suite.
    // -----------------------------------------------------------------------
    // The cases above assert the shared helper's answers; these assert that the
    // REAL registered handler still reads those answers and still routes each
    // one to the disposition it routes to today. Removing the parseLegacy call,
    // reading a different field, catching the throw locally or answering
    // through a different branch changes an outcome here, which is the gap the
    // helper-level cases cannot close on their own.
    //
    // `usersCtrl.assetUploadFromURL` is the application's own module export,
    // invoked directly with a synthesized request rather than through the
    // route, because the route is the part of this path that is already covered
    // by the parity corpus and because two of the four dispositions below --
    // a permanently unsettled request and a throw that escapes into the route
    // catch-all -- cannot be observed from a client at all.
    //
    // The other five sites cannot be driven from here -- two live in a module
    // with no exports at all, one in a module-private function, one needs
    // seeded database state, and one writes its archive to a hard-coded path in
    // a shared temporary directory. The reason is recorded per site on
    // PARSE_LEGACY_SOURCE_CONTRACT above, and their bindings are pinned in
    // source in the describe that follows this one.
    describe('lib/controllers/users.js assetUploadFromURL, driven as the real exported handler', function() {
      var savedAssetsFeature,
          savedFetch,
          savedUploadUserAsset,
          savedConsoleLog,
          fetchCalls      = [],
          uploadCalls     = [],
          temporaryPaths  = [];

      /**
       * Clears the shared per-call records, so a case that drives several table
       * entries can assert on one entry at a time.
       *
       * @returns {undefined}
       */
      function resetRecords() {
        fetchCalls.length = 0;
        uploadCalls.length = 0;
      }

      before(function() {
        savedAssetsFeature   = config.features.assets;
        savedFetch           = global.fetch;
        savedUploadUserAsset = FileUtil.uploadUserAsset;
        savedConsoleLog      = console.log;

        // config/default.yaml ships `features.assets: false`, and the handler
        // answers `notImplemented` and returns BEFORE it reaches parseLegacy
        // when it is off -- so without this flip every case below would assert
        // against a 501 and measure nothing. Flipped on the loaded config
        // object rather than in a config file so that nothing outside this
        // describe is affected, and restored by value in `after`.
        config.features.assets = true;
        should.equal(config.features.assets, true,
          'config.features.assets could not be turned on, so assetUploadFromURL would ' +
          'short-circuit to notImplemented and the cases below would prove nothing');

        // Both stubs stay installed for the whole describe, including for the
        // three cases that must never reach them: that is what lets those cases
        // assert `fetchCalls` and `uploadCalls` are empty instead of silently
        // making a real network request or a real S3 upload if a disposition
        // regresses.
        global.fetch = function(resource) {
          fetchCalls.push(resource);

          return Promise.resolve({
            headers : {
              get : function(name) {
                return String(name).toLowerCase() === 'content-type' ? STUB_CONTENT_TYPE : null;
              }
            },
            // The handler reads `response.body` and falls back to an empty
            // stream when it is absent, which is the shortest path through the
            // pipe-and-upload branch that still exercises it in full.
            body : null
          });
        };

        FileUtil.uploadUserAsset = function(fileupload, user, callback) {
          uploadCalls.push({ fileupload : fileupload, user : user });
          temporaryPaths.push(fileupload.path);

          callback(null, { id : 'stub-file-id', name : fileupload.filename });
        };
      });

      beforeEach(resetRecords);

      after(function() {
        config.features.assets   = savedAssetsFeature;
        global.fetch             = savedFetch;
        FileUtil.uploadUserAsset = savedUploadUserAsset;
        console.log              = savedConsoleLog;

        // Every temporary file the handler created is removed, and its removal
        // asserted: `tmp.tmpName` only names a file, but the handler then opens
        // a write stream on it, so a case that reaches the upload leaves a real
        // file behind. No try/catch here on purpose -- a temporary file that
        // cannot be removed is worth failing this hook for.
        temporaryPaths.forEach(function(candidate) {
          if (typeof candidate === 'string' && fs.existsSync(candidate)) {
            fs.unlinkSync(candidate);
          }

          should.equal(typeof candidate === 'string' && fs.existsSync(candidate), false,
            'the temporary upload file ' + candidate + ' outlived this suite');
        });

        // The proof of restoration, asserted rather than assumed: a failing
        // `after` hook fails the run, so these are the record that this
        // describe left no state behind for the rest of the suite -- which
        // matters because --check-leaks is on and because `features.assets`
        // gates whole routes.
        should.equal(savedAssetsFeature, false,
          'config.features.assets was not false when this describe started, so the ' +
          'restoration below is restoring the wrong value');
        should.equal(config.features.assets, false,
          'config.features.assets was left switched on');
        should.equal(global.fetch, savedFetch,
          'global.fetch was left stubbed');
        should.equal(FileUtil.uploadUserAsset, savedUploadUserAsset,
          'FileUtil.uploadUserAsset was left stubbed');
        should.equal(console.log, savedConsoleLog,
          'console.log was left captured');
      });

      it('should reject a protocol-less payload URL through request.fail()', function() {
        this.timeout(30000);

        // The `!requestUrl.protocol` guard, driven through the handler. If the
        // parse were removed, or resolved against a base, or read a different
        // field, these three would stop reaching request.fail() -- and two of
        // them ('/x' and 'relative') would be fetched instead.
        return forEachInSequence(PROTOCOL_LESS_UPLOAD_URLS, function(url) {
          var request = recordingRequest(url);

          resetRecords();

          return settlement(function() {
            return usersCtrl.assetUploadFromURL(request, toolkitStub());
          }, HANDLER_SETTLE_MS).then(function(outcome) {
            should.equal(outcome.state, 'resolved',
              'assetUploadFromURL(' + JSON.stringify(url) + ') ' + outcome.state +
              ' instead of answering; error was ' + (outcome.error && outcome.error.message));
            should.equal(outcome.value, FAIL_DISPOSITION,
              'assetUploadFromURL(' + JSON.stringify(url) + ') must RETURN what request.fail() ' +
              'returned, so the route wrapper sends that response');
            should.equal(request.record.fail.length, 1,
              'assetUploadFromURL(' + JSON.stringify(url) + ') called request.fail ' +
              request.record.fail.length + ' times, expected exactly once');
            should.equal(request.record.fail[0], undefined,
              'request.fail must still be called with no argument for ' + JSON.stringify(url) +
              ', which is what selects the generic failure response');
            should.equal(request.record.success.length, 0,
              'assetUploadFromURL(' + JSON.stringify(url) + ') must not succeed');
            should.equal(fetchCalls.length, 0,
              'assetUploadFromURL(' + JSON.stringify(url) + ') fetched ' +
              JSON.stringify(fetchCalls) + '; a protocol-less URL must be rejected before any ' +
              'transport is attempted');
            should.equal(uploadCalls.length, 0,
              'assetUploadFromURL(' + JSON.stringify(url) + ') reached the upload');
          });
        });
      });

      it('should refuse a non-http(s) payload URL at the transport gate and never settle', function() {
        this.timeout(30000);

        // The second `.protocol` read. The refusal is observable through the
        // exception it raises at process scope and through the request never
        // settling, so both are asserted: the exception's message names the
        // exact protocol the gate read, which is what proves the field came
        // from the parse result.
        return forEachInSequence(NON_TRANSPORT_UPLOAD_URLS, function(entry) {
          var request = recordingRequest(entry.url);

          resetRecords();

          return withCapturedUncaught(function() {
            return settlement(function() {
              return usersCtrl.assetUploadFromURL(request, toolkitStub());
            }, HANDLER_PENDING_MS);
          }).then(function(captured) {
            var raised = captured.errors.map(function(error) {
              return (error && error.message) || String(error);
            }).join('\n');

            should.equal(captured.value.state, 'pending',
              'assetUploadFromURL(' + JSON.stringify(entry.url) + ') ' + captured.value.state +
              ' where baseline leaves the request permanently unsettled; a scheme other than ' +
              'http/https must not become an answered request');
            should.equal(captured.errors.length, 1,
              'assetUploadFromURL(' + JSON.stringify(entry.url) + ') raised ' +
              captured.errors.length + ' process-scope exceptions, expected exactly one; the ' +
              'replaced package raised before any listener existed, so the refusal must reach ' +
              'process scope rather than being logged and swallowed');
            should.equal(raised.indexOf('Invalid protocol: ' + entry.protocol) !== -1, true,
              'assetUploadFromURL(' + JSON.stringify(entry.url) + ') must name the protocol it ' +
              'refused, which is the only evidence the transport gate read .protocol off the ' +
              'parse result; it raised ' + JSON.stringify(raised));
            should.equal(request.record.fail.length, 0,
              'assetUploadFromURL(' + JSON.stringify(entry.url) + ') answered with request.fail ' +
              'where baseline hangs');
            should.equal(request.record.success.length, 0,
              'assetUploadFromURL(' + JSON.stringify(entry.url) + ') answered with ' +
              'request.success where baseline hangs');
            should.equal(fetchCalls.length, 0,
              'assetUploadFromURL(' + JSON.stringify(entry.url) + ') fetched ' +
              JSON.stringify(fetchCalls) + '; the gate must refuse the scheme before any ' +
              'transport is attempted');
            should.equal(uploadCalls.length, 0,
              'assetUploadFromURL(' + JSON.stringify(entry.url) + ') reached the upload');
          });
        });
      });

      it('should let ERR_INVALID_URL escape assetUploadFromURL into the route catch-all', function() {
        this.timeout(30000);

        // The error funnel, at the one consumer where it can be observed
        // directly: the throw must leave the handler as a REJECTION, because
        // that is what the route wrapper's catch-all turns into the 500 the
        // corpus records. A local try/catch, a `null` return from the helper or
        // a translated error would all show up here as a resolved promise.
        return forEachInSequence(MALFORMED_UPLOAD_URLS, function(url) {
          var request = recordingRequest(url);

          resetRecords();

          return settlement(function() {
            return usersCtrl.assetUploadFromURL(request, toolkitStub());
          }, HANDLER_SETTLE_MS).then(function(outcome) {
            should.equal(outcome.state, 'rejected',
              'assetUploadFromURL(' + JSON.stringify(url) + ') ' + outcome.state +
              ' instead of rejecting; the malformed-URL throw must reach the route catch-all, ' +
              'not be handled inside the handler');
            should.equal(outcome.error && outcome.error.name, 'TypeError',
              'assetUploadFromURL(' + JSON.stringify(url) + ') rejected with ' +
              (outcome.error && outcome.error.name) + ', expected TypeError');
            should.equal(outcome.error && outcome.error.code, 'ERR_INVALID_URL',
              'assetUploadFromURL(' + JSON.stringify(url) + ') rejected with code ' +
              (outcome.error && outcome.error.code) + ', expected ERR_INVALID_URL');
            should.equal(request.record.fail.length, 0,
              'the ERR_INVALID_URL throw for ' + JSON.stringify(url) + ' was caught and turned ' +
              'into request.fail(), which changes the response the route produces');
            should.equal(request.record.success.length, 0,
              'the ERR_INVALID_URL throw for ' + JSON.stringify(url) + ' was swallowed and the ' +
              'request answered successfully');
            should.equal(fetchCalls.length, 0,
              'assetUploadFromURL(' + JSON.stringify(url) + ') fetched ' +
              JSON.stringify(fetchCalls) + '; the parse throws before any transport');
            should.equal(uploadCalls.length, 0,
              'assetUploadFromURL(' + JSON.stringify(url) + ') reached the upload');
          });
        });
      });

      it('should derive the stored upload filename from .path, query string included', function() {
        this.timeout(30000);

        // The third field read, driven all the way to the upload call. The
        // query string lands IN the stored filename. That is a PRESERVED
        // BASELINE DEFECT, not a target: `.path` carries the query where
        // `.pathname` does not, it has always fed the stored object name
        // through lib/util/file.js, and stripping it would orphan existing
        // objects. Reading `.pathname` here instead -- the field the other five
        // consumers read -- fails the first row.
        return forEachInSequence(UPLOAD_FILENAME_CASES, function(testCase) {
          var request = recordingRequest(testCase.url);

          resetRecords();

          return settlement(function() {
            return usersCtrl.assetUploadFromURL(request, toolkitStub());
          }, HANDLER_SETTLE_MS).then(function(outcome) {
            should.equal(outcome.state, 'resolved',
              'assetUploadFromURL(' + JSON.stringify(testCase.url) + ') ' + outcome.state +
              ' instead of uploading; error was ' + (outcome.error && outcome.error.message));
            should.equal(outcome.value, SUCCESS_DISPOSITION,
              'assetUploadFromURL(' + JSON.stringify(testCase.url) + ') must RETURN what ' +
              'request.success() returned');
            should.equal(uploadCalls.length, 1,
              'assetUploadFromURL(' + JSON.stringify(testCase.url) + ') called uploadUserAsset ' +
              uploadCalls.length + ' times, expected exactly once');
            should.equal(uploadCalls[0].fileupload.filename, testCase.filename,
              'the stored upload filename for ' + JSON.stringify(testCase.url) + ' is ' +
              JSON.stringify(uploadCalls[0].fileupload.filename) + ', not ' +
              JSON.stringify(testCase.filename) + '; it must stay ' +
              'path.basename(parseLegacy(url).path), query string and all');
            should.equal(uploadCalls[0].user, request.user,
              'the upload must be attributed to request.user');
            should.equal(uploadCalls[0].fileupload.headers['content-type'], STUB_CONTENT_TYPE,
              'the upload must carry the content type the response reported');
            should.equal(typeof uploadCalls[0].fileupload.path, 'string',
              'the upload must carry the temporary file path the handler wrote to');
            should.equal(fetchCalls.length, 1,
              'assetUploadFromURL(' + JSON.stringify(testCase.url) + ') fetched ' +
              fetchCalls.length + ' times, expected exactly once');
            should.equal(fetchCalls[0], testCase.url,
              'the transport must be given the payload URL verbatim, not the reassembled parse');
            should.equal(request.record.success.length, 1,
              'request.success must be called exactly once for ' + JSON.stringify(testCase.url));
            should.equal(request.record.fail.length, 0,
              'request.fail must not be called for ' + JSON.stringify(testCase.url));
            request.record.success[0].should.have.property('file');
          });
        });
      });
    });

    // -----------------------------------------------------------------------
    // The five consumers that cannot be invoked from here, pinned in source.
    // -----------------------------------------------------------------------
    // The rationale for reading source rather than executing it is on
    // PARSE_LEGACY_SOURCE_CONTRACT above, and it is specific rather than
    // general: two of the six sites live in a module with no exports at all,
    // which cannot be loaded without opening a Mongo connection and a queue and
    // registering a long-lived processor; one lives in a module-private
    // function; one needs seeded database state this describe does not have;
    // and one writes an archive to a hard-coded path in a shared temporary
    // directory that nothing here could clean up safely. Their BINDING -- not
    // their execution -- is what this suite can guard, and each assertion below
    // names the consumer and what a failure there would mean for it.
    describe('the parseLegacy binding at each consumer, pinned in source', function() {

      it('should keep every parseLegacy call site, its argument and the field it reads', function() {
        var problems  = [],
            siteTotal = 0;

        should.equal(PARSE_LEGACY_SOURCE_CONTRACT.length, 3,
          'the source contract must still cover all three consumer files');

        PARSE_LEGACY_SOURCE_CONTRACT.forEach(function(contract) {
          var source    = readConsumerSource(contract.file),
              variables = capturedParseVariables(source.masked),
              calls     = countMatches(source.masked, /parseLegacy\s*\(/g);

          // The import, checked against the RAW text because the mask blanks
          // string literals and the module path is a string. A consumer that
          // resolved parseLegacy from anywhere else would not be sharing the
          // one legacy-compatible parser.
          if (source.raw.indexOf(contract.importForm) === -1) {
            problems.push(contract.file + ' no longer imports parseLegacy as ' +
              contract.importForm + ', so it is not using the shared helper in lib/util/url.js');
          }

          if (calls < contract.totalCalls) {
            problems.push(contract.file + ' has ' + calls + ' parseLegacy call(s), expected at ' +
              'least ' + contract.totalCalls + '; a deleted call means that consumer has ' +
              'stopped parsing its URL at all');
          }

          contract.assignedSites.forEach(function(site) {
            var found = countMatches(source.masked, new RegExp(callPattern(site.argument), 'g'));

            siteTotal += site.occurrences;

            if (found < site.occurrences) {
              problems.push(contract.file + ': ' + site.consumer + ' has ' + found +
                ' parseLegacy(' + site.argument + ') call(s), expected at least ' +
                site.occurrences);
            }
          });

          contract.inlineSites.forEach(function(site) {
            var pattern = new RegExp(
                  dottedPattern(site.wrapper) + '\\s*\\(\\s*' + callPattern(site.argument) +
                  '\\s*\\.\\s*' + site.field + '(?![\\w$])\\s*\\)', 'g'
                ),
                found   = countMatches(source.masked, pattern);

            siteTotal += site.occurrences;

            if (found < site.occurrences) {
              problems.push(contract.file + ': ' + site.consumer + ' no longer reads ' +
                site.wrapper + '(parseLegacy(' + site.argument + ').' + site.field + ') (' +
                found + ' of at least ' + site.occurrences + '), so ' + site.meaning);
            }
          });

          if (contract.assignedSites.length > 0 && variables.length === 0) {
            problems.push(contract.file + ' assigns no parseLegacy result to a variable, so the ' +
              'field reads below cannot be located');
            return;
          }

          contract.fieldReads.forEach(function(read) {
            var found = countFieldReads(source.masked, variables, read);

            if (found < read.occurrences) {
              problems.push(contract.file + ' (variables ' + JSON.stringify(variables) + '): ' +
                read.label + ' now appears ' + found + ' time(s), expected at least ' +
                read.occurrences + '; ' + read.meaning);
            }
          });

          contract.forbiddenFields.forEach(function(forbidden) {
            var found = countFieldReads(source.masked, variables, { field : forbidden.field });

            if (found !== 0) {
              problems.push(contract.file + ' (variables ' + JSON.stringify(variables) + ') now ' +
                'reads .' + forbidden.field + ' off a parseLegacy result ' + found + ' time(s); ' +
                forbidden.meaning);
            }
          });
        });

        should.equal(problems.join('\n'), '',
          'the parseLegacy source contract is broken in ' + problems.length + ' place(s)');
        should.equal(siteTotal, 6,
          'the contract must still account for all six call sites, it accounts for ' + siteTotal);
      });

      it('should keep every parseLegacy call site outside a try that would swallow the throw', function() {
        var problems = [],
            total    = 0;

        PARSE_LEGACY_SOURCE_CONTRACT.forEach(function(contract) {
          var scan = scanParseLegacyCallSites(readConsumerSource(contract.file).masked);

          // The self-check on the mask, asserted first: a scan whose braces do
          // not balance has mis-parsed the file, and every `insideTry` verdict
          // it produced is worthless. Failing here is the loud alternative to
          // passing vacuously.
          if (scan.balance !== 0 || scan.minimumDepth !== 0) {
            problems.push(contract.file + ': the source scan does not balance (final depth ' +
              scan.balance + ', minimum depth ' + scan.minimumDepth + '), so its try-block ' +
              'verdicts cannot be trusted -- maskJavaScript in this file needs to learn the ' +
              'construct that was added');
            return;
          }

          total += scan.sites.length;

          scan.sites.forEach(function(site) {
            if (site.insideTry) {
              problems.push(contract.file + ':' + site.line + ': the parseLegacy call is inside ' +
                'a try block. Every consumer depends on ERR_INVALID_URL escaping to its own ' +
                'error funnel -- the route catch-all for the controller sites and an unsettled ' +
                'deferred in the export worker -- so catching it locally changes the response ' +
                'or the job outcome for a malformed stored URL');
            }
          });
        });

        should.equal(problems.join('\n'), '',
          problems.length + ' problem(s) with the error-funnel binding');
        should.equal(total, 6,
          'the scan located ' + total + ' parseLegacy call sites across the three consumer ' +
          'files, expected 6');
      });
    });

    describe('lib/controllers/files.js legacyMimeExtension, frozen against mime 1.2.11', function() {

      it('should answer with mime 1.2.11 for all 13 types whose mapping mime 4 changed or lost', function() {
        var problems = [];

        MIME_DIVERGENCE.forEach(function(row) {
          var legacyValue  = filesCtrl.legacyMimeExtension(row.type),
              currentValue = mime.getExtension(row.type);

          if (legacyValue !== row.legacy) {
            problems.push(row.type + ': legacyMimeExtension gave ' + JSON.stringify(legacyValue) +
              ', mime 1.2.11 answered ' + JSON.stringify(row.legacy));
          }
          // Asserted on the same row so a mime database move fails loudly here
          // instead of quietly agreeing with a table that is no longer needed.
          if (currentValue !== row.current) {
            problems.push(row.type + ': mime 4 now answers ' + JSON.stringify(currentValue) +
              ' rather than ' + JSON.stringify(row.current) + '. ' + MIME_DRIFT_REMEDY);
          }
        });

        should.equal(problems.join('\n'), '',
          MIME_DIVERGENCE.length + ' explicit mappings checked, ' + problems.length + ' wrong');
        should.equal(MIME_DIVERGENCE.length, 13,
          'the explicit divergence table must carry all 13 measured types');
      });

      it('should keep the whole-database divergence set at its frozen size and digest', function() {
        // The completeness tripwire. The 13 explicit assertions above are a
        // sample of the divergence; this one covers mime 4's ENTIRE database,
        // which is what makes "every changed mapping" true rather than sampled.
        var database = loadMimeDatabase(),
            types    = Object.keys(database);

        should.equal(types.length >= 1000, true,
          'mime 4\'s type database loaded only ' + types.length + ' types (' +
          MIME_DATABASE_TYPES_SEEN + ' measured), so this tripwire would pass vacuously');

        var divergent = types.filter(function(type) {
          return filesCtrl.legacyMimeExtension(type) !== mime.getExtension(type);
        });

        should.equal(divergent.length, MIME_DIVERGENT_TYPE_COUNT,
          'the divergence set is now ' + divergent.length + ' types, not ' +
          MIME_DIVERGENT_TYPE_COUNT + '. ' + MIME_DRIFT_REMEDY);

        var digest = crypto.createHash('sha256').update(canonicalDivergence(divergent)).digest('hex');

        should.equal(digest, MIME_DIVERGENCE_DIGEST,
          'the divergence set has the expected size but different contents (digest ' + digest +
          '). ' + MIME_DRIFT_REMEDY);
      });

      it('should reproduce mime 1.2.11 normalization, including the TypeError on a non-string', function() {
        should.equal(MIME_EDGES.length >= 8, true,
          'the algorithmic-edge table lost cases: ' + MIME_EDGES.length + ' of at least 8');

        MIME_EDGES.forEach(function(row) {
          should.equal(filesCtrl.legacyMimeExtension(row.input), row.legacy,
            'legacyMimeExtension(' + JSON.stringify(row.input) + ') must answer ' +
            JSON.stringify(row.legacy) + ' as mime 1.2.11 did');
          should.equal(mime.getExtension(row.input), row.current,
            'mime 4 now answers ' + JSON.stringify(mime.getExtension(row.input)) + ' for ' +
            JSON.stringify(row.input) + ' rather than ' + JSON.stringify(row.current) + '. ' +
            MIME_DRIFT_REMEDY);
        });

        // A non-string content type threw a TypeError straight out of the
        // handler at baseline, which the route wrapper's catch-all maps onto a
        // 500. mime 4 silently answers null instead, which would have turned
        // that edge into a 200 with no extension, so the throw is asserted.
        var outcome = attempt(filesCtrl.legacyMimeExtension, undefined);

        should.equal(outcome.threw, true,
          'legacyMimeExtension(undefined) must throw as baseline did, it returned ' +
          JSON.stringify(outcome.value));
        should.equal(outcome.name, 'TypeError',
          'legacyMimeExtension(undefined) must throw a TypeError, it threw ' + outcome.name);
        should.equal(mime.getExtension(undefined), null,
          'mime 4 answers null for a non-string, which is the behaviour this layer replaces');
      });
    });

    describe('lib/controllers/files.js inlineImageDisposition, on mismatched metadata', function() {

      it('should serve a genuine raster image inline for every allowlisted type', function() {
        should.equal(INLINE_CASES.length >= 16, true,
          'the inline table lost cases: ' + INLINE_CASES.length + ' of at least 16');

        INLINE_CASES.forEach(function(testCase) {
          var outcome = attempt(function(head) {
            return filesCtrl.inlineImageDisposition(testCase.mime, head);
          }, testCase.head);

          should.equal(outcome.threw, false,
            'inlineImageDisposition threw ' + outcome.name + ' for ' + testCase.label);
          should.equal(outcome.value, 'inline',
            testCase.label + ' must be served inline, got ' + JSON.stringify(outcome.value));
        });
      });

      it('should serve mismatched, script-capable or uninterpretable metadata as an attachment', function() {
        // The point of FE-13: `type` and `mime` are independent legacy fields
        // with no validation between them, so neither one alone may authorise
        // inline rendering on the application origin. Every case here is one
        // where the declared type and the bytes disagree, the declared type can
        // execute in a browsing context, or one of the two cannot be read at
        // all -- and every one must answer 'attachment' without throwing,
        // because a throwing classifier would turn a download into a 500.
        should.equal(ATTACHMENT_CASES.length >= 21, true,
          'the attachment table lost cases: ' + ATTACHMENT_CASES.length + ' of at least 21');

        ATTACHMENT_CASES.forEach(function(testCase) {
          var outcome = attempt(function(head) {
            return filesCtrl.inlineImageDisposition(testCase.mime, head);
          }, testCase.head);

          should.equal(outcome.threw, false,
            'inlineImageDisposition threw ' + outcome.name + ' for ' + testCase.label +
            '; it must never throw');
          should.equal(outcome.value, 'attachment',
            testCase.label + ' must be served as an attachment, got ' + JSON.stringify(outcome.value));
        });
      });
    });
  });
}
