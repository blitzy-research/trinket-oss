var PassThrough         = require('stream').PassThrough,
    crypto              = require('crypto'),
    config              = require('config'),
    aws                 = require('../../config/aws'),
    fs                  = require('fs');

// Every method below reaches S3 through aws.getS3Client(), which hands back the ONE
// client this process owns rather than building a new one per operation. Nothing in
// this file destroys it: teardown belongs to the application, and app.js releases it
// on the hapi server's 'stop' event.
//
// That is the base commit's resource shape, not a shortcut. Measured on the base
// commit's own aws-sdk 2.1693.0: a v2 client carried no agent of its own and every
// send resolved the same process-global agent singleton, and a v2 client had no
// destroy method at all - so the four `new aws.S3()` calls this file used to make
// shared one socket pool that was never torn down. Under v3 each client owns its own
// pool, so per-call construction is what leaks; config/aws.js records the full
// measurement.
//
// Destroying a client per operation would also be unimplementable for
// downloadMaterialFile below, which must return a stream SYNCHRONOUSLY and therefore
// has no terminal event it can attach teardown to without changing its contract.
// RESOURCE OWNERSHIP (review finding F3). Two rules govern every fs-backed upload below, and both exist
// because a ReadStream holds an OPEN FILE DESCRIPTOR from the moment it is constructed:
//
//   1. STAT BEFORE OPEN. The byte length v3 requires is taken with `await fs.promises.stat(path)` BEFORE the
//      stream is created, so a stat failure cannot leave a descriptor behind - and, on the request paths,
//      so the event loop is not blocked. The previous shape called `fs.statSync()` inside _upload, i.e.
//      synchronously on the hapi request thread, once per avatar, asset and material upload.
//   2. DESTROY ONLY WHAT DID NOT CLOSE, ONLY AFTER A FAILED SEND. A successful send reads the stream to
//      completion and the descriptor is released by the stream itself; a REJECTED send may leave it
//      unconsumed, so each call site destroys its own stream if and only if it is still open. Nothing
//      destroys a stream on a success path, and nothing here changes which error a caller sees.
//
// Neither rule alters a single byte on the wire: the bucket, key, content type, declared length and
// Content-Disposition are all unchanged, and every `{ err, results }` pair, swallowed upload error and
// unlink-error-wins contract below is exactly as it was. See docs/PRESERVED-QUIRKS.md section 3.42.
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

    // An fs-backed body declares its own byte length, as config/aws.js hazard 3
    // requires: v3's PutObjectCommand cannot compute a length from an arbitrary Node
    // stream. `stream` is either an fs.ReadStream - the _fileToContainer,
    // uploadSnapshot and uploadUserAsset paths, each of which carries the `path` it
    // reads - or a Buffer from uploadSnapshotFromBuffer, whose .length the SDK reads
    // directly, so no length is set for it. The bucket, key and content type below are
    // untouched, and the declaration was measured to leave the request headers
    // byte-identical.
    //
    // The length now arrives as `fileinfo.contentLength`, measured by the caller BEFORE it
    // opened the stream (rule 1 at the head of this file). The `stream.path` fallback is kept
    // for any caller that does not pre-measure - it is the same single rejection channel a
    // failed putObject uses, with the measured difference still confined to the message
    // naming `stat` rather than `open` - but it is now an awaited stat rather than a
    // synchronous one, so no upload path blocks the event loop.
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

  // Async conversion. Resolves `{ err, results }` rather than rejecting, because the base
  // commit's terminal statement was `cb(unlinkErr, uploadResult)` - BOTH arguments populated on
  // the failure branch - and lib/controllers/files.js#upload reads the result unconditionally
  // after logging the error. A rejection would discard the result object and turn that swallow
  // into a TypeError, i.e. a 500 on a route that answers 200. `err` is the unlink error or null;
  // `results` is the same object on both branches.
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
  // Async conversion: the digest is delivered by a promise instead of a single-argument
  // callback. There is no failure channel and there deliberately still is not one: the read
  // stream carries no 'error' listener, so an unreadable file emits on a listener-less
  // emitter and crashes the process rather than surfacing an error to the caller, exactly as
  // it did at the base commit. The promise is therefore resolve-only - it never rejects, and
  // it never settles at all on that path - which is what keeps both internal callers
  // (_fileToContainer and uploadUserAsset) behaving as they did.
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

  // Returns a pipeable stream SYNCHRONOUSLY. AWS SDK v3 removed
  // .createReadStream(), so send() is fired without being awaited and the resolved
  // response.Body - already a Node Readable under v3 - is piped into the
  // PassThrough once it arrives. This method must NOT become async: its caller in
  // lib/controllers/files.js hands the return value straight to reply(), which
  // needs a stream and not a promise.
  //
  // The FAILURE channel is reproduced structurally rather than re-routed, because the two
  // are not equivalent and the difference is observable (R-5 / R-6).
  //
  // At the base commit this read `client.getObject({...}).createReadStream().pipe(stream)`.
  // The v2 read stream was an ANONYMOUS temporary: nothing kept a reference to it, and -
  // measured against Node 22's own Readable.prototype.pipe source - pipe() attaches its
  // error handler with `prependListener(dest, 'error', onerror)` and installs NO listener on
  // the SOURCE at all. So when the S3 request failed, the source emitted 'error' with zero
  // listeners, which throws. With no process-level 'uncaughtException' handler anywhere in
  // this repository, that killed the process, and the returned PassThrough was left
  // pristine - never ended, never errored - so the response never completed.
  //
  // Calling `stream.destroy(err)` on the RETURNED PassThrough instead would move the failure
  // onto a stream hapi is already listening to, turning process death into a tidy HTTP 500.
  // That is a strict improvement, and R-4 forbids improvements. The error is therefore
  // emitted on a SOURCE stream that is piped into the PassThrough exactly as the v2 read
  // stream was, so it carries no 'error' listener and reaches the same unowned-emit channel
  // with the same error object. See docs/PRESERVED-QUIRKS.md section 3.28.
  //
  // Re-measured on this runtime (node v22.23.2) while integrating the change: `src.pipe(dst)`
  // leaves the SOURCE with 0 'error' listeners and gives the DESTINATION exactly 1, an
  // `emit('error')` on the listener-less source throws synchronously, and the destination is
  // left `writableEnded=false destroyed=false errored=false` either way - so the returned
  // stream never completes, exactly as at the base commit.
  //
  // SEAM WITH lib/http/responseContract.js: that module deliberately reproduces the HTTP fate of a
  // baseline branch WITHOUT reproducing the process termination that accompanied it. The two
  // adjudications are consistent because the distinction is structural: there, death required
  // MANUFACTURING a fault the migrated shape no longer raises, whereas here the unowned emit is
  // the direct structural analogue of the v2 read stream, and the termination is emergent from
  // reproducing it rather than added on top.
  //
  // The client comes from aws.getS3Client(), the single shared S3Client this module reaches S3
  // through everywhere else (see the note at the head of this file); a second client here would
  // change the connection pooling the rest of the file depends on.
  // SOCKET LIFECYCLE (review finding F8). The three streams here are chained
  // `response.Body -> source -> stream`, and `stream` is what lib/controllers/files.js hands to
  // h.response(). When the client disconnects mid-download hapi destroys `stream` and stops there:
  // pipe() propagates neither close nor destroy upstream, so `source` stayed alive and - the part that
  // matters - `response.Body` kept draining an S3 connection from the ONE shared S3Client's pool for a
  // response nobody is reading. Repeated aborts exhaust that pool, and the pool is process-wide.
  //
  // The propagation is deliberately one-directional and cancellation-only. It fires ONLY when `stream`
  // closes before it has ended normally, so a completed download - where 'end' precedes 'close' -
  // destroys nothing, and the response bytes, headers and the synchronous return are untouched.
  //
  // What it must NOT do, and does not: add an 'error' listener to `source`. The rejection branch below
  // emits on a LISTENER-LESS source on purpose, which throws and takes the process down exactly as the
  // v2 read stream's unowned emit did - the preserved channel of docs/PRESERVED-QUIRKS.md section 3.28.
  // A no-op 'error' handler is attached to `response.Body` only on the cancellation path, and only
  // immediately before destroying it, so a MID-TRANSFER body error on a live download still reaches
  // that same unowned-emit channel while a teardown error on an already-abandoned request cannot
  // invent a new one. `destroy()` without an argument emits 'close', never 'error'.
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
      // The base commit answered this rejection as `cb(err)` with no second argument, so the pair
      // carries the same undefined `results`. The message is client-visible - lib/controllers/files.js
      // returns it and hapi boomifies a plain Error - so it stays byte-identical.
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
   * Async conversion: promise-native, resolving the S3 response and rejecting the upload error - which
   * is exactly what its only consumer, lib/controllers/trinket.js, previously obtained by wrapping this
   * method in util.promisify(). The bridge and the callback are both gone. Nothing here opens a
   * descriptor, so the stat-before-open and destroy-what-did-not-close rules stated at the top of this
   * file have nothing to do on this path: the body is a Buffer whose `.length` the SDK reads directly.
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
   * Async conversion: promise-native, resolving the delete response and rejecting the delete error -
   * which is what its only consumer, lib/workers/util/snapshot.js, previously obtained by wrapping this
   * method in util.promisify() at module load. The callback the base commit accepted is gone, and with
   * it the optional-callback juggling (`typeof(cb) !== 'function'`) that existed only to swallow the
   * result when no callback was supplied: a caller that ignores the returned promise now ignores it
   * without this method having to help. No descriptor is opened here, so there is nothing to destroy.
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

  // Async conversion: resolves the File document, rejects with the save or upload error. That is
  // byte-for-byte the contract the three call sites in lib/controllers/users.js already consumed,
  // because they wrapped this method in util.promisify(), which rejects on a truthy first callback
  // argument and discards the second - so the base commit's `cb(err, file)` on the upload-failure
  // branch already threw the file away there. The optional-callback juggling the base commit
  // carried (`typeof replaceFile === 'function'`) is gone with the callback parameter it existed
  // to recover; a caller that omits `replaceFile` now passes `undefined`, which the `!= null` test
  // below already treated as "no replacement".
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
