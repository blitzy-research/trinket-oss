var config        = require('config'),
    _             = require('underscore'),
    util          = require('util'),
    mailer        = require('../util/mailer'),
    Store         = require('../util/store'),
    NoResponse    = require('../http/responseContract').noResponse,
    userUtil      = require('../util/user'),
    // The centralized credential scrub. Both surfaces below JSON-clone the User document in the
    // HANDLER, which flattens it before any responder runs, so lib/models/model.js#serialize cannot
    // reach them and each applies the scrub itself. See docs/PRESERVED-QUIRKS.md section 4.14.
    Credentials   = require('../util/credentials'),
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
        // This catch swallows the error and resolves with an empty course list, so a
        // featured-store or Course.findById failure still renders the admin page with HTTP 200
        // and no featured courses. Letting the rejection through would turn that 200 into a 500.
        .catch(function(err) {
          pageData.courses = [];
          return pageData;
        });
    }
    else {
      promise = Promise.resolve();
    }

    return promise.then(function(data) {
      return h.respond({
        page    : page,
        subpage : subpage || page,
        q       : request.query.q || undefined,
        active  : request.query.active || 'profile',
        data    : data
      });
    });
  },
  ohnoes : async function(request, h) {
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. This local `log` SHADOWS the
    // undeclared global `log` that app.js assigns, for the whole handler body. The
    // name is preserved and no require is added.
    var log = request.payload.log;

    // ORDERING IS BEHAVIOUR: the response is computed FIRST - which is what drains the flash bag at
    // this point in the sequence - and returned LAST, after the alert body is built and mailer.send()
    // has fired. Collapsing this into `return h.respond();` would skip both.
    // See docs/PRESERVED-QUIRKS.md.
    var response = h.respond();

    if (!log || !log.length) return response;

    var keys = "time,path,referrer,user,userAgent,sesh".split(",");
    // `msg` is deliberately left uninitialized, so the first `msg +=` below coerces
    // `undefined` and the alert email body begins with the literal text "undefined".
    var msg;
    for (var i = 0; i < log.length; i++) {
      for (var j = 0; j < keys.length; j++) {
        msg += "\n" + keys[j] + "\t\t" + log[i][keys[j]];
      }
      msg += "\n----------------------------------"
    }

    // mailer.send() is deliberately not awaited: the alert is fire-and-forget, and awaiting it
    // would delay the 200 that has already been computed above. The terminal catch keeps a rejection
    // from a configured transport from becoming a process-fatal unhandled rejection under Node 22's
    // default --unhandled-rejections=throw. It is empty on purpose: a failed alert is invisible to
    // the client, so there is no failure path to report.
    mailer.send(config.app.adminEmail, 'User Session Alert', {
      text : msg
    }).catch(function(mailError) {
      return mailError;
    });

    return response;
  },
  uploadForm : async function(request, h) {
    return h.respond({});
  },
  uploadUsers : async function(request, h) {
    // `userList` is computed and never read - the parse below consumes
    // request.payload.userList raw. The dead local is kept, including its throw on a missing
    // payload, which reaches the centralized error map as a 500.
    var userList = request.payload.userList.split(/\n/);
    var promises = [];
    var records;

    // Email, Username, Name, Password
    try {
      records = await util.promisify(parse)(request.payload.userList, {
        columns: true,
        skip_empty_lines: true
      });
    }
    catch (err) {
      // A parse failure belongs to the failure responder, not to the centralized error map: a bare
      // `await` here would skip the responder and change the mapping. Because hapi refuses to wrap an
      // Error payload, that responder throws on this raw `err`, so this branch answers nothing;
      // rejectOrAbandon reproduces that outcome and passes any non-raising response straight out.
      // See lib/http/responseContract.js#rejectOrAbandon.
      return NoResponse.rejectOrAbandon(h, err);
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

    // Promise.allSettled never rejects, so there is no rejection handler here.
    var results = await Promise.allSettled(promises);
    // `errors` deliberately shadows the module-level @hapi/boom binding inside this handler.
    // Do not rename either local.
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

    return h.respond({
      page    : 'upload',
      subpage : 'upload',
      success : success,
      errors  : errors
    });
  },
  updateUser : async function(request, h) {
    var user;

    // Each flattened lookup keeps its own try/catch so the failure still reaches the rejection
    // responder rather than the centralized error map. That responder ends in h.response(json) and
    // hapi refuses to wrap an Error, so a raw Error argument makes it raise while a plain object
    // answers 200.
    try {
      user = await User.findById(request.params.userId);
    }
    catch (err) {
      // This branch answers nothing: the failure responder cannot wrap a raw Error.
      // See lib/http/responseContract.js#rejectOrAbandon.
      return NoResponse.rejectOrAbandon(h, err);
    }

    // A plain-object payload does not trip hapi's error assertion, so the responder returns
    // h.response(json) and the client receives HTTP 200 carrying
    // { message : 'user not found', flash : {} }.
    if (!user) return h.reject({ message : 'user not found' });

    if (request.payload.roles) {
      // PRESERVED QUIRK: lib/models/plugins/roles.js#mergeRoles calls roles.forEach, so a truthy
      // non-array payload raises a TypeError here and the request answers NOTHING. The throw is
      // contained rather than allowed to reach lib/http/errorMap.js as a 500, and `mergeRoles` is
      // still called with the same argument on the same line.
      try {
        user.mergeRoles(request.payload.roles);
      }
      catch (mergeError) {
        return NoResponse.rejectOrAbandon(h, mergeError);
      }

      try {
        await user.save();
      }
      catch (err) {
        // PRESERVED QUIRK: a failed role write answers NOTHING. Only the HTTP fate is reproduced;
        // the process is not terminated. See lib/http/responseContract.js#rejectOrAbandon.
        return NoResponse.rejectOrAbandon(h, err);
      }

      return h.respond({
        success : true
      });
    }

    // PRESERVED QUIRK: a falsy request.payload.roles answers NOTHING - no status, no body, no log
    // line - leaving this one request unanswered with its socket open while every other route carries
    // on. `h.abandon` is hapi's own no-response outcome and is what reproduces it; falling through
    // instead would resolve `undefined` and answer 500. See docs/PRESERVED-QUIRKS.md section 1.15.
    return h.abandon;
  },
  grantRole : async function(request, h) {
    var user;

    try {
      user = await User.findById(request.params.userId);
    }
    catch (err) {
      return NoResponse.rejectOrAbandon(h, err);
    }

    if (!user) return h.reject({ message : 'user not found' });

    // The chain is returned rather than flattened so that the ReferenceError raised on the
    // trinket-teacher branch below stays contained by this chain's own .catch and is still
    // handed to h.reject instead of escaping to the centralized error map.
    return user.grant(request.payload.role, "site")
      .then(function(user) {
        if (request.payload.role === "trinket-teacher") {
          // grant connect for 30ish days
          //
          // `moment` is not required by this file and is neither a Node global nor one of the
          // globals app.js whitelists, so the next line raises a ReferenceError on this branch
          // only, which the chain's .catch hands to h.reject. Adding the require would flip
          // every trinket-teacher grant from failure to success, so the identifier is kept.
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
        // The `JSON.parse(JSON.stringify(user))` round-trip is the payload SHAPE and stays that
        // shape: it clones the whole User document rather than projecting `publicSpec`. The scrub is
        // the centralized recursive one rather than a top-level `delete`, because a live provider
        // credential sits one level down inside the untyped Mixed `profiles` object. Every
        // non-credential key is untouched, and the only reader of this response - the admin role
        // editor - reads `result.success`. See docs/PRESERVED-QUIRKS.md section 4.14.
        return h.respond({
          success : true,
          user    : Credentials.redact(JSON.parse(JSON.stringify(user)))
        });
      })
      .catch(function(err) {
        // No response, on the reachable trinket-teacher path above as well as on a genuine grant
        // failure. See lib/http/responseContract.js#rejectOrAbandon.
        return NoResponse.rejectOrAbandon(h, err);
      });
  },
  addFeaturedCourse : async function(request, h) {
    return User.findByLogin(request.payload.ownerSlug)
      .then(function(user) {
        if (user) {
          return Course.findByUserAndSlug(user.id, request.payload.slug);
        }
        else {
          // `Boom` is undeclared in this file: @hapi/boom is bound as `errors` and that binding
          // has zero call sites. Evaluating `Boom` raises ReferenceError before `.notFound` is
          // reached, so an unknown owner slug answers a scrubbed 500, not a 404. Adding a require,
          // or rerouting this through `errors`, would convert that 500 into a 404.
          throw Boom.notFound();
        }
      })
      .then(function(course) {
        if (course) {
          return featuredStore.addMember(course.id, request.payload.page)
            .then(function() { return course; });
        }
        else {
          // Same undeclared `Boom`: an unknown course slug answers 500, not 404.
          throw Boom.notFound();
        }
      })
      .then(function(course) {
        return h.respond({
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
        throw err;
      });
  },
  removeFeaturedCourse : async function(request, h) {
    return featuredStore.removeMember(request.params.courseId, request.query.page)
      .then(function() {
        return h.respond();
      })
      .catch(function(err) {
        throw err;
      });
  },
  moveFeaturedCourse : async function(request, h) {
    return featuredStore.moveMember(request.payload.courseId, request.payload.page, request.payload.currentIndex, request.payload.newIndex)
      .then(function() {
        return h.respond();
      })
      .catch(function(err) {
        throw err;
      });
  }
};

// Three settle paths, all load-bearing: a lookup failure or a failure in either aggregate query
// REJECTS - the caller in `index` attaches no .catch, so it reaches the centralized error map as a
// scrubbed 500 - a found user resolves with the fully populated `data`, and a missing user resolves
// with `undefined`, which `index` passes through as the view's `data`. Statement order is behaviour:
// serialize, blank the tags, count trinkets, then count courses.
async function userSearch(q) {
  var user = await User.findByLogin(q);

  if (!user) {
    return undefined;
  }

  // This round-trip is the payload shape and stays that shape, but it flattens the User document to a
  // plain object BEFORE the success responder runs, so `ObjectUtils.serialize` finds nothing to project
  // and the whole document would reach the client - and the admin page renders this object wholesale
  // through a frozen template. Credentials are therefore removed here at the source, with the
  // centralized recursive scrub rather than a top-level `delete`, because a live provider credential
  // sits inside the untyped Mixed `profiles` object. Every non-credential key is untouched, and
  // `roleSearch` below already answers clean because it hands the responder real documents.
  // See docs/PRESERVED-QUIRKS.md section 4.14.
  var data = Credentials.redact(JSON.parse(JSON.stringify(user)));
  data.tags = [];

  var trinkets = await Trinket.findForUser(user.id);
  data.trinketsOwned = trinkets.length;

  var courses = await Course.findForUser(user.id);
  data.coursesOwned = courses.length;

  return data;
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
