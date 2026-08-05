# Use Node 22 LTS (matches .nvmrc and the package.json engines constraint).
# Pinned to an exact patch release rather than the floating `22-bookworm` tag: a
# floating tag lets both Node and its bundled npm move between image builds, which
# is the opposite of the reproducible toolchain this image exists to guarantee.
#
# This is a TWO-STAGE build, and the split exists for exactly one reason: the compiler
# toolchain below is needed to INSTALL, never to RUN. A single-stage image shipped
# `python3` and `build-essential` into production, which is toolchain the running
# container can only be harmed by (review finding SV-41). The builder hydrates the
# component tree, installs, and compiles the stylesheets; the runtime stage further
# down copies the finished tree and carries no compiler at all. Both stages pin the
# SAME base digest-bearing tag, so the Node that builds is the Node that runs.
FROM node:22.23.2-bookworm AS builder

SHELL ["/bin/bash", "-c"]

# Install build dependencies.
#
# `node-gyp` needs `python3` and a C++ toolchain to compile a native addon from source.
# Measured against this exact lockfile on linux-x64/glibc, NOTHING in the tree actually
# reaches that path: `bcrypt@6.0.0` is the only native dependency, its install script is
# `node-gyp-build`, and that loader resolves to the prebuilt binary the package already
# ships (`bcrypt/prebuilds/linux-x64/bcrypt.glibc.node`) rather than compiling — after a
# full `npm ci` there is no `bcrypt/build` directory and no `binding.gyp` anywhere in
# `node_modules`. The toolchain is kept anyway, and kept HERE, because `node-gyp-build`
# falls back to compiling whenever no prebuild matches the target platform and libc; a
# build for an architecture bcrypt does not prebuild would otherwise fail outright.
# Confining it to the builder stage is what makes keeping it free.
#
# `rm -rf /var/lib/apt/lists/*` discards the package index in the same layer that
# created it. `apt-get autoclean` alone does not: it prunes the downloaded .deb cache
# and leaves the index behind, so the lists survived into the shipped image.
RUN apt-get update \
    && apt-get install -y python3 build-essential \
    && apt-get -y autoclean \
    && rm -rf /var/lib/apt/lists/*

# Pin the package manager to the exact npm release package.json names in
# `packageManager`, inside the bounded range its `engines` block declares
# (`npm >=10.0.0 <11.0.0`). node:22.23.2-bookworm bundles npm 10.9.8, which already
# satisfies the range; installing the exact release fixes it so the image cannot
# drift onto a different npm even if the base tag is ever re-pointed, and so the
# image, the committed lockfile and a developer checkout are all built by the same
# resolver. `.npmrc` sets engine-strict=true, which makes the bounded range an
# enforced gate rather than advice: an npm outside it fails `npm ci` with EBADENGINE
# instead of installing. That is deliberate — see .npmrc for how to switch a local
# toolchain onto the pinned release.
#
# Measured on Node 22.23.2: engine-strict is enforced by install operations only
# (`npm install`, `npm ci`), so `npm run build` and `npm test` still run under any npm.
# On a host whose default npm is 11, run the install step through the pinned release
# exactly as this image does - `npx -y npm@10.9.9 ci`. lockfileVersion 3 is readable by
# both npm 10 and npm 11; the pin exists so that only one of them ever writes it.
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
# The digest is the one COMPONENTS.md publishes for the v1.1.0 asset (166,464,007 bytes), and checking it
# before extraction is what makes this step deterministic rather than merely convenient: a truncated
# transfer, or an HTTP error page saved under the archive's name, would otherwise be extracted over the
# tree and the stylesheet build below would fail — or, worse, succeed against different bytes. The
# `--fail` and `--show-error` flags exist for the same reason: a bare `curl -L --silent` writes an error
# body into the output file and still exits 0. The URL and the `v1.1.0` tag are unchanged, and this step
# still runs before the install and the build, so `npm ci` cannot disturb the component tree.
#
# `public/._components` is the AppleDouble sidecar the macOS-packed archive carries beside the component
# tree. Nothing serves it, and it is removed here for the same reason COMPONENTS.md tells a host developer
# to remove it.
RUN curl --fail --show-error --location --silent -o ./public-components.tgz \
    https://github.com/trinketapp/trinket-oss/releases/download/v1.1.0/public-components.tgz \
    && echo '58422c0d0c7d25c1e6fdd1e014ff690f41c899257703e416e85a0fb0a926181f  public-components.tgz' \
       | sha256sum --check \
    && tar xzf public-components.tgz \
    && rm -f public-components.tgz public/._components

RUN npm ci

# Build the stylesheets INSIDE the image, and verify the two artifacts byte-for-byte.
#
# `public/css/base.css` and `public/css/embed.css` are gitignored, so `COPY . …` above cannot bring them in
# from a clean clone — and nothing else in the container workflow produced them, which meant a freshly built
# image served every page without any stylesheet. This is the one place the build belongs: the component
# tree it needs has just been hydrated, the devDependencies it needs (`sass`, `vite`) have just been
# installed by `npm ci`, and the result is baked into the image rather than depending on ignored host state.
# `docker-compose.yml` then publishes `public/css` through an initialized named volume so the root bind
# mount cannot hide it.
#
# The verification is not decoration. `sass` and `vite` are held at their exact versions precisely so this
# fork keeps compiling to these bytes, and the two digests are an asset-contract gate: they are read from
# `test/baseline/responses.json`'s `buildArtifacts` block rather than restated anywhere, so the image and the
# parity evidence cannot drift apart. A mismatch fails the build instead of shipping different CSS.
#
# The gate itself is `scripts/verify-css-artifacts.js`, which `package.json` runs as `npm run build`'s
# `postbuild` hook — so the single command below both builds and verifies. It used to be an inline
# `node -e` here and nowhere else, which meant the HOST build had no gate at all and the image carried the
# only copy; one implementation, reached identically from both, is what stops the two drifting apart
# (review finding P3-2). The hook also gates the `.css.map` count, which the inline copy did not.
RUN npm run build

# ---------------------------------------------------------------------------------------
# Runtime stage. Same pinned Node patch release as the builder, on the `-slim` variant.
#
# `-slim`, not the full tag the builder uses, and the difference is the whole point of the
# split. Measured on these exact images: `node:22.23.2-bookworm` SHIPS python3, gcc, g++,
# make, cc and curl in the base layer itself - `dpkg -l build-essential` reports nothing
# installed there, yet every one of those binaries is on PATH. So moving the explicit
# `apt-get install build-essential` into the builder, on its own, does NOT get the compilers
# out of the shipped image; it only removes the meta-package and the apt index. On
# `node:22.23.2-bookworm-slim` all six are absent. Verified end-to-end on this tree: all 38
# production dependencies require cleanly, bcrypt resolves its prebuilt binding and hashes
# and verifies correctly, the app boots ("Server started on port"), connects to Redis, and
# serves `GET /` as 200 `text/html; charset=utf-8`. Base image 1.13GB -> 227MB.
#
# The one thing slim removes that this file depended on is `curl`, which is why the
# HEALTHCHECK below probes with `node` instead - see the note there.
# ---------------------------------------------------------------------------------------
FROM node:22.23.2-bookworm-slim

SHELL ["/bin/bash", "-c"]

# The same exact npm release the builder pins, for the reasons documented against that
# stage's pin above. Nothing in this stage installs from the registry, so the pin is here
# only so that an operator who runs npm inside a shipped container gets the same resolver
# that wrote the committed lockfile rather than whichever npm the base tag happens to
# bundle. `python3` and `build-essential` are deliberately NOT reinstalled.
RUN npm install -g npm@10.9.9

# Install global tools.
#
# Pinned to an exact release for the same reproducibility reason as the npm pin, and set
# to the version `pm2@5` already resolved to, so the image supervisor does not change:
# `pm2`'s `latest` dist-tag is a 7.x, and `5` is a floating major that silently advances
# across the 5.x line between builds. 5.4.3 is the newest 5.x, which is what `pm2@5`
# selected at the time this pin was taken — the pin removes the drift without moving the
# version (review finding SV-41).
RUN npm install -g pm2@5.4.3

RUN groupadd -r trinket && \
    useradd -r -g trinket -m -c "trinket user" trinket

RUN mkdir -p /usr/local/node/trinket && chown trinket:trinket /usr/local/node/trinket

USER trinket

# One copy carries the whole finished tree: the application source, the `npm ci` output
# including the resolved native prebuild, the hydrated `public/components`, and the two
# verified stylesheets in `public/css`. Copying the built tree rather than rebuilding is
# the point of the split — the artifacts arrive already gated by the digest checks the
# builder ran, and nothing here can produce different bytes.
COPY --from=builder --chown=trinket:trinket /usr/local/node/trinket /usr/local/node/trinket

WORKDIR /usr/local/node/trinket

ARG COMMIT_ID
ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV

EXPOSE 3000

# Liveness probe against an EXISTING route. `GET /` is the cheapest 200 the application
# serves unauthenticated, and `test/baseline/responses.json` records it at 200 with
# `text/html; charset=utf-8` in the committed corpus, so this asserts published behavior
# rather than an assumption. No health endpoint is added: the route table is frozen at 233
# rows and adding one would break that contract (AAP §0.9.5, TR1).
#
# Probed with `node`, not `curl`. The `-slim` base carries no curl - confirmed absent on
# this exact image - and a HEALTHCHECK whose binary is missing reports the container
# unhealthy forever while telling you nothing about the app. `node` is the one interpreter
# guaranteed to be present, so the probe has no dependency that can go missing. It exits 0
# only for a 2xx/3xx status and exits 1 on any other status or on a connection error; this
# exact one-liner was run inside the built slim image against the live server and returned
# `status=200 ct=text/html; charset=utf-8`, exit 0.
#
# `--start-period` covers first boot, during which the process connects to MongoDB and
# registers all 233 routes before it listens; failures inside that window do not count
# against `--retries`.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:3000/', function (r) { \
          process.exit(r.statusCode >= 200 && r.statusCode < 400 ? 0 : 1); \
        }).on('error', function () { process.exit(1); })"

CMD ["pm2-docker", "start", "app.js"]
