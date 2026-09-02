# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - Node 22 LTS and hapi 21 migration

Runs the application on Node 22 LTS against the real `@hapi/hapi` 21.x API. Application behaviour is unchanged; the two approved deviations from that are named under **Behaviour** below.

### Runtime

- Node 16/18 to **Node 22 LTS**. `package.json` now declares `engines: {"node": ">=22.0.0 <23.0.0", "npm": ">=10.0.0 <11.0.0"}`, and a new `.nvmrc` contains `22`. These bound the majors and float within them, which is what an LTS line taking security patches should do; they are not a reproducibility mechanism. Exact reproducibility is carried by the committed `package-lock.json`, the digest-pinned container image and the exact `pm2` pin.
- All nine Node-bearing Dockerfiles move to Node 22: the root image plus eight under `serverside/**`. The tenth, nginx, carries no Node. The root image is pinned by digest, installs with `npm ci` instead of `npm install --legacy-peer-deps`, and now builds the CSS artifacts it serves.

### Framework

- `@hapi/hapi` **20.3.0 to 21.4.10**, with the plugins current.
- The **154 functions hapi invokes** (145 routed handlers, 8 routed pre-handlers and 1 inline pre-handler) converted from the callback idiom to `async (request, h)` handlers that **return** their responses through the toolkit.
- The response-emulation compatibility layer in `lib/util/routeParser.js` is **removed**. The route DSL, the 233 registered routes, the hand-rolled validation path, all three error funnels, the missing-controller fallback and the per-request debug logging are unchanged.
- `lib/auth/passport.js` deleted: 136 unreachable lines whose only binding was an unused `require` in `app.js`.

### Dependencies

- Blocking-only replacements, notably `joi` 18.2.5, `bull` 4.16.5, `mime` 4.1.0, `js-yaml` 4.3.2, `jsonwebtoken` 9.0.2, `bcrypt` 6.0.0 and `nodemailer` 9.1.0. Every replaced or major-bumped package is recorded with its reason and resolved version in [docs/dependency-inventory.md](docs/dependency-inventory.md).
- **19 production and 4 development declarations removed** for having no live consumer in retained source, including all four `passport` packages, `request`, `optimist`, `mkdirp`, `rimraf` and `node-uuid`.
- Packages that are unmaintained but still working correctly are **deliberately left in place**: `aws-sdk` v2, `mongoose` 6, `mongoose-schema-extend`, `highlight.js` 9, `jszip`, `archiver`, `q` and `config`, each with its reasoning in [docs/deferred-dependencies.md](docs/deferred-dependencies.md).

### Behaviour

- Unchanged: route paths, methods and per-route auth; validation accept/reject outcomes; cookie names and login-flow outcomes; rendered pages and asset URLs; persisted data and file formats. [docs/preserved-quirks.md](docs/preserved-quirks.md) catalogues the 2013-era quirks that were preserved and documented rather than fixed, and [docs/baseline-parity.md](docs/baseline-parity.md) carries the parity method and the resolution log against base commit `2f8712a`.
- Two **approved deviations** from that preservation, each recorded with its reasoning rather than presented as a fix:
  - The image-download branch of `lib/controllers/files.js` never settled, so that request hung. It now serves the stream response its sibling branch already produced, without the `Content-Disposition` header that branch adds. An unsettled request is not behaviour a client can depend on, and every route is required to serve.
  - The private `marked` fork is **retained** despite a high ReDoS advisory, because every replacement tested changes rendered output and emits a deprecation notice on every parse. `npm audit --omit=dev` therefore reports 0 critical, 1 high and 5 moderate findings rather than a clean pass, with the single high named and attributed in [docs/deferred-dependencies.md](docs/deferred-dependencies.md).

### Developer experience

- The test suite executes again: seven harness wiring defects that killed `npm test` during file collection are repaired, and the suite provisions its own MongoDB, so it needs neither a preinstalled database nor Docker. The 124 existing assertions are carried through unweakened, with only stub syntax changed for the maintained `sinon`, alongside 6 new baseline-derived cases for 130 in total.
- New `npm run fetch-components` performs a digest-verified, idempotent and atomic retrieval of the frontend component bundle, replacing a documented-but-nonexistent `setup-vendor` script and an unverified inline `curl` in the Dockerfile. It is wired ahead of `npm run build`, so `npm ci && npm run build` succeeds on a clean tree.

## [1.0.0] - Initial Open Source Release

First public release of Trinket.
