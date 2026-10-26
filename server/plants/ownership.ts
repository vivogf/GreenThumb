export const PLANT_NOT_FOUND = Object.freeze({ error: "Plant not found" });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** plants.id is a uuid column; anything else would make Postgres throw. */
export function isPlantId(id: string): boolean {
  return UUID.test(id);
}

export type OwnedPlantLookup<T> = (id: string, userId: number) => Promise<T | null>;

/**
 * Returns the plant only when `userId` owns it. A foreign plant, a missing
 * plant and an invalid id all give null, so callers answer the same 404.
 */
export async function requireOwnedPlant<T>(
  lookup: OwnedPlantLookup<T>,
  id: string,
  userId: number,
): Promise<T | null> {
  if (!isPlantId(id)) return null;
  return lookup(id, userId);
}
