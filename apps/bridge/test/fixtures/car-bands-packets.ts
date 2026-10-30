// `car-bands` against the raw packets, for the full-lap segment tests (race-full-lap, quali-full-lap): the player's
// channels, corners and units reach the bands as the game sends them. The expected values come from the latest
// CarTelemetry and CarStatus packets, the bands from the run's config over the defaults. The tyre surface has no live
// state (ruling 2026-10-30: it swings 30-60 °C within a lap, so only the whole lap judges it).
import { CAR_BANDS, CAR_BANDS_CONFIG, type BandState, type CarBandsOutput } from '@pitwall/analysis';
import type { BandReading, CarBands } from '@pitwall/domain';
import type { DeepReadonly, EngineState, Frame, SchedulerResult } from '@pitwall/engine';
import type { CarStatusPacket, CarTelemetryPacket } from '@pitwall/protocol';

/** The game's wheel order in every per-wheel array. */
const GAME_ORDER = ['rl', 'rr', 'fl', 'fr'] as const;
/** CarStatus `visualTyreCompound`: 7 inter, 8 wet; every other one is a slick. */
const TYRE_KIND: Record<number, 'Inter' | 'Wet'> = { 7: 'Inter', 8: 'Wet' };

type Telemetry = CarTelemetryPacket['carTelemetryData'][number];
type Band = { lo: number; hi: number };
type Config = typeof CAR_BANDS_CONFIG.defaults;
/**
 * One channel: our reading of it, the game's raw value, the band the config gives for the fitted tyre kind, and
 * whether it has a live state (every channel but the tyre surface).
 */
type Channel = {
  name: string;
  reading: (b: CarBands) => BandReading;
  raw: (t: Telemetry) => number;
  band: (c: Config, kind: 'Dry' | 'Inter' | 'Wet') => Band;
  live: boolean;
};

const tyreBand = (c: Config, kind: 'Dry' | 'Inter' | 'Wet', channel: 'surface' | 'carcass'): Band => ({ lo: c[`${channel}${kind}Lo`], hi: c[`${channel}${kind}Hi`] });
const CHANNELS: Channel[] = [
  ...GAME_ORDER.flatMap((corner, wheel): Channel[] => [
    { name: `surface.${corner}`, reading: (b) => b.tyres[corner].surfaceC, raw: (t) => t.tyresSurfaceTemperature[wheel]!, band: (c, k) => tyreBand(c, k, 'surface'), live: false },
    { name: `carcass.${corner}`, reading: (b) => b.tyres[corner].carcassC, raw: (t) => t.tyresInnerTemperature[wheel]!, band: (c, k) => tyreBand(c, k, 'carcass'), live: true },
    { name: `pressure.${corner}`, reading: (b) => b.tyres[corner].pressurePsi, raw: (t) => t.tyresPressure[wheel]!, band: (c) => ({ lo: c.pressureLo, hi: c.pressureHi }), live: true },
    { name: `brakes.${corner}`, reading: (b) => b.brakesC[corner], raw: (t) => t.brakesTemperature[wheel]!, band: (c) => ({ lo: c.brakeLo, hi: c.brakeHi }), live: true },
  ]),
  { name: 'engine', reading: (b) => b.engineC, raw: (t) => t.engineTemperature, band: (c) => ({ lo: 0, hi: c.engineHi }), live: true },
];

/** Where the config puts a value against a band; `car-bands` has no hysteresis or debounce (stateless, ruling R1). */
const expectedState = (value: number, { lo, hi }: Band): BandState => (value < lo ? 'below' : value > hi ? 'above' : 'in');

/** What the check saw: how often car-bands ran, and the first channels that differed (`time channel: ours [value, state, band] game [...]`). */
export type BandsAgainstPackets = { runs: number; off: string[] };

/**
 * An observer for `replayScheduled` (with `carBandsCalculator` among the calculators): on every run of car-bands, each
 * of the player's channels against what the latest packets and the config give. `override` is the run's `car-bands`
 * config section (the same one `replayScheduled` gets). Fills and returns `seen`.
 */
export function bandsAgainstPackets(override: Partial<Config> = {}): {
  seen: BandsAgainstPackets;
  observe: (state: DeepReadonly<EngineState>, scheduled: SchedulerResult, frame: Frame) => void;
} {
  const config: Config = { ...CAR_BANDS_CONFIG.defaults, ...override };
  const seen: BandsAgainstPackets = { runs: 0, off: [] };
  let telemetry: CarTelemetryPacket | undefined;
  let status: CarStatusPacket | undefined;
  const observe = (state: DeepReadonly<EngineState>, scheduled: SchedulerResult, frame: Frame): void => {
    telemetry = frame.telemetry ?? telemetry;
    status = frame.status ?? status;
    if (!scheduled.ran.includes(CAR_BANDS) || telemetry === undefined || status === undefined) return;
    seen.runs++;
    const raw = telemetry.carTelemetryData[state.playerCar]!;
    const kind = TYRE_KIND[status.carStatusData[state.playerCar]!.visualTyreCompound] ?? 'Dry';
    const bands = (scheduled.outputs.get(CAR_BANDS) as CarBandsOutput)[state.playerCar]!;
    for (const ch of CHANNELS) {
      const r = ch.reading(bands);
      const value = ch.raw(raw);
      const band = ch.band(config, kind);
      const ours = [r.value.known ? r.value.value : r.value.reason, r.state.known ? r.state.value : r.state.reason, r.band];
      const game = [value, ch.live ? expectedState(value, band) : 'notApplicable', band];
      if (seen.off.length < 10 && JSON.stringify(ours) !== JSON.stringify(game)) {
        seen.off.push(`${state.sessionTime} ${ch.name}: ours ${JSON.stringify(ours)} game ${JSON.stringify(game)}`);
      }
    }
  };
  return { seen, observe };
}
