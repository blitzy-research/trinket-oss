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

// Field names whose values must never reach a log sink or the session flash.
// Matched as a case-insensitive SUBSTRING of the key, which is what makes one
// expression cover `password`, `oldPassword`, `resetKey`, `access_token`,
// `g-recaptcha-response`, `accessCode` and the session and cookie fields at
// once.
//
// The vocabulary was chosen against the fields templates actually render, so
// redaction cannot blank a value a page displays. The only flash fields any
// template reads are flash.payload.{email,name,description,courseType,
// contentDefault}, flash.failure.message and flash.validation.* -- measured
// across lib/views/** and public/** -- and none of those six names matches any
// term here.
//
// `access[-_]?code` is spelled out rather than covered by a bare `code`, and
// the reason is diagnostics: `code` as a substring also names the `code`
// property Node puts on an Error (EADDRINUSE, ECONNREFUSED), the numeric code
// a driver reports, a trinket's `shortCode`, and the `code` field that carries
// a trinket's own source. Blanking those makes a log unreadable without
// protecting a credential, so the term is narrowed to the field the findings
// actually name: a course access code. What that leaves unredacted is recorded
// with the fix.
var SENSITIVE_KEY = /pass|secret|token|key|auth|credential|otp|pin|captcha|session|cookie|signature|salt|hash|access[-_]?code/i;

// How deep redactSensitive descends before it stops. A submitted payload is a
// few levels deep at most, so the bound costs nothing and stops a pathological
// or hostile structure from turning a log call into an unbounded walk.
var REDACT_MAX_DEPTH = 6;

// What replaces a structure the walk will not enter. Exhausting the depth bound
// or meeting a structure already on the current path FAILS CLOSED: the subtree
// is replaced rather than forwarded. Forwarding it was a hole, not a
// simplification - a password nested seven levels down was emitted verbatim,
// because the bound returned the whole enclosing object untouched and no key in
// it had been tested yet.
var REDACTED_DEPTH = '[redacted: nested beyond the redaction depth]';
var REDACTED_CYCLE = '[redacted: circular reference]';

/**
 * True when `value` is a structure redactSensitive may copy and descend into.
 *
 * Arrays qualify, and so do plain objects -- including the null-prototype ones
 * `querystring.parse` produces, which is the shape `request.payload` and
 * `request.query` take for every form-encoded submission
 * [node_modules/@hapi/subtext/lib/index.js:213-214]. Everything else does not:
 * a Buffer, a stream, a Mongoose document, a Date or any class instance has to
 * survive by reference so util.inspect sees what it would have seen.
 *
 * The prototype is read rather than `value.constructor`, because a form body
 * can carry a field literally named `constructor` and would then be
 * misclassified as an instance and skipped whole.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isRedactableStructure(value) {
  var proto;

  if (value === null || typeof value !== 'object') {
    return false;
  }

  if (Array.isArray(value)) {
    return true;
  }

  proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

/**
 * The recursive half of redactSensitive. Kept separate so the public entry
 * point can own the try/catch and the caller never has to pass bookkeeping.
 *
 * @param {*} value
 * @param {number} depth Levels already descended.
 * @param {Array} seen Structures on the current path, so a cycle terminates.
 * @returns {*} A redacted copy for a plain object or array, otherwise `value`.
 */
function redactValue(value, depth, seen) {
  var copy, keys, i, key;

  // A scalar is returned as it is: its own key was tested by the caller, which
  // is the only place a key exists to test.
  if (!isRedactableStructure(value)) {
    return value;
  }

  // A structure the walk will not enter is REPLACED, never forwarded, because
  // its contents have not been examined and may be anything.
  if (depth >= REDACT_MAX_DEPTH) {
    return REDACTED_DEPTH;
  }

  if (seen.indexOf(value) !== -1) {
    return REDACTED_CYCLE;
  }

  seen.push(value);

  if (Array.isArray(value)) {
    copy = [];
    for (i = 0; i < value.length; i++) {
      copy.push(redactValue(value[i], depth + 1, seen));
    }
  }
  else {
    copy = {};
    keys = Object.keys(value);
    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      copy[key] = SENSITIVE_KEY.test(key)
        ? '[redacted]'
        : redactValue(value[key], depth + 1, seen);
    }
  }

  seen.pop();

  return copy;
}

/**
 * A copy of `value` with every sensitive field replaced by '[redacted]'.
 *
 * Used on everything request.fail puts into the log and into the session flash.
 * A submitted payload routinely carries a password, a reset key, a course
 * access code or a reCAPTCHA response, and before this a validation failure put
 * all of them into a shared log sink and into the session (CWE-532/CWE-359).
 *
 * Usage:
 *   redactSensitive({ email: 'a@b.c', password: 'hunter2' })
 *     -> { email: 'a@b.c', password: '[redacted]' }
 *   redactSensitive(Buffer.from('...')) -> the same Buffer, by reference
 *
 * The copy is new, so nothing downstream of the caller observes a mutation --
 * which is what lets request.fail hand the ORIGINAL object to the redirect
 * interpolation and to the response body while logging and flashing the
 * redacted one.
 *
 * @param {*} value Any value; typically a payload, a query or an error object.
 * @returns {*} A redacted copy, `value` itself when it is not a plain structure,
 *   or the string '[unloggable]' if the walk fails.
 */
function redactSensitive(value) {
  try {
    return redactValue(value, 0, []);
  }
  catch (err) {
    // Redaction only ever runs on the way to a log or a flash, so a structure
    // that defeats the walk degrades to a marker instead of failing a request.
    return '[unloggable]';
  }
}

// The only keys whose VALUE may be written to a log by describeForLog. Every
// one names a diagnostic an error carries about itself; none of them can hold
// something a client submitted.
//
// This is an allowlist, and the distinction from SENSITIVE_KEY matters. A
// denylist of credential names cannot make a payload safe to log, because a
// submitted payload is also full of PII - an email address, a real name, a
// course description - and none of that belongs in a log sink either. So the
// log side does not serialize submitted values at all: it names the fields and
// keeps the values only for the keys below.
var LOGGABLE_VALUE_KEY = /^(?:message|error|errno|reason|status|statusCode|syscall|type|kind|event)$/;

/**
 * A description of `value` that names its fields without disclosing them.
 *
 * This is what request.fail writes to the log in place of the payload it used
 * to serialize with util.inspect. What survives is the shape - which fields
 * were submitted, and the diagnostics an error brought with it - which is what
 * makes a log line useful for locating a failure without making it a copy of
 * whatever the client sent.
 *
 * Usage:
 *   describeForLog({ email: 'a@b.c', password: 'hunter2' })
 *     -> '{email, password}'
 *   describeForLog({ message: 'Unknown user' })
 *     -> '{message=Unknown user}'
 *
 * @param {*} value Typically the payload or an error-shaped object.
 * @returns {string} A single-line description, never the submitted values.
 */
/**
 * The interpolation source for a `fail.redirect` template, with any value the
 * template substitutes constrained to a single path segment.
 *
 * WHY THIS EXISTS. The assignment in request.fail writes the interpolated
 * template back onto the parse-time object, so the first failing request
 * consumes it for the life of the process (AAP 0.6.6 freezes that). Whatever
 * the first request planted therefore becomes every later user's destination,
 * which makes the planted value the interesting part: `POST /users` declares
 * `fail.redirect` as `/{formName}` and takes `formName` straight from the
 * payload. Confinement at the redirect sink already stops it leaving this
 * origin; this stops it being an arbitrary path within it.
 *
 * WHY A SHAPE RATHER THAN AN ENUMERATION. Mapping each supported form name to a
 * fixed path would be tighter, and it is not available: the corpus scenario
 * that pins the frozen quirk posts `formName=signup` while the application's
 * own form posts `sign-up`, so an enumeration built from either one would
 * change the other's Location and break the gate. A single segment accepts both
 * and rejects everything structural.
 *
 * WHY IT CANNOT DRIFT. When no substituted value needs constraining - every
 * legitimate value, and every value any committed artifact records - this
 * returns the ORIGINAL object, so the interpolation that follows is given
 * exactly what it is given today. Only a value carrying path structure produces
 * a modified view, and only along the paths the template actually reads.
 *
 * @param {string} template The declared `fail.redirect` template.
 * @param {*} json The object request.fail was called with.
 * @returns {*} `json` itself, or a copy whose interpolated leaves are segments.
 */
function failRedirectSource(template, json) {
  var placeholders = String(template).match(/{([^{}]*)}/g);
  var view = json;
  var i, path, cursor, depth, raw, safe, level;

  if (!placeholders || json === null || typeof json !== 'object') {
    return json;
  }

  for (i = 0; i < placeholders.length; i++) {
    path   = placeholders[i].slice(1, -1).split('.');
    cursor = json;

    for (depth = 0; depth < path.length && cursor !== null && cursor !== undefined; depth++) {
      cursor = cursor[path[depth]];
    }

    // interpolate() substitutes only strings and numbers and leaves the
    // placeholder text in place for anything else, so nothing else can carry
    // path structure into the template.
    if (typeof cursor !== 'string' && typeof cursor !== 'number') {
      continue;
    }

    raw  = String(cursor);
    safe = raw.replace(PATH_SEGMENT_UNSAFE, '');

    if (safe === raw) {
      continue;
    }

    // Clone only along this path, so every other key - which the flash and the
    // response body read from the same object - is the identical reference.
    if (view === json) {
      view = shallowCopy(json);
    }

    level = view;

    for (depth = 0; depth < path.length - 1; depth++) {
      if (level[path[depth]] === null || typeof level[path[depth]] !== 'object') {
        break;
      }
      level[path[depth]] = shallowCopy(level[path[depth]]);
      level = level[path[depth]];
    }

    if (depth === path.length - 1) {
      level[path[depth]] = safe;
    }
  }

  return view;
}

/**
 * A one-level copy of a plain object or array, preserving every other value by
 * reference.
 *
 * @param {(Object|Array)} value
 * @returns {(Object|Array)}
 */
function shallowCopy(value) {
  var copy, keys, i;

  if (Array.isArray(value)) {
    return value.slice();
  }

  copy = {};
  keys = Object.keys(value);

  for (i = 0; i < keys.length; i++) {
    copy[keys[i]] = value[keys[i]];
  }

  return copy;
}

function describeForLog(value) {
  var described = [];
  var keys, i, key, field;

  try {
    if (value === null || value === undefined) {
      return String(value);
    }

    if (typeof value !== 'object') {
      // A scalar carries no field name to report, so only its type is safe to
      // state. A number or a boolean cannot be a credential and is kept.
      return typeof value === 'string' ? 'string' : String(value);
    }

    if (Array.isArray(value)) {
      return 'array[' + value.length + ']';
    }

    keys = Object.keys(value);

    for (i = 0; i < keys.length; i++) {
      key = keys[i];
      field = value[key];

      if (LOGGABLE_VALUE_KEY.test(key) && (field === null || typeof field !== 'object')) {
        described.push(key + '=' + String(field));
      }
      else {
        described.push(key);
      }
    }

    return '{' + described.join(', ') + '}';
  }
  catch (err) {
    // Describing a value must never be what fails a request.
    return '[undescribable]';
  }
}

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
        throw Boom.internal('Pre-handler method not found: ' + methodName);
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

/**
 * Installs request.success() and request.fail() on a request.
 *
 * These two are the route's own response projections and controllers call them
 * by name, so they have to be present before anything that might respond runs.
 * They were closures inside the route handler; they are built here instead so
 * that ONE implementation serves both the handler and the pre-handler
 * validation gate, which has to be able to produce the same response earlier in
 * the request cycle.
 *
 * Both build their response through the toolkit and RETURN it, which is all a
 * hapi lifecycle method may do (AAP rule T-1); nothing is signalled out of band.
 *
 * @param {Object} request The hapi request.
 * @param {Object} h The toolkit to build responses from. The handler passes its
 *   own; the validation gate passes the one it was given, which is why a
 *   response produced by the gate is a legal pre-handler return value.
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
        response = Boom.internal('Unexpected response format');
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
      // The payload's FIELD NAMES and the error's own message, never the
      // submitted values. A redacted serialization was not enough here: a
      // denylist of credential names still wrote every email address, real
      // name and course description into the log, and the findings name PII
      // alongside passwords and access codes. describeForLog keeps the shape
      // and an explicit allowlist of error diagnostics; `err` is the message
      // half, which is what the finding's "field names/messages" permits.
      log.info('request.fail ' + request.method + ' ' + request.url.pathname +
        ' ' + describeForLog(json) + " " + err);
    }

    if (responseType === 'html' && fail.redirect) {
      if (json) {
        request.yar.flash('failure',  redactSensitive(json), true);
        // PRESERVED CROSS-REQUEST QUIRK, and the ORIGINAL json rather than the
        // redacted copy because the interpolated value becomes the Location.
        //
        // `fail` is the parse-time object, captured once per route and held by
        // reference, so interpolating back onto it means the first validation
        // failure consumes the template for the life of the process: a second
        // POST /users carrying formName=login still redirects to /signup. AAP
        // 0.6.6 states the target disposition as "keep the in-place
        // assignment", and test/parity/corpus.json scenario
        // quirk.fail-redirect-leak.post-users drives two consecutive requests
        // and compares their two Location values TO EACH OTHER precisely so
        // that a build which quietly made this request-local is detected.
        //
        // The off-origin half of the same defect is closed, but at the sink
        // rather than here: the redirect() call below asks for same-origin
        // confinement, so an interpolated `//evil.com` can no longer leave the
        // application's own origin - and can no longer persist off-origin for
        // every later user of the route.
        //
        // failRedirectSource additionally holds whatever IS planted to a single
        // path segment, so it cannot be an arbitrary path within this origin
        // either. It returns the original object untouched unless a substituted
        // value carries path structure, so the interpolation below is given
        // exactly what it is given today for every legitimate value.
        fail.redirect = StringUtils.interpolate(fail.redirect, failRedirectSource(fail.redirect, json));
      }
      request.yar.flash('payload', redactSensitive(request.payload), true);
      request.yar.flash('query',   redactSensitive(request.query),   true);
      response = redirect(request, h, fail.redirect, json, { sameOriginOnly: true });
      return response;
    }

    json       = json || {};
    // The response BODY is not redacted. For a JSON request the validation call
    // site passes request.payload straight through, so the body echoes what was
    // submitted, password included. Six password-bearing corpus scenarios
    // compare that body (test/parity/corpus.json route.post.{users,login,
    // save-pass,activate-account,api-users,api-users-login}.json), and AAP rule
    // R-d freezes it. The disclosure is baseline behaviour to report, not to
    // change here; what this funnel no longer does is put it in a log or in the
    // session.
    json.flash = request.yar.flash();

    if (responseType === 'html' && fail.html && !JSON_EXT.test(request.url.pathname)) {
      addUserContext(json, request);
      response = h.view(fail.html, json);
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
 * enforces it. Extracted from the route handler unchanged so that the handler
 * and the pre-handler gate cannot drift apart in what they accept.
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

// The Joi schema types that can only ever hold a primitive. A leaf declared as
// one of these has no legitimate object or array submission, which is what
// makes an object arriving there recognisable as an operator-injection attempt
// rather than a type error to be reported in the ordinary way.
//
// Everything else -- 'any', 'object', 'array', 'alternatives', 'link' and any
// type added later -- is deliberately absent: config/routes.js:348,363 declare
// `upload: Joi.any()`, config/api_routes.js declares `code: Joi.object()`,
// `settings: Joi.object()` and `emailList: Joi.array()`, and corpus scenarios
// legitimately submit objects and arrays for exactly those leaves.
var PRIMITIVE_LEAF_TYPES = {
  string  : true,
  number  : true,
  boolean : true,
  date    : true,
  binary  : true
};

/**
 * True when the request submits a non-primitive where the schema cannot accept
 * one -- the shape of a Mongo operator injection (CWE-943).
 *
 * The concrete attack this recognises: a payload of
 * `{"folderId": {"$exists": true}}` against `folderId: Joi.string().required()`
 * reaches a `pre` lookup as `model.findById({$exists: true})`, i.e.
 * `findOne({_id: {$exists: true}})`, which matches an ARBITRARY document. Hapi
 * runs prerequisites before the handler [node_modules/@hapi/hapi/lib/route.js:
 * 287-292 and lib/handler.js:11-27], so without this test the lookup happens
 * before the handler's validation block has run. Repeated query keys arrive as
 * arrays and have the same effect.
 *
 * Two shapes count, and only two:
 *   - a declared leaf whose type can only hold a primitive receiving an object,
 *     an array or a function;
 *   - an UNDECLARED key receiving one, because a plain-object section is wrapped
 *     with Joi.object() and therefore disallows unknown keys, so the handler's
 *     block rejects it too.
 * A leaf whose declared type admits a structure is never flagged, and neither is
 * a section given as a compiled Joi schema rather than the plain-object
 * shorthand: its leaves cannot be enumerated cheaply, so it is left entirely to
 * the handler's block.
 *
 * @param {Object} validation The route's declared validation block.
 * @param {Object} request The hapi request.
 * @returns {boolean} True on the first violation found.
 */
function nonScalarSubmission(validation, request) {
  try {
    for (var key in validation) {
      var section = validation[key];

      // The plain-object shorthand is the only enumerable form. A compiled
      // schema is skipped, not trusted: the handler's block still validates it.
      if (Joi.isSchema(section) || !section || typeof section !== 'object') {
        continue;
      }

      var container = request[key];

      if (container === null || typeof container !== 'object') {
        continue;
      }

      var names = Object.keys(container);

      for (var i = 0; i < names.length; i++) {
        var name  = names[i];
        var value = container[name];

        if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
          continue;
        }

        var leaf = section[name];

        if (leaf === undefined) {
          return true;
        }

        if (Joi.isSchema(leaf)) {
          if (PRIMITIVE_LEAF_TYPES[leaf.type]) {
            return true;
          }
          continue;
        }

        // A non-schema plain value as a leaf is not a type declaration this can
        // reason about, so it is left to the handler's block.
      }
    }
  }
  catch (err) {
    // A schema shape this does not anticipate must never become a 500: fall
    // through to the handler's own validation, which is where every outcome
    // this file has ever produced comes from. Deliberately silent - the request
    // is still fully validated, so there is nothing here worth a log line.
    return false;
  }

  return false;
}

/**
 * Builds the pre-handler validation gate for a route that declares validation.
 *
 * The gate closes SEC-F12 without moving validation wholesale to an earlier
 * stage, which would change accept/reject outcomes: pre-handlers mutate the
 * payload the handler's block validates, and POST /users depends on that
 * (`lowerUserFields` lowercases `username` before `.invalid(reservedUsernames)`
 * is applied, so `username=Admin` is rejected only because the pre-handler ran
 * first). So the gate fires on ONE shape -- a non-primitive submitted where the
 * schema cannot hold one -- and defers to the handler for everything else.
 *
 * When it fires it produces the route's ordinary validation-failure response,
 * just earlier: `request.fail` reads only `json`, `request.yar`, `fail`, the
 * negotiated response type, `request.payload` and `request.query`, and never
 * `request.pre`, which is why running it before the prerequisites yields the
 * same status, content type, validation flash and body.
 *
 * `.takeover()` is required rather than stylistic: a lifecycle method that runs
 * before the handler may only return an error, a takeover response or a
 * continue signal, and anything else is replaced with a 500
 * [node_modules/@hapi/hapi/lib/request.js:397-399].
 *
 * @param {Object} validation The route's declared validation block.
 * @param {Object} language The per-field message map.
 * @param {{success: Object, fail: Object, replySpec: *}} ctx The parse-time
 *   route specification. The negotiated response type is added per request.
 * @returns {function(Object, Object): Promise} A hapi lifecycle method that
 *   returns `null` to continue, or a takeover response.
 */
function makeValidationGate(validation, language, ctx) {
  return async function(request, h) {
    if (!nonScalarSubmission(validation, request)) {
      return null;
    }

    var responseType     = accepts(request).types(['html', 'json']);
    var validationErrors;

    installResponders(request, h, {
      success      : ctx.success,
      fail         : ctx.fail,
      replySpec    : ctx.replySpec,
      responseType : responseType
    });

    validationErrors = runValidation(validation, language, request);

    if (!validationErrors) {
      // The schema permits it after all, so there is nothing to foreclose and
      // the request proceeds exactly as it does today.
      return null;
    }

    request.yar.flash('validation', validationErrors, true);

    return request.fail(
      request.payload,
      util.inspect(redactSensitive(validationErrors))
    ).takeover();
  };
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
        // installResponders so that one implementation serves the handler and
        // the pre-handler validation gate below; passing the handler's own `h`
        // here is what gives controllers the toolkit they have always had.
        installResponders(request, h, {
          success      : success,
          fail         : fail,
          replySpec    : replySpec,
          responseType : responseType
        });

        // Joi 17+ validation.
        //
        // This block still runs HERE, in the handler, and not only in the gate
        // that runs before the prerequisites. The two are not interchangeable:
        // pre-handlers mutate the payload this block validates. POST /users
        // declares `pre: [{method: helpers.lowerUserFields}]` and validates
        // `username` with `.invalid(...reservedUsernames)`, so `username=Admin`
        // is rejected only because lowerUserFields has already lowercased it.
        // Moving validation wholesale to a stage before `pre` would change that
        // accept/reject outcome, which AAP rule R-d forbids. The gate is
        // narrower by design and only forecloses the operator-injection shape.
        if (validation) {
          validationErrors = runValidation(validation, language, request);

          if (validationErrors) {
            // The validation messages are NOT redacted: they are user-facing
            // and rendered (lib/views/signup.html:39 renders
            // flash.validation.password, whose Joi message embeds the submitted
            // value), and AAP 0.6.2 gates the rendered validation flash across
            // all 102 validation targets. Only the second argument is redacted,
            // because that one is log-only.
            request.yar.flash('validation', validationErrors, true);
            return request.fail(request.payload, util.inspect(redactSensitive(validationErrors)));
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

          return Boom.badImplementation(err.message || String(err));
        }
      }
    } // end handler

    // Convert pre-handlers to Hapi 20+ format
    if (route.options && route.options.pre) {
      route.options.pre = convertPreHandlers(route.options.pre);
    }

    // The validation gate runs FIRST, ahead of the route's own pre-handlers.
    //
    // Hapi executes prerequisites before the handler, and the handler is where
    // this file's hand-rolled validation lives, so an operator-shaped payload
    // such as {"folderId": {"$exists": true}} used to reach a `pre` Mongoose
    // lookup -- and match an arbitrary document -- before any Joi check
    // (CWE-943/CWE-20). The gate forecloses exactly that shape and defers
    // everything else to the handler, because pre-handlers mutate the payload
    // the handler validates and validating wholesale here would change
    // accept/reject outcomes. See makeValidationGate.
    //
    // No `assign` key, so it contributes nothing to request.pre and the
    // positional and named contents of that object are unchanged.
    if (validation && route.options) {
      var validationGate = {
        method : makeValidationGate(validation, language, {
          success   : success,
          fail      : fail,
          replySpec : replySpec
        })
      };

      route.options.pre = Array.isArray(route.options.pre)
        ? [validationGate].concat(route.options.pre)
        : [validationGate];
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

// Characters that must never survive into a Location header. A CR or an LF
// would split the response; the rest are silently dropped by browsers while
// resolving a URL, which is what lets them smuggle an authority past a prefix
// test that is looking at the raw string.
var CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

// An authority-forming prefix: an optional scheme followed by two or more
// slashes or backslashes, or simply two or more of them. Backslashes count
// because browsers normalise them to slashes when resolving a URL, so `/\host`
// and `//host` reach the same origin.
var AUTHORITY_PREFIX = /^(?:[a-zA-Z][a-zA-Z0-9+.\-]*:)?[\/\\]{2,}/;

// A bare `scheme:` with no slashes at all - `javascript:`, `data:`, `mailto:`.
var BARE_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.\-]*:/;

// Everything a single path segment may NOT contain. A segment is what every
// value the route DSL substitutes into a `fail.redirect` template actually is,
// measured: `formName` is `sign-up`, the only value lib/views/signup.html:18
// ever posts, and `redirectTo` is `activate-account` or `home`, both set by the
// controller rather than by the client.
var PATH_SEGMENT_UNSAFE = /[^A-Za-z0-9._~-]/g;

// A target that means to carry an authority: it opens with a scheme followed by
// slashes, or with slashes alone.
var AUTHORITY_INTRODUCER = /^(?:[a-zA-Z][a-zA-Z0-9+.\-]*:)?[\/\\]{2}/;

// ...and the only well-formed way to write one: an optional http or https
// scheme, exactly two forward slashes, then at least one character that is not
// a delimiter. Anything else is a form a browser salvages and a string test
// misreads.
var WELL_FORMED_AUTHORITY = /^(?:https?:)?\/\/[^\/\\?#]/i;

/**
 * Resolves `target` strictly as a path on the application's own origin.
 *
 * Used where a redirect target is interpolated from request data and therefore
 * has to stay on this origin whatever it turns out to say. The steps, in order:
 * strip control characters; collapse any authority-forming prefix to a single
 * slash, so `//evil.com`, `///evil.com`, `https://evil.com` and `/\evil.com`
 * all become the local path `/evil.com`; drop a bare `scheme:` so
 * `javascript:alert(1)` cannot survive as a scheme; guarantee one leading
 * slash; and prefix the application URL.
 *
 * Byte-identical for every local template the route DSL declares, which is what
 * makes it safe to apply to the whole fail path. Measured over all twelve
 * declared `fail.redirect` values: '/login', '/{formName}', '/courses/new',
 * '/welcome', '/forgot-pass' (x3), '/{redirectTo}' (x2), '/signup', and
 * 'account/email' (x2) -- the last of which carries no leading slash and still
 * resolves to config.url + '/account/email', exactly as the third normalisation
 * branch below produces it today.
 *
 * @param {string} target An already-interpolated redirect target.
 * @returns {string} An absolute URL on config.url.
 */
function confineToOrigin(target) {
  var confined = String(target).replace(CONTROL_CHARS, '');

  confined = confined.replace(AUTHORITY_PREFIX, '/');
  confined = confined.replace(BARE_SCHEME, '');

  if (confined.charAt(0) !== '/') {
    confined = '/' + confined;
  }

  return config.url + confined;
}


/**
 * True when `target` is a shape this helper is willing to emit as it stands:
 * a same-origin-relative path, or an absolute http/https URL whose authority
 * carries no userinfo.
 *
 * Anything else is confined to the application's own origin instead. The two
 * shapes this excludes are a non-http scheme -- `javascript:`, `data:`,
 * `vbscript:`, `mailto:`, `file:` -- and an authority with userinfo in it,
 * which reads as one origin and resolves to another and has no legitimate use
 * on this surface.
 *
 * @param {string} target An already-interpolated redirect target.
 * @returns {boolean}
 */
function isSafeRedirectShape(target) {
  var scheme = target.match(BARE_SCHEME);
  var authorityStart;

  if (scheme && !/^https?:$/i.test(scheme[0])) {
    return false;
  }

  // A target that introduces an authority must present EXACTLY the two slashes
  // that introduce one, followed by a non-empty authority.
  //
  // This is the rule that closes the salvaged forms. A browser resolves
  // `http:///evil.example`, `http:////evil.example` and `///evil.example` to
  // http://evil.example by skipping the surplus slashes, while a positional
  // read of the string finds an EMPTY authority and concludes the target is
  // same-origin - so those forms slipped past both the allowlist and the
  // cross-origin log line. Measured: five spellings resolved off-origin while
  // reporting no host. No legitimate target is spelled that way: an avatar URL,
  // an OAuth authorize URL and a signed download URL are all well-formed, so
  // requiring well-formedness costs nothing and denies every salvaged variant.
  if (AUTHORITY_INTRODUCER.test(target) && !WELL_FORMED_AUTHORITY.test(target)) {
    return false;
  }

  // Userinfo is only meaningful inside an authority, so a path that happens to
  // contain an '@' -- a username segment, for instance -- is not affected.
  authorityStart = target.indexOf('//');

  if (authorityStart === 0 || (scheme && authorityStart === scheme[0].length)) {
    var authority = target.slice(authorityStart + 2);
    var end       = authority.search(/[\/?#]/);

    if (end !== -1) {
      authority = authority.slice(0, end);
    }

    if (authority.indexOf('@') !== -1) {
      return false;
    }
  }

  return true;
}

/**
 * True when an off-origin redirect host is permitted to be emitted.
 *
 * The allowlist is optional and is read defensively: `app.redirect.allowedHosts`
 * is absent from committed configuration, and adding it belongs to the
 * configuration owner rather than here. While it is absent -- or present but
 * empty, or not an array -- every off-origin host is permitted, which is
 * exactly today's behaviour and is why no route's Location changes. A
 * deployment that supplies a non-empty list gets enforcement.
 *
 * @param {string} host The lowercased `host[:port]` of the target.
 * @returns {boolean}
 */
function isAllowedRedirectHost(host) {
  var allowed = config.app.redirect && config.app.redirect.allowedHosts;
  var i;

  if (!Array.isArray(allowed) || allowed.length === 0) {
    return true;
  }

  for (i = 0; i < allowed.length; i++) {
    if (String(allowed[i]).toLowerCase() === host) {
      return true;
    }
  }

  return false;
}

/**
 * Records one line for a cross-origin redirect this helper emitted.
 *
 * The point is observability: an off-origin 302 built from stored or submitted
 * data is exactly the exposure SEC-F48 describes, and while the target is still
 * emitted by default the fact that it happened must not be invisible. Only the
 * target's host is logged, never the full URL, because a signed download URL
 * carries its signature in the query string.
 *
 * Total by construction, because a log failure must never be what breaks a
 * redirect.
 *
 * @param {Object} request The hapi request.
 * @param {string} host The lowercased `host[:port]` of the target.
 * @returns {undefined}
 */
function logCrossOriginRedirect(request, host) {
  try {
    log.warn('cross-origin redirect ' + request.method + ' ' + request.path + ' -> ' + host);
  }
  catch (err) {}
}

/**
 * The cross-origin host of a redirect target, or null when the target resolves
 * to this application's own origin.
 *
 * Resolved with the WHATWG parser, against the application URL as the base, so
 * the origin this compares is the origin the CLIENT will end up at rather than
 * the one a string test infers. That is the whole point: the earlier positional
 * read reported no host for `http:///evil.example` and four sibling spellings,
 * each of which a browser resolves to a foreign origin, so both the allowlist
 * and the cross-origin log line were bypassable. Those spellings are now
 * refused by isSafeRedirectShape before they reach here; resolving properly is
 * what makes sure the next such spelling is not a hole too.
 *
 * `URL.origin` already carries the scheme, the host and the port, and already
 * excludes userinfo, so comparing origins answers "will the client leave this
 * application" exactly.
 *
 * @param {string} target A redirect target, absolute or relative.
 * @returns {(string|null)} The lowercased `host[:port]`, or null for a target
 *   on this origin or one that does not resolve at all.
 */
function redirectHost(target) {
  try {
    var resolved = new URL(target, config.url);
    var base     = new URL(config.url);

    if (resolved.origin === base.origin) {
      return null;
    }

    return resolved.host.toLowerCase();
  }
  catch (err) {
    // A target that will not resolve cannot be reported as cross-origin. It is
    // already confined by isSafeRedirectShape, which every caller consults
    // first.
    return null;
  }
}

/**
 * Hapi 20+ redirect helper: turns a route's redirect template into a response.
 *
 * SECURITY MODEL. Five rules apply, and their scope differs deliberately.
 *
 *   1. Control characters are stripped from EVERY target, which closes CR/LF
 *      response splitting through an interpolated value.
 *   2. A target whose scheme is not http or https is confined to this origin,
 *      which closes `javascript:`, `data:`, `vbscript:`, `mailto:` and `file:`.
 *   3. A target whose authority carries userinfo is confined, which closes the
 *      `https://trinket.dev@evil.com` origin-confusion read.
 *   4. An off-origin host outside `app.redirect.allowedHosts` is confined --
 *      but only when a deployment supplies that list. It is absent from
 *      committed configuration, so by default off-origin targets are emitted.
 *   5. Every cross-origin redirect that is emitted is logged.
 *
 * WHY THE SUCCESS PATH IS NOT CONFINED BY DEFAULT. `GET /api/users/{userId}/
 * avatar` declares `redirect: '{src}'` [config/api_routes.js:1453-1459], so an
 * attacker-controlled stored avatar becomes an unauthenticated same-site 302 to
 * an arbitrary origin (SEC-F48). Confining the success path would close it, and
 * would also break every legitimate off-origin avatar: `normalizeAvatar` passes
 * a stored `http...` value through unchanged [lib/models/user.js:238-265] and
 * `lib/controllers/auth.js` stores the Google profile-picture URL as
 * `user.avatar`, so every Google-linked account would lose its picture. The
 * same applies to `GET /auth/google`, which redirects to accounts.google.com
 * through this helper, and to the signed export-download URL.
 *
 * COMPLETING SEC-F48 NEEDS TWO CHANGES OUTSIDE THIS FILE, and this helper is
 * the mitigation available inside it: a write-time origin restriction on
 * `user.avatar` in lib/models/user.js, and either a proxied image response or a
 * non-interpolating declaration for that route in config/api_routes.js. Rules 1
 * to 5 close the response-splitting, non-http-scheme and userinfo variants for
 * the whole surface, make the exposure observable, and give a deployment an
 * enforcement switch; the arbitrary-host 302 itself is closed at the write and
 * at the declaration.
 *
 * @param {Object} request The hapi request, read for `params` when the template
 *   carries `{...}` placeholders.
 * @param {Object} h The toolkit.
 * @param {string} urlTemplate The declared template, or a controller-supplied
 *   `redirectTo`.
 * @param {Object} json The interpolation source. NOTE that the `{...}` branch
 *   mutates it, via `_.extend`, exactly as it always has.
 * @param {{sameOriginOnly: boolean}} [options] `sameOriginOnly` resolves the
 *   target strictly as a path on this origin instead of running the three
 *   normalisation branches. The failure path asks for it, because its templates
 *   interpolate request data -- `POST /users` declares `fail.redirect` as
 *   '/{formName}', so `formName=//evil.com` used to interpolate to
 *   `///evil.com`, match the protocol-relative branch and emit
 *   `https:///evil.com`, which browsers resolve to `https://evil.com/`
 *   (CWE-601). Every declared fail template is a local path, so confinement
 *   changes no observable output.
 * @returns {Object} A toolkit redirect response.
 */
function redirect(request, h, urlTemplate, json, options) {
  // for "simple" redirects where params are simply copied to a new location
  if (/{\w+}/.test(urlTemplate)) {
    json = _.extend(json, request.params);
  }

  var redirectURL = json ? StringUtils.interpolate(urlTemplate, json) : urlTemplate;

  // Rule 1, applied to EVERY redirect: no control characters reach the
  // Location header. A CR or an LF in an interpolated value would split the
  // response, and the remaining control characters are dropped by browsers
  // while resolving a URL, so leaving them in means the branches below are
  // testing a different string from the one the browser will act on.
  redirectURL = String(redirectURL).replace(CONTROL_CHARS, '');

  if (options && options.sameOriginOnly) {
    return h.redirect(confineToOrigin(redirectURL));
  }

  // Rules 2 and 3: a target that is neither same-origin-relative nor a
  // well-formed absolute http/https URL is treated as a local path rather than
  // emitted. Rule 2 covers every other scheme -- javascript:, data:,
  // vbscript:, mailto:, file: -- and rule 3 covers an authority carrying
  // userinfo, such as https://trinket.dev@evil.com, which reads as this origin
  // and resolves to another. No declared redirect template uses either shape,
  // so neither rule changes an observable Location.
  if (!isSafeRedirectShape(redirectURL)) {
    return h.redirect(confineToOrigin(redirectURL));
  }

  if (/^\/\//.test(redirectURL)) {
    redirectURL = config.app.url.protocol + ':' + redirectURL;
  }
  else if (/^\//.test(redirectURL)) {
    redirectURL = config.url + redirectURL;
  }
  else if (!/^https?:\/\//.test(redirectURL)) {
    redirectURL = config.url + '/' + redirectURL;
  }

  var targetHost = redirectHost(redirectURL);

  if (targetHost) {
    // Rule 4: an optional allowlist, read defensively because the key is
    // absent from committed configuration. When it is absent -- the committed
    // default -- an off-origin target is emitted exactly as it is today, so no
    // route changes behaviour; when a deployment supplies one, an off-origin
    // host outside it is confined.
    if (!isAllowedRedirectHost(targetHost)) {
      return h.redirect(confineToOrigin(redirectURL));
    }

    // Rule 5: every cross-origin redirect that IS emitted is logged, so the
    // exposure is observable in production rather than silent.
    logCrossOriginRedirect(request, targetHost);
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
