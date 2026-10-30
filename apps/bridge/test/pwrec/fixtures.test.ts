import { readFileSync } from 'node:fs';
import { constants, gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { describeWithFixture, fixturePath } from '../../../../test-support/fixtures.ts';
import { drain } from './helpers.ts';

describeWithFixture('menuOnly', 'pwrec fixture: menuOnly', () => {
  it('385 datagrams of 45 bytes (BUTN events), clean end', async () => {
    const { records, summary } = await drain(fixturePath('menuOnly')!);
    expect(records).toHaveLength(385);
    expect(records.every((r) => r.payload.length === 45)).toBe(true);
    expect(summary.meta).toEqual({ recorderVersion: '0.1.0', listenPort: 20777, startedAt: '2026-10-27T21:50:28.331Z' });
    expect(summary.endedCleanly).toBe(true);
    expect(summary.durationMs).toBeCloseTo(2_475_323.6368, 3);
  });
  it('the first record follows the metadata directly (offset 10 + n)', async () => {
    const path = fixturePath('menuOnly')!;
    const bytes = gunzipSync(readFileSync(path), { finishFlush: constants.Z_SYNC_FLUSH });
    const n = bytes.readUInt32LE(6);
    expect(bytes[10 + n]).toBe(0);
    const { records } = await drain(path);
    expect(records[0]!.t).toBe(bytes.readDoubleLE(10 + n + 1));
  });
});
