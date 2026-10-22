# Kovalenko Creatives

The website for Kovalenko Creatives, a software studio that builds websites, apps and integrations for businesses. It uses the "Studio" design: a light grid, monospace labels (`/services`, `/work`, `/process`, `/company`, `/contact`), one green accent and dark code-style panels. It shows what the studio builds (with optional maintenance and upgrades), selected work with real app screenshots, how a project runs, the company background and toolkit, and how to get in touch.

It is a plain static site. There is no build step, no framework, no server and no third-party scripts.

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
| `.github/workflows/pages.yml` | Runs the site check on every change and publishes to GitHub Pages from `main` |

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
npm test           # site check, then browser tests
```

On a machine that already has Chromium, point the tests at it with `CHROMIUM_PATH=/path/to/chromium npm test`; otherwise run `npx playwright install chromium` once.

**Site check** (`tools/check.mjs`, no install needed):
- Project data loads and every screenshot file exists
- Every file the page loads exists and every in-page link has a target
- No private claude.ai links, no email except the studio's, no phone numbers
- No risky claims in the page or assistant: guarantees, funnel or lead-gen service offers, promises about every device, promised lead numbers or turnaround times, "best" claims, or saying private apps are available
- The hero panel stays labelled as a sample

**Browser tests** (`tools/browser-test.mjs`), at small phone, phone, tablet, desktop and dark mode:
- No sideways scrolling; all screenshots and both fonts load; no missing files or page errors
- No requests to any other company
- Carousels work by dots and by swipe; the assistant fits on screen and ends at the studio email
- Zero accessibility issues in axe, with the assistant open
- Keyboard only: every main control and carousel is reachable, with a visible focus ring
- 200% zoom, reduced motion, and JavaScript turned off all still work
- The page's security policy blocks injected scripts
- Search basics: title, description length, language, one main headline, only the studio email

The publish workflow runs both on every pull request and before every deploy.

## Automated updates

The site is set up so AI agents can make routine updates safely. `CLAUDE.md` tells them what they may change and what must never be published. `npm test` enforces the mechanical parts (see Testing above). The publish workflow runs it on every pull request and before every deploy, so a failing change never goes live.

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

## Deploying

The included workflow runs the site check on every pull request, and on every push to `main` it runs the check and then publishes the site to GitHub Pages.

1. Merge the work into `main`.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. This only has to be done once.
3. The site is then live at `https://claudekovalenko.github.io/kovalenko-creatives/`.

To use a custom domain, add it under **Settings → Pages → Custom domain** and follow GitHub's DNS instructions.
