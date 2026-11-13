# Evidence recovery — Track B, Sprint 3A

Conclusion: **IRRECOVERABLE FROM AVAILABLE SOURCES**.

The bundle is a thin v2 pack. Eight non-delta objects inflate. Sixteen deltas do not, because their bases are the two prerequisite commits (and the trees those commits point at). Those parents are not in the bundle, not in `/workspace` (there is no `.git`), and not on GitHub. They were not synthesized. Retired Sprint 1 / Sprint 2 records and the opening-range negative-cost control must stay as they are. No performance figures were reconstructed.

## Sources inspected

- `/workspace` is not a git repository. `git rev-parse --is-inside-work-tree` returns `fatal: not a git repository (or any of the parent directories): .git`. There is no `/workspace/.git`.
- Bundle: `/workspace/attachments/apex-update-20.bundle` (9464 bytes). Pack payload begins at offset 538, is 8926 bytes, and SHA-256 is `88d701a374ea996406cc818db6248b77ef37237880a3f07d8a904c6cd216eef6`. Header version 2, object count 24.
- Prior note: `/workspace/research/prior/RECOVERY.md` (local text; not itself a bundle object). Intact files named there were checked with `git hash-object` against recovered blobs.
- Leftover object dirs (not deleted): `/tmp/apex-obj` (8 loose objects, no refs), `/tmp/apex-extract` (the same 8, empty `refs/heads` and `refs/tags`), `/tmp/apex-prior` (empty), `/tmp/apex-prior2` (empty git dir, 0 objects), `/tmp/apex-b` (empty git dir, 0 objects), `/tmp/apex-bundle` (empty). `/tmp/apex.pack` is a byte-for-byte copy of the bundle pack (8926 bytes, equal to the payload above).
- Fresh experiment (under `/tmp` only): `/tmp/apex-trackb-unpack` and `/tmp/apex-trackb-unpack2`. Git 2.39.5.
- GitHub commit search (HTML) and `https://api.github.com/search/commits` for the three full SHAs and for unique subject phrases. Sourcegraph returned a JavaScript shell with no result list. GitLab search returned HTTP 403 then 302. grep.app returned a Vercel checkpoint page, not a result set.

## Bundle header and refs

Exact header text:

```
# v2 git bundle
-25e4431b72f3bfa963c00d57c4b0ed75713d1163 S1 stopped before validation: not live-feasible on free data; negative dev and replication
-1c0d932a6236bdec604e4747f952709478903ce4 Operational paper trading at the operator's request: configs/paper_operational.yaml (forward_test, four sprint-1 strategies; identical to default otherwise, tested), config-aware start script, Windows schedule in docs; orders tagged forward_test, not evidence; real money stays disabled
1a918694d7933b56ec1510b50396a7dd098360dd refs/heads/master
```

`git bundle list-heads /workspace/attachments/apex-update-20.bundle` prints only:

```
1a918694d7933b56ec1510b50396a7dd098360dd refs/heads/master
```

Lines that start with `-` are prerequisites. They are not tips and they are not objects in the pack.

## Commands and exact errors

Outside a repository:

```
$ git bundle verify /workspace/attachments/apex-update-20.bundle
error: need a repository to verify a bundle
```

Empty repo (`git init` under `/tmp/apex-trackb-unpack/fresh`):

```
$ git bundle verify /workspace/attachments/apex-update-20.bundle
error: Repository lacks these prerequisite commits:
error: 25e4431b72f3bfa963c00d57c4b0ed75713d1163
error: 1c0d932a6236bdec604e4747f952709478903ce4
```

Clone:

```
$ git clone /workspace/attachments/apex-update-20.bundle cloned
Cloning into 'cloned'...
error: Repository lacks these prerequisite commits:
error: 25e4431b72f3bfa963c00d57c4b0ed75713d1163
error: 1c0d932a6236bdec604e4747f952709478903ce4
fatal: remote transport reported error
```

`git bundle unbundle` into an empty repo exits 1 with the same two `error: Repository lacks these prerequisite commits:` lines and writes no objects.

`git fetch <bundle> refs/heads/master:refs/heads/master` (and `refs/heads/*:refs/heads/*`) into an empty repo that already has `master` checked out:

```
fatal: refusing to fetch into branch 'refs/heads/master' checked out at '/tmp/apex-trackb-unpack/fetchrepo'
```

Raw pack (`PACK` through EOF), no bases:

```
$ git index-pack --fix-thin --stdin < pack.bin
fatal: pack has 16 unresolved deltas
```

`git index-pack -v pack.bin` (name not ending in `.pack`):

```
fatal: packfile name '/tmp/apex-trackb-unpack2/pack.bin' does not end with '.pack'
```

`git index-pack --fix-thin apex.pack` (file, not stdin):

```
fatal: the option '--fix-thin' requires '--stdin'
```

Non-delta objects can still be inflated:

```
$ git unpack-objects < pack.bin
fatal: unresolved deltas left after unpacking
```

Exit 128. The same fatal line is printed with `-r`. Eight loose objects are left behind (listed below). `git unpack-objects -v` is not a valid flag (`usage: git unpack-objects [-n] [-q] [-r] [--strict]`, exit 129) and writes nothing.

After `git update-ref refs/heads/master 1a918694d7933b56ec1510b50396a7dd098360dd` in the experiment repo only, `git fsck --full` (exit 2):

```
broken link from  commit 1a918694d7933b56ec1510b50396a7dd098360dd
              to    tree c55aaec51e40637c7ae23dff128c5b2f1aa6c996
broken link from  commit 7b0bbe47c98995a1b3a42be1efdc7ce6c6c77900
              to    tree 237d563cb5deca2a98b1ac6106dd6173f5c20eed
broken link from  commit 7b0bbe47c98995a1b3a42be1efdc7ce6c6c77900
              to  commit 25e4431b72f3bfa963c00d57c4b0ed75713d1163
broken link from  commit 6e7143ecbbccab9b403acb3283ede3b6a42fbc00
              to    tree 50d1577e2f27ea8c1ccd8bf0193b3bd5c593f5e7
broken link from  commit 6e7143ecbbccab9b403acb3283ede3b6a42fbc00
              to  commit 1c0d932a6236bdec604e4747f952709478903ce4
missing tree 237d563cb5deca2a98b1ac6106dd6173f5c20eed
missing tree c55aaec51e40637c7ae23dff128c5b2f1aa6c996
missing commit 25e4431b72f3bfa963c00d57c4b0ed75713d1163
missing tree 50d1577e2f27ea8c1ccd8bf0193b3bd5c593f5e7
missing commit 1c0d932a6236bdec604e4747f952709478903ce4
```

`git log -1` on the two older recovered commits cannot walk:

```
error: Could not read 1c0d932a6236bdec604e4747f952709478903ce4
fatal: Failed to traverse parents of commit 6e7143ecbbccab9b403acb3283ede3b6a42fbc00
error: Could not read 25e4431b72f3bfa963c00d57c4b0ed75713d1163
fatal: Failed to traverse parents of commit 7b0bbe47c98995a1b3a42be1efdc7ce6c6c77900
```

`git cat-file -t` on each missing SHA:

```
fatal: git cat-file: could not get object info
```

## SHAs verified

| SHA | Role | `git cat-file -t` |
| --- | --- | --- |
| `25e4431b72f3bfa963c00d57c4b0ed75713d1163` | Bundle prerequisite. Header subject: S1 stopped before validation: not live-feasible on free data; negative dev and replication. Second parent of `7b0bbe4`. | missing |
| `1c0d932a6236bdec604e4747f952709478903ce4` | Bundle prerequisite. Header subject begins: Operational paper trading at the operator's request… orders tagged forward_test, not evidence; real money stays disabled. Parent of `6e7143e`. | missing |
| `1a918694d7933b56ec1510b50396a7dd098360dd` | Only advertised ref: `refs/heads/master`. | `commit` |
| `7b0bbe47c98995a1b3a42be1efdc7ce6c6c77900` | Parent of `1a91869`. | `commit` |
| `6e7143ecbbccab9b403acb3283ede3b6a42fbc00` | First parent of `7b0bbe4`. | `commit` |
| `4c44b35324a825a603d94abe60cfdef4c073f395` | Orphan tree, not the tree of any recovered commit. | `tree` |
| `b866555a0defd6ff8ad0e65b390d329c22157518` | Blob, 4367 bytes. | `blob` |
| `3a2598cf0d28b2214fdc8fd2e60140073cb379a0` | Blob, 2228 bytes. | `blob` |
| `c9f31cd648dbb7ac75b10b05cdaa58ce45c94540` | Blob, 1960 bytes. | `blob` |
| `f13bad7751c7f9426a978d24896aa00abb947b2b` | Blob, 357 bytes. | `blob` |

`git cat-file -t` proof was taken in `/tmp/apex-obj` and again in `/tmp/apex-trackb-unpack2/repo` after `git unpack-objects`. Both stores have the same eight objects.

## Objects that exist

Recovered commits (subjects are the first line of `git cat-file -p`; author is `Claude <noreply@anthropic.com>`, offset `-0500`):

- `6e7143ecbbccab9b403acb3283ede3b6a42fbc00` — 2026-11-11 16:36:10 -0500. Subject: `Scheduled runs survive Windows stopping wsl.exe: detach.sh runs the job in its own Linux session and waits; nightly and scheduled paper start use it; unbuffered logs; task settings allow battery and no idle stop`. Tree `50d1577e2f27ea8c1ccd8bf0193b3bd5c593f5e7` missing. Parent `1c0d932a6236bdec604e4747f952709478903ce4` missing.
- `7b0bbe47c98995a1b3a42be1efdc7ce6c6c77900` — 2026-11-11 20:52:37 -0500. Subject: `Merge ASUS: S1 stopped, S2 holdout results`. Tree `237d563cb5deca2a98b1ac6106dd6173f5c20eed` missing. Parents: `6e7143ecbbccab9b403acb3283ede3b6a42fbc00` (present) and `25e4431b72f3bfa963c00d57c4b0ed75713d1163` (missing).
- `1a918694d7933b56ec1510b50396a7dd098360dd` — 2026-11-11 20:57:29 -0500. Subject: `Phone alerts (ntfy or Telegram, best-effort): nightly outcome, paper CRITICAL events, end-of-day summary; apex alerts test. Sprint 3 DRAFT protocol (not frozen): ETF trend following and SPY/QQQ overnight drift, DSR in the gate, open data questions`. Tree `c55aaec51e40637c7ae23dff128c5b2f1aa6c996` missing. Parent `7b0bbe47c98995a1b3a42be1efdc7ce6c6c77900` (present).

The only recovered tree is `4c44b35324a825a603d94abe60cfdef4c073f395`. `git ls-tree -r` shows one entry: `100644 blob b866555a0defd6ff8ad0e65b390d329c22157518 DRAFT_PROTOCOL.md`. It is not referenced by any recovered commit (those trees are the three missing SHAs above). `git fsck` reports it as a dangling tree.

Blob bytes match the four files already filed under `/workspace/research/prior` (`git hash-object` from `/tmp/apex-obj`):

- `alerts.py` → `3a2598cf0d28b2214fdc8fd2e60140073cb379a0`
- `detach.sh` → `f13bad7751c7f9426a978d24896aa00abb947b2b`
- `DRAFT_PROTOCOL.md` → `b866555a0defd6ff8ad0e65b390d329c22157518`
- `test_alerts_recovered.py` → `c9f31cd648dbb7ac75b10b05cdaa58ce45c94540`

No recovered tree entry names `alerts.py`, `detach.sh`, or the test file. Those paths are the names already used in `research/prior`, not a checkout of `master`. `RECOVERY.md` hashes to `52e2ff4e2e8a9aa718491124d82cc1650be4b644`, which is not in the pack.

`/tmp/apex-obj` has the eight objects and no `refs/`. Its `HEAD` is `ref: refs/heads/master`, and `git fsck` there (without a ref update) says `notice: HEAD points to an unborn branch (master)` and `notice: No default references`.

## What is missing

- Prerequisite commits `25e4431b72f3bfa963c00d57c4b0ed75713d1163` and `1c0d932a6236bdec604e4747f952709478903ce4`, and therefore every ancestor behind them.
- Trees of the three recovered commits: `50d1577e2f27ea8c1ccd8bf0193b3bd5c593f5e7`, `237d563cb5deca2a98b1ac6106dd6173f5c20eed`, `c55aaec51e40637c7ae23dff128c5b2f1aa6c996`.
- The other 16 of 24 pack objects (unresolved deltas). Their contents were not inflated and were not invented.
- Strategy implementations and numeric Sprint 1 / Sprint 2 results. The merge subject names S2 holdout results; the tree that would hold them is missing. Nothing was filled in.

## External search

GitHub commit search, no login wall, zero hits:

- `https://github.com/search?q=25e4431b72f3bfa963c00d57c4b0ed75713d1163&type=commits` — “Commits 0”, “Your search did not match any commits”.
- Same empty state for `1c0d932a6236bdec604e4747f952709478903ce4` and `1a918694d7933b56ec1510b50396a7dd098360dd`.
- Phrase searches with the same empty state: `"S1 stopped before validation"`, `"negative dev and replication"`, `"Scheduled runs survive Windows stopping wsl.exe"`, `"Merge ASUS: S1 stopped"`, `"Phone alerts (ntfy or Telegram, best-effort)"`.

GitHub API `GET /search/commits` with `Accept: application/vnd.github+json` (before a later 403 rate limit):

- `q=hash:25e4431b72f3bfa963c00d57c4b0ed75713d1163` → `{"total_count":0,"incomplete_results":false,"items":[]}`
- `q=hash:1c0d932a6236bdec604e4747f952709478903ce4` → `total_count` 0, `incomplete_results` false, `items` empty
- `q=hash:1a918694d7933b56ec1510b50396a7dd098360dd` → `total_count` 0, `incomplete_results` false, `items` empty
- Quoted `S1 stopped before validation: not live-feasible on free data; negative dev and replication` → `total_count` 0
- Quoted `Operational paper trading at the operator's request` → `total_count` 0
- Quoted `orders tagged forward_test, not evidence` → `total_count` 0
- Quoted `Scheduled runs survive Windows stopping wsl.exe` → `total_count` 0, `incomplete_results` true (no items returned)
- Quoted `real money stays disabled` → `total_count` 1, `incomplete_results` true. The only returned SHA is `e19c09d2c055f119df0cec355df2d10610056954`, subject `fix(server): allow prod infra startup with sandbox/test payment providers + guardrail tests`. It is not one of the three SHAs.

Code search on GitHub for `"orders tagged forward_test"` shows a sign-in wall (“Sign in to search code on GitHub”) and no public hits. A later API batch for the remaining phrases returned HTTP 403 (rate limit), not matches. Sourcegraph’s HTML shell contains the query string and the text “You need to enable JavaScript to run this app”; it does not list a repository. No public object for these SHAs was found.

## What stays as it is

Retired Sprint 1 / Sprint 2 records stay retired. The opening-range negative-cost control stays as it is. This note does not add, edit, or recompute those records, and it does not check out or rewrite the bundle. Partial alert and draft-protocol blobs that already match `research/prior` are evidence of text that survived, not of a live-feasible strategy and not of a complete history.

## Conclusion

IRRECOVERABLE FROM AVAILABLE SOURCES
