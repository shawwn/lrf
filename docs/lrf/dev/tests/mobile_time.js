const puppeteer=require("puppeteer-core");
const url = process.argv[2], W = +process.argv[3];
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
const p=await b.newPage();
await p.setViewport({width:W,height:780,isMobile:true,hasTouch:true,deviceScaleFactor:2});
await p.goto(url,{waitUntil:"networkidle2"});
const H = await p.evaluate(()=>document.body.scrollHeight);
let worst = W, culprits = new Set();
for (let y = 0; y < H; y += 390) {
  await p.evaluate(y=>window.scrollTo(0,y), y);
  for (let k = 0; k < 4; k++) {
    await new Promise(r=>setTimeout(r,200));
    const r = await p.evaluate(()=>{const W=document.documentElement.clientWidth, sw=document.documentElement.scrollWidth; const c=[];
      if (sw > W) { const walker=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
        while((n=walker.nextNode())){ if(!n.textContent.trim()) continue; const rg=document.createRange(); rg.selectNodeContents(n);
          if(rg.getBoundingClientRect().right>W+0.5) c.push((n.parentElement.className||n.parentElement.tagName)+": "+n.textContent.trim().slice(0,40)); }
        for (const e of document.querySelectorAll("body *")) { const b=e.getBoundingClientRect(); if (b.width>0 && b.right>W+0.5) c.push("box "+(e.id||e.className||e.tagName)); } }
      return {sw, c};});
    if (r.sw > worst) worst = r.sw;
    r.c.forEach(x=>culprits.add(x));
  }
}
console.log(JSON.stringify({W, worst, culprits:[...culprits].slice(0,10)}));
await b.close();})();
