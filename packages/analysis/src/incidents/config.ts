// Defaults of `incidents` (spec Appendix B). Which kinds are major is one boolean per kind; only major ones set the race moment (spec 7.3).
import { defineConfig } from '@pitwall/engine';

export const INCIDENTS_CONFIG = defineConfig('incidents', {
  /** A mini-sector this much slower than the car's median for the segment is a time loss. Source: pitwall estimate. */
  timeLossMs: 2000,
  /** Source: this spec (7.3). */
  collisionMajor: true,
  /** Source: this spec (7.3). */
  retirementMajor: true,
  /** Source: this spec (7.3). */
  damageMajor: true,
  /** Source: this spec (7.3). */
  timeLossMajor: true,
  /** Source: this spec (7.3): frequent with friends and AI cars. */
  warningMajor: false,
  /** Source: this spec (7.3). */
  penaltyMajor: false,
  /** Source: this spec (7.3): the neutralised moment covers it. */
  neutralisedMajor: false,
  /** Entries the feed keeps, newest first. Source: pitwall estimate. */
  feedLength: 50,
});
