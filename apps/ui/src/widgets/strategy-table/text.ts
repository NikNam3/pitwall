// STUB (test phase, SP4.3b2 Task 12): the shape the tests assume of the strategy table's wording; every value throws
// `not implemented` until the implement phase writes it. No sentence in the panel; hovers may be phrases.
import type { McRow, McSource, Trigger } from '@pitwall/domain';

/** A stand-in that throws `not implemented` when read (so each test fails on its own, not at import). */
const notImplemented = <T>(): T => {
  const fail = (): never => {
    throw new Error('not implemented');
  };
  return new Proxy(fail, { get: fail, apply: fail, has: fail }) as T;
};

type RuleName = NonNullable<McRow['rule']>;
type TriggerOf<K extends Trigger['kind']> = Extract<Trigger, { kind: K }>;

/** Column headers: `#`, `SRC`, `STOPS`, `TRG`, `E[POS]`, `E[PTS]`, `ΔTIME`, `ΔPLAN`. */
export const headers: { rank: string; src: string; stops: string; trg: string; ePos: string; ePts: string; dLead: string; dPlan: string } = notImplemented();
/** The source words: `dp`, `nbr`, `rule`, `plan`. */
export const source: Record<McSource, string> = notImplemented();
/** The source hovers; a rule candidate's names its rule. */
export const sourceHover: { dp: string; neighbour: string; committed: string; rule: (rule: RuleName) => string } = notImplemented();
/** Button words `commit`, `clear`. */
export const commit: string = notImplemented();
export const clear: string = notImplemented();
/** Footer labels `N`, `CAND`. */
export const meta: { n: string; cand: string } = notImplemented();
/** Hover of a tie bracket; of an unresolved one at the cap. */
export const tieHover: string = notImplemented();
export const openTieHover: string = notImplemented();
/** Why a committed plan can no longer be followed as committed (hover). */
export const infeasible: Record<NonNullable<McRow['infeasible']>, string> = notImplemented();
/**
 * One wording per trigger kind (P27); rows.ts `triggerTexts` joins an SC and a VSC trigger over one range. `rivalPits`
 * takes the rival's label as rows.ts resolves it from `cars.overview` (`#44`, or the kit's unknown mark).
 */
export const trigger: { [K in Exclude<Trigger['kind'], 'rivalPits'>]: (t: TriggerOf<K>) => string } & {
  rivalPits: (t: TriggerOf<'rivalPits'>, car: string) => string;
} = notImplemented();
