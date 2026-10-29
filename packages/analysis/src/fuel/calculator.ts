// The `fuel` calculator: per active car, the fuel now, its burn over the current stint, and the margin against the laps left.
import { known, unknown, type CarId, type Known, type Kg, type SessionTime } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import { classifyLap } from '../lap-classes/index.ts';
import { PER_LAP_RATE_CONFIG, perLapRate, type RateSample } from '../per-lap-rate/index.ts';
import { SESSION_REMAINING, type SessionRemaining } from '../session-remaining/index.ts';
import { currentStintLaps } from '../shared/stint-laps.ts';
import { FUEL, type FuelOutput, type FuelState } from './index.ts';

/** Fuel levels at the end of the car's counted laps of the current stint, by lap. */
const levelSamples = (view: EngineView, id: CarId, isRace: boolean): RateSample[] =>
  currentStintLaps(view.state.history, id).flatMap((l) =>
    classifyLap(l, { isRace }).forRate && l.fuelAtEndKg.known ? [{ lap: l.lapNumber, value: l.fuelAtEndKg.value, at: l.completedAt }] : [],
  );

const fuelState = (view: EngineView, id: CarId, lapsLeft: Known<number>): FuelState => {
  const { state } = view;
  const car = state.cars[id];
  const fuel = car?.energy.fuel;
  const now: SessionTime = state.sessionTime;
  const kind = state.session.kind;
  if (fuel === undefined || !fuel.known) {
    const reason = fuel === undefined ? unknown('notReceived') : unknown(fuel.reason);
    return {
      kg: reason,
      burnKgPerLap: reason,
      lapsOfFuel: reason,
      lapsLeft,
      marginLaps: reason,
      saveTargetKgPerLap: reason,
      gameRemainingLaps: reason,
      mix: reason,
    };
  }
  const { kg, remainingLaps, mix } = fuel.value;
  const base = { kg: known(kg, fuel.at), lapsLeft, gameRemainingLaps: known(remainingLaps, fuel.at), mix: known(mix, fuel.at) };

  let burn: Known<Kg>;
  if (kind === 'timeTrial') burn = known(0 as Kg, now);
  else {
    const rate = perLapRate(levelSamples(view, id, kind === 'race'), PER_LAP_RATE_CONFIG.read(view));
    burn = rate.known ? known((0 - rate.value.perLap) as Kg, rate.at) : rate;
  }
  if (!burn.known) return { ...base, burnKgPerLap: burn, lapsOfFuel: burn, marginLaps: burn, saveTargetKgPerLap: burn };

  const na = unknown('notApplicable');
  if (burn.value <= 0) return { ...base, burnKgPerLap: burn, lapsOfFuel: na, marginLaps: lapsLeft.known ? na : lapsLeft, saveTargetKgPerLap: lapsLeft.known ? na : lapsLeft };
  const laps = kg / burn.value;
  const lapsOfFuel = known(laps, now);
  if (!lapsLeft.known) return { ...base, burnKgPerLap: burn, lapsOfFuel, marginLaps: lapsLeft, saveTargetKgPerLap: lapsLeft };
  const margin = laps - lapsLeft.value;
  return {
    ...base,
    burnKgPerLap: burn,
    lapsOfFuel,
    marginLaps: known(margin, now),
    saveTargetKgPerLap: margin < 0 ? known((burn.value - kg / lapsLeft.value) as Kg, now) : na,
  };
};

/** Per active car: `fuel.car`. A time trial has no burn (0) and no laps left, so everything derived from them is `notApplicable`. */
export const fuelCalculator: QuickCalculator<FuelOutput> = {
  id: FUEL,
  kind: 'quick',
  reads: ['laps', 'stints', 'energy', 'session', { calculator: SESSION_REMAINING }],
  cadence: { hz: 4 },
  compute(view): FuelOutput {
    const remaining = view.outputs.get(SESSION_REMAINING) as SessionRemaining | undefined;
    const lapsLeft = remaining?.lapsLeft ?? unknown('notReceived');
    const out: FuelOutput = {};
    for (const car of view.state.cars) if (car.active) out[car.id as CarId] = fuelState(view, car.id, lapsLeft);
    return out;
  },
};

