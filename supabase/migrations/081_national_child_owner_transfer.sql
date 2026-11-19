-- 081: SKP Nasional — Fase 8 (plans/plan-skp-nasional.md)
-- Alih kepemilikan klaim turunan.
--
-- Admin/superadmin memindahkan klaim turunan ke akun distributor aktif lain
-- dari perusahaan yang sama, pada status apa pun. Akses mengikuti
-- campaigns.claim_owner_id (fungsi distributor_campaign_access, 077), jadi
-- begitu kolom itu berpindah pemilik lama kehilangan akses bertindak dan
-- pemilik baru mendapatkannya — tidak ada perubahan pada fungsi akses.
--
-- Isi:
--   1. claim_events: action baru 'owner_transferred' (pelaku, pemilik lama di
--      from_user_id, pemilik baru di to_user_id). Hanya ditulis fungsi di
--      butir 3; pengguna login tidak bisa menyisipkannya lewat PostgREST.
--   2. Trigger campaigns_guard_national_child: pemilik baru klaim turunan
--      harus akun distributor aktif dari perusahaan turunan itu — berlaku juga
--      untuk UPDATE langsung oleh admin. (Aturan lain sama dengan 076.)
--   3. transfer_national_child_owner(p_child_id, p_actor_id, p_new_owner_id,
--      p_expected_owner_id): mengalihkan kepemilikan dengan baris klaim dan
--      induknya dikunci (agar tidak berpapasan dengan akun tujuan yang sedang
--      menekan Buat Klaim), memindahkan pemegang klaim bila berstatus Klaim
--      Diajukan, dan mencatat riwayat. Hanya untuk service_role — dipanggil
--      transferChildOwnerAction.
--
-- Yang TIDAK berubah saat pengalihan: status, region, perusahaan, nomor,
-- nominal klaim, checklist, dokumen, dan claim_item_verifications.
--
-- Padanan sisi aplikasi: lib/national-skp.ts (transferChildOwnerError).
--
-- WAJIB dijalankan SEBELUM push aplikasi Fase 8: aplikasi memanggil fungsi
-- transfer_national_child_owner. Aman untuk aplikasi lama: belum ada yang
-- mengubah claim_owner_id.
-- Prasyarat: migrasi 073–080 sudah dijalankan.

-- ============================================================
-- 1. RIWAYAT KLAIM: action 'owner_transferred'
-- ============================================================

alter table public.claim_events
  drop constraint if exists claim_events_action_check;

alter table public.claim_events
  add constraint claim_events_action_check
  check (action in (
    'submitted', 'cancelled', 'claim_verified', 'ready_to_pay',
    'item_accepted', 'item_revision_requested', 'holder_transferred',
    'child_cancelled', 'owner_transferred'
  ));

-- Definisi sama dengan 076, ditambah: 'owner_transferred' tidak pernah bisa
-- disisipkan pengguna login (hanya fungsi transfer_national_child_owner).
drop policy if exists "claim_events_insert" on public.claim_events;
create policy "claim_events_insert" on public.claim_events
  for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and claim_events.action not in ('child_cancelled', 'owner_transferred')
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

-- ============================================================
-- 2. TRIGGER campaigns: pemilik baru harus distributor aktif seperusahaan
-- (aturan lain sama dengan 076)
-- ============================================================

create or replace function public.campaigns_guard_national_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    if new.parent_campaign_id is null then
      return new;
    end if;

    -- auth.uid() kosong = hak layanan (create_national_child_claim) / SQL
    -- editor. Pengguna login tidak pernah menyisipkan turunan secara langsung.
    if v_uid is not null then
      raise exception 'Klaim turunan hanya dapat dibuat lewat tombol Buat Klaim pada SKP Nasional'
        using errcode = '42501';
    end if;

    if not exists (
      select 1 from public.campaigns p
       where p.id = new.parent_campaign_id
         and p.is_national
         and p.parent_campaign_id is null
    ) then
      raise exception 'Induk klaim turunan harus SKP Nasional'
        using errcode = '23514';
    end if;

    return new;
  end if;

  -- UPDATE
  if new.parent_campaign_id is distinct from old.parent_campaign_id
     or new.child_seq is distinct from old.child_seq then
    raise exception 'SKP induk dan nomor urut klaim turunan tidak dapat diubah'
      using errcode = '23514';
  end if;

  if new.claim_owner_id is distinct from old.claim_owner_id then
    if v_uid is not null
       and not exists (
         select 1 from public.users u
          where u.id = v_uid
            and u.role in ('admin', 'superadmin')
            and u.is_active = true
       ) then
      raise exception 'Hanya admin yang dapat mengalihkan pemilik klaim turunan'
        using errcode = '42501';
    end if;

    -- Alih kepemilikan (081): pemilik baru = akun distributor aktif dari
    -- perusahaan turunan. (Mengosongkan pemilik sudah ditolak constraint
    -- bentuk baris turunan.)
    if new.claim_owner_id is not null and not exists (
      select 1 from public.users u
       where u.id = new.claim_owner_id
         and u.role::text = 'distributor'
         and u.is_active = true
         and u.distributor_id = new.distributor_id
    ) then
      raise exception 'Pemilik baru harus akun distributor aktif dari perusahaan distributor klaim ini'
        using errcode = '23514';
    end if;
  end if;

  if old.is_national and not new.is_national and exists (
    select 1 from public.campaigns k where k.parent_campaign_id = new.id
  ) then
    raise exception 'Tanda Nasional tidak dapat dicabut karena SKP ini sudah punya klaim turunan'
      using errcode = '23514';
  end if;

  -- Pembatalan klaim turunan (076): hanya dari Disetujui dan tanpa realisasi;
  -- yang sudah Dibatalkan tidak diaktifkan kembali (akun itu mungkin sudah
  -- membuat klaim pengganti).
  if new.parent_campaign_id is not null and new.status is distinct from old.status then
    if old.status = 'cancelled' then
      raise exception 'Klaim yang sudah dibatalkan tidak dapat diaktifkan kembali — buat klaim baru dari SKP Nasional'
        using errcode = '23514';
    end if;

    if new.status = 'cancelled' then
      if old.status <> 'approved' then
        raise exception 'Klaim hanya dapat dibatalkan selama berstatus Disetujui (belum ada realisasi dan belum diajukan)'
          using errcode = '23514';
      end if;
      if exists (select 1 from public.realizations z where z.campaign_id = new.id) then
        raise exception 'Klaim tidak dapat dibatalkan karena sudah punya realisasi'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

-- ============================================================
-- 3. ALIHKAN KEPEMILIKAN KLAIM TURUNAN
-- ============================================================

create or replace function public.transfer_national_child_owner(
  p_child_id          uuid,
  p_actor_id          uuid,
  p_new_owner_id      uuid,
  p_expected_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_child     public.campaigns;
  v_actor     public.users;
  v_new_owner public.users;
begin
  -- Kunci baris klaim: dua admin yang mengalihkan bersamaan diantrekan.
  select * into v_child
    from public.campaigns
   where id = p_child_id
     for update;

  if not found then
    raise exception 'Klaim tidak ditemukan' using errcode = 'P0001';
  end if;
  if v_child.parent_campaign_id is null then
    raise exception 'Hanya klaim atas SKP Nasional yang kepemilikannya dapat dialihkan' using errcode = 'P0001';
  end if;

  -- Kunci induk (urutan turunan → induk, sama dengan trigger selesai otomatis
  -- 080): create_national_child_claim juga mengunci induk, jadi akun tujuan
  -- yang sedang menekan Buat Klaim diantrekan dan pemeriksaan "klaim terbuka"
  -- di bawah melihat hasilnya.
  perform 1 from public.campaigns where id = v_child.parent_campaign_id for update;

  select * into v_actor from public.users where id = p_actor_id;
  if not found or not v_actor.is_active then
    raise exception 'Akun tidak aktif' using errcode = 'P0001';
  end if;
  if v_actor.role::text not in ('admin', 'superadmin') then
    raise exception 'Hanya admin yang dapat mengalihkan kepemilikan klaim' using errcode = 'P0001';
  end if;

  if v_child.claim_owner_id is distinct from p_expected_owner_id then
    raise exception 'Pemilik klaim sudah berubah — muat ulang halaman lalu coba lagi' using errcode = 'P0001';
  end if;

  select * into v_new_owner from public.users where id = p_new_owner_id;
  if not found then
    raise exception 'Akun pemilik baru tidak ditemukan' using errcode = 'P0001';
  end if;
  if v_new_owner.role::text <> 'distributor' then
    raise exception 'Pemilik baru harus akun distributor' using errcode = 'P0001';
  end if;
  if not v_new_owner.is_active then
    raise exception 'Akun pemilik baru tidak aktif' using errcode = 'P0001';
  end if;
  if v_new_owner.distributor_id is distinct from v_child.distributor_id then
    raise exception 'Pemilik baru harus dari perusahaan distributor klaim ini' using errcode = 'P0001';
  end if;
  if v_new_owner.id = v_child.claim_owner_id then
    raise exception 'Akun tersebut sudah menjadi pemilik klaim ini' using errcode = 'P0001';
  end if;

  -- Satu klaim terbuka per akun per induk tetap berlaku setelah pengalihan.
  if exists (
    select 1 from public.campaigns k
     where k.parent_campaign_id = v_child.parent_campaign_id
       and k.claim_owner_id = p_new_owner_id
       and k.id <> p_child_id
       and k.status in ('approved', 'ongoing')
  ) then
    raise exception 'Akun tujuan masih punya klaim lain yang belum diajukan atas SKP Nasional yang sama — selesaikan atau batalkan dulu klaim itu' using errcode = 'P0001';
  end if;

  -- Pemegang klaim ikut berpindah hanya saat Klaim Diajukan (aksi khusus
  -- pemegang — ubah nominal, unggah revisi, batal pengajuan — hanya berlaku
  -- di status itu). Di status lain claim_submitted_by tetap sebagai catatan
  -- siapa yang mengajukan.
  update public.campaigns
     set claim_owner_id = p_new_owner_id,
         claim_submitted_by = case
           when status = 'claim_submitted' then p_new_owner_id
           else claim_submitted_by
         end
   where id = p_child_id;

  insert into public.claim_events (campaign_id, actor_id, action, from_user_id, to_user_id)
  values (p_child_id, p_actor_id, 'owner_transferred', v_child.claim_owner_id, p_new_owner_id);
end;
$$;

comment on function public.transfer_national_child_owner(uuid, uuid, uuid, uuid) is
  'Mengalihkan kepemilikan klaim turunan SKP nasional ke akun distributor aktif lain dari perusahaan yang sama (hanya admin; pemegang klaim ikut pindah saat Klaim Diajukan) dan mencatatnya di riwayat klaim. Hanya service_role. (081)';

revoke all on function public.transfer_national_child_owner(uuid, uuid, uuid, uuid) from public;
revoke all on function public.transfer_national_child_owner(uuid, uuid, uuid, uuid) from anon, authenticated;
grant execute on function public.transfer_national_child_owner(uuid, uuid, uuid, uuid) to service_role;

-- ============================================================
-- VERIFIKASI (jalankan manual setelah migrasi)
-- ============================================================
-- \i supabase/tests/081_national_child_owner_transfer.sql -- harus "SEMUA LOLOS"
-- \i supabase/tests/076_national_child_cancel.sql         -- aturan batal tetap lolos
-- \i supabase/tests/075_national_child_claims.sql         -- aturan turunan tetap lolos
