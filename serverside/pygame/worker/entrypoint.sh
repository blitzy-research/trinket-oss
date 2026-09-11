#!/bin/bash
#
# Pygame worker entrypoint.
#
# It exists for one reason: Dockerfile declares
# `ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]`, so the image's CMD -
# `/usr/bin/supervisord -n -c /etc/supervisor/supervisord.conf` - arrives here
# as "$@" and something has to exec it. Deleting this file would leave that
# ENTRYPOINT pointing at nothing and the container would not start.
#
# It deliberately prepares nothing. The VNC desktop and its websockify proxy are
# configured entirely by supervisor/xvnc.conf and supervisor/novnc.conf, exactly
# as they were before the Node 22 move: no runtime access-control artifact is
# written, and no environment variable is required to start the container.
# Measured on tightvncserver 1.3.10 (the version this image installs): with the
# committed xvnc.conf command the server starts and advertises the same RFB
# security types - 1 (None) and 16 (Tight) - whether or not
# /home/trinket/.vnc/passwd exists, so the password file this image no longer
# builds does not need recreating here.
#
# Keep it that way. Anything that gates access belongs in a separately
# authorized change covering the manager, the proxy, the compose topology and
# the browser client together, not in this one file.

set -eu

if [ "$#" -eq 0 ]; then
    echo "pygame-worker: FATAL no command to exec; this entrypoint expects the process manager as its arguments (the image CMD)" >&2
    exit 1
fi

exec "$@"
