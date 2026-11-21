// Makes the key pair the portal uses to send phone notifications (Web Push "VAPID" keys).
// Run once: `node tools/vapid-keys.mjs`, then put both values in the portal's Cloudflare settings:
// VAPID_PUBLIC_KEY as text and VAPID_PRIVATE_KEY as an encrypted secret. Never commit them.
const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', keys.publicKey)).toString('base64url');
const { d } = await crypto.subtle.exportKey('jwk', keys.privateKey);
console.log(`VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${d}`);
