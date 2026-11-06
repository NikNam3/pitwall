// @vitest-environment jsdom
// The track map's notes (spec 7.2, 8): without a track file (`trackPositions.geometry` `notApplicable`) the panel says
// "no track data" (`text.ts`) and draws no map; before the geometry is in (unknown for another reason) it says the kit's
// "no data yet", as the mockup does; with a geometry it draws the kit's track canvas and no note.
import { cleanup, render } from '@testing-library/svelte';
import { unknown } from '@pitwall/domain';
import type { Component } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InPanel from '../../../test/kit/InPanel.svelte';
import { noDataYet } from '../../kit/text.ts';
import { geometry, markers, noFile, trackCars } from './fixtures.ts';
import * as text from './text.ts';
import TrackMap from './TrackMap.svelte';

// The kit's track canvas measures its box with a ResizeObserver: report a 640 x 400 px box when observed.
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly cb: (entries: unknown[]) => void;
      constructor(cb: (entries: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: { width: 640, height: 400 } }]);
      }
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FULL = { mode: 'full', cols: 64, rows: 20, px: { width: 640, height: 400 }, dpr: 1 } as const;

const show = (data: Record<string, unknown>) =>
  render(InPanel, {
    component: TrackMap as unknown as Component<Record<string, unknown>>,
    widgetProps: { data, options: {}, size: FULL, link: {} },
  }).container;

/** The panel's text, whitespace collapsed. */
const textOf = (c: HTMLElement): string => (c.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('TrackMap: notes', () => {
  it('says "no track data" without a track file, and draws no map', () => {
    expect(text.noTrackData).toBe('no track data');
    const c = show({ ...noFile });
    expect(textOf(c)).toContain(text.noTrackData);
    expect(c.querySelector('canvas')).toBeNull();
  });

  it('says "no track data" with the markers not yet arrived', () => {
    const c = show({ geometry: noFile.geometry, cars: noFile.cars, markers: undefined });
    expect(textOf(c)).toContain(text.noTrackData);
  });

  it('says "no data yet" before the geometry is in', () => {
    const c = show({ geometry: unknown('notReceived'), cars: unknown('notReceived'), markers: undefined });
    expect(textOf(c)).toContain(noDataYet);
    expect(textOf(c)).not.toContain(text.noTrackData);
    expect(c.querySelector('canvas')).toBeNull();
  });

  it('draws the track canvas and no note with a geometry', () => {
    const c = show({ geometry: geometry(), cars: trackCars(), markers: markers(['collision', 0.75]) });
    expect(c.querySelector('canvas')).not.toBeNull();
    expect(textOf(c)).not.toContain(text.noTrackData);
    expect(textOf(c)).not.toContain(noDataYet);
  });

  it('draws the track canvas while the cars are unknown', () => {
    const c = show({ geometry: geometry(), cars: unknown('notReceived'), markers: undefined });
    expect(c.querySelector('canvas')).not.toBeNull();
  });
});
