# Use Node 22 LTS (matches .nvmrc and the package.json engines constraint).
# Pinned to an exact patch release rather than the floating `22-bookworm` tag: a
# floating tag lets both Node and its bundled npm move between image builds, which
# is the opposite of the reproducible toolchain this image exists to guarantee.
FROM node:22.23.2-bookworm

SHELL ["/bin/bash", "-c"]

# Install build dependencies
RUN apt-get update \
    && apt-get install -y python3 build-essential \
    && apt-get -y autoclean

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

# Install global tools
RUN npm install -g pm2@5

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

ARG COMMIT_ID
ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV

EXPOSE 3000

CMD ["pm2-docker", "start", "app.js"]
