// @vitest-environment jsdom
// The top bar shows the session phase (Task 26, contract C46, C65, C66, C68; ruling 1-4 of the brief).
// Contract the tests assume:
//  - the top bar acquires `situation.weekendPhase`, `situation.clock`, and `situation.sessionPhaseRace|Qualifying|Practice`
//    (feed topics, `MachineSpans = { open }`) and picks the session-phase topic by the kind of the weekend phase's open span
//    (`race`, `qualifying`, `practice`) through `kit/situation.ts` `openSpanOf`; selection only;
//  - `shell/topbar/layout.ts`: `SegmentName` gains `'phase'`, placed in `TOP_BAR.left` between `flag` and `moment`;
//    the segment `shell/topbar/segments/Phase.svelte` renders an element with test id `phase` (only while there is a label);
//  - `kit/text.ts` `topBar.phase = { formation, startLights, sc, vsc, red, finished, paused }` (FORMATION, START, SC, VSC, RED,
//    FINISHED, PAUSED) and `topBar.phaseStage = { deployed, returning, returned, resume }`; an SC or VSC label also holds its
//    latest stage's word;
//  - `shell/topbar/phase-presentation.ts` (pure) exports `phasePresentation`: per session-phase machine
//    (`session-phase-race|qualifying|practice`) one row per span kind (`SPAN_DECLARATIONS`), each row `{ label, role }` with
//    `label: keyof topBar.phase | 'neutralised' | undefined` (`neutralised` resolves to `sc` or `vsc` by the span's
//    `NeutralisedDetail.car`; `undefined` = hidden) and `role: Role | undefined`; SC, VSC and RED (and so `neutralised`
//    and `suspended`) carry the role `warning`, every other row no role (grey, UI colour philosophy);
//    and `phaseOf(machine, span)`: `{ label: keyof topBar.phase; role: Role | undefined } | undefined` for an open span.
import type { MachineSpans } from '@pitwall/contracts';
import { SPAN_DECLARATIONS, feedId, type NeutralisedDetail, type OpenSpan } from '@pitwall/domain';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import * as text from '../../src/kit/text.ts';
import { phaseOf, phasePresentation } from '../../src/shell/topbar/phase-presentation.ts';
import TopBar from '../../src/shell/topbar/TopBar.svelte';
import { FakeConnection } from '../connection/fake-connection.ts';

const FEED = feedId('f1');
afterEach(cleanup);

const PHASE_MACHINES = ['session-phase-race', 'session-phase-qualifying', 'session-phase-practice'] as const;
const TOPIC = {
  race: 'situation.sessionPhaseRace',
  qualifying: 'situation.sessionPhaseQualifying',
  practice: 'situation.sessionPhasePractice',
} as const;
type Weekend = keyof typeof TOPIC;

const span = (machine: string, kind: string, detail: unknown = {}): OpenSpan => ({
  machine,
  id: 0,
  kind,
  start: 1000,
  confirmed: true,
  detail,
  startFrame: 1,
}) as OpenSpan;
const spans = (...open: OpenSpan[]): MachineSpans => ({ open });
const neutralised = (car: 'SC' | 'VSC', stage: NeutralisedDetail['stages'][number]['stage'] = 'deployed'): OpenSpan =>
  span('session-phase-race', 'neutralised', { car, stages: [{ stage: 'deployed', at: 900 }, { stage, at: 1000 }] } satisfies NeutralisedDetail);

const setup = async () => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x' }] });
  render(TopBar, { store, feedId: FEED, send: () => {}, sendReplay: () => {} });
  const push = async (topic: string, value: unknown) => {
    const found = connection.subscribes().filter((s) => s.topic === topic).at(-1);
    if (found === undefined) throw new Error(`no subscription to ${topic}`);
    connection.push({ type: 'snapshot', id: found.id, value });
    await tick();
  };
  /** The weekend phase `weekend` and its session-phase machine's open span `open`. */
  const show = async (weekend: Weekend, open: OpenSpan | undefined, clock: OpenSpan = span('clock', 'running')) => {
    await push('situation.weekendPhase', spans(span('weekend-phase', weekend, {})));
    await push('situation.clock', spans(clock));
    await push(TOPIC[weekend], spans(...(open === undefined ? [] : [open])));
  };
  return { push, show };
};
const phaseText = (): string | undefined => screen.queryByTestId('phase')?.textContent ?? undefined;

describe('the phase label', () => {
  it('formation: FORMATION', async () => {
    const t = await setup();
    await t.show('race', span('session-phase-race', 'formation'));
    expect(phaseText()).toBe(text.topBar.phase.formation);
  });

  it('startLights: START', async () => {
    const t = await setup();
    await t.show('race', span('session-phase-race', 'startLights'));
    expect(phaseText()).toBe(text.topBar.phase.startLights);
  });

  it('neutralised by the safety car: SC with its latest stage', async () => {
    const t = await setup();
    await t.show('race', neutralised('SC', 'returning'));
    expect(phaseText()).toContain(text.topBar.phase.sc);
    expect(phaseText()).toContain(text.topBar.phaseStage.returning);
  });

  it('neutralised by the virtual safety car: VSC with its latest stage', async () => {
    const t = await setup();
    await t.show('race', neutralised('VSC', 'resume'));
    expect(phaseText()).toContain(text.topBar.phase.vsc);
    expect(phaseText()).not.toContain(text.topBar.phase.sc + ' ');
    expect(phaseText()).toContain(text.topBar.phaseStage.resume);
  });

  it('suspended: RED, in every weekend phase', async () => {
    for (const weekend of ['race', 'qualifying', 'practice'] as const) {
      const t = await setup();
      await t.show(weekend, span(`session-phase-${weekend}`, 'suspended', { restart: { known: false, reason: 'notReceived' } }));
      expect(phaseText()).toBe(text.topBar.phase.red);
      cleanup();
    }
  });

  it('finished and postSession: FINISHED', async () => {
    for (const kind of ['finished', 'postSession']) {
      const t = await setup();
      await t.show('qualifying', span('session-phase-qualifying', kind));
      expect(phaseText()).toBe(text.topBar.phase.finished);
      cleanup();
    }
  });

  it('the clock paused: PAUSED, over a hidden phase', async () => {
    const t = await setup();
    await t.show('race', span('session-phase-race', 'racing'), span('clock', 'paused', { source: 'online', wallMs: 100 }));
    expect(phaseText()).toBe(text.topBar.phase.paused);
  });

  it('reads the session-phase machine of the weekend phase only', async () => {
    const t = await setup();
    await t.push('situation.weekendPhase', spans(span('weekend-phase', 'qualifying')));
    await t.push('situation.clock', spans(span('clock', 'running')));
    await t.push(TOPIC.race, spans(span('session-phase-race', 'formation')));
    await t.push(TOPIC.qualifying, spans(span('session-phase-qualifying', 'finished')));
    expect(phaseText()).toBe(text.topBar.phase.finished);
  });
});

describe('hidden', () => {
  it('while racing (race) and running (qualifying, practice) and on the grid', async () => {
    for (const [weekend, kind] of [['race', 'racing'], ['race', 'grid'], ['qualifying', 'running'], ['qualifying', 'grid'], ['practice', 'running'], ['practice', 'grid']] as const) {
      const t = await setup();
      await t.show(weekend, span(`session-phase-${weekend}`, kind));
      expect(phaseText(), `${weekend} ${kind}`).toBeUndefined();
      cleanup();
    }
  });

  it('no label while the weekend phase is pending (no open span) or none', async () => {
    const t = await setup();
    await t.push('situation.weekendPhase', spans());
    await t.push('situation.clock', spans(span('clock', 'running')));
    await t.push(TOPIC.race, spans(span('session-phase-race', 'formation')));
    expect(phaseText()).toBeUndefined();
    await t.push('situation.weekendPhase', spans(span('weekend-phase', 'none')));
    await t.push(TOPIC.race, spans(span('session-phase-race', 'suspended')));
    expect(phaseText()).toBeUndefined();
  });
});

describe('the phase presentation table (C66)', () => {
  it('has a row for every kind of the three session-phase machines, and for no other', () => {
    for (const machine of PHASE_MACHINES) {
      const declared = SPAN_DECLARATIONS.find((d) => d.machine === machine)?.kinds ?? [];
      expect(declared.length, machine).toBeGreaterThan(0);
      expect(Object.keys(phasePresentation[machine]).sort(), machine).toEqual([...declared].sort());
    }
    expect(Object.keys(phasePresentation).sort()).toEqual([...PHASE_MACHINES].sort());
  });

  it('every label is a word of kit/text.ts, and only SC, VSC and RED carry the attention role', () => {
    for (const machine of PHASE_MACHINES) {
      for (const [kind, row] of Object.entries<{ label: string | undefined; role: string | undefined }>(phasePresentation[machine])) {
        if (row.label !== undefined && row.label !== 'neutralised') expect(Object.hasOwn(text.topBar.phase, row.label), `${machine} ${kind}`).toBe(true);
        expect(row.role === undefined || row.role === 'warning', `${machine} ${kind}`).toBe(true);
        expect(row.role === 'warning', `${machine} ${kind}`).toBe(kind === 'neutralised' || kind === 'suspended');
      }
    }
  });

  it('phaseOf resolves a neutralised span by its car and hides the resting kinds', () => {
    expect(phaseOf('session-phase-race', neutralised('SC'))).toEqual({ label: 'sc', role: 'warning' });
    expect(phaseOf('session-phase-race', neutralised('VSC'))).toEqual({ label: 'vsc', role: 'warning' });
    expect(phaseOf('session-phase-race', span('session-phase-race', 'racing'))).toBeUndefined();
    expect(phaseOf('session-phase-practice', span('session-phase-practice', 'running'))).toBeUndefined();
  });
});
