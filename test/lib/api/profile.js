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

      it('should allow me to update my username, name and avatar', function(done) {
        var updates = {
          username : 'hanz',
          name : 'hanz',
          avatar : config.cloud.containers.userAvatars.host + '/franz'
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
