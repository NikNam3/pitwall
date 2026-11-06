// The race moment at a neutralisation, on race-zandvoort-vsc (VSC deployed) and race-zandvoort-retire (SC deployed when
// the player retires); facts in fixtures/index.json. The engine plus race-moment and the calculators it reads.
import { describe, expect, it } from 'vitest';
import {
  alarmsCalculator,
  battleCalculator,
  carBandsCalculator,
  damageCalculator,
  degradationCalculator,
  fuelCalculator,
  gapsCalculator,
  incidentsCalculator,
  paceCalculator,
  RACE_MOMENT,
  raceMomentCalculator,
  rainOutlookCalculator,
  sessionRemainingCalculator,
  tyreLifeCalculator,
  tyreWearCalculator,
  type RaceMomentOutput,
} from '@pitwall/analysis';
import type { NeutralisedDetail } from '@pitwall/domain';
import { situationOf } from '@pitwall/engine';
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
  tyreLifeCalculator,
  degradationCalculator,
  fuelCalculator,
  sessionRemainingCalculator,
  carBandsCalculator,
  rainOutlookCalculator,
];

/**
 * The race's neutralisation or suspension open on that frame (the open `session-phase-race` span, C20), by the kind
 * race-moment names it (SC, VSC, red), and its start.
 */
const openPhaseOf = (state: Parameters<typeof situationOf>[0]): { kind: string; start: number } | undefined => {
  const open = situationOf(state).byMachine['session-phase-race']?.[0];
  if (open?.kind === 'neutralised') return { kind: (open.detail as NeutralisedDetail).car, start: open.start };
  return open?.kind === 'suspended' ? { kind: 'red', start: open.start } : undefined;
};

/** One run of race-moment: its output and the neutralisation open on that frame (its kind and start), if any. */
type MomentRun = { moment: RaceMomentOutput; phase: { kind: string; start: number } | undefined };

/** Every run of race-moment over the segment, in order; no unit fails on any step. */
async function momentRuns(file: string): Promise<MomentRun[]> {
  const runs: MomentRun[] = [];
  await replayScheduled(segmentPath(file), CALCULATORS, ({ state }, scheduled) => {
    // no unit fails: race-moment reads the incidents output as it is (`.feed`), so a reader of the old shape throws here
    expect(scheduled.errors).toEqual([]);
    if (!scheduled.ran.includes(RACE_MOMENT)) return;
    runs.push({ moment: structuredClone(scheduled.outputs.get(RACE_MOMENT) as RaceMomentOutput), phase: openPhaseOf(state) });
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

  // Situations spec 3.1 (approved 2026-10-30): the SC announced at the player's terminal damage is never confirmed by the
  // safety car status before the session is simulated to its end, so it opens no neutralisation (it replaces the F2 pin).
  it('race-zandvoort-retire: an SC announced just before the simulated end is never confirmed: the moment never turns neutralised', async () => {
    const runs = await momentRuns('race-zandvoort-retire.pwrec.gz');
    expect(runs.filter((r) => r.phase !== undefined)).toEqual([]);
    expect(runs.filter((r) => momentOf(r) === 'neutralised')).toEqual([]);
  });
});
