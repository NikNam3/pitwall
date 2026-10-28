// The short label of a car in the link marker (Task 0 mockup: `1 · HAM`).

const LABEL_LENGTH = 3;

/** The first three letters of the driver's last name, upper case. */
export function carLabel(name: string): string {
  const last = name.trim().split(/\s+/).at(-1) ?? name;
  return last.slice(0, LABEL_LENGTH).toUpperCase();
}
