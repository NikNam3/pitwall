// SP4.3f Task 3, the round's profiles (C62c, C62d; spec §4.1 "C62d", §4.2 "Profiles"; contract a390673a): the round's
// profile snapshot is the current snapshot of the qualifying's linked drivers, every car slot, as a session start builds
// it (`profiles.snapshotFor(slots of the row's cars, the row's ref)`), not the recording's profiles sidecar. The round
// keeps it and hands it to the replay (`ReplayJob.profiles`); `plans.save` notes its fingerprint (`computedOn.profiles`)
// and the conditions the plan was computed on (`computedOn.forecast`: the effective samples), for display only.
//
// Synthetic sessions in fresh temporary data dirs (C84), a profile-store fake (no test reads the profile store), the
// planning job the capture stand-in (`round-harness.ts`).
import { writeFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProfileSnapshot } from '@pitwall/domain';
import type { SlotIdentity } from '../../src/drivers/store.ts';
import { profilesSidecarPath } from '../../src/pipeline/profile-sidecar.ts';
import { cleanUp, F, newPlace, planningOf, QUALIFYING_CARS, samplesOf, storeQualifying, SUGGESTED, TEAM, TRACK, type ProfilesFake } from './round-harness.ts';

afterEach(cleanUp);

const PERSON = 'person-p';

/** The profile store of today: #2 (of any team 0 slot) linked to person P, nobody else. */
function storeLinkingNumber2(): ProfilesFake & { snapshotFor: ReturnType<typeof vi.fn> } {
  const snapshotFor = vi.fn((slots: readonly SlotIdentity[]): ProfileSnapshot => {
    const bySlot: (string | null)[] = Array.from({ length: slots.reduce((n, s) => Math.max(n, s.carId + 1), 0) }, () => null);
    for (const slot of slots) if (slot.teamId === TEAM && slot.raceNumber === 2) bySlot[slot.carId] = PERSON;
    return { fingerprint: 'current-profiles-of-p', bySlot, profiles: { [PERSON]: { person: PERSON, displayName: 'P', entries: {} } } };
  });
  return { snapshotFor };
}

/** The qualifying stored, its recording's profiles sidecar linking nobody (as written at its own session start). */
async function qualifyingWithSidecar(place: ReturnType<typeof newPlace>) {
  const qualifying = await storeQualifying(place);
  const nobody: ProfileSnapshot = { fingerprint: 'sidecar-of-the-recording', bySlot: QUALIFYING_CARS.map(() => null), profiles: {} };
  writeFileSync(profilesSidecarPath(qualifying.file), JSON.stringify(nobody));
  return qualifying;
}

describe('the round\'s profiles (SP4.3f Task 3; C62c, C62d)', { timeout: 180_000 }, () => {
  it('a profile store linking #2 to person P: the replay job carries that snapshot, not the recording\'s sidecar', async () => {
    const place = newPlace();
    const qualifying = await qualifyingWithSidecar(place);
    const profiles = storeLinkingNumber2();
    const p = planningOf(place, { profiles });

    expect(p.open({ qualifying: qualifying.ref, team: TEAM })).toEqual({ ok: true });
    await p.settled(1);

    // asked once, for every car slot of the qualifying's row, with the row's ref (as a session start asks, C62c)
    expect(profiles.snapshotFor).toHaveBeenCalledTimes(1);
    const [slots, session] = profiles.snapshotFor.mock.calls[0]! as [SlotIdentity[], unknown];
    // every slot the stored row has: the game's 22 (the session's 20, then 2 empty), as a session start asks
    expect(slots.map((s) => s.carId).sort((a, b) => a - b).slice(0, QUALIFYING_CARS.length)).toEqual(QUALIFYING_CARS.map((_, i) => i));
    expect(slots).toHaveLength(22);
    expect(slots).toEqual(expect.arrayContaining([
      expect.objectContaining({ carId: 19, teamId: TEAM, raceNumber: 2 }),
      expect.objectContaining({ carId: 18, teamId: TEAM, raceNumber: 64 }),
      expect.objectContaining({ carId: 0, teamId: 1, raceNumber: 10 }),
    ]));
    expect(session).toEqual({ sessionUid: qualifying.ref.sessionUid, weekendId: qualifying.ref.weekendId, feedCar: 19 });
    // the replay plans with today's links: #2 (slot 19) is person P
    const snapshot = profiles.snapshotFor.mock.results[0]!.value as ProfileSnapshot;
    expect(snapshot.bySlot[19]).toBe(PERSON);
    expect(p.replays()).toHaveLength(1);
    expect(p.replays()[0]!.job.profiles).toEqual(snapshot);
    expect(p.replays()[0]!.job.profiles?.fingerprint).not.toBe('sidecar-of-the-recording');
  });

  it('plans.save: computedOn.profiles is its fingerprint and computedOn.forecast the effective samples', async () => {
    const place = newPlace();
    const qualifying = await qualifyingWithSidecar(place);
    const p = planningOf(place, { profiles: storeLinkingNumber2() });
    expect(p.open({ qualifying: qualifying.ref, team: TEAM })).toEqual({ ok: true });
    const round = await p.settled(1);
    const imported = samplesOf(round);

    // imported conditions: the qualifying's race samples
    expect(p.apply({ kind: 'plans.save', feedId: F, name: 'imported' })).toEqual({ ok: true });
    const [saved] = p.store.list(TEAM, TRACK);
    expect(saved!.computedOn.profiles).toBe('current-profiles-of-p');
    expect(saved!.computedOn.forecast).toEqual(imported);

    // entered conditions: the entered samples
    const entered = [imported[0]!, { ...imported[1]!, rainPct: 80 }];
    expect(p.setRace({ laps: SUGGESTED, sets: 'carried', conditions: { kind: 'entered', samples: entered } })).toEqual({ ok: true });
    await vi.waitFor(() => expect(p.replays()).toHaveLength(2), { timeout: 60_000 });
    await p.settled(2);
    expect(p.apply({ kind: 'plans.save', feedId: F, name: 'entered' })).toEqual({ ok: true });
    const plan = p.store.list(TEAM, TRACK).find((x) => x.name === 'entered');
    expect(plan?.computedOn.forecast).toEqual(entered);
    expect(plan?.computedOn.race.conditions).toEqual({ kind: 'entered', samples: entered });
    expect(plan?.computedOn.profiles).toBe('current-profiles-of-p');
  });
});
