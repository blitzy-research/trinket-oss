# Trinket Component Dependencies

Frontend components live in `public/components/` (gitignored, like node_modules).

Run `npm run setup-vendor` to install required components.

## Obtaining the components

`public/components/` is gitignored and is not a tracked source tree. Nothing
under it is checked in, and it must not be modified or committed. `.bowerrc`
declares it as the install root (`"directory": "public/components"`).

The tree is distributed as `public-components.tgz`, a 166,464,007-byte asset
attached to the `v1.1.0` GitHub release. The Docker build downloads and unpacks
it automatically. For a local, non-Docker checkout, run the same fetch from the
repository root:

```bash
curl -L --silent -o ./public-components.tgz \
  https://github.com/trinketapp/trinket-oss/releases/download/v1.1.0/public-components.tgz \
  && tar xzf public-components.tgz \
  && rm public-components.tgz
```

That archive is a prerequisite for the stylesheet build. On a fresh clone
`npm run build` fails with `Can't find stylesheet to import.`, because
`static/scss/base.scss` and `static/scss/embed/embed.scss` both
`@import "public/components/foundation/scss/foundation"`.

Once the archive is unpacked, a successful build emits exactly two artifacts:
`public/css/base.css` (265,727 bytes) and `public/css/embed.css`
(296,352 bytes). No `.css.map` files are emitted alongside them.

### Foundation and the frozen stylesheet layer

Foundation is version 5.5.3, read from
`public/components/foundation/package.json`, and it is delivered by Bower
rather than npm: `.bowerrc` sets the install root to `public/components`, and
no `bower.json` is tracked in this repository. Both
`static/scss/_settings.scss` and `static/scss/embed/_settings.scss` carry an
author-written warning that variable names will need checking if Foundation is
upgraded.

`sass` is held at 1.98.0 and `vite` at 4.5.14 specifically so that this fork
continues to compile to the same bytes; advancing `sass` past the `@import` and
legacy JS API removals would break it. The tree emits more than 435 repetitive
Sass deprecation warnings on each build. Those warnings are tolerated, because
silencing them would mean touching the frozen stylesheet layer.

The component versions in the tables below describe the contents of the release
asset, so they must not be changed.

## Components by Feature

### Python Embed (`/embed/python`)
| Component | Repository | Version | Notes |
|-----------|------------|---------|-------|
| skulpt | [trinketapp/skulpt-dist](https://github.com/trinketapp/skulpt-dist) | 0.11.1.34 | Python-to-JS compiler (Trinket fork) |
| marked | [trinketapp/marked](https://github.com/trinketapp/marked) | master | Markdown parser (Trinket fork) |
| jq-console | [trinketapp/jq-console](https://github.com/trinketapp/jq-console) | v2.13.2.1 | Console/REPL UI |
| traqball.js | [trinketapp/traqball.js](https://github.com/trinketapp/traqball.js) | 1.0.3 | 3D rotation for turtle graphics |
| detectizr | [trinketapp/Detectizr](https://github.com/trinketapp/Detectizr) | 2.3.0 | Browser/device detection |

### Python3/Pygame Embed (`/embed/python3`, `/embed/pygame`)
Server-side execution - requires separate code runner service (not included).

Additional components:
| Component | Repository | Version | Notes |
|-----------|------------|---------|-------|
| systemjs | [systemjs/systemjs](https://github.com/systemjs/systemjs) | 0.21.3 | Module loader (pygame) |
| webrtc-adapter | [webrtc/adapter](https://github.com/webrtc/adapter) | 6.2.1 | WebRTC compatibility (pygame) |

### Blocks Embed (`/embed/blocks`)
| Component | Repository | Version | Notes |
|-----------|------------|---------|-------|
| blockly | [trinketapp/blockly](https://github.com/trinketapp/blockly) | v20211018 | Visual block editor (Trinket fork) |
| skulpt | (see above) | | |

### GlowScript Embed (`/embed/glowscript`)
| Component | Repository | Version | Notes |
|-----------|------------|---------|-------|
| glowscript | [trinketapp/glowscript](https://github.com/trinketapp/glowscript) | 2.7.5 | 3D graphics (Trinket fork) |
| vpython-glowscript | [trinketapp/vpython-glowscript](https://github.com/trinketapp/vpython-glowscript) | 3.2.2 | VPython bindings |
| glowscript-blocks | [txst-per-group/Glowscript-Blocks](https://github.com/txst-per-group/Glowscript-Blocks) | 0.1.11 | Block editor for GlowScript |

### Other Components
| Component | Repository | Version | Used By |
|-----------|------------|---------|---------|
| foundation | [trinketapp/bower-foundation](https://github.com/trinketapp/bower-foundation) | 5.5.3.1 | Base UI framework |
| closure-library | [google/closure-library](https://github.com/google/closure-library) | v20180204 | Blockly dependency |
| midi | [trinketapp/MIDI.js](https://github.com/trinketapp/MIDI.js) | master | Music embed |
| Processing.js | ? | ? | Processing embed |
| viewerjs | [nickvergessen/ViewerJS](https://github.com/nickvergessen/ViewerJS) | v0.2.1 | Document viewer |

### Skulpt Extension Modules (`.sk`)
These are Python modules that run in Skulpt:
| Component | Repository | Notes |
|-----------|------------|-------|
| json.sk | [trinketapp/json.sk](https://github.com/trinketapp/json.sk) | JSON support |
| xml.sk | [trinketapp/xml.sk](https://github.com/trinketapp/xml.sk) | XML support |
| processing.sk | [trinketapp/processing.sk](https://github.com/trinketapp/processing.sk) | Processing graphics |
| pygame.sk | [trinketapp/pygame.sk](https://github.com/trinketapp/pygame.sk) | Pygame compatibility |
| skulpt_numpy | [trinketapp/skulpt_numpy](https://github.com/trinketapp/skulpt_numpy) | NumPy subset |
| skulpt_matplotlib | [trinketapp/skulpt_matplotlib](https://github.com/trinketapp/skulpt_matplotlib) | Matplotlib subset |

## Feature Flags (TODO)

Eventually, features should be toggleable so users can skip unnecessary dependencies:

- `ENABLE_PYTHON_EMBED` - Basic Python (skulpt)
- `ENABLE_PYTHON3_EMBED` - Server-side Python3
- `ENABLE_BLOCKS_EMBED` - Visual blocks (blockly)
- `ENABLE_GLOWSCRIPT_EMBED` - 3D graphics
- `ENABLE_MUSIC_EMBED` - Music/MIDI
- `ENABLE_PYGAME_EMBED` - Pygame (server-side)

## Notes

- Most components are Trinket forks with customizations
- Original bower.json preserved for reference but bower is deprecated
- Components should be cloned/downloaded via setup script, not committed
