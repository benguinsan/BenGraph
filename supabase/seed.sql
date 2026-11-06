-- Stand-in rows until Phase 7 creates real analyses. Organization ids are real
-- Clerk ids from the BenGraph development instance, so signing in to one shows
-- its rows and nothing else. Re-runnable: it clears what it inserted first.
-- Run as the database owner (SQL editor or MCP); RLS refuses these inserts
-- through the API on purpose.
-- Commit SHAs are synthetic (md5 of the URL), not real commits.

delete from public.organizations
where id in ('org_3LgWWZvV2nn5m0tntzgpibGilj7', 'org_3LgagnglZoO3dPxALjCq6HGdWEW');

insert into public.organizations (id) values
  ('org_3LgWWZvV2nn5m0tntzgpibGilj7'), -- benguinsan's Organization
  ('org_3LgagnglZoO3dPxALjCq6HGdWEW'); -- Test Organ, different repos so the lists can't be confused

with seed (org_id, repo_url, status, age) as (
  values
    ('org_3LgWWZvV2nn5m0tntzgpibGilj7', 'https://github.com/vercel/next.js', 'complete', interval '2 days'),
    ('org_3LgWWZvV2nn5m0tntzgpibGilj7', 'https://github.com/nestjs/nest', 'running', interval '1 minute'),
    ('org_3LgWWZvV2nn5m0tntzgpibGilj7', 'https://github.com/expressjs/express', 'failed', interval '3 hours'),
    ('org_3LgagnglZoO3dPxALjCq6HGdWEW', 'https://github.com/honojs/hono', 'complete', interval '5 hours'),
    ('org_3LgagnglZoO3dPxALjCq6HGdWEW', 'https://github.com/remix-run/react-router', 'queued', interval '10 seconds')
),
p as (
  insert into public.projects (org_id, repo_url)
  select org_id, repo_url from seed
  returning id, org_id, repo_url
)
insert into public.analyses (org_id, project_id, status, created_at, commit_sha, started_at, finished_at)
select p.org_id, p.id, s.status, now() - s.age,
  -- The failed run is meant to have died while fetching, so it never got a commit.
  case when s.status in ('running', 'complete') then md5(p.repo_url) || left(md5(p.repo_url || 'x'), 8) end,
  case when s.status <> 'queued' then now() - s.age + interval '2 seconds' end,
  case s.status
    when 'complete' then now() - s.age + interval '48 seconds'
    when 'failed' then now() - s.age + interval '5 seconds'
  end
from p join seed s on s.repo_url = p.repo_url;
