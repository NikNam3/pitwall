// The session-start basis (SP4.3e Task 7a-2, plan Step 1 row (a); C39, C59, C62; spec §4.2): a race whose seat has a
// stored practice and qualifying of its own weekend, both current, preselects both (no last choice), starts with both
// in `view.basis` from its first frame, and writes `<file>.basis.json` `{ start, preselected }` at its first
// Participants. Nothing is stale, so nothing is committed. Seam: `./basis-support.ts`.
import { describe, expect, it } from 'vitest';
import { A, AT, basisSidecarOf, bridge, builder, chosen, decisionsOf, last, RACE_UID, SESSION_TYPE, settle, slice, storeSession, TEAM, TRACK } from './basis-support.ts';

const WEEKEND = 41;

describe('the session-start basis (C62)', () => {
  it('(a) a race whose seat has a stored practice and qualifying: at the first Participants the sidecar holds start and preselected; view.basis.sessions has both', async () => {
    const b = bridge();
    const practice = await storeSession(b.db, { uid: 31n, weekend: WEEKEND, type: SESSION_TYPE.practice, player: 0, at: AT.practice });
    const qualifying = await storeSession(b.db, { uid: 32n, weekend: WEEKEND, type: SESSION_TYPE.qualifying, player: 0, at: AT.qualifying });
    const both = { practice: [practice], qualifying };

    const a = b.feed(A);
    const packets = builder({ uid: RACE_UID, weekend: WEEKEND, type: SESSION_TYPE.race, player: 0 }).frames(20, () => {}).packets();
    // the first frames carry the first Participants
    a.push(slice(packets, 0, 4));
    await settle();
    expect(basisSidecarOf(a.file())).toEqual({ start: both, preselected: both });
    // the team's last choice on the track was asked (the preselection's other half, C62)
    expect(b.lastChoice.read).toHaveBeenCalledWith(TEAM, TRACK);

    a.push(slice(packets, 4, 20));
    const file = await a.end();
    // from the session's first frame on, both sessions of the seat (player car 0)
    expect(a.seen.length).toBeGreaterThan(0);
    for (const s of a.seen) {
      expect(s.basis).toEqual(both);
      expect(s.sessions).toEqual(['31/0', '32/0']);
    }
    // nothing stale: no basisChosen
    expect(chosen(last(a.seen))).toEqual([]);
    expect(decisionsOf(file)).toEqual([]);
  });
});
