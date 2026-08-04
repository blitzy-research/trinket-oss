/**
 * The bulk-export worker: lib/workers/exports.js (review finding M-19).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * This module carries three of the migration's largest single-file changes - aws-sdk v2 to
 * @aws-sdk/client-s3 v3, the complete removal of `q` (four `Q.defer()`s, `Q.all` and `Q.allSettled`), and
 * archiver 2 to 7, whose `finalize()` returns a promise where the old one returned `this` - and it had no
 * tests whatsoever. Nothing verified the archive's entry layout, the S3 parameters, the notification
 * emails, the temp-file cleanup or either terminal outcome.
 *
 * HOW THE MODULE IS REACHED
 * -------------------------
 * `lib/workers/exports.js` exports nothing. Its entire public surface is what it registers on the queue at
 * load: one `process` handler and the 'error', 'failed' and 'completed' listeners. It is also required by
 * nothing else in the tree - it is a standalone worker entry point - so `before` stubs
 * `lib/util/queues.js#exports` to hand it an inert stand-in queue, requires it once, and keeps the
 * handler and the listeners the module registered. Two things follow, both deliberate:
 *
 *   1. The processor under test IS the production processor. No behaviour is re-implemented here.
 *   2. Nothing is registered on the real Bull queue. That matters beyond tidiness: the 'exports' queue
 *      lives in a Redis instance shared by every parallel clone, so registering a live processor here
 *      would make this test process a worker for other clones' jobs.
 *
 * WHAT IS STUBBED, AND WHY EACH ONE IS THE OUTERMOST SEAM
 * ------------------------------------------------------
 *   - `config/aws.js#getS3Client` - a recorder, exactly as test/lib/util/file-storage.js uses. The real
 *     `GetObjectCommand` and `PutObjectCommand` classes are still constructed by production code, so a
 *     wrong bucket, key, content type or Content-Disposition is visible.
 *   - `lib/util/mailer.js#send` - records recipient, subject, type and the RENDERED html, so the real
 *     nunjucks templates and the real `formatFileSize` still run.
 *   - `Trinket.model.find` - only where an archive has to be built. `createExportArchive` calls
 *     `.select(...).stream()`, and Query#stream was removed in mongoose 5, so on the real query it throws.
 *     That throw is a PRESERVED QUIRK (docs/PRESERVED-QUIRKS.md section 3.24) and is pinned on its own
 *     below, unstubbed; supplying a stream-capable query is what makes the archive-construction code -
 *     which the quirk otherwise renders dead - reachable and testable.
 *
 * Everything else is real: the real Export and User models against the real test database, the real
 * archiver, the real zip bytes (read back with adm-zip), the real sha1 filename derivation and the real
 * templates.
 *
 * THE EXPORTS BUCKET
 * ------------------
 * `config.aws.buckets.exports` is ABSENT from config/default.yaml - measured. `uploadToS3` therefore
 * throws `TypeError: Cannot read properties of undefined (reading 'name')` under the shipped
 * configuration, and that measured outcome is pinned as its own test. The success-path tests inject the
 * bucket for their duration and `after` deletes the key again, restoring the shipped shape exactly.
 *
 * Every expectation below was MEASURED against the running worker first (R-6).
 */

var chai     = require('chai'),
    should   = chai.should(),
    sinon    = require('sinon'),
    stream   = require('stream'),
    AdmZip   = require('adm-zip'),
    mongoose = require('mongoose'),
    config   = require('config'),
    queues   = require('../../../lib/util/queues'),
    aws      = require('../../../config/aws'),
    mailer   = require('../../../lib/util/mailer'),
    Export   = require('../../../lib/models/export'),
    User     = require('../../../lib/models/user'),
    Trinket  = require('../../../lib/models/trinket'),
    db       = require('../../helpers/db');

describe('The bulk-export worker', function() {
  var SUFFIX = process.pid + '',
      queue  = null,
      handle = null,
      sent   = [],
      mails  = [],
      react  = null,
      stubs  = [],
      user   = null,
      record = null;

  /**
   * An inert stand-in for the shared Bull queue, capturing what the worker registers on load.
   *
   * @returns {Object} A queue exposing `process`, `on`, the captured handler and the captured listeners.
   */
  function inertQueue() {
    return {
      name      : 'exports',
      handler   : null,
      listeners : {},
      process   : function(handler) {
        this.handler = handler;
      },
      on : function(event, listener) {
        (this.listeners[event] = this.listeners[event] || []).push(listener);

        return this;
      }
    };
  }

  /**
   * A recording S3 client. A streamed request body is READ TO THE END rather than merely recorded,
   * because that is what the real client does and because production unlinks the archive it is streaming
   * as soon as the upload settles - so a body left unread would be an open descriptor over a deleted file.
   * Reading it is also what makes the archive's bytes, and therefore its entry layout, assertable.
   *
   * @returns {Object} A client whose `send` records the command and honours `react`.
   */
  function recorder() {
    return {
      send : function(command) {
        var reaction = react && react(command);

        sent.push(command);

        if (reaction) {
          return reaction;
        }

        if (command.constructor.name === 'GetObjectCommand') {
          return Promise.resolve({
            Body : {
              transformToByteArray : function() {
                // Deliberately settled on a TIMER, not immediately. A real asset download takes
                // milliseconds, and `await Promise.allSettled(assetPromises)` in addTrinketToArchive is
                // what holds the archive open for it. An instantly-resolved download hides that: the
                // append still lands before finalize by luck, and removing the await was measured to
                // break nothing. With this delay the missing await loses the asset entry, so these tests
                // actually discriminate the `Q.allSettled` conversion they exist to cover.
                return new Promise(function(resolve) {
                  setTimeout(function() {
                    resolve(new Uint8Array([9, 8, 7]));
                  }, 5);
                });
              }
            }
          });
        }

        if (command.input && command.input.Body && typeof command.input.Body.pipe === 'function') {
          return new Promise(function(resolve, reject) {
            var chunks = [];

            command.input.Body.on('data', function(chunk) {
              chunks.push(chunk);
            });
            command.input.Body.on('error', reject);
            command.input.Body.on('end', function() {
              command.archiveBytes = Buffer.concat(chunks);
              resolve({});
            });
          });
        }

        return Promise.resolve({});
      }
    };
  }

  /** A query whose `.select().stream()` emits `docs` - the shape mongoose 6 no longer provides. */
  function queryStreaming(docs) {
    return {
      select : function() {
        return {
          stream : function() {
            var readable = new stream.Readable({ objectMode : true, read : function() {} });

            setImmediate(function() {
              docs.forEach(function(doc) {
                readable.push(doc);
              });
              readable.push(null);
            });

            return readable;
          }
        };
      }
    };
  }

  /** A plain trinket-shaped object, as the removed Query#stream would have emitted. */
  function trinket(overrides) {
    return Object.assign({
      shortCode   : 'sc',
      name        : 'name',
      lang        : 'python',
      code        : 'print(1)',
      assets      : [],
      settings    : {},
      created     : new Date(0),
      lastUpdated : new Date(0)
    }, overrides);
  }

  /** Registers a stub for unconditional restoration in afterEach. */
  function stub(object, method) {
    var created = sinon.stub(object, method);

    stubs.push(created);

    return created;
  }

  /** Makes the trinket query streamable for the duration of one test. */
  function streaming(docs) {
    stub(Trinket.model, 'find').returns(queryStreaming(docs));
  }

  /** Invokes the production processor exactly as Bull would. */
  function runJob(data) {
    return handle({
      data : Object.assign({
        action   : 'bulk-export',
        exportId : record._id.toString(),
        userId   : user._id.toString()
      }, data || {})
    });
  }

  /** The single command of a given kind that the job issued. */
  function command(kind) {
    var matches = sent.filter(function(candidate) {
      return candidate.constructor.name === kind;
    });

    matches.length.should.be.at.least(1, 'expected the job to issue a ' + kind);

    return matches[0];
  }

  /** The uploaded archive, read back from the bytes the recorder collected. */
  function archive() {
    var put = command('PutObjectCommand');

    should.exist(put.archiveBytes, 'the recorder must have collected the archive body');

    return new AdmZip(put.archiveBytes);
  }

  /** Sorted entry names of the uploaded archive. */
  function entryNames() {
    return archive().getEntries().map(function(entry) {
      return entry.entryName;
    }).sort();
  }

  /** Whitespace-collapsed text of an archive entry, so JSON indentation is not asserted. */
  function entryText(name) {
    return archive().readAsText(name).replace(/\s+/g, ' ');
  }

  before(function() {
    this.timeout(30000);

    queue = inertQueue();

    // Stubbed only across the require: the module reads `queues.exports()` once, at load.
    var factory = sinon.stub(queues, 'exports').returns(queue);

    try {
      require('../../../lib/workers/exports');
    }
    finally {
      factory.restore();
    }

    handle = queue.handler;
    should.exist(handle, 'the worker must have registered a processor');

    return new Promise(function(resolve, reject) {
      db.ensureConnection(function(err) {
        return err ? reject(err) : resolve();
      });
    }).then(function() {
      user = new User.model({
        fullname : 'export worker',
        username : 'exportworker' + SUFFIX,
        email    : 'exportworker' + SUFFIX + '@example.com',
        password : 'exportworkerpw'
      });

      return user.save();
    });
  });

  after(function() {
    if (!db.isConnected()) {
      return null;
    }

    return User.model.deleteOne({ _id : user._id }).then(function() {
      return Export.model.deleteMany({ _owner : user._id });
    });
  });

  beforeEach(function() {
    sent  = [];
    mails = [];
    react = null;
    stubs = [];

    stub(aws, 'getS3Client').callsFake(recorder);
    stub(mailer, 'send').callsFake(function(to, subject, options) {
      mails.push({ to : to, subject : subject, type : options.type, html : options.html });

      return Promise.resolve({ delivered : true });
    });

    record = new Export.model({ _owner : user._id });

    return record.save();
  });

  afterEach(function() {
    // Unconditional: a failed expectation must not leave the S3 client, the mailer or the Trinket model
    // stubbed for the suites that run afterwards.
    stubs.forEach(function(created) {
      created.restore();
    });

    stubs = [];
  });

  // ---------------------------------------------------------------------------------------------
  // What the module registers on the queue
  // ---------------------------------------------------------------------------------------------

  describe('queue registration', function() {
    it('registers one processor and the error, failed and completed listeners', function() {
      handle.should.be.a('function');
      Object.keys(queue.listeners).sort().should.eql(['completed', 'error', 'failed']);
      queue.listeners.error.length.should.eql(1);
      queue.listeners.failed.length.should.eql(1);
      queue.listeners.completed.length.should.eql(1);
    });

    it('rejects an unrecognised action by name, without touching S3 or the mailer', function() {
      return handle({ data : { action : 'not-an-action' } }).then(function() {
        throw new Error('expected the processor to reject an unknown action');
      }, function(err) {
        err.message.should.eql('Unknown action: not-an-action');
        sent.length.should.eql(0);
        mails.length.should.eql(0);
      });
    });

    it('logs a queue error without throwing', function() {
      queue.listeners.error[0](new Error('redis went away'));
    });

    it('removes a completed job', function() {
      var removed = 0;

      // bull 0.7.2's remove() took a callback and returned nothing; 4.16.5 returns a PROMISE, which the
      // listener now owns with a terminal catch (review finding F4). A stub that returns undefined would
      // be testing the retired signature, not this one.
      queue.listeners.completed[0]({
        remove : function() {
          removed++;

          return Promise.resolve();
        }
      });

      removed.should.eql(1);
    });

    it('owns a removal failure instead of leaving it unhandled', function() {
      // The listener is fire-and-forget on purpose - awaiting the removal would put the completion signal
      // behind a Redis round trip - so the rejection has nowhere to go but a terminal catch. Without one,
      // a dropped Redis connection is a process-fatal fault under Node 22's default rejection mode.
      var escaped   = [],
          listeners = process.listeners('unhandledRejection'),
          collect   = function(err) { escaped.push(err); };

      process.removeAllListeners('unhandledRejection');
      process.on('unhandledRejection', collect);

      queue.listeners.completed[0]({
        remove : function() {
          return Promise.reject(new Error('redis went away mid-removal'));
        }
      });

      return new Promise(function(resolve) {
        setTimeout(resolve, 50);
      }).then(function() {
        escaped.should.eql([]);
      }).finally(function() {
        process.removeListener('unhandledRejection', collect);
        listeners.forEach(function(listener) {
          process.on('unhandledRejection', listener);
        });
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The 'failed' listener - fire-and-forget, three-argument, and the empty-message fallback
  // ---------------------------------------------------------------------------------------------

  describe('the failed listener', function() {
    var updates = [];

    beforeEach(function() {
      updates = [];
      // The PUBLIC wrapper, deliberately: the listener calls it in its three-argument form, which is what
      // exercises the argument shifting in lib/models/model.js - a function in the options position
      // becomes the callback.
      stub(Export, 'findByIdAndUpdate').callsFake(function() {
        updates.push(Array.prototype.slice.call(arguments));
      });
    });

    it('persists the failure against the export it names, passing a callback in the third position',
      function() {
        queue.listeners.failed[0]({ id : 'J1', data : { exportId : 'E1' } }, new Error('boom'));

        updates.length.should.eql(1);
        updates[0].length.should.eql(3);
        updates[0][0].should.eql('E1');
        updates[0][1].should.eql({ status : 'failed', errorMessage : 'boom' });
        updates[0][2].should.be.a('function');
      });

    it('writes nothing when the job carries no exportId', function() {
      queue.listeners.failed[0]({ id : 'J2', data : {} }, new Error('boom'));

      updates.length.should.eql(0);
    });

    it('falls back to Unknown error when the error carries no message', function() {
      queue.listeners.failed[0]({ id : 'J3', data : { exportId : 'E3' } }, new Error(''));

      updates.length.should.eql(1);
      updates[0][1].errorMessage.should.eql('Unknown error');
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The two failure outcomes reachable under the SHIPPED configuration
  // ---------------------------------------------------------------------------------------------

  describe('failure outcomes', function() {
    it('fails on the removed Query#stream, persisting that message and emailing the user', function() {
      // PRESERVED QUIRK - docs/PRESERVED-QUIRKS.md section 3.24. `Query#stream` was removed in mongoose 5
      // and this repository is held inside 6.x, so createExportArchive throws here on the real query. No
      // stub: this is the outcome a real export takes today.
      return runJob().then(function() {
        throw new Error('expected the export to fail on the removed Query#stream');
      }, function(err) {
        err.should.be.an.instanceOf(TypeError);
        err.message.should.match(/\.stream is not a function$/);

        return Export.model.findById(record._id);
      }).then(function(stored) {
        stored.status.should.eql('failed');
        stored.errorMessage.should.match(/\.stream is not a function$/);
        // Nothing was uploaded, and the archive never existed.
        sent.length.should.eql(0);

        mails.length.should.eql(1);
        mails[0].to.should.eql(user.email);
        mails[0].subject.should.eql('Your Trinket Export Failed');
        mails[0].type.should.eql('export-failed');
        mails[0].html.should.contain('.stream is not a function');
      });
    });

    it('fails on the absent exports bucket, which the shipped configuration does not define', function() {
      // MEASURED: config/default.yaml declares userassets, snapshots, cdn, materials, useravatars,
      // appassets and vendorassets - but no `exports` bucket - so uploadToS3 reads `.name` of undefined.
      //
      // PRESERVED QUIRK, and the reason this test manages process listeners. This is the ONE path where
      // the upload fails before the archive's read stream has finished opening, and on it the base commit
      // races its own cleanup: processBulkExport's fire-and-forget `fs.unlink(tempFile, function () {})`
      // deletes the archive while that open is still in flight, so the open lands with ENOENT on a stream
      // nobody is listening to and the process takes an UNCAUGHT exception. Measured on the delivered tree
      // AND with the descriptor release removed - it surfaces either way, so it is the base commit's race
      // and not a product of the conversion. Attaching an 'error' listener to that stream would swallow an
      // uncaught exception the base commit produced, which R-4 forbids. It is therefore OBSERVED here
      // rather than suppressed: Mocha's own handler is detached for the duration so the escape is an
      // assertion rather than an aborted run, and restored unconditionally afterwards.
      should.not.exist(config.aws.buckets.exports);
      streaming([trinket({ shortCode : 'nb' })]);

      var escaped   = [],
          listeners = process.listeners('uncaughtException'),
          collect   = function(err) { escaped.push(err); };

      process.removeAllListeners('uncaughtException');
      process.on('uncaughtException', collect);

      return runJob().then(function() {
        throw new Error('expected the export to fail without an exports bucket');
      }, function(err) {
        err.should.be.an.instanceOf(TypeError);
        err.message.should.eql("Cannot read properties of undefined (reading 'name')");

        return Export.model.findById(record._id);
      }).then(function(stored) {
        stored.status.should.eql('failed');
        stored.errorMessage.should.eql("Cannot read properties of undefined (reading 'name')");
        mails.length.should.eql(1);
        mails[0].type.should.eql('export-failed');

        // Give the racing open time to land, then assert exactly what escaped.
        return new Promise(function(resolve) {
          setTimeout(resolve, 120);
        });
      }).then(function() {
        escaped.length.should.be.at.most(1);

        escaped.forEach(function(err) {
          err.code.should.eql('ENOENT');
          err.message.should.contain('trinket-export-');
          err.message.should.contain('.zip');
        });
      }).finally(function() {
        process.removeListener('uncaughtException', collect);
        listeners.forEach(function(listener) {
          process.on('uncaughtException', listener);
        });
      });
    });

    it('fails with User not found, and sends NO email, when the user has been deleted', function() {
      return runJob({ userId : new mongoose.Types.ObjectId().toString() }).then(function() {
        throw new Error('expected the export to fail for a missing user');
      }, function(err) {
        err.message.should.eql('User not found');

        return Export.model.findById(record._id);
      }).then(function(stored) {
        stored.status.should.eql('failed');
        stored.errorMessage.should.eql('User not found');
        // `user` is still undefined at the catch, so the failure email is skipped entirely.
        mails.length.should.eql(0);
      });
    });

    it('reports a failed status write rather than the original error, with no inner rescue', function() {
      var first = true;

      // The catch has deliberately no inner try/catch: if persisting the failure itself throws, THAT
      // error surfaces instead of the export's own.
      stub(Export.model, 'findByIdAndUpdate').callsFake(function() {
        if (first) {
          first = false;

          return Promise.resolve(record);
        }

        return Promise.reject(new Error('mongo unavailable'));
      });

      return runJob().then(function() {
        throw new Error('expected the export to reject');
      }, function(err) {
        err.message.should.eql('mongo unavailable');
        // The user is never told, because the failure email comes after the failed-status write.
        mails.length.should.eql(0);
      });
    });
  });

  // ---------------------------------------------------------------------------------------------
  // The success path: archive layout, S3 parameters, the record, the email and the cleanup
  // ---------------------------------------------------------------------------------------------

  describe('a completed export', function() {
    var EXPORTS_BUCKET = { name : 'exp-bucket', host : 'https://exports.example.com' };

    beforeEach(function() {
      // Injected for these tests only. `after` deletes the key again, restoring the shipped shape that
      // the failure test above asserts.
      config.aws.buckets.exports = EXPORTS_BUCKET;
    });

    after(function() {
      delete config.aws.buckets.exports;
    });

    it('lays the archive out as lang/foldername_shortcode/, with a manifest at the root', function() {
      streaming([
        trinket({
          shortCode : 'aaa',
          name      : 'My Trinket!',
          lang      : 'python',
          code      : 'print(1)',
          settings  : { a : 1 },
          assets    : [{ url : 'https://assets.example.com/x/pic.png', name : 'pic.png' }]
        }),
        trinket({
          shortCode : 'bbb',
          name      : null,
          lang      : 'html',
          code      : JSON.stringify([
            { name : 'index.html', content : '<p>hi</p>' },
            { name : 'main.js', content : 'x=1' }
          ])
        })
      ]);

      return runJob().then(function() {
        entryNames().should.eql([
          'html/bbb_bbb/index.html',
          'html/bbb_bbb/main.js',
          'html/bbb_bbb/metadata.json',
          'manifest.json',
          'python/My_Trinket_aaa/assets/pic.png',
          'python/My_Trinket_aaa/main.py',
          'python/My_Trinket_aaa/metadata.json'
        ]);

        archive().readAsText('python/My_Trinket_aaa/main.py').should.eql('print(1)');
        archive().readAsText('html/bbb_bbb/index.html').should.eql('<p>hi</p>');
        archive().readAsText('html/bbb_bbb/main.js').should.eql('x=1');
        // The asset bytes are the downloaded buffer, not a reference to it.
        Array.from(archive().readFile('python/My_Trinket_aaa/assets/pic.png')).should.eql([9, 8, 7]);
      });
    });

    it('writes per-trinket metadata carrying the public url built from lang and shortCode', function() {
      streaming([trinket({ shortCode : 'aaa', name : 'My Trinket!', lang : 'python', settings : { a : 1 } })]);

      return runJob().then(function() {
        var metadata = JSON.parse(archive().readAsText('python/My_Trinket_aaa/metadata.json'));

        Object.keys(metadata).sort()
          .should.eql(['created', 'lang', 'lastUpdated', 'name', 'settings', 'shortCode', 'url']);
        metadata.shortCode.should.eql('aaa');
        metadata.name.should.eql('My Trinket!');
        metadata.lang.should.eql('python');
        metadata.settings.should.eql({ a : 1 });
        metadata.created.should.eql('1970-01-01T00:00:00.000Z');
        metadata.url.should.eql(config.url + '/python/aaa');
      });
    });

    it('writes a manifest whose totals match the per-trinket outcomes', function() {
      streaming([trinket({ shortCode : 'm1' }), trinket({ shortCode : 'm2', name : 'two' })]);

      return runJob().then(function() {
        var manifest = JSON.parse(archive().readAsText('manifest.json'));

        Object.keys(manifest).sort()
          .should.eql(['exportedAt', 'failedTrinkets', 'totalTrinkets', 'trinkets']);
        manifest.totalTrinkets.should.eql(2);
        manifest.failedTrinkets.should.eql(0);
        manifest.trinkets.should.eql([
          { shortCode : 'm1', name : 'name', lang : 'python' },
          { shortCode : 'm2', name : 'two', lang : 'python' }
        ]);
        should.exist(new Date(manifest.exportedAt).getTime());
      });
    });

    it('uploads the archive with the sha1-derived key, zip content type and download disposition',
      function() {
        streaming([trinket({ shortCode : 'up' })]);

        return runJob().then(function() {
          var put = command('PutObjectCommand');

          Object.keys(put.input).sort().should.eql([
            'Body', 'Bucket', 'ContentDisposition', 'ContentLength', 'ContentType', 'Key'
          ]);
          put.input.Bucket.should.eql('exp-bucket');
          put.input.Key.should.match(
            new RegExp('^exports/' + user._id.toString() + '/trinket-export-[0-9a-f]{12}\\.zip$'));
          put.input.ContentType.should.eql('application/zip');
          put.input.ContentDisposition
            .should.eql('attachment; filename="' + put.input.Key.split('/').pop() + '"');
          // v3 cannot infer a length from an arbitrary Node stream, so the worker declares it.
          put.input.ContentLength.should.be.above(0);
          put.input.ContentLength.should.eql(put.archiveBytes.length);
          // Streamed from the temp file the archive was written to, under the same name as the key.
          put.input.Body.path.should.eql('/tmp/' + put.input.Key.split('/').pop());
        });
      });

    it('downloads each asset from the userassets bucket by its last path segment', function() {
      streaming([trinket({ shortCode : 'as', assets : [{ url : 'https://h/deep/path/pic.png' }] })]);

      return runJob().then(function() {
        var get = command('GetObjectCommand');

        get.input.should.eql({
          Bucket : config.aws.buckets.userassets.name,
          Key    : 'pic.png'
        });
      });
    });

    it('falls back to the raw string when an asset url has no parseable origin', function() {
      // URL.parse() returns null rather than throwing on the relative and protocol-less forms the legacy
      // parser tolerated, and the fallback reproduces the legacy result - the input itself.
      // See docs/PRESERVED-QUIRKS.md section 3.13.
      streaming([trinket({ shortCode : 'rel', assets : [{ url : 'bare-name.png' }] })]);

      return runJob().then(function() {
        command('GetObjectCommand').input.Key.should.eql('bare-name.png');
        entryNames().should.contain('python/name_rel/assets/bare-name.png');
      });
    });

    it('names an asset entry after its url when the asset carries no name', function() {
      streaming([trinket({ shortCode : 'an', assets : [{ url : 'https://h/a/named-by-url.png' }] })]);

      return runJob().then(function() {
        entryNames().should.contain('python/name_an/assets/named-by-url.png');
      });
    });

    it('skips an asset with no url without issuing a download', function() {
      streaming([trinket({ shortCode : 'nu', assets : [{ name : 'orphan.png' }] })]);

      return runJob().then(function() {
        sent.filter(function(candidate) {
          return candidate.constructor.name === 'GetObjectCommand';
        }).length.should.eql(0);
        entryNames().should.eql(['manifest.json', 'python/name_nu/main.py', 'python/name_nu/metadata.json']);
      });
    });

    it('keeps the trinket when an asset download fails, and does not count it as a failure', function() {
      react = function(issued) {
        return issued.constructor.name === 'GetObjectCommand' ? Promise.reject(new Error('NoSuchKey')) : null;
      };
      streaming([trinket({ shortCode : 'af', assets : [{ url : 'https://h/gone.png' }] })]);

      return runJob().then(function() {
        // The code file and metadata survive; only the asset is missing.
        entryNames().should.eql(['manifest.json', 'python/name_af/main.py', 'python/name_af/metadata.json']);
        JSON.parse(archive().readAsText('manifest.json')).failedTrinkets.should.eql(0);

        return Export.model.findById(record._id);
      }).then(function(stored) {
        stored.status.should.eql('completed');
        stored.progress.failed.should.eql(0);
      });
    });

    it('counts a trinket that cannot be archived and still completes the export', function() {
      // A self-referential settings object makes the metadata JSON.stringify throw, which is the one
      // failure addTrinketToArchive cannot absorb internally. The per-trinket catch counts it and
      // RESOLVES, which is what stops one bad trinket from failing the whole export.
      var broken = trinket({ shortCode : 'broken' });

      broken.settings = {};
      broken.settings.self = broken.settings;

      streaming([broken, trinket({ shortCode : 'fine' })]);

      return runJob().then(function() {
        entryNames()
          .should.eql(['manifest.json', 'python/name_fine/main.py', 'python/name_fine/metadata.json']);

        var manifest = JSON.parse(archive().readAsText('manifest.json'));

        manifest.totalTrinkets.should.eql(1);
        manifest.failedTrinkets.should.eql(1);

        return Export.model.findById(record._id);
      }).then(function(stored) {
        stored.status.should.eql('completed');
        stored.progress.processed.should.eql(1);
        stored.progress.failed.should.eql(1);
      });
    });

    it('completes the record with the download url, key, expiry and the archive size', function() {
      streaming([trinket({ shortCode : 'cp' })]);

      return runJob().then(function() {
        return Export.model.findById(record._id);
      }).then(function(stored) {
        var put = command('PutObjectCommand');

        stored.status.should.eql('completed');
        stored.s3Key.should.eql(put.input.Key);
        stored.downloadUrl.should.eql('https://exports.example.com/' + put.input.Key);
        stored.fileSize.should.eql(put.archiveBytes.length);
        // Three days out, per EXPORT_EXPIRY_DAYS.
        Math.round((stored.expiresAt.getTime() - Date.now()) / 86400000).should.eql(3);
      });
    });

    it('records the trinket count from the database, independently of what was archived', function() {
      // `progress.total` and `trinketCount` come from a count() against the collection, while
      // `progress.processed` comes from the stream - two independent sources, and this asserts both.
      stub(Trinket.model, 'count').returns(Promise.resolve(7));
      streaming([trinket({ shortCode : 'tc' })]);

      return runJob().then(function() {
        Trinket.model.count.calledOnce.should.eql(true);
        Trinket.model.count.firstCall.args.should.eql([{ _owner : user._id.toString() }]);

        return Export.model.findById(record._id);
      }).then(function(stored) {
        stored.trinketCount.should.eql(7);
        stored.progress.total.should.eql(7);
        stored.progress.processed.should.eql(1);
      });
    });

    it('emails the user the ready notification, with the size formatted for humans', function() {
      streaming([trinket({ shortCode : 'em' })]);

      return runJob().then(function() {
        mails.length.should.eql(1);
        mails[0].to.should.eql(user.email);
        mails[0].subject.should.eql('Your Trinket Export is Ready');
        mails[0].type.should.eql('export-ready');
        // formatFileSize is only observable through the rendered template.
        mails[0].html.should.match(/\d+(\.\d+)? (B|KB|MB)/);
        mails[0].html.should.contain(config.url + '/api/exports/' + record._id + '/download');
        mails[0].html.should.contain(user.fullname);
      });
    });

    it('removes the temporary archive after the job settles', function() {
      var fs = require('fs');

      streaming([trinket({ shortCode : 'cl' })]);

      return runJob().then(function() {
        var tempFile = command('PutObjectCommand').input.Body.path;

        // The unlink is deliberately not awaited, so it is allowed to still be in flight here; what must
        // hold is that it happens. See the note at the cleanup in processBulkExport.
        return new Promise(function(resolve) {
          setTimeout(resolve, 200);
        }).then(function() {
          fs.existsSync(tempFile).should.eql(false);
        });
      });
    });

    it('reports an archive failure rather than an upload, when the output stream cannot be opened',
      function() {
        streaming([trinket({ shortCode : 'ao' })]);

        var fs = require('fs'),
            real = fs.createWriteStream;

        // Restored in the same tick the archive is created, so nothing else in the process is affected.
        stubs.push({
          restore : function() {
            fs.createWriteStream = real;
          }
        });
        fs.createWriteStream = function() {
          return real('/tmp/no-such-directory-for-exports/archive.zip');
        };

        return runJob().then(function() {
          throw new Error('expected the export to fail when the archive cannot be written');
        }, function(err) {
          err.code.should.eql('ENOENT');
          sent.length.should.eql(0);
          mails[0].type.should.eql('export-failed');
        });
      });
  });

  // ---------------------------------------------------------------------------------------------
  // Code-file naming: the language table, its fallbacks and the folder sanitiser
  // ---------------------------------------------------------------------------------------------

  describe('code file naming and folder sanitising', function() {
    beforeEach(function() {
      config.aws.buckets.exports = { name : 'exp-bucket', host : 'https://exports.example.com' };
    });

    after(function() {
      delete config.aws.buckets.exports;
    });

    it('derives one main file per language, and falls back to .txt for an unknown one', function() {
      streaming([
        trinket({ shortCode : 'p', lang : 'python', code : 'x' }),
        trinket({ shortCode : 'j', lang : 'java', code : 'x' }),
        trinket({ shortCode : 'r', lang : 'R', code : 'x' }),
        trinket({ shortCode : 'h', lang : 'html', code : 'x' }),
        trinket({ shortCode : 'g', lang : 'glowscript', code : 'x' }),
        trinket({ shortCode : 'u', lang : 'nosuchlang', code : 'x' })
      ]);

      return runJob().then(function() {
        entryNames().should.eql([
          'R/name_r/main.R',
          'R/name_r/metadata.json',
          'glowscript/name_g/main.py',
          'glowscript/name_g/metadata.json',
          'html/name_h/main.html',
          'html/name_h/metadata.json',
          'java/name_j/main.java',
          'java/name_j/metadata.json',
          'manifest.json',
          'nosuchlang/name_u/main.txt',
          'nosuchlang/name_u/metadata.json',
          'python/name_p/main.py',
          'python/name_p/metadata.json'
        ]);
      });
    });

    it('names a blocks trinket main.xml, and files a language-less one under other/', function() {
      streaming([
        trinket({ shortCode : 'b', lang : 'blocks', code : 'not json' }),
        trinket({ shortCode : 'n', lang : null, code : 'x' })
      ]);

      return runJob().then(function() {
        entryNames().should.contain('blocks/name_b/main.xml');
        entryNames().should.contain('other/name_n/main.txt');
      });
    });

    it('treats JSON that is not an array as a single file, and an array as its named files', function() {
      streaming([
        trinket({ shortCode : 'o', lang : 'java', code : JSON.stringify({ not : 'an array' }) }),
        trinket({
          shortCode : 'a',
          lang      : 'R',
          code      : JSON.stringify([{ name : 'a.R', content : null }, { name : 'b.R', content : 'ok' }])
        })
      ]);

      return runJob().then(function() {
        entryNames().should.contain('java/name_o/main.java');
        // A null content becomes an empty entry rather than the string "null".
        archive().readAsText('R/name_a/a.R').should.eql('');
        archive().readAsText('R/name_a/b.R').should.eql('ok');
      });
    });

    it('strips punctuation, collapses whitespace and caps the folder name at fifty characters',
      function() {
        streaming([
          trinket({ shortCode : 's1', name : 'Weird ***Name!!!  spaced' }),
          trinket({ shortCode : 's2', name : new Array(61).join('x') }),
          trinket({ shortCode : 's3', name : '!!!!' })
        ]);

        return runJob().then(function() {
          var names = entryNames();

          names.should.contain('python/Weird_Name_spaced_s1/main.py');
          names.should.contain('python/' + new Array(51).join('x') + '_s2/main.py');
          // MEASURED QUIRK: the 'untitled' fallback only catches a falsy name, so a name made entirely of
          // stripped characters yields an EMPTY folder segment rather than 'untitled'.
          names.should.contain('python/_s3/main.py');
        });
      });

    it('falls back to the shortCode when a trinket has no name at all', function() {
      streaming([trinket({ shortCode : 'nameless', name : '' })]);

      return runJob().then(function() {
        entryNames().should.contain('python/nameless_nameless/main.py');
      });
    });
  });
});
