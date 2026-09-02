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

    // The response is built here, at the point the callback-era code called
    // request.success(), so the alert mail below is still sent after the response
    // has been decided and the empty-log short circuit still answers with it.
    var response = request.success();

    if (!log || !log.length) return response;

    var keys = "time,path,referrer,user,userAgent,sesh".split(",");
    var msg;
    for (var i = 0; i < log.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        msg += "\n" + keys[j] + "\t\t" + log[i][keys[j]];
      }
      msg += "\n----------------------------------"
    }

    // Deliberately not awaited, as at baseline: the alert mail is fire-and-forget
    // and neither its completion nor its failure affects the response.
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
    // `csv`'s parse() keeps its callback interface, so per rule T-3 the promise
    // boundary is created here at the call site — inside the lifecycle method —
    // rather than by swapping in a promise-returning parser API. The awaited
    // promise settles on whichever edge the callback reaches, exactly as the
    // deferred response did: the parse-error edge below, or the tallied
    // success edge once every row's save() has settled.
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

        // Still Promise.allSettled, so a partially failing roster is tallied
        // rather than short-circuiting, and still no per-row error handling.
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
    // User.findById keeps its callback interface (the models are unchanged), so
    // per rule T-3 the promise boundary is created here at the call site and the
    // settled value is returned from the lifecycle method. Each edge below
    // settles the promise where it previously settled the deferred response.
    //
    // The `if (request.payload.roles)` branch has no else, and this route
    // declares no validation, so a payload without `roles` reaches the end of
    // the callback without producing a response. Baseline leaves such a request
    // unanswered (measured: the request never settles, the server stays up), and
    // R-d/T-6 require that outcome be preserved rather than improved, so no
    // value is resolved on that path either.
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
    // Callback boundary as above: the promise is created at this call site and
    // the grant chain's own value settles it, so the chain's .then/.catch edges
    // keep producing the responses they produce today.
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
    // NOTE: `Boom` below is deliberately left unbound. This module imports
    // @hapi/boom as `errors`, never as `Boom`, and `Boom` is not a global, so
    // each throw raises a ReferenceError that the chain's own .catch turns into
    // Boom.badImplementation via errorResponse() — a 500, not a 404 (measured).
    // Binding `Boom` or rewriting these to errors.notFound() would change two
    // error edges from 500 to 404, which R-d and R-e prohibit.
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
 * Maps an error onto the response the callback-era `reply(err)` produced, so the
 * three featured-course error edges keep their existing status codes and payload
 * shapes (R-e). `reply()` handled a value in three ways, and this reproduces each:
 *
 *   1. a Boom error was returned unchanged, keeping its own status;
 *   2. any other Error became Boom.badImplementation(err.message) — a 500 whose
 *      payload is Boom's standard "An internal server error occurred". This is the
 *      edge the two unbound `Boom.notFound()` throws above reach (measured: 500);
 *   3. anything else was handed back as a response builder object, which hapi
 *      serialized to `{}` with a 200, because a builder exposes only methods.
 *      featuredStore rejects only with Errors, so case 3 is unreachable today; it
 *      is reproduced rather than dropped so the mapping stays total.
 *
 * The Boom check comes first because Boom errors are also Error instances, which
 * is the order `reply()` tested them in.
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
