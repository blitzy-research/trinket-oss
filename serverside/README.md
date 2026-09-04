# Server-side Trinket Types

This directory contains the backend services for server-side trinket types (Python 3, Java, R, Pygame). These run actual language interpreters in Docker containers, allowing execution of code that can't run in the browser.

## Architecture

```
                                    ┌─────────────────┐
                                    │  python3-shell  │
                                    │   (Container)   │
                                    │  Python Process │
                                    └────────▲────────┘
                                             │ WebSocket
┌─────────┐      ┌─────────┐      ┌──────────┴────────┐
│ Browser │─────►│  nginx  │─────►│  python3-manager  │
│         │ WS   │  :8080  │      │    (Container)    │
└─────────┘      └────┬────┘      └───────────────────┘
                      │
                      │           ┌─────────────────┐
                      │           │    java-shell   │
                      │           │   (Container)   │
                      │           │   Java Process  │
                      │           └────────▲────────┘
                      │                    │ WebSocket
                      │           ┌────────┴──────────┐
                      └──────────►│   java-manager    │
                      │           │    (Container)    │
                      │           └───────────────────┘
                      │
                      │           ┌─────────────────┐
                      │           │     r-shell     │
                      │           │   (Container)   │
                      │           │    R Process    │
                      │           └────────▲────────┘
                      │                    │ WebSocket
                      │           ┌────────┴──────────┐
                      └──────────►│    r-manager      │
                                  │    (Container)    │
                                  └───────────────────┘
```

**Components:**

- **nginx**: Reverse proxy that routes WebSocket connections and serves generated files (images, HTML)
- **Manager**: Node.js process that accepts browser connections and routes to shells
- **Shell**: Docker container running the language interpreter

> **Note:** Pygame uses a different architecture with VNC for graphical output. See the [Pygame](#pygame) section below.

## Quick Start

The `pygame` profile needs a VNC token exported first — it has no default and none is committed, and the pygame manager refuses to start without one. The other profiles need nothing. [Pygame VNC access](#pygame-vnc-access) covers what it gates.

```bash
cd serverside

# Required for the pygame profile only; see Pygame VNC access below
export PYGAME_VNC_TOKEN=$(openssl rand -hex 32)

# Start Python 3 only
docker compose --profile python3 up --build

# Start Python 3 and Java
docker compose --profile python3 --profile java up --build

# Start all languages
docker compose --profile python3 --profile java --profile r --profile pygame up --build
```

The services will be available at `http://localhost:8080`.

## How It Works

1. Browser loads a trinket embed page (e.g., `/embed/python3/{trinketId}`)
2. The main app injects the WebSocket URL into the page (`http://localhost:8080/python3`)
3. Frontend JavaScript connects via Socket.io through nginx
4. nginx proxies the WebSocket to the appropriate manager
5. Manager connects to an available shell container
6. Shell spawns the language process, executes code, and streams output back
7. If code generates files (e.g., matplotlib images), the shell sends them to the manager
8. Manager writes files to a shared volume, nginx serves them to the browser

## Configuration

### Main App (`config/default.yaml`)

Enable the trinket types you want to support:

```yaml
features:
  trinkets:
    python3: true   # Enable Python 3
    java: false     # Disable Java
    R: false        # Disable R

app:
  serverside:
    python3:
      api:
        default: 'http://localhost:8080/python3'
    java8:
      api:
        default: 'http://localhost:8080/java'
    r3:
      api:
        default: 'http://localhost:8080/r'
```

### Manager Configuration

Each manager reads from `{language}/manager/config/`. The `node-config` library merges files:

- `default.json` - Base configuration (local development)
- `production.json` - Docker/production overrides
- `custom-environment-variables.json` - Environment variable mappings

**Environment Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `GENERATED_URL` | Base URL for generated files | `https://code.example.com/python3-generated` |
| `CORS_ORIGINS` | Allowed CORS origins (JSON array) | `["https://example.com"]` |

### Scaling Shells

To handle more concurrent users, run multiple shell containers and list them in the manager's `shells` array:

```json
{
  "shells": [
    "http://python3-shell-1:8010",
    "http://python3-shell-2:8010",
    "http://python3-shell-3:8010"
  ]
}
```

The manager randomly selects a shell for each connection.

## Production Deployment

### SSL/TLS Setup

For production, you should enable HTTPS. Two options:

#### Option 1: Self-signed certificate (development/testing)

```bash
# Generate self-signed certificate
mkdir -p nginx/ssl
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout nginx/ssl/key.pem \
  -out nginx/ssl/cert.pem \
  -subj "/CN=localhost"
```

#### Option 2: Let's Encrypt (production)

Use certbot or your preferred ACME client to obtain certificates, then mount them:

```bash
# In docker-compose.yml, uncomment:
volumes:
  - /etc/letsencrypt/live/your-domain/fullchain.pem:/etc/nginx/ssl/cert.pem:ro
  - /etc/letsencrypt/live/your-domain/privkey.pem:/etc/nginx/ssl/key.pem:ro
```

Then update nginx to use the SSL config:

```dockerfile
# In nginx/Dockerfile, change:
COPY nginx-ssl.conf /etc/nginx/nginx.conf
```

And in docker-compose.yml:

```yaml
nginx:
  ports:
    - "443:443"
    - "80:80"  # For redirect
```

### Security Hardening

The shells and the pygame worker run untrusted user code. The controls that contain it are committed in `docker-compose.yml` and apply to every `docker compose --profile ... up`; there is nothing to switch on, and removing one weakens the deployment.

#### What the committed compose file enforces

Every service drops all Linux capabilities (`cap_drop: ALL`) and forbids privilege escalation (`security_opt: no-new-privileges:true`). Only the three services in the "Capabilities kept" column below add anything back, and each addition is there because its process model provably needs it.

| Service | Memory | CPU | PIDs | Root filesystem | Capabilities kept | Network |
|---------|--------|-----|------|-----------------|-------------------|---------|
| python3-shell | 500m (375m soft) | 1.0 (512 shares) | 50 | read-only + `/tmp` tmpfs 100m | CHOWN, SETUID, SETGID, KILL | `python-exec` |
| java-shell | 500m (375m soft) | 1.0 (512 shares) | 50 | read-only + `/tmp` tmpfs 100m | none | `java-exec` |
| r-shell | 500m (375m soft) | 1.0 (512 shares) | 50 | read-only + `/tmp` tmpfs 100m | none | `r-exec` |
| python3-manager | 300m | 0.5 | 50 | read-only + `/tmp` tmpfs 100m | none | `proxy` + `python-exec` |
| java-manager | 300m | 0.5 | 50 | read-only + `/tmp` tmpfs 100m | none | `proxy` + `java-exec` |
| r-manager | 300m | 0.5 | 50 | read-only + `/tmp` tmpfs 100m | none | `proxy` + `r-exec` |
| pygame-manager | 300m | 0.5 | 50 | read-only + `/tmp` tmpfs 100m | none | `proxy` + `pygame-exec` |
| pygame-worker | 1g (750m soft) | 2.0 | 200 | read-only + tmpfs for `/run`, `/tmp`, `/var/log/supervisor` and `/home/trinket` | CHOWN, SETUID, SETGID, KILL | `pygame-exec` |
| nginx | 256m | 1.0 | 512 | read-only + tmpfs for `/var/cache/nginx` and `/run` | CHOWN, SETGID, SETUID, DAC_OVERRIDE, NET_BIND_SERVICE | `edge` + `proxy` + `pygame-exec` |
| generated-volume-init | 64m | — | 16 | read-only, no network | CHOWN, DAC_OVERRIDE | none |

**Networking.** One network per language rather than one shared execution network, all declared `internal: true`: `python-exec`, `java-exec`, `r-exec` and `pygame-exec` each carry a manager and the shell or worker it drives, and `proxy` carries nginx to the four managers. A shell's only reachable peer is therefore its own manager — it cannot see another language's containers at all — and no shell or worker sits on `proxy`, so it cannot be used to cross between languages. nginx additionally joins `pygame-exec`, because `nginx.conf` proxies `/pygame-vnc/` straight to `pygame-worker:6080`. Its `8080:80` is the only published port in the file; every execution service declares `expose` and no `ports`.

`internal: true` removes the gateway, so none of these containers can reach the internet — verified. It does **not** wall off the host: the bridge gateway is the host itself, so a daemon listening on the host stays reachable from an internal network. Denying that is a host firewall policy and is listed under the residuals below.

**Writable storage.** The `*-sessions` volumes — where an untrusted submission is written and executed — are tmpfs-backed with a 256 MB ceiling, because a plain named volume is mounted *deeper* than the container's `/tmp:size=100m` tmpfs and so escapes it, leaving user code the whole host disk. The `*-generated` volumes stay ordinary named volumes on purpose: each is written by a manager and read by nginx, and a tmpfs-backed named volume is a separate mount per container rather than shared storage (measured — the second container sees an empty filesystem), which would stop generated plots being served. They are bounded by the managers' cleanup scheduler and, for pygame, by the manual cleanup its section documents.

**Volume ownership on upgrade.** The managers moved from root to uid 1000, and Docker seeds a volume's ownership from the image only when the volume is new — so a deployment upgrading from the earlier images has root-owned generated volumes that the non-root manager cannot write. `generated-volume-init` runs once before the managers, with no network, a read-only root and only CHOWN and DAC_OVERRIDE, hands each generated volume to uid 1000 and exits; on a fresh deployment it is a no-op. Every long-lived service still starts unprivileged.

**Read-only roots.** Every service runs on a read-only root filesystem. The shells and the managers get a 100 MB `/tmp` tmpfs; the pygame worker needs four mounts instead of one, because it runs a process manager and an X server rather than a single Node process — `/run` for the websockify token and the optional RFB password its entrypoint writes, `/var/log/supervisor` for the per-program logs, `/tmp`, and `/home/trinket` mounted with `uid=1000,gid=1000` so Xvnc and the pygame process can write there. The named volumes are mounted deeper than that tmpfs (`*-sessions:/tmp/sessions`, `*-generated:/tmp/*-generated`) and stay writable, so session directories and generated files are unaffected. pm2-runtime, which the shells start under, writes to `PM2_HOME=/tmp/pm2` inside the tmpfs rather than to a home directory on the read-only root.

**Why python3-shell keeps a privileged parent.** Its `server.js` chowns each session directory to `1000:1000`, spawns the interpreter with uid/gid 1000, and SIGKILLs it when the 60-second timeout expires — so the parent process stays privileged by design and CHOWN, SETUID, SETGID and KILL are exactly what that design needs. The user's code itself runs as uid 1000, never as root. What bounds the parent is the rest of the row: every other capability dropped, `no-new-privileges` (so no setuid binary can regain one), the memory/CPU/PID ceilings, the read-only root, and a language-private internal network whose only other member is its manager. The Java and R shells switch to the `trinket` user in the image and therefore keep nothing; the pygame worker keeps the same four because its supervisord starts as root and drops each program it manages to `user=trinket`. nginx keeps its five because the master binds `:80`, drops its workers to the `nginx` user, and takes ownership of its cache directories.

If you run these images outside compose, reproduce the same set: `--memory`, `--memory-reservation`, `--cpus`, `--cpu-shares`, `--pids-limit`, `--read-only --tmpfs /tmp:size=100m`, `--security-opt=no-new-privileges`, `--cap-drop=ALL` plus the `--cap-add` values from the table, and an internal network.

#### Pygame VNC access

The worker's VNC surface is gated by a token that has no default and is not committed. Generate one and export it before bringing the stack up:

```bash
export PYGAME_VNC_TOKEN=$(openssl rand -hex 32)
docker compose --profile pygame up --build
```

Without it the profile fails closed rather than opening a desktop: `pygame-manager` exits at start with `refusing to start because PYGAME_VNC_TOKEN is not set` and the remedy above, and the worker falls back to a random per-container token it never prints, so its proxy refuses every connection. The requirement is enforced in the manager rather than as a `${PYGAME_VNC_TOKEN:?...}` guard in `docker-compose.yml` for a specific reason: Compose interpolates a whole file before it applies profiles, so a guard there would also block `--profile python3`, `--profile java` and `--profile r`, none of which starts a pygame service.

Both pygame services receive the same token: the manager hands it to the browser inside the `rfbUrl` it builds, and websockify on the worker completes a WebSocket handshake only for a connection that carries it. An absent or unknown token is dropped, a request whose `Origin` is missing or is not listed in `VNC_ALLOWED_ORIGINS` is answered 403, and a correct token with an allowed origin upgrades (101). Both ends require at least 24 characters and refuse to start below that — nothing in the chain rate-limits a guess, so the token's length is the whole of its strength, and `openssl rand -hex 32` gives 64.

`VNC_ALLOWED_ORIGINS` is comma-separated and committed as `http://localhost:3000,http://localhost:3001,http://localhost:8080`. Those are *page* origins, not this endpoint's: the trinket application is published on 3000 by the root `docker-compose.yml` and names 3000 and 3001 in `pygame/manager/config/default.json`, while 8080 covers a deployment that also fronts the application with this file's nginx. Replace the list with the origins your users actually load from; a wildcard is refused.

Because the token travels in a URL, it would otherwise land in nginx's access log. The `/pygame-vnc/` location therefore logs with a format that omits the query string (`no_query` in `nginx/nginx.conf`) — verified: a request carrying a token leaves no log line containing it, while other routes still log their query strings. No noVNC user interface is served from the worker, and Xvnc binds loopback inside the container, so that proxy is the only route to the display.

`VNC_PASSWORD` is available and is deliberately not the default. Setting it makes the worker start Xvnc with `-rfbauth`, which removes the RFB "None" security type; the noVNC client bundled with the app then demands a password, and `public/js/embed/pygame.js` never supplies one, so pygame embeds stop rendering until the client is taught to send it. That client is outside this migration's scope, so the token proxy and the loopback-only Xvnc binding are what gate this surface instead. Use `VNC_PASSWORD` only alongside a client that prompts for it.

#### Pygame manager CORS

The pygame manager image sets `NODE_ENV=production`, and `pygame/manager/config/production.json` sets `corsOrigins: true`. The manager refuses that wildcard and exits rather than accepting Socket.IO connections from any origin, so `docker-compose.yml` passes an explicit allowlist — `CORS_ORIGINS=["http://localhost:3000","http://localhost:3001","http://localhost:8080"]` for the committed deployment, which are the application's own origins plus this file's nginx entry point. It is a JSON array (a comma-separated string works too); replace it with your own origins as shown under [Environment-specific Configuration](#environment-specific-configuration) below.

#### Image pinning

All eight serverside images are pinned by digest, so a rebuild resolves the same base bits instead of whatever the tag points at that day. To move one deliberately, resolve the digest and edit the `FROM` line:

```bash
docker buildx imagetools inspect node:22-alpine
# then, in the Dockerfile:
# FROM node:22-alpine@sha256:<digest>
```

#### Residuals a deployment still owns

- **TLS.** Nothing inside the internal networks is encrypted; TLS terminates at nginx, which is why [SSL/TLS Setup](#ssltls-setup) above is part of a production deployment rather than optional. It matters more than usual here because the VNC token travels in a URL: on a plaintext hop that credential is readable in transit. The bundled `nginx-ssl.conf` covers the Python, Java and R routes only, so a TLS deployment that serves pygame needs its `/pygame/`, `/pygame-vnc/` and `/pygame-generated/` locations added.
- **The host is not walled off by `internal: true`.** It removes the internet route, not the bridge gateway, so a daemon listening on the host remains reachable from a container. Deny it with a host firewall rule (for example, dropping traffic from the compose bridge subnets to the host's own addresses) if untrusted code must not reach host services.
- **Session and generated storage.** The session volumes carry a 256 MB tmpfs ceiling each; the generated volumes cannot (nginx has to read what a manager wrote) and rely on the cleanup scheduler, so apply a host-level quota if the host's disk is shared with anything that matters.
- **Connection establishment is authorized by Origin, not by identity.** The managers admit any Socket.IO client from an allowlisted browser origin: there is no user, session or signed credential in the handshake, so anyone who can reach nginx can start an execution session and be handed the VNC token. That gate belongs in the application that embeds these units — it issues the page and holds the session — and wiring it needs a credential the browser client sends, which is outside this directory. Until then, treat reachability of the nginx entry point as the access boundary.
- **One pygame desktop is shared.** A single Xvnc display and a single worker serve every session, so concurrent users can see each other's output. Run one worker per user, or gate access upstream, if you need per-user isolation.
- **The ceilings are per container, not per session.** A shell serves several sessions at once, and they share its 500 MB, one CPU and 50 processes.
- **nginx forks one worker per core.** `nginx.conf` sets `worker_processes auto`, so nginx's own process count follows the host. Its ceiling is set to 512 to stay clear of that on a large machine — measured on a 112-core host, a ceiling near 100 stops the master mid-startup with `sendmsg() failed (9: Bad file descriptor)` in the error log. On a host with more than ~500 cores, pin `worker_processes` in `nginx/nginx.conf` or raise the ceiling to match.

### Environment-specific Configuration

For production, override the generated URL to match your domain:

```yaml
# docker-compose.override.yml
services:
  python3-manager:
    environment:
      - GENERATED_URL=https://code.example.com/python3-generated
      - CORS_ORIGINS=["https://example.com","https://www.example.com"]
```

## Directory Structure

```
serverside/
├── docker-compose.yml       # Main compose file
├── nginx/
│   ├── Dockerfile
│   ├── nginx.conf           # HTTP config
│   └── nginx-ssl.conf       # HTTPS config
├── python/
│   ├── manager/
│   │   ├── Dockerfile
│   │   ├── manager.js
│   │   ├── package.json
│   │   ├── package-lock.json
│   │   └── config/
│   │       ├── default.json
│   │       ├── production.json
│   │       └── custom-environment-variables.json
│   └── shell/
│       ├── Dockerfile
│       ├── requirements.txt
│       └── trinket/
│           ├── server.js
│           └── package.json
├── java/
│   ├── manager/
│   └── shell/
├── r/
│   ├── manager/
│   └── shell/
└── pygame/
    ├── manager/
    └── worker/          # Uses 'worker' (not 'shell') due to VNC components
```

## Ports (Internal)

These ports are internal to the Docker network. Only nginx port 8080 is exposed externally.

| Service | Internal Port | Purpose |
|---------|--------------|---------|
| nginx | 80 (external: 8080) | Reverse proxy |
| python3-manager | 8100 | WebSocket routing |
| python3-shell | 8010 | Code execution |
| java-manager | 8200 | WebSocket routing |
| java-shell | 8010 | Code execution |
| r-manager | 8300 | WebSocket routing |
| r-shell | 8010 | Code execution |
| pygame-manager | 8400 | WebSocket routing |
| pygame-worker | 8010, 6080 | Code execution + VNC |

## Troubleshooting

### Check service status

```bash
docker compose --profile python3 ps
docker compose --profile python3 logs -f
```

### Test nginx routing

```bash
# Health check
curl http://localhost:8080/health

# Check WebSocket upgrade headers
curl -v -H "Upgrade: websocket" -H "Connection: upgrade" \
  http://localhost:8080/python3/socket.io/
```

### Debug manager connections

```bash
# View manager logs
docker compose --profile python3 logs -f python3-manager

# Check shell connectivity
docker compose --profile python3 exec python3-manager \
  wget -qO- http://python3-shell:8010 || echo "Shell not responding"
```

### Generated files not loading

1. Check the volume is mounted correctly:
   ```bash
   docker compose exec nginx ls -la /var/www/generated/python/
   ```

2. Verify the manager's `generatedUrl` config matches nginx routing

3. Check browser console for CORS errors

## Generated File Cleanup

When users run code that produces files (matplotlib plots, R graphics, etc.), these files are stored in Docker volumes and served via nginx. To prevent disk space exhaustion, each manager automatically cleans up old generated files.

### How It Works

- Cleanup runs on manager startup and then periodically (default: every 60 minutes)
- Files older than `maxAgeHours` (default: 24 hours) are deleted
- Cleanup is based on directory modification time (each generated file gets its own subdirectory)

### Configuration

Each manager's cleanup is configured in its `config/default.json`:

```json
{
  "manager": {
    "cleanup": {
      "enabled": true,
      "maxAgeHours": 24,
      "intervalMinutes": 60
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `enabled` | `true` | Enable/disable automatic cleanup |
| `maxAgeHours` | `24` | Delete files older than this many hours |
| `intervalMinutes` | `60` | How often to run cleanup (in minutes) |

### Monitoring

Cleanup progress is logged to the manager's stdout:

```
[Cleanup] Starting cleanup of files older than 24 hours in /tmp/python-generated
[Cleanup] Complete. Deleted 15 directories, 0 errors.
```

### Manual Cleanup

To manually clear all generated files:

```bash
# Clear all Python generated files
docker compose exec python3-manager rm -rf /tmp/python-generated/*

# Or from the host (if volumes are named)
docker volume rm serverside_python-generated
docker volume rm serverside_java-generated
docker volume rm serverside_r-generated
```

Note: Removing volumes requires restarting the containers.

### Shell timeouts

Python shells have a 60-second timeout. For long-running computations:

1. Increase timeout in `shell/trinket/server.js`
2. Consider breaking code into smaller chunks
3. Use async patterns where possible

## Development (without Docker)

For local development, you can run services directly on Node 22, the version pinned in the repository's root `.nvmrc`:

**Shell** (requires language runtime):
```bash
cd python/shell/trinket
npm install
node server.js  # Listens on port 8010
```

**Manager**:
```bash
cd python/manager
npm ci
node manager.js  # Listens on port 8100, connects to shell
```

Update `config/default.json` shell URLs to match your local setup.

## Pygame

Pygame has a different architecture than other languages because it needs a graphical display for game windows.

### How It Works

```
┌─────────┐      ┌─────────┐      ┌─────────────────┐      ┌─────────────────────┐
│ Browser │─────►│  nginx  │─────►│  pygame-manager │─────►│    pygame-worker    │
│         │      │         │      │                 │      │  ┌───────────────┐  │
│ noVNC   │◄─────│         │◄─────│                 │◄─────│  │    Xvfb       │  │
│ Client  │ WS   │         │ WS   │                 │      │  │  (Virtual X)  │  │
└─────────┘      └─────────┘      └─────────────────┘      │  └───────┬───────┘  │
                                                           │          │          │
                                                           │  ┌───────▼───────┐  │
                                                           │  │    pygame     │  │
                                                           │  │    process    │  │
                                                           │  └───────────────┘  │
                                                           │          │          │
                                                           │  ┌───────▼───────┐  │
                                                           │  │ TightVNC +    │  │
                                                           │  │ noVNC server  │──┼──► VNC stream
                                                           │  └───────────────┘  │
                                                           └─────────────────────┘
```

The worker container runs:
- **Xvfb**: Virtual X11 framebuffer (headless display)
- **TightVNC**: VNC server capturing the display
- **noVNC + websockify**: WebSocket-to-VNC proxy for browser access
- **Supervisor**: Process manager coordinating all services

### Quick Start

```bash
# The websockify token is mandatory for this profile; see Security Hardening -> Pygame VNC access
export PYGAME_VNC_TOKEN=$(openssl rand -hex 32)
docker compose --profile pygame up --build
```

### Configuration

Enable pygame in the main app:

```yaml
features:
  trinkets:
    pygame: true

app:
  serverside:
    pygame:
      api:
        default: 'http://localhost:8080/pygame'
```

### Resource Requirements

Pygame workers need more resources than text-based languages due to the graphical environment, and `docker-compose.yml` already commits them along with a 750m reservation and a 200-process ceiling:

```yaml
pygame-worker:
  mem_limit: 1g
  cpus: 2.0
```

### Production Scaling (Not Yet Included)

The current pygame setup runs a single worker container, suitable for development and small deployments.

For production with many concurrent users, Trinket used a dynamic scaling system that:
- Spins up cloud VM instances (AWS EC2 or GCP) on demand
- Uses Redis to coordinate instance state across the scaler and workers
- Workers "phone home" on startup to register with the scaler
- Automatically scales down idle instances to reduce costs

This infrastructure (scaler, stats server, worker images, phone-home scripts) is not yet included in the OSS release. Contributions welcome.
