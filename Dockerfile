# Use Node 22 LTS, pinned by digest.
#
# package.json "engines" and .nvmrc are deliberately major-bounded and floating
# (node >=22.0.0 <23.0.0), which is the right shape for an LTS line that keeps
# receiving security patches -- but it gives no reproducibility on its own. This
# digest is where that reproducibility lives: it names one immutable image
# rather than whatever the tag points at today. It is the multi-arch INDEX
# digest of node:22-bookworm, not a single platform's manifest digest, so
# multi-platform builds still resolve. Measured contents: node v22.23.2,
# npm 10.9.8 -- both inside the ranges asserted immediately below.
#
# Refreshing it is a deliberate edit, never an incidental one: resolve the new
# value with `docker buildx imagetools inspect node:22-bookworm`, re-run the
# assertion below, and record the value in docs/dependency-inventory.md.
#
# bookworm rather than alpine or slim: the apt-get layer below and the native
# builds npm ci performs (bcrypt, nodejieba, @parcel/watcher) need a full Debian
# toolchain and glibc.
FROM node:22-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d

SHELL ["/bin/bash", "-c"]

# Assert the base image satisfies package.json "engines" before anything else
# runs.
#
# The digest above pins the image, but the two ranges it has to satisfy live in
# a different file, so a digest refresh could quietly drift out of them. This
# turns that into a build failure at the first step, naming both versions,
# instead of a confusing npm resolution error or a runtime fault much later.
# Plain shell on the two version strings: this step precedes `npm ci` and even
# the COPY, so it can depend on nothing but the image itself. Comparing majors
# is exactly equivalent to the declared ranges, each of which spans one major
# (>=22.0.0 <23.0.0 and >=10.0.0 <11.0.0). The range literals in the messages
# are single-quoted inside the double-quoted strings so that the `>` and `<`
# they contain need no backslash escaping to stay clear of redirection.
#
# Both failure branches were exercised, not assumed: a build from node:20 exits
# 1 reporting "node v20.20.2 does not satisfy package.json '>=22.0.0 <23.0.0'",
# and one with npm 11 installed over the image's npm exits 1 reporting
# "npm v11.19.1 does not satisfy package.json '>=10.0.0 <11.0.0'".
RUN set -euo pipefail \
    && node_version="$(node -v)" \
    && npm_version="$(npm -v)" \
    && node_major="${node_version#v}" \
    && node_major="${node_major%%.*}" \
    && npm_major="${npm_version%%.*}" \
    && if [ "$node_major" != "22" ]; then \
         echo "engines: node ${node_version} does not satisfy package.json '>=22.0.0 <23.0.0'" >&2; \
         exit 1; \
       fi \
    && if [ "$npm_major" != "10" ]; then \
         echo "engines: npm v${npm_version} does not satisfy package.json '>=10.0.0 <11.0.0'" >&2; \
         exit 1; \
       fi \
    && echo "engines: node ${node_version}, npm v${npm_version} -- ok"

# Install build dependencies
RUN apt-get update \
    && apt-get install -y python3 build-essential \
    && apt-get -y autoclean

# Install global tools
#
# Pinned to an exact patch rather than the floating `pm2@5` range this replaces:
# the image is the one artifact that has to be byte-reproducible, and a process
# manager that drifts between two builds of the same commit is exactly the kind
# of difference that surfaces only in production. 5.4.3 is the current 5.x
# patch, and it still ships the `pm2-docker` executable the CMD at the end of
# this file invokes -- `pm2-docker` is the legacy name of what later became
# `pm2-runtime`, and 5.4.3 provides both. Any future bump must re-check that
# bin, because a missing one fails at container start rather than at build.
#
# This stays ahead of the USER switch below so the global install still runs as
# root and lands in /usr/local.
RUN npm install -g pm2@5.4.3

RUN groupadd -r trinket && \
    useradd -r -g trinket -m -c "trinket user" trinket

RUN mkdir -p /usr/local/node/trinket && chown trinket:trinket /usr/local/node/trinket

USER trinket

# The `.` here is not the checkout -- it is whatever `.dockerignore` admits, and
# that file is the definition of what enters this image. It is an allowlist:
# every top-level entry is excluded and the tracked ones are re-admitted, so a
# gitignored secret, a local dependency tree or any other host residue on the
# builder's disk cannot reach this layer, and a new untracked path defaults to
# staying out. A new tracked top-level entry, on the other hand, has to be added
# there before it will arrive here.
COPY --chown=trinket:trinket . /usr/local/node/trinket

WORKDIR /usr/local/node/trinket

# Download frontend components from GitHub release, SHA-256 verified before
# extraction.
#
# The host and this image now share one implementation, so the same pinned
# archive is fetched and checked the same way in both places; the inline
# `curl --silent | tar` this replaces verified nothing at all and would happily
# have extracted an error page. The script depends on Node built-ins and the
# system tar only -- deliberately, because at this point node_modules does not
# exist yet -- and it is idempotent, so a rebuild that already has the bundle
# does no network I/O. It runs as the unprivileged trinket user in the WORKDIR
# above and writes only inside it.
#
# Order is load-bearing: this must stay ahead of both steps below, because the
# install follows the host workflow and the CSS build imports the Foundation
# tree this publishes into public/components.
RUN node scripts/fetch-components.js

# Install from the lockfile. `npm ci` is exact and reproducible where the
# `npm install --legacy-peer-deps` it replaces was neither: the target lockfile
# resolves cleanly without that flag, and dropping it is what keeps the image's
# dependency tree identical to the one tested on the host. Dev dependencies are
# installed on purpose -- the CSS build below needs vite and sass.
RUN npm ci

# Build the CSS this application serves.
#
# public/css/base.css and public/css/embed.css are gitignored build outputs, so
# they exist in no checkout and were in no image: until this step the container
# fetched components and installed dependencies but shipped neither stylesheet,
# and every page rendered unstyled with /css/base.css answering 404.
#
# It has to come after `npm ci` (it needs vite and sass) and after the component
# fetch (static/scss/_settings.scss imports from public/components). `build:css`
# rather than `build`, because `build` chains fetch-components ahead of it and
# that has already run.
#
# Verified on a no-cache build of this file: the step reports
# `public/css/base.css 265.72 kB` and `public/css/embed.css 296.32 kB`, both
# files are in the image at 265727 and 296352 bytes, and a container started
# from it answers /css/base.css and /css/embed.css with 200 and
# `Content-Type: text/css`, byte-identical to a host `npm run build`. Note that
# `docker-compose up` bind-mounts the checkout over this directory, so what
# Compose serves comes from the host's public/css and not from these copies --
# GETTING_STARTED.md documents that difference and the command that resolves it.
RUN npm run build:css

ARG COMMIT_ID
ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV

EXPOSE 3000

CMD ["pm2-docker", "start", "app.js"]
