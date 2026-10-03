import sys, os, subprocess
import Quartz
from Foundation import NSURL
def render(pdf, outdir, scale=2.5, first=1, last=999):
    os.makedirs(outdir, exist_ok=True)
    doc = Quartz.CGPDFDocumentCreateWithURL(NSURL.fileURLWithPath_(os.path.abspath(pdf)))
    n = Quartz.CGPDFDocumentGetNumberOfPages(doc)
    outs=[]
    for i in range(first, min(n,last)+1):
        page = Quartz.CGPDFDocumentGetPage(doc, i)
        box = Quartz.CGPDFPageGetBoxRect(page, Quartz.kCGPDFMediaBox)
        w, h = int(box.size.width*scale), int(box.size.height*scale)
        cs = Quartz.CGColorSpaceCreateDeviceGray()
        ctx = Quartz.CGBitmapContextCreate(None, w, h, 8, w, cs, Quartz.kCGImageAlphaNone)
        Quartz.CGContextSetGrayFillColor(ctx, 1.0, 1.0)
        Quartz.CGContextFillRect(ctx, Quartz.CGRectMake(0,0,w,h))
        Quartz.CGContextScaleCTM(ctx, scale, scale)
        Quartz.CGContextDrawPDFPage(ctx, page)
        img = Quartz.CGBitmapContextCreateImage(ctx)
        p = os.path.join(outdir, "p%03d.png" % i)
        dest = Quartz.CGImageDestinationCreateWithURL(NSURL.fileURLWithPath_(p), "public.png", 1, None)
        Quartz.CGImageDestinationAddImage(dest, img, None)
        Quartz.CGImageDestinationFinalize(dest)
        outs.append(p)
    return n, outs
pdf=sys.argv[1]; lang=sys.argv[2] if len(sys.argv)>2 else "eng"
base=os.path.splitext(pdf)[0]
n, outs = render(pdf, base+"_pages")
txt=[]
for p in outs:
    r = subprocess.run(["tesseract", p, "-", "-l", lang], capture_output=True, text=True)
    txt.append("=== %s\n%s" % (os.path.basename(p), r.stdout))
open(base+".ocr.txt","w").write("\n".join(txt))
print(pdf, n, "pages", sum(len(t) for t in txt), "chars")
