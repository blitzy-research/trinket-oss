/**
 * Centralized error-to-response mapping.
 *
 * Relocated verbatim from lib/util/routeParser.js:L578-L589 (the compatibility
 * shim's single catch-all) as part of the hapi API migration. This is the ONE
 * place where a thrown error becomes an HTTP response, which is what makes
 * error-mapping parity verifiable in a single file instead of audited across
 * 159 converted handlers.
 *
 * Behavior is moved, not redesigned. All four behaviors of the original block
 * are reproduced in the original order: the truthiness guard, the stack/String
 * logging branch, the Boom construction, and returning rather than throwing.
 *
 * Returning the Boom (rather than throwing it) is deliberate: thrown and
 * returned Boom values were measured wire-equivalent on @hapi/hapi 21, and the
 * shim returned. Downstream, app.js's onPreResponse extension renders any Boom
 * whose output.statusCode is >= 500 as 50x.html for non-API HTML requests, so
 * this map must keep producing a 500.
 *
 * Note: Boom.badImplementation produces a 500, and hapi replaces any 5xx
 * message with 'An internal server error occurred' on the wire. The message
 * text below is therefore invisible to clients, but it is carried across verbatim
 * anyway, because preserving the mapping is the requirement, not shortening it.
 *
 * @module lib/http/errorMap
 */
var Boom = require('@hapi/boom');

/**
 * Map a caught value to the HTTP response the route should produce.
 *
 * `log` is an undeclared global assigned in app.js; it is intentionally NOT
 * required here, matching lib/util/routeParser.js and the rest of lib/.
 *
 * @param {*} err The caught value. Not necessarily an Error: a handler may
 *                throw a string or any other value, which is why the message
 *                falls back to String(err).
 * @returns {Object|undefined} A Boom 500 for any truthy value; undefined for a
 *                             falsy one (see the preserved quirk below).
 */
function toResponse(err) {
  // Preserved quirk: the truthiness guard means a falsy thrown value (e.g.
  // `throw undefined`) produces no return value at all. Preserved deliberately
  // rather than repaired. See docs/PRESERVED-QUIRKS.md.
  if (err) {
    if (err.stack) {
      log.error(err.stack);
    }
    else {
      log.error(String(err));
    }

    // A 500, so hapi scrubs this message on the wire; the text is nonetheless
    // carried across verbatim rather than changed.
    return Boom.badImplementation(err.message || String(err));
  }
}

module.exports = {
  toResponse : toResponse
};
