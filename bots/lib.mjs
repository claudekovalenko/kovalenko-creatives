// Shared helpers for the portal bots: Supabase (service role, server side only) and GitHub.
// Keep logs free of request text, names and emails: Actions logs can be read by anyone who can see the repository.
import { execFileSync } from 'node:child_process';

export function need(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function supabase() {
  const base = need('SUPABASE_URL').replace(/\/+$/, '');
  const key = need('SUPABASE_SERVICE_ROLE_KEY');
  return async (table, query = '', { method = 'GET', body, prefer } = {}) => {
    const headers = { apikey: key, Authorization: `Bearer ${key}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${base}/rest/v1/${table}${query ? `?${query}` : ''}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new Error(`Database ${method} ${table} failed (${res.status})`);
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}

export function github() {
  const base = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const token = need('PORTAL_GITHUB_TOKEN');
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 404) throw new Error(`GitHub ${method} ${path.split('?')[0]} failed (${res.status})`);
    if (res.status === 404) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
}

// Runs git with the token as a one-off header, so it is never written to .git/config where the agent could read it.
export function git(args, cwd) {
  const token = process.env.PORTAL_GITHUB_TOKEN || '';
  const auth = token ? ['-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`] : [];
  return execFileSync('git', [...auth, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export const repoUrl = repo => `${(process.env.GIT_BASE_URL || 'https://github.com').replace(/\/+$/, '')}/${repo}.git`;

// Cloudflare Pages names a branch preview after the branch: lowercase, anything else becomes '-'.
export function previewUrl(template, branch) {
  if (!template) return null;
  const slug = branch.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28).replace(/-$/, '');
  return template.replace('{branch}', slug);
}

export const log = msg => console.log(`[${new Date().toISOString()}] ${msg}`);
