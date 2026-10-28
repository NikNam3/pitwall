// Shared by the SessionRunner tests: a 2-car scenario on a 4000 m track in which car 0 drives laps, and the
// helpers that run it, flash it back and count the flashbacks.
import type { EventDetails } from '@pitwall/protocol';
import type { Frame, SessionRunner, StepResult } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';

/** Session time per frame, in ms. */
export const STEP = 16;

export const runAll = (r: SessionRunner, frames: Frame[]): StepResult[] => frames.map((f) => r.apply(f));

/** How many steps rewound: reported a flashback or truncated the history. */
export const flashbacks = (results: StepResult[]) => results.filter((r) => r.flashback !== undefined || r.delta.truncated).length;

/** An FLBK event back to `frameId` (at its session time). */
export const flbk = (frameId: number): EventDetails => ({ code: 'FLBK', flashbackFrameIdentifier: frameId, flashbackSessionTime: (frameId * STEP) / 1000 });

/** Car 0 drives 40 m per frame on a 4000 m track; a new lap begins at each frame index in `lapStarts`. */
export const drive = (lapStarts: number[]) => (d: FrameDraft) => {
  const starts = [0, ...lapStarts.filter((x) => x <= d.index)], start = starts.at(-1)!;
  Object.assign(d.lapData.lapData[0]!, { currentLapNum: starts.length, lapDistance: (d.index - start) * 40 + 10, totalDistance: d.index * 40 + 10,
    lastLapTimeInMs: starts.length === 1 ? 0 : (start - starts.at(-2)!) * STEP });
};

/** `frames` frames of `drive(lapStarts)`, each with the events `extra` names for its index. */
export const timeline = (frames: number, lapStarts: number[], extra: (index: number) => EventDetails[] = () => []) => {
  const b = new ScenarioBuilder({ cars: 2, stepMs: STEP }).session({ trackLength: 4000 });
  for (let i = 0; i < frames; i++) {
    for (const details of extra(i)) b.event(details);
    b.frame(drive(lapStarts));
  }
  return b.build();
};

/** What the game sends after a flashback: the forked frames from `first` on, with overallFrameId still rising. */
export const after = (fork: Frame[], first: number, nextOverall: number): Frame[] =>
  fork.slice(first).map((f, k) => ({ ...f, overallFrameId: nextOverall + k }));
