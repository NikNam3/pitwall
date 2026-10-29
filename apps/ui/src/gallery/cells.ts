// Which cells the gallery owes a widget (spec 9.1, 9.2): its sizes × its moments and cases × the themes.
import type { RegisteredWidget } from '../kit/types.ts';
import type { ThemeVariant } from '../theme/index.ts';

/** The part of a widget's `gallery.ts` the cells depend on. */
export type CellSource = { moments: string[]; cases?: Record<string, unknown> | undefined; fit?: Array<{ mode: string; cols: number; rows: number }> | undefined };

/** One size the gallery draws a widget at. */
export type GallerySize = { id: string; mode: string; cols: number; rows: number };

/** What fills a cell: a recorded moment, or a synthetic case of the widget's `gallery.ts`. */
export type GalleryData = { kind: 'moment' | 'case'; name: string };

/** One widget cell of the gallery. */
export type WidgetCell = { id: string; widget: RegisteredWidget; size: GallerySize; data: GalleryData; theme: ThemeVariant };

/** Each mode's minimum, then the `fit` entries that are not one (as `<mode>-<cols>x<rows>`, so ids stay unique). */
export function gallerySizes(widget: RegisteredWidget, entry: Pick<CellSource, 'fit'>): GallerySize[] {
  const minimums = Object.entries(widget.decl.sizes).map(([mode, s]) => ({ id: mode, mode, cols: s.minCols, rows: s.minRows }));
  const extras = (entry.fit ?? [])
    .filter((f) => !minimums.some((m) => m.mode === f.mode && m.cols === f.cols && m.rows === f.rows))
    .map((f) => ({ id: `${f.mode}-${f.cols}x${f.rows}`, mode: f.mode, cols: f.cols, rows: f.rows }));
  return [...minimums, ...extras];
}

/** The stable id Task 22 addresses a cell by: `<widget>/<size>/<moment-or-case>/<theme>`. */
export const cellId = (widget: string, size: string, data: string, theme: string): string => `${widget}/${size}/${data}/${theme}`;

/** Every cell of `widget`, sizes outermost, then moments and cases, then themes. */
export function widgetCells(widget: RegisteredWidget, entry: CellSource, themes: readonly ThemeVariant[]): WidgetCell[] {
  const data: GalleryData[] = [
    ...entry.moments.map((name) => ({ kind: 'moment' as const, name })),
    ...Object.keys(entry.cases ?? {}).map((name) => ({ kind: 'case' as const, name })),
  ];
  return gallerySizes(widget, entry).flatMap((size) =>
    data.flatMap((d) => themes.map((theme) => ({ id: cellId(widget.decl.name, size.id, d.name, theme.name), widget, size, data: d, theme }))),
  );
}

/** What a shell cell shows (Task 4, spec 10): the top bar under one of its cases, or a shell overlay. */
export type ShellCellKind = 'topbar' | 'palette' | 'key-overview' | 'settings-popover' | 'inspector';

/** One cell of the shell: the top bar, a shell overlay, or the panel overlays of `feed-status`. */
export type ShellCell = { id: string; kind: ShellCellKind; /** The top-bar case, the palette query, or the widget the overlay belongs to. */ detail?: string };

/**
 * The cells the gallery owes the shell. Ids are `shell/<kind>[/<detail>]`; the palette is open with the query `font`
 * and the settings popover and inspector are those of `feed-status`. The gallery draws each as a `data-gallery-id` figure.
 */
export const SHELL_CELLS: readonly ShellCell[] = [
  { id: 'shell/topbar/race-alert', kind: 'topbar', detail: 'race-alert' },
  { id: 'shell/topbar/realism-pending', kind: 'topbar', detail: 'realism-pending' },
  { id: 'shell/topbar/replay-transport', kind: 'topbar', detail: 'replay-transport' },
  { id: 'shell/topbar/battle', kind: 'topbar', detail: 'battle' },
  { id: 'shell/palette', kind: 'palette', detail: 'font' },
  { id: 'shell/key-overview', kind: 'key-overview' },
  { id: 'shell/settings-popover/feed-status', kind: 'settings-popover', detail: 'feed-status' },
  { id: 'shell/inspector/feed-status', kind: 'inspector', detail: 'feed-status' },
];
