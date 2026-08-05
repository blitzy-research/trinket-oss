var PassThrough         = require('stream').PassThrough,
    crypto              = require('crypto'),
    config              = require('config'),
    aws                 = require('../../config/aws'),
    fs                  = require('fs');

// Every method below reaches S3 through aws.getS3Client(), which hands back the ONE client this
// process owns rather than building one per operation - each S3Client owns its own socket pool, so
// per-call construction leaks one per request. Nothing in this file destroys it: teardown belongs to
// the application, and app.js releases it on the hapi server's 'stop' event. Per-operation teardown
// would in any case be unimplementable for downloadMaterialFile below, which must return a stream
// SYNCHRONOUSLY and so has no terminal event to attach it to.
//
// RESOURCE OWNERSHIP. Two rules govern every fs-backed upload below, and both exist because a
// ReadStream holds an OPEN FILE DESCRIPTOR from the moment it is constructed:
//
//   1. STAT BEFORE OPEN. The byte length the SDK requires is taken with `await fs.promises.stat(path)`
//      BEFORE the stream is created, so a stat failure cannot leave a descriptor behind, and the
//      request thread is not blocked by a synchronous stat.
//   2. DESTROY ONLY WHAT DID NOT CLOSE, ONLY AFTER A FAILED SEND. A successful send reads the stream to
//      completion and the descriptor is released by the stream itself; a REJECTED send may leave it
//      unconsumed, so each call site destroys its own stream if and only if it is still open. Nothing
//      destroys a stream on a success path, and nothing here changes which error a caller sees.
//
// Neither rule alters a byte on the wire: the bucket, key, content type, declared length and
// Content-Disposition are unchanged, and every `{ err, results }` pair, swallowed upload error and
// unlink-error-wins contract below is as it was. See docs/PRESERVED-QUIRKS.md section 3.42.
function destroyIfOpen(stream) {
  if (stream && !stream.destroyed && !stream.closed && typeof stream.destroy === 'function') {
    stream.destroy();
  }
}

function FileUtil() {
  var self = this;

  this._upload = async function(stream, container, s3, fileinfo) {
    var client = aws.getS3Client();

    var params = {
      Bucket      : container.name,
      Key         : fileinfo.name,
      Body        : stream,
      ContentType : fileinfo.contentType
    };

    // An fs-backed body MUST declare its own byte length: PutObjectCommand cannot compute one from an
    // arbitrary Node stream. `stream` is either an fs.ReadStream - the _fileToContainer, uploadSnapshot
    // and uploadUserAsset paths, each carrying the `path` it reads - or a Buffer from
    // uploadSnapshotFromBuffer, whose `.length` the SDK reads directly, so no length is set for it.
    //
    // The length normally arrives as `fileinfo.contentLength`, taken by the caller BEFORE it opened the
    // stream (rule 1 at the head of this file). The `stream.path` fallback covers a caller that does
    // not pre-measure; its stat failure rejects through the same single channel a failed putObject
    // uses, differing only in naming `stat` rather than `open`.
    if (typeof fileinfo.contentLength === 'number') {
      params.ContentLength = fileinfo.contentLength;
    }
    else if (stream && typeof stream.path === 'string') {
      params.ContentLength = (await fs.promises.stat(stream.path)).size;
    }

    // AWS SDK v3 has no callback form, so send() already returns a promise. Awaiting it inside this
    // async function rather than returning it bare is the same single settle for every caller - all
    // four consume this method as a promise - and it keeps the stat above on the same rejection path.
    return await client.send(new aws.PutObjectCommand(params));
  }

  // Resolves `{ err, results }` rather than rejecting, and BOTH are populated on the failure branch:
  // lib/controllers/files.js#upload reads the result unconditionally after logging the error, so a
  // rejection would discard the result object and turn that swallow into a 500 on a route that answers
  // 200. `err` is the unlink error or null; `results` is the same object on both branches.
  this._fileToContainer = async function(upload, container, s3) {
    var contentType = upload.headers['content-type'];

    var filename  = upload.filename;
    var extension = filename.lastIndexOf('.') > -1 ? filename.substring(filename.lastIndexOf('.') + 1, filename.length) : '';

    if (config.app.extensionWhitelist[extension]) {
      contentType = config.app.extensionWhitelist[extension];
    }

    var digest = await self.hashcontents(upload.path);

    var fileinfo = {
      name        : digest,
      contentType : contentType
    };

    if (container.fileId) {
      fileinfo.name += '-' + container.fileId;
    }
    if (extension) {
      fileinfo.name += '.' + extension;
    }

    // have not been able to find a reliable way to reuse stream from above
    //
    // Rule 1: the length is measured before the descriptor is opened, so a stat failure - which this
    // path cannot actually reach, because hashcontents() has just read the same file - leaves nothing
    // open, and it still lands in the same swallowing catch below that a failed send lands in.
    var uploadStream;

    try {
      fileinfo.contentLength = (await fs.promises.stat(upload.path)).size;
      uploadStream = fs.createReadStream(upload.path);
      await self._upload(uploadStream, container, s3, fileinfo);
    }
    catch (uploadError) {
      // The upload error is logged and then swallowed: the result below still reports success, so
      // a failed S3 write is indistinguishable from a successful one to every caller of
      // uploadMaterialFile and uploadUserAvatar. Propagating it would change the status those
      // routes return.
      uploadError && console.log(uploadError);

      // Rule 2: a rejected send may leave the descriptor unconsumed, and this method goes on to
      // unlink the temporary file it was reading. Destroying it here is what stops a failed avatar or
      // material upload from holding a descriptor on a deleted file for the life of the process.
      destroyIfOpen(uploadStream);
    }

    var uploadResult = {
      host : container.host,
      path : fileinfo.name,
      name : fileinfo.name,
      hash : digest,
      size : upload.bytes
    };

    // remove temporary file
    //
    // The unlink's error becomes the caller's error, so a successful upload followed by a failed
    // temporary-file removal is reported as a failure. Both branches hand back the same result
    // object.
    try {
      await fs.promises.unlink(upload.path);
    }
    catch (unlinkErr) {
      return { err : unlinkErr, results : uploadResult };
    }

    return { err : null, results : uploadResult };
  };

  // returns sha1 digest of files contents
  //
  // There is deliberately NO failure channel: the read stream carries no 'error' listener, so an
  // unreadable file emits on a listener-less emitter and crashes the process rather than surfacing an
  // error to the caller. The returned promise is resolve-only - it never rejects, and on that path it
  // never settles at all - which is what keeps both internal callers (_fileToContainer and
  // uploadUserAsset) behaving as they do.
  this.hashcontents = function(path) {
    return new Promise(function(resolve) {
      var stream = fs.createReadStream(path);
      var hash   = crypto.createHash('sha1');

      hash.setEncoding('hex');

      stream.on('end', function() {
        hash.end();
        resolve(hash.read());
      });

      stream.pipe(hash);
    });
  }

  // Returns a pipeable stream SYNCHRONOUSLY. The SDK has no .createReadStream(), so send() is fired
  // without being awaited and the resolved `response.Body` - already a Node Readable - is piped into
  // the PassThrough once it arrives. This method must NOT become async: its caller in
  // lib/controllers/files.js hands the return value straight to the responder, which needs a stream
  // and not a promise.
  //
  // PRESERVED FAILURE CHANNEL. An S3 failure is emitted on a SOURCE stream that carries no 'error'
  // listener - `pipe()` installs its handler on the destination only - so the emit throws, the process
  // has no 'uncaughtException' handler to catch it, and the returned PassThrough is left pristine, so
  // the response never completes. Calling `stream.destroy(err)` on the RETURNED PassThrough instead
  // would move the failure onto a stream hapi is already listening to and turn that into a tidy HTTP
  // 500, which is not this route's behaviour. See docs/PRESERVED-QUIRKS.md section 3.28.
  //
  // SOCKET LIFECYCLE. The three streams are chained `response.Body -> source -> stream`, and `stream`
  // is what lib/controllers/files.js hands to h.response(). When the client disconnects mid-download
  // hapi destroys `stream` and stops there - pipe() propagates neither close nor destroy upstream - so
  // without the propagation below `response.Body` would keep draining an S3 connection from the ONE
  // shared client's process-wide pool for a response nobody is reading, and repeated aborts would
  // exhaust it.
  //
  // The propagation is one-directional and cancellation-only: it fires ONLY when `stream` closes before
  // it has ended normally, so a completed download destroys nothing and the response bytes, headers
  // and synchronous return are untouched. It must NOT add an 'error' listener to `source`, because that
  // would close the preserved channel above. The no-op 'error' handler goes on `response.Body` alone,
  // on the cancellation path only and immediately before destroying it, so a MID-TRANSFER body error on
  // a live download still reaches the unowned-emit channel while a teardown error on an
  // already-abandoned request cannot invent a new one. `destroy()` without an argument emits 'close',
  // never 'error'.
  this.downloadMaterialFile = function(remote) {
    var stream = new PassThrough;
    var source = new PassThrough;
    var client = aws.getS3Client();
    var body   = null;

    source.pipe(stream);

    stream.on('close', function() {
      // readableEnded is true only once every byte has been read out of `stream`, which is what a
      // completed response does. False here means the client went away first.
      if (stream.readableEnded) {
        return;
      }

      if (body && typeof body.destroy === 'function' && !body.destroyed) {
        body.on('error', function(teardownError) {
          return teardownError;
        });
        body.destroy();
      }

      destroyIfOpen(source);
    });

    client.send(new aws.GetObjectCommand({
      Bucket : config.aws.buckets.materials.name,
      Key    : remote
    })).then(function(response) {
      body = response.Body;

      // The client may already have gone while the S3 round trip was in flight; in that case the
      // 'close' handler above has already run and there is nothing to pipe into.
      if (stream.destroyed && !stream.readableEnded) {
        if (typeof body.destroy === 'function' && !body.destroyed) {
          body.on('error', function(teardownError) {
            return teardownError;
          });
          body.destroy();
        }

        return;
      }

      body.pipe(source);
    }, function(err) {
      source.emit('error', err);
    });

    return stream;
  };

  // Both wrappers resolve the `{ err, results }` pair described on _fileToContainer above.
  this.uploadMaterialFile = function(upload) {
    var container = config.aws.buckets.materials;
    return self._fileToContainer(upload, container, true);
  };

  this.uploadUserAvatar = function(upload) {
    if (!/^image\/(png|jpg|jpeg)$/.test(upload.headers['content-type'])) {
      // The pair carries an undefined `results` on this branch. The message is client-visible -
      // lib/controllers/files.js returns it and hapi boomifies a plain Error - so it stays
      // byte-identical.
      return Promise.resolve({ err : new Error('unsupported image type, must be png or jpg'), results : undefined });
    }
    var container = config.aws.buckets.useravatars;
    return self._fileToContainer(upload, container, true);
  };

  // can be removed once uploadSnapshotFromBuffer has been tested in prod
  this.uploadSnapshot = function(file, cb) {
    // The unconditional one-second delay stays. Removing it would reintroduce whatever race the
    // original author's note below records - intermittently, and only under load.
    // See docs/PRESERVED-QUIRKS.md section 1.5.
    //
    // strange but seems necessary in certain situations...
    setTimeout(async function() {
      var snapshotExists;

      try {
        await fs.promises.access(file.path + file.name);
        snapshotExists = true;
      }
      catch (accessError) {
        snapshotExists = false;
      }

      if (snapshotExists) {
        var snapshotPath = file.path + file.name;
        var fileinfo = {
          name        : file.name,
          contentType : 'image/png'
        };
        var uploadStream;

        // Rule 1: measured, then opened. A stat failure between the access() probe above and this
        // line reaches cb through the same single error argument a failed send uses, and leaves no
        // descriptor behind because none has been opened yet.
        try {
          fileinfo.contentLength = (await fs.promises.stat(snapshotPath)).size;
        }
        catch (statError) {
          return cb(statError);
        }

        uploadStream = fs.createReadStream(snapshotPath);

        // This method keeps its error-first callback - see uploadSnapshotFromBuffer below for why -
        // so the promise _upload now returns is adapted back with a two-argument then(), which
        // cannot invoke cb twice even if cb itself throws.
        self._upload(uploadStream, config.aws.buckets.snapshots, true, fileinfo).then(function(data) {
          cb(null, data);
        }, function(err) {
          // Rule 2, before cb so the descriptor is gone by the time the caller runs. The error is
          // handed on unchanged.
          destroyIfOpen(uploadStream);
          cb(err);
        });
      }
      else {
        // "does not exists" is a grammatical error that already reaches logs and error text, so it
        // is reproduced byte-for-byte, double quotes and trailing space included.
        // See docs/PRESERVED-QUIRKS.md section 1.5.
        cb(new Error("Snapshot does not exists: " + file.path + file.name));
      }
    }, 1000);
  }

  /**
   * Uploads snapshot bytes already held in memory.
   *
   * Resolves the S3 response and rejects the upload error. Nothing here opens a descriptor, so the
   * stat-before-open and destroy-what-did-not-close rules at the top of this file have nothing to do on
   * this path: the body is a Buffer whose `.length` the SDK reads directly.
   *
   * @param   {String} filename The object name.
   * @param   {Buffer} filedata The bytes.
   * @returns {Promise<Object>} The S3 client response.
   */
  this.uploadSnapshotFromBuffer = function(filename, filedata) {
    var fileinfo = {
      name: filename,
      contentType: 'image/png'
    };

    return self._upload(filedata, config.aws.buckets.snapshots, true, fileinfo);
  }

  /**
   * Deletes one object.
   *
   * Resolves the delete response and rejects the delete error. No descriptor is opened here, so there
   * is nothing to destroy.
   *
   * @param   {String} container The `config.aws.buckets` key.
   * @param   {String} file      A path or key; only the segment after the last '/' is used.
   * @returns {Promise<Object>} The S3 client response.
   */
  this.removeFile = function(container, file) {
    var client   = aws.getS3Client(),
        filename = file.substring(file.lastIndexOf('/') + 1, file.length);

    return client.send(new aws.DeleteObjectCommand({
      Bucket : config.aws.buckets[container].name,
      Key    : filename
    }));
  }

  // Resolves the File document and rejects with the save or upload error; the file that accompanied an
  // upload failure is not reported, which is what the three call sites in lib/controllers/users.js
  // consume. A caller that omits `replaceFile` passes `undefined`, which the `!= null` test below
  // treats as "no replacement".
  this.uploadUserAsset = async function(fileupload, user, replaceFile) {
    var contentType = fileupload.headers['content-type'];
    var filename    = fileupload.filename;
    var extension   = filename.lastIndexOf('.') > -1 ? filename.substring(filename.lastIndexOf('.') + 1, filename.length) : '';

    var digest = await self.hashcontents(fileupload.path);

    var container = config.aws.buckets.userassets
      , remoteName, file;

    if (replaceFile != null) {
      file = replaceFile;
    }
    else {
      file = new File();
    }

    file.name = filename;
    file.type = 'embed';
    file.mime = contentType;
    file.hash = digest;
    file.size = fileupload.bytes;

    file.setOwner(user);

    remoteName = digest + '-' + file.id + '.' + extension;
    file.url   = container.host + '/' + remoteName;

    // A save failure short-circuits and never reaches S3, as `if (err) return cb(err)` did.
    file = await file.save();

    var fileinfo = {
      name        : remoteName,
      contentType : contentType
    };

    // Rule 1: measured, then opened. A stat failure rejects with the stat error where a failed send
    // rejects with the send error - the same single channel this method has always had, and the same
    // one the three util.promisify call sites in lib/controllers/users.js consume.
    fileinfo.contentLength = (await fs.promises.stat(fileupload.path)).size;

    var uploadStream = fs.createReadStream(fileupload.path);

    // Rule 2: the rejection is re-thrown UNCHANGED - same object, same message - so the three callers
    // see exactly the error they saw before; only the descriptor is released on the way out.
    try {
      await self._upload(uploadStream, container, true, fileinfo);
    }
    catch (uploadError) {
      destroyIfOpen(uploadStream);
      throw uploadError;
    }

    return file;
  }

  this.downloadUserAsset = async function(remote) {
    var client = aws.getS3Client();

    var response = await client.send(new aws.GetObjectCommand({
      Bucket : config.aws.buckets.userassets.name,
      Key    : remote
    }));

    // Body is a Buffer that can be streamed
    //
    // That describes the value returned here rather than response.Body, which is a one-shot
    // Readable. It is collected into a Buffer so the three callers in lib/controllers/trinket.js
    // keep the contract they rely on, and the Buffer.from() wrapper around the Uint8Array that
    // transformToByteArray() resolves is what preserves Buffer.isBuffer().
    return Buffer.from(await response.Body.transformToByteArray());
  };

  // TODO: implement as needed
  this.uploadOrgImage = function(stream, cb) {
    cb(null);
  };
}

module.exports = new FileUtil();
