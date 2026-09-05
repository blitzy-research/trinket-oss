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

    // `GET /api/classes/{userSlug}/{courseSlug}` declares no `auth`
    // (config/routes.js:183-187), so it inherits `mode: 'try'` and resolves any
    // course by slug for any caller, and it applies no visibility rule of its
    // own - unlike `viewClass` above, which tests visibility before rendering
    // the same course. Both are preserved as they are.
    //
    // The loop below reads `course.sessions`, a field the Course schema does
    // not declare, so it throws a TypeError that reaches the Layer 1 catch-all
    // and this route answers 500 for every caller. That is also preserved.
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

    // The token in the path is the only credential this route asks for and
    // lookups against it are not counted or bounded: the route is
    // unauthenticated (config/routes.js:189-193) and the invitation is resolved
    // by `findByToken` alone. Preserved as it is.
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
                  // Enrolment is bound to nothing but possession of the token:
                  // the invitation was resolved by token alone, the acting
                  // account is not compared against the address the invitation
                  // names, and a mailed invitation never expires. Whoever
                  // presents the token with any session at all is enrolled, and
                  // the invitation is consumed by the `status = "accepted"`
                  // write below. Preserved as it is.
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

    // This is the second entry point that redeems a course access code, and the
    // one an unauthenticated caller can reach (config/routes.js:196-201).
    // Attempts against it are not counted or bounded, as they are not on
    // `POST /api/courses/join`; both are preserved that way.
    //
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
