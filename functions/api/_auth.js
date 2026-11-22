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

export async function isAdminRequest(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sameString(await hmac(env.ADMIN_PASSWORD, 'admin.' + exp), sig);
}
