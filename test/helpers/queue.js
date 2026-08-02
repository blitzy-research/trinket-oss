var sinon   = require('sinon'),
    queues  = require('../../lib/util/queues'),
    // `db.redis.bullqueues` lists `exports` alone, so lib/util/queues.js generates no `snapshots`
    // accessor and a bare call would throw a TypeError at module load. The guard is required, and the
    // fallback mirrors the `NoOpQueue` that accessor would return.
    // See docs/PRESERVED-QUIRKS.md section 3.11.
    snapshotQueue = typeof queues.snapshots === 'function' ? queues.snapshots() : {
      name    : 'snapshots',
      process : function() {},
      add     : function() { return Promise.resolve({ id: 'noop' }); },
      on      : function() { return this; },
      close   : function() { return Promise.resolve(); }
    };

module.exports = {
  snapshotQueue : snapshotQueue,
  stub : function() {
    before(function() {
      // The fake returns a hand-rolled synchronous single-argument thenable, never `Promise.resolve()`,
      // which would defer to a microtask and reorder execution for any caller. The unused `data`
      // parameter is preserved. See docs/PRESERVED-QUIRKS.md section 3.11.
      sinon.stub(snapshotQueue, 'add').callsFake(function(data) {
        return {
          then : function(f) {
            f();
          }
        };
      });
    });

    after(function() {
      snapshotQueue.add.restore();
    });
  }
};
