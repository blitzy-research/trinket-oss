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

# Download frontend components from GitHub release
RUN curl -L --silent -o ./public-components.tgz \
    https://github.com/trinketapp/trinket-oss/releases/download/v1.1.0/public-components.tgz \
    && tar xzf public-components.tgz \
    && rm public-components.tgz

RUN npm ci

ARG COMMIT_ID
ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV

EXPOSE 3000

CMD ["pm2-docker", "start", "app.js"]
