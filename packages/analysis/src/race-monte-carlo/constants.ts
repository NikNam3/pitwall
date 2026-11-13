// `race-monte-carlo`'s fixed terms (SP4.3b spec §7). A simulator has no view and so no `config.ts` (C47 binds
// calculators and analyses); the search's and the rivals' values arrive in `McInput` from `strategy`'s config. These
// are the model's fixed terms, each with its source.

/**
 * The cover rule's gap (spec §7.2 ablation, only with `coverRule`): a rival ahead of our stopping car by at most this
 * at the line ending our in-lap covers with a stop on the next lap. Source: `strategy`'s `ruleGapMs` 3,000 ms (spec
 * §11.1), `forecast-score`'s `closeGapMs` (research 12 §8).
 */
export const COVER_GAP_MS = 3_000;

/**
 * The share of a car's scenario-policies the search keeps back for scoring the top few again on common scenarios
 * (spec §7.3 step 5). Source: pitwall estimate (a quarter: the search's batches of `n0` keep the rest).
 */
export const RESCORE_SHARE = 0.25;

/** The draws' purposes of the scenario streams (spec §7.1); apart from `race-forecast`'s, which use another base seed. */
export const MC_PURPOSE = { scStart: 1, scLength: 2, vscStart: 3, vscLength: 4, activeLength: 5, rivalLap: 6, rivalSc: 7 } as const;
