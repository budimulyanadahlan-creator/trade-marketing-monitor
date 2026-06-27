import { describe, it, expect } from "vitest";
import { cn, formatIDR } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("resolves tailwind conflicts (last wins)", () => {
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("ignores falsy values", () => {
    expect(cn("a", false && "b", undefined, null, "c")).toBe("a c");
  });
});

describe("formatIDR", () => {
  it("formats zero", () => {
    expect(formatIDR(0)).toContain("0");
  });

  it("formats a positive amount", () => {
    const result = formatIDR(1500000);
    expect(result).toContain("1.500.000");
  });
});
