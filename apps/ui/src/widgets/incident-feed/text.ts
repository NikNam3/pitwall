// Wording specific to this display; the kind names live in kit/text.ts (`incidentKinds`).

/** The time lost of an incident, from formatted seconds: `lost 4.2 s`. */
export const lost = (seconds: string): string => `lost ${seconds} s`;
/** The other car retired by the after moment (its gap after is not applicable). */
export const retired = 'DNF';
/** The start of what changed for our car. */
export const us = 'us';
/** Between our position and the other car's gaps. */
export const joint = ', ';
/** A before/after pair, `+4.1→+5.8`; either side may be empty. */
export const pair = (before: string, after: string): string => `${before}→${after}`;
