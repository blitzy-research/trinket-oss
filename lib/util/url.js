// Legacy URL parsing for the application sites that read one or two fields off
// a stored or user-supplied URL. `parseLegacy` transcribes the Node runtime's
// own legacy parser - `Url.prototype.parse`, `getHostname`,
// `Url.prototype.parseHost`, `autoEscapeStr` and their module-level tables - so
// parsing emits no deprecation warning (`url.parse()` warns DEP0169 per call
// under `--pending-deprecation`, DEP0170 for a malformed authority) with nothing
// suppressed to achieve it: no process-global warning state is touched here, so
// an `url.parse()` elsewhere in the process still reports both.
//
// CALLER CONTRACT
// `parseLegacy` is not a validator, and no caller treats it as one:
//   * It never returns null and never resolves against a base. A relative
//     ('x'), root-relative ('/x') or protocol-relative ('//h/x') input yields a
//     *partial object* whose `protocol` is null, and callers read `.protocol`
//     and `.pathname` off it with no null check - so a null return would turn a
//     redirect into a 500, and a base would give those inputs a protocol and
//     stop the guard that rejects relative URLs from rejecting anything.
//   * `path` carries the query string and `pathname` does not, and
//     `users.assetUploadFromURL` derives the stored upload filename with
//     `path.basename(requestUrl.path)`, so a query-bearing source URL puts
//     '?v=2' into the stored object name. The query must not be stripped here.
//   * It throws for a narrow set of malformed authorities and for non-string
//     input, and nothing here catches, translates or defaults either throw:
//     each has to reach the error handler the calling code already reaches -
//     the promise `.catch` in `trinket.downloadFile`, the route handler
//     catch-all for the synchronous sites, an unsettled deferred in the worker.
//
// Consumers, named by symbol because a line number written here goes stale:
// `users.assetUploadFromURL` reads `protocol` twice - the reject guard and the
// http/https transport gate - and `path` for the upload filename;
// `trinket.downloadFile`, `trinket.downloadPostedZip`, the module-private
// `downloadZip`, `exports.downloadAsset` and `exports.addTrinketToArchive` each
// read `pathname` and hand it to `path.basename`.
//
// FIELD BEHAVIOUR
// The legacy semantics implemented here, idiosyncrasies included:
//   'https://h/x?v=2'      -> protocol 'https:' pathname '/x'    path '/x?v=2'
//   '//h/x'                -> protocol null     pathname '//h/x' path '//h/x'
//   '/x' and 'x'           -> protocol null     pathname and path as given
//   '' / '?v=2'            -> pathname null     path null / '?v=2'
//   'https://h/a.png#frag' -> path '/a.png'         (the hash is not on `path`)
//   'https://h/a%20b.png'  -> pathname '/a%20b.png' (nothing is decoded)
//   'http://host:abc/a'    -> pathname '/:abc/a'    (an unusable port folds in)
//   'https://ho st/a'      -> pathname '%20st/a'    (the host ends at the space)
//   'http://h\\a'          -> pathname '/a'         (a backslash becomes '/')
//   'https://h/x\ty'       -> pathname '/x%09y'     (a tab is escaped)
//
// It throws `TypeError [ERR_INVALID_URL]` ('Invalid URL') for an unterminated or
// malformed bracketed host ('http://[', 'http://[::1', 'http://[::1]:port/x',
// 'http://[fe80::1%25eth0]/a'), a NUL byte in the authority, an undecodable
// punycode host ('http://xn--a/x') and a host IDNA maps to nothing - and *not*
// for the near neighbours 'http://[]/a', 'http://[::1]]/a', 'http://%00/a',
// 'http://a..b/x' or 'http://999.999.999.999/a'. A non-string input throws
// ERR_INVALID_ARG_TYPE.
//
// `url.domainToASCII` is no substitute for the IDNA step: it is the WHATWG host
// parser, so it canonicalises IPv4-shaped hosts ('0x7f.1' -> '127.0.0.1'),
// rejects others outright ('999.999.999.999', which must not throw here),
// percent-decodes its input and rejects C0 controls and DEL that legacy IDNA
// keeps. `toASCII()` below rebuilds the legacy behaviour from it with four
// corrections, each documented where it is applied.
//
// MAINTENANCE
// This is one runtime's algorithm - the Node version `.nvmrc` and the `engines`
// field pin. A newer runtime can change legacy parsing (DEP0170 exists because
// the unusable-port leniency is meant to become an error), and this copy would
// then be the older behaviour without saying so. The `parseLegacy` oracle matrix
// in test/lib/api/trinket.js holds it to the running runtime's own `url.parse`
// over the twelve legacy fields and the error identity, so a runtime whose
// algorithm has changed fails that suite; re-derive the file from its `url` source then.

var nodeUrl       = require('url'),
    Url           = nodeUrl.Url,
    domainToASCII = nodeUrl.domainToASCII,
    querystring   = require('querystring'),
    util          = require('util');

// The three runtime exports this module is built on. Asserted at load time so
// a runtime that stopped providing one fails once, with a precise message,
// instead of once per request with an opaque one.
if (typeof Url !== 'function') {
  throw new Error('lib/util/url.js: the Node "url" module does not export the "Url" constructor, so legacy URL parsing is unavailable on this runtime');
}
if (typeof Url.prototype.format !== 'function') {
  throw new Error('lib/util/url.js: "url.Url.prototype.format" is missing, so the legacy "href" field cannot be reconstructed on this runtime');
}
if (typeof domainToASCII !== 'function') {
  throw new Error('lib/util/url.js: the Node "url" module does not export "domainToASCII", so legacy IDNA host handling is unavailable on this runtime');
}

// --------------------------------------------------------------------------
// Transcribed module-level tables and patterns (node:url, Node 22.23.2).
// Reference: RFC 3986, RFC 1808, RFC 2396.
// --------------------------------------------------------------------------

var protocolPattern   = /^[a-z0-9.+-]+:/i,
    portPattern       = /:[0-9]*$/,
    hostPattern       = /^\/\/[^@/]+@[^@/]+/,
    // Special case for a simple path URL.
    simplePathPattern = /^(\/\/?(?!\/)[^?\s]*)(\?[^\s]*)?$/,
    hostnameMaxLen    = 255;

// The character codes the parser switches on. Node reads these from
// `internal/constants`, which is not requirable, so they are inlined with the
// values that module defines.
var CHAR_TAB                      = 9,     /* \t */
    CHAR_LINE_FEED                = 10,    /* \n */
    CHAR_CARRIAGE_RETURN          = 13,    /* \r */
    CHAR_SPACE                    = 32,    /*   */
    CHAR_DOUBLE_QUOTE             = 34,    /* " */
    CHAR_HASH                     = 35,    /* # */
    CHAR_PERCENT                  = 37,    /* % */
    CHAR_SINGLE_QUOTE             = 39,    /* ' */
    CHAR_FORWARD_SLASH            = 47,    /* / */
    CHAR_COLON                    = 58,    /* : */
    CHAR_SEMICOLON                = 59,    /* ; */
    CHAR_LEFT_ANGLE_BRACKET       = 60,    /* < */
    CHAR_RIGHT_ANGLE_BRACKET      = 62,    /* > */
    CHAR_QUESTION_MARK            = 63,    /* ? */
    CHAR_AT                       = 64,    /* @ */
    CHAR_LEFT_SQUARE_BRACKET      = 91,    /* [ */
    CHAR_BACKWARD_SLASH           = 92,    /* \ */
    CHAR_RIGHT_SQUARE_BRACKET     = 93,    /* ] */
    CHAR_CIRCUMFLEX_ACCENT        = 94,    /* ^ */
    CHAR_GRAVE_ACCENT             = 96,    /* ` */
    CHAR_LEFT_CURLY_BRACKET       = 123,   /* { */
    CHAR_VERTICAL_LINE            = 124,   /* | */
    CHAR_RIGHT_CURLY_BRACKET      = 125,   /* } */
    CHAR_NO_BREAK_SPACE           = 160,   /* \u00A0 */
    CHAR_ZERO_WIDTH_NOBREAK_SPACE = 65279; /* \uFEFF */

// Protocols that can allow "unsafe" and "unwise" chars; protocols that never
// have a hostname; protocols that always contain a '//' bit. Node holds these
// as sets in `internal/url` carrying both the bare and the colon-suffixed
// spelling of each protocol, because the parser looks them up both ways -
// once with the lower-cased protocol and once with the protocol exactly as it
// was written. Both spellings are kept here for that reason.
var unsafeProtocol   = { 'javascript' : true, 'javascript:' : true },
    hostlessProtocol = { 'javascript' : true, 'javascript:' : true },
    slashedProtocol  = {
      'http'   : true, 'http:'   : true,
      'https'  : true, 'https:'  : true,
      'ftp'    : true, 'ftp:'    : true,
      'gopher' : true, 'gopher:' : true,
      'file'   : true, 'file:'   : true,
      'ws'     : true, 'ws:'     : true,
      'wss'    : true, 'wss:'    : true
    };

// This prevents some common spoofing bugs due to the use of IDNA toASCII. The
// set of characters is the intersection of "forbidden host code point" in the
// WHATWG URL Standard and the characters in the host parsing loop below, plus
// ':' (protocol spoofing), '@' (auth confusion) and '[' / ']' (a non-IPv6
// hostname being read as IPv6).
var forbiddenHostChars     = /[\0\t\n\r #%/:<>?@[\\\]^|]/,
    // For IPv6, permit '[', ']' and ':'.
    forbiddenHostCharsIpv6 = /[\0\t\n\r #%/<>?@\\^|]/;

// Escaped characters. Empty strings fill up the unused entries; an array
// lookup is faster than an object or a Map.
var escapedCodes = [
  /* 0 - 9 */ '', '', '', '', '', '', '', '', '', '%09',
  /* 10 - 19 */ '%0A', '', '', '%0D', '', '', '', '', '', '',
  /* 20 - 29 */ '', '', '', '', '', '', '', '', '', '',
  /* 30 - 39 */ '', '', '%20', '', '%22', '', '', '', '', '%27',
  /* 40 - 49 */ '', '', '', '', '', '', '', '', '', '',
  /* 50 - 59 */ '', '', '', '', '', '', '', '', '', '',
  /* 60 - 69 */ '%3C', '', '%3E', '', '', '', '', '', '', '',
  /* 70 - 79 */ '', '', '', '', '', '', '', '', '', '',
  /* 80 - 89 */ '', '', '', '', '', '', '', '', '', '',
  /* 90 - 99 */ '', '', '%5C', '', '%5E', '', '%60', '', '', '',
  /* 100 - 109 */ '', '', '', '', '', '', '', '', '', '',
  /* 110 - 119 */ '', '', '', '', '', '', '', '', '', '',
  /* 120 - 125 */ '', '', '', '%7B', '%7C', '%7D'
];

// --------------------------------------------------------------------------
// Error construction, matching the shape of Node's own errors.
// --------------------------------------------------------------------------

/**
 * Builds the prototype for one Node-style error code.
 *
 * Node's error classes extend the base error type, override `toString()` to
 * include the code, and expose a `constructor` accessor that still reports the
 * base type - so `err instanceof TypeError`, `err.constructor === TypeError`
 * and `err.name === 'TypeError'` all hold while `String(err)` names the code.
 * Reproducing that here is what makes these errors indistinguishable from the
 * ones `url.parse()` throws, which matters because they travel through error
 * funnels that log `String(err)` and inspect the object.
 *
 * @param {string} code - the Node error code, e.g. 'ERR_INVALID_URL'
 * @returns {Object} the prototype to install on errors carrying that code
 */
function nodeErrorPrototype(code) {
  return Object.create(TypeError.prototype, {
    constructor : {
      get          : function () { return TypeError; },
      configurable : true
    },
    toString : {
      value        : function () { return this.name + ' [' + code + ']: ' + this.message; },
      writable     : true,
      configurable : true
    }
  });
}

var invalidUrlPrototype     = nodeErrorPrototype('ERR_INVALID_URL'),
    invalidArgTypePrototype = nodeErrorPrototype('ERR_INVALID_ARG_TYPE');

/**
 * Finishes a Node-style error: defines the non-enumerable `message` the way
 * Node does, then materialises the stack while `name` temporarily carries the
 * code and removes that own `name` again. Node performs the same two steps
 * (`internal/errors.js`, `addCodeToName`), which is why its stack header reads
 * 'TypeError [ERR_INVALID_URL]: Invalid URL' even though `err.name` is plain
 * 'TypeError'.
 *
 * @param {Error} err - the error under construction
 * @param {string} code - its Node error code
 * @param {string} message - its message
 * @returns {Error} the same error, ready to throw
 */
function finishNodeError(err, code, message) {
  Object.defineProperty(err, 'message', {
    value        : message,
    enumerable   : false,
    writable     : true,
    configurable : true
  });

  err.name = 'TypeError [' + code + ']';
  // Reading the accessor is what formats and caches the header; `void` makes
  // the discard explicit.
  void err.stack;
  delete err.name;

  return err;
}

/**
 * The error `url.parse()` throws for a malformed authority.
 *
 * @param {string} input - the URL string as it was passed in
 * @returns {TypeError} a TypeError with code 'ERR_INVALID_URL'
 */
function invalidUrlError(input) {
  var err = new TypeError();

  // Own-property order is visible when an error is inspected or logged, and
  // Node's error classes produce `code`, then `input`, then a non-enumerable
  // `message`, so the three are established here in that order.
  Object.setPrototypeOf(err, invalidUrlPrototype);
  err.code = 'ERR_INVALID_URL';
  err.input = input;

  return finishNodeError(err, 'ERR_INVALID_URL', 'Invalid URL');
}

/**
 * Node's `determineSpecificType`, transcribed from `internal/errors.js`. It
 * produces the 'Received ...' tail of an ERR_INVALID_ARG_TYPE message, and it
 * is transcribed rather than approximated because the tail differs per input
 * type: 'type number (42)', 'null', 'undefined', 'an instance of Object',
 * 'type boolean (true)', 'type symbol (Symbol(x))', 'type bigint (1n)'.
 *
 * @param {*} value - the rejected value
 * @returns {string} the description Node would produce for it
 */
function determineSpecificType(value) {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }

  var type = typeof value,
      inspected;

  switch (type) {
    case 'bigint':
      return 'type bigint (' + value + 'n)';
    case 'number':
      if (value === 0) {
        return 1 / value === -Infinity ? 'type number (-0)' : 'type number (0)';
      }
      if (value !== value) {
        return 'type number (NaN)';
      }
      if (value === Infinity) {
        return 'type number (Infinity)';
      }
      if (value === -Infinity) {
        return 'type number (-Infinity)';
      }
      return 'type number (' + value + ')';
    case 'boolean':
      return value ? 'type boolean (true)' : 'type boolean (false)';
    case 'symbol':
      return 'type symbol (' + String(value) + ')';
    case 'function':
      return 'function ' + value.name;
    case 'object':
      if (value.constructor && 'name' in value.constructor) {
        return 'an instance of ' + value.constructor.name;
      }
      return util.inspect(value, { depth : -1 });
    case 'string':
      if (value.length > 28) {
        value = value.slice(0, 25) + '...';
      }
      if (value.indexOf('\'') === -1) {
        return 'type string (\'' + value + '\')';
      }
      return 'type string (' + JSON.stringify(value) + ')';
    default:
      inspected = util.inspect(value, { colors : false });
      if (inspected.length > 28) {
        inspected = inspected.slice(0, 25) + '...';
      }
      return 'type ' + type + ' (' + inspected + ')';
  }
}

/**
 * The error Node's `validateString(url, 'url')` throws for a non-string input,
 * which is the first thing `url.parse()` does.
 *
 * @param {string} name - the argument name, always 'url' here
 * @param {string} expectedType - the required primitive type, always 'string'
 * @param {*} actual - the value that was passed instead
 * @returns {TypeError} a TypeError with code 'ERR_INVALID_ARG_TYPE'
 */
function invalidArgTypeError(name, expectedType, actual) {
  var err = new TypeError();

  Object.setPrototypeOf(err, invalidArgTypePrototype);
  err.code = 'ERR_INVALID_ARG_TYPE';

  return finishNodeError(
    err,
    'ERR_INVALID_ARG_TYPE',
    'The "' + name + '" argument must be of type ' + expectedType + '. Received ' + determineSpecificType(actual)
  );
}

// --------------------------------------------------------------------------
// IDNA: the legacy `toASCII`, reconstructed from `url.domainToASCII`.
// --------------------------------------------------------------------------

// A label that already carries the ACE prefix has to be punycode-decoded and
// re-validated, so it is not an identity case however plain it looks.
var acePrefixedLabel = /(^|\.)xn--/i,
    aceLabel         = /^xn--/i,
    nonAsciiChar     = /[^\x00-\x7f]/,
    // The code points the WHATWG host parser refuses in its ASCII output, or
    // transforms, while legacy IDNA leaves them alone: the C0 controls other
    // than NUL, TAB, LF and CR, DEL, and '%' (which WHATWG percent-decodes).
    // NUL and the three whitespace controls are deliberately not in this set:
    // TAB, LF and CR are removed from the authority before IDNA runs, and NUL
    // is in `forbiddenHostChars`, so each of them throws either way.
    whatwgOnlyForbidden = /[\x01-\x08\x0b\x0c\x0e-\x1f\x7f%]/,
    // The same set, for a whole-label substitution rather than a per-character
    // test. Held as its own constant because a `RegExp` carrying the `g` flag
    // is stateful, and because rebuilding one per call would be waste.
    whatwgOnlyForbiddenAll = /[\x01-\x08\x0b\x0c\x0e-\x1f\x7f%]/g,
    // Those of the masked code points that UTS #46's CheckBidi refuses inside
    // a right-to-left label whatever their position: the C0 separators, of
    // Unicode bidi class S, WS and B. The rest of the masked set is class BN
    // or ET, which CheckBidi permits in the same position a placeholder of
    // class ON is permitted, so only these six need separate treatment.
    rtlDisallowedMasked = /[\x0b\x0c\x1c-\x1f]/,
    // A label that cannot appear last in an IPv4-shaped host, appended so the
    // WHATWG "ends in a number" test never fires.
    ipv4Sentinel = '.q',
    // Appended to a label to ask IDNA whether that label is right-to-left:
    // '-' is bidi class ES, which CheckBidi refuses as the final character of
    // an RTL label and does not examine at all in an LTR one.
    rtlProbeSuffix = '-',
    // Two distinct placeholders per attempt, both bidi class ON. ON is what
    // makes the substitution faithful: CheckBidi treats it exactly as it
    // treats the class BN and ET code points being masked - permitted inside
    // a label, refused as its final character - while a letter (class L) or a
    // digit (class EN) would change the verdict, a digit additionally by
    // colliding with the rule that an RTL label may not mix EN and AN. None of
    // these characters takes part in a canonical composition, so masking
    // cannot change how the surrounding string normalises.
    maskPairs = [['!', '&'], ['(', ')'], ['*', '~']];

/**
 * Runs `domainToASCII` with the IPv4 sentinel appended and strips it again.
 *
 * The sentinel is what removes the largest class of divergence between the
 * WHATWG entry point and legacy IDNA. WHATWG runs its IPv4 parser whenever the
 * last label of a domain "ends in a number", which rewrites '0x7f.1' to
 * '127.0.0.1' and rejects '999.999.999.999' outright, where legacy IDNA passes
 * both through untouched. A trailing 'q' label is never a number, so that
 * branch cannot be taken; 'q' is an unmapped valid ASCII label, so it adds
 * nothing else.
 *
 * @param {string} domain - the host to run IDNA over
 * @returns {string} the ASCII form, or '' for an IDNA failure
 */
function idnaWithSentinel(domain) {
  var out = domainToASCII(domain + ipv4Sentinel);

  if (out === '' || out.slice(out.length - ipv4Sentinel.length) !== ipv4Sentinel) {
    return '';
  }
  return out.slice(0, out.length - ipv4Sentinel.length);
}

/**
 * Runs IDNA over a host containing code points the WHATWG entry point would
 * reject or rewrite, by masking each of them with a placeholder and putting
 * them back afterwards.
 *
 * Masking is exact rather than approximate, and the reason is punycode's
 * shape: an encoded label is its basic (ASCII) code points in their original
 * order, then a delimiter, then a delta encoding of the non-basic ones. The
 * deltas depend only on the positions and count of the basic code points, so
 * substituting one basic code point for another leaves them identical and
 * changes exactly one character of the output. Running the same host twice
 * with two different placeholders therefore produces two strings that differ
 * at precisely the placeholder positions, in order - which is how the original
 * code points are located and restored without assuming anything about where
 * IDNA moved them.
 *
 * The reconstruction is verified rather than assumed - equal lengths, exactly
 * as many differing positions as masked code points, both placeholders at
 * those positions - and a host that no placeholder pair reconciles is reported
 * as an IDNA failure, the disposition the WHATWG entry point gives it anyway.
 *
 * @param {string} domain - the host to run IDNA over
 * @param {number[]} positions - indices of the code points to mask
 * @returns {string} the ASCII form with the masked code points restored, or ''
 */
function idnaWithMask(domain, positions) {
  var pair, first, second, differing, chars, i, k;

  // Taken before the masked runs, because a placeholder cannot carry it: the
  // six C0 separators in the masked set are refused outright inside an RTL
  // label, and the class ON placeholder that stands in for them is not.
  if (rejectedByRtlSeparatorRule(domain)) {
    return '';
  }

  for (k = 0; k < maskPairs.length; ++k) {
    pair = maskPairs[k];
    first = idnaWithSentinel(maskDomain(domain, positions, pair[0]));
    second = idnaWithSentinel(maskDomain(domain, positions, pair[1]));

    // Both empty is a real IDNA failure - an undecodable ACE label, say - and
    // masking cannot change that, so it is reported rather than retried.
    if (first === '' && second === '') {
      return '';
    }
    if (first === '' || second === '' || first.length !== second.length) {
      continue;
    }

    differing = [];
    for (i = 0; i < first.length; ++i) {
      if (first.charAt(i) !== second.charAt(i)) {
        differing.push(i);
      }
    }
    if (differing.length !== positions.length) {
      continue;
    }

    chars = first.split('');
    for (i = 0; i < differing.length; ++i) {
      if (first.charAt(differing[i]) !== pair[0] || second.charAt(differing[i]) !== pair[1]) {
        chars = null;
        break;
      }
      chars[differing[i]] = domain.charAt(positions[i]);
    }
    if (chars) {
      return chars.join('');
    }
  }

  return '';
}

/**
 * Splits a host into the labels IDNA will see.
 *
 * '.' is not the only label separator: UTS #46 maps several characters onto
 * one - the ideographic and fullwidth full stops among them, and a handful of
 * compatibility characters that map to a dot or to a run of them - so a naive
 * `split('.')` puts 'a\u3002b' in one label where IDNA sees two. The set is
 * part of the mapping table rather than something worth restating here, so
 * each non-ASCII character is asked directly: IDNA is run over 'a<ch>b' and
 * the character is a separator exactly when the answer comes back in more
 * parts than it went in. Only ASCII '.' separates among ASCII characters,
 * which is checked without a probe.
 *
 * @param {string} domain - the host to split
 * @returns {string[]} its labels, in order, possibly including empty ones
 */
function splitIntoIdnaLabels(domain) {
  var separators = {},
      labels = [],
      current = '',
      probe, ch, i;

  for (i = 0; i < domain.length; ++i) {
    ch = domain.charAt(i);

    if (ch > '\u007f' && !Object.prototype.hasOwnProperty.call(separators, ch)) {
      probe = domainToASCII('a' + ch + 'b' + ipv4Sentinel);
      separators[ch] = probe !== '' && probe.split('.').length > 2;
    }

    if (ch === '.' || separators[ch] === true) {
      labels.push(current);
      current = '';
    }
    else {
      current += ch;
    }
  }
  labels.push(current);

  return labels;
}

/**
 * Reports whether IDNA rejects `domain` because one of its right-to-left
 * labels contains a C0 separator.
 *
 * UTS #46's CheckBidi refuses bidi class S, WS and B - which is what the six
 * C0 separators \x0b, \x0c and \x1c-\x1f are - anywhere inside a label whose
 * direction is right-to-left, and does not examine a left-to-right label at
 * all. Masking cannot reproduce that: no ASCII code point the WHATWG entry
 * point accepts carries one of those three classes, and a class L placeholder
 * would also move the label's direction when it precedes the first strong
 * character. So the verdict is taken directly instead, one label at a time.
 *
 * The direction of a label is established by asking IDNA rather than by
 * carrying a Unicode bidi table: appending '-' to a label makes it end in
 * class ES, which CheckBidi refuses for an RTL label and ignores for an LTR
 * one. The unsuffixed label is checked first, so that a label which is invalid
 * for some unrelated reason is not mistaken for a right-to-left one; such a
 * label fails the masked runs on its own account. An ACE label is decoded
 * first, because its direction is that of the content it encodes and
 * appending to the encoded form would merely invalidate the punycode.
 *
 * @param {string} domain - the unmasked host
 * @returns {boolean} true when IDNA rejects the host for this reason
 */
function rejectedByRtlSeparatorRule(domain) {
  var labels, subject, decoded, i;

  // Nothing to decide unless one of the six is actually present, and the
  // label-splitting below probes IDNA per character, so this guard is what
  // keeps an ordinary internationalised host off that path entirely.
  if (!rtlDisallowedMasked.test(domain)) {
    return false;
  }

  labels = splitIntoIdnaLabels(domain);

  for (i = 0; i < labels.length; ++i) {
    if (!rtlDisallowedMasked.test(labels[i])) {
      continue;
    }

    subject = labels[i].replace(whatwgOnlyForbiddenAll, maskPairs[0][0]);
    if (aceLabel.test(subject)) {
      decoded = nodeUrl.domainToUnicode(subject);
      // An ACE label that will not decode is invalid however it is read, so it
      // is reported here rather than probed.
      if (decoded === '') {
        return true;
      }
      subject = decoded;
    }

    if (domainToASCII(subject + ipv4Sentinel) !== '' &&
        domainToASCII(subject + rtlProbeSuffix + ipv4Sentinel) === '') {
      return true;
    }
  }

  return false;
}

/**
 * Replaces the code points at `positions` with a single placeholder character.
 *
 * @param {string} domain - the host
 * @param {number[]} positions - indices to replace
 * @param {string} placeholder - the one-character replacement
 * @returns {string} the masked host, the same length as the original
 */
function maskDomain(domain, positions, placeholder) {
  var chars = domain.split(''),
      i;

  for (i = 0; i < positions.length; ++i) {
    chars[positions[i]] = placeholder;
  }
  return chars.join('');
}

/**
 * The IDNA step of the legacy parser: `toASCII(hostname)`.
 *
 * Node calls an internal binding here that application code cannot require,
 * so this reconstructs it from the public `url.domainToASCII` in three paths:
 *
 *   * A host that is entirely ASCII and carries no 'xn--' label is returned as
 *     it stands, lower-cased. That is the identity, not a shortcut: UTS #46
 *     with UseSTD3ASCIIRules disabled - the configuration legacy parsing uses
 *     - maps every ASCII code point to itself apart from the upper-case
 *     letters, and only an ACE label needs decoding and re-validation. This
 *     path is what keeps '999.999.999.999', '0x7f.1', 'a..b', 'a\x01b' and
 *     every other shape the WHATWG parser rewrites or rejects passing through
 *     untouched.
 *   * A host that genuinely needs IDNA - non-ASCII, or an ACE label - and
 *     carries none of the code points WHATWG treats differently goes straight
 *     through `domainToASCII` behind the IPv4 sentinel.
 *   * A host that needs IDNA and does carry one of them goes through the same
 *     call with those code points masked out and restored afterwards.
 *
 * @param {string} hostname - the lower-cased hostname, never empty
 * @returns {string} its ASCII form, or '' when IDNA fails
 */
function toASCII(hostname) {
  var positions = [],
      i;

  if (!nonAsciiChar.test(hostname) && !acePrefixedLabel.test(hostname)) {
    // An all-ASCII string, so `toLowerCase` is exactly the ASCII case mapping.
    return hostname.toLowerCase();
  }

  for (i = 0; i < hostname.length; ++i) {
    if (whatwgOnlyForbidden.test(hostname.charAt(i))) {
      positions.push(i);
    }
  }

  return positions.length === 0 ? idnaWithSentinel(hostname) : idnaWithMask(hostname, positions);
}

// --------------------------------------------------------------------------
// The transcribed parser.
// --------------------------------------------------------------------------

/**
 * Node's `isIpv6Hostname`: a hostname that begins with '[' and ends with ']'
 * is assumed to be an IPv6 address.
 *
 * @param {string} hostname - the hostname to test
 * @returns {boolean} true when it is bracketed
 */
function isIpv6Hostname(hostname) {
  return hostname.charCodeAt(0) === CHAR_LEFT_SQUARE_BRACKET &&
         hostname.charCodeAt(hostname.length - 1) === CHAR_RIGHT_SQUARE_BRACKET;
}

/**
 * Set membership for the three protocol tables, which Node holds as sets and
 * this file holds as plain objects. `hasOwnProperty` is used rather than a
 * property read so that a protocol spelled like an `Object.prototype` member
 * cannot match, and a non-string protocol - `lowerProto` is undefined for a
 * URL with no scheme - is rejected before the lookup.
 *
 * @param {Object} set - one of the protocol tables
 * @param {*} protocol - the protocol to look up, with or without its colon
 * @returns {boolean} true when the table contains it
 */
function inProtocolSet(set, protocol) {
  return typeof protocol === 'string' && Object.prototype.hasOwnProperty.call(set, protocol);
}

/**
 * Node's `getHostname`, and the one function DEP0170 comes out of.
 *
 * The loop stops at the first character that cannot appear in a hostname; the
 * hostname is truncated before it and the remainder is folded into the path,
 * which is why 'http://host:abc/a' has the pathname '/:abc/a'. A colon there
 * is the unusable-port leniency Node warns about, and this function carries no
 * warning call, so parsing never spends the process-wide one-shot DEP0170 flag
 * and an `url.parse()` elsewhere in the process still reports it.
 *
 * @param {Url} self - the URL object being populated
 * @param {string} rest - the post-authority remainder of the input
 * @param {string} hostname - the hostname as parsed so far
 * @returns {string} `rest`, with any folded-in hostname remainder prepended
 */
function getHostname(self, rest, hostname) {
  var i, code, isValid;

  for (i = 0; i < hostname.length; ++i) {
    code = hostname.charCodeAt(i);
    isValid = code !== CHAR_FORWARD_SLASH &&
              code !== CHAR_BACKWARD_SLASH &&
              code !== CHAR_HASH &&
              code !== CHAR_QUESTION_MARK &&
              code !== CHAR_COLON;

    if (!isValid) {
      self.hostname = hostname.slice(0, i);
      return '/' + hostname.slice(i) + rest;
    }
  }
  return rest;
}

/**
 * Node's `Url.prototype.parseHost`: splits a trailing ':port' off `host`.
 *
 * A bare ':' sets no port and is dropped from the host, which is why
 * 'http://h:/a' has a null port, the host 'h' and the href 'http://h/a'.
 *
 * @param {Url} self - the URL object being populated
 * @returns {undefined} nothing; `self` is mutated in place
 */
function parseHost(self) {
  var host = self.host,
      port = portPattern.exec(host);

  if (port) {
    port = port[0];
    if (port !== ':') {
      self.port = port.slice(1);
    }
    host = host.slice(0, host.length - port.length);
  }
  if (host) {
    self.hostname = host;
  }
}

/**
 * Node's `autoEscapeStr`: escapes every delimiter and unwise character from
 * RFC 2396, plus the single quote, whether or not `encodeURIComponent` thinks
 * they need escaping. This is what turns a tab in a path into '%09'.
 *
 * @param {string} rest - the post-authority remainder
 * @returns {string} the same string with those characters escaped
 */
function autoEscapeStr(rest) {
  var escaped = '',
      lastEscapedPos = 0,
      escapedChar,
      i;

  for (i = 0; i < rest.length; ++i) {
    // `escaped` holds the substring up to the last escaped character.
    escapedChar = escapedCodes[rest.charCodeAt(i)];
    if (escapedChar) {
      // Concatenate the ordinary characters in between.
      if (i > lastEscapedPos) {
        escaped += rest.slice(lastEscapedPos, i);
      }
      escaped += escapedChar;
      lastEscapedPos = i + 1;
    }
  }
  if (lastEscapedPos === 0) {
    // Nothing has been escaped.
    return rest;
  }
  if (lastEscapedPos < rest.length) {
    // There are ordinary characters at the end.
    escaped += rest.slice(lastEscapedPos);
  }
  return escaped;
}

/**
 * Node's `Url.prototype.parse`, transcribed onto an explicit target object.
 *
 * Every branch, comparison and slice below is the runtime's own, including the
 * ones that look like defects: the whitespace trim that treats every code
 * point under 33 as whitespace, the backslash-to-slash conversion copied from
 * Chrome, the fast path that returns a simple path without ever looking for a
 * protocol, the asymmetric protocol lookups - `slashedProtocol` is consulted
 * once with the protocol exactly as written and once lower-cased - and the
 * `typeof this.hostname !== 'string'` guard that makes an empty authority
 * present rather than absent.
 *
 * @param {Url} self - a fresh `Url` instance to populate
 * @param {string} url - the URL to parse
 * @param {boolean} [parseQueryString] - parse `query` into an object
 * @param {boolean} [slashesDenoteHost] - treat a leading '//' as an authority
 * @returns {Url} `self`, fully populated
 */
function parseInto(self, url, parseQueryString, slashesDenoteHost) {
  if (typeof url !== 'string') {
    throw invalidArgTypeError('url', 'string', url);
  }

  // Copy chrome, IE, opera backslash-handling behavior: back slashes before
  // the query string get converted to forward slashes.
  var hasHash = false,
      hasAt = false,
      start = -1,
      end = -1,
      rest = '',
      lastPos = 0,
      inWs = false,
      split = false,
      i, code, isWs, simplePath, proto, lowerProto, slashes,
      hostEnd, atSign, nonHost, hostname, ipv6Hostname,
      questionIdx, hashIdx, useQuestionIdx, firstIdx, port, host, pathname, search;

  for (i = 0; i < url.length; ++i) {
    code = url.charCodeAt(i);

    // Find first and last non-whitespace characters for trimming.
    isWs = code < 33 ||
           code === CHAR_NO_BREAK_SPACE ||
           code === CHAR_ZERO_WIDTH_NOBREAK_SPACE;
    if (start === -1) {
      if (isWs) {
        continue;
      }
      lastPos = start = i;
    }
    else if (inWs) {
      if (!isWs) {
        end = -1;
        inWs = false;
      }
    }
    else if (isWs) {
      end = i;
      inWs = true;
    }

    // Only convert backslashes while we haven't seen a split character.
    if (!split) {
      switch (code) {
        case CHAR_AT:
          hasAt = true;
          break;
        case CHAR_HASH:
          hasHash = true;
          /* falls through */
        case CHAR_QUESTION_MARK:
          split = true;
          break;
        case CHAR_BACKWARD_SLASH:
          if (i - lastPos > 0) {
            rest += url.slice(lastPos, i);
          }
          rest += '/';
          lastPos = i + 1;
          break;
      }
    }
    else if (!hasHash && code === CHAR_HASH) {
      hasHash = true;
    }
  }

  // Check if string was non-empty (including strings with only whitespace).
  if (start !== -1) {
    if (lastPos === start) {
      // We didn't convert any backslashes.
      if (end === -1) {
        if (start === 0) {
          rest = url;
        }
        else {
          rest = url.slice(start);
        }
      }
      else {
        rest = url.slice(start, end);
      }
    }
    else if (end === -1 && lastPos < url.length) {
      // We converted some backslashes and have only part of the entire string.
      rest += url.slice(lastPos);
    }
    else if (end !== -1 && lastPos < end) {
      // We converted some backslashes and have only part of the entire string.
      rest += url.slice(lastPos, end);
    }
  }

  if (!slashesDenoteHost && !hasHash && !hasAt) {
    // Try fast path regexp.
    simplePath = simplePathPattern.exec(rest);
    if (simplePath) {
      self.path = rest;
      self.href = rest;
      self.pathname = simplePath[1];
      if (simplePath[2]) {
        self.search = simplePath[2];
        if (parseQueryString) {
          self.query = querystring.parse(self.search.slice(1));
        }
        else {
          self.query = self.search.slice(1);
        }
      }
      else if (parseQueryString) {
        self.search = null;
        self.query = Object.create(null);
      }
      return self;
    }
  }

  proto = protocolPattern.exec(rest);
  if (proto) {
    proto = proto[0];
    lowerProto = proto.toLowerCase();
    self.protocol = lowerProto;
    rest = rest.slice(proto.length);
  }

  // Figure out if it's got a host. user@server is *always* interpreted as a
  // hostname, and url resolution will treat //foo/bar as host=foo,path=bar
  // because that's how the browser resolves relative URLs.
  if (slashesDenoteHost || proto || hostPattern.test(rest)) {
    slashes = rest.charCodeAt(0) === CHAR_FORWARD_SLASH &&
              rest.charCodeAt(1) === CHAR_FORWARD_SLASH;
    if (slashes && !(proto && inProtocolSet(hostlessProtocol, lowerProto))) {
      rest = rest.slice(2);
      self.slashes = true;
    }
  }

  if (!inProtocolSet(hostlessProtocol, lowerProto) &&
      (slashes || (proto && !inProtocolSet(slashedProtocol, proto)))) {

    // There's a hostname. The first instance of /, ?, ; or # ends the host.
    //
    // If there is an @ in the hostname, then non-host chars *are* allowed to
    // the left of the last @ sign, unless some host-ending character comes
    // *before* the @-sign. URLs are obnoxious.
    //
    // ex:
    // http://a@b@c/ => user:a@b host:c
    // http://a@b?@c => user:a host:b path:/?@c
    hostEnd = -1;
    atSign = -1;
    nonHost = -1;
    for (i = 0; i < rest.length; ++i) {
      switch (rest.charCodeAt(i)) {
        case CHAR_TAB:
        case CHAR_LINE_FEED:
        case CHAR_CARRIAGE_RETURN:
          // WHATWG URL removes tabs, newlines and carriage returns; do that too.
          rest = rest.slice(0, i) + rest.slice(i + 1);
          i -= 1;
          break;
        case CHAR_SPACE:
        case CHAR_DOUBLE_QUOTE:
        case CHAR_PERCENT:
        case CHAR_SINGLE_QUOTE:
        case CHAR_SEMICOLON:
        case CHAR_LEFT_ANGLE_BRACKET:
        case CHAR_RIGHT_ANGLE_BRACKET:
        case CHAR_BACKWARD_SLASH:
        case CHAR_CIRCUMFLEX_ACCENT:
        case CHAR_GRAVE_ACCENT:
        case CHAR_LEFT_CURLY_BRACKET:
        case CHAR_VERTICAL_LINE:
        case CHAR_RIGHT_CURLY_BRACKET:
          // Characters that are never ever allowed in a hostname from RFC 2396.
          if (nonHost === -1) {
            nonHost = i;
          }
          break;
        case CHAR_HASH:
        case CHAR_FORWARD_SLASH:
        case CHAR_QUESTION_MARK:
          // Find the first instance of any host-ending characters.
          if (nonHost === -1) {
            nonHost = i;
          }
          hostEnd = i;
          break;
        case CHAR_AT:
          // At this point, either we have an explicit point where the auth
          // portion cannot go past, or the last @ char is the decider.
          atSign = i;
          nonHost = -1;
          break;
      }
      if (hostEnd !== -1) {
        break;
      }
    }
    start = 0;
    if (atSign !== -1) {
      // `decodeURIComponent` throws a URIError for a malformed escape here,
      // exactly as it does in the runtime, and that throw propagates.
      self.auth = decodeURIComponent(rest.slice(0, atSign));
      start = atSign + 1;
    }
    if (nonHost === -1) {
      self.host = rest.slice(start);
      rest = '';
    }
    else {
      self.host = rest.slice(start, nonHost);
      rest = rest.slice(nonHost);
    }

    // Pull out port.
    parseHost(self);

    // We've indicated that there is a hostname, so even if it's empty, it has
    // to be present.
    if (typeof self.hostname !== 'string') {
      self.hostname = '';
    }

    hostname = self.hostname;

    // If hostname begins with [ and ends with ], assume it's an IPv6 address.
    ipv6Hostname = isIpv6Hostname(hostname);

    // Validate a little.
    if (!ipv6Hostname) {
      rest = getHostname(self, rest, hostname);
    }

    if (self.hostname.length > hostnameMaxLen) {
      self.hostname = '';
    }
    else {
      // Hostnames are always lower case.
      self.hostname = self.hostname.toLowerCase();
    }

    if (self.hostname !== '') {
      if (ipv6Hostname) {
        if (forbiddenHostCharsIpv6.test(self.hostname)) {
          throw invalidUrlError(url);
        }
      }
      else {
        // IDNA support: a punycoded representation of "domain". It only
        // converts the parts of the domain name that have non-ASCII
        // characters, so it doesn't matter if the domain is already ASCII-only.
        self.hostname = toASCII(self.hostname);

        // Prevent two potential routes of hostname spoofing:
        //   1. an empty hostname must have become empty in toASCII, since it
        //      was checked above;
        //   2. a forbidden character must also have got in through toASCII,
        //      since getHostname would otherwise have filtered it out.
        // Rather than correcting this by moving the non-host part into the
        // pathname as getHostname does, throw, to convey the severity.
        if (self.hostname === '' || forbiddenHostChars.test(self.hostname)) {
          throw invalidUrlError(url);
        }
      }
    }

    port = self.port ? ':' + self.port : '';
    host = self.hostname || '';
    self.host = host + port;

    // Strip [ and ] from the hostname; the host field still retains them.
    if (ipv6Hostname) {
      self.hostname = self.hostname.slice(1, -1);
      if (rest[0] !== '/') {
        rest = '/' + rest;
      }
    }
  }

  // Now rest is set to the post-host stuff. Chop off any delim chars.
  if (!inProtocolSet(unsafeProtocol, lowerProto)) {
    // First, make 100% sure that any "autoEscape" chars get escaped, even if
    // encodeURIComponent doesn't think they need to be.
    rest = autoEscapeStr(rest);
  }

  questionIdx = -1;
  hashIdx = -1;
  for (i = 0; i < rest.length; ++i) {
    code = rest.charCodeAt(i);
    if (code === CHAR_HASH) {
      self.hash = rest.slice(i);
      hashIdx = i;
      break;
    }
    else if (code === CHAR_QUESTION_MARK && questionIdx === -1) {
      questionIdx = i;
    }
  }

  if (questionIdx !== -1) {
    if (hashIdx === -1) {
      self.search = rest.slice(questionIdx);
      self.query = rest.slice(questionIdx + 1);
    }
    else {
      self.search = rest.slice(questionIdx, hashIdx);
      self.query = rest.slice(questionIdx + 1, hashIdx);
    }
    if (parseQueryString) {
      self.query = querystring.parse(self.query);
    }
  }
  else if (parseQueryString) {
    // No query string, but parseQueryString still requested.
    self.search = null;
    self.query = Object.create(null);
  }

  useQuestionIdx = questionIdx !== -1 && (hashIdx === -1 || questionIdx < hashIdx);
  firstIdx = useQuestionIdx ? questionIdx : hashIdx;
  if (firstIdx === -1) {
    if (rest.length > 0) {
      self.pathname = rest;
    }
  }
  else if (firstIdx > 0) {
    self.pathname = rest.slice(0, firstIdx);
  }
  if (inProtocolSet(slashedProtocol, lowerProto) && self.hostname && !self.pathname) {
    self.pathname = '/';
  }

  // To support http.request.
  if (self.pathname || self.search) {
    pathname = self.pathname || '';
    search = self.search || '';
    self.path = pathname + search;
  }

  // Finally, reconstruct the href based on what has been validated. Node ends
  // its parse with `this.href = this.format()`; because `self` is a real `Url`
  // instance, that is the same function running over the same fields.
  self.href = Url.prototype.format.call(self);
  return self;
}

/**
 * parseLegacy(value) - the behaviour of `require('url').parse(value)` without
 * either of that call's deprecation warnings.
 *
 * Returns a `Url` instance carrying the full legacy field set (protocol,
 * slashes, auth, host, port, hostname, hash, search, query, pathname, path,
 * href); the fields the application reads are `protocol`, `pathname` and
 * `path`, where `path` includes the query string. Throws whatever
 * `url.parse()` throws, synchronously and untranslated, so each caller's own
 * error handler is the one that receives it.
 *
 * e.g. parseLegacy('https://host/dir/img.png?v=2').path -> '/dir/img.png?v=2'
 *      parseLegacy('/dir/img.png').protocol             -> null
 *      parseLegacy('http://host:abc/a').pathname        -> '/:abc/a', silently
 *
 * @param {*} value - the URL to parse; a non-string throws ERR_INVALID_ARG_TYPE
 * @returns {Url} the parsed URL, or `value` itself when it is already one
 */
function parseLegacy(value) {
  // An already-parsed input is returned untouched, and that short-circuit sits
  // ahead of the argument-type check because that is where `url.parse()` puts
  // it: a `Url` instance is accepted without ever being validated as a string.
  if (value instanceof Url) {
    return value;
  }

  // One argument only: `parseQueryString` and `slashesDenoteHost` stay unset,
  // which is what keeps `query` a string and makes '//h/x' a path rather than
  // a host.
  return parseInto(new Url(), value);
}

module.exports = {
  parseLegacy : parseLegacy
};
