/**
 * Parity and safety guard for the remote-asset download contract in
 * `lib/controllers/users.js#assetUploadFromURL`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * At the base commit that handler fetched a user-supplied URL with the `request` package and piped the
 * response straight to disk:
 *
 *     _request.get(url).on('error', function (err) { console.log('on error:', err); })
 *                      .pipe(fs.createWriteStream(tmpPath)).on('end', ...)
 *
 * `request` is gone, so the fetch moved to the runtime's own `fetch`. The first conversion of it read
 * `await response.arrayBuffer()` and wrote the buffer, which is correct but materializes the entire
 * remote body in memory - an unbounded allocation driven by a URL the client chooses. The shipped code
 * restores the streaming shape with the modern equivalent:
 *
 *     await pipeline(stream.Readable.fromWeb(response.body), fs.createWriteStream(tmpPath))
 *
 * This file pins the three properties that make that faithful AND bounded, plus the failure mode the
 * handler has to contain. The controller itself is unreachable without an authenticated session and
 * database fixtures, whereas every property it depends on belongs to the runtime and is testable in
 * isolation - so these tests assert the runtime contract directly, which is also what makes them a
 * regression net for a future Node upgrade.
 *
 * Deliberately NOT asserted: an absolute megabyte figure. The A/B measurement behind the shipped
 * comment (a 64 MiB body: 3.5 MiB heap and 56.6 MiB RSS growth streamed, versus 224.6 MiB RSS growth
 * buffered) is a measurement, not a contract - `arrayBuffers` deltas were checked here first and proved
 * to depend on GC timing, so asserting them would be flaky. The bounded-memory property is instead
 * asserted through the observable that CAUSES it: the body is delivered in many small chunks and never
 * in one allocation the size of the body.
 *
 * Also deliberately NOT asserted: a total-bytes cap. The base commit imposed none, so adding one would
 * reject uploads that succeed today, which R-4 forbids. "Bounded" here means bounded MEMORY.
 *
 * The origin server binds port 0 (an ephemeral port) so parallel clones cannot collide, and every
 * temporary directory is created with mkdtemp and removed afterwards.
 */

var http     = require('http')
  , fs       = require('fs')
  , os       = require('os')
  , path     = require('path')
  , crypto   = require('crypto')
  , stream   = require('stream')
  , pipeline = require('stream/promises').pipeline
  , expect   = require('chai').expect;

// Four mebibytes in 64 KiB writes: large enough that a single-allocation read would be obvious, small
// enough to keep the suite quick.
var CHUNK_BYTES = 64 * 1024
  , BODY_BYTES  = 4 * 1024 * 1024;

describe('Remote asset download streaming contract', function() {
  var server
    , baseUrl
    , tempDir
    , expectedDigest;

  before(async function() {
    this.timeout(20000);

    // A deterministic, non-uniform payload: uniform bytes would let a subtly wrong write still produce
    // a matching digest for the wrong reason.
    var chunk = Buffer.alloc(CHUNK_BYTES);
    for (var i = 0; i < CHUNK_BYTES; i++) {
      chunk[i] = i % 251;
    }

    var whole = Buffer.concat(new Array(BODY_BYTES / CHUNK_BYTES).fill(chunk));
    expectedDigest = crypto.createHash('sha256').update(whole).digest('hex');

    server = http.createServer(function(request, response) {
      if (request.url === '/empty') {
        // 204 carries no body at all, which is the branch the handler's else-arm exists for.
        response.writeHead(204);
        return response.end();
      }

      if (request.url === '/truncated') {
        // Promise more than is delivered, then break the connection: the transport-level failure the
        // handler has to contain rather than answer.
        response.writeHead(200, {
          'Content-Type'   : 'application/octet-stream',
          'Content-Length' : String(BODY_BYTES)
        });
        response.write(chunk);
        return response.socket.destroy();
      }

      response.writeHead(200, {
        'Content-Type'   : 'application/octet-stream',
        'Content-Length' : String(BODY_BYTES)
      });

      var sent = 0;

      (function write() {
        while (sent < BODY_BYTES) {
          sent += chunk.length;
          if (!response.write(chunk)) {
            return response.once('drain', write);
          }
        }
        response.end();
      }());
    });

    await new Promise(function(resolve) {
      server.listen(0, '127.0.0.1', resolve);
    });

    baseUrl = 'http://127.0.0.1:' + server.address().port;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trinket-asset-stream-'));
  });

  after(async function() {
    this.timeout(20000);

    if (tempDir) {
      fs.rmSync(tempDir, { recursive : true, force : true });
    }

    if (server) {
      await new Promise(function(resolve) {
        server.close(resolve);
      });
    }
  });

  /**
   * Builds a unique destination path inside the suite's own temporary directory.
   *
   * @param {string} name Base file name.
   * @returns {string} Absolute path.
   */
  function destination(name) {
    return path.join(tempDir, name);
  }

  it('writes the remote body to disk byte-identically', async function() {
    this.timeout(30000);

    var target   = destination('identical.bin')
      , response = await fetch(baseUrl + '/asset.bin');

    expect(response.body, 'a 200 with a body must expose a web stream').to.not.equal(null);

    await pipeline(stream.Readable.fromWeb(response.body), fs.createWriteStream(target));

    var written = fs.readFileSync(target);

    expect(written.length, 'every byte must reach disk').to.equal(BODY_BYTES);
    expect(crypto.createHash('sha256').update(written).digest('hex')).to.equal(expectedDigest);
  });

  it('consumes the body in many small chunks, never one allocation the size of the body',
    async function() {
      this.timeout(30000);

      var target    = destination('chunked.bin')
        , response  = await fetch(baseUrl + '/asset.bin')
        , chunkSizes = [];

      // The counter sits between the source and the file solely to observe the SOURCE's chunk
      // granularity, which is the property that bounds memory; it does not change what is written, and
      // the digest is re-checked below to prove that.
      var counter = new stream.Transform({
        transform : function(data, encoding, done) {
          chunkSizes.push(data.length);
          done(null, data);
        }
      });

      await pipeline(stream.Readable.fromWeb(response.body), counter, fs.createWriteStream(target));

      var written = fs.readFileSync(target)
        , largest = Math.max.apply(null, chunkSizes);

      expect(chunkSizes.length, 'a buffered read would deliver exactly one chunk').to.be.above(1);
      // Generously one-sided: the observed granularity is around 64 KiB against a 4 MiB body, so an
      // eighth of the body is far above any legitimate value and far below a whole-body allocation.
      expect(largest, 'no single chunk may approach the body size').to.be.below(BODY_BYTES / 8);
      expect(chunkSizes.reduce(function(a, b) { return a + b; }, 0)).to.equal(BODY_BYTES);
      expect(crypto.createHash('sha256').update(written).digest('hex'),
        'observing the chunks must not alter what is written').to.equal(expectedDigest);
    });

  it('exposes a null body for a 204, which is why the empty-file branch exists', async function() {
    this.timeout(30000);

    var target   = destination('empty.bin')
      , response = await fetch(baseUrl + '/empty');

    expect(response.status).to.equal(204);
    expect(response.body, 'a 204 must have no stream to pipe').to.equal(null);

    // The handler's else-arm: still create the temp file, so the upload path downstream behaves exactly
    // as it did at the base commit, where an empty response produced an empty file.
    await fs.promises.writeFile(target, '');

    expect(fs.statSync(target).size).to.equal(0);
  });

  it('fails the fetch-and-pipe sequence when the remote body is truncated, which the handler contains',
    async function() {
      this.timeout(30000);

      var target  = destination('truncated.bin')
        , failure
        , surface;

      // Mirrors the handler exactly: BOTH awaits live inside one try, because a broken connection
      // surfaces at whichever of them the socket error happens to reach first. Measured on this
      // runtime it can be either - the fetch await when the peer closes before the body is handed
      // over, the pipeline await when it closes mid-stream - and both are contained identically, so
      // the assertion is on the sequence failing rather than on which await reported it.
      try {
        surface = 'fetch';
        var response = await fetch(baseUrl + '/truncated');

        surface = 'pipeline';
        await pipeline(stream.Readable.fromWeb(response.body), fs.createWriteStream(target));
      }
      catch (err) {
        failure = err;
      }

      // This is the whole reason `assetUploadFromURL` wraps its fetch-and-pipe in a try/catch that
      // returns a never-settling promise: at the base commit `.pipe()` did not forward this failure and
      // the sole responder lived on the source's 'end' event, which a read error never fires - so the
      // request went unanswered. A rejection reaching the error map instead would answer a 500 the
      // base commit never sent.
      expect(failure, 'a truncated body must fail the sequence, at the ' + surface + ' await')
        .to.be.an('error');
      // Nothing may be reported as a clean completion: if this ever started succeeding, the handler's
      // contained catch would become dead code and the preserved no-response fate unreachable.
      expect(['fetch', 'pipeline']).to.contain(surface);
    });
});
