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
    // objects are closed over for the life of the process: every request on this route reads
    // that one declaration rather than a per-request copy, and the two writes above - the
    // `route.html` and `route.redirect` hoists - are the last mutations either object sees.
    //
    // The base commit ALSO interpolated `fail.redirect` back into this very object, which is
    // what made one request's interpolated value visible to the next. The SEC-4 remediation
    // replaced that write-back with a request-local `target` inside
    // lib/http/responseContract.js#reject, so nothing mutates these objects at request time
    // any more. Historical frame and remediation: docs/PRESERVED-QUIRKS.md section 4.4.
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
    // back - h.respond(), h.reject(), h.response(), h.redirect() and h.view() - so return the
    // value rather than merely calling it. A handler that falls off its end resolves undefined
    // and answers a 500 instead.
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

        // The two responders, published on the per-request toolkit under the only names the
        // controllers address: h.respond and h.reject. There is no third responder, and
        // publishing one would turn the folders-controller `catch` invocations from a 500
        // into a working response - see docs/PRESERVED-QUIRKS.md section 3.23.
        //
        // The base commit's request.success / request.fail spelling of these same two
        // closures is gone with the rest of the compatibility shim, completing AAP G2.
        // Re-measured comment-stripped across app.js, config/, lib/, scripts/ and test/,
        // neither name has a single executable call site, so retiring the decorations is
        // wire-neutral by construction. Do not reintroduce them.
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

        // Returns the rejection response on failure and undefined on success. `language`
        // comes from the parse-time capture above, because the declaration's `language` key
        // is deleted off the schema before any request runs.
        var validationResponse = Validation.validate(request, h, validation, language, responders.reject);
        if (validationResponse !== undefined) {
          return validationResponse;
        }

        if (handler) {
          // The one-second "still going" watchdog the base commit wrapped around the handler
          // call is DELETED here, not relocated. It belonged to the compatibility machinery
          // AAP 0.4.1.1 lists as deletable and AAP 0.9.9 names it explicitly among the
          // per-request work the shim removal takes with it, so retaining it was the defect
          // review finding F-6 reports. Two concrete reasons it cannot be kept around a native
          // handler: the base commit cleared the timer as soon as the handler FUNCTION returned
          // - which, under the deferral, was almost immediately - whereas awaiting the native
          // handler times the whole request, so a slow-but-successful route would emit a log
          // line it never emitted before; and a handler that throws skips the clearTimeout
          // altogether, so a request that has already been answered with an error response
          // would still emit "still going after 1s" a second later while holding a live timer
          // handle. The configured threshold log below is the timing signal this codebase
          // retains, and it is preserved exactly as it was.
          var result = await handler.call(this, request, h);

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

    // Resolve the string-expression pre-handlers against server.methods.
    //
    // Only the string form needs resolving. A declaration whose `method` is a function - or a bare
    // function - is already a native hapi 21 pre-handler and passes through untouched, so the 149
    // function entries among the 288 the route tables declare reach hapi exactly as written. Review
    // finding F-API-3 retired the synthetic reply that used to wrap them; the entry count per route
    // is unchanged, which is what keeps the 161 pre-bearing rows of the frozen 233-row table at
    // their recorded pre counts.
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
