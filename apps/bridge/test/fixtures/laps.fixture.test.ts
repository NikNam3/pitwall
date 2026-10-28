import { currentLaps } from '@pitwall/domain';
import { expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { replayState } from './engine-replay.ts';

describeWithFixture('ttZandvoort', 'laps from the TT Zandvoort recording', () => {
  it('15 completed player laps confirmed with the recorded times; lap 16 unfinished; no fuel use', async () => {
    const st = await replayState('ttZandvoort');
    const mine = st.history.laps.filter((l) => l.carId === st.playerCar);
    const confirmed = new Map(mine.filter((l) => l.status === 'confirmed').map((l) => [l.lapNumber, l]));
    expect(mine.filter((l) => l.status === 'provisional')).toHaveLength(15);
    expect([...confirmed.keys()].sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect([1, 4, 9].map((n) => confirmed.get(n)!.lapTimeMs)).toEqual([71_910, 71_081, 73_253]);
    expect(confirmed.get(9)!.valid.lap).toBe(false);                                // lapValidBitFlags 0b0110
    for (const l of confirmed.values()) expect([l.fuelAtStartKg, l.fuelAtEndKg]).toMatchObject([{ value: 10 }, { value: 10 }]);
    expect(st.history.stints).toEqual([{ carId: st.playerCar, firstLap: 1, lastLap: 15, actualCompound: 'C4', visualCompound: 'soft', tyreAgeAtFitting: 0 }]);
    expect(st.history.pitStops).toEqual([]);         // starts in the pit lane (pit status 1) and leaves at 18.7 s: no observed entry
  }, 120_000);

  it('15 current laps after the full replay, all confirmed, lap numbers 1 to 15', async () => {
    const st = await replayState('ttZandvoort');
    const current = currentLaps(st.history.laps);
    expect(current).toHaveLength(15);
    expect(current.every((l) => l.carId === st.playerCar && l.status === 'confirmed')).toBe(true);
    expect(current.map((l) => l.lapNumber)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  }, 120_000);
});

describeWithFixture('raceSingapore', 'laps from the aborted Singapore race', () => {
  it('no lap completed: no laps, stints or pit stops', async () => {
    const st = await replayState('raceSingapore');
    expect([st.history.laps, st.history.stints, st.history.pitStops]).toEqual([[], [], []]);
  }, 120_000);
});
