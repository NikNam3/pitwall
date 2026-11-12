// Synthetic races of the `race-interaction` tests (SP4.3a spec 5.4): a few cars on a two-zone track, their crossings
// evenly spaced over each lap (`crossings`), their laps engine-shaped (provisional then confirmed, `engine-shaped.ts`),
// every fact describing the frame numbered by its race-clock time (frame = ms), so frames and times keep one order (C26).
import { carId, known, type LapRecord, type MiniSectorCrossing, type PitStopRecord, type PriorsSnapshot, type TrackData, type WeekendPhase } from '@pitwall/domain';
import type { EngineView, Projection } from '@pitwall/engine/readers';
import { carState, crossings, history, lap } from '../../../../test-support/builders/index.ts';
import { zandvoortTrack } from '../../../../test-support/track.ts';
import { engineShaped } from '../engine-shaped.ts';
import { openSpan, RACE, situatedView } from '../situated.ts';

/**
 * The scene's track: two braking zones (zone 0 at 0.20–0.24, zone 1 at 0.60–0.64) and one DRS zone just before zone 0
 * (detection 0.10, open 0.12–0.19); the rest is Zandvoort's file.
 */
export const TRACK: TrackData = {
  ...zandvoortTrack(),
  brakingZones: known([
    { start: 0.2, end: 0.24 },
    { start: 0.6, end: 0.64 },
  ], 0),
  drsZones: known([{ detection: 0.1, start: 0.12, end: 0.19 }], 0),
};

/** One car's race: it crosses the line of lap 1 at `startAt` and then laps in `lapTimes[n - 1]` (lap n). */
export type CarRun = {
  car: number;
  startAt: number;
  lapTimes: number[];
  /** Its in laps: each gets a green pit stop at its end (entry 5 s before the line, exit 15 s after) and the next lap is its out lap. */
  inLaps?: number[];
  /** Per lap number, fields of its lap record. */
  over?: Record<number, Partial<LapRecord>>;
};

export type Scene = { laps: LapRecord[]; crossings: MiniSectorCrossing[]; pitStops: PitStopRecord[] };

/** The facts of `runs`: per car its laps (engine-shaped), its 50 crossings a lap plus the closing line, its pit stops. */
export function scene(runs: readonly CarRun[]): Scene {
  const pairs: LapRecord[][] = [];
  const all: MiniSectorCrossing[] = [];
  const pitStops: PitStopRecord[] = [];
  const ends = new Map<number, { car: number; at: number }[]>();
  for (const run of runs) {
    let at = run.startAt;
    run.lapTimes.forEach((lapTimeMs, i) => {
      const n = i + 1;
      all.push(...crossings(carId(run.car), n, lapTimeMs, at).map((c) => ({ ...c, frame: c.at })));
      at += lapTimeMs;
      (ends.get(n) ?? ends.set(n, []).get(n)!).push({ car: run.car, at });
    });
    all.push({ carId: carId(run.car), lap: run.lapTimes.length + 1, segment: 0, at, frame: at });
  }
  for (const run of runs) {
    let at = run.startAt;
    run.lapTimes.forEach((lapTimeMs, i) => {
      const n = i + 1;
      at += lapTimeMs;
      const inLap = run.inLaps?.includes(n) ?? false;
      const positionAtEnd = [...ends.get(n)!].sort((a, b) => a.at - b.at || a.car - b.car).findIndex((e) => e.car === run.car) + 1;
      const record = lap({
        carId: carId(run.car),
        lapNumber: n,
        lapTimeMs,
        completedAt: at,
        frame: at,
        tyreAgeAtStart: n - 1,
        inLap,
        outLap: run.inLaps?.includes(n - 1) ?? false,
        positionAtEnd,
        ...run.over?.[n],
      });
      pairs.push(engineShaped([record]));
      if (inLap) {
        pitStops.push({
          carId: carId(run.car), lap: n, pitLaneEntry: at - 5_000, pitLaneExit: at + 15_000, pitLaneTimeMs: 20_000, stationaryTimeMs: 2_500,
          flag: 'green', penaltyServed: false, frame: at + 15_000,
        });
      }
    });
  }
  pairs.sort((a, b) => a[0]!.completedAt - b[0]!.completedAt || a[0]!.carId - b[0]!.carId);
  all.sort((a, b) => a.at - b.at || a.carId - b.carId);
  pitStops.sort((a, b) => a.frame - b.frame);
  return { laps: pairs.flat(), crossings: all, pitStops };
}

/** The scene's facts that describe frames up to `frame`: the projection as it stood then. */
export const cutAt = (s: Scene, frame: number): Scene => ({
  laps: s.laps.filter((l) => l.frame <= frame),
  crossings: s.crossings.filter((c) => c.frame <= frame),
  pitStops: s.pitStops.filter((p) => p.frame <= frame),
});

/** The scene as a projection. */
export const projectionOf = (s: Scene): Projection => history({ laps: s.laps, crossings: s.crossings, pitStops: s.pitStops });

/**
 * The race view of a scene: cars `0..cars - 1` competing, session phase `racing`, the scene's track, AI difficulty
 * `aiDifficulty` (default 62, band 0 of the default bands), `priors` when given.
 */
export function raceView(
  s: Scene,
  o: { cars?: number; aiDifficulty?: number; priors?: PriorsSnapshot; phase?: WeekendPhase; delta?: EngineView['delta']; sessionTime?: number } = {},
): EngineView {
  const cars = o.cars ?? 3;
  const phase = o.phase ?? RACE;
  return situatedView({
    phase,
    cars: Array.from({ length: cars }, (_, id) => carState({ id: carId(id) })),
    history: projectionOf(s),
    track: known(TRACK, 0),
    session: { settings: { aiDifficulty: o.aiDifficulty ?? 62 } },
    spans: phase.kind === 'race' ? [openSpan('session-phase-race', 'racing')] : [],
    ...(o.priors !== undefined && { priors: known(o.priors, 0) }),
    ...(o.delta !== undefined && { delta: o.delta }),
    sessionTime: o.sessionTime ?? (s.crossings.at(-1)?.at ?? 0),
  });
}

/** `n` laps of `ms` each. */
export const laps = (n: number, ms: number): number[] => Array.from({ length: n }, () => ms);
