// Cloudflare Pages Function: every request under /api goes to the portal server (server/app.js).
import { handle } from '../../server/app.js';

export const onRequest = ({ request, env }) => handle(request, env);
