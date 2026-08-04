var mongoose    = require('mongoose'),
    ObjectId    = mongoose.Types.ObjectId,
    model       = require('./model'),
    ownable     = require('./plugins/ownable'),
    slug        = require('./plugins/slug'),
    config      = require('config'),
    courseStore = require('../util/store').courses(),
    featuredStore = require('../util/store').featured(),
    _           = require('underscore'),
    schema = {
      name           : { type: String, required: true },
      description    : { type: String },
      ownerSlug      : { type: String, required: true },
      lessons        : [{
        type : mongoose.SchemaTypes.ObjectId,
        ref  : 'Lesson'
      }],
      users        : [{
        _id         : false,
        userId      : { type: mongoose.SchemaTypes.ObjectId, ref: 'User' },
        username    : { type: String },
        displayName : { type: String },
        avatar      : { type: String },
        email       : { type: String },
        hideFrom    : [{ type: String }], // dashboard, all
        roles       : [{ type: String }],
        deleted     : { type: Boolean }
      }],
      globalSettings : {
        courseType : { type: String, enum: ['private', 'public', 'open', 'demo'], default: 'public' },
        contentDefault : { type: String, enum: ['publish', 'draft'], default: 'publish' },
        copyable : { type: Boolean, default: 'false' }
      },
      accessCode  : { type: String, index: true },
      externalLink : {
        source : { type: String },
        sourceId : { type: String, index: true }
      },
      archived: { type: Boolean, default: false }
    };

var MaterialParser = require('../util/material-parser.js');

function addUser(user, roles) {
  var context  = "course:" + this.id
    , self     = this
    , updateOptions = { new : true }
    , userRoles, courseUser, query, update;

  if (typeof roles === 'undefined' || roles.length === 0) {
    roles = ["course-student"];
  }

  userRoles = user.getByContext(context);

  if (userRoles && userRoles.roles.length) {
    return Promise.resolve({
      alreadyListed : true
    });
  }

  courseUser = {
      userId      : user.id
    , username    : user.username
    , displayName : user.name
    , email       : user.email
    , avatar      : user.normalizeAvatar()
    , roles       : roles
  };

  update = {
    "$push" : {
      "users" : courseUser
    }
  };

  return Course.publicModel.findByIdAndUpdate(this.id, update, updateOptions).exec()
    .then(function(course) {
      return user.grant(roles[0], "course", { id : self.id })
        .then(function() {
          return {
              success : true
            , user    : courseUser
          };
        });
    });
}

function removeUser(user) {
  var self     = this
    , update, updateOptions;

  update = {
    "$pull" : {
      "users" : {
        "userId" : user.id
      }
    }
  };
  updateOptions = { new : true };

  return Course.publicModel.findByIdAndUpdate(this.id, update, updateOptions).exec()
    .then(function(course) {
      return user.revokeAll("course", { id : self.id });
    });
}

function removeDeletedUser(userId) {
  var update, updateOptions;

  update = {
    "$pull" : {
      "users" : {
        "userId" : userId
      }
    }
  };
  updateOptions = { new : true };

  return Course.publicModel.findByIdAndUpdate(this.id, update, updateOptions).exec();
}

function updateRole(user, role) {
  var self     = this
    , query, update, updateOptions;

  query = {
      _id   : this.id
    , users : {
        "$elemMatch" : {
          userId : user.id
        }
      }
  };

  update = {
    "$set" : {
      "users.$.roles" : [role]
    }
  };

  updateOptions = { new : true };

  return Course.privateModel.updateOne(query, update, updateOptions).exec()
    .then(function(result) {
      return user.revokeAll("course", { id : self.id });
    })
    .then(function() {
      return user.grant(role, "course", { id : self.id });
    });
}

function updateView(userId, view, action) {
  var self     = this
    , update   = {}
    , query, updateKey, updateOptions;

  query = {
      _id   : this.id
    , users : {
        "$elemMatch" : {
          userId : userId
        }
      }
  };

  updateKey = action === "hide" ? "$push" : "$pull";

  update[updateKey] = {
    "users.$.hideFrom" : view
  };

  updateOptions = { new : true };

  return Course.privateModel.updateOne(query, update, updateOptions).exec();
}

function deleteCourse() {
  var self = this
    , promises;

  // revoke roles for all users
  if (this.users.length) {
    promises = this.users.map(function(user) {
      return User.findById(user.userId)
        .then(function(user) {
          if (user) {
            return user.revokeAll("course", { id : self.id });
          }
          else {
            return Promise.resolve();
          }
        });
    });
  }
  else {
    promises = [Promise.resolve()];
  }

  return Promise.all(promises)
    .then(function() {
      return self.deleteOne();
    });
}

function userUpdate(user) {
  var promises
    , updateOptions = { new : true }
    , context, query, update;

  promises = user.roles.map(function(role) {
    if (/^course:/.test(role.context)) {
      context = role.context.split(':');
      query = {
        _id : new ObjectId(context[1]),
        users : {
          "$elemMatch" : {
            userId : user.id
          }
        }
      };
      update = {
        "$set" : {
          "users.$.username"    : user.username,
          "users.$.displayName" : user.name,
          "users.$.avatar"      : user.normalizeAvatar()
        }
      };

      if (role.roles.indexOf("course-owner") >= 0) {
        update.$set.ownerSlug = user.username;
      }

      return Course.privateModel.updateOne(query, update, updateOptions).exec();
    }
    else {
      return Promise.resolve();
    }
  });

  return Promise.all(promises);
}

function userDeleted(user) {
  var promises
    , updateOptions = { new : true }
    , context, query, update;

  promises = user.roles.map(function(role) {
    if (/^course:/.test(role.context)) {
      context = role.context.split(':');
      query = {
        _id : new ObjectId(context[1]),
        users : {
          "$elemMatch" : {
            userId : user.id
          }
        }
      };
      update = {
        "$set" : {
          "users.$.deleted" : true
        }
      };

      return Course.privateModel.updateOne(query, update, updateOptions).exec();
    }
    else {
      return Promise.resolve();
    }
  });

  return Promise.all(promises);
}

function findByUserAndSlug(userId, courseSlug, cb) {
  return this.model.findOne({ _owner: userId, slug: courseSlug }, cb);
}

function findByAccessCode(code, cb) {
  return this.model.findOne({ accessCode: code }, cb);
}

function findByExternalId(id, cb) {
  return this.model.findOne({ "externalLink.sourceId": id }, cb);
}

function preserveSlug() {
  this._original_slug = this.slug;
}

function ensureSlugAlias() {
  if (this._original_slug === this.slug) return;

  courseStore.linkIdToSlug(this._original_slug, this.id);
}

/**
 * Copies this course, and every lesson and material under it, for `user`.
 *
 * Async conversion: the contract is promise-native and the returned promise is what the two
 * controllers await; `lib/controllers/courses.js#copy` and `lib/controllers/course.js#copyCourse` no
 * longer wrap this method in `util.promisify`. The optional error-first callback is RETAINED because a
 * base-commit assertion consumes it - `test/lib/models/course.js:58` calls
 * `course.copy(user, function (err, copy) { … })` - and R-4 freezes existing test assertions. When a
 * callback is supplied it is invoked exactly ONCE, from a two-argument `then` that cannot feed a throw
 * out of the callback back into it, which is the property the base commit's hand-written invocations
 * had.
 *
 * THE NO-RESPONSE OUTCOME IS PRESERVED, and it is preserved WITHOUT a never-settling promise
 * (review finding F6; docs/PRESERVED-QUIRKS.md sections 1.15, 3.39 and 3.40). At the base commit a
 * rejection from `Lesson.findById`, `lesson.copy` or a material copy reached neither the callback nor
 * any responder, so the request answered NOTHING and the shim's deferred was never settled. Retaining
 * that shape literally would now leave an unhandled rejection, which Node 22 escalates into a
 * process-fatal fault, and would retain the awaiting request for the lifetime of the server. So the
 * inner chain settles with the SILENT-OUTCOME SENTINEL from `lib/models/model.js#silentOutcome`, which
 * both controllers translate back into `h.abandon`: no status code and no body, exactly as measured,
 * with the rejection owned. The sentinel deliberately carries no `code`, so it can never be mistaken
 * for the `err.code === 11000` duplicate-name failure that the FIRST save reports and that
 * `lib/controllers/course.js#copyCourse` answers with a client-visible 200 payload. No `.catch` may be
 * added anywhere else in this function: a trailing one would merge the two channels and convert either
 * fate into a scrubbed 500.
 *
 * @param   {Object}   user The user the copy belongs to.
 * @param   {Function} [cb] Optional error-first callback, for the base-commit test contract.
 * @returns {Promise<Object>} The saved copy, or a rejection carrying the save error unwrapped.
 */
function copy(user, cb) {
  var course = new Course.publicModel({
    name           : this.name,
    description    : this.description,
    lessons        : [],
    _owner         : user,
    ownerSlug      : user.username,
    globalSettings : this.globalSettings
  }, this);

  var self = this;

  var copied = new Promise(function(resolve, reject) {
    // try to save course before making copies of everything else
    // to catch any course errors (e.g. course with the same name)
    //
    // The two-argument .then reproduces the `if (err)` guard exactly: the rejection handler runs
    // instead of the body, never after it. That separation is load-bearing. The duplicate-key error
    // THIS save exists to catch must arrive UNWRAPPED, because both callers test `err.code === 11000`
    // to answer it with a client-visible payload; the inner chain's own failures must arrive as the
    // silent-outcome sentinel instead, and they are routed there by that chain's own .catch below. A
    // trailing .catch here would merge the two channels and let a deep failure answer the outer
    // duplicate-name payload - a branch that answered nothing at the base commit.
    course.save().then(function(doc) {
      var lessonPromises = self.lessons.map(function(lessonId) {
        return Lesson.findById(lessonId);
      });

      var materialParser = new MaterialParser('a');

      // Async conversion: lib/models/lesson.js#copy is promise-native, so no bridge is needed. On an
      // upstream failure its promise rejects with the silent-outcome sentinel - the fate documented
      // there - which this .then propagates unchanged into the chain's own .catch below.
      function copyLesson(lesson) {
        return lesson.copy(user, materialParser).then(function(copy) {
          return copy.id;
        });
      }

      Promise.all(lessonPromises)
        .then(function(lessons) {
          var copyPromises = lessons.map(function(lesson) {
            return copyLesson(lesson);
          });

          return Promise.all(copyPromises)
        })
        .then(function(ids) {
          // The successful lesson order is the order Promise.all resolves, which is this course's
          // declared `lessons` order - unchanged, because nothing here reorders or filters the ids.
          course.lessons = ids.map(function(id) { return id });

          // The second save is the success-side settle path, exactly as at the base commit: its
          // document settles the returned promise and its error is logged and forwarded unwrapped.
          course.save().then(resolve, function(err) {
            err && console.log(err);
            reject(err);
          });
        })
        // R-6 / review finding F6. At the base commit this chain was deliberately unterminated, so a
        // rejection from Lesson.findById or lesson.copy reached NOTHING: the retired shim's deferred
        // was never settled and the request received no response. The client-visible half is preserved
        // - the returned promise rejects with the SILENT-OUTCOME SENTINEL, which both callers translate
        // into `h.abandon`, so still no status code and still no body - while the rejection is owned
        // rather than left unhandled for Node 22 to escalate into a process-fatal fault, and the
        // awaiting request is released instead of retained.
        //
        // The sentinel carries no `code`, so it can never be mistaken for the `err.code === 11000`
        // duplicate-name failure that the FIRST save reports and that lib/controllers/course.js
        // answers with a client-visible 200 payload. Lessons and materials copied before the failure
        // stay written, exactly as at the base commit. The second save cannot reach this handler: it
        // has already settled the promise by the time it rejects.
        // See lib/models/model.js#silentOutcome and docs/PRESERVED-QUIRKS.md sections 1.15, 3.39, 3.40.
        .catch(function(upstreamError) {
          reject(model.silentOutcome(upstreamError));
        });
    }, function(err) {
      console.log(err);
      reject(err);
    });
  });

  if (typeof cb === 'function') {
    // Two-argument then, so cb is reached exactly once per settlement and a throw out of cb is not
    // fed back into cb.
    copied.then(function(doc) { cb(null, doc); }, function(err) { cb(err); });
  }

  return copied;
}

function setGlobalSettings(settings) {
  if (!this.globalSettings) {
    this.globalSettings = {};
  }

  for (var setting in schema.globalSettings) {
    if (schema.globalSettings.hasOwnProperty(setting)) {
      this.globalSettings[setting] = typeof(settings[setting]) === 'undefined'
        ? schema.globalSettings[setting].default
        : this.globalSettings[setting] = settings[setting];
    }
  }
}

/**
 * helper method so we don't have to check for both 'dashboard' and 'all'
 * in the course.users.$.hideFrom array every time
 *
 * user is an object from course.users
 */
function userHiddenFromDashboard(user) {
  return user.hideFrom.indexOf('dashboard') >= 0 || user.hideFrom.indexOf('all') >= 0;
}

function findFeaturedForUser(user) {
  var promises, page;

  return featuredStore.getList()
    .then(function(list) {
      if (!list || !list.length) {
        return [];
      }
      promises = _.map(list, function(featuredCourse) {
        return Course.publicModel.findById(featuredCourse.id)
          .then(function(course) {
            if (course) {
              course.page = featuredCourse.page || "";
            }
            return course;
          });
      });

      return Promise.all(promises);
    })
    .then(function(courses) {
      // Filter out any null courses (deleted courses)
      return _.compact(courses);
    })
    .catch(function(err) {
      return [];
    });
}

var Course = model.create('Course', {
  schema: schema,
  plugins: [
    [ownable, { index: false }],
    [slug, { path: 'name', index: false }]
  ],
  classMethods: {
      findByUserAndSlug : findByUserAndSlug
    , findFeaturedForUser : findFeaturedForUser
    , findForUser       : true
    , userUpdate        : userUpdate
    , findByAccessCode  : findByAccessCode
    , findByExternalId  : findByExternalId
    , userDeleted       : userDeleted
  },
  objectMethods: {
      copy              : copy
    , setGlobalSettings : setGlobalSettings
    , addUser           : addUser
    , removeUser        : removeUser
    , removeDeletedUser : removeDeletedUser
    , updateRole        : updateRole
    , updateView        : updateView
    , deleteCourse      : deleteCourse
    , userHiddenFromDashboard : userHiddenFromDashboard
  },
  index: [
    [{ _owner: 1, slug: 1 }, { unique: true }]
  ],
  publicSpec: {
    id             : true,
    name           : true,
    slug           : true,
    description    : true,
    lessons        : true,
    _owner         : true,
    globalSettings : true,
    ownerSlug      : true,
    archived       : true
  },
  hooks : {
    post : {
      init : {
        preserveSlug : preserveSlug
      },
      save : {
        ensureSlugAlias : ensureSlugAlias
      }
    }
  }
});

module.exports = Course.publicModel;
