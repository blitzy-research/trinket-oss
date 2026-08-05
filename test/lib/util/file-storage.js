/**
 * The S3 storage contract: `config/aws.js` and `lib/util/file.js`.
 *
 * Every assertion below pins a command SHAPE, so a wrong bucket, a wrong key derivation, a lost
 * `ContentLength` or a change to which command a method issues fails here instead of silently writing to the
 * wrong place in production.
 *
 * THE SEAM. Exactly one thing is stubbed: `config/aws.js#getS3Client`, replaced with a recorder whose
 * `send()` captures the command object. That is deliberately the LOWEST possible seam — the real
 * `PutObjectCommand`, `GetObjectCommand` and `DeleteObjectCommand` classes are constructed by the real
 * production code, and the assertions read `command.constructor.name` and `command.input`. Nothing else is
 * faked: the real filesystem, the real sha1 digest, the real extension whitelist and the real configuration
 * are used throughout. The presigning tests do not stub at all; they sign with injected credentials and parse
 * the resulting URL.
 *
 * WHAT IS DELIBERATELY NOT EXERCISED. `FileUtil.hashcontents` on an unreadable path: its read stream carries
 * no 'error' listener, so an unreadable file emits on a listener-less emitter and CRASHES THE PROCESS rather
 * than rejecting — preserved behavior, and exercising it would kill the mocha process. The unlink-failure
 * branch that needs a failure is therefore driven by stubbing `fs.promises.unlink`, which reaches the same
 * branch without the crash.
 *
 * What the assertions cover: the AWS-encoded object path, the swallowed write error, the stream ownership and
 * synchronous return of the read path, the signed query-parameter set and the path-style fallback for a
 * dotted bucket name.
 */

var chai     = require('chai'),
    should   = chai.should(),
    sinon    = require('sinon'),
    fs       = require('fs'),
    os       = require('os'),
    path     = require('path'),
    crypto   = require('crypto'),
    stream   = require('stream'),
    config   = require('config'),
    aws      = require('../../../config/aws'),
    FileUtil = require('../../../lib/util/file');

describe('S3 storage contract', function() {
  var clientStub = null,
      sent       = [],
      behaviour  = null,
      scratch    = [],
      streams    = [];

  /**
   * Takes ownership of a streamed request body the way the real S3 client does.
   *
   * `lib/util/file.js#_fileToContainer` opens a read stream, hands it to `_upload`, and then UNLINKS the
   * file it was reading - so whoever receives that stream must consume or discard it. The real client
   * does; a stand-in that merely records the command does not, and the descriptor's deferred open then
   * fails after the unlink, emits on a stream production attached no 'error' listener to, and reaches Mocha
   * as an uncaught exception attributed to an unrelated test. Adopting the body here keeps this double
   * faithful to the client it replaces instead of introducing a failure mode of its own.
   *
   * @param {Object} command The command the code under test just issued.
   * @returns {void}
   */
  function adoptBody(command) {
    var body = command && command.input && command.input.Body;

    if (!body || typeof body.destroy !== 'function' || typeof body.on !== 'function') {
      return;
    }

    body.on('error', function() {
      // Deliberately empty - see above.
    });
    body.destroy();
  }

  /** A recording stand-in for the shared S3 client. `behaviour` decides what each send resolves. */
  function recorder() {
    return {
      send : function(command) {
        sent.push(command);
        adoptBody(command);

        return behaviour ? behaviour(command) : Promise.resolve({});
      }
    };
  }

  /** Writes a scratch file and registers it for removal. */
  function scratchFile(contents, suffix) {
    var file = path.join(os.tmpdir(), 'blitzy-storage-' + process.pid + '-' + scratch.length +
                                      (suffix || '.txt'));

    fs.writeFileSync(file, contents);
    scratch.push(file);

    return file;
  }

  /**
   * Opens a read stream over a scratch file and registers it for destruction.
   *
   * `fs.createReadStream` opens its descriptor ASYNCHRONOUSLY, and the recorder standing in for S3
   * resolves without ever consuming the body, so a stream handed to `_upload` can still be waiting to open
   * when `afterEach` unlinks the file underneath it. The late 'ENOENT' then lands on a stream nobody is
   * listening to and reaches Mocha as an uncaught exception attributed to whichever test is running by then.
   * Registering the stream so it is destroyed BEFORE the unlink, and carrying a no-op 'error' listener as a
   * backstop, keeps the failure that matters attributable to the test that caused it.
   *
   * @param {string} file Path to a file created by `scratchFile`.
   * @returns {stream.Readable} The registered read stream.
   */
  function scratchStream(file) {
    var readable = fs.createReadStream(file);

    readable.on('error', function() {
      // Deliberately empty: the only error reachable here is the teardown race described above.
    });

    streams.push(readable);

    return readable;
  }

  beforeEach(function() {
    sent      = [];
    behaviour = null;
    // Stubbed per test and restored in afterEach, so a failing expectation cannot leave the process with
    // a fake S3 client for the suites that run afterwards.
    clientStub = sinon.stub(aws, 'getS3Client').callsFake(recorder);
  });

  afterEach(function() {
    if (clientStub) {
      clientStub.restore();
      clientStub = null;
    }

    // Destroyed before the unlink below, so no stream is left waiting to open a file that is gone.
    streams.forEach(function(readable) {
      readable.destroy();
    });

    streams = [];

    scratch.forEach(function(file) {
      try {
        fs.unlinkSync(file);
      }
      catch (err) {
        // Already removed by the code under test, which is the normal case.
      }
    });

    scratch = [];
  });

  // _upload — the single write path every upload funnels through

  describe('_upload', function() {
    it('issues a PutObjectCommand carrying the bucket, key, body and content type', function() {
      var file = scratchFile('hello storage');

      return FileUtil._upload(scratchStream(file), { name : 'bucket-x' }, true, {
        name        : 'key.txt',
        contentType : 'text/plain'
      }).then(function() {
        sent.length.should.eql(1);
        sent[0].constructor.name.should.eql('PutObjectCommand');
        sent[0].input.Bucket.should.eql('bucket-x');
        sent[0].input.Key.should.eql('key.txt');
        sent[0].input.ContentType.should.eql('text/plain');
        should.exist(sent[0].input.Body);
      });
    });

    it('declares ContentLength for an fs-backed body, which v3 cannot infer', function() {
      var contents = 'hello storage',
          file     = scratchFile(contents);

      return FileUtil._upload(scratchStream(file), { name : 'b' }, true, {
        name        : 'k.txt',
        contentType : 'text/plain'
      }).then(function() {
        Object.keys(sent[0].input).sort()
          .should.eql(['Body', 'Bucket', 'ContentLength', 'ContentType', 'Key']);
        sent[0].input.ContentLength.should.eql(contents.length);
      });
    });

    it('omits ContentLength for a Buffer body, whose length the SDK reads itself', function() {
      return FileUtil._upload(Buffer.from('abc'), { name : 'b' }, true, {
        name        : 'k.png',
        contentType : 'image/png'
      }).then(function() {
        Object.keys(sent[0].input).sort().should.eql(['Body', 'Bucket', 'ContentType', 'Key']);
      });
    });

    it('rejects with the stat error and never reaches S3 when the path is unreadable', function() {
      var fake = new stream.PassThrough();

      // A stream carrying a `path` is what triggers the synchronous stat.
      fake.path = path.join(os.tmpdir(), 'blitzy-storage-definitely-absent-' + process.pid + '.txt');

      return FileUtil._upload(fake, { name : 'b' }, true, { name : 'k', contentType : 'text/plain' })
        .then(function() {
          throw new Error('_upload resolved for an unreadable body');
        }, function(err) {
          err.code.should.eql('ENOENT');
          sent.length.should.eql(0, 'a stat failure must short-circuit before send()');
        });
    });
  });

  // hashcontents — the sha1 that becomes every remote key

  describe('hashcontents', function() {
    it('resolves the sha1 hex digest of the file contents', function() {
      var contents = 'hello storage',
          file     = scratchFile(contents);

      return FileUtil.hashcontents(file).then(function(digest) {
        digest.should.eql(crypto.createHash('sha1').update(contents).digest('hex'));
        digest.should.have.length(40);
      });
    });
  });

  // _fileToContainer — key derivation, the extension whitelist, and both swallows

  describe('_fileToContainer', function() {
    it('names the object after the digest and the original extension', function() {
      var contents = 'hello storage',
          file     = scratchFile(contents),
          digest   = crypto.createHash('sha1').update(contents).digest('hex');

      return FileUtil._fileToContainer({
        headers  : { 'content-type' : 'text/plain' },
        filename : 'notes.TXT',
        path     : file,
        bytes    : contents.length
      }, { name : 'bucket-y', host : 'https://materials.example.com' }, true).then(function(result) {
        // The extension keeps its ORIGINAL case, which is part of the stored key.
        sent[0].input.Key.should.eql(digest + '.TXT');
        should.equal(result.err, null);
        result.results.should.eql({
          host : 'https://materials.example.com',
          path : digest + '.TXT',
          name : digest + '.TXT',
          hash : digest,
          size : contents.length
        });
        fs.existsSync(file).should.eql(false, 'the temporary upload must be unlinked');
      });
    });

    it('appends the container fileId and honours the extension whitelist', function() {
      var contents = 'abc',
          file     = scratchFile(contents, '.ipynb'),
          digest   = crypto.createHash('sha1').update(contents).digest('hex');

      // config/default.yaml maps ipynb -> text/plain, which OVERRIDES the sent content type.
      config.app.extensionWhitelist.ipynb.should.eql('text/plain');

      return FileUtil._fileToContainer({
        headers  : { 'content-type' : 'application/octet-stream' },
        filename : 'sheet.ipynb',
        path     : file,
        bytes    : contents.length
      }, { name : 'b', host : 'https://h', fileId : 'FID' }, true).then(function() {
        sent[0].input.Key.should.eql(digest + '-FID.ipynb');
        sent[0].input.ContentType.should.eql('text/plain');
      });
    });

    // PRESERVED QUIRK. A failed S3 write is reported to the caller as a SUCCESS: the error is logged and
    // swallowed, so `err` stays null and the result is the same object a successful write produces.
    // Propagating it would change the status lib/controllers/files.js returns.
    it('reports a failed S3 write as a success, with err null', function() {
      var contents = 'abc',
          file     = scratchFile(contents);

      behaviour = function() { return Promise.reject(new Error('S3 DOWN')); };

      return FileUtil._fileToContainer({
        headers  : { 'content-type' : 'text/plain' },
        filename : 'x.txt',
        path     : file,
        bytes    : contents.length
      }, { name : 'b', host : 'https://h' }, true).then(function(result) {
        should.equal(result.err, null, 'the upload failure must be swallowed');
        should.exist(result.results);
        result.results.hash.should.eql(crypto.createHash('sha1').update(contents).digest('hex'));
      });
    });

    // And the mirror image: a failed temporary-file REMOVAL is reported as a failure, with BOTH the error
    // and the results populated. lib/controllers/files.js reads `results` unconditionally after logging
    // the error, so a rejection here would become a TypeError - a 500 on a route that answers 200.
    it('reports a failed unlink with err AND results both populated', function() {
      var contents   = 'abc',
          file       = scratchFile(contents),
          unlinkStub = sinon.stub(fs.promises, 'unlink').callsFake(function() {
            var err = new Error('EBUSY: resource busy or locked');

            err.code = 'EBUSY';

            return Promise.reject(err);
          });

      return FileUtil._fileToContainer({
        headers  : { 'content-type' : 'text/plain' },
        filename : 'x.txt',
        path     : file,
        bytes    : contents.length
      }, { name : 'b', host : 'https://h' }, true).then(function(result) {
        unlinkStub.restore();
        should.exist(result.err, 'the unlink failure must reach the caller');
        result.err.code.should.eql('EBUSY');
        should.exist(result.results, 'the result object must survive the unlink failure');
        result.results.hash.should.eql(crypto.createHash('sha1').update(contents).digest('hex'));
      }, function(err) {
        unlinkStub.restore();

        throw err;
      });
    });
  });

  // downloadMaterialFile — the synchronous stream contract

  describe('downloadMaterialFile', function() {
    it('returns a stream SYNCHRONOUSLY and pipes the S3 body into it', function() {
      var release = null;

      behaviour = function() {
        return new Promise(function(resolve) { release = resolve; });
      };

      var result = FileUtil.downloadMaterialFile('remote.gif');

      // The contract lib/controllers/files.js#download depends on: NOT awaited, because a Promise handed
      // to h.response() is not a stream. The command must already have been issued.
      should.exist(result);
      result.pipe.should.be.a('function');
      sent.length.should.eql(1);
      sent[0].constructor.name.should.eql('GetObjectCommand');
      sent[0].input.Bucket.should.eql(config.aws.buckets.materials.name);
      sent[0].input.Key.should.eql('remote.gif');

      return new Promise(function(resolve, reject) {
        var chunks = [];

        result.on('data', function(chunk) { chunks.push(chunk); });
        result.on('error', reject);
        result.on('end', function() {
          Buffer.concat(chunks).toString().should.eql('PAYLOAD');
          resolve();
        });

        var body = new stream.PassThrough();

        body.end('PAYLOAD');
        release({ Body : body });
      });
    });

    /**
     * PRESERVED FATE. A failed S3 read does NOT surface on the returned stream.
     *
     * lib/util/file.js emits the error on the INNER PassThrough that is piped into the returned one, and
     * `pipe()` does not forward 'error'. With nothing listening on the inner stream the emit is unowned, so
     * the process takes the failure rather than the caller. Repairing it — an 'error' forwarder, or rejecting
     * instead — would be a prohibited behavior improvement.
     *
     * Pinning it requires care: an uncaught failure inside mocha would fail an unrelated test or kill the run.
     * The runner's own handlers are therefore detached for the duration of this one test and restored
     * unconditionally afterwards, so the fate is OBSERVED rather than suffered.
     */
    it('lets a failed S3 read escape as an uncaught exception, not on the returned stream', function() {
      var savedUncaught = process.listeners('uncaughtException'),
          savedRejection = process.listeners('unhandledRejection'),
          seen           = [],
          onStream       = [];

      process.removeAllListeners('uncaughtException');
      process.removeAllListeners('unhandledRejection');
      process.on('uncaughtException', function(err) { seen.push({ via : 'uncaughtException', err : err }); });
      process.on('unhandledRejection', function(err) { seen.push({ via : 'unhandledRejection', err : err }); });

      function restore() {
        process.removeAllListeners('uncaughtException');
        process.removeAllListeners('unhandledRejection');
        savedUncaught.forEach(function(listener) { process.on('uncaughtException', listener); });
        savedRejection.forEach(function(listener) { process.on('unhandledRejection', listener); });
      }

      behaviour = function() { return Promise.reject(new Error('NoSuchKey')); };

      var result = FileUtil.downloadMaterialFile('missing.gif');

      result.on('error', function(err) { onStream.push(err); });

      return new Promise(function(resolve) { setTimeout(resolve, 120); }).then(function() {
        restore();

        // The command WAS issued, and the stream was handed back synchronously all the same.
        sent.length.should.eql(1);
        sent[0].input.Key.should.eql('missing.gif');
        // The error never reaches the consumer's stream...
        onStream.should.eql([], 'the returned stream must not receive the error');
        // ...it escapes to the process, which is the documented fate.
        seen.length.should.eql(1, 'the failed read must escape to the process, unowned');
        // The emit throws inside the rejection handler, so the escape is an unhandled REJECTION, and Node's
        // default for one is to terminate the process.
        seen[0].via.should.eql('unhandledRejection');
        seen[0].err.message.should.eql('NoSuchKey');
      }, function(err) {
        restore();

        throw err;
      });
    });
  });

  // removeFile — promise-native, and its rejection must stay reachable

  describe('removeFile', function() {
    it('deletes the LAST path segment of the url from the named bucket', function() {
      return FileUtil.removeFile('snapshots', 'https://host/path/to/abc123.png').then(function() {
        sent.length.should.eql(1);
        sent[0].constructor.name.should.eql('DeleteObjectCommand');
        sent[0].input.Bucket.should.eql(config.aws.buckets.snapshots.name);
        // The KEY is the filename alone, never the whole url.
        sent[0].input.Key.should.eql('abc123.png');
      });
    });

    // lib/workers/util/snapshot.js RETURNS this promise from inside its own chain, so the delete failure
    // has to reject: swallowed, and snapshot removal reports success while the object survives in S3.
    it('rejects with the delete error, exactly once, when the delete fails', function() {
      var settlements = 0;

      behaviour = function() { return Promise.reject(new Error('AccessDenied')); };

      return FileUtil.removeFile('snapshots', 'https://host/x.png').then(function() {
        settlements += 1;

        throw new Error('removeFile resolved even though the delete failed');
      }, function(err) {
        settlements += 1;
        should.exist(err);
        err.message.should.eql('AccessDenied');
      }).then(function() {
        settlements.should.eql(1, 'the promise must settle exactly once');
      });
    });

    it('returns the S3 promise rather than a bridged callback', function() {
      // `remove` takes no callback: a caller that ignores the result ignores a promise, and the delete is
      // issued either way.
      var pending = FileUtil.removeFile('snapshots', 'https://host/a/b/c.png');

      pending.should.be.an.instanceOf(Promise);

      return pending.then(function() {
        sent.length.should.eql(1);
        sent[0].input.Key.should.eql('c.png');
      });
    });

    it('takes exactly the two parameters its callers pass', function() {
      FileUtil.removeFile.length.should.eql(2);
    });
  });

  // The remaining read and write paths

  describe('uploadSnapshotFromBuffer', function() {
    it('writes the buffer to the snapshots bucket as image/png with no ContentLength', function() {
      return FileUtil.uploadSnapshotFromBuffer('snap.png', Buffer.from('PNGDATA')).then(function() {
        sent[0].constructor.name.should.eql('PutObjectCommand');
        Object.keys(sent[0].input).sort().should.eql(['Body', 'Bucket', 'ContentType', 'Key']);
        sent[0].input.Bucket.should.eql(config.aws.buckets.snapshots.name);
        sent[0].input.Key.should.eql('snap.png');
        sent[0].input.ContentType.should.eql('image/png');
      });
    });

    it('rejects with the send failure, which its caller in trinket.js chains on', function() {
      behaviour = function() { return Promise.reject(new Error('SlowDown')); };

      return FileUtil.uploadSnapshotFromBuffer('snap.png', Buffer.from('PNGDATA')).then(function() {
        throw new Error('uploadSnapshotFromBuffer resolved even though the send failed');
      }, function(err) {
        should.exist(err);
        err.message.should.eql('SlowDown');
      });
    });

    it('takes exactly the two parameters its caller passes', function() {
      FileUtil.uploadSnapshotFromBuffer.length.should.eql(2);
    });
  });

  describe('downloadUserAsset', function() {
    it('reads from the user-assets bucket and resolves a real Buffer', function() {
      behaviour = function() {
        return Promise.resolve({
          Body : {
            transformToByteArray : function() {
              return Promise.resolve(new Uint8Array([1, 2, 3]));
            }
          }
        });
      };

      return FileUtil.downloadUserAsset('userasset.png').then(function(buffer) {
        // Buffer.isBuffer is the contract the three callers in lib/controllers/trinket.js rely on; a bare
        // Uint8Array would satisfy neither .toString('base64') nor a length check the same way.
        Buffer.isBuffer(buffer).should.eql(true);
        Array.from(buffer).should.eql([1, 2, 3]);
        sent[0].constructor.name.should.eql('GetObjectCommand');
        sent[0].input.Bucket.should.eql(config.aws.buckets.userassets.name);
        sent[0].input.Key.should.eql('userasset.png');
      });
    });

    it('propagates a read failure as a rejection', function() {
      behaviour = function() { return Promise.reject(new Error('NoSuchKey')); };

      return FileUtil.downloadUserAsset('missing.png').then(function() {
        throw new Error('downloadUserAsset resolved for a missing key');
      }, function(err) {
        err.message.should.eql('NoSuchKey');
      });
    });
  });

  describe('uploadUserAsset', function() {
    it('short-circuits before S3 when the document save fails', function() {
      var saveError = new Error('duplicate key'),
          file      = scratchFile('asset bytes'),
          document  = {
            id      : 'DOCID',
            setOwner : function() { return undefined; },
            save     : function() { return Promise.reject(saveError); }
          };

      return FileUtil.uploadUserAsset({
        headers  : { 'content-type' : 'image/png' },
        filename : 'pic.png',
        path     : file,
        bytes    : 11
      }, { id : 'USERID' }, document).then(function() {
        throw new Error('uploadUserAsset resolved despite a failed save');
      }, function(err) {
        err.should.equal(saveError);
        sent.length.should.eql(0, 'a save failure must never reach S3');
      });
    });

    it('derives the remote name from the digest, the document id and the extension', function() {
      var contents = 'asset bytes',
          file     = scratchFile(contents, '.png'),
          digest   = crypto.createHash('sha1').update(contents).digest('hex'),
          document = {
            id       : 'DOCID',
            setOwner : sinon.spy(),
            save     : function() { return Promise.resolve(this); }
          };

      return FileUtil.uploadUserAsset({
        headers  : { 'content-type' : 'image/png' },
        filename : 'pic.png',
        path     : file,
        bytes    : contents.length
      }, { id : 'USERID' }, document).then(function(saved) {
        var remoteName = digest + '-DOCID.png';

        saved.should.equal(document);
        document.name.should.eql('pic.png');
        document.type.should.eql('embed');
        document.mime.should.eql('image/png');
        document.hash.should.eql(digest);
        document.size.should.eql(contents.length);
        document.url.should.eql(config.aws.buckets.userassets.host + '/' + remoteName);
        document.setOwner.calledOnce.should.be.true;

        sent.length.should.eql(1);
        sent[0].constructor.name.should.eql('PutObjectCommand');
        sent[0].input.Bucket.should.eql(config.aws.buckets.userassets.name);
        sent[0].input.Key.should.eql(remoteName);
        sent[0].input.ContentType.should.eql('image/png');
      });
    });
  });
});

/**
 * `config/aws.js` itself: the client lifecycle and the delegated presigner.
 *
 * Presigning is `@aws-sdk/s3-request-presigner`'s, not this repository's, so the presigning tests below pin
 * two things: the URL shape callers depend on — origin, path encoding and expiry — and the fact that no
 * signing is implemented here.
 *
 * These tests deliberately do NOT stub getS3Client - they are about it. The presigning tests inject
 * credentials through the environment for their duration, because the shipped configuration leaves
 * `aws.keyId`/`aws.key` empty so the default provider chain would find nothing to sign with. The shared
 * client is destroyed before and after, which is safe by design (destroy clears the slot first, so the
 * next getS3Client() builds a fresh one) and is what makes the injected credentials take effect.
 */
describe('config/aws.js', function() {
  describe('the shared client lifecycle', function() {
    after(function() {
      // Leave the process without a client rather than with this suite's; the next caller rebuilds one.
      aws.destroyS3Client();
    });

    it('hands back one shared client rather than building one per call', function() {
      var first  = aws.getS3Client(),
          second = aws.getS3Client();

      // v2 kept a single process-global socket pool; v3 clients own their own, so a per-call client
      // would leak one pool per operation. This is that measurement, pinned.
      first.should.equal(second);
    });

    it('is safe to destroy twice, and rebuilds on the next call', function() {
      var original = aws.getS3Client();

      aws.destroyS3Client();
      aws.destroyS3Client();

      aws.getS3Client().should.not.equal(original);
    });

    it('is safe to destroy when nothing was ever built', function() {
      aws.destroyS3Client();
      aws.destroyS3Client();

      should.equal(aws.destroyS3Client(), undefined);
    });

    it('exports the three command classes the application issues, and no SDK namespace', function() {
      Object.keys(aws).sort().should.eql([
        'DeleteObjectCommand', 'GetObjectCommand', 'PutObjectCommand',
        'destroyS3Client', 'getS3Client', 'getSignedDownloadUrl'
      ]);
      aws.GetObjectCommand.name.should.eql('GetObjectCommand');
      aws.PutObjectCommand.name.should.eql('PutObjectCommand');
      aws.DeleteObjectCommand.name.should.eql('DeleteObjectCommand');
    });
  });

  describe('getSignedDownloadUrl', function() {
    var savedKeyId  = null,
        savedSecret = null;

    before(function() {
      savedKeyId  = process.env.AWS_ACCESS_KEY_ID;
      savedSecret = process.env.AWS_SECRET_ACCESS_KEY;
      process.env.AWS_ACCESS_KEY_ID     = 'AKIAPROBEKEY000000';
      process.env.AWS_SECRET_ACCESS_KEY = 'probeSecret0000000000000000000000000000';
      aws.destroyS3Client();
    });

    after(function() {
      if (savedKeyId === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      }
      else {
        process.env.AWS_ACCESS_KEY_ID = savedKeyId;
      }

      if (savedSecret === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      }
      else {
        process.env.AWS_SECRET_ACCESS_KEY = savedSecret;
      }

      aws.destroyS3Client();
    });

    it('signs a virtual-hosted URL with the SigV4 query parameters v2 sent', function() {
      return aws.getSignedDownloadUrl({ Bucket : 'my-bucket', Key : 'folder/a b+c(1)!.png' }, 900)
        .then(function(url) {
          var parsed = new URL(url);

          parsed.protocol.should.eql('https:');
          parsed.host.should.eql('my-bucket.s3.' + config.aws.region + '.amazonaws.com');

          // AWS canonical encoding: space -> %20 (never +), and the five characters
          // encodeURIComponent leaves alone are escaped too. Getting this wrong produces a
          // syntactically valid URL whose signature S3 silently rejects.
          parsed.pathname.should.eql('/folder/a%20b%2Bc%281%29%21.png');

          parsed.searchParams.get('X-Amz-Algorithm').should.eql('AWS4-HMAC-SHA256');
          parsed.searchParams.get('X-Amz-Content-Sha256').should.eql('UNSIGNED-PAYLOAD');
          parsed.searchParams.get('X-Amz-SignedHeaders').should.eql('host');
          parsed.searchParams.get('X-Amz-Expires').should.eql('900');
          parsed.searchParams.get('X-Amz-Signature').should.match(/^[0-9a-f]{64}$/);
          parsed.searchParams.get('X-Amz-Credential')
            .should.contain('/' + config.aws.region + '/s3/aws4_request');
        });
    });

    it('carries the two operation-metadata parameters the official presigner adds', function() {
      // THE SIGNED QUERY SET IS THE OFFICIAL PRESIGNER'S. `@aws-sdk/s3-request-presigner` hoists
      // `x-id=GetObject` and `x-amz-checksum-mode=ENABLED` into the query and signs them alongside the
      // X-Amz-* keys, so both the parameter set and the digest are its own. config/aws.js delegates to it
      // rather than hand-rolling a signature through `@internal` SDK members, which carry no semver signal.
      // The URL is not part of the parity corpus — the asset feature is flag-disabled in the shipped
      // configuration — so it is pinned HERE, where a regression to a hand-rolled signer fails rather than
      // passing quietly.
      return aws.getSignedDownloadUrl({ Bucket : 'my-bucket', Key : 'k.png' }, 900).then(function(url) {
        var parsed = new URL(url);

        Array.from(parsed.searchParams.keys()).sort().should.eql([
          'X-Amz-Algorithm', 'X-Amz-Content-Sha256', 'X-Amz-Credential', 'X-Amz-Date',
          'X-Amz-Expires', 'X-Amz-Signature', 'X-Amz-SignedHeaders',
          'x-amz-checksum-mode', 'x-id'
        ]);
        parsed.searchParams.get('x-id').should.eql('GetObject');
        parsed.searchParams.get('x-amz-checksum-mode').should.eql('ENABLED');
      });
    });

    it('implements no signing of its own, and delegates to the supported package', function() {
      // The checkpoint rule this closes: no custom request signing, and no dependency on an @internal
      // SDK member. Asserted against the module SOURCE because the absence of a code path cannot be
      // asserted against its behavior.
      var source = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'config', 'aws.js'), 'utf8');

      // Comments are stripped before the negative assertions, because the module's own docblock NAMES
      // the three retired `@internal` members in order to explain why they were retired. A substring
      // test over the raw file would fail on the documentation rather than on the code. There is no
      // string literal in this module containing `//`, so the crude line-comment rule is exact here.
      var code = source.replace(/\/\*[\s\S]*?\*\//g, '')
                       .split('\n')
                       .map(function(line) { return line.replace(/\/\/.*$/, ''); })
                       .join('\n');

      source.should.contain("require('@aws-sdk/s3-request-presigner')");
      code.should.contain('presigner.getSignedUrl(');
      code.should.not.contain('endpointProvider(');
      code.should.not.contain('config.signer()');
      code.should.not.contain('.presign(');
      code.should.not.contain('createHmac');
      // And the package is a declared dependency at an exact version, not a transitive accident.
      require('../../../package.json').dependencies
        .should.have.property('@aws-sdk/s3-request-presigner', '3.1098.0');
    });

    it('honours the caller expiry rather than a fixed one', function() {
      return aws.getSignedDownloadUrl({ Bucket : 'my-bucket', Key : 'k.png' }, 60).then(function(url) {
        new URL(url).searchParams.get('X-Amz-Expires').should.eql('60');
      });
    });

    it('falls back to path-style addressing for a bucket name containing dots', function() {
      // A dotted bucket is not DNS-compatible for virtual hosting, and the SDK's own endpoint provider is
      // what decides that - which is exactly why config/aws.js asks it rather than guessing.
      return aws.getSignedDownloadUrl({ Bucket : 'dotted.bucket.name', Key : 'k.png' }, 60)
        .then(function(url) {
          url.split('?')[0]
            .should.eql('https://s3.' + config.aws.region + '.amazonaws.com/dotted.bucket.name/k.png');
        });
    });
  });
});
