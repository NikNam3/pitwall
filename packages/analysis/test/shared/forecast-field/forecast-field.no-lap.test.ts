// A car without a lap in the starting point (SP4.3c Task 13 fix round 2, ruling R47; C3, C43). Which car's lap stands
// in for a car without any lap is `degradation`'s judgement alone: its field stand-in (`standIn`) names the car
// (`fromCarId`: the most laps, the first to complete its newest). `forecast-field` takes a lap-less car's compound,
// tyre age and lap record from that car, and its pace from the stand-in's base pace; it picks no stand-in lap of its
// own. The race order and the leader for placement and gaps stay `gaps`' (a live build) or the crossings' (another
// judgement): here gaps' leader is a different car from the stand-in's, so the two must not be confused.
import { carId, NOISE_COMPOUNDS, type CarId, type LapRecord, type StartingPoint } from '@pitwall/domain';
import { asOfNow, type AsOfView, type CalculatorId, type Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION, type DegradationOutput } from '../../../src/degradation/index.ts';
import { GAPS } from '../../../src/gaps/index.ts';
import { buildStartingPoint } from '../../../src/shared/forecast-field/index.ts';
import { gapsOutput, orderOf } from '../../gaps/output.ts';
import { generated, materialised, PARAMS, plainNoise, upstreamOf } from './support.ts';

/** The generator race's human cars: slots 6 and 7. */
const HUMANS = [6, 7];
/** The stand-in car's lap 1 as this test rewrites it: a compound and a tyre age no other car's lap 1 has. */
const STAND_IN_COMPOUND = 'soft';
const STAND_IN_AGE = 3;

const g = generated();

/** The cars with at least one lap record in `view`. */
const carsWithLaps = (view: AsOfView): Set<CarId> => new Set((view.history.laps as readonly LapRecord[]).map((l) => l.carId));

/**
 * The first frame of the leader's lap 2 at which at least two cars have completed lap 1 and at least one has not: the
 * race's first strategy run, with a second car to stand as gaps' leader.
 */
function firstLapTwoFrame(): number {
  for (const frame of g.race.framesOfLap(2)) {
    const n = carsWithLaps(materialised(asOfNow(g.viewAt(frame)))).size;
    if (n >= 2 && n < PARAMS.cars) return frame;
  }
  throw new Error('no frame on lap 2 with two cars past lap 1 and one without a lap');
}

/** The value of a starting point the test needs known. */
function valueOf(sp: ReturnType<typeof buildStartingPoint>, what: string): StartingPoint {
  if (!sp.known) throw new Error(`${what}: the starting point is unknown (${sp.reason})`);
  return sp.value;
}

describe("a car without a lap takes degradation's stand-in car (SP4.3c Task 13 fix round 2, R47)", () => {
  const frame = firstLapTwoFrame();
  const base = materialised(asOfNow(g.viewAt(frame)));
  // the first car to complete lap 1: degradation's stand-in car on the unchanged laps
  const firstDone = [...(base.history.laps as readonly LapRecord[])].filter((l) => l.lapNumber === 1).sort((a, b) => a.completedAt - b.completedAt)[0]!.carId;
  // that car's lap 1 on another compound and tyre age than every other car's
  const laps = (base.history.laps as readonly LapRecord[]).map((l): LapRecord =>
    l.carId === firstDone && l.lapNumber === 1 ? { ...l, visualCompound: STAND_IN_COMPOUND, tyreAgeAtStart: STAND_IN_AGE } : l,
  );
  const view: AsOfView = { ...base, history: { ...base.history, laps } as Projection };
  const withLaps = carsWithLaps(view);
  const noLap = Array.from({ length: PARAMS.cars }, (_, k) => carId(k)).filter((k) => !withLaps.has(k));
  // gaps' leader: another car that has completed lap 1 (gaps' order is a different judgement from the stand-in's car)
  const gapsLeader = [...withLaps].find((k) => k !== firstDone)!;
  const order = [gapsLeader, ...Array.from({ length: PARAMS.cars }, (_, k) => carId(k)).filter((k) => k !== gapsLeader)];

  const upstream = upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at));
  const outputs = new Map<CalculatorId, unknown>([...upstream, [GAPS, gapsOutput({ intervals: orderOf(order) })]]);
  const degradation = upstream.get(DEGRADATION) as DegradationOutput;

  it('precondition: cars without a lap, the stand-in names the first car to finish lap 1, and gaps leads with another', () => {
    expect(noLap.length).toBeGreaterThan(0);
    expect(gapsLeader).not.toBe(firstDone);
    expect(degradation.standIn.known).toBe(true);
    if (!degradation.standIn.known) return;
    expect(degradation.standIn.value.fromCarId).toBe(firstDone);
    expect(degradation.standIn.value.compound).toBe(STAND_IN_COMPOUND);
    // a lap-less car has no stint of its own
    for (const k of noLap) expect(degradation.stints[k] ?? [], `car ${k}`).toEqual([]);
  });

  it("the order and its leader stay gaps'", () => {
    const sp = valueOf(buildStartingPoint(view, outputs), 'lap 2');
    expect(Array.from(sp.order)).toEqual(order);
  });

  it("a lap-less car takes fromCarId's compound and tyre age (not gaps' leader's), and the stand-in's base pace", () => {
    const sp = valueOf(buildStartingPoint(view, outputs), 'lap 2');
    if (!degradation.standIn.known) throw new Error('no stand-in');
    const standIn = degradation.standIn.value;
    for (const k of noLap) {
      expect(NOISE_COMPOUNDS[sp.compound[k]!], `car ${k}: compound`).toBe(STAND_IN_COMPOUND);
      expect(sp.tyreAge[k], `car ${k}: tyre age`).toBe(STAND_IN_AGE);
      // the pace on the reference compound: the stand-in's base pace less its compound's offset
      expect(sp.paceMs[k]! + sp.lapModel.compoundOffsetMs[STAND_IN_COMPOUND], `car ${k}: pace`).toBeCloseTo(standIn.basePaceMs, 6);
    }
  });
});
