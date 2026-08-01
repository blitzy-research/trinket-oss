var nodemailer = require('nodemailer'),
    config     = require('config'),
    _          = require('underscore');

// Check if email is properly configured
//
// PRESERVED QUIRK 5 - see docs/PRESERVED-QUIRKS.md. This predicate requires
// `from` AND `host`, which is deliberately NOT the rule addUserContext() applies
// in lib/http/responseContract.js when it computes the template flag:
//   json.emailEnabled = hasFrom && (hasAWS || hasMailgun);
// So a deployment can advertise email to the frontend while this mailer refuses
// to send, and vice versa. The two rules disagree; the disagreement is 2013-era
// behavior that callers and templates may depend on, and it is documented here
// rather than reconciled.
//
// Note also that the return value is the RAW truthiness expression, not a
// boolean: with the shipped defaults config/default.yaml gives `from: ''`, so
// this returns the empty string rather than false. The seven call sites all use
// it as `if (!mailer.isConfigured())`, so it must not be coerced.
function isConfigured() {
  var mailConfig = config.app.mail;
  return mailConfig && mailConfig.from && mailConfig.host;
}

// Create reusable transporter
function createTransport() {
  var mailConfig = config.app.mail;

  return nodemailer.createTransport({
    host: mailConfig.host,
    port: mailConfig.port || 587,
    secure: mailConfig.secure || false,
    auth: {
      user: mailConfig.user,
      pass: mailConfig.pass
    }
  });
}

module.exports = {
  isConfigured: isConfigured,

  send: async function(to, subject, options) {
    // This is the DEFAULT path, not an edge case: config/default.yaml ships
    // `app.mail.from` and `app.mail.host` as empty strings, so an out-of-the-box
    // install and the whole test suite take this branch. The log line below stays
    // (docs/PRESERVED-QUIRKS.md section 1.12) and the returned object's two keys,
    // their order and the exact reason string are consumed by callers and tests.
    if (!isConfigured()) {
      console.log('Email not configured, skipping send to:', to);
      return { skipped: true, reason: 'Email not configured' };
    }

    options = _.extend({
      from: config.app.mail.from,
      to: to,
      subject: subject
    }, options || {});

    var transport = createTransport();

    // nodemailer 9 returns a promise when sendMail is called without a callback,
    // which replaces the hand-rolled deferred this used to wrap around the
    // error-first callback. Awaiting it preserves the error contract exactly:
    // a send failure rejects this function's promise with the RAW nodemailer
    // error, and success resolves with nodemailer's response object unwrapped.
    // The rejection is deliberately left untrapped - swallowing, wrapping or
    // logging it would change the error-to-response mapping downstream, where
    // lib/http/errorMap.js maps an unhandled failure onto a scrubbed HTTP 500.
    return await transport.sendMail(options);
  }
};
