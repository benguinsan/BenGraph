-- Run as the owner against a disposable migrated Supabase database (or local
-- Realtime SQL fixtures). This tests policy and trigger behavior, not WebSockets.
\set ON_ERROR_STOP on
begin;
select set_config('test.trigger_function', ('private.broadcast_analysis_progress()'::regprocedure::oid)::text, true);
set local role authenticated;
set local request.jwt.claims = '{"o":{"id":"org_progress_a"}}';
select * from public.begin_analysis('https://github.com/cartograph/progress-test') \gset run_
select set_config('test.analysis_id', :'run_id', true);
select set_config('test.started_at', :'run_started_at', true);
select set_config('realtime.topic', 'analysis:' || :'run_id', true);

do $$ begin
  assert (select count(*) from realtime.messages where topic = realtime.topic()) = 1;
  assert (select payload - 'id' = '{"stage":"fetch","message":"Fetching repository archive"}'::jsonb
    and private and event = 'progress' from realtime.messages where topic = realtime.topic());
end $$;
update public.analyses set stage = 'parse', message = 'Resolving imports'
  where id = current_setting('test.analysis_id')::uuid;
-- Unrelated column changes must not emit another progress event.
update public.analyses set commit_sha = repeat('a', 40)
  where id = current_setting('test.analysis_id')::uuid;
-- realtime.send adds a transport id and changes the transaction's topic.
select set_config('realtime.topic', 'analysis:' || :'run_id', true);
do $$ begin
  assert (select count(*) from realtime.messages where topic = realtime.topic()) = 2;
  assert exists (select 1 from realtime.messages where topic = realtime.topic()
    and payload - 'id' = '{"stage":"parse","message":"Resolving imports"}'::jsonb);
end $$;
select public.fail_analysis(current_setting('test.analysis_id')::uuid, current_setting('test.started_at')::timestamptz, 'parse', 'Invalid compiler config');
select set_config('realtime.topic', 'analysis:' || :'run_id', true);
do $$ begin
  assert exists (select 1 from realtime.messages where topic = realtime.topic()
    and payload - 'id' = '{"stage":"failed","message":"Failed during parse: Invalid compiler config"}'::jsonb);
end $$;
select set_config('realtime.topic', 'organization:org_progress_a:analyses', true);
do $$ begin
  assert (select count(*) from realtime.messages where topic = realtime.topic()) = 3;
  assert not has_function_privilege('authenticated', current_setting('test.trigger_function')::oid, 'execute');
  begin
    insert into realtime.messages (topic, extension, event, payload, private)
      values (realtime.topic(), 'broadcast', 'progress', '{"stage":"complete","message":"Spoofed"}', true);
    raise exception 'Expected client broadcast to be refused';
  exception when insufficient_privilege then null;
  end;
end $$;

set local request.jwt.claims = '{"o":{"id":"org_progress_b"}}';
do $$ begin
  assert (select count(*) from realtime.messages where topic = realtime.topic()) = 0,
    'Another organization can subscribe to dashboard events';
end $$;
select set_config('realtime.topic', 'analysis:' || current_setting('test.analysis_id'), true);
do $$ begin
  assert (select count(*) from realtime.messages where topic = realtime.topic()) = 0,
    'Another organization can subscribe to analysis events';
end $$;
select set_config('realtime.topic', 'analysis:invalid-id', true);
do $$ begin
  assert (select count(*) from realtime.messages where topic = realtime.topic()) = 0;
end $$;

select * from public.begin_analysis('https://github.com/cartograph/complete-test') \gset complete_
select set_config('realtime.topic', 'analysis:' || :'complete_id', true);
update public.analyses set stage = 'store', commit_sha = repeat('b', 40) where id = :'complete_id';
select public.store_analysis(:'complete_id', :'complete_started_at', '{"files":[],"edges":[],"imports":[],"coverage":{"filesFound":0,"filesParsed":0,"filesSkipped":0,"skipped":[],"importsSeen":0,"importsResolved":0,"importsOutside":0,"importsExcluded":0,"importsUnresolved":0}}');
select set_config('realtime.topic', 'analysis:' || :'complete_id', true);
do $$ begin
  assert exists (select 1 from realtime.messages where topic = realtime.topic()
    and payload - 'id' = '{"stage":"complete","message":"Analysis complete"}'::jsonb), 'Completion did not publish';
end $$;
reset role;
rollback;
