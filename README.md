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

- Docker and Docker Compose
- Node.js 22 LTS and **npm 10** (for local development without Docker) - `.nvmrc` pins Node, so `nvm use` selects it;
  `package.json` `engines` declares `node >=22.12.0 <23.0.0` and `npm >=10.0.0 <11.0.0`, and its `packageManager` field
  names the exact release the lockfile and the container image are built with, `npm@10.9.9`. Node 22.23.2 ships
  npm 10.9.8, so a stock Node 22 LTS install already satisfies both ranges. `.npmrc` sets `engine-strict=true`, which
  makes those ranges an enforced gate rather than advice: a Node or npm outside them makes `npm ci` **fail** with
  `EBADENGINE` rather than warn. If your checkout defaults to npm 11, switch the toolchain rather than relaxing the
  range - `corepack enable npm && corepack use npm@10.9.9`, or `npm install -g npm@10.9.9`
  Only install operations enforce `engines`, so `npm run build` and `npm test` run under any npm; to avoid changing a
  global toolchain, run the install step through the pinned release instead - `npx -y npm@10.9.9 ci`, the exact npm the
  Docker image installs
- MongoDB 5.0+
- Redis (optional - falls back to in-memory)

## Quick Start (Docker)

1. Clone the repository:
   ```bash
   git clone https://github.com/trinketapp/trinket-oss.git
   cd trinket-oss
   ```

2. Copy the example config and add your settings:
   ```bash
   cp config/local.example.yaml config/local.yaml
   ```

3. Start the services:
   ```bash
   docker-compose up
   ```

4. Visit http://localhost:3000 in your browser.

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
   nvm use   # selects Node 22 LTS from .nvmrc
   npm ci
   ```

2. Build the stylesheets:
   ```bash
   npm run build
   ```

   `npm run build` is `vite build` and nothing more, so on a clean checkout it must be preceded ONCE by
   hydrating the gitignored `public/components` tree from the pinned `public-components.tgz` release asset -
   the same archive the Docker build downloads. The `curl`, checksum and `tar` procedure is in
   [COMPONENTS.md](COMPONENTS.md), and it only has to be repeated after `git clean -xfd`.

3. Write `config/local.yaml` and set a session secret of at least 32 characters. It is gitignored, so
   `git clean -xfd` deletes it and `app.js` then exits at startup - copy it again after any clean:
   ```bash
   cp config/local.example.yaml config/local.yaml
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
