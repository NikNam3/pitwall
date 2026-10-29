// The `alarms` calculator: the conditions that hold now for our cars, as insights (spec 5.6). Stateless; the InsightBook raises and resolves.
import type { BandReading, CarBands, CarId, DamageState, FuelState, Insight, InsightCategory, TyreWear } from '@pitwall/domain';
import type { EngineView, QuickCalculator } from '@pitwall/engine';
import { CAR_BANDS } from '../car-bands/index.ts';
import { DAMAGE } from '../damage/index.ts';
import { ERS } from '../ers/index.ts';
import { FUEL } from '../fuel/index.ts';
import { penaltyClass } from '../shared/penalties.ts';
import { TYRE_WEAR } from '../tyre-wear/index.ts';
import { ALARMS, ALARMS_CONFIG, type AlarmsOutput } from './index.ts';

const CORNERS = ['fl', 'fr', 'rl', 'rr'] as const;
const TYRE_CHANNELS = ['surfaceC', 'carcassC', 'pressurePsi'] as const;

type Config = ReturnType<typeof ALARMS_CONFIG.read>;
type Make = (kind: string, severity: Insight['severity'], category: InsightCategory, channel: string, params: Insight['params']) => Insight;

const bandChannels = (bands: CarBands): { channel: string; category: InsightCategory; reading: BandReading }[] => [
  ...CORNERS.flatMap((c) =>
    TYRE_CHANNELS.map((t) => ({ channel: `tyre.${t}.${c}`, category: 'tyres' as const, reading: bands.tyres[c][t] })),
  ),
  ...CORNERS.map((c) => ({ channel: `brakesC.${c}`, category: 'damage' as const, reading: bands.brakesC[c] })),
  { channel: 'engineC', category: 'damage', reading: bands.engineC },
];

const bandAlarms = (bands: CarBands, make: Make): Insight[] =>
  bandChannels(bands).flatMap(({ channel, category, reading }) => {
    const { lo, hi } = reading.band;
    if (reading.outForFullLap) return [make('bandOutLap', 'critical', category, channel, { channel, lo, hi })];
    if (!reading.state.known || !reading.value.known || reading.state.value === 'in') return [];
    return [make('bandOut', 'advisory', category, channel, { channel, state: reading.state.value, value: reading.value.value, lo, hi })];
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

const warningAlarms = (warnings: number, config: Config, make: Make): Insight[] =>
  warnings > 0 && warnings === config.warningsBeforePenalty - 1
    ? [make('warningLast', 'advisory', 'race', 'warnings', { warnings, before: config.warningsBeforePenalty })]
    : [];

/** Real penalties (not warnings, reminders or lap invalidations) of the car after its latest completed lap; they resolve when it completes the next one. */
const penaltyAlarms = (view: EngineView, id: CarId, make: Make): Insight[] => {
  const { laps, events } = view.state.history;
  let lastLapAt = -Infinity;
  for (const l of laps) if (l.carId === id && l.completedAt > lastLapAt) lastLapAt = l.completedAt;
  return events
    .filter((e) => e.kind === 'penalty' && e.carId === id && e.at > lastLapAt && penaltyClass(e.params['penaltyType']) === 'penalty')
    .map((e) => make('penaltyNew', 'critical', 'race', String(e.at), e.params as Insight['params']));
};

const alarmsOf = (view: EngineView, id: CarId, config: Config): Insight[] => {
  const make: Make = (kind, severity, category, channel, params) => ({
    key: `${kind}:${id}:${channel}`,
    severity,
    category,
    feedId: view.state.feedId,
    carId: id,
    kind,
    params,
    raisedAt: view.state.sessionTime,
  });
  const car = view.state.cars[id];
  if (car === undefined) return [];
  const pick = <T>(calculator: string) => (view.outputs.get(calculator) as Record<number, T> | undefined)?.[id];
  const bands = pick<CarBands>(CAR_BANDS);
  const wear = pick<TyreWear>(TYRE_WEAR);
  const fuel = pick<FuelState>(FUEL);
  const damage = pick<DamageState>(DAMAGE);
  return [
    ...(bands ? bandAlarms(bands, make) : []),
    ...(wear ? wearAlarms(wear, config, make) : []),
    ...(fuel ? fuelAlarms(fuel, make) : []),
    ...(damage ? damageAlarms(damage, car.timing.lap, make) : []),
    ...warningAlarms(car.timing.cornerCuttingWarnings, config, make),
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
    { calculator: ERS },
    { calculator: CAR_BANDS },
    { calculator: DAMAGE },
    'timing',
    'events',
    'laps',
  ],
  cadence: { hz: 2 },
  compute(view) {
    const config = ALARMS_CONFIG.read(view);
    const { playerCar, teammateCar } = view.state;
    const ours = teammateCar === undefined || teammateCar === playerCar ? [playerCar] : [playerCar, teammateCar];
    return ours.flatMap((id) => alarmsOf(view, id, config));
  },
  insights: (out) => out,
};
