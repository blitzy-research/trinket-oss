/**
 * In-memory replacement for the session cache engine, so the suite needs no started cache backend.
 *
 * WHY THIS FILE EXISTS, AND WHY IT LOOKED BROKEN
 * ---------------------------------------------
 * At the base commit this helper did `require('catbox-redis')` - the UNSCOPED package, which is declared
 * nowhere in package.json and installed nowhere - and then replaced that engine's `isReady` with a
 * three-argument `sinon.stub(catbox.prototype, 'isReady', fn)`, a form removed in Sinon 3. The require was
 * the very first module load of the suite, so `npm test` exited 1 with
 * `Cannot find module 'catbox-redis'` before a single test ran.
 *
 * Its PURPOSE, however, is load-bearing and still required. `config/test.yaml` sets `app.start: false`,
 * so `app.js` never calls `server.start()`, and `server.start()` is what starts hapi's cache provisions.
 * An unstarted catbox client fails a hard gate: `@hapi/catbox/lib/client.js` runs `[validate]` before every
 * get/set/drop and throws `Boom.internal('Disconnected')` whenever `connection.isReady()` is falsy. Because
 * `@hapi/yar` commits the session in an `onPreResponse` extension, that throw lands on EVERY request that
 * touches the session. Measured on this tree with the helper absent: `GET /`, `GET /login` and `GET /signup`
 * all answer 500 with `Error: Disconnected` raised from `@hapi/catbox/lib/client.js` `[validate]` by way of
 * `Yar.commit`. Restoring this helper is therefore what makes the whole flow-based suite reachable at all.
 *
 * WHAT CHANGED, AND WHY THIS IS THE FAITHFUL TRANSLATION
 * -----------------------------------------------------
 * The engine underneath changed, so the stub had to follow it:
 *   - the require is repointed at the engine the application actually configures,
 *     `lib/util/catbox-mongoose.js`, which `app.js:38` loads and `app.js:82` installs as the `sessions`
 *     cache provider. It exports a named `Engine` CLASS - `{ Engine }` - so the stub target moves from a
 *     bare `catbox.prototype` to `catbox.Engine.prototype`;
 *   - the three-argument `sinon.stub(obj, 'm', fn)` form becomes `sinon.stub(obj, 'm').callsFake(fn)`;
 *   - the baseline stub injected a `self.client` carrying a Redis-shaped, callback-style
 *     `get/set/del/expire`, because the catbox-redis engine delegated to that client. The mongoose engine
 *     has no `this.client` - it talks to a Mongoose model initialised inside `start()`, which is never
 *     called here - so the in-memory store now sits directly behind the engine's OWN async contract:
 *     `get(key) -> {item, stored, ttl} | null`, `set(key, value, ttl)`, `drop(key)`, keyed on
 *     `segment:id` exactly as the engine's private `_generateKey` does.
 *
 * The baseline's `setTimeout`-based `expire` is deliberately NOT carried over: catbox never calls `expire`
 * on an engine - it passes the TTL to `set` and enforces it itself, comparing `stored + ttl` against the
 * clock in `client.get`. The lazy delete-on-read below mirrors the real engine's own expiry check, which
 * `lib/util/catbox-mongoose.js` documents as the effective mechanism, so cache semantics are unchanged
 * while no timers are created to keep the event loop alive.
 *
 * Only the five methods the suite can actually reach are stubbed. `stop` and `validateSegmentName` are
 * left alone because the real implementations already work without a started backend, and over-stubbing
 * would hide a genuine regression in them.
 */

var catbox = require('../../lib/util/catbox-mongoose'),
    sinon  = require('sinon'),
    cache  = {};

/**
 * Builds the composite key the real engine uses, so a test that inspects the store sees the same shape
 * production does.
 *
 * @param {{segment: string, id: string}} key Catbox key.
 * @returns {string} `segment:id` composite key.
 */
function generateKey(key) {
  return key.segment + ':' + key.id;
}

// `isReady` is the gate catbox checks before every operation. The engine's real implementation reads
// `this.isConnected && mongoose.connection.readyState === 1`, and `isConnected` is only ever set inside
// `start()`, so without this the whole suite 500s on the session commit.
sinon.stub(catbox.Engine.prototype, 'isReady').callsFake(function() {
  return true;
});

// The real `start()` registers a Mongoose model. Nothing in the suite starts the server, but stubbing it
// keeps the engine hermetic for any harness that does, and matches `isReady` above.
sinon.stub(catbox.Engine.prototype, 'start').callsFake(async function() {
  this.isConnected = true;
});

sinon.stub(catbox.Engine.prototype, 'get').callsFake(async function(key) {
  var id     = generateKey(key),
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
    item   : record.value,
    stored : record.stored,
    ttl    : record.ttl
  };
});

sinon.stub(catbox.Engine.prototype, 'set').callsFake(async function(key, value, ttl) {
  cache[generateKey(key)] = {
    value  : value,
    stored : Date.now(),
    ttl    : ttl
  };
});

sinon.stub(catbox.Engine.prototype, 'drop').callsFake(async function(key) {
  delete cache[generateKey(key)];
});
