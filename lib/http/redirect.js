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

// SECURITY REMEDIATION (review finding SEC-4, CWE-601) - the two helpers below,
// recorded in docs/PRESERVED-QUIRKS.md section 4.4. They are deliberately NOT
// applied inside redirect() above: branch 4 of that cascade lets an already
// absolute http(s) target through, and lib/controllers/auth.js#google depends on
// it to hand the browser its https://accounts.google.com/o/oauth2/v2/auth URL.
// Confining every declarative redirect would break Google sign-in, so the
// enforcement lives at the two boundaries where the destination is genuinely
// USER-CONTROLLED: the `next` query parameter / payload field, and the values
// interpolated into a root-relative fail.redirect template.
//
// Control characters are stripped rather than tolerated because browsers and
// proxies treat a raw tab, CR or LF inside a Location value as a separator, so
// '/\r\n//evil.example' would otherwise re-open the same hole the leading-slash
// test closes.
// Two constants rather than one, deliberately: a /g regex advances lastIndex on
// every test() and would answer differently on the next call.
var CONTROL_CHARACTER    = /[\u0000-\u001f\u007f]/;
var CONTROL_CHARACTERS_G = /[\u0000-\u001f\u007f]/g;

/**
 * Accept a destination only if it is unambiguously this application's own origin.
 *
 * A safe destination is a non-empty string beginning with exactly one '/' that
 * carries no backslash and no control character. That rules out absolute URLs
 * ('https://evil.example'), scheme-relative URLs ('//evil.example'), the
 * backslash form browsers normalize to a scheme-relative URL ('/\evil.example'),
 * and header-splitting payloads - while leaving every in-application path
 * ('/home', '/account/profile', '/courses/x?y=1#z') byte-identical.
 *
 * @param   {*} value            The candidate destination.
 * @returns {String|null} The unchanged value when it is same-origin, else null.
 */
function internalDestination(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  if (value.charAt(0) !== '/' || value.charAt(1) === '/' || value.charAt(1) === '\\') {
    return null;
  }

  if (value.indexOf('\\') !== -1 || CONTROL_CHARACTER.test(value)) {
    return null;
  }

  return value;
}

/**
 * Force a destination onto this application's own origin.
 *
 * Used where a target is mandatory and cannot simply be dropped - the
 * fail.redirect templates in config/routes.js are declared root-relative, so the
 * interpolated result must stay root-relative too. Control characters are
 * removed and a leading run of separators collapses to a single '/', which
 * leaves an ordinary path such as '/sign-up' untouched and turns
 * '//evil.example' into the same-origin '/evil.example'.
 *
 * @param   {String} value       The interpolated destination.
 * @returns {String} A root-relative, same-origin destination.
 */
function confineToOrigin(value) {
  var confined = String(value).replace(CONTROL_CHARACTERS_G, '');

  return '/' + confined.replace(/^[\/\\]+/, '');
}

module.exports = {
  redirect            : redirect,
  internalDestination : internalDestination,
  confineToOrigin     : confineToOrigin
};
