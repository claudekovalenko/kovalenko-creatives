#!/bin/sh
# Collects only the public website files into _site/ for the host (Cloudflare Pages) to publish.
# Docs, tests, CLAUDE.md and the workflow stay out, so they are never served.
set -e
rm -rf _site
mkdir _site
cp index.html styles.css app.js projects.js chat.js _site/
cp -r images fonts _site/
