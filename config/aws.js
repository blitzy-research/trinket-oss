/**
 * AWS S3 access for the application. Region and credentials belong to each client
 * instance, so this module exports a configured client factory plus the command
 * classes the application uses rather than an SDK namespace.
 *
 *   getS3Client()                           the one shared configured S3Client
 *   destroyS3Client()                       releases its sockets at shutdown
 *   GetObjectCommand                        read
 *   PutObjectCommand                        write
 *   DeleteObjectCommand                     delete
 *   getSignedDownloadUrl(params, expiresIn) Promise<string>
 *
 * Commands are issued as `await client.send(new XCommand(params))`; there is no
 * callback form.
 *
 * Two caller-facing constraints:
 *
 *   - A GetObject response.Body is a Node Readable, not a Buffer, and it can be
 *     consumed only once. Pipe it directly, or convert with
 *     Buffer.from(await response.Body.transformToByteArray()) where bytes are
 *     needed.
 *   - Presigning is asynchronous, so getSignedDownloadUrl returns a Promise that
 *     the caller must await; using it as a string yields a broken URL.
 *
 * Errors carry $metadata.httpStatusCode and name rather than code / statusCode, so
 * a caller that branches on an error must still return the status it returns today.
 *
 * Presigning is delegated to @aws-sdk/s3-request-presigner, the AWS-supported package
 * for it; no signing is implemented in this repository. The presigner emits two signed
 * operation-metadata query parameters - x-amz-checksum-mode and x-id - that neither
 * aws-sdk v2 nor a hand-rolled signer sent, and they cannot be stripped without
 * invalidating the URL. Origin, path encoding and X-Amz-Expires are unchanged. See
 * docs/PRESERVED-QUIRKS.md and docs/MIGRATION-DEPENDENCY-INVENTORY.md.
 */

var awsS3      = require('@aws-sdk/client-s3')
    , presigner = require('@aws-sdk/s3-request-presigner')
    , config   = require('config');

// Resolved once at require time, so every client below shares one snapshot of the
// configuration.
var s3ClientConfig = {
  region : config.aws.region
};

// Static credentials are installed only when both values are truthy. They ship
// empty, so the default provider chain - environment, shared profile, instance role
// - is the normal path; handing the SDK an explicitly empty credentials object
// would disable that chain instead. region is passed unconditionally for the
// mirror-image reason: omitting it would let the chain resolve one of its own.
if (config.aws.keyId && config.aws.key) {
  s3ClientConfig.credentials = {
    accessKeyId       : config.aws.keyId
    , secretAccessKey : config.aws.key
  };
}

// The one client this process uses, reproducing v2's single process-global socket pool.
// Held in module scope rather than created per call because each S3Client owns its own
// pool, and a per-call client would leave one behind on every request.
var sharedS3Client = null;

function getS3Client() {
  if (!sharedS3Client) {
    sharedS3Client = new awsS3.S3Client(s3ClientConfig);
  }

  return sharedS3Client;
}

// Releases the shared client's sockets. Wired to the hapi server's 'stop' event in
// app.js, which is the only shutdown signal this application has.
//
// The slot is cleared BEFORE destroy(), so this is safe to call twice and safe to call
// when no client was ever built.
function destroyS3Client() {
  if (!sharedS3Client) {
    return;
  }

  var client = sharedS3Client;
  sharedS3Client = null;
  client.destroy();
}

/**
 * Presigned GET URL for an object. `params` takes the same { Bucket, Key } shape v2
 * accepted; `expiresIn` is the lifetime in seconds that v2 spelled Expires.
 *
 * Signed by @aws-sdk/s3-request-presigner, which resolves the client's own endpoint
 * and credentials, so bucket addressing follows the SDK's rules rather than a local
 * guess: a DNS-compatible bucket yields
 * https://<bucket>.s3.<region>.amazonaws.com/<key> and a name that is not - one
 * containing dots, for instance - falls back to path style
 * https://s3.<region>.amazonaws.com/<bucket>/<key>. Object-key encoding is the
 * SDK's, which is the AWS canonical form: a space becomes %20 rather than +, and
 * the five characters encodeURIComponent leaves untouched (! ' ( ) *) are escaped.
 *
 * Signed with the SHARED client rather than a throwaway one. Presigning performs no
 * network I/O, so a per-call client would exist only to carry region and credentials
 * and would leave its socket pool behind on every signed download.
 *
 * expiresIn is the ONLY option passed: X-Amz-Content-Sha256=UNSIGNED-PAYLOAD and
 * X-Amz-SignedHeaders=host, the two properties an S3 presigned GET must carry, are
 * already the presigner's defaults for this command.
 *
 * @param   {Object} params    { Bucket, Key }.
 * @param   {Number} expiresIn Lifetime in seconds.
 * @returns {Promise<String>}  The absolute signed URL.
 */
function getSignedDownloadUrl(params, expiresIn) {
  var command = new awsS3.GetObjectCommand({
    Bucket   : params.Bucket
    , Key    : params.Key
  });

  return presigner.getSignedUrl(getS3Client(), command, {
    expiresIn : expiresIn
  });
}

module.exports = {
  getS3Client            : getS3Client
  , destroyS3Client      : destroyS3Client
  , getSignedDownloadUrl : getSignedDownloadUrl
  , GetObjectCommand     : awsS3.GetObjectCommand
  , PutObjectCommand     : awsS3.PutObjectCommand
  , DeleteObjectCommand  : awsS3.DeleteObjectCommand
};
