// `car-bands` against the raw packets, for the full-lap segment tests (race-full-lap, quali-full-lap): the player's
// channels, corners and units reach the bands as the game sends them. The expected values come from the latest
// CarTelemetry, CarStatus and CarSetups packets, the bands from the run's config over the defaults. The tyre surface and
// the brakes have no live state (rulings 2026-10-30: the surface swings 30-60 °C within a lap, the brakes fall below the
// band on many straights, so only the whole lap judges them). The carcass band is the car's actual compound's (CarStatus
// `actualTyreCompound`) reference temperature `- carcassBelowRefC` to `+ carcassAboveRefC`; the pressure band is the
// player's setup pressure per corner on that carcass band by the gas law, setup × (Tref − below + 273.15)/(Tref + 273.15)
// to setup × (Tref + above + 273.15)/(Tref + 273.15) (SP4.3c §5.6); a compound without a reference temperature has
// neither (`notApplicable`). Before the player's first CarSetups row the pressure band is unknown with the setup's own
// reason (`notReceived`), and so is its live state. Every other human car's pressure band is unknown (`notReceived`) and
// so its live state: the game's setup is read for the player's car only (Q5 A). A car no human drives (Participants
// `aiControlled`, as the car-driver span reads it) has `notApplicable` tyre bands and tyre live states.
import { CAR_BANDS, CAR_BANDS_CONFIG, type BandState, type CarBandsOutput } from '@pitwall/analysis';
import type { BandReading, CarBands } from '@pitwall/domain';
import type { DeepReadonly, EngineState, Frame, SchedulerResult } from '@pitwall/engine';
import type { CarSetupsPacket, CarStatusPacket, CarTelemetryPacket, ParticipantsPacket } from '@pitwall/protocol';

/** The game's wheel order in every per-wheel array. */
const GAME_ORDER = ['rl', 'rr', 'fl', 'fr'] as const;
/** CarStatus `visualTyreCompound`: 7 inter, 8 wet; every other one is a slick. */
const TYRE_KIND: Record<number, 'Inter' | 'Wet'> = { 7: 'Inter', 8: 'Wet' };
/** CarStatus `actualTyreCompound` → its reference-temperature config key: 20 C1 … 16 C5, 7 inter, 8 wet; no other one has one. */
const REF_TEMP_KEY: Record<number, 'refTempC1C' | 'refTempC2C' | 'refTempC3C' | 'refTempC4C' | 'refTempC5C' | 'refTempInterC' | 'refTempWetC'> = {
  20: 'refTempC1C',
  19: 'refTempC2C',
  18: 'refTempC3C',
  17: 'refTempC4C',
  16: 'refTempC5C',
  7: 'refTempInterC',
  8: 'refTempWetC',
};
const KELVIN = 273.15;

type Telemetry = CarTelemetryPacket['carTelemetryData'][number];
type Setup = CarSetupsPacket['carSetupData'][number];
type Band = { lo: number; hi: number };
/** A band the check expects: known, or unknown with its reason. */
type Expected = { known: true; value: Band } | { known: false; reason: string };
const has = (value: Band): Expected => ({ known: true, value });
const notApplicable: Expected = { known: false, reason: 'notApplicable' };
type Config = typeof CAR_BANDS_CONFIG.defaults;
/**
 * One channel: our reading of it, the game's raw value, the band the config gives for the fitted tyre (the surface by
 * its kind, the carcass by its actual compound, the pressure: for the player's latest setup row on that compound,
 * unknown without one), whether it has a live state (every channel but the tyre surface and the brakes), and whether it
 * is a tyre channel (judged only on a human's car).
 */
type Channel = {
  name: string;
  reading: (b: CarBands) => BandReading;
  raw: (t: Telemetry) => number;
  band: (c: Config, tyre: Tyre, setup: Setup | undefined) => Expected;
  live: boolean;
  tyre: boolean;
};
/** The fitted tyre: its kind (the surface band's) and its actual compound's CarStatus code (the carcass band's). */
type Tyre = { kind: 'Dry' | 'Inter' | 'Wet'; actual: number };

/** The setup row's cold pressure of each corner, as step 1 maps it into `ownCar.setup.tyrePressurePsi`. */
const SETUP_PRESSURE = {
  fl: (s: Setup) => s.frontLeftTyrePressure,
  fr: (s: Setup) => s.frontRightTyrePressure,
  rl: (s: Setup) => s.rearLeftTyrePressure,
  rr: (s: Setup) => s.rearRightTyrePressure,
} as const;
/** The reference carcass temperature of the actual compound `code`, or none. */
const refTemp = (c: Config, code: number): number | undefined => {
  const key = REF_TEMP_KEY[code];
  return key === undefined ? undefined : c[key];
};
/**
 * The player's pressure band of `corner`: the setup's pressure on the compound's carcass band by the gas law; unknown
 * before a setup row (`notReceived`) and for a compound without a reference temperature (`notApplicable`).
 */
const pressureBand = (c: Config, corner: keyof typeof SETUP_PRESSURE, actual: number, setup: Setup | undefined): Expected => {
  if (setup === undefined) return { known: false, reason: 'notReceived' };
  const ref = refTemp(c, actual);
  if (ref === undefined) return notApplicable;
  const t = ref + KELVIN;
  const psi = SETUP_PRESSURE[corner](setup);
  return has({ lo: psi * ((t - c.carcassBelowRefC) / t), hi: psi * ((t + c.carcassAboveRefC) / t) });
};
/** The carcass band of the actual compound `code`: its reference temperature minus and plus the config's offsets. */
const carcassBand = (c: Config, actual: number): Expected => {
  const ref = refTemp(c, actual);
  return ref === undefined ? notApplicable : has({ lo: ref - c.carcassBelowRefC, hi: ref + c.carcassAboveRefC });
};
const surfaceBand = (c: Config, kind: 'Dry' | 'Inter' | 'Wet'): Expected => has({ lo: c[`surface${kind}Lo`], hi: c[`surface${kind}Hi`] });
const CHANNELS: Channel[] = [
  ...GAME_ORDER.flatMap((corner, wheel): Channel[] => [
    { name: `surface.${corner}`, reading: (b) => b.tyres[corner].surfaceC, raw: (t) => t.tyresSurfaceTemperature[wheel]!, band: (c, y) => surfaceBand(c, y.kind), live: false, tyre: true },
    { name: `carcass.${corner}`, reading: (b) => b.tyres[corner].carcassC, raw: (t) => t.tyresInnerTemperature[wheel]!, band: (c, y) => carcassBand(c, y.actual), live: true, tyre: true },
    { name: `pressure.${corner}`, reading: (b) => b.tyres[corner].pressurePsi, raw: (t) => t.tyresPressure[wheel]!, band: (c, y, s) => pressureBand(c, corner, y.actual, s), live: true, tyre: true },
    { name: `brakes.${corner}`, reading: (b) => b.brakesC[corner], raw: (t) => t.brakesTemperature[wheel]!, band: (c) => has({ lo: c.brakeLo, hi: c.brakeHi }), live: false, tyre: false },
  ]),
  { name: 'engine', reading: (b) => b.engineC, raw: (t) => t.engineTemperature, band: (c) => has({ lo: 0, hi: c.engineHi }), live: true, tyre: false },
];
const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;

/** Where the config puts a value against a band; `car-bands` has no hysteresis or debounce (stateless, ruling R1). */
const expectedState = (value: number, { lo, hi }: Band): BandState => (value < lo ? 'below' : value > hi ? 'above' : 'in');

/**
 * What the check saw: how often car-bands ran, and the first channels that differed (`time channel: ours [value, state,
 * band] game [...]`; another car's tyre channel as `time car <id> <channel>.<corner>: ours [state, band] game [...]`: an
 * unknown state and band, `notReceived` for a human's pressure, `notApplicable` for an AI car's).
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
  let participants: ParticipantsPacket | undefined;
  /** Whether a human drives `car`: a car-driver `human` span, from the latest Participants packet (`aiControlled` 0, a slot in use). */
  const human = (car: number): boolean => {
    const p = participants?.participants[car];
    return participants !== undefined && p !== undefined && car < participants.numActiveCars && p.aiControlled === 0;
  };
  const observe = (state: DeepReadonly<EngineState>, scheduled: SchedulerResult, frame: Frame): void => {
    telemetry = frame.telemetry ?? telemetry;
    status = frame.status ?? status;
    participants = frame.participants ?? participants;
    const row = frame.setups?.carSetupData[frame.playerCarIndex];
    if (row) setup = { car: frame.playerCarIndex, row };
    if (!scheduled.ran.includes(CAR_BANDS) || telemetry === undefined || status === undefined) return;
    seen.runs++;
    const raw = telemetry.carTelemetryData[state.playerCar]!;
    const carStatus = status.carStatusData[state.playerCar]!;
    const tyre: Tyre = { kind: TYRE_KIND[carStatus.visualTyreCompound] ?? 'Dry', actual: carStatus.actualTyreCompound };
    const playerHuman = human(state.playerCar);
    const output = scheduled.outputs.get(CAR_BANDS) as CarBandsOutput;
    const bands = output[state.playerCar]!;
    const playerSetup = setup?.car === state.playerCar ? setup.row : undefined;
    for (const ch of CHANNELS) {
      const r = ch.reading(bands);
      const value = ch.raw(raw);
      const judged = !ch.tyre || playerHuman;
      const band = judged ? ch.band(config, tyre, playerSetup) : notApplicable;
      const ours = [r.value.known ? r.value.value : r.value.reason, r.state.known ? r.state.value : r.state.reason, r.band.known ? r.band.value : r.band.reason];
      const liveState = band.known ? expectedState(value, band.value) : band.reason;
      const game = [value, ch.live && judged ? liveState : 'notApplicable', band.known ? band.value : band.reason];
      if (seen.off.length < 10 && JSON.stringify(ours) !== JSON.stringify(game)) {
        seen.off.push(`${state.sessionTime} ${ch.name}: ours ${JSON.stringify(ours)} game ${JSON.stringify(game)}`);
      }
    }
    // every other car: a human's has no setup, so its pressure band and live state are unknown (`notReceived`); an AI
    // car's tyre channels are not judged (`notApplicable`)
    for (const [id, other] of Object.entries(output)) {
      if (Number(id) === state.playerCar) continue;
      const isHuman = human(Number(id));
      for (const corner of CORNERS) {
        const channels = isHuman ? (['pressurePsi'] as const) : (['surfaceC', 'carcassC', 'pressurePsi'] as const);
        for (const channel of channels) {
          const r = other.tyres[corner][channel];
          const reason = isHuman ? 'notReceived' : 'notApplicable';
          const stateReason = isHuman ? undefined : 'notApplicable';
          const off = r.state.known || r.band.known || r.band.reason !== reason || (stateReason !== undefined && r.state.reason !== stateReason);
          if (seen.off.length < 10 && off) {
            const ours = [r.state.known ? r.state.value : `unknown ${r.state.reason}`, r.band.known ? r.band.value : r.band.reason];
            seen.off.push(`${state.sessionTime} car ${id} ${channel}.${corner}: ours ${JSON.stringify(ours)} game ["unknown","${reason}"]`);
          }
        }
      }
    }
  };
  return { seen, observe };
}
