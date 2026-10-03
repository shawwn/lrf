#!/usr/bin/env python3
"""Assemble the GitHub Pages site: the laser range finder article and only
the files it loads. The rest of the repo (the mirrored articles) is not
published.

    python3 .github/scripts/build_pages.py _site

Links to the other articles point at their originals on ciechanow.ski, the
Blog and Archives links (pages that aren't published) are dropped, and the
site's root redirects to the article. Fails if anything the page or its
stylesheets reference is missing from the output.
"""

import os
import re
import shutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ARTICLE = "laser-range-finder"

FILES = [
    "favicon.ico",
    "js/base.js", "js/lrf_model.js", "js/lrf.js",
    "css/base.css", "css/lrf.css",
    "images/anchor.png", "images/play_pause.png", "images/play_pause_white.png",
    "images/undo.png", "images/sqrt.svg",
]

ORIGINALS = {
    "../lights-and-shadows/index.html": "https://ciechanow.ski/lights-and-shadows/",
    "../cameras-and-lenses/index.html": "https://ciechanow.ski/cameras-and-lenses/",
}

REDIRECT = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Laser Range Finders</title>
  <meta http-equiv="refresh" content="0; url=%s/">
  <link rel="canonical" href="%s/">
</head>
<body>
  <p><a href="%s/">Laser Range Finders</a></p>
</body>
</html>
""" % (ARTICLE, ARTICLE, ARTICLE)


def article_html():
    with open(os.path.join(ROOT, ARTICLE, "index.html"), encoding="utf-8") as f:
        html = f.read()
    for local, remote in ORIGINALS.items():
        html = html.replace('href="%s"' % local, 'href="%s"' % remote)
    html = html.replace('<a href="../index.html">Shawn Presser</a>', '<a href="index.html">Shawn Presser</a>')
    html = re.sub(r'\s*<a href="\.\./index\.html">Blog</a>', "", html)
    html = re.sub(r'\s*<a href="\.\./archives\.html">Archives</a>', "", html)
    return html


def local_refs(text, base):
    """Paths (relative to the site root) of local files a page or stylesheet uses."""
    refs = re.findall(r'(?:src|href)="([^"#]+)"', text) + re.findall(r"url\(['\"]?([^'\")]+)['\"]?\)", text)
    out = set()
    for r in refs:
        if re.match(r"^[a-z]+:|^//", r):
            continue
        r = r.split("?")[0]
        out.add(os.path.normpath(os.path.join(base, r)))
    return out


def main(out):
    if os.path.exists(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, ARTICLE))
    for rel in FILES:
        os.makedirs(os.path.dirname(os.path.join(out, rel)) or out, exist_ok=True)
        shutil.copy2(os.path.join(ROOT, rel), os.path.join(out, rel))
    html = article_html()
    with open(os.path.join(out, ARTICLE, "index.html"), "w", encoding="utf-8") as f:
        f.write(html)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as f:
        f.write(REDIRECT)

    # everything the page loads must be there; stylesheet urls only need to
    # resolve for the classes the article uses, but checking them all is cheap
    needed = local_refs(html, ARTICLE)
    for css in ("css/base.css", "css/lrf.css"):
        with open(os.path.join(out, css), encoding="utf-8") as f:
            needed |= {p for p in local_refs(f.read(), "css") if "social" not in p}
    missing = sorted(p for p in needed if not os.path.exists(os.path.join(out, p)))
    if missing:
        sys.exit("missing from the site: " + ", ".join(missing))
    n = sum(len(fs) for _, _, fs in os.walk(out))
    print("built %s: %d files" % (out, n))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "_site")
