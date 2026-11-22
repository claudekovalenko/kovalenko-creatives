import { isAdminRequest, makeNotesToken } from './_auth.js';

export async function onRequestPost({ request, env }) {
  if (!(await isAdminRequest(request, env))) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ token: await makeNotesToken(env) }), { headers: { 'Content-Type': 'application/json' } });
}
