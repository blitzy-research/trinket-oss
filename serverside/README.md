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

```bash
cd serverside

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

- `default.json` - Base configuration (local development); every manager has one
- `production.json` - Optional Docker/production overrides, merged only when `NODE_ENV=production`. Only the pygame manager ships one (`pygame/manager/config/production.json`); the Java, Python and R managers run on `default.json` plus the environment variables below
- `custom-environment-variables.json` - Environment variable mappings

**Environment Variables:**

| Variable | Description | Example |
|----------|-------------|---------|
| `GENERATED_URL` | Base URL for generated files | `https://code.example.com/python3-generated` |
| `CORS_ORIGINS` | Allowed CORS origins (JSON array) | `["https://example.com"]` |

### Scaling Shells

To handle more concurrent users, run multiple shell containers and list them in the manager's `shells` array. Each shell listens on 8010 inside its own container, so the entries below differ by hostname rather than by port:

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

Outside Docker the addresses differ — the committed `shells` arrays point at per-language localhost ports instead. See [Ports (Direct Host Development)](#ports-direct-host-development).

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

> **`nginx-ssl.conf` does not route pygame.** As committed it defines an HTTP-to-HTTPS redirect server plus `/health`, `/python3/`, `/python3-generated/`, `/java/`, `/java-generated/`, `/r/` and `/r-generated/`. The `/pygame/`, `/pygame-vnc/` and `/pygame-generated/` locations that `nginx.conf` provides are absent, so swapping the config in as-is leaves pygame trinkets — including the VNC stream they render through — unreachable over TLS.

If you serve pygame over HTTPS, add these three locations to the `server { listen 443 ssl ... }` block in `nginx-ssl.conf` before building the image. They are the `nginx.conf` blocks unchanged, so HTTP and HTTPS route pygame identically:

```nginx
        # Pygame manager WebSocket
        location /pygame/ {
            set $pygame_upstream pygame-manager:8100;
            rewrite ^/pygame/(.*) /$1 break;
            proxy_pass http://$pygame_upstream;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }

        # Pygame VNC WebSocket (noVNC)
        location /pygame-vnc/ {
            set $pygame_vnc_upstream pygame-worker:6080;
            rewrite ^/pygame-vnc/(.*) /$1 break;
            proxy_pass http://$pygame_vnc_upstream;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }

        # Pygame generated files
        location /pygame-generated/ {
            alias /var/www/generated/pygame/;
            expires 1h;
            add_header Cache-Control "public, immutable";
        }
```

Mount `pygame-generated` into the nginx container at `/var/www/generated/pygame` as `docker-compose.yml` already does, otherwise the `alias` above resolves to nothing.

And in docker-compose.yml:

```yaml
nginx:
  ports:
    - "443:443"
    - "80:80"  # For redirect
```

### Security Hardening

The shell containers run untrusted user code. Apply these security measures:

#### Docker Compose (recommended settings)

Uncomment the security options in `docker-compose.yml`:

```yaml
python3-shell:
  mem_limit: 500m           # Hard memory limit
  mem_reservation: 375m     # Soft limit for scheduling
  cpus: 1.0                 # Limit to 1 CPU core
  cpu_shares: 512           # Relative CPU weight
  pids_limit: 50            # Prevent fork bombs
  read_only: true           # Read-only root filesystem
  tmpfs:
    - /tmp:size=100m        # Writable /tmp with size limit
```

#### Production Docker Run

For production deployments outside compose:

```bash
docker run -d \
  -p 8010:8010 \
  --restart unless-stopped \
  --memory="500m" \
  --memory-reservation="375m" \
  --cpus="1.0" \
  --cpu-shares="512" \
  --pids-limit=50 \
  --read-only \
  --tmpfs /tmp:size=100m \
  --security-opt=no-new-privileges \
  --cap-drop=ALL \
  trinket/python3-shell:latest
```

#### Network Isolation

Consider running shells in an isolated network with no external access:

```yaml
networks:
  shell-internal:
    internal: true  # No external connectivity

services:
  python3-shell:
    networks:
      - shell-internal
```

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
    ├── manager/         # the only manager whose config/ also holds production.json
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
| pygame-manager | 8100 | WebSocket routing |
| pygame-worker | 8010, 6080 | Code execution + VNC |

Numbers repeat because each container has its own network namespace: every shell and the pygame worker listen on 8010, and `python3-manager` and `pygame-manager` both listen on 8100. nginx tells them apart by service name — `python3-manager:8100`, `pygame-manager:8100`, `pygame-worker:6080`.

## Ports (Direct Host Development)

Running the managers and shells directly on a host puts them all in one namespace, where the numbers above do collide. These are the ports the committed configuration uses:

| Language | Manager `manager.port` | Shell address the manager dials | Port the shell process binds |
|----------|-----------------------|---------------------------------|------------------------------|
| Python 3 | 8100 | `http://localhost:8110` (`shells`) | 8010 (`python/shell/trinket/server.js`) |
| Java | 8200 | `http://localhost:8210` (`shells`) | 8010 (`java/shell/trinket/server.js`) |
| R | 8300 | `http://localhost:8310` (`shells`) | 8010 (`r/shell/trinket/server.js`) |
| Pygame | 8100 | `http://localhost:8010` (`manager.workerUrl`) | 8010 (`shell.port`, `pygame/worker/config/default.json`) |

Two consequences: the Python 3 and pygame managers both default to 8100, so run one at a time or override `manager.port`; and the Python, Java and R shells bind 8010 rather than the 8110/8210/8310 addresses their managers dial, so point the `shells` array at `http://localhost:8010` — one shell per host, since they share that port.

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

When users run code that produces files (matplotlib plots, R graphics, etc.), these files are stored in Docker volumes and served via nginx. To prevent disk space exhaustion, the Java, Python and R managers automatically clean up old generated files.

> **The pygame manager does not.** `pygame/manager/manager.js` runs no cleanup scheduler and neither `pygame/manager/config/default.json` nor its `production.json` carries a `cleanup` block, so `pygame-generated` grows until it is cleared by hand — see [Manual Cleanup](#manual-cleanup).

### How It Works

- Cleanup runs on manager startup and then periodically (default: every 60 minutes)
- Files older than `maxAgeHours` (default: 24 hours) are deleted
- Cleanup is based on directory modification time (each generated file gets its own subdirectory)

### Configuration

The Java, Python and R managers read their cleanup settings from `config/default.json`:

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

Cleanup progress is logged to the stdout of the Java, Python and R managers:

```
[Cleanup] Starting cleanup of files older than 24 hours in /tmp/python-generated
[Cleanup] Complete. Deleted 15 directories, 0 errors.
```

The pygame manager logs nothing here, because it runs no cleanup.

### Manual Cleanup

To manually clear all generated files:

```bash
# Clear all Python generated files
docker compose exec python3-manager sh -c 'rm -rf /tmp/python-generated/*'

# Pygame has no automatic cleanup, so this is the only way to reclaim its volume
docker compose exec pygame-manager sh -c 'rm -rf /tmp/pygame-generated/*'
```

The `sh -c` is required: `docker compose exec` runs the command directly instead of through a shell, so without it the wildcard reaches `rm` unexpanded and `rm -f` exits 0 having deleted nothing.

To discard the volumes instead of emptying them, note that each generated volume is attached to nginx and to its manager, so `docker volume rm` fails with `volume is in use` while those containers exist — stopping them is not enough, they have to be removed. Bring the stack down, remove the volumes, then start it again:

```bash
docker compose --profile python3 --profile java --profile r --profile pygame down
docker volume rm serverside_python-generated serverside_java-generated \
  serverside_r-generated serverside_pygame-generated
```

Adding `-v` to `docker compose down` does both steps at once, but it also removes the `*-sessions` volumes the same file declares.

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

Update `config/default.json` shell URLs to match your local setup: the shell above binds 8010, not the `http://localhost:8110` the committed Python array dials. See [Ports (Direct Host Development)](#ports-direct-host-development) for every language.

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

Pygame workers need more resources than text-based languages due to the graphical environment:

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
