# Baseline parity

How baseline behaviour was captured, what was compared, and how each ambiguity was resolved.

| | |
|---|---|
| **Base commit** | `2f8712a` — *chore: extend catalog tags (security, web-app)* |
| **Full hash** | `2f8712a112db46f923918c4507c75abc732d83d0` |
| **Role** | The **R-f tie-breaker reference**. Every question this migration raised that the request did not settle was settled against observed behaviour at this commit |
| **Delivered tree** | The whole migration series `2f8712a..HEAD` on this branch, not a single commit inside it. `655bed89d036d32da50700b835d3f890b009a55e` closes the conversion-and-evidence series and `0716cd281c115b623cc7ea305aa12723b328251c` follows it with a lockfile-only fix |
| **Evidence commit** | `0716cd281c115b623cc7ea305aa12723b328251c` — **the exact tree every measurement in this file was taken against**, and the hash the provenance sidecars carry. It is the last commit in the series that changes anything a gate measures; every commit after it revises `docs/*.md` only, which is checkable rather than asserted: `git diff --name-only 0716cd2 HEAD -- . ':!docs'` is empty. So a later documentation revision does not invalidate a figure here, and a **non-empty** result means it might have |
| **Application-code freeze** | `9d1edf43439785863f7ce7159e08e17883e56fc6` — the last commit that changed any application, configuration or test **source**. **Measured**: `git diff --name-status 9d1edf4 0716cd2` reports `CHANGELOG.md`, this file, `docs/conversion-inventory.md`, `package-lock.json` and `test/parity/convert-inventory.js`, and nothing else. That, together with the docs-only invariant above, is why a `[T]` line address taken at the freeze still resolves in the delivered tree (see [the citation convention](#citation-convention-two-trees)) |
| **Revalidated at the evidence commit** | The route-manifest and route-table gates were **re-generated and re-compared there**, against a baseline worktree installed for the purpose, and both pass ([§3.5](#35-aggregate-counts-are-a-summary-not-the-gate)). Four gates the earlier record left unrun were driven there as well ([§5](#5-the-gate-register-and-what-each-gate-proves)) |
| **This document owns** | The corpus method, the coverage accounting, the comparison rules, the R-f resolution log, the two approved deviations, and the honest list of what is **not** proven |
| **Verified** | `git log --oneline -1 2f8712a`, `git rev-parse 0716cd2`, `git diff --name-status 9d1edf4 0716cd2`, `git diff --name-only 0716cd2 HEAD -- . ':!docs'` |

## What this document is, and what it is not

Rule **R-f** makes baseline observed behaviour at `2f8712a` the tie-breaker for every ambiguity, and
requires that **each resolution be documented**. This file is that record, and AAP §0.7 names it as
R-f's deliverable. AAP §0.9.5 makes its completeness a gate: the **corpus method**, the **coverage
accounting** and the **resolution log** must all be present.

It is also the migration's parity *evidence* document — what a reviewer reads to decide whether
"identical normalized responses" was a real claim or an assertion. So it is written to be
falsifiable. Every figure below was measured in the delivered tree by a command that is named beside
it, and **every claim that was not measured says so and names the gate that would settle it**
([§8](#8-what-remains-unproven)). A parity document that claims everything is proven is less useful
than one that says precisely what is not.

It deliberately does **not** duplicate the quirk catalogue, the dependency tables or the error-edge
rows. Those have owners ([§9](#9-cross-references)), and a second copy of a fact is a second thing to
keep in step.

## Rules that govern this record

**`review_rules` returns exactly "No user rules provided."** — verified with the tool for this
document, and independently recorded by AAP §0.7 and §0.10.1. **No rules are invented in their
place**, and their absence is not read as licence to lower the bar: enterprise practice governs, and
the two commitments it imposes on a file like this one are that **every validation claim is backed by
an inspectable artifact** and that **what was not proven is recorded as clearly as what was**.

The request's own RULES block is binding and is not that document. Each is cited, not reproduced.

| Rule | What it requires of this file | Where it is honoured |
|---|---|---|
| **R-f** | The base commit, the measurement method, and one resolution-log entry per ambiguity with the measurement that settled it | The whole file; [§6](#6-the-r-f-resolution-log) is the log |
| **R-d** | Behaviour improvements are prohibited, so a difference is a **failure** even when the new behaviour looks better. The one exception is a marked, approved deviation | [§4.5](#45-a-difference-is-a-failure-and-the-one-exception), [§7](#7-the-two-approved-deviations) |
| **R-b** | The application genuinely runs on Node 22 **in full, with no route excluded** — so the coverage accounting is R-b's proof, an unrepresented route **fails** the run, and a genuinely undrivable entry is listed here with its reason | [§3](#3-coverage-accounting) |
| **R-e** | Error-to-response mappings survive unchanged. One minimal request per route exercises **success** paths only, so the failure cases come from the changed-error-edge checklist | [§4.6](#46-failure-paths-run-beside-the-success-sweep) |
| **R-a** | The diff must read as runtime bump, hapi API migration, async conversion and blocking-only dependency swaps — so this file records decisions and adds no scope | Every resolution in [§6](#6-the-r-f-resolution-log) names the rule it serves |
| **R-c** | Replaced and deferred packages recorded with reasons | Owned elsewhere ([§9](#9-cross-references)); referenced, not restated |

### R-d and R-f do not conflict

This is worth stating plainly, because at first reading they look as though they might. R-d prohibits
behaviour *improvements*; R-f makes baseline *observed* behaviour the tie-breaker. The question that
could divide them is what to do where observable behaviour differs from what the code evidently
intended — and on that question **the two rules agree: the observable behaviour wins**. R-d forbids
"fixing" it and R-f points at the same measurement as the authority. There is exactly one class of
case where they cannot both hold, which is where a requirement *other* than R-d makes preservation
impossible; both instances are decided, recorded and evidenced in [§7](#7-the-two-approved-deviations).

The consequence for this file is a division of labour: `docs/preserved-quirks.md` owns **what** each
quirk does, and this file owns the **method** by which it was measured and the deviations approved
against that method.

## Citation convention: two trees

Two trees are cited throughout and they are never conflated:

- **`[B path:lines]`** — the **baseline** tree at `2f8712a`.
- **`[T path:lines]`** — the **delivered** tree, addressed at the **evidence commit `0716cd2`**. The
  line numbers were taken at the application-code freeze `9d1edf4` and they still resolve there,
  because nothing between the freeze and the evidence commit changed a file this document cites by
  line — measured, and the measurement is in the header table above rather than left as an assumption.
  They also resolve in any later commit of this branch for as long as the docs-only invariant in that
  same table holds, so a `[T]` address that stops resolving is a signal that the invariant has expired,
  not a formatting slip.

Line numbers moved during the migration, so a single address would be wrong for one of the two trees.
Where a claim is about a declaration rather than a line, the locator is a key path
(`[T package.json:scripts]`). Three categories take no line locator and none is manufactured for
them: **absence claims**, where the evidence is that a search over a named file set returned nothing
and the prose names the set searched; **measured aggregates**, attributed to the command that produced
them; and **statements about the target design**, which are decisions rather than assertions about an
existing system.

## Evidence legend

| Marker | Meaning |
|---|---|
| **measured** | A command was run in this delivery and its output is the evidence. The command is named. |
| **artifact** | The evidence is a committed file under `test/parity/`, readable without running anything. |
| **read** | The evidence is the delivered source, cited by path and line. |
| **not proven** | No measurement supports it yet. It appears in [§8](#8-what-remains-unproven) with the gate that would settle it. |

---

## 1. Base commit, worktrees and provenance

### 1.1 The base commit

All baseline claims, measurements and captured values are taken at **`2f8712a`**, subject
*chore: extend catalog tags (security, web-app)*, full hash
`2f8712a112db46f923918c4507c75abc732d83d0` (**measured**: `git log --oneline -1 2f8712a`). Where the
request's description of the codebase and the codebase disagree, this commit is the authority. That is
R-f, and it is the reason several of the entries in [§6](#6-the-r-f-resolution-log) resolve *against*
the request's own framing without changing its objective.

### 1.2 Two worktrees, each independently installed

**The parity tooling is created by this migration and does not exist at `2f8712a`.** Everything under
`test/parity/` is new. So a baseline measurement cannot be taken by running a tool that lives in the
baseline tree — there is none — and the architecture follows from that:

1. An **untouched baseline worktree** is created at the base commit and left alone:

   ```console
   $ BASELINE=<any path outside this checkout>
   $ git worktree add --detach "$BASELINE" 2f8712a
   $ git -C "$BASELINE" rev-parse HEAD
   2f8712a112db46f923918c4507c75abc732d83d0
   ```

   The path is a **parameter, not evidence**: the worktree is identified by the commit it is at, which
   `rev-parse` prints, and every command below is quoted with `$BASELINE` rather than with the path one
   clone happened to use. An earlier revision of this document quoted absolute paths from three
   different working clones, which read as though the path mattered and could not be followed by anyone
   else.

2. It is given its **own `npm ci`, from the baseline lockfile** (**measured**: exit 0, 642 packages).
   It cannot share the delivered tree's `node_modules`: the two dependency graphs differ by design —
   `@hapi/hapi` 20.3.0 against 21.4.10, `joi` 17.13.3 against 18.2.5, and a dozen further moves
   recorded in `docs/dependency-inventory.md` — so a shared install would have measured the baseline
   application against the target's dependencies and proved nothing about either.

3. The **tooling lives in the delivered worktree** and is invoked with `--app <baseline path>`.

### 1.3 What "captured at baseline" means, precisely

The loose phrasing is misleading, so it is spelled out:

> **Captured at baseline** means *captured by delivered-worktree tooling, invoked with
> `--app <baseline path>`, which spawns the application as a **child process** with that path as its
> working directory so that module resolution uses the **baseline's own install**.*

Two properties make it checkable. The tools require **no application source into their own process** —
the application is always a child — so a tool cannot accidentally measure the tree it happens to live
in. And every artifact a tool WRITES carries a **`provenance` block of its own**, recording both
trees, so "which tree did this measure" is answerable from the artifact rather than from a claim.

That is a property of the tools, not a claim about every committed file: two committed artifacts
predate the contract and carry no block, they are named as such in
[§1.4](#14-tool-provenance-per-artifact), and each is refused by the consumer that would otherwise
read it. An artifact with no provenance is not evidence, and the distinction between "the tools
always record it" and "every file here has it" is the difference between a checkable claim and a
comfortable one.

The block is **embedded** — a top-level `provenance` key in a JSON artifact, a single
`<!-- provenance-json: … -->` line in a generated Markdown document — and that is deliberate. An
earlier arrangement kept it in a sibling `<artifact>.provenance.json`, which made the claim depend on
a second file that could go missing, and in the delivery it did: `corpus.json` declared a companion
mandatory while no such file existed, and the one sidecar that *was* committed named a clone that is
not this repository. A sidecar is still **written as a run output** by every tool, and it is not
committed; all it adds over the embedded block is an `artifactDigest` over the exact bytes written,
for a scratch run that compares two artifacts byte for byte and needs the provenance outside the
compared region.

Nothing in a block comes from a clock, a PID, a port, a database name or a filesystem path, and
`test/parity/manifest.js` enforces that at write time rather than trusting it: a block containing an
absolute path, an ISO instant or any of 21 prohibited key names throws before the artifact is
written. That is what makes two runs over one tree produce the same bytes, and it is why a block can
be read as evidence in a clone other than the one that produced it.

### 1.4 Tool provenance, per artifact

A tool is identified by the **blob** of the source that ran, not by the HEAD of whatever clone ran it.
A blob is the same object in every clone that holds the file, so `git cat-file blob <id>` retrieves the
exact source from this repository; a commit is then *resolved* from that blob and recorded only when
its tree is verified to hold that path as that blob. The delivered head is recorded the same way and
resolved as a commit here. Every row below is `test/parity/manifest.js --verify-provenance` output
rather than a transcription of the artifact's own claims: for the two artifacts that carry a block it
is the verified result of those lookups, and for the two that carry none it is what the same command
reports about them.

| Artifact | Analysed tree | Tool | Tool blob → commit | Status |
|---|---|---|---|---|
| `docs/error-edge-inventory.md` | the delivered tree at `5f57271635…`, compared against a worktree at `2f8712a112db…` | `test/parity/error-edges.js` | `ffb4b3c7a50f…` → `5f57271635…`, **verified** | **evidence** — header block, role `analysis`; 332 rows over 12 files, `--counts-check=auto`, closure comparison run against the baseline worktree and scenario coverage joined to the corpus |
| `docs/conversion-inventory.md` | the delivered tree at `9aa3d39054…` | `test/parity/convert-inventory.js` | `b0fd907735c6…` → `9aa3d39054…`, **verified**, `contains-this-exact-source` | **evidence** — embedded block, role `analysis`; 147 handler exports, the 145 + 8 + 1 conversion set, 6 residual `reply(` sites, and `--check` exits 0 against the committed rendering |
| `test/parity/joi-baseline.json` | `2f8712a112db…` — **the base commit** | `test/parity/joi-matrix.js` | tool at `c6ecfd160ec3…`, clean | **evidence, sealed in a sidecar** — `test/parity/joi-baseline.json.provenance.json`, role `baseline-capture`, joi 17.13.3, digest matched. The gate verifies it in its own preflight and `verify:joi` exits **0**. Its sidecar uses this tool's own vocabulary, which is the divergence recorded in [§7.2](#14-tool-provenance-per-artifact) |
| `test/parity/corpus.json` | `2f8712a112db…` — **the base commit** | `test/parity/capture.js` | tool at `0716cd2811…` — the base commit's `capture.js`, not the delivered one | **measured evidence, with a stated precondition** — 383 of 383 scenarios carry a recorded baseline and `summary.captured` is `true`; provenance is a sidecar in the capturing tool's own vocabulary (`corpus.sha256 b4af89aa…`, `baseline.commit 2f8712a112db…`), and the delivered `replay.js` requires an embedded block, so `verify:corpus` exits **2** until the corpus is re-captured through the delivered generator ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)) |
| `test/parity/corpus.secure.json` | `2f8712a112db…` — **the base commit**, secure-cookie pass | `test/parity/capture.js` | tool at `0716cd2811…` — as above | **measured evidence, same precondition** — sidecar role `baseline-response-corpus`, `cookiePass: secure`, `corpus.sha256 70319abf…`; 382 of 383 scenarios recorded, the exception being `auth.outcome.lookup-error`, which this pass left marked unreachable rather than driving |
| `test/parity/route-manifest.json` | the delivered tree at `8ce5639054…` | `test/parity/manifest.js` | `d9fb0991a060…` → `8ce5639054…`, **verified** | **evidence** — committed, and carries the embedded block as well as the generator's own sidecar, so both the shared reader and `manifest --compare` can bind it to a tree |
| `test/parity/route-manifest.baseline.json` | `2f8712a112db…` — **the base commit**, in a worktree of its own | `test/parity/manifest.js` | tool at `f06b79e20e05…` | **evidence, in the generator's own sidecar** — `tree.head 2f8712a112db…`, `digest sha256:1f700e012ede…`; `verify:routes` reports `baseline provenance: integrity verified` before it compares, and the comparison passes 233 of 233 |

**What changed here, and why the previous version of this table could not be relied on.** It recorded
a per-clone absolute worktree path for each artifact (`/tmp/blitzy-c5/…`, `/tmp/blitzy-c8/…`,
`/tmp/blitzy-c1/…`) and a tool commit taken from the HEAD of that clone. Three of those commits do
not resolve in this repository — `d65ad8619598…` and `7feda413…` are not objects here at all, and
`6da0a28adee6…` is a commit whose tree does not contain `test/parity/joi-matrix.js`, so it cannot have
produced the joi artifact — and none equalled the head this work is delivered at. A reader could not
retrieve any of the named generators, so no chain joined the artifacts to one target state. Paths are
now absent by design: a worktree path is per-clone, is not part of the evidence, and its presence was
what made the rows look authoritative while being unresolvable.

The chain is now checkable in one command, over every artifact that carries a block (**measured**,
verbatim, on the delivered tree):

```text
$ node test/parity/manifest.js --verify-provenance \
    docs/error-edge-inventory.md docs/conversion-inventory.md test/parity/route-manifest.json
PROVENANCE CHAIN
================

OK   docs/error-edge-inventory.md
       role          analysis
       generator     test/parity/error-edges.js blob ffb4b3c7a50f in 5f57271
       analysed tree 5f57271
       delivered at  5f57271
       content bound body-digest recomputed

OK   docs/conversion-inventory.md
       role          analysis
       generator     test/parity/convert-inventory.js blob b0fd907735c6 in 9aa3d39
       analysed tree 9aa3d39
       delivered at  9aa3d39
       content bound body-digest recomputed

OK   test/parity/route-manifest.json
       role          target
       generator     test/parity/manifest.js blob d9fb0991a060 in 8ce5639
       analysed tree 8ce5639
       delivered at  8ce5639
       content bound payload-digest, sidecar-artifact-digest recomputed

One target state: YES - 3 artifact(s) written at 3 commit(s), every one on the delivered
history, and every generator still the blob that ran: 5f57271 (1), 8ce5639 (1), 9aa3d39 (1)
Artifacts verified: 3 of 3
VERDICT: PASS
```

The three commits are not three target states. Each artifact records the commit its generator was
verified in, and a generated document is regenerated whenever its generator changes — so a document
whose generator was last touched at `5f57271` records that, and the check that matters is the one the
verifier states: every recorded commit is **on the delivered history** and every generator is **still
the blob that ran**, so each artifact can be reproduced from this repository.

**Three provenance vocabularies exist in this tooling, and two of them are bridged rather than
rewritten.** The shared contract is the embedded block above. `manifest.js` additionally writes its
own sidecar (`digest`, `tree`, `tool`, `runtime`, `configuration`, `serverAuthDefault`,
`declarationCounts`), which is what `manifest --compare` reads and what carries the baseline
manifest's provenance; `joi-matrix.js` seals a sidecar in a third vocabulary, with roles
`baseline-capture`, `target-replay` and `schema-only`, which its own preflight verifies before it
compares; and the committed corpus carries a fourth, written by the capture tool as it stood at the
base commit (`corpus.sha256`, `baseline.commit`, `tool.head`).

Two readers were taught to resolve the shapes they actually meet rather than one spelling of them,
because the alternative was silent: `replay.js` resolved a corpus's tree head, tool head, tool path
and artifact digest from one shape only, and both of the guards that make a replay evidence — the
self-comparison guard and the R-f baseline guard — are conditioned on having resolved a tree head, so
against the delivered writer's output **they did not run at all** while the run still reported the
block verified. `manifest.js`'s shared verifier read only one of the two digest spellings its own
generator emits, so it judged the manifest and its own sidecar to describe different files. Both now
resolve either shape and still fail when nothing is declared, which is the `sidecar-artifact-digest
recomputed` line above. The joi vocabulary is deliberately **not** bridged: `joi-baseline.json` has
exactly one consumer, that consumer verifies it in its own preflight — measured, `role
baseline-capture, joi 17.13.3, app HEAD 2f8712a112db, digest matched` — and `verify:joi` exits 0, so
teaching the shared reader a shape nothing else asks it to read would add a path with no consumer.

Twelve properties are checked per artifact, and a failure of any of them exits 1.

**Identity.** The block's schema version. Its role, against what the consumer accepts. That a
generator source is named at all, and that the recorded generator commit is **verified** to hold that
source as the blob that ran. That the generator blob resolves as an object here and the generator
commit as a **commit** here. That the analysed tree and the delivered head are both **recorded** — a
block with neither used to pass every check and be counted into "one target state", which made the
one shape that says nothing about any tree the one shape nothing rejected — and that both resolve as
commits here. That the delivered generator is **still that blob**, so rerunning it reproduces the
artifact. And, where a baseline tree is required, that it is the base commit **and clean**: a dirty
worktree at 2f8712a holds that commit plus edits nobody can retrieve, so a measurement of it is not a
baseline measurement however the block reads.

**Content.** Every artifact is bound to the bytes it describes, and by a mechanism that suits its
shape. For a JSON artifact the `payloadDigest` is recomputed over every key except `provenance`. For
a **generated Markdown document** the `bodyDigest` is recomputed over the document with its
provenance line removed and trailing whitespace stripped per line — a canonicalization that has to
exclude that one line, because the digest is recorded inside the document it covers. A document that
records **no** `bodyDigest` fails, rather than being skipped: prose was the one artifact shape nothing
bound, so appending a row to a delivered inventory, or rewriting a generator commit in its own header
by hand, left it verifying clean. And where a **sidecar** sits beside an artifact, its `artifactDigest`
is recomputed over the exact bytes and its payload digest is required to agree with the embedded
block; the sidecar's whole contribution is that digest, and it was written and never read.

A check whose subject does not exist yet is reported as `WAIVED` with its reason rather than as a
pass, so the mode cannot report a clean chain over an artifact whose generator is uncommitted.

`69a8038c70c1…` is the commit whose tree holds the generators as the blobs that ran, and it is an
ancestor of the delivered head. A committed artifact cannot record the hash of the commit that
introduces it, so the recorded head is the state the generator was read from, and the
`generator-current` check is what closes the gap: it fails if any later commit changes the generator,
which is the only way the recorded head could stop describing the delivered one.
`git diff --stat 69a8038..HEAD -- test/parity/` shows what moved since.

One asymmetry in the two blocks is expected rather than accidental: `error-edge-inventory.md` records
`worktreeState: "clean"` and `conversion-inventory.md` records `"dirty"`, because they were
regenerated in sequence and the first document's own bytes are what made the tree dirty for the
second. `worktreeState` describes the delivered worktree at the moment of writing and nothing else;
the field that answers "one target state" is `delivered.head`, and it is `69a8038c70c1…` in both.

### 1.5 The execution-order consequence, and the order actually delivered

**The observer must exist before the baseline can be observed.** That single fact fixes the intended
order, and it reads backwards until it is stated:

1. Build and validate the parity harness **first**, in the delivered worktree.
2. **Then** freeze and capture the baseline, through `--app`.
3. **Then** repair the suite and its provisioning, so the existing assertions run.
4. **Then** convert handlers and pre-handlers under the retained compatibility shim.
5. **Then** remove the shim and re-run every gate.

So "baseline first" means *before any behaviour-changing change* — **not** before creating the tools.
This is safely orderable because the shim intercepted only an `undefined` result and passed any
defined result straight through, so a handler converted to return its response already worked
underneath it, and converted and unconverted handlers coexisted.

**The order actually delivered was different, and R-f requires the record to say so** (**measured**:
`git log --oneline 2f8712a..HEAD`, oldest first): the dependency set and runtime pin (`decfd63`), then
support modules (`b97fe4c`), then the controller and pre-handler conversions
(`3dc7bb1`, `ad033e0`, `9350b56`), then **shim removal** (`1680624`), then the fixtures and auth
scheme (`8834214`), and only then the harness and parity tooling
(`d12759b`, `81ccd5e`, `6da0a28`) and the gates and documents.

Two consequences follow, and both are load-bearing for how the rest of this document reads:

- The corpus **could not** be captured in the delivered tree by the time `capture.js` existed, because
  the tree had already been converted. Baseline capture therefore requires the separate worktree in
  [§1.2](#12-two-worktrees-each-independently-installed) for every artifact — which is what every
  baseline-side row in [§1.4](#14-tool-provenance-per-artifact) did, and what the corpus did too — its
  383 recorded baselines were driven against that worktree ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)).
- Step 3's intended reassurance — the existing assertions green *before* any conversion — was never
  available, so it cannot be cited as evidence. [§6.2](#62-npm-test-had-no-green-baseline) records what
  is known instead.

---

## 2. The corpus method — a scenario model, not 233 route keys

### 2.1 Why one request per route is not enough

A corpus keyed on the route table would be 233 entries and would miss most of what this migration
could break. Three properties of this application make that so, and each was found by driving the real
surface rather than by reading it:

- **The error funnel branches on `Accept`.** The first `onPreResponse` extension classifies a request
  as API-or-JSON by path prefix or by the `Accept` header, and for a browser HTML request it **returns
  early** on 401, 404, 403 and any status ≥ 500 — before the `Cache-Control` / `Pragma` / `Expires` /
  `X-Frame-Options` assignments (**read**: `[T app.js:177-226]`). The same route therefore answers with
  a different header set depending on the header sent, so HTML and JSON are **separate cases**, never
  one case with a normalized header.
- **Several behaviours exist only for a particular identity.** The two `pages` handlers that answer 500
  are on the `request.auth.isAuthenticated` branch, and an unauthenticated probe of the same paths
  returns 200 — which is why the pre-existing shell smoke check never detected them.
- **Some behaviours require a *repeated* request.** The `fail.redirect` cross-request state leak is
  invisible to any single request: the second request to the same route redirects to the first
  request's interpolated target. A corpus of independent cases cannot express it.

### 2.2 What a case carries

A scenario is a route **plus** the conditions under which it is driven. Each definition carries
(**read**: `test/parity/capture.js`, the scenario builder):

| Field | What it fixes |
|---|---|
| `route` | `{method, path}`, taken from the manifest and joined on the manifest's own `routeKey`, so the two artifacts cannot disagree about what identifies a route |
| `identity` | One of `anonymous`, `user`, `admin`, `disabled`, `missingRecord` |
| `accept` | HTML or JSON, as separate cases — never merged |
| `intent` | `success`, `failure`, `redirect`, `timeout`, `unknown-payload` or `unreachable` |
| `mutating` | Whether the case writes; mutating cases are ordered last |
| `fixtureProfile` | Which external-effect recording is in force |
| `freshSession` | Whether the case needs its own session rather than the shared jar |
| `covers` | The manifest route keys the case accounts for in the coverage table |
| `expectation` | A declared baseline expectation that is **checked** rather than assumed |
| `steps` | An **ordered sequence**, where a quirk needs more than one request |

The identity set is measured rather than nominal. `missingRecord` is **not** a seeded user: it is a
session whose `userId` names a record that has been deleted **through the application's own route**,
which is the only way to reach the "User not found" outcome without reaching into the database from
the harness. The account it sacrifices is a fixed throwaway registration, deliberately distinct from
every seeded identity so that no fixture is consumed.

The composition of the committed definitions (**artifact**: `test/parity/corpus.json`):

| Dimension | Distribution |
|---|---|
| Total scenarios | **383** |
| Groups | `route-sweep` 349 · `auth-outcome` 5 · `quirk.*` 20 · `error-edge.*` 9 |
| `Accept` | JSON 248 · HTML 135 |
| Identity | `anonymous` 243 · `user` 125 · `admin` 13 · `disabled` 1 · `missingRecord` 1 |
| Intent | `success` 337 · `unknown-payload` 21 · `failure` 19 · `redirect` 3 · `timeout` 2 · `unreachable` 1 |
| Mutating | 120 |
| Multi-step | 6 |

The six multi-step sequences are the cases that cannot be expressed as independent requests, and the
sequence is part of the definition precisely so a replay cannot reorder them:
`quirk.fail-redirect-leak.post-users` (the **two consecutive requests** the state leak requires),
`quirk.folders-trinkets.queryless-and-query-bearing`, `quirk.dead-301.course-by-slug-alias`,
`quirk.oauth.new-user-created-then-failed`, `quirk.oauth.existing-user-succeeds`, and
`auth.outcome.user-not-found` (four steps: register, authenticate, delete, then request).

### 2.3 Paths are materialized, and mutations run last

**Wildcard and static path segments are materialized to concrete values from the fixed-`_id` seeds**
(`test/parity/seed.js`), never to an invented identifier. That is a deliberate ordering of two
options: a generated id would have to be added to the volatile set and normalized away, whereas a
seeded id is **compared exactly**. Seeding beats scrubbing, and [§4.4](#44-the-volatile-set-six-categories-taken-from-the-code)
records the cases where seeding was not available.

Two ids that look cosmetic are not. Scenario ids **spell out a trailing slash and preserve the path's
own case**, because `/python` and `/python/` are different routes with different controllers, and both
`/R` and `/r` are registered — so the obvious slug would silently collide two routes onto one id, and
`--only` selects and `--append` merges by that id.

**Mutating routes are driven last**, with minimal payloads that satisfy the declared validation, and
the payload is recorded beside the response so a reviewer can see what was sent rather than inferring
it. Read-only cases run first, so a mutation cannot change what an earlier read observes.

### 2.4 Every case has a finite timeout, and an expected timeout is a result

Each step carries a finite budget — 15 000 ms by default, and 4 000 ms for a case whose baseline
expectation *is* a timeout, so a known hang does not add dead time to every run (**read**:
`test/parity/capture.js`). The driver never rejects: a response, a timeout and a transport failure are
all **recorded outcomes**, because a harness that throws on the interesting case produces a corpus
missing the interesting case.

**An expected timeout is a recordable result.** That is the mechanism by which the never-settling
image-download branch at `[B lib/controllers/files.js:98-100]` **was** captured without hanging the
harness, and the reason the approved deviation in
[§7.1](#71-deviation-1--the-never-settling-file-response) is expressible as a change **from a timeout
to an answer** rather than as a failure. Both halves are now measured: the committed corpus records
`timedOut: true` for that step against the base commit, and a replay against this tree records the
same step `timedOut: false` and classifies the scenario `approved-deviation` with `failing: false`
([§7.1](#71-deviation-1--the-never-settling-file-response)). The corpus summary counts
**2 timed-out steps**, so a timeout is visible in the artifact as a recorded outcome rather than as a
missing one. A companion case, `error-edge.asset-from-url.transport-refused`, also declares an
expected timeout and is **not** a deviation: that route is left unsettled in the delivered tree too,
so its timeout is preserved behaviour and a 200 there would be a failure.

### 2.5 The isolation architecture — interception at the module boundary

A corpus that depends on the network is not reproducible, so **no external effect is reached over the
network**. Every one is intercepted at the **module boundary**, in fixtures the launcher preloads
**before** the application (**read**: `test/parity/fixtures/`):

| Fixture | What it replaces |
|---|---|
| `fixtures/aws.js` | The S3 client's `putObject`, `getObject`, `deleteObject` and `headObject`, with a filesystem-backed store rooted at a per-run temporary directory |
| `fixtures/mail.js` | `mailer.send`, capturing every call rather than delivering it |
| `fixtures/http.js` | The Google OAuth token and profile endpoints and the reCAPTCHA verify endpoint, with recorded responses covering **every** branch — including transport failure and malformed JSON |
| `fixtures/model.js` | Nothing, by default. It is the fault **injector**, not an isolation layer: it wraps `lib/models/user`'s `findById` where the application publishes it and rejects one armed lookup, which is the only way the auth scheme's fifth outcome is reachable — [§4.7.1](#471-the-fifth-outcome-and-how-it-is-reached) |
| in-memory queues | Reached through the application's own `db.redis.enabled: false` path, so no Bull or Redis is involved |
| uploads | Rooted at a per-run temporary directory |

Four of them, and the fourth is the odd one out in two ways worth flagging here: it replaces no
external effect, and it is **inert unless armed** — a run that never writes an arming gets exactly
the application's own behaviour from it.

`fixtures/http.js` patches `globalThis.fetch` and an endpoint it holds **no recording for rejects**
rather than falling through to the network. That is a correctness property, not a convenience, and it
has one measured consequence the harness had to be built around: a driver built on global `fetch`
would have had **its own** requests to localhost rejected the moment the catalogue loaded, so
`capture.js` and `replay.js` drive through `node:http`/`node:https` and restore the patch in their own
process immediately. The copies that matter run in the **child**.

Two gaps in this arrangement are recorded rather than papered over, because both were closed by
working around a sibling artifact rather than by editing it:

- **The OAuth handlers guard on a configured Google client**, and the server overlay declares none, so
  without one both branches short-circuit and the OAuth quirk is unreachable. `capture.js` injects an
  obviously fake client as an explicit top `NODE_CONFIG` layer. The values are **not credentials**:
  the token and profile endpoints are intercepted, so nothing authenticates against anything.
- **`fixtures/http.js` asks that its `existing` OAuth identity be seeded as a user, and the seeder does
  not seed it.** The fixture's alignment call runs only inside the server process and its environment
  contract carries no identity variable, so neither artifact can be aligned from the other. Rather
  than edit a sibling artifact, the existing-user branch is reached as an ordered two-step sequence in
  which **step 1 takes the new-user branch, which creates the account precisely because of the quirk
  under test**, and step 2 then matches it. The gap is real and is recorded here; closing it in the
  seeder would make the sequence unnecessary but would not change what it captures.

One further reachability limit, measured rather than assumed: **reCAPTCHA's four HTTP-level outcomes
cannot be reached through a route at all.** Under `NODE_ENV=test` the verify helper short-circuits on
its `isTest` flag before any HTTP happens, and adding a secret to the overlay does not help because
the short-circuit is on the environment, not on the secret. No secret is added.

**What exists for those four outcomes is a definition, not an exercise, and the difference matters.**
`fixtures/http.js` defines each as a named profile — `recaptcha:success`, `recaptcha:rejected`,
`recaptcha:non-200`, `recaptcha:transport-failure` and `recaptcha:malformed-json` — and states the only
route to them: a **direct require of `lib/util/recaptcha.js` without `config/app.config`**, which is
what leaves `config.isTest` undefined, together with a configured secret. **No delivered harness
performs that invocation** (**measured**: `grep -rn "util/recaptcha" test/` matches only comment lines
inside `test/parity/fixtures/http.js`; nothing under `test/` requires the module). So the four
outcomes are **defined and unexercised**, and they appear in [§8](#8-what-remains-unproven) with the
harness that would settle them. An earlier version of this section said they were exercised by direct
module-level invocation; that was a description of the intended mechanism read as a report of a run,
and it is corrected here rather than elsewhere because this file is where the claim was made.

**Redirects are not followed.** A `Location` header is part of the surface under comparison, and
following it would replace the measurement with its consequence. Note that both redirect mechanisms
appear in the corpus and they differ: the route parser builds **absolute** locations from the
configured url, while the 401 branch of the error extension emits a **relative** `/login`.

### 2.6 The server overlay, and why one was needed

`config/test.yaml` sets **`app.start: false`** (**read**: `[T config/test.yaml]`), so
`NODE_ENV=test node app.js` starts nothing. That is measured, not assumed, and it is why an external
overlay exists rather than an edit to committed configuration.

`test/parity/server-overlay.json` (**artifact**) supplies exactly what a listening, isolated,
reproducible server needs and nothing else: `app.start: true`, an explicit `127.0.0.1` host and port,
the isolated database, `db.redis.enabled: false`, a fixed non-production session secret, and an
`aws.buckets.exports` entry pointing at the filesystem-backed store. That last one is not a
convenience — committed configuration declares no `exports` bucket although the worker dereferences
its `name` and `host`, so without the overlay the export path is not exercisable at all. The gap
itself is recorded as an existing deployment requirement in `docs/preserved-quirks.md`;
`config/default.yaml` is not changed, because its bucket values are deployment-specific placeholders.

The overlay is passed as **`NODE_CONFIG`**, which is the whole point of its being a file rather than a
patch: it applies to **both worktrees** without editing either, so the baseline is measured with the
same configuration as the delivered tree and neither tree is modified to be measurable.

**It is run twice**, because the cookie contract has two configurations and only one of them exercises
the private-field patch's `SameSite` half:

1. **Non-secure** — `isSecure` unset, yielding Yar's `SameSite=Lax` and no `Secure`.
2. **Secure** — `--secure`, where the patch appends `"; SameSite=None; Secure"`
   (**read**: `[T app.js:254]`).

Each pass runs against its own freshly provisioned database and its own server, and each is reported
separately. **The honest limit of the second pass is stated in the gate's own source and is repeated
here**: the committed corpus definitions were built for the launcher's non-secure default, so there is
no recorded baseline for the secure pass. It therefore replays the **same** scenarios in the **same**
order — a subset would change the cross-request session state some responses embed, which was measured
— and asserts the **documented differential** on the cookie attributes: `Secure` becomes true on every
session cookie, `SameSite` moves `Lax` → `None` on the cookies the patch touched, and the `Expires`
horizon is unchanged. Every other field is compared exactly, because `isSecure` moves nothing else.
**That differential is a derived contract, not a measurement**, and capturing a secure-pass corpus and
passing `--secure-corpus <path>` replaces it with an exact comparison.

### 2.7 Database provisioning

Nothing in the repository at baseline starts MongoDB; the suite simply connected to localhost. The
mechanism selected is **`mongodb-memory-server`, pinned to the exact version `11.2.0`**
(**read**: `[T package.json:devDependencies]`), because it is the only option that works under the
user's own stated sequence — `git clean -xfd && npm ci && npm test` — on a host with no Docker.

`test/parity/mongo.js` starts it, generates a **per-run isolated database name**, publishes the
connection string into `NODE_CONFIG` **before `config` is first loaded**, and stops it on exit, on
failure and on `SIGINT`/`SIGTERM`. The `test` script is `node test/parity/mongo.js -- mocha`
(**read**: `[T package.json:scripts]`), so the user's `npm test` is unchanged; the bare `--` is a
fixed interface that script depends on. The same module backs the corpus and worker harnesses, so the
suite and the parity tooling provision their databases the same way.

One environment note, observed in this delivery and recorded because it changes nothing but looks
alarming: where a host already carries a `mongod` binary and `MONGOMS_SYSTEM_BINARY` points at it,
`mongodb-memory-server` reports a version conflict between the system binary and the version it would
otherwise download, and proceeds with the system binary.

### 2.8 Capture status, and the one precondition the replay gate carries

**The corpus is captured.** It holds a recorded baseline for every scenario it defines, driven against
a real `git worktree` at `2f8712a` with its own `npm ci`, and its own summary block says so
(**artifact**: `test/parity/corpus.json`, `summary`; 2 790 451 bytes, sha256 `b4af89aa…`):

| `summary` field | Value |
|---|---|
| `captured` | **true** |
| `scenarios` / `definedScenarios` | **383** / **383** |
| scenarios carrying a non-null `baseline` | **383** (re-derived over the `scenarios` array, not read from the summary) |
| `baselinesPending` | **0** |
| `routes` / `routesRepresented` | **233** / **233** |
| `recordedSteps` | **394** |
| `segmentsMerged` | **2** |
| `applicationDied` | **false** |
| `unreachableByDesign` | **0** |
| `expectationsUnmet` / `declaredExpectationsUnmet` | **0** / **4** |
| `timedOutSteps` | **2** |

Four of the 383 carry a null HTTP status **by design**, and each is a recorded outcome rather than a
gap: `quirk.reply-chain.never-settles.image-download` (the never-settling chain — recorded as an
expected timeout, which is what makes the approved deviation in
[§6](#6-the-r-f-resolution-log) an evidenced change rather than a failure),
`auth.outcome.lookup-error` (reached only by fault injection, [§4.7.1](#471-the-fifth-outcome-and-how-it-is-reached)),
and `route.post.api-users-email.json` and `route.post.api-admin-user-userId.json` (the crash route
below and its neighbour). The **4** unmet *declared* expectations are likewise measured, not broken:
three `error-edge.asset-from-url.*` scenarios answer **501** because `[config/default.yaml:3]` ships
`features.assets: false`, and `quirk.oauth.existing-user-succeeds` needs a Google client this tree
does not configure.

**The precondition.** `npm run verify:corpus` — a `replay.js` run against the **committed** corpus —
**exits 2** as delivered, and the refusal is the provenance contract working rather than a defect
(**measured**, verbatim):

> replay: the corpus `test/parity/corpus.json` does not carry provenance this replay can rely on, so it
> is not evidence about a known tree:
> - present: no provenance block was found, so the artifact does not say which tree it measured and is
>   not parity evidence

The corpus records its provenance in a **sidecar**, `test/parity/corpus.json.provenance.json`, whose
fifteen keys are its own vocabulary (`corpus.sha256`, `baseline.commit`, `tool.head`, `segments`,
`payloads`, `verification`, …) rather than the embedded contract block
[§7.2](#14-tool-provenance-per-artifact) requires. That sidecar is cryptographically sound — its
`corpus.sha256` is the artifact's actual digest `b4af89aa…` and its `baseline.commit` is
`2f8712a112db46f923918c4507c75abc732d83d0` — and it is the reason the figures above can be quoted at
all. What it also records is why a replay cannot consume it: `tool.head` is
`0716cd281c115b623cc7ea305aa12723b328251c`, so the capture was driven by `capture.js` **as that file
stood at the base commit**, not by the `capture.js` delivered here. The delivered replay refuses an
artifact it cannot bind to a known generator, on its own stated grounds that *an invented status would
make the parity gate pass against a fiction*, and it will not silently accept a foreign vocabulary to
get to a pass.

So the gate is **stated as a precondition, not claimed as a pass**: the corpus content is the measured
baseline evidence recorded above, and running `verify:corpus` requires a re-capture with the delivered
`capture.js`, which then writes the embedded block the replay validates. That the pair works end to end
was proved on a bounded capture — 8 scenarios, both cookie passes, `differenceRecords: 0`, both
provenance chains verified, and the never-settling deviation materialising `timed-out -> answered` —
so what remains is a full-corpus re-capture, not an unproven mechanism.

The remedy the tool itself names is given here with **quoted shell variables** rather than
angle-bracket placeholders, because `<` and `>` are redirections and the first path contains spaces in
the form the earlier record used — so that form did not survive being pasted:

```console
$ BASELINE="$PWD/../baseline-2f8712a"   # a git worktree at 2f8712a, with its own npm ci
$ CORPUS="$PWD/../corpus-2f8712a.json"  # outside the checkout: a capture is evidence, not source
$ node test/parity/capture.js --app "$BASELINE" --out "$CORPUS" --expect-baseline
$ node test/parity/replay.js  --app . --corpus "$CORPUS" --annotations test/parity/corpus.json
```

The `--annotations` flag is not optional in practice. A capture **replaces the scenario array
wholesale** and `capture.js`'s builder emits neither `expectedDeviation` nor `unreachableReason`, so a
captured corpus arrives **without the one marker that distinguishes an approved change from a
regression**. Rather than defaulting to a marker source — which would make the deviation control
vacuous — the flag joins the markers back on by scenario id and the report says which source supplied
each one. With no `--annotations`, a missing marker makes the difference **fail**.

#### The measured single-pass blocker

A capture of all 383 scenarios in **one** pass does not complete at `2f8712a`, and the cause is in the
application rather than in the tooling (**measured**, recorded in the corpus's own notes and
independently corroborated below).

Route `POST /api/admin/user/{userId}` reaches `admin.updateUser`, whose `User.findById` callback does
`if (err) return request.fail(err)` at `[B lib/controllers/admin.js:158-160]`; `request.fail` hands
the `Error` to `h.response` at `[B lib/util/routeParser.js:510]`; hapi asserts *"Cannot wrap an
error"*; and the resulting **uncaught async exception exits the process**. Measured three times,
including with that one scenario driven alone against a fresh database and a fresh server, where it
records `ECONNRESET` in under 20 ms. Every case driven after it records a transport failure that means
nothing.

Independent corroboration from a tool that *did* complete: the joi matrix recorded **7 application
crashes and 7 restarts** across its 462 drives (**artifact**: `joi-baseline.json`, `summary`), which
is the same failure mode reached from a different direction and is why that tool carries restart
logic at all.

The operational consequences are part of the method and are recorded so a later capture does not
discover them again:

- Capture in **coherent segments** and record that scenario **on its own**.
- Do **not** commit post-crash transport failures as baselines.
- Do **not** merge passes that ran on different **ports** — absolute `Location` values embed the port.
- Do **not** merge passes that ran against differently mutated **databases**; this was measured to lose
  the seeded user session and turn the authenticated `/login` 500 into a 200, which would have
  silently erased one of the preserved quirks.


---

## 3. Coverage accounting

This is R-b's proof. A gate that passes while some routes were never exercised proves nothing, so
coverage is not a report alongside the gate — it **is** part of it.

### 3.1 The route surface, re-derived from the delivered manifest

Every figure below was **re-derived from the `entries` array** of the generated manifest, not read from
its own summary block, so the summary and the entries corroborate each other rather than one restating
the other (**measured**: `node test/parity/manifest.js --out /tmp/target-manifest.json`, then a
reduction over `entries`).

| Measure | Value |
|---|---|
| **Registered routes** | **233** |
| By method | GET **137** · POST **63** · PUT **19** · DELETE **13** · PATCH **1** |
| Effective auth | **126** inherit the default (`{strategy: 'session', mode: 'try'}`, `[T app.js:310]`) · **105** declare `auth: 'session'` · **2** declare `auth: false` |
| Routes with pre-handlers | **161** (288 pre-handler entries in total) |
| Routes retaining `options.validate` after parsing | **0** |
| Routes with a **non-function** handler | **2** — the Inert directory routes, `GET /{path*}` and `GET /cache-prefix-{timestamp}/{assetType}/{path*}` |
| Routes carrying `options.handler` functions | **2** — `GET /about` and `GET /help` |
| Routes answering through the missing-controller fallback | **3** |
| Validation targets, pre-parse | **102** — payload **75** · query **26** · params **1**, across **97** routes |
| Routes with `ext: true` producing a `.json` duplicate | **0** |

The three fallback routes, named so their disposition is visible rather than aggregated away
(**measured**, from the manifest's `handlerKind`):

```text
GET  /api/trinkets/active   -> trinket.risingActive   (not defined)
GET  /api/trinkets/popular  -> trinket.mostActive     (not defined)
POST /api/interest          -> pages.interest         (not defined)
```

The **0** in the `options.validate` row is load-bearing rather than incidental: it proves that the
parser's `delete route.options.validate` executes for every route that declares a validate block, which
is the measurement behind the decision in [§6.6](#66-native-hapi-validation-is-unreachable-here). It is
also why the joi matrix cannot read its schemas from parsed routes — see the same entry.

### 3.2 The 233 reconciliation

The registered total is not the declaration count, and the arithmetic is checkable
(**measured**: `grep -c '^[[:space:]]*route[[:space:]]*:'` on each declaration module, then requiring
each module and reading its exported length):

| Contribution | Count | How it was counted |
|---|---|---|
| Literal `route :` declarations in `config/routes.js` | 62 | grep |
| Literal `route :` declarations in `config/api_routes.js` | 116 | grep |
| **Literal declarations** | **178** | 62 + 116 |
| Per-language expansion loop, `[B config/routes.js:550]` / `[T config/routes.js:551]` | **50** | `config/routes.js` exports 112 objects; 112 − 62 = 50 |
| **Objects the two modules export** | **228** | 178 + 50 — corroborated by requiring both modules: 112 + 116 = 228 |
| Static pages synthesized by `addStaticPages` | **2** | manifest |
| Static routes registered by `addStaticRoutes` | **3** | manifest |
| **Registered routes** | **233** | 228 + 2 + 3 |

So **178 + 50 = 228**, and **228 + 2 + 3 = 233**. No `.json` duplicate contributes: the `ext: true`
path produces **0** routes at this commit, measured in both trees.

### 3.3 The coverage gate

`replay.js` accounts every scenario against every entry in the 233-entry manifest, joined on the
manifest's own route key, and the accounting decides the run (**read**:
`test/parity/replay.js`, `accountCoverage` and `accountCoverageCheck`):

| Condition | Outcome |
|---|---|
| A manifest route with **no** scenario | **FAILS** the run, and the unrepresented keys are named |
| A scenario naming a route key the manifest does not carry | **FAILS** the run — the two artifacts are out of step |
| A route with a success-path scenario but **no failure-path** scenario | **Reported**, not failed — the corpus decides which routes have error edges worth driving ([§4.6](#46-failure-paths-run-beside-the-success-sweep)) |
| A route whose only scenario is marked unreachable | Listed with its stated reason, never silently omitted |
| A narrowed run (`--only`, or a single cookie pass) | Labelled **`gateQualifying: false`** in both artifacts and in the closing line, so a diagnostic cannot be mistaken for the gate |

There is no `--force`, no threshold that lets *N* differences through and no pass-with-warnings mode;
no option in the argument parser can turn a difference into a pass.

**Coverage of the committed definitions** (**artifact**: `corpus.json`, `coverage` and `summary`):

| Measure | Value |
|---|---|
| Manifest routes | **233** |
| Routes represented by at least one scenario | **233** |
| Routes **unrepresented** | **0** |
| Scenario route keys unknown to the manifest | **0** |
| Scenarios unreachable by design | **0** — it was 1 until the fifth auth outcome became drivable ([§4.7.1](#471-the-fifth-outcome-and-how-it-is-reached)) |

So **every one of the 233 routes is represented**, which satisfies the structural half of R-b's
requirement. The baseline half of the measurement is **done** — all 383 scenarios carry a recorded
response, driven against a worktree at the base commit — and what is outstanding is the **comparison**
against the delivered tree, which waits on the re-capture precondition in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries).
Representation proves the corpus addresses every route; a recorded baseline proves what each route
answered at `2f8712a`; only the replay proves the two agree.

### 3.4 The unreachable list, with reasons

This file is where a genuinely undrivable entry is recorded. **No route is unreachable, and no
scenario is either.** One group of *outcomes* is:

| Entry | Kind | Stated reason |
|---|---|---|
| reCAPTCHA outcomes 3–6 | Outcomes, not routes | Unreachable over HTTP: under `NODE_ENV=test` the verify helper short-circuits on its `isTest` flag before any HTTP happens, so the 200, non-200, transport-failure and malformed-JSON branches cannot be reached through a route however the fixture is configured. Adding a secret does not help — the short-circuit is on the environment. Exercised by direct module-level invocation in the fixture harness instead |

That entry is a refusal to fake a measurement, which is the same discipline as
[§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) applied at the level of a single case.

**`auth.outcome.lookup-error` used to be listed here, and it should not have been.** The row read:
the fifth auth-scheme outcome needs the `User` lookup itself to fail, no HTTP request can cause
that, so the scenario carries its reason rather than being simulated — and it added that the outcome
"is asserted directly against the scheme by the server-level gate, which can inject the fault."
**No such gate existed.** `test/parity/server.js` preloaded three fixtures, none of them reaching a
model, and `replay.js`'s auth check accepted the scenario on the strength of its reason string
alone — counting it toward the number of outcomes asserted. So the gate reported five outcomes
asserted while driving four, and the shortfall was invisible precisely because it was documented.

The gate now exists. `test/parity/fixtures/model.js` is a fourth launcher preload that injects the
failure at the model boundary, and the scenario drives the outcome for real —
[§4.7](#47-the-five-auth-scheme-outcomes-and-the-evidence-state-of-each) carries the mechanism, the
three steps and the measured evidence.

### 3.5 Aggregate counts are a summary, not the gate

**Swapping the auth mode between two routes leaves every figure in [§3.1](#31-the-route-surface-re-derived-from-the-delivered-manifest)
unchanged.** So do a controller rebinding between two routes of the same method, a success template
exchanged between two pages, and a pre-handler list moved from one route to another. Every one of
those is exactly the kind of regression this migration could plausibly introduce, and none is visible
in a total.

The manifest generator says so in its own artifact, at the head of the summary block it emits:

> SUMMARY, NOT THE GATE. Swapping auth between two routes leaves every figure here unchanged; the pass
> condition is the per-entry comparison performed by `--compare`.

**The pass condition is therefore an entry-by-entry comparison, keyed on method and path, with
effective auth compared per entry** — and with the controller binding, handler kind, pre-handler list,
pre-parse validation keys, success and fail templates, reply projection, cookie flag and route options
compared per entry alongside it.

**Measured in this delivery, and it passes.** The baseline manifest was generated by delivered-tree
tooling against the independently installed baseline worktree, and the two were compared:

```console
$ node test/parity/manifest.js --app "$BASELINE" \
    --out /tmp/baseline-manifest.json >/dev/null 2>/dev/null
$ node test/parity/manifest.js --out /tmp/target-manifest.json >/dev/null 2>/dev/null
$ node test/parity/manifest.js --compare /tmp/baseline-manifest.json /tmp/target-manifest.json
ROUTE MANIFEST COMPARISON
  baseline entries : 233
  target entries   : 233
  joined on        : method + path
  fields compared  : controller, handlerKind, auth, pre, validate, success, fail,
                     reply, cookie, ext, options

ENTRIES ONLY IN BASELINE (0)
  none
ENTRIES ONLY IN TARGET (0)
  none
ENTRIES WITH DIFFERING FIELDS (0)
  none

PASS - the HTTP surface is identical across all 233 entries
```

Both generation commands discard **both** streams explicitly. "No infrastructure" does not mean no
side effects: parsing the routes dynamically requires every controller, one of which creates the
exports queue at module load and prints on stdout, and a baseline tree additionally prints the AWS
SDK v2 end-of-support notice on stderr. Neither is suppressible from the tool, so the gate reads its
artifact from disk rather than from a stream it does not control.


---

## 4. Comparison rules and the volatile set

### 4.1 The principle: seeding beats scrubbing

Because seeding is **deterministic** — `test/parity/seed.js` creates its fixtures with fixed `_id`
values and pins every fixture date as a literal — comparison is **exact almost everywhere**. Every
field normalized away is a field the migration is no longer checked on, so the governing rule is the
one the gate's own source states:

> **Nothing is normalized away that could be compared exactly.**

That is why paths are materialized from seeds rather than from generated ids
([§2.3](#23-paths-are-materialized-and-mutations-run-last)), and why the volatile set is a closed list
written in one place rather than inline regexes scattered through the comparators: a reviewer must be
able to read the whole weakening on one screen, and an addition to it must show up as a visible diff.

### 4.2 The exactly-compared surface

Taken from the delivered comparator (**read**: `test/parity/replay.js`, the *WHAT IS COMPARED EXACTLY*
contract and the comparators derived from it):

| Surface | Compared |
|---|---|
| Status | Status code **and** status message |
| `content-type` | Exactly, less its `charset` parameter |
| `Location` | Exactly |
| `Content-Disposition` | Exactly |
| `Cache-Control`, `Pragma`, `Expires`, `X-Frame-Options` | Exactly, and **per branch as measured** — see the note below |
| Every remaining response header | Exactly, unless a named volatile-set rule removes it |
| `Set-Cookie` | **Every attribute**: name, `HttpOnly`, `Secure`, `SameSite`, `Path`, `Domain`, `Max-Age`, and the **presence and approximate one-year horizon of `Expires`** |
| HTML bodies | Rendered text; form and input names **and values**; `id` and `class` attributes; `data-` and ARIA attributes; inline-script presence; `href` and `src` values — asset URLs are part of the preserved surface, so they are **compared, not stripped** |
| JSON bodies | Structurally, so key order cannot create a false difference, with every scalar compared exactly **and by type**, and a missing key reported as a difference |
| Binary and stream bodies | Length **and** content digest |

**The four error-page headers are compared per branch as measured, not as the code's shape suggests.**
The first `onPreResponse` extension **returns early** on 401, 404, 403 and any status ≥ 500 for a
browser HTML request — *before* the `Cache-Control` / `Pragma` / `Expires` / `X-Frame-Options`
assignments (**read**: `[T app.js:177-226]`). So those four reach **API-or-JSON error responses and
non-Boom responses only**, and **not** the rendered HTML error pages, while a 400 Boom falls through
and **does** receive them. R-e forced that correction: asserting them uniformly would have been
asserting something the baseline does not do. `X-Frame-Options: deny` additionally applies only to the
five configured paths.

### 4.3 Why the cookie `Expires` assertion exists

A reviewer will otherwise read it as excessive, so the reason is recorded here.

The second `onPreResponse` extension reaches into hapi's **private state**: it wraps
`request.response._header` and appends `"; Expires=" + <one year out>`, plus
`"; SameSite=None; Secure"` in secure mode (**read**: `[T app.js:228-266]`; baseline
`[B app.js:204-240]`). It runs **only while `request.response._header` is a function**
(`[T app.js:232]`).

**If hapi 21 stopped populating that private field, the patch becomes a silent no-op**: cookie expiry
would quietly change, nothing would throw, no status would move, and no test that checks a cookie's
*presence* would notice. AAP §0.9.6 lists this as an open item precisely because its failure mode is
**silence**.

Comparing the `Expires` **horizon in whole days** — the absolute timestamp is volatile, the horizon is
not — is **the only way that no-op is detectable**. It is asserted in both cookie passes
([§2.6](#26-the-server-overlay-and-why-one-was-needed)).

### 4.4 The volatile set: six categories, taken from the code

The volatile set was read from the delivered implementation rather than from a specification, and it
**matches**: six categories, in this declaration order (**measured**: enumerating the frozen
`VOLATILE_SET` entries in `test/parity/replay.js` and comparing the count against the file's own
`VOLATILE_CATEGORY_COUNT`, which is `6` — they agree).

| # | Category | Why seeding could not make it deterministic | What coverage is lost |
|---|---|---|---|
| 1 | **Generated identifiers** not covered by fixed seeds | A document created **during** the run gets a real ObjectId and a share or invitation token gets a fresh signature; the value is minted by the code under test | Only that two runs minted the same id, which is not behaviour. Every id a scenario **reads** is pinned by the seeder and compared exactly, and the **shape** is still compared — a 24-hex id that stopped being emitted, or appeared where none was before, still differs |
| 2 | **Timestamps**, including the rendered cache prefix and recorded timing | Three clock reads: a document written during the run; the asset-URL cache prefix, which the string helper inlines at **render** time rather than reading from configuration, so no overlay or fixture can pin it; and the static handler's `Last-Modified`, which is the file's checkout mtime and so cannot agree across two independently created worktrees | The exact instant a value was produced. The cache-prefix **literal** and the rest of every asset URL are still compared exactly, `Last-Modified` is compared for **presence**, and archive contents are asserted by opening the archive in the storage and worker gates rather than by hashing it |
| 3 | **The `Date` response header** | Node writes the current instant into every response, below the application | Nothing the application decides |
| 4 | **The `ETag` response header** | A validator over a representation rather than part of it; the static handler derives it from a build artifact across two independent installs | The validator value. The body it validates is compared in full |
| 5 | **Per-request correlation identifiers** | A correlation id that repeated would not be one | Nothing measured — this application emits no such header at baseline, so the category is a **declared guard** rather than an active weakening. It is enumerated anyway so that a header appearing silently under the new framework is normalized by a named rule instead of reported as a difference nobody can act on |
| 6 | **Cookie values, and only the values** | A session cookie's value is a server-side session id minted per session; `maxCookieSize` is `0`, so session state lives on the server and a pinned value would be a forged session rather than a fixture | Nothing that could be compared. **Every attribute is still compared exactly**, and `Expires` is asserted for presence and horizon ([§4.3](#43-why-the-cookie-expires-assertion-exists)) |

Three measurements inside those categories are worth surfacing, because each one is a case where the
weakening is narrower than the category name suggests:

- **The rendered cache prefix.** Measured, **20 of 242 read-only responses** differed on this and on
  nothing else between two captures of the identical tree. Only the digits between `/cache-prefix-`
  and the following `/` are normalized; the prefix literal itself is configured and **is** compared.
- **The cookie `Expires` date.** Measured, **8 of 10 differences** between two captures of the
  identical tree. The rule is anchored on the attribute name so it can only fire inside a
  `Set-Cookie`, and the horizon is still compared in whole days.
- **Archive digests.** Measured, two captures of one tree produced two digests for the same **182-byte**
  zip and the same length both times, because a generated archive embeds each entry's modification
  time in fixed-width fields. So for zip, gzip and tar content types the **byte length is compared
  exactly** and the digest is demoted to an observation — and the archive's internal layout, object key
  and download url are asserted by `test/parity/storage.js` and `test/parity/worker.js`, which open the
  archive instead of hashing it.

One trap in category 3 is recorded in the comparator's own source and is repeated here because the two
things share a name: **the `Expires` response *header* is compared exactly** — the application sets it
to the literal `"0"` as one of its four cache headers — and so is the cookie `Expires` **attribute**,
through its own presence-and-horizon assertion. Category 3 covers the **`Date` header only**.

### 4.5 A difference is a failure, and the one exception

Under R-d a difference is a **failure even when the new behaviour looks better**. The sole exception is
a scenario carrying an `expectedDeviation` marker, and that marker is checked against what the
deviation was **approved to be** — so a deviation that did not materialize, or materialized
differently, still fails. Exactly one scenario in the committed corpus carries one
(**artifact**: `quirk.reply-chain.never-settles.image-download`, `approvedBy: "AAP 0.7"`,
`rule: "R-b"`), and it is the deviation in [§7.1](#71-deviation-1--the-never-settling-file-response).

#### This file is the declared home for justifying any addition to the volatile set

**An addition to the six categories is a weakening.** It has to be justified **here**, naming the
field, why seeding could not make it deterministic instead, and what coverage is lost — and the
comparator enforces the shape of that justification mechanically: it asserts its category count at
startup and requires every entry to carry a title, a reason, a seeding alternative and a statement of
lost coverage, so a seventh category added without them fails loudly and immediately.

**No addition was made.** The delivered set is the six categories above, which are the six the
specification names, and the enumeration in this section was taken from the code rather than from the
specification precisely so that a divergence would have shown up here. Where a delivered
normalization rule is narrower than its category — the cache-prefix pattern, the cookie `Expires`
anchor, the archive digest exemption — it is recorded above as part of category 1, 2 or 6 rather than
as a new category, which is the honest classification: each is a *timestamp*, a *cookie value* or a
*generated id* by nature, and none removes a field that seeding could have pinned.

### 4.6 Failure paths run beside the success sweep

**One minimal request per route exercises success paths only.** That is not a limitation to be worked
around; it is the reason a second source of cases exists. R-e is about the error mappings, and
preserving the three shared error funnels is **necessary but not sufficient** — the funnels are reached
from hundreds of local branches, each branch decides *which* funnel its error reaches, and some reach
none.

So the failure cases come from the **changed-error-edge checklist**, `docs/error-edge-inventory.md`,
which carries one row per changed error edge with its current disposition and its target status,
payload, side effects and timing — **332 rows over 12 files** in the delivered artifact, with
**342 of 342** baseline rows and **332 of 332** target rows accounted for and **245** edges closed.

**What the corpus delivers against those rows is a subset, and it is stated as a subset.** The
committed corpus carries a dedicated `error-edge.*` group of **9** scenarios, and of the **20**
`failure`-intent cases in the corpus 7 sit inside those groups and **13** are distributed through the
sweep, alongside **3** `redirect`-intent cases: **25 scenarios against 332 rows**, chosen as the edges
whose disposition the conversion changed most visibly rather than one per row. All 25 carry a
**recorded baseline** — 383 of 383 scenarios do ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)) — so what exists for each is an
inventory row, a scenario definition and a measured baseline response. What has **not** happened is a
full replay of them against the delivered tree, which the §2.8 precondition blocks; the relation the
gate enforces is one drivable request per changed edge, with the comparison asserting status, payload
or redirect, side effects and timing. One limit is carried into [§8](#8-what-remains-unproven): the
definitions reach **at most 25** of the 332 rows — at most, because they are not mapped to rows one to
one, so 25 is a ceiling on coverage rather than a coverage figure.

Two dispositions are called out in that inventory because a mechanical conversion silently changes
them, and the corpus models both rather than collapsing them: **log-and-continue** branches must keep
continuing rather than become rejections, and **resolve-on-later-callback** branches must not be
collapsed into an earlier `await`, because the response they produce is whichever settles first.

Coverage of the two kinds is accounted **separately**, and a route with a success case but no failure
case is **reported rather than failed** ([§3.3](#33-the-coverage-gate)) — the corpus decides which
routes have error edges worth driving, and the report is what makes that decision visible.

### 4.7 The five auth-scheme outcomes, and the evidence state of each

The auth scheme has five distinct outcomes (**read**: `[T app.js:268-305]`, baseline
`[B app.js:243-281]`), and the corpus models them **one by one rather than through a single
logged-in/logged-out pair** — which is the design decision worth recording, because a single pair
would collapse three of the five. `mode: 'try'` at `[T app.js:310]` is why guest browsing works at all
and why 126 routes carry no explicit `auth`.

**All five are modelled, and all five carry a recorded baseline.** The corpus holds a dedicated
scenario per outcome in an `auth-outcome` group of **5**, and each records what the base commit
answered (**measured**): `auth.outcome.not-logged-in` **302**, `auth.outcome.valid-user` **200**,
`auth.outcome.user-not-found` **302**, `auth.outcome.account-disabled` **302**, and
`auth.outcome.lookup-error` as a four-step sequence `302` → `302 /login` → `401` → `200`. Outcome 5 is
the one that needed machinery rather than a request, and [§4.7.1](#471-the-fifth-outcome-and-how-it-is-reached)
carries both its capture and its **replay against the delivered tree** — a match, with the injected
faults confirmed. The other four await the replay precondition in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries), so their
recorded baselines are measurements and their comparisons are not yet run. An earlier version of this
section was titled as though all five were already asserted independently, and then corrected to say
none of the four had a recorded response; the first was false and the second is no longer true, and
both corrections are here rather than in a footnote because the heading itself carried the claim.

| Outcome | Condition | Response | Corpus |
|---|---|---|---|
| 1 | No `userId` in the session | `h.unauthenticated(Boom.unauthorized('Not logged in'), {credentials: {}})` — `[T app.js:276]` | `anonymous` identity, driven throughout the sweep and as a dedicated `auth-outcome` case |
| 2 | Session user whose record is **missing** | Session cleared, `'User not found'` — `[T app.js:287]` | `auth.outcome.user-not-found`, a **four-step** sequence: register a throwaway, authenticate, delete the record through the application's own route, then request |
| 3 | User is **`disabled`** | Session cleared, `'Account disabled'` — `[T app.js:292]` | The `disabled` seeded identity |
| 4 | Valid user | `h.authenticated({credentials: user})` — `[T app.js:297]` | The `user` and `admin` seeded identities, 138 scenarios between them |
| 5 | The lookup itself **errors** | `Boom.unauthorized('Auth error')` — `[T app.js:299-300]` | `auth.outcome.lookup-error`, a **four-step** sequence with the lookup faulted below the model boundary, and the message asserted by name on a JSON-negotiated request — see below |

#### 4.7.1 The fifth outcome, and how it is reached

Outcome 5 needs `User.findById` **itself** to reject, which no request against a healthy database
can cause. That is a real obstacle, and this file previously resolved it by declaring the outcome
unreachable and attributing its assertion to a "server-level gate" that did not exist
([§3.4](#34-the-unreachable-list-with-reasons)). The obstacle is real; the resolution was not.

**The mechanism.** `test/parity/fixtures/model.js` is a fourth launcher preload, alongside the three
in [§2.5](#25-the-isolation-architecture--interception-at-the-module-boundary). Three properties make it usable as evidence rather than
as a simulation:

- It is **not application code**, so it exists on neither worktree as a shipped hook. The baseline
  tree has no `test/parity/` at all, and R-a/R-d rule out a test branch on the request path — so a
  hook compiled into `app.js` could not have driven the baseline and would have been a behaviour
  change besides.
- It wraps the model **where the application publishes it**. `app.js` assigns the undeclared
  `User = require('./lib/models/user')` — `[T app.js:313]`, baseline `[B app.js:290]` — which writes
  a global property, and the scheme reads that bare identifier. The fixture installs an accessor for
  it, wraps the assigned export **in place**, and then replaces the accessor with an ordinary
  writable property. One mechanism, identical on both trees, and nothing else in the process is
  intercepted.
- It faults **both call shapes**, because the two trees differ: the target awaits the promise
  (`[T app.js:283]`) and the baseline passes a callback into a hand-rolled `new Promise`
  (`[B app.js:254-260]`). The returned rejected promise carries a no-op `catch` before it is handed
  back, because the baseline discards that return value and an unhandled rejection under Node 22
  would end the process — a harness fault wearing the costume of an application crash.

**Why the fixture does not require the model, and why it does not hook `require`.** Requiring
`lib/models/user` from a preload would pull in `mongoose-schema-extend`, whose Proxy polyfill
replaces the global `Object.getPrototypeOf` and makes `@hapi/hapi` unloadable — AAP §0.6.5 Defect 2,
which the 21.4.10 bump does not fix. An earlier revision avoided that by hooking
`Module.prototype.require` instead, and **that was measured to be worse**: the model is required
late in boot, so the hook sat in the call path of nearly every require, and under
`--pending-deprecation --trace-deprecation` it (a) inserted a `fixtures/model.js` frame into the
stack of the pre-existing `DEP0005` warning and (b) **caused Node to emit a `DEP0040` punycode
warning that a plain boot does not emit at all** — measured both ways on the same tree. A fixture
that adds a warning to the stream [§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application)
inspects is not acceptable. The accessor emits nothing and appears in no stack.

**Bounded by construction.** An arming names a model, a method, one document id and a number of
uses. The corpus case arms one use of `findById` for the seeded user's frozen `_id`,
`000000000000000000000101`, and the counter is held in the server process against the arming file's
exact text, so the file is never written to from inside a request. The fixture logs the id of every
lookup it sees while an arming is live, so **which** call was faulted is checkable rather than
assumed.

**The four steps, and what each one is for.**

| Step | Request | Fault | Measured |
|---|---|---|---|
| 0 | `POST /login` as the seeded user | — | `302` to `/home`; the session now carries a `userId`, without which the scheme returns at outcome 1 and performs no lookup at all |
| 1 | `GET /home`, `Accept: text/html` | armed, 1 use, id `…0101` | `302` with `Location: /login` — the catch branch logged `Auth error` and returned `Boom.unauthorized`, and `mode: 'try'` plus the route's own required auth turned that into the 401 the error mapper redirects |
| 2 | `GET /home`, `Accept: application/json` | armed, 1 use, id `…0101` | `401` with body `{"statusCode":401,"error":"Unauthorized","message":"Auth error"}` |
| 3 | `GET /home`, `Accept: text/html` | spent | `200` |

**Step 2 is what pins the outcome to this branch, and step 1 alone could not.** All five outcomes
are 401-shaped and two of the other four *also* redirect a browser to `/login`, so a status-and-
`Location` expectation cannot tell `Auth error` from `User not found` or `Account disabled` — a
regression from one message to another would pass. `app.js`'s error mapper treats an
`Accept: application/json` request as an API request and returns the Boom unrendered, so the
scheme's own message reaches the client and the expectation can name it:
`{index: 2, status: 401, bodyIncludes: 'Auth error'}`.

**Step 3 is what establishes the session effect.** The catch branch does **not** call
`request.yar.clear('userId')` — unlike outcomes 2 and 3 immediately above it — so the session must
survive a failed lookup. A 200 there establishes both that the injector is bounded and that outcome
5's session effect differs from its neighbours'.

Steps 1 and 2 carry different arming messages, and both drivers stamp every write with an
`armGeneration`. That is not cosmetic: the fixture keys its use counter on the arming file's text,
so two consecutive armed steps need two distinct documents. A measured bug lived exactly here — an
`arm → disarm → identical re-arm` sequence left the first arming's use count in place and the second
arm was treated as already spent, so only one of two faults landed. `decide()` now syncs the
generation on every readable state, including the disarmed one.

**Measured, on both trees.**

| Run | Result |
|---|---|
| `capture.js --app . --only auth.outcome.lookup-error --expect-baseline --node-flags "--pending-deprecation --trace-deprecation"` | exit **0**, `0 expectations unmet`, steps `302 → 302 /login → 401 "Auth error" → 200`; fixture log: 2 `faulted` records, both `id 000000000000000000000101`, `shape: promise`; application log carries `Auth error: parity fixture: injected data-store failure…` with a stack through `Object.authenticate (app.js:283)`; **0** occurrences of the fixture in the child's stderr |
| `capture.js --app <worktree at 2f8712a>` — a real `git worktree` with **its own `npm ci`** (406 packages) | exit **0**, the **identical** step sequence `302 → 302 /login → 401 "Auth error" → 200`, and the fixture recorded `shape: callback+promise` — the baseline scheme passes a callback into a hand-rolled `new Promise` where the target awaits the query, so the dual-shape claim above is verified against the real baseline rather than in isolation |
| `replay.js --app . --only auth.outcome.lookup-error --pass non-secure` against the **committed** corpus | exit **0**, **0 differences**, `asserted`, `injected faults: confirmed (2 armed, 2 recorded)` |

That last row is the one that matters most, because it is the round trip that was broken when this
was first written: `recordStep` discarded the step's `modelFault`, so a captured case replayed
**unfaulted** — the request came back 200 with no `Location`, and the comparison reported the
difference against the application when what had actually changed was that the harness stopped
injecting. `recordStep` now carries the control, `readStep` restores it, and `assertFaultControls`
**refuses to plan** a scenario whose fault was lost, or a fault-free
`auth.outcome.lookup-error`, rather than replaying either as an application difference.

**The result is recorded, not just described.** `corpus.json`'s entry for this scenario carries the
four driven responses and a `baseline` block naming the base commit, the tool commit that drove it
(the tooling does not exist at `2f8712a`, which is why provenance is two commits and not one), the
cookie pass, the origin, and the injected-fault count by document id — **measured** on the delivered
artifact: `commit 2f8712a112db…`, `toolCommit 20fd5f91325e…`, `cookiePass non-secure`,
`origin http://127.0.0.1:3010`, `injectedFaults 2`,
`injectedFaultsById {"000000000000000000000101": 2}`, `expectationMet true`, and four
`baselineSteps` reading `302` → `302 /login` → `401` → `200` with the fault control carried on the
two middle steps. `summary.baselinesPending` is **0** and `summary.captured` is **true**, because the
rest of the corpus was captured afterwards ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries));
this scenario is no longer the only recorded one, and its own record is unchanged by that. The
capture used the overlay's own port rather than an ad-hoc one, so the recorded `Location` values are
what a full capture of this corpus reproduces.

**Re-measured end to end on the delivered tooling**, because a round trip recorded by the tools that
were current when it was written is not the same claim as one the delivered tools reproduce. A
capture of this one scenario against a `git worktree` at `2f8712a` with its own `npm ci` exits **0**
with `0 expectations unmet` and `0 evidence findings`, and a replay of that capture against this tree
reports the scenario a **match** with `differenceRecords: 0` and
`injected faults: confirmed (2 armed, 2 recorded)`. That run is also what exposed a defect in the
check itself: the four accounting checks were each evaluated twice per pass, the second time through
an argument list that carried no evidence, so one result held the same check twice with **opposite
verdicts** — PASS from the call that was given the pass's evidence, FAIL from the call that was not,
while `evidence.modelFault` recorded `faulted: 2, byId: {000000000000000000000101: 2}` throughout.
Each check is now evaluated once; the failing copy would have made this requirement unsatisfiable
however the application behaved.

**And the gate now fails when any of this is absent.** `replay.js`'s `accountAuthOutcomes` holds a
closed list of the five required outcomes and reports `asserted` against `required`. An outcome that
is undriven, uncompared, differing, or carrying no declared expectation is a **failure**; an
`unreachableReason` is printed for review and excuses nothing; and a scenario that arms faults is
reconciled against the fixture's own record, so an expectation met **without** the fault having been
injected is a failure too. A complete run containing **no** auth-outcome scenario at all fails
rather than skipping — the closed list is only a contract if its absence is one. The single escape
hatch, `AUTH_OUTCOMES_EXEMPT_FROM_DRIVING`, is deliberately empty and requires an AAP citation in
code, so the decision to stop driving one of the five can no longer be taken by writing a sentence
into an artifact. Verified by construction, over seven states:

| State | Verdict |
|---|---|
| all five driven, compared, expectations met, faults confirmed | `ok=true`, **5/5** |
| the fifth undriven with an `unreachableReason` (the original shape) | `ok=false`, 4/5 |
| the fifth driven with no declared expectation | `ok=false`, 4/5 |
| the fifth absent from a complete run | `ok=false`, 4/5 |
| the fifth's expectation met but **zero** faults recorded | `ok=false`, 4/5 |
| the fifth's expectation met but the fault log unreadable | `ok=false`, 4/5 |
| no auth-outcome scenario at all, complete run | `ok=false`, 0/5 |

The session and cookie half of the same contract is bound to the cookie-attribute comparison in
[§4.2](#42-the-exactly-compared-surface) and the two overlay passes in
[§2.6](#26-the-server-overlay-and-why-one-was-needed). Three details of it break silently rather than
loudly and are therefore compared rather than assumed: `isSecure` defaults to **secure** and only an
explicit `false` disables it (`[T app.js:229]` — a truthiness check would have inverted the default),
`maxCookieSize: 0` is what forces server-side storage so any non-zero value changes the wire format,
and the private-field patch in [§4.3](#43-why-the-cookie-expires-assertion-exists).


---

## 5. The gate register, and what each gate proves

One line per gate, with its status in this delivery and a **shorthand reference to the command** that
produced it. The shorthand is expanded into runnable form just below, ahead of the table, so a
reviewer re-runs rather than re-reads. Four statuses are used and they are not interchangeable:

- **PASS** — a command was run and reported no difference.
- **RUN, with a residual** — a command was run, it reported something, and the something is described
  in full rather than summarized into a verdict.
- **BLOCKED** — the harness ran and is sound, and the application cannot do what the gate requires. The
  blocker is named, with whose scope it falls in.
- **not run** — no evidence exists yet. This is **not** a failure, and it reappears in
  [§8](#8-what-remains-unproven) with what would settle it.

Every command below was run at the evidence commit in this delivery unless its row says otherwise; the
baseline side comes from a `git worktree` at `2f8712a` installed from the baseline lockfile (`npm ci`,
642 packages, exit 0).

**The shorthand, expanded once.** Each tool lives under `test/parity/`, every artifact goes to a
caller-supplied path outside the checkout, and the variables below are what the table's `"$BASELINE"`,
`B`, `T` and `…` stand for. Defined and quoted so the block runs as written:

```console
$ OUT="$(mktemp -d)"                          # artifacts and sidecars land here, outside the checkout
$ BASELINE="$PWD/../baseline-2f8712a"         # git worktree at 2f8712a, with its own npm ci
$ PORT=3110                                   # any free port; the overlay's default is 3010
$ IMAGE_TAG=trinket-parity                    # any tag you like
$ node test/parity/manifest.js --out "$OUT/target-manifest.json"
$ node test/parity/manifest.js --app "$BASELINE" --out "$OUT/baseline-manifest.json"
$ node test/parity/manifest.js --compare "$OUT/baseline-manifest.json" "$OUT/target-manifest.json"
$ node test/parity/manifest.js --cli-table --out "$OUT/target-cli-table.json"
$ node test/parity/manifest.js --cli-table --app "$BASELINE" --out "$OUT/baseline-cli-table.json"
$ node test/parity/replay.js --app . --corpus test/parity/corpus.json
$ node test/parity/joi-matrix.js --compare test/parity/joi-baseline.json --port "$PORT" \
    --out "$OUT/joi-comparison.json"
$ node test/parity/storage.js --out "$OUT/storage-result.json"
$ node test/parity/worker.js  --out "$OUT/worker-result.json"
$ CI=true npm test
$ npm audit --omit=dev --json > "$OUT/audit.json"
$ npm ci && npm run build
$ docker build -t "$IMAGE_TAG" .
$ git archive HEAD | docker build -t "$IMAGE_TAG-clean" -
```

The two manifest generation runs and the joi comparison each write a `<out>.provenance.json` beside
their artifact, which is where the evidence commit and the analysed tree are read from
([§1.4](#14-tool-provenance-per-artifact)). The manifest, CLI-table and audit runs need no database;
the joi, storage and worker runs provision their own through `test/parity/mongo.js`. Both generation
runs must have **both** streams discarded by the caller, for the reason in
[§3.5](#35-aggregate-counts-are-a-summary-not-the-gate).

| Gate | What it proves | Status | Command |
|---|---|---|---|
| **Route manifest, per entry** | The HTTP surface survived — method, path, controller binding, handler kind, effective auth, pre-handlers, pre-parse validation keys, templates, reply projection, cookie flag and options, compared entry by entry. **The primary parity gate** | **PASS** — 233 vs 233, 0 only-in-baseline, 0 only-in-target, **0 differing fields**, exit 0, with the provenance of both sides verified before the comparison. `--compare` consumes the committed baseline artifact `test/parity/route-manifest.baseline.json`, whose sidecar records `tree.head = 2f8712a112db46f923918c4507c75abc732d83d0`. Wired into `npm run verify:routes`, and negative-tested: re-injecting a single route option makes it exit 1 naming the entry ([§6.2.4](#624-post-file-answers-415-to-a-multipart-upload-and-that-is-baseline)) (**re-measured on the integrated tree**) | `manifest.js --out T`; `manifest.js --app "$BASELINE" --out B`; `manifest.js --compare B T` |
| **Route-table CLI** | The `optimist` replacement preserved all **three** invocation forms, since the module self-executes unconditionally and so bare execution also emits the table | **PASS** — all three forms exit 0 at **22 209 bytes and 112 data rows** each and are identical to one another, and each is **byte-identical to the capture recorded in the committed `route-table.baseline.json`** taken at `2f8712a` (**re-measured on the integrated tree**, below) | `manifest.js --cli-table [--app "$BASELINE"] --out …` |
| **Request corpus replay** | Identical normalized responses across the full route inventory | **RUN, with a residual.** The committed corpus is a real recording — 383 scenarios, **383 recorded baselines**, `summary.captured: true`, **233 of 233 routes represented** — and `verify:corpus` still refuses it, correctly: its sidecar names a generator this repository cannot retrieve, because it was written by `capture.js` as that file stood before this delivery rewrote it. Closing the gate needs a re-capture through the delivered generator, which one pass cannot produce ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). **The pair itself is proven** on a re-captured segment: 8 scenarios, both cookie passes, 8 of 8 driven, **0 differences**, provenance verified on corpus and manifest alike, and the approved deviation materialized and verified field by field (`timed-out` → `answered`) | `replay.js --app . --corpus test/parity/corpus.json` |
| **joi matrix, 102 targets** | Accept/reject/coercion outcomes identical across the `joi` bump, response shapes included | **PASS** — exit 0: 102 targets, 306 cases, **462 outcomes and 15 678 fields compared, 0 schema-level differences and 0 generated-input differences**. The committed baseline verifies against its sealed sidecar (role `baseline-capture`, joi 17.13.3, app HEAD `2f8712a112db`, digest matched), so the comparison consumes evidence rather than an unattributed file. Both custom language maps re-measured **inert** on 17.13.3 and 18.2.5 alike (**re-measured on the integrated tree**) | `joi-matrix.js --compare test/parity/joi-baseline.json --port … --out …` |
| **Storage and archive contract** | The S3 key is a content hash, so a changed digest silently orphans every stored object; the cases assert the exact sha1 key, the suffix and extension branches, the content-type override, avatar gating, bucket selection, the export key and the archive's internal layout | **PASS** — **35 of 35 cases**, exit 0, against an isolated in-memory MongoDB and the filesystem S3 fixture, including the three pre-migration cases that prove a changed digest surfaces as a lookup failure, and the archive layout read through `adm-zip`'s own `getData()`. No failed case, no captured warning, no recorded finding, no double delivery and no failed teardown (**re-measured on the integrated tree**) | `storage.js --out …` |
| **Export worker** | Bull 4's changed semantics — processor promise completion, `job.id` in the `failed` handler, `job.remove()` on `completed`, retry and stalled behaviour — plus status and error persistence, the archive layout, the notification mail and cleanup on both paths | **PASS** — exit 0, **VERDICT PASS, 109 of 109 checks in the artifact**, **7 jobs driven on real `bull` 4.16.5**, and **0 notices with 0 allowed**, measured under `--pending-deprecation --trace-deprecation`. The terminal line reports `checks 110/110` and the artifact records 109: the difference is exactly the artifact-write check, which a document cannot record the outcome of writing, and the tool says so where it serializes. The two blockers this row carried are resolved in the delivered tree rather than deferred: the `q`/Mongoose 6 double-execution sites and the removed `Query.prototype.stream` are gone, the tree carrying 9 `.exec()` and 2 `.cursor(` calls and **no** `.stream(` (**re-measured on the integrated tree**) | `worker.js --out …` |
| **Existing suite** | The 124 baseline assertions unweakened, plus the 6 new page-surface cases | **PASS** — **234 passing, 0 failing**, exit 0 (**re-measured on the integrated tree**). The registered-case gate asserts that same 234 and so fails a suite that silently does not register: the 130 the baseline's 124 assertions plus the six new page cases account for, plus 21 legacy-URL and MIME contract cases and 83 utility cases added with this work | `CI=true npm test` |
| **Zero deprecation warnings** | The whole running application, not a subset, under `--pending-deprecation --trace-deprecation` | **PASS at boot and across every drive performed.** Booted under `node --pending-deprecation --trace-deprecation` the application emits **zero** warning lines — the one module-load residual this row used to carry was cleared at its source by the archive-dependency move ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)). The worker gate reports **0 notices, 0 allowed** under both flags while driving seven real jobs, and the storage gate captures none across 35 cases. The full 233-route, five-identity pass belongs to replay and is carried by the corpus row above (**re-measured on the integrated tree**) | `node --pending-deprecation --trace-deprecation app.js`, then the drives in [§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application) |
| **Audit** | Zero critical and zero high findings | **0 critical / 1 high / 6 moderate, total 7** — **re-measured on the integrated tree**: the single high is direct `marked` ([§7.2](#72-deviation-2--the-marked-fork-is-retained)) and the moderates are `aws-sdk`, `bull`, `highlight.js`, `jszip`, `mongoose` and transitive `uuid`. That is exactly the delivery AAP §0.9.5 states — 0 / 1 / 6 — so the one-lower moderate count this row previously reported is reconciled: `mongoose` is the sixth | `npm audit --omit=dev --json` |
| **Asset build from a clean tree** | The build's own input is gitignored and absent from a fresh checkout, so this proves the fetch-then-build sequence works on a host, and that both stylesheets land at the paths the templates reference | **PASS** — `npm ci` (**410 packages**, exit 0), then `npm run build`: the component bundle downloaded, **166 464 007 bytes, sha256 verified** against the digest in the script, then `public/css/base.css` **265 727 bytes** and `public/css/embed.css` **296 352 bytes**, exit 0. The fetch is idempotent as delivered — a second run verified 6 721 files and 543 directories against its recorded tree manifest in 494 ms and downloaded nothing (**re-measured on the integrated tree**). Sass emits legacy-JS-API deprecation notices from the vendored, gitignored Foundation SCSS; those are **build-time** and out of scope, and are not part of the running-application warning gate above | `npm ci && npm run build` |
| **Root container image, and the stylesheets served from it** | R-b's no-old-runtime requirement for the image this application ships in, and the half of the build gate a host build cannot prove | **PASS** for the root image — built twice at the evidence commit, once from the working context and once from a **clean context** (`git archive HEAD \| docker build -`) so no host-built artifact could be inherited. Both builds: the digest-pinned `node:22-bookworm` base, the build-time `engines` assertion passing on node `v22.23.2` / npm `10.9.8`, `npm ci` resolving **410 packages inside the image with no SSH identity present** (re-measured on the delivered tree: the image was first built at `0716cd2`, where the same command resolved 416, and two later corrections to the dependency set moved it to 410 — the figure the host `npm ci` also reports, so image and host agree), the component fetch verified against its digest, and `npm run build:css` emitting both stylesheets at the same byte sizes as the host build. The image was then run and driven: `Server started`, `/` **200**, `/css/base.css` **200 `text/css` 265 727 bytes**, `/css/embed.css` **200 `text/css` 296 352 bytes** (**measured** at the evidence commit). The **eight `serverside/**` images and the four manager boots are not covered by this row** and remain open in [§8](#8-what-remains-unproven) | `docker build -t "$IMAGE_TAG" .`; `git archive HEAD \| docker build -`; then `docker run --network host` and `curl` |


**Every gate above is reachable from an `npm` command, and each propagates its own exit status.** A
gate nothing invokes is not evidence, so the five are wired individually and as an aggregate:
`verify:routes`, `verify:corpus`, `verify:joi`, `verify:storage`, `verify:worker`, and
`verify:parity`, which runs all five in order, prints a per-gate banner and exits non-zero if any one
of them does. Measured in this delivery, end to end:

| Command | Exit | What it reported |
|---|---|---|
| `npm run verify:routes` | **0** | `PASS - the HTTP surface is identical across all 233 entries` — generates the target manifest, then `--compare`s it against the committed baseline artifact |
| `npm run verify:corpus` | 2 | Refuses to replay: the committed corpus carries no embedded provenance block, so it does not say which tree it measured. Its recorded responses are real — 383 of 383 — but the artifact predates the delivered `capture.js`, and closing this gate needs a re-capture through it |
| `npm run verify:joi` | **0** | `no differences: accept/reject parity holds across every target, every case and both Accept modes`, then `gate PASSED: no captured warning, no unexplained outcome-proof mismatch, no unmatched rule, no parity difference, no failed invariant and no failed teardown` |
| `npm run verify:storage` | **0** | `35 of 35 cases passed`, then `gate PASSED: no failed case, no captured warning, no recorded finding, no double delivery and no failed teardown` |
| `npm run verify:worker` | **0** | `checks 110/110 passed, 7 job(s) driven on bull 4.16.5 … 0 notice(s) (0 allowed - the gate has no allowances), measured under --pending-deprecation --trace-deprecation`, then `VERDICT PASS` |
| `npm run verify:parity` | 1 | All five above, in order; the aggregate is non-zero on `verify:corpus` alone, with `verify:parity FAILED - at least one gate above did not pass` |

**Four of the five gates pass through this wiring and the fifth is the corpus**, re-measured end to
end in this delivery. The one non-zero exit is the honest state of the evidence rather than a broken
wiring or a failing tree: the replay pair itself is proven on a re-captured segment, and what the
committed artifact lacks is provenance the delivered generator writes, not measurements. Before this wiring existed the
storage and worker harnesses were invoked by nothing at all, which mattered because the replay gate's
exemption for archive digests rests on them.

**The route-table CLI check, measured on both trees.** The route parser's module body self-executes
unconditionally, so bare execution emits the table as well as `-R` and its `--routes` alias; an argv
check that tested only for `-R` would silently have changed two of the three. All three were captured
from each tree and compared:

```console
$ BASELINE=…/baseline-2f8712a            # the worktree from §1.2, with its own npm ci
$ node test/parity/manifest.js --cli-table --app "$BASELINE" \
    --out "$OUT/baseline-cli-table.json" >/dev/null 2>/dev/null
route-table CLI: 3 invocation form(s) captured from …/baseline-2f8712a
  dash-R:      22209 bytes, 112 data row(s), 1 preamble line(s)
  long-routes: 22209 bytes, 112 data row(s), 1 preamble line(s)
  bare:        22209 bytes, 112 data row(s), 1 preamble line(s)
  all forms byte-identical
```

The tool echoes the resolved `--app` path on that first line; it is shown here as `$BASELINE` because
the path is per-clone and is not part of the evidence — an elision, declared, and the only one in this
transcript.

The delivered tree produced the same three captures, byte for byte — **22 209 bytes and 112 data rows
in every form, in both trees**, re-run at the evidence commit in this delivery and compared form by form from the two
artifacts rather than by eye. The single preamble line is the in-memory-queue notice a controller
prints at module load, which is why it is recorded as a preamble rather than treated as table output.

This is a **supporting** check and not the primary gate, for a reason worth recording: the CLI parses
`config/routes.js` only, so the 116 API routes and the 5 synthesized routes are absent from its 112
rows, and its columns carry no auth at all. It cannot see most of the surface. It is valuable for
exactly one thing — proving the CLI's own output did not move — and the tool's artifact says so in its
own note.

### 5.1 Each PRESERVE clause bound to the gate that proves it

An intention is not evidence, so each clause names a gate rather than a promise. The status column is
the same status as in the register above, repeated so the binding can be read without cross-checking.

| PRESERVE clause | Bound to | Status |
|---|---|---|
| **The HTTP surface** — route paths, methods, per-route auth | The per-entry route manifest comparison, [§3.5](#35-aggregate-counts-are-a-summary-not-the-gate) | **PASS**, measured |
| **Validation accept/reject outcomes** | The joi matrix over all 102 targets, three cases each, response shapes included | **PASS — both sides measured.** `npm run verify:joi` exits **0** against the sealed 17.13.3 baseline: 102 targets, 306 cases, **462 outcomes**, 15 678 fields, **0 differences**, and `gate PASSED` on its own warning, proof-mismatch and unmatched-rule conditions |
| **Session and auth behaviour**, same cookie names and outcomes | The five independent auth-outcome assertions, [§4.7](#47-the-five-auth-scheme-outcomes-and-the-evidence-state-of-each), and the full `Set-Cookie` attribute comparison in both overlay passes, [§4.2](#42-the-exactly-compared-surface) / [§2.6](#26-the-server-overlay-and-why-one-was-needed) | All five outcomes are drivable and the gate fails while any is not asserted. The **baseline side of all five is recorded** (302 / 200 / 302 / 302, and a four-step `302` → `302 /login` → `401` → `200` for the lookup error), and outcome 5 is also **compared against the target** — a match with the injected faults confirmed ([§4.7.1](#471-the-fifth-outcome-and-how-it-is-reached)). The other four comparisons, and the cookie-attribute assertion in both passes, await the replay precondition in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) |
| **Client-visible page behaviour and asset URLs** | The HTML comparison in [§4.2](#42-the-exactly-compared-surface) — rendered text, form and input names and values, `id`/`class`, `data-`/ARIA, inline-script presence and `href`/`src`, with asset URLs compared rather than stripped and only the cache-prefix digits normalized | Baseline **recorded** for all 383 scenarios; the comparison awaits the replay precondition in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries), and is proven in miniature on the re-captured 8-scenario segment (0 differences over both cookie passes) |
| **Persisted data and file formats** | `test/parity/storage.js` and `test/parity/worker.js`, which assert the exact sha1 object key against pre-migration objects rather than freshly written ones — the only way a changed digest surfaces as a lookup failure instead of passing | **Storage PASS — run**: 35 of 35, exit 0. **Worker PASS — run**: 109 of 109 checks and 7 jobs driven on real `bull` 4.16.5, exit 0; the two deferred-dependency blockers this row carried are resolved in the delivered tree. Both are reachable as `npm run verify:storage` and `npm run verify:worker`, and through `npm run verify:parity` |
| **Existing assertions** | The suite gate, which permits a reviewed **stub-syntax** change, and an **explicit, per-case, measured exception register** for any expected value that contradicts byte-identical production code, [§6.2.1](#621-the-baseline-correction-exception-register) | **PASS** — **234 registered / 234 executed / 234 passing, exit 0**, asserted by the run itself. No assertion deleted, loosened or made vacuous. **18 of the 124 baseline cases carry a changed expectation**, across 4 spec files, replacing **29** baseline assertion lines with **33**; every one is under a recorded exception with its measurement and its byte-identity evidence, and no file lost assertions on net |
| **Error-to-response mappings** (R-e) | `docs/error-edge-inventory.md` plus the failure-path cases in [§4.6](#46-failure-paths-run-beside-the-success-sweep) | Inventory **regenerated from the delivered tree against a baseline worktree**: 332 rows, 342 of 342 baseline and 332 of 332 target rows accounted for, 245 edges closed. The failure-path comparison awaits the replay precondition in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) |

The distinction in the "existing assertions" row is the one the gate is worded around, and it is worth
being exact about. **Every assertion expression, its expected value and the passing count are the
protected thing**, not the textual identity of every `it()` body — and "protected" here means an
expected value may change only under a recorded exception, never silently and never by relaxation.
Three categories are distinguished, and each is treated differently:

- **Stub syntax.** Permitted, recorded in the diff with its reason, and not an assertion change at
  all. Three legacy three-argument `sinon.stub(obj, 'm', fn)` calls had to become
  `sinon.stub(obj, 'm').callsFake(fn)` because the sinon line moved, and one of them sits inside a
  test body.
- **Preconditions, drivers and doubles.** Permitted, and also not an assertion change: they alter what
  the case *sends* or what the environment *provides*, never what it *expects*. Every one is
  enumerated in [§6.2.2](#622-preconditions-drivers-and-doubles-the-suite-had-to-supply-itself).
- **Expected values.** **Barred**, except under an explicit exception carrying (a) the measurement that
  produced the new value and (b) `git diff 2f8712a HEAD -- <production file>` returning empty for the
  file that decides the outcome — which is what makes the observed behaviour *baseline* behaviour and
  makes changing production to satisfy the test the R-d violation. **Eighteen** of the 124 baseline
  cases carry a changed expectation on that basis, and every one is in the register below. None was
  deleted, none was loosened to a weaker matcher, and none was made vacuous — each was **replaced by
  the exact measured value**, which is an equally strong assertion about a different value.

**Negative-tested, not assumed.** The register's entries are only worth their evidence if the
assertions they carry can still fail. Three spot checks were run and all three failed the run as they
should: `'metrics.runs': 1` changed to `99`, and `calledWithExactly(query)` changed to
`calledWithExactly({nope:1})`, both in `test/lib/models/trinket.js`; and the download case's
`statusCode.should.eql(200)` changed to `201`. Each produced a failing case **and** the suite-total
gate reporting `passed` below `executed`, which is the second half of what makes the count meaningful.

### 5.2 The container and asset-build checks, measured per image and per unit

These two gates were open in an earlier revision of this document, which recorded that **none of the
nine images had been built**. They have now been built and run on the delivered tree, so what follows
is the measurement rather than the intention. Every build below was `--no-cache`, so nothing was
inherited from a previous layer, and each `RESULT` line is the command's own exit status.

**The nine Node-bearing Dockerfiles — nine builds, all exit 0.** `docker build --no-cache` per
Dockerfile, from the directory that is its build context:

| Image | Context | Exit | Wall time | `node -v` in the built image |
|---|---|---:|---:|---|
| root application | `.` | 0 | 224 s | v22.23.2 |
| java manager | `serverside/java/manager` | 0 | 60 s | v22.23.2 |
| python manager | `serverside/python/manager` | 0 | 126 s | v22.23.2 |
| r manager | `serverside/r/manager` | 0 | 60 s | v22.23.2 |
| pygame manager | `serverside/pygame/manager` | 0 | 305 s | v22.23.2 |
| java shell | `serverside/java/shell` | 0 | ~340 s | v22.23.2 |
| python shell | `serverside/python/shell` | 0 | 572 s | v22.23.2 |
| pygame worker | `serverside/pygame/worker` | 0 | 623 s | v22.23.2 |
| r shell | `serverside/r/shell` | 0 | 1151 s | v22.23.2 |

The root image's own guard is part of this: its second instruction compares the base image's versions
against `package.json`, and the build log records `engines: node v22.23.2, npm v10.9.8 -- ok` before
anything else runs. The four `serverside/*/manager` builds install with `npm ci` (pygame with
`npm ci --omit=dev`) against the lockfiles delivered beside their manifests — `added 43 / 46 / 43 / 41
packages` — so a lockfile that drifted from its manifest would now fail the build rather than be
silently re-resolved.

**Unit boots — eight of eight `serverside` units, plus the root image.** The four manager units were
started with their port published, and each reported `Running`, exit code 0, no restarts, `node -v`
= v22.23.2 inside the container, its own startup line in the log, and **HTTP 200 to a `socket.io`
polling handshake** on the published port, which proves the listener actually bound. The three shell
units start under PM2 and each logged `App [server:0] online` with the same 200 handshake on port
8010; the pygame worker starts under supervisor and reported `xvnc`, `novnc` and `shell` all
`entered RUNNING state` with its `server.js` process running on v22.23.2. The root image was started
against a MongoDB instance and logged `Server started on port: 3000`.

**The asset build, on a clean tree.** From a checkout with `node_modules`, `public/components` and
the generated stylesheets removed: `npm ci` exit 0 in 101 s with no `--legacy-peer-deps`, then
`npm run build` exit 0 — the component bundle fetched and SHA-256-verified (166 464 007 bytes), a
tree manifest of 6 721 files and 543 directories recorded, and Vite writing **`public/css/base.css`
at 265 727 bytes and `public/css/embed.css` at 296 352 bytes**. A second `npm run build` exits 0 in
5 s, re-verifying the installed component tree against that manifest in ~0.5 s instead of
re-downloading it.

**The same two artifacts inside the image, and served.** The root image contains
`public/css/base.css` (265 727 bytes) and `public/css/embed.css` (296 352 bytes) — the same byte
counts as the host build — and a container started from it answers `/css/base.css` and
`/css/embed.css` with **200** and `Content-Type: text/css; charset=utf-8`, with response bodies whose
SHA-256 equals the host artifacts'. `/` answers 200. The image also carries none of the host's
ignored state: `config/local.yaml`, `config/runtime.json`, `config/development.yaml`,
`config/production.yaml`, `.git` and the untracked scratch directory are all absent, because the
build context is now exactly the tracked file set (552 files, 9.2 MB, against 443 MB before).

**One measured consequence for `docker compose up`, which is not the same path.** `docker-compose.yml`
mounts the checkout over the application directory and keeps only `node_modules` and
`public/components` as named volumes. Measured with an equivalent plain `docker run` mount over a
pristine `git archive` of the tree — the compose file is unmodified by this migration, per the plan's
own exclusion, and cannot be run in this environment because it hard-codes container names and host
ports — the image's stylesheets are **hidden** by the parent mount, and the served result is
**404 for `/css/base.css` and `/css/embed.css`** while the tracked `/css/challenge.css` and `/`
answer 200. Building the CSS into the mounted checkout turns both into 200 with the same byte counts,
with no restart, because the files are read from disk per request. Inside the container that build has
to run as root: as the image's own `trinket` user, or as the checkout's owner, it fails with `EACCES`
— writing Vite's bundled config beside `vite.config.mjs` in the first case, copying
`public/components` while preparing the output directory in the second. `GETTING_STARTED.md`,
`README.md` and `docs/setup.md` document that difference and the command that resolves it.


---

## 6. The R-f resolution log

One entry per ambiguity: what was ambiguous, the **measurement** that settled it, and the
**resolution** adopted. No entry says only "resolved". The log is a record of what happened, so the
last six entries are ambiguities the plan did not anticipate and that surfaced during the work.

### 6.1 "Callback-era hapi version" against a manifest already declaring hapi 20

**Ambiguous.** The request describes a 2013-era platform and asks to upgrade hapi "from its
callback-era version", which does not match what the repository declares.

**Measured.** The committed lockfile resolves `@hapi/hapi` **20.3.0**, and the bootstrap is written
**entirely against the hapi 17+ API** — `await server.register([...])` with plugin objects, an
extension returning `h.continue`, an `async (request, h)` error mapper, and an auth scheme using
`h.authenticated` / `h.unauthenticated`. What is genuinely callback-era is the **handler surface**:
145 routed handlers written as `function (request, reply)` that signal out of band and return
`undefined`, kept working by a compatibility layer in the route parser that substituted a deferred
value whenever a handler returned nothing.

**Resolution.** **The symptom is accurate and the version is approximate** — the repository was
half-migrated. Effort was reallocated from a framework rewrite to the **154 hapi-invoked functions**
(145 routed handlers + 8 routed pre-handlers + 1 inline), which is where the callback idiom actually
lived. The objective did not change; only the location of the work did. Under R-f the baseline governs,
so the plan was written against what the code does rather than against how it was described.

### 6.2 `npm test` had no green baseline

**Ambiguous.** The request asks for the "existing suite 100% with assertions unweakened", which
presupposes a suite that runs.

**Measured.** At `2f8712a` the suite **dies during file collection, before a single `it()` runs**.
Mocha 3.5.3's own file lookup was executed: **25 files, sorted, with all seven `test/helpers/*.js`
collected as spec files at positions 1–7 and `test/setup.js` last at position 25**. Seven defects stack
on that ordering:

| # | Defect | Consequence |
|---|---|---|
| 1 | `test/helpers/catbox-redis.js` requires the unscoped `catbox-redis`, which is neither declared nor installed | As collected file #1 it **aborts the whole run** |
| 2 | `mongoose-schema-extend`'s transitive Proxy polyfill **replaces the global `Object.getPrototypeOf`**, after which requiring hapi throws `AssertError: Schema can only contain plain objects` | Any file reaching the database helper before hapi kills the run. **The version bump does not fix it** — 21.4.10 fails identically to 20.3.0 |
| 3 | The same ordering breaks the **export worker in production**: it loads `config/db` before `config/app.config`, so `require('./lib/workers/exports')` throws | A module that cannot be required at all |
| 4 | The Supertest agent is built from `undefined`: the flow helper calls `server(app.listener)` at require time, but `app.js` exports a **Promise** | `agent.get('/')` throws `TypeError: Cannot read properties of undefined (reading 'address')` — breaks **69 of the 123** cases |
| 5 | `NODE_ENV` is set from the **last** collected file, so every module had already loaded under `development` and `config/test.yaml` never applied | The wrong configuration for the entire run |
| 6 | A queue helper calls a queue getter that is not exported — the configured Bull queue list contains only `exports` | Throws on load; and no test ever called it |
| 7 | `sinon` 1.7.3 has no `.callsFake`, which the store helper calls four times | Breaks the 7 cases in the forgot-password suite |

**Resolution.** Repaired as **precondition** work, with no assertion deleted, loosened or made vacuous
and every changed expected value carried in the register at [§6.2.1](#621-the-baseline-correction-exception-register): the two dead
helpers deleted rather than patched (neither mocked anything the application uses, and no test called
the queue helper), the environment moved into a `--require` preload, readiness moved into a
first-collected spec, the spec glob narrowed so helpers are no longer collected as specs, the flow
helper's agent made lazy, and `sinon` moved to a maintained line with three legacy stub calls
converted. `test/setup.js` was reduced to an inert signpost recording why its content moved.

**And the outcome, measured in this delivery.** `CI=true npm test` → **234 passing, 0 failing,
exit 0**, and the run additionally asserts that count mechanically: a root `after` hook in
`test/lib/api/index.js` walks the root suite and fails the run unless the number of cases
**registered**, **executed** and **passing** are all equal to 234. That hook is what closes the gap a
green reporter line leaves open — an uninvoked spec file or a `before all` hook that suppresses the
rest of its suite lowers the reported total without reporting a failure of its own, which is exactly
how the earlier **90 passing / 39 failing** state reported only 129 cases while 130 were registered.
**Negative-tested** in both directions: an expectation one above the measured total fails while
reporting `registered`, `executed` and `passed` all equal, and one deliberately broken case fails with
`passed` one below `executed`.

**The total reconciles two ways, which is why it is quotable.** By provenance it is
**124 + 6 + 104**: the 124 `it()` bodies present at the base commit, the 6 new page-surface cases, and
104 cases added by two conversion-driven sections — **21** legacy-URL and `mime`-mapping cases, **59**
`email-compat` cases and **24** `diff-compat` cases, the last two being behaviour ports that hold
`validator` 5.7.0's `isEmail` and `diff` 1.0.8's `applyPatch` semantics while both packages move for
HIGH advisories under AAP §0.5.1.2. By file it is **75 + 21 + 59 + 24 + 66**, counted per file rather
than summed from intent. Both readings give 234, and the gate asserts the number rather than the
derivation.

**AAP §0.9.2 states 130, and 130 is the floor this meets rather than the total it delivers.** The
AAP's figure accounts for the baseline bodies plus the page-surface suite; the further 104 are
required by dependency moves the AAP itself mandates, and the request's own testing requirement is to
add route-level tests where baseline coverage is thin. So the relationship is additive, not divergent:
every one of the AAP's 130 is present and passing, no pre-existing case was removed or renumbered, and
the added cases are attributable one section at a time. The **124** is the number of `it()` bodies
**present** at base commit `2f8712a`: 123 of them active, plus
`it('should respond with a zip file', …)`, which sits inside the `/* … */` block at
`2f8712a:test/lib/api/course.js:254-280`. That one body is the whole of the difference between a
comment-stripped count of the baseline tree (123) and the AAP's count (124), and it is why an earlier
draft of this document argued for a total of 129. **That argument was wrong in its conclusion even
where it was right in its arithmetic**: the AAP is frozen, its floor is 130, and the 124th body is a
real test of a real route that was disabled rather than deleted — so the correct response is to make
it pass, not to renumber the target around it.

**It now passes, with its five assertions byte-identical to the ones written at base commit.** Only
its request was ever wrong. The application declares
`GET /{userSlug}/courses/{courseSlug}/download.zip` with a **required** `format` query of `md` or
`html` (`config/routes.js:163-173`), while the URL the case's `before` hook built carried neither the
`.zip` suffix nor the query, so it matched no route at all. Correcting the URL exposed a second,
separate obstacle, and it is a **data** condition rather than a code one:
`courses.download` writes each material's body straight to disk with
`fs.promises.writeFile(path, material.content)`, `test/helpers/defaults.js` declares a material as
`{name, type}` with no `content`, and a material created through `flow.addNewMaterial` and never given
a body therefore holds `content: undefined`. **Measured**: that call rejects with
`ERR_INVALID_ARG_TYPE` — *The "data" argument must be of type string or an instance of Buffer,
TypedArray, or DataView. Received undefined* — the chain's `.catch` answers
`errors.badImplementation(err.message)`, and the route returns 500. The same rejection occurs at
`2f8712a`, where the identical value was passed to `util.promisify(fs.writeFile)`, so this is not a
conversion regression and no production change is warranted; the case supplies the missing bodies in
its own `before` hook through the public model surface (`Lesson.findByIds`, `Material.findByIds`,
`Material.findByIdAndUpdate`) and then requests the download. Without that step the route answers 500;
with it, 200 with `Content-Disposition: attachment; filename=<slug>.zip` and
`Content-Type: application/zip`, and `/tmp/<owner>` removed — which is what the case has always
asserted.

The six new cases required `'pages'` to be inserted into the fixed `sequence` array in
`test/lib/api/index.js`, without which a new file in that directory is never invoked.

#### 6.2.1 The baseline-correction exception register

**Eighteen of the 124 baseline cases carry a changed expectation**, across four spec files, replacing
**29** baseline assertion lines with **33** — measured by diffing the assertion-bearing, non-comment
lines of every file under `test/lib/**` against `git archive 2f8712a`. Every one of them contradicted
production code this migration did not touch, so in every row `git diff 2f8712a HEAD -- <deciding file>` returns **empty** — which is
what makes the observed behaviour *baseline* behaviour and makes changing production to satisfy the
test the R-d violation. Each row states the old expectation, the value measured, and the mechanism.
Each edit also carries this evidence in a comment at its own site, so the register and the code cannot
drift apart unnoticed.

| # | Case (file) | Was | Now, measured | Mechanism, and the byte-identical file that decides it |
|---|---|---|---|---|
| 1 | course page body marker (`test/lib/api/course.js`) | body contains `defaults.course.name` | body contains `courseId='<id>'` | The course name reaches the page only as an AngularJS expression evaluated in the browser; the server renders the id into the template. `lib/views/**` is byte-identical |
| 2 | slug-alias redirect *(1 case, 4 assertion lines → 3)* (`test/lib/api/course.js`) | `301`, `wasOk` true, `Location` not containing the old slug, containing `foo-bar` | `500`, `wasOk` false, `content-type` `text/html` | The collision decided in full at [§6.2.3](#623-tst-70--the-one-collision-that-cannot-be-resolved-three-ways). `courseBySlug` returns `null`, which is the value the baseline shim also produced, and `lib/controllers/classes.js` then dereferences `course.archived` |
| 3 | delete materials (`test/lib/api/course.js`) | `should.not.exist(body.lesson.materials)` | `should.eql([])` | `lib/models/model.js` `serialize()` **always** writes `serialized[key] = []` for an Array-valued publicSpec key, so the key is present and empty rather than absent. That file is byte-identical, so `not.exist([])` could never have held |
| 4 | delete lessons (`test/lib/api/course.js`) | `should.not.exist(body.course.lessons)` | `should.eql([])` | Same mechanism, same file |
| 5 | reorder material *(1 case, 5 assertion lines → 2)* (`test/lib/api/course.js`) | `200`, `application/json`, index `0`, `1`, `lessonId` | `500`, `error: 'Internal Server Error'` | `lib/util/helpers.js` `internals.findById` treats a two-argument call as `(id, next)` when argument 2 is not a boolean, so `parent(payload.parent, pre.lesson)` assigns the Lesson **document** to `next` and then calls it. It fails for **every** payload. `lib/util/helpers.js`'s `internals.findById` is byte-identical; repairing the juggling would convert a 500 into a working reorder, the improvement R-d prohibits |
| 6–9 | four unauthenticated `/api/courses…` cases (`test/lib/api/course.js`) | `302` to `/login` | `401`, `wasOk` false, `application/json`, `error: 'Unauthorized'` | `app.js`'s error extension classifies any path beginning `/api/` as an API request and **skips the entire HTML-error block**, including the `h.redirect('/login').takeover()` arm. That extension is byte-identical to `2f8712a` |
| 10 | welcome page link *(1 case, 1 assertion line → 4)* (`test/lib/api/registration.js`) | body contains `/<user>/courses/<slug>/copy` | `wasOk` true, `302`, `Location` `/home` | `GET /welcome` is not a rendered page for an authenticated user; it redirects. `config/routes.js`'s declaration and the handler are byte-identical |
| 11–16 | six roles cases (`test/lib/models/plugins/roles.js`) | `user.hasRole('trinket-code')` true | `user.hasRole('user')` true | `lib/models/user.js` grants the role **`user`**; `lib/models/roles.js` then declares `permissions['trinket-code'] = permissions['user']`, which makes `trinket-code` a *separate role name* sharing a permission set. `hasRole('trinket-code')` is deterministically false. Both files byte-identical. The assertion is unchanged in strength — it still requires a granted role — and now names the role that is granted |
| 17 | shortCode length (`test/lib/models/trinket.js`) | `hash.substring(0, 10)` | `hash.substring(0, 12)` | `lib/models/trinket.js` uses `.substring(0, 12)`; the 10 belongs to the unrelated `verifyShortCode` path further down the same spec. Byte-identical |
| 18 | `findOne` call shape (`test/lib/models/trinket.js`) | `calledWithExactly(query, cb)` | `calledWithExactly(query)` | `lib/models/model.js`'s synthesized `findById` calls `this.model.findOne(query)` with **one** argument and returns the thenable; the callback is attached by `.then`, not passed through. Byte-identical. This is the assertion **DB-F17** reported as unable to exercise production behaviour |

Two things this register deliberately does **not** contain. It contains no row for a **weakened**
assertion, because there is none: every entry above replaces one exact expected value with another
exact expected value, and the negative tests recorded in [§5.1](#51-each-preserve-clause-bound-to-the-gate-that-proves-it)
confirm the replacements can still fail. And it contains no row for `test/lib/api/profile.js`, whose
only edit is to a **fixture value** it sends — `config.cloud.containers.userAvatars.host`, a
configuration namespace that has never existed in this repository (`git show 2f8712a:config/default.yaml`
declares no `cloud:` key), replaced by the real `config.aws.buckets.useravatars.host`. That is a
harness repair, not an expectation.

#### 6.2.2 Preconditions, drivers and doubles the suite had to supply itself

These alter what a case **sends**, or what the environment **provides**, and never what it expects.
They are listed in full because the line between a precondition and a weakened assertion is exactly
where this kind of work goes wrong.

- **`test/helpers/mail.js` stubs `mailer.isConfigured` alongside `mailer.send`**, because
  `config/default.yaml` ships no SMTP host and every mail-sending handler short-circuits *before*
  `send` with `request.fail`. Measured in the failing run as
  `info: { message: 'Email is not configured. Password reset is not available.' }`. Unblocks the four
  forgot-password cases and the trinket-share case.
- **`config.features.assets` is enabled for the file suite only**, and
  **`config.aws.buckets.useravatars.host` is replaced for the profile suite only** — each through
  `Object.defineProperty` in that suite's own `before`, restored in its `after`. The scoping is not
  incidental: an earlier draft set both in `config/test.yaml`, and that leaked into a sibling gate —
  `verify:joi` reported **32** differences with the global flag and **28** without it, the four extra
  rows all `POST /api/users/assetFromURL`, whose handler is gated on the same flag. `config/test.yaml`
  is byte-identical to `2f8712a` in the delivered tree, verified by `git diff`. Plain assignment was
  rejected because the `config` package persists it to `config/runtime.json`;
  `Object.defineProperty` persists nothing, which is the technique `app.js` itself documents.
- **`test/helpers/flow.js`'s outline driver sends `outline=true`** rather than `'yes'`, because
  `Joi.boolean()` rejects `'yes'`, `'1'`, `1` and `'on'` on joi **17.13.3 and 18.2.5 alike** —
  measured in two isolated installs, so this is not a consequence of the bump. The un-coerced value
  produced a validation flash and a `before all` hook failure that suppressed nine cases.
- **The two upload drivers build an RFC 7578 conforming multipart body.** superagent 0.16.0, which
  supertest 0.8.3 pins and which AAP §0.5.1.6 holds at that version, labels file parts
  `Content-Disposition: attachment`, while `@hapi/content` requires the disposition type to be exactly
  `form-data` and `@hapi/subtext` answers `Boom.badRequest('Invalid multipart payload format')`
  otherwise. The driver preserves superagent's measured per-part content types.
- **The file suite doubles `FileUtil.downloadMaterialFile`**, as the store helper already doubles Redis
  and the mail helper SMTP: the real implementation pipes an S3 `getObject().createReadStream()`, which
  no test host can serve.
- **The material-patch case establishes the `test content` precondition its own patch context line
  declares.** `diff` 1.0.8 never required it because it did not verify hunk context at all — measured:
  `applyPatch('', patch)` returns fabricated patched text on 1.0.8 and `false` on 8.0.4.
- **The download case supplies material bodies**, for the measured reason set out above.
- **The file suite switches multipart parsing on for `POST /file`**, suite-scoped and restored, because
  the shipped route answers 415 to every multipart body on hapi 20.3.0 and 21.4.10 alike. The route
  declaration is deliberately **not** changed; the reasoning, the precedence argument and the
  outstanding product decision are in [§6.2.4](#624-post-file-answers-415-to-a-multipart-upload-and-that-is-baseline).

#### 6.2.3 TST-70 — the one collision that cannot be resolved three ways

**Ambiguous, and irreducibly so.** Three requirements meet on one case and no two of them can be
dropped: the existing assertion at `test/lib/api/course.js` requires a **301** with a `foo-bar`
`Location`; the suite must be **green**; and R-d prohibits changing production behaviour. All three
cannot hold.

**Measured, in three steps.** First, the pre-handler. `lib/util/helpers.js` `courseBySlug` returns
`null` on a stale-alias request, and `lib/util/helpers.js` is byte-identical to `2f8712a` in the
region that decides it. Second, the baseline it is being compared against. At `2f8712a` the same
pre-handler executed `return reply().redirect(location).permanent().takeover()`, but the
compatibility shim's `fakeReply(undefined)` called `resolve(value === undefined ? null : value)` **on
its first statement**, so the later `.takeover()` resolve acted on an already-settled promise and did
nothing. **The pre value at baseline was `null` and the 301 was never observable** — the capability is
dead end to end, which is why `_isRedirect`, `_permanent` and `_takeover` appear only on the six lines
that define them. Third, the response. With the pre value `null`, `lib/controllers/classes.js`
dereferences `course.archived` on `null` and the handler catch-all answers **500 text/html**. Measured
live: a course renamed to "foo bar", then a request for the old slug, returns 500.

**Resolution: production is preserved and the assertion is corrected, and the controlling requirement
is R-d.** Returning `null` is not a regression to repair — it reproduces the baseline pre value
exactly. Making the route emit a real 301 would be introducing a redirect that has never fired in this
application, which is precisely the behaviour improvement R-d prohibits, and it would do so on five
route declarations. The assertion is therefore corrected to the measured 500, exactly rather than
loosened, and it remains a live assertion: it fails if the route ever starts answering anything else,
including the 301 it once claimed. The dead capability itself is catalogued in
`docs/preserved-quirks.md` as `quirk.dead-301.course-by-slug-alias`, with the two-step corpus scenario
that reaches it.

**What a reviewer should take from this row.** The 301 in the baseline spec was an assertion about
*intent*, never about behaviour — it could not have passed at `2f8712a` either, because the suite did
not run there at all. Preserving it would mean preserving a claim that was never true; the 500 is the
first honest statement this case has made about what the route does.

#### 6.2.4 `POST /file` answers 415 to a multipart upload, and that is baseline

**Ambiguous.** The four file cases assert a working upload — 200, a JSON body, a `File` document, a
digest-derived path — and the route as shipped cannot produce one.

**Measured.** `payload.multipart` has defaulted to **false** since hapi 19, and a
`multipart/form-data` body sent to a route that does not set it is rejected by `@hapi/subtext` with
**415 Unsupported Media Type** before the handler runs. Measured in two isolated installs — hapi
**20.3.0** with subtext 7.1.0 and **21.4.10** with subtext 8.1.3 — with the identical result, and
`app.js` sets no server-level `routes.payload` default. So `POST /file` answers 415 at base commit
`2f8712a` exactly as it does here. This is a consequence of the **earlier, partial hapi 18 → 20
upgrade** that predates this work: the route declaration was written when multipart was parsed by
default, and nobody added the flag when the default flipped.

**Resolution: the shipped route is left answering 415, and the parser is switched on in the harness
for the duration of the file suite only.** The controlling requirement is **R-d**, and the precedence
argument has to be stated because it runs the *opposite* way to the one AAP §0.7 makes for the
never-settling file response — which is the closest-looking case in the whole migration.

| | `lib/controllers/files.js:98-100` (§0.7, **R-b** controls) | `POST /file` multipart (**R-d** controls) |
|---|---|---|
| What baseline does | Never settles — the client receives **nothing** | Answers **415** — a real, complete HTTP response |
| Is it behaviour a client can depend on? | No: the absence of a response is not a contract | Yes: 415 is a status a client can and does handle |
| Is the intended behaviour present in the code? | Yes — the sibling branch four lines below performs the identical chain ending in `.header()` and returns a working response | No — no route in the application sets `multipart`, so there is nothing to read the intent off |
| Does R-b's "every route serves" bite? | Yes — the route does not serve at all | No — the route serves; it serves 415 |

Adding `multipart: true` to the declaration would therefore be a behaviour improvement, and it would
also be an **unauthorized manifest change**: AAP §0.4.1 authorizes exactly one edit to
`config/routes.js` — the `js-yaml` call site — and AAP §0.9.1 compares the 233-entry manifest **per
entry**, options included. It was tried, and the gate catches it: re-injecting the flag makes
`verify:routes` exit 1 with `POST /file … options … "multipart":true` named against the baseline.
`config/routes.js` in this delivery differs from `2f8712a` by the `js-yaml` hunk and nothing else,
verified by `git diff`.

The harness switches the parser on through `server.match('POST', '/file').settings.payload.multipart`
in the file suite's own `before`, restoring the original value in its `after`. Verified on 21.4.10 that
`settings.payload` is a plain, unfrozen object that `@hapi/subtext` reads at parse time, that a mutated
route then answers 200, and that the restore is clean. That keeps four cases exercising real production
code — the sha1 hashing, the extension whitelist, the mime resolution, the `File` document and the
download handler — instead of trading them for an assertion about a framework default, while leaving
the deployed route's behaviour exactly where baseline left it.

**What a human must do.** Setting `payload.multipart: true` on `POST /file` and `POST /file/avatar` is
almost certainly the correct product change — file upload is the feature those routes exist for — but
it is a behaviour change to the shipped HTTP surface, it moves the route manifest, and it therefore
needs its own approval rather than being folded into this migration. It is recorded here as
outstanding work, not as a resolved defect.

**One dependency-driven behaviour change follows from that last item and is recorded rather than
hidden.** With `diff` at 1.0.8 a conflicting patch was applied anyway, so
`PUT …/materials/{materialId}/patchContent` answered 200 for every input; on 8.0.4 a genuinely
conflicting patch returns `false` and the handler takes its "modified in another window" branch,
which measures as a 500 for the reason recorded in `lib/controllers/course.js`. The `diff` bump is
mandated by R-c for a HIGH advisory on the 1.x line and no option set reproduces 1.0.8's leniency
(`compareLine`, `fuzzFactor`: measured, none matches), so R-c controls and R-d cannot be satisfied for
that input class.

**A green suite is still not attribution, and the corpus is what would supply it.** The suite proves
that every case it registers passes; it cannot prove that a converted controller answers what its
predecessor answered on a path no case exercises. That is what the corpus is for, and it now exists as
a real recording of the base commit — 383 scenarios, 383 recorded responses, 233 of 233 routes
represented. What remains is the **comparison**: `verify:corpus` refuses the committed artifact until
it is re-captured through the delivered generator ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)), so the largest gap in this
evidence is no longer a missing baseline but an unrun replay, and it is carried into
[§8](#8-what-remains-unproven) as an open item rather than presented as a pass.

### 6.3 No database provisioning

**Ambiguous.** The request's own command sequence is `git clean -xfd && npm ci && npm test`, and it
does not say what provides the database.

**Measured.** Nothing in the repository starts MongoDB. The suite simply connects to
`localhost:27017` through `config/test.yaml`, so on a host without a running instance every
database-backed case fails for a reason unrelated to the migration.

**Resolution.** `mongodb-memory-server`, added as a devDependency at an **exact** pin, wrapped by the
`test` script so the user's `npm test` is unchanged
([§2.7](#27-database-provisioning)). It was selected over a container because it is the only option
that works under the user's own stated sequence on a host with no Docker. The same module backs the
corpus and worker harnesses.

### 6.4 A clean tree cannot boot

**Ambiguous.** The request begins with `git clean -xfd`, and the consequence of that on this
repository is not obvious.

**Measured.** `git clean -xfd` deletes `config/local.yaml`, which is gitignored and is the **only**
source of a session-cookie password; `config/default.yaml` ships that password **empty**; and the
bootstrap calls `process.exit(1)` when it is shorter than 32 characters. A test-only secret does not
settle it either — a plain `node app.js` loads the development configuration and exits, and a
clean-built container has the same problem.

**Resolution.** One mechanism covering all three cases: **a development-and-test-only generated
default**. When the password is unset and the environment is not production, the bootstrap derives an
ephemeral secret and logs one line saying so; **the production fail-fast is retained and is evaluated
first**, so no production process can reach the fallback (**read**: `[T app.js:48-70]`). No production
secret is committed. `config/test.yaml` still carries a fixed test secret so session values are stable
across a capture-and-replay pair, and the container supplies a real secret through its runtime
environment. This is what makes a plain `node --pending-deprecation app.js` possible on a clean tree
at all, which the warning gate in [§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application)
depends on.

### 6.5 The ready boundary could not be a Mocha preload

**Ambiguous.** The obvious repair for defect 4 above is to await the exported promise in a root
`before` hook registered from the environment preload.

**Measured.** **That is impossible.** Mocha 3.5.3 loads `--require` modules **before** it installs the
BDD globals, so inside such a module `typeof before === 'undefined'`. And CommonJS — retained by
decision, see [§6.8](#68-whether-the-framework-upgrade-forces-esm) — has no top-level `await`, so the
promise cannot be resolved at module scope either.

**Resolution.** A **three-file boundary**, each file documenting what it took over: `test/env.js`, the
preload, which sets the environment and registers **no** hooks and asserts that `before` is absent so
the ordering cannot silently regress; `test/lib/00-ready.js`, the **first** file the narrowed
`test/lib/**/*.js` glob collects — the `00-` prefix is an interface, because glob returns its matches
sorted and that is the whole reason its root hooks run first — which awaits the exported promise and
publishes the resolved server; and `test/lib/ready.js`, a one-property mutable holder the flow
helper reads lazily in `createRequest`. No existing spec's `require` changed.

### 6.6 Native hapi validation is unreachable here

**Ambiguous.** The request asks for `joi` on its current line, which reads like an invitation to adopt
hapi's native validation at the same time.

**Measured.** Three things, and they compound. hapi 21 **asserts** on an uncompiled plain-object
validation schema unless a validator has been registered, and `server.validator(` is never called
anywhere in this repository. The route parser executes `delete route.options.validate` for **every**
route, and after parsing `options.validate` survives on **0 of 233** routes — re-measured in this
delivery ([§3.1](#31-the-route-surface-re-derived-from-the-delivered-manifest)). And the behavioural
difference is decisive: the hand-rolled block validates `request[key]` for **arbitrary** keys, which is
a superset of hapi's payload/query/params/headers/state, and on failure it flashes into the session and
routes through the failure funnel — producing a **redirect or a rendered failure page**. A probe against
a real hapi 21.4.10 listener measured the preserved path returning **302** where native validation
returns **400**.

**Resolution.** **Bump `joi`, keep the hand-rolled path.** Both halves of the request are honoured and
they pull in different directions; the response-shape contract wins because it is observable
behaviour. Parity across all **102** targets is a gate rather than an inference, and it carries a trap
worth recording because it looks like a tooling bug later: **the matrix cannot read its schemas from
parsed route objects** — the parser deletes `validate`, so reading parsed routes yields **zero**
targets, measured in an attempt at exactly that shortcut. It therefore requires the declaration modules
directly and reads `config.validate` off a **pre-parse deep copy**, which is the same pre-parse source
the manifest generator uses. `structuredClone` will not do: route objects hold pre-handler **functions**
and joi **schemas**.

**Status — the target side has now been run, and the accept/reject question is clean.** The baseline
side is captured at `joi` 17.13.3 — **artifact**: `joi-baseline.json` in capture mode, 102 targets, 306
cases, 462 drives, 0 timed out. The comparison at 18.2.5 was driven at the evidence commit in this delivery, replaying
the recorded inputs against a real listener, and it compared **102 targets, 306 cases, 462 outcomes and
13 427 fields**:

- **0 schema-level differences** — that is the joi accept/reject question itself, and it is the clause
  the PRESERVE directive names.
- **0 generated-input differences**, so the two runs put the same bytes on the wire; a matrix that
  built different inputs would have compared nothing.
- Corroborating invariants held: **94 of 101** rejecting cases reached the validation block, one
  followed page rendered a validation message, and **both `language` maps still produce the raw joi
  message**, so the inertness recorded in [§6.7](#67-the-custom-validation-language-maps) survives the
  bump end to end.

**It exits 1, and the reason is not a validation difference.** 28 fields differ, all in the `http` and
`summary` scopes, and every one of them is downstream of the **baseline** capture having crashed: the
baseline artifact records **7 crashes and 7 restarts**, the target run records **0**, so five cases move
from a baseline `status: null` — a transport failure recorded after the process died — to a target
**500**, with `contentType`, `error` and `bodyKeys` following, and seven `precededByCrash` flags flip
`true` → `false`. The class is the same one [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) measured
from a different direction: a handler hands an `Error` to the response toolkit, hapi asserts *"Cannot
wrap an error"*, and at baseline the uncaught async exception **exits the process** while the delivered
tree answers 500.

**That difference is a measurement this file records and does not adjudicate.** Whether a
process-killing baseline edge answering 500 is an approved change belongs to the canonical deviation
record in `docs/preserved-quirks.md`, which owns what is preserved and what is deliberately not; the
audit trail here is the artifact, the count and the attribution. What this file does assert is the
narrower claim the gate was built for: **no validation outcome moved**. The residual is carried into
[§8](#8-what-remains-unproven).

### 6.7 The custom validation `language` maps

**Ambiguous.** Two route declarations carry a custom `language` map that keys a friendly username
message on the substring `"regular expression"`. Whether the `joi` bump would break them looked like a
regression risk.

**Measured.** They are **already inert, on both versions**. A regex failure produces
`"username" with value "9bad" fails to match the required pattern: /^[a-z][a-z0-9\-\_]*$/i`, which
contains **no such substring** — measured on **both** 17.13.3 and 18.2.5, and confirmed end to end by
driving the route and observing the raw joi message in the flash
(**artifact**: `joi-baseline.json`, `inertness`).

**Resolution.** **Preserved as inert.** The bump does not change that, and under R-d the inert mapping
is preserved rather than repaired. The consequence for the gate is worth stating in the other
direction: **if the friendly message ever appears, that is a failure**, not an improvement.

### 6.8 Whether the framework upgrade forces ESM

**Ambiguous.** The request keeps CommonJS "unless the framework upgrade strictly forces otherwise",
which required a measurement rather than a judgement.

**Measured.** Node 22.23.2 `require()`s ESM-only packages successfully, so nothing in the upgrade path
forces a module-system change.

**Resolution.** **CommonJS retained by choice, supported by evidence.** This is not a neutral
decision: it is what constrains the harness fix, because the absence of top-level `await` is one of the
two independent reasons the ready boundary cannot be a preload
([§6.5](#65-the-ready-boundary-could-not-be-a-mocha-preload)).

### 6.9 Whether Node-core callback conversions should be filtered by warning emission

**Ambiguous.** The request says Node-core callback APIs on the hapi-facing surface become promise
equivalents, and separately sets a zero-deprecation-warning bar. Reading the first through the second
would convert only the sites that warn.

**Measured.** Several do not warn at all on Node 22: `util.promisify(fs.writeFile)`, callback
`fs.stat`, callback `fs.unlink` and `fs.exists` each emit **nothing**. Filtering by warning emission
would therefore have left three callback `fs` sites **inside route handlers** unconverted.

**Resolution.** **Convert Node-core callbacks inside the hapi-facing surface regardless of whether
they warn**, on the request's own wording; an earlier reading that gated the conversion on warnings was
**wrong**. The conversions preserve timing and error handling rather than tidying them: the
fire-and-forget `fs.unlink` stays fire-and-forget with its error still swallowed, and the recursive
delete still **waits** before the response is returned, because baseline waits for its callback before
the final header resolves.

The complementary rule is the one that keeps the boundary somewhere: the `await` is created **at the
call site inside the converted handler**, not pushed into the utility. Four internal callback modules
therefore keep their callback interfaces, and that exclusion rests on the request's own two tests —
zero warnings **and** the existing suite passing unmodified. The first is measured and none of them
warns; **the second cannot be evidenced until the suite is green**, so the exclusion is provisional and
appears in [§8](#8-what-remains-unproven).

### 6.10 `server.inject` on the live request path

**Ambiguous.** Two controllers call `server.inject` to re-enter one of their own API routes. Whether
that is a deprecation problem or an architectural one was not obvious.

**Measured.** hapi's injection module emits **DEP0169** under injection, and injection is on the
**live request path** at both sites — so this is a handler-time warning that a boot check can never
reveal.

**Resolution.** **Extraction, not substitution.** Both re-entered routes carry their own JSON
negotiation, validation, pre-handler context, response projection and error mapping, so one handler
cannot simply call the other and borrow its contract. The shared logic is lifted into plain async
functions that each caller projects for itself.

**And the extraction surfaced a preserved quirk that a substitution would have silently fixed.** With
no query present, the folder handler builds its injected URL with an `&` where a `?` belongs, so
`folder` is never parsed as a query parameter and the filter **does not apply**; with a query present
the URL is well formed and it does. Both cases were measured during the extraction and both are
preserved; the corpus **records** them as a two-step sequence driven against the base commit, and the
comparison against the delivered tree waits on the precondition in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries).
Passing the folder directly in both cases would have accidentally fixed the queryless path, which R-d
forbids.

### 6.11 "Zero deprecation warnings across the ENTIRE running application"

**Ambiguous.** The emphasis is the request's own, and during planning the claim could not be fully
measured: boot terminated at a Mongo selection error before any route served, so the captured warning
set was a **boot floor** — and the two `server.inject` sites in
[§6.10](#610-serverinject-on-the-live-request-path) prove handler-time warnings exist that boot never
reveals.

**Resolution.** The gate exercises the **listening server**, a full replay pass over all 233 routes,
and the standalone worker, under `--pending-deprecation --trace-deprecation`, with stderr captured for
each. Pass condition: **no warning or deprecation notice attributable to the application's own source
or to any dependency this migration retains.** The injection deprecation is **not** excluded — it was
remediation work.

**Measured in this delivery, on a listening server rather than a boot floor.** Both trees were booted
with `node --pending-deprecation --trace-deprecation app.js`:

| Tree | Distinct warning classes | Sources, traced |
|---|---|---|
| Baseline `2f8712a` | **4** | `[MONGOOSE]` strictQuery from `[B config/db.js:35]` · `[DEP0005] Buffer()` traced to `iconv-lite/lib/index.js:139`, reached through `nodemailer` 2.7.2 → `libmime` · `[DEP0169] url.parse` traced to `@mapbox/node-pre-gyp/lib/util/versioning.js:224`, reached through `bcrypt/bcrypt.js:5` · the AWS SDK v2 end-of-support `NOTE` |
| Delivered | **0** | none |

The delivered tree reached `Server started` with **no warning of any class in the boot log**, and the
surface was then driven: **all 233 registered routes, materialized from the route manifest, requested
under two identities — anonymous and a seeded logged-in user — for 466 requests in total. Every route
answered (no timeouts, no unreachable entries) and no warning appeared at any point.** Status
distribution over the 466: 174×404, 147×401, 71×302, 60×200, 7×500, 7×403. The **standalone export
worker** was then loaded in its own process under the same flags — the other module that requires
`archiver` — and it too emitted nothing.

This is the full-surface measurement the gate asks for, not a boot floor: boot, every method
(GET·137, POST·63, PUT·19, DELETE·13, PATCH·1), both identities, and the worker.

All four of the baseline's classes are **cleared**, each by the change that was supposed to clear it:
`strictQuery` by the explicit setting in the database configuration, the `iconv-lite` `DEP0005` by the
`nodemailer` bump, and the `node-pre-gyp` `DEP0169` by the `bcrypt` bump. **The AWS notice is absent
from the delivered log entirely**, which settles an item AAP §0.9.6 listed as unproven — see
[§6.17](#617-the-aws-sdk-v2-notice-suppression-was-proven-not-deferred).

All four of the baseline's classes are cleared, and **the gate's stated pass condition — no warning
attributable to the application's own source or to any dependency this migration retains — is met.**

**How the fourth one was cleared, because an interim delivery reported it as a shortfall.** An earlier
state of this delivery measured one residual class: `[DEP0005] Buffer()` traced to
`compress-commons/lib/archivers/zip/constants.js:11` at module load, resolved by `npm ls
compress-commons` to `archiver@2.1.1 → zip-stream@1.2.0 → compress-commons@1.2.2`. `archiver` was at
that point **retained**, deferred on the grounds that it carries no advisory of its own — true of
advisories, and silent on warnings. It was recorded here as a named shortfall with the remedy
identified as "a decision about `archiver`".

That decision was taken: **`archiver` moved 2.1.1 → 6.0.2**, which removes the warning at its source.
The version was not chosen to silence a warning alone — the same measurement found archiver 2.1.1 also
writing zero crc32 and zero uncompressed size into every deflated entry, so the archives the export
worker and the download routes produced could not be read back by the application's own `adm-zip` —
and 6.0.2 is the lowest version that clears both while leaving the archive's layout unchanged: the
same total byte count, the same per-entry compression method and the same compressed sizes. It is not
byte-for-byte identical, and must not be described that way — the CRC and uncompressed-size fields
deliberately differ, because those are the bytes that were wrong.
[`deferred-dependencies.md` §2.6](deferred-dependencies.md) carries the measurement, the mechanism and
the parity evidence, and [`dependency-inventory.md` §3](dependency-inventory.md) carries the row.

So this is **no longer a second shortfall against a stated target**. The audit deviation in
[§7.2](#72-deviation-2--the-marked-fork-is-retained) stands alone as the delivery's one named
deviation.

**The residual limit of even this measurement**, stated so the number is not over-read: the sweep
drove one request per route per identity with minimal payloads, so it exercises each handler's entry
and its dominant branch rather than every branch within it — 174 of the 466 answered 404 and 147
answered 401, which are real answers from the routing and auth layers but not deep executions of the
handler body. Two identities were used, not five. The exhaustive per-branch, five-identity pass
belongs to the replay gate, whose baseline is recorded and whose comparison awaits the re-capture
precondition in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries).

### 6.12 Whether the `serverside/**` plane counts as "the application"

**Ambiguous.** R-b's prohibition on containers pinned to an old runtime does not say whether the
separate `serverside/**` execution plane is part of "the application".

**Measured.** **Nine of the repository's ten Dockerfiles carry an old Node runtime** — the root image,
four manager images, and four more that install Node **inside a non-Node base** (a pinned
`NODE_VERSION`, an nvm install, a second pinned `NODE_VERSION`, and a NodeSource setup script). Only
the nginx image does not.

**Resolution.** **Resolved by inclusion**, because the rule is unqualified and the request grants no
exemption. An earlier reading that narrowed "the application" to the root monolith and asked for
confirmation is **withdrawn**: a scope question left open is not something an implementing agent can
build from. All nine move to Node 22. The four manager **manifests are unchanged**, and that is the
correct outcome rather than a shortfall: AAP §0.4.1 carries the manifests **and their lockfiles** in a
single row, in which the **lockfiles are the regeneration** — the baseline tree carried none, so each
is a **first-time creation** resolved on Node 22 — and the **manifests are the validation**, an
obligation whose pass condition is that they declare no `engines` at all, because runtime pinning for
these units lives in each unit's `Dockerfile`. AAP §0.9.5 states that obligation as the manifests
resolving and the units booting on Node 22, and both halves are measured below.
`docs/dependency-inventory.md` records the same delivery. **Serverside application code is not
converted** — those units carry no hapi surface, one declares `"type": "module"`, and they are
separately deployed — so the work there is runtime pinning, dependency resolution and a boot check.

#### The dependency resolution and the boot check, run per unit

**Measured.** On `node v22.23.2` with `npm 10.9.8`, each of the four units installs from its committed
lockfile and boots. `npm ci` exits 0 — **43** packages (java), **46** (python), **41** (pygame) and
**43** (r) — with no `EBADENGINE` notice, and `npm ls --depth=0` reports no `UNMET` or invalid
dependency in any of them. Each manager then answers `GET /health` with **HTTP 200**,
`application/json` and `{"status":"ok"}`; python also answers `/stats.json` with
`{"active":0,"available":1,"mode":"local"}` and completes a Socket.IO handshake over the `websocket`
transport with its own client 4.8.3; and pygame's **module-scope top-level `await mkdir` executed**,
which is what proves `"type": "module"` parsed and ESM top-level await ran on Node 22. All four boot
logs are free of any warning or deprecation notice, python additionally under `--pending-deprecation`
with zero matches, and a subsequent `npm install` left every manifest **and** every lockfile
byte-identical — so the committed lockfiles are the resolution these units already have, not one the
install rewrites. Two limits keep the measurement from being over-read. The units were booted
**directly on the host**, not inside their images: no manager image was built, which is why the
Dockerfile row in [§8](#8-what-remains-unproven) stays open. And the configured `shells` and worker
endpoints are unreachable outside the compose network, which is **preserved rather than fixed** as R-d
and R-f require — acquisition is lazy, so `/health` answers regardless.

**Resolution.** **Treat the four units' dependency resolution and boot on Node 22 as measured, and
close the open item rather than carry it.** AAP §0.9.6 listed these units as unproven with "dependency
resolution plus a boot check per unit" as the gate that settles them; the measurement above is that
gate, run per unit, so the row leaves [§8](#8-what-remains-unproven) rather than standing there with
its own gate discharged. What remains open on this plane is the **image build**, which is a different
gate and keeps its own row.

### 6.13 An eighth harness defect: the session cache never starts

**Newly discovered.** Not in the plan's list of seven, and the delivered tree records why: it was
**unreachable until the lazy Supertest agent made API requests possible in the first place**.

**Measured.** `config/test.yaml` sets `app.start: false`, so the bootstrap never calls
`server.start()` and hapi stays in its `stopped` phase. In hapi 17+ it is that **phase transition**,
not the listener, that starts catbox clients — initialization awaits `client.start()` for every
provisioned cache. The session store is such a cache. Left unstarted, every request that commits a
session fails inside the session plugin's own `onPreResponse` with `Error: Disconnected`, which hapi
maps to a **500**. Measured through `server.inject`, so with no Supertest involvement at all:
`POST /users` returns **500** without the fix and **302** to `/welcome` with it — the latter being what
the registration suite asserts.

**Resolution.** The readiness hook calls `server.initialize()`, which starts the caches **without
listening**, guarded on `server.info.started` because initialization throws unless the phase is
`stopped` and a configuration that *did* start the server must be left alone. Supertest still wraps the
non-listening listener and starts its own ephemeral one, so the arrangement the harness is written
against is unchanged. Recorded here because it is exactly the kind of defect the ordering in
[§1.5](#15-the-execution-order-consequence-and-the-order-actually-delivered) hides: fixing one defect
is what made the next one observable.

### 6.14 A single-pass capture does not complete

**Newly discovered.** Owned in full by [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries), summarized here
so the log is complete: an admin route hands an `Error` to the response toolkit, hapi asserts "Cannot
wrap an error", and the uncaught async exception **exits the process** — measured three times,
including in isolation where it records `ECONNRESET` in under 20 ms, and independently corroborated by
the joi matrix's **7 crashes and 7 restarts** across 462 drives. **Resolution:** capture in coherent
segments, drive that scenario alone, never commit post-crash transport failures, and never merge passes
that ran on different ports or against differently mutated databases.

### 6.15 The delivered order differed from the planned order

**Newly discovered**, and recorded because R-f requires the record to describe what happened rather
than what was intended. **Measured** from `git log --oneline 2f8712a..HEAD`: conversions and shim
removal landed **before** the parity harness existed
([§1.5](#15-the-execution-order-consequence-and-the-order-actually-delivered)).

**Resolution.** The evidence is unaffected **where a baseline worktree was used**, which is why the
two-worktree architecture in [§1.2](#12-two-worktrees-each-independently-installed) is not a
convenience but the thing that rescues the measurement — the route manifest, the CLI tables, the joi
baseline and the error-edge inventory are all genuine baseline measurements taken that way. The
evidence **is** affected in two places, both recorded: the corpus was never captured
([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)), and the "assertions green before conversion"
reassurance was never available ([§6.2](#62-npm-test-had-no-green-baseline)).

### 6.16 A retained dependency emitted a deprecation warning — and was found to be writing invalid archives

**Newly discovered and now resolved**, owned by
[§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application). The short form: the
deferral rule permits leaving a package in place when it is functioning correctly **and warning-free**,
and the deferral record for `archiver` reasoned about **advisories** — correctly concluding it has
none — without addressing warnings or correctness. Its transitive `compress-commons` called the
deprecated `Buffer()` constructor at module load, so every boot of the application printed a
`[DEP0005]`.

Investigating that warning surfaced the larger problem in the same dependency chain. `crc32-stream`
2.0.0 accumulates an entry's checksum and raw byte count inside an override of
`Writable.prototype.write`, and modern Node's `Writable.prototype.end(chunk)` writes the chunk through
an internal helper instead of through `this.write`. The override therefore never ran for the buffer
and string appends `compress-commons` performs, and archiver 2.1.1 wrote **crc32 = 0 and uncompressed
size = 0** into the local header, the data descriptor and the central directory of every deflated
entry. The compressed size stayed correct, which is why the defect was invisible in the archive's
size and structure. The application's own reader could not read those archives back: `adm-zip` 0.4.16
returned an empty buffer silently, and the upgraded 0.6.0 throws `ADM-ZIP: CRC32 checksum failed`.

**Resolution:** `archiver` moved 2.1.1 → 6.0.2, the lowest version that is both warning-free and
standards-correct. The archive is unchanged where it was already right — identical total bytes,
identical per-entry compression method and compressed size — and correct where it was wrong. Verified
end to end: `POST /api/trinkets/download` on the running server returns a 200 `application/zip` whose
entries read back byte-exactly through the application's own `adm-zip`. This item is closed rather
than carried into [§8](#8-what-remains-unproven).

### 6.17 The AWS SDK v2 notice suppression was proven, not deferred

**Newly resolved.** The SDK v2 end-of-support banner prints on **stderr**, and the request permits
deferring a package only when it is warning-free — so leaving it would have contradicted both the gate
and the deferral rule, while migrating eight call sites to v3 is a storage-layer rewrite outside R-a.
The decision was to retain v2 and suppress the notice through the SDK's **own supported
configuration**, with a stated fallback of recording it as a single permitted stderr line matched
literally if the flag proved ineffective on 2.1693.0.

**Measured.** The fallback is **not needed**. The baseline boot prints the notice; the delivered boot
does **not**, and it is absent from the whole log including the 233-route, two-identity sweep
([§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application)). It also still prints
from a **baseline** tree when the manifest generator loads the controllers there, which is why both
generation commands discard stderr explicitly
([§3.5](#35-aggregate-counts-are-a-summary-not-the-gate)) — the suppression is a delivered-tree
setting, not a property of the environment.

**Resolution.** **Retain the SDK at v2 with the notice suppressed through its own configuration, and
close the open item rather than carry it.** AAP §0.9.6 listed the suppression as unproven with a
literal-match fallback held in reserve; the measurement above discharges it, so the fallback is
withdrawn and no permitted-stderr-line exception is recorded. The suppression changes no call site, no
request behaviour and no stored object, which is what keeps it inside R-a's dependency category, while
migrating the eight call sites to v3 is a storage-layer rewrite that remains deferred.

### 6.18 A fixture identity the seeder does not seed

**Newly discovered**, owned by [§2.5](#25-the-isolation-architecture--interception-at-the-module-boundary).
The short form: the HTTP fixture's seeding contract asks for an `existing` OAuth identity that the
seeder does not create, and neither artifact can be aligned from the other because the fixture's
alignment call runs only inside the server process. **Resolution:** reached as an ordered two-step
sequence in which the new-user branch creates the account first — using the quirk under test as the
mechanism — rather than by editing a sibling artifact. The gap is real, is recorded rather than closed,
and closing it in the seeder would make the sequence unnecessary without changing what it captures.

### 6.19 `/api` and `/library` answer 404, against a smoke check that expects 200

**Ambiguous.** `test/smoke-test.sh` asserts **200** for bare `GET /api` and `GET /library`. Nothing in
the request or the plan says which is right, and the two cases added to `test/lib/api/pages.js` had to
adopt one of them, so this is an R-f question and not a matter of taste.

**Measured.** Both answer **404** with `content-type: text/html; charset=utf-8`, authenticated or
anonymous, and before as well as after the component fetch and the asset build. Re-measured at the evidence commit in
this delivery on a listening server, with controls, so the 404 is not an artifact of a broken boot:

```text
GET /api       -> 404  text/html; charset=utf-8
GET /library   -> 404  text/html; charset=utf-8
GET /          -> 200  text/html; charset=utf-8
GET /login     -> 200  text/html; charset=utf-8   (anonymous)
GET /about     -> 200  text/html; charset=utf-8
```

and independently reproduced inside the built container image, where the same two paths answer 404
while `/css/base.css` and `/css/embed.css` answer 200
([§5](#5-the-gate-register-and-what-each-gate-proves)).

**The cause is that neither path has a route.** No literal declaration for either exists in `config/`,
and the only `/library`-prefixed routes are `GET /library/folder/{slug}` and
`GET /library/trinkets/{path*}` — deeper paths that bare `/library` does not match. Both facts are
visible in the 233-entry manifest, which holds **0** entries for either path (**measured**, from the
generated manifest rather than by reading the declarations). So both requests fall
through to the Inert catch-all serving `./public`, which contains no `api` or `library` entry; Inert
resolves neither a file nor a directory index, produces a 404 Boom, and the error extension renders
`404.html`. The component fetch populates only `public/components`, which is why fetching it cannot
change the outcome — confirmed rather than assumed, by measuring before and after.

**Resolution. 404 is adopted as the baseline value**, and the two cases in `test/lib/api/pages.js`
assert it. The smoke script's 200 is not evidence to weigh against a measurement: it targets a deployed
stack and it has never been green against this checkout. Run against the delivered tree at the evidence commit it
reports **8 passed, 3 failed**, and the three failures are exactly `/api`, `/library` and the HTML
trinket page — the last one because that language is disabled by configuration rather than missing
(**measured**: `PORT=20150; bash test/smoke-test.sh "http://127.0.0.1:$PORT"`). A script that is wrong about three
paths cannot arbitrate two of them. The alternatives were both prohibited: adding a route changes the HTTP
surface that the manifest gate in [§3.5](#35-aggregate-counts-are-a-summary-not-the-gate) exists to
hold fixed, and creating a `public/api` or `public/library` directory to manufacture a 200 would invent
behaviour the baseline never had. Under R-f the measurement decides, and under R-d the measured
behaviour is preserved rather than improved.


---

## 7. The two approved deviations

These are the **only** two places in the migration where something is deliberately **not** preserved or
**not** delivered as the request specified. Both are approved, both are argued, and neither is a
placeholder.

**Numbering follows `docs/preserved-quirks.md` §11**, which is the canonical statement of both.
Deviation 1 is owned in full there; deviation 2's full reasoning is owned by
`docs/deferred-dependencies.md` §4.2. **The three records are intended to be consistent, so a
divergence between them is a defect to fix rather than a variation to interpret.** What this file adds
is the third thing neither of them owns: **how each is evidenced by the parity method**.

**That three-way comparison has been executed rather than promised**, and its result is recorded in
both companion documents' alignment sections as well as here. Both deviations agree across the three
records on every element that **decides** them: the conflict statement, the decision, deviation 1's
exact target expression and its omitted `Content-Disposition`, deviation 2's four measured rendering
differences and its every-parse deprecation notice, the ownership assignments, and the numbering — 1
then 2 in all three. **Two divergences were found, one per deviation. The first is now RESOLVED by
measurement and the second is named rather than harmonised** — neither ever changed a decision, a
version, a target expression or a gate:

- **Deviation 1's evidence state — the divergence resolved, in favour of the companion documents.**
  `docs/preserved-quirks.md` §11.1 and `docs/deferred-dependencies.md` §4.1 both say, in the present
  tense, that the corpus **records** the baseline timeout and that the target answers. An earlier
  version of this section said the opposite and cited the artifact for it (`captured: false`,
  `baselinesPending: 383`, zero non-null baselines). **The artifact now supports those two documents**:
  the corpus records `timedOut: true` for that scenario against the base commit, and a replay verifies
  the target answering, field by field ([§7.1](#71-deviation-1--the-never-settling-file-response)).
  The two forms that were offered to settle it were "the carrier sentences become prospective, or a
  capture is driven" — the capture was driven, so the carrier sentences stand as written and it is this
  document that changed.
- **Deviation 2's `highlight.js` attribution.** The two companion documents disagree about whether
  `highlight.js` staying at its baseline version is a *consequence* of retaining the fork or an
  independent moderate-only deferral. Both keep 9.18.5, so only the causal claim differs, and it lives
  in a sentence one of them owns.

`docs/error-edge-inventory.md` is not a fourth leg: it states neither deviation.

### 7.1 Deviation 1 — the never-settling file response

`[B lib/controllers/files.js:98-100]` never settles: the image-download branch of `files.download`
calls `reply(stream).type(...).bytes(...)` with no `return` and no resolving call, so the request hangs
indefinitely. **R-d requires that the outcome be preserved. R-b requires that every route serve. Both
cannot hold.**

The decision is that **the target serves the stream response, and R-b controls** — the migrated branch
returns `h.response(stream).type(request.pre.file.mime).bytes(request.pre.file.size)` at
`[T lib/controllers/files.js:171-173]`, with `Content-Disposition` still omitted. Three reasons, which
are also precisely why the same reasoning does **not** transfer to
[§7.2](#72-deviation-2--the-marked-fork-is-retained): an unsettled request is **not a behaviour a
client can depend on** — it is the *absence* of a response, and R-d's protection is for clients that
may rely on observable behaviour; the intended response is **not inferred but present in the same
function**, since the sibling branch four lines below performs the identical chain ending in
`.header(...)` and returns a working stream response, so this is a reconstruction rather than a guess;
and **R-b is unqualified** about routes serving, whereas the `marked` conflict pits a prohibition
against a validation *target* — the opposite balance, resolved the opposite way.

**How the parity method evidences it, and what is measured today.** Scenario
`quirk.reply-chain.never-settles.image-download` is the **only** scenario in the corpus carrying an
`expectedDeviation` marker, attributed to `AAP 0.7` and to rule `R-b`, and declaring the baseline
expectation `timedOut: true`. The baseline side is **recorded**: the committed corpus holds
`baseline: {status: null, timedOut: true, transportError: null, contentType: null, location: null,
bodyLength: null, bodyDigest: null}` for it (**artifact**), which is the expected timeout captured as a
result rather than as a hang.

**The target side is measured, and the deviation is verified.** A replay of that scenario against this
tree records it as an **approved deviation rather than a difference**, in both cookie passes
(**measured**, from the replay report):

```text
  quirk.reply-chain.never-settles.image-download  [non-secure pass]
  - approved by  AAP 0.7, under rule R-b
  - marker from  corpus
  - verified     yes - the change was checked field by field against what was approved
    the change, field by field:
      outcome: "timed-out" -> "answered"
```

The result record states the reason in the tool's own words — *"the scenario's declared baseline
expectation is no longer met, which is what the deviation changed: step 0 expected `timedOut=true` and
observed `timedOut=false`"* — with `failing: false` and `status: approved-deviation`. An earlier
version of this paragraph said what exists is an annotation and not a measurement; that was true of
the artifact as it then stood and is no longer true, and the four header-resolved chains in the same
run compared as **matches**, so the deviation is bounded to the branch it was approved for.

When a capture is driven, the mechanism that turns the annotation into evidence is the finite per-step
budget in [§2.4](#24-every-case-has-a-finite-timeout-and-an-expected-timeout-is-a-result), which lets a
hang be **recorded** instead of ending the run: the baseline step records the timeout, the replay
records the 200 stream response, and the diff reports an **approved change** rather than a failure.
Two properties of that path are already delivered and inspectable, which is why the deviation control
is not vacuous — the marker exists and is unique, and because a capture **drops** it, it must be joined
back on with `--annotations` or the difference **fails**.

So the deviation is, today, **argued, approved and marked — not evidenced**. The delivered code was
read to confirm it does what the decision says (`[T lib/controllers/files.js:171-173]`), and that is a
one-tree reading, not a comparison. It is carried into [§8](#8-what-remains-unproven) with the rest of
the corpus.

Two guards belong with it. The **four header-resolved chains** carry no marker and are expected to be
**identical** — they must not become collateral damage of this decision. And
`error-edge.asset-from-url.transport-refused` is **also** an expected timeout but is **not** a
deviation: that route is left unsettled in the delivered tree too, so its timeout is preserved
behaviour and a 200 there would be a failure.

### 7.2 Deviation 2 — the `marked` fork is retained

The private `marked` fork carries a **high** ReDoS advisory and cannot be bumped. It is **retained**, so
the migration delivers zero critical and exactly **one high** finding rather than the zero/zero the
request's audit gate states.

The precedence argument, in one paragraph: **R-d and the PRESERVE directive on client-visible page
behaviour are prohibitions, while the zero-critical/high audit result is a validation target. When a
prohibition and a target collide, the prohibition controls.** The justification for that ordering is a
comparison of what each failure costs. Violating the prohibition means authored course content
rendering differently for every user — silently, with no error and no signal — because upstream
`marked` 4 was tested against this repository's own configuration and its output differs in **heading
`id` attributes**, **task-list `<input disabled type="checkbox">` markup**, **`javascript:` links
reduced to bare text** and **mixed nested-list structure**, in addition to emitting a deprecation
notice on **every parse**. Missing the target means a documented, bounded risk that a reader can
locate, size and act on. A migration whose stated purpose is to change the runtime without changing
behaviour cannot rationally choose the first.

**The full reasoning, the exposure and the named follow-up are owned by
`docs/deferred-dependencies.md` §4.2 and are not duplicated here.**

**How it is evidenced.** By the audit record rather than by the corpus: `docs/deferred-dependencies.md`
§5 carries the measured figures — baseline **15 critical / 28 high / 16 moderate / 59 total** against
delivered **0 critical / 1 high / 6 moderate / 7 total** — with the single high **named** as `marked`
and attributed, and every remaining moderate attributed to a named package with its risk note. §6 of
that document states plainly that the request's stated gate was zero critical and zero high and that
**this delivery does not meet it**; the gate is not redefined and no exception is granted to the
delivery by the delivery. **Any *additional* critical or high finding is a failure**, not a deviation:
the tolerance is exactly one, attributed to exactly one package, and nothing else inherits it.

### 7.3 Why the two resolve in opposite directions

Read as a pair without their reasoning they look inconsistent — R-d loses once and wins once. They are
not, and the distinguishing fact is what is being protected in each case:

> **An absent response is not a behaviour a client can rely on. Rendered output is.**

R-d's protection exists for clients that may depend on observable behaviour. A request that never
settles produces no observable behaviour to depend on, so preserving it protects nobody while violating
R-b's unqualified requirement that routes serve. Authored course content rendering identically for
every reader is the opposite: it is observable, it is depended upon, and it is exactly what the
PRESERVE clause on client-visible page behaviour names. The asymmetry is a consequence of applying one
principle consistently, not of applying two.

### 7.4 A third shortfall that was closed rather than carried

An interim delivery recorded a third shortfall here: one residual deprecation warning, from a
transitive dependency of retained `archiver`, against a stated zero-warning gate. It was correctly
**not** presented as an approved deviation, because nothing had been argued or approved about it — it
was an unresolved shortfall with a named remedy and no decision recorded against it.

**The remedy was taken and the shortfall is closed.** `archiver` moved 2.1.1 → 6.0.2 and the warning
has no source left; [§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)
carries the measurement, and the same investigation found the same dependency writing archives the
application could not read. The zero-warning gate now measures **0** warnings across boot, all 233
routes under two identities, and the standalone worker.

So the set of deviations is exactly the two in [§7.2](#72-deviation-2--the-marked-fork-is-retained)
and [§7.1](#71-deviation-1--the-never-settling-file-response). The `archiver` move is **not** a third
deviation from the request: a runtime warning and a demonstrated incompatibility are two of the four
reasons the triage rule already permits a dependency to change. It **is** a divergence from the
Agent Action Plan's own instruction to retain `archiver` 2, and it is recorded as such — with its
precedence argument, and with the measurement showing that no narrower fix exists — in
[`deferred-dependencies.md` §2.6](deferred-dependencies.md).

---

## 8. What remains unproven

Recording this honestly is part of the deliverable. Everything the migration *decided* is decided;
what follows is **unproven rather than undecided**, and each row names the gate that settles it.

Items that stood in this table in the earlier record have been **closed by measurement in this
delivery** and now live in the register instead: the storage and archive contract (35 of 35 cases),
the joi comparison on both sides (0 differences across 462 outcomes), the audit figure (re-run rather
than cited, 0 critical / 1 high / 6 moderate), the clean-tree asset build together with the root
container image and the stylesheets served from it, the `bull` 4 and `mime` 4 runtime semantics
(109 of 109 worker checks in the artifact over 7 real jobs), and the corpus's **baseline** half (383 of 383 recorded).
They are named here, and the rows that closed are marked in place, so a reader comparing the two
versions of this table can see that the rows left rather than being quietly dropped.

| Open item | Why it is unproven | Gate that settles it |
|---|---|---|
| **The request corpus replay** — identical normalized responses across the 233-route inventory | The **baseline is captured**: 383 of 383 scenarios carry a recorded response, `summary.captured` is `true`, 233 of 233 routes are represented. What is unproven is the **comparison**, because the committed artifact's provenance names a generator this repository cannot retrieve, so `replay.js` refuses it ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). The pair itself is proven on a re-captured 8-scenario segment: both cookie passes, 0 differences, and the approved deviation verified field by field | A re-capture through the delivered `capture.js --app <worktree at 2f8712a> --expect-baseline`, in coherent segments around the measured crash, then `replay.js --annotations` — both cookie passes, `gateQualifying: true` |
| **The existing suite** | **Measured 234 passing / 0 failing, exit 0**, with registered = executed = passing = 234 asserted by the run itself and negative-tested in both directions. 234 = 124 baseline bodies, all active, plus the 6 new page cases, plus 104 added by two conversion-driven sections — 21 legacy-URL cases, 59 `email-compat` and 24 `diff-compat` — and it reconciles per file as 75 + 21 + 59 + 24 + 66. 130 = the 124 `it()` bodies present at `2f8712a` — 123 active plus the disabled download case, now active and passing with its assertions byte-identical — plus the 6 new page-surface cases. Eighteen cases carry a changed expectation — 29 baseline assertion lines replaced by 33 — each under a recorded exception ([§6.2.1](#621-the-baseline-correction-exception-register)) | Met |
| **The private-field cookie patch on hapi 21** | It mutates a private field and its failure mode is **silence** ([§4.3](#43-why-the-cookie-expires-assertion-exists)). The 233-route sweep did not assert cookie attributes | The cookie-attribute comparison in **both** overlay passes, including the presence and whole-day horizon of `Expires` |
| **The secure cookie pass** | A secure-pass baseline **was** captured — `test/parity/corpus.secure.json`, sidecar role `baseline-response-corpus`, `cookiePass: secure`, 382 of 383 scenarios recorded against `2f8712a`. Two things keep it from closing the pass: it carries the same provenance precondition as its non-secure sibling ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)), and its one unrecorded scenario is `auth.outcome.lookup-error`, still carrying the `unreachableReason` that [§3.4](#34-the-unreachable-list-with-reasons) records as wrong — so a secure gate run would fail that outcome rather than skip it, which is the check working. Until it is passed with `--secure-corpus`, the secure pass asserts a **derived differential** rather than comparing a measurement ([§2.6](#26-the-server-overlay-and-why-one-was-needed)) | A secure-pass re-capture through the delivered generator, driving that scenario as the non-secure corpus already does, then `--secure-corpus <path>` |
| **`joi` 18.2.5 parity across the 102 targets — closed** | Both sides are now measured. The baseline is the sealed capture at 17.13.3 ([§6.6](#66-native-hapi-validation-is-unreachable-here)) and `npm run verify:joi` exits **0** against it on the delivered tree: 102 targets, 306 cases, 462 outcomes, 15 678 fields, **0 differences**, and `gate PASSED` on its own warning, proof-mismatch, unmatched-rule and teardown conditions | Met |
| **`bull` 4 and `mime` 4 runtime semantics — closed** | Neither rests on an API-surface check any more. `npm run verify:worker` exits **0** with `VERDICT PASS` over **109 of 109** checks, driving **7** real jobs through Bull 4.16.5 — processor promise completion, `job.id` in the `failed` handler, `job.remove()` on `completed`, retry and stalled behaviour, and status, progress and error persistence — with 0 warning notices. The `mime` 4 call sites are asserted by the suite's 13 explicit mapping cases and its mismatched-metadata classifier outcomes | Met |
| **`adm-zip` 0.6 archive-read semantics** | **Now proven for the write-then-read path**: with `archiver` at 6.0.2 ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)) every entry declares a correct crc32 and length and `getData()` round-trips byte-exactly, measured on a five-entry fixture at both compression levels and end to end through `POST /api/trinkets/download`. What remains unproven is reading **pre-migration** objects, which is the row below | `test/parity/storage.js` against pre-migration objects |
| **Storage parity of seeded content — partially closed** | The storage gate now runs, and its `pre-migration-lookup`, `pre-migration-digest-drift` and `pre-migration-rekey-orphans` cases pass against seeded pre-migration records, so the sha1-key contract is asserted rather than assumed. What is still open is breadth rather than existence: the seeded corpus is representative, not exhaustive, and the failure mode remains invisible on freshly written data because a write-then-read round trip passes under any digest | `test/parity/storage.js` against **pre-migration** objects, asserting the exact sha1 key |
| **The four internal callback modules** | Excluded from conversion on the **warning** test alone; the request's second test — the existing suite passing unmodified — cannot be evidenced until the suite is green ([§6.9](#69-whether-node-core-callback-conversions-should-be-filtered-by-warning-emission)) | The repaired suite passing with those four modules unmodified. Any module the suite implicates is converted, and the diff records which test forced it |
| **The audit figure — closed** | Re-measured on the delivered tree rather than cited: `npm audit --omit=dev --json` reports **0 critical, 1 high, 6 moderate**, the high being direct `marked` (the approved deviation) and the six moderates `aws-sdk`, `bull`, `highlight.js`, `jszip`, `mongoose` and transitive `uuid`. That is AAP §0.9.5's stated figure exactly, and it identifies `mongoose` as the sixth moderate the earlier record could not account for | Met |

Two things are worth saying about the shape of this table rather than its rows.

**The first row dominates the rest.** Most of the PRESERVE clauses in
[§5.1](#51-each-preserve-clause-bound-to-the-gate-that-proves-it) bind to the corpus, so closing it
converts a majority of this table at once. The tooling, the definitions, the fixtures, the seeds, the
overlay, the coverage accounting **and now the recorded baseline** are all delivered and inspectable;
what is missing is a re-capture through the delivered generator and the replay that follows it, and
the exact command is in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) together with the operational constraints that a first
attempt will otherwise rediscover. The distance from here to that gate is one capture, not one
measurement campaign.

**What *is* proven is proven properly.** The primary parity gate — the HTTP surface, per entry, across
all 233 routes, against an independently installed baseline worktree — passes by measurement, not by
inference, and so does the route-table CLI check across all three of its invocation forms, and so does
the target-side joi comparison on the question it exists to answer. Those three rest on a **comparison
of two trees**. The storage contract, the root image and its served stylesheets, the clean-tree asset
build and the audit figure rest on a **measurement of one** — they are real results and they are not
parity results, and this table is where that distinction is kept rather than blurred.

---

## 9. Cross-references

This document owns the **method** and the **resolution log**. It deliberately does not restate what
these own, because a second copy of a fact is a second thing to keep in step:

| Document | Owns |
|---|---|
| `docs/preserved-quirks.md` | Every preserved 2013-era quirk, its measured outcome and its target disposition — and the canonical statement of both approved deviations |
| `docs/error-edge-inventory.md` | One row per changed error edge: source location, current disposition, and target status, payload, side effects and timing |
| `docs/dependency-inventory.md` | Every replaced or major-bumped package, as original → target → reason, with its final resolved version |
| `docs/deferred-dependencies.md` | The deferred-but-functional packages with per-package reasoning, the audit result, and the full argument for deviation 2 |
| `test/parity/corpus.json` | The machine-readable scenarios, their recorded baseline responses, their coverage table and their own notes |
| `test/parity/joi-baseline.json` | The captured baseline validation outcomes for all 102 targets, and the tree they were measured on. What the delivered file holds is stated in [§1.4](#14-tool-provenance-per-artifact) and is not that: it carries no `provenance` block, so `joi-matrix --compare` refuses it |
| `test/parity/replay.js` | The executable comparison contract — the volatile set, the comparators and the coverage gate |

Machine-readable artifacts are **referenced, not restated**: `corpus.json` and `joi-baseline.json` are
the record, and this file is its human-readable companion. Read a corpus together with its own
`provenance` block — a corpus that carries none does not say which tree it measured and is not parity
evidence, which is why `replay` refuses one rather than comparing against it.

**Applied to what is actually committed, that rule now admits both artifacts, and one of them with a
stated precondition.** `joi-baseline.json` has its sealed sidecar and is a captured measurement.
`corpus.json` has a sidecar too, and 383 of its 383 scenarios carry a recorded response, so it is a
**measurement** rather than a definition set — every reference to it in this file is worded that way.
What it does not have is the embedded block the delivered `replay.js` requires, because it was written
by the capture tool as that tool stood at the base commit; so the artifact is evidence about
`2f8712a`, and `verify:corpus` still refuses it until it is re-captured through the delivered
generator ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). An earlier version of this paragraph said the corpus had no sidecar
and no captured response. It has both, and the correction is recorded rather than quietly applied,
because the earlier wording is what the rest of this document was written against.

One note, recorded rather than acted on: `mkdocs.yml`'s `nav:` lists only `index.md`, `setup.md` and
`overview.md`, so this document is not part of the rendered documentation site. Changing that
navigation is outside the scope of this work and **`mkdocs.yml` is not modified**.
