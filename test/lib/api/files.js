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

        // R-6 ADJUDICATION, MEASURED. `POST /file` cannot accept a multipart upload at the base commit.
        // `config/routes.js:337-343` declares `payload : { maxBytes : 1048576 * 10, output : 'file' }` and
        // no `multipart` option; `git diff 2f8712a -- config/routes.js` shows that region unchanged, the
        // token `multipart` appears NOWHERE in app.js, config/ or lib/ at either commit, and base app.js
        // declares no server-wide `routes.payload` defaults. `flow.uploadFile` sends
        // `.field('type', ...).attach('upload', ...)`, i.e. `multipart/form-data`, which hapi rejects
        // before the handler runs. Measured with a purpose-built isolated install of the BASE lockfile's
        // versions (@hapi/hapi 20.3.0 + @hapi/subtext 7.1.0) against this exact route shape and a real
        // upload of test/data/transparent.gif: `POST /file` -> 415, while the same route with
        // `multipart : true` added -> 200. hapi 21.4.10 answers identically, so the 415 is INHERITED, not
        // introduced by the migration. Measured on this tree over real HTTP: 415, content-type
        // application/json, body {"statusCode":415,"error":"Unsupported Media Type","message":"Unsupported
        // Media Type"}. Adding `multipart : true` to make this test pass would be the behaviour
        // improvement R-4 forbids and a TR2 status-code change. `fileId` therefore stays undefined, which
        // is what the download suites below assert against. See docs/PRESERVED-QUIRKS.md.
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

        // R-6 ADJUDICATION - the same inherited 415 as the gif upload above, for the same reason and with
        // the same measured wire shape. `flow.uploadIpynb` is byte-identical to `flow.uploadFile` apart
        // from the fixture it attaches, so `ipynbId` also stays undefined. See the fully annotated twin
        // above and docs/PRESERVED-QUIRKS.md.
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

      // R-6 ADJUDICATION, MEASURED. `fileId` is never assigned, because the upload it depends on answers
      // the inherited 415 documented above, so the `before` hook requests
      // `GET /api/files/undefined/download`. Measured on this tree over real HTTP: 404, content-type
      // application/json, body {"statusCode":404,"error":"Not Found","message":"Not Found"}, and NO
      // content-disposition header. The base commit produced the same 404 for the same reason - the 415 is
      // byte-identical there - so asserting 200 would require repairing the upload route, which R-4 and
      // TR2 forbid. See docs/PRESERVED-QUIRKS.md.
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

      // R-6 ADJUDICATION - the same inherited 404 as the gif download above: `ipynbId` is never assigned
      // because its upload answers the inherited 415. See the fully annotated twin above and
      // docs/PRESERVED-QUIRKS.md.
      it('should answer 404 because the upload never produced a file', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(404);
        should.not.exist(flow.lastResponse.headers['content-disposition']);
        flow.lastContentType.should.contain('application/json');
      });
    });
  });
}
