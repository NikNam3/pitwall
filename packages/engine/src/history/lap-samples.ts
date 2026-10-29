import { known, unknown, type CarState, type ChannelRange, type DamageParts, type Known, type LapRecord, type SessionTime } from '@pitwall/domain';
import type { LapCursor } from '../state/engine-state.ts';
import { CORNER_NAMES, mapCorners } from '../step/corners.ts';

export type LapEndSamples = Pick<LapRecord, 'wearAtEndPct' | 'ersStoreAtEndJ' | 'ersDeployedJ' | 'ersHarvestedJ' | 'damageAtEnd' | 'channelRange'>;

type Reading = (car: CarState) => Known<number>;

/** Every band channel in the order of the cursor's `channelMin`/`channelMax`: 3 per tyre corner, 1 per brake, then the engine. */
const CHANNELS: readonly Reading[] = [
  ...CORNER_NAMES.flatMap((c): Reading[] => [
    (car) => car.tyres.corners[c].surfaceTempC,
    (car) => car.tyres.corners[c].carcassTempC,
    (car) => car.tyres.corners[c].pressurePsi,
  ]),
  ...CORNER_NAMES.map((c): Reading => (car) => car.condition.brakes[c].tempC),
  (car) => car.condition.engineTempC,
];

/** Where each group of `CHANNELS` starts: the tyre corners' three, the brakes, the engine. */
const TYRE_CHANNELS_PER_CORNER = 3;
const BRAKE_CHANNEL_0 = TYRE_CHANNELS_PER_CORNER * CORNER_NAMES.length;
const ENGINE_CHANNEL = BRAKE_CHANNEL_0 + CORNER_NAMES.length;

/** A cursor's channel accumulators: nothing seen yet (min above max). */
export const emptyChannels = (): Pick<LapCursor, 'channelMin' | 'channelMax'> => ({
  channelMin: CHANNELS.map(() => Infinity),
  channelMax: CHANNELS.map(() => -Infinity),
});

/** Folds the frame's channel values and ERS totals into the lap. Runs per car and frame: comparisons only, no allocation. */
export const observeLapFrame = (cursor: LapCursor, car: CarState): void => {
  const { channelMin, channelMax } = cursor;
  for (let i = 0; i < CHANNELS.length; i++) {
    const reading = CHANNELS[i]?.(car);
    if (!reading?.known) continue;
    if (reading.value < (channelMin[i] ?? Infinity)) channelMin[i] = reading.value;
    if (reading.value > (channelMax[i] ?? -Infinity)) channelMax[i] = reading.value;
  }
  const { ers } = car.energy;
  if (ers.known) {
    cursor.ersDeployedJ = ers.value.deployedJ;
    cursor.ersHarvestedJ = ers.value.harvestedMgukJ + ers.value.harvestedMguhJ;
  }
};

/** The car's damage as one value; unknown when any of the eight parts is. */
export const damageOf = (car: CarState, at: SessionTime): Known<DamageParts> => {
  const { bodywork, powerUnit } = car.condition;
  if (!bodywork.known) return unknown(bodywork.reason);
  if (!powerUnit.known) return unknown(powerUnit.reason);
  return known({ ...bodywork.value, gearboxPct: powerUnit.value.gearboxDamagePct, enginePct: powerUnit.value.engineDamagePct }, at);
};

/** A total seen during the lap, or why there is none: the car's own reason, `notReceived` if it never had a value. */
const total = (value: number | undefined, ers: CarState['energy']['ers'], at: SessionTime): Known<number> => {
  if (value !== undefined) return known(value, at);
  return unknown(ers.known ? 'notReceived' : ers.reason);
};

const rangeAt = (cursor: LapCursor, i: number, car: CarState, at: SessionTime): Known<{ min: number; max: number }> => {
  const min = cursor.channelMin[i] ?? Infinity;
  const max = cursor.channelMax[i] ?? -Infinity;
  if (min <= max) return known({ min, max }, at);
  const reading = CHANNELS[i]?.(car);
  return unknown(reading && !reading.known ? reading.reason : 'notReceived');
};

const channelRange = (cursor: LapCursor, car: CarState, at: SessionTime): ChannelRange => {
  const range = (i: number) => rangeAt(cursor, i, car, at);
  const tyres = mapCorners((corner) => {
    const first = TYRE_CHANNELS_PER_CORNER * CORNER_NAMES.indexOf(corner);
    return { surfaceC: range(first), carcassC: range(first + 1), pressurePsi: range(first + 2) };
  });
  const brakesC = mapCorners((corner) => range(BRAKE_CHANNEL_0 + CORNER_NAMES.indexOf(corner)));
  return { tyres, brakesC, engineC: range(ENGINE_CHANNEL) };
};

/**
 * What the car had at the end of the lap that `cursor` collected. Wear, ERS store and damage are read from the car state
 * of the completing frame; the totals and ranges come from the frames of the lap. The completing frame itself is
 * not part of the lap's ranges and totals: its values belong to the next lap (the game has already reset the per-lap ERS counters in it).
 */
export const lapEndSamples = (cursor: LapCursor, car: CarState, at: SessionTime): LapEndSamples => ({
  wearAtEndPct: mapCorners((corner) => car.tyres.corners[corner].wearPct),
  ersStoreAtEndJ: car.energy.ers.known ? known(car.energy.ers.value.storeJ, at) : unknown(car.energy.ers.reason),
  ersDeployedJ: total(cursor.ersDeployedJ, car.energy.ers, at),
  ersHarvestedJ: total(cursor.ersHarvestedJ, car.energy.ers, at),
  damageAtEnd: damageOf(car, at),
  channelRange: channelRange(cursor, car, at),
});
