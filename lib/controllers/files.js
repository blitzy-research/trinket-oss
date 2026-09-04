var FileUtil = require('../util/file'),
    errors   = require('@hapi/boom'),
    fs       = require('fs'),
    config   = require('config'),
    // mime 4.x is ESM only ("type": "module"), so require() hands back the
    // module namespace rather than the Mime instance; the instance, which
    // carries getType()/getExtension(), is on `.default`.
    mime     = require('mime').default,
    sluggify = require('limax');

/*
 * MIME -> extension compatibility layer, fixed to the mime 1.2.11 answer set
 *
 * `upload` below appends an extension to the `path` it returns to the client,
 * and material-editor code inserts that path into Markdown, so the extension
 * is part of a client-visible response contract. That contract is fixed to the
 * mime 1.2.11 extension set; the installed mime 4.x database disagrees with it
 * for 259 content types, so the extension in the response is resolved through
 * the tables below rather than straight out of `mime.getExtension()`. Every
 * other consumer of `mime` in the application uses it directly.
 *
 * The layer is reachable for essentially every upload: config/default.yaml
 * declares exactly one `extensionWhitelist` entry (`ipynb`), so every other
 * content type falls through to the lookup below.
 *
 * Two tables, one per kind of disagreement:
 *
 *   - LEGACY_EXTENSION      13 types both databases answer for and answer
 *                           differently: image/jpeg is `jpeg` here against
 *                           mime 4.x's `jpg`, and application/x-font-ttf is
 *                           `ttf` here where mime 4.x has no answer at all.
 *   - LEGACY_UNKNOWN_TYPES  246 types the fixed answer set does not know. The
 *                           lookup returns `undefined` for these, so the
 *                           `if (ext)` guard in `upload` appends nothing,
 *                           where mime 4.x answers and the path would gain an
 *                           extension (text/markdown gaining `.md`).
 *
 * Two further disagreements are algorithmic rather than tabular, which is why
 * the normalization below is the exact 1.2.11 expression rather than a tidied
 * equivalent:
 *
 *   - a NON-STRING contentType has no `.match()`, so the expression throws a
 *     TypeError straight out of the calling handler and the route catch-all
 *     answers 500. The match is therefore applied directly to the argument,
 *     which is what keeps that edge on the 500 funnel instead of answering
 *     200 with no extension the way `mime.getExtension(null)` would.
 *   - the expression stops at whitespace as well as at `;`, so
 *     'image/png foo' resolves to 'png'. The normalized type is what gets
 *     delegated, so that rule holds for the agreeing types too.
 *
 * Parameter stripping and case folding agree between the two databases and are
 * deliberately not special-cased. The falsy sentinel does not agree
 * (`undefined` here against mime 4.x's `null`/`''`), and the coercion below
 * settles every answer on `undefined`.
 *
 * SCOPE: this governs the client-visible response `path` only. Stored object
 * keys derive their own extension from the upload filename inside
 * lib/util/file.js and must keep doing so -- the key is a content hash, so
 * moving the extension onto it would silently orphan every stored object.
 *
 * The tables are correct for one pair of databases: the mime 1.2.11 extension
 * set and the mime 4.x database this project installs. If `mime` is bumped,
 * re-derive them (run from the repository root, after
 * `npm pack mime@1.2.11 && tar -xzf mime-1.2.11.tgz`, which unpacks 1.2.11
 * into ./package):
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
 * The two lists it prints replace the two below. Store the names in lower
 * case: the lookup below is keyed on the normalized type, and mime 1.2.11's
 * own database holds one mixed-case key ('video/MP2T') whose two spellings
 * must both resolve through the same entry.
 */

/**
 * The 13 types both databases answer for and answer differently. The value on
 * each line is the answer the response contract requires; the trailing comment
 * is what the installed mime 4.x answers instead.
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
 * The 246 types the fixed answer set has no entry for, so `legacyMimeExtension`
 * answers `undefined` for them and `upload` appends no extension. A Set built
 * once at load keeps the lookup constant time per upload rather than a scan.
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
 * Resolves a content type to the extension the client-visible upload `path` is
 * contracted to carry, which is the mime 1.2.11 answer rather than the
 * installed mime 4.x one.
 *
 * Deliberately NOT total: the normalization is applied straight to the
 * argument, so a non-string content type throws a TypeError out of the calling
 * handler and the route catch-all answers 500 rather than 200 with no
 * extension.
 *
 * @param {string} contentType - a content type, optionally with parameters
 * @returns {string|undefined} the extension, or undefined when the fixed
 *   answer set has none. Never null and never the empty string.
 * @throws {TypeError} when contentType is not a string
 */
function legacyMimeExtension(contentType) {
  // The mime 1.2.11 normalization, verbatim: strips parameters, stops at the
  // first whitespace as well as at `;`, folds case, and throws on any argument
  // that has no .match() method.
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

  // The two databases agree on this type. The NORMALIZED type is delegated, so
  // the parameter, whitespace and case rules above apply here too, and mime
  // 4.x's `null`/`''` is coerced onto the single `undefined` sentinel this
  // function promises.
  return mime.getExtension(type) || undefined;
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
 * reroute those edges into the route catch-all and turn 200s into 500s, so the
 * error disposition belongs to the call site.
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
      // Returned rather than thrown: the route catch-all maps a thrown Boom onto
      // badImplementation, which would silently turn this 501 into a 500.
      return errors.notImplemented('Avatar uploads are not enabled');
    }

    var upload = await settle(function(next) {
      FileUtil.uploadUserAvatar(request.payload.upload, next);
    });

    if (upload.err) {
      // A Boom is returned as-is so its own status is served; any other Error
      // becomes a 500 carrying its own message. Neither is logged here, and
      // returning rather than throwing keeps the route catch-all out of it.
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
    // Resolved through `legacyMimeExtension` rather than `mime.getExtension()`
    // because it reaches the client in `path` below, where it is contracted to
    // the mime 1.2.11 answer set. Only `path` reads it -- the stored object's
    // key derives its own extension from the upload filename inside
    // lib/util/file.js.
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

    // Log and carry on: a failed save still answers with the file it tried to
    // create.
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
      // APPROVED DEVIATION -- the single authorised behaviour change in this
      // file, decided in AAP 0.7 and recorded in docs/preserved-quirks.md 11.1.
      // Its whole content is the three-call expression below, and this comment
      // records that decision rather than making one: no further policy is
      // authorised here, and none is applied.
      //
      // Baseline built `reply(stream).type(...).bytes(...)` with no `return` and
      // no resolving call. Neither .type() nor .bytes() settled the deferred
      // response, so this branch never produced one: the request was left
      // unsettled, and the client waited for a response that never came rather
      // than being answered or refused.
      //
      // "Every route serves" takes precedence over preserving that outcome,
      // because an unsettled request is the absence of a response rather than
      // behaviour a client can depend on, and because the response below is not
      // inferred -- the sibling branch four lines down performs the identical
      // chain and returns a working response. The reach is narrow: file.type
      // holds the model's own enum, so this branch is entered only by legacy
      // documents whose type carries a mime-like string.
      //
      // The approved response is exactly five fields: 200, the file document's
      // own mime, the file document's own byte size, no Content-Disposition, and
      // an outcome that changes from an expected timeout to an answered request.
      // Content-Disposition stays omitted because that omission is the purpose of
      // this branch, which renders an image inline rather than downloading it.
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size);
    } else {
      // The attachment response for everything that is not an image: 200, the
      // file's own content type and byte count, and an UNQUOTED
      // `attachment; filename=<name>` carrying the stored name verbatim.
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
    // throws here, and the route catch-all answers 500 for it.
    var thumb = config.aws.buckets[bucket].thumbnail.replace('%{s}', request.pre.file.hash);
    thumb    += '-' + request.pre.file.id;

    request.pre.file.thumb = config.aws.buckets[bucket].thumbnailHost + '/' + thumb + '.' + fileExt;

    // The response is produced only once the save has settled, so the await
    // belongs here rather than any earlier. Its error is intentionally ignored.
    await settle(function(next) {
      request.pre.file.save(next);
    });

    return request.success();
  },

  // Exported alongside the four handlers so the frozen mime compatibility layer
  // can be asserted directly: its 259 mappings are a property of one pure
  // function rather than of a multipart upload, and the client-visible response
  // `path` those mappings feed is what AAP 0.9.6's mime call-site parity gate
  // measures. Routing is unaffected -- lib/util/routeParser.js binds only the
  // handler names the route DSL references
  // (`require('../controllers/' + controller)[handlerName]`), so an additional
  // export is inert.
  legacyMimeExtension : legacyMimeExtension
};
