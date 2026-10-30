// The clock reset at the race start, on race-zandvoort-clock-reset (facts in fixtures/index.json): the formation lap,
// then the race from a session time the formation lap already passed, frame ids rising, no FLBK. The engine and
// `gaps` only; one replay feeds every test.
import { beforeAll, describe, expect, it } from 'vitest';
import { GAPS, gapsCalculator, type GapsOutput } from '@pitwall/analysis';
import type { Known, Ms } from '@pitwall/domain';
import type { StepResult } from '@pitwall/engine';
import { replayScheduled } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

/** One step after the reset: its session time and the gaps then. */
type After = { sessionTime: number; gaps: GapsOutput };

const run: {
  /** The step whose session time fell by more than 1 s, and the session time before it. */
  reset: { result: StepResult; fromMs: number; toMs: number } | undefined;
  /** Every step from the reset on. */
  after: After[];
} = { reset: undefined, after: [] };

beforeAll(async () => {
  let previous: number | undefined;
  await replayScheduled(segmentPath('race-zandvoort-clock-reset.pwrec.gz'), [gapsCalculator], (r, scheduled) => {
    const now = r.state.sessionTime;
    if (run.reset === undefined && previous !== undefined && now < previous - 1000) {
      run.reset = { result: r, fromMs: previous, toMs: now };
    }
    previous = now;
    if (run.reset !== undefined) run.after.push({ sessionTime: now, gaps: structuredClone(scheduled.outputs.get(GAPS) as GapsOutput) });
  });
});

/** The car's three gaps by name. */
const gapsOf = (i: GapsOutput['intervals'][number]): Array<[string, Known<Ms>]> => [
  ['toLeaderMs', i.toLeaderMs],
  ['toAheadMs', i.toAheadMs],
  ['toBehindMs', i.toBehindMs],
];

describe('race-zandvoort-clock-reset: the session time falls back at the race start', () => {
  it('the fall is a clock reset: the step is truncated and reports it, and is no flashback', () => {
    const { result, fromMs, toMs } = run.reset!;
    expect([result.delta.truncated, result.clockReset, result.flashback]).toEqual([true, { fromMs, toMs }, undefined]);
  });
  it('from the reset on, every known gap was measured on the new clock: after the reset and no later than the frame', () => {
    const { toMs } = run.reset!;
    const off = run.after.flatMap(({ sessionTime, gaps }) =>
      gaps.intervals.flatMap((i) =>
        gapsOf(i).flatMap(([name, gap]) =>
          gap.known && (gap.at < toMs || gap.at > sessionTime) ? [`car ${i.carId} ${name} at ${gap.at} on the frame at ${sessionTime}`] : [],
        ),
      ),
    );
    expect(off.slice(0, 10)).toEqual([]);
  });
  it('by the end every running car has its gaps again from the crossings after the reset', () => {
    const last = run.after.at(-1)!;
    const [leader, ...rest] = last.gaps.intervals;
    const unknownGaps = [
      ...(leader!.toLeaderMs.known ? [] : [`leader ${leader!.carId} toLeaderMs`]),
      ...rest.flatMap((i) => gapsOf(i).slice(0, 2).flatMap(([name, gap]) => (gap.known ? [] : [`car ${i.carId} ${name}`]))),
    ];
    expect(unknownGaps).toEqual([]);
  });
});
