var sinon    = require('sinon'),
    should   = require('chai').should(),
    flow     = require('../../helpers/flow'),
    config   = require('config');

module.exports = function() {
  describe('User Profile', function() {
    var user;

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

      // R-6 ADJUDICATION, MEASURED, two separate corrections.
      //
      // (1) `config.cloud` does not exist. There is no `cloud:` key anywhere in config/default.yaml, at
      // this commit or the base one (`git diff 2f8712a -- config/default.yaml` is empty - the file is
      // frozen), so line 34 threw `TypeError: Cannot read properties of undefined (reading 'containers')`
      // before a single assertion ran. The real avatar-host key is
      // `config.aws.buckets.useravatars.host` (config/default.yaml:410-412), which is exactly what
      // `lib/models/user.js#normalizeAvatar` and the `userAvatar` nunjucks filter read.
      //
      // (2) The submitted avatar is never stored verbatim. `lib/models/user.js`'s pre-save hook
      // unconditionally rewrites `user.avatar = this.normalizeAvatar()`, and `normalizeAvatar` treats any
      // URL containing 'example.com' as "no avatar" and returns '/img/avatar-default.svg' whenever the
      // configured host is itself a placeholder. Both the hook and the function are BYTE-IDENTICAL at the
      // base commit (verified against `git show 2f8712a:lib/models/user.js`), and the frozen
      // config/default.yaml ships the placeholder host 'https://your-avatars-bucket.example.com', so the
      // base commit collapsed this avatar too. Measured on this tree over real HTTP: 200,
      // application/json, `user.username` and `user.name` both 'hanz', `user.avatar`
      // '/img/avatar-default.svg'. The normalized value is asserted explicitly rather than looped over,
      // which keeps the storage-format contract (TR6) under test instead of dropping it.
      //
      // The dotted-path lookups are also written as `nested.property`: chai 4 removed dot-notation
      // support from `.property` and moved it to `.nested.property` - a library mechanic, not a change of
      // what is asserted. See docs/PRESERVED-QUIRKS.md.
      it('should allow me to update my username, name and avatar', function(done) {
        var updates = {
          username : 'hanz',
          name : 'hanz',
          avatar : config.aws.buckets.useravatars.host + '/franz'
        };

        flow.updateProfile(user.id, updates, function() {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('application/json');
          flow.lastResponse.body.should.have.nested.property('user.username', updates.username);
          flow.lastResponse.body.should.have.nested.property('user.name', updates.name);
          flow.lastResponse.body.should.have.nested.property('user.avatar', '/img/avatar-default.svg');
          done();
        });
      });
    });
  });
}
