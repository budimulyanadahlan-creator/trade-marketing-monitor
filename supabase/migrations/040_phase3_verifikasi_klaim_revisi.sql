-- Phase 3 (Verifikasi Klaim oleh Finance): loop revisi sisi distributor.
--
-- 1. campaign_files_insert_distributor (031): perketat jendela status
--    claim_submitted — re-upload distributor pada status itu hanya diterima
--    bila item verifikasi dokumen tersebut sedang revision_requested.
--    approved/ongoing tetap seperti semula (belum ada verifikasi per item
--    pada status itu). Ini defense-in-depth di lapisan RLS; app/api/upload/
--    claim-document/route.ts sudah menolaknya lebih dulu di lapisan server.
-- 2. campaigns_update_distributor_edit_claim_amount: policy UPDATE baru —
--    distributor mengedit nominal klaim (campaigns.claim_amount) sambil
--    status TETAP claim_submitted (bukan transisi status, beda dari policy
--    032/033 yang masing-masing mengunci satu transisi). Server action
--    (updateClaimAmountAction) yang memastikan hanya kolom claim_amount
--    yang berubah dan hanya saat item verifikasi nominal sedang
--    revision_requested — policy ini pagar tambahan di level status+role.

drop policy if exists "campaign_files_insert_distributor" on public.campaign_files;

create policy "campaign_files_insert_distributor" on public.campaign_files
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and document_type_id is not null
    and exists (
      select 1
      from public.campaigns c
      join public.users u on u.id = auth.uid()
      where c.id = campaign_files.campaign_id
        and u.role = 'distributor'
        and u.is_active = true
        and (
          c.status in ('approved', 'ongoing')
          or (
            c.status = 'claim_submitted'
            and exists (
              select 1 from public.claim_item_verifications civ
              where civ.campaign_id = c.id
                and civ.document_type_id = campaign_files.document_type_id
                and civ.status = 'revision_requested'
            )
          )
        )
    )
  );

drop policy if exists "campaigns_update_distributor_edit_claim_amount" on public.campaigns;

create policy "campaigns_update_distributor_edit_claim_amount" on public.campaigns
  for update to authenticated
  using (
    campaigns.status = 'claim_submitted'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
    )
  )
  with check (
    campaigns.status = 'claim_submitted'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role = 'distributor'
        and u.is_active = true
    )
  );
