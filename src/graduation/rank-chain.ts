// Pure helpers over the `previousRank` chain that is the single source of
// gradation order for a track (see rank.entity.ts - there is no stored
// `sortOrder`). Operate on a minimal shape rather than the Rank entity
// itself so they stay easy to unit test and reusable from both
// RanksService (validation) and the mapper layer (ordering/nextRankId).

export interface ChainNode {
  id: string;
  previousRankId: string | null;
}

/**
 * Orders a single track's ranks by walking the chain from its first rank
 * (previousRankId === null) to its last. Any node that is unreachable from
 * the first rank (which should never happen given RanksService's write-time
 * invariants) is appended at the end, in input order, rather than silently
 * dropped.
 */
export function orderChain<T extends ChainNode>(nodes: readonly T[]): T[] {
  const successorByPreviousId = new Map<string | null, T>();
  for (const node of nodes) {
    successorByPreviousId.set(node.previousRankId, node);
  }

  const ordered: T[] = [];
  const visited = new Set<string>();
  let current = successorByPreviousId.get(null);

  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    ordered.push(current);
    current = successorByPreviousId.get(current.id);
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      ordered.push(node);
    }
  }

  return ordered;
}

/** Maps each rank id to the id of the rank that points to it (its
 * successor in the chain), or null if it has none yet. */
export function buildNextIdById<T extends ChainNode>(
  nodes: readonly T[],
): Map<string, string | null> {
  const successorIdByPreviousId = new Map<string, string>();
  for (const node of nodes) {
    if (node.previousRankId !== null) {
      successorIdByPreviousId.set(node.previousRankId, node.id);
    }
  }

  const nextIdById = new Map<string, string | null>();
  for (const node of nodes) {
    nextIdById.set(node.id, successorIdByPreviousId.get(node.id) ?? null);
  }
  return nextIdById;
}

/**
 * Whether pointing `rankId` (null for a rank that does not exist yet, i.e.
 * a create) at `candidatePreviousRankId` would create a cycle, given the
 * current previousRankId of every other rank in the same system+track
 * (`previousRankIdById`, keyed by rank id, excluding `rankId` itself is
 * not required - the walk simply stops as soon as it would revisit
 * `rankId`).
 */
export function wouldCreateCycle(
  rankId: string | null,
  candidatePreviousRankId: string | null,
  previousRankIdById: ReadonlyMap<string, string | null>,
): boolean {
  if (candidatePreviousRankId === null) {
    return false;
  }
  if (rankId !== null && candidatePreviousRankId === rankId) {
    return true;
  }

  const visited = new Set<string>();
  let current: string | null = candidatePreviousRankId;
  while (current !== null) {
    if (rankId !== null && current === rankId) {
      return true;
    }
    if (visited.has(current)) {
      // Pre-existing corruption in stored data - treat as a cycle rather
      // than looping forever.
      return true;
    }
    visited.add(current);
    current = previousRankIdById.get(current) ?? null;
  }
  return false;
}
