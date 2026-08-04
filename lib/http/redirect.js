/**
 * Declarative redirect helper.
 *
 * Resolves the `redirect` declarations carried by config/routes.js and
 * config/api_routes.js into a concrete Location target: params are merged into
 * `json` when the template carries a {word} placeholder, the template is
 * interpolated, and the result is absolutized. All four declarative forms route
 * through here - success.redirect, json.redirectTo, success.html.redirect and
 * fail.redirect.
 *
 * config.url and config.app.url.protocol are different values: config.url is
 * assembled in config/app.config.js as protocol://hostname[:port].
 */
var _           = require('underscore'),
    config      = require('config'),
    StringUtils = require('./../util/stringUtils');

// Hapi 20+ redirect helper
function redirect(request, h, urlTemplate, json) {
  // for "simple" redirects where params are simply copied to a new location
  if (/{\w+}/.test(urlTemplate)) {
    // Two-argument _.extend MUTATES `json` in place, and the caller observes the
    // merged params: respond()/reject() go on to project and flash this very
    // object. Copying instead (_.extend({}, ...), Object.assign, spread) would
    // change what gets flashed. A falsy `json` is returned unchanged.
    json = _.extend(json, request.params);
  }

  // A falsy `json` skips interpolation and the raw template is used. A non-string
  // template throws out of StringUtils.interpolate into the centralized error map
  // and becomes a 500; that is the mapping, so no type guard or coercion here.
  var redirectURL = json ? StringUtils.interpolate(urlTemplate, json) : urlTemplate;

  // Absolutization order is load-bearing - each branch is reachable from a real
  // route declaration and decides the emitted Location header:
  //   '//cdn.example.com/x' gains the scheme only
  //   '/home'               gains the full origin
  //   'account/email'       gains the origin and a separator
  //   'https://host/x'      falls through untouched
  if (/^\/\//.test(redirectURL)) {
    redirectURL = config.app.url.protocol + ':' + redirectURL;
  }
  else if (/^\//.test(redirectURL)) {
    redirectURL = config.url + redirectURL;
  }
  else if (!/^https?:\/\//.test(redirectURL)) {
    redirectURL = config.url + '/' + redirectURL;
  }

  // Declarative redirects are temporary by contract: h.redirect() defaults to
  // HTTP 302 and no declaration overrides it, so no .permanent(), .code(301) or
  // .takeover() belongs here.
  return h.redirect(redirectURL);
}

// R-1 / R-4 ALIGNMENT. An intermediate revision of this module also exported
// `internalDestination` and `confineToOrigin`, which confined a user-controlled `next`
// destination and a root-relative fail.redirect template to this application's own host.
// Code review removed them: the four sanctioned diff categories are the runtime bump, the
// hapi API migration, the async conversion and dependency swaps, and an open-redirect
// repair is none of those - it is a latent-bug repair, which R-1 places out of bounds even
// when beneficial, and it changed emitted Location values, which R-4 forbids outright. The
// base commit echoed whatever `next` it was given straight back into a Location, and that
// is what this module and its callers do again. The behavior, the reason it is preserved
// rather than repaired, and what re-authorizing a fix would require are recorded in
// docs/PRESERVED-QUIRKS.md section 4.4.
module.exports = {
  redirect : redirect
};
