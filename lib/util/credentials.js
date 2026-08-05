/**
 * Centralized credential redaction for response payloads.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Four HTTP-200 response surfaces ship a User document by JSON-CLONING it whole rather than by
 * projecting `User.publicSpec`, so each of them carried the subject's bcrypt hash - and, for a
 * Google-linked subject, a LIVE OAuth bearer credential - onto the wire (review findings SEC-13 / M6 /
 * SV-03). They divide into two mechanisms, and both are wired to this module:
 *
 *   1. THE SHARED SERIALIZER, which is the root cause.
 *      lib/models/model.js#serialize walks `publicSpec` and, for a nested object, tests
 *      `this[key].hasOwnProperty('serialize')`. Mongoose installs `serialize` on the document
 *      PROTOTYPE, so that test is FALSE for every populated sub-document and the branch falls through
 *      to `JSON.parse(JSON.stringify(...))`. `Course.publicSpec` whitelists `_owner` and `setOwner`
 *      assigns the populated User document to it, so:
 *        - lib/controllers/course.js#create -> POST /api/courses, and POST /courses through the
 *          server.inject in lib/controllers/courses.js#create
 *      shipped the owner's whole document. Scrubbing inside that one branch closes this class for every
 *      route that serializes a model with a populated sub-document, present or future, rather than one
 *      route at a time.
 *   2. THE TWO CLONES THAT BYPASS THE SERIALIZER ENTIRELY, which the shared fix cannot reach:
 *      - lib/controllers/admin.js#grantRole  (PUT /api/admin/user/{id})
 *      - lib/controllers/admin.js#userSearch (GET /admin/users, rendered into the admin page)
 *      Both call `JSON.parse(JSON.stringify(user))` in the handler, which flattens the document to a
 *      plain object BEFORE any responder runs, so `serialize` is never consulted at all.
 *
 * A top-level deny of one key name is not a projection, which is why an earlier revision's bare
 * `delete payload.password` was not enough. `User.schema.profiles` is declared as an untyped Mixed
 * object (lib/models/user.js:L18), and lib/controllers/auth.js:L232 and L253 write a LIVE Google OAuth
 * bearer credential into it as `profiles.google.token`. Cloning the document therefore carried that
 * bearer token past the `delete` and into an administrator's response body, the rendered admin page,
 * browser caches and any XSS-accessible response state - a second credential class the one-key
 * blacklist could not see, and the exact shape any future provider would take. `User.publicSpec` is
 * `{id, name, username, fullname, email, avatar, settings}`; it names neither `password` nor
 * `profiles`, so every surface that goes through a real `serialize()` projection was already clean and
 * only the clone bypasses leaked.
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
 * Comparison is EXACT on the normalized name, so `partnerToken` -> `partnertoken`, `resetKey` ->
 * `resetkey` and `verifyKey` -> `verifykey` are all outside the list and survive untouched.
 *
 * THE ONE PLACE THE DENY-LIST IS APPLIED GENERICALLY is the shared serializer's nested-clone branch, so
 * the model layer was censused before wiring it there rather than after. Across all 24 models, the only
 * schema field whose normalized name matches an entry is `User.password`. `CourseInvitation.token` - a
 * genuinely client-visible value, the invitation link's own key - is a TOP-LEVEL string in its own
 * `publicSpec`, so `serialize()` reaches it through the scalar `else` branch and never through the
 * nested-clone branch; `GET /api/courses/{courseId}/invitations` was verified to still carry it.
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
