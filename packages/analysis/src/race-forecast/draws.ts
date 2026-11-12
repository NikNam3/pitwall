// The forecast's draws (spec 6.3, C2): every draw comes from a stream keyed by (scenario, car, lap, purpose), hashed
// from one base seed taken from the injected generator. One car's extra stop, or another car's missing noise, so
// changes no other draw. Plain data and module functions (no closures per forecast, so the hot loop stays optimised).

/** What a draw is for; part of its stream's key. */
export const PURPOSE = { pace: 1, deg: 2, scatter: 3, mistake: 4, bigEvent: 5, retire: 6, pass: 7 } as const;

/** One step of a 32-bit hash over one key part (murmur3's finaliser). */
function mix(h: number, part: number): number {
  h = Math.imul(h ^ (part | 0), 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return h ^ (h >>> 16);
}

/** The streams of one scenario under one base seed: its key's head, and per car slot the head's step for that car. */
export type Draws = { head: number; car: Int32Array };

/** The streams of scenario `scenario` under base seed `base`, their per-car steps written to `car` (one per car slot). */
export function drawsInto(base: number, scenario: number, car: Int32Array): Draws {
  const head = mix(mix(0x811c9dc5, base), scenario);
  for (let c = 0; c < car.length; c++) car[c] = mix(head, c);
  return { head, car };
}

/** The key of car `car`'s streams on lap `lap` (a lap of 0 for the per-scenario draws). */
export const streamKey = (d: Draws, car: number, lap: number): number => mix(d.car[car] ?? mix(d.head, car), lap);

/** The head of the stream `purpose` under `key`: every value of that stream hashes from it. */
export const streamOf = (key: number, purpose: number): number => mix(key, purpose);

/** 2⁻³²: a uint32 times it is exactly that uint32 divided by 2³² (a power of two), without the division. */
const TO_UNIT = 2 ** -32;

/** A uniform in [0, 1): the `k`-th value of the stream whose head is `stream` (`streamOf`). */
export const uniformOf = (stream: number, k: number): number => (mix(stream, k) >>> 0) * TO_UNIT;

/** A uniform in [0, 1): the `k`-th value of the stream `purpose` under `key`. */
export const uniform = (key: number, purpose: number, k: number): number => uniformOf(mix(key, purpose), k);

const TWO_PI = 2 * Math.PI;

/** A standard normal (Box-Muller) from the `k`-th pair of the stream whose head is `stream`. */
export const normalOf = (stream: number, k: number): number => Math.sqrt(-2 * Math.log(1 - uniformOf(stream, 2 * k))) * Math.cos(TWO_PI * uniformOf(stream, 2 * k + 1));

/** A standard normal (Box-Muller) from the `k`-th pair of the stream `purpose` under `key`. */
export const normal = (key: number, purpose: number, k: number): number => normalOf(mix(key, purpose), k);
