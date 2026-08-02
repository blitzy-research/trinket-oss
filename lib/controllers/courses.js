var _           = require('underscore'),
    parseUrl    = require('url').parse,
    diff        = require('diff'),
    util        = require('util'),
    fs          = require('fs'),
    zip         = require('adm-zip'),
    config      = require('config'),
    StringUtils = require('../util/stringUtils'),
    nunjucks    = require('../util/nunjucks'),
    parser      = require('../shared/trinket-markdown.js')({}),
    errors      = require('@hapi/boom'),
    ObjectUtils = require('../util/objectUtils');

module.exports = {
  creationForm : function(request, h) {
    // async conversion - this response was not returned at baseline, so the handler resolved
    // `undefined` and the retired shim recovered it from its deferred capture. The no-argument call
    // is preserved: it answers with only the drained `flash` and `context` keys.
    return request.success();
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
          return request.success({
            course : response.result.course
          });
        }
        else if (response.result.err) {
          // async conversion - not returned at baseline. request.fail answers HTTP 200 with the
          // failure flash, which the browser form handler parses; it is NOT a 409 or a 400.
          return request.fail({
              err     : response.result.err
            , message : response.result.message
          });
        }
      }

      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. When course.createCourse takes its
      // unknown-failure branch it answers with the literal `{}` its own annotation describes, which
      // matches neither test above; a falsy `response.result` misses both as well. R-6 ADJUDICATION:
      // at baseline the handler fell off the end returning `undefined` and the shim's deferred was
      // never settled, so the request hung forever. Once that deferral is retired the same
      // fall-through becomes hapi's own 500. That convergence is unavoidable - the hang cannot be
      // reproduced by any means without the deferral - and no else branch, default response or
      // guard is added, because inventing one would answer requests that no baseline request ever
      // received.
    } catch (err) {
      // async conversion - not returned at baseline. Also HTTP 200, per the note above.
      return request.fail({ err: err, message: err.message });
    }
  },

  getCourses : function(request, h) {
    var roles;

    return request.user.getCourses()
      .then(function(courses) {
        return request.success({ data : courses });
      });
  },

  featuredCourses : function(request, h) {
    return Course.findFeaturedForUser(request.user)
      .then(function(courses) {
        courses = _.map(courses, function(course) {
          // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. `page` carries no declaration, so it is
          // an implicit assignment to the global object - legal only in sloppy mode, and a second
          // independent reason this module can never carry a strict-mode directive or become ESM. As
          // binding is shared, concurrent requests can interleave through it. No var/let/const is
          // added: declaring it would change which requests observe which value.
          page        = course.page;
          course      = ObjectUtils.serialize(course);
          course.page = page || "";

          return course;
        });
        return request.success({ data : courses });
      })
      // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. This handler swallows every rejection and
      // answers HTTP 200 with an empty list rather than surfacing a 500. The error is neither
      // logged, re-thrown nor narrowed, and the unused `error` parameter keeps its baseline name.
      .catch(function(error) {
        return request.success({ data : [] });
      });
  },

  copy : async function(request, h) {
    // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Course#copy (lib/models/course.js) takes an
    // error-first callback and returns nothing at all, so it cannot be awaited directly; the wrapper
    // below is the adapter. Baseline never inspected the callback's `err`, so no `if (err)` guard is
    // added: on failure `course` stays undefined and `course.slug` throws, exactly as before.
    // R-6 ADJUDICATION: at baseline that TypeError was raised inside a callback no promise chain
    // owned, so the shim's deferred was never settled and the request hung; owned by this async
    // function the same throw converges on hapi's own 500. The wrapper also carries no timeout, so
    // the separate hang caused by Course#copy's deliberately unterminated inner chain - which never
    // invokes the callback at all - is reproduced rather than repaired.
    var course = await new Promise(function(resolve) {
      request.pre.course.copy(request.user, function(err, copied) {
        resolve(copied);
      });
    });

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
    return request.success({ classPageUrl : url });
  },

  coursePage : function(request, h) {
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

      // hapi API migration. The synthetic responder's builder discarded the data argument and
      // handed the toolkit redirect straight back, so this is a plain toolkit redirect emitting the
      // default 302 with no explicit status override, and it is deliberately NOT routed through
      // lib/http/redirect.js, whose absolutization applies to route-declaration templates rather
      // than to a redirect issued from inside a handler.
      return h.redirect(url);
    }

    // async conversion - this response was not returned at baseline.
    return request.success({
      courseId   : courseId,
      courseSlug : request.params.courseSlug,
      userSlug   : request.params.userSlug,
      canEdit    : canEdit,
      isAssoc    : isAssoc
    });

  },

  download : function(request, h) {
    var owner  = request.pre.user
      , course = request.pre.course;

    if (request.user.hasRole("course-owner", "course", { id : course.id })
    ||  course.globalSettings.courseType === "public"
    ||  course.globalSettings.courseType === "open"
    ||  request.user.hasPermission("create-private-course")
    ||  request.user.hasPermission("make-course-copy", "course", { id : course.id })) {

      var format    = request.query.format;

      // dependency swap - mkdirp 0.3.5 is INCOMPATIBLE rather than dead: it is still maintained, but
      // 1.x and later are promise-native, which breaks the util.promisify wrapper applied here. The
      // node built-in replaces it under the same name so both call sites stay untouched, and both of
      // them discard the resolved value, so the two implementations' differing resolution values are
      // unobservable. See docs/MIGRATION-DEPENDENCY-INVENTORY.md.
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
        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md. Baseline ignored fs.stat's `err`, so on
        // failure `stats` was undefined and `stats.size` threw inside a callback that no promise
        // chain owned, leaving the shim's deferred unsettled and the request hanging. R-6
        // ADJUDICATION: no `err` check is added; the promise form simply lets that rejection reach
        // the pipeline's .catch below, converging the hang on the 500 that catch already produced.
        var stats  = await fs.promises.stat(zipFile);
        var stream = fs.createReadStream(zipFile);

        // PRESERVED QUIRK - see docs/PRESERVED-QUIRKS.md, and dependency swap: rimraf 2.2.8 is
        // INCOMPATIBLE rather than dead, because 4.x and later dropped the callback form. Baseline's
        // rimraf callback declared no parameters at all, so a cleanup failure was silently ignored
        // and the zip response still fired. The promise form rejects instead, so the rejection is
        // swallowed here to preserve that outcome, and `force : true` matches rimraf's tolerance of
        // a missing path. See docs/MIGRATION-DEPENDENCY-INVENTORY.md.
        try {
          await fs.promises.rm(ownerDir, { recursive : true, force : true });
        }
        catch (cleanupError) {
          // intentionally ignored - see the note above
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
          // hapi API migration. The synthetic responder passed an isBoom value straight through and
          // wrapped a plain Error in Boom.badImplementation; hapi 21 does both itself for a thrown
          // value, so a bare throw is wire-identical - same status, same scrubbed 500 body.
          throw err;
        });
    }
    else {
      // PRESERVED QUIRK - undeclared `Boom` => ReferenceError => scrubbed 500, NOT 403. See
      // docs/PRESERVED-QUIRKS.md. This file binds @hapi/boom as `errors` and never uses it, so
      // evaluating `Boom` throws before `.forbidden` is ever reached. The bare identifier is kept
      // byte-for-byte: adding a require, or reaching for the unused `errors` binding, would turn the
      // measured 500 into a 403 - a prohibited behaviour change and an error-mapping violation.
      throw Boom.forbidden();
    }
  }
};
