// One-off backfill: assign marmot's own skp_number to the 135 campaigns that
// came in via the TP1 Q2 bulk historical import (scripts/import-tp1-q2.js).
// That import only set `reference_number` (the real SKP letter's "No Surat")
// and deliberately left `skp_number` (marmot's internal sequence,
// "0047/WWI/09/2026") null. Confirmed with user: it should be generated too,
// using each campaign's actual submitted_at month (not today's date), so the
// numbering reflects when the SKP was historically approved and continues
// on from whatever counter each month was already at.
//
// Usage:
//   node scripts/backfill-bulk-import-skp-numbers.js --dry-run   preview only, no writes
//   node scripts/backfill-bulk-import-skp-numbers.js --execute   performs the real update

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(REPO_ROOT, "..", "..", "..", "..", "tmp-skp-backfill");

function loadEnv() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  return Object.fromEntries(
    fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
  );
}

function formatSkpNumber(sequence, year, month) {
  return `${String(sequence).padStart(4, "0")}/WWI/${String(month).padStart(2, "0")}/${year}`;
}

async function fetchTargets(sb) {
  const { data, error } = await sb
    .from("campaigns")
    .select("id, name, status, skp_number, reference_number, submitted_at")
    .is("skp_number", null)
    .not("reference_number", "is", null)
    .eq("status", "approved")
    .order("submitted_at", { ascending: true });
  if (error) throw new Error(`fetch targets: ${error.message}`);
  return data;
}

async function dryRun() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const targets = await fetchTargets(sb);

  const { data: counters } = await sb.from("skp_number_counters").select("*");
  const counterMap = new Map((counters || []).map((c) => [`${c.year}-${c.month}`, c.last_sequence]));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const lines = ["ReferenceNumber,Name,SubmittedAt,WouldBeSkpNumber"];
  const preview = [];
  for (const row of targets) {
    const d = new Date(row.submitted_at);
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const key = `${year}-${month}`;
    const next = (counterMap.get(key) || 0) + 1;
    counterMap.set(key, next);
    const skpNumber = formatSkpNumber(next, year, month);
    preview.push({ id: row.id, referenceNumber: row.reference_number, skpNumber });
    lines.push([row.reference_number, row.name, row.submitted_at, skpNumber]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }
  const csvPath = path.join(OUT_DIR, "backfill-dry-run.csv");
  fs.writeFileSync(csvPath, lines.join("\n"), "utf8");
  fs.writeFileSync(path.join(OUT_DIR, "backfill-dry-run.json"), JSON.stringify(preview, null, 2), "utf8");

  console.log(`Targets found: ${targets.length}`);
  console.log(`Counter end-state after backfill:`, Object.fromEntries(counterMap));
  console.log(`Report written to:\n  ${csvPath}`);
  console.log(`\nFirst 5 and last 5 assignments:`);
  preview.slice(0, 5).forEach((p) => console.log(`  ${p.skpNumber}  <-  ${p.referenceNumber}`));
  console.log("  ...");
  preview.slice(-5).forEach((p) => console.log(`  ${p.skpNumber}  <-  ${p.referenceNumber}`));
}

async function execute() {
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  const targets = await fetchTargets(sb);
  console.log(`${targets.length} campaigns to backfill.`);

  const results = [];
  for (const row of targets) {
    try {
      const d = new Date(row.submitted_at);
      const year = d.getUTCFullYear();
      const month = d.getUTCMonth() + 1;

      const { data: seq, error: rpcErr } = await sb.rpc("increment_skp_counter", {
        p_year: year,
        p_month: month,
      });
      if (rpcErr) throw new Error(`increment_skp_counter: ${rpcErr.message}`);

      const skpNumber = formatSkpNumber(seq, year, month);

      const { error: updErr } = await sb
        .from("campaigns")
        .update({ skp_number: skpNumber })
        .eq("id", row.id);
      if (updErr) throw new Error(`update campaign: ${updErr.message}`);

      results.push({ id: row.id, referenceNumber: row.reference_number, skpNumber, status: "ok" });
      console.log(`OK  ${skpNumber}  <-  ${row.reference_number}  (${row.name})`);
    } catch (err) {
      results.push({ id: row.id, referenceNumber: row.reference_number, status: "ERROR", error: err.message });
      console.error(`ERR ${row.reference_number} -> ${err.message}`);
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "backfill-execute-result.json"), JSON.stringify(results, null, 2), "utf8");
  const okCount = results.filter((r) => r.status === "ok").length;
  console.log(`\nDone. ${okCount}/${results.length} backfilled successfully.`);
}

const mode = process.argv[2];
if (mode === "--dry-run") {
  dryRun();
} else if (mode === "--execute") {
  execute();
} else {
  console.log("Usage: node scripts/backfill-bulk-import-skp-numbers.js --dry-run | --execute");
}
