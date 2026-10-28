// Key bindings (spec 7.7): `keys.json` is read leniently, keys are normalised to the `Ctrl+Shift+K` style.
import * as text from '../../kit/text.ts';

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const MODIFIER_ALIASES: Record<string, (typeof MODIFIERS)[number]> = { ctrl: 'Ctrl', control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Meta', cmd: 'Meta' };
/** Keys with a name of more than one letter, as `KeyboardEvent.key` spells them. */
const NAMED_KEYS = ['Escape', 'Enter', 'Tab', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const KEY_ALIASES: Record<string, string> = { esc: 'Escape', return: 'Enter', space: 'Space', ' ': 'Space' };

/** A character key other than a letter already says whether Shift is held (`?`, `+`), so Shift is not part of its name. */
const impliesShift = (key: string): boolean => key.length === 1 && key.toUpperCase() === key.toLowerCase() && !/\d/.test(key);

/** `Ctrl+Alt+Shift+Meta+` prefix of the held modifiers, then the key. */
function join(held: ReadonlySet<string>, key: string): string {
  const shown = MODIFIERS.filter((m) => held.has(m) && !(m === 'Shift' && impliesShift(key)));
  return [...shown, key].join('+');
}

const keyName = (raw: string): string => {
  const alias = KEY_ALIASES[raw.toLowerCase()];
  if (alias !== undefined) return alias;
  if (raw.length === 1) return raw.toUpperCase();
  return NAMED_KEYS.find((k) => k.toLowerCase() === raw.toLowerCase()) ?? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
};

/** The normalised name of a key as written in `keys.json` (`shift+ctrl+k` is `Ctrl+Shift+K`). */
export function normaliseKey(raw: string): string {
  const trimmed = raw.trim();
  // A plus sign as the key itself ends the text: `Ctrl++`.
  const plus = trimmed === '+' || trimmed.endsWith('++');
  const parts = (plus ? trimmed.slice(0, -2) : trimmed).split('+').filter((p) => p !== '');
  const key = plus ? '+' : keyName(parts.pop() ?? '');
  const held = new Set(parts.flatMap((p) => MODIFIER_ALIASES[p.toLowerCase()] ?? []));
  return join(held, key);
}

/** The normalised name of the key a keydown event reports. */
export function eventKey(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): string {
  const held = new Set<string>([...(e.ctrlKey ? ['Ctrl'] : []), ...(e.altKey ? ['Alt'] : []), ...(e.shiftKey ? ['Shift'] : []), ...(e.metaKey ? ['Meta'] : [])]);
  return join(held, keyName(e.key));
}

/**
 * The key bindings (key to command id) and one note per ignored entry of `raw` (the parsed `keys.json`): an unknown
 * command, a key bound twice (the first in file order wins) and a value that is not a string. File bindings override
 * `defaults`.
 */
export function parseKeys(
  raw: Record<string, unknown>,
  commandIds: ReadonlySet<string>,
  defaults: Record<string, string>,
): { bindings: Map<string, string>; notes: string[] } {
  const fromFile = new Map<string, string>();
  const notes: string[] = [];
  for (const [rawKey, value] of Object.entries(raw)) {
    const key = normaliseKey(rawKey);
    if (typeof value !== 'string') notes.push(text.keyNotString(key));
    else if (!commandIds.has(value)) notes.push(text.keyUnknownCommand(key, value));
    else if (fromFile.has(key)) notes.push(text.keyBoundTwice(key, value));
    else fromFile.set(key, value);
  }
  const bindings = new Map(Object.entries(defaults).map(([key, id]) => [normaliseKey(key), id]));
  for (const [key, id] of fromFile) bindings.set(key, id);
  return { bindings, notes };
}
