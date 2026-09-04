var winston = require('winston'),
    config  = require('config');

// Field names whose values must never be written to a log sink. Matched as a
// case-insensitive SUBSTRING of the key, so one expression covers `password`,
// `oldPassword`, `resetKey`, `access_token`, `g-recaptcha-response` and the
// session and cookie fields at once, plus `accessCode`.
//
// `access[-_]?code` is spelled out rather than covered by a bare `code`,
// because `code` as a substring also names the `code` property Node puts on an
// Error (EADDRINUSE, ECONNREFUSED) and the numeric code a driver reports.
// Blanking those makes a log unreadable without protecting a credential, so the
// term is narrowed to the field the findings name. The same vocabulary and the
// same reasoning are in lib/util/routeParser.js.
//
// Declared here rather than imported: lib/util/routeParser.js carries the same
// vocabulary for the session flash, but it logs through the global `log` this
// module exports, so requiring it from here would close a cycle.
var SENSITIVE_KEY = /pass|secret|token|key|auth|credential|otp|pin|captcha|session|cookie|signature|salt|hash|access[-_]?code/i;

// A sensitive key followed by its value in the shapes a message string actually
// takes: util.inspect output (`password: 'x'`), JSON (`"password":"x"`) and
// query or form pairs (`password=x`). The key is captured so it can be written
// back, and only the value is replaced.
var SENSITIVE_QUOTED = /((?:[A-Za-z0-9_.\-]*(?:pass|secret|token|key|auth|credential|otp|pin|captcha|session|cookie|signature|salt|hash|access[-_]?code)[A-Za-z0-9_.\-]*)['"]?\s*[:=]\s*)(['"])(?:\\.|(?!\2)[^\\])*\2/gi;
var SENSITIVE_BARE   = /((?:[A-Za-z0-9_.\-]*(?:pass|secret|token|key|auth|credential|otp|pin|captcha|session|cookie|signature|salt|hash|access[-_]?code)[A-Za-z0-9_.\-]*)\s*[:=]\s*)([^\s,;&}\]'"]+)/gi;

// How deep the metadata walk descends, and the same bound the flash redactor in
// lib/util/routeParser.js uses.
var REDACT_MAX_DEPTH = 6;

// What replaces a structure the walk will not enter. Exhausting the bound, or
// meeting a structure already on the current path, FAILS CLOSED.
var REDACTED_DEPTH = '[redacted: nested beyond the redaction depth]';
var REDACTED_CYCLE = '[redacted: circular reference]';

// The message a log entry is reduced to when redaction itself fails.
var REDACTION_FAILED = '[log entry suppressed: redaction failed]';

/**
 * True when `value` is a structure the metadata walk may copy and descend into.
 *
 * Arrays qualify and so do plain objects, including the null-prototype ones
 * `querystring.parse` produces for form bodies. A Buffer, a stream, an Error, a
 * Date or any class instance does not: it is left by reference so a transport
 * still receives exactly the object it was given.
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
 * A copy of `value` with every sensitive field replaced by '[redacted]'.
 *
 * @param {*} value
 * @param {number} depth Levels already descended.
 * @param {Array} seen Structures on the current path, so a cycle terminates.
 * @returns {*}
 */
function redactValue(value, depth, seen) {
  var copy, keys, i, key;

  // A scalar is returned as it is: its own key was tested by the caller.
  if (!isRedactableStructure(value)) {
    return value;
  }

  // A structure the walk will not enter is REPLACED, never forwarded. Returning
  // it was a hole: a password seven levels down was written verbatim, because
  // the depth bound handed back the whole enclosing object with none of its
  // keys tested.
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
 * Replaces the value beside every sensitive key in a rendered message string.
 *
 * The string forms are the ones that reach this sink in practice: a
 * `util.inspect` rendering of a submitted payload, a JSON body, and a query or
 * form pair. Quoted values are replaced first so an unquoted match cannot stop
 * at the opening quote and leave the rest of the secret in place.
 *
 * @param {string} message
 * @returns {string}
 */
function redactMessage(message) {
  return message
    .replace(SENSITIVE_QUOTED, function(match, prefix, quote) {
      return prefix + quote + '[redacted]' + quote;
    })
    .replace(SENSITIVE_BARE, function(match, prefix) {
      return prefix + '[redacted]';
    });
}

/**
 * The logger-level redaction format.
 *
 * Applied at the LOGGER rather than at a transport so it covers every transport
 * this module configures and any added later: a credential that reaches the
 * logger is scrubbed once, before the Console and File formats ever see it.
 *
 * Both halves of an `info` object are covered, because a caller may put a
 * secret in either. `info.message` is scrubbed textually, since by the time it
 * arrives it is already a rendered string. The remaining own enumerable
 * properties are winston's metadata and are scrubbed by key name; `level` and
 * `message` are skipped (the first is never sensitive, the second is handled
 * above) and winston's symbol keys are untouched because Object.keys does not
 * enumerate them, which is what keeps `Symbol.for('splat')` and
 * `Symbol.for('message')` intact for the formats downstream.
 *
 * It is total by construction: any failure returns `info` unchanged, so logging
 * can never be the thing that breaks a request.
 */
var redactFormat = winston.format(function(info) {
  var keys, i, key;

  try {
    if (typeof info.message === 'string') {
      info.message = redactMessage(info.message);
    }

    keys = Object.keys(info);
    for (i = 0; i < keys.length; i++) {
      key = keys[i];

      if (key === 'level' || key === 'message') {
        continue;
      }

      info[key] = SENSITIVE_KEY.test(key)
        ? '[redacted]'
        : redactValue(info[key], 0, []);
    }
  }
  catch (err) {
    // FAIL CLOSED. Returning the original entry would publish exactly what
    // redaction was there to withhold, so an entry that cannot be scrubbed is
    // reduced to its level and a marker instead. Losing one line's diagnostics
    // is the smaller cost, and the marker says which line it was.
    try {
      keys = Object.keys(info);
      for (i = 0; i < keys.length; i++) {
        if (keys[i] !== 'level') {
          delete info[keys[i]];
        }
      }
      info.message = REDACTION_FAILED;
    }
    catch (ignored) {
      // Nothing further is safe to touch; the entry is already stripped as far
      // as it could be.
    }

    return info;
  }

  return info;
});

var transports = [];

transports.push(
  new winston.transports.Console({
    level: config.app.log.level,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  })
);

if (config.app.log.debug && config.app.log.debug.filename) {
  transports.push(
    new winston.transports.File({
      level: 'debug',
      filename: config.app.log.debug.filename
    })
  );
}

// Winston 3 uses createLogger instead of new Logger
//
// `format` is set explicitly because createLogger defaults it to json() when it
// is omitted, and the File transport above has no format of its own and relies
// on that default to produce a line. Combining redaction with json() keeps that
// default in place behind the redactor; the Console transport carries its own
// colorize + simple format and is unaffected.
module.exports = winston.createLogger({
  format: winston.format.combine(redactFormat(), winston.format.json()),
  transports: transports
});
