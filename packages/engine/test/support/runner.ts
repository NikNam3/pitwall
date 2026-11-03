// Shared by the SessionRunner tests: a 2-car scenario on a 4000 m track in which car 0 drives laps, and the
// helpers that run it, flash it back and count the flashbacks.
import type { EventDetails } from '@pitwall/protocol';
import type { DeepReadonly, EngineState, Frame, SessionRunner, StepResult } from '../../src/index.ts';
import { ScenarioBuilder, type FrameDraft } from '../builders/index.ts';

/** Session time per frame, in ms. */
export const STEP = 16;

/** Applies every frame and returns the result of each frame the runner applied, in order. */
export const runAll = (r: SessionRunner, frames: Frame[]): StepResult[] => {
  const results: StepResult[] = [];
  for (const f of frames) r.apply(f, (result) => results.push(result));
  return results;
};

/** Applies one frame that the runner applies at once (it is past its identity wait) and returns its result. */
export const applyOne = (r: SessionRunner, frame: Frame): StepResult => {
  const results = runAll(r, [frame]);
  if (results.length !== 1) throw new Error(`applyOne: the runner applied ${results.length} frames, not 1`);
  return results[0]!;
};

/** How many steps rewound: reported a flashback or set `delta.rewound`. */
export const flashbacks = (results: StepResult[]) => results.filter((r) => r.flashback !== undefined || r.delta.rewound !== undefined).length;

/**
 * What a run shows: the state without the log and without the open trackers' positions in it (the projection's
 * bookkeeping, the situation tracker's noted lengths and phase index). A flashback appends a void fact and keeps the
 * undone facts (C27), so after one the log, and positions in it, differ from a run that never had the undone frames;
 * everything readers see (the projection, the live state) equals it. The recorders' own state (`open.recorders`) holds
 * no log position (a recorder reads no log, C10), so it is shown whole.
 */
export const shown = (state: DeepReadonly<EngineState>) => {
  const { log: _log, open, ...rest } = state;
  const { projection: _projection, phaseBook, ...trackers } = open;
  const { formationFrom: _formationFrom, startFrom: _startFrom, lightsOut, ...book } = phaseBook;
  return { ...rest, open: { ...trackers, phaseBook: { ...book, lightsOutFrameId: lightsOut?.frameId } } };
};

/** The fact types of the log; with the span list of each sub-machine (`spans:<machine>`) they are its fact lists. */
const FACT_TYPES = ['laps', 'stints', 'pitStops', 'crossings', 'events', 'clock'] as const;

/** The facts of every fact list of the log by list name (`spans:<machine>` for a span list); no void facts, no legacy list. */
export const factLists = (log: DeepReadonly<EngineState['log']>): Record<string, readonly unknown[]> => ({
  ...Object.fromEntries(FACT_TYPES.map((list) => [list, log[list]])),
  ...Object.fromEntries(Object.entries(log.spans).map(([machine, spans]) => [`spans:${machine}`, spans])),
});

/** The length of every fact list of the log (see `factLists`). */
export const factLengths = (log: DeepReadonly<EngineState['log']>): Record<string, number> =>
  Object.fromEntries(Object.entries(factLists(log)).map(([list, facts]) => [list, facts.length]));

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
