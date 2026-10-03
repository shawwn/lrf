import sys, json, urllib.request, urllib.parse, re, html
def q(query, num=100):
    url = "https://patents.google.com/xhr/query?url=" + urllib.parse.quote(query + "&num=%d" % num) + "&exp="
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
    d = json.load(urllib.request.urlopen(req, timeout=60))
    r = d["results"]
    print("##", query, "total", r.get("total_num_results"))
    for c in r.get("cluster", []):
        for it in c.get("result", []):
            p = it["patent"]
            t = re.sub("<.*?>","",html.unescape(p.get("title","")))
            a = re.sub("<.*?>","",html.unescape(p.get("assignee","")))
            print(p.get("publication_number"), p.get("priority_date"), "|", a, "|", t.strip(), "|", p.get("inventor"))
for arg in sys.argv[1:]:
    try: q(arg)
    except Exception as e: print("ERR", arg, e)
