var model            = require('./model'),
    mongoose         = require('mongoose'),
    bcrypt           = require('bcrypt'),
    _                = require('underscore'),
    roles            = require('./plugins/roles'),
    config           = require('config'),
    // The store module itself, alongside the user-scoped interface: the key
    // builders on `store.user` and the generic `store.del` are what
    // eraseOwnedData needs to remove this account's pending email records, and
    // `users()` does not expose them.
    store            = require('../util/store'),
    userStore        = store.users(),
    SALT_WORK_FACTOR = 10,
    schema           = {
      name      : { type: String },
      fullname  : { type: String,  required: true },
      username  : { type: String,  required: true, unique: true },
      email     : { type: String,  required: true, unique: true },
      verified  : { type: Boolean, default: false },
      password  : { type: String },
      avatar    : { type: String },
      source    : { type: String,  default: 'trinket' },
      profiles  : {},
      settings       : {
        disableAceEditor : { type: Boolean, default: false },
        theme            : { type: String, default: "xcode"},
        lineWrapping     : { type: Boolean, default: false },
        pythonTab        : { type: Number, default: 2 }, // Includes python, python3, pygame, and glowscript
        javaTab          : { type: Number, default: 2 },
        rTab             : { type: Number, default: 2 },
        htmlTab          : { type: Number, default: 2 },
      }
    };

function ensureName(next) {
  var user = this;

  if (!user.name) {
    user.name = user.fullname;
  }

  // ensure these are always lowercase
  user.username = user.username.toLowerCase();
  user.email    = user.email.toLowerCase();

  // ensure there is always some avatar stored
  user.avatar   = this.normalizeAvatar();

  next();
}

// Bcrypt middleware
function encryptPassword(next) {
  var user = this;

  if(!user.isModified('password')) return next();

  bcrypt.genSalt(SALT_WORK_FACTOR, function(err, salt) {
    if(err) return next(err);

    bcrypt.hash(user.password, salt, function(err, hash) {
      if(err) return next(err);
      user.password = hash;
      next();
    });
  });
}

function checkPermissions(next) {
  // if no roles, likely a new user
  // give them default permissions
  if (this.roles.length == 0) {
    this.setRoles("user", "site").then(next);
  }
  else {
    next();
  }
}

function preserveUsername() {
  this._original_username = this.username;
}

function ensureUsernameAlias() {
  if (!this._original_username || this._original_username === this.username) return;

  userStore.linkIdToUsername(this._original_username, this.id);
}

function markAsDeleted(doc) {
  // Clean up user's association with courses when user is removed
  Course.userDeleted(doc);
}

// Password verification
function comparePassword(candidatePassword, cb) {
  return bcrypt.compare(candidatePassword, this.password, cb);
};

// user lookup by email or username
function findByLogin(login, cb){
  return this.model.findOne({
    $or: [
      { email    : login },
      { username : login.toLowerCase() }
    ]
  }, cb);
}

function findByMultiple(query, cb) {
  var or = [], c;
  for (var key in query) {
    c = {};
    c[key] = query[key];
    or.push(c);
  }
  return this.model.findOne({
    $or : or
  }, cb);
}

function exists(user, cb) {
  var or = [
    { email    : user.email    },
    { username : user.username.toLowerCase() }
  ];

  return this.model.find({ $or : or }, function(err, users) {
    if (err) return cb(err);
    if (!users || users.length == 0) return cb(null, {exists:false});
    var duplicates = {};
    users.forEach(function(existingUser) {
      if (existingUser.username === user.username) {
        duplicates.username = true;
      }
      if (existingUser.email === user.email) {
        duplicates.email = true;
      }
    });

    return cb(null, {exists:true, duplicates:duplicates, users:users});
  });
}

// find up to 100 users for admin page, includes pagination
function findAdminList(page, cb) {
  var limit = 100;
  var skip  = page * limit;
  this.model.find({}).skip(skip).limit(limit).sort('-created').exec(function(err, users) {
    cb(err, users);
  });
}

function findByRole(role, cb) {
  return this.model.find({ roles : { $elemMatch : { roles : { $in : [role] } } } }).sort({ username : 1 }).exec();
}

function getCourses(filter) {
  var self      = this
    , courseIds = []
    , promises  = []
    , context;

  if (this.roles) {
    this.roles.forEach(function(role) {
      if (/^course/.test(role.context) && self.hasPermission('view-course-content', role.context)) {
        // course:[id]
        context = role.context.split(':');

        if (filter && role.permissions.indexOf(filter) < 0) {
          return;
        }

        courseIds.push(context[1]);
      }
    });

    courseIds.forEach(function(id) {
      // Use promise directly instead of Q.nsend for Mongoose 6 compatibility
      promises.push(Course.findById(id));
    });
  }

  if (promises.length) {
    return Promise.all(promises)
      .then(function(courses) {
        return _.compact(courses).filter(function(c) {
          if (!c.archived || (c.archived && c._owner.toString() === self.id.toString())) {
            return true;
          }
          return false;
        });
      });
  }
  else {
    return Promise.resolve([]);
  }
}

function getOwnedCourses() {
  var self      = this
    , courseIds = []
    , promises  = []
    , context;

  if (this.roles) {
    this.roles.forEach(function(role) {
      if (/^course/.test(role.context) && self.hasRole('course-owner', role.context)) {
        // course:[id]
        context = role.context.split(':');
        courseIds.push(context[1]);
      }
    });

    courseIds.forEach(function(id) {
      promises.push(Course.findById(id));
    });
  }

  if (promises.length) {
    return Promise.all(promises);
  }
  else {
    return Promise.resolve([]);
  }
}

function inCourse(courseId) {
  var inCourse = false
    , self     = this;

  if (this.roles) {
    this.roles.forEach(function(role) {
      if (role.context === "course:" + courseId && self.hasPermission("view-course-content", "course", { id : courseId })) {
        inCourse = true;
      }
    });
  }

  return inCourse;
}

function normalizeAvatar() {
  var avatar = this.avatar;
  var cloudHost = config.aws.buckets.useravatars.host || '';
  var hasCloudConfig = cloudHost.length > 0 && !cloudHost.includes('example.com');

  // Treat placeholder URLs as no avatar
  if (!avatar || avatar.includes('example.com')) {
    return hasCloudConfig ? cloudHost + '/avatar-default.png' : '/img/avatar-default.svg';
  }

  // Already a valid local path - return as-is
  if (/^\/img\//.test(avatar)) {
    return avatar;
  }

  // Already a full URL (and not a placeholder)
  if (/^http/.test(avatar)) {
    return avatar;
  }

  // Relative path - prepend cloud host if configured, otherwise use local
  if (hasCloudConfig) {
    return cloudHost + (avatar.startsWith('/') ? '' : '/') + avatar;
  }

  // Local path
  return /^\//.test(avatar) ? avatar : '/img/' + avatar;
}

// ---------------------------------------------------------------------------
// SECURITY DEVIATION FROM AAP R-d - ESCALATED FOR AUTHORIZATION, NOT
// SELF-APPROVED - SEC-F45 (CWE-212).
//
// STATUS OF THIS RECORD. It states a departure from AAP R-d and the reasoning
// behind it. It does NOT authorize that departure: AAP §0.7's conflict
// register closes exactly two conflicts - the image response at
// files.js:98-100 and the `marked` advisory - and nothing in the AAP delegates
// approval authority to a comment in the source. The departure is implemented
// because leaving the vulnerability in place is not an available outcome for a
// blocking security finding, and it is carried to the checkpoint's resolution
// report for a human to authorize or reverse. Read "the reasoning is recorded
// here", not "this has been approved".
//
// THE CONFLICT. Baseline account deletion removed the User document and nothing
// else: `request.user.remove()` (lib/controllers/users.js), whose only
// downstream cleanup is the existing post('remove') hook `markAsDeleted`, which
// calls Course.userDeleted(doc). Owned trinkets, uploaded files and their S3
// objects, interaction records naming the user as owner OR actor, export
// archives and their stored objects, and the stored Google access token all
// survived the deletion of the account they belong to. AAP R-d prohibits
// behaviour improvements, so preservation would keep all of that.
//
// WHICH REQUIREMENT CONTROLS, AND WHY. The AAP's §0.7 precedent
// (files.js:98-100) overrides R-d where R-d's protection - clients that may
// legitimately rely on observable behaviour - does not apply. Nothing here is
// client-observable behaviour at all: it is data left behind after the only
// party entitled to it asked for it to be gone, and a live OAuth access token
// left in a database whose owning account no longer exists. There is no client
// contract to preserve, and the request the user made ("delete my account") is
// the one this now honours.
//
// WHAT IS NOT ERASED, AND WHY. Course membership and course-owned content keep
// their existing disposition through markAsDeleted/Course.userDeleted: courses
// are shared artifacts with other members, and reassigning or deleting them is
// a retention decision outside this finding.
//
// ORDERING. Every erase below is awaited BEFORE the caller removes the User
// document, so a failure leaves the account intact rather than orphaning the
// data it owns - a half-deleted account can be retried, an orphaned data set
// cannot be found again.
//
// NOT TRANSACTIONAL, and it cannot be here. Multi-document transactions
// require a replica set or a sharded cluster; both databases this project runs
// against are standalone - the shared development mongod and the
// `mongodb-memory-server` the suite starts (test/parity/mongo.js) - so
// `session.startTransaction()` fails outright rather than degrading. The
// ordering above is what stands in for atomicity: the account document, which
// is what every other record is found BY, is deleted last, so an interrupted
// erasure leaves a findable account and a retryable delete rather than
// unreachable orphans. Any record whose stored object could not be deleted is
// named in the orphan log below, so an operator can reconcile object storage
// by hand. Making this genuinely atomic needs a replica-set deployment and a
// session-threaded erasure, which is recorded for a human rather than faked.
// ---------------------------------------------------------------------------

/**
 * Records a stored object that outlived the record pointing at it.
 *
 * WHY THIS EXISTS. Object deletion is best-effort and record deletion is not,
 * so an unreachable object store leaves objects with nothing referencing them
 * - and the reference is the only way to find them again. Without a record of
 * the exact bucket and key, that residue is unreconcilable: nobody can tell an
 * orphan from a live object by looking at the bucket. The alternative - keeping
 * the records so the objects stay findable - is the worse privacy outcome,
 * because it keeps the personal data the account holder asked to have erased.
 * So the records go, and the keys are named here.
 *
 * @param {Array} orphans accumulator for this erasure
 * @param {string} container config.aws.buckets group
 * @param {string} key      the exact object key, as it will be addressed
 * @param {string} reason   why the delete did not happen
 * @returns {undefined}
 */
function recordOrphanedObject(orphans, container, key, reason) {
  orphans.push({ container : container, key : key, reason : reason });
}

/**
 * Deletes one stored object, best-effort, addressing it the way the rest of the
 * application does - by BASENAME.
 *
 * Object-storage availability must not be able to block an account deletion:
 * AWS credentials are empty in the default configuration
 * (config/default.yaml), so on many deployments every one of these calls fails
 * and the DOCUMENTS must still be erased. Failures are logged, recorded as
 * orphans and swallowed; the promise never rejects.
 *
 * USE THIS ONLY where the object's key IS its basename. FileUtil.removeFile
 * reduces whatever it is given to the segment after the last `/`
 * (lib/util/file.js:132-146), which is correct for uploads - their key is a
 * flat sha1 digest - and WRONG for anything stored under a prefix. See
 * removeStoredObjectByKey for the latter.
 *
 * @param {Array} orphans accumulator for this erasure
 * @param {string} container key into config.aws.buckets
 * @param {string} objectRef the stored url or key; its basename is the key used
 * @returns {Promise<boolean>} true when the delete was accepted
 */
function removeStoredObject(orphans, container, objectRef) {
  return new Promise(function(resolve) {
    var FileUtil;

    if (!objectRef) {
      return resolve(false);
    }

    // The bucket group must exist before removeFile touches it: it dereferences
    // config.aws.buckets[container].name synchronously, and config/default.yaml
    // declares NO `exports` group at all (AAP §0.6.7 records that gap and
    // forbids patching the default config), so an unguarded call throws.
    if (!config.aws || !config.aws.buckets || !config.aws.buckets[container]) {
      console.log('eraseOwnedData: no `' + container + '` bucket is configured; ' +
                  'leaving the stored object', objectRef);
      recordOrphanedObject(orphans, container, objectRef,
        'no `' + container + '` bucket is configured');
      return resolve(false);
    }

    try {
      FileUtil = require('../util/file');
      FileUtil.removeFile(container, objectRef, function(err) {
        if (err) {
          console.log('eraseOwnedData: could not delete the stored object',
                      objectRef, '-', err.message);
          recordOrphanedObject(orphans, container, objectRef, err.message);
          return resolve(false);
        }

        return resolve(true);
      });
    }
    catch (err) {
      console.log('eraseOwnedData: object storage is unavailable for',
                  objectRef, '-', err.message);
      recordOrphanedObject(orphans, container, objectRef, err.message);
      resolve(false);
    }
  });
}

/**
 * Deletes one stored object addressed by its COMPLETE key, prefix included.
 *
 * WHY A SECOND DELETER. Export archives are the one object this account owns
 * whose key is not flat. lib/workers/exports.js:149-151 composes
 * `s3Key = 'exports/' + userId + '/' + filename` and uploads with that whole
 * string as the Key (:566-576), and it is that whole string that is persisted
 * on the Export document. Routing it through FileUtil.removeFile would reduce
 * it to `filename` and issue a delete for a DIFFERENT key - one that almost
 * certainly does not exist - and S3's deleteObject answers 204 for a key that
 * was never there. So the wrong call reports success, the archive survives, and
 * nothing anywhere records that it did. Measured against the composition in the
 * worker; this deleter is why the export objects are addressed exactly.
 *
 * The client is constructed from config/aws so it picks up the same namespace
 * every other call site uses - including the parity harness, which swaps
 * `AWS.S3` on that module (test/parity/fixtures/aws.js), so a filesystem-backed
 * run exercises this path too.
 *
 * @param {Array} orphans accumulator for this erasure
 * @param {string} container key into config.aws.buckets
 * @param {string} key       the complete object key, used verbatim
 * @returns {Promise<boolean>} true when the delete was accepted
 */
function removeStoredObjectByKey(orphans, container, key) {
  return new Promise(function(resolve) {
    var bucket, aws;

    if (!key) {
      return resolve(false);
    }

    bucket = config.aws && config.aws.buckets ? config.aws.buckets[container] : null;

    if (!bucket || !bucket.name) {
      console.log('eraseOwnedData: no `' + container + '` bucket is configured; ' +
                  'leaving the stored object', key);
      recordOrphanedObject(orphans, container, key,
        'no `' + container + '` bucket is configured');
      return resolve(false);
    }

    try {
      aws = require('../../config/aws');
      new aws.S3().deleteObject({ Bucket : bucket.name, Key : key }, function(err) {
        if (err) {
          console.log('eraseOwnedData: could not delete the stored object',
                      key, '-', err.message);
          recordOrphanedObject(orphans, container, key, err.message);
          return resolve(false);
        }

        return resolve(true);
      });
    }
    catch (err) {
      console.log('eraseOwnedData: object storage is unavailable for',
                  key, '-', err.message);
      recordOrphanedObject(orphans, container, key, err.message);
      resolve(false);
    }
  });
}

/**
 * The avatar object this account owns in the `useravatars` bucket, or null when
 * there is nothing of ours to delete.
 *
 * Three of the four shapes `avatar` can hold are NOT ours and must be left
 * alone - the local `/img/...` defaults this application ships, the
 * `example.com` placeholders the default configuration carries, and an absolute
 * URL pointing at somebody else's host, which is what a Google sign-in stores
 * (lib/controllers/auth.js copies the provider's picture URL). Only an upload
 * through FileUtil.uploadUserAvatar puts an object in our bucket, and it is
 * stored either as a bare key or as our own configured host plus that key.
 *
 * @param {Object} user the account being erased
 * @returns {string|null} the reference to delete, or null
 */
function avatarObjectRef(user) {
  var avatar = user.avatar
    , host   = config.aws && config.aws.buckets && config.aws.buckets.useravatars
                 ? config.aws.buckets.useravatars.host
                 : '';

  if (!avatar || avatar.indexOf('example.com') >= 0 || /^\/img\//.test(avatar)) {
    return null;
  }

  if (/^https?:\/\//.test(avatar) || /^\/\//.test(avatar)) {
    // Ours only if it sits on the host we upload to. Anything else belongs to
    // another origin, and issuing a delete for it would both fail and add a
    // misleading entry to the orphan log.
    return host && avatar.indexOf(host) === 0 ? avatar : null;
  }

  return avatar;
}

/**
 * Erases every record this account owns, plus its stored provider token and its
 * username alias, and reports what was removed.
 *
 * SEC-F45. Called by lib/controllers/users.js `remove` immediately before
 * `request.user.remove()`.
 *
 * The model modules are required at CALL time rather than at module scope for
 * two reasons: lib/models/interaction.js is required by nothing else under
 * lib/, so `mongoose.model('Interaction')` throws MissingSchemaError unless
 * something loads it first, and a module-scope require here would add
 * user -> trinket -> file edges to the model load graph, which is exactly the
 * ordering that config/app.config.js:3-7 exists to keep stable. At call time
 * every module is fully initialized, so a cycle cannot be observed.
 *
 * @returns {Promise<Object>} counts of what was erased, for the caller to log:
 *   `{trinkets, trinketsAnonymized, interactions, files, filesAnonymized,
 *     fileObjects, exports, exportObjects, folders, avatarObjects,
 *     pendingEmailRecords, providerTokens, usernameAliases, orphanedObjects}`
 * @throws whatever the database throws - deliberately, so the caller does NOT
 *   delete the account when its data could not be erased
 *
 * @example
 *   var erased = await request.user.eraseOwnedData();
 *   await request.user.remove();
 */
async function eraseOwnedData() {
  var self = this
    , erased = {
        trinkets            : 0,
        trinketsAnonymized  : 0,
        interactions        : 0,
        files               : 0,
        filesAnonymized     : 0,
        fileObjects         : 0,
        exports             : 0,
        exportObjects       : 0,
        folders             : 0,
        avatarObjects       : 0,
        pendingEmailRecords : 0,
        providerTokens      : 0,
        usernameAliases     : 0,
        orphanedObjects     : 0
      }
      // Every stored object whose deletion did not happen, with the exact
      // bucket and key. Reported at the end; see recordOrphanedObject.
    , orphans = []
    , Snippet
    , FileModel
    , ExportModel
    , InteractionModel
    , FolderModel
    , trinketIds
    , trinkets
    , storedSnapshots
    , documents
    , files
    , exports
    , avatarRef
    , pendingKeys
    , result
    , i;

  require('./trinket');
  require('./file');
  require('./export');
  require('./interaction');
  require('./folder');

  Snippet          = mongoose.model('Snippet');
  FileModel        = mongoose.model('File');
  ExportModel      = mongoose.model('Export');
  InteractionModel = mongoose.model('Interaction');
  FolderModel      = mongoose.model('Folder');

  // 1. The user's trinkets, and the interactions that reference them. The
  //    referencing interactions are collected FIRST, because once the trinkets
  //    are gone their ids cannot be recovered to find the interactions by.
  //
  //    TWO FIELDS LINK A TRINKET TO A USER, and matching only `_owner` misses
  //    the common case. lib/models/plugins/ownable.js adds both `_owner` and
  //    `_creator`, and lib/controllers/trinket.js:286-291 sets `_creator`
  //    unconditionally for an authenticated author but sets `_owner` ONLY when
  //    the request carries `?library`. So an ordinary trinket created from the
  //    editor has a `_creator` and NO `_owner` at all - measured against a live
  //    server: POST /api/trinkets persisted `_creator` alone, and an erasure
  //    keyed on `_owner` left the document behind.
  //
  //    ERASE where the trinket is unambiguously this user's - `_owner` is the
  //    user, or `_creator` is the user and there is no other owner. `{_owner:
  //    null}` matches a missing field as well as an explicit null, which is what
  //    covers the editor-created case.
  //    REMOVED ONE DOCUMENT AT A TIME, not with deleteMany. The
  //    trinket schema registers a post('remove') DOCUMENT hook
  //    (lib/models/trinket.js postRemove, wired at :610-612) whose whole job is
  //    to delete the trinket's snapshot object from the snapshots bucket. A
  //    collection-level deleteMany does not run document middleware, so the
  //    bulk form erased the records and left every snapshot image behind - the
  //    same class of residue as the S3 objects this finding names, arriving
  //    through a hook rather than through a missing call. Removing each document
  //    is what the application's own trinket-delete path does, so the cleanup
  //    is the cleanup that is already trusted rather than a second
  //    implementation of it.
  //    The lean pass first, because it is the only way to see what the DATABASE
  //    holds for `snapshot`: the trinket schema has a post('init') hook
  //    (lib/models/trinket.js checkSnapshot) that fills an ABSENT snapshot with
  //    one of the shipped placeholder paths on every non-lean load, and `lean()`
  //    skips document middleware. storedSnapshots is what the documents loaded
  //    below are reconciled against.
  trinkets = await Snippet.find({
    $or : [
        { _owner : self._id }
      , { _creator : self._id, _owner : null }
    ]
  }, { _id : 1, snapshot : 1 }).lean().exec();
  trinketIds = trinkets.map(function(trinket) { return trinket._id; });

  if (trinketIds.length) {
    result = await InteractionModel.deleteMany({ _trinket : { $in : trinketIds } }).exec();
    erased.interactions += (result && result.deletedCount) || 0;

    storedSnapshots = {};
    for (i = 0; i < trinkets.length; i++) {
      storedSnapshots[String(trinkets[i]._id)] = trinkets[i].snapshot;
    }

    documents = await Snippet.find({ _id : { $in : trinketIds } }).exec();

    for (i = 0; i < documents.length; i++) {
      // Put `snapshot` back to the stored value before the hook reads it. Left
      // alone, a trinket that has NO snapshot arrives here carrying the
      // placeholder checkSnapshot just invented, and postRemove would issue a
      // delete for the shipped default image in the snapshots bucket - an object
      // every other snapshot-less trinket in the system renders. Measured: the
      // placeholder is `/img/avatar-default.png`, or the configured snapshots
      // host plus `/avatar-default.png` when one is set. Normalizing first is
      // also what keeps this path from constructing an AWS client for an object
      // that was never there.
      documents[i].snapshot = storedSnapshots[String(documents[i]._id)];

      // Not individually guarded: a database failure here must propagate, so
      // the caller leaves the account in place and the erasure can be retried.
      // The snapshot deletion inside the hook is already best-effort and
      // reports its own failures.
      await documents[i].remove();
      erased.trinkets++;
    }
  }

  //    ANONYMIZE the remainder. Anything still naming this user as `_creator`
  //    after the delete above is owned by SOMEONE ELSE - a copy carries the
  //    target user in both fields (lib/models/trinket.js:146-147), so this is
  //    the narrow case of content that has passed to another account. Deleting
  //    it would destroy another user's trinket, so the personal link is dropped
  //    instead, which is the "erase or anonymize" the finding asks for.
  result = await Snippet.updateMany(
    { _creator : self._id },
    { $unset : { _creator : 1 } }
  ).exec();
  erased.trinketsAnonymized += (result && (result.modifiedCount || result.nModified)) || 0;

  // 2. Interactions naming this user, as the owner of the interaction or as the
  //    actor who performed it. Both, because an interaction on someone else's
  //    trinket records this user as `_actor` and is just as personal.
  result = await InteractionModel.deleteMany({
    $or : [ { _owner : self._id }, { _actor : self._id } ]
  }).exec();
  erased.interactions += (result && result.deletedCount) || 0;

  // 3. The user's files, with their stored objects removed first so a failure
  //    to delete the record does not leave an unreferenced object behind.
  //
  //    Same two-field ownership as the trinkets above, and the same disposition:
  //    lib/models/file.js applies the ownable plugin with its default
  //    `required: true`, so a file always HAS an `_owner` - but the `_owner:
  //    null` arm is kept anyway, because it costs one index-covered clause and
  //    it is the arm that catches any record written before that default was in
  //    force. Whatever still names this user as `_creator` afterwards belongs to
  //    another account and is anonymized rather than deleted.
  files = await FileModel.find({
    $or : [
        { _owner : self._id }
      , { _creator : self._id, _owner : null }
    ]
  }).exec();

  for (i = 0; i < files.length; i++) {
    if (await removeStoredObject(orphans, 'userassets', files[i].url)) {
      erased.fileObjects++;
    }
  }

  if (files.length) {
    result = await FileModel.deleteMany({
      _id : { $in : files.map(function(file) { return file._id; }) }
    }).exec();
    erased.files += (result && result.deletedCount) || 0;
  }

  result = await FileModel.updateMany(
    { _creator : self._id },
    { $unset : { _creator : 1 } }
  ).exec();
  erased.filesAnonymized += (result && (result.modifiedCount || result.nModified)) || 0;

  // 4. Export archives, same order and the same best-effort object deletion -
  //    but addressed by their COMPLETE key. `s3Key` is
  //    'exports/<userId>/<filename>' and the whole string is the object's key,
  //    so the basename-stripping deleter used above would delete the wrong key
  //    and report success. See removeStoredObjectByKey.
  exports = await ExportModel.find({ _owner : self._id }).exec();

  for (i = 0; i < exports.length; i++) {
    if (await removeStoredObjectByKey(orphans, 'exports', exports[i].s3Key)) {
      erased.exportObjects++;
    }
  }

  if (exports.length) {
    result = await ExportModel.deleteMany({ _owner : self._id }).exec();
    erased.exports += (result && result.deletedCount) || 0;
  }

  // 5. Folders. They hold no content of their own once their trinkets are gone,
  //    but the record itself is personal - it carries a user-authored name and
  //    slug and is indexed by owner - so leaving it behind leaves data the
  //    account holder asked to have erased.
  //
  //    deleteMany rather than the model's own deleteFolder(): that method exists
  //    to revoke the OWNER's folder role and to detach the folder from its
  //    TRINKETS, and both of those are already gone by this point - the trinkets
  //    at step 1, the roles with the User document the caller is about to
  //    delete. It is also fire-and-forget internally, so it would log its work
  //    after the response had been sent. Folders have no post('remove') hook and
  //    no stored objects, so nothing is skipped by the bulk form.
  result = await FolderModel.deleteMany({
    $or : [
        { _owner : self._id }
      , { _creator : self._id, _owner : null }
    ]
  }).exec();
  erased.folders += (result && result.deletedCount) || 0;

  // 6. The avatar object, when it is one of ours. avatarObjectRef is what
  //    decides that: the shipped defaults, the configured placeholders and a
  //    provider-hosted picture are not, and must not be issued a delete.
  avatarRef = avatarObjectRef(self);

  if (avatarRef && await removeStoredObject(orphans, 'useravatars', avatarRef)) {
    erased.avatarObjects++;
  }

  // 7. Pending email-change and email-verification records in the store. Both
  //    are keyed by USER ID (lib/util/store.js Store.user.change_email_key and
  //    verify_email_key), so both are reachable from here and both hold an
  //    address the account holder submitted - a pending change record carries
  //    the new address verbatim.
  //
  //    The password-reset and activate-account records are keyed by their own
  //    random TOKEN rather than by user id, so they cannot be addressed without
  //    the token and are not reachable here. They expire on their own: the reset
  //    record now carries a one-hour TTL written with the value
  //    (lib/controllers/users.js sendPassReset), and it is single-use.
  pendingKeys = [
      store.user.change_email_key(self.id.toString())
    , store.user.verify_email_key(self.id.toString())
  ];

  for (i = 0; i < pendingKeys.length; i++) {
    try {
      if (Number(await store.del(pendingKeys[i])) === 1) {
        erased.pendingEmailRecords++;
      }
    }
    catch (err) {
      // Same reasoning as the object deletions and the username alias below: a
      // store that cannot be reached must not block the erasure of the records.
      console.log('eraseOwnedData: could not delete the pending email record',
                  pendingKeys[i], '-', err.message);
    }
  }

  // 8. The stored provider token. Persisted with an atomic $unset rather than a
  //    document save, so no pre('save') hook re-derives anything on a document
  //    that is about to be deleted, and mirrored on the in-memory document so a
  //    later serialize() of this instance cannot emit the token either. It is
  //    unset even though the document is about to be removed, because if that
  //    removal fails the account survives and the token must not.
  if (self.profiles && self.profiles.google && self.profiles.google.token) {
    await self.constructor.updateOne(
      { _id : self._id },
      { $unset : { 'profiles.google.token' : 1 } }
    ).exec();

    delete self.profiles.google.token;
    self.markModified('profiles');
    erased.providerTokens++;
  }

  // 9. The username -> id alias in the store, which is what maps an old username
  //    back to this account (see ensureUsernameAlias above). Left in place it
  //    keeps resolving a deleted account's username to its id.
  if (self.username) {
    try {
      await userStore.unlinkIdFromUsername(self.username, self.id);
      erased.usernameAliases++;
    }
    catch (err) {
      // Same reasoning as the object deletions: the store is a cache of an
      // alias, and its availability must not block the erasure of the records.
      console.log('eraseOwnedData: could not unlink the username alias for',
                  self.username, '-', err.message);
    }
  }

  // Every object whose deletion did not happen, named exactly, on ONE line per
  // object so an operator can reconcile object storage without correlating
  // anything - the records that pointed at these keys no longer exist.
  erased.orphanedObjects = orphans.length;

  for (i = 0; i < orphans.length; i++) {
    console.log('eraseOwnedData: ORPHANED OBJECT for user ' + self.id + ' - bucket group `' +
                orphans[i].container + '`, key `' + orphans[i].key + '`: ' + orphans[i].reason);
  }

  console.log('eraseOwnedData: erased', JSON.stringify(erased), 'for user', self.id);

  return erased;
}

function updateSettings(settings) {
  var update, updateOptions;

  var newSettings = _.extend(this.settings, settings);

  update = {
    "$set" : {
      "settings": newSettings
    }
  };

  updateOptions = { new : true };

  return User.findByIdAndUpdate(this.id, update, updateOptions).exec();
}

module.exports = model.create('User', {
  schema  : schema,
  plugins : [ roles ],
  hooks  : {
    pre : {
      save : {
        ensureName       : ensureName,
        encryptPassword  : encryptPassword,
        checkPermissions : checkPermissions
      }
    },
    post : {
      init : {
        preserveUsername : preserveUsername
      },
      save : {
        ensureUsernameAlias : ensureUsernameAlias
      },
      remove : {
        markAsDeleted : markAsDeleted
      }
    }
  },
  objectMethods : {
    comparePassword : comparePassword,
    normalizeAvatar : normalizeAvatar,
    inCourse        : inCourse,
    getCourses      : getCourses,
    getOwnedCourses : getOwnedCourses,
    updateSettings   : updateSettings,
    eraseOwnedData  : eraseOwnedData
  },
  classMethods : {
    findByLogin          : findByLogin,
    findByMultiple       : findByMultiple,
    findAdminList        : findAdminList,
    exists               : exists,
    findByRole           : findByRole
  },
  alternateIds : ['username', 'email'],
  publicSpec: {
    id:true, name:true, username:true, fullname:true, email:true, avatar:true, settings:true
  }
}).publicModel;
