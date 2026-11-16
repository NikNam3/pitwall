// `sc-call`'s job input (SP4.3b spec §9.3; SP4.3b2 Task 9): the shared strategy input (`shared/strategy-input/`, C43)
// and, per our car, `rejoin`'s loss and loss source per condition (as the 4.2 calculator took them),
// whether the car already boxed under the neutralisation out now, and its behaviour row (C44). Structured-cloneable
// (C51).
import { unknown, type CarId, type EstimateSource, type Known, type Ms, type Rejoin } from '@pitwall/domain';
import { spansOverlapping, type CalculatorId, type EngineView } from '@pitwall/engine/readers';
import { openNeutralisation } from '../shared/neutralised.ts';
import { RACE_HAZARD } from '../race-hazard/id.ts';
import { REJOIN, type RejoinOutput } from '../rejoin/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { strategyInputFrom, type StrategyInput } from '../shared/strategy-input/index.ts';
import { effectOf, SC_CALL_BEHAVIOUR, type ScCallEffect } from './behaviour.ts';

/** A neutralising condition: the call's rows. */
export type ScCondition = 'sc' | 'vsc';

/** `rejoin`'s loss for one condition, with its source (C43); the row's rejoin position is the box run's (one model, B8). */
export type ScRejoin = { lossMs: Known<Ms>; lossSource: EstimateSource };

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
  if (at === undefined) return { lossMs: unknown('insufficientData'), lossSource: NO_SOURCE };
  return { lossMs: at.lossMs, lossSource: at.lossSource };
}

/** The job's input from the view (C41: through what `SC_CALL_JOB` reads). */
export function prepareScCall(view: EngineView): ScCallInput {
  // the outputs the job declares, the only ones the shared input sees (C41): its estimation units run inside it
  const outputs = new Map<CalculatorId, unknown>();
  for (const id of [RACE_HAZARD, REJOIN]) if (view.outputs.has(id)) outputs.set(id, view.outputs.get(id));
  const strategy = strategyInputFrom(new Proxy(view, { get: (target, key) => (key === 'outputs' ? outputs : Reflect.get(target, key)) }));
  // the SC or VSC out now, from the one owner of the neutralisation kind; a suspension is none
  const now = openNeutralisation(view);
  const open = now !== null && now.kind !== 'red' ? now.span : undefined;
  const neutralised: ScCondition | null = now?.kind === 'SC' ? 'sc' : now?.kind === 'VSC' ? 'vsc' : null;
  const rejoin = view.outputs.get(REJOIN) as RejoinOutput | undefined;
  const cars: Record<CarId, ScCallCar> = {};
  for (const car of strategy.ourCars) {
    const own = rejoin?.cars[car] as Rejoin | undefined;
    // a stop that ended once the neutralisation was out: a closed box stop of the projection (the open one is no stop
    // yet) covering a frame from the neutralisation's first on, by the projection module's span-range query (C26)
    const boxedUnder =
      open !== undefined &&
      spansOverlapping({ history: view.history }, open.startFrame, Infinity, 'car-activity-race', car).some((s) => s.kind === 'boxStop');
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
