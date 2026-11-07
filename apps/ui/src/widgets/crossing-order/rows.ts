// The crossing order's blocks (SP4.2 spec §4; C65): the topic's values formatted and selected, nothing computed. The
// order, its positions and intervals are the `rejoin` analysis's (C43); the condition that is out is the machine's (C20),
// mapped by the presentation table (C66).
import type { CarOverview, MachineSpans, SessionInfo } from '@pitwall/contracts';
import type { CrossingRow, EstimateSource, Ms, NeutralisedDetail, PitCondition, Rejoin, UnknownReason } from '@pitwall/domain';
import { carCodeById } from '../../kit/car/car-label.ts';
import { ourCars } from '../../kit/car/our-cars.ts';
import { knownPart, type CellPart } from '../../kit/grid/grid.ts';
import { formatGap, formatSeconds } from '../../kit/values/format.ts';
import { presentation } from './presentation.ts';

/** The order of the blocks. */
export const CONDITIONS = ['green', 'vsc', 'sc'] as const satisfies readonly PitCondition[];

/** The neutralising car to its condition. */
const BY_CAR = { SC: 'sc', VSC: 'vsc' } as const satisfies Record<NeutralisedDetail['car'], PitCondition>;

/** The condition that is out now, by the presentation table: a `neutralised` span's car; none otherwise. */
export function activeCondition(phase: MachineSpans | undefined): PitCondition | undefined {
  const rows: Readonly<Record<string, { active: 'span' | 'none' }>> = presentation.situations['session-phase-race'];
  const span = phase?.open.find((s) => rows[s.kind]?.active === 'span');
  return span === undefined ? undefined : BY_CAR[(span.detail as NeutralisedDetail).car];
}

/** One row of a block's order, formatted. */
export type OrderRow = {
  key: string;
  p: string;
  code: CellPart;
  int: CellPart;
  ghost: boolean;
  /** Directly ahead of or behind the ghost. */
  near: boolean;
  ours: boolean;
};

/** One condition's block: its title (the loss with its source) and the order around the ghost. */
export type Block = {
  condition: PitCondition;
  loss: CellPart;
  /** The loss's source; shown as a badge only while the loss is known. */
  source: EstimateSource | undefined;
  /** The condition that is out now: its title white bold. */
  active: boolean;
  /** The rows around the ghost, or the reason the order is unknown. */
  order: { rows: OrderRow[] } | { reason: UnknownReason };
};

export type BlocksInput = { rejoin: Rejoin; cars: CarOverview[]; session: SessionInfo; phase: MachineSpans | undefined };

const seconds = (ms: Ms): string => formatSeconds(ms, 1);

/** The rows at most `around` either side of the ghost (every row without a limit or a ghost row). */
function aroundGhost(order: readonly CrossingRow[], around: number | undefined, input: BlocksInput): OrderRow[] {
  const ours = ourCars(input.session);
  const gi = order.findIndex((r) => r.ghost);
  const kept = order.map((r, i) => ({ r, i })).filter(({ i }) => around === undefined || gi < 0 || Math.abs(i - gi) <= around);
  return kept.map(({ r, i }) => ({
    key: r.ghost ? 'ghost' : String(r.carId),
    p: String(r.position),
    code: carCodeById(input.cars, r.carId),
    int: knownPart(r.intervalMs, formatGap),
    ghost: r.ghost,
    near: gi >= 0 && Math.abs(i - gi) === 1,
    ours: !r.ghost && ours.has(r.carId),
  }));
}

/** Rows either side of the ghost in compact; full shows the whole order (`orderAround` of the analysis). */
const COMPACT_AROUND = 2;

/** The blocks shown: all three conditions in full, every row; in compact the one that is out, else green, two rows either side. */
export function buildBlocks(input: BlocksInput, full: boolean): Block[] {
  const active = activeCondition(input.phase);
  const shown = full ? CONDITIONS : [active ?? 'green'];
  return shown.map((condition) => {
    const at = input.rejoin.conditions[condition];
    return {
      condition,
      loss: knownPart(at.lossMs, seconds),
      source: at.lossMs.known ? at.lossSource : undefined,
      active: condition === active,
      order: at.order.known ? { rows: aroundGhost(at.order.value, full ? undefined : COMPACT_AROUND, input) } : { reason: at.order.reason },
    };
  });
}
