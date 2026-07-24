export function compareStrings(a: string, b: string): number {
  // Compare by UTF-8 bytes, the cross-implementation contract for tar entry
  // and skill-id ordering (see docs/DETERMINISTIC_TAR.md). localeCompare
  // would depend on the host locale, and plain string comparison would order
  // by UTF-16 code units, which disagrees with UTF-8 byte order for
  // supplementary-plane characters.
  return Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
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
