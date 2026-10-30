// The battle cards follow race control's DRS status, on race-zandvoort-vsc (DRSD, wet track, at 914.178 s with the
// VSC); facts in fixtures/index.json. The engine plus battle and the calculators it reads.
import { describe, expect, it } from 'vitest';
import { BATTLE, battleCalculator, gapsCalculator, paceCalculator, type BattleOutput } from '@pitwall/analysis';
import type { DrsStatus } from '@pitwall/domain';
import { replayScheduled } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

const DRSD_AT = 914_178;

/** The session time and every card's DRS status of each battle run over the segment, in order. */
async function drsRuns(file: string): Promise<{ at: number; drs: DrsStatus[] }[]> {
  const runs: { at: number; drs: DrsStatus[] }[] = [];
  await replayScheduled(segmentPath(file), [battleCalculator, gapsCalculator, paceCalculator], ({ state }, scheduled) => {
    if (!scheduled.ran.includes(BATTLE)) return;
    const out = scheduled.outputs.get(BATTLE) as BattleOutput;
    runs.push({ at: state.sessionTime, drs: structuredClone(Object.values(out).map((c) => c.drs)) });
  });
  return runs;
}

describe('battle on real data', () => {
  it('race-zandvoort-vsc: every card turns DRS off with reason wetTrack from the DRSD frame on, not before', async () => {
    const runs = await drsRuns('race-zandvoort-vsc.pwrec.gz');
    const first = runs.findIndex((r) => r.at >= DRSD_AT);
    expect(first).toBeGreaterThan(0);
    const wet: DrsStatus = { enabled: false, reason: 'wetTrack' };
    for (const r of runs.slice(0, first)) expect(r.drs, `at ${r.at}`).not.toContainEqual(wet);
    for (const r of runs.slice(first)) {
      expect(r.drs.length).toBeGreaterThan(0);
      expect(r.drs, `at ${r.at}`).toEqual(r.drs.map(() => wet));
    }
  });
});
