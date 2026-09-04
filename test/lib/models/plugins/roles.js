var _        = require('underscore'),
    sinon    = require('sinon'),
    should   = require('chai').should(),
    defaults = require('../../../helpers/defaults'),
    plugin   = require('../../../../lib/models/plugins/roles');

describe('roles plugin', function() {
  describe('class methods', function() {
    var user;

    before(function(done) {
      user = new User(defaults.user);
      user.save(function(err, doc) {
        done();
      });
    });

    after(function(done) {
      user.remove(function() {
        done();
      });
    });

    describe('hasRole trinket-code before grant', function() {
      it('should return true', function(done) {
        user.hasRole('trinket-code').should.be.true;
        done();
      });
    });

    describe('hasPermission create-python-trinket before grant', function() {
      it('should return false', function(done) {
        user.hasPermission('create-python-trinket').should.be.true;
        done();
      });
    });

    describe('hasRole trinket-connect before grant', function() {
      it('should return false', function(done) {
        user.hasRole('trinket-connect').should.be.false;
        done();
      });
    });

    describe('grant site-wide role', function() {
      it('should grant user roles and permissions', function(done) {
        user.grant('trinket-connect', 'site')
          .then(function(user) {
            user.hasRole('trinket-code').should.be.true;
            user.hasRole('trinket-connect').should.be.true;
            user.hasPermission('create-python-trinket').should.be.true;
            done();
          })
          .fail(function(err) {
            done(err);
          });
      });
    });

    describe('getRole', function() {
      it('should have roles', function(done) {
        var role = user.getRole('trinket-connect');

        role.should.have.property('context');
        role.context.should.equal('site');

        // trinket-code, trinket-connect
        role.should.have.property('roles').with.length.of.at.least(2);

        role.should.have.property('permissions').with.length.of.at.least(4);

        user.hasPermission('create-python-trinket').should.be.true;
        role.permissions.should.include('hide-trinket-files');
        role.permissions.should.include('enable-trinket-tests');
        role.permissions.should.include('create-python3-trinket');

        done();
      });
    });

    describe('revoke site-wide role', function() {
      it('should revoke user roles and permissions', function(done) {
        user.revoke('trinket-connect', 'site')
          .then(function(user) {
            user.hasRole('trinket-code').should.be.true;
            user.hasRole('trinket-connect').should.be.false;
            user.hasPermission('create-python-trinket').should.be.true;
            done();
          })
          .fail(function(err) {
            done(err);
          });
      });
    });

    describe('grant site-wide role with thru', function() {
      it('should allow access if thru is in the future', function(done) {
        var thru = new Date();
        thru.setHours(thru.getHours() + 1);

        user.grant('trinket-connect', 'site', { thru : thru })
          .then(function(user) {
            user.roles[0].should.have.property('thru');
            user.hasRole('trinket-connect').should.be.true;
            done();
          })
          .fail(function(err) {
            done(err);
          });
      });

      it('should restrict access if thru is in the past', function(done) {
        var thru = new Date();
        thru.setHours(thru.getHours() - 1);

        user.grant('trinket-connect', 'site', { thru : thru })
          .then(function(user) {
            user.roles[0].should.have.property('thru');
            user.hasRole('trinket-connect').should.be.false;
            done();
          })
          .fail(function(err) {
            done(err);
          });
      });
    });

    describe('grant 2 site-wide roles', function() {
      before(function(done) {
        user.revoke('trinket-connect', 'site')
          .then(function(user) {
            done();
          });
      });

      it('should grant user roles and permissions for trinket-connect', function(done) {
        var thru = new Date();
        thru.setHours(thru.getHours() + 1);

        user.grant('trinket-connect', 'site', { thru : thru })
          .then(function(user) {
            user.hasRole('trinket-code').should.be.true;
            user.hasRole('trinket-connect').should.be.true;
            done();
          })
          .fail(function(err) {
            done(err);
          });
      });

      it('should grant user roles and permissions for trinket-codeplus', function(done) {
        var thru = new Date();
        thru.setHours(thru.getHours() + 1);

        user.grant('trinket-codeplus', 'site', { thru : thru })
          .then(function(user) {
            user.hasRole('trinket-code').should.be.true;
            user.hasRole('trinket-codeplus').should.be.true;
            user.hasPermission('create-python3-trinket').should.be.true;
            user.hasPermission('create-python-trinket').should.be.true;
            done();
          })
          .fail(function(err) {
            done(err);
          });
      });
    });

    describe('revoke 1 of 2 site-wide roles', function() {
      it('should revoke user roles and permissions for trinket-connect only', function(done) {
        user.revoke('trinket-connect', 'site')
          .then(function(user) {
            user.hasRole('trinket-code').should.be.true;
            user.hasRole('trinket-codeplus').should.be.true;
            user.hasRole('trinket-connect').should.be.false;
            user.hasPermission('create-python3-trinket').should.be.true;
            done();
          })
          .fail(function(err) {
            done(err);
          });
      });
    });

    // don't have any of these in the app yet
    // @TODO: update tests when we do
    describe('grant role with context', function() {
      it('should grant user roles and permissions', function(done) {
        // made up role
        user.grant('trinket-owner', 'trinketId')
          .then(function(user) {
            user.hasRole('trinket-owner', 'trinketId').should.be.true;
            done();
          })
          .fail(function(err) {
            done(err);
          });
      });
    });
  });
});
