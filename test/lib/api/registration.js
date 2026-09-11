var sinon         = require('sinon'),
    should        = require('chai').should(),
    flow          = require('../../helpers/flow'),
    defaults      = require('../../helpers/defaults'),
    config        = require('config'),
    url           = require('url'),
    ObjectId      = require('mongoose').Types.ObjectId;

module.exports = function() {
  describe('User Registration', function() {
    var libraryUser, sampleCourse;

    before(function(done) {
      libraryUser = new User({
        fullname: 'test trinket library user',
        username: 'testlibraryuser',
        email:'bliggedy@bloo.poo',
        password:'flim-flam-bim-bam'
      });

      libraryUser.save(function(err, user) {
        if (err) return done(err);

        sampleCourse = new Course({
          name:        'the sampler',
          description: 'a sample course for you!',
          _owner:      user,
          ownerSlug:   user.username
        });

        sampleCourse.save(function(err, course){
          if (err) return done(err);

          done();
        });
      });
    });

    after(function(done) {
      libraryUser.remove(function() {
        sampleCourse.remove(done);  
      });
    });

    describe('When I enter valid registration data', function(){
      before(function(done) {
        flow.switchUser('user');
        // make sure a user does not already exist
        User.findByLogin(defaults.user.email, function(err, doc) {
          should.not.exist(doc);
          done();
        });
      });

      it('should create a new user account', function(done) {
        // register the user
        flow.register(function(err, response) {
          User.findByLogin(defaults.user.email, function(err, doc) {
            should.exist(doc);
            done();
          });
        });
      });

      it('should redirect to the welcome page', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(302);
        flow.lastResponse.redirect.should.be.true;
        flow.lastRedirect.pathname.should.eql('/welcome');
      });

      it('should include a link to the default course on the welcome page', function(done) {
        flow.welcome(function() {
          // CORRECTED to what both trees answer: /welcome renders no page, so
          // there is no welcome page to carry the sampler link.
          //
          // `pages.welcome` (lib/controllers/pages.js) redirects to /home
          // UNCONDITIONALLY, and does so on both trees - the baseline source is
          // `reply().redirect('/home')` at
          // `git show 2f8712a:lib/controllers/pages.js`, the same unconditional
          // redirect the converted handler performs. The 2013 expectation
          // describes a rendered welcome page this application has not served
          // since; the sampler course itself is still reachable, and the case
          // below this one drives that copy route directly and passes.
          //
          // MEASURED, GET /welcome immediately after the signup that opened this
          // session, through
          //   node test/parity/mongo.js --overlay -- \
          //     node test/parity/server.js --app <tree> --port <3260|3261>
          // Target (this tree): 302, `location: /home`, 0-byte body, 0
          // occurrences of the `/courses/the-sampler/copy` link. Baseline
          // (2f8712a): 302, `location: /home`, 0-byte body, the same 0
          // occurrences. IDENTICAL.
          //
          // The containment assertion on a body that is always empty becomes
          // three exact assertions on the response that is actually served -
          // status, redirect target and the empty body - so the case still fails
          // if /welcome ever starts rendering something. Its entry in the
          // assertion-correction record is in test/lib/api/index.js.
          flow.lastResponse.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/home');
          flow.lastResponse.text.should.eql('');
          done();
        });
      });

      it('should allow the sample course to be copied', function(done) {
        flow.post('/' + libraryUser.username + '/courses/' + sampleCourse.slug + '/copy')
          .set('referer', '/welcome')
          .end(function(err, response) {
            should.not.exist(err);
            response.statusCode.should.eql(302);
            url.parse(response.headers.location).pathname.should.eql('/u/' + defaults.user.username + '/classes/' + sampleCourse.slug);
            done();
          });
      });

      it('should allow the sample course to be loaded', function(done) {
        flow.viewCourse(defaults.user.username, sampleCourse.slug, function() {
          flow.lastResponse.statusCode.should.eql(200);
          done();
        });
      });
    });

    describe('When I enter duplicate registration data', function() {
      before(function(done) {
        flow.switchUser('');
        flow.register({ username : defaults.user.username.toUpperCase() }, function(err, response) {
          done();
        });
      });

      it('should redirect me to the signup page', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(302);
        flow.lastResponse.redirect.should.be.true;
        flow.lastRedirect.pathname.should.eql('/signup');
      });
    });

    describe('When I enter invalid registration data', function() {
      before(function() {
        flow.switchUser('');
      });

      before(function(done) {
        flow.register({email:'invalid'}, function(err, response) {
          done();
        });
      });

      it('should redirect me to the signup page', function() {
        flow.wasOk.should.be.true;
        flow.lastResponse.statusCode.should.eql(302);
        flow.lastResponse.redirect.should.be.true;
        flow.lastRedirect.pathname.should.eql('/signup');
      });

      it('should not create a new user account', function(done) {
        User.findByLogin('invalid', function(err, doc) {
          should.not.exist(doc);
          done();
        });
      });

      it('should not let me visit the welcome page', function(done) {
        flow.welcome(function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        });
      });
    });
  });
}
