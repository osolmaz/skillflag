export function uniqueValues<T>(values: readonly T[]): T[] {
  const out: T[] = [];
  for (const value of values) {
    if (!out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}
