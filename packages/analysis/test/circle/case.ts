// Built races for `circle` (SP4.3d spec §6.5): `rejoin`'s built races (`../rejoin/field.ts`: every car laps at one pace
// from its own start offset, so a car's time behind us is the difference of the offsets, modulo one of our laps), with
// what the circle reads besides: `rejoin`'s output on the same view (computed through its own guarded view), our lap
// records in the projection (since R15 the circle's lap is our rolling lap, so the tests use them to show records change
// nothing), the race's session phase (`racing`, or an open `neutralised` span under an SC or a VSC) and each car's status.
import { carId, type LapRecord, type OpenSpan } from '@pitwall/domain';
import type { EngineView } from '@pitwall/engine/readers';
import { lap, openNeutralisation } from '../../../../test-support/builders/index.ts';
import { rejoinCalculator } from '../../src/rejoin/calculator.ts';
import { REJOIN, type RejoinOutput } from '../../src/rejoin/index.ts';
import { guardedQuick } from '../situated.ts';
import { statusSpan, type StatusKind } from '../gaps/race.ts';
import { FIELD, NOW, PACE, rejoinCase, US, type Field, type RejoinCase } from './../rejoin/field.ts';

const rejoin = guardedQuick(rejoinCalculator);

/** Our car's start offset in the standard field (`FIELD`): it completes lap `n` at `5 000 + n × PACE`. */
export const OUR_OFFSET = 5_000;

/**
 * Our lap records up to `now`: lap 1 (the race's first lap, no pace lap: `lap-classes`) in `PACE + 1 000`, every later
 * lap in `PACE`; `over` changes a lap by its number.
 */
export function ourLaps(now: number = NOW, over: Record<number, Partial<LapRecord>> = {}, offset: number = OUR_OFFSET): LapRecord[] {
  const laps: LapRecord[] = [];
  for (let n = 1; offset + n * PACE <= now; n++) {
    const completedAt = offset + n * PACE;
    laps.push(lap({ carId: carId(US), lapNumber: n, lapTimeMs: n === 1 ? PACE + 1_000 : PACE, completedAt, frame: completedAt, ...over[n] }));
  }
  return laps;
}

/** What a circle view is built from: a rejoin case, plus the circle's own parts. */
export type CircleCase = RejoinCase & {
  /** Our lap records (default `ourLaps(now)`). */
  laps?: LapRecord[];
  /** An SC or a VSC open now (the race's open session phase is `neutralised`); default none (`racing`). */
  neutralised?: 'SC' | 'VSC';
  /** A car's status kind by car id (default every car `competing`). */
  status?: Record<number, StatusKind>;
};

/** The view `circle` sees: `rejoin`'s on the same view among its outputs. */
export function circleCase(o: CircleCase = {}): { view: EngineView; rejoin: RejoinOutput } {
  const now = o.now ?? NOW;
  const field: Field = o.field ?? FIELD;
  const base = rejoinCase({ ...o, field, now }).view;
  const byMachine: Record<string, readonly OpenSpan[]> = { ...(base.situation.byMachine as Record<string, readonly OpenSpan[]>) };
  if (o.neutralised !== undefined) byMachine['session-phase-race'] = [openNeutralisation({ kind: o.neutralised, start: now - 10_000, id: 4 })];
  if (o.status !== undefined) {
    const named = new Set(Object.keys(o.status).map(Number));
    byMachine['car-status'] = [...(byMachine['car-status'] ?? []).filter((s) => !named.has(s.carId as number)), ...Object.entries(o.status).map(([id, kind]) => statusSpan(Number(id), kind))];
  }
  const situated: EngineView = {
    ...base,
    situation: { ...base.situation, byMachine },
    history: { ...base.history, laps: o.laps ?? ourLaps(now) },
  };
  const rejoinOut = rejoin.compute(situated);
  const outputs = new Map<string, unknown>(situated.outputs);
  outputs.set(REJOIN, rejoinOut);
  return { view: { ...situated, outputs }, rejoin: rejoinOut };
}
