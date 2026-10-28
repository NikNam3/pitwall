/* eslint-disable @typescript-eslint/no-explicit-any -- `any` is the wildcard of the widget contract's WidgetDecl */
// Reads a workbook leniently (spec 7.2): what this build cannot use is kept or reset, and each problem becomes a note.
import type { PanelSpec, Workbook, WorkbookWindow } from '@pitwall/contracts';
import type { OptionDecl, WidgetDecl } from '../../kit/types.ts';

/** One problem found while reading a workbook. Unknown widgets are kept unchanged; bad options are dropped. */
export type PanelNote =
  | { kind: 'unknownWidget'; windowId: string; panelId: string; widget: string }
  | { kind: 'invalidOption'; windowId: string; panelId: string; option: string; value: unknown }
  | { kind: 'unknownOption'; windowId: string; panelId: string; option: string };

/** True when `value` is a valid value of `decl`. */
function isValid(decl: OptionDecl<unknown>, value: unknown): boolean {
  switch (decl.kind) {
    case 'bool':
      return typeof value === 'boolean';
    case 'choice':
      return typeof value === 'string' && decl.choices.includes(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= decl.range.min && value <= decl.range.max;
    case 'car':
      return value === 'player' || value === 'teammate' || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
  }
}

function normalisePanel(
  windowId: string,
  panelId: string,
  panel: PanelSpec,
  widgets: ReadonlyMap<string, WidgetDecl<any, any>>,
  notes: PanelNote[],
): PanelSpec {
  const decl = widgets.get(panel.widget);
  if (decl === undefined) {
    notes.push({ kind: 'unknownWidget', windowId, panelId, widget: panel.widget });
    return panel;
  }
  const declared = decl.options as Record<string, OptionDecl<unknown>>;
  const options: Record<string, unknown> = {};
  for (const option of Object.keys(panel.options)) {
    if (!Object.hasOwn(declared, option)) notes.push({ kind: 'unknownOption', windowId, panelId, option });
  }
  for (const [option, optionDecl] of Object.entries(declared)) {
    const value = panel.options[option];
    if (value !== undefined && isValid(optionDecl, value)) {
      options[option] = value;
      continue;
    }
    if (value !== undefined) notes.push({ kind: 'invalidOption', windowId, panelId, option, value });
    // An undefined default (a car option following the link) stays absent, so the saved JSON has no holes.
    if (optionDecl.default !== undefined) options[option] = optionDecl.default;
  }
  return { ...panel, options };
}

function normaliseWindow(window: WorkbookWindow, widgets: ReadonlyMap<string, WidgetDecl<any, any>>, notes: PanelNote[]): WorkbookWindow {
  const panels: Record<string, PanelSpec> = {};
  for (const [panelId, panel] of Object.entries(window.panels)) panels[panelId] = normalisePanel(window.id, panelId, panel, widgets, notes);
  return { ...window, panels };
}

/** The workbook with every panel's options valid for its widget, plus a note per problem. Never mutates `w`. */
export function normaliseWorkbook(w: Workbook, widgets: ReadonlyMap<string, WidgetDecl<any, any>>): { workbook: Workbook; notes: PanelNote[] } {
  const notes: PanelNote[] = [];
  const windows = w.windows.map((window) => normaliseWindow(window, widgets, notes));
  return { workbook: { ...w, windows }, notes };
}
