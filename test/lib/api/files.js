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
