var config        = require('config'),
    _             = require('underscore'),
    mailer        = require('../util/mailer'),
    Store         = require('../util/store'),
    userUtil      = require('../util/user'),
    featuredStore = Store.featured(),
    errors        = require('@hapi/boom'),
    parse         = require('csv').parse;

module.exports = {
  index : async function(request, h) {
    var page     = request.params.adminPage
      , pageData = {}
      , subpage, promise, criteria;

    if (!request.params.adminPage) {
      return h.redirect('/admin/users');
    }
    else if (request.query.logoutAs) {
      request.yar.clear('loginAs');
      return h.redirect('/admin/users');
    }

    if (request.user.loggedInAs()) {
      page    = 'users';
      promise = Promise.resolve();
    }
    else if (request.params.adminPage === 'users' && request.query.q) {
      if (/^role:\w+/.test(request.query.q)) {
        criteria = request.query.q.split(':');
        promise  = roleSearch(criteria[1]);
        subpage  = 'userSearchResults'
      }
      else {
        promise = userSearch(request.query.q);
      }
    }
    else if (request.params.adminPage === 'users' && request.query.loginAs) {
      request.yar.set('loginAs', request.query.loginAs);
      return h.redirect('/home');
    }
    else if (request.params.adminPage === 'featured-courses') {
      promise = featuredStore.getList()
        .then(function(featuredList) {
          return Promise.all(_.map(featuredList, function(member) {
            return Course.findById(member.id)
              .then(function(course) {
                if (course) {
                  course.page = member.page;
                }
                return course;
              });
          }));
        })
        .then(function(courses) {
          // Filter out null courses (deleted)
          courses = _.compact(courses);
          pageData.courses = _.map(courses, function(course) {
            return {
                id        : course.id
              , name      : course.name
              , slug      : course.slug
              , ownerSlug : course.ownerSlug
              , page      : course.page || null
            };
          });
          return pageData;
        })
        .catch(function(err) {
          pageData.courses = [];
          return pageData;
        });
    }
    else {
      promise = Promise.resolve();
    }

    return promise.then(function(data) {
      return request.success({
        page    : page,
        subpage : subpage || page,
        q       : request.query.q || undefined,
        active  : request.query.active || 'profile',
        data    : data
      });
    });
  },
  ohnoes : async function(request, h) {
    var log = request.payload.log;

    // Nothing but a logged-in session may put text in front of an administrator
    // through this route. The route declaration carries no `config`
    // (config/api_routes.js), so it inherits the default strategy in
    // `mode: 'try'` (app.js) and hapi hands guests to this handler with
    // request.auth.isAuthenticated false; enforcing the requirement here is what
    // closes that, since the declaration is owned elsewhere and the route
    // manifest compares declared auth per entry against the baseline.
    //
    // The check sits AFTER the payload dereference above, deliberately: a
    // request with no payload still raises the TypeError that answers 500, which
    // is the outcome recorded for this route at the base commit
    // (test/parity/corpus.json, route.post.api-ohnoes.json: 500, 96 bytes).
    // What changes is narrower - a guest that posts a body is answered 401
    // instead of 200 - and nothing produces such a request: the only caller in
    // the tree is commented out at public/js/debug.js:31.
    if (!request.auth || !request.auth.isAuthenticated) {
      return errors.unauthorized('Not logged in');
    }

    // The response is built here, at the point the callback-era code called
    // request.success(), so the alert mail below is still sent after the response
    // has been decided and the empty-log short circuit still answers with it.
    var response = request.success();

    if (!log || !log.length) return response;

    // `sesh` and `user` are no longer read off the payload. The only producer of
    // this payload fills `sesh` with the raw `session` cookie value
    // (public/js/debug.js:8 matches /session=([^;]+);/ against document.cookie)
    // and `user` with a value read out of the DOM (#whoami, public/js/debug.js:13),
    // so mailing them put a live session credential and an unverifiable identity
    // claim into an administrator's inbox for any caller who posted them. The
    // four remaining labels keep their order, the "\n" + label + "\t\t" + value
    // layout and the per-entry separator below.
    var keys = "time,path,referrer,userAgent".split(",");
    var msg;

    // The identity the server established for itself, emitted once because it is
    // a property of the request rather than of an entry. This route declares no
    // config (config/api_routes.js), so it inherits the default `mode: 'try'`
    // (app.js) and request.user is undefined for an anonymous caller.
    msg += "\nuser\t\t" + (request.user && request.user.username ? request.user.username : 'anonymous');

    // Entry count and field lengths both arrive from the caller, so both are
    // bounded here: an array of long strings otherwise turns one request into an
    // arbitrarily large mail body and an arbitrarily long synchronous render.
    // The only producer keeps at most ten entries (public/js/debug.js:36-37), so
    // a genuine report is never trimmed; when more arrive, the note line records
    // how many did, so an operator reading the mail is not misled by the number
    // of blocks below it. Entries past the cap are not rendered.
    var count = Math.min(log.length, MAX_OHNOES_ENTRIES);
    if (count < log.length) {
      msg += "\nnote\t\t" + log.length + " entries submitted, rendering the first " + count;
    }

    // Shape validation, applied to the mail rather than to the response. `log`
    // arrives as whatever JSON or form body the caller sent, so the alert is
    // sent only when it is an array whose rendered entries are objects - a
    // message built from a string, a number or a bare `{length: n}` carries no
    // diagnostic content, and nothing that shape can reach an administrator.
    //
    // Validating here rather than before the loop is what keeps the response
    // identical: the indexing below is left exactly as it was, so `log[null]`
    // and `{length: 3}` still raise the TypeError that answers 500, and a `log`
    // of primitives still answers 200 - it simply no longer mails anything.
    var mailable = Array.isArray(log);

    for (var i = 0; i < count; i++) {
      var entry = log[i];

      if (!entry || typeof entry !== 'object') {
        mailable = false;
      }

      for (var j = 0; j < keys.length; j++) {
        // The field is still indexed off the entry directly and each value still
        // goes through the same String coercion the concatenation performed, so
        // an entry that cannot be indexed still throws here and still reaches
        // the routeParser catch-all as a 500, and a missing field still renders
        // "undefined".
        msg += "\n" + keys[j] + "\t\t" + sanitizeOhnoesField(entry[keys[j]]);
      }
      msg += "\n----------------------------------"
    }

    // One administrator mail per request is itself the amplification, so the
    // send goes through sendOhnoesAlert(), which caps how many mails leave the
    // process per window and handles the fire-and-forget rejection. The message
    // is built first, and unconditionally, so the throw edge above still depends
    // only on the payload and never on how many alerts preceded this request;
    // the response is the same whether the mail was sent or dropped.
    //
    // That send is a module-level function rather than inline code for a reason
    // measured here: `var log = request.payload.log` above shadows the implicit
    // global winston logger for the whole of this scope, so a `log.error(...)`
    // written inline resolves to the submitted array and throws a TypeError
    // inside the rejection handler - which is the very unhandled rejection the
    // handler exists to prevent.
    if (mailable) {
      sendOhnoesAlert(msg);
    }

    return response;
  },
  uploadForm : function(request, reply) {
    return request.success({});
  },
  uploadUsers : async function(request, h) {
    var userList = request.payload.userList.split(/\n/);
    var promises = [];

    // Email, Username, Name, Password
    //
    // `csv`'s parse() takes a callback, so the promise boundary belongs here at
    // the call site, inside the lifecycle method. The awaited promise settles on
    // whichever edge the callback reaches: the parse-error edge below, or the
    // tallied success edge once every row's save() has settled.
    return await new Promise(function(resolve) {
      parse(request.payload.userList, {
        columns: true,
        skip_empty_lines: true
      }, function(err, records) {
        if (err) return resolve(request.fail(err));

        records.forEach(function(userInfo) {
          var fullname = userInfo.Name || userInfo.Email;
          var username = userInfo.Username || userUtil.generate_username(userInfo.Email);
          var user = new User({
            email    : userInfo.Email,
            password : userInfo.Password,
            fullname : fullname,
            username : username,
            source   : 'upload'
          });

          promises.push(user.save());
        });

        // allSettled, so a partially failing roster is tallied rather than
        // short-circuiting: a rejected row is counted and its error discarded, so
        // the uploader learns how many rows failed but not which or why.
        resolve(Promise.allSettled(promises).then(function(results) {
          var success = 0;
          var errors  = 0;

          results.forEach(function(result) {
            if (result.status === 'fulfilled') {
              success++;
            }
            else {
              errors++;
            }
          });

          return request.success({
            page    : 'upload',
            subpage : 'upload',
            success : success,
            errors  : errors
          });
        }));
      });
    });
  },
  updateUser : async function(request, h) {
    // User.findById takes a callback, so the promise boundary belongs here at the
    // call site and the settled value is what this lifecycle method returns.
    //
    // The `if (request.payload.roles)` branch has no else and this route declares
    // no validation, so a payload without `roles` runs off the end of the
    // callback without resolving: the request is intentionally left unanswered
    // rather than told that nothing was updated.
    return await new Promise(function(resolve) {
      User.findById(request.params.userId, function(err, user) {
        if (err) return resolve(request.fail(err));

        if (!user) return resolve(request.fail({ message : 'user not found' }));

        if (request.payload.roles) {
          user.mergeRoles(request.payload.roles);
          user.save(function(err, user) {
            if (err) return resolve(request.fail(err));

            return resolve(request.success({
              success : true
            }));
          });
        }
      });
    });
  },
  grantRole : async function(request, h) {
    // Callback boundary as in updateUser: the promise is created at this call
    // site, and the grant chain's own value settles it, so every edge of that
    // chain -- success, failure, and the not-found guard -- produces a response.
    return await new Promise(function(resolve) {
      User.findById(request.params.userId, function(err, user) {
        if (err) return resolve(request.fail(err));

        if (!user) return resolve(request.fail({ message : 'user not found' }));

        return resolve(user.grant(request.payload.role, "site")
          .then(function(user) {
            if (request.payload.role === "trinket-teacher") {
              // grant connect for 30ish days
              var thru = moment().startOf('day').add(1, 'months').add(1, 'days').toISOString();

              var promise = Promise.resolve(user);
              if (!user.hasRole("trinket-connect")) {
                promise = promise.then(function(user) {
                  return user.grant("trinket-connect", "site", { thru : thru });
                });
              }
              if (!user.hasRole("trinket-connect-trial")) {
                promise = promise.then(function(user) {
                  return user.grant("trinket-connect-trial", "site", { thru : thru });
                });
              }
              return promise;
            }
            return Promise.resolve(user);
          })
          .then(function(user) {
            // The grant chain resolves the raw mongoose document, so serializing
            // it wholesale published every persisted path: measured, that body
            // carried `password` (a live $2b$10$ bcrypt hash), `profiles.google`
            // with the stored OAuth token and refreshToken, `roles`, `_id` and
            // `__v`. The model already declares what may leave the process -
            // lib/models/user.js publicSpec - and lib/models/model.js:59-91
            // attaches a serialize() method projecting exactly those keys, which
            // is what lib/controllers/course.js:69-71 already applies, with the
            // same typeof guard, before returning a user inside a response.
            //
            // That guard also keeps the two non-document edges answering as they
            // do now (both measured): a null user falls through to
            // JSON.parse(JSON.stringify(null)) and the body still reads
            // `user: null`, and an undefined user still throws the SyntaxError
            // that the chain's own .catch below turns into request.fail.
            return request.success({
              success : true,
              user    : user && typeof user.serialize === 'function'
                ? user.serialize()
                : JSON.parse(JSON.stringify(user))
            });
          })
          .catch(function(err) {
            return request.fail(err);
          }));
      });
    });
  },
  addFeaturedCourse : async function(request, h) {
    // `Boom` is intentionally not bound in this module: @hapi/boom is imported as
    // `errors`, and `Boom` is not a global. So neither `throw Boom.notFound()`
    // below ever raises a 404 -- each raises a ReferenceError, which is an Error,
    // which the chain's own .catch hands to errorResponse() as a 500. An unknown
    // owner slug and an unknown course both answer 500, not 404.
    return User.findByLogin(request.payload.ownerSlug)
      .then(function(user) {
        if (user) {
          return Course.findByUserAndSlug(user.id, request.payload.slug);
        }
        else {
          throw Boom.notFound();
        }
      })
      .then(function(course) {
        if (course) {
          return featuredStore.addMember(course.id, request.payload.page)
            .then(function() { return course; });
        }
        else {
          throw Boom.notFound();
        }
      })
      .then(function(course) {
        return request.success({
            success : true
          , course  : {
                id        : course.id
              , slug      : course.slug
              , name      : course.name
              , ownerSlug : course.ownerSlug
              , page      : request.payload.page
            }
        });
      })
      .catch(function(err) {
        return errorResponse(h, err);
      });
  },
  removeFeaturedCourse : async function(request, h) {
    return featuredStore.removeMember(request.params.courseId, request.query.page)
      .then(function() {
        return request.success();
      })
      .catch(function(err) {
        return errorResponse(h, err);
      });
  },
  moveFeaturedCourse : async function(request, h) {
    return featuredStore.moveMember(request.payload.courseId, request.payload.page, request.payload.currentIndex, request.payload.newIndex)
      .then(function() {
        return request.success();
      })
      .catch(function(err) {
        return errorResponse(h, err);
      });
  }
};

/**
 * Maps a rejected value onto the response the three featured-course handlers
 * answer with:
 *
 *   1. a Boom is returned unchanged, so it serves its own status;
 *   2. any other Error becomes Boom.badImplementation(err.message) — a 500 whose
 *      payload is Boom's standard "An internal server error occurred", so the
 *      message stays on the Boom. This is the edge the two unbound
 *      `Boom.notFound()` throws in addFeaturedCourse reach;
 *   3. anything else becomes an empty JSON object: 200 with body `{}`.
 *
 * The Boom test must stay first, because a Boom is also an Error and would
 * otherwise be rewritten into a 500. featuredStore rejects only with Errors, so
 * case 3 is a total-mapping fallback rather than a live path.
 *
 * @param {Object} h   the hapi response toolkit
 * @param {*}      err the rejected value
 * @returns {Object} the response value to return from the lifecycle method
 */
function errorResponse(h, err) {
  if (err && err.isBoom) {
    return err;
  }

  if (err instanceof Error) {
    return errors.badImplementation(err.message);
  }

  return h.response({});
}

function userSearch(q) {
  return new Promise(function(resolve, reject) {
    var data;

    User.findByLogin(q, function(err, user) {
      if (err) {
        return reject(err);
      }

      if (user) {
        data = JSON.parse(JSON.stringify(user));
        data.tags = [];

        Trinket.findForUser(user.id)
          .then(function(trinkets) {
            data.trinketsOwned = trinkets.length;
            return Course.findForUser(user.id);
          })
          .then(function(courses) {
            data.coursesOwned = courses.length;
            resolve(data);
          })
          .catch(function(err) {
            reject(err);
          });
      }
      else {
        resolve();
      }
    });
  });
}

function roleSearch(role, data) {
  return User.findByRole(role)
    .then(function(users) {
      users.map(function(user) {
        user.avatar = user.normalizeAvatar();
      });
      return users;
    });
}

// Bounds on the work and the mail a single POST /api/ohnoes request can cause.
// Every input to that message is caller-supplied, so the entry count, each
// field's rendered length and the number of mails per window are all capped.
//
// 25 entries: the only producer of this payload trims its own log to at most
// ten entries before posting (public/js/debug.js:36-37), so the cap is above
// anything a genuine report contains and only ever trims a fabricated one.
//
// 512 characters per field: the widest genuine value is a User-Agent string or
// a URL, both far below it, so the cap only truncates padding. The truncation
// marker is counted inside the cap, so a rendered field never exceeds it.
//
// 10 mails per 60000ms: the window state is two numbers rather than a table,
// because the limiter has to be global (see ohnoesMailAllowed below) and a
// per-caller table on an anonymous route would grow without bound.
var MAX_OHNOES_ENTRIES         = 25
  , MAX_OHNOES_FIELD_LENGTH    = 512
  , OHNOES_TRUNCATION_MARKER   = '...[truncated]'
  , OHNOES_MAIL_MAX_PER_WINDOW = 10
  , OHNOES_MAIL_WINDOW_MS      = 60000
  , ohnoesMailWindowStart      = 0
  , ohnoesMailWindowCount      = 0;

/**
 * Renders one ohnoes log field into the alert mail, bounded and defanged.
 *
 * Three things happen, in this order:
 *
 *   1. String(value) - the coercion the message's own concatenation performed,
 *      kept so a missing field still renders "undefined" and an object still
 *      renders "[object Object]";
 *   2. control characters are replaced with a space. CR, LF and TAB are the
 *      message's own framing characters ("\n" + label + "\t\t" + value), so a
 *      value containing them could otherwise forge additional labelled lines
 *      and entry separators; the rest of C0, DEL and C1 are neutralized with
 *      them because they carry no meaning in a plain-text mail body;
 *   3. the result is truncated to MAX_OHNOES_FIELD_LENGTH, marker included, so
 *      the rendered length of a field is bounded whatever the caller sent.
 *
 * @param {*} value the raw value read off the submitted log entry
 * @returns {string} the value as it appears in the mail body
 */
function sanitizeOhnoesField(value) {
  var text = String(value).replace(/[\u0000-\u001F\u007F-\u009F]/g, ' ');

  if (text.length > MAX_OHNOES_FIELD_LENGTH) {
    text = text.slice(0, MAX_OHNOES_FIELD_LENGTH - OHNOES_TRUNCATION_MARKER.length)
      + OHNOES_TRUNCATION_MARKER;
  }

  return text;
}

/**
 * Sends one administrator session alert, rate-limited and fire-and-forget.
 *
 * Two properties of the baseline call are kept exactly. It is not awaited, so
 * neither its completion nor its failure affects the response the handler
 * already decided; and its error is swallowed, which is what an un-awaited call
 * did with it. What is added is the rejection handler, without which the
 * swallowing is no longer local: mailer.send is `async`
 * (lib/util/mailer.js), so a rejected send from an un-awaited call is an
 * unhandled rejection, and no 'unhandledRejection' or 'uncaughtException'
 * listener exists in app.js, lib/** or config/**, so on Node 22 an SMTP failure
 * an anonymous request triggered would terminate the process.
 *
 * Promise.resolve() wraps the return value rather than calling .catch on it
 * directly because mailer.send is replaced by non-native promises elsewhere in
 * the tree (test/helpers/mail.js returns a Q promise); wrapping normalizes all
 * of them, while a synchronous throw from send still propagates to the caller
 * as it does today.
 *
 * @param {string} text the rendered alert body
 * @returns {undefined} nothing; the caller's response does not depend on this
 */
function sendOhnoesAlert(text) {
  if (!ohnoesMailAllowed()) {
    return;
  }

  Promise.resolve(mailer.send(config.app.adminEmail, 'User Session Alert', {
    text : text
  })).catch(function(err) {
    log.error('Admin session alert mail failed:', err);
  });
}

/**
 * Fixed-window rate limit on the administrator alert mail, in O(1) state.
 *
 * The limit is deliberately global rather than per caller. POST /api/ohnoes
 * takes anonymous requests, so any key a limiter could bucket on - address,
 * session, a payload field - is caller-controlled, and a table keyed on one
 * would itself grow without bound under the same traffic the limiter exists to
 * absorb. What has to be capped is the number of mails leaving the process, and
 * that is a single global quantity.
 *
 * A fixed window is used rather than a sliding one because it holds two numbers
 * and needs no per-request allocation; the cost is that a burst straddling a
 * window boundary can send up to twice the limit across the two windows, which
 * is an acceptable bound for an alert mail.
 *
 * The warning is logged once per window, on the first refusal, so the log is not
 * flooded by the very requests being dropped.
 *
 * @returns {boolean} true if this request may send its mail
 */
function ohnoesMailAllowed() {
  var now = Date.now();

  if (now - ohnoesMailWindowStart >= OHNOES_MAIL_WINDOW_MS) {
    ohnoesMailWindowStart = now;
    ohnoesMailWindowCount = 0;
  }

  ohnoesMailWindowCount++;

  if (ohnoesMailWindowCount <= OHNOES_MAIL_MAX_PER_WINDOW) {
    return true;
  }

  if (ohnoesMailWindowCount === OHNOES_MAIL_MAX_PER_WINDOW + 1) {
    log.warn('Admin session alert mail rate limit reached: '
      + OHNOES_MAIL_MAX_PER_WINDOW + ' sent within ' + OHNOES_MAIL_WINDOW_MS
      + 'ms. Further alerts are dropped until the window rolls over; requests '
      + 'still receive their normal response.');
  }

  return false;
}
