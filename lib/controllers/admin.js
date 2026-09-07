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

    // This route is declared with no `config` block (config/api_routes.js), so it
    // inherits the default strategy in `mode: 'try'` (app.js) and hapi hands
    // guests to this handler with request.auth.isAuthenticated false. Baseline
    // answers them, and no authentication requirement is enforced here: a guard
    // added at this point was measured turning baseline's guest 200 into a 401
    // and has been withdrawn, because R-d prohibits the improvement and AAP
    // §0.7's approved-deviation register is closed at two. The reasoning, the
    // measurement and what preserving this leaves exposed are in
    // docs/preserved-quirks.md §11.6.
    //
    // The response is built here, at the point the callback-era code called
    // request.success(), so the alert mail below is still sent after the response
    // has been decided and the empty-log short circuit still answers with it.
    var response = request.success();

    if (!log || !log.length) return response;

    // All six labels are read off each submitted entry, in this order. `user` and
    // `sesh` are caller-supplied like the other four -- the only producer fills
    // `sesh` from the raw `session` cookie value and `user` from the DOM
    // (public/js/debug.js) -- and both are kept, because dropping them was
    // measured changing the alert body against baseline and was withdrawn with
    // the rest of the policy recorded in docs/preserved-quirks.md §11.6.
    //
    // `msg` is deliberately left undefined here: the first `+=` below coerces it,
    // so every alert body begins with the literal text "undefined". That is the
    // baseline outcome and it is preserved.
    var keys = "time,path,referrer,user,userAgent,sesh".split(",");
    var msg;

    // Every entry the caller submitted is rendered, unbounded, and each field is
    // indexed straight off the entry and coerced by the concatenation. Three
    // consequences are baseline behaviour and all three are preserved: a missing
    // field renders the literal "undefined"; a `log` whose elements cannot be
    // indexed -- `{length: 3}`, or an array containing `null` -- throws here and
    // reaches the routeParser catch-all as a 500; and a value containing the
    // message's own framing characters ("\n", "\t") forges extra labelled lines.
    // An entry cap and a per-field sanitizer were measured on this loop and
    // withdrawn with the rest of the policy (docs/preserved-quirks.md §11.6).
    for (var i = 0; i < log.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        msg += "\n" + keys[j] + "\t\t" + log[i][keys[j]];
      }
      msg += "\n----------------------------------"
    }

    // Fire and forget, exactly as baseline: the send is not awaited, so neither
    // its completion nor its failure affects the response already decided above,
    // and one mail leaves the process per mailable request with no rate limit.
    // No rejection handler is attached, because attaching one was measured as a
    // behaviour change and withdrawn; what that leaves exposed -- mailer.send is
    // `async`, so a rejected send from an un-awaited call is an unhandled
    // rejection, and Node 22 terminates on one -- is recorded in
    // docs/preserved-quirks.md §11.6 rather than repaired here.
    mailer.send(config.app.adminEmail, 'User Session Alert', {
      text : msg
    });

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
    //
    // The callback runs on the csv Parser's own stack -- reached from
    // `Parser.emit`, not from this function's frame -- so a throw inside it
    // escapes this promise entirely and reaches no lifecycle catch. Measured
    // before this guard: one POST /admin/upload took the whole process down
    // twice over. A malformed CSV (an unclosed quote) reached
    // `request.fail(err)` with an Error and hapi's toolkit refused to wrap it;
    // a CSV with no Email column reached `userUtil.generate_username(undefined)`
    // and threw a TypeError. Both left the admin looking at
    // ERR_CONNECTION_REFUSED and every other user with no site at all (QA
    // findings ux-F42 CRITICAL, perf-malformed-csv-kills-process HIGH).
    //
    // `reject` is what fixes the second class and any other throw this body can
    // raise: it routes the thrown value into the promise this lifecycle method
    // returns, so the Layer 1 catch-all in lib/util/routeParser.js logs its
    // stack and answers Boom.badImplementation -- the same 500 the same throw
    // would have produced had it happened on the handler's own stack. The
    // thrown value is passed through unchanged rather than reshaped, so the
    // error mapping R-e protects is the funnel's, not a new one invented here.
    // The first class is fixed in request.fail itself, which now routes an
    // Error argument as a Boom.
    return await new Promise(function(resolve, reject) {
      parse(request.payload.userList, {
        columns: true,
        skip_empty_lines: true
      }, function(err, records) {
       try {
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
       }
       catch (thrown) {
        // Off-stack throw: reject so the handler's promise carries it to the
        // Layer 1 catch-all instead of the process.
        reject(thrown);
       }
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
            // The grant chain resolves the raw mongoose document and it is
            // serialized wholesale, so the body publishes every persisted path:
            // measured, it carries `password` (a live $2b$10$ bcrypt hash),
            // `profiles.google` with the stored OAuth token and refreshToken,
            // `roles`, `_id`, `verified`, `source` and `__v`.
            //
            // A publicSpec projection through the model's own serialize() was
            // measured here and withdrawn: it changed this response body against
            // baseline, which AAP §0.9.3 compares exactly, and no approved
            // deviation covers it. The exposure is preserved and recorded in
            // docs/preserved-quirks.md §9.11 and §11.6 rather than repaired.
            //
            // Two non-document edges ride on the wholesale form and are also
            // baseline: a null user yields a body reading `user: null`, and an
            // undefined user throws the SyntaxError the chain's own .catch below
            // turns into request.fail.
            return request.success({
              success : true,
              user    : JSON.parse(JSON.stringify(user))
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

