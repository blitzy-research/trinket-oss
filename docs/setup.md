# Setup

This guide walks through the prerequisites, configuration, and commands needed to run Trinket locally or in production.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Git
- Node.js 22 LTS and npm 10+ (only required for local development without Docker)
- MongoDB 5.0+ (runs inside Docker by default)
- Redis (optional - falls back to in-memory store when disabled)

When using the Docker workflow, Docker and Git are all you need - everything else runs inside containers.

## Quick Start (Docker)

1. Clone the repository:
   ```bash
   git clone https://github.com/trinketapp/trinket-oss.git
   cd trinket-oss
   ```

2. Copy the example local config:
   ```bash
   cp config/local.example.yaml config/local.yaml
   ```

3. Start the services:
   ```bash
   docker-compose up
   ```

   Wait until you see `Server started on port:` in the logs.

4. Open **http://localhost:3000** in your browser.

## Configuration

Configuration is managed through YAML files in the `config/` directory:

| File | Purpose |
|------|---------|
| `default.yaml` | Base configuration (committed to repo) |
| `local.yaml` | Local overrides and secrets (gitignored) |
| `production.yaml` | Production overrides (gitignored) |

Copy `config/local.example.yaml` to `config/local.yaml` and fill in the required values.

### Required Configuration

| Setting | Description |
|---------|-------------|
| `app.plugins.session.cookieOptions.password` | Session cookie secret (min 32 chars) |

### Optional Integrations

| Setting | Description |
|---------|-------------|
| `app.mail.*` | SMTP settings for email (password reset, notifications) |
| `aws.*` | S3 (or S3-compatible) storage for user-uploaded assets |
| `app.auth.google.*` | Google OAuth login |
| `app.recaptcha.*` | reCAPTCHA spam protection |
| `db.redis.*` | Redis cache/session store (in-memory fallback otherwise) |
| `features.trinkets.*` | Feature flags to enable/disable trinket languages |

Without email configured, password reset is unavailable but users can still register, log in, and use all coding features. Without S3, the asset upload feature is disabled.

## Running without Docker

1. Select the Node version:
   ```bash
   nvm use   # selects Node 22 LTS from .nvmrc
   ```

   `.npmrc` sets `engine-strict=true`, so `npm ci` refuses to run on any other Node major. The canonical clean
   install is `nvm use 22` followed by `git clean -xfd && npm ci`.

2. Install dependencies from the committed lockfile:
   ```bash
   npm ci
   ```

   `npm ci` installs strictly from `package-lock.json` (lockfileVersion 3), which is what keeps the install
   reproducible.

3. Fetch the frontend components:
   ```bash
   curl -L --silent -o ./public-components.tgz \
     https://github.com/trinketapp/trinket-oss/releases/download/v1.1.0/public-components.tgz \
     && tar xzf public-components.tgz \
     && rm public-components.tgz
   ```

   `public/components/` is gitignored, so a fresh clone has to unpack this 166,464,007-byte `v1.1.0` release
   asset - the same one the Docker build downloads - before `npm run build` can resolve the Foundation
   stylesheets it imports. See `COMPONENTS.md` for the full component inventory.

4. Build the stylesheets:
   ```bash
   npm run build
   ```

   This emits exactly two artifacts, `public/css/base.css` and `public/css/embed.css`. It also prints 435+ Sass
   deprecation warnings from the vendored Foundation fork; those warnings are expected and tolerated.

5. Start MongoDB locally (Redis is optional).

6. Run the application:
   ```bash
   node app.js
   ```

## Running Tests

```bash
npm test
```

## Services

| Service | Port | Description |
|---------|------|-------------|
| app | 3000 | Trinket web application |
| mongodb | 17017 | MongoDB database |
| redis | 16379 | Redis (optional - uses in-memory fallback if disabled) |
| nginx | 443 | HTTPS proxy (optional) |

## Creating an Admin User

After registering a user through the web interface, promote them to admin:

```bash
docker-compose exec app npm run make-admin user@example.com
```

Admin users can access `/admin` for site administration features.
