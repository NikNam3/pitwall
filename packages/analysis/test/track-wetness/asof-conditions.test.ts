// `track-wetness` on the planning round's as-of view with the round's conditions (SP4.3f Task 2, spec §4.3; C3, C43,
// C62d): the round's as-of view (`asOfEnded(view, { laps, nextForecast })`) takes the entered conditions in place of the
// qualifying's `nextForecast`, and `track-wetness`'s start state (the race's wetness at its start) follows them: the rain
// wetness when the first given sample is rain, dry when it is clear, whatever the qualifying's own samples said.
import { type ForecastSample, type OpenSpan, type Span, type Weather } from '@pitwall/domain';
import { asOfEnded, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { engineView, history } from '../../../../test-support/builders/index.ts';
import { TRACK_WETNESS_CONFIG } from '../../src/track-wetness/config.ts';
import { trackWetnessAsOf } from '../../src/track-wetness/index.ts';
import { openSpan, QUALIFYING } from '../situated.ts';

/** The race's laps as entered in the round. */
const RACE_LAPS = 56;
/** When the qualifying ended (race clock, ms). */
const END_MS = 1_800_000;
/** The frame the qualifying's last spans closed on (`finish`: the frame after the last applied one). */
const END_FRAME = 31;

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

/** `span` closed on the session's end. */
const closed = (span: OpenSpan): Span => ({ ...span, end: END_MS, endFrame: END_FRAME }) as Span;

/**
 * The ended qualifying session (C62d): every span closed by `finish` (so the situation at its end is the projection's),
 * its own weather and forecast clear, the race's samples `next` (the qualifying's last Session packet's).
 */
function endedQualifying(next: ForecastSample[]): EngineView {
  const { kind, ...detail } = QUALIFYING as { kind: string };
  const spans: Record<string, Span[]> = {
    'weekend-phase': [closed(openSpan('weekend-phase', kind, { detail }))],
    'session-phase-qualifying': [closed(openSpan('session-phase-qualifying', 'finished'))],
  };
  return engineView({
    situation: { weekendPhase: QUALIFYING, byMachine: {} },
    history: history({ spans }),
    session: { totalLaps: 0, weather: 'clear', forecast: [sample(0, 'clear', 0), sample(900_000, 'clear', 0)], forecastAccuracy: 'perfect', nextForecast: next },
    sessionTime: END_MS,
  });
}

/** The qualifying's own race samples: clear, 1 %. */
const QUALIFYING_CLEAR: ForecastSample[] = [sample(0, 'clear', 1)];
/** The qualifying's own race samples: heavy rain from the start. */
const QUALIFYING_RAIN: ForecastSample[] = [sample(0, 'heavyRain', 90)];
/** Entered conditions: light rain at the start, heavy rain from +30 min. */
const RAIN_FIRST: ForecastSample[] = [sample(0, 'lightRain', 60), sample(1_800_000, 'heavyRain', 80)];
/** Entered conditions: clear at the start, rain from +30 min. */
const CLEAR_FIRST: ForecastSample[] = [sample(0, 'clear', 5), sample(1_800_000, 'heavyRain', 80)];

const { startRainWetnessMs, initialSdMs } = TRACK_WETNESS_CONFIG.defaults;

describe("track-wetness on the round's conditions (SP4.3f Task 2)", () => {
  it("asof-conditions: the first given sample rain → the start state is the rain wetness (the qualifying's own samples clear)", () => {
    const out = trackWetnessAsOf(asOfEnded(endedQualifying(QUALIFYING_CLEAR), { laps: RACE_LAPS, nextForecast: RAIN_FIRST }));
    expect(out.state).toMatchObject({ known: true, value: { wetnessMs: startRainWetnessMs, sdMs: initialSdMs } });
    expect(out.wet).toMatchObject({ known: true, value: true });
  });

  it("asof-conditions: the first given sample clear → the start state is dry (the qualifying's own samples rain)", () => {
    const out = trackWetnessAsOf(asOfEnded(endedQualifying(QUALIFYING_RAIN), { laps: RACE_LAPS, nextForecast: CLEAR_FIRST }));
    expect(out.state).toMatchObject({ known: true, value: { wetnessMs: 0, sdMs: initialSdMs } });
    expect(out.wet).toMatchObject({ known: true, value: false });
  });

  it("asof-conditions: without given conditions the start state follows the qualifying's own samples", () => {
    const out = trackWetnessAsOf(asOfEnded(endedQualifying(QUALIFYING_RAIN), { laps: RACE_LAPS }));
    expect(out.state).toMatchObject({ known: true, value: { wetnessMs: startRainWetnessMs } });
  });
});
