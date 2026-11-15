// Where a car's warnings stand on the way to the next penalty, shared by alarms and incidents.

/**
 * Where the car's `warnings`-th warning stands on the way to the next penalty, `1..before`: the game's count runs on
 * after a penalty, so this assumes a penalty every `before` warnings (not verified against the game). Shared by
 * alarms (one warning left) and incidents (`warning 2/3`). Without a limit (`before` below 1) the count is as it is.
 */
export const warningInCycle = (warnings: number, before: number): number => (before >= 1 ? ((warnings - 1) % before) + 1 : warnings);
