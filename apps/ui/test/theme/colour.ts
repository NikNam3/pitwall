// Test helper: colour parsing and conversion (hex or oklch()) into OKLab / OKLCH.
export type Lab = { L: number; a: number; b: number };

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hexToLab(hex: string): Lab {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a 6-digit hex colour: ${hex}`);
  const n = parseInt(m[1]!, 16);
  const r = srgbToLinear(((n >> 16) & 255) / 255);
  const g = srgbToLinear(((n >> 8) & 255) / 255);
  const b = srgbToLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s,
  };
}

/** Parses `oklch(L C H)` (L as number or %, H in degrees). */
export function parseOklch(value: string): { L: number; C: number; h: number } | undefined {
  const m = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/i.exec(value.trim());
  if (!m) return undefined;
  const L = m[2] === '%' ? Number(m[1]) / 100 : Number(m[1]);
  return { L, C: Number(m[3]), h: Number(m[4]) };
}

export function toLab(value: string): Lab {
  const lch = parseOklch(value);
  if (lch) {
    const h = (lch.h * Math.PI) / 180;
    return { L: lch.L, a: lch.C * Math.cos(h), b: lch.C * Math.sin(h) };
  }
  return hexToLab(value);
}

export const lightness = (value: string): number => toLab(value).L;

/** OKLab Euclidean distance times 100. */
export function deltaE100(x: string, y: string): number {
  const p = toLab(x);
  const q = toLab(y);
  return 100 * Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}
