import { describe, expect, it } from 'vitest';
import { longRace } from './long-race.ts';

const race = longRace();

describe('longRace (C31.1)', () => {
  it('runs 20 cars over 70 laps: every lap of the leader has its frames, in order, the last ending on the last frame', () => {
    expect([race.cars, race.laps]).toEqual([20, 70]);
    const laps = Array.from({ length: 70 }, (_, i) => race.framesOfLap(i + 1));
    for (const frames of laps) expect(frames.length).toBeGreaterThan(15);
    expect(laps.flat()).toEqual(Array.from({ length: race.lastFrame - 1 }, (_, i) => i + 1));
  });

  it("a frame's view holds what the frame before held and the frame's own facts, each describing a frame by then; its delta says so", () => {
    for (const frame of [...race.framesOfLap(7), ...race.framesOfLap(31)]) {
      const before = race.viewAt(frame - 1).history;
      const { history, delta } = race.viewAt(frame);
      for (const list of ['laps', 'crossings', 'stints', 'pitStops', 'events'] as const) {
        expect(history[list].slice(0, before[list].length)).toEqual(before[list]);
        expect(history[list].every((fact) => fact.frame <= frame)).toBe(true);
        expect([delta.before[list], delta.after[list]]).toEqual([before[list].length, history[list].length]);
      }
    }
  });

  it('records each lap provisional, then confirmed naming the provisional (C25)', () => {
    const { laps } = race.viewAt(race.lastFrame).history;
    const confirmed = laps.filter((l) => l.status === 'confirmed');
    expect(confirmed.length).toBeGreaterThan(20 * 60);
    for (const l of confirmed) {
      const provisional = laps[l.supersedes!.index]!;
      expect([provisional.status, provisional.carId, provisional.lapNumber, provisional.frame]).toEqual(['provisional', l.carId, l.lapNumber, l.frame]);
    }
  });

  it('stops every car once, from lap 15 to 34, and neutralises the race once, from the leader’s lap 30', () => {
    const { history } = race.viewAt(race.lastFrame);
    expect(history.pitStops.map((p) => [p.carId, p.lap]).sort((a, b) => a[0]! - b[0]!)).toEqual(Array.from({ length: 20 }, (_, i) => [i, 15 + i]));
    expect(history.stints.map((s) => s.carId).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    const neutralised = (history.spans['session-phase-race'] ?? []).filter((s) => s.kind === 'neutralised');
    expect(neutralised).toHaveLength(1);
    expect(race.framesOfLap(30)).toContain(neutralised[0]!.startFrame);
  });

  it("every sub-machine's spans of a scope are contiguous: each opens on the frame the one before closed on", () => {
    const frame = race.lastFrame;
    const { history, situation } = race.viewAt(frame);
    const all = [...Object.values(history.spans).flat(), ...Object.values(situation.byMachine).flat()];
    const scopes = new Map<string, Array<{ startFrame: number; endFrame?: number }>>();
    for (const s of all) {
      const key = `${s.machine}:${s.carId ?? ''}:${s.zone ?? ''}`;
      (scopes.get(key) ?? scopes.set(key, []).get(key)!).push(s);
    }
    for (const [key, spans] of scopes) {
      const sorted = [...spans].sort((a, b) => a.startFrame - b.startFrame || (a.endFrame ?? Infinity) - (b.endFrame ?? Infinity));
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.startFrame, key).toBe(sorted[i - 1]!.endFrame);
      expect(sorted.at(-1)!.endFrame, `${key} ends open`).toBeUndefined();
    }
  });
});
