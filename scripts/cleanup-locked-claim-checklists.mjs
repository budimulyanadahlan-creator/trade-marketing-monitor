// Pengunggah Khusus — Fase 8 (plans/plan-pengunggah-khusus-dokumen-klaim.md):
// aktivasi di production dan pembersihan data lama.
//
// Sebelum ada pengunggah khusus, cabang bisa mencentang dokumen klaim tanpa
// file. Setelah admin menunjuk pengunggah khusus (Surat Pengantar Klaim →
// Meriana), centang lama tanpa file pada item yang kini terkunci harus
// dilepas, agar kelengkapan tidak terlihat penuh padahal suratnya belum ada.
//
// Aturan "centang mana yang dilepas" ada di lib/claim-document-cleanup.ts
// (teruji unit) — skrip ini hanya mengambil data, menampilkan, dan menulis.
// Tidak ada nama dokumen atau nama orang di sini: semuanya dari tabel
// penunjukan claim_document_type_uploaders.
//
// Usage:
//   node scripts/cleanup-locked-claim-checklists.mjs            # pratinjau (hanya baca)
//   node scripts/cleanup-locked-claim-checklists.mjs --apply    # lepas centang yang
//                                                               # ada di pratinjau
//   node scripts/cleanup-locked-claim-checklists.mjs --verify   # cek sesudahnya +
//                                                               # daftar kerja
//   node scripts/cleanup-locked-claim-checklists.mjs --simulate "Surat Pengantar=Meriana"
//       # pratinjau "seandainya" SEBELUM penunjukan dibuat: jenis dokumen dan
//       # akun distributor dicari lewat potongan nama. Hanya baca, tidak
//       # menyimpan daftar, dan tidak bisa dipakai --apply.
//
// Pratinjau menyimpan daftarnya di outputs/locked-checklist-cleanup-preview.json.
// --apply menghitung ulang dan HANYA melepas centang yang ada di berkas itu
// (daftar yang sudah disetujui); centang baru yang muncul sesudah pratinjau
// dilewati dan dilaporkan — jalankan pratinjau lagi untuk menyetujuinya.
// Aman dijalankan ulang: centang yang sudah lepas tidak lagi masuk hitungan.
//
// Tidak menghapus file apa pun, tidak menyentuh item yang sudah di-Accept,
// dan tidak menyentuh SKP terverifikasi / siap bayar / dibayar / selesai.

import fs from "node:fs";
import path from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREVIEW_PATH = path.join(REPO_ROOT, "outputs", "locked-checklist-cleanup-preview.json");

// Modul aturan ditulis dalam TypeScript dengan alias "@/". Node 24 membuang
// tipe sendiri; hook ini hanya menerjemahkan alias ke berkas .ts di repo.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const file = path.join(REPO_ROOT, specifier.slice(2) + ".ts");
      return nextResolve(pathToFileURL(file).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { computeLockedChecklistCleanup, LOCKED_CHECKLIST_CLEANUP_STATUSES } = await import(
  "@/lib/claim-document-cleanup"
);
const { computeSpecialUploaderWorklist, SPECIAL_UPLOADER_WORKLIST_PRIORITY_LABELS } =
  await import("@/lib/claim-document-worklist");
const { isActiveSpecialUploader } = await import("@/lib/claim-document-uploaders");

const STATUS_LABELS = {
  approved: "Disetujui",
  ongoing: "Berjalan",
  claim_submitted: "Klaim Diajukan",
};

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

async function fetchAll(query) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query().range(from, from + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

/** Semua data yang dibutuhkan aturan, dalam beberapa query batch. */
async function loadState(sb, simulated = []) {
  const { data: real, error } = await sb
    .from("claim_document_type_uploaders")
    .select(
      "document_type_id, document_type:claim_document_types(name), user:users!claim_document_type_uploaders_user_id_fkey(id, full_name, role, is_active, distributor_id, distributor_scope, distributor:distributors(name))"
    );
  if (error) throw error;
  const appointments = [...real, ...simulated];

  const appointedByDocType = new Map();
  const docTypeNames = new Map();
  for (const a of appointments) {
    if (!a.user) continue;
    docTypeNames.set(a.document_type_id, a.document_type?.name ?? a.document_type_id);
    const list = appointedByDocType.get(a.document_type_id) ?? [];
    list.push({
      id: a.user.id,
      role: a.user.role,
      is_active: a.user.is_active,
      distributor_id: a.user.distributor_id ?? null,
    });
    appointedByDocType.set(a.document_type_id, list);
  }
  const docTypeIds = [...appointedByDocType.keys()];
  if (docTypeIds.length === 0) {
    return { appointments, appointedByDocType, docTypeNames, docTypeIds, campaigns: [] };
  }

  const [campaignRows, checklists, files, itemVerifications, requirements] = await Promise.all([
    fetchAll(() =>
      sb
        .from("campaigns")
        .select(
          "id, skp_number, name, status, is_national, parent_campaign_id, distributor_id, promotion_category_id, distributor:distributors(name, parent_distributor_id), region:regions(name)"
        )
        .in("status", LOCKED_CHECKLIST_CLEANUP_STATUSES)
        .order("id")
    ),
    fetchAll(() =>
      sb
        .from("distributor_claim_checklists")
        .select("id, campaign_id, document_type_id, is_fulfilled")
        .in("document_type_id", docTypeIds)
        .eq("is_fulfilled", true)
        .order("id")
    ),
    fetchAll(() =>
      sb
        .from("campaign_files")
        .select("id, campaign_id, document_type_id")
        .in("document_type_id", docTypeIds)
        .order("id")
    ),
    fetchAll(() =>
      sb
        .from("claim_item_verifications")
        .select("id, campaign_id, document_type_id, status")
        .in("document_type_id", docTypeIds)
        .order("id")
    ),
    fetchAll(() =>
      sb
        .from("claim_requirements")
        .select("id, promotion_category_id, document_type_id")
        .in("document_type_id", docTypeIds)
        .order("id")
    ),
  ]);

  const campaigns = campaignRows.map((c) => ({
    ...c,
    distributor_parent_id: c.distributor?.parent_distributor_id ?? null,
  }));
  return {
    appointments,
    appointedByDocType,
    docTypeNames,
    docTypeIds,
    campaigns,
    checklists,
    files,
    itemVerifications,
    requirements,
  };
}

/** Penunjukan "seandainya" dari potongan nama jenis dokumen dan nama akun. */
async function simulatedAppointment(sb, spec) {
  const [docPart, userPart] = spec.split("=").map((x) => (x ?? "").trim());
  if (!docPart || !userPart) throw new Error('Format --simulate: "<nama dokumen>=<nama akun>"');
  const { data: docs, error: docErr } = await sb
    .from("claim_document_types")
    .select("id, name")
    .ilike("name", `%${docPart}%`);
  if (docErr) throw docErr;
  const { data: users, error: userErr } = await sb
    .from("users")
    .select(
      "id, full_name, role, is_active, distributor_id, distributor_scope, distributor:distributors(name)"
    )
    .eq("role", "distributor")
    .ilike("full_name", `%${userPart}%`);
  if (userErr) throw userErr;
  if (docs.length !== 1 || users.length !== 1) {
    throw new Error(
      `--simulate harus cocok tepat satu dokumen dan satu akun. Dokumen: [${docs
        .map((d) => d.name)
        .join(", ")}]; akun: [${users.map((u) => u.full_name).join(", ")}]`
    );
  }
  return { document_type_id: docs[0].id, document_type: { name: docs[0].name }, user: users[0] };
}

function printAppointments(state) {
  if (state.appointments.length === 0) {
    console.log("Belum ada pengunggah khusus yang ditunjuk.");
    return;
  }
  console.log("Pengunggah khusus yang ditunjuk:");
  console.table(
    state.appointments.map((a) => ({
      dokumen: a.document_type?.name,
      akun: a.user?.full_name,
      perusahaan: a.user?.distributor?.name ?? "-",
      cakupan: a.user?.distributor_scope ?? "-",
      dihitung: a.user && isActiveSpecialUploader(a.user) ? "ya" : "TIDAK (nonaktif)",
    }))
  );
}

function describeTargets(state, targets) {
  const campaignById = new Map(state.campaigns.map((c) => [c.id, c]));
  return targets.map((t) => {
    const c = campaignById.get(t.campaignId);
    return {
      checklistId: t.checklistId,
      campaignId: t.campaignId,
      skp: c.skp_number,
      perusahaan: c.distributor?.name ?? "-",
      region: c.region?.name ?? "-",
      status: STATUS_LABELS[c.status] ?? c.status,
      dokumen: state.docTypeNames.get(t.documentTypeId),
      turunan: c.parent_campaign_id ? "ya" : "",
    };
  });
}

function printTargets(rows) {
  const sorted = [...rows].sort(
    (a, b) =>
      a.perusahaan.localeCompare(b.perusahaan) ||
      a.region.localeCompare(b.region) ||
      String(a.skp).localeCompare(String(b.skp))
  );
  console.table(
    sorted.map(({ skp, perusahaan, region, status, dokumen, turunan }) => ({
      skp,
      perusahaan,
      region,
      status,
      dokumen,
      turunan,
    }))
  );
  const count = (field) => {
    const out = {};
    for (const r of rows) out[r[field]] = (out[r[field]] ?? 0) + 1;
    return out;
  };
  console.log("Per perusahaan:", count("perusahaan"));
  console.log("Per status:", count("status"));
}

function compute(state) {
  if (state.docTypeIds.length === 0) return [];
  const inWindow = new Set(state.campaigns.map((c) => c.id));
  console.log(
    `Diperiksa: ${state.campaigns.length} SKP Disetujui/Berjalan/Klaim Diajukan, ` +
      `${state.checklists.filter((r) => inWindow.has(r.campaign_id)).length} centang dokumen berpengunggah khusus di antaranya ` +
      `(${state.checklists.length} di semua status), ${state.files.length} file.`
  );
  return describeTargets(state, computeLockedChecklistCleanup(state));
}

async function main() {
  const mode = process.argv[2] ?? "--preview";
  if (!["--preview", "--apply", "--verify", "--simulate"].includes(mode)) {
    throw new Error(`Mode tidak dikenal: ${mode}`);
  }
  const env = loadEnv();
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  console.log(`Database: ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).host}`);

  const simulated =
    mode === "--simulate" ? [await simulatedAppointment(sb, process.argv[3] ?? "")] : [];
  const state = await loadState(sb, simulated);
  printAppointments(state);
  const rows = compute(state);

  if (mode === "--simulate") {
    console.log(
      `\nSIMULASI (penunjukan di atas belum tentu ada): centang tanpa file yang akan dilepas: ${rows.length}`
    );
    if (rows.length) printTargets(rows);
    const user = simulated[0].user;
    const worklist = computeSpecialUploaderWorklist({ actorId: user.id, ...state });
    console.log(
      `Daftar kerja ${user.full_name} seandainya ditunjuk: ${Object.keys(worklist).length} SKP`
    );
    console.log("Simulasi: tidak ada yang ditulis atau disimpan.");
    return;
  }

  if (mode === "--preview") {
    if (state.docTypeIds.length === 0) {
      console.log(
        "Tunjuk dulu pengunggah khusus di master data Dokumen Klaim, lalu jalankan pratinjau lagi."
      );
      process.exitCode = 1;
      return;
    }
    console.log(`\nCentang tanpa file pada item terkunci yang AKAN dilepas: ${rows.length}`);
    if (rows.length) printTargets(rows);
    fs.mkdirSync(path.dirname(PREVIEW_PATH), { recursive: true });
    fs.writeFileSync(
      PREVIEW_PATH,
      JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)
    );
    console.log(`Daftar disimpan: ${PREVIEW_PATH}`);
    console.log("Pratinjau: tidak ada yang ditulis. Setelah daftar disetujui, jalankan --apply.");
    return;
  }

  if (mode === "--apply") {
    if (!fs.existsSync(PREVIEW_PATH)) {
      throw new Error("Belum ada pratinjau yang disetujui — jalankan tanpa --apply lebih dulu.");
    }
    const preview = JSON.parse(fs.readFileSync(PREVIEW_PATH, "utf8"));
    const approved = new Set(preview.rows.map((r) => r.checklistId));
    const toApply = rows.filter((r) => approved.has(r.checklistId));
    const unapproved = rows.filter((r) => !approved.has(r.checklistId));
    console.log(
      `\nPratinjau ${preview.generatedAt}: ${preview.rows.length} disetujui, ${toApply.length} masih perlu dilepas.`
    );

    let done = 0;
    for (const r of toApply) {
      const { data, error } = await sb
        .from("distributor_claim_checklists")
        .update({ is_fulfilled: false, updated_at: new Date().toISOString() })
        .eq("id", r.checklistId)
        .eq("is_fulfilled", true)
        .select("id");
      if (error) throw new Error(`${r.skp}: ${error.message}`);
      if (data.length) done++;
      console.log(`${data.length ? "OK " : "-- "} ${r.skp} (${r.perusahaan}, ${r.region}) — ${r.dokumen}`);
    }
    console.log(`Centang dilepas: ${done}`);
    if (unapproved.length) {
      console.log(
        `DILEWATI — ${unapproved.length} centang baru muncul sesudah pratinjau (jalankan pratinjau lagi):`
      );
      printTargets(unapproved);
      process.exitCode = 1;
    }
    return;
  }

  // --verify
  console.log(
    rows.length
      ? `\nGAGAL: masih ada ${rows.length} centang tanpa file pada item terkunci.`
      : "\nOK  tidak ada lagi centang tanpa file pada item terkunci."
  );
  if (rows.length) {
    printTargets(rows);
    process.exitCode = 1;
  }

  const cleaned = fs.existsSync(PREVIEW_PATH)
    ? JSON.parse(fs.readFileSync(PREVIEW_PATH, "utf8")).rows
    : [];
  const uploaders = new Map();
  for (const a of state.appointments) {
    if (a.user && isActiveSpecialUploader(a.user)) uploaders.set(a.user.id, a.user);
  }
  for (const user of uploaders.values()) {
    const worklist = computeSpecialUploaderWorklist({ actorId: user.id, ...state });
    const perPriority = {};
    for (const p of Object.values(worklist)) {
      const label = SPECIAL_UPLOADER_WORKLIST_PRIORITY_LABELS[p];
      perPriority[label] = (perPriority[label] ?? 0) + 1;
    }
    console.log(
      `Daftar kerja ${user.full_name}: ${Object.keys(worklist).length} SKP`,
      perPriority
    );
    const missing = cleaned.filter((r) => worklist[r.campaignId] === undefined);
    if (cleaned.length) {
      console.log(
        `  SKP yang centangnya dilepas dan ada di daftar kerja: ${cleaned.length - missing.length}/${cleaned.length}`
      );
    }
    if (missing.length) {
      console.log(
        "  Tidak di daftar kerja (dokumen tidak wajib untuk kategorinya, sudah ada file, status berubah, atau di luar grup akun ini):"
      );
      printTargets(missing);
    }
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message ?? e);
  process.exitCode = 1;
});
