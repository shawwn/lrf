#!/usr/bin/env python3
"""Split the working tree diff into logical groups of hunks and stage one group.

Usage: split_hunks.py classify            # print the classification
       split_hunks.py stage <group>       # git apply --cached the hunks of a group
"""
import os
import re
import subprocess
import sys

REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
FILES = ["js/lrf.js", "laser-range-finder/index.html", "css/lrf.css"]

RULES = [
    ("assumptions", ["quad_rr", "shahed_rr", "opt25", "opt50", "HERO_SCALE = 55", "def: 520", "d.st.R = 520",
                     "let R = 450", "TWO_R = 450", "base.rated_time_s", "rated_ms - base", "few tens of nanoseconds",
                     "DLEM SR, the module", "several thousand pulses per measurement", "shahed_black_rr"]),
    ("subbin", ["echo_center", "fmt_reported", "SCENES.subbin", "bin_share", 'id="subbin"', "subbin_sl"]),
    ("sweep", ["SWEEP_", "sweep_", "PAPER", "calib_hypothesis", "tag_half_px", "apriltag_sweep", "placed 50 meters away"]),
]


def diff(path):
    out = subprocess.run(["git", "diff", "-U0", "--", path], cwd=REPO, capture_output=True, text=True).stdout
    lines = out.splitlines(keepends=True)
    header, hunks, cur = [], [], None
    for ln in lines:
        if ln.startswith("@@"):
            cur = [ln]
            hunks.append(cur)
        elif cur is None:
            header.append(ln)
        else:
            cur.append(ln)
    return header, hunks


REGIONS = {
    "js/lrf.js": [
        ("sweep", "/* -------------------------- apriltag sweep", "/* ------------------------- calib two ranges"),
        ("subbin", "/* ----------------------------- sub-bin", "/* ------------------------- rate timeline"),
    ],
}


def region_of(path, hunk):
    m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@", hunk[0])
    start = int(m.group(1))
    text = open(REPO + "/" + path, encoding="utf-8").read().splitlines()
    for name, a, b in REGIONS.get(path, []):
        ia = next(i for i, l in enumerate(text) if a in l) + 1
        ib = next(i for i, l in enumerate(text) if b in l) + 1
        if ia <= start < ib:
            return name
    return None


def classify(hunk, path=None):
    if path:
        r = region_of(path, hunk)
        if r:
            return [r]
    body = "".join(l for l in hunk[1:] if l[:1] in "+-")
    groups = [name for name, keys in RULES if any(k in body for k in keys)]
    return groups or ["layout"]


def main():
    cmd = sys.argv[1]
    if cmd == "classify":
        for f in FILES:
            header, hunks = diff(f)
            counts = {}
            for h in hunks:
                g = classify(h, f)
                key = "+".join(g)
                counts[key] = counts.get(key, 0) + 1
                if len(g) > 1:
                    print("CONFLICT", f, h[0].strip(), g)
            print(f, counts)
    elif cmd == "stage":
        group = sys.argv[2]
        for f in FILES:
            header, hunks = diff(f)
            sel = [h for h in hunks if classify(h, f)[0] == group]
            if not sel:
                continue
            patch = "".join(header) + "".join("".join(h) for h in sel)
            r = subprocess.run(["git", "apply", "--cached", "--unidiff-zero", "-"], cwd=REPO, input=patch, text=True, capture_output=True)
            print(f, len(sel), "hunks", "OK" if r.returncode == 0 else "FAILED: " + r.stderr)


main()
