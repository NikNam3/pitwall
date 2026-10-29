// Wording specific to this display; the kind names live in kit/text.ts (`incidentKinds`).
import { fixed } from '../../kit/values/format.ts';

/** The time lost of an incident: `lost 4.2 s`. */
export const lost = (ms: number): string => `lost ${fixed(ms / 1000, 1)} s`;
/** The car that dropped out of the order after the incident (its gap after is not applicable). */
export const retired = 'DNF';
/** The start of what changed for our car. */
export const us = 'us';
/** A position that did not change. */
export const unchanged = '—';
