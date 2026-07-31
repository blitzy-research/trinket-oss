/**
 * Legacy pre-handler conversion.
 *
 * Relocated VERBATIM from lib/util/routeParser.js:L66-L237 as part of the hapi
 * API migration. Nothing in the translation logic changed: this module is a
 * pure move of the compatibility bridge out of the route parser and into the
 * lib/http request-lifecycle layer. It handles the three declaration shapes
 * used by config/routes.js (30 `pre` blocks) and config/api_routes.js (81 `pre`
 * blocks): an object with a function or string `method`, a bare string of the
 * form 'name(arg1,arg2)', and a bare function.
 *
 * 161 of the 233 registered routes carry pre-handlers, so this module has the
 * widest blast radius in lib/http. Every apparent defect below is load-bearing
 * precisely because it does nothing; see the PRESERVED-QUIRKS notes inline.
 *
 * ADJUDICATED (R-6, baseline as tie-breaker): the `server` parameter of
 * convertPreHandlers is permanently `undefined`, because lib/util/routeParser.js
 * invokes this with a single argument (`convertPreHandlers(route.options.pre)`)
 * against a two-parameter declaration. It is provably inert — the string-form
 * wrapper below declares its own `var server = request.server;`, shadowing it,
 * and the outer parameter is never referenced anywhere in this function. The
 * baseline resolution is therefore to keep BOTH the two-parameter signature and
 * the one-argument call site exactly as they are: zero diff, zero behavior
 * change. Do not remove the parameter and do not start using it.
 * See docs/PRESERVED-QUIRKS.md.
 *
 * @module lib/http/preHandlers
 */

var Boom = require('@hapi/boom');

// `log` is a bare undeclared global assigned once in app.js and whitelisted in
// the leak detector there. It is never required anywhere under lib/, so it is
// deliberately NOT required here either — see docs/PRESERVED-QUIRKS.md.

/**
 * Convert Hapi 4.x string pre-handlers to Hapi 20+ format
 * Old format: 'methodName(arg1,arg2)' or { method: 'methodName(arg1,arg2)', assign: 'result' }
 * New format: { method: async (request, h) => server.methods.methodName(...), assign: 'result' }
 */
function convertPreHandlers(pre, server) {
  if (!pre || !Array.isArray(pre)) return pre;

  return pre.map(function(preHandler) {
    var methodString, assign;

    // Handle object format: { method: 'isAdmin(user)', assign: 'admin' }
    // or { method: function(request, reply), assign: 'name' }
    if (typeof preHandler === 'object' && preHandler.method) {
      if (typeof preHandler.method === 'function') {
        // Wrap old-style function(request, reply) to Hapi 20+ style
        var originalMethod = preHandler.method;
        // PRESERVED QUIRK: `assignName` is assigned and never read — the value
        // actually used is `preHandler.assign` at the return below. Retained as
        // dead-but-documented rather than silently dropped, so that the returned
        // `assign` provably still comes from preHandler.assign.
        // See docs/PRESERVED-QUIRKS.md.
        var assignName = preHandler.assign;
        var wrappedMethod = async function(request, h) {
          return new Promise(function(resolve, reject) {
            // Create a fake reply function that captures the result
            //
            // PRESERVED QUIRK — SETTLE-FIRST SEMANTICS. This function settles
            // the promise IMMEDIATELY, before it returns the chainable object
            // below. Consequently `takeover()`'s resolve(redirectResponse) acts
            // on an already-settled promise and is a NO-OP, and the redirect
            // bookkeeping object it builds has ZERO consumers anywhere in the
            // codebase — its only two occurrences are the two construction
            // sites in this file, and nothing ever reads a field off it. The net
            // effect is that the pre-handler redirect chains in
            // lib/util/helpers.js — findTrinket (lang mismatch), courseBySlug
            // and trinketByOwnerAndSlug (slug alias), all of which call
            // `reply().redirect(location).permanent().takeover()` — resolve to
            // null and emit NO redirect at all, while toLowerCaseURI's
            // `reply('').redirect(location).permanent()` resolves to ''.
            // Turning any of these into a working redirect would introduce a
            // 301 that does not exist at baseline; that is a prohibited
            // behavior change. See docs/PRESERVED-QUIRKS.md.
            var fakeReply = function(value) {
              if (value && value.isBoom) {
                reject(value);
              } else {
                // Hapi 20+ requires pre-handlers to return a value (not undefined)
                // Return null instead of undefined to indicate "no value"
                resolve(value === undefined ? null : value);
              }
              // Return chainable object for .redirect(), .takeover(), etc.
              return {
                redirect: function(url) {
                  var redirectResponse = { _isRedirect: true, url: url, _permanent: false, _takeover: false };
                  return {
                    permanent: function() { redirectResponse._permanent = true; return this; },
                    takeover: function() { redirectResponse._takeover = true; resolve(redirectResponse); return this; }
                  };
                },
                takeover: function() { return this; }
              };
            };

            try {
              var result = originalMethod(request, fakeReply);
              // If it returns a promise, wait for it
              if (result && typeof result.then === 'function') {
                result.then(function(val) {
                  resolve(val === undefined ? null : val);
                }).catch(reject);
              } else if (result !== undefined) {
                // If the function returned a value directly (not via fakeReply), resolve with it
                resolve(result);
              }
              // If result is undefined, we wait for fakeReply to be called
            } catch (err) {
              reject(err);
            }
          });
        };
        return { method: wrappedMethod, assign: preHandler.assign };
      }
      // Object form carrying a STRING method: fall through to the string parser
      // below, keeping preHandler.assign. There are currently zero declarations
      // of this shape in config/routes.js or config/api_routes.js, but this is a
      // relocation and not a redesign, so the branch is preserved.
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
      // Wrap old-style function(request, reply) to Hapi 20+ style
      var originalFunc = preHandler;
      var wrappedFunc = async function(request, h) {
        return new Promise(function(resolve, reject) {
          // Second, near-identical copy of the settle-first fakeReply. The two
          // copies are kept separate exactly as the source has them — factoring
          // them together would be an architectural change outside the
          // sanctioned diff. See the settle-first note above and
          // docs/PRESERVED-QUIRKS.md.
          var fakeReply = function(value) {
            if (value && value.isBoom) {
              reject(value);
            } else {
              // Hapi 20+ requires pre-handlers to return a value (not undefined)
              resolve(value === undefined ? null : value);
            }
            return {
              redirect: function(url) {
                var redirectResponse = { _isRedirect: true, url: url, _permanent: false, _takeover: false };
                return {
                  permanent: function() { redirectResponse._permanent = true; return this; },
                  takeover: function() { redirectResponse._takeover = true; resolve(redirectResponse); return this; }
                };
              },
              takeover: function() { return this; }
            };
          };

          try {
            var result = originalFunc(request, fakeReply);
            if (result && typeof result.then === 'function') {
              result.then(function(val) {
                resolve(val === undefined ? null : val);
              }).catch(reject);
            } else if (result !== undefined) {
              // If the function returned a value directly (not via fakeReply), resolve with it
              resolve(result);
            }
            // If result is undefined, we wait for fakeReply to be called
          } catch (err) {
            reject(err);
          }
        });
      };
      // NOTE: no `assign` key at all for the bare-function shape.
      return { method: wrappedFunc };
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
      // PRESERVED QUIRK: the resolved arguments are passed POSITIONALLY and
      // UNCHANGED, and no trailing `next` callback is ever appended. Every
      // legacy `if (next)` / `if (typeof next === 'function')` branch in
      // lib/util/helpers.js therefore takes its modern path, which makes the
      // four next(Boom.…) sites there (L21, L64, L95, L100) unreachable from
      // this code path. Appending a callback would light up four dormant error
      // paths at once. See docs/PRESERVED-QUIRKS.md.
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
