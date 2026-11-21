#!/bin/sh
# Collects only the public website files into _site/ for the host (Cloudflare Pages) to publish.
# Docs, tests, CLAUDE.md, the review copy and the workflow stay out, so they are never served.
# Developer comments are stripped too, so search engines and AI crawlers read only the page itself.
# The portal's server code (functions/ and server/) is not copied: Cloudflare builds it from functions/.
set -e
rm -rf _site
mkdir -p _site/portal
for f in app.js chat.js projects.js sw.js portal/portal.js; do
  sed -E '/^[[:space:]]*\/\/.*$/d' "$f" > "_site/$f"
done
sed -E '/^[[:space:]]*<!--.*-->[[:space:]]*$/d' index.html > _site/index.html
sed -E '/^[[:space:]]*<!--.*-->[[:space:]]*$/d' portal/index.html > _site/portal/index.html
cp styles.css manifest.webmanifest _headers _site/
cp portal/portal.css _site/portal/
cp -r images fonts icons _site/
