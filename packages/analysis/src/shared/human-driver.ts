// Whether a human drives a car (SP4.3c Task 17 fix round, R55; C43, C47): one rule for every unit. A car-driver span
// decides; a car without one (`undefined`) is the human's exactly when forecast-field's `unknownDriverIsHuman` says so.

/** A human drives the car: its car-driver span's kind, or, without one, `unknownDriverIsHuman`. */
export function isHumanDriver(kind: 'ai' | 'human' | undefined, unknownDriverIsHuman: boolean): boolean {
  return kind === undefined ? unknownDriverIsHuman : kind === 'human';
}
