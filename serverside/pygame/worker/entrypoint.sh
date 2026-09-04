#!/bin/bash
#
# Pygame worker entrypoint.
#
# It prepares the access controls for the VNC desktop and its websockify proxy
# and then execs the process manager it was given as "$@" (the image CMD, i.e.
# supervisord). Nothing here starts a service itself: supervisor/xvnc.conf and
# supervisor/novnc.conf source the file this script writes, so the two are
# configured from one place and a missing value fails closed.
#
# Why this exists: the desktop used to be reachable with no authentication at
# all. Xtightvnc ran with -ac and an empty ~/.vnc/passwd, which makes it
# advertise RFB security type 1 (None) - measured - and websockify proxied
# anything that connected to 6080 from any origin.
#
# Everything written below lives under /run, never under $HOME or /etc, so the
# container still works with a read-only root filesystem (the hardened
# deployment supplies a tmpfs on /run).

set -eu

readonly RUNTIME_DIR=/run/pygame
readonly TOKEN_FILE="${RUNTIME_DIR}/websockify-tokens"
readonly PASSWD_FILE="${RUNTIME_DIR}/vnc-passwd"
readonly ENV_FILE="${RUNTIME_DIR}/vnc-env"

# websockify's TokenFile plugin resolves a token to its backend, so the target
# is declared here rather than on the websockify command line. Xtightvnc binds
# loopback only (-localhost), which is why this is 127.0.0.1 and not a hostname.
readonly VNC_TARGET='127.0.0.1:5900'

readonly DEFAULT_ALLOWED_ORIGINS='http://localhost:8080'

log() {
    echo "pygame-worker: $*"
}

fatal() {
    echo "pygame-worker: FATAL $*" >&2
    exit 1
}

if [ "$#" -eq 0 ]; then
    fatal 'no command to exec; this entrypoint expects the process manager as its arguments (the image CMD)'
fi

# Group-readable by trinket, because Xtightvnc runs as that user (see
# supervisor/xvnc.conf) and has to read the env and password files.
if ! mkdir -p "${RUNTIME_DIR}"; then
    fatal "cannot create ${RUNTIME_DIR}; with a read-only root filesystem the deployment must mount a writable tmpfs on /run"
fi
chmod 750 "${RUNTIME_DIR}"
chown root:trinket "${RUNTIME_DIR}"

# --- websockify token -------------------------------------------------------
#
# A connection to 6080 must present ?token=<value>. Without a shared value the
# desktop is unreachable, which is the intended fail-closed default: the token
# is generated per container and deliberately not logged, so an operator who
# wants a working desktop has to supply one to both sides.
if [ -n "${PYGAME_VNC_TOKEN:-}" ]; then
    vnc_token="${PYGAME_VNC_TOKEN}"
    log 'websockify access token taken from PYGAME_VNC_TOKEN'
else
    vnc_token="$(tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 32)"
    [ -n "${vnc_token}" ] || fatal 'could not generate a websockify access token from /dev/urandom'
    log 'WARNING PYGAME_VNC_TOKEN is not set, so a random per-container token was generated and is not printed.'
    log 'WARNING The pygame manager must run with PYGAME_VNC_TOKEN set to the same value; until it does, every'
    log 'WARNING desktop connection is refused by the proxy and the pygame view in the browser stays blank.'
fi

case "${vnc_token}" in
    *[!A-Za-z0-9_-]*)
        fatal 'PYGAME_VNC_TOKEN may contain only A-Z a-z 0-9 _ - ; websockify token files are a line-oriented format and other characters cannot be represented'
        ;;
esac

# A bearer token is only as good as its entropy, and nothing else in the chain
# rate-limits a guess: websockify simply drops an unknown token and waits for
# the next connection. 24 characters from this alphabet is about 140 bits, and
# the documented `openssl rand -hex 32` produces 64. Refusing a short value is
# the difference between a secret and a password an operator typed.
if [ "${#vnc_token}" -lt 24 ]; then
    fatal "PYGAME_VNC_TOKEN is ${#vnc_token} characters; it must be at least 24 so it cannot be guessed - generate one with \`openssl rand -hex 32\`"
fi

printf '%s: %s\n' "${vnc_token}" "${VNC_TARGET}" > "${TOKEN_FILE}"
# Read by websockify, which runs as root; nothing else needs it.
chmod 600 "${TOKEN_FILE}"
chown root:root "${TOKEN_FILE}"

# --- allowed browser origins ------------------------------------------------
#
# websockify's ExpectOrigin plugin answers 403 to a request whose Origin header
# is absent or not in this list - measured, together with 101 for an allowed one.
# The default is the committed nginx entry point in serverside/docker-compose.yml.
allowed_origins="${VNC_ALLOWED_ORIGINS:-${DEFAULT_ALLOWED_ORIGINS}}"

case "${allowed_origins}" in
    '')
        fatal 'VNC_ALLOWED_ORIGINS is empty; set it to a comma-separated list of browser origins'
        ;;
    *'*'*)
        fatal 'VNC_ALLOWED_ORIGINS must name explicit origins; a wildcard would let any page open the desktop'
        ;;
    *[!A-Za-z0-9:/._,-]*)
        fatal 'VNC_ALLOWED_ORIGINS may contain only A-Z a-z 0-9 : / . _ - and commas (no whitespace or quotes: the list is rewritten into a single websockify argument below)'
        ;;
esac

# websockify's ExpectOrigin splits its --auth-source on WHITESPACE, not on
# commas: `self.source = src.split()`. Handing it the comma-separated value
# verbatim yields one entry that no browser Origin can equal, so every
# connection is answered 403 - measured, including for origins that are on the
# list. The operator-facing variable stays comma-separated because that is the
# ordinary shape for an environment variable and what docker-compose.yml
# commits; the translation happens here, once.
websockify_origins="$(printf '%s' "${allowed_origins}" | tr ',' ' ')"

# --- optional RFB password --------------------------------------------------
#
# Off unless VNC_PASSWORD is supplied, and that is a deliberate default rather
# than an omission. Passing -rfbauth makes Xtightvnc advertise RFB security
# type 2 (VNC authentication) instead of type 1 (None) - measured - and the
# client this app ships (public/js/embed/pygame.js) never sends a password, so
# turning it on unconditionally would break every pygame session. The desktop is
# protected instead by -localhost, which keeps 5900 off the container's routable
# address, and by the token and Origin checks above. Supply VNC_PASSWORD when a
# client that can authenticate is in front of it.
if [ -n "${VNC_PASSWORD:-}" ]; then
    # vncpasswd warns and truncates at 8 characters; that is the RFB password
    # scheme's own limit, not something this script can widen.
    printf '%s' "${VNC_PASSWORD}" | vncpasswd -f > "${PASSWD_FILE}"
    # Read by Xtightvnc, which supervisor runs as trinket.
    #
    # chmod comes before chown, and the order is load-bearing: the hardened
    # deployment runs this container with cap_drop ALL and only CHOWN, SETUID,
    # SETGID and KILL added back, so once this file belongs to trinket root can
    # no longer change its mode without CAP_FOWNER. Measured: the other way
    # round the entrypoint aborts with
    # `chmod: changing permissions of '/run/pygame/vnc-passwd': Operation not
    # permitted` and the container never starts.
    chmod 600 "${PASSWD_FILE}"
    chown trinket:trinket "${PASSWD_FILE}"
    rfbauth_args="-rfbauth ${PASSWD_FILE}"
    log 'RFB password authentication enabled from VNC_PASSWORD'
else
    rm -f "${PASSWD_FILE}"
    rfbauth_args=''
    log 'RFB password authentication is off (no VNC_PASSWORD): the bundled noVNC client sends no password, so the'
    log 'desktop is gated by -localhost plus the websockify token and Origin checks instead. Set VNC_PASSWORD to add it.'
fi

# --- resolved values for the supervisor programs ----------------------------
#
# Shell assignments, sourced by supervisor/xvnc.conf and supervisor/novnc.conf.
# Every value is validated above, so the single quotes below cannot be escaped.
# VNC_ALLOWED_ORIGINS keeps the operator's comma-separated form for the log line
# and for anyone reading the file; VNC_WEBSOCKIFY_ORIGINS is the same list in the
# whitespace-separated form ExpectOrigin actually parses, and novnc.conf quotes
# it so it arrives as one argument.
{
    printf "VNC_RFBAUTH_ARGS='%s'\n" "${rfbauth_args}"
    printf "VNC_ALLOWED_ORIGINS='%s'\n" "${allowed_origins}"
    printf "VNC_WEBSOCKIFY_ORIGINS='%s'\n" "${websockify_origins}"
} > "${ENV_FILE}"
chmod 640 "${ENV_FILE}"
chown root:trinket "${ENV_FILE}"

log "VNC desktop restricted to loopback; websockify on 6080 requires a token and an Origin in: ${allowed_origins}"

exec "$@"
