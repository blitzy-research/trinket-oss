#!/usr/bin/env node

// Mongoose 6 resolves native promises, while models and controllers call
// `.spread()` and `.fail()` on the values they get back. Both are defined here,
// at the head of the entry point, so they exist before any of that code loads.
if (!Promise.prototype.spread) {
  Promise.prototype.spread = function(fn) {
    return this.then(function(result) {
      if (Array.isArray(result)) {
        return fn.apply(null, result);
      }
      return fn(result);
    });
  };
}
if (!Promise.prototype.fail) {
  Promise.prototype.fail = Promise.prototype.catch;
}

// initialize the global logger
log = require('./config/log');

const Hapi           = require('@hapi/hapi');
const Boom           = require('@hapi/boom');
const Inert          = require('@hapi/inert');
const Vision         = require('@hapi/vision');
const Yar            = require('@hapi/yar');
const config         = require('./config/app.config');
const Helpers        = require('./lib/util/helpers');
// `gleak` is not a declared dependency and it reads the removed `GLOBAL`, so
// this require throws and the no-op fallback is what the process actually runs:
// `detectLeaks` below reports nothing and `gleak.ignore` does nothing. The
// interval that calls it still holds the event loop open.
let gleak;
try {
  gleak = require('gleak')();
} catch (e) {
  gleak = { detectNew: () => [], ignore: () => {} };
}
const mailer         = require('./lib/util/mailer');
const viewEngine     = require('./lib/util/nunjucks');
const CatboxMongoose = require('./lib/util/catbox-mongoose');
const fs             = require('fs');
const path           = require('path');

config.viewEngine = viewEngine;

const cache_control = 'private, s-maxage=0, max-age=0, no-cache, no-store, must-revalidate, proxy-revalidate';

// Builds, configures and (under `app.start`) starts the server.
const init = async () => {
  // The session cookie password must be at least 32 characters. It is checked
  // here, ahead of the Yar registration below, so a misconfigured process
  // reports the setting to fix instead of failing inside plugin registration.
  const sessionPassword = config.app.plugins.session.cookieOptions.password;
  const sessionPasswordMissing = !sessionPassword || sessionPassword.length < 32;

  // Production fails fast. This guard runs before the non-production fallback
  // below, so no production process can reach the generated secret.
  if (sessionPasswordMissing && config.isProd) {
    console.error('\n' + '='.repeat(70));
    console.error('ERROR: Session cookie password not configured!');
    console.error('');
    console.error('You must set a secure password (min 32 characters) in config/local.yaml:');
    console.error('');
    console.error('  app:');
    console.error('    plugins:');
    console.error('      session:');
    console.error('        cookieOptions:');
    console.error("          password: 'your-secure-password-at-least-32-characters'");
    console.error('');
    console.error('See config/local.example.yaml for a template.');
    console.error('='.repeat(70) + '\n');
    process.exit(1);
  }

  // Outside production an ephemeral secret is derived so that a checkout with no
  // config/local.yaml boots: that file is gitignored and config/default.yaml
  // ships an empty password, so there is otherwise no value to register with.
  //
  // A data descriptor, not a plain assignment: the `config` package exposes every
  // property through an accessor that persists what is assigned to
  // config/runtime.json, which is layered over every other source. Persisting
  // this secret would put it on disk, let it outlive the process, and let a
  // later production run boot on a development secret instead of exiting above.
  // Replacing the accessor keeps the value visible to the read in
  // server.register below and writes nothing.
  if (sessionPasswordMissing) {
    Object.defineProperty(config.app.plugins.session.cookieOptions, 'password', {
      value: require('crypto').randomBytes(32).toString('hex'),
      writable: true,
      enumerable: true,
      configurable: true
    });
    log.info('Session cookie password is not configured; generated an ephemeral one for this non-production process. Set app.plugins.session.cookieOptions.password in config/local.yaml to keep sessions valid across restarts.');
  }

  const server = Hapi.server({
    host: config.app.hostname || 'localhost',
    port: config.app.port || 3000,
    routes: {
      cors: config.app.cors || false,
      state: {
        failAction: 'log'
      }
    },
    // Hapi 20+ debug config format
    debug: config.isDev ? { request: ['error'] } : false,
    // Configure MongoDB session cache
    cache: [{
      name: 'sessions',
      provider: {
        constructor: CatboxMongoose.Engine,
        options: {}
      }
    }]
  });

  // Sessions are held server-side: `maxCookieSize: 0` keeps the session data in
  // the MongoDB-backed cache declared above and leaves only the session id on
  // the wire, so raising it changes the cookie's format. The cookie is secure by
  // default - `isSecure !== false` means only an explicit `false` in
  // configuration turns the flag off, where a truthiness test would let an unset
  // value serve it insecurely - and it is scoped by the configured session name,
  // which the cookie-expiry extension below matches on.
  await server.register([
    Inert,  // Static file serving
    Vision, // Template rendering
    {
      plugin: Yar,
      options: {
        storeBlank: false,
        cookieOptions: {
          password: config.app.plugins.session.cookieOptions.password,
          isSecure: config.app.plugins.session.cookieOptions.isSecure !== false,
          isSameSite: 'Lax'
        },
        // Store sessions server-side in MongoDB
        maxCookieSize: 0,
        name: config.app.plugins.session.name || 'session',
        cache: {
          cache: 'sessions',
          expiresIn: 24 * 60 * 60 * 1000 // 24 hours
        }
      }
    }
  ]);

  server.ext('onPreHandler', (request, h) => {
    if (request.yar) {
      // `_logIn` is what every login path calls to establish a session: the
      // stored `userId` is the only thing the auth scheme below reads, and the
      // attached user serves the rest of this request without a second lookup.
      // Callers pass a callback, which is invoked with a null error once the
      // session has been written; it never reports a failure.
      request.yar._logIn = function(user, cb) {
        request.yar.set('userId', user._id ? user._id.toString() : user.id);
        request.user = user;
        if (cb) cb(null);
      };

      // Touching the session on every request that has one resets its cache
      // TTL, so a session expires after 24 hours of inactivity rather than 24
      // hours after login.
      if (request.yar.get('userId')) {
        request.yar.touch();
      }
    }
    // A request carrying credentials directly - a server.inject with
    // `credentials` set - skips the auth scheme, so nothing has attached
    // `request.user` yet and the credentials themselves are the user.
    if (!request.user && request.auth.credentials && request.auth.credentials._id) {
      request.user = request.auth.credentials;
    }
    return h.continue;
  });

  // Vision renders through the compile function in lib/util/nunjucks, which
  // owns the environment carrying the application's filters and globals;
  // rendering any other way would lose them. Caching is on in production only,
  // so a template edit is visible without a restart elsewhere.
  server.views({
    engines: {
      html: {
        compile: viewEngine.compile
      }
    },
    relativeTo: path.join(__dirname, config.app.templates),
    path: '.',
    isCached: config.isProd
  });

  // Turns an error into the response its client can use, and stamps the
  // no-store cache headers on everything else.
  //
  // The four branches below return immediately, BEFORE the header assignments
  // that follow them. So a rendered HTML error page carries no Cache-Control,
  // Pragma, Expires or X-Frame-Options, while an API or JSON error, a Boom
  // status outside those four (a 400, for instance) and every non-error
  // response do. Moving the assignments above the branches would change what
  // is sent on the error pages.
  server.ext('onPreResponse', (request, h) => {
    const response = request.response;
    // Framing is denied only on the exact paths config.app.xframeDeny lists,
    // which by default are the landing, login, signup, contact and educators
    // pages - the embed routes other sites load in an iframe are deliberately
    // absent. The match is on the path alone, so a query string cannot defeat
    // it, and a path not listed to the byte is not protected.
    const addXFrame = config.app.xframeDeny && config.app.xframeDeny.indexOf(request.url.pathname) >= 0;

    if (response.isBoom) {
      const statusCode = response.output.statusCode;

      // An /api/ or /partials/ path, or an Accept naming JSON, is answered with
      // the Boom payload; anything else that will accept HTML gets a page.
      const acceptHeader = request.headers.accept || '';
      const isApiRequest = request.path.startsWith('/api/') ||
                           acceptHeader.includes('application/json') ||
                           request.path.startsWith('/partials/');

      const wantsHtml = acceptHeader.includes('text/html') ||
                        (!acceptHeader.includes('application/json') && !isApiRequest);

      if (!isApiRequest && wantsHtml) {
        if (statusCode === 401) {
          // A browser reaching a route it is not authenticated for is sent to
          // the login form; `takeover` stops the remaining extensions so the
          // 401 payload is not what gets written.
          return h.redirect('/login').takeover();
        } else if (statusCode === 404) {
          return h.view('404.html').code(404);
        } else if (statusCode === 403) {
          return h.view('50x.html').code(403);
        } else if (statusCode >= 500) {
          return h.view('50x.html').code(statusCode);
        }
      }

      response.output.headers['Cache-Control'] = cache_control;
      response.output.headers['Pragma'] = 'no-cache';
      response.output.headers['Expires'] = '0';

      if (addXFrame) {
        response.output.headers['X-Frame-Options'] = 'deny';
      }
    }
    // A Boom exposes its headers on `output`, any other response sets them
    // through `header()` - the same three values by two different routes.
    else if (response.header) {
      response.header('Cache-Control', cache_control);
      response.header('Pragma', 'no-cache');
      response.header('Expires', '0');

      if (addXFrame) {
        response.header('X-Frame-Options', 'deny');
      }
    }

    return h.continue;
  });

  // Gives the session cookie a one-year Expires, so a browser keeps it across
  // restarts instead of dropping it at the end of the session.
  //
  // This works by wrapping `_header`, a private field on the response, and it
  // is guarded on that field being a function: `request.cookie` is set by the
  // route wrapper in lib/util/routeParser for a request that establishes a
  // session, but if the framework stops populating `_header` the guard simply
  // fails and the whole extension becomes a silent no-op: the cookie is still
  // sent, just without the Expires this adds, and nothing reports it.
  const cookieIsSecure = config.app.plugins.session.cookieOptions.isSecure !== false;
  server.ext('onPreResponse', (request, h) => {
    if (request.cookie && request.response && typeof request.response._header === "function") {
      const header = request.response._header;
      const sessionName = config.app.plugins.session.name || 'session';

      request.response._header = function(key, value) {
        if (key.match(/^set\-cookie$/i)) {
          // A single Set-Cookie arrives as a string, several as an array.
          if (!Array.isArray(value)) {
            value = [value];
          }
          const nextYear = new Date();
          nextYear.setFullYear(nextYear.getFullYear() + 1);

          for (let i = 0; i < value.length; i++) {
            // Only the session cookie is rewritten, and only when it does not
            // already carry an Expires of its own - matching by prefix, since
            // the value follows the name.
            if (value[i].indexOf(sessionName) === 0) {
              if (!value[i].match(/;\s*Expires=/i)) {
                value[i] += "; Expires=" + nextYear.toUTCString();
              }
              // SameSite=None requires Secure, so the pair is added together
              // and only when the cookie is being served securely.
              if (cookieIsSecure) {
                value[i] += "; SameSite=None; Secure";
              }
            }
          }
        }
        // Every other header, and the rewritten value, still go through the
        // framework's own implementation.
        header.call(request.response, key, value);
      }
    }

    return h.continue;
  });

  // Resolves the session's `userId` into the request's credentials.
  //
  // Every outcome other than a valid, enabled user answers through
  // `h.unauthenticated`, which under the 'try' default below leaves the request
  // to continue as a guest rather than rejecting it - so a route that does not
  // require auth still serves, and one that does gets the 401 the error mapper
  // above turns into a redirect to /login. A session naming a user who has been
  // removed or disabled is cleared here, so the next request arrives clean.
  server.auth.scheme('session', (server, options) => {
    return {
      authenticate: async (request, h) => {
        const userId = request.yar.get('userId');

        if (!userId) {
          return h.unauthenticated(Boom.unauthorized('Not logged in'), { credentials: {} });
        }

        try {
          // The model layer in lib/models/model.js returns the query itself and
          // only feeds an optional callback from it, so awaiting it here yields
          // the document, null, or a rejection this catch handles.
          const user = await User.findById(userId);

          if (!user) {
            request.yar.clear('userId');
            return h.unauthenticated(Boom.unauthorized('User not found'), { credentials: {} });
          }

          if (user.hasRole && user.hasRole("disabled")) {
            request.yar.clear('userId');
            return h.unauthenticated(Boom.unauthorized('Account disabled'), { credentials: {} });
          }

          // Handlers read `request.user`; the credentials are the same document.
          request.user = user;
          return h.authenticated({ credentials: user });
        } catch (err) {
          log.error('Auth error:', err);
          return h.unauthenticated(Boom.unauthorized('Auth error'), { credentials: {} });
        }
      }
    };
  });

  server.auth.strategy('session', 'session');

  // 'try' rather than 'required': the scheme runs on every route, but a failed
  // authentication continues as a guest instead of answering 401, which is what
  // lets a route serve both signed-in and anonymous visitors. A route that must
  // be protected declares `auth: 'session'` for itself.
  server.auth.default({ strategy: 'session', mode: 'try' });

  // Models are assigned to bare globals because controllers, models and views
  // reference them by name (`User`, `Course`, ...) instead of requiring them.
  // The assignments happen before the routes are registered, so a handler
  // always finds them; `gleak.ignore` below lists the same names.
  User     = require('./lib/models/user');
  Course   = require('./lib/models/course');
  Lesson   = require('./lib/models/lesson');
  Material = require('./lib/models/material');
  File     = require('./lib/models/file');
  Trinket  = require('./lib/models/trinket');
  Interaction = require('./lib/models/interaction');
  Folder   = require('./lib/models/folder');
  CourseInvitation = require('./lib/models/courseInvitation');

  // Installs the server methods that a route's string-form pre-handler is
  // resolved through (`server.methods[name]`). Registering the routes before
  // this would leave those names unresolvable.
  Helpers.register(server);

  // `config.routes` is the parsed route table that config/app.config produces by
  // handing lib/util/routeParser the declarations in config/routes.js and
  // config/api_routes.js; every registered route comes from that one call.
  server.route(config.routes);

  if (config.app.start) {
    await server.start();
    log.info('Server started on port: ' + server.info.port);

    detectLeaks();
  }

  return server;
};

const detectLeaks = function() {
  let leakData = "";

  gleak.detectNew().forEach(function(name) {
    let value = "unknown", json;
    try {
      value = eval(name);
      if (typeof value === "function") {
        value = value.toString();
      }
      else {
        json  = JSON.stringify(value);
        value = json;
      }
    } catch(e) {}

    leakData += name + "=" + value + "\n";
  });

  if (leakData) {
    console.log('leaked!', leakData);
  }
};

gleak.ignore("User", "Course", "Lesson", "Material", "File", "Trinket");
gleak.ignore("Interaction");
gleak.ignore("Folder", "CourseInvitation");
gleak.ignore("log", "NODE_CONFIG", "tokenizer", "$V", "$M", "$L", "$P");
gleak.ignore("DEFAULT_FILE_PATH", "Promise");

// Poll for new leaks every 60 seconds
setInterval(detectLeaks, 60*1000);

// The export is the promise of the configured server, which the test harness
// awaits. A failure to start is terminal for the process rather than a rejected
// promise handed to whoever required this module.
const serverPromise = init().catch(err => {
  log.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = serverPromise;
