var util        = require('util'),
    Joi         = require('joi'),
    Boom        = require('@hapi/boom'),
    config      = require('config'),
    _           = require('underscore'),
    crypto      = require('crypto'),
    fs          = require('fs'),
    path        = require('path'),
    accepts     = require('accepts'),
    ObjectUtils = require('./objectUtils'),
    HAS_EXT     = /\.[a-z]+$/,
    JSON_EXT    = /\.json$/,
    StringUtils = require('./stringUtils');

// The request-lifecycle modules. lib/http/redirect.js is not required here: every
// declarative redirect is built inside lib/http/responseContract.js, which requires it.
var ErrorMap         = require('../http/errorMap'),
    Validation       = require('../http/validation'),
    PreHandlers      = require('../http/preHandlers'),
    ResponseContract = require('../http/responseContract'),
    StaticRoutes     = require('../http/staticRoutes');

function parseRoutes(routeConfigs) {
  var routes = [];

  StaticRoutes.addStaticPages(routes);

  routeConfigs.forEach(function(route, index) {
    // temporary way to enable routes with option in config/routes (during "alpha")
    // could be used later as a way to disable routes/features until ready
    if (config.isProd && typeof(route.enable) !== 'undefined' && !route.enable) return;
    delete route.enable;

    var routeInfo    = route.route.split(/\s+/),
        ctrlPath     = (routeInfo[2] || '').split('.'),
        controller   = ctrlPath[0],
        handlerName  = ctrlPath[1],
        validation   = route.config && route.config.validate,
        language     = (validation && validation.language) || {},
        extensions   = route.ext     || false,
        success      = route.success || {},
        replySpec    = route.reply,
        fail         = route.fail    || {},
        cookie       = false,
        handler;

    if (controller) {
      handler = require('../controllers/' + controller)[handlerName];
    }

    if (validation) {
      delete(validation.language);
    }

    delete(route.route);
    delete(route.success);
    delete(route.fail);
    delete(route.ext);
    delete(route.reply);

    // Hapi 20+ uses 'options' instead of 'config'
    if (route.config) {
      route.options = route.config;
      delete route.config;
    }
    if (route.options) {
      delete(route.options.validate);

      // set cors to true only for routes that should allow it
      if (!route.options.cors) {
        route.options.cors = false;
      }
    }

    if (route.html) {
      success.html = route.html;
      delete(route.html);
    }
    if (route.redirect) {
      success.redirect = route.redirect;
      delete(route.redirect);
    }
    if (route.cookie) {
      cookie = true;
      delete(route.cookie);
    }

    // Built once here, at parse time, so the route's own `success` and `fail` declaration
    // objects are closed over for the life of the process. That lifetime is load bearing:
    // the rejection path interpolates `fail.redirect` back into this very object, and the
    // write is observable across requests only because the closure outlives any one of them.
    var responders = ResponseContract.createResponders({
      success    : success,
      fail       : fail,
      replySpec  : replySpec,
      extensions : extensions
    });

    route.method  = routeInfo[0];
    route.path    = routeInfo[1];

    // Hapi 20+ handler signature: async (request, h)
    //
    // HANDLER RETURN CONTRACT: a handler must return its response. Every responder hands one
    // back - request.success(), request.fail(), h.respond(), h.reject(), h.response(),
    // h.redirect() and h.view() - so return the value rather than merely calling it. A
    // handler that falls off its end resolves undefined and answers a 500 instead.
    route.handler = async function(request, h) {
      var label = request.yar.id + request.url.pathname.replace(/\//g, '-')
        , times = {};

      if (request.user) {
        label += '-' + request.user.id;
      }

      if (config.app.log.debug && config.app.log.debug.routehandlertiming) {
        times = {};
        times[label] = Date.now();
      }

      var loginAs      = request.yar.get('loginAs') || undefined
        , responseType = accepts(request).types(['html', 'json'])
        , validationErrors
        , validationError
        , userPromise, userId;

      if (loginAs && request.user && request.user.hasRole && request.user.hasRole("admin")) {
        userPromise = User.findById(loginAs);
      }
      else {
        userPromise = Promise.resolve();
      }

      try {
        var user = await userPromise;

        // admin logged in as another user
        if (user) {
          userId                   = request.user.id;
          request.user             = user;
          request.user._realUserId = userId;
        }

        if (cookie) {
          request.cookie = true;
        }

        // The two responders, published under the names the controllers address and aliased
        // onto the toolkit so both surfaces work. There is no third responder, and
        // publishing one would turn the folders-controller `catch` invocations from a 500
        // into a working response - see docs/PRESERVED-QUIRKS.md section 3.23.
        //
        // The negotiated type is both stashed on the request - lib/http/validation.js calls
        // the rejection responder without one - and passed explicitly, which wins.
        request.responseType = responseType;

        h.respond = function(json) {
          return responders.respond(request, h, json, responseType);
        };

        h.reject = function(json, err) {
          return responders.reject(request, h, json, err, responseType);
        };

        // The same two closures are additionally published on the request itself, as
        // request.success and request.fail. That was the base commit's spelling, and it is
        // retained because both spellings are live in lib/controllers/: whichever name a call
        // site uses, it reaches the identical closure, so the surface is wire-neutral by
        // construction. h.respond and h.reject above are the native-toolkit surface and the
        // one new code should use; these two are the compatibility spelling of exactly the
        // same functions, not a second implementation.
        request.success = h.respond;
        request.fail    = h.reject;

        // Returns the rejection response on failure and undefined on success. `language`
        // comes from the parse-time capture above, because the declaration's `language` key
        // is deleted off the schema before any request runs.
        var validationResponse = Validation.validate(request, h, validation, language, responders.reject);
        if (validationResponse !== undefined) {
          return validationResponse;
        }

        if (handler) {
          // The one-second "still going" watchdog, kept because it is independent
          // application behaviour rather than compatibility machinery: it is the only signal
          // this codebase emits for a handler that is slow but has not failed, and it fires
          // whether or not routehandlertiming is enabled - unlike the `times[label]`
          // threshold log below, which is configuration gated. Restored around the NATIVE
          // handler call with no deferral, no synthetic reply and no promise race.
          //
          // The `.bind(label)` and `this.toString()` pair is reproduced verbatim: in sloppy
          // mode the bound string primitive is boxed, so the log line carries the label
          // exactly as it always did. (A strict callback would receive the primitive and emit
          // the same text, so the bound baseline form is retained without resting on that
          // distinction.) The timer is a ONE-SHOT setTimeout at exactly 1000 ms, unconditional
          // like the base commit's, and it is cleared immediately after the await, so a handler
          // that answers inside a second logs nothing.
          //
          // One log-only difference is inherent to the return contract and is accepted rather
          // than engineered around: the base commit timed only the handler FUNCTION, so a
          // bare-statement handler returned before the timer fired and a request that then
          // hung on the deferral logged nothing. Timing the native handler means a branch that
          // answers nothing (Pending.forever()) now emits this one line. Nothing
          // client-visible changes - no status, header or body is affected either way.
          var handlerTimer = setTimeout(function() {
            log.info(this.toString(), 'still going after 1s');
          }.bind(label), 1000);

          var result = await handler.call(this, request, h);

          if (handlerTimer) {
            clearTimeout(handlerTimer);
          }

          if (label && times[label]) {
            var endTime = Date.now() - times[label];

            // 10ms
            if (endTime > 10) {
              log.info(label + ': ' + endTime + 'ms');
            }

            delete times[label];
          }

          return result;
        }
        else {
          return h.respond(request.params);
        }
      }
      catch(err) {
        // The single error sink for every route. Whatever the map returns is returned as-is,
        // including the undefined it yields for a falsy caught value.
        return ErrorMap.toResponse(err);
      }
    } // end handler

    // Convert pre-handlers to Hapi 20+ format
    //
    // Called with one argument against a two-parameter declaration, leaving that module's
    // `server` parameter undefined; it is inert. See docs/PRESERVED-QUIRKS.md section 1.11.
    if (route.options && route.options.pre) {
      route.options.pre = PreHandlers.convertPreHandlers(route.options.pre);
    }

    routes.push(route);

    // The `.json` twin of a route that declares `ext`. No route declares one today, so this
    // emits nothing as configured; populating `ext` would move the route table off its frozen
    // 233 rows.
    if (extensions) {
      var copy = {};
      for(var key in route) {
        copy[key] = route[key];
      }
      copy.path += '.json';
      routes.push(copy);
    }
  });

  StaticRoutes.addStaticRoutes(routes);

  return routes;
}

module.exports = {
  parse : parseRoutes
};
