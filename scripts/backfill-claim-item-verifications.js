// One-off: backfill claim_item_verifications for every campaign that's
// already at claim_submitted or later, so the self-heal call inside
// app/(protected)/campaigns/[id]/page.tsx (ensureClaimItemVerifications) can
// be removed from the page-load hot path (plans/perf-skp-pages.md, Fase 0).
//
// Same logic as lib/claim-item-verifications.ts's ensureClaimItemVerifications
// — additive-only, idempotent, safe to re-run — but batched across every
// matching campaign in a handful of round-trips instead of one campaign at a
// page load.
//
// Usage:
//   node scripts/backfill-claim-item-verifications.js            (dry run — reports only)
//   node scripts/backfill-claim-item-verifications.js --apply    (actually inserts)

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const REPO_ROOT = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

const TARGET_STATUSES = [
  "claim_submitted",
  "claim_verified",
  "ready_to_pay",
  "paid",
  "completed",
];

async function main() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  const env = Object.fromEntries(
    fs
      .readFileSync(envPath, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i), l.slice(i + 1)];
      })
  );
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data: campaigns, error: campaignsErr } = await sb
    .from("campaigns")
    .select("id, skp_number, status, promotion_category_id")
    .in("status", TARGET_STATUSES);
  if (campaignsErr) throw campaignsErr;

  const withCategory = campaigns.filter((c) => c.promotion_category_id);
  console.log(
    `${campaigns.length} campaign(s) at claim_submitted+ (${withCategory.length} have a promotion_category_id).`
  );
  if (withCategory.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  const campaignIds = withCategory.map((c) => c.id);
  const categoryIds = [...new Set(withCategory.map((c) => c.promotion_category_id))];

  const [{ data: requirements, error: reqErr }, { data: existing, error: existingErr }] =
    await Promise.all([
      sb
        .from("claim_requirements")
        .select("promotion_category_id, document_type_id")
        .in("promotion_category_id", categoryIds),
      sb
        .from("claim_item_verifications")
        .select("campaign_id, item_type, document_type_id")
        .in("campaign_id", campaignIds),
    ]);
  if (reqErr) throw reqErr;
  if (existingErr) throw existingErr;

  const requiredDocsByCategory = new Map();
  for (const r of requirements) {
    const list = requiredDocsByCategory.get(r.promotion_category_id) ?? [];
    list.push(r.document_type_id);
    requiredDocsByCategory.set(r.promotion_category_id, list);
  }

  const existingByCampaign = new Map();
  for (const row of existing) {
    const set = existingByCampaign.get(row.campaign_id) ?? new Set();
    set.add(row.item_type === "amount" ? "amount" : row.document_type_id);
    existingByCampaign.set(row.campaign_id, set);
  }

  const rowsToInsert = [];
  for (const c of withCategory) {
    const requiredDocs = requiredDocsByCategory.get(c.promotion_category_id) ?? [];
    const existingSet = existingByCampaign.get(c.id) ?? new Set();

    for (const docTypeId of requiredDocs) {
      if (!existingSet.has(docTypeId)) {
        rowsToInsert.push({
          campaign_id: c.id,
          item_type: "document",
          document_type_id: docTypeId,
          status: "pending",
        });
      }
    }
    if (!existingSet.has("amount")) {
      rowsToInsert.push({
        campaign_id: c.id,
        item_type: "amount",
        document_type_id: null,
        status: "pending",
      });
    }
  }

  const affectedCampaigns = new Set(rowsToInsert.map((r) => r.campaign_id)).size;
  console.log(
    `${rowsToInsert.length} missing item row(s) across ${affectedCampaigns} campaign(s).`
  );

  if (!APPLY) {
    console.log("Dry run only — re-run with --apply to insert.");
    return;
  }
  if (rowsToInsert.length === 0) {
    console.log("Nothing to insert.");
    return;
  }

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const chunk = rowsToInsert.slice(i, i + CHUNK);
    const { error } = await sb.from("claim_item_verifications").insert(chunk);
    if (error) throw error;
    inserted += chunk.length;
    console.log(`Inserted ${inserted}/${rowsToInsert.length}`);
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
