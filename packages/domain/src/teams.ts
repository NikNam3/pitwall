// The F1 25 team ids by name (the game's Participants `teamId`, the ten teams of the 2025 grid).
import type { TeamId } from './ids.ts';

export const TEAM_IDS = {
  mercedes: 0,
  ferrari: 1,
  'red bull racing': 2,
  williams: 3,
  'aston martin': 4,
  alpine: 5,
  rb: 6,
  haas: 7,
  mclaren: 8,
  sauber: 9,
} as const satisfies Record<string, TeamId>;

/** The team id of a team's name, case-insensitive (`Mercedes` → 0); `undefined` for a name that is no team. */
export function teamIdByName(name: string): TeamId | undefined {
  const key = name.trim().toLowerCase();
  return Object.hasOwn(TEAM_IDS, key) ? TEAM_IDS[key as keyof typeof TEAM_IDS] : undefined;
}
