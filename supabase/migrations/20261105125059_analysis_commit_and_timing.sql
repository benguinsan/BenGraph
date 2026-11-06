-- Which commit an analysis read, and when its run started and finished.
-- created_at stays: it is when the analysis was asked for, which is before it
-- starts. All three are null until the run gets that far.
alter table public.analyses
  add column commit_sha text,
  add column started_at timestamptz,
  add column finished_at timestamptz;
