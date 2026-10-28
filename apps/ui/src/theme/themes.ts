import type { Role } from './roles.ts';

/** Spacing tokens: the one place density is decided. */
export type Density = { lineHeight: number; panelGapPx: number; columnGapCols: number; headerPadCols: number };

/** Chart drawing tokens: line widths in px and the alpha of a series whose data is stale. */
export type ChartTokens = {
  lineWidth: number;
  ownCarLineWidth: number;
  staleAlpha: number;
  /** Dash pattern (px on, px off) of a teammate or second car line. */
  dash: [number, number];
  /** X units one character cell of chart width spans: a wider chart shows more history. */
  xPerCell: { lap: number; sessionTime: number };
};

/** Table drawing tokens: rule and marker widths in px, and the weight of the own car's row. */
export type TableTokens = { borderPx: number; barPx: number; boldWeight: number };

/** A complete look: every role, the default font size, the density and the chart tokens. */
export type ThemeVariant = { name: string; roles: Record<Role, string>; fontPx: number; density: Density; chart: ChartTokens; table: TableTokens };

export const FONT_FAMILY = "'JetBrains Mono', monospace";

const QUIET_CHART: ChartTokens = {
  lineWidth: 1.5,
  ownCarLineWidth: 3,
  staleAlpha: 0.35,
  dash: [6, 4],
  xPerCell: { lap: 0.5, sessionTime: 2000 },
};

const QUIET_TABLE: TableTokens = { borderPx: 1, barPx: 2, boldWeight: 700 };

const QUIET_DENSITY: Density = { lineHeight: 1.4, panelGapPx: 8, columnGapCols: 1, headerPadCols: 1 };

/** Approved Task 0 values (`quiet`). Letters-only compounds and unlit personal-best are not coloured here. */
const QUIET_ROLES: Record<Role, string> = {
  text: '#d9dbe0',
  textDim: '#8d9199',
  textFaint: '#5c6068',
  ownCar: '#ffffff',
  bg: '#000000',
  bgPanel: '#000000',
  bgBand: '#141416',
  bgRowBand: '#0d0d0f',
  border: '#25272c',
  grid: '#1c1d21',
  critical: '#ff5c5c',
  warning: '#f0b429',
  best: '#b06cff',
  personalBest: '#3fcf70',
  flagYellow: '#ffd23f',
  flagGreen: '#3fcf70',
  flagRed: '#ff5c5c',
  flagBlue: '#5ca8ff',
  compoundSoft: '#d9dbe0',
  compoundMedium: '#d9dbe0',
  compoundHard: '#d9dbe0',
  series1: 'oklch(0.72 0.09 250)',
  series2: 'oklch(0.72 0.09 40)',
  series3: 'oklch(0.72 0.09 150)',
  series4: 'oklch(0.72 0.09 310)',
  series5: 'oklch(0.72 0.09 95)',
  series6: 'oklch(0.72 0.09 200)',
};

/** The variant used before any theme is applied. */
export const DEFAULT_THEME: ThemeVariant = { name: 'quiet', roles: QUIET_ROLES, fontPx: 14, density: QUIET_DENSITY, chart: QUIET_CHART, table: QUIET_TABLE };

/** Every selectable variant. Colour variants are named after the open question (spec 13) they settle. */
export const THEMES: ThemeVariant[] = [
  DEFAULT_THEME,
  { ...DEFAULT_THEME, name: 'quiet-roomy', density: { lineHeight: 1.6, panelGapPx: 12, columnGapCols: 2, headerPadCols: 1 } },
  // Open question: compound as a letter, or a letter plus colour.
  {
    ...DEFAULT_THEME,
    name: 'quiet-compound-colour',
    roles: { ...QUIET_ROLES, compoundSoft: '#ff7a70', compoundMedium: '#f5d547', compoundHard: '#ffffff' },
  },
  // Open question: which personal-best sectors light up (here none: only overall best is coloured).
  {
    ...DEFAULT_THEME,
    name: 'quiet-personal-best-unlit',
    roles: { ...QUIET_ROLES, personalBest: QUIET_ROLES.text },
  },
];
