var config = require('config');

module.exports = {
  verify : function(g_recaptcha_response, cb) {
    // Skip recaptcha verification in test mode or if not configured
    // This callback fires synchronously, on the caller's stack, before verify() returns, so verify
    // must never become async. With an empty secretkey this is the usual path.
    if (config.isTest || !config.app.recaptcha || !config.app.recaptcha.secretkey) {
      return cb({ success : true });
    }

    // The URLSearchParams body sends these fields as application/x-www-form-urlencoded. The await
    // work lives in a nested async block so verify itself keeps its synchronous entry, and no
    // rejection handler is attached to it on purpose - see the note at the status read below.
    (async function() {
      var response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
          method : 'POST'
        , body   : new URLSearchParams({
              secret   : config.app.recaptcha.secretkey
            , response : g_recaptcha_response
          })
      });

      // The status is read with no transport-error guard, so a transport failure escapes uncaught
      // instead of degrading into a result object. See docs/PRESERVED-QUIRKS.md section 1.10.
      if (response.status === 200) {
        // JSON.parse is what throws on a malformed payload, so response.json() is not an equivalent
        // substitute here.
        cb(JSON.parse(await response.text()));
      }
      else {
        // The key on this branch is `status`, not `success` - and every caller reads `.success`,
        // which is therefore undefined here.
        cb({ status : false });
      }
    })();
  }
};
