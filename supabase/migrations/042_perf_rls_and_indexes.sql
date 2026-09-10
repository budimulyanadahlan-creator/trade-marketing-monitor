-- Perf (plans/perf-skp-pages.md, Fase 2): two independent, purely
-- mechanical changes — no permission logic is altered by either.
--
-- 1. RLS policies on the tables the SKP list/detail pages query call
--    auth.uid() (and, where relevant, auth.role()/auth.jwt()) unwrapped —
--    Postgres re-evaluates that call for every row a query scans instead of
--    once per query, exactly the "Auth RLS Initialization Plan" warning
--    Supabase's own Performance Advisor flags (82 warnings project-wide at
--    the time this was written). Rather than hand-transcribing every
--    policy's current USING/WITH CHECK text from migration history (several
--    of these were drop+recreated multiple times across migrations 003-040,
--    and hand-copying long boolean expressions is exactly the kind of
--    change that's easy to get subtly wrong on a production auth policy),
--    this reads each policy's live definition straight from pg_policies and
--    rewrites only the auth.*() calls in place, byte-for-byte identical
--    otherwise.
--
--    Scoped to the 8 tables the two SKP pages actually query: campaigns,
--    campaign_files, claim_events, claim_item_verifications,
--    distributor_claim_checklists, distributor_receipts, users,
--    departments. (Every other flagged table in the project is out of
--    scope for this round per the plan.)
do $$
declare
  pol record;
  using_clause text;
  check_clause text;
  stmt text;
  rewritten int := 0;
begin
  for pol in
    select schemaname, tablename, policyname, cmd, permissive, roles, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'campaigns', 'campaign_files', 'claim_events', 'claim_item_verifications',
        'distributor_claim_checklists', 'distributor_receipts', 'users', 'departments'
      )
      and (
        (qual is not null and qual ~ 'auth\.(uid|role|jwt)\(\)')
        or (with_check is not null and with_check ~ 'auth\.(uid|role|jwt)\(\)')
      )
  loop
    using_clause := case when pol.qual is not null
      then regexp_replace(pol.qual, '\mauth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g')
      else null end;
    check_clause := case when pol.with_check is not null
      then regexp_replace(pol.with_check, '\mauth\.(uid|role|jwt)\(\)', '(select auth.\1())', 'g')
      else null end;

    stmt := format(
      'create policy %I on public.%I as %s for %s to %s',
      pol.policyname, pol.tablename, pol.permissive, pol.cmd, array_to_string(pol.roles, ', ')
    );
    if using_clause is not null then
      stmt := stmt || format(' using (%s)', using_clause);
    end if;
    if check_clause is not null then
      stmt := stmt || format(' with check (%s)', check_clause);
    end if;

    execute format('drop policy %I on public.%I', pol.policyname, pol.tablename);
    execute stmt;

    rewritten := rewritten + 1;
    raise notice 'Rewrote policy % on % (%)', pol.policyname, pol.tablename, pol.cmd;
  end loop;

  raise notice '% polic(ies) rewritten', rewritten;
end $$;

-- 2. Indexes on FK columns the two pages filter by. campaign_id on
--    claim_item_verifications already has an index (migration 039).
--    campaign_id on distributor_claim_checklists and distributor_receipts
--    is already the leftmost column of an existing UNIQUE constraint
--    (unique (campaign_id, distributor_id, document_type_id) and unique
--    (campaign_id, received_by) respectively) — Postgres can use that
--    composite index for a campaign_id-only lookup, so a dedicated
--    single-column index there would just be dead weight. The rest have no
--    such coverage and are genuinely missing.
create index if not exists idx_campaigns_department_id on public.campaigns(department_id);
create index if not exists idx_campaigns_region_id on public.campaigns(region_id);
create index if not exists idx_campaigns_created_by on public.campaigns(created_by);
create index if not exists idx_campaigns_status on public.campaigns(status);
create index if not exists idx_campaign_files_campaign_id on public.campaign_files(campaign_id);
create index if not exists idx_claim_events_campaign_id on public.claim_events(campaign_id);
create index if not exists idx_approval_history_campaign_id on public.approval_history(campaign_id);
create index if not exists idx_realizations_campaign_id on public.realizations(campaign_id);
