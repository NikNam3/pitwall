// `asOfStored`'s situation at the session's end comes from the projection module (SP4.3a final review F3; C26, C28):
// exactly one module computes which spans cover a frame. The stored situation is `situationAt(source, last − 1)` (the
// last applied frame; the session closed its spans on `last`), each span presented open; `asOfStored` judges no span
// cover itself.
import { describe, expect, it, vi } from 'vitest';
import { carId, known, unknown, type FrameNumber, type SessionUid, type Span } from '@pitwall/domain';
import { history } from '../../../../test-support/builders/index.ts';
import { asOfStored, type StoredDriverSession } from '../../src/index.ts';
import * as projection from '../../src/log/projection.ts';
import type { Projection } from '../../src/log/types.ts';

vi.mock('../../src/log/projection.ts', async (importOriginal) => {
  const original = await importOriginal<typeof projection>();
  return { ...original, situationAt: vi.fn(original.situationAt) };
});

const storedOf = (p: Projection): StoredDriverSession => ({
  session: { sessionUid: '7' as SessionUid, weekendId: 'w', feedCar: carId(0) },
  carId: carId(0),
  startedAt: '2026-11-05T19:00:00Z',
  phase: { kind: 'race', format: 'grandPrix' },
  aiDifficulty: known(95, 0),
  totalLaps: known(50, 0),
  projection: p,
  humanSpans: [{ startFrame: 1 }],
  track: unknown('notApplicable'),
});

const carStatus = (id: number, car: number, kind: string, startFrame: FrameNumber, endFrame: FrameNumber): Span => ({
  machine: 'car-status', id, carId: carId(car), kind, start: startFrame * 16, end: endFrame * 16, confirmed: true, detail: {}, startFrame, endFrame,
});

describe('asOfStored: the situation through the projection module (F3, C26, C28)', () => {
  it("is situationAt over the stored projection at the last applied frame (the latest endFrame − 1)", () => {
    const p = history({ spans: { 'car-status': [carStatus(0, 0, 'competing', 1, 40), carStatus(0, 1, 'competing', 1, 100), carStatus(1, 0, 'retired', 40, 100)] } });
    const spy = vi.mocked(projection.situationAt);
    spy.mockClear();
    const v = asOfStored(storedOf(p), { config: {}, overrides: {} });

    expect(spy).toHaveBeenCalled();
    const [source, frame] = spy.mock.calls.at(-1)!;
    expect(source.history).toBe(p);
    expect(frame).toBe(99);
    // what it gave, presented open
    const covering = projection.situationAt({ history: p }, 99);
    const open = (spans: readonly object[]) => spans.map((s) => {
      const { end: _end, endFrame: _endFrame, ...rest } = s as Span;
      return rest;
    });
    expect(v.situation.byMachine['car-status']).toEqual(open(covering['car-status'] ?? []));
  });
});
