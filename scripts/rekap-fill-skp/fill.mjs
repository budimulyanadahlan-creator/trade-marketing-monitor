// Fill "No SKP Marmot" + "No. SKP Area" in an area SKP recap workbook
// (e.g. "Rekap SKP Flush Out Opao Q2 2026 ...xlsx").
//
// The recap's "No. SKP Area" column is assumed to currently hold the marmot
// skp_number (e.g. "0172/WWI/09/2026"). For each data row the script:
//   - moves that value to "No SKP Marmot"
//   - reads the campaign's attachments (campaign_files) and puts the letter
//     number printed in the PDF ("No : 235/ASM-KMS/WWI/VIII/2026") into
//     "No. SKP Area"
//   - inserts a "No. Prefix File" column after "No. SKP Area" holding the
//     number prefix of the attachment's file name ("235", "009", "EUK_005")
//   - highlights rows needing a manual check and lists them on a "Catatan"
//     sheet (letter number not found, attachments disagree, duplicate
//     skp_number, budget differs from marmot requested_budget)
// The source file is never modified; output goes next to it.
//
// Usage:
//   node scripts/rekap-fill-skp/fill.mjs "<path to recap.xlsx>" [--dry-run]

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import { createClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const YELLOW = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const ORANGE = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" } };
const SKP_NUMBER_RE = /^\d{4}\/WWI\/\d{2}\/\d{4}$/;

// Letter numbers read by eye from scanned (text-less) attachments, keyed by skp_number.
const SCANNED_LETTER_OVERRIDES = {
  "0122/WWI/09/2026": "203/ASM-KMS/WWI/VIII/2026",
};

function loadEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env.local");
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

function cellText(cell) {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object" && "richText" in v) return v.richText.map((r) => r.text).join("").trim();
  if (typeof v === "object" && "result" in v) return String(v.result ?? "").trim();
  return String(v).trim();
}

// exceljs shares one style object between cells with the same styleId, so
// clone before changing the fill or it bleeds into every such cell.
function paint(cell, fill) {
  cell.style = { ...JSON.parse(JSON.stringify(cell.style ?? {})), fill };
}

// "235- Program ..." -> "235", "009. Promosi" -> "009", "EUK_005_FOC" -> "EUK_005",
// "001.ASS.ART.VII.2026_Tambahan" -> "001.ASS.ART.VII.2026", "002.VII Program" -> "002.VII"
function filePrefix(fileName) {
  const m = fileName.match(/^[A-Z]{2,5}_\d{2,4}/) ?? fileName.match(/^\d[0-9A-Za-z.]*/);
  return m ? m[0].replace(/\.+$/, "") : "";
}

// Letter number from the SKP letter body: "No : 235/ASM-KMS/WWI/VIII/2026 Hal. : ..."
function letterNumber(text) {
  const flat = text.replace(/\s+/g, " ");
  const m = flat.match(/\bNo\s*\.?\s*:\s*(.+?)\s+(?:Hal|Perihal|Lamp)\b/i);
  return m ? m[1].trim() : "";
}

async function readAttachments(supabase, files) {
  const out = [];
  for (const f of files) {
    const entry = { name: f.file_name, prefix: filePrefix(f.file_name), letter: "" };
    if ((f.file_type ?? "").toLowerCase() === "application/pdf") {
      const { data: blob, error } = await supabase.storage.from("campaign-documents").download(f.file_url);
      if (!error && blob) {
        try {
          const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
          const { text } = await extractText(pdf, { mergePages: true });
          entry.letter = letterNumber(text);
        } catch {
          // unreadable PDF: fall back to the file-name prefix
        }
      }
    }
    out.push(entry);
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const input = args.find((a) => !a.startsWith("--"));
  if (!input) throw new Error("Usage: node scripts/rekap-fill-skp/fill.mjs <recap.xlsx> [--dry-run]");

  loadEnv();
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(input);
  const ws = wb.worksheets[0];

  // Locate header row + columns by name
  let headerRow = 0;
  const col = {};
  ws.eachRow((row, r) => {
    if (headerRow) return;
    row.eachCell((cell, c) => {
      const t = cellText(cell).toLowerCase();
      if (t === "no. skp area") col.area = c;
      if (t === "no skp marmot") col.marmot = c;
      if (t === "no") col.no = c;
      if (t.startsWith("budget")) col.budget = c;
    });
    if (col.area && col.marmot) headerRow = r;
  });
  if (!headerRow) throw new Error('Header "No. SKP Area" / "No SKP Marmot" not found');

  // Collect data rows (numeric "No")
  const rows = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const no = ws.getCell(r, col.no).value;
    if (typeof no !== "number") continue;
    rows.push({ r, no, skp: cellText(ws.getCell(r, col.area)), budget: Number(cellText(ws.getCell(r, col.budget))) || 0 });
  }

  // Look up marmot + attachments
  for (const row of rows) {
    row.issues = [];
    if (!SKP_NUMBER_RE.test(row.skp)) {
      row.issues.push(`"${row.skp}" bukan format No SKP marmot`);
      continue;
    }
    const { data, error } = await supabase
      .from("campaigns")
      .select("name, requested_budget, campaign_files(file_name, file_url, file_type, uploaded_at)")
      .eq("skp_number", row.skp);
    if (error) throw error;
    if (!data.length) {
      row.issues.push("No SKP tidak ditemukan di marmot");
      continue;
    }
    const c = data[0];
    const files = [...c.campaign_files].sort((a, b) => String(a.uploaded_at).localeCompare(String(b.uploaded_at)));
    const att = await readAttachments(supabase, files);
    row.prefix = att[0]?.prefix ?? "";
    row.letter = att[0]?.letter ?? "";
    row.marmotBudget = Number(c.requested_budget) || 0;

    if (!att.length) row.issues.push("Tidak ada lampiran di marmot");
    else if (!row.letter && SCANNED_LETTER_OVERRIDES[row.skp]) {
      row.letter = SCANNED_LETTER_OVERRIDES[row.skp];
      row.letterFallback = true;
      row.issues.push("Nomor surat tidak terbaca dari PDF; dibaca visual dari PDF scan");
    } else if (!row.letter) {
      row.letter = row.prefix;
      row.letterFallback = true;
      row.issues.push("Nomor surat tidak terbaca dari PDF; diisi prefix nama file");
    }
    const letters = [...new Set(att.map((a) => a.letter).filter(Boolean))];
    if (letters.length > 1) row.issues.push(`Lampiran berbeda nomor: ${letters.join(" vs ")}`);
    if (row.marmotBudget !== row.budget)
      row.issues.push(`Budget Excel ${row.budget.toLocaleString("id-ID")} ≠ marmot ${row.marmotBudget.toLocaleString("id-ID")}`);
  }

  // Duplicate skp_number across rows
  const byKey = new Map();
  for (const row of rows) byKey.set(row.skp, [...(byKey.get(row.skp) ?? []), row]);
  const duplicateGroups = [...byKey.values()].filter((g) => g.length > 1);
  for (const g of duplicateGroups)
    for (const row of g) row.issues.push(`Duplikat dengan baris No ${g.filter((x) => x !== row).map((x) => x.no).join(", ")}`);

  for (const row of rows)
    console.log(
      row.no,
      row.skp.padEnd(17),
      (row.letter ?? "").padEnd(28),
      (row.prefix ?? "").padEnd(22),
      row.issues.join(" | "),
    );
  if (dryRun) return;

  // --- Write workbook ---
  const lastHeaderCol = Math.max(col.no, col.area, col.marmot, col.budget);

  // Clear stray cells to the right of the table in data rows
  for (const row of rows)
    for (let c = lastHeaderCol + 1; c <= ws.columnCount; c++) ws.getCell(row.r, c).value = null;

  // Insert "No. Prefix File" after "No. SKP Area". exceljs doesn't shift merges
  // or formula references, so fix those by hand.
  const merges = [...(ws.model.merges ?? [])];
  for (const m of merges) ws.unMergeCells(m);
  const insertAt = col.area + 1;
  const areaWidth = ws.getColumn(col.area).width;
  ws.spliceColumns(insertAt, 0, []);
  const shiftCol = (letters) => {
    const n = letters.split("").reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0);
    if (n < insertAt) return letters;
    let x = n + 1, s = "";
    while (x > 0) { const rem = (x - 1) % 26; s = String.fromCharCode(65 + rem) + s; x = Math.floor((x - 1) / 26); }
    return s;
  };
  const shiftRef = (ref) => ref.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (_, a, l, b, d) => `${a}${shiftCol(l)}${b}${d}`);
  for (const m of merges) ws.mergeCells(shiftRef(m));
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      const v = cell.value;
      if (v && typeof v === "object" && "formula" in v) cell.value = { ...v, formula: shiftRef(v.formula) };
    }),
  );
  const marmotCol = col.marmot >= insertAt ? col.marmot + 1 : col.marmot;

  // Header + styles for the new column, copied from "No. SKP Area"
  ws.getColumn(insertAt).width = areaWidth ?? 18;
  ws.getColumn(col.area).width = Math.max(areaWidth ?? 0, 30);
  ws.getColumn(marmotCol).width = Math.max(ws.getColumn(marmotCol).width ?? 0, 18);
  for (let r = headerRow; r <= ws.rowCount; r++) {
    const src = ws.getCell(r, col.area);
    if (src.style && Object.keys(src.style).length) ws.getCell(r, insertAt).style = JSON.parse(JSON.stringify(src.style));
  }
  ws.getCell(headerRow, insertAt).value = "No. Prefix File";

  for (const row of rows) {
    ws.getCell(row.r, marmotCol).value = row.skp;
    ws.getCell(row.r, col.area).value = row.letter ?? "";
    ws.getCell(row.r, insertAt).value = row.prefix ?? "";
    const lastCol = Math.max(lastHeaderCol + 1, marmotCol);
    if (row.issues.some((i) => !i.startsWith("Nomor surat tidak terbaca")))
      for (let c = 1; c <= lastCol; c++) paint(ws.getCell(row.r, c), ORANGE);
    if (row.letterFallback) paint(ws.getCell(row.r, col.area), YELLOW);
  }

  // Catatan sheet
  const note = wb.addWorksheet("Catatan");
  note.columns = [
    { header: "No", width: 6 },
    { header: "No SKP Marmot", width: 18 },
    { header: "No. SKP Area", width: 30 },
    { header: "Budget (IDR)", width: 16 },
    { header: "Catatan", width: 90 },
  ];
  note.getRow(1).font = { bold: true };
  for (const row of rows.filter((x) => x.issues.length))
    note.addRow([row.no, row.skp, row.letter ?? "", row.budget, row.issues.join("; ")]);
  note.getColumn(4).numFmt = "#,##0";
  if (duplicateGroups.length) {
    const extra = duplicateGroups.reduce((s, g) => s + g.slice(1).reduce((t, x) => t + x.budget, 0), 0);
    note.addRow([]);
    note.addRow(["", "", "", extra, "Potensi kelebihan total akibat baris duplikat (jika duplikat dihapus, total berkurang sebesar ini)"]);
  }
  note.addRow([]);
  note.addRow(["", "", "", "", "Kuning (kolom No. SKP Area): nomor surat tidak terbaca dari PDF, diisi prefix nama file — cek manual."]);
  note.addRow(["", "", "", "", "Oranye (baris): perlu dicek — lihat catatan di atas. Data tidak diubah."]);

  const out = path.join(path.dirname(input), path.basename(input, ".xlsx") + " - dengan No SKP.xlsx");
  await wb.xlsx.writeFile(out);
  console.log("\nSaved:", out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
