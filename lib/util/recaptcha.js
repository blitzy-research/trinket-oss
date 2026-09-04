var config = require('config');

// ---------------------------------------------------------------------------
// `request` form-encoding compatibility helpers
//
// Baseline issued this call as `request.post({url: ..., form: {...}}, cb)`.
// `form` was not a plain body: it implied a wire encoding (qs' RFC 3986
// stringifier, reached through Request.prototype.form -> self._qs.stringify in
// request 2.88.2) that the runtime's own WHATWG search-params serializer --
// the one fetch accepts directly as a body -- does not reproduce. Both
// values sent below are live: `config.app.recaptcha.secretkey`, and the
// user-supplied `g-recaptcha-response`, which is `undefined` whenever the
// client omits the field.
//
// These two helpers are a deliberate ~15-line duplication of the identical,
// byte-verified pair in lib/controllers/auth.js. This delivery adds no new
// file, so there is nowhere shared to put them, and importing a controller
// from a util would invert the dependency direction; duplicating the two pure
// functions is the smaller cost. Any change to one must be mirrored in the
// other.
// ---------------------------------------------------------------------------

// Percent-encodes one component the way the `form` option did. qs' RFC 3986
// safe set is the unreserved set A-Z a-z 0-9 - . _ ~, and so narrower than
// encodeURIComponent, which additionally leaves ! ' ( ) * alone. Verified byte
// for byte against qs 6.5.5 -- the version request 2.88.2 bundled -- over
// every ASCII character as both field name and value, over multi-byte and
// surrogate-pair input, and over numeric, boolean, null and undefined values.
var rfc3986 = function(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, function(character) {
    return '%' + character.charCodeAt(0).toString(16).toUpperCase();
  });
};

// Builds an application/x-www-form-urlencoded body from a flat object with the
// conventions qs used: an `undefined` value drops its field entirely, while a
// `null` value keeps the field with an empty value, and anything else is
// stringified. Both distinctions are live here -- an omitted
// g-recaptcha-response is `undefined`, and node-config reads an unset
// recaptcha key as `null` -- and the search-params serializer instead sent
// the literal strings "undefined" and "null" as values.
var formEncode = function(form) {
  var pairs = [];

  Object.keys(form).forEach(function(name) {
    var value = form[name];

    if (value === undefined) {
      return;
    }

    pairs.push(rfc3986(name) + '=' + rfc3986(value === null ? '' : String(value)));
  });

  return pairs.join('&');
};

module.exports = {
  verify : function(g_recaptcha_response, cb) {
    // Skip recaptcha verification in test mode or if not configured
    if (config.isTest || !config.app.recaptcha || !config.app.recaptcha.secretkey) {
      return cb({ success : true });
    }

    // Response handling, carried over verbatim from the `request` callback
    // this replaces: `err` is deliberately not inspected, so a transport
    // failure still reaches `response.statusCode` with `response` undefined
    // and throws a TypeError, and a body that is not JSON still throws out of
    // JSON.parse. Neither fault invokes `cb`.
    var handleResponse = function(err, response) {
      if (response.statusCode === 200) {
        cb(JSON.parse(response.body));
      }
      else {
        cb({ status : false });
      }
    };

    // `request.post` with a `form` option becomes a native fetch POST. The
    // content-type is set explicitly to reproduce the header `form` sent,
    // without the `;charset=UTF-8` parameter fetch appends on its own when it
    // is handed a search-params object as the body.
    //
    // `accept-encoding: identity` restores the content coding of the baseline
    // call. `request` was constructed without `gzip: true`, so it sent no
    // accept-encoding header at all and never decompressed a response; the
    // runtime's fetch offers `gzip, deflate` unasked and decodes transparently,
    // which changes both the request bytes on the wire and the bytes
    // `res.text()` below returns for a compressed reply. Sending `identity`
    // explicitly is what the runtime honours -- there is no way to send no
    // accept-encoding at all -- and it keeps the response body the exact bytes
    // the endpoint wrote, which is what JSON.parse then sees.
    //
    // `redirect: "manual"` restores the redirect policy. `request` defaulted to
    // `followAllRedirects: false`, under which a 3xx answer to a non-GET was
    // never followed: the callback saw the 3xx itself, `statusCode !== 200`, and
    // the else branch above returned `{status: false}`. Fetch follows every
    // method by default and, for a 307 or 308, replays the body -- which both
    // turned that `{status: false}` into a 200 carrying the redirect target's
    // body and re-sent the reCAPTCHA secret to whatever host the target named.
    // With "manual" the 3xx reaches handleResponse and takes the baseline
    // branch. No hop is retried here, because baseline followed none.
    //
    // `formEncode` restores the request bytes; see the helper above. Field names
    // and their order are unchanged from the `form` object baseline passed.
    fetch("https://www.google.com/recaptcha/api/siteverify", {
        method   : "POST"
      , headers  : {
            "content-type"    : "application/x-www-form-urlencoded"
          , "accept-encoding" : "identity"
        }
      , redirect : "manual"
      , body     : formEncode({
            secret   : config.app.recaptcha.secretkey
          , response : g_recaptcha_response
        })
    }).then(function(res) {
      return res.text().then(function(text) {
        // Read as text and parsed below, rather than via res.json(), so the
        // malformed-body fault keeps throwing from JSON.parse with the same
        // error type and message.
        return { statusCode : res.status, body : text };
      });
    }).then(function(response) {
      // Dispatched off the promise chain: a throw inside handleResponse then
      // escapes as an uncaught exception, exactly as it did when `request`
      // invoked this callback from its own emitter. Called inside a `then`
      // reaction it would surface as an unhandled rejection instead, which is
      // a different process-level event.
      process.nextTick(handleResponse, null, response);
    }, function(err) {
      process.nextTick(handleResponse, err, undefined);
    });
  }
};
