-- The original start timestamp identifies a run so an abandoned process cannot
-- overwrite a later explicit restart of the same analysis.
drop function public.begin_analysis(text);
create function public.begin_analysis(p_repo_url text)
returns table (id uuid, status text, created boolean, started_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_org text := public.requesting_org_id();
  v_project uuid;
  v_id uuid;
  v_started timestamptz;
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
    values (v_org, v_project, 'running', clock_timestamp(), 'fetch', 'Fetching repository archive')
    on conflict (project_id) do nothing returning analyses.id, analyses.started_at into v_id, v_started;
  if v_id is not null then
    return query select v_id, 'running'::text, true, v_started;
  else
    return query select a.id, a.status, false, a.started_at from public.analyses a where a.project_id = v_project;
  end if;
end;
$$;

create function public.restart_analysis(p_analysis_id uuid)
returns table (id uuid, started_at timestamptz)
language plpgsql security invoker set search_path = ''
as $$
declare
  v_analysis public.analyses;
begin
  select * into v_analysis from public.analyses where analyses.id = p_analysis_id for update;
  if not found then raise exception 'Analysis not found'; end if;
  if v_analysis.status in ('running', 'queued') and
    coalesce(v_analysis.started_at, v_analysis.created_at) > clock_timestamp() - interval '5 minutes' then
    raise exception 'This analysis is still running. Wait for completion or a stale state before restarting';
  end if;
  return query update public.analyses set status = 'running', stage = 'fetch',
    message = 'Fetching repository archive', error = null, commit_sha = null,
    started_at = clock_timestamp(), finished_at = null
    where analyses.id = p_analysis_id returning analyses.id, analyses.started_at;
end;
$$;

create policy "members replace their analysis files" on public.files
  for delete to authenticated using (
    org_id = (select public.requesting_org_id()) and exists (
      select 1 from public.analyses a where a.id = analysis_id and a.org_id = files.org_id
        and a.status = 'running' and a.stage = 'store'
    )
  );
grant delete on public.files to authenticated;

drop function public.store_analysis(uuid, jsonb);
create function public.store_analysis(p_analysis_id uuid, p_started_at timestamptz, p_result jsonb)
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
  if v_analysis.started_at is distinct from p_started_at then raise exception 'Analysis run was superseded'; end if;
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

  -- Deleting here preserves the old graph if any part of replacement fails.
  delete from public.files where analysis_id = p_analysis_id;
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
  update public.analyses set coverage = p_result->'coverage', import_records = p_result->'imports',
    status = 'complete', message = 'Analysis complete', finished_at = clock_timestamp()
    where id = p_analysis_id;
end;
$$;

-- Aggregate one result instead of silently truncating files/edges at the API's
-- list-row limit. Every contributing row remains subject to its own RLS policy.
create function public.read_analysis_result(p_analysis_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select case when a.coverage is null or a.import_records is null then null else jsonb_build_object(
    'commit_sha', a.commit_sha, 'coverage', a.coverage, 'imports', a.import_records,
    'files', coalesce((select jsonb_agg(jsonb_build_object(
      'path', f.path, 'folder', f.folder, 'lines', f.lines, 'hash', f.hash,
      'module', f.module, 'fanIn', f.fan_in, 'fanOut', f.fan_out
    ) order by f.path) from public.files f where f.analysis_id = a.id), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object(
      'from', source.path, 'to', target.path, 'kind', e.kind
    ) order by source.path, target.path, e.kind)
      from public.edges e
      left join public.files source on source.id = e.source_file_id and source.analysis_id = a.id
      left join public.files target on target.id = e.target_file_id and target.analysis_id = a.id
      where e.analysis_id = a.id), '[]'::jsonb)
  ) end from public.analyses a where a.id = p_analysis_id and a.status = 'complete';
$$;

-- All lifecycle timestamps come from Postgres, including failures on app hosts
-- whose clock may differ from the database's clock.
create function public.fail_analysis(p_analysis_id uuid, p_started_at timestamptz, p_stage text, p_error text)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_stage is null or p_stage not in ('fetch', 'select', 'parse', 'store')
    or nullif(btrim(p_error), '') is null then raise exception 'Failure stage and reason are required'; end if;
  update public.analyses set status = 'failed', stage = p_stage,
    error = p_error, message = p_error, finished_at = clock_timestamp()
    where id = p_analysis_id and status = 'running' and started_at = p_started_at;
  if not found then raise exception 'Analysis run was superseded or is unavailable'; end if;
end;
$$;

revoke all on function public.begin_analysis(text), public.restart_analysis(uuid),
  public.store_analysis(uuid, timestamptz, jsonb), public.read_analysis_result(uuid),
  public.fail_analysis(uuid, timestamptz, text, text) from public, anon;
grant execute on function public.begin_analysis(text), public.restart_analysis(uuid),
  public.store_analysis(uuid, timestamptz, jsonb), public.read_analysis_result(uuid),
  public.fail_analysis(uuid, timestamptz, text, text) to authenticated;

-- Restarting a stale fetch changes its start time even when its stage/message
-- stay the same. The dashboard must hear that the new run is no longer stale.
create or replace function private.broadcast_analysis_progress()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_stage text;
  v_message text;
begin
  if tg_op = 'UPDATE' and
    (new.stage, new.status, new.message, new.error, new.started_at) is not distinct from
    (old.stage, old.status, old.message, old.error, old.started_at) then return null; end if;
  v_stage := case when new.status = 'running' then coalesce(new.stage, 'running') else new.status end;
  v_message := case when new.status = 'failed'
    then 'Failed during ' || coalesce(new.stage, 'run') || ': ' || coalesce(new.error, new.message, 'No failure reason recorded')
    else coalesce(new.message, case new.status when 'queued' then 'Waiting to start' when 'complete' then 'Analysis complete' else 'Run started; no stage recorded' end)
    end;
  perform realtime.send(jsonb_build_object('stage', v_stage, 'message', v_message), 'progress', 'analysis:' || new.id::text, true);
  perform realtime.send(jsonb_build_object('stage', v_stage, 'message', v_message), 'progress', 'organization:' || new.org_id || ':analyses', true);
  return null;
end;
$$;
revoke all on function private.broadcast_analysis_progress() from public, anon, authenticated;
