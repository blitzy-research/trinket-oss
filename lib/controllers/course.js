var config = require('config'),
    diff   = require('diff'),
    errors = require('@hapi/boom'),
    _      = require('underscore'),
    moment = require('moment'),
    ObjectUtils = require('../util/objectUtils'),
    mailer = require('../util/mailer');

module.exports = {
  createCourse : async function(request, h) {
    var course;

    try {
      // T-3: the await boundary for the model layer is created HERE, at the
      // lifecycle method's own call site. createCourseCore performs the same
      // sequence the save callback used to wrap, and resolves with the saved
      // document - which is what the callback's shadowing `course` bound.
      course = await module.exports.createCourseCore(request.payload, request.user);
    }
    catch (err) {
      if (err.code === 11000) {
        return request.fail({
            err     : err
          , message : "You already have a course with this name. Please choose another."
        });
      }

      // unknown failure
      //
      // PRESERVED BASELINE (measured). Under the compatibility shim this was
      // `reply({err, message})` inside the save callback, and the callback's
      // return value was discarded, so the deferred was never resolved and the
      // request NEVER SETTLED. An absent response is not behaviour a client can
      // depend on, so by the precedence already decided in AAP 0.7 for
      // lib/controllers/files.js:98-100 the route now serves. The payload SHAPE
      // is preserved exactly: the same plain object, no Boom, no invented status.
      //
      // The object is returned DIRECTLY rather than through h.response(). The two
      // are byte-identical on hapi 21 (verified: both give 200 application/json
      // with the same body, because h.response(x) and Response.wrap(x) use the
      // same constructor), and returning the value keeps this handler agnostic
      // about its wrapper - it behaves the same under the retained compatibility
      // shim, which still passes `reply` as the second argument, and under the
      // thinned wrapper that passes the real toolkit.
      return {
          err     : err
        , message : err.message
      };
    }

    return request.success({ course : course });
  },

  getCourse : async function(request, h) {
    var course     = request.pre.course
      , checkDates = false
      , lessonsPopulate, materialsPopulate
      , canEdit, canViewSubmissions;

    if (course._owner && course._owner.serialize && typeof course._owner.serialize === 'function') {
      course._owner = course._owner.serialize();
    }

    if (!request.query.outline) {
      return request.success({ data : course });
    }

    lessonsPopulate = {
      path   : 'lessons',
      select : 'name slug materials'
    };
    materialsPopulate = {
      path   : 'materials',
      select : 'name slug type trinket'
    };

    if (request.query.withContent) {
      materialsPopulate.select += ' content';
    }

    if (request.user) {
      canEdit            = request.user.hasPermission('manage-course-content', 'course', { id : course.id });
      canViewSubmissions = request.user.hasPermission('view-assignment-submissions', 'course', { id : course.id });
    }

    if (request.query.withDraft && canEdit) {
      lessonsPopulate.select   += ' isDraft';
      materialsPopulate.select += ' isDraft';
    }
    else if (request.query.withDraftAssignments && canViewSubmissions) {
      lessonsPopulate.select   += ' isDraft';
      materialsPopulate.select += ' isDraft';
      materialsPopulate.match = { $or : [ { isDraft : { $ne : true } }, { type : "assignment" } ] };
    }
    else {
      lessonsPopulate.match   = { isDraft : { $ne : true } };
      materialsPopulate.match = { isDraft : { $ne : true } };
      checkDates = true;
    }

    // T-1: the chain is now RETURNED so its value becomes the response. The
    // chain's structure is deliberately left intact rather than flattened into
    // sequential awaits (see updateMaterial below for the measured reason).
    // There is no .catch here, so a rejection still reaches the Layer 1
    // catch-all at lib/util/routeParser.js:578-589 and still yields 500.
    return course.populate(lessonsPopulate)
      .then(function() {
        return Promise.all(course.lessons.map(function(lesson) {
          return lesson.populate(materialsPopulate);
        }));
      })
      .then(function() {
        if (checkDates) {
          // loop through materials, checking assignment dates...
          course.lessons = _.map(course.lessons, function(lesson) {
            lesson.materials = _.filter(lesson.materials, function(material) {
              return material.isVisible();
            });

            return lesson;
          });
        }

        return request.success({ data : course });
      });
  },

  // update name/description
  updateCourse : async function(request, h) {
    var course = request.pre.course
      , savedCourse;

    if (request.user.hasPermission("update-course-details", "course", { id : course.id })) {
      course.set(request.payload);
      course.setGlobalSettings(request.payload);

      try {
        // T-3: await boundary at this call site. save() resolves with the saved
        // document, which is what the old callback's shadowing `course` bound.
        savedCourse = await course.save();
      }
      catch (err) {
        if (err.code === 11000) {
          return request.fail({
              err     : err
            , message : "You already have a course with this name. Please choose another."
          });
        }

        // unknown failure
        //
        // PRESERVED BASELINE (measured): NEVER SETTLED under the shim, because
        // the callback's `reply({err, message})` value was discarded. Serves now
        // per the precedence decided in AAP 0.7; payload shape unchanged. The
        // object is returned directly - byte-identical to h.response(obj) and
        // independent of which wrapper shape is in place (see createCourse).
        return {
            err     : err
          , message : err.message
        };
      }

      return request.success({ course : savedCourse });
    }
    else {
      // The identifier `Boom` is not bound in this module and is not a global,
      // so evaluating it raises ReferenceError('Boom is not defined'), which the
      // Layer 1 catch-all maps to 500. That is the measured baseline for all 41
      // such sites in this file and it is PRESERVED, not repaired (R-d, R-e).
      // Dropping the `reply(` wrapper is required to preserve it: keeping the
      // wrapper with the parameter renamed to `h` would make the unbound callee
      // win the race and change the message to 'reply is not defined'.
      return Boom.forbidden();
    }
  },

  deleteCourse : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("delete-course", "course", { id : course.id })) {
      return course.deleteCourse()
        .then(request.success)
        .catch(function(err) {
          // was reply(err): the shim resolved a Boom for an Error and returned a
          // Boom unchanged. Returning the error itself is identical over HTTP -
          // hapi applies exactly that normalization at
          // node_modules/@hapi/hapi/lib/response.js:81-83 before any observer.
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  // archive or restore
  archiveCourse : async function(request, h) {
    var course = request.pre.course
      , savedCourse;

    if (request.user.hasRole("course-owner", "course", { id : request.pre.course.id })) {
      course.set({ archived: request.payload.archived });

      // PRESERVED BASELINE: the original callback took `err` and never looked at
      // it, so a failed save still answered with an undefined course rather than
      // an error. The swallow is reproduced so that behaviour is unchanged.
      savedCourse = await course.save().catch(function() { /* err ignored, as in the original callback */ });

      return request.success({ course: savedCourse });
    }
    else {
      return Boom.forbidden();
    }
  },

  copyCourse : async function(request, h) {
    var url
      , course;

    if (request.user.hasRole("course-owner", "course", { id : request.pre.course.id })
    ||  request.pre.course.globalSettings.courseType === "public"
    ||  request.pre.course.globalSettings.courseType === "open"
    ||  request.user.hasPermission("create-private-course")
    ||  request.user.hasPermission("make-course-copy", "course", { id : request.pre.course.id })) {
      request.pre.course.name = request.payload.name;

      try {
        // T-3: `copy` is a genuinely callback-only model API
        // (lib/models/course.js:298 calls cb(err, doc) and returns no promise),
        // so the await boundary is created here at the call site and the model
        // is left untouched. The call form is unchanged.
        course = await new Promise(function(resolve, reject) {
          request.pre.course.copy(request.user, function(err, course) {
            if (err) {
              return reject(err);
            }
            return resolve(course);
          });
        });
      }
      catch (err) {
        if (err.code === 11000) {
          return request.fail({
              err     : err
            , message : "You already have a course with this name. Please choose another."
          });
        }

        // unknown failure
        //
        // PRESERVED BASELINE (measured): NEVER SETTLED under the shim, because
        // the copy callback's `reply({err, message})` value was discarded.
        // Serves now per the precedence decided in AAP 0.7; shape unchanged. The
        // object is returned directly (see createCourse for why).
        return {
            err     : err
          , message : err.message
        };
      }

      return course.addUser(request.user, ["course-owner"])
        .then(function() {
          // url needs to be fully qualified in case the copy is
          // happening from the original owner's subdomain
          url = config.url + '/' + course.ownerSlug + '/courses/' + course.slug;
          return request.success({
              success : true
            , url     : url
          });
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  addLesson : async function(request, h) {
    var course = request.pre.course
      , lesson, index;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      lesson = new Lesson(request.payload);
      index  = Math.max(0, Math.min(course.lessons.length, request.query.index || course.lessons.length));

      lesson.setOwner(request.user);

      if (course.globalSettings.contentDefault === 'draft') {
        lesson.isDraft = true;
      }

      return lesson.save()
        .then(function(savedLesson) {
          lesson = savedLesson;
          course.lessons.splice(index, 0, lesson.id);
          return course.save();
        })
        .then(function() {
          return request.success({ data : lesson });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  getLesson : async function(request, h) {
    return request.success({ data : request.pre.lesson });
  },

  updateLesson : async function(request, h) {
    var course = request.pre.course
      , lesson = request.pre.lesson
      , savedLesson;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      lesson.set(request.payload);

      // PRESERVED BASELINE: the original callback accepted `err` and never read
      // it, so on a failed save `savedLesson` is undefined and the property
      // accesses below throw - which is exactly what happens today. Measured
      // baseline: no response at all plus an uncaught TypeError, because
      // mongoose re-throws a callback throw via immediate()
      // (node_modules/mongoose/lib/helpers/promiseOrCallback.js:8-35). The same
      // TypeError is now delivered as the 500 the Layer 1 catch-all produces,
      // carrying the identical message. AAP T-6 names "a property access that
      // throws" as an outcome to reproduce rather than repair.
      savedLesson = await lesson.save().catch(function() { /* err ignored, as in the original callback */ });

      return request.success({
        lesson : {
          name    : savedLesson.name,
          slug    : savedLesson.slug,
          isDraft : savedLesson.isDraft || false
        }
      });
    }
    else {
      return Boom.forbidden();
    }
  },

  moveLesson : async function(request, h) {
    var course = request.pre.course
      , index
      , savedCourse;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      index = course.lessons.indexOf(request.params.lessonId);
      course.lessons.splice(index, 1);
      course.lessons.splice(request.payload.index, 0, request.params.lessonId);

      // PRESERVED BASELINE: err ignored by the original callback, so a failed
      // save leaves `savedCourse` undefined and `savedCourse.id` throws exactly
      // as it does today (see updateLesson above for the measured baseline).
      savedCourse = await course.save().catch(function() { /* err ignored, as in the original callback */ });

      return request.success({
        oldParent : savedCourse.id,
        newParent : savedCourse.id,
        oldIndex  : index,
        newIndex  : request.payload.index
      });
    }
    else {
      return Boom.forbidden();
    }
  },

  deleteLesson : async function(request, h) {
    var course = request.pre.course,
        lesson = request.pre.lesson;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      // `.catch(request.fail)` is kept VERBATIM: as a rejection handler it
      // receives the error as request.fail's FIRST parameter (`json`), with its
      // `err` parameter undefined, so it logs util.inspect(err) + " undefined"
      // and flashes the error as 'failure'. That call shape is preserved.
      return lesson.remove()
        .then(function(lesson) {
          course.lessons.pull(lesson.id);
          return course.save();
        })
        .then(function(course) {
          return request.success({ course : course });
        })
        .catch(request.fail);
    }
    else {
      return Boom.forbidden();
    }
  },

  addMaterial : async function(request, h) {
    var course = request.pre.course
      , lesson = request.pre.lesson
      , material, index, trinketPromise, blank;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      material = new Material(request.payload);
      index    = Math.max(0, Math.min(lesson.materials.length, request.query.index || lesson.materials.length));

      material.setOwner(request.user);

      if (request.payload.type === "assignment") {
        if (request.payload.trinketId === "_blank_") {
          blank = Trinket.createBlankForAssignment(request.user, material.name, request.payload.lang);
          trinketPromise = blank.save();
        }
        else if (request.payload.trinketId) {
          trinketPromise = Trinket.findById(request.payload.trinketId);
        }
      }
      else {
        trinketPromise = Promise.resolve(null);
      }

      return trinketPromise
        .then(function(trinket) {
          if (trinket) {
            material.trinket = {
                trinketId : trinket.id
              , name      : trinket.name
              , lang      : trinket.lang
              , shortCode : trinket.shortCode
            };

            material.setDates(request.payload);
          }

          if (course.globalSettings.contentDefault === 'draft') {
            material.isDraft = true;
          }

          return material.save();
        })
        .then(function(savedMaterial) {
          material = savedMaterial;
          lesson.materials.splice(index, 0, material.id);
          return lesson.save();
        })
        .then(function() {
          return request.success({ data : material });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  getMaterial : async function(request, h) {
    var promise, data;

    if (request.pre.material.type === "assignment" && request.query.with === "owner") {
      promise = Trinket.findById(request.pre.material.trinket.trinketId);
    }
    else {
      promise = Promise.resolve(null);
    }

    return promise.then(function(trinket) {
      data = ObjectUtils.serialize(request.pre.material);
      if (trinket) {
        data.trinket.owner = trinket._owner.toString() === request.user.id ? true : false;
      }

      return request.success({
        data : data
      });
    });
  },

  updateMaterial : async function(request, h) {
    var course   = request.pre.course
      , material = request.pre.material
      , trinketPromise, blank, materialData;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      if (material.type === "assignment") {
        if (request.payload.trinketId === "_blank_") {
          blank = Trinket.createBlankForAssignment(request.user, material.name, request.payload.lang);
          trinketPromise = blank.save();
        }
        else if (request.payload.trinketId) {
          trinketPromise = Trinket.findById(request.payload.trinketId);
        }
        else {
          trinketPromise = Promise.resolve(null);
        }
      }
      else {
        trinketPromise = Promise.resolve(null);
      }

      // ---------------------------------------------------------------------
      // DO NOT FLATTEN THIS CHAIN INTO SEQUENTIAL AWAITS.
      //
      // Measured baseline for the diff-conflict branch below: it answers 500,
      // NOT the "modified in another window" message it appears to send. The
      // mechanism is that `return request.fail(...)` inside the first .then is a
      // callback return, not a function return, so the chain CONTINUES; the
      // second .then then receives that hapi response object as its
      // `savedMaterial` argument and passes it to request.success, whose
      // serialization walks response -> request -> server and raises
      // RangeError: Maximum call stack size exceeded, which the .catch turns
      // into the 500.
      //
      // Rewriting this as sequential awaits would make the `return` short-circuit
      // the handler and deliver the intended 200 - a behaviour improvement R-d
      // prohibits and an error-mapping change R-e prohibits. The chain structure
      // is therefore preserved exactly; only the reply() call sites change.
      // ---------------------------------------------------------------------
      return trinketPromise
        .then(function(trinket) {
          if (Array.isArray(trinket)) {
            trinket = trinket[0];
          }

          if (trinket) {
            material.trinket = {
                trinketId : trinket.id
              , name      : trinket.name
              , lang      : trinket.lang
              , shortCode : trinket.shortCode
            };

            material.setDates(request.payload);
          }

          material.set(request.payload);

          if (typeof(request.payload.patch) !== 'undefined') {
            var patched = diff.applyPatch(material.content ? material.content : '', request.payload.patch);
            if (patched === false) {
              return request.fail({
                data : _.extendOwn({
                    status  : "error"
                  , message : "This page may have been modified in another window. If you wish to make edits, please reload the page."
                }, material.toJSON())
              });
            }
            else {
              material.content = patched.match(/^\s*$/) ? null : patched;
            }
          }

          return material.save();
        })
        .then(function(savedMaterial) {
          return request.success({ material : savedMaterial });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  moveMaterial : async function(request, h) {
    var course = request.pre.course
      , lesson = request.pre.lesson
      , index, parent;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      index = lesson.materials.indexOf(request.params.materialId);
      parent= request.pre.parent || lesson;

      lesson.materials.splice(index, 1);
      parent.materials.splice(request.payload.index, 0, request.params.materialId);

      return lesson.save()
        .then(function(lesson) {
          if (lesson.id !== parent.id) {
            return parent.save();
          }
          return lesson;
        })
        .then(function(lesson) {
          return request.success({
            oldParent : lesson.id,
            newParent : parent.id,
            oldIndex  : index,
            newIndex  : request.payload.index
          });
        })
        .catch(request.fail);
    }
    else {
      return Boom.forbidden();
    }
  },

  deleteMaterial : async function(request, h) {
    var course   = request.pre.course
      , lesson   = request.pre.lesson
      , material = request.pre.material;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      return material.remove()
        .then(function(material) {
          lesson.materials.pull(material.id);
          return lesson.save();
        })
        .then(function(lesson) {
          return request.success({ lesson : lesson });
        })
        .catch(request.fail);
    }
    else {
      return Boom.forbidden();
    }
  },

  listUsers : async function(request, h) {
    var course = request.pre.course
      , users  = course.users.toObject()
      , myUserId;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      myUserId = request.user.id.toString();

      users.forEach(function(user) {
        // Convert userId to string to avoid ObjectId serialization issues
        if (user.userId && user.userId.toString) {
          user.userId = user.userId.toString();
        }
        user.isSelf      = myUserId === user.userId;
        user.onDashboard = !course.userHiddenFromDashboard(user);

        if (user.roles) {
          if (user.roles.indexOf("course-owner") >= 0) {
            user.isOwner = true;
          }
        }
      });

      return request.success({
        data : users
      });
    }
    else {
      return Boom.forbidden();
    }
  },

  listInvitations : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return CourseInvitation.findUnacceptedByCourse(course)
        .then(function(invitations) {
          return request.success({
            data : invitations
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  userLookup : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return User.findByLogin(request.payload.user)
        .then(function(user) {
          if (user) {
            return course.addUser(user, ['course-student']);
          }
          else {
            throw Boom.notFound();
          }
        })
        .then(function(result) {
          if (result.success) {
            result.user.onDashboard = true;
            return request.success({
                success : true
              , user    : result.user
            });
          }
          else if (result.alreadyListed) {
            return request.success({
              alreadyListed : true
            });
          }
          // PRESERVED BASELINE: there is deliberately no else branch. If
          // addUser resolved with neither flag this chain would resolve
          // undefined and the request would not settle - the measured baseline.
          // No response is invented here (R-d). The branch is unreachable in
          // practice: lib/models/course.js addUser() is exhaustive over
          // {alreadyListed:true} and {success:true, user}.
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  removeUser : async function(request, h) {
    var course = request.pre.course
      , userId = request.params.userId
      , user;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return User.findById(userId)
        .then(function(user) {
          if (user) {
            return course.removeUser(user);
          }
          else {
            return course.removeDeletedUser(userId);
          }
        })
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  addUser : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return User.findById(request.payload.user)
        .then(function(user) {
          if (user) {
            return course.addUser(user);
          }
          else {
            throw Boom.notFound();
          }
        })
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  updateRoles : async function(request, h) {
    var course = request.pre.course
      , role   = "course-" + request.payload.role;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return User.findById(request.payload.user)
        .then(function(user) {
          if (user) {
            return course.updateRole(user, role);
          }
          else {
            throw Boom.notFound();
          }
        })
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  updateViews : async function(request, h) {
    var course = request.pre.course
      , userId = request.payload.user
      , view   = request.payload.view
      , action = request.payload.action;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return course.updateView(userId, view, action)
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  sendInvitations : async function(request, h) {
    var course = request.pre.course;

    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Course invitations cannot be sent."
      });
    }

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return CourseInvitation.addList(request.payload.emailList, course)
        .then(function(invitations) {
          return CourseInvitation.sendEmails(invitations, course, request.user)
            .then(function() {
              return invitations;
            });
        })
        .then(function(invitations) {
          return request.success({
              success     : true
            , invitations : invitations
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },
  removeInvitation : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return CourseInvitation.findById(request.params.invitationId)
        .then(function(invitation) {
          return invitation.remove();
        }).then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },
  updateInvitation : async function(request, h) {
    var course     = request.pre.course
      , invitation = request.pre.invitation
      , canUpdate  = true
      , existingUser;

    if (!mailer.isConfigured()) {
      return request.fail({
        message: "Email is not configured. Course invitations cannot be sent."
      });
    }

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      if (request.payload.status) {
        invitation.status = request.payload.status;
      }
      else if (request.payload.email) {
        // check course.users for this email
        existingUser = _.find(course.users, function(user) {
          return user.email.toLowerCase() === request.payload.email.toLowerCase();
        });

        if (!existingUser) {
          invitation.updateEmail(request.payload.email);
        }
        else {
          canUpdate = false;
        }
      }

      if (canUpdate) {
        return invitation.save()
          .then(function(savedInvitation) {
            return CourseInvitation.sendEmails([savedInvitation], course, request.user)
              .then(function() {
                return savedInvitation;
              });
          })
          .then(function(invitation) {
            return request.success({
                success    : true
              , invitation : invitation
            });
          })
          .catch(function(err) {
            // could be a duplicate email
            if (err.code === 11000) {
              return request.fail({
                  err     : err
                , message : "An invitation with that email address already exists."
              });
            }

            // unknown failure
            //
            // PRESERVED BASELINE (measured, and NOT the same case as the three
            // sibling "unknown failure" branches in createCourse/updateCourse/
            // copyCourse). Those three sat inside a mongoose callback whose
            // return value was discarded, so they never settled. THIS one sits
            // in the .catch of a chain the handler returns, so under the shim
            // the value propagated all the way to hapi - and the value was the
            // shim's chainable builder object, not a response. Every one of that
            // object's six properties is a function, so JSON.stringify dropped
            // them all and the measured baseline response is:
            //     200 application/json  {}
            // A real-hapi probe confirmed that returning `{}` is byte-identical
            // to that, and that returning {err, message} is NOT (it yields
            // {"err":{},"message":"..."}). This edge SETTLES at baseline, so
            // R-e/R-d require its payload be preserved rather than upgraded to
            // the payload the code evidently intended.
            return {};
          });
      }
      else {
        return request.success({
            success : false
          , message : "That email address is already in use by another user or an invitation."
        });
      }
    }
    else {
      return Boom.forbidden();
    }
  },
  generateAccessCode : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      course.accessCode = generateAccessCode();
      return course.save()
        .then(function(savedCourse) {
          return request.success({
              success    : true
            , accessCode : savedCourse.accessCode
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },
  getAccessCode : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return request.success({
          success    : true
        , accessCode : course.accessCode || ""
      });
    }
    else {
      return Boom.forbidden();
    }
  },
  join : async function(request, h) {
    var course;

    try {
      // T-3: `findByAccessCode` is a callback-form model API
      // (lib/models/course.js:280 -> this.model.findOne({accessCode: code}, cb)),
      // so the await boundary is created here at the lifecycle method's own call
      // site and the model is left untouched. The call form is unchanged.
      course = await new Promise(function(resolve, reject) {
        Course.findByAccessCode(request.payload.accessCode, function(err, course) {
          if (err) {
            return reject(err);
          }
          return resolve(course);
        });
      });
    }
    catch (err) {
      // was reply(err) inside the callback, which resolved the deferred with a
      // Boom for an Error; returning the error is identical over HTTP.
      return err;
    }

    if (!course) {
      return request.success({
          success : false
        , message : "No course was found with that code. Please check your code and try again."
      });
    }

    return course.addUser(request.user, ["course-student"])
      .then(function(result) {
        if (result.alreadyListed) {
          return request.success({
            alreadyListed : true
          });
        }
        else {
          return request.success({
              success : true
            , course  : course
          });
        }
      })
      .catch(function(err) {
        return err;
      });
  },
  startAssignment : async function(request, h) {
    var assignment;

    return Trinket.findById(request.payload.parent)
      .then(function(trinket) {
        // TODO: double check that user doesn't already have a "started" one

        assignment = new Trinket({
            code            : trinket.code
          , assets          : trinket.assets
          , settings        : trinket.settings
          , _parent         : request.payload.parent
          , _creator        : request.user
          , materialId      : request.params.materialId
          , courseId        : request.params.courseId
          , lang            : trinket.lang
          , submissionState : "started"
          , startedOn       : new Date()
        });

        return assignment.save();
      })
      .then(function(savedAssignment) {
        assignment = savedAssignment;
        return request.success({
          assignment : {
              id              : assignment.id
            , lang            : assignment.lang
            , lastUpdated     : new Date(assignment.lastUpdated).toISOString()
            , startedOn       : new Date(assignment.startedOn).toISOString()
            , shortCode       : assignment.shortCode
            , submissionState : assignment.submissionState
          }
        });
      })
      .catch(function(err) {
        return err;
      });
  },
  submitAssignment : async function(request, h) {
    var submissionState = "submitted"
      , serialized, submission, now;

    // get material to check dates...
    return Material.findById(request.params.materialId)
      .then(function(material) {
        if (material.trinket.submissionsDue.enabled) {
          now = new Date();

          if (material.trinket.availableOn.enabled && now < material.trinket.availableOn.dateValue) {
            throw new Error("Assignment is not available.");
          }
          else if (now > material.trinket.submissionsDue.dateValue
          && material.trinket.submissionsCutoff.enabled && now > material.trinket.submissionsCutoff.dateValue) {
            throw new Error("Assignment is past due.");
          }
          else if (now > material.trinket.submissionsDue.dateValue
          && ( !material.trinket.submissionsCutoff.enabled || now <= material.trinket.submissionsCutoff.dateValue )) {
            submissionState = "submittedLate";
          }
        }

        return Trinket.findById(request.payload.parent);
      })
      .then(function(parent) {
        serialized = request.payload.code;
        submission = new Trinket({
            code            : serialized.code
          , assets          : serialized.assets
          , settings        : serialized.settings
          , _parent         : request.payload.parent // TODO? change to student "modified" trinket
          , _creator        : request.user
          , materialId      : request.params.materialId
          , courseId        : request.params.courseId
          , lang            : parent.lang
          , submissionState : submissionState
          , submittedOn     : new Date()
          , comments        : [{
                commentText : request.payload.comments
              , commentType : 'student'
            }]
        });

        return submission.save();
      })
      .then(function(savedSubmission) {
        submission = savedSubmission;
        return request.success({
          submission : _.extendOwn({
                id              : submission.id
              , comments        : JSON.parse(JSON.stringify(submission.comments))
              , lang            : submission.lang
              , lastUpdated     : new Date(submission.lastUpdated).toISOString()
              , submittedOn     : new Date(submission.submittedOn).toISOString()
              , shortCode       : submission.shortCode
              , submissionState : submission.submissionState
            }, JSON.parse(JSON.stringify(submission.submissionOpts)))
        });
      })
      .catch(function(err) {
        return Boom.forbidden(err);
      });
  },
  updateMySubmission : async function(request, h) {
    var submission      = request.pre.trinket
      , submissionState = "submitted"
      , serialized, now;

    if (request.user.id.toString() === submission._creator.toString()) {
      // get material to check dates...
      return Material.findById(submission.materialId)
        .then(function(material) {
          if (material.trinket.submissionsDue.enabled) {
            now = new Date();

            if (material.trinket.availableOn.enabled && now < material.trinket.availableOn.dateValue) {
              throw new Error("Assignment is not available.");
            }
            else if (now > material.trinket.submissionsDue.dateValue
            && material.trinket.submissionsCutoff.enabled && now > material.trinket.submissionsCutoff.dateValue) {
              throw new Error("Assignment is past due.");
            }
            else if (now > material.trinket.submissionsDue.dateValue
            && ( !material.trinket.submissionsCutoff.enabled || now <= material.trinket.submissionsCutoff.dateValue )) {
              submissionState = "submittedLate";
            }
          }

          serialized = request.payload.code;

          submission.code            = serialized.code;
          submission.assets          = serialized.assets;
          submission.settings        = serialized.settings;
          submission.submittedOn     = new Date();
          submission.submissionState = submissionState;
          submission.comments        = [{
              commentText : request.payload.comments
            , commentType : 'student'
          }];

          return submission.save();
        })
        .then(function(savedSubmission) {
          submission = savedSubmission;
          return request.success({
            submission : _.extendOwn({
                  id              : submission.id
                , comments        : JSON.parse(JSON.stringify(submission.comments))
                , lang            : submission.lang
                , lastUpdated     : new Date(submission.lastUpdated).toISOString()
                , submittedOn     : new Date(submission.submittedOn).toISOString()
                , shortCode       : submission.shortCode
                , submissionState : submission.submissionState
              }, JSON.parse(JSON.stringify(submission.submissionOpts)))
          });
        })
        .catch(function(err) {
          return Boom.forbidden(err);
        });
    }
    else {
      return Boom.forbidden();
    }
  },
  autosaveComments : async function(request, h) {
    var submission = request.pre.trinket;

    if (request.user.id.toString() === submission._creator.toString()) {
      if (submission.comments.length) {
        submission.comments[0].commentText = request.payload.comments;
      }
      else {
        submission.comments.push({
            commentText : request.payload.comments
          , commentType : 'student'
        });
      }

      return submission.save().then(request.success);
    }
    else {
      return Boom.forbidden();
    }
  },
  getUserSubmissionsForMaterial : async function(request, h) {
    var submissions = []
      , userId;

    if (request.params.userId) {
      if (request.user.hasPermission("view-assignment-submissions", "course", { id : request.params.courseId })) {
        userId = request.params.userId;
      }
      else {
        return Boom.forbidden();
      }
    }
    else {
      userId = request.user.id;
    }

    return Trinket.findByUserAndMaterial(userId, request.params.materialId)
      .then(function(trinkets) {
        submissions = _.map(trinkets, function(trinket) {
          return _.extendOwn({
              id              : trinket.id
            , comments        : JSON.parse(JSON.stringify(trinket.comments))
            , lang            : trinket.lang
            , lastUpdated     : new Date(trinket.lastUpdated).toISOString()
            , startedOn       : trinket.startedOn   ? new Date(trinket.startedOn).toISOString()   : undefined
            , submittedOn     : trinket.submittedOn ? new Date(trinket.submittedOn).toISOString() : undefined
            , shortCode       : trinket.shortCode
            , submissionState : trinket.submissionState
          }, JSON.parse(JSON.stringify(trinket.submissionOpts)));
        });

        return request.success({
          data : submissions
        });
      })
      .catch(function(err) {
        return err;
      });
  },
  dashboardOverview : async function(request, h) {
    var course             = request.pre.course
      , listBy             = request.query.listBy || "assignment"
      , assignmentIndex    = {}
      , assignmentOverview = []
      , studentIndex       = {}
      , studentOverview    = []
      , studentIdList      = []
      , assignmentCount    = 0
      , hiddenUserCount    = 0;

    if (request.user.hasPermission("view-assignment-submissions", "course", { id : course.id })) {
      course.users.forEach(function(user) {
        if (listBy === "assignment" && course.userHiddenFromDashboard(user)) {
          hiddenUserCount++;
          return;
        }

        var userIdStr = user.userId.toString();
        studentIdList.push(userIdStr);
        var userJson = user.toJSON ? user.toJSON() : user;
        // Convert userId to string to avoid ObjectId serialization issues
        if (userJson.userId) {
          userJson.userId = userJson.userId.toString();
        }
        studentOverview.push( _.extendOwn({
            "not-started"      : 0
          , "started"          : 0
          , "submitted"        : 0
          , "completed"        : 0
          , "assignment-count" : 0
          , "onDashboard"      : !course.userHiddenFromDashboard(user)
        }, userJson ));

        studentIndex[ userIdStr ] = studentOverview.length - 1;
      });

      return course.populate({
          path   : 'lessons',
          select : 'materials'
        })
        .then(function() {
          return Promise.all(course.lessons.map(function(lesson) {
            return lesson.populate({
              path   : 'materials',
              select : 'type',
              match  : { $or : [ { isDraft : { $ne : true } }, { type : "assignment" } ] }
            });
          }));
        })
        .then(function() {
          course.lessons.forEach(function(lesson) {
            lesson.materials.forEach(function(material) {
              assignmentOverview.push({
                  id            : material.id
                , "not-started" : studentOverview.length
                , "started"     : 0
                , "submitted"   : 0
                , "completed"   : 0
                , "user-count"  : studentOverview.length
                , "hidden"      : hiddenUserCount
              });

              assignmentIndex[ material.id ] = assignmentOverview.length - 1;

              if (material.type === "assignment") {
                assignmentCount++;
              }
            });
          });

          for (var i = 0; i < studentOverview.length; i++) {
            studentOverview[i]["not-started"] = studentOverview[i]["assignment-count"] = assignmentCount;
          }

          return Trinket.courseDashboard(request.params.courseId);
        })
        .then(function(result) {
          result.forEach(function(submission) {
            var thisStudent    = submission._id.user ? submission._id.user.toString() : '';
            var thisAssignment = submission._id.material ? submission._id.material.toString() : '';

            var thisAssignmentIndex = assignmentIndex[ thisAssignment ];
            var thisStudentIndex    = studentIndex[ thisStudent ];

            // likely an assignment that was removed from the course
            // also ensure this student still a member of the course
            // lastly, thisStudentIndex will be undefined if user hidden from dashboard view
            if (typeof thisAssignmentIndex === "undefined" || typeof thisStudentIndex === "undefined") {
              return;
            }

            if (submission.states.indexOf("submitted") >= 0) {
              assignmentOverview[ thisAssignmentIndex ].submitted++;
              studentOverview[ thisStudentIndex ].submitted++;
            }
            else if (submission.states.indexOf("completed") >= 0) {
              assignmentOverview[ thisAssignmentIndex ].completed++;
              studentOverview[ thisStudentIndex ].completed++;
            }
            else if (submission.states.indexOf("started") >= 0 || submission.states.indexOf("modified") >= 0) {
              assignmentOverview[ thisAssignmentIndex ].started++;
              studentOverview[ thisStudentIndex ].started++;
            }

            assignmentOverview[ thisAssignmentIndex ]["not-started"]--;
            studentOverview[ thisStudentIndex ]["not-started"]--;
          });

          return request.success({
            data : listBy === "assignment" ? assignmentOverview : studentOverview
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },
  materialDashboard : async function(request, h) {
    var course   = request.pre.course
      , userList = []
      , overview;

    if (request.user.hasPermission("view-assignment-submissions", "course", { id : course.id })) {
      course.users.forEach(function(user) {
        if (!course.userHiddenFromDashboard(user)) {
          userList.push(user.userId.toString());
        }
      });

      overview = {
          id            : request.params.materialId
        , "not-started" : userList.length
        , "started"     : 0
        , "submitted"   : 0
        , "completed"   : 0
        , "user-count"  : userList.length
      };

      // TODO: add filter option to this courseDashboard call/method
      return Trinket.courseDashboard(request.params.courseId)
        .then(function(result) {
          result.forEach(function(submission) {
            // ensure this student still a member of the course
            if (userList.indexOf(submission._id.user.toString()) < 0) {
              return;
            }

            if (submission._id.material.toString() === request.params.materialId) {
              if (submission.states.indexOf("submitted") >= 0) {
                overview.submitted++;
              }
              else if (submission.states.indexOf("completed") >= 0) {
                overview.completed++;
              }
              else if (submission.states.indexOf("started") >= 0 || submission.states.indexOf("modified") >= 0) {
                overview.started++;
              }

              overview["not-started"]--;
            }
          });

          return request.success({
            data : overview
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },
  getMaterialSubmissionsForAllUsers : async function(request, h) {
    var course = request.pre.course
      , submissions = []
      , userIndex   = {};

    if (request.user.hasPermission("view-assignment-submissions", "course", { id : course.id })) {
      submissions = _.map(course.users, function(user, index) {
        var userIdStr = user.userId ? user.userId.toString() : '';
        userIndex[ userIdStr ] = index;
        var userJson = user.toJSON ? user.toJSON() : user;
        // Convert userId to string to avoid ObjectId serialization issues
        if (userJson.userId) {
          userJson.userId = userJson.userId.toString();
        }
        return _.extendOwn({
            state       : "not-started"
          , lang        : ""
          , trinketId   : ""
          , shortCode   : ""
          , lastUpdated : ""
          , onDashboard : !course.userHiddenFromDashboard(user)
        }, userJson);
      });

      return Trinket.findSubmissionsByMaterial(request.params.materialId)
        .then(function(users) {
          users.forEach(function(user) {
            var odbc = user._id ? user._id.toString() : '';
            if (typeof userIndex[ odbc ] !== "undefined") {
              var thisIndex = userIndex[ odbc ];
              var states    = _.groupBy(user.submissions, "state");

              if (states.submittedLate) {
                _.extend(submissions[ thisIndex ], states.submittedLate[0] );
                submissions[ thisIndex ].submittedOn = new Date(submissions[ thisIndex ].submittedOn).toISOString();
              }
              else if (states.submitted) {
                _.extend(submissions[ thisIndex ], states.submitted[0] );
                submissions[ thisIndex ].submittedOn = new Date(submissions[ thisIndex ].submittedOn).toISOString();
              }
              else if (states.completed) {
                _.extend(submissions[ thisIndex ],
                  states.completed.length > 1 ? _.sortBy(states.completed, 'lastUpdated').pop() : states.completed[0]
                );

                // TODO? set lastUpdated to comments feedback commented date?
              }
              else if (states.started) {
                _.extend(submissions[ thisIndex ], states.started[0] );
                submissions[ thisIndex ].startedOn = new Date(submissions[ thisIndex ].startedOn).toISOString();
              }
              else if (states.modified) {
                _.extend(submissions[ thisIndex ], states.modified[0] );
                submissions[ thisIndex ].state = "started";
                submissions[ thisIndex ].startedOn = new Date(submissions[ thisIndex ].startedOn).toISOString();
              }

              // TODO? move this?
              submissions[ thisIndex ].lastUpdated = new Date(submissions[ thisIndex ].lastUpdated).toISOString();
              // Convert ObjectIds to strings to avoid serialization issues
              if (submissions[ thisIndex ].trinketId && submissions[ thisIndex ].trinketId.toString) {
                submissions[ thisIndex ].trinketId = submissions[ thisIndex ].trinketId.toString();
              }
              submissions[ thisIndex ].comments    = JSON.parse(JSON.stringify(submissions[ thisIndex ].comments));

              if (submissions[ thisIndex ].submissionOpts) {
                _.extendOwn(submissions[ thisIndex ], JSON.parse(JSON.stringify(submissions[ thisIndex ].submissionOpts)));
              }
            }
          });

          return request.success({
            data : submissions
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },
  getUserSubmissionsForCourse : async function(request, h) {
    var course      = request.pre.course
      , user        = request.pre.user
      , submissions = {}
      , lastSubmission, i;

    /*
     * Assumption: client-side has full list of lessons and materials to appropriately display
     */

    if (request.user.hasPermission("view-assignment-submissions", "course", { id : course.id })) {
      // make sure this student is a member of the course
      if (!_.findWhere(course.users, { username : user.username })) {
        return Boom.notFound();
      }

      return Trinket.findSubmissionsByUserAndCourse(user._id, course._id)
        .then(function(trinkets) {
          for (i = 0; i < trinkets.length; i++) {
            var states = _.groupBy(trinkets[i].submissions, "state");

            if (states.submittedLate) {
              lastSubmission = states.submittedLate[0];
            }
            else if (states.submitted) {
              lastSubmission = states.submitted[0];
            }
            else if (states.completed) {
              lastSubmission = states.completed.length > 1
                ? _.sortBy(states.completed, 'lastUpdated').pop()
                : states.completed[0];
            }
            else if (states.started) {
              lastSubmission = states.started[0];
            }
            else if (states.modified) {
              lastSubmission = states.modified[0];
            }

            // Convert ObjectIds to strings for client compatibility
            var materialIdStr = trinkets[i]._id ? trinkets[i]._id.toString() : '';
            var trinketIdStr = lastSubmission.trinketId ? lastSubmission.trinketId.toString() : '';
            submissions[ materialIdStr ] = {
                id          : trinketIdStr
              , comments    : JSON.parse(JSON.stringify(lastSubmission.comments))
              , lang        : lastSubmission.lang
              , lastUpdated : new Date(lastSubmission.lastUpdated).toISOString()
              , startedOn   : lastSubmission.startedOn   ? new Date(lastSubmission.startedOn).toISOString()   : undefined
              , submittedOn : lastSubmission.submittedOn ? new Date(lastSubmission.submittedOn).toISOString() : undefined
              , shortCode   : lastSubmission.shortCode
              , state       : lastSubmission.state === "modified" ? "started" : lastSubmission.state
              , userId      : user.id
            };

            if (lastSubmission.submissionOpts) {
              submissions[ trinkets[i]._id ].submissionOpts = lastSubmission.submissionOpts;
            }
          }

          return request.success({
            data : submissions
          });
        });
    }
    else {
      return Boom.forbidden();
    }
  },
  autosaveFeedbackComments : async function(request, h) {
    var submission = request.pre.trinket
      , index;

    if (request.user.hasPermission("send-submission-feedback", "course", { id : submission.courseId })) {
      index = _.findIndex(submission.comments, function(comment) {
        return comment.commentType === 'feedback-draft';
      });

      if (index >= 0) {
        submission.comments[index].commentText = request.payload.comments;
      }
      else {
        submission.comments.push({
            commentText : request.payload.comments
          , commentType : 'feedback-draft'
        });
      }

      return submission.save().then(request.success);
    }
    else {
      return Boom.forbidden();
    }
  },
  autosaveSubmissionOpt : async function(request, h) {
    var submission = request.pre.trinket;

    if (request.user.hasPermission("send-submission-feedback", "course", { id : submission.courseId })) {
      _.extendOwn(submission.submissionOpts, request.payload);

      return submission.save().then(request.success);
    }
    else {
      return Boom.forbidden();
    }
  },
  sendFeedback : async function(request, h) {
    var course = request.pre.course
      , submission, serialized, revision, lastIndex, feedbackIndex, previousRevisionId;

    if (request.user.hasPermission("send-submission-feedback", "course", { id : course.id })) {
      return Trinket.findById(request.payload.trinketId)
        .then(function(trinket) {
          submission = trinket;
          serialized = request.payload.code;

          if (submission.comments && submission.comments.length) {
            lastIndex = submission.comments.length - 1;
            if (submission.comments[lastIndex].commentType === "feedback") {
              feedbackIndex = lastIndex;
            }
          }

          if (submission.submissionState === "completed" && typeof feedbackIndex !== "undefined") {
            previousRevisionId = submission.comments[feedbackIndex].trinketId;
            return Trinket.findById(previousRevisionId);
          }
          else {
            return new Trinket({
                code            : serialized.code
              , assets          : serialized.assets
              , settings        : serialized.settings
              , _parent         : submission.id // << link back to submission...
              , _creator        : request.user
              , lang            : trinket.lang
            });
          }
        })
        .then(function(rev) {
          revision = rev;
          // updating a previous version
          if (previousRevisionId) {
            revision.code     = serialized.code;
            revision.assets   = serialized.assets;
            revision.settings = serialized.settings;
          }

          return revision.save();
        })
        .then(function(savedRevision) {
          revision = savedRevision;

          submission.submissionState = "completed";
          submission.submissionOpts  = {
              includeRevision : request.payload.includeRevision
            , allowResubmit   : request.payload.allowResubmit
          };

          if (feedbackIndex) {
            submission.comments[feedbackIndex].commentText = request.payload.comments;
          }
          else {
            submission.comments.push({
                userId           : request.user.id
              , username         : request.user.username
              , displayName      : request.user.name
              , email            : request.user.email
              , avatar           : request.user.normalizeAvatar()
              , commentText      : request.payload.comments
              , commentType      : 'feedback'
              , trinketId        : revision.id
              , trinketLang      : revision.lang
              , trinketShortCode : revision.shortCode
            });
          }

          return submission.save();
        })
        .then(function(savedSubmission) {
          submission = savedSubmission;
          return request.success({
            data : _.extendOwn({
                id              : submission.id
              , comments        : JSON.parse(JSON.stringify(submission.comments))
              , lang            : submission.lang
              , lastUpdated     : new Date(submission.lastUpdated).toISOString()
              , shortCode       : submission.shortCode
              , submissionState : submission.submissionState
            }, JSON.parse(JSON.stringify(submission.submissionOpts)))
          });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },
  acceptSubmission : async function(request, h) {
    var course  = request.pre.course
      , trinket = request.pre.trinket;

    if (request.user.hasPermission("send-submission-feedback", "course", { id : course.id })) {
      trinket.submissionState = "submitted";

      return trinket.save()
        .then(function(savedTrinket) {
          return request.success({
            data : savedTrinket
          });
        });
    }
    else {
      return Boom.forbidden();
    }
  }
}

/**
 * Shared course-creation core.
 *
 * Extracted so that lib/controllers/courses.js no longer has to re-enter
 * `POST /api/courses` through `server.inject`. Injection puts DEP0169 on the
 * live request path via @hapi/shot (node_modules/@hapi/shot/lib/request.js:30),
 * and the remediation has to be an extraction rather than one handler calling
 * another: an API route's JSON negotiation, validation, pre-handler context,
 * `replySpec` projection and error mapping are part of THAT route's contract
 * and cannot be borrowed. The shared work is therefore lifted here, and each
 * caller applies its own projection and its own error mapping.
 *
 * Inputs are taken explicitly - no `request`, no `reply`, no `h` - so the core
 * is callable from any context and exercisable without a request lifecycle.
 *
 * Errors are deliberately NOT handled here. The save rejection propagates to
 * the caller because the two callers answer it differently:
 *   - course.createCourse maps a duplicate-key error (11000) to request.fail
 *     with its own message, and any other failure to the preserved
 *     `{err, message}` response shape;
 *   - courses.create applies the page route's own mapping.
 *
 * @param   {Object} attributes  course attributes, as supplied by a route payload
 * @param   {Object} actingUser  the user creating the course; becomes its owner
 * @returns {Promise<Object>}    the saved course document, with the acting user
 *                               already granted the "course-owner" role
 */
module.exports.createCourseCore = async function(attributes, actingUser) {
  var course = new Course(attributes);

  course.setOwner(actingUser);
  course.ownerSlug = actingUser.username;

  // TODO: verify that user has permission to create a private course
  // (comment preserved verbatim from the original createCourse body; it records
  // a pre-existing gap and is not new deferred work introduced by this change)
  course.setGlobalSettings(attributes);

  course = await course.save();

  // request.user.grant("course-owner", "course", { id : course.id })
  await course.addUser(actingUser, ["course-owner"]);

  return course;
};

function generateAccessCode() {
  var code     = []
    , possible = "ABCDEFGHJKLMNPRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    , i;

  for (i = 0; i < 6; i++) {
    code.push(possible.charAt(Math.floor(Math.random() * possible.length)));
  }

  return code.join("");
}
