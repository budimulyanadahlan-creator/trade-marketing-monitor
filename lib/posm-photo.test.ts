import { describe, it, expect } from "vitest";
import { parsePosmPhotoKind, posmPhotoPath, validatePosmPhoto } from "./posm-photo";

describe("validatePosmPhoto", () => {
  it("accepts JPG and PNG images up to 4.4 MB (below Vercel's 4.5 MB request limit)", () => {
    expect(validatePosmPhoto({ type: "image/jpeg", size: 4_400_000 })).toBeNull();
    expect(validatePosmPhoto({ type: "image/png", size: 1000 })).toBeNull();
    expect(validatePosmPhoto({ type: "image/jpg", size: 1000 })).toBeNull();
  });

  it("rejects non-image files, including PDF", () => {
    expect(validatePosmPhoto({ type: "application/pdf", size: 1000 })).toMatch(/JPG atau PNG/);
    expect(validatePosmPhoto({ type: "image/gif", size: 1000 })).toMatch(/JPG atau PNG/);
  });

  it("rejects files over 4.4 MB", () => {
    expect(validatePosmPhoto({ type: "image/jpeg", size: 4_400_001 })).toMatch(/4,4 MB/);
  });
});

describe("parsePosmPhotoKind", () => {
  it("maps each POSM/asset photo kind to its table in the posm-photos bucket", () => {
    expect(parsePosmPhotoKind("item")).toEqual({ table: "posm_items", bucket: "posm-photos" });
    expect(parsePosmPhotoKind("asset")).toEqual({ table: "marketing_assets", bucket: "posm-photos" });
    expect(parsePosmPhotoKind("placement")).toEqual({ table: "asset_placements", bucket: "posm-photos" });
  });

  it("keeps gimmick photos in the separate gimmick-photos bucket", () => {
    expect(parsePosmPhotoKind("gimmick_item")).toEqual({ table: "gimmick_items", bucket: "gimmick-photos" });
    expect(parsePosmPhotoKind("gimmick_movement")).toEqual({ table: "gimmick_movements", bucket: "gimmick-photos" });
  });

  it("returns null for unknown kinds", () => {
    expect(parsePosmPhotoKind("users")).toBeNull();
    expect(parsePosmPhotoKind(null)).toBeNull();
  });
});

describe("posmPhotoPath", () => {
  it("stores photos per kind and record as .jpg with a timestamp", () => {
    expect(posmPhotoPath("asset", "abc", 1700000000000)).toBe("asset/abc/1700000000000.jpg");
  });
});
