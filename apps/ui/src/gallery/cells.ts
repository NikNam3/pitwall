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

/**
 * Whether a widget cell has a screenshot baseline (the e2e screenshot spec compares only these; the fit spec checks every
 * cell): the widget's first case (its first moment if it has no cases) at each mode's minimum, in the default theme.
 */
export function hasBaseline(cell: WidgetCell, entry: CellSource, defaultTheme: string): boolean {
  const first = Object.keys(entry.cases ?? {})[0];
  const data: GalleryData | undefined = first === undefined ? (entry.moments[0] === undefined ? undefined : { kind: 'moment', name: entry.moments[0] }) : { kind: 'case', name: first };
  return cell.size.id === cell.size.mode && cell.theme.name === defaultTheme && data !== undefined && cell.data.kind === data.kind && cell.data.name === data.name;
}

/** What a shell cell shows (Task 4, spec 10): the top bar under one of its cases, or a shell overlay. */
export type ShellCellKind = 'topbar' | 'palette' | 'key-overview' | 'settings-popover' | 'inspector' | 'basis-picker' | 'plan-save';

/** One cell of the shell: the top bar, a shell overlay, or the panel overlays of `feed-status`. */
export type ShellCell = {
  id: string;
  kind: ShellCellKind;
  /** The top-bar case, the palette query, or the widget the overlay belongs to. */
  detail?: string;
  /** True when the e2e spec compares the cell with a screenshot (few on purpose: the budget); `fit.spec` checks every one. */
  hasBaseline: boolean;
};

/**
 * The cells the gallery owes the shell. Ids are `shell/<kind>[/<detail>]`; the palette is open with the query `font`
 * and the settings popover and inspector are those of `feed-status`. The gallery draws each as a `data-gallery-id` figure.
 * Only the realism-pending and replay-transport top bars and the basis picker's first case keep a baseline (SP4.3b2
 * budget; SP4.3e Task 7c-2: one misc baseline for the picker). The basis picker's cells are its `BASIS_CASES`
 * (`basis-cases.ts`), drawn as the overlay on the window's feed.
 */
export const SHELL_CELLS: readonly ShellCell[] = [
  { id: 'shell/topbar/race-alert', kind: 'topbar', detail: 'race-alert', hasBaseline: false },
  { id: 'shell/topbar/realism-pending', kind: 'topbar', detail: 'realism-pending', hasBaseline: true },
  { id: 'shell/topbar/replay-transport', kind: 'topbar', detail: 'replay-transport', hasBaseline: true },
  { id: 'shell/topbar/battle', kind: 'topbar', detail: 'battle', hasBaseline: false },
  { id: 'shell/topbar/basis-none', kind: 'topbar', detail: 'basis-none', hasBaseline: false },
  { id: 'shell/topbar/basis-laps-differ', kind: 'topbar', detail: 'basis-laps-differ', hasBaseline: false },
  { id: 'shell/topbar/planning-no-round', kind: 'topbar', detail: 'planning-no-round', hasBaseline: false },
  { id: 'shell/topbar/planning-round', kind: 'topbar', detail: 'planning-round', hasBaseline: false },
  { id: 'shell/topbar/planning-rebuilding', kind: 'topbar', detail: 'planning-rebuilding', hasBaseline: false },
  { id: 'shell/topbar/planning-no-race-samples', kind: 'topbar', detail: 'planning-no-race-samples', hasBaseline: false },
  { id: 'shell/basis-picker/own-weekend', kind: 'basis-picker', detail: 'own-weekend', hasBaseline: true },
  { id: 'shell/basis-picker/none', kind: 'basis-picker', detail: 'none', hasBaseline: false },
  { id: 'shell/basis-picker/last-choice', kind: 'basis-picker', detail: 'last-choice', hasBaseline: false },
  { id: 'shell/basis-picker/rebuilding', kind: 'basis-picker', detail: 'rebuilding', hasBaseline: false },
  { id: 'shell/basis-picker/laps-differ', kind: 'basis-picker', detail: 'laps-differ', hasBaseline: false },
  { id: 'shell/basis-picker/planning-texas-pair', kind: 'basis-picker', detail: 'planning-texas-pair', hasBaseline: false },
  { id: 'shell/basis-picker/planning-two-teams', kind: 'basis-picker', detail: 'planning-two-teams', hasBaseline: false },
  { id: 'shell/basis-picker/planning-stale', kind: 'basis-picker', detail: 'planning-stale', hasBaseline: false },
  { id: 'shell/basis-picker/planning-none-stored', kind: 'basis-picker', detail: 'planning-none-stored', hasBaseline: false },
  // SP4.3f Task 10: the name prompt "Save plan" (`plan-save-cases.ts`), no baseline (budget).
  { id: 'shell/plan-save/one-saved', kind: 'plan-save', detail: 'one-saved', hasBaseline: false },
  { id: 'shell/palette', kind: 'palette', detail: 'font', hasBaseline: false },
  { id: 'shell/key-overview', kind: 'key-overview', hasBaseline: false },
  { id: 'shell/settings-popover/feed-status', kind: 'settings-popover', detail: 'feed-status', hasBaseline: false },
  { id: 'shell/inspector/feed-status', kind: 'inspector', detail: 'feed-status', hasBaseline: false },
];
