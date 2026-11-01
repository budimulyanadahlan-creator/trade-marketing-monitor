// Terapkan keputusan perusahaan distributor dari Excel usulan yang sudah
// dikoreksi tim (hasil suggest.mjs, sheet "SKP", kolom "Keputusan" + "ID").
//
// Aturan per baris:
//   - dicocokkan ke campaigns lewat kolom ID (bukan No. SKP)
//   - Keputusan kosong                → DILEWATI (tidak diubah)
//   - Keputusan "TANPA DISTRIBUTOR"   → DILEWATI (distributor_id tetap kosong)
//   - nama perusahaan tidak ada di master distributors → DITOLAK
//   - ID tidak ditemukan di campaigns → DITOLAK
//   - SKP sudah punya distributor_id  → DILEWATI "sudah terisi" (tidak menimpa)
//   - sisanya                         → RENCANA UPDATE
// Jika ada baris DITOLAK, mode --execute berhenti sebelum menulis apa pun.
//
// Penulisan (--execute) per perusahaan: update ... where id in (...) and
// distributor_id is null — jadi SKP yang terisi di antara dry-run dan execute
// tetap tidak tertimpa.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-skp-distributor/apply.mjs "<Usulan ... .xlsx>" --dry-run
//   node --env-file=.env.local scripts/backfill-skp-distributor/apply.mjs "<Usulan ... .xlsx>" --execute

import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const [, , inputPath, mode] = process.argv;
if (!inputPath || !["--dry-run", "--execute"].includes(mode ?? "")) {
  console.error(
    'Usage: node --env-file=.env.local scripts/backfill-skp-distributor/apply.mjs "<xlsx>" --dry-run|--execute'
  );
  process.exit(1);
}
const EXECUTE = mode === "--execute";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum di-set (jalankan dengan --env-file=.env.local)."
  );
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const NO_DISTRIBUTOR = "TANPA DISTRIBUTOR";
const SHEET = "SKP";

// ---------- baca Excel ----------
function cellText(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.result != null) return String(v.result);
    if (v.text != null) return String(v.text);
    return "";
  }
  return String(v);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(inputPath);
const ws = wb.getWorksheet(SHEET);
if (!ws) {
  console.error(`Sheet "${SHEET}" tidak ditemukan di ${inputPath}`);
  process.exit(1);
}
const header = ws
  .getRow(1)
  .values.slice(1)
  .map((v) => cellText(v).trim().toLowerCase());
const col = (name) => {
  const i = header.indexOf(name.toLowerCase());
  if (i < 0) throw new Error(`Kolom "${name}" tidak ditemukan di sheet ${SHEET}`);
  return i + 1;
};
const C = { skp: col("No. SKP"), name: col("Nama SKP"), decision: col("Keputusan"), id: col("ID") };

const rows = [];
for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r);
  const id = cellText(row.getCell(C.id).value).trim();
  const decision = cellText(row.getCell(C.decision).value).trim();
  if (!id && !decision) continue; // baris kosong di akhir sheet
  rows.push({
    rowNo: r,
    id,
    skp: cellText(row.getCell(C.skp).value).trim(),
    name: cellText(row.getCell(C.name).value).trim(),
    decision,
  });
}

// ---------- data referensi ----------
const { data: distributors, error: dErr } = await supabase.from("distributors").select("id, name");
if (dErr) throw new Error("distributors: " + dErr.message);
const distByName = new Map(distributors.map((d) => [d.name.trim().toLowerCase(), d]));
const distNameById = new Map(distributors.map((d) => [d.id, d.name]));

const ids = rows.map((r) => r.id).filter(Boolean);
const campaignById = new Map();
for (let i = 0; i < ids.length; i += 200) {
  const { data, error } = await supabase
    .from("campaigns")
    .select("id, skp_number, distributor_id")
    .in("id", ids.slice(i, i + 200));
  if (error) throw new Error("campaigns: " + error.message);
  for (const c of data) campaignById.set(c.id, c);
}

// ---------- klasifikasi ----------
const plan = []; // { row, distributor }
const skipped = []; // { row, reason }
const rejected = []; // { row, reason }
const seen = new Set();
for (const row of rows) {
  if (!row.id) {
    rejected.push({ row, reason: "kolom ID kosong" });
    continue;
  }
  if (seen.has(row.id)) {
    rejected.push({ row, reason: "ID duplikat di Excel" });
    continue;
  }
  seen.add(row.id);
  if (!row.decision) {
    skipped.push({ row, reason: "Keputusan kosong" });
    continue;
  }
  if (row.decision.toUpperCase() === NO_DISTRIBUTOR) {
    skipped.push({ row, reason: NO_DISTRIBUTOR });
    continue;
  }
  const dist = distByName.get(row.decision.toLowerCase());
  if (!dist) {
    rejected.push({ row, reason: `perusahaan "${row.decision}" tidak ada di master distributor` });
    continue;
  }
  const campaign = campaignById.get(row.id);
  if (!campaign) {
    rejected.push({ row, reason: "ID tidak ditemukan di campaigns" });
    continue;
  }
  if (campaign.distributor_id) {
    const current = distNameById.get(campaign.distributor_id) ?? campaign.distributor_id;
    skipped.push({ row, reason: `sudah terisi (${current})` });
    continue;
  }
  plan.push({ row, distributor: dist });
}

// ---------- ringkasan ----------
const label = (r) => `${r.skp || "(tanpa no)"} — ${r.name}`.slice(0, 90);
console.log(`\nFile   : ${inputPath}`);
console.log(`Mode   : ${EXECUTE ? "EXECUTE (menulis ke database)" : "DRY-RUN (tidak menulis)"}`);
console.log(`Baris  : ${rows.length}\n`);

console.log(`RENCANA UPDATE: ${plan.length} SKP`);
const perDist = new Map();
for (const p of plan) perDist.set(p.distributor.name, (perDist.get(p.distributor.name) ?? 0) + 1);
for (const [name, n] of [...perDist.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${name}`);
}

console.log(`\nDILEWATI: ${skipped.length}`);
const perSkip = new Map();
for (const s of skipped) perSkip.set(s.reason, (perSkip.get(s.reason) ?? 0) + 1);
for (const [reason, n] of perSkip) console.log(`  ${String(n).padStart(4)}  ${reason}`);
for (const s of skipped.filter((x) => x.reason.startsWith("sudah terisi"))) {
  console.log(`        baris ${s.row.rowNo}: ${label(s.row)} → ${s.reason}`);
}

console.log(`\nDITOLAK: ${rejected.length}`);
for (const r of rejected) console.log(`  baris ${r.row.rowNo}: ${label(r.row)} → ${r.reason}`);

if (!EXECUTE) {
  console.log("\nDry-run selesai. Jalankan lagi dengan --execute untuk menulis.");
  process.exit(0);
}
if (rejected.length > 0) {
  console.error("\nAda baris DITOLAK — perbaiki Excel dulu. Tidak ada yang ditulis.");
  process.exit(1);
}

// ---------- execute ----------
console.log("\nMenulis...");
let written = 0;
const byDist = new Map();
for (const p of plan) {
  const arr = byDist.get(p.distributor.id) ?? [];
  arr.push(p.row.id);
  byDist.set(p.distributor.id, arr);
}
for (const [distId, campaignIds] of byDist) {
  const distName = distNameById.get(distId);
  for (let i = 0; i < campaignIds.length; i += 200) {
    const chunk = campaignIds.slice(i, i + 200);
    const { data, error } = await supabase
      .from("campaigns")
      .update({ distributor_id: distId })
      .in("id", chunk)
      .is("distributor_id", null)
      .select("id");
    if (error) {
      console.error(`  x ${distName}: ${error.message}`);
      process.exit(1);
    }
    written += data.length;
    console.log(`  ok ${distName}: ${data.length}/${chunk.length}`);
  }
}
console.log(`\nSelesai: ${written} SKP diperbarui (${plan.length} direncanakan).`);
