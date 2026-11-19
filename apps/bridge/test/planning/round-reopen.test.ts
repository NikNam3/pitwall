// SP4.3f Task 3, reopening a round (C62d, C73; spec §4.4 "Confirm sends plans.round.open with the race assumptions'
// defaults: … or, reopening the same qualifying, the round's last entered values"; Review focus 4): `plans.round.open`
// without `race` opens with the defaults (the suggested laps, `carried`, `IMPORTED`), except when it reopens the
// qualifying of the feed's last round (same ref and team): then that round's race (laps, sets, entered conditions) stays.
//
// Synthetic sessions in fresh temporary data dirs (C84), the planning job the capture stand-in (`round-harness.ts`).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMPORTED, type RaceConditions, type RoundRace } from '@pitwall/domain';
import { cleanUp, newPlace, planningOf, samplesOf, storePractice, storeQualifying, SUGGESTED, TEAM } from './round-harness.ts';

afterEach(cleanUp);

const DEFAULTS: RoundRace = { laps: SUGGESTED, sets: 'carried', conditions: IMPORTED };

/** A round of the qualifying, its race then set to 20 laps, `fresh`, row 2 entered at rain 80; settled. */
async function entered() {
  const place = newPlace();
  const qualifying = await storeQualifying(place);
  const practice = await storePractice(place);
  const p = planningOf(place);
  expect(p.open({ qualifying: qualifying.ref, team: TEAM, practice: [practice.ref] })).toEqual({ ok: true });
  const first = await p.settled(1);
  expect(first.race).toEqual(DEFAULTS);
  const [a, b] = samplesOf(first);
  const conditions: RaceConditions = { kind: 'entered', samples: [a!, { ...b!, rainPct: 80 }] };
  const race = { laps: 20, sets: 'fresh' as const, conditions };
  expect(p.setRace(race)).toEqual({ ok: true });
  await vi.waitFor(() => expect(p.replays()).toHaveLength(2), { timeout: 60_000 });
  await p.settled(2);
  expect(p.round().race).toEqual(race);
  return { place, qualifying, practice, p, race };
}

describe('reopening a round (SP4.3f Task 3; C62d; Review focus 4)', { timeout: 180_000 }, () => {
  it('open, set laps 20, fresh, entered rows, then open again with the same qualifying and no race: the round keeps them', async () => {
    const { qualifying, practice, p, race } = await entered();

    expect(p.open({ qualifying: qualifying.ref, team: TEAM, practice: [practice.ref] })).toEqual({ ok: true });
    await vi.waitFor(() => expect(p.replays()).toHaveLength(3), { timeout: 60_000 });
    const again = await p.settled(3);

    expect(again.race).toEqual(race);
    expect(p.replays()[2]!.job).toMatchObject({ laps: 20, sets: 'fresh', conditions: race.conditions });
    // the entered row stays overridden
    expect(again.forecast.rows).toMatchObject({ known: true, value: [{ overridden: false }, { overridden: true, sample: { rainPct: 80 } }] });
  });

  it('open with another qualifying: the defaults', async () => {
    const { place, qualifying, p } = await entered();
    const other = await storeQualifying(place, { uid: 71n });

    expect(p.open({ qualifying: other.ref, team: TEAM })).toEqual({ ok: true });
    await vi.waitFor(() => expect(p.replays()).toHaveLength(3), { timeout: 60_000 });
    const round = await p.settled(3);
    expect(round.qualifying).toEqual(other.ref);
    expect(round.race).toEqual(DEFAULTS);
    expect(p.replays()[2]!.job).toMatchObject({ pwrecPath: other.file, laps: SUGGESTED, sets: 'carried', conditions: IMPORTED });

    // the feed's last round is the other qualifying's now: reopening the first one starts from the defaults too
    expect(p.open({ qualifying: qualifying.ref, team: TEAM })).toEqual({ ok: true });
    await vi.waitFor(() => expect(p.replays()).toHaveLength(4), { timeout: 60_000 });
    const back = await p.settled(4);
    expect(back.qualifying).toEqual(qualifying.ref);
    expect(back.race).toEqual(DEFAULTS);
  });
});
