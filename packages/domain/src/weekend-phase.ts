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
