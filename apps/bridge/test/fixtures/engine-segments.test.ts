// The engine on committed segments of normal sessions, one behaviour per segment (facts verified in fixtures/index.json).
import { describe, expect, it } from 'vitest';
import { currentLaps, type LapRecord } from '@pitwall/domain';
import { situationOf, type FlashbackInfo, type StepResult } from '@pitwall/engine';
import { InvariantChecker } from '../../../../packages/engine/test/support/invariants.ts';
import { carsInSession as inSession, replayRunner } from './engine-replay.ts';
import { SEGMENT_FILES, segmentPath } from './replay.ts';

const run = (file: string, onResult?: (r: StepResult) => void) => replayRunner(segmentPath(file), onResult);
/** The cars seen retiring: a `retired` car-status span, closed or open (C20), that opened in the segment (not on joining it). */
const retired = (state: StepResult['state']): number[] =>
  [...(state.history.spans['car-status'] ?? []), ...(situationOf(state).byMachine['car-status'] ?? [])].filter((s) => s.kind === 'retired' && s.joinedAt !== true).map((s) => s.carId!);

describe('race-zandvoort-lap10: car 1 (the player) crosses the line into lap 10', () => {
  it('records lap 9 as provisional from LapData, then confirmed from SessionHistory, with 74 655 ms', async () => {
    const { state } = await run('race-zandvoort-lap10.pwrec.gz');
    const laps = state.history.laps.filter((l) => l.carId === 1);
    expect(laps.map((l) => [l.lapNumber, l.status, l.lapTimeMs, l.completedAt])).toEqual([[9, 'provisional', 74_655, 723_381], [9, 'confirmed', 74_655, 723_381]]);
    const confirmed = laps[1]!;
    const sectorSum = confirmed.sectorTimesMs[0] + confirmed.sectorTimesMs[1] + confirmed.sectorTimesMs[2]; // spec 10.2: lapTime - 2 <= sum <= lapTime
    expect(sectorSum).toBeLessThanOrEqual(confirmed.lapTimeMs);
    expect(sectorSum).toBeGreaterThanOrEqual(confirmed.lapTimeMs - 2);
    expect(confirmed.valid.lap).toBe(true);
    expect(currentLaps(state.history.laps as LapRecord[]).filter((l) => l.carId === 1).map((l) => [l.lapNumber, l.status])).toEqual([[9, 'confirmed']]);
  });

  it('the lap record carries the lap-end samples: tyre wear and the ERS store', async () => {
    const { state } = await run('race-zandvoort-lap10.pwrec.gz');
    const lap = state.history.laps.find((l) => l.carId === 1 && l.status === 'confirmed')!;
    expect(lap.wearAtEndPct).toMatchObject({ fl: { known: true }, fr: { known: true }, rl: { known: true }, rr: { known: true } });
    expect(lap.ersStoreAtEndJ).toMatchObject({ known: true });
  });

  it('FTLP becomes a fastestLap event with the lap time', async () => {
    const { state } = await run('race-zandvoort-lap10.pwrec.gz');
    expect(state.history.events.filter((e) => e.kind === 'fastestLap')).toEqual([{ at: 723_381, kind: 'fastestLap', carId: 1, params: { lapTimeMs: 74_655 }, frame: 164 }]);
  });

  it('mini-sector crossings come in order, and the line crossing lies between the last frame of lap 9 and the first of lap 10', async () => {
    const seen = { lastOnLap9: -1, firstOnLap10: -1 };
    const { state } = await run('race-zandvoort-lap10.pwrec.gz', ({ state: st }) => {
      if (st.cars[1]!.timing.lap === 9) seen.lastOnLap9 = st.sessionTime;
      if (st.cars[1]!.timing.lap === 10 && seen.firstOnLap10 < 0) seen.firstOnLap10 = st.sessionTime;
    });
    const mine = state.history.crossings.filter((m) => m.carId === 1);
    expect(mine.map((m) => [m.lap, m.segment])).toEqual([[9, 48], [9, 49], [10, 0], [10, 1], [10, 2]]);
    expect(mine.every((m, i) => i === 0 || m.at > mine[i - 1]!.at)).toBe(true);
    const line = mine.find((m) => m.lap === 10 && m.segment === 0)!.at;
    expect(line).toBeGreaterThanOrEqual(seen.lastOnLap9);
    expect(line).toBeLessThanOrEqual(seen.firstOnLap10);
  });

  // Task 24 (C13): the session type, kind and numActiveCars are signals (`state.signals`); the race is the weekend phase
  it('session and identity: online race, two humans, the player at index 1, every car keyed by its team and race number', async () => {
    const { state } = await run('race-zandvoort-lap10.pwrec.gz');
    expect(state.session).toMatchObject({ trackId: 26, totalLaps: 72, trackLengthM: 4258, networkGame: true });
    expect(situationOf(state).weekendPhase).toMatchObject({ kind: 'race' });
    expect([state.signals.session.sessionType, state.signals.session.numActiveCars]).toEqual([15, 20]);
    expect([state.playerCar, state.teammateCar]).toEqual([1, 4]);
    expect(state.cars[1]!.identity).toMatchObject({ visibility: 'own', networkId: 1 });
    expect(state.cars[0]!.identity).toMatchObject({ visibility: 'public', networkId: 0 });
    // Task 27 (user, 2026-11-04): pitwall stores no player identity; a car is its team and race number (C62)
    expect(state.cars[2]!.identity).not.toHaveProperty('driverKey');
    expect(inSession(state)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('grid positions count from 1 like the positions: the grid is P1 to P20, and the field gained as many places as it lost', async () => {
    const { state } = await run('race-zandvoort-lap10.pwrec.gz');
    const cars = inSession(state).map((id) => state.cars[id]!);
    expect(cars.map((c) => c.timing.gridPosition).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(cars.reduce((sum, c) => sum + c.timing.gridPosition - c.timing.position, 0)).toBe(0);
  });
});

// The start lights and lights out are the race's session-phase spans (C13, C20), never race events (Task 21).
describe('race-singapore-start: start lights and lights out', () => {
  it('STLG x5 then LGOT: one startLights span from the first light to lights out, where racing opens, all at session time 0', async () => {
    const { state } = await run('race-singapore-start.pwrec.gz');
    const closed = state.history.spans['session-phase-race'] ?? [];
    const lights = closed.filter((s) => s.kind === 'startLights');
    expect(lights.map((s) => [s.start, s.end])).toEqual([[0, 0]]);
    const racing = [...closed, ...(situationOf(state).byMachine['session-phase-race'] ?? [])].find((s) => s.kind === 'racing');
    expect(racing).toMatchObject({ start: 0, startFrame: lights[0]!.endFrame });
  });
});

describe('race-zandvoort-pit-stop: car 1 enters the pits, starts lap 8 in the pit lane and changes mediums for softs', () => {
  // A stint closes when the box stop ends on the new set, a pit stop is recorded at the pit exit (migration Task 17,
  // ruling 3): the car is still in its box when the segment ends, so neither is recorded yet.
  it('lap 7 is the in lap on mediums; the softs are fitted in the box, whose stop has not ended: no stint closes and no pit stop is recorded yet', async () => {
    const { state } = await run('race-zandvoort-pit-stop.pwrec.gz');
    // the activity's closed spans of car 1: racingLap and inLap; its boxStop is still open
    expect(state.history.spans['car-activity-race']?.filter((s) => s.carId === 1).map((s) => s.kind)).toEqual(['racingLap', 'inLap']);
    expect(state.history.stints.filter((s) => s.carId === 1)).toEqual([]);
    expect(state.history.pitStops.filter((s) => s.carId === 1)).toEqual([]);
    expect(state.cars[1]!.tyres).toMatchObject({ actualCompound: 'C4', visualCompound: 'soft', age: 0 });
    expect(state.history.laps.find((l) => l.carId === 1 && l.lapNumber === 7)).toMatchObject({ inLap: true, actualCompound: 'C3' });
  });
});

describe('race-zandvoort-pit-exit: car 1 still in the pit lane after its stop', () => {
  // Task 24 (C13): numPitStops is a signal (`state.signals`)
  it('numPitStops goes from 0 to 1', async () => {
    const counts: number[] = [];
    await run('race-zandvoort-pit-exit.pwrec.gz', ({ state }) => {
      const n = state.signals.cars[1]!.numPitStops;
      if (counts.at(-1) !== n) counts.push(n);
    });
    expect(counts).toEqual([0, 1]);
  });
});

describe('race-zandvoort-vsc: car 2 stops with terminal damage and the VSC comes out', () => {
  it('SCAR opens a VSC neutralisation of the race, then the Session packet sets the vsc flag and counts the period', async () => {
    const flags: string[] = [];
    // Task 24 (C13): the safety car status and the periods are signals (`state.signals`)
    const { state } = await run('race-zandvoort-vsc.pwrec.gz', ({ state: st }) => {
      if (flags.at(-1) !== st.signals.session.safetyCarStatus) flags.push(st.signals.session.safetyCarStatus);
    });
    expect(situationOf(state).byMachine['session-phase-race']).toMatchObject([{ kind: 'neutralised', start: 914_178, detail: { car: 'VSC', stages: [{ stage: 'deployed', at: 914_178 }] } }]);
    expect(flags).toEqual(['green', 'vsc']);
    expect(state.signals.session.periods).toEqual({ sc: 0, vsc: 1, red: 0 });
  });

  // A retirement is car-status's `retired` span (C13, C20), never a race event (Task 21).
  it('the retirement shows in car 2: a retired car-status span and the retired result status', async () => {
    const { state } = await run('race-zandvoort-vsc.pwrec.gz');
    expect(retired(state)).toEqual([2]);
    expect(state.signals.cars[2]!.resultStatus).toBe('retired');
  });
});

describe('race-zandvoort-retire: car 1 (the player) retires with terminal damage', () => {
  it('records the retirement of car 1: its retired car-status span', async () => {
    const { state } = await run('race-zandvoort-retire.pwrec.gz');
    expect(retired(state)).toEqual([1]);
  });
});

describe('race-singapore-wet-flashback: two flashbacks on lap 7', () => {
  it('rewinds on the frame id drop and on the FLBK event, then continues from the target', async () => {
    const flashbacks: Array<{ frameId: number; info: FlashbackInfo; truncated: boolean }> = [];
    const after: Array<{ frameId: number; sessionTime: number }> = [];
    await run('race-singapore-wet-flashback.pwrec.gz', (r) => {
      if (flashbacks.length === 2 && after.length < 1) after.push({ frameId: r.state.lastFrameId, sessionTime: r.state.sessionTime });
      if (r.flashback) flashbacks.push({ frameId: r.state.lastFrameId, info: r.flashback, truncated: r.delta.rewound !== undefined });
    });
    // the first FLBK (sent at 757.045 s) lies outside the segment: the frame id falls from the end of the window to 56744
    expect(flashbacks[0]).toMatchObject({ frameId: 56_744, info: { targetFrameId: 56_743, targetLap: 7 }, truncated: true });
    expect(flashbacks[1]).toEqual({ frameId: 56_788, info: { targetFrameId: 56_743, targetSessionTime: 742_076, rewoundMs: 741, targetLap: 7 }, truncated: true });
    expect(flashbacks).toHaveLength(2);
    expect(after).toEqual([{ frameId: 56_744, sessionTime: 742_120 }]);
  });
});

describe('engine invariants on every committed segment', () => {
  it.each(SEGMENT_FILES)('%s: they hold on every frame', async (file) => {
    const checker = new InvariantChecker();
    await run(file, (r) => checker.check(r));
  });
});
