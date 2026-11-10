-- Run against a disposable database with all migrations applied, as its owner.
-- The transaction rolls back every test row.
\set ON_ERROR_STOP on
begin;
create function pg_temp.parser_result() returns jsonb language sql as $$
  select jsonb_build_object(
    'files', jsonb_build_array(
      jsonb_build_object('path', 'main.ts', 'folder', '', 'lines', 1, 'hash', repeat('a', 64), 'module', 'esm', 'fanIn', 0, 'fanOut', 1),
      jsonb_build_object('path', 'leaf.ts', 'folder', '', 'lines', 1, 'hash', repeat('b', 64), 'module', 'esm', 'fanIn', 1, 'fanOut', 0)
    ),
    'edges', '[{"from":"main.ts","to":"leaf.ts","kind":"re-export"}]'::jsonb,
    'imports', '[{"from":"main.ts","specifier":"./leaf","kind":"re-export","status":"resolved","target":"leaf.ts"},{"from":"main.ts","specifier":"./missing","kind":"import","status":"unresolved","reason":"Not found"}]'::jsonb,
    'coverage', '{"filesFound":2,"filesParsed":2,"filesSkipped":0,"skipped":[],"importsSeen":2,"importsResolved":1,"importsOutside":0,"importsExcluded":0,"importsUnresolved":1}'::jsonb
  )
$$;
set local role authenticated;
set local request.jwt.claims = '{"o":{"id":"org_pipeline_a"}}';
select * from public.begin_analysis('https://github.com/cartograph/storage-test') \gset first_
select * from public.begin_analysis('https://github.com/cartograph/storage-test') \gset second_
select set_config('test.analysis_id', :'first_id', true);
select set_config('test.started_at', :'first_started_at', true);
select set_config('test.same_analysis', (:'first_id' = :'second_id' and :'first_created'::boolean and not :'second_created'::boolean)::text, true);
do $$ begin
  assert current_setting('test.same_analysis') = 'true', 'Duplicate submission created another analysis';
  assert (select count(*) from public.analyses) = 1;
end $$;

update public.analyses set stage = 'store', commit_sha = repeat('a', 40)
  where id = current_setting('test.analysis_id')::uuid;
do $$ begin
  begin
    perform public.store_analysis(current_setting('test.analysis_id')::uuid, current_setting('test.started_at')::timestamptz,
      jsonb_set(pg_temp.parser_result(), '{edges,0,to}', '"missing.ts"'));
    raise exception 'Expected dangling edge to fail';
  exception when raise_exception then
    if sqlerrm <> 'Edge endpoint is absent from parsed files' then raise; end if;
  end;
  assert (select count(*) from public.files) = 0, 'Failed save left partial files';
  assert (select status from public.analyses where id = current_setting('test.analysis_id')::uuid) = 'running';
end $$;
select public.store_analysis(current_setting('test.analysis_id')::uuid, current_setting('test.started_at')::timestamptz, pg_temp.parser_result());
do $$ begin
  assert (select count(*) from public.files) = 2;
  assert (select count(*) from public.edges where kind = 're-export') = 1;
  assert (select count(*) from public.files where lines = 1 and module = 'esm' and hash is not null) = 2;
  assert (select status = 'complete' and finished_at is not null and coverage->>'importsUnresolved' = '1'
    and import_records->1->>'reason' = 'Not found' from public.analyses where id = current_setting('test.analysis_id')::uuid);
end $$;

set local request.jwt.claims = '{"o":{"id":"org_pipeline_b"}}';
do $$ begin
  assert (select count(*) from public.analyses) = 0, 'Another organization can read the analysis';
  assert (select count(*) from public.files) = 0;
  assert (select count(*) from public.edges) = 0;
  begin
    perform public.store_analysis(current_setting('test.analysis_id')::uuid, current_setting('test.started_at')::timestamptz, pg_temp.parser_result());
    raise exception 'Expected cross-organization store to fail';
  exception when raise_exception then
    if sqlerrm <> 'Analysis is not ready to store' then raise; end if;
  end;
  begin
    insert into public.files (org_id, analysis_id, path)
      values ('org_pipeline_b', current_setting('test.analysis_id')::uuid, 'injected.ts');
    raise exception 'Expected cross-organization parent to fail';
  exception when insufficient_privilege then null;
  end;
end $$;
select * from public.begin_analysis('https://github.com/cartograph/storage-test') \gset other_
do $$ begin
  assert (select count(*) from public.analyses) = 1, 'Second organization cannot create its own analysis';
  assert not has_function_privilege('anon', 'public.begin_analysis(text)', 'execute');
  assert not has_function_privilege('anon', 'public.store_analysis(uuid,timestamptz,jsonb)', 'execute');
end $$;
reset role;
rollback;
