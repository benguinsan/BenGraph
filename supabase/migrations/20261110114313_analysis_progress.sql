-- These topic policies declare the private per-analysis and dashboard channels.
-- Realtime owns this schema; only its supported policies belong here.
create policy "members receive analysis progress" on realtime.messages
  for select to authenticated using (
    extension = 'broadcast' and exists (
      select 1 from public.analyses a
      where (select realtime.topic()) = 'analysis:' || a.id::text
    )
  );
create policy "members receive dashboard progress" on realtime.messages
  for select to authenticated using (
    extension = 'broadcast' and
    (select realtime.topic()) = 'organization:' || (select public.requesting_org_id()) || ':analyses'
  );

create schema if not exists private;
revoke all on schema private from public;

-- Only the table trigger can publish; clients receive without send privileges.
create function private.broadcast_analysis_progress()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  v_stage text;
  v_message text;
  v_payload jsonb;
begin
  if tg_op = 'UPDATE' and
    (new.stage, new.status, new.message, new.error) is not distinct from
    (old.stage, old.status, old.message, old.error) then
    return null;
  end if;
  v_stage := case when new.status = 'running' then coalesce(new.stage, 'running') else new.status end;
  v_message := case when new.status = 'failed'
    then 'Failed during ' || coalesce(new.stage, 'run') || ': ' || coalesce(new.error, new.message, 'No failure reason recorded')
    else coalesce(new.message, case new.status when 'queued' then 'Waiting to start' when 'complete' then 'Analysis complete' else 'Run started; no stage recorded' end)
    end;
  v_payload := jsonb_build_object('stage', v_stage, 'message', v_message);
  perform realtime.send(v_payload, 'progress', 'analysis:' || new.id::text, true);
  perform realtime.send(v_payload, 'progress', 'organization:' || new.org_id || ':analyses', true);
  return null;
end;
$$;
revoke all on function private.broadcast_analysis_progress() from public, anon, authenticated;

create trigger broadcast_analysis_progress
  after insert or update on public.analyses
  for each row execute function private.broadcast_analysis_progress();
