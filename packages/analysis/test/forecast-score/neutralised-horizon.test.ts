// `forecast-score`'s forecast repair F1 (SP4.3b spec 4.2; SP4.3b1 plan Task 9; C26, C45, C47): a forecast case of
// horizon h at leader lap L is left out when any of laps L+1…L+h of the scored car has `scShare + vscShare > 0` (from
// the projection's lap records). The natural experiments are unchanged (the SC-stop experiment still uses neutralised
// stops), and after a flashback the report equals a run without the undone frames (C33).
import { currentLaps, type LapRecord } from '@pitwall/domain';
import { createRng, type Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { naturalExperiments } from '../../src/forecast-score/experiments.ts';
import { forecastCases, type ForecastCase, type Horizon } from '../../src/forecast-score/forecasts.ts';
import { prepareScore, run } from '../../src/forecast-score/job.ts';
import { CONFIG, generated, inputAt, plannedRace, SMALL, spacedField, viewOf } from './support.ts';

const HORIZONS: readonly Horizon[] = [1, 3, 5, 10];

/** Four cars 1 s apart over 20 green laps, car 0 stopping on lap 12. */
const greenRace = () => plannedRace({ laps: 20, cars: spacedField(4, 1_000, { 0: { stops: [{ lap: 12 }] } }) });

/** `p` with car `car`'s lap-`n` records (provisional and confirmed) given `share`. */
function withShare(p: Projection, car: number, n: number, share: Partial<Pick<LapRecord, 'scShare' | 'vscShare'>>): Projection {
  return { ...p, laps: p.laps.map((l) => (l.carId === car && l.lapNumber === n ? { ...l, ...share } : l)) } as Projection;
}

/** Whether a case's horizon (its car's laps L+1 … L+h) holds lap `n`. */
const holds = (c: ForecastCase, n: number) => c.lap + 1 <= n && n <= c.lap + c.horizon;

const key = (c: ForecastCase) => `${c.carId}:${c.lap}:${c.horizon}`;

describe('forecast-score F1: no neutralised lap in a forecast horizon', () => {
  it('a case whose horizon holds an SC lap is left out; the same case without it counts', () => {
    const green = greenRace().history;
    // Car 1's lap 8 runs 40 % under the safety car; nothing else changes.
    const sc = withShare(green, 1, 8, { scShare: 0.4 });
    const all = forecastCases(green, HORIZONS);
    const kept = forecastCases(sc, HORIZONS);
    const left = all.filter((c) => c.carId === 1 && holds(c, 8));
    // h1 from lap 7, h3 from laps 5–7, h5 from laps 3–7, h10 from laps 3–7 (ported in Task 11e: no case from leader
    // laps 1 and 2, minPredictLap 3).
    expect(left.map((c) => [c.lap, c.horizon]).sort((a, b) => a[1]! - b[1]! || a[0]! - b[0]!)).toEqual([
      [7, 1], [5, 3], [6, 3], [7, 3], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [3, 10], [4, 10], [5, 10], [6, 10], [7, 10],
    ]);
    // Without the SC lap every one of them counts; with it, none does, and every other case still counts.
    expect(kept.map(key).sort()).toEqual(all.filter((c) => !left.includes(c)).map(key).sort());
    // The SC lap as the start lap L is no horizon lap: car 1's cases from lap 8 count, and so do the other cars' cases.
    expect(kept.filter((c) => c.carId === 1 && c.lap === 8).map((c) => c.horizon)).toEqual([1, 3, 5, 10]);
    expect(kept.filter((c) => c.carId !== 1)).toHaveLength(all.filter((c) => c.carId !== 1).length);

    // The job's tables on a generator race with a safety car on laps 9 and 10: no scored forecast case's horizon holds
    // a lap of its car with an SC or VSC share, and the race has green cases.
    const race = generated({ ...SMALL, sc: { fromLap: 9, toLap: 10 } });
    const input = inputAt(race);
    const neutral = new Set(
      currentLaps(input.history.laps as readonly LapRecord[])
        .filter((l) => l.status === 'confirmed' && l.scShare + l.vscShare > 0)
        .map((l) => `${l.carId}:${l.lapNumber}`),
    );
    expect(neutral.size).toBeGreaterThan(0);
    const report = run(input, createRng(0));
    let scoredCases = 0;
    for (const f of report.forecasts) {
      for (const c of f.position.cases) {
        scoredCases += 1;
        for (let n = c.lap + 1; n <= c.lap + f.horizon; n++) expect(neutral.has(`${c.carId}:${n}`), `h${f.horizon} car ${c.carId} lap ${c.lap}: lap ${n}`).toBe(false);
      }
    }
    expect(scoredCases).toBeGreaterThan(0);
  });

  it('a VSC lap counts like an SC lap', () => {
    const green = greenRace().history;
    const sc = forecastCases(withShare(green, 2, 10, { scShare: 0.25 }), HORIZONS);
    const vsc = forecastCases(withShare(green, 2, 10, { vscShare: 0.25 }), HORIZONS);
    expect(vsc.map(key).sort()).toEqual(sc.map(key).sort());
    // Both leave out car 2's cases whose horizon holds lap 10, and only those.
    const all = forecastCases(green, HORIZONS);
    expect(vsc.filter((c) => c.carId === 2 && holds(c, 10))).toEqual([]);
    expect(vsc).toHaveLength(all.filter((c) => !(c.carId === 2 && holds(c, 10))).length);
  });

  it('experiments are unchanged by F1', () => {
    // The SC-stop race of the experiments' tests: eight cars 1.1 s apart, an SC from 820 s to 1,050 s, car 3 stopping
    // under it on lap 10 and car 6 on lap 11. Its laps under the SC hold an SC share.
    const race = plannedRace({
      laps: 16,
      cars: spacedField(8, 1_100, { 3: { stops: [{ lap: 10 }] }, 6: { stops: [{ lap: 11 }] } }),
      neutralisation: { fromMs: 820_000, toMs: 1_050_000 },
    });
    expect(race.lapOf(3, 10).scShare).toBeGreaterThan(0);
    const { rejoin, undercut, scStop } = naturalExperiments(race.history, CONFIG);
    // The SC-stop experiment still uses the neutralised stops: 9 cases, car 3's predicted at its lap-9 record.
    expect(scStop).toHaveLength(9);
    expect(scStop.filter((c) => c.carId === 3).map((c) => c.otherCarId)).toEqual([0, 1, 2, 4, 5]);
    expect(scStop.find((c) => c.carId === 3)).toMatchObject({ predictFrame: race.lapOf(3, 9).frame });
    // Rejoin and undercut take green stops only, as before F1: both stops here are under the SC.
    expect(rejoin).toEqual([]);
    expect(undercut).toEqual([]);
    // A green stop outside any neutralisation still gives its rejoin case, whose horizon holds no SC lap.
    const greenStop = naturalExperiments(greenRace().history, CONFIG).rejoin;
    expect(greenStop.map((c) => c.carId)).toEqual([0]);

    // The job scores the SC-stop cases of a generator race with a safety car: as many as the experiment gives.
    const sc = generated({ ...SMALL, sc: { fromLap: 9, toLap: 10 } });
    const input = inputAt(sc);
    const report = run(input, createRng(0));
    const cases = naturalExperiments(input.history, CONFIG, input.situation).scStop;
    expect(cases.length).toBeGreaterThan(0);
    expect(report.experiments.scStop.cases.length).toBeGreaterThan(0);
    expect(report.experiments.scStop.cases.length).toBeLessThanOrEqual(cases.length);
  });

  it('rewind: output equals a run without the undone frames (C33)', () => {
    // A safety car on laps 9 and 10; a flashback from the leader's lap 16 to its lap 13.
    const race = generated({ ...SMALL, sc: { fromLap: 9, toLap: 10 } });
    const target = race.framesOfLap(13)[0]!;
    const undone = race.framesOfLap(16)[0]!;
    const rewound = { ...viewOf(race, target), delta: race.viewAt(target, { from: undone }).delta };
    expect(rewound.delta.rewound).toBeDefined();
    const never = run(inputAt(race, target), createRng(0));
    expect(run(structuredClone(prepareScore(rewound)), createRng(0))).toEqual(never);
    // The run before the flashback scored more cases than the one after it.
    const before = run(inputAt(race, undone), createRng(0));
    const count = (r: typeof never) => r.forecasts.reduce((n, f) => n + f.position.cases.length, 0);
    expect(count(before)).toBeGreaterThan(count(never));
  });
});
