var sinon    = require('sinon'),
    should   = require('chai').should(),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults');

// Review finding M6 (CWE-200 / CWE-522) sentinels. Both admin response surfaces JSON-clone a whole User
// document, so a credential that is not at the TOP level of that document is the thing to watch: the live
// Google OAuth bearer token lib/controllers/auth.js:L232/L253 persists at `profiles.google.token`. These
// two strings are seeded onto a real user and then required to be absent from the response bytes, which is
// an assertion the earlier password-only `delete` could not have satisfied.
var GOOGLE_TOKEN_SENTINEL = 'ya29.M6-SENTINEL-GOOGLE-BEARER-TOKEN',
    GOOGLE_ID_SENTINEL    = 'M6-SENTINEL-GOOGLE-ID';

module.exports = function() {
  describe('Admin Access', function() {
    var user, admin;

    before(function(done) {
      admin = new User(defaults.admin);
      admin.save(done);
    });

    before(function(done) {
      user = new User(defaults.extend({ email: 'not@admin.com', username: 'notadmin' }, 'user'));
      user.save(done);
    });

    after(function(done) {
      user.remove(done);
    });

    describe('When I am not logged in', function() {
      // switch to a null user
      before(function() {
        flow.switchUser('');
      });

      describe('and I access /admin', function() {
        it('should redirect me to /login', function(done) {
          flow.admin(function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(302);
            flow.lastResponse.redirect.should.be.true;
            flow.lastRedirect.pathname.should.eql('/login');
            done();
          });
        });
      });
    });

    describe('When I am logged in as a non-admin', function() {
      before(function(done) {
        flow.switchUser('user', done);
      });

      describe('and I access /admin', function() {
        it('should not allow access to admin page', function(done) {
          flow.admin(function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(403);
            flow.lastResponse.redirect.should.be.false;
            done();
          });
        });
      });
    });

    describe('When I am logged in as an admin', function() {
      before(function(done) {
        flow.switchUser('admin');
        done();
      });

      describe('and I access /admin', function() {
        it('should allow access to admin page', function(done) {
          flow.login({ email: defaults.admin.email, password: defaults.admin.password }, function(err, response) {
            flow.admin(function(err, response) {
              flow.wasOk.should.be.true;
              flow.lastResponse.statusCode.should.eql(200);
              done();
            });
          });
        });
      });

      // Review finding M6. Added coverage, not a rewrite of anything above: both surfaces below were
      // previously unasserted, which is how a nested provider credential survived a remediation that
      // only removed the top-level `password`.
      describe('and the user I am administering is linked to Google', function() {
        before(function(done) {
          user.profiles = { google : { id : GOOGLE_ID_SENTINEL, token : GOOGLE_TOKEN_SENTINEL } };
          user.markModified('profiles');
          user.save(function(err) {
            done(err);
          });
        });

        it('should not disclose the nested provider token in the user search page', function(done) {
          // GET /admin/users?q=... is admin.index -> userSearch, whose result is dumped wholesale into
          // lib/views/admin/includes/users.html through `{{ data | json("pretty") | safe }}`, so the
          // credential would appear verbatim in the response bytes if it were not scrubbed.
          flow.get('/admin/users?q=' + encodeURIComponent(user.email))
            .end(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(200);
              response.text.should.contain(user.username);
              response.text.should.contain(GOOGLE_ID_SENTINEL);
              response.text.should.not.contain(GOOGLE_TOKEN_SENTINEL);
              response.text.should.not.contain(user.password);
              done();
            });
        });

        it('should not disclose the nested provider token in the role grant response', function(done) {
          // POST /api/admin/user/{userId}/grant answers { success, user } with the same whole-document
          // clone. 'trinket-connect' is used rather than 'trinket-teacher' because the latter is the
          // preserved-quirk branch that raises a ReferenceError on the undeclared `moment` identifier
          // and never reaches the response builder at all.
          flow.post('/api/admin/user/' + user.id + '/grant')
            .send({ role : 'trinket-connect' })
            .end(function(err, response) {
              should.not.exist(err);
              response.statusCode.should.eql(200);
              response.body.success.should.be.true;
              response.body.user.username.should.eql(user.username);
              response.body.user.profiles.google.should.have.property('id', GOOGLE_ID_SENTINEL);
              response.body.user.profiles.google.should.not.have.property('token');
              response.body.user.should.not.have.property('password');
              JSON.stringify(response.body).should.not.contain(GOOGLE_TOKEN_SENTINEL);
              done();
            });
        });
      });
    });
  });
};
