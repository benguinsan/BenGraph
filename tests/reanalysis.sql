\set ON_ERROR_STOP on
begin;
create function pg_temp.result() returns jsonb language sql as $$
  select jsonb_build_object(
    'files', jsonb_build_array(
      jsonb_build_object('path','main.ts','folder','','lines',1,'hash',repeat('a',64),'module','esm','fanIn',0,'fanOut',1),
      jsonb_build_object('path','leaf.ts','folder','','lines',1,'hash',repeat('b',64),'module','esm','fanIn',1,'fanOut',0)
    ),
    'edges', '[{"from":"main.ts","to":"leaf.ts","kind":"import"}]'::jsonb,
    'imports', '[{"from":"main.ts","specifier":"./leaf","kind":"import","status":"resolved","target":"leaf.ts"}]'::jsonb,
    'coverage', '{"filesFound":2,"filesParsed":2,"filesSkipped":0,"skipped":[],"importsSeen":1,"importsResolved":1,"importsOutside":0,"importsExcluded":0,"importsUnresolved":0}'::jsonb
  )
$$;
set local role authenticated;
set local request.jwt.claims = '{"o":{"id":"org_reanalysis_a"}}';
select * from public.begin_analysis('https://github.com/cartograph/reanalysis-test') \gset first_
select set_config('test.id', :'first_id', true);
select set_config('realtime.topic', 'analysis:' || :'first_id', true);
select set_config('test.first_start', started_at::text, true) from public.analyses where id = :'first_id';
update public.analyses set stage = 'store', commit_sha = repeat('a',40) where id = :'first_id';
select public.store_analysis(:'first_id', current_setting('test.first_start')::timestamptz, pg_temp.result());
select set_config('test.old_file', id::text, true) from public.files where path = 'leaf.ts';
do $$ begin
  assert jsonb_array_length(public.read_analysis_result(current_setting('test.id')::uuid)->'files') = 2;
  assert public.read_analysis_result(current_setting('test.id')::uuid)->'edges'->0->>'to' = 'leaf.ts';
end $$;

select * from public.restart_analysis(:'first_id') \gset second_
select set_config('test.second_start', :'second_started_at', true);
do $$ begin
  assert current_setting('test.first_start')::timestamptz <> current_setting('test.second_start')::timestamptz;
  assert (select count(*) from public.analyses) = 1;
  assert (select count(*) from public.files) = 2, 'Restart deleted the previous graph';
  assert public.read_analysis_result(current_setting('test.id')::uuid) is null, 'Old graph presented as a new result';
  begin
    perform public.fail_analysis(current_setting('test.id')::uuid, current_setting('test.first_start')::timestamptz, 'fetch', 'Old run failed');
    raise exception 'Expected superseded failure to be rejected';
  exception when raise_exception then
    if sqlerrm <> 'Analysis run was superseded or is unavailable' then raise; end if;
  end;
  begin
    perform public.restart_analysis(current_setting('test.id')::uuid);
    raise exception 'Expected an active run to block another restart';
  exception when raise_exception then
    if sqlerrm not like 'This analysis is still running%' then raise; end if;
  end;
end $$;
update public.analyses set stage = 'store', commit_sha = repeat('b',40) where id = :'first_id';
do $$ begin
  begin
    perform public.store_analysis(current_setting('test.id')::uuid, current_setting('test.first_start')::timestamptz, pg_temp.result());
    raise exception 'Expected superseded run to be rejected';
  exception when raise_exception then
    if sqlerrm <> 'Analysis run was superseded' then raise; end if;
  end;
  begin
    perform public.store_analysis(current_setting('test.id')::uuid, current_setting('test.second_start')::timestamptz,
      jsonb_set(pg_temp.result(), '{edges,0,to}', '"missing.ts"'));
    raise exception 'Expected invalid replacement to fail';
  exception when raise_exception then
    if sqlerrm <> 'Edge endpoint is absent from parsed files' then raise; end if;
  end;
  assert exists (select 1 from public.files where id = current_setting('test.old_file')::uuid), 'Failed replacement deleted old files';
end $$;
select public.store_analysis(:'first_id', :'second_started_at',
  jsonb_set(jsonb_set(jsonb_set(pg_temp.result(), '{files,1,path}', '"new-leaf.ts"'), '{edges,0,to}', '"new-leaf.ts"'), '{imports,0,target}', '"new-leaf.ts"'));
do $$ begin
  assert (select count(*) from public.files) = 2;
  assert (select count(*) from public.edges) = 1;
  assert not exists (select 1 from public.files where id = current_setting('test.old_file')::uuid);
  assert public.read_analysis_result(current_setting('test.id')::uuid)->'edges'->0->>'to' = 'new-leaf.ts';
  assert public.read_analysis_result(current_setting('test.id')::uuid)->>'commit_sha' = repeat('b',40);
end $$;

-- A stale run may be deliberately restarted, retaining the same analysis row.
update public.analyses set status = 'running', finished_at = null, stage = 'fetch', message = 'Fetching repository archive',
  started_at = clock_timestamp() - interval '10 minutes' where id = :'first_id';
select set_config('realtime.topic', 'analysis:' || :'first_id', true);
select set_config('test.events_before_restart', count(*)::text, true) from realtime.messages where topic = realtime.topic();
select * from public.restart_analysis(:'first_id') \gset stale_
select set_config('realtime.topic', 'analysis:' || :'first_id', true);
do $$ begin
  assert (select count(*) from public.analyses) = 1;
  assert (select stage from public.analyses where id = current_setting('test.id')::uuid) = 'fetch';
  assert (select count(*) from realtime.messages where topic = realtime.topic()) = current_setting('test.events_before_restart')::integer + 1,
    'Same-stage restart did not publish';
end $$;

set local request.jwt.claims = '{"o":{"id":"org_reanalysis_b"}}';
do $$ begin
  assert public.read_analysis_result(current_setting('test.id')::uuid) is null;
  begin
    perform public.restart_analysis(current_setting('test.id')::uuid);
    raise exception 'Expected cross-organization restart to fail';
  exception when raise_exception then
    if sqlerrm <> 'Analysis not found' then raise; end if;
  end;
  assert not has_function_privilege('anon','public.read_analysis_result(uuid)','execute');
end $$;

-- A single JSON result must retain more than the API's default 1,000 list rows.
select * from public.begin_analysis('https://github.com/cartograph/large-result') \gset large_
update public.analyses set stage = 'store', commit_sha = repeat('c',40) where id = :'large_id';
select public.store_analysis(:'large_id', :'large_started_at', jsonb_build_object(
  'files', (select jsonb_agg(jsonb_build_object('path', n || '.ts','folder','','lines',0,'hash',repeat('a',64),'module','esm','fanIn',0,'fanOut',0)) from generate_series(1,1205) n),
  'edges','[]'::jsonb,'imports','[]'::jsonb,
  'coverage','{"filesFound":1205,"filesParsed":1205,"filesSkipped":0,"skipped":[],"importsSeen":0,"importsResolved":0,"importsOutside":0,"importsExcluded":0,"importsUnresolved":0}'::jsonb
));
select set_config('test.large_id', :'large_id', true);
do $$ begin
  assert jsonb_array_length(public.read_analysis_result(current_setting('test.large_id')::uuid)->'files') = 1205;
end $$;
set local request.jwt.claims = '{"o":{"id":"org_reanalysis_a"}}';
do $$ begin
  assert public.read_analysis_result(current_setting('test.large_id')::uuid) is null,
    'Another organization can read a completed graph';
  assert (select count(*) from public.files) = 2;
end $$;
reset role;
rollback;
