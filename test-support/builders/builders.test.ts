import { describe, expect, it } from 'vitest';
import { carState, crossings, engineView, event, field, flagPhase, history, lap, realismHidden } from './index.ts';
import { defineConfig } from '../../packages/engine/src/index.ts';
import { carId } from '../../packages/domain/src/index.ts';

describe('builders', () => {
  it('field gives each car laps × 50 crossings in time order', () => {
    const { laps, miniSectors } = field({ cars: 2, laps: 3, paceMs: 90_000 });
    expect(laps).toHaveLength(6);
    expect(miniSectors).toHaveLength(2 * 3 * 50);
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
    expect(lap({ wearAtEndPct: { fl: { known: false, reason: 'notReceived' }, fr: l.wearAtEndPct.fr, rl: l.wearAtEndPct.rl, rr: l.wearAtEndPct.rr } }).wearAtEndPct.fl.known).toBe(false);
  });

  it('crossings are 50 evenly spaced segments ending at the lap end', () => {
    const c = crossings(carId(1), 2, 90_000, 10_000);
    expect(c).toHaveLength(50);
    expect(c[0]).toMatchObject({ segment: 0, at: 11_800 });
    expect(c[49]!.at).toBe(100_000);
  });

  it('event and flagPhase fill defaults', () => {
    expect(event({ kind: 'overtake', at: 5 })).toEqual({ at: 5, kind: 'overtake', params: {} });
    expect(flagPhase({ kind: 'VSC' })).toMatchObject({ kind: 'VSC', start: 0, end: 60_000 });
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
    expect(view.state.cars[5]!.active).toBe(true);
    expect(view.state.cars[0]!.active).toBe(false);
    expect(view.state.history.laps).toHaveLength(2);
    expect(view.delta.after.miniSectors).toBe(100);
    expect(view.delta.truncated).toBe(false);
    expect(view.outputs.get('x')).toBe(1);
    expect(view.feed.connected).toBe(true);
  });
});
