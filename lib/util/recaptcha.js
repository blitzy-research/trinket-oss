var config = require('config');

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
    // without the `;charset=UTF-8` parameter fetch appends on its own for a
    // URLSearchParams body.
    fetch("https://www.google.com/recaptcha/api/siteverify", {
        method  : "POST"
      , headers : { "content-type" : "application/x-www-form-urlencoded" }
      , body    : new URLSearchParams({
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
