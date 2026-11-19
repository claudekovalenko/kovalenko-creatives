#!/bin/sh
# Collects only the public website files into _site/ for the host (Cloudflare Pages) to publish.
# Docs, tests, CLAUDE.md, the review copy and the workflow stay out, so they are never served.
# Developer comments are stripped too, so search engines and AI crawlers read only the page itself.
set -e
rm -rf _site
mkdir _site
for f in app.js chat.js projects.js; do
  sed -E '/^[[:space:]]*\/\/.*$/d' "$f" > "_site/$f"
done
sed -E '/^[[:space:]]*<!--.*-->[[:space:]]*$/d' index.html > _site/index.html
cp styles.css _site/
cp -r images fonts _site/
# The client portal (portal/) is published at /portal/. It is kept out of search engines by its own page.
mkdir _site/portal
for f in portal/portal.js portal/config.js; do
  sed -E '/^[[:space:]]*\/\/.*$/d' "$f" > "_site/$f"
done
sed -E '/^[[:space:]]*<!--.*-->[[:space:]]*$/d' portal/index.html > _site/portal/index.html
cp portal/portal.css _site/portal/
