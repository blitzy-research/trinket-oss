var FileUtil = require('../util/file'),
    errors   = require('@hapi/boom'),
    fs       = require('fs'),
    config   = require('config'),
    mime     = require('mime'),
    sluggify = require('limax');

module.exports = {
  uploadAvatar : async function(request, h) {
    if (!config.features.assets) {
      // Error-mapping preservation (R-5): baseline reached the synthetic reply()'s isBoom
      // branch here, which answered a genuine 501 carrying this exact message. The Boom is
      // RETURNED rather than thrown, and that is load bearing: the route parser's single
      // catch-all maps every THROWN value through lib/http/errorMap.js to
      // Boom.badImplementation, so throwing would turn the measured 501 into a 500.
      // Measured on hapi 21.4.10 over real HTTP. The message is 4xx-class output and
      // therefore client visible, so it stays byte-identical.
      return errors.notImplemented('Avatar uploads are not enabled');
    }

    // Async conversion: the error-first callback is flattened through a local promise
    // wrapper - the idiom lib/controllers/admin.js already uses, so no new require enters
    // this file. The wrapper RESOLVES on both outcomes instead of rejecting, so that the
    // branch below still decides what the route answers rather than a rejection escaping
    // to the centralized error map.
    var avatarUpload = await new Promise(function(resolve) {
      FileUtil.uploadUserAvatar(request.payload.upload, function(err, results) {
        resolve({ err : err, results : results });
      });
    });

    if (avatarUpload.err) {
      // Error-mapping preservation (R-5): baseline handed this error straight to the
      // synthetic reply(), which passed a Boom through untouched and wrapped any other
      // Error in Boom.badImplementation. Returning the raw error reproduces BOTH branches
      // - hapi honors a Boom's own status and boomifies a plain Error into the same
      // scrubbed 500 - whereas throwing it would flatten every status to 500.
      return avatarUpload.err;
    }

    // The response IS the return value now: the route parser no longer rescues a handler
    // that resolved undefined from a deferred capture, so this call must be returned.
    // POST /file/avatar declares reply : { host : true, path : true }
    // (config/routes.js:L353), so the responder projects those two fields out of the
    // upload result.
    return request.success(avatarUpload.results);
  },

  upload : async function(request, h) {
    if (!config.features.assets) {
      // Error-mapping preservation (R-5): the same genuine 501 as uploadAvatar, returned
      // rather than thrown for the same reason, with the same byte-identical message.
      return errors.notImplemented('File uploads are not enabled');
    }

    // Async conversion: as in uploadAvatar - except that here resolving on BOTH outcomes
    // is required rather than merely tidy. lib/util/file.js#_fileToContainer calls back as
    // cb(unlinkErr, uploadResult), so `results` is populated even when `err` is set, and
    // the body below reads results.host, .path, .hash and .size unconditionally after
    // logging the error. A rejecting wrapper would discard the result object and turn the
    // swallow below into a TypeError - a 500 where baseline answered 200.
    var materialUpload = await new Promise(function(resolve) {
      FileUtil.uploadMaterialFile(request.payload.upload, function(err, results) {
        resolve({ err : err, results : results });
      });
    });

    var err     = materialUpload.err,
        results = materialUpload.results;

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The upload error is logged and then
    // SWALLOWED, and execution CONTINUES to the success path, so a failed write answers
    // the same 200 with the same payload as a successful one. Do not rethrow, do not early
    // return, do not change the status.
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

    // `File` is one of the nine implicit globals assigned in app.js:L290-L298; it is used
    // here without being required, exactly as at baseline. Those assignments are bare and
    // undeclared, which is legal only in sloppy mode - so no require is added here and this
    // module stays CommonJS.
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

    // Async conversion: doc.save()'s callback becomes its promise form - the form the
    // already-migrated lib/controllers/admin.js uses - so that the success response below
    // is returned from the handler frame instead of from a callback. The rejection is
    // caught rather than propagated: propagating it would route this request to the
    // centralized error map as a 500, where baseline logged it and still answered 200.
    try {
      await file.save();
    }
    catch (err) {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The second swallow. A save error
      // is logged and then IGNORED: the payload below is built from the in-memory document
      // and answered regardless, so a rejected write is indistinguishable from a stored
      // one. The `err &&` guard is redundant inside a catch and is preserved anyway, with
      // its two spaces after the && intact, exactly as at baseline. This binding
      // deliberately shadows the upload `err` above.
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

    // NOT awaited, and it must never be: lib/util/file.js#downloadMaterialFile returns a
    // PassThrough synchronously and pipes the S3 body into it once the request resolves, so
    // awaiting would hand h.response() a Promise instead of a stream. That contract is
    // unchanged by the aws-sdk v2 -> v3 swap.
    var stream     = FileUtil.downloadMaterialFile(remoteFile);

    if (debug && debug.files) {
      end = process.hrtime(start);
      seconds = end[0] + end[1] * 1e-9;
      log.debug("file download debug", { raw_diff : end, seconds : seconds, fileId : request.pre.file.id, fileUrl : request.pre.file.url });
    }

    if (/^image/.test(request.pre.file.type)) {
      // R-6 ADJUDICATION - see docs/PRESERVED-QUIRKS.md. This branch is UNREACHABLE:
      // lib/models/file.js:L6 declares type as enum ['embed', 'download'], so file.type
      // can never begin with 'image' and an uploaded GIF arrives here as 'embed'. Under
      // the retired shim the branch was also the one shape that never resolved the
      // deferred capture - reply().type().bytes() stopped short of a resolving terminator
      // - yet no request ever hung, because no request ever entered it. It is preserved
      // verbatim rather than deleted (R-1 forbids the cleanup) and deliberately keeps its
      // two-call chain: adding .header() to "fix" it would be a behavior change to code
      // whose baseline behavior is to be unreachable. Both branches are otherwise
      // mechanically converted, in the original chain order.
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size);
    } else {
      // The live branch, and the one test/lib/api/files.js:L96-L116 asserts twice: 200
      // with the file's own content type and 'attachment; filename=<name>'.
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
      return request.fail();
    }

    var bucket   = request.payload.bucket;

    var fileName = request.pre.file.name;
    var fileExt  = fileName.lastIndexOf('.') > -1 ? fileName.substring(fileName.lastIndexOf('.') + 1, fileName.length) : '';

    var thumb = config.aws.buckets[bucket].thumbnail.replace('%{s}', request.pre.file.hash);
    thumb    += '-' + request.pre.file.id;

    request.pre.file.thumb = config.aws.buckets[bucket].thumbnailHost + '/' + thumb + '.' + fileExt;

    // Async conversion: the same promise form as upload(), for the same reason - the
    // success response has to be returned from the handler frame rather than from a
    // callback, or hapi 21 raises on a handler that resolved undefined and the route
    // answers 500.
    try {
      await request.pre.file.save();
    }
    catch (saveError) {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Baseline's callback took
      // (err, file), read NEITHER, and answered request.success() regardless, so a rejected
      // thumbnail write is reported to the caller as a success. The error is deliberately
      // neither logged nor surfaced: logging it would add a line baseline never wrote, and
      // rethrowing it would turn the 200 into a 500.
    }

    return request.success();
  }
};
