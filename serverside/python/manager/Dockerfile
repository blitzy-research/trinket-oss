# Node 22 LTS pinned by digest. The tag alone floats, so two builds a week
# apart can carry different OS and Node contents; this is the multi-arch INDEX
# digest of node:22-alpine, so multi-platform builds still resolve while the
# contents stay immutable. Measured: node v22.23.2, npm 10.9.8.
# Refreshing it is a deliberate edit: resolve the new value with
# `docker buildx imagetools inspect node:22-alpine` and record it in
# docs/dependency-inventory.md.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

WORKDIR /app

# The manager is a network-facing Node process that performs no privileged
# operation, so it runs as the image's own unprivileged `node` user (uid 1000)
# instead of root. Both writable paths it needs are created and chowned here:
# /app, and /tmp/python-generated from config/default.json `manager.generatedDir`.
# The chown of the generated directory is load-bearing beyond this image -
# serverside/docker-compose.yml mounts a named volume over it, and Docker seeds
# a fresh volume's ownership from the image directory underneath, so without it
# the volume would come up root-owned and unwritable for uid 1000.
#
# tini is installed in this same layer because apk needs root and `USER node`
# is set immediately below; why the image needs it is at the ENTRYPOINT.
RUN apk add --no-cache tini \
    && mkdir -p /tmp/python-generated \
    && chown -R node:node /app /tmp/python-generated

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

EXPOSE 8100

# PID 1 is exempt from the kernel's default signal actions: a signal whose
# handler is not installed is discarded instead of terminating the process, and
# manager.js installs none. With `node manager.js` as PID 1 the SIGTERM from
# `docker stop` was therefore ignored, the full 10 s grace elapsed and the
# daemon SIGKILLed the container - measured here 10284 ms, exit 137, with
# /proc/1/status SigCgt 0000000000004602 (SIGTERM uncaught). tini as PID 1
# forwards the signal to the node child, which is not PID 1 and so terminates
# on the kernel default - measured 391 ms, exit 143. One tini version covers
# all four manager units: 0.19.0 - alpine tini 0.19.0-r3 at /sbin/tini, debian
# tini 0.19.0-1+b3 at /usr/bin/tini in the pygame unit.
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
ENTRYPOINT ["/sbin/tini", "--"]

CMD ["node", "manager.js"]
