// Defaults of `car-bands` (spec Appendix B): one `lo`/`hi` pair per band, in °C or psi. Tyre temperature bands are per compound kind;
// the pressure band is the player's setup pressure with an offset below and above it.
// The wet carcass window is the community's F1 24 inner-temperature window (F1 25 has no published table); the dry surface and the inter bands come from our recordings.
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
  /** Wet surface. Source: pitwall estimate. */
  surfaceWetLo: 50,
  /** Wet surface. Source: pitwall estimate. */
  surfaceWetHi: 80,
  /** Slick carcass: 70-105 °C is drivable (pitwall ignores "good"). Source: a driver friend, via the user, 2026-11-05. */
  carcassDryLo: 70,
  /** Slick carcass: 70-105 °C is drivable (pitwall ignores "good"). Source: a driver friend, via the user, 2026-11-05. */
  carcassDryHi: 105,
  /** Intermediate carcass. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  carcassInterLo: 55,
  /** Intermediate carcass. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  carcassInterHi: 95,
  /** Wet carcass 45–65 °C. Source: https://steamcommunity.com/app/2488620/discussions/0/603020374162077994 */
  carcassWetLo: 45,
  /** Wet carcass. Source: https://steamcommunity.com/app/2488620/discussions/0/603020374162077994 */
  carcassWetHi: 65,
  /**
   * The player's tyre pressure band starts this far below the setup's cold pressure, per corner, in psi: the live value
   * sits at the setup's once warm and below it on a cold lap (`docs/acceptance/live-checklist.md`). Source: live test
   * 2026-11-04/05, pitwall estimate, provisional.
   */
  pressureBelowSetupPsi: 1.5,
  /**
   * The player's tyre pressure band ends this far above the setup's cold pressure, per corner, in psi. Source: live test
   * 2026-11-04/05, pitwall estimate, provisional.
   */
  pressureAboveSetupPsi: 1.0,
  /** Brake temperature; our recordings' racing laps run 278–920 °C (p5–p95). Source: pitwall estimate. */
  brakeLo: 300,
  /** Brake temperature: real F1 discs run up to about 1000 °C. Source: https://flowracers.com/blog/how-hot-f1-brakes/ */
  brakeHi: 1000,
  /** Engine temperature. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  engineHi: 135,
});
