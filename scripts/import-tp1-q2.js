// One-off bulk import: TP1 Q2 Trade Promo (Rafraksi / Disc On Faktur), already
// fully approved historical SKPs that were never entered into marmot.
//
// Source data:
//   - Excel: Summary SKP_Update 010926.xlsx (135 rows; only rows with a
//     matching SKP PDF page below are imported — see SKP_MATCH)
//   - SKP PDFs: Q2.zip, extracted to EXTRACT_DIR (Listing Fee/ folder
//     excluded — that's a different budget category, TP4)
//
// Usage:
//   node scripts/import-tp1-q2.js --dry-run     writes a review report, no DB/storage writes
//   node scripts/import-tp1-q2.js --execute      performs the real import (requires --dry-run reviewed first)
//
// See plans/ or the grill-me conversation this script was built from for the
// full list of decisions (field mapping, PIC->account table, channel rules).

const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const { PDFDocument } = require("pdf-lib");
const { createClient } = require("@supabase/supabase-js");

const REPO_ROOT = path.resolve(__dirname, "..");
const EXCEL_PATH = path.resolve(REPO_ROOT, "..", "Summary SKP_Update 010926.xlsx");
const EXTRACT_DIR =
  "C:\\Users\\Wantw\\AppData\\Local\\Temp\\claude\\d--Area-Hobby-Trade-Marketing-Monitor-Dashboard-V2\\a9fe2e5f-0f89-41df-ba7c-7130985de499\\scratchpad\\q2extract";
// Second batch - SKP baru.zip (fills in some of the rows Q2.zip was missing)
const EXTRACT_DIR2 =
  "C:\\Users\\Wantw\\AppData\\Local\\Temp\\claude\\d--Area-Hobby-Trade-Marketing-Monitor-Dashboard-V2\\a9fe2e5f-0f89-41df-ba7c-7130985de499\\scratchpad\\skpbaru";
// Third batch - SKP Pak Adit.zip (fills in Adit's remaining "RAF-JR.KAM" rows)
const EXTRACT_DIR3 =
  "C:\\Users\\Wantw\\AppData\\Local\\Temp\\claude\\d--Area-Hobby-Trade-Marketing-Monitor-Dashboard-V2\\a9fe2e5f-0f89-41df-ba7c-7130985de499\\scratchpad\\adit";
// Fifth batch - SKP Update Pak Lucky.zip (fills in Lucky's remaining rows 129-132)
const EXTRACT_DIR4 =
  "C:\\Users\\Wantw\\AppData\\Local\\Temp\\claude\\d--Area-Hobby-Trade-Marketing-Monitor-Dashboard-V2\\81fa7e08-25ff-4a8a-a3cb-54ec7fa4f76d\\scratchpad\\skp-lucky";
const OUT_DIR = path.resolve(__dirname, "..", "..", "..", "..", "tmp-tp1-import");

// ---------------------------------------------------------------------------
// Fixed master-data ids (resolved during the grill-me conversation)
// ---------------------------------------------------------------------------
const DEPARTMENT_SALES = "277103f0-c0ea-4540-8b82-a1a9ba70034e";
const BRAND_SHELLY_SENBEI_96G = "06d62749-6317-46d3-bb74-c79bfda2a409";
const PROMO_CATEGORY_TRADE_PROMO_FUND = "1dc152e7-695b-4347-a6c1-fed89c57b052";
const CHANNEL_GT = "8090c5d1-6480-4be5-b159-869d7d5ef5b0";
const CHANNEL_MT = "00f80e97-08bb-4748-900b-cf9bf7ed023c";

const REGIONS = {
  "East Java & Bali": "123645ce-ff85-4188-bc9c-74dcb953ca5c",
  National: "ef4fdba9-0fbd-4c85-9cf7-c82ab6ee0ddf",
  "North Sumatera etc": "d4cde8f4-0bb0-41a3-bdd0-9c79d2238c39",
  "West Kalimantan": "ad6574c8-6add-41c1-bcea-ba7a8b689c0f",
};

// PIC (Excel "PIC yang mengajukan") -> created_by user + region
const PIC_MAP = {
  Jacklin: { userId: "4850aa56-20cd-4ba3-8e74-d56968ddfdf4", userName: "ASM East Java - Bali", region: "East Java & Bali" },
  Lucky: { userId: "ea25760e-e582-44f5-a10e-41dc8121b1f3", userName: "KAM 1", region: "National" },
  Adit: { userId: "c2bf4873-529a-483c-b940-7dfc82da15f8", userName: "KAM 2", region: "National" },
  Nahrul: { userId: "a1546438-1be6-46be-bedd-57e12538629f", userName: "ASM Sumatera", region: "North Sumatera etc" },
  Edy: { userId: "61f78bd2-b735-4ee9-943a-9a921c49cafe", userName: "ASM Kalimantan", region: "West Kalimantan" },
};

// Modern Trade store-name keywords (case-insensitive substring match).
// Anything not matched here is classified GT (independent/general trade).
const MT_KEYWORDS = [
  "aeon", "diamond supermarket", "lottemart", "lotte mart", "lion superindo",
  "foodhall", "food hall", "hero & diskon", "hero&diskon", "naga swalayan",
  "grandlucky", "grand lucky", "gelael", "kemchick", "family mart",
  "circle k", "prima freshmart", "foodmax", "farmers & ranch",
  "farmers&ranch", "kkv", "santa swalayan", "market city",
];

function classifyChannel(toko) {
  const t = String(toko).toLowerCase();
  return MT_KEYWORDS.some((k) => t.includes(k)) ? CHANNEL_MT : CHANNEL_GT;
}

// ---------------------------------------------------------------------------
// SKP PDF match table, built by manually reading every page of every PDF in
// Q2.zip (Listing Fee/ excluded) and transcribing the "No :" field.
// `norm(noSurat)` is matched against `norm(excelRow["No Surat"])`; a couple
// of rows need special handling (year typos on the source letter, and one
// Excel typo) which is done separately in buildRows().
// ---------------------------------------------------------------------------
const SKP_MATCH = [
  ["Periode Juli/Surat Rafraksi AEON.pdf", 1, "222 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Asien Mart.pdf", 1, "224 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Diamond Supermarket.pdf", 1, "219 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Duta Buah.pdf", 1, "215 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Farmers & Ranch Market.pdf", 1, "221 RAF-KAM/VII/2026"], // Excel row 58 mistypes this "220" - see README note in dry-run report
  ["Periode Juli/Surat Rafraksi FoodHall periode Juli.pdf", 1, "208 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi FoodMax.pdf", 1, "211 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Gelael.pdf", 1, "213 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Grand Lucky.pdf", 1, "212 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Happy Harvest.pdf", 1, "216 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Hero & Diskon Supermarket periode Juli.pdf", 1, "202 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Jakarta Fruit.pdf", 1, "225 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Kemchick Supermarket.pdf", 1, "217 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Lion Superindo.pdf", 1, "199 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Lotte Mart.pdf", 1, "218 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Market City.pdf", 1, "226 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Maxim Fruit Market.pdf", 1, "227 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Naga Swalayan periode Juli.pdf", 1, "206 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Papaya.pdf", 1, "214 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Pima Mart.pdf", 1, "228 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Prima Freshmart.pdf", 1, "210 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Santa Swalayan.pdf", 1, "229 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Total Buah.pdf", 1, "230 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Disc On Faktur (Batam).pdf", 1, "082/ASM/WWI/MNH/VII/2026"],
  ["Periode Juli/Surat Diskon 8% Brastagi Group.pdf", 1, "088/ASM/WWI/MNH/VII/2026"],
  ["Periode Juli/198. Surat Diskon on PO 10_ - naga swalayan.(1).pdf", 1, "198/KAM/VII/2026"],
  ["Periode Agustus/Surat Rafraksi FoodHall periode Agustus.pdf", 1, "209 RAF-KAM/VII/2026"],
  ["Periode Agustus/Surat Rafraksi Hero & Diskon Supermarket periode Agustus.pdf", 1, "203 RAF-KAM/VII/2026"],
  ["Periode Agustus/Surat Rafraksi Naga Swalayan periode Agustus.pdf", 1, "207 RAF-KAM/VII/2026"],
  ["Periode September/Surat Rafraksi Hero & Diskon Supermarket periode September.pdf", 1, "204 RAF-KAM/VII/2026"],
  ["Periode Juli/Surat Rafraksi Family Mart & Circle K.pdf", 1, "045/WWI/JA/VIII/2026"],
  ["Periode Juli/Surat Rafraksi Family Mart & Circle K.pdf", 2, "046/WWI/JA/VIII/2026"],
  // KKV: 3-page doc (letter + pricelist attachment) - keep whole file, don't split
  ["Periode Juli/221. SKP Harga Khusus KKV Periode Q2 Juli - September 2027 & Pricelist KKV.pdf", "ALL", "221/Special Price -KAM/VII/2026"],
];

// Surabaya Juli: pages 1-9 -> No Surat 237-245/WWI/JA/VI/2026
for (let i = 0; i < 9; i++) {
  SKP_MATCH.push(["Periode Juli/Surat Rafraksi Surabaya periode Juli.pdf", i + 1, `${237 + i}/WWI/JA/VI/2026`]);
}
// Surabaya Agustus: pages 1-9 -> No Surat 039 down to 031 /WWI/JA/VII/2026
for (let i = 0; i < 9; i++) {
  const num = String(39 - i).padStart(3, "0");
  SKP_MATCH.push(["Periode Agustus/Surat Rafraksi Surabaya periode agustus.pdf", i + 1, `${num}/WWI/JA/VII/2026`]);
}
// Bali Juli: pages 1-15 -> No Surat 093-107/WWI/NA/VI/2026 (some doc typos on the year, e.g. VI/2027 - handled by loose match)
for (let i = 0; i < 15; i++) {
  const num = String(93 + i).padStart(3, "0");
  SKP_MATCH.push(["Periode Juli/Surat Rafraksi Bali periode Juli.pdf", i + 1, `${num}/WWI/NA/VI/2026`]);
}
// Bali Agustus: pages 1-15 -> No Surat 108-122/WWI/NA/VII/2026
for (let i = 0; i < 15; i++) {
  const num = String(108 + i).padStart(3, "0");
  SKP_MATCH.push(["Periode Agustus/Surat Rafraksi Bali periode Agustus.pdf", i + 1, `${num}/WWI/NA/VII/2026`]);
}
// Bali September: pages 1-16 -> No Surat 124-139/WWI/NA/VIII/2026
for (let i = 0; i < 16; i++) {
  const num = String(124 + i).padStart(3, "0");
  SKP_MATCH.push(["Periode September/Surat Rafraksi Bali periode september.pdf", i + 1, `${num}/WWI/NA/VIII/2026`]);
}

// --- Second batch (SKP baru.zip) ---
SKP_MATCH.push(["2:Revisi Budget Rafraksi PT. Smart Retail Perkasa.pdf", 1, "093/WWI_PTK/VIII/2026"]); // Edy, No.124
// FoodHall/Naga Swalayan letters print "RAF-KAM/VII/2026" (doc typo) but Excel
// recorded ".../VIII/2026" - use Excel's own text so this is an exact match.
SKP_MATCH.push(["2:Surat Rafraksi Naga Swalayan & Foodhall periode September.pdf", 1, "234 RAF-KAM/VIII/2026"]); // Lucky, No.125 FoodHall
SKP_MATCH.push(["2:Surat Rafraksi Naga Swalayan & Foodhall periode September.pdf", 2, "235 RAF-KAM/VIII/2026"]); // Lucky, No.126 Naga Swalayan
// Surabaya Sept batch: pages 1-12 -> No Surat 018-029/WWI/JA/VIII/2026 (Jacklin)
// page 4 (021) prints "VII" (doc typo) - Excel's own text (VIII) used here too.
for (let i = 0; i < 12; i++) {
  const num2 = String(18 + i).padStart(3, "0");
  SKP_MATCH.push(["2:Surat Rafraksi Surabaya periode september.pdf", i + 1, `${num2}/WWI/JA/VIII/2026`]);
}

// --- Fourth batch (SKP Pak Adit.zip) ---
// PDFs print ".../VIII/2026" (4-digit year) but Excel recorded ".../VIII/26"
// (2-digit) for this whole RAF-JR.KAM series - use Excel's own text so these
// are exact matches.
const ADIT_MATCH = [
  ["Surat Rafraksi Family Mart periode agustus.pdf", "001 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Family Mart periode september.pdf", "002 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi FoodMax periode agustus.pdf", "003 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi FoodMax periode september.pdf", "004 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi GrandLucky periode agustus.pdf", "005 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi GrandLucky periode september.pdf", "006 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Gelael periode agustus.pdf", "007 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Duta Buah periode agustus.pdf", "009 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Duta Buah periode september.pdf", "010 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Happy Harvest periode agustus.pdf", "011 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Kemchick Supermarket periode agustus.pdf", "013 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Lotte Mart peeriode agustus.pdf", "015 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Lotte Mart periode september.pdf", "016 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Diamond Supermarket periode september.pdf", "018 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi AEON periode september.pdf", "022 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Lion Superindo periode agustus.pdf", "023 RAF-JR.KAM/VIII/26"],
  ["Surat Rafraksi Lion Superindo periode september.pdf", "024 RAF-JR.KAM/VIII/26"],
];
for (const [file, noSurat] of ADIT_MATCH) {
  SKP_MATCH.push([`3:${file}`, 1, noSurat]);
}

// --- Fifth batch (SKP Update Pak Lucky.zip) ---
// Fills in Lucky's remaining rows 129-132 (Excel recorded no space before
// "RAF-KAM"; the signed letters print "241 RAF-KAM/VIII/2026" etc., matching
// Excel's own text exactly - verified by reading each PDF).
const LUCKY_MATCH = [
  ["241_Surat Rafraksi Hero & Diskon Supermarket.pdf", "241 RAF-KAM/VIII/2026"],
  ["242_Surat Rafraksi Hero & Diskon Supermarket.pdf", "242 RAF-KAM/VIII/2026"],
  ["243_Surat Rafraksi Hero & Diskon Supermarket.pdf", "243 RAF-KAM/VIII/2026"],
  ["244_Surat Rafraksi Prima Freshmart.pdf", "244 RAF-KAM/VIII/2026"],
];
for (const [file, noSurat] of LUCKY_MATCH) {
  SKP_MATCH.push([`4:${file}`, 1, noSurat]);
}

function norm(s) {
  return String(s).toUpperCase().replace(/[\s\-._]/g, "");
}
function normLoose(s) {
  return norm(s).replace(/\/?(2025|2026|2027|2028)$/, "");
}

// ---------------------------------------------------------------------------
// Excel parsing helpers
// ---------------------------------------------------------------------------
const MONTHS_ID = {
  januari: 1, februari: 2, maret: 3, april: 4, mei: 5, juni: 6, juli: 7,
  agustus: 8, september: 9, oktober: 10, november: 11, desember: 12,
};

// Parse a free-text "Periode" cell into [startDate, endDate] (YYYY-MM-DD).
// Handles: "Juli", "Juli - September", "2 - 31 Juli", "31 Juli - 27 Agustus",
// "13 Agustus - 9 September" (year defaults to 2026 unless explicit).
function parsePeriode(periode, defaultYear = 2026) {
  const raw = String(periode).trim();
  const parts = raw.split("-").map((s) => s.trim());

  function parseOnePart(part, fallbackMonth, fallbackYear) {
    // "31 Juli 2025" | "31 Juli" | "Juli" | "9" (day only, month comes from the other side)
    const m = part.match(/^(\d{1,2}\s+)?([A-Za-z]+)?(\s+\d{4})?$/);
    let day = null, month = fallbackMonth, year = fallbackYear;
    const dayMatch = part.match(/^(\d{1,2})\b/);
    if (dayMatch) day = parseInt(dayMatch[1], 10);
    const monthMatch = part.match(/[A-Za-z]+/);
    if (monthMatch) {
      const key = monthMatch[0].toLowerCase();
      if (MONTHS_ID[key]) month = MONTHS_ID[key];
    }
    const yearMatch = part.match(/\d{4}/);
    if (yearMatch) year = parseInt(yearMatch[0], 10);
    return { day, month, year };
  }

  if (parts.length === 1) {
    const { month, year } = parseOnePart(parts[0], null, defaultYear);
    if (!month) return [null, null]; // couldn't parse - flag in report
    const lastDay = new Date(year, month, 0).getDate();
    return [
      `${year}-${String(month).padStart(2, "0")}-01`,
      `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    ];
  }

  // two parts: "END" parsed first to know its month/year (for defaulting START's)
  const end = parseOnePart(parts[1], null, defaultYear);
  const start = parseOnePart(parts[0], end.month, end.year);
  const startDay = start.day || 1;
  const endMonth = end.month || start.month;
  const endDay = end.day || new Date(end.year, endMonth, 0).getDate();
  if (!start.month || !endMonth) return [null, null];
  return [
    `${start.year}-${String(start.month).padStart(2, "0")}-${String(startDay).padStart(2, "0")}`,
    `${end.year}-${String(endMonth).padStart(2, "0")}-${String(endDay).padStart(2, "0")}`,
  ];
}

function excelSerialToISODate(serial) {
  if (typeof serial !== "number") return null;
  // Excel epoch (1900 date system, with the 1900-leap-year bug baked in,
  // matching how xlsx/Excel itself resolves serials)
  const utcDays = Math.floor(serial - 25569);
  const date = new Date(utcDays * 86400 * 1000);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Build the row list
// ---------------------------------------------------------------------------
function buildRows() {
  const wb = xlsx.readFile(EXCEL_PATH);
  const ws = wb.Sheets["Trade Promo Q2"];
  const data = xlsx.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const body = data.slice(11).filter((r) => typeof r[0] === "number");

  const bySurat = new Map();
  const bySuratLoose = new Map();
  for (const r of body) {
    bySurat.set(norm(r[3]), r);
    const k = normLoose(r[3]);
    if (!bySuratLoose.has(k)) bySuratLoose.set(k, []);
    bySuratLoose.get(k).push(r);
  }
  // Manual override: PDF says 221, Excel row 58 recorded 220 (typo, confirmed
  // with user - the number 221 doesn't appear anywhere else in the sequence).
  const row58 = body.find((r) => r[0] === 58);
  if (row58) bySurat.set(norm("221 RAF-KAM/VII/2026"), row58);

  const matches = [];
  const usedRowNos = new Set();
  for (const [file, page, noSurat] of SKP_MATCH) {
    let row = bySurat.get(norm(noSurat));
    let method = "exact";
    if (!row) {
      const cands = bySuratLoose.get(normLoose(noSurat));
      if (cands && cands.length === 1) {
        row = cands[0];
        method = "loose-year-typo";
      }
    }
    if (!row) {
      console.warn("WARN: no Excel row for", file, page, noSurat);
      continue;
    }
    if (usedRowNos.has(row[0])) {
      console.warn("WARN: Excel row", row[0], "already matched, skipping dup from", file, page);
      continue;
    }
    usedRowNos.add(row[0]);
    matches.push({ file, page, noSuratOnDoc: noSurat, row, method });
  }

  const skippedNoPdf = body.filter((r) => !usedRowNos.has(r[0]));

  const rows = matches.map(({ file, page, noSuratOnDoc, row, method }) => {
    const [, tglPengajuanSerial, periode, noSuratExcel, toko, , totalBudget, , , program, pic] = row;
    const pm = PIC_MAP[pic];
    if (!pm) throw new Error(`Unknown PIC "${pic}" on Excel row ${row[0]}`);
    let [startDate, endDate] = parsePeriode(periode);
    // Confirmed data-entry typo: Excel's "Agustus - Desember 2025" on this
    // row should be 2026 (row was submitted Agustus 2026, and TP1 Q2 only
    // covers Jul-Sep 2026) - user confirmed the fix during grill-me.
    if (row[0] === 94) {
      startDate = "2026-08-01";
      endDate = "2026-12-31";
    }
    const programLabel = program || "Trade Promo Fund";
    // Confirmed data-entry typo: Excel recorded "220" but the signed SKP
    // letter itself says 221 (and 221 is otherwise missing from the
    // 199-230 sequence, confirming it belongs here) - user confirmed.
    const referenceNumber = row[0] === 58 ? "221 RAF-KAM/VII/2026" : noSuratExcel;
    return {
      excelNo: row[0],
      noSurat: referenceNumber,
      noSuratRaw: noSuratExcel,
      noSuratOnDoc,
      matchMethod: method,
      toko,
      program: programLabel,
      pic,
      periode,
      startDate,
      endDate,
      submittedAt: excelSerialToISODate(tglPengajuanSerial),
      requestedBudget: Math.round(Number(totalBudget) || 0),
      name: `${programLabel} - ${toko} - ${pm.region}`,
      createdBy: pm.userId,
      createdByLabel: pm.userName,
      departmentId: DEPARTMENT_SALES,
      regionId: REGIONS[pm.region],
      regionLabel: pm.region,
      brandId: BRAND_SHELLY_SENBEI_96G,
      promotionCategoryId: PROMO_CATEGORY_TRADE_PROMO_FUND,
      channelId: classifyChannel(toko),
      channelLabel: classifyChannel(toko) === CHANNEL_MT ? "MT" : "GT",
      sourceFile: file,
      sourcePage: page,
    };
  });

  return { rows, skippedNoPdf };
}

// ---------------------------------------------------------------------------
// Dry run: write a review report, touch nothing
// ---------------------------------------------------------------------------
function dryRun() {
  const { rows, skippedNoPdf } = buildRows();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const lines = [];
  lines.push("No,NoSurat,MatchMethod,Toko,Program,PIC,Region,Channel,Periode,StartDate,EndDate,SubmittedAt,RequestedBudget,CampaignName,SourceFile,SourcePage");
  for (const r of rows) {
    lines.push([
      r.excelNo, r.noSurat, r.matchMethod, r.toko, r.program, r.pic, r.regionLabel,
      r.channelLabel, r.periode, r.startDate, r.endDate, r.submittedAt, r.requestedBudget,
      r.name, r.sourceFile, r.sourcePage,
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }
  const csvPath = path.join(OUT_DIR, "tp1-q2-dry-run.csv");
  fs.writeFileSync(csvPath, lines.join("\n"), "utf8");

  const dateIssues = rows.filter((r) => !r.startDate || !r.endDate);
  const jsonPath = path.join(OUT_DIR, "tp1-q2-dry-run.json");
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ toImport: rows.length, skippedNoPdf: skippedNoPdf.map((r) => ({ no: r[0], noSurat: r[3], toko: r[4], pic: r[10] })), dateParseIssues: dateIssues.map(r=>({no:r.excelNo, periode:r.periode})) }, null, 2),
    "utf8"
  );

  console.log(`Rows to import: ${rows.length}`);
  console.log(`Rows skipped (no PDF): ${skippedNoPdf.length}`);
  console.log(`Date parse issues: ${dateIssues.length}`);
  console.log(`Report written to:\n  ${csvPath}\n  ${jsonPath}`);
}

// ---------------------------------------------------------------------------
// Execute: real import
// ---------------------------------------------------------------------------
async function execute() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  const env = Object.fromEntries(
    fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
  );
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { rows: allRows } = buildRows();

  // Skip rows already imported (makes this script safe to re-run after
  // adding new SKP_MATCH entries for a later batch of PDFs).
  const { data: existing, error: existingErr } = await sb.from("campaigns").select("reference_number").not("reference_number", "is", null);
  if (existingErr) throw new Error(`checking existing campaigns: ${existingErr.message}`);
  const existingRefs = new Set((existing || []).map((r) => r.reference_number));
  const rows = allRows.filter((r) => !existingRefs.has(r.noSurat));
  console.log(`${allRows.length} rows matched total, ${existingRefs.size} already imported, ${rows.length} new to import.`);

  const results = [];

  for (const r of rows) {
    try {
      // 1. Extract the SKP page(s) as a standalone PDF
      const srcPath = r.sourceFile.startsWith("4:")
        ? path.join(EXTRACT_DIR4, r.sourceFile.slice(2))
        : r.sourceFile.startsWith("3:")
        ? path.join(EXTRACT_DIR3, r.sourceFile.slice(2))
        : r.sourceFile.startsWith("2:")
        ? path.join(EXTRACT_DIR2, r.sourceFile.slice(2))
        : path.join(EXTRACT_DIR, r.sourceFile);
      const srcBytes = fs.readFileSync(srcPath);
      const srcDoc = await PDFDocument.load(srcBytes);
      const outDoc = await PDFDocument.create();
      if (r.sourcePage === "ALL") {
        const pages = await outDoc.copyPages(srcDoc, srcDoc.getPageIndices());
        pages.forEach((p) => outDoc.addPage(p));
      } else {
        const [page] = await outDoc.copyPages(srcDoc, [r.sourcePage - 1]);
        outDoc.addPage(page);
      }
      const outBytes = await outDoc.save();

      // 2. Upload to storage
      const safeName = `tp1-q2-import/${r.noSurat.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
      const { error: upErr } = await sb.storage.from("campaign-documents").upload(safeName, outBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upErr) throw new Error(`upload: ${upErr.message}`);
      const { data: urlData } = sb.storage.from("campaign-documents").getPublicUrl(safeName);

      // 3. Insert campaign
      const { data: campaign, error: campErr } = await sb
        .from("campaigns")
        .insert({
          name: r.name,
          department_id: r.departmentId,
          brand_id: r.brandId,
          region_id: r.regionId,
          channel_id: r.channelId,
          promotion_category_id: r.promotionCategoryId,
          vendor_id: null,
          objective: `Bulk historical import - TP1 Q2 (${r.program}, ${r.toko}, periode ${r.periode})`,
          requested_budget: r.requestedBudget,
          actual_spent: 0,
          status: "approved",
          created_by: r.createdBy,
          start_date: r.startDate,
          end_date: r.endDate,
          submitted_at: r.submittedAt ? `${r.submittedAt}T00:00:00Z` : null,
          reference_number: r.noSurat,
        })
        .select()
        .single();
      if (campErr) throw new Error(`campaign insert: ${campErr.message}`);

      // 4. campaign_files
      const { error: fileErr } = await sb.from("campaign_files").insert({
        campaign_id: campaign.id,
        file_name: path.basename(safeName),
        file_url: urlData.publicUrl,
        file_type: "application/pdf",
        file_size: outBytes.length,
        uploaded_by: r.createdBy,
      });
      if (fileErr) throw new Error(`campaign_files insert: ${fileErr.message}`);

      // 5. approval_history (synthetic, clearly labeled)
      const { error: histErr } = await sb.from("approval_history").insert({
        campaign_id: campaign.id,
        actor_id: r.createdBy,
        role: "admin",
        action: "approved",
        comment: "Bulk historical import dari rekap TP1 Q2 (SKP sudah full approve secara manual sebelum tercatat di marmot).",
      });
      if (histErr) throw new Error(`approval_history insert: ${histErr.message}`);

      results.push({ excelNo: r.excelNo, noSurat: r.noSurat, campaignId: campaign.id, status: "ok" });
      console.log(`OK  No.${r.excelNo}  ${r.noSurat}  ${r.toko}  -> ${campaign.id}`);
    } catch (err) {
      results.push({ excelNo: r.excelNo, noSurat: r.noSurat, status: "ERROR", error: err.message });
      console.error(`ERR No.${r.excelNo}  ${r.noSurat}  ${r.toko} -> ${err.message}`);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "tp1-q2-execute-result.json"), JSON.stringify(results, null, 2), "utf8");
  const okCount = results.filter((r) => r.status === "ok").length;
  console.log(`\nDone. ${okCount}/${results.length} imported successfully.`);
}

// ---------------------------------------------------------------------------
const mode = process.argv[2];
if (mode === "--dry-run") {
  dryRun();
} else if (mode === "--execute") {
  execute();
} else {
  console.log("Usage: node scripts/import-tp1-q2.js --dry-run | --execute");
}
