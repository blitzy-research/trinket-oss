// `url` (formerly bound here as `parseUrl`) and `@hapi/hapi` (formerly `Hapi`)
// are deliberately NOT required by this module.
//
// The `@hapi/hapi` removal is load-bearing rather than cosmetic. A transitive
// dependency of `mongoose-schema-extend` installs a Proxy polyfill that
// replaces the global `Object.getPrototypeOf`; once that has happened, a later
// require of the hapi package throws `Schema can only contain plain objects`
// from @hapi/validate's compile step. `config/app.config` requires this controller
// while parsing routes, so an unused hapi require here is enough to make
// `lib/workers/exports.js` - which loads `config/db` before `config/app.config`
// - unrequirable. `app.js` holds the one legitimate hapi require.
var _           = require('underscore'),
    diff        = require('diff'),
    // Retained although this module no longer calls it: `util.promisify` was
    // this file's only consumer and its two call sites are now native
    // fs/promises calls. Dropping the binding is not one of the changes this
    // migration is scoped to make, so the declaration stays as it was.
    util        = require('util'),
    fs          = require('fs'),
    zip         = require('adm-zip'),
    config      = require('config'),
    StringUtils = require('../util/stringUtils'),
    nunjucks    = require('../util/nunjucks'),
    parser      = require('../shared/trinket-markdown.js')({}),
    errors      = require('@hapi/boom'),
    ObjectUtils = require('../util/objectUtils'),
    // Shared course-creation core, extracted so that `create` below no longer
    // re-enters `POST /api/courses` through `server.inject` (which puts DEP0169
    // on the live request path via @hapi/shot).
    courseCtrl  = require('./course');

module.exports = {
  creationForm : async function(request, h) {
    return request.success();
  },

  // This handler used to serve `POST /courses` by re-entering `POST /api/courses`
  // through `request.server.inject`. The injection is gone because @hapi/shot
  // emits DEP0169 for every injected request, which put a deprecation warning on
  // the live request path. The remediation is an extraction rather than one
  // handler calling another: the API route's JSON negotiation, validation,
  // pre-handler context, `replySpec` projection and error mapping belong to THAT
  // route's contract and cannot be borrowed. `course.createCourseCore` therefore
  // performs the shared work, and this handler applies its own projection and
  // its own error mapping, exactly as `course.createCourse` applies its own.
  //
  // VALIDATION DELTA (measured, recorded rather than compensated for): the
  // injected request was validated by `POST /api/courses`, whose payload block
  // is `name: Joi.string().max(140).required()` plus the same description and
  // enum rules. This route's own block (config/routes.js) is that same set with
  // `min(1)` ADDED, so the API's block is a strict subset and contributed
  // nothing this route did not already enforce. Removing the injection therefore
  // leaves this path no less strict than baseline, and adding any compensating
  // validation here would itself be a behaviour change.
  create : async function(request, h) {
    var course;

    try {
      // T-3: the promise boundary is created here, at the lifecycle method's own
      // call site. The core resolves with the saved course document - the same
      // value the injected API handler had projected into `response.result.course`.
      //
      // Unlike course.createCourse, this handler calls the core INSIDE the try,
      // and the difference is measured rather than stylistic. The core's
      // synchronous section ran inside the INJECTED request at baseline, so a
      // throw from it was answered by that request's own catch-all: the injected
      // response became a 500 Boom whose payload carries neither `course` nor
      // `err`, this handler fell past both branches, and the page request was
      // never answered. Catching it here reaches the same outcome, because the
      // catch below preserves that non-response for every non-duplicate failure.
      course = await courseCtrl.createCourseCore(request.payload, request.user);
    }
    catch (err) {
      // The in-band `{err, message}` object that the injected response used to
      // carry is now a thrown error, so the branch that read `response.result.err`
      // lives here. Baseline reached that branch for exactly one shape: a
      // duplicate course name, which the API handler mapped to this message
      // before returning it in-band, and which this handler then re-flashed. The
      // message is client-visible - it is flashed as `failure` and rendered on
      // /courses/new - so it is reproduced verbatim rather than replaced by the
      // raw driver text.
      if (err.code === 11000) {
        return request.fail({
            err     : err
          , message : "You already have a course with this name. Please choose another."
        });
      }

      // PRESERVED BASELINE (measured): every other failure leaves this request
      // NEVER ANSWERED. Baseline awaited `server.inject` of POST /api/courses,
      // and that route's own unknown-failure branch resolved nothing, so the
      // injected response never arrived, the `await` never settled and the page
      // request hung. The injection is gone, but the outcome it produced is not
      // this handler's to change: R-d and T-6 require it to be reproduced, and
      // no approved deviation covers this branch.
      //
      // The pending promise IS that outcome. A fall-through would not be: hapi
      // turns an `undefined` lifecycle return into Boom.badImplementation
      // (node_modules/@hapi/hapi/lib/toolkit.js:80-81), answering 500 where
      // baseline answered nothing. Not building `err.message` into a response is
      // also what keeps raw driver and model detail out of the `failure` flash
      // that /courses/new renders.
      return new Promise(function() {});
    }

    if (course) {
      // Serialized before it is handed over because that is what baseline handed
      // over: the API side had already run `ObjectUtils.serialize` on the
      // document, and this route's `request.success` then serialized the result a
      // SECOND time. The second pass is not a no-op - it drops null-valued keys -
      // so passing the raw document would change the JSON body of an
      // `Accept: application/json` request. Passing the serialized form
      // reproduces the baseline payload exactly.
      return request.success({
        course : ObjectUtils.serialize(course)
      });
    }

    // PRESERVED BASELINE (do not add an `else` here): when the injected response
    // carried neither a course nor an error, baseline signalled nothing at all
    // and the request never settled. The falsy-course path keeps that outcome -
    // no invented status, no synthesized payload - and the pending promise is
    // what implements it. Falling through instead would NOT preserve it: hapi
    // converts an `undefined` lifecycle return into Boom.badImplementation
    // (node_modules/@hapi/hapi/lib/toolkit.js:80-81), so the framework's own
    // missing-return handling would answer 500 where baseline answered nothing.
    return new Promise(function() {});
  },

  // The chain is returned and its `.then` already returns the response, so this
  // handler needs nothing but its new signature. It has no `.catch` and none is
  // added: a rejection here propagates to the handler catch-all and answers 500,
  // which is exactly what it did before.
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
          // `page` is deliberately left undeclared. It has always been an
          // implicit global assignment, and while it is a leak, removing it is
          // not one of the changes this migration is scoped to make - the
          // variable is read back on the next line, so the behaviour is
          // unchanged either way and the leak is baseline behaviour.
          page        = course.page;
          course      = ObjectUtils.serialize(course);
          course.page = page || "";

          return course;
        });
        return request.success({ data : courses });
      })
      // PRESERVED: every failure - including a database error - is swallowed into
      // an empty list, with no logging and no error response. `error` is unused
      // on purpose. This is baseline behaviour and is not "improved" into a 500.
      .catch(function(error) {
        return request.success({ data : [] });
      });
  },

  copy : async function(request, h) {
    // T-3/I-2: the promise boundary for this callback API is created HERE, at the
    // lifecycle method's own call site, and the model keeps its callback
    // interface. The whole body stays INSIDE that callback, exactly where
    // baseline put it, because that is what decides where a failure surfaces.
    // The step order is unchanged - the copy completes, then the URL is
    // interpolated, then the role is granted, then the response is produced.
    //
    // The error argument is deliberately NOT inspected, exactly as before. The
    // model calls back with no document when its first save fails
    // (lib/models/course.js:316), so the interpolation below then throws a
    // TypeError reading `slug` of undefined, and THAT is the failure being
    // preserved: rejecting on `err` instead would substitute the model's own
    // error for it and change which failure the route reports.
    //
    // PRESERVED BASELINE (measured): that TypeError is thrown inside the model's
    // own save callback (the `copy` method calls back from there), and no request
    // lifecycle can route it. Mongoose wraps a save callback in
    // `Model.$handleCallbackError` (node_modules/mongoose/lib/model.js:5402-5419),
    // catches the throw and re-emits it as an 'error' event on the model; nothing
    // listens for that event, or for 'uncaughtException', so the process
    // terminates and the request is NEVER ANSWERED. Keeping the interpolation in
    // this frame keeps it that way; hoisting it into the handler frame would
    // reject the handler and answer 500 instead, which no approved deviation
    // covers (R-d, T-6).
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

        // The grant chain was returned into this callback at baseline, which
        // discards it, so it was detached: a rejecting grant produced an
        // unhandled rejection and no response. It therefore carries no `.catch`
        // and nothing connected to a rejection path - only its success path
        // settles the handler, with the response `request.success` builds.
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

      // `url` is already fully qualified - it was built above from
      // `config.app.url.protocol` and a protocol-relative template - and the
      // shim's `.redirect` handed exactly this string to the toolkit with no
      // base-URL prefixing of its own. Passing it through unchanged keeps the
      // Location header byte-for-byte identical.
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

      // T-5: the two promisified callback wrappers this handler used to build -
      // `util.promisify(mkdirp)` and `util.promisify(fs.writeFile)` - are now the
      // native fs/promises functions, used directly at their call sites below.
      // The `mkdirp` package is not merely bumped but removed: mkdirp 1+ returns
      // a promise natively, so `util.promisify` would have wrapped a
      // promise-returning function and the callback would never have fired.
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
        // The ordering here is load-bearing and is preserved step for step: stat
        // the archive, THEN open the read stream, THEN delete the working
        // directory, and only then answer. Baseline nested those three as
        // callbacks and produced its response from the innermost one, so
        // collapsing any of them into an earlier await would change when the
        // response is produced relative to the deletion.
        //
        // T-5 keeps the promise form of `stat`, and the PRESERVED BASELINE
        // disposition of its failure is restored here. Baseline passed `fs.stat`
        // a callback that never checked `err`, so a failed stat left `stats`
        // undefined and `stats.size` threw a TypeError inside an fs callback
        // frame: uncaught, unroutable, and with no response ever produced. A bare
        // `await` instead sends the rejection to this chain's `.catch`, which
        // answers 500 - a served outcome baseline never produced, and one no
        // approved deviation covers (R-d, R-e, T-6).
        //
        // So the identical TypeError is raised from a detached frame, where no
        // request lifecycle can catch it (this application installs no
        // `uncaughtException` handler, so it terminates the process exactly as
        // the fs callback throw did), and the handler returns a promise that
        // never settles so the request stays unanswered.
        //
        // The failure is raised at the point baseline reached it, not at the stat:
        // baseline's callback carried on past the unchecked `err`, opened the read
        // stream and deleted the working directory, and only threw once the
        // innermost `rimraf` callback read `stats.size`. So the two side effects
        // still happen on this edge and the throw still comes after them, which is
        // what keeps a failed stat from leaving the working directory behind. The
        // edge is unreachable in practice: the archive is written synchronously
        // immediately above.
        var stats
          , statFailed = false;

        try {
          stats = await fs.promises.stat(zipFile);
        }
        catch (statErr) {
          // `err` is not inspected, exactly as baseline did not inspect it.
          statFailed = true;
        }

        var stream = fs.createReadStream(zipFile);

        try {
          await fs.promises.rm(ownerDir, { recursive : true, force : true });
        }
        catch (err) {
          // Swallowed exactly as the empty `rimraf(ownerDir, function() {...})`
          // callback swallowed it: baseline waited for the deletion to finish and
          // then answered regardless of its outcome.
        }

        if (statFailed) {
          process.nextTick(function() {
            // `stats` is undefined here, so this is the same
            // "Cannot read properties of undefined (reading 'size')" TypeError
            // baseline raised inside the rimraf callback, from a frame the
            // lifecycle cannot see.
            void stats.size;
          });

          return new Promise(function() {});
        }

        // Baseline built this response through the compatibility shim, where
        // `.header()` was the call that resolved the deferred - so the response a
        // client received came out of the innermost callback while `returnZip`
        // itself returned undefined. The toolkit builds the identical response
        // directly, and it is now RETURNED so the chain below carries it out of
        // the handler: same stream, same content type, same byte count, same
        // Content-Disposition.
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
        // returnZip resolves with the response, so the chain - which this
        // handler returns - is what delivers it. The step order is unchanged.
        .then(returnZip)
        .catch(function(err) {
          // Measured equivalent of the shim's `reply(err)`: an Error became
          // `Boom.badImplementation(err.message)`, a 500 whose client-visible
          // payload is hapi's generic internal-error body, and the shim logged
          // nothing here. Returned rather than thrown, because the preserved
          // handler catch-all rewrites a thrown value and would also log a stack
          // trace this edge never produced. Every step of this chain rejects with
          // a plain Error (fs, mongoose, nunjucks, adm-zip), never with a Boom.
          return errors.badImplementation(err.message);
        });
    }
    else {
      // PRESERVED BASELINE DEFECT - this branch answers 500, NOT 403, and that is
      // deliberate. `Boom` is not bound in this module and never has been: the
      // only @hapi/boom binding here is `errors` (top of file), and the bare
      // identifiers that do resolve at runtime (Course, Lesson, Material, User)
      // resolve because app.js assigns them as implicit globals - `Boom` is not
      // among them. Evaluating this expression therefore throws a ReferenceError
      // before any response is constructed, which rejects this handler and is
      // mapped by the preserved handler catch-all to a 500 carrying hapi's
      // generic internal-error payload. For a browser request the error extension
      // renders 50x.html and returns before the cache-control writes, so that
      // response carries no Cache-Control/Pragma/Expires; an API/JSON request
      // receives the JSON Boom with them.
      //
      // Binding `Boom`, or rewriting this to `errors.forbidden()`, would turn the
      // 500 into the 403 the author evidently intended. That is a behaviour
      // change, an error-mapping change, and a kind of change this migration is
      // not scoped to make - so the unbound reference is kept and only the
      // callback-era `reply(` wrapper around it is dropped.
      //
      // Dropping that wrapper is what preserves the failure IDENTITY, and is not
      // cosmetic. `reply` was the shim's bound second argument at baseline, so
      // evaluation reached the argument and raised
      // ReferenceError('Boom is not defined'), which is what the Layer 1
      // catch-all logged. In the converted `(request, h)` signature `reply` is
      // itself unbound, and JavaScript resolves the callee before the argument,
      // so keeping the wrapper raised ReferenceError('reply is not defined')
      // instead: the same 500 to the client, but a different logged error and
      // stack, and the last executable callback-era `reply(` call left in the
      // conversion set. Returning the bare expression restores the baseline
      // identity and matches the form every one of the sibling sites in
      // lib/controllers/course.js already uses.
      return Boom.forbidden();
    }
  }
};
