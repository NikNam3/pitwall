// `car-bands` against the raw packets, for the full-lap segment tests (race-full-lap, quali-full-lap): the player's
// channels, corners and units reach the bands as the game sends them. The expected values come from the latest
// CarTelemetry, CarStatus and CarSetups packets, the bands from the run's config over the defaults. The tyre surface and
// the brakes have no live state (rulings 2026-10-30: the surface swings 30-60 °C within a lap, the brakes fall below the
// band on many straights, so only the whole lap judges them). The pressure band is the player's setup pressure per corner,
// from `setup - pressureBelowSetupPsi` to `setup + pressureAboveSetupPsi` (Q3 A); before the player's first CarSetups
// row it is unknown with the setup's own reason (`notReceived`), and so is its live state. Every other car's pressure
// band is unknown (`notReceived`) and so its live state: the game's setup is read for the player's car only (Q5 A).
import { CAR_BANDS, CAR_BANDS_CONFIG, type BandState, type CarBandsOutput } from '@pitwall/analysis';
import type { BandReading, CarBands } from '@pitwall/domain';
import type { DeepReadonly, EngineState, Frame, SchedulerResult } from '@pitwall/engine';
import type { CarSetupsPacket, CarStatusPacket, CarTelemetryPacket } from '@pitwall/protocol';

/** The game's wheel order in every per-wheel array. */
const GAME_ORDER = ['rl', 'rr', 'fl', 'fr'] as const;
/** CarStatus `visualTyreCompound`: 7 inter, 8 wet; every other one is a slick. */
const TYRE_KIND: Record<number, 'Inter' | 'Wet'> = { 7: 'Inter', 8: 'Wet' };

type Telemetry = CarTelemetryPacket['carTelemetryData'][number];
type Setup = CarSetupsPacket['carSetupData'][number];
type Band = { lo: number; hi: number };
/** A band the check expects: known, or unknown with its reason. */
type Expected = { known: true; value: Band } | { known: false; reason: string };
const has = (value: Band): Expected => ({ known: true, value });
type Config = typeof CAR_BANDS_CONFIG.defaults;
/**
 * One channel: our reading of it, the game's raw value, the band the config gives for the fitted tyre kind (the
 * pressure: for the player's latest setup row, unknown without one), and whether it has a live state (every channel but
 * the tyre surface and the brakes).
 */
type Channel = {
  name: string;
  reading: (b: CarBands) => BandReading;
  raw: (t: Telemetry) => number;
  band: (c: Config, kind: 'Dry' | 'Inter' | 'Wet', setup: Setup | undefined) => Expected;
  live: boolean;
};

/** The setup row's cold pressure of each corner, as step 1 maps it into `ownCar.setup.tyrePressurePsi`. */
const SETUP_PRESSURE = {
  fl: (s: Setup) => s.frontLeftTyrePressure,
  fr: (s: Setup) => s.frontRightTyrePressure,
  rl: (s: Setup) => s.rearLeftTyrePressure,
  rr: (s: Setup) => s.rearRightTyrePressure,
} as const;
/** The player's pressure band of `corner`: the setup's pressure minus and plus the config's offsets; unknown before a setup row. */
const pressureBand = (c: Config, corner: keyof typeof SETUP_PRESSURE, setup: Setup | undefined): Expected => {
  if (setup === undefined) return { known: false, reason: 'notReceived' };
  const psi = SETUP_PRESSURE[corner](setup);
  return has({ lo: psi - c.pressureBelowSetupPsi, hi: psi + c.pressureAboveSetupPsi });
};

const tyreBand = (c: Config, kind: 'Dry' | 'Inter' | 'Wet', channel: 'surface' | 'carcass'): Expected => has({ lo: c[`${channel}${kind}Lo`], hi: c[`${channel}${kind}Hi`] });
const CHANNELS: Channel[] = [
  ...GAME_ORDER.flatMap((corner, wheel): Channel[] => [
    { name: `surface.${corner}`, reading: (b) => b.tyres[corner].surfaceC, raw: (t) => t.tyresSurfaceTemperature[wheel]!, band: (c, k) => tyreBand(c, k, 'surface'), live: false },
    { name: `carcass.${corner}`, reading: (b) => b.tyres[corner].carcassC, raw: (t) => t.tyresInnerTemperature[wheel]!, band: (c, k) => tyreBand(c, k, 'carcass'), live: true },
    { name: `pressure.${corner}`, reading: (b) => b.tyres[corner].pressurePsi, raw: (t) => t.tyresPressure[wheel]!, band: (c, _k, s) => pressureBand(c, corner, s), live: true },
    { name: `brakes.${corner}`, reading: (b) => b.brakesC[corner], raw: (t) => t.brakesTemperature[wheel]!, band: (c) => has({ lo: c.brakeLo, hi: c.brakeHi }), live: false },
  ]),
  { name: 'engine', reading: (b) => b.engineC, raw: (t) => t.engineTemperature, band: (c) => has({ lo: 0, hi: c.engineHi }), live: true },
];
const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/** Where the config puts a value against a band; `car-bands` has no hysteresis or debounce (stateless, ruling R1). */
const expectedState = (value: number, { lo, hi }: Band): BandState => (value < lo ? 'below' : value > hi ? 'above' : 'in');

/**
 * What the check saw: how often car-bands ran, and the first channels that differed (`time channel: ours [value, state,
 * band] game [...]`; another car's pressure as `time car <id> pressure.<corner>: ours [state, band]`: an unknown state, a
 * band unknown with `notReceived`).
 */
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
  /** The player's latest setup row, as step 1 keeps it in `ownCar.setup`: a new player starts without one. */
  let setup: { car: number; row: Setup } | undefined;
  const observe = (state: DeepReadonly<EngineState>, scheduled: SchedulerResult, frame: Frame): void => {
    telemetry = frame.telemetry ?? telemetry;
    status = frame.status ?? status;
    const row = frame.setups?.carSetupData[frame.playerCarIndex];
    if (row) setup = { car: frame.playerCarIndex, row };
    if (!scheduled.ran.includes(CAR_BANDS) || telemetry === undefined || status === undefined) return;
    seen.runs++;
    const raw = telemetry.carTelemetryData[state.playerCar]!;
    const kind = TYRE_KIND[status.carStatusData[state.playerCar]!.visualTyreCompound] ?? 'Dry';
    const output = scheduled.outputs.get(CAR_BANDS) as CarBandsOutput;
    const bands = output[state.playerCar]!;
    const playerSetup = setup?.car === state.playerCar ? setup.row : undefined;
    for (const ch of CHANNELS) {
      const r = ch.reading(bands);
      const value = ch.raw(raw);
      const band = ch.band(config, kind, playerSetup);
      const ours = [r.value.known ? r.value.value : r.value.reason, r.state.known ? r.state.value : r.state.reason, r.band.known ? r.band.value : r.band.reason];
      const liveState = band.known ? expectedState(value, band.value) : band.reason;
      const game = [value, ch.live ? liveState : 'notApplicable', band.known ? band.value : band.reason];
      if (seen.off.length < 10 && JSON.stringify(ours) !== JSON.stringify(game)) {
        seen.off.push(`${state.sessionTime} ${ch.name}: ours ${JSON.stringify(ours)} game ${JSON.stringify(game)}`);
      }
    }
    // every other car: no setup, so its pressure band and live state are unknown
    for (const [id, other] of Object.entries(output)) {
      if (Number(id) === state.playerCar) continue;
      for (const corner of CORNERS) {
        const r = other.tyres[corner].pressurePsi;
        if (seen.off.length < 10 && (r.state.known || r.band.known || r.band.reason !== 'notReceived')) {
          const ours = [r.state.known ? r.state.value : `unknown ${r.state.reason}`, r.band.known ? r.band.value : r.band.reason];
          seen.off.push(`${state.sessionTime} car ${id} pressure.${corner}: ours ${JSON.stringify(ours)} game ["unknown","notReceived"]`);
        }
      }
    }
  };
  return { seen, observe };
}
