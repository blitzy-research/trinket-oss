var FileUtil = require('../util/file'),
    errors   = require('@hapi/boom'),
    fs       = require('fs'),
    config   = require('config'),
    mime     = require('mime'),
    sluggify = require('limax');

module.exports = {
  uploadAvatar : async function(request, h) {
    if (!config.features.assets) {
      // Returned rather than thrown, which is load bearing: the route parser's single catch-all
      // maps every thrown value through lib/http/errorMap.js to badImplementation, so throwing
      // would turn this 501 into a 500. hapi sends a 501's message to the client unscrubbed, so
      // the text stays byte-identical.
      return errors.notImplemented('Avatar uploads are not enabled');
    }

    // lib/util/file.js#uploadUserAvatar resolves `{ err, results }` on both outcomes rather than
    // rejecting, so the branch below decides what the route answers instead of a rejection escaping
    // to the centralized error map.
    var avatarUpload = await FileUtil.uploadUserAvatar(request.payload.upload);

    if (avatarUpload.err) {
      // Returned rather than thrown: hapi honors a returned Boom's own status and boomifies a
      // plain Error into a scrubbed 500, whereas throwing would route every status through the
      // centralized error map as a 500.
      return avatarUpload.err;
    }

    // The response IS the return value now: the route parser no longer rescues a handler
    // that resolved undefined from a deferred capture, so this call must be returned.
    // POST /file/avatar declares reply : { host : true, path : true }
    // (config/routes.js:L353), so the responder projects those two fields out of the
    // upload result.
    return h.respond(avatarUpload.results);
  },

  upload : async function(request, h) {
    if (!config.features.assets) {
      // The same 501 as uploadAvatar, returned rather than thrown for the same reason.
      return errors.notImplemented('File uploads are not enabled');
    }

    // Resolving on both outcomes is required here: lib/util/file.js#_fileToContainer reports the
    // temporary-file removal failure as `{ err, results }` with BOTH populated, so `results` is
    // present even when `err` is set and the body below reads it unconditionally. A rejecting
    // contract would discard the result object and turn the swallow below into a TypeError - a 500
    // where this route answers 200.
    var materialUpload = await FileUtil.uploadMaterialFile(request.payload.upload);

    var err     = materialUpload.err,
        results = materialUpload.results;

    // The upload error is logged and then swallowed, and execution continues to the success
    // path, so a failed write answers the same 200 and the same payload as a successful one.
    // Do not rethrow, early return, or change the status.
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
    var ext      = config.app.extensionWhitelist[fileExt] ? fileExt : mime.extension(contentType);
    var fileMime = config.app.extensionWhitelist[fileExt] ? config.app.extensionWhitelist[fileExt] : contentType;

    // `File` is one of the nine implicit globals app.js assigns, so it is used here without
    // being required. Those assignments are bare and undeclared, which is legal only in sloppy
    // mode, so this module stays CommonJS and adds no require.
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

    // The rejection is caught rather than propagated: propagating it would route this request
    // to the centralized error map as a 500, where this route logs it and still answers 200.
    try {
      await file.save();
    }
    catch (err) {
      // The second swallow: a save error is logged and then ignored, so the payload below is
      // built from the in-memory document and answered regardless. The redundant `err &&` guard
      // is kept verbatim, and this binding deliberately shadows the upload `err` above.
      err &&  console.log(err);
    }

    var sansExt = file.name.substring(0, file.name.lastIndexOf('.'));
    var path    = '/api/files/' + file.id + '/' + sluggify(sansExt, {maintainCase:true});
    if (ext) {
      path += '.' + ext;
    }

    // The response IS the return value now - see uploadAvatar. POST /file declares no
    // reply projection, so the responder serializes this object as it stands, trailing
    // comma and all.
    return h.respond({
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

    // NOT awaited, and it must never be: lib/util/file.js#downloadMaterialFile returns a
    // PassThrough synchronously and pipes the S3 body into it once the request resolves, so
    // awaiting would hand h.response() a Promise instead of a stream.
    var stream     = FileUtil.downloadMaterialFile(remoteFile);

    if (debug && debug.files) {
      end = process.hrtime(start);
      seconds = end[0] + end[1] * 1e-9;
      log.debug("file download debug", { raw_diff : end, seconds : seconds, fileId : request.pre.file.id, fileUrl : request.pre.file.url });
    }

    if (/^image/.test(request.pre.file.type)) {
      // This branch is unreachable: lib/models/file.js declares `type` as the enum
      // ['embed', 'download'], so file.type never begins with 'image' and an uploaded GIF
      // arrives here as 'embed'. It is kept verbatim, two-call chain included - adding .header()
      // would change code whose behavior is to be unreachable.
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size);
    } else {
      // The live branch, and the one test/lib/api/files.js asserts: 200 with the file's own
      // content type and 'attachment; filename=<name>'.
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size)
        .header('Content-Disposition', 'attachment; filename=' + request.pre.file.name);
    }
  },
  setThumbnail : async function(request, h) {
    if (request.payload.secret !== config.aws.lambda.createThumbnail.secret) {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The no-argument failure responder,
      // and the live in-repo proof that a failure NEVER sets a status: with no arguments
      // lib/http/responseContract.js#reject skips its log line, skips the HTML redirect
      // branch, substitutes an empty payload and answers h.response({ flash : ... }) - so a
      // wrong thumbnail secret is met with HTTP 200, not 401 or 403. Do not add .code(),
      // do not return a Boom, do not pass an argument to make the log line fire.
      return h.reject();
    }

    var bucket   = request.payload.bucket;

    var fileName = request.pre.file.name;
    var fileExt  = fileName.lastIndexOf('.') > -1 ? fileName.substring(fileName.lastIndexOf('.') + 1, fileName.length) : '';

    var thumb = config.aws.buckets[bucket].thumbnail.replace('%{s}', request.pre.file.hash);
    thumb    += '-' + request.pre.file.id;

    request.pre.file.thumb = config.aws.buckets[bucket].thumbnailHost + '/' + thumb + '.' + fileExt;

    try {
      await request.pre.file.save();
    }
    catch (saveError) {
      // A rejected thumbnail write is reported to the caller as a success. The error is
      // deliberately neither logged nor surfaced: logging it would add a line this route never
      // wrote, and rethrowing it would turn the 200 into a 500.
    }

    return h.respond();
  }
};
