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
 * Presigning is delegated to @aws-sdk/s3-request-presigner - the AWS-supported
 * package for it - and no signing is implemented in this repository (review finding
 * SV-05, CWE-327). An earlier revision hand-rolled the presigned URL from the
 * client's own resolved configuration, reaching three members the shipped type
 * definitions mark `@internal`: `client.config.endpointProvider()`,
 * `client.config.signer()` and `signer.presign()`. That was measured
 * signature-identical to an independent SigV4 reference at the time, which is
 * exactly the problem: an `@internal` member carries no semver signal, so it can
 * change in a patch release with nothing to notice it. The installed client already
 * embeds `version = "3.1097.0"` while resolving as 3.1098.0, which is the shape that
 * drift takes.
 *
 * ONE OBSERVABLE CONSEQUENCE, recorded deliberately rather than hidden, and measured
 * rather than estimated. The official presigner adds TWO operation-metadata
 * parameters the hand-rolled form omitted - `x-amz-checksum-mode=ENABLED` and
 * `x-id=GetObject` - taking the query from 7 parameters to 9, and it signs them, so
 * the digest differs too. Diffing the two parameter sets for the same call gives
 * added = [x-amz-checksum-mode, x-id] and removed = [], so nothing a caller reads
 * disappeared: origin, path encoding and X-Amz-Expires are unchanged. Neither
 * aws-sdk v2 nor the hand-rolled form sent either parameter. Because both are signed
 * rather than appended, they cannot be stripped from a generated URL without
 * invalidating it, and there is no option to suppress them. The URL is not part of
 * the R-6 parity corpus - the asset feature is flag-disabled in the shipped
 * configuration and `GET /api/users/assets` is the corpus's single baseline 500 - so
 * nothing replays differently; the change is catalogued in
 * docs/PRESERVED-QUIRKS.md and in the migration dependency inventory alongside the
 * SignatureV2 -> SignatureV4 move the SDK replacement already forced.
 *
 * This is the third and last package the modernization adds to the manifest, beside
 * @aws-sdk/client-s3 and crypto-js. The Technical Specification projected two; the
 * deviation is reconciled in docs/MIGRATION-DEPENDENCY-INVENTORY.md exactly as the
 * `chokidar` and `brace-expansion` deviations already are.
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

// The one client this process uses, reproducing v2's single process-global socket
// pool. Held in module scope rather than created per call - see RESOURCE LIFECYCLE
// above for the measurement that decided it.
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
// The slot is cleared BEFORE destroy() so this is safe to call twice and safe to
// call when nothing was ever built; both were measured against the installed SDK,
// where destroy() itself is also idempotent.
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
 * expiresIn is the ONLY option passed. X-Amz-Content-Sha256=UNSIGNED-PAYLOAD and
 * X-Amz-SignedHeaders=host - the two properties an S3 presigned GET must carry - are
 * already the presigner's defaults for this command, so nothing is configured to
 * obtain them. An earlier revision also passed `signableHeaders: new Set(['host'])`
 * and `unhoistableHeaders: new Set()`; both were measured INERT and removed. Under a
 * fixed signingDate, with and without them, the emitted URL is byte-identical -
 * same nine query parameters and the same X-Amz-Signature digest - across three key
 * shapes (a space, the five extended-encoding characters, and a plain key). Passing
 * options that change nothing would imply the defaults are unsuitable.
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
