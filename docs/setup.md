# Setup

This guide walks through the prerequisites, configuration, and commands needed to run Trinket locally or in production.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- Git
- Node.js 22 LTS and **npm 10** (only required for local development without Docker). `package.json` `engines`
  declares `node >=22.12.0 <23.0.0` and `npm >=10.0.0 <11.0.0`, and its `packageManager` field names the exact
  release the committed lockfile and the container image are built with, `npm@10.9.9`. Node 22.23.2 ships npm 10.9.8,
  so a stock Node 22 LTS install satisfies both ranges without touching its package manager. `.npmrc` sets
  `engine-strict=true`, so those ranges are enforced rather than advisory: an npm outside them makes `npm ci` **fail**
  with `EBADENGINE`, naming both the required and the actual version. That is the reproducibility pin working as
  intended. If a checkout defaults to npm 11, move it onto the pinned release rather than widening the range:

  ```bash
  corepack enable npm && corepack use npm@10.9.9
  # or
  npm install -g npm@10.9.9
  ```
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

`config/local.yaml` is gitignored, so it is never present on a fresh clone and it is never recoverable from
git. Nothing in [Running without Docker](#running-without-docker) deletes it; the one command in this
repository that does is `git clean -xfd`, which is confined to
[Verifying a clean-clone install](#verifying-a-clean-clone-install-destructive-read-first).

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
| `db.redis.*` | Redis application cache and background queues (in-memory fallback otherwise) |
| `features.trinkets.*` | Feature flags to enable/disable trinket languages |

Without email configured, password reset is unavailable but users can still register, log in, and use all coding features. Without S3, the asset upload feature is disabled.

**Redis is not the session store.** Sessions are iron-sealed cookies issued by Hapi's Yar plugin and stored
server-side in **MongoDB**: `app.js` registers a `sessions` cache whose engine is the in-repo
`lib/util/catbox-mongoose.js`, and Yar is configured against that cache. Redis backs the application cache and the
background queues only, so setting `db.redis.enabled: false` does not sign anyone out - `lib/util/store.js` falls
back to its own `InMemoryClient` and the stores under `lib/util/store/` keep working unchanged. The one required
setting above, `app.plugins.session.cookieOptions.password`, is the session cookie's seal, not a Redis credential.

## Running without Docker

The steps below can be run start to finish exactly as written, on a fresh clone or on a checkout you have
already been working in. None of them deletes anything you have not committed. In particular there is
deliberately **no `git clean -xfd` here**: `npm ci` removes and recreates `node_modules` by itself, and the
`public/components/` hydration in step 3 is idempotent, so nothing in the normal path needs a destructive
clean. If you specifically want to prove that a checkout builds from nothing, use
[Verifying a clean-clone install](#verifying-a-clean-clone-install-destructive-read-first) instead, and read
its warning first.

1. Select the pinned Node version:
   ```bash
   nvm use   # selects Node 22 LTS from .nvmrc
   ```

   `.npmrc` sets `engine-strict=true`, so `npm ci` refuses to run on any other Node major, and on any npm major
   other than 10.

2. Install dependencies from the committed lockfile:
   ```bash
   npm ci                  # when your npm is 10.x, which Node 22 LTS ships
   npx -y npm@10.9.9 ci    # when your default npm is 11.x
   ```

   `npm ci` installs strictly from `package-lock.json` (lockfileVersion 3), which is what keeps the install
   reproducible. It also removes and recreates `node_modules` on its own, so no manual cleaning step is needed
   before it.

3. Build the stylesheets:
   ```bash
   npm run build
   ```

   `npm run build` is `vite build` and nothing more, so on a clean checkout it must be preceded ONCE by the
   component hydration documented in `COMPONENTS.md`: `static/scss/base.scss` and
   `static/scss/embed/embed.scss` both `@import "public/components/foundation/scss/foundation"`, and the
   gitignored `public/components/` tree comes from the 166,464,007-byte `v1.1.0` release asset - the same
   one the Docker build downloads. Verify the archive against the SHA-256 digest recorded there before
   unpacking it. The step only has to be repeated after `git clean -xfd`. See `COMPONENTS.md` for the
   procedure and the full component inventory.

   The build emits exactly two artifacts, `public/css/base.css` and `public/css/embed.css`. It also prints
   435+ Sass deprecation warnings from the vendored Foundation fork; those warnings are expected and
   tolerated.

4. Write the local configuration. `config/local.yaml` is gitignored, so a fresh clone never has one and you
   have to create it here:
   ```bash
   cp config/local.example.yaml config/local.yaml
   ```

   Then replace the placeholder `app.plugins.session.cookieOptions.password` with a real secret of at least
   32 characters. `app.js` checks that length at startup and calls `process.exit(1)` when the value is
   missing or shorter, so the application will not run without it. For a non-Docker run also change
   `db.mongo.host` from `mongodb` to `localhost`, which is the host the next step starts MongoDB on.

5. Start MongoDB locally (Redis is optional).

6. Run the application:
   ```bash
   node app.js
   ```

## Verifying a clean-clone install (destructive: read first)

You do **not** need this for normal development. It exists for one purpose: proving that a checkout installs and
builds from nothing but the committed lockfile, which is what CI and release verification check.

> ⚠️ **`git clean -xfd` permanently deletes every untracked and ignored file in the working tree, with no
> recovery.** In this repository that includes, measured against the current `.gitignore`:
>
> - `config/local.yaml` - **your session secret and local credentials.** The application calls `process.exit(1)`
>   at startup without it, and it is not recoverable from git because it is gitignored by design.
> - `config/runtime.json` - node-config's runtime state.
> - `public/components/` - the **166,464,007-byte** hydrated component tree, and `public/vendor/` if present. Both
>   have to be downloaded again, which is the slowest step in the whole setup.
> - `node_modules/`.
> - `public/css/base.css` and `public/css/embed.css` - the build output.
>
> Run it **only** in a clone you are willing to lose - a scratch clone or a CI workspace - and **never** in a
> working tree that holds configuration or work you have not committed.

Always preview first. `-n` is a dry run that lists what would be deleted and changes nothing:

```bash
git clean -xfdn
```

Read that list. If it names anything you want to keep, stop: copy `config/local.yaml` somewhere outside the
repository, or do this in a fresh clone instead. Only when the list is acceptable:

```bash
git clean -xfd && npm ci
```

`npm ci` rebuilds `node_modules` on its own. Two things the clean removes are **not** restored by any script, and
both have to be put back by hand before `npm run build` and `node app.js` will work:

- `public/components/` - re-hydrate it with the `curl`, checksum and `tar` procedure in `COMPONENTS.md`.
  `npm run build` is `vite build` and nothing more; it does not fetch anything, and without the tree Sass fails
  with `Can't find stylesheet to import`.
- `config/local.yaml` - re-copy `config/local.example.yaml` to it and fill in the session secret, as in step 4
  above.

Only then does the rest of the chain run:

```bash
npm run build && npm test
```

## Running Tests

```bash
npm test
```

`npm test` exits 0 with zero failures, with Mocha's `--check-leaks` active throughout. Four groups of base-commit
expectations contradict production code this modernization is forbidden to touch; at each of those sites **both**
readings are asserted — the value the application produces, and the base commit's own expression at its measured
value — so no assertion was weakened. Every one is enumerated, with the measurement behind it, in
[Preserved Quirks](PRESERVED-QUIRKS.md) section 0.1.

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
