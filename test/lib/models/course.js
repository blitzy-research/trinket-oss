var _        = require('underscore'),
    sinon    = require('sinon'),
    should   = require('chai').should(),
    defaults = require('../../helpers/defaults'),
    db       = require('../../helpers/db'),
    ownable     = require('../../../lib/models/plugins/ownable'),
    ObjectId    = require('mongoose').Types.ObjectId;

describe('Course model', function(){
  describe('plugins', function() {
    it('should implement the ownable plugin', function() {
      var plugin = _.find(Course.plugins, function(plugin) {
        return Array.isArray(plugin) && plugin[0] === ownable;
      });
      should.exist(plugin);
    });
  });

  /**
   * `Course#copy` — the deep-copy contract, at all three levels.
   *
   * The test propagates every error, asserts the copy is a genuine DEEP copy of course, lesson and material —
   * new identities, equal content, re-owned, and the originals unmutated — and removes every document it
   * created whatever the outcome. Asserting merely that a `lessons` property exists would not do: an empty
   * array satisfies that, so a copy that silently lost every lesson and material would pass.
   */
  describe('object methods', function() {
    describe('copy', function() {
      var created = [];

      /** Records a document for cleanup and hands it back, so cleanup cannot be forgotten. */
      function track(doc) {
        created.push(doc);

        return doc;
      }

      /**
       * The id of a reference, whichever of its three shapes Mongoose happens to be holding.
       *
       * `new Course({ _owner : userDocument })` keeps the DOCUMENT in the path until the copy is re-read,
       * so `_owner` is a User document here and an ObjectId there. Stringifying a document yields its
       * inspect output rather than its id, which would make every ownership comparison below compare a
       * multi-line dump against a hex string.
       */
      function idOf(reference) {
        if (!reference) {
          return String(reference);
        }

        return String(reference._id ? reference._id : reference);
      }

      afterEach(function() {
        this.timeout(60000);

        // In afterEach rather than at the end of the test body: a failing assertion must not be able to leave
        // fixtures behind in the shared database. Removal failures are aggregated and reported rather than
        // swallowed, so a leak is visible instead of silent.
        var pending = created;

        created = [];

        return Promise.all(pending.map(function(doc) {
          return doc.remove().then(function() {
            return null;
          }, function(err) {
            return err;
          });
        })).then(function(errors) {
          var failed = errors.filter(function(err) { return err; });

          if (failed.length) {
            throw new Error('Course model copy test left ' + failed.length + ' fixture(s) behind: ' +
                            failed.map(function(err) { return err.message; }).join('; '));
          }
        });
      });

      it('should copy all the things!', function() {
        this.timeout(60000);

        var owner = new User({
              fullname : 'test course owner',
              username : 'testcourseowner',
              email    : 'testcourseowner@email.com',
              password : 'password'
            }),
            user = new User({
              fullname : 'test user',
              username : 'testcopyuser',
              email    : 'testcopyuser@email.com',
              password : 'password'
            }),
            material,
            lesson,
            course;

        // Both users are PERSISTED rather than merely constructed. Unsaved documents leave `copy`'s
        // grant-adjacent paths operating on records no query can find, so saving them is what makes the
        // ownership assertions below meaningful.
        return track(owner).save().then(function() {
          return track(user).save();
        }).then(function() {
          material = track(new Material({
            name    : 'material name',
            content : 'material content',
            _owner  : owner
          }));

          return material.save();
        }).then(function() {
          lesson = track(new Lesson({
            name      : 'lesson name',
            _owner    : owner,
            materials : [material.id]
          }));

          return lesson.save();
        }).then(function() {
          course = track(new Course({
            name        : 'course name',
            description : 'course description',
            _owner      : owner,
            ownerSlug   : owner.username,
            lessons     : [lesson.id]
          }));

          return course.save();
        }).then(function() {
          // `copy` is callback-style, so it is wrapped once here. The rejection arm is what turns a
          // persistence failure into a NAMED failure instead of a TypeError or a timeout.
          return new Promise(function(resolve, reject) {
            course.copy(user, function(err, copy) {
              if (err) {
                return reject(err);
              }

              if (!copy) {
                return reject(new Error('Course#copy called back with neither an error nor a copy'));
              }

              return resolve(track(copy));
            });
          });
        }).then(function(copy) {
          // The copied course.
          copy.should.have.property('name', course.name);
          copy.should.have.property('description', course.description);
          copy.should.have.property('lessons');
          // A NEW course, not the same document handed back.
          idOf(copy.id).should.not.eql(idOf(course.id));
          // Re-owned, and its denormalized owner slug re-derived from the new owner.
          idOf(copy._owner).should.eql(idOf(user.id));
          copy.should.have.property('ownerSlug', user.username);
          // The original is untouched.
          idOf(course._owner).should.eql(idOf(owner.id));
          course.should.have.property('ownerSlug', owner.username);

          // The copied lesson: exactly one, with a new identity.
          copy.lessons.length.should.eql(1, 'the copy must carry exactly one lesson');
          idOf(copy.lessons[0]).should.not.eql(idOf(lesson.id));
          course.lessons.length.should.eql(1, 'the original must still carry its own lesson');
          idOf(course.lessons[0]).should.eql(idOf(lesson.id));

          return Lesson.findById(copy.lessons[0]).then(function(lessonCopy) {
            should.exist(lessonCopy, 'the copied lesson must be persisted, not just referenced');
            track(lessonCopy);
            lessonCopy.should.have.property('name', lesson.name);
            idOf(lessonCopy._owner).should.eql(idOf(user.id));

            // The copied material: exactly one, with a new identity and equal content.
            lessonCopy.materials.length.should.eql(1, 'the copied lesson must carry its material');
            idOf(lessonCopy.materials[0]).should.not.eql(idOf(material.id));

            return Material.findById(lessonCopy.materials[0]).then(function(materialCopy) {
              should.exist(materialCopy, 'the copied material must be persisted');
              track(materialCopy);
              materialCopy.should.have.property('name', material.name);
              materialCopy.should.have.property('content', material.content);
              idOf(materialCopy._owner).should.eql(idOf(user.id));

              // The originals are unmutated at every level.
              return Material.findById(material.id).then(function(original) {
                should.exist(original, 'the original material must survive the copy');
                original.should.have.property('content', 'material content');
                idOf(original._owner).should.eql(idOf(owner.id));
              });
            });
          });
        });
      });
    })
  });
});
