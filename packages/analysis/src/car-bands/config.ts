// Defaults of `car-bands` (spec Appendix B, SP4.3c §5.6), in °C. The surface bands are per tyre kind (slick, inter, wet);
// the carcass band is the actual compound's reference temperature minus and plus an offset; the pressure band is the
// player's setup pressure on that carcass band by the gas law. The dry and inter surface bands come from our recordings.
import { defineConfig } from '@pitwall/engine/readers';

export const CAR_BANDS_CONFIG = defineConfig('car-bands', {
  /** Slick surface. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  surfaceDryLo: 55,
  /** Slick surface. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  surfaceDryHi: 100,
  /** Intermediate surface. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  surfaceInterLo: 30,
  /** Intermediate surface. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  surfaceInterHi: 85,
  /** Wet surface, about 30–55 °C. Source: research 20 §7.1 C, SP4.3c §5.6. */
  surfaceWetLo: 30,
  /** Wet surface, about 30–55 °C. Source: research 20 §7.1 C, SP4.3c §5.6. */
  surfaceWetHi: 55,
  /** The game's reference carcass temperature of C1, in °C. Source: research 20 §1 and §7.1 A. */
  refTempC1C: 105,
  /** The game's reference carcass temperature of C2, in °C. Source: research 20 §1 and §7.1 A. */
  refTempC2C: 95,
  /** The game's reference carcass temperature of C3, in °C. Source: research 20 §1 and §7.1 A. */
  refTempC3C: 90,
  /** The game's reference carcass temperature of C4, in °C. Source: research 20 §1 and §7.1 A. */
  refTempC4C: 85,
  /** The game's reference carcass temperature of C5, in °C. Source: research 20 §1 and §7.1 A. */
  refTempC5C: 80,
  /** The game's reference carcass temperature of the intermediate, in °C. Source: research 20 §1 and §7.1 A. */
  refTempInterC: 65,
  /** The game's reference carcass temperature of the wet, in °C. Source: research 20 §1 and §7.1 A. */
  refTempWetC: 55,
  /**
   * The carcass band starts this far below the actual compound's reference temperature, in °C; the pressure band starts
   * at the setup's pressure on this carcass temperature (gas law). Source: research 20 §7.1 A–B, SP4.3c §5.6.
   */
  carcassBelowRefC: 20,
  /**
   * The carcass band ends this far above the actual compound's reference temperature, in °C; the pressure band ends at
   * the setup's pressure on this carcass temperature (gas law). Source: research 20 §7.1 A–B, SP4.3c §5.6.
   */
  carcassAboveRefC: 15,
  /** Brake temperature; our recordings' racing laps run 278–920 °C (p5–p95). Source: pitwall estimate. */
  brakeLo: 300,
  /** Brake temperature: real F1 discs run up to about 1000 °C. Source: https://flowracers.com/blog/how-hot-f1-brakes/ */
  brakeHi: 1000,
  /** Engine temperature. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  engineHi: 135,
});
