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

- Docker and Docker Compose - the commands below use the Compose plugin (`docker compose`), not the standalone `docker-compose` script
- Node.js 22 LTS with npm 10 (for local development without Docker). The requirement is the version, not any particular version manager: `package.json` declares `node >=22.0.0 <23.0.0` and `npm >=10.0.0 <11.0.0`, and `.nvmrc` contains `22`. If you use nvm, `nvm use 22` selects it; if you do not, install Node 22 however your platform prefers - `node -v` and `npm -v` are the whole of the check
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

3. Build the stylesheets into the checkout:
   ```bash
   npm ci && npm run build
   # or instead of that line, with no Node on the host, run the same build
   # in a Node 22 container:
   docker run --rm -v "$PWD":/app -w /app node:22-bookworm sh -c 'npm ci && npm run build'
   ```

   `docker-compose.yml` mounts the checkout over the application directory, so `/css/base.css` and `/css/embed.css` are served from `public/css/` in the checkout rather than from the copies the image built. Both are generated and gitignored, so on a fresh clone they are absent and those two requests answer 404 until this step has run. The build has to happen outside the `app` container: the shipped image installs production dependencies only, so `vite` and `sass` are not in it and `npm run build:css` there answers `vite: not found`. See [GETTING_STARTED.md](GETTING_STARTED.md) for the detail.

4. Start the services:
   ```bash
   docker compose up
   ```

5. Visit http://localhost:3000 in your browser.

## Configuration

Configuration is managed through YAML files in the `config/` directory:

- `default.yaml` - Base configuration (committed to repo)
- `local.yaml` - Local overrides and secrets (not committed)
- `production.yaml` - Production overrides (not committed)

Copy `config/local.example.yaml` to `config/local.yaml` and fill in the required values. **One value in that file is Compose-specific**: it ships `db.mongo.host: mongodb`, which is the service name inside the Compose network. Running the application directly on the host, set it to `localhost` — the example file carries the same note inline against that key (**measured**: `config/local.example.yaml:29`).

### Required Configuration

| Setting | Description |
|---------|-------------|
| `app.plugins.session.cookieOptions.password` | Session cookie secret (min 32 chars) |

Production requires a real secret and refuses to start without one. Development and test generate an ephemeral secret when none is set, so sessions there do not survive a restart until you set your own.

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

1. Install dependencies:
   ```bash
   npm ci
   ```

2. Build the frontend assets:
   ```bash
   npm run build
   ```

   The frontend components are not committed - they live in the gitignored `public/components/` and are distributed separately as `public-components.tgz`, so without them the SCSS build fails at `static/scss/_settings.scss:8`. `npm run build` retrieves and verifies them before compiling the CSS; `npm run fetch-components` retrieves them on their own. On a clean checkout the two commands above exit 0 and write `public/css/base.css` and `public/css/embed.css`; the SCSS compile prints 58 Sass deprecation notices from the vendored Foundation tree along the way, followed by two `WARNING: 435 repetitive deprecation warnings omitted` summaries, all of which are expected.

3. Start MongoDB locally (Redis is optional)

4. Run the application:
   ```bash
   node app.js
   ```

### Running Tests

```bash
npm test
```

The suite provisions its own MongoDB instance, so a local MongoDB is not needed to run the tests.

## Architecture

- **Backend**: Node.js with Hapi framework
- **Database**: MongoDB with Mongoose ODM
- **Cache/Sessions**: Redis (optional)
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
