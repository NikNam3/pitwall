import { describe, expect, it } from 'vitest';
import { sessionRecordingName } from '../../src/storage/session-files.ts';

describe('sessionRecordingName', () => {
  // Task 27 (C1a, C59): one file per feed of a session, so the name carries the feed's player car, two digits
  it('is the recorder convention: local time, uid as 16 hex digits, then the player car', () => {
    expect(sessionRecordingName(new Date(2026, 9, 28, 13, 5, 9).getTime(), 77n, 1)).toBe('2026-10-28_13-05-09_000000000000004d_car01.pwrec.gz');
  });
  it('pads every date and time part and the player car to two digits', () => {
    expect(sessionRecordingName(new Date(2026, 0, 2, 3, 4, 5).getTime(), 1n, 0)).toBe('2026-01-02_03-04-05_0000000000000001_car00.pwrec.gz');
    expect(sessionRecordingName(new Date(2026, 0, 2, 3, 4, 5).getTime(), 1n, 21)).toBe('2026-01-02_03-04-05_0000000000000001_car21.pwrec.gz');
  });
  it('two feeds of one session get two names', () => {
    const at = new Date(2026, 9, 28, 13, 5, 9).getTime();
    expect(sessionRecordingName(at, 77n, 3)).not.toBe(sessionRecordingName(at, 77n, 4));
  });
  it('keeps all 64 bits of the uid', () => {
    expect(sessionRecordingName(new Date(2026, 9, 28, 0, 0, 0).getTime(), 0xb3cd07e2790bdcben, 19)).toBe('2026-10-28_00-00-00_b3cd07e2790bdcbe_car19.pwrec.gz');
    expect(sessionRecordingName(new Date(2026, 9, 28, 23, 59, 59).getTime(), 1895827638050388100n, 1)).toBe('2026-10-28_23-59-59_1a4f5531395c7884_car01.pwrec.gz');
  });
});
