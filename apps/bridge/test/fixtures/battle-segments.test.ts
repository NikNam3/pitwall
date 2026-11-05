// The battle cards follow race control's DRS status (race-control-race's spans), on race-zandvoort-vsc (DRSD, wet
// track, at 914.178 s with the VSC; cut mid-race, so the race is joined after the lights out); facts in
// fixtures/index.json. The engine plus battle and the calculators it reads.
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
  it('race-zandvoort-vsc: joined after the lights out, every card has DRS enabled until the DRSD, then off with reason wetTrack', async () => {
    const runs = await drsRuns('race-zandvoort-vsc.pwrec.gz');
    // the drsOff span opens on the frame after the DRSD's time (914.192 s); battle runs every frame, that of 914.178 s included
    const first = runs.findIndex((r) => r.at > DRSD_AT);
    expect(first).toBeGreaterThan(0);
    const enabled: DrsStatus = { enabled: true };
    const wet: DrsStatus = { enabled: false, reason: 'wetTrack' };
    for (const r of runs.slice(0, first)) {
      expect(r.drs.length).toBeGreaterThan(0);
      expect(r.drs, `at ${r.at}`).toEqual(r.drs.map(() => enabled));
    }
    for (const r of runs.slice(first)) {
      expect(r.drs.length).toBeGreaterThan(0);
      expect(r.drs, `at ${r.at}`).toEqual(r.drs.map(() => wet));
    }
  });
});
