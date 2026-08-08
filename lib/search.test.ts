import { describe, it, expect } from "vitest";
import { filterBySearch } from "./search";

interface Item {
  name: string;
  code?: string | null;
}

describe("filterBySearch", () => {
  const items: Item[] = [
    { name: "Alpha Brand", code: "ALP" },
    { name: "Beta Region", code: null },
    { name: "Gamma Channel" },
  ];

  it("returns all items when query is empty", () => {
    expect(filterBySearch(items, "", (i) => [i.name, i.code])).toEqual(items);
  });

  it("returns all items when query is only whitespace", () => {
    expect(filterBySearch(items, "   ", (i) => [i.name, i.code])).toEqual(items);
  });

  it("matches by case-insensitive substring on the primary field", () => {
    expect(filterBySearch(items, "beta", (i) => [i.name, i.code])).toEqual([items[1]]);
  });

  it("matches a substring in the middle of a field, not just the start", () => {
    expect(filterBySearch(items, "region", (i) => [i.name, i.code])).toEqual([items[1]]);
  });

  it("matches by a secondary field (e.g. code)", () => {
    expect(filterBySearch(items, "alp", (i) => [i.name, i.code])).toEqual([items[0]]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterBySearch(items, "zzz", (i) => [i.name, i.code])).toEqual([]);
  });

  it("treats null/undefined fields as non-matching without throwing", () => {
    expect(() => filterBySearch(items, "xyz", (i) => [i.name, i.code])).not.toThrow();
  });
});
