/**
 * Differential equivalence suite for lib/util/legacyUrl.js.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Two asset-filename call sites were migrated off Node's legacy `url.parse()`: the trinket asset
 * helpers in lib/controllers/trinket.js and `assetPathBasename` in lib/workers/exports.js. At the base
 * commit both spelled the derivation `path.basename(url.parse(x).pathname)`. The migration target the
 * AAP names (implicit requirement I5) is the non-throwing WHATWG `URL.parse()`, but that API is not a
 * drop-in for this expression: for the opaque schemes `mailto:`, `tel:`, `urn:` and `about:` the legacy
 * parser yields a null pathname - so `path.basename()` throws ERR_INVALID_ARG_TYPE - while the WHATWG
 * API yields a non-null opaque path, so `path.basename()` silently returns a different filename. In
 * lib/workers/exports.js both call sites are effectively unguarded and sit in synchronous code reached
 * from a stream 'data' handler, where such a divergence becomes a process-level uncaught exception.
 * lib/util/legacyUrl.js therefore reproduces the legacy pathname derivation exactly.
 *
 * "Exactly" is a claim, and claims in this migration are measured rather than asserted. This suite is
 * that measurement: it rebuilds the whole differential corpus on every test run and compares the helper
 * against `require('url').parse()` itself - the real legacy parser, used as the oracle. A single
 * divergence in the derived pathname, in `path.basename()` of that pathname, or in the identity of a
 * thrown error (name, code and message) fails the suite. Each test also asserts its own corpus size, so
 * a future edit cannot quietly shrink the evidence while leaving the assertions green.
 *
 * Calling the deprecated `url.parse()` here is deliberate - it is the oracle, and nothing else can play
 * that role. Measured on Node v22.23.2, driving the oracle over this corpus emits two deprecation
 * warnings: DEP0170 (an invalid URL, raised by inputs such as 'http://[::1]rel.png') under default
 * flags, plus DEP0169 (`url.parse()` itself) additionally under `--pending-deprecation`. Node emits
 * each once per process rather than per call. Those warnings belong to the oracle, not to the code under
 * test, so they are suppressed for the duration of the differential to keep the report readable; the
 * final test in this file re-measures the helper in a clean child process and asserts it emits none of
 * its own. That asymmetry is itself a migration result: the baseline expression these call sites used
 * emitted DEP0170 on such inputs, and the helper does not.
 *
 * The suite depends only on `url`, `path`, `chai` and the helper under test - no database, no server
 * boot, no fixtures - so it can run in isolation and cannot be perturbed by suite ordering.
 */

var url       = require('url')
  , path      = require('path')
  , expect    = require('chai').expect
  , legacyUrl = require('../../../lib/util/legacyUrl');

// Number of divergent inputs reported in a failure message. The counter is exact regardless; this only
// bounds how many concrete examples are printed.
var SAMPLE_LIMIT = 8;

/**
 * Records what an implementation did with one input: either the value it returned or the identity of
 * the error it threw. Error identity is compared on name, code and message together, because several of
 * the legacy parser's rejection paths differ only in the message (URIError 'URI malformed' from the
 * auth segment versus URIError ERR_INVALID_URI from the surrogate check, for example).
 *
 * @param {Function} fn  Implementation to exercise.
 * @param {*} raw        Input to pass through.
 * @returns {{value: *}|{thrown: string}} Observation suitable for structural comparison.
 */
function observe(fn, raw) {
  try {
    return { value : fn(raw) };
  } catch (err) {
    return { thrown : err.name + '|' + err.code + '|' + err.message };
  }
}

/**
 * Applies `path.basename()` to an observation, propagating a thrown pathname unchanged. This is the
 * expression the production call sites actually evaluate, so it is compared as its own outcome rather
 * than inferred from the pathname.
 *
 * @param {{value: *}|{thrown: string}} observation Pathname observation.
 * @returns {{value: *}|{thrown: string}} Basename observation.
 */
function basenameOf(observation) {
  if (observation.thrown) {
    return { thrown : observation.thrown };
  }

  try {
    return { value : path.basename(observation.value) };
  } catch (err) {
    return { thrown : err.name + '|' + err.code };
  }
}

/**
 * Structural equality for two observations. A thrown outcome is only equivalent to the same thrown
 * outcome, never to a returned value.
 *
 * @param {{value: *}|{thrown: string}} a First observation.
 * @param {{value: *}|{thrown: string}} b Second observation.
 * @returns {boolean} True when both implementations behaved identically.
 */
function equivalent(a, b) {
  if (a.thrown || b.thrown) {
    return a.thrown === b.thrown;
  }

  return a.value === b.value;
}

/**
 * Renders an input unambiguously for a failure message. Code units are listed for strings because the
 * interesting inputs are dominated by controls, lone surrogates and invisible ignorable code points
 * that are indistinguishable when printed literally.
 *
 * @param {*} raw Input to render.
 * @returns {string} Human-readable, copy-pasteable rendering.
 */
function formatInput(raw) {
  if (typeof raw !== 'string') {
    return typeof raw + ':' + (raw === undefined ? 'undefined' : JSON.stringify(raw));
  }

  var codes = [];

  for (var i = 0; i < raw.length; i++) {
    codes.push(raw.charCodeAt(i).toString(16));
  }

  return JSON.stringify(raw) + ' [' + codes.join(' ') + ']';
}

/**
 * Compares the helper against the legacy parser for a single input, on both the pathname and the
 * basename derived from it.
 *
 * @param {*} raw Input to compare.
 * @returns {string|null} Null when the two agree, otherwise a description of the divergence.
 */
function compare(raw) {
  var legacyPath = observe(function (value) { return url.parse(value).pathname; }, raw)
    , helperPath = observe(legacyUrl.pathname, raw)
    , legacyBase = basenameOf(legacyPath)
    , helperBase = basenameOf(helperPath);

  if (equivalent(legacyPath, helperPath) && equivalent(legacyBase, helperBase)) {
    return null;
  }

  return '  input   ' + formatInput(raw) +
    '\n    url.parse   pathname=' + JSON.stringify(legacyPath) + ' basename=' + JSON.stringify(legacyBase) +
    '\n    legacyUrl   pathname=' + JSON.stringify(helperPath) + ' basename=' + JSON.stringify(helperBase);
}

/**
 * Drives a corpus through the comparison. The corpus is supplied as a producer that calls back with one
 * input at a time, so the large randomized corpora are streamed rather than materialized as arrays.
 *
 * @param {Function} produce Receives a `check` callback to invoke once per input.
 * @returns {{checked: number, diffs: number, samples: Array.<string>}} Differential result.
 */
function differential(produce) {
  var result = { checked : 0, diffs : 0, samples : [] };

  produce(function (raw) {
    result.checked += 1;

    var message = compare(raw);

    if (!message) {
      return;
    }

    result.diffs += 1;

    if (result.samples.length < SAMPLE_LIMIT) {
      result.samples.push(message);
    }
  });

  return result;
}

/**
 * Asserts that a differential found no divergence and covered exactly the expected number of inputs.
 * Pinning the corpus size is what keeps the counts quoted in this file's documentation honest.
 *
 * @param {{checked: number, diffs: number, samples: Array.<string>}} result Differential result.
 * @param {number} expectedChecked Corpus size the corpus builder is defined to produce.
 * @returns {void}
 */
function expectNoDivergence(result, expectedChecked) {
  expect(result.checked, 'corpus size').to.equal(expectedChecked);

  var detail = 'expected zero divergences, found ' + result.diffs + ' in ' + result.checked +
    ' inputs; first ' + result.samples.length + ':\n' + result.samples.join('\n');

  expect(result.diffs, detail).to.equal(0);
}

/**
 * Deterministic linear congruential generator. Randomized corpora must be reproducible so that a
 * failure reported by CI can be replayed locally from the seed alone.
 *
 * @param {number} seed Initial state.
 * @returns {Function} Returns a float in [0, 1) and advances the state.
 */
function makeRandom(seed) {
  var state = seed;

  return function () {
    state = (state * 1103515245 + 12345) & 0x7fffffff;

    return state / 0x7fffffff;
  };
}

/**
 * Builds a random string from an alphabet of code units. Indexing by code unit rather than code point
 * is intentional: it produces lone surrogates, which are one of the legacy parser's rejection triggers.
 *
 * @param {Function} random Generator from makeRandom.
 * @param {string} alphabet Code units to draw from.
 * @param {number} maxLength Maximum length, inclusive; minimum is always 1.
 * @returns {string} Generated string.
 */
function randomString(random, alphabet, maxLength) {
  var length = 1 + Math.floor(random() * maxLength)
    , out    = '';

  for (var i = 0; i < length; i++) {
    out += alphabet[Math.floor(random() * alphabet.length)];
  }

  return out;
}

// ---------------------------------------------------------------------------------------------------
// Corpus 1 - structured cross-product.
//
// Every combination of scheme, host, path and tail below, which is where the parser's branch structure
// lives: hostless and slashed protocols, bracketed IPv6 hosts, punycode and internationalized hosts,
// auth segments, ports, the characters the parser escapes, the characters that terminate the host scan,
// and the leading/trailing whitespace the trim scan removes.
// ---------------------------------------------------------------------------------------------------

var CROSS_SCHEMES = ['', 'http://', 'https://', 'ftp://', 'file://', 'ws://', 'wss://', 'gopher://',
  'data:', 'javascript:', 'mailto:', 'tel:', 'urn:', 'about:', 'blob:', 'chrome://',
  'view-source:', 's3://', 'trinket:', 'custom:', 'custom://', 'C:', 'x:', '//', '/', ''];

var CROSS_HOSTS = ['[::1\u0000]', '[\u00fc]', '[]', '[:]', '[[]', '[::1\u00fc]', '[1.2.3.4]',
  '[::ffff:1.2.3.4]', 'xn--', 'xn--a', 'xn--tda', 'XN--TDA', 'a.xn--', '\u00fc', 'ex\u00e4mple.com',
  '\u65e5\u672c.com', '\u00ad.com', 'a\ufffd.com', '\u200b.com', '\ud83d\ude00.com', '\u0000a.com',
  '.', '..', 'a..b', '-', '_', '[::1', '::1]', '[::1]a', '', 'a.com', 'A.COM', 'user@a.com',
  'user:pw@a.com', 'a.com:8080', 'a.com:', '[::1]', '[::1]:80', 'a_b.com', 'a--b.com',
  'xn--80ak6aa92e.com', 'ex\u00e4mple.com', 's3.amazonaws.com', 'localhost', '127.0.0.1', 'a.com.',
  'a', ''];

var CROSS_PATHS = ['', '/', '/x.png', '/a/b/c.png', '/a b.png', '/a\tb.png', '/a\nb.png',
  '/a|b.png', '/a^b.png', '/a`b.png', '/a<b>.png', '/a"b.png', '/a{b}.png', '/a\\b.png',
  '/a%20b.png', '/a%b.png', '/a;b.png', '/./x', '/../x', '//dbl//x', '/\u00fc.png', '/a+b.png',
  '/a,b.png', '/a=b.png', '/a~b.png', '/a!b.png', '/a*b.png', '/a\'b.png', '/a(b).png',
  '/a:b.png', '/a@b.png', '/a$b.png', '/a&b.png', 'rel.png', 'a/rel.png', '.', '..'];

var CROSS_TAILS = ['', '?', '?q=1', '?q=1&r=2', '?a b', '#', '#f', '#f?q', '?q=1#f', '?a\\b'];

// Wrappers that re-submit a sampled slice of the corpus with surrounding whitespace, exercising the
// trim scan. Note the parser's own whitespace definition is wider than String.prototype.trim().
var CROSS_WRAPS = [
  function (value) { return value; },
  function (value) { return '  ' + value + '  '; },
  function (value) { return '\n\t' + value + '\r\n'; },
  function (value) { return value + ' '; }
];

var CROSS_FUZZ_ALPHABET = 'abz09.-+:/?#@%;&=[]{}|\\^`<>" \t\r\n\u00fc_~!*\'(),$';
var CROSS_FUZZ_SEED     = 20260802;
var CROSS_FUZZ_COUNT    = 60000;
var CROSS_SAMPLE_STRIDE = 37;

// Non-string inputs. The legacy parser rejects these with TypeError ERR_INVALID_ARG_TYPE, and the
// message embeds a type description the helper has to reproduce verbatim.
var CROSS_NON_STRINGS = [null, undefined, 123, {}, [], true, false, 0, NaN, 1];

/**
 * Produces the structured cross-product corpus.
 *
 * @param {Function} check Invoked once per input.
 * @returns {void}
 */
function produceCrossProduct(check) {
  var base = [];

  for (var si = 0; si < CROSS_SCHEMES.length; si++) {
    for (var hi = 0; hi < CROSS_HOSTS.length; hi++) {
      for (var pi = 0; pi < CROSS_PATHS.length; pi++) {
        for (var ti = 0; ti < CROSS_TAILS.length; ti++) {
          base.push(CROSS_SCHEMES[si] + CROSS_HOSTS[hi] + CROSS_PATHS[pi] + CROSS_TAILS[ti]);
        }
      }
    }
  }

  var random = makeRandom(CROSS_FUZZ_SEED);

  for (var fi = 0; fi < CROSS_FUZZ_COUNT; fi++) {
    base.push(randomString(random, CROSS_FUZZ_ALPHABET, 14));
  }

  for (var bi = 0; bi < base.length; bi++) {
    check(base[bi]);
  }

  for (var wi = 0; wi < CROSS_WRAPS.length; wi++) {
    for (var ii = 0; ii < base.length; ii += CROSS_SAMPLE_STRIDE) {
      check(CROSS_WRAPS[wi](base[ii]));
    }
  }

  for (var ni = 0; ni < CROSS_NON_STRINGS.length; ni++) {
    check(CROSS_NON_STRINGS[ni]);
  }
}

// ---------------------------------------------------------------------------------------------------
// Corpora 2 and 3 - seeded character fuzz.
//
// The alphabets deliberately include NUL, C0 controls, DEL, NBSP, soft hyphen, zero-width space, BOM,
// the replacement character, ideographic and fullwidth full stops, and both halves of a surrogate pair
// drawn independently so lone surrogates occur.
// ---------------------------------------------------------------------------------------------------

var FUZZ_ALPHABET = 'abzAZ09.-+:/?#@%;&=[]{}|\\^`<>" \t\r\n\u0000\u00a0\ufeff\u00fc\u200b\ufffd' +
  '_~!*\'(),$\u65e5\ud800\udc00\ud83d\ude00\u0001\u001f\u007f';

var FUZZ_SEED  = 777333111;
var FUZZ_COUNT = 400000;

/**
 * Produces the single-seed fuzz corpus, prefixing a realistic scheme on part of the population so the
 * protocol and host branches are exercised as heavily as the relative-path branch.
 *
 * @param {Function} check Invoked once per input.
 * @returns {void}
 */
function produceFuzz(check) {
  var random = makeRandom(FUZZ_SEED);

  for (var i = 0; i < FUZZ_COUNT; i++) {
    var value = randomString(random, FUZZ_ALPHABET, 40)
      , roll = random();

    if (roll < 0.15) { value = 'http://' + value; }
    else if (roll < 0.25) { value = 'https://' + value; }
    else if (roll < 0.32) { value = 'file://' + value; }
    else if (roll < 0.38) { value = 'data:' + value; }
    else if (roll < 0.44) { value = 'javascript:' + value; }
    else if (roll < 0.50) { value = 's3://' + value; }
    else if (roll < 0.55) { value = '//' + value; }
    else if (roll < 0.60) { value = 'urn:' + value; }

    check(value);
  }
}

var MULTI_ALPHABET = 'abzAZ09.-+:/?#@%;&=[]{}|\\^`<>" \t\r\n\u0000\u0001\u001f\u007f\u00a0\u00ad' +
  '\u200b\ufeff\u00fc\ufffd_~!*\'(),$\u65e5\ud800\udc00\ud83d\ude00\u3002\uff0e';

var MULTI_SCHEMES = ['', 'http://', 'https://', 'file://', 'ftp://', 'ws://', 'data:', 'javascript:',
  's3://', 'urn:', 'mailto:', '//', '/', 'C:', 'blob:', 'view-source:', 'trinket:'];

var MULTI_SEEDS         = [11, 2718281, 31415926, 987654321, 555];
var MULTI_COUNT_PER_SEED = 120000;

/**
 * Produces the multi-seed fuzz corpus with longer strings than corpus 2 and a wider alphabet.
 *
 * @param {Function} check Invoked once per input.
 * @returns {void}
 */
function produceMultiSeedFuzz(check) {
  MULTI_SEEDS.forEach(function (seed) {
    var random = makeRandom(seed);

    for (var i = 0; i < MULTI_COUNT_PER_SEED; i++) {
      var length = 1 + Math.floor(random() * 60)
        , value = MULTI_SCHEMES[Math.floor(random() * MULTI_SCHEMES.length)];

      for (var c = 0; c < length; c++) {
        value += MULTI_ALPHABET[Math.floor(random() * MULTI_ALPHABET.length)];
      }

      if (random() < 0.2) {
        value = '  ' + value + ' \t';
      }

      check(value);
    }
  });
}

// ---------------------------------------------------------------------------------------------------
// Corpus 4 - adversarial hostnames.
//
// Only characters that survive the parser's host scan can ever reach host validation, so a blind fuzz
// hits that code path rarely. These are exactly those survivors, combined up to three deep and wrapped
// in five URL shapes so the auth segment, the port and the protocol-relative form are covered too.
// Host validation is where the legacy parser's ICU-backed toASCII diverges most sharply from the WHATWG
// host parser, and it is the mechanism that took the longest to model.
// ---------------------------------------------------------------------------------------------------

var HOST_SURVIVORS = ['a', 'z', 'A', 'Z', '0', '9', '-', '_', '.', '$', '(', ')', ',', '!', '*', '~',
  '+', '=', '&', ']', '[', '\u0001', '\u001f', '\u007f', '\u00a0', '\u00ad', '\u200b', '\ufeff',
  '\ufffd', '\u3002', '\uff0e', '\uff61', '\u00fc', '\u65e5', '\u00e1', '\ud83d\ude00', 'xn--',
  'xn--a', 'xn--tda', 'xn--tda.', '\u00ad\u200b', '\uff10', '\u2260'];

var HOST_SHAPES = ['http://%s/x.png', 'http://u:p@%s/a/b.png', 'https://%s:8080/x', 's3://%s/k/v.zip',
  '//%s/x'];

/**
 * Produces the adversarial hostname corpus.
 *
 * @param {Function} check Invoked once per input.
 * @returns {void}
 */
function produceAdversarialHosts(check) {
  var hosts = [];

  HOST_SURVIVORS.forEach(function (first) {
    hosts.push(first);

    HOST_SURVIVORS.forEach(function (second) {
      hosts.push(first + second);
      hosts.push(first + 'b' + second);
      hosts.push(first + '.' + second);
      hosts.push(first + second + '.com');
      hosts.push('[' + first + second + ']');

      HOST_SURVIVORS.forEach(function (third) {
        hosts.push(first + second + third);
      });
    });
  });

  hosts.forEach(function (host) {
    HOST_SHAPES.forEach(function (shape) {
      check(shape.replace('%s', host));
    });
  });
}

describe('Legacy URL pathname helper', function() {
  var noDeprecationBefore;

  // The oracle is a deprecated API driven two million times; Node's warnings about it would bury the
  // report. Suppression is scoped to this suite and restored afterwards, and it deliberately does not
  // cover the child-process audit at the end of the file, which is where warning behavior is measured.
  before(function() {
    noDeprecationBefore = process.noDeprecation;
    process.noDeprecation = true;
  });

  after(function() {
    process.noDeprecation = noDeprecationBefore;
  });

  describe('differential equivalence against require(\'url\').parse()', function() {
    it('agrees on the structured cross-product of schemes, hosts, paths and tails', function(done) {
      this.timeout(60000);

      expectNoDivergence(differential(produceCrossProduct), 578178);

      done();
    });

    it('agrees across seeded character fuzz', function(done) {
      this.timeout(60000);

      expectNoDivergence(differential(produceFuzz), 400000);

      done();
    });

    it('agrees across multi-seed character fuzz with longer inputs', function(done) {
      this.timeout(120000);

      expectNoDivergence(differential(produceMultiSeedFuzz), 600000);

      done();
    });

    it('agrees on hostnames that survive the host scan, including punycode and IDNA edge cases',
      function(done) {
        this.timeout(60000);

        expectNoDivergence(differential(produceAdversarialHosts), 443975);

        done();
      });
  });

  describe('the escape table applied to path characters', function() {
    // Regression guard for the single highest-impact defect found while deriving this helper: the
    // apostrophe is escaped inside a path but is absent from the set of characters that terminate the
    // host scan. Omitting that one entry produced 15,857 divergences, so the whole table is pinned here
    // as literal expectations rather than being compared only against the oracle.
    var ESCAPED = {
      9 : '%09', 10 : '%0A', 13 : '%0D', 32 : '%20', 34 : '%22', 39 : '%27', 60 : '%3C', 62 : '%3E',
      94 : '%5E', 96 : '%60', 123 : '%7B', 124 : '%7C', 125 : '%7D'
    };

    it('escapes exactly the measured character set and agrees with the oracle on every code point',
      function(done) {
        this.timeout(10000);

        var mismatches = [];

        for (var code = 0; code <= 300; code++) {
          var character = String.fromCharCode(code)
            , input = 'http://a.com/A' + character + 'B'
            , expected;

          if (ESCAPED[code]) {
            expected = '/A' + ESCAPED[code] + 'B';
          } else if (code === 35 || code === 63) {
            // '#' starts the fragment and '?' starts the query, so both truncate the pathname.
            expected = '/A';
          } else if (code === 92) {
            // A backslash is rewritten to a forward slash during the initial scan.
            expected = '/A/B';
          } else {
            expected = '/A' + character + 'B';
          }

          var actual = legacyUrl.pathname(input)
            , oracle = url.parse(input).pathname;

          if (actual !== expected || oracle !== expected) {
            mismatches.push('code ' + code + ' expected ' + JSON.stringify(expected) +
              ' helper ' + JSON.stringify(actual) + ' oracle ' + JSON.stringify(oracle));
          }
        }

        expect(mismatches, mismatches.join('\n')).to.have.lengthOf(0);

        done();
      });
  });

  describe('the shapes the production call sites actually receive', function() {
    // Each row is [input, expected pathname, expected basename], where a null expected basename means
    // path.basename() is expected to throw. The opaque-scheme rows are the reason this helper exists:
    // they are precisely where the WHATWG URL API would have returned a value instead of throwing, and
    // silently produced a wrong asset filename.
    var SHAPES = [
      ['https://s3.amazonaws.com/trinket-assets/u/12/a b.png', '/trinket-assets/u/12/a%20b.png',
        'a%20b.png'],
      ['https://trinket-assets.s3.amazonaws.com/x/y/z.gif', '/x/y/z.gif', 'z.gif'],
      ['/img/logo.png', '/img/logo.png', 'logo.png'],
      ['img/logo.png', 'img/logo.png', 'logo.png'],
      ['', null, null],
      ['/', '/', ''],
      ['mailto:a@b.com', null, null],
      ['tel:+15551234', null, null],
      ['urn:isbn:0451450523', null, null],
      ['about:blank', null, null],
      ['data:image/png;base64,iVBOR', '/png;base64,iVBOR', 'png;base64,iVBOR'],
      ['javascript:void(0)', 'void(0)', 'void(0)'],
      ['blob:https://a.com/uuid', '//a.com/uuid', 'uuid'],
      ['https://cdn.example.com/a.png?v=2#frag', '/a.png', 'a.png'],
      ['HTTPS://CDN.EXAMPLE.COM/A.PNG', '/A.PNG', 'A.PNG'],
      ['//cdn.example.com/a.png', '//cdn.example.com/a.png', 'a.png'],
      ['https://a.com/dir/', '/dir/', 'dir'],
      ['https://a.com/a%20b.png', '/a%20b.png', 'a%20b.png'],
      ['https://a.com/it\'s.png', '/it%27s.png', 'it%27s.png'],
      ['https://a.com/a\\b.png', '/a/b.png', 'b.png'],
      ['  https://a.com/pad.png  ', '/pad.png', 'pad.png'],
      ['https://\u00fc.com/\u00fc.png', '/\u00fc.png', '\u00fc.png'],
      ['C:\\temp\\x.png', '/temp/x.png', 'x.png'],
      ['file:///tmp/x.png', '/tmp/x.png', 'x.png']
    ];

    it('derives the pathname and basename each call site depends on', function(done) {
      SHAPES.forEach(function (row) {
        var input = row[0]
          , expectedPathname = row[1]
          , expectedBasename = row[2];

        expect(legacyUrl.pathname(input), 'pathname of ' + formatInput(input)).to.equal(expectedPathname);
        expect(url.parse(input).pathname, 'oracle pathname of ' + formatInput(input))
          .to.equal(expectedPathname);

        if (expectedBasename === null) {
          expect(function () { return path.basename(legacyUrl.pathname(input)); },
            'basename of ' + formatInput(input)).to.throw(TypeError);
        } else {
          expect(path.basename(legacyUrl.pathname(input)), 'basename of ' + formatInput(input))
            .to.equal(expectedBasename);
        }
      });

      done();
    });
  });

  describe('warning behavior of the helper itself', function() {
    // Measured in a child process on purpose. Node emits a given warning at most once per process, so an
    // in-process assertion would silently pass merely because the oracle had already triggered the same
    // warning earlier in the run. The child requires only the helper, so what it reports is attributable
    // to the helper alone. --pending-deprecation is the flag the AAP's boot gate uses.
    it('emits no process warnings under --pending-deprecation', function(done) {
      this.timeout(30000);

      var execFileSync = require('child_process').execFileSync
        , target = path.join(__dirname, '..', '..', '..', 'lib', 'util', 'legacyUrl.js')
        , child = [
          'var seen = [];',
          'process.on("warning", function (w) { seen.push(w.name + "|" + (w.code || "-")); });',
          'var helper = require(' + JSON.stringify(target) + ');',
          'var schemes = ["", "http://", "https://", "file://", "s3://", "mailto:", "urn:", "//", "C:"];',
          'var hosts = ["a.com", "[::1]", "[::1]a", "[::1]:80", "a.com:8080", "a.com:abc",',
          '  "u:p@a.com", "\u00fc.com", "xn--tda", "", "."];',
          'var paths = ["", "/", "/x.png", "rel.png", "/a b.png", "/a\'b.png", "/\u00fc.png"];',
          'var count = 0;',
          'schemes.forEach(function (s) { hosts.forEach(function (h) { paths.forEach(function (p) {',
          '  count += 1;',
          '  try { helper.pathname(s + h + p); } catch (err) { /* rejections are expected */ }',
          '}); }); });',
          'process.stdout.write(JSON.stringify({ count : count, warnings : seen }));'
        ].join('\n')
        , raw = execFileSync(process.execPath, ['--pending-deprecation', '-e', child],
          { encoding : 'utf8', stdio : ['ignore', 'pipe', 'pipe'] })
        , report = JSON.parse(raw);

      expect(report.count, 'child corpus size').to.be.above(600);
      expect(report.warnings, 'warnings attributable to the helper').to.deep.equal([]);

      done();
    });
  });
});
