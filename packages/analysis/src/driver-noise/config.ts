// Defaults of `driver-noise` (SP4.3a spec 5.2, 8). The AI values from research 12 §2; the human values a pitwall
// estimate until driver profiles exist.
import { defineConfig } from '@pitwall/engine/readers';

export const DRIVER_NOISE_CONFIG = defineConfig('driver-noise', {
  /** No car within this gap ahead at any of the lap's crossings: a free-air lap (ms). Source: research 12 §2. */
  freeAirGapMs: 1500,
  /** An AI free-air lap beyond this many σ on the slow side is a mistake. Source: research 12 §2. */
  mistakeSigmas: 3,
  /** A green lap more than this slow, the car running on, is a big event (ms). Source: research 12 §2. */
  bigEventMs: 5000,
  /** The prior's weight in laps (`k`) in the shrinkage `(n · session + k · prior) / (n + k)`. Source: pitwall estimate. */
  shrinkLaps: 8,
  /** The AI field's core lap scatter σ (ms; research 12 measured about 140–260). Source: research 12 §2. */
  aiSigmaMs: 200,
  /** The AI field's mistakes per lap. Source: research 12 §2. */
  aiMistakeRate: 0.024,
  /** The AI field's median mistake size (ms). Source: research 12 §2. */
  aiMistakeMedianMs: 700,
  /** The AI field's mistake size log-sd. Source: research 12 §2. */
  aiMistakeSigmaLog: 0.8,
  /** A human's core lap scatter σ without a profile (ms). Source: pitwall estimate until profiles exist. */
  humanSigmaMs: 450,
  /** A human's mistakes per lap without a profile. Source: pitwall estimate until profiles exist. */
  humanMistakeRate: 0.06,
  /** A human's median mistake size without a profile (ms). Source: pitwall estimate until profiles exist. */
  humanMistakeMedianMs: 1200,
  /** A human's tyre wear rate without a profile (% per lap, the worst corner). Source: pitwall estimate until profiles exist. */
  humanWearRatePct: 2.0,
  /** The wear rate of a car without a measured, profile or our-car rate (% per lap, the worst corner). Source: pitwall estimate. */
  defaultWearRatePct: 2.0,
  /** The AI field's lap-to-lap correlation of its residuals. Source: pitwall estimate. */
  aiRho: 0.3,
  /** A human's lap-to-lap correlation without a profile. Source: pitwall estimate until profiles exist. */
  humanRho: 0.3,
  /** A human's mistake size log-sd without a profile. Source: pitwall estimate until profiles exist. */
  humanMistakeSigmaLog: 0.8,
  /** A human's big events per lap without a profile. Source: pitwall estimate until profiles exist. */
  humanBigEventRate: 0.002,
  /** The AI field's big events per lap. Source: research 12 §2. */
  aiBigEventRate: 0.001,
  /** The AI field's retirements per lap. Source: research 12 §2. */
  aiRetireRate: 0.001,
  /** A human's retirements per lap without a profile. Source: pitwall estimate until profiles exist. */
  humanRetireRate: 0.002,
});
