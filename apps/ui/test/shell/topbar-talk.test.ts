// @vitest-environment jsdom
// The top bar's Talk segment (Task 12, contract C64, C65, C68).
// Contract the tests assume:
//  - `emphasis/talk.ts` `talkRole`; `kit/text.ts` `topBar.talk = { clear: 'good moment to talk', busy: 'braking: wait' }`;
//  - the model acquires `talkWindow.car` with `{ carId: playerCar }` once `session.info` names the player car, re-acquires it
//    when the player car changes (releasing the old params) and releases it in `release`; nothing before `session.info`;
//  - `TOP_BAR.left` holds `talk` right after `moment`; the segment renders a dot (test id `talk`, title the text, colour the
//    role) and nothing while `TopBarModel.talk` is undefined (unknown, notApplicable, no player car).
import { carId, feedId } from '@pitwall/domain';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import { talkRole } from '../../src/emphasis/talk.ts';
import * as text from '../../src/kit/text.ts';
import { TopBarModel } from '../../src/shell/topbar/model.svelte.ts';
import { TOP_BAR } from '../../src/shell/topbar/layout.ts';
import TopBar from '../../src/shell/topbar/TopBar.svelte';
import { role } from '../../src/theme/index.ts';
import { FakeConnection } from '../connection/fake-connection.ts';

const FEED = feedId('f1');
afterEach(cleanup);

const info = (playerCar: number) => ({ feedId: FEED, sessionUid: '1', playerCar: carId(playerCar), realism: false, session: { totalLaps: 62, timeLeftMs: 0 } });

const setup = () => {
  const connection = new FakeConnection();
  const store = new TopicStore(connection);
  connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x' }] });
  const view = render(TopBar, { store, feedId: FEED, send: () => {}, sendReplay: () => {} });
  const talkSubs = () => connection.subscribes().filter((s) => s.topic === 'talkWindow.car');
  const push = async (topic: string, value: unknown) => {
    const found = connection.subscribes().filter((s) => s.topic === topic).at(-1);
    if (found === undefined) throw new Error(`no subscription to ${topic}`);
    connection.push({ type: 'snapshot', id: found.id, value });
    await tick();
  };
  const pushTalk = (talk: unknown) => push('talkWindow.car', { talk: typeof talk === 'string' ? { known: true, at: 1000, value: talk } : talk });
  return { connection, store, view, talkSubs, push, pushTalk };
};
const dot = () => screen.queryByTestId('talk');

describe('the talk segment', () => {
  it('sits right after the moment segment', () => {
    const left: readonly string[] = TOP_BAR.left;
    expect(left.indexOf('talk')).toBe(left.indexOf('moment') + 1);
  });

  it('shows nothing before session.info and acquires nothing', async () => {
    const t = setup();
    await tick();
    expect(t.talkSubs()).toHaveLength(0);
    expect(dot()).toBeNull();
  });

  it('acquires talkWindow.car for the player car once session.info arrives', async () => {
    const t = setup();
    await t.push('session.info', info(5));
    expect(t.talkSubs().map((s) => s.params)).toEqual([{ carId: 5 }]);
  });

  it.each([
    ['clear', 'textDim', 'good moment to talk'],
    ['busy', 'warning', 'braking: wait'],
  ] as const)('%s renders a dot in role %s with its title', async (state, r, title) => {
    const t = setup();
    await t.push('session.info', info(5));
    await t.pushTalk(state);
    expect(talkRole(state)).toBe(r);
    const el = dot();
    expect(el).not.toBeNull();
    expect(el?.getAttribute('title')).toBe(title);
    expect(el?.getAttribute('style') ?? '').toContain(role(r));
  });

  it('the titles are the briefed wording', () => {
    expect(text.topBar.talk).toEqual({ clear: 'good moment to talk', busy: 'braking: wait' });
  });

  it('renders nothing while the talk window is unknown or notApplicable', async () => {
    const t = setup();
    await t.push('session.info', info(5));
    await t.pushTalk('busy');
    expect(dot()).not.toBeNull();
    await t.pushTalk({ known: false, reason: 'notApplicable' });
    expect(dot()).toBeNull();
    await t.pushTalk('clear');
    expect(dot()).not.toBeNull();
    await t.pushTalk({ known: false, reason: 'insufficientData' });
    expect(dot()).toBeNull();
  });

  it('releases the old params and acquires the new ones when the player car changes', async () => {
    const t = setup();
    await t.push('session.info', info(5));
    const first = t.talkSubs()[0]!;
    await t.push('session.info', info(7));
    expect(t.connection.unsubscribes().some((u) => u.id === first.id)).toBe(true);
    expect(t.talkSubs().map((s) => s.params)).toEqual([{ carId: 5 }, { carId: 7 }]);
  });

  it('does not re-acquire when session.info repeats the same player car', async () => {
    const t = setup();
    await t.push('session.info', info(5));
    await t.push('session.info', info(5));
    expect(t.talkSubs()).toHaveLength(1);
  });

  it('release gives the talkWindow.car subscription back', async () => {
    const t = setup();
    await t.push('session.info', info(5));
    const sub = t.talkSubs()[0]!;
    t.view.unmount();
    expect(t.connection.unsubscribes().some((u) => u.id === sub.id)).toBe(true);
  });
});

describe('TopBarModel.talk', () => {
  it('is undefined without a player car or data', () => {
    const connection = new FakeConnection();
    const store = new TopicStore(connection);
    connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x' }] });
    const model = new TopBarModel(store, FEED, () => {}, () => {});
    expect(model.talk).toBeUndefined();
    expect(connection.subscribes().filter((s) => s.topic === 'talkWindow.car')).toHaveLength(0);
    model.release();
  });
});
