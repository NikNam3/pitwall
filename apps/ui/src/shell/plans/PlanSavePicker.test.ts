// @vitest-environment jsdom
// SP4.3f Task 10 (spec §4.4 "Saving in the panel"; the user's layout of 2026-11-18 in the plan's Task 10; C64, C68,
// C73): the name prompt `Save plan`. Contract assumed of `PlanSavePicker.svelte` (props as `BasisPicker`: `store`,
// `feedId`, `send` resolving with the uiAction's outcome, `onClose`):
//  - it reads the feed's `plans.prepared` through the store (C64); with an open round it shows
//    `[data-testid="plan-save-picker"]`, titled `Save plan`;
//  - the name field `<input data-testid="plan-save-name">` is prefilled `<track name> <day> <hh:mm>` of now (the
//    window's clock; the track named as the top bar names tracks, `formatTrack`): track 15 at 18 Nov 17:20 local is
//    `Texas 18 Nov 17:20`;
//  - one `<input type="radio" data-testid="plan-save-replaces-<id>">` per saved plan of `plans.prepared.saved`, newest
//    first, its label `overwrite <name>`; none checked at first;
//  - the draft is window-local (C73): typing and choosing send nothing;
//  - `<button data-testid="plan-save-confirm">` (`Save`) sends exactly one `{ kind: 'plans.save', feedId, name? ,
//    replaces? }`: `name` the field's text trimmed, absent when that is empty (the bridge names it); `replaces` the
//    chosen plan's id, absent while none is chosen;
//  - an ok outcome calls `onClose`; a rejection keeps the prompt open with the bridge's message in
//    `[data-testid="plan-save-error"]`;
//  - `<button data-testid="plan-save-cancel">` (`cancel`) calls `onClose` and sends nothing.
// Fails until the component exists (implementation): the import of `./PlanSavePicker.svelte` fails to resolve.
import type { ActionOutcome, PlanningRoundState, UiAction } from '@pitwall/contracts';
import { carId, feedId, unknown } from '@pitwall/domain';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeConnection } from '../../../test/connection/fake-connection.ts';
import { TopicStore } from '../../connection/topic-store.svelte.ts';
import PlanSavePicker from './PlanSavePicker.svelte';

const FEED = feedId('20777');
const TEXAS = 15;

const MORNING = { id: 'a', name: 'Texas 18 Nov 09:40', savedAt: '2026-11-18T08:40:00Z' };
const OLDER = { id: 'b', name: 'Texas 4 Nov', savedAt: '2026-11-04T21:10:00Z' };

const QUALIFYING = { sessionUid: '12101553556244014932', weekendId: '548397152' };
const open = (saved: PlanningRoundState['saved']): PlanningRoundState => ({
  open: true,
  qualifying: QUALIFYING,
  practice: [],
  race: { laps: 56, sets: 'fresh', conditions: { kind: 'imported' } },
  team: 0,
  trackId: TEXAS,
  playerCar: carId(0),
  teammateCar: carId(1),
  forecast: { source: { ref: QUALIFYING, startedAt: '2026-11-17T19:10:00.000Z' }, rows: unknown('notReceived') },
  rebuilding: false,
  cars: {},
  running: false,
  saved,
});

/** The window's clock in the test: 18 Nov 2026, 17:20 local (only `Date` is faked). */
const setClock = (hours: number, minutes: number): void => {
  vi.setSystemTime(new Date(2026, 10, 18, hours, minutes, 7));
};
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  setClock(17, 20);
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

type Answer = (outcome: ActionOutcome) => void;

const mount = async (saved: PlanningRoundState['saved'] = [MORNING]) => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x', team: 0 }] });
  const answers: Answer[] = [];
  const send = vi.fn((_action: UiAction) => new Promise<ActionOutcome>((resolve) => answers.push(resolve)));
  const onClose = vi.fn();
  render(PlanSavePicker, { store, feedId: FEED, send, onClose });
  await tick();
  const found = connection.subscribes().filter((s) => s.topic === 'plans.prepared' && s.feedId === FEED).at(-1);
  if (found === undefined) throw new Error('the prompt holds no subscription to plans.prepared for its feed');
  connection.push({ type: 'snapshot', id: found.id, value: open(saved) });
  await tick();
  const root = screen.getByTestId('plan-save-picker');
  const answer = async (outcome: ActionOutcome): Promise<void> => {
    answers.at(-1)?.(outcome);
    await tick();
    await tick();
  };
  return { root, send, onClose, answer, sent: () => send.mock.calls.map(([a]) => a) };
};

const get = (root: HTMLElement, id: string): HTMLInputElement => {
  const el = root.querySelector(`[data-testid="${id}"]`);
  if (el === null) throw new Error(`no ${id}`);
  return el as HTMLInputElement;
};
const textOf = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const labelOf = (el: Element): string => textOf(el.closest('label'));
const radios = (root: HTMLElement): HTMLInputElement[] => [...root.querySelectorAll<HTMLInputElement>('[data-testid^="plan-save-replaces-"]')];
/** Sets the name field as typing does. */
const typeName = async (root: HTMLElement, value: string): Promise<void> => {
  const field = get(root, 'plan-save-name');
  field.value = value;
  await fireEvent.input(field);
};

describe('the name prompt "Save plan" (C64, C73)', () => {
  it('prefills the name "Texas <day> <hh:mm>" of the window\'s clock and offers one overwrite radio per saved plan, none chosen', async () => {
    const { root, send } = await mount();
    expect(textOf(root)).toContain('Save plan');
    expect(get(root, 'plan-save-name').value).toBe('Texas 18 Nov 17:20');
    expect(radios(root).map((r) => r.getAttribute('data-testid'))).toEqual(['plan-save-replaces-a']);
    const radio = get(root, 'plan-save-replaces-a');
    expect(radio.type).toBe('radio');
    expect(radio.checked).toBe(false);
    expect(labelOf(radio)).toBe('overwrite Texas 18 Nov 09:40');
    expect(textOf(get(root, 'plan-save-confirm'))).toBe('Save');
    expect(textOf(get(root, 'plan-save-cancel'))).toBe('cancel');
    expect(send).not.toHaveBeenCalled();
  });

  it('the prefill is the time of day now (hh:mm, two digits)', async () => {
    setClock(9, 5);
    const { root } = await mount();
    expect(get(root, 'plan-save-name').value).toBe('Texas 18 Nov 09:05');
  });

  it('the saved plans newest first', async () => {
    const { root } = await mount([OLDER, MORNING]);
    expect(radios(root).map((r) => r.getAttribute('data-testid'))).toEqual(['plan-save-replaces-a', 'plan-save-replaces-b']);
    expect(radios(root).map(labelOf)).toEqual(['overwrite Texas 18 Nov 09:40', 'overwrite Texas 4 Nov']);
  });

  it('Save sends one plans.save { feedId, name } with the prefilled name', async () => {
    const { root, sent } = await mount();
    await fireEvent.click(get(root, 'plan-save-confirm'));
    expect(sent()).toEqual([{ kind: 'plans.save', feedId: FEED, name: 'Texas 18 Nov 17:20' }]);
    expect(Object.keys(sent()[0]!)).not.toContain('replaces');
  });

  it('a typed name is sent trimmed; typing sends nothing', async () => {
    const { root, sent } = await mount();
    await typeName(root, '  Texas wet  ');
    expect(sent()).toEqual([]);
    await fireEvent.click(get(root, 'plan-save-confirm'));
    expect(sent()).toEqual([{ kind: 'plans.save', feedId: FEED, name: 'Texas wet' }]);
  });

  it('with the radio chosen, Save sends replaces: "a"', async () => {
    const { root, sent } = await mount();
    await fireEvent.click(get(root, 'plan-save-replaces-a'));
    expect(get(root, 'plan-save-replaces-a').checked).toBe(true);
    expect(sent()).toEqual([]);
    await fireEvent.click(get(root, 'plan-save-confirm'));
    expect(sent()).toEqual([{ kind: 'plans.save', feedId: FEED, name: 'Texas 18 Nov 17:20', replaces: 'a' }]);
  });

  it('an empty name sends no name (the bridge names it)', async () => {
    const { root, sent } = await mount();
    await typeName(root, '   ');
    await fireEvent.click(get(root, 'plan-save-confirm'));
    expect(sent()).toHaveLength(1);
    expect(sent()[0]).toEqual({ kind: 'plans.save', feedId: FEED });
    expect(Object.keys(sent()[0]!).sort()).toEqual(['feedId', 'kind']);
  });

  it('ok closes the prompt', async () => {
    const { root, onClose, answer } = await mount();
    await fireEvent.click(get(root, 'plan-save-confirm'));
    expect(onClose).not.toHaveBeenCalled();
    await answer({ ok: true });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a rejection shows its message and the prompt stays', async () => {
    const { root, onClose, answer } = await mount();
    await fireEvent.click(get(root, 'plan-save-confirm'));
    await answer({ ok: false, reason: 'invalid', message: 'no round to save' });
    expect(textOf(screen.getByTestId('plan-save-error'))).toContain('no round to save');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('plan-save-picker')).toBeTruthy();
  });

  it('cancel closes the prompt and sends nothing', async () => {
    const { root, onClose, send } = await mount();
    await typeName(root, 'draft');
    await fireEvent.click(get(root, 'plan-save-replaces-a'));
    await fireEvent.click(get(root, 'plan-save-cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});
