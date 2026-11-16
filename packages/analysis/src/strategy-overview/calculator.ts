// `strategy-overview` (SP4.3d spec §6.4): per our car the competing cars within one green pit loss ahead or behind it on
// its lap (|gap| ≤ loss, the gap at the same point of the road), plus its teammate always, in race order. Every
// judgement is another unit's (C43): the loss is `pit-loss`'s, the gaps `gaps`', a car's window, next-compound odds
// and whether it still owes a compound `rival-stops`' (its compound-rule judgement is `shared/compound-rule.ts`'s).
// Compound and tyre age are the live state's values; stops and past stints the projection's closed stints. Our rows
// carry our plans from the projection's decisions (R4): A the active plan, B the first other saved slot. Quick (C31).
import {
  activeSlot,
  carStatusSpans,
  known,
  latestPlan,
  ourCars,
  planSlots,
  unknown,
  type CarId,
  type DecisionRecord,
  type GapToCar,
  type OverviewRow,
  type PitLosses,
  type Policy,
  type RivalStops,
  type Slot,
  type StintRecord,
  type StrategyOverview,
} from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { gapsToCar } from '../gaps/gaps.ts';
import { GAPS, type GapsOutput } from '../gaps/index.ts';
import { PIT_LOSS } from '../pit-loss/index.ts';
import { RIVAL_STOPS } from '../rival-stops/index.ts';
import { behaviourByCar } from '../shared/behaviour.ts';
import { STRATEGY_OVERVIEW_BEHAVIOUR } from './behaviour.ts';
import { STRATEGY_OVERVIEW } from './id.ts';
import type { StrategyOverviewOutput } from './output.ts';

const INSUFFICIENT = unknown('insufficientData');
const NOT_APPLICABLE = unknown('notApplicable');

/** Plan B's slot: the first saved slot other than the active one, in this order (R4). */
const B_ORDER: readonly Slot[] = ['B', 'C', 'G1', 'G2', 'A'];

const CAR_ROWS = { [carStatusSpans.machine]: STRATEGY_OVERVIEW_BEHAVIOUR[carStatusSpans.machine] ?? {} };

/** Our car's plans (R4): A the active slot's policy (without a slot, the committed plan's), B the first other saved slot. */
function plansOf(view: EngineView, car: CarId): { a: Policy | null; b: Policy | null } {
  // the decisions are facts, never changed (C24): read as the plain records they are
  const history = view.history as { readonly decisions: readonly DecisionRecord[] };
  const slots = planSlots(history, car);
  const active = activeSlot(history, car);
  const a = (active === null ? undefined : slots[active]) ?? latestPlan(history, car);
  const bSlot = B_ORDER.find((s) => s !== active && slots[s] !== undefined);
  return { a, b: bSlot === undefined ? null : (slots[bSlot] ?? null) };
}

/** Per car its closed stints in log order. */
function stintsByCar(stints: readonly Readonly<StintRecord>[]): Map<CarId, Readonly<StintRecord>[]> {
  const byCar = new Map<CarId, Readonly<StintRecord>[]>();
  for (const s of stints) {
    const own = byCar.get(s.carId);
    if (own === undefined) byCar.set(s.carId, [s]);
    else own.push(s);
  }
  return byCar;
}

export const strategyOverviewCalculator: QuickCalculator<StrategyOverviewOutput> = {
  id: STRATEGY_OVERVIEW,
  kind: 'quick',
  reads: [{ calculator: PIT_LOSS }, { calculator: GAPS }, { calculator: RIVAL_STOPS }, 'stints', 'decisions', 'identity', 'timing', 'tyres', 'session', 'spans:session-phase-race', 'spans:car-status'],
  // per line crossing (a lap record), a stop (a closed stint), a status change and a decision; `rival-stops` runs on laps
  cadence: { onChange: ['laps', 'stints', 'decisions', 'spans:car-status'] },
  compute: (view): StrategyOverviewOutput => {
    const gaps = view.outputs.get(GAPS) as GapsOutput | undefined;
    const losses = view.outputs.get(PIT_LOSS) as PitLosses | undefined;
    const rivalStops = view.outputs.get(RIVAL_STOPS) as RivalStops | undefined;
    if (gaps === undefined || losses === undefined || rivalStops === undefined) throw new Error('strategy-overview: gaps, pit-loss and rival-stops run before it');
    const at = view.live.sessionTime;
    const rowsOfCar = behaviourByCar(CAR_ROWS, view);
    const competing = (id: CarId): boolean => rowsOfCar(id).some((r) => r.competing === true);
    const stints = stintsByCar(view.history.stints);
    const mine = ourCars(view.live);
    const lossMs = losses.conditions.green.lossMs;

    const rowOf = (id: CarId, gap: GapToCar['gapMs'], ours: boolean): OverviewRow | undefined => {
      const car = view.live.cars[id];
      if (car === undefined) return undefined;
      const own = stints.get(id) ?? [];
      const rs = rivalStops[id];
      return {
        carId: id,
        position: car.timing.position,
        gapMs: gap,
        compound: known(car.tyres.visualCompound, at),
        tyreAge: known(car.tyres.age, at),
        stops: own.length,
        owesCompound: rs?.owesStop ?? INSUFFICIENT,
        pastStints: own.map((s) => ({ fromLap: s.firstLap, toLap: s.lastLap, compound: s.visualCompound })),
        // `rival-stops`' window as it is (C43)
        window: rs?.window ?? INSUFFICIENT,
        nextCompound: rs?.nextCompound ?? INSUFFICIENT,
        plan: ours ? plansOf(view, id) : null,
      };
    };

    const cars: Record<CarId, StrategyOverview> = {};
    for (const us of mine) {
      if (!competing(us)) continue;
      const toUs = gapsToCar(gaps, us) ?? [];
      const gapOf = new Map(toUs.map((g) => [g.carId, g]));
      const rows: OverviewRow[] = [];
      for (const id of new Set([us, ...mine, ...toUs.map((g) => g.carId)])) {
        if (!competing(id)) continue;
        const g = gapOf.get(id);
        const onLap = g !== undefined && g.lapsDown === 0 && g.gapMs.known ? g.gapMs : undefined;
        const ours = mine.includes(id);
        const within = onLap !== undefined && lossMs.known && Math.abs(onLap.value) <= lossMs.value;
        if (!ours && !within) continue;
        const row = rowOf(id, id === us ? NOT_APPLICABLE : (g?.gapMs ?? INSUFFICIENT), ours);
        if (row !== undefined) rows.push(row);
      }
      rows.sort((a, b) => a.position - b.position || a.carId - b.carId);
      cars[us] = { carId: us, lossMs, rows };
    }
    return { cars };
  },
};
