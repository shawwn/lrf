#!/usr/bin/env python3
"""
Archive the raw documents behind docs/lrf/NOTES.md.

Downloads every URL in SOURCES into raw/ and writes extracted plain text next
to this script (<name>.txt), so the text stays available even if the links
die. Re-run it to retry failures (Google Patents sometimes returns 503).

Usage: python3 docs/lrf/sources/fetch_sources.py
Text extraction from PDFs needs pypdf (pip install pypdf).
"""

import html
import os
import re
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "raw")

SOURCES = [
    # Jenoptik product documents
    ("jenoptik_dlem_family_brochure", "https://pdf.directindustry.com/pdf/jenoptik-ag/diode-laser-rangefinder-dlem/17967-1036107.html"),
    ("jenoptik_dlem20le_datasheet", "https://www.jenoptik.de/-/media/websitedocuments/optics/sensor/dlem-20le-edb.pdf"),
    ("jenoptik_dlem20_military_technology_2016", "https://www.jenoptik.com/-/media/websitedocuments/optics/sensor/dlem-20-feature-story-military-technology-magazine-10-2016.pdf"),
    ("jenoptik_dlem17_datasheet", "https://www.jenoptik.us/-/media/websitedocuments/optics/sensor/dlem-17-edb.pdf"),
    ("jenoptik_dlem_sr_datasheet", "http://www.idssi.com/wp-content/uploads/2016/12/DLEM_SR_en_110825_FINAL_USL_JDIIDSSI-1.pdf"),
    ("jenoptik_dlem_4k_datasheet", "http://www.idssi.com/wp-content/uploads/2016/12/DLEM_4k_en_110817_FINAL_USL_JDIIDSSI-1.pdf"),
    ("jenoptik_dlem_product_page", "https://www.jenoptik.com/products/lasers/laser-distance-sensors/dlem"),
    ("jenoptik_us_laser_distance_sensors_page", "https://www.jenoptik.us/products/lasers/laser-distance-sensors"),
    ("photonics_com_dlem20_listing", "https://www.photonics.com/Buyers_Guide/Products/Lasers_Laser_Systems/DLEM_20_Laser_Rangefinder_Module/psp7555"),
    # Patents (Jenoptik and related)
    ("patent_EP2766742B1", "https://patents.google.com/patent/EP2766742B1/en"),
    ("patent_EP3159982B1", "https://patents.google.com/patent/EP3159982B1/en"),
    ("patent_US11237399B2", "https://patents.google.com/patent/US11237399B2/en"),
    ("patent_DE102016112557B4", "https://patents.google.com/patent/DE102016112557B4/en"),
    ("patent_EP3353592B1", "https://patents.google.com/patent/EP3353592B1/en"),
    ("patent_DE102014116121B3", "https://patents.google.com/patent/DE102014116121B3/en"),
    ("patent_DE102008056953B3", "https://patents.google.com/patent/DE102008056953B3/en"),
    ("patent_EP2363726B1", "https://patents.google.com/patent/EP2363726B1/en"),
    ("patent_US11378785B2", "https://patents.google.com/patent/US11378785B2/en"),
    ("patent_DE102013104308B4", "https://patents.google.com/patent/DE102013104308B4/en"),
    # Referenced but not yet read by anyone
    ("patent_DE4237347C1", "https://patents.google.com/patent/DE4237347C1/en"),
    ("patent_DE10246482B4", "https://patents.google.com/patent/DE10246482B4/en"),
    ("patent_DE10112833C1", "https://patents.google.com/patent/DE10112833C1/en"),
    ("patent_US20190215459A1", "https://patents.google.com/patent/US20190215459A1/en"),
    # Targets
    ("wikipedia_hesa_shahed_136", "https://en.wikipedia.org/wiki/HESA_Shahed_136"),
    # Further reading
    ("nap_laser_radar_2014_catalog", "https://nap.nationalacademies.org/catalog/18733/laser-radar-progress-and-opportunities-in-active-electro-optical-sensing"),
]

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read(), r.headers.get("Content-Type", "")


def html_to_text(data):
    s = data.decode("utf-8", errors="ignore")
    s = re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>|</tr>|</h\d>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n\s*\n+", "\n\n", s)
    return s.strip()


def pdf_to_text(path):
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    r = PdfReader(path)
    return "\n\n".join("--- page %d ---\n%s" % (i + 1, p.extract_text() or "") for i, p in enumerate(r.pages))


def main():
    os.makedirs(RAW, exist_ok=True)
    index = []
    for name, url in SOURCES:
        txt_path = os.path.join(HERE, name + ".txt")
        if os.path.exists(txt_path) and os.path.getsize(txt_path) > 500:
            index.append((name, url, "ok (cached)"))
            continue
        status = None
        for attempt in range(3):
            try:
                data, ctype = fetch(url)
                is_pdf = data[:5] == b"%PDF-" or "pdf" in ctype
                raw_path = os.path.join(RAW, name + (".pdf" if is_pdf else ".html"))
                with open(raw_path, "wb") as f:
                    f.write(data)
                text = pdf_to_text(raw_path) if is_pdf else html_to_text(data)
                if text is None:
                    status = "saved raw PDF; install pypdf to extract text"
                else:
                    with open(txt_path, "w", encoding="utf-8") as f:
                        f.write("Source: %s\nFetched: %s\n\n%s\n" % (url, time.strftime("%Y-%m-%d"), text))
                    status = "ok"
                break
            except Exception as e:
                status = "failed: %s" % e
                time.sleep(3 + 4 * attempt)
        index.append((name, url, status))
        print(name, status, file=sys.stderr)

    with open(os.path.join(HERE, "INDEX.md"), "w", encoding="utf-8") as f:
        f.write("# Archived sources\n\n")
        f.write("Raw files are in `raw/`, extracted text in `<name>.txt`. Regenerate with `python3 fetch_sources.py`.\n\n")
        f.write("| Name | Status | URL |\n| --- | --- | --- |\n")
        for name, url, status in index:
            f.write("| %s | %s | %s |\n" % (name, status, url))


if __name__ == "__main__":
    main()
