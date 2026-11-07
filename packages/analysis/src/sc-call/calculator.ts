// `sc-call` (SP4.2 spec 3.3): per our car, per condition SC and VSC, the rejoin position (from `rejoin`), the stop's loss
// with its source (from `pit-loss`) and the gain against a green stop, `loss[green] − loss[c]` (positive = good). Quick
// (C31). Race only (C14): elsewhere the output is empty (`notApplicable` through the binding); a car without a rejoin
// answer (in the pit lane) or a rival is absent.
import { known, type Known, type Ms, type Rejoin, type ScCall, type ScCallRow } from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine/readers';
import { PIT_LOSS, type PitLossOutput } from '../pit-loss/index.ts';
import { REJOIN, type RejoinOutput } from '../rejoin/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { phaseRow, SC_CALL_BEHAVIOUR, type ScCallEffect } from './behaviour.ts';
import { SC_CALL, type ScCallOutput } from './index.ts';

/** One condition's row: `rejoin`'s position, `pit-loss`'s loss and source, the gain against the green loss. */
function rowOf(condition: 'sc' | 'vsc', rejoin: Rejoin, losses: PitLossOutput): ScCallRow {
  const { lossMs, source } = losses.conditions[condition];
  const green = losses.conditions.green.lossMs;
  const gainMs: Known<Ms> = !green.known ? green : !lossMs.known ? lossMs : known(green.value - lossMs.value, Math.max(green.at, lossMs.at));
  return { condition, rejoinPosition: rejoin.conditions[condition].rejoinPosition, lossMs, lossSource: source, gainMs };
}

export const scCallCalculator: QuickCalculator<ScCallOutput> = {
  id: SC_CALL,
  kind: 'quick',
  reads: [{ calculator: REJOIN }, { calculator: PIT_LOSS }, 'spans:weekend-phase'],
  cadence: 'ourCrossing',
  compute: (view): ScCallOutput => {
    // the session's row (the weekend phase), over the race's (C14: a pending phase reads as the race)
    const session: ScCallEffect = Object.assign({}, phaseRow('pending'), ...behaviourFor(SC_CALL_BEHAVIOUR, view));
    const out: ScCallOutput = {};
    if (session.notApplicable === true) return out;
    const rejoin = view.outputs.get(REJOIN) as RejoinOutput | undefined;
    const losses = view.outputs.get(PIT_LOSS) as PitLossOutput | undefined;
    if (rejoin === undefined || losses === undefined) return out;
    // our cars as `rejoin` names them; its `cars` holds only ours, and none in the pit lane
    for (const car of rejoin.ghost.ourCars) {
      const r = rejoin.cars[car];
      if (r === undefined) continue;
      const value: ScCall = { carId: car, rows: [rowOf('sc', r, losses), rowOf('vsc', r, losses)] };
      out[car] = value;
    }
    return out;
  },
};
