"""Builds the single-file review copy published to claude.ai for invited reviewers.

Everything (styles, fonts, scripts, screenshots) is inlined into one HTML file, and the review-only
feedback section in review/ is added. Usage: python3 tools/preview.py OUTPUT.html
The live site never uses this; it is published by tools/build.sh.
"""
import base64, os, re, sys

def b64(path):
    return base64.b64encode(open(path, 'rb').read()).decode()

html = open('index.html').read()
head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
# The claude.ai host supplies its own charset, viewport and security policy.
head = re.sub(r'<!--.*?-->\s*|<meta http-equiv="Content-Security-Policy"[^>]*>\s*|<meta charset[^>]*>\s*|<meta name="viewport"[^>]*>\s*', '', head, flags=re.S)

css = open('styles.css').read() + '\n' + open('review/feedback.css').read()
css = re.sub(r"url\('(fonts/[^']+\.woff2)'\)", lambda m: f"url('data:font/woff2;base64,{b64(m.group(1))}')", css)
head = re.sub(r'<link rel="stylesheet" href="styles.css">', lambda m: f'<style>{css}</style>', head)

def script(name):
    src = open(name).read()
    if name == 'projects.js':
        src = re.sub(r"'(images/[\w-]+\.webp)'", lambda m: f"'data:image/webp;base64,{b64(m.group(1))}'" if os.path.exists(m.group(1)) else m.group(0), src)
    return f'<script>{src}</script>'

body = re.sub(r'<script src="([\w.]+)"></script>', lambda m: script(m.group(1)), body)
body = body.replace('</script>\n</body>', '</script>\n') + f'\n  {script("review/feedback.js")}\n'
open(sys.argv[1], 'w').write(f'{head.strip()}\n{body}')
