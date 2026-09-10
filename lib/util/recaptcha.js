var config = require('config');

// ---------------------------------------------------------------------------
// `request` form-encoding compatibility helpers
//
// `verify(g_recaptcha_response, cb)` has exactly six outcomes and every one of
// them is the baseline's (2f8712a, `request.post` with a callback), unchanged
// in value, in the order they are tested and in where they are raised. AAP
// 0.4.2 enumerates all six and requires all six preserved; AAP 0.6.6 repeats
// the requirement for the two that throw; and AAP 0.7 approves exactly two
// deviations from baseline in this migration, neither of them here. Only the
// mechanism moves: `request.post` is gone, so the exchange is `fetch`.
//
// 1. `{success: true}` before any network call when `config.isTest`.
// 2. `{success: true}` before any network call when no
//    `app.recaptcha.secretkey` is configured - which is how config/default.yaml
//    ships - so an unconfigured deployment accepts every submission silently.
// 3. The endpoint's PARSED BODY on a 200, delivered verbatim: its `success`
//    field is the verdict. A 200 whose body is valid JSON and not an object is
//    this outcome, not a fault - `null` is delivered as `null` (measured on
//    both trees), and the caller's own read of `success` is what throws, inside
//    its lifecycle method, where AAP 0.6.3's Layer 1 catch-all answers 500.
// 4. `{status: false}` on any other status. That key is `status`, not
//    `success`, so every caller reads it as a failed verification - and the
//    callers that answer `request.success()` on a failed challenge
//    (lib/controllers/users.js's sendPassReset, lib/controllers/trinket.js's
//    email) still answer it, which is baseline behaviour R-d preserves.
// 5. A TRANSPORT FAILURE, where the response is `undefined` and reading
//    `response.statusCode` throws an uncaught TypeError. `cb` is never invoked.
// 6. A 200 whose body is not JSON, where `JSON.parse` throws an uncaught
//    SyntaxError. `cb` is never invoked.
//
// MEASURED, both trees, all six, through the fixture that intercepts
// siteverify at the module boundary (`PARITY_HTTP_SELFTEST_CHILD=recaptcha:
// verify node test/parity/fixtures/http.js`, one profile per outcome): 1-4
// identical and exit 0; 5 exits 1 with `TypeError: Cannot read properties of
// undefined (reading 'statusCode')`; 6 exits 1 with `SyntaxError: Unexpected
// token '<'`. An earlier revision of this file guarded both reads and
// delivered `{status: false}` instead. That guard was an unauthorised
// deviation - and it also turned a provider outage into a "your email was
// sent" for the two callers above - so it is withdrawn and outcomes 5 and 6
// are back to raising where baseline raised them.
//
// WHY THE THROWS SURVIVE THE CONVERSION. `request` invoked its callback from an
// event emitter, so a throw inside the callback escaped as an uncaught
// exception rather than as a rejected promise, and no uncaughtException handler
// is installed anywhere in this application. `fetch` delivers through a promise
// chain, where the same throw would become a rejection - swallowed outright by
// the resolve-only promises every caller wraps `verify` in. The `setImmediate`
// at the foot of this file is what keeps the two equivalent: the response is
// handled OFF the chain, so outcomes 5 and 6 reach process scope exactly as
// they did. Nothing after that line can catch them, which is the contract.
//
// The two encoding helpers below are duplicated in lib/controllers/auth.js; a
// util requiring a controller would invert the dependency direction, so a
// change to either copy has to be mirrored in the other.

// Percent-encodes one field name or value to RFC 3986: the safe set is the
// unreserved set A-Z a-z 0-9 - . _ ~, so the five characters ! ' ( ) * that
// encodeURIComponent leaves alone are escaped here too.
var rfc3986 = function(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, function(character) {
    return '%' + character.charCodeAt(0).toString(16).toUpperCase();
  });
};

// Builds an application/x-www-form-urlencoded body from a flat object. Two
// conventions are load-bearing: an `undefined` value drops its field entirely,
// which is what an omitted `g-recaptcha-response` is, and a `null` value keeps
// the field with an empty value, which is how node-config reads an unset key.
// Sending the strings "undefined" or "null" instead would submit them to the
// endpoint as a secret or a response token.
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
    //
    // Outcomes 1 and 2, in the order baseline tested them and with the value
    // baseline delivered. The unconfigured arm is not a fault to report: it is
    // the posture config/default.yaml ships, and failing closed - or warning -
    // here would change what a deployment running the committed configuration
    // does with every registration.
    if (config.isTest || !config.app.recaptcha || !config.app.recaptcha.secretkey) {
      return cb({ success : true });
    }

    // The baseline callback body, verbatim in its reads as well as in its
    // values. `response` is undefined on a transport failure, so the
    // `statusCode` read raises outcome 5; `JSON.parse` raises outcome 6 on a
    // 200 that is not JSON. Neither is guarded, because a guard here is what
    // AAP 0.4.2 and 0.6.6 prohibit, and `response.body` rather than a parsed
    // callback argument is what baseline parsed.
    var handleResponse = function(response) {
      if (response.statusCode === 200) {
        cb(JSON.parse(response.body));
      }
      else {
        cb({ status : false });
      }
    };

    // The body is an already-encoded string, so the content-type is stated
    // here; left to fetch it would be labelled `text/plain`, which is not a
    // form body the endpoint reads fields from. `accept-encoding: identity`
    // asks for undecoded bytes, so `res.text()` returns what the endpoint
    // wrote and JSON.parse sees it; the runtime otherwise offers gzip and
    // deflate unasked. Nothing else is configured -- no timeout and no
    // redirect mode -- because `request.post` carried neither.
    fetch("https://www.google.com/recaptcha/api/siteverify", {
        method  : "POST"
      , headers : {
            "content-type"    : "application/x-www-form-urlencoded"
          , "accept-encoding" : "identity"
        }
      , body    : formEncode({
            secret   : config.app.recaptcha.secretkey
          , response : g_recaptcha_response
        })
    }).then(function(res) {
      // Read as text and parsed in handleResponse, where the baseline parsed
      // it, so outcome 6 is raised from the same expression baseline raised it
      // from. Through res.json() the parse failure would arrive as a rejection
      // instead, become an undefined response in the catch below, and be
      // delivered as outcome 5 - which would lose the distinction between an
      // unreachable provider and a provider answering with something that is
      // not a verdict.
      return res.text().then(function(text) {
        return { statusCode : res.status, body : text };
      });
    }).catch(function() {
      // Every failure class of the exchange lands here -- a refused or reset
      // connection, a DNS failure, a body that cannot be read -- and each one
      // becomes an undefined response, because that is precisely what the
      // replaced library delivered: with a callback attached it invoked
      // `callback(error)` on its 'error' event, so `response` and `body` were
      // both undefined however far the exchange had got. handleResponse then
      // reads `statusCode` off that absence, which is outcome 5. Attached
      // after the body read rather than as fetch's own rejection handler, so a
      // failure reading the body reaches it too instead of leaving the chain.
      return undefined;
    }).then(function(response) {
      // Dispatched OFF the promise chain, which is what makes outcomes 5 and 6
      // uncaught exceptions rather than rejections: `request` invoked this
      // callback from an event emitter, and a throw there escaped to process
      // scope. Called inside the chain the same throw would become a rejected
      // promise - a different fault class, and one the resolve-only promises
      // every caller wraps `verify` in would swallow, leaving the request
      // neither answered nor reported. Nothing after this line can catch it.
      setImmediate(function() {
        handleResponse(response);
      });
    });
  }
};
