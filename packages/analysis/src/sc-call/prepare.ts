// `sc-call`'s job input (SP4.3b spec §9.3; SP4.3b2 Task 9): the shared strategy input (`shared/strategy-input/`, C43)
// and, per our car, `rejoin`'s rejoin position, loss and loss source per condition (as the 4.2 calculator took them),
// whether the car already boxed under the neutralisation out now, and its behaviour row (C44). Structured-cloneable
// (C51).
import { unknown, type CarId, type EstimateSource, type Known, type Ms, type NeutralisedDetail, type Rejoin } from '@pitwall/domain';
import type { CalculatorId, EngineView } from '@pitwall/engine/readers';
import { RACE_HAZARD } from '../race-hazard/id.ts';
import { REJOIN, type RejoinOutput } from '../rejoin/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { strategyInputFrom, type StrategyInput } from '../shared/strategy-input/index.ts';
import { effectOf, SC_CALL_BEHAVIOUR, type ScCallEffect } from './behaviour.ts';

/** A neutralising condition: the call's rows. */
export type ScCondition = 'sc' | 'vsc';

/** `rejoin`'s answer for one condition (C43). */
export type ScRejoin = { rejoinPosition: Known<number>; lossMs: Known<Ms>; lossSource: EstimateSource };

/** One of our cars as the job reads it. */
export type ScCallCar = {
  /** Its behaviour row (`SC_CALL_BEHAVIOUR`, combined by `effectOf`). */
  effect: ScCallEffect;
  /** It made a stop that ended under the neutralisation out now. */
  boxedUnder: boolean;
  /** Its lap now (live timing): the call's lap where no starting point is known. */
  lap: number;
  rejoin: Record<ScCondition, ScRejoin>;
};

/** The job's input: the shared strategy input, the neutralisation out now (its condition) and per our car its part. */
export type ScCallInput = { strategy: StrategyInput; neutralised: ScCondition | null; cars: Record<CarId, ScCallCar> };

/**
 * The source of a loss `rejoin` gave none for (its car absent): a row without a loss shows no source; the type wants
 * one. Never read beside a known loss.
 */
const NO_SOURCE: EstimateSource = { kind: 'default', note: 'no rejoin answer', sessionShare: 0, parts: 'default' };

/** `rejoin`'s answer for `condition`, its reason passed through where unknown; without one, `insufficientData`. */
function rejoinAt(rejoin: Rejoin | undefined, condition: ScCondition): ScRejoin {
  const at = rejoin?.conditions[condition];
  if (at === undefined) return { rejoinPosition: unknown('insufficientData'), lossMs: unknown('insufficientData'), lossSource: NO_SOURCE };
  return { rejoinPosition: at.rejoinPosition, lossMs: at.lossMs, lossSource: at.lossSource };
}

/** The job's input from the view (C41: through what `SC_CALL_JOB` reads). */
export function prepareScCall(view: EngineView): ScCallInput {
  // the outputs the job declares, the only ones the shared input sees (C41): its estimation units run inside it
  const outputs = new Map<CalculatorId, unknown>();
  for (const id of [RACE_HAZARD, REJOIN]) if (view.outputs.has(id)) outputs.set(id, view.outputs.get(id));
  const strategy = strategyInputFrom(new Proxy(view, { get: (target, key) => (key === 'outputs' ? outputs : Reflect.get(target, key)) }));
  const open = view.situation.byMachine['session-phase-race']?.find((s) => s.kind === 'neutralised');
  const neutralised: ScCondition | null = open === undefined ? null : (open.detail as NeutralisedDetail).car === 'VSC' ? 'vsc' : 'sc';
  const rejoin = view.outputs.get(REJOIN) as RejoinOutput | undefined;
  const boxStops = view.history.spans['car-activity-race'] ?? [];
  const cars: Record<CarId, ScCallCar> = {};
  for (const car of strategy.ourCars) {
    const own = rejoin?.cars[car] as Rejoin | undefined;
    // a stop that ended once the neutralisation was out: the car boxed under it
    const boxedUnder = open !== undefined && boxStops.some((s) => s.carId === car && s.kind === 'boxStop' && s.endFrame > open.startFrame);
    cars[car] = {
      effect: effectOf(behaviourFor(SC_CALL_BEHAVIOUR, view, car)),
      boxedUnder,
      // a car not in the live state yet: lap 1, the race's first
      lap: view.live.cars.find((c) => c.id === car)?.timing.lap ?? 1,
      rejoin: { sc: structuredClone(rejoinAt(own, 'sc')), vsc: structuredClone(rejoinAt(own, 'vsc')) },
    };
  }
  return { strategy, neutralised, cars };
}
