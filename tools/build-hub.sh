#!/bin/sh
# Builds the members portal ("hub") into hub/dist/ for its own Cloudflare Pages project, separate
# from the public website. The public site (tools/build.sh) never includes the portal.
# Cloudflare settings for the hub project: Root directory "hub", build command
# "cd .. && npm ci --omit=dev && sh tools/build-hub.sh", output directory "dist".
# Its server code lives in hub/functions/ (which loads server/).
set -e
cd "$(dirname "$0")/.."
OUT=hub/dist
rm -rf "$OUT"
mkdir -p "$OUT/portal"
for f in sw.js portal/portal.js; do
  sed -E '/^[[:space:]]*\/\/.*$/d' "$f" > "$OUT/$f"
done
sed -E '/^[[:space:]]*<!--.*-->[[:space:]]*$/d' portal/index.html > "$OUT/portal/index.html"
cp portal/portal.css "$OUT/portal/"
cp styles.css manifest.webmanifest _headers "$OUT/"
cp -r fonts icons "$OUT/"
# The hub has no public pages: its front door goes straight to the portal, and search engines stay out.
cat > "$OUT/index.html" <<'HTML'
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><meta http-equiv="refresh" content="0; url=/portal/"><title>Kovalenko Creatives</title></head>
<body><p><a href="/portal/">Open the members portal</a></p></body></html>
HTML
printf 'User-agent: *\nDisallow: /\n' > "$OUT/robots.txt"
