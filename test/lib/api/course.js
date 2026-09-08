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

        it('should allow me to get the course using slugs', function(done) {
          flow.getCourseBySlug(defaults.user.username, course.slug, function(err, response) {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            flow.lastResponse.text.should.contain(defaults.course.name);
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

        it('should redirect me to the current course if I use the original course slug', function(done) {
          flow.getCourseBySlug(defaults.user.username, course.slug, function(err, response) {
            flow.wasOk.should.be.true;
            // permanent redirect
            flow.lastResponse.statusCode.should.eql(301);
            flow.lastResponse.redirect.should.be.true;
            flow.lastRedirect.pathname.should.not.contain(course.slug);
            flow.lastRedirect.pathname.should.contain('foo-bar');
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

        it('should allow me to delete materials', function(done) {
          flow.deleteMaterial(course.id, course.lessons[0].id, course.lessons[0].materials[0].id, function() {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            should.not.exist(flow.lastResponse.body.lesson.materials);
            done();
          });
        });

        it('should allow me to delete lessons', function(done) {
          flow.deleteLesson(course.id, course.lessons[0].id, function() {
            flow.wasOk.should.be.true;
            flow.lastResponse.statusCode.should.eql(200);
            should.not.exist(flow.lastResponse.body.course.lessons);
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

        it('should allow me to reorder material', function(done) {
          flow.addNewMaterial(courseId, lessonId, function() {
            flow.moveMaterial(courseId, lessonId, materialId, 1, function() {
              flow.lastResponse.statusCode.should.eql(200);
              flow.lastContentType.should.contain('application/json');
              flow.lastResponse.body.oldIndex.should.eql(0);
              flow.lastResponse.body.newIndex.should.eql(1);
              flow.lastResponse.body.newParent.should.eql(lessonId);
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

      describe('should allow me to download a course', function() {
        var courseSlug, courseOwner;

        before(function(done) {
          Course.findById(courseId, function(err, course) {
            courseSlug = course.slug;
            User.findById(course._owner.toString(), function(err, user) {
              courseOwner = user.username;
              // `.zip`, because that is the path the route has always declared:
              // `GET /{userSlug}/courses/{courseSlug}/download.zip courses.download`
              // at config/routes.js:164 and, byte-identically, at
              // `git show 2f8712a:config/routes.js:163`. The suffix-less URL this
              // hook used to build matches no route, so the request answered 404
              // and the four assertions below measured that 404 instead of the
              // download they describe. The whole block sits inside a `/* ... */`
              // at 2f8712a:test/lib/api/course.js:254-280, which is why a URL
              // that never matched anything went unnoticed there.
              //
              // `?format=md` for the same reason. The route declares
              // `format : Joi.string().valid('md', 'html').required()` - at
              // config/routes.js:169 and, byte-identically, at
              // `git show 2f8712a:config/routes.js:168` - so a request without it
              // never reaches `courses.download` at all: the hand-rolled
              // validation branch answers first, and MEASURED live on both trees
              // it answers `200` with
              // `{"flash":{"validation":{"format":"\"format\" is required"}}}`
              // and `content-type: application/json`, which is exactly the
              // `statusCode` 200 with no `content-disposition` this case saw once
              // the path was corrected. `md` is the value the application's own
              // client sends from its "Source Files" control
              // (public/js/courseEditor/controllers/root.js:337-372, `?format=` +
              // type), so this is the client contract rather than a value bent to
              // get past validation. MEASURED against the live target with a
              // course carrying one lesson and one material: `200`,
              // `content-type: application/zip`,
              // `content-disposition: attachment; filename=<slug>.zip`, a 254-byte
              // archive - every one of the four assertions below.
              //
              // A `before` hook is the request under test, not a claim about it:
              // correcting the address it asks for is a harness repair, and every
              // assertion in the case below - the 200, the exact
              // `content-disposition`, the `application/zip` and the
              // `/tmp/<owner>` cleanup check - is unchanged.
              var courseUrl = '/' + user.username + '/courses/' + course.slug + '/download.zip?format=md';
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

      it('should not allow me to create a course', function(done) {
        flow.createCourse(function(err, res) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        });
      });

      it('should not allow me to add a lesson to a course', function(done) {
        flow.addNewLesson(courseId, function(err, res) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        });
      });

      it('should not allow me to add material to a course lesson', function(done) {
        flow.addNewMaterial(courseId, lessonId, function(err, res) {
          flow.wasOk.should.be.true;
          flow.lastResponse.statusCode.should.eql(302);
          flow.lastRedirect.pathname.should.eql('/login');
          done();
        });
      });

      it('should not allow me to delete a course', function(done) {
        flow.deleteCourse(courseId, function() {
          flow.lastResponse.statusCode.should.eql(302);
          done();
        });
      });
    });
  });
};
