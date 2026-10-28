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
});
describeWithFixture('raceSingapore', 'pwrec fixture: raceSingapore', () => {
  it('24 726 datagrams, clean end, first record directly after the metadata (offset 10 + n)', async () => {
    const path = fixturePath('raceSingapore')!;
    const bytes = gunzipSync(readFileSync(path), { finishFlush: constants.Z_SYNC_FLUSH });
    const n = bytes.readUInt32LE(6);
    expect(n).toBe(85);
    expect(bytes[10 + n]).toBe(0);
    const { records, summary } = await drain(path);
    expect(records[0]!.t).toBe(bytes.readDoubleLE(10 + n + 1));
    expect(records).toHaveLength(24_726);
    expect(summary).toMatchObject({ endedCleanly: true });
    expect(summary.durationMs).toBeCloseTo(79_458.7947, 3);
  }, 60_000);
});
