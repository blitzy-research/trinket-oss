var sinon  = require('sinon'),
    should = require('chai').should(),
    db     = require('../../helpers/db');

/**
 * The readiness contract of the destructive test-database helper.
 *
 * `test/helpers/db.js#reset` must WAIT for the initialized connection state rather than returning early when
 * the connection is not yet up, and it must PROPAGATE the original error when readiness fails. Returning
 * early would report SUCCESS over an untouched database, which lets a suite start over whatever the previous
 * run left behind and lets the initialization drop delete fixtures the first test has already created.
 *
 * `reset` therefore routes through the helper's `ensureConnection` barrier — the poll that returns only once
 * `_isConnected` is set, which `checkState()` does ONLY after the initialization drop has resolved — and
 * `test/setup.js` registers the same barrier on the ROOT suite so a single-file run cannot race it either.
 *
 * The two tests pin that contract WITHOUT dropping anything: `ensureConnection` is stubbed to answer, so the
 * assertion is about whether `reset` consults it at all.
 */
describe('test-database helper readiness contract', function() {
  afterEach(function() {
    if (db.ensureConnection.restore) {
      db.ensureConnection.restore();
    }
  });

  it('waits for the connection barrier before dropping, and propagates its error', function(done) {
    var barrier = new Error('db-helper-readiness sentinel: the barrier refused'),
        stub    = sinon.stub(db, 'ensureConnection').callsFake(function(cb) {
          cb(barrier);
        });

    db.reset(function(err) {
      // The barrier was consulted exactly once, and its error reached the hook rather than being
      // swallowed into a success. Nothing was dropped: `reset` never reached `dropDatabase()`.
      stub.calledOnce.should.be.true;
      should.exist(err);
      err.should.equal(barrier);
      done();
    });
  });

  it('reports the recorded initialization error without consulting the barrier at all', function(done) {
    var initError = new Error('db-helper-readiness sentinel: initialization failed'),
        stub      = sinon.stub(db, 'ensureConnection').callsFake(function(cb) {
          cb();
        });

    db._initError = initError;

    db.reset(function(err) {
      db._initError = null;

      // A failed initialization is terminal: the original error is what the suite must see, and the
      // barrier is not even reached, so a database that was never successfully cleared is never dropped
      // a second time in the hope that it works.
      stub.called.should.be.false;
      should.exist(err);
      err.should.equal(initError);
      done();
    });
  });
});
