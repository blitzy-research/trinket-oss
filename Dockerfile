# Node 22 LTS, matching .nvmrc and the package.json engines constraint. Pinned to an exact patch
# release rather than a floating tag so that Node and its bundled npm cannot move between builds.
#
# Two stages: the compiler toolchain below is needed to INSTALL, never to RUN. The builder hydrates the
# component tree, installs, and compiles the stylesheets; the runtime stage copies the finished tree and
# carries no compiler. Both stages pin the same base tag, so the Node that builds is the Node that runs.
FROM node:22.23.2-bookworm AS builder

SHELL ["/bin/bash", "-c"]

# Install build dependencies.
#
# `node-gyp` needs `python3` and a C++ toolchain to compile a native addon from source. Nothing in this
# lockfile reaches that path on linux-x64/glibc — `bcrypt` is the only native dependency and its loader
# resolves the prebuilt binding — but `node-gyp-build` falls back to compiling whenever no prebuild
# matches the target platform and libc, so the toolchain stays for architectures bcrypt does not
# prebuild. Confining it to the builder stage is what makes keeping it free.
#
# `rm -rf /var/lib/apt/lists/*` discards the package index in the layer that created it; `autoclean`
# alone prunes only the downloaded .deb cache and would leave the index in the image.
RUN apt-get update \
    && apt-get install -y python3 build-essential \
    && apt-get -y autoclean \
    && rm -rf /var/lib/apt/lists/*

# Pin the package manager to the exact npm release package.json names in `packageManager`, inside the
# bounded range its `engines` block declares (`npm >=10.0.0 <11.0.0`), so the image, the committed
# lockfile and a developer checkout are all written by the same resolver. `.npmrc` sets
# engine-strict=true, which makes that range an enforced gate: an npm outside it fails `npm ci` with
# EBADENGINE. Only install operations are gated, so `npm run build` and `npm test` run under any npm.
RUN npm install -g npm@10.9.9

# pm2 is NOT installed here. It is a process supervisor used only by the runtime stage's
# CMD, so installing it in the builder would ship nothing and cost a layer.

RUN groupadd -r trinket && \
    useradd -r -g trinket -m -c "trinket user" trinket

RUN mkdir -p /usr/local/node/trinket && chown trinket:trinket /usr/local/node/trinket

USER trinket

COPY --chown=trinket:trinket . /usr/local/node/trinket

WORKDIR /usr/local/node/trinket

# Download frontend components from GitHub release, VERIFY the archive, then unpack it.
#
# The digest is the one COMPONENTS.md publishes for the v1.1.0 asset, and checking it before extraction
# is what makes this step deterministic: a truncated transfer or an HTTP error page saved under the
# archive's name would otherwise be extracted over the tree. `--fail` and `--show-error` exist for the
# same reason — a bare `curl -L --silent` writes an error body into the output file and still exits 0.
# This step runs before the install and the build, so `npm ci` cannot disturb the component tree.
#
# `public/._components` is the AppleDouble sidecar the macOS-packed archive carries beside the component
# tree. Nothing serves it, and it is removed here as COMPONENTS.md instructs a host developer to.
RUN curl --fail --show-error --location --silent -o ./public-components.tgz \
    https://github.com/trinketapp/trinket-oss/releases/download/v1.1.0/public-components.tgz \
    && echo '58422c0d0c7d25c1e6fdd1e014ff690f41c899257703e416e85a0fb0a926181f  public-components.tgz' \
       | sha256sum --check \
    && tar xzf public-components.tgz \
    && rm -f public-components.tgz public/._components

RUN npm ci

# Build the stylesheets INSIDE the image, and verify the two artifacts byte-for-byte.
#
# `public/css/base.css` and `public/css/embed.css` are gitignored, so `COPY . …` above cannot bring them
# in from a clean clone. This is where the build belongs: the component tree it needs has just been
# hydrated, `sass` and `vite` have just been installed by `npm ci`, and the result is baked into the
# image rather than depending on ignored host state. `docker-compose.yml` then publishes `public/css`
# through an initialized named volume so the root bind mount cannot hide it.
#
# The verification is an asset-contract gate: the expected digests are read from
# `test/baseline/responses.json`'s `buildArtifacts` block rather than restated, so the image and the
# parity evidence cannot drift apart, and a mismatch fails the build instead of shipping different CSS.
# The gate is `scripts/verify-css-artifacts.js`, which package.json runs as `npm run build`'s `postbuild`
# hook, so the host build and the image build reach one implementation. It also gates the `.css.map`
# count.
RUN npm run build

# Runtime stage. Same pinned Node patch release as the builder, on the `-slim` variant.
#
# `-slim` is the point of the split: the full `bookworm` tag carries python3, gcc, g++, make, cc and curl
# in its own base layer, so moving `apt-get install build-essential` into the builder does not by itself
# keep compilers out of the shipped image. On `-slim` all six are absent. The one thing slim removes that
# this file depended on is `curl`, which is why the HEALTHCHECK below probes with `node`.
FROM node:22.23.2-bookworm-slim

SHELL ["/bin/bash", "-c"]

# The same exact npm release the builder pins. Nothing in this stage installs from the registry, so the
# pin is here only so that an operator running npm inside a shipped container gets the resolver that
# wrote the committed lockfile. `python3` and `build-essential` are deliberately NOT reinstalled.
RUN npm install -g npm@10.9.9

# Install global tools.
#
# Pinned to an exact release for the same reproducibility reason as the npm pin, and to the version
# `pm2@5` already resolved to, so the supervisor does not change: pm2's `latest` dist-tag is a 7.x and
# `5` floats across the 5.x line between builds.
RUN npm install -g pm2@5.4.3

RUN groupadd -r trinket && \
    useradd -r -g trinket -m -c "trinket user" trinket

RUN mkdir -p /usr/local/node/trinket && chown trinket:trinket /usr/local/node/trinket

USER trinket

# One copy carries the whole finished tree: the application source, the `npm ci` output including the
# resolved native prebuild, the hydrated `public/components`, and the two verified stylesheets in
# `public/css`. Copying the built tree rather than rebuilding means the artifacts arrive already gated by
# the digest checks the builder ran.
COPY --from=builder --chown=trinket:trinket /usr/local/node/trinket /usr/local/node/trinket

WORKDIR /usr/local/node/trinket

ARG COMMIT_ID
ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV

EXPOSE 3000

# Liveness probe against an EXISTING route. `GET /` is the cheapest unauthenticated 200 the application
# serves, and `test/baseline/responses.json` records it at 200 with `text/html; charset=utf-8`. No health
# endpoint is added, because the route table is frozen.
#
# Probed with `node`, not `curl`: the `-slim` base carries no curl, and a HEALTHCHECK whose binary is
# missing reports the container unhealthy forever. The probe exits 0 only for a 2xx/3xx status and exits
# 1 on any other status or on a connection error.
#
# `--start-period` covers first boot, during which the process connects to MongoDB and registers every
# route before it listens; failures inside that window do not count against `--retries`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3000/', function (r) { \
          process.exit(r.statusCode >= 200 && r.statusCode < 400 ? 0 : 1); \
        }).on('error', function () { process.exit(1); })"

CMD ["pm2-docker", "start", "app.js"]
