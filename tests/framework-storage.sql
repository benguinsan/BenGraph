-- Run as owner with all migrations applied. Every synthetic row rolls back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.framework_result() returns jsonb language sql as $$
  select jsonb_build_object(
    'framework', 'nextjs',
    'files', '[{"path":"app/page.tsx","folder":"app","lines":1,"hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","module":"esm","fanIn":0,"fanOut":0}]'::jsonb,
    'edges', '[]'::jsonb, 'imports', '[]'::jsonb,
    'coverage', '{"filesFound":1,"filesParsed":1,"filesSkipped":0,"skipped":[],"importsSeen":0,"importsResolved":0,"importsOutside":0,"importsExcluded":0,"importsUnresolved":0}'::jsonb,
    'roles', '[{"path":"app/page.tsx","role":"page"}]'::jsonb,
    'routes', '[{"file":"app/page.tsx","method":"GET","path":"/"}]'::jsonb
  )
$$;
select set_config('test.org', 'org_phase08_' || gen_random_uuid()::text, true);
select set_config('request.jwt.claims', jsonb_build_object('o', jsonb_build_object('id', current_setting('test.org')))::text, true);
set local role authenticated;
select set_config('test.id', id::text, true), set_config('test.started', started_at::text, true)
  from public.begin_analysis('https://github.com/cartograph/framework-storage-test');
update public.analyses set stage = 'store', commit_sha = repeat('a',40) where id = current_setting('test.id')::uuid;
select public.store_analysis(current_setting('test.id')::uuid, current_setting('test.started')::timestamptz, pg_temp.framework_result());
select set_config('test.file', id::text, true) from public.files where analysis_id = current_setting('test.id')::uuid;
do $$
declare result jsonb := public.read_analysis_result(current_setting('test.id')::uuid);
begin
  assert result->>'framework' = 'nextjs';
  assert result->'roles' = '[{"path":"app/page.tsx","role":"page"}]'::jsonb;
  assert result->'routes' = '[{"file":"app/page.tsx","method":"GET","path":"/"}]'::jsonb;
  assert (select count(*) from public.file_roles) = 1;
  assert (select count(*) from public.routes) = 1;
end $$;
select set_config('request.jwt.claims', '{"o":{"id":"org_phase08_other"}}', true);
do $$ begin
  assert public.read_analysis_result(current_setting('test.id')::uuid) is null;
  assert not exists (select 1 from public.file_roles);
  assert not exists (select 1 from public.routes);
  begin
    insert into public.file_roles (org_id, file_id, role)
      values ('org_phase08_other', current_setting('test.file')::uuid, 'page');
    raise exception 'Expected cross-organization role write to fail';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.routes (org_id, analysis_id, file_id, method, path)
      values ('org_phase08_other', current_setting('test.id')::uuid, current_setting('test.file')::uuid, 'GET', '/');
    raise exception 'Expected cross-organization route write to fail';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', jsonb_build_object('o', jsonb_build_object('id', current_setting('test.org')))::text, true);
select set_config('test.started', started_at::text, true) from public.restart_analysis(current_setting('test.id')::uuid);
update public.analyses set stage = 'store', commit_sha = repeat('b',40) where id = current_setting('test.id')::uuid;
do $$ begin
  begin
    perform public.store_analysis(current_setting('test.id')::uuid, current_setting('test.started')::timestamptz,
      jsonb_set(pg_temp.framework_result(), '{routes,0,file}', '"missing.ts"'));
    raise exception 'Expected invalid route to fail';
  exception when raise_exception then
    if sqlerrm <> 'Invalid framework route or missing file' then raise; end if;
  end;
  begin
    perform public.store_analysis(current_setting('test.id')::uuid, current_setting('test.started')::timestamptz,
      jsonb_set(pg_temp.framework_result(), '{roles,0,path}', '"missing.ts"'));
    raise exception 'Expected invalid role to fail';
  exception when raise_exception then
    if sqlerrm <> 'Invalid framework role or missing file' then raise; end if;
  end;
  begin
    perform public.store_analysis(current_setting('test.id')::uuid, current_setting('test.started')::timestamptz,
      jsonb_set(pg_temp.framework_result(), '{roles}', '[{"path":"app/page.tsx","role":"page"},{"path":"app/page.tsx","role":"page"}]'::jsonb));
    raise exception 'Expected duplicate role to fail';
  exception when unique_violation then null;
  end;
  assert (select count(*) from public.file_roles) = 1, 'Invalid replacement changed old roles';
  assert (select count(*) from public.routes) = 1, 'Invalid replacement changed old routes';
end $$;
-- A legacy caller has no framework facts; replacement clears old facts atomically.
select public.store_analysis(current_setting('test.id')::uuid, current_setting('test.started')::timestamptz,
  pg_temp.framework_result() - 'framework' - 'roles' - 'routes');
do $$
declare result jsonb := public.read_analysis_result(current_setting('test.id')::uuid);
begin
  assert result->'framework' = 'null'::jsonb;
  assert result->'roles' = '[]'::jsonb and result->'routes' = '[]'::jsonb;
  assert not exists (select 1 from public.file_roles);
  assert not exists (select 1 from public.routes);
end $$;
reset role;
rollback;
