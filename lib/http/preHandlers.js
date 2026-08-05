/**
 * String-expression pre-handler resolution for the route-table DSL.
 *
 * config/routes.js and config/api_routes.js declare pre-handlers in three shapes, and only ONE of
 * them needs translating:
 *
 *   1. a bare string, 'name(arg1,arg2)'                       -> resolved here against server.methods
 *   2. an object carrying a string method, { method : 'name(a)', assign : 'x' }   -> resolved here
 *   3. an object carrying a FUNCTION method, or a bare function                  -> passed straight
 *      through, because those functions are already native hapi pre-handlers
 *
 * Shape 3 is handed to hapi exactly as declared, `assign` and all. Every declared function is
 * `async (request, h)`, none reads `h`, and every branch returns an explicit value - a document, an
 * array, `null`, `''`, or a Boom object. A RETURNED Boom matters: hapi treats it like a thrown one,
 * which is what produces the feature-flag 404s through helpers.trinketTypeEnabled.
 *
 * WHAT MUST NOT BE "COMPLETED". The three slug/lang chains in lib/util/helpers.js - findTrinket,
 * courseBySlug and trinketByOwnerAndSlug - compute a `location` and then `return null`, and
 * toLowerCaseURI returns `''`. They emit NO redirect, and turning any of them into a working
 * `h.redirect(location).permanent().takeover()` would introduce a 301 that has never existed on a
 * live route surface. See docs/PRESERVED-QUIRKS.md sections 3.12 and 1.11.
 *
 * @module lib/http/preHandlers
 */

var Boom = require('@hapi/boom');

// `log` is the undeclared global assigned in app.js, used without being required.

/**
 * Resolve the route-table pre-handler declarations into hapi 21 `pre` entries.
 *
 * String form: 'methodName(arg1,arg2)' or { method : 'methodName(arg1,arg2)', assign : 'result' }
 * becomes { method : async (request, h) => server.methods.methodName(...), assign : 'result' }.
 * Function form is already a hapi 21 pre-handler and is returned untouched.
 *
 * @param   {Array|*} pre The declared `pre` value; a non-array is returned unchanged.
 * @returns {Array|*} A new array of hapi 21 pre entries, or the untouched input.
 */
function convertPreHandlers(pre) {
  if (!pre || !Array.isArray(pre)) return pre;

  return pre.map(function(preHandler) {
    var methodString, assign;

    // Handle object format: { method: 'isAdmin(user)', assign: 'admin' }
    // or { method: async (request, h), assign: 'name' }
    if (typeof preHandler === 'object' && preHandler.method) {
      if (typeof preHandler.method === 'function') {
        // Already a native pre-handler: handed over as it stands, which keeps `assign` - and any
        // other key hapi understands - exactly as the route declared it.
        return preHandler;
      }
      // Object form carrying a STRING method: falls through to the string parser below, keeping
      // preHandler.assign. No route currently declares this shape.
      methodString = preHandler.method;
      assign = preHandler.assign;
    }
    // Handle string format: 'isAdmin(user)'
    else if (typeof preHandler === 'string') {
      methodString = preHandler;
      // Extract assign name from method name (e.g., 'isAdmin' from 'isAdmin(user)')
      var match = methodString.match(/^(\w+)/);
      assign = match ? match[1] : undefined;
    }
    else if (typeof preHandler === 'function') {
      // The bare-function shape, which config/api_routes.js uses for helpers.verifyEmailToken. hapi
      // accepts a lifecycle method as a `pre` entry directly and stores no value for it.
      return preHandler;
    }
    else {
      return preHandler;
    }

    // Parse method string: 'methodName(arg1, arg2)'
    var parsed = methodString.match(/^(\w+)\(([^)]*)\)$/);
    if (!parsed) {
      log.warn('Unable to parse pre-handler string:', methodString);
      return preHandler;
    }

    var methodName = parsed[1];
    var argStrings = parsed[2] ? parsed[2].split(/\s*,\s*/) : [];

    // Create wrapper function that resolves arguments from request
    var method = async function(request, h) {
      var server = request.server;
      var serverMethod = server.methods[methodName];

      if (!serverMethod) {
        log.error('Pre-handler method not found:', methodName);
        throw Boom.internal('Pre-handler method not found: ' + methodName);
      }

      // Resolve arguments from request context
      var args = argStrings.map(function(argStr) {
        argStr = argStr.trim();

        if (argStr === '') return undefined;

        // Handle dot notation: user, params.courseId, query.with, pre.course, etc.
        var parts = argStr.split('.');
        var obj = request;

        // Special case: 'user' without prefix means request.user
        if (parts.length === 1 && parts[0] === 'user') {
          return request.user;
        }

        for (var i = 0; i < parts.length; i++) {
          if (obj === undefined || obj === null) return undefined;
          obj = obj[parts[i]];
        }

        return obj;
      });

      // Call the server method with resolved arguments
      //
      // Arguments are passed positionally with no trailing `next` callback, so
      // every `if (next)` branch in lib/util/helpers.js takes its modern path and
      // the four next(Boom...) sites there stay unreachable. Appending a callback
      // would light up four dormant error paths at once.
      return serverMethod.apply(null, args);
    };

    var result = { method: method };
    if (assign) {
      result.assign = assign;
    }

    return result;
  });
}

module.exports = {
  convertPreHandlers : convertPreHandlers
};
