# Pygame Worker Container
# Provides a full graphical environment for pygame code execution

# Node 22 LTS artifact source, pinned by multi-arch INDEX digest. Copying the
# official image's own binaries out of this stage is what replaces the previous
# NodeSource `curl … setup_22.x | bash -`, which executed unverified network
# content as a shell script at build time with no checksum or signature.
# Refresh with `docker buildx imagetools inspect node:22-bookworm`.
FROM node:22-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d AS nodejs

# Base image pinned by multi-arch INDEX digest so the OS contents of a build are
# immutable; the bare tag floats. Refresh deliberately with
# `docker buildx imagetools inspect ubuntu:22.04` and record the value in
# docs/dependency-inventory.md.
FROM ubuntu:22.04@sha256:2edbbc5dc405e9612ba3584ce95480277e3eb374407b5505fe26f17df77c7dbc

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies
RUN apt-get update && apt-get install -y \
    # Python
    python3 \
    python3-pip \
    python3-dev \
    python3-tk \
    # X11/VNC
    tightvncserver \
    xvfb \
    x11-xserver-utils \
    x11-apps \
    # noVNC and websockify
    novnc \
    websockify \
    # Audio (PulseAudio with virtual device)
    pulseaudio \
    pulseaudio-utils \
    # Process management
    supervisor \
    # Fonts (for pygame/matplotlib)
    fonts-dejavu-core \
    fonts-liberation \
    fontconfig \
    # Build tools for some Python packages
    build-essential \
    pkg-config \
    # Cleanup
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Node 22 comes from the pinned image above rather than from
# `curl -fsSL https://deb.nodesource.com/setup_22.x | bash -`, which executed
# unverified network content as root at build time. Dropping that line also
# dropped this image's only consumer of curl, so curl is no longer requested
# above. It lands in /usr/local, already on this base's PATH (measured:
# /usr/local/sbin:/usr/local/bin:...), and `node -v && npm -v` runs on the same
# layer so an incomplete copy fails the build instead of the container.
COPY --from=nodejs /usr/local/bin/node /usr/local/bin/node
COPY --from=nodejs /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && node -v && npm -v

# Install Python packages
COPY requirements.txt /tmp/requirements.txt
RUN pip3 install --no-cache-dir -r /tmp/requirements.txt

# Create non-root user for running code
RUN useradd -m -s /bin/bash trinket \
    && mkdir -p /home/trinket/.vnc /tmp/pygame \
    && chown -R trinket:trinket /home/trinket /tmp/pygame

# No VNC password artifact is built into the image. The empty one that used to
# live at /home/trinket/.vnc/passwd made Xtightvnc advertise RFB security type 1
# (None) - measured - so the desktop accepted any connection, and removing it
# changes nothing: measured on the tightvncserver 1.3.10 this image installs,
# the committed xvnc.conf command advertises the same security types, 1 (None)
# and 16 (Tight), whether or not that file exists. Access control is therefore
# UNCHANGED from before the Node 22 move and is decided entirely by
# supervisor/xvnc.conf and supervisor/novnc.conf. Anything that gates access
# belongs in a separately authorized change covering the manager, the proxy,
# the compose topology and the browser client together, not in this image.

# Copy supervisor configs
COPY supervisor/ /etc/supervisor/conf.d/

# The entrypoint exists only so the ENTRYPOINT below has a target to exec: it
# prepares nothing, as its own header records. The image CMD below is passed to
# it as "$@", so supervisord still runs the container.
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

# Create app directory
WORKDIR /app

# Copy Node.js application
COPY trinket/ /app/
# `npm ci` installs this unit's committed package-lock.json instead of
# re-resolving the dependency graph at every build. pm2 is deliberately not part
# of that graph: this image is driven by supervisord (see supervisor/shell.conf),
# so a pm2 dependency here would be an unused package tree in an image that runs
# untrusted code.
RUN npm ci --omit=dev

# Copy config
COPY config/ /app/config/

# Environment variables
ENV DISPLAY=:1
ENV NODE_CONFIG_DIR=/app/config

# Expose ports
# 8010 - Shell socket.io
# 5901 - VNC (internal, proxied by noVNC)
# 6080 - noVNC WebSocket
EXPOSE 8010 6080

# Start supervisor (manages Xvnc, noVNC, and can start shell.js) through the
# entrypoint, which does nothing but exec this command.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
