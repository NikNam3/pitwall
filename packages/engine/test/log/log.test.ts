// The append-only log (C21, C22, C24): a writer appends facts to lists and every fact's id is its list and position.
import { describe, expect, it } from 'vitest';
import { createLog, logLengths, logWriter } from '../../src/log/log.ts';
import { clockJump, event, span, voidFact } from '../support/log-facts.ts';

describe('log', () => {
  it("append returns the fact's ref (list, index)", () => {
    const writer = logWriter(createLog());
    expect(writer.append('events', event(1000))).toEqual({ list: 'events', index: 0 });
    expect(writer.append('events', event(2000))).toEqual({ list: 'events', index: 1 });
    expect(writer.append('spans:flags', span('flags', 0, 'yellow', 1000, 3000))).toEqual({ list: 'spans:flags', index: 0 });
    expect(writer.append('clock', clockJump(2500))).toEqual({ list: 'clock', index: 0 });
    expect(writer.append('events', event(3000))).toEqual({ list: 'events', index: 2 });
    expect(writer.append('spans:session-phase', span('session-phase', 0, 'formation', 0, 4000))).toEqual({ list: 'spans:session-phase', index: 0 });
    expect(writer.append('spans:flags', span('flags', 1, 'green', 3000, 5000))).toEqual({ list: 'spans:flags', index: 1 });
  });

  it('lengths count every list', () => {
    const log = createLog();
    expect(Object.values(logLengths(log)).every((n) => n === 0)).toBe(true);

    const writer = logWriter(log);
    writer.append('events', event(1000));
    writer.append('events', event(2000));
    writer.append('clock', clockJump(1500));
    writer.append('spans:flags', span('flags', 0, 'yellow', 0, 1000));
    writer.append('spans:flags', span('flags', 1, 'green', 1000, 2000));
    writer.append('spans:flags', span('flags', 2, 'yellow', 2000, 3000));
    writer.append('spans:session-phase', span('session-phase', 0, 'formation', 0, 2000));
    writer.append('voids', voidFact(7, 1800, { events: [1, 2] }));

    const lengths = logLengths(log);
    expect(lengths.events).toBe(2);
    expect(lengths.clock).toBe(1);
    expect(lengths['spans:flags']).toBe(3);
    expect(lengths['spans:session-phase']).toBe(1);
    expect(lengths.voids).toBe(1);
    for (const empty of ['laps', 'stints', 'pitStops', 'crossings'] as const) expect(lengths[empty] ?? 0).toBe(0);
    // The writer reads the same lengths as `logLengths` (the runner reads them through either, C28).
    expect(writer.lengths()).toEqual(lengths);
  });
});
