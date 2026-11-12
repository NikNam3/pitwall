// `tyre-life` "as of frame N" (SP4.3a Task 15c; rows R2 and R3 of Tasks 9–12): the as-of form on the projection cut at a
// leader crossing frame equals the scheduled run at that frame, and after a flashback the output equals a run that never
// received the undone frames (C33). The generator's race records every fact as the engine appends it; its views carry no
// append frames, so the source handed to `projectionAsOf` gets them from the lists' lengths at the frames the test cuts at.
import { carId, known, type FrameNumber, type LapRecord, type Percent } from '@pitwall/domain';
import { asOfNow, projectionAsOf, projectionLengths, type AsOfView, type EngineView, type MembershipSource } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { degradationCalculator } from '../../src/degradation/calculator.ts';
import { DEGRADATION } from '../../src/degradation/index.ts';
import { tyreLifeCalculator } from '../../src/tyre-life/calculator.ts';
import { tyreLifeAsOf } from '../../src/tyre-life/index.ts';
import { carState, lap } from '../../../../test-support/builders/index.ts';
import type { BuilderRace } from '../../../../test-support/builders/long-race.ts';
import { GENERATOR_DEFAULTS, generateRace, type GeneratorParams } from '../../../../test-support/race-generator/index.ts';
import { engineShaped } from '../engine-shaped.ts';
import { situatedView } from '../situated.ts';

/** A short race (P8): six cars of the default field (four AI, the two humans) over 12 laps, one stop each on laps 5 to 7, medium to hard. */
const PARAMS: GeneratorParams = {
  ...GENERATOR_DEFAULTS,
  cars: 6,
  laps: 12,
  field: GENERATOR_DEFAULTS.field.slice(14).map((car, i) => ({ ...car, stops: [{ lap: 5 + (i % 3), compound: 'hard' as const }] })),
};

const { race } = generateRace(PARAMS, 11);

/** The frames the leader completes a lap on: the first frame of each of its laps 2 to 12, and the race's last frame. */
const CROSSINGS: FrameNumber[] = [...Array.from({ length: PARAMS.laps - 1 }, (_, i) => race.framesOfLap(i + 2)[0]!), race.lastFrame];

/**
 * The race after its last frame as a running session's projection (C20, C26): with, per list, each entry's append frame:
 * the first of `cuts` whose view holds it. Exact for a cut at any of `cuts` (append frames never decrease).
 */
function sourceOf(r: BuilderRace, cuts: readonly FrameNumber[]): MembershipSource {
  const final = r.viewAt(r.lastFrame);
  const lengths = cuts.map((frame) => ({ frame, lengths: projectionLengths(r.viewAt(frame).history) as Record<string, number | undefined> }));
  const appendedAt: Record<string, FrameNumber[]> = {};
  for (const [list, length = 0] of Object.entries(projectionLengths(final.history))) {
    appendedAt[list] = Array.from({ length }, (_, i): FrameNumber => lengths.find((c) => (c.lengths[list] ?? 0) > i)?.frame ?? r.lastFrame);
  }
  return { history: { ...final.history, appendedAt }, situation: final.situation };
}

const SOURCE = sourceOf(race, CROSSINGS);

/** `degradation`'s output from the scheduled run on `view`: the upstream output `tyre-life` reads (R2). */
const upstreamOn = (view: EngineView): EngineView['outputs'] => new Map([[DEGRADATION, degradationCalculator.compute(view)]]);

/** The scheduled run's view at `frame` (its delta from `from`), with `degradation`'s output on it. */
const scheduledAt = (frame: FrameNumber, from?: FrameNumber): EngineView => {
  const o = from === undefined ? {} : { from };
  return race.viewAt(frame, { ...o, outputs: upstreamOn(race.viewAt(frame, o)) });
};

/** The as-of view at `frame`: the projection cut at it and the situation at it, the run's fixed inputs, the given outputs. */
const asOfAt = (frame: FrameNumber, outputs: EngineView['outputs']): AsOfView => ({
  ...asOfNow(race.viewAt(frame)),
  ...projectionAsOf(SOURCE, frame),
  frame,
  outputs,
});

describe('tyre-life as of frame N', () => {
  it('as of frame N equals the scheduled run at every leader crossing frame', () => {
    for (const frame of CROSSINGS) {
      const view = scheduledAt(frame);
      const expected = tyreLifeCalculator.compute(view);
      // every car of the race has its set
      expect(Object.keys(expected)).toHaveLength(PARAMS.cars);
      expect(tyreLifeAsOf(asOfAt(frame, view.outputs)), `frame ${frame}`).toEqual(expected);
    }
  });

  describe('rewind: after a flashback the output equals a run without the undone frames (C33)', () => {
    it('on the generator race: a flashback from the crossing of lap 9 to that of lap 6', () => {
      const target = CROSSINGS[4]!;
      const undone = CROSSINGS[7]!;
      const rewound = scheduledAt(target, undone);
      expect(rewound.delta.rewound).toBeDefined();
      const never = tyreLifeCalculator.compute(scheduledAt(target));
      expect(tyreLifeCalculator.compute(rewound)).toEqual(never);
      expect(tyreLifeAsOf(asOfNow(rewound))).toEqual(never);
    });

    it('on engine-shaped history: laps 4 and 5 (each provisional then confirmed) undone back to the end of lap 3', () => {
      /** Car 0's laps 1..n on soft, each gaining 2 % on every corner from 0 %, as the engine writes them. */
      const laps = (n: number): LapRecord[] =>
        engineShaped(
          Array.from({ length: n }, (_, i) => {
            const at = (i + 1) * 90_000;
            const wear = (pct: number) => ({ fl: known(pct as Percent, at), fr: known(pct as Percent, at), rl: known(pct as Percent, at), rr: known(pct as Percent, at) });
            return lap({ lapNumber: i + 1, completedAt: at, tyreAgeAtStart: i, wearAtStartPct: wear(2 * i), wearAtEndPct: wear(2 * (i + 1)), frame: 10 * (i + 1) });
          }),
        );
      const car = carState({ tyres: { age: 3, corners: { fl: { wearPct: known(6 as Percent, 270_000) }, fr: { wearPct: known(6 as Percent, 270_000) }, rl: { wearPct: known(6 as Percent, 270_000) }, rr: { wearPct: known(6 as Percent, 270_000) } } } });
      const upstream = new Map([[DEGRADATION, {}]]);
      const before = projectionLengths(situatedView({ history: { laps: laps(5) } }).history);
      const at = (rewind: boolean): EngineView => {
        const view = situatedView({ cars: [car], sessionTime: 270_000, history: { laps: laps(3) }, outputs: upstream });
        const after = projectionLengths(view.history);
        return { ...view, delta: rewind ? { before, after, rewound: { frameId: 31, at: 270_000 } } : { before: after, after } };
      };
      const never = tyreLifeCalculator.compute(at(false));
      expect(never[carId(0)]).toBeDefined();
      expect(tyreLifeCalculator.compute(at(true))).toEqual(never);
      expect(tyreLifeAsOf(asOfNow(at(true)))).toEqual(never);
    });
  });
});
