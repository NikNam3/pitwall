// Race control's DRS status from the history's DRSE and DRSD events, shared by battle and race-moment.
import type { RaceEvent, SessionKind } from '@pitwall/domain';
import { describe, expect, it } from 'vitest';
import { engineView, event } from '../../../../test-support/builders/index.ts';
import { drsStatus } from '../../src/shared/drs-status.ts';

const enabled = (at = 0): RaceEvent => event({ kind: 'drsEnabled', at });
const disabled = (reason: number | string | undefined, at = 0): RaceEvent =>
  event({ kind: 'drsDisabled', at, params: reason === undefined ? {} : { reason } });

const statusOf = (events: RaceEvent[], kind: SessionKind = 'race') => drsStatus(engineView({ session: { kind }, history: { events } }).state);

describe('drsStatus', () => {
  it('a race without DRSE or DRSD: off, not enabled yet', () => {
    expect(statusOf([])).toEqual({ enabled: false, reason: 'notEnabledYet' });
  });

  it('a race with other events but no DRSE or DRSD: still off, not enabled yet', () => {
    expect(statusOf([event({ kind: 'lightsOut' }), event({ kind: 'overtake', at: 5_000 })])).toEqual({ enabled: false, reason: 'notEnabledYet' });
  });

  it('outside a race, without DRSE or DRSD: enabled (practice and qualifying send neither)', () => {
    for (const kind of ['practice', 'qualifying', 'sprintShootout', 'timeTrial', 'unknown'] as const) {
      expect(statusOf([], kind)).toEqual({ enabled: true });
    }
  });

  it('a DRSE enables DRS', () => {
    expect(statusOf([enabled(300_000)])).toEqual({ enabled: true });
  });

  it('a DRSD turns DRS off with its reason', () => {
    for (const reason of ['wetTrack', 'safetyCar', 'redFlag', 'minLapNotReached'] as const) {
      expect(statusOf([enabled(300_000), disabled(reason, 400_000)])).toEqual({ enabled: false, reason });
    }
  });

  it('a DRSD with a reason the engine could not map, or none: off, reason unknown', () => {
    for (const reason of ['somethingNew', 7, undefined]) {
      expect(statusOf([enabled(300_000), disabled(reason, 400_000)])).toEqual({ enabled: false, reason: 'unknown' });
    }
  });

  it('the newest DRS event wins: a DRSE after a DRSD enables DRS again', () => {
    expect(statusOf([enabled(300_000), disabled('safetyCar', 400_000), enabled(500_000)])).toEqual({ enabled: true });
  });

  it('the newest DRS event wins: a DRSD after a DRSE turns it off, later non-DRS events change nothing', () => {
    const events = [enabled(300_000), disabled('wetTrack', 400_000), event({ kind: 'overtake', at: 410_000 })];
    expect(statusOf(events)).toEqual({ enabled: false, reason: 'wetTrack' });
  });

  it('the newest is the later one in the history, also at the same session time', () => {
    expect(statusOf([disabled('redFlag', 400_000), enabled(400_000)])).toEqual({ enabled: true });
    expect(statusOf([enabled(400_000), disabled('redFlag', 400_000)])).toEqual({ enabled: false, reason: 'redFlag' });
  });

  it('a DRSD outside a race turns DRS off too: the events rule in every session', () => {
    expect(statusOf([disabled('wetTrack', 100_000)], 'practice')).toEqual({ enabled: false, reason: 'wetTrack' });
  });

  it('a flashback that drops the newest DRS event moves the status back to the one before', () => {
    const events = [enabled(300_000), disabled('wetTrack', 400_000)];
    expect(statusOf(events)).toEqual({ enabled: false, reason: 'wetTrack' });
    expect(statusOf(events.slice(0, 1))).toEqual({ enabled: true });
    expect(statusOf([])).toEqual({ enabled: false, reason: 'notEnabledYet' });
  });
});
