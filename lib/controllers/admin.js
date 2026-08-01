var config        = require('config'),
    _             = require('underscore'),
    mailer        = require('../util/mailer'),
    Store         = require('../util/store'),
    userUtil      = require('../util/user'),
    featuredStore = Store.featured(),
    errors        = require('@hapi/boom'),
    parse         = require('csv').parse;

module.exports = {
  index : function(request, h) {
    var page     = request.params.adminPage
      , pageData = {}
      , subpage, promise, criteria;

    if (!request.params.adminPage) {
      // hapi API migration: the retired shim's synthetic response builder resolved its
      // redirect step by handing the RAW url to h and discarding the data argument, so
      // calling the toolkit directly is a byte-equivalent move. The toolkit defaults to
      // HTTP 302 and the shim never overrode it, so no permanent-status override is added.
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
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. This catch SWALLOWS the
        // error and resolves with an empty course list, so a featured-store or
        // Course.findById failure still renders the admin page with HTTP 200 and no
        // featured courses at all. The swallowing is preserved exactly: letting the
        // rejection through would turn a baseline 200 into a 500.
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
  ohnoes : function(request, h) {
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. This local `log` SHADOWS the
    // undeclared global `log` that app.js assigns, for the whole handler body. The
    // name is preserved and no require is added.
    var log = request.payload.log;

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Baseline called
    // request.success() for its SIDE EFFECT here - it resolved the shim's deferred
    // with the 200 (draining the flash bag at this exact point in the sequence) and
    // then the handler CONTINUED, building the alert body and firing mailer.send()
    // after the response had already been captured. The response is therefore
    // computed first and returned last, so both halves survive: collapsing this into
    // `return request.success();` would skip the message build and the mail send.
    var response = request.success();

    if (!log || !log.length) return response;

    var keys = "time,path,referrer,user,userAgent,sesh".split(",");
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. `msg` is deliberately left
    // UNINITIALIZED, so the first `msg +=` below coerces `undefined` and the alert
    // email body begins with the literal text "undefined". Do not initialise it.
    var msg;
    for (var i = 0; i < log.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        msg += "\n" + keys[j] + "\t\t" + log[i][keys[j]];
      }
      msg += "\n----------------------------------"
    }

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. mailer.send() is deliberately
    // NOT awaited: baseline fired it after the response was already settled, so the
    // alert is fire-and-forget. Awaiting it would delay the 200, and attaching a
    // .catch() would be new behavior.
    mailer.send(config.app.adminEmail, 'User Session Alert', {
      text : msg
    });

    return response;
  },
  uploadForm : function(request, h) {
    return request.success({});
  },
  uploadUsers : async function(request, h) {
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. `userList` is computed and then
    // never read - the parse below consumes request.payload.userList raw. The dead
    // local is preserved, including its throw on a missing payload, which reaches the
    // centralized error map as a 500 exactly as it does at baseline.
    var userList = request.payload.userList.split(/\n/);
    var promises = [];
    var records;

    // Email, Username, Name, Password
    //
    // Async conversion: the error-first csv callback is flattened through a local
    // promise wrapper rather than util.promisify, so that no new require enters this
    // file. The parse() call form and both options are byte-identical to baseline -
    // only the resolved csv version moved (1.2.1 -> 6.6.1, same package).
    try {
      records = await new Promise(function(resolve, reject) {
        parse(request.payload.userList, {
          columns: true,
          skip_empty_lines: true
        }, function(err, records) {
          if (err) return reject(err);
          return resolve(records);
        });
      });
    }
    catch (err) {
      // Error-mapping preservation (R-5): baseline routed this callback's `err` to
      // request.fail(err), and that destination is preserved exactly - same responder,
      // same single raw-error argument, so the failure keeps logging and flashing
      // through the response contract instead of bypassing it. A bare `await` would
      // have handed the rejection straight to the centralized error map, skipping
      // request.fail entirely, which is the mapping change R-5 forbids.
      //
      // Measured, and identical before and after (see the parity note on updateUser):
      // request.fail() ends in h.response(json), and hapi refuses to wrap an Error, so
      // an Error argument makes the responder itself raise and the site resolves as a
      // scrubbed 500 - whereas a plain-object argument answers 200. Both outcomes are
      // the response contract's, not this controller's, and both are unchanged here.
      return request.fail(err);
    }

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

    // Promise.allSettled never rejects, so baseline's lack of a rejection handler
    // here is carried across unchanged.
    var results = await Promise.allSettled(promises);
    // `errors` deliberately SHADOWS the module-level @hapi/boom binding inside this
    // handler, exactly as at baseline. Preserved; do not rename either local.
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
  },
  updateUser : async function(request, h) {
    var user;

    // Error-mapping preservation (R-5): baseline's `if (err) return request.fail(err);`
    // sent the lookup failure to request.fail, so each flattened call keeps its own
    // try/catch to send it to exactly the same place with exactly the same single raw
    // argument. An unguarded `await` would reject straight into the centralized error
    // map, skipping request.fail - a changed mapping.
    //
    // R-6 PARITY NOTE, measured rather than assumed: request.fail() ends in
    // h.response(json) both in the retired shim (lib/util/routeParser.js:L482-L513 at
    // the base commit) and in lib/http/responseContract.js#reject, and hapi 21 asserts
    // `result instanceof Error === false` ('Cannot wrap an error'). So request.fail with
    // a PLAIN OBJECT answers 200, while request.fail with a raw Error makes the
    // responder raise and the request resolves as a scrubbed 500. Both behaviors are
    // byte-identical before and after this conversion; what this file owns, and what is
    // preserved here, is WHICH responder each failure is handed to.
    try {
      user = await User.findById(request.params.userId);
    }
    catch (err) {
      return request.fail(err);
    }

    if (!user) return request.fail({ message : 'user not found' });

    if (request.payload.roles) {
      user.mergeRoles(request.payload.roles);

      try {
        await user.save();
      }
      catch (err) {
        return request.fail(err);
      }

      return request.success({
        success : true
      });
    }

    // PRESERVED QUIRK / R-6 ADJUDICATION - see docs/PRESERVED-QUIRKS.md. With a falsy
    // request.payload.roles baseline responded to NOTHING: the callback fell through,
    // the shim's deferred never settled and the request hung forever. The deferral is
    // retired, so this fall-through now resolves `undefined` and hapi answers its own
    // 500. That hang-to-500 convergence is unavoidable - a hang is not reproducible by
    // any means once the deferral is gone - and it is accepted rather than papered
    // over: no else branch, no default response and no validation guard is added,
    // because inventing a status code no baseline request ever received would be
    // latent-bug repair.
  },
  grantRole : async function(request, h) {
    var user;

    // Error-mapping preservation (R-5), on the same terms as updateUser above: the
    // flattened lookup keeps handing its failure to request.fail rather than letting an
    // unguarded `await` bypass the responder into the centralized error map.
    try {
      user = await User.findById(request.params.userId);
    }
    catch (err) {
      return request.fail(err);
    }

    if (!user) return request.fail({ message : 'user not found' });

    // The promise chain below is returned verbatim rather than flattened, precisely so
    // that the ReferenceError documented at the `thru` assignment stays contained by
    // this chain's OWN .catch and is still handed to request.fail. Flattening the chain
    // would let that throw escape to the centralized error map instead, which is a
    // changed error mapping even though both paths end in a 500.
    return user.grant(request.payload.role, "site")
      .then(function(user) {
        if (request.payload.role === "trinket-teacher") {
          // grant connect for 30ish days
          //
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The date-library
          // identifier on the next line is NOT required by this file - the require
          // block at the top is complete - and it is neither a Node global nor one of
          // the globals app.js whitelists, so evaluating it raises a ReferenceError on
          // this branch and this branch only. That throw is caught by this chain's own
          // .catch below and handed to request.fail, which logs it and flashes the
          // failure - the same destination, and the same measured outcome, as at
          // baseline. Adding the missing require would flip every trinket-teacher grant
          // from failure to success, so the bare identifier is kept byte-for-byte and
          // no require is added.
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
      });
  },
  addFeaturedCourse : function(request, h) {
    return User.findByLogin(request.payload.ownerSlug)
      .then(function(user) {
        if (user) {
          return Course.findByUserAndSlug(user.id, request.payload.slug);
        }
        else {
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. `Boom` is UNDECLARED in
          // this file: @hapi/boom is bound as `errors` in the require block and that
          // binding has zero call sites. Evaluating `Boom` therefore raises
          // `ReferenceError: Boom is not defined` before `.notFound` is ever reached,
          // the .catch below turns it into a scrubbed HTTP 500, and app.js renders
          // 50x.html. An unknown owner slug answers 500, NOT 404. Adding a require, or
          // rerouting this through the file's own `errors` binding, would silently
          // convert that 500 into a 404.
          throw Boom.notFound();
        }
      })
      .then(function(course) {
        if (course) {
          return featuredStore.addMember(course.id, request.payload.page)
            .then(function() { return course; });
        }
        else {
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Same undeclared `Boom` as
          // above: an unknown course slug answers 500, not 404. Preserved verbatim.
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
      // hapi API migration: the retired shim's synthetic responder answered a raw error
      // by passing a Boom straight through and by wrapping any other Error in
      // Boom.badImplementation. A bare re-throw reproduces BOTH branches - hapi 21
      // measures thrown and returned Boom values as wire-equivalent, and the
      // centralized error map in lib/http/errorMap.js turns a plain Error into the
      // same scrubbed 500.
      .catch(function(err) {
        throw err;
      });
  },
  removeFeaturedCourse : function(request, h) {
    return featuredStore.removeMember(request.params.courseId, request.query.page)
      .then(function() {
        return request.success();
      })
      .catch(function(err) {
        throw err;
      });
  },
  moveFeaturedCourse : function(request, h) {
    return featuredStore.moveMember(request.payload.courseId, request.payload.page, request.payload.currentIndex, request.payload.newIndex)
      .then(function() {
        return request.success();
      })
      .catch(function(err) {
        throw err;
      });
  }
};

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
