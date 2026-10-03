const puppeteer=require("puppeteer-core");
const url = process.argv[2];
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
for (const W of [320, 360, 375, 390, 414]) {
  const p=await b.newPage();
  await p.setViewport({width:W,height:800,isMobile:true,hasTouch:true,deviceScaleFactor:2});
  await p.goto(url,{waitUntil:"networkidle2"});
  await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,40));}});
  await new Promise(r=>setTimeout(r,300));
  const r = await p.evaluate(()=>{const W=document.documentElement.clientWidth; const out=new Set();
    for (const e of document.querySelectorAll("body *")) { const b=e.getBoundingClientRect(); if (b.width>0 && (b.right > W + 0.5 || b.left < -0.5)) out.add("box " + (e.id||e.className||e.tagName) + " [" + Math.round(b.left) + "," + Math.round(b.right) + "]"); }
    const walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while((n=walker.nextNode())){ if(!n.textContent.trim()) continue; const rg=document.createRange(); rg.selectNodeContents(n);
      const b=rg.getBoundingClientRect(); if(b.right>W+0.5) out.add("text " + Math.round(b.right) + " " + (n.parentElement.className||n.parentElement.tagName) + ": " + n.textContent.trim().slice(0,40)); }
    return {W, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, out:[...out].slice(0,12)};});
  console.log(JSON.stringify(r));
  await p.close();
}
await b.close();})();
