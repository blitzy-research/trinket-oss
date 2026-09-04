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
RUN mkdir -p /tmp/pygame-generated \
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
# container-side workerUrl, genUrl and vncPath this image needs. What that file
# also carried was `corsOrigins: true`, which Socket.IO accepted as "any
# origin"; CORS_ORIGINS below overrides it with an explicit list, so the image
# cannot activate a wildcard even when run standalone. The value is the
# localhost set from config/default.json plus the nginx entry point in
# serverside/docker-compose.yml. A deployment on other hostnames overrides this
# variable; manager.js refuses to start on a wildcard or an empty list rather
# than falling back to one.
ENV NODE_ENV=production
ENV CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:8080
ENV NODE_CONFIG_DIR=/app/config

# Expose port
EXPOSE 8100

CMD ["node", "manager.js"]
