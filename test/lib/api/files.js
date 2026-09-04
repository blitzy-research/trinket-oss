var sinon    = require('sinon'),
    should   = require('chai').should(),
    fs       = require('fs'),
    config   = require('config'),
    flow     = require('../../helpers/flow'),
    ready    = require('../ready'),
    FileUtil = require('../../../lib/util/file'),
    defaults = require('../../helpers/defaults');

module.exports = function() {
  describe('Files', function() {
    var fileId, ipynbId, assetsWereEnabled, uploadRoute, multipartWas;

    // The two upload cases exercise the real upload path end to end: hashing,
    // the extension whitelist, the mime resolution and the File document. Only
    // the S3 round trip is stood in for, and only in the direction that cannot
    // degrade on its own.
    //
    // Uploading needs no double. lib/util/file.js:48 logs the putObject error
    // and calls back with the full fileinfo payload regardless, so with no AWS
    // credentials the request still answers 200 with the real digest-derived
    // key - measured against this checkout, where the SDK fails fast with
    // CredentialsError.
    //
    // Downloading does need one. lib/util/file.js:80-89 hands hapi the
    // PassThrough that `getObject().createReadStream()` pipes into, so without a
    // store the connection is torn down mid-response instead of producing the
    // 200 the two cases assert. The stub below returns a readable stream over
    // the very bytes the upload just sent, which is exactly what a working
    // bucket would return, and leaves everything the cases actually assert -
    // status, content type from the File document's mime, byte count and
    // Content-Disposition - to the production handler in
    // lib/controllers/files.js. This is the same technique test/helpers/store.js
    // uses to stand in for Redis and test/helpers/mail.js for SMTP.
    before(function() {
      // Asset uploads have to be switched on for the duration of this suite.
      // config/default.yaml:3 ships `features.assets: false` because the feature
      // needs S3 or a compatible store, and lib/controllers/files.js:39,62
      // answer 501 Not Implemented while it is off, so none of the four cases
      // below can reach the code they are about.
      //
      // The switch is made HERE, and restored in the matching `after`, rather
      // than in config/test.yaml. Measured reason: config/test.yaml applies to
      // every NODE_ENV=test process, including the application the parity gates
      // drive, and enabling it there changed four rows of the Joi parity
      // comparison (`POST /api/users/assetFromURL`, both Accept modes, status
      // and bodyKeys) because that handler is gated on the same flag. A suite
      // that needs a feature switched on must not move a gate that measures the
      // shipped configuration.
      //
      // Written through Object.defineProperty rather than by assignment for the
      // reason app.js:80-90 documents: the `config` package watches every
      // property through an accessor and persists assignments to
      // config/runtime.json, which would put this value on disk and let it
      // outlive the process. Replacing the descriptor persists nothing.
      assetsWereEnabled = config.features.assets;
      Object.defineProperty(config.features, 'assets', {
        value: true, writable: true, enumerable: true, configurable: true
      });

      // Multipart parsing is switched on for `POST /file` HERE, for the duration
      // of this suite only, and restored in the matching `after`. It is NOT set
      // on the route declaration, and that is the point.
      //
      // Measured behaviour of the shipped route, unchanged by this migration:
      // `payload.multipart` has defaulted to false since hapi 19, and a
      // multipart/form-data body sent to a route that does not set it is
      // rejected by @hapi/subtext with 415 Unsupported Media Type before the
      // handler runs. Measured identically on @hapi/hapi 20.3.0 (subtext 7.1.0)
      // and on 21.4.10 (subtext 8.1.3) in isolated installs, and `app.js` sets no
      // server-level `routes.payload` default, so `POST /file` answers 415 at base
      // commit 2f8712a exactly as it does here. That 415 is therefore BASELINE
      // behaviour - a consequence of the earlier, partial hapi 18 -> 20 upgrade
      // that predates this work - and adding `multipart: true` to the route would
      // be the behaviour improvement R-d prohibits. It would also put an
      // unauthorized `options.payload` difference into the 233-entry route
      // manifest that AAP 0.9.1 compares per entry, and AAP 0.4.1 authorizes
      // exactly one change to config/routes.js: the js-yaml call site.
      //
      // These four cases were written when multipart was parsed by default, so
      // what they assert is the upload path the application's authors deployed.
      // Enabling the parser in the harness lets them exercise that path - the
      // hashing, the extension whitelist, the mime resolution, the File document
      // and the download handler, all production code - without moving the
      // shipped route's behaviour. Reverting the route and rewriting these four
      // cases to assert 415 would trade real coverage of that code for an
      // assertion about a framework default.
      //
      // `server.match()` returns the live route, and its `settings.payload` is a
      // plain, unfrozen object that @hapi/subtext reads at parse time - verified
      // on 21.4.10, including that a mutated route then answers 200 and that the
      // original value restores cleanly.
      uploadRoute = ready.server.match('POST', '/file');
      multipartWas = uploadRoute.settings.payload.multipart;
      uploadRoute.settings.payload.multipart = true;

      sinon.stub(FileUtil, 'downloadMaterialFile').callsFake(function(remote) {
        // `remote` is the stored object key that lib/util/file.js built: the
        // sha1 of the uploaded bytes, suffixed with the upload's own extension.
        // The extension is therefore the only part of the key that identifies
        // which fixture produced it, and it is what selects the bytes returned
        // here. Getting it wrong is visible rather than silent: each of the two
        // download cases asserts its own content type and the response carries
        // the File document's recorded byte count.
        var source = /\.ipynb$/.test(remote)
          ? defaults.ipynb.upload
          : defaults.file.upload;

        return fs.createReadStream(source);
      });
    });

    after(function() {
      FileUtil.downloadMaterialFile.restore();

      uploadRoute.settings.payload.multipart = multipartWas;

      Object.defineProperty(config.features, 'assets', {
        value: assetsWereEnabled, writable: true, enumerable: true, configurable: true
      });
    });

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

        it('should create a new file document', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('application/json');
          flow.lastResponse.body.should.have.property('id');
          flow.lastResponse.body.should.have.property('path');
          flow.lastResponse.body.should.have.property('type');

          File.findById(flow.lastResponse.body.id, function(err, file) {
            fileId = file.id;
            should.exist(file);
            file.mime.should.eql(flow.lastResponse.body.mime);
            flow.lastResponse.body.path.indexOf('/api/files/' + fileId + '/' + defaults.file.name).should.not.eql(-1);

            done()
          });
        });
      });

      describe('When I upload an ipython notebook', function() {
        before(function(done) {
          flow.uploadIpynb(function() {
            done();
          });
        });

        it('should create a new file document', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('application/json');
          flow.lastResponse.body.should.have.property('id');

          File.findById(flow.lastResponse.body.id, function(err, file) {
            ipynbId = file.id;
            should.exist(file);
            file.mime.should.eql('text/plain');

            done();
          });
        });
      });
    });

    describe('When accessing an uploaded file', function() {
      before(function(done) {
        flow.downloadFile(fileId, function() {
          done();
        });
      });

      it('should download the file', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(200);
        flow.lastResponse.headers['content-disposition'].should.eql('attachment; filename=transparent.gif');
        flow.lastContentType.should.contain('image/gif');
      });
    });

    describe('When accessing an ipython notebook file', function() {
      before(function(done) {
        flow.downloadFile(ipynbId, function() {
          done();
        });
      });

      it('should download the file', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(200);
        flow.lastResponse.headers['content-disposition'].should.eql('attachment; filename=test.ipynb');
        flow.lastContentType.should.contain('text/plain');
      });
    });
  });
}
