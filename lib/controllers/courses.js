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
    zip         = require('adm-zip'),
    config      = require('config'),
    StringUtils = require('../util/stringUtils'),
    nunjucks    = require('../util/nunjucks'),
    parser      = require('../shared/trinket-markdown.js')({}),
    errors      = require('@hapi/boom'),
    ObjectUtils = require('../util/objectUtils'),
    // Holds `createCourseCore`, the shared course-creation core `create` calls.
    courseCtrl  = require('./course');

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
    // The error argument is intentionally not inspected. The model calls back
    // with no document when its first save fails, so the interpolation below
    // then throws a TypeError reading `slug` of undefined - and it throws inside
    // the model's own save callback, where no request lifecycle can route it:
    // mongoose catches whatever a save callback throws and re-emits it as an
    // 'error' event on the model, nothing listens for that event or for
    // 'uncaughtException', so the process terminates and the request is never
    // answered. Keeping the interpolation in this frame keeps that outcome;
    // hoisting it into the handler frame would reject the handler and answer 500,
    // and rejecting on `err` would report the model's own error instead of this
    // TypeError.
    return await new Promise(function(resolve) {
      request.pre.course.copy(request.user, function(err, course) {
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
    ||  request.user.hasPermission("create-private-course")
    ||  request.user.hasPermission("make-course-copy", "course", { id : course.id })) {

      var format    = request.query.format;

      // Working tree for this export, built with fs/promises calls at their own
      // call sites below: `courseDir` sits inside `ownerDir`, the lesson
      // directories and material files are written under it, and the whole of
      // `ownerDir` - archive included - is removed in returnZip.
      var ownerDir  = '/tmp/' + owner.username;
      var courseDir = ownerDir + '/' + course.slug;

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
              var content = !material ? '' : material.content;

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
        // The order of the three steps below is load-bearing. The archive lives
        // inside `ownerDir`, so `stats.size` has to be read before the deletion;
        // the read stream has to be OPENED before the deletion, because the open
        // descriptor is what keeps the unlinked archive readable while it
        // streams; and the deletion is awaited before the response is returned,
        // so the working tree is gone by the time a client is answered.
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

        try {
          await fs.promises.rm(ownerDir, { recursive : true, force : true });
        }
        catch (err) {
          // A failed deletion is intentionally swallowed: the archive is already
          // open, so the response is produced whether or not the working tree
          // went away cleanly.
        }

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

      return fs.promises.mkdir(courseDir, { recursive : true })
        .then(mkLessonDirs)
        .then(getMaterialContent)
        .then(parseMaterialContent)
        .then(writeMaterialFiles)
        .then(zipCourse)
        // returnZip resolves with the response, so this chain delivers it.
        .then(returnZip)
        .catch(function(err) {
          // Every step of this chain rejects with a plain Error - fs, mongoose,
          // nunjucks, adm-zip - never with a Boom, so the failure is mapped here
          // to a 500 whose client-visible payload is hapi's generic
          // internal-error body. Returned rather than thrown, which keeps this
          // edge out of the route handler catch-all and its stack logging.
          return errors.badImplementation(err.message);
        });
    }
    else {
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
