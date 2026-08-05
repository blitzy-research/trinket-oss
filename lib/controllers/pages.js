var mailer     = require('../util/mailer'),
    errors     = require('@hapi/boom'),
    config     = require('config'),
    nunjucks   = require('nunjucks'),
    _          = require('underscore'),
    // The same-origin destination filter applied to the user-controlled `next` query parameter
    // below. See lib/http/redirect.js and docs/PRESERVED-QUIRKS.md section 4.4.
    Redirect   = require('../http/redirect'),
    recaptcha  = require('../util/recaptcha');

module.exports = {
  index: async function(request, h) {
    // Load-bearing beyond the plain 200: besides 'GET /' and 'GET /docs/colors', pages.index serves
    // one trailing-slash route per config/constants.js trinketLang, and those declare
    // success.redirect '/<lang>' - a declarative redirect the responder returned here produces.
    return h.respond({
      footer : true
    });
  },
  login: async function(request, h) {
    if (request.auth.isAuthenticated) {
      // Authenticated GET /login answers HTTP 500 rendered as 50x.html, while the same route
      // answers 200 unauthenticated. Do NOT turn this into h.redirect('/home'): that would turn
      // a 500 into a 302 on a login page. hapi scrubs every 5xx message, so the text below never
      // reaches the wire and only records the original TypeError.
      // See docs/PRESERVED-QUIRKS.md section 1.1.
      throw errors.badImplementation('reply.redirect is not a function');
    } else {
      // `next` is echoed straight back into a redirect once the visitor authenticates -
      // lib/controllers/users.js#login hands it to h.redirect() verbatim - so only a same-origin
      // destination is persisted. Redirect.internalDestination returns the value UNCHANGED for an
      // in-application path and for an absolute URL on one of this application's own origins, so
      // both round-trip byte-for-byte; an off-origin, scheme-relative, backslash or control-character
      // destination is simply not stored, leaving the session as it is for a visitor who supplied no
      // `next` at all. See docs/PRESERVED-QUIRKS.md section 4.4.
      var next = Redirect.internalDestination(request.query.next, request);
      if (next) {
        request.yar.set('next', next);
      }
      return h.respond();
    }
  },
  signup: async function(request, h) {
    if (request.auth.isAuthenticated) {
      // The same 500 as `login`, for the same reason and with a byte-identical body. This must
      // not become h.redirect('/welcome'). See docs/PRESERVED-QUIRKS.md section 1.1.
      throw errors.badImplementation('reply.redirect is not a function');
    }
    else {
      // The signup half of the same `next` contract guarded in `login` above. Only the SESSION value
      // is filtered; the `next` key handed to the responder below still carries request.query.next
      // verbatim, and is deliberately left alone because lib/views/signup.html never reads it, so it
      // reaches no rendered byte.
      var next = Redirect.internalDestination(request.query.next, request);
      if (next) {
        request.yar.set('next', next);
      }
      return h.respond({
        next : request.query.next || ""
      });
    }
  },
  welcome: async function(request, h) {
    request.yar.flash('siteMessage', 'Welcome! Your account has been created.', true);
    // A raw toolkit redirect, so the emitted Location is the RELATIVE '/home'. Only the
    // declarative forms - success.redirect, json.redirectTo, success.html.redirect and
    // fail.redirect - travel through lib/http/redirect.js and gain config.url. Do not route this
    // through it, and do not add .code(301): the default 302 and the relative target are both
    // part of the wire contract.
    return h.redirect('/home');
  },
  home: async function(request, h) {
    // Redirect to login if not authenticated
    if (!request.user) {
      // A raw toolkit redirect again: a relative 302 to '/login', for the reason on `welcome`.
      // The unauthenticated GET /home 302 comes from app.js's 401 lifecycle, not from here, and
      // both emit the same relative target.
      return h.redirect('/login');
    }

    // `Trinket` is one of the nine implicit globals app.js assigns and is deliberately not
    // required here: this module is sloppy-mode CommonJS, and a strict directive or an ESM
    // conversion would make those assignments throw at boot.
    return Trinket.findRecentByOwner(request.user._id)
      .then(function(trinkets) {
        return h.respond({
          trinkets : trinkets
        });
      })
      // PRESERVED QUIRK: handing the rejection responder straight to .catch() puts the rejection
      // reason in the FIRST parameter (`json`) and leaves `err` undefined, so the responder logs
      // "<inspected error> undefined" and treats the error object as the response payload - answering
      // HTTP 200, never a 4xx. Keep it byte-for-byte: do NOT wrap this in
      // `.catch(function(err) { return h.reject({}, err); })`. See docs/PRESERVED-QUIRKS.md.
      .catch(h.reject);
  },
  features : async function(request, h) {
    // PRESERVED QUIRK: this handler is UNROUTED - nothing in config/routes.js or
    // config/api_routes.js references pages.features - which is why the unguarded
    // `request.pre.namedTrinketList.length` below is left alone; nothing assigns that pre, so it
    // would raise a TypeError if it were ever reached. Do NOT add a guard and do NOT delete the
    // handler. The asymmetry with lib/controllers/trinket.js#namedList, which reads the same pre as
    // `request.pre.namedTrinketList || []`, is preserved on both sides.
    // See docs/PRESERVED-QUIRKS.md.
    var data = {
        footer  : true
      , feature : request.params.feature
    };

    if (request.pre.namedTrinketList.length) {
      _.extendOwn(data, {
        examples : request.pre.namedTrinketList
      });
    }

    return h.respond(data);
  },
  forgotPasswordForm: async function(request, h) {
    return h.respond();
  }
};
