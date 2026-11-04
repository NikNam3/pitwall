import { describe, expect, it } from 'vitest';
import { carState, crossings, engineView, event, field, history, lap, LAP_GAIN, neutralisation, openNeutralisation, phaseSpans, realismHidden } from './index.ts';
import { defineConfig } from '../../packages/engine/src/index.ts';
import { carId, known, unknown } from '../../packages/domain/src/index.ts';

describe('builders', () => {
  it('field gives each car laps × 50 crossings in time order', () => {
    const { laps, crossings: miniSectors } = field({ cars: 2, laps: 3, paceMs: 90_000 });
    expect(laps).toHaveLength(6);
    expect(miniSectors).toHaveLength(2 * (3 * 50 + 1));
    expect(miniSectors.filter((m) => m.carId === 0 && m.lap === 4)).toEqual([{ carId: 0, lap: 4, segment: 0, at: 270_000, frame: 0 }]);
    const times = miniSectors.map((m) => m.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('field with 3 cars at 90/91/92 s gives car 1 a 1 s gap per lap', () => {
    const { laps } = field({ cars: 3, laps: 4, paceMs: [90_000, 91_000, 92_000] });
    const end = (car: number, n: number) => laps.find((l) => l.carId === car && l.lapNumber === n)!.completedAt;
    for (let n = 1; n <= 4; n++) expect(end(1, n) - end(0, n)).toBe(n * 1000);
    expect(laps.find((l) => l.carId === 2 && l.lapNumber === 1)!.positionAtEnd).toBe(3);
  });

  it('engineView config falls back to the declared defaults', () => {
    const section = defineConfig('demo', { warnAt: 70, mode: 'a' });
    expect(section.read(engineView())).toEqual({ warnAt: 70, mode: 'a' });
    expect(section.read(engineView({ config: { demo: { warnAt: 50 } } }))).toEqual({ warnAt: 50, mode: 'a' });
  });

  it('lap defaults are a complete confirmed lap and are overridable', () => {
    const l = lap({ lapNumber: 3, lapTimeMs: 80_000 });
    expect(l).toMatchObject({ carId: 0, status: 'confirmed', completedAt: 240_000, actualCompound: 'C3', visualCompound: 'soft' });
    expect(l.ersStoreAtEndJ).toEqual({ known: true, value: 4_000_000, at: 240_000 });
    // the lap-start samples equal the lap-end ones: the lap's own wear and ERS change are 0
    expect(l.ersStoreAtStartJ).toEqual({ known: true, value: 4_000_000, at: 240_000 });
    expect(l.wearAtStartPct).toEqual(l.wearAtEndPct);
    expect(lap({ wearAtEndPct: { fl: { known: false, reason: 'notReceived' }, fr: l.wearAtEndPct.fr, rl: l.wearAtEndPct.rl, rr: l.wearAtEndPct.rr } }).wearAtEndPct.fl.known).toBe(false);
  });

  describe('lap: an end sample set without its start sample', () => {
    const corners = <T>(v: T) => ({ fl: v, fr: v, rl: v, rr: v });
    const valueOf = (k: { known: boolean; value?: number }) => (k.known ? k.value : undefined);

    it('gets a start one default lap gain before it, as of the end: a cumulative end value is never one lap`s gain', () => {
      const l = lap({ lapNumber: 12, fuelAtEndKg: known(50, 7), wearAtEndPct: corners(known(30, 7)), ersStoreAtEndJ: known(2_500_000, 7) });
      expect(l.fuelAtStartKg).toEqual(known(52, 7));
      expect(l.wearAtStartPct).toEqual(corners(known(30, 7)));
      expect(l.ersStoreAtStartJ).toEqual(known(2_500_000, 7));
    });

    it('the default gain is LAP_GAIN, the same as a default lap`s own', () => {
      const d = lap();
      expect(LAP_GAIN).toEqual({ fuelKg: -2, wearPct: 0, ersStoreJ: 0 });
      expect(valueOf(d.fuelAtEndKg)! - valueOf(d.fuelAtStartKg)!).toBe(LAP_GAIN.fuelKg);
      expect(valueOf(d.wearAtEndPct.fl)! - valueOf(d.wearAtStartPct.fl)!).toBe(LAP_GAIN.wearPct);
      expect(valueOf(d.ersStoreAtEndJ)! - valueOf(d.ersStoreAtStartJ)!).toBe(LAP_GAIN.ersStoreJ);
    });

    it('follows per corner for wear; an unknown end gives the same unknown start', () => {
      const wear = { fl: known(40, 3), fr: unknown('notReceived'), rl: known(20, 3), rr: unknown('restricted') };
      expect(lap({ wearAtEndPct: wear }).wearAtStartPct).toEqual(wear);
      expect(lap({ fuelAtEndKg: unknown('notReceived') }).fuelAtStartKg).toEqual(unknown('notReceived'));
      expect(lap({ ersStoreAtEndJ: unknown('realism') }).ersStoreAtStartJ).toEqual(unknown('realism'));
    });

    it('a start sample the caller sets wins, known or not', () => {
      const l = lap({ fuelAtStartKg: known(100, 1), fuelAtEndKg: known(50, 2), ersStoreAtStartJ: unknown('notReceived'), ersStoreAtEndJ: known(1_000_000, 2) });
      expect(l.fuelAtStartKg).toEqual(known(100, 1));
      expect(l.ersStoreAtStartJ).toEqual(unknown('notReceived'));
    });

    it('a start set without an end leaves the end at its default', () => {
      expect(lap({ fuelAtStartKg: known(60, 90_000) }).fuelAtEndKg).toEqual(known(98, 90_000));
    });
  });

  it('crossings are 50 evenly spaced segments, segment 0 at the lap start', () => {
    const c = crossings(carId(1), 2, 90_000, 10_000);
    expect(c).toHaveLength(50);
    expect(c[0]).toMatchObject({ segment: 0, at: 10_000 });
    expect(c[1]!.at).toBe(11_800);
    expect(c[49]!.at).toBe(98_200);
  });

  it('event fills defaults', () => {
    expect(event({ kind: 'overtake', at: 5 })).toEqual({ at: 5, kind: 'overtake', params: {}, frame: 0 });
  });

  it('neutralisation is a closed session-phase-race span: neutralised for SC and VSC, suspended for red, frames = times by default', () => {
    expect(neutralisation({ kind: 'VSC' })).toEqual({
      machine: 'session-phase-race', id: 0, kind: 'neutralised', start: 0, end: 60_000, confirmed: true, startFrame: 0, endFrame: 60_000,
      detail: { car: 'VSC', stages: [{ stage: 'deployed', at: 0 }] },
    });
    expect(neutralisation({ kind: 'red', start: 5, end: 9, confirmed: false })).toMatchObject({ kind: 'suspended', start: 5, end: 9, confirmed: false, startFrame: 5, endFrame: 9 });
    expect(openNeutralisation({ start: 7 })).toEqual({
      machine: 'session-phase-race', id: 0, kind: 'neutralised', start: 7, confirmed: true, startFrame: 7, detail: { car: 'SC', stages: [{ stage: 'deployed', at: 7 }] },
    });
  });

  it('phaseSpans puts the closed spans in the projection and the open one in the situation, by machine (C20)', () => {
    const sc = neutralisation();
    const open = openNeutralisation({ kind: 'VSC', start: 90_000, id: 1 });
    const { spans, situation } = phaseSpans([sc], open);
    expect(spans).toEqual({ 'session-phase-race': [sc] });
    expect(situation).toEqual({ weekendPhase: { kind: 'race', format: 'grandPrix' }, byMachine: { 'session-phase-race': [open] } });
    const view = engineView({ history: { spans }, situation });
    expect([view.history.spans['session-phase-race'], view.situation.byMachine['session-phase-race']]).toEqual([[sc], [open]]);
  });

  it('carState is complete, merges deeply and can be hidden for realism', () => {
    const c = carState({ id: carId(3), tyres: { corners: { fl: { wearPct: { known: true, value: 40, at: 0 } } } } });
    expect(c.tyres.corners.fl.wearPct).toMatchObject({ value: 40 });
    expect(c.tyres.corners.fl.surfaceTempC.known).toBe(true);
    expect(c.dynamics.known).toBe(true);
    expect(c.timing.position).toBe(4);
    const hidden = realismHidden(c);
    expect(hidden.tyres.corners.fr.wearPct).toEqual({ known: false, reason: 'realism' });
    expect(hidden.timing.position).toBe(4);
  });

  it('engineView places cars by id, carries history, delta and outputs', () => {
    const laps = field({ cars: 1, laps: 2, paceMs: 90_000 });
    const view = engineView({ cars: [carState({ id: carId(5) })], history: history(laps), outputs: new Map([['x', 1]]) });
    // Task 24: `car.active` left the live state; the placed car is the builder's, the other slots idle
    expect([view.live.cars[5]!.identity.name, view.live.cars[0]!.identity.name]).toEqual(['Car 5', '']);
    expect(view.history.laps).toHaveLength(2);
    expect(view.delta.after.crossings).toBe(101);
    expect(view.delta.rewound).toBeUndefined();
    expect(view.outputs.get('x')).toBe(1);
    expect(view.feed.connected).toBe(true);
  });

  it('field laps progress: fuel, tyre age, wear, order by cumulative time', () => {
    const { laps } = field({ cars: 2, laps: 3, paceMs: [90_000, 91_001] });
    const l3 = laps.find((l) => l.carId === 1 && l.lapNumber === 3)!;
    expect(l3.fuelAtStartKg).toMatchObject({ value: 96 });
    expect(l3.fuelAtEndKg).toMatchObject({ value: 94 });
    expect(l3.tyreAgeAtStart).toBe(2);
    expect(l3.wearAtStartPct.fl).toMatchObject({ value: 2 });
    expect(l3.wearAtEndPct.fl).toMatchObject({ value: 3 });
    expect(l3.ersStoreAtStartJ).toMatchObject({ value: 4_000_000 });
    expect(l3.positionAtEnd).toBe(2);
    expect(l3.sectorTimesMs.reduce((a, b) => a + b, 0)).toBe(91_001);
  });

  it('lap derives its sectors from lapTimeMs and sums exactly', () => {
    expect(lap().sectorTimesMs).toEqual([30_000, 30_000, 30_000]);
    expect(lap({ lapTimeMs: 80_001 }).sectorTimesMs.reduce((a, b) => a + b, 0)).toBe(80_001);
    expect(lap({ sectorTimesMs: [1, 2, 3] }).sectorTimesMs).toEqual([1, 2, 3]);
  });

  it('field throws when paceMs is shorter than cars', () => {
    expect(() => field({ cars: 3, laps: 1, paceMs: [90_000] })).toThrow();
  });
});
