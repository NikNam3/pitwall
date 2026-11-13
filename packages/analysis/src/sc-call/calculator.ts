// The 4.2 `sc-call` calculator (SP4.2 spec 3.3), no longer registered: `sc-call` is a job (SP4.3b spec §9.3). Kept with
// its tests, which import it directly, until SP4.3b2 Task 9 deletes both (C82). Per our car, per condition SC and VSC,
// the rejoin position (from `rejoin`), the stop's loss with its source (from `pit-loss`) and the gain against a green
// stop, `loss[green] − loss[c]` (positive = good). Quick (C31). Race only (C14): elsewhere the output is empty; a car
// without a rejoin answer (in the pit lane) or a rival is absent.
import { known, type CarId, type EstimateSource, type Known, type Ms, type Rejoin } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine/readers';
import { PIT_LOSS, type PitLossOutput } from '../pit-loss/index.ts';
import { REJOIN, type RejoinOutput } from '../rejoin/index.ts';
import { behaviourFor, type BehaviourTable } from '../shared/behaviour.ts';
import { phaseRow, SC_CALL_BEHAVIOUR, type ScCallEffect } from './behaviour.ts';
import { SC_CALL } from './index.ts';

/** The 4.2 row: our rejoin position, the stop's loss and the gain against a green stop (positive = good). */
export type ScCall42Row = { condition: 'sc' | 'vsc'; rejoinPosition: Known<number>; lossMs: Known<Ms>; lossSource: EstimateSource; gainMs: Known<Ms> };

/** The 4.2 value: the SC row, then the VSC row. */
export type ScCall42 = { carId: CarId; rows: [ScCall42Row, ScCall42Row] };

/** The 4.2 output: per our car its value. */
export type ScCall42Output = Record<CarId, ScCall42>;

/** The 4.2 table: the machines the calculator reads (the weekend phase), its rows as the job's table keeps them. */
export const SC_CALL_42_BEHAVIOUR: BehaviourTable<ScCallEffect> = { 'weekend-phase': SC_CALL_BEHAVIOUR['weekend-phase'] ?? {} };

/** One condition's row: `rejoin`'s position, `pit-loss`'s loss and source, the gain against the green loss. */
function rowOf(condition: 'sc' | 'vsc', rejoin: Rejoin, losses: PitLossOutput): ScCall42Row {
  const { lossMs, source } = losses.conditions[condition];
  const green = losses.conditions.green.lossMs;
  const gainMs: Known<Ms> = !green.known ? green : !lossMs.known ? lossMs : known(green.value - lossMs.value, Math.max(green.at, lossMs.at));
  return { condition, rejoinPosition: rejoin.conditions[condition].rejoinPosition, lossMs, lossSource: source, gainMs };
}

export const scCallCalculator: QuickCalculator<ScCall42Output> = {
  id: SC_CALL,
  kind: 'quick',
  reads: [{ calculator: REJOIN }, { calculator: PIT_LOSS }, 'spans:weekend-phase'],
  cadence: 'ourCrossing',
  compute: (view): ScCall42Output => {
    // the session's row (the weekend phase), over the race's (C14: a pending phase reads as the race)
    const session: ScCallEffect = Object.assign({}, phaseRow('pending'), ...behaviourFor(SC_CALL_42_BEHAVIOUR, view));
    const out: ScCall42Output = {};
    if (session.notApplicable === true) return out;
    const rejoin = view.outputs.get(REJOIN) as RejoinOutput | undefined;
    const losses = view.outputs.get(PIT_LOSS) as PitLossOutput | undefined;
    if (rejoin === undefined || losses === undefined) return out;
    // our cars as `rejoin` names them; its `cars` holds only ours, and none in the pit lane
    for (const car of rejoin.ghost.ourCars) {
      const r = rejoin.cars[car];
      if (r === undefined) continue;
      const value: ScCall42 = { carId: car, rows: [rowOf('sc', r, losses), rowOf('vsc', r, losses)] };
      out[car] = value;
    }
    return out;
  },
};
