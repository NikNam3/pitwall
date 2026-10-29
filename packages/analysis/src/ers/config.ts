// Defaults of `ers` (spec Appendix B).
import { defineConfig } from '@pitwall/engine';

export const ERS_CONFIG = defineConfig('ers', {
  /** Per-lap MGU-K deploy limit, 4 MJ. Source: FIA Formula 1 Technical Regulations 2014–2025 (ES to MGU-K), used by F1 25. */
  deployLimitJ: 4_000_000,
  /** Energy store capacity, 4 MJ; the time trial holds the store at 4 MJ. Source: FIA Formula 1 Technical Regulations 2014–2025, used by F1 25. */
  capacityJ: 4_000_000,
  /** Store an attack needs, 60 % of the capacity: Avella et al.'s 40 % margin (research 07). Source: pitwall estimate. */
  attackLevelJ: 2_400_000,
});
