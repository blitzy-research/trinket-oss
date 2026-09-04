var sinon = require('sinon'),
    Store = require('../../lib/util/store');

module.exports = {
  Store : Store,
  stub  : function() {
    before(function() {
      Store.internals = {};
      sinon.stub(Store, 'get').callsFake(async function(key) {
        return Store.internals[key];
      });
      sinon.stub(Store, 'set').callsFake(async function(key, val) {
        Store.internals[key] = val;
        return 'OK';
      });
      // Presence-faithful, matching both real backends' DEL: 1 when a key was
      // removed, 0 when there was none. lib/controllers/users.js savePassword
      // treats that verdict as its compare-and-delete authorization for the
      // single-use reset token, so a stub that answered 1 unconditionally would
      // hide a broken claim rather than exercise it.
      sinon.stub(Store, 'del').callsFake(async function(key) {
        var existed = Object.prototype.hasOwnProperty.call(Store.internals, key);
        delete Store.internals[key];
        return existed ? 1 : 0;
      });
      sinon.stub(Store, 'expire').callsFake(async function(key, s) {
        return 1;
      });
      // Store.incr backs Store.rateLimit (lib/util/store.js), which the login
      // and password-reset handlers call. Stubbing it against the same
      // Store.internals map as get/set/del keeps the stubbed store internally
      // consistent - the counters live where the stubbed tokens live - and keeps
      // the real in-memory backend out of a suite that has replaced the rest of
      // this interface. The semantics are Redis INCR's: absent counts as 0, the
      // value is stored back as a string, and the new count is returned.
      sinon.stub(Store, 'incr').callsFake(async function(key) {
        var next = parseInt(Store.internals[key] || '0', 10) + 1;
        Store.internals[key] = String(next);
        return next;
      });
    });

    after(function() {
      Store.internals = {};

      Store.get.restore();
      Store.set.restore();
      Store.del.restore();
      Store.expire.restore();
      Store.incr.restore();
    });
  }
};
