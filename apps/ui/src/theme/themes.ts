import type { Role } from './roles.ts';

/** Spacing tokens: the one place density is decided. */
export type Density = { lineHeight: number; panelGapPx: number; columnGapCols: number; headerPadCols: number };

/** A complete look: every role, the default font size and the density. */
export type ThemeVariant = { name: string; roles: Record<Role, string>; fontPx: number; density: Density };

export const FONT_FAMILY = "'JetBrains Mono', monospace";

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

const quiet: ThemeVariant = { name: 'quiet', roles: QUIET_ROLES, fontPx: 14, density: QUIET_DENSITY };

/** Every selectable variant. Colour variants are named after the open question (spec 13) they settle. */
export const THEMES: ThemeVariant[] = [
  quiet,
  { ...quiet, name: 'quiet-roomy', density: { lineHeight: 1.6, panelGapPx: 12, columnGapCols: 2, headerPadCols: 1 } },
  // Open question: compound as a letter, or a letter plus colour.
  {
    ...quiet,
    name: 'quiet-compound-colour',
    roles: { ...QUIET_ROLES, compoundSoft: '#ff7a70', compoundMedium: '#f5d547', compoundHard: '#ffffff' },
  },
  // Open question: which personal-best sectors light up (here none: only overall best is coloured).
  {
    ...quiet,
    name: 'quiet-personal-best-unlit',
    roles: { ...QUIET_ROLES, personalBest: QUIET_ROLES.text },
  },
];
