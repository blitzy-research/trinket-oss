var errors = require('@hapi/boom'),
    _      = require('underscore'),
    config = require('config'),
    ObjectUtils = require('../util/objectUtils');

/**
 * True when `user` may read `course`'s content.
 *
 * SEC-F13. This is the same two-arm rule `viewClass` applies inline at :142-143
 * and `viewCourses` applies inline at :121-122 - a `public` or `open` course is
 * readable by anyone, otherwise the caller must hold `view-course-content` for
 * THIS course - and the twin of `canViewCourseContent` in
 * lib/controllers/course.js, which gates the three `/api/courses/**` reads.
 *
 * It is written out twice rather than shared on purpose. The only place two
 * controllers can share a helper is a new `lib/util` module, and the shared
 * request-path utilities are not in this checkpoint's scope; a four-line
 * predicate stated in both files, each pointing at the other, is the smaller
 * change. Both must move together: they encode one rule.
 *
 * `archived` is not part of the test here either. `viewClass` checks it because
 * it is a page with a featured-course list to fall back to; this route is a JSON
 * read whose caller has no such fallback, and the course.js twin documents the
 * same reasoning for the API reads.
 *
 * @param   {Object} user    the acting user document, from `request.user`, or
 *                           undefined for an anonymous caller
 * @param   {Object} course  the resolved course, from `request.pre.course`
 * @returns {Boolean}
 */
// SEC-F27: how long after it was mailed an invitation may still be accepted.
// See `hasInvitationExpired` for why the window is measured from `sentOn` and
// why an invitation that was never mailed does not expire.
var INVITATION_ACCEPT_WINDOW = 30 * 24 * 60 * 60 * 1000;

// SEC-F40 and SEC-F27: bounded attempt ledgers for the two credential-bearing
// routes this controller serves - `GET /courses/join/{accessCode}` and
// `GET /courses/accept/{token}`. Both are per process, hold a record for at
// most one window after the first attempt it counted, and are pruned on every
// reservation rather than by a timer. See `reserveAttempt`.
var ACCESS_CODE_ATTEMPT_LIMIT  = 10
  , ACCESS_CODE_ATTEMPT_WINDOW = 15 * 60 * 1000
  , accessCodeAttempts         = new Map()
  , TOKEN_LOOKUP_LIMIT         = 30
  , TOKEN_LOOKUP_WINDOW        = 15 * 60 * 1000
  , tokenLookups               = new Map();

function canViewCourseContent(user, course) {
  var courseType;

  if (!course) {
    return false;
  }

  courseType = course.globalSettings && course.globalSettings.courseType;

  if (courseType === 'public' || courseType === 'open') {
    return true;
  }

  return !!user
      && typeof user.hasPermission === 'function'
      && user.hasPermission('view-course-content', 'course', { id : course.id });
}

/**
 * True when `user` is the person `invitation` was addressed to.
 *
 * SEC-F27. Compared case-insensitively on the address, which is the identity an
 * invitation carries. Both sides are already lowercased where they are written
 * - `addList` and `updateEmail` lowercase the invitation
 * (lib/models/courseInvitation.js:36, :122) and the User pre-save hook
 * lowercases the account (lib/models/user.js:39) - so the fold is belt and
 * braces for a record written before either, not a widening of the match.
 *
 * It fails CLOSED on anything unexpected: an absent user, an absent invitation
 * or a non-string address on either side denies, because the only thing this
 * predicate can safely conclude from a missing address is that it does not
 * match.
 *
 * The account's `verified` flag is deliberately NOT required. It is set only by
 * the explicit e-mail-verification step (lib/controllers/users.js:1742, :1814)
 * and defaults to false (lib/models/user.js:14), so requiring it would refuse
 * the ordinary invitation flow - sign up from the invitation, then follow the
 * link - for every account that has not been through that step. Requiring proof
 * of address control at acceptance is recorded as a residual instead; it needs
 * the verification flow to run before enrolment, which is a product decision
 * rather than a controller one.
 *
 * @param   {Object} user        the acting user document, from `request.user`
 * @param   {Object} invitation  the CourseInvitation resolved from the token
 * @returns {Boolean}
 */
function isInvitedUser(user, invitation) {
  if (!user || !invitation || typeof user.email !== 'string' || typeof invitation.email !== 'string') {
    return false;
  }

  return user.email.toLowerCase() === invitation.email.toLowerCase();
}

function getCoursePageData(user, course) {
  return {
    instructor : {
      slug   : user.username,
      id     : user.id,
      name   : user.name,
      avatar : user.avatar
    },
    course : {
      id          : course.id,
      slug        : course.slug,
      name        : course.name,
      ownerSlug   : course.ownerSlug,
      description : course.description
    }
  };
}

module.exports = {
  viewCourses : async function(request, h) {
    var visibleCourses;

    // get all owned courses for user we're viewing
    return request.pre.user.getOwnedCourses()
      .then(function(courses) {
        // ensure no null or undefined values
        courses = courses.filter(function(course) {
          return course && !course.archived;
        });

        if (request.user && request.user.id === request.pre.user.id) {
          visibleCourses = courses;
        }
        else {
          // filter by visibility and permissions
          visibleCourses = courses.filter(function(course) {
            if ((course.globalSettings.courseType === 'public' || course.globalSettings.courseType === 'open')
            ||  (request.user && request.user.hasPermission('view-course-content', 'course', { id : course.id }))) {
              return true;
            }
          });
        }

        return request.success({
          instructor : {
            slug : request.pre.user.username,
            name : request.pre.user.name
          },
          courses : visibleCourses
        });
      });
  },

  viewClass : async function(request, h) {
    var course = request.pre.course
      , result;

    if (!course.archived && ((course.globalSettings.courseType === 'public' || course.globalSettings.courseType === 'open')
    ||  (request.user && request.user.hasPermission('view-course-content', 'course', { id : course.id })))) {
      result = getCoursePageData(request.pre.user, course);

      if (request.user) {
        result.canEdit            = request.user.hasPermission("manage-course-content", "course", { id : course.id });
        result.canViewSubmissions = request.user.hasPermission("view-assignment-submissions", "course", { id : course.id });

        // special setting to allow anyone to make a copy of the course
        // this setting isn't yet publicly available
        result.canCopy = !result.canEdit && (course.globalSettings.copyable || course.globalSettings.courseType === "open");
      }

      return request.success(result);
    }
    else {
      return Course.findFeaturedForUser(request.user)
        .then(function(courses) {
          courses = _.map(courses, function(course) {
            page        = course.page;
            course      = ObjectUtils.serialize(course);
            course.page = page || "";

            return course;
          });

          return request.success({
            course: {},
            courses: courses,
          });
        })
    }
  },

  getClass : async function(request, h) {
    var course = request.pre.course,
        result;

    // SEC-F13. `GET /api/classes/{userSlug}/{courseSlug}` declares no `auth`
    // (config/routes.js:183-187), so it inherits `mode: 'try'` and resolves any
    // course by slug for any caller. `viewClass`, the handler immediately
    // above, tests visibility before it renders the same course; this one
    // tested nothing, which is the second half of the finding.
    //
    // Placed BEFORE the loop below, which is where the refusal has to be: that
    // loop reads `course.sessions`, a field the Course schema does not declare
    // (measured: zero occurrences of `sessions` in lib/models/course.js), so it
    // throws a TypeError that reaches the Layer 1 catch-all and answers 500 for
    // EVERY caller. Gating in front of it closes the authorization hole without
    // repairing the handler: an authorized caller still gets the same 500 it
    // gets today, which is what R-d requires, and an unauthorized one no longer
    // gets a course resolved by slug on its behalf at all.
    if (!canViewCourseContent(request.user, course)) {
      return errors.notFound();
    }

    result = {
      course : {
        id:   course.id,
        name: course.name
      },
      sessions : []
    };

    course.sessions.forEach(function(session) {
      var sessionData = {
        id: session.id,
        name: session.name,
        slug: session.slug,
        materials: []
      };

      session.materials.forEach(function(material) {
        if (material.canView()) {
          sessionData.materials.push({
            id: material.id,
            name: material.name,
            slug: material.slug,
            content: material.content
          });
        }
      });

      result.sessions.push(sessionData);
    });

    return request.success(result);
  },

  acceptInvitation : async function(request, h) {
    var courseUrl;

    // SEC-F27: the token is a bearer credential reached over an unauthenticated
    // route (config/routes.js:189-193), so lookups are bounded. At 128 bits
    // (lib/controllers/course.js `generateInvitationToken`) brute force is not
    // the realistic threat this defends against - it bounds enumeration of the
    // remaining short md5 tokens on invitations issued before that change, and
    // it stops the route being used as an unmetered oracle.
    //
    // Reserved synchronously ahead of the lookup, for the same burst-safety
    // reason as the access-code ledger; see `reserveTokenLookup` below.
    if (!reserveTokenLookup(request.user, request.info && request.info.remoteAddress)) {
      return errors.tooManyRequests("Too many invitation attempts. Please wait a few minutes and try again.");
    }

    return CourseInvitation.findByToken(request.params.token)
      .then(function(invitation) {
        if (invitation) {
          return Course.findById(invitation.courseId)
            .then(function(course) {
              if (request.user) {
                if (invitation.status === "accepted") {
                  if (request.user.inCourse(invitation.courseId.toString())) {
                    courseUrl = "/" + course.ownerSlug + "/courses/" + course.slug;
                    request.yar.flash("info", "You've already joined that course! View <a href='" + courseUrl + "' class='text-link'><strong>" + course.name + "</strong></a> now.");
                  }
                  else {
                    request.yar.flash("warning", "Sorry, that invitation has already been used. Please contact your instructor to get another link.");
                  }

                  return h.redirect("/home");
                }
                else {
                  // SEC-F27, the identity half. This handler used to enrol
                  // WHOEVER presented the token: the invitation was looked up by
                  // token alone and, with any session at all, `addUser` ran. The
                  // token is a bearer credential that travels by e-mail and gets
                  // forwarded, pasted into chats and left in browser history, so
                  // holding it is not evidence of being the invitee.
                  //
                  // The invitation names its addressee, so acceptance is bound
                  // to it. The check sits ahead of `addUser` and ahead of the
                  // `status = "accepted"` write, so a mismatched caller neither
                  // joins the course nor consumes the invitation - the real
                  // invitee's link keeps working.
                  //
                  // The message names no address. Reporting the invited address
                  // to whoever holds the link would turn a refusal into an
                  // e-mail disclosure, so it says which side is wrong without
                  // saying what was expected.
                  if (!isInvitedUser(request.user, invitation)) {
                    request.yar.flash("warning", "Sorry, that invitation was sent to a different email address than the one on the account you're signed in to. Please sign in with the invited account, or contact your instructor for help.");

                    return h.redirect("/home");
                  }

                  // SEC-F27: a mailed invitation stops being redeemable once it
                  // is older than the window on `hasInvitationExpired`, so a
                  // link left in an inbox, a chat log or browser history is not
                  // a permanent credential. The refusal is worded like the
                  // sibling arms and tells the invitee what to do next.
                  if (hasInvitationExpired(invitation)) {
                    request.yar.flash("warning", "Sorry, that invitation has expired. Please ask your instructor to send you a new one.");

                    return h.redirect("/home");
                  }

                  return course.addUser(request.user, ['course-student'])
                    .then(function() {
                      invitation.status = "accepted";
                      return invitation.save();
                    })
                    .then(function() {
                      request.yar.flash("acceptedCourseInvitation", { course : course }, true);
                      return h.redirect('/home');
                    });
                }
              }
              else {
                request.yar.set("next", request.url.path);

                if (course) {
                  request.yar.flash("courseInvitation", { course : course }, true);
                }

                return h.redirect("/login");
              }
            })
            .catch(function(err) {
              return err;
            });
        }
        else {
          request.yar.flash("warning", "Sorry, that link isn't valid. Please check the link and try again or contact your instructor for help.");

          return request.user ? h.redirect("/home") : h.redirect("/login");
        }
      })
      .catch(function(err) {
        return err;
      });
  },

  joinFromLink : async function(request, h) {
    var courseUrl
      , course;

    // SEC-F40: this is the SECOND entry point that redeems a course access
    // code, and the one an unauthenticated caller can reach
    // (config/routes.js:196-201). `course.join`'s ledger cannot see it - each
    // handler holds its own module-level counter - so without this the whole
    // bound on `POST /api/courses/join` was bypassable simply by guessing
    // through this URL instead. It is deliberately the same shape and the same
    // figures as the twin in `lib/controllers/course.js`; the two must move
    // together, and the combined allowance across both routes is therefore
    // twice the per-route limit, which is immaterial against a 54^6 keyspace.
    //
    // Reserved before the lookup rather than counted after a miss, so a
    // parallel burst cannot pass many checks on one unexhausted reading, and
    // released below when the code turns out to be real.
    if (!reserveAccessCodeAttempt(request.user, request.info && request.info.remoteAddress)) {
      return errors.tooManyRequests("Too many access code attempts. Please wait a few minutes and try again.");
    }

    // The await boundary belongs at this call site, not in the model layer, which
    // keeps its callback interface. Called without a callback, findByAccessCode
    // returns the underlying query, which executes exactly once when awaited.
    // Only the lookup is inside the try: an error raised by the body below must
    // still reach the handler catch-all instead of being answered here.
    try {
      course = await Course.findByAccessCode(request.params.accessCode);
    }
    catch (err) {
      // Returned, not rethrown. hapi boomifies a returned Error into the same 500
      // this edge already produces, whereas rethrowing would also log the stack,
      // which a lookup failure here has never done.
      return err;
    }

    // A code that resolved is not a guess, so the reservation is given back
    // before any of the branches below answer. Only codes that matched nothing
    // stay counted.
    if (course) {
      releaseAccessCodeAttempt(request.user, request.info && request.info.remoteAddress);
    }

    if (request.user) {
      if (!course) {
        request.yar.flash("warning", "Sorry, that link isn't valid. Please check the link and try again or contact your instructor for help.");
        return h.redirect("/home");
      }

      if (request.user.inCourse(course.id)) {
        courseUrl = "/" + course.ownerSlug + "/courses/" + course.slug;
        request.yar.flash("info", "You've already joined that course! View <a href='" + courseUrl + "' class='text-link'><strong>" + course.name + "</strong></a> now.");
        return h.redirect("/home");
      }
      else {
        return course.addUser(request.user, ["course-student"])
          .then(function(result) {
            request.yar.flash("acceptedCourseInvitation", { course : course }, true);
            return h.redirect('/home');
          })
          .catch(function(err) {
            request.yar.flash("warning", "Sorry, we had a problem adding you to that course. Please try again.");
            return h.redirect("/home");
          });
      }
    }
    else {
      request.yar.set("next", request.url.path);

      if (course) {
        request.yar.flash("courseInvitation", { course : course }, true);
      }

      return h.redirect("/login");
    }
  }
};

/**
 * True when a mailed invitation is older than the acceptance window.
 *
 * SEC-F27. An invitation token travels by e-mail and is forwarded, pasted and
 * left in browser history, so an unbounded lifetime makes it a permanent
 * credential. The window below bounds that.
 *
 * It is measured from `sentOn`, and ONLY from `sentOn`, which is the decision
 * this function exists to record. `sentOn` is written by
 * `sendInvitationEmail` when the message actually goes out
 * (lib/models/courseInvitation.js:91-93) and is the sole date the document
 * carries - `CourseInvitation` registers no timestamps plugin. An invitation
 * with no `sentOn` has therefore never been mailed and nobody holds a link for
 * it, so it is NOT expired here: treating an absent date as expired would void
 * every invitation created while mail was unconfigured or failing, which is a
 * live state in this deployment (`mailer.isConfigured()` gates the whole
 * invitation flow), and would break the ordinary case rather than an attack.
 * Dating an invitation from its creation needs a field on the model, which is
 * not this checkpoint's to add, and is recorded as the residual.
 *
 * Thirty days is chosen against the flow rather than as a round number: a
 * course invitation is acted on within a term's first days, and a month is long
 * enough that a student returning from a break is not refused.
 *
 * @param   {Object} invitation  a CourseInvitation document
 * @returns {Boolean}            true only when a mailed invitation is too old
 */
function hasInvitationExpired(invitation) {
  var sentOn;

  if (!invitation || !invitation.sentOn) {
    return false;
  }

  sentOn = new Date(invitation.sentOn).getTime();

  if (!sentOn) {
    return false;
  }

  return Date.now() - sentOn > INVITATION_ACCEPT_WINDOW;
}

/**
 * Reserves one attempt against `ledger`, or refuses it.
 *
 * Shared by the two ledgers below. Checking and counting happen in ONE
 * synchronous call on purpose: that is what makes a parallel burst safe, since
 * JavaScript runs this to completion before the next request's copy of it
 * starts, so simultaneous callers are serialized through the counter. A check
 * that returned before an asynchronous lookup, counted afterwards, would let a
 * whole burst through on one unexhausted reading.
 *
 * Expired records are dropped on every reservation, which keeps each map
 * bounded without a timer - a timer would also hold the event loop open and
 * change process shutdown behaviour. The window starts at the first attempt a
 * key counted and is not extended by later ones, so an identity that exhausts
 * its allowance is released a fixed window after that first attempt rather than
 * being held indefinitely by a caller that keeps trying.
 *
 * @param   {Map}    ledger         the store to count against
 * @param   {Number} limit          attempts permitted per window
 * @param   {Number} window         window length in milliseconds
 * @param   {Object} user           the acting user document, or undefined
 * @param   {String} remoteAddress  `request.info.remoteAddress`, or undefined
 * @returns {Boolean}               true when the attempt may proceed
 */
function reserveAttempt(ledger, limit, window, user, remoteAddress) {
  var now  = Date.now()
    , keys = attemptKeys(user, remoteAddress)
    , i, record;

  ledger.forEach(function(held, key) {
    if (now - held.first >= window) {
      ledger.delete(key);
    }
  });

  for (i = 0; i < keys.length; i++) {
    record = ledger.get(keys[i]);

    if (record && record.count >= limit) {
      return false;
    }
  }

  keys.forEach(function(key) {
    var existing = ledger.get(key);

    if (existing) {
      existing.count += 1;
    }
    else {
      ledger.set(key, { first : now, count : 1 });
    }
  });

  return true;
}

/**
 * Gives back a reservation whose lookup succeeded.
 *
 * @param {Map}    ledger         the store the reservation was taken from
 * @param {Object} user           the acting user document, or undefined
 * @param {String} remoteAddress  `request.info.remoteAddress`, or undefined
 */
function releaseAttempt(ledger, user, remoteAddress) {
  attemptKeys(user, remoteAddress).forEach(function(key) {
    var record = ledger.get(key);

    if (!record) {
      return;
    }

    record.count -= 1;

    if (record.count <= 0) {
      ledger.delete(key);
    }
  });
}

/**
 * The ledger keys an attempt is counted against.
 *
 * Both are used together where both exist: the account key is the precise one,
 * and the address key is what stops it being shed by registering fresh
 * accounts. `joinFromLink` and `acceptInvitation` are reachable without a
 * session, so for an anonymous caller the address key is the only one.
 *
 * @param   {Object} user           the acting user document, or undefined
 * @param   {String} remoteAddress  `request.info.remoteAddress`, or undefined
 * @returns {Array<String>}         zero or more namespaced keys
 */
function attemptKeys(user, remoteAddress) {
  var keys = [];

  if (user && user.id) {
    keys.push('user:' + user.id.toString());
  }

  if (remoteAddress) {
    keys.push('addr:' + remoteAddress);
  }

  return keys;
}

/**
 * Reserves one access-code attempt for the link route.
 *
 * Twin of `reserveAccessCodeAttempt` in lib/controllers/course.js, which bounds
 * the API route. Each handler counts into its own module-level store, so the
 * combined allowance across the two routes is twice the per-route limit; that
 * is stated in the comment at the call site rather than left implied. Both are
 * per process, so neither is a strict shared control - an authoritative
 * cluster-wide limit belongs at the edge and is recorded as a residual.
 *
 * @param   {Object} user           the acting user document, or undefined
 * @param   {String} remoteAddress  `request.info.remoteAddress`, or undefined
 * @returns {Boolean}
 */
function reserveAccessCodeAttempt(user, remoteAddress) {
  return reserveAttempt(accessCodeAttempts, ACCESS_CODE_ATTEMPT_LIMIT, ACCESS_CODE_ATTEMPT_WINDOW, user, remoteAddress);
}

/**
 * Gives back an access-code reservation whose code turned out to be real.
 *
 * @param {Object} user           the acting user document, or undefined
 * @param {String} remoteAddress  `request.info.remoteAddress`, or undefined
 */
function releaseAccessCodeAttempt(user, remoteAddress) {
  releaseAttempt(accessCodeAttempts, user, remoteAddress);
}

/**
 * Reserves one invitation-token lookup.
 *
 * The limit is higher than the access-code one because a token is not typed:
 * a caller reaches this route by following a link, so repeated attempts are
 * refreshes and forwarded copies rather than guesses, while an enumerator needs
 * volume this bound denies.
 *
 * @param   {Object} user           the acting user document, or undefined
 * @param   {String} remoteAddress  `request.info.remoteAddress`, or undefined
 * @returns {Boolean}
 */
function reserveTokenLookup(user, remoteAddress) {
  return reserveAttempt(tokenLookups, TOKEN_LOOKUP_LIMIT, TOKEN_LOOKUP_WINDOW, user, remoteAddress);
}
