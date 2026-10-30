// @vitest-environment jsdom
// A gallery moment case of a display that reads a per-car topic (Task M). Contract assumed of
// `apps/ui/src/gallery/GalleryCell.svelte`: props `id`, `theme`, `widget` (a `RegisteredWidget`), `widgetName`,
// `cols`, `rows`, `moment: MomentValues`; the cell links its panel to the moment's `session.info` `playerCar`, and its
// `GalleryConnection` answers the panel's `{ carId }` subscription with the moment entry of those params.
import type { SessionInfo } from '@pitwall/contracts';
import { carId, known, toSessionTime, unknown, type FuelState } from '@pitwall/domain';
import { cleanup, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GalleryCell from '../../src/gallery/GalleryCell.svelte';
import type { MomentValues } from '../../src/gallery/moment-values.ts';
import { formatLaps } from '../../src/kit/values/format.ts';
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
