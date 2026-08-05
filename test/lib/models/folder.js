/**
 * Folder model coverage for the two opposite timing contracts.
 *
 * `deleteFolder` deliberately STARTS permission and trinket cleanup without awaiting either one, so failures
 * are logged and swallowed after the delete has already resolved. `updateOwnerSlug` has the opposite
 * contract and WAITS for every trinket save. Both timings, and the fate of an error on each path, are pinned
 * below.
 */

var mongoose = require('mongoose'),
    sinon    = require('sinon'),
    should   = require('chai').should(),
    Folder   = require('../../../lib/models/folder');

describe('Folder model', function() {
  var createdIds = [];
  var stubs = [];

  function remember(document) {
    createdIds.push(document._id);
    return document;
  }

  function createFolder(data) {
    return new Folder(Object.assign({
      name      : 'Measured Folder',
      ownerSlug : 'measured-owner',
      _owner    : new mongoose.Types.ObjectId()
    }, data)).save().then(remember);
  }

  function deferred() {
    var controls = {};
    controls.promise = new Promise(function(resolve, reject) {
      controls.resolve = resolve;
      controls.reject  = reject;
    });
    return controls;
  }

  function delay(ms) {
    return new Promise(function(resolve) {
      setTimeout(resolve, ms);
    });
  }

  afterEach(function() {
    stubs.forEach(function(stub) {
      stub.restore();
    });
    stubs = [];

    var ids = createdIds;
    createdIds = [];

    if (!ids.length) return;
    return Folder.model.deleteMany({ _id : { $in : ids } });
  });

  describe('findByOwner', function() {
    it('returns only folders belonging to the supplied user id', async function() {
      var owner = new mongoose.Types.ObjectId();
      var expected = await createFolder({
        name   : 'Owned Folder',
        _owner : owner
      });
      await createFolder({
        name   : 'Other Folder',
        _owner : new mongoose.Types.ObjectId()
      });

      var result = await Folder.findByOwner({ id : owner });

      result.should.have.length(1);
      result[0].id.should.equal(expected.id);
    });
  });

  describe('addTrinket and removeTrinket', function() {
    it('persists the full add-to-set shape and defaults missing instructions to an empty string',
      async function() {
        var folder = await createFolder();
        var userId = new mongoose.Types.ObjectId();
        var trinketId = new mongoose.Types.ObjectId();
        var trinket = {
          id          : trinketId,
          name        : 'Measured Trinket',
          lang        : 'python',
          shortCode   : 'short123',
          snapshot    : 'snapshot.png',
          description : undefined
        };

        var result = await folder.addTrinket(trinket, userId);

        result.trinkets.should.have.length(1);
        String(result.trinkets[0].trinketId).should.equal(String(trinketId));
        result.trinkets[0].name.should.equal('Measured Trinket');
        result.trinkets[0].lang.should.equal('python');
        result.trinkets[0].shortCode.should.equal('short123');
        result.trinkets[0].snapshot.should.equal('snapshot.png');
        result.trinkets[0].instructions.should.equal('');
        String(result.trinkets[0].addedBy).should.equal(String(userId));
      });

    it('uses $addToSet so an identical association is not duplicated', async function() {
      var folder = await createFolder();
      var userId = new mongoose.Types.ObjectId();
      var trinket = {
        id          : new mongoose.Types.ObjectId(),
        name        : 'Measured Trinket',
        lang        : 'python',
        shortCode   : 'short123',
        snapshot    : 'snapshot.png',
        description : 'instructions'
      };

      await folder.addTrinket(trinket, userId);
      var result = await folder.addTrinket(trinket, userId);

      result.trinkets.should.have.length(1);
    });

    it('removes only the association whose trinket id matches', async function() {
      var firstId = new mongoose.Types.ObjectId();
      var secondId = new mongoose.Types.ObjectId();
      var folder = await createFolder({
        trinkets : [
          { trinketId : firstId, name : 'first' },
          { trinketId : secondId, name : 'second' }
        ]
      });

      var result = await folder.removeTrinket(firstId);

      result.trinkets.should.have.length(1);
      String(result.trinkets[0].trinketId).should.equal(String(secondId));
    });

    it('passes the exact $addToSet command and new-document option to the public model', async function() {
      var findByIdAndUpdate = sinon.stub(Folder, 'findByIdAndUpdate').returns({
        exec : function() {
          return Promise.resolve('updated folder');
        }
      });
      stubs.push(findByIdAndUpdate);

      var result = await Folder.objectMethods.addTrinket.call({
        id : 'folder-id'
      }, {
        id          : 'trinket-id',
        name        : 'name',
        lang        : 'python',
        shortCode   : 'short',
        snapshot    : 'snap',
        description : ''
      }, 'user-id');

      result.should.equal('updated folder');
      findByIdAndUpdate.calledOnce.should.be.true;
      findByIdAndUpdate.firstCall.args.should.deep.equal([
        'folder-id',
        {
          '$addToSet' : {
            trinkets : {
              trinketId    : 'trinket-id',
              name         : 'name',
              lang         : 'python',
              shortCode    : 'short',
              snapshot     : 'snap',
              instructions : '',
              addedBy      : 'user-id'
            }
          }
        },
        { new : true }
      ]);
    });
  });

  describe('updateTrinket', function() {
    it('updates the positional name, instructions and a truthy snapshot through the private model',
      async function() {
        var updateOne = sinon.stub(Folder.model, 'updateOne').returns({
          exec : function() {
            return Promise.resolve('update result');
          }
        });
        stubs.push(updateOne);

        var result = await Folder.objectMethods.updateTrinket.call({
          id : 'folder-id'
        }, {
          id           : 'trinket-id',
          name         : 'new name',
          instructions : 'new instructions',
          snapshot     : 'new.png'
        });

        result.should.equal('update result');
        updateOne.calledOnce.should.be.true;
        updateOne.firstCall.args.should.deep.equal([
          {
            _id      : 'folder-id',
            trinkets : {
              '$elemMatch' : {
                trinketId : 'trinket-id'
              }
            }
          },
          {
            '$set' : {
              'trinkets.$.name'         : 'new name',
              'trinkets.$.instructions' : 'new instructions',
              'trinkets.$.snapshot'     : 'new.png'
            }
          },
          { new : true }
        ]);
      });

    it('defaults missing instructions and leaves the snapshot out of the command when it is falsy',
      async function() {
        var updateOne = sinon.stub(Folder.model, 'updateOne').returns({
          exec : function() {
            return Promise.resolve('update result');
          }
        });
        stubs.push(updateOne);

        await Folder.objectMethods.updateTrinket.call({
          id : 'folder-id'
        }, {
          id       : 'trinket-id',
          name     : 'new name',
          snapshot : ''
        });

        updateOne.firstCall.args[1].should.deep.equal({
          '$set' : {
            'trinkets.$.name'         : 'new name',
            'trinkets.$.instructions' : ''
          }
        });
      });

    it('persists the positional update and preserves an existing snapshot on a falsy replacement',
      async function() {
        var trinketId = new mongoose.Types.ObjectId();
        var folder = await createFolder({
          trinkets : [{
            trinketId    : trinketId,
            name         : 'old name',
            instructions : 'old instructions',
            snapshot     : 'old.png'
          }]
        });

        var first = await folder.updateTrinket({
          id           : trinketId,
          name         : 'new name',
          instructions : 'new instructions',
          snapshot     : 'new.png'
        });
        first.acknowledged.should.be.true;
        first.matchedCount.should.equal(1);
        first.modifiedCount.should.equal(1);

        await folder.updateTrinket({
          id           : trinketId,
          name         : 'newer name',
          instructions : '',
          snapshot     : ''
        });
        var stored = await Folder.findById(folder.id);

        stored.trinkets[0].name.should.equal('newer name');
        stored.trinkets[0].instructions.should.equal('');
        stored.trinkets[0].snapshot.should.equal('new.png');
      });
  });

  it('builds the public folder URL from ownerSlug and slug', function() {
    Folder.objectMethods.url.call({
      ownerSlug : 'owner-name',
      slug      : 'folder-name'
    }).should.equal('/owner-name/folders/folder-name');
  });

  describe('deleteFolder', function() {
    it('resolves before either fire-and-forget cleanup settles', async function() {
      var revoke = deferred();
      var remove = deferred();
      var state = {
        revoked : false,
        removed : false
      };
      var userFind = sinon.stub(User, 'findById').resolves({
        revokeAll : sinon.stub().returns(revoke.promise.then(function() {
          state.revoked = true;
        }))
      });
      var trinketFind = sinon.stub(Trinket, 'findById').resolves({
        removeFolder : sinon.stub().returns(remove.promise.then(function() {
          state.removed = true;
        }))
      });
      stubs.push(userFind, trinketFind);
      var deleteOne = sinon.stub().resolves();

      await Folder.objectMethods.deleteFolder.call({
        id        : 'folder-id',
        _owner    : 'owner-id',
        trinkets  : [{ trinketId : 'trinket-id' }],
        deleteOne : deleteOne
      });
      await Promise.resolve();

      deleteOne.calledOnce.should.be.true;
      userFind.calledOnce.should.be.true;
      userFind.firstCall.args.should.deep.equal(['owner-id']);
      trinketFind.calledOnce.should.be.true;
      trinketFind.firstCall.args.should.deep.equal(['trinket-id']);
      state.should.deep.equal({ revoked : false, removed : false });

      revoke.resolve();
      remove.resolve();
      await Promise.all([revoke.promise, remove.promise]);
      await Promise.resolve();
      state.should.deep.equal({ revoked : true, removed : true });
    });

    it('logs both cleanup failures exactly and still resolves the delete', async function() {
      var userFind = sinon.stub(User, 'findById').rejects(new Error('revoke failed'));
      var trinketFind = sinon.stub(Trinket, 'findById').rejects(new Error('remove failed'));
      var errorLog = sinon.stub(console, 'error');
      stubs.push(userFind, trinketFind, errorLog);

      await Folder.objectMethods.deleteFolder.call({
        id        : 'folder-id',
        _owner    : 'owner-id',
        trinkets  : [{ trinketId : 'trinket-id' }],
        deleteOne : function() {
          return Promise.resolve();
        }
      });
      await delay(10);

      errorLog.callCount.should.equal(2);
      errorLog.firstCall.args.should.deep.equal([
        'Failed to revoke folder permissions:',
        'revoke failed'
      ]);
      errorLog.secondCall.args.should.deep.equal([
        'Failed to remove folder from trinket:',
        'remove failed'
      ]);
    });

    it('skips the trinket cleanup loop for an empty association list', async function() {
      var userFind = sinon.stub(User, 'findById').resolves(null);
      var trinketFind = sinon.stub(Trinket, 'findById');
      stubs.push(userFind, trinketFind);

      await Folder.objectMethods.deleteFolder.call({
        id        : 'folder-id',
        _owner    : 'owner-id',
        trinkets  : [],
        deleteOne : function() {
          return Promise.resolve();
        }
      });
      await Promise.resolve();

      trinketFind.called.should.be.false;
    });
  });

  describe('updateOwnerSlug', function() {
    it('waits for every trinket save and then resolves with the updated folder', async function() {
      var saved = deferred();
      var trinket = {
        folder : { ownerSlug : 'old-owner' },
        save   : sinon.stub().returns(saved.promise)
      };
      var updatedFolder = {
        ownerSlug : 'new-owner',
        trinkets  : [{ trinketId : 'trinket-id' }]
      };
      var findByIdAndUpdate = sinon.stub(Folder, 'findByIdAndUpdate').returns({
        exec : function() {
          return Promise.resolve(updatedFolder);
        }
      });
      var trinketFind = sinon.stub(Trinket, 'findById').resolves(trinket);
      stubs.push(findByIdAndUpdate, trinketFind);

      var operation = Folder.objectMethods.updateOwnerSlug.call({
        id : 'folder-id'
      }, 'new-owner');
      var early = await Promise.race([
        operation.then(function() { return 'resolved'; }),
        delay(20).then(function() { return 'pending'; })
      ]);

      early.should.equal('pending');
      trinket.folder.ownerSlug.should.equal('new-owner');
      trinket.save.calledOnce.should.be.true;
      findByIdAndUpdate.firstCall.args.should.deep.equal([
        'folder-id',
        {
          '$set' : {
            ownerSlug : 'new-owner'
          }
        },
        { new : true }
      ]);

      saved.resolve(trinket);
      (await operation).should.equal(updatedFolder);
    });

    it('propagates the identical trinket-save rejection', async function() {
      var expected = new Error('trinket save failed');
      var findByIdAndUpdate = sinon.stub(Folder, 'findByIdAndUpdate').returns({
        exec : function() {
          return Promise.resolve({
            trinkets : [{ trinketId : 'trinket-id' }]
          });
        }
      });
      var trinketFind = sinon.stub(Trinket, 'findById').resolves({
        folder : { ownerSlug : 'old-owner' },
        save   : function() {
          return Promise.reject(expected);
        }
      });
      stubs.push(findByIdAndUpdate, trinketFind);

      var rejected;
      try {
        await Folder.objectMethods.updateOwnerSlug.call({
          id : 'folder-id'
        }, 'new-owner');
      }
      catch (err) {
        rejected = err;
      }

      rejected.should.equal(expected);
    });
  });
});
