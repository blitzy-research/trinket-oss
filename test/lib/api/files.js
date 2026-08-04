var sinon    = require('sinon'),
    should   = require('chai').should(),
    stream   = require('stream'),
    config   = require('config'),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults'),
    FileUtil = require('../../../lib/util/file'),
    files    = require('../../../lib/controllers/files');

module.exports = function() {
  describe('Files', function() {
    var fileId, ipynbId;

    describe('As a logged out user', function() {
      before(function(done) {
        flow.switchUser('');
        done();
      });

      describe('When I upload a file', function() {
        before(function(done) {
          flow.uploadFile(function() {
            done();
          });
        });

        it('should redirect me to the login page', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(302);
          flow.lastResponse.redirect.should.be.true;
          flow.lastRedirect.pathname.should.eql('/login');

          done();
        });
      });
    });

    describe('As a logged in user', function() {
      before(function(done) {
        flow.switchUser('user', done);
      });

      describe('When I upload a file', function() {
        before(function(done) {
          flow.uploadFile(function() {
            done();
          });
        });

        // R-6 ADJUDICATION, MEASURED - see docs/PRESERVED-QUIRKS.md. `POST /file` declares no
        // `multipart` payload option (byte-identical at the base commit) so hapi rejects the
        // `multipart/form-data` this helper sends before the handler runs. Verified against an isolated
        // install of the BASE lockfile's @hapi/hapi 20.3.0 + @hapi/subtext 7.1.0: 415 there too, so the
        // status is INHERITED. Adding `multipart : true` would be the improvement R-4 forbids and a TR2
        // status change. `fileId` therefore stays undefined, which the download suites below assert.
        it('should reject the multipart upload as an unsupported media type', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(415);
          flow.lastContentType.should.contain('application/json');
          flow.lastResponse.body.should.have.property('statusCode', 415);
          flow.lastResponse.body.should.have.property('error', 'Unsupported Media Type');
          should.not.exist(flow.lastResponse.body.id);

          done();
        });
      });

      describe('When I upload an ipython notebook', function() {
        before(function(done) {
          flow.uploadIpynb(function() {
            done();
          });
        });

        // R-6 ADJUDICATION - the same inherited 415 as the gif upload above, so `ipynbId` also stays
        // undefined. See the annotated twin above.
        it('should reject the multipart upload as an unsupported media type', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(415);
          flow.lastContentType.should.contain('application/json');
          flow.lastResponse.body.should.have.property('statusCode', 415);
          should.not.exist(flow.lastResponse.body.id);

          done();
        });
      });
    });

    describe('When accessing an uploaded file', function() {
      before(function(done) {
        flow.downloadFile(fileId, function() {
          done();
        });
      });

      // R-6 ADJUDICATION, MEASURED - see docs/PRESERVED-QUIRKS.md. `fileId` is never assigned because the
      // upload answers the inherited 415 above, so the `before` hook requests
      // `GET /api/files/undefined/download` and gets 404 with no content-disposition - at both commits.
      it('should answer 404 because the upload never produced a file', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(404);
        should.not.exist(flow.lastResponse.headers['content-disposition']);
        flow.lastContentType.should.contain('application/json');
      });
    });

    describe('When accessing an ipython notebook file', function() {
      before(function(done) {
        flow.downloadFile(ipynbId, function() {
          done();
        });
      });

      // R-6 ADJUDICATION - the same inherited 404 as the gif download above. See the twin above.
      it('should answer 404 because the upload never produced a file', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(404);
        should.not.exist(flow.lastResponse.headers['content-disposition']);
        flow.lastContentType.should.contain('application/json');
      });
    });

    /**
     * THE SUCCESSFUL FILE-STORAGE PATH, RESTORED ADDITIVELY (review finding M-27).
     *
     * The four adjudications above are correct and stay exactly as they are: `POST /file` really does
     * answer an inherited 415 to the multipart body test/helpers/flow.js sends, and the two download
     * suites really do request `/api/files/undefined/download`. But encoding only those outcomes cost
     * this file its entire success coverage - the response payload contract, the persisted File document,
     * and the two attachment downloads - which is the largest single assertion loss the review found.
     *
     * Everything the removed assertions reached for is restored here, and more, WITHOUT changing a line
     * of production code:
     *
     *   - the upload PAYLOAD contract and the persisted DOCUMENT are proven by invoking
     *     lib/controllers/files.js#upload directly with the real File model and the real path/slug/mime
     *     derivation, stubbing only the S3 write. That is the one seam that has to be stubbed: the
     *     configured bucket is the placeholder `your-materials-bucket` and there is no S3 to write to.
     *   - the DOWNLOAD contract is proven over real HTTP against the real route, the real `file`
     *     pre-handler and the real response contract, with a File document this block creates and only
     *     the S3 read stubbed.
     *
     * Every expectation below was MEASURED first (R-6), not predicted.
     */
    describe('The successful file-storage path (restored additively)', function() {
      var owner       = null,
          created     = [],
          assetsFlag  = null,
          uploadStub  = null,
          streamStub  = null;

      /** The storage result lib/util/file.js#uploadMaterialFile resolves on a successful write. */
      var STORAGE_RESULT = {
        host : 'https://materials.example.com',
        path : 'ab/cd/deadbeefhash.gif',
        hash : 'deadbeefhash',
        size : 4321
      };

      before(function(done) {
        this.timeout(60000);

        flow.switchUser('user', function(err) {
          if (err) {
            return done(err);
          }

          // `File#setOwner` is what satisfies the model's required `_owner`, and without a real owner
          // `file.save()` rejects - which lib/controllers/files.js SWALLOWS, so the handler would answer
          // 200 with an id that was never persisted. Measured: File.findById then resolves null. Using a
          // real owner is therefore what makes the persistence assertions below mean anything.
          return User.findByLogin(defaults.user.email, function(lookupErr, doc) {
            if (lookupErr) {
              return done(lookupErr);
            }

            owner = doc;
            should.exist(owner, 'the shared test user must exist for this block to prove anything');

            return done();
          });
        });
      });

      beforeEach(function() {
        assetsFlag = config.features.assets;
      });

      afterEach(function() {
        // Restored in afterEach rather than after the assertions, so a failing expectation cannot leak a
        // stubbed storage layer - or an enabled feature flag - into the suites that run after this one.
        config.features.assets = assetsFlag;

        if (uploadStub) {
          uploadStub.restore();
          uploadStub = null;
        }

        if (streamStub) {
          streamStub.restore();
          streamStub = null;
        }
      });

      after(function(done) {
        this.timeout(60000);

        // Every document this block created is removed, whatever happened above.
        Promise.all(created.map(function(doc) {
          return doc.remove().catch(function() { return undefined; });
        })).then(function() {
          created = [];
          done();
        }, done);
      });

      /** Invokes the real handler with a synthetic upload, capturing what it hands the responder. */
      function invokeUpload(contentType, filename, type) {
        var captured = null,
            payload  = { upload : { headers : { 'content-type' : contentType }, filename : filename } };

        if (type !== undefined) {
          payload.type = type;
        }

        return Promise.resolve(files.upload({ payload : payload, user : owner }, {
          respond : function(json) {
            captured = json;

            return json;
          }
        })).then(function() {
          return captured;
        });
      }

      /** Records a File document for cleanup and returns it. */
      function track(doc) {
        created.push(doc);

        return doc;
      }

      // ---------------------------------------------------------------------------------------
      // POST /file with a body hapi WILL parse - the other half of the 415 adjudication
      // ---------------------------------------------------------------------------------------

      // MEASURED. The 415 above is what a multipart body gets. A body hapi does parse takes a different
      // route entirely: `POST /file` declares `payload : { output : 'file' }` (config/routes.js:337-350),
      // so hapi writes the raw body to a temp file and hands the handler `{ path, bytes }` - which the
      // route's own Joi schema rejects, because `upload` is required and neither `path` nor `bytes` is
      // allowed. The failure responder then answers HTTP 200 carrying the validation flash, because it is
      // never given a status (the preserved no-status failure responder). Pinning this proves the
      // validation contract of the route AND that the 415 above really is a parser-level rejection rather
      // than the same validation failure wearing a different status.
      it('answers 200 with the validation flash for a body hapi parses', function(done) {
        this.timeout(30000);

        flow.post('/file').send({ type : 'download' }).redirects(0).end(function(err, response) {
          if (err) { return done(err); }

          try {
            response.statusCode.should.eql(200);
            String(response.headers['content-type']).should.contain('application/json');
            response.body.should.have.nested.property('flash.validation.upload', '"upload" is required');
            response.body.should.have.nested.property('flash.validation.path', '"path" is not allowed');
            response.body.should.have.nested.property('flash.validation.bytes', '"bytes" is not allowed');
            should.not.exist(response.body.id);
          }
          catch (assertion) { return done(assertion); }

          return done();
        });
      });

      // ---------------------------------------------------------------------------------------
      // The upload payload contract and the persisted document
      // ---------------------------------------------------------------------------------------

      it('answers the full payload contract for an image upload', function() {
        this.timeout(30000);

        config.features.assets = true;
        uploadStub = sinon.stub(FileUtil, 'uploadMaterialFile')
          .callsFake(function() { return Promise.resolve({ err : null, results : STORAGE_RESULT }); });

        return invokeUpload('image/gif', 'transparent.gif').then(function(payload) {
          should.exist(payload, 'the handler must hand the responder a payload');

          // The seven keys the handler builds, in the shape POST /file answers. The removed assertions
          // checked three of them; all seven are pinned here.
          Object.keys(payload).sort().should.eql(['host', 'id', 'mime', 'name', 'path', 'size', 'type']);
          payload.path.should.eql('/api/files/' + payload.id + '/transparent.gif');
          payload.type.should.eql('embed', 'an image/* upload with no explicit type derives "embed"');
          payload.mime.should.eql('image/gif');
          payload.name.should.eql('transparent.gif');
          payload.size.should.eql(STORAGE_RESULT.size);
          payload.host.should.eql(config.app.url.hostname);
          FileUtil.uploadMaterialFile.calledOnce.should.be.true;

          return File.findById(payload.id).then(function(doc) {
            // The removed assertion this replaces was `should.exist(file)` plus a mime comparison.
            should.exist(doc, 'the File document must actually be persisted');
            track(doc);
            doc.url.should.eql(STORAGE_RESULT.host + '/' + STORAGE_RESULT.path);
            doc.mime.should.eql(payload.mime);
            doc.type.should.eql(payload.type);
            doc.name.should.eql(payload.name);
            doc.hash.should.eql(STORAGE_RESULT.hash);
            doc.size.should.eql(STORAGE_RESULT.size);
            String(doc._owner).should.eql(String(owner.id));
          });
        });
      });

      it('derives type download and the sent content type for a notebook upload', function() {
        this.timeout(30000);

        config.features.assets = true;
        uploadStub = sinon.stub(FileUtil, 'uploadMaterialFile')
          .callsFake(function() { return Promise.resolve({ err : null, results : STORAGE_RESULT }); });

        return invokeUpload('text/plain', 'test.ipynb').then(function(payload) {
          should.exist(payload);
          payload.type.should.eql('download', 'a non-image upload with no explicit type derives "download"');
          payload.mime.should.eql('text/plain');
          payload.path.should.eql('/api/files/' + payload.id + '/test.ipynb');

          return File.findById(payload.id).then(function(doc) {
            should.exist(doc);
            track(doc);
            doc.mime.should.eql('text/plain');
            doc.type.should.eql('download');
            doc.name.should.eql('test.ipynb');
          });
        });
      });

      it('honours an explicit type instead of deriving one', function() {
        this.timeout(30000);

        config.features.assets = true;
        uploadStub = sinon.stub(FileUtil, 'uploadMaterialFile')
          .callsFake(function() { return Promise.resolve({ err : null, results : STORAGE_RESULT }); });

        return invokeUpload('image/gif', 'transparent.gif', 'download').then(function(payload) {
          payload.type.should.eql('download');

          return File.findById(payload.id).then(function(doc) {
            should.exist(doc);
            track(doc);
            doc.type.should.eql('download');
          });
        });
      });

      // The first branch of the handler, which nothing else covers. `config.features.assets` is false in
      // the shipped configuration (config/default.yaml:3), so this is the answer a real deployment gives
      // until assets are switched on - and it is returned rather than thrown deliberately, so hapi honours
      // the 501 instead of the centralized error map turning it into a 500.
      it('answers 501 with its own message while the asset feature is disabled', function() {
        config.features.assets = false;
        uploadStub = sinon.stub(FileUtil, 'uploadMaterialFile')
          .callsFake(function() { return Promise.reject(new Error('storage must not be reached')); });

        return invokeUpload('image/gif', 'transparent.gif').then(function(payload) {
          should.not.exist(payload, 'the responder must never be reached');
          FileUtil.uploadMaterialFile.called.should.be.false;
        }, function(err) {
          // A rejection would mean the flag branch did not short-circuit.
          throw err;
        });
      });

      it('returns the 501 Boom rather than throwing it', function() {
        config.features.assets = false;

        return Promise.resolve(files.upload({ payload : {}, user : owner }, {
          respond : function() { throw new Error('the responder must never be reached'); }
        })).then(function(answer) {
          should.exist(answer);
          answer.isBoom.should.be.true;
          answer.output.statusCode.should.eql(501);
          answer.message.should.eql('File uploads are not enabled');
        });
      });

      // ---------------------------------------------------------------------------------------
      // GET /api/files/{fileId}/{fileName} over real HTTP, for a file that exists
      // ---------------------------------------------------------------------------------------

      /** Creates and saves a real File document owned by the shared test user. */
      function storedFile(attributes) {
        var doc = new File(attributes);

        doc.setOwner(owner);

        return doc.save().then(function() {
          return track(doc);
        });
      }

      it('streams an image back as an attachment with its own content type', function(done) {
        this.timeout(30000);

        var bytes = 'GIF89a-BYTES';

        streamStub = sinon.stub(FileUtil, 'downloadMaterialFile').callsFake(function() {
          var passThrough = new stream.PassThrough();

          passThrough.end(bytes);

          return passThrough;
        });

        storedFile({
          url  : STORAGE_RESULT.host + '/' + STORAGE_RESULT.path,
          type : 'download',
          name : 'transparent.gif',
          mime : 'image/gif',
          hash : STORAGE_RESULT.hash,
          size : bytes.length
        }).then(function(doc) {
          flow.downloadFile(doc.id, function() {
            try {
              // The two assertions the removed test made, restored verbatim in intent.
              flow.wasOk.should.be.true;
              flow.lastResponse.statusCode.should.eql(200);
              flow.lastResponse.headers['content-disposition']
                .should.eql('attachment; filename=transparent.gif');
              flow.lastContentType.should.contain('image/gif');
              // And more than it made: `.bytes()` is what sets this, so it proves the size the document
              // records is what the response advertises.
              flow.lastResponse.headers['content-length'].should.eql(String(bytes.length));
              // The stored url's LAST SEGMENT is the S3 key the handler asks for, not the whole url.
              FileUtil.downloadMaterialFile.calledOnce.should.be.true;
              FileUtil.downloadMaterialFile.firstCall.args.should.eql(['deadbeefhash.gif']);
            }
            catch (assertion) { return done(assertion); }

            return done();
          });
        }, done);
      });

      it('streams a notebook back as an attachment with its own content type', function(done) {
        this.timeout(30000);

        var bytes = 'NOTEBOOK';

        streamStub = sinon.stub(FileUtil, 'downloadMaterialFile').callsFake(function() {
          var passThrough = new stream.PassThrough();

          passThrough.end(bytes);

          return passThrough;
        });

        storedFile({
          url  : STORAGE_RESULT.host + '/ef/gh/notebookhash.ipynb',
          type : 'download',
          name : 'test.ipynb',
          mime : 'text/plain',
          hash : 'notebookhash',
          size : bytes.length
        }).then(function(doc) {
          flow.downloadFile(doc.id, function() {
            try {
              flow.wasOk.should.be.true;
              flow.lastResponse.statusCode.should.eql(200);
              flow.lastResponse.headers['content-disposition']
                .should.eql('attachment; filename=test.ipynb');
              flow.lastContentType.should.contain('text/plain');
              // A text body IS buffered by supertest, so the streamed bytes are asserted directly here -
              // which proves the PassThrough really reached the client rather than merely being returned.
              flow.lastResponse.text.should.eql(bytes);
              FileUtil.downloadMaterialFile.firstCall.args.should.eql(['notebookhash.ipynb']);
            }
            catch (assertion) { return done(assertion); }

            return done();
          });
        }, done);
      });

      it('answers 404 for a well-formed id that matches no document', function(done) {
        this.timeout(30000);

        streamStub = sinon.stub(FileUtil, 'downloadMaterialFile').callsFake(function() {
          throw new Error('storage must not be reached for a missing document');
        });

        // The `file` pre-handler resolves a missing document to Boom.notFound, so the handler - and
        // therefore storage - is never reached. This is the same 404 the adjudicated suites above see,
        // asserted here against a VALID ObjectId so it cannot be confused with a cast failure.
        flow.downloadFile('6a0000000000000000000000', function() {
          try {
            flow.lastResponse.statusCode.should.eql(404);
            should.not.exist(flow.lastResponse.headers['content-disposition']);
            FileUtil.downloadMaterialFile.called.should.be.false;
          }
          catch (assertion) { return done(assertion); }

          return done();
        });
      });
    });
  });
}
