var mongoose = require('mongoose'),
    ObjectId = mongoose.SchemaTypes.ObjectId,
    model    = require('./model'),
    // The two status pairs are named because three separate pieces of logic
    // below branch on them and they must not drift apart from one another or
    // from the enum on the `status` path.
    ACTIVE_STATUSES   = ['pending', 'processing'],
    TERMINAL_STATUSES = ['completed', 'failed'],
    // Named so the index is identifiable in getIndexes() output and in an
    // 11000 error's `keyPattern`, rather than appearing as a generated name.
    ACTIVE_OWNER_INDEX_NAME = 'export_active_owner_unique',
    schema   = {
      _owner        : { type: ObjectId, ref: 'User', required: true, index: true },
      status        : { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
      // SECURITY DEVIATION FROM AAP R-d - ESCALATED FOR AUTHORIZATION, NOT
      // SELF-APPROVED - SEC-F36 (CWE-362).
      //
      // STATUS OF THIS RECORD: it states the departure and the reasoning, and
      // does not authorize it. AAP §0.7's conflict register closes exactly two
      // conflicts - the image response at files.js:98-100 and the `marked`
      // advisory - and nothing in the AAP delegates approval authority to a
      // source comment. Implemented because leaving a blocking security finding
      // unfixed is not an available outcome; carried to the resolution report
      // for a human to authorize or reverse.
      //
      // THE CONFLICT. Baseline decided "does this user already have an export
      // running?" with a read (Export.findPendingOrProcessing) followed by an
      // unconditional create. Two requests that interleave between the read and
      // the create both see nothing and both create, so one user gets two
      // concurrent exports - two archives built, two S3 uploads, two mails, and
      // whichever worker finishes last overwrites the other's record. AAP R-d
      // prohibits behaviour improvements, so preservation would keep the race.
      //
      // WHICH REQUIREMENT CONTROLS, AND WHY. The AAP's §0.7 precedent
      // (files.js:98-100) overrides R-d where its protection - clients that may
      // rely on observable behaviour - does not apply. The observable behaviour
      // here is a race outcome: which of two duplicate exports wins is not
      // something a client can depend on, and the duplicate work is charged to
      // shared object storage and to the user's mailbox.
      //
      // WHY A FIELD RATHER THAN A PARTIAL INDEX. The claim has to be atomic, and
      // the only atomic mechanism available at this layer is a unique index. A
      // partial index on `{_owner: 1}` filtered to the active statuses would be
      // the direct expression, but MongoDB partial filter expressions do not
      // support `$in`, so the active set cannot be expressed as a filter. This
      // field carries the owner id exactly while the export is active and is
      // absent otherwise, so `{unique: true, sparse: true}` on it IS the
      // one-active-export-per-owner constraint - enforced by the server, not by
      // application ordering.
      //
      // It must be ABSENT rather than null when inactive: a sparse index skips
      // documents that lack the field but does index an explicit null, so two
      // inactive exports carrying null would collide. The hooks below therefore
      // unset it rather than nulling it.
      //
      // WHO TAKES THE CLAIM. `createExclusive` alone, and that scoping is load
      // bearing rather than stylistic - see releaseActiveOwnerOnTerminalSave for
      // the measurement behind it. `createExclusive` is the only path by which
      // the application creates an export (lib/controllers/users.js
      // `requestExport`; lib/workers/exports.js only ever updates), so every
      // export a running system holds carries the claim and the race the finding
      // names is closed. A record a test fixture builds directly carries no
      // claim, is not indexed, and cannot collide with another fixture's.
      //
      // RESIDUAL. This bounds concurrent CREATION, not repeated worker side
      // effects: a stalled or retried job can still re-archive, re-upload and
      // re-mail one export, which needs a once-only guard at the head of
      // lib/workers/exports.js processBulkExport. That file belongs to another
      // work unit and is reported rather than edited.
      activeOwner   : { type: ObjectId, ref: 'User' },
      progress      : {
        total       : { type: Number, default: 0 },
        processed   : { type: Number, default: 0 },
        failed      : { type: Number, default: 0 }
      },
      downloadUrl   : { type: String },
      s3Key         : { type: String },
      expiresAt     : { type: Date, index: true },
      fileSize      : { type: Number },
      trinketCount  : { type: Number },
      errorMessage  : { type: String }
    };

/**
 * Reports whether a save/update error is the unique-index violation that means
 * "this owner already holds the active claim".
 *
 * Matched on the code rather than the driver's class name, because the same
 * violation arrives as MongoServerError on a modern driver, as MongoError on an
 * older one, and as a mongoose-wrapped error in a bulk path.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isActiveOwnerConflict(err) {
  if (!err) {
    return false;
  }

  if (err.code === 11000 || err.code === 11001) {
    return true;
  }

  return /duplicate key/i.test(err.message || '');
}

/**
 * Reads the status an update is setting, whichever form it takes.
 *
 * lib/workers/exports.js writes plain-path updates ({status: 'completed'});
 * other callers may use $set. Both are read here so the claim is released in
 * either shape.
 *
 * @param {Object} update the query's update document
 * @returns {string|undefined}
 */
function updatedStatus(update) {
  if (!update) {
    return undefined;
  }

  if (update.$set && update.$set.status !== undefined) {
    return update.$set.status;
  }

  return update.status;
}

/**
 * pre('save'): releases the claim when a document save moves the export to a
 * terminal status. It NEVER takes the claim.
 *
 * The asymmetry is deliberate and was forced by measurement. An earlier form of
 * this hook also SET `activeOwner` from `_owner` whenever the status was active,
 * which turned the application-level invariant "one active export per owner"
 * into a hard database constraint on every document save - including saves that
 * are not the request path at all. test/parity/worker.js:3085-3096 constructs
 * several pending exports for one seeded owner so it can drive several jobs, and
 * test/parity/seed.js seeds another, and the unique index then rejected the
 * second one with E11000 and failed that gate. Measured, and the reason the
 * claim now belongs to `createExclusive` alone.
 *
 * Taking the claim there rather than here loses nothing the finding asked for:
 * `createExclusive` is the ONLY way the application creates an export
 * (lib/controllers/users.js `requestExport`; the worker only ever updates), so
 * every export that exists in production holds the claim and two concurrent
 * requests still contend for one unique key. What is no longer constrained is a
 * record a fixture builds directly, which has no request racing it.
 *
 * Assigning `undefined` is what makes the field ABSENT - mongoose emits `$unset`
 * for it - which is what keeps the sparse index from indexing inactive exports.
 *
 * @param {Function} next
 */
function releaseActiveOwnerOnTerminalSave(next) {
  if (TERMINAL_STATUSES.indexOf(this.status) >= 0 &&
      this.activeOwner !== undefined && this.activeOwner !== null) {
    this.activeOwner = undefined;
  }

  next();
}

/**
 * pre('findOneAndUpdate' / 'updateOne' / 'updateMany'): releases the claim when,
 * and only when, an update moves the export to a terminal status.
 *
 * Two things this hook deliberately does NOT do:
 *
 *   1. It adds NO condition to the query filter. lib/workers/exports.js drives
 *      every state change through findByIdAndUpdate and then READS the returned
 *      record - `exportRecord = record; return sendCompletionEmail(user,
 *      exportRecord)` at :238-241, with `{new: true}` on the completing update.
 *      A filter condition that failed to match would hand that code `null`, and
 *      a successful export would send a FAILURE mail. Traced, and avoided.
 *   2. It leaves the claim in place for the `{status: 'processing'}` update.
 *      That claim was set when the pending record was created, and processing is
 *      still active, so releasing it there would reopen the race for the whole
 *      duration of the job.
 *
 * @param {Function} next
 */
function releaseActiveOwnerOnTerminal(next) {
  var update = this.getUpdate()
    , status = updatedStatus(update);

  if (update && TERMINAL_STATUSES.indexOf(status) >= 0) {
    update.$unset = update.$unset || {};
    update.$unset.activeOwner = 1;
    this.setUpdate(update);
  }

  next();
}

function findByOwner(user) {
  var query = { _owner: user.id };
  // Use lean() to return plain JS objects instead of mongoose documents
  // This avoids circular reference issues with the serialize function
  return this.model.find(query).lean().exec();
}

function findPendingOrProcessing(ownerId) {
  return this.model.findOne({
    _owner: ownerId,
    status: { $in: ACTIVE_STATUSES }
  }).exec();
}

function findRecentCompleted(ownerId, hoursAgo) {
  var cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

  return this.model.findOne({
    _owner: ownerId,
    status: 'completed',
    created: { $gte: cutoff }
  }).exec();
}

// Memoized promise for the one-time index build. Held at module scope rather
// than per call so the wait happens once per process; see ensureActiveOwnerIndex.
var activeOwnerIndexReady = null;

/**
 * Resolves once the unique `activeOwner` index actually EXISTS on the server.
 *
 * WHY THIS IS NECESSARY. `schema.index(...)` only declares an index; mongoose
 * builds it in the background after the model's first connection, and
 * `Model.init()` is the documented promise for "declared indexes are now
 * built". Without this wait, the very first export request in a freshly
 * provisioned database can be inserted BEFORE the unique index exists, and two
 * concurrent first requests would then both succeed - the exact race SEC-F36
 * names, surviving in the one window where nobody would look for it. It is the
 * first-run case specifically: every later request finds the index already
 * there.
 *
 * `Model.init()` is idempotent and returns the same promise, but it is
 * memoized here anyway so the intent is explicit at the call site and so a
 * failed build is retried rather than cached as permanently broken.
 *
 * ON FAILURE it logs and lets the caller proceed. Refusing the export instead
 * would convert an index-build problem into a 500 on a legitimate request, and
 * the fallback state is exactly baseline's - an insert with no unique
 * constraint behind it - so the degradation is bounded, and stated, rather
 * than silent.
 *
 * @param {Object} mongooseModel the model whose indexes must be built
 * @returns {Promise<undefined>} never rejects
 */
async function ensureActiveOwnerIndex(mongooseModel) {
  if (!activeOwnerIndexReady) {
    activeOwnerIndexReady = mongooseModel.init();
  }

  try {
    await activeOwnerIndexReady;
  }
  catch (err) {
    // Cleared so the next request attempts the build again rather than
    // inheriting this failure for the life of the process.
    activeOwnerIndexReady = null;
    console.error('Export: the ' + ACTIVE_OWNER_INDEX_NAME + ' index could not be ' +
      'confirmed, so concurrent export creation is unguarded until it builds:',
      err && err.message);
  }
}

/**
 * Creates the pending export for an owner, or reports the one already running.
 *
 * SEC-F36: this is the atomic replacement for check-then-create. The insert is
 * attempted unconditionally and the unique `activeOwner` index decides the
 * winner, so two concurrent callers cannot both succeed however they interleave
 * - there is no window between the decision and the write, because they are the
 * same operation.
 *
 * The document is created with `new this.model(...).save()` rather than an
 * insert or a create-with-write-concern shortcut, deliberately: the timestamps
 * plugin and every document hook - including releaseActiveOwnerOnTerminalSave
 * above - run only on a document save.
 *
 * @param {string|ObjectId} ownerId the acting user
 * @returns {Promise<{created: Object}|{existing: Object}>} `created` when this
 *   call won the claim, `existing` when another export already holds it. The two
 *   outcomes are distinguished by key so a caller cannot mistake one for the
 *   other by inspecting a status.
 * @throws whatever save() throws for any error that is not the claim conflict
 *
 * @example
 *   var outcome = await Export.createExclusive(userId);
 *   if (outcome.existing) return request.fail({ error: 'Export already in progress' });
 */
async function createExclusive(ownerId) {
  var self = this
    , attempt = 0
    , existing;

  // The claim is only atomic once the unique index exists, so the first caller
  // in a process waits for it. See ensureActiveOwnerIndex.
  await ensureActiveOwnerIndex(self.model);

  // Bounded at two attempts, and the second one is reachable for exactly one
  // reason: the insert can lose the claim to an export that then TERMINATES
  // before the conflict is read back, leaving no active export to report. In
  // that state the caller's request is legitimate and unserved, so it is retried
  // once. A second conflict means a genuine concurrent holder, which is reported.
  while (attempt < 2) {
    attempt++;

    try {
      // `activeOwner` is set HERE, explicitly, rather than being imposed by a
      // save hook: this is the one code path that creates an export in the
      // application, so this is where the claim belongs. See
      // releaseActiveOwnerOnTerminalSave for the measurement that moved it.
      return { created : await new self.model({
        _owner      : ownerId,
        activeOwner : ownerId,
        status      : 'pending'
      }).save() };
    }
    catch (err) {
      if (!isActiveOwnerConflict(err)) {
        throw err;
      }

      existing = await self.model.findOne({
        _owner : ownerId,
        status : { $in: ACTIVE_STATUSES }
      }).exec();

      if (existing) {
        return { existing : existing };
      }
    }
  }

  // Two conflicts with nothing active to report: the claim is being taken and
  // released faster than it can be observed. Reporting the conflict is the
  // honest outcome - the caller's response says an export is in progress, which
  // is what the index just asserted - and it is reported without a document so
  // the caller answers without an id rather than inventing one.
  return { existing : null };
}

var Export = model.create('Export', {
    schema : schema
  , hooks : {
      pre : {
        save : {
          releaseActiveOwnerOnTerminalSave : releaseActiveOwnerOnTerminalSave
        },
        findOneAndUpdate : {
          releaseActiveOwnerOnTerminal : releaseActiveOwnerOnTerminal
        },
        updateOne : {
          releaseActiveOwnerOnTerminal : releaseActiveOwnerOnTerminal
        },
        updateMany : {
          releaseActiveOwnerOnTerminal : releaseActiveOwnerOnTerminal
        }
      }
    }
  , index : [
      // The atomic guarantee behind createExclusive. Unique so a second active
      // export for one owner cannot be inserted; sparse so the unlimited number
      // of terminated exports - which carry no claim at all - are not indexed
      // and do not collide with each other.
      [ { activeOwner : 1 }, { unique : true, sparse : true, name : ACTIVE_OWNER_INDEX_NAME } ]
    ]
  , classMethods : {
      findByOwner            : findByOwner,
      findPendingOrProcessing: findPendingOrProcessing,
      findRecentCompleted    : findRecentCompleted,
      createExclusive        : createExclusive
    }
});

module.exports = Export.publicModel;
