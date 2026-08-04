var _                 = require('underscore'),
    Boom              = require('@hapi/boom'),
    config            = require('config'),
    Store             = require('./store'),
    features          = require('./features'),
    trinketStore      = Store.trinkets(),
    courseStore       = Store.courses(),
    userStore         = Store.users(),
    fs                = require('fs'),
    jwt               = require('jsonwebtoken'),
    defaultNextResult = true, // use this if your helper doesn't return a value
    internals         = {};

internals.defaultNextResult = defaultNextResult;

// The four next(Boom.…) sites in the server methods below - internals.isAdmin,
// internals.userByLogin and both guards of internals.contains - are unreachable: the
// string-form pre-handler resolver applies each server method without appending a trailing
// `next`, so every `if (next)` guard takes its modern branch. Those dead branches, and the
// four different Boom delivery mechanisms alongside them, are preserved verbatim rather than
// deleted or unified.

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

// Async conversion: lib/models/user.js#findByLogin forwards to Mongoose's findOne, which returns a
// thenable Query when no callback is supplied, so the error-first callback is replaced by the promise.
// The two-argument .then reproduces the `if (err)` guard exactly - the rejection handler runs instead of
// the body, never after it - and a trailing .catch would additionally swallow a throw from `next`
// itself, which the callback form let escape.
internals.userByLogin = function(userSlug, next) {
  return User.findByLogin(userSlug).then(function(doc) {
    return next(doc ? doc : Boom.notFound());
  }, function(err) {
    return next(err);
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

internals.lowerUserFields = async function(request, h) {
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
  method : async function(request, h) {
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
            return Boom.notFound();
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
            // This pre-handler resolves to null and emits NO redirect: `location` is
            // computed and then discarded, and the request continues with
            // request.pre.trinket === null. This is a live route surface, so returning
            // h.redirect(location) here would introduce a 301 that does not exist.
            // Same mechanism as docs/PRESERVED-QUIRKS.md section 3.12.
            return null;
          }
        }
        else {
          return Boom.notFound();
        }
      })
      .catch(function(err) {
        return err;
      });
  }
};

module.exports.validLang = {
  assign : 'validLang',
  method : async function(request, h) {
    // strip leading and trailing slashes
    var urlLang = request.url.pathname.replace(/^\//, '').replace(/\/$/, '')
      , lang    = request.params.lang || request.query.lang || (request.payload && request.payload.lang) || urlLang;

    var isValid = Trinket.schema.path('lang').enumValues.indexOf(lang) >= 0;
    return isValid ? lang : Boom.notFound();
  }
}

/**
 * Check if a trinket type (language) is enabled via feature flags
 * Returns 404 if the trinket type is disabled
 */
module.exports.trinketTypeEnabled = {
  assign : 'trinketTypeEnabled',
  method : async function(request, h) {
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
    return Boom.notFound('This trinket type is not available');
  }
}

/**
 * Pre-handler to check if courses feature is enabled.
 * Returns 404 if courses are disabled.
 */
module.exports.coursesEnabled = {
  assign : 'coursesEnabled',
  method : async function(request, h) {
    if (features.isCoursesEnabled()) {
      return true;
    }
    return Boom.notFound('Courses are not available');
  }
}

module.exports.verifyEmailToken = async function(request, h) {
  var secret = config.app.mail.secret + request.pre.trinket.shortCode
    , sessionKey = 'emailToken:' + request.pre.trinket.shortCode
    , data, token;

  token = request.payload.token
    ? request.payload.token
    : request.yar && request.yar.get(sessionKey)
      ? request.yar.get(sessionKey)
      : null;

  if (token) {
    data = jwt.verify(token, secret);

    if (data.shortCode === request.pre.trinket.shortCode) {
      return data;
    } else {
      return Boom.forbidden();
    }
  }
  else {
    return Boom.badRequest();
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

module.exports.toLowerCaseURI = async function(request, h) {
  // requests for static files and api calls should pass through unchanged
  var privacy = (request.route.cache && request.route.cache.privacy) || 'default';
  var static  = privacy === 'public' ? true : false;

  var url     = request.url.pathname;
  var api     = /^\/api\//.test(url) ? true : false;

  var host    = request.headers.host || '';
  var lcHost  = host.toLowerCase();
  var lcUrl   = url.toLowerCase();

  var caseMatches = (url === lcUrl && host === lcHost) ? true : false;

  if (api || static || caseMatches) return null;

  var hostname = lcHost;

  var location = config.app.url.protocol + '://' + hostname + lcUrl;

  // This pre-handler resolves to the empty string, not null, and emits no redirect:
  // `location` is computed and then discarded. Kept even though this export has zero
  // references. Same mechanism as docs/PRESERVED-QUIRKS.md section 3.12.
  return '';
}

module.exports.logUnauth = async function(request, h) {
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

  return null;
}

module.exports.getDefaultTrinket = async function(request, h) {
  if (!request.query.category) {
    return null;
  }

  return trinketStore
    .random(request.params.lang, request.query.category)
    .then(function(trinket) {
      // hapi rejects a pre-handler that resolves to undefined, so this returns null.
      return trinket === undefined ? null : trinket;
    })
    .catch(function(err) {
      // TODO: what should we do here?
      throw err;
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
      // This pre-handler resolves to null and emits NO redirect: `location` is computed
      // and then discarded, and the request continues with request.pre.course === null.
      // This is a live route surface, so returning h.redirect(location) here would
      // introduce a 301 that does not exist. See docs/PRESERVED-QUIRKS.md section 3.12.
      return null;
    }
    else {
      // prune the dead link
      courseStore.unlinkIdFromSlug(slug, aliasId);
    }
    throw Boom.notFound();
  } catch (err) {
    return err;
  }
}

module.exports.findFeaturedTrinkets = async function(request, h) {
  var path       = request.path;
  var lenOrIndex = path.indexOf('/', 1) >= 0 ? path.indexOf('/', 1) : path.length;
  var lang       = path.substring(path.indexOf('/') + 1, lenOrIndex);

  return await internals.namedTrinketList(lang, 'featured');
}

module.exports.trinketByOwnerAndSlug = async function(request, h) {
  var slug = request.params.trinketSlug.toLowerCase(),
      user = request.pre.user || request.user,
      aliasId;

  // A native pre-handler is read from its return value, so the model method is awaited
  // through its promise rather than given a callback; the lookup's error then stays on the
  // chain where the trailing .catch already delivers it. Do not reintroduce the callback
  // form. See docs/PRESERVED-QUIRKS.md section 3.18.
  return Trinket.findByOwnerAndSlug(user._id, slug)
    .then(function(doc) {
      if (doc) return doc;

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
            // This pre-handler resolves to null and emits NO redirect: `location` is
            // computed and then discarded. Kept even though this export has zero
            // references. Same mechanism as docs/PRESERVED-QUIRKS.md section 3.12.
            return null;
          }
          else {
            // prune the dead link
            trinketStore.unlinkIdFromSlugAndUser(slug, user._id, aliasId);
          }
          throw Boom.notFound();
        });
    })
    .catch(function(err) {
      return err;
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
