// Deciding whether to notify the owner, and sending it to their phone. The owner's settings decide:
// urgent messages notify during studio hours (or any time, if the owner chose that), "soon" messages
// only if turned on, and nothing else ever pings. Every decision is logged, sent or held.
import { now } from './util.js';
import { getSettings, withinHours } from './settings.js';
import { sendPush } from './webpush.js';

export async function decide(db, urgency, date = new Date()) {
  const s = await getSettings(db);
  const open = withinHours(s, date);
  if (urgency === 'urgent') {
    if (s.notify_urgent === 'off') return { send: false, reason: 'Urgent notifications are turned off' };
    if (s.notify_urgent === 'hours' && !open) return { send: false, reason: 'Outside studio hours; shown on the dashboard instead' };
    return { send: true, reason: open ? 'Urgent, during studio hours' : 'Urgent, any time (your setting)' };
  }
  if (urgency === 'soon') {
    if (!s.notify_soon) return { send: false, reason: 'Notifications for "soon" messages are off' };
    if (!open) return { send: false, reason: 'Outside studio hours; shown on the dashboard instead' };
    return { send: true, reason: '"Soon", during studio hours' };
  }
  return { send: false, reason: 'Normal messages never notify' };
}

// Notify every device the owner turned notifications on for. Runs after the response is sent.
export function notifyOwnerLater(ctx, message) {
  const work = notifyOwner(ctx.env, ctx.db, message).catch(err => console.error('notify failed', err?.message));
  if (ctx.waitUntil) ctx.waitUntil(work);
  return work;
}

export async function notifyOwner(env, db, { title, body, url, urgency, force = false }) {
  const verdict = force ? { send: true, reason: 'Test notification' } : await decide(db, urgency);
  const subs = (await db.prepare(
    `SELECT s.* FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE u.role = 'owner' AND u.status = 'approved'`,
  ).all()).results;
  let sent = 0;
  let reason = verdict.reason;
  if (verdict.send) {
    if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) reason = 'Phone notifications are not set up (VAPID keys missing)';
    else if (!subs.length) reason = 'No device has notifications turned on';
    else {
      for (const sub of subs) {
        try {
          const status = env.PUSH_FN ? await env.PUSH_FN(sub, { title, body, url }) : await sendPush(env, sub, { title, body, url }, { urgency: urgency === 'urgent' ? 'high' : 'normal' });
          if (status === 404 || status === 410) await db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run();
          else if (status < 300) {
            sent++;
            await db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?').bind(now(), sub.endpoint).run();
          }
        } catch (err) {
          console.error('push failed', err?.message);
        }
      }
      if (!sent) reason = 'Sending failed; check notification settings on your phone';
    }
  }
  await db.prepare('INSERT INTO notifications (title, body, url, urgency, sent, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(title.slice(0, 200), body.slice(0, 500), url, urgency || 'normal', sent ? 1 : 0, reason, now()).run();
  return { sent, reason };
}
