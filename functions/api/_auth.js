const enc = new TextEncoder();
const DAYS = 30;

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function sameString(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function makeAdminToken(env) {
  const exp = Date.now() + DAYS * 86400000;
  return `${exp}.${await hmac(env.ADMIN_PASSWORD, 'admin.' + exp)}`;
}

export async function makeNotesToken(env) {
  const exp = Date.now() + 7 * 86400000;
  return `${exp}.${await hmac(env.ADMIN_PASSWORD, 'notes.' + exp)}`;
}

export async function isNotesRequest(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sameString(await hmac(env.ADMIN_PASSWORD, 'notes.' + exp), sig);
}

export async function isAdminRequest(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sameString(await hmac(env.ADMIN_PASSWORD, 'admin.' + exp), sig);
}

// Project access passes. Opening a project with its code gives the browser a signed pass for that one
// project; every read and change of its posts must carry it (header X-Project-Access). Without a pass,
// or with a pass for a different project, nothing is returned. Passes last 90 days.
const PROJECT_DAYS = 90;
const projectSecret = env => env.PORTAL_SECRET || env.ADMIN_PASSWORD;

export async function makeProjectPass(env, planId) {
  const secret = projectSecret(env);
  if (!secret) return null;
  const exp = Date.now() + PROJECT_DAYS * 86400000;
  return `${exp}.${planId}.${await hmac(secret, 'project.' + planId + '.' + exp)}`;
}

// The project id this request's pass allows, or null.
export async function projectFromRequest(request, env) {
  const secret = projectSecret(env);
  if (!secret) return null;
  const pass = request.headers.get('x-project-access') || '';
  const parts = pass.split('.');
  if (parts.length !== 3) return null;
  const [exp, planId, sig] = parts;
  if (!exp || !planId || !sig || Number(exp) < Date.now()) return null;
  return sameString(await hmac(secret, 'project.' + planId + '.' + exp), sig) ? planId : null;
}
