// One-off follow-up: add the 3 TP1 Trade Promo Fund SKPs that the Sep-13
// gap analysis found missing from marmot (Naga Swalayan 232/233 - Rafraksi
// revisions replacing SKP 206/207 - and Mumuso 245 - Harga Khusus). Also
// cancels 206 and 207 since their own replacement letters say they're no
// longer valid ("tidak berlaku lagi karena ada kesalahan rafaksi per
// itemnya"), confirmed with user 2026-09-15 (no realizations/claims exist
// against either, safe to cancel).
//
// Usage:
//   node scripts/add-missing-tp1-skp.js --dry-run
//   node scripts/add-missing-tp1-skp.js --execute

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const SOURCE_DIR = "D:\\Want want\\TMK\\PROJECT\\Marmot 2026\\SKP Manual Upload";

const DEPARTMENT_SALES = "277103f0-c0ea-4540-8b82-a1a9ba70034e";
const BRAND_SHELLY_SENBEI_96G = "06d62749-6317-46d3-bb74-c79bfda2a409";
const PROMO_CATEGORY_TRADE_PROMO_FUND = "1dc152e7-695b-4347-a6c1-fed89c57b052";
const CHANNEL_GT = "8090c5d1-6480-4be5-b159-869d7d5ef5b0";
const CHANNEL_MT = "00f80e97-08bb-4748-900b-cf9bf7ed023c";
const REGION_NATIONAL = "ef4fdba9-0fbd-4c85-9cf7-c82ab6ee0ddf";
const LUCKY_USER_ID = "ea25760e-e582-44f5-a10e-41dc8121b1f3"; // KAM 1, per PIC_MAP in import-tp1-q2.js
const ADMIN_ACTOR_ID = "389ba663-03b1-482f-a4b2-713e31a9d259"; // BudiMulyana (admin), doing this follow-up

const TO_CANCEL = [
  {
    reference_number: "206 RAF-KAM/VII/2026",
    supersededBy: "232 RAF-KAM/VIII/2026",
  },
  {
    reference_number: "207 RAF-KAM/VII/2026",
    supersededBy: "233 RAF-KAM/VIII/2026",
  },
];

const TO_INSERT = [
  {
    referenceNumber: "232 RAF-KAM/VIII/2026",
    name: "Rafraksi - Naga Swalayan (Revisi) - National",
    toko: "Naga Swalayan",
    requestedBudget: 2660000,
    startDate: "2026-07-01",
    endDate: "2026-07-31",
    submittedAt: "2026-08-03",
    sourceFile: "232_Surat Rafraksi Naga Swalayan periode Juli (Revisi).pdf",
    objective: "Revisi SKP - Rafraksi Naga Swalayan periode Juli 2026 (pengganti SKP 206, dibatalkan karena kesalahan rafaksi per item)",
  },
  {
    referenceNumber: "233 RAF-KAM/VIII/2026",
    name: "Rafraksi - Naga Swalayan (Revisi) - National",
    toko: "Naga Swalayan",
    requestedBudget: 2778000,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    submittedAt: "2026-08-03",
    sourceFile: "233_Surat Rafraksi Naga Swalayan periode Agustus (Revisi).pdf",
    objective: "Revisi SKP - Rafraksi Naga Swalayan periode Agustus 2026 (pengganti SKP 207, dibatalkan karena kesalahan rafaksi per item)",
  },
  {
    referenceNumber: "245/HARGA KHUSUS-KAM/IX/2026",
    name: "Harga Khusus - Mumuso - National",
    toko: "Mumuso",
    requestedBudget: 197100,
    startDate: "2026-09-11",
    endDate: "2026-09-30",
    submittedAt: "2026-09-10",
    sourceFile: "245. Harga Khusus MUMUSO PO September 2026(1) (1).pdf",
    objective: "Harga Khusus - Mumuso periode 11-30 September 2026",
  },
];

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

async function main() {
  const mode = process.argv[2];
  if (mode !== "--dry-run" && mode !== "--execute") {
    console.log("Usage: node scripts/add-missing-tp1-skp.js --dry-run | --execute");
    process.exit(1);
  }

  console.log("=== Plan ===");
  console.log("Cancel:");
  for (const c of TO_CANCEL) console.log(`  ${c.reference_number}  -> cancelled (superseded by ${c.supersededBy})`);
  console.log("Insert:");
  for (const r of TO_INSERT) {
    const channel = classifyChannel(r.toko) === CHANNEL_MT ? "MT" : "GT";
    console.log(`  ${r.referenceNumber}  ${r.toko}  Rp${r.requestedBudget.toLocaleString("id-ID")}  ${r.startDate}..${r.endDate}  channel=${channel}`);
    const srcPath = path.join(SOURCE_DIR, r.sourceFile);
    if (!fs.existsSync(srcPath)) throw new Error(`Source PDF not found: ${srcPath}`);
  }

  if (mode === "--dry-run") {
    console.log("\nDry run only - no DB/storage writes performed.");
    return;
  }

  const envPath = path.join(__dirname, "..", ".env.local");
  const env = Object.fromEntries(
    fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
  );
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  // --- 1. Cancel 206 & 207 ---
  for (const c of TO_CANCEL) {
    const { data: existing, error: findErr } = await sb
      .from("campaigns")
      .select("id, status")
      .eq("reference_number", c.reference_number)
      .single();
    if (findErr) throw new Error(`find ${c.reference_number}: ${findErr.message}`);
    if (existing.status === "cancelled") {
      console.log(`SKIP cancel ${c.reference_number} - already cancelled`);
      continue;
    }
    const { error: updErr } = await sb.from("campaigns").update({ status: "cancelled" }).eq("id", existing.id);
    if (updErr) throw new Error(`cancel ${c.reference_number}: ${updErr.message}`);
    const { error: histErr } = await sb.from("approval_history").insert({
      campaign_id: existing.id,
      actor_id: ADMIN_ACTOR_ID,
      role: "admin",
      action: "rejected",
      comment: `Dibatalkan - SKP ini tidak berlaku lagi karena kesalahan rafaksi per item, digantikan oleh SKP ${c.supersededBy} (surat revisi dari toko, follow-up gap analysis TP1 Q2 2026-09-13).`,
    });
    if (histErr) throw new Error(`history for cancel ${c.reference_number}: ${histErr.message}`);
    console.log(`CANCELLED ${c.reference_number} -> ${existing.id}`);
  }

  // --- 2. Insert 232, 233, 245 ---
  for (const r of TO_INSERT) {
    const srcPath = path.join(SOURCE_DIR, r.sourceFile);
    const bytes = fs.readFileSync(srcPath);

    const safeName = `tp1-q2-followup/${r.referenceNumber.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
    const { error: upErr } = await sb.storage.from("campaign-documents").upload(safeName, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (upErr) throw new Error(`upload ${r.referenceNumber}: ${upErr.message}`);
    const { data: urlData } = sb.storage.from("campaign-documents").getPublicUrl(safeName);

    const skpDate = new Date(`${r.submittedAt}T00:00:00Z`);
    const { data: skpSeq, error: skpErr } = await sb.rpc("increment_skp_counter", {
      p_year: skpDate.getUTCFullYear(),
      p_month: skpDate.getUTCMonth() + 1,
    });
    if (skpErr) throw new Error(`increment_skp_counter ${r.referenceNumber}: ${skpErr.message}`);
    const skpNumber = `${String(skpSeq).padStart(4, "0")}/WWI/${String(skpDate.getUTCMonth() + 1).padStart(2, "0")}/${skpDate.getUTCFullYear()}`;

    const { data: campaign, error: campErr } = await sb
      .from("campaigns")
      .insert({
        name: r.name,
        department_id: DEPARTMENT_SALES,
        brand_id: BRAND_SHELLY_SENBEI_96G,
        region_id: REGION_NATIONAL,
        channel_id: classifyChannel(r.toko),
        promotion_category_id: PROMO_CATEGORY_TRADE_PROMO_FUND,
        vendor_id: null,
        objective: r.objective,
        requested_budget: r.requestedBudget,
        actual_spent: 0,
        status: "approved",
        created_by: LUCKY_USER_ID,
        start_date: r.startDate,
        end_date: r.endDate,
        submitted_at: `${r.submittedAt}T00:00:00Z`,
        reference_number: r.referenceNumber,
        skp_number: skpNumber,
      })
      .select()
      .single();
    if (campErr) throw new Error(`insert ${r.referenceNumber}: ${campErr.message}`);

    const { error: fileErr } = await sb.from("campaign_files").insert({
      campaign_id: campaign.id,
      file_name: path.basename(safeName),
      file_url: urlData.publicUrl,
      file_type: "application/pdf",
      file_size: bytes.length,
      uploaded_by: LUCKY_USER_ID,
    });
    if (fileErr) throw new Error(`campaign_files ${r.referenceNumber}: ${fileErr.message}`);

    const { error: histErr } = await sb.from("approval_history").insert({
      campaign_id: campaign.id,
      actor_id: ADMIN_ACTOR_ID,
      role: "admin",
      action: "approved",
      comment: "Input manual - SKP sudah full approve secara fisik, ditemukan tertinggal saat gap analysis rekap TP1 Q2 vs marmot (2026-09-13).",
    });
    if (histErr) throw new Error(`history ${r.referenceNumber}: ${histErr.message}`);

    console.log(`INSERTED ${r.referenceNumber}  ${r.toko}  skp_number=${skpNumber}  -> ${campaign.id}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
