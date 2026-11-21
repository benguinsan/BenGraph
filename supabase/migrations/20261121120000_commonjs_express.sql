-- CommonJS require() becomes an edge kind and Express a framework adapter.
alter table public.analyses drop constraint analyses_framework_check,
  add constraint analyses_framework_check check (framework is null or framework in ('nextjs', 'nestjs', 'express', 'react'));
alter table public.edges drop constraint edges_kind_check,
  add constraint edges_kind_check check (kind in ('import', 're-export', 'dynamic-import', 'require'));

create or replace function public.store_analysis(p_analysis_id uuid, p_started_at timestamptz, p_result jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_analysis public.analyses;
  v_roles jsonb := coalesce(p_result->'roles', '[]'::jsonb);
  v_routes jsonb := coalesce(p_result->'routes', '[]'::jsonb);
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


  if (p_result ? 'framework' and jsonb_typeof(p_result->'framework') not in ('string','null'))
    or (p_result->>'framework' is not null and p_result->>'framework' not in ('nextjs','nestjs','express','react'))
    or jsonb_typeof(v_roles) is distinct from 'array' or jsonb_typeof(v_routes) is distinct from 'array' then
    raise exception 'Invalid framework facts';
  end if;
  if p_result->>'framework' is null and (jsonb_array_length(v_roles) > 0 or jsonb_array_length(v_routes) > 0) then
    raise exception 'Generic analysis cannot contain framework facts';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_roles) r
    where jsonb_typeof(r->'path') is distinct from 'string'
      or jsonb_typeof(r->'role') is distinct from 'string' or nullif(btrim(r->>'role'), '') is null
      or not exists (select 1 from jsonb_array_elements(p_result->'files') f where f->>'path' = r->>'path')
  ) then raise exception 'Invalid framework role or missing file'; end if;
  if exists (
    select 1 from jsonb_array_elements(v_routes) r
    where jsonb_typeof(r->'file') is distinct from 'string'
      or jsonb_typeof(r->'path') is distinct from 'string' or left(r->>'path',1) <> '/'
      or jsonb_typeof(r->'method') is distinct from 'string'
      or r->>'method' not in ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS')
      or not exists (select 1 from jsonb_array_elements(p_result->'files') f where f->>'path' = r->>'file')
  ) then raise exception 'Invalid framework route or missing file'; end if;

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
  insert into public.file_roles (org_id, file_id, role)
  select v_analysis.org_id, f.id, r.role from jsonb_to_recordset(v_roles) as r(path text, role text)
    join public.files f on f.analysis_id = p_analysis_id and f.path = r.path;
  insert into public.routes (org_id, analysis_id, file_id, method, path)
  select v_analysis.org_id, p_analysis_id, f.id, r.method, r.path
    from jsonb_to_recordset(v_routes) as r(file text, method text, path text)
    join public.files f on f.analysis_id = p_analysis_id and f.path = r.file;
  update public.analyses set coverage = p_result->'coverage', import_records = p_result->'imports',
    framework = p_result->>'framework',
    status = 'complete', message = 'Analysis complete', finished_at = clock_timestamp()
    where id = p_analysis_id;
end;
$$;
