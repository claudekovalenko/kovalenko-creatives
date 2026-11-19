#!/bin/sh
# Database rules test for the client portal: loads supabase/portal.sql into a throwaway local
# Postgres (with a small stand-in for Supabase's auth schema) and checks who can see and change what.
# Needs Postgres installed locally (initdb, pg_ctl, psql). Run: npm run test:db
set -e
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}
[ -n "$PGBIN" ] && PATH="$PGBIN:$PATH"
DIR=$(mktemp -d)
trap 'pg_ctl -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
RUNAS=""
[ "$(id -u)" = 0 ] && { chown -R postgres "$DIR"; RUNAS="runuser -u postgres --"; }
$RUNAS initdb -D "$DIR/data" -A trust -U postgres >/dev/null
$RUNAS pg_ctl -D "$DIR/data" -o "-k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL="psql -h $DIR -U postgres -v ON_ERROR_STOP=1 -q"
$PSQL <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
$PSQL -f supabase/portal.sql
$PSQL -f tools/portal-db-test.sql
echo "Database rules test passed."
