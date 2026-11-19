# Kovalenko Creatives

The website for Kovalenko Creatives, a software studio that builds websites, apps and integrations for businesses. It uses the "Studio" design: a light grid, monospace labels (`/services`, `/work`, `/process`, `/company`, `/contact`), one green accent and dark code-style panels. It shows what the studio builds (with optional maintenance and upgrades), selected work with real app screenshots, how a project runs, the company background and toolkit, and how to get in touch.

It is a plain static site. There is no build step, no framework, no server and no third-party scripts. The one exception is the separate **client portal** at `/portal/`, which signs people in through Supabase (see Client portal below); the public page itself never contacts it.

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
| `portal/` | The client portal page: `index.html`, `portal.js` (all the logic), `portal.css`, and `config.js` (Supabase address and public key) |
| `supabase/portal.sql` | The portal's database: tables, and the rules for who can see and change what |
| `bots/` | The portal's bots, run by GitHub Actions: `agent.mjs` (makes accepted changes and publishes approved ones) and `digest.mjs` (weekly summaries) |
| `.github/workflows/portal-bots.yml` | Runs the bots. Switched off until set up (see Client portal) |
| `tools/portal-test.mjs`, `tools/portal-bots-test.mjs`, `tools/portal-db-test.sh` | Tests for the portal page, the bots and the database rules |

## Previewing locally

Serve the folder and open it in a browser:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk also works.

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
npm test           # site check, browser tests, portal page tests, bot tests
npm run test:db    # portal database rules, against a throwaway local Postgres (needs Postgres installed)
```

On a machine that already has Chromium, point the tests at it with `CHROMIUM_PATH=/path/to/chromium npm test`; otherwise run `npx playwright install chromium` once.

**Site check** (`tools/check.mjs`, no install needed):
- Project data loads and every screenshot file exists
- Every file the page loads exists and every in-page link has a target
- No private claude.ai links, no email except the studio's, no phone numbers
- No risky claims in the page or assistant: guarantees, funnel or lead-gen service offers, promises about every device, promised lead numbers or turnaround times, "best" claims, or saying private apps are available
- The hero panel stays labelled as a sample
- The live build (`tools/build.sh`) publishes only website files, with developer comments stripped and no links to anything outside the site, so search engines and AI crawlers read only the page itself

**Browser tests** (`tools/browser-test.mjs`), at small phone, phone, tablet, desktop and dark mode:
- No sideways scrolling; all screenshots and both fonts load; no missing files or page errors
- No requests to any other company
- Carousels work by dots and by swipe; the assistant fits on screen and ends at the studio email
- Zero accessibility issues in axe, with the assistant open
- Keyboard only: every main control and carousel is reachable, with a visible focus ring
- 200% zoom, reduced motion, and JavaScript turned off all still work
- The page's security policy blocks injected scripts
- Search basics: title, description length, language, one main headline, only the studio email

The check workflow runs these on every push and pull request, plus the portal tests and the database rules test.

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
- **No secrets.** The site has no API keys, tokens or backend. Nothing here needs to be kept secret, and nothing secret should ever be added.
- **No visitor data.** There are no forms, cookies, analytics or trackers. The contact section and the assistant both lead to an email address; the assistant runs in the browser and sends nothing.
- **Text only.** `app.js` and `chat.js` build every element with `textContent`, never as raw HTML, so project data and assistant answers cannot inject markup.
- **External links** open in a new tab with `rel="noopener"`.

## Client portal

A private area at `/portal/` where clients and collaborators sign in with Google, see the projects you add them to, and post requests and comments. You approve people, set each request's status, and approve or reject the changes the agent prepares. Nothing an agent makes reaches a live site until you press **Approve and publish**.

**How it fits together**

- **Sign-in:** Google, through Supabase Auth. Everyone starts as *pending* and sees nothing until you approve them on the People page and tick the projects they may see.
- **Posts:** approved members' requests and comments show immediately to everyone on that project. You can hide any of them.
- **Request status:** New → Accepted or Declined → In progress → Waiting for review → Live.
- **Permissions live in the database** (`supabase/portal.sql`, Row Level Security). The page uses only the public key, so even a modified page cannot see another project, read people's emails, change a status or approve a change.
- **Agent** (`bots/agent.mjs`, every 30 minutes once switched on): takes requests you set to *Accepted* in projects that have a repository, has Claude Code make the change on a new branch, and opens a pull request. The portal then shows the summary, a preview link and **Approve and publish** / **Reject**. Approving merges the pull request once the repository's own checks pass, and Cloudflare publishes it as usual. Rejecting closes the pull request and returns the request to *In progress*.
- **Weekly summary** (`bots/digest.mjs`, Mondays): one short summary per active project on the Updates page, written by Claude, or a plain list if no Claude key is set. It is sent no names or emails.

**Agent safety.** Only requests you accepted reach the agent. Claude Code may only read and edit files (no shell, no web), runs in a throwaway container that never sees the GitHub or database keys, is told to treat request text as data and follow the repository's `CLAUDE.md`, and any change to `.github/` is refused. Bot logs never include request text, names or keys, because Actions logs on a public repository are public. On a **public** repository, the pull request (titled "Portal request #N", with the agent's summary) is public too.

### Setting it up (once)

1. **Supabase.** Create a Supabase project for the portal (keep it separate from other apps' data). In the SQL editor, run `supabase/portal.sql`.
2. **Google sign-in.** In Google Cloud, create an OAuth client (type: Web application) with the authorized redirect URI `https://YOUR-PROJECT.supabase.co/auth/v1/callback`. In Supabase, under Authentication → Sign In / Providers, turn on Google and paste the client ID and secret. Under Authentication → URL Configuration, add the portal address (for example `https://your-site/portal/index.html` and `https://your-site/portal/`) to the redirect URLs.
3. **Connect the page.** In `portal/config.js`, fill in the project URL and the **publishable** (anon) key from Project Settings → API. Never the service-role or secret key: the site check refuses it.
4. **Make yourself the owner.** Sign in on `/portal/` once, then run in the SQL editor, with your Google email:
   `update public.profiles set access = 'approved', is_owner = true where email = 'YOUR-GOOGLE-EMAIL';`
5. **Projects and people.** Add projects on the portal's projects page. When people sign in, approve them on the People page and tick their projects.

### Switching the bots on (when you are ready)

1. In this repository's Settings → Secrets and variables → Actions, add:
   - secret `PORTAL_SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key (Project Settings → API)
   - secret `PORTAL_GITHUB_TOKEN`: a fine-grained GitHub token for only the project repositories, with Contents (read and write), Pull requests (read and write) and Checks (read)
   - secret `ANTHROPIC_API_KEY`: for Claude (the agent needs it; the summary falls back to a plain list without it)
   - variable `PORTAL_SUPABASE_URL`: the Supabase project URL
   - variable `PORTAL_BOTS` = `on`
2. For each project the agent should work on, open it in the portal → Project settings, and set the GitHub repository, its live branch, and its preview address (for Cloudflare Pages: `{branch}.PROJECT.pages.dev`).
3. Try it by hand first: Actions → Portal bots → Run workflow. Then uncomment the `schedule` lines in `.github/workflows/portal-bots.yml`.

If a project's repository requires pull-request reviews before merging, the agent's merge is refused; the portal then shows the change as failed, and you merge on GitHub instead.

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
