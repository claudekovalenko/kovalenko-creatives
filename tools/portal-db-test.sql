-- Checks for supabase/portal.sql, run by tools/portal-db-test.sh against a throwaway database.
-- People: owner, member (project A), collaborator (projects A and B), outsider (approved, no projects), pending.

create function pg_temp.ok(cond boolean, label text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'FAIL: %', label; end if; raise notice 'ok  %', label; end $$;
create function pg_temp.refused(stmt text, label text) returns void language plpgsql as $$
declare n bigint;
begin
  begin execute stmt; get diagnostics n = row_count;
  exception when others then raise notice 'ok  % (refused: %)', label, sqlerrm; return; end;
  if n = 0 then raise notice 'ok  % (no rows changed)', label; return; end if;
  raise exception 'FAIL: % (it was allowed)', label;
end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
set client_min_messages = notice;
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com', '{"full_name":"Owner"}'),
  ('00000000-0000-0000-0000-00000000000b', 'member@example.com', '{"full_name":"Member"}'),
  ('00000000-0000-0000-0000-00000000000c', 'collab@example.com', '{"name":"Collaborator"}'),
  ('00000000-0000-0000-0000-00000000000d', 'outsider@example.com', '{}'),
  ('00000000-0000-0000-0000-00000000000e', 'pending@example.com', '{}');
select pg_temp.ok((select count(*) = 5 and bool_and(access = 'pending') from public.profiles), 'signing in creates a pending profile');
select pg_temp.ok((select full_name from public.profiles where email = 'collab@example.com') = 'Collaborator', 'name comes from Google');

update public.profiles set access = 'approved', is_owner = true where email = 'owner@example.com';
update public.profiles set access = 'approved' where email in ('member@example.com', 'collab@example.com', 'outsider@example.com');
insert into public.projects (name) values ('Project A'), ('Project B');
insert into public.project_repos (project_id, repo) values (1, 'someone/project-a');
insert into public.project_members values (1, '00000000-0000-0000-0000-00000000000b'), (1, '00000000-0000-0000-0000-00000000000c'), (2, '00000000-0000-0000-0000-00000000000c');

-- Signed out
set role anon;
select pg_temp.refused('select * from public.projects', 'signed out: cannot read projects');
reset role;

-- Pending person
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000e';
select pg_temp.ok((select count(*) from public.projects) = 0, 'pending: sees no projects');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'pending: sees only their own profile');
select pg_temp.refused($$insert into public.requests (project_id, author_id, title) values (1, '00000000-0000-0000-0000-00000000000e', 'x')$$, 'pending: cannot post a request');
select pg_temp.refused($$update public.profiles set access = 'approved' where id = auth.uid()$$, 'pending: cannot approve themselves');
reset role;

select setval(pg_get_serial_sequence('public.requests', 'id'), 1, false);

-- Member of project A
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select array_agg(name) from public.projects) = '{"Project A"}', 'member: sees only their project');
select pg_temp.ok((select count(*) from public.project_repos) = 0, 'member: cannot see repository names');
insert into public.requests (project_id, author_id, title, body) values (1, auth.uid(), 'Change the hero photo', 'Use the new one');
select pg_temp.ok((select status from public.requests where id = 1) = 'new', 'member: posts a request, status new');
select pg_temp.refused($$insert into public.requests (project_id, author_id, title) values (2, auth.uid(), 'x')$$, 'member: cannot post to a project they are not in');
select pg_temp.refused($$insert into public.requests (project_id, author_id, title) values (1, '00000000-0000-0000-0000-00000000000c', 'x')$$, 'member: cannot post as someone else');
select pg_temp.refused($$insert into public.requests (project_id, author_id, title, status) values (1, auth.uid(), 'x', 'accepted')$$, 'member: cannot set a status');
select pg_temp.refused($$update public.requests set status = 'accepted' where id = 1$$, 'member: cannot accept requests');
insert into public.comments (request_id, author_id, body) values (1, auth.uid(), 'Photo attached below');
select pg_temp.ok((select count(*) from public.profiles) = 1, 'member: cannot list other profiles (emails stay private)');
select pg_temp.ok((select count(*) from public.portal_people) = 2, 'member: sees names of people in shared projects');
select pg_temp.ok(not exists (select 1 from public.portal_people where full_name = 'Owner'), 'member: does not see unrelated people');
select pg_temp.refused('select * from public.agent_runs', 'member: cannot read agent runs');
reset role;

-- Collaborator on A and B
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) from public.projects) = 2, 'collaborator: sees both their projects');
select pg_temp.ok((select count(*) from public.requests) = 1 and (select count(*) from public.comments) = 1, 'collaborator: sees the request and comment on A');
reset role;

-- Approved outsider
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000d';
select pg_temp.ok((select count(*) from public.projects) = 0 and (select count(*) from public.requests) = 0, 'outsider: sees nothing without a project');
select pg_temp.refused($$insert into public.comments (request_id, author_id, body) values (1, auth.uid(), 'hi')$$, 'outsider: cannot comment on others'' requests');
reset role;

-- Owner
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.ok((select count(*) from public.profiles) = 5, 'owner: sees everyone');
update public.requests set status = 'accepted' where id = 1;
update public.comments set hidden = true where id = 1;
select pg_temp.ok((select status from public.requests where id = 1) = 'accepted', 'owner: accepts a request');
reset role;

set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) from public.comments) = 0, 'member: hidden comment disappears');
reset role;

-- Agent run: the bot (service role) prepares a change; the owner can only approve or reject it when ready.
set role service_role;
insert into public.agent_runs (request_id, status, branch, pr_number, pr_url) values (1, 'working', 'portal/request-1', 7, 'https://github.com/someone/project-a/pull/7');
reset role;
select pg_temp.refused($$insert into public.agent_runs (request_id) values (1)$$, 'only one unfinished run per request');
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.refused($$update public.agent_runs set status = 'approved' where id = 1$$, 'owner: cannot approve a run that is not ready');
reset role;
update public.agent_runs set status = 'ready' where id = 1;
update public.requests set status = 'review' where id = 1;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.refused($$update public.agent_runs set pr_url = 'https://evil.example.com' where id = 1$$, 'owner: cannot rewrite a run''s pull request');
update public.agent_runs set status = 'rejected' where id = 1;
select pg_temp.ok((select status from public.requests where id = 1) = 'in_progress', 'rejecting a change returns the request to the owner');
reset role;

-- Blocked people lose access straight away
update public.profiles set access = 'blocked' where email = 'collab@example.com';
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.ok((select count(*) from public.projects) = 0, 'blocked: sees nothing');
reset role;

-- Archived projects disappear for members
update public.projects set archived = true where id = 1;
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.ok((select count(*) from public.projects) = 0 and (select count(*) from public.requests) = 0, 'archived: members no longer see it');
reset role;
