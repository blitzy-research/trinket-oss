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

// ---------------------------------------------------------------------------
// Cross-origin write protection
// ---------------------------------------------------------------------------
//
// The session cookie is this application's only credential. Every
// state-changing route authenticates from it alone -- no route issues or
// verifies a token -- so a request that arrives carrying the cookie carries the
// signed-in user's whole authority, which is what makes a forged cross-origin
// write worth rejecting at all.
//
// `isSameSite: 'Lax'` on the state definition in `init` keeps a browser from
// attaching that cookie to a cross-SITE write. That is a client-side control
// and it is not the whole defence: it says nothing about a same-SITE sibling
// origin -- committed configuration scopes the cookie to a parent domain
// (`config/default.yaml`'s `domain: .trinket.dev`), so any host under it is
// same-site -- and nothing at all about a client that attaches the cookie
// itself. So the origin of a credentialed write is checked here as well.
//
// The three conditions are narrow on purpose, and together they are the reason
// this rejects nothing the application's own clients send:
//
//   1. the method changes state -- POST, PUT, PATCH or DELETE. A GET is not
//      guarded, so no navigation, embed or asset load is affected;
//   2. the request carries the session cookie, i.e. the ambient credential a
//      forged request rides on. An anonymous cross-origin POST is untouched
//      and answers exactly as it did;
//   3. the client itself reported where it came from, and it was not us.
//
// A request that reports no origin at all is allowed through: `server.inject`,
// curl, the mocha suite, the parity corpus and every server-to-server caller
// fall in that class, as does a top-level navigation a user typed. That is
// checked, not assumed -- no request in `test/**` or in the committed corpus
// carries `Origin`, `Referer` or `Sec-Fetch-Site`.
//
// Registered as approved deviation 8 in docs/preserved-quirks.md §11.12.
const CROSS_ORIGIN_WRITE_METHODS = { post: true, put: true, patch: true, 'delete': true };

// The scheme's default port, which an authority may state or omit for the same
// origin: a browser sends `Origin: https://example.com` while a `Host` header
// may read `example.com:443`, and the two name one origin.
const DEFAULT_AUTHORITY_PORTS = { ':80': true, ':443': true };

/**
 * Normalizes a host authority (`host` or `host:port`) for comparison.
 *
 * Lower-cased, because a host is case-insensitive, and with a default port
 * removed so that stating it and omitting it compare equal. Anything that is
 * not a non-empty string normalizes to `null`, which never matches.
 *
 * @param {string} value A `Host` header value or a URL's host component.
 * @returns {?string} The normalized authority, or `null`.
 */
const normalizeAuthority = function(value) {
  if (typeof value !== 'string') {
    return null;
  }

  let authority = value.trim().toLowerCase();

  if (!authority) {
    return null;
  }

  // Only a trailing default port is stripped, and only after the last colon,
  // so an IPv6 literal's own colons are left alone.
  const colon = authority.lastIndexOf(':');

  if (colon > 0 && authority.indexOf(']', colon) < 0 &&
      DEFAULT_AUTHORITY_PORTS[authority.slice(colon)]) {
    authority = authority.slice(0, colon);
  }

  return authority || null;
};

/**
 * The normalized host authority of an absolute URL or a serialized origin.
 *
 * `URL` elides a default port for the scheme itself, so `https://x:443` and
 * `https://x` both yield `x`. A relative reference, an opaque `null` origin
 * and an unparseable value all yield `null` -- which the caller reads as "no
 * authority to match", never as "ours".
 *
 * @param {string} value An origin (`https://host:port`) or absolute URL.
 * @returns {?string} The normalized authority, or `null`.
 */
const absoluteUrlAuthority = function(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    return normalizeAuthority(new URL(value.trim()).host);
  } catch (err) {
    return null;
  }
};

/**
 * The host authorities a credentialed state-changing request may come from.
 *
 * Built once at startup from configuration that already exists:
 *
 *   * `config.url` -- the client-facing origin `config/app.config.js` composes
 *     from `app.url`, and the one `lib/util/routeParser`'s `redirect()`
 *     prefixes onto every absolute `Location`. A page this application links to
 *     is by definition served from it;
 *   * `app.security.trustedOrigins` -- the operator's list, empty by default.
 *     A deployment that genuinely serves its UI from another host (user
 *     subdomains, for instance) names it here rather than patching code.
 *
 * The request's own `Host` is added per request in `crossOriginWriteRejection`,
 * which is what makes a same-origin write pass on any host the process is
 * reached by -- a developer port, a container name, a subdomain -- without
 * configuration.
 *
 * @param {Object} cfg The loaded application configuration.
 * @returns {Array.<string>} Normalized authorities, without duplicates.
 */
const trustedWriteAuthorities = function(cfg) {
  const authorities = [];

  const add = function(authority) {
    if (authority && authorities.indexOf(authority) < 0) {
      authorities.push(authority);
    }
  };

  add(absoluteUrlAuthority(cfg.url));

  const configured = cfg.app && cfg.app.security && cfg.app.security.trustedOrigins;

  if (Array.isArray(configured)) {
    configured.forEach(function(entry) {
      // An entry may be written as an origin or as a bare authority; both are
      // accepted, so a deployment cannot silently mis-state its own host.
      add(absoluteUrlAuthority(entry) || normalizeAuthority(entry));
    });
  }

  return authorities;
};

/**
 * Whether a request carries the session cookie.
 *
 * `request.state` holds what hapi could parse, and under the server's
 * `state.failAction: 'log'` a cookie whose seal does not verify is dropped
 * from it -- so the raw header is read as well. A request carrying an
 * unverifiable session cookie is still a request that tried to ride one, and
 * treating it as credentialed costs nothing: it has no authority to lose.
 *
 * @param {Object} request The hapi request.
 * @param {string} name The configured session cookie name.
 * @returns {boolean}
 */
const carriesSessionCookie = function(request, name) {
  if (request.state && request.state[name] !== undefined) {
    return true;
  }

  const raw = request.headers && request.headers.cookie;

  if (typeof raw !== 'string' || !raw) {
    return false;
  }

  const prefix = name.toLowerCase() + '=';

  return raw.split(';').some(function(pair) {
    return pair.trim().toLowerCase().indexOf(prefix) === 0;
  });
};

/**
 * Why a credentialed state-changing request should be rejected, or `null`.
 *
 * The client's own account of its origin is read in one order, and the first
 * header present decides -- a later one cannot overrule it:
 *
 *   1. `Origin`, which a browser sends on every cross-origin request and, in
 *      current browsers, on same-origin writes too. An opaque `Origin: null`
 *      -- a sandboxed frame, a `data:` document -- yields no authority and is
 *      therefore not ours;
 *   2. `Referer`, when there is no `Origin`. A value that is not an absolute
 *      URL carries no origin to judge, so it is not treated as evidence
 *      either way;
 *   3. `Sec-Fetch-Site`, when there is neither. `cross-site` and `same-site`
 *      are the browser stating plainly that the initiator was not this origin;
 *      `same-origin` and `none` are not.
 *
 * Comparison is on the host authority and NOT on the scheme, deliberately: the
 * shipped reverse proxy (`serverside/nginx/nginx-ssl.conf`) terminates TLS and
 * forwards plain HTTP with `Host $host`, so the browser reports an `https`
 * origin to a process serving `http`. Comparing schemes would reject every
 * legitimate write behind it, and a same-host request over the other scheme is
 * not the cross-origin forgery this guards against.
 *
 * @param {Object} request The hapi request.
 * @param {Array.<string>} trusted Authorities from `trustedWriteAuthorities`.
 * @returns {?string} A reason naming the header and its value, or `null` to
 *   allow the request.
 */
const crossOriginWriteRejection = function(request, trusted) {
  const headers = request.headers || {};
  const own = normalizeAuthority(request.info && request.info.host);

  const permitted = function(authority) {
    return !!authority && (authority === own || trusted.indexOf(authority) >= 0);
  };

  if (typeof headers.origin === 'string' && headers.origin.trim()) {
    const origin = headers.origin.trim();

    return permitted(absoluteUrlAuthority(origin))
      ? null
      : 'Origin: ' + origin;
  }

  if (typeof headers.referer === 'string' && headers.referer.trim()) {
    const referer = headers.referer.trim();
    const authority = absoluteUrlAuthority(referer);

    if (!authority) {
      return null;
    }

    return permitted(authority) ? null : 'Referer: ' + referer;
  }

  const fetchSite = typeof headers['sec-fetch-site'] === 'string'
    ? headers['sec-fetch-site'].trim().toLowerCase()
    : '';

  if (fetchSite === 'cross-site' || fetchSite === 'same-site') {
    return 'Sec-Fetch-Site: ' + fetchSite;
  }

  return null;
};

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
      },
      // THE ONLY BOUND ON HOW LONG A REQUEST MAY GO UNANSWERED, because hapi
      // supplies none: `routes.timeout.server` defaults to `false`
      // (node_modules/@hapi/hapi/lib/config.js:220), and nothing in this
      // repository set it - no route declaration and no configuration file
      // carries a `timeout` key. So a handler that never produces a response
      // held its socket, its request object and everything the request had
      // resolved for as long as the client was willing to wait. QA finding
      // W002-I6 measured that directly: 25 concurrent `GET /api/exports/{id}`
      // requests for a castable-but-absent ObjectId were all still parked at
      // 6 s, and individual attempts ran to a 20 s client timeout. Those six
      // export branches now answer - the finder's callback re-delivery is
      // restored in lib/models/model.js and docs/preserved-quirks.md 9.9
      // records the outcome - so this setting is not what fixes them. It is
      // what keeps any remaining never-settling path, including the one
      // docs/preserved-quirks.md 10.12 preserves deliberately, from retaining
      // a connection indefinitely.
      //
      // TWO MINUTES, AND NOT SOMETHING TIGHTER, for three reasons that are
      // properties of the framework rather than preferences.
      //
      // It bounds the time to PRODUCE a response, never the time to transmit
      // one. The timer is armed from `request.info.received`
      // [node_modules/@hapi/hapi/lib/request.js:352-373] and cleared in
      // `request._reply()` [request.js:443-444], which runs BEFORE
      // `Transmit.send` [request.js:470] in that same method - so a slow
      // download of a large course archive or a stored file cannot be
      // truncated by it once the response object exists.
      //
      // Payload reception is already bounded, separately and much more
      // tightly: hapi's `payload.timeout` default is 10 s
      // [node_modules/@hapi/hapi/lib/config.js:159] against a ceiling of the
      // 10 MB this application's largest `payload.maxBytes` declares
      // (config/routes.js:374, config/api_routes.js:788). No legitimate
      // request here is anywhere near two minutes.
      //
      // And every gated measurement is inside it, so no recorded outcome
      // moves: `test/parity/corpus.json` drives 402 of its 405 steps with a
      // 15 s budget and the remaining three with 4 s
      // (test/parity/capture.js:219,223), and
      // docs/preserved-quirks.md 10.12 measures its non-settlement at
      // 10.002 s on both trees.
      //
      // WHAT IT DOES CHANGE, stated plainly rather than buried: a client that
      // waits longer than 120 s on a path that never settles now receives
      // hapi's own `Boom.serverUnavailable()` 503
      // [node_modules/@hapi/hapi/lib/request.js:795-799] instead of nothing at
      // all. That is a target-only difference from the baseline, which had no
      // such bound. docs/preserved-quirks.md 10.12 records the non-settlement
      // as a preserved quirk and this is a BOUND on it rather than an answer
      // to it - the request still produces no response of its own, and every
      // window any gate measures still records none. The precedence argument
      // is AAP 0.7's own, applied there three times already: R-b is
      // unqualified that the application must genuinely run, and the absence
      // of a response is not a behaviour a client can depend on.
      timeout: {
        server: 120000
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

  // Rejects a credentialed state-changing request that the client itself
  // reports as coming from another origin. The three conditions, the header
  // precedence and the reason this cannot reach a request the application's own
  // clients make are all documented at CROSS_ORIGIN_WRITE_METHODS above.
  //
  // `onPostAuth` is the stage: the route is resolved and authentication has
  // run, so the rejection is recorded against a real route, and it is still
  // ahead of validation, the route's pre-handlers and the handler -- nothing
  // has been read or written when it fires. A `Boom.forbidden` from here takes
  // the same path any other error does: the error mapper below answers `/api/`
  // and JSON callers with the Boom payload and a browser with the 403 page,
  // measured as both -- an 80-byte Boom body on /api/folders and the rendered
  // 50x.html at 403 on a non-API route.
  const sessionCookieName = config.app.plugins.session.name || 'session';
  const trustedOriginAuthorities = trustedWriteAuthorities(config);

  server.ext('onPostAuth', (request, h) => {
    if (!CROSS_ORIGIN_WRITE_METHODS[request.method]) {
      return h.continue;
    }

    if (!carriesSessionCookie(request, sessionCookieName)) {
      return h.continue;
    }

    const rejection = crossOriginWriteRejection(request, trustedOriginAuthorities);

    if (rejection) {
      // One line per rejection, at warn: an operator needs to see a legitimate
      // client being turned away (which is what `app.security.trustedOrigins`
      // is for) as readily as an attempt.
      log.warn('Rejected cross-origin ' + request.method.toUpperCase() + ' ' +
        request.path + ' carrying a session cookie (' + rejection + ')');

      throw Boom.forbidden('Cross-origin request rejected');
    }

    return h.continue;
  });

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
  //
  // WHAT THIS EXTENSION CANNOT DO ABOUT COOKIES ON A 500, recorded here
  // because it looks like something this mapper forgot and is not.
  //
  // hapi 21 writes only cookie CLEARS when the response carries a 500 error:
  // node_modules/@hapi/hapi/lib/headers.js `exports.state` gates the whole of
  // `request._states` on `response._error?.output.statusCode === 500`, where
  // hapi 20.3.0 pushed every entry unconditionally. The yar session commit IS
  // such an entry, and the writer runs in the framework's marshal cycle
  // (lib/route.js:335) - after this extension and after the cookie patch
  // below - so on a 500 the session Set-Cookie is not on the wire, whether the
  // handler threw, returned a Boom, or failed while marshalling. A 500 a later
  // extension REPLACES carries no `_error`, which is why the 50x.html pages
  // this mapper renders still send it.
  //
  // A marshal-time failure is worse than late: it is invisible from here. This
  // extension runs exactly once for such a request and sees a response whose
  // `isBoom` is false, and the 500 the client receives is built AFTERWARDS by
  // `internals.fail` in node_modules/@hapi/hapi/lib/transmit.js, which re-runs
  // the marshal cycle and not the request lifecycle. Measured: a header set
  // here does not reach that response at all - which is how the seven
  // /admin/* and /account/* view-render failures answer a 96-byte JSON 500
  // carrying none of the Pragma or Expires stamped below, while a handler-time
  // Boom 500 carries both. That pair is the on-wire discriminator between the
  // two arrival paths.
  //
  // So the divergence is REGISTERED, not patched: docs/preserved-quirks.md
  // section 12 carries the measurement, the AAP T-6 conflict argument and the
  // decision, and test/parity/replay.js's `hapi21-500-clear-only-states` rule
  // is the gate. No state is re-attached on 5xx here. Doing so would mean
  // hand-sealing a yar cookie through `server.states.format` into
  // `boom.output.headers` - authored behaviour no AAP requirement describes,
  // outside R-a's four permitted diff categories, deliberately defeating an
  // upstream security change - and it could not cover the marshal-time subset
  // in any case.
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

      // The diagnostic record for an internal failure that reached no other
      // log. Before this, a 500 could be answered with NOTHING written
      // anywhere: the Layer 1 catch-all in lib/util/routeParser.js wraps only
      // the handler, so a throw in a PRE-handler never passes through it, and
      // hapi's own internal-error signal goes to a `request` event channel this
      // application does not subscribe to. Measured: one unauthenticated
      // `POST /login` carrying `{"email":{"$ne":null}}` made
      // lib/util/helpers.js:128 call `.trim()` on an object, and the client got
      // a 500 while stdout and stderr stayed completely silent -- an operator
      // with a trivially discoverable input and no record of it (QA finding
      // obs-prehandler-500-logs-nothing).
      //
      // Three properties make this safe to add here. It runs BEFORE the four
      // branches below and returns nothing, so no response, status, header or
      // body changes -- the client still receives exactly the page or payload
      // it did. It fires only for a 500, so the deliberate 501 from
      // `Boom.notImplemented` on the feature-flagged asset routes is not
      // reported as a fault. And it skips a Boom already marked by
      // `markLogged` in lib/util/routeParser.js, so a handler throw -- which
      // Layer 1 logs with its stack -- still produces exactly one line rather
      // than two.
      if (statusCode === 500 && response.trinketLogged !== true) {
        log.error('unlogged 500 on ' + request.method.toUpperCase() + ' ' + request.path
          + ': ' + (response.stack || response.message || String(response)));
      }

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
  // sent, just without the Expires this adds, and nothing reports it. It is
  // NOT a no-op on hapi 21.4.10: a login here emits
  // `session=<sealed>; HttpOnly; SameSite=Lax; Path=/; Expires=<+1y>`,
  // measured.
  //
  // On a 500 there is no Set-Cookie for this to rewrite, and that is upstream
  // rather than local: hapi 21 writes only cookie CLEARS when the response
  // carries a 500 error (see the mapper above for the headers.js branch and
  // the marshal-cycle ordering). A 500 therefore loses no horizon that this
  // extension had appended, because it never appended one there: `Expires` is
  // added only where `request.cookie` is set, i.e. on the response that
  // establishes the session, and hapi 20 repeated the cookie on a 500 with
  // `HttpOnly; Path=/; SameSite=Lax` and no `Expires` or `Max-Age` at all.
  // Measured in a real browser store, receiving that shape DOWNGRADES a
  // persistent record to session-only while receiving no header leaves it
  // exactly as held - so the suppression is the safer of the two shapes for a
  // client, not a loss. The session id is unchanged either way, since yar
  // re-sets the id it received, and the server-side store write happens in
  // both. Registered, with its conflict argument, its measurements and its
  // gate, at docs/preserved-quirks.md section 12; deliberately not repaired
  // here, because re-attaching state on a 5xx is authored behaviour outside
  // this migration's four permitted diff categories.
  //
  // WHAT THIS EXTENSION NO LONGER DOES, and why, because the append it lost is
  // in the baseline and in AAP §0.6.1's description of this contract.
  //
  // Under `isSecure` this also appended `"; SameSite=None; Secure"` to the same
  // serialised value. The attribute was already there - the state definition
  // above sets `isSameSite: 'Lax'` and hapi had serialised it - so the header
  // carried `SameSite` TWICE and a browser applied the last occurrence,
  // storing the session cookie as `SameSite=None` and attaching it to
  // cross-site writes. Measured on this tree before the removal: one
  // `POST /login` in secure mode emitted
  // `session=<sealed>; Secure; HttpOnly; SameSite=Lax; Path=/; Expires=<+1y>; SameSite=None; Secure`.
  // Registered as approved deviation 7 in docs/preserved-quirks.md §11.11 with
  // the precedence argument, the field-by-field contract and its gate; the
  // `Expires` append below is untouched, and `Secure` is still emitted -- by
  // `isSecure` on the state definition, which is where it belongs.
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
