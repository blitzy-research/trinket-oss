/**
 * Coverage for the failure-log redaction in `lib/http/responseContract.js#reject`.
 *
 * That responder logs the failure payload it is handed, and `lib/http/validation.js` hands it
 * `request.payload`, so without redaction a failed signup writes the submitted password to the application
 * log in cleartext. The payload is redacted on the way to the LOG ONLY: the object that is flashed,
 * re-rendered and returned is untouched, so not one byte on the wire changes. Both halves are asserted
 * here — what the log receives, and that the response object is unmodified.
 *
 * Unit-level on purpose: the redaction needs no listening server, so it runs in milliseconds and cannot
 * disturb the shared database state the serial `test/lib/api` sequence depends on. The same-origin
 * destination filter is a separate contract, asserted in test/lib/util/same-origin-and-log-redaction.js and
 * over real HTTP in test/lib/api/route-parity.js.
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
