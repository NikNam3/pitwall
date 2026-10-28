// @vitest-environment jsdom
// The value cell (spec 5, 6.4). Contract the tests assume of Value.svelte:
//  - the cell is the element with class `value`; modifier classes `stale` and `estimated` are set when they apply;
//  - its colour is inline `color: <role(...)>` (textDim when estimated, textFaint when stale, stale wins);
//  - an unknown value renders no text and sets `title` to the reason;
//  - staleness uses the panel clock given to `providePanelStale({ now, cadenceMs })` and reports to the panel,
//    so `staleForMs` is a number while a value is stale and undefined otherwise.
import { cleanup, render } from '@testing-library/svelte';
import { unknown, known, type SessionTime } from '@pitwall/domain';
import { afterEach, describe, expect, it } from 'vitest';
import { role } from '../../src/theme/index.ts';
import StaleHarness from './StaleHarness.svelte';

afterEach(cleanup);

const T = (n: number) => n as SessionTime;
const cell = (c: HTMLElement) => c.querySelector('.value') as HTMLElement;
const staleFor = (c: HTMLElement) => c.querySelector('[data-testid="stale-for"]')?.textContent ?? '';

describe('Value: unknown', () => {
  it.each(['realism', 'restricted', 'notReceived', 'notApplicable'] as const)(
    'renders empty with title %s',
    (reason) => {
      const { container } = render(StaleHarness, { value: unknown(reason) });
      expect(cell(container).textContent?.trim()).toBe('');
      expect(cell(container).getAttribute('title')).toBe(reason);
    },
  );
});

describe('Value: known and plain', () => {
  it('formats a known value and a plain number the same way', () => {
    const a = render(StaleHarness, { value: known(7, T(0)) });
    expect(cell(a.container).textContent?.trim()).toBe('#7');
    cleanup();
    const b = render(StaleHarness, { value: 8 });
    expect(cell(b.container).textContent?.trim()).toBe('#8');
    expect(cell(b.container).getAttribute('title')).toBeNull();
  });

  it('estimated: ~ prefix, textDim, no stale class', () => {
    const { container } = render(StaleHarness, { value: 7, estimated: true });
    expect(cell(container).textContent?.trim()).toBe('~#7');
    expect(cell(container).style.color).toBe(role('textDim'));
    expect(cell(container).classList.contains('stale')).toBe(false);
  });
});

describe('Value: staleness of a car field', () => {
  const field = 'tyres.corners.surfaceTempC' as const; // telemetry, menu rate
  it('a telemetry value 200 ms behind a 50 ms cadence is stale: class, textFaint, staleForMs set', () => {
    const { container } = render(StaleHarness, {
      value: known(90, T(0)),
      car: { updatedAt: { telemetry: T(1000) }, field },
      now: 1200,
      cadenceMs: 50,
    });
    expect(cell(container).classList.contains('stale')).toBe(true);
    expect(cell(container).style.color).toBe(role('textFaint'));
    expect(Number(staleFor(container))).toBeGreaterThan(0);
  });

  it('a fresh value is not dimmed and leaves staleForMs unset', () => {
    const { container } = render(StaleHarness, {
      value: known(90, T(0)),
      car: { updatedAt: { telemetry: T(1000) }, field },
      now: 1100,
      cadenceMs: 50,
    });
    expect(cell(container).classList.contains('stale')).toBe(false);
    expect(staleFor(container)).toBe('');
  });

  it('a menu-rate value without cadence is never stale', () => {
    const { container } = render(StaleHarness, {
      value: known(90, T(0)),
      car: { updatedAt: { telemetry: T(0) }, field },
      now: 1_000_000,
    });
    expect(cell(container).classList.contains('stale')).toBe(false);
    expect(staleFor(container)).toBe('');
  });

  it('a field of a source that never arrived (no updatedAt) is not stale', () => {
    const { container } = render(StaleHarness, { value: known(90, T(0)), car: { updatedAt: {}, field }, now: 5000, cadenceMs: 50 });
    expect(cell(container).classList.contains('stale')).toBe(false);
  });

  it('a fixed-interval source uses its own interval: damage wear 301 ms old is stale', () => {
    const { container } = render(StaleHarness, {
      value: known(12, T(0)),
      car: { updatedAt: { damage: T(1000) }, field: 'tyres.corners.wearPct' },
      now: 1301,
      cadenceMs: 50,
    });
    expect(cell(container).classList.contains('stale')).toBe(true);
  });

  it('staleness wins over estimated for the colour', () => {
    const { container } = render(StaleHarness, {
      value: known(90, T(0)),
      estimated: true,
      car: { updatedAt: { telemetry: T(0) }, field },
      now: 1000,
      cadenceMs: 50,
    });
    expect(cell(container).style.color).toBe(role('textFaint'));
    expect(cell(container).textContent?.trim()).toBe('~#90');
  });

  it('staleForMs clears once the cell is gone', () => {
    const { container, unmount } = render(StaleHarness, {
      value: known(90, T(0)),
      car: { updatedAt: { telemetry: T(0) }, field },
      now: 1000,
      cadenceMs: 50,
    });
    expect(Number(staleFor(container))).toBeGreaterThan(0);
    unmount();
    expect(container.querySelector('.value')).toBeNull();
  });
});
