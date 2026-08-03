var config        = require('config'),
    _             = require('underscore'),
    util          = require('util'),
    mailer        = require('../util/mailer'),
    Store         = require('../util/store'),
    Pending       = require('../http/pending'),
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

    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Baseline called
    // h.respond() for its SIDE EFFECT here - it resolved the shim's deferred
    // with the 200 (draining the flash bag at this exact point in the sequence) and
    // then the handler CONTINUED, building the alert body and firing mailer.send()
    // after the response had already been captured. The response is therefore
    // computed first and returned last, so both halves survive: collapsing this into
    // `return h.respond();` would skip the message build and the mail send.
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

    // mailer.send() is deliberately not awaited: the alert is fire-and-forget. Awaiting it
    // would delay the 200, and attaching a .catch() would change behavior.
    mailer.send(config.app.adminEmail, 'User Session Alert', {
      text : msg
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
      // Error-mapping preservation (R-5): baseline routed this callback's `err` to
      // the failure responder, and that destination is preserved exactly - same responder,
      // same single raw-error argument, so the failure keeps logging and flashing
      // through the response contract instead of bypassing it. A bare `await` would
      // have handed the rejection straight to the centralized error map, skipping the
      // failure responder entirely, which is the mapping change R-5 forbids. The base
      // commit spelled that responder `request.fail`; the native toolkit publishes the
      // identical closure as `h.reject`, so the destination is unchanged.
      //
      // R-6, and measured rather than assumed - see lib/http/pending.js#rejectOrHang for
      // the full derivation. The responder ends in `h.response(json)`, and hapi 21 raises
      // `AssertError: Cannot wrap an error` on an Error payload, so handing it this raw
      // `err` makes the RESPONDER throw. At the base commit that raise happened inside
      // csv's own parse callback, where it could not become a response and left the shim's
      // deferred unsettled: this branch answered NOTHING. rejectOrHang invokes the same
      // responder with the same single raw argument and restores that fate, while passing
      // any non-raising response - a 302 from fail.redirect, a rendered fail.html view, or
      // the plain-object 200 - straight back out.
      return Pending.rejectOrHang(h, err);
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
    // responder - h.reject, spelled request.fail at the base commit - rather than the centralized
    // error map. That responder ends in h.response(json) and hapi refuses to wrap an Error, so a
    // raw Error argument makes it raise and the request answers a scrubbed 500, while a plain
    // object answers 200.
    try {
      user = await User.findById(request.params.userId);
    }
    catch (err) {
      // R-6 - the base commit reached the responder here from lib/models/model.js#findById's
      // orphaned `.catch(cb)`, so the AssertError a raw Error provokes became an unhandled
      // rejection and this branch answered NOTHING. See lib/http/pending.js#rejectOrHang.
      return Pending.rejectOrHang(h, err);
    }

    // The only branch of this handler that answered at the base commit with a status other
    // than the success 200: a plain-object payload does not trip hapi's error assertion, so
    // the responder returns h.response(json) and the client receives HTTP 200 carrying
    // { message : 'user not found', flash : {} }. Measured live, before and after.
    if (!user) return h.reject({ message : 'user not found' });

    if (request.payload.roles) {
      // R-6 - lib/models/plugins/roles.js#mergeRoles calls roles.forEach, so a truthy
      // non-array payload raises a TypeError here. At the base commit that throw happened
      // inside findById's first callback invocation, and the enclosing
      // `promise.then(cb).catch(cb)` then invoked the SAME callback a second time with the
      // TypeError as `err` - verified directly against that exact shape - which reached
      // `request.fail(err)` and raised the AssertError in the same orphaned position as
      // above. So a malformed roles payload also answered NOTHING. The throw is contained
      // here rather than allowed to reach lib/http/errorMap.js as a 500, and `mergeRoles` is
      // still called with the same argument on the same line.
      try {
        user.mergeRoles(request.payload.roles);
      }
      catch (mergeError) {
        return Pending.rejectOrHang(h, mergeError);
      }

      try {
        await user.save();
      }
      catch (err) {
        // R-6 - at the base commit this was `user.save(function (err, user) { if (err)
        // return request.fail(err); ... })`, a Mongoose document callback. The AssertError
        // was re-thrown through `immediate()` as an uncaught exception and the deferred was
        // never settled, so a failed role write answered NOTHING. Only the HTTP fate is
        // reproduced; the process termination is the adjudication recorded in
        // lib/http/pending.js and docs/PRESERVED-QUIRKS.md.
        return Pending.rejectOrHang(h, err);
      }

      return h.respond({
        success : true
      });
    }

    // PRESERVED QUIRK / R-6 ADJUDICATION - see docs/PRESERVED-QUIRKS.md section 1.15.
    // With a falsy request.payload.roles the base commit responded with NOTHING: the
    // callback fell through, the shim's deferred capture was never settled, and the
    // request stayed open until the client gave up. MEASURED over real HTTP against a
    // verbatim replica of the base-commit wrapper on @hapi/hapi 20.3.0 - no status code,
    // no body, no log line.
    //
    // That outcome IS reproducible, so it is reproduced rather than converged: returning
    // a promise that never settles leaves this one request unanswered while the server
    // and every other route carry on normally. Letting the handler fall through instead
    // would resolve `undefined` and make hapi answer 500 - a status no baseline request
    // on this branch ever received, and a TR2 parity failure. An else branch, a default
    // response or a validation guard would be latent-bug repair, which R-1 excludes.
    return Pending.forever();
  },
  grantRole : async function(request, h) {
    var user;

    try {
      user = await User.findById(request.params.userId);
    }
    catch (err) {
      return Pending.rejectOrHang(h, err);
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
        // SEC-13 - see docs/PRESERVED-QUIRKS.md section 4.14. The `JSON.parse(JSON.stringify(user))`
        // round-trip is the baseline payload shape and is kept as the payload shape: it clones the
        // whole User document rather than projecting `publicSpec`, which is why this response
        // disclosed ANOTHER user's bcrypt hash to the admin caller. The round-trip is unchanged and
        // the single credential key is deleted from its result, so every other key stays
        // byte-identical. Nothing in the repository reads this response - the admin role editor at
        // lib/views/admin/index.html posts to /api/admin/user/{id} and reads only `result.success` -
        // so the removal is observably neutral for every legitimate request.
        var payload = JSON.parse(JSON.stringify(user));
        delete payload.password;

        return h.respond({
          success : true,
          user    : payload
        });
      })
      .catch(function(err) {
        // R-6 - see lib/http/pending.js#rejectOrHang. At the base commit this chain was
        // returned from findById's callback, whose return value `promise.then(function (doc)
        // { cb(null, doc); })` discards, so the AssertError a raw Error provokes became an
        // unhandled rejection and the deferred stayed unsettled: NO RESPONSE. That is the
        // fate restored here, on the reachable trinket-teacher path above as well as on a
        // genuine grant failure.
        return Pending.rejectOrHang(h, err);
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

// Async conversion: the hand-written promise bridge this function used to be is retired in
// favour of the native promise the model already returns. lib/models/user.js#findByLogin is
// `return this.model.findOne({ $or : [...] }, cb)`, so omitting the callback hands back the
// Mongoose Query itself, which is awaitable and rejects with the same error the callback's
// `err` carried. Every settle path is preserved: a lookup failure and a failure in either
// aggregate query still reject this function (the caller in `index` attaches no .catch, so the
// rejection still reaches the centralized error map as a scrubbed 500), a found user still
// resolves with the fully populated `data`, and a missing user still resolves with `undefined`
// - which `index` then passes through as the view's `data`, exactly as `resolve()` did.
// The statement order is unchanged: serialize, blank the tags, count trinkets, then count
// courses.
async function userSearch(q) {
  var user = await User.findByLogin(q);

  if (!user) {
    return undefined;
  }

  // SEC-13 - see docs/PRESERVED-QUIRKS.md section 4.14. This round-trip is the baseline shape and
  // stays the shape, but it flattens the User document to a plain object BEFORE the success
  // responder runs, so `ObjectUtils.serialize`'s prototype-safe `typeof(json.serialize)` test finds
  // nothing to project and the whole document reaches the client. That is how the owner's bcrypt
  // hash arrived in the rendered admin page, which dumps this object wholesale through
  // `{{ data | json("pretty") | safe }}` in lib/views/admin/includes/users.html - a frozen template,
  // so the credential is removed here at the source instead. The template's named reads are `_id`,
  // `avatar`, `coursesOwned`, `email`, `name`, `roles`, `trinketsOwned` and `username`; `password` is
  // not among them, and `roleSearch` below already answers clean because it hands the responder real
  // documents. Every other key of this object is untouched.
  var data = JSON.parse(JSON.stringify(user));
  delete data.password;
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
