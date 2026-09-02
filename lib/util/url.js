// Legacy-compatible URL parsing.
//
// WHY THIS MODULE EXISTS
// ---------------------------------------------------------------------------
// Six sites parse a stored asset URL or a user-supplied URL and read a single
// field off the result: lib/controllers/users.js (:589 `protocol`, :605
// `path`), lib/controllers/trinket.js (:1254, :1351, :1522 `pathname`) and
// lib/workers/exports.js (:41, :304 `pathname`). Every one of them used
// `url.parse()`, for which Node emits DEP0169 on each call when the process
// runs under `--pending-deprecation`. This module is the single shared
// replacement, so that surface parses URLs without the warning while behaving
// identically.
//
// WHAT "IDENTICALLY" MEANS HERE, AND WHY IT IS STRICT
// ---------------------------------------------------------------------------
// `url.parse()` is not a validator, and none of the six call sites treats it
// as one:
//
//   * It never returns null. A relative ('x'), root-relative ('/x') or
//     protocol-relative ('//h/x') input yields a *partial object* whose
//     `protocol` is null. users.js:589 reads `.protocol` off that object and
//     answers with `request.fail()`, so returning null instead would throw a
//     TypeError there and turn a redirect into a 500 - and would break the
//     five asset sites, which read `.pathname` with no null check.
//   * It does not resolve against a base. Resolving '//h/x', '/x' or 'x'
//     would give them a protocol, and users.js:589 would stop rejecting the
//     relative URLs it rejects today.
//   * It keeps the query string on `.path` while leaving it off `.pathname`,
//     and users.js:605 derives the stored upload filename with
//     `path.basename(requestUrl.path)`. A query-bearing source URL therefore
//     puts '?v=2' *into the stored filename*. That is long-standing behaviour,
//     it feeds the object naming in lib/util/file.js, and it is preserved
//     deliberately - the query must not be stripped here.
//   * It throws for a small, specific set of malformed authorities and for
//     non-string input, and each call site depends on that throw reaching the
//     error handler it reaches today (the promise `.catch` in
//     trinket.downloadFile, the route handler catch-all for the synchronous
//     sites, an unsettled deferred in the export worker). Nothing in this
//     module may catch, translate or default it.
//
// HOW PARITY IS GUARANTEED
// ---------------------------------------------------------------------------
// Node's `url.parse()` is, verbatim, a DEP0169 emission followed by
// `new Url().parse(...)`: the parsing itself lives in `Url.prototype.parse`,
// which carries no deprecation of its own. Driving that method directly is
// therefore not an approximation of the legacy semantics - it is the legacy
// implementation, minus the warning. That matters because those semantics are
// idiosyncratic in ways a reimplementation would not reproduce by accident.
// Measured on Node 22:
//
//   'https://h/x?v=2'            -> protocol 'https:' pathname '/x'    path '/x?v=2'
//   '//h/x'                      -> protocol null     pathname '//h/x' path '//h/x'
//   '/x'                         -> protocol null     pathname '/x'    path '/x'
//   'x'                          -> protocol null     pathname 'x'     path 'x'
//   ''                           -> protocol null     pathname null    path null
//   '?v=2'                       -> protocol null     pathname null    path '?v=2'
//   'https://h/a.png#frag'       -> path '/a.png'          (the hash is not part of `path`)
//   'https://h/a%20b.png'        -> pathname '/a%20b.png'  (nothing is decoded)
//   'data:image/png;base64,AAAA' -> protocol 'data:'   pathname '/png;base64,AAAA'
//   'mailto:a@b.com'             -> protocol 'mailto:' pathname null
//   'javascript:alert(1)'        -> protocol 'javascript:' pathname 'alert(1)'
//   'http://host:abc/a'          -> pathname '/:abc/a'    (an unusable port folds into the path)
//   'https://ho st/a'            -> pathname '%20st/a'    (the host ends at the space)
//   'http://h\\a'                -> pathname '/a'         (backslashes become slashes)
//   'https://h/x\ty'             -> pathname '/x%09y'     (a tab is escaped)
//
// and it throws `TypeError [ERR_INVALID_URL]` with the message 'Invalid URL'
// for a narrow set of authorities - an unterminated or malformed bracketed
// host ('http://[', 'http://[::1', 'http://[fe80::1%25eth0]/a',
// 'http://[::1]:port/x'), a NUL byte in the authority, an undecodable
// punycode host ('http://xn--a/x') and a host that IDNA-maps to nothing -
// while *not* throwing for near neighbours such as 'http://[]/a',
// 'http://[::1]]/a', 'http://%00/a', 'http://a..b/x' or
// 'http://999.999.999.999/a'. Non-string input throws
// `TypeError [ERR_INVALID_ARG_TYPE]`.
//
// One warning is deliberately left in place: `Url.prototype.parse` emits
// DEP0170 for the few invalid authorities Node warns about ('http://host:abc/a'
// and the malformed bracketed hosts above). `url.parse()` emitted exactly that
// warning from exactly the same place, so this module changes nothing about it.
// What it removes is DEP0169, which fired for every URL on every call.

var Url = require('url').Url;

// `Url` is the constructor Node's own `url.parse()` instantiates. Assert it at
// load time so a runtime that stopped exporting it fails once, with a precise
// message, instead of once per request with an opaque one.
if (typeof Url !== 'function') {
  throw new Error('lib/util/url.js: the Node `url` module does not export the `Url` constructor, so legacy URL parsing is unavailable on this runtime');
}

// parseLegacy(value) - exactly the behaviour of `require('url').parse(value)`.
//
// Returns a `Url` instance carrying the full legacy field set (protocol,
// slashes, auth, host, port, hostname, hash, search, query, pathname, path,
// href); the fields the application reads are `protocol`, `pathname` and
// `path`, where `path` includes the query string. Throws whatever
// `url.parse()` throws, unchanged and synchronously, so the caller's existing
// error handling is reached exactly as before.
//
// e.g. parseLegacy('https://host/dir/img.png?v=2').path -> '/dir/img.png?v=2'
//      parseLegacy('/dir/img.png').protocol             -> null
function parseLegacy(value) {
  // `url.parse()` short-circuits an input that has already been parsed and
  // returns it untouched, where `Url.prototype.parse` would reject it as a
  // non-string. No caller relies on this today; it is here because it is part
  // of the behaviour being reproduced.
  if (value instanceof Url) {
    return value;
  }

  var parsed = new Url();

  // Called with one argument, as all six call sites called `url.parse()`:
  // `parseQueryString` and `slashesDenoteHost` stay unset, which is what keeps
  // `query` a string and makes '//h/x' a path rather than a host.
  parsed.parse(value);

  return parsed;
}

module.exports = {
  parseLegacy : parseLegacy
};
