// `asOfEnded(view, race)` takes the round's conditions (SP4.3f Task 2, spec §4.1, §4.3; C3, C4, C62d): the planning
// round's as-of view takes the race assumptions' conditions in place of the qualifying's `nextForecast`, as it takes the
// laps. With `race.nextForecast` given, `fixed.weatherNow.nextForecast` is that list and everything else of `weatherNow`
// is the view's (its weather now, its own forecast, its accuracy); without it, the view's own.
import type { ForecastSample, Weather } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { asOfEnded, asOfNow, type EngineView } from '../../src/index.ts';
import { gridStart, run, script } from '../situations/script.ts';
import { viewOf } from '../support/scheduler.ts';

/** A forecast sample `offsetMs` after the session start (integer ms, C4). */
const sample = (offsetMs: number, weather: Weather, rainPct: number): ForecastSample => ({
  offsetMs,
  weather,
  trackTempC: 30,
  trackTempTrend: 'flat',
  airTempC: 22,
  airTempTrend: 'flat',
  rainPct,
});

/** The qualifying's own race samples (its last Session packet's `nextForecast`): clear, 1 %. */
const QUALIFYING_NEXT: ForecastSample[] = [sample(0, 'clear', 1)];
/** The qualifying session's own forecast: not the race's. */
const OWN_FORECAST: ForecastSample[] = [sample(0, 'overcast', 5), sample(900_000, 'lightCloud', 10)];
/** The round's conditions as entered: light rain at the start, heavy rain from +30 min. */
const ENTERED: ForecastSample[] = [sample(0, 'lightRain', 60), sample(1_800_000, 'heavyRain', 80)];

/** A run of 30 frames, ended (`finish`), its live weather a qualifying's: its own forecast, the race's samples `QUALIFYING_NEXT`. */
function endedQualifying(): EngineView {
  const { runner } = run(script(gridStart(30)));
  const view = viewOf(runner.finish());
  const session = { ...view.live.session, weather: 'overcast' as const, forecast: OWN_FORECAST, forecastAccuracy: 'approximate' as const, nextForecast: QUALIFYING_NEXT };
  return { ...view, live: { ...view.live, session } as EngineView['live'] };
}

describe("asOfEnded takes the round's conditions (SP4.3f Task 2)", () => {
  it("as-of-conditions: with nextForecast, fixed.weatherNow.nextForecast is the given samples, the rest of weatherNow the view's, totalLaps the entered laps", () => {
    const view = endedQualifying();
    const v = asOfEnded(view, { laps: 56, nextForecast: ENTERED });
    const weather = v.fixed.weatherNow;
    if (weather === null) throw new Error('weatherNow is null on the ended view');
    expect(weather.nextForecast).toEqual(ENTERED);
    // everything else of weatherNow is the view's
    expect(weather.weather).toBe('overcast');
    expect(weather.forecast).toEqual(OWN_FORECAST);
    expect(weather.forecastAccuracy).toBe('approximate');
    expect(weather).toEqual({ ...asOfNow(view).fixed.weatherNow, nextForecast: ENTERED });
    expect(v.fixed.totalLaps).toMatchObject({ known: true, value: 56 });
    // the view itself keeps the qualifying's samples
    expect(view.live.session.nextForecast).toEqual(QUALIFYING_NEXT);
  });

  it("as-of-conditions: without nextForecast, fixed.weatherNow is the view's own (its nextForecast the qualifying's)", () => {
    const view = endedQualifying();
    const v = asOfEnded(view, { laps: 56 });
    expect(v.fixed.weatherNow?.nextForecast).toEqual(QUALIFYING_NEXT);
    expect(v.fixed.weatherNow).toEqual(asOfNow(view).fixed.weatherNow);
    expect(v.fixed.totalLaps).toMatchObject({ known: true, value: 56 });
  });

  it('as-of-conditions: an empty nextForecast is taken as given (no race samples entered), not the view\'s', () => {
    const v = asOfEnded(endedQualifying(), { laps: 56, nextForecast: [] });
    expect(v.fixed.weatherNow?.nextForecast).toEqual([]);
  });
});
