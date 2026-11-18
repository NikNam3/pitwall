// The planning input on the round's conditions (SP4.3f Task 2, spec §4.1, §4.3; C3, C43, C50, C62d): the round's as-of
// view (`asOfEnded(view, { laps, nextForecast })`) takes the entered conditions in place of the qualifying's
// `nextForecast`, and every planning reader follows them through it: `planningInputFrom`'s `planning.rainPct` (the
// highest rain chance of the given samples; unknown without any, never 0 %, C3, review focus 3) and the race's start
// weather (`buildGridStart`, the one builder, C50: the given samples mapped onto laps by the grid leader's pace).
//
// The qualifying is a builder race's view after its last frame seen as an ended one-shot qualifying (as
// `strategy/planning-support.ts`' `qualifyingAsOf`): the race-only sub-machines' spans removed, the qualifying's
// weekend-phase and session-phase (`finished`) spans added, every open span closed by `finish` on the frame after the
// last (so `asOfEnded`'s situation at the end is the projection's, C26), its own race samples `[{0, clear, 1}]`.
import { IMPORTED, unknown, type ForecastSample, type OpenSpan, type Span, type Weather } from '@pitwall/domain';
import { asOfEnded, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { planningInputFrom } from '../../../src/shared/strategy-input/index.ts';
import type { StrategyInput } from '../../../src/shared/strategy-input/input.ts';
import { openSpan } from '../../situated.ts';
import { NO_PLANS } from '../../strategy/planning-support.ts';
import { once, OURS, RACE, viewAtFrame } from '../../strategy/support.ts';

/** The race's laps as entered in the round. */
const LAPS = 56;

/** The sub-machines that run only in the race (C17): none of them has a span in a qualifying session. */
const RACE_ONLY = new Set(['session-phase-race', 'race-control-race', 'car-activity-race', 'compound-rule', 'penalties']);

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
/** The round's conditions as entered: light rain at the start (60 %), heavy rain from +30 min (80 %). */
const ENTERED: ForecastSample[] = [sample(0, 'lightRain', 60), sample(1_800_000, 'heavyRain', 80)];

/** The ended qualifying session's view (see the header). */
const ENDED = once((): EngineView => {
  const race = RACE();
  const view = viewAtFrame(race, race.lastFrame);
  const endFrame = race.lastFrame + 1;
  const end = view.live.sessionTime;
  const close = (s: OpenSpan): Span => ({ ...s, end, endFrame }) as Span;
  const spans: Record<string, Span[]> = {};
  for (const [machine, list] of Object.entries(view.history.spans)) if (!RACE_ONLY.has(machine) && machine !== 'weekend-phase') spans[machine] = [...(list as Span[])];
  for (const [machine, open] of Object.entries(view.situation.byMachine)) {
    if (RACE_ONLY.has(machine) || machine === 'weekend-phase') continue;
    spans[machine] = [...(spans[machine] ?? []), ...(open as OpenSpan[]).map(close)];
  }
  spans['weekend-phase'] = [close(openSpan('weekend-phase', 'qualifying', { detail: { format: 'oneShot', segment: undefined } }))];
  spans['session-phase-qualifying'] = [close(openSpan('session-phase-qualifying', 'finished'))];
  const session = { ...view.live.session, weather: 'clear' as const, forecast: [sample(0, 'clear', 0), sample(900_000, 'clear', 0)], forecastAccuracy: 'perfect' as const, nextForecast: QUALIFYING_NEXT };
  return {
    ...view,
    live: { ...view.live, session } as EngineView['live'],
    situation: { weekendPhase: { kind: 'qualifying', format: 'oneShot', segment: undefined }, byMachine: {} } as EngineView['situation'],
    history: { ...view.history, spans },
  };
});

/** The planning input on `asOf` for the entered laps, the qualifying's sets carried, no prepared plans. */
const inputOn = (asOf: AsOfView): StrategyInput => planningInputFrom(asOf, { laps: LAPS, race: { laps: LAPS, sets: 'carried', conditions: IMPORTED }, prepared: NO_PLANS(OURS) });

describe("the planning input on the round's conditions (SP4.3f Task 2)", () => {
  it('planning-conditions: planning.rainPct is the given samples\' highest rain chance, known(80), not the qualifying\'s 1', () => {
    const input = inputOn(asOfEnded(ENDED(), { laps: LAPS, nextForecast: ENTERED }));
    expect(input.planning?.rainPct).toMatchObject({ known: true, value: 80 });
  });

  it("planning-conditions: nextForecast [] → planning.rainPct unknown('notReceived'), never 0 % (C3, review focus 3)", () => {
    const input = inputOn(asOfEnded(ENDED(), { laps: LAPS, nextForecast: [] }));
    expect(input.planning?.rainPct).toEqual(unknown('notReceived'));
  });

  it("planning-conditions: start.weather follows the given samples: the first lap's rain chance is the first sample's 60, not the qualifying's 1", () => {
    const input = inputOn(asOfEnded(ENDED(), { laps: LAPS, nextForecast: ENTERED }));
    expect(input.start.known, input.start.known ? '' : input.start.reason).toBe(true);
    if (!input.start.known) return;
    const weather = input.start.value.weather;
    expect(weather.known, weather.known ? '' : weather.reason).toBe(true);
    if (!weather.known) return;
    expect(weather.value.byLap.map((l) => l.lap)).toEqual(Array.from({ length: LAPS }, (_, i) => i + 1));
    // the first lap's middle lies a lap's half (the leader's pace, about 100 s) past +0, so between 60 % and 80 % close to 60
    const first = weather.value.byLap[0]!.rainPct;
    expect(first).toBeGreaterThanOrEqual(60);
    expect(first).toBeLessThan(61);
    // later laps rise towards the +30 min sample's 80 %, never past it
    for (const l of weather.value.byLap) expect(l.rainPct, `lap ${l.lap}`).toBeLessThanOrEqual(80);
    expect(weather.value.byLap.at(-1)!.rainPct).toBeGreaterThan(first);
  });

  it("planning-conditions: without given conditions the qualifying's own samples stay (rainPct known(1))", () => {
    const input = inputOn(asOfEnded(ENDED(), { laps: LAPS }));
    expect(input.planning?.rainPct).toMatchObject({ known: true, value: 1 });
  });
});
