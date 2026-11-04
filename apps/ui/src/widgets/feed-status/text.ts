// Wording specific to this display; text shared with the kit and shell lives in kit/text.ts.
export const connected = 'connected';
export const disconnected = 'disconnected';
export const labels = {
  latency: 'latency',
  late: 'late',
  decodeErrors: 'decode errors',
  playerCar: 'player car',
  cadence: 'cadence',
  wrongFormat: 'wrong format',
} as const;
/** The session's name on the session line, by its weekend phase and format; a time trial or unknown session (`none`) shows none. */
export const phase = { practice: 'practice', qualifying: 'qualifying', sprintShootout: 'sprint shootout', race: 'race', sprint: 'sprint' } as const;
