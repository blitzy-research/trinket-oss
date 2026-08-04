var sinon    = require('sinon'),
    should   = require('chai').should(),
    fs       = require('fs'),
    flow     = require('../../helpers/flow'),
    defaults = require('../../helpers/defaults');

// Review finding M6 (CWE-200 / CWE-522) sentinels - the same pair test/lib/api/admin.js uses. See the
// annotated describe near the foot of this file.
var GOOGLE_TOKEN_SENTINEL = 'ya29.M6-SENTINEL-GOOGLE-BEARER-TOKEN',
    GOOGLE_ID_SENTINEL    = 'M6-SENTINEL-GOOGLE-ID';

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

        // ADDED COVERAGE (review finding F-05). The outline query has two readings and both of them are
        // baseline behaviour. `?outline=yes` - the form test/helpers/flow.js#getCourseWithOutline has sent
        // since the base commit - is REJECTED by `Joi.boolean()` (config/api_routes.js:L40), so the route
        // answers its validation flash and carries no `data`; the boolean form the frozen AngularJS client
        // sends is accepted and answers the course. An earlier revision of the harness swapped the first
        // for the second, which made the `When I edit an existing course` suite pass by testing a
        // different outcome. Both are pinned here so the substitution cannot recur silently, and neither
        // existing assertion was touched to make room for them.
        it('should reject a non-boolean outline query and answer the validation flash', function(done) {
          flow.getCourseWithOutline(courseId, function(err, response) {
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastContentType.should.contain('application/json');
            should.not.exist(flow.lastResponse.body.data);
            flow.lastResponse.body.should.have.property('flash');
            // Measured on this tree: the whole body is
            // {"flash":{"validation":{"outline":"\"outline\" must be a boolean"}}} - the raw Joi message,
            // because the custom-message lookup never fires (preserved quirk 1.2).
            flow.lastResponse.body.flash.validation.should.have.property('outline',
              '"outline" must be a boolean');
            done();
          });
        });

        it('should accept the boolean outline query the browser client sends', function(done) {
          flow.getCourseWithBooleanOutline(courseId, function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastContentType.should.contain('application/json');
            should.exist(flow.lastResponse.body.data);
            flow.lastResponse.body.data.should.have.property('id', courseId);
            // `lessons` is what the outline query adds - measured key set on this tree:
            // id, name, slug, description, lessons, _owner, globalSettings, ownerSlug, archived.
            flow.lastResponse.body.data.should.have.property('lessons');
            done();
          });
        });
      });

      describe('When I edit an existing course', function() {
        before(function(done) {
          flow.addNewLesson(course.id, function() {
            flow.addNewMaterial(course.id, flow.lastResponse.body.data.id, function() {
              // The accepted boolean form, because this hook must actually RETURN the outline for the
              // suite below to have a fixture. The base commit's `?outline=yes` is preserved on
              // flow#getCourseWithOutline and its rejection is asserted above; using it here would
              // leave `body.data` undefined and prevent every test in this block from executing.
              flow.getCourseWithBooleanOutline(course.id, function() {
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

        // R-6 ADJUDICATION, MEASURED - see docs/PRESERVED-QUIRKS.md (Q2). The stale-slug redirect this
        // test described has never existed on the wire: a pre-handler cannot redirect by returning a
        // value, so `request.pre.course` arrives null and every consumer's dereference becomes a
        // scrubbed 500. Asserting 301 would demand the behaviour improvement R-4 forbids.
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

        // R-6 ADJUDICATION, MEASURED - see docs/PRESERVED-QUIRKS.md. `lib/models/model.js#serialize` is
        // byte-identical at the base commit and its array branch is unconditional, so an emptied list is
        // serialized as `[]` and never omitted. Asserting the empty array is strictly STRONGER than
        // asserting absence: it proves the material really was pulled.
        it('should allow me to delete materials', function(done) {
          flow.deleteMaterial(course.id, course.lessons[0].id, course.lessons[0].materials[0].id, function() {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastResponse.body.lesson.materials.should.eql([]);
            done();
          });
        });

        // R-6 ADJUDICATION - the same unconditional array branch, here for `lessons`. See the twin above.
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

        // R-6 ADJUDICATION, MEASURED - see docs/PRESERVED-QUIRKS.md. A same-lesson reorder never reaches
        // the handler: `internals.findById`'s argument juggling (byte-identical at the base commit) moves
        // the Lesson document into its `next` slot when the payload carries no `parent`, and calling a
        // Mongoose document throws. The 500 is inherited, and client-reachable. Repairing the helper
        // would be the behaviour improvement R-4 forbids.
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

      // Review finding M6 (CWE-200 / CWE-522). Added coverage, not a rewrite of anything above.
      // `Course.publicSpec` whitelists `_owner` and `setOwner` assigns the populated User DOCUMENT, so
      // the owner is JSON-cloned whole into this response. A remediation that removed only the
      // top-level `password` therefore still shipped the owner's live Google OAuth bearer credential
      // from `profiles.google.token` - into the API body AND, through the server.inject consumer in
      // lib/controllers/courses.js#create, into POST /courses as well. Both are asserted.
      //
      // The sentinel is added to the owner document in `before` and removed again in `after`, so the
      // shared user the remaining suites depend on is left exactly as it was found.
      describe('when the course owner is linked to Google', function() {
        var owner, ownerCourseId;

        before(function(done) {
          flow.switchUser('user', done);
        });

        before(function(done) {
          User.findByLogin(defaults.user.email, function(err, doc) {
            if (err) return done(err);
            owner = doc;
            owner.profiles = { google : { id : GOOGLE_ID_SENTINEL, token : GOOGLE_TOKEN_SENTINEL } };
            owner.markModified('profiles');
            owner.save(function(saveErr) {
              done(saveErr);
            });
          });
        });

        after(function(done) {
          owner.profiles = {};
          owner.markModified('profiles');
          owner.save(function(err) {
            done(err);
          });
        });

        after(function(done) {
          if (!ownerCourseId) return done();
          flow.deleteCourse(ownerCourseId, function() {
            done();
          });
        });

        it('should not disclose the owner provider token in the API course response', function(done) {
          flow.createCourse({ name : 'M6 api course' }, function(err, response) {
            flow.lastResponse.statusCode.should.eql(200);
            ownerCourseId = flow.lastResponse.body.course.id;
            flow.lastResponse.body.course._owner.should.have.property('username', defaults.user.username);
            flow.lastResponse.body.course._owner.profiles.google.should.have.property('id', GOOGLE_ID_SENTINEL);
            flow.lastResponse.body.course._owner.profiles.google.should.not.have.property('token');
            flow.lastResponse.body.course._owner.should.not.have.property('password');
            flow.lastResponse.text.should.not.contain(GOOGLE_TOKEN_SENTINEL);
            done();
          });
        });

        it('should not disclose the owner provider token through the POST /courses inject consumer',
          function(done) {
            // Requesting JSON keeps the declarative `html : { redirect : ... }` branch out of the way so
            // the injected body itself is what lands on the wire.
            flow.post('/courses')
              .set('accept', 'application/json')
              .send(defaults.extend({ name : 'M6 inject course' }, 'course'))
              .end(function(err, response) {
                should.not.exist(err);
                response.statusCode.should.eql(200);
                response.text.should.not.contain(GOOGLE_TOKEN_SENTINEL);
                if (response.body && response.body.course) {
                  response.body.course._owner.profiles.google.should.not.have.property('token');
                  response.body.course._owner.should.not.have.property('password');
                  flow.deleteCourse(response.body.course.id, function() {
                    done();
                  });
                  return;
                }
                done();
              });
          });
      });
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

      // R-6 ADJUDICATION, MEASURED - see docs/PRESERVED-QUIRKS.md. app.js's first `onPreResponse`
      // (byte-identical at the base commit) converts a 401 into a /login redirect ONLY when the request
      // is NOT an `/api/` request, and all four helpers below target `/api/` paths, so 302 is unreachable
      // at either commit. The 302-to-/login contract is still covered on the HTML surface by
      // test/lib/api/files.js and test/lib/api/logout.js.
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
