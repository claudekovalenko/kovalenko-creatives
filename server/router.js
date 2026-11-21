// Minimal router for the portal API.
import { HttpError } from './util.js';

// Tiny path matcher: match('/api/plans/:id', '/api/plans/abc') -> { id: 'abc' }
export function match(pattern, path) {
  const p = pattern.split('/');
  const s = path.split('/');
  if (p.length !== s.length) return null;
  const params = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) {
      if (!s[i]) return null;
      params[p[i].slice(1)] = decodeURIComponent(s[i]);
    } else if (p[i] !== s[i]) return null;
  }
  return params;
}

export async function route(ctx, table) {
  for (const [method, pattern, fn] of table) {
    if (method !== ctx.request.method) continue;
    const params = match(pattern, ctx.url.pathname);
    if (params) return fn(ctx, params);
  }
  throw new HttpError(404, 'Not found');
}
