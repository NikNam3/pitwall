// The plan board's race conditions, pure (SP4.3f Task 7; spec §4.3, §4.4; mockup
// docs/design/2026-11-18-sp4.3f/plan-board-conditions.html; C3, C65, C73). Contract assumed of `conditions.ts`:
//  - `conditionRows(f: RoundForecast)`: the editor's rows from the round's forecast rows, in their order, each
//    `{ offsetMs, weather, rainPct, overridden }`; unknown rows stay unknown with their reason (C3: never an empty or 0 row);
//  - `enteredWith(f, index, change: { weather?, rainPct? })`: the `RaceConditions` one `plans.race.set` sends for a
//    changed row: the whole list as `entered`, the row at `index` with the change, every other field of every row
//    (offsets, the game's temperatures and trends) kept as the round's rows hold them.
// Needs `conditions.ts` (implementation): fails at import, and at typecheck, until then.
import { describe, expect, it } from 'vitest';
import { conditionRows, enteredWith } from './conditions.ts';
import { forecastOf, SAMPLES } from './fixtures.ts';

describe('plan board: the race conditions (conditions.ts)', () => {
  it('two imported rows {0, clear, 1}, {1_800_000, lightRain, 45}: enteredWith(f, 1, { rainPct: 80 }) is entered with both rows, row 2 rain 80; an entered row is time, weather and rain only (the bridge fills the temperatures)', () => {
    const f = forecastOf(SAMPLES);
    const [first, second] = SAMPLES;
    expect(first).toMatchObject({ offsetMs: 0, weather: 'clear', rainPct: 1 });
    expect(second).toMatchObject({ offsetMs: 1_800_000, weather: 'lightRain', rainPct: 45 });
    const row = (s: typeof first) => ({ offsetMs: s!.offsetMs, weather: s!.weather, rainPct: s!.rainPct });
    expect(enteredWith(f, 1, { rainPct: 80 })).toEqual({ kind: 'entered', samples: [row(first), { ...row(second), rainPct: 80 }] });
    // a weather change keeps the rain chance
    expect(enteredWith(f, 0, { weather: 'overcast' })).toEqual({ kind: 'entered', samples: [{ ...row(first), weather: 'overcast' }, row(second)] });
  });

  it('conditionRows: the rows in order with their override; unknown rows stay unknown (C3)', () => {
    const rows = conditionRows(forecastOf(SAMPLES, [1]));
    expect(rows.known).toBe(true);
    if (!rows.known) return;
    expect(rows.value).toEqual([
      { offsetMs: 0, weather: 'clear', rainPct: 1, overridden: false },
      { offsetMs: 1_800_000, weather: 'lightRain', rainPct: 45, overridden: true },
    ]);
    const none = conditionRows(forecastOf(null));
    expect(none).toMatchObject({ known: false, reason: 'notReceived' });
  });
});
