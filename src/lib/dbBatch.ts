/**
 * D1/SQLite bound parameters are finite. Keep ID-based IN queries below the
 * limit and combine the rows back into the result expected by callers.
 */
// Leave headroom for fixed predicates and queries that contain more than one
// IN list; 25 IDs keeps the total bound-variable count safely below D1's cap.
export const D1_IN_BATCH_SIZE = 25;

export function uniqueInBatches<T>(values: readonly T[], batchSize = D1_IN_BATCH_SIZE): T[][] {
  const uniqueValues = [...new Set(values)];
  const batches: T[][] = [];
  for (let index = 0; index < uniqueValues.length; index += batchSize) {
    batches.push(uniqueValues.slice(index, index + batchSize));
  }
  return batches;
}

export async function collectInBatches<T, R>(
  values: readonly T[],
  load: (batch: T[]) => Promise<R[]>,
): Promise<R[]> {
  const rows: R[] = [];
  for (const batch of uniqueInBatches(values)) {
    rows.push(...await load(batch));
  }
  return rows;
}
