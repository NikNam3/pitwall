// `crossover` (spec 3.4, B8, B9): the field's lap times per tyre type against our car's, the dry reference, the 110 %
// line, our %, the first car on another type faster than us and the laps a switch takes to pay back. Builder data;
// every case runs through the guarded view (C41); race only (C14), the weekend phase from its open span.
import {
  carId,
  known,
  SPAN_DECLARATIONS,
  unknown,
  type ActualCompound,
  type Crossover,
  type CrossoverLap,
  type EstimateSource,
  type Known,
  type LapRecord,
  type Ms,
  type PitLosses,
  type PitLossEstimate,
  type Span,
  type TyreType,
  type WeekendPhase,
} from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { crossoverCalculator } from '../../src/crossover/calculator.ts';
import { CROSSOVER, CROSSOVER_CONFIG } from '../../src/crossover/index.ts';
import { tyreTypeOf } from '../../src/crossover/tyre-type.ts';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { lap, neutralisation, RACE_PHASES } from '../../../../test-support/builders/index.ts';
import { guardedQuick, PRACTICE, QUALIFYING, RACE, situatedView } from '../situated.ts';

const calc = guardedQuick(crossoverCalculator);

/** Our car (the player's, `playerCar` 0). */
const US = 0;

/** What a lap of `L` may set besides its car, number, time and compound. */
type LapOver = Partial<LapRecord> & { sectors?: [number, number, number] };

/**
 * Lap `n` of car `car` in `ms` on `compound`: completed at `n · 100 000 + car · 100` (so within a lap number the cars
 * complete in id order), describing the frame of that time (C26); sectors given or thirds of the lap.
 */
function L(car: number, n: number, ms: number, compound: ActualCompound = 'C3', over: LapOver = {}): LapRecord {
  const { sectors, ...rest } = over;
  const completedAt = rest.completedAt ?? n * 100_000 + car * 100;
  return lap({
    carId: carId(car),
    lapNumber: n,
    lapTimeMs: ms,
    actualCompound: compound,
    completedAt,
    frame: completedAt,
    ...(sectors && { sectorTimesMs: sectors }),
    ...rest,
  });
}

/** Our laps on lap 12 in 98 800 ms on slicks, sectors 30 000, 31 000, 37 800. */
const OUR_LAP_12 = (): LapRecord => L(US, 12, 98_800, 'C3', { sectors: [30_000, 31_000, 37_800] });

/** The slick laps of lap 10 (median 90 400) and lap 11 (median 92 000) of cars 1, 2, 3. */
const DRY_REF_LAPS = (): LapRecord[] => [
  L(1, 10, 90_000),
  L(2, 10, 90_400),
  L(3, 10, 91_000),
  L(1, 11, 91_500),
  L(2, 11, 92_000),
  L(3, 11, 92_500),
];

/** The source of the green pit loss (`pit-loss`'s badge). */
const LOSS_SOURCE: EstimateSource = { kind: 'session', sessionShare: 1, parts: '3 stops' };

/** One condition's pit-loss estimate. */
const estimate = (lossMs: Known<Ms>, source: EstimateSource = LOSS_SOURCE): PitLossEstimate => ({ lossMs, inLapShare: unknown('notReceived'), stationaryMedianMs: known(2_500, 0), sessionStops: 3, source });

/** `pit-loss`'s output with this green loss (VSC and SC unknown). */
const pitLosses = (green: Known<Ms> = known(21_000, 0)): PitLosses => ({
  conditions: { green: estimate(green), vsc: estimate(unknown('insufficientData')), sc: estimate(unknown('insufficientData')) },
  stops: [],
});

/** The view of a session holding `laps` (sorted by completion), closed session-phase spans, `pit-loss`'s output and a phase. */
function view(
  laps: LapRecord[],
  o: { phase?: WeekendPhase; spans?: Span[]; loss?: PitLosses; teammate?: number; config?: EngineView['config'] } = {},
): EngineView {
  const spans: Record<string, Span[]> = {};
  for (const span of o.spans ?? []) (spans[span.machine] ??= []).push(span);
  const v = situatedView({
    phase: o.phase ?? RACE,
    history: { laps: [...laps].sort((a, b) => a.completedAt - b.completedAt), spans },
    outputs: new Map<string, unknown>([[PIT_LOSS, o.loss ?? pitLosses()]]),
    config: o.config ?? {},
  });
  return o.teammate === undefined ? v : { ...v, live: { ...v.live, teammateCar: carId(o.teammate) } };
}

/** Our car's crossover in `v`. */
const ours = (v: EngineView, car = US): Crossover => {
  const out = calc.compute(v)[carId(car)];
  if (out === undefined) throw new Error(`no crossover for car ${car}`);
  return out;
};

/** The medians of lap number `n`. */
const lapOf = (c: Crossover, n: number): CrossoverLap['medianMs'] => {
  const row = c.byLap.find((l) => l.lapNumber === n);
  if (row === undefined) throw new Error(`no byLap row for lap ${n}`);
  return row.medianMs;
};

const valueOf = <T>(k: Known<T>): T => {
  if (!k.known) throw new Error(`unknown: ${k.reason}`);
  return k.value;
};

const INSUFFICIENT = unknown('insufficientData');
const NOT_APPLICABLE = unknown('notApplicable');

describe('crossover calculator', () => {
  it('is the quick calculator `crossover` per frame over laps, identity, pit-loss, weekend-phase and session-phase-race', () => {
    expect(crossoverCalculator.id).toBe(CROSSOVER);
    expect(crossoverCalculator.kind).toBe('quick');
    expect(crossoverCalculator.cadence).toBe('frame');
    expect(crossoverCalculator.reads).toEqual(
      expect.arrayContaining(['laps', 'identity', { calculator: PIT_LOSS }, 'spans:weekend-phase', 'spans:session-phase-race']),
    );
  });

  // 1
  it('tyreTypeOf: inter → inter; wet, classicWet, f2Wet → wet; unknown → undefined; every other compound → slick', () => {
    const cases: Record<ActualCompound, TyreType | undefined> = {
      C0: 'slick',
      C1: 'slick',
      C2: 'slick',
      C3: 'slick',
      C4: 'slick',
      C5: 'slick',
      C6: 'slick',
      inter: 'inter',
      wet: 'wet',
      classicDry: 'slick',
      classicWet: 'wet',
      f2SuperSoft: 'slick',
      f2Soft: 'slick',
      f2Medium: 'slick',
      f2Hard: 'slick',
      f2Wet: 'wet',
      unknown: undefined,
    };
    for (const [compound, type] of Object.entries(cases)) expect([compound, tyreTypeOf(compound as ActualCompound)]).toEqual([compound, type]);
  });

  // 2
  it('no green slick lap yet: dryRefMs, line110Ms and ourPct are insufficientData', () => {
    // only inter laps, ours among them, and one SC slick lap (not green)
    const c = ours(view([L(US, 5, 100_000, 'inter'), L(1, 5, 99_000, 'inter'), L(2, 5, 95_000, 'C3', { scShare: 0.5 })]));
    expect(c.dryRefMs).toEqual(INSUFFICIENT);
    expect(c.line110Ms).toEqual(INSUFFICIENT);
    expect(c.ourPct).toEqual(INSUFFICIENT);
  });

  // 3
  it('the dry reference is the lowest slick median so far, the 110 % line 1.1 times it', () => {
    const c = ours(view(DRY_REF_LAPS()));
    expect(lapOf(c, 10).slick).toMatchObject({ known: true, value: 90_400 });
    expect(lapOf(c, 11).slick).toMatchObject({ known: true, value: 92_000 });
    expect(c.dryRefMs).toMatchObject({ known: true, value: 90_400 });
    expect(valueOf(c.line110Ms)).toBeCloseTo(99_440, 6);
  });

  // 4
  it('ourPct is our latest green lap over the dry reference, as a percentage', () => {
    const c = ours(view([...DRY_REF_LAPS(), OUR_LAP_12()]));
    expect(c.ourType).toMatchObject({ known: true, value: 'slick' });
    expect(valueOf(c.ourPct)).toBeCloseTo(109.29, 2);
  });

  // 5
  it('firstFaster: the first car on another type whose sector beats ours on the same lap number', () => {
    const laps = [
      ...DRY_REF_LAPS(),
      OUR_LAP_12(),
      // a slick car (our own type) faster in sector 1 on lap 12: never counts
      L(4, 12, 97_000, 'C3', { sectors: [29_000, 31_000, 37_000] }),
      // car 7 on inters: slower in sectors 1 and 3, faster in sector 2 (30 100 against our 31 000)
      L(7, 12, 101_100, 'inter', { sectors: [31_000, 30_100, 40_000] }),
      // car 9 on inters completes lap 12 after car 7, faster in sector 1: car 7 is first
      L(9, 12, 100_000, 'inter', { sectors: [29_500, 31_500, 39_000] }),
      // our lap 13, and car 8 on wets faster in sector 3 on it: a later lap, car 7 stays first
      L(US, 13, 98_900, 'C3', { sectors: [30_000, 31_000, 37_900] }),
      L(8, 13, 99_000, 'wet', { sectors: [31_000, 32_000, 36_000] }),
    ];
    const c = ours(view(laps));
    expect(c.firstFaster).toMatchObject({ known: true, value: { carId: carId(7), type: 'inter', sector: 2, lapNumber: 12 } });
  });

  // 5a
  it('after our switch to inters firstFaster is searched against inters: notApplicable until a slick car beats us, then that car', () => {
    const before = [
      ...DRY_REF_LAPS(),
      OUR_LAP_12(),
      // a slick car slower than us in every sector on lap 12
      L(4, 12, 100_000, 'C3', { sectors: [30_500, 31_500, 38_000] }),
      // car 7 on inters faster in sector 2 on lap 12: the answer while we are on slicks
      L(7, 12, 101_100, 'inter', { sectors: [31_000, 30_100, 40_000] }),
    ];
    expect(ours(view(before)).firstFaster).toMatchObject({ known: true, value: { carId: carId(7), type: 'inter', sector: 2, lapNumber: 12 } });
    // we pit at the end of lap 14 onto inters and complete lap 15 (our out lap) on them; car 4 on slicks slower everywhere
    const switched = [
      ...before,
      L(US, 13, 99_000, 'C3', { sectors: [30_000, 31_000, 38_000] }),
      L(4, 13, 100_000, 'C3', { sectors: [30_500, 31_500, 38_000] }),
      L(US, 14, 120_000, 'C3', { inLap: true, sectors: [30_000, 31_000, 59_000] }),
      L(US, 15, 125_000, 'inter', { outLap: true, sectors: [50_000, 35_000, 40_000] }),
      L(4, 15, 100_000, 'C3', { sectors: [51_000, 36_000, 41_000] }),
    ];
    const onInters = ours(view(switched));
    expect(onInters.ourType).toMatchObject({ known: true, value: 'inter' });
    expect(onInters.firstFaster).toEqual(NOT_APPLICABLE);
    // lap 16: our green lap on inters, car 4 on slicks faster in sector 3
    const later = [...switched, L(US, 16, 99_000, 'inter', { sectors: [31_000, 32_000, 36_000] }), L(4, 16, 98_000, 'C3', { sectors: [31_500, 32_500, 34_000] })];
    expect(ours(view(later)).firstFaster).toMatchObject({ known: true, value: { carId: carId(4), type: 'slick', sector: 3, lapNumber: 16 } });
  });

  // 6
  it('a dry race: inter and wet medians insufficientData, firstFaster and payback notApplicable', () => {
    const c = ours(view([...DRY_REF_LAPS(), OUR_LAP_12(), L(1, 12, 92_000), L(2, 12, 92_500)]));
    for (const n of [10, 11, 12]) {
      expect(lapOf(c, n).inter).toEqual(INSUFFICIENT);
      expect(lapOf(c, n).wet).toEqual(INSUFFICIENT);
    }
    expect(c.firstFaster).toEqual(NOT_APPLICABLE);
    expect(c.payback).toEqual(NOT_APPLICABLE);
  });

  // 7
  it('payback: the green pit loss over our latest green lap minus the fastest other type`s latest median', () => {
    // inters: lap 11 median 99 000 (older), lap 12 median 97 100 (latest); we are on slicks at 98 800 on lap 12
    const inters = (lap12: [number, number, number]) => [
      L(7, 11, 99_000, 'inter'),
      L(7, 12, lap12[0], 'inter'),
      L(8, 12, lap12[1], 'inter'),
      L(9, 12, lap12[2], 'inter'),
    ];
    const laps = [...DRY_REF_LAPS(), OUR_LAP_12(), ...inters([97_000, 97_100, 97_300])];
    const c = ours(view(laps));
    expect(lapOf(c, 12).inter).toMatchObject({ known: true, value: 97_100 });
    const payback = valueOf(c.payback);
    expect(payback.laps).toBeCloseTo(12.35, 2);
    expect(payback.lossSource).toEqual(LOSS_SOURCE);
    // inters slower than us: no other type is faster
    expect(ours(view([...DRY_REF_LAPS(), OUR_LAP_12(), ...inters([99_000, 99_100, 99_300])])).payback).toEqual(NOT_APPLICABLE);
    // the green pit loss unknown
    expect(ours(view(laps, { loss: pitLosses(unknown('insufficientData')) })).payback).toEqual(INSUFFICIENT);
  });

  // 8
  it('a superseded provisional counts once; SC, VSC and suspended laps are not green; a restart lap with 900 ms of SC is', () => {
    // counted alone it gives median 91 500, counted with its confirmed lap 91 000
    const provisional = L(1, 10, 92_000, 'C3', { status: 'provisional', completedAt: 1_000_050 });
    const base = [
      provisional,
      L(2, 10, 90_400),
      L(3, 10, 91_000),
      // SC lap, VSC lap with its neutralised time at maxNeutralisedMs (0.025 · 80 000 = 2 000 ms), a lap completed under suspension
      L(4, 10, 80_000, 'C3', { scShare: 0.5 }),
      L(5, 10, 80_000, 'C3', { vscShare: 0.025 }),
      L(6, 10, 80_000, 'C3', { completedAt: 1_055_000 }),
      // a restart lap with 900 ms of SC: green
      L(7, 10, 95_000, 'C3', { scShare: 900 / 95_000 }),
    ];
    const sorted = [...base].sort((a, b) => a.completedAt - b.completedAt);
    const index = sorted.indexOf(provisional);
    // car 1's confirmed lap 10 at 90 000 supersedes the provisional (C25)
    const confirmed = L(1, 10, 90_000, 'C3', { completedAt: 1_100_000, frame: 1_000_050, supersedes: { list: 'laps', index } });
    const red = neutralisation({ kind: 'red', start: 1_050_000, end: 1_060_000, machine: RACE_PHASES });
    const c = ours(view([...sorted, confirmed], { spans: [red] }));
    // green: 90 000, 90 400, 91 000, 95 000 → median 90 700
    expect(lapOf(c, 10).slick).toMatchObject({ known: true, value: 90_700 });
  });

  // 9
  it('outputs only our cars; ourType is our latest lap`s compound', () => {
    const laps = [...DRY_REF_LAPS(), L(US, 10, 92_000, 'C3'), L(US, 11, 99_000, 'inter'), L(5, 11, 99_500, 'C3')];
    const solo = calc.compute(view(laps));
    expect(Object.keys(solo).map(Number)).toEqual([US]);
    expect(solo[carId(3)]).toBeUndefined();
    expect(solo[carId(US)]!.ourType).toMatchObject({ known: true, value: 'inter' });
    const withTeammate = calc.compute(view(laps, { teammate: 5 }));
    expect(Object.keys(withTeammate).map(Number).sort((a, b) => a - b)).toEqual([US, 5]);
    expect(withTeammate[carId(1)]).toBeUndefined();
    expect(withTeammate[carId(5)]!.ourType).toMatchObject({ known: true, value: 'slick' });
  });

  // 10
  it('config minCars 2: a type with one car on a lap is insufficientData', () => {
    const laps = [...DRY_REF_LAPS(), L(7, 10, 97_000, 'inter')];
    const c = ours(view(laps, { config: { [CROSSOVER_CONFIG.key]: { minCars: 2 } } }));
    expect(lapOf(c, 10).inter).toEqual(INSUFFICIENT);
    expect(lapOf(c, 10).slick).toMatchObject({ known: true, value: 90_400 });
    // with the default (1) the one inter car is the median
    expect(lapOf(ours(view(laps)), 10).inter).toMatchObject({ known: true, value: 97_000 });
  });

  it('runs on the guarded view (C41): a full race view computes without an undeclared read', () => {
    expect(() => calc.compute(view([...DRY_REF_LAPS(), OUR_LAP_12(), L(7, 12, 97_000, 'inter')], { spans: [neutralisation()] }))).not.toThrow();
  });

  it('holds its behaviour table (C44): session-phase-race suspended excluded, every other kind {}; weekend-phase race computed, the rest notApplicable', async () => {
    // `pending` is no weekend-phase kind (no span yet, C14): it has no row and reads as the race (row 11)
    const index = (await import('../../src/crossover/index.ts')) as Record<string, unknown>;
    const kinds = SPAN_DECLARATIONS.find((d) => d.machine === 'session-phase-race')!.kinds;
    const phaseRows = Object.fromEntries(kinds.map((k) => [k, k === 'suspended' ? { excluded: true } : {}]));
    expect(index['CROSSOVER_BEHAVIOUR']).toEqual({
      'session-phase-race': phaseRows,
      'weekend-phase': {
        race: { isRace: true },
        practice: { notApplicable: true },
        qualifying: { notApplicable: true },
        none: { notApplicable: true },
      },
    });
  });

  // 11
  it('race only (B8): in qualifying and practice every field is notApplicable; a pending phase computes as the race', () => {
    const laps = [...DRY_REF_LAPS(), OUR_LAP_12(), L(7, 12, 97_000, 'inter')];
    for (const phase of [QUALIFYING, PRACTICE]) {
      const c = ours(view(laps, { phase }));
      expect(c.byLap).toEqual([]);
      for (const field of ['ourType', 'dryRefMs', 'line110Ms', 'ourPct', 'firstFaster', 'payback'] as const) expect([phase.kind, field, c[field]]).toEqual([phase.kind, field, NOT_APPLICABLE]);
    }
    expect(ours(view(laps, { phase: { kind: 'pending' } }))).toEqual(ours(view(laps)));
  });
});
