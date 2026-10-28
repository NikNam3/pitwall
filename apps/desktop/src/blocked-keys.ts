// Key combinations a browser (or Electron's default menu) would act on; the desktop shell blocks them outside --dev.

/** What `before-input-event` reports about a key press, as far as blocking needs it. */
export type KeyInput = { key: string; control: boolean; shift: boolean; alt: boolean };

/** One blocked combination; `shift: 'any'` matches with and without Shift (the zoom keys sit on Shift on some layouts). */
type BlockedKey = { key: string; control?: boolean; shift?: boolean | 'any'; alt?: boolean };

const BLOCKED_KEYS: readonly BlockedKey[] = [
  { key: 'w', control: true },
  { key: 'r', control: true },
  { key: 'r', control: true, shift: true },
  { key: 'F5' },
  { key: 'ArrowLeft', alt: true },
  { key: 'ArrowRight', alt: true },
  { key: 'i', control: true, shift: true },
  // Zoom in, out and reset: the UI's own font keys change the size per window.
  ...['=', '+', '-', '_', '0'].map((key): BlockedKey => ({ key, control: true, shift: 'any' })),
];

/** True when the shell swallows `input`: one of the browser shortcuts above, and never in `--dev`. */
export function isBlockedKey(input: KeyInput, dev: boolean): boolean {
  if (dev) return false;
  return BLOCKED_KEYS.some(
    (k) =>
      k.key.toLowerCase() === input.key.toLowerCase() &&
      (k.control ?? false) === input.control &&
      (k.shift === 'any' || (k.shift ?? false) === input.shift) &&
      (k.alt ?? false) === input.alt,
  );
}
