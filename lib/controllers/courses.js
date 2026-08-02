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
    Pending     = require('../http/pending'),
    ObjectUtils = require('../util/objectUtils');

module.exports = {
  creationForm : async function(request, h) {
    // async conversion - this response was not returned at baseline, so the handler resolved
    // `undefined` and the retired shim recovered it from its deferred capture. The no-argument call
    // is preserved: it answers with only the drained `flash` and `context` keys.
    return h.respond();
  },

  create : async function(request, h) {
    try {
      var response = await request.server.inject({
        url     : '/api/courses',
        method  : 'post',
        headers : {
          'content-type' : 'application/json',
          'accept'       : 'application/json'
        },
        payload : request.payload,
        auth    : {
          strategy    : 'session',
          credentials : request.auth.credentials
        }
      });

      if (response.result) {
        if (response.result.course) {
          // async conversion - not returned at baseline.
          return h.respond({
            course : response.result.course
          });
        }
        else if (response.result.err) {
          // async conversion - not returned at baseline. The failure responder - `h.reject` here,
          // spelled `request.fail` at the base commit - answers HTTP 200 with the failure flash,
          // which the browser form handler parses; it is NOT a 409 or a 400.
          return h.reject({
              err     : response.result.err
            , message : response.result.message
          });
        }
      }

      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md section 1.15. When course.createCourse takes
      // its unknown-failure branch it answers with the literal `{}` its own annotation describes,
      // which matches neither test above; a falsy `response.result` misses both as well. At the base
      // commit the handler then fell off its end returning `undefined`, the shim's deferred capture
      // was never settled, and the request received NO RESPONSE AT ALL - MEASURED over real HTTP on
      // @hapi/hapi 20.3.0 for both a falsy `response.result` and a result carrying neither key.
      //
      // That outcome is reproduced rather than converged: a never-settling return leaves this one
      // request unanswered while every other route is served normally. Falling through instead would
      // resolve `undefined` and make hapi answer 500 - a status this branch never produced. No else
      // branch, default response or guard is added, because inventing one would answer requests that
      // no baseline request ever answered.
      return Pending.forever();
    } catch (err) {
      // async conversion - not returned at baseline. Also HTTP 200, per the note above.
      return h.reject({ err: err, message: err.message });
    }
  },

  getCourses : async function(request, h) {
    var roles;

    return request.user.getCourses()
      .then(function(courses) {
        return h.respond({ data : courses });
      });
  },

  featuredCourses : async function(request, h) {
    return Course.findFeaturedForUser(request.user)
      .then(function(courses) {
        courses = _.map(courses, function(course) {
          // `page` carries no declaration, so it is an implicit assignment to the global object -
          // legal only in sloppy mode, and a shared binding that concurrent requests interleave
          // through. Do not add var/let/const: declaring it changes which request sees which value.
          page        = course.page;
          course      = ObjectUtils.serialize(course);
          course.page = page || "";

          return course;
        });
        return h.respond({ data : courses });
      })
      // This handler swallows every rejection and answers HTTP 200 with an empty list rather
      // than a 500. The error is deliberately neither logged, re-thrown nor narrowed.
      .catch(function(error) {
        return h.respond({ data : [] });
      });
  },

  copy : async function(request, h) {
    var course;

    // Async conversion: Course#copy (lib/models/course.js:L298) is a genuine error-first callback
    // API - `cb(null, doc)` on success, single-argument `cb(err)` on failure - so util.promisify is
    // behavior-equivalent and replaces the hand-written bridge this handler used to carry. `.call`
    // supplies the receiver because copy() reads `this.name`, `this.description` and
    // `this.globalSettings`.
    //
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The base commit's callback IGNORED its `err`
    // argument and went straight on to read `course.slug`, so a copy failure raised a TypeError
    // inside the rejection handler of Course#copy's own first `course.save().then(ok, err)` - a
    // chain that module never returns or catches. Nothing was awaiting it, the shim's deferral was
    // never settled, and the request answered NOTHING. Rethrowing here would answer a scrubbed 500
    // that no base request on this branch ever received, so the pending fate is restored.
    //
    // R-6 ADJUDICATION: only the HTTP half is reproduced. At base that orphaned TypeError surfaced
    // as an unhandled promise rejection, which on Node 22 terminates the process by default;
    // deliberately crashing a shared server is not an implementable route behavior, and the finding
    // asks for the pending fate rather than for the crash. The observable per-request outcome - the
    // client never receives a response - is identical.
    //
    // There is deliberately no timeout, and none may be added: Course#copy's inner chain is left
    // unterminated on purpose (lib/models/course.js:L346-L348), so a rejection from Lesson.findById
    // or lesson.copy never reaches the callback at all and the promise simply never settles. That
    // second, distinct hang is preserved by the same absence of a timeout.
    try {
      course = await util.promisify(request.pre.course.copy).call(request.pre.course, request.user);
    }
    catch (copyErrorTheBaseCallbackIgnored) {
      return Pending.hang();
    }

    if (!course) {
      // The measured effect of baseline's unguarded `course.slug` dereference: nothing is answered.
      // This is NOT an error response and NOT a repair - `h.reject` here would invent an HTTP 200
      // failure payload that no baseline request on this branch ever received.
      return Pending.forever();
    }

    var urlTemplate = (config.app.usersubdomains)
      ? '//{user}.{domain}/{course}'
      : '//{domain}/u/{user}/classes/{course}';

    var url = StringUtils.interpolate(urlTemplate, {
      user:   request.user.username,
      domain: config.app.url.hostname,
      course: course.slug
    });

    await request.user.grant("course-owner", "course", { id : course.id });

    // async conversion - not returned at baseline. The route declares success.redirect
    // '{classPageUrl}', so the responder - not this handler - issues the redirect.
    return h.respond({ classPageUrl : url });
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

      // A plain toolkit redirect emitting the default 302. It is deliberately not routed through
      // lib/http/redirect.js, whose absolutization applies to route-declaration templates rather
      // than to a redirect issued from inside a handler.
      return h.redirect(url);
    }

    // async conversion - this response was not returned at baseline.
    return h.respond({
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

      var mkdirpify = function(dir) { return fs.promises.mkdir(dir, { recursive : true }); };
      var writeFile = util.promisify(fs.writeFile);

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
              return mkdirpify(lessonDir)
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
          return writeFile(file.writeTo, file.content);
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
        var stats;

        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. The base commit wrote
        // `fs.stat(zipFile, function (err, stats) { ... rimraf(ownerDir, function () { return
        // reply(stream).type(...).bytes(stats.size)... }); });` and IGNORED `err`. On a stat failure
        // `stats` was undefined, so `stats.size` raised a TypeError inside rimraf's callback - an
        // orphaned position no promise chain owned - and the shim's deferral was never settled: the
        // request answered NOTHING. Letting the rejection reach the pipeline's .catch below would
        // answer a scrubbed 500 that no base request on this branch ever received, so the pending
        // fate is restored, and the cleanup that base had already performed before throwing is
        // performed here too so the filesystem side effects match.
        //
        // R-6 ADJUDICATION: two base side effects on this failure path are deliberately NOT
        // reproduced, because neither is an HTTP outcome and each is a process-level fault. Base
        // called fs.createReadStream on the file whose stat had just failed, whose asynchronous
        // 'error' event had no listener, and base's orphaned TypeError was an uncaught exception -
        // on Node 22 either one terminates the process. Crashing a shared server is not an
        // implementable route behavior; the observable per-request outcome, no response, is identical.
        try {
          stats = await fs.promises.stat(zipFile);
        }
        catch (statErrorTheBaseCallbackIgnored) {
          try {
            await fs.promises.rm(ownerDir, { recursive : true, force : true });
          }
          catch (cleanupError) {
            // intentionally ignored - base's rimraf callback declared no parameters at all
          }

          return Pending.hang();
        }

        var stream = fs.createReadStream(zipFile);

        // A cleanup failure is deliberately swallowed so the zip response still fires, and
        // `force : true` tolerates a missing path.
        try {
          await fs.promises.rm(ownerDir, { recursive : true, force : true });
        }
        catch (cleanupError) {
          // intentionally ignored - see the note above
        }

        if (!stats) {
          // The measured effect of baseline's unguarded `stats.size` dereference, raised only after
          // the cleanup above had already run: nothing is answered. No error response is invented.
          return Pending.forever();
        }

        // hapi API migration. .header() was a resolving terminator in the synthetic builder while
        // .type() and .bytes() were not, so this genuinely responded at baseline; the chain order is
        // preserved regardless, since the native toolkit applies each call to the response it is
        // handed. The helper now returns that response - baseline returned nothing and relied on the
        // deferred capture - and the read stream is still created synchronously.
        return h.response(stream)
          .type('application/zip')
          .bytes(stats.size)
          .header('Content-Disposition', 'attachment; filename=' + course.slug + '.zip');
      }

      return mkdirpify(courseDir)
        .then(mkLessonDirs)
        .then(getMaterialContent)
        .then(parseMaterialContent)
        .then(writeMaterialFiles)
        .then(zipCourse)
        .then(returnZip)
        .catch(function(err) {
          throw err;
        });
    }
    else {
      // `Boom` is declared nowhere in this file - the requires above bind @hapi/boom as `errors`,
      // which is never used - so evaluating it raises `ReferenceError: Boom is not defined` and
      // this denial answers a scrubbed HTTP 500, never a 403. Keep the bare identifier: adding a
      // require, or reaching for the `errors` binding, would change the error mapping.
      throw Boom.forbidden();
    }
  }
};
