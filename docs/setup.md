# Setup

This guide walks through the prerequisites, configuration, and commands needed to run Trinket locally or in production.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose **v2** - every command **in this guide and in
  the [README](https://github.com/trinketapp/trinket-oss#readme)** uses the `docker compose` subcommand, because the
  standalone Compose v1 `docker-compose` binary is end-of-life. The claim is scoped to those two documents on
  purpose: `GETTING_STARTED.md`, `CONTRIBUTING.md`, the comments in `test/smoke-test.sh` and `serverside/README.md`
  still use the v1 spelling, and they sit outside the scope of the modernization that rewrote this guide, so they
  were left alone rather than edited in passing. On a v2-only host, read `docker-compose x` in those files as
  `docker compose x`.
- Git
- Node.js 22 LTS and **npm 10** (only required for local development without Docker). `package.json` `engines`
  declares `node >=22.12.0 <23.0.0` and `npm >=10.0.0 <11.0.0`, and its `packageManager` field names the exact
  release the committed lockfile and the container image are built with, `npm@10.9.9`. Node 22.23.2 ships npm 10.9.8,
  so a stock Node 22 LTS install satisfies both ranges without touching its package manager - check with
  `node --version && npm --version` before installing anything. `.npmrc` sets
  `engine-strict=true`, so those ranges are enforced rather than advisory: an npm outside them makes `npm ci` **fail**
  with `EBADENGINE`, naming both the required and the actual version. That is the reproducibility pin working as
  intended. If a checkout defaults to npm 11, move it onto the pinned release rather than widening the range:

  ```bash
  corepack enable npm && corepack prepare npm@10.9.9 --activate
  # or
  npm install -g npm@10.9.9
  ```

  `corepack prepare --activate` is the recommended form and `corepack use` is deliberately not: corepack 0.34.6
  documents that `corepack use <pattern>` "will retrieve the latest release matching the provided descriptor, assign it
  to the project's package.json file, and automatically perform an install" - so it would both rewrite the committed
  `packageManager` value and run an install of its own, ahead of the lockfile-only `npm ci` below. `prepare` fetches and
  activates the named release and does neither.

  Measured on this tree: `engines` is enforced by install operations only, so `npm run build` and `npm test` work under
  any npm, while `npm ci` under npm 11 is refused with `EBADENGINE`. To avoid changing a global toolchain, run the
  install step through the pinned release instead - `npx -y npm@10.9.9 ci`, the exact release the Docker image pins.
- **nvm is optional.** `.nvmrc` pins the Node major so `nvm use` selects it if you manage several Node versions; on a
  machine whose system Node is already 22.x, nvm is not required and every command in this guide works without it.
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

3. **Generate a session secret and replace the placeholder, before starting anything.** `config/local.example.yaml`
   ships `REPLACE_ME`, which is deliberately too short: `app.js`'s startup guard requires at least 32 characters, so
   the application **refuses to boot** until you replace it. That is intentional - a secret should fail closed. An
   earlier revision shipped a 46-character placeholder that *satisfied* the guard, so copying the template verbatim
   produced a running server whose session cookies were sealed with a password published in this repository; since
   `docker compose` publishes the app on `0.0.0.0:3000`, anyone who could reach the port could mint and forge
   `session` cookies with a secret they already had (review finding SV-36). Generate your own:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```
   Write the output into `config/local.yaml` under `app.plugins.session.cookieOptions.password`, then verify:
   ```bash
   grep -q 'REPLACE_ME' config/local.yaml \
     && echo 'WILL NOT START: session secret is still the placeholder' \
     || echo 'session secret replaced'
   ```

   You do not have to rely on that check: `REPLACE_ME` is shorter than the 32 characters `app.js` requires, so leaving
   it in place makes the application exit 1 with `ERROR: Session cookie password not configured!` rather than start
   insecurely. The **guard** in `app.js` is unchanged - it still tests length and nothing else, which is the base
   commit's observable startup contract. Only the template moved, and that is safe because `config/local.example.yaml`
   is not a configuration layer at all: node-config's `baseNames` do not include `local.example`, so no resolved value
   depends on it. See `docs/PRESERVED-QUIRKS.md`.

4. Start the services:
   ```bash
   docker compose up
   ```

   Wait until you see `Server started on port:` in the logs.

   That single command is the whole Docker setup: neither the component hydration nor the stylesheet build
   described under [Running without Docker](#running-without-docker) has to be repeated by hand, because
   the image build performs both. Compose has no image on a clean clone, so it builds one, and that build
   downloads the pinned `public-components.tgz` release asset, **verifies its SHA-256 before unpacking**,
   installs from the committed lockfile with `npm ci`, runs `npm run build`, and then **fails** unless
   `public/css/base.css` and `public/css/embed.css` match the byte counts and digests recorded in
   `test/baseline/responses.json`. Both stylesheets are gitignored, so a clean clone has neither until then
   - which is why the image, rather than the host, is what produces them.

   `public/css` is published through a named volume, because the `.:/usr/local/node/trinket` bind mount
   would otherwise hide the copies the image built; `node_modules` and `public/components` are handled the
   same way. All three are initialized once from the image, so after changing `static/scss/**` or the
   component release, recreate **the one volume that carries the output** to publish it:

   ```bash
   docker compose down                                                  # keeps every volume
   docker volume rm "${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}_public_css"
   docker compose up --build
   ```

   > ⚠️ **`docker compose down -v` is not the command for this, and using it destroys data.** `-v`
   > removes **every** volume the project declares, and `docker-compose.yml` declares `mongodb_data` -
   > the MongoDB data directory - alongside `public_css`, `public_components`, `node_modules` and
   > `shared-cache`. Using it to refresh two stylesheets deletes the whole development database (users,
   > courses, trinkets, sessions) with no prompt and no recovery. Name only `public_css`. Compose
   > prefixes volume names with the project name, which defaults to the directory name; the command
   > above derives it and `docker volume ls` confirms it. If a full reset *is* what you want, take a
   > backup first with `docker compose exec mongodb mongodump --archive=/tmp/dump` and copy it out with
   > `docker compose cp mongodb:/tmp/dump ./dump`.

5. Open **http://localhost:3000** in your browser.

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

Without email configured, password reset is unavailable but users can still register, log in, and use all coding
features. Without S3, the asset upload feature is disabled.

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

1. Confirm you are on the pinned Node version:
   ```bash
   node --version        # must report v22.x
   nvm use               # OPTIONAL: only if you manage Node with nvm; selects 22 from .nvmrc
   ```

   `.npmrc` sets `engine-strict=true`, so `npm ci` refuses to run on any other Node major, and on any npm major
   other than 10. If `node --version` already reports v22.x, nvm is not needed and the second line can be skipped -
   nvm is not a prerequisite of this guide.

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

   That single command is enough on a clean checkout, because `package.json` declares a `prebuild` script -
   `node scripts/hydrate-components.js` - which npm runs before `build`. `static/scss/base.scss` and
   `static/scss/embed/embed.scss` both `@import "public/components/foundation/scss/foundation"`, and the
   gitignored `public/components/` tree comes from the 166,464,007-byte `v1.1.0` release asset - the same
   one the Docker build downloads. The script pins the release tag and checks the download against **both**
   the recorded byte length and the recorded SHA-256 digest before unpacking anything, so a re-cut release or
   a truncated transfer fails loudly rather than producing different stylesheets. It is idempotent: with the
   tree already present it exits 0 without touching the network. Set `TRINKET_COMPONENTS_TARBALL` to a local
   copy of the archive to hydrate without network access. `npm run build:css` and `npm run watch:css` invoke
   Vite directly and do **not** carry the hook, so they assume the tree is already there. See `COMPONENTS.md`
   for the equivalent manual procedure and the full component inventory.

   The build emits exactly two artifacts, `public/css/base.css` and `public/css/embed.css`. It also prints
   435+ Sass deprecation warnings from the vendored Foundation fork; those warnings are expected and
   tolerated.

4. Write the local configuration. `config/local.yaml` is gitignored, so a fresh clone never has one and you
   have to create it here:
   ```bash
   cp config/local.example.yaml config/local.yaml
   ```

   Then replace the placeholder `app.plugins.session.cookieOptions.password` with a real secret:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

   `app.js` checks the **length** at startup and calls `process.exit(1)` when the value is missing or shorter than
   32 characters, and the shipped placeholder is `REPLACE_ME` - **10 characters, so it fails that check and the
   application refuses to boot until you replace it.** That is deliberate: a secret that is public should fail closed
   rather than seal real cookies. An earlier revision shipped a 46-character placeholder that *satisfied* the guard,
   which meant copying the template verbatim produced a running server whose session cookies were sealed with a
   password published in this repository (review finding SV-36). For a
   non-Docker run also change `db.mongo.host` from `mongodb` to `localhost`, which is the host the next step starts
   MongoDB on.

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

`npm ci` rebuilds `node_modules` on its own, and `npm run build`'s `prebuild` hook re-hydrates
`public/components/` on its own. Exactly one thing the clean removes is **not** restored by any script, and it has
to be put back by hand before `npm run build` and `node app.js` will work:

- `config/local.yaml` - re-copy `config/local.example.yaml` to it and fill in the session secret, as in step 4
  above. It is gitignored, so git cannot restore it, and `app.js` calls `process.exit(1)` when the session
  password is shorter than 32 characters.

`public/components/` needs no manual step: `node scripts/hydrate-components.js` runs before `build`, re-downloads
the pinned `v1.1.0` asset, and verifies its byte length and SHA-256 before unpacking. `COMPONENTS.md` documents the
equivalent `curl`, checksum and `tar` procedure for doing it by hand, and `TRINKET_COMPONENTS_TARBALL` hydrates
from a local copy when there is no network.

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

### Replaying the baseline parity corpus

`npm test` covers the suite. The separate parity evidence — the 233-row route table and the captured response corpus
that prove the migrated server answers exactly as the base commit's did — is replayed with:

```bash
NODE_CONFIG='{"app":{"url":{"protocol":"https","hostname":"trinket.dev","port":null}}}' node test/baseline/replay.js
```

It boots the application on its own port (`30112`, or `30112 + CLONE_INDEX`, overridable with `BASELINE_PORT`),
against its own disposable database (`test_baseline[_<CLONE_INDEX>]`, overridable with `BASELINE_MONGO_DATABASE`),
issues real HTTP requests, and exits **0** printing `0 differences`.

**The `NODE_CONFIG` prefix is a precondition, not decoration.** The corpus was captured under the production origin
`https://trinket.dev`, and every absolute `Location` header and rendered body in it carries that origin. So the
harness compares the origin this process is configured for against the one recorded in the artifact, and if they
differ it **refuses to run** — exit **2**, naming both origins and printing the remedy above. It deliberately does
not supply the origin for you: an injected origin would let a build that emits the wrong one replay clean, which
would make the evidence worthless.

You will hit that refusal on any working checkout, because step 4 above copies `config/local.example.yaml`, which
sets `app.url` to your local address. Two ways past it, in order of preference:

1. Prefix the command with the `NODE_CONFIG` above. This changes nothing on disk and is what CI does.
2. Remove the `app.url` block from your `config/local.yaml` for the duration of the run.

Do **not** edit `config/default.yaml` or `config/test.yaml` to work around it: those files are part of the frozen
surface this modernization preserves, and `config/test.yaml`'s `start: false` in particular is what the existing
suite depends on. The exit codes are worth knowing: `0` means parity, `1` means a genuine difference against the
baseline — an application-code defect to report, never something to normalize away — and `2` means the run could not
be made, as with the origin mismatch above. `node test/baseline/capture.js --dry-run` performs the same comparison
from the capture side and writes nothing.

## Services

`docker compose config --services` reports exactly three: `app`, `mongodb` and `redis`.

| Service | Port | Bound on | Description |
|---------|------|----------|-------------|
| app | 3000 | all interfaces | Trinket web application |
| mongodb | 17017 | `127.0.0.1` only | MongoDB database |
| redis | 16379 | `127.0.0.1` only | Redis (optional - uses in-memory fallback if disabled) |

An earlier revision of this table carried a fourth row, `nginx | 443 | HTTPS proxy (optional)`. **`docker-compose.yml`
defines no `nginx` service and nothing in it publishes 443**, so that row has been removed rather than left to be read
as an available service. That row was byte-identical to the base commit's, so the discrepancy is pre-existing rather
than introduced here; terminating TLS in front of the app is still a perfectly reasonable deployment choice, but it is
not something this repository's Compose file provides.

The two datastore ports are published to the loopback interface only. They previously bound every interface, which put
both datastores on the whole network with no authentication in front of either: **MongoDB holds every user record
*and*, because `app.js` registers the `sessions` cache against the in-repo `lib/util/catbox-mongoose.js` engine, every
server-side session record — so read access to MongoDB alone is an authentication bypass** — while Redis exposes the
application cache and the background job queues (review finding SV-28). Redis is **not** the session store; see
*Optional Services* above. The port
*numbers* are unchanged, so `mongosh --port 17017` and `redis-cli -p 16379` still work from the host exactly as before,
and the application is unaffected either way because it reaches both services by their compose service names
(`mongodb:27017`, `redis:6379`) over the internal bridge network rather than through the published ports.

Reaching either datastore from another machine is therefore deliberately no longer possible without an explicit change.
If you need that, add authentication first — `requirepass` for Redis and a SCRAM user for MongoDB — rather than
re-widening the binding on its own.

## Creating an Admin User

After registering a user through the web interface, promote them to admin:

```bash
docker compose exec app npm run make-admin user@example.com
```

Admin users can access `/admin` for site administration features.
