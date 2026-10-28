import { describe, expect, it } from 'vitest';
import { sessionRecordingName } from '../../src/storage/session-files.ts';

describe('sessionRecordingName', () => {
  it('is the recorder convention: local time, uid as 16 hex digits', () => {
    expect(sessionRecordingName(new Date(2026, 9, 28, 13, 5, 9).getTime(), 77n)).toBe('2026-10-28_13-05-09_000000000000004d.pwrec.gz');
  });
  it('pads every date and time part to two digits', () => {
    expect(sessionRecordingName(new Date(2026, 0, 2, 3, 4, 5).getTime(), 1n)).toBe('2026-01-02_03-04-05_0000000000000001.pwrec.gz');
  });
  it('keeps all 64 bits of the uid', () => {
    expect(sessionRecordingName(new Date(2026, 9, 28, 0, 0, 0).getTime(), 0xb3cd07e2790bdcben)).toBe('2026-10-28_00-00-00_b3cd07e2790bdcbe.pwrec.gz');
    expect(sessionRecordingName(new Date(2026, 9, 28, 23, 59, 59).getTime(), 1895827638050388100n)).toBe('2026-10-28_23-59-59_1a4f5531395c7884.pwrec.gz');
  });
});
