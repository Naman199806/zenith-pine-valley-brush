# Licensing recommendation: freqtrade and backtrader

Track E, Apex Quant X Sprint 3A, with a 2026-11-12 execution addendum. Engineering note only. Not legal advice.

**Addendum, 2026-11-12, later:** Freqtrade 2026.10 was installed in a Python 3.12.15 venv and ran `backtesting` on a synthetic 5-minute feather (`dry_run` true, empty exchange keys, stake USD, Kraken pair name, no download). The process reported 1 trade and about 2.005 USD on that synthetic series. That figure is not a market result. Backtrader 1.9.78.123 also ran a second SMA 2/3 workflow whose net was -30.21, matching an independent Apex cent calculation (next-bar opens 12 and 9, 10 bp). Neither tree was vendored or imported into Node. Neither run is GPL clearance. Counsel review is still required before any image, customer copy, or claim that a process boundary is enough. Status stays TESTED, not INTEGRATED.

Both engines now run only as isolated subprocesses. No source file in the TypeScript application imports them.

Reviewed: 2026-11-12 (UTC), from the GitHub contents below. No clone.

## Sources read this session

| Item | URL | What it showed |
| --- | --- | --- |
| freqtrade `LICENSE` on `develop` | `https://raw.githubusercontent.com/freqtrade/freqtrade/develop/LICENSE` | Full GNU GPL v3 document, 674 lines. No SPDX line. |
| freqtrade `LICENSE` on tag `2026.10` | `https://raw.githubusercontent.com/freqtrade/freqtrade/2026.10/LICENSE` | Same document. |
| freqtrade project metadata | `pyproject.toml` on `develop` and on tag `2026.10` | Grant string below. |
| freqtrade releases | GitHub releases API | Latest tag `2026.10`. |
| freqtrade repo license object | `https://api.github.com/repos/freqtrade/freqtrade` | `spdx_id` `GPL-3.0`. |
| backtrader `LICENSE` on `master` | `https://raw.githubusercontent.com/mementum/backtrader/master/LICENSE` | Full GNU GPL v3 document, 674 lines. No SPDX line. |
| backtrader grant | `backtrader/__init__.py`, `backtrader/version.py`, `setup.py` on `master` | GPLv3-or-later headers. |
| backtrader tip | commits API, `master` | `b853d7c`, 2023-04-19. |
| NOTICE | `NOTICE` and `NOTICE.md` on both default branches | HTTP 404. Neither repo root lists a NOTICE file. |

The two `LICENSE` files are the standard GPL v3 text. They differ by leading whitespace on line 1 of the freqtrade copy. They are not identical as bytes. The phrase "any later version" appears inside both files only as part of the FSF "How to Apply These Terms" boilerplate. That boilerplate is instructions for new programs. It is not, by itself, the project's grant. The project grant is taken from each project's own metadata and file headers, quoted below.

## freqtrade

### License

**GNU General Public License version 3 only (GPL-3.0-only / GPLv3, not "or later").**

Confirmed this session from the `LICENSE` file, not from memory:

```
                    GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <http://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.
```

There is no SPDX identifier in that file. The copyright line above is the FSF's copyright on the license document, not a freqtrade copyright notice.

Project metadata, same session:

- Tag `2026.10` `pyproject.toml`: `license = {text = "GPLv3"}` and classifier `License :: OSI Approved :: GNU General Public License v3 (GPLv3)`. That Trove classifier is the v3 classifier, not `... v3 or later (GPLv3+)`.
- Default branch `develop` `pyproject.toml` (ahead of the release): `license = "GPL-3.0-only"` and `license-files = ["LICENSE"]`.
- GitHub repo license object: `"key": "gpl-3.0"`, `"name": "GNU General Public License v3.0"`, `"spdx_id": "GPL-3.0"`. GitHub's bare `GPL-3.0` id is the detection result for a GPL v3 `LICENSE` file. The SPDX list now prefers `GPL-3.0-only` vs `GPL-3.0-or-later`. The `develop` field is the explicit one: **only**.

No NOTICE file. Sampled modules (`freqtrade/__init__.py`, `freqtrade/main.py`, `freqtrade/freqtradebot.py`) have no per-file GPL header. README states no license badge text; it does carry a trading-risk disclaimer, which is not a license grant.

Latest release seen without cloning: **tag `2026.10`**, published **2026-10-30T08:35:55Z**, not a draft, not a prerelease. Prior tags: `2026.9` (2026-09-29), `2026.8` (2026-08-31). Default branch is `develop`. The `develop` tree's `__version__` string was `2026.11-dev` at read time. That is not a release. Do not treat `develop` as the shipped grant without re-reading it; the release tag still says `GPLv3` rather than the SPDX token `GPL-3.0-only`, and both point at GPL version 3 without an "or later" classifier.

### Internal research use

Running an unmodified freqtrade as its own process, on our machines, with no copy conveyed to anyone else, is the use GPL v3 section 2 affirms: permission to run the unmodified Program is unlimited, and acceptance of the license is not required merely to receive or run a copy. Private study of the public source is the same category.

That permission does **not** authorize copying freqtrade into this repository, translating it into the TypeScript app, or shipping it. A private modification that never leaves the organization is not, under the GPL's own definition, a conveyance — but contractors, affiliates, customer-accessible hosts, and published images are outside that sentence. Do not decide that boundary without counsel.

We did not run freqtrade.

### If we modify it, or ship a combined work, or a SaaS that conveys the binary

GPL v3 duties attach on **conveying** a covered work, not on private execution.

- **Convey** (GPL v3 section 0) is propagation that enables other parties to make or receive copies. Mere interaction over a network, with no transfer of a copy, is not conveying.
- **Modified source we convey** (section 5) must carry notices, state that it was modified, and be licensed entirely under GPL v3. Because the project grant is v3 **only**, we cannot relicense a conveyed derivative as GPL-3.0-or-later, and we cannot take it proprietary.
- **Binaries we convey** (section 6) require Corresponding Source under one of the section 6 methods (source alongside, written offer, network server, and so on). A container image, installer, or release artifact that contains freqtrade is conveyance of that program even if our UI is a separate process.
- **SaaS / network use is not AGPL.** freqtrade's `LICENSE` is GPL v3, not the GNU Affero GPL. GPL v3 has no section 13 remote-network source offer. Hosting freqtrade so users interact with it over a network, without transferring a copy of the program, does not by itself create the AGPL obligation to offer source to those network users. That is a statement about which license text is present. It is not a conclusion that a hosted product is free of copyleft.
- **Distributing a combined derivative still matters.** If we convey a work that is a modified version of freqtrade, or a larger work that must be treated as one Program with it, the whole of that covered work is under GPL v3 when conveyed. Putting our proprietary TypeScript in the same address space, the same library load, or the same "one product" derivative does not keep our code proprietary. A hosted service that also ships the binary (desktop app, on-prem package, customer container, downloaded worker) conveys, and the GPL terms apply to that conveyance regardless of the SaaS gap.

There is no additional NOTICE text to preserve beyond the GPL and the project's own copyright/license notices. If we ever convey, we still have to keep the GPL intact and not strip notices that do exist in the tree we convey.

### Does an adapter / subprocess avoid copyleft?

**Not automatically. Not for in-process use. Only an arm's-length separate process is even a candidate, and only after legal review.**

- **Linking and importing.** The FSF's published position is that static or dynamic linking of a GPL program with other code makes one combined program, which must be GPL when conveyed. Importing freqtrade as a Python library in-process is the same class of combination. This repo is a TypeScript monolith: there is no acceptable way to "import" freqtrade into it. Rewriting by copying its implementation into TypeScript is still a derivative of the covered work. Vendoring the tree into this repo is conveying it inside our source distribution the moment this repo is shipped, and it mixes the works in one tree.
- **Separate process over a typed contract.** Pipes, sockets, and command-line arguments are the FSF's usual examples of two independent programs communicating at arm's length, where the GPL on one does not automatically cover the other merely because they talk. A future worker that is a stock freqtrade process, speaking a typed contract (argv, stdin/stdout, or a local socket) defined by us, is the only shape that matches that description.
- **That boundary is not a safe harbor.** It fails if the split is nominal: shared memory, in-process embedding, a plugin API freqtrade expects strategies to load inside its interpreter, shipping a modified freqtrade as part of one product image, or a protocol so intimate that the two sides are one program broken apart to dodge the license. Strategies that are themselves derivative of freqtrade's strategy interfaces can be GPL when conveyed even if the Node process is argued to be separate. Counsel has to look at the actual protocol.
- **SaaS again.** A separate process we only run, and do not distribute, does not flip GPL into AGPL. The network-use gap remains the GPL gap, not a new permission to distribute a combined derivative.

### Recommendation

Do not vendor freqtrade. Do not import it into the Node app. Do not port its code into the TypeScript monolith. Direct reuse inside this monolith is not acceptable.

A future isolated process is the only shape worth considering, and only after legal review. Until that review, freqtrade stays off the build, off the dependency manifest, and off the container image.

## backtrader

### License

**GNU General Public License, version 3 or later (GPL-3.0-or-later / GPLv3+), as granted in the source headers.**

The `LICENSE` file itself is the GNU GPL version 3 text, confirmed this session:

```
GNU GENERAL PUBLIC LICENSE
                       Version 3, 29 June 2007

 Copyright (C) 2007 Free Software Foundation, Inc. <http://fsf.org/>
 Everyone is permitted to copy and distribute verbatim copies
 of this license document, but changing it is not allowed.
```

No SPDX identifier in that file. Same FSF copyright-on-the-license-document caveat as freqtrade. No NOTICE file.

The **program grant** is not "v3 only". It is in the file headers and packaging metadata on `master`:

```
# Copyright (C) 2015-2023 Daniel Rodriguez
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
```

That header is at the top of `backtrader/__init__.py`, `backtrader/cerebro.py`, `backtrader/version.py`, and `setup.py`. `setup.py` also sets `license='GPLv3+'` and the classifier `License :: OSI Approved :: GNU General Public License v3 or later (GPLv3+)`.

GitHub's repo license object still reports `"spdx_id": "GPL-3.0"` because detection keys off the `LICENSE` file text, which is the v3 document and does not say "or later" as a grant. Do not "correct" the headers to match GitHub's badge. The headers are the grant: recipients may choose GPL v3 or a later published GPL version. They may not take the work proprietary. Or-later does not make backtrader permissive, and it does not make linking it into a proprietary monolith acceptable.

Version without cloning: GitHub Releases for this repo returned **zero releases**. There is no release tag `1.9.78.123` (tag URL 404; matching-refs for `1.9.78` empty). The `master` tip is commit **`b853d7c90b6721476eb5a5ea3135224e33db1f14`**, committer date **2023-04-19T14:13:08Z**, message `Version 1.9.78.123`. `backtrader/version.py` on that commit sets `__version__ = '1.9.78.123'`. The tags API first page listed other tag names (`1.94.15.104`, `1.9.74.123`, `1.9.72.122`); those were not the `master` tip and there is no GitHub Release attached. Treat **2023-04-19 / 1.9.78.123 on `master`** as the version stamp, not as a GitHub Release. `master` has had no newer commit since that date. Default branch is `master`.

### Internal research use

Same GPL v3 run permission as above: an unmodified backtrader process we do not distribute may be run for internal research. Backtrader is a library (`Cerebro` and indicators are imported by user scripts). "Running a separate process" means a process **we** write whose only relationship to backtrader is launching a standalone program, not `import backtrader` inside an application we distribute.

Copyright holder on the headers read: Daniel Rodriguez, 2015-2023. No NOTICE file beyond those headers.

We did not run backtrader.

### If we modify it, or ship a combined work, or a SaaS that conveys the binary

Same GPL v3 conveyance structure as freqtrade, with one grant difference: a conveyed derivative may be licensed under GPL v3 **or any later version of the GPL**, at the conveyor's option, because the headers say so. That option is still copyleft. It is not a permissive license and not the LGPL. The `LICENSE` file's closing note says the GPL does not permit incorporating the program into proprietary programs, and points library authors at the LGPL instead. Backtrader's authors did not use the LGPL. `setup.py` says GPLv3+.

- In-process `import backtrader` from a program we convey is the case the GPL is aimed at. The FSF treats that as one combined program.
- Modified backtrader that we convey needs the section 5 notices and Corresponding Source, under GPL v3 or later.
- **Network use is not AGPL.** backtrader's license is GPL v3 (or later), not AGPL. Hosting a backtrader process that users reach over the network, without transferring a copy, does not by itself trigger an Affero-style source offer. Conveying a combined binary, image, or source tree still does.
- A SaaS that never ships the library can still become a distribution problem the day the worker image, a notebook, or a customer on-prem bundle includes backtrader.

### Does an adapter / subprocess avoid copyleft?

Same rule as freqtrade, applied more strictly because backtrader is a library meant to be imported:

- **Do not import it into any process we ship with proprietary code.** Dynamic import is not a loophole. A Python child that does `import backtrader` and is shipped inside our product is a combined GPL work under the FSF's linking position, unless counsel concludes otherwise for a specific design.
- **A separate process helps only if it is actually separate.** Two programs, arm's length, typed contract (records over a pipe or socket), neither one a plugin loaded into the other. The Node app must not embed CPython to host backtrader, must not vendor `backtrader/`, and must not copy indicator or engine implementations into TypeScript.
- A subprocess we add solely to paper over the license, while exchanging backtrader's internal object graph, is not arm's length. Flag that for counsel; do not treat "we used subprocess" as a clearance.
- GPL, not AGPL: the process boundary does not change the network-use analysis. It only speaks to whether our TypeScript is a derivative. Distribution of the GPL side remains a distribution of the GPL side.

### Recommendation

Do not vendor backtrader. Do not import it into the Node app. Do not reimplement it by copying. Direct reuse inside this TypeScript monolith is not acceptable.

A future isolated process is the only shape worth considering, and only after legal review. The library is also stale (master tip 2023-04-19, no GitHub Releases). That is an engineering reason on top of the license, not a reason to copy it in.

## Decision

| Question | freqtrade | backtrader |
| --- | --- | --- |
| License confirmed this session | GPL v3 text in `LICENSE`; project grant **GPL-3.0-only** / GPLv3 (not or-later) | GPL v3 text in `LICENSE`; header grant **GPL-3.0-or-later** (GPLv3+) |
| GitHub `spdx_id` | `GPL-3.0` | `GPL-3.0` |
| NOTICE | None found | None found |
| Version seen, no clone | Release tag `2026.10` (2026-10-30) | `master` `b853d7c` (2023-04-19), version string `1.9.78.123`; no GitHub Release |
| Private run of a separate process we do not distribute | Permitted by GPL v3's run term; not a distribution clearance | Same |
| Import, vendor, or port into the TypeScript monolith | Not acceptable | Not acceptable |
| SaaS network use | GPL, not AGPL; network use alone is not the Affero trigger | Same |
| Convey a combined derivative or a binary that includes it | GPL obligations apply to the covered work | Same, or-later still copyleft |
| Subprocess / typed contract | Only candidate shape; not a safe harbor; legal review first | Same, and in-process import does not qualify |

**Do not vendor. Do not import into the Node app. A future isolated process is the only shape worth considering, and only after legal review. Direct reuse inside this TypeScript monolith is not acceptable.**

Counsel review triggers, non-exhaustive: any commit that adds either tree or a fork; any container that contains either program; any customer-delivered worker; any claim that a socket API keeps our code outside GPL; any use of freqtrade strategy classes or backtrader `Strategy` subclasses as code we ship.
