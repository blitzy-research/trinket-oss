var sinon  = require('sinon'),
    mailer = require('../../lib/util/mailer');

module.exports = {
  mailer : mailer,
  stub   : function() {
    before(function() {
      // R-6 ADJUDICATION. Stubbing `send` alone is not a complete mail double, because every mail-sending
      // handler is fronted by a configuration guard: `lib/controllers/users.js:286` (sendPassReset) and the
      // six sibling guards at users.js:1055/1121/1199, course.js:928/986 and trinket.js:871 all begin with
      // `if (!mailer.isConfigured()) return request.fail(...)`. Those guards are present at the base commit
      // too (measured: `git show 2f8712a:lib/controllers/users.js` line 229 is byte-identical), and
      // `config/default.yaml` - which is frozen - ships `app.mail.from` and `app.mail.host` as empty
      // strings with no override in config/test.yaml, so `isConfigured()` is falsy under test and
      // sendPassReset short-circuited to its "Email is not configured" failure flash. That is why
      // `Store.set` was never called and `mailer.send.calledOnce` could never be true. The server guard is
      // deliberately left exactly as it is - the empty-mail-config behaviour is base behaviour and is not
      // being "fixed" - and instead the double is completed here so the suite can exercise the path it
      // already asserts. The stub returns a non-empty host string rather than `true` because
      // `lib/util/mailer.js:20-23` returns the RAW truthiness expression (the host) and its own comment
      // records that callers must not see it coerced.
      sinon.stub(mailer, 'isConfigured').returns('smtp.example.test');
      sinon.stub(mailer, 'send').returns(Promise.resolve());
    });

    after(function() {
      mailer.isConfigured.restore();
      mailer.send.restore();
    });
  }
};
