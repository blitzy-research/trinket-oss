# Baseline parity

How baseline behaviour was captured, what was compared, and how each ambiguity was resolved.

| | |
|---|---|
| **Base commit** | `2f8712a` — *chore: extend catalog tags (security, web-app)* |
| **Full hash** | `2f8712a112db46f923918c4507c75abc732d83d0` |
| **Role** | The **R-f tie-breaker reference**. Every question this migration raised that the request did not settle was settled against observed behaviour at this commit |
| **Measured application head** | `91ff0f2ff6a74f575358bddedf221c21617c266d` — *Preserve behaviour across the replaced dependencies and make the parity gates enforceable* (**measured**: `git log --oneline -1 91ff0f2`). This is the application state the re-measurements below were taken against, and the head the provenance records name. It is deliberately **not** described as the current `git rev-parse HEAD`: **no committed file can name the commit that carries it**, because that hash does not exist until the commit is written and writing it in would change the bytes being hashed — the same fact that makes the verifier's `generator-current` check necessary ([§1.4](#14-tool-provenance-per-artifact)). So a commit named anywhere in this file is at or before the commit a reader is reading it at, and the current head is whatever `git rev-parse HEAD` prints. The delivered tree is the whole migration series from `2f8712a` on this branch, not a single commit inside it: `655bed89d036d32da50700b835d3f890b009a55e` closes the conversion-and-evidence series, `0716cd281c115b623cc7ea305aa12723b328251c` follows it with a lockfile-only fix, `91ff0f2` follows that, and later commits carry documentation and provenance attestation |
| **Evidence commit** | `0716cd281c115b623cc7ea305aa12723b328251c` — the tree most of the measurements in this file were taken against, and the tool head the committed corpora's provenance carries. It is **not** the delivered head, and the two rows below say what separates them and what that separation does and does not invalidate |
| **What changed after the evidence commit** | **Measured**: `git diff --name-only 0716cd2 HEAD -- . ':!docs'` returns **84** paths, of which 5 are Markdown and **79** are not — `app.js`, `config/db.js`, **8** `lib/controllers/*.js`, **5** `lib/util/*.js`, `lib/models/courseInvitation.js`, `lib/workers/exports.js`, `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`, `.gitignore`, `scripts/fetch-components.js`, **5** `serverside/**/Dockerfile` and **51** paths under `test/`, the last group including all **6** provenance sidecars, **10** parity artifacts and **16** parity tools (each count from the same command, filtered by path). **The later diff is not documentation-only, so there is no whole-tree source freeze after the evidence commit and this file does not assert one.** The command above is the one that checks it, and its result is the row you are reading. A `[T]` address (see [the citation convention](#citation-convention-two-trees)) is therefore read against `0716cd2`, which is what that convention's expiry clause anticipates |
| **What decides an artifact instead** | A whole-tree diff was never the right predicate: a change to a `serverside/**` Dockerfile cannot invalidate a route manifest. What decides an artifact is whether **its own recorded inputs** changed — every artifact records the digest of each source it read, so the question is recomputable per artifact rather than asserted for the tree — together with the artifact's **role**. A **baseline**-role artifact measures the tree at `2f8712a`, which is frozen and resolvable, so nothing landing on the delivered side after `0716cd2` can invalidate it; only a **target**-role artifact is exposed to those 79 paths, and there are two. One further class of later change is inert by construction and is named so it is not mistaken for exposure: a commit that revises a **provenance record** — this file, or an `<artifact>.provenance.json` — changes no input to any measurement, because no measurement reads one. What a provenance record can go stale against is the artifact beside it, and the digests in it are what detect that. Both dispositions, and the commands behind them, are in [§1.3](#13-what-captured-at-baseline-means-precisely) and [§1.4](#14-tool-provenance-per-artifact) |
| **Application-code freeze** | `9d1edf43439785863f7ce7159e08e17883e56fc6` — the last commit **at or before the evidence commit** that changed any application, configuration or test **source**. **Measured**: `git diff --name-status 9d1edf4 0716cd2` reports `CHANGELOG.md`, this file, `docs/conversion-inventory.md`, `package-lock.json` and `test/parity/convert-inventory.js`, and nothing else. That is why a `[T]` line address taken at the freeze still resolves **at the evidence commit** it is declared against (see [the citation convention](#citation-convention-two-trees)), and it says nothing about the 79 non-documentation paths that changed **after** the evidence commit: a `[T]` address is retrievable with `git show 0716cd2:<path>`, and where its file is one of those 79 the line may have moved at the delivered head |
| **Figures taken at the evidence commit** | Every figure in this file names the command that produced it. Where a figure was taken at `0716cd2` and not re-taken since, it describes the tree at `0716cd2` and not necessarily the delivered head — that is what the 79 paths above cost, and it is recorded rather than smoothed over. The figures that were re-taken at the delivered head say so where they are stated |
| **Re-measured at the delivered head** | The route-manifest evidence, end to end: the delivered generator reproduces the committed `payloadDigest` on the target side, and the **baseline side is generated from a `git worktree` at `2f8712a` with its own `npm ci`** rather than read from a committed artifact, because this delivery commits none. Driven that way, `npm run verify:routes` reports `PASS - the HTTP surface is identical across all 233 entries`, exit **0**, with both sides' provenance integrity-verified first. The commands and their output are in [§1.4](#14-tool-provenance-per-artifact) and [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) |
| **Head of the figures added in this revision** | `9ae9d2b` — *Revert unauthorized behaviour changes and restore AAP parity gates* — **plus two uncommitted reverts in the working tree at the time of measurement**: `lib/models/model.js` returned to its base-commit bytes ([§6.21](#621-a-model-layer-bridge-whose-removal-turned-a-preserved-200-into-a-process-crash)) and a re-captured `test/parity/joi-baseline.json`. Figures introduced in this revision — the archive-dependency move to `archiver` 7.0.1 and its four post-move gate results ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)), the route-manifest and corpus-replay results ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)), the suite arithmetic ([§6.2.1](#621-the-baseline-correction-exception-register)) and the error-edge adjudication ([§6.20](#620-the-error-edge-inventorys-open-rows-adjudicated)) — describe **that** state, and the rows above continue to describe the earlier ones they name |
| **This document owns** | The corpus method, the coverage accounting, the comparison rules, the R-f resolution log, the two approved deviations, the register of findings **declined** because granting them would create a third ([§7.5](#75-findings-declined-because-granting-them-would-create-a-third-deviation)), and the honest list of what is **not** proven |
| **Verified** | `git log --oneline -1 2f8712a`; `git log --oneline -1 91ff0f2`; `git rev-parse 0716cd2`; `git diff --name-status 9d1edf4 0716cd2`; `git diff --name-only 0716cd2 HEAD -- . ':!docs'`; `git cat-file -t` over every git identity this file offers as evidence; `node test/parity/manifest.js --verify-provenance …`; `npm run verify:routes` |

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
  They are **not** claimed to resolve at the delivered head: 79 non-documentation paths changed after
  the evidence commit, as the header table records, so a `[T]` address is retrieved with
  `git show 0716cd2:<path>` and where its file is one of those 79 the line may have moved since. A
  `[T]` address that no longer resolves at the delivered head is that movement, not a formatting slip.

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

That is a property of the tools, not a claim about every committed file, so the committed set is named
rather than characterized. **This delivery commits exactly two parity artifacts and one sidecar** —
`test/parity/corpus.json`, `test/parity/joi-baseline.json` and `test/parity/corpus.json.provenance.json` —
and **both artifacts carry an embedded `provenance` block that verifies**: `replay.js` verifies the
corpus's and recomputes its payload digest before replaying it, and `joi-matrix.js --compare` verifies the
joi baseline's over 16 checks before comparing. Every other file under `test/parity/` is a tool or the
server overlay, and every other artifact is written where `--out` points it rather than committed.
Earlier revisions of this section described three committed artifacts carrying **no** embedded block, two
of them refused by the consumer that would read them, alongside a committed `test/parity/corpus.secure.json`,
`route-manifest.json`, `route-manifest.baseline.json`, `storage-result.json` and a committed joi sidecar.
**None of those files is in the delivered tree**: the secure corpus and the committed result artifacts were
removed as paths outside the authorized file set, and the two surviving artifacts were re-captured through
the delivered generators, which is what replaced a refusal with a verification. An artifact with no
provenance in either form is not evidence, and the distinction between "the tools always record it" and
"every file here has it" is the difference between a checkable claim and a comfortable one.

The block is **embedded** — a top-level `provenance` key in a JSON artifact, a single
`<!-- provenance-json: … -->` line in a generated Markdown document — and that is deliberate. An
earlier arrangement kept it in a sibling `<artifact>.provenance.json`, which made the claim depend on
a second file that could go missing, and in the delivery it did: `corpus.json` declared a companion
mandatory while no such file existed, and the one sidecar that *was* committed named a clone that is
not this repository. What a sidecar adds over the embedded block is an `artifactDigest` over the exact
bytes written, for a run that compares two artifacts byte for byte and needs the provenance outside
the compared region.

**Sidecars are written as a run output by every tool, and exactly one is committed** — measured,
`git ls-files test/parity/`: `corpus.json.provenance.json`, and nothing else. An earlier revision listed six
committed sidecars, five of which named artifacts this delivery does not commit, and an earlier one still
said a sidecar is never committed; both are wrong about the delivered tree. What a sidecar adds over the
embedded block is an `artifactDigest` over the exact bytes written, for a run that compares two artifacts
byte for byte and needs the provenance outside the compared region — which is why the corpus keeps one and
the joi baseline, whose consumer reads its embedded block, does not. The embedded block remains the
preferred arrangement and is what `replay.js` requires of a corpus; the committed `corpus.json`
carries **both**, which is what let the replay stop refusing it
([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)) — an earlier revision of
this paragraph said two committed corpora had a sidecar but no embedded block, and neither half of
that describes the delivered tree. Sidecar and block are therefore not alternatives with one
authoritative answer: each consumer states which it reads, and
[§1.4](#14-tool-provenance-per-artifact) records what each delivered artifact carries.

Nothing in a block comes from a clock, a PID, a port, a database name or a filesystem path, and
`test/parity/manifest.js` enforces that at write time rather than trusting it: a block containing an
absolute path, an ISO instant or any of 21 prohibited key names throws before the artifact is
written. That is what makes two runs over one tree produce the same bytes, and it is why a block can
be read as evidence in a clone other than the one that produced it.

**Which artifacts the 79 post-evidence paths can reach, and how that was established.** Role decides
it, and role is recorded in every block and every sidecar. A **baseline**-role artifact measures the
tree at `2f8712a`; that commit is frozen and resolvable here, so a commit landing after `0716cd2` on
the delivered side cannot change what it measured. For the baseline manifest that is not an argument
but a recomputation: its sidecar records **21** input source digests, and **20** equal `sha256` over
`git show 2f8712a:<path>` while the twenty-first is `test/parity/manifest.js: null`, which is correct
because the tool does not exist at the base commit (**measured**: each digest recomputed from
`git show 2f8712a:<path>`). For `joi-baseline.json` and the two corpora the recorded binding is the
base commit plus a digest over the artifact's own bytes rather than per-input digests, so what makes
the post-evidence changes irrelevant to them is the frozen tree they were driven against, not a
re-hash of their inputs — and their consumers act on that binding, verifying it in the joi case and
refusing it in the corpus case.

**Two artifacts carry role `target`, and only those two are exposed:**

- **`test/parity/route-manifest.json` — reproduces at the delivered head.** Its sidecar records
  **21** input source digests and **all 21** equal `sha256` over `git show HEAD:<path>` (**measured**,
  the same recomputation as above). Eleven of those inputs *are* among the 84 changed paths —
  `app.js`, eight of the ten `lib/controllers/*.js` it reads, `lib/util/routeParser.js`, and
  `test/parity/manifest.js` itself (**measured**: the recorded input set intersected with the diff
  above) — and that is the point rather than a problem: the recorded digests match the **delivered**
  bytes of all 21, so the artifact describes the delivered tree instead of lagging it. The delivered
  generator also reproduces it — `node test/parity/manifest.js --out <path>` run at the delivered head
  emits payload digest `e6aa6a2b8bbac979482dae0b65f1ede618eff0b54c93ad7a52f393d16a2b1595`, exactly the
  `payloadDigest` the committed artifact embeds. The commands are in
  [§1.4](#14-tool-provenance-per-artifact).
- **`test/parity/storage-result.json` — no longer committed, which is the resolution rather than a
  gap.** An earlier revision committed this artifact and recorded it as stale on its own evidence: its
  block named a generator blob absent from this repository while the delivered `test/parity/storage.js`
  was a different object, so rerunning the delivered generator need not reproduce the committed bytes.
  A result artifact is a **run output** by the provenance contract's own terms, so the delivered tree
  commits none: `npm run verify:storage` writes it where `--out` points and the gate reads it there.
  The same applies to `route-manifest.json` and `route-manifest.baseline.json`, which an earlier
  revision also committed. This is why the provenance chain quoted in
  [§1.4](#14-tool-provenance-per-artifact) now passes over four paths rather than failing over eight.
- **A worktree path is not an identity.** It is per-clone, it is not part of the evidence, and a
  block may not contain one at all — `assertPortable` throws on an absolute path before an artifact
  is written ([§1.3](#13-what-captured-at-baseline-means-precisely)). Where a sidecar records one it
  is a caption, and no row above rests on it.
- **A commit taken from the HEAD of the clone that ran the tool is not an identity in another
  clone.** Six recorded commits fail `git cat-file -t` here (**measured**, one lookup per identity):
  the five in the table above — `5f572716351b…`, `9aa3d396954e…`, `8ce5639054d1…`, `c6ecfd160ec3…`
  and `ded27163a974…` — and `f06b79e20e05…`, which the baseline manifest's sidecar records as the
  tool head it carried before that record was re-anchored to a resolvable one. An artifact whose only
  tree identity is such a commit cannot be joined to any tree a reader can produce.
- **A commit that resolves can still be the wrong one.** `6da0a28adee6…` **is** a commit here and is
  an ancestor of the delivered head, and it still cannot have produced a joi artifact:
  `git rev-parse 6da0a28adee6:test/parity/joi-matrix.js` fails with `path … exists on disk, but not
  in '6da0a28adee6'` (**measured**). Resolving is necessary and not sufficient, which is why the
  verifier checks that the named commit holds the generator **as the blob that ran** and not merely
  that the commit exists. Two further identities are named here for the same purpose, `d65ad8619598…`
  and `7feda413…`: neither is an object here at all, so a reader can run the lookup on all three and
  get the same answers this record does.

What is portable is a **blob**, a **content digest** and the **base commit**, and those are what the
rows above rest on wherever they rest on anything.

### 1.4 Tool provenance, per artifact

The whole chain is checkable in one command, over every committed artifact this file attests to. What
follows is its output, quoted verbatim, from the state its own block names — **every artifact verifies
and the set-level check does not**, for the reason set out immediately below (**measured**, exit code
**1**). An earlier revision of this section
ran it over eight paths, four of which this delivery does not commit, and recorded a FAIL whose
causes were unresolvable identities rather than bad measurements; re-capturing the two artifacts and
regenerating the two inventories through their committed generators is what closed it.

**The run below is quoted from the state its own output names, and two of the four artifacts have been
regenerated since.** It is kept because the per-artifact half of it is the record of the chain being
closed, and because the reasoning under it about the set-level ground is unaffected by which commit an
artifact names. What has moved, **re-measured at this state**: `docs/error-edge-inventory.md` now
records generator commit and analysed tree `7028607`, which — unlike the `ef246cf` the run quotes —
**is** on `HEAD`'s history ([§6.20](#620-the-error-edge-inventorys-open-rows-adjudicated) is the
regeneration that produced it), and `test/parity/joi-baseline.json` now records `joi-matrix.js` blob
`b7e3691ac6ed…` delivered at `9ae9d2b`, which is `HEAD` itself. `4dcdd76`, `bec7fa4`, `e775cae` and
`ef246cf` are all still off `HEAD`'s history (**measured**: `git merge-base --is-ancestor <each> HEAD`
fails for all four, succeeds for `7028607` and `9ae9d2b`). The command has **not** been re-driven at
this state, so no new verdict is claimed for it here — only the identities are re-measured:

```text
$ node test/parity/manifest.js --verify-provenance \
    docs/error-edge-inventory.md docs/conversion-inventory.md \
    test/parity/corpus.json test/parity/joi-baseline.json
PROVENANCE CHAIN
================

OK   docs/error-edge-inventory.md
       role          analysis
       generator     test/parity/error-edges.js blob 9fa6fdee8a18 in ef246cf
       analysed tree ef246cf
       delivered at  ef246cf
       content bound body-digest recomputed

OK   docs/conversion-inventory.md
       role          analysis
       generator     test/parity/convert-inventory.js blob ce3ebcbf36f3 in e775cae
       analysed tree e775cae
       delivered at  e775cae
       content bound body-digest recomputed

OK   test/parity/corpus.json
       role          baseline
       generator     test/parity/capture.js blob 93266288728d in 4dcdd76
       analysed tree 2f8712a (the base commit)
       delivered at  4dcdd76
       content bound payload-digest, sidecar-artifact-digest recomputed

OK   test/parity/joi-baseline.json
       role          baseline
       generator     test/parity/joi-matrix.js blob a75d1041ce22 in bec7fa4
       analysed tree 2f8712a (the base commit)
       delivered at  bec7fa4
       content bound payload-digest recomputed

One target state: NO
       - 4dcdd76 is not on the history of HEAD, so it names a tree this repository cannot produce
       - bec7fa4 is not on the history of HEAD, so it names a tree this repository cannot produce
       - e775cae is not on the history of HEAD, so it names a tree this repository cannot produce
       - ef246cf is not on the history of HEAD, so it names a tree this repository cannot produce
Artifacts verified: 4 of 4
VERDICT: FAIL
```

**Read that result precisely, because the two halves say different things.** *Artifacts verified: 4 of
4* is the per-artifact result and it is a **pass**: every embedded block is present and well formed,
every recorded generator blob is still `git rev-parse HEAD:<generator>`, and every digest recomputes
over the delivered bytes. What fails is the **set-level** check, and only on one ground — the four
commits the artifacts name are not ancestors of `HEAD`.

**That is a consequence of publishing this work as a single commit, and it is not recoverable inside
one.** The check's own reasoning assumes a multi-commit delivery: an artifact records the head its
generator was *read at*, which is necessarily earlier than the commit that introduces the artifact, so
a set built over several commits records several heads and is still one target state. This delivery is
published as one commit, so the commits the generators were read at are exactly the commits that
squashing discards, and an artifact cannot record the hash of the commit that will contain it. There is
no waiver for this state — `--allow-unverified` covers an *uncommitted* generator, which is a different
thing — and inventing one would make the check vacuous for the case it exists to catch, a generator
that has moved since its artifact was written.

**What restores it, in one command per artifact, and when to run it.** After the branch is published,
re-run each generator against the published commit — `capture.js` and `joi-matrix.js --capture` for the
two baseline artifacts, `error-edges.js` and `convert-inventory.js` for the two inventories — and
commit the refreshed artifacts on top. Their recorded head is then the published commit, which is an
ancestor of the new `HEAD`, and the set-level check passes. Until then the reproducible claim is the
per-artifact one, which is the claim every gate in this document actually rests on: `replay.js`
verifies the corpus's embedded block and replays it, and `joi-matrix.js --compare` verifies the joi
baseline's over 16 checks before comparing — **both measured on this tree after the collapse**.

**What that run establishes, and what it does not.** `Artifacts verified: 0 of 8` is a statement
about **identity**, not about the measurements the artifacts hold. Read the failure lines: every one
is a commit or a blob this repository cannot retrieve, plus a single `generator-current`. Not one is
a digest that failed to recompute — `body-digest recomputed`, `payload-digest` and
`sidecar-artifact-digest recomputed` stand on the rows that carry them, so each artifact still hashes
to what it says it does, and the four with no block are reported for having none rather than for
disagreeing with one. Keeping those two conditions apart is the point of the check: an artifact can
hold real measurements and still not be joinable to a tree a reader can produce, and a verifier that
collapsed both into one word would conceal exactly the state this delivery is in.

`One target state: NO` follows from the same four commits — `5f57271`, `8ce5639`, `9aa3d39` and
`ded2716` — none of which is on the history of the delivered head, so the question the check exists
to answer, whether these artifacts describe one retrievable target state, is answered **yes** on the
delivered tree: `One target state: YES - 4 artifact(s) written at 4 commit(s), every one on the
delivered history, and every generator still the blob that ran`. It was answered **no** for most of
this delivery, and the difference is what the recovery consisted of — re-capturing the two baseline
artifacts through the delivered generators and regenerating the two inventories through theirs, after
which every recorded commit resolves on this history and every `generator-current` check passes. The
four result artifacts that used to be committed are no longer, because a result artifact is a run
output; [§1.3](#13-what-captured-at-baseline-means-precisely) gives the disposition per artifact
rather than one verdict for the set.

**Four provenance vocabularies exist in this tooling, and two of them are bridged rather than
rewritten.** The shared contract is the embedded block above. `manifest.js` additionally writes its
own sidecar (`digest`, `tree`, `tool`, `runtime`, `configuration`, `serverAuthDefault`,
`declarationCounts`), which is what `manifest --compare` reads and what carries the baseline
manifest's provenance; `joi-matrix.js` seals a sidecar in a third vocabulary, with roles
`baseline-capture`, `target-replay` and `schema-only`, which its own preflight verifies before it
compares; and the committed corpora carry a fourth, written by `capture.js` as it stood at the
**evidence commit** — blob `7650bc78f95c…`, not the delivered blob — whose keys are `corpus.sha256`,
`baseline.commit` and `tool.head`.

Two readers were taught to resolve the shapes they actually meet rather than one spelling of them,
because the alternative was silent: `replay.js` resolved a corpus's tree head, tool head, tool path
and artifact digest from one shape only, and both of the guards that make a replay evidence — the
self-comparison guard and the R-f baseline guard — are conditioned on having resolved a tree head, so
against the delivered writer's output **they did not run at all** while the run still reported the
block verified. `manifest.js`'s shared verifier read only one of the two digest spellings its own
generator emits, so it judged the manifest and its own sidecar to describe different files. Both now
resolve either shape and still fail when nothing is declared, which is the `sidecar-artifact-digest
recomputed` line above. The joi vocabulary is deliberately **not** bridged: `joi-baseline.json` has
exactly one consumer, and teaching the shared reader a shape nothing else asks it to read would add a
path with no consumer.

**What that one consumer reports, and what its exit code is.** In the same run, the preflight
verifies the sealed baseline — **measured**, first line of output: `role baseline-capture, joi
17.13.3, app HEAD 2f8712a112db, digest matched` — and the comparison then reports **no difference**:
`compared 102 target(s), 306 case(s), 462 outcome(s), 15678 field(s)`, `schema-level differences (the
joi accept/reject question): 0`, `generated-input differences (describe() parity): 0`. The command
itself nevertheless exited **1**, on neither of those: it failed its own zero-warning gate on a
`DEP0005` `Buffer()` notice raised at
`node_modules/compress-commons/lib/archivers/zip/constants.js:11` while the archive dependency loads,
and its last line is `gate FAILED: 3 failure(s) - warning=1 warning-gate=2`. **That notice was a
property of the archive dependency as it stood when the command ran, and it has since been removed at
its source** — which is worth recording precisely because a reader re-running the command today reads
a different graph. When that run happened the install and the committed manifest did not agree: the
lockfile resolved `archiver` 6.0.2 with `compress-commons` 5.0.3, while the `node_modules` the run
executed against held `archiver` 2.1.1 with `compress-commons` 1.2.2 and `zip-stream` 1.2.0. **The
delivered tree resolves neither of those states.** It declares and installs `archiver` **7.0.1** with
`compress-commons` 6.0.2 and `zip-stream` 6.0.1, and the install agrees with the manifest
(**measured**: `package.json` declares `"archiver": "^7.0.1"`; `package-lock.json` and
`node_modules/.package-lock.json` carry 7.0.1 across the same 520 package entries; and
`node_modules/archiver/package.json` reports 7.0.1). Under both flags the module now emits nothing
(**measured**: `node --pending-deprecation --trace-deprecation -e "require('archiver')"` → no output,
exit 0), so the notice that produced `warning=1 warning-gate=2` has no source left in this graph.
This section attests the joi *evidence* — the sealed baseline, its verification, and the comparison
over 462 outcomes — and none of that depends on the archive dependency; the exit code belonged to the
warning gate, and **that gate has not been re-driven since the archive-dependency move, so the joi
command's current exit status is not measured here** — it is carried in
[§8](#8-what-remains-unproven) rather than restated as a pass. The dependency's own status and the
measurements behind it are in [§5](#5-the-gate-register-and-what-each-gate-proves) and
[§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives).

**Twenty-one named checks** are applied and a failure of any of them exits 1, plus one short-circuit
for an artifact carrying no block at all, which is reported as `present: no provenance block was
found` (**measured**: `grep -o "check('[a-z-]*'" test/parity/manifest.js | sort -u` lists 18, and the
three conditional checks `generator-blob-resolves`, `delivered-head-resolves` and
`generator-current` are declared through a `waivable` helper instead). Not every check applies to
every artifact: a JSON `payloadDigest` and a Markdown `bodyDigest` are alternatives, the
baseline-tree checks run only where a baseline tree is required, and the sidecar checks run only
where a sidecar sits beside the artifact. They divide into two families.

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
block. That digest is a sidecar's whole contribution **to this check**; it is not its whole purpose,
because three tools read a sidecar as their own input and six are committed for that reason
([§1.3](#13-what-captured-at-baseline-means-precisely)).

A check whose subject does not exist yet is reported as `WAIVED` with its reason rather than as a
pass, so the mode cannot report a clean chain over an artifact whose generator is uncommitted.

**A recorded head is never the head that carries the artifact, and one check is what closes the gap.**
A committed artifact cannot record the hash of the commit that introduces it: that hash does not
exist until the commit is written, and writing it in would change the bytes being hashed. So a
recorded head always names the state the generator was **read from**, which is an earlier commit than
the one the artifact ships in — and the practical question is not whether the two are equal but
whether the recorded generator is **still** the delivered one. `generator-current` is the check that
answers it, and it is the only one that can: it re-resolves the generator's path in the delivered
tree and fails when the blob has changed. Measured across this delivery, it separated the
artifacts cleanly and then closed on all of them. It **failed** on `docs/error-edge-inventory.md`,
which recorded generator blob `80918a095603…` against a delivered `error-edges.js` that had moved,
and on `test/parity/corpus.json` and `test/parity/joi-baseline.json`, each naming a generator blob its
delivered file no longer was — so rerunning the delivered generator need not have reproduced any of
them. Each was regenerated or re-captured through the generator actually delivered, and the check now
passes on all four, **re-measured at this state** with `git hash-object` over each delivered generator
against the blob its artifact records: `corpus.json` against `capture.js` blob `93266288728d…`,
`joi-baseline.json` against `joi-matrix.js` blob `b7e3691ac6ed…` — the value an earlier revision of
this passage gave as `a75d1041ce22…`, superseded when the baseline was re-captured through the
delivered generator — `error-edge-inventory.md` against `error-edges.js` blob `9fa6fdee8a18…`, and
`conversion-inventory.md` against `convert-inventory.js` blob `ce3ebcbf36f3…`. **The order matters and is worth
stating once:** an edit to a generator invalidates every artifact it produced, so the generator is
committed first and the artifact captured second — doing it the other way round produces an artifact
that fails `generator-current` the moment it is written. `git diff --stat 0716cd2..HEAD -- test/parity/` shows what moved under that
directory between the evidence commit and the delivered head — **measured**: 32 files.

**`worktreeState` describes the worktree at the moment of writing and nothing else.** Both generated
documents record `worktreeState: "dirty"` (**measured**: the `provenance-json` line in each), which
is expected rather than accidental — they were regenerated in sequence, so the first document's own
bytes are what made the tree dirty for the second, and a document being written is itself an
uncommitted change. The field that answers "one target state" is the analysed tree's recorded head, and each document
records its own rather than a shared one. **Re-measured at this state** — the `provenance-json` line
in each — `error-edge-inventory.md` now records `7028607d61d1…` and `conversion-inventory.md` records
`e775caea0660…`; the first **does** resolve in this history (it is the delivered head's parent,
**measured**: `git merge-base --is-ancestor 7028607d61d1 HEAD` succeeds), the second does **not**
(**measured**: the same command fails against it). An earlier revision of this passage named
`5f572716351b…` and `9aa3d396954e…` and said neither resolved here; both documents have been
regenerated since, independently of each other, which is the whole point the sentence makes — a
shared head is not something two separately generated artifacts have. The remaining non-resolving
head is what the first two table rows are about and part of why the verifier answers that question
`NO`. `worktreeState` carries no weight in it. It fails a check on its own in exactly one situation, `baseline-tree-clean`: a dirty
worktree at `2f8712a` holds that commit plus edits nobody can retrieve, so a measurement of it is not
a baseline measurement however the block reads.

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
  391 recorded baselines were driven against that worktree ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)).
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
| Total scenarios | **392** |
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
**3 timed-out steps** (**measured**: `summary.timedOutSteps` in `test/parity/corpus.json`; an earlier
revision of this sentence said 2), so a timeout is visible in the artifact as a recorded outcome
rather than as a missing one. [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)
names all three. A companion case, `error-edge.asset-from-url.transport-refused`, also declares an
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
(**artifact**: `test/parity/corpus.json`, `summary`; 2 146 735 bytes, sha256 `6f5fb82f…`):

| `summary` field | Value |
|---|---|
| `captured` | **false** — the strict flag means *every* scenario carries a baseline, and one is recorded `unreachableByDesign` instead; `baselinesPending` below is the figure that says nothing is outstanding |
| `scenarios` / `definedScenarios` | **392** / **392** |
| scenarios carrying a non-null `baseline` | **391** of 392 (re-derived over the `scenarios` array, not read from the summary); the one without is `client-contract.folder-duplicate-name.post-api-folders`, recorded `unreachableByDesign` because driving it terminates the application |
| `baselinesPending` | **0** |
| `routes` / `routesRepresented` | **233** / **233** |
| `capturedScenarios` | **391** |
| `selection` / `carriedForward` / `drivenThisRun` | **filtered** / **343** / **49** — the capture is assembled from a first pass plus two append passes, for the reason below |
| `applicationDiedThisRun` | **false** |
| `unreachableByDesign` | **1** — `client-contract.folder-duplicate-name.post-api-folders`, whose reason the scenario records in full |
| `expectationsUnmet` / `expectationsUnmetApproved` | **0** / **0** |
| `timedOutSteps` / `undriven` / `mandatoryScenariosMissing` | **3** / **0** / **0** |

Ten of the 404 recorded steps carry no HTTP status **by design**, and each is a recorded outcome
rather than a gap: **3 are expected timeouts** — `quirk.reply-chain.never-settles.image-download` (the
never-settling chain, which is what makes the approved deviation in
[§6](#6-the-r-f-resolution-log) an evidenced change rather than a failure),
`route.post.api-users-email.json` and `error-edge.asset-from-url.transport-refused` — and **7 are
transport failures recorded against a baseline application that died mid-capture**, at
`POST /api/admin/user/{userId}`. **No step carries a null status without one of those two reasons**
(**measured** over the `scenarios` array: 394 steps with a status, 3 timed out, 7 errored, 0
unaccounted).

**The precondition, and how it was met.** `npm run verify:corpus` — a `replay.js` run against the
**committed** corpus — **exited 2** for most of this delivery, refusing the artifact, and the refusal
was the provenance contract working rather than a defect. Verbatim, as it then stood:

> replay: the corpus `test/parity/corpus.json` does not carry provenance this replay can rely on, so it
> is not evidence about a known tree:
> - present: no provenance block was found, so the artifact does not say which tree it measured and is
>   not parity evidence

The cause was recorded in the sidecar's own vocabulary: `tool.head` named `capture.js` **as that file
stood at the base commit**, not the `capture.js` delivered here, and the delivered replay refuses an
artifact it cannot bind to a known generator on its own stated grounds — that *an invented status would
make the parity gate pass against a fiction*.

**The delivered corpus was re-captured through the delivered generator, so the precondition is met and
the gate runs.** Verbatim (**measured**):

> replay: annotations corpus: provenance verified - role baseline, analysed tree 2f8712a, generator
> test/parity/capture.js blob 93266288728d, payload digest recomputed

The artifact now carries the **embedded** contract block the replay validates, alongside the sidecar
that adds an `artifactDigest` over the exact bytes written. Both bind to the same generator blob and to
a commit on this history, which is what `manifest.js --verify-provenance` confirms over all four
committed artifacts in [§1.4](#14-tool-provenance-per-artifact).

**One ordering rule made this work, and it cost two re-captures to learn.** An artifact binds to its
generator's **blob**, so any edit to `capture.js` — including a one-line comment — invalidates every
corpus it produced. The generator must therefore be committed **first** and the capture driven
**second**. A capture driven before the tool is committed records `commitState: uncommitted-source`
and is refused just as firmly as a stale one, which is also what happened to the route manifest this
gate consumes until it was regenerated.

**A second rule, learned the same way: capture and replay on the SAME port.** Absolute `Location`
values and inline-script digests embed `config.app.url.port`, so a corpus captured on one port and
replayed on another reports differences that are pure harness noise. Measured: a first re-capture that
used a different port per append pass produced **84** non-secure differences, of which 38 of the 39
`header.location` diffs were byte-identical once the `http://127.0.0.1:<port>` authority was stripped
and all 26 `html.inlineScriptDigests` diffs had the same cause; re-capturing every pass on one port
and replaying there brought it to **23**, all attributed. `PARITY_PORT` sets both.

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

A capture of all 392 scenarios in **one** pass does not complete at `2f8712a`, and the cause is in the
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

#### The replay at the recorded authority, and the evidence limitation that bounds the baseline side

**The primary AAP §0.9.3 gate does NOT pass, and the reason is a pre-existing defect in the baseline
rather than a shortfall in the tooling or in the corpus.** This subsection states the whole of that,
because it is the most consequential fact in this file and an earlier revision left it unstated.

**What does pass, measured the way §0.9.1 words it.** A `git worktree` at `2f8712a` was created and
given **its own `npm ci`** — exit 0, **642 packages** — and `npm run verify:routes` was driven with
`BASELINE_APP` pointed at it, so both manifests were generated from their own installs by the same
delivered generator. It reports **`PASS - the HTTP surface is identical across all 233 entries`**,
exit 0. The primary parity gate is therefore a real two-tree comparison and not an inference
([§5](#5-the-gate-register-and-what-each-gate-proves)).

**What the replay reports, driven at the authority the corpus recorded.** The committed corpus records
`127.0.0.1:20530`, and replayed there the delivered tree drives **all 392 scenarios with no
application death**. The residual reduces to **~11 scenarios**, and every one of them is accounted
for:

- **`quirk.reply-chain.never-settles.image-download`** — AAP §0.7's approved deviation, correctly
  annotated: its `targetExpectation` declares a **200 stream carrying the file's own mime type and
  byte length and no `Content-Disposition`** (**artifact**: `test/parity/corpus.json`, that scenario's
  `targetExpectation`), which is exactly what the target answers
  ([§7.1](#71-deviation-1--the-never-settling-file-response)).
- **Rows whose *baseline* side is a transport failure.** They record
  `transport-failure: connect ECONNREFUSED 127.0.0.1:20530` because the baseline process was already
  dead when the capture reached them — the blocker below — and the target *answered*. A difference
  between an answer and a dead socket is not a behavioural difference.
- **`route.get.cache-prefix-{timestamp}/{assetType}/{path*}`** for `/cache-prefix-1/css/base.css`:
  baseline **404 `text/html`**, target **200 `text/css`**. The cause is the capture environment, not
  the conversion — the baseline capture ran **without built CSS**, so the file the route serves did
  not exist on that side.

**The recorded authority is a required replay parameter.** Replayed anywhere else the same run reports
**161 difference lines**, dominated by `html.inlineScriptDigests[0]` and `header.location`, because
`config.app.url` — host **and** port — is baked into rendered pages and into every absolute redirect.
That is harness noise with a known cause, and it is why the port rule above is stated as a rule.

**An independent recapture was attempted, and it reproduced a baseline application crash.** The
delivered generator was driven against the installed baseline worktree with the target's built CSS
copied in — legitimate, and checked rather than assumed: `static/` and `public/components` are
byte-identical between the two trees, so the built artifact is the same whichever tree builds it. The
capture died at **case 276 of 392**, leaving **115 cases undriven**, with this signature:

```text
Error: Cannot wrap an error
    (a hoek assertion inside Toolkit.response)
  reached from request.fail            lib/util/routeParser.js:510
  reached from                         lib/controllers/admin.js:160
```

which is the same defect the single-pass blocker above describes, met from a second direction. **The
capture tool's own verdict on what it had written was that "this artifact does NOT qualify as gate
evidence"**, for three separately reported reasons — application-died, cases-undriven and
baselines-pending. **That incomplete capture was discarded and the committed corpus restored**,
because the committed corpus is strictly more complete: 391 of 392 scenarios carry a recorded baseline
against the incomplete capture's 276 driven cases.

**The conclusion, stated as the evidence limitation it is.** The corpus's **baseline** side cannot be
completed from `2f8712a`, because the baseline application crashes mid-corpus. That is a defect **in
the baseline**, independently reproduced twice here and a third time by the joi matrix's 7 crashes and
7 restarts, and it is not a defect in the corpus tooling — which records the crash, refuses to commit
post-crash transport failures as baselines, and says so in its own verdict. The consequence for the
gate is direct: AAP §0.9.3 additionally requires a **secure** pass, which needs a `--secure-corpus`
capture taken against a `--secure` server, and that capture is blocked by the same crash. The replay
publishes this itself rather than leaving it to be inferred — the check is
**`NOT A GATE RUN: measured-secure-pass`** (`test/parity/replay.js`, the `measured-secure-pass`
check) — so the honest state is that the non-secure comparison is measured and attributed while the
gate as a whole does **not** pass.


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
requirement. The baseline half of the measurement is **done** — 391 of the 392 scenarios carry a recorded
response, driven against a worktree at the base commit — and the **comparison** against the delivered
tree has now run: all 392 scenarios driven at the corpus's recorded authority, with ~11 attributed
residual differences and no application death
([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). What is outstanding is
narrower and is not a coverage question: the **secure** pass has no baseline of its own and one cannot
be captured from `2f8712a`. Representation proves the corpus addresses every route; a recorded
baseline proves what each route answered at `2f8712a`; only the replay proves the two agree, and it
does so for the non-secure pass.

### 3.4 The unreachable list, with reasons

This file is where a genuinely undrivable entry is recorded. **No route is unreachable, and no
scenario is either.** One group of *outcomes* is:

| Entry | Kind | Stated reason |
|---|---|---|
| reCAPTCHA outcomes 3–6 | Outcomes, not routes | Unreachable over HTTP: under `NODE_ENV=test` the verify helper short-circuits on its `isTest` flag before any HTTP happens, so the 200, non-200, transport-failure and malformed-JSON branches cannot be reached through a route however the fixture is configured. Adding a secret does not help — the short-circuit is on the environment. `fixtures/http.js` **defines** each as a named profile and states the only route to them — a direct require of `lib/util/recaptcha.js` without `config/app.config` — but **no delivered harness performs that invocation**, so they are defined and **unexercised** ([§2.5](#25-the-isolation-architecture--interception-at-the-module-boundary), [§8](#8-what-remains-unproven)). An earlier revision of this row said they were exercised by direct module-level invocation; that read the intended mechanism as a report of a run |

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
payload, side effects and timing — **341 rows over 12 files** in the delivered artifact, whose closure
comparison against a baseline worktree spans **372** union rows: **295 closed, 57 open, 20 carrying no
mapping either tree can be held to**, with **342** baseline rows and **341** target rows accounted for
and their own denominators on the open set (45 of 342 baseline, 32 of 341 target). All 20 of the open
rows whose outcome the generator reports as *changed* are adjudicated edge by edge in
[§6.20](#620-the-error-edge-inventorys-open-rows-adjudicated) and every one is a comparator artifact
with no observable wire change. An earlier revision of this paragraph carried the pre-regeneration
figures — 332 rows and 245 closed.

**What the corpus delivers against those rows is a subset, and it is stated as a subset.** The
committed corpus carries a dedicated `error-edge.*` group of **9** scenarios, and of the **20**
`failure`-intent cases in the corpus 7 sit inside those groups and **13** are distributed through the
sweep, alongside **3** `redirect`-intent cases: **25 scenarios against 341 target rows**, chosen as the edges
whose disposition the conversion changed most visibly rather than one per row. All 25 carry a
**recorded baseline** — 391 of 392 scenarios do ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)) — so what exists for each is an
inventory row, a scenario definition and a measured baseline response. All 25 have since been **driven
against the delivered tree** in the replay at the corpus's recorded authority, which drove all 392
scenarios with no application death; what the §2.8 precondition still blocks is the *gate*, because the
corpus cannot be re-captured from `2f8712a` and the residual differences therefore cannot be reduced to
zero on the baseline side ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)).
The relation the gate enforces is one drivable request per changed edge, with the comparison asserting
status, payload or redirect, side effects and timing. One limit is carried into
[§8](#8-what-remains-unproven): the definitions reach **at most 25** of the 341 target rows — at most,
because they are not mapped to rows one to one, so 25 is a ceiling on coverage rather than a coverage
figure.

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
faults confirmed. The other four were driven in the replay at the corpus's recorded authority, which
answered all 392 scenarios, and **none of them appears among the ~11 attributed residual differences**
([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)) — which is the strongest
statement the evidence supports, and it is not the same as the gate qualifying: that is held open by
the missing secure-side capture, not by these five. Two earlier versions of this section are
superseded: one was titled as though all five were already asserted independently, and one said none
of the four had a recorded response. Both corrections are here rather than in a footnote because the
heading itself carried the claim.

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
stack of the `DEP0005` warning that tree then carried — the archive-dependency notice since removed at
its source ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)) —
and (b) **caused Node to emit a `DEP0040` punycode
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
| `capture.js --app <worktree at 2f8712a>` — a real `git worktree` with **its own `npm ci`** (406 packages recorded by that run; a full `npm ci` on that worktree reports **642**, the figure [§5](#5-the-gate-register-and-what-each-gate-proves) and [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) use, and the two are **not reconciled here**) | exit **0**, the **identical** step sequence `302 → 302 /login → 401 "Auth error" → 200`, and the fixture recorded `shape: callback+promise` — the baseline scheme passes a callback into a hand-rolled `new Promise` where the target awaits the query, so the dual-shape claim above is verified against the real baseline rather than in isolation |
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
artifact: `commit 2f8712a112db…`, `toolCommit 20fd5f91325e…` — a **recorded identity that does not
resolve in this repository** (`git cat-file -t 20fd5f91325e` fails), so it names the run and not a
retrievable tree — `cookiePass non-secure`,
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

One row carries **two** of these statuses — the zero-warning row, whose gate covers several drives of
which some ran at the delivered head and one did not. They are kept apart in the cell rather than
averaged into a single verdict, because a pass over four drives and no result over a fifth is not the
same claim as a pass over all five, and the wider drive is named in
[§8](#8-what-remains-unproven) with the command that settles it.

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
$ node test/parity/worker.js  --redis 127.0.0.1:6379 --out "$OUT/worker-result.json"
$ node test/parity/worker.js  --verify "$OUT/worker-result.json"   # audits what the run wrote
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
| **Route manifest, per entry** | The HTTP surface survived — method, path, controller binding, handler kind, effective auth, pre-handlers, pre-parse validation keys, templates, reply projection, cookie flag and options, compared entry by entry. **The primary parity gate** | **PASS** — 233 vs 233, 0 only-in-baseline, 0 only-in-target, **0 differing fields**, exit 0, with the provenance of both sides verified before the comparison. **The baseline side is generated rather than consumed from a committed artifact**: this delivery commits no manifest, so `--app` is pointed at a `git worktree` at `2f8712a` with its own `npm ci` and the generator writes that side there and then, recording `tree.head = 2f8712a112db46f923918c4507c75abc732d83d0` in its sidecar. An earlier revision of this row named a committed `test/parity/route-manifest.baseline.json`; that artifact is not in the tree, and the two-worktree generation is what replaces it — **re-measured this way at the delivered head: `PASS - the HTTP surface is identical across all 233 entries`, exit 0** ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). Wired into `npm run verify:routes`, and negative-tested: re-injecting a single route option makes it exit 1 naming the entry ([§6.2.4](#624-post-file-answers-415-to-a-multipart-upload-and-that-is-baseline)) (**re-measured on the integrated tree**) | `manifest.js --out T`; `manifest.js --app "$BASELINE" --out B`; `manifest.js --compare B T` |
| **Route-table CLI** | The `optimist` replacement preserved all **three** invocation forms, since the module self-executes unconditionally and so bare execution also emits the table | **PASS** — all three forms exit 0 at **22 209 bytes and 112 data rows** each and are identical to one another, and each is **byte-identical to the capture taken from the baseline worktree at `2f8712a`** through the same generator (**re-measured on the integrated tree**, below; the capture is written to a caller-supplied path outside the checkout, not committed, for the reason in [§1.3](#13-what-captured-at-baseline-means-precisely)) | `manifest.js --cli-table [--app "$BASELINE"] --out …` |
| **Request corpus replay** | Identical normalized responses across the full route inventory | **RUN at the corpus's own recorded authority, with ~11 attributed residual differences, and NOT QUALIFYING as gate evidence.** The corpus is a real recording of the base commit through the **delivered** generator — **392 scenarios, 391 recorded baselines, 404 recorded steps, 233 of 233 routes represented**, provenance verified against the generator blob and the commit containing it. Replayed against the delivered tree at the `127.0.0.1:20530` authority the recording carries, the target answers **all 392 scenarios with no application death**, and the residual reduces to **~11 scenarios, every one of them explained**: the approved image-download deviation, whose `targetExpectation` the artifact states in full; the scenarios whose *baseline* side recorded `transport-failure: connect ECONNREFUSED 127.0.0.1:20530` because the baseline process was already dead, against which the target answered; and `route.get.cache-prefix-{timestamp}/{assetType}/{path*}` for `/cache-prefix-1/css/base.css`, where the baseline recorded 404 `text/html` and the target answers 200 `text/css` because the baseline capture ran without built CSS. **The recorded authority is a required replay parameter, not a convenience** — replaying elsewhere inflates the report to 161 difference lines dominated by `html.inlineScriptDigests[0]` and `header.location`, which is the host:port baked into rendered pages and redirects rather than behaviour. **What keeps this row from being a pass is an evidence limitation with a named cause:** the gate additionally requires a secure-side capture (`--secure-corpus` against a `--secure` server), the replay says so itself as `NOT A GATE RUN: measured-secure-pass`, and that capture **cannot be taken from `2f8712a`** because the baseline application dies mid-corpus — independently reproduced, with the crash signature and the discarded recapture in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries). Two earlier revisions of this row are superseded: one recorded **367 match / 23 differ** non-secure and **355 / 35** secure, taken before the security remediations were reverted, and one before that recorded a refusal to replay at all over a corpus whose sidecar named a generator this repository could not retrieve | `npm run verify:corpus` |
| **joi matrix, 102 targets** | Accept/reject/coercion outcomes identical across the `joi` bump, response shapes included | **PASS on the question this gate exists to answer** — 102 targets, 306 cases, **462 outcomes and 15 678 fields compared, 0 schema-level differences and 0 generated-input differences**. The committed baseline verifies against its sealed sidecar (role `baseline-capture`, joi 17.13.3, app HEAD `2f8712a112db`, digest matched), so the comparison consumes evidence rather than an unattributed file. Both custom language maps re-measured **inert** on 17.13.3 and 18.2.5 alike (**re-measured on the integrated tree**). The command's own **exit status** is a different claim from its comparison result and is kept apart from it: see the `verify:joi` row in the command table below, which records why it last exited 1 and why that status is not re-measured at this state | `joi-matrix.js --compare test/parity/joi-baseline.json --port … --out …` |
| **Storage and archive contract** | The S3 key is a content hash, so a changed digest silently orphans every stored object; the cases assert the exact sha1 key, the suffix and extension branches, the content-type override, avatar gating, bucket selection, the export key and the archive's internal layout | **PASS — 35 of 35 cases passed**, exit 0, against an isolated in-memory MongoDB and the filesystem S3 fixture (**re-measured on the integrated tree after the archive-dependency move**). Everything the row exists to protect passes, including the three pre-migration cases that prove a changed digest surfaces as a lookup failure: the exact sha1 keys, the suffix and extension branches, the content-type override, avatar gating, bucket selection and the export key. **The thirty-fifth case is `archive-layout`**, read through `adm-zip`'s own `getData()`, and it is the single failure this row previously reported: `archiver` 2.1.1 wrote `crc32` 0 and uncompressed size 0, which the AAP-authorized `adm-zip` 0.6.0 refuses outright. `archiver` 7.0.1 writes both fields correctly and the entry reads back, so the gate carries no residual and no captured `[DEP0005]` — the four other failures this row used to list were the same retention seen from four angles ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)). Three cases were also **realigned back**: an interim delivery added a `removeTemporaryFile` cleanup on the avatar reject path and those cases asserted the leak's removal; the cleanup was withdrawn, because `lib/util/file.js` is provisionally excluded by AAP §0.2.2 and §0.9.2 conditions any change to it on naming the test that forced it, and no test forces this one. They now assert the preserved baseline leak as the leak it is, and the assertion carries that reasoning at its own site (`test/parity/storage.js`, the `PRESERVED BASELINE LEAK` comment on the reject-path case) | `npm run verify:storage` |
| **Export worker** | Bull 4's changed semantics — processor promise completion, `job.id` in the `failed` handler, `job.remove()` on `completed`, retry and stalled behaviour — plus status and error persistence, the archive layout, the notification mail and cleanup on both paths | **PASS — `VERDICT PASS`, 109 of 109 named checks, 0 notices under `--pending-deprecation --trace-deprecation`, exit 0** (re-measured on the integrated tree after the archive-dependency move). 7 jobs are driven on real `bull` 4.16.5 inside a per-run Bull key prefix. The Bull 4 adaptations hold — the queue is a real Bull queue, it exposes the Bull 4 surface, and it is namespaced — and so now does the export the jobs exist to complete: the gate's own first check, *"the worker's database idiom can complete an export"*, passes, and with it the 11 checks that depend on the success job reaching `completed` (the status sequence, the progress updates, the trinket count, the `filename`/`s3Key`/`downloadUrl` strings, the `expiresAt` horizon, the stored object, the `userassets` asset fetch, the archive layout and the single `export-ready` mail), the `missing-user` message, and the late-failure job's dereference, upload-before-throw ordering and failure mail. **What the earlier FAIL verdict recorded, and what moved:** that revision — 17 of the 109 named checks failing — measured a worker carrying 8 `Q.nsend` bridges and a `Query.prototype.stream` call this Mongoose line no longer provides, so the successful job never completed and 16 of its 17 failures followed from that one cause; the seventeenth was the zero-warning policy failing on the retained-`archiver` `[DEP0005]`. The delivered module carries **0 `Q.nsend` bridges, 0 `.stream(` calls, 1 `.cursor(` and 11 `.exec(`** (**measured**: `grep -c` over `lib/workers/exports.js`) against `mongoose` 6.13.9, and the notice's source is gone with `archiver` 7.0.1 ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)). **Where the evidence is:** `${PARITY_OUT:-${TMPDIR:-/tmp}/trinket-parity}/worker-result.json` plus its `.provenance.json` sidecar, neither committed — the authorized file set declares no worker artifact. Its provenance records `commitState: contains-this-exact-source`, so the artifact is evidence about a known tree. **Precondition, declared rather than assumed:** a Redis that **answers PING**, `PARITY_REDIS` (default `127.0.0.1:6379`), because `lib/util/queues.js`'s in-memory queue emits no events and Bull's completion, failure, retry and stalled semantics cannot be asserted against it; nothing in this repository provisions one. The endpoint is sent an inline `PING` and must answer `+PONG` or a RESP error such as `-NOAUTH`, so a silent TCP listener or a TLS-only endpoint is refused in under a second, by name. Note that `verify:worker`'s exit status gates `verify:corpus`'s chain, so the worker artifact must pre-exist for the replay to run | `npm run verify:worker` — that is `worker.js --redis "$PARITY_REDIS" --out "$PARITY_OUT"/worker-result.json` followed by `worker.js --verify "$PARITY_OUT"/worker-result.json` |
| **Existing suite** | The 124 baseline assertions unweakened, plus the 6 new page-surface cases | **FAIL — 130 registered / 129 executed / 95 passing / 36 failing** (re-measured on the integrated tree). The registered-case gate asserts registered = executed = passing = 130, so it is unmet by 1 on execution and 35 on passing. The 36 have two causes and neither is the framework or runtime move. **27** are base-commit bodies asserting expectations that production code held byte-identical to `2f8712a` has never satisfied, and they are **left failing rather than realigned** — 0 assertion lines were changed, so the failure is the record ([§6.2.1](#621-the-baseline-correction-exception-register)). The other **9**, plus the 1 case that never executes, share one cause: the API client sends the base commit's own `?outline=yes` for a parameter the route validates as a boolean, so the response carries a validation flash and no `data`, a `before all` hook in `test/lib/api/course.js` is left without the course it was to create, and the cases depending on it throw. Both the client value and the spec bodies are held byte-identical to `2f8712a` deliberately, so closing this is a decision about which of the two to move, not a repair. An earlier revision of this row recorded **234 passing, 0 failing, exit 0**; that figure counted suites this delivery does not ship — the `email-compat` and `diff-compat` ports and their specs were removed as outside the authorized file set | `CI=true npm test` |
| **Zero deprecation warnings** | The whole running application, not a subset, under `--pending-deprecation --trace-deprecation` | **PASS on every drive run at the delivered head; `not run` for the full-route pass.** Three parts, kept apart because they are not the same claim. **(1) Measured on a graph that agreed with the manifest, which is the only kind of warning figure worth recording.** `npm ci` was run first, because `node_modules` had been left holding `archiver` 2.1.1 while the manifest and the lockfile declared a different version. Boot under `node --pending-deprecation --trace-deprecation app.js` through to `Server started on port` emits **0 lines on stderr**; a **15-route unauthenticated drive** emits **0 deprecation or warning lines**, its stderr carrying only hapi's own `Debug: auth…` and `Debug: handler, error` lines, which are the preserved per-request debug logging and not warnings. Those two were taken on the 410-package graph that preceded the archive-dependency move; the two below were re-taken on the delivered graph, which resolves `archiver` 7.0.1 across 520 lockfile entries: `verify:worker` reports **0 notices, 0 allowed** under both flags while driving seven real jobs to `VERDICT PASS` over 109 of 109 checks, and `verify:storage` captures none across 35 of 35 cases. **(2) The one module-load residual this row used to carry is cleared at its source** by the archive-dependency move to `archiver` 7.0.1, measured rather than inferred from the version change ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)). **(3) The full 233-route, five-identity pass is UNPROVEN at this head**, and it is the part the corpus row above carries. The committed replay evidence records **this very check failing in both cookie passes**: `gates.failedChecks` names `non-secure: zero warnings from the application` and `secure: zero warnings from the application` under both `verification.selfConsistency` and `verification.againstTheMigratedTree`, with `4 warning line(s) on the application's stderr` for the self-consistency drive and `1 warning line(s)` against the migrated tree, recorded at `verification.applicationHead.recorded = 0716cd2811…` — the graph **before** the archive-dependency move (**artifact**: `test/parity/corpus.json.provenance.json`). That drive has not been repeated since, and neither has the 233-route two-identity sweep recorded in [§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application). So the honest state of this row is a pass over boot and the four named drives and **no result at all** over the route surface at the delivered graph | `node --pending-deprecation --trace-deprecation app.js`, then the drives in [§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application); the full-route pass needs `replay.js --annotations` driven under both flags, whose report carries this same named check, and its secure half needs the capture [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) records as blocked |
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
| `npm run verify:routes` | **0** | Generates the target manifest — `manifest: 233 routes`, byMethod `GET 137 / POST 63 / PUT 19 / DELETE 13 / PATCH 1` — and compares it against a baseline manifest. The comparison needs a baseline side and this delivery commits no manifest artifact, so the script refuses to fake one: with neither `BASELINE_MANIFEST` nor `BASELINE_APP` set it exits **1** printing how to supply one. **Driven with `BASELINE_APP` pointed at a `git worktree` at `2f8712a` that has its own `npm ci`, it generates both sides and reports `PASS - the HTTP surface is identical across all 233 entries`, exit 0** ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). The generator's provenance is verified against its own blob and the commit containing it |
| `npm run verify:corpus` | 1 | Replays the committed corpus against the delivered tree. Driven at the corpus's own recorded authority `127.0.0.1:20530`, the target answers all **392** scenarios with **no application death**, and the residual differences reduce to **~11 scenarios, every one of them accounted for** — the approved image-download deviation, the scenarios whose *baseline* recording is a transport failure, and one asset route the baseline could not serve ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). It exits 1 and the gate stays non-qualifying, structurally: there is no secure-side baseline corpus to compare against, and `measured-secure-pass` is a check no target-side run can satisfy on its own. An earlier revision recorded 367/23 and 355/35, taken before the security remediations were reverted, and one before that recorded exit 2 and a refusal to replay at all |
| `npm run verify:joi` | not re-driven | Drives 102 targets, 306 cases, 462 outcomes, 15 678 compared fields; reports **0 schema-level differences** and **0 proof mismatches over all 462 outcomes**, so validation parity across `joi` 17.13.3 → 18.2.5 holds — that is the question this gate exists to answer and it is answered. Its last recorded run exited **1** on **60 differences, none of them a validation verdict**: 53 HTTP drives that the injected authorization guards refused before validation ran (`authBlocked` `false` → `true`), 4 summary counters those refusals moved, 3 generated-input consequences, plus the retained-`archiver` warning check. **Both attributed causes have since been removed at source** — the injected gate and the flash redaction are absent from the delivered parser (**measured**: 0 occurrences of `makeValidationGate` and 0 of `redactSensitive` in `lib/util/routeParser.js`), and the warning has no source in a graph resolving `archiver` 7.0.1 — but **the gate has not been re-driven at this state, so its current exit status is not measured here** and no pass is claimed for it ([§8](#8-what-remains-unproven)) |
| `npm run verify:storage` | **0** | `35 of 35 cases passed`, no captured warning and no finding. The five failures this row used to list were one shortfall seen from five angles — the `archive-layout` case, one captured `[DEP0005]`, two warning-gate entries and one finding — and `archiver` 7.0.1 removes all five at their source |
| `npm run verify:worker` | **0** | Prints its one precondition — a reachable Redis at `PARITY_REDIS`, default `127.0.0.1:6379` — then `checks 109/109 passed, 7 job(s) driven on bull 4.16.5 … 0 notice(s) (0 allowed - the gate has no allowances), measured under --pending-deprecation --trace-deprecation` and `VERDICT PASS`. It writes its artifact and sidecar, which is what lets `verify:corpus` run at all. The 17 failures this row used to carry are accounted for in the gate register row above |
| `npm run verify:parity` | 1 | All five above, in order, and non-zero because one of them is: `verify:routes` needs `BASELINE_APP` or `BASELINE_MANIFEST` in the environment before it can compare, and `verify:corpus` cannot qualify without a secure-side baseline. `verify:storage` and `verify:worker` pass through the aggregate, and the run ends `verify:parity FAILED - at least one gate above did not pass` |

**Three of the five gates now pass through this wiring — `verify:routes` with a baseline supplied,
`verify:storage` and `verify:worker`** — and the two that do not exit non-zero for a reason stated in
its row above rather than for a broken wiring. The **retained-dependency** shortfall that used to hold
two of them down is gone at its source (`archiver` 7.0.1, [§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)),
and the **security remediations** that produced `verify:joi`'s 60 refusals and 15 of
`verify:corpus`'s differences were reverted rather than authorized ([§7.5](#75-findings-declined-because-granting-them-would-create-a-third-deviation)).
What remains is one **evidence** limitation rather than a comparison anyone could not make:
`verify:corpus` cannot qualify without a secure-side baseline, and that baseline cannot be captured
from `2f8712a` ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). What no
gate reports is a validation verdict, a route-surface change or an unexplained difference: every
gate's residual is attributed item by item. `verify:corpus` additionally depends on `verify:worker`'s
artifact, which the worker gate writes whatever its own verdict is — it passes now, and it wrote the
artifact when it failed too, which is what kept the replay runnable. Before this wiring existed the
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
| **Validation accept/reject outcomes** | The joi matrix over all 102 targets, three cases each, response shapes included | **PASS on the comparison, both sides measured**: `npm run verify:joi` reports 102 targets, 306 cases, **462 outcomes** and **15 678 fields** compared against the sealed 17.13.3 baseline, with **0 schema-level differences** and **0 generated-input differences** — the accept/reject question this row exists for, answered. Residual differences outside that question, in the `http` and `summary` scopes, are attributed in [§6.6](#66-native-hapi-validation-is-unreachable-here). On its **exit status** the record is a sequence rather than a single value: exit **0** with `gate PASSED` before the security remediations were introduced, exit **1** on 60 non-verdict differences once they had landed, and **not re-driven** since they were reverted — the comparison result is identical in both runs, and the `verify:joi` row of the command table in [§5](#5-the-gate-register-and-what-each-gate-proves) carries the detail |
| **Session and auth behaviour**, same cookie names and outcomes | The five independent auth-outcome assertions, [§4.7](#47-the-five-auth-scheme-outcomes-and-the-evidence-state-of-each), and the full `Set-Cookie` attribute comparison in both overlay passes, [§4.2](#42-the-exactly-compared-surface) / [§2.6](#26-the-server-overlay-and-why-one-was-needed) | All five outcomes are drivable and the gate fails while any is not asserted. The **baseline side of all five is recorded** (302 / 200 / 302 / 302, and a four-step `302` → `302 /login` → `401` → `200` for the lookup error), and outcome 5 is also **compared against the target** — a match with the injected faults confirmed ([§4.7.1](#471-the-fifth-outcome-and-how-it-is-reached)). The other four were driven in the replay and none appears among its attributed residual differences; the cookie-attribute assertion in **both** passes is what is still outstanding, and its secure half is blocked by the capture in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) |
| **Client-visible page behaviour and asset URLs** | The HTML comparison in [§4.2](#42-the-exactly-compared-surface) — rendered text, form and input names and values, `id`/`class`, `data-`/ARIA, inline-script presence and `href`/`src`, with asset URLs compared rather than stripped and only the cache-prefix digits normalized | **Compared, not awaited.** Baseline recorded for 391 of the 392 scenarios and replayed against the delivered tree on both cookie passes: **367 of 391 match** non-secure, 355 secure. No difference is an HTML-surface regression — the 23 are the escalated security remediations, four baseline transport failures from the application's own mid-capture death, two asset paths the baseline cannot build, and one session-cookie emission. Note one harness rule the comparison depends on: capture and replay must use the same port, or absolute `href`/`src` and inline-script digests differ on the authority alone |
| **Persisted data and file formats** | `test/parity/storage.js` and `test/parity/worker.js`, which assert the exact sha1 object key against pre-migration objects rather than freshly written ones — the only way a changed digest surfaces as a lookup failure instead of passing | **PASS on both. Storage — run, 35 of 35, exit 0**: every key, suffix, extension, content-type, avatar-gating, bucket-selection and export-key case passes against pre-migration objects, and so now does `archive-layout` — the single case that failed while `archiver` 2.1.1 wrote `crc32` 0. **Worker — run, 109 of 109 checks, 7 jobs driven on real `bull` 4.16.5, 0 notices, exit 0**: the object-key and persistence assertions this row exists for are now made against an export that actually completes. So the persisted-key contract is **verified** and the **archive byte format is verified too**. Two earlier revisions are superseded: one recorded both as PASS with the deferred-dependency blockers resolved before that was true, and one recorded a single storage failure and 17 failing worker checks while those blockers were live. Both are reachable as `npm run verify:storage` and `npm run verify:worker`, and through `npm run verify:parity` |
| **Existing assertions** | The suite gate, which permits a reviewed **stub-syntax** change, and an **explicit, per-case, measured exception register** for anything that moves an expected value or the registered set, [§6.2.1](#621-the-baseline-correction-exception-register) | **PARTLY MET — 130 registered / 129 executed / 95 passing / 36 failing**, asserted by the run itself. **On the criterion this row states, the result is clean: no assertion was deleted, loosened or made vacuous**, and only stub syntax changed for the maintained `sinon`. **Zero of the 124 baseline cases carry a changed expectation** (**measured**: the only hunks under `test/lib/` are new files, the `sequence` and suite-total additions, one removed unused `require`, two comment fences and stub syntax). An earlier revision of this row claimed 18 changed cases replacing 29 assertion lines with 33; no such row exists in the tree, and [§6.2.1](#621-the-baseline-correction-exception-register) now records the one exception that does exist — the two removed comment fences, which change the registered set and not any assertion. What is unmet is the *passing* count, not the assertion contract: 27 base-commit expectations that byte-identical production code has never satisfied, plus 9 failing and 1 unexecuted case behind a single frozen request value — both sets accounted for at [§6.2.1](#621-the-baseline-correction-exception-register) and in the **Existing suite** row above |
| **Error-to-response mappings** (R-e) | `docs/error-edge-inventory.md` plus the failure-path cases in [§4.6](#46-failure-paths-run-beside-the-success-sweep) | Inventory **regenerated from the delivered tree against a baseline worktree**: its authoritative verdict table now reads **372 rows — 295 closed, 57 open, 20 not compared**, the open set splitting 20 outcome-changed / 25 no-target-row / 12 new-in-the-target. **All 20 outcome-changed rows are adjudicated site by site against `git show 2f8712a:<file>` in [§6.20](#620-the-error-edge-inventorys-open-rows-adjudicated), and every one is a comparator artifact with zero observable wire change.** An earlier revision of this row recorded 332 rows and 245 closed, taken before the regeneration |

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
  makes changing production to satisfy the test the R-d violation. **No exception of this kind was
  taken**: **zero** of the 124 baseline cases carry a changed expectation (**measured**, in
  [§6.2.1](#621-the-baseline-correction-exception-register)). An earlier revision recorded eighteen,
  and it described a state that was reverted before delivery. The 27 cases whose base-commit
  expectations byte-identical production code has never satisfied are therefore **left failing**,
  which is the visible form of not taking the exception.

**Negative-tested, not assumed.** The preserved assertions are only worth their evidence if they can
still fail. Three spot checks were run and all three failed the run as they should:
`'metrics.runs': 1` changed to `99`, and `calledWithExactly(query)` changed to
`calledWithExactly({nope:1})`, both in `test/lib/models/trinket.js`; and the re-enabled download
case's `statusCode.should.eql(200)` changed to `201`. Each produced a failing case **and** the
suite-total gate reporting `passed` below `executed`, which is the second half of what makes the count
meaningful. All three edits were reverted after the check.

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
**resolution** adopted. No entry says only "resolved". The log is a record of what happened, so its
last **eight** entries — [§6.14](#614-a-single-pass-capture-does-not-complete) through
[§6.21](#621-a-model-layer-bridge-whose-removal-turned-a-preserved-200-into-a-process-crash) — are
ambiguities the plan did not anticipate and that surfaced during the work. An earlier revision of this
sentence said six, before the error-edge adjudication
([§6.20](#620-the-error-edge-inventorys-open-rows-adjudicated)) and the model-layer bridge
([§6.21](#621-a-model-layer-bridge-whose-removal-turned-a-preserved-200-into-a-process-crash)) were
added.

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

**Resolution.** Repaired as **precondition** work, with no assertion deleted, loosened, made vacuous
or given a different expected value — measured, and recorded with the one exception that does affect
the registered set in [§6.2.1](#621-the-baseline-correction-exception-register): the two dead
helpers deleted rather than patched (neither mocked anything the application uses, and no test called
the queue helper), the environment moved into a `--require` preload, readiness moved into a
first-collected spec, the spec glob narrowed so helpers are no longer collected as specs, the flow
helper's agent made lazy, and `sinon` moved to a maintained line with three legacy stub calls
converted. `test/setup.js` was reduced to an inert signpost recording why its content moved.

**And the outcome, measured in this delivery.** `CI=true npm test` → **130 registered, 129 executed,
95 passing, 36 failing**, and the run asserts that contract mechanically: `EXPECTED_CASES = 130` in
`test/lib/api/index.js`, whose root `after` hook walks the root suite and fails the run unless the
number of cases **registered**, **executed** and **passing** all equal 130. Here they are 130, 129 and
95, so the gate is unmet by 1 on execution and 35 on passing. That hook is what closes the gap a green
reporter line leaves open — an uninvoked spec file or a `before all` hook that suppresses the rest of
its suite lowers the reported total without reporting a failure of its own — and in this tree it is
doing exactly that job rather than merely confirming a pass. **Negative-tested** in both directions: an
expectation one above the measured total fails while reporting `registered`, `executed` and `passed`
all equal, and one deliberately broken case fails with `passed` one below `executed`.

**The 36 failures have two causes, and neither is the runtime or framework move.** **27** are
base-commit bodies whose expectations production code held byte-identical to `2f8712a` has never
satisfied. They are **left failing rather than realigned**, which is the whole of the reason there is
nothing for an exception register to hold: changing the expectation would have hidden the mismatch and
changing production to satisfy it is the behaviour change the migration prohibits, so the failure
itself is the record ([§6.2.1](#621-the-baseline-correction-exception-register)). The other **9**, together with the **1 case that never executes**,
share a single cause: `test/helpers/flow.js` sends the base commit's own `?outline=yes` for a
parameter the route validates as a boolean, so the response carries a validation flash and no `data`,
the `before all` hook at `test/lib/api/course.js` is left without the course it was to create, and the
cases that depend on it throw. Both halves are deliberately frozen — the client value to preserve
base-commit request behaviour, the spec bodies to preserve the assertions — so closing this is a
decision about which of the two to move, not a repair, and it is recorded here rather than resolved by
editing whichever one is easier to reach.

**An earlier revision of this document recorded 234 passing / 0 failing and a gate asserting 234.**
Both figures described a tree this delivery does not ship. The `email-compat` and `diff-compat`
behaviour ports and their **59** and **24** specs were removed as paths outside the authorized file
set, along with the parity artifacts that cited them, and the suite gate's expectation was returned to
the AAP's **130**. Where this document still describes those modules, it is describing removed work;
the surviving contract is the one measured above.

**AAP §0.9.2 states 130, and 130 is exactly what this delivers — not a floor it exceeds.** The
registered total is **130**, the AAP's figure, and the run asserts it mechanically
(`EXPECTED_CASES = 130`). An earlier revision of this paragraph described the AAP's 130 as a floor
with "a further 104" above it; those 104 were the `email-compat` and `diff-compat` specs removed as
paths outside the authorized file set, so the relationship is not additive and the sentence is
withdrawn. No pre-existing case was removed or renumbered. The **124** is the number of `it()` bodies
**present** at base commit `2f8712a`: 123 of them active, plus
`it('should respond with a zip file', …)`, which sits inside the `/* … */` block at
`2f8712a:test/lib/api/course.js:254-280`. That one body is the whole of the difference between the
registered baseline count (123) and the AAP's lexical count (124), and it is why an earlier draft of
this document argued for a total of 129. **That argument was wrong in its conclusion even where it was
right in its arithmetic**: the AAP is frozen at 130, and the 124th body is a real test of a real route
that was disabled rather than deleted — so the correct response is to make it pass, not to renumber
the target around it. The fence removal that re-enables it is the single entry in
[§6.2.1](#621-the-baseline-correction-exception-register).

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

**The register holds exactly one exception, and it is not an assertion change.** **Zero** baseline
assertion lines were removed or altered — **measured**: `git diff --stat 2f8712a HEAD -- test/lib/`
reports eight files, and every hunk in them is one of the following: a new file (`test/lib/00-ready.js`,
`test/lib/ready.js`, `test/lib/api/pages.js`), the `sequence` insertion and the suite-total hook in
`test/lib/api/index.js`, one removed unused `require` in `test/lib/api/trinket.js`, the two comment
fences named below in `test/lib/api/course.js`, and **stub syntax** in
`test/lib/models/plugins/paginate.js` and `test/lib/models/trinket.js` — `.reset()` → `.resetHistory()`
and three `sinon.stub(obj, 'm', fn)` → `.callsFake()`. Not one assertion expression, and not one
expected value, differs from `2f8712a`.

**The one exception, and the arithmetic that forces it.** A lexical count of the baseline suite gives
**124** (**measured**: `grep -c '^\s*it('` summed over `git show 2f8712a:<file>` for every file under
`test/lib`), and HEAD gives **130** the same way. But the baseline's 124 **includes one case fenced
inside a `/* … */` block** — `it('should respond with a zip file', …)` in
`test/lib/api/course.js` — which mocha never registered, so the baseline suite registered **123**.
HEAD registers exactly **130 = 123 + 6 + 1**: the 123 baseline bodies, the **6** new cases in
`test/lib/api/pages.js`, and the **1** re-enabled case. **Removing those two fences is the exception
this register records.** Its five assertions are byte-identical to the ones written at base commit —
the only lines the diff removes in that file are the two fence lines themselves — so the assertion
contract is untouched; what changed is the **registered set**, and that needs recording rather than
passing silently.

**Why the fences stay removed rather than being restored.** AAP §0.9.2 mandates **130** registered,
executed and passing, and `test/lib/api/index.js` asserts that number mechanically
(`EXPECTED_CASES = 130`). Restoring the fences would drop registration to **129** and fail that gate
against the AAP's own figure. So the fence removal is the authorized reading: the AAP counts the 124
bodies **present** at `2f8712a`, one of which was disabled rather than deleted, and the way to
satisfy a frozen figure is to make that body pass rather than to renumber the target around it — which
is what [§6.2](#62-npm-test-had-no-green-baseline) records having done, correcting only the request
the case sends and the fixture data it needs.

**An earlier revision of this section tabulated eighteen rows** — "eighteen of the 124 baseline cases
carry a changed expectation", replacing 29 baseline assertion lines with 33, across four spec files —
and **none of those rows exists in the delivered tree**. It described a state that was reverted before
delivery, and the measurement above is what replaces it. The revision is named rather than silently
dropped, because a reader who saw it should know it was withdrawn and on what evidence: the assertion
diff is empty, so there is nothing for such a register to hold.

**One thing this register still deliberately does not contain**, because the distinction it draws is
the one the gate is worded around: a row for a **fixture value** a case sends. `test/lib/api/profile.js`
is unchanged in this tree, so even that has no row now — but the rule stands for any future entry, and
[§6.2.2](#622-preconditions-drivers-and-doubles-the-suite-had-to-supply-itself) is where a
precondition of that kind belongs.

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
  declares.** `diff` 1.0.8 did not require it for that input, because its index arithmetic does not
  reject that hunk against an empty source — measured: `applyPatch('', patch)` returns fabricated
  patched text on 1.0.8 and `false` on 8.0.4. It is a difference in *that* case only: 1.0.8 does
  return `false` when a context line genuinely mismatches non-empty content, which is why the
  delivered compatibility layer propagates `false` verbatim
  ([§6.2.4](#624-post-file-answers-415-to-a-multipart-upload-and-that-is-baseline)).
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
entry**, options included.

**It was tried in this pass and then withdrawn, and both halves of that are recorded because the
withdrawal is the decision.** `multipart : true` was added to the **four routes that declare
`output: 'file'`** — two in `config/routes.js` and two in `config/api_routes.js` (**measured**:
`grep -c "output *: *'file'"` over both) — and then removed again, for two measured reasons. First, it
is **not a hapi-21 delta**: a real listener carrying this repository's exact payload block answers
**415 on hapi 20.3.0 and on 21.4.10 alike**, so switching the parser on would have been a behaviour
*change* rather than the repair of something the framework move broke. Second, the parity gate refuses
it by construction: **`verify:routes` reports `FAIL - 4 difference(s)` with the flag in place and
passes without it**, naming `POST /file … options … "multipart":true` against the baseline. The flag
is therefore absent from the delivered tree (**measured**: 0 occurrences of `multipart` in
`config/routes.js` and in `config/api_routes.js`), and `config/routes.js` differs from `2f8712a` by
the `js-yaml` hunk and nothing else, verified by `git diff`.

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

**One dependency-driven behaviour change was found on the material-patch path, and it is resolved in
the delivered tree rather than carried as a shortfall.** The `diff` bump is mandated by R-c for a HIGH
advisory on the 1.x line, and `diff` **stays declared and installed at 8.0.4** — the advisory is
cleared and no other consumer changes. What the bump moved is only one half of a pair: the patch is
**produced** in the browser by jsdiff **1.0.8**, a version committed configuration pins
(`config/default.yaml:110` declares the version and `config/default.yaml:172` loads that exact build
into the course editor), and the editor strips the file header before it `PUT`s the hunks, so the
server receives a 1.0.8-dialect, header-stripped hunk body whatever the server's own parser is. An
option set cannot bridge that: `compareLine` and `fuzzFactor` were measured and neither reproduces
1.0.8's arithmetic. A **compatibility layer** is therefore the right shape, and it is delivered:
`applyLegacyPatch` in `lib/controllers/course.js:169` is a line-for-line port of `applyPatch` as
published in `diff@1.0.8`, measured case by case against a genuine 1.0.8 install, and the patch branch
of `course.updateMaterial` calls it — `lib/controllers/course.js:880` applies it to
`material.content ? material.content : ''`, with the `patched === false` branch immediately below at
`:881`. An earlier revision of this paragraph placed the port in `lib/util/diff-compat.js`, a path
removed as outside the authorized file set; the port itself was moved to the call site, not dropped.

Two things the earlier version of this paragraph got wrong on its own terms, corrected here because
both change what the record says:

- **The divergence was one input class of eight, not every input.** Genuine 1.0.8 `createPatch`
  output, header-stripped exactly as the front end strips it, was applied on both versions across
  eight cases — clear one line, clear one line with no trailing newline, clear multi-line, edit one
  line, append a line, first content into an empty material, no change, and clear a whitespace-only
  body. **Seven agree.** The one that does not is writing the **first** content into a material whose
  stored `content` is null or empty: `applyPatch('', '@@ -1,0 +1,1 @@\n+new\n')` yields `'new\n'` on
  1.0.8 and `'\nnew'` on 8.0.4 — a leading newline gained and the trailing one lost, which is a silent
  corruption of the saved material on an ordinary save rather than an error anyone would see. The full
  case table is in the comment above `applyLegacyPatch` in `lib/controllers/course.js`.
- **`false` on a genuinely conflicting patch is not something the bump introduced.** 1.0.8 returns the
  boolean `false` too when a context line does not match the source, and the compatibility layer
  propagates it **verbatim** precisely because that is the stale-page detector the handler tests with
  `patched === false` — the "modified in another window" refusal that stops an edit computed against
  content someone has since changed from landing on top of the newer content. That path therefore
  behaves the same on both versions and is preserved deliberately; describing it as a bump-induced
  behaviour change was incorrect independently of the layer.

**So R-c and R-d are both satisfied for that input class** as the argument above establishes — but the
evidence this section originally cited **is not in the delivered tree**. `lib/util/diff-compat.js` and
its 24-case spec `test/lib/util/diff-compat.js`, like the `email-compat` pair beside them, were removed
as paths outside the authorized file set for this delivery, and the suite result they ran inside is
superseded by the 130-case contract recorded above. What remains in the tree is the equivalent
behaviour held inside `lib/controllers/course.js` as `applyLegacyPatch`, which is where a reader should
look for the preserved `diff` 1.0.8 semantics. The R-d argument stands on its own reasoning; the
citation to a removed module and a removed suite total does not, and is withdrawn here rather than
left to be discovered.

**A green suite is still not attribution, and the corpus is what would supply it.** The suite proves
that every case it registers passes; it cannot prove that a converted controller answers what its
predecessor answered on a path no case exercises. That is what the corpus is for, and it now exists as
a real recording of the base commit — 392 scenarios, 391 recorded responses, 233 of 233 routes
represented — and the **comparison has run**: all 392 scenarios driven against the delivered tree at
the corpus's recorded authority, with ~11 attributed residual differences and no application death
([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). What remains is the
**secure** half, which has no baseline of its own and cannot get one from `2f8712a`, and it is carried
into [§8](#8-what-remains-unproven) as an open item rather than presented as a pass.

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

**The counts above are from the run driven at the evidence commit; a later run over the re-captured
baseline compared 15 678 fields rather than 13 427**, with the same 0 schema-level and 0
generated-input differences ([§5](#5-the-gate-register-and-what-each-gate-proves) carries it, together
with the reason the command's **exit status** is tracked separately from its comparison result and is
not re-measured at this state). What follows is the attribution of the residual, which is unchanged in
class by the re-capture.

**That run exited 1, and the reason is not a validation difference.** 28 fields differ, all in the `http` and
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
replay at the corpus's recorded authority has since **driven** that sequence against the delivered tree
— it is not among the attributed residual differences, and what remains outstanding is the gate rather
than this comparison ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)).
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

That sweep is the full-surface measurement the gate asks for rather than a boot floor — boot, every
method (GET·137, POST·63, PUT·19, DELETE·13, PATCH·1), both identities, and the worker — and it was
measured earlier in this delivery, on the integrated tree, not at the delivered head. The next
paragraph says which drives were re-measured there and which were not, because the two are different
claims and this section previously ran them together.

**What was re-measured at the delivered head, and what was not.** `npm ci` was run first, because
`node_modules` had been left holding `archiver` 2.1.1 while the manifest and the lockfile declared a
different version, and a warning figure taken on an undeclared graph describes nothing. On the
resulting graph — **410 packages**, resolving `archiver` 6.0.2 — four drives were re-measured and all
four were clean: boot under `node --pending-deprecation --trace-deprecation app.js` through to
`Server started on port`, **0 lines on stderr**; a **15-route unauthenticated drive**, **0
deprecation or warning lines**, its stderr carrying only hapi's own `Debug: auth…` and
`Debug: handler, error` lines, which are the preserved per-request debug logging and not warnings;
`verify:worker`, **0 notices with 0 allowed** under both flags across seven real jobs; and
`verify:storage`, no captured warning across its cases. **The archive dependency moved again after
those four drives**, to the delivered `archiver` **7.0.1**, which changed the resolved graph — the
delivered lockfile and install agree at **520 package entries** (**measured**: `package-lock.json`
against `node_modules/.package-lock.json`), so the 410-package figure quoted above and elsewhere in
this file belongs to the graph that preceded the move and is not the delivered count. Two of the four
drives **were** re-taken on the delivered graph and both are recorded in
[§5](#5-the-gate-register-and-what-each-gate-proves): `verify:worker` reports 0 notices under both
flags over 109 of 109 checks, and `verify:storage` reports no captured warning over 35 of 35 cases.
**Boot and the 15-route drive were not re-taken on it**, and neither was the **233-route
two-identity sweep above**; the wider 233-route five-identity pass has never passed at all: the
committed replay evidence records this check
**failing in both cookie passes** — `gates.failedChecks` naming `non-secure: zero warnings from the
application` and `secure: zero warnings from the application`, with `4 warning line(s) on the
application's stderr` for the self-consistency drive and `1 warning line(s)` against the migrated
tree — at `verification.applicationHead.recorded = 0716cd2811…`, before the archive-dependency move
(**artifact**: `test/parity/corpus.json.provenance.json`). The gate register row and
[§8](#8-what-remains-unproven) carry that state, and it is why this section does not close with an
unqualified pass.

All four of the baseline's classes are **cleared**, each by the change that was supposed to clear it:
`strictQuery` by the explicit setting in the database configuration, the `iconv-lite` `DEP0005` by the
`nodemailer` bump, and the `node-pre-gyp` `DEP0169` by the `bcrypt` bump. **The AWS notice is absent
from the delivered log entirely**, which settles an item AAP §0.9.6 listed as unproven — see
[§6.17](#617-the-aws-sdk-v2-notice-suppression-was-proven-not-deferred).

So **the gate's stated pass condition — no warning attributable to the application's own source or to
any dependency this migration retains — is met on every drive that has been run at the delivered
head.** It is not yet met over the whole gate as the request words it, because the drive that wording
reaches furthest into — the route surface under all five identities — is the one that has not been run
there.

**How the fourth one was cleared, because an interim delivery reported it as a shortfall.** An earlier
state of this delivery measured one residual class: `[DEP0005] Buffer()` traced to
`compress-commons/lib/archivers/zip/constants.js:11` at module load, resolved by `npm ls
compress-commons` to `archiver@2.1.1 → zip-stream@1.2.0 → compress-commons@1.2.2`. `archiver` was at
that point **retained**, deferred on the grounds that it carries no advisory of its own — true of
advisories, and silent on warnings. It was recorded here as a named shortfall with the remedy
identified as "a decision about `archiver`".

That decision was taken: **`archiver` moved 2.1.1 → 7.0.1**, which removes the warning at its source.
The version was not chosen to silence a warning alone — the same measurement found archiver 2.1.1 also
writing zero crc32 and zero uncompressed size into every deflated entry, so the archives the export
worker and the download routes produced could not be read back by the application's own `adm-zip`,
which AAP §0.5.1.2 moves to 0.6.0 and which refuses such an entry outright. Both reasons are measured
and both are inside the triage rule AAP §0.5.1 already states: a package may change for **a runtime
warning** as well as for an advisory, and §0.5.1.1's `archiver keep` row was reasoned about
**advisories only** — correctly, it has none — so it does not bar a change made for the other reason.
`archiver` 7.0.1 declares `engines {"node": ">= 14"}`, which Node 22 satisfies, and emits nothing
under either flag (**measured**: `node --pending-deprecation --trace-deprecation -e
"require('archiver')"` → no output, exit 0). The archive is unchanged where it was already right —
the same per-entry compression method and compressed sizes — and correct where it was wrong. It is not
byte-for-byte identical to what 2.1.1 wrote, and must not be described that way: the CRC and
uncompressed-size fields deliberately differ, because those are the bytes that were wrong. An earlier
revision of this passage named 6.0.2 as "the lowest version that clears both"; the delivered move is
to 7.0.1 and that is the version every figure in this file is now taken against.
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
belongs to the replay gate, whose baseline is recorded, whose comparison **has** now been driven over
all 392 scenarios at the recorded authority
([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)), and whose only recorded
run of **this check** failed it in both cookie passes on the earlier `0716cd2` graph — before the
archive-dependency move removed the one module-load source those lines are attributable to. Until
`replay.js --annotations` is driven again under both flags and reports the named check clean in both
passes, the whole-application claim is **unproven at the delivered head** rather than achieved; and
the secure pass additionally needs the capture §2.8 records as blocked. That is the state the register
row and [§8](#8-what-remains-unproven) publish.

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
evidence **is** affected in two places, both recorded: the corpus could not be captured before the
conversions landed, and the capture it eventually got is bounded by a baseline crash rather than by
the tooling ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)); and the
"assertions green before conversion" reassurance was never available
([§6.2](#62-npm-test-had-no-green-baseline)).

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

**Resolution:** `archiver` moved **2.1.1 → 7.0.1**, which is warning-free and standards-correct, and
the move is authorized by the triage rule the AAP already states rather than by an exception granted
here. **The authorization, stated precisely because a dependency change has to be traceable to a
permitted reason:** AAP §0.5.1's triage rule permits a package to change for *"a runtime warning"* as
well as for a critical or high advisory, and §0.5.1.1's `archiver keep` row was justified on
**advisories alone** — correctly, since it carries none — and is silent on warnings, so it does not
bar a change made for the other reason. **Two measured reasons, either of which is sufficient:**
archiver 2.1.1 emitted `DEP0005` `Buffer()` at module scope through
`zip-stream@1.2.0 → compress-commons@1.2.2`, reached on the application's own request path through
`lib/controllers/trinket.js`; and archiver 2.1.1 wrote `crc32 = 0`, which the AAP-authorized
`adm-zip` 0.6.0 cannot read at all.

**Measured after the move.** `node --pending-deprecation --trace-deprecation -e "require('archiver')"`
emits **nothing**, exit 0. `archiver` 7.0.1 declares `engines {"node": ">= 14"}`, satisfied by the
Node 22 runtime this migration targets. `npm run verify:storage` reports **35 of 35 cases passed,
exit 0** — the `archive-layout` case that used to be the single failure now reads its entry back
through `adm-zip`'s own `getData()`. `npm run verify:worker` reports **`VERDICT PASS`, 109 of 109
named checks, 0 notices under `--pending-deprecation --trace-deprecation`, exit 0**. And
`npm audit --omit=dev` is **unchanged**: **0 critical, 1 high, 6 moderate**, the same seven
advisories — `aws-sdk`, `bull`, `highlight.js`, `jszip`, `marked`, `mongoose` and `uuid` — so the move
neither introduces nor clears an advisory and the audit deviation in
[§7.2](#72-deviation-2--the-marked-fork-is-retained) is untouched by it.

The archive is unchanged where it was already right — the same per-entry compression method and
compressed sizes — and correct where it was wrong. Verified end to end: `POST /api/trinkets/download`
on the running server returns a 200 `application/zip` whose entries read back byte-exactly through the
application's own `adm-zip`. This item is closed rather than carried into
[§8](#8-what-remains-unproven).

**Two earlier revisions of this record are superseded and both are named so a reader comparing them
can see which way the tree moved.** One recorded the dependency as **retained at 2.1.1**, with the
`[DEP0005]` and the unreadable archive carried as open shortfalls; the other recorded a move to
**6.0.2** described as "the lowest version that clears both". Neither is the delivered state: the tree
declares `"archiver": "^7.0.1"` and resolves 7.0.1 with `compress-commons` 6.0.2 and `zip-stream`
6.0.1 (**measured**: `package.json`, `package-lock.json` and `node_modules/archiver/package.json`).

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

### 6.20 The error-edge inventory's open rows, adjudicated

**Ambiguous.** R-e requires every error-to-response mapping to survive the conversion unchanged, and
`docs/error-edge-inventory.md` is the deliverable that holds it row by row. Regenerated from the
delivered tree against a baseline worktree, its authoritative verdict table reads:

| Verdict | Rows |
|---|---:|
| closed | **295** |
| open | **57** |
| not compared | **20** |
| **all rows** | **372** |

and the 57 open rows split **20 "outcome changed"**, **25 "no target row"** and **12 "new in the
target"**. A closure count is not a parity claim on its own, so the question this section settles is
what the open rows actually are.

**Measured.** All **20** "outcome changed" rows were adjudicated **site by site** against
`git show 2f8712a:<file>`, and they share one verdict:

> Every one is a **comparator-resolution or edge-anchoring artifact** of comparing the shim's **opaque
> `reply()` call site** against a **resolvable native return**. The generator can attribute a funnel
> and a status to the resolvable side and cannot resolve through the shim, so the two sides read
> differently while the **wire outcome is identical**. **Zero** of the 20 is an observable change.

| Row | Target site | Sub-class |
|---|---|---|
| `helpers.findTrinket.response.3` | `lib/util/helpers.js:209` | pre-handler return/throw equivalence |
| `helpers.courseBySlug.response.3` | `lib/util/helpers.js:453` | pre-handler return/throw equivalence |
| `helpers.getDefaultTrinket.response.1` | `lib/util/helpers.js:396` | pre-handler return/throw equivalence |
| `helpers.userByUsername.response.2` | `lib/util/helpers.js:418` | pre-handler return/throw equivalence |
| `helpers.trinketByOwnerAndSlug.response.1` | `lib/util/helpers.js:471` | pre-handler return/throw equivalence, on an **unrouted** pre-handler |
| `helpers.trinketByOwnerAndSlug.response.2` | `lib/util/helpers.js:476` | as above |
| `helpers.trinketByOwnerAndSlug.response.3` | `lib/util/helpers.js:484` | as above |
| `helpers.trinketByOwnerAndSlug.response.4` | `lib/util/helpers.js:494` | as above |
| `helpers.trinketByOwnerAndSlug.handler.1` | `lib/util/helpers.js:496` | as above |
| `courses.download.response.1` | `lib/controllers/courses.js:417` | same funnel, same 500; baseline side unresolvable |
| `files.uploadAvatar.response.2` | `lib/controllers/files.js:270` | same funnel, same 500; baseline side unresolvable |
| `course.archiveCourse.cps.1` | `lib/controllers/course.js:471` | the edge **anchor** moved |
| `trinket.logError.cps.1` | `lib/controllers/trinket.js:1167` | the edge **anchor** moved |
| `folders.create.cps.1` | `lib/controllers/folders.js:218` | the edge **anchor** moved |
| `course.join.cps.1` | `lib/controllers/course.js:1316` | Layer 1 by structure, per AAP §0.6.3 |
| `trinket.autosave.response.3` | `lib/controllers/trinket.js:1359` | `legacyReply`, an in-tree reproduction of the shim |
| `trinket.autosave.response.2` | `lib/controllers/trinket.js:1369` | `legacyReply`, as above |
| `trinket.library.cps.1` | `lib/controllers/trinket.js:366` | named after a **local helper** the target introduces |
| `users.assetUploadFromURL.handler.1` | `lib/controllers/users.js:887` | the two **failure arms** paired against each other |
| `users.sendEmailVerification.response.2` | `lib/controllers/users.js:1154` | **settlement timing** only |

**The nine pre-handler rows in `lib/util/helpers.js`.** Baseline wrote `return reply(err)` or
`reply(Boom.notFound())`; the target writes `return err`, `throw err` or `return Boom.notFound()`. In
hapi 21 a Boom **returned** from a pre-handler and a Boom **thrown** from one both fail the request
with that Boom's own status, and `Response.wrap` boomifies a plain `Error` to **500** either way — so
the wire outcome is the same on both sides, and the difference the generator reports is that it
attributes a `funnel` **only to the resolvable side**. Two further facts bound these nine. Five of
them sit in `trinketByOwnerAndSlug`, which **no route references** (**measured**: 0 occurrences in
`config/routes.js` and 0 in `config/api_routes.js`), so those five cannot produce a wire outcome at
all — the inventory's own candidate column says `none possible` for each. And **the two `return null`
sites AAP §0.6.6 mandates are separate rows, and both are already closed**: the language-mismatch
branch of `findTrinket` and the slug-alias branch of `courseBySlug` return `null` in the target
exactly as the shim resolved `null` in the baseline, which is the preserved dead-301 quirk rather than
one of these twenty.

**`courses.download:417` and `files.uploadAvatar:270`** are the same shape without the pre-handler
contract: same funnel, same **500** on both trees. The baseline side of each carries the
unresolvable text *"the error value, boomified or served as-is by the funnel"* — the generator cannot
tell which, through the shim — while the target names the concrete Boom. Naming a value is not
changing it.

**`course.archiveCourse:471`, `trinket.logError:1167` and `folders.create:218`** are **anchor moves**.
In the baseline the edge sat in a callback body that also held the success call; in the target it sits
on an empty `.catch(function(){})`. The behaviour on both trees is **swallow and succeed**, which is
preserved exactly; what moved is the line the generator names as the edge.

**`course.join:1316`** changes `reply(err)` into `reject(err)`, which lands in **Layer 1** — and AAP
§0.6.3 states that Layer 1 becomes *structural* after the conversion: *"a rejecting async handler
lands here"*. `findByAccessCode` yields only plain `Error`s, and both trees answer **500** with the
message hidden by Boom, so the funnel is reached by a different route to the same response.

**`trinket.autosave:1359` and `:1369`** call `legacyReply(err, h)`, which is a **deliberate in-tree
reproduction of the shim's settlement** written precisely so this path keeps behaving as it did. The
generator cannot resolve through it — that is what it means to reproduce a shim — so the row reads as
changed while the response is the one the baseline produced.

**`trinket.library.cps.1`** is named after a **local helper the target introduces**: at
`lib/controllers/trinket.js:366` the target declares
`var lookupTrinket = function(id) { return Trinket.findById(id).catch(function() { return null; }); }`,
so the surface the generator reports — `internal callee` — is **literally correct**. The redirect and
the success response moved into the awaiting handler body, where they still happen.

**`users.assetUploadFromURL:887`** pairs the **baseline's transport-error arm** against the **target's
mid-stream arm** — two failure modes AAP §0.4.2 explicitly distinguishes and requires to be kept
apart. The target's transport arm is at `lib/controllers/users.js:900` and **logs only, and settles
nothing**, which is exactly the AAP's mandate for it; the mid-stream arm logs, ends the write and
completes the upload with the partial bytes, as the baseline's `end` listener did. The row compares
one arm against the other, not a changed outcome.

**`users.sendEmailVerification:1154`** differs on **settlement timing** alone — deferred in the
baseline, synchronous in the target — with the same funnel and the same response. The inventory's own
`What differs` column says so.

**The other 37 open rows are structural, not behavioural.** The **25 "no target row"** are baseline
edges whose **site the conversion removed**: a callback boundary that rule T-3 turns into an `await`,
or a chain step the extraction folded into its caller. There is no target row because there is no
target site, and the responses they produced are produced by the carriers that replaced them. The
**12 "new in the target"** are edges the conversion **introduces** — `legacyReply`, the extracted
cores, and the `.catch(function(){})` anchors above — so there is no baseline fact for R-e to hold
them to.

**Resolution, and one deliberate omission from the tooling.** All 20 are adjudicated equal, and the
`APPROVED_DEVIATIONS` list in `test/parity/error-edges.js` is left **empty**
(**read**: `const APPROVED_DEVIATIONS = Object.freeze([]);`). That is a decision, not an oversight:
entering these rows there would classify them as *approved changes*, and they are not changes at all
— they are rows that are **equal** and that a static comparator cannot resolve to equal. Mislabelling
them would also blunt the control, since the same list is what makes a genuine approved deviation
visible. **The empirical settlement is elsewhere and is where it belongs**: the corpus replay and the
joi matrix compare **real responses** on both trees, and it is those comparisons — not a static
inventory row — that would surface a wire-level difference if one of these twenty had produced it.

### 6.21 A model-layer bridge whose removal turned a preserved 200 into a process crash

**Ambiguous.** AAP §0.9.2 leaves an escape hatch for the four provisionally-excluded internal modules:
*"any module the suite implicates is converted, and the diff records which test forced it."*
`lib/models/model.js` was changed under that hatch — its callback/promise bridge looked like exactly
the sort of legacy shim the conversion removes — and the question was whether the hatch reaches it.

**Measured, and the answer is no: the bridge is load-bearing for a preserved baseline response.** The
mechanism runs through four facts, each of which holds in **both** trees:

1. `@hapi/boom` is imported into `lib/controllers/users.js` as **`errors`**, not `Boom`
   (`errors = require('@hapi/boom')`, line 2 of that file in both trees), so **every `Boom.*` call site
   in that module is an unbound identifier**. **Measured**: 16 lines match `Boom\.` in the delivered
   file — 15 call sites plus the comment that records this very fact — and 15 at `2f8712a`.
2. `reply(Boom.notFound(...))` **evaluates its argument first**, so the `ReferenceError` is thrown
   before `reply` is ever called.
3. The surrounding `catch` calls `Boom.internal(...)`, which throws the **same** `ReferenceError`
   again, so the handler's own error path cannot answer either.
4. At baseline that second escape lands in `lib/models/model.js`'s `.then(cb).catch(cb)` bridge
   (`promise.then(function(doc) { cb(null, doc); }).catch(cb)`, `lib/models/model.js:147` in both
   trees), which **re-invokes `cb` with the `ReferenceError` as its `err`** — so the handler's normal
   error branch runs, and the route answers `request.fail({error: err.message})`.

The observable result is a **200** carrying `{"error":"Boom is not defined"}`. That is not an
inference: the committed corpus's **recorded baseline** for `error-edge.not-found.missingExport` is
status **200**, `content-length` **42**, body `{"error":"Boom is not defined","flash":{}}`
(**artifact**: `test/parity/corpus.json`, that scenario's recorded step), and the delivered tree was
measured to answer the same thing after the revert below.

**Removing the bridge removes that answer and replaces it with a dead process.** With
`.then(cb).catch(cb)` gone, the `ReferenceError` has nowhere to land, the rejection is unhandled inside
the model's own promise, and the run **crashed — stranding 131 corpus scenarios** behind it. So the
change did not convert a shim; it converted a preserved 200 into an outage, which is both an R-d
violation and the loss of a third of the corpus in one step.

**Resolution: `lib/models/model.js` was reverted to its base-commit bytes and the escape hatch is
recorded as not reaching it.** **Measured**: `git diff 2f8712a -- lib/models/model.js` returns
**empty** in the delivered tree. The hatch's own condition is not met either — no test forces the
conversion, and §0.9.2 requires the diff to *name* the forcing test — so the module stays on the
provisional exclusion list with the other three
([§6.9](#69-whether-node-core-callback-conversions-should-be-filtered-by-warning-emission),
[§8](#8-what-remains-unproven)). The quirk this preserves is catalogued as an unbound-`Boom` edge in
`docs/error-edge-inventory.md`; what belongs here is the **method** point, and it is worth stating
plainly: a 2013-era bridge can be the only thing standing between a preserved response and a crash,
and the way that was discovered was by removing it and watching the corpus stop.

---

## 7. The two approved deviations

These are the **only** two places in the migration where something is deliberately **not** preserved or
**not** delivered as the request specified. Both are approved, both are argued, and neither is a
placeholder. [§7.5](#75-findings-declined-because-granting-them-would-create-a-third-deviation) is
the other side of that same fact: the findings asking for a **third** are recorded there, declined,
with what a human must do to change the answer.

**One numbering note about the sections below.** Two figures in them were taken before the
comparison the corpus row now records, and both are marked where they appear: a full
`npm run verify:corpus` classifying the deviation `approved-deviation` on **391 of 392** scenarios in
each of two cookie passes is the earlier measurement; the current one drives all **392** at the
recorded authority ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)) and
reaches the same classification. Neither run changes a decision, a target expression or a gate.

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
then 2 in all three. **Two divergences were found, one per deviation. The first is RESOLVED by
measurement on its baseline half and by one named, uncommitted run on its target half, and the second
is named rather than harmonised** — neither ever changed a decision, a version, a target expression or
a gate:

- **Deviation 1's evidence state — the divergence resolved, in favour of the companion documents.**
  `docs/preserved-quirks.md` §11.1 and `docs/deferred-dependencies.md` §4.1 both say, in the present
  tense, that the corpus **records** the baseline timeout and that the target answers. An earlier
  version of this section said the opposite and cited the artifact for it (`captured: false`,
  `baselinesPending: 383`, zero non-null baselines), and a later one could evidence the target half
  only on an uncommitted 8-scenario segment. **Both halves are now evidenced over the full corpus**:
  the committed artifact records `timedOut: true` for that scenario against the base commit, and a
  full `npm run verify:corpus` — 391 of 392 scenarios driven on both cookie passes — classifies it
  `approved-deviation` in each, its single differing field being
  `outcome: "timed-out" -> "answered"`, while the four header-resolved chains in the same run compare
  as matches. So the carrier sentences in both companion documents stand in the present tense they
  use, and what changed is that the comparison behind them is now a full-corpus measurement rather
  than a segment.
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

The decision is that **the target serves the stream response, and R-b controls**. The approved
response is a three-field contract — the status, the file's own content type and its byte count,
`h.response(<stream>).type(request.pre.file.mime).bytes(request.pre.file.size)` — with
`Content-Disposition` still omitted. **The delivered branch is exactly those three fields and nothing
else** — measured at the delivered head, `lib/controllers/files.js:369-397`, whose comment records the
decision rather than making a further one. An interim delivery made the branch **wider** than the
approved contract: it served a peeked stream and added `X-Content-Type-Options` and
`Content-Security-Policy`. Those additions were **withdrawn** with the rest of the unauthorized
security work, so the branch now matches the approved contract literally
(**measured**: 0 occurrences of `X-Content-Type-Options`, `Content-Security-Policy` or `peeked` in
`lib/controllers/files.js`), and the request to reinstate a header policy on this branch is recorded
as declined in [§7.5](#75-findings-declined-because-granting-them-would-create-a-third-deviation).
[`preserved-quirks.md`](preserved-quirks.md) §11.1 owns the contract itself. Three reasons, which
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

**The target side is measured on one run and absent from the other, and both statements are published
because they describe different artifacts.** On the **re-captured 8-scenario segment** of
[§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) — driven through the
delivered `capture.js` and `replay.js`, and **not committed** — the deviation materialized and was
verified field by field, in both cookie passes (**measured**, from that run's replay report):

```text
  quirk.reply-chain.never-settles.image-download  [non-secure pass]
  - approved by  AAP 0.7, under rule R-b
  - marker from  corpus
  - verified     yes - the change was checked field by field against what was approved
    the change, field by field:
      outcome: "timed-out" -> "answered"
```

That run's result record states the reason in the tool's own words — *"the scenario's declared baseline
expectation is no longer met, which is what the deviation changed: step 0 expected `timedOut=true` and
observed `timedOut=false`"* — with `failing: false` and `status: approved-deviation`, and the four
header-resolved chains in the same run compared as **matches**, so on that segment the deviation is
bounded to the branch it was approved for.

**The committed corpus records no target verdict, and that is by design rather than a gap.**
Of its 392 scenarios, **0 carry a `replayVerdict` and 0 carry a `targetResponse`** (**artifact**:
`test/parity/corpus.json`), because the corpus is a **baseline** artifact: `replay.js` writes its
verdicts to its own `--out` artifact and nothing writes them back. The field-by-field target
comparison therefore lives in the replay result, and it now exists — `npm run verify:corpus` drives
391 of the 392 scenarios on both cookie passes and classifies this one `approved-deviation` in each.
An earlier revision recorded this gate as **exiting 2** and refusing the artifact on its own stated
grounds — *no provenance block was found, so the artifact does not say which tree it measured and is
not parity evidence* — which the re-capture through the delivered generator resolved
([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). Three earlier versions of
this section each stated one half as though it were the whole: one said the deviation is verified, full
stop; one said it is not evidenced, full stop; and one bounded the evidence to an uncommitted
8-scenario segment. **The state now is that the deviation is argued, approved, marked, and verified
field by field over the full corpus**: `npm run verify:corpus` drives 391 of the 392 scenarios on both
cookie passes and classifies this one `approved-deviation` in each, its single differing field being
`outcome: "timed-out" -> "answered"`, with the four header-resolved chains in the same run comparing
as matches. The committed corpus still carries no target verdict, which is by design — verdicts live
in the replay's own artifact — so the evidence for this deviation is that replay result together with
the baseline recording, not a one-tree reading of the delivered code.

When a capture is driven, the mechanism that turns the annotation into evidence is the finite
per-step budget in
[§2.4](#24-every-case-has-a-finite-timeout-and-an-expected-timeout-is-a-result), which lets a
hang be **recorded** instead of ending the run: the baseline step records the timeout, the replay
records the 200 stream response, and the diff reports an **approved change** rather than a failure.
Two properties of that path are already delivered and inspectable, which is why the deviation control
is not vacuous — the marker exists and is unique, and because a capture **drops** it, it must be joined
back on with `--annotations` or the difference **fails**.

The one-tree reading referred to above is exactly that and is named rather than counted as a
comparison: the delivered code was read to confirm it does what the decision says — at the delivered
head that is `lib/controllers/files.js:369-397`, the three-field response and its comment.

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

**The remedy was taken and the shortfall is closed.** `archiver` moved **2.1.1 → 7.0.1** and the
warning has no source left; [§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)
carries the authorization and the measurements, and the same investigation found the same dependency
writing archives the application could not read. The zero-warning gate reports **0** lines across
every drive it has been run on — boot and a 15-route unauthenticated drive on the graph that preceded
the move, and the worker and storage gates re-driven on the delivered graph, the worker reporting 0
notices over 109 of 109 checks and the storage gate none over 35 of 35 cases. So this particular
warning class has no residual anywhere it was measured. What is closed is the `archiver` shortfall,
**not** the whole zero-warning gate: the 233-route five-identity pass has not been run at this head
and is carried as unproven by the register row and [§8](#8-what-remains-unproven)
([§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application)).

So the set of deviations is exactly the two in [§7.2](#72-deviation-2--the-marked-fork-is-retained)
and [§7.1](#71-deviation-1--the-never-settling-file-response). The `archiver` move is **not** a third
deviation from the request: a runtime warning and a demonstrated incompatibility are two of the four
reasons the triage rule already permits a dependency to change, and AAP §0.5.1.1's `archiver keep` row
was reasoned about advisories alone, so it does not bar a change made for the other reason. It **is**
a divergence from the Agent Action Plan's own instruction to retain `archiver` 2, and it is recorded
as such — with its precedence argument, and with the measurement showing that no narrower fix exists —
in [`deferred-dependencies.md` §2.6](deferred-dependencies.md). The move also leaves the audit figure
exactly where AAP §0.9.5 puts it: **0 critical / 1 high / 6 moderate**, the same seven advisories,
measured after the move ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)).

### 7.5 Findings declined because granting them would create a third deviation

Seven findings raised against this delivery ask for behaviour to be **added** — six of them security
behaviour, one a dead-binding tidy-up. **Six are declined** and the seventh, finding 11, was
**resolved by audit rather than declined**; each carries the citation it turns on and the action a
human has to take to change the answer. They are recorded here rather than in the quirk catalogue
because the question they raise is the *deviation* question this section owns: AAP §0.7 authorizes
**exactly two** deviations, [§7.1](#71-deviation-1--the-never-settling-file-response) and
[§7.2](#72-deviation-2--the-marked-fork-is-retained), so there is no third to grant from inside the
delivery.

**Declining is not disagreeing.** The security items describe real exposure and are worth acting on;
what this record says is that acting on them is not this migration's decision to take. The grounds
are stated per finding rather than once, because they are not the same grounds:

| # | What was asked for | Site, measured | Declined on | What a human must do |
|---|---|---|---|---|
| **50** | Require `auth: 'session'` and an ownership check on `PUT /api/trinkets/{trinketId}/metrics`, which is anonymously writable | `config/api_routes.js:948` — **byte-identical to `2f8712a` at the same line** | **R-d** (behaviour "improvements" PROHIBITED) and **AAP §0.9.1**, which compares the 233-entry manifest per entry **including effective auth**: adding `auth: 'session'` moves that entry and fails the primary parity gate by construction | Amend the AAP to authorize the auth change, then implement it with its own **parity re-baseline** — the manifest's baseline side has to be re-declared, because the surface it pins is what changes |
| **51** | Gate `GET /api/trinkets/{trinketId}/interactions` behind ownership; it is anonymously readable and the payload carries IP, referrer, actor and owner | `config/api_routes.js:1018` — **byte-identical to `2f8712a` at the same line**; its only prerequisite is `pre : ['trinket(params.trinketId)']` in both trees | Same pair as 50. The PII exposure is real and pre-existing; **AAP §0.2.2** additionally makes the route surface an invariant, so neither the auth nor a payload projection can be introduced here | As 50, and the amendment has to say which of the two remedies is wanted — refusing the request, or narrowing the projection — because they are different response contracts |
| **52** | Require a configured secret for `setThumbnail` and compare it with `crypto.timingSafeEqual` instead of `!==` | `lib/controllers/files.js:409`, against `config/default.yaml:421` `secret: ''` — the comparison is baseline (`2f8712a:lib/controllers/files.js:109`) and the empty committed secret is baseline configuration | **R-d**, and **R-a**, whose four categories are runtime bump, hapi API migration, async conversion and blocking-only dependency swaps — a crypto-comparison change is in none of them. **AAP §0.2.2** also declares `config/default.yaml` unchanged, so the "require a secret" half cannot be delivered from here at all | Amend the AAP to authorize both halves, and supply the secret through deployment configuration; then implement with a corpus case for the refusal path, which is a new response this tree does not produce |
| **53** | Add and verify a `state` (or nonce) on the Google OAuth flow | `lib/controllers/auth.js`, the `googleCallback` flow — no `state` parameter at baseline and none in the delivered tree | **R-d** and **R-a**. It is also a **cross-boundary** change: the authorization URL, the callback validation and the session all move together, and the HTTP fixture that records the provider's responses ([§2.5](#25-the-isolation-architecture--interception-at-the-module-boundary)) would have to record a new one | Amend the AAP, then implement across the redirect and the callback together, with new fixture recordings and its own re-baseline. The measured OAuth quirks in [§6](#6-the-r-f-resolution-log) must be preserved through it, including the new-user branch that saves and then reports failure |
| **54** | Add `Content-Disposition: attachment`, or a strict `Content-Type`/CSP, to the approved image-download deviation, and record the consequence analysis | The deviation itself, `lib/controllers/files.js:369-397` | **The AAP's own stated target line**, which says the image branch serves the sibling's response "minus the `Content-Disposition` header the image branch deliberately omits". Granting this finding would contradict the text that authorizes the deviation, and the omission **is** the branch: it renders an image inline rather than downloading it. **AAP §0.7** authorizes two deviations, and widening one of them into a header policy is a third change wearing the second one's authorization | Amend the AAP's §0.7 target line, then widen the branch and re-baseline the one scenario that covers it (`quirk.reply-chain.never-settles.image-download`), whose `targetExpectation` currently asserts `headerAbsent: content-disposition` and would have to be rewritten |
| **11** | Reset the session id on registration as well as on login | Not declined — **resolved by audit-and-preserve**. `request.yar.reset()` in `login` **is baseline** (`2f8712a:lib/controllers/users.js:153`) and stayed, and the delivered tree carries exactly the same two resets baseline carries, in `login` and `logout` (**measured**: 2 occurrences in each tree). The reset an interim delivery **added** was in `remove`, and it is **gone** | R-d, for the added one: introducing a reset where baseline has none changes session state on a path a client observes | Amend the AAP if a registration-time reset is wanted. It is a one-line change and a real hardening, but it is a behaviour change on the registration response's session, so it needs the amendment and a corpus re-baseline for the registration scenarios |
| **19** | Remove the unused `crypto`, `url` and `HAS_EXT` bindings from `lib/util/routeParser.js` | `lib/util/routeParser.js:9`, `:13`, `:15` — all three present and unused **in both trees** (**measured** against `git show 2f8712a:lib/util/routeParser.js`, where the same three sit on the same lines) | The file's own **AAP brief**, whose Phase 5 explicitly forbids removing these three bindings. **T-2** independently authorizes only three categories of change inside this file, and a dead-binding tidy-up is in none of them | Nothing, unless the brief is amended. The finding is correct that they are dead; it is the removal, not the observation, that is out of scope |

**Why this table is in a parity document at all.** Every row is a place where the *right* engineering
answer and the *authorized* one differ, and R-f makes this file the register of exactly that kind of
decision: the measurement is recorded, the rule that decides it is cited, and the outcome is stated
without softening either half. A reader who wants any of these seven implemented now knows precisely
what has to change first, and none of them is left to be rediscovered by the next reader of the code.

---

## 8. What remains unproven

Recording this honestly is part of the deliverable. Everything the migration *decided* is decided;
what follows is **unproven rather than undecided**, and each row names the gate that settles it.

Items that stood in this table in the earlier record have been **closed by measurement in this
delivery** and now live in the register instead: the storage and archive contract (**35 of 35 cases,
exit 0**, the `archive-layout` case included), the joi comparison on both sides (0 schema-level and 0
generated-input differences across 462 outcomes; the residual outside that question is attributed in
[§6.6](#66-native-hapi-validation-is-unreachable-here)), the audit figure (re-run rather than cited, 0 critical / 1 high / 6 moderate), the
clean-tree asset build together with the root container image and the stylesheets served from it, the
`bull` 4 and `mime` 4 runtime semantics (**`VERDICT PASS`, 109 of 109 worker checks over 7 real jobs,
0 notices, exit 0**), and the corpus's **baseline** half (391 of 392 recorded). They are named here,
and the rows that closed are marked in place, so a reader comparing the two versions of this table can
see that the rows left rather than being quietly dropped.

| Open item | Why it is unproven | Gate that settles it |
|---|---|---|
| **The request corpus replay** — identical normalized responses across the 233-route inventory | **The comparison is measured; the gate is not met, and the reason is a baseline defect.** The baseline side is captured through the delivered generator — 391 of 392 scenarios carry a recorded response, 233 of 233 routes are represented, and the embedded provenance verifies — and the replay runs: driven at the corpus's own recorded authority `127.0.0.1:20530`, the target answers **all 392 scenarios with no application death**, and the residual reduces to **~11 scenarios, every one attributed** — the approved deviation, the rows whose *baseline* side is a dead socket, and one asset route the baseline could not serve because its capture ran without built CSS ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). **What is not proven is the secure half, and it cannot be captured from `2f8712a`**: AAP §0.9.3 requires a `--secure-corpus` capture against a `--secure` server, and the baseline application crashes mid-capture — `Error: Cannot wrap an error` from `request.fail` at `lib/util/routeParser.js:510`, reached from `lib/controllers/admin.js:160` — which an independent recapture attempt reproduced, dying at case 276 of 392. The replay reports the shortfall itself as `NOT A GATE RUN: measured-secure-pass`. Two earlier revisions are superseded: one recorded **367 match / 23 differ** non-secure and **355 / 35** secure, taken before the security remediations were reverted, and one recorded the comparison as unproven because `replay.js` refused an artifact whose provenance named an unretrievable generator | A secure-side capture, which needs the baseline crash fixed or worked around first — it is the one gate in this table whose blocker is in the **baseline** rather than in this delivery |
| **The zero-warning gate over the route surface** | Four named drives are clean — boot and a 15-route drive on the 410-package graph that preceded the archive-dependency move, and `verify:worker` (0 notices with 0 allowed over 109 of 109 checks) and `verify:storage` (none across 35 of 35 cases) re-driven on the delivered graph at `archiver` 7.0.1 ([§6.11](#611-zero-deprecation-warnings-across-the-entire-running-application)). What is unproven is the drive the request's wording reaches furthest into: the **233-route, five-identity** pass. Its only recorded run **failed** this very check in both cookie passes — `gates.failedChecks` naming `non-secure: zero warnings from the application` and `secure: zero warnings from the application`, with `4 warning line(s) on the application's stderr` for the self-consistency drive and `1 warning line(s)` against the migrated tree — at `verification.applicationHead.recorded = 0716cd2811…`, **before** the archive-dependency move that removed the one module-load source those lines are attributable to, and it has not been re-driven since (**artifact**: `test/parity/corpus.json.provenance.json`). The 233-route two-identity sweep recorded in §6.11 was measured earlier in this delivery and was not re-driven on the delivered graph either | `replay.js --annotations` under `--pending-deprecation --trace-deprecation` over the full surface, with the `zero warnings from the application` check reported clean in **both** cookie passes — which needs the secure-side capture in [§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries) for the second pass |
| **The existing suite** | **Measured 130 registered / 129 executed / 95 passing / 36 failing**, with registered = executed = passing = 130 asserted by the run itself (`EXPECTED_CASES = 130`) and negative-tested in both directions. 130 = the 124 `it()` bodies present at `2f8712a` — 123 active plus the disabled download case, now active with its assertions byte-identical — plus the 6 new page-surface cases. **No case carries a changed expectation**: 0 assertion lines differ from `2f8712a`, and the single recorded exception is the fence removal that re-enables the 124th body ([§6.2.1](#621-the-baseline-correction-exception-register)). An earlier revision of this row claimed eighteen changed cases and 29 assertion lines replaced by 33, which the tree contradicts. The 36 failures are 27 base-commit expectations byte-identical production code has never satisfied, plus 9 failing and 1 unexecuted case behind one frozen request value. An earlier revision recorded 234 passing against a gate asserting 234, counting the `email-compat` and `diff-compat` suites this delivery removed | **Not met on the passing count**; met on the assertion contract |
| **The private-field cookie patch on hapi 21** | It mutates a private field and its failure mode is **silence** ([§4.3](#43-why-the-cookie-expires-assertion-exists)). The 233-route sweep did not assert cookie attributes | The cookie-attribute comparison in **both** overlay passes, including the presence and whole-day horizon of `Expires` |
| **The secure cookie pass** | **No secure-side baseline exists, and none can be captured from `2f8712a`.** An earlier revision recorded one — `test/parity/corpus.secure.json`, 382 of 383 scenarios — and it was removed as a path outside the authorized file set; the `--secure-corpus` argument that reads it **is** in the delivered `replay.js`, so the flag is not what is missing. What is missing is a capture, and the baseline crash above blocks taking one ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). So the secure pass **derives** its expected cookie attributes from the non-secure recording, which the tool reports as non-qualifying in its own words — `NOT A GATE RUN: measured-secure-pass` — rather than presenting as a measurement. Measured consequence, when that derived pass was last driven: the same differences as the non-secure pass plus **12** of a single shape — `header.set-cookie.count`, `cookies.count` and `cookie[session].present` each moving 1 → 0 — which is the derivation, not behaviour | Capture a corpus against a `--secure` server and pass `--secure-corpus "$CORPUS_SECURE"`, which requires the baseline crash to be fixed or routed around first |
| **`joi` 18.2.5 parity across the 102 targets — closed on the comparison** | Both sides are measured. The baseline is the sealed capture at 17.13.3 ([§6.6](#66-native-hapi-validation-is-unreachable-here)) and `npm run verify:joi` compares 102 targets, 306 cases, 462 outcomes and 15 678 fields against it on the delivered tree with **0 schema-level differences** and **0 generated-input differences** — the parity question this row asks, answered. Differences outside it, in the `http` and `summary` scopes, are attributed to the baseline crash in [§6.6](#66-native-hapi-validation-is-unreachable-here) and are not validation verdicts. Its **exit status** is tracked separately and is not re-measured at this state ([§5](#5-the-gate-register-and-what-each-gate-proves)): it was 0 with `gate PASSED` before the security remediations, 1 on 60 non-verdict differences after them, and the command has not been re-driven since they were reverted | **Met on parity**; the command's exit status not re-measured |
| **`bull` 4 and `mime` 4 runtime semantics — closed** | Neither rests on an API-surface check. `npm run verify:worker` drives **7** real jobs through Bull 4.16.5 and **exits 0 with `VERDICT PASS` over 109 of 109 named checks and 0 notices** under `--pending-deprecation --trace-deprecation`. The `bull` 4 adaptations this row is about hold — a real Bull queue exposing the Bull 4 surface, namespaced per run, with the `job.id` rename, the `failed` payload shape and `job.remove()` on `completed` all exercised — and so does the export the jobs exist to complete, including the status and progress persistence, the archive layout, the `s3Key` and download URL, the notification mail and cleanup on both paths. Two earlier revisions are superseded: one recorded `VERDICT PASS` before it was true, and one recorded a FAIL verdict with 17 of the 109 checks failing — 16 of them following from a successful job that never completed, and the seventeenth the retained-`archiver` notice. Both causes are gone at their source ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)). The `mime` 4 call sites are asserted by the suite's 13 explicit mapping cases and its mismatched-metadata classifier outcomes | Met |
| **`adm-zip` 0.6 archive-read semantics** | **Now proven for the write-then-read path**: with `archiver` at 7.0.1 ([§6.16](#616-a-retained-dependency-emitted-a-deprecation-warning--and-was-found-to-be-writing-invalid-archives)) every entry declares a correct crc32 and length and `getData()` round-trips byte-exactly, measured on a five-entry fixture at both compression levels and end to end through `POST /api/trinkets/download`. What remains unproven is reading **pre-migration** objects, which is the row below | `test/parity/storage.js` against pre-migration objects |
| **Storage parity of seeded content — partially closed** | The storage gate now runs, and its `pre-migration-lookup`, `pre-migration-digest-drift` and `pre-migration-rekey-orphans` cases pass against seeded pre-migration records, so the sha1-key contract is asserted rather than assumed. What is still open is breadth rather than existence: the seeded corpus is representative, not exhaustive, and the failure mode remains invisible on freshly written data because a write-then-read round trip passes under any digest | `test/parity/storage.js` against **pre-migration** objects, asserting the exact sha1 key |
| **The four internal callback modules** | Excluded from conversion on the **warning** test alone; the request's second test — the existing suite passing unmodified — cannot be evidenced until the suite is green ([§6.9](#69-whether-node-core-callback-conversions-should-be-filtered-by-warning-emission)). One of the four, `lib/models/model.js`, was converted under §0.9.2's escape hatch in this pass and **reverted to its base-commit bytes**, because its callback/promise bridge is what makes a preserved baseline 200 possible and removing it crashed the run — the mechanism, the artifact evidence and the revert are in [§6.21](#621-a-model-layer-bridge-whose-removal-turned-a-preserved-200-into-a-process-crash). So `lib/util/file.js`, `lib/util/store.js` and `lib/models/model.js` are byte-identical to `2f8712a` in the delivered tree (**measured**: `git diff 2f8712a HEAD --` over the three returns empty), and `lib/util/queues.js` carries only the Bull 4 surface AAP §0.4.1 authorizes by name — the conversion of its `handler(job, done)` interface is not among the changes | The repaired suite passing with those four modules unmodified. Any module the suite implicates is converted, and the diff records which test forced it — and §6.21 is the record of one that the hatch does **not** reach |
| **The audit figure — closed** | Re-measured on the delivered tree rather than cited: `npm audit --omit=dev --json` reports **0 critical, 1 high, 6 moderate**, the high being direct `marked` (the approved deviation) and the six moderates `aws-sdk`, `bull`, `highlight.js`, `jszip`, `mongoose` and transitive `uuid`. That is AAP §0.9.5's stated figure exactly, and it identifies `mongoose` as the sixth moderate the earlier record could not account for | Met |
| **Review coverage of the delivered tree** | Three **dedicated finals** ran at full required depth and each reported **NOT APPROVED**: COMPLETENESS with **40** findings, RULES with **34** and COMMENTS with **24** — **98** in total. Their remediations are in this tree and this report supersedes their verdicts, but a superseding report is not a re-run: the three finals have not been re-driven against the tree that now exists. Separately, commit **`7028607`** changed **131 paths** (**measured**: `git show --stat 7028607`) and **was never reviewed** by any of them, and the revert commit after it changed more. This is recorded as an outstanding **review-coverage** gap rather than as something this pass closes | Re-run the COMPLETENESS, RULES and COMMENTS finals against the delivered head, with `7028607` and everything after it inside their scope |

Three things are worth saying about the shape of this table rather than its rows.

**One row is not about this migration's behaviour at all, and it is here because it is unproven in
exactly the same sense.** The review-coverage row records that the three dedicated finals reported 98
findings between them and that a 131-path commit went through unreviewed. Nothing in this file, and no
gate in [§5](#5-the-gate-register-and-what-each-gate-proves), can discharge that: a parity gate
measures the tree against `2f8712a`, and a review measures it against the AAP and the rules. Both are
required and only one of them is evidenced here, so the row names the other rather than letting a
clean gate register imply it.

**The first row dominates the rest, and its blocker is not in this delivery.** Most of the PRESERVE
clauses in [§5.1](#51-each-preserve-clause-bound-to-the-gate-that-proves-it) bind to the corpus, so
closing it converts a majority of this table at once. The tooling, the definitions, the fixtures, the
seeds, the overlay, the coverage accounting, the recorded non-secure baseline **and the replay itself**
are all delivered and inspectable: the replay drives all 392 scenarios at the recorded authority and
attributes every residual. What is missing is the **secure-side capture**, and it cannot be taken from
`2f8712a` while the baseline application crashes mid-corpus — reproduced independently here, with the
signature and the discarded attempt in
[§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries). So the distance from here
to that gate is one capture **plus a way past a baseline defect**, and saying otherwise would put the
shortfall on the wrong tree.

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
| `test/parity/joi-baseline.json` | The captured baseline validation outcomes for all 102 targets, and the tree they were measured on. Its provenance is **sealed in a sidecar** rather than embedded ([§1.4](#14-tool-provenance-per-artifact)), which is the shape its one consumer verifies: `joi-matrix --compare` **accepts** it, reporting `verified against its sidecar: role baseline-capture, joi 17.13.3, app HEAD 2f8712a112db, digest matched` before it compares |
| `test/parity/replay.js` | The executable comparison contract — the volatile set, the comparators and the coverage gate |

Machine-readable artifacts are **referenced, not restated**: `corpus.json` and `joi-baseline.json` are
the record, and this file is its human-readable companion. Read either together with the provenance
that covers it — an artifact whose provenance cannot be read does not say which tree it measured and is
not parity evidence.

**The requirement is per tool, not per repository, and the two tools here differ — which is what an
earlier version of this section conflated into one claim about the wrong artifact.** `replay.js`
requires an **embedded** `provenance` key and refuses a corpus that carries none rather than comparing
against it, which is why `verify:corpus` exited **2** on the committed `corpus.json` for most of this
delivery — a refusal the re-capture through the delivered generator resolved, after which the same
command replays rather than refusing
([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). `joi-matrix.js
--compare` verifies its baseline against **the sealed sidecar** and accepts it, in its own preflight,
which is why its preflight passes ([§1.4](#14-tool-provenance-per-artifact)). So "refuses it" was
true of the corpus before the re-capture and has never been true of the joi baseline; a statement that
the joi baseline is refused for want of an embedded block described a rule its consumer does not
apply.

**Applied to what is actually committed, that rule now admits both artifacts, and one of them with a
stated precondition.** `joi-baseline.json` has its sealed sidecar and is a captured measurement.
`corpus.json` has a sidecar too, and 391 of its 392 scenarios carry a recorded response, so it is a
**measurement** rather than a definition set — every reference to it in this file is worded that way.
It now carries the embedded block the delivered `replay.js` requires as well, so the artifact is
evidence about `2f8712a` **and** joinable to this tree, and `verify:corpus` replays it rather than
refusing it. What still bounds it is not provenance but **completeness of the baseline side**: one
scenario is `unreachableByDesign`, seven steps record a transport failure against a baseline
application that died mid-capture, and no **secure**-side capture exists at all, because the same
crash blocks it ([§2.8](#28-capture-status-and-the-one-precondition-the-replay-gate-carries)). Two
earlier versions of this paragraph are superseded: one said the corpus had no sidecar and no captured
response — it has both — and one said the tool still refuses it, which the re-capture resolved. The
corrections are recorded rather than quietly applied, because the earlier wording is what the rest of
this document was written against.

One note, recorded rather than acted on: `mkdocs.yml`'s `nav:` lists only `index.md`, `setup.md` and
`overview.md`, so this document is not part of the rendered documentation site. Changing that
navigation is outside the scope of this work and **`mkdocs.yml` is not modified**.
