# Archived sources

Raw files are in `raw/`, extracted text in `<name>.txt`. Regenerate with `python3 fetch_sources.py`.

| Name | Status | URL |
| --- | --- | --- |
| jenoptik_dlem_family_brochure | failed: HTTP Error 403: Forbidden | https://pdf.directindustry.com/pdf/jenoptik-ag/diode-laser-rangefinder-dlem/17967-1036107.html |
| jenoptik_dlem20le_datasheet | ok | https://www.jenoptik.de/-/media/websitedocuments/optics/sensor/dlem-20le-edb.pdf |
| jenoptik_dlem20_military_technology_2016 | ok | https://www.jenoptik.com/-/media/websitedocuments/optics/sensor/dlem-20-feature-story-military-technology-magazine-10-2016.pdf |
| jenoptik_dlem17_datasheet | ok | https://www.jenoptik.us/-/media/websitedocuments/optics/sensor/dlem-17-edb.pdf |
| jenoptik_dlem_sr_datasheet | ok | http://www.idssi.com/wp-content/uploads/2016/12/DLEM_SR_en_110825_FINAL_USL_JDIIDSSI-1.pdf |
| jenoptik_dlem_4k_datasheet | ok | http://www.idssi.com/wp-content/uploads/2016/12/DLEM_4k_en_110817_FINAL_USL_JDIIDSSI-1.pdf |
| jenoptik_dlem_product_page | ok | https://www.jenoptik.com/products/lasers/laser-distance-sensors/dlem |
| jenoptik_us_laser_distance_sensors_page | ok | https://www.jenoptik.us/products/lasers/laser-distance-sensors |
| photonics_com_dlem20_listing | failed: HTTP Error 403: Forbidden | https://www.photonics.com/Buyers_Guide/Products/Lasers_Laser_Systems/DLEM_20_Laser_Rangefinder_Module/psp7555 |
| patent_EP2766742B1 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/EP2766742B1/en |
| patent_EP3159982B1 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/EP3159982B1/en |
| patent_US11237399B2 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/US11237399B2/en |
| patent_DE102016112557B4 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/DE102016112557B4/en |
| patent_EP3353592B1 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/EP3353592B1/en |
| patent_DE102014116121B3 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/DE102014116121B3/en |
| patent_DE102008056953B3 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/DE102008056953B3/en |
| patent_EP2363726B1 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/EP2363726B1/en |
| patent_US11378785B2 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/US11378785B2/en |
| patent_DE102013104308B4 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/DE102013104308B4/en |
| patent_DE4237347C1 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/DE4237347C1/en |
| patent_DE10246482B4 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/DE10246482B4/en |
| patent_DE10112833C1 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/DE10112833C1/en |
| patent_US20190215459A1 | failed: HTTP Error 503: Service Unavailable | https://patents.google.com/patent/US20190215459A1/en |
| wikipedia_hesa_shahed_136 | ok | https://en.wikipedia.org/wiki/HESA_Shahed_136 |
| nap_laser_radar_2014_catalog | ok | https://nap.nationalacademies.org/catalog/18733/laser-radar-progress-and-opportunities-in-active-electro-optical-sensing |

## Fetched by the patent research subagent

`fetch_sources.py` got 503s from Google Patents, but the research subagent
fetched these pages earlier with `tools/gpfetch.py` (and searched with
`tools/gp.py`), saving each as text. US 6,917,415 came as a scanned PDF and
was OCR'd page by page with `tools/pdfocr.py` (macOS Vision); US 8,767,188 is
a scanned PDF that wasn't OCR'd. The figures taken from these (pulse length,
pulse rate) are still marked unverified in NOTES.md.

| Name | Status | Source |
| --- | --- | --- |
| patent_DE102008056953B3 | ok, text | https://patents.google.com/patent/DE102008056953B3/en |
| patent_DE102013104308B4 | ok, text | https://patents.google.com/patent/DE102013104308B4/en |
| patent_EP2256516B1 | ok, text | https://patents.google.com/patent/EP2256516B1/en |
| patent_EP2766742B1 | ok, text | https://patents.google.com/patent/EP2766742B1/en |
| patent_EP3159982B1 | ok, text | https://patents.google.com/patent/EP3159982B1/en |
| patent_EP3353592B1 | ok, text | https://patents.google.com/patent/EP3353592B1/en |
| patent_US11237399B2 | ok, text | https://patents.google.com/patent/US11237399B2/en |
| patent_US11378785B2 | ok, text | https://patents.google.com/patent/US11378785B2/en |
| patent_US6603534B2 | ok, text | https://patents.google.com/patent/US6603534B2/en |
| patent_WO2011026487A3 | ok, text | https://patents.google.com/patent/WO2011026487A3/en |
| patent_US6917415 | ok, OCR text (`patent_US6917415.ocr.txt`) and `raw/patent_US6917415.pdf` | US patent 6,917,415 |
| patent_US8767188 | raw PDF only (`raw/patent_US8767188.pdf`), not OCR'd | US patent 8,767,188 |
