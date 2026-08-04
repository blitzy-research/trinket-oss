var sinon    = require('sinon'),
    should   = require('chai').should(),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults');

// R-6 / R-4 PAYLOAD-SHAPE PINS. Both admin response surfaces JSON-clone a WHOLE User document rather
// than projecting `User.publicSpec`, so the administered user's bcrypt hash and - when that user has
// linked Google - the live OAuth bearer credential at `profiles.google.token` are part of the payload.
// That is the base commit's shape and R-4 freezes it; the two specs below pin it so it cannot drift in
// either direction without a test failing. An intermediate revision scrubbed those values out, which
// code review rejected under R-1 (a credential-disclosure repair is not one of the four sanctioned diff
// categories) and R-4 (it changed a client-visible payload). See docs/PRESERVED-QUIRKS.md section 4.14;
// closing the disclosure needs separate authorization, and these assertions are what make the current
// state deliberate rather than accidental.
//
// The sentinels are written onto a real user and read back out of the response bytes, so the assertions
// hold whatever the surrounding suites left in the database.
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

      // R-6 payload-shape pins for the two whole-document clones. Added coverage, not a rewrite of
      // anything above: both surfaces were previously unasserted, so nothing recorded what they
      // actually put on the wire.
      describe('and the user I am administering is linked to Google', function() {
        before(function(done) {
          user.profiles = { google : { id : GOOGLE_ID_SENTINEL, token : GOOGLE_TOKEN_SENTINEL } };
          user.markModified('profiles');
          user.save(function(err) {
            done(err);
          });
        });

        after(function(done) {
          user.profiles = {};
          user.markModified('profiles');
          user.save(function(err) {
            done(err);
          });
        });

        it('should render the whole cloned user document in the search page, credentials included',
          function(done) {
            // GET /admin/users?q=... is admin.index -> userSearch, whose result is dumped wholesale
            // into lib/views/admin/includes/users.html through `{{ data | json("pretty") | safe }}`.
            // The shape is required BEFORE the credential expectations, so a blank or error page
            // cannot satisfy them by omission.
            flow.get('/admin/users?q=' + encodeURIComponent(user.email))
              .end(function(err, response) {
                should.not.exist(err);
                response.statusCode.should.eql(200);
                response.text.should.contain(user.username);
                response.text.should.contain(GOOGLE_ID_SENTINEL);
                // The preserved base-commit shape: the clone is unprojected, so both credential
                // classes reach the rendered page. See the file header.
                response.text.should.contain(GOOGLE_TOKEN_SENTINEL);
                response.text.should.contain(user.password);
                done();
              });
          });

        it('should answer the whole cloned user document from the role grant, credentials included',
          function(done) {
            // POST /api/admin/user/{userId}/grant answers { success, user } with the same
            // whole-document clone. 'trinket-connect' is used rather than 'trinket-teacher' because
            // the latter is the preserved-quirk branch that raises a ReferenceError on the
            // undeclared `moment` identifier and never reaches the response builder at all.
            flow.post('/api/admin/user/' + user.id + '/grant')
              .send({ role : 'trinket-connect' })
              .end(function(err, response) {
                should.not.exist(err);
                response.statusCode.should.eql(200);
                response.body.success.should.be.true;
                // Shape first, then the credential expectations, so an empty body fails rather
                // than passes.
                response.body.should.have.property('user');
                response.body.user.username.should.eql(user.username);
                response.body.user.profiles.google.should.have.property('id', GOOGLE_ID_SENTINEL);
                response.body.user.profiles.google.should.have.property('token',
                                                                        GOOGLE_TOKEN_SENTINEL);
                response.body.user.should.have.property('password', user.password);
                done();
              });
          });
      });
    });
  });
};
