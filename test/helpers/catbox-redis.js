/**
 * In-memory replacement for the session cache engine, so the suite needs no started cache backend.
 *
 * WHY THIS FILE EXISTS, AND WHY IT LOOKED BROKEN
 * ---------------------------------------------
 * At the base commit line 1 required the UNSCOPED `catbox-redis` package, which is declared nowhere in
 * package.json and installed nowhere, and line 6 installed the three-argument stub form
 * `stub(catbox.prototype, 'isReady', fn)`, removed in Sinon 3. That require was the suite's very first
 * module load, so `npm test` exited non-zero with `Cannot find module` for it before a single test ran.
 *
 * Its PURPOSE, however, is load-bearing and still required. `config/test.yaml:3` sets `app.start: false`,
 * so `app.js:315` never reaches `await server.start()` - and `server.start()` is what starts hapi's cache
 * provisions. `server.initialize()` appears nowhere in the repository. Measured by counting invocations
 * across a full `app.js` boot: `Engine.prototype.start()` is called ZERO times, so `this.isConnected`
 * stays false and the engine's module-scoped `Session` model stays `undefined`. An unstarted catbox
 * client then fails a hard gate: `@hapi/catbox@12.1.1/lib/client.js:104` throws
 * `Boom.internal('Disconnected')` from its `[validate]` step ahead of every get/set/drop whenever
 * `connection.isReady()` is falsy, and `@hapi/yar@11.0.3` defaults `errorOnCacheNotReady` to true
 * (`lib/index.js:20`, which app.js does not override), so both its session load (`lib/index.js:143`) and
 * its `onPreResponse` commit (`lib/index.js:299`) reach that throw. Measured with this helper absent:
 * `GET /`, `GET /login` and `GET /signup` all answer 500 `Error: Disconnected`. Restoring this helper is
 * therefore what makes the whole flow-based suite reachable at all.
 *
 * WHAT CHANGED, AND WHY THIS IS THE FAITHFUL TRANSLATION
 * -----------------------------------------------------
 * The engine underneath changed, so the stub had to follow it:
 *   - the require is repointed at the engine the application actually configures,
 *     `lib/util/catbox-mongoose.js`, which `app.js:36` loads and `app.js:77-83` installs as the
 *     `sessions` cache provider. It exports a named `Engine` CLASS - `{ Engine }` - so the stub target
 *     moves from a bare `catbox.prototype` to `CatboxMongoose.Engine.prototype`. Sinon 22 makes that
 *     distinction fatal rather than silent: `sinon.stub(obj, 'missingMethod')` throws
 *     `TypeError: Cannot stub non-existent property`, so a stub aimed at the wrong object fails loudly
 *     at load time instead of quietly doing nothing;
 *   - the three-argument stub form `stub(obj, 'method', fn)` becomes
 *     `sinon.stub(obj, 'method').callsFake(fn)`, matching `test/helpers/store.js:9`;
 *   - the baseline stub injected a `self.client` carrying a Redis-shaped, callback-style
 *     `get`/`set`/`del`/`expire`, because the catbox-redis engine delegated to that client. The mongoose
 *     engine has no `this.client` - it talks to a Mongoose model created inside `start()`, which is never
 *     called here - so the in-memory store now sits directly behind the engine's OWN async contract:
 *     `get(key) -> {item, stored, ttl} | null`, `set(key, value, ttl)` and `drop(key)`. Keys are built by
 *     calling the engine's real `_generateKey`, so a stored entry carries exactly the `segment:id` shape
 *     production uses rather than a second, independently maintained copy of that join.
 *
 * Only the four methods the suite actually reaches are stubbed. `start` and `stop` are left real because
 * nothing invokes them, measured above. `validateSegmentName` is left real because catbox does call it -
 * at policy-provisioning time during `await server.register([... Yar ...])`, independently of `start()` -
 * and the real implementation already answers `null` for a valid segment string. Stubbing more than is
 * reached would hide a genuine regression in the parts that still run for real.
 *
 * TWO CORRECTIONS THAT ARE INVISIBLE AND WOULD OTHERWISE BREAK EXPIRY SILENTLY
 * ---------------------------------------------------------------------------
 *   - UNITS. The baseline's `setTimeout(..., time * 1000)` existed because redis `EXPIRE` takes SECONDS.
 *     Catbox deals in MILLISECONDS: yar commits with `cache.set(id, store, 0)` (`yar/lib/index.js:299`)
 *     and `@hapi/catbox/lib/policy.js:311` substitutes the policy's own `expiresIn` for that `0`, which
 *     is `app.js:104`'s `24 * 60 * 60 * 1000`, that is 86400000. The `* 1000` is therefore dropped;
 *     carrying it forward would push every session expiry a thousand times too far out.
 *   - NO TIMER. Catbox never calls `expire` on an engine. It hands the TTL to `set` and enforces it
 *     itself in `catbox/lib/client.js:68-71`, comparing `stored + ttl` against the clock, and the real
 *     engine re-checks the same envelope on read. The lazy delete-on-read below mirrors that check, so
 *     cache semantics are unchanged while no `setTimeout` is created to hold the event loop open.
 *
 * `expires` below is deliberately kept exactly as the base commit declared it, even though the timer it
 * served is gone. It is an implicit global, and Mocha's `check-leaks` baseline is snapshotted after the
 * helpers load, so removing it would change what that check sees. See docs/PRESERVED-QUIRKS.md section
 * 3.7 for the full adjudication - including why the base commit offers no observed cache behaviour to
 * defer to, and why the prime testing directive governs here instead.
 */

var CatboxMongoose = require('../../lib/util/catbox-mongoose'),
    sinon  = require('sinon'),
    cache  = {};
    expires = {};

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
    item   : record.item,
    stored : record.stored,
    ttl    : record.ttl
  };
});

sinon.stub(CatboxMongoose.Engine.prototype, 'set').callsFake(async function(key, value, ttl) {
  cache[this._generateKey(key)] = {
    item   : value,
    stored : Date.now(),
    ttl    : ttl
  };
});

sinon.stub(CatboxMongoose.Engine.prototype, 'drop').callsFake(async function(key) {
  delete cache[this._generateKey(key)];
});
