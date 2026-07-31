/**
 * Declarative redirect helper for the hapi 21 request lifecycle.
 *
 * Relocated VERBATIM from lib/util/routeParser.js:L703-L723 as part of the hapi
 * API migration. The function body below is a byte-for-byte move: the only
 * additions are the comments that record the two behaviors which must never be
 * "improved" (see docs/PRESERVED-QUIRKS.md).
 *
 * It resolves the `redirect` declarations carried by the route tables in
 * config/routes.js and config/api_routes.js into a concrete Location target:
 *
 *   1. merge request.params into `json` when the template carries a {word}
 *      placeholder, so "simple" redirects can copy params to a new location;
 *   2. interpolate the template against `json`;
 *   3. absolutize the result through a three-branch cascade, leaving an
 *      already-fully-qualified http(s) URL untouched.
 *
 * Consumers: lib/util/routeParser.js and lib/http/responseContract.js.
 * All four declarative forms route through here - `success.redirect`,
 * `json.redirectTo`, `success.html.redirect` and `fail.redirect`.
 *
 * Usage:
 *   return Redirect.redirect(request, h, '/{user.username}/courses/{course.slug}', json);
 *
 * Note that config.url (used by branches 2 and 3) and config.app.url.protocol
 * (used by branch 1) are different values: config.url is assembled in
 * config/app.config.js as protocol://hostname[:port].
 */
var _           = require('underscore'),
    config      = require('config'),
    StringUtils = require('./../util/stringUtils');

// Hapi 20+ redirect helper
function redirect(request, h, urlTemplate, json) {
  // for "simple" redirects where params are simply copied to a new location
  if (/{\w+}/.test(urlTemplate)) {
    // PRESERVED BEHAVIOR: the two-argument _.extend MUTATES `json` in place and
    // returns that same reference, so the caller observes the merged params -
    // respond()/reject() go on to project and flash the very object mutated
    // here. Do NOT switch to _.extend({}, json, ...), Object.assign({}, ...) or
    // a spread copy: that would silently change what gets flashed.
    // A falsy `json` is returned unchanged, which keeps the gate below falsy.
    // See docs/PRESERVED-QUIRKS.md.
    json = _.extend(json, request.params);
  }

  // A falsy `json` skips interpolation entirely and the raw template is used.
  // StringUtils.interpolate() calls String.prototype.replace, so a non-string
  // `urlTemplate` throws a TypeError that propagates to the centralized error
  // map and becomes a 500. That mapping is part of the baseline: do NOT add a
  // type guard, a String() coercion or a try/catch here.
  var redirectURL = json ? StringUtils.interpolate(urlTemplate, json) : urlTemplate;

  // Three-branch absolutization. The order is load-bearing and must not be
  // reordered or merged - each branch is reachable from a real route
  // declaration, and changing it changes emitted Location headers:
  //   1. '//cdn.example.com/x' -> protocol-relative, gains the scheme only
  //   2. '/home'               -> root-relative, gains the full origin
  //   3. 'account/email'       -> unrooted, gains the origin and a separator
  //   4. 'https://host/x'      -> already absolute, falls through untouched
  if (/^\/\//.test(redirectURL)) {
    redirectURL = config.app.url.protocol + ':' + redirectURL;
  }
  else if (/^\//.test(redirectURL)) {
    redirectURL = config.url + redirectURL;
  }
  else if (!/^https?:\/\//.test(redirectURL)) {
    redirectURL = config.url + '/' + redirectURL;
  }

  // PRESERVED BEHAVIOR: hapi's h.redirect() defaults to HTTP 302 and the
  // original helper never overrode it. Do NOT add .permanent(), .code(301) or
  // .takeover() here - declarative redirects are temporary by contract.
  // See docs/PRESERVED-QUIRKS.md.
  return h.redirect(redirectURL);
}

module.exports = {
  redirect : redirect
};
