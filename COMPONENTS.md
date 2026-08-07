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

For a local, non-Docker checkout the tree has to be hydrated before the
stylesheets can compile: `static/scss/base.scss` and
`static/scss/embed/embed.scss` both `@import
"public/components/foundation/scss/foundation"`, so a clean checkout has nothing
to compile against.

**`npm run build` does this for you.** `package.json` declares a `prebuild`
script - `node scripts/hydrate-components.js` - which npm runs automatically
before `build`, so `git clean -xfd && npm ci && npm run build && npm test`
succeeds unattended on a fresh clone. That script is deliberately conservative,
on both the input and the result. The release tag is pinned and the archive bytes
are checked against **both** a recorded length and a recorded SHA-256 before
anything is unpacked, so a re-cut release, a proxy error page or a truncated
download fails loudly instead of quietly producing different stylesheets. The
extracted tree is then checked too, on **four** counts: it must carry the three
paths the build reads by name; the 42 files under
`public/components/foundation/scss` - the only subtree either stylesheet imports -
must fingerprint to a recorded value; **one representative file inside each of the
31 top-level entries the application serves over HTTP must be present**; and the
**top-level listing itself** - 44 entries with their names and types - must
fingerprint to a recorded value. The last two exist because the SCSS fingerprint
covers every byte the *build* reads and nothing the *browser* reads: deleting
`skulpt`, `blockly` or `glowscript` left that fingerprint intact, so the build
stayed green and the CSS gate still passed while those assets 404'd at runtime.
Only past all four checks does the script write its completion marker,
`public/components/.hydrated.json`, and it writes it by rename so a half-written
marker cannot exist. The marker records both fingerprints and the number of served
assets verified, and it carries a `markerVersion` so a marker written by an older
hydrator - which measured less - is treated as unverified rather than trusted.

It is still **idempotent**: a tree whose marker and both fingerprints hold exits 0
without touching the network or the filesystem, so re-running the build costs
nothing - the two added layers are 31 existence checks and one directory listing,
which together cost well under a millisecond. What changed is what "already
present" means. An earlier revision probed
for a single `foundation.scss` and returned successfully whenever that one file
existed, so an interrupted extraction, a locally edited partial or a tree from a
different release all passed forever and could change the compiled stylesheets
silently. Each of those now **re-hydrates** from the verified asset instead, as
does a tree that is missing a served component directory's contents or a whole
top-level entry. The
script also removes the AppleDouble sidecar described below, and it removes an
existing tree only *after* the replacement archive has been verified, so a failed
download can never leave the checkout with neither. Set
`TRINKET_COMPONENTS_TARBALL` to a local copy of the archive to hydrate **without
network access**; every check still applies to it.

Two conditions on that chain are documented rather than assumed, and neither is
this script's. `npm ci` needs **npm 10**, because `.npmrc` sets
`engine-strict=true` and `package.json`'s `engines` caps npm below 11 -
`docs/setup.md` gives the `npx -y npm@10.9.9 ci` form. And `node app.js` still
needs `config/local.yaml` for its session secret, which `git clean -xfd` deletes
and no script restores (`docs/setup.md`, *Verifying a clean-clone install*).
`npm test` does **not**: `test/setup.js` forces the session password and the
`app.url` origin through `$NODE_CONFIG`, recorded in
[docs/PRESERVED-QUIRKS.md](docs/PRESERVED-QUIRKS.md) section 13.1.

The manual fetch below is the exact equivalent, kept because it is what the
Docker build performs, because it is what to reach for when you want to inspect
the archive before it lands in your tree, and because
`scripts/hydrate-components.js` points at it when it fails. Note that only
`npm run build` carries the hook: `npm run build:css` and `npm run watch:css`
invoke Vite directly and assume the tree is already there.

> ⚠️ **`git clean -xfd` is destructive, and it is not part of that path.** It
> permanently deletes every untracked and ignored file in this working tree,
> with no recovery - `config/local.yaml` and the session secret in it (the
> application calls `process.exit(1)` without it, and it is gitignored, so git
> cannot restore it), `config/runtime.json`, the hydrated `public/components/`
> tree, `node_modules/`, and the generated `public/css/base.css` and
> `public/css/embed.css`. Preview it with `git clean -xfdn`, which changes
> nothing and lists exactly what would be deleted, and read that list before
> running the real command. The full warned procedure, including what has to be
> restored afterwards, is
> [Verifying a clean-clone install](docs/setup.md#verifying-a-clean-clone-install-destructive-read-first)
> in the setup guide; use it rather than reaching for the clean here.

Run it from the repository root. It fetches **the same release asset** the Docker build fetches, from the same URL,
and it performs **the same three checks the image build performs** — the two are deliberately equivalent now, and this
paragraph says so because an earlier revision of it described a gap that no longer exists. `Dockerfile` runs
`curl --fail --show-error --location --silent` so an HTTP error page cannot be saved under the archive's name, pipes
the recorded digest through `sha256sum --check` **before** extracting anything, and removes both the archive and the
AppleDouble sidecar afterwards — exactly what the commands below do by hand (review finding P3-4). Treat neither copy
as unverified; verify locally when you want to inspect the archive before it lands in your tree:

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
tar xzf public-components.tgz && rm -f public-components.tgz public/._components
```

The cleanup removes two files, not one. The archive was packed on macOS, so it
carries an AppleDouble sidecar - `public/._components`, 268 bytes - next to the
component tree. It is inert and nothing serves it, but it is not part of the
component tree, and leaving it behind is what makes `git status` report an
untracked file on an otherwise clean checkout - so remove it. `tar` prints
`Ignoring unknown extended header keyword 'LIBARCHIVE.xattr.com.apple.provenance'`
for the same macOS provenance, and that notice is harmless.

`--fail` makes `curl` exit non-zero on an HTTP error rather than writing the
error body into the output file, `--show-error` keeps the reason visible despite
`--silent`, and `--location` follows the redirect GitHub serves for release
assets. The digest is of the `v1.1.0` asset - 166,464,007 bytes - and does not
change; on a mismatch, delete the file and download it again instead of
extracting it. The `Dockerfile` uses the same four flags and checks the same
digest before it extracts, so the image and this procedure are two spellings of
one contract rather than a strict version and a lax one.

**A manual fetch leaves a tree the hydrator will adopt, not re-download.**
`scripts/hydrate-components.js` records its work in a completion marker,
`public/components/.hydrated.json`, which it writes atomically and only after the
archive has been verified, unpacked and the result re-measured. A tree unpacked
by the commands above carries no marker, so the next `npm run build` re-measures
the 42 files under `public/components/foundation/scss` - the only subtree either
stylesheet imports - along with the 31 served representative assets and the
44-entry top-level listing, and, finding all of them at their pinned values,
writes the marker and moves on without touching the network. What it will **not**
do is accept a tree that fails any of those measurements: a half-extracted
archive, a locally edited partial, a tree from a different release, a component
directory whose contents were removed, or a missing top-level entry is
re-hydrated from the verified asset instead. Delete the marker to force a full
re-verification; `git clean -xfd` removes it along with the tree it describes.

That archive is a hard prerequisite for the stylesheet build. With the tree
absent, `npm run build:css` fails with `Can't find stylesheet to import.`,
because `static/scss/base.scss` and `static/scss/embed/embed.scss` both
`@import "public/components/foundation/scss/foundation"`. `npm run build` does
not fail there, because its `prebuild` hook hydrates the tree first - that hook
is precisely what turns this prerequisite from a manual step into part of the
build.

Once the archive is unpacked, a successful build emits exactly two artifacts:
`public/css/base.css` (265,727 bytes) and `public/css/embed.css`
(296,352 bytes). No `.css.map` files are emitted alongside them.

Those three facts are a **gate**, not a note. `package.json` declares a
`postbuild` script - `node scripts/verify-css-artifacts.js` - which npm runs
automatically after `build`, and it fails the build unless both stylesheets match
the byte counts and SHA-256 digests recorded in
`test/baseline/responses.json#buildArtifacts` and unless `public/css` still holds
zero `.map` files. The expectations are read from that artifact rather than
restated in the script, because it is the same evidence
`test/baseline/replay.js` compares against, and the `Dockerfile` reaches the gate
through the very same `npm run build` - so the image and a host build cannot
disagree about what correct output is. `sass` and `vite` are held at exact
versions and `static/scss/**` is frozen precisely so this gate keeps passing; a
failure is a client-visible asset change to report, not a digest to update.

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
  ⚠️ That row does carry two **other** discrepancies, which are recorded here
  rather than corrected in the table because the table is pre-existing and
  changing it is not one of this migration's sanctioned changes. Its
  **repository link is dead and names a different fork**: the table links
  [nickvergessen/ViewerJS](https://github.com/nickvergessen/ViewerJS), which
  returns **HTTP 404** - the only non-200 among the external URLs in this
  document - while the hydrated tree's `_source` is
  `git@github.com:kogmbh/ViewerJS_release.git`, whose web address
  [kogmbh/ViewerJS_release](https://github.com/kogmbh/ViewerJS_release) returns
  **200**. Both conditions are byte-identical to the base commit's row, so
  neither was introduced here; read `_source` for the authoritative origin, the
  same way `_release` is authoritative for the version.
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
