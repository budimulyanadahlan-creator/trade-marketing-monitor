-- 073: Multi-User Distributor — Fase 10 (plans/plan-multi-user-distributor.md)
-- Alihkan pemegang klaim.
--
-- Admin/superadmin mengganti campaigns.claim_submitted_by saat SKP berstatus
-- claim_submitted (policy "campaigns_update" dari 004 sudah mengizinkan admin
-- meng-update tanpa syarat status — tidak perlu policy baru). Pengalihan
-- dicatat di claim_events dengan action baru 'holder_transferred':
--   actor_id      = admin pelaku
--   from_user_id  = pemegang lama (null jika sebelumnya tidak tercatat)
--   to_user_id    = pemegang baru
--   created_at    = waktu pengalihan
--
-- WAJIB dijalankan SEBELUM push aplikasi Fase 10: halaman detail SKP memilih
-- kolom from_user_id/to_user_id dari claim_events.

alter table public.claim_events
  add column if not exists from_user_id uuid references public.users(id) on delete set null,
  add column if not exists to_user_id uuid references public.users(id) on delete set null;

alter table public.claim_events
  drop constraint if exists claim_events_action_check;

alter table public.claim_events
  add constraint claim_events_action_check
  check (action in (
    'submitted', 'cancelled', 'claim_verified', 'ready_to_pay',
    'item_accepted', 'item_revision_requested', 'holder_transferred'
  ));

-- Hanya admin/superadmin yang boleh mencatat pengalihan pemegang. Policy
-- insert yang ada (067) mengizinkan distributor 'act' menulis claim_events
-- apa pun atas namanya sendiri; tambahkan syarat agar distributor tidak bisa
-- memalsukan entri pengalihan lewat PostgREST.
drop policy if exists "claim_events_insert" on public.claim_events;
create policy "claim_events_insert" on public.claim_events
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and (
      exists (
        select 1 from public.users u
        where u.id = (select auth.uid())
          and u.role in ('finance', 'admin', 'superadmin')
          and u.is_active = true
          and (claim_events.action <> 'holder_transferred' or u.role in ('admin', 'superadmin'))
      )
      or (
        claim_events.action <> 'holder_transferred'
        and public.distributor_campaign_access_by_id(
          claim_events.campaign_id, (select public.distributor_viewer_ctx())
        ) = 'act'
      )
    )
  );

-- Verifikasi:
-- select column_name from information_schema.columns
--  where table_schema = 'public' and table_name = 'claim_events'
--    and column_name in ('from_user_id', 'to_user_id');
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'claim_events_action_check';
