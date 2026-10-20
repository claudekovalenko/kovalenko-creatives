# Kovalenko Creatives

The website for Kovalenko Creatives, a one-person studio that builds custom websites and apps for businesses, with lead-generation funnels as an additional service. It shows recent work, what the studio builds (with optional maintenance and upgrades), the lead-gen thinking behind every build, the owner's track record, the AI-assisted way the work is made, and how to get in touch.

It is a plain static site. There is no build step, no framework, no server and no third-party scripts.

## Files

| File | What it holds |
|---|---|
| `index.html` | Page structure and all fixed copy: hero, recent work, what I build, built to convert (illustrative funnel), track record, AI and toolkit, contact |
| `styles.css` | All styling. Colours and fonts are tokens at the top, with light and dark versions |
| `projects.js` | The data the page renders: project totals (`BODY_OF_WORK`) and the project cards (`PROJECTS`) |
| `app.js` | Renders the project totals and grid of squares, project cards, picture carousels, filters and the copy-email button |
| `chat.js` | The "Questions?" assistant: answers common questions from a fixed list and leads visitors to email. Runs entirely in the browser |
| `images/` | Screenshots used in the project carousels |
| `tools/check.mjs` | Site check: data loads, screenshots and links exist, no private details. Run `node tools/check.mjs` |
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

**Change the project totals.** Edit `BODY_OF_WORK` at the top of `projects.js`. The hero's project count, the grid of squares and its key all update from it. Only totals are shown, never project names.

**Change the illustrative funnel.** The funnel numbers in the "Built to convert" section are in `index.html`. Each stage's `--w` is its share of visitors (220 of 1,000 is `22%`), so the bars stay to scale; update both together. The numbers are labelled as illustrative, so keep that label unless they are replaced with a real client's results that the client has agreed to share.

**Add, remove or reorder a project.** Edit the `PROJECTS` list in `projects.js`. Each entry has:

- `title`, `category`, `description`
- `features` and `tags` (optional lists)
- `color`: the background behind the screenshots
- `slides`: the pictures visitors cycle through, as image paths (`'images/app-1.webp'`) or HTML for a drawn placeholder screen
- `status` (optional badge, such as "In development") and `url` (optional "Open app" link)

The category filters are built from the categories in use, so a new category gets a filter button automatically.

**Add screenshots.** Put them in `images/` and list them in the project's `slides`. Portrait phone screenshots cropped to about 9:13 fit the cards best; WebP keeps them small.

**Change what the assistant says.** Edit `TOPICS` in `chat.js`. Each topic has a button label, an answer, and the follow-up topics offered after it. The `email` topic shows the email buttons. Nothing visitors click is sent anywhere.

**Change the copy.** Everything else lives in `index.html`.

## Automated updates

The site is set up so AI agents can make routine updates safely. `CLAUDE.md` tells them what they may change and what must never be published. `tools/check.mjs` enforces the mechanical parts: it fails on broken project data, missing screenshots, broken links, private claude.ai links, unknown email addresses and phone numbers. The publish workflow runs the check on every pull request and before every deploy, so a failing change never goes live.

## Privacy checklist for new content

This site is public. Before adding a project or screenshot, check that it shows none of the following:

- Real names of private people (clients, friends, family, church members)
- Personal finances, health information or addresses
- Your own saved data from an app. Take screenshots from a fresh copy with example data instead
- Unreleased details of projects that are meant to stay private (Next Steps is kept to a short description and placeholder screens on purpose)
- Links to private claude.ai artifacts or private repositories

## Security

- **Content Security Policy.** `index.html` only allows the site's own scripts, styles and images, plus Google Fonts. Inline and third-party scripts are blocked, the page cannot be used to post forms anywhere, and plugins are disabled.
- **No secrets.** The site has no API keys, tokens or backend. Nothing here needs to be kept secret, and nothing secret should ever be added.
- **No visitor data.** There are no forms, cookies, analytics or trackers. The contact section and the assistant both lead to an email address; the assistant runs in the browser and sends nothing.
- **Trusted content only.** `app.js` renders slide HTML from `projects.js` as markup. That file is written by the site owner only; never paste content from visitors or other sites into it.
- **External links** open in a new tab with `rel="noopener"`.

## Deploying

The included workflow runs the site check on every pull request, and on every push to `main` it runs the check and then publishes the site to GitHub Pages.

1. Merge the work into `main`.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. This only has to be done once.
3. The site is then live at `https://claudekovalenko.github.io/kovalenko-creatives/`.

To use a custom domain, add it under **Settings → Pages → Custom domain** and follow GitHub's DNS instructions.
