var sinon    = require('sinon'),
    should   = require('chai').should(),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults');

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
  });
}
