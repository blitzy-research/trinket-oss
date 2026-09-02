var FileUtil = require('../util/file'),
    errors   = require('@hapi/boom'),
    fs       = require('fs'),
    config   = require('config'),
    // mime 4.x ships as ESM only, so Node's require() hands back the module
    // namespace rather than the Mime instance; the instance is on `.default`.
    // `lookup`/`extension` became `getType`/`getExtension` in the same major.
    mime     = require('mime').default,
    sluggify = require('limax');

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
    // getExtension() replaces extension(); it yields null where the old call
    // yielded undefined, and both are falsy for the `if (ext)` guard below. Only
    // the returned `path` reads this value -- the stored object's key derives its
    // own extension from the upload filename inside lib/util/file.js.
    var ext      = config.app.extensionWhitelist[fileExt] ? fileExt : mime.getExtension(contentType);
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
      // Content-Disposition stays omitted. That omission is the purpose of this
      // branch, which renders an image inline rather than downloading it.
      return h.response(stream)
        .type(request.pre.file.mime)
        .bytes(request.pre.file.size);
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
  }
};
