/**
 * Centralized credential redaction for response payloads.
 *
 * WHY THIS MODULE EXISTS. Some HTTP-200 surfaces ship a User document by JSON-CLONING it whole rather
 * than by projecting `User.publicSpec`, which carries the subject's bcrypt hash and, for a
 * Google-linked subject, a live OAuth bearer credential. There are two mechanisms, both wired here:
 *
 *   1. THE SHARED SERIALIZER. lib/models/model.js#serialize tests
 *      `this[key].hasOwnProperty('serialize')` for a nested object, and mongoose installs `serialize`
 *      on the document PROTOTYPE, so that test is FALSE for every populated sub-document and the
 *      branch falls through to `JSON.parse(JSON.stringify(...))`. Scrubbing inside that one branch
 *      covers every route that serializes a model with a populated sub-document.
 *   2. THE TWO CLONES THAT BYPASS THE SERIALIZER. `lib/controllers/admin.js#grantRole` and
 *      `#userSearch` each call `JSON.parse(JSON.stringify(user))` in the handler, which flattens the
 *      document to a plain object BEFORE any responder runs, so `serialize` is never consulted.
 *
 * A top-level deny of one key name is not enough: `User.schema.profiles` is an untyped Mixed object
 * and lib/controllers/auth.js writes a live Google OAuth bearer credential into it as
 * `profiles.google.token`, one level down. `User.publicSpec` names neither `password` nor `profiles`,
 * so every surface that goes through a real `serialize()` projection was already clean.
 *
 * WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT DO. `redact(value)` is a deny-list rather than an
 * allow-list on purpose: the payload SHAPE of these responses is frozen, so switching them to
 * `ObjectUtils.pull(User.publicSpec, ...)` would drop `roles`, `verified`, `source`, `coursesOwned`,
 * `trinketsOwned` and `tags`, all of which the admin page and the course response genuinely read.
 *
 * The deny-list is closed and exact rather than heuristic, because two legitimate client-visible
 * fields would be caught by a substring match on "token": `Trinket.partnerToken`, which the embed
 * surface relies on, and the `verifyKey`/`resetKey` values carried in e-mail links. Comparison is
 * EXACT on the normalized name, so `partnerToken`, `resetKey` and `verifyKey` all survive. Key
 * comparison is case-insensitive and ignores `_`/`-`, so `accessToken`, `access_token`,
 * `Access-Token` and `ACCESSTOKEN` are one entry rather than four.
 *
 * TRAVERSAL BOUNDARIES - see redact() for the precise contract. Only ACYCLIC PLAIN objects and
 * arrays are rebuilt. A Date, Buffer, ObjectId, RegExp, class instance or any other non-plain object
 * is returned BY REFERENCE and is NOT scrubbed, and so is an already-visited reference in a cyclic
 * structure. Callers hand this module the result of a `JSON.parse(JSON.stringify(...))` round-trip,
 * which contains neither, so within those call sites every credential-named key at every depth is
 * removed - but the guarantee is a property of the input, not of the traversal.
 *
 * Across the 24 models the only schema field whose normalized name matches an entry is
 * `User.password`. `CourseInvitation.token` - a genuinely client-visible value, the invitation link's
 * own key - is a TOP-LEVEL string in its own `publicSpec`, so `serialize()` reaches it through the
 * scalar `else` branch and never through the nested-clone branch.
 */

/**
 * The credential classes this module removes. Every entry is normalized the same way a candidate key
 * is, so only the canonical spelling needs to be listed here.
 *
 * `password`      - the bcrypt hash on the User document.
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
 * Copies `value`, removing credential-named properties from acyclic plain objects and arrays at every
 * depth.
 *
 * The traversal has three deliberate boundaries, and each returns the input BY REFERENCE without
 * scrubbing it:
 *   - a primitive, `null` or `undefined`;
 *   - any object whose prototype is neither `Object.prototype` nor `null` - a Date, Buffer, ObjectId,
 *     RegExp or class instance - because these payloads are JSON-serialized on the way out and
 *     rebuilding such a value would change its serialized form;
 *   - a value already visited on the current path, which is how the cycle guard terminates.
 * So a credential key nested inside a non-plain object, or reachable only through a cycle, is NOT
 * removed. Callers hand over the result of a `JSON.parse(JSON.stringify(...))` round-trip, which
 * contains neither shape.
 *
 * @param {*} value The payload to scrub. Any type is accepted.
 * @param {WeakSet} [seen] Internal cycle guard; callers do not pass this.
 * @returns {*} A scrubbed copy for acyclic plain objects and arrays; `value` itself otherwise.
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
  // through untouched - and therefore unscrubbed; see the traversal boundaries above.
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
