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
    addUserContext = require('./responseContract').addUserContext;

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
        // PRESERVED QUIRK (docs/PRESERVED-QUIRKS.md section 4.1). The returned
        // string IS the Inert confinement root, and {assetType} arrives
        // PERCENT-DECODED after route matching, so a traversal sequence in that
        // one segment moves the root out of ./public. Measured against the base
        // commit:
        //   GET /cache-prefix-1/..%2F..%2F..%2F..%2F..%2F..%2Fetc/passwd -> 200 + /etc/passwd
        //   GET /cache-prefix-1/..%2fconfig/local.yaml                   -> 200 + the Yar
        //                                                                   session password
        // The {path*} tail is not affected - Inert confines the selection to the
        // root and answers 403 for it - so this segment is the whole of the
        // exposure. It is reproduced verbatim rather than guarded: R-4 forbids
        // behavior improvements, R-6 makes the base commit the tie-breaker, and an
        // intermediate revision that returned Boom.notFound() for a traversal
        // value was rejected by code review as an unauthorized behavior change.
        path: function(request) {
          return './public/' + request.params.assetType;
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
