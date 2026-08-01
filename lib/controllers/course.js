var config = require('config'),
    diff   = require('diff'),
    errors = require('@hapi/boom'),
    _      = require('underscore'),
    moment = require('moment'),
    ObjectUtils = require('../util/objectUtils'),
    mailer = require('../util/mailer');

module.exports = {
  createCourse : async function(request, h) {
    var course = new Course(request.payload);

    course.setOwner(request.user);
    course.ownerSlug = request.user.username;

    // TODO: verify that user has permission to create a private course
    course.setGlobalSettings(request.payload);

    // async conversion. The base commit called course.save(callback) as a BARE STATEMENT, so this
    // handler resolved `undefined` and the retired shim recovered the response from its deferred
    // capture. That deferral is gone, so every path below returns its own response. The try/catch
    // rather than a bare await is what keeps the duplicate-name branch's error identity reachable,
    // exactly as the error-first callback did; the callback's `course` parameter shadowed the outer
    // binding with the saved document, which the reassignment reproduces.
    try {
      course = await course.save();
    }
    catch (err) {
      if (err.code === 11000) {
        return request.fail({
            err     : err
          , message : "You already have a course with this name. Please choose another."
        });
      }

      // unknown failure
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The deleted synthetic responder built its
      // response and then handed back a CHAINABLE BUILDER; this site called no terminator, so the
      // value that stood in for the response was the builder itself - every own property a
      // function. R-6 ADJUDICATION, measured on @hapi/hapi 21: that shape serializes to status
      // 200, content-type application/json, body `{}` - never to the { err, message } object this
      // code appears to send. Responding with a literal empty object reproduces that exactly; an
      // argument-less h.response() would emit an EMPTY body rather than `{}`, and returning the real
      // { err, message } object would be a prohibited behaviour change.
      // lib/controllers/courses.js#create consumes this route over server.inject and matches
      // neither `.course` nor `.err` against `{}`, which is why that handler falls through - that
      // is baseline, and it must stay reachable.
      return h.response({});
    }

    // request.user.grant("course-owner", "course", { id : course.id })
    return course.addUser(request.user, ["course-owner"])
      .then(function() {
        // async conversion. The base commit did not return this response, so the chain resolved
        // `undefined` and the shim's deferral supplied it. The inject consumer named above reads
        // `response.result.course`, so the key must stay exactly `course`.
        return request.success({ course : course });
      });
  },

  getCourse : function(request, h) {
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

    // async conversion. The base commit left this chain unreturned, so the handler resolved
    // `undefined` and the shim's now-deleted deferral recovered the response.
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
    var course = request.pre.course;

    if (request.user.hasPermission("update-course-details", "course", { id : course.id })) {
      course.set(request.payload);
      course.setGlobalSettings(request.payload);

      // async conversion - see the note in createCourse. Bare statement at baseline, so the
      // response now has to be returned from every branch.
      try {
        course = await course.save();
      }
      catch (err) {
        if (err.code === 11000) {
          return request.fail({
              err     : err
            , message : "You already have a course with this name. Please choose another."
          });
        }

        // unknown failure
        // PRESERVED QUIRK - builder serialization, HTTP 200 with body `{}`. See the fully
        // annotated twin in createCourse and docs/PRESERVED-QUIRKS.md.
        return h.response({});
      }

      return request.success({ course : course });
    }
    else {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. `Boom` is UNDECLARED in this module: it
      // binds @hapi/boom as `errors` (L3) and never references it, and `Boom` is neither required
      // here, nor a Node global, nor in app.js's gleak whitelist. Evaluating the identifier throws
      // ReferenceError before `.forbidden` is reached and before any responder is called, so the
      // centralized error map answers a scrubbed HTTP 500 - NOT a 403. That is the measured
      // baseline for every permission denial in this file and it is preserved deliberately:
      // adding a `Boom` require, or rebinding these onto the `errors` alias, would silently convert
      // 500s into 403s and 404s across 41 sites. Keep the identifier exactly as written.
      throw Boom.forbidden();
    }
  },

  deleteCourse : function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("delete-course", "course", { id : course.id })) {
      return course.deleteCourse()
        .then(request.success)
        .catch(function(err) {
          // hapi API migration. The deleted synthetic responder tested `data instanceof Error` and
          // answered a badImplementation - a 500 whose message hapi scrubs. Measured over real
          // HTTP on @hapi/hapi 21.4.10: a thrown and a returned plain Error produce the identical
          // scrubbed 500, so `throw err;` is mapping-neutral. It also preserves the isBoom
          // pass-through the synthetic responder had, since a Boom thrown here renders as itself.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - `Boom` is undeclared, so this is a ReferenceError and the wire answer is
      // a scrubbed 500, not a 403. See updateCourse and docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  // archive or restore
  archiveCourse : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasRole("course-owner", "course", { id : request.pre.course.id })) {
      course.set({ archived: request.payload.archived });
      // async conversion. Bare statement at baseline, and the callback IGNORED its `err` argument
      // entirely - a save failure therefore produced no response at all and the request never
      // settled. A bare await keeps that error unhandled here, so it now reaches the centralized
      // error map as a clean 500. Deliberately NOT wrapped in a try/catch: inventing a failure
      // response would be a behaviour change. See docs/PRESERVED-QUIRKS.md.
      course = await course.save();
      return request.success({ course: course });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
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

      // async conversion. Course#copy (lib/models/course.js) takes an error-first callback and
      // returns nothing at all, so it cannot be awaited directly; the promise wrapper below is the
      // adapter. It deliberately has no timeout: Course#copy's inner chain is left unterminated on
      // purpose, so a rejection from Lesson.findById or lesson.copy never reaches the callback and
      // the request never settles. That hang is the measured baseline - the shim's deferral never
      // resolved either - and this wrapper reproduces it rather than repairing it.
      // See docs/PRESERVED-QUIRKS.md.
      try {
        course = await new Promise(function(resolve, reject) {
          request.pre.course.copy(request.user, function(err, copied) {
            if (err) {
              return reject(err);
            }

            return resolve(copied);
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
        // PRESERVED QUIRK - builder serialization, HTTP 200 with body `{}`. See the fully
        // annotated twin in createCourse and docs/PRESERVED-QUIRKS.md.
        return h.response({});
      }

      return course.addUser(request.user, ["course-owner"])
        .then(function() {
          // url needs to be fully qualified in case the copy is
          // happening from the original owner's subdomain
          url = config.url + '/' + course.ownerSlug + '/courses/' + course.slug;
          // async conversion - this response was not returned at baseline.
          return request.success({
              success : true
            , url     : url
          });
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  addLesson : function(request, h) {
    var course = request.pre.course
      , lesson, index;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      lesson = new Lesson(request.payload);
      index  = Math.max(0, Math.min(course.lessons.length, request.query.index || course.lessons.length));

      lesson.setOwner(request.user);

      if (course.globalSettings.contentDefault === 'draft') {
        lesson.isDraft = true;
      }

      // async conversion. The base commit left this chain unreturned, so the handler resolved
      // `undefined` and the shim's now-deleted deferral recovered the response.
      return lesson.save()
        .then(function(savedLesson) {
          lesson = savedLesson;
          course.lessons.splice(index, 0, lesson.id);
          return course.save();
        })
        .then(function() {
          // async conversion - this response was not returned at baseline.
          return request.success({ data : lesson });
        })
        .catch(function(err) {
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  getLesson : function(request, h) {
    return request.success({ data : request.pre.lesson });
  },

  updateLesson : async function(request, h) {
    var course = request.pre.course
      , lesson = request.pre.lesson;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      lesson.set(request.payload);
      // async conversion. Bare statement at baseline whose callback IGNORED `err`, so a save
      // failure produced no response; a bare await now lets it reach the error map as a 500. See
      // the note in archiveCourse and docs/PRESERVED-QUIRKS.md.
      lesson = await lesson.save();
      return request.success({
        lesson : {
          name    : lesson.name,
          slug    : lesson.slug,
          isDraft : lesson.isDraft || false
        }
      });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
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

      // async conversion. Bare statement at baseline whose callback IGNORED `err`; see the note in
      // archiveCourse.
      course = await course.save();
      return request.success({
        oldParent : course.id,
        newParent : course.id,
        oldIndex  : index,
        newIndex  : request.payload.index
      });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  deleteLesson : function(request, h) {
    var course = request.pre.course,
        lesson = request.pre.lesson;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      // async conversion. Bare statement at baseline, so the chain is now returned; it resolves to
      // whichever response its own last link produced.
      return lesson.remove()
        .then(function(lesson) {
          course.lessons.pull(lesson.id);
          return course.save();
        })
        .then(function(course) {
          return request.success({ course : course });
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
        .catch(request.fail);
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  addMaterial : function(request, h) {
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
          return request.success({ data : material });
        })
        .catch(function(err) {
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  getMaterial : function(request, h) {
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

  updateMaterial : function(request, h) {
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

          // dependency swap - `diff` moves 1.0.8 -> 9.0.0 (see the delivered dependency
          // inventory). The require at the top of this file is UNCHANGED, and applyPatch still
          // answers the boolean `false` on failure, so the strict `=== false` test below still
          // selects the conflict branch and the whitespace-only -> null collapse is untouched.
          //
          // R-6 ADJUDICATION, measured by installing both versions side by side and replaying the
          // patch shapes this application actually produces. The browser copy of jsdiff is pinned
          // at 1.0.8 by config/default.yaml, and its createPatch is the sole producer of the
          // payload read below - see public/js/courseEditor/controllers/materialControl.js:L321.
          // For every hunk header it emits with at least one old line, the two versions return
          // byte-identical output. They diverge on exactly one shape: a first edit against an EMPTY
          // material, for which jsdiff 1.0.8 writes the non-canonical zero-old-lines header
          // '@@ -1,0 +1,N @@'. 1.0.8 spliced those added lines in BEFORE line 1, while 9.0.0
          // follows GNU patch and inserts them AFTER line 1 - which prepended a blank line to the
          // first save of every new page and dropped its trailing newline. Rewriting that one
          // header to its canonical '@@ -0,0' form restores byte-identical output on both versions,
          // and was measured to be a no-op under 1.0.8's own semantics, so persisted course content
          // is unchanged (TR6). The pattern is anchored so it touches only the leading header,
          // which is the only header 1.0.8 can emit with zero old lines.
          if (typeof(request.payload.patch) !== 'undefined') {
            var patchText = request.payload.patch.replace(/^@@ -1,0 /, '@@ -0,0 ');
            var patched = diff.applyPatch(material.content ? material.content : '', patchText);
            if (patched === false) {
              // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. request.fail never sets a status,
              // so this builds an HTTP 200 carrying data.status === "error" rather than a 409.
              //
              // R-6 ADJUDICATION, measured by running the base-commit controller behind a replica
              // of the base-commit shim on real hapi over real HTTP: the ROUTE nevertheless answers
              // a scrubbed 500, because the chain does NOT short-circuit here. The next .then()
              // receives this fail RESPONSE as its `savedMaterial` and hands it to request.success,
              // whose ObjectUtils.serialize walks the hapi response into request._core and
              // overflows the stack. The shim resolved its deferred with the 200 first and then
              // discarded it in favour of the handler's returned Boom - which is exactly what the
              // converted form produces through lib/http/errorMap.js. Do NOT add a status code, and
              // do NOT short-circuit the chain: either would turn a baseline 500 into a 200.
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  moveMaterial : function(request, h) {
    var course = request.pre.course
      , lesson = request.pre.lesson
      , index, parent;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      index = lesson.materials.indexOf(request.params.materialId);
      parent= request.pre.parent || lesson;

      lesson.materials.splice(index, 1);
      parent.materials.splice(request.payload.index, 0, request.params.materialId);

      // async conversion. Bare statement at baseline, so the chain is now returned.
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
        // PRESERVED QUIRK - error-as-`json` argument order; measured as a scrubbed 500, not a 200.
        // See the fully annotated twin in deleteLesson and docs/PRESERVED-QUIRKS.md.
        .catch(request.fail);
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  deleteMaterial : function(request, h) {
    var course   = request.pre.course
      , lesson   = request.pre.lesson
      , material = request.pre.material;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      // async conversion. Bare statement at baseline, so the chain is now returned.
      return material.remove()
        .then(function(material) {
          lesson.materials.pull(material.id);
          return lesson.save();
        })
        .then(function(lesson) {
          return request.success({ lesson : lesson });
        })
        // PRESERVED QUIRK - error-as-`json` argument order; measured as a scrubbed 500, not a 200.
        // See the fully annotated twin in deleteLesson and docs/PRESERVED-QUIRKS.md.
        .catch(request.fail);
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  listUsers : function(request, h) {
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
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  listInvitations : function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return CourseInvitation.findUnacceptedByCourse(course)
        .then(function(invitations) {
          return request.success({
            data : invitations
          });
        })
        .catch(function(err) {
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  userLookup : function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return User.findByLogin(request.payload.user)
        .then(function(user) {
          if (user) {
            return course.addUser(user, ['course-student']);
          }
          else {
            // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Already the native idiom, so this
            // line is UNCHANGED - and `Boom` is undeclared here too, so the ReferenceError this
            // raises is caught by the .catch below and answered as a scrubbed 500, NOT the 404 the
            // code reads as. A "user not found" lookup therefore returns 500 at baseline.
            throw Boom.notFound();
          }
        })
        .then(function(result) {
          if (result.success) {
            result.user.onDashboard = true;
            // async conversion - this response was not returned at baseline.
            return request.success({
                success : true
              , user    : result.user
            });
          }
          else if (result.alreadyListed) {
            // async conversion - this response was not returned at baseline.
            return request.success({
              alreadyListed : true
            });
          }
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. There is deliberately NO `else` here.
          // R-6 ADJUDICATION: at the base commit a `result` carrying neither flag left this
          // callback resolving `undefined`, the chain resolved `undefined`, and the shim's deferred
          // promise was never settled - so the request HUNG forever with no response. That hang
          // cannot be reproduced once the deferral is gone; the same fall-through now reaches hapi
          // as a handler that resolved `undefined` and becomes a clean 500. The hang-to-500
          // convergence is unavoidable and accepted. Adding an `else`, a default response or a
          // guard would invent a response no baseline request ever received.
        })
        .catch(function(err) {
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse. This
          // catch is also what contains the ReferenceError from the not-found throw above, so it
          // must stay in place.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  removeUser : function(request, h) {
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  addUser : function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return User.findById(request.payload.user)
        .then(function(user) {
          if (user) {
            return course.addUser(user);
          }
          else {
            // PRESERVED QUIRK - already native, UNCHANGED; undeclared `Boom` makes this a
            // ReferenceError caught below and answered as a scrubbed 500, not a 404. See the note
            // in userLookup and docs/PRESERVED-QUIRKS.md.
            throw Boom.notFound();
          }
        })
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse. Also
          // the containment point for the ReferenceError above.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  updateRoles : function(request, h) {
    var course = request.pre.course
      , role   = "course-" + request.payload.role;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return User.findById(request.payload.user)
        .then(function(user) {
          if (user) {
            return course.updateRole(user, role);
          }
          else {
            // PRESERVED QUIRK - already native, UNCHANGED; undeclared `Boom` makes this a
            // ReferenceError caught below and answered as a scrubbed 500, not a 404. See the note
            // in userLookup and docs/PRESERVED-QUIRKS.md.
            throw Boom.notFound();
          }
        })
        .then(function() {
          return request.success({
            success : true
          });
        })
        .catch(function(err) {
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse. Also
          // the containment point for the ReferenceError above.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  updateViews : function(request, h) {
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },

  sendInvitations : function(request, h) {
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  removeInvitation : function(request, h) {
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  updateInvitation : function(request, h) {
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
            // PRESERVED QUIRK - builder serialization, HTTP 200 with body `{}`. See the fully
            // annotated twin in createCourse and docs/PRESERVED-QUIRKS.md.
            return h.response({});
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
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  generateAccessCode : function(request, h) {
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  getAccessCode : function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("manage-course-access", "course", { id : course.id })) {
      return request.success({
          success    : true
        , accessCode : course.accessCode || ""
      });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  join : async function(request, h) {
    // async conversion. Course.findByAccessCode took an error-first callback and its lookup was a
    // BARE STATEMENT, so the handler resolved `undefined` and the shim's now-deleted deferral
    // recovered the response. The static forwards to Model.findOne, which returns an awaitable
    // query when no callback is supplied. The callback's error branch handed the error to the
    // deleted responder, which mapped it to a scrubbed 500; a bare await reproduces that by letting
    // the rejection reach the centralized error map, so no try/catch is added here.
    var course = await Course.findByAccessCode(request.payload.accessCode);

    if (!course) {
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. An unknown access code answers HTTP 200
      // with `success : false`, not a 404. Clients read the flag, so the status must not change.
      return request.success({
          success : false
        , message : "No course was found with that code. Please check your code and try again."
      });
    }

    return course.addUser(request.user, ["course-student"])
      .then(function(result) {
        if (result.alreadyListed) {
          // async conversion - this response was not returned at baseline.
          return request.success({
            alreadyListed : true
          });
        }
        else {
          // async conversion - this response was not returned at baseline.
          return request.success({
              success : true
            , course  : course
          });
        }
      })
      .catch(function(err) {
        // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
        throw err;
      });
  },
  startAssignment : function(request, h) {
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
        // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
        throw err;
      });
  },
  submitAssignment : function(request, h) {
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
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. R-6 ADJUDICATION: this does NOT produce
        // the 403-with-inner-error-text it reads as. `Boom` is undeclared in this module, so
        // evaluating the identifier throws ReferenceError before `.forbidden` is reached, `err` is
        // never stringified, and the wire answer is a 500 scrubbed to "An internal server error
        // occurred". The two Error-throwing date guards above therefore also surface as scrubbed
        // 500s rather than as their own messages. Preserved exactly: keeping the bare
        // `Boom` identifier is what holds the status at 500.
        throw Boom.forbidden(err);
      });
  },
  updateMySubmission : function(request, h) {
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
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. R-6 ADJUDICATION, same as the twin in
          // submitAssignment: `Boom` is undeclared, so this raises ReferenceError, `err` is never
          // stringified, and the wire answer is a scrubbed 500 - NOT a 403 carrying the inner error
          // text. The two Error-throwing date guards above surface the same way.
          throw Boom.forbidden(err);
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  autosaveComments : function(request, h) {
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
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  getUserSubmissionsForMaterial : function(request, h) {
    var submissions = []
      , userId;

    if (request.params.userId) {
      if (request.user.hasPermission("view-assignment-submissions", "course", { id : request.params.courseId })) {
        userId = request.params.userId;
      }
      else {
        // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
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

        return request.success({
          data : submissions
        });
      })
      .catch(function(err) {
        // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
        throw err;
      });
  },
  dashboardOverview : function(request, h) {
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  materialDashboard : function(request, h) {
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  getMaterialSubmissionsForAllUsers : function(request, h) {
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  getUserSubmissionsForCourse : function(request, h) {
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
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. R-6 ADJUDICATION: this reads as a 404 but
        // is not one. `Boom` is undeclared in this module, so evaluating the identifier throws
        // ReferenceError at the top level of the handler before any responder is called, and the
        // centralized error map answers a scrubbed HTTP 500. "Student is not a member of this
        // course" therefore returns 500 at baseline, and the bare identifier is what preserves it.
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

          return request.success({
            data : submissions
          });
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  autosaveFeedbackComments : function(request, h) {
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
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  autosaveSubmissionOpt : function(request, h) {
    var submission = request.pre.trinket;

    if (request.user.hasPermission("send-submission-feedback", "course", { id : submission.courseId })) {
      _.extendOwn(submission.submissionOpts, request.payload);

      return submission.save().then(request.success);
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  sendFeedback : function(request, h) {
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
          // hapi API migration - wire-identical scrubbed 500; see the note in deleteCourse.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
      throw Boom.forbidden();
    }
  },
  acceptSubmission : function(request, h) {
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
      // PRESERVED QUIRK - undeclared `Boom` => scrubbed 500, not 403. See docs/PRESERVED-QUIRKS.md.
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
