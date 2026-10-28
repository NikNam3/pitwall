import { FONT_FAMILY } from './themes.ts';
import type { ThemeVariant } from './themes.ts';
import { roleVar } from './roles.ts';
import type { Role } from './roles.ts';

/** Publish a variant as CSS variables on `root`; switching variants overwrites them all. */
export function applyTheme(variant: ThemeVariant, root: HTMLElement): void {
  const set = (name: string, value: string): void => root.style.setProperty(name, value);
  for (const [r, value] of Object.entries(variant.roles) as [Role, string][]) set(roleVar(r), value);
  set('--pw-font', FONT_FAMILY);
  set('--pw-font-px', `${variant.fontPx}px`);
  set('--pw-line', String(variant.density.lineHeight));
  set('--pw-panel-gap', `${variant.density.panelGapPx}px`);
  set('--pw-col-gap', `${variant.density.columnGapCols}ch`);
  set('--pw-chart-line', String(variant.chart.lineWidth));
  set('--pw-chart-own-line', String(variant.chart.ownCarLineWidth));
  set('--pw-chart-stale-alpha', String(variant.chart.staleAlpha));
  set('--pw-chart-dash', variant.chart.dash.join(' '));
  set('--pw-chart-x-lap', String(variant.chart.xPerCell.lap));
  set('--pw-chart-x-session', String(variant.chart.xPerCell.sessionTime));
  set('--pw-border-px', `${variant.table.borderPx}px`);
  set('--pw-bar-px', `${variant.table.barPx}px`);
  set('--pw-weight-bold', String(variant.table.boldWeight));
  set('--pw-header-pad', `${variant.density.headerPadCols}ch`);
}
