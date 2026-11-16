// Wording of the plan board (mockup docs/design/2026-11-16-sp4.3d/plan-board.html, gen.mjs `TEXT.board`); text shared
// with the kit lives in kit/text.ts. No sentence in the panel; hovers may be phrases.
import type { McRow, Slot } from '@pitwall/domain';

/** Column headers: the slot column has none, `STOPS`, `E[POS]`, `ΔPOS`, `ΔTIME`. */
export const headers = { stops: 'STOPS', ePos: 'E[POS]', dPos: 'ΔPOS', dTime: 'ΔTIME' } as const;
/** The DP part's rule: ` ─ DP ───…` filling `width` cells. */
export const dpRule = (width: number): string => ` ─ DP ${'─'.repeat(Math.max(0, width - 6))}`;
/** The STOPS cell of a plan with no stop. */
export const noStop = 'no stop';
/** Between two stops. */
export const stopJoin = ' · ';
/** The active plan's mark after its slot (`A●`). */
export const active = '●';
/** A DP line's action, and the text of a DP line equal to a slot. */
export const toSlot = '→ slot';
export const sameAs = (slot: Slot): string => `= ${slot}`;
export const sameAsHover = 'the same plan as this slot';
/** The selected slot's actions. */
export const activate = 'activate';
export const edit = 'edit';
export const remove = '×';
/** The editor's words. */
export const lapPrefix = 'L';
export const arrow = '→';
export const dropStop = '×';
export const addStop = '+ stop';
export const saveTo = (slot: Slot): string => `save to ${slot}`;
export const saveAs = (slot: Slot): string => `save as ${slot}`;
export const cancel = 'cancel';
/** Hovers of the buttons: the uiAction they send. */
export const hover = { save: 'plan.save', activate: 'plan.activate', remove: 'plan.remove' } as const;
/** A rejection without the bridge's message. */
export const rejectedNoReason = 'rejected';
export const rejected = (message: string): string => `rejected: ${message}`;
/** Why a slot can no longer be followed as saved (hover). */
export const infeasible: Record<NonNullable<McRow['infeasible']>, string> = {
  stopLapPassed: 'its stop lap has passed: followed as far as it can be (box this lap)',
  noSetLeft: 'no set of that compound left',
};
