// SP4.3f Task 6 (spec §4.4; C43, C65): the picker's options between sessions, pure over `plans.sessions`. Contract
// assumed (plan text, `candidates.ts`):
//  - `trackOptions(s)`: the tracks with a stored qualifying, newest first;
//  - `qualifyingOptions(s, trackId)`: that track's qualifying entries, one per team it is stored for, newest first;
//  - `practiceOptions(s, q)`: the practice entries of q's track and q's team, newest first; never another team's;
//  - `planningChoice(draft, s)`: the draft's own choice per part, else the preselection: the newest track, its newest
//    qualifying, every practice of that team on the qualifying's weekend (else none). A draft's qualifying is
//    `<sessionKey>#<team>`, its practice a list of session keys. A draft naming only a track takes that track's
//    preselection, and a qualifying or practice of another track is never chosen with it.
// Fails at typecheck until `candidates.ts` exports these helpers (implementation).
import { describe, expect, it } from 'vitest';
import {
  FERRARI,
  MERCEDES,
  P17,
  P18_FERRARI,
  P18_MERCEDES,
  Q17,
  STORED,
  STORED_TWO_TEAM_QUALIFYING,
  TEXAS,
  TEXAS_P17,
  TEXAS_P18,
  ZANDVOORT,
  ZP10,
  ZQ10,
  keyOf,
  qualifyingKey,
} from '../../../test/shell/planning-fixtures.ts';
import { planningChoice, practiceOptions, qualifyingOptions, trackOptions } from './candidates.ts';

const teamsOf = (entries: readonly { ref: { sessionUid: string }; team: number }[]): string[] => entries.map((e) => `${e.ref.sessionUid}#${e.team}`);

describe('the options between sessions', () => {
  it('qualifyingOptions lists one entry per team', () => {
    expect(trackOptions(STORED).map((t) => t.trackId)).toEqual([TEXAS, ZANDVOORT]);
    expect(teamsOf(qualifyingOptions(STORED, TEXAS))).toEqual([`${Q17.ref.sessionUid}#${MERCEDES}`]);
    // The 18 Nov session as a qualifying stored for Mercedes and for Ferrari: listed once per team, newest first.
    const options = qualifyingOptions(STORED_TWO_TEAM_QUALIFYING, TEXAS);
    expect(teamsOf(options.slice(0, 2)).sort()).toEqual([`${TEXAS_P18.sessionUid}#${MERCEDES}`, `${TEXAS_P18.sessionUid}#${FERRARI}`].sort());
    expect(teamsOf(options.slice(2))).toEqual([`${Q17.ref.sessionUid}#${MERCEDES}`]);
    expect(new Set(teamsOf(options)).size).toBe(options.length);
    expect(options.map((o) => o.kind)).toEqual(['qualifying', 'qualifying', 'qualifying']);
    expect(qualifyingOptions(STORED, ZANDVOORT)).toEqual([ZQ10]);
  });

  it('practiceOptions of the Mercedes qualifying never lists the Ferrari practice', () => {
    const options = practiceOptions(STORED, Q17);
    expect(options).toEqual([P18_MERCEDES, P17]);
    expect(options).not.toContainEqual(P18_FERRARI);
    expect(options.every((o) => o.team === MERCEDES && o.trackId === TEXAS && o.kind === 'practice')).toBe(true);
  });

  it('the preselection picks the 17 Nov qualifying and its practice', () => {
    expect(planningChoice({}, STORED)).toEqual({ trackId: TEXAS, qualifying: Q17, practice: [P17] });
    expect(planningChoice({ trackId: TEXAS }, STORED)).toEqual({ trackId: TEXAS, qualifying: Q17, practice: [P17] });
    // The draft's own choice wins over the preselection: practice none, or another of the team's.
    expect(planningChoice({ practice: [] }, STORED)).toEqual({ trackId: TEXAS, qualifying: Q17, practice: [] });
    expect(planningChoice({ practice: [keyOf(TEXAS_P18), keyOf(TEXAS_P17)] }, STORED)?.practice).toEqual(expect.arrayContaining([P18_MERCEDES, P17]));
    expect(planningChoice({}, { sessions: [] })).toBeUndefined();
  });

  it('changing the track resets the qualifying and practice to that track\'s preselection', () => {
    expect(planningChoice({ trackId: ZANDVOORT }, STORED)).toEqual({ trackId: ZANDVOORT, qualifying: ZQ10, practice: [ZP10] });
    // The Texas picks of the draft before the change are not carried over to Zandvoort.
    const before = { trackId: TEXAS, qualifying: qualifyingKey(Q17.ref, MERCEDES), practice: [keyOf(TEXAS_P17), keyOf(TEXAS_P18)] };
    expect(planningChoice({ ...before, trackId: ZANDVOORT }, STORED)).toEqual({ trackId: ZANDVOORT, qualifying: ZQ10, practice: [ZP10] });
  });
});
