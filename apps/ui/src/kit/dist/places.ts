// The places strip's header, shared by the displays that draw a position distribution (pit sweep, Box call).
import { formatPosition } from '../values/format.ts';

/** The strip's header: P1 at its first cell, P10 at its tenth, the last place at its end (gen.mjs `placesHeader`). */
export function placesHeader(places: number): string {
  let line = ' '.repeat(Math.max(0, places));
  const put = (label: string, at: number): void => {
    line = (line.slice(0, at) + label + line.slice(at + label.length)).slice(0, places);
  };
  if (places <= 0) return line;
  put(formatPosition(1), 0);
  if (places >= 20) put(formatPosition(10), 9);
  const lastLabel = formatPosition(places);
  if (places > 2 + lastLabel.length) put(lastLabel, places - lastLabel.length);
  return line;
}
