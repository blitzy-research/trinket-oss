# Trinket Component Dependencies

Frontend components live in `public/components/` (gitignored, like node_modules).

Run `npm run setup-vendor` to install required components.

## Obtaining the components

`public/components/` is gitignored and is not a tracked source tree. Nothing
under it is checked in, and it must not be modified or committed. `.bowerrc`
declares it as the install root (`"directory": "public/components"`).

The tree is distributed as `public-components.tgz`, a 166,464,007-byte asset
attached to the `v1.1.0` GitHub release. The Docker build downloads and unpacks
it automatically.

For a local, non-Docker checkout there is nothing to fetch by hand:
`npm run build` runs `scripts/hydrate-components.js` before Vite, and that
script unpacks the same pinned `v1.1.0` asset. It checks the archive against a
recorded byte length and SHA-256 digest before unpacking anything, and it exits
immediately when the tree is already present - so
`git clean -xfd && npm ci && npm run build` works from a clean checkout, and
repeat builds cost nothing.

To hydrate from a local copy of the archive rather than over the network - on an
air-gapped machine, or from a shared cache - point `TRINKET_COMPONENTS_TARBALL`
at it. The byte length and the digest are still verified:

```bash
TRINKET_COMPONENTS_TARBALL=/path/to/public-components.tgz npm run build
```

The equivalent manual fetch, run from the repository root, is what both that
script and the Docker build perform:

```bash
curl --fail --show-error --location --silent -o ./public-components.tgz \
  https://github.com/trinketapp/trinket-oss/releases/download/v1.1.0/public-components.tgz
```

Verify the archive before unpacking it, so that a truncated transfer or an HTTP
error page saved under the archive's name cannot be extracted over your tree:

```bash
echo '58422c0d0c7d25c1e6fdd1e014ff690f41c899257703e416e85a0fb0a926181f  public-components.tgz' \
  | sha256sum --check
```

Only once that prints `public-components.tgz: OK`, unpack and clean up:

```bash
tar xzf public-components.tgz && rm public-components.tgz
```

`--fail` makes `curl` exit non-zero on an HTTP error rather than writing the
error body into the output file, `--show-error` keeps the reason visible despite
`--silent`, and `--location` follows the redirect GitHub serves for release
assets. The digest is of the `v1.1.0` asset - 166,464,007 bytes - and does not
change; on a mismatch, delete the file and download it again instead of
extracting it.

That archive is a hard prerequisite for the stylesheet build. With the tree
absent, `npm run build:css` - which calls Vite directly and therefore skips the
hydration step - fails with `Can't find stylesheet to import.`, because
`static/scss/base.scss` and `static/scss/embed/embed.scss` both
`@import "public/components/foundation/scss/foundation"`.

Once the archive is unpacked, a successful build emits exactly two artifacts:
`public/css/base.css` (265,727 bytes) and `public/css/embed.css`
(296,352 bytes). No `.css.map` files are emitted alongside them.

### Foundation and the frozen stylesheet layer

Foundation is version 5.5.3, read from
`public/components/foundation/package.json`, and it is delivered by Bower rather
than npm. Both `static/scss/_settings.scss` and
`static/scss/embed/_settings.scss` carry an author-written warning that variable
names will need checking if Foundation is upgraded.

**Where the Bower metadata actually lives.** This is worth stating precisely,
because two statements about it can look contradictory. The **only tracked Bower
artifact in the repository is `.bowerrc`**, which sets the install root
(`"directory": "public/components"`) and lists `ignoredDependencies`. There is
**no tracked `bower.json`** - no manifest naming the components or their
versions is checked in anywhere. The per-component manifests do exist, but only
**inside the hydrated tree**: unpacking the release archive produces a
`.bower.json` in each component directory - 24 of them - and because
`public/components/` is gitignored, none of those is tracked either. So the
component set is described by the archive's own contents, not by anything in
version control.

`sass` is held at 1.98.0 and `vite` at 4.5.14 specifically so that this fork
continues to compile to the same bytes; advancing `sass` past the `@import` and
legacy JS API removals would break it. The tree emits more than 435 repetitive
Sass deprecation warnings on each build. Those warnings are tolerated, because
silencing them would mean touching the frozen stylesheet layer.

## About the version numbers in the tables below

The tables that follow are **pre-existing documentation and are left exactly as
they are.** They are not modified here, because changing them is not one of the
sanctioned kinds of change in this migration, and because nothing in the runtime
reads them.

What they are **not** is a certified inventory of the release archive. When the
hydrated tree is compared against them, the authority for what is actually
installed is each component's **`public/components/<name>/.bower.json`
`_release`** field, written by Bower at install time, and on that comparison
**three rows disagree**:

| Component | Version in the table below | `.bower.json` `_release` in the hydrated tree |
|---|---|---|
| skulpt | 0.11.1.34 | **0.11.1.33** |
| blockly | v20211018 | **v20180924** |
| vpython-glowscript | 3.2.2 | **3.1.0** |

Three further rows differ in kind rather than in value, and are **not**
disagreements:

- **viewerjs** - the table says `v0.2.1` and `_release` says `0.2.1`. The same
  version, written with and without the tag's `v` prefix.
- **marked** and **midi** - the table says `master`, which is a branch rather
  than a version. `_release` records the commit that branch resolved to at
  install time, so the two fields are describing different things. (The `marked`
  commit recorded there, `55ea8249`, is the same fork commit the base commit's
  `package-lock.json` pinned for the **npm** `marked` dependency - a separate
  artifact, catalogued as a deliberate browser-versus-server skew in
  [docs/PRESERVED-QUIRKS.md](docs/PRESERVED-QUIRKS.md) section 2.)

The remaining nine rows match their `_release` exactly. One row, **Processing.js**,
records `?` for both repository and version; the hydrated tree answers both -
`_release` is `1.6.12` and the homepage is the `trinketapp/processing-js` fork -
and that answer is recorded here rather than written into the table.

**The practical rule: to know what is installed, read the `.bower.json` in the
component's directory.** Treat the tables as the feature-by-feature map they are
good at being - which component serves which embed - rather than as a version
manifest.

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
- Bower is deprecated. No `bower.json` is preserved in this repository - the only
  tracked Bower artifact is `.bowerrc`, and the per-component `.bower.json`
  manifests exist only inside the gitignored hydrated tree. See *Where the Bower
  metadata actually lives* above.
- Components should be cloned/downloaded via setup script, not committed
