/**
 * F1 25 track names by the game's track id (`m_trackId`, appendix "Track IDs" of the F1 25 UDP specification).
 * Ids the game does not list are absent; callers show those by number.
 */
export const TRACK_NAMES: Readonly<Record<number, string>> = {
  0: 'Melbourne',
  2: 'Shanghai',
  3: 'Sakhir (Bahrain)',
  4: 'Catalunya',
  5: 'Monaco',
  6: 'Montreal',
  7: 'Silverstone',
  9: 'Hungaroring',
  10: 'Spa',
  11: 'Monza',
  12: 'Singapore',
  13: 'Suzuka',
  14: 'Abu Dhabi',
  15: 'Texas',
  16: 'Brazil',
  17: 'Austria',
  19: 'Mexico',
  20: 'Baku (Azerbaijan)',
  26: 'Zandvoort',
  27: 'Imola',
  29: 'Jeddah',
  30: 'Miami',
  31: 'Las Vegas',
  32: 'Losail',
  39: 'Silverstone (Reverse)',
  40: 'Austria (Reverse)',
  41: 'Zandvoort (Reverse)',
};

/** The track's name, or `undefined` for an id the game does not list (such as `-1`, unknown). */
export const trackName = (trackId: number): string | undefined => TRACK_NAMES[trackId];
