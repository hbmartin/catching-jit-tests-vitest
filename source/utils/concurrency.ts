function chunk<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function mapConcurrent<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  const batches = chunk(items, concurrency);

  for (const batch of batches) {
    const batchResults = await Promise.all(batch.map((item) => fn(item)));
    results.push(...batchResults);
  }

  return results;
}

export { chunk, mapConcurrent };
