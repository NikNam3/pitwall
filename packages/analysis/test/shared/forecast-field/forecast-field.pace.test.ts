// A car's pace in the starting point is `degradation`'s (SP4.3c Task 13, spec §5.3 O2, B9; C3, C43).
//  - B9: a stint fitted without fuel (`fuelCorrected: false`, its pace laps' fuel unknown) has a base pace that already
//    holds the car's fuel. The lap model adds `fuelMsPerKg × fuelKg` on top of the pace, so such a car's fuel would count
//    twice. The rule: `degradation` marks that base pace `fuelIncluded: true`, and `forecast-field` gives the lap model
//    that car's fuel term as 0 (one rule, in forecast-field); a fuel-corrected car keeps its fuel term.
//  - The raw-lap fallback is deleted: a running car without a known base pace (no paced stint) is no made-up pace from
//    its newest lap; the build is `insufficientData` (C3: forecast-field's `Needs`, a missing value makes the whole
//    starting point unknown). A retired car is not run by the simulators, so its pace is not needed.
import { carId, known, NOISE_COMPOUNDS, tyreIndex, unknown, type CarId, type LapInput, type LapRecord, type OpenSpan, type StartingPoint } from '@pitwall/domain';
import { asOfNow, type AsOfView, type CalculatorId, type Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { DEGRADATION, type DegradationOutput, type StintDegradation } from '../../../src/degradation/index.ts';
import { lapTimeMs } from '../../../src/lap-model/index.ts';
import { buildStartingPoint } from '../../../src/shared/forecast-field/index.ts';
import { generated, materialised, PARAMS, plainNoise, upstreamOf } from './support.ts';

/** The generator race's human cars: slots 6 and 7. */
const HUMANS = [6, 7];
/** The rival whose fuel the B9 rows hide: an AI car, not the leader. */
const RIVAL = carId(2);
/** A fuel-corrected car of the same build, the control. */
const CONTROL = carId(3);
/** The rival's fuel at the end of its newest lap, the only fuel of its laps the build can read. */
const FUEL_KG = 100;

const g = generated();

/** The view after lap 7's first frame (every car in its first stint, every one paced), its projection changed by `history`. */
function viewAtLap7(history: (h: Projection) => Projection = (h) => h): AsOfView {
  const view = materialised(asOfNow(g.viewAt(g.race.framesOfLap(7)[0]!)));
  return { ...view, history: history(view.history) };
}

/** The value of a starting point the test needs known. */
function valueOf(sp: ReturnType<typeof buildStartingPoint>, what: string): StartingPoint {
  if (!sp.known) throw new Error(`${what}: the starting point is unknown (${sp.reason})`);
  return sp.value;
}

/** `car`'s newest stint with a known base pace, as `degradation` gives it. */
function pacedStint(outputs: ReadonlyMap<CalculatorId, unknown>, car: CarId): StintDegradation {
  const stints = (outputs.get(DEGRADATION) as DegradationOutput).stints[car] ?? [];
  const paced = [...stints].reverse().find((s) => s.basePaceMs.known);
  if (paced === undefined) throw new Error(`car ${car}: no paced stint`);
  return paced;
}

/** The lap model's input for `car` from the starting point as it stands: its pace, compound, wear, tyre loss and fuel; a warm set, a dry track, no scatter. */
function lapInputOf(sp: StartingPoint, car: CarId): LapInput {
  const compound = NOISE_COMPOUNDS[sp.compound[car]!]!;
  return {
    paceMs: sp.paceMs[car]!,
    degMsPerLap: sp.tyre.degMsPerLap[tyreIndex(car, sp.compound[car]!)]!,
    wearPct: sp.wearPct[car]!,
    fuelKg: sp.fuelKg[car]!,
    compound,
    lapOnSet: 3,
    neutralised: 'none',
    wetnessMs: 0,
    wet: false,
    scatterMs: 0,
    mistakeMs: 0,
  };
}

/** The tyre term of the lap model for `input` under `sp`'s parameters: the loss per % × wear, plus the convex term. */
function tyreTermMs(sp: StartingPoint, input: LapInput): number {
  const past = Math.max(0, input.wearPct - sp.lapModel.convexFromPct);
  return input.degMsPerLap * input.wearPct + sp.lapModel.convexMsPerPct2 * past * past;
}

/** `laps` with the rival's fuel unknown at every lap start and end, but known at `FUEL_KG` at the end of its newest lap. */
function rivalFuelOnlyAtTheEnd(laps: readonly LapRecord[]): LapRecord[] {
  const newest = Math.max(...laps.filter((l) => l.carId === RIVAL).map((l) => l.lapNumber));
  return laps.map((l): LapRecord => {
    if (l.carId !== RIVAL) return l;
    return { ...l, fuelAtStartKg: unknown('notReceived'), fuelAtEndKg: l.lapNumber === newest ? known(FUEL_KG, l.completedAt) : unknown('notReceived') };
  });
}

describe("a car's pace is degradation's (SP4.3c Task 13, O2)", () => {
  it('B9 pin: a base pace fitted without fuel counts fuel once: the forecast lap is base pace + offset + tyre, no second fuel term', () => {
    const view = viewAtLap7((h) => ({ ...h, laps: rivalFuelOnlyAtTheEnd(h.laps as readonly LapRecord[]) }) as Projection);
    const outputs = upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at));
    const rival = pacedStint(outputs, RIVAL);
    // degradation fitted the rival's stint on its lap times (no pace lap's fuel known): its base pace holds the fuel
    expect(rival.fuelCorrected).toBe(false);
    const sp = valueOf(buildStartingPoint(view, outputs), 'lap 7');

    const input = lapInputOf(sp, RIVAL);
    const alpha = rival.basePaceMs.known ? rival.basePaceMs.value : Number.NaN;
    // the forecast lap: the base pace (fuel inside), the compound's offset (paceMs is on the reference compound, the
    // lap model adds the offset back) and the tyre term; without the rule it is 100 kg × 30 ms/kg = 3 s slower
    expect(lapTimeMs(sp.lapModel, input), 'the rival: base pace + offset + tyre').toBeCloseTo(alpha + tyreTermMs(sp, input), 6);
    // degradation marks it
    expect(rival.fuelIncluded).toBe(true);
  });

  it('B9 control: a fuel-corrected base pace keeps its fuel term (fuelMsPerKg × the fuel the build resolves)', () => {
    const view = viewAtLap7((h) => ({ ...h, laps: rivalFuelOnlyAtTheEnd(h.laps as readonly LapRecord[]) }) as Projection);
    const outputs = upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at));
    const control = pacedStint(outputs, CONTROL);
    expect(control.fuelCorrected).toBe(true);
    expect(control.fuelIncluded).toBe(false);
    const sp = valueOf(buildStartingPoint(view, outputs), 'lap 7');

    const input = lapInputOf(sp, CONTROL);
    expect(input.fuelKg, 'the control car carries fuel').toBeGreaterThan(0);
    const alpha = control.basePaceMs.known ? control.basePaceMs.value : Number.NaN;
    expect(lapTimeMs(sp.lapModel, input), 'the control: base pace + offset + tyre + fuel').toBeCloseTo(alpha + sp.lapModel.fuelMsPerKg * input.fuelKg + tyreTermMs(sp, input), 6);
  });

  it('the pace on the reference compound is the paced stint’s base pace less its compound’s offset, for every car', () => {
    const view = viewAtLap7();
    const outputs = upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at));
    const sp = valueOf(buildStartingPoint(view, outputs), 'lap 7');
    for (let k = 0; k < PARAMS.cars; k++) {
      const stint = pacedStint(outputs, carId(k));
      const alpha = stint.basePaceMs.known ? stint.basePaceMs.value : Number.NaN;
      const offset = sp.lapModel.compoundOffsetMs[stint.visual as (typeof NOISE_COMPOUNDS)[number]];
      expect(sp.paceMs[k]! + offset, `car ${k}`).toBeCloseTo(alpha, 6);
    }
  });

  it('a running car with no paced stint makes the build insufficientData, not a pace from its raw lap', () => {
    const view = viewAtLap7();
    const outputs = new Map(upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at)));
    // car 4's stints as degradation gives them, each without a base pace (no pace lap fitted)
    const degradation = outputs.get(DEGRADATION) as DegradationOutput;
    const unpaced: DegradationOutput = {
      ...degradation,
      stints: { ...degradation.stints, [carId(4)]: (degradation.stints[carId(4)] ?? []).map((s) => ({ ...s, basePaceMs: unknown('insufficientData'), cov: unknown('insufficientData') })) },
    };
    outputs.set(DEGRADATION, unpaced);
    expect(buildStartingPoint(view, outputs)).toEqual(unknown('insufficientData'));
    // without any stint at all the same (past lap 1 degradation has no field stand-in)
    outputs.set(DEGRADATION, { ...degradation, stints: { ...degradation.stints, [carId(4)]: [] } } satisfies DegradationOutput);
    expect(buildStartingPoint(view, outputs)).toEqual(unknown('insufficientData'));
  });

  it('a retired car without a paced stint does not make the build unknown (the simulators do not run it)', () => {
    const now = g.viewAt(g.race.framesOfLap(7)[0]!);
    const retiredCar = carId(4);
    const byMachine = Object.fromEntries(
      Object.entries(now.situation.byMachine).map(([machine, spans]) => [
        machine,
        machine !== 'car-status' ? spans : spans.map((s): OpenSpan => (s.carId === retiredCar ? { ...(s as OpenSpan), kind: 'retired', detail: { cause: known('mechanical', 0) } } : (s as OpenSpan))),
      ]),
    );
    const view = materialised(asOfNow(now), { situation: { ...now.situation, byMachine } });
    const outputs = new Map(upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at)));
    const degradation = outputs.get(DEGRADATION) as DegradationOutput;
    outputs.set(DEGRADATION, { ...degradation, stints: { ...degradation.stints, [retiredCar]: [] } } satisfies DegradationOutput);
    const sp = valueOf(buildStartingPoint(view, outputs), 'lap 7, car 4 retired');
    expect(sp.retired[retiredCar]).toBe(1);
  });
});
