// `race-moment` (spec 7): the one moment the race is in, from the neutralisation, the incidents, the rain outlook, our battles and our alarms.
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
import { openSpansOf, type QuickCalculator } from '@pitwall/engine/readers';
import { ALARMS } from '../alarms/index.ts';
import { BATTLE, BATTLE_CONFIG, type BattleOutput } from '../battle/index.ts';
import { INCIDENTS, type IncidentsOutput } from '../incidents/index.ts';
import { PIT_WINDOW, type PitWindowOutput } from '../pit-window/index.ts';
import { RAIN_OUTLOOK, type RainOutlook } from '../rain-outlook/index.ts';
import { behaviourFor } from '../shared/behaviour.ts';
import { ourCars } from '../shared/our-cars.ts';
import { neutralisationKind } from '../shared/neutralised.ts';
import { RACE_MOMENT, RACE_MOMENT_BEHAVIOUR, RACE_MOMENT_CONFIG, type RaceMomentOutput } from './index.ts';

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
  reads: ['identity', 'spans:weekend-phase', 'spans:session-phase-race', { calculator: INCIDENTS }, { calculator: BATTLE }, { calculator: ALARMS }, { calculator: RAIN_OUTLOOK }, { calculator: PIT_WINDOW }],
  cadence: { hz: 4 },
  compute(view) {
    const now = view.live.sessionTime;
    // a pending weekend phase (no span yet, C14): whether the session is a race is not known yet (C3)
    if (openSpansOf(view, 'weekend-phase').length === 0) return unknown('notReceived');
    const rows = behaviourFor(RACE_MOMENT_BEHAVIOUR, view);
    if (!rows.some((row) => row.applicable === true)) return NOT_APPLICABLE;
    const cfg = RACE_MOMENT_CONFIG.read(view);
    const holding: Holding[] = [];

    // the neutralisation open now: the machine's situation (C46), pending its confirmation or not
    const open = rows.some((row) => row.neutralised === true) ? openSpansOf(view, 'session-phase-race')[0] : undefined;
    if (open !== undefined) {
      holding.push(['neutralised', { since: known(open.start, now), cause: { rule: 'flagPhase', params: { kind: neutralisationKind(open) } } }]);
    }

    const incidents = (view.outputs.get(INCIDENTS) as IncidentsOutput | undefined)?.feed ?? [];
    let newest: IncidentEntry | undefined;
    for (const e of incidents) {
      const age = now - e.at;
      if (e.severity === 'major' && age >= 0 && age < cfg.incidentHoldMs && (newest === undefined || e.at > newest.at)) newest = e;
    }
    if (newest !== undefined) {
      holding.push(['incident', { since: known(newest.at as SessionTime, now), cause: { rule: 'majorIncident', params: { entryId: newest.id, kind: newest.kind, ageMs: now - newest.at } } }]);
    }

    // the pit window is pit-window's judgement (C43): the first of our cars, player first, whose window is lead or open
    const windows = (view.outputs.get(PIT_WINDOW) as PitWindowOutput | undefined) ?? {};
    for (const id of ourCars(view.live)) {
      const w = windows[id];
      if (w === undefined || !w.known || !w.value.window.known) continue;
      const state = w.value.window.value;
      if (state !== 'lead' && state !== 'open') continue;
      const params: Record<string, number | string> = { carId: id };
      if (w.value.windowCompound.known) params.compound = w.value.windowCompound.value;
      holding.push(['window', { since: NOT_APPLICABLE, cause: { rule: 'pitWindow', params } }]);
      break;
    }

    // "rain is coming" is rain-outlook's judgement (C43): its first rain, when within its horizon
    const outlook = view.outputs.get(RAIN_OUTLOOK) as RainOutlook | undefined;
    if (outlook?.withinHorizon === true && outlook.firstRain.known) {
      const { rainPct, offsetMin } = outlook.firstRain.value;
      holding.push(['weather', { since: NOT_APPLICABLE, cause: { rule: 'forecastRain', params: { rainPct, offsetMin } } }]);
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
