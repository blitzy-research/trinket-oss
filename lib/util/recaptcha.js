var config = require('config');

// ---------------------------------------------------------------------------
// `request` form-encoding compatibility helpers
//
// `verify(g_recaptcha_response, cb)` has exactly six outcomes, and all six
// now reach `cb`. Four are the baseline's (2f8712a, `request.post` with a
// callback), unchanged in value and in the order they are tested:
// `{success: true}` in test mode and `{success: true}` with no
// `app.recaptcha.secretkey` configured, both before any network call, so an
// unconfigured deployment accepts every submission; the endpoint's parsed body
// on a 200, whose `success` field is the verdict; and `{status: false}` on any
// other status, which carries no `success` field and so reads as a failure
// wherever the verdict is tested.
//
// APPROVED DEVIATION -- the other two outcomes are the two provider faults,
// and they now fail the verification closed instead of terminating the
// process. That is the whole of the behaviour change in this file.
//
// Baseline guarded neither. A transport failure left the response `undefined`
// -- `request` invoked its callback as `callback(error)`, with no response and
// no body -- so reading `response.statusCode` threw a TypeError; a 200 whose
// body is not JSON threw a SyntaxError out of JSON.parse. Neither was caught,
// and the callback is dispatched off the promise chain (see the setImmediate
// at the foot of this file), so each escaped as an uncaught exception: `cb`
// was never invoked and the process exited 1. AAP 0.4.2 and 0.6.6 record both
// as preserved under R-d.
//
// docs/preserved-quirks.md 10.7 supersedes R-d for a process death, and this
// is that argument at its strongest. The trigger is one unauthenticated
// POST /users and the fault is the provider's, not the operator's, so what the
// death destroys is not this branch's behaviour but every other route's -- and
// it destroys it again on every restart for as long as siteverify is
// unreachable or a proxy answers with an HTML error page. R-d's protection
// does not reach that. The same precedence already decided the never-settling
// stream at lib/controllers/files.js (AAP 0.7) and the duplicate folder name
// at lib/controllers/folders.js.
//
// Both faults deliver `{status: false}`. That is not a new shape invented for
// them: it is the exact value the non-200 branch already delivers, and every
// caller (lib/controllers/users.js:144, :379, :1128 and
// lib/controllers/trinket.js:1033) reads it as a failed verification because
// it carries no `success` field. So the route outcome is the one the non-200
// profile already produced -- POST /users answers 302 with the process alive
// -- and no caller needed changing. Each caller wraps `verify` in a promise
// that has only a resolve; with `cb` now invoked on every outcome, that
// promise always settles. Those call sites' own comments still describe the
// non-settlement this file no longer produces.
//
// Neither fault is silent: each logs one line naming which of the two it was,
// so a provider outage does not read like a visitor failing a challenge.
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

// Writes one operator-facing line, and only when there is somewhere to write
// it. `log` is an implicit global installed by app.js:21, so it exists for
// every request that reaches a route -- but this module is also required
// directly, with no app.js, by the self-test in test/parity/fixtures/http.js,
// and a bare `log.warn(...)` there would raise a ReferenceError. That would
// have replaced one crash with another inside the very code added to remove a
// crash, so the reference is guarded and absence is silent rather than fatal.
// The level is looked up on `log` as well, because a partial stand-in is as
// plausible as none at all.
//
// Both levels used here (`error`, `warn`) go to winston's Console transport,
// which writes them to stdout rather than stderr, so nothing below can disturb
// a gate that reads stderr.
var logIfAvailable = function(level, message) {
  if (typeof log !== 'undefined' && log && typeof log[level] === 'function') {
    log[level](message);
  }
};

// Bounds one provider body for a log line: runs of whitespace collapse to
// single spaces and anything past 200 characters is dropped, so an HTML error
// page identifies itself in the log without the log line becoming the page.
// The siteverify response carries no secret -- the secret travels in the
// request -- so the excerpt is safe to record.
var bodyExcerpt = function(body) {
  var text = (typeof body === 'string' ? body : String(body)).replace(/\s+/g, ' ').trim();

  return text.length > 200 ? text.slice(0, 200) + '...' : text;
};

// Latches the unconfigured warning below to one line per process. The
// alternative is a line per submission, which on a busy unconfigured
// deployment buries the fault it is reporting; the state being reported is a
// property of the configuration rather than of the request, so it does not
// change between submissions and does not need repeating.
var unconfiguredWarningEmitted = false;

module.exports = {
  verify : function(g_recaptcha_response, cb) {
    // Skip recaptcha verification in test mode or if not configured
    if (config.isTest || !config.app.recaptcha || !config.app.recaptcha.secretkey) {
      // The value and the branch order are unchanged, and deliberately so: an
      // unconfigured deployment accepts every submission, so POST /users takes
      // an account with no `g-recaptcha-response` key at all. That is not a
      // process death, the client is answered, and R-d and AAP 0.4.2 preserve
      // it -- and config/default.yaml ships `app.recaptcha.secretkey` empty,
      // so failing closed instead would stop registration in every deployment
      // running the committed configuration.
      //
      // What changes is that the state stops being silent. One warning per
      // process, on the unconfigured arm only, names the deployment as
      // accepting every submission. The `config.isTest` arm stays silent
      // because there the pass-through is the intended test posture rather
      // than a deployment left unprotected, and because the suite runs under
      // NODE_ENV=test: warning there would put a line under every registration
      // case that says nothing about the deployment.
      //
      // The two arms are told apart by re-reading `config.isTest`, not by
      // restructuring the condition above, so the order in which the two
      // short-circuits are tested is exactly the order baseline tested them.
      if (!config.isTest && !unconfiguredWarningEmitted) {
        unconfiguredWarningEmitted = true;
        logIfAvailable('warn', 'reCAPTCHA is not configured (app.recaptcha.secretkey is unset), so every ' +
          'submission that reaches verify() is accepted without a challenge and no request is made to ' +
          'siteverify. Set app.recaptcha.secretkey to enforce the challenge. Logged once per process.');
      }

      return cb({ success : true });
    }

    // The baseline callback body's two delivered values are unchanged: the 200
    // branch parses the body and delivers it, and every other status delivers
    // `{status: false}` -- a differently shaped object rather than a falsy
    // `success`, which is what callers branch on.
    //
    // What is added is the two guards the approved deviation in the header is
    // made of, each covering one of the reads that used to throw out of this
    // callback and take the process with it. A response that is absent, or
    // that carries no numeric `statusCode`, is the transport failure: the
    // catch below has nothing to report but the fact of it. A 200 whose body
    // will not parse is the malformed-body fault. Both deliver the value the
    // non-200 branch delivers, so the verification fails closed on exactly the
    // outcome a rejected challenge already produces, and both are logged
    // because neither is the visitor's doing.
    //
    // The two are guarded separately rather than by one try/catch around the
    // whole body: they are different operational events -- an unreachable
    // provider and a provider or proxy answering with something that is not a
    // verdict -- and collapsing them would leave the operator unable to tell
    // which is happening.
    //
    // A 200 whose body is valid JSON but not an object is a third case, and it
    // is deliberately NOT one of the two: the parsed value is delivered
    // verbatim, exactly as baseline delivered it. Measured, `null` arrives as
    // `null` and `42` as `42`. Reading `success` off those happens at the
    // caller, inside its own lifecycle method, so it reaches the preserved
    // handler catch-all rather than escaping the process -- which is why the
    // deviation above does not extend to it and R-d keeps it as it is.
    var handleResponse = function(response) {
      var parsed;

      if (!response || typeof response.statusCode !== 'number') {
        logIfAvailable('error', 'reCAPTCHA siteverify unreachable: the exchange produced no response, ' +
          'so this submission is failed closed with {status:false}');

        return cb({ status : false });
      }

      if (response.statusCode === 200) {
        try {
          parsed = JSON.parse(response.body);
        }
        catch (unparseable) {
          logIfAvailable('error', 'reCAPTCHA siteverify answered 200 with a body that is not JSON, ' +
            'so this submission is failed closed with {status:false}: ' + unparseable.message +
            ' -- body began: ' + bodyExcerpt(response.body));

          return cb({ status : false });
        }

        cb(parsed);
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
      // it, so a malformed body is recognised there as its own fault. Through
      // res.json() the parse failure would arrive as a rejection instead: it
      // would land in the catch below, become an undefined response, and be
      // reported as an unreachable provider -- which is the one distinction
      // the two log lines exist to make.
      return res.text().then(function(text) {
        return { statusCode : res.status, body : text };
      });
    }).catch(function() {
      // Every failure class of the exchange lands here -- a refused or reset
      // connection, a DNS failure, a body that cannot be read -- and each one
      // becomes an undefined response, because that is precisely what the
      // replaced library delivered: with a callback attached it invoked
      // `callback(error)` on its 'error' event, so `response` and `body` were
      // both undefined however far the exchange had got. handleResponse reads
      // that absence as the transport failure and fails the verification
      // closed. Attached after the body read rather than as fetch's own
      // rejection handler, so a failure reading the body reaches it too
      // instead of leaving the chain.
      return undefined;
    }).then(function(response) {
      // Dispatched OFF the promise chain, and retained deliberately. It is no
      // longer load-bearing for the two faults -- handleResponse now answers
      // both rather than throwing -- but it still decides where anything else
      // that throws from here is reported. `request` invoked this callback
      // from an event emitter, so a throw inside it escaped as an uncaught
      // exception. Called inside the chain the same throw would become a
      // rejected promise: a different fault class, reported differently and
      // swallowed outright by any caller that attaches a rejection handler,
      // which for the resolve-only promises every caller wraps `verify` in
      // would mean a fault that is neither answered nor reported. Nothing
      // after this line can catch it, which is the contract, and the guards
      // above are what make sure there is nothing to catch on the two
      // outcomes the provider controls.
      setImmediate(function() {
        handleResponse(response);
      });
    });
  }
};
