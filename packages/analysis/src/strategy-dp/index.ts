// `strategy-dp` (SP4.3b spec §6; SP4.3c spec §5.4, Task 19): a simulator (C50): one car's stops and compounds to the flag
// by dynamic programming, expected over the SC/VSC chances of each lap, per weather world, each plan with its own
// trigger thresholds. Pure, no randomness; no reads, no cadence, no topic. Its one config entry (`worlds`, C47) is read
// by the shared strategy input that builds its input.
//
// One solve per world (`solveWorld`, `solve.ts`) holds every node's values and decisions; `solveDp` reads every world's
// result from them, and `bestWith` (`best-with.ts`) queries one, so a caller that needs several reads of one world
// solves it once.
// - `plans`: per world one plan per compound sequence that meets the sets, the rule and the 70 % limit with at most
//   `MAX_STOPS` stops (so the best of each stop count 0–3 where one is feasible), best first, tagged with the world; its
//   `expectedMs` is the expected remaining race time of the best closed-loop play making exactly that sequence's stops,
//   its `stops` that play's stops where no neutralisation comes; its `triggers` its own: the SC/VSC lap ranges where
//   boxing onto its own next compound beats staying out (none without a stop), and on the world's best plan also
//   damage, degradation off and rain (`thresholds.ts`; no box trigger on a plan without a stop).
// - `boxThisLap` / `continue`: the best closed-loop play (any compound at any stop) with and without a stop at the end of
//   `fromLap`, the heaviest world's (the first on equal weights); `boxThisLap` is `null` where no play boxing now meets
//   the rule, the sets and the limit; `continue`, where no play without a stop now meets the rule and the limit, is the
//   play that ignores both. Each carries its own neutralised triggers.
// - `table`: the heaviest world's, per lap (index 0 = `fromLap`) for an SC now, along the best play's path where no
//   neutralisation comes: the expected remaining race time from that lap's start if an SC starts on it (its length by
//   the SC duration pmf), boxing at its end onto the best compound (`boxUnderMs`, `Infinity` where no stop can be made)
//   and staying out (`stayMs`); `sc-call` reads it (4.3b2).
import { defineSimulator } from '@pitwall/engine/readers';

export type * from './types.ts';
export { bestWith } from './best-with.ts';
export { STRATEGY_DP_CONFIG } from './config.ts';
export { solveDp, solveWorld, type DpSolution } from './solve.ts';

export const SIMULATOR = defineSimulator('strategy-dp');
