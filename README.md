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
- Node.js 22 LTS and npm 10 or 11 (for local development without Docker) - `.nvmrc` pins Node, so `nvm use` selects it,
  and `package.json` `engines` declares `node >=22.12.0 <23.0.0` with `npm >=10.0.0`. Node 22.23.2 ships npm 10.9.8, so
  a stock Node 22 LTS install already satisfies both; `.npmrc` sets `engine-strict=true`, so a Node outside that range
  makes `npm ci` fail rather than warn. The npm constraint carries no upper bound on purpose: with
  `engine-strict=true`, an upper bound would make every npm command fail wherever npm 11 is the shipped default, and
  the committed `lockfileVersion` 3 installs identically under npm 10 and npm 11
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

   `npm run build` first hydrates the gitignored `public/components` tree from the pinned
   `public-components.tgz` release asset - the same archive the Docker build downloads - and skips that step
   when the tree is already there, so `git clean -xfd && npm ci && npm run build` works on a clean checkout.
   See [COMPONENTS.md](COMPONENTS.md).

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

## Architecture

- **Backend**: Node.js 22 LTS with Hapi framework (@hapi/hapi 21.x)
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
