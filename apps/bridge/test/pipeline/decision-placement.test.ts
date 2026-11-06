// Where a committed decision lands (C76, C38; C61, C90; ruling R28): the module in the rules-version walk carries out the
// whole rule, so the pipeline and the session processor only call it. `RecordedPlacement.deliver` hands a record's
// decisions to the session before it runs the record's processing (decode, push, record); `SessionRecords` decides which
// records count toward a decision's record index (the session's own uid, or uid 0) and places a decision committed now.
import { describe, expect, it } from 'vitest';
import { RecordedPlacement, SessionRecords, type Placed } from '../../src/pipeline/decision-placement.ts';

const SESSION = 42n;
const OTHER = 7n;

/** Runs `records` through `placement.deliver`, logging every step in the order the module takes it. */
const deliverAll = <D, R>(placement: RecordedPlacement<D>, records: readonly R[]): string[] => {
  const steps: string[] = [];
  for (const record of records) {
    placement.deliver(record, {
      decide: (decision) => steps.push(`decide ${String(decision)}`),
      process: (processed) => steps.push(`process ${String(processed)}`),
    });
  }
  return steps;
};

describe('decision placement', () => {
  it('the decisions of record i are delivered before record i is processed', () => {
    const placement = new RecordedPlacement<string>([
      { recordIndex: 1, decision: 'a' },
      { recordIndex: 1, decision: 'b' },
      { recordIndex: 3, decision: 'c' },
    ]);
    expect(deliverAll(placement, ['r0', 'r1', 'r2', 'r3', 'r4'])).toEqual([
      'process r0',
      'decide a',
      'decide b',
      'process r1',
      'process r2',
      'decide c',
      'process r3',
      'process r4',
    ]);
  });

  it("a committed decision's record index is the module's count of the session's records", () => {
    const records = new SessionRecords(SESSION);
    const written: string[] = [];
    const keep = (uid: bigint | undefined, name: string) => records.keep(uid, () => written.push(name));

    expect(records.place('first')).toEqual<Placed<string>>({ recordIndex: 0, decision: 'first' });
    keep(SESSION, 'own 0');
    keep(OTHER, 'other');
    keep(0n, 'uid 0');
    keep(undefined, 'no header');
    keep(SESSION, 'own 1');

    expect(written).toEqual(['own 0', 'uid 0', 'own 1']);
    expect(records.count).toBe(3);
    expect(records.place('second')).toEqual<Placed<string>>({ recordIndex: 3, decision: 'second' });
  });

  it('a live commit and its replay deliver the decision before the same record', () => {
    const uids = [SESSION, 0n, SESSION, SESSION, SESSION];
    const commitAfter = 3;

    // Live: the user commits once `commitAfter` records are kept; the session holds it before the next record.
    const live = new SessionRecords(SESSION);
    const liveSteps: string[] = [];
    const placed: Placed<string>[] = [];
    uids.forEach((uid, index) => {
      if (index === commitAfter) {
        placed.push(live.place('pick'));
        liveSteps.push('decide pick');
      }
      live.keep(uid, () => liveSteps.push(`process r${index}`));
    });
    expect(placed).toEqual([{ recordIndex: commitAfter, decision: 'pick' }]);

    // Replay of the session file: the same records, the decision from the sidecar.
    const replaySteps = deliverAll(new RecordedPlacement(placed), uids.map((_, index) => `r${index}`));

    expect(replaySteps).toEqual(liveSteps);
    expect(replaySteps.indexOf('decide pick')).toBe(replaySteps.indexOf(`process r${commitAfter}`) - 1);
  });
});
