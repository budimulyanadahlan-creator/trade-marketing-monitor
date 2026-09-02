-- Phase 2 (Verifikasi Klaim oleh Finance): verifikasi per item.
--
-- 1. claim_item_verifications: satu baris per (SKP, item) dengan status
--    pending | accepted | revision_requested. "Item" = tiap dokumen wajib
--    checklist (document_type_id terisi) ATAU satu item khusus nominal
--    klaim (item_type = 'amount', document_type_id NULL) — dibedakan lewat
--    kolom item_type, bukan lewat FK jenis dokumen (lihat plan §Model
--    verifikasi per item).
-- 2. Baris item dibuat oleh server (admin client di
--    lib/claim-item-verifications.ts) saat klaim diajukan dan, sebagai
--    jaring pengaman, saat halaman SKP dimuat pada status claim_submitted —
--    bukan lewat client authenticated, jadi policy INSERT di bawah cukup
--    dibatasi finance/admin/superadmin walau penciptanya sebenarnya sistem.
-- 3. claim_events: tambah kolom note & item_label untuk mencatat aksi
--    accept/revisi per item (nama item + catatan finance), dan perluas
--    constraint action untuk dua nilai baru.

create table if not exists public.claim_item_verifications (
  id               uuid        primary key default gen_random_uuid(),
  campaign_id      uuid        not null references public.campaigns(id) on delete cascade,
  item_type        text        not null check (item_type in ('document', 'amount')),
  document_type_id uuid        references public.claim_document_types(id) on delete cascade,
  status           text        not null default 'pending' check (status in ('pending', 'accepted', 'revision_requested')),
  note             text,
  actor_id         uuid        references public.users(id) on delete set null,
  decided_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint claim_item_verifications_type_doc_match check (
    (item_type = 'document' and document_type_id is not null)
    or (item_type = 'amount' and document_type_id is null)
  )
);

create index if not exists idx_claim_item_verifications_campaign
  on public.claim_item_verifications(campaign_id);

-- Guards against duplicate document items per campaign. Does not by itself
-- stop duplicate 'amount' rows (document_type_id is NULL for those, and
-- Postgres treats NULLs as distinct) — the partial index below covers that.
create unique index if not exists claim_item_verifications_document_uniq
  on public.claim_item_verifications(campaign_id, document_type_id);

create unique index if not exists claim_item_verifications_amount_uniq
  on public.claim_item_verifications(campaign_id)
  where item_type = 'amount';

alter table public.claim_item_verifications enable row level security;

-- Select mirrors campaigns_select (003) + campaign_files_select_distributor
-- (038)'s status window: owner/manager-same-dept/finance/admin/superadmin
-- always, distributor while the SKP is in a claim-visible status.
drop policy if exists "claim_item_verifications_select" on public.claim_item_verifications;

create policy "claim_item_verifications_select" on public.claim_item_verifications
  for select to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = claim_item_verifications.campaign_id
        and (
          c.created_by = auth.uid()
          or exists (
            select 1 from public.users u
            where u.id = auth.uid()
              and u.role in ('finance', 'admin', 'superadmin')
              and u.is_active = true
          )
          or exists (
            select 1 from public.users u
            where u.id = auth.uid()
              and u.role = 'manager'
              and u.is_active = true
              and u.department_id = c.department_id
          )
          or (
            c.status in ('claim_submitted', 'claim_verified', 'ready_to_pay', 'paid', 'completed')
            and exists (
              select 1 from public.users u
              where u.id = auth.uid()
                and u.role = 'distributor'
                and u.is_active = true
            )
          )
        )
    )
  );

drop policy if exists "claim_item_verifications_insert" on public.claim_item_verifications;

create policy "claim_item_verifications_insert" on public.claim_item_verifications
  for insert to authenticated
  with check (
    exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('finance', 'admin', 'superadmin')
        and u.is_active = true
    )
  );

-- Update (Accept/Minta Revisi) only while the SKP is still claim_submitted —
-- once Approve Klaim moves it to claim_verified, decisions are locked.
drop policy if exists "claim_item_verifications_update" on public.claim_item_verifications;

create policy "claim_item_verifications_update" on public.claim_item_verifications
  for update to authenticated
  using (
    exists (
      select 1 from public.campaigns c
      where c.id = claim_item_verifications.campaign_id
        and c.status = 'claim_submitted'
    )
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('finance', 'admin', 'superadmin')
        and u.is_active = true
    )
  )
  with check (
    actor_id = auth.uid()
  );

alter table public.claim_events
  add column if not exists note text,
  add column if not exists item_label text;

alter table public.claim_events
  drop constraint if exists claim_events_action_check;

alter table public.claim_events
  add constraint claim_events_action_check
  check (action in ('submitted', 'cancelled', 'claim_verified', 'ready_to_pay', 'item_accepted', 'item_revision_requested'));
