/**
 * The static-asset URL space and the two synthesized static pages.
 *
 * Both functions append to the array they are given and return nothing, and the
 * order of the appends is the contract: the '/{path*}' catch-all that
 * addStaticRoutes() pushes last has directory indexing enabled, so it matches
 * essentially every path and shadows anything registered after it.
 * lib/util/routeParser.js - the only consumer - therefore calls addStaticPages()
 * before its declaration loop and addStaticRoutes() after it, producing the
 * frozen route order: /about and /help, then the declared routes, then the
 * cache-prefix route, the app.prefixes routes, /.well-known/{path*} and the
 * catch-all. This module owns five of the 233 rows, so gaining or losing one here
 * breaks the route-table gate on its own.
 *
 * The file carries no strict-mode directive: `static` is used below as a for...in
 * loop variable, which is a reserved word under strict mode.
 */
var fs             = require('fs'),
    path           = require('path'),
    config         = require('config'),
    Boom           = require('@hapi/boom'),
    addUserContext = require('./responseContract').addUserContext;

// The one legal shape of the cache-prefix route's {assetType} segment: a single
// plain directory name under ./public. Anchored at both ends, it admits no path
// separator, no backslash, no percent sign, no control character and no leading
// dot, so no value that satisfies it can move the Inert confinement root out of
// ./public. See SECURITY REMEDIATION on the route below.
var SAFE_ASSET_TYPE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Static routes using @hapi/inert
//
// Inert is registered as a plugin in app.js; the routes below only carry the
// declarative `handler: { directory: ... }` objects it interprets.
function addStaticRoutes(routes) {
  // Handle cache-prefix URLs (strips cache-prefix-{timestamp} from path)
  //
  // The path segment comes from config.app.cachePrefix, which lib/util/cachify.js
  // and lib/util/stringUtils.js#addPrefix use to generate the URLs that land here.
  // Hard-coding it would stop the cache-busting URLs matching.
  routes.push({
    method: 'GET',
    path: '/' + config.app.cachePrefix + '{timestamp}/{assetType}/{path*}',
    handler: {
      directory: {
        // The FUNCTION form of the directory path is essential and must not be
        // flattened to a string: it is what resolves {assetType} per request,
        // so /cache-prefix-1234/js/app.js serves ./public/js/app.js. A plain
        // string would silently serve the wrong directory, and it would fail
        // only at request time - never at boot.
        //
        // SECURITY REMEDIATION (review finding SEC-1, CWE-22/CWE-200) - the one
        // deliberate deviation from the verbatim relocation, recorded in
        // docs/PRESERVED-QUIRKS.md section 4.1. THIS IS NOT A REFACTOR: without the
        // guard below the returned string IS the Inert confinement root, and
        // {assetType} arrives PERCENT-DECODED after route matching, so an
        // unauthenticated request escaped ./public entirely. Measured against the
        // base commit and again here before the guard was added:
        //   GET /cache-prefix-1/..%2F..%2F..%2F..%2F..%2F..%2Fetc/passwd -> 200 + /etc/passwd
        //   GET /cache-prefix-1/..%2fconfig/local.yaml                   -> 200 + the Yar
        //                                                                   session password
        //   GET /cache-prefix-1/%2e%2e%2fconfig/local.yaml               -> 200 (same file)
        // The {path*} tail is NOT affected - Inert confines the selection to the
        // root and already answered 403 for it - so the root itself is the only
        // hole, and this is the only place it can be closed.
        //
        // The guard is observably neutral for every legitimate asset URL. Asset
        // URLs reach this route through the `cachePrefix` nunjucks filter ->
        // lib/util/stringUtils.js#addPrefix, which sets {assetType} to the FIRST
        // path segment of the asset path; the values measured in lib/views and
        // public/partials are js, components, img and css, and all eight
        // config/default.yaml app.prefixes keys have the same single-segment
        // shape. A rejected value answers Boom.notFound(), which is byte-identical
        // to what a nonexistent asset directory already answered - measured:
        // /cache-prefix-1/nonexistentdir/x.js -> 404 both before and after.
        // Inert throws an Error returned from this function
        // (@hapi/inert/lib/directory.js internals.resolvePathOption), so 404 is
        // reachable from here without touching the route declaration, the row
        // count or the frozen registration order.
        path: function(request) {
          var assetType = request.params.assetType;

          if (typeof assetType !== 'string' ||
              !SAFE_ASSET_TYPE.test(assetType) ||
              assetType.indexOf('..') !== -1) {

            return Boom.notFound();
          }

          return './public/' + assetType;
        },
        redirectToSlash: true
      }
    }
  });

  // One directory route per configured asset prefix. config/default.yaml declares
  // its eight `app.prefixes` entries key-only, so every value is null and the
  // guard below is false for all eight: the loop emits no routes as configured
  // today. config/default.yaml is a frozen asset-URL contract, so populating it
  // would publish eight new asset URL shapes and move the route table off its
  // frozen 233 rows.
  for (var static in config.app.prefixes) {
    if (config.app.prefixes[static]) {
      var prefix = config.app.prefixes[static];
      routes.push({
        method: 'GET',
        path: '/' + prefix + '/' + static + '/{path*}',
        handler: {
          directory: {
            path: './public',
            redirectToSlash: true
          }
        }
      });
    }
  }

  // Handle .well-known requests silently (browser/devtools noise)
  //
  // A deliberate 404 with an EMPTY body. Both the status and the empty payload are
  // part of the captured response corpus, so this stays a plain function handler:
  // Boom.notFound() would add a JSON error payload where nothing is sent today.
  routes.push({
    method: 'GET',
    path: '/.well-known/{path*}',
    handler: function(request, h) {
      return h.response().code(404);
    }
  });

  // catch all static route
  //
  // Must remain the last append here, and addStaticRoutes() must remain the last
  // thing parseRoutes() calls: this handler shadows any route registered after it.
  routes.push({
    method: 'GET',
    path: '/{path*}',
    handler: {
      directory: {
        path: './public',
        redirectToSlash: true,
        index: true
      }
    }
  });
}

/**
 * Synthesize one GET route per .html file in the static-pages directory. With the
 * configured `templates: lib/views/` and `staticPages: static` that is about.html
 * and help.html, so this emits exactly GET /about and GET /help.
 *
 * The '/../../' hop below is relative to this file, so moving this module to a
 * different depth under lib/ would silently drop both pages.
 */
function addStaticPages(routes) {
  // The directory read is synchronous on purpose: it runs once while the route
  // table is built, not per request. A missing directory throws here and the
  // application fails to boot, which is why there is no try/catch and no
  // empty-array fallback.
  var directoryPath = path.resolve(__dirname);
  var files = fs.readdirSync(directoryPath + '/../../' + config.app.templates + '/' + config.app.staticPages);

  files
    .filter(function(file) { return file.substr(-5) === '.html' })
    .forEach(function(file) {
      var fileName = file.split('.').shift();
      var route = {
        method: 'GET',
        path: '/' + fileName,
        options: {
          // The handler is nested inside options here, alongside cors : false,
          // unlike the four routes in addStaticRoutes().
          cors : false,
          handler: async function(request, h) {
            var context = { footer : true };
            // Mutates `context` in place and returns nothing.
            addUserContext(context, request);
            // Resolves to e.g. 'static/about.html' against the view root app.js
            // points at config.app.templates.
            return h.view(config.app.staticPages + '/' + file, context);
          }
        }
      };
      routes.push(route);
    });

}

module.exports = {
  addStaticRoutes : addStaticRoutes,
  addStaticPages  : addStaticPages
};
