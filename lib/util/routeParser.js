// Eleven of the thirteen bindings below are unused in this file, deliberately, and must not be
// deleted. Nine went unused when the shim's behavior moved into lib/http/*, which is where their
// consumers - and so the bindings themselves - now live; crypto and HAS_EXT were already unused at
// the base commit. The only entries this require chain gave up are the ones
// docs/MIGRATION-DEPENDENCY-INVENTORY.md records: the dead packages tab and optimist, and node:url
// with the move to the static URL.parse. The census, binding by binding, and the reasoning:
// docs/PRESERVED-QUIRKS.md section 3.46.
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

    // Built once here, at parse time, so the route's own `success` and `fail` declaration objects
    // are closed over for the life of the process: every request on this route reads that one
    // declaration rather than a per-request copy, and the two writes above - the `route.html` and
    // `route.redirect` hoists - are the LAST mutations either object sees. Nothing may mutate them at
    // request time; lib/http/responseContract.js#reject interpolates into a request-local instead.
    // See docs/PRESERVED-QUIRKS.md section 4.4.
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
        // controllers address: h.respond and h.reject. There is no third responder, and publishing
        // one would turn the folders-controller `catch` invocations from a 500 into a working
        // response - see docs/PRESERVED-QUIRKS.md section 3.23.
        //
        // The negotiated type is both stashed on the request - lib/http/validation.js calls the
        // rejection responder without one - and passed explicitly, which wins.
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
    }

    // Resolve the string-expression pre-handlers against server.methods.
    //
    // Only the string form needs resolving: a declaration whose `method` is a function, or a bare
    // function, is already a native pre-handler and passes through untouched. The entry count per
    // route is unchanged either way, which is what keeps the frozen route table's per-row pre counts
    // where they are.
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
