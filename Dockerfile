# Multi-stage build. What the shipped image contains, and why it is staged.
#
# The final stage is assembled from three build stages and inherits nothing
# from them implicitly: only the paths its COPY --from lines name arrive. That
# structure exists for one reason. `npm ci` on this project's lockfile installs
# the full graph including devDependencies, because the CSS build needs vite and
# sass, and a dev-inclusive audit of that graph is not what this application's
# production dependency set audits to. In a single-stage build those packages
# stay in the immutable layer that ships, so the running container's filesystem
# carries a dependency tree nobody deploys or audits. Separating the stages is
# what makes the shipped tree the production tree: it is installed by its own
# `npm ci --omit=dev` in the `deps` stage, and the dev graph exists only inside
# the `assets` stage, which contributes its build products and nothing else.
#
# The claim this structure supports is precise, and worth stating so it is not
# read as more than it is: the shipped image carries no npm devDependency tree.
# It is not a toolchain-free image -- the Debian base itself ships python3 and a
# compiler regardless of the apt layer below.
#
# Stages:
#   base       digest-pinned runtime, engines assertion, the unprivileged user
#   toolchain  base + apt build dependencies; inherited by build stages only
#   pm2        the locked process-manager tree the CMD invokes
#   assets     the dev-inclusive install, the component fetch and the CSS build
#   deps       the production-only dependency tree
#   (final)    base + pm2 + source + deps' node_modules + assets' build products
#
# Use Node 22 LTS, pinned by digest.
#
# package.json "engines" and .nvmrc are deliberately major-bounded and floating
# (node >=22.0.0 <23.0.0), which is the right shape for an LTS line that keeps
# receiving security patches -- but it gives no reproducibility on its own. This
# digest is where that reproducibility lives: it names one immutable image
# rather than whatever the tag points at today. It is the multi-arch INDEX
# digest of node:22-bookworm, not a single platform's manifest digest, so
# multi-platform builds still resolve. Which node and npm the digest actually
# resolves to is not asserted here in prose, where it could only ever describe
# one pull: the assertion step immediately below reads both versions out of the
# image at build time, prints them into the build log and fails the build if
# either leaves its declared range.
#
# Refreshing it is a deliberate edit, never an incidental one: resolve the new
# value with `docker buildx imagetools inspect node:22-bookworm`, re-run the
# assertion below, and record the value in docs/dependency-inventory.md.
#
# bookworm rather than alpine or slim: the apt-get layer below and the native
# builds npm ci performs (bcrypt, nodejieba, @parcel/watcher) need a full Debian
# toolchain and glibc.
FROM node:22-bookworm@sha256:8a34c4ab3ea2c5cd194f07e317b2a8f09461d3c8b05c4e34c8ccd56d56024c4d AS base

SHELL ["/bin/bash", "-c"]

# Assert the base image satisfies package.json "engines" before anything else
# runs.
#
# The digest above pins the image, but the two ranges it has to satisfy live in
# a different file, so a digest refresh could quietly drift out of them. This
# turns that into a build failure at the first step, naming both versions,
# instead of a confusing npm resolution error or a runtime fault much later.
# Plain shell on the two version strings: this step precedes `npm ci` and even
# the COPY, so it can depend on nothing but the image itself. Comparing majors
# is exactly equivalent to the declared ranges, each of which spans one major
# (>=22.0.0 <23.0.0 and >=10.0.0 <11.0.0). The range literals in the messages
# are single-quoted inside the double-quoted strings so that the `>` and `<`
# they contain need no backslash escaping to stay clear of redirection.
#
# Both branches are failing branches, not warnings: an image whose node major
# is not 22, or whose npm major is not 10, exits 1 from this step with a message
# naming the offending version and the range it violates. On success the step
# echoes both versions, so every build log records the runtime it was built on
# without any comment here having to claim it.
RUN set -euo pipefail \
    && node_version="$(node -v)" \
    && npm_version="$(npm -v)" \
    && node_major="${node_version#v}" \
    && node_major="${node_major%%.*}" \
    && npm_major="${npm_version%%.*}" \
    && if [ "$node_major" != "22" ]; then \
         echo "engines: node ${node_version} does not satisfy package.json '>=22.0.0 <23.0.0'" >&2; \
         exit 1; \
       fi \
    && if [ "$npm_major" != "10" ]; then \
         echo "engines: npm v${npm_version} does not satisfy package.json '>=10.0.0 <11.0.0'" >&2; \
         exit 1; \
       fi \
    && echo "engines: node ${node_version}, npm v${npm_version} -- ok"

RUN groupadd -r trinket && \
    useradd -r -g trinket -m -c "trinket user" trinket

RUN mkdir -p /usr/local/node/trinket && chown trinket:trinket /usr/local/node/trinket

# Install build dependencies
#
# Its own stage so that only the stages that compile something inherit it. The
# stages that build -- `assets` and `deps`, both of which run `npm ci` over a
# graph with native modules in it -- start FROM toolchain; the final stage
# starts FROM base and never receives this layer or the apt lists it writes.
FROM base AS toolchain

RUN apt-get update \
    && apt-get install -y python3 build-essential \
    && apt-get -y autoclean

# The process manager the CMD at the end of this file invokes, installed from a
# committed lockfile.
#
# `npm install -g pm2@5.4.3`, which this replaces, pinned exactly one package.
# Everything beneath it -- the rest of the tree that scripts/pm2/package-lock.json
# now enumerates -- was re-resolved from mutable semver ranges on every build,
# with no lockfile to fix the result, so two builds of the same commit could
# install two different process-manager trees. scripts/pm2/package.json and
# scripts/pm2/package-lock.json are a private, unpublished manifest pair whose
# whole purpose is to freeze that tree: every entry in the lock carries an
# integrity hash and a registry URL, so `npm ci` here resolves nothing and
# verifies everything.
#
# Deliberately NOT the application's own manifest: pm2 is an image concern, not
# a dependency of the application, and keeping it out of package.json keeps it
# out of the production tree the `deps` stage installs and audits.
#
# Which is exactly why it is audited here. A second dependency root copied into
# the final image is a second thing that ships, and freezing a tree does not
# make it safe -- it makes it reliably whatever it was frozen at. pm2 declares
# `js-yaml ~4.1.0`, a range that cannot reach the 4.3.1 fix for the 4.x
# quadratic-CPU advisories, so scripts/pm2/package.json overrides js-yaml to
# the same 4.3.2 the application resolves. `npm audit --audit-level=high` below
# then holds that in place: a high or critical advisory against anything in
# this tree fails the build. The residual low against pm2 itself
# (GHSA-x5gf-qvw8-r2rm, regular-expression denial of service, <7.0.0) is left
# in place deliberately -- its only fix is pm2 7.x, a semver major, where the
# migration plan pins the 5.x line and defers anything below high severity.
# When this gate fires, the fix is a new pin, never a weaker gate.
#
# `--ignore-scripts` is the other half of the finding this addresses. This stage
# necessarily runs as root -- it writes under /usr/local -- so an install script
# from any package in that tree would execute as root at build time. The pinned
# pm2 declares no install, pre or post scripts, so refusing to run them costs
# nothing here and removes the class of problem rather than the instance of it.
#
# The assertion in the same RUN is what makes this safe to bump: the expected
# version is read out of the manifest instead of being written here, so it
# cannot go stale, and the executable that must exist is the one the CMD names.
# `pm2-docker` is the legacy name of what later became `pm2-runtime`, and the
# pinned version ships both; a bump that dropped it would fail here, at build
# time, rather than at container start.
FROM base AS pm2

COPY scripts/pm2/package.json scripts/pm2/package-lock.json /usr/local/pm2/

WORKDIR /usr/local/pm2

RUN set -euo pipefail \
    && npm ci --omit=dev --ignore-scripts \
    && pinned_version="$(node -e 'process.stdout.write(require("/usr/local/pm2/package.json").dependencies.pm2)')" \
    && test -x node_modules/.bin/pm2-docker \
    && installed_version="$(node_modules/.bin/pm2-docker --version)" \
    && if [ "$installed_version" != "$pinned_version" ]; then \
         echo "pm2: installed pm2-docker reports ${installed_version}, manifest pins ${pinned_version}" >&2; \
         exit 1; \
       fi \
    && npm audit --omit=dev --audit-level=high \
    && echo "pm2: pm2-docker ${installed_version} installed from the committed lockfile," \
            "no high or critical advisory in the process-manager tree -- ok"

# Build the frontend assets: fetch the component bundle, install the full
# dependency graph, compile the CSS.
#
# This is the stage that holds the dev-inclusive tree, and it is the reason the
# build is staged at all. Nothing here is copied into the final image except the
# two things it produces -- public/components and the two stylesheets -- so vite,
# sass and the rest of the devDependency graph never reach a shipped layer.
FROM toolchain AS assets

USER trinket

# The `.` here is not the checkout -- it is whatever `.dockerignore` admits, and
# that file is the definition of what enters this image. It is an allowlist:
# every top-level entry is excluded and the tracked ones are re-admitted, so a
# gitignored secret, a local dependency tree or any other host residue on the
# builder's disk cannot reach this layer, and a new untracked path defaults to
# staying out. A new tracked top-level entry, on the other hand, has to be added
# there before it will arrive here.
COPY --chown=trinket:trinket . /usr/local/node/trinket

WORKDIR /usr/local/node/trinket

# Download frontend components from GitHub release, SHA-256 verified before
# extraction.
#
# The host and this image share one implementation, so the same pinned archive
# is fetched and checked the same way in both places, and an error page served
# in place of the archive fails the digest check instead of being extracted. The
# script depends on Node built-ins and the system tar only -- deliberately,
# because at this point in the build node_modules does not exist yet -- and it
# is idempotent, so a rebuild that already has the bundle does no network I/O.
# It runs as the unprivileged trinket user in the WORKDIR above and writes only
# inside it.
#
# Order is load-bearing: this must stay ahead of both steps below, because the
# install follows the host workflow and the CSS build imports the Foundation
# tree this publishes into public/components.
RUN node scripts/fetch-components.js

# Install from the lockfile. `npm ci` is exact and reproducible where the
# `npm install --legacy-peer-deps` it replaces was neither: the target lockfile
# resolves cleanly without that flag, and dropping it is what keeps the image's
# dependency tree identical to the one tested on the host. Dev dependencies are
# installed on purpose -- the CSS build below needs vite and sass -- and this
# stage exists so that installing them has no effect on what ships.
RUN npm ci

# Build the CSS this application serves.
#
# public/css/base.css and public/css/embed.css are gitignored build outputs, so
# they exist in no checkout and the image has to build them: without this step
# the container would fetch components and install dependencies but ship neither
# stylesheet, and every page would render unstyled with /css/base.css answering
# 404.
#
# It has to come after `npm ci` (it needs vite and sass) and after the component
# fetch (static/scss/_settings.scss imports from public/components). `build:css`
# rather than `build`, because `build` chains fetch-components ahead of it and
# that has already run.
#
# That both stylesheets end up in the shipped image is not left to this comment:
# the final stage copies them out of this one by name and then asserts that both
# exist and are non-empty, so a CSS build that silently produced nothing fails
# the build. Note that `docker-compose up` bind-mounts the checkout over the
# application directory, so what Compose serves comes from the host's public/css
# and not from these copies -- GETTING_STARTED.md documents that difference and
# the command that resolves it.
RUN npm run build:css

# The production dependency tree, installed on its own from the same lockfile.
#
# Only the two manifests are copied in, so this stage re-runs when they change
# and is served from cache when only application source moves. `--omit=dev` is
# what makes it the tree that ships. It starts FROM toolchain because the graph
# contains native modules that compile during install, and it needs the git in
# the base image to resolve the one dependency declared as a git URL (marked).
FROM toolchain AS deps

USER trinket

WORKDIR /usr/local/node/trinket

COPY --chown=trinket:trinket package.json package-lock.json ./

RUN npm ci --omit=dev

# The shipped image: the pinned runtime, the locked process manager, the
# application source, the production dependency tree and the built assets.
#
# FROM base, not FROM toolchain and not FROM assets, so neither the apt layer
# nor the dev-inclusive node_modules of the build stages is inherited.
FROM base

COPY --from=pm2 /usr/local/pm2 /usr/local/pm2

# pm2 is installed locally under /usr/local/pm2 rather than globally, so its
# executables are not already on PATH. Putting its bin directory there keeps the
# CMD at the end of this file byte-identical to the one the global install
# supported: `pm2-docker` resolves the same way it always did.
ENV PATH="/usr/local/pm2/node_modules/.bin:${PATH}"

# ...and link pm2's own executables into /usr/local/bin as well, because the
# PATH above is not reachable from every context the global install served. A
# login shell -- `docker exec <container> bash -lc ...`, or anything else that
# sources /etc/profile -- discards the image's PATH and rebuilds it from
# /usr/local/bin onwards, so a container operator would find pm2 missing there
# while the CMD ran fine. `npm install -g`, which this replaces, links exactly
# the top-level package's declared bins and none of its dependencies' bins, so
# the names are read out of pm2's own `bin` map rather than listed here: that
# reproduces the previous behaviour precisely, keeps `semver`, `js-yaml` and the
# other transitive executables in that tree out of the system bin directory, and
# cannot go stale if a bump adds or drops one. This is the last step before the
# USER switch, so it is also the last thing in this image that runs as root.
RUN set -euo pipefail \
    && pm2_bins="$(node -e 'process.stdout.write(Object.keys(require("/usr/local/pm2/node_modules/pm2/package.json").bin).join(" "))')" \
    && for pm2_bin in $pm2_bins; do \
         ln -s "/usr/local/pm2/node_modules/.bin/${pm2_bin}" "/usr/local/bin/${pm2_bin}"; \
       done \
    && echo "pm2: linked into /usr/local/bin -- ${pm2_bins}"

USER trinket

# Same allowlist-governed context as the assets stage above: `.dockerignore`
# decides what `.` is, and node_modules, public/components and the generated CSS
# are excluded there, so what arrives here is source only. The three stage
# copies below supply the rest.
COPY --chown=trinket:trinket . /usr/local/node/trinket

WORKDIR /usr/local/node/trinket

COPY --from=deps --chown=trinket:trinket /usr/local/node/trinket/node_modules ./node_modules

COPY --from=assets --chown=trinket:trinket /usr/local/node/trinket/public/components ./public/components

COPY --from=assets --chown=trinket:trinket /usr/local/node/trinket/public/css/base.css /usr/local/node/trinket/public/css/embed.css ./public/css/

# Audit the assembled filesystem, in the image, at build time.
#
# The point of the staging above is a property of the shipped tree, and a
# property nobody checks is a property that lasts until the next edit. This step
# is that check, and it fails the build rather than reporting.
#
# The devDependency list is read out of package.json instead of being written
# here, so it cannot fall out of step with the manifest: whatever package.json
# declares as a devDependency must not have a directory under node_modules. That
# is the exact shape of the regression this guards against -- a `npm ci` without
# `--omit=dev`, a COPY from the wrong stage, a stage collapsed back into one --
# and it needs no list maintained in parallel to catch it.
#
# The image ships TWO dependency roots, so both are qualified. The application
# root is the check above. The process-manager root under /usr/local/pm2 is
# checked for provenance instead: every package installed there must be one its
# own committed lockfile declares. That is the property an advisory scan cannot
# give and this can -- the tree came from the lock the `pm2` stage audited at
# `--audit-level=high`, so a drifted, hand-patched or wrongly copied
# process-manager tree fails here, while the advisory question is settled once
# at the source rather than re-asked of identical bytes.
#
# The remaining assertions cover what the stage copies are for: both generated
# stylesheets present and non-empty, the fetched component tree present and
# non-empty, and the executable the CMD names resolvable on PATH as the trinket
# user. The one-line summary is deliberate: it puts the evidence in the build
# log, where a reviewer reading a build sees it without running anything.
RUN set -euo pipefail \
    && node -e 'const fs=require("fs");const declared=Object.keys(require("./package.json").devDependencies||{});const present=declared.filter((name)=>fs.existsSync("node_modules/"+name));if(present.length){console.error("audit: development dependencies present under node_modules: "+present.join(", "));process.exit(1);}console.log("audit: "+declared.length+" declared devDependencies, none present under node_modules");' \
    && node -e 'const fs=require("fs"),path=require("path");const lock=require("/usr/local/pm2/package-lock.json");const declared=new Set();for(const [key,record] of Object.entries(lock.packages)){if(!key||record.link)continue;const at=key.lastIndexOf("node_modules/");declared.add(key.slice(at===-1?0:at+13)+"@"+record.version);}const installed=new Set();(function walk(dir){let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(err){return;}for(const entry of entries){if(!entry.isDirectory())continue;const here=path.join(dir,entry.name);if(entry.name.charAt(0)==="@"){walk(here);continue;}try{const manifest=JSON.parse(fs.readFileSync(path.join(here,"package.json"),"utf8"));if(manifest.name)installed.add(manifest.name+"@"+manifest.version);}catch(err){}walk(path.join(here,"node_modules"));}})("/usr/local/pm2/node_modules");const undeclared=[...installed].filter((one)=>!declared.has(one));if(undeclared.length){console.error("audit: process-manager packages its lockfile does not declare: "+undeclared.join(", "));process.exit(1);}console.log("audit: "+installed.size+" process-manager packages, every one declared by scripts/pm2/package-lock.json");' \
    && for artifact in public/css/base.css public/css/embed.css; do \
         if [ ! -s "$artifact" ]; then \
           echo "audit: ${artifact} is missing or empty" >&2; \
           exit 1; \
         fi; \
       done \
    && if [ -z "$(ls -A public/components 2>/dev/null)" ]; then \
         echo "audit: public/components is missing or empty" >&2; \
         exit 1; \
       fi \
    && command -v pm2-docker > /dev/null \
    && echo "audit: production-only node_modules, both stylesheets non-empty, components present, pm2-docker on PATH -- ok"

ARG COMMIT_ID
ARG NODE_ENV
ENV NODE_ENV=$NODE_ENV

EXPOSE 3000

CMD ["pm2-docker", "start", "app.js"]
