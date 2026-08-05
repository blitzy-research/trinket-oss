var config = require('config');

module.exports = {
  /**
   * Verifies a reCAPTCHA response token.
   *
   * There is no callback parameter; every caller awaits the returned promise. Three outcomes:
   *
   *   1. TEST OR UNCONFIGURED - resolves `{ success : true }` without any network work. With an empty
   *      `secretkey`, the shipped default and always the case under test, this is the only path taken.
   *   2. HTTP 200 - resolves the parsed verification payload. `JSON.parse` is what throws on a
   *      malformed body, so `response.json()` is not an equivalent substitute here.
   *   3. ANY OTHER STATUS - resolves `{ status : false }`. The key is `status`, NOT `success`, so every
   *      caller's `.success` read is undefined on this branch. Do not normalize it; see
   *      docs/PRESERVED-QUIRKS.md.
   *
   * PRESERVED QUIRK - the transport-failure fate. The status is read with NO transport-error guard, so
   * the `fetch` call lives inside an async block whose rejection is deliberately left unobserved: the
   * returned promise NEVER SETTLES. Attaching a rejection handler here, or making this function `async`
   * so the caller's `await` observes the rejection, would turn that into an ordinary scrubbed 500.
   * See docs/PRESERVED-QUIRKS.md section 1.10.
   *
   * @param   {String} g_recaptcha_response The token the client submitted.
   * @returns {Promise<Object>} The verification result object described above.
   */
  verify : function(g_recaptcha_response) {
    if (config.isTest || !config.app.recaptcha || !config.app.recaptcha.secretkey) {
      return Promise.resolve({ success : true });
    }

    return new Promise(function(resolve) {
      // The URLSearchParams body sends these fields as application/x-www-form-urlencoded, which is
      // the encoding the verification endpoint expects.
      (async function() {
        var response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method : 'POST'
          , body   : new URLSearchParams({
                secret   : config.app.recaptcha.secretkey
              , response : g_recaptcha_response
            })
        });

        if (response.status === 200) {
          resolve(JSON.parse(await response.text()));
        }
        else {
          resolve({ status : false });
        }
      })();
    });
  }
};
