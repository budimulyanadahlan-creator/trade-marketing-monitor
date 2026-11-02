// Logika murni skrip akun distributor massal (tanpa I/O) — dipakai create.mjs
// dan diuji di plan.test.mjs.
//
// Aturan per baris Excel (Fase 7 plan-multi-user-distributor):
//   - Cakupan "Cabang" (default jika kosong) wajib punya cabang yang terpetakan
//     ke region Marmot (mapping.json); "Pusat" boleh tanpa cabang/region.
//   - Kode perusahaan wajib ada di mapping.json dan di master distributors.
//   - Email tidak valid / duplikat di file / sudah terdaftar → SKIP.
//   - Akun yang dibuat selalu must_change_password = true.

import crypto from "crypto";
import path from "path";

export const SCOPES = ["cabang", "pusat"];

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
export function generatePassword(len = 12) {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += PASSWORD_ALPHABET[crypto.randomInt(PASSWORD_ALPHABET.length)];
  }
  // pastikan ada huruf besar, huruf kecil, dan angka
  if (!/[A-Z]/.test(out) || !/[a-z]/.test(out) || !/[0-9]/.test(out)) return generatePassword(len);
  return out;
}

/** "Cabang" | "Pusat" | "" (case-insensitive) → "cabang" | "pusat" | null (tidak dikenal). */
export function normalizeScope(raw) {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "cabang";
  return SCOPES.includes(v) ? v : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * @param {object} args
 * @param {Array<{rowNo:number,kode:string,cabang:string,nama:string,email:string,distCode:string,scope:string}>} args.rows
 * @param {{distributors:Record<string,string>, regions:Record<string,string>}} args.mapping
 * @param {Array<{id:string,name:string,is_active:boolean}>} args.regions
 * @param {Array<{id:string,name:string,is_active:boolean}>} args.distributors
 * @param {Set<string>} args.existingEmails  email (lowercase) yang sudah ada di auth
 */
export function buildPlan({ rows, mapping, regions, distributors, existingEmails }) {
  const regionByName = new Map(regions.map((r) => [r.name.toLowerCase(), r]));
  const distByName = new Map(distributors.map((d) => [d.name.toLowerCase(), d]));
  const seen = new Set();
  const plan = [];

  for (const r of rows) {
    const problems = [];
    const email = String(r.email ?? "").trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) problems.push("email tidak valid");
    if (email && seen.has(email)) problems.push("email duplikat di file");
    seen.add(email);
    if (String(r.nama ?? "").trim().length < 2) problems.push("nama controller kosong");

    const scope = normalizeScope(r.scope);
    if (!scope) problems.push(`cakupan "${r.scope}" tidak dikenal (Cabang/Pusat)`);

    // Region: wajib untuk Cabang; untuk Pusat opsional tapi kalau diisi harus terpetakan.
    const cabang = String(r.cabang ?? "").trim();
    let regionName;
    let region;
    if (cabang) {
      regionName = mapping.regions[cabang];
      region = regionName ? regionByName.get(regionName.toLowerCase()) : undefined;
      if (!regionName) problems.push(`cabang "${cabang}" belum ada di mapping.json`);
      else if (!region) problems.push(`region "${regionName}" tidak ada di tabel regions`);
      else if (!region.is_active) problems.push(`region "${regionName}" nonaktif`);
    } else if (scope === "cabang") {
      problems.push("cabang kosong (wajib untuk cakupan Cabang)");
    }

    const distCode = String(r.distCode ?? "").trim().toUpperCase();
    const distName = mapping.distributors[distCode];
    const dist = distName ? distByName.get(distName.toLowerCase()) : undefined;
    if (!distName) problems.push(`kode distributor "${distCode}" belum ada di mapping.json`);
    else if (!dist) problems.push(`distributor "${distName}" tidak ada di tabel distributors`);
    else if (!dist.is_active) problems.push(`distributor "${distName}" nonaktif`);

    const exists = existingEmails.has(email);
    plan.push({
      ...r,
      email,
      cabang,
      distCode,
      scope,
      fullName: `${String(r.nama ?? "").trim()} - ${cabang || (scope === "pusat" ? "Pusat" : "")}`.replace(/ - $/, ""),
      regionName: regionName ?? null,
      regionId: region?.id ?? null,
      distName: distName ?? null,
      distId: dist?.id ?? null,
      status: problems.length
        ? "SKIP: " + problems.join("; ")
        : exists
          ? "SKIP: email sudah terdaftar"
          : "CREATE",
    });
  }
  return plan;
}

/** Baris public.users untuk satu rencana CREATE. */
export function profileRow(p, userId) {
  return {
    id: userId,
    full_name: p.fullName,
    department_id: null,
    region_id: p.regionId,
    distributor_id: p.distId,
    distributor_scope: p.scope,
    role: "distributor",
    is_active: true,
    // Password sementara dibagikan ke distributor → wajib diganti di login pertama.
    must_change_password: true,
  };
}

/**
 * Lokasi file kredensial: `<outDir>/<nama input> - Akun Marmot.xlsx`
 * (outDir default = folder input). Menolak lokasi di dalam repo agar password
 * tidak pernah ikut ter-commit.
 */
export function resolveCredentialsPath({ inputPath, outDir, repoRoot }) {
  const parsed = path.parse(path.resolve(inputPath));
  const dir = path.resolve(outDir || parsed.dir);
  const outPath = path.join(dir, `${parsed.name} - Akun Marmot.xlsx`);
  const rel = path.relative(path.resolve(repoRoot), outPath);
  const insideRepo = rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  if (insideRepo) {
    throw new Error(
      `File kredensial tidak boleh ditulis di dalam repo (${outPath}). Pakai --out <folder di luar repo>.`
    );
  }
  return outPath;
}
