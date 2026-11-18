// The planning round (C62d, SP4.3e spec §4.3): whether it is open, the qualifying it replays, its practice basis and
// race assumptions, per car of the qualifying session's slots its prepared plans, and the team's saved plans on the
// track (bridge user state, C54, C55).
import type { PreparedCar, RaceAssumptions, SessionRef, TeamId } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

/** A saved plan as the picker lists it: the team's saved plans on the track, also while no round is open (SP4.3e R15). */
export type SavedPlanEntry = { id: string; name: string; savedAt: string };

/**
 * A round's race assumptions: `laps` is `null` while the bridge has no suggestion and none was entered (C3: never a
 * made-up number); the round runs no planning job until it is known.
 */
export type RoundRace = { laps: number | null; sets: RaceAssumptions['sets'] };

/**
 * The planning round as a function (C62d, SP4.3e spec §4.3): `open: false` outside it, with the team's saved plans on
 * the feed's track (none while its team or track is not known). Open: the qualifying it replays, its practice basis and
 * race assumptions, our team, per car slot of the qualifying its prepared plans (so a link group resolves its car),
 * whether the planning job is running (its replay included), and the team's saved plans on the track.
 */
export type PlanningRoundState =
  | { open: false; saved: SavedPlanEntry[] }
  | {
      open: true;
      qualifying: SessionRef;
      practice: SessionRef[];
      race: RoundRace;
      team: TeamId;
      /** By car slot of the qualifying (`CarId`). */
      cars: Record<number, PreparedCar>;
      running: boolean;
      saved: SavedPlanEntry[];
    };

export default defineTopic<NoParams, PlanningRoundState>({ owner: 'core', scope: 'feed', mode: 'state', maxHz: Infinity });
