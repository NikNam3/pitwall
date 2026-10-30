// Lap-start samples (contract 65ef05c): wear per corner and the ERS store, read from the car state of the frame that
// starts the lap, as the lap-end samples come from the frame that completes it (lap-end-samples.test.ts).
import { describe, expect, it } from 'vitest';
import { initialState, step } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { initFor, runScenario } from '../support/run.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
const val = <T>(v: T) => expect.objectContaining({ known: true, value: v });
const NO = (reason: string) => expect.objectContaining({ known: false, reason });
const corners = <T>(v: T) => ({ fl: v, fr: v, rl: v, rr: v });

/** Frame `i` has tyre wear RL/RR/FL/FR `i`, `i + 1`, `i + 2`, `i + 3` % and an ERS store of `1 MJ + i * 0.1 MJ`. */
const wearAndStore = (d: FrameDraft) => {
  const i = d.index;
  d.add('carDamage', { carDamageData: { 0: { tyresWear: [i, i + 1, i + 2, i + 3] } } });
  d.status.carStatusData[0]!.ersStoreEnergy = 1_000_000 + i * 100_000;
};
/** The samples of frame `i` as the lap record holds them (the protocol order is RL, RR, FL, FR). */
const wearOf = (i: number) => ({ rl: val(i), rr: val(i + 1), fl: val(i + 2), fr: val(i + 3) });
const storeOf = (i: number) => val(1_000_000 + i * 100_000);

/** Frames 0–2 are lap 1, frame 3 completes it (lap 2 begins), frames 4–5 are lap 2, frame 6 completes it. */
const twoLaps = (d: FrameDraft) => {
  wearAndStore(d);
  if (d.index >= 3) Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 90_000 });
  if (d.index >= 6) Object.assign(car0(d), { currentLapNum: 3, lastLapTimeInMs: 91_000 });
};

describe('lap start samples', () => {
  it('a lap that starts at a line crossing samples wear per corner and the ERS store from the frame that crosses the line', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(7, twoLaps));
    const lap = st.history.laps.find((l) => l.lapNumber === 2)!;
    expect([lap.wearAtStartPct, lap.ersStoreAtStartJ]).toEqual([wearOf(3), storeOf(3)]);
  });

  it('the first lap, seen from before the line, samples the first frame the engine sees of the car', () => {
    // lap distance 0 and the lap timer at 0: the car is on the grid, its lap has not begun
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(4, twoLaps));
    const lap = st.history.laps.find((l) => l.lapNumber === 1)!;
    expect([lap.wearAtStartPct, lap.ersStoreAtStartJ]).toEqual([wearOf(0), storeOf(0)]);
  });

  it("a lap the engine joined after its start has no start samples: unknown('notReceived')", () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(4, (d) => {
      twoLaps(d);
      if (d.index === 0) Object.assign(car0(d), { lapDistance: 1_200, currentLapTimeInMs: 20_000 });
    }));
    const lap = st.history.laps.find((l) => l.lapNumber === 1)!;
    expect([lap.wearAtStartPct, lap.ersStoreAtStartJ]).toEqual([corners(NO('notReceived')), NO('notReceived')]);
  });

  it("a rival hidden by realism has unknown('realism') start samples", () => {
    const frames = new ScenarioBuilder({ cars: 6 }).frames(5, (d) => {
      d.add('carDamage');
      if (d.index >= 3) Object.assign(d.lapData.lapData[3]!, { currentLapNum: 2, lastLapTimeInMs: 90_000 });
    }).build();
    const st = initialState({ ...initFor(frames), realism: true });
    for (const f of frames) step(st, f);
    const lap = st.history.laps.find((l) => l.carId === 3)!;
    expect([lap.wearAtStartPct, lap.ersStoreAtStartJ]).toEqual([corners(NO('realism')), NO('realism')]);
  });

  it('the confirmed record keeps the start samples of the provisional one', () => {
    const history = { carIdx: 0, numLaps: 3, lapHistoryData: [
      { lapTimeInMs: 90_000, sector1TimeMs: 30_000, sector2TimeMs: 30_000, sector3TimeMs: 30_000, lapValidBitFlags: 0b1111 },
      { lapTimeInMs: 91_000, sector1TimeMs: 30_000, sector2TimeMs: 30_000, sector3TimeMs: 31_000, lapValidBitFlags: 0b1111 },
      { lapValidBitFlags: 0b1111 }] };
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(8, (d) => {
      twoLaps(d);
      if (d.index === 7) d.add('sessionHistory', history);
    }));
    const [provisional, confirmed] = st.history.laps.filter((l) => l.lapNumber === 2);
    expect([provisional!.status, confirmed!.status]).toEqual(['provisional', 'confirmed']);
    expect([confirmed!.wearAtStartPct, confirmed!.ersStoreAtStartJ]).toEqual([wearOf(3), storeOf(3)]);
  });
});
