alter table public.projects add constraint projects_org_repo_unique unique (org_id, repo_url);
alter table public.analyses
  add constraint analyses_project_unique unique (project_id),
  add column stage text check (stage in ('fetch', 'select', 'parse', 'store')),
  add column message text,
  add column error text,
  add column coverage jsonb,
  add column import_records jsonb;

-- Existing scaffold rows have no parser facts; absence stays visible as NULL.
alter table public.files
  add column folder text,
  add column lines integer check (lines >= 0),
  add column hash text check (hash ~ '^[0-9a-f]{64}$'),
  add column module text check (module in ('esm', 'commonjs', 'script')),
  add column fan_in integer check (fan_in >= 0),
  add column fan_out integer check (fan_out >= 0);
alter table public.edges
  add column kind text check (kind in ('import', 're-export', 'dynamic-import')),
  add constraint edges_connection_unique unique (analysis_id, source_file_id, target_file_id, kind);

create policy "members create their organization" on public.organizations
  for insert to authenticated with check (id = (select public.requesting_org_id()));
create policy "members create projects" on public.projects
  for insert to authenticated with check (org_id = (select public.requesting_org_id()));
create policy "members update projects" on public.projects
  for update to authenticated using (org_id = (select public.requesting_org_id()))
  with check (org_id = (select public.requesting_org_id()));
create policy "members create analyses" on public.analyses
  for insert to authenticated with check (
    org_id = (select public.requesting_org_id()) and
    exists (select 1 from public.projects p where p.id = project_id and p.org_id = analyses.org_id)
  );
create policy "members update analyses" on public.analyses
  for update to authenticated using (org_id = (select public.requesting_org_id()))
  with check (
    org_id = (select public.requesting_org_id()) and
    exists (select 1 from public.projects p where p.id = project_id and p.org_id = analyses.org_id)
  );
create policy "members store files" on public.files
  for insert to authenticated with check (
    org_id = (select public.requesting_org_id()) and
    exists (select 1 from public.analyses a where a.id = analysis_id and a.org_id = files.org_id)
  );
create policy "members store edges" on public.edges
  for insert to authenticated with check (
    org_id = (select public.requesting_org_id()) and
    exists (select 1 from public.analyses a where a.id = analysis_id and a.org_id = edges.org_id) and
    exists (select 1 from public.files f where f.id = source_file_id and f.analysis_id = edges.analysis_id and f.org_id = edges.org_id) and
    exists (select 1 from public.files f where f.id = target_file_id and f.analysis_id = edges.analysis_id and f.org_id = edges.org_id)
  );

grant select, insert on public.organizations to authenticated;
grant select, insert, update on public.projects, public.analyses to authenticated;
grant select, insert on public.files, public.edges to authenticated;

-- The unique constraints serialize simultaneous submissions of the same URL.
-- Invoker rights keep every write subject to the caller's organization policy.
create function public.begin_analysis(p_repo_url text)
returns table (id uuid, status text, created boolean)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_org text := public.requesting_org_id();
  v_project uuid;
  v_id uuid;
begin
  if v_org is null then raise exception 'An active organization is required'; end if;
  if p_repo_url !~ '^https://github[.]com/[a-z0-9-]+/[a-z0-9_.-]+$'
    or split_part(p_repo_url, '/', 5) in ('.', '..') then
    raise exception 'Expected a canonical GitHub repository URL';
  end if;
  insert into public.organizations (id) values (v_org) on conflict do nothing;
  insert into public.projects (org_id, repo_url) values (v_org, p_repo_url)
    on conflict (org_id, repo_url) do update set repo_url = excluded.repo_url
    returning projects.id into v_project;
  insert into public.analyses (org_id, project_id, status, started_at, stage, message)
    values (v_org, v_project, 'running', now(), 'fetch', 'Fetching repository archive')
    on conflict (project_id) do nothing returning analyses.id into v_id;
  if v_id is not null then
    return query select v_id, 'running'::text, true;
  else
    return query select a.id, a.status, false from public.analyses a where a.project_id = v_project;
  end if;
end;
$$;

-- Files, real edges, coverage and completion commit together or all roll back.
create function public.store_analysis(p_analysis_id uuid, p_result jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_analysis public.analyses;
begin
  select * into v_analysis from public.analyses where id = p_analysis_id for update;
  if not found or v_analysis.status <> 'running' or v_analysis.stage <> 'store' or v_analysis.commit_sha is null then
    raise exception 'Analysis is not ready to store';
  end if;
  if jsonb_typeof(p_result->'files') is distinct from 'array'
    or jsonb_typeof(p_result->'edges') is distinct from 'array'
    or jsonb_typeof(p_result->'imports') is distinct from 'array'
    or jsonb_typeof(p_result->'coverage') is distinct from 'object' then
    raise exception 'Invalid parser result';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_result->'files') f
    where f->>'path' is null or f->>'folder' is null or f->>'lines' is null
      or f->>'hash' is null or f->>'module' is null or f->>'fanIn' is null or f->>'fanOut' is null
  ) then raise exception 'Missing parser file facts'; end if;

  insert into public.files (org_id, analysis_id, path, folder, lines, hash, module, fan_in, fan_out)
  select v_analysis.org_id, v_analysis.id, f.path, f.folder, f.lines, f.hash, f.module, f."fanIn", f."fanOut"
    from jsonb_to_recordset(p_result->'files') as f(
      path text, folder text, lines integer, hash text, module text, "fanIn" integer, "fanOut" integer
    );
  if exists (
    select 1 from jsonb_to_recordset(p_result->'edges') as e("from" text, "to" text, kind text)
    where e.kind is null
      or not exists (select 1 from public.files f where f.analysis_id = p_analysis_id and f.path = e."from")
      or not exists (select 1 from public.files f where f.analysis_id = p_analysis_id and f.path = e."to")
  ) then raise exception 'Edge endpoint is absent from parsed files'; end if;
  insert into public.edges (org_id, analysis_id, source_file_id, target_file_id, kind)
  select v_analysis.org_id, v_analysis.id, source.id, target.id, e.kind
    from jsonb_to_recordset(p_result->'edges') as e("from" text, "to" text, kind text)
    join public.files source on source.analysis_id = p_analysis_id and source.path = e."from"
    join public.files target on target.analysis_id = p_analysis_id and target.path = e."to";
  update public.analyses set
    coverage = p_result->'coverage', import_records = p_result->'imports',
    status = 'complete', message = 'Analysis complete', finished_at = now()
    where id = p_analysis_id;
end;
$$;

revoke all on function public.begin_analysis(text), public.store_analysis(uuid, jsonb) from public, anon;
grant execute on function public.begin_analysis(text), public.store_analysis(uuid, jsonb) to authenticated;
