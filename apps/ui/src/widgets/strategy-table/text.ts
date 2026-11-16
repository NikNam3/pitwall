// Wording of the strategy-table display (mockup docs/design/2026-11-12-sp4.3b/strategy-table-b.html, gen.mjs
// `TEXT.strategy`); text shared with the kit lives in kit/text.ts. No sentence in the panel; hovers may be phrases.
import type { McRow, McSource } from '@pitwall/domain';

type RuleName = NonNullable<McRow['rule']>;

/** Column headers: `#`, `SRC`, `STOPS`, `E[POS]`, `E[PTS]`, `ΔTIME`, `ΔPLAN`. */
export const headers = { rank: '#', src: 'SRC', stops: 'STOPS', ePos: 'E[POS]', ePts: 'E[PTS]', dLead: 'ΔTIME', dPlan: 'ΔPLAN' };
/** The source words: `dp`, `nbr`, `rule`, `plan`. */
export const source: Record<McSource, string> = { dp: 'dp', neighbour: 'nbr', rule: 'rule', committed: 'plan' };
/** The rules' names in a rule candidate's hover. */
const ruleName: Record<RuleName, string> = {
  mirrorAhead: 'mirror the car ahead',
  mirrorBehind: 'mirror the car behind',
};
/** The source hovers; a rule candidate's names its rule. */
export const sourceHover: { dp: string; neighbour: string; committed: string; rule: (rule: RuleName) => string } = {
  dp: "dp · the DP's plan",
  neighbour: 'nbr · a stop lap next to a DP plan',
  committed: 'plan · the committed plan',
  rule: (rule) => `rule · ${ruleName[rule]}`,
};
/** Button words `commit`, `clear`, and their hovers (the uiAction they send). */
export const commit = 'commit';
export const clear = 'clear';
export const commitHover = 'plan.commit';
export const clearHover = 'plan.clear';
/** Footer labels `N`, `CAND`. */
export const meta = { n: 'N', cand: 'CAND' };
/** Hover of a tie bracket; of an unresolved one at the cap. */
export const tieHover = 'tied with the row above: within the tie test';
export const openTieHover = 'near-tie unresolved at the cap';
/** Why a committed plan can no longer be followed as committed (hover). */
export const infeasible: Record<NonNullable<McRow['infeasible']>, string> = {
  stopLapPassed: 'infeasible: its stop lap has passed',
  noSetLeft: 'infeasible: no set of its compound left',
};
/** The STOPS cell of a policy with no stops. */
export const toTheFlag = 'to the flag';
