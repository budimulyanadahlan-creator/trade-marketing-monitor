import { describe, it, expect, vi } from "vitest";
import { formatSkpNumber, generateSkpNumber } from "./skp-number";

describe("formatSkpNumber", () => {
  it("formats sequence 1 in June 2026", () => {
    expect(formatSkpNumber(1, new Date(2026, 5, 15))).toBe("0001/WWI/06/2026");
  });

  it("pads sequence to 4 digits", () => {
    expect(formatSkpNumber(42, new Date(2026, 5, 15))).toBe("0042/WWI/06/2026");
  });

  it("pads single-digit month to 2 digits", () => {
    expect(formatSkpNumber(1, new Date(2026, 0, 1))).toBe("0001/WWI/01/2026");
  });

  it("handles month 12", () => {
    expect(formatSkpNumber(9999, new Date(2026, 11, 31))).toBe("9999/WWI/12/2026");
  });
});

describe("generateSkpNumber", () => {
  it("returns formatted SKP number using counter from DB", async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({ data: 3, error: null }),
    };

    const result = await generateSkpNumber(
      new Date(2026, 5, 15),
      mockSupabase as never
    );

    expect(result).toBe("0003/WWI/06/2026");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("increment_skp_counter", {
      p_year: 2026,
      p_month: 6,
    });
  });

  it("passes correct year and month for January", async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({ data: 1, error: null }),
    };

    const result = await generateSkpNumber(
      new Date(2027, 0, 5),
      mockSupabase as never
    );

    expect(result).toBe("0001/WWI/01/2027");
    expect(mockSupabase.rpc).toHaveBeenCalledWith("increment_skp_counter", {
      p_year: 2027,
      p_month: 1,
    });
  });

  it("throws when DB returns an error", async () => {
    const mockSupabase = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "DB error" } }),
    };

    await expect(
      generateSkpNumber(new Date(2026, 5, 15), mockSupabase as never)
    ).rejects.toThrow("Failed to generate SKP number: DB error");
  });
});
