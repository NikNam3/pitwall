// @vitest-environment jsdom
// Feed status shows the session's weekend phase from `situation.weekendPhase` (C54, C65, C66): the open span's kind,
// worded through its presentation table, beside the track. It reads no session kind from `session.info` (Task 24 removes
// it, C13). While the phase is pending (no open span) or the topic has no value, no phase word shows; the track still does.
// The name reads the span's kind with its detail's format (supervisor ruling, Task 25 fix round 1): a sprint shootout
// (and its short and one-shot variants) is "sprint shootout", the race with format `sprint` is "sprint".
import type { FeedStatus as FeedStatusValue, MachineSpans, SessionInfo } from '@pitwall/contracts';
import { carId, feedId, toSessionTime, type OpenSpan, type PracticeFormat, type QualifyingFormat, type RaceFormat } from '@pitwall/domain';
import { cleanup, render } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { separator } from '../../kit/text.ts';
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

const mount = (phase: MachineSpans | undefined): HTMLElement =>
  render(InPanel, {
    component: FeedStatus as unknown as Component<Record<string, unknown>>,
    widgetProps: {
      data: { feed, session, phase },
      options: { details: false },
      size: { mode: 'compact', cols: 40, rows: 3, px: { width: 400, height: 60 }, dpr: 1 },
      link: {},
    },
  }).container;
const shown = (phase: MachineSpans | undefined): string => mount(phase).textContent ?? '';
/** The session line: the innermost block holding the track. */
const sessionLine = (phase: MachineSpans | undefined): string | undefined =>
  [...mount(phase).querySelectorAll('div')].find((d) => d.querySelector('div') === null && d.textContent?.includes(formatTrack(ZANDVOORT)))?.textContent?.trim();

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

describe('FeedStatus: the session name by the weekend phase and its format', () => {
  /** Every format the domain declares, by phase, with the name the session line shows before the track. */
  const PRACTICE: Record<PracticeFormat, string> = { practice: 'practice', shortPractice: 'practice' };
  const QUALIFYING: Record<QualifyingFormat, string> = {
    grandPrix: 'qualifying', short: 'qualifying', oneShot: 'qualifying',
    sprintShootout: 'sprint shootout', shortSprintShootout: 'sprint shootout', oneShotSprintShootout: 'sprint shootout',
  };
  const RACE: Record<RaceFormat, string> = { grandPrix: 'race', sprint: 'sprint' };
  const rows: Array<[kind: string, format: string, detail: unknown, name: string]> = [
    ...Object.entries(PRACTICE).map(([format, name]) => ['practice', format, { format, segment: 1 }, name] as [string, string, unknown, string]),
    ...Object.entries(QUALIFYING).map(([format, name]) => ['qualifying', format, { format, segment: undefined }, name] as [string, string, unknown, string]),
    ...Object.entries(RACE).map(([format, name]) => ['race', format, { format }, name] as [string, string, unknown, string]),
  ];

  for (const [kind, format, detail, name] of rows) {
    it(`${kind} with format ${format} reads "${name}" before the track`, () => {
      expect(sessionLine({ open: [phaseSpan(kind, detail)] })).toBe(`${name}${separator}${formatTrack(ZANDVOORT)}`);
    });
  }
});
