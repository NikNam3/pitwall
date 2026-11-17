// `track-wetness`'s qualifying row (SP4.3d2 Task 6, SP4.3d spec §7.2, §7.3; contract C3, C14, C44, C62d): the planning
// job runs the race's starting point on the ended qualifying session's as-of view, its `fixed.totalLaps` the race's
// entered laps (C62d). On it the unit gives the race's wetness at its start from the race's forecast: the first sample of
// `weatherNow.nextForecast` (the samples of the session after qualifying, step 1, §7.3). Without a sample, or without
// `weatherNow` (a cut or stored view), it is unknown (C3). Practice and `none` stay `notApplicable`.
import { known, type ForecastSample, type OpenSpan, type Weather, type WeekendPhase } from '@pitwall/domain';
import { asOfNow, type AsOfView, type EngineView } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { engineView } from '../../../../test-support/builders/index.ts';
import { TRACK_WETNESS_BEHAVIOUR } from '../../src/track-wetness/behaviour.ts';
import { trackWetnessAsOf } from '../../src/track-wetness/index.ts';
import { NONE, openSpan, PRACTICE, QUALIFYING } from '../situated.ts';

/** The race's laps as the user entered them in the planning round. */
const RACE_LAPS = 44;

/** A forecast sample `offsetMin` minutes ahead. */
const sample = (offsetMin: number, weather: Weather, rainPct: number): ForecastSample => ({
  offsetMin,
  weather,
  trackTempC: 30,
  trackTempTrend: 'flat',
  airTempC: 22,
  airTempTrend: 'flat',
  rainPct,
});

/** The race's forecast: dry at the start, heavy rain an hour later. */
const DRY_START: ForecastSample[] = [sample(0, 'clear', 0), sample(30, 'overcast', 20), sample(60, 'heavyRain', 90)];
/** The race's forecast: heavy rain at the start, dry an hour later. */
const WET_START: ForecastSample[] = [sample(0, 'heavyRain', 90), sample(30, 'lightRain', 60), sample(60, 'clear', 0)];

/** The ended session of weekend phase `phase` (default qualifying) as of its end: no lap, its own session phase `finished`. */
function endedSession(phase: WeekendPhase = QUALIFYING): EngineView {
  const { kind, ...detail } = phase as { kind: string };
  const byMachine: Record<string, OpenSpan[]> = {
    'weekend-phase': [openSpan('weekend-phase', kind, { detail })],
    'session-phase-qualifying': [openSpan('session-phase-qualifying', 'finished')],
  };
  return engineView({ situation: { weekendPhase: phase, byMachine }, session: { totalLaps: 0 }, sessionTime: 1_800_000 });
}

/**
 * The planning view (C62d): the session's as-of view with `fixed.totalLaps` the race's entered laps and the live
 * weather at the session's end: qualifying itself dry and its own forecast dry, the race's forecast `next` (`null`: no
 * `weatherNow`).
 */
function planningView(next: ForecastSample[] | null, phase: WeekendPhase = QUALIFYING): AsOfView {
  const now = asOfNow(endedSession(phase));
  const weatherNow: AsOfView['fixed']['weatherNow'] = next === null ? null : { weather: 'clear', forecast: [sample(0, 'clear', 0), sample(15, 'clear', 0)], forecastAccuracy: 'perfect', nextForecast: next };
  return { ...now, fixed: { ...now.fixed, totalLaps: known(RACE_LAPS, 0), weatherNow } };
}

describe("track-wetness's qualifying row (SP4.3d2 Task 6)", () => {
  it('the behaviour table gives qualifying a row of its own; practice and none stay outside the race', () => {
    const rows = TRACK_WETNESS_BEHAVIOUR['weekend-phase']!;
    expect(rows['qualifying']).not.toEqual(rows['practice']);
    for (const kind of ['practice', 'none']) expect(rows[kind]?.isRace, kind).toBe(false);
  });

  it("a qualifying session's as-of view with the race's forecast gives a known wetness (not notApplicable)", () => {
    const out = trackWetnessAsOf(planningView(DRY_START));
    expect(out.state.known).toBe(true);
    expect(out.wet.known).toBe(true);
    // nothing measured in qualifying is the race's: no lap of it
    expect(out.byLap).toEqual([]);
  });

  it("the race's wetness at its start is the first sample's: dry first, dry; wet first, wet", () => {
    const dry = trackWetnessAsOf(planningView(DRY_START));
    const wet = trackWetnessAsOf(planningView(WET_START));
    expect(dry.wet).toEqual(expect.objectContaining({ known: true, value: false }));
    expect(wet.wet).toEqual(expect.objectContaining({ known: true, value: true }));
    if (!dry.state.known || !wet.state.known) throw new Error('state unknown');
    expect(wet.state.value.wetnessMs).toBeGreaterThan(dry.state.value.wetnessMs);
    // only the first sample counts: later samples do not change it
    const dryThenDry = trackWetnessAsOf(planningView([sample(0, 'clear', 0), sample(30, 'clear', 0)]));
    expect(dryThenDry.state).toEqual(dry.state);
    expect(dryThenDry.wet).toEqual(dry.wet);
    // the samples' order in the packet is not the forecast's: the first is the earliest
    const shuffled = trackWetnessAsOf(planningView([WET_START[2]!, WET_START[0]!, WET_START[1]!]));
    expect(shuffled.state).toEqual(wet.state);
  });

  it("qualifying's own weather and forecast are not the race's: a dry qualifying with a wet race forecast is wet", () => {
    // `planningView` keeps qualifying's weather and forecast dry
    expect(trackWetnessAsOf(planningView(WET_START)).wet).toEqual(expect.objectContaining({ known: true, value: true }));
  });

  it('unknown without nextForecast samples or without weatherNow (C3), never notApplicable or a dry 0', () => {
    for (const [label, next] of [
      ['no samples', []],
      ['no weatherNow', null],
    ] as const) {
      const out = trackWetnessAsOf(planningView(next === null ? null : [...next]));
      expect(out.state.known, label).toBe(false);
      expect(out.wet.known, label).toBe(false);
      if (!out.state.known) expect(out.state.reason, label).not.toBe('notApplicable');
    }
  });

  it('practice rows unchanged: practice and none stay notApplicable, also with a race forecast', () => {
    for (const phase of [PRACTICE, NONE]) {
      const out = trackWetnessAsOf(planningView(WET_START, phase));
      expect(out, phase.kind).toMatchObject({ byLap: [], state: { known: false, reason: 'notApplicable' }, wet: { known: false, reason: 'notApplicable' } });
    }
  });
});
