// The car-driver sub-machine's span declaration (contract C15, C17): car-scoped, who drives a car, the AI or a human. Shared.
import { defineSpans } from '../facts.ts';

/**
 * Who drives a car (`spans:car-driver`): `ai` or `human`, from the `aiControlled` signal. A car's first span opens on the
 * first frame its Participants data is in the live state; a takeover (online, the AI replacing a human who dropped out)
 * closes one span and opens the other. No kind has a detail.
 */
export const spans = defineSpans({ machine: 'car-driver', scope: 'car', kinds: ['ai', 'human'] });
