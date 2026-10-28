/** The compound the car runs (Car Status `m_actualTyreCompound`). */
export const ActualCompound = {
  C0: 'C0',
  C1: 'C1',
  C2: 'C2',
  C3: 'C3',
  C4: 'C4',
  C5: 'C5',
  C6: 'C6',
  inter: 'inter',
  wet: 'wet',
  classicDry: 'classicDry',
  classicWet: 'classicWet',
  f2SuperSoft: 'f2SuperSoft',
  f2Soft: 'f2Soft',
  f2Medium: 'f2Medium',
  f2Hard: 'f2Hard',
  f2Wet: 'f2Wet',
  unknown: 'unknown',
} as const;
export type ActualCompound = (typeof ActualCompound)[keyof typeof ActualCompound];

/** The compound as shown on the sidewall (Car Status `m_visualTyreCompound`). */
export const VisualCompound = {
  soft: 'soft',
  medium: 'medium',
  hard: 'hard',
  /** F2 only. */
  superSoft: 'superSoft',
  inter: 'inter',
  wet: 'wet',
  unknown: 'unknown',
} as const;
export type VisualCompound = (typeof VisualCompound)[keyof typeof VisualCompound];

// Codes from the struct comments of Car Status.
const ACTUAL_BY_CODE: Readonly<Record<number, ActualCompound>> = {
  16: ActualCompound.C5,
  17: ActualCompound.C4,
  18: ActualCompound.C3,
  19: ActualCompound.C2,
  20: ActualCompound.C1,
  21: ActualCompound.C0,
  22: ActualCompound.C6,
  7: ActualCompound.inter,
  8: ActualCompound.wet,
  9: ActualCompound.classicDry,
  10: ActualCompound.classicWet,
  11: ActualCompound.f2SuperSoft,
  12: ActualCompound.f2Soft,
  13: ActualCompound.f2Medium,
  14: ActualCompound.f2Hard,
  15: ActualCompound.f2Wet,
};

// F1 modern and classic share 16–18, 7 and 8; F2 uses 15 and 19–22.
const VISUAL_BY_CODE: Readonly<Record<number, VisualCompound>> = {
  16: VisualCompound.soft,
  17: VisualCompound.medium,
  18: VisualCompound.hard,
  7: VisualCompound.inter,
  8: VisualCompound.wet,
  15: VisualCompound.wet,
  19: VisualCompound.superSoft,
  20: VisualCompound.soft,
  21: VisualCompound.medium,
  22: VisualCompound.hard,
};

/** `unknown` for a code the spec does not list. */
export const actualCompoundFromCode = (code: number): ActualCompound => ACTUAL_BY_CODE[code] ?? ActualCompound.unknown;
/** `unknown` for a code the spec does not list. */
export const visualCompoundFromCode = (code: number): VisualCompound => VISUAL_BY_CODE[code] ?? VisualCompound.unknown;
