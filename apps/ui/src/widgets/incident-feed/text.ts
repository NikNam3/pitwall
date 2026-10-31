// Wording specific to this display; the kind names live in kit/text.ts (`incidentKinds`).
import type { PenaltyKind } from '@pitwall/domain';

/** The time lost of an incident, from formatted seconds: `lost 4.2 s`. */
export const lost = (seconds: string): string => `lost ${seconds} s`;
/** The other car retired by the after moment (its gap after is not applicable). */
export const retired = 'DNF';
/** The start of what changed for our car. */
export const us = 'us';
/** Between our position and the other car's gaps. */
export const joint = ', ';
/** Between the before and after of a pair: the kit's one arrow. */
export { arrow } from '../../kit/text.ts';
/** The kind word and its detail: `time loss S2`, `warning 2/3`, `damage floor +8 %`. */
export const withDetail = (kind: string, detail: string): string => `${kind} ${detail}`;
/** A warning's count of the limit: `2/3`. */
export const warningCount = (count: string, limit: string): string => `${count}/${limit}`;
/** One damaged part and its rise: `FL wing +12 %`. */
export const damagePart = (part: string, delta: string): string => `${part} ${delta}`;
/** Between the damaged parts of one entry. */
export const partsJoint = ', ';
/** The ruling of a penalty entry; a time penalty is its time (`timePenalty`). */
export const penaltyKinds: Record<Exclude<PenaltyKind, 'time'>, string> = {
  driveThrough: 'drive-through',
  stopGo: 'stop-go',
  grid: 'grid',
  disqualified: 'disqualified',
  tyreRegulations: 'tyre regulations',
};
/** A time penalty, from formatted whole seconds: `+5 s`. */
export const timePenalty = (seconds: string): string => `+${seconds} s`;
