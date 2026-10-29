// Defaults of `car-bands` (spec Appendix B): one `lo`/`hi` pair per band, in °C or psi. Tyre temperature bands are per compound kind.
// The carcass windows are the community's F1 24 inner-temperature windows (F1 25 has no published table).
import { defineConfig } from '@pitwall/engine';

export const CAR_BANDS_CONFIG = defineConfig('car-bands', {
  /** Slick surface. Source: pitwall estimate (around the C2–C3 windows of 85–105 °C). */
  surfaceDryLo: 85,
  /** Slick surface. Source: pitwall estimate. */
  surfaceDryHi: 105,
  /** Intermediate surface. Source: pitwall estimate. */
  surfaceInterLo: 60,
  /** Intermediate surface. Source: pitwall estimate. */
  surfaceInterHi: 90,
  /** Wet surface. Source: pitwall estimate. */
  surfaceWetLo: 50,
  /** Wet surface. Source: pitwall estimate. */
  surfaceWetHi: 80,
  /** Slick carcass: C2 and C3 85–105 °C, C1 95–115 °C. Source: https://steamcommunity.com/app/2488620/discussions/0/603020374162077994 */
  carcassDryLo: 85,
  /** Slick carcass; kept above C3's 105 °C for the harder compounds. Source: https://steamcommunity.com/app/2488620/discussions/0/603020374162077994, pitwall estimate. */
  carcassDryHi: 110,
  /** Intermediate carcass 55–75 °C. Source: https://steamcommunity.com/app/2488620/discussions/0/603020374162077994 */
  carcassInterLo: 55,
  /** Intermediate carcass. Source: https://steamcommunity.com/app/2488620/discussions/0/603020374162077994 */
  carcassInterHi: 75,
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
   * and the live value rises above the setup's (the time trial reads 30.16 psi). Source:
   * https://www.f1laps.com/setups/f12025/556d1236-4ca0-4c00-86ad-acc82684ef0b, pitwall estimate for the headroom.
   */
  pressureHi: 31,
  /** Brake temperature; the time trial runs 309–355 °C. Source: pitwall estimate. */
  brakeLo: 300,
  /** Brake temperature: real F1 discs run up to about 1000 °C. Source: https://flowracers.com/blog/how-hot-f1-brakes/ */
  brakeHi: 1000,
  /** Engine temperature; the time trial holds 110 °C. Source: pitwall estimate. */
  engineHi: 125,
});
