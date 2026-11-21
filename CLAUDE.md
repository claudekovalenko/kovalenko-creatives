# Instructions for AI agents updating this site

This is the public website for Kovalenko Creatives, a software studio that builds websites, apps and integrations for businesses, in the "Studio" design. The owner worked six years in the lead-generation industry (four as a data analyst, two as a software developer). Read `README.md` for how the files fit together. These rules apply to every automated change.

## What you may change

- **Project totals:** `BODY_OF_WORK` in `projects.js`.
- **Project cards:** `PROJECTS` in `projects.js`, including adding a new project or changing a status (for example from `'Custom · private'` to `'Available'`).
- **Screenshots:** new files in `images/` that a project's `slides` use.
- **Assistant answers:** `TOPICS` in `chat.js`.
- **Page copy:** `index.html`, when the owner asks for a wording change.
- **Members portal:** `portal/`, `server/`, `hub/functions/`, `migrations/`, when the owner asks for a portal change. The portal is published separately (tools/build-hub.sh); never link to it from, or add it to, the public website. Add a new numbered migration file for database changes; never edit one that has already run.

Keep edits as small as the request needs. Do not restructure files, rename sections, change the Studio design tokens in `styles.css`, or add libraries unless the owner asks. The hero panel shows a sample project scope and must stay labelled as a sample.

## Never publish

- Real names of private people, or anyone's finances, health details or addresses.
- Any email address except `kovalenkocreatives@gmail.com`, and no phone numbers.
- Links to claude.ai artifacts or private repositories.
- Screenshots containing someone's own saved data. Take screenshots from a fresh copy of an app with its built-in example data.
- Details of Next Steps beyond its current one-line description and placeholder screens.
- Claims that apps are available to the public while they are marked private, or offers of custom build time on retainer. Retainers are maintenance only; upgrades are requested and quoted one at a time.
- Plan contents, member messages, exports or database files from the portal. They live in the D1 database only, never in this repository.
- Secrets: Google client secret, agent tokens, API keys. They belong in Cloudflare or GitHub settings.
- Any way for agents to message members, change plans or act without the owner's approval.
- Results presented as real client numbers unless the client agreed to share them.
- Promises of specific lead volumes, conversion rates or turnaround times.
- Offers of lead-generation funnels or lead-gen services. The owner has not built funnels; the lead-gen industry appears only as work background. Add a funnel offer only when the owner asks.

## Before you finish

1. Run `npm test` (site check, portal API tests, and browser tests for the site and portal) and fix anything it reports. GitHub runs the same tests on every push, but Cloudflare publishes the production branch as soon as it changes, so never push there with failing tests.
2. Look at the change in a browser at desktop and phone widths.
3. Describe what changed in the commit message in plain words.
