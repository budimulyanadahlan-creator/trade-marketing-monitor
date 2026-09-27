import { describe, it, expect } from "vitest";
import { parsePosmPhotoKind, posmPhotoPath, validatePosmPhoto } from "./posm-photo";

describe("validatePosmPhoto", () => {
  it("accepts JPG and PNG images up to 5 MB", () => {
    expect(validatePosmPhoto({ type: "image/jpeg", size: 5 * 1024 * 1024 })).toBeNull();
    expect(validatePosmPhoto({ type: "image/png", size: 1000 })).toBeNull();
    expect(validatePosmPhoto({ type: "image/jpg", size: 1000 })).toBeNull();
  });

  it("rejects non-image files, including PDF", () => {
    expect(validatePosmPhoto({ type: "application/pdf", size: 1000 })).toMatch(/JPG atau PNG/);
    expect(validatePosmPhoto({ type: "image/gif", size: 1000 })).toMatch(/JPG atau PNG/);
  });

  it("rejects files over 5 MB", () => {
    expect(validatePosmPhoto({ type: "image/jpeg", size: 5 * 1024 * 1024 + 1 })).toMatch(/5 MB/);
  });
});

describe("parsePosmPhotoKind", () => {
  it("maps each photo kind to its table", () => {
    expect(parsePosmPhotoKind("item")).toBe("posm_items");
    expect(parsePosmPhotoKind("asset")).toBe("marketing_assets");
    expect(parsePosmPhotoKind("placement")).toBe("asset_placements");
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
