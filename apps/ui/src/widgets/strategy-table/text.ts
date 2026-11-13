// Wording of the strategy-table display (mockup docs/design/2026-11-12-sp4.3b/strategy-table-b.html, gen.mjs
// `TEXT.strategy`); text shared with the kit lives in kit/text.ts. No sentence in the panel; hovers may be phrases.
import type { McRow, McSource, Trigger } from '@pitwall/domain';
import { formatLapRange, formatPercent, formatSecondsUnit, formatSignedSeconds } from '../../kit/values/format.ts';

type RuleName = NonNullable<McRow['rule']>;
type TriggerOf<K extends Trigger['kind']> = Extract<Trigger, { kind: K }>;

/** Column headers: `#`, `SRC`, `STOPS`, `TRG`, `E[POS]`, `E[PTS]`, `ΔTIME`, `ΔPLAN`. */
export const headers = { rank: '#', src: 'SRC', stops: 'STOPS', trg: 'TRG', ePos: 'E[POS]', ePts: 'E[PTS]', dLead: 'ΔTIME', dPlan: 'ΔPLAN' };
/** The source words: `dp`, `nbr`, `rule`, `plan`. */
export const source: Record<McSource, string> = { dp: 'dp', neighbour: 'nbr', rule: 'rule', committed: 'plan' };
/** The rules' names in a rule candidate's hover. */
const ruleName: Record<RuleName, string> = {
  mirrorAhead: 'mirror the car ahead',
  mirrorBehind: 'mirror the car behind',
  cover: 'cover a rival',
  extend: 'extend past a rival',
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
/** The neutralisation words of a `neutralised` trigger, and the joined pair. */
const condition = { sc: 'SC', vsc: 'VSC' } as const;
export const scOrVsc = 'SC/VSC';
/** A `neutralised` trigger's text from its condition word and lap range (`SC L12–24`). */
export const neutralisedText = (word: string, fromLap: number, toLap: number): string => `${word} ${formatLapRange(fromLap, toLap)}`;
/**
 * One wording per trigger kind (P27); rows.ts `triggerTexts` joins an SC and a VSC trigger over one range. `rivalPits`
 * takes the rival's label as rows.ts resolves it from `cars.overview` (`#44`, or the kit's unknown mark).
 */
export const trigger: { [K in Exclude<Trigger['kind'], 'rivalPits'>]: (t: TriggerOf<K>) => string } & {
  rivalPits: (t: TriggerOf<'rivalPits'>, car: string) => string;
} = {
  neutralised: (t) => neutralisedText(condition[t.condition], t.fromLap, t.toLap),
  damage: (t) => `DMG ${formatSignedSeconds(t.lossMsPerLap, 1)} s/lap`,
  degradationOff: (t) => `DEG +${formatPercent(t.wearRateDeltaPct)}`,
  rain: (t) => `RAIN ${formatSignedSeconds(t.wetnessMs, 1)} s`,
  rivalPits: (t, car) => `${t.action === 'cover' ? 'COVER' : 'EXT'} ${car} ${formatSecondsUnit(t.withinMs, 1)}`,
};
