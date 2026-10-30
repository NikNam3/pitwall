// `car-bands` on real packets, on the full-lap segments race-zandvoort-full-lap and qualifying-singapore-full-lap
// (facts in fixtures/index.json): the player's channels, corners and units reach the bands as the game sends them.
// The engine plus car-bands; the expected values come from the raw packets, the bands from the config defaults.
import { beforeAll, describe, expect, it } from 'vitest';
import { CAR_BANDS, CAR_BANDS_CONFIG, carBandsCalculator, type BandState, type CarBandsOutput } from '@pitwall/analysis';
import type { BandReading, CarBands } from '@pitwall/domain';
import type { CarStatusPacket, CarTelemetryPacket } from '@pitwall/protocol';
import { replayScheduled } from './engine-replay.ts';
import { segmentPath } from './replay.ts';

/** The game's wheel order in every per-wheel array. */
const GAME_ORDER = ['rl', 'rr', 'fl', 'fr'] as const;
/** CarStatus `visualTyreCompound`: 7 inter, 8 wet; every other one is a slick. */
const TYRE_KIND: Record<number, 'Inter' | 'Wet'> = { 7: 'Inter', 8: 'Wet' };

type Telemetry = CarTelemetryPacket['carTelemetryData'][number];
type Band = { lo: number; hi: number };
/** One channel: our reading of it, the game's raw value and the band the config gives for the fitted tyre kind. */
type Channel = { name: string; reading: (b: CarBands) => BandReading; raw: (t: Telemetry) => number; band: (kind: 'Dry' | 'Inter' | 'Wet') => Band };

const c = CAR_BANDS_CONFIG.defaults;
const tyreBand = (kind: 'Dry' | 'Inter' | 'Wet', channel: 'surface' | 'carcass'): Band => ({ lo: c[`${channel}${kind}Lo`], hi: c[`${channel}${kind}Hi`] });
const CHANNELS: Channel[] = [
  ...GAME_ORDER.flatMap((corner, wheel): Channel[] => [
    { name: `surface.${corner}`, reading: (b) => b.tyres[corner].surfaceC, raw: (t) => t.tyresSurfaceTemperature[wheel]!, band: (k) => tyreBand(k, 'surface') },
    { name: `carcass.${corner}`, reading: (b) => b.tyres[corner].carcassC, raw: (t) => t.tyresInnerTemperature[wheel]!, band: (k) => tyreBand(k, 'carcass') },
    { name: `pressure.${corner}`, reading: (b) => b.tyres[corner].pressurePsi, raw: (t) => t.tyresPressure[wheel]!, band: () => ({ lo: c.pressureLo, hi: c.pressureHi }) },
    { name: `brakes.${corner}`, reading: (b) => b.brakesC[corner], raw: (t) => t.brakesTemperature[wheel]!, band: () => ({ lo: c.brakeLo, hi: c.brakeHi }) },
  ]),
  { name: 'engine', reading: (b) => b.engineC, raw: (t) => t.engineTemperature, band: () => ({ lo: 0, hi: c.engineHi }) },
];

/** Where the config puts a value against a band; `car-bands` has no hysteresis or debounce (stateless, ruling R1). */
const expectedState = (value: number, { lo, hi }: Band): BandState => (value < lo ? 'below' : value > hi ? 'above' : 'in');

/**
 * On every run of car-bands, each of the player's channels against what the latest packets and the config give:
 * `channel: ours [value, state, band] game [value, state, band]` for each one that differs.
 */
async function mismatches(file: string): Promise<{ runs: number; off: string[] }> {
  const off: string[] = [];
  let runs = 0;
  let telemetry: CarTelemetryPacket | undefined;
  let status: CarStatusPacket | undefined;
  await replayScheduled(segmentPath(file), [carBandsCalculator], ({ state }, scheduled, frame) => {
    telemetry = frame.telemetry ?? telemetry;
    status = frame.status ?? status;
    if (!scheduled.ran.includes(CAR_BANDS) || telemetry === undefined || status === undefined) return;
    runs++;
    const raw = telemetry.carTelemetryData[state.playerCar]!;
    const kind = TYRE_KIND[status.carStatusData[state.playerCar]!.visualTyreCompound] ?? 'Dry';
    const bands = (scheduled.outputs.get(CAR_BANDS) as CarBandsOutput)[state.playerCar]!;
    for (const ch of CHANNELS) {
      const r = ch.reading(bands);
      const value = ch.raw(raw);
      const band = ch.band(kind);
      const ours = [r.value.known ? r.value.value : r.value.reason, r.state.known ? r.state.value : r.state.reason, r.band];
      const game = [value, expectedState(value, band), band];
      if (JSON.stringify(ours) !== JSON.stringify(game)) off.push(`${state.sessionTime} ${ch.name}: ours ${JSON.stringify(ours)} game ${JSON.stringify(game)}`);
    }
  });
  return { runs, off: off.slice(0, 10) };
}

/** Replays the segment in a `beforeAll` (the replay is the slow part) and checks it in one test. */
function describeSegment(file: string, name: string): void {
  describe(`${file}: each of the player's channels is the game's value of its corner, against the config's band`, () => {
    const seen: { runs: number; off: string[] } = { runs: 0, off: [] };
    beforeAll(async () => Object.assign(seen, await mismatches(file)));

    it(name, () => {
      expect(seen.runs).toBeGreaterThan(0);
      expect(seen.off).toEqual([]);
    });
  });
}

describeSegment('race-zandvoort-full-lap.pwrec.gz', 'on every run of car-bands, every channel and corner carries the packet value, the band of the fitted slick and its state');
describeSegment('qualifying-singapore-full-lap.pwrec.gz', 'on every run of car-bands, every channel and corner carries the packet value, the band of the fitted slick and its state');
