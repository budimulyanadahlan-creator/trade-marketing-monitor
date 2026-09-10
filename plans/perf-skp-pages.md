# Rencana Perbaikan Performa Halaman SKP (Daftar & Detail)

Disusun: 2026-09-10, hasil sesi grill-me dengan bukti terukur (bukan dugaan).

## 1. Bukti & Diagnosis

Keluhan user: aplikasi sangat lambat saat bikin SKP, cari SKP, dan aktivitas
distributor. Investigasi 4 lapis dilakukan sebelum menulis rencana ini:

| Lapisan | Temuan |
|---|---|
| Kode | [page.tsx](../app/(protected)/campaigns/page.tsx) (daftar SKP) dan [[id]/page.tsx](../app/(protected)/campaigns/[id]/page.tsx) (detail SKP) melakukan 8-13 query Supabase **berurutan** (`await` satu-satu) sebelum halaman bisa dirender. |
| Supabase Advisor (Performance) | 82 warning "Auth RLS Initialization Plan" — hampir semua policy pakai `auth.uid()` mentah, bukan `(select auth.uid())`, sehingga dievaluasi ulang tiap baris. |
| Supabase Query Performance | Query aplikasi sendiri cepat (ms-level), cache hit rate 100%. DB **bukan** yang lambat secara komputasi. |
| Vercel Observability (Functions) | Plan **Hobby**. `/campaigns/[id]`: 645 invocations (rute tersibuk), **P75 = 10 detik**. `/campaigns`: 186 invocations, **P75 = 5 detik**. Active CPU cuma ~135ms, CPU Throttle 12.9% → function menunggu **network I/O** (round-trip DB), bukan kehabisan compute. |

Hipotesis yang diperiksa dan **disingkirkan**:
- Region mismatch — Vercel (`sin1`) dan Supabase (`ap-southeast-1`) sama-sama Singapore.
- Connection pool exhaustion saat ramai — user konfirmasi selalu lambat, siapa pun & kapan pun, bukan cuma jam sibuk.
- Baris tabel campaigns kecil (585 baris) — index/RLS bukan penyebab utama *saat ini*, tapi tetap diperbaiki karena murah dan mencegah makin parah seiring data bertambah.

**Root cause: pola waterfall query serial** di kedua halaman ini, diperparah oleh operasi self-heal yang jalan di setiap render, dan RLS + index yang belum optimal.

## 2. Scope

**IN (ronde ini):**
- `/campaigns` — daftar SKP, cari, bikin SKP baru
- `/campaigns/[id]` — detail SKP (approve/reject, checklist, klaim) — dipakai juga oleh distributor
- Backfill + pembersihan self-heal `ensureClaimItemVerifications`
- Migration SQL: fix RLS `auth.uid()` + index FK yang relevan ke dua halaman ini

**OUT (ronde berikutnya, tidak dikerjakan sekarang):**
- `/rekap` (P75 4.9s), `/approvals` (P75 1.5s), `/login` (P75 2.92s) — pola serupa, tapi menunggu hasil ronde ini dulu sebagai validasi pendekatan
- Upgrade Vercel plan (Hobby → Pro) — dievaluasi setelah fix kode diukur, bukan diputuskan sekarang

## 3. Fase 0 — Backfill & hapus self-heal dari hot path

`ensureClaimItemVerifications` ([lib/claim-item-verifications.ts](../lib/claim-item-verifications.ts))
saat ini dipanggil setiap kali SKP berstatus `claim_submitted` dibuka, padahal
fungsinya cuma untuk membenahi SKP lama dari sebelum fitur verifikasi klaim
ada (idempotent, additive-only). Ini nambah 2-3 query di setiap page load.

**Langkah:**
1. Script backfill sekali-jalan (pakai admin client, sama seperti
   `ensureClaimItemVerifications` tapi dijalankan untuk SEMUA campaign
   berstatus `claim_submitted | claim_verified | ready_to_pay | paid | completed`
   sekaligus, bukan satu-satu saat dibuka).
2. Verifikasi: untuk tiap campaign di status itu yang `promotion_category_id`-nya
   punya `claim_requirements`, cek jumlah baris `claim_item_verifications`
   match jumlah dokumen wajib + 1 (item nominal).
3. Setelah terverifikasi lengkap: hapus blok pemanggilan
   `ensureClaimItemVerifications` dari [[id]/page.tsx:164-178](../app/(protected)/campaigns/[id]/page.tsx#L164-L178).

## 4. Fase 1 — Paralelkan & gabungkan query (risiko rendah)

Prinsip: query yang tidak saling bergantung dijalankan lewat `Promise.all`;
query yang berelasi 1 arah (mis. `users` → `departments`) digabung jadi satu
`select` nested — tidak mengubah shape data yang dikonsumsi komponen client,
jadi tidak perlu ubah `campaigns-client.tsx` / `campaign-detail-client.tsx`.

### 4a. `/campaigns/[id]/page.tsx` (dampak terbesar — 645 invocations, 10s P75)

- **Gabung** `profile` (role) — tetap query terpisah karena `campaign` tidak
  butuh hasil `profile`, jadi:
  - **Paralel**: `getUser()` tidak bisa diparalel (semua butuh session-nya),
    tapi setelah `user` didapat, jalankan **bersamaan** dalam satu
    `Promise.all`: profile role, campaign (+8 join), files, approval_history,
    realizations, distributor_receipts (kalau role-nya perlu — cukup fetch
    selalu lalu buang hasilnya kalau tidak dipakai, drop kondisional bikin
    kode tak perlu ribet), claim_events. **7 query jadi 1 batch paralel**,
    dari yang sebelumnya semua serial.
  - Setelah campaign row didapat dari batch itu: jalankan `claim_item_verifications`,
    `claim_requirements`, `distributor_claim_checklists` dalam **satu**
    `Promise.all` kedua (saat ini 2 blok terpisah sequential meski logically
    independent).
  - Blok AA budget (2 query admin client) dan blok master-data-jika-editable
    (9 query) **tetap seperti sekarang** — sudah pakai `Promise.all`, dan
    keduanya genuinely bergantung pada `campaign.status`/`campaign.action_approval_id`.
- **Hasil**: dari ~12-13 round-trip serial → sekitar 3-4 batch paralel
  (getUser → [batch 7 query] → [batch 3 query] → [AA budget / master-data
  kalau perlu]).

### 4b. `/campaigns/page.tsx` (186 invocations, 5s P75)

- **Gabung** `profile` (role, department_id, region_id) dengan nama
  department jadi **satu** nested select (`users` → `departments(name)`)
  — hemat 1 round-trip.
- Blok `visibleDeptIds` (khusus distributor) jalan **paralel** dengan blok
  profile+dept di atas (tidak saling butuh).
- Query utama `campaigns` (8 join) menunggu hasil di atas (perlu tahu
  `isDistributor` + `visibleDeptIds`) — tetap sequential di titik ini, tidak
  bisa dihindari.
- Blok `checklistStatusByCampaignId` dan `claimVerificationProgressByCampaignId`
  — **independen satu sama lain** (status `approved` vs `claim_submitted`
  tidak overlap) — gabung jadi **satu** `Promise.all` alih-alih 2 blok
  sequential.
- Blok 9-query master-data di akhir (baris 160-192) **sama sekali tidak
  bergantung** pada data campaign/profile — pindahkan agar **mulai
  bersamaan** dengan `getUser()` di awal fungsi (fire-and-await-later),
  bukan menunggu di akhir. Ini win besar karena 9 query itu bisa jalan
  duluan sambil bagian lain diproses.

## 5. Fase 2 — Migration SQL: RLS + index

Satu file migration baru (`0XX_perf_rls_and_indexes.sql`):

1. **RLS**: `drop policy` + `create policy` ulang untuk tiap policy di
   `campaigns`, `campaign_files`, `claim_events`, `claim_item_verifications`,
   `distributor_claim_checklists`, `distributor_receipts`, `users`,
   `departments` yang memanggil `auth.uid()` mentah → ganti jadi
   `(select auth.uid())`. Tidak mengubah logika izin, murni perf.
2. **Index** pada kolom FK yang dipakai filter di query dua halaman ini:
   `campaigns(department_id)`, `campaigns(region_id)`, `campaigns(created_by)`,
   `campaigns(status)`, `campaign_files(campaign_id)`,
   `claim_item_verifications(campaign_id)` *(sudah ada dari migration 039)*,
   `distributor_claim_checklists(campaign_id)`, `distributor_receipts(campaign_id)`,
   `claim_events(campaign_id)`, `approval_history(campaign_id)`,
   `realizations(campaign_id)`.

## 6. Verifikasi

Setelah deploy tiap fase ke prod:
- Buka Supabase Advisor → Performance: warning "Auth RLS Initialization Plan"
  untuk tabel-tabel di atas harus hilang.
- Vercel Observability → Functions: bandingkan P75 `/campaigns` dan
  `/campaigns/[id]` sebelum vs sesudah (target: turun dari 5s/10s ke
  di bawah 1-2 detik).
- Manual: buka `/campaigns` dan satu SKP detail (termasuk yang berstatus
  `claim_submitted`) di prod, pastikan data & fungsi (approve, checklist,
  upload klaim) tetap benar — terutama setelah Fase 0 (self-heal
  dihapus) dan Fase 2 (RLS ditulis ulang, rawan salah ketik kondisi izin).
- Regression check: `pnpm test` (khususnya `campaigns.test.ts`,
  `claim-checklist.test.ts`, `claim-verification.test.ts`) sebelum push.

## 7. Urutan Kerja

1. Fase 0 (backfill + hapus self-heal) — paling kecil risikonya, langsung
   mengurangi beban di halaman detail.
2. Fase 2 (migration RLS + index) — independen dari perubahan kode
   TypeScript, bisa dikerjakan & di-deploy terpisah kapan saja.
3. Fase 1a (`/campaigns/[id]`) — dampak terbesar, dikerjakan setelah Fase 0
   supaya batch paralelnya tidak perlu menunggu self-heal lagi.
4. Fase 1b (`/campaigns`) — pola sama, lebih kecil scope-nya.
5. Ukur ulang (bagian 6), lalu putuskan apakah ronde berikutnya (rekap,
   approvals, upgrade Vercel plan) diperlukan.
