// The planning round (SP4.3d spec §7.1, §7.4, C62d): whether it is open, and the team's prepared plans for the race it
// plans: the entered and suggested race laps and per car of the qualifying session's slots its prepared plans (bridge
// user state, C54, C55).
import type { CarId, Known, PreparedCar, RaceAssumptions, RaceFormat, SessionRef, TeamId } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

/**
 * `open: false` outside the planning round. Open: the race it plans (weekend, format, our team), the race laps the
 * engineer entered (`null` until entered) and the bridge's suggestion, per car slot of the qualifying session its
 * prepared plans (so a link group resolves its car), and whether the planning job is running.
 */
// SP4.3e: deleted in Task 7b (the topic's value becomes `PlanningRoundState`)
export type PlanningRound =
  | { open: false }
  | {
      open: true;
      weekendId: string;
      format: RaceFormat;
      team: TeamId;
      laps: { entered: number | null; suggested: Known<number> };
      cars: Record<CarId, PreparedCar>;
      running: boolean;
    };

/**
 * The planning round as a function (C62d, SP4.3e spec §4.3): `open: false` outside it. Open: the qualifying it replays,
 * its practice basis and race assumptions, our team, per car slot of the qualifying its prepared plans, whether the
 * planning job is running, and the team's saved plans on the track. Not yet bound: Task 7b makes it the topic's value.
 */
/** A saved plan as the picker lists it: the team's saved plans on the track, also while no round is open (SP4.3e R15). */
export type SavedPlanEntry = { id: string; name: string; savedAt: string };

export type PlanningRoundState =
  | { open: false; saved: SavedPlanEntry[] }
  | {
      open: true;
      qualifying: SessionRef;
      practice: SessionRef[];
      race: RaceAssumptions;
      team: TeamId;
      cars: Record<CarId, PreparedCar>;
      running: boolean;
      saved: SavedPlanEntry[];
    };

export default defineTopic<NoParams, PlanningRound>({ owner: 'core', scope: 'feed', mode: 'state', maxHz: Infinity });
