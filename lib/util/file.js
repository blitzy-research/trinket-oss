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
function FileUtil() {
  var self = this;

  this._upload = function(stream, container, s3, fileinfo) {
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
    // directly, so no length is set for it. The stat is synchronous so that send()
    // still fires on the caller's stack, and a stat failure reaches the caller through the
    // same single rejection a failed putObject uses; the measured difference is confined to
    // the message naming `stat` rather than `open`, on a branch no caller reaches, since
    // each one streams a file it has just written or downloaded. The bucket, key and
    // content type below are untouched, and the declaration was measured to leave the
    // request headers byte-identical.
    if (stream && typeof stream.path === 'string') {
      try {
        params.ContentLength = fs.statSync(stream.path).size;
      }
      catch (statError) {
        return Promise.reject(statError);
      }
    }

    // AWS SDK v3 has no callback form, so send() already returns a promise and it is
    // handed straight back. Returning it rather than adapting it to a callback is what
    // removes the "invoke cb exactly once" hazard the callback form had to guard against:
    // a promise cannot settle twice.
    return client.send(new aws.PutObjectCommand(params));
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
    var uploadStream = fs.createReadStream(upload.path);

    try {
      await self._upload(uploadStream, container, s3, fileinfo);
    }
    catch (uploadError) {
      // The upload error is logged and then swallowed: the result below still reports success, so
      // a failed S3 write is indistinguishable from a successful one to every caller of
      // uploadMaterialFile and uploadUserAvatar. Propagating it would change the status those
      // routes return.
      uploadError && console.log(uploadError);
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
  this.downloadMaterialFile = function(remote) {
    var stream = new PassThrough;
    var source = new PassThrough;
    var client = aws.getS3Client();

    source.pipe(stream);

    client.send(new aws.GetObjectCommand({
      Bucket : config.aws.buckets.materials.name,
      Key    : remote
    })).then(function(response) {
      response.Body.pipe(source);
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
        var uploadStream = fs.createReadStream(file.path + file.name);
        var fileinfo = {
          name        : file.name,
          contentType : 'image/png'
        };
        // This method keeps its error-first callback - see uploadSnapshotFromBuffer below for why -
        // so the promise _upload now returns is adapted back with a two-argument then(), which
        // cannot invoke cb twice even if cb itself throws.
        self._upload(uploadStream, config.aws.buckets.snapshots, true, fileinfo).then(function(data) {
          cb(null, data);
        }, function(err) {
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

  // This method keeps its error-first callback because its only consumer,
  // lib/controllers/trinket.js, wraps it in util.promisify(). Two consequences follow, both of
  // them the same ones removeFile carries: cb must be invoked exactly once on every path, which
  // the two-argument then() below guarantees; and promisify calls this function unbound, so
  // nothing in this body may reference `this` - it uses the module-scope `self` and `config`
  // closures only.
  this.uploadSnapshotFromBuffer = function(filename, filedata, cb) {
    var fileinfo = {
      name: filename,
      contentType: 'image/png'
    };
    self._upload(filedata, config.aws.buckets.snapshots, true, fileinfo).then(function(data) {
      cb(null, data);
    }, function(err) {
      cb(err);
    });
  }

  this.removeFile = function(container, file, cb) {
    var client, filename;

    if (typeof(cb) !== 'function') {
      cb = function(err, result) {
        return result;
      }
    }

    client   = aws.getS3Client();
    filename = file.substring(file.lastIndexOf('/') + 1, file.length);

    // This method keeps its error-first callback because its only consumer,
    // lib/workers/util/snapshot.js, wraps it in util.promisify() at module load. Two consequences,
    // both load bearing: cb must be invoked exactly once on every path, or the promisified wrapper
    // never settles and snapshot removal hangs forever rather than failing; and promisify calls
    // this function unbound, so nothing in this body may reference `this` or `self` - it uses the
    // module-scope `aws` and `config` closures and its own locals only.
    client.send(new aws.DeleteObjectCommand({
      Bucket : config.aws.buckets[container].name,
      Key    : filename
    })).then(function(data) {
      cb(null, data);
    }, function(err) {
      cb(err);
    });
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

    var uploadStream = fs.createReadStream(fileupload.path);
    var fileinfo = {
      name        : remoteName,
      contentType : contentType
    };

    await self._upload(uploadStream, container, true, fileinfo);

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
