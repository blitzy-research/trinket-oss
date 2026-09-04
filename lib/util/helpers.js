var _                 = require('underscore'),
    Boom              = require('@hapi/boom'),
    config            = require('config'),
    crypto            = require('crypto'),
    Store             = require('./store'),
    features          = require('./features'),
    trinketStore      = Store.trinkets(),
    courseStore       = Store.courses(),
    userStore         = Store.users(),
    jwt               = require('jsonwebtoken'),
    defaultNextResult = true, // use this if your helper doesn't return a value
    internals         = {};

// ---------------------------------------------------------------------------
// Email share token (JWT) parameters
//
// The email share token is minted by lib/controllers/trinket.js (three sites:
// :313-314, :369-370, :661-662) as `jwt.sign({shortCode: ...}, secret)` and is
// consumed by `verifyEmailToken` below, which is the only verifier. Both sides
// read the key material from `config.app.mail.secret`, so the parameters that
// bound the token live here, next to the verifier that enforces them.
// ---------------------------------------------------------------------------

// The only signature algorithm `jwt.verify` may accept. `jwt.sign(payload,
// secret)` with no options - the exact form all three signers use - produces
// HS256, so the allow-list is exactly one entry. Passing it is what closes the
// algorithm-confusion half of the finding: with no `algorithms` option,
// jsonwebtoken honours whatever `alg` the token's own header names, which lets
// a caller choose the verification algorithm for us.
var EMAIL_TOKEN_ALGORITHMS = ['HS256'];

// How long a signed email share token stays acceptable. The signers stamp no
// `exp` claim, so the lifetime has to be imposed at verification time through
// `maxAge`, which jsonwebtoken measures from the `iat` claim.
var EMAIL_TOKEN_MAX_AGE = '24h';

// Shortest configured `app.mail.secret` treated as usable key material. 32
// characters is the same floor app.js:50 applies to the session cookie
// password, kept identical so one operator-facing rule covers both secrets.
var EMAIL_TOKEN_MIN_SECRET_LENGTH = 32;

// Domain-separation label for the derived-key fallback below. It keeps the
// derived email-token key distinct from the secret it is derived from, so the
// two are never interchangeable even though one is computed from the other.
var EMAIL_TOKEN_DERIVATION_LABEL = 'trinket:app.mail.secret:v1';

/**
 * Emits the one line the fallbacks below owe the operator.
 *
 * SEVERITY IS TIER-DEPENDENT ON THE ENVIRONMENT, not fixed. Outside production
 * a derived or generated key is an ordinary development convenience and the
 * line is informational. In production it is a misconfiguration with security
 * consequences - either the email share token key is only as separate as an
 * HMAC of the session secret, or it does not survive a restart - so the line
 * is emitted at error level, where an operator's alerting will see it. Nothing
 * throws and nothing exits either way: see resolveEmailTokenSecret for why
 * this module must not take out the boot or the gate tools that load it.
 *
 * Written as a helper because of two measured constraints on where that line
 * may go:
 *
 *   1. `log` is an implicit global assigned only at app.js:19, so it does NOT
 *      exist in every process that loads this file. `node lib/util/routeParser
 *      .js -R` and `node test/parity/manifest.js` both reach this module
 *      through config/api_routes.js with `typeof log === 'undefined'`
 *      (measured), so the reference has to be guarded rather than assumed.
 *   2. The fallback writes to STDERR. AAP 0.9.1 compares the route-table CLI's
 *      STDOUT byte for byte (112 data rows) with stderr discarded, so a line
 *      on stdout would fail that gate. winston's Console transport sends
 *      `info` to stdout, which is why the guarded `log.info` path is only
 *      taken in a process that has a logger configured for it.
 *
 * The wording deliberately carries none of the tokens
 * test/parity/warning-policy.js classifies as a deprecation notice, and is
 * modelled on the line app.js:89 already emits for the generated session
 * cookie password, which passes that gate.
 *
 * @param {string} message The single line to emit.
 * @returns {undefined}
 */
function reportEmailTokenSecret(message) {
  var inProduction = process.env.NODE_ENV === 'production';

  if (typeof log !== 'undefined' && log) {
    if (inProduction && typeof log.error === 'function') {
      log.error(message);
      return;
    }

    if (typeof log.info === 'function') {
      log.info(message);
      return;
    }
  }

  console.error(message);
}

/**
 * Resolves the email share token key material ONCE, at module load.
 *
 * WHY THIS EXISTS. config/default.yaml:133-140 declares `app.mail` with
 * from/host/port/user/pass/secure and no `secret` key at all, so
 * `config.app.mail.secret` is `undefined` and the key every signer and this
 * verifier computed was the literal string `'undefined' + shortCode`. The
 * shortCode is public - it is in the trinket's own URL - so the HMAC key was
 * derived entirely from public data and anyone could mint a token this
 * verifier accepts. That is the CWE-321 half of SEC-F22.
 *
 * WHY THE RESOLVED VALUE IS INSTALLED BACK ONTO `config.app.mail`. The three
 * signers live in lib/controllers/trinket.js and read
 * `config.app.mail.secret + shortCode` directly; test/lib/api/trinket.js:1338
 * reads the same property at call time. Publishing the resolved value through
 * the property both sides already read is what keeps signing and verification
 * interoperable without editing any other file.
 *
 * WHY `Object.defineProperty` AND NOT AN ASSIGNMENT. This is the mechanism
 * app.js:82-90 already uses for the session cookie password, for the reason
 * its comment gives there: the npm `config` package watches every property
 * through an accessor and persists any assignment to config/runtime.json.
 * Writing this secret there would put it on disk, make it outlive the process
 * and - since runtime.json is layered over every other source - let a later
 * run pick up a value it never configured. Replacing the accessor with a data
 * descriptor keeps the value visible to every reader and persists nothing.
 *
 * RESOLUTION ORDER, most preferred first:
 *
 *   1. A configured `app.mail.secret` of at least
 *      EMAIL_TOKEN_MIN_SECRET_LENGTH characters is used unchanged and nothing
 *      is logged or installed. A correctly configured deployment is untouched
 *      by all of this.
 *   2. Otherwise, if the session cookie password is configured to at least the
 *      same length, the key is derived from it with HMAC-SHA256 over
 *      EMAIL_TOKEN_DERIVATION_LABEL. This tier exists because the alternative
 *      - a per-process random value - is not shared between processes, and the
 *      email token is minted in one process and verified in another in two
 *      measured cases: a clustered deployment (Dockerfile:147 runs the app
 *      under pm2), and test/parity/joi-matrix.js, which signs the token in the
 *      tool process from this very property and drives a separate server child
 *      that has to accept it. A configured session password is the one secret
 *      of adequate length that both processes are guaranteed to share, and
 *      production cannot boot without it (app.js:54-68), so this tier is
 *      deterministic exactly where determinism is needed. The derivation is
 *      one-way, so the session password is not recoverable from the token key.
 *   3. Otherwise a fresh `crypto.randomBytes(32)` - 256 bits - is generated
 *      for this process. It is cryptographically sound in every environment;
 *      its only cost is that tokens do not survive a restart, which the logged
 *      line states.
 *
 * Neither fallback throws and neither exits: this module is loaded during
 * config bootstrap by the route parser and by two gate tools, so a throw here
 * would take out the boot and both gates.
 *
 * @returns {string} The resolved secret, 32+ characters, never public data.
 */
function resolveEmailTokenSecret() {
  var mail     = config.app && config.app.mail ? config.app.mail : null
    , session  = config.app && config.app.plugins && config.app.plugins.session
                   ? config.app.plugins.session
                   : null
    , cookie   = session && session.cookieOptions ? session.cookieOptions : null
    , password = cookie ? cookie.password : undefined
    , configured = mail ? mail.secret : undefined
    , resolved
    , message;

  if (typeof configured === 'string' &&
      configured.length >= EMAIL_TOKEN_MIN_SECRET_LENGTH) {
    return configured;
  }

  if (typeof password === 'string' &&
      password.length >= EMAIL_TOKEN_MIN_SECRET_LENGTH) {
    resolved = crypto.createHmac('sha256', password)
      .update(EMAIL_TOKEN_DERIVATION_LABEL)
      .digest('hex');
    message = 'Email share token secret is not configured; derived one for ' +
      'this process from the configured session cookie secret. Set ' +
      'app.mail.secret in config/local.yaml to give email share tokens a key ' +
      'of their own that survives a session secret change.';
  }
  else {
    resolved = crypto.randomBytes(32).toString('hex');
    message = 'Email share token secret is not configured; generated an ' +
      'ephemeral one for this process. Set app.mail.secret in ' +
      'config/local.yaml to keep email share tokens valid across a restart.';
  }

  // `mail` is absent only if a deployment removes the whole `app.mail` block
  // that config/default.yaml:133-140 ships. There is then no property to
  // publish through, and the signers in lib/controllers/trinket.js would fail
  // on `config.app.mail.secret` exactly as they do today; the resolved value
  // is still held in this module so verification uses a sound key.
  if (mail) {
    Object.defineProperty(mail, 'secret', {
      value        : resolved,
      writable     : true,
      enumerable   : true,
      configurable : true
    });
  }

  reportEmailTokenSecret(message);

  return resolved;
}

// Resolved once, at module load, so every reader in this process sees one
// value and no request pays for the derivation.
var emailTokenSecretValue = resolveEmailTokenSecret();

/**
 * The key material `verifyEmailToken` concatenates the shortCode onto.
 *
 * Reads `config.app.mail.secret` on every call rather than closing over the
 * resolved value, so a deployment that supplies a real secret keeps being read
 * from configuration - the property is also what the signers and
 * test/lib/api/trinket.js:1338 read, and reading it at call time is what keeps
 * all three in step. The resolved value is the fallback for the one case where
 * the property cannot be published: an `app.mail` block that does not exist.
 *
 * @returns {string} The secret in force for this process.
 */
function emailTokenSecret() {
  var configured = config.app && config.app.mail
    ? config.app.mail.secret
    : undefined;

  if (typeof configured === 'string' &&
      configured.length >= EMAIL_TOKEN_MIN_SECRET_LENGTH) {
    return configured;
  }

  return emailTokenSecretValue;
}

internals.defaultNextResult = defaultNextResult;

internals.isAdmin = function(user, next) {
  // Hapi 20+ style: return directly or throw
  if (typeof next === 'function') {
    // Legacy callback style
    next(user.hasRole("admin") ? defaultNextResult : Boom.forbidden());
  } else {
    // Modern style: return value or throw Boom error
    if (user && user.hasRole && user.hasRole("admin")) {
      return defaultNextResult;
    }
    throw Boom.forbidden();
  }
}

internals.findById = function(model, fallback) {
  return function(id, optional, next) {
    // Handle different argument patterns
    if (typeof optional === 'function') {
      next = optional;
      optional = false;
    } else if (arguments.length === 2 && typeof optional !== 'boolean') {
      next = optional;
      optional = false;
    }

    if (!id) {
      var err = optional ? optional : Boom.badRequest();
      return next ? next(err) : Promise.reject(err);
    }

    // Defence in depth at the Mongoose sink. This runs as a pre-handler, and
    // hapi executes prerequisites before the route handler where the declared
    // Joi validation is enforced, so an operator-shaped id -- {"$exists": true}
    // from a JSON body, or an array from repeated query keys -- would otherwise
    // reach model.findById() as findOne({_id: {$exists: true}}) and match an
    // arbitrary document (CWE-943). A document id is a string or a number and
    // nothing else, so anything else is refused here even if it somehow gets
    // past the route parser's gate.
    //
    // Routed through the SAME two-argument juggling as the `!id` branch above,
    // deliberately: several routes pass a document as the second argument, so
    // `next` is not always a function and calling it is what produces the
    // TypeError that test/lib/api/course.js:332-340 asserts as a 500. An
    // unconditional throw or reject here would change that asserted outcome.
    if (typeof id !== 'string' && typeof id !== 'number') {
      var typeErr = optional ? optional : Boom.badRequest();
      return next ? next(typeErr) : Promise.reject(typeErr);
    }

    // Return a promise - works for both pre-handlers and callback style
    return model.findById(id)
      .then(function(doc) {
        // Treat soft-deleted documents as not found
        var result = (doc && !doc.deletedAt) ? doc : Boom.notFound();
        return next ? next(result) : result;
      })
      .catch(function(err) {
        if (next) return next(err);
        throw err;
      });
  };
}

internals.userByLogin = function(userSlug, next) {
  return User.findByLogin(userSlug, function(err, doc) {
    if (err) return next(err);
    return next(doc ? doc : Boom.notFound());
  });
},

// TODO: refactor to check roles

internals.canEdit = function(resource, user, next) {
  var result;

  if (!resource) {
    result = Boom.badRequest();
  } else if (!user) {
    result = Boom.forbidden();
  } else {
    var ownerId = resource.populated('_owner') || "";
    if (!ownerId && resource._owner) {
      ownerId = resource._owner.toString();
    }
    result = ownerId === user.id ? defaultNextResult : Boom.forbidden();
  }

  // Support both callback and direct return patterns
  if (next) {
    return next(result);
  }
  return result;
}

internals.contains = function(listProperty) {
  return function(haystack, needle, next) {
    if (!haystack || !needle) {
      if (next) return next(Boom.badRequest());
      throw Boom.badRequest();
    }

    if (!haystack[listProperty] || !haystack[listProperty].indexOf || typeof(haystack[listProperty].indexOf) !== 'function') {
      if (next) return next(Boom.badRequest());
      throw Boom.badRequest();
    }

    var result = haystack[listProperty].indexOf(needle) >= 0 ? defaultNextResult : Boom.badRequest();
    if (next) return next(result);
    if (result instanceof Error) throw result;
    return result;
  };
}

internals.lowerUserFields = function(request, h) {
  ['email', 'username'].forEach(function(field) {
    if (request.payload && request.payload[field]) request.payload[field] = request.payload[field].trim().toLowerCase();
  });
  return null;
}

internals.populate = function(source, fields, next) {
  if (!(fields && fields.length)) {
    if (next) return next(defaultNextResult);
    return Promise.resolve(defaultNextResult);
  }

  if (!Array.isArray(fields)) {
    fields = fields.split(',');
  }

  var promises = _.map(fields, function(field) {
    return source.populate(field);
  });

  return Promise.all(promises)
    .then(function() {
      if (next) return next(source);
      return source;
    })
    .catch(function(err) {
      if (next) return next(err);
      throw err;
    });
}

module.exports.findTrinket = {
  assign : 'trinket',
  method : function(request, h) {
    var trinketId = request.params.trinketId || request.params.shortCode;

    // check for extension
    var hasExtension = trinketId.match(/\.(\w+)/);
    if (hasExtension) {
      trinketId = trinketId.substr(0, hasExtension.index);

      // for downstream handlers
      request.params.trinketId = request.params.shortCode = trinketId;
      request.pre.extension = hasExtension[1];
    }

    return Trinket.findById(trinketId)
      .then(function(doc) {
        if (doc) {
          // Soft-deleted trinkets are treated as not found
          if (doc.deletedAt) {
            throw Boom.notFound();
          }

          var requestLang = request.params.lang;
          if (!requestLang) {
            var pathSegments = request.path.split('/');

            // i.e. /{lang}/{shortCode}
            if (Trinket.schema.path('lang').enumValues.indexOf( pathSegments[1] ) >= 0) {
              requestLang = pathSegments[1];
            }
          }

          if (!requestLang || requestLang === doc.lang) {
            return doc;
          }
          else {
            // redirect to correct lang
            var location = config.url + '/' + doc.lang + '/' + trinketId;
            // A language mismatch returns null rather than redirecting: this value
            // becomes request.pre.findTrinket, the `location` computed above is
            // unused, and the request reaches the handler with no trinket.
            return null;
          }
        }
        else {
          throw Boom.notFound();
        }
      })
      .catch(function(err) {
        // The error is returned, not rethrown: a Boom keeps its status and any
        // other Error is boomified to a 500 by the framework before request.pre
        // is assigned.
        return err;
      });
  }
};

module.exports.validLang = {
  assign : 'validLang',
  method : function(request, h) {
    // strip leading and trailing slashes
    var urlLang = request.url.pathname.replace(/^\//, '').replace(/\/$/, '')
      , lang    = request.params.lang || request.query.lang || (request.payload && request.payload.lang) || urlLang;

    var isValid = Trinket.schema.path('lang').enumValues.indexOf(lang) >= 0;
    if (isValid) {
      return lang;
    }
    throw Boom.notFound();
  }
}

/**
 * Check if a trinket type (language) is enabled via feature flags
 * Returns 404 if the trinket type is disabled
 */
module.exports.trinketTypeEnabled = {
  assign : 'trinketTypeEnabled',
  method : function(request, h) {
    // Get lang from various sources
    var urlLang = request.url.pathname.replace(/^\//, '').split('/')[0]
      , lang    = request.params.lang || request.query.lang;

    // Only use urlLang if it's actually a known trinket type
    // (avoids treating paths like /library as a lang)
    if (!lang && features.isKnownTrinketType(urlLang)) {
      lang = urlLang;
    }

    if (!lang) {
      // No lang specified, allow through
      return true;
    }

    if (features.isTrinketTypeEnabled(lang)) {
      return true;
    }

    // Trinket type is disabled
    throw Boom.notFound('This trinket type is not available');
  }
}

/**
 * Pre-handler to check if courses feature is enabled.
 * Returns 404 if courses are disabled.
 */
module.exports.coursesEnabled = {
  assign : 'coursesEnabled',
  method : function(request, h) {
    if (features.isCoursesEnabled()) {
      return true;
    }
    throw Boom.notFound('Courses are not available');
  }
}

/*
 * SECURITY DEVIATION FROM AAP R-d - ESCALATED FOR AUTHORIZATION, NOT
 * SELF-APPROVED - recorded in the shape AAP 0.7 uses for the two conflicts it
 * decides.
 *
 * STATUS OF THIS RECORD. It states the departure and the reasoning behind it.
 * It does NOT authorize it: AAP 0.7's conflict register closes exactly two
 * conflicts - the image response at files.js:98-100 and the `marked` advisory -
 * and nothing in the AAP delegates approval authority to a comment in the
 * source. The departure is implemented because leaving the vulnerability in
 * place is not an available outcome for a blocking security finding, and it is
 * carried to the checkpoint's resolution report for a human to authorize or
 * reverse.
 *
 * THE CONFLICT. R-d preserves baseline observable behaviour, and the baseline
 * behaviour here is that a tree with no configured `app.mail.secret` - which
 * is every tree, since config/default.yaml:133-140 declares no such key -
 * verifies email share tokens against `'undefined' + shortCode`, a key derived
 * entirely from the public shortCode, with no algorithm restriction and no
 * lifetime bound. That stands against this checkpoint's blocking security
 * requirement, SEC-F22 (HIGH, CWE-321/CWE-347).
 *
 * WHICH CONTROLS: the security requirement.
 *
 * WHY. A token an anonymous caller can mint for himself is not a behaviour a
 * client can depend on - it is the absence of authentication, and R-d's
 * protection is for behaviour clients may legitimately rely on. The change is
 * also invisible to any correctly configured deployment: a configured secret
 * of adequate length is used unchanged, and the shortCode concatenation, the
 * token-resolution order, the returned payload and both Boom outcomes are
 * byte-for-byte what they were. It is the same balance AAP 0.7 struck for
 * lib/controllers/files.js:98-100, and the opposite of the marked case, where
 * a prohibition stood against a validation target rather than against the
 * absence of a response.
 *
 * RESIDUAL. When neither `app.mail.secret` nor the session cookie password is
 * configured, the key is generated per process, so tokens minted before a
 * restart stop verifying. resolveEmailTokenSecret logs exactly that and names
 * the setting that removes it. Tokens now also expire after
 * EMAIL_TOKEN_MAX_AGE, which is the finding's own requirement.
 */
module.exports.verifyEmailToken = function(request, h) {
  var secret = emailTokenSecret() + request.pre.trinket.shortCode
    , sessionKey = 'emailToken:' + request.pre.trinket.shortCode
    , options = { algorithms : EMAIL_TOKEN_ALGORITHMS }
    , data, token;

  token = request.payload.token
    ? request.payload.token
    : request.yar && request.yar.get(sessionKey)
      ? request.yar.get(sessionKey)
      : null;

  if (token) {
    // `maxAge` is UNCONDITIONAL, and a token that carries no numeric `iat` is
    // rejected rather than accepted without a lifetime bound.
    //
    // WHY IT IS NOT CONDITIONAL. An earlier form of this code applied `maxAge`
    // only when an unauthenticated `jwt.decode` peek revealed a numeric `iat`.
    // That was measured-correct about the library - on jsonwebtoken 9.0.3,
    // `maxAge` against a token with no `iat` throws `JsonWebTokenError: iat
    // required when maxAge is specified` - and wrong about the security
    // property. It made expiry opt-out: any validly signed token minted
    // without an `iat` was accepted for ever, which is the CWE-347 half of
    // SEC-F22 restated as a default. Expiry enforcement must not be something
    // the token itself can decline, so the throw is now the intended outcome
    // for a token with no issue time, and it reaches the same funnel every
    // other rejected token reaches.
    //
    // WHAT THIS COSTS, exactly. `jwt.sign` stamps `iat` on every token this
    // application issues, so no real token is affected. One hand-built fixture
    // is: test/parity/joi-matrix.js's `buildEmailToken` composes the JWT from
    // raw HMAC over `{"shortCode": ...}` with no `iat` claim, so it must add
    // one - `{ shortCode: shortCode, iat: Math.floor(Date.now() / 1000) }` -
    // to keep driving its gate. That file belongs to another work unit and the
    // requirement is recorded for it rather than reached into from here.
    options.maxAge = EMAIL_TOKEN_MAX_AGE;

    // jwt.verify throws synchronously on a malformed, expired or badly signed token;
    // that throw is left to propagate so it reaches the same funnel as before.
    // `TokenExpiredError`, which the `maxAge` option above can now raise, is
    // deliberately left on that same path: it is a rejected token like any
    // other, and catching it here would move its response out of the funnel.
    data = jwt.verify(token, secret, options);

    // The claim check is this token's audience binding. The signers set no
    // `aud` or `iss` claim, so the shortCode claim is the only thing scoping a
    // token to one trinket, and `typeof` is required alongside the comparison
    // so a claim that is not a string cannot match by coercion.
    if (typeof data.shortCode === 'string' &&
        data.shortCode === request.pre.trinket.shortCode) {
      return data;
    } else {
      throw Boom.forbidden();
    }
  }
  else {
    throw Boom.badRequest();
  }
}


module.exports.register = function(server) {
  server.method('isAdmin',              internals.isAdmin);
  server.method('user',                 internals.findById(User));
  server.method('course',               internals.findById(Course));
  server.method('folder',               internals.findById(Folder));
  server.method('invitation',           internals.findById(CourseInvitation));
  server.method('canEdit',              internals.canEdit);
  server.method('file',                 internals.findById(File));
  server.method('lesson',               internals.findById(Lesson));
  server.method('parent',               internals.findById(Lesson));
  server.method('material',             internals.findById(Material));
  server.method('trinket',              internals.findById(Trinket));
  server.method('hasLesson',            internals.contains('lessons'));
  server.method('hasMaterial',          internals.contains('materials'));
  server.method('populate',             internals.populate);
  server.method('namedTrinketList', internals.namedTrinketList);
}

module.exports.lowerUserFields = internals.lowerUserFields;

module.exports.toLowerCaseURI = function(request, reply) {
  // requests for static files and api calls should pass through unchanged
  var privacy = (request.route.cache && request.route.cache.privacy) || 'default';
  var static  = privacy === 'public' ? true : false;

  var url     = request.url.pathname;
  var api     = /^\/api\//.test(url) ? true : false;

  var host    = request.headers.host || '';
  var lcHost  = host.toLowerCase();
  var lcUrl   = url.toLowerCase();

  var caseMatches = (url === lcUrl && host === lcHost) ? true : false;

  if (api || static || caseMatches) return reply();

  var hostname = lcHost;

  var location = config.app.url.protocol + '://' + hostname + lcUrl;

  return reply('').redirect(location).permanent();
}

module.exports.logUnauth = function(request, reply) {
  if (request.route.auth && request.route.auth.mode === 'required' && !request.auth.isAuthenticated) {
    log.debug("unauth", {
      route   : request.route,
      auth    : request.auth,
      session : request.yar,
      headers : request.headers,
      params  : request.params,
      query   : request.query,
      payload : request.payload
    });
  }

  return reply();
}

module.exports.getDefaultTrinket = function(request, h) {
  if (!request.query.category) {
    return null;
  }

  // The store resolves the trinket document or null, and that value becomes
  // request.pre.getDefaultTrinket.
  return trinketStore
    .random(request.params.lang, request.query.category)
    .catch(function(err) {
      // TODO: what should we do here?
      // The error is returned rather than rethrown, so the error object itself
      // becomes the pre value instead of failing the request.
      return err;
    });
}

module.exports.userByUsername = async function(request, h) {
  var username = request.params.username.toLowerCase();

  try {
    // findById supports alternate IDs (username, email) per user model config
    var user = await User.findById(username);
    if (user) {
      return user;
    }
    // Returned rather than thrown, so this stays outside the catch below and no
    // console.error line is logged for a username that simply does not exist.
    return Boom.notFound();
  } catch (err) {
    console.error('userByUsername error:', err);
    return err;
  }
}

module.exports.courseBySlug = async function(request, h) {
  var slug = request.params.courseSlug,
      user = request.pre.user || request.user,
      aliasId;

  try {
    var doc = await Course.findByUserAndSlug(user._id, slug);
    if (doc) return doc;

    var id = await courseStore.getIdBySlug(slug);
    if (!id) throw Boom.notFound();

    aliasId = id;
    var alias = await Course.findById(id);

    if (alias) {
      var url_regexp = new RegExp('\\b' + slug + '\\b', 'i');
      var location = request.path.replace(url_regexp, alias.slug);
      // A slug alias returns null rather than redirecting: as in findTrinket, the
      // `location` computed above is unused, so the request reaches the handler
      // with no course.
      return null;
    }
    else {
      // prune the dead link
      courseStore.unlinkIdFromSlug(slug, aliasId);
    }
    throw Boom.notFound();
  } catch (err) {
    // Rethrown rather than returned: a Boom fails the request with its own
    // status, and any other Error is boomified to a 500.
    throw err;
  }
}

module.exports.findFeaturedTrinkets = async function(request, h) {
  var path       = request.path;
  var lenOrIndex = path.indexOf('/', 1) >= 0 ? path.indexOf('/', 1) : path.length;
  var lang       = path.substring(path.indexOf('/') + 1, lenOrIndex);

  return await internals.namedTrinketList(lang, 'featured');
}

module.exports.trinketByOwnerAndSlug = function(request, reply) {
  var slug = request.params.trinketSlug.toLowerCase(),
      user = request.pre.user || request.user,
      aliasId;

  return Trinket.findByOwnerAndSlug(user._id, slug, function(err, doc) {
    if (err) return reply(err);
    if (doc) return reply(doc);

    return trinketStore.getIdBySlugAndUser(slug, user._id)
      .then(function(id) {
        if (!id) throw Boom.notFound();
        aliasId = id;
        return Trinket.findById(id);
      })
      .then(function(alias) {
        if (alias) {
          // Check if aliased trinket is soft-deleted
          if (alias.deletedAt) {
            throw Boom.notFound();
          }
          var url_regexp = new RegExp('\\b' + slug + '\\b', 'i');
          var location = request.path.replace(url_regexp, alias.slug);
          return reply().redirect(location).permanent().takeover();
        }
        else {
          // prune the dead link
          trinketStore.unlinkIdFromSlugAndUser(slug, user._id, aliasId);
        }
        throw Boom.notFound();
      })
      .catch(reply);
  });
}

internals.namedTrinketList = async function(lang, category) {
  var trinkets = await trinketStore.byCategory(lang, category);

  if (!trinkets || !trinkets.length) {
    return [];
  }

  var sortedTrinkets = trinkets.slice();
  var trinketObjects = await Trinket.findByIds(trinkets);

  if (trinketObjects && trinketObjects.length) {
    for (var i = 0; i < trinketObjects.length; i++) {
      var sortedIndex = sortedTrinkets.indexOf(trinketObjects[i].id);
      sortedTrinkets[sortedIndex] = trinketObjects[i];
    }
  }

  return sortedTrinkets;
}

if (config.isTest) {
  // expose internals for testing
  module.exports.internals = internals;
}
