/**
 * Centralized credential redaction for response payloads.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Three response surfaces ship a User document by JSON-cloning it whole rather than by projecting
 * `User.publicSpec`, and each of them removed exactly one credential key - the top-level `password` -
 * with a bare `delete`:
 *
 *   - lib/controllers/admin.js#grant      (PUT /api/admin/user/{id})
 *   - lib/controllers/admin.js#userSearch (GET /admin/users, rendered into the admin page)
 *   - lib/controllers/course.js#create    (POST /api/courses, and POST /courses through server.inject)
 *
 * A top-level deny of one key name is not a projection. `User.schema.profiles` is declared as an
 * untyped Mixed object (lib/models/user.js:L18), and lib/controllers/auth.js:L232 and L253 write a LIVE
 * Google OAuth bearer credential into it as `profiles.google.token`. Cloning the document therefore
 * carried that bearer token past the `delete payload.password` and into an administrator's response
 * body, the rendered admin page, browser caches and any XSS-accessible response state - a second
 * credential class the one-key blacklist could not see, and the exact shape any future provider would
 * take. `User.publicSpec` is `{id, name, username, fullname, email, avatar, settings}`; it names neither
 * `password` nor `profiles`, so every surface that goes through the normal serialize path was already
 * clean and only the clone bypass leaked.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------
 * `redact(value)` returns a NEW structure with every credential-named key removed at EVERY depth,
 * leaving all other keys byte-identical. It is a deny-list rather than an allow-list on purpose: the
 * payload shape of these three responses is the base commit's shape and R-4 forbids changing it, so
 * switching them to `ObjectUtils.pull(User.publicSpec, ...)` would drop `roles`, `verified`, `source`,
 * `coursesOwned`, `trinketsOwned` and `tags`, all of which the admin page and the course response
 * genuinely read. Removing a value no client may legitimately read is observably neutral; removing
 * values the templates render is not.
 *
 * The deny-list is closed and documented rather than heuristic (it does not, for example, match every
 * key containing the substring "token"), because two legitimate, client-visible fields would be caught
 * by such a heuristic: `Trinket.partnerToken`, which lib/models/trinket.js#generatePartnerToken creates
 * and the embed surface relies on, and the `verifyKey`/`resetKey` style values carried in e-mail links.
 * This module is applied to User documents only, at the three sites above.
 *
 * Key comparison is case-insensitive and ignores `_`/`-` separators, so `accessToken`, `access_token`,
 * `Access-Token` and `ACCESSTOKEN` are one entry rather than four.
 */

/**
 * The credential classes that may never appear in a response body. Every entry is normalized the same
 * way a candidate key is, so only the canonical spelling needs to be listed here.
 *
 * `password`      - the bcrypt hash on the User document (review finding SEC-13).
 * `token`         - `profiles.<provider>.token`, the live OAuth bearer credential auth.js persists.
 * `accessToken`   - the same credential under the spelling Google's token endpoint returns.
 * `refreshToken`  - a long-lived provider credential; not persisted today, and denied pre-emptively so
 *                   that adding an offline-access flow cannot reopen this hole.
 * `idToken`       - an OIDC assertion, equally bearer-like.
 * `secret` /
 * `clientSecret`  - provider application secrets, should any ever be copied onto a document.
 * `apiKey`        - the generic third-party credential spelling.
 * `sessionToken`  - a session bearer value.
 * `resetToken`    - a password-reset bearer value.
 *
 * @type {string[]}
 */
var CREDENTIAL_KEYS = [
    'password'
  , 'token'
  , 'accessToken'
  , 'refreshToken'
  , 'idToken'
  , 'secret'
  , 'clientSecret'
  , 'apiKey'
  , 'sessionToken'
  , 'resetToken'
];

/**
 * Folds a key to the spelling the deny-list is compared against: lower case, with `_` and `-`
 * separators removed.
 *
 * @param {string} key A property name.
 * @returns {string} The normalized form.
 */
function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[_-]/g, '');
}

var DENIED = CREDENTIAL_KEYS.reduce(function(set, key) {
  set[normalizeKey(key)] = true;
  return set;
}, {});

/**
 * True when a property name names one of the credential classes above.
 *
 * @param {string} key A property name.
 * @returns {boolean} Whether the property must be removed.
 */
function isCredentialKey(key) {
  return DENIED[normalizeKey(key)] === true;
}

/**
 * Deep-copies `value` with every credential-named property removed at every depth.
 *
 * Only plain objects and arrays are traversed. A `Date`, `Buffer`, `RegExp` or any other non-plain
 * object is returned by reference, because these payloads are JSON-serialized on the way out and
 * rebuilding such values would change their serialized form. Cycles are not reachable here - the input
 * is always the result of a `JSON.parse(JSON.stringify(...))` round-trip, which cannot contain one -
 * but a `seen` set is carried anyway so that a future caller handing over a live document cannot make
 * this recurse forever.
 *
 * @param {*} value The payload to scrub. Any type is accepted.
 * @param {WeakSet} [seen] Internal cycle guard; callers do not pass this.
 * @returns {*} A scrubbed copy for plain objects and arrays; `value` itself for everything else.
 */
function redact(value, seen) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  seen = seen || new WeakSet();

  if (seen.has(value)) {
    return value;
  }

  if (Array.isArray(value)) {
    seen.add(value);
    return value.map(function(entry) {
      return redact(entry, seen);
    });
  }

  // Anything with a prototype other than Object.prototype (or a null prototype) is a Date, Buffer,
  // ObjectId, RegExp or similar. Copying its own enumerable keys would destroy it, so it is passed
  // through untouched.
  var proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }

  seen.add(value);

  var result = {};

  Object.keys(value).forEach(function(key) {
    if (isCredentialKey(key)) {
      return;
    }

    result[key] = redact(value[key], seen);
  });

  return result;
}

module.exports = {
    redact          : redact
  , isCredentialKey : isCredentialKey
  , CREDENTIAL_KEYS : CREDENTIAL_KEYS
};
