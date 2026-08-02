var nodemailer = require('nodemailer'),
    config     = require('config'),
    _          = require('underscore');

// Check if email is properly configured
//
// This predicate requires `from` and `host`, which is deliberately not the rule addUserContext()
// applies in lib/http/responseContract.js, so a deployment can advertise email to the frontend while
// this mailer refuses to send. The return value is the raw truthiness expression rather than a boolean
// - with the shipped `from: ''` it is the empty string - and every call site uses it as
// `if (!mailer.isConfigured())`, so it must not be coerced.
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
    // This is the default path, not an edge case: config/default.yaml ships `app.mail.from`
    // and `app.mail.host` as empty strings. The log line below stays
    // (docs/PRESERVED-QUIRKS.md section 1.12), and the returned object's two keys, their
    // order and the exact reason string are consumed by callers and tests.
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

    return await transport.sendMail(options);
  }
};
