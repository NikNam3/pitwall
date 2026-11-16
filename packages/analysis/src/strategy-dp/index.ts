// `strategy-dp` (SP4.3b spec §6; SP4.3c spec §5.4, Task 19): a simulator (C50): one car's stops and compounds to the flag
// by dynamic programming, expected over the SC/VSC chances of each lap, per weather world, each plan a stop list
// (SP4.3d spec §5.1). Pure, no randomness; no reads, no cadence, no topic. Its one config entry (`worlds`, C47) is read
// by the shared strategy input that builds its input.
//
// One solve per world (`solveWorld`, `solve.ts`) holds every node's values and decisions; `solveDp` reads every world's
// result from them, and `bestWith` (`best-with.ts`) queries one, so a caller that needs several reads of one world
// solves it once.
// - `plans`: per world one plan per compound sequence that meets the sets, the rule and the 70 % limit with at most
//   `MAX_STOPS` stops (so the best of each stop count 0–3 where one is feasible), best first, tagged with the world; its
//   `expectedMs` is the expected remaining race time of the best closed-loop play making exactly that sequence's stops,
//   its `stops` that play's stops where no neutralisation comes (a stop list, SP4.3d spec §5.1).
// - `boxThisLap` / `continue`: the best closed-loop play (any compound at any stop) with and without a stop at the end of
//   `fromLap`, the heaviest world's (the first on equal weights); `boxThisLap` is `null` where no play boxing now meets
//   the rule, the sets and the limit; `continue`, where no play without a stop now meets the rule and the limit, is the
//   play that ignores both.
// - `table`: the heaviest world's, per lap (index 0 = `fromLap`) for an SC now, along the best play's path where no
//   neutralisation comes: the expected remaining race time from that lap's start if an SC starts on it (its length by
//   the SC duration pmf), boxing at its end onto the best compound (`boxUnderMs`, `Infinity` where no stop can be made)
//   and staying out (`stayMs`); `sc-call` reads it (4.3b2).
// - A free start (`startCompound` `null`, the grid, SP4.3d spec §7.2): the car starts on a new set of the compound the
//   DP picks among those with a set left (`freeStarts`), that set counted in the sets used and the compound rule; each
//   start compound is solved alone (`solveWorld`'s `start`, `solveAll`), the start node the best over them, and every
//   plan, `boxThisLap` and `continue` carries its `startCompound`. A car on its tyres: no plan carries one.
// - `reactionTable` (`reaction.ts`, SP4.3d spec §5.2): one world's solve as structured-cloneable typed arrays, the
//   heaviest world's for `race-monte-carlo`'s SC/VSC reaction: `reactAt` the averaged move at a state, `nodeAlong` a
//   plan's node at a lap, `continueFrom` the best play from a state where no neutralisation comes.
import { defineSimulator } from '@pitwall/engine/readers';

export type * from './types.ts';
export { bestWith } from './best-with.ts';
export { STRATEGY_DP_CONFIG } from './config.ts';
export { continueFrom, nodeAlong, reactAt, reactionTable, type ReactionTable } from './reaction.ts';
export { freeStarts, heaviest, solveAll, solveDp, solveWorld, type DpSolution } from './solve.ts';

export const SIMULATOR = defineSimulator('strategy-dp');
