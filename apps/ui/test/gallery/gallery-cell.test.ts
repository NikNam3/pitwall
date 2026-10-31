// @vitest-environment jsdom
// A gallery moment case of a display that reads a per-car topic (Task M). Contract assumed of
// `apps/ui/src/gallery/GalleryCell.svelte`: props `id`, `theme`, `widget` (a `RegisteredWidget`), `widgetName`,
// `cols`, `rows`, `moment: MomentValues`; the cell links its panel to the moment's `session.info` `playerCar`, and its
// `GalleryConnection` answers the panel's `{ carId }` subscription with the moment entry of those params.
import type { SessionInfo } from '@pitwall/contracts';
import { carId, feedId, known, toSessionTime, unknown, type FuelState } from '@pitwall/domain';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TopicStore } from '../../src/connection/topic-store.svelte.ts';
import GalleryCell from '../../src/gallery/GalleryCell.svelte';
import { GalleryConnection } from '../../src/gallery/gallery-connection.ts';
import type { MomentValues } from '../../src/gallery/moment-values.ts';
import { registerWidget } from '../../src/kit/define-widget.ts';
import type { ResolvedLink } from '../../src/kit/types.ts';
import { formatLaps } from '../../src/kit/values/format.ts';
import Panel from '../../src/shell/panel/Panel.svelte';
import { defaultPanel } from '../../src/shell/workbooks/default-panel.ts';
import { THEMES } from '../../src/theme/index.ts';
import fuelGauge from '../../src/widgets/fuel-gauge/register.ts';
import { widget } from '../../src/widgets/fuel-gauge/widget.ts';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: { width: 600, height: 400 } }]);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const at = toSessionTime(100);
const fuel = (lapsOfFuel: number): FuelState => ({
  kg: known(31.4, at),
  burnKgPerLap: known(1.62, at),
  lapsOfFuel: known(lapsOfFuel, at),
  lapsLeft: known(17.6, at),
  marginLaps: known(1.8, at),
  saveTargetKgPerLap: unknown('notApplicable'),
  gameRemainingLaps: known(1.6, at),
  mix: known('standard', at),
});

const PLAYER = carId(1);
const session = { playerCar: PLAYER, realism: false } as unknown as SessionInfo;
// The player's entry and another car's, as a moment holds a per-car topic once per active car.
const moment: MomentValues = [
  { topic: 'session.info', params: {}, value: session },
  { topic: 'fuel.car', params: { carId: 0 }, value: fuel(11.1) },
  { topic: 'fuel.car', params: { carId: PLAYER }, value: fuel(19.4) },
];

const FULL = widget.sizes.full!;

describe('GalleryCell', () => {
  it("renders a per-car display's moment case with the player car's value from the moment", async () => {
    const { container } = render(GalleryCell, {
      id: 'fuel-gauge/full/moment/default',
      theme: THEMES[0]!,
      widget: fuelGauge,
      widgetName: widget.name,
      cols: FULL.minCols,
      rows: FULL.minRows,
      moment,
    });
    await waitFor(() => expect(container.textContent).toContain(formatLaps(19.4)));
    expect(container.textContent).not.toContain(formatLaps(11.1));
  });
});

describe('GalleryCell: one import per widget', () => {
  it("imports a widget's component once, however many cells and panels show it", async () => {
    // The gallery draws a widget in hundreds of cells, and the cell and its panel each ask for the component. Every
    // call of a built loader runs Vite's preload helper, which scans the whole page for a nonce meta tag: once per
    // cell that grew with the page and made opening the gallery slow enough to time out under load. The one import is
    // the registry's (`registerWidget`, review 7 R7-4): the gallery hands the registered widget on as it is.
    const load = vi.fn(() => import('../../src/widgets/fuel-gauge/FuelGauge.svelte'));
    const counted = registerWidget(widget, load);
    const cell = (id: string) =>
      render(GalleryCell, { id, theme: THEMES[0]!, widget: counted, widgetName: widget.name, cols: FULL.minCols, rows: FULL.minRows, moment });
    const views = [cell('fuel-gauge/full/moment/a'), cell('fuel-gauge/full/moment/b'), cell('fuel-gauge/full/moment/c')];
    for (const { container } of views) await waitFor(() => expect(container.querySelector('[data-ready]')).not.toBeNull());
    await waitFor(() => expect(views.every(({ container }) => container.textContent?.includes(formatLaps(19.4)))).toBe(true));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("the gallery and the app load the component through the registry's loader: one import across both", async () => {
    // Review 8, R8-5: the gallery hands its panel the registered widget it was given, and the app's panel gets the same
    // one, so both show what the registry's loader gives (here a probe, not the fuel gauge) from its one import. A gallery
    // that loaded the component by another path (its own loader or memo, the widget list) would show the real fuel
    // gauge, or import twice.
    const load = vi.fn(() => import('./RegistryProbe.svelte'));
    const counted = registerWidget(widget, load);
    const probeIn = (c: HTMLElement) => c.querySelector('[data-testid="registry-probe"]');
    const inGallery = render(GalleryCell, {
      id: 'fuel-gauge/full/moment/a', theme: THEMES[0]!, widget: counted, widgetName: widget.name, cols: FULL.minCols, rows: FULL.minRows, moment,
    }).container;
    await waitFor(() => expect(probeIn(inGallery)).not.toBeNull());
    // The app's panel: the shell's Panel on its own store, as a workbook window draws it.
    const store = new TopicStore(new GalleryConnection(moment, []));
    const link: ResolvedLink = { group: 1, feedId: feedId('gallery'), primary: PLAYER, compare: [], window: { kind: 'live' } };
    const inApp = render(Panel, { store, spec: defaultPanel(counted.decl), widget: counted, link }).container;
    try {
      await waitFor(() => expect(probeIn(inApp)).not.toBeNull());
      expect(inGallery.textContent).not.toContain(formatLaps(19.4));
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      store.dispose();
    }
  });
});
