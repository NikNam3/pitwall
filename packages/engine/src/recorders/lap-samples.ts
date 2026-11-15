import type { ChannelRange, DamageParts, Known, LapRecord, SessionTime, TyreSet } from '@pitwall/domain';
import { known, unknown } from '../util/hot-domain.ts';
import { CORNER_NAMES, mapCorners, type CornerName } from '../step/corners.ts';
import type { DeepReadonly } from '../util/deep-readonly.ts';
import type { LiveCar } from './cars.ts';
import type { LapCursor } from './lap-cursor.ts';

export type LapStartSamples = Pick<LapRecord, 'wearAtStartPct' | 'ersStoreAtStartJ'>;
export type LapEndSamples = Pick<LapRecord, 'wearAtEndPct' | 'ersStoreAtEndJ' | 'ersDeployedJ' | 'ersHarvestedJ' | 'damageAtEnd' | 'channelRange' | 'tyreSets' | 'carcassMeanC'>;

type Reading = (car: LiveCar) => Known<number>;

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

/** A cursor's channel accumulators: nothing seen yet (min above max, no carcass sample). */
export const emptyChannels = (): Pick<LapCursor, 'channelMin' | 'channelMax' | 'carcassSumC' | 'carcassCount'> => ({
  channelMin: CHANNELS.map(() => Infinity),
  channelMax: CHANNELS.map(() => -Infinity),
  carcassSumC: CORNER_NAMES.map(() => 0),
  carcassCount: CORNER_NAMES.map(() => 0),
});

/** Folds one channel's reading into the cursor's range of channel `i`. */
const observeChannel = (cursor: LapCursor, i: number, reading: DeepReadonly<Known<number>>): void => {
  if (!reading.known) return;
  if (reading.value < (cursor.channelMin[i] ?? Infinity)) cursor.channelMin[i] = reading.value;
  if (reading.value > (cursor.channelMax[i] ?? -Infinity)) cursor.channelMax[i] = reading.value;
};

/** Folds the frame's channel values and ERS totals into the lap. Runs per car and frame: comparisons only, no allocation. */
export const observeLapFrame = (cursor: LapCursor, car: LiveCar): void => {
  // The channels of `CHANNELS`, in its order, read directly.
  for (let c = 0; c < CORNER_NAMES.length; c++) {
    const corner = CORNER_NAMES[c] as CornerName;
    const tyre = car.tyres.corners[corner];
    const first = TYRE_CHANNELS_PER_CORNER * c;
    observeChannel(cursor, first, tyre.surfaceTempC);
    observeChannel(cursor, first + 1, tyre.carcassTempC);
    if (tyre.carcassTempC.known) {
      cursor.carcassSumC[c] = (cursor.carcassSumC[c] ?? 0) + tyre.carcassTempC.value;
      cursor.carcassCount[c] = (cursor.carcassCount[c] ?? 0) + 1;
    }
    observeChannel(cursor, first + 2, tyre.pressurePsi);
    observeChannel(cursor, BRAKE_CHANNEL_0 + c, car.condition.brakes[corner].tempC);
  }
  observeChannel(cursor, ENGINE_CHANNEL, car.condition.engineTempC);
  const { ers } = car.energy;
  if (ers.known) {
    cursor.ersDeployedJ = ers.value.deployedJ;
    cursor.ersHarvestedJ = ers.value.harvestedMgukJ + ers.value.harvestedMguhJ;
  }
};

/** The car's damage as one value; unknown when any of the eight parts is. */
export const damageOf = (car: LiveCar, at: SessionTime): Known<DamageParts> => {
  const { bodywork, powerUnit } = car.condition;
  if (!bodywork.known) return unknown(bodywork.reason);
  if (!powerUnit.known) return unknown(powerUnit.reason);
  return known({ ...bodywork.value, gearboxPct: powerUnit.value.gearboxDamagePct, enginePct: powerUnit.value.engineDamagePct }, at);
};

/** A total seen during the lap, or why there is none: the car's own reason, `notReceived` if it never had a value. */
const total = (value: number | undefined, ers: LiveCar['energy']['ers'], at: SessionTime): Known<number> => {
  if (value !== undefined) return known(value, at);
  return unknown(ers.known ? 'notReceived' : ers.reason);
};

/** A channel's range over the lap; unknown when no frame had it or the engine joined the lap after its start (part of a lap is no lap). */
const rangeAt = (cursor: LapCursor, i: number, car: LiveCar, at: SessionTime): Known<{ min: number; max: number }> => {
  const min = cursor.channelMin[i] ?? Infinity;
  const max = cursor.channelMax[i] ?? -Infinity;
  if (cursor.fromStart && min <= max) return known({ min, max }, at);
  const reading = CHANNELS[i]?.(car);
  return unknown(reading && !reading.known ? reading.reason : 'notReceived');
};

const channelRange = (cursor: LapCursor, car: LiveCar, at: SessionTime): ChannelRange => {
  const range = (i: number) => rangeAt(cursor, i, car, at);
  const tyres = mapCorners((corner) => {
    const first = TYRE_CHANNELS_PER_CORNER * CORNER_NAMES.indexOf(corner);
    return { surfaceC: range(first), carcassC: range(first + 1), pressurePsi: range(first + 2) };
  });
  const brakesC = mapCorners((corner) => range(BRAKE_CHANNEL_0 + CORNER_NAMES.indexOf(corner)));
  return { tyres, brakesC, engineC: range(ENGINE_CHANNEL) };
};

/**
 * A corner's mean carcass temperature over the frames of the lap seen (also of a lap joined after its start). The live
 * reading's reason when the game sends none (`notApplicable`, surface only) or realism hides it (`realism`);
 * `insufficientData` when no frame of the lap had it.
 */
const carcassMean = (cursor: LapCursor, car: LiveCar, at: SessionTime): LapRecord['carcassMeanC'] =>
  mapCorners((corner) => {
    const reading = car.tyres.corners[corner].carcassTempC;
    if (!reading.known && (reading.reason === 'notApplicable' || reading.reason === 'realism')) return unknown(reading.reason);
    const c = CORNER_NAMES.indexOf(corner);
    const count = cursor.carcassCount[c] ?? 0;
    return count > 0 ? known((cursor.carcassSumC[c] ?? 0) / count, at) : unknown('insufficientData');
  });

/** The car's tyre sets as the live state has them at the lap end, in the game's order; its own reason when unknown (C8). */
const tyreSetsOf = (car: LiveCar, at: SessionTime): Known<TyreSet[]> =>
  car.tyres.sets.known ? known(car.tyres.sets.value.sets.slice(), at) : unknown(car.tyres.sets.reason);

const ersStoreOf = (car: LiveCar, at: SessionTime): Known<number> =>
  car.energy.ers.known ? known(car.energy.ers.value.storeJ, at) : unknown(car.energy.ers.reason);

const unknownLapStart = (): LapStartSamples => {
  const none = unknown('notReceived');
  return { wearAtStartPct: mapCorners(() => none), ersStoreAtStartJ: none };
};

/** Wear and ERS store from the car state of the frame that starts the lap; `notReceived` when the engine joined the lap after its start. */
export const lapStartSamples = (car: LiveCar, at: SessionTime, fromStart: boolean): LapStartSamples => {
  if (!fromStart) return unknownLapStart();
  return { wearAtStartPct: mapCorners((corner) => car.tyres.corners[corner].wearPct), ersStoreAtStartJ: ersStoreOf(car, at) };
};

/**
 * What the car had at the end of the lap that `cursor` collected. Wear, ERS store and damage and the tyre sets are read from the
 * car state of the completing frame; the totals, ranges and carcass mean come from the frames of the lap. The completing frame itself is
 * not part of the lap's ranges and totals: its values belong to the next lap (the game has already reset the per-lap ERS counters in it).
 */
export const lapEndSamples = (cursor: LapCursor, car: LiveCar, at: SessionTime): LapEndSamples => ({
  wearAtEndPct: mapCorners((corner) => car.tyres.corners[corner].wearPct),
  ersStoreAtEndJ: ersStoreOf(car, at),
  ersDeployedJ: total(cursor.ersDeployedJ, car.energy.ers, at),
  ersHarvestedJ: total(cursor.ersHarvestedJ, car.energy.ers, at),
  damageAtEnd: damageOf(car, at),
  channelRange: channelRange(cursor, car, at),
  tyreSets: tyreSetsOf(car, at),
  carcassMeanC: carcassMean(cursor, car, at),
});

/**
 * The lap-start and lap-end samples of a lap they were never taken for (the engine never saw it, or it was stored before
 * they existed): all `notReceived`.
 */
export const unknownLapEnd = (): LapStartSamples & LapEndSamples => {
  const none = unknown('notReceived');
  return {
    ...unknownLapStart(),
    wearAtEndPct: mapCorners(() => none),
    ersStoreAtEndJ: none,
    ersDeployedJ: none,
    ersHarvestedJ: none,
    damageAtEnd: none,
    channelRange: { tyres: mapCorners(() => ({ surfaceC: none, carcassC: none, pressurePsi: none })), brakesC: mapCorners(() => none), engineC: none },
    tyreSets: none,
    carcassMeanC: mapCorners(() => none),
  };
};
