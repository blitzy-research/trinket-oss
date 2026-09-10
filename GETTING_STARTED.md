# Getting Started with Trinket

This guide will help you get Trinket running locally for development.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose. Every Compose command below is written for the **Compose plugin** - `docker compose <verb>`, which `docker compose version` confirms is installed. The standalone hyphenated script is a separate, superseded package; where it is absent, the hyphenated spelling answers `command not found` and only the plugin spelling runs. `docker-compose.yml` is a file name and is unaffected either way.
- Git
- Node.js 22 LTS with npm 10 - optional, and only for local development without Docker. `package.json` declares `node >=22.0.0 <23.0.0` and `npm >=10.0.0 <11.0.0`, and `.nvmrc` contains `22`. **That version is the requirement; how you arrive at it is yours.** With nvm installed, `nvm use 22` reads `.nvmrc` and selects the line; nvm is one route rather than a prerequisite, and on a host without it any Node 22 install does equally well. `node -v` and `npm -v` are the check.

For the Docker workflow that's it - everything else runs inside a container, including the one build step the `app` image cannot do itself. Where a step can also be run on the host, the host command is given alongside the container one.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/trinketapp/trinket-oss.git
cd trinket-oss

# Copy the example local config
cp config/local.example.yaml config/local.yaml

# Build the stylesheets into the checkout - Compose serves them from there,
# not from the image, and the app image cannot build them itself.
# See "Building CSS" below for both halves of why.
npm ci && npm run build
# or instead of that line, with no Node on the host, run the same build
# in a Node 22 container:
docker run --rm -v "$PWD":/app -w /app node:22-bookworm sh -c 'npm ci && npm run build'

# Start the services
docker compose up
```

Wait for the services to start. You'll see `Server started on port:` when ready.

Open **http://localhost:3000** in your browser.

The CSS step is not optional under Compose, and the reason is the volume layout rather than the build: `docker-compose.yml` mounts your checkout over the application directory, so `/css/base.css` and `/css/embed.css` are served from `public/css/` **in the checkout** and not from the copies the image built. Both files are generated and gitignored, so a fresh clone does not have them and those two requests answer 404 until the build above has run. The image itself does contain them, so running it without mounting your source over it (`docker run`, or any deployment that does not bind-mount the checkout) needs no extra step.

## Frontend Components

Trinket requires frontend libraries (Ace Editor, Skulpt, etc.) that are distributed separately from the main repository. These are packaged in `public-components.tgz` and downloaded automatically during the Docker build from GitHub releases.

**Skulpt** is the Python-to-JavaScript compiler that powers the Python code execution in the browser. Trinket maintains a forked version with additional features.

Both workflows retrieve the components with the same script, `scripts/fetch-components.js`:

- **Docker:** the image build runs the script, so there is nothing extra to do. It replaced an inline `curl` that performed no integrity check at all; the archive's SHA-256 is now verified before anything is extracted.
- **Host:** run `npm run fetch-components` to retrieve and verify the bundle into `public/components/` (gitignored, like `node_modules`). `npm run build` runs it automatically ahead of the CSS build, so the usual setup needs no separate step.

```bash
# Host only - fetch and verify the component bundle
npm run fetch-components
```

The components are a build input, not an optional extra: `static/scss/_settings.scss` imports `public/components/foundation/scss/foundation/functions`, so the SCSS compile exits 1 on a tree that does not have them. That is why `npm run build` fetches them first, and why `npm run build:css` on its own expects them to be in place already.

The script is idempotent - a second run exits 0 without re-downloading - and atomic: it extracts into a temporary directory, moves the tree into place, and deletes partial files on failure, so `public/components/` is only ever absent or complete.

See [COMPONENTS.md](COMPONENTS.md) for the release URL, its expected SHA-256, and the full component inventory.

## Development

### Building CSS

The project uses SCSS for stylesheets. The build runs where the devDependencies are, which is the host or a Node 22 container over your checkout - **not** the `app` container:

```bash
# Fetch the components if needed, then build the CSS
npm run build

# CSS only, when the components are already present
npm run build:css

# Watch mode (recompiles on changes)
npm run watch:css
```

With no Node on the host, the same build runs in a container over the checkout, which needs nothing installed but Docker:

```bash
docker run --rm -v "$PWD":/app -w /app node:22-bookworm sh -c 'npm ci && npm run build'
```

Either way the outputs are `public/css/base.css` and `public/css/embed.css`, both gitignored build artifacts. On a clean checkout, `npm ci` followed by `npm run build` exits 0 and writes both of them - 265,727 and 296,352 bytes, identical from either route - and the SCSS compile prints 58 Sass deprecation notices from the vendored Foundation tree in `public/components` on the way, then two `WARNING: 435 repetitive deprecation warnings omitted` summaries. All of that is expected, and the artifacts are correct.

**Why not in the `app` container.** `npm run build:css` is `vite build`, and `vite` and `sass` are devDependencies. The image is built in stages so that the dev-inclusive tree never ships: the stage that builds the CSS installs everything, and the shipped stage installs `npm ci --omit=dev` and is audited at build time to contain no declared devDependency at all. So `docker compose exec app npm run build:css` answers `sh: 1: vite: not found` - measured, in an image built from the current `Dockerfile` - and no `--user root` changes that. Commands that need only the production tree do run there, `npm run make-admin` below among them.

A container built from the current `Dockerfile` still *contains* both stylesheets, because its asset stage fetches the components, installs the full graph and runs `npm run build:css`, and the shipped stage copies the two files out of it and fails the build if either is missing or empty - so the image serves `/css/base.css` and `/css/embed.css` from copies it built itself. Earlier images shipped neither. **That does not carry over to `docker compose up`**, because the bind mount described in the Quick Start puts your checkout's `public/css/` in front of the image's - so under Compose the builds above are what produce the stylesheets, and the image's copies are what you get when nothing is mounted over them. The application serves the files from disk as they are requested, so a build while the container is running takes effect without a restart.

### Viewing Logs

```bash
# All services
docker compose logs -f

# Just the app
docker logs -f trinket
```

### Restarting the App

```bash
docker compose restart app
```

### Creating an Admin User

After registering a user through the web interface, promote them to admin:

```bash
docker compose exec app npm run make-admin user@example.com
```

Admin users can access `/admin` for site administration features.

## Project Structure

```
trinket-oss/
├── app.js              # Main application entry point
├── config/             # Configuration files
│   ├── default.yaml    # Default settings
│   ├── local.yaml      # Your local overrides (gitignored)
│   ├── routes.js       # Web routes
│   └── api_routes.js   # API routes
├── lib/
│   ├── controllers/    # Route handlers
│   ├── models/         # MongoDB models
│   ├── util/           # Utilities
│   └── views/          # Nunjucks templates
├── public/             # Static assets (CSS, JS, images)
├── static/scss/        # SCSS source files
└── docker-compose.yml  # Docker services
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| app | 3000 | Trinket web application |
| mongodb | 17017 | MongoDB database |
| redis | 16379 | Redis (optional - uses in-memory fallback if disabled) |

These are the services `docker-compose.yml` defines. The repository's only nginx is the serverside reverse proxy, published on 8080 - see [serverside/README.md](serverside/README.md); the root Compose file has no HTTPS proxy and no 443 listener.

## Troubleshooting

### CSS not loading?

A 404 for `/css/base.css` under Compose means the checkout has no generated stylesheets, because that is where the bind mount makes the application look. Build them into the checkout:
```bash
npm run build
```

Use `npm run build` rather than `npm run build:css` on a fresh clone - it fetches the frontend components first, which is what the SCSS compile needs. With no Node on the host, `docker run --rm -v "$PWD":/app -w /app node:22-bookworm sh -c 'npm ci && npm run build'` does the same job. It is not a command for the `app` container, which has no `vite` - see [Building CSS](#building-css). No restart is required either way: the files are read from disk per request.

### Container won't start?

Check logs:
```bash
docker compose logs app
```

### Need to rebuild the container?

```bash
docker compose build app
docker compose up -d
```

---

# Configuration

Trinket is configured via YAML files in the `config/` directory.

| File | Purpose |
|------|---------|
| `default.yaml` | Base configuration (committed) |
| `local.yaml` | Local overrides (gitignored) |
| `production.yaml` | Production overrides (gitignored) |

Create `config/local.yaml` to override settings:

```yaml
app:
  plugins:
    session:
      cookieOptions:
        password: 'replace-me-with-a-32-character-minimum-secret'
```

Production requires a real secret and refuses to start without one, while development and test generate an ephemeral secret when none is set - so sessions there do not survive a restart until you set your own.

The placeholder above is 45 characters, and its length is the point: the guard rejects anything shorter than 32, so a 31-character example copied verbatim would make a production process exit 1 at startup. Generate a real one rather than editing the placeholder:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Email (SMTP)

Email is required for password reset and notifications. Configure any SMTP provider:

```yaml
app:
  mail:
    from: 'noreply@example.com'
    host: 'smtp.example.com'
    port: 587
    user: 'your-smtp-username'
    pass: 'your-smtp-password'
    secure: false  # true for port 465
```

Common providers:

**Mailgun:**
```yaml
app:
  mail:
    from: 'noreply@your-domain.com'
    host: 'smtp.mailgun.org'
    port: 587
    user: 'postmaster@your-domain.com'
    pass: 'your-mailgun-smtp-password'
```

**SendGrid:**
```yaml
app:
  mail:
    from: 'noreply@example.com'
    host: 'smtp.sendgrid.net'
    port: 587
    user: 'apikey'
    pass: 'your-sendgrid-api-key'
```

Without email configured, password reset won't work. Users can still register, log in, and use all coding features.

## File Storage (AWS S3)

S3 is required for user-uploaded assets (images in trinkets). Without it, the asset upload feature is disabled.

```yaml
features:
  assets: true

aws:
  keyId: 'AKIAIOSFODNN7EXAMPLE'
  key: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
  region: 'us-east-1'
  buckets:
    userassets:
      name: 'my-trinket-assets'
      host: 'https://my-trinket-assets.s3.amazonaws.com'
```

S3-compatible storage (MinIO, DigitalOcean Spaces) is not supported. `config/aws.js` forwards only `accessKeyId`, `secretAccessKey` and `region` to `AWS.config.update`, and every S3 client is constructed with no options - `new aws.S3()` in `lib/util/file.js`. An `endpoint` key in configuration is read by nothing and silently ignored, so uploads still go to AWS.

## Server-Side Languages

Python 3, Java, R, and Pygame require backend services. See [serverside/README.md](serverside/README.md) for setup.

Quick start:
```bash
cd serverside
docker compose --profile python3 up --build
```

Enable in config:
```yaml
features:
  trinkets:
    python3: true
    java: true
    R: true
    pygame: true

app:
  serverside:
    python3:
      api:
        default: 'http://localhost:8080/python3'
```

## Google OAuth

Allow users to sign in with Google:

1. Create OAuth credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Add authorized redirect URI: `https://your-domain.com/auth/google/callback`
3. Configure:

```yaml
app:
  auth:
    google:
      clientID: 'your-google-client-id.apps.googleusercontent.com'
      clientSecret: 'your-google-client-secret'
```

## reCAPTCHA

Protect forms from spam:

1. Get keys at [Google reCAPTCHA](https://www.google.com/recaptcha/admin)
2. Choose reCAPTCHA v2 "I'm not a robot"
3. Configure:

```yaml
app:
  recaptcha:
    sitekey: 'your-site-key'
    secretkey: 'your-secret-key'
```

## Branding

Customize the site appearance:

```yaml
app:
  siteName: 'My Code School'
  logo: '/img/my-logo.png'
  logoIcon: '/img/my-logo-icon.png'
  supportEmail: 'support@example.com'
```

Place logo files in `public/img/`.

## Feature Flags

Enable/disable trinket types:

```yaml
features:
  trinkets:
    python: true      # Skulpt (browser-based)
    python3: false    # Server-side
    pygame: false     # Server-side
    html: true        # Browser-based
    java: false       # Server-side
    R: false          # Server-side
    glowscript: true  # Browser-based (3D)
    blocks: false     # Visual blocks
    music: false      # EarSketch
```

Other features:
```yaml
features:
  courses: true              # Course/LMS features
  assets: false              # File uploads (requires S3)
  accessibilityToggle: false # Show accessibility toggle
```

## Redis (Optional)

Redis is **completely optional**. When disabled, the application uses an in-memory store for caching. This works fine for development and small deployments.

For production with multiple app instances or better performance, enable Redis:

```yaml
db:
  redis:
    enabled: true
    app:
      host: 'localhost'
      port: 6379
      pass: ''
```

Without Redis, cache data is lost on restart and not shared between instances.

## Production Checklist

- [ ] Set strong session cookie password (32+ chars)
- [ ] Configure email for password reset
- [ ] Set up HTTPS (required for secure cookies)
- [ ] Configure `app.url` to match your domain
- [ ] Review feature flags
