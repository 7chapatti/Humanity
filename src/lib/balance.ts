/**
 * Picks up to `n` items, taking turns across groups (outlets) so no single
 * source dominates. Within each group the input order (newest first) is kept.
 */
export function pickBalanced<T>(items: T[], groupOf: (item: T) => string, n: number): T[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = groupOf(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const queues = [...groups.values()];
  const out: T[] = [];
  for (let round = 0; out.length < n; round++) {
    let added = false;
    for (const queue of queues) {
      if (round < queue.length && out.length < n) {
        out.push(queue.at(round)!);
        added = true;
      }
    }
    if (!added) break;
  }
  return out;
}
