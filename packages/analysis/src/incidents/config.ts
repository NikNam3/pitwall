// Defaults of `incidents` (spec Appendix B). Which kinds are major is one boolean per kind; only major ones set the race moment (spec 7.3).
import { defineConfig } from '@pitwall/engine/readers';

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
  /** A time loss this close to a collision or damage jump of the same car is part of that entry. Source: pitwall estimate. */
  mergeMs: 5_000,
  /** The "after" of an entry's positions and gaps is this long after the incident. Source: pitwall estimate. */
  afterMs: 5_000,
  /**
   * A neutralisation's cause is the newest collision, retirement, damage or time loss of any car at most this long before
   * its start. Source: pitwall estimate (the first live test's SC came 3.5 s after its collision).
   */
  causeWindowMs: 10_000,
});
