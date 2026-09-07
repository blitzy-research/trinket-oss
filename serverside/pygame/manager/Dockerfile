# Node 22 LTS pinned by digest. The tag alone floats, so two builds a week
# apart can carry different OS and Node contents; this is the multi-arch INDEX
# digest of node:22-slim, so multi-platform builds still resolve while the
# contents stay immutable. Measured: node v22.23.2, npm 10.9.8.
# Refreshing it is a deliberate edit: resolve the new value with
# `docker buildx imagetools inspect node:22-slim` and record it in
# docs/dependency-inventory.md.
FROM node:22-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5

WORKDIR /app

# The manager is a network-facing Node process that performs no privileged
# operation, so it runs as the image's own unprivileged `node` user (uid 1000)
# instead of root. Both writable paths it needs are created and chowned here:
# /app, and /tmp/pygame-generated from config/default.json `manager.genDir`.
# The chown of the generated directory is load-bearing beyond this image -
# serverside/docker-compose.yml mounts a named volume over it, and Docker seeds
# a fresh volume's ownership from the image directory underneath, so without it
# the volume would come up root-owned and unwritable for uid 1000.
#
# tini is installed in this same layer because apt needs root and `USER node`
# is set immediately below; why the image needs it is at the ENTRYPOINT. The
# apt lists are removed in the same layer so they are not carried in the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /tmp/pygame-generated \
    && chown -R node:node /app /tmp/pygame-generated

USER node

# Copy package files
COPY --chown=node:node package*.json ./

# Install dependencies
RUN npm ci --omit=dev

# Copy application code
COPY --chown=node:node manager.js ./
COPY --chown=node:node config/ ./config/

# Environment
#
# NODE_ENV=production stays: config/production.json is what supplies the
# container-side workerUrl, genUrl and vncPath this image needs, and its
# `corsOrigins: true` is the value manager.js hands to Socket.IO, unchanged from
# the base commit. An operator that wants an explicit allowlist instead sets
# CORS_ORIGINS, which config/custom-environment-variables.json already maps onto
# `manager.corsOrigins`; this image does not set it, because doing so would
# change the unit's behaviour and serverside/** is in scope for runtime pinning
# only.
ENV NODE_ENV=production
ENV NODE_CONFIG_DIR=/app/config

# Expose port
EXPOSE 8100

# PID 1 is exempt from the kernel's default signal actions: a signal whose
# handler is not installed is discarded instead of terminating the process, and
# manager.js installs none. With `node manager.js` as PID 1 the SIGTERM from
# `docker stop` was therefore ignored, the full 10 s grace elapsed and the
# daemon SIGKILLed the container - measured here 10243 ms, exit 137, with
# /proc/1/status SigCgt ending 4602 (SIGTERM uncaught). tini as PID 1 forwards
# the signal to the node child, which is not PID 1 and so terminates on the
# kernel default - measured 232 ms, exit 143. One tini version covers all four
# manager units: 0.19.0 - debian tini 0.19.0-1+b3 at /usr/bin/tini here,
# alpine tini 0.19.0-r3 at /sbin/tini in the java, python and r units.
#
# This is in the image rather than `init: true` in
# serverside/docker-compose.yml because the reported reproduction is a plain
# `docker run` + `docker stop`, which serverside/README.md documents and which
# a compose-only flag would still fail, and because the image is what a
# non-compose deployment ships. Layering `--init`/`init: true` on top stays
# harmless: Docker's init becomes PID 1, tini runs as its child, and the signal
# is forwarded through both.
#
# CMD is left as it is, so `docker run <image> <other command>` and any compose
# `command:` override continue to work - tini execs whatever it is given.
ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "manager.js"]
