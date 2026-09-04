var config = require('config'),
    // Node's own CSPRNG, required by `generateAccessCode` below: a course
    // access code is a bearer credential for joining a course, so it is drawn
    // from `crypto` rather than from `Math.random` (SEC-F40).
    crypto = require('crypto'),
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

    // CMT-09: this route's own answer to the private-course permission
    // requirement that `createCourseCore` enforces for every caller. The core
    // fails closed by throwing, but it is called below OUTSIDE this handler's
    // `try` - deliberately, so that its synchronous section keeps reaching the
    // Layer 1 catch-all as it did at baseline - so a throw from it would be
    // answered as 500. Checking the same permission here is what turns the
    // refusal into this route's own error mapping. Every account the
    // application issues holds this permission (lib/models/roles.js:19-20,
    // lib/models/user.js:68), so nothing an authorized client sends is
    // affected.
    if (isPrivateCourseRequested(request.payload) && !hasPrivateCoursePermission(request.user)) {
      return errors.forbidden();
    }

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

    // SEC-F13. This route declares no `auth` (config/api_routes.js:32-47), so it
    // inherits `mode: 'try'` (app.js:310) and an anonymous caller reaches it.
    // Its `course(params.courseId)` pre-handler establishes only that the course
    // EXISTS, so without this gate a private course's metadata - and, below,
    // its whole outline including material `content` under
    // `?outline=true&withContent=true` - was served to anyone holding the id.
    //
    // The gate is the visibility rule the application already applies on the
    // page that renders this data (`classes.viewClass`,
    // lib/controllers/classes.js:142-143), so there is one rule and not two.
    // It is placed at the top of the handler on purpose: BOTH exits are behind
    // it - the non-outline `return` below and the populate chain - and nothing,
    // including the `_owner` serialization, is done on the refused path.
    if (!canViewCourseContent(request.user, course)) {
      return errors.notFound();
    }

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

  getLesson : async function(request, h) {
    // SEC-F13, the same two gates this route was missing. It declares no `auth`
    // either (config/api_routes.js:112-122) and its three pre-handlers -
    // `course`, `hasLesson`, `lesson` - establish only that the lesson exists
    // and belongs to the course, never that the caller may read either.
    if (!canViewCourseContent(request.user, request.pre.course)) {
      return errors.notFound();
    }

    // The draft half. `getCourse` above never puts a draft lesson in an outline
    // unless the caller asked for drafts AND holds one of the two editing
    // permissions (`lessonsPopulate.match = { isDraft : { $ne : true } }` on the
    // else branch), but this route returns `request.pre.lesson` WHOLE - `name`,
    // `slug`, `isDraft` and the material id list `getMaterial` is reached
    // through - so a course member who is not an editor could read
    // unpublished lessons here that the outline deliberately hides. The finding
    // names draft content as well as private content, so it is gated with the
    // same pair of permissions `getCourse` computes as `canEdit` and
    // `canViewSubmissions`.
    if (request.pre.lesson.isDraft && !canViewDraftCourseContent(request.user, request.pre.course)) {
      return errors.notFound();
    }

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

    // SEC-F13. The material body is the actual course content - a page's text or
    // an assignment's instructions - and this route declares no `auth`
    // (config/api_routes.js:218-230), so the same visibility gate applies here
    // first.
    if (!canViewCourseContent(request.user, request.pre.course)) {
      return errors.notFound();
    }

    // Three conditions, one status, because `getCourse`'s outline applies all
    // three to the same document and this route applied none of them:
    //
    //   - a draft material, and a material inside a draft lesson, are filtered
    //     out of the outline for any caller not asking for drafts with the
    //     permission to see them (`materialsPopulate.match` and
    //     `lessonsPopulate.match` above);
    //   - `isVisible()` is the assignment's own availability window, and
    //     `getCourse` applies it on exactly this branch by setting
    //     `checkDates`. Without it here, an assignment's instructions were
    //     readable before it opened and after it closed.
    //
    // They share `notFound` deliberately: answering a different status per
    // condition would tell a caller which one it tripped, and that is itself
    // information about unpublished content.
    //
    // Neither gate touches the `with=owner` branch below, whose
    // `request.user.id` read throws for an anonymous caller and answers 500.
    // That outcome is preserved baseline (R-d): an anonymous caller on a public
    // course with a visible, published assignment reaches it exactly as before,
    // and no guard is added.
    if (!canViewDraftCourseContent(request.user, request.pre.course)
    &&  (request.pre.lesson.isDraft || request.pre.material.isDraft || !request.pre.material.isVisible())) {
      return errors.notFound();
    }

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
      return CourseInvitation.addList(request.payload.emailList, course)
        .then(function(invitations) {
          // SEC-F27, the entropy half. `CourseInvitation.addList` mints the
          // token as `md5(email + course.id).substring(0, 8)`
          // (lib/models/courseInvitation.js:43): 8 hex characters, so about 32
          // bits, and fully DETERMINISTIC from two values an attacker routinely
          // knows - a classmate's address and a course id that appears in every
          // course URL. Anyone able to guess both could mint the accept link
          // without ever receiving the invitation.
          //
          // The token is replaced with a 128-bit CSPRNG value HERE, before
          // `sendEmails` runs, because `sendInvitationEmail` builds the
          // `acceptUrl` from `invitation.token`
          // (lib/models/courseInvitation.js:76) - so the accept link that is
          // mailed always carries the CSPRNG value.
          //
          // Stated precisely, because the rotation is a second write and not a
          // replacement of the mint: `addList` persists the deterministic value
          // first, so it exists in the database between the two writes, and it
          // survives if this save fails or the process dies in between. What
          // makes that residue unusable is not this rotation but the identity
          // binding in `classes.acceptInvitation` - redeeming any token now
          // requires the caller's own address to equal the invitation's - and
          // the fact that a rotation failure rejects this chain before
          // `sendEmails`, so no link is ever mailed for an invitation still
          // holding the weak value. Removing the interim write needs the mint
          // site itself (lib/models/courseInvitation.js:43), which is not this
          // checkpoint's to change.
          //
          // It is done in the controller rather than at the mint site because
          // `lib/models/**` is not this checkpoint's to change; the persisted
          // shape is unaffected either way (`token` is an unconstrained indexed
          // String, lib/models/courseInvitation.js:19) and `findByToken` is a
          // plain `findOne({token})`, so a longer value needs no other change.
          // `addList` upserts with `status: "pending"` for every entry it
          // returns, so none of these can be an already-redeemed invitation and
          // this rotation cannot invalidate a link somebody has already used.
          return Promise.all(invitations.map(function(invitation) {
            invitation.token = generateInvitationToken();
            return invitation.save();
          }));
        })
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
          // SEC-F15: the permission above is checked against `{courseId}`, but
          // the invitation was then loaded by id alone, so a manager of one
          // course could delete an invitation belonging to any other course.
          // The lookup is bound to the authorized course here, at the
          // authorization decision, rather than inside the query: the public
          // model exposes `findById`/`findByIdAndUpdate` and no `findOne`
          // (lib/models/model.js:115-164, lib/models/courseInvitation.js:128-133),
          // so a `{_id, courseId}` query is not reachable from a controller.
          // The check is equivalent - nothing is acted on until both the id and
          // the course match.
          //
          // A missing invitation takes the same branch, which also settles the
          // baseline TypeError: `findById` resolves `null` for an unknown id and
          // `invitation.remove()` then threw, so an unknown id was answered as a
          // 500 rather than as a 404. Both cases answer `notFound`, which is
          // also what keeps the response from confirming that some other
          // course's invitation exists.
          if (!isCourseInvitation(invitation, course)) {
            throw errors.notFound();
          }

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
      // SEC-F15: `request.pre.invitation` comes from
      // `invitation(params.invitationId)` (config/api_routes.js:372,384), which
      // resolves an invitation by id alone. The permission above is checked
      // against `{courseId}`, so without this binding a manager of one course
      // could re-status, re-address and re-mail an invitation belonging to any
      // other course - the same defect as `removeInvitation`, reached through a
      // pre-handler instead of a direct lookup. The check is placed before any
      // mutation so that nothing is written and no mail is sent on the
      // unauthorized path, and it answers `notFound` for the same reason that
      // handler does.
      if (!isCourseInvitation(invitation, course)) {
        return errors.notFound();
      }

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

          // SEC-F27. Re-addressing an invitation makes it an invitation to a
          // DIFFERENT person, and the token is a bearer credential: without
          // this the previous addressee keeps a link that now enrols them under
          // the new address's invitation, and the acceptance check added in
          // `classes.acceptInvitation` would then compare the new address
          // against whoever follows the old link. Re-addressing therefore
          // issues a fresh token, and the `sendEmails` call below mails it to
          // the new addressee - `updateEmail` sets `status` to `resend`
          // (lib/models/courseInvitation.js:123) and only `pending` or `resend`
          // invitations are mailed (:72) - so the new addressee holds the only
          // working link.
          //
          // The `request.payload.status` branch above deliberately does NOT
          // rotate: it re-sends the same invitation to the same person, whose
          // existing link must keep working.
          invitation.token = generateInvitationToken();
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

    // SEC-F40: guessing is bounded here. The code itself is now CSPRNG-drawn
    // (see `generateAccessCode`), but six characters over a 54-character
    // alphabet is about 34.5 bits - enough that an unbounded guesser is a real
    // threat and not enough that entropy alone closes it, so a bound on
    // attempts is the half that actually protects the code.
    //
    // This is ONE of two entry points that redeem a code: `GET
    // /courses/join/{accessCode}` reaches `classes.joinFromLink`, which carries
    // its own ledger of the same shape (see the comment there). Each route
    // bounds itself, so the combined allowance across both is twice the figure
    // below - immaterial against a 54^6 keyspace, and stated rather than
    // implied. Both ledgers are per process, so neither is a strict shared
    // control; `docs`-level residuals record that an authoritative cluster-wide
    // limit belongs at the edge.
    //
    // The attempt is RESERVED here, before the asynchronous lookup, rather than
    // counted after a miss. Reserving is what makes a parallel burst safe: the
    // reservation is synchronous, so N simultaneous requests are serialized
    // through it and only the first `ACCESS_CODE_ATTEMPT_LIMIT` of them ever
    // reach the database. Counting after the lookup would let every request in
    // a burst pass the check before the first miss was recorded.
    if (!reserveAccessCodeAttempt(request.user, request.info && request.info.remoteAddress)) {
      return errors.tooManyRequests("Too many access code attempts. Please wait a few minutes and try again.");
    }

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

    // The code was real, so the reservation taken above is released. Only
    // codes that matched nothing stay counted, which is what keeps a
    // legitimate user - who types one code, read out or pasted - from ever
    // meeting the limit.
    releaseAccessCodeAttempt(request.user, request.info && request.info.remoteAddress);

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
  startAssignment : async function(request, h) {
    var assignment
      , context;

    // SEC-F14: this route declares no `pre` array (config/api_routes.js:491),
    // so nothing before this point has proved that `{lessonId}` belongs to
    // `{courseId}` or that `{materialId}` belongs to that lesson, while the
    // assignment created below takes both `materialId` and `courseId` straight
    // from the path. The containment that the `hasLesson`/`hasMaterial` server
    // methods establish for the routes that declare them is reproduced here.
    //
    // The path graph is proved here, before the chain, because the chain needs
    // the resolved material to bind the payload against. The payload half of
    // the binding is then done inside the chain, where the trinket the payload
    // names has already been loaded, so no read is repeated.
    context = await resolveMaterialContext(
        request.params.courseId
      , request.params.lessonId
      , request.params.materialId
    );

    if (context.isBoom) {
      return context;
    }

    // SEC-F14, the authorization half. Resolving the graph proves the three
    // path ids belong together; it does not prove this caller may act inside
    // that course. The route carries `auth: 'session'` and nothing else
    // (config/api_routes.js:491-500), so without this an authenticated stranger
    // could start an assignment in a course whose existence they cannot even
    // read through `getCourse`. The predicate is the same one that gates those
    // reads, so a public or open course behaves exactly as it does today and
    // only the private case is refused - which is the exposure the finding
    // names and the smallest change that closes it.
    if (!canViewCourseContent(request.user, context.course)) {
      return errors.notFound();
    }

    return Trinket.findById(request.payload.parent)
      .then(function(trinket) {
        // SEC-F14: the payload's `parent` decides which trinket's code, assets
        // and settings are copied into the new assignment, so it is bound to
        // the material proved above instead of being trusted. The throw is
        // funnelled by this chain's own `.catch`, which returns the error
        // unchanged, so the caller receives 403 rather than the TypeError-500
        // an unbound parent used to produce.
        if (!isMaterialAssignmentTrinket(context.material, trinket)) {
          throw errors.forbidden();
        }

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
      , serialized, submission, now
      , context, parentTrinket;

    // SEC-F14: this route declares no `pre` array (config/api_routes.js:502).
    // The submission written below carries `materialId` and `courseId` from the
    // path and its content is derived from the trinket the payload names, so
    // both the path graph and the payload's `parent` are proved here first.
    //
    // BOTH halves are proved BEFORE the chain, unlike `startAssignment`, and
    // that is required rather than stylistic: this chain's `.catch` calls
    // `forbidden` on the unbound `Boom` identifier - one of this file's
    // preserved ReferenceError sites - so anything thrown inside the chain
    // would be answered as the 500 that site produces instead of as the status
    // the guard carries. The chain itself is therefore left exactly as it was,
    // including its own `Trinket.findById(request.payload.parent)` - the parent
    // is read twice on the authorized path, which is the price of not
    // disturbing a preserved error edge.
    context = await resolveMaterialContext(
        request.params.courseId
      , request.params.lessonId
      , request.params.materialId
    );

    if (context.isBoom) {
      return context;
    }

    // SEC-F14, the authorization half - see the identical guard in
    // `startAssignment` above for why the graph alone is not enough and why the
    // read predicate is the right bound.
    if (!canViewCourseContent(request.user, context.course)) {
      return errors.notFound();
    }

    parentTrinket = await Trinket.findById(request.payload.parent);

    if (!isMaterialAssignmentTrinket(context.material, parentTrinket)) {
      return errors.forbidden();
    }

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
        // SEC-F14: on the `{userId}` route
        // (`GET /api/courses/{courseId}/users/{userId}/materials/{materialId}/submissions`,
        // config/api_routes.js:565) the permission above is checked against
        // `{courseId}`, but `{materialId}` is a free path parameter that nothing
        // binds to that course - the route declares no `pre` array, and this
        // path carries no `{lessonId}` to walk the course -> lesson -> material
        // chain with. The binding is therefore taken from the submissions
        // themselves: each one records the course it was filed in
        // (`courseId`, written from the authorized path by `submitAssignment`
        // and `startAssignment`, and already trusted as the authoritative
        // course by `autosaveFeedbackComments`), so a submission belonging to
        // another course means the material does too and the read is refused.
        //
        // An empty result set is answered exactly as before: it reveals nothing
        // about the material, and answering it differently would leak whether
        // another course's material exists.
        //
        // The other route this handler serves, `GET /api/submissions/{materialId}`
        // (:559), reads the CALLER'S OWN submissions - `userId` is
        // `request.user.id` and `findByUserAndMaterial` filters on `_creator` -
        // and has no `{courseId}` to bind to, so it is left untouched.
        if (request.params.userId && _.some(trinkets, function(trinket) {
          return !trinket.courseId || trinket.courseId.toString() !== request.params.courseId.toString();
        })) {
          return errors.forbidden();
        }

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
      , userIndex   = {}
      , context;

    if (request.user.hasPermission("view-assignment-submissions", "course", { id : course.id })) {
      // SEC-F14: this route's only pre-handler is `course(params.courseId)`
      // (config/api_routes.js:552-557), and the query below reaches the
      // submissions through `{materialId}` alone - `Trinket.findByMaterial`
      // filters on `materialId` and nothing else (lib/models/trinket.js:458-488).
      // So a teacher of one course could name another course's material and
      // receive its submission and comment metadata for every student the two
      // courses have in common. Resolving `{courseId}` -> `{lessonId}` ->
      // `{materialId}` first is what makes the material's membership of THIS
      // course a precondition of the read instead of an assumption.
      context = await resolveMaterialContext(
          request.params.courseId
        , request.params.lessonId
        , request.params.materialId
      );

      if (context.isBoom) {
        return context;
      }

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
      , submission, serialized, revision, lastIndex, feedbackIndex, previousRevisionId
      , context;

    if (request.user.hasPermission("send-submission-feedback", "course", { id : course.id })) {
      // SEC-F14: the path material is resolved through the authorized course
      // BEFORE the submission is bound to it, so that binding cannot be
      // satisfied by a row whose own `materialId` points outside this course.
      // Rows like that exist: they are what the unbound `startAssignment` and
      // `submitAssignment` paths used to create, and a check that trusted the
      // stored ids alone would still honour them. Proving `{lessonId}` sits in
      // `{courseId}` and `{materialId}` in that lesson makes the stored ids
      // checkable against the graph rather than against themselves.
      context = await resolveMaterialContext(
          request.params.courseId
        , request.params.lessonId
        , request.params.materialId
      );

      if (context.isBoom) {
        return context;
      }

      return Trinket.findById(request.payload.trinketId)
        .then(function(trinket) {
          // SEC-F14: the permission check above proves only that this caller
          // may give feedback IN THIS COURSE. The trinket being marked
          // "completed", commented on and re-serialized below arrives from the
          // payload, so it is bound to the authorized course and to the
          // material named in the path before any of that happens - otherwise
          // a course A teacher can mutate, and read the code of, any trinket in
          // the system. The throw is funnelled by this chain's `.catch`, which
          // returns the error unchanged, so the caller receives 403.
          if (!isCourseSubmission(trinket, course, request.params.materialId)) {
            throw errors.forbidden();
          }

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
      , trinket = request.pre.trinket
      , context;

    if (request.user.hasPermission("send-submission-feedback", "course", { id : course.id })) {
      // SEC-F14: `request.pre.trinket` is resolved by `trinket(payload.trinketId)`
      // (config/api_routes.js:618-627), which loads it by id alone and
      // INDEPENDENTLY of the course the permission above was checked against.
      // Without the two checks below, a teacher of one course could reopen any
      // submission in the system by naming its id - the write is
      // `submissionState = "submitted"`, which returns another course's
      // completed work to the queue and discards its accepted state.
      //
      // The path graph is resolved first so the submission is bound to a
      // material proved to sit in THIS course, rather than to whatever its own
      // stored `materialId` claims; see the same reasoning at `sendFeedback`.
      context = await resolveMaterialContext(
          request.params.courseId
        , request.params.lessonId
        , request.params.materialId
      );

      if (context.isBoom) {
        return context;
      }

      if (!isCourseSubmission(trinket, context.course, context.material.id)) {
        return errors.forbidden();
      }

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

  // CMT-09. A private course is only created for a user who holds the
  // site-level `create-private-course` permission. The check is here, ahead of
  // `setGlobalSettings`, so that EVERY caller of this core fails closed: the
  // course is neither configured as private nor saved when it does not hold.
  // The check is not repeated for `public`, `open` or the schema default -
  // `create-public-course` covers those and both permissions are granted to
  // the `user` role every account receives (lib/models/roles.js:19-20,
  // lib/models/user.js:68), so gating only the case the requirement names
  // keeps this a no-op for every account the application issues while still
  // being the gate a revoked or narrowed role needs.
  //
  // A caller that wants a status rather than a synchronous throw checks the
  // same permission before calling in - `course.createCourse` does, because
  // this core is deliberately called outside that handler's `try` and a throw
  // from here would otherwise reach the Layer 1 catch-all and answer 500.
  if (isPrivateCourseRequested(attributes) && !hasPrivateCoursePermission(actingUser)) {
    throw errors.forbidden();
  }

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
 * Membership test for a document's reference list, reproducing the semantics of
 * the `hasLesson` / `hasMaterial` server methods
 * (`internals.contains` at lib/util/helpers.js:90-107, registered at :298-299).
 *
 * Those methods are route pre-handlers, so they only protect the routes whose
 * declarations name them. The handlers below reproduce the same containment
 * in-handler for the routes that declare no such pre-handler; see
 * `resolveMaterialContext`.
 *
 * The comparison is made on string form rather than through
 * `MongooseArray.indexOf` so that it holds for a populated list of documents, a
 * list of ObjectIds and a plain list of strings alike - the three shapes these
 * reference lists take across the handlers in this file.
 *
 * @param   {Array}  list  a reference list, e.g. `course.lessons`
 * @param   {String} id    the id being looked for
 * @returns {Boolean}      true only if `id` is a member of `list`
 */
function containsId(list, id) {
  if (!list || typeof list.length !== 'number' || !id) {
    return false;
  }

  var needle = id.toString();

  return _.some(list, function(member) {
    if (!member) {
      return false;
    }

    // A populated element is a document and carries `_id`; an unpopulated one
    // IS the id and stringifies to it. `_id` rather than the `id` virtual is
    // what distinguishes them, because an ObjectId has an `id` of its own -
    // its raw 12-byte buffer - which would never match a hex string.
    return (member._id ? member._id.toString() : member.toString()) === needle;
  });
}

/**
 * Resolves the course -> lesson -> material chain named by a request's path
 * parameters and PROVES every link in it.
 *
 * SEC-F14. `POST .../startAssignment` (config/api_routes.js:491) and
 * `POST .../submissions` (:502) declare no `pre` array at all, so before this
 * function existed nothing had established that `{lessonId}` belongs to
 * `{courseId}` or that `{materialId}` belongs to that lesson. Both handlers
 * nevertheless wrote `materialId` and `courseId` onto the submission straight
 * from the path, which let one authenticated caller file a submission that
 * appears in one course's dashboard while pointing at another course's
 * material. The routes that DO declare
 * `course(...)`/`hasLesson(...)`/`lesson(...)`/`hasMaterial(...)`/`material(...)`
 * - the four `updateMaterial` routes and `deleteMaterial`, for instance - get
 * this from their pre-handlers; the two above get it from here.
 *
 * Failure is reported as a value rather than a rejection so that each caller
 * can return it directly: `Boom`'s `isBoom` flag is the discriminator, and the
 * returned error carries the route's real status instead of reaching a
 * handler's `.catch` (two of which are among this file's preserved
 * unbound-`Boom` sites and would turn any thrown error into a 500).
 *
 * `notFound` is used for every link, and deliberately does not distinguish
 * "does not exist" from "exists in another course": both mean the object is not
 * in the graph this request is authorized for, and reporting them differently
 * would confirm the existence of another course's lesson or material.
 *
 * @param   {String} courseId    `{courseId}` from the path
 * @param   {String} lessonId    `{lessonId}` from the path
 * @param   {String} materialId  `{materialId}` from the path
 * @returns {Promise<Object>}    `{ course, lesson, material }` when every link
 *                               holds, otherwise a Boom `notFound`
 */
function resolveMaterialContext(courseId, lessonId, materialId) {
  return Course.findById(courseId)
    .then(function(course) {
      if (!course || !containsId(course.lessons, lessonId)) {
        return errors.notFound();
      }

      return Lesson.findById(lessonId)
        .then(function(lesson) {
          if (!lesson || !containsId(lesson.materials, materialId)) {
            return errors.notFound();
          }

          return Material.findById(materialId)
            .then(function(material) {
              if (!material) {
                return errors.notFound();
              }

              return {
                  course   : course
                , lesson   : lesson
                , material : material
              };
            });
        });
    });
}

/**
 * True only if `trinket` is the assignment trinket that `material` publishes.
 *
 * SEC-F14. The legitimate client posts `material.trinket.trinketId` as `parent`
 * for both `startAssignment` and `submitAssignment`
 * (public/js/services/submissions.js:22-36), so the parent named by a payload
 * is only ever the material's own assignment trinket. Without this test the
 * handlers copied `code`, `assets` and `settings` off whatever trinket the
 * payload named, which is a read of arbitrary trinket content - including
 * another course's material and another user's private work.
 *
 * The RESOLVED document is compared rather than the raw payload string, which
 * keeps `Trinket`'s `shortCode` alternate id (lib/models/trinket.js:586) working
 * exactly as it did: any identifier that resolves to the material's own
 * assignment trinket is still accepted.
 *
 * @param   {Object} material  a material proved to belong to the authorized course
 * @param   {Object} trinket   the trinket the payload's `parent` resolved to
 * @returns {Boolean}
 */
function isMaterialAssignmentTrinket(material, trinket) {
  // `updateMaterial` normalizes an array result from this same call, because
  // `Trinket.findById` resolves through an `$or` over `_id` and `shortCode`
  // (lib/models/model.js:115-150), so the same normalization is applied here
  // rather than assuming a single document.
  if (Array.isArray(trinket)) {
    trinket = trinket[0];
  }

  if (!material || !trinket || !material.trinket || !material.trinket.trinketId) {
    return false;
  }

  var resolvedId = trinket._id || trinket.id;

  return !!resolvedId && material.trinket.trinketId.toString() === resolvedId.toString();
}

/**
 * True only if `submission` is a submission of `materialId` inside `course`.
 *
 * SEC-F14. `sendFeedback`'s route declares only `course(params.courseId)`
 * (config/api_routes.js:602), so its `send-submission-feedback` check proves
 * the caller may give feedback in THAT course and nothing more. The trinket id
 * then arrived from the payload and was loaded unbound, so a course A teacher
 * could write feedback onto - and read the code of - any trinket in the
 * system, including course B submissions and personal trinkets.
 *
 * Both links are required because both are written by the submission handlers
 * from the same authorized path (`courseId` and `materialId` above), and
 * `autosaveFeedbackComments` already treats `submission.courseId` as the
 * authoritative course for exactly this permission.
 *
 * @param   {Object} submission  the trinket the payload's `trinketId` resolved to
 * @param   {Object} course      the authorized course, from `request.pre.course`
 * @param   {String} materialId  `{materialId}` from the path
 * @returns {Boolean}
 */
function isCourseSubmission(submission, course, materialId) {
  // Same normalization, and for the same reason, as
  // `isMaterialAssignmentTrinket` above.
  if (Array.isArray(submission)) {
    submission = submission[0];
  }

  if (!submission || !course || !materialId) {
    return false;
  }

  if (!submission.courseId || submission.courseId.toString() !== course.id.toString()) {
    return false;
  }

  return !!submission.materialId && submission.materialId.toString() === materialId.toString();
}

/**
 * True when a course payload asks for a private course.
 *
 * CMT-09. `courseType` is optional on both creation routes and the schema
 * defaults it to `public` (lib/models/course.js:29), so only an explicit
 * `private` is a request for one.
 *
 * @param   {Object} attributes  a course payload
 * @returns {Boolean}
 */
function isPrivateCourseRequested(attributes) {
  return !!attributes && attributes.courseType === 'private';
}

/**
 * True when `user` holds the site-level permission to create a private course.
 *
 * CMT-09. `create-private-course` is a site permission, which is the context
 * `hasPermission` applies when none is named
 * (lib/models/plugins/roles.js:400-405).
 *
 * @param   {Object} user  the acting user document
 * @returns {Boolean}
 */
function hasPrivateCoursePermission(user) {
  return !!user && typeof user.hasPermission === 'function' && user.hasPermission('create-private-course');
}

/**
 * True when `user` may read `course`'s content.
 *
 * SEC-F13. This is NOT a new rule. It is the expression the application already
 * uses to decide whether a course's content may be shown, taken from the two
 * places that own that decision today: the course page
 * (`classes.viewClass`, lib/controllers/classes.js:142-143) and the course
 * list on a user's classes page (lib/controllers/classes.js:121-122). The
 * three API reads gated with it - `getCourse`, `getLesson`, `getMaterial` -
 * serve the very data those pages render, and declare no `auth`, so they were
 * reachable anonymously with only their containment pre-handlers applied. A
 * twin of this predicate gates `classes.getClass`; see its comment there for
 * why the expression is written twice rather than shared.
 *
 * Two arms, matching that rule exactly:
 *
 *   - `public` and `open` courses are readable by anyone, which is what keeps
 *     an anonymous read of a public course answering 200 (the behaviour
 *     test/lib/api/course.js:499-508 pins, and the schema default every course
 *     created without a `courseType` takes - lib/models/course.js:30);
 *   - otherwise the caller must hold `view-course-content` for THIS course.
 *     Every course role grants it - `course-owner`, `course-collaborator`,
 *     `course-admin`, `course-student` and `course-associate`
 *     (lib/models/roles.js:46-76) - so every member of the course passes, and
 *     `hasPermission` resolves it against the `course:<id>` context only
 *     (lib/models/plugins/roles.js:400-421), so a role on another course does
 *     not carry over.
 *
 * `archived` is deliberately NOT part of the test, even though `viewClass`
 * checks it. There, an archived course falls back to a featured-course list
 * because it is a page with something else to render; here, these routes are how
 * an owner reads an archived course in order to restore it (`archiveCourse`),
 * and archiving is a lifecycle state rather than a visibility one.
 *
 * `demo`, the fourth `courseType` in the enum, is not granted public access -
 * again matching the existing rule. No code in the repository assigns it.
 *
 * @param   {Object} user    the acting user document, from `request.user`, or
 *                           undefined for an anonymous caller
 * @param   {Object} course  the resolved course, from `request.pre.course`
 * @returns {Boolean}
 */
function canViewCourseContent(user, course) {
  var courseType;

  if (!course) {
    return false;
  }

  courseType = course.globalSettings && course.globalSettings.courseType;

  if (courseType === 'public' || courseType === 'open') {
    return true;
  }

  return !!user
      && typeof user.hasPermission === 'function'
      && user.hasPermission('view-course-content', 'course', { id : course.id });
}

/**
 * True when `user` may read `course`'s UNPUBLISHED content.
 *
 * SEC-F13, the draft half. The permissions are the two `getCourse` already
 * computes as `canEdit` and `canViewSubmissions`, and the disjunction is that
 * handler's own behaviour: `withDraft` exposes drafts to a
 * `manage-course-content` holder, and `withDraftAssignments` exposes them - and
 * leaves draft LESSONS unfiltered - for a `view-assignment-submissions` holder.
 * Reusing the pair here keeps a single-document read and the outline that lists
 * it in agreement about who sees a draft.
 *
 * This is a strictly narrower set than `canViewCourseContent` above: it is asked
 * only after that test has already passed, so a `public` course does not expose
 * its drafts to the world.
 *
 * @param   {Object} user    the acting user document, from `request.user`, or
 *                           undefined for an anonymous caller
 * @param   {Object} course  the resolved course, from `request.pre.course`
 * @returns {Boolean}
 */
function canViewDraftCourseContent(user, course) {
  if (!course || !user || typeof user.hasPermission !== 'function') {
    return false;
  }

  return user.hasPermission('manage-course-content', 'course', { id : course.id })
      || user.hasPermission('view-assignment-submissions', 'course', { id : course.id });
}

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
 * True only if `invitation` is an invitation to `course`.
 *
 * SEC-F15. Both invitation mutations authorize `manage-course-access` against
 * the course named in the path and then act on an invitation resolved by id
 * alone - `removeInvitation` through its own `findById`, `updateInvitation`
 * through the `invitation(params.invitationId)` pre-handler - so a manager of
 * one course could alter or delete another course's invitation.
 *
 * A falsy invitation is also rejected: `findById` resolves `null` for an
 * unknown id, and the delete path then threw a TypeError that was answered as
 * a 500.
 *
 * @param   {Object} invitation  a CourseInvitation document, or null
 * @param   {Object} course      the authorized course, from `request.pre.course`
 * @returns {Boolean}
 */
function isCourseInvitation(invitation, course) {
  if (!invitation || !course || !invitation.courseId) {
    return false;
  }

  return invitation.courseId.toString() === course.id.toString();
}

/**
 * Generates a course-invitation token.
 *
 * SEC-F27. The token is the sole credential on `GET /courses/accept/{token}`
 * (config/routes.js:189), which is looked up with a plain
 * `findOne({ token })` (lib/models/courseInvitation.js:118) against an
 * unvalidated path parameter, so it must be unguessable rather than derivable.
 * 16 bytes from the platform CSPRNG - 128 bits, rendered as 32 hex characters -
 * replaces the 8-character md5 of the invitee's address and the course id.
 *
 * The length and alphabet are chosen for what consumes the value: it travels in
 * a URL path segment, so hex needs no encoding; the schema constrains neither
 * length nor charset (`token : { type: String, required: true, index: true }`);
 * and the route declares no `{token}` validation, so nothing rejects a longer
 * value. 128 bits is the standard bar for a bearer credential and makes the
 * search space unreachable, where 32 bits was enumerable even without the
 * derivation.
 *
 * @returns {String}  32 hex characters, 128 bits of entropy
 */
function generateInvitationToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Generates a course access code.
 *
 * SEC-F40. The code is the sole credential for `POST /api/courses/join`, which
 * enrols the caller in the course it names, so it is a bearer credential and is
 * drawn from `crypto` rather than from `Math.random`. `Math.random` is seeded
 * per process and its output stream is recoverable from a handful of observed
 * values, which made previously issued codes - and codes about to be issued -
 * predictable to anyone who had seen one; `crypto.randomInt` draws from the
 * platform CSPRNG and rejection-samples internally, so each character is
 * uniform over the alphabet with no modulo bias.
 *
 * The alphabet, the length and the return type are deliberately unchanged: the
 * 54 characters below are the visually unambiguous subset (no I, O, l or o, no
 * 0 or 1), the code is what a teacher reads out and a student types, and
 * `Course.findByAccessCode` (lib/models/course.js:280) matches it as a plain
 * indexed string.
 *
 * Entropy is one half of that finding; the other half - bounding how many codes
 * a caller may try - is enforced on the consuming side, by
 * `reserveAccessCodeAttempt` and `releaseAccessCodeAttempt` below, and by the
 * twin ledger `lib/controllers/classes.js` keeps for the link route. Note what
 * CSPRNG selection does and does not buy: it removes the predictability of the
 * `Math.random` stream, but six characters over 54 is still only about 34.5
 * bits, so the attempt bound rather than the entropy is what makes online
 * guessing impractical.
 *
 * @returns {String}  a six-character code over the fixed alphabet
 */
function generateAccessCode() {
  var code     = []
    , possible = "ABCDEFGHJKLMNPRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"
    , i;

  for (i = 0; i < 6; i++) {
    code.push(possible.charAt(crypto.randomInt(possible.length)));
  }

  return code.join("");
}

// SEC-F40, the throttling half. Access-code attempts, held only for the length
// of the window below.
//
// Two keys are reserved together for each attempt: the acting account, and the
// caller's remote address. The account key is the precise one - `join` requires
// a session - and the address key is what stops the account key being shed by
// registering fresh accounts. Either being exhausted refuses the attempt.
//
// The store is per process, which is what this application can offer: Redis is
// `enabled: false` in committed configuration and the queue it does run is
// in-memory, so there is no shared counter to write to. The deployed image runs
// one process - `CMD ["pm2-docker", "start", "app.js"]` with no `-i` - so the
// bound below is the bound a deployed instance applies; behind a multi-process
// front end it becomes per worker, which still turns unbounded guessing into a
// bounded rate. An authoritative cluster-wide limit belongs at the edge, and
// that is recorded as the residual rather than approximated here.
var ACCESS_CODE_ATTEMPT_LIMIT  = 10
  , ACCESS_CODE_ATTEMPT_WINDOW = 15 * 60 * 1000
  , accessCodeAttempts         = new Map();

/**
 * Drops attempt records whose window has passed.
 *
 * Called on every reservation, which is what keeps the map bounded without a
 * timer: an entry lives for at most one window after the first attempt it
 * counted, so the map holds only the identities that have guessed wrongly
 * inside it. A timer would also keep the event loop alive and change process
 * shutdown behaviour.
 *
 * @param {Number} now  the current epoch milliseconds
 */
function pruneAccessCodeAttempts(now) {
  accessCodeAttempts.forEach(function(record, key) {
    if (now - record.first >= ACCESS_CODE_ATTEMPT_WINDOW) {
      accessCodeAttempts.delete(key);
    }
  });
}

/**
 * The ledger keys an attempt is counted against.
 *
 * @param   {Object} user           the acting user document, or undefined
 * @param   {String} remoteAddress  `request.info.remoteAddress`, or undefined
 * @returns {Array<String>}         zero or more namespaced keys
 */
function accessCodeAttemptKeys(user, remoteAddress) {
  var keys = [];

  if (user && user.id) {
    keys.push('user:' + user.id.toString());
  }

  if (remoteAddress) {
    keys.push('addr:' + remoteAddress);
  }

  return keys;
}

/**
 * Reserves one access-code attempt, or refuses it.
 *
 * Checking and counting happen in ONE synchronous call on purpose. That is what
 * makes a parallel burst safe: JavaScript runs this to completion before the
 * next request's copy of it starts, so simultaneous callers are serialized
 * through the counter and only the first `ACCESS_CODE_ATTEMPT_LIMIT` of them
 * proceed. A check that returned before an asynchronous lookup, with the
 * counting done afterwards, would let an entire burst through on a single
 * unexhausted reading.
 *
 * The window starts at the first attempt a key counted and is not extended by
 * later ones, so an identity that exhausts its allowance is released a fixed
 * window after that first attempt rather than being held indefinitely by a
 * guesser that keeps trying.
 *
 * A caller with neither an identity nor an address is not refused: that
 * combination cannot arise over HTTP (hapi always populates
 * `request.info.remoteAddress`), and refusing it would add an unreachable
 * branch that no request can exercise.
 *
 * @param   {Object} user           the acting user document, or undefined
 * @param   {String} remoteAddress  `request.info.remoteAddress`, or undefined
 * @returns {Boolean}               true when the attempt may proceed
 */
function reserveAccessCodeAttempt(user, remoteAddress) {
  var now  = Date.now()
    , keys = accessCodeAttemptKeys(user, remoteAddress)
    , i, record;

  pruneAccessCodeAttempts(now);

  for (i = 0; i < keys.length; i++) {
    record = accessCodeAttempts.get(keys[i]);

    if (record && record.count >= ACCESS_CODE_ATTEMPT_LIMIT) {
      return false;
    }
  }

  keys.forEach(function(key) {
    var existing = accessCodeAttempts.get(key);

    if (existing) {
      existing.count += 1;
    }
    else {
      accessCodeAttempts.set(key, { first : now, count : 1 });
    }
  });

  return true;
}

/**
 * Gives back a reservation whose lookup found a real course.
 *
 * A code that resolved is not a guess, so it must not consume an allowance; a
 * teacher enrolling a class from one link, or a student joining several
 * courses, would otherwise be throttled for succeeding. The record is deleted
 * once its count reaches zero so a successful caller leaves nothing behind.
 *
 * @param {Object} user           the acting user document, or undefined
 * @param {String} remoteAddress  `request.info.remoteAddress`, or undefined
 */
function releaseAccessCodeAttempt(user, remoteAddress) {
  accessCodeAttemptKeys(user, remoteAddress).forEach(function(key) {
    var record = accessCodeAttempts.get(key);

    if (!record) {
      return;
    }

    record.count -= 1;

    if (record.count <= 0) {
      accessCodeAttempts.delete(key);
    }
  });
}
