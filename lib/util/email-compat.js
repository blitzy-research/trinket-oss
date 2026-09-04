/**
 * Legacy-compatible e-mail address validation.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The migration moves `validator` from 5.7.0 to 13.15.35, which is a security
 * change: the 5.x line carries a high advisory (fixed in 13.15.20). The API is
 * unchanged - `isEmail(str)` still takes a string and returns a boolean - but
 * the ANSWER changed for several classes of address, and this application
 * stores that answer.
 *
 * `lib/models/courseInvitation.js` is the only consumer of `isEmail` in the
 * repository, and it uses the result twice, both times to write a persisted
 * `status` field on a CourseInvitation document:
 *
 *   :52   addList()      status = "invalid" when the address is rejected,
 *                        otherwise "pending" - and "pending" is what
 *                        `sendEmails` later picks up and mails.
 *   :117  updateEmail()  status = "resend" when accepted, "invalid" when not.
 *
 * So a changed verdict is not a cosmetic difference: an address that validated
 * at baseline and does not validate now is stored with a different status and
 * is never mailed. Under R-d ("behaviour improvements PROHIBITED") and R-f
 * (baseline observed behaviour at 2f8712a is the tie-breaker), the verdict must
 * not move, so this module reproduces validator 5.7.0's `isEmail` exactly while
 * the package itself moves forward.
 *
 * MEASURED DIVERGENCES THIS MODULE RESTORES
 * -----------------------------------------
 * 31 addresses were put through both versions on Node 22.23.2. 27 agreed; four
 * flipped from accepted to invalid, and each flip has a distinct cause:
 *
 *   input                       5.7.0   13.15.35   cause
 *   --------------------------  -----   --------   ----------------------------
 *   foo..bar@gmail.com          true    false      5.7.0 strips EVERY dot from
 *                                                  the local part when the
 *                                                  domain is gmail.com or
 *                                                  googlemail.com, so the
 *                                                  consecutive dots disappear
 *                                                  before the local part is
 *                                                  checked at all. Note this is
 *                                                  domain-specific: the same
 *                                                  local part at example.com is
 *                                                  rejected by BOTH versions.
 *   fo<NBSP>o@example.com       true    false      5.7.0's UTF-8 local-part
 *   <NBSP>foo@example.com       true    false      class is \u00A0-\uD7FF, so
 *                                                  U+00A0 is inside it; 13.x
 *                                                  starts the class at \u00A1.
 *   a{64}@b{63}.c{63}.d{58}.com true    false      13.x added a 254-character
 *                                                  ceiling on the whole
 *                                                  address; 5.7.0 bounds only
 *                                                  the local part (64 bytes)
 *                                                  and the domain (256 bytes).
 *
 * WHAT IS PORTED AND WHAT IS DELEGATED
 * ------------------------------------
 * Everything that changed between the two versions is implemented here, taken
 * from validator 5.7.0's own source: the `isEmail` control flow, the gmail dot
 * stripping, the FQDN check (`isFDQN` in 5.7.0 - the typo is that release's,
 * not ours) and the local-part character classes.
 *
 * The byte-length check is DELEGATED to the installed `validator`, because it
 * did not change: `validator.isByteLength` is `encodeURI(str).split(/%..|./)
 * .length - 1` in both releases, and the two were measured identical across 19
 * inputs spanning ASCII, accented Latin, CJK, astral-plane characters, U+00A0
 * and the 64/256-byte boundaries. Delegating it keeps one behaviour in one
 * place instead of copying a function that has no divergence to preserve.
 *
 * SCOPE OF THE PORT
 * -----------------
 * validator 5.7.0's `isEmail` takes an options argument. Both call sites pass
 * none, so the defaults apply and are baked in here rather than re-exposed:
 * `allow_display_name: false`, `allow_utf8_local_part: true` and
 * `require_tld: true`. With those fixed, the display-name branch is
 * unreachable and only the UTF-8 local-part expressions can run, so what
 * follows is complete for every possible input to `isEmail(str)` - it is a
 * narrower interface than 5.7.0's, not a partial implementation of it.
 */

var validator = require('validator');

/*
 * Local-part expressions, verbatim from validator 5.7.0.
 *
 * `allow_utf8_local_part` defaults to true, so these are the two that run. The
 * upper bound of the first class is what accepts U+00A0 (see the divergence
 * table above); 13.x narrows it to \u00A1 and therefore rejects it.
 */
/* eslint-disable no-control-regex */
var quotedEmailUserUtf8 = /^([\s\x01-\x08\x0b\x0c\x0e-\x1f\x7f\x21\x23-\x5b\x5d-\x7e\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]|(\\[\x01-\x09\x0b\x0c\x0d-\x7f\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))*$/i;
var emailUserUtf8Part = /^[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+$/i;
/* eslint-enable no-control-regex */

/*
 * Domain expressions, verbatim from validator 5.7.0's `isFDQN`.
 *
 * 13.x rewrote this check - it added `allow_numeric_tld`, `allow_wildcard` and
 * `ignore_max_length`, and its TLD class differs - so it is ported rather than
 * delegated.
 */
var fqdnTld = /^([a-z\u00a1-\uffff]{2,}|xn[a-z0-9-]{2,})$/i;
var fqdnPart = /^[a-z\u00a1-\uffff0-9-]+$/i;
var fqdnFullWidth = /[\uff01-\uff5e]/;

/**
 * validator 5.7.0's `isFDQN(str, {require_tld: true})`.
 *
 * `allow_trailing_dot` and `allow_underscores` are false by default, so the
 * trailing-dot strip and the underscore strip never run and are not carried
 * over; every other rule is reproduced in order, because the order decides
 * which rule rejects a given domain and therefore is itself behaviour.
 *
 * @param {string} str Domain part of the address.
 * @returns {boolean} True when the domain is a fully-qualified domain name.
 */
function isFullyQualifiedDomain(str) {
  var parts = str.split('.');
  var tld = parts.pop();
  var part;
  var i;

  // require_tld is true: there must be at least one label before the TLD, and
  // the TLD itself must be two or more letters, or a punycode `xn` prefix.
  if (!parts.length || !fqdnTld.test(tld)) {
    return false;
  }

  for (i = 0; i < parts.length; i++) {
    part = parts[i];

    if (!fqdnPart.test(part)) {
      return false;
    }

    // Full-width characters are rejected outright, even though the class above
    // would otherwise admit them.
    if (fqdnFullWidth.test(part)) {
      return false;
    }

    if (part[0] === '-' || part[part.length - 1] === '-') {
      return false;
    }
  }

  return true;
}

/**
 * validator 5.7.0's `isEmail(str)` with that release's default options.
 *
 * The steps are in 5.7.0's order, and the order matters: the gmail dot strip
 * happens BEFORE the local part is length-checked or pattern-matched, which is
 * why `foo..bar@gmail.com` is accepted while `foo..bar@example.com` is not.
 *
 * A non-string input throws a TypeError with 5.7.0's own message, because
 * `assertString` did. Neither call site can reach that - `courseInvitation`
 * lower-cases the value first, which would throw earlier - but the behaviour is
 * preserved rather than quietly changed to a `false` return.
 *
 * @param {string} str Address to validate.
 * @returns {boolean} True when the address is valid.
 * @throws {TypeError} When `str` is not a string.
 */
function isEmail(str) {
  var parts;
  var domain;
  var user;
  var lowerDomain;
  var userParts;
  var i;

  if (typeof str !== 'string') {
    throw new TypeError('This library (validator.js) validates strings only');
  }

  // Split on the LAST '@': everything before it is the local part, so an
  // address containing several '@' keeps the earlier ones in the local part
  // (where the pattern check below then rejects them).
  parts = str.split('@');
  domain = parts.pop();
  user = parts.join('@');

  lowerDomain = domain.toLowerCase();

  // The gmail special case. 5.7.0 folds the local part the way Gmail itself
  // does - dots are not significant - so a local part that would otherwise be
  // rejected for consecutive or leading dots is accepted for these two domains.
  if (lowerDomain === 'gmail.com' || lowerDomain === 'googlemail.com') {
    user = user.replace(/\./g, '').toLowerCase();
  }

  // Delegated: identical in 5.7.0 and 13.15.35 (see the module header). Note
  // that 5.7.0 bounds the two parts separately and imposes no ceiling on the
  // address as a whole - that absence is one of the four divergences.
  if (!validator.isByteLength(user, { max: 64 }) ||
      !validator.isByteLength(domain, { max: 256 })) {
    return false;
  }

  if (!isFullyQualifiedDomain(domain)) {
    return false;
  }

  // A quoted local part is validated as one unit, after the surrounding quotes
  // are removed. 5.7.0 tests only for a leading quote, so `"foo@example.com`
  // takes this branch and has its first and last characters stripped.
  if (user[0] === '"') {
    user = user.slice(1, user.length - 1);
    return quotedEmailUserUtf8.test(user);
  }

  // Otherwise every dot-separated label of the local part must match on its
  // own. Because the pattern requires one or more characters, an empty label -
  // which is what a leading, trailing or doubled dot produces - fails. That is
  // exactly why the gmail strip above changes the verdict.
  userParts = user.split('.');

  for (i = 0; i < userParts.length; i++) {
    if (!emailUserUtf8Part.test(userParts[i])) {
      return false;
    }
  }

  return true;
}

module.exports = {
  isEmail: isEmail
};
