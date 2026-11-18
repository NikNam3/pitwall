// SP4.3f Task 3, the round from the picks (C1a, C38, C51, C62, C62d, C73; spec §4.0 idea 1, §4.2 "Opening a round",
// "The recording to replay", "Team, last choice and saved plans"): `plans.round.open { qualifying, team, practice,
// race? }` opens a round that is a function of the picks. The team is handed forward from the stored qualifying (its
// player car's team), never read from a feed: the round replays the first stored row of the qualifying whose player
// car is of `team` (its recording, player car, teammate and track), plans that team's cars by team and race number,
// and takes the practice rows of the same team on the qualifying's track. A pick that fails a check is rejected
// `invalid` with nothing opened and nothing written (C73): a qualifying not stored for the team, a practice of another
// team (Review focus 2) or of another track, laps beyond `MAX_RACE_LAPS`. The same qualifying stored by both of the
// team's feeds replays its first row in start order (Review focus 1). The same picks give the job equal inputs (C38).
//
// Synthetic sessions in fresh temporary data dirs (C84), the planning job the capture stand-in (`round-harness.ts`).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMPORTED, type RoundRace } from '@pitwall/domain';
import { MAX_RACE_LAPS } from '../../src/planning/saved-plans.ts';
import {
  cleanUp, newPlace, OTHER_TEAM, OTHER_TRACK, planningOf, rowsOf, samplesOf, serveBridge, storePractice, storeQualifying, SUGGESTED, TEAM, TRACK,
} from './round-harness.ts';

afterEach(cleanUp);

/** The team's last choice file (`basis/<team>.json`), its text or `undefined`. */
const choiceText = (root: string, team: number): string | undefined => {
  const path = join(root, 'basis', `${team}.json`);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

describe('the round from the picks (SP4.3f Task 3; C62d, C73)', { timeout: 180_000 }, () => {
  it('a qualifying of team 0 and a practice of team 0 in other slots: the round of team 0, its cars by team and race number, the job\'s ourCars [19, 18]', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place);
    const practice = await storePractice(place);
    const p = planningOf(place);

    expect(p.open({ qualifying: qualifying.ref, team: TEAM, practice: [practice.ref] })).toEqual({ ok: true });
    const round = await p.settled(1);

    expect(round).toMatchObject({
      open: true,
      qualifying: qualifying.ref,
      practice: [practice.ref],
      team: TEAM,
      trackId: TRACK,
      playerCar: 19,
      teammateCar: 18,
    });
    // the team's two cars by the replayed recording's slots, each with its race number (C62); no rival
    expect(round.cars).toEqual({
      18: { raceNumber: 64, slots: {}, active: null },
      19: { raceNumber: 2, slots: {}, active: null },
    });
    // the qualifying's recording replayed, with the practice row of the team (its player car slot 0) as its basis
    expect(p.replays()).toHaveLength(1);
    expect(p.replays()[0]!.job).toMatchObject({ pwrecPath: qualifying.file, basisOverride: [practice.key] });
    expect(p.replays()[0]!.priority).toBe('planning');
    expect(p.jobInputs().at(-1)!.ourCars).toEqual([19, 18]);
  });

  it('the same qualifying stored twice (player 18 and 19): it replays the first row in start order (Review focus 1)', async () => {
    const place = newPlace();
    // stored in the other order than storage gives them back
    await storeQualifying(place, { player: 19 });
    await storeQualifying(place, { player: 18 });
    const rows = rowsOf(place, { sessionUid: '70', weekendId: '4321' });
    expect(rows.map((r) => r.playerCar)).toEqual([18, 19]);
    const first = rows[0]!;
    const p = planningOf(place);

    expect(p.open({ qualifying: { sessionUid: first.sessionUid, weekendId: first.weekendId }, team: TEAM })).toEqual({ ok: true });
    const round = await p.settled(1);

    expect(p.replays()).toHaveLength(1);
    expect(p.replays()[0]!.job.pwrecPath).toBe(first.pwrecPath);
    expect(round).toMatchObject({ team: TEAM, playerCar: 18, teammateCar: 19 });
    // either recording shows both of the team's cars (realism masks only rivals)
    expect(round.cars).toEqual({
      18: { raceNumber: 64, slots: {}, active: null },
      19: { raceNumber: 2, slots: {}, active: null },
    });
    expect(p.jobInputs().at(-1)!.ourCars).toEqual([18, 19]);
  });

  it('a practice of team 1: invalid, plans.prepared unchanged, the last-choice file unchanged (Review focus 2)', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place);
    const ours = await storePractice(place);
    // the same practice stored by team 1's feed (its player car #10 in slot 2): a row of another team
    const theirs = await storePractice(place, { uid: 68n, player: 2 });
    // a practice of team 0 on another track
    const elsewhere = await storePractice(place, { uid: 67n, track: OTHER_TRACK });
    const p = planningOf(place);
    p.lastChoice.write(TEAM, { trackId: TRACK, basis: {}, plan: { id: null, at: '2026-11-18T08:00:00.000Z' } });
    const choiceBefore = choiceText(place.dirs.root, TEAM);
    const preparedBefore = p.prepared();

    // a crafted uiAction (the picker never offers it): rejected with a message, nothing opened
    for (const practice of [[theirs.ref], [ours.ref, theirs.ref], [elsewhere.ref]]) {
      const answer = p.open({ qualifying: qualifying.ref, team: TEAM, practice });
      expect(answer, JSON.stringify(practice)).toMatchObject({ ok: false, reason: 'invalid', message: expect.any(String) });
    }
    await new Promise((r) => setTimeout(r, 300));
    expect(p.prepared()).toEqual(preparedBefore);
    expect(p.calls).toEqual([]);
    expect(p.jobInputs()).toEqual([]);
    // no partial round, no last-choice write: neither ours nor team 1's
    expect(choiceText(place.dirs.root, TEAM)).toBe(choiceBefore);
    expect(choiceText(place.dirs.root, OTHER_TEAM)).toBeUndefined();
  });

  it('team 1 for a qualifying stored only for team 0: invalid', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place);
    const p = planningOf(place);

    expect(p.open({ qualifying: qualifying.ref, team: OTHER_TEAM })).toMatchObject({ ok: false, reason: 'invalid', message: expect.any(String) });
    // a qualifying not stored at all: invalid too
    expect(p.open({ qualifying: { sessionUid: '999', weekendId: '4321' }, team: TEAM })).toMatchObject({ ok: false, reason: 'invalid' });
    await new Promise((r) => setTimeout(r, 300));
    expect(p.prepared().some((v) => v.open)).toBe(false);
    expect(p.calls).toEqual([]);
    expect(choiceText(place.dirs.root, OTHER_TEAM)).toBeUndefined();
    expect(choiceText(place.dirs.root, TEAM)).toBeUndefined();
  });

  it('race laps beyond MAX_RACE_LAPS: invalid', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place);
    const p = planningOf(place);
    const race: RoundRace = { laps: MAX_RACE_LAPS + 1, sets: 'carried', conditions: IMPORTED };

    expect(p.open({ qualifying: qualifying.ref, team: TEAM, race })).toMatchObject({ ok: false, reason: 'invalid' });
    await new Promise((r) => setTimeout(r, 300));
    expect(p.prepared().some((v) => v.open)).toBe(false);
    expect(p.calls).toEqual([]);
    // laps at the limit open
    expect(p.open({ qualifying: qualifying.ref, team: TEAM, race: { ...race, laps: MAX_RACE_LAPS } })).toEqual({ ok: true });
    expect((await p.settled(1)).race.laps).toBe(MAX_RACE_LAPS);
  });

  it('no feeds/ directory exists before or after', async () => {
    const place = newPlace();
    const qualifying = await storeQualifying(place);
    const practice = await storePractice(place);
    const feeds = join(place.dirs.root, 'feeds');
    expect(existsSync(feeds)).toBe(false);

    // a bridge with no session: the round opens from the picks alone
    const b = await serveBridge(place);
    expect(await b.send({ kind: 'plans.round.open', feedId: 'udp-20777', qualifying: qualifying.ref, team: TEAM, practice: [practice.ref] })).toEqual({ ok: true });
    await vi.waitFor(() => expect(b.prepared().at(-1)).toMatchObject({ open: true, running: false, team: TEAM, playerCar: 19, teammateCar: 18, race: { laps: null } }), { timeout: 60_000 });
    expect(existsSync(feeds)).toBe(false);
    await b.stop();
    expect(existsSync(feeds)).toBe(false);
  });
});

describe('determinism of the round (C38; spec §4.5)', { timeout: 180_000 }, () => {
  it('two rounds opened with the same picks and race on two fresh bridges hand the job equal inputs', async () => {
    const race = async (): Promise<unknown> => {
      const place = newPlace();
      const qualifying = await storeQualifying(place);
      const practice = await storePractice(place);
      const p = planningOf(place);
      expect(p.open({ qualifying: qualifying.ref, team: TEAM, practice: [practice.ref] })).toEqual({ ok: true });
      const opened = await p.settled(1);
      const [first, second] = samplesOf(opened);
      const conditions = { kind: 'entered' as const, samples: [first!, { ...second!, rainPct: 80 }] };
      expect(p.setRace({ laps: SUGGESTED, sets: 'fresh', conditions })).toEqual({ ok: true });
      await p.settled(2);
      await vi.waitFor(() => expect(p.round().race).toEqual({ laps: SUGGESTED, sets: 'fresh', conditions }));
      return p.jobInputs().at(-1);
    };
    const one = await race();
    const two = await race();
    expect(one).toBeDefined();
    expect(two).toStrictEqual(one);
  });
});
