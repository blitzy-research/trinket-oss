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

// The only legal values of the cache-prefix route's {assetType} segment: the eight
// keys config/default.yaml declares under app.prefixes. Read from configuration
// rather than restated, so the allow-list and the app.prefixes routes below cannot
// drift apart, and single-segment by construction - a key carrying a separator would
// already be an invalid prefix route. See the CONFINEMENT INVARIANT note on the route below.
var ASSET_TYPES = Object.keys(config.app.prefixes);

// The one directory every cache-prefix root must resolve inside. Resolved once, from
// the same relative literal the route hands Inert, so the containment assertion and
// the value actually served are anchored identically.
var PUBLIC_ROOT = path.resolve('./public');

/**
 * True when `assetType` names one of the eight configured asset directories AND the
 * root it produces still resolves inside ./public.
 *
 * Two independent tests on purpose. The allow-list is the decisive one and is exact
 * rather than a pattern, so nothing outside the declared eight can reach Inert at
 * all. The resolve assertion is the invariant the allow-list exists to guarantee,
 * checked rather than assumed, so a future edit to app.prefixes that introduced a
 * separator could not silently reopen the escape.
 *
 * @param   {*} assetType The percent-decoded {assetType} path segment.
 * @returns {Boolean} Whether it is safe to use as the Inert confinement root.
 */
function isConfinedAssetType(assetType) {
  if (typeof assetType !== 'string' || ASSET_TYPES.indexOf(assetType) === -1) {
    return false;
  }

  var root = path.resolve(PUBLIC_ROOT, assetType);

  return root === PUBLIC_ROOT || root.indexOf(PUBLIC_ROOT + path.sep) === 0;
}

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
        // flattened to a string: it is what resolves {assetType} per request, so
        // /cache-prefix-1234/js/app.js serves ./public/js/app.js. A plain string
        // would silently serve the wrong directory, and only at request time.
        //
        // CONFINEMENT INVARIANT: the string this function returns IS the Inert
        // root, and {assetType} arrives percent-decoded after route matching, so
        // an unchecked segment can move that root outside ./public. The allow-list
        // is therefore load-bearing and must stay: it admits only the configured
        // app.prefixes keys, which are a strict superset of the segments any asset
        // URL can produce, so no legitimate request is affected. A refused value
        // answers Boom.notFound() - Inert raises an Error returned from here - and
        // that is the same 404 such a URL already answered, so the route
        // declaration, the row count and the registration order are untouched.
        // Inert already confines the {path*} tail to whatever root it is given, so
        // this segment is the only place the confinement can be established.
        // See docs/PRESERVED-QUIRKS.md section 4.1.
        path: function(request) {
          if (!isConfinedAssetType(request.params.assetType)) {
            return Boom.notFound();
          }

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
