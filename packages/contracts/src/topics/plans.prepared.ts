// The planning round (SP4.3d spec §7.1, §7.4, C62d): whether it is open, and the team's prepared plans for the race it
// plans: the entered and suggested race laps and per car of the qualifying session's slots its prepared plans (bridge
// user state, C54, C55).
import type { CarId, Known, PreparedCar, RaceFormat, TeamId } from '@pitwall/domain';
import { defineTopic, type NoParams } from '../topic-def.ts';

/**
 * `open: false` outside the planning round. Open: the race it plans (weekend, format, our team), the race laps the
 * engineer entered (`null` until entered) and the bridge's suggestion, per car slot of the qualifying session its
 * prepared plans (so a link group resolves its car), and whether the planning job is running.
 */
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

export default defineTopic<NoParams, PlanningRound>({ owner: 'core', scope: 'feed', mode: 'state', maxHz: Infinity });
