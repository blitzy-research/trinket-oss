var config = require('config');

// Ceiling on one verification exchange: a provider that accepts the connection
// and then never answers would otherwise pin the awaiting route indefinitely.
var RECAPTCHA_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// `request` form-encoding compatibility helpers
//
// `verify(g_recaptcha_response, cb)` never rejects, and reports every outcome
// short of the two faults below through `cb`: `{success: true}` in test mode or
// with no `app.recaptcha.secretkey` configured, before any network call, so an
// unconfigured deployment accepts every submission; the endpoint's parsed body
// on a 200, whose `success` field is the verdict; and `{status: false}` on any
// other status, which carries no `success` field and so reads as a failure
// wherever the verdict is tested.
//
// Two outcomes throw out of `handleResponse` instead. A transport failure
// leaves the response `undefined`, so reading its status throws a TypeError; a
// 200 whose body is not JSON throws out of JSON.parse. Neither is caught, so
// each escapes as an uncaught exception with `cb` never called -- and since
// every caller wraps `verify` in a promise that has only a resolve, that
// promise stays pending and the route awaiting it answers nothing.
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
    if (config.isTest || !config.app.recaptcha || !config.app.recaptcha.secretkey) {
      return cb({ success : true });
    }

    // Every path below reaches `cb` through `settle`, and only the first one
    // does. Two faults used to reach it by no path at all: dispatched off the
    // promise chain, a transport failure read `response.statusCode` with
    // `response` undefined and raised a TypeError, and a 200 carrying a
    // non-JSON body raised out of JSON.parse - both as uncaught exceptions,
    // with `cb` never invoked. Nothing in the application listens for that
    // event, so either fault terminated the process on an unauthenticated
    // signup, after which no route served, and left the awaiting route
    // unsettled. R-b, which requires the application to run in full with no
    // route excluded, makes preserving that impossible; it is the class AAP
    // 0.7 already decided for lib/controllers/files.js:98-100, where an absent
    // response is held not to be behaviour a client can depend on. Both faults
    // therefore settle with `{status: false}`, the value the non-200 branch
    // below already produces, rather than a rejection or a new shape: every
    // caller reads `.success`, and its absence already selects a branch that
    // answers the request.
    var settled = false;

    var settle = function(result) {
      if (settled) {
        return;
      }

      settled = true;
      cb(result);
    };

    var handleResponse = function(response) {
      if (response.statusCode === 200) {
        settle(JSON.parse(response.body));
      }
      else {
        settle({ status : false });
      }
    };

    // The body is an already-encoded string, so the content-type is stated
    // here; left to fetch it would be labelled `text/plain`, which is not a
    // form body the endpoint reads fields from. `accept-encoding: identity`
    // asks for undecoded bytes, so `res.text()` returns what the endpoint
    // wrote and JSON.parse sees it; the runtime otherwise offers gzip and
    // deflate unasked. `redirect: "manual"` keeps a 3xx as the answer, which
    // handleResponse reports as `{status: false}`: following one would re-send
    // the secret key to whatever host the target names, and a 307 or 308 would
    // replay the form body with it.
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
      , signal   : AbortSignal.timeout(RECAPTCHA_TIMEOUT_MS)
    }).then(function(res) {
      return res.text().then(function(text) {
        // Read as text and parsed in handleResponse so a malformed body
        // throws there. Through res.json() the parse failure would reject
        // instead, reach the rejection handler below, and be reported as
        // though the transport had failed.
        return { statusCode : res.status, body : text };
      });
    }).then(handleResponse).catch(function() {
      // Terminal handler, so no path leaves the chain: a transport failure, the
      // timeout above, a body that cannot be read, and a throw out of
      // handleResponse's JSON.parse all arrive here and settle as a failed
      // verification. The guard makes it safe after a successful settlement.
      settle({ status : false });
    });
  }
};
