// End-to-end QA bot for website notes + portal Site notes tab.
// Usage: node qa/site-notes.mjs   (needs `playwright` installed where node can resolve it)
import { chromium } from 'playwright';

const SITE = process.env.SITE || 'https://faith-journey-funnel.faith-journey-funnel.workers.dev/';
const PORTAL = process.env.PORTAL || 'https://kovalenko-creatives.pages.dev';
const CODE = process.env.CODE || 'JPN2026';
const API = `${PORTAL}/api/posts`;
const results = [];
const created = [];
let failed = 0;

function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
}

const PASS = (await (await fetch(`${PORTAL}/api/projects?code=${CODE}`)).json()).access;
const H = { 'X-Project-Access': PASS };
async function notes() {
  return (await fetch(`${API}?plan_id=jpn-mvp&kind=sitenote`, { cache: 'no-store', headers: H })).json();
}
async function replies(id) {
  return (await (await fetch(`${API}?plan_id=jpn-mvp&kind=message&task_id=${id}`, { headers: H })).json());
}

async function leaveNote(page, name, text) {
  await page.getByRole('button', { name: /Leave a note/ }).click();
  await page.locator('h1').first().click();
  const card = page.locator('#kcn-card');
  await card.waitFor();
  const nameBox = card.getByPlaceholder('Your name');
  if (await nameBox.count()) await nameBox.fill(name);
  await card.locator('textarea').fill(text);
  await card.getByRole('button', { name: 'Save note' }).click();
  await card.waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
  const err = await page.locator('.kcn-err').textContent().catch(() => null);
  return err;
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
try {
  // 1. Normal visitor: nothing shows, no errors, Escape is harmless.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(SITE);
    await page.waitForTimeout(1500);
    check('normal visitor sees no note button', (await page.locator('#kcn-btn').count()) === 0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    check('normal visitor has no script errors', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 2. Client leaves a note from the review link.
  const stamp = Date.now();
  let noteId = null;
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${SITE}?kcnotes=${CODE}`);
    await page.getByRole('button', { name: /Leave a note/ }).waitFor({ timeout: 8000 });
    check('review link shows note button', true);
    const err = await leaveNote(page, 'QA Bot', `QA bot note ${stamp}`);
    check('client note saves without error', !err, err || '');
    const saved = (await notes()).find(n => n.body.includes(`QA bot note ${stamp}`));
    check('client note stored in portal', !!saved, saved ? saved.author_name : '');
    if (saved) { noteId = saved.id; created.push([saved.id, 'QA Bot']); }
    await page.waitForTimeout(500);
    check('pin appears on the page', (await page.locator('.kcn-pin').count()) > 0);

    // Reply + resolve through the pin.
    if (noteId) {
      await page.locator(`#kcn-pin-${noteId}`).click();
      const card = page.locator('#kcn-card');
      await card.getByPlaceholder('Reply…').fill('QA bot reply');
      await card.getByRole('button', { name: 'Reply' }).click();
      await page.waitForTimeout(1500);
      check('reply saves', (await replies(noteId)).some(r => r.body === 'QA bot reply'));
      await page.locator(`#kcn-pin-${noteId}`).click();
      await page.locator('#kcn-card').getByRole('button', { name: 'Resolve' }).click();
      await page.waitForTimeout(1500);
      check('resolve saves', (await notes()).find(n => n.id === noteId)?.urgency === 'done');
    }
    // Delete a fresh note from its pin.
    const err2 = await leaveNote(page, 'QA Bot', `QA bot delete-me ${stamp}`);
    const del = (await notes()).find(n => n.body.includes(`QA bot delete-me ${stamp}`));
    check('second note saves', !err2 && !!del, err2 || '');
    if (del) {
      await page.waitForTimeout(500);
      page.once('dialog', d => d.accept());
      await page.locator(`#kcn-pin-${del.id}`).click();
      await page.locator('#kcn-card').getByRole('button', { name: 'Delete' }).click();
      await page.waitForTimeout(1500);
      const still = (await notes()).some(n => n.id === del.id);
      check('author can delete their note on the site', !still);
      if (still) created.push([del.id, 'QA Bot']);
    }
    check('no script errors in note mode', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 3. Someone types "Ivan" as their name: still saves.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${SITE}?kcnotes=${CODE}`);
    await page.getByRole('button', { name: /Leave a note/ }).waitFor({ timeout: 8000 });
    const err = await leaveNote(page, 'Ivan', `QA bot Ivan note ${stamp}`);
    check('note as "Ivan" saves', !err, err || '');
    const saved = (await notes()).find(n => n.body.includes(`QA bot Ivan note ${stamp}`));
    if (saved) created.push([saved.id, 'Ivan']);
    await ctx.close();
  }

  // 3b. All-projects list is admin-only; clients still need a code.
  {
    const r = await fetch(`${PORTAL}/api/projects?all=1`);
    check('all-projects list is blocked without admin sign-in', r.status === 401, String(r.status));
    const r2 = await fetch(`${PORTAL}/api/projects?inbox=1`);
    check('incoming-changes summary is blocked without admin sign-in', r2.status === 401, String(r2.status));
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${PORTAL}/portal/`);
    await page.fill('#input-name', 'QA Bot');
    await page.click('.btn-primary');
    await page.waitForTimeout(800);
    check('client without a code is asked for one', (await page.locator('#login-error').innerText()).includes('project code'));
    await ctx.close();
  }

  // 3c. Invite link pre-fills the code and opens a non-JPN project cleanly.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${PORTAL}/portal/?code=OAHU2026`);
    check('invite link pre-fills the project code', (await page.inputValue('#input-code')) === 'OAHU2026');
    await page.fill('#input-name', 'QA Bot');
    await page.click('.btn-primary');
    await page.waitForTimeout(3000);
    check('other project opens with its own name', (await page.locator('#project-name').innerText()).includes('Oahu'));
    check('other project hides Jesus People plan sections', !(await page.locator('#tab-plan').innerText()).includes('Foundation + live journey pages'));
    check('other project shows its website link', (await page.locator('#links-list').innerText()).includes('Oahu Theological Seminary website'));
    check('no script errors on other project', errors.length === 0, errors.join('; '));
    await ctx.close();
  }

  // 4. Portal Site notes tab lists the note and links to the site in note mode.
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(`${PORTAL}/portal/`);
    await page.fill('#input-name', 'QA Bot');
    await page.fill('#input-code', CODE);
    await page.click('.btn-primary');
    await page.getByRole('button', { name: 'Edits & notes' }).click();
    await page.waitForTimeout(2500);
    const href = await page.getAttribute('#sitenotes-open', 'href');
    check('portal note-mode link is correct', href?.startsWith(SITE) && href.includes(`kcnotes=${CODE}`), href || '');
    const listText = await page.locator('#sitenotes-list').innerText();
    check('portal lists the note', listText.includes(`QA bot note ${stamp}`));
    await page.fill('#edit-input', `QA bot quick edit ${stamp}`);
    await page.click('#edit-btn');
    await page.waitForTimeout(2000);
    const edit = (await notes()).find(n => n.body.includes(`QA bot quick edit ${stamp}`));
    check('quick edit added from portal', !!edit);
    if (edit) {
      page.once('dialog', d => d.accept());
      await page.locator(`#sitenotes-list .tc-del`).first().click().catch(() => {});
      await page.waitForTimeout(1500);
      const still = (await notes()).some(n => n.id === edit.id);
      check('author can delete their edit in the portal', !still);
      if (still) created.push([edit.id, 'QA Bot']);
    }
    await ctx.close();
  }
} catch (e) {
  check('bot ran to completion', false, e.message);
} finally {
  // Clean up only what this run created (non-Ivan deletes are allowed by author; Ivan-authored ones need admin).
  for (const [id, author] of created) {
    const r = await fetch(`${API}?id=${id}`, { method: 'DELETE', headers: { ...H, 'X-Portal-Name': author } });
    if (!r.ok) results.push(`NOTE  could not delete ${id} (${author}) — remove it in the portal`);
  }
  await browser.close();
}

console.log(results.join('\n'));
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
