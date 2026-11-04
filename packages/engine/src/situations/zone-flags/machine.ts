// The zone-flags sub-machine (contract C9, C15, C17, C18, C26): per marshal zone the Session packet lists, the zone's flag
// (signal `marshalZones`), one span per flag: a new span on every change. A zone is a scope from the first frame that
// lists it. A zone a later packet no longer lists has an unknown flag from then on (C3; not yet seen, C19). Shared.
import { zoneFlagsSpans, type OpenSpan, type Ratio, type ZoneFlagDetail } from '@pitwall/domain';
import { FLAG_TRANSITIONS, flagKind } from '../flag-kind.ts';
import type { MachineStep, SubMachine } from '../machine.ts';

/**
 * The open span per zone (by index; the same object while it holds, C40) and how many spans the machine has opened (a
 * span's id is that count, C26).
 */
type Open = { frames: number; opened: number; zones: Array<OpenSpan<string, ZoneFlagDetail>> };

const machine: SubMachine<Open> = {
  id: 'zone-flags',
  appliesTo: 'all',
  spans: zoneFlagsSpans,
  inputs: { signals: ['marshalZones'], values: [], upstream: [] },
  transitions: FLAG_TRANSITIONS,
  init: () => ({ frames: 0, opened: 0, zones: [] }),
  openSpans: (open) => [...open.zones],
  step(open, input): MachineStep<Open> {
    const frames = open.frames + 1;
    const listed = input.signals.session.marshalZones;
    const count = Math.max(listed.length, open.zones.length);
    const closed: MachineStep<Open>['closed'] = [];
    const zones: Array<OpenSpan<string, ZoneFlagDetail>> = [];
    let opened = open.opened;
    for (let zone = 0; zone < count; zone++) {
      const before = open.zones[zone];
      const entry = listed[zone];
      const kind = entry === undefined ? 'unknown' : flagKind(entry.flag);
      if (before !== undefined && before.kind === kind) {
        zones.push(before);
        continue;
      }
      if (before !== undefined) closed.push({ ...before, end: input.at });
      const startFraction: Ratio = before?.detail.startFraction ?? (entry as NonNullable<typeof entry>).startFraction;
      zones.push({ machine: 'zone-flags', id: opened++, kind, start: input.at, startFrame: input.frameNumber, zone, confirmed: true, detail: { startFraction }, ...(frames === 1 ? { joinedAt: true as const } : {}) });
    }
    return { open: { frames, opened, zones }, closed };
  },
};

export default machine;
