-- Framework facts replace atomically with the files and resolved import graph.
alter table public.analyses add column framework text
  check (framework is null or framework in ('nextjs', 'nestjs', 'react'));
alter table public.file_roles add constraint file_roles_file_role_unique unique (file_id, role),
  add constraint file_roles_role_nonempty check (btrim(role) <> '');
alter table public.routes add constraint routes_file_method_path_unique unique (analysis_id, file_id, method, path),
  add constraint routes_http_method check (method in ('GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS')),
  add constraint routes_absolute_path check (left(path, 1) = '/');

create policy "members store framework roles" on public.file_roles
  for insert to authenticated with check (
    org_id = (select public.requesting_org_id()) and exists (
      select 1 from public.files f where f.id = file_roles.file_id and f.org_id = file_roles.org_id
    )
  );
create policy "members store framework routes" on public.routes
  for insert to authenticated with check (
    org_id = (select public.requesting_org_id()) and exists (
      select 1 from public.files f where f.id = routes.file_id
        and f.org_id = routes.org_id and f.analysis_id = routes.analysis_id
    )
  );
grant select, insert on public.file_roles, public.routes to authenticated;

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
    or (p_result->>'framework' is not null and p_result->>'framework' not in ('nextjs','nestjs','react'))
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

create or replace function public.read_analysis_result(p_analysis_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select case when a.coverage is null or a.import_records is null then null else jsonb_build_object(
    'commit_sha', a.commit_sha, 'coverage', a.coverage, 'imports', a.import_records,
    'framework', a.framework,
    'roles', coalesce((select jsonb_agg(jsonb_build_object('path', f.path, 'role', r.role) order by f.path, r.role)
      from public.file_roles r join public.files f on f.id = r.file_id
      where f.analysis_id = a.id), '[]'::jsonb),
    'routes', coalesce((select jsonb_agg(jsonb_build_object('file', f.path, 'method', r.method, 'path', r.path)
      order by r.path, r.method, f.path) from public.routes r
      join public.files f on f.id = r.file_id and f.analysis_id = a.id
      where r.analysis_id = a.id), '[]'::jsonb),
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
