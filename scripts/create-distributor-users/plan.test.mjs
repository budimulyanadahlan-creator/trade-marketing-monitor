import { describe, it, expect } from "vitest";
import { buildPlan, profileRow, resolveCredentialsPath } from "./plan.mjs";

const mapping = {
  distributors: { EDM: "Esham Dima", MMS: "Mitra Monas Sejahtera" },
  regions: { Bandung: "West & Central Java", Jakarta: "Greater Jakarta" },
};
const regions = [
  { id: "r-wcj", name: "West & Central Java", is_active: true },
  { id: "r-gj", name: "Greater Jakarta", is_active: true },
];
const distributors = [
  { id: "d-edm", name: "Esham Dima", is_active: true },
  { id: "d-mms", name: "Mitra Monas Sejahtera", is_active: true },
];
const base = { rowNo: 2, kode: "A1", cabang: "Bandung", nama: "Budi", email: "budi@edm.co.id", distCode: "EDM", scope: "" };

const plan = (rows, existingEmails = []) =>
  buildPlan({ rows, mapping, regions, distributors, existingEmails: new Set(existingEmails) });

describe("buildPlan — cakupan", () => {
  it("Cakupan kosong = Cabang, dengan region dari cabang", () => {
    const [p] = plan([base]);
    expect(p.status).toBe("CREATE");
    expect(p.scope).toBe("cabang");
    expect(p.regionId).toBe("r-wcj");
    expect(p.distId).toBe("d-edm");
    expect(p.fullName).toBe("Budi - Bandung");
  });
});

describe("buildPlan — cakupan Pusat & validasi", () => {
  it("Pusat tanpa cabang boleh: region null, nama diberi akhiran Pusat", () => {
    const [p] = plan([{ ...base, cabang: "", scope: "Pusat" }]);
    expect(p.status).toBe("CREATE");
    expect(p.scope).toBe("pusat");
    expect(p.regionId).toBeNull();
    expect(p.fullName).toBe("Budi - Pusat");
  });

  it("Pusat dengan cabang terpetakan tetap memakai region cabang itu", () => {
    const [p] = plan([{ ...base, cabang: "Jakarta", scope: "PUSAT" }]);
    expect(p.status).toBe("CREATE");
    expect(p.regionId).toBe("r-gj");
    expect(p.fullName).toBe("Budi - Jakarta");
  });

  it("Cabang tanpa nama cabang ditolak", () => {
    const [p] = plan([{ ...base, cabang: "" }]);
    expect(p.status).toMatch(/^SKIP: .*cabang kosong/);
  });

  it("cakupan tidak dikenal ditolak", () => {
    const [p] = plan([{ ...base, scope: "HO" }]);
    expect(p.status).toMatch(/cakupan "HO" tidak dikenal/);
  });

  it("cabang / kode distributor yang tidak terpetakan ditolak", () => {
    const [a, b] = plan([
      { ...base, cabang: "Antah" },
      { ...base, email: "x@edm.co.id", distCode: "XYZ" },
    ]);
    expect(a.status).toMatch(/cabang "Antah" belum ada di mapping/);
    expect(b.status).toMatch(/kode distributor "XYZ" belum ada di mapping/);
  });
});

describe("buildPlan — idempoten", () => {
  it("email yang sudah terdaftar dilewati (case-insensitive), yang baru dibuat", () => {
    const [a, b] = plan(
      [{ ...base, email: "Budi@EDM.co.id" }, { ...base, email: "siti@edm.co.id", nama: "Siti" }],
      ["budi@edm.co.id"]
    );
    expect(a.status).toBe("SKIP: email sudah terdaftar");
    expect(b.status).toBe("CREATE");
  });

  it("email duplikat di dalam file hanya dibuat sekali", () => {
    const [a, b] = plan([base, { ...base, rowNo: 3 }]);
    expect(a.status).toBe("CREATE");
    expect(b.status).toMatch(/email duplikat di file/);
  });

  it("email kosong / tidak valid dilewati", () => {
    const [a, b] = plan([{ ...base, email: "" }, { ...base, email: "bukan-email" }]);
    expect(a.status).toMatch(/email tidak valid/);
    expect(b.status).toMatch(/email tidak valid/);
  });
});

describe("resolveCredentialsPath", () => {
  const repoRoot = "D:/repo/trade-marketing-monitor";

  it("default di folder input, di luar repo", () => {
    const out = resolveCredentialsPath({ inputPath: "D:/data/LIST AREA.xlsx", repoRoot });
    expect(out.replace(/\\/g, "/")).toBe("D:/data/LIST AREA - Akun Marmot.xlsx");
  });

  it("--out mengganti folder tujuan", () => {
    const out = resolveCredentialsPath({ inputPath: "D:/data/LIST AREA.xlsx", outDir: "E:/rahasia", repoRoot });
    expect(out.replace(/\\/g, "/")).toBe("E:/rahasia/LIST AREA - Akun Marmot.xlsx");
  });

  it("menolak lokasi di dalam repo (termasuk subfolder)", () => {
    expect(() =>
      resolveCredentialsPath({ inputPath: `${repoRoot}/scripts/LIST AREA.xlsx`, repoRoot })
    ).toThrow(/tidak boleh ditulis di dalam repo/);
    expect(() =>
      resolveCredentialsPath({ inputPath: "D:/data/LIST AREA.xlsx", outDir: repoRoot, repoRoot })
    ).toThrow(/tidak boleh ditulis di dalam repo/);
  });
});

describe("profileRow", () => {
  it("menyalakan must_change_password dan mengisi scope", () => {
    const [p] = plan([base]);
    expect(profileRow(p, "uid-1")).toEqual({
      id: "uid-1",
      full_name: "Budi - Bandung",
      department_id: null,
      region_id: "r-wcj",
      distributor_id: "d-edm",
      distributor_scope: "cabang",
      role: "distributor",
      is_active: true,
      must_change_password: true,
    });
  });
});
