// The long race (`test-support/builders`, 70 laps, 20 cars) as `circle` sees it: each frame's view with the upstream
// outputs on it, computed from scratch outside any timer: `gaps` (init over the view), `pit-loss` (the built races'
// losses, `../rejoin/field.ts`) and `rejoin` (on the same view). Shared by the budget test and the rewind test.
import type { FrameNumber } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { gapsCalculator } from '../../src/gaps/calculator.ts';
import { GAPS } from '../../src/gaps/index.ts';
import { PIT_LOSS } from '../../src/pit-loss/index.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import { REJOIN } from '../../src/rejoin/index.ts';
import { pitLosses } from '../rejoin/field.ts';

/** The view after `frame` (its delta from `from`, default the frame before) with `gaps`, `pit-loss` and `rejoin` on it. */
export function circleViewAt(race: BuilderRace, frame: FrameNumber, from?: FrameNumber): EngineView {
  const view = race.viewAt(frame, from === undefined ? undefined : { from });
  const upstream: EngineView = {
    ...view,
    outputs: new Map<string, unknown>([
      [GAPS, gapsCalculator.output(gapsCalculator.init(view), view)],
      [PIT_LOSS, pitLosses()],
    ]),
  };
  const outputs = new Map<string, unknown>(upstream.outputs);
  outputs.set(REJOIN, rejoinCalculator.compute(upstream));
  return { ...upstream, outputs };
}
