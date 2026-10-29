// Lap lists shaped as the engine writes them (engine history/laps.ts): every lap appended twice, provisional then confirmed.
import type { LapRecord } from '@pitwall/domain';

/** Each lap as a provisional record followed by the confirmed one, in order; `provisional` overrides fields of the provisional copy. */
export function engineShaped(laps: readonly LapRecord[], provisional: Partial<LapRecord> = {}): LapRecord[] {
  return laps.flatMap((l) => [{ ...l, status: 'provisional' as const, ...provisional }, l]);
}
