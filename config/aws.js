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
 * Presigning is implemented here on top of @aws-sdk/client-s3 alone, with no
 * presigner package: the client's own resolved configuration publishes everything a
 * signed GET needs - config.endpointProvider() applies the SDK's bucket-addressing
 * rules and config.signer() resolves the same SignatureV4 instance
 * @aws-sdk/s3-request-presigner would have used. Measured over keys containing
 * spaces and the characters + ( ) ! ' * and over both virtual-hosted and (dotted
 * bucket) path-style addressing: the endpoint, the AWS-encoded object path and every
 * signed query parameter match that package exactly, and each signature matches an
 * independent from-scratch SigV4 computation over the same canonical request. The
 * package's own URLs additionally carry x-id=GetObject and
 * x-amz-checksum-mode=ENABLED - operation metadata that aws-sdk v2 never sent, and
 * the only reason its signature digest differs from this one. That is what licenses
 * dropping it: @aws-sdk/client-s3 and crypto-js are the only two packages this
 * modernization adds to the manifest.
 */

var awsS3      = require('@aws-sdk/client-s3')
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

// AWS URI-encoding for one path or query component. AWS canonical requests leave
// only the RFC 3986 unreserved set (A-Z a-z 0-9 - _ . ~) unescaped, while
// encodeURIComponent also passes ! ' ( ) * through untouched, so those five are
// finished by hand. Getting this wrong does not fail loudly - it produces a
// syntactically valid URL whose signature S3 rejects.
function encodeUriComponentForAws(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, function (character) {
    return '%' + character.charCodeAt(0).toString(16).toUpperCase();
  });
}

// Serialize a signed request back into an absolute URL. Query names and values
// are AWS-URI-encoded (X-Amz-Credential contains slashes, which must appear as
// %2F) and emitted in sorted order so the same inputs always yield the same URL.
function formatSignedUrl(signedRequest) {
  var authority = signedRequest.hostname + (signedRequest.port ? ':' + signedRequest.port : '')
      , query   = signedRequest.query || {}
      , pairs   = Object.keys(query).sort().map(function (name) {
        return encodeUriComponentForAws(name) + '=' + encodeUriComponentForAws(query[name]);
      });

  return signedRequest.protocol + '//' + authority + signedRequest.path + '?' + pairs.join('&');
}

// Presigned GET URL for an object. params takes the same { Bucket, Key } shape
// v2 accepted; expiresIn is the lifetime in seconds that v2 spelled Expires.
//
// The request is assembled from the client's own resolved configuration so that
// bucket addressing follows the SDK's rules rather than a local guess:
// endpointProvider yields https://<bucket>.s3.<region>.amazonaws.com for a
// DNS-compatible bucket and falls back to path-style
// https://s3.<region>.amazonaws.com/<bucket> for one that is not (a bucket name
// containing dots, for instance). The flags below are the SDK's own defaults for
// this application, which configures none of the corresponding S3 client options.
//
// X-Amz-Content-Sha256 is sent as a header and hoisted into the query by the
// signer, which is how every S3 presigned GET declares an unsigned payload. The
// SDK's presigner package additionally appends x-id=GetObject and
// x-amz-checksum-mode=ENABLED, which are operation metadata rather than part of
// the signed-download contract - aws-sdk v2 never sent either - so they are
// deliberately not reproduced here.
//
// Signed with the shared client rather than a throwaway one. Presigning performs no
// network I/O, so a per-call client existed only to carry region and credentials and
// left its socket pool behind on every signed download. Every signed parameter is
// unchanged: the same Bucket and Key, and the same expiresIn, so the URL still
// carries X-Amz-Expires with the caller's value.
async function getSignedDownloadUrl(params, expiresIn) {
  var client     = getS3Client()
      , region   = await client.config.region()
      , endpoint = client.config.endpointProvider({
        Bucket                          : params.Bucket
        , Region                        : region
        , UseFIPS                       : false
        , UseDualStack                  : false
        , ForcePathStyle                : false
        , Accelerate                    : false
        , UseGlobalEndpoint             : false
        , DisableMultiRegionAccessPoints: false
      }).url
      , signer   = await client.config.signer();

  // endpoint.pathname is '/' for virtual-hosted addressing and '/<bucket>' for
  // path-style, so the trailing slash is trimmed before the key is appended.
  var objectPath = endpoint.pathname.replace(/\/+$/, '')
      + '/' + params.Key.split('/').map(encodeUriComponentForAws).join('/');

  var signedRequest = await signer.presign({
    method       : 'GET'
    , protocol   : endpoint.protocol
    , hostname   : endpoint.hostname
    , port       : endpoint.port ? Number(endpoint.port) : undefined
    , path       : objectPath
    , query      : {}
    , headers    : {
      host                   : endpoint.hostname
      , 'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD'
    }
  }, { expiresIn : expiresIn });

  return formatSignedUrl(signedRequest);
}

module.exports = {
  getS3Client            : getS3Client
  , destroyS3Client      : destroyS3Client
  , getSignedDownloadUrl : getSignedDownloadUrl
  , GetObjectCommand     : awsS3.GetObjectCommand
  , PutObjectCommand     : awsS3.PutObjectCommand
  , DeleteObjectCommand  : awsS3.DeleteObjectCommand
};
