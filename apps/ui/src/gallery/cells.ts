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
