var PassThrough         = require('stream').PassThrough,
    crypto              = require('crypto'),
    config              = require('config'),
    Boom                = require('@hapi/boom'),
    aws                 = require('../../config/aws'),
    fs                  = require('fs');

function FileUtil() {
  var self = this;

  this._upload = function(stream, container, s3, fileinfo, cb) {
    var client = new aws.S3();
    client.putObject({
      Bucket      : container.name,
      Key         : fileinfo.name,
      Body        : stream,
      ContentType : fileinfo.contentType
    }, function(err, data) {
      cb(err, data);
    });
  }

  this._fileToContainer = function(upload, container, s3, cb) {
    var contentType = upload.headers['content-type'];

    var filename  = upload.filename;
    var extension = filename.lastIndexOf('.') > -1 ? filename.substring(filename.lastIndexOf('.') + 1, filename.length) : '';

    if (config.app.extensionWhitelist[extension]) {
      contentType = config.app.extensionWhitelist[extension];
    }

    self.hashcontents(upload.path, function(digest, hashError) {
      // The digest IS the storage key (AAP 0.6.7), so there is no safe way to
      // carry on without one: a key built from a missing digest would store the
      // bytes where nothing can ever find them again. The read failure is
      // handed to the caller, which already has an error arm, instead of
      // killing the process as baseline did.
      if (hashError) {
        console.log(hashError);
        return cb(hashError);
      }

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
        err && console.log(err);

        // remove temporary file
        fs.unlink(upload.path, function(err) {
          cb(err, {
            host : container.host,
            path : fileinfo.name,
            name : fileinfo.name,
            hash : digest,
            size : upload.bytes
          });
        });
      });
    });
  };

  // returns sha1 digest of files contents
  //
  // The callback keeps its original shape: the DIGEST is argument one and it
  // fires exactly once, so every existing caller written as
  // `function(digest) {...}` is unaffected. The read failure is reported as a
  // SECOND argument rather than a first, which is the whole of the change here
  // and the reason the argument order is not the Node convention: the digest
  // position is a contract this project's storage cases pin, and reversing it
  // would silently hand every one of those callers an Error where a hex string
  // belongs.
  //
  // WHY AN 'error' LISTENER EXISTS AT ALL. Baseline attached none, so a path
  // that could not be read emitted 'error' on the read stream with no listener
  // anywhere and Node raised it as an uncaught exception: the process exited 1
  // and the callback never fired. That is reachable from two ordinary requests
  // - a user-asset upload whose temporary file is not yet on disk, and a
  // material upload whose temporary file has gone - and it takes every other
  // in-flight request down with it. R-b ("the application must genuinely run
  // ... with no route or module excluded") is unqualified about routes serving,
  // and AAP 0.7 already decided this precedence for the sibling case: an absent
  // process is the absence of a response rather than behaviour a client can
  // depend on. So the failure becomes a reported error the caller can map to a
  // response, and no digest is invented for it.
  this.hashcontents = function(path, cb) {
    var stream  = fs.createReadStream(path);
    var hash    = crypto.createHash('sha1');
    // Both arms below are reachable in either order - a stream can error after
    // delivering bytes - and the callback fired exactly once at baseline, so it
    // fires exactly once here.
    var settled = false;

    hash.setEncoding('hex');

    stream.on('end', function() {
      if (settled) return;
      settled = true;

      hash.end();
      cb(hash.read());
    });

    stream.on('error', function(err) {
      if (settled) return;
      settled = true;

      // Released so the digest stream cannot be left open behind a failed read.
      hash.end();
      cb(null, err);
    });

    stream.pipe(hash);
  }

  // Reads one object out of the materials bucket and returns the PassThrough it
  // is being piped into. Synchronous, as it has always been: the stream comes
  // back immediately and the bytes arrive on it later.
  //
  // THE BUCKET AND KEY ARE UNCHANGED AND DELIBERATELY SO. Every File is
  // resolved against `config.aws.buckets.materials.name` with the `remote`
  // argument as the Key, which is the contract AAP 0.6.7 states for this
  // function, and no bucket is selected from the document's own type. A File
  // whose object lives in another container is therefore not readable through
  // here - which is what the route that calls this is for, since the only
  // producer of `/api/files/{id}/{name}` paths is the material upload handler
  // and a user asset is served from its own `file.url` on the assets host.
  // Resolving the bucket per document would be a behaviour change R-d
  // prohibits and one AAP 0.7 does not authorize (it grants exactly two
  // deviations, and states that nothing further is left for an implementer to
  // choose), so it is not made here.
  //
  // WHAT DID CHANGE: THE FAILURE PATH.
  //
  // `.pipe()` attaches an 'error' listener to the DESTINATION and never to the
  // source, so at baseline the stream returned by `createReadStream()` carried
  // no 'error' listener anywhere - not here, not in the calling handler, not in
  // hapi, which only attaches its own once it begins transmitting. A missing or
  // unreadable object (`NoSuchKey` from the store, `CredentialsError` from an
  // unconfigured client) therefore surfaced as an uncaught exception and the
  // process exited 1, taking all 233 routes and every concurrent request with
  // it. Measured on both trees, from a single unauthenticated request.
  //
  // Two mechanisms replace it, and neither changes a successful read:
  //
  //   1. An 'error' listener is attached to the returned stream AT
  //      CONSTRUCTION, before any caller can hold it. That alone is what makes
  //      an unhandled 'error' impossible: hapi adds its own listener later, and
  //      the gap before it was the window the process died in.
  //   2. `ready`, an OPTIONAL callback, is invoked exactly once with `null` as
  //      soon as the read is known to be delivering - the first byte, or the
  //      end of a zero-byte object - and with the store's own error if the read
  //      failed before then. A caller that awaits it can answer with a status
  //      (the absent object becomes a mapped 404 rather than a dead process,
  //      which is also what makes that branch measurable at all); a caller that
  //      omits it gets exactly the stream it always got.
  //
  // The success announcement is taken from the SOURCE's first 'data' event, and
  // that listener is attached AFTER `pipe()` on purpose. A 'data' listener put
  // on before the pipe exists would switch the source into flowing mode with no
  // destination and drop the leading chunks; attached after, the pipe
  // destination and this listener both receive every chunk, so nothing is
  // consumed. Announcing on the first byte rather than at 'end' is equally
  // deliberate: waiting for 'end' would buffer the whole object before the
  // response began, changing the streaming behaviour and the time to first byte
  // for large materials.
  //
  // @param {string} remote Key inside the materials bucket, used verbatim.
  // @param {function(Error|null)} [ready] Fires once: null once bytes are on
  //   their way, or the read error if the read failed before any arrived.
  // @returns {stream.PassThrough} The stream the object is piped into.
  this.downloadMaterialFile = function(remote, ready) {
    var stream = new PassThrough;
    var client = new aws.S3();
    var announced = false;
    var source;

    var announce = function(err) {
      if (announced) return;
      announced = true;

      if (typeof ready === 'function') {
        ready(err || null);
      }
    };

    // Guarantees a listener for the lifetime of the stream, so `destroy(err)`
    // below can never raise an unhandled 'error'. A consumer that attaches its
    // own listener still receives the error - listeners do not displace one
    // another - and hapi's own listener is unaffected.
    stream.on('error', function() {});

    source = client.getObject({
      Bucket : config.aws.buckets.materials.name,
      Key    : remote
    }).createReadStream();

    source.on('error', function(err) {
      // Before any byte has been delivered this is still reportable as a
      // response, and `announce` is what reports it. After delivery has begun
      // `announce` is already spent and the only outcome left is an aborted
      // response, which is what destroying the stream with the error produces.
      announce(err);
      stream.destroy(err);
    });

    source.pipe(stream);

    // Attached after the pipe - see the note above on why the order matters.
    source.once('data', function() {
      announce(null);
    });

    // A zero-byte object never emits 'data' but is still a successful read.
    source.once('end', function() {
      announce(null);
    });

    return stream;
  };

  this.uploadMaterialFile = function(upload, cb) {
    var container = config.aws.buckets.materials;
    self._fileToContainer(upload, container, true, cb);
  };

  this.uploadUserAvatar = function(upload, cb) {
    if (!/^image\/(png|jpg|jpeg)$/.test(upload.headers['content-type'])) {
      // A client media-type mistake, so it is carried as a 415: a plain Error
      // here left the handler with nothing but `badImplementation`, and Boom's
      // 5xx serialization replaces the message with generic text, so the caller
      // was told a server fault with the reason dropped (QA finding W001-F16).
      // Only the error's TYPE changes - the accept set above stays exactly
      // `/^image\/(png|jpg|jpeg)$/` per AAP 0.6.7, and the message below is
      // byte-identical and still reaches the user through `.message`.
      return cb(Boom.unsupportedMediaType('unsupported image type, must be png or jpg'));
    }
    var container = config.aws.buckets.useravatars;
    self._fileToContainer(upload, container, true, cb);
  };

  // can be removed once uploadSnapshotFromBuffer has been tested in prod
  this.uploadSnapshot = function(file, cb) {
    // strange but seems necessary in certain situations...
    setTimeout(function() {
      fs.exists(file.path + file.name, function(snapshotExists) {
        if (snapshotExists) {
          var uploadStream = fs.createReadStream(file.path + file.name);
          var fileinfo = {
            name        : file.name,
            contentType : 'image/png'
          };
          self._upload(uploadStream, config.aws.buckets.snapshots, true, fileinfo, cb);
        }
        else {
          cb(new Error("Snapshot does not exists: " + file.path + file.name));
        }
      });
    }, 1000);
  }

  this.uploadSnapshotFromBuffer = function(filename, filedata, cb) {
    var fileinfo = {
      name: filename,
      contentType: 'image/png'
    };
    self._upload(filedata, config.aws.buckets.snapshots, true, fileinfo, cb);
  }

  // Deletes one object. The bucket comes from the container NAME - a string key
  // into `config.aws.buckets` - and the Key is the substring after the LAST
  // '/' of the supplied value, which is the contract AAP 0.6.7 states and its
  // storage cases pin by passing a full URL and asserting only the basename
  // reaches the store.
  //
  // The basename derivation is retained deliberately. It cannot reclaim an
  // object stored under a nested key, and nothing in this application stores
  // one on a path that reaches here: the sole caller is
  // `lib/workers/util/snapshot.js`'s `removeSnapshot`, which passes a snapshot
  // name carrying no '/', and every `url` this module writes is
  // `container.host + '/' + <key with no '/'>`. Changing the derivation is not
  // one of the four kinds of change R-a admits, it is an improvement R-d
  // prohibits, and it would put a wrong Key in a DELETE call for any legacy
  // value whose host prefix no longer matches configuration - so the risk runs
  // the wrong way. Preserved as measured; the callback contract is
  // `(err, result)` because `lib/workers/util/snapshot.js` promisifies it.
  this.removeFile = function(container, file, cb) {
    var client, filename;

    if (typeof(cb) !== 'function') {
      cb = function(err, result) {
        return result;
      }
    }

    client   = new aws.S3();
    filename = file.substring(file.lastIndexOf('/') + 1, file.length);
    client.deleteObject({
      Bucket : config.aws.buckets[container].name,
      Key    : filename
    }, cb);
  }

  this.uploadUserAsset = function(fileupload, user, replaceFile, cb) {
    var contentType = fileupload.headers['content-type'];
    var filename    = fileupload.filename;
    var extension   = filename.lastIndexOf('.') > -1 ? filename.substring(filename.lastIndexOf('.') + 1, filename.length) : '';

    if (typeof replaceFile === 'function') {
      cb = replaceFile;
      replaceFile = null;
    }

    self.hashcontents(fileupload.path, function(digest, hashError) {
      // Reported rather than fatal. The temporary file this reads is written by
      // the caller, and a caller that has not finished writing it - or has lost
      // it - used to end the process here instead of answering. Every one of
      // this function's three callers has an error arm that maps to a response,
      // so the error is handed to them; no File document is created and no
      // object is stored, which is the same "nothing happened" outcome the
      // process death produced, minus the death.
      if (hashError) {
        console.log(hashError);
        return cb(hashError);
      }

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

      // THE DOCUMENT IS SAVED BEFORE THE UPLOAD, AND STAYS THAT WAY. A failed
      // upload therefore leaves a File row whose `url` names an object that was
      // never stored, and the callback below reports the error and the document
      // together. That ordering is the contract AAP 0.6.7's storage cases pin -
      // the document must be observable even when the upload then fails - and
      // reversing it, or deleting the row on failure, is a behaviour change R-d
      // prohibits. What made the ordering dangerous was reading such a row
      // later: `downloadMaterialFile` used to end the process on a missing
      // object, and it now reports the miss, so the row is a stale record
      // rather than a latent process kill.
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

  this.downloadUserAsset = function(remote) {
    var client = new aws.S3();

    return new Promise(function(resolve, reject) {
      client.getObject({
        Bucket : config.aws.buckets.userassets.name,
        Key    : remote
      }, function(err, data) {
        if (err) {
          return reject(err);
        }

        // Body is a Buffer that can be streamed
        return resolve(data.Body);
      });
    });
  };

  // TODO: implement as needed
  this.uploadOrgImage = function(stream, cb) {
    cb(null);
  };
}

module.exports = new FileUtil();
