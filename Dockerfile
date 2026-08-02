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

# Pin the package manager to an exact npm release inside the range package.json
# `engines` declares (`npm >=10.0.0`, with no upper bound). node:22.23.2-bookworm
# bundles npm 10.9.8, which already satisfies it; installing the exact release fixes
# it so the image cannot drift onto a different npm even if the base tag is ever
# re-pointed. The constraint is deliberately unbounded above, because `.npmrc` sets
# engine-strict=true and an upper bound would make every npm command — `npm ci`
# included — fail outright wherever npm 11 is the shipped default. lockfileVersion 3
# installs identically under npm 10 and npm 11, measured both ways.
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
