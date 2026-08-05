var config = require('config'),
    diff   = require('diff'),
    errors = require('@hapi/boom'),
    _      = require('underscore'),
    moment = require('moment'),
    ObjectUtils = require('../util/objectUtils'),
    mailer = require('../util/mailer');

// `Boom` is undeclared here: this module binds @hapi/boom as `errors` and never references it, and
// `Boom` is neither a Node global nor one of app.js's bare globals. Every `Boom.*` denial below
// therefore raises ReferenceError and answers a scrubbed HTTP 500 - never a 403 or 404. Keep the
// identifier as written; see docs/PRESERVED-QUIRKS.md section 4.13.

module.exports = {
  createCourse : async function(request, h) {
    var course = new Course(request.payload);

    course.setOwner(request.user);
    course.ownerSlug = request.user.username;

    // TODO: verify that user has permission to create a private course
    course.setGlobalSettings(request.payload);

    try {
      course = await course.save();
    }
    catch (err) {
      if (err.code === 11000) {
        return h.reject({
            err     : err
          , message : "You already have a course with this name. Please choose another."
        });
      }

      // unknown failure
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The deleted synthetic responder built its
      // response and then handed back a CHAINABLE BUILDER; only redirect(), code(), header() and
      // view() resolved the deferred capture, and this site called none of them.
      //
      // The BUILDER'S SERIALIZATION IS IRRELEVANT HERE, and that is the correction: whether hapi
      // would have turned that object into a 200 only matters when the builder actually reaches
      // hapi. At the base commit this branch sat inside `course.save(function (err, course) {...})`
      // and the handler frame carried NO return statement of its own
      // (lib/controllers/course.js:L20-L48 at 2f8712a), so the retired wrapper fell through to
      // `if (result === undefined) result = await responsePromise` - and no responder ever settled
      // that promise. The builder was returned to Mongoose's save callback and discarded. A
      // non-duplicate course save failure therefore answered NOTHING AT ALL.
      //
      // Returning `h.response({})` here would invent a 200, and rethrowing would invent a 500, so
      // the measured no-response fate is restored with `h.abandon` - hapi's own no-response outcome,
      // whose measured semantics are documented in lib/http/responseContract.js.
      // lib/controllers/courses.js#create consumes this route over server.inject and matches neither
      // `.course` nor `.err`, so its own fall-through stays reachable - and see the note there,
      // because an inject of an abandoned route never resolves either.
      return h.abandon;
    }

    // request.user.grant("course-owner", "course", { id : course.id })
    return course.addUser(request.user, ["course-owner"])
      .then(function() {
        // SECURITY REMEDIATION (review findings SEC-13 / M6 / SV-03) - see
        // docs/PRESERVED-QUIRKS.md section 4.14, and note that the fix is NOT here.
        // `Course.publicSpec` whitelists `_owner`, and `setOwner` assigns the populated User DOCUMENT
        // to it, so the success responder's `serialize()` reaches its nested-object branch. That branch
        // tests `hasOwnProperty('serialize')`, but mongoose installs `serialize` on the document
        // PROTOTYPE, so the test fails and the owner is JSON-cloned whole - which shipped the owner's
        // bcrypt hash, and a Google-linked owner's live OAuth bearer credential, in this body and,
        // through the server.inject in lib/controllers/courses.js#create, in POST /courses too.
        //
        // An earlier revision scrubbed the owner HERE, one route at a time. The scrub now lives in the
        // shared mechanism instead - lib/models/model.js#serialize's nested-clone branch - so this route
        // and every future route that serializes a model with a populated sub-document are covered by
        // one guard rather than by a call site each. Nothing on this line changes as a result: the
        // payload shape is the base commit's and only values no client may legitimately read are gone.
        //
        // The server.inject consumer in lib/controllers/courses.js#create reads
        // `response.result.course`, so the key must stay exactly `course`.
        return h.respond({ course : course });
      });
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
      return h.respond({ data : course });
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

        return h.respond({ data : course });
      });
  },

  // update name/description
  updateCourse : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("update-course-details", "course", { id : course.id })) {
      course.set(request.payload);
      course.setGlobalSettings(request.payload);

      try {
        course = await course.save();
      }
      catch (err) {
        if (err.code === 11000) {
          return h.reject({
              err     : err
            , message : "You already have a course with this name. Please choose another."
          });
        }

        // unknown failure
        // PRESERVED QUIRK - the twin of createCourse's branch, with the identical base nesting:
        // `course.save(function (err, course) {...})` inside an `if` branch that carried no return
        // statement, so the unresolved builder never reached hapi and this answered NOTHING. See the
        // fully annotated original in createCourse and docs/PRESERVED-QUIRKS.md.
        return h.abandon;
      }

      return h.respond({ course : course });
    }
    else {
      throw Boom.forbidden();
    }
  },

  deleteCourse : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("delete-course", "course", { id : course.id })) {
      return course.deleteCourse()
        .then(h.respond)
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },

  // archive or restore
  archiveCourse : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasRole("course-owner", "course", { id : request.pre.course.id })) {
      course.set({ archived: request.payload.archived });
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. Bare statement at baseline whose
      // callback IGNORED its `err` argument, so on a save failure `course` was `undefined` and
      // `request.success({ course : undefined })` still ran.
      //
      // R-6 ADJUDICATION, MEASURED over real HTTP on @hapi/hapi 20.3.0 against a verbatim replica of
      // the base-commit wrapper: that call SETTLED and answered **HTTP 200 with body `{"flash":[]}`**.
      // It was never a hang and never a 500. `route.success` defaults to `{}` so no redirect fires,
      // ObjectUtils.serialize DROPS keys whose value is `undefined` so `course` disappears from the
      // payload, and the responder ends at h.response(json). lib/http/responseContract.js keeps that
      // exact sequence and lib/util/objectUtils.js is unchanged since the base commit, so the same
      // 200 is reproducible here - which is why the save rejection is captured and the undefined
      // value is handed to the responder rather than being allowed to reach the error map as a 500.
      // Compare updateLesson below, which looks identical but dereferences its undefined callback
      // argument first and therefore genuinely answered nothing.
      try {
        course = await course.save();
      }
      catch (saveError) {
        // deliberately ignored, exactly as baseline's discarded `err` argument was; `course` is left
        // undefined so the responder emits the same payload it emitted at the base commit.
        course = undefined;
      }

      return h.respond({ course: course });
    }
    else {
      throw Boom.forbidden();
    }
  },

  copyCourse : async function(request, h) {
    var url, course;

    if (request.user.hasRole("course-owner", "course", { id : request.pre.course.id })
    ||  request.pre.course.globalSettings.courseType === "public"
    ||  request.pre.course.globalSettings.courseType === "open"
    ||  request.user.hasPermission("create-private-course")
    ||  request.user.hasPermission("make-course-copy", "course", { id : request.pre.course.id })) {
      request.pre.course.name = request.payload.name;

      // Course#copy is promise-native, so this awaits it directly. No timeout by design, and none may
      // be added: this call has TWO failure channels and the catch below answers each one as measured -
      // the first save's duplicate-name error with a client-visible payload, and the inner
      // lesson/material chain's silent-outcome sentinel with no response at all.
      try {
        course = await request.pre.course.copy(request.user);
      }
      catch (err) {
        // R-6 / review finding F6 - see lib/models/model.js#silentOutcome and docs/PRESERVED-QUIRKS.md
        // section 3.40. A failure inside Course#copy's INNER chain - Lesson.findById, lesson.copy, a
        // material copy, or the second course.save() - never reached this callback at all at the base
        // commit, so the request answered NOTHING. That chain now settles with the silent-outcome
        // sentinel instead of hanging, and this line translates it back into the same no-response
        // outcome. It is tested FIRST because the sentinel deliberately carries no `code`, so it can
        // never be confused with the duplicate-name failure below.
        if (err && err.silentCopyFailure) {
          return h.abandon;
        }

        if (err.code === 11000) {
          return h.reject({
              err     : err
            , message : "You already have a course with this name. Please choose another."
          });
        }

        // unknown failure
        // PRESERVED QUIRK - the same base nesting as createCourse: this branch lived inside
        // `request.pre.course.copy(request.user, function (err, course) {...})` and the handler frame
        // carried no return statement, so the unresolved builder was handed back to that callback and
        // discarded. A non-duplicate copy failure answered NOTHING. See the fully annotated original
        // in createCourse and docs/PRESERVED-QUIRKS.md.
        return h.abandon;
      }

      return course.addUser(request.user, ["course-owner"])
        .then(function() {
          // url needs to be fully qualified in case the copy is
          // happening from the original owner's subdomain
          url = config.url + '/' + course.ownerSlug + '/courses/' + course.slug;
          // Async conversion only - wire-neutral. The base commit called the success responder
          // without returning it, which resolved the shim's deferral; returning it hands the very
          // same response object straight back to hapi instead. Same status, same body.
          return h.respond({
              success : true
            , url     : url
          });
        });
    }
    else {
      throw Boom.forbidden();
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
          // async conversion - this response was not returned at baseline.
          return h.respond({ data : lesson });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },

  getLesson : async function(request, h) {
    return h.respond({ data : request.pre.lesson });
  },

  updateLesson : async function(request, h) {
    var course = request.pre.course
      , lesson = request.pre.lesson;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      lesson.set(request.payload);
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. Bare statement at baseline whose
      // callback IGNORED `err`. Unlike archiveCourse above, this callback DEREFERENCES its undefined
      // argument - `lesson.name` - before reaching the responder, so on a save failure it raised a
      // TypeError inside a callback no promise chain owned. MEASURED over real HTTP on
      // @hapi/hapi 20.3.0: NO RESPONSE AT ALL. Reproduced rather than converged; letting the
      // rejection reach the error map would answer 500, a status this branch never produced.
      try {
        lesson = await lesson.save();
      }
      catch (saveError) {
        return h.abandon;
      }

      return h.respond({
        lesson : {
          name    : lesson.name,
          slug    : lesson.slug,
          isDraft : lesson.isDraft || false
        }
      });
    }
    else {
      throw Boom.forbidden();
    }
  },

  moveLesson : async function(request, h) {
    var course = request.pre.course
      , index;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      index = course.lessons.indexOf(request.params.lessonId);
      course.lessons.splice(index, 1);
      course.lessons.splice(request.payload.index, 0, request.params.lessonId);

      // PRESERVED QUIRK - identical mechanism to updateLesson above, which carries the full
      // derivation. The base commit's `course.save(function (err, course) { return
      // request.success({ oldParent : course.id, ... }); })` ignored `err`, Mongoose passed no
      // document, and `course.id` raised a TypeError inside that orphaned callback - so a failed move
      // answered NOTHING rather than a 500. See docs/PRESERVED-QUIRKS.md.
      try {
        course = await course.save();
      }
      catch (saveErrorTheBaseCallbackIgnored) {
        return h.abandon;
      }

      return h.respond({
        oldParent : course.id,
        newParent : course.id,
        oldIndex  : index,
        newIndex  : request.payload.index
      });
    }
    else {
      throw Boom.forbidden();
    }
  },

  deleteLesson : async function(request, h) {
    var course = request.pre.course,
        lesson = request.pre.lesson;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      return lesson.remove()
        .then(function(lesson) {
          course.lessons.pull(lesson.id);
          return course.save();
        })
        .then(function(course) {
          return h.respond({ course : course });
        })
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Handing the failure responder straight to
        // a promise catch puts the ERROR into its first parameter (`json`) and leaves the second
        // (`err`) undefined, so it logs the inspected error followed by the literal string
        // "undefined". R-6 ADJUDICATION, measured on hapi 21: every route in this file is an /api/
        // route, so the responder's HTML branches cannot fire and it falls through to its terminal
        // h.response(json) - which refuses an Error ("Cannot wrap an error"). The request therefore
        // ends as a scrubbed 500, and the RETIRED shim made that identical call, so the 500 IS the
        // baseline outcome rather than a regression. Re-wrapping the catch to pass the error as the
        // second argument would turn that 500 into a 200 and change the log line, so the argument
        // order is kept verbatim.
        .catch(h.reject);
    }
    else {
      throw Boom.forbidden();
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
          // async conversion - this response was not returned at baseline.
          return h.respond({ data : material });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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

      return h.respond({
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

          // The browser copy of jsdiff pinned in config/default.yaml emits the non-canonical
          // zero-old-lines header '@@ -1,0 +1,N @@' for a first edit against an empty material, and the
          // server copy follows GNU patch by inserting those lines after line 1 rather than before it.
          // Rewriting only that leading header to its canonical '@@ -0,0' form keeps persisted content
          // identical. applyPatch answers boolean `false` on failure, which the `=== false` test relies on.
          if (typeof(request.payload.patch) !== 'undefined') {
            var patchText = request.payload.patch.replace(/^@@ -1,0 /, '@@ -0,0 ');
            var patched = diff.applyPatch(material.content ? material.content : '', patchText);
            if (patched === false) {
              // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The failure responder - `h.reject`
              // here, spelled `request.fail` at the base commit - never sets a status, so this builds
              // an HTTP 200 carrying data.status === "error" rather than a 409.
              //
              // R-6 ADJUDICATION, measured by running the base-commit controller behind a replica
              // of the base-commit shim on real hapi over real HTTP: the ROUTE nevertheless answers
              // a scrubbed 500, because the chain does NOT short-circuit here. The next .then()
              // receives this fail RESPONSE as its `savedMaterial` and hands it to the success
              // responder,
              // whose ObjectUtils.serialize walks the hapi response into request._core and
              // overflows the stack. The shim resolved its deferred with the 200 first and then
              // discarded it in favour of the handler's returned Boom - which is exactly what the
              // converted form produces through lib/http/errorMap.js. Do NOT add a status code, and
              // do NOT short-circuit the chain: either would turn a baseline 500 into a 200.
              return h.reject({
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
          return h.respond({ material : savedMaterial });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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
          return h.respond({
            oldParent : lesson.id,
            newParent : parent.id,
            oldIndex  : index,
            newIndex  : request.payload.index
          });
        })
        // PRESERVED QUIRK - error-as-`json` argument order; measured as a scrubbed 500, not a 200.
        // See the fully annotated twin in deleteLesson and docs/PRESERVED-QUIRKS.md.
        .catch(h.reject);
    }
    else {
      throw Boom.forbidden();
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
          return h.respond({ lesson : lesson });
        })
        // PRESERVED QUIRK - error-as-`json` argument order; measured as a scrubbed 500, not a 200.
        // See the fully annotated twin in deleteLesson and docs/PRESERVED-QUIRKS.md.
        .catch(h.reject);
    }
    else {
      throw Boom.forbidden();
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

      return h.respond({
        data : users
      });
    }
    else {
      throw Boom.forbidden();
    }
  },

  listInvitations : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return CourseInvitation.findUnacceptedByCourse(course)
        .then(function(invitations) {
          return h.respond({
            data : invitations
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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
            // async conversion - this response was not returned at baseline.
            return h.respond({
                success : true
              , user    : result.user
            });
          }
          else if (result.alreadyListed) {
            // async conversion - this response was not returned at baseline.
            return h.respond({
              alreadyListed : true
            });
          }
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. There is deliberately no
          // `else` reading `if`/`else if` here, and none is added. R-6 ADJUDICATION, MEASURED over
          // real HTTP on @hapi/hapi 20.3.0: a `result` carrying neither flag left this callback
          // resolving `undefined`, the chain resolved `undefined`, the shim's deferred capture was
          // never settled, and the request received NO RESPONSE AT ALL. That outcome IS reproducible,
          // so the fall-through returns hapi's own no-response outcome instead of resolving
          // `undefined` and letting hapi answer its own 500 - a status this branch never produced.
          // A default response or a guard would invent one it never produced either.
          return h.abandon;
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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
          return h.respond({
            success : true
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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
          return h.respond({
            success : true
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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
          return h.respond({
            success : true
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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
          return h.respond({
            success : true
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },

  sendInvitations : async function(request, h) {
    var course = request.pre.course;

    if (!mailer.isConfigured()) {
      return h.reject({
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
          return h.respond({
              success     : true
            , invitations : invitations
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },
  removeInvitation : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return CourseInvitation.findById(request.params.invitationId)
        .then(function(invitation) {
          return invitation.remove();
        }).then(function() {
          return h.respond({
            success : true
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },
  updateInvitation : async function(request, h) {
    var course     = request.pre.course
      , invitation = request.pre.invitation
      , canUpdate  = true
      , existingUser;

    if (!mailer.isConfigured()) {
      return h.reject({
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
            return h.respond({
                success    : true
              , invitation : invitation
            });
          })
          .catch(function(err) {
            // could be a duplicate email
            if (err.code === 11000) {
              return h.reject({
                  err     : err
                , message : "An invitation with that email address already exists."
              });
            }

            // unknown failure
            // HTTP 200 with body `{}`; see createCourse.
            return h.response({});
          });
      }
      else {
        return h.respond({
            success : false
          , message : "That email address is already in use by another user or an invitation."
        });
      }
    }
    else {
      throw Boom.forbidden();
    }
  },
  generateAccessCode : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      course.accessCode = generateAccessCode();
      return course.save()
        .then(function(savedCourse) {
          return h.respond({
              success    : true
            , accessCode : savedCourse.accessCode
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },
  getAccessCode : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return h.respond({
          success    : true
        , accessCode : course.accessCode || ""
      });
    }
    else {
      throw Boom.forbidden();
    }
  },
  join : async function(request, h) {
    var course = await Course.findByAccessCode(request.payload.accessCode);

    if (!course) {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. An unknown access code answers HTTP 200
      // with `success : false`, not a 404. Clients read the flag, so the status must not change.
      return h.respond({
          success : false
        , message : "No course was found with that code. Please check your code and try again."
      });
    }

    return course.addUser(request.user, ["course-student"])
      .then(function(result) {
        if (result.alreadyListed) {
          // async conversion - this response was not returned at baseline.
          return h.respond({
            alreadyListed : true
          });
        }
        else {
          // async conversion - this response was not returned at baseline.
          return h.respond({
              success : true
            , course  : course
          });
        }
      })
      .catch(function(err) {
        throw err;
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
        return h.respond({
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
        throw err;
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
        return h.respond({
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
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 4.13. This module binds
        // @hapi/boom as `errors` and declares no `Boom` identifier anywhere, so the bare `Boom.` used
        // at all 41 error sites in this file - these two error-object pass-throughs included - raises
        // ReferenceError. `err` is never stringified and the wire answer is a 500 scrubbed to "An
        // internal server error occurred". Measured at the base commit: `errors = require('@hapi/boom')`
        // at L3, zero `Boom` declarations, 41 bare `Boom.` references. R-6 makes that baseline
        // decisive over the Technical Specification's prose at sections 0.5.1.3 and 0.7.1, which
        // claims these two sites answer 403 carrying the inner error text; they never have.
        // Binding them to `errors` would turn a measured 500 into a 403 that discloses internal error
        // text - simultaneously an R-4 behavior change and an information leak. Keeping the bare
        // `Boom` identifier is what holds the status at 500.
        throw Boom.forbidden(err);
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
          return h.respond({
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
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 4.13. R-6 adjudication,
          // same as the twin in submitAssignment: `Boom` is undeclared in this module, so this raises
          // ReferenceError, `err` is never stringified, and the wire answer is a scrubbed 500 - NOT a
          // 403 carrying the inner error text. The two Error-throwing date guards above surface the
          // same way.
          throw Boom.forbidden(err);
        });
    }
    else {
      throw Boom.forbidden();
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

      return submission.save().then(h.respond);
    }
    else {
      throw Boom.forbidden();
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
        throw Boom.forbidden();
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

        return h.respond({
          data : submissions
        });
      })
      .catch(function(err) {
        throw err;
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

          return h.respond({
            data : listBy === "assignment" ? assignmentOverview : studentOverview
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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

          return h.respond({
            data : overview
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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

          return h.respond({
            data : submissions
          });
        })
        .catch(function(err) {
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
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
        throw Boom.notFound();
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

          return h.respond({
            data : submissions
          });
        });
    }
    else {
      throw Boom.forbidden();
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

      return submission.save().then(h.respond);
    }
    else {
      throw Boom.forbidden();
    }
  },
  autosaveSubmissionOpt : async function(request, h) {
    var submission = request.pre.trinket;

    if (request.user.hasPermission("send-submission-feedback", "course", { id : submission.courseId })) {
      _.extendOwn(submission.submissionOpts, request.payload);

      return submission.save().then(h.respond);
    }
    else {
      throw Boom.forbidden();
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
          return h.respond({
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
          throw err;
        });
    }
    else {
      throw Boom.forbidden();
    }
  },
  acceptSubmission : async function(request, h) {
    var course  = request.pre.course
      , trinket = request.pre.trinket;

    if (request.user.hasPermission("send-submission-feedback", "course", { id : course.id })) {
      trinket.submissionState = "submitted";

      return trinket.save()
        .then(function(savedTrinket) {
          return h.respond({
            data : savedTrinket
          });
        });
    }
    else {
      throw Boom.forbidden();
    }
  }
}

function generateAccessCode() {
  var code     = []
    , possible = "ABCDEFGHJKLMNPRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    , i;

  for (i = 0; i < 6; i++) {
    code.push(possible.charAt(Math.floor(Math.random() * possible.length)));
  }

  return code.join("");
}
