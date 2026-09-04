#!/usr/bin/env node

// Add Q-compatible methods to native Promise for Mongoose 6 compatibility
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
// gleak is not compatible with Node 16+ (uses GLOBAL which was removed)
// Use a no-op fallback for now
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

// Main async initialization
const init = async () => {
  // Validate required configuration
  const sessionPassword = config.app.plugins.session.cookieOptions.password;
  const sessionPasswordMissing = !sessionPassword || sessionPassword.length < 32;

  // Production still fails fast, and this guard is evaluated before the
  // non-production fallback below so that no production process can reach it.
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

  // Outside production, derive an ephemeral secret so that a clean checkout
  // boots: config/local.yaml is gitignored, so `git clean -xfd` removes the
  // only source of a real value and config/default.yaml ships an empty one.
  // Installed with a data descriptor rather than a plain assignment because the
  // `config` package watches every property through an accessor and persists any
  // assignment to config/runtime.json. Writing this secret there would put it on
  // disk, make it outlive the process, and -- since runtime.json is layered over
  // every other source -- let a later NODE_ENV=production run boot on a
  // development secret instead of failing fast above. Replacing the accessor
  // keeps the value visible to the server.register read below and persists
  // nothing.
  if (sessionPasswordMissing) {
    Object.defineProperty(config.app.plugins.session.cookieOptions, 'password', {
      value: require('crypto').randomBytes(32).toString('hex'),
      writable: true,
      enumerable: true,
      configurable: true
    });
    log.info('Session cookie password is not configured; generated an ephemeral one for this non-production process. Set app.plugins.session.cookieOptions.password in config/local.yaml to keep sessions valid across restarts.');
  }

  // Create server with Hapi 20+ configuration
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

  // Register plugins
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

  // Add _logIn method to yar for session-based login
  // Also ensure request.user is set from auth credentials (for inject() calls)
  // Touch session on each request to implement sliding expiration
  server.ext('onPreHandler', (request, h) => {
    if (request.yar) {
      request.yar._logIn = function(user, cb) {
        // Store user id in session
        request.yar.set('userId', user._id ? user._id.toString() : user.id);
        // Also attach user to request for immediate use
        request.user = user;
        if (cb) cb(null);
      };

      // Sliding expiration: touch session to reset TTL on each authenticated request
      if (request.yar.get('userId')) {
        request.yar.touch();
      }
    }
    // Set request.user from auth credentials if not already set
    // This handles inject() calls that pass credentials directly
    if (!request.user && request.auth.credentials && request.auth.credentials._id) {
      request.user = request.auth.credentials;
    }
    return h.continue;
  });

  // Configure view engine (Vision) - use nunjucks compile function
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

  // Add onPreResponse extension for cache headers and error pages
  server.ext('onPreResponse', (request, h) => {
    const response = request.response;
    const addXFrame = config.app.xframeDeny && config.app.xframeDeny.indexOf(request.url.pathname) >= 0;

    if (response.isBoom) {
      const statusCode = response.output.statusCode;

      // Check if this is an HTML request (not API/JSON)
      const acceptHeader = request.headers.accept || '';
      const isApiRequest = request.path.startsWith('/api/') ||
                           acceptHeader.includes('application/json') ||
                           request.path.startsWith('/partials/');

      // Render HTML error pages for browser requests
      const wantsHtml = acceptHeader.includes('text/html') ||
                        (!acceptHeader.includes('application/json') && !isApiRequest);

      if (!isApiRequest && wantsHtml) {
        if (statusCode === 401) {
          // Redirect to login for unauthorized page requests
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

  // Add onPreResponse extension for cookie expiration
  const cookieIsSecure = config.app.plugins.session.cookieOptions.isSecure !== false;
  server.ext('onPreResponse', (request, h) => {
    // if this is a cookie-setting request and we have a _header method
    if (request.cookie && request.response && typeof request.response._header === "function") {
      const header = request.response._header;
      const sessionName = config.app.plugins.session.name || 'session';

      request.response._header = function(key, value) {
        // find the 'set-cookie' header
        if (key.match(/^set\-cookie$/i)) {
          if (!Array.isArray(value)) {
            value = [value];
          }
          const nextYear = new Date();
          nextYear.setFullYear(nextYear.getFullYear() + 1);

          for (let i = 0; i < value.length; i++) {
            // find the session portion of the cookie
            if (value[i].indexOf(sessionName) === 0) {
              // add a custom expires if an expires is not already present
              if (!value[i].match(/;\s*Expires=/i)) {
                value[i] += "; Expires=" + nextYear.toUTCString();
              }
              // Only add Secure flag if isSecure is true in config
              if (cookieIsSecure) {
                value[i] += "; SameSite=None; Secure";
              }
            }
          }
        }
        // call the original _header method
        header.call(request.response, key, value);
      }
    }

    return h.continue;
  });

  // Simple session-based auth scheme for Hapi 20+
  server.auth.scheme('session', (server, options) => {
    return {
      authenticate: async (request, h) => {
        // Get user from session via yar
        const userId = request.yar.get('userId');

        if (!userId) {
          // Not authenticated - continue as guest (for 'try' mode)
          return h.unauthenticated(Boom.unauthorized('Not logged in'), { credentials: {} });
        }

        try {
          // lib/models/model.js returns the same thenable it feeds the optional
          // callback, so awaiting it directly yields the identical document,
          // null, or rejection the hand-rolled Promise wrapper used to relay.
          const user = await User.findById(userId);

          if (!user) {
            request.yar.clear('userId');
            return h.unauthenticated(Boom.unauthorized('User not found'), { credentials: {} });
          }

          if (user.hasRole && user.hasRole("disabled")) {
            request.yar.clear('userId');
            return h.unauthenticated(Boom.unauthorized('Account disabled'), { credentials: {} });
          }

          // Attach user to request
          request.user = user;
          return h.authenticated({ credentials: user });
        } catch (err) {
          log.error('Auth error:', err);
          return h.unauthenticated(Boom.unauthorized('Auth error'), { credentials: {} });
        }
      }
    };
  });

  // Register the session auth strategy
  server.auth.strategy('session', 'session');

  // Make session auth the default but don't require it
  server.auth.default({ strategy: 'session', mode: 'try' });

  // Load models (global for backwards compatibility)
  User     = require('./lib/models/user');
  Course   = require('./lib/models/course');
  Lesson   = require('./lib/models/lesson');
  Material = require('./lib/models/material');
  File     = require('./lib/models/file');
  Trinket  = require('./lib/models/trinket');
  Interaction = require('./lib/models/interaction');
  Folder   = require('./lib/models/folder');
  CourseInvitation = require('./lib/models/courseInvitation');

  // Register helpers
  Helpers.register(server);

  // Register routes
  server.route(config.routes);

  // Start the server
  if (config.app.start) {
    await server.start();
    log.info('Server started on port: ' + server.info.port);

    detectLeaks();

    // This process now owns a listening socket, a MongoDB connection, the queue
    // singletons and the leak-detect interval, so it also owns ending them. The
    // handlers are installed HERE, under the same flag that started the
    // listener, rather than at module scope: with `app.start: false` this module
    // is a library the test harness requires (test/lib/00-ready.js awaits the
    // exported promise and closes the server in its own root `after`), and
    // test/parity/mongo.js installs its own signal handling for the in-memory
    // database. Claiming the host process's signals in that mode would pre-empt
    // a teardown that is not ours.
    installShutdownHandlers(server);
  }

  return server;
};

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
// Nothing on the request path reaches any of this: the handlers below run only
// on SIGINT or SIGTERM, so no route, response, cookie or error mapping changes.
//
// Two properties are load-bearing rather than stylistic.
//
//   It is BOUNDED. test/parity/server.js gives the child STOP_GRACE_MS = 5000ms
//   after SIGTERM before escalating to SIGKILL, and `pm2` (Dockerfile) applies
//   its own kill timeout, so a shutdown that could block would be worse than no
//   shutdown at all - it would turn today's prompt exit into a forced kill on
//   every run. Each stage therefore carries its own timeout and the whole
//   sequence carries a hard watchdog, both well inside that window. A database
//   or Redis endpoint that has gone away cannot hold the process open.
//
//   It PRESERVES THE EXIT DISPOSITION. Measured before this was added: SIGTERM
//   to the running application ended it in 108ms through the signal's default
//   disposition, so the wait status a supervisor sees is "terminated by signal",
//   not an exit code. After the ordered close the handler removes itself and
//   re-raises the same signal, which reproduces that status exactly instead of
//   substituting an exit code a launcher or an orchestrator would read
//   differently.
//
// Ordering is deliberate: stop accepting requests first, then close what an
// in-flight request could still be using. Draining the connections before the
// queues and the database means no handler is left reaching for a closed
// connection, which would surface as a spurious 500 during shutdown.

// The leak-detect interval's handle. `setInterval` below holds the event loop
// open for the life of the process, which is exactly why a polite wait cannot
// end it and why clearing it is the first thing shutdown does. It is NOT
// unref'd: that would let the process exit on its own and change when it lives,
// which is observable behaviour rather than cleanup.
let leakInterval = null;

// One shutdown, however many signals arrive. A second SIGTERM while the first
// is in flight must not start a second teardown - hapi's `stop` is not
// re-entrant and a doubled `queues.closeAll` would reject on an already-closed
// queue - so the sequence runs once and later signals are noted and ignored.
let shuttingDown = false;

/**
 * Runs one stage of the shutdown, bounded, and swallows its failure.
 *
 * A stage that rejects or hangs must not prevent the stages after it: the point
 * of the sequence is that the process ends having released what it could, and a
 * queue that never reached its Redis server is a normal state here rather than
 * an error. Both outcomes are logged, so a stage that stopped working is
 * visible rather than silent.
 *
 * @param {string} label What the stage is called in the log.
 * @param {number} budgetMs How long it is given before it is abandoned.
 * @param {function(): (Promise|undefined)} run The stage itself.
 * @returns {Promise<void>} Always resolves.
 */
const shutdownStage = async function(label, budgetMs, run) {
  let timer = null;

  try {
    await Promise.race([
      Promise.resolve().then(run),
      new Promise((resolve, reject) => {
        timer = setTimeout(function() {
          reject(new Error('did not finish within ' + budgetMs + 'ms'));
        }, budgetMs);
      })
    ]);
    log.info('Shutdown: ' + label + ' closed.');
  }
  catch (err) {
    log.error('Shutdown: ' + label + ' did not close cleanly: ' +
      ((err && err.message) || err));
  }
  finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

/**
 * Closes the listener, the queues and the database connection, in that order.
 *
 * `lib/util/queues` and `config/db` are required HERE rather than at the top of
 * this file, and that is not laziness. AAP §0.6.5 establishes that
 * `mongoose-schema-extend` replaces the global `Object.getPrototypeOf` and makes
 * `@hapi/hapi` unloadable if it loads first; the require order this file already
 * has is therefore load-bearing, and adding a module to the top of it risks the
 * ordering rather than the shutdown. By the time a signal arrives both modules
 * are long since in the require cache - `config/app.config` pulled in
 * `config/db`, and the controllers pulled in `lib/util/queues` - so these
 * requires return the very singletons the application has been using, which is
 * the only thing that makes closing them meaningful.
 *
 * @param {Object} server The started hapi server.
 * @returns {Promise<void>} Always resolves.
 */
const shutdownResources = async function(server) {
  if (leakInterval) {
    clearInterval(leakInterval);
    leakInterval = null;
  }

  // Stop accepting connections and let in-flight requests finish. The explicit
  // timeout matters: hapi's own default would let a keep-alive connection hold
  // the close for longer than the launcher's grace window.
  await shutdownStage('the HTTP listener', 1500, function() {
    return server.stop({ timeout: 1000 });
  });

  await shutdownStage('the job queues', 1000, function() {
    return require('./lib/util/queues').closeAll();
  });

  await shutdownStage('the MongoDB connection', 1000, function() {
    return require('./config/db').disconnect();
  });
};

/**
 * Installs the SIGINT and SIGTERM handlers.
 *
 * @param {Object} server The started hapi server.
 * @returns {undefined}
 */
const installShutdownHandlers = function(server) {
  // Kept so that EVERY handler this function installed can be removed before
  // the signal is re-raised. Removing only the one that fired would leave the
  // other registered, and a signal with any listener attached does not reach
  // its default disposition - so re-raising it would be absorbed by our own
  // listener and the process would never end.
  const installed = [];

  const shutdown = function(signal) {
    if (shuttingDown) {
      log.info('Shutdown: ' + signal + ' received while already shutting ' +
        'down; ignoring it.');
      return;
    }

    shuttingDown = true;
    log.info('Shutdown: ' + signal + ' received; closing the listener, the ' +
      'job queues and the MongoDB connection.');

    // The watchdog is the last guarantee. Every stage is bounded already, so
    // reaching this means something outside the stages is wedged - and a
    // supervisor waiting on us would escalate to SIGKILL anyway, which releases
    // nothing. Ending here at least means the stages that could close, did. It
    // is deliberately NOT unref'd: an unref'd watchdog would let the process
    // slip out with exit code 0 in exactly the case it exists to report.
    const watchdog = setTimeout(function() {
      log.error('Shutdown: did not complete within 4000ms; exiting now.');
      process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
    }, 4000);

    shutdownResources(server).then(function() {
      clearTimeout(watchdog);
      log.info('Shutdown: complete.');

      // Re-raise the signal with our own handlers removed, so the process ends
      // through the signal's default disposition and a supervisor sees the
      // same wait status it saw before this handler existed.
      installed.forEach(function(entry) {
        process.removeListener(entry.signal, entry.handler);
      });

      process.kill(process.pid, signal);
    });
  };

  ['SIGINT', 'SIGTERM'].forEach(function(signal) {
    const handler = function() {
      shutdown(signal);
    };

    installed.push({ signal: signal, handler: handler });
    process.on(signal, handler);
  });
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

// Poll for new leaks every 60 seconds. The handle is retained so that an
// ordered shutdown can clear it; the timer itself is unchanged, still installed
// unconditionally at module scope, and still holds the event loop open exactly
// as it did before.
leakInterval = setInterval(detectLeaks, 60*1000);

// Initialize and export
const serverPromise = init().catch(err => {
  log.error('Failed to start server:', err);
  process.exit(1);
});

module.exports = serverPromise;
