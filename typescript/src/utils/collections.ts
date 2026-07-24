export function compareStrings(a: string, b: string): number {
  // Byte-wise (UTF-16 code unit) comparison. localeCompare would make sort
  // order — and therefore tar bytes and digests — depend on the host locale.
  return a < b ? -1 : a > b ? 1 : 0;
}

export function uniqueValues<T>(values: readonly T[]): T[] {
  const out: T[] = [];
  for (const value of values) {
    if (!out.includes(value)) {
      out.push(value);
    }
  }
  return out;
}
