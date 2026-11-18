// The basis sidecar of a recording (C38, C59, C62, C62d; SP4.3e spec §4.2, ruling R20): a live session writes
// `<file>.basis.json` at its first Participants, `{ start, preselected }`: the current sessions it started with, and, for
// display only, the whole preselection; each plan choice that reaches the feed in a race adds an entry to `plans`
// (`{ at, frame, plan }`: the record index it reached the feed at, positional like the decisions sidecar's, the frame
// number its decisions describe, and the plan as committed, `{ id, name, laps }`, or `null` for none); a later edit of
// the saved plan adds nothing (R22, C62d, C75). After a flashback the shown plan is the newest entry at or before its
// target frame (C27a, C33). A replay or reprocess
// starts on its `start` and shows each recorded plan before record `at`, as the live run did; the basis-chosen decisions
// come back from the decisions sidecar (C76). A recording without one has the session's own weekend's earlier sessions
// as its basis (C62); one without `plans` shows no plan.
import type { BasisActive } from '@pitwall/contracts';
import { decodeUiAction } from '@pitwall/contracts/ui/decode';
import type { BasisSidecar, SavedPlan, SessionBasis } from '@pitwall/domain';
import type { Logger } from '../log.ts';
import { readSidecar } from './decision-sidecars.ts';

/** The plan `basis.active` shows: a saved plan's id, name and the race laps it was computed on; `null`: none. */
export type ShownPlan = BasisActive['plan'];

/**
 * A plan choice as the basis sidecar records it: the record index it reached the feed at, the frame number its
 * decisions describe, and the plan as committed.
 */
export type PlanEntry = { at: number; frame: number; plan: ShownPlan };

/** The basis sidecar as the bridge writes and reads it (R20, R22). */
export type RecordedBasis = BasisSidecar & { plans?: PlanEntry[] };

/** Where a recording's basis sidecar lives. */
export const basisSidecarPath = (recordingPath: string): string => `${recordingPath}.basis.json`;

/** A saved plan as `basis.active` shows it (C54, C65: its laps beside the race's, not judged). */
export const shownPlanOf = (plan: SavedPlan): NonNullable<ShownPlan> => ({ id: plan.id, name: plan.name, laps: plan.computedOn.race.laps });

/** A basis by the shape rule of `basis.choose` (the contracts package's decoder, C73). */
const decodeBasis = (json: unknown): SessionBasis | undefined => {
  const action = decodeUiAction({ kind: 'basis.choose', feedId: '', basis: json, plan: undefined });
  return action?.kind === 'basis.choose' ? action.basis : undefined;
};

const isRecord = (json: unknown): json is Record<string, unknown> => typeof json === 'object' && json !== null && !Array.isArray(json);

const decodeShown = (json: unknown): ShownPlan | undefined => {
  if (json === null) return null;
  if (!isRecord(json)) return undefined;
  const { id, name, laps } = json;
  return typeof id === 'string' && typeof name === 'string' && typeof laps === 'number' && Number.isInteger(laps) && laps > 0 ? { id, name, laps } : undefined;
};

/** The recorded plan choices; `undefined` when any entry fails to decode (the whole list is ignored then). */
const decodePlans = (json: unknown): PlanEntry[] | undefined => {
  if (!Array.isArray(json)) return undefined;
  const plans: PlanEntry[] = [];
  const index = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0;
  for (const entry of json) {
    if (!isRecord(entry) || !index(entry['at']) || !index(entry['frame'])) return undefined;
    const plan = decodeShown(entry['plan']);
    if (plan === undefined) return undefined;
    plans.push({ at: entry['at'], frame: entry['frame'], plan });
  }
  return plans;
};

function decodeBasisSidecar(json: unknown): RecordedBasis | undefined {
  if (!isRecord(json)) return undefined;
  const { start, preselected, plans } = json;
  const startBasis = decodeBasis(start);
  const preselectedBasis = decodeBasis(preselected);
  if (startBasis === undefined || preselectedBasis === undefined) return undefined;
  const planEntries = plans === undefined ? undefined : decodePlans(plans);
  return { start: startBasis, preselected: preselectedBasis, ...(planEntries !== undefined && { plans: planEntries }) };
}

/** The recording's basis sidecar; `null` without one, or when it fails to read or decode (with a warning). */
export function recordingBasis(recordingPath: string, log?: Logger): RecordedBasis | null {
  return readSidecar(basisSidecarPath(recordingPath), decodeBasisSidecar, log) ?? null;
}
