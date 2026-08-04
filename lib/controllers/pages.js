var mailer     = require('../util/mailer'),
    errors     = require('@hapi/boom'),
    config     = require('config'),
    nunjucks   = require('nunjucks'),
    _          = require('underscore'),
    // SECURITY REMEDIATION (review finding SEC-4) - the same-origin destination
    // filter applied to the user-controlled `next` query parameter below. See
    // lib/http/redirect.js and docs/PRESERVED-QUIRKS.md section 4.4.
    Redirect   = require('../http/redirect'),
    recaptcha  = require('../util/recaptcha');

module.exports = {
  index: async function(request, h) {
    // The response IS the return value now: the route parser no longer rescues a
    // handler that resolved `undefined` from a deferred capture, so this call must
    // be returned. It is load-bearing beyond the plain 200 - besides 'GET /' and
    // 'GET /docs/colors', pages.index also serves one trailing-slash route per
    // config/constants.js trinketLang (11 of them, pushed at
    // config/routes.js:L567-L575), and those declare success.redirect '/<lang>'.
    // That declarative redirect is produced by the responder this returns.
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
      // SECURITY REMEDIATION (review finding SEC-4, CWE-601), recorded in
      // docs/PRESERVED-QUIRKS.md section 4.4. `next` is echoed straight back into a
      // redirect once the visitor authenticates - lib/controllers/users.js#login
      // hands it to h.redirect() verbatim - so only a same-origin destination is
      // persisted. Redirect.internalDestination returns the value UNCHANGED both for
      // an in-application path and for an absolute URL on one of this application's
      // own origins, so '/login?next=/courses/x' AND the absolute
      // window.location.href the frozen assignment UI sends (review finding P3-1)
      // both round-trip byte-for-byte; an off-origin, scheme-relative, backslash or
      // control-character destination is simply not stored, which leaves the session
      // exactly as it is for a visitor who supplied no `next` at all.
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
      // SECURITY REMEDIATION (review finding SEC-4) - the signup half of the same
      // `next` contract guarded in `login` above. Only the SESSION value is
      // filtered; the `next` key handed to the responder below still carries
      // request.query.next verbatim. That context key is deliberately left alone:
      // lib/views/signup.html was measured to contain no reference to `next` at
      // all, so it reaches no rendered byte, and filtering an unread context key
      // would be a change with no security value.
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
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md and PRESERVED QUIRK 3 in
      // lib/http/responseContract.js, which cites this very line. Handing the rejection
      // responder straight to .catch() puts the rejection reason in the FIRST parameter
      // (`json`) and leaves `err` undefined, so the responder logs "<inspected error>
      // undefined" and treats the error object as the response payload - answering HTTP
      // 200, never a 4xx. Baseline spelled the same responder `request.fail`; the native
      // toolkit publishes the identical closure as `h.reject`, so the argument order and
      // therefore the wire outcome are unchanged. Keep it byte-for-byte: do NOT wrap this
      // in `.catch(function(err) { return h.reject({}, err); })`.
      .catch(h.reject);
  },
  features : async function(request, h) {
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. This handler is UNROUTED: no entry in
    // config/routes.js or config/api_routes.js references pages.features, including the 55
    // loop-generated language routes. That is precisely why the unguarded
    // `request.pre.namedTrinketList.length` below is safe to leave alone - it would raise a
    // TypeError if it were ever reached, since nothing assigns that pre. Do NOT add a
    // `|| []` guard, a `&&` guard or optional chaining (latent-bug repair, out of bounds
    // under R-1), and do NOT delete the handler (opportunistic cleanup, likewise out of
    // bounds). The asymmetry with lib/controllers/trinket.js#namedList, which reads the same pre
    // as `request.pre.namedTrinketList || []`, is baseline and is preserved on both sides.
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
