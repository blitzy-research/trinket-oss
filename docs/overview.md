# Overview

Trinket is a browser-based coding environment for education. This page describes the high-level architecture, repository layout, and embeddable frontend components.

## Architecture

- **Backend**: Node.js 22 LTS with the Hapi framework (@hapi/hapi 21.x)
- **Database**: MongoDB via the Mongoose ODM
- **Sessions**: iron-sealed cookies via Hapi's Yar plugin, backed by **MongoDB** through the in-repo `lib/util/catbox-mongoose.js` catbox engine - not Redis
- **Application cache/queues**: Redis (optional - `lib/util/store.js` falls back to an in-memory client when disabled)
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

The version column in the tables below is documentation only - no runtime code path reads it - and it is reproduced here exactly as this repository has always published it. The authority for what a hydrated tree actually contains is the `_release` field of `public/components/<name>/.bower.json`, and it does not agree with every published row.

On this page **skulpt** is published as `0.11.1.34` while the release asset carries `0.11.1.33`, and **marked**'s `master` names a branch rather than a version, with `_release` recording the resolved commit `55ea824910` - the same fork commit the base `package-lock.json` pinned for the server-side copy. The remaining rows match `_release` exactly: jq-console `v2.13.2.1`, traqball.js `1.0.3`, detectizr `2.3.0`, and glowscript `2.7.5`. `COMPONENTS.md` carries the full variance list across every component table under "About the version numbers in the tables below", and its closing rule applies here too - to know what is installed, read the `.bower.json` in the component's directory.

The repository links below were each checked against the `_source` field recorded in those same `.bower.json` files and all seven match, and each URL was resolved live and returns HTTP 200. None of them were introduced or changed by the Node 22 modernization.

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

3D graphics environment with VPython bindings. The GlowScript version is selected by configuration rather than fixed in code: `lib/views/embed/glowscript-config.html` publishes a map of eleven selectable versions (`1.1` through `3.2`) and `config/default.yaml` picks the default with `app.glowscript.defaultVersion`, which ships as `3.2` - Trinket build `3.2.2`, served from `public/components/vpython-glowscript/`. The separate `glowscript-blocks` type - not the Blockly `/embed/blocks` above - is configured through `app.glowscript.blocksVersion`, which ships as `2.7` - Trinket build `2.7.5`, served from `public/components/glowscript/` - against its own seven-version map in `lib/views/embed/glowscript-blocks-config.html`. Both templates and both configuration values are unchanged by the Node 22 modernization.

### Music Embed

MIDI/music playback environment based on MIDI.js.

## Contributing

Contributions are welcome. The full guidelines live in [CONTRIBUTING.md](https://github.com/Blitzy-Sandbox/blitzy-trinket-oss/blob/main/CONTRIBUTING.md); the short version is:

1. **Reporting bugs** - Check existing [Issues](https://github.com/trinketapp/trinket-oss/issues) first, then open a new issue with a clear title, reproduction steps, expected vs. actual behavior, and browser/OS/Node version when relevant.
2. **Suggesting features** - Open an issue with the `enhancement` label describing the problem, your proposed solution, and any alternatives considered.
3. **Pull requests** - Small fixes can be submitted directly; for larger changes, open an issue first. Fork the repo, branch from `main`, follow the code style (2-space indent, single quotes, semicolons, lines under 120 chars), run `npm test`, and open a PR.
4. **Code of Conduct** - Be respectful and constructive.
5. **Questions** - Open an issue with the `question` label or reach out to the maintainers.
