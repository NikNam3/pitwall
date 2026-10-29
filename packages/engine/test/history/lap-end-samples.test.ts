// Lap-end samples (spec 3.3, A.1): wear, ERS and damage at the lap end, the lap's channel ranges and damageChange events.
import { describe, expect, it } from 'vitest';
import { known, unknown, type RaceEvent } from '@pitwall/domain';
import type { Frame } from '../../src/frame/frame.ts';
import { applyDamageChanges } from '../../src/history/damage-changes.ts';
import { initialState, SessionRunner, step } from '../../src/index.ts';
import { buildPacket, ScenarioBuilder, type FrameDraft } from '../builders/index.ts';
import { initFor, runScenario } from '../support/run.ts';
import { after, runAll, STEP, timeline } from '../support/runner.ts';

const car0 = (d: FrameDraft) => d.lapData.lapData[0]!;
const val = <T>(v: T) => expect.objectContaining({ known: true, value: v });
const NO = (reason: string) => expect.objectContaining({ known: false, reason });
/** Frames 0–2 are lap 1, frame 3 completes it (lap 2 begins), frame 4 is lap 2. */
const complete = (d: FrameDraft) => { if (d.index >= 3) Object.assign(car0(d), { currentLapNum: 2, lastLapTimeInMs: 90_000 }); };

describe('lap end samples', () => {
  // The protocol order is RL, RR, FL, FR.
  it('lap end samples wear per corner from the completing frame', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(5, (d) => {
      complete(d);
      if (d.index === 2) d.add('carDamage', { carDamageData: { 0: { tyresWear: [9, 9, 9, 9] } } });
      if (d.index === 3) d.add('carDamage', { carDamageData: { 0: { tyresWear: [1, 2, 3, 4] } } });
      if (d.index === 4) d.add('carDamage', { carDamageData: { 0: { tyresWear: [50, 50, 50, 50] } } });
    }));
    const [lap] = st.history.laps;
    expect(lap!.wearAtEndPct).toEqual({ rl: val(1), rr: val(2), fl: val(3), fr: val(4) });
  });

  it('ers deployed is the value before the per-lap reset', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(5, (d) => {
      complete(d);
      const s = d.status.carStatusData[0]!;
      if (d.index === 1) Object.assign(s, { ersDeployedThisLap: 1_000_000, ersHarvestedThisLapMguk: 400_000, ersHarvestedThisLapMguh: 100_000 });
      if (d.index === 2) Object.assign(s, { ersDeployedThisLap: 3_500_000, ersHarvestedThisLapMguk: 1_000_000, ersHarvestedThisLapMguh: 500_000 });
      // the game resets the per-lap counters at the line; the store is a level and carries on
      if (d.index === 3) Object.assign(s, { ersStoreEnergy: 2_000_000, ersDeployedThisLap: 0, ersHarvestedThisLapMguk: 0, ersHarvestedThisLapMguh: 0 });
    }));
    const [lap] = st.history.laps;
    expect([lap!.ersDeployedJ, lap!.ersHarvestedJ, lap!.ersStoreAtEndJ]).toEqual([val(3_500_000), val(1_500_000), val(2_000_000)]);
  });

  it('a rival hidden by realism has unknown(\'realism\') samples', () => {
    const frames = new ScenarioBuilder({ cars: 6 }).frames(5, (d) => {
      d.add('carDamage');
      if (d.index >= 3) Object.assign(d.lapData.lapData[3]!, { currentLapNum: 2, lastLapTimeInMs: 90_000 });
    }).build();
    const st = initialState({ ...initFor(frames), realism: true });
    for (const f of frames) step(st, f);
    const lap = st.history.laps.find((l) => l.carId === 3)!;
    const R = NO('realism');
    const corners = <T>(v: T) => ({ fl: v, fr: v, rl: v, rr: v });
    expect(lap).toMatchObject({ wearAtEndPct: corners(R), ersStoreAtEndJ: R, ersDeployedJ: R, ersHarvestedJ: R, damageAtEnd: R });
    expect(lap.channelRange).toEqual({ tyres: corners({ surfaceC: R, carcassC: R, pressurePsi: R }), brakesC: corners(R), engineC: R });
  });

  it('confirmed record keeps the provisional samples', () => {
    const history = { carIdx: 0, numLaps: 2, lapHistoryData: [
      { lapTimeInMs: 90_000, sector1TimeMs: 30_000, sector2TimeMs: 30_000, sector3TimeMs: 30_000, lapValidBitFlags: 0b1111 }, { lapValidBitFlags: 0b1111 }] };
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(5, (d) => {
      complete(d);
      if (d.index === 3) d.add('carDamage', { carDamageData: { 0: { tyresWear: [1, 2, 3, 4], frontLeftWingDamage: 7 } } });
      if (d.index === 3) Object.assign(d.status.carStatusData[0]!, { ersStoreEnergy: 2_000_000 });
      if (d.index === 2) Object.assign(d.status.carStatusData[0]!, { ersDeployedThisLap: 3_500_000 });
      if (d.index === 4) d.add('sessionHistory', history);
    }));
    const [provisional, confirmed] = st.history.laps;
    expect([provisional!.status, confirmed!.status]).toEqual(['provisional', 'confirmed']);
    expect(provisional!.wearAtEndPct.fl).toEqual(val(3));
    const samples = (l: typeof provisional) => ({ wear: l!.wearAtEndPct, store: l!.ersStoreAtEndJ, deployed: l!.ersDeployedJ, harvested: l!.ersHarvestedJ,
      damage: l!.damageAtEnd, range: l!.channelRange });
    expect(samples(confirmed)).toEqual(samples(provisional));
  });

  it('channelRange holds the min and max surface temperature of the lap\'s frames', () => {
    // Front-left surface per frame 0–4: 80, 95, 70 (lap 1), 85 (the completing frame, after the line: lap 2), 200 (lap 2).
    const surface = [80, 95, 70, 85, 200];
    const pressure = [23, 24, 22, 23, 30];
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(5, (d) => {
      complete(d);
      const t = d.telemetry.carTelemetryData[0]!;
      Object.assign(t, { tyresSurfaceTemperature: [60, 60, surface[d.index]!, 60], tyresPressure: [21, 21, pressure[d.index]!, 21],
        brakesTemperature: [400, 400, 400 + d.index * 100, 400], engineTemperature: 100 + (d.index % 2) * 10 });
    }));
    const range = st.history.laps[0]!.channelRange;
    expect(range.tyres.fl.surfaceC).toEqual(val({ min: 70, max: 95 }));
    expect(range.tyres.fl.pressurePsi).toEqual(val({ min: 22, max: 24 }));
    expect(range.tyres.rl.surfaceC).toEqual(val({ min: 60, max: 60 }));
    expect(range.brakesC.fl).toEqual(val({ min: 400, max: 600 }));
    expect(range.engineC).toEqual(val({ min: 100, max: 110 }));
  });

  it('a channel no frame of the lap had is unknown in channelRange', () => {
    // A surface-only session (tyreTemperature 0) has no carcass temperature.
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).session({ tyreTemperature: 0 }).frames(5, complete));
    expect(st.history.laps[0]!.channelRange.tyres.fl.carcassC.known).toBe(false);
  });
});

describe('damageChange events', () => {
  const wing = (pct: number) => (d: FrameDraft) => { d.add('carDamage', { carDamageData: { 0: { frontLeftWingDamage: pct } } }); };

  it('a front-left wing rise from 0 to 12 % appends one damageChange event; a repair appends none', () => {
    const plan = [0, 12, 12, 0, 0];
    const { st, frames, results } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(plan.length, (d) => wing(plan[d.index]!)(d)));
    expect(st.history.events).toEqual([{ at: frames[1]!.sessionTime, kind: 'damageChange', carId: 0,
      params: { part: 'frontLeftWingPct', fromPct: 0, toPct: 12 } }]);
    expect(results.map((r) => r.changed.has('events'))).toEqual([false, true, false, false, false]);
  });

  it('every rising part is one event of its own, named as in DamageParts', () => {
    const { st } = runScenario(new ScenarioBuilder({ cars: 1 }).frames(2, (d) => {
      d.add('carDamage', { carDamageData: { 0: d.index === 0 ? {} : { gearBoxDamage: 5, engineDamage: 8 } } });
    }));
    const params = st.history.events.filter((e) => e.kind === 'damageChange').map((e) => e.params);
    expect(params).toEqual(expect.arrayContaining([{ part: 'gearboxPct', fromPct: 0, toPct: 5 }, { part: 'enginePct', fromPct: 0, toPct: 8 }]));
    expect(params).toHaveLength(2);
  });

  /** A state whose car 0 has a baseline of all parts at 0 %, and a frame at 9 s with or without Car Damage. */
  const baseline = () => runScenario(new ScenarioBuilder({ cars: 1 }).frames(1, wing(0))).st;
  const frame = (damage: boolean) => ({ sessionTime: 9000, events: [], ...(damage && { damage: buildPacket('carDamage') }) }) as unknown as Frame;
  const wingAt = (st: ReturnType<typeof baseline>, pct: number) => {
    const { bodywork } = st.cars[0]!.condition;
    if (bodywork.known) st.cars[0]!.condition.bodywork = known({ ...bodywork.value, frontLeftWingPct: pct }, 9000);
  };
  const damageEventsOf = (st: ReturnType<typeof baseline>) => st.history.events.filter((e) => e.kind === 'damageChange');

  it('a frame without Car Damage is no reading (only Car Damage changes the condition)', () => {
    const st = baseline();
    wingAt(st, 30);
    applyDamageChanges(st, frame(false));
    expect(damageEventsOf(st)).toEqual([]);
  });

  it('a reading with an unknown part is none: no event, and the baseline stays as it was', () => {
    const st = baseline();
    const { powerUnit } = st.cars[0]!.condition;
    wingAt(st, 30);
    st.cars[0]!.condition.powerUnit = unknown('restricted');
    applyDamageChanges(st, frame(true));
    expect(damageEventsOf(st)).toEqual([]);
    expect(st.open.damage[0]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    st.cars[0]!.condition.powerUnit = powerUnit;
    applyDamageChanges(st, frame(true));
    expect(damageEventsOf(st).map((e) => e.params)).toEqual([{ part: 'frontLeftWingPct', fromPct: 0, toPct: 30 }]);
  });

  it('a flashback truncates damageChange events like every other event', () => {
    const withDamage = (frames: ReturnType<typeof timeline>, at: number, pct: number) =>
      frames.map((f, i) => (i === 0 ? { ...f, damage: buildPacket('carDamage') } : i === at
        ? { ...f, damage: buildPacket('carDamage', { carDamageData: { 0: { frontLeftWingDamage: pct } } }) } : f));
    // original: wing rises to 12 at frame 250; the game goes back to frame 200; the fork has a rise to 5 at frame 300
    const original = () => withDamage(timeline(300, [100, 250]), 250, 12);
    const fork = () => withDamage(timeline(400, [100, 330]), 300, 5);
    const damageEvents = (events: readonly RaceEvent[]) => events.filter((e) => e.kind === 'damageChange').map((e) => [e.at, e.params]);
    const a = new SessionRunner(initFor(original()));
    runAll(a, original());
    expect(damageEvents(a.state.history.events)).toEqual([[250 * STEP, { part: 'frontLeftWingPct', fromPct: 0, toPct: 12 }]]);
    runAll(a, after(fork(), 201, 300));
    expect(damageEvents(a.state.history.events)).toEqual([[300 * STEP, { part: 'frontLeftWingPct', fromPct: 0, toPct: 5 }]]);
  });
});
