// The weekend phase (contract C14): decided once the session's weekend structure is known, fixed for the session.

export type PracticeFormat = 'practice' | 'shortPractice';
export type QualifyingFormat = 'grandPrix' | 'short' | 'oneShot' | 'sprintShootout' | 'shortSprintShootout' | 'oneShotSprintShootout';
/** A sprint is the race phase with format `sprint`. */
export type RaceFormat = 'grandPrix' | 'sprint';

/** `pending` until the weekend structure arrives; `none` for a time trial or an unknown session type. */
export type WeekendPhase =
  | { kind: 'pending' }
  | { kind: 'none' }
  | { kind: 'practice'; format: PracticeFormat; segment: 1 | 2 | 3 | undefined }
  | { kind: 'qualifying'; format: QualifyingFormat; segment: 1 | 2 | 3 | undefined }
  | { kind: 'race'; format: RaceFormat };

/** The phases a per-phase sub-machine can apply to (`appliesTo`, C15). */
export type WeekendPhaseKind = 'practice' | 'qualifying' | 'race';

/** The race a qualifying format plans (SP4.3d2 §7.0 rule 5): a sprint shootout plans the sprint, every other qualifying the grand prix. */
export function raceFormatOf(f: QualifyingFormat): RaceFormat {
  return f === 'sprintShootout' || f === 'shortSprintShootout' || f === 'oneShotSprintShootout' ? 'sprint' : 'grandPrix';
}

/** Whether a session in this weekend phase ends qualifying: a qualifying session whose segment is 3 or that has none (short, one-shot). */
export function endsQualifying(p: WeekendPhase): boolean {
  return p.kind === 'qualifying' && (p.segment === 3 || p.segment === undefined);
}
