var should         = require('chai').should(),
    flow           = require('../../helpers/flow'),
    catboxmock     = require('../../helpers/catbox-redis'),
    CatboxMongoose = require('../../../lib/util/catbox-mongoose');

/**
 * Session-id rotation on login and session invalidation on logout, asserted through the CREDENTIAL rather
 * than through the transition's status code: each test replays the cookie the client held BEFORE the
 * transition and requires it to be refused. A status code and a redirect target say nothing about the
 * credential, so `request.yar.reset()` disappearing from the login handler, or the session cache deletion
 * breaking, would otherwise leave every other suite green.
 *
 * The suite is isolated on purpose, because `test/lib/api/index.js` runs its suites serially over shared
 * database and session state: it creates and removes its own user rather than reusing `defaults.user` —
 * whose password `forgot_pass.js` deliberately changes — drives every request through a cookie slot no other
 * suite touches, and restores `flow.activeUser` afterwards.
 *
 * `@hapi/yar` fires `this._cache.drop(this.id)` WITHOUT awaiting it and immediately swaps in a fresh session
 * id, so whether a revoked cookie still works depends entirely on that cache deletion landing — which is
 * observable only because the cache fake clones across its serialization boundary instead of aliasing the
 * session object; see test/helpers/catbox-redis.js.
 */
module.exports = function() {
  describe('Session rotation and invalidation', function() {
    var SLOT = 'sessionSecurityProbe',
        CREDENTIALS = {
          fullname : 'session probe',
          username : 'sessionprobe',
          email    : 'session-probe@dummy.com',
          password : 'session-probe-password'
        },
        probeUser,
        previousActiveUser;

    before(function(done) {
      previousActiveUser = flow.activeUser;
      probeUser = new User(CREDENTIALS);
      probeUser.save(function(err) {
        done(err);
      });
    });

    before(function() {
      // No callback: switchUser only sets the active slot when it is given none, so nothing is logged in
      // on this slot until this suite does it explicitly.
      flow.switchUser(SLOT);
    });

    after(function() {
      catboxmock.restoreDrop();
      flow.switchUser(previousActiveUser);
    });

    after(function(done) {
      probeUser.remove(function(err) {
        done(err);
      });
    });

    describe('the cache boundary the invalidation assertions depend on', function() {
      var key = { segment : 'blitzy-session-probe', id : 'boundary' };

      after(async function() {
        catboxmock.restoreDrop();
        await new CatboxMongoose.Engine().drop(key);
      });

      it('should not alias the stored session object in either direction', async function() {
        var engine = new CatboxMongoose.Engine(),
            stored = { userId : 'u1', nested : { count : 1 }, seenAt : new Date(0) };

        await engine.set(key, stored, 60000);

        stored.userId       = 'MUTATED';
        stored.nested.count = 99;

        var read = await engine.get(key);

        read.item.userId.should.eql('u1');
        read.item.nested.count.should.eql(1);
        read.item.nested.should.not.equal(stored.nested);
        // Production stores this field in a Mongoose Mixed path and reads it back through .lean(), so a
        // Date survives as a Date. A JSON round-trip would have flattened it to a string.
        read.item.seenAt.should.be.an.instanceof(Date);

        read.item.userId = 'ALSO MUTATED';

        (await engine.get(key)).item.userId.should.eql('u1');
      });

      it('should surface a refused drop as a rejection and keep the entry', async function() {
        var engine = new CatboxMongoose.Engine(),
            refused = new Error('probe: cache drop refused'),
            rejection = null;

        await engine.set(key, { userId : 'u1' }, 60000);
        catboxmock.has(key).should.be.true;

        catboxmock.failDrop(refused);

        try {
          await engine.drop(key);
        }
        catch (err) {
          rejection = err;
        }

        should.exist(rejection);
        rejection.message.should.eql('probe: cache drop refused');
        // The entry survives, which is why a failed drop leaves a revoked cookie usable. yar discards the
        // promise this rejection travels on, so the failure is invisible to the request that caused it -
        // which is why this is asserted at the engine boundary rather than through a live request.
        catboxmock.has(key).should.be.true;

        catboxmock.restoreDrop();
        await engine.drop(key);
        catboxmock.has(key).should.be.false;
      });
    });

    describe('when I log in', function() {
      var anonymousCookie, authenticatedCookie;

      before(function(done) {
        // An unauthenticated GET /login issues an anonymous session cookie, which is the credential a real
        // browser carries into the login POST and the one a fixation attempt would try to keep.
        flow.get('/login').end(flow.setLastResponse(function() {
          anonymousCookie = flow.currentCookie(SLOT);
          done();
        }));
      });

      before(function(done) {
        flow.login({ email : CREDENTIALS.email, password : CREDENTIALS.password }, function() {
          authenticatedCookie = flow.currentCookie(SLOT);
          done();
        });
      });

      it('should have arrived with an anonymous session cookie', function() {
        should.exist(anonymousCookie);
        anonymousCookie.join(';').should.contain('session=Fe26.2');
      });

      it('should redirect to the home page', function() {
        flow.lastResponse.statusCode.should.eql(302);
        flow.lastRedirect.pathname.should.eql('/home');
      });

      it('should rotate the session cookie rather than reusing the one I arrived with', function() {
        should.exist(authenticatedCookie);
        flow.previousCookie(SLOT).should.eql(anonymousCookie);
        authenticatedCookie.should.not.eql(anonymousCookie);
      });

      it('should accept the rotated cookie', function(done) {
        flow.replay('get', '/home', authenticatedCookie).end(function(err, res) {
          should.not.exist(err);
          res.statusCode.should.eql(200);
          done();
        });
      });

      it('should refuse the pre-login cookie once the session has rotated', function(done) {
        flow.replay('get', '/home', anonymousCookie).end(function(err, res) {
          should.not.exist(err);
          res.statusCode.should.eql(302);
          res.headers.location.should.contain('/login');
          done();
        });
      });
    });

    describe('when I log out', function() {
      var preLogoutCookie;

      before(function(done) {
        preLogoutCookie = flow.currentCookie(SLOT);
        flow.logout(function() {
          done();
        });
      });

      it('should redirect me to the splash page', function() {
        flow.lastResponse.statusCode.should.eql(302);
        flow.lastRedirect.pathname.should.eql('/');
      });

      it('should issue a cookie different from the one I logged out with', function() {
        flow.previousCookie(SLOT).should.eql(preLogoutCookie);
        flow.currentCookie(SLOT).should.not.eql(preLogoutCookie);
      });

      it('should refuse the pre-logout cookie afterwards', function(done) {
        flow.replay('get', '/home', preLogoutCookie).end(function(err, res) {
          should.not.exist(err);
          res.statusCode.should.eql(302);
          res.headers.location.should.contain('/login');
          done();
        });
      });
    });

    describe('when the session cache deletion is slow', function() {
      var DELAY = 800,
          preLogoutCookie,
          duringStatus,
          afterStatus;

      before(function(done) {
        flow.login({ email : CREDENTIALS.email, password : CREDENTIALS.password }, function() {
          preLogoutCookie = flow.currentCookie(SLOT);
          done();
        });
      });

      before(function(done) {
        this.timeout(30000);

        // The delay is armed only for the logout, so the login above - which also resets the session -
        // is not held open by it.
        catboxmock.delayDrop(DELAY);

        flow.logout(function() {
          flow.replay('get', '/home', preLogoutCookie).end(function(err, duringRes) {
            if (err) return done(err);
            duringStatus = duringRes.statusCode;

            setTimeout(function() {
              flow.replay('get', '/home', preLogoutCookie).end(function(afterErr, afterRes) {
                if (afterErr) return done(afterErr);
                afterStatus = afterRes.statusCode;
                catboxmock.restoreDrop();
                done();
              });
            }, DELAY * 2);
          });
        });
      });

      after(function() {
        catboxmock.restoreDrop();
      });

      // These two assertions are the ones that make the cache deletion load-bearing. A revoked cookie is
      // refused exactly as soon as the drop lands and not before, so if the drop stopped happening the
      // second assertion would fail rather than silently passing.
      it('should still accept the revoked cookie while the drop is pending', function() {
        duringStatus.should.eql(200);
      });

      it('should refuse the revoked cookie once the drop has landed', function() {
        afterStatus.should.eql(302);
      });
    });
  });
};
