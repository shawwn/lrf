import sys, urllib.request, re, html, os
def fetch(num, lang="en"):
    url = f"https://patents.google.com/patent/{num}/{lang}"
    req = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
    h = urllib.request.urlopen(req, timeout=60).read().decode("utf-8","replace")
    def sect(name):
        m = re.search(r'<section itemprop="%s".*?</section>' % name, h, re.S)
        return m.group(0) if m else ""
    def clean(s):
        s = re.sub(r'<span class="google-src-text">.*?</span>', '', s, flags=re.S)
        s = re.sub(r'<(br|p|div|li|heading)[^>]*>', '\n', s)
        s = re.sub(r'<[^>]+>', '', s)
        s = html.unescape(s)
        s = re.sub(r'[ \t]+', ' ', s)
        s = re.sub(r'\n\s*\n+', '\n', s)
        return s.strip()
    title = re.search(r'<title>(.*?)</title>', h, re.S)
    meta = []
    for k in ["inventor","assigneeOriginal","assigneeCurrent","priorityDate","filingDate","publicationDate"]:
        meta += [k+": "+clean(x) for x in re.findall(r'<(?:dd|span|time)[^>]*itemprop="%s"[^>]*>(.*?)</(?:dd|span|time)>' % k, h, re.S)]
    out = f"# {num}\n{clean(title.group(1)) if title else ''}\n" + "\n".join(meta) + "\n\n## ABSTRACT\n" + clean(sect("abstract")) + "\n\n## DESCRIPTION\n" + clean(sect("description")) + "\n\n## CLAIMS\n" + clean(sect("claims"))
    open(f"{num}.txt","w").write(out)
    print(num, len(out))
for n in sys.argv[1:]:
    try: fetch(n)
    except Exception as e: print("ERR", n, e)
