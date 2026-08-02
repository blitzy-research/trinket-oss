/**
 * Centralized error-to-response mapping: the one place where a value thrown by a
 * route handler becomes an HTTP response.
 *
 * There is no isBoom pass-through, so a thrown Boom is not forwarded as itself -
 * every truthy value becomes a badImplementation 500 whose message hapi replaces
 * with 'An internal server error occurred'.
 *
 * @module lib/http/errorMap
 */
var Boom = require('@hapi/boom');

/**
 * @param {*} err The caught value; not necessarily an Error, hence String(err).
 * @returns {Object|undefined} A Boom 500 for a truthy value, undefined otherwise.
 */
function toResponse(err) {
  // The truthiness guard means `throw undefined` produces no return value at all,
  // and the caller passes that undefined straight through. `log` is the
  // undeclared global assigned in app.js.
  if (err) {
    if (err.stack) {
      log.error(err.stack);
    }
    else {
      log.error(String(err));
    }

    return Boom.badImplementation(err.message || String(err));
  }
}

module.exports = {
  toResponse : toResponse
};
