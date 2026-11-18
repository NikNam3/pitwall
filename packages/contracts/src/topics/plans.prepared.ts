// The planning round (C62d, SP4.3e spec §4.3): whether it is open, the qualifying it replays, its practice basis and
// race assumptions, per car of the qualifying session's slots its prepared plans, and the team's saved plans on the
// track (bridge user state, C54, C55).
import type { CarId, ForecastSample, Known, PreparedCar, RoundRace, SessionRef, TeamId, TrackId } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

/** A saved plan as the picker lists it: the team's saved plans on the track, also while no round is open (SP4.3e R15). */
export type SavedPlanEntry = { id: string; name: string; savedAt: string };

export type { RoundRace } from '@pitwall/domain';

/** The forecast the round computes with: per row the sample and whether the user's entry differs from the imported row at its offset. */
export type RoundForecast = {
  /** The session the imported samples come from (the round's qualifying) and its start date (ISO). */
  source: { ref: SessionRef; startedAt: string };
  /** `unknown('notReceived')` while the replay has not returned, or with no race samples and none entered (C3). */
  rows: Known<{ sample: ForecastSample; overridden: boolean }[]>;
};

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
      trackId: TrackId;
      /** Slots of the replayed recording (C62: cars are matched by team and race number in `cars`). */
      playerCar: CarId;
      teammateCar: CarId | null;
      forecast: RoundForecast;
      /** A pick is being rebuilt (C61). */
      rebuilding: boolean;
      /** By car slot of the qualifying (`CarId`). */
      cars: Record<number, PreparedCar>;
      running: boolean;
      saved: SavedPlanEntry[];
      /** The saved plan this round was last saved as (SP4.3f Task 10); absent or `null` until a save. */
      lastSaved?: SavedPlanEntry | null;
    };

export default defineTopic<NoParams, PlanningRoundState>({ owner: 'core', scope: 'feed', mode: 'state', maxHz: Infinity });
