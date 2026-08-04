var sinon  = require('sinon'),
    should = require('chai').should(),
    db     = require('../../helpers/db');

/**
 * Review finding M12 - the readiness contract of the destructive test-database helper.
 *
 * `test/helpers/db.js#reset` used to open with `if (!this.isConnected()) return done();`, so it reported
 * SUCCESS while the database was untouched. Two distinct failures followed. A suite whose
 * `before(db.reset)` ran before the helper's own `checkState()` had announced the connection started over
 * whatever the previous run had left behind, which is the shared-state race the API suites' own comments
 * say must not exist; and the initialization drop could still be in flight, so a reset that "succeeded"
 * could be followed by that drop deleting fixtures the first test had already created.
 *
 * The fix routes `reset` through the helper's existing `ensureConnection` barrier - the poll that returns
 * only once `_isConnected` is set, which `checkState()` does ONLY after the initialization drop has
 * resolved - and `test/setup.js` registers the same barrier on the ROOT suite so a single-file run
 * (`npx mocha --file ./test/setup.js test/lib/models/course.js`) cannot race it either.
 *
 * These two tests pin that contract WITHOUT dropping anything: `ensureConnection` is stubbed to answer,
 * so the assertion is about whether `reset` consults it at all. Under the earlier implementation the
 * first test fails - `reset` never asks, drops the database and calls back with no error - which is what
 * makes this non-vacuous rather than a restatement of the code.
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
