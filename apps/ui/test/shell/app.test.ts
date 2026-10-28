// @vitest-environment jsdom
// App.svelte (Task 15): connection from `?ws=`, contract mismatch reload. `connection/connection.ts` and the dock are mocked.
import { CONTRACT_VERSION } from '@pitwall/contracts';
import { cleanup, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as text from '../../src/kit/text.ts';
import { FakeConnection } from '../connection/fake-connection.ts';

const mocks = vi.hoisted(() => ({ createWsConnection: vi.fn(), mountDock: vi.fn() }));
vi.mock('../../src/connection/connection.ts', () => ({ createWsConnection: mocks.createWsConnection }));
vi.mock('../../src/shell/docking/index.ts', () => ({ mountDock: mocks.mountDock }));

import App from '../../src/App.svelte';

let connection: FakeConnection;
const reload = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  connection = new FakeConnection();
  mocks.createWsConnection.mockReset().mockImplementation(() => connection);
  mocks.mountDock.mockReset().mockReturnValue({ addPanel: vi.fn(), updatePanel: vi.fn(), destroy: vi.fn() });
  reload.mockReset();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('location', { ...window.location, search: '?ws=4999', reload });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('connects to ws://127.0.0.1:<port> with the port from ?ws=', () => {
    render(App);
    expect(mocks.createWsConnection).toHaveBeenCalledTimes(1);
    expect(mocks.createWsConnection.mock.calls[0]![0]).toBe('ws://127.0.0.1:4999');
  });

  it('renders the window shell: it subscribes to ui.workbooks', () => {
    render(App);
    expect(connection.subscribes().map((s) => s.topic)).toContain('ui.workbooks');
  });

  it('a hello with the same contract version shows no notice and does not reload', async () => {
    render(App);
    connection.push({ type: 'hello', contractVersion: CONTRACT_VERSION, feeds: [] });
    await tick();
    await vi.advanceTimersByTimeAsync(5000);
    expect(screen.queryByText(text.bridgeUpdated)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('on a contract mismatch it shows the notice, and reloads after 2 s', async () => {
    render(App);
    connection.push({ type: 'hello', contractVersion: CONTRACT_VERSION + 1, feeds: [] });
    await tick();
    expect(screen.getByText(text.bridgeUpdated)).toBeTruthy();
    await vi.advanceTimersByTimeAsync(1999);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
