/**
 * Legacy pre-handler conversion for the three declaration shapes the route
 * tables use: an object with a function or string `method`, a bare string of the
 * form 'name(arg1,arg2)', and a bare function.
 *
 * The `server` parameter is permanently undefined, because the route parser calls
 * this with a single argument. It is inert - the string-form wrapper below
 * declares its own `var server = request.server;` and the parameter is never read
 * - and both the signature and the call site stay as they are. See
 * docs/PRESERVED-QUIRKS.md section 1.11.
 *
 * @module lib/http/preHandlers
 */

var Boom = require('@hapi/boom');

// `log` is the undeclared global assigned in app.js, used without being required.

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
        // `assignName` is never read; the returned `assign` comes from
        // preHandler.assign below.
        var assignName = preHandler.assign;
        var wrappedMethod = async function(request, h) {
          return new Promise(function(resolve, reject) {
            // Create a fake reply function that captures the result
            //
            // SETTLE-FIRST: this settles the promise before returning the
            // chainable object, so `takeover()`'s resolve is a no-op and the
            // redirect bookkeeping object it builds has no consumers. The
            // pre-handler redirect chains in lib/util/helpers.js therefore emit no
            // redirect at all - findTrinket, courseBySlug and
            // trinketByOwnerAndSlug resolve to null, toLowerCaseURI to ''. See
            // docs/PRESERVED-QUIRKS.md section 3.12.
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
      // below, keeping preHandler.assign. No route currently declares this shape.
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
          // Second copy of the settle-first fakeReply; see the note above. The two
          // copies are kept separate rather than factored together.
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
