// The frame number (contract C26, glossary): the engine's count of the frames it applied in a session. A new session's
// state has applied none (0); `step` counts the frame first, so every step of frame N sees `frameNumber` N, and what a
// frame records describes its number.
import { describe, expect, it } from 'vitest';
import { initialState, step } from '../../src/index.ts';
import { ScenarioBuilder } from '../builders/index.ts';
import { initFor } from '../support/run.ts';

describe('the frame number (C26)', () => {
  it('the frame number rises by one per applied frame, from 1', () => {
    const frames = new ScenarioBuilder({ cars: 1 }).frames(4, () => {}).build();
    const st = initialState(initFor(frames));
    expect(st.frameNumber).toBe(0);
    const seen = frames.map((f) => {
      step(st, f);
      return st.frameNumber;
    });
    expect(seen).toEqual([1, 2, 3, 4]);
  });

  it('a fact recorded on a frame describes its frame number', () => {
    const b = new ScenarioBuilder({ cars: 2 }).frames(2, () => {});
    b.event({ code: 'OVTK', overtakingVehicleIdx: 1, beingOvertakenVehicleIdx: 0 }).frames(1, () => {});
    b.event({ code: 'COLL', vehicle1Idx: 0, vehicle2Idx: 1 }).frames(1, () => {});
    const frames = b.build();
    const st = initialState(initFor(frames));
    for (const f of frames) step(st, f);
    expect(st.history.events.map((e) => [e.kind, e.frame])).toEqual([['overtake', 3], ['collision', 4]]);
  });
});
