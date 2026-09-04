var sinon    = require('sinon'),
    should   = require('chai').should(),
    flow     = require('../../helpers/flow'),
    config   = require('config');

module.exports = function() {
  describe('User Profile', function() {
    var user, avatarHostWas;

    // The shipped avatar bucket host is self-cancelling, so this suite supplies
    // a usable one for its own duration.
    //
    // lib/models/user.js normalizeAvatar() treats any avatar containing
    // 'example.com' as "no avatar" and substitutes the default, and it also
    // declines to use `aws.buckets.useravatars.host` as a prefix while that host
    // itself contains 'example.com'. config/default.yaml:412 ships
    // 'https://your-avatars-bucket.example.com', so with the shipped value every
    // avatar under the configured host - including the one this suite submits -
    // collapses to '/img/avatar-default.svg' and the expectation below can never
    // hold.
    //
    // Scoped here rather than in config/test.yaml because that file applies to
    // every NODE_ENV=test process, including the application the parity gates
    // drive, and normalizeAvatar's output appears in serialized user documents
    // throughout the response corpus. Written through Object.defineProperty for
    // the reason app.js:80-90 documents: `config` persists plain assignments to
    // config/runtime.json, and replacing the descriptor persists nothing.
    before(function() {
      avatarHostWas = config.aws.buckets.useravatars.host;
      Object.defineProperty(config.aws.buckets.useravatars, 'host', {
        value: 'https://avatars.trinket.test', writable: true, enumerable: true, configurable: true
      });
    });

    after(function() {
      Object.defineProperty(config.aws.buckets.useravatars, 'host', {
        value: avatarHostWas, writable: true, enumerable: true, configurable: true
      });
    });

    describe('As a logged in user', function() {
      before(function(done) {
        flow.switchUser('profile');
        flow.register({
          fullname: 'profile user',
          username: 'profile',
          email: 'profile@example.com',
          password: 'profile'
        }, function(err, response) {
          User.findByLogin('profile@example.com', function(err, doc) {
            user = doc;
            done();
          });
        });
      });

      after(function(done) {
        user.remove(done);
      });

      it('should allow me to update my username, name and avatar', function(done) {
        var updates = {
          username : 'hanz',
          name : 'hanz',
          // `config.aws.buckets.useravatars.host`, not
          // `config.cloud.containers.userAvatars.host`. There is no `cloud` key
          // in config/default.yaml - not in this checkout and not at base commit
          // 2f8712a either (`git show 2f8712a:config/default.yaml` has no
          // `cloud:` or `containers:` section) - so the old expression read
          // `undefined.containers` and threw
          // `TypeError: Cannot read properties of undefined (reading 'containers')`
          // before the request was even built. The avatar bucket's host now
          // lives at config/default.yaml:410-412, which is the value
          // lib/util/file.js:201-202 uses for user avatars.
          avatar : config.aws.buckets.useravatars.host + '/franz'
        };

        flow.updateProfile(user.id, updates, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('application/json');
          for (var property in updates) {
            flow.lastResponse.body.should.have.deep.property('user.' + property, updates[property]);
          }
          done();
        });
      });
    });
  });
}
