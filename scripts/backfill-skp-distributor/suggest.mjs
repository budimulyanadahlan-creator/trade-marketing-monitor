// Buat Excel usulan perusahaan distributor untuk SKP yang terlihat oleh
// distributor (status Disetujui s.d. Selesai) tetapi campaigns.distributor_id
// masih kosong. BACA-SAJA: tidak ada yang ditulis ke database.
//
// Sinyal usulan, berurutan dari yang paling kuat:
//   1. Nama kota cabang (dari ../create-distributor-users/mapping.json +
//      branches.json) atau alias toko/kota di nama SKP / no. referensi.
//   2. Nomor AA yang sama dengan SKP lain yang sudah terpetakan.
//   3. Pola region+departemen dari SKP yang sudah terpetakan (mayoritas).
//   4. Riwayat pembuat SKP.
// Kata kunci yang menandakan SKP bukan klaim distributor (contoh/tes) diusulkan
// "TANPA DISTRIBUTOR".
//
// Kolom "Keputusan" di Excel sudah diisi dengan usulan dan punya dropdown;
// tim cukup mengoreksi baris yang salah. Excel yang sudah dikoreksi nanti
// dibaca oleh skrip apply (menyusul).
//
// Usage:
//   node --env-file=.env.local scripts/backfill-skp-distributor/suggest.mjs "<output.xlsx>"

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [, , outputPath] = process.argv;
if (!outputPath) {
  console.error('Usage: node --env-file=.env.local scripts/backfill-skp-distributor/suggest.mjs "<output.xlsx>"');
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const NO_DISTRIBUTOR = "TANPA DISTRIBUTOR";
const VISIBLE_STATUSES = ["approved", "ongoing", "claim_submitted", "claim_verified", "ready_to_pay", "paid", "completed"];
const STATUS_LABEL = {
  approved: "Disetujui",
  ongoing: "Berjalan",
  claim_submitted: "Klaim Diajukan",
  claim_verified: "Klaim Terverifikasi",
  ready_to_pay: "Siap Bayar",
  paid: "Dibayar",
  completed: "Selesai",
};

const mapping = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "create-distributor-users", "mapping.json"), "utf8")
);
const branches = JSON.parse(fs.readFileSync(path.join(__dirname, "branches.json"), "utf8"));

// keyword (lowercase) -> { company code, label }
const keywords = [];
for (const [code, cities] of Object.entries(branches.branchesByCompany)) {
  for (const city of cities) keywords.push({ re: wordRe(city), code, label: `kota cabang ${city}` });
}
for (const [alias, city] of Object.entries(branches.aliases)) {
  const code = Object.entries(branches.branchesByCompany).find(([, cs]) => cs.includes(city))?.[0];
  if (code) keywords.push({ re: wordRe(alias), code, label: `"${alias}" = ${city}` });
}
const companyKeywords = Object.entries(branches.companyNames).flatMap(([code, names]) =>
  names.map((n) => ({ re: wordRe(n), code, label: `nama perusahaan "${n}"` }))
);
const noDistributorRes = branches.noDistributorKeywords.map(wordRe);

function wordRe(s) {
  return new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

async function fetchAll(table, select, filter) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(select).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const [campaigns, regions, distributors, users, departments, channels] = await Promise.all([
  fetchAll(
    "campaigns",
    "id, name, skp_number, reference_number, aa_reference_number, status, region_id, department_id, channel_id, created_by, requested_budget, distributor_id",
    (q) => q.in("status", VISIBLE_STATUSES)
  ),
  fetchAll("regions", "id, name"),
  fetchAll("distributors", "id, name"),
  fetchAll("users", "id, full_name"),
  fetchAll("departments", "id, name"),
  fetchAll("channels", "id, name"),
]);

const byId = (rows, label = "name") => new Map(rows.map((r) => [r.id, r[label]]));
const regionName = byId(regions);
const distName = byId(distributors);
const userName = byId(users, "full_name");
const deptName = byId(departments);
const channelName = byId(channels);
const codeToName = mapping.distributors;
const nameToCode = Object.fromEntries(Object.entries(codeToName).map(([c, n]) => [n, c]));

const mapped = campaigns.filter((c) => c.distributor_id);
const targets = campaigns.filter((c) => !c.distributor_id);

function tally(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!k) continue;
    const inner = m.get(k) ?? new Map();
    const d = distName.get(r.distributor_id);
    inner.set(d, (inner.get(d) ?? 0) + 1);
    m.set(k, inner);
  }
  return m;
}
const byAa = tally(mapped, (c) => c.aa_reference_number);
const byRegionDept = tally(mapped, (c) => `${c.region_id}|${c.department_id}`);
const byCreator = tally(mapped, (c) => c.created_by);

function majority(counts) {
  if (!counts) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const total = sorted.reduce((s, [, n]) => s + n, 0);
  const [name, n] = sorted[0];
  return { name, n, total, share: n / total, detail: sorted.map(([d, k]) => `${nameToCode[d] ?? d} ${k}`).join(", ") };
}

function suggest(c) {
  const text = `${c.name ?? ""} ${c.reference_number ?? ""}`;
  const region = regionName.get(c.region_id) ?? "-";
  const notes = [];

  if (noDistributorRes.some((re) => re.test(c.name ?? ""))) {
    return { name: NO_DISTRIBUTOR, confidence: "Sedang", reason: "Nama SKP menandakan contoh/tes, bukan klaim distributor" };
  }

  const rd = majority(byRegionDept.get(`${c.region_id}|${c.department_id}`));
  const cr = majority(byCreator.get(c.created_by));

  const companyHits = companyKeywords.filter((k) => k.re.test(text));
  const companyCodes = [...new Set(companyHits.map((h) => h.code))];
  if (companyCodes.length === 1) {
    const name = codeToName[companyCodes[0]];
    const conflict = rd && rd.name !== name;
    return {
      name,
      confidence: conflict ? "Sedang" : "Tinggi",
      reason: [
        `Nama/referensi menyebut ${companyHits.map((h) => h.label).join(", ")}`,
        conflict ? `cek: SKP terpetakan di ${region} umumnya ${rd.detail}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    };
  }

  const hits = keywords.filter((k) => k.re.test(text));
  const hitCodes = [...new Set(hits.map((h) => h.code))];
  if (hitCodes.length === 1) {
    return {
      name: codeToName[hitCodes[0]],
      confidence: "Tinggi",
      reason: `Nama/referensi menyebut ${hits.map((h) => h.label).join(", ")}`,
    };
  }
  if (hitCodes.length > 1) notes.push(`Nama menyebut cabang beberapa perusahaan (${hits.map((h) => h.label).join(", ")})`);

  const aa = c.aa_reference_number ? majority(byAa.get(c.aa_reference_number)) : null;
  if (aa && aa.share === 1 && aa.n >= 3) {
    return {
      name: aa.name,
      confidence: "Tinggi",
      reason: `No. AA ${c.aa_reference_number} sama dengan ${aa.n} SKP ${nameToCode[aa.name] ?? aa.name}`,
    };
  }
  const info = [];
  if (aa) {
    info.push(
      aa.share === 1
        ? `No. AA sama dengan ${aa.n} SKP ${nameToCode[aa.name] ?? aa.name} (sampel kecil)`
        : `No. AA dipakai beberapa perusahaan (${aa.detail})`
    );
  }

  if (region === "National") {
    info.push("SKP National/KAM — key account nasional bisa dilayani beberapa distributor atau tanpa distributor");
  }
  if (rd) {
    const confidence =
      region === "National" || rd.total < 5
        ? "Rendah"
        : rd.share >= 0.95 && rd.total >= 20
          ? "Tinggi"
          : rd.share >= 0.6
            ? "Sedang"
            : "Rendah";
    const reason = [`SKP terpetakan di ${region}/${deptName.get(c.department_id)}: ${rd.detail}`];
    if (cr) reason.push(`pembuat ${userName.get(c.created_by)}: ${cr.detail}`);
    if (region === "East Java & Bali") reason.push("cek: cabang MMS Makassar/Manado juga masuk region ini");
    if (rd.name === "Esham Dima" && region === "West & Central Java") reason.push("cek: BIR (Bandung) juga di region ini");
    return {
      name: rd.name,
      confidence: notes.length ? "Rendah" : confidence,
      reason: [...notes, ...reason, ...info].join("; "),
    };
  }
  if (cr) {
    return {
      name: cr.name,
      confidence: "Rendah",
      reason: [...notes, `Tidak ada pola region; pembuat ${userName.get(c.created_by)}: ${cr.detail}`, ...info].join("; "),
    };
  }
  return {
    name: "",
    confidence: "Rendah",
    reason: [
      ...notes,
      `Tidak ada petunjuk (region ${region}, pembuat ${userName.get(c.created_by) ?? "-"}) — mohon diisi`,
      ...info,
    ].join("; "),
  };
}

const rows = targets
  .map((c) => ({ c, s: suggest(c) }))
  .sort(
    (a, b) =>
      ["Rendah", "Sedang", "Tinggi"].indexOf(a.s.confidence) - ["Rendah", "Sedang", "Tinggi"].indexOf(b.s.confidence) ||
      (regionName.get(a.c.region_id) ?? "").localeCompare(regionName.get(b.c.region_id) ?? "") ||
      (a.c.skp_number ?? "").localeCompare(b.c.skp_number ?? "")
  );

// ---------- workbook ----------
const wb = new ExcelJS.Workbook();
const choices = [...distributors.map((d) => d.name).sort(), NO_DISTRIBUTOR];

const guide = wb.addWorksheet("Petunjuk");
guide.columns = [{ width: 110 }];
[
  `Usulan perusahaan distributor untuk ${targets.length} SKP yang belum punya distributor (dibuat ${new Date().toISOString().slice(0, 10)}).`,
  "",
  "Cara mengisi:",
  "1. Buka sheet 'SKP'. Kolom 'Keputusan' (kuning) sudah diisi dengan usulan sistem.",
  "2. Periksa terutama baris berkeyakinan Rendah dan Sedang (diurutkan paling atas). Ubah lewat dropdown kalau salah.",
  `3. Pilih '${NO_DISTRIBUTOR}' untuk SKP yang memang bukan klaim distributor (SKP contoh, program langsung ke toko, dll.). SKP ini tidak akan terlihat oleh distributor mana pun.`,
  "4. Kosongkan 'Keputusan' kalau belum yakin — baris kosong dilewati dan tidak diubah.",
  "5. Jangan ubah kolom 'ID' — dipakai untuk mencocokkan saat data diterapkan.",
  "",
  "Arti keyakinan:",
  "Tinggi — nama/referensi SKP menyebut kota cabang/toko yang jelas milik satu perusahaan, nomor AA sama dengan SKP yang sudah terpetakan, atau region hampir seluruhnya milik satu perusahaan.",
  "Sedang — mayoritas SKP di region yang sama milik perusahaan itu, tapi ada perusahaan lain di region tersebut.",
  "Rendah — petunjuk lemah (misalnya SKP National/KAM) atau tidak ada petunjuk; perlu dicek manual.",
  "",
  "Catatan: SKP departemen Marketing tidak terlihat oleh distributor; boleh dibiarkan atau diisi.",
].forEach((t) => guide.addRow([t]));
guide.getRow(1).font = { bold: true, size: 12 };

const ws = wb.addWorksheet("SKP", { views: [{ state: "frozen", ySplit: 1, xSplit: 3 }] });
ws.columns = [
  { header: "No", key: "no", width: 5 },
  { header: "No. SKP", key: "skp", width: 18 },
  { header: "Nama SKP", key: "name", width: 55 },
  { header: "No. Referensi", key: "ref", width: 26 },
  { header: "No. AA", key: "aa", width: 18 },
  { header: "Status", key: "status", width: 14 },
  { header: "Departemen", key: "dept", width: 15 },
  { header: "Region", key: "region", width: 20 },
  { header: "Channel", key: "channel", width: 9 },
  { header: "Pembuat", key: "creator", width: 22 },
  { header: "Nilai (Rp)", key: "budget", width: 15 },
  { header: "Usulan Sistem", key: "suggest", width: 22 },
  { header: "Keyakinan", key: "conf", width: 11 },
  { header: "Alasan Usulan", key: "reason", width: 70 },
  { header: "Keputusan", key: "decision", width: 24 },
  { header: "Catatan Tim", key: "note", width: 30 },
  { header: "ID", key: "id", width: 38 },
];
rows.forEach(({ c, s }, i) => {
  ws.addRow({
    no: i + 1,
    skp: c.skp_number,
    name: c.name,
    ref: c.reference_number,
    aa: c.aa_reference_number,
    status: STATUS_LABEL[c.status] ?? c.status,
    dept: deptName.get(c.department_id),
    region: regionName.get(c.region_id),
    channel: channelName.get(c.channel_id),
    creator: userName.get(c.created_by),
    budget: Number(c.requested_budget ?? 0),
    suggest: s.name || "-",
    conf: s.confidence,
    reason: s.reason,
    decision: s.name || null,
    note: null,
    id: c.id,
  });
});

const header = ws.getRow(1);
header.font = { bold: true, color: { argb: "FFFFFFFF" } };
header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
header.alignment = { vertical: "middle", wrapText: true };
ws.autoFilter = { from: "A1", to: "Q1" };
ws.getColumn("budget").numFmt = "#,##0";
ws.getColumn("reason").alignment = { wrapText: true, vertical: "top" };
ws.getColumn("name").alignment = { wrapText: true, vertical: "top" };

const confFill = { Tinggi: "FFC6EFCE", Sedang: "FFFFEB9C", Rendah: "FFFFC7CE" };
const list = `"${choices.join(",")}"`;
for (let r = 2; r <= rows.length + 1; r++) {
  const row = ws.getRow(r);
  row.alignment = { vertical: "top", wrapText: true };
  const conf = row.getCell("conf").value;
  row.getCell("conf").fill = { type: "pattern", pattern: "solid", fgColor: { argb: confFill[conf] } };
  const d = row.getCell("decision");
  d.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
  d.font = { bold: true };
  d.dataValidation = {
    type: "list",
    allowBlank: true,
    formulae: [list],
    showErrorMessage: true,
    errorTitle: "Pilihan tidak valid",
    error: "Pilih perusahaan dari daftar.",
  };
}

const sum = wb.addWorksheet("Ringkasan");
sum.columns = [
  { header: "Usulan", key: "name", width: 26 },
  { header: "Tinggi", key: "Tinggi", width: 9 },
  { header: "Sedang", key: "Sedang", width: 9 },
  { header: "Rendah", key: "Rendah", width: 9 },
  { header: "Total", key: "total", width: 9 },
];
const agg = new Map();
for (const { s } of rows) {
  const k = s.name || "(belum ada usulan)";
  const a = agg.get(k) ?? { name: k, Tinggi: 0, Sedang: 0, Rendah: 0, total: 0 };
  a[s.confidence]++;
  a.total++;
  agg.set(k, a);
}
[...agg.values()].sort((a, b) => b.total - a.total).forEach((a) => sum.addRow(a));
sum.addRow({ name: "Total", total: rows.length });
sum.getRow(1).font = { bold: true };
sum.lastRow.font = { bold: true };

await wb.xlsx.writeFile(outputPath);
console.log(`Ditulis: ${outputPath}`);
console.table([...agg.values()]);
