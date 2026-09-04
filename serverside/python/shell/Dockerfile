# FROM phusion/passenger-nodejs:2.0.1

# Node 22 LTS artifact source, pinned by multi-arch INDEX digest. Copying the
# official image's own binaries out of this stage is what replaces the previous
# `curl -o- .../nvm/install.sh | bash`, which executed unverified network
# content as a shell script at build time with no checksum or signature.
# Refresh with `docker buildx imagetools inspect node:22-bookworm`.
FROM node:22-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d AS nodejs

# Base image pinned by multi-arch INDEX digest so the OS and CPython contents of
# a build are immutable; the bare tag floats. Refresh deliberately with
# `docker buildx imagetools inspect python:3.10-bullseye` and record the value in
# docs/dependency-inventory.md.
FROM python:3.10-bullseye@sha256:65c6bdcca22db1a3468a0262ae05f38a0a718f51e9818cd09c12094aaae28a33

# ARG DEBIAN_FRONTEND=noninteractive

RUN apt clean && apt-get update -y
RUN apt install -y software-properties-common fontconfig locales-all build-essential

ENV LANG en_US.UTF-8
ENV LANGUAGE en_US:en
ENV LC_ALL en_US.UTF-8

RUN apt clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*
COPY ./requirements.txt /tmp/
RUN pip3 install -r /tmp/requirements.txt --ignore-installed
#COPY ./requirements-deps.txt /tmp/
#RUN pip3 install -r /tmp/requirements-deps.txt --ignore-installed
RUN bokeh sampledata

#RUN adduser trinket
WORKDIR /home/trinket
ENV HOME /home/trinket

# Node 22 comes from the pinned image above rather than from an installer
# script. It lands in /usr/local, which is already on this base's PATH
# (measured: /usr/local/bin:/usr/local/sbin:...), so no PATH edit is needed.
# `node -v && npm -v` runs on the same layer deliberately: an incomplete copy
# fails the build here instead of at container start.
COPY --from=nodejs /usr/local/bin/node /usr/local/bin/node
COPY --from=nodejs /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node -v && npm -v

SHELL ["/bin/bash", "-c"]

RUN mkdir -p /tmp/sessions && chmod 777 /tmp/sessions
COPY ./trinket /home/trinket

# RUN groupadd -r trinket && useradd -r -g trinket -m -c "trinket user" trinket
# WORKDIR /trinket

# The locked graph, including pm2: this unit's package-lock.json pins pm2 7.0.4,
# which is exactly what the previous unpinned `npm install -g pm2` resolved, and
# `npm ci` installs the committed lock instead of re-resolving the graph on every
# build. The install output is no longer redirected to /dev/null either - an
# install nobody can read cannot be audited.
RUN npm ci --omit=dev

# cleanup, try to safeguard against certain exploits
RUN apt --purge -y autoremove build-essential
RUN chmod 744 /usr/bin/fallocate /usr/bin/git* /usr/local/bin/pip* /usr/bin/gcc* /usr/bin/curl

#USER trinket
ENV TERM xterm
ENV PYTHONPATH /home/trinket/python3
ENV MPLBACKEND module://trinket_backend
ENV MPLCONFIGDIR /tmp
RUN python3 /home/trinket/python3/init.py

# empty subprocess module to replace system
# COPY ./subprocess.py /trinket/server/python3/

# This unit deliberately keeps its supervising process as root, unlike the java
# and r shells which run USER trinket. trinket/server.js is what drops the
# privilege: it chowns each session directory to 1000:1000 (line 102), spawns the
# untrusted child with options.uid/options.gid = 1000 (lines 218-219) and signals
# it with SIGKILL (line 430). The parent therefore needs CAP_CHOWN, CAP_SETUID,
# CAP_SETGID and CAP_KILL, and it must not share uid 1000 with the code it
# supervises - otherwise untrusted code could signal or trace its own supervisor.
# serverside/docker-compose.yml bounds this container to exactly those four
# capabilities with cap_drop ALL and no-new-privileges. The commented-out
# `#USER trinket` earlier in this file stays disabled for that reason; the
# account itself is uid 1000, the uid the children run as.
RUN adduser trinket

# RUN chmod 700 /trinket

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
