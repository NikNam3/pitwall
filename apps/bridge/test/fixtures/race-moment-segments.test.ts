// The race moment at a neutralisation, on race-zandvoort-vsc (VSC deployed) and race-zandvoort-retire (SC deployed when
// the player retires); facts in fixtures/index.json. The engine plus race-moment and the calculators it reads.
import { describe, expect, it } from 'vitest';
import {
  alarmsCalculator,
  battleCalculator,
  carBandsCalculator,
  damageCalculator,
  fuelCalculator,
  gapsCalculator,
  incidentsCalculator,
  paceCalculator,
  RACE_MOMENT,
  raceMomentCalculator,
  sessionRemainingCalculator,
  tyreWearCalculator,
  type RaceMomentOutput,
} from '@pitwall/analysis';
import { activeFlagPhaseOf } from '@pitwall/engine';
import { replayScheduled } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

const CALCULATORS = [
  raceMomentCalculator,
  incidentsCalculator,
  damageCalculator,
  battleCalculator,
  gapsCalculator,
  paceCalculator,
  alarmsCalculator,
  tyreWearCalculator,
  fuelCalculator,
  sessionRemainingCalculator,
  carBandsCalculator,
];

/** One run of race-moment: its output and the flag phase open on that frame (its kind and start), if any. */
type MomentRun = { moment: RaceMomentOutput; phase: { kind: string; start: number } | undefined };

/** Every run of race-moment over the segment, in order. */
async function momentRuns(file: string): Promise<MomentRun[]> {
  const runs: MomentRun[] = [];
  await replayScheduled(segmentPath(file), CALCULATORS, ({ state }, scheduled) => {
    if (!scheduled.ran.includes(RACE_MOMENT)) return;
    const open = activeFlagPhaseOf(state);
    runs.push({ moment: structuredClone(scheduled.outputs.get(RACE_MOMENT) as RaceMomentOutput), phase: open && { kind: open.kind, start: open.start } });
  });
  return runs;
}

const momentOf = (r: MomentRun) => (r.moment.known ? r.moment.value.moment : r.moment.reason);

/**
 * The race moment is `neutralised` on no run before the phase opens; from the first run after it opens, on every
 * run, with the phase's kind as cause and its start as `since`.
 */
function expectNeutralisedFromThePhase(runs: MomentRun[], kind: string, startMs: number): void {
  const first = runs.findIndex((r) => r.phase !== undefined);
  expect(first).toBeGreaterThan(0);
  expect(runs.slice(0, first).filter((r) => momentOf(r) === 'neutralised')).toEqual([]);
  for (const r of runs.slice(first)) {
    expect(r.phase).toEqual({ kind, start: startMs });
    expect(r.moment).toMatchObject({
      known: true,
      value: { moment: 'neutralised', cause: { rule: 'flagPhase', params: { kind } }, since: { known: true, value: startMs } },
    });
  }
}

describe('race moment at a neutralisation', () => {
  it('race-zandvoort-vsc: the moment turns neutralised by the VSC when its phase opens at the SCAR, not before', async () => {
    expectNeutralisedFromThePhase(await momentRuns('race-zandvoort-vsc.pwrec.gz'), 'VSC', 914_178);
  });

  it('race-zandvoort-retire: the moment turns neutralised by the SC when its phase opens at the SCAR, not before', async () => {
    expectNeutralisedFromThePhase(await momentRuns('race-zandvoort-retire.pwrec.gz'), 'SC', 1_207_667);
  });
});
