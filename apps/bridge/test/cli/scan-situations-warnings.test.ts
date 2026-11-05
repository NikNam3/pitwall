import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ScenarioBuilder, packetBytes } from '../../../../packages/engine/test/builders/index.ts';
import { PwrecWriter } from '../../src/pwrec/writer.ts';
import type { CliIo } from '../../src/cli/io.ts';

// `pitwall scan-situations --warnings <dir>` (Task 6b: evidence for the user's decision which warnings lead to penalties):
// per recording and weekend phase, one row per penalty of the player car, `<phase>, <kind> (infringement <n>): warnings
// <count>, cornerCutting <n>`, the kind as words (`time penalty`, `drive-through`, `stop-go`), the infringement the
// penalty record's (`unknown` when it is unknown), `warnings` and `cornerCutting` those of the car's `warned` span the
// penalty belongs to. The span is the one covering the penalty's frame (`membershipOf`, C26), not the latest one: a
// later warning does not change the row. The real machines run (the generated index is not replaced).

const PENA = (penaltyType: number, infringementType: number) => ({ code: 'PENA', penaltyType, infringementType, vehicleIdx: 0, otherVehicleIdx: 255, time: 0, lapNum: 1, placesGained: 0 }) as const;
const WARNING = 5;
const TIME_PENALTY = 4;
const CORNER_CUTTING = 7;
const COLLISION = 3;
const TIME_INFRINGEMENT = 21;

/** A race of two cars (the player is car 0): 2 corner-cutting warnings, a collision warning, a time penalty, then a fourth warning. */
async function recording(): Promise<{ dir: string; file: string }> {
  const lap = (f: { lapData: { lapData: Array<Record<string, number>> } }) => f.lapData.lapData[0]!;
  const warn = (builder: ScenarioBuilder, infringement: number, total: number, cutting: number) =>
    builder.event(PENA(WARNING, infringement)).frame((f) => Object.assign(lap(f), { totalWarnings: total, cornerCuttingWarnings: cutting })).frames(40, () => {});
  let builder = new ScenarioBuilder({ cars: 2 }).participants().frames(60, () => {});
  builder = warn(builder, CORNER_CUTTING, 1, 1);
  builder = warn(builder, CORNER_CUTTING, 2, 2);
  builder = warn(builder, COLLISION, 3, 2);
  builder = builder.event(PENA(TIME_PENALTY, TIME_INFRINGEMENT)).frame((f) => Object.assign(lap(f), { penalties: 5 })).frames(40, () => {});
  builder = warn(builder, COLLISION, 4, 2);
  const dir = mkdtempSync(join(tmpdir(), 'scan-warnings-'));
  const file = 'race-warnings.pwrec.gz';
  const writer = PwrecWriter.create(join(dir, file), { recorderVersion: 'test', startedAt: '2026-01-01T10:00:00.000Z', listenPort: 20_777 });
  for (const { packet, receivedAtMs } of builder.packets()) writer.write(receivedAtMs, packetBytes(packet));
  await writer.close(builder.packets().at(-1)!.receivedAtMs);
  return { dir, file };
}

async function scanWarnings(dir: string) {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, signal: new AbortController().signal };
  vi.resetModules();
  vi.doUnmock('../../../../packages/engine/src/situations/index.generated.ts');
  const { run } = await import('../../src/cli/commands/scan-situations.ts');
  const code = await run([dir], { warnings: true }, io);
  return { code, out: out.flatMap((l) => l.split('\n')), err: err.join('\n') };
}

describe('pitwall scan-situations --warnings', () => {
  it('prints a penalty with the count and the corner-cutting count of the warned span it belongs to', { timeout: 60_000 }, async () => {
    const { dir, file } = await recording();
    const r = await scanWarnings(dir);
    expect(r.code).toBe(0);
    expect(r.err).toBe('');
    expect(r.out.filter((l) => l.includes('penalty'))).toEqual([`race, time penalty (infringement ${TIME_INFRINGEMENT}): warnings 3, cornerCutting 2`]);
    expect(r.out.some((l) => l.includes(file))).toBe(true);
  });

  it('prints no transition lines: the table replaces them', { timeout: 60_000 }, async () => {
    const { dir } = await recording();
    const r = await scanWarnings(dir);
    expect(r.out.filter((l) => l.includes(' -> '))).toEqual([]);
  });
});
