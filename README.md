# Kovalenko Creatives

The website for Kovalenko Creatives, a software studio that builds websites, apps and integrations for businesses. It uses the "Studio" design: a light grid, monospace labels (`/services`, `/work`, `/process`, `/company`, `/contact`), one green accent and dark code-style panels. It shows what the studio builds (with optional maintenance and upgrades), selected work with real app screenshots, how a project runs, the company background and toolkit, and how to get in touch.

The public website is a plain static site: no framework, no third-party scripts. Alongside it runs the **members portal** (`/portal/`), where approved people sign in with Google to follow development plans, comment and chat, and where the owner approves people, answers and reviews proposals from agents. The portal runs on Cloudflare Pages Functions with a Cloudflare D1 database. The whole site installs as an app on a phone (PWA).

## Files

| File | What it holds |
|---|---|
| `index.html` | Page structure and all fixed copy: hero with sample scope panel, services, work, process, company and toolkit, contact |
| `styles.css` | All styling for the Studio design. Colours and fonts are tokens at the top, with light and dark versions |
| `projects.js` | The data the page renders: project totals (`BODY_OF_WORK`) and the project cards (`PROJECTS`) |
| `app.js` | Renders the project cards and their screenshot carousels, the project total and the copy-email button |
| `chat.js` | The "Questions?" assistant: answers common questions from a fixed list and leads visitors to email. Runs entirely in the browser |
| `images/` | Screenshots used in the project carousels |
| `fonts/` | The two typefaces (Inter Tight, JetBrains Mono), self-hosted, with their SIL Open Font License files |
| `tools/check.mjs` | Site check: data loads, screenshots and links exist, no private details, no risky claims. Run `npm run check` |
| `tools/browser-test.mjs` | Browser tests: loads the page at five screen sizes and checks layout, accessibility, keyboard use, screenshots, assistant, security and search basics. Run `npm test` |
| `package.json` | Test tools only (Playwright and axe). The site itself needs nothing installed |
| `CLAUDE.md` | Rules for AI agents that update the site |
| `.github/workflows/pages.yml` | Runs the site check and browser tests on every push and pull request |
| `tools/preview.py` | Builds the one-file review copy published to claude.ai for invited reviewers: `python3 tools/preview.py OUT.html` |
| `review/` | The review copy's feedback section (`feedback.js`, `feedback.css`), where invited reviewers comment on what each part needs. Never part of the live site |
| `tools/build.sh` | Collects only the website files into `_site/` for Cloudflare Pages to publish |
| `portal/` | The members portal page (`index.html`, `portal.js`, `portal.css`) |
| `functions/` | Cloudflare Pages Functions: send `/api/*` and `/auth/*` to `server/` |
| `server/` | Portal server code: Google sign-in and sessions (`auth.js`), members and plans (`members.js`), owner dashboard (`admin.js`), agent API (`agents.js`) |
| `migrations/0001_portal.sql` | Database tables for the portal |
| `manifest.webmanifest`, `sw.js`, `icons/` | Installable app: name, icons, offline shell |
| `_headers` | Security headers Cloudflare adds to every response |
| `tools/dev-server.mjs` | Local preview of site and portal with a local database: `npm run dev` |
| `tools/agent-watch.mjs` | Agent that reads new portal activity and sends the owner proposals: `npm run agent` |
| `tools/import-plan.mjs` | Turns a plan exported from a claude.ai artifact into SQL for the portal |

## Previewing locally

Serve the folder and open it in a browser:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk also works.

## Members portal

Open `/portal/` (or the **/members** link in the header). How it works:

1. **Sign in with Google.** Anyone can sign in, but a new account sees nothing until the owner approves it. They can leave a note ("I'm with the church team").
2. **Owner approves.** The owner dashboard (`/portal/#/owner`) lists people waiting, with a tick box per plan to approve them for. Approved members can also ask to join any plan marked "Members can ask to join"; the owner approves each request. Plans are private to their approved members.
3. **Plans.** Each plan has phases and tasks (to do, in progress, done) and shows progress. Tabs: **Progress** (with a comment thread on every task), **Chat** (refreshes every few seconds), **Updates** (owner progress posts) and **Ideas** (member suggestions the owner can turn into tasks).
4. **Summary.** The dashboard opens with a plain-text digest for today, 7 or 30 days: tasks done and in progress per plan, messages since the owner last replied, ideas, and what is waiting on the owner. One button copies it.
5. **Clients.** Every plan belongs to a client, and each client is a silo: their people only ever see that client's plans, can only ask to join that client's plans, and the owner can't approve them for another client's plan by mistake. When approving someone, the owner picks their client. The dashboard opens with **Clients and projects**: totals (active projects, owed, due now, extra work not billed, messages needing a reply) and a box per client with each project's progress, agreement status, money and replies owed.
6. **Agreement tab.** Per plan: *What's included* (the scope), *Terms*, *Payments* (amount, due date, paid or not) with the total, paid, balance owed and amount due now worked out, and *Extra work*, a log of anything done beyond the agreement with date, hours and value, marked not billed yet, billed, or no charge. "Bill it" turns an extra into a payment line. Extras can be kept private. The agreement stays a draft until the owner shares it; the client then accepts it with one tap, which records who and when. Changing the scope, terms or payment plan afterwards asks them to accept again. Agents never see agreements or money.
7. **Easy conversation.** Unread counts on plan cards and the Chat tab. Long messages fold after a few lines; with `ANTHROPIC_API_KEY` set in Cloudflare, Claude also writes a short version shown above the full text (the full text is always one tap away).
8. **Agents.** The owner creates a token per agent on the dashboard. An agent reads new activity through `/api/agent/*` and sends **proposals** ("I can fix this", notes, summaries). Proposals wait on the dashboard until the owner approves or declines them, with an optional reply. Agents cannot post to members, change plans or approve anything. Approved work is listed for the agent, which reports it in progress and then done.

### Setting it up on Cloudflare (once)

1. **Database.** The D1 database `kovalenko-creatives-hub` exists. Create the tables by running `migrations/0001_portal.sql` and then `migrations/0002_clients_agreements.sql` in Cloudflare (D1 > the database > Console, or `npx wrangler d1 execute kovalenko-creatives-hub --remote --file migrations/0001_portal.sql`).
2. **Bind it.** Cloudflare Pages project > Settings > Bindings > add **D1 database**, variable name `DB`, database `kovalenko-creatives-hub` (for Production).
3. **Google sign-in.** In Google Cloud Console > APIs & Services: configure the OAuth consent screen (External, app name Kovalenko Creatives, scopes `openid`, `email`, `profile`), then Credentials > Create OAuth client ID > Web application. Authorized redirect URI: `https://<your domain>/auth/google/callback` (add one per domain, e.g. the `pages.dev` address and the custom domain).
4. **Settings.** Cloudflare Pages > Settings > Variables and secrets (Production): `GOOGLE_CLIENT_ID` (text), `GOOGLE_CLIENT_SECRET` (secret), `OWNER_EMAILS` (text: the owner's Google address; comma-separate several). Optional: `ANTHROPIC_API_KEY` (secret) for short versions of long messages.
5. **Deploy** (push to the production branch), open `/portal/`, sign in with the owner account, and the dashboard appears.
6. **Install on a phone.** Open `https://<your domain>/portal/` on the phone. iPhone (Safari): Share > Add to Home Screen. Android (Chrome): menu > Install app (or the "Install app" button in the portal header).

### Moving a plan over from a claude.ai artifact

Export the artifact's `tasks` collection to a folder (one JSON file per task), write a small config naming the plan and its phases (see the top of `tools/import-plan.mjs`), then `node tools/import-plan.mjs plan.json > plan.sql` and run `plan.sql` in the D1 console. Imported plans start unlisted; approve members for them on the dashboard. Keep the export and SQL out of this repository.

### Running an agent

```sh
KC_URL=https://<your domain> KC_AGENT_TOKEN=kca_... ANTHROPIC_API_KEY=... npm run agent             # review new activity, send proposals
npm run agent -- --summary    # send the owner a written weekly summary
npm run agent -- --approved   # list work the owner approved
```

It uses Claude (`claude-opus-5-5`) to decide whether each new message, comment or idea is something it could fix, worth flagging, or nothing, and remembers where it stopped in `.agent-state.json`. Run it on a schedule: cron, a GitHub Actions schedule (store the token and key as repository secrets), or a Claude Code scheduled task. A coding agent can take the `--approved` list, make the change on a branch, and report back with `PATCH /api/agent/proposals/:id`.

### Local preview

```sh
npm run dev   # http://localhost:8787/portal/
```

Sign in without Google at `http://localhost:8787/auth/dev?email=owner@example.com&name=Owner` (owner) or any other email (a new member). This shortcut only works on localhost with `DEV_LOGIN=1`, which the dev server sets and the live site never has.

## Common edits

**Change the project total.** Edit `BODY_OF_WORK` at the top of `projects.js`. The "projects built" number in the hero adds it up. Only the total is shown, never project names.

**Add, remove or reorder a project.** Edit the `PROJECTS` list in `projects.js`. Each entry has:

- `title`, `description`
- `comment`: the small `// label` on the card's dark top, such as `// church app`
- `status`: the badge, such as `Custom · private` or `In development`
- `tags`: short labels shown at the bottom of the card
- `slides`: screenshot paths (`'images/app-1.webp'`) that visitors swipe through. Leave it empty (`[]`) to show the title on the dark top instead
- `url` (optional): adds an "Open app" button

**Add screenshots.** Put them in `images/` and list them in the project's `slides`. Portrait phone screenshots cropped to about 9:13 fit the cards best; WebP keeps them small.

**Change what the assistant says.** Edit `TOPICS` in `chat.js`. Each topic has a button label, an answer, and the follow-up topics offered after it. The `email` topic shows the email buttons. Nothing visitors click is sent anywhere.

**Change the copy.** Everything else lives in `index.html`.

## Testing

Run everything with:

```sh
npm install        # once, installs the test tools
npm test           # site check, then browser tests
```

On a machine that already has Chromium, point the tests at it with `CHROMIUM_PATH=/path/to/chromium npm test`; otherwise run `npx playwright install chromium` once.

**Site check** (`tools/check.mjs`, no install needed):
- Project data loads and every screenshot file exists
- Every file the page loads exists and every in-page link has a target
- No private claude.ai links, no email except the studio's, no phone numbers
- No risky claims in the page or assistant: guarantees, funnel or lead-gen service offers, promises about every device, promised lead numbers or turnaround times, "best" claims, or saying private apps are available
- The hero panel stays labelled as a sample
- The live build (`tools/build.sh`) publishes only website files, with developer comments stripped and no links to anything outside the site, so search engines and AI crawlers read only the page itself

**Portal API tests** (`tools/portal-api-test.mjs`): sign-in, pending and blocked accounts, approvals, plan access per member, chat, comments, ideas, updates, the summary, agent tokens and proposals, and refusal of changes sent from other sites.

**Portal browser tests** (`tools/portal-browser-test.mjs`): every portal screen (signed out, waiting, member plan and chat, owner dashboard and plan) at phone, desktop and dark mode with no sideways scrolling, no accessibility issues, no errors and no third-party requests; chat end to end; installable-app manifest, icons and service worker; security policy; keyboard sign-in.

**Browser tests** (`tools/browser-test.mjs`), at small phone, phone, tablet, desktop and dark mode:
- No sideways scrolling; all screenshots and both fonts load; no missing files or page errors
- No requests to any other company
- Carousels work by dots and by swipe; the assistant fits on screen and ends at the studio email
- Zero accessibility issues in axe, with the assistant open
- Keyboard only: every main control and carousel is reachable, with a visible focus ring
- 200% zoom, reduced motion, and JavaScript turned off all still work
- The page's security policy blocks injected scripts
- Search basics: title, description length, language, one main headline, only the studio email

The check workflow runs both on every push and pull request.

## Automated updates

The site is set up so AI agents can make routine updates safely. `CLAUDE.md` tells them what they may change and what must never be published. `npm test` enforces the mechanical parts (see Testing above). The check workflow runs it on every push and pull request. Cloudflare publishes whatever reaches the production branch, so run `npm test` before pushing there.

## Accessibility

The page is checked with axe (the standard automated accessibility checker) in light mode, dark mode and on a phone, with no issues. Every image has a text description, all content sits in page landmarks, the screenshot carousels can be reached and scrolled with the keyboard, focus is always visible, the layout holds at 200% zoom, and animation is off for visitors who ask their device to reduce motion. Without JavaScript the page still shows all its text, and a short list replaces the project cards.

## Privacy checklist for new content

This site is public. Before adding a project or screenshot, check that it shows none of the following:

- Real names of private people (clients, friends, family, church members)
- Personal finances, health information or addresses
- Your own saved data from an app. Take screenshots from a fresh copy with example data instead
- Unreleased details of projects that are meant to stay private (Next Steps is kept to a short description and placeholder screens on purpose)
- Links to private claude.ai artifacts or private repositories

## Security

- **Content Security Policy.** `index.html` only allows the site's own scripts, styles, images and fonts. Inline and third-party scripts are blocked, the page cannot be used to post forms anywhere, and plugins are disabled.
- **No third-party requests.** Fonts are self-hosted, so loading the page sends nothing to Google or anyone else. That keeps the site clear of privacy rules on sharing visitors' IP addresses, and means no cookie banner or privacy policy is needed for the site itself.
- **No secrets in the repository.** The Google client secret and owner emails live only in Cloudflare's settings. Session cookies and agent tokens are random, and only their SHA-256 hashes are stored.
- **No visitor data on the public site.** The website has no forms, cookies, analytics or trackers. The contact section and the assistant both lead to an email address; the assistant runs in the browser and sends nothing.
- **Portal accounts.** The portal stores each member's Google name and email, what they write, and their sign-in sessions, in the D1 database. It sets one cookie, only after sign-in (`__Host-kc_session`: HTTPS only, HttpOnly, SameSite=Lax, 30 days). Google sign-in uses PKCE and a one-time state check. Every change must come from this site (Origin check). Nobody sees a plan until the owner approves them for it, and blocking someone ends their sessions at once. The portal is marked `noindex`. Since the portal holds members' data, tell members what is kept and why (a short privacy note), and delete people on request.
- **Agents** see plan contents and member messages, so give tokens only to agents you run, and revoke a token from the dashboard if it leaks.
- **Text only.** `app.js` and `chat.js` build every element with `textContent`, never as raw HTML, so project data and assistant answers cannot inject markup.
- **External links** open in a new tab with `rel="noopener"`.

## Review copy and feedback

Before launch, a one-file review copy is published to claude.ai (`tools/preview.py`). It adds a `/feedback` section where invited reviewers, signed in with their Claude account, open claude.ai's comment box on any section of the page. Comments are stored by claude.ai, not by the site. The live site never includes this section: `tools/build.sh` copies only the website files.

## Deploying

The site is published by Cloudflare Pages, connected to this (private) repository. Cloudflare publishes only the website files, never the repository's history, docs or tests. Every push to the production branch goes live automatically.

Cloudflare Pages settings:

- **Production branch:** the branch the site is published from
- **Build command:** `sh tools/build.sh` (copies only the website files into `_site/`)
- **Build output directory:** `_site`
- **Preview deployments:** off, so unfinished branches never get a public link

The workflow in `.github/workflows/pages.yml` runs the site check and browser tests on every push and pull request. Run `npm test` before pushing to the production branch, since Cloudflare publishes whatever is pushed there.

To use a custom domain, add it in the Cloudflare Pages project under **Custom domains**.
