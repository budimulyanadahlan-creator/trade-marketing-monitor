// SKP Nasional — Fase 10 (plans/plan-skp-nasional.md): aktivasi di produksi.
//
// Menandai 11 SKP nasional yang diinput 2026-11-19 sebagai SKP induk nasional
// (campaigns.is_national = true) sehingga terlihat semua akun distributor.
// Region sudah National dan distributor sudah kosong, jadi hanya tanda yang
// berubah. Trigger migrasi 074 memeriksa ulang syaratnya di database.
//
// Usage:
//   node scripts/activate-national-skp.js              # dry-run (hanya baca)
//   node scripts/activate-national-skp.js --apply      # tandai Nasional
//   node scripts/activate-national-skp.js --verify     # cek setelah penandaan
//   node scripts/activate-national-skp.js --smoke      # uji asap akun tes:
//                                                      # lihat 11 SKP, buat 1
//                                                      # klaim turunan, batalkan
//
// Snapshot komitmen disimpan di outputs/national-activation-before.json saat
// dry-run/apply pertama, lalu dibandingkan oleh --verify.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const REPO_ROOT = path.resolve(__dirname, "..");
const SNAPSHOT_PATH = path.join(REPO_ROOT, "outputs", "national-activation-before.json");
const TEST_DISTRIBUTOR_EMAIL = "dist-test@test.com";

const SKP_NUMBERS = [
  "0049/WWI/11/2026",
  "0050/WWI/11/2026",
  "0051/WWI/11/2026",
  "0223/WWI/10/2026",
  "0224/WWI/10/2026",
  "0225/WWI/10/2026",
  "0226/WWI/10/2026",
  "0227/WWI/10/2026",
  "0114/WWI/07/2026",
  "0259/WWI/08/2026",
  "0260/WWI/08/2026",
];

// Sama dengan COMMITTED_CAMPAIGN_STATUSES di lib/campaign-status.ts dibaca saat
// runtime agar tidak menyimpang.
function committedStatuses() {
  const src = fs.readFileSync(path.join(REPO_ROOT, "lib", "campaign-status.ts"), "utf8");
  const m = src.match(/COMMITTED_CAMPAIGN_STATUSES[^=]*=\s*\[([^\]]*)\]/);
  if (!m) throw new Error("COMMITTED_CAMPAIGN_STATUSES tidak ditemukan di lib/campaign-status.ts");
  return [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]);
}

function loadEnv() {
  return Object.fromEntries(
    fs
      .readFileSync(path.join(REPO_ROOT, ".env.local"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

const rp = (n) => "Rp" + Number(n ?? 0).toLocaleString("id-ID");

async function fetchAll(query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function fetchTargets(sb) {
  const { data, error } = await sb
    .from("campaigns")
    .select(
      "id, skp_number, name, status, is_national, distributor_id, parent_campaign_id, requested_budget, actual_spent, claim_amount, claim_submitted_by, national_closed_at, claim_deadline, region:regions(name), department:departments(name)"
    )
    .in("skp_number", SKP_NUMBERS);
  if (error) throw error;
  return data.sort(
    (a, b) => SKP_NUMBERS.indexOf(a.skp_number) - SKP_NUMBERS.indexOf(b.skp_number)
  );
}

async function activityCounts(sb, id) {
  const head = { count: "exact", head: true };
  const q = [
    ["realisasi", sb.from("realizations").select("id", head).eq("campaign_id", id)],
    [
      "checklist terisi",
      sb
        .from("distributor_claim_checklists")
        .select("id", head)
        .eq("campaign_id", id)
        .eq("is_fulfilled", true),
    ],
    [
      "dokumen klaim",
      sb
        .from("campaign_files")
        .select("id", head)
        .eq("campaign_id", id)
        .not("document_type_id", "is", null),
    ],
    ["tanda terima", sb.from("distributor_receipts").select("id", head).eq("campaign_id", id)],
    ["klaim", sb.from("claim_events").select("id", head).eq("campaign_id", id)],
  ];
  const out = [];
  for (const [label, promise] of q) {
    const { count, error } = await promise;
    if (error) throw error;
    if (count > 0) out.push(`${label} (${count})`);
  }
  return out;
}

/** Komitmen per region × kategori × departemen dari SKP non-turunan. */
async function commitmentSnapshot(sb) {
  const statuses = committedStatuses();
  const rows = await fetchAll(() =>
    sb
      .from("campaigns")
      .select(
        "id, requested_budget, actual_spent, region_id, promotion_category_id, department_id, start_date"
      )
      .is("parent_campaign_id", null)
      .in("status", statuses)
      .order("id")
  );
  const groups = {};
  let total = 0;
  let spent = 0;
  for (const r of rows) {
    const key = [
      r.region_id,
      r.promotion_category_id,
      r.department_id,
      (r.start_date ?? "").slice(0, 7),
    ].join("|");
    groups[key] = (groups[key] ?? 0) + Number(r.requested_budget ?? 0);
    total += Number(r.requested_budget ?? 0);
    spent += Number(r.actual_spent ?? 0);
  }
  return { statuses, rows: rows.length, total, spent, groups };
}

function diffSnapshots(before, after) {
  const diffs = [];
  for (const k of new Set([...Object.keys(before.groups), ...Object.keys(after.groups)])) {
    if ((before.groups[k] ?? 0) !== (after.groups[k] ?? 0)) {
      diffs.push(`${k}: ${rp(before.groups[k])} -> ${rp(after.groups[k])}`);
    }
  }
  if (before.rows !== after.rows) diffs.push(`jumlah SKP: ${before.rows} -> ${after.rows}`);
  if (before.total !== after.total) diffs.push(`total: ${rp(before.total)} -> ${rp(after.total)}`);
  if (before.spent !== after.spent) diffs.push(`realisasi: ${rp(before.spent)} -> ${rp(after.spent)}`);
  return diffs;
}

async function checkSchema(sb) {
  const problems = [];
  const { error } = await sb
    .from("campaigns")
    .select(
      "is_national, parent_campaign_id, claim_owner_id, child_seq, claim_deadline, national_closed_at, national_closed_by"
    )
    .limit(1);
  if (error) problems.push(`kolom campaigns (074/075/080): ${error.message}`);

  // Fungsi database fase 2/3/8: dipanggil dengan id kosong — fungsi yang ada
  // menolak dengan error aturan, fungsi yang belum ada → PGRST202.
  const nil = "00000000-0000-0000-0000-000000000000";
  const fns = [
    ["create_national_child_claim (075)", { p_parent_id: nil, p_owner_id: nil }],
    ["cancel_national_child_claim (076)", { p_child_id: nil, p_actor_id: nil }],
  ];
  for (const [label, args] of fns) {
    const { error: e } = await sb.rpc(label.split(" ")[0], args);
    if (e && (e.code === "PGRST202" || /could not find the function/i.test(e.message))) {
      problems.push(`fungsi ${label} belum ada`);
    }
  }
  return problems;
}

async function distributorAccounts(sb) {
  const { data, error } = await sb
    .from("users")
    .select("id, is_active, distributor_id, distributor:distributors(name)")
    .eq("role", "distributor");
  if (error) throw error;
  return data;
}

async function sessionFor(env, sb, email) {
  // Sesi akun tes tanpa kata sandi: tautan sekali pakai dibuat dengan hak
  // layanan (tidak ada email terkirim) lalu ditukar menjadi sesi.
  const { data, error } = await sb.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: s, error: e2 } = await client.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (e2) throw e2;
  return { client, userId: s.user.id };
}

function printTargets(targets) {
  console.table(
    targets.map((t) => ({
      skp: t.skp_number,
      status: t.status,
      nasional: t.is_national,
      region: t.region?.name,
      dept: t.department?.name,
      distributor: t.distributor_id ? "ADA" : "-",
      nilai: rp(t.requested_budget),
      nama: (t.name ?? "").slice(0, 40),
    }))
  );
}

async function preflight(sb) {
  const problems = await checkSchema(sb);
  const targets = await fetchTargets(sb);
  printTargets(targets);

  const found = new Set(targets.map((t) => t.skp_number));
  for (const n of SKP_NUMBERS) if (!found.has(n)) problems.push(`${n}: tidak ditemukan`);
  if (targets.length !== found.size) problems.push("ada nomor SKP kembar");

  for (const t of targets) {
    if (t.is_national) continue; // sudah ditandai — dilewati saat apply
    const p = [];
    if (t.status !== "approved") p.push(`status ${t.status}`);
    if (t.parent_campaign_id) p.push("adalah klaim turunan");
    if (t.distributor_id) p.push("masih punya distributor");
    if ((t.region?.name ?? "").trim().toLowerCase() !== "national") p.push(`region ${t.region?.name}`);
    if (!["sales", "trade marketing"].includes((t.department?.name ?? "").trim().toLowerCase()))
      p.push(`departemen ${t.department?.name}`);
    if (t.claim_amount != null || t.claim_submitted_by) p.push("sudah ada pengajuan klaim");
    p.push(...(await activityCounts(sb, t.id)));
    if (p.length) problems.push(`${t.skp_number}: ${p.join(", ")}`);
  }
  return { targets, problems };
}

async function main() {
  const mode = process.argv[2] ?? "--dry-run";
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (mode === "--dry-run" || mode === "--apply") {
    const { targets, problems } = await preflight(sb);
    const pending = targets.filter((t) => !t.is_national);
    console.log(
      `Total nilai 11 SKP: ${rp(targets.reduce((s, t) => s + Number(t.requested_budget ?? 0), 0))}`
    );
    console.log(`Sudah nasional: ${targets.length - pending.length}, akan ditandai: ${pending.length}`);

    if (!fs.existsSync(SNAPSHOT_PATH)) {
      if (targets.some((t) => t.is_national)) {
        console.log("PERINGATAN: sebagian sudah nasional, snapshot 'sebelum' tidak murni.");
      }
      fs.mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
      fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(await commitmentSnapshot(sb), null, 2));
      console.log(`Snapshot komitmen disimpan: ${SNAPSHOT_PATH}`);
    }

    const accounts = await distributorAccounts(sb);
    const byCompany = {};
    for (const a of accounts) {
      const k = a.distributor?.name ?? "(tanpa perusahaan)";
      byCompany[k] ??= { aktif: 0, nonaktif: 0 };
      byCompany[k][a.is_active ? "aktif" : "nonaktif"]++;
    }
    console.log("Akun distributor per perusahaan:");
    console.table(byCompany);

    if (problems.length) {
      console.log("MASALAH:");
      for (const p of problems) console.log("  - " + p);
      process.exitCode = 1;
      return;
    }
    console.log("Pemeriksaan awal lolos.");
    if (mode !== "--apply") {
      console.log("Dry-run: tidak ada yang ditulis. Jalankan dengan --apply untuk menandai.");
      return;
    }

    for (const t of pending) {
      const { data, error } = await sb
        .from("campaigns")
        .update({ is_national: true })
        .eq("id", t.id)
        .eq("status", "approved")
        .eq("is_national", false)
        .is("distributor_id", null)
        .select("id");
      if (error) throw new Error(`${t.skp_number}: ${error.message}`);
      if (!data || data.length === 0) throw new Error(`${t.skp_number}: baris berubah, tidak ditandai`);
      console.log(`OK  ${t.skp_number} -> Nasional`);
    }
    return;
  }

  if (mode === "--verify") {
    const targets = await fetchTargets(sb);
    printTargets(targets);
    const notNational = targets.filter((t) => !t.is_national).map((t) => t.skp_number);
    console.log(
      notNational.length || targets.length !== SKP_NUMBERS.length
        ? `GAGAL: belum nasional / tidak lengkap: ${notNational.join(", ")} (${targets.length}/11)`
        : "OK  11 SKP bertanda Nasional"
    );

    if (fs.existsSync(SNAPSHOT_PATH)) {
      const before = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
      const after = await commitmentSnapshot(sb);
      const diffs = diffSnapshots(before, after);
      console.log(
        diffs.length
          ? `Komitmen BERUBAH dibanding snapshot:\n  ${diffs.join("\n  ")}`
          : `OK  komitmen sama dengan snapshot (${after.rows} SKP, ${rp(after.total)})`
      );
    } else {
      console.log("Tidak ada snapshot 'sebelum' untuk dibandingkan.");
    }

    const { data: openChildren, error } = await sb
      .from("campaigns")
      .select("id, skp_number, status, claim_owner_id")
      .in("parent_campaign_id", targets.map((t) => t.id))
      .neq("status", "cancelled");
    if (error) throw error;
    console.log(`Klaim turunan aktif pada 11 SKP: ${openChildren.length}`);
    if (openChildren.length) console.table(openChildren);
    return;
  }

  if (mode === "--smoke") {
    const targets = await fetchTargets(sb);
    const ids = targets.map((t) => t.id);
    const { client, userId } = await sessionFor(env, sb, TEST_DISTRIBUTOR_EMAIL);

    // 1. Lewat RLS akun tes: kesebelas SKP terlihat.
    const { data: visible, error: visErr } = await client
      .from("campaigns")
      .select("id, skp_number, is_national")
      .in("id", ids);
    if (visErr) throw visErr;
    console.log(`Akun tes melihat ${visible.length}/11 SKP nasional`);
    if (visible.length !== 11) {
      process.exitCode = 1;
      return;
    }

    // 2. Buat satu klaim turunan (fungsi database yang sama dengan tombol
    //    "Buat Klaim"), pastikan terlihat pemiliknya, lalu batalkan.
    const parent = targets[targets.length - 1]; // 0260 (Rp0): nomor -K01 terpakai klaim uji
    const { data: childId, error: createErr } = await sb.rpc("create_national_child_claim", {
      p_parent_id: parent.id,
      p_owner_id: userId,
    });
    if (createErr || !childId) throw new Error(`buat klaim gagal: ${createErr?.message}`);
    try {
      const { data: child, error: childErr } = await client
        .from("campaigns")
        .select("id, skp_number, status, requested_budget, claim_owner_id")
        .eq("id", childId)
        .single();
      if (childErr) throw new Error(`klaim uji tidak terlihat pemiliknya: ${childErr.message}`);
      console.log(
        `Klaim uji dibuat: ${child.skp_number} (status ${child.status}, nilai ${rp(child.requested_budget)})`
      );
    } finally {
      const { error: cancelErr } = await sb.rpc("cancel_national_child_claim", {
        p_child_id: childId,
        p_actor_id: userId,
      });
      if (cancelErr) {
        console.log(`GAGAL membatalkan klaim uji ${childId}: ${cancelErr.message}`);
        process.exitCode = 1;
      }
    }
    const { data: after } = await sb
      .from("campaigns")
      .select("skp_number, status")
      .eq("id", childId)
      .single();
    console.log(`Klaim uji setelah dibatalkan: ${after?.skp_number} -> ${after?.status}`);
    if (after?.status !== "cancelled") process.exitCode = 1;
    return;
  }

  throw new Error(`Mode tidak dikenal: ${mode}`);
}

main().catch((e) => {
  console.error("ERROR:", e.message ?? e);
  process.exitCode = 1;
});
