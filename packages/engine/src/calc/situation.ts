import type { CarId, MachineId, OpenSpan } from '@pitwall/domain';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { EngineView } from './types.ts';

const NONE: readonly DeepReadonly<OpenSpan>[] = Object.freeze([]);

/**
 * A sub-machine's open spans in the view (C20): every car's, or one car's with `carId`; none for a machine with no open
 * span. Reads only `view.situation`: a read of that machine (its `spans:<id>` dependency, C41).
 */
export function openSpansOf(view: EngineView, machine: MachineId, carId?: CarId): readonly DeepReadonly<OpenSpan>[] {
  const open = view.situation.byMachine[machine] ?? NONE;
  return carId === undefined ? open : open.filter((span) => span.carId === carId);
}
