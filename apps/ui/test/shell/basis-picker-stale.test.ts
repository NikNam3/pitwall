// @vitest-environment jsdom
// SP4.3e Task 7c-2 (spec §4.2 "stale ones marked"; C61, C73): a candidate session whose stored log is stale (built by
// an older rules version, rebuilt on confirm) carries the mark `stale` in the picker; a current one does not.
// Needs `stale: boolean` on `BasisActive['sessions']` entries (`packages/contracts/src/topics/basis.active.ts`,
// requested of the supervisor): fails at typecheck until then, and at run time until the picker marks it.
import type { BasisActive } from '@pitwall/contracts';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../../src/shell/commands/registry.ts';
import { CLOSED_ROUND, P16, P17, Q17, SESSIONS, active, keyOf } from './basis-fixtures.ts';
import { TEST_WIDGETS } from './fixtures/index.ts';
import { FEED, group1, makeStore, stubBrowser, workbook } from './shell-harness.ts';

const mocks = vi.hoisted(() => ({ mountDock: vi.fn() }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import WindowShell from '../../src/shell/windows/WindowShell.svelte';

let registering: { mock: { contexts: unknown[] } } | undefined;

beforeEach(() => {
  mocks.mountDock.mockReset();
  mocks.mountDock.mockImplementation(() => ({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn(), setEditing: vi.fn(), focusPanel: vi.fn() }));
  stubBrowser();
  registering = vi.spyOn(CommandRegistry.prototype, 'register');
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const WITH_STALE: BasisActive['sessions'] = {
  [keyOf(P16)]: { ...SESSIONS[keyOf(P16)]!, stale: true },
  [keyOf(P17)]: { ...SESSIONS[keyOf(P17)]!, stale: false },
  [keyOf(Q17)]: { ...SESSIONS[keyOf(Q17)]!, stale: true },
};

describe('stale candidates', () => {
  it('a stale stored session is marked "stale", a current one is not', async () => {
    const ctx = makeStore();
    ctx.connection.push({ type: 'hello', contractVersion: 0, feeds: [{ feedId: FEED, kind: 'udp', label: 'x', team: null }] });
    render(WindowShell, { store: ctx.store, host: ctx.host, widgets: TEST_WIDGETS, defaultFeed: FEED });
    await ctx.push('ui.workbooks', { names: ['race'], active: workbook(16) });
    await ctx.push('ui.linkGroups', [group1()]);
    const registry = registering?.mock.contexts[0] as CommandRegistry;
    expect(registry.run('basis.pick')).toBe(true);
    await tick();
    const pushFeed = async (topic: string, value: unknown): Promise<void> => {
      const found = ctx.connection.subscribes().filter((s) => s.topic === topic && s.feedId === FEED).at(-1);
      if (found === undefined) throw new Error(`no subscription to ${topic} for the feed`);
      ctx.connection.push({ type: 'snapshot', id: found.id, value });
      await tick();
    };
    await pushFeed('basis.active', active({ sessions: WITH_STALE }));
    await pushFeed('plans.prepared', CLOSED_ROUND);
    const root = screen.getByTestId('basis-picker');
    const label = (id: string): string => (root.querySelector(`[data-testid="${id}"]`)?.closest('label')?.textContent ?? '').replace(/\s+/g, ' ');
    expect(label(`practice-${keyOf(P16)}`)).toContain('stale');
    expect(label(`qualifying-${keyOf(Q17)}`)).toContain('stale');
    expect(label(`practice-${keyOf(P17)}`)).not.toContain('stale');
  });
});
