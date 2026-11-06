-- Cartograph's first schema. Every row belongs to an organization, and the only
-- thing that decides who may read it is a policy comparing that organization to
-- the `o.id` claim on the caller's Clerk session token.

-- RLS on by default, not per table. A table with RLS and no policy returns
-- nothing, which someone notices; a table without RLS returns everything, which
-- nobody notices. This trigger makes the second case impossible for any table
-- created in `public` from here on, including in later migrations.
create function public.enable_rls_on_new_table()
returns event_trigger
language plpgsql
as $$
declare
  obj record;
begin
  for obj in
    select * from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and schema_name = 'public'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
  end loop;
end;
$$;

create event trigger enable_rls_on_new_table
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function public.enable_rls_on_new_table();

-- The caller's active Clerk organization. Wrapped in a function so every policy
-- reads it the same way; `stable` lets Postgres evaluate it once per statement.
create function public.requesting_org_id()
returns text
language sql
stable
as $$
  select auth.jwt() -> 'o' ->> 'id'
$$;

-- The FK target for every other table. Its id is the Clerk organization id;
-- Clerk stays the owner of the organization itself.
-- shortcut: rows here come from the seed and are not removed when Clerk deletes an
-- org; add a Clerk webhook that inserts/deletes them once real orgs need rows.
create table public.organizations (
  id text primary key,
  created_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  repo_url text not null,
  created_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'complete', 'failed')),
  created_at timestamptz not null default now()
);

create table public.files (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  path text not null,
  unique (analysis_id, path)
);

create table public.edges (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  source_file_id uuid not null references public.files (id) on delete cascade,
  target_file_id uuid not null references public.files (id) on delete cascade
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  method text not null,
  path text not null
);

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  role text not null
);

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  org_id text not null references public.organizations (id) on delete cascade,
  analysis_id uuid not null references public.analyses (id) on delete cascade,
  kind text not null
);

-- Postgres does not index foreign keys. Every policy filters on org_id, and
-- cascading deletes look rows up by their parent id.
create index on public.projects (org_id);
create index on public.analyses (org_id, created_at desc);
create index on public.analyses (project_id);
create index on public.files (org_id);
create index on public.edges (org_id);
create index on public.edges (analysis_id);
create index on public.edges (source_file_id);
create index on public.edges (target_file_id);
create index on public.routes (org_id);
create index on public.routes (analysis_id);
create index on public.routes (file_id);
create index on public.explanations (org_id);
create index on public.explanations (file_id);
create index on public.file_roles (org_id);
create index on public.file_roles (file_id);
create index on public.insights (org_id);
create index on public.insights (analysis_id);

-- Read access only. Nothing writes through the API yet, so there are no insert,
-- update or delete policies, and those operations are refused.
create policy "members read their organization" on public.organizations
  for select to authenticated using (id = (select public.requesting_org_id()));

create policy "members read their organization" on public.projects
  for select to authenticated using (org_id = (select public.requesting_org_id()));
create policy "members read their organization" on public.analyses
  for select to authenticated using (org_id = (select public.requesting_org_id()));
create policy "members read their organization" on public.files
  for select to authenticated using (org_id = (select public.requesting_org_id()));
create policy "members read their organization" on public.edges
  for select to authenticated using (org_id = (select public.requesting_org_id()));
create policy "members read their organization" on public.routes
  for select to authenticated using (org_id = (select public.requesting_org_id()));
create policy "members read their organization" on public.explanations
  for select to authenticated using (org_id = (select public.requesting_org_id()));
create policy "members read their organization" on public.file_roles
  for select to authenticated using (org_id = (select public.requesting_org_id()));
create policy "members read their organization" on public.insights
  for select to authenticated using (org_id = (select public.requesting_org_id()));
