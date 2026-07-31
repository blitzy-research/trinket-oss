/**
 * The static-asset URL space and the two synthesized static pages, for the
 * hapi 21 request lifecycle.
 *
 * Relocated VERBATIM from lib/util/routeParser.js as part of the hapi API
 * migration. Both function bodies below are byte-for-byte moves: the only
 * additions are the comments that record the behaviors which must never be
 * "improved" (see docs/PRESERVED-QUIRKS.md).
 *
 * PROVENANCE - each function and the source range it came from:
 *
 *   addStaticRoutes() <- lib/util/routeParser.js:L648-L701
 *   addStaticPages()  <- lib/util/routeParser.js:L742-L765
 *
 * PUBLIC API
 *
 *   addStaticRoutes(routes)   // appends the asset routes; returns nothing
 *   addStaticPages(routes)    // appends /about and /help; returns nothing
 *
 * BOTH FUNCTIONS MUTATE THE ARRAY THEY ARE GIVEN, by pushing onto it, and
 * neither returns a value. That is not incidental - the ORDER of the appends is
 * the entire contract, because the '/{path*}' catch-all that addStaticRoutes()
 * appends last matches essentially every path and shadows anything registered
 * after it.
 *
 * ============================================================================
 * THE FROZEN REGISTRATION ORDER  -  READ THIS BEFORE MOVING EITHER CALL SITE
 * ============================================================================
 * lib/util/routeParser.js calls addStaticPages(routes) FIRST - it is the first
 * statement of parseRoutes(), ahead of the declaration loop - and
 * addStaticRoutes(routes) LAST, immediately after that loop. Combined with
 * config/app.config.js's routeParser.parse(api_routes.concat(routes)), the
 * frozen order of the 233-row route table is:
 *
 *   1. /about, /help                    <- addStaticPages(), 2 rows
 *   2. the 116 config/api_routes.js routes
 *   3. the 112 config/routes.js routes  (57 literal + 55 emitted by the
 *                                        config.constants.trinketLangs loop)
 *   4. the cache-prefix asset route     <- addStaticRoutes(), 1 row
 *   5. the eight app.prefixes routes    <- addStaticRoutes(), 0 rows (see the
 *                                          preserved quirk on the loop below)
 *   6. /.well-known/{path*}             <- addStaticRoutes(), 1 row
 *   7. /{path*}, the catch-all          <- addStaticRoutes(), 1 row, LAST
 *
 * 228 declared + the 5 emitted here = 233. This module owns exactly five of
 * those rows, so gaining or losing one row here breaks the route-table gate on
 * its own. Measured in this checkout: config/routes.js declares 112 entries,
 * config/api_routes.js declares 116, and neither carries a truthy `ext` key, so
 * the parser's .json duplication never fires and the arithmetic is exact.
 *
 * Consumer: lib/util/routeParser.js, the only caller of either function.
 *
 * NO STRICT-MODE DIRECTIVE AND NO ESM IN THIS FILE. The project runs in sloppy
 * mode throughout - app.js assigns its nine model globals as bare undeclared
 * assignments - and this module additionally uses `static` as a for...in loop
 * variable, which is a reserved word under strict mode. A strict directive here
 * would therefore turn the file into a SyntaxError that `node --check` reports
 * immediately, which makes that loop variable a useful canary.
 */
var fs             = require('fs'),
    path           = require('path'),
    config         = require('config'),
    addUserContext = require('./responseContract').addUserContext;

// Static routes using @hapi/inert
//
// Inert is deliberately NOT a dependency of this module: it is registered once
// as a plugin in app.js, and the routes below only carry the declarative
// `handler: { directory: ... }` configuration objects that the registered
// plugin interprets. Requiring it here would add a dependency for nothing.
function addStaticRoutes(routes) {
  // Handle cache-prefix URLs (strips cache-prefix-{timestamp} from path)
  //
  // The path is ASSEMBLED from config.app.cachePrefix rather than hard-coded;
  // with the frozen value 'cache-prefix-' it reads
  // /cache-prefix-{timestamp}/{assetType}/{path*}. lib/util/cachify.js and
  // lib/util/stringUtils.js#addPrefix generate the URLs that land here, so the
  // literal must keep coming from config or the cache-busting URLs stop
  // matching.
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
        path: function(request) {
          return './public/' + request.params.assetType;
        },
        redirectToSlash: true
      }
    }
  });

  // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. THIS LOOP EMITS ZERO
  // ROUTES, AND EMITTING ZERO ROUTES IS THE BASELINE BEHAVIOR IT MUST KEEP.
  //
  // All eight config/default.yaml `app.prefixes` entries - components, js, css,
  // img, fonts, partials, skulpt, models - are key-only, so YAML parses every
  // value as null and the guard below is false for all eight. Verified by
  // loading that file: every value is null.
  //
  // The loop is preserved exactly as written for two independent reasons.
  // Relocating it is a move, not a redesign, so deleting it as "dead code"
  // would be an unsanctioned cleanup. And populating the frozen config it reads
  // would push the route table from 233 rows to 241 and break the route-table
  // hash, on top of publishing eight asset URL shapes that do not exist today.
  //
  // The loop variable is named `static`, which is legal only because this file
  // carries no strict-mode directive (see the header).
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
  // PRESERVED BEHAVIOR - see docs/PRESERVED-QUIRKS.md. This is a DELIBERATE 404
  // with an EMPTY body: a plain function handler, not a directory route and not
  // a Boom. Both the status and the empty payload are part of the captured
  // response corpus, so do not turn it into a directory route, do not drop the
  // explicit status call, and do not swap in Boom.notFound() - that would add a
  // JSON error payload where the baseline sends no body at all.
  routes.push({
    method: 'GET',
    path: '/.well-known/{path*}',
    handler: function(request, h) {
      return h.response().code(404);
    }
  });

  // catch all static route
  //
  // MUST REMAIN THE LAST APPEND IN THIS FUNCTION, and addStaticRoutes() must
  // remain the last thing parseRoutes() calls. Directory indexing is enabled on
  // this handler, so it matches essentially every path: any route registered
  // after it is shadowed, all 228 declared routes included.
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
 * Synthesize one GET route per .html file in the static-pages directory.
 *
 * With config/default.yaml's `templates: lib/views/` and `staticPages: static`,
 * lib/views/static/ holds exactly about.html and help.html, so this emits
 * exactly GET /about and GET /help - both HTTP 200, both part of the captured
 * response corpus.
 *
 * THE __dirname RELOCATION IS SAFE, AND IT WAS VERIFIED RATHER THAN ASSUMED.
 * __dirname moved from lib/util/ to lib/http/, and both directories sit exactly
 * one level under lib/, so the '/../../' hop is unchanged. Measured in this
 * checkout, resolving the expression below from lib/http and from lib/util
 * normalizes to the same absolute path - <repo>/lib/views/static - and reading
 * it returns ['about.html', 'help.html'], yielding exactly /about and /help. An
 * off-by-one here would silently drop both pages and break the 233-row gate.
 */
function addStaticPages(routes) {
  // config.app.templates carries a trailing slash, so the concatenation below
  // contains a harmless double slash (lib/views//static). Keep the raw string
  // concatenation: resolving it through the path module's segment join would
  // normalize that away, and normalizing it is not a sanctioned change.
  //
  // The directory read is SYNCHRONOUS on purpose. It runs once while the route
  // table is built, not per request, so it is not an async-conversion target. A
  // missing directory throws right here and the application fails to boot -
  // that is the baseline mapping, so there is deliberately no try/catch and no
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
          // Unlike the four routes in addStaticRoutes(), the handler is nested
          // INSIDE options here, alongside cors : false. Preserve that shape.
          cors : false,
          handler: async function(request, h) {
            var context = { footer : true };
            // addUserContext MUTATES context - it adds user, loggedInWith and
            // userAvatarSrc for a signed-in visitor, plus the computed
            // emailEnabled flag for everyone - and its return value is
            // undefined and ignored. It is required from
            // lib/http/responseContract.js and must never be duplicated here.
            addUserContext(context, request);
            // Resolves to e.g. 'static/about.html'. The view engine finds it
            // because app.js points the view root at config.app.templates and
            // sets the search path to '.'.
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
