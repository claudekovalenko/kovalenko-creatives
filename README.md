# Kovalenko Creatives

The studio website for Kovalenko Creatives: what the studio builds, a few projects in detail, the technologies behind them, and how to start a project.

It is a plain static site. There is no build step, no framework, no server and no third-party scripts.

## Files

| File | What it holds |
|---|---|
| `index.html` | Page structure and all fixed copy: hero, services, process, toolkit, about, contact |
| `styles.css` | All styling. Colours and fonts are tokens at the top, with light and dark versions |
| `projects.js` | The data the page renders: project totals (`BODY_OF_WORK`) and the project cards (`PROJECTS`) |
| `app.js` | Renders the stats, project-count grid, project cards, picture carousels, filters and the copy-email button |
| `images/` | Screenshots used in the project carousels |
| `.github/workflows/pages.yml` | Publishes the site to GitHub Pages |

## Previewing locally

Serve the folder and open it in a browser:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` straight from disk also works.

## Common edits

**Change the project totals.** Edit `BODY_OF_WORK` at the top of `projects.js`. The hero stats, the grid of squares and its key all update from it. Only totals are shown, never project names.

**Add, remove or reorder a project.** Edit the `PROJECTS` list in `projects.js`. Each entry has:

- `title`, `category`, `description`
- `features` and `tags` (optional lists)
- `color`: the background behind the screenshots
- `slides`: the pictures visitors cycle through, as image paths (`'images/app-1.webp'`) or HTML for a drawn placeholder screen
- `status` (optional badge, such as "In development") and `url` (optional "Open app" link)

The category filters are built from the categories in use, so a new category gets a filter button automatically.

**Add screenshots.** Put them in `images/` and list them in the project's `slides`. Portrait phone screenshots cropped to about 9:13 fit the cards best; WebP keeps them small.

**Change the copy.** Everything else lives in `index.html`.

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
- **No visitor data.** There are no forms, cookies, analytics or trackers. The contact section is an email address.
- **Trusted content only.** `app.js` renders slide HTML from `projects.js` as markup. That file is written by the site owner only; never paste content from visitors or other sites into it.
- **External links** open in a new tab with `rel="noopener"`.

## Deploying

The included workflow publishes the site to GitHub Pages on every push to `main`.

1. Merge the work into `main`.
2. In the repository, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. This only has to be done once.
3. The site is then live at `https://claudekovalenko.github.io/kovalenko-creatives/`.

To use a custom domain, add it under **Settings → Pages → Custom domain** and follow GitHub's DNS instructions.
