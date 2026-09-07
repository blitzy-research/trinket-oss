#!/usr/bin/env node

var mod_tab     = require('tab'),
    util        = require('util'),
    Joi         = require('joi'),
    Boom        = require('@hapi/boom'),
    config      = require('config'),
    _           = require('underscore'),
    crypto      = require('crypto'),
    fs          = require('fs'),
    path        = require('path'),
    accepts     = require('accepts'),
    url         = require('url'),
    ObjectUtils = require('./objectUtils'),
    HAS_EXT     = /\.[a-z]+$/,
    JSON_EXT    = /\.json$/,
    // is this module being run as a script?
    executable  = process.argv[1] && process.argv[1].indexOf(__filename) >= 0,
    StringUtils = require('./stringUtils'),
    // Usage: routeParser.js -R    (--routes is an accepted alias)
    //   -R, --routes   show routes
    argv        = { R : showRoutesRequested(process.argv.slice(2)) };

/**
 * True when the route-map switch is present on the command line.
 *
 * A presence test and nothing more: the switch is on when an argument is exactly
 * `-R` or `--routes`, or begins `-R=` or `--routes=`, and the value after the `=`
 * is not inspected. There is intentionally no negative form, so `--routes=false`
 * also turns the table on. Direct execution then forces it on regardless, via the
 * `argv.R || executable` assignment below, which is what emits the route map when
 * this file is run with no argument at all.
 *
 * Three invocation forms therefore emit the same table: no argument, `-R`, and
 * the `--routes` alias. Because `config/app.config` parses the routes during
 * configuration load, any process that loads config reads this flag, so
 * `node app.js -R` prints the table too.
 */
function showRoutesRequested(args) {
  var FLAG = /^(?:-R|--routes)(?:=|$)/;

  return args.some(function(arg) {
    return FLAG.test(arg);
  });
}

// turn on the route-map flag if you are directly calling this file
argv.R = argv.R || executable;

function isMobile(req) {
  var Android, Mobile, iDevice, ua;
  try{
    ua      = req.headers['user-agent'].toLowerCase();
    iDevice = ua.match(/iphone|ip[ao]d|crios/i);
    Android = ua.match(/Android/i);
    Mobile  = ua.match(/Mobile/i);
  }catch(err){}

  return (iDevice || (Android && Mobile)) ? true : false;
}

// Turn off Ace for certiain browsers/OSs
function aceOff (req) {
  var ua, epiphany, iceweasel, midori;
  try{
    ua         = req.headers['user-agent'].toLowerCase();
    epiphany  = /epiphany/i.test(ua);
    iceweasel = /iceweasel/i.test(ua);
    midori    = /midori/i.test(ua);
  }catch(err){}

  return epiphany || iceweasel || midori;
}

function buildViewString(config) {
  if (config.html) {
    return config.html;
  }

  if (config.redirect) {
    return '-> ' + config.redirect;
  }

  return '';
}

/**
 * Convert Hapi 4.x string pre-handlers to Hapi 20+ format
 * Old format: 'methodName(arg1,arg2)' or { method: 'methodName(arg1,arg2)', assign: 'result' }
 * New format: { method: async (request, h) => server.methods.methodName(...), assign: 'result' }
 */
function convertPreHandlers(pre, server) {
  if (!pre || !Array.isArray(pre)) return pre;

  return pre.map(function(preHandler) {
    var methodString, assign;

    // Handle object format: { method: 'isAdmin(user)', assign: 'admin' }
    // or { method: function(request, h), assign: 'name' }
    if (typeof preHandler === 'object' && preHandler.method) {
      if (typeof preHandler.method === 'function') {
        // A function-valued method is already a hapi lifecycle method: it takes
        // (request, h) and returns its value, returns a promise of one, or throws.
        // Hand it to hapi as it is. The object is rebuilt rather than forwarded so
        // that only `method` and `assign` reach hapi, and no other key the
        // declaration happens to carry.
        return { method: preHandler.method, assign: preHandler.assign };
      }
      methodString = preHandler.method;
      assign = preHandler.assign;
    }
    // Handle string format: 'isAdmin(user)'
    else if (typeof preHandler === 'string') {
      methodString = preHandler;
      // Extract assign name from method name (e.g., 'isAdmin' from 'isAdmin(user)')
      var match = methodString.match(/^(\w+)/);
      assign = match ? match[1] : undefined;
    }
    else if (typeof preHandler === 'function') {
      // A bare function is likewise already a lifecycle method, so it passes
      // straight through. This form carries no `assign` key, because the
      // declaration supplied no name to assign the value to.
      return { method: preHandler };
    }
    else {
      return preHandler;
    }

    // Parse method string: 'methodName(arg1, arg2)'
    var parsed = methodString.match(/^(\w+)\(([^)]*)\)$/);
    if (!parsed) {
      log.warn('Unable to parse pre-handler string:', methodString);
      return preHandler;
    }

    var methodName = parsed[1];
    var argStrings = parsed[2] ? parsed[2].split(/\s*,\s*/) : [];

    // Create wrapper function that resolves arguments from request
    var method = async function(request, h) {
      var server = request.server;
      var serverMethod = server.methods[methodName];

      if (!serverMethod) {
        log.error('Pre-handler method not found:', methodName);
        // Marked because the line above is this edge's log record; Layer 3 in
        // app.js logs only an unmarked 500, so this stays exactly one line.
        throw markLogged(Boom.internal('Pre-handler method not found: ' + methodName));
      }

      // Resolve arguments from request context
      var args = argStrings.map(function(argStr) {
        argStr = argStr.trim();

        if (argStr === '') return undefined;

        // Handle dot notation: user, params.courseId, query.with, pre.course, etc.
        var parts = argStr.split('.');
        var obj = request;

        // Special case: 'user' without prefix means request.user
        if (parts.length === 1 && parts[0] === 'user') {
          return request.user;
        }

        for (var i = 0; i < parts.length; i++) {
          if (obj === undefined || obj === null) return undefined;
          obj = obj[parts[i]];
        }

        return obj;
      });

      // Call the server method with resolved arguments
      return serverMethod.apply(null, args);
    };

    var result = { method: method };
    if (assign) {
      result.assign = assign;
    }

    return result;
  });
}

// What replaces a credential in a log line, and the shortest value worth
// scrubbing out of a message. The floor is 3 because that is the shortest
// password the route DSL accepts (`Joi.string().min(3)`
// [config/routes.js:87], [config/api_routes.js:1122]); scrubbing shorter
// strings than that would start mangling unrelated words in a message for no
// gain, since no declared secret can be shorter.
var LOG_REDACTED       = '[redacted]';
var LOG_SCRUB_MIN_CHARS = 3;

/**
 * True when a payload key's VALUE must never reach a log line.
 *
 * Matched on the key name rather than against a fixed list of routes, because a
 * route can carry a secret it never declares: `POST /save-pass` validates only
 * `password` and `password_verify` [config/routes.js:297-302] yet its payload
 * also carries the password-reset `token`, which is an account-takeover
 * credential for anyone who can read the log. The names this catches were taken
 * from the keys the DSL actually declares -- `password` [config/routes.js:60,87,
 * 300,332], [config/api_routes.js:1109,1122], `password_verify`
 * [config/routes.js:301], `token` [config/api_routes.js:843], `secret`
 * [config/api_routes.js:1307] and the activation `key` [config/routes.js:315]
 * -- generalised only as far as the same word in another shape.
 *
 * The name is normalised by dropping every non-alphanumeric character, so
 * `password_confirm`, `passwordConfirm` and `PASSWORD-CONFIRM` all match. The
 * substring tests are deliberately narrow: `key` and `authorization` are
 * matched only as whole names, because `keyPattern` on a Mongo duplicate-key
 * error and an `author` field on a course carry nothing secret and redacting
 * them would cost diagnostic value for no security gain.
 *
 * @param {*} key A property name.
 * @returns {boolean} true when the value behind it is a credential.
 */
function isSensitiveLogKey(key) {
  var raw  = String(key).toLowerCase(),
      name = raw.replace(/[^a-z0-9]/g, '');

  if (name.indexOf('password')   >= 0
   || name.indexOf('passwd')     >= 0
   || name.indexOf('token')      >= 0
   || name.indexOf('secret')     >= 0
   || name.indexOf('credential') >= 0
   || name.indexOf('apikey')     >= 0) {
    return true;
  }

  // `key`, `pass` and `authorization` are matched as whole SEGMENTS rather than
  // as substrings, so a name that merely contains them is not caught. Splitting
  // on the separators only -- never on a camelCase boundary -- is what keeps the
  // two sides of that line apart: `api-key`, `api_key` and `reset key` split
  // into segments and match, while `keyPattern` on a Mongo duplicate-key error
  // and an `author` field on a course have no separator, stay one segment, and
  // do not. Redacting those two would cost diagnostic value for no security
  // gain, which is why the distinction is drawn here rather than by widening the
  // substring test above.
  var segments = raw.split(/[^a-z0-9]+/);
  for (var i = 0; i < segments.length; i++) {
    if (segments[i] === 'key' || segments[i] === 'pass' || segments[i] === 'authorization') {
      return true;
    }
  }

  return false;
}

/**
 * A log-only copy of a value with every credential value replaced.
 *
 * Scoped to the log line and to nothing else. The caller inspects the RETURNED
 * copy while the original object continues on to the flash and the response
 * body untouched, which is what keeps the compared response shape identical:
 * AAP 0.6.3 and the joi parity matrix in 0.6.2 both treat that body as a
 * contract, and QA finding obs-credentials-echoed-to-client-json-mode is
 * recorded rather than repaired for exactly that reason. Only the log changes.
 *
 * Three details are deliberate. The copy is created from the SAME prototype as
 * its source, so a hapi payload -- which is a null-prototype object -- still
 * inspects as `[Object: null prototype] { ... }` and the log line keeps its
 * shape. An `Error` is returned as it is, never copied, so `util.inspect` still
 * prints its stack; an Error carries no payload keys. Anything that is neither
 * a plain object nor an array is likewise returned as it is, because rebuilding
 * a Date, a Buffer or a Mongoose document from its own prototype would change
 * what the line says about it, and no such value is payload-shaped.
 *
 * @param {*} value The value the caller is about to inspect into a log.
 * @returns {{value: *, secrets: Array.<string>}} the copy to inspect, and the
 *   literal secret strings it removed, for scrubbing out of the accompanying
 *   message.
 */
function redactForLog(value) {
  var secrets = [],
      seen    = [];

  function isCopyable(node) {
    if (Array.isArray(node)) {
      return true;
    }

    var proto = Object.getPrototypeOf(node);
    return proto === null || proto === Object.prototype;
  }

  function walk(node, depth) {
    if (node === null || typeof node !== 'object' || node instanceof Error) {
      return node;
    }

    // A payload is flat and a flash entry is shallow; the cap is a guard
    // against a pathological structure rather than a limit real input reaches.
    if (depth > 4 || !isCopyable(node) || seen.indexOf(node) >= 0) {
      return node;
    }

    seen.push(node);

    var copy = Array.isArray(node)
      ? []
      : Object.create(Object.getPrototypeOf(node));

    Object.keys(node).forEach(function(key) {
      if (isSensitiveLogKey(key)) {
        if (typeof node[key] === 'string' && node[key].length >= LOG_SCRUB_MIN_CHARS) {
          secrets.push(node[key]);
        }

        copy[key] = LOG_REDACTED;
        return;
      }

      copy[key] = walk(node[key], depth + 1);
    });

    return copy;
  }

  return { value : walk(value, 0), secrets : secrets };
}

/**
 * Removes literal secret values from an already-rendered message.
 *
 * Redacting the payload copy is not sufficient on its own, because the message
 * that accompanies it can quote the value back: `password` is declared with a
 * `.regex(...)` [config/routes.js:87], [config/api_routes.js:1122], and joi's
 * regex failure reads `"password" with value "<the password>" fails to match
 * the required pattern`, so the credential arrives a second time inside the
 * validation text. This removes those occurrences from the text as well.
 *
 * Substring replacement rather than a constructed pattern: a password is
 * arbitrary user input, so building a regex out of it would either need
 * escaping or become an injection of the user's own metacharacters.
 *
 * @param {*} text The message about to be logged.
 * @param {Array.<string>} secrets The values redactForLog removed.
 * @returns {string} the message with those values replaced.
 */
function scrubSecretValues(text, secrets) {
  var scrubbed = String(text);

  for (var i = 0; i < secrets.length; i++) {
    scrubbed = scrubbed.split(secrets[i]).join(LOG_REDACTED);
    // The same value as `util.inspect` and `JSON.stringify` would render it.
    // A caller that hands this function an ALREADY-serialized string has had
    // its backslashes, quotes and control characters escaped, so the raw value
    // above no longer occurs in it: a password containing a backslash or a CRLF
    // survives a raw-only scrub. Callers should redact before serializing --
    // redactValidationMessages below does -- and this is the backstop for the
    // ones that cannot.
    var escaped = JSON.stringify(secrets[i]);
    escaped = escaped.substring(1, escaped.length - 1);
    if (escaped !== secrets[i]) {
      scrubbed = scrubbed.split(escaped).join(LOG_REDACTED);
    }
  }

  return scrubbed;
}

/**
 * A log-only copy of the validation messages with credential values removed.
 *
 * Redacting BEFORE serialization rather than after, which is the difference
 * between a scrub that holds for arbitrary input and one that holds only for
 * ordinary input. `util.inspect` escapes what it renders and truncates what is
 * long, so a value that survives into a rendered string can no longer be found
 * by its own literal text: a password containing a backslash or a CRLF comes
 * out escaped, and a 50 KB password comes out as a prefix of itself. Both were
 * measured leaking through the post-serialization scrub. Here the value is
 * replaced while the message is still a plain string, so nothing is left for
 * the escaping or the truncation to act on.
 *
 * The copy matters as much as the redaction. `request.yar.flash('validation',
 * validationErrors, true)` has already been handed the ORIGINAL object, and
 * that flash is read back into the rendered page and into the JSON body, which
 * AAP 0.6.3 and the joi parity matrix in 0.6.2 both treat as a frozen contract.
 * Mutating the messages in place would change those bodies. This returns a new
 * object and leaves the original untouched.
 *
 * @param {Object} errors The field-path-keyed message map runValidation built.
 * @param {*} payload The submitted payload the messages may quote.
 * @returns {Object} a copy safe to serialize into a log line.
 */
function redactValidationMessages(errors, payload) {
  var secrets = redactForLog(payload).secrets,
      copy    = {};

  Object.keys(errors).forEach(function(field) {
    copy[field] = (typeof errors[field] === 'string' && secrets.length)
      ? scrubSecretValues(errors[field], secrets)
      : errors[field];
  });

  return copy;
}

/**
 * The submitted identifier values that must not reach a log line.
 *
 * Distinct from `isSensitiveLogKey`, which redacts a credential wherever it
 * appears as a value. An identifier is not a credential and its own key is left
 * readable, but it must not be carried into a MESSAGE: `users.login` builds
 * `request.fail({message: 'Unknown user ' + requested})`, so an unauthenticated
 * probe wrote the submitted email address into the default info log, on the
 * login path, in one line that no `LOGIN:` redaction touches (QA finding
 * db-login-logs-email-pii, whose named console lines were the other half).
 *
 * The response body that carries the same string is deliberately NOT changed --
 * it is the preserved Layer 2 body contract - so this is scoped, like every
 * other redaction here, to the log line.
 *
 * @param {Object} request The hapi request.
 * @returns {Array.<string>} identifier values to remove from the log text.
 */
function collectIdentifierValues(request) {
  var values  = [],
      sources = [request && request.payload, request && request.query];

  sources.forEach(function(source) {
    if (!source || typeof source !== 'object') {
      return;
    }

    ['email', 'username', 'login'].forEach(function(field) {
      var value = source[field];
      if (typeof value === 'string' && value.length >= LOG_SCRUB_MIN_CHARS) {
        values.push(value);
      }
    });
  });

  return values;
}

/**
 * Marks a Boom whose error has already been written to the log.
 *
 * The Layer 3 extension in app.js logs a 500 that reaches it unmarked, which is
 * what gives a pre-handler throw the diagnostic record it never had (QA finding
 * obs-prehandler-500-logs-nothing). The three sites in this file that already
 * log before returning or throwing their Boom mark it here, so an edge that was
 * logged once is not logged twice and the existing lines stay exactly as they
 * are.
 *
 * The flag is non-enumerable so it cannot be serialised into a response body,
 * and it is set on the Boom rather than tracked on the request because the Boom
 * is what Layer 3 is handed.
 *
 * @param {Error} err The Boom about to be returned or thrown.
 * @returns {Error} the same Boom.
 */
function markLogged(err) {
  if (err && typeof err === 'object') {
    try {
      Object.defineProperty(err, 'trinketLogged', {
        value        : true,
        enumerable   : false,
        configurable : true,
        writable     : true
      });
    }
    catch (defineErr) {
      // A frozen or sealed error cannot carry the flag. Layer 3 then logs the
      // 500 a second time, which is noisier than intended but never wrong, so
      // this must not become the reason a response is not produced.
      err.trinketLogged = true;
    }
  }

  return err;
}

/**
 * Installs request.success() and request.fail() on a request.
 *
 * These two are the route's own response projections and controllers call them
 * by name, so they have to be present before anything that might respond runs.
 * They were closures inside the route handler and are lifted out here so that
 * the handler body reads as the lifecycle method it now is; every branch, every
 * branch order and every projection is the one the closures had.
 *
 * Both build their response through the toolkit and RETURN it, which is all a
 * hapi lifecycle method may do (AAP rule T-1); nothing is signalled out of band.
 * That is the only respect in which either differs from its 2f8712a form: the
 * deferred-promise resolver the removed compatibility layer called on the way
 * out is gone, because the value is now returned to hapi instead.
 *
 * @param {Object} request The hapi request.
 * @param {Object} h The toolkit to build responses from, passed through from the
 *   handler hapi invoked.
 * @param {{success: Object, fail: Object, replySpec: *, responseType: string}}
 *   ctx The parse-time route specification plus the negotiated response type.
 *   `success`, `fail` and `replySpec` are the same long-lived objects the route
 *   declaration produced -- see the note on the in-place `fail.redirect`
 *   assignment below.
 * @returns {undefined}
 */
function installResponders(request, h, ctx) {
  var success      = ctx.success,
      fail         = ctx.fail,
      replySpec    = ctx.replySpec,
      responseType = ctx.responseType;

  request.success = function(json) {
    var response;
    // Allow controller to override the default redirect via json.redirectTo
    var redirectUrl = (json && json.redirectTo) || success.redirect;
    if (redirectUrl) {
      response = redirect(request, h, redirectUrl, json);
      return response;
    }

    json = replySpec
      ? ObjectUtils.pull(replySpec, json || {})
      : ObjectUtils.serialize(json || {});

    json.flash   = request.yar.flash();
    json.context = request.yar.get('context');

    // Remove IP and referrer from the lastView section
    if (Array.isArray(json.data)) {
      for (var i = 0; i < json.data.length; i++) {
        if (json.data[i].lastView) {
          json.data[i].lastView = {
            viewedOn: json.data[i].lastView.viewedOn,
            viewType: json.data[i].lastView.viewType
          };
        }
      }
    } else if (json.data && json.data.lastView) {
      json.data.lastView = {
        viewedOn: json.data.lastView.viewedOn,
        viewType: json.data.lastView.viewType
      };
    }

    if (responseType === 'html' && success.html && !JSON_EXT.test(request.url.pathname)) {
      addUserContext(json, request);

      if (typeof(success.html) === 'string') {
        var template = success.html === 'embed/{lang}.html' && json.trinket && json.trinket.template
          ? json.trinket.template
          : success.html;

        json.isMobile = isMobile(request);
        json.aceOff = aceOff(request);

        template = StringUtils.interpolate(template, json);
        response = h.view(template, json);
        return response;
      }
      else if (success.html.redirect) {
        response = redirect(request, h, success.html.redirect, json);
        return response;
      }
      else {
        log.error('unexpected response format', success, json);
        // Marked: the line above is this edge's record, so Layer 3 does not add
        // a second one.
        response = markLogged(Boom.internal('Unexpected response format'));
        return response;
      }
    }
    else {
      response = h.response(json);
      return response;
    }
  };

  request.fail = function(json, err) {
    var response;
    if (json) {
      // The line, its level and its shape are unchanged; the credential values
      // inside it are not written. This is reached for every validation
      // failure -- the handler calls request.fail(request.payload,
      // util.inspect(validationErrors)) -- so before this redaction one
      // unauthenticated POST /users, POST /save-pass or POST /activate-account
      // wrote the submitted password, and on /save-pass the password-reset
      // token, verbatim to stdout and to the winston debug transport at level
      // `info`, which is the shipped default (QA finding
      // obs-passwords-and-reset-tokens-logged-at-info, HIGH, CWE-532). Both
      // arguments are treated: the payload copy has its credential values
      // replaced, and the message is scrubbed of those same values because
      // joi's regex failure quotes the rejected password back inside it.
      //
      // The redaction is scoped to this line. `json` itself is untouched, so
      // the flash it is written to and the body the client receives are exactly
      // what they were -- the parity contract AAP 0.6.3 protects, and the
      // reason the client-side echo is recorded in
      // docs/error-edge-inventory.md rather than repaired here.
      // Credential values come from the payload's own keys; identifier values
      // are added because a caller can build them into a message rather than
      // pass them as a key -- see collectIdentifierValues.
      var redacted = redactForLog(json);
      var scrub    = redacted.secrets.concat(collectIdentifierValues(request));

      log.info(scrubSecretValues(util.inspect(redacted.value), scrub)
        + " " + scrubSecretValues(err, scrub));
    }

    if (responseType === 'html' && fail.redirect) {
      if (json) {
        request.yar.flash('failure',  json, true);
        // PRESERVED CROSS-REQUEST QUIRK. `fail` is the parse-time object,
        // captured once per route and held by reference, so interpolating back
        // onto it means the first validation failure consumes the template for
        // the life of the process: a second POST /users carrying formName=login
        // still redirects to /signup. AAP 0.6.6 states the target disposition
        // as "keep the in-place assignment", and test/parity/corpus.json
        // scenario quirk.fail-redirect-leak.post-users drives two consecutive
        // requests and compares their two Location values TO EACH OTHER
        // precisely so that a build which quietly made this request-local is
        // detected.
        fail.redirect = StringUtils.interpolate(fail.redirect, json);
      }
      request.yar.flash('payload', request.payload, true);
      request.yar.flash('query',   request.query,   true);
      response = redirect(request, h, fail.redirect, json);
      return response;
    }

    json       = json || {};
    json.flash = request.yar.flash();

    if (responseType === 'html' && fail.html && !JSON_EXT.test(request.url.pathname)) {
      addUserContext(json, request);
      response = h.view(fail.html, json);
      return response;
    }
    // APPROVED DEVIATION. An `Error` first argument is routed as a Boom instead
    // of being handed to h.response, because h.response REFUSES an Error --
    // `Hoek.assert(result instanceof Error === false, 'Cannot wrap an error')`
    // [node_modules/@hapi/hapi/lib/toolkit.js:191] -- and every caller that
    // passes one does so from inside a database, storage or parser callback,
    // off the handler's own stack, where no lifecycle catch stands between the
    // assert and the process. The measured consequence was total process death:
    // one POST /admin/upload carrying a malformed CSV, or one payload-less POST
    // /api/admin/user/{userId} from an admin, took the whole site down for every
    // user (QA findings ux-F42 CRITICAL, obs-requestfail-error-arg-process-kill
    // and perf-malformed-csv-kills-process HIGH).
    //
    // The precedence argument is the one AAP 0.7 states and this delivery has
    // already applied three times -- docs/preserved-quirks.md 10.7, 11.1 and
    // 11.4: R-b is unqualified, the application must genuinely run with no
    // route excluded, and the absence of a response is not a behaviour a client
    // can depend on. A process death is that argument at its strongest, because
    // what the crash destroys is not this edge's behaviour but every other
    // route's, so R-d's protection does not reach it. docs/preserved-quirks.md
    // 10.11 carries the full record, the measurement and the replay
    // consequence.
    //
    // The guard sits HERE and nowhere earlier, which is what keeps the two
    // branches above byte-identical: an `html` route with a `fail.redirect`
    // flashes and redirects with an Error argument today and still does, and an
    // `html` route with a `fail.html` renders that view with the Error as its
    // context and still does. Only the h.response branch, the one that asserts,
    // is changed. Measured at ONE error edge through BOTH arms, which is the
    // form of the check that can actually detect a mistake here: a POST /login
    // with no password makes bcrypt throw `data and hash arguments required`,
    // which reaches request.fail as an Error at
    // [T lib/controllers/users.js:328]. Negotiated as html, where that route
    // declares `fail: {redirect: '/login'}`, it answered 302 to /login exactly
    // as before; the identical fault negotiated as JSON on POST
    // /api/users/login reached this branch and answered 500 where it had
    // severed the connection and exited. Boom.boomify returns an existing Boom untouched, so a caller
    // that passes Boom.notFound() still answers 404, and initializes any other
    // Error at 500 -- the same status and the same generic payload the Layer 1
    // catch-all produces for a thrown error, which is where these callbacks
    // would have landed had they thrown on the handler's own stack.
    else if (json instanceof Error) {
      response = Boom.boomify(json);
      return response;
    }
    else {
      response = h.response(json);
      return response;
    }
  };
}

/**
 * Runs a route's declared validation against the request.
 *
 * The route DSL's `config.validate` block is stripped off the route object
 * before hapi ever sees it [see parseRoutes], so this is the only thing that
 * enforces it. Lifted out of the route handler unchanged -- same iteration
 * order, same Joi call, same per-field message lookup -- so that the handler
 * body reads as the lifecycle method it now is without any accept/reject
 * outcome moving. Its one caller is that handler.
 *
 * Each key of the block names a section of the request to validate -- `payload`,
 * `query`, `params` and, because the lookup is a plain property read, any other
 * request property a declaration names. A section given as a plain object is
 * wrapped with Joi.object(), which is what makes an undeclared key a failure.
 *
 * @param {Object} validation The declared block, with `language` already
 *   removed by parseRoutes.
 * @param {Object} language The per-field message map lifted off that block.
 * @param {Object} request The hapi request.
 * @returns {(Object|undefined)} A field-path-keyed map of messages, or
 *   `undefined` when every section validated.
 */
function runValidation(validation, language, request) {
  var validationErrors;

  for (var key in validation) {
    var schema = validation[key];
    // Joi 17+: schema.validate() instead of Joi.validate()
    // If schema is a plain object (not a Joi schema), wrap it with Joi.object()
    if (!Joi.isSchema(schema)) {
      schema = Joi.object(schema);
    }
    var result = schema.validate(request[key], { abortEarly: false });
    if (result.error) {
      validationErrors = validationErrors || {};
      result.error.details.forEach(function(err) {
        var fieldPath = err.path.join('.');
        var msg = _.find(language[fieldPath], function(custom, match) {
          return !!err.message.match(new RegExp(match));
        });
        validationErrors[fieldPath] = msg || err.message;
      });
    }
  }

  return validationErrors;
}

function parseRoutes(routeConfigs) {
  var rows    = [],
      sizes   = {},
      routes  = [];

  addStaticPages(routes);

  routeConfigs.forEach(function(route, index) {
    // temporary way to enable routes with option in config/routes (during "alpha")
    // could be used later as a way to disable routes/features until ready
    if (config.isProd && typeof(route.enable) !== 'undefined' && !route.enable) return;
    delete route.enable;

    var routeInfo    = route.route.split(/\s+/),
        ctrlPath     = (routeInfo[2] || '').split('.'),
        controller   = ctrlPath[0],
        handlerName  = ctrlPath[1],
        validation   = route.config && route.config.validate,
        language     = (validation && validation.language) || {},
        extensions   = route.ext     || false,
        success      = route.success || {},
        replySpec    = route.reply,
        fail         = route.fail    || {},
        cookie       = false,
        handler;

    if (controller) {
      handler = require('../controllers/' + controller)[handlerName];
    }

    if (validation) {
      delete(validation.language);
    }

    delete(route.route);
    delete(route.success);
    delete(route.fail);
    delete(route.ext);
    delete(route.reply);

    // Hapi 20+ uses 'options' instead of 'config'
    if (route.config) {
      route.options = route.config;
      delete route.config;
    }
    if (route.options) {
      delete(route.options.validate);

      // set cors to true only for routes that should allow it
      if (!route.options.cors) {
        route.options.cors = false;
      }
    }

    if (route.html) {
      success.html = route.html;
      delete(route.html);
    }
    if (route.redirect) {
      success.redirect = route.redirect;
      delete(route.redirect);
    }
    if (route.cookie) {
      cookie = true;
      delete(route.cookie);
    }

    route.method  = routeInfo[0];
    route.path    = routeInfo[1];

    // Hapi 20+ handler signature: async (request, h)
    route.handler = async function(request, h) {
      console.log('ROUTE: Handler start', request.method, request.path);
      var label = request.yar.id + request.url.pathname.replace(/\//g, '-')
        , times = {};

      if (request.user) {
        label += '-' + request.user.id;
      }

      if (config.app.log.debug && config.app.log.debug.routehandlertiming) {
        times = {};
        times[label] = Date.now();
      }

      var loginAs      = request.yar.get('loginAs') || undefined
        , responseType = accepts(request).types(['html', 'json'])
        , validationErrors
        , validationError
        , userPromise, userId;

      if (loginAs && request.user && request.user.hasRole && request.user.hasRole("admin")) {
        userPromise = User.findById(loginAs);
      }
      else {
        userPromise = Promise.resolve();
      }

      try {
        var user = await userPromise;

        // admin logged in as another user
        if (user) {
          userId                   = request.user.id;
          request.user             = user;
          request.user._realUserId = userId;
        }

        if (cookie) {
          request.cookie = true;
        }

        // request.success() and request.fail(): the route's own response
        // projections, called by controllers. Both are built by
        // installResponders; passing the handler's own `h` here is what gives
        // controllers the toolkit they have always had.
        installResponders(request, h, {
          success      : success,
          fail         : fail,
          replySpec    : replySpec,
          responseType : responseType
        });

        // Joi 17+ validation.
        //
        // It runs HERE, in the handler, and nowhere earlier. Hapi executes
        // prerequisites before the handler and pre-handlers mutate the payload
        // this block validates: POST /users declares
        // `pre: [{method: helpers.lowerUserFields}]` and validates `username`
        // with `.invalid(...reservedUsernames)`, so `username=Admin` is
        // rejected only because lowerUserFields has already lowercased it.
        // Validating at an earlier stage would change that accept/reject
        // outcome, which AAP rule R-d forbids.
        if (validation) {
          validationErrors = runValidation(validation, language, request);

          if (validationErrors) {
            // The flash is handed the ORIGINAL messages, so the rendered page
            // and the JSON body are byte-identical to what they were; only the
            // string that goes on to be logged is redacted, and it is built
            // from a copy. Redacting here rather than inside request.fail is
            // what makes the redaction hold for arbitrary input: joi quotes a
            // rejected value back inside its message, and once util.inspect has
            // escaped and possibly truncated that message the value can no
            // longer be found by its own text. See redactValidationMessages.
            request.yar.flash('validation', validationErrors, true);
            return request.fail(
              request.payload,
              util.inspect(redactValidationMessages(validationErrors, request.payload))
            );
          }
        }

        if (handler) {
          console.log('ROUTE: Calling handler for', request.method, request.path);
          var handlerTimer = setTimeout(function() {
            log.info(this.toString(), 'still going after 1s');
          }.bind(label), 1000);

          // The second argument is the real toolkit. Every routed handler is a hapi
          // lifecycle method that builds its response off it (h.response/h.view/
          // h.redirect) and returns the result; `this` is hapi's own binding and is
          // passed through unchanged.
          var result = await handler.call(this, request, h);
          console.log('ROUTE: Handler returned', typeof result);

          if (handlerTimer) {
            clearTimeout(handlerTimer);
          }

          if (label && times[label]) {
            var endTime = Date.now() - times[label];

            // 10ms
            if (endTime > 10) {
              log.info(label + ': ' + endTime + 'ms');
            }

            delete times[label];
          }

          return result;
        }
        // Some declared routes intentionally have no controller export, and
        // their params are returned through the standard success projection.
        // Three registered routes answer only this way: POST /api/interest
        // names pages.interest, GET /api/trinkets/popular names
        // trinket.mostActive and GET /api/trinkets/active names
        // trinket.risingActive, and none of those three functions exists. The
        // AAP warns against removing this branch by association with the
        // response emulation that used to sit beside it.
        else {
          return request.success(request.params);
        }
      }
      catch(err) {
        if (err) {
          if (err.stack) {
            log.error(err.stack);
          }
          else {
            log.error(String(err));
          }

          // Marked because one of the two lines above has already recorded this
          // error. Layer 3 in app.js logs a 500 that arrives unmarked -- which
          // is how a pre-handler throw, never seen by this catch, gets the
          // record QA finding obs-prehandler-500-logs-nothing found missing --
          // so marking here keeps a handler throw at exactly the one line it
          // has always produced.
          return markLogged(Boom.badImplementation(err.message || String(err)));
        }
      }
    } // end handler

    // Convert pre-handlers to Hapi 20+ format
    if (route.options && route.options.pre) {
      route.options.pre = convertPreHandlers(route.options.pre);
    }

    routes.push(route);
    if (extensions) {
      var copy = {};
      for(var key in route) {
        copy[key] = route[key];
      }
      copy.path += '.json';
      routes.push(copy);
    }

    if (argv.R) {
      var controllerStr = controller + '.' + handlerName,
          successStr    = buildViewString(success),
          failStr       = buildViewString(fail);

      sizes.path       = Math.max(route.path.length, sizes.path || 4);
      sizes.controller = Math.max(controllerStr.length, sizes.controller || 10);
      sizes.success    = Math.max(successStr.length, sizes.success || 4);
      sizes.fail       = Math.max(successStr.length, sizes.fail || 4);

      rows.push([route.method, route.path, controllerStr, successStr, failStr]);
    }
  });

  addStaticRoutes(routes);

  // if requested, spit out the routing table
  if (argv.R) {
    rows = rows.sort(function(a,b) {
      if (a[2] < b[2]) return -1;
      if (a[2] > b[2]) return 1;
      if (a[1] < b[1]) return -1;
      if (a[1] > b[1]) return 1;
      return 0;
    });

    mod_tab.emitTable({
      columns : [
        { label : 'METHOD', width: 8 },
        { label : 'PATH', width: sizes.path + 4 },
        { label : 'CONTROLLER', width: sizes.controller + 4 },
        { label : 'SUCCESS', width: sizes.success + 4 },
        { label : 'FAIL', width: sizes.fail + 4 }
      ],
      rows: rows
    });
  }

  return routes;
}

// Static routes using @hapi/inert
function addStaticRoutes(routes) {
  // Handle cache-prefix URLs (strips cache-prefix-{timestamp} from path)
  routes.push({
    method: 'GET',
    path: '/' + config.app.cachePrefix + '{timestamp}/{assetType}/{path*}',
    handler: {
      directory: {
        path: function(request) {
          return './public/' + request.params.assetType;
        },
        redirectToSlash: true
      }
    }
  });

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
  routes.push({
    method: 'GET',
    path: '/.well-known/{path*}',
    handler: function(request, h) {
      return h.response().code(404);
    }
  });

  // catch all static route
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

// Hapi 20+ redirect helper
function redirect(request, h, urlTemplate, json) {
  // for "simple" redirects where params are simply copied to a new location
  if (/{\w+}/.test(urlTemplate)) {
    json = _.extend(json, request.params);
  }

  var redirectURL = json ? StringUtils.interpolate(urlTemplate, json) : urlTemplate;

  if (/^\/\//.test(redirectURL)) {
    redirectURL = config.app.url.protocol + ':' + redirectURL;
  }
  else if (/^\//.test(redirectURL)) {
    redirectURL = config.url + redirectURL;
  }
  else if (!/^https?:\/\//.test(redirectURL)) {
    redirectURL = config.url + '/' + redirectURL;
  }

  return h.redirect(redirectURL);
}

function addUserContext(json, request) {
  if (request.user) {
    json.user = request.user;
    json.loggedInWith  = request.yar.get('loggedInWith') || 'trinket';
    json.userAvatarSrc = request.user.normalizeAvatar();
  }

  // Add email configuration status for frontend feature visibility
  // Check if email is properly configured (need either AWS SES or Mailgun credentials)
  var hasAWS = config.aws && config.aws.mail && config.aws.mail.keyId && config.aws.mail.key;
  var hasMailgun = config.app.mail && config.app.mail.key && config.app.mail.domain;
  var hasFrom = config.app.mail && config.app.mail.from;
  json.emailEnabled = hasFrom && (hasAWS || hasMailgun);

  return;
}

function addStaticPages(routes) {
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
          cors : false,
          handler: async function(request, h) {
            var context = { footer : true };
            addUserContext(context, request);
            return h.view(config.app.staticPages + '/' + file, context);
          }
        }
      };
      routes.push(route);
    });

}

// if this module is being run as a script then
// go ahead and call the parseRoutes method
if (executable) {
  parseRoutes(require('../../config/routes'));
}

module.exports = {
  parse : parseRoutes
};
