// One-off: recategorize SKP 0165/WWI/08/2026 (PT. Global Retailindo Pratama,
// Surat Rafaksi Agustus) from "Trading Term and Business Plan" to
// "Trade Promo Fund" (TP1), per user request.
//
// Usage: node scripts/move-skp-category.js

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const REPO_ROOT = path.resolve(__dirname, "..");
const CAMPAIGN_ID = "1164fd90-892c-4ef8-9ae6-f9516672d92f"; // skp_number 0165/WWI/08/2026
const OLD_CATEGORY_ID = "3876e147-ec7a-4329-9a4e-2daea5fa9a21"; // Trading Term and Business Plan
const NEW_CATEGORY_ID = "1dc152e7-695b-4347-a6c1-fed89c57b052"; // Trade Promo Fund (TP1)

async function main() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  const env = Object.fromEntries(
    fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
  );
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: before, error: beforeErr } = await sb
    .from("campaigns")
    .select("id, skp_number, promotion_category_id")
    .eq("id", CAMPAIGN_ID)
    .single();
  if (beforeErr) throw beforeErr;
  if (before.promotion_category_id !== OLD_CATEGORY_ID) {
    throw new Error(
      `Refusing to update: expected current category ${OLD_CATEGORY_ID}, found ${before.promotion_category_id}`
    );
  }

  const { data, error } = await sb
    .from("campaigns")
    .update({ promotion_category_id: NEW_CATEGORY_ID })
    .eq("id", CAMPAIGN_ID)
    .select()
    .single();
  if (error) throw error;
  console.log("OK", data.skp_number, "->", data.promotion_category_id);

  const { error: histErr } = await sb.from("approval_history").insert({
    campaign_id: CAMPAIGN_ID,
    actor_id: data.created_by,
    role: "admin",
    action: "approved",
    comment:
      "Kategori promosi dipindah dari 'Trading Term and Business Plan' ke 'Trade Promo Fund' (TP1) atas permintaan user.",
  });
  if (histErr) console.error("WARN approval_history:", histErr.message);
}

main();
