// The plan board's edit draft (C73): window-local, laps as typed and compounds, nothing sent until a save. The bridge
// validates the saved plan; a rejection marks the fields the draft changed against the slot's plan.
import type { NoiseCompound, Policy, Slot } from '@pitwall/domain';

export type DraftStop = { lap: string; compound: NoiseCompound };
/** `start`: the plan's start compound, chosen in the planning round's entry (SP4.3d2 Task 12); none in the race. */
export type Draft = { slot: Slot; base: Policy; stops: DraftStop[]; start?: NoiseCompound };
/** Per stop whether its lap and its compound differ from the slot's plan. */
export type Changed = { lap: boolean; compound: boolean }[];

/** The compounds a stop can take, in the select's order. */
export const COMPOUNDS: readonly NoiseCompound[] = ['soft', 'medium', 'hard', 'inter', 'wet'];
/** A new stop's compound when the draft has none to copy. */
const NEW_STOP_COMPOUND: NoiseCompound = 'hard';

export const draftOf = (slot: Slot, policy: Policy): Draft => ({
  slot,
  base: policy,
  stops: policy.stops.map((s) => ({ lap: String(s.lap), compound: s.compound })),
});

/** The start compound of a new planning-round entry until one is chosen. */
export const NEW_START: NoiseCompound = 'medium';

/** The planning round's entry of an empty slot: no stop yet, a start compound to choose. */
export const entryOf = (slot: Slot): Draft => ({ slot, base: { stops: [] }, stops: [], start: NEW_START });

/** The draft as a plan: each lap field read as a number (the bridge rejects one that is no lap of the race). */
export const policyOfDraft = (draft: Draft): Policy => ({
  ...(draft.start === undefined ? {} : { startCompound: draft.start }),
  stops: draft.stops.map((s) => ({ lap: Number(s.lap.trim()), compound: s.compound })),
});

export const setStart = (draft: Draft, start: NoiseCompound): Draft => ({ ...draft, start });

export const changedFields = (draft: Draft): Changed =>
  draft.stops.map((s, i) => {
    const base = draft.base.stops[i];
    return { lap: base === undefined || String(base.lap) !== s.lap.trim(), compound: base === undefined || base.compound !== s.compound };
  });

export const setLap = (draft: Draft, i: number, lap: string): Draft => ({ ...draft, stops: draft.stops.map((s, j) => (j === i ? { ...s, lap } : s)) });
export const setCompound = (draft: Draft, i: number, compound: NoiseCompound): Draft => ({
  ...draft,
  stops: draft.stops.map((s, j) => (j === i ? { ...s, compound } : s)),
});
export const dropStop = (draft: Draft, i: number): Draft => ({ ...draft, stops: draft.stops.filter((_, j) => j !== i) });
/** A new stop at the end: its lap empty, the last stop's compound. */
export const addStop = (draft: Draft): Draft => ({
  ...draft,
  stops: [...draft.stops, { lap: '', compound: draft.stops.at(-1)?.compound ?? NEW_STOP_COMPOUND }],
});
