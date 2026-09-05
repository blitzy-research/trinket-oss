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
      sinon.stub(Store, 'del').callsFake(async function(key) {
        delete Store.internals[key];
        return 1;
      });
      sinon.stub(Store, 'expire').callsFake(async function(key, s) {
        return 1;
      });
    });

    after(function() {
      Store.internals = {};

      Store.get.restore();
      Store.set.restore();
      Store.del.restore();
      Store.expire.restore();
    });
  }
};
