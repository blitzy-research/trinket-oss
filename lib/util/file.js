var PassThrough         = require('stream').PassThrough,
    crypto              = require('crypto'),
    config              = require('config'),
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
        err && console.log(err);

        // release the descriptor before unlinking: an upload that failed
        // without draining the body leaves this stream open, and the bytes of
        // an unlinked inode stay allocated while any descriptor still holds
        // it - so the unlink below would free nothing. A stream the SDK
        // drained is already destroyed, which makes this a no-op on the
        // success path, and aws-sdk v2 cannot retry a stream body, so the SDK
        // is finished with it by the time this callback runs.
        if (!uploadStream.destroyed) {
          uploadStream.destroy();
        }

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

  /**
   * Removes one temporary upload artifact, without ever making the removal
   * the caller's problem.
   *
   * Every multipart upload this module is handed arrives as a file on disk
   * (the asset and avatar routes are declared `output: 'file'`), and the only
   * removal this module historically performed is the one inside
   * `_fileToContainer`. The other upload paths - `uploadUserAsset` on all of
   * its terminal branches, and the unsupported-type rejection in
   * `uploadUserAvatar`, which returns before `_fileToContainer` is reached -
   * ran to their callback without touching the artifact, so an authenticated
   * caller grew the temporary directory one upload at a time (CWE-459,
   * CWE-400). Each of those paths now routes its artifact through here;
   * `_fileToContainer` keeps the `fs.unlink` it always had, because the way
   * that call substitutes its own error is part of its observable contract.
   *
   * It is exported so a caller can remove an artifact this module never
   * receives, but nothing outside this file calls it yet: the ZIP archives
   * whose paths `lib/controllers/trinket.js` records on `request.params._tmp`
   * still have no consumer, and this function existing does not give them one.
   *
   * The contract is deliberately narrow:
   *   - a falsy `target` is a no-op, so a caller need not test before calling;
   *   - `ENOENT` is a success: the artifact is already gone, which is the
   *     outcome wanted, and is what `fs.unlink` reports when two terminal
   *     paths both clean up;
   *   - any other error is logged the way this module already logs an upload
   *     error, and then dropped;
   *   - `cb` is optional, is invoked with NO arguments, and is invoked exactly
   *     once and always asynchronously. Cleanup must not change the outcome
   *     the caller is about to report - an upload that succeeded is still a
   *     success when its temporary file could not be removed - so a cleanup
   *     failure is never surfaced.
   *
   * @param {string} target Path of the temporary artifact; falsy is tolerated.
   * @param {function()} [cb] Invoked with no arguments once cleanup has ended.
   */
  this.removeTemporaryFile = function(target, cb) {
    var done = typeof cb === 'function' ? cb : function() {};

    if (!target) {
      // Asynchronous on this branch too, so a caller's ordering does not
      // depend on whether there was anything to remove.
      return process.nextTick(done);
    }

    fs.unlink(target, function(err) {
      // ENOENT is the already-removed case, and is not worth a line of log.
      if (err && err.code !== 'ENOENT') {
        console.log(err);
      }

      done();
    });
  };

  // returns sha1 digest of files contents
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

  this.downloadMaterialFile = function(remote) {
    var stream = new PassThrough;
    var client = new aws.S3();
    client.getObject({
      Bucket : config.aws.buckets.materials.name,
      Key    : remote
    }).createReadStream().pipe(stream);

    return stream;
  };

  this.uploadMaterialFile = function(upload, cb) {
    var container = config.aws.buckets.materials;
    self._fileToContainer(upload, container, true, cb);
  };

  this.uploadUserAvatar = function(upload, cb) {
    if (!/^image\/(png|jpg|jpeg)$/.test(upload.headers['content-type'])) {
      // This return happens before `_fileToContainer`, the only place this
      // module historically unlinked, so a rejected avatar used to leave its
      // temporary file - up to the route's 5 MB cap, repeatable - on disk for
      // good. The error's message and its "error alone, no result" shape are
      // part of the observable contract and are unchanged.
      return self.removeTemporaryFile(upload.path, function() {
        cb(new Error('unsupported image type, must be png or jpg'));
      });
    }
    var container = config.aws.buckets.useravatars;
    self._fileToContainer(upload, container, true, cb);
  };

  // can be removed once uploadSnapshotFromBuffer has been tested in prod
  this.uploadSnapshot = function(file, cb) {
    // strange but seems necessary in certain situations...
    setTimeout(function() {
      // Concatenated exactly as before - `file.path` carries its own trailing
      // separator - and held in one variable so the open, the stream and the
      // error message cannot drift apart.
      var snapshotPath = file.path + file.name;
      var fileinfo     = {
        name        : file.name,
        contentType : 'image/png'
      };

      // ONE acquisition, where there used to be an existence check followed by
      // a separate open of the same name. The old pair left a window in which
      // the name could be pointed at different bytes or removed altogether
      // (CWE-367): a replacement was stored under the asserted key, and a
      // removal turned into an ENOENT raised out of the stream after
      // `putObject` had already taken it as a Body. A descriptor closes that
      // window - the bytes come from the inode this open resolved, so a later
      // rename or unlink of `snapshotPath` can neither change nor remove them.
      // An in-place truncating rewrite of that same inode is visible through
      // any descriptor onto it and stays outside what this contract promises.
      fs.open(snapshotPath, 'r', function(openErr, fd) {
        if (openErr) {
          // The two failure classes the old check distinguished are preserved.
          // `fs.exists` is access(F_OK), which answers for PRESENCE alone: an
          // existing file the process cannot read answered TRUE - measured as
          // an unprivileged user, where `fs.exists` was true while `fs.open`
          // gave EACCES - so baseline went on to `createReadStream` and
          // `_upload` and surfaced whatever that produced. It did not report a
          // missing snapshot. Only an absent or unreachable path took the
          // message branch. Asking access() here, on the failure branch alone,
          // keeps both edges intact and leaves the success path its single
          // atomic acquisition.
          return fs.access(snapshotPath, fs.constants.F_OK, function(accessErr) {
            if (accessErr) {
              return cb(new Error("Snapshot does not exists: " + file.path + file.name));
            }

            return self._upload(fs.createReadStream(snapshotPath), config.aws.buckets.snapshots, true, fileinfo, cb);
          });
        }

        var uploadStream = fs.createReadStream(snapshotPath, { fd : fd, autoClose : true });

        // The length has to come from the descriptor rather than from the name,
        // or the descriptor buys nothing. aws-sdk v2 sizes a stream body in this
        // order - `byteLength`, `length`, `size`, then `path` ->
        // `lstatSync(path).size` (node_modules/aws-sdk/lib/util.js:187-202,
        // reached from lib/event_listeners.js:224). With `path` alone, measured:
        // an unlink after acquisition makes that lstat throw ENOENT so the
        // request is never built, and a replacement of a different length
        // declares the new file's size for the old file's bytes. `size` is read
        // from the descriptor and is consulted before `path`.
        //
        // `path` is still restored, because the baseline Body carried it and
        // Node leaves it undefined when a stream is built from an `fd`; if the
        // fstat below fails it also leaves the SDK the exact fallback it used
        // before.
        fs.fstat(fd, function(statErr, stats) {
          uploadStream.path = snapshotPath;

          if (!statErr) {
            uploadStream.size = stats.size;
          }

          self._upload(uploadStream, config.aws.buckets.snapshots, true, fileinfo, function(err, data) {
            // Release the descriptor this open took: an upload that failed
            // without draining the body would otherwise leak it. `autoClose`
            // has already closed it once the stream drained, and such a stream
            // is destroyed, which makes this a no-op on the success path.
            if (!uploadStream.destroyed) {
              uploadStream.destroy();
            }

            cb(err, data);
          });
        });
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
        if (err) {
          // The document was not persisted, so nothing will ever read the
          // artifact: remove it, then report the save's own error unchanged -
          // the cleanup's outcome is not the caller's business.
          return self.removeTemporaryFile(fileupload.path, function() {
            cb(err);
          });
        }

        var uploadStream = fs.createReadStream(fileupload.path);
        var fileinfo = {
          name        : remoteName,
          contentType : contentType
        };
        self._upload(uploadStream, container, true, fileinfo, function(err, results) {
          // Release the descriptor before unlinking, for the reason spelled
          // out in `_fileToContainer`: an upload that failed without draining
          // the body still holds this stream open, and an unlinked inode's
          // bytes stay allocated until its last descriptor closes, so the
          // cleanup below would free nothing. A drained stream is already
          // destroyed, so this is a no-op on the success path.
          if (!uploadStream.destroyed) {
            uploadStream.destroy();
          }

          // Cleanup completes before the callback, so a caller that inspects
          // the filesystem sees a settled state; the upload's own `err` and
          // the saved `file` are delivered exactly as before, with the
          // cleanup's outcome reflected in neither.
          self.removeTemporaryFile(fileupload.path, function() {
            cb(err, file);
          });
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
