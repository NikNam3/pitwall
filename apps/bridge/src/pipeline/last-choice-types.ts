// The team's last confirmed choice (C62, C62d; SP4.3e spec §4.2; Task 0c, built in a later task): per track the last
// confirmed basis per kind and the last chosen or saved plan, each with its time (ISO); bridge user state in
// `PITWALL_DATA_DIR/basis/<team>.json`. And the seam between the basis routing (Task 7a-2) and the saved plans (Task 7b).
import type { ActionOutcome } from '@pitwall/contracts';
import type { SessionRef, TeamId, TrackId } from '@pitwall/domain';

export type LastChoice = {
  trackId: TrackId;
  /** Per kind the last confirmed basis; an absent kind was never confirmed on the track (a save writes only `plan`). */
  basis: { practice?: { refs: SessionRef[]; at: string }; qualifying?: { ref: SessionRef | null; at: string } };
  /** The plan's id; `null`: none was chosen. */
  plan: { id: string | null; at: string };
};

export type LastChoiceStore = {
  read(team: TeamId, trackId: TrackId): LastChoice | undefined;
  write(team: TeamId, choice: LastChoice): void;
};

/** Chooses a saved plan: commits its decisions on each of the team's feeds now running (C62d, C76); `null`: none, commits nothing. */
export type PlanChoice = { choosePlan(team: TeamId, trackId: TrackId, planId: string | null): ActionOutcome };
