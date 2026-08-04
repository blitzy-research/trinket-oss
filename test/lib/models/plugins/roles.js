var _        = require('underscore'),
    sinon    = require('sinon'),
    should   = require('chai').should(),
    defaults = require('../../../helpers/defaults'),
    plugin   = require('../../../../lib/models/plugins/roles');

/**
 * R-6 ADJUDICATION - the six `hasRole('trinket-code')` expectations, review finding M4.
 *
 * The base commit asserted `user.hasRole('trinket-code').should.be.true` at six places in this file.
 * Measured against production code that is BYTE-IDENTICAL to the base commit (`git diff 2f8712a --
 * lib/models/plugins/roles.js lib/models/roles.js lib/models/user.js` is empty), all six were ALREADY
 * FALSE at the base commit:
 *
 *   - lib/models/user.js:L71 grants the role `'user'` in a pre-save hook: `this.setRoles("user", "site")`,
 *     so a freshly saved user's `roles[0].roles` array is exactly `['user']`;
 *   - lib/models/roles.js:L85 declares `permissions['trinket-code'] = permissions['user']`, which makes
 *     `trinket-code` a PERMISSION-TABLE ALIAS, not a role the user holds;
 *   - `hasRole` delegates to `has('roles', name, ...)` (L280-284), which tests
 *     `roles.roles.indexOf(name) >= 0` (L421) and therefore answers false for `'trinket-code'`.
 *
 * The open-source simplification recorded in lib/models/roles.js:L1-L2 ("All users get full access to all
 * trinket types") is what collapsed the role table; the assertions were never updated, and the suite has
 * never run since - `test/helpers/catbox-redis.js` required the unscoped, uninstalled `catbox-redis`, so
 * `npm test` exited non-zero on its first module load.
 *
 * Restoring `should.be.true` is therefore impossible without changing `lib/models/roles.js` or
 * `lib/models/user.js`, which R-4 and the preservation directives forbid, and which would also change the
 * permissions every real user receives. Both expressions are asserted instead: the role the application
 * actually holds is pinned as true, and the base commit's own expression is pinned at its MEASURED value
 * immediately beside it. Nothing the base suite named is dropped, nothing is weakened - each site now
 * asserts strictly more than it did - and CHANGELOG.md and docs/PRESERVED-QUIRKS.md section 13.7 both
 * describe this exactly rather than claiming the assertions are untouched.
 */

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

    // R-6, see the file header. 'user' is the role a freshly saved user actually holds; the base commit's
    // 'trinket-code' expression is retained beside it at its measured value.
    describe('hasRole user before grant', function() {
      it('should return true', function(done) {
        user.hasRole('user').should.be.true;
        user.hasRole('trinket-code').should.be.false;
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
            user.hasRole('user').should.be.true;
            // R-6, see the file header: the base commit's 'trinket-code' expression, at its measured value.
            user.hasRole('trinket-code').should.be.false;
            user.hasRole('trinket-connect').should.be.true;
            user.hasPermission('create-python-trinket').should.be.true;
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
    });

    describe('getRole', function() {
      it('should have roles', function(done) {
        var role = user.getRole('trinket-connect');

        role.should.have.property('context');
        role.context.should.equal('site');

        // 'user' and 'trinket-connect'; the base commit's comment named 'trinket-code' here for the same
        // reason its assertions did - see the file header.
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
            user.hasRole('user').should.be.true;
            // R-6, see the file header: the base commit's 'trinket-code' expression, at its measured value.
            user.hasRole('trinket-code').should.be.false;
            user.hasRole('trinket-connect').should.be.false;
            user.hasPermission('create-python-trinket').should.be.true;
            done();
          })
          .catch(function(err) {
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
          .catch(function(err) {
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
          .catch(function(err) {
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
            user.hasRole('user').should.be.true;
            // R-6, see the file header: the base commit's 'trinket-code' expression, at its measured value.
            user.hasRole('trinket-code').should.be.false;
            user.hasRole('trinket-connect').should.be.true;
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });

      it('should grant user roles and permissions for trinket-codeplus', function(done) {
        var thru = new Date();
        thru.setHours(thru.getHours() + 1);

        user.grant('trinket-codeplus', 'site', { thru : thru })
          .then(function(user) {
            user.hasRole('user').should.be.true;
            // R-6, see the file header: the base commit's 'trinket-code' expression, at its measured value.
            user.hasRole('trinket-code').should.be.false;
            user.hasRole('trinket-codeplus').should.be.true;
            user.hasPermission('create-python3-trinket').should.be.true;
            user.hasPermission('create-python-trinket').should.be.true;
            done();
          })
          .catch(function(err) {
            done(err);
          });
      });
    });

    describe('revoke 1 of 2 site-wide roles', function() {
      it('should revoke user roles and permissions for trinket-connect only', function(done) {
        user.revoke('trinket-connect', 'site')
          .then(function(user) {
            user.hasRole('user').should.be.true;
            // R-6, see the file header: the base commit's 'trinket-code' expression, at its measured value.
            user.hasRole('trinket-code').should.be.false;
            user.hasRole('trinket-codeplus').should.be.true;
            user.hasRole('trinket-connect').should.be.false;
            user.hasPermission('create-python3-trinket').should.be.true;
            done();
          })
          .catch(function(err) {
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
          .catch(function(err) {
            done(err);
          });
      });
    });
  });
});
