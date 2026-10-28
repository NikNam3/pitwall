# 0006: Code and data under GPL-3.0 and LGPL-3.0 may be copied

## Status

Accepted (2026-10-28)

## Context

Two strategy sources come with copyleft licences:
- the TUM race simulation ([TUMFTM/race-simulation](https://github.com/TUMFTM/race-simulation), LGPL-3.0), see `docs/research/03-strategy-models.md`
- Bonomi et al.'s genetic algorithm and their F1 2021 practice data ([bonom/Evolutionary-F1-Race-Strategy](https://github.com/bonom/Evolutionary-F1-Race-Strategy), GPL-3.0), see `docs/research/07-strategy-literature.md`

The earlier rule was "re-implement ideas, never copy". Pitwall itself is Apache-2.0 (`LICENSE`).

## Decision

- The user accepts running pitwall under GPL-3.0. Code and data from GPL-3.0 and LGPL-3.0 sources may be copied or ported, not only their ideas.
- `LICENSE` stays Apache-2.0 until the first GPL-3.0 code or data is actually committed. That commit switches `LICENSE` to GPL-3.0 and updates the `license` field of every `package.json`.
- Copied or ported files keep the original copyright notice and name the source repository and commit in a header comment. Data files get a `SOURCE.md` next to them with the same information.

## Consequences

- From the first copied GPL-3.0 file on, every distributed copy of pitwall must be under GPL-3.0, with source available. Apache-2.0 code can be included in a GPL-3.0 work; the reverse is not allowed.
- LGPL-3.0 code can be included in a GPL-3.0 work, so the TUM code is covered too.
- Dependencies must stay GPL-3.0 compatible (MIT, BSD, Apache-2.0, LGPL and GPL-3.0 are; GPL-2.0-only is not).
- Not covered: Simulator Controller ([SeriousOldMan/Simulator-Controller](https://github.com/SeriousOldMan/Simulator-Controller)) is mostly CC BY-NC-SA 4.0, which is not GPL-compatible; only its ideas may be used.
- Bonomi's data is from F1 2021, not F1 25, and is CSV rather than `.pwrec`. It can serve as strategy test data, not as protocol fixtures.
