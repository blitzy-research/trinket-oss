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
RUN mkdir -p /tmp/python-generated \
    && chown -R node:node /app /tmp/python-generated

USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci

COPY --chown=node:node . .

EXPOSE 8100

CMD ["node", "manager.js"]
