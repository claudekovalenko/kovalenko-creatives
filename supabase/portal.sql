-- Kovalenko Creatives client portal: database schema for a Supabase project.
-- Paste into the Supabase SQL editor once. It only creates new objects; it changes nothing that exists.
--
-- Who can do what (enforced here, by Row Level Security, not by the page):
--   * Anyone can sign in with Google. They start as 'pending' and see nothing until the owner approves them.
--   * Approved people see only the projects the owner added them to (clients and collaborators alike).
--   * Approved members post requests and comments on their projects; these show immediately to the project.
--   * Only the owner changes statuses, hides posts, manages people and projects, and approves agent changes.
--   * The bots use the service-role key from GitHub Actions secrets, never from the browser.
--
-- After your first sign-in, make yourself the owner (SQL editor, with your own Google email):
--   update public.profiles set access = 'approved', is_owner = true where email = 'YOUR-GOOGLE-EMAIL';

create type public.portal_access as enum ('pending', 'approved', 'blocked');
create type public.request_status as enum ('new', 'accepted', 'declined', 'in_progress', 'review', 'live');
create type public.agent_status as enum ('queued', 'working', 'ready', 'approved', 'rejected', 'merged', 'failed');

-- One row per person who has signed in. Identity itself stays in Supabase Auth (auth.users).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  access public.portal_access not null default 'pending',
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.projects (
  id bigint generated always as identity primary key,
  name text not null check (length(btrim(name)) between 1 and 120),
  description text not null default '' check (length(description) <= 2000),
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Where a project's code lives, for the agent. Owner only: members never see repository names.
create table public.project_repos (
  project_id bigint primary key references public.projects (id) on delete cascade,
  repo text not null check (repo ~ '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'),
  production_branch text not null default 'main' check (production_branch ~ '^[A-Za-z0-9_./-]+$'),
  -- Preview address for a branch; {branch} is replaced, e.g. https://{branch}.my-site.pages.dev
  preview_url_template text check (preview_url_template is null or preview_url_template ~ '^https://[^\s]*\{branch\}[^\s]*$')
);

create table public.project_members (
  project_id bigint not null references public.projects (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

create table public.requests (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id),
  author_id uuid not null references public.profiles (id),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null default '' check (length(body) <= 5000),
  status public.request_status not null default 'new',
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index requests_project_idx on public.requests (project_id, created_at desc);
create index requests_status_idx on public.requests (status);

create table public.comments (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.requests (id),
  author_id uuid not null references public.profiles (id),
  body text not null check (length(btrim(body)) between 1 and 5000),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_request_idx on public.comments (request_id, created_at);

-- One attempt by the agent at one request: a branch and pull request waiting for the owner's decision.
create table public.agent_runs (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.requests (id),
  status public.agent_status not null default 'queued',
  branch text,
  pr_number integer,
  pr_url text,
  preview_url text,
  summary text not null default '',
  error text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- At most one unfinished attempt per request.
create unique index agent_runs_one_open on public.agent_runs (request_id)
  where status in ('queued', 'working', 'ready', 'approved');

-- The weekly per-project summaries the digest bot writes. Owner only.
create table public.digests (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  body text not null,
  created_at timestamptz not null default now()
);
create index digests_project_idx on public.digests (project_id, created_at desc);

-- ── Helpers used by the policies (security definer so they can read profiles without recursion) ──

create function public.portal_is_owner() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_owner and p.access = 'approved' from public.profiles p where p.id = auth.uid()), false)
$$;

create function public.portal_is_approved() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.access = 'approved' from public.profiles p where p.id = auth.uid()), false)
$$;

create function public.portal_is_member(p_project bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.portal_is_approved() and exists (
    select 1 from public.project_members m
    join public.projects pr on pr.id = m.project_id
    where m.project_id = p_project and m.user_id = auth.uid() and not pr.archived)
$$;

create function public.portal_can_see_request(p_request bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.requests r
    where r.id = p_request
      and (public.portal_is_owner() or (not r.hidden and public.portal_is_member(r.project_id))))
$$;

revoke execute on function public.portal_is_owner(), public.portal_is_approved(),
  public.portal_is_member(bigint), public.portal_can_see_request(bigint) from public, anon;
grant execute on function public.portal_is_owner(), public.portal_is_approved(),
  public.portal_is_member(bigint), public.portal_can_see_request(bigint) to authenticated;

-- ── Triggers ──

-- A profile is created, as pending, the first time someone signs in.
create function public.portal_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, coalesce(new.email, ''),
          left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 120))
  on conflict (id) do nothing;
  return new;
end $$;
create trigger portal_on_new_user after insert on auth.users
  for each row execute function public.portal_new_user();

create function public.portal_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
create trigger requests_touch before update on public.requests for each row execute function public.portal_touch();
create trigger agent_runs_touch before update on public.agent_runs for each row execute function public.portal_touch();

-- From the browser, the owner may only approve or reject a change that is ready; nothing else about a run.
-- Rejecting hands the request back to the owner as 'in_progress'. The bots (service role) are not limited.
create function public.portal_agent_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    if old.status <> 'ready' or new.status not in ('approved', 'rejected')
       or row(new.request_id, new.branch, new.pr_number, new.pr_url, new.preview_url, new.summary, new.error)
          is distinct from row(old.request_id, old.branch, old.pr_number, old.pr_url, old.preview_url, old.summary, old.error) then
      raise exception 'Only a ready change can be approved or rejected';
    end if;
    if new.status = 'rejected' then
      update public.requests set status = 'in_progress' where id = new.request_id and status = 'review';
    end if;
  end if;
  return new;
end $$;
create trigger agent_runs_guard before update on public.agent_runs for each row execute function public.portal_agent_guard();

-- ── Names of people you share a project with (no emails), for showing who wrote what ──

create view public.portal_people with (security_barrier) as
  select p.id, p.full_name from public.profiles p
  where p.id = auth.uid()
     or public.portal_is_owner()
     or (public.portal_is_approved() and exists (
          select 1 from public.project_members a
          join public.project_members b on a.project_id = b.project_id
          where a.user_id = auth.uid() and b.user_id = p.id));
revoke all on public.portal_people from public, anon;
grant select on public.portal_people to authenticated;

-- ── Row Level Security ──

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_repos enable row level security;
alter table public.project_members enable row level security;
alter table public.requests enable row level security;
alter table public.comments enable row level security;
alter table public.agent_runs enable row level security;
alter table public.digests enable row level security;

-- Signed-out visitors get nothing at all.
revoke all on public.profiles, public.projects, public.project_repos, public.project_members,
  public.requests, public.comments, public.agent_runs, public.digests from anon;

create policy "see own profile, owner sees all" on public.profiles for select to authenticated
  using (id = auth.uid() or public.portal_is_owner());
create policy "owner manages people" on public.profiles for update to authenticated
  using (public.portal_is_owner()) with check (public.portal_is_owner());

create policy "members see their projects" on public.projects for select to authenticated
  using (public.portal_is_owner() or public.portal_is_member(id));
create policy "owner adds projects" on public.projects for insert to authenticated
  with check (public.portal_is_owner());
create policy "owner edits projects" on public.projects for update to authenticated
  using (public.portal_is_owner()) with check (public.portal_is_owner());

create policy "owner manages repos" on public.project_repos for all to authenticated
  using (public.portal_is_owner()) with check (public.portal_is_owner());

create policy "see own memberships" on public.project_members for select to authenticated
  using (public.portal_is_owner() or user_id = auth.uid());
create policy "owner adds members" on public.project_members for insert to authenticated
  with check (public.portal_is_owner());
create policy "owner removes members" on public.project_members for delete to authenticated
  using (public.portal_is_owner());

create policy "members see requests" on public.requests for select to authenticated
  using (public.portal_is_owner() or (not hidden and public.portal_is_member(project_id)));
create policy "members post requests" on public.requests for insert to authenticated
  with check (author_id = auth.uid() and status = 'new' and not hidden
              and (public.portal_is_member(project_id) or public.portal_is_owner()));
create policy "owner updates requests" on public.requests for update to authenticated
  using (public.portal_is_owner()) with check (public.portal_is_owner());

create policy "members see comments" on public.comments for select to authenticated
  using (public.portal_is_owner() or (not hidden and public.portal_can_see_request(request_id)));
create policy "members comment" on public.comments for insert to authenticated
  with check (author_id = auth.uid() and not hidden and public.portal_can_see_request(request_id));
create policy "owner hides comments" on public.comments for update to authenticated
  using (public.portal_is_owner()) with check (public.portal_is_owner());

create policy "owner sees agent runs" on public.agent_runs for select to authenticated
  using (public.portal_is_owner());
create policy "owner decides agent runs" on public.agent_runs for update to authenticated
  using (public.portal_is_owner()) with check (public.portal_is_owner());

create policy "owner reads digests" on public.digests for select to authenticated
  using (public.portal_is_owner());

-- Members may only change a row's content through the columns the policies above allow:
-- requests and comments can be inserted with these columns only (status, hidden and ids come from defaults).
revoke insert on public.requests, public.comments from authenticated;
grant insert (project_id, author_id, title, body) on public.requests to authenticated;
grant insert (request_id, author_id, body) on public.comments to authenticated;
-- The owner changes only these columns from the browser.
revoke update on public.profiles, public.requests, public.comments, public.agent_runs from authenticated;
grant update (access, is_owner, full_name) on public.profiles to authenticated;
grant update (status, hidden) on public.requests to authenticated;
grant update (hidden) on public.comments to authenticated;
grant update (status) on public.agent_runs to authenticated;
