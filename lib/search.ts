/**
 * Case-insensitive substring filter, shared across Rekap, Kelola User, and
 * Master Data search boxes. Filters `items` down to those where at least
 * one of the fields returned by `fieldsFn` contains `query` as a substring.
 * An empty/whitespace-only query returns `items` unchanged.
 */
export function filterBySearch<T>(
  items: T[],
  query: string,
  fieldsFn: (item: T) => Array<string | null | undefined>
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;

  return items.filter((item) =>
    fieldsFn(item).some((field) => (field ?? "").toLowerCase().includes(q))
  );
}
