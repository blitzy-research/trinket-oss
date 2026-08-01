var sinon   = require('sinon'),
    queues  = require('../../lib/util/queues'),
    // Load-safe accessor probe. `db.redis.bullqueues` is the one-element list `[exports]`
    // (config/default.yaml:L385-L386), so lib/util/queues.js generates an accessor for `exports` alone
    // and `snapshots` is undefined - the bare `queues.snapshots()` call threw a TypeError at module load.
    // The fallback mirrors the `NoOpQueue` that a `snapshots` accessor would have returned, because
    // `snapshots` is one of the nine hard-disabled queues. See docs/PRESERVED-QUIRKS.md section 3.11.
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
      // PRESERVED QUIRK: the fake returns a hand-rolled SYNCHRONOUS single-argument thenable, never
      // `Promise.resolve()` - a real promise defers resolution to a microtask and would reorder execution
      // for any caller. The unused `data` parameter is preserved too. See docs/PRESERVED-QUIRKS.md 3.11.
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
