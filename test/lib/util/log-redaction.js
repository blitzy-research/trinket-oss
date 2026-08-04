/**
 * Coverage for the one security remediation this migration's own code introduced and keeps, because it
 * is not client-observable:
 *
 *   F-16 / S-2 (CWE-532) - `lib/http/responseContract.js#reject` logs the failure payload it is handed
 *                          and `lib/http/validation.js` hands it `request.payload`, so a failed signup
 *                          wrote the submitted password to the application log in cleartext. The
 *                          payload is redacted on the way to the LOG ONLY; the object that is flashed,
 *                          re-rendered and returned is untouched, so every byte on the wire is the base
 *                          commit's. That is what keeps it inside the frozen behavior contract.
 *
 * The same-origin destination filter this file also used to cover is gone: code review ruled it an
 * unauthorized behavior change under R-1/R-4, so `lib/http/redirect.js` no longer confines a
 * user-controlled `next` and the open-redirect condition is catalogued in
 * docs/PRESERVED-QUIRKS.md section 4.4 instead. The baseline destination behavior that replaced it is
 * asserted over real HTTP in test/lib/api/route-parity.js, where the emitted Location can be measured.
 *
 * Unit-level on purpose: the remediation needs no listening server, so it runs in milliseconds and
 * cannot disturb the shared database state the serial `test/lib/api` sequence depends on.
 */
var should   = require('chai').should(),
    util     = require('util'),
    Contract = require('../../../lib/http/responseContract');

describe('failure-log redaction (F-16)', function() {

  it('replaces every secret-bearing key on the way to the log', function() {
    var redacted = Contract.redactSecrets({
      username        : 'instructor',
      password        : 'hunter2',
      password_verify : 'hunter2',
      formName        : 'sign-up',
      nested          : { apiKey : 'abc', token : 'tok', keep : 'yes' },
      list            : [{ secret : 's' }, 'plain']
    });

    redacted.password.should.eql('[REDACTED]');
    redacted.password_verify.should.eql('[REDACTED]');
    redacted.nested.apiKey.should.eql('[REDACTED]');
    redacted.nested.token.should.eql('[REDACTED]');
    redacted.list[0].secret.should.eql('[REDACTED]');

    // Everything that is not a credential still reads exactly as it did, because the log line is
    // how a failed signup is diagnosed.
    redacted.username.should.eql('instructor');
    redacted.formName.should.eql('sign-up');
    redacted.nested.keep.should.eql('yes');
    redacted.list[1].should.eql('plain');
  });

  it('never mutates the object that is flashed and re-rendered', function() {
    var payload = { username : 'instructor', password : 'hunter2' };

    Contract.redactSecrets(payload);

    // The response half of the contract is frozen: reject() flashes and returns this very object.
    payload.password.should.eql('hunter2');
  });

  it('passes non-container values through, so an Error still logs what it always did', function() {
    var error = new Error('boom');

    Contract.redactSecrets(error).should.equal(error);
    Contract.redactSecrets('a string').should.eql('a string');
    should.equal(Contract.redactSecrets(null), null);
    Contract.redactSecrets(7).should.eql(7);
  });

  it('terminates on a cyclic payload without handing the unwalked original back', function() {
    var payload = { password : 'hunter2' };

    payload.self = payload;

    var logged = util.inspect(Contract.redactSecrets(payload));

    logged.should.contain('[REDACTED]');
    logged.should.contain('[Circular]');
    // The stop condition must yield a MARKER, not `payload` itself: util.inspect renders a
    // cycle one level below where it is found, so returning the container would print the
    // plaintext at that level and defeat the whole pass.
    logged.should.not.contain('hunter2');
  });

  it('stops at the depth cap with a marker, so a deeply buried credential cannot slip through',
    function() {
      var leaf = { password : 'hunter2' };
      var payload = { a : { b : { c : { d : { e : { f : leaf } } } } } };

      var logged = util.inspect(Contract.redactSecrets(payload), { depth : 12 });

      logged.should.contain('[Depth limit]');
      logged.should.not.contain('hunter2');
    });

  it('redacts a value that is referenced twice, because only a true cycle stops the walk',
    function() {
      var shared = { token : 'abc123' };
      var payload = { first : shared, second : shared };

      var logged = util.inspect(Contract.redactSecrets(payload), { depth : 6 });

      logged.should.not.contain('abc123');
      logged.should.not.contain('[Circular]');
    });

  it('recognises a secret-bearing validation fieldPath by its leaf, and only when key is a word',
    function() {
      Contract.isSecretField('password').should.be.true;
      Contract.isSecretField('user.password').should.be.true;
      Contract.isSecretField('resetKey').should.be.true;
      Contract.isSecretField('reset_password_key').should.be.true;
      Contract.isSecretField('username').should.be.false;
      Contract.isSecretField('email').should.be.false;
      Contract.isSecretField('monkey').should.be.false;
      Contract.isSecretField('keystone').should.be.false;
    });
});
