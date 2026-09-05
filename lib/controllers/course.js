var config = require('config'),
    errors = require('@hapi/boom'),
    _      = require('underscore'),
    moment = require('moment'),
    ObjectUtils = require('../util/objectUtils'),
    mailer = require('../util/mailer'),
    validator = require('validator');

// The address verdict the invitation flow below depends on.
//
// `CourseInvitation` persists that verdict: `addList` stores `status: "invalid"`
// for an address it rejects and leaves an accepted one pending, and
// `updateEmail` stores "resend" or "invalid". The stored value decides whether
// an invitation is ever mailed, so the verdict is part of the invitation
// contract rather than an input check.
//
// `validator` answers that question, and three classes of address answer
// differently across its releases: a gmail local part with consecutive dots
// (`foo..bar@gmail.com`), a local part containing U+00A0, and an address of 255
// characters. `isEmail` below is the contract this application requires, and it
// is installed on the shared `validator` export because the model that calls it
// resolves the same module object; `isByteLength`, whose answer does not vary,
// is delegated to the package.
//
// The address is the only thing this replaces: `validator`'s other exports are
// untouched, and `isEmail` has no other consumer in the application.
var quotedEmailUserUtf8 = /^([\s\x01-\x08\x0b\x0c\x0e-\x1f\x7f\x21\x23-\x5b\x5d-\x7e\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]|(\\[\x01-\x09\x0b\x0c\x0d-\x7f\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))*$/i;
var emailUserUtf8Part = /^[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+$/i;
var fqdnTld = /^([a-z\u00a1-\uffff]{2,}|xn[a-z0-9-]{2,})$/i;
var fqdnPart = /^[a-z\u00a1-\uffff0-9-]+$/i;
var fqdnFullWidth = /[\uff01-\uff5e]/;

// True when `str` is a fully-qualified domain name: at least one label before a
// TLD of two or more letters, or a punycode `xn` prefix. The rules run in this
// order because the order decides which rule rejects a given domain, and a
// trailing dot or an underscore is not admitted.
function isFullyQualifiedDomain(str) {
  var parts = str.split('.');
  var tld = parts.pop();
  var part;
  var i;

  if (!parts.length || !fqdnTld.test(tld)) {
    return false;
  }

  for (i = 0; i < parts.length; i++) {
    part = parts[i];

    if (!fqdnPart.test(part)) {
      return false;
    }

    // Full-width characters are rejected outright, though the label class above
    // would otherwise admit them.
    if (fqdnFullWidth.test(part)) {
      return false;
    }

    if (part[0] === '-' || part[part.length - 1] === '-') {
      return false;
    }
  }

  return true;
}

// True when `str` is a valid address. The gmail fold happens BEFORE the local
// part is length-checked or pattern-matched, which is why `foo..bar@gmail.com`
// is accepted while `foo..bar@example.com` is not. A non-string input throws
// rather than returning false; neither invitation path can reach that, because
// both lower-case the value first.
function isEmail(str) {
  var parts;
  var domain;
  var user;
  var lowerDomain;
  var userParts;
  var i;

  if (typeof str !== 'string') {
    throw new TypeError('This library (validator.js) validates strings only');
  }

  // Split on the LAST '@', so an address containing several keeps the earlier
  // ones in its local part, where the pattern check below rejects them.
  parts = str.split('@');
  domain = parts.pop();
  user = parts.join('@');

  lowerDomain = domain.toLowerCase();

  // Gmail itself treats dots in a local part as insignificant, so a local part
  // that would otherwise be rejected for consecutive or leading dots is
  // accepted for these two domains.
  if (lowerDomain === 'gmail.com' || lowerDomain === 'googlemail.com') {
    user = user.replace(/\./g, '').toLowerCase();
  }

  // The two parts are bounded separately and the address as a whole carries no
  // ceiling, which is what admits a 255-character address.
  if (!validator.isByteLength(user, { max: 64 }) ||
      !validator.isByteLength(domain, { max: 256 })) {
    return false;
  }

  if (!isFullyQualifiedDomain(domain)) {
    return false;
  }

  // A quoted local part is validated as one unit once the surrounding quotes
  // are removed. Only a leading quote is required, so `"foo@example.com` takes
  // this branch and has its first and last characters stripped.
  if (user[0] === '"') {
    user = user.slice(1, user.length - 1);
    return quotedEmailUserUtf8.test(user);
  }

  // Otherwise every dot-separated label of the local part must match on its
  // own. The pattern requires at least one character, so an empty label - what
  // a leading, trailing or doubled dot produces - fails, which is why the gmail
  // fold above changes the verdict.
  userParts = user.split('.');

  for (i = 0; i < userParts.length; i++) {
    if (!emailUserUtf8Part.test(userParts[i])) {
      return false;
    }
  }

  return true;
}

validator.isEmail = isEmail;

// Applies a unified diff to `oldStr` with jsdiff 1.0.8 semantics, which is the
// dialect the course editor speaks: config/default.yaml pins the editor's client
// library to jsdiff 1.0.8, and public/js/courseEditor/controllers/materialControl.js
// strips the `Index:` header before PUTting the hunks, so both a header-bearing
// patch and a bare hunk list parse here.
//
// Returns the patched string, or the boolean `false` when a hunk's context or
// removal lines do not match `oldStr`. That `false` is the stale-page signal
// `updateMaterial` tests for with `===` below: it is how an edit computed against
// content that has since changed in another window is refused rather than applied
// on top of the newer content.
//
// Three shapes look like defects and are deliberate, because material content is
// persisted through this function and any change to them rewrites saved text. A
// hunk header the regex does not match leaves `start` and `oldlength` undefined,
// so the hunk's context is fabricated rather than verified and the hunk applies
// to an empty document - which is what lets the first content written into an
// empty material keep its exact line breaks. `start` and `oldlength` stay strings
// and are coerced at each use. And hunks are read in reverse and applied in
// descending order against the array as earlier hunks already mutated it, so a
// later hunk's offsets are not adjusted for an earlier edit.
//
// It is not defensive, and must not become so: a malformed or non-string
// `uniDiff` throws a TypeError synchronously, and the patch branch relies on that
// throw reaching the route catch-all through its own promise `.catch`.
//
// e.g. applyLegacyPatch('', '@@ -1,0 +1,1 @@\n+new\n')          -> 'new\n'
//      applyLegacyPatch('hello\n', '@@ -1,1 +1,0 @@\n-hello\n') -> ''
//      applyLegacyPatch('other\n', '@@ -1,1 +1,0 @@\n-hello\n') -> false
function applyLegacyPatch(oldStr, uniDiff) {
  var diffstr = uniDiff.split('\n');
  var diff = [];
  var remEOFNL = false,
      addEOFNL = false;

  // A first line of 'Index: <file>' means the four-line header is present and is
  // skipped. Indexing character 0 of an empty line yields undefined rather than
  // throwing, so an empty patch and the bare '\n' the editor sends when nothing
  // changed both parse to zero hunks and return `oldStr` unchanged.
  for (var i = (diffstr[0][0] === 'I' ? 4 : 0); i < diffstr.length; i++) {
    if (diffstr[i][0] === '@') {
      var meh = diffstr[i].split(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);

      // `start` is the NEW-file start while `oldlength` is the OLD-file length:
      // the pairing is mismatched on purpose, and it is what makes a hunk splice
      // at the right place in an empty document. `unshift` reverses hunk order,
      // which the apply loop below undoes by counting down.
      diff.unshift({
        start     : meh[3],
        oldlength : meh[2],
        oldlines  : [],
        newlength : meh[4],
        newlines  : []
      });
    }
    // Additions and removals are collected into separate lists, so a hunk that
    // emits its `+` lines before its `-` lines applies the same as one in the
    // canonical order - which is the order the pinned editor produces.
    else if (diffstr[i][0] === '+') {
      diff[0].newlines.push(diffstr[i].substr(1));
    }
    else if (diffstr[i][0] === '-') {
      diff[0].oldlines.push(diffstr[i].substr(1));
    }
    else if (diffstr[i][0] === ' ') {
      diff[0].newlines.push(diffstr[i].substr(1));
      diff[0].oldlines.push(diffstr[i].substr(1));
    }
    else if (diffstr[i][0] === '\\') {
      // '\ No newline at end of file' is attributed from the PREVIOUS patch
      // line: after a '+' the new file has no trailing newline, after a '-' the
      // old file had none.
      if (diffstr[i - 1][0] === '+') {
        remEOFNL = true;
      }
      else if (diffstr[i - 1][0] === '-') {
        addEOFNL = true;
      }
    }
  }

  var str = oldStr.split('\n');

  for (var h = diff.length - 1; h >= 0; h--) {
    var d = diff[h];

    for (var j = 0; j < d.oldlength; j++) {
      if (str[d.start - 1 + j] !== d.oldlines[j]) {
        return false;
      }
    }

    Array.prototype.splice.apply(str, [d.start - 1, +d.oldlength].concat(d.newlines));
  }

  if (remEOFNL) {
    // Every falsy trailing element is popped, not just one, so a result ending
    // in blank lines loses all of them when the new file carries no trailing
    // newline.
    while (!str[str.length - 1]) {
      str.pop();
    }
  }
  else if (addEOFNL) {
    str.push('');
  }

  // `join` adds no trailing newline of its own: the empty trailing element that
  // `split('\n')` produces for newline-terminated content is what restores it.
  return str.join('\n');
}

module.exports = {
  createCourse : async function(request, h) {
    var course
      , pendingCourse;

    // The `courseType` a caller may ask for is deliberately NOT checked here.
    // `create-private-course` is a site permission (lib/models/roles.js:19-20)
    // and the two places this application consults it are `copyCourse` below
    // and `courses.coursePage`, both of which use it to decide what an existing
    // course may be used for. Creation has never consulted it, so a `private`
    // course requested by an account without the permission is created exactly
    // as a public one is: that is the behaviour this route has, and it is
    // preserved rather than tightened.
    //
    // T-3: the await boundary for the model layer is created HERE, at the
    // lifecycle method's own call site. createCourseCore performs the same
    // sequence the save callback used to wrap, and resolves with the saved
    // document - which is what the callback's shadowing `course` bound.
    //
    // The core is CALLED outside the try and only AWAITED inside it, and that
    // split is load-bearing. createCourseCore is intentionally not an `async`
    // function, so its synchronous section - `new Course(payload)`, setOwner,
    // ownerSlug, setGlobalSettings - throws here, past this handler's catch, and
    // reaches the route handler catch-all in lib/util/routeParser.js, which
    // answers 500. The catch below therefore sees only the save's rejection.
    pendingCourse = module.exports.createCourseCore(request.payload, request.user);

    try {
      course = await pendingCourse;
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
      // This request is intentionally never answered, and the never-settling
      // promise is what leaves it that way: falling through would resolve
      // `undefined`, which hapi turns into Boom.badImplementation and answers
      // 500. The handler timer in lib/util/routeParser.js only logs that the
      // handler is still running; it settles nothing. The driver's error is not
      // built into any value, which keeps model detail out of the response and
      // out of the flash.
      return new Promise(function() {});
    }

    return request.success({ course : course });
  },

  getCourse : async function(request, h) {
    var course     = request.pre.course
      , checkDates = false
      , lessonsPopulate, materialsPopulate
      , canEdit, canViewSubmissions;

    // This route declares no `auth` (config/api_routes.js:32-47), so it inherits
    // `mode: 'try'` and an anonymous caller reaches it; its
    // `course(params.courseId)` pre-handler establishes only that the course
    // EXISTS. No visibility rule is applied here - the course's metadata, and
    // its outline below, are served to any caller holding the id - and that is
    // the behaviour this route has. The visibility rule the application does
    // apply lives on the page that renders this data
    // (`classes.viewClass`, lib/controllers/classes.js), and it is not repeated
    // here.
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

    // The chain is returned, so its resolved value is this handler's response
    // and each branch of it produces one. Its structure is intentionally left
    // intact rather than flattened into sequential awaits: as updateMaterial
    // below shows, a `return` inside a `.then` continues the chain instead of
    // answering. There is no `.catch`, so a rejection reaches the route handler
    // catch-all in lib/util/routeParser.js and answers 500.
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

        // SEAM-F46: this is the outline the course editor consumes, and
        // `public/js/courseEditor/controllers/root.js:987-988` concatenates
        // `$scope.course.lessons[i].name` from it into an HTML string that
        // Notify.js inserts through `data-notify-html`. The populated lesson
        // names are therefore projected with their tag-opening characters
        // neutralized; every other field, including this course's own name, is
        // byte-identical, and the non-outline response above is untouched
        // because it carries no populated lesson. See
        // `tagSafeCourseProjection` for why the course name is not neutralized
        // on this response.
        return request.success({ data : tagSafeCourseProjection(course, { lessonNames : true }) });
      });
  },

  // update name/description
  updateCourse : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("update-course-details", "course", { id : course.id })) {
      course.set(request.payload);
      course.setGlobalSettings(request.payload);

      // The save keeps its callback interface, so the promise boundary is created
      // here at the lifecycle method. The callback frame is what decides which
      // branch answers: two of its three paths resolve this promise and the third
      // resolves nothing. Collapsing it into an await that rejects on `err` would
      // give that third path a response.
      return await new Promise(function(resolve) {
        course.save(function(err, savedCourse) {
          if (err) {
            if (err.code === 11000) {
              return resolve(request.fail({
                  err     : err
                , message : "You already have a course with this name. Please choose another."
              }));
            }

            // unknown failure
            //
            // Nothing is resolved here, so the promise this handler returns stays
            // pending and the request is intentionally never answered. The
            // driver's error is not carried into any value, so no model detail
            // can reach a client or the flash.
            return;
          }

          return resolve(request.success({ course : savedCourse }));
        });
      });
    }
    else {
      // `Boom` is not bound in this module and is not one of the model globals
      // app.js assigns, so this expression raises ReferenceError('Boom is not
      // defined'). The route handler catch-all in lib/util/routeParser.js maps it
      // to a 500, which a browser request receives as the rendered 50x.html.
      // Every `Boom.forbidden()` in this file answers the same way.
      return Boom.forbidden();
    }
  },

  deleteCourse : async function(request, h) {
    var course = request.pre.course;

    if (request.user.hasPermission("delete-course", "course", { id : course.id })) {
      return course.deleteCourse()
        .then(request.success)
        .catch(function(err) {
          // Returned rather than thrown: hapi normalizes a returned Error into a
          // 500 Boom itself, so returning it answers the same status while
          // keeping this edge out of the route handler catch-all, which logs a
          // stack trace for everything that reaches it.
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

      // A failed save is intentionally swallowed, so `savedCourse` is left
      // undefined and this route answers with an absent course rather than an
      // error.
      savedCourse = await course.save().catch(function() { /* intentionally ignored */ });

      return request.success({ course: savedCourse });
    }
    else {
      return Boom.forbidden();
    }
  },

  copyCourse : async function(request, h) {
    var url;

    if (request.user.hasRole("course-owner", "course", { id : request.pre.course.id })
    ||  request.pre.course.globalSettings.courseType === "public"
    ||  request.pre.course.globalSettings.courseType === "open"
    ||  request.user.hasPermission("create-private-course")
    ||  request.user.hasPermission("make-course-copy", "course", { id : request.pre.course.id })) {
      request.pre.course.name = request.payload.name;

      // `copy` is a callback-only model API - it calls back with (err, doc) and
      // returns no promise - so the promise boundary is created here at the
      // lifecycle method and the model is left untouched. The callback frame
      // decides which of its three paths answers: the duplicate-name path
      // resolves from inside this callback, the success path resolves from inside
      // the addUser chain, and the third path resolves nothing.
      return await new Promise(function(resolve) {
        request.pre.course.copy(request.user, function(err, course) {
          if (err) {
            if (err.code === 11000) {
              return resolve(request.fail({
                  err     : err
                , message : "You already have a course with this name. Please choose another."
              }));
            }

            // unknown failure
            //
            // Nothing is resolved here, so the promise this handler returns stays
            // pending and the request is intentionally never answered. The
            // driver's error is not carried into any value, so no model detail
            // reaches a client or the flash.
            return;
          }

          // Only this chain's success path settles the handler. It intentionally
          // carries no `.catch` and nothing connected to a rejection path, so a
          // rejecting addUser is an unhandled rejection and the request is never
          // answered.
          return course.addUser(request.user, ["course-owner"])
            .then(function() {
              // url needs to be fully qualified in case the copy is
              // happening from the original owner's subdomain
              url = config.url + '/' + course.ownerSlug + '/courses/' + course.slug;
              resolve(request.success({
                  success : true
                , url     : url
              }));
            });
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
          // SEAM-F46: the course editor pushes this body directly into
          // `$scope.course.lessons`, which the publish notification later reads
          // into an HTML string. See `tagSafeLessonProjection`.
          return request.success({ data : tagSafeLessonProjection(lesson) });
        })
        .catch(function(err) {
          return err;
        });
    }
    else {
      return Boom.forbidden();
    }
  },

  // The lesson the `course`, `hasLesson` and `lesson` pre-handlers resolved is
  // answered whole - `name`, `slug`, `isDraft` and the material id list
  // `getMaterial` is reached through. This route declares no `auth`
  // (config/api_routes.js:112-122) and applies no visibility or draft rule of
  // its own, so any caller holding the two ids reads it, draft lessons
  // included. That is what this route does and it is preserved; the draft
  // filtering the outline in `getCourse` performs is a property of that
  // response, not of this one.
  getLesson : async function(request, h) {
    return request.success({ data : request.pre.lesson });
  },

  updateLesson : async function(request, h) {
    var course = request.pre.course
      , lesson = request.pre.lesson;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      lesson.set(request.payload);

      // `err` is intentionally not read, so a failed save leaves `savedLesson`
      // undefined and the property accesses below throw a TypeError INSIDE the
      // mongoose callback, which no request lifecycle can route: mongoose catches
      // whatever a save callback throws and re-emits it as an 'error' event on
      // the model, nothing listens for that event, Node's EventEmitter rethrows
      // it, and nothing listens for 'uncaughtException' either - so the process
      // terminates and the request is never answered. Keeping the accesses in the
      // callback frame is what keeps that outcome; an `err` check or a `.catch`
      // would move the throw into this handler and answer 500 instead.
      return await new Promise(function(resolve) {
        lesson.save(function(err, savedLesson) {
          return resolve(request.success({
            lesson : {
              // SEAM-F46: the editor extends its live `$scope.course.lessons`
              // entry from this body (root.js:546-551 and :965-996) and the
              // publish notification then concatenates the name into HTML, so
              // the name is neutralized here as it is on the outline response.
              // The property access on `savedLesson` is left exactly where
              // baseline had it - see the preserved-quirk note above.
              name    : neutralizeTagDelimiters(savedLesson.name),
              slug    : savedLesson.slug,
              isDraft : savedLesson.isDraft || false
            }
          }));
        });
      });
    }
    else {
      return Boom.forbidden();
    }
  },

  moveLesson : async function(request, h) {
    var course = request.pre.course
      , index;

    if (request.user.hasPermission("manage-course-content", "course", { id : course.id })) {
      index = course.lessons.indexOf(request.params.lessonId);
      course.lessons.splice(index, 1);
      course.lessons.splice(request.payload.index, 0, request.params.lessonId);

      // `err` is intentionally not read here either, so a failed save leaves
      // `savedCourse` undefined and `savedCourse.id` throws inside the mongoose
      // callback frame - uncaught, unroutable, and with no response ever
      // produced; updateLesson above spells the mechanism out. The callback frame
      // is kept so the throw stays there rather than rejecting this handler into
      // a 500.
      return await new Promise(function(resolve) {
        course.save(function(err, savedCourse) {
          return resolve(request.success({
            oldParent : savedCourse.id,
            newParent : savedCourse.id,
            oldIndex  : index,
            newIndex  : request.payload.index
          }));
        });
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
      // As a rejection handler, `request.fail` receives the error as its FIRST
      // parameter (`json`) with its `err` parameter undefined, so it logs the
      // inspected error followed by " undefined" and flashes the error itself
      // as 'failure'.
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

    // The material body - a page's text, an assignment's instructions - is
    // answered to any caller that resolved the three ids. This route declares
    // no `auth` (config/api_routes.js:218-230) and applies none of the three
    // conditions `getCourse`'s outline applies to the same document: no
    // visibility rule, no draft filter, and no `isVisible()` availability
    // window. That is the behaviour this route has and it is preserved.
    //
    // The `with=owner` branch below reads `request.user.id`, which throws for
    // an anonymous caller and answers 500 - also preserved.
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

      // The diff-conflict branch below answers 500, not the "modified in another
      // window" message it appears to send: `return request.fail(...)` inside the
      // first `.then` is a callback return, not a handler return, so the chain
      // CONTINUES. The second `.then` receives that response object as its
      // `savedMaterial` argument and hands it to request.success, whose
      // serialization walks response -> request -> server until it raises
      // RangeError: Maximum call stack size exceeded, which the `.catch` returns
      // as the 500. Flattening this chain into sequential awaits would make that
      // `return` short-circuit the handler and answer 200 instead.
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
            // The patch arrives in the editor's jsdiff 1.0.8 dialect with its
            // header stripped, so it is applied by applyLegacyPatch, which reads
            // that dialect; `false` means the source has diverged from the one
            // the patch was computed against.
            var patched = applyLegacyPatch(material.content ? material.content : '', request.payload.patch);
            if (patched === false) {
              // SEAM-F39. `request.fail` is still called here, and with exactly
              // the argument it was called with, because the call carries this
              // branch's side effects: it writes the failure log line and it
              // consumes the yar flash (these routes declare neither a
              // `fail.redirect` nor a `fail.html`, so it takes the
              // `h.response(json)` branch of lib/util/routeParser.js:376-405 and
              // reads the flash itself). Its RESPONSE is discarded, and the
              // chain is short-circuited by throwing, so the second .then never
              // receives a hapi response and never walks
              // response -> request -> server. The throw is caught by this
              // chain's own .catch, which returns the error unchanged, so the
              // branch still answers the 500 the walk used to produce - see the
              // block above for the measured equivalence.
              request.fail({
                data : _.extendOwn({
                    status  : "error"
                  , message : "This page may have been modified in another window. If you wish to make edits, please reload the page."
                }, material.toJSON())
              });

              throw errors.internal();
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
          // SEAM-F46: the same live-array reasoning as `addLesson` and
          // `updateLesson` - this body carries a lesson name back to the editor.
          return request.success({ lesson : tagSafeLessonProjection(lesson) });
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
          // There is intentionally no `else`: no response is invented for a
          // result carrying neither flag. Such a result would leave this callback
          // returning undefined, so the chain resolves undefined and hapi answers
          // 500 through Boom.badImplementation. The case is unreachable in
          // practice - addUser in lib/models/course.js resolves either
          // {alreadyListed:true} or {success:true, user}.
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
      // The token every invitation carries is the one `CourseInvitation.addList`
      // minted - `md5(email + course.id).substring(0, 8)`
      // (lib/models/courseInvitation.js:43) - and it is neither rotated nor
      // re-derived here. `sendInvitationEmail` builds the `acceptUrl` from that
      // same value, so the mailed link and the stored token are the model's.
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
      // The permission above is checked against `{courseId}` and the invitation
      // is then loaded by id ALONE: the id is not bound to the authorized
      // course, and an invitation that does not exist is not screened out
      // either, so `invitation.remove()` throws a TypeError for an unknown id
      // and that request is answered as a 500 through the chain's `.catch`.
      // Both are the behaviour this route has, and both are preserved.
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
      // `request.pre.invitation` comes from `invitation(params.invitationId)`
      // (config/api_routes.js:372,384), which resolves an invitation by id
      // alone, and the permission above is checked against `{courseId}`. The
      // two are not tied together here - as in `removeInvitation`, the
      // invitation acted on is whichever the id names - and that is preserved.
      if (request.payload.status) {
        invitation.status = request.payload.status;
      }
      else if (request.payload.email) {
        // check course.users for this email
        existingUser = _.find(course.users, function(user) {
          return user.email.toLowerCase() === request.payload.email.toLowerCase();
        });

        if (!existingUser) {
          // `updateEmail` re-addresses the invitation and sets its status to
          // `resend` (lib/models/courseInvitation.js:123); the token it carries
          // is left as it is, so the link already mailed to the previous
          // addressee keeps working. That is this route's behaviour and it is
          // preserved.
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
            // Unlike the sibling "unknown failure" branches in createCourse,
            // updateCourse and copyCourse, this one sits in the `.catch` of a
            // chain the handler returns, so its value IS the response: the empty
            // object answers 200 application/json {}. Returning {err, message}
            // here instead would put the driver's error on the wire as
            // {"err":{},"message":"..."}.
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

    // Attempts against this route are not counted or bounded, and the code is
    // the only credential it asks for: this is one of two entry points that
    // redeem one, the other being `GET /courses/join/{accessCode}` on
    // `classes.joinFromLink`. Both are unmetered, which is the behaviour they
    // have and which is preserved here.
    try {
      // `findByAccessCode` is a callback-form model API - it hands the callback
      // straight to Mongoose's findOne - so the model keeps its interface and the
      // await boundary belongs at this call site.
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
      // Returned rather than thrown: hapi normalizes a returned Error into a 500
      // Boom, which keeps this edge out of the route handler catch-all.
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
          // SEAM-F46: this is the response
          // `public/partials/directives/join-course.js:33-37` builds its
          // notification from, concatenating `result.course.name` into an HTML
          // string that Notify.js inserts through `data-notify-html`. The name
          // is therefore projected with its tag-opening characters neutralized;
          // every other field, and every name that cannot open a tag, is
          // byte-identical. See `tagSafeCourseProjection`.
          return request.success({
              success : true
            , course  : tagSafeCourseProjection(course, { courseName : true })
          });
        }
      })
      .catch(function(err) {
        return err;
      });
  },
  // This route declares no `pre` array (config/api_routes.js:491), so nothing
  // proves that `{lessonId}` belongs to `{courseId}` or that `{materialId}`
  // belongs to that lesson, and the payload's `parent` - which decides whose
  // code, assets and settings are copied into the new assignment - is used as
  // sent. The assignment written below therefore carries whatever `courseId`
  // and `materialId` the path names. That is the behaviour this route has: the
  // containment the `hasLesson`/`hasMaterial` server methods establish for the
  // routes that declare them is not established here, and an unresolvable
  // `parent` reaches the property accesses below and answers 500 through this
  // chain's `.catch`.
  startAssignment : async function(request, h) {
    var assignment;

    return Trinket.findById(request.payload.parent)
      .then(function(trinket) {
        // The assignment is built from whichever trinket the payload named.

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

    // This route declares no `pre` array (config/api_routes.js:502), so - as in
    // `startAssignment` - the submission written below carries `materialId` and
    // `courseId` straight from the path and its content is derived from the
    // trinket the payload's `parent` names, with neither the path graph nor the
    // parent bound to anything first. Preserved as it is, including this
    // chain's `.catch`, which calls `forbidden` on the unbound `Boom`
    // identifier - one of this file's preserved ReferenceError sites - so every
    // failure inside the chain, the two date throws included, is answered as
    // the 500 that site produces.
    //
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
              , comments        : projectComments(submission.comments)
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
                , comments        : projectComments(submission.comments)
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
        // On the `{userId}` route
        // (`GET /api/courses/{courseId}/users/{userId}/materials/{materialId}/submissions`,
        // config/api_routes.js:565) the permission above is checked against
        // `{courseId}`, while `{materialId}` is a free path parameter that
        // nothing binds to that course - the route declares no `pre` array and
        // carries no `{lessonId}` to walk the course -> lesson -> material chain
        // with - so the submissions answered are whichever ones the material id
        // names. Preserved as it is.
        submissions = _.map(trinkets, function(trinket) {
          return _.extendOwn({
              id              : trinket.id
            , comments        : projectComments(trinket.comments)
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
      // This route's only pre-handler is `course(params.courseId)`
      // (config/api_routes.js:552-557) and the query below reaches the
      // submissions through `{materialId}` alone -
      // `Trinket.findSubmissionsByMaterial` filters on `materialId` and nothing
      // else - so the material is not required to belong to the authorized
      // course. Preserved as it is.
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
              submissions[ thisIndex ].comments    = projectComments(submissions[ thisIndex ].comments);

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
              , comments    : projectComments(lastSubmission.comments)
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
      // The permission above is the only check: the trinket marked "completed",
      // commented on and re-serialized below is whichever one the payload's
      // `trinketId` names, and it is not required to be a submission against
      // this course or against the material named in the path. Preserved as it
      // is.
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
            // SEAM-F42: the author's email address is deliberately NOT
            // persisted here. It was stored on every feedback comment and then
            // re-emitted by the six comment projections in this file, which
            // handed a teacher's address to every student who read the
            // submission. `userId`, `username`, `displayName` and `avatar` are
            // what the comment templates render, so they stay; the address had
            // no consumer. Historical rows that still carry one are redacted on
            // the way out by `projectComments`.
            submission.comments.push({
                userId           : request.user.id
              , username         : request.user.username
              , displayName      : request.user.name
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
              , comments        : projectComments(submission.comments)
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

    // `request.pre.trinket` is resolved by `trinket(payload.trinketId)`
    // (config/api_routes.js:618-627), by id alone and independently of the
    // course the permission below is checked against, and the permission is the
    // only condition this handler applies. The submission reopened by the write
    // is therefore whichever one the payload names. Preserved as it is.
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
 * Shared course-creation core, called directly by `createCourse` above and by
 * `courses.create`. Each caller applies its own response projection, because an
 * API route's JSON negotiation, validation, pre-handler context and `replySpec`
 * projection belong to that route alone and cannot be borrowed by another.
 *
 * Inputs are taken explicitly - no `request`, no `h` - so the core is callable
 * from any context and exercisable without a request lifecycle.
 *
 * It is intentionally NOT an `async` function. The synchronous section runs in
 * the caller's own frame, so a throw from it reaches that caller's route handler
 * catch-all and answers 500; marking this `async` would turn such a throw into a
 * rejection handed to the caller's `catch`, which maps a save failure to a
 * request that is never answered. Keeping the function synchronous up to the
 * `return` is what keeps those two edges apart.
 *
 * Errors are intentionally NOT handled here: only a caller can tell a duplicate
 * course name from an unknown failure. Both callers map a duplicate-key error
 * (code 11000) to their own "already have a course with this name" message and
 * leave every other failure unanswered.
 *
 * @param   {Object} attributes  course attributes, as supplied by a route payload
 * @param   {Object} actingUser  the user creating the course; becomes its owner
 * @returns {Promise<Object>}    the saved course document, with the acting user
 *                               already granted the "course-owner" role. Rejects
 *                               with the model's own error if the save fails, and
 *                               never settles if granting the role fails.
 */
module.exports.createCourseCore = function(attributes, actingUser) {
  var course = new Course(attributes);

  course.setOwner(actingUser);
  course.ownerSlug = actingUser.username;

  // The requested `courseType` is applied by `setGlobalSettings` below without
  // consulting any permission. `create-private-course` gates the read side
  // only, and creation has never asked for it, so a `private` course is
  // configured and saved for whoever asks - which is the behaviour both callers
  // of this core have and which is preserved here rather than tightened.

  course.setGlobalSettings(attributes);

  // The save keeps its callback interface, so the promise boundary is created
  // here rather than pushed into the model. What resolves is the callback's own
  // second argument, the saved document, which is what both callers project.
  return new Promise(function(resolve, reject) {
    course.save(function(err, savedCourse) {
      if (err) {
        return reject(err);
      }

      // request.user.grant("course-owner", "course", { id : course.id })
      //
      // Only this chain's success path settles the promise. It is intentionally
      // not connected to `reject` and carries no `.catch`, so a rejecting addUser
      // is an unhandled rejection and the caller's request is never answered.
      savedCourse.addUser(actingUser, ["course-owner"])
        .then(function() {
          resolve(savedCourse);
        });
    });
  });
};

/**
 * Neutralizes the two characters that can open an HTML tag, and nothing else.
 *
 * SEAM-F46. Two unchanged clients concatenate server-provided names into
 * Notify.js's `data-notify-html` sink, which inserts the string as markup:
 * `public/partials/directives/join-course.js:33-37` builds its message from
 * `result.course.name`, and
 * `public/js/courseEditor/controllers/root.js:987-988` builds its message from
 * `$scope.course.lessons[i].name`. A frontend rewrite is out of scope
 * (AAP 0.2.2), so the values are made safe for that sink on the way out
 * instead.
 *
 * Only `<` and `>` are replaced, and that is deliberate rather than partial.
 * Both fields are ALSO rendered by consumers that escape for themselves -
 * Angular's `{{ }}` bindings and nunjucks templates, which run with
 * `autoescape: true` (lib/util/nunjucks.js:8) - so a full HTML escape would
 * turn `Tom's Class` into `Tom&#x27;s Class` in every course list and every
 * page title, trading an injection for an output-encoding regression. A name
 * that cannot open a tag cannot construct markup, whatever `&`, `'` or `"` it
 * contains, so for every such name - which is all of them in practice - these
 * bytes are unchanged. A name that does contain `<` or `>` renders in the
 * notification as the escaped text it was always displayed as by the escaping
 * consumers.
 *
 * @param   {*} value  a name value from a serialized document
 * @returns {*}        the same value with `<` and `>` replaced, or the value
 *                     unchanged when it is not a string
 */
function neutralizeTagDelimiters(value) {
  if (typeof value !== 'string') {
    return value;
  }

  return value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Wraps a course document in a response projection whose names are safe for
 * the notification sink described on `neutralizeTagDelimiters`.
 *
 * SEAM-F46. The wrapper exposes `serialize()` because that is the interface
 * `request.success`'s projection uses: `ObjectUtils.serialize` calls
 * `serialize()` when the value provides one (lib/util/objectUtils.js:34-42) and
 * otherwise walks the value key by key. Handing it a plain object instead would
 * send it into that walk, where the course's `_owner` and `lessons` ObjectIds -
 * objects without a `serialize` - would be enumerated into `{}` rather than
 * rendered as id strings, changing the response shape. Going through
 * `serialize()` keeps every other field byte-identical.
 *
 * The document is never touched: `Course`'s and `Lesson`'s `serialize()` build
 * fresh plain objects from their publicSpec (lib/models/model.js:59-92), so the
 * names are edited on a copy and nothing that could later be saved is mutated.
 *
 * Which names are neutralized is stated per response rather than applied to
 * every name in the payload, and that is measured rather than cautious. The
 * course editor loads this course's own name into an editable form
 * (`public/js/courseEditor/controllers/root.js:151`, submitted back to
 * `PUT .../metadata`) and compares it against typed confirmation text (:794),
 * so neutralizing it in the outline response could round-trip a `&lt;` into
 * storage for the very names this defends. The outline response therefore asks
 * for `lessonNames` only - the field its notification sink concatenates - and
 * the join response, which feeds no form and no comparison, asks for
 * `courseName`.
 *
 * @param   {Object}  course              the course document being answered
 * @param   {Object}  fields              which names to neutralize
 * @param   {Boolean} fields.courseName   the course's own name
 * @param   {Boolean} fields.lessonNames  the names of its populated lessons
 * @returns {Object}                      a projection carrying `serialize()`
 */
function tagSafeCourseProjection(course, fields) {
  return {
    serialize : function() {
      var serialized = course.serialize();

      // Only a string `name` that is actually present is rewritten, so an
      // unpopulated `lessons` entry - which serializes as its bare ObjectId -
      // is left exactly as it is rather than acquiring a key.
      if (fields.courseName && typeof serialized.name === 'string') {
        serialized.name = neutralizeTagDelimiters(serialized.name);
      }

      if (fields.lessonNames && Array.isArray(serialized.lessons)) {
        serialized.lessons.forEach(function(lesson) {
          if (lesson && typeof lesson.name === 'string') {
            lesson.name = neutralizeTagDelimiters(lesson.name);
          }
        });
      }

      return serialized;
    }
  };
}

/**
 * Wraps a lesson document in a response projection whose `name` is safe for
 * the same notification sink.
 *
 * SEAM-F46. The course editor does not read lesson names only from the outline
 * response `tagSafeCourseProjection` covers. It keeps
 * `$scope.course.lessons` as a live array and writes into it from the lesson
 * MUTATION responses as well: `addItem`
 * (public/js/courseEditor/controllers/root.js:527-544) pushes the `addLesson`
 * body straight in, and `editLesson` (:546-551) and `toggleDraft` (:965-996)
 * extend an existing entry from the `updateLesson` body. The notification at
 * :987-988 then reads that same array. So a lesson added or renamed to markup
 * would reach the sink through those responses even though the initial load is
 * projected - which is why they are projected too.
 *
 * Same `serialize()` interface, and for the same measured reason, as
 * `tagSafeCourseProjection`: `ObjectUtils.serialize` calls `serialize()` when
 * the value provides one and otherwise walks the value key by key, and that
 * walk would turn the lesson's `materials` ObjectIds into `{}` instead of id
 * strings. `Lesson`'s publicSpec is `{id, name, isDraft, slug, materials}`, and
 * only `name` is touched; the document itself is never mutated, because
 * `serialize()` builds a fresh plain object from that spec.
 *
 * @param   {Object} lesson  the lesson document being answered
 * @returns {Object}         a projection carrying `serialize()`
 */
function tagSafeLessonProjection(lesson) {
  return {
    serialize : function() {
      var serialized = lesson.serialize();

      if (typeof serialized.name === 'string') {
        serialized.name = neutralizeTagDelimiters(serialized.name);
      }

      return serialized;
    }
  };
}

/**
 * Projects a submission's comment list for a response, without the comment
 * author's email address.
 *
 * SEAM-F42. `sendFeedback` used to persist `email : request.user.email` onto
 * the feedback comment it pushes, and six response paths in this file re-emit
 * whole comment arrays: the two submission handlers, the per-material and
 * per-course submission reads, the material dashboard and `sendFeedback`
 * itself. Between them they hand a teacher's address to every student in the
 * course, and a student's own comment rows travel back through the same
 * projections. The address is no longer written, and it is redacted here as
 * well, so rows already carrying one stop being disclosed. Nothing reads
 * `comments[].email` on the client - no consumer in `public/js`,
 * `public/partials` or `lib/views` references it - and the fields the comment
 * templates do render (`userId`, `username`, `displayName`, `avatar`) are
 * untouched. The schema field itself stays as it is: `lib/models/trinket.js`
 * is outside this change, and the field simply stops being written and stops
 * being emitted.
 *
 * This is a drop-in for the `JSON.parse(JSON.stringify(comments))` each call
 * site used to perform, deliberately including its behaviour for a missing
 * list: `JSON.stringify(undefined)` returns `undefined` and `JSON.parse` then
 * throws, which is the measured outcome at the material-dashboard site when a
 * grouped submission matches none of the recognised states. That throw is
 * preserved rather than smoothed over, so no `|| []` default is applied here.
 *
 * @param   {Array}  comments  a comment list, mongoose array or plain array
 * @returns {Array}            a JSON-safe deep copy with no `email` key
 */
function projectComments(comments) {
  var projected = JSON.parse(JSON.stringify(comments));

  if (Array.isArray(projected)) {
    projected.forEach(function(comment) {
      if (comment && typeof comment === 'object') {
        delete comment.email;
      }
    });
  }

  return projected;
}

/**
 * Generates a course access code.
 *
 * The code is the credential `POST /api/courses/join` and
 * `GET /courses/join/{accessCode}` both accept, and it is drawn from
 * `Math.random` - not from `crypto` - which is how every code this application
 * has issued was produced. `Math.random`'s stream is per process and
 * recoverable from observed output, so codes are predictable to a caller that
 * has seen one; that is the behaviour of this generator and it is preserved
 * (R-d), as is the absence of any bound on how many codes a caller may try.
 *
 * The alphabet is the visually unambiguous subset (no I, O, l or o, no 0 or 1),
 * the length is six, and `Course.findByAccessCode` matches the result as a
 * plain indexed string.
 *
 * @returns {String}  a six-character code over the fixed alphabet
 */
function generateAccessCode() {
  var code     = []
    , possible = "ABCDEFGHJKLMNPRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    , i;

  for (i = 0; i < 6; i++) {
    code.push(possible.charAt(Math.floor(Math.random() * possible.length)));
  }

  return code.join("");
}
