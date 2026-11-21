// Entry point for everything under /api and /auth. Cloudflare Pages Functions call handle()
// (see functions/), and so does the local dev server (tools/dev-server.mjs).
import { HttpError, json } from './util.js';
import { authRoutes, currentUser } from './auth.js';
import { memberRoutes } from './members.js';
import { adminRoutes } from './admin.js';
import { agentRoutes, currentAgent } from './agents.js';

export async function handle(request, env, waitUntil) {
  const url = new URL(request.url);
  try {
    if (!env.DB) throw new HttpError(503, 'The portal database is not connected yet');
    if (url.pathname.startsWith('/auth/')) {
      if (request.method === 'POST') checkSameOrigin(request, url);
      return await authRoutes(request, env, url);
    }
    if (url.pathname.startsWith('/api/agent/')) {
      const agent = await currentAgent(request, env);
      return await agentRoutes({ request, env, url, agent, db: env.DB });
    }
    if (url.pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(request.method)) checkSameOrigin(request, url);
      const user = await currentUser(request, env);
      const ctx = { request, env, url, user, db: env.DB, waitUntil };
      if (url.pathname.startsWith('/api/admin/')) return await adminRoutes(ctx);
      return await memberRoutes(ctx);
    }
    throw new HttpError(404, 'Not found');
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}

// Cross-site request forgery guard for cookie-authenticated changes: the browser must say the
// request came from this site. (Cookies are also SameSite=Lax.)
function checkSameOrigin(request, url) {
  const origin = request.headers.get('origin');
  if (origin ? origin === url.origin : request.headers.get('sec-fetch-site') === 'same-origin') return;
  throw new HttpError(403, 'Request refused: it did not come from this site');
}
