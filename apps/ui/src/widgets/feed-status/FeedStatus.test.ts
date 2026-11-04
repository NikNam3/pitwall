// @vitest-environment jsdom
// Feed status shows the session's weekend phase from `situation.weekendPhase` (C54, C65, C66): the open span's kind,
// worded through its presentation table, beside the track. It reads no session kind from `session.info` (Task 24 removes
// it, C13). While the phase is pending (no open span) or the topic has no value, no phase word shows; the track still does.
import type { FeedStatus as FeedStatusValue, MachineSpans, SessionInfo } from '@pitwall/contracts';
import { carId, feedId, toSessionTime, type OpenSpan } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { formatTrack } from '../../kit/values/format.ts';
import FeedStatus from './FeedStatus.svelte';

afterEach(cleanup);

const feed: FeedStatusValue = {
  feedId: feedId('test'), connected: true, stale: false, lossPercent: 0, latePackets: 0, decodeErrors: 0, packetsPerSecond: 60,
};
const ZANDVOORT = 26;
const session = { feedId: feedId('test'), sessionUid: '1', playerCar: carId(0), session: { trackId: ZANDVOORT }, realism: false } as unknown as SessionInfo;

const phaseSpan = (kind: string, detail: unknown): OpenSpan => ({
  machine: 'weekend-phase', id: 0, kind, start: toSessionTime(0), confirmed: true, detail, startFrame: 1,
});
const PHASES: Record<'race' | 'qualifying' | 'practice', MachineSpans> = {
  race: { open: [phaseSpan('race', { format: 'grandPrix' })] },
  qualifying: { open: [phaseSpan('qualifying', { format: 'grandPrix', segment: undefined })] },
  practice: { open: [phaseSpan('practice', { format: 'practice', segment: 1 })] },
};

const shown = (phase: MachineSpans | undefined): string =>
  render(InPanel, {
    component: FeedStatus as unknown as Component<Record<string, unknown>>,
    widgetProps: {
      data: { feed, session, phase },
      options: { details: false },
      size: { mode: 'compact', cols: 40, rows: 3, px: { width: 400, height: 60 }, dpr: 1 },
      link: {},
    },
  }).container.textContent ?? '';

const words = (text: string): string[] => text.split(/[^a-z]+/i).filter((w) => w !== '');

describe('FeedStatus: the weekend phase', () => {
  for (const kind of ['race', 'qualifying', 'practice'] as const) {
    it(`shows ${kind} from the weekend phase's open span, beside the track`, () => {
      const text = shown(PHASES[kind]);
      expect(words(text)).toContain(kind);
      expect(text).toContain(formatTrack(ZANDVOORT));
    });
  }

  it('shows no phase while the phase is pending (no open span) or the topic has no value; the track still shows', () => {
    for (const phase of [{ open: [] }, undefined]) {
      const text = shown(phase);
      expect(words(text).filter((w) => ['race', 'qualifying', 'practice'].includes(w))).toEqual([]);
      expect(text).toContain(formatTrack(ZANDVOORT));
      cleanup();
    }
  });
});
