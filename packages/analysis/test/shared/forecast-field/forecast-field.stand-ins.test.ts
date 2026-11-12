// `forecast-field` makes up no value (SP4.3a final review F4; C3, ruling R40's pattern): a car whose newest lap has an
// unknown visual compound, a competing car with no completed lap, and a car whose driver is `unknown` were built with
// silent stand-ins (medium, the leader's newest lap, the AI). Each is now either a stand-in declared in forecast-field's
// config with its source (as R40's `priorWetnessSdMs` and `assumeOwesStop`), or the build reports `unknown` through
// `need`; the implementer picks per item. So each row holds when:
//  - the build is `unknown`; or
//  - it is known, forecast-field's config declares a key beyond R40's set, and overriding such a key changes what the
//    build gives that car (the stand-in is the config's, not a literal).
import { carId, NOISE_COMPOUNDS, type DriverNoise, type Known, type LapRecord, type StartingPoint } from '@pitwall/domain';
import { asOfNow, type AsOfView, type Projection } from '@pitwall/engine/readers';
import { describe, expect, it } from 'vitest';
import { buildStartingPoint, FORECAST_FIELD_CONFIG } from '../../../src/shared/forecast-field/index.ts';
import { arraysOf, generated, materialised, PARAMS, plainNoise, upstreamOf } from './support.ts';

/** The generator race's human cars: slots 6 and 7. */
const HUMANS = [6, 7];
/** The car each row changes: competing, not the leader. */
const CAR = carId(4);

/** forecast-field's config keys before the fix (R40's set included): a stand-in declared by the fix is a key beyond these. */
const KEYS_BEFORE = [
  'placementToleranceMs', 'fallbackPaceSdMs', 'minWearRatePctPerLap', 'compoundOffsetPriorSdMs', 'defaultSoftOffsetMs', 'defaultHardOffsetMs',
  'interOffsetMs', 'wetOffsetMs', 'convexFromPct', 'convexMsPerPct2', 'coldTyreLap1Ms', 'coldTyreLap2Ms', 'coldTyreWetFactor', 'scPaceFactor',
  'scWearFactor', 'scFuelFactor', 'vscPaceFactor', 'vscWearFactor', 'vscFuelFactor', 'slickMsPerWetnessMs', 'interMsPerWetnessMs',
  'wetMsPerWetnessMs', 'priorWetnessSdMs', 'assumeOwesStop',
];
const DEFAULTS = FORECAST_FIELD_CONFIG.defaults as Record<string, number | string | boolean>;

const g = generated();

/** The view after lap 6's first frame (every car on its start set), its projection changed by `history`, with `config` on top. */
function viewAtLap6(history: (h: Projection) => Projection, config: AsOfView['config']): AsOfView {
  const view = materialised(asOfNow(g.viewAt(g.race.framesOfLap(6)[0]!)));
  return { ...view, history: history(view.history), config: { ...view.config, ...config } };
}

/** A build at lap 6: the projection changed by `history`, driver-noise's plain output changed by `noise`, under `config`. */
type Build = (config: AsOfView['config']) => Known<StartingPoint>;
const builder =
  (history: (h: Projection) => Projection = (h) => h, noise: (n: DriverNoise) => DriverNoise = (n) => n): Build =>
  (config) => {
    const view = viewAtLap6(history, config);
    return buildStartingPoint(view, upstreamOf(view, noise(plainNoise(PARAMS.cars, HUMANS, view.at))));
  };

/** Every per-car value of `sp` for `car`, by array name. */
function carValues(sp: StartingPoint, car: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, values] of arraysOf(sp)) if (values.length === sp.cars) out[name] = values[car] as number;
  return out;
}

/** Another value of the type of `v`: another compound, the other driver kind, the negation, or a number away from it. */
function altered(v: number | string | boolean): number | string | boolean {
  if (typeof v === 'boolean') return !v;
  if (typeof v === 'number') return v === 0 ? 1_000 : v * 2 + 1;
  if ((NOISE_COMPOUNDS as readonly string[]).includes(v)) return v === 'hard' ? 'soft' : 'hard';
  if (v === 'ai') return 'human';
  if (v === 'human') return 'ai';
  return `${v}-other`;
}

/** The row's rule: `unknown`, or a declared stand-in (a key beyond `KEYS_BEFORE`) whose override changes the car's values. */
function expectDeclaredOrUnknown(what: string, build: Build): void {
  const sp = build({});
  if (!sp.known) {
    expect(sp.reason, `${what}: unknown with a reason`).toBeTruthy();
    return;
  }
  const added = Object.keys(DEFAULTS).filter((key) => !KEYS_BEFORE.includes(key));
  expect(added, `${what}: the build stays known, so its stand-in is a key declared in forecast-field's config`).not.toEqual([]);
  const base = carValues(sp.value, CAR);
  const follows = added.some((key) => {
    const other = build({ [FORECAST_FIELD_CONFIG.key]: { [key]: altered(DEFAULTS[key]!) } });
    return other.known && JSON.stringify(carValues(other.value, CAR)) !== JSON.stringify(base);
  });
  expect(follows, `${what}: overriding a declared stand-in (${added.join(', ')}) changes car ${CAR}'s values`).toBe(true);
}

describe('forecast-field makes up no value (F4, C3)', () => {
  it("the starting point at lap 6 is known with every input known (the rows' base)", () => {
    expect(builder()({}).known).toBe(true);
  });

  it('a car whose newest lap has an unknown visual compound: a declared stand-in, or unknown', () => {
    const unknownCompound = (h: Projection): Projection => {
      const newest = Math.max(...(h.laps as readonly LapRecord[]).filter((l) => l.carId === CAR).map((l) => l.lapNumber));
      const laps = (h.laps as readonly LapRecord[]).map((l): LapRecord => (l.carId === CAR && l.lapNumber === newest ? { ...l, visualCompound: 'unknown' } : l));
      return { ...h, laps };
    };
    expectDeclaredOrUnknown('unknown visual compound', builder(unknownCompound));
  });

  it('a competing car with no completed lap: a declared stand-in, or unknown (never the leader’s lap silently)', () => {
    const noLaps = (h: Projection): Projection => ({ ...h, laps: (h.laps as readonly LapRecord[]).filter((l) => l.carId !== CAR) });
    expectDeclaredOrUnknown('no completed lap', builder(noLaps));
  });

  it("a car whose driver is unknown: a declared stand-in, or unknown (never the AI silently)", () => {
    const unknownDriver = (n: DriverNoise): DriverNoise => ({ ...n, cars: { ...n.cars, [CAR]: { ...n.cars[CAR]!, driver: 'unknown' } } });
    expectDeclaredOrUnknown('unknown driver', builder(undefined, unknownDriver));
  });
});
