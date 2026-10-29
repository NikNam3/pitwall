// `race-moment` (spec 7): the one moment the race is in, from the neutralisation, the incidents, the forecast, our battles and our alarms.
// Stateless; race only.
import {
  known,
  unknown,
  type BattleCard,
  type BattleSide,
  type CarId,
  type IncidentEntry,
  type Insight,
  type Known,
  type Moment,
  type RaceMoment,
  type SessionTime,
} from '@pitwall/domain';
import type { QuickCalculator } from '@pitwall/engine';
import { ALARMS } from '../alarms/index.ts';
import { BATTLE, BATTLE_CONFIG, type BattleOutput } from '../battle/index.ts';
import { INCIDENTS } from '../incidents/index.ts';
import { RACE_MOMENT, RACE_MOMENT_CONFIG, type RaceMomentOutput } from './index.ts';

type Cause = Pick<RaceMoment, 'since' | 'cause'>;
const NOT_APPLICABLE = unknown('notApplicable');

/** A moment that holds: its cause. */
type Holding = [Moment, Cause];

/** The sides of every card, ahead before behind, with the car they belong to. */
function* sidesOf(cards: BattleOutput): Generator<{ carId: CarId; side: 'ahead' | 'behind'; value: BattleSide }> {
  for (const card of Object.values(cards) as BattleCard[]) {
    for (const side of ['ahead', 'behind'] as const) {
      const entry = card[side];
      if (entry.known) yield { carId: card.carId, side, value: entry.value };
    }
  }
}

const valueOf = (k: Known<number>): number | undefined => (k.known ? k.value : undefined);

/** The quick calculator behind `raceMoment.current`. */
export const raceMomentCalculator: QuickCalculator<RaceMomentOutput> = {
  id: RACE_MOMENT,
  kind: 'quick',
  reads: ['flagPhases', 'session', { calculator: INCIDENTS }, { calculator: BATTLE }, { calculator: ALARMS }],
  cadence: { hz: 4 },
  compute(view) {
    const { session, sessionTime: now } = view.state;
    if (session.kind !== 'race') return NOT_APPLICABLE;
    const cfg = RACE_MOMENT_CONFIG.read(view);
    const holding: Holding[] = [];

    const phase = view.activeFlagPhase;
    if (phase !== undefined) {
      holding.push(['neutralised', { since: known(phase.start, now), cause: { rule: 'flagPhase', params: { kind: phase.kind } } }]);
    }

    const incidents = (view.outputs.get(INCIDENTS) as readonly IncidentEntry[] | undefined) ?? [];
    let newest: IncidentEntry | undefined;
    for (const e of incidents) {
      const age = now - e.at;
      if (e.severity === 'major' && age >= 0 && age < cfg.incidentHoldMs && (newest === undefined || e.at > newest.at)) newest = e;
    }
    if (newest !== undefined) {
      holding.push(['incident', { since: known(newest.at as SessionTime, now), cause: { rule: 'majorIncident', params: { kind: newest.kind, ageMs: now - newest.at } } }]);
    }

    // the game sends the forecast of every session of the weekend: only this session's samples count
    const rainy = session.forecast.find(
      (s) => s.sessionType === session.sessionType && s.offsetMin >= 0 && s.offsetMin <= cfg.weatherHorizonMin && s.rainPct >= cfg.weatherRainPct,
    );
    if (rainy !== undefined) {
      holding.push(['weather', { since: NOT_APPLICABLE, cause: { rule: 'forecastRain', params: { rainPct: rainy.rainPct, offsetMin: rainy.offsetMin } } }]);
    }

    const { drsRangeMs } = BATTLE_CONFIG.read(view);
    const sides = [...sidesOf((view.outputs.get(BATTLE) as BattleOutput | undefined) ?? {})];
    // laps to DRS first: battle gives 0 for a gap already in range and counts a closing one down; the gap alone is
    // the fallback for a side whose laps to DRS are unknown
    const byLaps = sides.find((s) => (valueOf(s.value.lapsToDrs) ?? Infinity) <= cfg.battleLaps);
    const byGap = sides.find((s) => (valueOf(s.value.gapMs) ?? Infinity) <= drsRangeMs);
    const fight = byLaps ?? byGap;
    if (fight !== undefined) {
      const params: Record<string, number | string> = { carId: fight.carId, side: fight.side };
      const laps = valueOf(fight.value.lapsToDrs);
      const gap = valueOf(fight.value.gapMs);
      if (laps !== undefined) params.lapsToDrs = laps;
      if (gap !== undefined) params.gapMs = gap;
      holding.push(['battle', { since: NOT_APPLICABLE, cause: { rule: byLaps ? 'lapsToDrs' : 'gap', params } }]);
    }

    const alarms = (view.outputs.get(ALARMS) as readonly Insight[] | undefined) ?? [];
    const criticalAlarms = alarms.filter((a) => a.severity === 'critical' && a.resolvedAt === undefined).length;
    holding.push(['carCare', { since: NOT_APPLICABLE, cause: { rule: 'default', params: { criticalAlarms } } }]);

    const [[moment, cause]] = holding as [Holding, ...Holding[]];
    return known({ moment, ...cause, active: holding.map(([m]) => m) }, now);
  },
};
