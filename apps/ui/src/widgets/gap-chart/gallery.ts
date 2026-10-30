// Gallery declaration of the gap-chart display (spec 9.1). Test-phase file: the implementer does not edit it.
// No realism-hidden case: the gapper is computed from mini-sector crossings, which realism mode does not hide.
import type { CarOverview, SessionInfo } from '@pitwall/contracts';
import { carId, feedId } from '@pitwall/domain';
import type { FlagPhase, GapperLines, SessionState } from '@pitwall/domain';
import { known, unknown } from '@pitwall/domain';
import type { GalleryEntry } from '../../kit/gallery-types.ts';
import type { widget } from './widget.ts';

type Car = { id: number; name: string; teamId: number; raceNumber: number };

// player KUH (id 0) and teammate ZHO (id 1) of team 7, then the other teams
const CARS: Car[] = [
  { id: 0, name: 'Kuhnlein', teamId: 7, raceNumber: 44 },
  { id: 1, name: 'Zhou', teamId: 7, raceNumber: 24 },
  { id: 2, name: 'Verstappen', teamId: 2, raceNumber: 1 },
  { id: 3, name: 'Norris', teamId: 8, raceNumber: 4 },
  { id: 4, name: 'Piastri', teamId: 8, raceNumber: 81 },
  { id: 5, name: 'Leclerc', teamId: 1, raceNumber: 16 },
];

/** Only identity and id matter to the display; the rest of an overview is irrelevant here. */
const overview = (c: Car): CarOverview => ({
  id: carId(c.id),
  identity: {
    name: c.name, teamId: c.teamId, raceNumber: c.raceNumber, nationality: 0, ai: c.id > 0, driverId: c.id,
    networkId: 255, myTeam: false, platform: 0, telemetryPublic: true,
    driverKey: { kind: 'game', driverId: c.id }, visibility: 'public',
  } as unknown as CarOverview['identity'],
  timing: {} as CarOverview['timing'],
  tyres: {} as CarOverview['tyres'],
  stops: 0,
  updatedAt: {},
});
const cars = CARS.map(overview);

const sessionInfo = {
  feedId: feedId('gallery'),
  sessionUid: '1',
  playerCar: carId(0),
  teammateCar: carId(1),
  session: { kind: 'race', totalLaps: 12 } as unknown as SessionState,
  realism: false,
} as unknown as SessionInfo;

/**
 * Gap in ms per lap: `step` ms more each lap, plus `jump.ms` from lap `jump.at` on, so the lines fan out. With
 * `nowLap` the car is that far into its current lap and has a live point there on the same trend; without it the car
 * has just crossed the line (no live point).
 */
const line = (id: number, laps: number, step: number, jump?: { at: number; ms: number }, nowLap?: number): GapperLines['cars'][number] => {
  const gapAt = (lap: number) => step * lap + (jump !== undefined && lap >= jump.at ? jump.ms : 0);
  return {
    carId: carId(id),
    byLap: Array.from({ length: laps }, (_, i) => ({ lap: i + 1, gapMs: gapAt(i + 1) })),
    now: nowLap === undefined ? unknown('notApplicable') : known({ lap: nowLap, gapMs: Math.round(gapAt(nowLap)) }, 0),
  };
};

/** Live, mid-lap: the leader 60 % into lap 13, each car behind it a little less far. */
const liveLap = (rank: number) => 12.6 - 0.03 * rank;

/** The six cars in running order (VER, NOR, LEC, KUH, PIA, ZHO), 12 laps and a live point each; `steps[rank]` per car. */
const liveField = (steps: number[], jump?: { at: number; ms: number }) =>
  [2, 3, 5, 0, 4, 1].map((id, rank) => line(id, 12, steps[rank] ?? 0, jump, liveLap(rank)));

const lines = (over: Partial<GapperLines> = {}): GapperLines => ({
  reference: { kind: 'leaderAverage', carId: unknown('notApplicable') },
  referenceLapMs: known(105_120, 0),
  cars: liveField([0, 300, 600, 900, 1100, 1500]),
  ...over,
});

const scPhase = (startLap: number, endLap: number): FlagPhase => ({
  kind: 'SC', start: startLap * 100_000, end: endLap * 100_000, startLeaderLap: startLap, endLeaderLap: endLap, scPhases: [],
});

const bunch = { at: 8, ms: -4000 };
const base = { gapper: lines(), phases: [] as FlagPhase[], cars, session: sessionInfo };

/** Synthetic cases and fit expectations for `gap-chart`. */
const gallery: GalleryEntry<typeof widget> = {
  moments: ['raceSingaporeEnd.chequered'],
  cases: {
    // an SC band across laps 5 to 7: the field bunches, every car gains 4 s from lap 8 on; every car has just crossed
    // the line, so no line has a live segment
    safetyCarBand: {
      ...base,
      phases: [scPhase(5, 7)],
      gapper: lines({
        cars: [line(2, 12, 0, bunch), line(3, 12, 300, bunch), line(5, 12, 600, bunch), line(0, 12, 900, bunch), line(4, 12, 1100, bunch), line(1, 12, 1500, bunch)],
      }),
    },
    // default reference; our car white and thicker, the teammate dashed, McLaren's second car dashed; mid-lap, so each
    // line runs dotted from lap 12 to its live point
    greenFlag: base,
    // a train within a second of the leader, ZHO far behind: five lines end within one text row, so their end labels
    // are pushed apart in gap order; where the plot is too low for all of them (compact), KUH's label and the nearest
    // to it stay and the rest are dropped (their lines stay)
    closeTogether: {
      ...base,
      gapper: lines({ cars: liveField([0, 20, 40, 60, 80, 1500]) }),
    },
    // an SC that ended as the leader completed lap 12 (the field bunched from lap 10): the band stops at lap 12 and the
    // dotted live segments run on past it, so the chart shows the SC is over
    scEnded: {
      ...base,
      phases: [scPhase(9, 12)],
      gapper: lines({ cars: liveField([0, 300, 600, 900, 1100, 1500], { at: 10, ms: -4000 }) }),
    },
    virtualSafetyCarAndRed: { ...base, phases: [{ ...scPhase(3, 4), kind: 'VSC' }, { ...scPhase(9, 9), kind: 'red' }] },
    // retired car: its line stops at lap 7, no live point; lapped car: it has completed fewer laps than the leader and
    // its live point is in its own lap 11
    retiredAndLapped: {
      ...base,
      gapper: lines({
        cars: [line(2, 12, 0, undefined, liveLap(0)), line(3, 12, 300, undefined, liveLap(1)), line(0, 12, 900, undefined, liveLap(2)), line(4, 7, 1100), line(1, 10, 1500, undefined, 10.5)],
      }),
    },
    fixedReference: { ...base, gapper: lines({ referenceLapMs: known(100_000, 0) }) },
    referenceUnknown: { ...base, gapper: lines({ referenceLapMs: unknown('insufficientData'), cars: [] }) },
    noSession: { ...base, session: undefined },
    empty: { ...base, gapper: lines({ referenceLapMs: unknown('insufficientData'), cars: [] }), cars: [] },
  },
  // Task 38: one size at each mode's minimum plus the edges just inside it.
  fit: [
    { mode: 'compact', cols: 36, rows: 8 },
    { mode: 'compact', cols: 54, rows: 10 },
    { mode: 'compact', cols: 71, rows: 13 },
    { mode: 'full', cols: 72, rows: 14 },
    { mode: 'full', cols: 90, rows: 17 },
  ],
};

export default gallery;
