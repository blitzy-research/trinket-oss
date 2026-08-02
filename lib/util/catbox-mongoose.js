/**
 * Catbox-compatible cache engine using Mongoose/MongoDB
 * Stores sessions in MongoDB for persistence across server restarts
 */

const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  _id: String,           // segment:id composite key
  value: mongoose.Schema.Types.Mixed,
  stored: { type: Number, default: Date.now },
  ttl: Number
}, {
  collection: 'sessions',
  timestamps: false
});

// TTL index - automatically delete expired sessions
// This index is inert and deliberately so: `stored` is a Number above and MongoDB's TTL monitor
// only acts on Date-valued fields, so nothing is ever reaped. Real expiry is the lazy per-read
// check in get() below, and the Number typing is required by catbox, which computes `stored + ttl`.
// See docs/PRESERVED-QUIRKS.md section 1.14 E.
sessionSchema.index({ stored: 1 }, {
  expireAfterSeconds: 0,
  partialFilterExpression: { ttl: { $exists: true } }
});

let Session;

const internals = {};

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

      // Check if expired
      // This check, not the declared TTL index, is the effective expiry mechanism.
      // See docs/PRESERVED-QUIRKS.md section 1.14 E.
      if (record.ttl && (Date.now() - record.stored) > record.ttl) {
        await Session.deleteOne({ _id: id });
        return null;
      }

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

    try {
      await Session.findByIdAndUpdate(
        id,
        {
          _id: id,
          value: value,
          stored: Date.now(),
          ttl: ttl
        },
        { upsert: true }
      );
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
