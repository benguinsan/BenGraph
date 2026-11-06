-- The status and the timestamps can't disagree, so no row can claim to be
-- complete without a finish time, or to have finished before it started.
-- A separate migration because the seeded rows had to be filled in first.
alter table public.analyses
  add constraint analyses_commit_sha_format check (commit_sha ~ '^[0-9a-f]{40}$'),
  add constraint analyses_started_unless_queued check ((status = 'queued') = (started_at is null)),
  add constraint analyses_finished_when_done check ((status in ('complete', 'failed')) = (finished_at is not null)),
  add constraint analyses_finished_after_start check (finished_at >= started_at);
