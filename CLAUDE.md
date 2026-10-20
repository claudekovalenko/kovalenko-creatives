# Instructions for AI agents updating this site

This is the public website for Kovalenko Creatives, a one-person studio that builds custom websites and apps for businesses, with lead-generation funnels as an additional service drawing on the owner's lead-gen industry experience. Read `README.md` for how the files fit together. These rules apply to every automated change.

## What you may change

- **Project totals:** `BODY_OF_WORK` in `projects.js`.
- **Project cards:** `PROJECTS` in `projects.js`, including adding a new project or changing a status (for example from `'Custom · private'` to `'Available'`).
- **Screenshots:** new files in `images/` that a project's `slides` use.
- **Assistant answers:** `TOPICS` in `chat.js`.
- **Page copy:** `index.html`, when the owner asks for a wording change.

Keep edits as small as the request needs. Do not restructure files, rename sections, change the design tokens in `styles.css`, or add libraries unless the owner asks.

## Never publish

- Real names of private people, or anyone's finances, health details or addresses.
- Any email address except `kovalenkocreatives@gmail.com`, and no phone numbers.
- Links to claude.ai artifacts or private repositories.
- Screenshots containing someone's own saved data. Take screenshots from a fresh copy of an app with its built-in example data.
- Details of Next Steps beyond its current one-line description and placeholder screens.
- Claims that apps are available to the public while they are marked private, or offers of custom build time on retainer. Retainers are maintenance only; upgrades are requested and quoted one at a time.
- Results presented as real client numbers unless the client agreed to share them. The hero funnel is labelled illustrative; keep it that way.
- Promises of specific lead volumes, conversion rates or turnaround times.
- Claims of completed client funnel builds. Lead-gen experience comes from the owner's industry work; until a client funnel is delivered, describe funnels as a service, not past results.

## Before you finish

1. Run `node tools/check.mjs` and fix anything it reports. The publish workflow runs the same check and refuses to deploy if it fails.
2. Open `index.html` in a browser (or serve the folder) and confirm the change looks right at desktop and phone widths, with no sideways scrolling.
3. Describe what changed in the commit message in plain words.
