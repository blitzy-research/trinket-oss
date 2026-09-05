# Node 22 LTS artifact source, pinned by multi-arch INDEX digest. Copying the
# official image's own binaries out of this stage is what replaces the previous
# `curl -o- .../nvm/install.sh | bash`, which executed unverified network
# content as a shell script at build time with no checksum or signature.
# Refresh with `docker buildx imagetools inspect node:22-bookworm`.
FROM node:22-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d AS nodejs

# Base image pinned by multi-arch INDEX digest so the OS and R contents of a
# build are immutable; the bare tag floats. Refresh deliberately with
# `docker buildx imagetools inspect r-base:4.4.2` and record the value in
# docs/dependency-inventory.md.
FROM r-base:4.4.2@sha256:fe9b29520eeb5292d814b0958783c0ddfcdab37402967a3e67307604354f98d7

# Install build dependencies including those needed for R graphics packages
RUN apt-get update && apt-get install -y \
    build-essential curl procps apt-utils r-recommended \
    libfontconfig1-dev libfreetype6-dev libcairo2-dev \
    libharfbuzz-dev libfribidi-dev libpng-dev libjpeg-dev

RUN apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

COPY ./install.r /usr/local/bin/
COPY ./packages.txt /tmp/
RUN r /usr/local/bin/install.r $(cat /tmp/packages.txt | xargs)

# Node 22 comes from the pinned image above rather than from an installer
# script. It lands in /usr/local, which is already on this base's PATH
# (measured: /usr/local/sbin:/usr/local/bin:...), so no PATH edit is needed, and
# it is installed before `USER trinket` because writing /usr/local needs root.
# `node -v && npm -v` runs on the same layer deliberately: an incomplete copy
# fails the build here instead of at container start.
COPY --from=nodejs /usr/local/bin/node /usr/local/bin/node
COPY --from=nodejs /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node -v && npm -v

RUN useradd -m trinket
USER trinket
WORKDIR /home/trinket
ENV HOME /home/trinket

SHELL ["/bin/bash", "-c"]

RUN mkdir -p /tmp/sessions && chmod 777 /tmp/sessions
COPY ./trinket /home/trinket

# The locked graph, including pm2: this unit's package-lock.json pins pm2 5.4.3,
# the same exact patch scripts/pm2/package.json pins for the root image, so one
# pm2 version covers the whole delivery. `npm ci` installs the committed lock
# instead of re-resolving the graph on every build. The install output is no
# longer redirected to /dev/null either - an install nobody can read cannot be
# audited.
RUN npm ci --omit=dev

ENV R_DEFAULT_DEVICE png
ENV R_LIBS_USER /usr/local/lib/R/site-library

# pm2 writes its logs and pid state under PM2_HOME, which defaults to
# $HOME/.pm2. The hardened deployment runs this container with a read-only root
# filesystem, where that path is not writable: measured, pm2 exits immediately
# with `ENOENT: no such file or directory, mkdir '/home/trinket/.pm2/logs'`.
# Inside the tmpfs it starts cleanly under
# --read-only --tmpfs /tmp --cap-drop=ALL --security-opt=no-new-privileges.
ENV PM2_HOME=/tmp/pm2

EXPOSE 8010
# Absolute path into the locked dependency tree: pm2-runtime is no longer a
# global install on PATH.
CMD ["/home/trinket/node_modules/.bin/pm2-runtime", "start", "server.js"]
