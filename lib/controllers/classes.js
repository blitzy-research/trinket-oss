var errors = require('@hapi/boom'),
    _      = require('underscore'),
    config = require('config'),
    ObjectUtils = require('../util/objectUtils');

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

        // The response IS the return value now: the route parser no longer waits on
        // a deferred capture, so this result must travel back through the promise
        // chain to the handler frame or hapi sees `undefined` and raises.
        return h.respond({
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

      // Returned for the same reason as above: the deferred response capture is
      // gone, so a bare call would leave this branch resolving `undefined`.
      return h.respond(result);
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

          return h.respond({
            course: {},
            courses: courses,
          });
        })
    }
  },

  getClass : async function(request, h) {
    var course = request.pre.course,
        result;

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

    // Synchronous assembly, so this is the handler's only exit: it must return the
    // response rather than fire and forget it.
    return h.respond(result);
  },

  acceptInvitation : async function(request, h) {
    var courseUrl;

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
                // `request.url` is a WHATWG URL with no `.path` property, so this stores
                // `undefined` under the session key "next" and the post-login redirect never
                // fires. Do not "fix" this to `.pathname`: that would start honoring `next`.
                request.yar.set("next", request.url.path);

                if (course) {
                  request.yar.flash("courseInvitation", { course : course }, true);
                }

                return h.redirect("/login");
              }
            })
            .catch(function(err) {
              throw err;
            });
        }
        else {
          request.yar.flash("warning", "Sorry, that link isn't valid. Please check the link and try again or contact your instructor for help.");

          return request.user ? h.redirect("/home") : h.redirect("/login");
        }
      })
      .catch(function(err) {
        throw err;
      });
  },

  joinFromLink : async function(request, h) {
    var courseUrl;

    var course = await Course.findByAccessCode(request.params.accessCode);

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
        // A failed addUser flashes a warning and still redirects to /home. Do not collapse
        // this catch into a rethrow - that would answer 500 where this answers 302.
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
      // Same as acceptInvitation above: `request.url` has no `.path`, so `undefined`
      // is what gets persisted under "next".
      request.yar.set("next", request.url.path);

      if (course) {
        request.yar.flash("courseInvitation", { course : course }, true);
      }

      return h.redirect("/login");
    }
  }
};
