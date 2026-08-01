var config = require('config');

module.exports = {
  verify : function(g_recaptcha_response, cb) {
    // Skip recaptcha verification in test mode or if not configured
    // PRESERVED QUIRK: this callback fires synchronously, on the caller's stack, before verify()
    // returns -- so verify must never become async, which would defer it into a microtask. With
    // config.app.recaptcha.secretkey empty by default this is the usual path. See
    // docs/PRESERVED-QUIRKS.md.
    if (config.isTest || !config.app.recaptcha || !config.app.recaptcha.secretkey) {
      return cb({ success : true });
    }

    // request's form option sent application/x-www-form-urlencoded; passing a URLSearchParams
    // instance as the fetch body reproduces that encoding. The await work lives in a nested async
    // block so that verify itself stays synchronous-entry, and no rejection handler is attached to
    // it on purpose -- see the note at the status read below.
    (async function() {
      var response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
          method : 'POST'
        , body   : new URLSearchParams({
              secret   : config.app.recaptcha.secretkey
            , response : g_recaptcha_response
          })
      });

      // PRESERVED QUIRK: the status is read with no transport-error guard, exactly as the
      // callback-era code read response.statusCode without first checking err. A transport failure
      // therefore escapes uncaught instead of degrading into a result object. See
      // docs/PRESERVED-QUIRKS.md section 1.10.
      if (response.status === 200) {
        // Mirrors the baseline read of the response.body property rather than the unused body
        // callback parameter: JSON.parse is what throws on a malformed payload, so response.json()
        // is not an equivalent substitute.
        cb(JSON.parse(await response.text()));
      }
      else {
        // PRESERVED QUIRK: the key on this branch is status, not success -- every caller reads
        // .success, which is therefore undefined here. See docs/PRESERVED-QUIRKS.md.
        cb({ status : false });
      }
    })();
  }
};
