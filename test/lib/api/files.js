var sinon    = require('sinon'),
    should   = require('chai').should(),
    fs       = require('fs'),
    path     = require('path'),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults');

// Fixed rather than randomised, so a failing body is reproducible from the log.
var MULTIPART_BOUNDARY = 'trinketsuiteboundaryd41d8cd98f00';

// The repository root, from test/lib/api. The fixture paths in
// test/helpers/defaults.js are root-relative, and resolving them here rather
// than against process.cwd() keeps the upload working whatever directory the
// runner was started from.
var REPO_ROOT = path.join(__dirname, '..', '..', '..');

/**
 * Posts one RFC 7578 conforming `multipart/form-data` upload to `POST /file`
 * through the suite's own agent, recording the response exactly as every other
 * `flow` method does, so the assertions below read `flow.wasOk`,
 * `flow.lastResponse` and `flow.lastContentType` unchanged.
 *
 * This exists because `.field()` + `.attach()` cannot be used against this
 * application. `supertest` 0.8.3 carries `superagent` 0.16.0, and that
 * superagent labels an attached file
 * `Content-Disposition: attachment; name="upload"; filename="..."`. RFC 7578
 * section 4.2 requires the disposition type of a form-data part to be
 * `form-data`, and @hapi/content enforces exactly that --
 * `internals.contentDispositionRegex = /^\s*form-data\s*(?:;\s*(\S.*))?$/i`
 * [node_modules/@hapi/content/lib/index.js:93] -- so @hapi/subtext rejects the
 * whole body with `400 Bad Request: Invalid multipart payload format` before
 * the handler or this route's own validation is reached. Measured against this
 * checkout, and unrelated to the framework bump: that parser has required
 * `form-data` since long before hapi 20. `supertest` is deliberately held at
 * 0.8.3 [AAP 0.5.1.6], so the client is what has to change.
 *
 * Everything else is kept exactly as superagent produced it, so that the
 * malformed disposition header is the only difference: the same `type` field
 * and value, the same bytes read from the same fixture, and the same per-part
 * `Content-Type` superagent derived from the extension -- `image/gif` for
 * transparent.gif and NONE AT ALL for test.ipynb, whose extension its 2013 mime
 * database does not know. Both were measured, and the distinction is
 * load-bearing in opposite directions: the gif's media type is what
 * `lib/controllers/files.js` resolves the response `path` extension from and
 * what its `file.mime` becomes, whereas the notebook carries no media type and
 * takes its mime from `config.app.extensionWhitelist.ipynb` (`text/plain`)
 * instead. Advertising a type for the notebook, or omitting one for the gif,
 * would each change a value these cases assert.
 *
 * Buffers are concatenated rather than joined as strings so binary content
 * survives intact, and the body goes out through `.send()`, which superagent
 * forwards verbatim under a correct `Content-Length` (measured byte-identical).
 *
 * @param {Object} fixture A `test/helpers/defaults` entry, supplying `upload`
 *   (root-relative fixture path), `name` and `type`.
 * @param {?string} contentType Media type to advertise for the file part, or
 *   null to advertise none.
 * @param {function} cb Called once the response has been recorded.
 * @returns {Object} The superagent request, as the `flow` methods return.
 */
function uploadMultipart(fixture, contentType, cb) {
  var head = '--' + MULTIPART_BOUNDARY + '\r\n' +
             'Content-Disposition: form-data; name="type"\r\n' +
             '\r\n' +
             fixture.type + '\r\n' +
             '--' + MULTIPART_BOUNDARY + '\r\n';

  if (contentType) {
    head += 'Content-Type: ' + contentType + '\r\n';
  }

  head += 'Content-Disposition: form-data; name="upload"; filename="' +
          fixture.name + '"\r\n' +
          '\r\n';

  var body = Buffer.concat([
    Buffer.from(head, 'utf8'),
    fs.readFileSync(path.join(REPO_ROOT, fixture.upload)),
    Buffer.from('\r\n--' + MULTIPART_BOUNDARY + '--\r\n', 'utf8')
  ]);

  return flow.post('/file')
    .set('Content-Type', 'multipart/form-data; boundary=' + MULTIPART_BOUNDARY)
    .send(body)
    .end(flow.setLastResponse(cb));
}

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
          uploadMultipart(defaults.file, 'image/gif', function() {
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
          uploadMultipart(defaults.file, 'image/gif', function() {
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
          uploadMultipart(defaults.ipynb, null, function() {
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
