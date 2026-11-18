// The C62 preselection rule (SP4.3e spec §4.2, Task 7a-1): per kind (practice, qualifying) the newer of the own weekend's
// earlier sessions of that kind of the seat and the team's last confirmed choice of that kind on the track; neither: none.
// A pure function of the stored rows and the last choice: no storage, no data dir (C84).
import { describe, expect, it } from 'vitest';
import { NO_BASIS, carId, known, type SessionRef, type WeekendPhaseKind } from '@pitwall/domain';
import { preselect } from '../../src/pipeline/session-basis.ts';
import type { LastChoice } from '../../src/pipeline/last-choice-types.ts';
import type { StoredSessionRow } from '../../src/storage/db.ts';

const WEEKEND = '111';
const NEW_LOBBY = '222';
const TRACK = 26;
const MERCEDES = { teamId: 0, raceNumber: 44 };

const iso = (day: number, hhmm: string): string => `2026-11-${String(day).padStart(2, '0')}T${hhmm}:00.000Z`;

/**
 * An own-weekend stored session of the seat. `kind` (the session's weekend-phase kind) is the field this task needs on
 * the stored row (requested from the supervisor / Task 7d storage).
 */
function row(sessionUid: string, startedAt: string, kind: WeekendPhaseKind, weekendId = WEEKEND): StoredSessionRow {
  return {
    sessionUid,
    weekendId,
    seasonId: '1',
    playerCar: carId(0),
    teammateCar: null,
    trackId: TRACK,
    startedAt,
    pwrecPath: null,
    settings: {},
    cars: [{ carId: carId(0), carKey: MERCEDES, driver: known('Driver', 0) }],
    kind,
    rulesVersion: 'v1',
    complete: true,
  };
}

const ref = (r: StoredSessionRow): SessionRef => ({ sessionUid: r.sessionUid, weekendId: r.weekendId });

/** The morning's confirmed choice (2026-11-18 09:40): practice and qualifying of 17 Nov. */
const MORNING_PRACTICE: SessionRef = { sessionUid: '900', weekendId: WEEKEND };
const MORNING_QUALIFYING: SessionRef = { sessionUid: '901', weekendId: WEEKEND };
const morningChoice = (at = iso(18, '09:40')): LastChoice => ({
  trackId: TRACK,
  basis: { practice: { refs: [MORNING_PRACTICE], at }, qualifying: { ref: MORNING_QUALIFYING, at } },
  plan: { id: 'plan-1', at },
});

describe('preselect (C62)', () => {
  it('(a) own weekend has practice 21:02 and qualifying 22:07, no last choice → both own', () => {
    const practice = row('1', iso(17, '21:02'), 'practice');
    const qualifying = row('2', iso(17, '22:07'), 'qualifying');
    const result = preselect({ own: [practice, qualifying], last: undefined, kind: 'race' });
    expect(result.basis).toEqual({ practice: [ref(practice)], qualifying: ref(qualifying) });
    expect(result.rule).toEqual({ practice: 'ownWeekend', qualifying: 'ownWeekend' });
  });

  it('(b) a new lobby race (no own sessions), last choice practice and qualifying at 09:40 → both last choice', () => {
    const result = preselect({ own: [], last: morningChoice(), kind: 'race' });
    expect(result.basis).toEqual({ practice: [MORNING_PRACTICE], qualifying: MORNING_QUALIFYING });
    expect(result.rule).toEqual({ practice: 'lastChoice', qualifying: 'lastChoice' });
  });

  it('(c) a new lobby with a practice at 17:00 after a 09:40 choice → practice own (17:00), qualifying last choice', () => {
    const lobbyPractice = row('3', iso(18, '17:00'), 'practice', NEW_LOBBY);
    const result = preselect({ own: [lobbyPractice], last: morningChoice(), kind: 'race' });
    expect(result.basis).toEqual({ practice: [ref(lobbyPractice)], qualifying: MORNING_QUALIFYING });
    expect(result.rule).toEqual({ practice: 'ownWeekend', qualifying: 'lastChoice' });
  });

  it('(d) nothing → NO_BASIS', () => {
    const result = preselect({ own: [], last: undefined, kind: 'race' });
    expect(result.basis).toEqual(NO_BASIS);
    expect(result.rule).toEqual({ practice: 'none', qualifying: 'none' });
  });

  it('(e) a qualifying session gets qualifying: null whatever the last choice holds', () => {
    const earlierQualifying = row('4', iso(18, '08:00'), 'qualifying');
    const fromLast = preselect({ own: [], last: morningChoice(), kind: 'qualifying' });
    expect(fromLast.basis).toEqual({ practice: [MORNING_PRACTICE], qualifying: null });
    expect(fromLast.rule).toEqual({ practice: 'lastChoice', qualifying: 'none' });
    const fromOwn = preselect({ own: [earlierQualifying], last: morningChoice(iso(18, '07:00')), kind: 'qualifying' });
    expect(fromOwn.basis.qualifying).toBeNull();
    expect(fromOwn.rule.qualifying).toBe('none');
  });
});
