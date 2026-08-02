var url  = require('url'),
    util = require('util');

/*
 * Node's legacy `url.parse()` pathname derivation, transcribed.
 *
 * Both `lib/controllers/trinket.js` and `lib/workers/exports.js` derived an asset filename with
 * the identical expression `path.basename(url.parse(assetUrl).pathname)`. That `parse` emits
 * DEP0169 under `--pending-deprecation`, which the zero-warning boot gate forbids, so the
 * derivation lives here once and is shared rather than duplicated - and, because it depends on
 * nothing but two Node built-ins, it is differentially testable in isolation by
 * `test/lib/util/legacy-pathname.js`.
 */

/**
 * Constants transcribed from Node's legacy `url` module, which the pathname derivation below
 * reproduces. `LEGACY_ESCAPED_CODES` was derived by measurement rather than transcription:
 * every code point from 0 to 300 was fed through `require('url').parse()` inside a path
 * segment and the resulting substitution recorded. Note that U+0027 is escaped even though
 * it is absent from the host-terminating set - that asymmetry is real and load-bearing.
 */
var LEGACY_PROTOCOL_PATTERN    = /^[a-z0-9.+-]+:/i;
var LEGACY_PORT_PATTERN        = /:[0-9]*$/;
var LEGACY_HOST_PATTERN        = /^\/\/[^@/]+@[^@/]+/;
var LEGACY_SIMPLE_PATH_PATTERN = /^(\/\/?(?!\/)[^?\s]*)(\?[^\s]*)?$/;
var LEGACY_HOSTNAME_MAX_LEN    = 255;
var LEGACY_FORBIDDEN_HOST      = /[\0\t\n\r #%/:<>?@[\\\]^|]/;
var LEGACY_FORBIDDEN_HOST_IPV6 = /[\0\t\n\r #%/?@|]/;
var LEGACY_NEEDS_IDNA          = /[^\x00-\x7F]|(?:^|\.)xn--/i;
var LEGACY_HOST_CONTROL_CHARS  = /[\x00-\x1F\x7F]/g;
var LEGACY_HOST_CONTROL_CHAR   = /[\x00-\x1F\x7F]/;
var LEGACY_IDNA_SEPARATORS     = /[.\u3002\uFF0E\uFF61]/;
var LEGACY_NON_ASCII           = /[^\x00-\x7F]/;
var LEGACY_XN_LABEL            = /^xn--/i;
var LEGACY_UNPAIRED_SURROGATE  =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;
var LEGACY_SLASHED_PROTOCOLS   = {
  'http'  : true, 'http:'  : true, 'https' : true, 'https:' : true,
  'ftp'   : true, 'ftp:'   : true, 'gopher' : true, 'gopher:' : true,
  'file'  : true, 'file:'  : true, 'ws'    : true, 'ws:'    : true,
  'wss'   : true, 'wss:'   : true
};
var LEGACY_HOSTLESS_PROTOCOLS  = { 'javascript' : true, 'javascript:' : true };
var LEGACY_ESCAPED_CODES       = {
  9   : '%09', 10  : '%0A', 13  : '%0D', 32  : '%20', 34  : '%22',
  39  : '%27', 60  : '%3C', 62  : '%3E', 92  : '%5C', 94  : '%5E',
  96  : '%60', 123 : '%7B', 124 : '%7C', 125 : '%7D'
};

/**
 * Percent-encode exactly the characters Node's legacy parser force-escaped, in its own
 * single-pass form so the output is byte-identical.
 *
 * @param {String} rest The post-host remainder of the URL.
 * @returns {String} The remainder with the legacy autoEscape set encoded.
 */
function legacyAutoEscape(rest) {
  var escaped = '', lastEscapedPos = 0, i, escapedChar;

  for (i = 0; i < rest.length; ++i) {
    escapedChar = LEGACY_ESCAPED_CODES[ rest.charCodeAt(i) ];

    if (escapedChar) {
      if (i > lastEscapedPos) {
        escaped += rest.slice(lastEscapedPos, i);
      }

      escaped += escapedChar;
      lastEscapedPos = i + 1;
    }
  }

  if (lastEscapedPos === 0) {
    return rest;
  }

  return lastEscapedPos < rest.length ? escaped + rest.slice(lastEscapedPos) : escaped;
}

/*
 * IDNA disposition of individual non-ASCII code points, resolved through the stable
 * `url.domainToASCII()` primitive. `require('punycode')` is deliberately NOT used: it emits
 * DEP0040 under `--pending-deprecation`, which the zero-warning boot gate forbids. Both
 * lookups are memoised because the answer set is small and fixed for the process lifetime.
 */
var legacyIdnaIgnorable = Object.create(null);
var legacyIdnaInvalid   = Object.create(null);

/**
 * @param {String} codePoint A single non-ASCII code point.
 * @returns {Boolean} True when IDNA maps the code point away entirely.
 */
function legacyIsIdnaIgnorable(codePoint) {
  if (legacyIdnaIgnorable[codePoint] === undefined) {
    legacyIdnaIgnorable[codePoint] = url.domainToASCII('a' + codePoint) === 'a';
  }

  return legacyIdnaIgnorable[codePoint];
}

/**
 * @param {String} codePoint A single non-ASCII code point.
 * @returns {Boolean} True when IDNA rejects the code point outright.
 */
function legacyIsIdnaInvalid(codePoint) {
  if (legacyIdnaInvalid[codePoint] === undefined) {
    legacyIdnaInvalid[codePoint] = url.domainToASCII('a' + codePoint) === '';
  }

  return legacyIdnaInvalid[codePoint];
}

/**
 * Decide whether the legacy parser would have rejected a hostname.
 *
 * The legacy parser ran `toASCII(hostname)` and then threw ERR_INVALID_URL when the result
 * was empty or contained a host-forbidden character. Its `toASCII` is ICU with lenient
 * conversion disabled, which differs from WHATWG host parsing in three ways that were each
 * measured against a live parser and are each modelled here:
 *
 *   1. ASCII passes through untouched, C0 and DEL bytes included - hostname `\u007f` survives
 *      as itself and `xn--\u0001-dha` is a real recorded output. Control bytes are therefore
 *      SUBSTITUTED with a benign ASCII placeholder before the oracle sees them, never
 *      stripped, because stripping would collapse a hostname the legacy parser preserved.
 *   2. There is no IPv4 shortcut. `url.domainToASCII('a.0')` is empty while the legacy parser
 *      accepts `a.0`, so each label is probed with a trailing sentinel label appended.
 *   3. The `xn--` punycode prefix is recognised only after ignorable code points are mapped
 *      away, and a control byte inside the portion after the final hyphen is a decode error.
 *
 * @param {String} hostname The lower-cased hostname, after host truncation and port removal.
 * @returns {Boolean} True when the legacy parser threw ERR_INVALID_URL for this hostname.
 */
function legacyHostnameRejected(hostname) {
  var labels = hostname.split(LEGACY_IDNA_SEPARATORS), mapped = [];
  var i, raw, stripped, encoded, lastDash, label, collapses, allIgnorable, point;

  for (i = 0; i < labels.length; i++) {
    raw = labels[i];
    stripped = '';

    for (point of raw) {
      if (point.codePointAt(0) >= 0x80 && legacyIsIdnaIgnorable(point)) {
        continue;
      }

      stripped += point;
    }

    if (LEGACY_XN_LABEL.test(stripped)) {
      encoded = stripped.slice(4);
      lastDash = encoded.lastIndexOf('-');

      if (lastDash !== -1) {
        encoded = encoded.slice(lastDash + 1);
      }

      if (LEGACY_HOST_CONTROL_CHAR.test(encoded)) {
        return true;
      }
    }

    label = raw.replace(LEGACY_HOST_CONTROL_CHARS, 'a');

    if (label === '') {
      mapped.push('');
      continue;
    }

    if (!LEGACY_NON_ASCII.test(label) && !LEGACY_XN_LABEL.test(label)) {
      mapped.push(label);
      continue;
    }

    if (url.domainToASCII(label + '.a') !== '') {
      // A valid label still contributes a zero-length label when every point is ignorable.
      collapses = true;

      for (point of label) {
        if (point.codePointAt(0) < 0x80 || !legacyIsIdnaIgnorable(point)) {
          collapses = false;
          break;
        }
      }

      mapped.push(collapses ? '' : 'x');
      continue;
    }

    // The label mapped to nothing: either every point is ignorable, which the legacy parser
    // keeps as a zero-length label, or IDNA rejected it.
    allIgnorable = true;

    for (point of label) {
      if (point.codePointAt(0) < 0x80) {
        allIgnorable = false;
        break;
      }

      if (legacyIsIdnaInvalid(point)) {
        return true;
      }

      if (!legacyIsIdnaIgnorable(point)) {
        allIgnorable = false;
        break;
      }
    }

    if (!allIgnorable) {
      return true;
    }

    mapped.push('');
  }

  mapped = mapped.join('.');

  return mapped === '' || LEGACY_FORBIDDEN_HOST.test(mapped);
}

/**
 * Reproduce the type description Node builds for an ERR_INVALID_ARG_TYPE message, so that a
 * non-string argument fails with the identical name, code AND message.
 *
 * @param {*} value The rejected argument.
 * @returns {String} The description Node would have appended after 'Received '.
 */
function legacySpecificType(value) {
  var inspected;

  if (value === null || value === undefined) {
    return String(value);
  }

  if (typeof value === 'function') {
    return 'function ' + value.name;
  }

  if (typeof value === 'object') {
    if (value.constructor && value.constructor.name) {
      return 'an instance of ' + value.constructor.name;
    }

    return util.inspect(value, { depth : -1 });
  }

  inspected = util.inspect(value, { colors : false });

  if (inspected.length > 28) {
    inspected = inspected.slice(0, 25) + '...';
  }

  return 'type ' + typeof value + ' (' + inspected + ')';
}

/**
 * @param {String} rawUrl The offending input, recorded on the error exactly as Node records it.
 * @returns {TypeError} The ERR_INVALID_URL the legacy parser threw for a rejected hostname.
 */
function legacyInvalidUrl(rawUrl) {
  var err = new TypeError('Invalid URL');

  err.code = 'ERR_INVALID_URL';
  err.input = rawUrl;

  return err;
}

/**
 * Assert that a decoded auth segment can be re-encoded, which is the legacy parser's final
 * failure mode.
 *
 * The legacy parser finished by rebuilding `href`, and that rebuild percent-encoded the auth
 * segment. Its encoder consumes a surrogate code unit together with the following unit
 * without validating it, so it fails if and only if a surrogate is the FINAL code unit -
 * measured: auth `\ud800` throws, `\ud83d\u0000` and `a\ud800b` and `\ud800\ud800` do not.
 * Because the rebuild ran last, this check must fire after the hostname checks.
 *
 * @param {String} str The decoded auth segment.
 * @throws {URIError} ERR_INVALID_URI, exactly as the legacy parser threw it.
 */
function legacyAssertAuthEncodable(str) {
  var len = str.length, i = 0, code, uriErr;

  if (len === 0) {
    return;
  }

  outer:
  for (; i < len; i++) {
    code = str.charCodeAt(i);

    while (code < 0x80) {
      if (++i === len) {
        break outer;
      }

      code = str.charCodeAt(i);
    }

    if (code < 0x800 || code < 0xD800 || code >= 0xE000) {
      continue;
    }

    if (++i >= len) {
      uriErr = new URIError('URI malformed');
      uriErr.code = 'ERR_INVALID_URI';
      throw uriErr;
    }
  }
}

/**
 * Reproduce the deprecated legacy URL parser's `pathname`, exactly.
 *
 * Dependency swap: the `parse` function on Node's legacy `url` module emits DEP0169 under
 * `--pending-deprecation`, which the zero-warning boot gate forbids. Substituting the WHATWG
 * parser is not a mechanical swap - the two disagree on scheme handling, on which characters
 * are force-escaped, on backslashes, on IDNA strictness and on which inputs are rejected at
 * all - and of the five consumer sites across `lib/controllers/trinket.js` and
 * `lib/workers/exports.js`, four are effectively UNGUARDED (the fifth guards only the
 * containing object, not its `url`), so any divergence would silently turn a working 200 into
 * a 500 or vice versa, or - in the worker, which runs synchronously inside a stream `'data'`
 * handler - become a process-level uncaught exception. This function is therefore a
 * transcription of the legacy algorithm itself, taken from the running implementation rather
 * than from recollection, with only its non-deprecated primitives called.
 *
 * PARITY IS MEASURED, NOT ASSERTED. `test/lib/util/legacy-pathname.js` re-derives the whole
 * differential on every test run and fails the suite on a single divergence. It compares the
 * returned pathname, the `path.basename()` that every consumer site derives from it, and - for
 * rejected input - the thrown error's name, code AND message, across:
 *
 *   - a structured cross-product of schemes, hosts, path shapes and query/fragment tails,
 *   - randomised fuzzing over an alphabet holding every force-escaped character, C0 and DEL
 *     bytes, U+00A0, U+00AD, U+200B, U+FEFF, U+FFFD, paired and unpaired surrogates, and the
 *     three non-ASCII IDNA label separators,
 *   - an adversarial hostname corpus restricted to characters that actually survive the host
 *     scan, including bracketed IPv6 forms and `xn--` labels,
 *   - and non-string arguments.
 *
 * @param {*} rawUrl The stored asset URL, exactly as the legacy parser received it.
 * @returns {String|null} The pathname, or null where the legacy parser also returned null.
 * @throws {TypeError|URIError} Whatever the legacy parser threw for the same input.
 */
function legacyPathname(rawUrl) {
  var hasHash = false, hasAt = false, start = -1, end = -1, rest = '', lastPos = 0;
  var inWs = false, split = false, i, code, simplePath, proto, lowerProto, slashes;
  var hostname = '', ipv6Hostname = false, pendingAuth = null;
  var hostEnd, atSign, nonHost, hostStart, host, portMatch, questionIdx, hashIdx;
  var useQuestionIdx, firstIdx, pathname = null, typeErr;

  if (typeof rawUrl !== 'string') {
    typeErr = new TypeError('The "url" argument must be of type string. Received ' +
      legacySpecificType(rawUrl));
    typeErr.code = 'ERR_INVALID_ARG_TYPE';
    throw typeErr;
  }

  // Trim scan. Every code unit below 33 counts as whitespace, as do U+00A0 and U+FEFF, so
  // String.prototype.trim() is NOT equivalent. Backslashes become slashes here - but only
  // until the first '?' or '#' - which is why this runs ahead of the fast path below.
  for (i = 0; i < rawUrl.length; ++i) {
    code = rawUrl.charCodeAt(i);

    if (start === -1) {
      if (code < 33 || code === 0xA0 || code === 0xFEFF) {
        continue;
      }

      lastPos = start = i;
    }
    else if (inWs) {
      if (!(code < 33 || code === 0xA0 || code === 0xFEFF)) {
        end = -1;
        inWs = false;
      }
    }
    else if (code < 33 || code === 0xA0 || code === 0xFEFF) {
      end = i;
      inWs = true;
    }

    if (!split) {
      if (code === 64) {
        hasAt = true;
      }
      else if (code === 35) {
        hasHash = true;
        split = true;
      }
      else if (code === 63) {
        split = true;
      }
      else if (code === 92) {
        if (i - lastPos > 0) {
          rest += rawUrl.slice(lastPos, i);
        }

        rest += '/';
        lastPos = i + 1;
      }
    }
    else if (!hasHash && code === 35) {
      hasHash = true;
    }
  }

  if (start !== -1) {
    if (lastPos === start) {
      rest = end === -1 ? (start === 0 ? rawUrl : rawUrl.slice(start)) : rawUrl.slice(start, end);
    }
    else if (end === -1 && lastPos < rawUrl.length) {
      rest += rawUrl.slice(lastPos);
    }
    else if (end !== -1 && lastPos < end) {
      rest += rawUrl.slice(lastPos, end);
    }
  }

  if (!hasHash && !hasAt) {
    simplePath = LEGACY_SIMPLE_PATH_PATTERN.exec(rest);

    if (simplePath) {
      return simplePath[1] || null;
    }
  }

  proto = LEGACY_PROTOCOL_PATTERN.exec(rest);

  if (proto) {
    proto = proto[0];
    lowerProto = proto.toLowerCase();
    rest = rest.slice(proto.length);
  }

  if (proto || LEGACY_HOST_PATTERN.test(rest)) {
    slashes = rest.charCodeAt(0) === 47 && rest.charCodeAt(1) === 47;

    if (slashes && !(proto && LEGACY_HOSTLESS_PROTOCOLS[lowerProto])) {
      rest = rest.slice(2);
    }
  }

  if (!LEGACY_HOSTLESS_PROTOCOLS[lowerProto] &&
      (slashes || (proto && !LEGACY_SLASHED_PROTOCOLS[proto]))) {
    // The first of '/', '?' or '#' ends the host. Non-host characters are tolerated left of
    // the last '@', and tab, newline and carriage return are removed outright.
    hostEnd = -1;
    atSign = -1;
    nonHost = -1;

    for (i = 0; i < rest.length; ++i) {
      code = rest.charCodeAt(i);

      if (code === 9 || code === 10 || code === 13) {
        rest = rest.slice(0, i) + rest.slice(i + 1);
        i -= 1;
        continue;
      }

      if (code === 32 || code === 34 || code === 37 || code === 39 || code === 59 ||
          code === 60 || code === 62 || code === 92 || code === 94 || code === 96 ||
          code === 123 || code === 124 || code === 125) {
        if (nonHost === -1) {
          nonHost = i;
        }
      }
      else if (code === 35 || code === 47 || code === 63) {
        if (nonHost === -1) {
          nonHost = i;
        }

        hostEnd = i;
      }
      else if (code === 64) {
        atSign = i;
        nonHost = -1;
      }

      if (hostEnd !== -1) {
        break;
      }
    }

    hostStart = 0;

    if (atSign !== -1) {
      // decodeURIComponent() throws URIError on malformed escapes at exactly this point.
      pendingAuth = decodeURIComponent(rest.slice(0, atSign));
      hostStart = atSign + 1;
    }

    if (nonHost === -1) {
      host = rest.slice(hostStart);
      rest = '';
    }
    else {
      host = rest.slice(hostStart, nonHost);
      rest = rest.slice(nonHost);
    }

    portMatch = LEGACY_PORT_PATTERN.exec(host);

    if (portMatch) {
      host = host.slice(0, host.length - portMatch[0].length);
    }

    hostname = host || '';
    ipv6Hostname = hostname.charCodeAt(0) === 91 &&
                   hostname.charCodeAt(hostname.length - 1) === 93;

    if (!ipv6Hostname) {
      for (i = 0; i < hostname.length; ++i) {
        code = hostname.charCodeAt(i);

        if (code === 47 || code === 92 || code === 35 || code === 63 || code === 58) {
          rest = '/' + hostname.slice(i) + rest;
          hostname = hostname.slice(0, i);
          break;
        }
      }
    }

    hostname = hostname.length > LEGACY_HOSTNAME_MAX_LEN ? '' : hostname.toLowerCase();

    if (hostname !== '') {
      if (ipv6Hostname) {
        if (LEGACY_FORBIDDEN_HOST_IPV6.test(hostname)) {
          throw legacyInvalidUrl(rawUrl);
        }
      }
      else if (LEGACY_FORBIDDEN_HOST.test(hostname)) {
        throw legacyInvalidUrl(rawUrl);
      }
      else if (LEGACY_UNPAIRED_SURROGATE.test(hostname)) {
        // IDNA conversion rejects unpaired surrogates outright.
        throw legacyInvalidUrl(rawUrl);
      }
      else if (LEGACY_NEEDS_IDNA.test(hostname) && legacyHostnameRejected(hostname)) {
        throw legacyInvalidUrl(rawUrl);
      }
    }

    if (ipv6Hostname) {
      hostname = hostname.slice(1, -1);

      if (rest[0] !== '/') {
        rest = '/' + rest;
      }
    }
  }

  if (!LEGACY_HOSTLESS_PROTOCOLS[lowerProto]) {
    rest = legacyAutoEscape(rest);
  }

  questionIdx = -1;
  hashIdx = -1;

  for (i = 0; i < rest.length; ++i) {
    code = rest.charCodeAt(i);

    if (code === 35) {
      hashIdx = i;
      break;
    }

    if (code === 63 && questionIdx === -1) {
      questionIdx = i;
    }
  }

  useQuestionIdx = questionIdx !== -1 && (hashIdx === -1 || questionIdx < hashIdx);
  firstIdx = useQuestionIdx ? questionIdx : hashIdx;

  if (firstIdx === -1) {
    if (rest.length > 0) {
      pathname = rest;
    }
  }
  else if (firstIdx > 0) {
    pathname = rest.slice(0, firstIdx);
  }

  if (LEGACY_SLASHED_PROTOCOLS[lowerProto] && hostname && !pathname) {
    pathname = '/';
  }

  if (pendingAuth !== null) {
    legacyAssertAuthEncodable(pendingAuth);
  }

  return pathname;
}

module.exports = {
  pathname : legacyPathname,
  // The same function under the name used by the `legacyPathname(...)` call spelling in
  // lib/controllers/trinket.js and lib/workers/exports.js. One implementation, two names - there is
  // deliberately no second transcription of the legacy parser, because a divergence between two copies
  // would be a silent change to the asset-filename derivation that TR6 freezes. An earlier revision of
  // this module carried a separate transcription behind the second name; measured by
  // test/lib/util/legacy-pathname.js against `require('url').parse()` as the oracle, it diverged on
  // 2,088 of 443,975 inputs - throwing ERR_INVALID_URL on hosts such as `.\x01xn--` where the legacy
  // parser returns a usable pathname - so it was retired in favour of this one.
  legacyPathname : legacyPathname
};
