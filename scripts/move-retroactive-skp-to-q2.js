// One-off: move the 2 retroactive TP1 Q2 SKPs (AEON no.127, FoodHall no.128 -
// see scripts/import-tp1-q2.js) into FY2026 Q2 (Jul-Sep 2026) so their claim
// is paid out of the Q2 2026 budget, per user request. The SKPs' documented
// promo period (Agustus 2025 / Desember 2025) is unchanged - only the
// campaign's start/end_date (used for Monitoring Budget quarter bucketing)
// is shifted. Start date anchored at 2026-07-01 (start of Q2) per user
// choice; end_date preserves each SKP's original day-span.
//
// Usage: node scripts/move-retroactive-skp-to-q2.js

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const REPO_ROOT = path.resolve(__dirname, "..");
const LUCKY_USER_ID = "ea25760e-e582-44f5-a10e-41dc8121b1f3"; // KAM 1, original PIC

const UPDATES = [
  {
    who: "AEON (No.127)",
    id: "848090b4-4b6a-485c-b40c-70780a4645cb",
    start_date: "2026-07-01",
    end_date: "2026-07-14", // preserves original 13-day span (14-27 Agustus 2025)
    objective:
      "Bulk historical import - TP1 Q2 (Rafraksi, AEON, periode dokumen asli 14 - 27 Agustus 2025). " +
      "Start/end date dipindah ke Q2 FY2026 (1-14 Juli 2026) atas permintaan user supaya " +
      "pembayarannya memakai budget Q2 2026 - periode promo aktual di SKP tetap Agustus 2025.",
  },
  {
    who: "FoodHall (No.128)",
    id: "f7ff9283-6082-44db-8347-82eba6fa0923",
    start_date: "2026-07-01",
    end_date: "2026-07-31", // preserves original 30-day span (1-31 Desember 2025)
    objective:
      "Bulk historical import - TP1 Q2 (Rafraksi, FoodHall, periode dokumen asli 1 - 31 Desember 2025). " +
      "Start/end date dipindah ke Q2 FY2026 (1-31 Juli 2026) atas permintaan user supaya " +
      "pembayarannya memakai budget Q2 2026 - periode promo aktual di SKP tetap Desember 2025.",
  },
];

async function main() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  const env = Object.fromEntries(
    fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
  );
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  for (const u of UPDATES) {
    const { data, error } = await sb
      .from("campaigns")
      .update({ start_date: u.start_date, end_date: u.end_date, objective: u.objective })
      .eq("id", u.id)
      .select()
      .single();
    if (error) {
      console.error("ERR", u.who, error.message);
      continue;
    }
    console.log("OK", u.who, data.id, data.start_date, "->", data.end_date);

    const { error: histErr } = await sb.from("approval_history").insert({
      campaign_id: u.id,
      actor_id: LUCKY_USER_ID,
      role: "admin",
      action: "approved",
      comment: `Periode start/end date dipindah ke Q2 FY2026 (${u.start_date} s/d ${u.end_date}) atas permintaan user, supaya klaim SKP retroaktif ini dibayarkan memakai budget Q2 2026. Periode promo aktual sesuai dokumen SKP tidak berubah.`,
    });
    if (histErr) console.error("WARN approval_history", u.who, histErr.message);
  }
}

main();
