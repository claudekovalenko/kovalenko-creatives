import { makeAdminToken, sameString } from './_auth.js';

export async function onRequestPost({ request, env }) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: 'The admin password has not been set up in Cloudflare yet.' }, 503);
  }
  let data;
  try { data = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  await new Promise(r => setTimeout(r, 400));
  if (!sameString(String(data.password || ''), env.ADMIN_PASSWORD)) {
    return json({ error: 'That password is incorrect.' }, 401);
  }
  return json({ token: await makeAdminToken(env) });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
