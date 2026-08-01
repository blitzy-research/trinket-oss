var mailer     = require('../util/mailer'),
    errors     = require('@hapi/boom'),
    config     = require('config'),
    nunjucks   = require('nunjucks'),
    _          = require('underscore'),
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
    return request.success({
      footer : true
    });
  },
  login: async function(request, h) {
  	if (request.auth.isAuthenticated) {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.1, the flagship entry.
      // Baseline calls the Hapi-16 PROPERTY form `reply.redirect('/home')` here. The
      // shim's synthetic `reply` was a BARE FUNCTION and exposed `redirect` only on the
      // builder returned by CALLING it, so the property access raised
      // `TypeError: reply.redirect is not a function`, the single catch-all turned that
      // into Boom.badImplementation, and app.js's first onPreResponse rendered it as
      // 50x.html. Authenticated GET /login is therefore a 500 at the base commit -
      // measured live, and captured in test/baseline/responses.json - while the same
      // route answers 200 unauthenticated. Throwing the equivalent internal error
      // reproduces that 500 exactly. Do NOT "fix" this into h.redirect('/home'): that
      // would silently turn a 500 into a 302 on a login page, which R-4 prohibits.
      // hapi replaces every 5xx message with 'An internal server error occurred', so the
      // text below is invisible on the wire and documents the original TypeError.
      throw errors.badImplementation('reply.redirect is not a function');
    } else {
      if (request.query.next) {
        request.yar.set('next', request.query.next);
      }
      return request.success();
    }
  },
  signup: async function(request, h) {
    if (request.auth.isAuthenticated) {
      // PRESERVED QUIRK - the second half of docs/PRESERVED-QUIRKS.md section 1.1.
      // Baseline calls the same property form, `reply.redirect('/welcome')`, producing the
      // identical TypeError -> Boom.badImplementation -> 50x.html at 500. The rendered
      // body is byte-identical to the authenticated /login body (shared normalized digest
      // in test/baseline/responses.json). Same prohibition applies: this must NOT become
      // h.redirect('/welcome').
      throw errors.badImplementation('reply.redirect is not a function');
    }
    else {
      if (request.query.next) {
        request.yar.set('next', request.query.next);
      }
      return request.success({
        next : request.query.next || ""
      });
    }
  },
  welcome: async function(request, h) {
    request.yar.flash('siteMessage', 'Welcome! Your account has been created.', true);
    // The CALL form `reply().redirect('/home')` - the builder's redirect, which DID
    // resolve - so this is a genuine working 302 and must stay one.
    // PRESERVED BEHAVIOR: the builder called `h.redirect(url)` DIRECTLY
    // (lib/util/routeParser.js:L376-L380), with NO absolutization, so the emitted Location
    // is the RELATIVE '/home'. Only the declarative forms - success.redirect,
    // json.redirectTo, success.html.redirect, fail.redirect - travel through
    // lib/http/redirect.js and gain config.url. test/baseline/responses.json's
    // locationContract records exactly this split (call form -> relative '/account/profile';
    // declarative form -> absolute 'https://trinket.dev/home'). Do NOT route this through
    // lib/http/redirect.js and do NOT add .code(301): the default 302 and the relative
    // target are both part of the baseline wire contract. See docs/PRESERVED-QUIRKS.md.
    return h.redirect('/home');
  },
  home: async function(request, h) {
    // Redirect to login if not authenticated
    if (!request.user) {
      // The CALL form again: a real relative 302 to '/login', unabsolutized, for the same
      // reason documented on `welcome` above. Note the unauthenticated GET /home 302 seen
      // in the baseline corpus comes from app.js's 401 -> h.redirect('/login').takeover()
      // lifecycle rather than from this branch, and both emit the same relative target.
      return h.redirect('/login');
    }

    // `Trinket` is one of the nine undeclared globals assigned at app.js:L290-L298 and is
    // deliberately NOT required here: this module is sloppy-mode CommonJS, and a strict
    // directive or an ESM conversion would make those assignments throw at boot.
    return Trinket.findRecentByOwner(request.user._id)
      .then(function(trinkets) {
        return request.success({
          trinkets : trinkets
        });
      })
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md and PRESERVED QUIRK 3 in
      // lib/http/responseContract.js, which cites this very line. Handing `request.fail`
      // straight to .catch() puts the rejection reason in the FIRST parameter (`json`) and
      // leaves `err` undefined, so the responder logs "<inspected error> undefined" and
      // treats the error object as the response payload - answering HTTP 200, never a 4xx.
      // Keep the argument order byte-for-byte: do NOT wrap this in
      // `.catch(function(err) { return request.fail({}, err); })`.
      .catch(request.fail);
  },
  features : async function(request, h) {
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. This handler is UNROUTED: no entry in
    // config/routes.js or config/api_routes.js references pages.features, including the 55
    // loop-generated language routes. That is precisely why the unguarded
    // `request.pre.namedTrinketList.length` below is safe to leave alone - it would raise a
    // TypeError if it were ever reached, since nothing assigns that pre. Do NOT add a
    // `|| []` guard, a `&&` guard or optional chaining (latent-bug repair, out of bounds
    // under R-1), and do NOT delete the handler (opportunistic cleanup, likewise out of
    // bounds). The asymmetry with lib/controllers/trinket.js:L936, which reads the same pre
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

    return request.success(data);
  },
  forgotPasswordForm: async function(request, h) {
  	return request.success();
  }
};
