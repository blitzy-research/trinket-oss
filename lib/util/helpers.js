var _                 = require('underscore'),
    Boom              = require('@hapi/boom'),
    config            = require('config'),
    Store             = require('./store'),
    features          = require('./features'),
    trinketStore      = Store.trinkets(),
    courseStore       = Store.courses(),
    userStore         = Store.users(),
    jwt               = require('jsonwebtoken'),
    // Node core, for the ephemeral email-share token key emailTokenSecret
    // derives when app.mail.secret is not configured outside production.
    crypto            = require('crypto'),
    defaultNextResult = true, // use this if your helper doesn't return a value
    internals         = {};

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
    var fallbackValue;

    if (typeof optional === 'function') {
      next = optional;
      optional = false;
    } else if (arguments.length === 2 && typeof optional !== 'boolean') {
      // A second argument that is neither a callback nor a boolean is a
      // fallback VALUE to stand in for a missing id -- not a callback.
      // `parent(payload.parent,pre.lesson)` (config/api_routes.js:241) is the
      // only route that uses this form: it hands over the lesson the material
      // already belongs to, so that a move carrying no `parent` reorders within
      // that lesson. hapi 4-16 appended its own `next` to a server-method call,
      // which is what kept the two forms apart; the route parser's string
      // dispatcher calls the method with exactly the arguments the route names
      // and nothing else, so the value is captured here rather than mistaken
      // for a callback and invoked.
      fallbackValue = optional;
      optional = false;
    }

    if (!id) {
      if (fallbackValue !== undefined) {
        if (next) return next(fallbackValue);

        // A fallback document is the prerequisite's value; only an error is an
        // error. hapi assigns a returned value to request.pre and routes a
        // returned Boom through failAction, so both call forms stay faithful.
        return (fallbackValue instanceof Error) ? Promise.reject(fallbackValue) : Promise.resolve(fallbackValue);
      }

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
    // Refused the same way whichever call form was used: a caller holding a
    // callback is called back with the error, and a caller without one -- every
    // route pre-handler, including the two-argument `parent(...)` form -- gets a
    // rejected promise carrying Boom.badRequest(), which hapi maps to 400, the
    // same refusal every other findById-backed pre-handler already produces.
    // The fallback value above is deliberately NOT substituted here: an
    // operator-shaped id is a refusal, not a missing id.
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

/**
 * Whether `user` is the trinket's principal - its `_owner` or its `_creator`.
 *
 * SEAM-F171. BOTH paths are required, and which one carries the identity
 * depends on how the trinket came into existence. An assignment submission is
 * keyed on `_creator`: `course.startAssignment`
 * (lib/controllers/course.js:1389-1408) builds the submission with
 * `_creator : request.user` and never sets `_owner`, and
 * `Trinket.findByUserAndMaterial` (lib/models/trinket.js:412-416) - the query
 * the submission flow itself uses to find a student's work - filters on
 * `_creator` alone. A trinket created through the ordinary editor carries both.
 * Testing only `_owner`, as `internals.canEdit` above does for its own purpose,
 * would therefore refuse a student their own submission.
 *
 * A possibly-populated path is reduced through
 * `trinket.populated('<path>') || trinket.<path>` - the same idiom as
 * `internals.canEdit` - because `populated()` returns the id that a populated
 * path replaced, and the raw property is the ObjectId when it was not
 * populated. Both are compared with `String(...)`, which renders an ObjectId as
 * its hex form and leaves a string as it is.
 *
 * @param   {Object}  trinket  a trinket document, or a falsy value
 * @param   {Object}  user     the acting user, or a falsy value
 * @returns {Boolean}          false for a missing trinket, a missing user or a
 *                            user with no id, rather than throwing
 */
internals.isTrinketPrincipal = function(trinket, user) {
  if (!trinket || !user || !user.id) {
    return false;
  }

  return ['_owner', '_creator'].some(function(path) {
    var principalId = (typeof trinket.populated === 'function' && trinket.populated(path)) || trinket[path];

    return !!principalId && String(principalId) === String(user.id);
  });
}

/**
 * Whether `user` holds `permission` in the context of one course.
 *
 * SEAM-F171. The course-scoped permission idiom this application already uses
 * at 34 sites in lib/controllers/course.js - `hasPermission(<permission>,
 * "course", { id : <courseId> })`, for instance at :1969 and :1993 - reduced to
 * one predicate so a pre-handler can ask the same question the controllers ask.
 * `hasPermission` builds its lookup key by concatenating the id onto the
 * context string, so `String(courseId)` is exactly what those call sites
 * already produce for an ObjectId, and it makes the coercion explicit here.
 *
 * A missing `courseId` returns false rather than asking about the bare `course`
 * context: a trinket carrying no course - which is what
 * `course.sendFeedback` creates for a feedback revision - has no course-scoped
 * permission to hold, and probing the unscoped context would answer a different
 * question from the one the caller asked.
 *
 * @param   {Object}  user        the acting user, or a falsy value
 * @param   {String}  permission  the permission name, as the roles plugin
 *                                spells it
 * @param   {*}       courseId    a course id, ObjectId or string
 * @returns {Boolean}             false when there is no user, no
 *                                `hasPermission` method or no course id
 */
internals.hasCoursePermission = function(user, permission, courseId) {
  if (!user || typeof user.hasPermission !== 'function' || !courseId) {
    return false;
  }

  return !!user.hasPermission(permission, 'course', { id : String(courseId) });
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

/*
 * Lower-cases the two identifier fields on the payload, for the six route
 * declarations that carry it (config/routes.js:56, :80, :267 and
 * config/api_routes.js:1141, :1154, :1390).
 *
 * The `typeof ... === 'string'` test is the whole of what this pre-handler
 * asserts, and it is load-bearing rather than defensive. A pre-handler is a
 * NATIVE lifecycle method, so it runs BEFORE routeParser's hand-rolled
 * validation block - the block that would otherwise have rejected a
 * non-string `email` against the route's own `Joi.string().required()`. With
 * the field read untyped, `.trim()` was called on whatever arrived: an object,
 * an array or a number in `email` or `username` threw a TypeError that reached
 * the Layer 1 catch-all as a 500, while the same shape in `password` - which
 * this pre-handler does not touch - reached the validation block and was
 * rejected cleanly as `"password" must be a string`. The two halves of one
 * login payload therefore answered a non-string differently.
 *
 * Guarding the type here does not decide the request. It declines to transform
 * a value the route never declared as transformable and lets the route's own
 * validation answer, which is what makes the two fields symmetric. Every
 * string payload is unaffected: the trim-and-lower-case is applied exactly as
 * before, so the upper-case-email login path and the lower-cased uniqueness
 * checks behind it are unchanged.
 */
internals.lowerUserFields = function(request, h) {
  ['email', 'username'].forEach(function(field) {
    if (request.payload && typeof request.payload[field] === 'string' && request.payload[field]) {
      request.payload[field] = request.payload[field].trim().toLowerCase();
    }
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

/**
 * The trinket for the STUDENT assignment embed, authorized.
 *
 * SEAM-F171. `GET /assignment-embed/{lang}/{trinketId}` declared
 * `auth: 'session'` and `pre: [trinketTypeEnabled, validLang, findTrinket]`,
 * and `findTrinket` establishes only that the trinket EXISTS - it applies no
 * ownership, membership or role rule - while `trinket.assignment`
 * (lib/controllers/trinket.js:973-982) applies none either. Any logged-in user
 * holding an id therefore rendered any assignment, whether or not they owned
 * it, submitted it or belonged to the course. Measured: 200 with the assignment
 * fully rendered for a non-member.
 *
 * The check lives HERE, in the pre-handler that already performs the lookup,
 * rather than in a fourth pre-handler, because the route-parity gate
 * (test/parity/manifest.js, AAP 0.9.1) asserts the pre-handler census -
 * `routesWithPre: 161`, 149 function-form entries, 148 of them recovered as
 * exports of this module - and a fourth entry on each of the two routes would
 * fail generation. Replacing the third entry keeps every one of those figures
 * and keeps the entry a recoverable export of this file.
 *
 * `findTrinket` is not modified and not duplicated: its `method` is called
 * directly, so the 16 other route entries that declare it are untouched and
 * there stays exactly one lookup implementation - including its extension
 * stripping, its `request.pre.extension` assignment and its soft-delete 404.
 *
 * Its two NON-DOCUMENT outcomes pass through unauthorized, because both are
 * preserved baseline behaviour (AAP 0.6.6 / R-d) and neither discloses
 * anything. A returned Error or Boom is `findTrinket`'s own `.catch`
 * disposition - it RETURNS the error rather than throwing, and hapi's
 * prerequisite step boomifies and fails the request with that status - and
 * `null` is the preserved language-mismatch outcome, which reaches the handler
 * with no trinket and renders none.
 *
 * Allowed for the trinket's principal - a student opening their own submission,
 * which is keyed on `_creator` (see `internals.isTrinketPrincipal`) - or for a
 * user holding `view-assignment-submissions` on the trinket's course, which is
 * the permission the five submission-reading handlers in
 * lib/controllers/course.js require for the same data (:1588, :1641, :1756,
 * :1813 and :1907). Everything else is `Boom.forbidden()`, which app.js's
 * `onPreResponse` answers with `h.view('50x.html').code(403)` for an HTML
 * request (app.js:232-233) and with the Boom payload for an API or JSON one.
 * An ANONYMOUS request never reaches this point: `auth: 'session'` is
 * unchanged, so it is still answered 401 and redirected to `/login`
 * (app.js:224-229).
 */
module.exports.findAssignmentTrinket = {
  assign : 'trinket',
  method : async function(request, h) {
    var trinket = await module.exports.findTrinket.method(request, h);

    if (!trinket || trinket instanceof Error) {
      return trinket;
    }

    if (internals.isTrinketPrincipal(trinket, request.user) ||
        internals.hasCoursePermission(request.user, 'view-assignment-submissions', trinket.courseId)) {
      return trinket;
    }

    throw Boom.forbidden();
  }
};

/**
 * The trinket for the TEACHER feedback embed, authorized.
 *
 * SEAM-F171. `GET /assignment-embed-feedback/{lang}/{trinketId}` is the
 * grading surface - `trinket.assignmentFeedback`
 * (lib/controllers/trinket.js:983-1004) resolves the teacher's draft over the
 * submission - and it was gated by `auth: 'session'` alone, so it required no
 * teacher role of any kind and any logged-in user rendered it. Measured: 200
 * for a non-member.
 *
 * Same shape and the same three constraints as `findAssignmentTrinket` above:
 * one lookup implementation, `findTrinket` untouched, and its Error and `null`
 * outcomes passed through unauthorized.
 *
 * The teaching permission is checked first, and `send-submission-feedback` is
 * the one the write side of this flow requires (lib/controllers/course.js:1969,
 * :1993, :2006, :2116), so the read surface asks for exactly what the
 * corresponding write asks for.
 *
 * THE PRINCIPAL BRANCH IS REQUIRED HERE, not laxity. `course.sendFeedback`
 * (lib/controllers/course.js:2029-2036) creates the feedback REVISION trinket
 * with `_creator` = the acting teacher and NO `courseId` at all, and
 * `public/partials/directives/trinket-feedback.js:218` opens
 * `/assignment-embed-feedback/` on exactly that revision. A permission-only
 * rule would find no course to scope the permission to and would 403 the
 * teacher out of the view they just created - breaking the grading flow this
 * route exists for. It also keeps the committed corpus scenarios 59, 60, 63 and
 * 64, which drive both assignment routes as the `_owner` of the fixture trinket
 * and expect 200.
 */
module.exports.findAssignmentFeedbackTrinket = {
  assign : 'trinket',
  method : async function(request, h) {
    var trinket = await module.exports.findTrinket.method(request, h);

    if (!trinket || trinket instanceof Error) {
      return trinket;
    }

    if (internals.hasCoursePermission(request.user, 'send-submission-feedback', trinket.courseId) ||
        internals.isTrinketPrincipal(trinket, request.user)) {
      return trinket;
    }

    throw Boom.forbidden();
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
 * The HS256 key material for the email share token, and the one place either
 * side of that token derives it.
 *
 * WHY THIS FUNCTION EXISTS. The key was `config.app.mail.secret +
 * trinket.shortCode`, read directly at the verifier and at each of the three
 * `jwt.sign` sites in `lib/controllers/trinket.js`. `config/default.yaml`
 * declared no `secret` under `app.mail`, so on every tree that configures none
 * the property was `undefined`, JavaScript stringified it, and the key was the
 * literal `'undefined'` plus the trinket's shortCode - which is public,
 * because it is in the trinket's own share URL. Anyone could therefore mint a
 * token that verified: driven anonymously against the delivered tree, a token
 * signed with `'undefined' + 'pyfixture001'` and the matching claim was
 * accepted and the handler proceeded into the mail send.
 *
 * THE SHAPE. This is the treatment AAP 0.6.1 already specifies for the session
 * cookie password, applied to the second secret with the same defect:
 *
 *   configured, non-empty  -> that value, concatenated with the shortCode
 *   unset, non-production  -> one ephemeral 32-byte value per process, logged
 *                             once, concatenated with the shortCode
 *   unset, production      -> null. No key exists, so nothing can be minted
 *                             and nothing can verify. It fails CLOSED.
 *
 * The ephemeral branch is what keeps a development or test tree working
 * exactly as it did: the token is minted into the session and into the page's
 * hidden field, and verified out of one of them, always within the same
 * process - so a per-process key round-trips every legitimate share, while a
 * key derived from public values no longer verifies. The trade-off is the one
 * AAP 0.6.1 already accepts for the session password: a token does not survive
 * a restart, exactly as a session does not. Configure `app.mail.secret` to
 * keep tokens valid across restarts and across a multi-process deployment.
 *
 * Production returns null rather than generating, for the reason the session
 * password guard fails fast there: a per-worker key in a clustered deployment
 * would verify or refuse depending on which worker answered, which is worse
 * than not offering the capability at all.
 *
 * `Object.defineProperty` is deliberately NOT used to publish the generated
 * value back onto `config`, and nothing is assigned onto it either: the
 * `config` package exposes properties through accessors that persist what is
 * assigned to `config/runtime.json`, which is layered over every other source,
 * so writing there would put the secret on disk, let it outlive the process
 * and let a later production run find a development secret instead of the
 * null this returns. The value is held in module scope instead.
 *
 * @param {string} shortCode the trinket's public short code
 * @returns {?string} the key, or null when no key may exist
 */
var generatedEmailTokenSecret = null;

module.exports.emailTokenSecret = function(shortCode) {
  // `config.isProd` is assigned by config/app.config.js, which requires this
  // module transitively - so at load time it does not exist yet. It is read at
  // CALL time, and NODE_ENV stands in for it if this module is used by a
  // harness that never loads config/app.config.
  var isProduction = config.isProd === undefined
    ? process.env.NODE_ENV === 'production'
    : config.isProd;
  var configured = config.app.mail && config.app.mail.secret;

  if (typeof configured === 'string' && configured.length) {
    return configured + shortCode;
  }

  if (isProduction) {
    return null;
  }

  if (!generatedEmailTokenSecret) {
    generatedEmailTokenSecret = crypto.randomBytes(32).toString('hex');
    noteGeneratedEmailTokenSecret();
  }

  return generatedEmailTokenSecret + shortCode;
}

// Writes the one operator-facing line that says a key was generated, following
// the convention config/db.js:68-78 already uses for the same problem: `log` is
// an implicit global installed by app.js:21, so it exists for every request
// that reaches a route, but this module is also required directly by harnesses
// that never load app.js, and a bare `log.info(...)` there would raise a
// ReferenceError. Both arms write to stdout - winston's `info` goes to its
// Console transport - so neither can disturb a gate that reads stderr for
// deprecation warnings, and neither is itself a warning.
function noteGeneratedEmailTokenSecret() {
  var message = 'app.mail.secret is not configured; generated an ephemeral ' +
    'email-share token key for this non-production process. Set ' +
    'app.mail.secret in config/local.yaml to keep share tokens valid across ' +
    'restarts.';

  if (typeof log !== 'undefined' && log && typeof log.info === 'function') {
    log.info(message);
  }
  else {
    console.log(message);
  }
}

/*
 * Verifies the email share token `lib/controllers/trinket.js` mints at its
 * three signing sites as `jwt.sign({ shortCode : ... }, secret)`.
 *
 * Both sides take their key material from `emailTokenSecret` above, which is
 * the only place it is derived. A null return means no key may exist on this
 * process - production with `app.mail.secret` unset - and the request is
 * refused with the same `Boom.forbidden()` a token bearing the wrong shortCode
 * claim already produces. Refusing is the point: with no key, accepting
 * anything would be accepting everything.
 *
 * `jwt.verify` is called with no options, so the algorithm is whatever the
 * token's own header names and no lifetime is imposed - the signers stamp no
 * `exp` claim and none is required here. It throws synchronously on a
 * malformed or badly signed token, and that throw is left to propagate exactly
 * as before, so an invalid token still reaches the funnel it always reached
 * (measured: 500). A token minted from the old publicly derivable key is now
 * simply a badly signed token and is answered there, indistinguishably from
 * any other. Nothing in the error mapping changes.
 *
 * The shortCode claim is the only thing scoping a token to one trinket, and it
 * is compared with `===` exactly as before.
 */
module.exports.verifyEmailToken = function(request, h) {
  var sessionKey = 'emailToken:' + request.pre.trinket.shortCode
    , secret, data, token;

  token = request.payload.token
    ? request.payload.token
    : request.yar && request.yar.get(sessionKey)
      ? request.yar.get(sessionKey)
      : null;

  if (token) {
    // Resolved here rather than at the top of the function, so that a request
    // carrying no token at all still reaches its own `Boom.badRequest()` below
    // in EVERY configuration - including the production-and-unset one, where
    // there is no key. That edge is unchanged, and the key is derived only
    // when there is something to verify with it.
    secret = module.exports.emailTokenSecret(request.pre.trinket.shortCode);

    if (secret === null) {
      throw Boom.forbidden();
    }

    data = jwt.verify(token, secret);

    if (data.shortCode === request.pre.trinket.shortCode) {
      // Returned, so the payload becomes request.pre.verifyEmailToken.
      return data;
    } else {
      // Thrown rather than returned, so the Boom fails the request with its own
      // status instead of becoming the pre value.
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
