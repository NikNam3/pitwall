// Wording specific to this display; the kind names live in kit/text.ts (`incidentKinds`).

/** The time lost of an incident, from formatted seconds: `lost 4.2 s`. */
export const lost = (seconds: string): string => `lost ${seconds} s`;
/** The car that dropped out of the order after the incident (its gap after is not applicable). */
export const retired = 'DNF';
/** The start of what changed for our car. */
export const us = 'us';
