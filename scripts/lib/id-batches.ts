// scripts/lib/id-batches.ts
// Split the inclusive id range minId..maxId into inclusive [from, to] batches of
// at most `size` ids. Returns [] when the range is empty.
export function idBatches(minId: number, maxId: number, size: number): Array<[number, number]> {
  const batches: Array<[number, number]> = [];
  for (let from = minId; from <= maxId; from += size) {
    batches.push([from, Math.min(from + size - 1, maxId)]);
  }
  return batches;
}
