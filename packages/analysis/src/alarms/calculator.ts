// The `alarms` calculator: the conditions that hold now for our cars, as insights (spec 5.6). Stateless; the InsightBook raises and resolves.
// Band advisories judge the last completed lap (see `bandChannels`), so they change at a lap's end only.
import type { PendingPenaltyDetail, TimePenaltyDetail, WarnedDetail, BandReading, CarBands, CarId, DamageState, FuelState, Insight, InsightCategory, Known, LapRecord, Range, TyreWear } from '@pitwall/domain';
import type { DeepReadonly, EngineView, QuickCalculator } from '@pitwall/engine/readers';
import { openSpansOf } from '@pitwall/engine/readers';
import { bandsFor, lastLaps, stateOf, type Band, type Bands } from '../car-bands/bands.ts';
import { CAR_BANDS, CAR_BANDS_CONFIG } from '../car-bands/index.ts';
import { DAMAGE } from '../damage/index.ts';
import { FUEL } from '../fuel/index.ts';
import { ourCars } from '../shared/our-cars.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { warningInCycle } from '../shared/penalties.ts';
import { TYRE_WEAR } from '../tyre-wear/index.ts';
import { ALARMS, ALARMS_BEHAVIOUR, ALARMS_CONFIG, type AlarmsOutput } from './index.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;
const TYRE_CHANNELS = [
  ['surfaceC', 'surface'],
  ['carcassC', 'carcass'],
  ['pressurePsi', 'pressure'],
] as const;

type Config = ReturnType<typeof ALARMS_CONFIG.read>;
type Make = (kind: string, severity: Insight['severity'], category: InsightCategory, channel: string, params: Insight['params']) => Insight;
type Lap = DeepReadonly<LapRecord>;

/** The one number of a lap's range the advisory judges: its maximum, or the middle of min and max (the lap record keeps no mean). */
type Measure = 'peak' | 'midRange';
const measured = (range: DeepReadonly<Range>, measure: Measure): number => (measure === 'peak' ? range.max : (range.min + range.max) / 2);

type BandChannel = {
  channel: string;
  category: InsightCategory;
  measure: Measure;
  /** Live, from `car-bands`: its `outForFullLap` raises the critical alarm. */
  reading: BandReading;
  /** The last completed lap: its number, its range of the channel and the band of its compound; they raise the advisory. */
  lap?: { lapNumber: number; range: DeepReadonly<Known<Range>>; band: Band };
};

/**
 * The band channels and the measure their advisory judges. Every advisory judges the car's last completed lap, never the
 * live value, so it changes at a lap's end only: the live values cross the band edges many times within a lap and a
 * calculator keeps no frame state for hysteresis (ruling R1). Within-lap swing of our cars, measured 2026-10-29 on
 * raceSingapore (lap 1, cars 19 and 14):
 * - brakes, `peak`: 500-940 °C swing per lap; judged under load.
 * - surface, `midRange`: 26-57 °C swing, up to 9 band crossings and 49 direction changes per lap.
 * - carcass, `midRange`: 1-6 °C swing in 1 °C steps, 0-3 direction changes per lap: a carcass at a band edge flickers.
 * - pressure, `midRange`: 0.1-0.4 psi swing after the first 20 s, 6-24 direction changes per lap.
 * - engine, `peak`: 110-116 °C (3 °C after the first 20 s) in 1 °C steps, 8 direction changes per lap.
 * Brake and engine temperatures are the `car` category, tyre channels `tyres`.
 */
const bandChannels = (bands: CarBands, lap: Lap | undefined, lapBands: Bands | undefined): BandChannel[] => {
  const range = lap?.channelRange;
  const on = (r: DeepReadonly<Known<Range>> | undefined, band: Band | undefined) =>
    lap && r && band ? { lap: { lapNumber: lap.lapNumber, range: r, band } } : {};
  return [
    ...CORNERS.flatMap((c) =>
      TYRE_CHANNELS.map(([t, kind]): BandChannel => ({
        channel: `tyre.${t}.${c}`,
        category: 'tyres',
        measure: 'midRange',
        reading: bands.tyres[c][t],
        ...on(range?.tyres[c][t], lapBands?.[kind]),
      })),
    ),
    ...CORNERS.map((c): BandChannel => ({
      channel: `brakesC.${c}`,
      category: 'car',
      measure: 'peak',
      reading: bands.brakesC[c],
      ...on(range?.brakesC[c], lapBands?.brakes),
    })),
    { channel: 'engineC', category: 'car', measure: 'peak', reading: bands.engineC, ...on(range?.engineC, lapBands?.engine) },
  ];
};

const bandAlarms = (bands: CarBands, lap: Lap | undefined, lapBands: Bands | undefined, make: Make): Insight[] =>
  bandChannels(bands, lap, lapBands).flatMap(({ channel, category, measure, reading, lap: judged }) => {
    // an unknown band judges nothing from this reading; Task 7 owns what an unknown pressure band means
    if (reading.outForFullLap && reading.band.known) {
      return [make('bandOutLap', 'critical', category, channel, { channel, lo: reading.band.value.lo, hi: reading.band.value.hi })];
    }
    if (judged === undefined || !judged.range.known) return [];
    const value = measured(judged.range.value, measure);
    const state = stateOf(value, judged.band);
    if (state === 'in') return [];
    const { lo, hi } = judged.band;
    return [make('bandOut', 'advisory', category, channel, { channel, state, value, lo, hi, lap: judged.lapNumber, measure })];
  });

const wearAlarms = (wear: TyreWear, config: Config, make: Make): Insight[] =>
  CORNERS.flatMap((corner) => {
    const { lapsToLimit, wearPct } = wear.corners[corner];
    if (!lapsToLimit.known || !wearPct.known || lapsToLimit.value >= config.wearLapsWarning) return [];
    return [
      make('wearLimitNear', 'critical', 'tyres', `wear.${corner}`, {
        corner,
        lapsToLimit: lapsToLimit.value,
        wearPct: wearPct.value,
        limitPct: wear.limitPct,
      }),
    ];
  });

const fuelAlarms = (fuel: FuelState, make: Make): Insight[] =>
  fuel.marginLaps.known && fuel.marginLaps.value < 0
    ? [make('fuelShort', 'critical', 'energy', 'fuel', { marginLaps: fuel.marginLaps.value })]
    : [];

const damageAlarms = (damage: DamageState, lap: number, make: Make): Insight[] =>
  damage.jumps
    .filter((j) => j.lap === lap)
    .map((j) => make('damageJump', 'critical', 'damage', String(j.at), { lap: j.lap, parts: j.parts.join(','), deltaPct: j.deltaPct }));

/**
 * One corner-cutting warning left before a penalty, by the count of the car's `warned` span. The game's count runs on
 * after a penalty, so this assumes a penalty every `warningsBeforePenalty` warnings (not verified against the game; `warningInCycle`).
 */
const warningAlarms = (view: EngineView, id: CarId, config: Config, make: Make): Insight[] => {
  if (!behaviourFor({ warnings: ALARMS_BEHAVIOUR.warnings }, view, id).some((row) => row.raises === 'warning')) return [];
  const warnings = (openSpansOf(view, 'warnings', id)[0]?.detail as WarnedDetail | undefined)?.count;
  return warnings !== undefined &&
    config.warningsBeforePenalty > 1 &&
    warnings > 0 &&
    warningInCycle(warnings, config.warningsBeforePenalty) === config.warningsBeforePenalty - 1
    ? [make('warningLast', 'advisory', 'race', 'warnings', { warnings, before: config.warningsBeforePenalty })]
    : [];
};

/** The frame of the car's latest completed lap; a penalty span opened on an earlier frame has resolved (C26: frames, never times). */
const lastLapFrame = (view: EngineView, id: CarId): number => {
  let frame = -Infinity;
  for (const l of view.history.laps) if (l.carId === id && l.frame > frame) frame = l.frame;
  return frame;
};

/** The penalty the car's open `penalties` span names; it resolves when the car completes a lap after the span opened. */
const penaltyAlarms = (view: EngineView, id: CarId, make: Make): Insight[] => {
  const rows = behaviourFor({ penalties: ALARMS_BEHAVIOUR.penalties }, view, id);
  const span = openSpansOf(view, 'penalties', id)[0];
  const row = rows[0];
  if (span === undefined || row === undefined || row.raises !== 'penalty' || span.startFrame <= lastLapFrame(view, id)) return [];
  const detail = span.detail as TimePenaltyDetail | PendingPenaltyDetail;
  const params: Record<string, number | string> =
    'driveThroughs' in detail
      ? { penalty: row.penalty, driveThroughs: detail.driveThroughs, stopGos: detail.stopGos, totalMs: detail.totalMs }
      : { penalty: row.penalty, totalMs: detail.totalMs };
  if ('infringement' in detail && detail.infringement.known) params['infringement'] = detail.infringement.value;
  return [make('penaltyNew', 'critical', 'race', String(span.id), params as Insight['params'])];
};

const alarmsOf = (view: EngineView, id: CarId, config: Config): Insight[] => {
  const make: Make = (kind, severity, category, channel, params) => ({
    key: `${kind}:${id}:${channel}`,
    severity,
    category,
    feedId: view.live.feedId,
    carId: id,
    kind,
    params,
    raisedAt: view.live.sessionTime,
  });
  const car = view.live.cars[id];
  if (car === undefined) return [];
  const pick = <T>(calculator: string) => (view.outputs.get(calculator) as Record<number, T> | undefined)?.[id];
  const bands = pick<CarBands>(CAR_BANDS);
  const wear = pick<TyreWear>(TYRE_WEAR);
  const fuel = pick<FuelState>(FUEL);
  const damage = pick<DamageState>(DAMAGE);
  const lap = lastLaps(view.history.laps).get(id);
  const lapBands = lap && bandsFor(lap.visualCompound, CAR_BANDS_CONFIG.read(view));
  return [
    ...(bands ? bandAlarms(bands, lap, lapBands, make) : []),
    ...(wear ? wearAlarms(wear, config, make) : []),
    ...(fuel ? fuelAlarms(fuel, make) : []),
    ...(damage ? damageAlarms(damage, car.timing.lap, make) : []),
    ...warningAlarms(view, id, config, make),
    ...penaltyAlarms(view, id, make),
  ];
};

/** The active alarms of our cars (player and teammate); rivals and unknown data raise nothing. */
export const alarmsCalculator: QuickCalculator<AlarmsOutput> = {
  id: ALARMS,
  kind: 'quick',
  reads: [
    { calculator: TYRE_WEAR },
    { calculator: FUEL },
    { calculator: CAR_BANDS },
    { calculator: DAMAGE },
    'timing',
    'identity',
    'spans:warnings',
    'spans:penalties',
    'laps',
  ],
  cadence: { hz: 2 },
  compute(view) {
    const config = ALARMS_CONFIG.read(view);
    return ourCars(view.live).flatMap((id) => alarmsOf(view, id, config));
  },
  insights: (out) => out,
};
