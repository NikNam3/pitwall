// `asOfEnded(view, { laps })` (SP4.3d2 Task 10, plan call 1; C62d): the planning base is the ended run's view, as of its end:
// `asOfNow(view)` with the situation at the session's end (`situationAtEnd`, over the projection, C26, C28), the ended
// run's live values, and `fixed.totalLaps` the race laps the engineer entered, not the session's.
import { describe, expect, it } from 'vitest';
import { asOfEnded, asOfNow, situationAtEnd, type EngineState } from '../../src/index.ts';
import type { Projection } from '../../src/log/types.ts';
import { situationOf } from '../../src/situations/run.ts';
import type { Situation } from '../../src/situations/situation.ts';
import { gridStart, run, script } from '../situations/script.ts';
import { viewOf } from '../support/scheduler.ts';

/** A run of 30 frames, ended (`finish`), with the live situation just before it ended. */
const ended = () => {
  const { runner } = run(script(gridStart(30)));
  const live = structuredClone(situationOf(runner.state as EngineState));
  const closing = runner.finish();
  return { live, view: viewOf(closing) };
};

/** Per machine its open spans' identity, machines without one left out (as as-of.test.ts compares situations). */
const identity = (byMachine: Situation['byMachine']) =>
  Object.fromEntries(
    Object.entries(byMachine)
      .filter(([, spans]) => spans.length > 0)
      .map(([m, spans]) => [m, [...spans].sort((a, b) => (a.carId ?? -1) - (b.carId ?? -1) || (a.zone ?? -1) - (b.zone ?? -1) || a.id - b.id).map((s) => [s.id, s.carId, s.zone, s.kind, s.startFrame])]),
  );

describe('asOfEnded (Task 10, plan call 1)', () => {
  it('asOfEnded: the situation at the session\'s end, fixed.totalLaps the entered laps', () => {
    const { live, view } = ended();
    // the ended run's own situation is empty: `finish` closed every span (C18)
    expect(identity(view.situation.byMachine)).toEqual({});
    const v = asOfEnded(view, { laps: 44 });

    // the situation at the end: the spans that were open at the last applied frame, presented open
    expect(Object.keys(identity(live.byMachine))).toContain('car-status');
    expect(identity(v.situation.byMachine)).toEqual(identity(live.byMachine));
    for (const [machine, spans] of Object.entries(live.byMachine))
      for (const s of spans) expect(v.situation.byMachine[machine], machine).toContainEqual(s);
    expect(v.situation.weekendPhase).toEqual(view.situation.weekendPhase);
    // the exported `situationAtEnd` is what it uses (one rule, C26)
    expect(v.situation.byMachine).toEqual(situationAtEnd(view.history as Projection));

    // the entered race laps, not the session's
    expect(v.fixed.totalLaps).toMatchObject({ known: true, value: 44 });
    expect(view.live.session.totalLaps).not.toBe(44);
  });

  it('asOfEnded is asOfNow otherwise: the projection, frame now, the ended run\'s live values', () => {
    const { view } = ended();
    const now = asOfNow(view);
    const v = asOfEnded(view, { laps: 44 });
    expect(v.frame).toBe('now');
    expect(v.history).toBe(view.history);
    expect(v.at).toBe(view.live.sessionTime);
    expect([v.config, v.priors, v.drivers, v.track, v.basis]).toEqual([view.config, view.priors, view.drivers, view.track, view.basis]);
    expect(v.fixed.playerCar).toEqual(now.fixed.playerCar);
    expect(v.fixed.teammateCar).toEqual(now.fixed.teammateCar);
    expect(v.fixed.carKeys).toEqual(now.fixed.carKeys);
    expect(v.fixed.setsNow).toEqual(now.fixed.setsNow);
    expect(v.fixed.weatherNow).toEqual(now.fixed.weatherNow);
    expect(v.fixed.totalLaps).toMatchObject({ known: true, value: 44 });
  });
});
