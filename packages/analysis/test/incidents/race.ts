// Test races for `incidents`: mini-sector histories in the engine's convention (ruling R3) with incidents built in.
// Boundary `s` of lap `L` is the crossing (L, s); segment 0 is the start/finish line at the START of lap L, so the
// crossing that completes lap L is (L + 1, 0). Mini-sector `s` of lap L runs from (L, s) to (L, s + 1), or to
// (L + 1, 0) for s = 49.
import {
  carId,
  known,
  MINI_SECTORS,
  type CarId,
  type CarState,
  type DamageState,
  type FlagPhase,
  type LapRecord,
  type MiniSectorCrossing,
  type PitStopRecord,
  type RaceEvent,
  type SessionKind,
  type SessionState,
} from '@pitwall/domain';
import { historyLengths, type EngineView } from '@pitwall/engine';
import { engineView } from '../../../../test-support/builders/index.ts';
import { incidentsCalculator } from '../../src/incidents/calculator.ts';
import { DAMAGE, type DamageOutput } from '../../src/damage/index.ts';
import { GAPS, type GapsOutput } from '../../src/gaps/index.ts';
import type { IncidentsOutput } from '../../src/incidents/index.ts';

export const PACE_MS = 90_000;
/** One mini-sector at 90 s a lap. */
export const SEGMENT_MS = PACE_MS / MINI_SECTORS;
/** Car `i` starts `i * SPACING_MS` after car 0, so it is that far behind it everywhere: P(i + 1). */
export const SPACING_MS = 700;
export const CARS = 10;
export const LAPS = 8;
/** The test track: 5 000 m (the builder's session), so a mini-sector is 100 m; sector 2 starts at 1 600 m, sector 3 at 3 300 m. */
export const TRACK = { trackLengthM: 5_000, sector2StartM: 1_600, sector3StartM: 3_300 } as const;
/** Our car: car 6, P7. With 700 ms spacing its neighbourhood (±1 position or ±3000 ms) is cars 2..9 except itself. */
export const PLAYER = carId(6);

/** A delay of `ms` in mini-sector `segment` of lap `lap` of a car: every later boundary of that car moves by `ms`. */
export type Delay = { carId: CarId; lap: number; segment: number; ms: number };

/** When car `id` starts lap 1 (crosses (1, 0)). */
export const startOf = (id: number): number => id * SPACING_MS;

/** The undelayed time car `id` crosses boundary `segment` of lap `lap`. */
export const boundaryAt = (id: number, lap: number, segment: number): number =>
  startOf(id) + (lap - 1) * PACE_MS + segment * SEGMENT_MS;

/**
 * Every car runs `laps` laps at 90 s from `startOf(i)`: boundaries (1, 0) .. (laps, 49) plus the closing (laps + 1, 0).
 * `delays` slow a car down in one mini-sector; the list is sorted by time, ties by car id.
 */
export function race({ cars = CARS, laps = LAPS, delays = [] }: { cars?: number; laps?: number; delays?: Delay[] } = {}): MiniSectorCrossing[] {
  const list: MiniSectorCrossing[] = [];
  for (let i = 0; i < cars; i++) {
    const own = delays.filter((d) => d.carId === i);
    const index = (lap: number, segment: number) => (lap - 1) * MINI_SECTORS + segment;
    for (let lap = 1; lap <= laps + 1; lap++) {
      for (let segment = 0; segment < MINI_SECTORS; segment++) {
        if (lap === laps + 1 && segment > 0) break;
        // A delay in mini-sector k moves boundary k + 1 and everything after it.
        const late = own.filter((d) => index(d.lap, d.segment) < index(lap, segment)).reduce((sum, d) => sum + d.ms, 0);
        list.push({ carId: carId(i), lap, segment, at: boundaryAt(i, lap, segment) + late });
      }
    }
  }
  return list.sort((a, b) => a.at - b.at || a.carId - b.carId);
}

/** The history up to and including session time `t` (a prefix of each time-sorted list). */
export const until = <T extends { at: number }>(list: T[], t: number): T[] => list.filter((x) => x.at <= t);

export type RaceInput = {
  miniSectors: MiniSectorCrossing[];
  events?: RaceEvent[];
  flagPhases?: FlagPhase[];
  pitStops?: PitStopRecord[];
  laps?: LapRecord[];
  damage?: DamageOutput;
  gaps?: GapsOutput;
  playerCar?: number;
  config?: Record<string, number | boolean>;
  /** Config of the `alarms` section (the warnings before a penalty). */
  alarmsConfig?: Record<string, number | boolean>;
  kind?: SessionKind;
  /** Merged onto the race session on `TRACK`. */
  session?: Partial<SessionState>;
  /** The neutralised phase in progress (not yet in `flagPhases`). */
  activeFlagPhase?: EngineView['activeFlagPhase'];
  /** Live car states; none by default (the calculator works from the history). */
  cars?: CarState[];
};

/** A race view over this history, everything new; upstream outputs only where given. */
export function viewOf({
  miniSectors,
  events = [],
  flagPhases = [],
  pitStops = [],
  laps = [],
  damage,
  gaps,
  playerCar = PLAYER,
  config = {},
  alarmsConfig = {},
  kind = 'race',
  session = {},
  activeFlagPhase,
  cars = [],
}: RaceInput): EngineView {
  const outputs = new Map<string, unknown>();
  if (damage) outputs.set(DAMAGE, damage);
  if (gaps) outputs.set(GAPS, gaps);
  const last = miniSectors[miniSectors.length - 1];
  return engineView({
    cars,
    activeFlagPhase,
    history: { miniSectors, events, flagPhases, pitStops, laps },
    outputs,
    playerCar,
    config: { incidents: config, alarms: alarmsConfig },
    session: { ...TRACK, kind, ...session },
    sessionTime: last?.at ?? 0,
  });
}

/** `init` over the view, as on a fresh run. */
export const run = (view: EngineView): IncidentsOutput => incidentsCalculator.output(incidentsCalculator.init(view));

/** The delta from one view's history to the next one's. */
export const deltaOf = (from: EngineView, to: EngineView, truncated = false) => ({
  before: historyLengths(from.state.history),
  after: historyLengths(to.state.history),
  truncated,
});

/** `init` over the first view, then `update` through the rest, as the scheduler does. */
export function runSteps(views: EngineView[]): IncidentsOutput {
  const [first, ...rest] = views;
  if (!first) throw new Error('runSteps: no view');
  let acc = incidentsCalculator.init(first);
  let prev = first;
  for (const view of rest) {
    acc = incidentsCalculator.update(acc, deltaOf(prev, view), view);
    prev = view;
  }
  return incidentsCalculator.output(acc);
}

/** A healthy car's damage state with the given jumps. */
export function damageState(jumps: DamageState['jumps']): DamageState {
  const none = known(0, 0);
  const corner = { tyrePct: none, brakePct: none };
  return {
    parts: known(
      { frontLeftWingPct: 0, frontRightWingPct: 0, rearWingPct: 0, floorPct: 0, diffuserPct: 0, sidepodPct: 0, gearboxPct: 0, enginePct: 0 },
      0,
    ),
    corners: { fl: corner, fr: corner, rl: corner, rr: corner },
    drsFault: known(false, 0),
    ersFault: false,
    jumps,
  };
}

/** A green-flag pit stop of a car. */
export const pitStop = (id: CarId, lap: number, pitLaneEntry: number, pitLaneExit: number): PitStopRecord => ({
  carId: id,
  lap,
  pitLaneEntry,
  pitLaneExit,
  pitLaneTimeMs: pitLaneExit - pitLaneEntry,
  stationaryTimeMs: 2_500,
  flag: 'green',
  penaltyServed: false,
});
