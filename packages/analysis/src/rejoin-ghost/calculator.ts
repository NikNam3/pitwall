// `rejoin-ghost` (SP4.3c spec §5.7, O18): per our car and condition, where the car was `rejoin`'s stop cost
// (`RejoinAt.lossMs`, the cost its rejoin position used) ago: the map point at `view.live.sessionTime − lossMs`, our
// progress interpolated between our two crossings around that time (from the gaps `rejoin` computed with), on the track
// file's outline (C62b). It reads only `rejoin`, never `pit-loss`: one stop cost (O8, C43). Quick (C31), on every frame,
// so the ghost moves between two crossings instead of jumping once per crossing.
import { known, MINI_SECTORS, pointAt, unknown, type CarId, type Known, type MapPoint, type PitCondition, type RejoinGhost, type SessionTime } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { REJOIN, type RejoinOutput } from '../rejoin/index.ts';
import type { CarCrossings } from '../shared/gapper-lines.ts';
import { REJOIN_GHOST, type RejoinGhostOutput } from './index.ts';

const CONDITIONS: readonly PitCondition[] = ['green', 'vsc', 'sc'];
const NOT_APPLICABLE = unknown('notApplicable');
const INSUFFICIENT = unknown('insufficientData');

type Outline = Known<readonly DeepReadonly<MapPoint>[]>;

/** The outline of the view's track file; `notApplicable` without one or without its outline. */
function outlineOf(view: EngineView): Outline {
  if (!view.track.known) return NOT_APPLICABLE;
  const outline = view.track.value.outline;
  return outline.known && outline.value.length > 0 ? known(outline.value, view.track.at) : NOT_APPLICABLE;
}

/**
 * Where our car was at `t`, as an outline point: our progress interpolated between our two crossings around `t`, its
 * part within its lap over 50 as the lap fraction. `insufficientData` when our kept crossings begin after `t`.
 */
function mapPointAt(ours: DeepReadonly<CarCrossings>, t: SessionTime, outline: readonly DeepReadonly<MapPoint>[], at: SessionTime): Known<MapPoint> {
  const first = ours.at.findIndex((x) => x !== undefined);
  if (first < 0 || (ours.at[first] as SessionTime) > t) return INSUFFICIENT;
  let i = first;
  for (let j = first + 1; j < ours.at.length; j++) {
    const x = ours.at[j];
    if (x === undefined) continue;
    if (x > t) {
      const from = ours.at[i] as SessionTime;
      const progress = ours.fromProgress + i + ((j - i) * (t - from)) / (x - from);
      return known(pointAt(outline, (progress % MINI_SECTORS) / MINI_SECTORS), at);
    }
    i = j;
  }
  return known(pointAt(outline, ((ours.fromProgress + i) % MINI_SECTORS) / MINI_SECTORS), at);
}

export const rejoinGhostCalculator: QuickCalculator<RejoinGhostOutput> = {
  id: REJOIN_GHOST,
  kind: 'quick',
  reads: [{ calculator: REJOIN }],
  cadence: 'frame',
  compute: (view): RejoinGhostOutput => {
    const rejoin = view.outputs.get(REJOIN) as DeepReadonly<RejoinOutput> | undefined;
    if (rejoin === undefined) throw new Error('rejoin-ghost: rejoin runs before it');
    const now = view.live.sessionTime;
    const outline = outlineOf(view);
    const cars: Record<CarId, RejoinGhost> = {};
    for (const r of Object.values(rejoin.cars)) {
      const ours = rejoin.ghost.gaps.recent[r.carId];
      const at = (c: PitCondition): RejoinGhost['conditions'][PitCondition] => {
        const lossMs = r.conditions[c].lossMs;
        if (!lossMs.known) return { mapPoint: lossMs };
        if (ours === undefined) return { mapPoint: INSUFFICIENT };
        if (!outline.known) return { mapPoint: outline };
        return { mapPoint: mapPointAt(ours, now - lossMs.value, outline.value, now) };
      };
      cars[r.carId] = { carId: r.carId, conditions: Object.fromEntries(CONDITIONS.map((c) => [c, at(c)])) as RejoinGhost['conditions'] };
    }
    return { cars };
  },
};
