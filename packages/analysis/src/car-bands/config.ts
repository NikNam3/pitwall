// Defaults of `car-bands` (spec Appendix B): one `lo`/`hi` pair per band, in °C or psi. Tyre temperature bands are per compound kind.
// The wet carcass window is the community's F1 24 inner-temperature window (F1 25 has no published table); the dry and inter bands come from our recordings.
import { defineConfig } from '@pitwall/engine';

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
  /** Slick carcass. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  carcassDryLo: 75,
  /** Slick carcass. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  carcassDryHi: 110,
  /** Intermediate carcass. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  carcassInterLo: 55,
  /** Intermediate carcass. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  carcassInterHi: 95,
  /** Wet carcass 45–65 °C. Source: https://steamcommunity.com/app/2488620/discussions/0/603020374162077994 */
  carcassWetLo: 45,
  /** Wet carcass. Source: https://steamcommunity.com/app/2488620/discussions/0/603020374162077994 */
  carcassWetHi: 65,
  /**
   * Live tyre pressure: community setups run down to about 20.2 psi rear. Source:
   * https://outsidergaming.com/f1-24-canada-setup/ (F1 24), pitwall estimate; see the questions file (pressure band).
   */
  pressureLo: 20,
  /**
   * Live tyre pressure. Community F1 25 setups mostly run the maximum 29.5 psi front / 26.5 rear when cold,
   * and the live value rises above the setup's (our recordings' racing laps read 20.9–30.2 psi, p5–p95). Source:
   * https://www.f1laps.com/setups/f12025/556d1236-4ca0-4c00-86ad-acc82684ef0b, pitwall estimate for the headroom.
   */
  pressureHi: 31,
  /** Brake temperature; our recordings' racing laps run 278–920 °C (p5–p95). Source: pitwall estimate. */
  brakeLo: 300,
  /** Brake temperature: real F1 discs run up to about 1000 °C. Source: https://flowracers.com/blog/how-hot-f1-brakes/ */
  brakeHi: 1000,
  /** Engine temperature. Source: pitwall recordings 2026-10-29/30, p5–p95 of the player's racing laps (qualifyingSingapore, practiceZandvoortOnline, raceZandvoortUidReuse, raceSingaporeWet); soft 6 laps, hard 1 lap. */
  engineHi: 135,
});
