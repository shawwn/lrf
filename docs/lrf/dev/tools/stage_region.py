#!/usr/bin/env python3
"""Stage only the js/lrf.js hunks that fall in one named region.

The staged file is rebuilt from HEAD's text by applying the selected hunks
(old line numbers refer to HEAD, so skipped hunks can't shift anything).
Usage: stage_region.py <region> [--dry]
"""
import os
import re, subprocess, sys
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
PATH = "js/lrf.js"
REGIONS = {
    "lines": ("Scene3D.prototype.render = function", "list.sort((a, b) => b.depth - a.depth);"),
    "hook": ("window.lrf_set = function", "d.update_slider_visibility();"),
    "parallax": ("SCENES.parallax_image = {", "/* ----------------------------- mount 3D"),
    "tag": ("SCENES.apriltag_pose = {", "/* -------------------------- apriltag sweep"),
}
def run(*a, inp=None):
    return subprocess.run(a, cwd=REPO, input=inp, capture_output=True, text=True, check=True).stdout
head = run("git", "show", "HEAD:" + PATH).splitlines(keepends=True)
diff = run("git", "diff", "-U0", "HEAD", "--", PATH).splitlines(keepends=True)
hunks = []
for ln in diff:
    m = re.match(r"@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@", ln)
    if m:
        s, n = int(m.group(1)), int(m.group(2) if m.group(2) is not None else 1)
        hunks.append({"start": s, "n": n, "add": []})
    elif hunks and ln.startswith("+") and not ln.startswith("+++"):
        hunks[-1]["add"].append(ln[1:])
def region_of(h):
    # line (1 based) the hunk touches in HEAD; pure additions sit after line `start`
    at = h["start"] if h["n"] else h["start"] + 1
    for name, (a, b) in REGIONS.items():
        ia = next(i for i, l in enumerate(head) if a in l) + 1
        ib = next(i for i, l in enumerate(head) if b in l and i + 1 > ia) + 1
        if ia <= at <= ib:
            return name
    return "rest"
want = sys.argv[1]
out, pos, used = [], 0, 0
for h in hunks:
    if region_of(h) != want:
        continue
    used += 1
    # pure addition: insert after line `start`; otherwise replace lines start..start+n-1
    cut = h["start"] if h["n"] == 0 else h["start"] - 1
    out += head[pos:cut]
    out += h["add"]
    pos = cut + h["n"]
out += head[pos:]
print(want, used, "of", len(hunks), "hunks")
if "--dry" not in sys.argv:
    sha = run("git", "hash-object", "-w", "--stdin", inp="".join(out)).strip()
    run("git", "update-index", "--cacheinfo", "100644," + sha + "," + PATH)
