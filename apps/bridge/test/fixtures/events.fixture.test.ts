import { expect, it } from 'vitest';
import { describeWithFixture } from '../../../../test-support/fixtures.ts';
import { replayState } from './engine-replay.ts';

describeWithFixture('raceSingapore', 'race events from the Singapore race', () => {
  it('STLG x5, LGOT x1, OVTK x39, COLL x4, PENA x6', async () => {
    const { history } = await replayState('raceSingapore');
    const count = (k: string) => history.events.filter((e) => e.kind === k).length;
    expect({ startLights: count('startLights'), lightsOut: count('lightsOut'), overtake: count('overtake'), collision: count('collision'), penalty: count('penalty') })
      .toEqual({ startLights: 5, lightsOut: 1, overtake: 39, collision: 4, penalty: 6 });
    expect(history.events.filter((e) => e.kind === 'startLights').map((e) => [e.at, e.params['lights']])).toEqual([[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]);
  }, 120_000);
});

describeWithFixture('ttZandvoort', 'events and mini-sectors from the TT recording', () => {
  it('FTLP x4 with the recorded lap times', async () => {
    const st = await replayState('ttZandvoort');
    expect(st.history.events.filter((e) => e.kind === 'fastestLap').map((e) => [e.carId, e.params['lapTimeMs']]))
      .toEqual([[0, 71_910], [0, 71_540], [0, 71_081], [0, 71_046]]);
  }, 120_000);
  it('50 ordered crossings per lap; line-to-line time matches the lap time', async () => {
    const st = await replayState('ttZandvoort');
    const mine = st.history.miniSectors.filter((m) => m.carId === st.playerCar);
    const lap6 = mine.filter((m) => m.lap === 6);
    expect(lap6.map((m) => m.segment)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect(lap6.every((m, i) => i === 0 || m.at >= lap6[i - 1]!.at)).toBe(true);
    const line = (lap: number) => mine.find((m) => m.lap === lap && m.segment === 0)!.at;
    expect(Math.abs(line(7) - line(6) - 71_254)).toBeLessThanOrEqual(10);                          // lap 6 = 71.254 s
    expect(line(5)).toBeGreaterThanOrEqual(370_600); expect(line(5)).toBeLessThanOrEqual(370_662);  // lap counter flips at 370.661 s
  }, 120_000);
});
