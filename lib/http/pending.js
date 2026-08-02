/**
 * The THIRD terminal outcome of a hapi 21 route handler: no response at all.
 *
 * WHY THIS MODULE EXISTS
 * The retired compatibility layer in lib/util/routeParser.js captured a handler's response
 * out of band. Its wrapper read
 *
 *     var result = await handler.call(this, request, reply);
 *     if (result === undefined) {
 *       result = await responsePromise;   // settled ONLY by the synthetic reply()
 *     }
 *
 * so a handler that neither returned a value nor reached a settling responder left that
 * deferred promise unsettled and the request received NO RESPONSE AT ALL. Several controller
 * branches end that way at the base commit - a chain with no `else`, an identifier that was
 * never declared, a responder built but never terminated, a callback whose own throw escaped
 * into machinery that owned nothing. Under the native contract the same branch resolves
 * `undefined`, hapi raises "handler method did not return a value, a promise, or throw an
 * error", and the centralized error map answers a 500 - a status no baseline request on those
 * branches ever received.
 *
 * WHICH BRANCHES THESE ARE IS A MEASURED QUESTION, NOT AN INFERRED ONE. A branch only belongs
 * here once it has been reproduced against a verbatim replica of the base-commit wrapper on
 * @hapi/hapi 20.3.0 and observed to answer nothing. The distinction matters because the
 * synthetic responder was far more forgiving than it looks: `request.success({ x: undefined })`
 * still settled, since ObjectUtils.serialize simply drops undefined keys, so an error-ignoring
 * callback that reached a responder answered HTTP 200 rather than hanging. Every branch that
 * uses this module carries its measurement in docs/PRESERVED-QUIRKS.md section 1.15; branches
 * that were measured to answer 200 keep answering 200 and do not appear there.
 *
 * R-4 forbids behaviour "improvements" and R-6 makes the base commit's observed behaviour the
 * tie-breaker for exactly this kind of ambiguity, so those branches keep answering nothing.
 * The Technical Specification sets the precedent itself in section 0.1.1.4 I4: the two
 * property-form `reply.redirect` calls in lib/controllers/pages.js produce a 500 only because
 * of a defect in the shim, and converting them into working redirects is called out there as a
 * PROHIBITED behaviour change. An emergent outcome of the shim is preserved, not converged.
 *
 * WHAT THIS IS NOT
 * This is not the deferred-capture machinery coming back. Nothing here observes a handler, and
 * nothing here can turn a later `request.success()` into a response: the value below is inert.
 * A branch that answers nothing says so explicitly, in one line, at the call site - which is
 * also why every use of it is greppable and individually documented.
 *
 * MEASURED SEMANTICS (verified against a live @hapi/hapi 21.4.10 server over real HTTP)
 * Returning this value from a handler, a pre-handler or a promise chain a handler returns:
 *   - the client receives no response and no status code; the request stays open exactly as it
 *     did at the base commit, until the client gives up;
 *   - the server keeps running - `server.listener.listening` stays true - and every subsequent
 *     request on other routes is served normally. The effect is scoped to the one request;
 *   - nothing is logged and no error is raised, which matches the base commit: an ignored
 *     callback error produced no log line either.
 *
 * A FRESH promise is returned per call rather than one module-level singleton, so a hung
 * request's continuation is retained by that request alone and is released with it, instead of
 * accumulating reactions on a process-lifetime object.
 *
 * USAGE
 *   var Pending = require('../http/pending');
 *   …
 *   catch (saveError) {
 *     // baseline ignored this error and answered nothing - see docs/PRESERVED-QUIRKS.md
 *     return Pending.forever();
 *   }
 *
 * @see docs/PRESERVED-QUIRKS.md - the catalogue of preserved defects, including every branch
 *      that answers nothing and the measurement behind each one.
 *
 * ---------------------------------------------------------------------------
 *
 * Preserve a baseline branch that never produced an HTTP response.
 *
 * WHY THIS MODULE EXISTS
 *
 * Before the hapi API migration, every controller handler published its response
 * as a SIDE EFFECT through the compatibility shim's synthetic `reply`, and the
 * shim awaited a deferred promise that the side effect resolved
 * (lib/util/routeParser.js:L332-L335 and :L568-L570 at the base commit). A branch
 * that reached no responder at all therefore left that deferred unsettled, and
 * the request stayed PENDING for as long as the client held the socket open: no
 * status line, no body, no `Set-Cookie`, nothing.
 *
 * There are roughly twenty such branches, and every one of them is a 2013-era
 * defect: a missing `else`, an `err` argument the callback declared and ignored,
 * a detached promise chain nobody awaited, a third callback argument handed to an
 * arity-two function. R-4 forbids repairing them and R-6 makes the base commit's
 * observed behavior the tie-breaker, so "the request hangs" is the contract.
 *
 * Returning `undefined` from a hapi 21 handler is NOT that contract. Measured on
 * @hapi/hapi 21.4.10 over real HTTP: a handler that resolves `undefined` makes
 * hapi raise `method did not return a value, a promise, or throw an error`, which
 * lib/http/errorMap.js then maps onto a scrubbed HTTP 500. Converging a hang onto
 * a 500 is a status-code change on a route that had no status code, which is
 * exactly the TR2/R-4 violation this module prevents.
 *
 * HOW IT WORKS
 *
 * hapi awaits whatever a handler returns. A promise that never settles therefore
 * leaves the request in the same state the unsettled deferred left it in. This was
 * measured, not assumed: a route returning `new Promise(function () {})` on
 * @hapi/hapi 21.4.10 produced no response at all, and the client aborted. No route
 * in this application sets a server timeout - `route.settings.timeout` measures as
 * `{ server: false }` on every one of the 233 rows - so nothing converts the wait
 * into a 503 either.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 *
 * Several of the preserved branches did more than hang at baseline. Where the
 * ignored error came from a Mongoose callback, Mongoose invoked the callback with
 * the document ABSENT (see node_modules/mongoose/lib/helpers/promiseOrCallback.js:
 * on error it calls `callback(error)` with a single argument), the callback body
 * dereferenced the missing document, and Mongoose re-threw that `TypeError` through
 * `immediate()` - an uncaught exception that terminated the process, since nothing
 * in this repository installs an `uncaughtException` handler.
 *
 * `hang()` reproduces the HTTP fate of those branches and NOT the process
 * termination. That is an explicit R-6 adjudication, recorded in
 * docs/PRESERVED-QUIRKS.md: deliberately killing a shared server process is not an
 * implementable route behavior, whereas the pending request is, and the pending
 * request is the part a client can observe. The adjudication is documented rather
 * than silently taken.
 *
 * USAGE
 *
 *   var Pending = require('../http/pending');
 *   ...
 *   catch (saveError) {
 *     // R-6: baseline ignored this error and produced no response at all.
 *     return Pending.hang();
 *   }
 *
 * Always `return` it. Calling it without returning resolves the handler with
 * `undefined` and produces the very 500 this module exists to avoid.
 *
 * @module lib/http/pending
 */

/**
 * A promise that never settles, reproducing a base-commit branch that produced no response.
 *
 * @returns {Promise} A promise that is neither resolved nor rejected, ever.
 */
function forever() {
  return new Promise(function() {});
}

/**
 * Alias of forever(). Both spellings are in use across lib/controllers/, and both
 * return a fresh never-settling promise.
 *
 * @returns {Promise} A promise with no resolve and no reject path.
 */
function hang() {
  return forever();
}

/**
 * Invoke the failure responder exactly as the base commit did, from a call site the
 * base commit reached from an ORPHANED callback, and preserve the fate of the raise
 * that a raw Error payload provokes.
 *
 * WHY THIS IS NEEDED
 *
 * `lib/http/responseContract.js#reject` - published as `h.reject`, and published by
 * the retired shim as `request.fail` (lib/util/routeParser.js:L482-L513 at the base
 * commit, byte-for-byte the same terminal statement) - ends its default branch in
 * `h.response(json)`. hapi 21 refuses to wrap an Error in a response: measured on
 * @hapi/hapi 21.4.10, `h.response(new TypeError('boom'))` raises
 * `AssertError: Cannot wrap an error`. So handing the responder a RAW ERROR does not
 * produce a failure payload at all - it makes the responder itself throw, and it did
 * so at the base commit too.
 *
 * What differs is only where that raise landed. At the base commit these call sites
 * were reached from callbacks nobody owned, and the raise could not become a
 * response:
 *
 *   - `lib/models/model.js#findById(id, cb)` runs `promise.then(function (doc) {
 *     cb(null, doc); }).catch(cb)`. Nothing consumes that chain, so the AssertError
 *     became an unhandled rejection. (Measured side effect of the same shape: when
 *     the FIRST invocation's body throws, `.catch(cb)` invokes the callback a SECOND
 *     time with that error - verified directly.)
 *   - a Mongoose document `save(cb)` re-throws a callback's exception through
 *     `immediate()`, an uncaught exception with no handler anywhere in this tree.
 *   - a csv/stream callback throws into the emitter.
 *
 * In every one of those positions the shim's deferred was never settled, so the
 * REQUEST RECEIVED NO RESPONSE. Letting the AssertError propagate out of a native
 * async handler instead hands it to lib/http/errorMap.js, which answers a scrubbed
 * 500 - a status those branches never carried.
 *
 * TRANSPARENCY ON EVERY NON-RAISING PATH
 *
 * This wrapper changes nothing when the responder does not raise. A plain-object
 * payload answers its usual HTTP 200; an html request on a route declaring
 * `fail.redirect` answers its 302; an html request on a route declaring `fail.html`
 * renders its view. Those responses are returned unchanged, so the wrapper is
 * observable only on the raise path it exists to preserve.
 *
 * WHERE NOT TO USE IT
 *
 * Only where the base commit invoked the responder from an orphaned callback. Where
 * the base commit RETURNED the chain containing the responder call from the handler
 * frame, the AssertError rejected that returned chain, the shim's own catch-all saw
 * it, and the branch answered a genuine 500 - which it must keep answering.
 *
 * @param {Object} h The hapi response toolkit, already carrying `h.reject`.
 * @param {*} json The payload the base commit passed as the responder's first argument.
 * @param {*} [err] The base commit's second argument, preserved including its absence.
 * @returns {Object|Promise} The responder's response, or a never-settling promise.
 */
function rejectOrHang(h, json, err) {
  try {
    return h.reject(json, err);
  }
  catch (cannotWrapAnError) {
    return hang();
  }
}

module.exports = {
  forever      : forever,
  hang         : hang,
  rejectOrHang : rejectOrHang
};
