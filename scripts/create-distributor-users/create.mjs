// Buat akun distributor massal (role=distributor) dari daftar area di Excel.
// (Fase 7 plans/plan-multi-user-distributor.md — dipakai pertama 2026-10-30.)
//
// Input workbook: sheet pertama dengan header
//   Kode | Cabang | Nama Controller | Email | Distributor | Cakupan
// - Distributor = kode perusahaan EDM/MMS/BIR/AJS (lihat mapping.json)
// - Cakupan = "Cabang" (default jika kolom/isi kosong) atau "Pusat"
//   Cabang wajib punya kolom Cabang yang terpetakan ke region Marmot;
//   Pusat boleh tanpa Cabang (region kosong).
//
// Untuk tiap baris (aturan lengkap di plan.mjs, diuji di plan.test.mjs):
//   - email dinormalisasi (lowercase, trim); email kosong/tidak valid dilewati
//   - email yang sudah terdaftar di auth dilewati → aman dijalankan ulang
//   - cabang -> region Marmot, kode distributor -> perusahaan (mapping.json)
//   - password acak 12 karakter (tanpa karakter mirip 0/O, 1/l/I)
//   - auth.admin.createUser (email_confirm) + insert public.users
//     { full_name: "<Nama> - <Cabang|Pusat>", role: distributor, region_id,
//       distributor_id, distributor_scope, is_active: true,
//       must_change_password: true }   ← wajib ganti password di login pertama
//   - kalau insert profil gagal, akun auth yang baru dibuat dihapus lagi
//
// Output (hanya --execute): workbook "<nama input> - Akun Marmot.xlsx" berisi
// email + password tiap akun. Ditulis di folder input, atau folder --out.
// Skrip MENOLAK menulis file ini di dalam repo — jangan pernah di-commit.
//
// Usage:
//   node --env-file=.env.local scripts/create-distributor-users/create.mjs "<LIST AREA.xlsx>" --dry-run
//   node --env-file=.env.local scripts/create-distributor-users/create.mjs "<LIST AREA.xlsx>" --execute [--out <folder>]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { buildPlan, generatePassword, profileRow, resolveCredentialsPath } from "./plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

// ---------- argumen ----------
const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith("--"));
const mode = args.find((a) => a === "--dry-run" || a === "--execute");
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;
if (!inputPath || !mode || (outIdx >= 0 && (!outDir || outDir.startsWith("--")))) {
  console.error(
    'Usage: node --env-file=.env.local scripts/create-distributor-users/create.mjs "<xlsx>" --dry-run|--execute [--out <folder>]'
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

// Lokasi file kredensial dicek lebih dulu agar --execute tidak membuat akun
// lalu gagal menulis passwordnya.
let credentialsPath;
try {
  credentialsPath = resolveCredentialsPath({ inputPath, outDir, repoRoot: REPO_ROOT });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const mapping = JSON.parse(fs.readFileSync(path.join(__dirname, "mapping.json"), "utf8"));

// ---------- baca Excel ----------
const clean = (v) => (v == null ? "" : String(v).trim());
function cellText(cell) {
  const v = cell?.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if ("text" in v) return clean(v.text);
    if ("richText" in v) return clean(v.richText.map((r) => r.text).join(""));
    if ("result" in v) return clean(v.result);
  }
  return clean(v);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(inputPath);
const ws = wb.worksheets[0];
const header = ws.getRow(1).values.map((v) => clean(v).toLowerCase());
const col = (name, { optional = false } = {}) => {
  const i = header.findIndex((h) => h === name.toLowerCase());
  if (i < 0 && !optional) {
    throw new Error(`Kolom "${name}" tidak ditemukan di header: ${header.filter(Boolean).join(", ")}`);
  }
  return i < 0 ? null : i;
};
const C = {
  kode: col("Kode"),
  cabang: col("Cabang"),
  nama: col("Nama Controller"),
  email: col("Email"),
  dist: col("Distributor"),
  scope: col("Cakupan", { optional: true }),
};
if (C.scope == null) console.log('Kolom "Cakupan" tidak ada → semua baris dianggap Cabang.');

const rows = [];
ws.eachRow((row, n) => {
  if (n === 1) return;
  const email = cellText(row.getCell(C.email));
  const cabang = cellText(row.getCell(C.cabang));
  const nama = cellText(row.getCell(C.nama));
  if (!email && !cabang && !nama) return; // baris kosong di akhir sheet
  rows.push({
    rowNo: n,
    kode: cellText(row.getCell(C.kode)),
    cabang,
    nama,
    email,
    distCode: cellText(row.getCell(C.dist)),
    scope: C.scope == null ? "" : cellText(row.getCell(C.scope)),
  });
});

// ---------- master data ----------
const [{ data: regions, error: rErr }, { data: distributors, error: dErr }] = await Promise.all([
  supabase.from("regions").select("id,name,is_active"),
  supabase.from("distributors").select("id,name,is_active"),
]);
if (rErr || dErr) throw rErr ?? dErr;

const existingEmails = new Set();
for (let page = 1; ; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  data.users.forEach((u) => u.email && existingEmails.add(u.email.toLowerCase()));
  if (data.users.length < 1000) break;
}

// ---------- rencana ----------
const plan = buildPlan({ rows, mapping, regions, distributors, existingEmails });

console.log(`\n${EXECUTE ? "EXECUTE" : "DRY RUN"} - ${inputPath}`);
console.log(`Supabase: ${url}\n`);
for (const p of plan) {
  console.log(
    `[${String(p.rowNo).padStart(2)}] ${p.status.padEnd(28)} ${p.email.padEnd(34)} ${p.fullName.padEnd(38)} ${String(p.distName ?? "-").padEnd(22)} ${String(p.scope ?? "?").padEnd(7)} ${p.regionName ?? "-"}`
  );
}
const toCreate = plan.filter((p) => p.status === "CREATE");
console.log(`\nAkan dibuat: ${toCreate.length} / ${plan.length} baris. Dilewati: ${plan.length - toCreate.length}.`);
console.log(`File kredensial: ${credentialsPath}`);

if (!EXECUTE) {
  console.log("\nDry run saja - tidak ada perubahan. Jalankan dengan --execute untuk membuat akun.");
} else {
  await execute();
}

// ---------- execute ----------
async function execute() {
  const results = [];
  for (const p of plan) {
    if (p.status !== "CREATE") {
      results.push({ ...p, password: "", result: p.status });
      continue;
    }
    const password = generatePassword();
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: p.email,
      password,
      email_confirm: true,
    });
    if (authError || !authUser?.user) {
      results.push({ ...p, password: "", result: "GAGAL auth: " + (authError?.message ?? "unknown") });
      console.log(`  x ${p.email}: ${authError?.message}`);
      continue;
    }
    const { error: profileError } = await supabase.from("users").insert(profileRow(p, authUser.user.id));
    if (profileError) {
      await supabase.auth.admin.deleteUser(authUser.user.id);
      results.push({
        ...p,
        password: "",
        result: "GAGAL profil (auth dibatalkan): " + profileError.message,
      });
      console.log(`  x ${p.email}: ${profileError.message}`);
      continue;
    }
    results.push({ ...p, password, userId: authUser.user.id, result: "DIBUAT" });
    console.log(`  ok ${p.email}`);
  }

  // ---------- workbook kredensial (di luar repo) ----------
  const out = new ExcelJS.Workbook();
  const sheet = out.addWorksheet("Akun Marmot");
  sheet.columns = [
    { header: "Kode", key: "kode", width: 8 },
    { header: "Cabang", key: "cabang", width: 14 },
    { header: "Nama Controller", key: "nama", width: 30 },
    { header: "Distributor", key: "distName", width: 24 },
    { header: "Cakupan", key: "scope", width: 10 },
    { header: "Region Marmot", key: "regionName", width: 22 },
    { header: "Email (username)", key: "email", width: 36 },
    { header: "Password (sementara, wajib diganti saat login)", key: "password", width: 44 },
    { header: "Nama di Marmot", key: "fullName", width: 36 },
    { header: "Status", key: "result", width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  results.forEach((r) => sheet.addRow(r));
  sheet.getColumn("password").font = { name: "Consolas" };

  fs.mkdirSync(path.dirname(credentialsPath), { recursive: true });
  await out.xlsx.writeFile(credentialsPath);

  const created = results.filter((r) => r.result === "DIBUAT").length;
  const failed = results.filter((r) => r.result.startsWith("GAGAL")).length;
  console.log(`\nSelesai: ${created} dibuat, ${failed} gagal, ${results.length - created - failed} dilewati.`);
  console.log(`Daftar akun + password: ${credentialsPath}`);
}
