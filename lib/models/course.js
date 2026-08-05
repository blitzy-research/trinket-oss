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
 * Promise-native: the returned promise is what the two controllers await. The optional error-first
 * callback is RETAINED because an existing model assertion consumes it, and when supplied it is invoked
 * exactly ONCE, from a two-argument `then` that cannot feed a throw out of the callback back into it.
 *
 * TWO FAILURE CHANNELS, and they must stay apart:
 *   - the FIRST save reports a duplicate-name failure UNWRAPPED, because both callers test
 *     `err.code === 11000` to answer it with a client-visible 200 payload;
 *   - a failure anywhere in the inner lesson/material chain rejects with the SILENT-OUTCOME SENTINEL
 *     from `lib/models/model.js#silentOutcome`, which both controllers translate into `h.abandon` - no
 *     status code and no body. The sentinel carries no `code`, so it can never be mistaken for the
 *     duplicate-name failure.
 * No `.catch` may be added anywhere else in this function: a trailing one would merge the two channels
 * and convert either fate into a scrubbed 500.
 * See docs/PRESERVED-QUIRKS.md sections 1.15, 3.39 and 3.40.
 *
 * @param   {Object}   user The user the copy belongs to.
 * @param   {Function} [cb] Optional error-first callback, for the existing test contract.
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
    // The two-argument .then keeps the rejection handler from running after the body as well as
    // instead of it, and that separation is load-bearing: the duplicate-key error THIS save exists to
    // catch must arrive UNWRAPPED for the callers' `err.code === 11000` test, while the inner chain's
    // own failures must arrive as the silent-outcome sentinel. A trailing .catch here would merge the
    // two channels and let a deep failure answer the duplicate-name payload.
    course.save().then(function(doc) {
      var lessonPromises = self.lessons.map(function(lessonId) {
        return Lesson.findById(lessonId);
      });

      var materialParser = new MaterialParser('a');

      // lib/models/lesson.js#copy rejects with the silent-outcome sentinel on an upstream failure,
      // which this .then propagates unchanged into the chain's own .catch below.
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

          course.save().then(resolve, function(err) {
            err && console.log(err);
            reject(err);
          });
        })
        // A rejection from Lesson.findById or lesson.copy answers NO RESPONSE, carried as the
        // SILENT-OUTCOME SENTINEL so the rejection is owned rather than left unhandled. The sentinel
        // carries no `code`, so it can never be mistaken for the duplicate-name failure the FIRST save
        // reports. Lessons and materials copied before the failure stay written; nothing is rolled
        // back. The second save cannot reach this handler - it has already settled the promise.
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
