import { LAP_TIMES, LAP_TIMES_CONFIG, type LapTimesOutput } from '@pitwall/analysis';
import { carId, known, unknown, type Known, type LapBoard, type Ms, type Projection } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import type { TopicBinding } from '../../../src/features/feature.ts';
import lapTimes from '../../../src/features/lap-times/register.ts';

type Row = LapTimesOutput['rows'][number];
type Times = [lap: number, s1: number, s2: number, s3: number, theoretical: number];

/** A row whose best lap, sectors and theoretical best are `times`, each known since `at`; or unknown for `reason`. */
const row = (id: number, times: Times | 'insufficientData', at = 0): Row => {
  const ms = (i: number): Known<Ms> => (times === 'insufficientData' ? unknown(times) : known(times[i]!, at));
  return {
    carId: carId(id),
    lastLapMs: ms(0),
    lastSectorsMs: [ms(1), ms(2), ms(3)],
    lastSectorStatus: ['none', 'none', 'none'],
    lastLapStatus: 'none',
    bestLapMs: ms(0),
    bestSectorsMs: [ms(1), ms(2), ms(3)],
    bestLapStatus: 'none',
    bestSectorStatus: ['none', 'none', 'none'],
    theoreticalBestMs: ms(4),
  };
};

const projection = (id: number, projectedLapMs: number): Projection => ({
  carId: carId(id),
  onLap: true,
  projectedLapMs: known(projectedLapMs, 5_000),
  deltaToBestMs: known(-100, 5_000),
  projectedPosition: known(id + 1, 5_000),
  cutOff: unknown('notApplicable'),
  finishMarginMs: known(30_000, 5_000),
});

const out: LapTimesOutput = {
  rows: [
    row(0, [90_000, 29_800, 30_000, 29_900, 89_700], 1_000),
    row(1, [89_500, 29_900, 29_700, 29_800, 89_400], 2_000),
    row(2, 'insufficientData'),
  ],
  sessionBest: {
    lap: known({ ms: 89_500, carId: carId(1) }, 2_000),
    sectors: [known({ ms: 29_800, carId: carId(0) }, 1_000), known({ ms: 29_700, carId: carId(1) }, 2_000), known({ ms: 29_800, carId: carId(1) }, 2_000)],
  },
  projections: { [carId(0)]: projection(0, 89_900), [carId(1)]: projection(1, 89_400) },
};

const select = (topic: string, params: object): unknown => {
  const b = lapTimes.topics.find((t) => t.topic === topic) as Extract<TopicBinding, { from: string }> | undefined;
  if (b === undefined) throw new Error(`no binding for ${topic}`);
  return b.select ? b.select(out, params) : out;
};

const deltasOf = (board: LapBoard, id: number) => board.rows.find((r) => r.carId === id)!.deltaToReference;

describe('lap-times feature', () => {
  it('registers the lap-times calculator, its config and the two topics', () => {
    expect(lapTimes.name).toBe('lap-times');
    expect(lapTimes.calculators.map((c) => c.id)).toEqual([LAP_TIMES]);
    expect(lapTimes.config).toContain(LAP_TIMES_CONFIG);
    expect(lapTimes.topics.map((t) => t.topic).sort()).toEqual(['lapTimes.board', 'lapTimes.projection']);
    for (const t of lapTimes.topics) expect(t).toMatchObject({ from: LAP_TIMES });
  });

  it('deltas to the reference car are signed (positive = slower than the reference)', () => {
    const board = select('lapTimes.board', { referenceCarId: 1 }) as LapBoard;
    expect(board.referenceCarId).toBe(1);
    expect(board.sessionBest).toEqual(out.sessionBest);
    // car 0 against car 1: known since the later of the two values
    expect(deltasOf(board, 0)).toEqual({
      bestLapMs: known(500, 2_000),
      bestSectorsMs: [known(-100, 2_000), known(300, 2_000), known(100, 2_000)],
      theoreticalBestMs: known(300, 2_000),
    });
    // the reference car's own deltas are zero
    expect(deltasOf(board, 1)).toEqual({
      bestLapMs: known(0, 2_000),
      bestSectorsMs: [known(0, 2_000), known(0, 2_000), known(0, 2_000)],
      theoreticalBestMs: known(0, 2_000),
    });
    // a car without a time has no delta
    expect(deltasOf(board, 2).bestLapMs).toEqual(unknown('insufficientData'));
    // every other field of a row is the calculator's
    const { deltaToReference: _, ...rest } = board.rows.find((r) => r.carId === 0)!;
    expect(rest).toEqual(out.rows[0]);
    expect(board.rows.map((r) => r.carId)).toEqual(out.rows.map((r) => r.carId));
  });

  it('a reference car without a time leaves every delta unknown for its reason', () => {
    const board = select('lapTimes.board', { referenceCarId: 2 }) as LapBoard;
    expect(deltasOf(board, 0)).toEqual({
      bestLapMs: unknown('insufficientData'),
      bestSectorsMs: [unknown('insufficientData'), unknown('insufficientData'), unknown('insufficientData')],
      theoreticalBestMs: unknown('insufficientData'),
    });
  });

  it('the board select does not change the calculator output', () => {
    const copy = structuredClone(out);
    select('lapTimes.board', { referenceCarId: 0 });
    expect(out).toEqual(copy);
  });

  it.each([[{ referenceCarId: 9 }], [{}], [{ referenceCarId: '1' }], [{ referenceCarId: 1.5 }], [{ carId: 1 }]])(
    'lapTimes.board is undefined for %j, which names no car on the board',
    (params) => {
      expect(select('lapTimes.board', params)).toBeUndefined();
    },
  );

  it("lapTimes.projection is params.carId's projection", () => {
    expect(select('lapTimes.projection', { carId: 1 })).toEqual(out.projections[carId(1)]);
    expect(select('lapTimes.projection', { carId: 0 })).toEqual(out.projections[carId(0)]);
  });

  it.each([[{ carId: 5 }], [{ carId: 99 }], [{}], [{ carId: '1' }], [{ carId: -1 }]])('lapTimes.projection is undefined for %j, an unknown car', (params) => {
    expect(select('lapTimes.projection', params)).toBeUndefined();
  });
});
