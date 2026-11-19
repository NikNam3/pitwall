// SP4.3f Task 3, the round's conditions (C3, C62d, C73; spec §4.1 "C62d", §4.3 "The conditions' shape", §4.4 "The plan
// board"): the round's as-of view takes the race assumptions' conditions in place of the qualifying's `nextForecast`.
// Imported (`IMPORTED`), they are the qualifying's last race samples, which the replay hands back (`imported`), and the
// round publishes them as `forecast.rows`, none overridden, with the qualifying as their source. Entered, a new replay
// plans on them (`planning.rainPct` of the job's input follows), and the rows mark the ones that differ from the imported
// ones as overridden. Without race samples the rows stay `unknown('notReceived')` and the rain chance unknown, never 0 %
// (C3, Review focus 3). `plans.race.set` validates the conditions (C73): rain 0–100, offsets rising, a known weather.
//
// Synthetic sessions in fresh temporary data dirs (C84), the planning job the capture stand-in (`round-harness.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMPORTED, unknown, type ForecastSample, type RaceConditions } from '@pitwall/domain';
import { cleanUp, newPlace, planningOf, rowsOf, samplesOf, storeQualifying, SUGGESTED } from './round-harness.ts';

afterEach(cleanUp);

/** A round of the default qualifying (its race samples [{0, 1, 12}, {30, 3, 45}]), opened with the defaults and settled. */
async function opened(o: { samples?: [] } = {}) {
  const place = newPlace();
  const qualifying = await storeQualifying(place, o);
  const p = planningOf(place);
  expect(p.open({ qualifying: qualifying.ref })).toEqual({ ok: true });
  const round = await p.settled(1);
  return { place, qualifying, p, round };
}

/** The imported samples with row 2 (+30 min) at `rainPct`. */
const row2At = (imported: ForecastSample[], rainPct: number): RaceConditions => ({ kind: 'entered', samples: [imported[0]!, { ...imported[1]!, rainPct }] });

describe('the round\'s conditions (SP4.3f Task 3; C3, C62d, C73)', { timeout: 180_000 }, () => {
  it('a qualifying with race samples [{0,1,12},{30,3,45}]: forecast.rows known, two rows not overridden, source.ref the qualifying', async () => {
    const { place, qualifying, p, round } = await opened();
    const [row] = rowsOf(place, qualifying.ref);

    expect(round.race).toEqual({ laps: SUGGESTED, sets: 'carried', conditions: IMPORTED });
    expect(round.forecast.source).toEqual({ ref: qualifying.ref, startedAt: row!.startedAt });
    expect(round.forecast.rows).toMatchObject({
      known: true,
      value: [
        { sample: expect.objectContaining({ offsetMs: 0, weather: 'lightCloud', rainPct: 12 }), overridden: false },
        { sample: expect.objectContaining({ offsetMs: 1_800_000, weather: 'lightRain', rainPct: 45 }), overridden: false },
      ],
    });
    expect(samplesOf(round)).toHaveLength(2);
    // the replay planned on the imported samples: the highest rain chance of the race
    expect(p.replays()[0]!.job.conditions).toEqual(IMPORTED);
    expect(p.jobInputs().at(-1)!.planning!.rainPct).toMatchObject({ known: true, value: 45 });
  });

  it('plans.race.set with conditions entered and row 2 at rain 80: a new replay whose job input\'s planning.rainPct is 80; the rows mark row 2 overridden', async () => {
    const { qualifying, p, round } = await opened();
    const imported = samplesOf(round);
    const entered = row2At(imported, 80);

    expect(p.setRace({ laps: SUGGESTED, sets: 'carried', conditions: entered })).toEqual({ ok: true });
    await vi.waitFor(() => expect(p.replays()).toHaveLength(2), { timeout: 60_000 });
    expect(p.replays()[1]!.job.conditions).toEqual(entered);
    const after = await p.settled(2);

    expect(p.jobInputs().at(-1)!.planning!.rainPct).toMatchObject({ known: true, value: 80 });
    expect(after.race.conditions).toEqual(entered);
    expect(after.forecast.source.ref).toEqual(qualifying.ref);
    expect(after.forecast.rows).toEqual({
      known: true,
      at: expect.any(Number),
      value: [
        { sample: imported[0], overridden: false },
        { sample: { ...imported[1]!, rainPct: 80 }, overridden: true },
      ],
    });
  });

  it('conditions: IMPORTED: back to 45, nothing overridden', async () => {
    const { p, round } = await opened();
    const imported = samplesOf(round);
    expect(p.setRace({ laps: SUGGESTED, sets: 'carried', conditions: row2At(imported, 80) })).toEqual({ ok: true });
    await p.settled(2);
    await vi.waitFor(() => expect(p.round().race.conditions.kind).toBe('entered'));

    expect(p.setRace({ laps: SUGGESTED, sets: 'carried', conditions: IMPORTED })).toEqual({ ok: true });
    await vi.waitFor(() => expect(p.replays()).toHaveLength(3), { timeout: 60_000 });
    expect(p.replays()[2]!.job.conditions).toEqual(IMPORTED);
    const after = await p.settled(3);

    expect(p.jobInputs().at(-1)!.planning!.rainPct).toMatchObject({ known: true, value: 45 });
    expect(after.race.conditions).toEqual(IMPORTED);
    expect(after.forecast.rows).toEqual({ known: true, at: expect.any(Number), value: imported.map((sample) => ({ sample, overridden: false })) });
  });

  it('a qualifying with no race samples: rows unknown(\'notReceived\'), rainPct unknown (Review focus 3)', async () => {
    const { p, round } = await opened({ samples: [] });

    // the replay has returned (the job ran): still no rows, and nothing reads 0 % (C3)
    expect(round.forecast.rows).toEqual(unknown('notReceived'));
    const rainPct = p.jobInputs().at(-1)!.planning!.rainPct;
    expect(rainPct.known).toBe(false);

    // entering rows makes them known, and the job plans on them
    const entered: RaceConditions = {
      kind: 'entered',
      samples: [{ offsetMs: 0, weather: 'lightRain', trackTempC: 30, trackTempTrend: 'flat', airTempC: 22, airTempTrend: 'flat', rainPct: 60 }] as ForecastSample[],
    };
    expect(p.setRace({ laps: SUGGESTED, sets: 'carried', conditions: entered })).toEqual({ ok: true });
    const after = await p.settled(2);
    expect(after.forecast.rows).toMatchObject({ known: true, value: [{ sample: entered.samples[0] }] });
    expect(p.jobInputs().at(-1)!.planning!.rainPct).toMatchObject({ known: true, value: 60 });
  });

  it('an invalid entered list (rain 101): invalid', async () => {
    const { p, round } = await opened();
    const imported = samplesOf(round);
    const before = p.round();

    expect(p.setRace({ laps: SUGGESTED, sets: 'carried', conditions: row2At(imported, 101) })).toMatchObject({ ok: false, reason: 'invalid' });
    // offsets not rising, and a weather the game does not know: invalid too
    expect(p.setRace({ laps: SUGGESTED, sets: 'carried', conditions: { kind: 'entered', samples: [imported[1]!, imported[0]!] } })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(p.setRace({ laps: SUGGESTED, sets: 'carried', conditions: { kind: 'entered', samples: [{ ...imported[0]!, weather: 'fog' as ForecastSample['weather'] }] } })).toMatchObject({ ok: false, reason: 'invalid' });
    // nothing changed, nothing replayed
    await new Promise((r) => setTimeout(r, 300));
    expect(p.replays()).toHaveLength(1);
    expect(p.round()).toEqual(before);
  });
});
