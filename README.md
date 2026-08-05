# Trinket

An open source, browser-based coding environment designed for education.

Trinket lets students and educators write and run code directly in the browser, supporting multiple programming languages including Python, HTML, Java, R, and more.

## Features

- **Browser-based code editor** - Write and run code without installing anything
- **Multiple language support** - Python, HTML/CSS/JS, Java, R, GlowScript, and more
- **Embeddable trinkets** - Embed interactive code examples in any webpage
- **Course creation** - Build interactive coding courses and tutorials
- **Code sharing** - Share and remix code with others

## Prerequisites

- Docker and Docker Compose v2. **Every command in this README and in [docs/setup.md](docs/setup.md) uses the
  `docker compose` subcommand**, because the standalone `docker-compose` v1 binary is end-of-life. That is a statement
  about this workflow, not about the whole repository: `GETTING_STARTED.md`, `CONTRIBUTING.md` and
  `test/smoke-test.sh`'s comments still spell it `docker-compose`, and `serverside/README.md` documents its own
  separate stack the same way. Those files are outside the scope of the Node 22 modernization that rewrote this one,
  so they are left as they are rather than edited in passing; on a v2-only host, read `docker-compose x` there as
  `docker compose x`.
- Node.js 22 LTS and **npm 10** (for local development without Docker). `package.json` `engines` declares
  `node >=22.12.0 <23.0.0` and `npm >=10.0.0 <11.0.0`, and its `packageManager` field names the exact release the
  lockfile and the container image are built with, `npm@10.9.9`. Node 22.23.2 ships npm 10.9.8, so a stock Node 22 LTS
  install already satisfies both ranges - check with `node --version && npm --version` before installing anything.
  `.npmrc` sets `engine-strict=true`, which makes those ranges an enforced gate rather than advice: a Node or npm
  outside them makes `npm ci` **fail** with `EBADENGINE` rather than warn. If your checkout defaults to npm 11, switch
  the toolchain rather than relaxing the range - `corepack enable npm && corepack prepare npm@10.9.9 --activate`, or
  `npm install -g npm@10.9.9`. (Use `corepack prepare --activate`, not `corepack use`: corepack 0.34.6 documents that
  `corepack use` also rewrites the committed `packageManager` value and performs an install of its own.)
  Only install operations enforce `engines`, so `npm run build` and `npm test` run under any npm; to avoid changing a
  global toolchain, run the install step through the pinned release instead - `npx -y npm@10.9.9 ci`, the exact npm the
  Docker image installs
- **nvm is optional.** `.nvmrc` pins the Node major, so `nvm use` selects it if you manage several Node versions. On a
  machine whose system Node is already 22.x - which `node --version` tells you - nvm is not needed and every command
  below works without it
- MongoDB 5.0+
- Redis (optional - falls back to in-memory)

## Quick Start (Docker)

1. Clone the repository:
   ```bash
   git clone https://github.com/trinketapp/trinket-oss.git
   cd trinket-oss
   ```

2. Copy the example config:
   ```bash
   cp config/local.example.yaml config/local.yaml
   ```

3. **Replace the session secret before starting anything.** `config/local.example.yaml` ships a placeholder
   (`change-this-to-a-secure-password-min-32-chars!`) that is published in this repository and is therefore public.
   `app.js` checks only that the value is at least 32 characters long, so the placeholder **starts the application
   successfully** - and `docker compose` publishes the app on `0.0.0.0:3000`, so anyone who can reach the port can
   forge session cookies with a secret they already know. Generate your own and write it in:
   ```bash
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```
   Put the output in `config/local.yaml` under `app.plugins.session.cookieOptions.password`, then confirm the
   placeholder is gone:
   ```bash
   grep -q 'change-this-to-a-secure-password' config/local.yaml \
     && echo 'REFUSING TO START: session secret is still the published placeholder' \
     || echo 'session secret replaced'
   ```

4. Start the services:
   ```bash
   docker compose up
   ```

   On a clean clone `docker compose up` is also what produces the stylesheets, so there is no
   separate hydration or build step to run by hand. Compose has no image yet, so it
   builds one, and the image build is the deterministic asset path: it downloads the pinned
   `public-components.tgz` release asset, **verifies its SHA-256 before unpacking it**, installs from the
   committed lockfile with `npm ci`, runs `npm run build`, and then **fails the build** unless
   `public/css/base.css` and `public/css/embed.css` match the byte counts and digests recorded in
   `test/baseline/responses.json`. Both stylesheets are gitignored, so a clean clone has neither until
   that build runs.

   Compose publishes `public/css` through a named volume, because the `.:/usr/local/node/trinket` bind
   mount would otherwise hide the copies the image built - the same arrangement `node_modules` and
   `public/components` already use. Like those two, the volume is initialized once, so after changing
   `static/scss/**` or the component release, recreate **that one volume** to publish the new output:

   ```bash
   docker compose down                                                  # keeps every volume
   docker volume rm "${COMPOSE_PROJECT_NAME:-$(basename "$PWD")}_public_css"
   docker compose up --build
   ```

   > ⚠️ **Do not reach for `docker compose down -v` here.** `-v` removes **every** volume this project
   > declares, and that includes `mongodb_data` - the MongoDB data directory. It would silently delete
   > your entire development database (users, courses, trinkets, sessions) to refresh two stylesheets,
   > with no prompt and no recovery. Only `public_css` needs recreating, so name only `public_css`.
   > Compose prefixes volume names with the project name, which defaults to the directory name; the
   > command above derives it, and `docker volume ls` confirms it. If you do intend a full reset, back
   > the database up first with `docker compose exec mongodb mongodump --archive=/tmp/dump` and copy it
   > out with `docker compose cp mongodb:/tmp/dump ./dump`.

5. Visit http://localhost:3000 in your browser.

## Configuration

Configuration is managed through YAML files in the `config/` directory:

- `default.yaml` - Base configuration (committed to repo)
- `local.yaml` - Local overrides and secrets (not committed)
- `production.yaml` - Production overrides (not committed)

Copy `config/local.example.yaml` to `config/local.yaml` and fill in the required values.

### Required Configuration

| Setting | Description |
|---------|-------------|
| `app.plugins.session.cookieOptions.password` | Session cookie secret (min 32 chars) |

### Optional Integrations

| Setting | Description |
|---------|-------------|
| `app.mail.*` | SMTP settings for email (password reset, notifications) |
| `aws.*` | S3 storage for user-uploaded assets |
| `app.auth.google.*` | Google OAuth login |
| `app.recaptcha.*` | reCAPTCHA spam protection |

See [GETTING_STARTED.md](GETTING_STARTED.md) for detailed setup of optional features.

## Development

### Running without Docker

1. Install dependencies from the committed lockfile:
   ```bash
   node --version        # must report v22.x - if it already does, skip the next line
   nvm use               # OPTIONAL: selects Node 22 LTS from .nvmrc when you use nvm
   npm ci
   ```

2. Build the stylesheets:
   ```bash
   npm run build
   ```

   That is enough on a clean checkout: `package.json` declares a `prebuild` script -
   `node scripts/hydrate-components.js` - which npm runs first and which hydrates the gitignored
   `public/components` tree from the pinned `public-components.tgz` release asset, the same archive the Docker
   build downloads. It verifies the download against both a recorded byte length and a recorded SHA-256 digest
   before unpacking, and it is idempotent, so re-running the build costs nothing. Set
   `TRINKET_COMPONENTS_TARBALL` to hydrate from a local copy without network access. The equivalent manual
   `curl`, checksum and `tar` procedure is in [COMPONENTS.md](COMPONENTS.md).

3. Write `config/local.yaml` and set your **own** session secret of at least 32 characters - never leave the
   published placeholder in place, for the reason given in step 3 of the Quick Start. `config/local.yaml` is
   gitignored, so `git clean -xfd` deletes it and `app.js` then exits at startup; recreate it after any clean:
   ```bash
   cp config/local.example.yaml config/local.yaml
   node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   # write that value into app.plugins.session.cookieOptions.password
   ```

4. Start MongoDB locally (Redis is optional)

5. Run the application:
   ```bash
   node app.js
   ```

### Running Tests

```bash
npm test
```

`npm test` exits 0 with zero failures, with Mocha's `--check-leaks` active throughout. Four groups of base-commit
expectations contradict production code this modernization is forbidden to touch; at each of those sites **both**
readings are asserted — the value the application produces, and the base commit's own expression at its measured value —
so nothing was weakened to get there. Each is enumerated with its measurement in `docs/PRESERVED-QUIRKS.md` section 0.1.

## Architecture

- **Backend**: Node.js 22 LTS with Hapi framework (@hapi/hapi 21.x)
- **Database**: MongoDB with Mongoose ODM
- **Sessions**: iron-sealed cookies via Hapi's Yar plugin, backed by **MongoDB** - `app.js` registers a `sessions`
  cache whose engine is the in-repo `lib/util/catbox-mongoose.js`, so sessions are stored server-side in MongoDB and
  turning Redis off does not sign anyone out
- **Application cache/queues**: Redis (optional) - `lib/util/store.js` falls back to an in-memory client when Redis
  is disabled
- **Frontend**: AngularJS 1.x
- **Code Execution**: Skulpt (Python in browser), server-side containers for other languages

## Contributing

Contributions are welcome! Please read our [Contributing Guidelines](CONTRIBUTING.md) before submitting a pull request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is released under CC0 1.0 Universal (Public Domain Dedication). See the [LICENSE](LICENSE) file for details.

## History

Trinket was originally created by Elliott Hauser and Brian Marks to make coding education accessible to everyone. It is now open source and maintained by the community.
