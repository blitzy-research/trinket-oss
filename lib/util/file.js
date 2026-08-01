var PassThrough         = require('stream').PassThrough,
    crypto              = require('crypto'),
    config              = require('config'),
    aws                 = require('../../config/aws'),
    fs                  = require('fs');

function FileUtil() {
  var self = this;

  this._upload = function(stream, container, s3, fileinfo, cb) {
    var client = aws.createS3Client();

    // AWS SDK v3 has no callback form, so send() returns a promise. The
    // two-argument then() is deliberate rather than a trailing catch(): a catch()
    // would fire a SECOND cb(err) if cb itself threw, and every caller of this
    // method must see exactly one invocation.
    //
    // No ContentLength is supplied. `stream` is either an fs.ReadStream (the
    // _fileToContainer, uploadSnapshot and uploadUserAsset paths) or a Buffer
    // (uploadSnapshotFromBuffer), and the SDK derives the length of both; adding
    // one was measured to produce byte-identical request headers.
    client.send(new aws.PutObjectCommand({
      Bucket      : container.name,
      Key         : fileinfo.name,
      Body        : stream,
      ContentType : fileinfo.contentType
    })).then(function(data) {
      cb(null, data);
    }, function(err) {
      cb(err);
    });
  }

  this._fileToContainer = function(upload, container, s3, cb) {
    var contentType = upload.headers['content-type'];

    var filename  = upload.filename;
    var extension = filename.lastIndexOf('.') > -1 ? filename.substring(filename.lastIndexOf('.') + 1, filename.length) : '';

    if (config.app.extensionWhitelist[extension]) {
      contentType = config.app.extensionWhitelist[extension];
    }

    self.hashcontents(upload.path, function(digest) {
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

      self._upload(uploadStream, container, s3, fileinfo, function(err) {
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.12. The upload
        // error is logged and then SWALLOWED: the callback below still reports
        // success, so a failed S3 write is indistinguishable from a successful one
        // to every caller of uploadMaterialFile and uploadUserAvatar. Propagating
        // it would change the status those routes return.
        err && console.log(err);

        var uploadResult = {
          host : container.host,
          path : fileinfo.name,
          name : fileinfo.name,
          hash : digest,
          size : upload.bytes
        };

        // remove temporary file
        //
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The UNLINK's error
        // becomes the caller's error, so a successful upload followed by a failed
        // temporary-file removal is reported as a failure. Both branches hand back
        // the same result object, exactly as the callback form did.
        fs.promises.unlink(upload.path).then(function() {
          cb(null, uploadResult);
        }, function(unlinkErr) {
          cb(unlinkErr, uploadResult);
        });
      });
    });
  };

  // returns sha1 digest of files contents
  //
  // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Two deliberate defects are
  // kept here and neither is repaired. The callback is NOT error-first - it
  // receives the digest as its only argument, and both internal callers
  // (_fileToContainer and uploadUserAsset) pass a one-parameter function - and the
  // read stream carries no 'error' listener, so an unreadable file crashes the
  // process rather than surfacing an error to the caller.
  this.hashcontents = function(path, cb) {
    var stream = fs.createReadStream(path);
    var hash   = crypto.createHash('sha1');

    hash.setEncoding('hex');

    stream.on('end', function() {
      hash.end();
      cb(hash.read());
    });

    stream.pipe(hash);
  }

  // Returns a pipeable stream SYNCHRONOUSLY. AWS SDK v3 removed
  // .createReadStream(), so send() is fired without being awaited and the resolved
  // response.Body - already a Node Readable under v3 - is piped into the
  // PassThrough once it arrives. This method must NOT become async: its caller in
  // lib/controllers/files.js hands the return value straight to reply(), which
  // needs a stream and not a promise.
  this.downloadMaterialFile = function(remote) {
    var stream = new PassThrough;
    var client = aws.createS3Client();
    client.send(new aws.GetObjectCommand({
      Bucket : config.aws.buckets.materials.name,
      Key    : remote
    })).then(function(response) {
      response.Body.pipe(stream);
    }, function(err) {
      // Destroying with the error emits 'error' on the returned stream, which is
      // what the v2 createReadStream() stream did on a failed request. Leaving it
      // undestroyed would hang the response on a stream that never ends.
      stream.destroy(err);
    });

    return stream;
  };

  this.uploadMaterialFile = function(upload, cb) {
    var container = config.aws.buckets.materials;
    self._fileToContainer(upload, container, true, cb);
  };

  this.uploadUserAvatar = function(upload, cb) {
    if (!/^image\/(png|jpg|jpeg)$/.test(upload.headers['content-type'])) {
      return cb(new Error('unsupported image type, must be png or jpg'));
    }
    var container = config.aws.buckets.useravatars;
    self._fileToContainer(upload, container, true, cb);
  };

  // can be removed once uploadSnapshotFromBuffer has been tested in prod
  this.uploadSnapshot = function(file, cb) {
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.5. The
    // unconditional one-second delay stays. Removing it would reintroduce whatever
    // race the original author's note below records - intermittently, and only
    // under load.
    //
    // strange but seems necessary in certain situations...
    setTimeout(async function() {
      var snapshotExists;

      // fs.exists() is the deprecated non-error-first callback API. access()
      // rejects where exists() reported false, so the boolean is reconstructed
      // from the try/catch and the two branches below are otherwise unchanged.
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
        self._upload(uploadStream, config.aws.buckets.snapshots, true, fileinfo, cb);
      }
      else {
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.5. "does not
        // exists" is a grammatical error that already reaches logs and error text,
        // so it is reproduced byte-for-byte, double quotes and trailing space
        // included.
        cb(new Error("Snapshot does not exists: " + file.path + file.name));
      }
    }, 1000);
  }

  this.uploadSnapshotFromBuffer = function(filename, filedata, cb) {
    var fileinfo = {
      name: filename,
      contentType: 'image/png'
    };
    self._upload(filedata, config.aws.buckets.snapshots, true, fileinfo, cb);
  }

  this.removeFile = function(container, file, cb) {
    var client, filename;

    if (typeof(cb) !== 'function') {
      cb = function(err, result) {
        return result;
      }
    }

    client   = aws.createS3Client();
    filename = file.substring(file.lastIndexOf('/') + 1, file.length);

    // This method keeps its error-first callback because its only consumer,
    // lib/workers/util/snapshot.js, wraps it in util.promisify() at module load.
    // Two consequences, both load bearing:
    //
    //   1. cb MUST be invoked exactly once on every path. If a path ever returns
    //      without calling it - or leaves a rejection unhandled - the promisified
    //      wrapper never settles and snapshot removal hangs forever rather than
    //      failing.
    //   2. promisify captures this function UNBOUND and calls it bare, so `this`
    //      is not the FileUtil instance in here. Nothing in this body may reference
    //      `this` or `self`; it uses the module-scope `aws` and `config` closures
    //      and its own locals only.
    client.send(new aws.DeleteObjectCommand({
      Bucket : config.aws.buckets[container].name,
      Key    : filename
    })).then(function(data) {
      cb(null, data);
    }, function(err) {
      cb(err);
    });
  }

  this.uploadUserAsset = function(fileupload, user, replaceFile, cb) {
    var contentType = fileupload.headers['content-type'];
    var filename    = fileupload.filename;
    var extension   = filename.lastIndexOf('.') > -1 ? filename.substring(filename.lastIndexOf('.') + 1, filename.length) : '';

    if (typeof replaceFile === 'function') {
      cb = replaceFile;
      replaceFile = null;
    }

    self.hashcontents(fileupload.path, function(digest) {
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

      file.save(function(err, file) {
        if (err) return cb(err);

        var uploadStream = fs.createReadStream(fileupload.path);
        var fileinfo = {
          name        : remoteName,
          contentType : contentType
        };
        self._upload(uploadStream, container, true, fileinfo, function(err, results) {
          cb(err, file);
        });
      });
    });
  }

  this.downloadUserAsset = async function(remote) {
    var client = aws.createS3Client();

    var response = await client.send(new aws.GetObjectCommand({
      Bucket : config.aws.buckets.userassets.name,
      Key    : remote
    }));

    // Body is a Buffer that can be streamed
    //
    // Under v3 that describes the value RETURNED here rather than response.Body:
    // v2 handed back a Buffer directly, v3 hands back a one-shot Readable. It is
    // collected into a Buffer here so the three callers in
    // lib/controllers/trinket.js keep the contract they rely on - one replies with
    // it, two append it to an archive. transformToByteArray() resolves a
    // Uint8Array, so the Buffer.from() wrapper is what preserves Buffer.isBuffer().
    return Buffer.from(await response.Body.transformToByteArray());
  };

  // TODO: implement as needed
  this.uploadOrgImage = function(stream, cb) {
    cb(null);
  };
}

module.exports = new FileUtil();
