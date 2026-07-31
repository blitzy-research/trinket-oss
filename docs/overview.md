# Overview

Trinket is a browser-based coding environment for education. This page describes the high-level architecture, repository layout, and embeddable frontend components.

## Architecture

- **Backend**: Node.js 22 LTS with the Hapi framework (@hapi/hapi 21.x)
- **Database**: MongoDB via the Mongoose ODM
- **Cache/Sessions**: Redis (optional - in-memory fallback when disabled)
- **Frontend**: AngularJS 1.x
- **Code Execution**: Skulpt (Python in the browser) for client-side languages; server-side container runners for Python 3, Java, R, and Pygame

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
│   ├── http/           # hapi request lifecycle (response contract, error map)
│   ├── models/         # MongoDB models
│   ├── util/           # Utilities
│   └── views/          # Nunjucks templates
├── public/             # Static assets (CSS, JS, images)
├── static/scss/        # SCSS source files
└── docker-compose.yml  # Docker services
```

## Frontend Components

Trinket depends on frontend libraries (Ace Editor, Skulpt, Blockly, GlowScript, etc.) that are distributed separately from the main repository. They live in `public/components/` (gitignored, like `node_modules`) and are packaged into `public-components.tgz`, which is downloaded automatically during the Docker build from GitHub releases.

For local installs you can run `npm run setup-vendor` to fetch the required components. Most are Trinket forks with customizations on top of their upstream projects.

## Embeds by Feature

### Python Embed (`/embed/python`)

| Component | Repository | Version | Notes |
|-----------|------------|---------|-------|
| skulpt | [trinketapp/skulpt-dist](https://github.com/trinketapp/skulpt-dist) | 0.11.1.34 | Python-to-JS compiler (Trinket fork) |
| marked | [trinketapp/marked](https://github.com/trinketapp/marked) | master | Markdown parser (Trinket fork) |
| jq-console | [trinketapp/jq-console](https://github.com/trinketapp/jq-console) | v2.13.2.1 | Console/REPL UI |
| traqball.js | [trinketapp/traqball.js](https://github.com/trinketapp/traqball.js) | 1.0.3 | 3D rotation for turtle graphics |
| detectizr | [trinketapp/Detectizr](https://github.com/trinketapp/Detectizr) | 2.3.0 | Browser/device detection |

### Python3/Pygame Embed (`/embed/python3`, `/embed/pygame`)

Server-side execution - requires a separate code runner service (not included in this repository).

### Blocks Embed (`/embed/blocks`)

Blockly-based visual block editor that emits Python code, executed via Skulpt.

### GlowScript Embed (`/embed/glowscript`)

3D graphics environment based on GlowScript 2.7.5 and VPython bindings.

### Music Embed

MIDI/music playback environment based on MIDI.js.

## Contributing

Contributions are welcome. The full guidelines live in [CONTRIBUTING.md](https://github.com/Blitzy-Sandbox/blitzy-trinket-oss/blob/main/CONTRIBUTING.md); the short version is:

1. **Reporting bugs** - Check existing [Issues](https://github.com/trinketapp/trinket-oss/issues) first, then open a new issue with a clear title, reproduction steps, expected vs. actual behavior, and browser/OS/Node version when relevant.
2. **Suggesting features** - Open an issue with the `enhancement` label describing the problem, your proposed solution, and any alternatives considered.
3. **Pull requests** - Small fixes can be submitted directly; for larger changes, open an issue first. Fork the repo, branch from `main`, follow the code style (2-space indent, single quotes, semicolons, lines under 120 chars), run `npm test`, and open a PR.
4. **Code of Conduct** - Be respectful and constructive.
5. **Questions** - Open an issue with the `question` label or reach out to the maintainers.
