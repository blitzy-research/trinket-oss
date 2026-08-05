var _           = require('underscore'),
    diff        = require('diff'),
    fs          = require('fs'),
    zip         = require('adm-zip'),
    config      = require('config'),
    StringUtils = require('../util/stringUtils'),
    nunjucks    = require('../util/nunjucks'),
    parser      = require('../shared/trinket-markdown.js')({}),
    errors      = require('@hapi/boom'),
    ObjectUtils = require('../util/objectUtils');

module.exports = {
  creationForm : async function(request, h) {
    // The no-argument call is preserved: it answers with only the drained `flash` and `context` keys.
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
          return h.respond({
            course : response.result.course
          });
        }
        else if (response.result.err) {
          // The failure responder answers HTTP 200 with the failure flash, which the browser form
          // handler parses; it is NOT a 409 or a 400.
          return h.reject({
              err     : response.result.err
            , message : response.result.message
          });
        }
      }

      // PRESERVED QUIRK: a falsy `response.result`, or a result matching neither test above, answers
      // NO RESPONSE AT ALL. `h.abandon` is hapi's own no-response outcome and reproduces it; falling
      // through would resolve `undefined` and answer 500, a status this branch never produced. No
      // else branch, default response or guard is added. See docs/PRESERVED-QUIRKS.md section 1.15.
      return h.abandon;
    } catch (err) {
      // Also HTTP 200, per the note above.
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

    // Course#copy is promise-native and is called as a method, so `this` is the course document it
    // reads `this.name`, `this.description` and `this.globalSettings` from.
    //
    // PRESERVED QUIRK: a copy failure answers NOTHING on this route. Course#copy has TWO failure
    // channels - its first save reports the failure directly, and its inner lesson/material chain
    // settles with the silent-outcome sentinel - and this handler intentionally abandons BOTH,
    // unlike lib/controllers/course.js#copyCourse, which keeps them apart for a duplicate-name
    // branch. The one catch below is therefore the whole translation: no per-channel branch and no
    // timeout may be added, and rethrowing would answer a 500 this branch never produced.
    // See lib/models/model.js#silentOutcome and docs/PRESERVED-QUIRKS.md sections 1.15 and 3.40.
    try {
      course = await request.pre.course.copy(request.user);
    }
    catch (copyErrorTheBaseCallbackIgnored) {
      return h.abandon;
    }

    if (!course) {
      // The measured effect of baseline's unguarded `course.slug` dereference: nothing is answered.
      // This is NOT an error response and NOT a repair - `h.reject` here would invent an HTTP 200
      // failure payload that no baseline request on this branch ever received.
      return h.abandon;
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

    // The route declares success.redirect '{classPageUrl}', so the responder - not this handler -
    // issues the redirect.
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
      var writeFile = fs.promises.writeFile;

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

        // PRESERVED QUIRK: a stat failure here answers NOTHING - letting the rejection reach the
        // pipeline's .catch below would answer a scrubbed 500 this branch never produced - and the
        // directory cleanup still runs first, so the filesystem side effects match. The two
        // process-level faults this path used to carry, an unlistened stream 'error' and an uncaught
        // exception, are deliberately not reproduced; the per-request outcome is identical.
        // See docs/PRESERVED-QUIRKS.md.
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

          return h.abandon;
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
          return h.abandon;
        }

        // The chain order is preserved, and the read stream is still created synchronously - the
        // helper returns the response it built rather than answering out of band.
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
