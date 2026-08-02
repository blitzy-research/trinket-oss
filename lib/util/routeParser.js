var util        = require('util'),
    Joi         = require('joi'),
    Boom        = require('@hapi/boom'),
    config      = require('config'),
    _           = require('underscore'),
    crypto      = require('crypto'),
    fs          = require('fs'),
    path        = require('path'),
    accepts     = require('accepts'),
    url         = require('url'),
    ObjectUtils = require('./objectUtils'),
    HAS_EXT     = /\.[a-z]+$/,
    JSON_EXT    = /\.json$/,
    StringUtils = require('./stringUtils');

// The hapi 21 request lifecycle, extracted from the compatibility layer this file used to
// carry. Declared as its own statement so the alignment of the block above is left alone.
// lib/http/redirect.js is deliberately NOT required here: every declarative redirect this
// file used to build now runs inside lib/http/responseContract.js, which requires it
// directly, so a require here would be an unused import.
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

    // The route's declarative response contract, built ONCE HERE at parse time so that the
    // per-route `success` and `fail` declaration objects are closed over for the life of the
    // process. That lifetime is load-bearing rather than incidental: the rejection path
    // interpolates `fail.redirect` back into this very object, and that write is observable
    // across requests only because the closure outlives any one of them.
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
    // HANDLER RETURN CONTRACT. Handlers must return their response. The out-of-band
    // deferral that previously covered non-returning handlers has been removed: there is no
    // longer a synthetic reply to publish a response as a side effect, and no promise to
    // await in its place. A handler that falls off its end resolves undefined, hapi 21
    // raises, and the centralized error map below turns that into a 500 where a real
    // response used to appear. Every responder hands the response back - request.success(),
    // request.fail(), h.respond(), h.reject(), h.response(), h.redirect() and h.view() - so
    // return the value; never merely call it.
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

        // The declarative response contract, wired to lib/http/responseContract.js.
        //
        // `respond` and `reject` are published under the names the controllers already
        // address, request.success and request.fail, and are additionally aliased onto the
        // per-request toolkit as h.respond and h.reject, so both surfaces work.
        //
        // The negotiated response type is supplied BOTH ways lib/http/responseContract.js
        // documents, and both are needed. It is stashed on the request because
        // lib/http/validation.js invokes the rejection responder with four arguments and no
        // response type; it is also passed explicitly here, which wins when supplied.
        // Neither responder ever computes it - the value is exactly what accepts() returned.
        //
        // PRESERVED QUIRK Q-A6 - see docs/PRESERVED-QUIRKS.md. There are exactly TWO
        // responders and there must never be a third. A `catch` responder on the request is
        // defined nowhere at baseline and has to stay undefined: two branches of
        // lib/controllers/folders.js invoke one, so they raise a TypeError that the
        // centralized error map below turns into a 500. Publishing a third responder here
        // would silently convert that baseline failure into a working response.
        request.responseType = responseType;

        request.success = function(json) {
          return responders.respond(request, h, json, responseType);
        };

        request.fail = function(json, err) {
          return responders.reject(request, h, json, err, responseType);
        };

        h.respond = request.success;
        h.reject  = request.fail;

        // Route input validation, wired to lib/http/validation.js, which returns the
        // rejection response on failure and undefined on success and carries its own
        // truthiness guard on `validation`. `language` comes from the parse-time capture
        // above rather than from `validation`, because the declaration's `language` key is
        // deleted off the schema before any request runs. The rejection responder is handed
        // over directly because validation.js invokes it as reject(request, h, json, err) -
        // four positional arguments and no response type, which is precisely why the
        // negotiated type is stashed on the request above.
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
          return request.success(request.params);
        }
      }
      catch(err) {
        // The single centralized error map, relocated verbatim to lib/http/errorMap.js. It
        // is RETURNED rather than thrown because thrown and returned Boom values were
        // measured wire-equivalent on hapi 21, and returning is what this sink did before.
        //
        // PRESERVED QUIRK Q-errfalsy - see docs/PRESERVED-QUIRKS.md. toResponse() keeps the
        // source's truthiness guard, so a falsy caught value yields undefined and this
        // handler returns undefined. Whatever toResponse() gives back is returned as-is;
        // adding a fallback here would change the baseline mapping.
        return ErrorMap.toResponse(err);
      }
    } // end handler

    // Convert pre-handlers to Hapi 20+ format
    //
    // PRESERVED QUIRK Q-A1 - see docs/PRESERVED-QUIRKS.md. convertPreHandlers is declared
    // with two parameters, (pre, server), and is called here with ONE, so `server` is
    // permanently undefined. Adjudicated against baseline: the string-form wrapper inside
    // lib/http/preHandlers.js declares its own `var server = request.server;` and never
    // reads the parameter, so the omission is provably inert. Both the two-parameter
    // declaration and this one-argument call are preserved exactly - a zero-diff outcome.
    // Threading `server` through would be latent-bug repair with no observable effect.
    if (route.options && route.options.pre) {
      route.options.pre = PreHandlers.convertPreHandlers(route.options.pre);
    }

    routes.push(route);

    // PRESERVED QUIRK Q-A3a - see docs/PRESERVED-QUIRKS.md. This `.json` extension
    // duplication is INERT: no declaration in config/routes.js or config/api_routes.js
    // carries an `ext` key, so `extensions` is false for every one of the 228 declarations
    // and the block below emits nothing. It is preserved as code rather than deleted -
    // removing it would be unsanctioned cleanup, and populating `ext` would change the
    // frozen 233-row route table.
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
