// `forecast-field`'s declared priors for missing inputs (review finding F16-1, ruling R40; C3): an unknown input is
// never a made-up certainty. An unknown track-wetness state is the config's prior (dry, with `priorWetnessSdMs`), an
// unknown rival-stops window the uninformative window from the next lap to the flag, an unknown `owesStop` the config's
// `assumeOwesStop`. Each row asserts the built value and that the build stays known.
import { carId, unknown, type Known, type RivalStops, type StartingPoint, type TrackWetness } from '@pitwall/domain';
import { asOfNow, type AsOfView, type CalculatorId } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { RIVAL_STOPS } from '../../../src/rival-stops/index.ts';
import { TRACK_WETNESS } from '../../../src/track-wetness/index.ts';
import { buildStartingPoint } from '../../../src/shared/forecast-field/index.ts';
import { generated, materialised, PARAMS, plainNoise, upstreamOf } from './support.ts';

/** The generator race's human cars: slots 6 and 7. */
const HUMANS = [6, 7];
/** The rival whose rival-stops entry is made unknown. */
const RIVAL = carId(2);

const g = generated();

/** The view after lap 6's first frame (before the stops, every car on its start set), with `config` on top. */
function viewAtLap6(config: AsOfView['config'] = {}): AsOfView {
  const view = materialised(asOfNow(g.viewAt(g.race.framesOfLap(6)[0]!)));
  return { ...view, config: { ...view.config, ...config } };
}

/** `outputs` with `id`'s output replaced by `f` of it. */
function replaced<T>(outputs: ReadonlyMap<CalculatorId, unknown>, id: CalculatorId, f: (out: T) => T): ReadonlyMap<CalculatorId, unknown> {
  const out = new Map(outputs);
  out.set(id, f(outputs.get(id) as T));
  return out;
}

/** The starting point's value; the build must stay known. */
function valueOf(sp: Known<StartingPoint>): StartingPoint {
  expect(sp.known, sp.known ? 'known' : `the starting point is unknown (${sp.reason})`).toBe(true);
  if (!sp.known) throw new Error('unknown starting point');
  return sp.value;
}

/** The starting point at lap 6 with `id`'s output replaced by `f` of it, under `config`. */
function buildWith<T>(id: CalculatorId, f: (out: T) => T, config: AsOfView['config'] = {}): StartingPoint {
  const view = viewAtLap6(config);
  const outputs = upstreamOf(view, plainNoise(PARAMS.cars, HUMANS, view.at));
  return valueOf(buildStartingPoint(view, replaced(outputs, id, f)));
}

describe('forecast-field declared priors for unknown inputs (F16-1, R40)', () => {
  it('an unknown track-wetness state is the declared prior: wetnessMs 0 with sdMs priorWetnessSdMs (1,500 ms by default)', () => {
    const unknownState = (w: TrackWetness): TrackWetness => ({ ...w, state: unknown('insufficientData') });
    const sp = buildWith<TrackWetness>(TRACK_WETNESS, unknownState);
    expect(sp.wetness).toEqual({ wetnessMs: 0, sdMs: 1_500 });
    // the sd is the config's, overridable
    const overridden = buildWith<TrackWetness>(TRACK_WETNESS, unknownState, { 'forecast-field': { priorWetnessSdMs: 2_000 } });
    expect(overridden.wetness).toEqual({ wetnessMs: 0, sdMs: 2_000 });
  });

  it('an unknown rival-stops window is the uninformative window from the next lap to the flag, stopMid at its middle', () => {
    const sp = buildWith<RivalStops>(RIVAL_STOPS, (stops) => ({ ...stops, [RIVAL]: { ...stops[RIVAL]!, window: unknown('insufficientData') } }));
    const low = sp.lap + 1;
    const high = sp.lapsTotal;
    expect(low).toBeLessThan(high);
    expect(sp.stopLow[RIVAL]).toBe(low);
    expect(sp.stopHigh[RIVAL]).toBe(high);
    expect(sp.stopMid[RIVAL]).toBe(Math.floor((low + high) / 2));
  });

  it('an unknown owesStop is the declared assumption assumeOwesStop (true by default: owes a stop)', () => {
    const unknownOwes = (stops: RivalStops): RivalStops => ({ ...stops, [RIVAL]: { ...stops[RIVAL]!, owesStop: unknown('insufficientData') } });
    const sp = buildWith<RivalStops>(RIVAL_STOPS, unknownOwes);
    expect(sp.owesStop[RIVAL]).toBe(1);
    // the assumption is the config's, overridable
    const overridden = buildWith<RivalStops>(RIVAL_STOPS, unknownOwes, { 'forecast-field': { assumeOwesStop: false } });
    expect(overridden.owesStop[RIVAL]).toBe(0);
  });
});
