// R2 of `race-interaction` (SP4.3a plan Task 12, spec 6.1; plan review P1): its "as of frame N" form over the projection
// cut at N (`projectionAsOf`) equals its scheduled run on the view after frame N, at every leader crossing frame of a
// generated race. It reads no upstream unit, so no upstream outputs enter. The as-of view is the view at N's
// (`asOfNow`) with the cut's projection and situation: every fixed input of the run stays the view's.
import { asOfNow, projectionAsOf, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateRace, GENERATOR_DEFAULTS, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { raceInteractionCalculator } from '../../src/race-interaction/calculator.ts';
import { raceInteractionAsOf } from '../../src/race-interaction/index.ts';
import { trackOf, withAppendFrames, withTrack } from './generated.ts';

/** A small race (P8): 10 cars, 12 laps, one stop each, the default DRS zones and hazard. */
const TRUTH: GeneratorParams = {
  ...GENERATOR_DEFAULTS,
  cars: 10,
  laps: 12,
  field: GENERATOR_DEFAULTS.field.slice(0, 10).map((car, i) => ({ ...car, paceMs: 90_000 + 120 * ((i * 3) % 10), stops: [{ lap: 5 + (i % 3), compound: 'hard' }] })),
};

let viewAt: (frame: number) => EngineView;
let crossingFrames: number[] = [];
let source: { history: EngineView['history']; situation: EngineView['situation'] };

beforeAll(() => {
  const { race } = generateRace(TRUTH, 7);
  const track = trackOf(TRUTH);
  viewAt = (frame) => withTrack(race.viewAt(frame), track);
  const last = race.viewAt(race.lastFrame);
  source = { history: withAppendFrames(last.history), situation: last.situation };
  crossingFrames = [...new Set(last.history.laps.filter((l) => l.status === 'provisional' && l.positionAtEnd === 1).map((l) => l.frame))];
});

describe('race-interaction as of frame N (R2)', () => {
  it('as of frame N equals the scheduled run at every leader crossing frame', () => {
    expect(crossingFrames.length).toBeGreaterThanOrEqual(TRUTH.laps);
    for (const frame of crossingFrames) {
      const view = viewAt(frame);
      const cut = projectionAsOf(source, frame);
      const asOf: AsOfView = { ...asOfNow(view), history: cut.history, situation: cut.situation, frame };
      expect(raceInteractionAsOf(asOf), `frame ${frame}`).toEqual(raceInteractionCalculator.compute(view));
    }
  });
});
