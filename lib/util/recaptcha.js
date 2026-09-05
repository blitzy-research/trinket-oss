var config = require('config');

// ---------------------------------------------------------------------------
// `request` form-encoding compatibility helpers
//
// `verify(g_recaptcha_response, cb)` has exactly six outcomes, and all six are
// the baseline's (2f8712a, `request.post` with a callback). Four reach `cb`:
// `{success: true}` in test mode and `{success: true}` with no
// `app.recaptcha.secretkey` configured, both before any network call, so an
// unconfigured deployment accepts every submission; the endpoint's parsed body
// on a 200, whose `success` field is the verdict; and `{status: false}` on any
// other status, which carries no `success` field and so reads as a failure
// wherever the verdict is tested.
//
// The other two reach `cb` by no path at all, and that is preserved rather
// than repaired (AAP 0.4.2 and 0.6.6, R-d). A transport failure left the
// response `undefined` -- `request` invoked its callback as `callback(error)`,
// with no response and no body -- so reading `response.statusCode` threw a
// TypeError; a 200 whose body is not JSON threw a SyntaxError out of
// JSON.parse. Neither was caught, so each escaped its callback as an uncaught
// exception with `cb` never invoked. Every caller
// (lib/controllers/users.js:376, :743, :1696 and lib/controllers/trinket.js:1032)
// wraps `verify` in a promise that has only a resolve, so on either fault that
// promise stays pending and the route awaiting it answers nothing. Those call
// sites document exactly that, and this module is what makes it true.
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

    // The baseline callback body, unchanged: the 200 branch parses the body
    // and delivers it, and every other status delivers `{status: false}` -- a
    // differently shaped object rather than a falsy `success`, which is what
    // callers branch on. Its two throwing edges are the two preserved faults:
    // `response.statusCode` on an undefined response, and JSON.parse on a
    // body that is not JSON. Neither is guarded, so neither reaches `cb`.
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
      // it, so a malformed body throws there as a SyntaxError. Through
      // res.json() the parse failure would arrive as a rejection instead and
      // be indistinguishable from a transport failure.
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
      // throws the TypeError this outcome is defined by. Attached after the
      // body read rather than as fetch's own rejection handler, so a failure
      // reading the body reaches it too instead of leaving the chain.
      return undefined;
    }).then(function(response) {
      // Dispatched OFF the promise chain deliberately. `request` invoked this
      // callback from an event emitter, so a throw inside it escaped as an
      // uncaught exception: the process reports the TypeError or SyntaxError
      // and exits. Called inside the chain the same throw would become a
      // rejected promise -- a different fault class, reported differently and
      // swallowed outright by any caller that attaches a rejection handler --
      // and returning it into the chain unhandled would report it as an
      // unhandled rejection rather than as the uncaught throw it is.
      // Nothing after this line can catch it, which is the contract.
      setImmediate(function() {
        handleResponse(response);
      });
    });
  }
};
