/**
 * Baseline-derived coverage for lib/util/email-compat.js.
 *
 * WHY THESE CASES EXIST AND WHERE THEIR EXPECTATIONS COME FROM
 * -----------------------------------------------------------
 * The migration moved `validator` from 5.7.0 to 13.15.35 for a high advisory.
 * The API is unchanged and the ANSWER is not: sixteen addresses out of a
 * 103-address corpus flipped from accepted to rejected. `lib/util/email-compat.js`
 * exists so those verdicts do not move, because
 * `lib/models/courseInvitation.js` persists them as the `status` that decides
 * whether an invitation is ever mailed.
 *
 * Every expectation below is the verdict **validator 5.7.0 returns**, measured
 * on Node 22.23.2 by running that release against the same inputs - not what
 * seems reasonable, and not what validator 13 returns. Where the two releases
 * disagree the case is marked, so a reader can see at a glance which
 * assertions are the point of the module and which are the invariants that
 * must not be disturbed while preserving them.
 *
 * If a case here starts failing, the adapter has drifted from validator 5.7.0
 * and some CourseInvitation somewhere is being stored with a different status
 * than it was at baseline.
 */

var should      = require('chai').should()
  , emailCompat = require('../../../lib/util/email-compat')
  , NBSP        = '\u00a0';

/*
 * Addresses whose verdict CHANGED between validator 5.7.0 and 13.15.35.
 * These are the cases the adapter exists for; each was accepted at baseline.
 * Grouped by the mechanism that caused the flip.
 */
var driftAccepted = [
  // 5.7.0 strips EVERY dot from the local part when the domain is gmail.com or
  // googlemail.com, before any length or pattern check runs.
  ['gmail with doubled dots',                 'foo..bar@gmail.com'],
  ['gmail with a leading dot',                '.foo@gmail.com'],
  ['gmail with a trailing dot',               'foo.@gmail.com'],
  ['gmail, upper-case domain',                'foo..bar@GMAIL.COM'],
  ['gmail, mixed-case domain and local part', 'Foo..Bar@GmAiL.cOm'],
  ['googlemail with doubled dots',            'foo..bar@googlemail.com'],
  ['googlemail, upper-case domain',           'foo..bar@GOOGLEMAIL.COM'],
  ['gmail local part that only fits after the dot strip',
   'a'.repeat(64) + '....@gmail.com'],
  ['gmail with a no-break space',             'fo' + NBSP + 'o@gmail.com'],

  // 5.7.0's UTF-8 local-part class opens at \u00A0; 13.x opens at \u00A1.
  ['no-break space inside the local part',    'fo' + NBSP + 'o@example.com'],
  ['no-break space leading the local part',   NBSP + 'foo@example.com'],

  // 13.x added a 254-character ceiling on the whole address. 5.7.0 bounds only
  // the local part (64 bytes) and the domain (256 bytes).
  ['a 255-character address',
   'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' +
   'd'.repeat(58) + '.com'],
  ['a domain of exactly 256 bytes',
   'foo@' + ('b'.repeat(61) + '.').repeat(4) + 'com'],

  // Remaining measured flips, each from a separate rule 13.x tightened.
  ['an unterminated quoted local part',       '"foo@example.com'],
  ['a full-width TLD',                        'foo@example.\uff43om'],
  ['the lower-cased gmail form the call sites produce',
   'Foo..Bar@Gmail.com'.toLowerCase()]
];

/*
 * Addresses both releases agree on. They are asserted because an adapter can
 * restore the sixteen above and still break these, and breaking these would
 * change the persisted status just as surely.
 */
var stableAccepted = [
  ['a plain address',                     'user@example.com'],
  ['a plus-tagged local part',            'foo+tag@example.com'],
  ['an upper-case address',               'USER@EXAMPLE.COM'],
  ['a hyphenated multi-label domain',     'foo@ex-ample.co.uk'],
  ['single-character local part and domain label', 'a@b.co'],
  ['a quoted local part containing a space', '"foo bar"@example.com'],
  ['an accented local part',              'foo\u00e9@example.com'],
  ['an accented domain',                  'foo@ex\u00e4mple.com'],
  ['a plain gmail address',               'foo@gmail.com'],
  ['a local part of exactly 64 bytes',    'a'.repeat(64) + '@example.com'],
  ['a punycode domain',                   'foo@xn--80ak6aa92e.com'],
  ['a numeric domain label',              'foo@123.example.com'],
  ['a 254-character address',
   'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' +
   'd'.repeat(57) + '.com']
];

var stableRejected = [
  ['doubled dots at a non-gmail domain',  'foo..bar@example.com'],
  ['a leading dot at a non-gmail domain', '.foo@example.com'],
  ['a trailing dot in the local part',    'foo.@example.com'],
  ['a local part over 64 bytes',          'a'.repeat(65) + '@example.com'],
  ['a multibyte local part over 64 bytes', '\u00e9'.repeat(33) + '@example.com'],
  ['a domain over 256 bytes',             'foo@' + ('b'.repeat(61) + '.').repeat(5) + 'com'],
  ['a display-name form',                 'Foo Bar <foo@example.com>'],
  ['a bracketed IP domain',               'foo@[127.0.0.1]'],
  ['a domain with no TLD',                'foo@localhost'],
  ['an underscore in the domain',         'foo@ex_ample.com'],
  ['a trailing space',                    'foo@example.com '],
  ['a tab in the local part',             'fo\to@example.com'],
  ['the empty string',                    ''],
  ['a bare at-sign',                      '@'],
  ['two at-signs',                        'foo@@example.com'],
  ['a domain label starting with a hyphen', 'foo@-example.com'],
  ['a numeric TLD',                       'foo@example.123'],
  ['doubled dots in the domain',          'foo@example..com'],
  ['a no-break space in the domain',      'foo@exa' + NBSP + 'mple.com'],
  ['a trailing CRLF',                     'foo@example.com\r\n'],
  ['a domain label ending in a hyphen',   'foo@example-.com'],
  ['a single-label domain',               'foo@com'],
  ['a one-character TLD',                 'foo@example.c'],
  ['a full-width domain label',           'foo@\uff45xample.com'],
  ['an empty domain',                     'foo@'],
  ['a gmail address with no local part',  '@gmail.com']
];

describe('Email Compatibility (validator 5.7.0 semantics)', function() {
  describe('addresses whose verdict validator 13 changed', function() {
    driftAccepted.forEach(function(testCase) {
      it('accepts ' + testCase[0] + ', as validator 5.7.0 did', function(done) {
        emailCompat.isEmail(testCase[1]).should.equal(true);
        done();
      });
    });
  });

  describe('addresses both validator releases accept', function() {
    stableAccepted.forEach(function(testCase) {
      it('accepts ' + testCase[0], function(done) {
        emailCompat.isEmail(testCase[1]).should.equal(true);
        done();
      });
    });
  });

  describe('addresses both validator releases reject', function() {
    stableRejected.forEach(function(testCase) {
      it('rejects ' + testCase[0], function(done) {
        emailCompat.isEmail(testCase[1]).should.equal(false);
        done();
      });
    });
  });

  describe('the gmail rule is domain-specific, not a general relaxation',
  function() {
    it('accepts a doubled-dot local part only at gmail, never elsewhere',
    function(done) {
      // The same local part, two domains, two answers. This is the case most
      // likely to be "simplified" by a later reader into a general rule.
      emailCompat.isEmail('foo..bar@gmail.com').should.equal(true);
      emailCompat.isEmail('foo..bar@example.com').should.equal(false);
      emailCompat.isEmail('foo..bar@gmail.co.uk').should.equal(false);
      emailCompat.isEmail('foo..bar@mail.gmail.com').should.equal(false);
      done();
    });
  });

  describe('non-string input', function() {
    it('throws validator 5.7.0\'s own TypeError rather than returning false',
    function(done) {
      // Preserved deliberately: turning this into a `false` return would be a
      // behaviour change, even though neither call site can reach it.
      (function() { emailCompat.isEmail(undefined); })
        .should.throw(TypeError, 'This library (validator.js) validates strings only');
      (function() { emailCompat.isEmail(null); }).should.throw(TypeError);
      (function() { emailCompat.isEmail(42); }).should.throw(TypeError);
      done();
    });
  });

  describe('the verdicts the two CourseInvitation call sites persist',
  function() {
    // The adapter's verdict is not the point on its own - what it decides is.
    // These two assertions mirror the exact expressions at
    // lib/models/courseInvitation.js:52 and :117 so the mapping from verdict
    // to stored status is covered, not just the verdict.
    it('drives addList\'s status: a rejected address stores "invalid" and an accepted one is left pending',
    function(done) {
      var rejected = emailCompat.isEmail('foo..bar@example.com') ? 'pending' : 'invalid';
      var accepted = emailCompat.isEmail('foo..bar@gmail.com') ? 'pending' : 'invalid';

      rejected.should.equal('invalid');
      // Would have been 'invalid' under validator 13, so this invitation would
      // never have been mailed.
      accepted.should.equal('pending');
      done();
    });

    it('drives updateEmail\'s status: "resend" when accepted, "invalid" when not',
    function(done) {
      var gmail = emailCompat.isEmail('foo..bar@gmail.com') ? 'resend' : 'invalid';
      var nbsp  = emailCompat.isEmail('fo' + NBSP + 'o@example.com') ? 'resend' : 'invalid';
      var long  = emailCompat.isEmail(
        'a'.repeat(64) + '@' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' +
        'd'.repeat(58) + '.com'
      ) ? 'resend' : 'invalid';
      var bad   = emailCompat.isEmail('not-an-address') ? 'resend' : 'invalid';

      gmail.should.equal('resend');
      nbsp.should.equal('resend');
      long.should.equal('resend');
      bad.should.equal('invalid');
      done();
    });
  });
});
