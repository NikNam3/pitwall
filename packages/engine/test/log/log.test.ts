// The append-only log (C21, C22, C24): a writer appends facts to lists and every fact's id is its list and the number of
// facts of that list before it in the current timeline (the log without the facts a void fact covers), so a fact
// appended after a flashback gets the id a run without the rewind gives it (C33). Void ranges stay log positions. An
// appended fact is read-only, all the way down (C24).
import { describe, expect, it } from 'vitest';
import { carId } from '@pitwall/domain';
import { createLog, logLengths, logWriter } from '../../src/log/log.ts';
import { clockJump, crossing, event, span, voidFact } from '../support/log-facts.ts';

describe('log', () => {
  it("append returns the fact's ref (list, index): without a void fact, its position in its list", () => {
    const writer = logWriter(createLog());
    expect(writer.append('events', event(1000))).toEqual({ list: 'events', index: 0 });
    expect(writer.append('events', event(2000))).toEqual({ list: 'events', index: 1 });
    expect(writer.append('spans:flags', span('flags', 0, 'yellow', 1000, 3000))).toEqual({ list: 'spans:flags', index: 0 });
    expect(writer.append('clock', clockJump(2500))).toEqual({ list: 'clock', index: 0 });
    expect(writer.append('events', event(3000))).toEqual({ list: 'events', index: 2 });
    expect(writer.append('spans:session-phase', span('session-phase', 0, 'formation', 0, 4000))).toEqual({ list: 'spans:session-phase', index: 0 });
    expect(writer.append('spans:flags', span('flags', 1, 'green', 3000, 5000))).toEqual({ list: 'spans:flags', index: 1 });
  });

  it('a fact appended after a void gets the id counted without the voided facts of its list (C21)', () => {
    const log = createLog();
    const writer = logWriter(log);
    for (const at of [1000, 2000, 3000]) writer.append('events', event(at));
    writer.append('crossings', crossing(carId(0), 1500, 0));
    // a flashback voids events at log positions 1 and 2; no crossing
    writer.append('voids', voidFact(7, 1500, { events: [1, 3] }));
    expect(writer.append('events', event(1600))).toEqual({ list: 'events', index: 1 });
    expect(writer.append('events', event(1700))).toEqual({ list: 'events', index: 2 });
    expect(writer.append('crossings', crossing(carId(0), 1600, 0))).toEqual({ list: 'crossings', index: 1 });
    // the log keeps every fact at its log position (C24); the void fact's ranges stay log positions
    expect(log.events.map((e) => e.at)).toEqual([1000, 2000, 3000, 1600, 1700]);
    expect(log.voids[0]!.ranges).toEqual({ events: [1, 3] });
  });

  it('after a second void the id counts the current timeline: every void range of the list is left out', () => {
    const writer = logWriter(createLog());
    for (const at of [1000, 2000, 3000]) writer.append('events', event(at));
    writer.append('voids', voidFact(7, 1500, { events: [1, 3] }));
    writer.append('events', event(1600)); // log position 3, id 1
    writer.append('events', event(1700)); // log position 4, id 2
    writer.append('voids', voidFact(8, 1650, { events: [4, 5] }));
    expect(writer.append('events', event(1660))).toEqual({ list: 'events', index: 2 });
  });

  it('a void range of one list leaves the ids of every other list, the span lists too, as their positions', () => {
    const writer = logWriter(createLog());
    writer.append('spans:flags', span('flags', 0, 'yellow', 0, 1000));
    writer.append('events', event(500));
    writer.append('voids', voidFact(7, 400, { events: [0, 1] }));
    expect(writer.append('spans:flags', span('flags', 1, 'green', 1000, 2000))).toEqual({ list: 'spans:flags', index: 1 });
    expect(writer.append('events', event(450))).toEqual({ list: 'events', index: 0 });
  });

  it('a voided span list gives the span appended after it the id counted without the voided spans', () => {
    const writer = logWriter(createLog());
    writer.append('spans:flags', span('flags', 0, 'yellow', 0, 1000));
    writer.append('spans:flags', span('flags', 1, 'green', 1000, 2000));
    writer.append('voids', voidFact(7, 900, { 'spans:flags': [1, 2] }));
    expect(writer.append('spans:flags', span('flags', 1, 'green', 1000, 2500))).toEqual({ list: 'spans:flags', index: 1 });
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
  it('an appended fact is read-only: the fact, and every array and object it holds, is frozen (C24)', () => {
    const log = createLog();
    const writer = logWriter(log);
    const stages = [{ stage: 'deployed', at: 1000 }];
    writer.append('spans:session-phase-race', { ...span('session-phase-race', 0, 'neutralised', 1000, 3000), detail: { car: 'SC', stages } });
    writer.append('events', { ...event(1000), params: { lights: 1 } });
    writer.append('voids', voidFact(7, 1500, { events: [0, 1] }));
    const [stored] = log.spans['session-phase-race']!;
    const [recorded] = log.events;
    const [voided] = log.voids;
    for (const frozen of [stored, stored!.detail, (stored!.detail as { stages: unknown[] }).stages, stages[0], recorded, recorded!.params, voided, voided!.ranges, voided!.target]) {
      expect(Object.isFrozen(frozen)).toBe(true);
    }
    expect(() => {
      (stored as { kind: string }).kind = 'racing';
    }).toThrow(TypeError);
    expect(() => {
      (stored!.detail as { stages: unknown[] }).stages.push({ stage: 'resume', at: 2000 });
    }).toThrow(TypeError);
    expect(stored).toMatchObject({ kind: 'neutralised', detail: { car: 'SC', stages: [{ stage: 'deployed', at: 1000 }] } });
  });
});
