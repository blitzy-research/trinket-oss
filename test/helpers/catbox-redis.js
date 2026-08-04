/**
 * In-memory replacement for the session cache engine, so the suite needs no started cache backend.
 *
 * The suite never starts the cache: `config/test.yaml` sets `app.start: false`, so hapi never reaches
 * `server.start()` and never provisions its cache clients. The engine's `start()` is therefore never
 * called, which leaves it unable to serve a single operation, and `@hapi/yar` treats a not-ready cache as
 * fatal on both session load and session commit. Stubbing the engine is what makes the flow-based suite
 * reachable at all.
 *
 * Four methods of the `Engine` prototype exported by lib/util/catbox-mongoose.js are stubbed - `isReady`,
 * `get`, `set` and `drop` - over an in-memory map. `start`, `stop` and `validateSegmentName` stay real:
 * nothing invokes the first two, and catbox calls the third at policy-provisioning time, where the real
 * implementation already answers correctly. Stubbing more than the suite reaches would hide a regression
 * in the parts that still run for real.
 *
 * Three properties of the stub are load-bearing. TTL is MILLISECONDS, because that is the unit catbox
 * hands an engine, so there is no seconds conversion. Expiry is LAZY, evaluated on read against the
 * `{item, stored, ttl}` envelope exactly as catbox and the real engine both do, so no timer is created to
 * hold the event loop open. And keys come from the engine's own `_generateKey`, so a stored entry carries
 * the `segment:id` shape production uses rather than a second, independently maintained copy of that join.
 *
 * `expires` below is an implicit global retained deliberately although the timer it served is gone:
 * Mocha's `check-leaks` baseline is snapshotted after the helpers load, so removing it would change what
 * that check sees.
 *
 * The fake clones with `structuredClone` on both `set` and `get`, because production does not alias: the
 * engine writes into a Mongoose `Mixed` field and reads back through `.lean()`, so a stored entry is a
 * copy no later in-memory mutation can reach. Sharing one mutable reference silently removed the teeth
 * from every session-invalidation assertion. `structuredClone` rather than a JSON round-trip because it
 * preserves `Date`, as BSON does. `drop` is injectable - `delayDrop`, `failDrop`, `restoreDrop` - so a
 * slow or refused invalidation can be asserted rather than assumed; yar fires `drop` without awaiting it,
 * so use those at engine level only.
 *
 * The evidence behind every claim above - the measured 500s without this helper, the stub-target
 * correction, the millisecond-unit correction and the aliasing measurement - is in
 * docs/PRESERVED-QUIRKS.md section 3.7.
 */

var CatboxMongoose = require('../../lib/util/catbox-mongoose'),
    sinon  = require('sinon'),
    cache  = {};
    expires = {};

// Default drop behaviour: immediate success, which is what the engine does. Replaced only through the
// exported control surface at the foot of this file, and always restored by the test that changed it.
var dropBehaviour = { delay : 0, error : null };

/**
 * Deep-copies a value across the cache boundary the way production's BSON round-trip does.
 *
 * @param {*} value The value being written to, or read from, the fake cache.
 * @returns {*} An independent copy.
 */
function cloneAcrossBoundary(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  return structuredClone(value);
}

// `isReady` is the gate catbox applies before every operation. The real implementation reads
// `this.isConnected && mongoose.connection.readyState === 1`, and `isConnected` is only ever set inside
// `start()`, so without this the whole suite 500s on the session commit.
sinon.stub(CatboxMongoose.Engine.prototype, 'isReady').callsFake(function() {
  return true;
});

sinon.stub(CatboxMongoose.Engine.prototype, 'get').callsFake(async function(key) {
  var id     = this._generateKey(key),
      record = cache[id];

  if (!record) {
    return null;
  }

  // Mirrors the real engine's lazy per-read expiry, which it documents as the effective mechanism
  // because its declared TTL index never fires.
  if (record.ttl && (Date.now() - record.stored) > record.ttl) {
    delete cache[id];
    return null;
  }

  return {
    // Review finding M7 - the read side of the serialization boundary. Handing back the stored object
    // itself would let a caller's later mutation reach into the cache.
    item   : cloneAcrossBoundary(record.item),
    stored : record.stored,
    ttl    : record.ttl
  };
});

sinon.stub(CatboxMongoose.Engine.prototype, 'set').callsFake(async function(key, value, ttl) {
  cache[this._generateKey(key)] = {
    // Review finding M7 - the write side of the same boundary.
    item   : cloneAcrossBoundary(value),
    stored : Date.now(),
    ttl    : ttl
  };
});

sinon.stub(CatboxMongoose.Engine.prototype, 'drop').callsFake(async function(key) {
  var id = this._generateKey(key);

  if (dropBehaviour.error) {
    throw dropBehaviour.error;
  }

  if (dropBehaviour.delay > 0) {
    await new Promise(function(resolve) {
      setTimeout(resolve, dropBehaviour.delay);
    });
  }

  delete cache[id];
});

module.exports = {
  /**
   * Makes every subsequent `drop` settle only after `ms`, modelling a slow cache. The entry stays
   * readable for the whole window, which is exactly the interval in which a revoked cookie is still
   * accepted.
   *
   * @param {number} ms Milliseconds to hold the drop open.
   * @returns {void}
   */
  delayDrop : function(ms) {
    dropBehaviour = { delay : ms, error : null };
  },

  /**
   * Makes every subsequent `drop` reject, modelling a cache that refuses the deletion.
   *
   * ENGINE-LEVEL USE ONLY. `@hapi/yar/lib/index.js:165-171` calls `drop` without awaiting or catching it,
   * so a rejection raised during a live request becomes an unhandled rejection that Mocha attributes to
   * whichever test is running. Await the engine call directly instead.
   *
   * @param {Error} [error] The rejection value; a default is supplied when omitted.
   * @returns {void}
   */
  failDrop : function(error) {
    dropBehaviour = { delay : 0, error : error || new Error('catbox fake: cache drop refused') };
  },

  /**
   * Restores the engine's own behaviour: drop immediately, succeed.
   *
   * @returns {void}
   */
  restoreDrop : function() {
    dropBehaviour = { delay : 0, error : null };
  },

  /**
   * Whether an entry is present for a catbox key, without going through the stubbed `get` (so an
   * assertion about presence is not itself subject to the lazy expiry check).
   *
   * @param {{segment: string, id: string}} key A catbox key.
   * @returns {boolean} True when the fake is holding an entry for that key.
   */
  has : function(key) {
    return Object.prototype.hasOwnProperty.call(cache, key.segment + ':' + key.id);
  },

  /**
   * The number of entries the fake currently holds.
   *
   * @returns {number} Entry count.
   */
  entryCount : function() {
    return Object.keys(cache).length;
  }
};

// BOOTSTRAP ORDER ANCHOR. The root `.mocharc.json` declares four keys and deliberately no `require` key,
// so Mocha's default recursive glob decides load order, and that order puts `test/setup.js` LAST - measured
// through mocha/lib/cli/collect-files: test/baseline/capture.js, test/baseline/replay.js, this file,
// test/helpers/db.js, ... , test/setup.js. But `test/setup.js:1-2` is what exports `NODE_ENV=test`, and the
// very next file, `test/helpers/db.js`, requires `config/db.js`, which reads `require('config')` and calls
// `mongoose.connect()` at module load. Left to glob order the suite would therefore resolve the DEVELOPMENT
// config layer and drop the development database, and would boot the application with `app.start: true` and
// `usersubdomains: true`. Requiring the bootstrap here makes the ordering a require-cache fact instead of a
// filename fact: this file is the first module the glob loads that participates in the bootstrap, and
// `require` is idempotent, so `test/setup.js` runs exactly once and always before `config` is first read.
// It is required at the END rather than the top so the four prototype stubs above are already installed
// when `test/setup.js:20` boots `app.js`; the resulting cycle back through `test/setup.js:16` resolves to
// this module's exports, which are - and at the base commit always were - empty.
require('../setup');
