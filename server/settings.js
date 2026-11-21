// The owner's availability settings. Defaults keep the owner off call: notifications only for
// urgent messages and only during studio hours, and no texting until the owner turns it on.
import { HttpError, now, text, oneOf } from './util.js';

export const DEFAULTS = {
  timezone: 'America/Los_Angeles',
  hours_start: '09:00',
  hours_end: '17:00',
  days: [1, 2, 3, 4, 5], // Monday to Friday (0 = Sunday)
  notify_urgent: 'hours', // 'always' | 'hours' | 'off'
  notify_soon: false, // also notify for "soon" messages (during hours only)
  text_enabled: false, // offer "text the studio" after an urgent message
  text_phone: '',
  text_hours_only: true,
};

export async function getSettings(db) {
  const rows = (await db.prepare('SELECT key, value FROM settings').all()).results;
  const out = { ...DEFAULTS };
  for (const r of rows) {
    if (r.key in DEFAULTS) {
      try { out[r.key] = JSON.parse(r.value); } catch { /* keep default */ }
    }
  }
  return out;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveSettings(db, body) {
  const next = {};
  if (body.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); } catch { throw new HttpError(400, 'Unknown time zone'); }
    next.timezone = body.timezone;
  }
  for (const k of ['hours_start', 'hours_end']) {
    if (body[k] !== undefined) {
      if (!TIME.test(body[k])) throw new HttpError(400, 'Hours must look like 09:00');
      next[k] = body[k];
    }
  }
  if (body.days !== undefined) {
    if (!Array.isArray(body.days) || body.days.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new HttpError(400, 'Days must be numbers 0 to 6');
    next.days = [...new Set(body.days)].sort();
  }
  if (body.notify_urgent !== undefined) next.notify_urgent = oneOf(body.notify_urgent, ['always', 'hours', 'off'], 'notify_urgent');
  for (const k of ['notify_soon', 'text_enabled', 'text_hours_only']) if (body[k] !== undefined) next[k] = !!body[k];
  if (body.text_phone !== undefined) {
    const phone = text(body.text_phone, 'Phone', { max: 30, required: false });
    if (phone && !/^\+?[\d\s().-]{7,}$/.test(phone)) throw new HttpError(400, 'Phone must be a number like +1 555 123 4567');
    next.text_phone = phone;
  }
  const merged = { ...(await getSettings(db)), ...next };
  if (merged.text_enabled && !merged.text_phone) throw new HttpError(400, 'Add a phone number before turning on texting');
  for (const [k, v] of Object.entries(next)) {
    await db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(k, JSON.stringify(v), now()).run();
  }
  return merged;
}

// Is it studio hours right now, in the owner's time zone?
export function withinHours(s, date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: s.timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(date).map(p => [p.type, p.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return s.days.includes(day) && minutes >= toMin(s.hours_start) && minutes < toMin(s.hours_end);
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function hoursText(s) {
  const d = s.days;
  const days = d.join() === '1,2,3,4,5' ? 'Monday to Friday' : d.join() === '0,1,2,3,4,5,6' ? 'every day' : d.map(i => DAY_NAMES[i]).join(', ');
  const fmt = t => {
    const [h, m] = t.split(':').map(Number);
    return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
  };
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: s.timezone, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || s.timezone;
  return `${days}, ${fmt(s.hours_start)} to ${fmt(s.hours_end)} ${zone}`;
}

// What a member may be offered after sending an urgent message.
export function contactFor(s, date = new Date()) {
  const open = withinHours(s, date);
  const canText = s.text_enabled && !!s.text_phone && (!s.text_hours_only || open);
  return { open, hours: hoursText(s), text_phone: canText ? s.text_phone : null };
}
