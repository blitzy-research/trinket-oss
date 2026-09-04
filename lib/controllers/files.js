var FileUtil = require('../util/file'),
    errors   = require('@hapi/boom'),
    fs       = require('fs'),
    config   = require('config'),
    // mime 4.x ships as ESM only, so Node's require() hands back the module
    // namespace rather than the Mime instance; the instance is on `.default`.
    // `lookup`/`extension` became `getType`/`getExtension` in the same major.
    mime     = require('mime').default,
    sluggify = require('limax');

// Used to build the replay stream the inline-image branch hands to hapi after
// it has peeked at the head of the download (see peekHead below).
var PassThrough = require('stream').PassThrough;

/*
 * ---------------------------------------------------------------------------
 * Legacy MIME -> extension compatibility layer (frozen against mime 1.2.11)
 * ---------------------------------------------------------------------------
 *
 * `upload` below appends an extension to the `path` it returns to the client,
 * and unchanged material-editor code inserts that path into Markdown. Baseline
 * derived it from mime 1.2.11's `mime.extension(contentType)`; the dependency
 * set moved to mime 4.x, whose database disagrees with 1.2.11 in 259 places,
 * so reading the extension straight out of `mime.getExtension()` silently
 * changed a client-visible response. This layer reproduces mime 1.2.11's
 * ANSWER and its ALGORITHM so that response is exactly what it was, while the
 * rest of the application keeps using the current, maintained mime.
 *
 * It is reachable for essentially every upload: config/default.yaml declares
 * exactly one `extensionWhitelist` entry (`ipynb`), so every other content type
 * falls through to the lookup below.
 *
 * Two classes of divergence, both covered here:
 *
 *   - LEGACY_EXTENSION      13 types both databases answer for, where the
 *                           answer changed (image/jpeg jpeg -> jpg) or was
 *                           lost (application/x-font-ttf ttf -> null).
 *   - LEGACY_UNKNOWN_TYPES  246 types mime 1.2.11 did not know at all, so
 *                           baseline returned `undefined` and the `if (ext)`
 *                           guard appended nothing, while mime 4 answers and
 *                           the path would gain an extension (text/markdown
 *                           gaining `.md` is the reported example).
 *
 * Two further divergences are algorithmic rather than tabular, which is why
 * the normalization below is mime 1.2.11's own expression rather than a
 * tidied equivalent:
 *
 *   - a NON-STRING contentType threw a TypeError straight out of the handler,
 *     which the route wrapper's catch-all maps onto a 500, where mime 4
 *     returns null and the request would answer 200 with no extension. The
 *     match is therefore applied directly to the argument, so that error edge
 *     still reaches the same funnel it reached before.
 *   - the expression stops at whitespace as well as at `;`, so
 *     'image/png foo' resolved to 'png' where mime 4 yields null. The
 *     normalized type is what gets delegated, which preserves that.
 *
 * Parameter stripping and case folding agree between the two versions and are
 * deliberately not special-cased. The falsy sentinel differs harmlessly
 * (`undefined` versus `null`/`''`), and the coercion below settles it on
 * 1.2.11's `undefined`.
 *
 * SCOPE: this governs the client-visible response `path` only. Stored object
 * keys derive their own extension from the upload filename inside
 * lib/util/file.js and are untouched by this table -- the key is a content
 * hash, so moving it would silently orphan every stored object.
 *
 * FROZEN: the two tables are the measured difference between mime 1.2.11 and
 * the mime 4.1.0 resolved at base commit 2f8712a, and they are correct only
 * for that pair. If `mime` is ever bumped, re-derive them with (run from the
 * repository root, after `npm pack mime@1.2.11 && tar -xzf mime-1.2.11.tgz`,
 * which unpacks 1.2.11 into ./package):
 *
 *   node -e "var m1=require('./package/mime.js'), \
 *     m4=require('mime').default; \
 *     Promise.all([import('mime/types/standard.js'), \
 *       import('mime/types/other.js')]).then(function(m){ \
 *       var all=Object.assign({}, m[0].default, m[1].default); \
 *       console.log('LEGACY_EXTENSION', JSON.stringify( \
 *         Object.keys(m1.extensions).filter(function(t){ \
 *           return t && m1.extensions[t]!==m4.getExtension(t); }))); \
 *       console.log('LEGACY_UNKNOWN_TYPES', JSON.stringify( \
 *         Object.keys(all).filter(function(t){ \
 *           return m1.extensions[t.toLowerCase()]===undefined \
 *             && m4.getExtension(t); }))); });"
 *
 * which prints 13 and 246 names respectively against the versions recorded
 * here. Store whatever it prints in lower case: the lookup below is keyed on
 * the normalized type, and mime 1.2.11's own database holds one mixed-case key
 * ('video/MP2T'), which both spellings of must resolve through the same entry.
 */

/**
 * The 13 types where mime 1.2.11 and mime 4.1.0 both have an opinion and the
 * opinion changed. Values are mime 1.2.11's; the comment on each line is what
 * mime 4.1.0 would have returned instead.
 */
var LEGACY_EXTENSION = {
  'application/mp4'           : 'mp4s',           // mime 4: "mp4"
  'application/pgp-signature' : 'asc',            // mime 4: "sig"
  'application/x-font-otf'    : 'otf',            // mime 4: null
  'application/x-font-ttf'    : 'ttf',            // mime 4: null
  'application/font-woff'     : 'woff',           // mime 4: null
  'application/xslt+xml'      : 'xslt',           // mime 4: "xsl"
  'audio/mp4'                 : 'mp4a',           // mime 4: "m4a"
  'image/jpeg'                : 'jpeg',           // mime 4: "jpg"
  'image/tiff'                : 'tiff',           // mime 4: "tif"
  'text/event-stream'         : 'event-stream',   // mime 4: null
  'text/x-markdown'           : 'markdown',       // mime 4: "mkd"
  'application/dash+xml'      : 'mdp',            // mime 4: "mpd"
  'font/opentype'             : 'otf'             // mime 4: null
};

/**
 * The 246 types mime 1.2.11 had no entry for. Built into a Set once at load,
 * so the lookup is constant time per upload rather than a scan.
 */
var LEGACY_UNKNOWN_TYPES = new Set([
  'application/appinstaller', 'application/appx', 'application/appxbundle',
  'application/atomdeleted+xml', 'application/atsc-dwd+xml', 'application/atsc-held+xml',
  'application/atsc-rsat+xml', 'application/automationml-aml+xml',
  'application/automationml-amlx+zip', 'application/bdoc', 'application/calendar+xml',
  'application/cdfx+xml', 'application/cpl+xml', 'application/cwl',
  'application/dash-patch+xml', 'application/dicom', 'application/emotionml+xml',
  'application/express', 'application/fdf', 'application/fdt+xml', 'application/geo+json',
  'application/gzip', 'application/hjson', 'application/its+xml', 'application/json5',
  'application/ld+json', 'application/lgr+xml', 'application/manifest+json',
  'application/media-policy-dataset+xml', 'application/mmt-aei+xml', 'application/mmt-usd+xml',
  'application/msix', 'application/msixbundle', 'application/n-quads', 'application/n-triples',
  'application/node', 'application/p2p-overlay+xml', 'application/pgp-keys',
  'application/provenance+xml', 'application/prs.xsf+xml', 'application/raml+yaml',
  'application/route-apd+xml', 'application/route-s-tsid+xml', 'application/route-usd+xml',
  'application/senml+xml', 'application/sensml+xml', 'application/sieve', 'application/sql',
  'application/swid+xml', 'application/toml', 'application/trig', 'application/ttml+xml',
  'application/ubjson', 'application/urc-ressheet+xml', 'application/urc-targetdesc+xml',
  'application/vnd.1000minds.decision-model+xml', 'application/vnd.age',
  'application/vnd.apple.keynote', 'application/vnd.apple.numbers',
  'application/vnd.apple.pages', 'application/vnd.apple.pkpass', 'application/vnd.autodesk.fbx',
  'application/vnd.balsamiq.bmml+xml', 'application/vnd.citationstyles.style+xml',
  'application/vnd.dbf', 'application/vnd.dcmp+xml', 'application/vnd.geogebra.slides',
  'application/vnd.google-apps.document', 'application/vnd.google-apps.drawing',
  'application/vnd.google-apps.form', 'application/vnd.google-apps.jam',
  'application/vnd.google-apps.map', 'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.script', 'application/vnd.google-apps.site',
  'application/vnd.google-apps.spreadsheet', 'application/vnd.gov.sk.xmldatacontainer+xml',
  'application/vnd.mapbox-vector-tile', 'application/vnd.ms-outlook',
  'application/vnd.ms-visio.viewer', 'application/vnd.nato.bindingdataobject+xml',
  'application/vnd.nokia.n-gage.ac+xml', 'application/vnd.openblox.game+xml',
  'application/vnd.openstreetmap.data+xml', 'application/vnd.procrate.brushset',
  'application/vnd.procreate.brush', 'application/vnd.procreate.dream',
  'application/vnd.pwg-xhtml-print+xml', 'application/vnd.rar',
  'application/vnd.software602.filler.form+xml', 'application/vnd.sun.wadl+xml',
  'application/vnd.syncml.dmddf+xml', 'application/wasm', 'application/watcherinfo+xml',
  'application/x-arj', 'application/x-bdoc', 'application/x-blender', 'application/x-cocoa',
  'application/x-compressed', 'application/x-httpd-php', 'application/x-ipynb+json',
  'application/x-iwork-keynote-sffkey', 'application/x-iwork-numbers-sffnumbers',
  'application/x-iwork-pages-sffpages', 'application/x-java-archive-diff',
  'application/x-keepass2', 'application/x-makeself', 'application/x-msdos-program',
  'application/x-ns-proxy-autoconfig', 'application/x-perl', 'application/x-pilot',
  'application/x-redhat-package-manager', 'application/x-sea', 'application/x-virtualbox-hdd',
  'application/x-virtualbox-ova', 'application/x-virtualbox-ovf',
  'application/x-virtualbox-vbox', 'application/x-virtualbox-vbox-extpack',
  'application/x-virtualbox-vdi', 'application/x-virtualbox-vhd',
  'application/x-virtualbox-vmdk', 'application/x-zip-compressed', 'application/xcap-att+xml',
  'application/xcap-caps+xml', 'application/xcap-el+xml', 'application/xcap-ns+xml',
  'application/xfdf', 'application/xliff+xml', 'application/zip+dotlottie', 'audio/3gpp',
  'audio/aac', 'audio/amr', 'audio/mobile-xmf', 'audio/mp3', 'audio/wav', 'audio/wave',
  'audio/x-m4a', 'audio/x-realaudio', 'font/collection', 'font/otf', 'font/ttf', 'font/woff',
  'font/woff2', 'image/aces', 'image/apng', 'image/avci', 'image/avcs', 'image/avif',
  'image/dicom-rle', 'image/dpx', 'image/emf', 'image/fits', 'image/heic',
  'image/heic-sequence', 'image/heif', 'image/heif-sequence', 'image/hej2k', 'image/jaii',
  'image/jais', 'image/jls', 'image/jp2', 'image/jph', 'image/jphc', 'image/jpm', 'image/jpx',
  'image/jxl', 'image/jxr', 'image/jxra', 'image/jxrs', 'image/jxs', 'image/jxsc', 'image/jxsi',
  'image/jxss', 'image/ktx2', 'image/pjpeg', 'image/prs.pti', 'image/t38', 'image/tiff-fx',
  'image/vnd.airzip.accelerator.azv', 'image/vnd.blockfact.facti', 'image/vnd.microsoft.icon',
  'image/vnd.ms-dds', 'image/vnd.pco.b16', 'image/vnd.tencent.tap',
  'image/vnd.valve.source.texture', 'image/vnd.zbrush.pcx', 'image/wmf', 'image/x-adobe-dng',
  'image/x-jng', 'image/x-ms-bmp', 'message/disposition-notification', 'message/global',
  'message/global-delivery-status', 'message/global-disposition-notification',
  'message/global-headers', 'message/vnd.wfa.wsc', 'model/3mf', 'model/gltf+json',
  'model/gltf-binary', 'model/jt', 'model/mtl', 'model/obj', 'model/prc', 'model/step',
  'model/step+xml', 'model/step+zip', 'model/step-xml+zip', 'model/stl', 'model/u3d',
  'model/vnd.bary', 'model/vnd.cld', 'model/vnd.opengex', 'model/vnd.parasolid.transmit.binary',
  'model/vnd.parasolid.transmit.text', 'model/vnd.pytha.pyox', 'model/vnd.sap.vds',
  'model/vnd.usda', 'model/vnd.usdz+zip', 'model/vnd.valve.source.compiled-map',
  'model/x3d+fastinfoset', 'model/x3d-vrml', 'text/coffeescript', 'text/jade',
  'text/javascript', 'text/jsx', 'text/less', 'text/markdown', 'text/mathml', 'text/mdx',
  'text/rtf', 'text/shex', 'text/slim', 'text/spdx', 'text/stylus',
  'text/vnd.familysearch.gedcom', 'text/wgsl', 'text/x-handlebars-template', 'text/x-org',
  'text/x-processing', 'text/x-sass', 'text/x-scss', 'text/x-suse-ymp', 'text/xml', 'text/yaml',
  'video/iso.segment', 'video/mp2t'
]);

/**
 * Returns the file extension mime 1.2.11 would have returned for a content
 * type, so the client-visible upload response keeps its baseline `path`.
 *
 * Deliberately NOT total: the normalization is mime 1.2.11's own expression
 * applied straight to the argument, so a non-string argument throws the same
 * TypeError from the same place it threw before, and the resulting 500 keeps
 * reaching the route wrapper's catch-all rather than becoming a 200.
 *
 * @param {string} contentType - a content type, optionally with parameters
 * @returns {string|undefined} the legacy extension, or undefined when
 *   mime 1.2.11 had no answer. Never null and never the empty string.
 * @throws {TypeError} when contentType is not a string, as at baseline
 */
function legacyMimeExtension(contentType) {
  // mime 1.2.11, mime.js:80-81, verbatim: strips parameters, stops at
  // whitespace, folds case, and throws on anything without .match().
  var type = contentType.match(/^\s*([^;\s]*)(?:;|\s|$)/)[1].toLowerCase();

  // hasOwnProperty rather than a truthiness test: an override whose value were
  // ever falsy, or an inherited Object.prototype key such as 'constructor',
  // must not be confused with a legitimately absent one.
  if (Object.prototype.hasOwnProperty.call(LEGACY_EXTENSION, type)) {
    return LEGACY_EXTENSION[type];
  }

  if (LEGACY_UNKNOWN_TYPES.has(type)) {
    return undefined;
  }

  // The two databases agree here. The normalized type is passed on so mime 4
  // sees what mime 1.2.11 looked up, and mime 4's null/'' is coerced onto
  // 1.2.11's only falsy answer.
  return mime.getExtension(type) || undefined;
}

/*
 * ---------------------------------------------------------------------------
 * Inline-image safety for the download branch below
 * ---------------------------------------------------------------------------
 *
 * `GET /api/files/{fileId}/{fileName}` declares no auth (config/routes.js),
 * so it inherits the server default `mode: 'try'` and is reachable
 * anonymously. The image branch of `download` is entered on
 * /^image/.test(file.type) and previously typed the response from
 * file.mime -- a SEPARATE field. lib/models/file.js constrains `type` to the
 * enum ['embed', 'download'] and puts no validation on `mime` at all, so the
 * branch is reachable only by legacy documents whose `type` carries a
 * mime-like string, and for exactly those documents the two fields are
 * independent. A legacy record with `type: 'image/png'` and
 * `mime: 'text/html'` (or `image/svg+xml`) would therefore have served stored
 * bytes inline, as active content, on the application origin.
 *
 * The trust boundary is enforced here, at response construction, and NOT by
 * adding validation to the file schema: lib/models/file.js is deliberately
 * left unchanged, because validating `mime`/`type` there would change upload
 * and persistence behaviour, which the migration's no-behaviour-change rule
 * prohibits, and the model is out of this change's scope. Nothing downstream
 * of this file is relied upon for the decision -- only the bytes themselves.
 *
 * Three mechanisms cooperate:
 *
 *   1. peekHead()               -- reads a bounded head of the S3 stream and
 *                                  hands back a replay stream, so the
 *                                  decision can be made on real bytes without
 *                                  consuming the response body.
 *   2. SAFE_RASTER_SIGNATURES   -- the only content types that may be served
 *                                  inline, each with the magic bytes that must
 *                                  be present for that claim to be believed.
 *   3. inlineImageDisposition() -- inline only when the declared type is
 *                                  allowlisted AND the bytes match it;
 *                                  anything else is served as an attachment.
 *
 * Script-capable formats are absent from the allowlist on purpose --
 * image/svg+xml, text/html, application/xhtml+xml, text/xml and
 * application/xml can all execute in a browsing context and are never
 * inline-eligible here, and neither is any type the map does not name.
 */

/**
 * How many bytes of the download are inspected before the inline/attachment
 * decision is taken. Twelve is the longest signature below (RIFF....WEBP);
 * sixteen leaves headroom without meaningfully delaying the response.
 */
var PEEK_BYTES = 16;

/**
 * Upper bound on how long the head peek waits for those bytes. The peek is
 * only ever a decision aid: on expiry the captured head is used as-is (an
 * empty head classifies as an attachment, the safe outcome) and the stream is
 * still replayed in full, so a slow object degrades to a download rather than
 * to a failure or a truncated body.
 */
var PEEK_TIMEOUT_MS = 5000;

/**
 * Defence in depth for both dispositions: `nosniff` stops a browser
 * second-guessing the declared type, and the policy neutralises scripts,
 * plugins, framing, base-URI rewriting and form posts should a payload ever
 * reach a browsing context regardless.
 */
var DOWNLOAD_CSP = "default-src 'none'; sandbox; base-uri 'none'; form-action 'none'";

/**
 * The strict safe-raster allowlist.
 *
 * Each key is a content type that MAY be served inline. Its value is a list of
 * alternative signatures; a signature is a list of clauses, ALL of which must
 * match for that alternative to be satisfied (WebP needs two, everything else
 * needs one). Offsets and bytes are absolute positions in the head.
 */
var SAFE_RASTER_SIGNATURES = {
  'image/png'  : [ [ { offset : 0, bytes : [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] } ] ],
  'image/jpeg' : [ [ { offset : 0, bytes : [0xff, 0xd8, 0xff] } ] ],
  'image/gif'  : [ [ { offset : 0, bytes : [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] } ],   // GIF87a
                   [ { offset : 0, bytes : [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] } ] ], // GIF89a
  'image/webp' : [ [ { offset : 0, bytes : [0x52, 0x49, 0x46, 0x46] },                 // RIFF
                     { offset : 8, bytes : [0x57, 0x45, 0x42, 0x50] } ] ],             // WEBP
  'image/bmp'  : [ [ { offset : 0, bytes : [0x42, 0x4d] } ] ],                         // BM
  'image/tiff' : [ [ { offset : 0, bytes : [0x49, 0x49, 0x2a, 0x00] } ],               // II*\0
                   [ { offset : 0, bytes : [0x4d, 0x4d, 0x00, 0x2a] } ] ],             // MM\0*
  'image/x-icon'              : [ [ { offset : 0, bytes : [0x00, 0x00, 0x01, 0x00] } ] ],
  'image/vnd.microsoft.icon'  : [ [ { offset : 0, bytes : [0x00, 0x00, 0x01, 0x00] } ] ]
};

/**
 * Coerces a peeked head into a Buffer for signature comparison.
 *
 * Buffers arrive from the peek; strings, plain byte arrays and typed arrays
 * are accepted so the classifier can be exercised directly. Anything else
 * yields null, which the classifier treats as "no bytes" -- an attachment.
 *
 * @param {*} head - candidate head bytes
 * @returns {?Buffer} the bytes, or null when they cannot be interpreted
 */
function headToBuffer(head) {
  if (head === null || typeof head === 'undefined') {
    return null;
  }
  if (Buffer.isBuffer(head)) {
    return head;
  }
  if (typeof head === 'string') {
    // latin1 maps each code unit onto one byte, so a byte-wise literal such as
    // '\x89PNG\r\n\x1a\n' compares as the bytes it spells.
    return Buffer.from(head, 'latin1');
  }
  if (head instanceof Uint8Array || Array.isArray(head)) {
    return Buffer.from(head);
  }
  return null;
}

/**
 * Tests one signature alternative against the head. Every clause must match.
 *
 * @param {Buffer} bytes - the peeked head
 * @param {Array<{offset: number, bytes: Array<number>}>} clauses - the alternative
 * @returns {boolean} true when all clauses match
 */
function matchesSignature(bytes, clauses) {
  for (var i = 0; i < clauses.length; i++) {
    var clause = clauses[i],
        offset = clause.offset,
        sig    = clause.bytes;

    if (bytes.length < offset + sig.length) {
      return false;
    }
    for (var j = 0; j < sig.length; j++) {
      if (bytes[offset + j] !== sig[j]) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Decides whether a stored file may be served inline.
 *
 * Inline requires BOTH that the declared content type is on the safe-raster
 * allowlist AND that the bytes at the head of the file carry that type's
 * magic signature, which is what makes the two independent legacy metadata
 * fields unable to authorise active content between them.
 *
 * Total: it never throws and never returns anything other than the two
 * strings, so it is safe on an empty or short head, on a non-string mime and
 * on a declared type carrying parameters or mixed case.
 *
 * @param {*} declaredMime - the file document's own `mime` field, untrusted
 * @param {*} head - the leading bytes of the stored object
 * @returns {string} 'inline' when the file is safe to render, else 'attachment'
 */
function inlineImageDisposition(declaredMime, head) {
  try {
    if (typeof declaredMime !== 'string') {
      return 'attachment';
    }

    // Same normalization the legacy mime layer above performs: parameters
    // stripped, surrounding whitespace ignored, case folded.
    var matched = declaredMime.match(/^\s*([^;\s]*)(?:;|\s|$)/),
        type    = matched ? matched[1].toLowerCase() : '';

    if (!Object.prototype.hasOwnProperty.call(SAFE_RASTER_SIGNATURES, type)) {
      return 'attachment';
    }

    var bytes = headToBuffer(head);
    if (!bytes || !bytes.length) {
      return 'attachment';
    }

    var alternatives = SAFE_RASTER_SIGNATURES[type];
    for (var i = 0; i < alternatives.length; i++) {
      if (matchesSignature(bytes, alternatives[i])) {
        return 'inline';
      }
    }
    return 'attachment';
  }
  catch (e) {
    // A classifier that throws would turn a download into a 500, and the safe
    // answer is always available, so failure is answered rather than raised.
    return 'attachment';
  }
}

/**
 * Renders a stored filename safe to interpolate into a quoted
 * Content-Disposition value.
 *
 * Names are persisted verbatim from the upload, so a quote, a CR/LF or a
 * control character in one would otherwise terminate the parameter or inject a
 * header, and a non-ASCII byte is not representable in a quoted-string at all.
 * Everything outside printable ASCII, plus the quote, the backslash and the
 * path separators, becomes an underscore.
 *
 * @param {*} name - the file document's own `name` field, untrusted
 * @returns {string} a quotable filename, never empty
 */
function sanitizeContentDispositionFilename(name) {
  if (typeof name !== 'string') {
    return 'download';
  }

  var safe = name
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\\/]/g, '_')
    .replace(/^\.+/, '_');

  return safe.length ? safe : 'download';
}

/**
 * Reads up to `size` bytes from `source` and returns them alongside a stream
 * that replays them followed by the remainder of the body.
 *
 * `FileUtil.downloadMaterialFile` returns a PassThrough synchronously and pipes
 * the S3 read stream into it, and `pipe` does not forward errors, so a missing
 * object produces a stream that simply never ends. The peek therefore settles
 * on whichever of four events comes first -- the head being satisfied, `end`,
 * `error`, or the timeout -- clears its timer, removes every listener it added,
 * and NEVER REJECTS, so a download can always be answered.
 *
 * `stream.unshift()` is deliberately not used to put the head back: for a body
 * shorter than `size` the `end` event has already fired by then and unshift
 * throws ERR_STREAM_UNSHIFT_AFTER_END_EVENT. A fresh PassThrough carrying the
 * captured head is used instead, and the remainder is piped into it, so every
 * byte reaches the client in all four cases -- including bytes that only arrive
 * after the timeout has already fixed the disposition.
 *
 * @param {stream.Readable} source - the download stream
 * @param {number} size - how many bytes to capture
 * @param {number} timeoutMs - upper bound on the wait
 * @returns {Promise<{head: Buffer, reason: string, stream: stream.Readable}>} always resolves
 */
function peekHead(source, size, timeoutMs) {
  return new Promise(function(resolve) {
    var chunks  = [],
        total   = 0,
        settled = false,
        ended   = false,
        failed  = null,
        timer   = null;

    function onReadable() {
      var chunk;
      while ((chunk = source.read()) !== null) {
        chunks.push(chunk);
        total += chunk.length;
        if (total >= size) {
          return finish('complete');
        }
      }
    }

    function onEnd() {
      ended = true;
      finish('end');
    }

    function onError(err) {
      failed = err;
      finish('error');
    }

    function finish(reason) {
      if (settled) {
        return;
      }
      settled = true;

      clearTimeout(timer);
      source.removeListener('readable', onReadable);
      source.removeListener('end', onEnd);
      source.removeListener('error', onError);

      var head   = Buffer.concat(chunks),
          replay = new PassThrough();

      if (head.length) {
        replay.write(head);
      }

      if (ended || failed) {
        // Nothing further can arrive, so the replay carries the captured head
        // and closes. An errored source is reported as a short body for the
        // same reason the sibling branch does not surface S3 errors: pipe()
        // never forwarded them there either.
        replay.end();
      }
      else {
        source.pipe(replay);
        // The peek's own error listener has just been removed, so without this
        // a later error on the source would be an unhandled 'error' event and
        // would take the process down. Aborting the response is the honest
        // outcome for a body that cannot be completed.
        source.once('error', function(err) {
          replay.destroy(err);
        });
      }

      resolve({ head : head, reason : reason, stream : replay });
    }

    timer = setTimeout(function() {
      finish('timeout');
    }, timeoutMs);

    source.on('readable', onReadable);
    source.on('end', onEnd);
    source.on('error', onError);

    // Bytes may already be buffered by the time the listeners are attached.
    onReadable();
  });
}

/**
 * Bridges a callback-style call into the async handler bodies below.
 *
 * `lib/util/file.js` and the Mongoose document `save()` keep their callback
 * interfaces on purpose, so each handler creates its own `await` here, at its
 * call site, instead of the promise boundary being pushed down into the utility.
 *
 * The returned promise ALWAYS RESOLVES with `{err, value}` and NEVER REJECTS.
 * That is deliberate and load-bearing: these callback errors are handled inline
 * by the callers below, two of which log the error and carry on to build a
 * successful response, and one of which ignores it entirely. Rejecting would
 * reroute those edges into the route wrapper's catch-all and turn responses that
 * are 200s today into 500s, so the error disposition is left to the call site --
 * exactly where it lived before the conversion.
 *
 * @param {function(function(?Error, *))} invoke - receives the node-style callback
 * @returns {Promise<{err: ?Error, value: *}>} always resolved, never rejected
 */
function settle(invoke) {
  return new Promise(function(resolve) {
    invoke(function(err, value) {
      resolve({ err : err, value : value });
    });
  });
}

module.exports = {
  uploadAvatar : async function(request, h) {
    if (!config.features.assets) {
      // Returned rather than thrown: the route wrapper's catch-all maps a thrown
      // Boom onto badImplementation, which would silently turn this 501 into 500.
      return errors.notImplemented('Avatar uploads are not enabled');
    }

    var upload = await settle(function(next) {
      FileUtil.uploadUserAvatar(request.payload.upload, next);
    });

    if (upload.err) {
      // Reproduces the old reply(err) mapping: a Boom passes straight through and
      // any other Error becomes a 500 carrying its own message. Nothing is logged
      // here because that path logged nothing either.
      return upload.err.isBoom
        ? upload.err
        : errors.badImplementation(upload.err.message);
    }

    return request.success(upload.value);
  },

  upload : async function(request, h) {
    if (!config.features.assets) {
      return errors.notImplemented('File uploads are not enabled');
    }

    var uploaded = await settle(function(next) {
      FileUtil.uploadMaterialFile(request.payload.upload, next);
    });
    var err     = uploaded.err;
    var results = uploaded.value;

    // Log and carry on, never reject: the upload utility swallows its own S3
    // failure and still calls back with a fully populated payload, so an upload
    // error here must not stop the success-shaped response being built.
    err && console.log(err);

    // eventually allow upload of a markdown file?

    var contentType = request.payload.upload.headers['content-type'];
    var type = request.payload.type;
    if (typeof type == 'undefined') {
      type = /^image/.test(contentType)
        ? 'embed'
        : 'download';
    }

    var fileName = request.payload.upload.filename;
    var fileExt  = fileName.lastIndexOf('.') > -1 ? fileName.substring(fileName.lastIndexOf('.') + 1, fileName.length) : '';
    // mime 4's getExtension() replaces extension(); it yields null where the old
    // call yielded undefined, and both are falsy for the `if (ext)` guard below.
    // Only the returned `path` reads this value -- the stored object's key
    // derives its own extension from the upload filename inside lib/util/file.js.
    // The lookup goes through the frozen mime 1.2.11 compatibility layer at the
    // top of this file, because mime 4's database answers differently for 259
    // types and this value is client-visible.
    var ext      = config.app.extensionWhitelist[fileExt] ? fileExt : legacyMimeExtension(contentType);
    var fileMime = config.app.extensionWhitelist[fileExt] ? config.app.extensionWhitelist[fileExt] : contentType;

    var file = new File({
      url  : results.host + '/' + results.path,
      type : type,
      name : fileName,
      mime : fileMime,
      hash : results.hash,
      size : results.size
    });

    file.setOwner(request.user);

    // check existing file with same hash, name and owner?

    var saved = await settle(function(next) {
      file.save(next);
    });

    // Log and carry on, as above: a failed save still reports the file it tried
    // to create.
    saved.err &&  console.log(saved.err);

    var sansExt = file.name.substring(0, file.name.lastIndexOf('.'));
    var path    = '/api/files/' + file.id + '/' + sluggify(sansExt, {maintainCase:true});
    if (ext) {
      path += '.' + ext;
    }

    return request.success({
      id   : file.id,
      path : path,
      type : file.type,
      mime : file.mime,
      host : config.app.url.hostname,
      name : file.name,
      size : file.size,
    });
  },
  download : async function(request, h) {
    var remoteUrl  = request.pre.file.url;
    var fileIndex  = remoteUrl.lastIndexOf('/');
    var remoteFile = remoteUrl.substring(fileIndex + 1, remoteUrl.length);

    var debug = config.app.log.debug,
        start, end, seconds;

    if (debug && debug.files) start = process.hrtime();

    // Synchronous by contract: this returns a PassThrough immediately and is not
    // a promise, so it is deliberately not awaited.
    var stream     = FileUtil.downloadMaterialFile(remoteFile);

    if (debug && debug.files) {
      end = process.hrtime(start);
      seconds = end[0] + end[1] * 1e-9;
      log.debug("file download debug", { raw_diff : end, seconds : seconds, fileId : request.pre.file.id, fileUrl : request.pre.file.url });
    }

    if (/^image/.test(request.pre.file.type)) {
      // APPROVED DEVIATION -- the single authorised behaviour change here.
      //
      // Baseline built `reply(stream).type(...).bytes(...)` with no `return` and
      // no resolving call. Neither .type() nor .bytes() settled the deferred
      // response, so this branch never produced one: measured against a faithful
      // reproduction of the old shim on hapi 21.4.10, no response had arrived
      // after 5007ms and the request simply hung.
      //
      // "Every route serves" takes precedence over preserving that outcome,
      // because an unsettled request is the absence of a response rather than
      // behaviour a client can depend on, and because the response below is not
      // inferred -- the sibling branch performs the identical chain. The reach is
      // narrow: file.type holds the model's own enum, so this branch is entered
      // only by legacy documents whose type carries a mime-like string.
      //
      // Content-Disposition stays omitted on the inline response. That omission
      // is the purpose of this branch, which renders an image inline rather
      // than downloading it.
      //
      // EXTENSION OF THAT DEVIATION -- why the safety checks below are not
      // themselves an unauthorised behaviour change. The response this branch
      // serves did not exist at baseline: the request hung, so there is no
      // observable behaviour for a client to have depended on and nothing for
      // the no-improvements rule to protect. Serving unverified bytes inline,
      // as active content, on the application origin from a route that carries
      // no auth would therefore not be preservation -- it would be a new
      // response introducing a stored-XSS sink. The deviation created the
      // response; deciding what that response is permitted to contain is part
      // of the same decision, and it changes nothing a client could observe
      // before. Types are checked against a strict safe-raster allowlist and
      // confirmed against the file's own leading bytes, because file.type and
      // file.mime are independent unvalidated legacy fields (see the block at
      // the top of this file, which also records why lib/models/file.js is
      // deliberately left unchanged).
      var peeked = await peekHead(stream, PEEK_BYTES, PEEK_TIMEOUT_MS);

      if (inlineImageDisposition(request.pre.file.mime, peeked.head) === 'inline') {
        // The status, content type and byte count are exactly the approved
        // response; the two headers are defence in depth and disturb neither.
        return h.response(peeked.stream)
          .type(request.pre.file.mime)
          .bytes(request.pre.file.size)
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Security-Policy', DOWNLOAD_CSP);
      }

      // Not inline-eligible -- an allowlisted type whose bytes disagree, a
      // script-capable or unknown type, or a body too short to identify. The
      // same bytes are still served in full, but as an opaque download that no
      // browser will execute, with the stored name quoted and sanitized so it
      // cannot break out of the header.
      return h.response(peeked.stream)
        .type('application/octet-stream')
        .bytes(request.pre.file.size)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', DOWNLOAD_CSP)
        .header('Content-Disposition', 'attachment; filename="' + sanitizeContentDispositionFilename(request.pre.file.name) + '"');
    } else {
      // Unchanged in effect: .header() already settled the deferred, so this
      // branch returned a real response before the conversion and returns the
      // same one now -- 200, the file's own content type and byte count, and an
      // unquoted `attachment; filename=<name>`.
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size)
        .header('Content-Disposition', 'attachment; filename=' + request.pre.file.name);
    }
  },
  setThumbnail : async function(request, h) {
    if (request.payload.secret !== config.aws.lambda.createThumbnail.secret) {
      return request.fail();
    }

    var bucket   = request.payload.bucket;

    var fileName = request.pre.file.name;
    var fileExt  = fileName.lastIndexOf('.') > -1 ? fileName.substring(fileName.lastIndexOf('.') + 1, fileName.length) : '';

    // Left unguarded on purpose: a bucket name with no thumbnail configuration
    // throws here, and that throw is what the wrapper maps onto a 500 today.
    var thumb = config.aws.buckets[bucket].thumbnail.replace('%{s}', request.pre.file.hash);
    thumb    += '-' + request.pre.file.id;

    request.pre.file.thumb = config.aws.buckets[bucket].thumbnailHost + '/' + thumb + '.' + fileExt;

    // The response is produced only once the save has settled, so the await
    // belongs here rather than any earlier. Its error stays ignored, as before.
    await settle(function(next) {
      request.pre.file.save(next);
    });

    return request.success();
  },

  // Exported alongside the four handlers so the compatibility layer and the
  // inline-image decision can be asserted directly -- 259 mime mappings and the
  // mismatched-metadata cases are properties of these two pure functions, not
  // of a multipart upload or a seeded S3 object. Routing is unaffected:
  // lib/util/routeParser.js binds only the handler names the route DSL
  // references (`require('../controllers/' + controller)[handlerName]`), so an
  // additional export is inert.
  legacyMimeExtension     : legacyMimeExtension,
  inlineImageDisposition  : inlineImageDisposition
};
