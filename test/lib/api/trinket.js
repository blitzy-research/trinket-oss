var flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults'),
    mail     = require('../../helpers/mail'),
    queue    = require('../../helpers/queue'),
    config   = require('config'),
    jwt      = require('jsonwebtoken');

module.exports = function() {
  describe('Trinket Creation', function() {
    var trinketId, trinketShortCode, trinketLang;

    describe('When creating a new trinket', function() {
      mail.stub();

      before(function(done) {
        flow.createTrinket(function() {
          trinketId        = flow.lastResponse.body.data.id;
          trinketShortCode = flow.lastResponse.body.data.shortCode;
          trinketLang      = flow.lastResponse.body.data.lang;
          done();
        });
      });

      it('should return a new trinket', function(done) {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(200);
        flow.lastContentType.should.contain('application/json');
        flow.lastResponse.body.data.should.have.property('id');
        flow.lastResponse.body.data.should.have.property('hash');
        flow.lastResponse.body.data.should.have.property('shortCode');
        flow.lastResponse.body.data.lang.should.eql('python');

        done();
      });

      describe('When I attempt to fork with a new code modification', function() {
        before(function(done) {
          flow.forkTrinket(trinketId, { code : 'modified code' }, function() {
            done();
          });
        });

        it('should create a new trinket', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('application/json');
          flow.lastResponse.body.data.should.contain.keys('id', 'hash', 'shortCode');
          done();
        });

        it('should update the fork count of the parent', function(done) {
          flow.get('/api/trinkets/' + trinketId)
            .end(function(err, res) {
              res.body.data.metrics.forks.should.eql(1);
              done();
            });
        });
      });

      // the next 3 tests below are testing non-api URLs

      it('should allow me to load the trinket', function(done) {
        flow.getTrinket(trinketShortCode, trinketLang, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('text/html');

          done();
        });
      });

      it('should allow me to embed the trinket', function(done) {
        flow.getEmbeddedTrinket(trinketId, trinketLang, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('text/html');

          // Review finding M9 - the CONTROL for the case below. lib/views/embed/python.html renders
          // `<input id="start-value" ... value='{{start if start else "code"}}'/>`, so with no `start`
          // query the marker is 'code'. Pinning it here is what makes the 'result' assertion below
          // meaningful: without this line, a page that always rendered 'result' would satisfy both.
          flow.lastResponse.text.should.contain('id="start-value" type=\'hidden\' value=\'code\'');
          flow.lastResponse.text.should.not.contain('value=\'result\'');

          done();
        });
      });

      it('should allow me to embed the trinket with result showing', function(done) {
        // Review finding M9 - previously a false green. `flow.getEmbeddedTrinket` tested `query.length`
        // on an object, so `?start=result` was never actually sent and this case issued exactly the same
        // request as the control above while asserting only 200/HTML. The query is serialized now, and
        // the assertion is on the OBSERVABLE consequence: lib/controllers/trinket.js#embed copies
        // `request.query.start` into the view context only when the language is in `config.app.autorun`
        // (python is), and lib/views/embed/python.html renders it into the `start-value` hidden input.
        flow.getEmbeddedTrinket(trinketId, trinketLang, { start : 'result' }, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('text/html');

          // The request really carried the parameter...
          flow.lastResponse.request.url.should.contain('start=result');
          // ...and the handler honoured it, which is the whole contract this test exists for.
          flow.lastResponse.text.should.contain('id="start-value" type=\'hidden\' value=\'result\'');

          done();
        });
      });

      it('should allow me to share the trinket with a token', function(done) {
        var secret = config.app.mail.secret + trinketShortCode;
        var token = jwt.sign({ shortCode: trinketShortCode }, secret);
        flow.emailTrinket(trinketId, { email: defaults.user.email, name: defaults.user.fullname, replyTo: defaults.user.email, token: token }, function(err, response) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);

          mail.mailer.send.calledOnce.should.be.true;

          done();
        });
      });

      it('should not allow me to share the trinket without a token', function(done) {
        flow.emailTrinket(trinketId, { email: defaults.user.email, name: defaults.user.fullname, replyTo: defaults.user.email }, function(err, response) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(400);

          done();
        });
      });

      it('should allow me to run the trinket', function(done) {
        flow.runTrinket(trinketId, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastResponse.body.data.should.have.property('metrics');
          flow.lastResponse.body.data.metrics.should.have.property('runs');

          done();
        });
      });

      it('should allow an error to be logged if there is an error in the code', function(done) {
        flow.trinketRunError(function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);

          done();
        });
      });
    });
  });
}
