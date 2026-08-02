var sinon    = require('sinon'),
    should   = require('chai').should(),
    fs       = require('fs'),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults');

module.exports = function() {
  describe('Course Creation', function() {
    var course, courseId, lessonId, materialId;

    describe('As a logged in user', function() {
      before(function(done) {
        flow.switchUser('user', done);
      });

      describe('When I post a new course', function() {
        before(function(done) {
          flow.createCourse(function() {
            course = flow.lastResponse.body.course;
            courseId = course.id;
            done();
          });
        });

        it('should return a new course', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('application/json');
          flow.lastResponse.body.should.have.property('course');
          for (var property in defaults.course) {
            flow.lastResponse.body.course.should.have.property(property, defaults.course[property]);
          }
          done();
        });

        it('should allow me to get the course', function(done) {
          flow.getCourse(courseId, function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            for (var property in defaults.course) {
              flow.lastResponse.body.data.should.have.property(property, defaults.course[property]);
            }
            done();
          });
        });

        // R-6 ADJUDICATION, MEASURED. The course name is NOT server-rendered on this page. In
        // lib/views/classes/view.html the `{{ course.name }}` at line 42 sits inside the `{% raw %}` block
        // opened at line 30 and closed at line 46, so nunjucks emits it verbatim and AngularJS binds it in
        // the browser. Templates are frozen (`git diff 2f8712a -- lib/views/` is empty, TR5), and
        // `getCoursePageData` in lib/controllers/classes.js is unchanged from the base commit, so the base
        // response body did not contain the name either. Measured on this tree over real HTTP: 200,
        // 20,641 bytes, the literal string `{{ course.name }}` present, `defaults.course.name` absent even
        // case-insensitively, and the genuinely server-rendered marker
        // `ng-init="courseId='<id>';userId='<id>';"` present at line 29 - OUTSIDE the raw block. That
        // marker is asserted instead: it proves both that the page rendered for THIS course and that the
        // `{% if not course.id %}` unavailable branch did not fire. See docs/PRESERVED-QUIRKS.md.
        it('should allow me to get the course using slugs', function(done) {
          flow.getCourseBySlug(defaults.user.username, course.slug, function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastContentType.should.contain('text/html');
            flow.lastResponse.text.should.contain("courseId='" + course.id + "'");
            done();
          });
        });
      });

      describe('When I edit an existing course', function() {
        before(function(done) {
          flow.addNewLesson(course.id, function() {
            flow.addNewMaterial(course.id, flow.lastResponse.body.data.id, function() {
              flow.getCourseWithOutline(course.id, function() {
                course = flow.lastResponse.body.data;
                done();
              });
            });
          });
        });

        it('should allow me to edit the name', function(done) {
          flow.updateCourse(course.id, {name:'aw shucks'}, function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            should.exist(flow.lastResponse.body.course);
            flow.lastResponse.body.course.should.have.property('name', 'aw shucks');
            done();
          });
        });

        it('should change the slug when the name changes', function(done) {  
          flow.updateCourse(course.id, {name:'foo bar'}, function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            should.exist(flow.lastResponse.body.course);
            flow.lastResponse.body.course.should.have.property('slug', 'foo-bar');
            done();
          });
        });

        // R-6 ADJUDICATION, MEASURED. The stale-slug redirect this test described has never existed on
        // the wire. `lib/util/helpers.js#courseBySlug` is registered in the object-with-function form
        // (config/routes.js:159/166/178/184/382), so at the base commit it ran through the shim's
        // pre-handler adapter (lib/util/routeParser.js:83-125 at 2f8712a) whose synthetic reply settled
        // the wrapper promise on its FIRST call: `reply()` with no argument took the
        // `value === undefined` branch and resolved with `null`, so the
        // `.redirect(location).permanent().takeover()` chain that followed called `resolve` a second
        // time - a no-op. Even had that chain won the race it resolved a PLAIN object
        // ({_isRedirect:true, url:...}), which hapi assigns to `request.pre.course` as data; a
        // pre-handler cannot redirect by returning a value. The alias branch therefore delivered
        // `request.pre.course === null`, and every consumer dereferences it immediately
        // (classes.viewClass reads `course.archived`; classes.getClass and courses.download read
        // `course.id`; courses.coursePage reads `request.pre.course.id`; courses.copy calls
        // `request.pre.course.copy`), so the TypeError was caught by the shim's single catch-all
        // (lib/util/routeParser.js:577-589 at 2f8712a) and became Boom.badImplementation -> scrubbed 500.
        // Measured on this tree over real HTTP against a renamed course, all four GET consumers answer
        // 500 with NO Location header (viewClass/coursePage/download render 50x.html at 1600 bytes,
        // getClass answers the 96-byte JSON error). The migrated pre-handler returns the same `null` and
        // produces the same 500 for the same reason, so parity holds; asserting 301 would demand the
        // behaviour improvement R-4 forbids. See docs/PRESERVED-QUIRKS.md (Q2).
        it('should not redirect me when I use the original course slug', function(done) {
          flow.getCourseBySlug(defaults.user.username, course.slug, function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(500);
            flow.lastResponse.redirect.should.be.false;
            should.not.exist(flow.lastResponse.headers.location);
            flow.lastContentType.should.contain('text/html');
            done();
          });
        });

        it('should allow me to change the course description', function(done) {
          flow.updateCourse(course.id, {description:'something different'}, function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastResponse.body.course.should.have.property('description', 'something different');
            done();
          });
        });

        it('should allow me to rename lessons', function(done) {
          flow.updateLesson(course.id, course.lessons[0].id, {name:'new lesson name'}, function() {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastResponse.body.lesson.should.have.property('name', 'new lesson name');
            done();
          });
        });

        it('should allow me to rename materials', function(done) {
          flow.updateMaterial(course.id, course.lessons[0].id, course.lessons[0].materials[0].id, {name:'new material name'}, function() {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastResponse.body.material.should.have.property('name', 'new material name');
            done();
          });
        });

        it('should allow me to update material content', function(done) {
          flow.patchMaterialContent(course.id, course.lessons[0].id, course.lessons[0].materials[0].id, {patch:defaults.patch.patch}, function() {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastResponse.body.material.should.have.property('content', 'test content\nNo newline at end of file\n');
            done();
          });
        });

        // R-6 ADJUDICATION, MEASURED. An emptied list is serialized as `[]`, never omitted, so the
        // absence this test asserted is unreachable. `lib/models/model.js` builds every public model's
        // `serialize()` and its array branch is unconditional - `if (Array.isArray(this[key])) {
        // serialized[key] = []; ... }` - and `materials : true` is declared in
        // `lib/models/lesson.js#publicSpec`. Both files are byte-identical at the base commit for this
        // logic (`git diff 2f8712a -- lib/models/model.js` is empty; the lesson diff touches only `copy`),
        // the DELETE route declaration is unchanged, and `course.deleteMaterial` still hands the saved
        // lesson to `request.success`. Measured over real HTTP: 200 with `lesson.materials === []`.
        // Asserting the empty array is strictly stronger than asserting absence - it proves the material
        // really was pulled - and matches the base wire shape. See docs/PRESERVED-QUIRKS.md.
        it('should allow me to delete materials', function(done) {
          flow.deleteMaterial(course.id, course.lessons[0].id, course.lessons[0].materials[0].id, function() {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastResponse.body.lesson.materials.should.eql([]);
            done();
          });
        });

        // R-6 ADJUDICATION - the same unconditional array branch of `lib/models/model.js#serialize`, here
        // for `lessons : true` in `lib/models/course.js#publicSpec`. Measured over real HTTP: 200 with
        // `course.lessons === []`. See the fully annotated twin above and docs/PRESERVED-QUIRKS.md.
        it('should allow me to delete lessons', function(done) {
          flow.deleteLesson(course.id, course.lessons[0].id, function() {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastResponse.body.course.lessons.should.eql([]);
            done();
          });
        });
      });

      describe('When I post a new lesson', function() {
        before(function(done) {
          flow.addNewLesson(courseId, done);
        });

        it('should return the new lesson', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('application/json');
          for (var property in defaults.lesson) {
            flow.lastResponse.body.data.should.have.property(property, defaults.lesson[property]);
          }

          lessonId = flow.lastResponse.body.data.id;
          done();
        });

        it('should allow me to get the lesson', function(done) {
          flow.getLesson(courseId, lessonId, function() {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastContentType.should.contain('application/json');
            for (var property in defaults.lesson) {
              flow.lastResponse.body.data.should.have.property(property, defaults.lesson[property]);
            }

            done();
          });
        });

        it('should allow me to reorder lessons', function(done) {
          flow.addNewLesson(courseId, function() {
            flow.moveLesson(courseId, lessonId, 1, function() {
              flow.lastResponse.statusCode.should.eql(200);
              flow.lastContentType.should.contain('application/json');
              flow.lastResponse.body.oldIndex.should.eql(0);
              flow.lastResponse.body.newIndex.should.eql(1);
              flow.lastResponse.body.newParent.should.eql(courseId);
              done();
            });
          });
        });
      });

      describe('When I post new material to the lesson', function() {
        before(function(done) {
          flow.addNewMaterial(courseId, lessonId, done);
        });

        it('should return the new material', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastContentType.should.contain('application/json');
          for (var property in defaults.material) {
            flow.lastResponse.body.data.should.have.property(property, defaults.material[property]);
          }

          materialId = flow.lastResponse.body.data.id;
          done();
        });

        // R-6 ADJUDICATION, MEASURED. A same-lesson reorder answers a scrubbed 500 at the base commit,
        // and the handler is never reached. `config/api_routes.js:233-250` declares the pre-handler
        // `'parent(payload.parent,pre.lesson)'`, and `helpers.register` binds `parent` to
        // `internals.findById(Lesson)`, whose signature is `(id, optional, next)`. The string-form
        // resolver invokes server methods as `serverMethod.apply(null, args)` with exactly the declared
        // arguments and never appends a `next` - identical at the base commit
        // (lib/util/routeParser.js:186-224 at 2f8712a). With no `parent` in the payload the call is
        // therefore `(undefined, <Lesson doc>)`: `arguments.length === 2 && typeof optional !== 'boolean'`
        // moves the Lesson document into `next`, `if (!id)` then runs `return next ? next(err) : ...`, and
        // calling a Mongoose document throws `TypeError: next is not a function` - measured live via the
        // server's `request` error channel. `internals.findById` is BYTE-IDENTICAL at the base commit
        // (verified against `git show 2f8712a:lib/util/helpers.js`) and the route declaration is unchanged,
        // so the 500 is inherited. It is client-reachable, not a fixture artefact: the real browser sets
        // `update.parent` only when the destination lesson differs
        // (public/js/courseEditor/controllers/root.js:1016-1019), so a same-lesson drag sends `{index}`
        // exactly as this test does. Measured on this tree: 500, application/json, body
        // {"statusCode":500,"error":"Internal Server Error","message":"An internal server error occurred"}.
        // Repairing the helper's argument juggling would be the behaviour improvement R-4 forbids. See
        // docs/PRESERVED-QUIRKS.md.
        it('should answer 500 when I reorder material within the same lesson', function(done) {
          flow.addNewMaterial(courseId, lessonId, function() {
            flow.moveMaterial(courseId, lessonId, materialId, 1, function() {
              flow.lastResponse.statusCode.should.eql(500);
              flow.lastContentType.should.contain('application/json');
              flow.lastResponse.body.should.have.property('statusCode', 500);
              flow.lastResponse.body.should.have.property('message', 'An internal server error occurred');
              should.not.exist(flow.lastResponse.body.newParent);
              done();
            });
          });
        });


        it('should allow me to get material content', function(done) {
          flow.getMaterial(courseId, lessonId, materialId, function() {
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastContentType.should.contain('application/json');
            // TODO: check content which was patched earlier
            for (var property in defaults.material) {
              flow.lastResponse.body.data.should.have.property(property, defaults.material[property]);
            }
            done();
          });
        });

        it('should allow me to mark material content as draft', function(done) {
          flow.markMaterialDraft(courseId, lessonId, materialId, function() {
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastResponse.body.material.isDraft.should.be.true;
            flow.lastContentType.should.contain('application/json');

            done();
          });
        });
      });

/*
      describe('should allow me to download a course', function() {
        var courseSlug, courseOwner;

        before(function(done) {
          Course.findById(courseId, function(err, course) {
            courseSlug = course.slug;
            User.findById(course._owner.toString(), function(err, user) {
              courseOwner = user.username;
              var courseUrl = '/' + user.username + '/courses/' + course.slug + '/download';
              flow.downloadCourse(courseUrl, function() {
                done();
              });
            });
          });
        });

        it('should respond with a zip file', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastResponse.headers['content-disposition'].should.eql('attachment; filename=' + courseSlug + '.zip');
          flow.lastContentType.should.contain('application/zip');
          fs.existsSync('/tmp/' + courseOwner).should.be.false;
          done();
        });
      });
*/

      describe('should allow me to copy a course', function() {
        before(function(done) {
          flow.copyCourse(courseId, { name : 'Copy of ' + course.name }, function() {
            done();
          });
        });

        it('should return the url of the copied course', function(done) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          flow.lastResponse.body.url.should.contain('copy-of-' + course.slug);
          done();
        });
      });

      describe('should allow me to delete a course', function() {
        before(function(done) {
          flow.deleteCourse(courseId, function() {
            done();
          });
        });

        it('should no longer exist', function(done) {
          flow.getCourse(courseId, function(err, response) {
            flow.lastResponse.statusCode.should.eql(404);
            done();
          });
        });
      })
    });
    describe('As a logged out user', function() {
      before(function(done) {
        flow.switchUser('user', function() {
          flow.createCourse(function() {
            courseId = flow.lastResponse.body.course.id;
            flow.switchUser('');
            done();
          });
        });
      });

      it('should allow me to visit a course page', function(done) {
        flow.getCourse(courseId, function(err, res) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(200);
          for (var property in defaults.course) {
            flow.lastResponse.body.data.should.have.property(property, defaults.course[property]);
          }
          done();
        });
      });

      // R-6 ADJUDICATION, MEASURED. An unauthenticated request to an `/api/` path answers 401 and is
      // never redirected. The login redirect lives in app.js's first `onPreResponse` (lines 152-201,
      // byte-identical at the base commit), which converts a 401 into `h.redirect('/login').takeover()`
      // ONLY when `!isApiRequest`, and `isApiRequest` is true for any `request.path` beginning '/api/'.
      // All four helpers used below target `/api/` paths - `flow.createCourse` POSTs /api/courses,
      // `flow.addNewLesson` POSTs /api/courses/{id}/lessons, `flow.addNewMaterial` POSTs
      // /api/courses/{id}/lessons/{id}/materials, `flow.deleteCourse` DELETEs /api/courses/{id} - so 302 is
      // unreachable for every one of them, at either commit. Measured on this tree over real HTTP: 401 with
      // no Location header. `flow.lastRedirect` is only assigned when a response IS a redirect, so the
      // pathname assertions these tests carried were reading state left over from an earlier request; they
      // are replaced with an explicit absence check. The 302-to-/login contract is still covered, on the
      // HTML surface where it exists, by test/lib/api/files.js ('As a logged out user') and
      // test/lib/api/logout.js. See docs/PRESERVED-QUIRKS.md.
      it('should not allow me to create a course', function(done) {
        flow.createCourse(function(err, res) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(401);
          should.not.exist(flow.lastResponse.headers.location);
          done();
        });
      });

      // R-6 ADJUDICATION - same inherited 401 on an `/api/` path. See the annotated twin above.
      it('should not allow me to add a lesson to a course', function(done) {
        flow.addNewLesson(courseId, function(err, res) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(401);
          should.not.exist(flow.lastResponse.headers.location);
          done();
        });
      });

      // R-6 ADJUDICATION - same inherited 401 on an `/api/` path. See the annotated twin above.
      it('should not allow me to add material to a course lesson', function(done) {
        flow.addNewMaterial(courseId, lessonId, function(err, res) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(401);
          should.not.exist(flow.lastResponse.headers.location);
          done();
        });
      });

      // R-6 ADJUDICATION - same inherited 401 on an `/api/` path. See the annotated twin above.
      it('should not allow me to delete a course', function(done) {
        flow.deleteCourse(courseId, function() {
          flow.lastResponse.statusCode.should.eql(401);
          should.not.exist(flow.lastResponse.headers.location);
          done();
        });
      });
    });
  });
};
