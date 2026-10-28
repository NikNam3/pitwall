// Key combinations a browser would act on; the desktop shell blocks them outside --dev. The zoom keys are not among
// them: without the application menu (main.ts) nothing zooms, and Ctrl+= / Ctrl+- / Ctrl+0 are the UI's font keys.

/** What `before-input-event` reports about a key press, as far as blocking needs it. */
export type KeyInput = { key: string; control: boolean; shift: boolean; alt: boolean };

/** One blocked combination; a modifier not named must be up. */
type BlockedKey = { key: string; control?: boolean; shift?: boolean; alt?: boolean };

const BLOCKED_KEYS: readonly BlockedKey[] = [
  { key: 'w', control: true },
  { key: 'r', control: true },
  { key: 'r', control: true, shift: true },
  { key: 'F5' },
  { key: 'ArrowLeft', alt: true },
  { key: 'ArrowRight', alt: true },
  { key: 'i', control: true, shift: true },
];

/** True when the shell swallows `input`: one of the browser shortcuts above, and never in `--dev`. */
export function isBlockedKey(input: KeyInput, dev: boolean): boolean {
  if (dev) return false;
  return BLOCKED_KEYS.some(
    (k) =>
      k.key.toLowerCase() === input.key.toLowerCase() &&
      (k.control ?? false) === input.control &&
      (k.shift ?? false) === input.shift &&
      (k.alt ?? false) === input.alt,
  );
}
