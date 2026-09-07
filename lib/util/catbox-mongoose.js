/**
 * Catbox-compatible cache engine using Mongoose/MongoDB
 * Stores sessions in MongoDB for persistence across server restarts
 */

const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  _id: String,           // segment:id composite key
  value: mongoose.Schema.Types.Mixed,
  // `stored` is the STORE instant in epoch milliseconds and has to stay a
  // Number: @hapi/catbox reads it back as one - `const expires = result.stored +
  // result.ttl` [node_modules/@hapi/catbox/lib/client.js:68] - so a Date here
  // would produce a string concatenation, an absurd `expires`, and a session
  // that either never expires or expires at once. It is therefore NOT the field
  // the TTL index can use; see `expiresAt` below.
  stored: { type: Number, default: Date.now },
  ttl: Number,
  // `expiresAt` is the EXPIRY instant (`stored + ttl`) as a BSON Date, written
  // by `set()` purely so MongoDB's TTL monitor has a Date to act on. Nothing
  // reads it back: `get()`'s response is built from `stored` and `ttl` alone, so
  // this field can be absent on a document without changing any behaviour.
  expiresAt: Date
}, {
  collection: 'sessions',
  timestamps: false
});

// TTL index - automatically delete expired sessions.
//
// The monitor only expires fields holding a BSON Date (or an array of them) and
// silently ignores every other type, so this index has to sit on `expiresAt`
// and not on the numeric `stored`. `expireAfterSeconds: 0` means "delete once
// the instant in the field has passed", which is why the field must be the
// expiry instant rather than the store instant - the same field holding the
// store instant would delete every session as soon as it was written.
//
// The partial filter keeps the index sparse over the documents that carry the
// field. Two sets of documents deliberately fall outside it and are reclaimed
// only by the lazy check in `get()`:
//   * documents written before this field existed, which have no `expiresAt`;
//   * documents written with an unusable ttl (see `internals.expiryInstant`).
// Neither is broken by the index's presence - a TTL index never touches a
// document that does not match its filter.
//
// OPERATIONAL RESIDUE: mongoose's autoIndex creates indexes and never drops
// them, so a database that ran an earlier build keeps the previous, inert
// `stored_1` TTL index alongside this one. It is harmless - the monitor ignores
// the Number it indexes, exactly as this finding measured - but it costs writes
// and space, so an operator should drop it once:
//   db.sessions.dropIndex('stored_1')
// That is deliberately not done from here: this module is on the request path
// and index maintenance is not a per-boot concern.
sessionSchema.index({ expiresAt: 1 }, {
  expireAfterSeconds: 0,
  partialFilterExpression: { expiresAt: { $exists: true } }
});

let Session;

const internals = {};

// The widest instant a BSON Date can represent, in epoch milliseconds
// (ECMAScript's own +/-100,000,000-day limit; anything past it is an Invalid
// Date, which mongoose rejects with a CastError).
internals.maxDateMs = 8.64e15;

/**
 * Resolves the expiry instant to persist for a write, or `null` when the ttl
 * cannot produce one.
 *
 * `set()` is called by catbox, and catbox's own guard is `if (ttl <= 0) return;`
 * [node_modules/@hapi/catbox/lib/client.js:86] - which `undefined` and `NaN`
 * both pass, because either comparison is false. So an unusable ttl does reach
 * here, and `new Date(Date.now() + undefined)` is an Invalid Date that mongoose
 * would reject: a working session write would become a 500. The value is
 * therefore validated rather than cast.
 *
 * Returning `null` means "write no expiry instant", which keeps the document
 * outside the TTL index's partial filter. That is the safe direction for a
 * session store: a write whose lifetime is unknown must not be reaped early,
 * and it stays under the same lazy expiry as pre-existing documents.
 *
 * @param {number} stored - store instant, epoch milliseconds
 * @param {*} ttl - lifetime in milliseconds as supplied by catbox
 * @returns {Date|null} the expiry instant, or null when ttl is unusable
 */
internals.expiryInstant = function (stored, ttl) {
  // Coerced the way the `ttl` path itself is coerced on the way into MongoDB,
  // so the two fields cannot disagree: a value mongoose persists as a usable
  // number produces an expiry instant, and one it cannot does not.
  const ttlMs = typeof ttl === 'number' ? ttl : Number(ttl);

  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    return null;
  }

  const expires = stored + ttlMs;

  if (!Number.isFinite(expires) || Math.abs(expires) > internals.maxDateMs) {
    return null;
  }

  return new Date(expires);
};

internals.Engine = class {
  constructor(options = {}) {
    this.options = options;
    this.isConnected = false;
  }

  async start() {
    // Use existing mongoose connection
    if (mongoose.connection.readyState === 1) {
      this.isConnected = true;
      // Initialize model if not already done
      if (!Session) {
        Session = mongoose.model('Session', sessionSchema);
      }
    } else {
      // Wait for connection
      await new Promise((resolve, reject) => {
        mongoose.connection.once('open', () => {
          this.isConnected = true;
          if (!Session) {
            Session = mongoose.model('Session', sessionSchema);
          }
          resolve();
        });
        mongoose.connection.once('error', reject);
      });
    }
  }

  stop() {
    this.isConnected = false;
  }

  isReady() {
    return this.isConnected && mongoose.connection.readyState === 1;
  }

  validateSegmentName(name) {
    if (!name || typeof name !== 'string') {
      return new Error('Invalid segment name');
    }
    return null;
  }

  async get(key) {
    if (!this.isReady()) {
      throw new Error('Cache not ready');
    }

    const id = this._generateKey(key);

    try {
      const record = await Session.findById(id).lean();

      if (!record) {
        return null;
      }

      // Check if expired.
      //
      // This reads `stored` and `ttl` only, and deliberately not `expiresAt`:
      // it is the sole expiry mechanism for every document written before that
      // field existed, so it must not come to depend on it. It also still
      // matters for documents that do carry it, because the TTL monitor runs on
      // its own cycle (once a minute) and a key presented in between is expired
      // here first.
      if (record.ttl && (Date.now() - record.stored) > record.ttl) {
        await Session.deleteOne({ _id: id });
        return null;
      }

      // The response shape is catbox's contract - `{item, stored, ttl}` with
      // `stored` the numeric store instant - and `expiresAt` is not part of it.
      return {
        item: record.value,
        stored: record.stored,
        ttl: record.ttl
      };
    } catch (err) {
      throw err;
    }
  }

  async set(key, value, ttl) {
    if (!this.isReady()) {
      throw new Error('Cache not ready');
    }

    const id = this._generateKey(key);
    const stored = Date.now();
    const expiresAt = internals.expiryInstant(stored, ttl);

    // Written with explicit operators so an unusable ttl REMOVES a previously
    // stored expiry instant instead of leaving a stale one behind - a refreshed
    // session would otherwise keep the horizon of the write before it and be
    // reaped while it is still valid. `_id` is supplied by the filter on upsert,
    // so it is not part of the update.
    const update = {
      $set: {
        value: value,
        stored: stored,
        ttl: ttl
      }
    };

    if (expiresAt) {
      update.$set.expiresAt = expiresAt;
    }
    else {
      update.$unset = { expiresAt: 1 };
    }

    try {
      await Session.findByIdAndUpdate(id, update, { upsert: true });
    } catch (err) {
      throw err;
    }
  }

  async drop(key) {
    if (!this.isReady()) {
      throw new Error('Cache not ready');
    }

    const id = this._generateKey(key);

    try {
      await Session.deleteOne({ _id: id });
    } catch (err) {
      throw err;
    }
  }

  _generateKey(key) {
    return `${key.segment}:${key.id}`;
  }
};

module.exports = {
  Engine: internals.Engine
};
