// Start "Continue with Google": send the visitor to Google with a one-time state and PKCE check.
import { googleReady, randomToken, setCookie, STATE_COOKIE } from '../_members.js';

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  if (!googleReady(env)) return Response.redirect(`${url.origin}/portal/?signin=unavailable`, 302);
  const state = randomToken(24);
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/api/auth/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      'Set-Cookie': setCookie(STATE_COOKIE, `${state}.${verifier}`, 600),
      'Cache-Control': 'no-store',
    },
  });
}
