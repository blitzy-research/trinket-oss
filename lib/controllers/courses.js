// This module must NOT require `@hapi/hapi`, even unused. A transitive
// dependency of `mongoose-schema-extend` installs a Proxy polyfill that replaces
// the global `Object.getPrototypeOf`; once that has happened, requiring the hapi
// package throws `Schema can only contain plain objects` from @hapi/validate's
// compile step. `config/app.config` requires this controller while parsing
// routes, so a hapi require here would load hapi from wherever a process reaches
// `config/app.config` - including after `config/db` has run the polyfill - and
// make that process unable to load at all. `app.js` holds the one hapi require,
// ahead of any of this.
var _           = require('underscore'),
    diff        = require('diff'),
    util        = require('util'),
    fs          = require('fs'),
    os          = require('os'),
    path        = require('path'),
    zip         = require('adm-zip'),
    config      = require('config'),
    StringUtils = require('../util/stringUtils'),
    nunjucks    = require('../util/nunjucks'),
    parser      = require('../shared/trinket-markdown.js')({}),
    errors      = require('@hapi/boom'),
    ObjectUtils = require('../util/objectUtils'),
    // Holds `createCourseCore`, the shared course-creation core `create` calls.
    courseCtrl  = require('./course');

// The mode the per-request course-export work root carries: owner-only (0700),
// which is what `mkdtemp` creates it as, plus setgid.
//
// The setgid bit is OBSERVABLE in the archive and is set deliberately.
// `adm-zip` copies `0xfff & stats.mode` of every directory it walks into that
// entry's external attributes [node_modules/adm-zip/adm-zip.js, `addFile`], so
// the lesson directories' on-disk mode is what the container declares - and a
// directory gets setgid only by INHERITING it from its parent. Under the
// host-global `/tmp/<username>` root this controller used to build in, that bit
// came from `/tmp` itself being `drwxrwsrwx`; a per-request root under
// `os.tmpdir()` follows TMPDIR instead, which both a parity run
// [test/parity/server.js, `buildChildEnv`] and a container point at a directory
// that has no such bit. Carrying it here makes the archive's bytes a property
// of this code rather than of the host's temp directory, and keeps them at the
// value the parity register pins for this route
// (`directoryExternalAttributes: 0x45ed0010`, i.e. `0o42755`
// [test/parity/replay.js, `ARCHIVE_CONTAINER_REGISTER`]).
//
// It takes a `chmod` rather than a mode argument: `mkdir`'s mode is masked to
// the permission bits, so `mkdir(dir, {mode: 0o2755})` produces `0o0755` -
// measured on this host - while `chmod` sets the bit and every directory
// created inside afterwards inherits it.
var EXPORT_WORK_ROOT_MODE = 0o2700;

module.exports = {
  creationForm : async function(request, h) {
    return request.success();
  },

  // `POST /courses` and `POST /api/courses` share only `createCourseCore`, which
  // this handler calls directly - so none of the API route's contract reaches
  // this path. That route's JSON negotiation, its `replySpec` projection and its
  // error mapping stay with it, and this handler builds its own response and
  // maps its own errors below.
  //
  // What governs this path's inputs is its own validate block in
  // config/routes.js: the same four payload rules the API route declares, plus
  // `min(1)` on the course name, so this is the stricter of the two.
  create : async function(request, h) {
    var course;

    // The requested `courseType` is passed to the core as sent: neither this
    // handler nor `createCourseCore` consults `create-private-course`, so a
    // `private` course is created for any caller that reaches this route. That
    // is what both creation paths do (see the note in
    // `course.createCourse`), and it is preserved rather than tightened.
    try {
      // The promise boundary belongs at this call site, and the core resolves
      // with the saved course document.
      //
      // Unlike course.createCourse, this handler calls the core INSIDE the try,
      // so a throw from the core's synchronous section - `new Course(payload)`,
      // setOwner, ownerSlug, setGlobalSettings - is caught here and takes the
      // same path as an unknown save failure: the catch below leaves the request
      // unanswered rather than letting the throw reach the route handler
      // catch-all and answer 500.
      course = await courseCtrl.createCourseCore(request.payload, request.user);
    }
    catch (err) {
      // A duplicate course name (the driver's 11000) is the one failure this
      // route answers. The message is client-visible - `request.fail` flashes it
      // as `failure` and /courses/new renders it - so it is worded here rather
      // than taken from the driver's own error text.
      if (err.code === 11000) {
        return request.fail({
            err     : err
          , message : "You already have a course with this name. Please choose another."
        });
      }

      // Every other failure leaves this request intentionally unanswered, and
      // the never-settling promise is what implements that: falling through would
      // resolve `undefined`, which hapi turns into Boom.badImplementation and
      // answers 500. Keeping `err.message` out of every value is also what keeps
      // raw driver and model detail out of the `failure` flash that /courses/new
      // renders.
      return new Promise(function() {});
    }

    if (course) {
      // Serialized here even though `request.success` serializes again, because
      // the two passes do different work: this one calls the document's own
      // `serialize`, and the second walks the resulting plain object and drops
      // its null-valued keys. Handing over the raw document would therefore
      // change the JSON body an `Accept: application/json` request receives.
      return request.success({
        course : ObjectUtils.serialize(course)
      });
    }

    // A falsy course with no error thrown is intentionally not answered either -
    // no invented status, no synthesized payload. The never-settling promise is
    // what implements it; falling through would resolve `undefined`, which hapi
    // turns into Boom.badImplementation and answers 500.
    return new Promise(function() {});
  },

  // The chain is returned and its `.then` produces the response. There is no
  // `.catch`, so a rejection reaches the route handler catch-all in
  // lib/util/routeParser.js and answers 500.
  getCourses : async function(request, h) {
    var roles;

    return request.user.getCourses()
      .then(function(courses) {
        return request.success({ data : courses });
      });
  },

  featuredCourses : async function(request, h) {
    return Course.findFeaturedForUser(request.user)
      .then(function(courses) {
        courses = _.map(courses, function(course) {
          // `page` is assigned with no declaration anywhere in this module, and
          // the module is not strict, so this writes a property on the global
          // object that every request shares. It is read back two lines below in
          // the same synchronous callback, so no other request can interleave
          // between the write and the read.
          page        = course.page;
          course      = ObjectUtils.serialize(course);
          course.page = page || "";

          return course;
        });
        return request.success({ data : courses });
      })
      // Every failure, a database error included, is intentionally swallowed into
      // an empty list: no logging, no error response, and `error` unused.
      .catch(function(error) {
        return request.success({ data : [] });
      });
  },

  copy : async function(request, h) {
    // `copy` is a callback-only model API, so the promise boundary is created
    // here at the lifecycle method and the model keeps its interface. The whole
    // body stays INSIDE that callback, which is what decides where a failure
    // surfaces: the copy completes, then the URL is interpolated, then the role
    // is granted, then the response is produced.
    //
    // THE FAILING CALLBACK IS ANSWERED, AND THAT IS A DEVIATION FROM BASELINE.
    // The register entry that approves it is docs/preserved-quirks.md 11.13,
    // which carries the measurement, the conflict, the precedence argument and
    // the field-by-field contract; this comment cites that section rather than
    // asserting an approval of its own.
    //
    // What baseline did, measured against a running 2f8712a worktree rather
    // than reasoned about: the error argument was never inspected, and
    // `lib/models/course.js`'s `copy` calls back with NO document when its
    // first save fails, so `course.slug` below threw a TypeError inside the
    // model's own save callback. Mongoose re-emits whatever a save callback
    // throws as an 'error' event on the model, and at 2f8712a nothing listened
    // for it, so THE PROCESS EXITED (code 1) with the request unanswered and
    // every other route gone with it. The owner copying their own course
    // reaches that on the FIRST attempt, because the copy keeps the name and
    // `{_owner, slug}` is unique (lib/models/course.js index declaration).
    //
    // Nothing outside this file now stands between that throw and the process
    // exit, and that is a correction to what this comment said before. An
    // earlier revision of `lib/models/model.js` added a model-level 'error'
    // listener that logged instead of exiting, and this comment credited it
    // with turning the exit into a 20-second hang. That listener has since been
    // WITHDRAWN as an unregistered behaviour change (R-d) - the reasoning is
    // with the `$handleCallbackError` override in lib/models/model.js, which
    // was measured and retained for a different edge and which deliberately
    // lets a throw from its own re-delivery reach Mongoose's emit, exactly as
    // the base commit did. So the baseline outcome this route has to answer for
    // is the process exit itself, not a hang, and the branches below are the
    // whole of what prevents it. R-b does not permit the exit and an exit is
    // not an observable behaviour a client can rely on, so they answer.
    //
    // Neither response is invented. The duplicate-name branch reproduces what
    // this feature already answers for exactly this collision, in this file
    // (`create`, above) and for this model call (`course.copyCourse`): the same
    // `request.fail({err, message})` with the same string, which flashes
    // `failure` and redirects to whatever the route declares. Measured, this
    // route declares `/welcome` (config/routes.js) and `lib/views/base.html`
    // renders only `flash.siteMessage`, so the HTML client is redirected and
    // the message rides in the flash without being displayed there, while a
    // JSON-negotiated request receives it in the body. That target is the
    // route's own declaration and changing it is neither this fix's business
    // nor this file's. The
    // unknown-failure branch reproduces this file's own mapping for an unknown
    // fault (`download`'s `return errors.badImplementation(err.message)`),
    // RESOLVED and never thrown - a thrown or rejected Boom is rewritten by the
    // route catch-all into a second badImplementation - so the client is
    // answered 500 with hapi's generic payload while the driver's own message
    // stays on the Boom as internal detail.
    //
    // The success path is untouched: the interpolation, the grant and the
    // response still run inside this callback frame, in that order.
    return await new Promise(function(resolve) {
      request.pre.course.copy(request.user, function(err, course) {
        if (err || !course) {
          if (err && err.code === 11000) {
            // A duplicate course name for the same owner - the `_owner_1_slug_1`
            // unique index - answered as this feature already answers it, with
            // the string composed at both sibling sites rather than a new one.
            // Nothing is persisted on this branch: the model's FIRST save is
            // what failed.
            return resolve(request.fail({
                err     : err
              , message : "You already have a course with this name. Please choose another."
            }));
          }

          // Any other write failure, and the no-document-without-an-error case
          // that is this branch's whole reason for existing: the TypeError the
          // interpolation below used to throw came from exactly that value.
          return resolve(errors.badImplementation(err && err.message));
        }

        var urlTemplate = (config.app.usersubdomains)
          ? '//{user}.{domain}/{course}'
          : '//{domain}/u/{user}/classes/{course}';

        var url = StringUtils.interpolate(urlTemplate, {
          user:   request.user.username,
          domain: config.app.url.hostname,
          course: course.slug
        });

        // Only this chain's success path settles the handler, with the response
        // `request.success` builds. It intentionally carries no `.catch` and
        // nothing connected to a rejection path, so a rejecting grant is an
        // unhandled rejection and the request is never answered.
        return request.user.grant("course-owner", "course", { id : course.id })
          .then(function() {
            resolve(request.success({ classPageUrl : url }));
          });
      });
    });
  },

  coursePage : async function(request, h) {
    var courseId = request.pre.course.id
      , isOwner  = request.user && request.user.hasRole('course-owner', 'course', { id : courseId })
      , canEdit  = request.user && request.user.hasPermission('manage-course-content', 'course', { id : courseId })
      , isAssoc  = request.user && request.user.hasRole('course-associate', 'course', { id : courseId })
      , urlTemplate, url, event;

    if (!(canEdit || isAssoc)) {
      urlTemplate = (config.app.usersubdomains)
        ? '//{user}.{domain}/{course}'
        : '//{domain}/u/{user}/classes/{course}';

      url = config.app.url.protocol + ':' + StringUtils.interpolate(urlTemplate, {
        user   : request.params.userSlug,
        domain : config.app.url.hostname,
        course : request.params.courseSlug
      });

      // `url` is already fully qualified - built above from
      // `config.app.url.protocol` and a protocol-relative template - so it is
      // handed to the toolkit unchanged and becomes the Location header as it
      // stands.
      return h.redirect(url);
    }

    return request.success({
      courseId   : courseId,
      courseSlug : request.params.courseSlug,
      userSlug   : request.params.userSlug,
      canEdit    : canEdit,
      isAssoc    : isAssoc
    });

  },

  download : async function(request, h) {
    var owner  = request.pre.user
      , course = request.pre.course;

    if (request.user.hasRole("course-owner", "course", { id : course.id })
    ||  course.globalSettings.courseType === "public"
    ||  course.globalSettings.courseType === "open"
    ||  request.user.hasPermission("create-private-course")  // TRUE FOR EVERY ACCOUNT: see 10.12
    ||  request.user.hasPermission("make-course-copy", "course", { id : course.id })) {

      var format    = request.query.format;

      // Working tree for this export: ONE PRIVATE DIRECTORY PER REQUEST, whose
      // name no other request can derive. `courseDir` sits inside `workRoot`,
      // the lesson directories and material files are written under it, the
      // archive is written beside it, and the whole of `workRoot` - archive
      // included - is removed once the archive is open (returnZip) or as soon as
      // a step before that rejects (the chain's `.catch`). Both are assigned by
      // `makeWorkTree` below, which is the first link of that chain, and the
      // closures that read them are all called after it has resolved.
      //
      // This was `'/tmp/' + owner.username` with `'/' + course.slug` inside it:
      // a host-global path derived entirely from the request, and the whole of
      // the owner half was what `returnZip` removed. Two application instances
      // on one host - or two concurrent requests to one instance - for the same
      // owner and course therefore assembled their exports in the SAME
      // directory and each deleted the other's tree, so a client could be
      // served an archive built from another instance's database, a deletion
      // could pull the tree out from under a request still writing into it, and
      // the path was predictable enough for anything else on the host to
      // pre-create or read. Measured by QA over 24 paired concurrent downloads
      // against two instances on separate databases: 14 of 17 successful
      // responses carried the other database's lesson tree, 3 answered 500, 4
      // never answered, and one process died.
      //
      // `mkdtemp` is what removes all of that: the suffix is random rather than
      // derived from the request, the kernel creates the directory 0700 and
      // fails if the name already exists, and nothing outside this request ever
      // names it - so the isolation does not depend on the owner, the course,
      // the instance count or the arrival order.
      // The ordinary path that made this destructive rather than merely racy: the
      // download dialog offers Source Files and HTML Pages as two independent
      // controls, so one author asking for both formats at once is normal use, and
      // under the old per-owner root each export deleted the other's tree mid-write.
      var workRoot  = null;
      var courseDir = null;

      // Creates this request's working tree, and is the first step of the chain
      // at the end of this handler so that a failure here takes the same route
      // as a failure in any other step: the `.catch` maps it to the same 500 and
      // removes whatever was created.
      var makeWorkTree = async function() {
        workRoot  = await fs.promises.mkdtemp(
          path.join(os.tmpdir(), 'trinket-course-download-'));
        courseDir = path.join(workRoot, course.slug);

        // Not swallowed: the bit is part of what the archive declares (see
        // EXPORT_WORK_ROOT_MODE), so a chmod that failed silently would ship
        // containers whose directory attributes differ from every other run's.
        await fs.promises.chmod(workRoot, EXPORT_WORK_ROOT_MODE);

        return fs.promises.mkdir(courseDir, { recursive : true });
      }

      // Removes this request's working tree, and nothing above it. It never
      // rejects, because both callers have already decided what the client
      // receives by the time they call it and a deletion failure must not
      // replace a decided response with something else.
      //
      // `force` absorbs a path that is already gone, so calling it twice - or
      // after a rejection that happened before `makeWorkTree` resolved - is
      // safe, and a null `workRoot` means there is nothing on disk to remove.
      var removeWorkTree = async function() {
        if (!workRoot) {
          return;
        }

        try {
          await fs.promises.rm(workRoot, { recursive : true, force : true });
        }
        catch (rmErr) {
          // A failed deletion is intentionally swallowed, and the error is
          // intentionally not inspected: in returnZip the archive's descriptor
          // is already open, so the response is produced whether or not the
          // working tree went away cleanly, and in the `.catch` the 500 has
          // already been decided by the failure that got there.
        }
      }

      var fullCourse = {
        name        : course.name,
        description : course.description,
        lessons     : []
      };

      var mkLessonDirs = function() {
        return Promise.all(course.lessons.map(function(lesson, lessonIndex) {
          return Lesson.findById(lesson)
            .then(function(lesson) {
              var lessonDir = courseDir + '/' + lesson.slug;
              fullCourse.lessons[ lessonIndex ] = lesson;
              return fs.promises.mkdir(lessonDir, { recursive : true })
                .then(function() {
                  return lesson.materials.map(function(material, materialIndex) {
                    return {
                      writeTo       : lessonDir,
                      material      : material,
                      lessonIndex   : lessonIndex,
                      materialIndex : materialIndex
                    };
                  });
                });
            });
        }));
      }

      var getMaterialContent = function(materialInfo) {
        var flatList = _.flatten(materialInfo);
        return Promise.all(flatList.map(function(info) {
          return Material.findById(info.material)
            .then(function(material) {
              // A page with no body contributes an empty file, exactly as the
              // missing-material half of this expression already did. The second
              // test is not redundant: `content` carries the `pruneEmpty` setter
              // in lib/models/material.js, which maps null and '' to `undefined`
              // on the way into the document, so a page created without content
              // or emptied afterwards reads back as `undefined` rather than ''.
              // Left unguarded, that value reaches fs.promises.writeFile in
              // writeMaterialFiles below, which rejects with 'The "data" argument
              // must be of type string ... Received undefined' and takes the
              // whole export to a 500. The shape mirrors lib/controllers/course.js,
              // which reads the same field as `material.content ? material.content : ''`.
              var content = !material || !material.content ? '' : material.content;

              fullCourse.lessons[ info.lessonIndex ].materials[ info.materialIndex ] = material;

              return {
                writeTo       : info.writeTo + '/' + material.slug + '.' + format,
                content       : content,
                lessonIndex   : info.lessonIndex,
                materialIndex : info.materialIndex
              }
            });
        }));
      }

      var parseMaterialContent = function(contentInfo) {
        var context;

        return Promise.all(contentInfo.map(function(info) {
          // TODO, maybe eventually?
          // find any trinket assets in each material
          // create _assets folder if it doesn't exist
          // download asset to _assets folder
          // replace material reference with local reference

          // nunjucks parse of format is html
          if (format === "html") {
            var currentMaterialIndex
              , slides = [];

            fullCourse.lessons.map(function(lesson, lessonIndex) {
              lesson.materials.map(function(material, materialIndex) {
                slides.push( lesson.slug + "/" + material.slug );
                if (lessonIndex === info.lessonIndex && materialIndex === info.materialIndex) {
                  currentMaterialIndex = slides.length - 1;
                }
              });
            });

            context = {
              pageContent   : parser(info.content),
              course        : fullCourse,
              owner         : owner,
              config        : config,
              lessonIndex   : info.lessonIndex,
              materialIndex : info.materialIndex,
              progress      : ( currentMaterialIndex + 1 ) / slides.length,
              prevPageHref  : currentMaterialIndex ? slides[ currentMaterialIndex - 1 ] : undefined,
              nextPageHref  : currentMaterialIndex + 1 <= slides.length ? slides[ currentMaterialIndex + 1 ] : undefined
            };

            return nunjucks.render('courses/download/view.html', context)
              .then(function(content) {
                return {
                  writeTo : info.writeTo,
                  content : content
                };
              });
          }
          else {
            return Promise.resolve({
              writeTo : info.writeTo,
              content : info.content
            });
          }
        }));
      }

      var writeMaterialFiles = function(files) {
        return Promise.all(files.map(function(file) {
          return fs.promises.writeFile(file.writeTo, file.content);
        }));
      }

      var zipCourse = function() {
        return Promise.resolve().then(function() {
          var zipFile = courseDir + '.zip';
          var courseZip = new zip();
          courseZip.addLocalFolder(courseDir);
          courseZip.writeZip(zipFile);
          return zipFile;
        });
      }

      var returnZip = async function(zipFile) {
        // The order of the four steps below is load-bearing. The archive lives
        // inside `workRoot`, so `stats.size` has to be read before the deletion;
        // the read stream has to be OPENED - genuinely, see below - before the
        // deletion, because the open descriptor is what keeps the unlinked
        // archive readable while it streams; and the deletion is awaited before
        // the response is returned, so the working tree is gone by the time a
        // client is answered.
        //
        // `fs.createReadStream` OPENS ASYNCHRONOUSLY, so constructing the stream
        // is not the same as opening it, and the open is exactly what the
        // deletion races. This function used to construct the stream and go
        // straight to the deletion with the open still queued on the libuv
        // threadpool: whenever the deletion won, the stream emitted 'error' with
        // ENOENT, nothing was listening, and an unhandled 'error' event
        // terminates the process - taking every in-flight request with it. Both
        // halves of that are closed below and neither is optional: the open is
        // AWAITED before the deletion, so the descriptor the response is read
        // from exists before the file is unlinked, and an 'error' listener is
        // attached before the open can settle and kept for the life of the
        // response, so no stream failure can ever reach the process as an
        // unhandled event.
        //
        // A failed stat is intentionally not answered. `statErr` is not
        // inspected, so `stats` stays undefined and the TypeError it causes is
        // raised from a detached tick further down - after the stream is open and
        // the working tree is gone, so both side effects still happen on this
        // edge. Nothing installs an 'uncaughtException' handler, so that throw
        // terminates the process; awaiting the stat rejection instead would send
        // it to this chain's `.catch` and answer 500. The edge is unreachable in
        // practice: the archive is written synchronously immediately above.
        var stats
          , statFailed = false;

        try {
          stats = await fs.promises.stat(zipFile);
        }
        catch (statErr) {
          // The stat error is intentionally not inspected; the flag is what the
          // rest of this function reads.
          statFailed = true;
        }

        var stream = fs.createReadStream(zipFile);

        // Attached before the open can settle, and never removed. Two failures
        // reach it. An open that fails, which is the statFailed edge above and
        // the only way a missing archive can present itself here. And a read
        // that fails part-way through transmission, by which point the status
        // line and the headers are already on the wire and there is no response
        // left to change. Either way the process has to survive, so this records
        // the failure in the shape the other controllers in this tree use and
        // does nothing else.
        stream.on('error', function(streamErr) {
          console.error('Course archive stream failed:', streamErr.message);
        });

        // The open, awaited. Neither outcome rejects: a rejection here would
        // reach this chain's `.catch` and answer 500 on an edge that
        // deliberately does not answer at all. `stream.pending` is false once
        // the descriptor is open, so a stream that opened while this ran is not
        // waited on, and 'ready' is emitted immediately after 'open' for the
        // one that has not.
        await new Promise(function(resolve) {
          if (!stream.pending) {
            return resolve();
          }

          stream.once('ready', resolve);
          stream.once('error', function() {
            resolve();
          });
        });

        // The archive's descriptor is open, so this unlinks the file the
        // response is read from and the response is unaffected - which is the
        // property the paragraph at the top of this function describes and the
        // awaited open above is what makes true. Only this request's own root is
        // removed. A failed deletion is intentionally swallowed inside
        // removeWorkTree: the response is produced whether or not the working
        // tree went away cleanly.
        await removeWorkTree();

        if (statFailed) {
          process.nextTick(function() {
            // `stats` is undefined here, so this raises "Cannot read properties
            // of undefined (reading 'size')" from a frame the request lifecycle
            // cannot see.
            void stats.size;
          });

          return new Promise(function() {});
        }

        // Returned, so the chain below carries this response out of the handler:
        // the archive stream, its content type, its byte count and the download
        // filename.
        return h.response(stream)
          .type('application/zip')
          .bytes(stats.size)
          .header('Content-Disposition', 'attachment; filename=' + course.slug + '.zip');
      }

      return makeWorkTree()
        .then(mkLessonDirs)
        .then(getMaterialContent)
        .then(parseMaterialContent)
        .then(writeMaterialFiles)
        .then(zipCourse)
        // returnZip resolves with the response, so this chain delivers it.
        .then(returnZip)
        .catch(async function(err) {
          // The working tree goes first, and this is the edge that needed it:
          // the only deletion used to be inside returnZip, so a rejection
          // anywhere above it - a lesson that cannot be read, a nunjucks
          // failure, a full disk - left the whole tree on the host permanently.
          // `removeWorkTree` never rejects, so it cannot replace this 500 with
          // anything else, and it removes only this request's own root.
          await removeWorkTree();

          // Every step of this chain rejects with a plain Error - fs, mongoose,
          // nunjucks, adm-zip - never with a Boom, so the failure is mapped here
          // to a 500 whose client-visible payload is hapi's generic
          // internal-error body. Returned rather than thrown, which keeps this
          // edge out of the route handler catch-all and its stack logging.
          return errors.badImplementation(err.message);
        });
    }
    else {  // UNREACHABLE over this route - preserved-quirks 9.7 and 10.12
      // This branch answers 500, not the 403 it reads as. `Boom` is not bound in
      // this module - the only @hapi/boom binding here is `errors` at the top of
      // the file, and the bare identifiers that do resolve at runtime (Course,
      // Lesson, Material, User) resolve because app.js assigns them as globals,
      // which `Boom` is not. So this expression raises ReferenceError('Boom is
      // not defined') before any response is constructed, and the route handler
      // catch-all in lib/util/routeParser.js maps it to a 500 carrying hapi's
      // generic internal-error payload. A browser request receives the rendered
      // 50x.html: the error extension in app.js returns before its cache-header
      // writes, so that response carries no Cache-Control, Pragma or Expires,
      // while an API or JSON request receives the JSON Boom with them.
      return Boom.forbidden();
    }
  }
};
