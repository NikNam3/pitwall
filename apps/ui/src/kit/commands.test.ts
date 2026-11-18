// @vitest-environment jsdom
// SP4.3e Task 8 (C72, C73; planner report 6a): no silent `ok` outside a panel. Contract assumed of `kit/commands.ts`:
//  - `getWidgetCommands()` outside a panel context (no `setWidgetCommands` above: the gallery, a widget rendered alone)
//    gives an `invoke` that runs nothing and resolves `{ ok: false, reason: 'notSupported' }`, so a control wired to
//    nothing answers with a rejection instead of pretending it was done.
// The probe is test/shell's command-probe widget, rendered without a panel.
import { carId, feedId } from '@pitwall/domain';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick, type ComponentProps } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import CommandProbe from '../../test/shell/fixtures/command-probe/CommandProbe.svelte';
import type { ResolvedLink } from './types.ts';

const LINK: ResolvedLink = { group: 1, feedId: feedId('f1'), primary: carId(5), compare: [], window: { kind: 'live' } };

afterEach(cleanup);

describe('getWidgetCommands outside a panel', () => {
  it('getWidgetCommands() outside a panel context resolves { ok: false, reason: \'notSupported\' }', async () => {
    // The probe reads only `link`.
    const props = { link: LINK, data: {}, options: {}, size: { mode: 'compact', cols: 10, rows: 2, px: { width: 80, height: 40 }, dpr: 1 } };
    render(CommandProbe, props as unknown as ComponentProps<typeof CommandProbe>);
    await fireEvent.click(screen.getByTestId('laps'));
    await tick();
    await tick();
    expect(screen.getByTestId('outcome').textContent).toBe('notSupported');
  });
});
