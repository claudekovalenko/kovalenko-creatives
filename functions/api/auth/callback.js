// Google sends people back here. Check the one-time state, swap the code for Google's ID token,
// check it is genuine and for this site, then sign them in (creating their account the first time).
import { cookies, ensureMemberTables, googleReady, setCookie, startSession, STATE_COOKIE } from '../_members.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const back = (q) => {
    const headers = new Headers({ Location: `${url.origin}/portal/${q}`, 'Cache-Control': 'no-store' });
    headers.append('Set-Cookie', setCookie(STATE_COOKIE, '', 0));
    return headers;
  };
  if (!googleReady(env)) return new Response(null, { status: 302, headers: back('?signin=unavailable') });
  if (url.searchParams.get('error')) return new Response(null, { status: 302, headers: back('?signin=cancelled') });
  const [state, verifier] = (cookies(request)[STATE_COOKIE] || '').split('.');
  if (!state || state !== url.searchParams.get('state') || !url.searchParams.get('code')) {
    return new Response(null, { status: 302, headers: back('?signin=failed') });
  }
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: url.searchParams.get('code'),
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: `${url.origin}/api/auth/callback`,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    if (!res.ok) throw new Error('token exchange failed');
    const { id_token } = await res.json();
    // Received directly from Google over TLS, so its claims can be read; still check audience, issuer and expiry.
    const part = id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part + '='.repeat((4 - part.length % 4) % 4)), c => c.charCodeAt(0))));
    if (claims.aud !== env.GOOGLE_CLIENT_ID || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.exp * 1000 < Date.now()) throw new Error('bad token');
    if (!claims.email || claims.email_verified !== true) throw new Error('email not verified');
    const email = claims.email.toLowerCase();
    const name = String(claims.name || claims.given_name || email.split('@')[0]).slice(0, 80);
    await ensureMemberTables(env.DB);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO portal_members (email, name, google_sub, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (email) DO UPDATE SET name = excluded.name, google_sub = excluded.google_sub, last_seen_at = excluded.last_seen_at`,
    ).bind(email, name, claims.sub, now, now).run();
    const headers = back('');
    headers.append('Set-Cookie', await startSession(env, email));
    return new Response(null, { status: 302, headers });
  } catch {
    return new Response(null, { status: 302, headers: back('?signin=failed') });
  }
}
