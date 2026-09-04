var sinon  = require('sinon'),
    Q      = require('q'),
    mailer = require('../../lib/util/mailer');

module.exports = {
  mailer : mailer,
  stub   : function() {
    before(function() {
      // `send` is replaced so no suite ever opens an SMTP connection.
      sinon.stub(mailer, 'send').returns(Q.resolve());

      // `isConfigured` has to be replaced as well, and this is provisioning
      // rather than a behaviour change.
      //
      // lib/util/mailer.js:6-9 reports mail configured only when
      // config.app.mail.from AND config.app.mail.host are both non-empty, and
      // config/default.yaml:135-136 ships both empty because SMTP is a
      // deployment-supplied credential. Every handler that sends mail therefore
      // short-circuits before it reaches `send`: lib/controllers/users.js:268
      // answers request.fail({message:'Email is not configured. Password reset
      // is not available.'}) and lib/controllers/trinket.js does the same for
      // 'Sharing via email is not available.'. Measured against this checkout,
      // that short-circuit is what made the four Forgot Password cases and the
      // trinket share-with-token case fail: Store.set was never called, so
      // `Store.set.firstCall` was null, and the share route never reached
      // `mailer.send`.
      //
      // Stubbing the predicate alongside the transport is the same technique
      // test/helpers/store.js already uses to stand in for Redis: the suite
      // supplies the external dependency it needs instead of the application
      // changing to suit the suite. config/default.yaml keeps its empty
      // production defaults, and only the suites that call mail.stub() see mail
      // as available.
      sinon.stub(mailer, 'isConfigured').returns(true);
    });

    after(function() {
      mailer.send.restore();
      mailer.isConfigured.restore();
    });
  }
};
