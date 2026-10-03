const puppeteer=require("puppeteer-core");
(async()=>{const b=await puppeteer.launch({executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",headless:"new"});
for (const url of ["https://shawwn.github.io/lrf/laser-range-finder/", "http://127.0.0.1:8765/laser-range-finder/index.html?q="+Date.now()]) {
  const p=await b.newPage();await p.setViewport({width:400,height:900});
  await p.goto(url,{waitUntil:"networkidle2"});
  await p.evaluate(async()=>{for(let y=0;y<document.body.scrollHeight;y+=800){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,30));}});
  const r = await p.evaluate(()=>{const W=document.documentElement.clientWidth; const out=[];
    for (const e of document.querySelectorAll("body *")) { const b=e.getBoundingClientRect(); if (b.right > W + 1 && b.width > 0) out.push((e.id||e.className||e.tagName)+" right="+Math.round(b.right)+" text="+(e.textContent||"").slice(0,30)); }
    return {W, sw: document.documentElement.scrollWidth, out: out.slice(0,8)};});
  console.log(url.slice(0,40), JSON.stringify(r));
  await p.close();
}
await b.close();})();
